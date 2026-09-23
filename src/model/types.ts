/** Модель песочницы: что стоит на столе и как соединено. Без Three.js. */

import { DEFAULT_BOARDS, boardsFromLayout, holeIdsFor, type BoardSpec, type Layout } from "./breadboard";

export type SmdSize = "1206" | "0805" | "0603" | "0402";

/** Типовые размеры корпусов (длина × ширина, мм) и мощность, Вт. У конкретных серий могут отличаться. */
export const SMD_SIZES: Record<SmdSize, { lengthMm: number; widthMm: number; heightMm: number; ratedW: number }> = {
  "1206": { lengthMm: 3.2, widthMm: 1.6, heightMm: 0.55, ratedW: 0.25 },
  "0805": { lengthMm: 2.0, widthMm: 1.25, heightMm: 0.5, ratedW: 0.125 },
  "0603": { lengthMm: 1.6, widthMm: 0.8, heightMm: 0.45, ratedW: 0.1 },
  "0402": { lengthMm: 1.0, widthMm: 0.5, heightMm: 0.35, ratedW: 0.063 },
};

/** Выводной резистор 0,25 Вт: корпус ≈ 6,3 × 2,4 мм. */
export const THT_RESISTOR = { lengthMm: 6.3, diameterMm: 2.4, ratedW: 0.25 };

export const BATTERIES = {
  "9V": { label: "Крона 9 В", emf: 9, rInt: 1.5 },
  "4.5V": { label: "3 × AA, 4,5 В", emf: 4.5, rInt: 0.45 },
  "3V": { label: "2 × AA, 3 В", emf: 3, rInt: 0.3 },
  "1.5V": { label: "AA, 1,5 В", emf: 1.5, rInt: 0.15 },
} as const;
export type BatteryKind = keyof typeof BATTERIES;

/** Миниатюрные лампы накаливания, номинал «напряжение × ток». */
export const LAMPS = {
  "2.5V": { label: "2,5 В × 0,3 А", ratedV: 2.5, ratedA: 0.3 },
  "3.5V": { label: "3,5 В × 0,26 А", ratedV: 3.5, ratedA: 0.26 },
  "6.3V": { label: "6,3 В × 0,3 А", ratedV: 6.3, ratedA: 0.3 },
  "12V": { label: "12 В × 0,1 А", ratedV: 12, ratedA: 0.1 },
} as const;
export type LampKind = keyof typeof LAMPS;

/**
 * Электролитические конденсаторы 16 В. Размеры (Ø × высота, мм) типовые для этих номиналов,
 * у разных серий отличаются. Электролит полярный: обратное напряжение больше ~1 В его портит.
 */
export const ELECTROLYTICS = [
  { uF: 10, diaMm: 5, heightMm: 11 },
  { uF: 100, diaMm: 6.3, heightMm: 11 },
  { uF: 470, diaMm: 8, heightMm: 12 },
  { uF: 1000, diaMm: 10, heightMm: 16 },
  { uF: 2200, diaMm: 13, heightMm: 21 },
  { uF: 4700, diaMm: 16, heightMm: 26 },
] as const;
export const ELECTROLYTIC_RATED_V = 16;
/** Допустимое обратное напряжение электролита, В (ориентир, не паспортное значение). */
export const ELECTROLYTIC_REVERSE_V = 1;

/** Керамические конденсаторы 50 В, неполярные. */
export const CERAMICS = [
  { uF: 0.01, code: "103" },
  { uF: 0.1, code: "104" },
  { uF: 1, code: "105" },
] as const;
export const CERAMIC_RATED_V = 50;

/**
 * Параметры диодов для уравнения Шокли I = Is·(e^(V/(n·Vt)) − 1) с последовательным Rs.
 * 1N4007 — из распространённой SPICE-модели. Светодиоды подобраны так, чтобы
 * при 20 мА падение было около vf (типовое значение, у конкретных светодиодов разброс).
 */
export const DIODE_1N4007 = { label: "1N4007", is: 7.03e-9, n: 1.808, rs: 0.034, maxA: 1 };

export const LEDS = {
  red: { label: "красный", vf: 2.0, hex: "#ff2a1a", glass: "#b8221a" },
  yellow: { label: "жёлтый", vf: 2.1, hex: "#ffc21a", glass: "#c9971a" },
  green: { label: "зелёный", vf: 2.2, hex: "#3dff5a", glass: "#2a9a3a" },
  blue: { label: "синий", vf: 3.0, hex: "#3a7bff", glass: "#2a4fb8" },
  white: { label: "белый", vf: 3.1, hex: "#f4f6ff", glass: "#d8dde8" },
} as const;
export type LedColor = keyof typeof LEDS;
/** Номинальный ток светодиода 5 мм, А. */
export const LED_RATED_A = 0.02;
export const LED_N = 2;
export const LED_RS = 8;

