import { TRANSISTORS, type Transistor } from "../model/types";
import type { PartDef } from "./types";

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
};
