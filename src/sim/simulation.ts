import { HOLE_BY_ID } from "../model/breadboard";
import {
  BATTERIES,
  LAMPS,
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

/** Схема для решателя. Сгоревшие детали и разомкнутые выключатели — разрыв (r = ∞). */
export function buildBranches(scene: Scene, states: ReadonlyMap<string, ComponentState>): Branch[] {
  const branches: Branch[] = [];
  for (const c of scene.components) {
    const a = pinNode(c, 0);
    const b = pinNode(c, 1);
    const burned = states.get(c.id)?.burned ?? false;
    switch (c.type) {
      case "resistor":
        branches.push({ id: c.id, a, b, r: burned ? Infinity : c.ohms });
        break;
      case "lamp":
        branches.push({ id: c.id, a, b, r: burned ? Infinity : lampResistance(c) });
        break;
      case "battery": {
        const bat = BATTERIES[c.kind];
        // Вывод 0 — минус, вывод 1 — плюс.
        branches.push({ id: c.id, a, b, r: bat.rInt, emf: bat.emf });
        break;
      }
      case "switch":
        branches.push({ id: c.id, a, b, r: c.closed ? SWITCH_RESISTANCE : Infinity });
        break;
    }
  }
  for (const w of scene.wires) {
    branches.push({ id: w.id, a: endpointNode(scene, w.a), b: endpointNode(scene, w.b), r: WIRE_RESISTANCE });
  }
  return branches;
}

/**
 * Перегрев: пока мощность выше номинала, «тепло» копится со скоростью
 * (P/Pном − порог) × скорость; ниже номинала остывает. При тепле ≥ 1 деталь сгорает.
 * Это игровая модель, а не теплофизика: резистор при двойной перегрузке
 * сгорает примерно за 1,7 с, при 10-кратной — за 0,2 с.
 */
const THERMAL = {
  resistor: { threshold: 1, rate: 0.6, cooling: 0.5 },
  lamp: { threshold: 1.3, rate: 1.2, cooling: 1 },
};

/** Батарея считается замкнутой накоротко, если ток больше половины тока КЗ. */
export const SHORT_CIRCUIT_FRACTION = 0.5;

export class Simulation {
  readonly states = new Map<string, ComponentState>();
  solution!: Solution;

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

  /** Пересчитать токи. Вызывать после любого изменения сцены. */
  solve(): void {
    for (const c of this.scene.components) this.state(c.id);
    for (const id of [...this.states.keys()]) {
      if (!this.scene.components.some((c) => c.id === id)) this.states.delete(id);
    }
    this.solution = solveCircuit(buildBranches(this.scene, this.states));
  }

  branch(id: string): BranchResult {
    return this.solution.branches.get(id) ?? { current: 0, voltage: 0, power: 0 };
  }

  /** Отношение мощности к номиналу (0, если номинала нет). */
  overload(c: Component): number {
    const rated = ratedPower(c);
    return rated ? this.branch(c.id).power / rated : 0;
  }

  isShorted(c: Component): boolean {
    if (c.type !== "battery") return false;
    const bat = BATTERIES[c.kind];
    return Math.abs(this.branch(c.id).current) > SHORT_CIRCUIT_FRACTION * (bat.emf / bat.rInt);
  }

  /** Шаг по времени. Возвращает сгоревшие на этом шаге детали (цепь уже пересчитана). */
  step(dt: number): Component[] {
    const burnedNow: Component[] = [];
    for (const c of this.scene.components) {
      if (c.type !== "resistor" && c.type !== "lamp") continue;
      const s = this.state(c.id);
      if (s.burned) continue;
      const t = THERMAL[c.type];
      const k = this.overload(c);
      s.heat = k > t.threshold ? s.heat + (k - t.threshold) * t.rate * dt : Math.max(0, s.heat - t.cooling * dt);
      if (s.heat >= 1) {
        s.burned = true;
        s.heat = 1;
        burnedNow.push(c);
      }
    }
    if (burnedNow.length) this.solve();
    return burnedNow;
  }

  /** Заменить сгоревшую деталь новой (сбросить состояние). */
  repair(id: string): void {
    this.states.set(id, { burned: false, heat: 0 });
    this.solve();
  }
}
