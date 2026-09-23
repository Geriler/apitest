import type { PowerSupply } from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import type { PartDef } from "./types";

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
};
