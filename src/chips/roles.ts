import type { ChipPinRole } from "../model/breadboard";

/** Назначения выводов корпуса: подпись, короткая подпись, имя по умолчанию, цвет. */
export const PIN_ROLES: Record<ChipPinRole, { label: string; short: string; name: string; color: string }> = {
  nc: { label: "не подключён (NC)", short: "NC", name: "NC", color: "#8a8f96" },
  in: { label: "вход", short: "вход", name: "IN", color: "#2f9e5a" },
  out: { label: "выход", short: "выход", name: "OUT", color: "#e2762a" },
  vcc: { label: "питание (Vcc)", short: "питание", name: "VCC", color: "#c8261f" },
  gnd: { label: "общий (GND)", short: "общий", name: "GND", color: "#1b1d20" },
};
