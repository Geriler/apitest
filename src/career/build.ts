/**
 * Карьера без интерфейса: стол уровня, эталонные компоненты, набор деталей и проверка по таблице
 * истинности. Без DOM — годится и для приложения, и для тестов.
 */

import { BOARDS, applyBoards, newChipBoard, type BoardSpec } from "../model/breadboard";
import { mosfetPin, type Chip, type ChipDef, type Component, type Endpoint, type MosfetRole, type Scene } from "../model/types";
import { packageChip, packageProblems, chipInner } from "../chips/package";
import { chipsUsed } from "../chips/registry";
import { countChip } from "../chips/count";
import { Simulation, heatThreshold, pinNode } from "../sim/simulation";
import { formatSI } from "../sim/resistorCodes";
import { FUNC_NAMES, LEVELS, gateIo, kitLabel, truth, type KitItem, type Level, type LogicFunc } from "./levels";
import { PIN_ROLES } from "../chips/roles";

/** Напряжение питания при проверке, В. */
export const CHECK_VOLTS = 5;

/** Корпус уровня (SOT-23-5 или DIP) с заданными выводами; менять их нельзя. */
export function levelCase(level: Level): BoardSpec {
  const pkg = level.package ?? "SOT-23-5";
  const b = newChipBoard(level.roles.length, 0, 0, "K1", pkg);
  return { ...b, roles: [...level.roles], names: [...level.names], label: level.part, fixed: true, ...(level.room ? { room: level.room } : {}) };
}

/** Стол уровня: только корпус. */
export function levelScene(level: Level): Scene {
  return { components: [], wires: [], boards: [levelCase(level)], career: { level: level.id } };
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
  const scene = levelScene(level);
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
    else if (p.kind === "BC547" || p.kind === "BC557") c = { id: p.id, type: "transistor", kind: p.kind, placement };
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
  return kit.findIndex((k) => {
    if (k.part === "mosfet") return c.type === "mosfet" && c.kind === k.kind;
    if (k.part === "bjt") return c.type === "transistor" && c.kind === k.kind;
    if (k.part === "resistor") return c.type === "resistor" && c.ohms === k.ohms;
    if (k.part === "other") return c.type === k.type && Object.entries(k.preset).every(([key, v]) => (c as unknown as Record<string, unknown>)[key] === v || (key === "size" && v === "5mm" && !(c as { size?: string }).size));
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
  inputs: boolean[];
  /** По выходам (в порядке номеров выводов): что нужно и что есть, В. */
  expected: boolean[];
  volts: number[];
  /** Каждый выход отдельно: верен ли. */
  each: boolean[];
  /** Ток от питания в этом состоянии, А. */
  amps: number;
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
export function truthTable(def: ChipDef, level: Level, chips: Record<string, ChipDef>): CheckRow[] {
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
      { id: "G1", type: "psu", volts: CHECK_VOLTS, amps: 1, on: true, placement: { mode: "free", x: 0, z: 0, rot: 0 } },
      u,
      ...loads.map((id): Component => ({ id, type: "resistor", variant: "tht", ohms: 100_000, smdSize: "0805", placement: { mode: "free", x: 0, z: 0, rot: 0 } })),
    ],
    wires: wiring(Array(n).fill(false), io.outputs.map(() => false)),
    boards: [],
    chips: { ...chips, [def.id]: def },
  };
  // Один стенд на всю таблицу, как на столе: входы и нагрузки переключаются, а расчёт продолжается
  // с прошлого состояния — так он сходится в разы быстрее, чем каждый раз с нуля
  const sim = new Simulation(scene);
  const inner = innerParts(def, "U1/", scene.chips!);
  /** Один прогон: переключить стенд и дать схеме установиться. */
  const run = (inputs: boolean[], up: boolean[]) => {
    scene.wires = wiring(inputs, up);
    const burnt = new Set<string>();
    for (const c of sim.step(0.01)) if (c.id.startsWith("U1/")) burnt.add(c.id.slice(3));
    // Сгорание в расчёте копится нагревом за секунды, проверка короче — поэтому перегрузка сверх
    // номинала тоже провал: в жизни такая деталь сгорела бы чуть позже
    for (const c of inner) {
      const limit = heatThreshold(c);
      if (limit && sim.overload(c) > limit) burnt.add(c.id.slice(3));
    }
    const gnd = sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0;
    const volts = io.outputs.map((p) => (sim.solution.voltage.get(pinNode(u, p - 1)) ?? 0) - gnd);
    // Ток от питания без токов нагрузок: то, что потребляет сама микросхема
    const loadAmps = loads.reduce((sum, _, k) => sum + Math.abs(sim.current(scene.components[2 + k])), 0);
    const amps = Math.max(0, Math.abs(sim.current(scene.components[0])) - loadAmps);
    return { volts, amps, burnt };
  };
  for (const inputs of inputVectors(n)) {
    const expected = truth(level.func, inputs);
    const good = (k: number, v: number) => (expected[k] ? isHigh(v, CHECK_VOLTS) : isLow(v, CHECK_VOLTS));
    const first = run(inputs, expected.map((e) => !e));
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
      inputs,
      expected,
      volts: first.volts,
      amps: first.amps,
      burned: [...burnt],
      floating,
      each,
      ok: !burnt.size && each.every(Boolean),
    });
  }
  return rows;
}

