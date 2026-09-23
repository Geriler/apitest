import { TRANSISTORS, type Pin, type Transistor } from "../model/types";
import { VT, diodeBranch, limitJunction } from "../sim/devices";
import { pinNode } from "../sim/nodes";
import type { Simulation } from "../sim/simulation";
import * as tolerance from "../sim/tolerance";
import type { Tolerance } from "../sim/tolerance";
import type { PartDef, Stamp } from "./types";

/** Режим работы транзистора. */
export type TransistorMode = "отсечка" | "усиление" | "насыщение" | "инверсный";

export interface TransistorState {
  /** Токи в «прямом» смысле: для n-p-n втекают в коллектор и базу, для p-n-p — вытекают. */
  ic: number;
  ib: number;
  ie: number;
  /** Напряжения в «прямом» смысле: для n-p-n Vбэ = Vб − Vэ, для p-n-p Vэб. */
  vbe: number;
  vce: number;
  vbc: number;
  mode: TransistorMode;
}

/**
 * Ёмкость переходов транзистора, Ф. У настоящего BC547 — единицы пикофарад; здесь намеренно 10 нФ:
 * без ёмкостей переключение мгновенное, и у схем с положительной обратной связью (мигалка, триггер)
 * в момент переключения нет непрерывного решения — метод Ньютона блуждает. С ёмкостью переключение
 * занимает микросекунды, для глаза это всё равно мгновенно.
 */
export const JUNCTION_CAPACITANCE = 10e-9;

/** Модель транзистора: знак (+1 n-p-n, −1 p-n-p) и параметры Эберса–Молла. */
function bjt(c: Transistor, tol: Tolerance) {
  const t = TRANSISTORS[c.kind];
  const sign = t.polarity === "npn" ? 1 : -1;
  return {
    sign,
    is: t.is,
    /** Переходы как диоды: ток базы через каждый — Is/β. */
    be: { is: t.is / tolerance.betaF(c, tol), n: 1, rs: 0 },
    bc: { is: t.is / t.betaR, n: 1, rs: 0 },
    /** Для ограничения шага: весь ток перехода, а не только базовая часть. */
    junction: { is: t.is, n: 1, rs: 0 },
  };
}

/** Токи и напряжения транзистора из текущего решения. */
export function transistorState(c: Transistor, sim: Simulation): TransistorState {
  const zero: TransistorState = { ic: 0, ib: 0, ie: 0, vbe: 0, vce: 0, vbc: 0, mode: "отсечка" };
  const v = (pin: Pin) => sim.solution.voltage.get(pinNode(c, pin));
  const [vc, vb, ve] = [v(0), v(1), v(2)];
  if (vc === undefined || vb === undefined || ve === undefined) return zero;
  const m = bjt(c, sim.tolerance);
  const vbe = m.sign * (vb - ve);
  const vbc = m.sign * (vb - vc);
  if (sim.state(c.id).burned) return { ...zero, vbe, vbc, vce: vbe - vbc };
  const ibe = sim.solution.branches.get(`${c.id}:be`)?.current ?? 0;
  const ibc = sim.solution.branches.get(`${c.id}:bc`)?.current ?? 0;
  const it = m.is * (Math.exp(vbe / VT) - Math.exp(vbc / VT));
  const ic = it - ibc;
  const ib = ibe + ibc;
  const mode: TransistorMode =
    Math.abs(ic) < 1e-6 && Math.abs(ib) < 1e-6
      ? "отсечка"
      : vbe < 0.3 && vbc > 0.4
        ? "инверсный"
        : vbc > 0.4
          ? "насыщение"
          : "усиление";
  return { ic, ib, ie: ic + ib, vbe, vbc, vce: vbe - vbc, mode };
}

/**
 * Транзистор по Эберсу–Моллу: два перехода как диоды (дают ток базы) и ток переноса
 * коллектор → эмиттер It = Is·(e^(Vбэ/Vt) − e^(Vбк/Vt)), линеаризованный в текущей точке.
 * Для p-n-p все напряжения и токи с обратным знаком.
 */
