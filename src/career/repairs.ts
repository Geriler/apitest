/**
 * Ремонт: готовые схемы с неисправностью. Снаружи всё целое — показаний деталей не видно
 * (Scene.career.repair), неисправность ищут мультиметром и осциллографом и чинят: заменяют деталь
 * из набора запасных, переставляют, добавляют провод или дорожку. Засчитывается, когда схема
 * заработала, — проверка та же, что у исправной.
 *
 * Неисправности: скрытый обрыв или пробой (Component.fault, трещина дорожки — Trace.fault),
 * не та деталь, ошибка монтажа (перевёрнутый транзистор, обе ножки в одной полосе, забытый провод).
 */

import type { ChipDef, Component, Scene } from "../model/types";
import { HOLE_BY_ID } from "../model/breadboard";
import { blinkerScene, pcbScene } from "../demo";
import { chipsUsed } from "../chips/registry";
import { formatSI } from "../sim/resistorCodes";
import { bench, blinkPeriod, free, ledOk, lessonById, mA, noHurt, of, settle, type Lesson, type LessonStep } from "./lessons";
import { referenceChips } from "./build";
import type { KitItem } from "./levels";

/** Стол ремонта: показаний деталей не видно. */
const repair = (s: Scene): Scene => ({ ...s, career: { ...s.career, repair: true } });

const res = (id: string, ohms: number, holes: string[], extra: Partial<Component> = {}): Component =>
  ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: { mode: "board", holes }, ...extra }) as Component;
const meter = (): Component => ({ id: "P1", type: "meter", mode: "V", placement: free(-18, 14) });
const spare = (ohms: number): KitItem => ({ part: "resistor", ohms, count: 1 });

/** Светодиод с резистором от «Кроны» — как в первом уроке. */
function ledBench(id: string, r1: Component): Scene {
  return repair(
    bench(id, [r1, { id: "HL1", type: "led", color: "red", placement: { mode: "board", holes: ["d7", "d10"] } }, meter()], [
      { id: "W3", a: { hole: "a10" }, b: { hole: "top-10" }, color: "#1b1d20" },
    ]),
  );
}

/** Проверка «светодиод горит нормально и ничего не сгорело». */
function ledCheck(scene: Scene): LessonStep[] {
  const { sim, hurt } = settle(scene);
  const leds = of(scene, "led");
  return [
    ...leds.map((l) => ({ text: `${l.id} горит нормально, 5–25 мА — сейчас ${mA(sim.current(l))}`, ok: ledOk(sim.current(l)) })),
    ...(leds.length ? [] : [{ text: "Светодиод на месте", ok: false }]),
    noHurt(hurt),
  ];
}

/** Транзистор-ключ с кнопкой (как в пятом уроке); vt — как стоит транзистор. */
function switchBench(id: string, vt: Component): Scene {
  return repair(
    bench(
      id,
      [
        { id: "SB1", type: "button", placement: { mode: "board", holes: ["top+3", "b5"] } } as Component,
        res("R1", 22_000, ["c5", "c9"]),
        vt,
        res("R2", 470, ["top+11", "b11"]),
        { id: "HL1", type: "led", color: "green", placement: { mode: "board", holes: ["c11", "c8"] } },
        meter(),
      ],
      [{ id: "W3", a: { hole: "a10" }, b: { hole: "top-10" }, color: "#2f6fd1" }],
    ),
  );
}

function switchCheck(scene: Scene): LessonStep[] {
  const led = of(scene, "led")[0];
  const btn = of(scene, "button")[0];
  if (!led || !btn) return [{ text: "Светодиод и кнопка на месте", ok: false }];
  const off = settle(scene);
  const on = settle(scene, [btn.id]);
  const iOff = Math.abs(off.sim.current(led));
  const iOn = Math.abs(on.sim.current(led));
  return [
    { text: `Кнопка отпущена — светодиод не горит (${mA(iOff)})`, ok: iOff < 0.001 },
    { text: `Кнопка нажата — горит нормально, 5–25 мА (${mA(iOn)})`, ok: ledOk(iOn) },
    noHurt([...new Set([...off.hurt, ...on.hurt])]),
  ];
}

/** Напряжение полосы (отверстия) относительно минуса батареи. */
const holeVolts = (scene: Scene, hole: string) => {
  const { sim } = settle(scene);
  const v = (h: string) => sim.solution.voltage.get(HOLE_BY_ID.get(h)!.node) ?? 0;
  return v(hole) - v("top-1");
};

// ─── Полусумматор из микросхем с тумблерами ─────────────────────────────────

