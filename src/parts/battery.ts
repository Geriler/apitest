import { BATTERIES, type Battery } from "../model/types";
import type { PartDef } from "./types";

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
};
