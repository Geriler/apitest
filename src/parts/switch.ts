import { SWITCH_RESISTANCE, type Switch } from "../model/types";
import { twoPin } from "./common";
import type { PartDef } from "./types";

export const switchPart: PartDef<Switch> = {
  type: "switch",
  prefix: "SA",
  pins: 2,
  onBoard: () => true,
  polar: () => false,
  label: (c) => (c.closed ? "тумблер, вкл." : "тумблер, выкл."),
  value: (c) => (c.closed ? "замкнут" : "разомкнут"),
  symbol: (c) =>
    c.closed
      ? `<path d="M0 -20V-10M0 10V20M0 -10L0 10"/><circle cy="-10" r="1.8" class="dot"/><circle cy="10" r="1.8" class="dot"/>`
      : `<path d="M0 -20V-10M0 10V20M0 10L11 -8"/><circle cy="-10" r="1.8" class="dot"/><circle cy="10" r="1.8" class="dot"/>`,
  burn: (c) => [`${c.id} вышел из строя`, ""],

  // Тумблер не горит
  stamp(c, _sim, { out }) {
    out.push(twoPin(c, c.closed ? SWITCH_RESISTANCE : Infinity));
  },
};
