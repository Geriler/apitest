import { HOLE_BY_ID } from "../model/breadboard";
import {
  BATTERIES,
  CERAMIC_RATED_V,
  DIODE_1N4007,
  ELECTROLYTIC_RATED_V,
  ELECTROLYTIC_REVERSE_V,
  LAMPS,
  LEDS,
  LED_N,
  LED_RATED_A,
  LED_RS,
  SWITCH_RESISTANCE,
  WIRE_RESISTANCE,
  ratedPower,
  type Component,
  type ComponentState,
  type Endpoint,
  type Scene,
} from "../model/types";
import { solveCircuit, type Branch, type BranchResult, type Solution } from "./solver";

/** Электрический узел вывода детали. На плате — узел полосы, иначе собственный узел вывода. */
export function pinNode(c: Component, pin: 0 | 1): string {
  if (c.placement.mode === "board") {
    const hole = HOLE_BY_ID.get(c.placement.holes[pin]);
    if (!hole) throw new Error(`Нет отверстия ${c.placement.holes[pin]}`);
    return hole.node;
  }
  return `pin:${c.id}:${pin}`;
}

export function endpointNode(scene: Scene, e: Endpoint): string {
  if ("hole" in e) {
    const hole = HOLE_BY_ID.get(e.hole);
    if (!hole) throw new Error(`Нет отверстия ${e.hole}`);
    return hole.node;
  }
  const c = scene.components.find((x) => x.id === e.comp);
  if (!c) throw new Error(`Нет детали ${e.comp}`);
  return pinNode(c, e.pin);
}

export function lampResistance(c: Extract<Component, { type: "lamp" }>): number {
  const l = LAMPS[c.kind];
  return l.ratedV / l.ratedA;
}

// ─── Диоды ─────────────────────────────────────────────────────────────────

/** Тепловой потенциал kT/q при ~27 °C, В. */
export const VT = 0.02585;

export interface DiodeParams {
  is: number;
  n: number;
  rs: number;
}

/** Параметры диода или светодиода для уравнения Шокли. */
export function diodeParams(c: Component): DiodeParams {
  if (c.type === "diode") return DIODE_1N4007;
  if (c.type === "led") {
    // Is подбирается так, чтобы при 20 мА на выводах было vf (с учётом падения на Rs).
    const vj = LEDS[c.color].vf - LED_RATED_A * LED_RS;
    return { is: LED_RATED_A / Math.exp(vj / (LED_N * VT)), n: LED_N, rs: LED_RS };
  }
  throw new Error(`${c.id} — не диод`);
}

/** Ток через p-n переход при напряжении vj, А. */
export function shockley(p: DiodeParams, vj: number): number {
  return p.is * (Math.exp(vj / (p.n * VT)) - 1);
}

/**
 * Ограничение шага напряжения на переходе между итерациями Ньютона (как pnjlim в SPICE):
 * без него экспонента переполняется при первом же большом шаге.
 */
function limitJunction(vnew: number, vold: number, p: DiodeParams): number {
  const nvt = p.n * VT;
  const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * p.is));
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nvt;
      return arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
    }
    return nvt * Math.log(vnew / nvt);
  }
  return vnew;
}

/** Малая проводимость параллельно переходу: помогает сходимости, на результат не влияет (1 нА на 1 кВ). */
const GMIN = 1e-12;

/**
 * Линеаризация диода в точке vj: ветвь «ЭДС + сопротивление», которую понимает решатель.
 * Переход заменяется касательной I ≈ Id + Gd·(v − vj), последовательно с Rs.
 */
function diodeBranch(p: DiodeParams, vj: number): { r: number; emf: number } {
  const e = Math.exp(vj / (p.n * VT));
  const id = p.is * (e - 1);
  const gd = (p.is / (p.n * VT)) * e + GMIN;
  return { r: 1 / gd + p.rs, emf: id / gd - vj };
}

// ─── Перегрев и перегрузка ─────────────────────────────────────────────────

/**
 * Нагрузка детали: отношение к пределу. Для резистора и лампы — по мощности,
 * для диодов — по току, для конденсаторов — по напряжению (у электролита и по обратному).
 *
 * Перегрев: пока нагрузка выше порога, «тепло» копится со скоростью (нагрузка − порог) × rate,
 * ниже порога остывает. При тепле ≥ 1 деталь выходит из строя. Это игровая модель,
 * а не теплофизика: резистор при двойной перегрузке сгорает примерно за 1,7 с.
 */
const THERMAL: Partial<Record<Component["type"], { threshold: number; rate: number; cooling: number }>> = {
  resistor: { threshold: 1, rate: 0.6, cooling: 0.5 },
  lamp: { threshold: 1.3, rate: 1.2, cooling: 1 },
  led: { threshold: 1.5, rate: 1.5, cooling: 1 },
  diode: { threshold: 1, rate: 0.6, cooling: 0.5 },
  capacitor: { threshold: 1, rate: 0.4, cooling: 0.3 },
};

