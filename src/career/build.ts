/**
 * Карьера без интерфейса: стол уровня, эталонные компоненты, набор деталей и проверка по таблице
 * истинности. Без DOM — годится и для приложения, и для тестов.
 */

import { BOARDS, applyBoards, newChipBoard, type BoardSpec } from "../model/breadboard";
import { TRANSISTORS, mosfetPin, type Chip, type ChipDef, type Component, type Endpoint, type MosfetRole, type Scene, type TransistorKind } from "../model/types";
import { packageChip, packageProblems, chipInner } from "../chips/package";
import { chipsUsed } from "../chips/registry";
import { countChip, plural } from "../chips/count";
import { Simulation, heatThreshold, pinNode } from "../sim/simulation";
import { formatSI } from "../sim/resistorCodes";
import { FUNC_NAMES, LEVELS, SEQUENTIAL, SMD_TWIN, gateIo, kitLabel, seqNext, seqOuts, seqState, sequenceExpected, truth, type KitItem, type Level, type LogicFunc } from "./levels";
import { PIN_ROLES } from "../chips/roles";
import { MODEL_OFF, REF_ABS_MAX, chipModel, setModelSource, type ChipModel, type ModelPoint, type ModelState } from "../chips/model";

/** Напряжение питания при проверке, В. */
export const CHECK_VOLTS = 5;

/** Корпус уровня (SOT-23-5 или DIP) с заданными выводами; менять их нельзя. */
export function levelCase(level: Level): BoardSpec {
  const pkg = level.package ?? "SOT-23-5";
  const b = newChipBoard(level.roles.length, 0, 0, "K1", pkg);
  return { ...b, roles: [...level.roles], names: [...level.names], label: level.part, fixed: true, ...(level.room ? { room: level.room } : {}) };
}

/**
 * Стол уровня: только корпус. Поле корпуса по умолчанию — под SMD (детали набора — в SMD-корпусах);
 * сетку 2,54 мм под выводные детали можно выбрать в панели корпуса.
 */
export function levelScene(level: Level, smd = true): Scene {
  const box = levelCase(level);
  return { components: [], wires: [], boards: [smd ? { ...box, smd: true, seats: [] } : box], career: { level: level.id } };
}

/** Сделать что-то при наборе плат boards и вернуть прежние (отверстия общие на всё приложение). */
export function withBoards<T>(boards: BoardSpec[], fn: () => T): T {
  const saved = BOARDS.map((b) => ({ ...b }));
  applyBoards(boards);
  try {
    return fn();
  } finally {
    applyBoards(saved);
  }
}

/**
 * Эталонная сборка уровня на его корпусе: детали в отверстиях, цепи — перемычками.
 * chipFor — какую микросхему ставить на место детали-микросхемы нужной функции.
 */
export function recipeScene(level: Level, chipFor: (func: LogicFunc) => ChipDef): Scene {
  // Эталонная сборка стоит на сетке площадок (выводные детали)
  const scene = levelScene(level, false);
  const chips: Record<string, ChipDef> = {};
  for (const p of level.recipe.parts) {
    const placement = { mode: "board" as const, holes: p.holes };
    let c: Component;
    if (p.func) {
      const def = chipFor(p.func);
      chips[def.id] = def;
      Object.assign(chips, def.scene.chips ?? {});
      c = { id: p.id, type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement };
    } else if (p.ohms) c = { id: p.id, type: "resistor", variant: "tht", ohms: p.ohms, smdSize: "0805", placement };
    else if (p.uF) c = { id: p.id, type: "capacitor", variant: "ceramic", uF: p.uF, volts: 50, placement };
    else if (p.diode) c = { id: p.id, type: "diode", kind: p.diode, placement };
    else if (p.kind && p.kind in TRANSISTORS) c = { id: p.id, type: "transistor", kind: p.kind as TransistorKind, placement };
    else c = { id: p.id, type: "mosfet", kind: p.kind as "2N7000", placement };
    scene.components.push(c);
  }
  const hole = (end: string): string => {
    if (/^P\d+$/.test(end)) return `k:${end.slice(1)}`;
    const [id, pin] = end.split(".");
    const c = scene.components.find((x) => x.id === id)!;
    const holes = (c.placement as { holes: string[] }).holes;
    if (c.type === "mosfet") return holes[mosfetPin(c.kind, pin as MosfetRole)];
    if (c.type === "transistor") return holes["CBE".indexOf(pin)];
    return holes[Number(pin) - 1];
  };
  let n = 0;
  for (const net of level.recipe.nets) {
    for (let i = 1; i < net.length; i++) {
      scene.wires.push({ id: `W${++n}`, a: { hole: hole(net[0]) } as Endpoint, b: { hole: hole(net[i]) } as Endpoint, color: "#2f9e5a" });
    }
  }
  if (Object.keys(chips).length) scene.chips = chips;
  return scene;
}

/** Упаковать эталонную сборку уровня в микросхему с данным обозначением. */
export function packageRecipe(level: Level, id: string, chipFor: (func: LogicFunc) => ChipDef): ChipDef {
  const scene = recipeScene(level, chipFor);
  return withBoards(scene.boards!, () => {
    const def = packageChip(scene, level.part, id, 0);
    def.scene.chips = { ...chipsUsed(scene), ...(scene.chips ?? {}) };
    return def;
  });
}

/**
 * Эталонные («заводские») компоненты всех уровней — для песочницы. Составные собираются из
 * эталонных КМОП-вентилей.
 */
export function referenceChips(): ChipDef[] {
  const out = new Map<string, ChipDef>();
  const chipFor = (func: LogicFunc) => out.get(`ref:${func}-cmos`) ?? out.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
  for (const level of LEVELS) out.set(`ref:${level.id}`, packageRecipe(level, `ref:${level.id}`, chipFor));
  return [...out.values()];
}

// ─── Набор деталей ──────────────────────────────────────────────────────────

