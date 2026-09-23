import { LEDS, ledSpec, type Led } from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import { formatLimit } from "../sim/devices";
import { DIODE_SYMBOL } from "./diode";
import { junctionSim } from "./junction";
import type { PartDef } from "./types";

export const led: PartDef<Led> = {
  type: "led",
  prefix: "HL",
  pins: 2,
  onBoard: () => true,
  polar: () => true,
  label: (c) => `светодиод ${LEDS[c.color].label}${c.size === "1W" ? " 1 Вт" : ""}`,
  value: (c) => `${LEDS[c.color].label}${c.size === "1W" ? ", 1 Вт" : ""}`,
  symbol: () => `${DIODE_SYMBOL}<path d="M10 -6L17 -13M13 -1L20 -8M14 -13H17V-10M17 -8H20V-5" class="thin"/>`,
  burn: (c) => {
    const s = ledSpec(c);
    const vf = String(Math.round((LEDS[c.color].vf + s.vfAdd) * 10) / 10).replace(".", ",");
    return [`Светодиод ${c.id} сгорел`, `Ток больше ${formatSI(s.ratedA * 1.5, "А")}. Поставьте последовательно резистор: R = (U − ${vf} В) / ${String(s.ratedA).replace(".", ",")} А.`];
  },

  ...junctionSim,
  load(c, sim) {
    const rated = ledSpec(c).ratedA;
    return { ratio: Math.max(0, sim.current(c)) / rated, what: "ток", limit: formatLimit(rated, "А") };
  },
  thermal: { threshold: 1.5, rate: 1.5, cooling: 1 },
};
