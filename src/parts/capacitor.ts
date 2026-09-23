import { capacitorVolts, formatFarads, type Capacitor } from "../model/types";
import { formatV } from "./format";
import type { PartDef } from "./types";

export const capacitor: PartDef<Capacitor> = {
  type: "capacitor",
  prefix: "C",
  pins: 2,
  onBoard: () => true,
  polar: (c) => c.variant === "electrolytic",
  label: (c) => `${formatFarads(c.uF)} ${formatV(capacitorVolts(c))}${c.variant === "electrolytic" ? "" : " керамический"}`,
  value: (c) => `${formatFarads(c.uF)}, ${formatV(capacitorVolts(c))}`,
  symbol: (c) => `<path d="M0 -20V-4M0 4V20M-12 -4H12M-12 4H12"/>${c.variant === "electrolytic" ? `<path d="M9 -13H15M12 -16V-10" class="thin"/>` : ""}`,
  burn: (c) =>
    c.variant === "electrolytic"
      ? [`Конденсатор ${c.id} вздулся`, `Электролит не терпит обратной полярности и напряжения выше ${formatV(capacitorVolts(c))}. Проверьте, где плюс (F — перевернуть), или возьмите конденсатор на большее напряжение.`]
      : [`Конденсатор ${c.id} пробит`, `Напряжение выше ${formatV(capacitorVolts(c))}. Возьмите конденсатор на большее напряжение.`],
};