/** Функция микросхемы по обозначению описания: «career:nand-rtl», «ref:nand-cmos» → nand. */
export function chipFunc(defId: string): LogicFunc | undefined {
  const m = defId.match(/^(?:career|ref):(.+)$/);
  return m ? LEVELS.find((l) => l.id === m[1])?.func : undefined;
}

/** К какой строке набора относится деталь (-1 — ни к какой). */
export function kitIndex(kit: KitItem[], c: Component): number {
  if (c.stock) return -1;
  return kit.findIndex((k) => {
    // SMD-пара (2N7002 вместо 2N7000…) — та же строка набора: на корпусе под SMD выдаётся она
    if (k.part === "mosfet") return c.type === "mosfet" && (c.kind === k.kind || c.kind === SMD_TWIN[k.kind]);
    if (k.part === "bjt") return c.type === "transistor" && (c.kind === k.kind || c.kind === SMD_TWIN[k.kind]);
    if (k.part === "resistor") return c.type === "resistor" && c.ohms === k.ohms;
    if (k.part === "other") return c.type === k.type && Object.entries(k.match ?? k.preset).every(([key, v]) => (c as unknown as Record<string, unknown>)[key] === v || (key === "size" && v === "5mm" && !(c as { size?: string }).size));
    return c.type === "chip" && chipFunc(c.def) === k.func;
  });
}

/** Сколько деталей каждой строки набора уже стоит в схеме. */
export function kitUsed(kit: KitItem[], scene: Scene): number[] {
  const used = kit.map(() => 0);
  for (const c of scene.components) {
    const i = kitIndex(kit, c);
    if (i >= 0) used[i]++;
  }
  return used;
}

/** Что в начинке не из набора или сверх него. */
export function kitProblems(level: Level, scene: Scene): string[] {
  const out: string[] = [];
  const counts = level.kit.map(() => 0);
  for (const c of chipInner(scene)) {
    const i = kitIndex(level.kit, c);
    if (i < 0) out.push(`${c.id} — не из набора.`);
    else counts[i]++;
  }
  level.kit.forEach((k, i) => {
    if (counts[i] > k.count) out.push(`${kitLabel(k)}: в наборе ${k.count}, а стоит ${counts[i]}.`);
  });
  return out;
}

// ─── Проверка ───────────────────────────────────────────────────────────────

export interface CheckRow {
  /** Номер шага последовательности (у схем с памятью), с 1. */
  step?: number;
  inputs: boolean[];
  /** По выходам (в порядке номеров выводов): что нужно и что есть, В. */
  expected: boolean[];
  volts: number[];
  /** Каждый выход отдельно: верен ли. */
  each: boolean[];
  /** Ток от питания в этом состоянии, А. */
  amps: number;
  /** Ток в каждый вход (от источника сигнала), А. */
  inAmps: number[];
  /** Что сгорело или перегружено сверх номинала при этой строке (обозначения внутри микросхемы). */
  burned: string[];
  /** Выход «висит»: идёт за нагрузкой (к общему — ноль, к питанию — единица). */
  floating: boolean[];
  ok: boolean;
}

/**
 * Цифры сборки: что зависит от решения игрока. Число транзисторов при фиксированном наборе почти
 * не меняется — оно для сравнения вариантов (КМОП против РТЛ), как и ток покоя.
 */
export interface Metrics {
  /** Охватывающий прямоугольник занятых площадок поля корпуса, площадок. */
  width: number;
  height: number;
  /** Проводов и дорожек внутри корпуса. */
  links: number;
  /** Наибольший ток от питания по строкам таблицы, А. */
  idle: number;
  /** Транзисторов внутри, с раскрытием вложенных микросхем. */
  transistors: number;
  /** Наименьшее питание из SUPPLY_STEPS, при котором сборка ещё работает, В. */
  vmin?: number;
  /**
   * Выходное сопротивление, Ом: худшее из «к питанию» и «к общему» по всем выходам при 5 В. Чем
   * меньше, тем больше входов выдержит выход и тем твёрже держит уровень.
   */
  rOut?: number;
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
  rows: CheckRow[];
  def?: ChipDef;
  metrics?: Metrics;
  /** Шаги урока введения: что сделано, что нет. */
  steps?: { text: string; ok: boolean }[];
  /** Что проверить, если не прошло: симптомы, без решения. */
  diagnosis?: string[];
  /** Какие цифры стали лучше прежних (заполняет приложение, сохраняя результат). */
  better?: (keyof Metrics)[];
}

/** Площадка поля корпуса «k:B7» → [столбец, ряд]; выводы корпуса («k:3») и чужие платы — нет. */
function fieldCell(hole: string): [number, number] | undefined {
  const m = hole.match(/^k:([A-Z])(\d+)$/);
  return m ? [Number(m[2]), m[1].charCodeAt(0) - 65] : undefined;
}

/** Цифры сборки на корпусе (после успешной проверки). */
export function measure(scene: Scene, rows: CheckRow[], def: ChipDef, chips: Record<string, ChipDef>): Metrics {
  const cells: [number, number][] = [];
  for (const c of chipInner(scene)) if (c.placement.mode === "board") cells.push(...c.placement.holes.map(fieldCell).filter((x): x is [number, number] => !!x));
  const onCase = (h: string) => /^k:/.test(h);
  const wires = scene.wires.filter((w) => "hole" in w.a && "hole" in w.b && onCase(w.a.hole) && onCase(w.b.hole));
  const traces = (scene.traces ?? []).filter((t) => onCase(t.a) && onCase(t.b));
  for (const w of wires) for (const e of [w.a, w.b]) if ("hole" in e) cells.push(...[fieldCell(e.hole)].filter((x): x is [number, number] => !!x));
  for (const t of traces) cells.push(...[fieldCell(t.a), fieldCell(t.b)].filter((x): x is [number, number] => !!x));
  const span = (i: 0 | 1) => (cells.length ? Math.max(...cells.map((c) => c[i])) - Math.min(...cells.map((c) => c[i])) + 1 : 0);
  return {
    width: span(0),
    height: span(1),
    links: wires.length + traces.length,
    idle: Math.max(0, ...rows.map((r) => r.amps)),
    transistors: countChip(def, { components: [], wires: [], chips }).transistors,
  };
}