/** Детали начинки с обозначениями расчёта («U1/VT1», вложенные — «U1/D1/VT1»). */
function innerParts(def: ChipDef, prefix: string, chips: Record<string, ChipDef>, depth = 0): Component[] {
  return def.parts.flatMap((c) => {
    const id = prefix + c.id;
    if (c.type !== "chip") return [{ ...c, id } as Component];
    const sub = chips[c.def] ?? def.scene.chips?.[c.def];
    return sub && depth < 8 ? innerParts(sub, `${id}/`, chips, depth + 1) : [];
  });
}

/** Проверить сборку уровня: корпус, набор, таблица истинности. */
export function checkLevel(level: Level, scene: Scene, chips: Record<string, ChipDef>, id = `career:${level.id}`): CheckResult {
  const problems = [...packageProblems(scene), ...kitProblems(level, scene)];
  if (problems.length) return { ok: false, problems, rows: [] };
  const def = packageChip(scene, level.part, id);
  def.scene.chips = { ...chipsUsed(scene), ...(scene.chips ?? {}) };
  const rows = truthTable(def, level, { ...chips, ...def.scene.chips });
  const ok = rows.every((r) => r.ok);
  if (!ok) return { ok, problems: [`${FUNC_NAMES[level.func]} работает не так: смотрите строки с ✗.`], rows, diagnosis: diagnose(level, def, rows) };
  return { ok, problems: [], rows, def, metrics: measure(scene, rows, def, { ...chips, ...def.scene.chips }) };
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
  for (const r of rows) {
    if (r.ok || r.burned.length) continue;
    const when = r.inputs.map((b, i) => `${names[i]} = ${b ? 1 : 0}`).join(", ");
    r.expected.forEach((want, k) => {
      if (r.each[k]) return;
      const v = formatSI(r.volts[k], "В");
      const what = many ? `выход ${outNames[k]}` : "выход";
      const got = r.floating[k]
        ? `${what} ни за что не держится: куда тянет нагрузка, туда и идёт`
        : isLow(r.volts[k], CHECK_VOLTS)
          ? `${what} прижат к общему (${v})`
          : isHigh(r.volts[k], CHECK_VOLTS)
            ? `${what} у питания (${v})`
            : `${what} висит посередине (${v}) — его никто уверенно не тянет или тянут сразу в обе стороны`;
      out.push(`При ${when} ${many ? `на ${outNames[k]} ` : ""}нужен ${want ? "единица" : "ноль"}, а ${got}.`.replace("нужен единица", "нужна единица"));
    });
  }
  return out;
}

/** Строка таблицы для людей: «A=1 B=0 → 4,98 В». */
export const rowText = (r: CheckRow) => `${r.inputs.map((b) => (b ? 1 : 0)).join(" ")} → ${r.volts.map((v) => formatSI(v, "В")).join(", ")}`;
