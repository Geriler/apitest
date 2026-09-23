import { MOSFETS, type Mosfet } from "../model/types";
import type { PartDef } from "./types";

export const mosfet: PartDef<Mosfet> = {
  type: "mosfet",
  prefix: "VT",
  pins: 3,
  onBoard: () => true,
  polar: () => true,
  label: (c) => `MOSFET ${MOSFETS[c.kind].label}, I<sub>с</sub>`,
  value: (c) => MOSFETS[c.kind].label,
  burn: (c) => [
    `MOSFET ${c.id} сгорел`,
    `Больше ${String(MOSFETS[c.kind].maxP).replace(".", ",")} Вт без радиатора или ток выше предела. Полевой транзистор греется, когда приоткрыт: подайте на затвор полное напряжение или ограничьте ток нагрузкой.`,
  ],
};
