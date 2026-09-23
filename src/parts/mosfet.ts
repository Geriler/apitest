import { MOSFETS, mosfetPin, type Mosfet, type MosfetKind, type Pin } from "../model/types";
import { GMIN, VT, diodeBranch, junctionSettled, limitJunction } from "../sim/devices";
import { pinNode } from "../sim/nodes";
import type { Simulation } from "../sim/simulation";
import * as tolerance from "../sim/tolerance";
import type { Tolerance } from "../sim/tolerance";
import { transistorView } from "./transistor";
import { toolFor, type PartDef, type Stamp } from "./types";
import { holeLabel } from "../model/breadboard";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import { actualRow, fetSelect, mosfetPinNames, pill } from "../view/panel";

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

/** Токи и напряжения MOSFET из текущего решения. */
export function mosfetState(c: Mosfet, sim: Simulation): MosfetState {
  const m = mos(c, sim.tolerance);
  const v = (pin: Pin) => sim.solution.voltage.get(pinNode(c, pin));
  const [vg, vd, vs] = [v(m.g), v(m.d), v(m.s)];
  if (vg === undefined || vd === undefined || vs === undefined) return { id: 0, idiode: 0, vgs: 0, vds: 0, mode: "закрыт" };
  const vgs = m.sign * (vg - vs);
  const vds = m.sign * (vd - vs);
  if (sim.state(c.id).burned) return { id: 0, idiode: 0, vgs, vds, mode: "закрыт" };
  const id = mosfetChannel(m.k, m.vth, vgs, vds);
  const idiode = sim.solution.branches.get(`${c.id}:body`)?.current ?? 0;
  const vov = overdrive(vgs, m.vth);
  const mode: MosfetMode =
    idiode > 1e-4 && vds < 0 ? "диод" : Math.abs(id) < 1e-6 ? "закрыт" : Math.abs(vds) < vov ? "открыт" : "насыщение";
  return { id, idiode, vgs, vds, mode };
}

/**
 * MOSFET: ток канала линеаризуется в точке (Uзи, Uси): I ≈ I0 + gm·ΔUзи + gds·ΔUси
 * (производные — численно). Плюс паразитный диод, ёмкости затвора и его утечка. Для P-канала — всё с обратным знаком.
 */
function stampMosfet(c: Mosfet, sim: Simulation, { out, extras }: Stamp): void {
  const m = mos(c, sim.tolerance);
  const [G, D, S] = [pinNode(c, m.g), pinNode(c, m.d), pinNode(c, m.s)];
  const vgs0 = sim.junction.get(`${c.id}:vgs`) ?? 0;
  const vds0 = sim.junction.get(`${c.id}:vds`) ?? 0;
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
  const body = diodeBranch(BODY_DIODE, sim.junction.get(`${c.id}:body`) ?? 0);
  out.push(m.sign > 0 ? { id: `${c.id}:body`, a: S, b: D, ...body } : { id: `${c.id}:body`, a: D, b: S, ...body });
  // Ёмкости затвора; они же связывают затвор со схемой, даже если он ни к чему не подключён
  for (const [key, a, b, cap] of [
    [`${c.id}:cgs`, G, S, GATE_SOURCE_CAPACITANCE],
    [`${c.id}:cgd`, G, D, GATE_DRAIN_CAPACITANCE],
  ] as const) {
    out.push({ id: key, a, b, r: sim.h / cap, emf: -(sim.capVoltage.get(key) ?? 0) });
  }
  // Утечка затвора: по GMIN (1 пСм) к истоку и к стоку. Висящий затвор медленно уплывает к середине
  // между ними, τ = (Cзи + Cзс) / 2·GMIN ≈ 1,5 ч — как у настоящего, а не держит заряд вечно
  out.push({ id: `${c.id}:lgs`, a: G, b: S, r: 1 / GMIN });
  out.push({ id: `${c.id}:lgd`, a: G, b: D, r: 1 / GMIN });
}

/** Короткие имена выводов: затвор, сток, исток. */
const ROLE_RU = { G: "З", D: "С", S: "И" } as const;

