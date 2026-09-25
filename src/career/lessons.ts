/**
 * Введение карьеры: уроки перед вентилями — первая цепь, мультиметр, делитель, транзистор-ключ,
 * осциллограф. Проверка — по самому столу: что показывает прибор, какой ток у светодиода,
 * куда подключены щупы. Уроки рекомендованы, но не обязательны.
 */

import type { Component, Scene } from "../model/types";
import { Simulation, heatThreshold, pinNode } from "../sim/simulation";
import { formatSI } from "../sim/resistorCodes";
import { blinkerScene } from "../demo";
import { buildNetlist } from "../view/schematic";
import type { KitItem } from "./levels";

export interface LessonStep {
  text: string;
  ok: boolean;
}

export interface Lesson {
  id: string;
  /** Урок-ремонт: стол с неисправностью, показаний деталей не видно (Scene.career.repair). */
  repair?: true;
  title: string;
  about: string;
  hints: [string, string];
  kit: KitItem[];
  /** Стол, с которого урок начинается. */
  start(): Scene;
  /** Шаги проверки: что сделано, что нет (без решения). */
  check(scene: Scene): LessonStep[];
}

export const free = (x: number, z: number) => ({ mode: "free" as const, x, z, rot: 0 });

/** Макетка и «Крона» 9 В, подключённая к верхним шинам (плюс — к «+», минус — к «−»). */
export function bench(id: string, extra: Component[] = [], wires: Scene["wires"] = []): Scene {
  return {
    components: [{ id: "GB1", type: "battery", kind: "9V", placement: free(-26, -4) }, ...extra],
    wires: [
      { id: "W1", a: { comp: "GB1", pin: 0 }, b: { hole: "top-1" }, color: "#1b1d20" },
      { id: "W2", a: { comp: "GB1", pin: 1 }, b: { hole: "top+1" }, color: "#c8261f" },
      ...wires,
    ],
    boards: [{ id: "BB1", kind: "breadboard", x: 0, z: 0 }],
    career: { lesson: id },
  };
}

/** Готовая цепь: плюс → 470 Ом → светодиод → минус. */
function litLed(id: string, meterMode: "ohm" | "V"): Scene {
  return bench(
    id,
    [
      { id: "R1", type: "resistor", variant: "tht", ohms: 470, smdSize: "0805", placement: { mode: "board", holes: ["top+6", "b7"] } },
      { id: "HL1", type: "led", color: "red", placement: { mode: "board", holes: ["d7", "d10"] } },
      { id: "P1", type: "meter", mode: meterMode, placement: free(-18, 12) },
    ],
    [{ id: "W3", a: { hole: "a10" }, b: { hole: "top-10" }, color: "#1b1d20" }],
  );
}

/** Расчёт стола: состояние через секунду; что сгорело или перегружено сверх номинала. */
export function settle(scene: Scene, held: string[] = []): { sim: Simulation; hurt: string[] } {
  const sim = new Simulation(JSON.parse(JSON.stringify(scene)) as Scene);
  for (const id of held) sim.held.add(id);
  const hurt = new Set<string>();
  for (let t = 0; t < 1; t += 0.05) for (const c of sim.step(0.05)) hurt.add(c.id);
  for (const c of sim.scene.components) {
    const limit = heatThreshold(c);
    if (limit && sim.overload(c) > limit) hurt.add(c.id);
  }
  return { sim, hurt: [...hurt] };
}

export const of = <T extends Component["type"]>(scene: Scene, type: T) => scene.components.filter((c): c is Extract<Component, { type: T }> => c.type === type);
/** Номер цепи вывода детали (одинаковый — соединены). */
const netOf = (scene: Scene) => {
  const { pins } = buildNetlist(scene);
  return (id: string, pin: number) => pins.get(id)?.[pin];
};
/** Показание вольтметра: красный щуп минус чёрный. */
const reading = (sim: Simulation, m: Component) => (sim.solution.voltage.get(pinNode(m, 1)) ?? 0) - (sim.solution.voltage.get(pinNode(m, 0)) ?? 0);
export const mA = (a: number) => formatSI(Math.abs(a), "А");
export const noHurt = (hurt: string[]): LessonStep => ({ text: hurt.length ? `Ничего не сгорело и не перегружено — а сейчас: ${hurt.join(", ")}` : "Ничего не сгорело и не перегружено", ok: !hurt.length });
/** Светодиод горит нормально: 5–25 мА. */
export const ledOk = (a: number) => Math.abs(a) >= 0.005 && Math.abs(a) <= 0.025;