function stampTransistor(c: Transistor, sim: Simulation, { out, extras }: Stamp): void {
  const m = bjt(c, sim.tolerance);
  const [C, B, E] = [pinNode(c, 0), pinNode(c, 1), pinNode(c, 2)];
  const vbe0 = sim.junction.get(`${c.id}:be`) ?? 0;
  const vbc0 = sim.junction.get(`${c.id}:bc`) ?? 0;
  // Переходы: у n-p-n анод — база, у p-n-p — эмиттер/коллектор
  const be = diodeBranch(m.be, vbe0);
  const bc = diodeBranch(m.bc, vbc0);
  out.push(m.sign > 0 ? { id: `${c.id}:be`, a: B, b: E, ...be } : { id: `${c.id}:be`, a: E, b: B, ...be });
  out.push(m.sign > 0 ? { id: `${c.id}:bc`, a: B, b: C, ...bc } : { id: `${c.id}:bc`, a: C, b: B, ...bc });
  // Ёмкости переходов (неявный метод Эйлера, как у конденсатора)
  for (const [key, a, b] of [[`${c.id}:cbe`, B, E], [`${c.id}:cbc`, B, C]] as const) {
    out.push({ id: key, a, b, r: sim.h / JUNCTION_CAPACITANCE, emf: -(sim.capVoltage.get(key) ?? 0) });
  }
  const ef = Math.exp(vbe0 / VT);
  const er = Math.exp(vbc0 / VT);
  const gf = (m.is / VT) * ef;
  const gr = (m.is / VT) * er;
  const it0 = m.is * (ef - er);
  // I(К→Э) = знак·(It0 − gf·vbe0 + gr·vbc0) + gf·(Vб − Vэ) − gr·(Vб − Vк)
  extras.currents.push({ a: C, b: E, j: m.sign * (it0 - gf * vbe0 + gr * vbc0) });
  extras.vccs.push({ a: C, b: E, cp: B, cn: E, g: gf });
  extras.vccs.push({ a: C, b: E, cp: B, cn: C, g: -gr });
}

export const transistor: PartDef<Transistor> = {
  type: "transistor",
  prefix: "VT",
  pins: 3,
  onBoard: () => true,
  polar: () => true,
  label: (c) => `транзистор ${TRANSISTORS[c.kind].label}, I<sub>к</sub>`,
  value: (c) => TRANSISTORS[c.kind].label,
  burn: (c) => [
    `Транзистор ${c.id} сгорел`,
    "Ток коллектора больше 100 мА или мощность больше 0,5 Вт. Поставьте резистор в цепь коллектора и резистор в базу.",
  ],

  stamp(c, sim, s) {
    if (!sim.state(c.id).burned) stampTransistor(c, sim, s);
  },
  newton(c, sim) {
    const m = bjt(c, sim.tolerance);
    const volt = (pin: Pin) => sim.solution.voltage.get(pinNode(c, pin)) ?? 0;
    const targets: [string, number][] = [
      [`${c.id}:be`, m.sign * (volt(1) - volt(2))],
      [`${c.id}:bc`, m.sign * (volt(1) - volt(0))],
    ];
    let converged = true;
    for (const [key, vterm] of targets) {
      const vold = sim.junction.get(key) ?? 0;
      const vnew = limitJunction(vterm, vold, m.junction);
      if (Math.abs(vnew - vold) > 1e-7) converged = false;
      sim.junction.set(key, vnew);
    }
    return converged;
  },
  dynamic: true,
  remember(c, sim) {
    for (const key of [`${c.id}:cbe`, `${c.id}:cbc`]) sim.capVoltage.set(key, -sim.branch(key).voltage);
  },
  voltage: (c, sim) => sim.transistor(c).vce,
  current: (c, sim) => sim.transistor(c).ic,
  power(c, sim) {
    const t = sim.transistor(c);
    return Math.max(0, t.vce * t.ic + t.vbe * t.ib);
  },
  load(c, sim) {
    const spec = TRANSISTORS[c.kind];
    const byI = Math.abs(sim.transistor(c).ic) / spec.maxIc;
    const byP = sim.power(c) / spec.maxP;
    return byI >= byP
      ? { ratio: byI, what: "ток", limit: `${spec.maxIc * 1000} мА` }
      : { ratio: byP, what: "мощность", limit: `${spec.maxP} Вт` };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  reversed: (c, sim) => sim.transistor(c).mode === "инверсный",
};
