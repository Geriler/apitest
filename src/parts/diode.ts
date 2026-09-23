import { diodeSpec, type Diode } from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import { formatLimit } from "../sim/devices";
import { junctionSim } from "./junction";
import type { PartDef } from "./types";

/** Анод (вывод 0) сверху: треугольник остриём к катоду. Общее для диода и светодиода. */
export const DIODE_SYMBOL = `<path d="M0 -20V-8M0 8V20M-9 8H9"/><path d="M-9 -8H9L0 8Z"/>`;

export const diode: PartDef<Diode> = {
  type: "diode",
  prefix: "VD",
  pins: 2,
  onBoard: () => true,
  polar: () => true,
  label: (c) => diodeSpec(c).label,
  value: (c) => diodeSpec(c).label,
  symbol: () => DIODE_SYMBOL,
  burn: (c) => [`Диод ${c.id} сгорел`, `Ток больше ${formatSI(diodeSpec(c).maxA, "А")}. Ограничьте ток резистором или возьмите диод мощнее.`],

  ...junctionSim,
  load(c, sim) {
    const maxA = diodeSpec(c).maxA;
    return { ratio: Math.max(0, sim.current(c)) / maxA, what: "ток", limit: formatLimit(maxA, "А") };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
};
