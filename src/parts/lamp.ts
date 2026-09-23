import { LAMPS, type Lamp } from "../model/types";
import { formatLimit } from "../sim/devices";
import * as tolerance from "../sim/tolerance";
import { stampBurned, twoPin } from "./common";
import type { PartDef } from "./types";

export const lamp: PartDef<Lamp> = {
  type: "lamp",
  prefix: "HL",
  pins: 2,
  onBoard: () => true,
  polar: () => false,
  label: (c) => `лампа ${LAMPS[c.kind].label}`,
  value: (c) => LAMPS[c.kind].label,
  symbol: () => `<path d="M0 -20V-11M0 11V20"/><circle r="11"/><path d="M-7.8 -7.8L7.8 7.8M7.8 -7.8L-7.8 7.8"/>`,
  rated: (c) => LAMPS[c.kind].ratedV * LAMPS[c.kind].ratedA,
  burn: (c) => [`Лампа ${c.id} перегорела`, `Номинал ${LAMPS[c.kind].label}. Добавьте последовательно резистор или возьмите батарею слабее.`],

  stamp(c, sim, { out }) {
    if (!stampBurned(c, sim, out)) out.push(twoPin(c, tolerance.lampResistance(c, sim.tolerance)));
  },
  load(c, sim) {
    const rated = lamp.rated!(c);
    return { ratio: sim.branch(c.id).power / rated, what: "мощность", limit: formatLimit(rated, "Вт") };
  },
  thermal: { threshold: 1.3, rate: 1.2, cooling: 1 },
};