/**
 * Нагрузка выхода на стенде, Ом. Обычно 100 кОм — лёгкая, как вход КМОП с утечками. У уровня с
 * требованием к току (level.drive, при 5 В) — такая, что выход, удержавший 70 % питания (или 30 %),
 * отдаёт (или принимает) не меньше этого тока: так проверяют, скольких входов хватит выходу.
 */
export const loadOhms = (level: Level) => (level.drive ? (0.7 * CHECK_VOLTS) / level.drive : 100_000);

/** Уровни логики при питании vcc: единица — не ниже 70 %, ноль — не выше 30 %. */
const isHigh = (v: number, vcc: number) => v >= 0.7 * vcc;
const isLow = (v: number, vcc: number) => v <= 0.3 * vcc;

/** Больше стольких входов таблицу не перебирают целиком, а проверяют набором векторов. */
const FULL_TABLE_INPUTS = 6;

/**
 * Входные наборы для проверки. До FULL_TABLE_INPUTS входов — вся таблица. Больше — как проверяют
 * настоящие микросхемы: все нули, все единицы, «бегущая» единица и «бегущий» ноль (каждый вход
 * отдельно) и ещё случайные, но всегда одни и те же наборы — всего 40.
 */
export function inputVectors(n: number): boolean[][] {
  const bits = (m: number) => Array.from({ length: n }, (_, i) => !!(m & (1 << (n - 1 - i))));
  if (n <= FULL_TABLE_INPUTS) return Array.from({ length: 1 << n }, (_, m) => bits(m));
  const all = (1 << n) - 1;
  const seen = new Set<number>();
  const out: number[] = [];
  const add = (m: number) => {
    if (!seen.has(m)) seen.add(m), out.push(m);
  };
  add(0);
  add(all);
  for (let i = 0; i < n; i++) add(1 << i);
  for (let i = 0; i < n; i++) add(all ^ (1 << i));
  // Линейный конгруэнтный генератор с постоянным зерном: наборы одни и те же при каждой проверке
  let x = 12345;
  while (out.length < 40) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    add((x >> 8) & all);
  }
  return out.map(bits);
}

/**
 * Прогнать микросхему def по таблице истинности функции уровня: питание 5 В, входы — на питание
 * или на общий, каждый выход нагружен 100 кОм. Нагрузка тянет против нужного уровня (к питанию,
 * если нужен ноль, и наоборот): выход должен сам удержать чёткий ноль или единицу, и ничего
 * внутри не должно сгореть.
 */
export function truthTable(def: ChipDef, level: Level, chips: Record<string, ChipDef>, volts = CHECK_VOLTS, load = loadOhms(level)): CheckRow[] {
  const io = gateIo(level);
  const rows: CheckRow[] = [];
  const n = io.inputs.length;
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: { mode: "free", x: 0, z: 0, rot: 0 } };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const loads = io.outputs.map((_, k) => `RL${k + 1}`);
  /** Провода стенда: входы inputs; нагрузка выхода k — к питанию, если up[k], иначе к общему. */
  const wiring = (inputs: boolean[], up: boolean[]) =>
    (
      [
        [plus, pin(io.vcc)],
        [minus, pin(io.gnd)],
        ...io.inputs.map((p, i): [Endpoint, Endpoint] => [pin(p), inputs[i] ? plus : minus]),
        ...io.outputs.flatMap((p, k): [Endpoint, Endpoint][] => [
          [pin(p), { comp: loads[k], pin: 0 }],
          [{ comp: loads[k], pin: 1 }, up[k] ? plus : minus],
        ]),
      ] as [Endpoint, Endpoint][]
    ).map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" }));
  const scene: Scene = {
    components: [
      { id: "G1", type: "psu", volts, amps: 1, on: true, placement: { mode: "free", x: 0, z: 0, rot: 0 } },
      u,
      ...loads.map((id): Component => ({ id, type: "resistor", variant: "tht", ohms: load, smdSize: "0805", placement: { mode: "free", x: 0, z: 0, rot: 0 } })),
    ],
    wires: wiring(Array(n).fill(false), io.outputs.map(() => false)),
    boards: [],
    chips: { ...chips, [def.id]: def },
  };
  // Один стенд на всю таблицу, как на столе: входы и нагрузки переключаются, а расчёт продолжается
  // с прошлого состояния — так он сходится в разы быстрее, чем каждый раз с нуля
  // Проверяемая микросхема — до транзисторов; микросхемы внутри неё, уже проверенные, — моделью
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  /** Один прогон: переключить стенд и дать схеме установиться. */
  const run = (inputs: boolean[], up: boolean[]) => {
    scene.wires = wiring(inputs, up);
    sim.solve();
    const burnt = new Set<string>();
    for (const c of sim.step(0.01)) if (c.id.startsWith("U1/")) burnt.add(c.id.slice(3));
    // Сгорание в расчёте копится нагревом за секунды, проверка короче — поэтому перегрузка сверх
    // номинала тоже провал: в жизни такая деталь сгорела бы чуть позже
    for (const c of sim.parts) {
      if (!c.id.startsWith("U1/")) continue;
      const limit = heatThreshold(c);
      if (limit && sim.overload(c) > limit) burnt.add(c.id.slice(3));
    }
    const gnd = sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0;
    const outV = io.outputs.map((p) => (sim.solution.voltage.get(pinNode(u, p - 1)) ?? 0) - gnd);
    // Ток от питания без токов нагрузок: то, что потребляет сама микросхема
    const loadAmps = loads.reduce((sum, _, k) => sum + Math.abs(sim.current(scene.components[2 + k])), 0);
    const amps = Math.max(0, Math.abs(sim.current(scene.components[0])) - loadAmps);
    // Провода входов идут от вывода к источнику: ток в вывод — с обратным знаком
    const inAmps = io.inputs.map((_, i) => -(sim.solution.branches.get(`W${2 + i}`)?.current ?? 0));
    return { volts: outV, amps, burnt, inAmps };
  };
  // Схема с памятью — шаги по порядку (подготовительные не проверяются); остальные — таблица
  const expectedSeq = sequenceExpected(level);
  const steps = level.sequence
    ? level.sequence.map((s, i) => ({ inputs: s.in, expected: expectedSeq[i], prep: !!s.prep }))
    : inputVectors(n).map((inputs) => ({ inputs, expected: truth(level.func, inputs), prep: false }));
  let stepNo = 0;
  let lastPrep: number[] | undefined;
  for (const [i, step] of steps.entries()) {
    // Первый проверяемый шаг после подготовительных: что хранит схема — замеряем, дальше считаем от этого
    if (level.sequence && !step.prep && lastPrep && i > 0 && steps[i - 1].prep) {
      const q0 = seqState(level.func, lastPrep.map((v) => v > volts / 2));
      sequenceExpected(level, q0, i).forEach((e, j) => (steps[i + j].expected = e));
    }
    const { inputs, expected, prep } = step;
    const good = (k: number, v: number) => (expected[k] ? isHigh(v, volts) : isLow(v, volts));
    const first = run(inputs, expected.map((e) => !e));
    if (prep) {
      lastPrep = first.volts;
      continue;
    }
    const each = expected.map((_, k) => good(k, first.volts[k]));
    const burnt = new Set(first.burnt);
    let floating = expected.map(() => false);
    // Неверный выход: он неправ сам или просто идёт за нагрузкой? Нагрузка в другую сторону покажет
    if (!each.every(Boolean)) {
      const second = run(inputs, expected);
      second.burnt.forEach((c) => burnt.add(c));
      floating = expected.map((_, k) => !each[k] && good(k, second.volts[k]));
    }
    rows.push({
      ...(level.sequence ? { step: ++stepNo } : {}),
      inputs,
      expected,
      volts: first.volts,
      amps: first.amps,
      inAmps: first.inAmps,
      burned: [...burnt],
      floating,
      each,
      ok: !burnt.size && each.every(Boolean),
    });
  }
  return rows;
}