/**
 * Биполярные транзисторы в корпусе TO-92, модель Эберса–Молла.
 * Is, βF, βR — по порядку величин распространённых SPICE-моделей BC547B / BC557B
 * (у разных производителей и экземпляров β заметно разнится: у BC547B паспорт 200–450).
 * Цоколёвка (плоской стороной к себе, выводы вниз, слева направо): К, Б, Э.
 */
export const TRANSISTORS = {
  BC547: { label: "BC547B", polarity: "npn" as const, is: 2e-14, betaF: 300, betaR: 8, maxIc: 0.1, maxP: 0.5 },
  BC557: { label: "BC557B", polarity: "pnp" as const, is: 2e-14, betaF: 250, betaR: 8, maxIc: 0.1, maxP: 0.5 },
};
export type TransistorKind = keyof typeof TRANSISTORS;

/**
 * MOSFET: квадратичная модель канала I = K/2·(Uзи − Uпор)² с плавным переходом в подпороговую область.
 * K подобран по сопротивлению открытого канала из даташита, Uпор — типовое (у экземпляров разброс,
 * у 2N7000 по даташиту 0,8–3 В). maxP — без радиатора. pins — роли ножек слева направо.
 */
export const MOSFETS = {
  "2N7000": {
    label: "2N7000", channel: "n" as const, pkg: "TO-92" as const, pins: ["S", "G", "D"] as const,
    vth: 2.1, k: 0.065, maxId: 0.2, maxP: 0.4, rdsNote: "≈ 2 Ом при Uзи = 10 В",
  },
  IRLZ44N: {
    label: "IRLZ44N", channel: "n" as const, pkg: "TO-220" as const, pins: ["G", "D", "S"] as const,
    vth: 1.5, k: 13, maxId: 47, maxP: 2, rdsNote: "≈ 0,02 Ом при Uзи = 5 В",
  },
  IRF9540N: {
    label: "IRF9540N", channel: "p" as const, pkg: "TO-220" as const, pins: ["G", "D", "S"] as const,
    vth: 3, k: 1.2, maxId: 23, maxP: 2, rdsNote: "≈ 0,12 Ом при Uзи = −10 В",
  },
};
export type MosfetKind = keyof typeof MOSFETS;
export type MosfetRole = "G" | "D" | "S";

/** Номер вывода детали с данной ролью. */
export function mosfetPin(kind: MosfetKind, role: MosfetRole): 0 | 1 | 2 {
  return MOSFETS[kind].pins.indexOf(role) as 0 | 1 | 2;
}

/**
 * Сопротивление провода-перемычки на миллиметр длины, Ом: медь 22 AWG (0,326 мм²),
 * ρ/S = 1,72e−8 / 0,326e−6 ≈ 53 мОм/м. Провод 10 см — около 5 мОм.
 */
export const WIRE_OHM_PER_MM = 1.72e-8 / 0.326e-6 / 1000;
/** Сопротивление замкнутого выключателя, Ом. */
export const SWITCH_RESISTANCE = 0.01;

export type Placement =
  /** Отверстия по выводам: [вывод 0, вывод 1] или для транзистора [коллектор, база, эмиттер]. */
  | { mode: "board"; holes: string[] }
  | { mode: "free"; x: number; z: number; rot: number };

interface Base {
  id: string;
  placement: Placement;
}

export interface Resistor extends Base {
  type: "resistor";
  variant: "tht" | "smd";
  ohms: number;
  smdSize: SmdSize;
}

export interface Lamp extends Base {
  type: "lamp";
  kind: LampKind;
}

export interface Battery extends Base {
  type: "battery";
  kind: BatteryKind;
}

export interface Switch extends Base {
  type: "switch";
  closed: boolean;
}

/** Выводы полярных деталей: 0 — анод / плюс, 1 — катод / минус. */
export interface Capacitor extends Base {
  type: "capacitor";
  variant: "electrolytic" | "ceramic";
  uF: number;
}

export interface Diode extends Base {
  type: "diode";
}

export interface Led extends Base {
  type: "led";
  color: LedColor;
}

/** Биполярный транзистор. Выводы: 0 — коллектор, 1 — база, 2 — эмиттер. */
export interface Transistor extends Base {
  type: "transistor";
  kind: TransistorKind;
}

/**
 * Полевой транзистор с изолированным затвором (MOSFET). Выводы — в порядке ножек корпуса
 * слева направо (маркировкой к себе); какой из них затвор, сток и исток — см. MOSFETS[kind].pins.
 */
export interface Mosfet extends Base {
  type: "mosfet";
  kind: MosfetKind;
}

/**
 * Лабораторный источник питания: держит заданное напряжение (режим CV), пока ток меньше
 * ограничения; если нагрузка требует больше — держит ток (режим CC), напряжение падает.
 * Выводы: 0 — минус (чёрная клемма), 1 — плюс (красная).
 */
export interface PowerSupply extends Base {
  type: "psu";
  volts: number;
  amps: number;
  on: boolean;
}

export const PSU_LIMITS = { maxV: 30, maxA: 3 };

