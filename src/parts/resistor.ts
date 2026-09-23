import { SMD_SIZES, thtResistorSpec, type Resistor } from "../model/types";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import { formatW } from "./format";
import type { PartDef } from "./types";

export const resistor: PartDef<Resistor> = {
  type: "resistor",
  prefix: "R",
  pins: 2,
  onBoard: (variant) => variant !== "smd",
  polar: () => false,
  label: (c) => `${formatOhms(c.ohms)}${c.variant === "smd" ? ` SMD ${c.smdSize}` : `, ${formatW(thtResistorSpec(c).ratedW)}`}`,
  value: (c) => `${formatOhms(c.ohms)}${c.variant === "smd" ? ` ${c.smdSize}` : `, ${formatW(thtResistorSpec(c).ratedW)}`}`,
  symbol: () => `<path d="M0 -20V-15M0 15V20"/><rect x="-5" y="-15" width="10" height="30"/>`,
  rated: (c) => (c.variant === "smd" ? SMD_SIZES[c.smdSize].ratedW : thtResistorSpec(c).ratedW),
  burn: (c) =>
    c.variant === "smd"
      ? [`Резистор ${c.id} сгорел`, `Корпус ${c.smdSize} рассеивает не больше ${formatSI(SMD_SIZES[c.smdSize].ratedW, "Вт")}. Возьмите корпус крупнее или резистор с бо́льшим сопротивлением.`]
      : [`Резистор ${c.id} сгорел`, `Номинал ${formatW(thtResistorSpec(c).ratedW)}. Возьмите резистор мощнее, увеличьте сопротивление или понизьте напряжение.`],
};