/** Стенд для одной микросхемы: питание volts, вход (если есть) — от второго блока питания, выход — на нагрузку 100 кОм к общему. */
function bench(def: ChipDef, level: Level, chips: Record<string, ChipDef>, volts = CHECK_VOLTS, button = false) {
  const io = gateIo(level);
  const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const links: [Endpoint, Endpoint][] = [
    [plus, pin(io.vcc)],
    [minus, pin(io.gnd)],
    [pin(io.outputs[0]), { comp: "RL", pin: 0 }],
    [{ comp: "RL", pin: 1 }, minus],
  ];
  const components: Component[] = [
    { id: "G1", type: "psu", volts, amps: 1, on: true, placement: free },
    u,
    { id: "RL", type: "resistor", variant: "tht", ohms: 100_000, smdSize: "0805", placement: free },
  ];
  if (button) {
    // Кнопка между входом и общим: отпущена — вход подтягивает сама микросхема
    components.push({ id: "SB1", type: "switch", closed: false, placement: free });
    links.push([{ comp: "SB1", pin: 0 }, pin(io.inputs[0])], [{ comp: "SB1", pin: 1 }, minus]);
  } else if (io.inputs.length) {
    components.push({ id: "G2", type: "psu", volts: 0, amps: 1, on: true, placement: free });
    links.push([{ comp: "G2", pin: 1 }, pin(io.inputs[0])], [{ comp: "G2", pin: 0 }, minus]);
  }
  const scene: Scene = { components, wires: links.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: { ...chips, [def.id]: def } };
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  const burnt = new Set<string>();
  const out = () => (sim.solution.voltage.get(pinNode(u, io.outputs[0] - 1)) ?? 0) - (sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0);
  const step = (dt: number) => {
    for (const c of sim.step(dt)) if (c.id.startsWith("U1/")) burnt.add(c.id.slice(3));
    for (const c of sim.parts) {
      const limit = heatThreshold(c);
      if (c.id.startsWith("U1/") && limit && sim.overload(c) > limit) burnt.add(c.id.slice(3));
    }
  };
  return { sim, scene, out, step, burnt };
}

/** Пороги по даташиту 74LVC1G14 (4,5–5,5 В), В: VT+, VT−, наименьший гистерезис. */
export const SCHMITT_LIMITS = { up: [2.2, 3.4], down: [1.4, 2.4], hyst: 0.5 } as const;

/**
 * Пороги входа: вход плавно поднимают от 0 до питания и опускают обратно шагами 0,05 В; где выход
 * переключился — там и порог. undefined — не переключился.
 */
export function thresholds(def: ChipDef, level: Level, chips: Record<string, ChipDef>, volts = CHECK_VOLTS) {
  const b = bench(def, level, chips, volts);
  const g2 = b.scene.components.find((c) => c.id === "G2") as Extract<Component, { type: "psu" }>;
  const at = (v: number) => {
    g2.volts = v;
    b.sim.solve();
    b.step(0.01);
    return b.out() > volts / 2;
  };
  const n = Math.round(volts / 0.05);
  const start = at(0);
  let up: number | undefined, down: number | undefined;
  for (let i = 1; i <= n; i++) if (up === undefined && at(i * 0.05) !== start) up = i * 0.05;
  const top = at(volts);
  for (let i = n - 1; i >= 0; i--) if (down === undefined && at(i * 0.05) !== top) down = i * 0.05;
  return { up, down, burnt: [...b.burnt] };
}