export type Component = Resistor | Lamp | Battery | Switch | Capacitor | Diode | Led | Transistor | Mosfet | PowerSupply;
export type ComponentType = Component["type"];

/** Конец провода: отверстие макетки или вывод свободно стоящей детали. */
export type Pin = 0 | 1 | 2;
export type Endpoint = { hole: string } | { comp: string; pin: Pin };

export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
  color: string;
}

/**
 * Медная дорожка печатной платы между двумя площадками (отрезок).
 * Фольга 35 мкм, ширина с площадку (1,83 мм): сопротивление ≈ 0,27 мОм на миллиметр длины.
 */
export interface Trace {
  id: string;
  a: string;
  b: string;
}

/** Ширина дорожки, мм: как диаметр площадки (0,72 шага). */
export const TRACE_WIDTH_MM = 0.72 * 2.54;
/** Удельное сопротивление дорожки, Ом/мм: ρ(Cu) / (ширина × толщина) = 1,72e−8 / (1,83e−3 × 35e−6) / 1000. */
export const TRACE_OHM_PER_MM = 1.72e-8 / (TRACE_WIDTH_MM * 1e-3 * 35e-6) / 1000;

export interface Scene {
  components: Component[];
  wires: Wire[];
  /** Платы на столе. Нет — стартовый набор (макетка и печатная плата 24 × 14). */
  boards?: BoardSpec[];
  /** Старый формат раскладки плат: при загрузке превращается в boards. */
  layout?: Layout;
  /** Дорожки печатной платы (в старых сохранениях может не быть). */
  traces?: Trace[];
}

/** Что с деталью происходит во время симуляции. */
export interface ComponentState {
  burned: boolean;
  /** Накопленный перегрев, 0…1; при 1 деталь сгорает. */
  heat: number;
}

export function sameEndpoint(p: Endpoint, q: Endpoint): boolean {
  if ("hole" in p) return "hole" in q && q.hole === p.hole;
  return "comp" in q && q.comp === p.comp && q.pin === p.pin;
}

/** Полярная ли деталь: важно, какой вывод куда. */
export function isPolar(c: Component): boolean {
  return (
    c.type === "diode" ||
    c.type === "led" ||
    c.type === "battery" ||
    c.type === "psu" ||
    c.type === "transistor" ||
    c.type === "mosfet" ||
    (c.type === "capacitor" && c.variant === "electrolytic")
  );
}

/** Сколько выводов у детали. */
export function pinCount(c: Component): number {
  return c.type === "transistor" || c.type === "mosfet" ? 3 : 2;
}

export function electrolyticSize(uF: number) {
  return ELECTROLYTICS.find((e) => e.uF === uF) ?? ELECTROLYTICS[ELECTROLYTICS.length - 1];
}

/** «4700 мкФ», «100 нФ». */
export function formatFarads(uF: number): string {
  if (uF >= 1) return `${String(uF).replace(".", ",")} мкФ`;
  return `${String(Math.round(uF * 1000)).replace(".", ",")} нФ`;
}

/** Номинальная мощность детали, Вт (для перегрева). У батареи и выключателя нет. */
export function ratedPower(c: Component): number | undefined {
  switch (c.type) {
    case "resistor":
      return c.variant === "smd" ? SMD_SIZES[c.smdSize].ratedW : THT_RESISTOR.ratedW;
    case "lamp": {
      const l = LAMPS[c.kind];
      return l.ratedV * l.ratedA;
    }
    default:
      return undefined;
  }
}

/** Может ли деталь стоять в макетной плате: у SMD нет ножек. У батареи — отдельный корпус. */
export function canGoOnBoard(type: ComponentType, variant?: "tht" | "smd"): boolean {
  if (type === "battery" || type === "psu") return false;
  if (type === "resistor") return variant !== "smd";
  return true;
}

/** Платы сцены: из boards, из старой раскладки или стартовый набор. */
export function sceneBoards(scene: Scene): BoardSpec[] {
  return scene.boards ?? (scene.layout ? boardsFromLayout(scene.layout) : DEFAULT_BOARDS.map((b) => ({ ...b })));
}

/**
 * Что помешает перейти на такой набор плат: детали, провода и дорожки в отверстиях,
 * которых в нём не будет. Пустой список — можно менять.
 */
export function boardConflicts(scene: Scene, boards: readonly BoardSpec[]): string[] {
  const ids = holeIdsFor(boards);
  const out = new Set<string>();
  for (const c of scene.components) {
    if (c.placement.mode === "board" && c.placement.holes.some((h) => !ids.has(h))) out.add(c.id);
  }
  for (const w of scene.wires) {
    if ([w.a, w.b].some((e) => "hole" in e && !ids.has(e.hole))) out.add(w.id);
  }
  for (const t of scene.traces ?? []) {
    if (!ids.has(t.a) || !ids.has(t.b)) out.add(t.id);
  }
  return [...out];
}
