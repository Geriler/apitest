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

export type Component = Resistor | Lamp | Battery | Switch;
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