export const LESSONS: Lesson[] = [
  {
    id: "intro-led",
    title: "Первая цепь: зажечь светодиод",
    about: "На столе батарея 9 В, уже подключённая к шинам макетки. Зажгите светодиод так, чтобы он светил нормально (5–25 мА) и не сгорел. Резистор выберите сами — в наборе три разных.",
    hints: [
      "Светодиоду нужно около 2 В, остальное напряжение батареи должно «упасть» на резисторе. Ток через резистор — напряжение на нём, делённое на сопротивление.",
      "(9 − 2) В / 20 мА ≈ 350 Ом. Какой из трёх резисторов ближе, но не меньше? И длинная ножка светодиода — к плюсу.",
    ],
    kit: [
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 1 },
      { part: "resistor", ohms: 100, count: 1 },
      { part: "resistor", ohms: 470, count: 1 },
      { part: "resistor", ohms: 10_000, count: 1 },
    ],
    start: () => bench("intro-led"),
    check(scene) {
      const { sim, hurt } = settle(scene);
      const led = of(scene, "led")[0];
      const a = led ? sim.current(led) : 0;
      return [
        { text: led ? "Светодиод на столе" : "Поставьте светодиод", ok: !!led },
        { text: led ? `Ток светодиода 5–25 мА — сейчас ${mA(a)}` : "Ток светодиода 5–25 мА", ok: !!led && ledOk(a) },
        noHurt(hurt),
      ];
    },
  },
  {
    id: "intro-volts",
    title: "Мультиметр: напряжение",
    about: "Светодиод уже горит. Измерьте мультиметром напряжение на нём: переключите прибор в режим вольтметра и подключите щупы — красный к аноду (+), чёрный к катоду (−).",
    hints: [
      "Вольтметр подключают параллельно: оба щупа — к двум точкам, между которыми хотите узнать напряжение. Цепь при этом не разрывают.",
      "Щуп — это провод от гнезда прибора. Красное гнездо V/Ω/A — к той полосе макетки, где анод светодиода, COM — к полосе катода.",
    ],
    kit: [],
    start: () => litLed("intro-volts", "ohm"),
    check(scene) {
      const { sim } = settle(scene);
      const m = of(scene, "meter")[0];
      const led = of(scene, "led")[0];
      const net = netOf(scene);
      const probes = !!m && !!led && net(m.id, 1) === net(led.id, 0) && net(m.id, 0) === net(led.id, 1);
      const v = m && led ? reading(sim, m) : 0;
      return [
        { text: "Мультиметр в режиме вольтметра (V)", ok: m?.mode === "V" },
        { text: "Красный щуп — на аноде светодиода, чёрный — на катоде", ok: probes },
        { text: `Светодиод горит — ${led ? mA(sim.current(led)) : "его нет"}`, ok: !!led && ledOk(sim.current(led)) },
        { text: probes && m?.mode === "V" ? `Прибор показывает напряжение на светодиоде: ${formatSI(Math.abs(v), "В")}` : "Прибор показывает напряжение на светодиоде", ok: probes && m?.mode === "V" && v > 1.5 && v < 2.5 },
      ];
    },
  },
  {
    id: "intro-amps",
    title: "Мультиметр: ток",
    about: "Теперь измерьте ток светодиода. Амперметр включают в разрыв: ток должен пройти через прибор. Светодиод при этом должен продолжать гореть.",
    hints: [
      "Амперметр — это «кусок провода» с измерителем. Чтобы ток шёл через него, цепь нужно разорвать и вставить прибор в разрыв.",
      "Уберите провод от катода к минусу и замкните этот разрыв прибором: COM — к минусу, гнездо V/Ω/A — к катоду. Режим — мА. Не подключайте амперметр прямо к батарее: это короткое замыкание.",
    ],
    kit: [],
    start: () => litLed("intro-amps", "V"),
    check(scene) {
      const { sim, hurt } = settle(scene);
      const m = of(scene, "meter")[0];
      const led = of(scene, "led")[0];
      const iLed = led ? Math.abs(sim.current(led)) : 0;
      const iM = m ? Math.abs(sim.current(m)) : 0;
      const series = !!m && (m.mode === "mA" || m.mode === "A") && iLed > 0 && Math.abs(iM - iLed) < 0.05 * iLed;
      return [
        { text: "Мультиметр в режиме амперметра (мА или А)", ok: m?.mode === "mA" || m?.mode === "A" },
        { text: `Светодиод горит — ${mA(iLed)}`, ok: ledOk(iLed) },
        { text: series ? `Весь ток светодиода идёт через прибор: ${mA(iM)}` : "Весь ток светодиода идёт через прибор", ok: series },
        noHurt(hurt),
      ];
    },
  },
  {
    id: "intro-divider",
    title: "Делитель напряжения",
    about: "Получите из 9 В напряжение 3,3 В (от 3,1 до 3,5 В) двумя резисторами из набора и покажите его на мультиметре: чёрный щуп — на минусе батареи.",
    hints: [
      "Два резистора последовательно между плюсом и минусом делят напряжение в отношении своих сопротивлений: на нижнем падает U × R2 / (R1 + R2).",
      "Нужно 3,3 / 9 ≈ 0,37 от батареи на нижнем резисторе. Переберите пары: верхний примерно вдвое больше нижнего.",
    ],
    kit: [1_000, 2_200, 3_300, 4_700, 5_600, 10_000].map((ohms): KitItem => ({ part: "resistor", ohms, count: 1 })),
    start: () => bench("intro-divider", [{ id: "P1", type: "meter", mode: "V", placement: free(-18, 12) }]),
    check(scene) {
      const { sim, hurt } = settle(scene);
      const m = of(scene, "meter")[0];
      const bat = of(scene, "battery")[0];
      const net = netOf(scene);
      const com = !!m && !!bat && net(m.id, 0) === net(bat.id, 0);
      const v = m ? reading(sim, m) : 0;
      return [
        { text: "Мультиметр в режиме вольтметра (V)", ok: m?.mode === "V" },
        { text: "Чёрный щуп — на минусе батареи", ok: com },
        { text: m?.mode === "V" && com ? `Прибор показывает 3,1–3,5 В — сейчас ${formatSI(Math.abs(v), "В")}` : "Прибор показывает 3,1–3,5 В", ok: m?.mode === "V" && com && v >= 3.1 && v <= 3.5 },
        noHurt(hurt),
      ];
    },
  },
  {
    id: "intro-switch",
    title: "Транзистор-ключ",
    about: "Сделайте так, чтобы светодиод загорался, пока нажата кнопка, — но ток светодиода должен идти через транзистор, а кнопка только им управлять. Проверка сама нажмёт и отпустит кнопку.",
    hints: [
      "У BC547 малый ток в базу открывает большой ток от коллектора к эмиттеру. Эмиттер — к минусу, светодиод с резистором — между плюсом и коллектором.",
      "Кнопка подаёт ток в базу через резистор (прямо в базу — сгорит). Какой из двух резисторов для базы, какой для светодиода?",
    ],
    kit: [
      { part: "bjt", kind: "BC547", count: 1 },
      { part: "other", type: "led", tool: "led", preset: { color: "green", size: "5mm" }, label: "светодиод зелёный", count: 1 },
      { part: "resistor", ohms: 470, count: 1 },
      { part: "resistor", ohms: 10_000, count: 1 },
      { part: "other", type: "button", tool: "button", preset: {}, label: "кнопка", count: 1 },
    ],
    start: () => bench("intro-switch"),
    check(scene) {
      const led = of(scene, "led")[0];
      const btn = of(scene, "button")[0];
      const vt = of(scene, "transistor")[0];
      if (!led || !btn || !vt) return [{ text: "На столе светодиод, кнопка и транзистор", ok: false }];
      const off = settle(scene);
      const on = settle(scene, [btn.id]);
      const iOff = Math.abs(off.sim.current(led));
      const iOn = Math.abs(on.sim.current(led));
      const ic = Math.abs(on.sim.current(vt));
      return [
        { text: `Кнопка отпущена — светодиод не горит (${mA(iOff)})`, ok: iOff < 0.001 },
        { text: `Кнопка нажата — горит нормально, 5–25 мА (${mA(iOn)})`, ok: ledOk(iOn) },
        { text: "Ток светодиода идёт через транзистор", ok: iOn > 0 && ic > 0.8 * iOn },
        noHurt([...new Set([...off.hurt, ...on.hurt])]),
      ];
    },
  },
  {
    id: "intro-scope",
    title: "Осциллограф",
    about: "Мигалка уже собрана. Посмотрите на осциллографе, как меняется напряжение на коллекторе транзистора: общий провод — к минусу, канал 1 — к коллектору VT1 или VT2. Подберите развёртку, чтобы на экране было от 2 до 10 периодов.",
    hints: [
      "Осциллограф рисует напряжение во времени. Общий провод (чёрное гнездо) — к минусу схемы, иначе ему не от чего отсчитывать.",
      "Коллектор — крайний вывод транзистора со стороны плоской грани (C в «C-B-E»). На экране 10 делений: развёртка × 10 — это сколько секунд видно. Один полный период мигалки — чуть больше секунды.",
    ],
    kit: [],
    start: () => ({
      ...blinkerScene(),
      components: [...blinkerScene().components, { id: "P1", type: "scope", timeDiv: 0.01, voltsDiv: [0, 0], placement: free(-18, 12) } as Component],
      boards: [{ id: "BB1", kind: "breadboard", x: 0, z: 0 }],
      career: { lesson: "intro-scope" },
    }),
    check(scene) {
      const p = of(scene, "scope")[0];
      const bat = of(scene, "battery")[0];
      const net = netOf(scene);
      const gnd = !!p && !!bat && net(p.id, 0) === net(bat.id, 0);
      const collectors = of(scene, "transistor").map((t) => net(t.id, 0));
      const ch1 = !!p && collectors.includes(net(p.id, 1));
      const period = blinkPeriod(scene);
      const span = p ? p.timeDiv * 10 : 0;
      const n = period ? span / period : 0;
      return [
        { text: "Общий провод осциллографа — на минусе", ok: gnd },
        { text: "Канал 1 — на коллекторе транзистора", ok: ch1 },
        { text: period ? `На экране 2–10 периодов — сейчас ${n.toFixed(1).replace(".", ",")} (период ${formatSI(period, "с")}, экран ${formatSI(span, "с")})` : "Мигалка мигает", ok: !!period && n >= 2 && n <= 10 },
      ];
    },
  },
];

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id);

/** Период мигалки по коллектору первого транзистора, с (или 0, если не мигает). */
export function blinkPeriod(scene: Scene): number {
  const vt = of(scene, "transistor")[0];
  if (!vt) return 0;
  const sim = new Simulation(JSON.parse(JSON.stringify(scene)) as Scene);
  const dt = 0.01;
  const vs: number[] = [];
  for (let t = 0; t < 6; t += dt) {
    sim.step(dt);
    vs.push(sim.solution.voltage.get(pinNode(vt, 0)) ?? 0);
  }
  const tail = vs.slice(Math.floor(1 / dt));
  const mid = (Math.max(...tail) + Math.min(...tail)) / 2;
  if (Math.max(...tail) - Math.min(...tail) < 1) return 0;
  const rises: number[] = [];
  for (let i = 1; i < tail.length; i++) if (tail[i - 1] < mid && tail[i] >= mid) rises.push(i * dt);
  return rises.length >= 2 ? (rises.at(-1)! - rises[0]) / (rises.length - 1) : 0;
}
