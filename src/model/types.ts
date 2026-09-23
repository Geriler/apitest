/** Модель песочницы: что стоит на столе и как соединено. Без Three.js. */

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

/** Сопротивление провода-перемычки, Ом (≈ 10 см медного провода 22 AWG). */
export const WIRE_RESISTANCE = 0.005;
/** Сопротивление замкнутого выключателя, Ом. */
export const SWITCH_RESISTANCE = 0.01;

export type Placement =
  | { mode: "board"; holes: [string, string] }
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

export type Component = Resistor | Lamp | Battery | Switch | Capacitor | Diode | Led;
export type ComponentType = Component["type"];

/** Конец провода: отверстие макетки или вывод свободно стоящей детали. */
export type Endpoint = { hole: string } | { comp: string; pin: 0 | 1 };

export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
  color: string;
}

export interface Scene {
  components: Component[];
  wires: Wire[];
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
  return c.type === "diode" || c.type === "led" || c.type === "battery" || (c.type === "capacitor" && c.variant === "electrolytic");
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
  if (type === "battery") return false;
  if (type === "resistor") return variant !== "smd";
  return true;
}
