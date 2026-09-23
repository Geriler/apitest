import { HOLE_BY_ID } from "../model/breadboard";
import {
  CERAMIC_RATED_V,
  DIODE_1N4007,
  ELECTROLYTIC_RATED_V,
  ELECTROLYTIC_REVERSE_V,
  LED_N,
  LED_RATED_A,
  LED_RS,
  MOSFETS,
  SWITCH_RESISTANCE,
  TRANSISTORS,
  WIRE_RESISTANCE,
  mosfetPin,
  ratedPower,
  type Component,
  type ComponentState,
  type Endpoint,
  type Mosfet,
  type Pin,
  type Scene,
  type Transistor,
} from "../model/types";
import { solveCircuit, type Branch, type BranchResult, type Extras, type Solution } from "./solver";
import * as tolerance from "./tolerance";
import { NO_TOLERANCE, type Tolerance } from "./tolerance";

/** Электрический узел вывода детали. На плате — узел полосы, иначе собственный узел вывода. */
export function pinNode(c: Component, pin: Pin): string {
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

/** Сопротивление нити лампы, Ом (с учётом допусков, если режим включён). */
export function lampResistance(c: Extract<Component, { type: "lamp" }>, tol: Tolerance = NO_TOLERANCE): number {
  return tolerance.lampResistance(c, tol);
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
export function diodeParams(c: Component, tol: Tolerance = NO_TOLERANCE): DiodeParams {
  if (c.type === "diode") return { ...DIODE_1N4007, is: tolerance.diodeIs(c, tol) };
  if (c.type === "led") {
    // Is подбирается так, чтобы при 20 мА на выводах было vf (с учётом падения на Rs).
    const vj = tolerance.ledVf(c, tol) - LED_RATED_A * LED_RS;
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
  transistor: { threshold: 1, rate: 0.6, cooling: 0.5 },
  mosfet: { threshold: 1, rate: 0.6, cooling: 0.5 },
};

/** С какой нагрузки деталь начинает перегреваться (0 — не греется). */
export function heatThreshold(c: Component): number {
  return THERMAL[c.type]?.threshold ?? 0;
}

/** Батарея считается замкнутой накоротко, если ток больше половины тока КЗ. */
export const SHORT_CIRCUIT_FRACTION = 0.5;

/** Шаг по времени при наличии конденсаторов, с. */
export const SUBSTEP = 0.005;

/** Режим работы транзистора. */
export type TransistorMode = "отсечка" | "усиление" | "насыщение" | "инверсный";

export interface TransistorState {
  /** Токи в «прямом» смысле: для n-p-n втекают в коллектор и базу, для p-n-p — вытекают. */
  ic: number;
  ib: number;
  ie: number;
  /** Напряжения в «прямом» смысле: для n-p-n Vбэ = Vб − Vэ, для p-n-p Vэб. */
  vbe: number;
  vce: number;
  vbc: number;
  mode: TransistorMode;
}

/**
 * Ёмкость переходов транзистора, Ф. У настоящего BC547 — единицы пикофарад; здесь намеренно 10 нФ:
 * без ёмкостей переключение мгновенное, и у схем с положительной обратной связью (мигалка, триггер)
 * в момент переключения нет непрерывного решения — метод Ньютона блуждает. С ёмкостью переключение
 * занимает микросекунды, для глаза это всё равно мгновенно.
 */
export const JUNCTION_CAPACITANCE = 10e-9;

/** Модель транзистора: знак (+1 n-p-n, −1 p-n-p) и параметры Эберса–Молла. */
function bjt(c: Transistor, tol: Tolerance) {
  const t = TRANSISTORS[c.kind];
  const sign = t.polarity === "npn" ? 1 : -1;
  return {
    sign,
    is: t.is,
    /** Переходы как диоды: ток базы через каждый — Is/β. */
    be: { is: t.is / tolerance.betaF(c, tol), n: 1, rs: 0 },
    bc: { is: t.is / t.betaR, n: 1, rs: 0 },
    /** Для ограничения шага: весь ток перехода, а не только базовая часть. */
    junction: { is: t.is, n: 1, rs: 0 },
  };
}

// ─── MOSFET ────────────────────────────────────────────────────────────────

/** Режим MOSFET. «Насыщение» у полевого транзистора — это НЕ «полностью открыт», как у биполярного. */
export type MosfetMode = "закрыт" | "открыт" | "насыщение" | "диод";

export interface MosfetState {
  /** Ток стока в «прямом» смысле (для N — втекает в сток, для P — вытекает), без учёта паразитного диода. */
  id: number;
  /** Ток через паразитный диод (в его прямом направлении), А. */
  idiode: number;
  /** Для N: Uзи, Uси; для P — с обратным знаком (Uиз, Uис). */
  vgs: number;
  vds: number;
  mode: MosfetMode;
}

/** Коэффициент наклона в подпороговой области (как n в уравнении диода). */
const MOS_N = 1.5;

/** Плавное «превышение над порогом»: ≈ Uзи − Uпор выше порога и экспоненциально мало ниже. */
function overdrive(vgs: number, vth: number): number {
  const s = 2 * MOS_N * VT;
  const x = (vgs - vth) / s;
  return s * (x > 30 ? x : Math.log1p(Math.exp(x)));
}

/**
 * Ток канала для N-MOSFET при Uзи, Uси ≥ 0 (сток и исток симметричны: при Uси < 0 они меняются ролями).
 * Омическая область: K·(Vov·Uси − Uси²/2); насыщение (Uси ≥ Vov): K/2·Vov².
 */
export function mosfetChannel(k: number, vth: number, vgs: number, vds: number): number {
  if (vds < 0) return -mosfetChannel(k, vth, vgs - vds, -vds);
  const vov = overdrive(vgs, vth);
  return vds < vov ? k * (vov * vds - (vds * vds) / 2) : (k / 2) * vov * vov;
}

/**
 * Ёмкости затвора, Ф. У 2N7000 входная ёмкость — десятки пикофарад, у IRLZ44N ≈ 1,7 нФ; здесь 10 нФ
 * у всех — как у биполярных, для сходимости на переключениях. Соотношение как у настоящих MOSFET:
 * затвор–сток примерно в 10 раз меньше, чем затвор–исток. Поэтому «висящий» затвор при стоке на 9 В
 * наводкой поднимается примерно до 0,8 В — ниже порога (при равных ёмкостях было бы 4,5 В).
 */
export const GATE_SOURCE_CAPACITANCE = 10e-9;
export const GATE_DRAIN_CAPACITANCE = 1e-9;

/** Паразитный диод исток → сток (для N-канала). */
const BODY_DIODE = { is: 1e-13, n: 1, rs: 0.01 };

function mos(c: Mosfet, tol: Tolerance) {
  const spec = MOSFETS[c.kind];
  return {
    spec,
    ...tolerance.mosfetParams(c, tol),
    sign: spec.channel === "n" ? 1 : -1,
    g: mosfetPin(c.kind, "G"),
    d: mosfetPin(c.kind, "D"),
    s: mosfetPin(c.kind, "S"),
  };
}

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
    return this.scene.components.some(
      (c) => (c.type === "capacitor" || c.type === "transistor" || c.type === "mosfet") && !this.state(c.id).burned,
    );
  }

  /** Схема для решателя при заданных линеаризациях диодов и транзисторов и шаге h для конденсаторов. */
  private branches(h: number): { out: Branch[]; extras: Required<Extras> } {
    this.h = h;
    const out: Branch[] = [];
    const extras: Required<Extras> = { currents: [], vccs: [] };
    for (const c of this.scene.components) {
      const a = pinNode(c, 0);
      const b = pinNode(c, 1);
      const burned = this.state(c.id).burned;
      const open = { id: c.id, a, b, r: Infinity };
      if (c.type === "transistor") {
        if (!burned) this.transistorStamps(c, out, extras);
        continue;
      }
      if (c.type === "mosfet") {
        if (!burned) this.mosfetStamps(c, out, extras);
        continue;
      }
      if (burned && c.type !== "battery" && c.type !== "switch") {
        out.push(open);
        continue;
      }
      switch (c.type) {
        case "resistor":
          out.push({ id: c.id, a, b, r: tolerance.resistance(c, this.tolerance) });
          break;
        case "lamp":
          out.push({ id: c.id, a, b, r: lampResistance(c, this.tolerance) });
          break;
        case "battery": {
          const bat = tolerance.battery(c, this.tolerance);
          // Вывод 0 — минус, вывод 1 — плюс.
          out.push({ id: c.id, a, b, r: bat.rInt, emf: bat.emf });
          break;
        }
        case "switch":
          out.push({ id: c.id, a, b, r: c.closed ? SWITCH_RESISTANCE : Infinity });
          break;
        case "capacitor": {
          // Неявный метод Эйлера: I = C·(v − v_пред)/h → ветвь с r = h/C и ЭДС −v_пред.
          const C = tolerance.capacitance(c, this.tolerance);
          out.push({ id: c.id, a, b, r: h / C, emf: -(this.capVoltage.get(c.id) ?? 0) });
          break;
        }
        case "diode":
        case "led": {
          const p = diodeParams(c, this.tolerance);
          const { r, emf } = diodeBranch(p, this.junction.get(c.id) ?? 0);
          out.push({ id: c.id, a, b, r, emf });
          break;
        }
      }
    }
    for (const w of this.scene.wires) {
      out.push({ id: w.id, a: endpointNode(this.scene, w.a), b: endpointNode(this.scene, w.b), r: WIRE_RESISTANCE });
    }
    return { out, extras };
  }

  /**
   * Транзистор по Эберсу–Моллу: два перехода как диоды (дают ток базы) и ток переноса
   * коллектор → эмиттер It = Is·(e^(Vбэ/Vt) − e^(Vбк/Vt)), линеаризованный в текущей точке.
   * Для p-n-p все напряжения и токи с обратным знаком.
   */
  private transistorStamps(c: Transistor, out: Branch[], extras: Required<Extras>): void {
    const m = bjt(c, this.tolerance);
    const [C, B, E] = [pinNode(c, 0), pinNode(c, 1), pinNode(c, 2)];
    const vbe0 = this.junction.get(`${c.id}:be`) ?? 0;
    const vbc0 = this.junction.get(`${c.id}:bc`) ?? 0;
    // Переходы: у n-p-n анод — база, у p-n-p — эмиттер/коллектор
    const be = diodeBranch(m.be, vbe0);
    const bc = diodeBranch(m.bc, vbc0);
    out.push(m.sign > 0 ? { id: `${c.id}:be`, a: B, b: E, ...be } : { id: `${c.id}:be`, a: E, b: B, ...be });
    out.push(m.sign > 0 ? { id: `${c.id}:bc`, a: B, b: C, ...bc } : { id: `${c.id}:bc`, a: C, b: B, ...bc });
    // Ёмкости переходов (неявный метод Эйлера, как у конденсатора)
    for (const [key, a, b] of [[`${c.id}:cbe`, B, E], [`${c.id}:cbc`, B, C]] as const) {
      out.push({ id: key, a, b, r: this.h / JUNCTION_CAPACITANCE, emf: -(this.capVoltage.get(key) ?? 0) });
    }
    const ef = Math.exp(vbe0 / VT);
    const er = Math.exp(vbc0 / VT);
    const gf = (m.is / VT) * ef;
    const gr = (m.is / VT) * er;
    const it0 = m.is * (ef - er);
    // I(К→Э) = знак·(It0 − gf·vbe0 + gr·vbc0) + gf·(Vб − Vэ) − gr·(Vб − Vк)
    extras.currents.push({ a: C, b: E, j: m.sign * (it0 - gf * vbe0 + gr * vbc0) });
    extras.vccs.push({ a: C, b: E, cp: B, cn: E, g: gf });
    extras.vccs.push({ a: C, b: E, cp: B, cn: C, g: -gr });
  }

  /**
   * MOSFET: ток канала линеаризуется в точке (Uзи, Uси): I ≈ I0 + gm·ΔUзи + gds·ΔUси
   * (производные — численно). Плюс паразитный диод и ёмкости затвора. Для P-канала — всё с обратным знаком.
   */
  private mosfetStamps(c: Mosfet, out: Branch[], extras: Required<Extras>): void {
    const m = mos(c, this.tolerance);
    const [G, D, S] = [pinNode(c, m.g), pinNode(c, m.d), pinNode(c, m.s)];
    const vgs0 = this.junction.get(`${c.id}:vgs`) ?? 0;
    const vds0 = this.junction.get(`${c.id}:vds`) ?? 0;
    const f = (vgs: number, vds: number) => mosfetChannel(m.k, m.vth, vgs, vds);
    const i0 = f(vgs0, vds0);
    const dv = 1e-6;
    const gm = (f(vgs0 + dv, vds0) - f(vgs0 - dv, vds0)) / (2 * dv);
    const gds = (f(vgs0, vds0 + dv) - f(vgs0, vds0 - dv)) / (2 * dv) + GMIN;
    // I(С→И) = знак·(I0 − gm·vgs0 − gds·vds0) + gm·(Vз − Vи) + gds·(Vс − Vи)
    extras.currents.push({ a: D, b: S, j: m.sign * (i0 - gm * vgs0 - gds * vds0) });
    extras.vccs.push({ a: D, b: S, cp: G, cn: S, g: gm });
    extras.vccs.push({ a: D, b: S, cp: D, cn: S, g: gds });
    // Паразитный диод: у N — анод исток, у P — анод сток
    const body = diodeBranch(BODY_DIODE, this.junction.get(`${c.id}:body`) ?? 0);
    out.push(m.sign > 0 ? { id: `${c.id}:body`, a: S, b: D, ...body } : { id: `${c.id}:body`, a: D, b: S, ...body });
    // Ёмкости затвора; они же связывают затвор со схемой, даже если он ни к чему не подключён
    for (const [key, a, b, cap] of [
      [`${c.id}:cgs`, G, S, GATE_SOURCE_CAPACITANCE],
      [`${c.id}:cgd`, G, D, GATE_DRAIN_CAPACITANCE],
    ] as const) {
      out.push({ id: key, a, b, r: this.h / cap, emf: -(this.capVoltage.get(key) ?? 0) });
    }
  }

  /** Токи и напряжения MOSFET из текущего решения. */
  mosfet(c: Mosfet): MosfetState {
    const m = mos(c, this.tolerance);
    const v = (pin: Pin) => this.solution.voltage.get(pinNode(c, pin));
    const [vg, vd, vs] = [v(m.g), v(m.d), v(m.s)];
    if (vg === undefined || vd === undefined || vs === undefined) return { id: 0, idiode: 0, vgs: 0, vds: 0, mode: "закрыт" };
    const vgs = m.sign * (vg - vs);
    const vds = m.sign * (vd - vs);
    if (this.state(c.id).burned) return { id: 0, idiode: 0, vgs, vds, mode: "закрыт" };
    const id = mosfetChannel(m.k, m.vth, vgs, vds);
    const idiode = this.solution.branches.get(`${c.id}:body`)?.current ?? 0;
    const vov = overdrive(vgs, m.vth);
    const mode: MosfetMode =
      idiode > 1e-4 && vds < 0 ? "диод" : Math.abs(id) < 1e-6 ? "закрыт" : Math.abs(vds) < vov ? "открыт" : "насыщение";
    return { id, idiode, vgs, vds, mode };
  }

  /** Токи и напряжения транзистора из текущего решения. */
  transistor(c: Transistor): TransistorState {
    const zero: TransistorState = { ic: 0, ib: 0, ie: 0, vbe: 0, vce: 0, vbc: 0, mode: "отсечка" };
    const v = (pin: Pin) => this.solution.voltage.get(pinNode(c, pin));
    const [vc, vb, ve] = [v(0), v(1), v(2)];
    if (vc === undefined || vb === undefined || ve === undefined) return zero;
    const m = bjt(c, this.tolerance);
    const vbe = m.sign * (vb - ve);
    const vbc = m.sign * (vb - vc);
    if (this.state(c.id).burned) return { ...zero, vbe, vbc, vce: vbe - vbc };
    const ibe = this.solution.branches.get(`${c.id}:be`)?.current ?? 0;
    const ibc = this.solution.branches.get(`${c.id}:bc`)?.current ?? 0;
    const it = m.is * (Math.exp(vbe / VT) - Math.exp(vbc / VT));
    const ic = it - ibc;
    const ib = ibe + ibc;
    const mode: TransistorMode =
      Math.abs(ic) < 1e-6 && Math.abs(ib) < 1e-6
        ? "отсечка"
        : vbe < 0.3 && vbc > 0.4
          ? "инверсный"
          : vbc > 0.4
            ? "насыщение"
            : "усиление";
    return { ic, ib, ie: ic + ib, vbe, vbc, vce: vbe - vbc, mode };
  }

  /**
   * Сколько ещё итераций Ньютона можно потратить на текущий вызов step(). Обычный шаг тратит
   * десятки итераций; бюджет срабатывает только на схемах, которые не сходятся.
   */
  private budget = Infinity;

  /** Текущий шаг по времени, с (для ёмкостей). */
  private h = SUBSTEP;

  /** Сколько решений не сошлось (для тестов и отладки). */
  nonConverged = 0;

  /**
   * Решение с итерациями Ньютона по диодам и транзисторам. Заряд конденсаторов не меняется.
   * Возвращает false, если за 100 итераций не сошлось (бывает на резких переключениях).
   */
  private solveAt(h: number): boolean {
    const diodes = this.scene.components.filter((c) => (c.type === "diode" || c.type === "led") && !this.state(c.id).burned);
    const bjts = this.scene.components.filter((c): c is Transistor => c.type === "transistor" && !this.state(c.id).burned);
    const fets = this.scene.components.filter((c): c is Mosfet => c.type === "mosfet" && !this.state(c.id).burned);
    for (let iter = 1; iter <= 100; iter++) {
      const { out, extras } = this.branches(h);
      this.solution = solveCircuit(out, [], extras);
      this.lastIterations = iter;
      if (--this.budget < 0) return false;
      let converged = true;
      for (const t of fets) {
        const m = mos(t, this.tolerance);
        const volt = (pin: Pin) => this.solution.voltage.get(pinNode(t, pin)) ?? 0;
        // Шаг по Uзи и Uси ограничен (как fetlim/limvds в SPICE), чтобы Ньютон не перескакивал через порог
        const steps: [string, number, number][] = [
          [`${t.id}:vgs`, m.sign * (volt(m.g) - volt(m.s)), 0.5],
          [`${t.id}:vds`, m.sign * (volt(m.d) - volt(m.s)), 2],
        ];
        for (const [key, vterm, maxStep] of steps) {
          const vold = this.junction.get(key) ?? 0;
          const vnew = vold + Math.max(-maxStep, Math.min(maxStep, vterm - vold));
          if (Math.abs(vnew - vold) > 1e-7) converged = false;
          this.junction.set(key, vnew);
        }
        const br = this.solution.branches.get(`${t.id}:body`)!;
        const vold = this.junction.get(`${t.id}:body`) ?? 0;
        const vnew = limitJunction(-br.voltage - br.current * BODY_DIODE.rs, vold, BODY_DIODE);
        if (Math.abs(vnew - vold) > 1e-7) converged = false;
        this.junction.set(`${t.id}:body`, vnew);
      }
      for (const t of bjts) {
        const m = bjt(t, this.tolerance);
        const volt = (pin: Pin) => this.solution.voltage.get(pinNode(t, pin)) ?? 0;
        const targets: [string, number][] = [
          [`${t.id}:be`, m.sign * (volt(1) - volt(2))],
          [`${t.id}:bc`, m.sign * (volt(1) - volt(0))],
        ];
        for (const [key, vterm] of targets) {
          const vold = this.junction.get(key) ?? 0;
          const vnew = limitJunction(vterm, vold, m.junction);
          if (Math.abs(vnew - vold) > 1e-7) converged = false;
          this.junction.set(key, vnew);
        }
      }
      for (const d of diodes) {
        const p = diodeParams(d, this.tolerance);
        const br = this.solution.branches.get(d.id)!;
        const vold = this.junction.get(d.id) ?? 0;
        // Напряжение на выводах минус падение на Rs — напряжение на переходе
        const vterm = -br.voltage;
        const vnew = limitJunction(vterm - br.current * p.rs, vold, p);
        if (Math.abs(vnew - vold) > 1e-7) converged = false;
        this.junction.set(d.id, vnew);
      }
      if (converged) return true;
    }
    return false;
  }

  /** Пересчитать токи. Вызывать после любого изменения сцены. */
  solve(): void {
    for (const c of this.scene.components) this.state(c.id);
    const alive = new Set(this.scene.components.map((c) => c.id));
    for (const m of [this.states, this.capVoltage, this.junction]) {
      for (const key of [...m.keys()]) if (!alive.has(key.split(":")[0])) m.delete(key);
    }
    this.solveAt(SUBSTEP);
  }

  branch(id: string): BranchResult {
    return this.solution.branches.get(id) ?? { current: 0, voltage: 0, power: 0 };
  }

  /** Напряжение между выводами 0 и 1 (V0 − V1), В. Для диода — прямое напряжение. */
  voltage(c: Component): number {
    if (c.type === "capacitor") return this.capVoltage.get(c.id) ?? 0;
    if (c.type === "transistor") return this.transistor(c).vce;
    if (c.type === "mosfet") return this.mosfet(c).vds;
    return -this.branch(c.id).voltage;
  }

  /** Ток от вывода 0 к выводу 1 через деталь, А. */
  current(c: Component): number {
    if (c.type === "transistor") return this.transistor(c).ic;
    if (c.type === "mosfet") {
      const f = this.mosfet(c);
      return f.id - f.idiode;
    }
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
      case "transistor": {
        const t = this.transistor(c);
        return Math.max(0, t.vce * t.ic + t.vbe * t.ib);
      }
      case "mosfet": {
        const f = this.mosfet(c);
        return Math.max(0, f.vds * f.id) + Math.max(0, -f.vds * f.idiode);
      }
      case "battery": {
        // Мощность, которую батарея отдаёт в цепь
        const bat = tolerance.battery(c, this.tolerance);
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
    return 0.5 * tolerance.capacitance(c, this.tolerance) * v * v;
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
      case "mosfet": {
        const spec = MOSFETS[c.kind];
        const f = this.mosfet(c);
        const byI = Math.max(Math.abs(f.id), Math.abs(f.idiode)) / spec.maxId;
        const byP = this.power(c) / spec.maxP;
        return byI >= byP
          ? { ratio: byI, what: "ток", limit: spec.maxId >= 1 ? `${spec.maxId} А` : `${spec.maxId * 1000} мА` }
          : { ratio: byP, what: "мощность", limit: `${String(spec.maxP).replace(".", ",")} Вт` };
      }
      case "transistor": {
        const spec = TRANSISTORS[c.kind];
        const t = this.transistor(c);
        const byI = Math.abs(t.ic) / spec.maxIc;
        const byP = this.power(c) / spec.maxP;
        return byI >= byP
          ? { ratio: byI, what: "ток", limit: `${spec.maxIc * 1000} мА` }
          : { ratio: byP, what: "мощность", limit: `${spec.maxP} Вт` };
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
    const bat = tolerance.battery(c, this.tolerance);
    return Math.abs(this.branch(c.id).current) > SHORT_CIRCUIT_FRACTION * (bat.emf / bat.rInt);
  }

  /** Диод включён в обратную сторону и заметное напряжение приложено против него. */
  isReversed(c: Component): boolean {
    if (c.type === "diode" || c.type === "led") return this.voltage(c) < -0.5;
    if (c.type === "capacitor" && c.variant === "electrolytic") return this.voltage(c) < -0.2;
    if (c.type === "transistor") return this.transistor(c).mode === "инверсный";
    return false;
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
    if (!ok) this.nonConverged++;
    for (const c of this.scene.components) {
      if (this.state(c.id).burned) continue;
      if (c.type === "capacitor") this.capVoltage.set(c.id, -this.branch(c.id).voltage);
      if (c.type === "transistor") {
        for (const key of [`${c.id}:cbe`, `${c.id}:cbc`]) this.capVoltage.set(key, -this.branch(key).voltage);
      }
      if (c.type === "mosfet") {
        for (const key of [`${c.id}:cgs`, `${c.id}:cgd`]) this.capVoltage.set(key, -this.branch(key).voltage);
      }
    }
    return ok ? this.heat(h) : [];
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