/** Проверка порогов триггера Шмитта: шаги, как у уроков. */
function sweepSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const { up, down, burnt } = thresholds(def, level, chips);
  const L = SCHMITT_LIMITS;
  const v = (x: number | undefined) => (x === undefined ? "не переключился" : formatSI(x, "В"));
  const within = (x: number | undefined, [a, b]: readonly number[]) => x !== undefined && x >= a && x <= b;
  const h = up !== undefined && down !== undefined ? up - down : undefined;
  return [
    { text: `Вход растёт — выход переключается при ${L.up[0]}–${L.up[1]} В (VT+): сейчас ${v(up)}`.replace(/\./g, ","), ok: within(up, L.up) },
    { text: `Вход падает — при ${L.down[0]}–${L.down[1]} В (VT−): сейчас ${v(down)}`.replace(/\./g, ","), ok: within(down, L.down) },
    { text: `Гистерезис VT+ − VT− не меньше ${formatSI(L.hyst, "В")}: сейчас ${h === undefined ? "—" : formatSI(h, "В")}`, ok: h !== undefined && h >= L.hyst },
    { text: burnt.length ? `Ничего не сгорело — а сейчас: ${burnt.join(", ")}` : "Ничего не сгорело", ok: !burnt.length },
  ];
}

/** Период генератора, с (по фронтам через половину питания), доля времени в единице и размах. */
export function oscillation(def: ChipDef, level: Level, chips: Record<string, ChipDef>, seconds = 6) {
  const b = bench(def, level, chips);
  const dt = 0.005;
  const vs: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    b.step(dt);
    vs.push(b.out());
  }
  const tail = vs.slice(Math.round(1 / dt));
  const mid = CHECK_VOLTS / 2;
  const rises: number[] = [];
  for (let i = 1; i < tail.length; i++) if (tail[i - 1] < mid && tail[i] >= mid) rises.push(i * dt);
  const period = rises.length >= 2 ? (rises.at(-1)! - rises[0]) / (rises.length - 1) : 0;
  const span = rises.length >= 2 ? tail.slice(Math.round(rises[0] / dt), Math.round(rises.at(-1)! / dt)) : tail;
  const duty = span.length ? span.filter((v) => v >= mid).length / span.length : 0;
  return { period, duty, lo: Math.min(...tail), hi: Math.max(...tail), burnt: [...b.burnt] };
}

/**
 * Дребезг контактов, мс от нажатия (отпускания): моменты, когда контакт меняет состояние. Нажатие —
 * замкнулся, через 0,3 мс разомкнулся… с 3,2 мс замкнут; отпускание — с 1,7 мс разомкнут.
 */
export const BOUNCE = { press: [0, 0.3, 0.8, 1.2, 2.0, 2.3, 3.2], release: [0, 0.4, 0.6, 1.5, 1.7] };
/** Сценарий проверки, мс: кнопка отпущена, нажатие, отпускание, импульс 1 мс, конец. */
export const BOUNCE_AT = { press: 150, release: 400, glitch: 650, end: 750 };

/** Замкнута ли кнопка в момент t (мс) сценария проверки дребезга. */
export function buttonClosed(t: number): boolean {
  const phase = (from: number, marks: number[], first: boolean) => {
    const k = marks.filter((m) => t - from >= m).length;
    return k % 2 === 1 ? first : !first;
  };
  if (t < BOUNCE_AT.press) return false;
  if (t < BOUNCE_AT.release) return phase(BOUNCE_AT.press, BOUNCE.press, true);
  if (t < BOUNCE_AT.glitch) return phase(BOUNCE_AT.release, BOUNCE.release, false);
  return t < BOUNCE_AT.glitch + 1;
}

/**
 * Прогнать сценарий дребезга: какой выход до нажатия и когда (мс) он переключался —
 * с гистерезисом: ноль ниже 1,5 В, единица выше 3,5 В.
 */
export function bounceRun(def: ChipDef, level: Level, chips: Record<string, ChipDef>) {
  const b = bench(def, level, chips, CHECK_VOLTS, true);
  const sw = b.scene.components.find((c) => c.id === "SB1") as Extract<Component, { type: "switch" }>;
  // Шаг 0,1 мс там, где контакт дребезжит, и 0,5 мс в остальное время
  const fine = (t: number) => [BOUNCE_AT.press, BOUNCE_AT.release, BOUNCE_AT.glitch].some((a) => t >= a - 0.5 && t < a + 5);
  let state: boolean | undefined;
  let initial: boolean | undefined;
  const edges: { t: number; high: boolean }[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let t = 0, dt = 0.1; t < BOUNCE_AT.end; t += dt) {
    dt = fine(t) ? 0.1 : 0.5;
    sw.closed = buttonClosed(t);
    b.step(dt / 1000);
    const v = b.out();
    const now = v >= 3.5 ? true : v <= 1.5 ? false : state;
    if (t >= BOUNCE_AT.press - 20) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (t < BOUNCE_AT.press) {
      state = now;
      initial = now;
      continue;
    }
    if (now !== undefined && now !== state) edges.push({ t, high: now });
    state = now;
  }
  return { initial, edges, lo, hi, burnt: [...b.burnt] };
}