export const mosfet: PartDef<Mosfet> = {
  type: "mosfet",
  prefix: "VT",
  pins: 3,
  onBoard: () => true,
  tools: [
    toolFor<Mosfet>()({
      id: "fet",
      group: "semi",
      icon: `<circle cx="16" cy="9" r="7.5" /><path d="M4 13h7M11 4v10M13.5 4v2.5M13.5 7.8v2.4M13.5 11.5v2.5M13.5 5.2h5V2M13.5 12.8h5V16M13.5 9h5v3.8M15 9l2-1.2v2.4z" />`,
      label: "MOSFET",
      title: "Полевой транзистор (MOSFET): 2N7000, BS250, IRLZ44N, IRF9540N",
      keys: ["m", "M", "ь", "Ь"],
      kbd: "M",
      settings: { kind: "2N7000" as MosfetKind },
      name: () => "MOSFET",
      note: (s) =>
        `<p class="sub">Полевой транзистор: управляется <b>напряжением</b> на затворе, ток через затвор не течёт. Ставьте резистор 10–100 кОм от затвора к истоку, иначе затвор «зависнет». Порядок ножек у корпусов разный: сейчас <b>${mosfetPinNames(s.kind)}</b>.</p>`,
      editor: (s) => fetSelect(s.kind),
      set(s, field, value) {
        if (field === "fet") s.kind = value as MosfetKind;
      },
      create: (s) => ({ type: "mosfet", kind: s.kind }),
      hint: (s) => `Нажмите на отверстие — MOSFET займёт его и два соседних справа: <b>${mosfetPinNames(s.kind)}</b>. F — перевернуть.`,
    }),
  ],
  polar: () => true,
  label: (c) => `MOSFET ${MOSFETS[c.kind].label}, I<sub>с</sub>`,
  value: (c) => MOSFETS[c.kind].label,
  burn: (c) => [
    `MOSFET ${c.id} сгорел`,
    `Больше ${String(MOSFETS[c.kind].maxP).replace(".", ",")} Вт без радиатора или ток выше предела. Полевой транзистор греется, когда приоткрыт: подайте на затвор полное напряжение или ограничьте ток нагрузкой.`,
  ],

  stamp(c, sim, s) {
    if (!sim.state(c.id).burned) stampMosfet(c, sim, s);
  },
  newton(c, sim) {
    const m = mos(c, sim.tolerance);
    const volt = (pin: Pin) => sim.solution.voltage.get(pinNode(c, pin)) ?? 0;
    let converged = true;
    // Шаг по Uзи и Uси ограничен (как fetlim/limvds в SPICE), чтобы Ньютон не перескакивал через порог
    const steps: [string, number, number][] = [
      [`${c.id}:vgs`, m.sign * (volt(m.g) - volt(m.s)), 0.5],
      [`${c.id}:vds`, m.sign * (volt(m.d) - volt(m.s)), 2],
    ];
    for (const [key, vterm, maxStep] of steps) {
      const vold = sim.junction.get(key) ?? 0;
      const vnew = vold + Math.max(-maxStep, Math.min(maxStep, vterm - vold));
      if (Math.abs(vnew - vold) > 1e-7) converged = false;
      sim.junction.set(key, vnew);
    }
    const br = sim.solution.branches.get(`${c.id}:body`)!;
    const vold = sim.junction.get(`${c.id}:body`) ?? 0;
    const target = -br.voltage - br.current * BODY_DIODE.rs;
    const vnew = limitJunction(target, vold, BODY_DIODE);
    if (!junctionSettled(BODY_DIODE, vold, vnew, target)) converged = false;
    sim.junction.set(`${c.id}:body`, vnew);
    return converged;
  },
  dynamic: true,
  remember(c, sim) {
    for (const key of [`${c.id}:cgs`, `${c.id}:cgd`]) sim.capVoltage.set(key, -sim.branch(key).voltage);
  },
  voltage: (c, sim) => sim.mosfet(c).vds,
  current(c, sim) {
    const f = sim.mosfet(c);
    return f.id - f.idiode;
  },
  power(c, sim) {
    const f = sim.mosfet(c);
    return Math.max(0, f.vds * f.id) + Math.max(0, -f.vds * f.idiode);
  },
  load(c, sim) {
    const spec = MOSFETS[c.kind];
    const f = sim.mosfet(c);
    const byI = Math.max(Math.abs(f.id), Math.abs(f.idiode)) / spec.maxId;
    const byP = sim.power(c) / spec.maxP;
    return byI >= byP
      ? { ratio: byI, what: "ток", limit: spec.maxId >= 1 ? `${spec.maxId} А` : `${spec.maxId * 1000} мА` }
      : { ratio: byP, what: "мощность", limit: `${String(spec.maxP).replace(".", ",")} Вт` };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  panel(c, sim) {
    const spec = MOSFETS[c.kind];
    const f = sim.mosfet(c);
    const n = spec.channel === "n";
    const rds = f.mode === "открыт" && Math.abs(f.id) > 1e-6 ? f.vds / f.id : undefined;
    return {
      title: `MOSFET ${spec.label} (${n ? "N" : "P"}-канал)`,
      body: `<div class="kv"><span>Ток затвора</span><span>0 А</span></div>
          <div class="kv"><span>Порог U<sub>пор</sub></span><span>${n ? "" : "−"}${String(spec.vth).replace(".", ",")} В</span></div>
          ${rds !== undefined ? `<div class="kv"><span>Сопротивление канала</span><span>${formatOhms(rds)}</span></div>` : ""}
          <div class="kv"><span>Мощность</span><span>${formatSI(sim.power(c), "Вт")}</span></div>
          <p class="sub">Управляется <b>напряжением</b> затвор–исток, ток через затвор не идёт. ${
            n ? "N-канал открывается, когда затвор выше истока больше чем на порог; исток — к минусу." : "P-канал открывается, когда затвор ниже истока больше чем на порог; исток — к плюсу."
          } Открытый канал — это малое сопротивление (${spec.rdsNote}). «Насыщение» у полевого транзистора — наоборот, приоткрытый режим: ток задаёт затвор, а не нагрузка. Затвор без стягивающего резистора «помнит» заряд: утечка (≈ 1 пСм к истоку и к стоку) уводит его к середине между ними только за часы. Внутри есть паразитный диод исток → сток. Выводы слева направо: ${mosfetPinNames(c.kind)}.</p>`,
      editor: fetSelect(c.kind),
    };
  },
  edit(c, field, value) {
    if (field === "fet") c.kind = value as MosfetKind;
  },
  readout(c, sim) {
    const f = sim.mosfet(c);
    return `<dl class="readout">
      <div><dt>U<sub>ЗИ</sub></dt><dd>${formatSI(f.vgs, "В")}</dd></div>
      <div><dt>I<sub>С</sub></dt><dd>${formatSI(sim.current(c), "А")}</dd></div>
      <div><dt>U<sub>СИ</sub></dt><dd>${formatSI(f.vds, "В")}</dd></div>
    </dl>`;
  },
  status(c, sim) {
    const mode = sim.mosfet(c).mode;
    if (mode === "диод") return pill("warn", "ТОК ЧЕРЕЗ ПАРАЗИТНЫЙ ДИОД");
    if (mode === "закрыт") return pill("warn", "ЗАКРЫТ");
    if (mode === "насыщение") return pill("ok", "НАСЫЩЕНИЕ — ТОК ЗАДАЁТ ЗАТВОР");
    return pill("ok", "ОТКРЫТ");
  },
  where: (c, holes) => MOSFETS[c.kind].pins.map((r, i) => `${ROLE_RU[r]} ${holeLabel(holes[i])}`).join(", "),
  actual(c, tol) {
    const m = tolerance.mosfetParams(c, tol);
    return actualRow("Порог этого экземпляра", `${MOSFETS[c.kind].channel === "p" ? "−" : ""}${formatSI(m.vth, "В")}`);
  },
  symbol3(c) {
    const arrow = MOSFETS[c.kind].channel === "n" ? `<path d="M-4 0L2 -3V3Z" class="fill"/>` : `<path d="M8 0L2 -3V3Z" class="fill"/>`;
    return {
      roles: { up: mosfetPin(c.kind, "D"), ctrl: mosfetPin(c.kind, "G"), down: mosfetPin(c.kind, "S") },
      body:
        `<circle r="17"/><path d="M-9 -10V10" /><path d="M-4 -11V-5M-4 -3V3M-4 5V11" class="thick"/>` +
        `<path d="M-4 -8H8V-17M-4 8H8V17M-4 0H8V8"/>${arrow}`,
      ctrlX: -9,
    };
  },
  // На схеме — ток канала, без паразитного диода
  schematicCurrent: (c, sim) => sim.mosfet(c).id,
  view: transistorView,
};
