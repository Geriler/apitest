/**
 * Симуляция схемы: собирает ветви от деталей (у каждого типа — свой stamp в src/parts),
 * решает методом узловых потенциалов с итерациями Ньютона, ведёт время, заряд и нагрев.
 */

import { HOLE_BY_ID } from "../model/breadboard";
import { FLAT_WIRE_EXTRA, TRACE_OHM_PER_MM, WIRE_OHM_PER_MM, isFlatWire, type Component, type ComponentState, type Endpoint, type Mosfet, type Scene, type Transistor, type WireShape } from "../model/types";
import { part } from "../parts";
import { mosfetState, type MosfetState } from "../parts/mosfet";
import { transistorState, type TransistorState } from "../parts/transistor";
import { endpointNode } from "./nodes";
import { solveCircuit, type BranchResult, type Solution } from "./solver";
import * as tolerance from "./tolerance";
import { NO_TOLERANCE, type Tolerance } from "./tolerance";
import type { Stamp } from "../parts/types";

export { VT, diodeParams, shockley } from "./devices";
export { endpointNode, pinNode } from "./nodes";
export { SHORT_CIRCUIT_FRACTION } from "../parts/battery";
export { GATE_DRAIN_CAPACITANCE, GATE_SOURCE_CAPACITANCE, mosfetChannel, type MosfetMode, type MosfetState } from "../parts/mosfet";
export { JUNCTION_CAPACITANCE, type TransistorMode, type TransistorState } from "../parts/transistor";

/** Где на столе конец провода (x, z в шагах 2,54 мм). У детали на столе — её центр (выводы рядом). */
function endpointXZ(scene: Scene, e: Endpoint): [number, number] {
  if ("hole" in e) {
    const h = HOLE_BY_ID.get(e.hole)!;
    return [h.x, h.z];
  }
  const c = scene.components.find((x) => x.id === e.comp)!;
  if (c.placement.mode === "free") return [c.placement.x, c.placement.z];
  const h = HOLE_BY_ID.get(c.placement.holes[e.pin])!;
  return [h.x, h.z];
}

/**
 * Сопротивление провода, Ом: длина провода, как он нарисован, × сопротивление меди 22 AWG.
 * Дуга: концы поднимаются над платой на 1–7 шагов. Прямая перемычка: расстояние плюс два
 * загнутых конца.
 */
export function wireResistance(scene: Scene, w: { a: Endpoint; b: Endpoint; shape?: WireShape }): number {
  const [ax, az] = endpointXZ(scene, w.a);
  const [bx, bz] = endpointXZ(scene, w.b);
  const d = Math.hypot(ax - bx, az - bz);
  if (isFlatWire(w)) return (d + FLAT_WIRE_EXTRA) * 2.54 * WIRE_OHM_PER_MM;
  const rise = Math.min(7, Math.max(1, 0.8 + d * 0.22));
  return (d + 2 * rise) * 2.54 * WIRE_OHM_PER_MM;
}

/** Сопротивление дорожки между двумя площадками, Ом (длина в шагах 2,54 мм). */
export function traceResistance(aId: string, bId: string): number {
  const a = HOLE_BY_ID.get(aId)!;
  const b = HOLE_BY_ID.get(bId)!;
  const mmLen = Math.hypot(a.x - b.x, a.z - b.z) * 2.54;
  return Math.max(1e-4, mmLen * TRACE_OHM_PER_MM);
}

export function lampResistance(c: Extract<Component, { type: "lamp" }>, tol: Tolerance = NO_TOLERANCE): number {
  return tolerance.lampResistance(c, tol);
}

// ─── Перегрев и перегрузка ─────────────────────────────────────────────────
//
// Нагрузка детали (part.load) — отношение к пределу: у резистора и лампы по мощности,
// у диодов по току, у конденсаторов по напряжению. Перегрев (part.thermal): пока нагрузка
// выше порога, «тепло» копится со скоростью (нагрузка − порог) × rate, ниже порога остывает.
// При тепле ≥ 1 деталь выходит из строя. Это игровая модель, а не теплофизика: резистор
// при двойной перегрузке сгорает примерно за 1,7 с.