/** Проверка подавителя дребезга: шаги, как у генератора. */
function bounceSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const r = bounceRun(def, level, chips);
  const [min, max] = level.delay ?? [0, 80];
  const within = (from: number, to: number) => r.edges.filter((e) => e.t >= from && e.t < to);
  const press = within(BOUNCE_AT.press, BOUNCE_AT.release);
  const release = within(BOUNCE_AT.release, BOUNCE_AT.glitch);
  const glitch = within(BOUNCE_AT.glitch, BOUNCE_AT.end);
  const ms = (x: number) => `${String(Math.round(x * 10) / 10).replace(".", ",")} мс`;
  const once = (es: typeof press, high: boolean, at: number, what: string) => {
    const ok = es.length === 1 && es[0].high === high && es[0].t - at >= min && es[0].t - at <= max;
    const now = !es.length ? "выход не переключился" : es.length > 1 ? `переключился ${es.length} раз` : es[0].high !== high ? "ушёл не туда" : `через ${ms(es[0].t - at)}`;
    return { text: `${what}: выход один раз уходит в ${high ? "единицу" : "ноль"} через ${min ? `${min}–` : "не больше "}${max} мс — сейчас ${now}`, ok };
  };
  return [
    { text: `Кнопка отпущена: на выходе единица — сейчас ${r.initial === undefined ? "ни то ни сё" : r.initial ? "единица" : "ноль"}`, ok: r.initial === true },
    once(press, false, BOUNCE_AT.press, "Нажатие с дребезгом"),
    once(release, true, BOUNCE_AT.release, "Отпускание с дребезгом"),
    { text: `Импульс 1 мс — помеха: выход не меняется${glitch.length ? ` — а он переключился ${glitch.length} раз` : ""}`, ok: !glitch.length },
    { text: `Уровни чистые: ноль не выше 1,5 В, единица не ниже 3,5 В — сейчас ${formatSI(r.lo, "В")} … ${formatSI(r.hi, "В")}`, ok: r.lo <= 1.5 && r.hi >= 3.5 },
    { text: r.burnt.length ? `Ничего не сгорело — а сейчас: ${r.burnt.join(", ")}` : "Ничего не сгорело", ok: !r.burnt.length },
  ];
}

/** Проверка генератора: период, скважность, размах. */
function oscSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const o = oscillation(def, level, chips);
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return [
    { text: o.period ? `Генерирует: период 0,5–2 с — сейчас ${formatSI(o.period, "с")}` : "Генерирует: выход сам меняется то в ноль, то в единицу", ok: o.period >= 0.5 && o.period <= 2 },
    { text: `В единице 30–70 % времени — сейчас ${o.period ? pct(o.duty) : "—"}`, ok: !!o.period && o.duty >= 0.3 && o.duty <= 0.7 },
    { text: `Размах: ноль не выше 1,5 В, единица не ниже 3,5 В — сейчас ${formatSI(o.lo, "В")} … ${formatSI(o.hi, "В")}`, ok: o.lo <= 1.5 && o.hi >= 3.5 },
    { text: o.burnt.length ? `Ничего не сгорело — а сейчас: ${o.burnt.join(", ")}` : "Ничего не сгорело", ok: !o.burnt.length },
  ];
}

/** Проверить сборку уровня: корпус, набор, таблица истинности. */
export function checkLevel(level: Level, scene: Scene, chips: Record<string, ChipDef>, id = `career:${level.id}`): CheckResult {
  const problems = [...packageProblems(scene), ...kitProblems(level, scene)];
  if (problems.length) return { ok: false, problems, rows: [] };
  const def = packageChip(scene, level.part, id);
  def.scene.chips = { ...chipsUsed(scene), ...(scene.chips ?? {}) };
  if (level.check === "osc" || level.check === "bounce") {
    const all = { ...chips, ...def.scene.chips };
    const steps = level.check === "osc" ? oscSteps(def, level, all) : bounceSteps(def, level, all);
    const ok = steps.every((x) => x.ok);
    return ok
      ? { ok, problems: [], rows: [], steps, def, metrics: measure(scene, [], def, all) }
      : { ok, problems: [`${FUNC_NAMES[level.func]} работает не так: смотрите шаги с ✗.`], rows: [], steps };
  }
  const rows = truthTable(def, level, { ...chips, ...def.scene.chips });
  const steps = level.check === "sweep" && rows.every((r) => r.ok) ? sweepSteps(def, level, { ...chips, ...def.scene.chips }) : undefined;
  const ok = rows.every((r) => r.ok) && (steps ?? []).every((x) => x.ok);
  if (!ok)
    return rows.every((r) => r.ok)
      ? { ok, problems: [`${FUNC_NAMES[level.func]}: таблица сходится, а пороги — нет: смотрите шаги с ✗.`], rows, steps }
      : { ok, problems: [`${FUNC_NAMES[level.func]} работает не так: смотрите строки с ✗.`], rows, diagnosis: diagnose(level, def, rows) };
  const all = { ...chips, ...def.scene.chips };
  const sweep = supplySweep(def, level, all, rows);
  const pt = pointFromRows(level, rows, CHECK_VOLTS, truthTable(def, level, all, CHECK_VOLTS, HEAVY_LOAD));
  const metrics = { ...measure(scene, rows, def, all), vmin: sweep.at(-1)!.volts, rOut: Math.max(...pt.rHigh, ...pt.rLow) };
  return { ok, problems: [], rows, def, metrics, ...(steps ? { steps } : {}) };
}

/**
 * Что проверить, когда таблица не сошлась: симптомы словами — неподключённые выводы, сгоревшее,
 * куда тянется выход в неверных строках. Как собрать — не говорит.
 */