/** С какой нагрузки деталь начинает перегреваться (0 — не греется). */
export function heatThreshold(c: Component): number {
  return THERMAL[c.type]?.threshold ?? 0;
}

/** Батарея считается замкнутой накоротко, если ток больше половины тока КЗ. */
export const SHORT_CIRCUIT_FRACTION = 0.5;

/** Шаг по времени при наличии конденсаторов, с. */
export const SUBSTEP = 0.005;

export interface Load {
  ratio: number;
  /** Что сравнивается с пределом: для подписи в интерфейсе. */
  what: "мощность" | "ток" | "напряжение" | "обратное напряжение";
  limit: string;
}

export class Simulation {
  readonly states = new Map<string, ComponentState>();
  /** Напряжение на конденсаторе (вывод 0 минус вывод 1), В. Сохраняется между шагами — это заряд. */
  readonly capVoltage = new Map<string, number>();
  /** Напряжение на переходе диода с прошлого решения — начальное приближение для Ньютона. */
  private junction = new Map<string, number>();
  solution!: Solution;
  /** Сколько итераций Ньютона потребовало последнее решение (для тестов и отладки). */
  lastIterations = 0;

  constructor(public scene: Scene) {
    this.solve();
  }

  state(id: string): ComponentState {
    let s = this.states.get(id);
    if (!s) {
      s = { burned: false, heat: 0 };
      this.states.set(id, s);
    }
    return s;
  }

  private hasCapacitors(): boolean {
    return this.scene.components.some((c) => c.type === "capacitor" && !this.state(c.id).burned);
  }

  /** Схема для решателя при заданных линеаризациях диодов и шаге h для конденсаторов. */
  private branches(h: number): Branch[] {
    const out: Branch[] = [];
    for (const c of this.scene.components) {
      const a = pinNode(c, 0);
      const b = pinNode(c, 1);
      const burned = this.state(c.id).burned;
      const open = { id: c.id, a, b, r: Infinity };
      if (burned && c.type !== "battery" && c.type !== "switch") {
        out.push(open);
        continue;
      }
      switch (c.type) {
        case "resistor":
          out.push({ id: c.id, a, b, r: c.ohms });
          break;
        case "lamp":
          out.push({ id: c.id, a, b, r: lampResistance(c) });
          break;
        case "battery": {
          const bat = BATTERIES[c.kind];
          // Вывод 0 — минус, вывод 1 — плюс.
          out.push({ id: c.id, a, b, r: bat.rInt, emf: bat.emf });
          break;
        }
        case "switch":
          out.push({ id: c.id, a, b, r: c.closed ? SWITCH_RESISTANCE : Infinity });
          break;
        case "capacitor": {
          // Неявный метод Эйлера: I = C·(v − v_пред)/h → ветвь с r = h/C и ЭДС −v_пред.
          const C = c.uF * 1e-6;
          out.push({ id: c.id, a, b, r: h / C, emf: -(this.capVoltage.get(c.id) ?? 0) });
          break;
        }
        case "diode":
        case "led": {
          const p = diodeParams(c);
          const { r, emf } = diodeBranch(p, this.junction.get(c.id) ?? 0);
          out.push({ id: c.id, a, b, r, emf });
          break;
        }
      }
    }
    for (const w of this.scene.wires) {
      out.push({ id: w.id, a: endpointNode(this.scene, w.a), b: endpointNode(this.scene, w.b), r: WIRE_RESISTANCE });
    }
    return out;
  }

  /** Решение с итерациями Ньютона по диодам. Заряд конденсаторов не меняется. */
  private solveAt(h: number): void {
    const diodes = this.scene.components.filter((c) => (c.type === "diode" || c.type === "led") && !this.state(c.id).burned);
    for (let iter = 1; iter <= 200; iter++) {
      this.solution = solveCircuit(this.branches(h));
      this.lastIterations = iter;
      let converged = true;
      for (const d of diodes) {
        const p = diodeParams(d);
        const br = this.solution.branches.get(d.id)!;
        const vold = this.junction.get(d.id) ?? 0;
        // Напряжение на выводах минус падение на Rs — напряжение на переходе
        const vterm = -br.voltage;
        const vnew = limitJunction(vterm - br.current * p.rs, vold, p);
        if (Math.abs(vnew - vold) > 1e-7) converged = false;
        this.junction.set(d.id, vnew);
      }
      if (converged) return;
    }
    // Не сошлось за 200 итераций — оставляем последнее приближение (на практике не встречалось).
  }

  /** Пересчитать токи. Вызывать после любого изменения сцены. */
  solve(): void {
    for (const c of this.scene.components) this.state(c.id);
    const alive = new Set(this.scene.components.map((c) => c.id));
    for (const m of [this.states, this.capVoltage, this.junction]) {
      for (const id of [...m.keys()]) if (!alive.has(id)) m.delete(id);
    }
    this.solveAt(SUBSTEP);
  }

  branch(id: string): BranchResult {
    return this.solution.branches.get(id) ?? { current: 0, voltage: 0, power: 0 };
  }