/** С какой нагрузки деталь начинает перегреваться (0 — не греется). */
export function heatThreshold(c: Component): number {
  return part(c).thermal?.threshold ?? 0;
}

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
  /** Режим лабораторных блоков: держат напряжение (CV) или ток (CC). */
  readonly psuMode = new Map<string, "CV" | "CC">();
  /** Напряжение на переходе диода с прошлого решения — начальное приближение для Ньютона. */
  junction = new Map<string, number>();
  solution: Solution = { nodeOf: new Map(), voltage: new Map(), branches: new Map() };
  /** Время расчёта, с: растёт с каждым шагом (замедленное, если расчёт не успевает). */
  time = 0;
  /** Детали, которые сейчас держат нажатыми (кнопки): не часть схемы, в проект не сохраняется. */
  readonly held = new Set<string>();
  /** Своя память деталей между шагами (запись осциллографа): ключ — обозначение детали. */
  readonly memory = new Map<string, unknown>();
  /** Сколько итераций Ньютона потребовало последнее решение (для тестов и отладки). */
  lastIterations = 0;

  constructor(
    public scene: Scene,
    /** Режим «реальные допуски». После изменения вызвать solve(). */
    public tolerance: Tolerance = NO_TOLERANCE,
  ) {
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

  /** Есть ли что-то, что зависит от времени: конденсаторы или транзисторы (у них ёмкости переходов). */
  private hasCapacitors(): boolean {
    return this.scene.components.some((c) => part(c).dynamic && !this.state(c.id).burned);
  }

  /** Схема для решателя при заданных линеаризациях диодов и транзисторов и шаге h для конденсаторов. */
  private branches(h: number): Stamp {
    this.h = h;
    const s: Stamp = { out: [], extras: { currents: [], vccs: [] } };
    for (const c of this.scene.components) part(c).stamp(c, this, s);
    for (const w of this.scene.wires) {
      s.out.push({ id: w.id, a: endpointNode(this.scene, w.a), b: endpointNode(this.scene, w.b), r: wireResistance(this.scene, w) });
    }
    for (const t of this.scene.traces ?? []) {
      s.out.push({ id: t.id, a: HOLE_BY_ID.get(t.a)!.node, b: HOLE_BY_ID.get(t.b)!.node, r: traceResistance(t.a, t.b) });
    }
    return s;
  }

  /** Токи и напряжения MOSFET из текущего решения. */
  mosfet(c: Mosfet): MosfetState {
    return mosfetState(c, this);
  }

  /** Токи и напряжения транзистора из текущего решения. */
  transistor(c: Transistor): TransistorState {
    return transistorState(c, this);
  }

  /**
   * Сколько ещё итераций Ньютона можно потратить на текущий вызов step(). Обычный шаг тратит
   * десятки итераций; бюджет срабатывает только на схемах, которые не сходятся.
   */
  private budget = Infinity;

  /** Текущий шаг по времени, с (для ёмкостей). */
  h = SUBSTEP;

  /** Сколько решений не сошлось (для тестов и отладки). */
  nonConverged = 0;

  /**
   * Решение с итерациями Ньютона по диодам и транзисторам. Заряд конденсаторов не меняется.
   * Возвращает false, если за 100 итераций не сошлось (бывает на резких переключениях).
   */
  private solveAt(h: number): boolean {
    const nonlinear = this.scene.components.filter((c) => part(c).newton && !this.state(c.id).burned);
    const shared = { flips: 0 };
    for (let iter = 1; iter <= 100; iter++) {
      const { out, extras } = this.branches(h);
      // Вырожденная или плохо обусловленная система (нечисла в ответе) — итерация не удалась;
      // остаётся прошлое решение, шаг будет повторён мельче
      let solution: Solution;
      try {
        solution = solveCircuit(out, [], extras);
      } catch {
        return false;
      }
      if (![...solution.voltage.values()].every(Number.isFinite)) return false;
      this.solution = solution;
      this.lastIterations = iter;
      if (--this.budget < 0) return false;
      let converged = true;
      // Каждая деталь двигает только свои переходы, так что порядок не важен
      for (const c of nonlinear) if (!part(c).newton!(c, this, iter, shared)) converged = false;
      if (converged) return true;
    }
    return false;
  }

  /** Пересчитать токи. Вызывать после любого изменения сцены. */
  solve(): void {
    for (const c of this.scene.components) this.state(c.id);
    const alive = new Set(this.scene.components.map((c) => c.id));
    for (const id of [...this.held]) if (!alive.has(id)) this.held.delete(id);
    for (const m of [this.states, this.capVoltage, this.junction, this.psuMode, this.memory]) {
      for (const key of [...m.keys()]) if (!alive.has(key.split(":")[0])) m.delete(key);
    }
    this.solveAt(SUBSTEP);
  }

  branch(id: string): BranchResult {
    return this.solution.branches.get(id) ?? { current: 0, voltage: 0, power: 0 };
  }

  /** Напряжение между выводами 0 и 1 (V0 − V1), В. Для диода — прямое напряжение. */
  voltage(c: Component): number {
    return part(c).voltage?.(c, this) ?? -this.branch(c.id).voltage;
  }

  /** Ток от вывода 0 к выводу 1 через деталь, А. */
  current(c: Component): number {
    return part(c).current?.(c, this) ?? this.branch(c.id).current;
  }

  /** Мощность, которая выделяется в детали теплом (у конденсатора — 0, он запасает энергию), Вт. */
  power(c: Component): number {
    return part(c).power?.(c, this) ?? this.branch(c.id).power;
  }

  /** Запасённая энергия (в конденсаторе), Дж. */
  energy(c: Component): number {
    return part(c).energy?.(c, this) ?? 0;
  }

  load(c: Component): Load | undefined {
    return part(c).load?.(c, this);
  }

  /** Нагрузка относительно предела (0, если предела нет). */
  overload(c: Component): number {
    return this.load(c)?.ratio ?? 0;
  }

  isShorted(c: Component): boolean {
    return part(c).shorted?.(c, this) ?? false;
  }

  /** Диод включён в обратную сторону и заметное напряжение приложено против него. */
  isReversed(c: Component): boolean {
    return part(c).reversed?.(c, this) ?? false;
  }

  /**
   * Шаг по времени. Если в схеме есть конденсаторы, время идёт шагами по 5 мс
   * и заряд обновляется. Возвращает детали, вышедшие из строя на этом шаге.
   */
  step(dt: number): Component[] {
    this.budget = 5000;
    const failed: Component[] = [];
    const transient = this.hasCapacitors();
    const n = transient ? Math.max(1, Math.round(dt / SUBSTEP)) : 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      if (transient) failed.push(...this.advance(h, 0));
      else {
        this.time += h;
        failed.push(...this.heat(h));
        if (failed.length) this.solve();
      }
    }
    if (transient) this.solveAt(SUBSTEP);
    this.budget = Infinity;
    return failed;
  }

  /**
   * Шаг по времени h с конденсаторами. Если Ньютон не сошёлся (резкое переключение транзистора),
   * шаг откатывается и делится пополам — до 15 раз, то есть до ≈ 150 нс. Нагрев считается
   * только по сошедшимся решениям, чтобы недосчитанный скачок не «сжёг» деталь.
   */
  private advance(h: number, depth: number): Component[] {
    const saved = new Map(this.junction);
    const ok = this.solveAt(h);
    // Если схема упорно не сходится, не дробим до бесконечности: страница не должна зависнуть
    if (!ok && depth < 15 && this.budget > 0) {
      this.junction = saved;
      return [...this.advance(h / 2, depth + 1), ...this.advance(h / 2, depth + 1)];
    }
    if (!ok) {
      this.nonConverged++;
      // Не сошлось совсем — оставляем переходы как до шага, а не последнюю (возможно, негодную) итерацию
      this.junction = saved;
    }
    this.time += h;
    for (const c of this.scene.components) {
      if (!this.state(c.id).burned) part(c).remember?.(c, this);
    }
    return ok ? this.heat(h) : [];
  }

  private heat(dt: number): Component[] {
    const failed: Component[] = [];
    for (const c of this.scene.components) {
      const t = part(c).thermal;
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
