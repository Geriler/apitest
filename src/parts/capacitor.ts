import { ELECTROLYTIC_REVERSE_V, capacitorVolts, formatFarads, type Capacitor } from "../model/types";
import { formatLimit } from "../sim/devices";
import * as tolerance from "../sim/tolerance";
import { stampBurned, twoPin } from "./common";
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

  // Неявный метод Эйлера: I = C·(v − v_пред)/h → ветвь с r = h/C и ЭДС −v_пред
  stamp(c, sim, { out }) {
    if (!stampBurned(c, sim, out)) out.push(twoPin(c, sim.h / tolerance.capacitance(c, sim.tolerance), -(sim.capVoltage.get(c.id) ?? 0)));
  },
  dynamic: true,
  remember(c, sim) {
    sim.capVoltage.set(c.id, -sim.branch(c.id).voltage);
  },
  voltage: (c, sim) => sim.capVoltage.get(c.id) ?? 0,
  // Конденсатор не греется, он запасает энергию
  power: () => 0,
  load(c, sim) {
    const v = sim.voltage(c);
    const rated = capacitorVolts(c);
    if (c.variant === "ceramic") return { ratio: Math.abs(v) / rated, what: "напряжение", limit: formatLimit(rated, "В") };
    if (v < 0) return { ratio: -v / ELECTROLYTIC_REVERSE_V, what: "обратное напряжение", limit: `${ELECTROLYTIC_REVERSE_V} В` };
    return { ratio: v / rated, what: "напряжение", limit: formatLimit(rated, "В") };
  },
  thermal: { threshold: 1, rate: 0.4, cooling: 0.3 },
  reversed: (c, sim) => c.variant === "electrolytic" && sim.voltage(c) < -0.2,
};