  /** Напряжение между выводами 0 и 1 (V0 − V1), В. Для диода — прямое напряжение. */
  voltage(c: Component): number {
    if (c.type === "capacitor") return this.capVoltage.get(c.id) ?? 0;
    return -this.branch(c.id).voltage;
  }

  /** Ток от вывода 0 к выводу 1 через деталь, А. */
  current(c: Component): number {
    return this.branch(c.id).current;
  }

  /** Мощность, которая выделяется в детали теплом (у конденсатора — 0, он запасает энергию), Вт. */
  power(c: Component): number {
    switch (c.type) {
      case "diode":
      case "led":
        return Math.max(0, this.voltage(c) * this.current(c));
      case "capacitor":
        return 0;
      case "battery": {
        // Мощность, которую батарея отдаёт в цепь
        const bat = BATTERIES[c.kind];
        return Math.abs(this.current(c)) * bat.emf;
      }
      default:
        return this.branch(c.id).power;
    }
  }

  /** Энергия, запасённая в конденсаторе, Дж. */
  energy(c: Component): number {
    if (c.type !== "capacitor") return 0;
    const v = this.voltage(c);
    return 0.5 * c.uF * 1e-6 * v * v;
  }

  load(c: Component): Load | undefined {
    switch (c.type) {
      case "resistor":
      case "lamp": {
        const rated = ratedPower(c)!;
        return { ratio: this.branch(c.id).power / rated, what: "мощность", limit: `${rated} Вт` };
      }
      case "led":
        return { ratio: Math.max(0, this.current(c)) / LED_RATED_A, what: "ток", limit: "20 мА" };
      case "diode":
        return { ratio: Math.max(0, this.current(c)) / DIODE_1N4007.maxA, what: "ток", limit: "1 А" };
      case "capacitor": {
        const v = this.voltage(c);
        if (c.variant === "ceramic") return { ratio: Math.abs(v) / CERAMIC_RATED_V, what: "напряжение", limit: `${CERAMIC_RATED_V} В` };
        if (v < 0) return { ratio: -v / ELECTROLYTIC_REVERSE_V, what: "обратное напряжение", limit: `${ELECTROLYTIC_REVERSE_V} В` };
        return { ratio: v / ELECTROLYTIC_RATED_V, what: "напряжение", limit: `${ELECTROLYTIC_RATED_V} В` };
      }
      default:
        return undefined;
    }
  }

  /** Нагрузка относительно предела (0, если предела нет). */
  overload(c: Component): number {
    return this.load(c)?.ratio ?? 0;
  }

  isShorted(c: Component): boolean {
    if (c.type !== "battery") return false;
    const bat = BATTERIES[c.kind];
    return Math.abs(this.branch(c.id).current) > SHORT_CIRCUIT_FRACTION * (bat.emf / bat.rInt);
  }

  /** Диод включён в обратную сторону и заметное напряжение приложено против него. */
  isReversed(c: Component): boolean {
    if (c.type === "diode" || c.type === "led") return this.voltage(c) < -0.5;
    if (c.type === "capacitor" && c.variant === "electrolytic") return this.voltage(c) < -0.2;
    return false;
  }

  /**
   * Шаг по времени. Если в схеме есть конденсаторы, время идёт шагами по 5 мс
   * и заряд обновляется. Возвращает детали, вышедшие из строя на этом шаге.
   */
  step(dt: number): Component[] {
    const failed: Component[] = [];
    const transient = this.hasCapacitors();
    const n = transient ? Math.max(1, Math.round(dt / SUBSTEP)) : 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      if (transient) {
        this.solveAt(h);
        for (const c of this.scene.components) {
          if (c.type === "capacitor" && !this.state(c.id).burned) this.capVoltage.set(c.id, -this.branch(c.id).voltage);
        }
      }
      failed.push(...this.heat(h));
      if (failed.length && !transient) this.solve();
    }
    if (transient) this.solveAt(SUBSTEP);
    return failed;
  }

  private heat(dt: number): Component[] {
    const failed: Component[] = [];
    for (const c of this.scene.components) {
      const t = THERMAL[c.type];
      if (!t) continue;
      const s = this.state(c.id);
      if (s.burned) continue;
      const k = this.overload(c);
      s.heat = k > t.threshold ? s.heat + (k - t.threshold) * t.rate * dt : Math.max(0, s.heat - t.cooling * dt);
      if (s.heat >= 1) {
        s.burned = true;
        s.heat = 1;
        failed.push(c);
      }
    }
    return failed;
  }

  /** Заменить сгоревшую деталь новой (сбросить состояние и заряд). */
  repair(id: string): void {
    this.states.set(id, { burned: false, heat: 0 });
    this.capVoltage.delete(id);
    this.solve();
  }

  /** Разрядить конденсатор (замкнуть выводы отвёрткой). */
  discharge(id: string): void {
    this.capVoltage.set(id, 0);
    this.solve();
  }
}