export function diagnose(level: Level, def: ChipDef, rows: CheckRow[]): string[] {
  const out: string[] = [];
  const io = gateIo(level);
  const pinName = (n: number) => `${n} ${level.names[n - 1] || PIN_ROLES[level.roles[n - 1]].name}`;
  // Выводы, от которых внутри ничего не идёт
  const inside = new Set(def.nets.filter((n) => n.members.length).flatMap((n) => n.pins ?? []));
  const loose = [...io.inputs, ...io.outputs, io.vcc, io.gnd].sort((x, y) => x - y).filter((n) => !inside.has(n));
  if (loose.length) out.push(`${loose.length > 1 ? "Выводы" : "Вывод"} ${loose.map(pinName).join(", ")} ни к чему внутри не ${loose.length > 1 ? "подключены" : "подключён"}.`);
  const burnt = [...new Set(rows.flatMap((r) => r.burned))];
  if (burnt.length) out.push(`При проверке сгорело или перегружено сверх номинала: ${burnt.join(", ")}. Где-то течёт слишком большой ток — посмотрите, откуда и куда.`);
  const names = io.inputs.map((p) => level.names[p - 1] || `вывод ${p}`);
  const outNames = io.outputs.map((p) => level.names[p - 1] || `вывод ${p}`);
  const many = io.outputs.length > 1;
  const cases: string[] = [];
  for (const r of rows) {
    if (r.ok || r.burned.length) continue;
    const inputs = r.inputs.map((b, i) => `${names[i]} = ${b ? 1 : 0}`).join(", ");
    const when = r.step ? `шаге ${r.step} (${inputs})` : inputs;
    r.expected.forEach((want, k) => {
      if (r.each[k]) return;
      const v = formatSI(r.volts[k], "В");
      const what = many ? `выход ${outNames[k]}` : "выход";
      const got = r.floating[k] && level.drive
        ? `${what} под нагрузкой ${formatSI(level.drive, "А")} проседает до ${v}: он держит уровень, но слишком слабо — не хватает тока`
        : r.floating[k]
        ? `${what} ни за что не держится: куда тянет нагрузка, туда и идёт`
        : isLow(r.volts[k], CHECK_VOLTS)
          ? `${what} прижат к общему (${v})`
          : isHigh(r.volts[k], CHECK_VOLTS)
            ? `${what} у питания (${v})`
            : `${what} висит посередине (${v}) — его никто уверенно не тянет или тянут сразу в обе стороны`;
      cases.push(`${r.step ? "На" : "При"} ${when} ${many ? `на ${outNames[k]} ` : ""}нужен ${want ? "единица" : "ноль"}, а ${got}.`.replace("нужен единица", "нужна единица"));
    });
  }
  // У большой микросхемы неверных случаев может быть десятки: сначала — какие выходы и сколько раз
  if (cases.length > 6) {
    const wrong = io.outputs.map((_, k) => rows.filter((r) => !r.burned.length && !r.each[k]).length);
    const list = outNames.map((n, k) => (wrong[k] ? `${n} — в ${plural(wrong[k], "наборе", "наборах", "наборах")}` : "")).filter(Boolean);
    out.push(`Неверные выходы: ${list.join(", ")} (из ${rows.length} наборов). Первые случаи:`);
    out.push(...cases.slice(0, 4), `…и ещё ${cases.length - 4}.`);
  } else out.push(...cases);
  return out;
}

/** Строка таблицы для людей: «A=1 B=0 → 4,98 В». */
export const rowText = (r: CheckRow) => `${r.inputs.map((b) => (b ? 1 : 0)).join(" ")} → ${r.volts.map((v) => formatSI(v, "В")).join(", ")}`;

// ─── Модели проверенных микросхем ────────────────────────────────────────────

/** Уровень, из которого микросхема: «career:xor», «ref:xor» → уровень xor. */
export function chipLevel(defId: string): Level | undefined {
  const m = defId.match(/^(?:career|ref):(.+)$/);
  return m ? LEVELS.find((l) => l.id === m[1]) : undefined;
}

/**
 * Микросхемы для мастерской и песочницы: без учебных промежуточных и по одной на обозначение
 * (74LVC1G08 из И-НЕ и из ИЛИ-НЕ снаружи одинаковые — берётся первая).
 */
export function publicChips(defs: ChipDef[]): ChipDef[] {
  const seen = new Set<string>();
  return defs.filter((d) => {
    const level = chipLevel(d.id);
    if (level?.intermediate || (level && seen.has(d.name))) return false;
    seen.add(d.name);
    return true;
  });
}

/** Параметры моделей по описанию и его версии; null — микросхема не прошла, модели нет. */
const models = new Map<string, ChipModel | null>();
const measuring = new Set<string>();

/** Напряжения питания, при которых снимают параметры и ищут наименьшее рабочее, В — по убыванию. */
export const SUPPLY_STEPS = [5, 4, 3.3, 2.5, 2];

/**
 * Наименьшее питание, при котором работают все проверенные микросхемы внутри def (у каждой своя
 * модель со своим диапазоном), В; 0 — ограничений нет. Ниже него проверять сборку нет смысла.
 */
function innerVmin(def: ChipDef, scene: Scene): number {
  const s: Scene = { components: [], wires: [], chips: { ...(scene.chips ?? {}), ...(def.scene.chips ?? {}) } };
  let v = 0;
  for (const c of def.parts) {
    if (c.type !== "chip") continue;
    const d = s.chips![c.def] ?? chipsUsed({ components: [c], wires: [], chips: s.chips })[c.def];
    const m = d ? chipModel(d, s) : undefined;
    if (m) v = Math.max(v, m.vmin);
  }
  return v;
}

/**
 * Прогнать таблицу при питании от 5 В вниз, пока микросхема работает (и пока хватает внутренним);
 * вернуть строки при каждом рабочем напряжении, по убыванию. Пусто — не работает и при 5 В.
 */
export function supplySweep(def: ChipDef, level: Level, chips: Record<string, ChipDef>, first?: CheckRow[]): { volts: number; rows: CheckRow[] }[] {
  const out: { volts: number; rows: CheckRow[] }[] = [];
  const floor = innerVmin(def, { components: [], wires: [], chips });
  for (const volts of SUPPLY_STEPS) {
    if (volts < 0.95 * floor) break;
    const rows = volts === CHECK_VOLTS && first ? first : truthTable(def, level, chips, volts);
    if (!rows.every((r) => r.ok)) break;
    out.push({ volts, rows });
  }
  return out;
}

