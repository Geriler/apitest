import {
  BATTERIES,
  diodeSpec,
  LAMPS,
  LEDS,
  MOSFETS,
  TRANSISTORS,
  type Component,
} from "../model/types";

/**
 * Режим «реальные допуски»: у каждой детали параметры немного отличаются от номинала,
 * как у настоящих деталей из одной коробки.
 *
 * Отклонение каждой детали зависит только от seed, id детали и названия параметра, поэтому
 * выключение и включение режима возвращает те же значения, а новая деталь получает своё.
 * Новый seed — «другие экземпляры» тех же деталей.
 */
export interface Tolerance {
  enabled: boolean;
  seed: number;
}

export const NO_TOLERANCE: Tolerance = { enabled: false, seed: 1 };

/** Равномерно распределённое число в [−1, 1] для пары (деталь, параметр); 0, если режим выключен. */
export function deviation(tol: Tolerance, id: string, param: string): number {
  if (!tol.enabled) return 0;
  // FNV-1a по строке, затем перемешивание (splitmix32) — достаточно для игровой случайности
  let h = 0x811c9dc5;
  const s = `${tol.seed}|${id}|${param}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = (h + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Значение в диапазоне [min, max] по отклонению u ∈ [−1, 1]. */
const within = (u: number, min: number, max: number) => min + ((u + 1) / 2) * (max - min);

/** Допуски, на которые опирается режим (для справки в интерфейсе). */
export const TOLERANCES = {
  resistor: 0.05,
  electrolytic: 0.2,
  ceramic: 0.1,
  lamp: 0.1,
  ledVf: 0.15,
  batteryEmf: 0.03,
  batteryR: 0.4,
  mosfetK: 0.2,
  /** Диапазоны по даташитам (группа B у BC547/BC557; порог MOSFET по модулю). */
  beta: [200, 450] as const,
  vth: { "2N7000": [0.8, 3], BS250: [1, 3.5], IRLZ44N: [1, 2], IRF9540N: [2, 4] } as const,
};

export function resistance(c: Extract<Component, { type: "resistor" }>, tol: Tolerance): number {
  return c.ohms * (1 + TOLERANCES.resistor * deviation(tol, c.id, "R"));
}

export function lampResistance(c: Extract<Component, { type: "lamp" }>, tol: Tolerance): number {
  const l = LAMPS[c.kind];
  return (l.ratedV / l.ratedA) * (1 + TOLERANCES.lamp * deviation(tol, c.id, "R"));
}

export function battery(c: Extract<Component, { type: "battery" }>, tol: Tolerance): { emf: number; rInt: number } {
  const b = BATTERIES[c.kind];
  return {
    emf: b.emf * (1 + TOLERANCES.batteryEmf * deviation(tol, c.id, "emf")),
    rInt: b.rInt * (1 + TOLERANCES.batteryR * deviation(tol, c.id, "r")),
  };
}

/** Ёмкость, Ф. */
export function capacitance(c: Extract<Component, { type: "capacitor" }>, tol: Tolerance): number {
  const t = c.variant === "electrolytic" ? TOLERANCES.electrolytic : TOLERANCES.ceramic;
  return c.uF * 1e-6 * (1 + t * deviation(tol, c.id, "C"));
}

export function ledVf(c: Extract<Component, { type: "led" }>, tol: Tolerance): number {
  return LEDS[c.color].vf + TOLERANCES.ledVf * deviation(tol, c.id, "vf");
}

/** Ток насыщения диода: множитель 2^u меняет прямое падение на n·Vt·ln 2 ≈ ±32 мВ (1N4007). */
export function diodeIs(c: Extract<Component, { type: "diode" }>, tol: Tolerance): number {
  return diodeSpec(c).is * 2 ** deviation(tol, c.id, "is");
}

export function betaF(c: Extract<Component, { type: "transistor" }>, tol: Tolerance): number {
  if (!tol.enabled) return TRANSISTORS[c.kind].betaF;
  return within(deviation(tol, c.id, "beta"), ...TOLERANCES.beta);
}

export function mosfetParams(c: Extract<Component, { type: "mosfet" }>, tol: Tolerance): { vth: number; k: number } {
  const spec = MOSFETS[c.kind];
  if (!tol.enabled) return { vth: spec.vth, k: spec.k };
  const [min, max] = TOLERANCES.vth[c.kind];
  return {
    vth: within(deviation(tol, c.id, "vth"), min, max),
    k: spec.k * (1 + TOLERANCES.mosfetK * deviation(tol, c.id, "k")),
  };
}