let chips: Record<string, ChipDef> | undefined;
/** Заводские XOR и И со всем, что у них внутри (считаются один раз). */
function adderChips(): Record<string, ChipDef> {
  if (!chips) {
    const refs = Object.fromEntries(referenceChips().map((d) => [d.id, d]));
    const scene: Scene = { components: ["ref:xor", "ref:and"].map((def, i) => ({ id: `X${i}`, type: "chip", def, name: "", package: "SOT-23-5", pins: 5, placement: free(0, 0) }) as Component), wires: [], chips: refs };
    chips = chipsUsed(scene);
  }
  return chips;
}

/**
 * Полусумматор на столе: 74LVC1G86 (сумма S) и 74LVC1G08 (перенос C), входы — тумблеры A и B
 * к +5 В с резисторами 10 кОм на общий, выходы — светодиоды через 330 Ом. Провод от B ко входу
 * И забыт: вход висит.
 */
function adderScene(id: string): Scene {
  const chip = (cid: string, def: string, name: string, x: number): Component =>
    ({ id: cid, type: "chip", def, name, package: "SOT-23-5", pins: 5, placement: free(x, 6) }) as Component;
  const w = (n: number, a: [string, number] | "+" | "-", b: [string, number] | "+" | "-", color = "#2f9e5a") => {
    const ep = (e: typeof a) => (e === "+" ? { comp: "G1", pin: 1 } : e === "-" ? { comp: "G1", pin: 0 } : { comp: e[0], pin: e[1] });
    return { id: `W${n}`, a: ep(a), b: ep(b), color };
  };
  return repair({
    components: [
      { id: "G1", type: "psu", volts: 5, amps: 0.5, on: true, placement: free(-30, 0) },
      { id: "SA1", type: "switch", closed: false, placement: free(-18, -8) } as Component,
      { id: "SA2", type: "switch", closed: false, placement: free(-18, 8) } as Component,
      { id: "RA", type: "resistor", variant: "tht", ohms: 10_000, smdSize: "0805", placement: free(-10, -12) },
      { id: "RB", type: "resistor", variant: "tht", ohms: 10_000, smdSize: "0805", placement: free(-10, 14) },
      chip("D1", "ref:xor", "74LVC1G86", -2),
      chip("D2", "ref:and", "74LVC1G08", 8),
      { id: "R3", type: "resistor", variant: "tht", ohms: 330, smdSize: "0805", placement: free(18, -6) },
      { id: "HL1", type: "led", color: "green", placement: free(26, -6) },
      { id: "R4", type: "resistor", variant: "tht", ohms: 330, smdSize: "0805", placement: free(18, 10) },
      { id: "HL2", type: "led", color: "red", placement: free(26, 10) },
      meter(),
    ],
    wires: [
      // Питание микросхем: 5 — VCC, 3 — GND
      w(1, "+", ["D1", 4], "#c8261f"),
      w(2, "+", ["D2", 4], "#c8261f"),
      w(3, "-", ["D1", 2], "#1b1d20"),
      w(4, "-", ["D2", 2], "#1b1d20"),
      // A: тумблер к плюсу, резистор на общий, в оба вентиля
      w(5, "+", ["SA1", 0], "#c8261f"),
      w(6, ["SA1", 1], ["RA", 0]),
      w(7, ["RA", 1], "-", "#1b1d20"),
      w(8, ["SA1", 1], ["D1", 0]),
      w(9, ["SA1", 1], ["D2", 0]),
      // B: то же, но ко входу И провода нет
      w(10, "+", ["SA2", 0], "#c8261f"),
      w(11, ["SA2", 1], ["RB", 0], "#e3b21c"),
      w(12, ["RB", 1], "-", "#1b1d20"),
      w(13, ["SA2", 1], ["D1", 1], "#e3b21c"),
      // Выходы: S — зелёный, C — красный
      w(14, ["D1", 3], ["R3", 0]),
      w(15, ["R3", 1], ["HL1", 0]),
      w(16, ["HL1", 1], "-", "#1b1d20"),
      w(17, ["D2", 3], ["R4", 0]),
      w(18, ["R4", 1], ["HL2", 0]),
      w(19, ["HL2", 1], "-", "#1b1d20"),
    ],
    boards: [],
    chips: adderChips(),
    career: { lesson: id },
  });
}