/**
 * Модель микросхемы из карьеры: прогнать её таблицу истинности по транзисторам (вложенные — уже
 * моделями) при питании от 5 В вниз, пока работает, и снять выходные и входные сопротивления и ток
 * покоя при каждом напряжении. Если не проходит и при 5 В, модели нет — такая микросхема считается
 * целиком, со всеми своими ошибками.
 */
export function characterize(def: ChipDef, scene: Scene): ChipModel | undefined {
  const level = chipLevel(def.id);
  // Генератор моделью не описать: у него нет таблицы — считается целиком
  // Генератор и подавитель дребезга живут временем (RC) — модель без времени их не заменит
  if (!level || def.pins !== level.roles.length || level.check === "osc" || level.check === "bounce") return undefined;
  const key = `${def.id}@${def.updatedAt}`;
  const known = models.get(key);
  if (known !== undefined) return known ?? undefined;
  if (measuring.has(key)) return undefined;
  measuring.add(key);
  let model: ChipModel | undefined;
  try {
    const sweep = supplySweep(def, level, { ...(scene.chips ?? {}), ...(def.scene.chips ?? {}) });
    if (sweep.length) {
      const io = gateIo(level);
      const chipsAll = { ...(scene.chips ?? {}), ...(def.scene.chips ?? {}) };
      const points = sweep.map((s) => pointFromRows(level, s.rows, s.volts, truthTable(def, level, chipsAll, s.volts, HEAVY_LOAD))).reverse();
      model = {
        inputs: io.inputs,
        outputs: io.outputs,
        vcc: io.vcc,
        gnd: io.gnd,
        // Схема с памятью: что хранит — из прошлого состояния (или по выходам), дальше — по seqNext
        logic: SEQUENTIAL.includes(level.func)
          ? (bits, prev) => seqOuts(level.func, seqNext(level.func, prev ? (prev.state ?? seqState(level.func, prev.outputs)) : 0, prev?.inputs, bits), bits)
          : (bits) => truth(level.func, bits),
        ...(SEQUENTIAL.includes(level.func)
          ? { state: (bits: boolean[], prev?: ModelState) => seqNext(level.func, prev ? (prev.state ?? seqState(level.func, prev.outputs)) : 0, prev?.inputs, bits) }
          : {}),
        points,
        vmin: points[0].volts,
        vmax: 1.1 * CHECK_VOLTS,
        ...(def.id.startsWith("ref:") ? { absMax: level.absMax ?? REF_ABS_MAX } : {}),
        ...hysteresis(def, level, chipsAll),
      };
    }
  } finally {
    measuring.delete(key);
  }
  models.set(key, model ?? null);
  return model;
}

/** Пороги триггера Шмитта для модели — доли питания, снятые при 5 В. */
function hysteresis(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { hyst?: [number, number] } {
  if (level.check !== "sweep") return {};
  const { up, down } = thresholds(def, level, chips);
  return up !== undefined && down !== undefined && up > down ? { hyst: [down / CHECK_VOLTS, up / CHECK_VOLTS] } : {};
}

/** Тяжёлая нагрузка для второго замера выхода, Ом: по двум замерам видно, как выход проседает под током. */
const HEAVY_LOAD = 1000;

/**
 * Параметры модели по строкам проверки при питании V (нагрузка тянула против нужного уровня) и по
 * тем же строкам с тяжёлой нагрузкой HEAVY_LOAD: выход — источник, U = U0 ∓ I·R. Два замера
 * отделяют «напряжение без нагрузки» от сопротивления: у насыщенного транзистора РТЛ ноль —
 * 0,05 В почти при любом токе, а не «резистор 1 кОм», как вышло бы по одному лёгкому замеру.
 */
export function pointFromRows(level: Level, rows: CheckRow[], V: number, heavy: CheckRow[]): ModelPoint {
  const io = gateIo(level);
  const R1 = loadOhms(level), R2 = HEAVY_LOAD;
  const avg = (xs: number[], empty: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : empty);
  const clamp = (r: number) => Math.min(MODEL_OFF, Math.max(0.5, r));
  const fit = (k: number, high: boolean) => {
    const pairs = rows.map((r, i) => [r, heavy[i]] as const).filter(([r]) => r.expected[k] === high);
    // Единица: нагрузка на общий, ток I = U/R, U = V − d − I·R. Ноль: к питанию, I = (V − U)/R, U = d + I·R
    const amps = (u: number, rl: number) => (high ? u : V - u) / rl;
    const rs = pairs.map(([a, b]) => {
      const i1 = amps(a.volts[k], R1), i2 = amps(b.volts[k], R2);
      return Math.abs(i2 - i1) > 1e-9 ? Math.abs(a.volts[k] - b.volts[k]) / Math.abs(i2 - i1) : MODEL_OFF;
    });
    const r = clamp(avg(rs, 10));
    const ds = pairs.map(([a]) => (high ? V - a.volts[k] - amps(a.volts[k], R1) * r : a.volts[k] - amps(a.volts[k], R1) * r));
    return { r, d: Math.min(V / 2, Math.max(0, avg(ds, 0))) };
  };
  const hi = io.outputs.map((_, k) => fit(k, true));
  const lo = io.outputs.map((_, k) => fit(k, false));
  const rIn = io.inputs.map((_, i) => {
    const amps = avg(rows.filter((r) => r.inputs[i]).map((r) => r.inAmps[i]), 0);
    return amps > 1e-9 ? clamp(V / amps) : MODEL_OFF;
  });
  // Ток покоя: от питания без токов входов (они тоже идут от «плюса» стенда)
  const iq = avg(rows.map((r) => Math.max(0, r.amps - r.inputs.reduce((sum, b, i) => sum + (b ? Math.max(0, r.inAmps[i]) : 0), 0))), 0);
  return { volts: V, rHigh: hi.map((x) => x.r), rLow: lo.map((x) => x.r), dHigh: hi.map((x) => x.d), dLow: lo.map((x) => x.d), rIn, iq };
}

setModelSource(characterize);
