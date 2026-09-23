import { BATTERIES, type Battery } from "../model/types";
import * as tolerance from "../sim/tolerance";
import { twoPin } from "./common";
import type { PartDef } from "./types";

/** Батарея считается замкнутой накоротко, если ток больше половины тока КЗ. */
export const SHORT_CIRCUIT_FRACTION = 0.5;

export const battery: PartDef<Battery> = {
  type: "battery",
  prefix: "GB",
  pins: 2,
  onBoard: () => false,
  polar: () => true,
  label: (c) => BATTERIES[c.kind].label,
  value: (c) => BATTERIES[c.kind].label,
  // Вывод 1 — плюс: длинная тонкая пластина со стороны вывода 1 (внизу), короткая толстая — минус
  symbol: () => `<path d="M0 -20V-4M0 4V20M-13 4H13"/><path d="M-7 -4H7" class="thick"/><path d="M9 11H15M12 8V14" class="thin"/>`,
  burn: (c) => [`${c.id} вышел из строя`, ""],

  // Батарея не горит; вывод 0 — минус, вывод 1 — плюс
  stamp(c, sim, { out }) {
    const bat = tolerance.battery(c, sim.tolerance);
    out.push(twoPin(c, bat.rInt, bat.emf));
  },
  // Мощность, которую батарея отдаёт в цепь
  power: (c, sim) => Math.abs(sim.current(c)) * tolerance.battery(c, sim.tolerance).emf,
  shorted(c, sim) {
    const bat = tolerance.battery(c, sim.tolerance);
    return Math.abs(sim.branch(c.id).current) > SHORT_CIRCUIT_FRACTION * (bat.emf / bat.rInt);
  },
};