function adderCheck(scene: Scene): LessonStep[] {
  const s1 = of(scene, "switch").find((c) => c.id === "SA1");
  const s2 = of(scene, "switch").find((c) => c.id === "SA2");
  const ledS = of(scene, "led").find((c) => c.id === "HL1");
  const ledC = of(scene, "led").find((c) => c.id === "HL2");
  if (!s1 || !s2 || !ledS || !ledC) return [{ text: "Тумблеры SA1, SA2 и светодиоды HL1 (S), HL2 (C) на месте", ok: false }];
  const steps: LessonStep[] = [];
  const hurt = new Set<string>();
  for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]]) {
    const s: Scene = JSON.parse(JSON.stringify(scene));
    for (const c of s.components) if (c.type === "switch") c.closed = c.id === "SA1" ? a : c.id === "SA2" ? b : c.closed;
    const r = settle(s);
    r.hurt.forEach((x) => hurt.add(x));
    const lit = (id: string) => Math.abs(r.sim.current(r.sim.scene.components.find((c) => c.id === id)!)) > 0.001;
    const wantS = a !== b, wantC = a && b;
    const bits = `A = ${a ? 1 : 0}, B = ${b ? 1 : 0}`;
    const say = (on: boolean) => (on ? "горит" : "не горит");
    steps.push({ text: `${bits}: S ${say(wantS)}, C ${say(wantC)} — сейчас S ${say(lit("HL1"))}, C ${say(lit("HL2"))}`, ok: lit("HL1") === wantS && lit("HL2") === wantC });
  }
  return [...steps, noHurt([...hurt])];
}

