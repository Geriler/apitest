/** Расчёт, общий для диода и светодиода: p-n переход с сопротивлением Rs. */

import type { Diode, Led } from "../model/types";
import { damp, diodeBranch, diodeParams, junctionSettled, limitJunction } from "../sim/devices";
import type { Simulation } from "../sim/simulation";
import { stampBurned, twoPin } from "./common";
import type { PartDef } from "./types";

type Junction = Diode | Led;

export const junctionSim: Pick<PartDef<Junction>, "stamp" | "newton" | "power" | "reversed"> = {
  stamp(c, sim, { out }) {
    if (stampBurned(c, sim, out)) return;
    const { r, emf } = diodeBranch(diodeParams(c, sim.tolerance), sim.junction.get(c.id) ?? 0);
    out.push(twoPin(c, r, emf));
  },
  newton(c, sim, iter) {
    const p = diodeParams(c, sim.tolerance);
    const br = sim.solution.branches.get(c.id)!;
    const vold = sim.junction.get(c.id) ?? 0;
    // Напряжение на выводах минус падение на Rs — напряжение на переходе
    const target = -br.voltage - br.current * p.rs;
    const vnew = damp(limitJunction(target, vold, p), vold, iter);
    sim.junction.set(c.id, vnew);
    return junctionSettled(p, vold, vnew, target);
  },
  power: (c, sim: Simulation) => Math.max(0, sim.voltage(c) * sim.current(c)),
  reversed: (c, sim) => sim.voltage(c) < -0.5,
};
