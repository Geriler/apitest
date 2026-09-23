/**
 * Физика p-n перехода, общая для диодов, светодиодов, переходов транзисторов и паразитного
 * диода MOSFET: уравнение Шокли, его линеаризация для решателя и приёмы сходимости Ньютона.
 */

import { LED_N, diodeSpec, ledSpec, type Component } from "../model/types";
import * as tolerance from "./tolerance";
import { NO_TOLERANCE, type Tolerance } from "./tolerance";

/** Тепловой потенциал kT/q при ~27 °C, В. */
export const VT = 0.02585;

export interface DiodeParams {
  is: number;
  n: number;
  rs: number;
}

/** «0,125 Вт», «20 мА», «6,3 В» — предел для подписи в панели. */
export function formatLimit(v: number, unit: string): string {
  if (v < 1 && unit === "А") return `${Math.round(v * 1000)} мА`;
  return `${String(v).replace(".", ",")} ${unit}`;
}

/** Параметры диода или светодиода для уравнения Шокли. */
export function diodeParams(c: Component, tol: Tolerance = NO_TOLERANCE): DiodeParams {
  if (c.type === "diode") {
    const d = diodeSpec(c);
    return { is: tolerance.diodeIs(c, tol), n: d.n, rs: d.rs };
  }
  if (c.type === "led") {
    // Is подбирается так, чтобы при номинальном токе на выводах было vf (с учётом падения на Rs).
    const s = ledSpec(c);
    const vj = tolerance.ledVf(c, tol) + s.vfAdd - s.ratedA * s.rs;
    return { is: s.ratedA / Math.exp(vj / (LED_N * VT)), n: LED_N, rs: s.rs };
  }
  throw new Error(`${c.id} — не диод`);
}

/** Ток через p-n переход при напряжении vj, А. */
export function shockley(p: DiodeParams, vj: number): number {
  return p.is * (Math.exp(vj / (p.n * VT)) - 1);
}

/**
 * Ограничение шага напряжения на переходе между итерациями Ньютона (как pnjlim в SPICE):
 * без него экспонента переполняется при первом же большом шаге.
 */
export function limitJunction(vnew: number, vold: number, p: DiodeParams): number {
  const nvt = p.n * VT;
  const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * p.is));
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nvt;
      return arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
    }
    return nvt * Math.log(vnew / nvt);
  }
  return vnew;
}

/**
 * Если Ньютон за 20 итераций не сошёлся, он обычно ходит по кругу между «переход заперт» и
 * «переход открыт» (например, светодиод на почти неподключённом стоке закрытого MOSFET).
 * Тогда берём только половину шага — качели гаснут.
 */
export function damp(vnew: number, vold: number, iter: number): number {
  return iter > 20 ? vold + (vnew - vold) / 2 : vnew;
}

/**
 * Сошёлся ли переход: напряжение почти не меняется или (как в SPICE) почти не меняется ток.
 * Второе нужно для перехода на «висящем» узле (светодиод последовательно с разомкнутым
 * тумблером): ток там — пикоамперы, и напряжение дрожит в пределах точности вычислений.
 * Ток сравнивается с тем, к которому стремится решение (target — до ограничения шага):
 * иначе запертый в начале расчёта светодиод «сошёлся» бы, не успев открыться.
 */
export function junctionSettled(p: DiodeParams, vold: number, vnew: number, target: number): boolean {
  if (Math.abs(vnew - vold) <= 1e-7) return true;
  const i = (v: number) => p.is * (Math.exp(Math.min(v, 5) / (p.n * VT)) - 1);
  const io = i(vold);
  const inew = i(target);
  return Math.abs(inew - io) <= 1e-9 + 1e-6 * Math.max(Math.abs(io), Math.abs(inew));
}

/** Малая проводимость параллельно переходу: помогает сходимости, на результат не влияет (1 нА на 1 кВ). */
export const GMIN = 1e-12;

/**
 * Линеаризация диода в точке vj: ветвь «ЭДС + сопротивление», которую понимает решатель.
 * Переход заменяется касательной I ≈ Id + Gd·(v − vj), последовательно с Rs.
 */
export function diodeBranch(p: DiodeParams, vj: number): { r: number; emf: number } {
  const e = Math.exp(vj / (p.n * VT));
  // Ток утечки GMIN·vj входит и в ток, и в наклон: касательная к I(v) = Is·(e^v/nVt − 1) + GMIN·v.
  // Если учесть GMIN только в наклоне, узел, который держится на одном запертом диоде
  // (светодиод последовательно с разомкнутым тумблером), уходит на итерациях вразнос.
  const id = p.is * (e - 1) + GMIN * vj;
  const gd = (p.is / (p.n * VT)) * e + GMIN;
  return { r: 1 / gd + p.rs, emf: id / gd - vj };
}
