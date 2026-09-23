import type { PowerSupply } from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import { stampBurned, twoPin } from "./common";
import type { PartDef } from "./types";

/** Выходное сопротивление лабораторного блока в режиме CV, Ом. */
const PSU_R_CV = 0.005;
/** В режиме CC блок — источник тока; внутренняя проводимость ничтожна (100 МОм параллельно). */
const PSU_R_CC = 1e8;

export const psu: PartDef<PowerSupply> = {
  type: "psu",
  prefix: "G",
  pins: 2,
  onBoard: () => false,
  polar: () => true,
  label: (c) => (c.on ? `блок питания ${formatSI(c.volts, "В")} / ${formatSI(c.amps, "А")}` : "блок питания, выход выкл."),
  value: (c) => (c.on ? `${formatSI(c.volts, "В")} / ${formatSI(c.amps, "А")}` : "выход выкл."),
  symbol: () => `<path d="M0 -20V-12M0 12V20"/><circle r="12"/><path d="M0 -6V6M-4 2L0 6L4 2" class="thin"/><path d="M8 17H14M11 14V20" class="thin"/>`,
  burn: (c) => [`${c.id} вышел из строя`, ""],

  stamp(c, sim, { out }) {
    if (stampBurned(c, sim, out)) return;
    if (!c.on) out.push(twoPin(c, Infinity));
    // CV: ЭДС = уставка, почти нулевое сопротивление. CC: ток = ограничение (эквивалент Нортона).
    else if (sim.psuMode.get(c.id) === "CC") out.push(twoPin(c, PSU_R_CC, c.amps * PSU_R_CC));
    else out.push(twoPin(c, PSU_R_CV, c.volts));
  },
  // CV, пока ток меньше ограничения; иначе CC, пока напряжение не выше уставки
  newton(c, sim, _iter, shared) {
    if (!c.on) return true;
    const br = sim.solution.branches.get(c.id)!;
    const mode = sim.psuMode.get(c.id) ?? "CV";
    const next = mode === "CV" ? (br.current > c.amps * (1 + 1e-9) ? "CC" : "CV") : br.voltage > c.volts * (1 + 1e-9) ? "CV" : "CC";
    if (next === mode || shared.flips >= 8) return true;
    sim.psuMode.set(c.id, next);
    shared.flips++;
    return false;
  },
  power: (c, sim) => Math.max(0, sim.branch(c.id).current * sim.branch(c.id).voltage),
};