export const REPAIRS: Lesson[] = [
  {
    id: "fix-led-open",
    repair: true,
    title: "Не горит светодиод",
    about: "Схема из первого урока перестала работать: светодиод не горит, хотя всё на месте и ничего не почернело. Найдите неисправную деталь мультиметром и замените её из набора запасных. Показаний деталей на ремонте не видно — только приборы.",
    hints: [
      "Измерьте напряжение на каждой детали по очереди: щупы — на её выводы. В исправной цепи 9 В делятся между резистором и светодиодом.",
      "Если на детали всё напряжение батареи, а ток по цепи не идёт — внутри неё обрыв.",
    ],
    kit: [spare(470)],
    start: () => ledBench("fix-led-open", res("R1", 470, ["top+6", "b7"], { fault: { open: true } })),
    check: ledCheck,
  },
  {
    id: "fix-led-dim",
    repair: true,
    title: "Светодиод еле светится",
    about: "Светодиод горит, но едва заметно. Детали исправны — дело в другом. Найдите причину и исправьте: в наборе есть запасные.",
    hints: [
      "Измерьте ток светодиода амперметром (в разрыв цепи). Нормальный — 5–25 мА. Что его ограничивает?",
      "Посмотрите на полоски резистора (или в его панель): тот ли там номинал, что нужен для 15 мА от 9 В?",
    ],
    kit: [spare(470)],
    start: () => ledBench("fix-led-dim", res("R1", 47_000, ["top+6", "b7"])),
    check: ledCheck,
  },
  {
    id: "fix-divider",
    repair: true,
    title: "Делитель выдаёт все 9 вольт",
    about: "Два одинаковых резистора по 10 кОм должны делить 9 В пополам: на полосе 8 — около 4,5 В. А там все 9. Резисторы исправны. Найдите ошибку монтажа и исправьте.",
    hints: [
      "Измерьте напряжение на каждом резисторе. На нижнем (R2) — ноль? Тогда ток через него не идёт — или идёт мимо.",
      "Пять отверстий a–e одного столбца макетки соединены между собой. Где стоят обе ножки R2?",
    ],
    kit: [spare(10_000)],
    start: () =>
      repair(
        bench("fix-divider", [res("R1", 10_000, ["top+4", "b8"]), res("R2", 10_000, ["d8", "e8"]), meter()], [
          { id: "W3", a: { hole: "a12" }, b: { hole: "top-12" }, color: "#1b1d20" },
        ]),
      ),
    check(scene) {
      const v = holeVolts(scene, "c8");
      return [{ text: `На полосе 8 — 4,3–4,7 В (половина батареи), сейчас ${formatSI(v, "В")}`, ok: v >= 4.3 && v <= 4.7 }, noHurt(settle(scene).hurt)];
    },
  },
  {
    id: "fix-switch-short",
    repair: true,
    title: "Ключ не выключается",
    about: "Транзисторный ключ из пятого урока: светодиод должен гореть, только пока нажата кнопка. А он горит всегда. Найдите неисправную деталь и замените её.",
    hints: [
      "Отпустите кнопку и измерьте напряжение между коллектором и эмиттером транзистора. У закрытого там почти всё напряжение, у открытого — доли вольта.",
      "Если база без тока, а коллектор–эмиттер всё равно почти ноль вольт — транзистор пробит.",
    ],
    kit: [{ part: "bjt", kind: "BC547", count: 1 }],
    start: () => switchBench("fix-switch-short", { id: "VT1", type: "transistor", kind: "BC547", placement: { mode: "board", holes: ["e8", "e9", "e10"] }, fault: { short: [0, 2] } }),
    check: switchCheck,
  },
  {
    id: "fix-switch-reversed",
    repair: true,
    title: "Ключ еле открывается",
    about: "Тот же ключ, собранный заново: теперь при нажатой кнопке светодиод светит слабо. Все детали исправны и те. Найдите ошибку и исправьте.",
    hints: [
      "Сравните, куда подключены выводы транзистора: эмиттер должен быть на минусе, коллектор — у светодиода. Выводы BC547 со стороны плоской грани: C-B-E.",
      "Если перепутать коллектор и эмиттер, транзистор всё ещё немного работает — но усиливает в десятки раз слабее.",
    ],
    kit: [{ part: "bjt", kind: "BC547", count: 1 }],
    start: () => switchBench("fix-switch-reversed", { id: "VT1", type: "transistor", kind: "BC547", placement: { mode: "board", holes: ["e10", "e9", "e8"] } }),
    check: switchCheck,
  },
  {
    id: "fix-pcb-crack",
    repair: true,
    title: "Печатная плата: не горит красный",
    about: "На плате два одинаковых светодиода с резисторами. Зелёный горит, красный — нет. Детали исправны, дорожки на вид целые. Найдите место и почините — дорожкой (T) или проводом.",
    hints: [
      "Пройдите вольтметром по цепи красного светодиода от плюса: где напряжение перестаёт быть таким, как ожидается?",
      "Если на двух концах одной дорожки разное напряжение, а ток по ней не идёт — в меди трещина. Её обходят перемычкой.",
    ],
    kit: [],
    start() {
      const s = pcbScene();
      for (const t of s.traces ?? []) if (t.a === "pD8" && t.b === "pE8") t.fault = { open: true };
      s.components.push({ id: "P1", type: "meter", mode: "V", placement: free(-18, 32) });
      return repair({ ...s, career: { lesson: "fix-pcb-crack" } });
    },
    check: ledCheck,
  },
  {
    id: "fix-adder",
    repair: true,
    title: "Полусумматор не переносит",
    about: "Полусумматор на заводских микросхемах: тумблеры — входы A и B, зелёный светодиод — сумма S, красный — перенос C. Сумма работает, а перенос не загорается никогда. Микросхемы исправны.",
    hints: [
      "Включите оба тумблера и измерьте напряжение на обоих входах микросхемы И (выводы 1 и 2 относительно общего, вывод 3).",
      "Вход, который ни к чему не подключён, «висит»: микросхема читает на нём что попало — здесь ноль. Вход КМОП всегда куда-то подключают.",
    ],
    kit: [],
    start: () => adderScene("fix-adder"),
    check: adderCheck,
  },
  {
    id: "fix-blinker",
    repair: true,
    title: "Мигалка не мигает",
    about: "Мигалка на двух транзисторах: светодиоды должны гореть по очереди. А они не мигают. Одна деталь неисправна — найдите её осциллографом и мультиметром и замените.",
    hints: [
      "Посмотрите осциллографом на коллекторы обоих транзисторов (общий — на минус). Что должно было раскачивать схему?",
      "Ритм задают конденсаторы: заряжаются через резисторы и толкают базы. Пробитый конденсатор — это просто провод: измерьте напряжение на каждом.",
    ],
    kit: [{ part: "other", type: "capacitor", tool: "cap", preset: { variant: "electrolytic", electrolyticUF: 100, electrolyticV: 16 }, match: { variant: "electrolytic", uF: 100 }, label: "конденсатор 100 мкФ", count: 1 }],
    start() {
      const s = blinkerScene();
      for (const c of s.components) if (c.id === "C1") c.fault = { short: [0, 1] };
      s.components.push({ id: "P1", type: "scope", timeDiv: 0.5, voltsDiv: [0, 0], placement: free(-18, 14) } as Component, { id: "P2", type: "meter", mode: "V", placement: free(-30, 14) });
      return repair({ ...s, boards: [{ id: "BB1", kind: "breadboard", x: 0, z: 0 }], career: { lesson: "fix-blinker" } });
    },
    check(scene) {
      const period = blinkPeriod(scene);
      return [{ text: period ? `Мигает: период ${formatSI(period, "с")}` : "Светодиоды мигают по очереди", ok: period > 0.3 && period < 5 }, noHurt(settle(scene).hurt)];
    },
  },
];

/** Урок введения или ремонта по id. */
export const stageById = (id: string): Lesson | undefined => lessonById(id) ?? REPAIRS.find((l) => l.id === id);

