import * as THREE from "three";
import type { Oscilloscope } from "../model/types";
import { pinNode } from "../sim/nodes";
import { formatSI } from "../sim/resistorCodes";
import type { Simulation } from "../sim/simulation";
import { type ComponentView, disposeGroup, freeTransform, mm, tagPickable } from "../view/kit";
import { pill, selectField } from "../view/panel";
import { toolFor, type PartDef } from "./types";

/** Входное сопротивление канала, Ом (щуп 1:1). */
export const SCOPE_R = 1e6;
/** Развёртки, с/дел. Мельче 10 мс/дел не бывает: расчёт идёт шагами по 5 мс. */
export const TIME_DIVS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2];
/** Чувствительности, В/дел. */
export const VOLT_DIVS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
/** Сколько секунд записи хранить: 10 делений самой медленной развёртки. */
const KEEP = 10 * TIME_DIVS[TIME_DIVS.length - 1];
/** Цвета каналов: как у щупов. */
export const CHANNEL_COLORS = ["#e3b21c", "#2fb8d1"];

/** Запись: время и напряжения каналов относительно общего провода. */
interface Recording {
  t: number[];
  v: [number[], number[]];
}

/** Картинка экрана в делениях: x 0…10 слева направо, y 0…8 снизу вверх. */
export interface ScopeFrame {
  /** Где на экране 0 В (в делениях снизу). */
  ground: number;
  channels: { points: [number, number][]; vdiv: number; now: number }[];
}

/** Напряжения каналов сейчас: канал минус общий провод. */
function channelVolts(c: Oscilloscope, sim: Simulation): [number, number] {
  const v = (p: 0 | 1 | 2) => sim.solution.voltage.get(pinNode(c, p)) ?? 0;
  return [v(1) - v(0), v(2) - v(0)];
}

function record(c: Oscilloscope, sim: Simulation): Recording {
  let r = sim.memory.get(c.id) as Recording | undefined;
  if (!r) {
    r = { t: [], v: [[], []] };
    sim.memory.set(c.id, r);
  }
  return r;
}

/** Картинка для экрана: последние 10 делений записи (самописец — новое справа). */
export function scopeFrame(c: Oscilloscope, sim: Simulation): ScopeFrame {
  const r = record(c, sim);
  const window = 10 * c.timeDiv;
  const end = r.t.length ? r.t[r.t.length - 1] : sim.time;
  const start = end - window;
  let from = r.t.length;
  while (from > 0 && r.t[from - 1] >= start) from--;
  const now = channelVolts(c, sim);
  // Есть отрицательные напряжения — ноль посередине, иначе на одно деление выше низа
  let min = 0;
  for (const ch of r.v) for (let i = from; i < ch.length; i++) min = Math.min(min, ch[i]);
  const ground = min < -1e-3 ? 4 : 1;
  const channels = r.v.map((ch, k) => {
    let vdiv = c.voltsDiv[k];
    if (!vdiv) {
      let peak = 0;
      for (let i = from; i < ch.length; i++) peak = Math.max(peak, ch[i] > 0 ? ch[i] / (8 - ground) : -ch[i] / Math.max(ground, 1));
      vdiv = peak < 1e-6 ? 1 : (VOLT_DIVS.find((d) => d * 0.95 >= peak) ?? VOLT_DIVS[VOLT_DIVS.length - 1]);
    }
    // Не больше двух точек (минимум и максимум) на каждую из 250 колонок: всплески не теряются
    const points: [number, number][] = [];
    const cols = 250;
    let col = -1;
    let lo = 0, hi = 0, tlo = 0, thi = 0;
    const flush = () => {
      if (col < 0) return;
      const y = (v: number) => Math.max(-0.2, Math.min(8.2, ground + v / vdiv));
      const x = (t: number) => ((t - start) / window) * 10;
      if (tlo <= thi) points.push([x(tlo), y(lo)], [x(thi), y(hi)]);
      else points.push([x(thi), y(hi)], [x(tlo), y(lo)]);
    };
    for (let i = from; i < ch.length; i++) {
      const cc = Math.min(cols - 1, Math.floor(((r.t[i] - start) / window) * cols));
      if (cc !== col) {
        flush();
        col = cc;
        lo = hi = ch[i];
        tlo = thi = r.t[i];
      } else {
        if (ch[i] < lo) [lo, tlo] = [ch[i], r.t[i]];
        if (ch[i] > hi) [hi, thi] = [ch[i], r.t[i]];
      }
    }
    flush();
    return { points, vdiv, now: now[k] };
  });
  return { ground, channels };
}

const fmtTime = (s: number) => formatSI(s, "с");

export const scope: PartDef<Oscilloscope> = {
  type: "scope",
  prefix: "P",
  pins: 3,
  onBoard: () => false,
  tools: [
    toolFor<Oscilloscope>()({
      id: "scope",
      group: "instruments",
      icon: `<rect x="3" y="2" width="24" height="14" rx="1.5" /><path d="M6 11c2-6 4-6 6 0s4 6 6 0 3-5 5-2" />`,
      label: "Осциллограф",
      title: "Осциллограф: напряжение во времени, два канала",
      settings: { timeDiv: 0.1 },
      name: () => "Осциллограф",
      note: () =>
        `<p class="sub">Рисует, как меняется напряжение: заряд конденсатора, переключения мигалки. Два канала (жёлтый и голубой) и общий провод (чёрный) — его подключают к минусу схемы. Щупы — провода от гнёзд прибора.</p>`,
      editor: (s) => timeSelect(s.timeDiv),
      set(s, field, value) {
        if (field === "scopeTime") s.timeDiv = Number(value);
      },
      create: (s) => ({ type: "scope", timeDiv: s.timeDiv, voltsDiv: [0, 0] }),
      hint: () => "Нажмите на стол рядом с платой, потом протяните провода от гнёзд: чёрный — к минусу, жёлтый и голубой — к точкам, которые смотрите. R — повернуть.",
      boardRefusal: "Осциллограф стоит на столе. Щупы — провода от его гнёзд к точкам схемы.",
    }),
  ],
  polar: () => true,
  noFlip: true,
  label: () => "осциллограф",
  value: (c) => `${fmtTime(c.timeDiv)}/дел`,
  symbol3: () => ({
    roles: { up: 1, ctrl: 2, down: 0 },
    body: `<circle r="17"/><path d="M-10 0C-7 -9 -3 -9 0 0S7 9 10 0" class="thin"/>`,
    ctrlX: -17,
  }),
  schematicCurrent: () => 0,
  leadColors: ["#1b1d20", ...CHANNEL_COLORS],
  burn: (c) => [`${c.id} вышел из строя`, ""],
  view: scopeView,

  stamp(c, _sim, { out }) {
    const [g, a, b] = [pinNode(c, 0), pinNode(c, 1), pinNode(c, 2)];
    out.push({ id: `${c.id}:ch1`, a: g, b: a, r: SCOPE_R });
    out.push({ id: `${c.id}:ch2`, a: g, b, r: SCOPE_R });
  },
  // Запись идёт на каждом шаге по времени (5 мс), поэтому прибор включает пошаговый расчёт
  dynamic: true,
  remember(c, sim) {
    if (c.hold) return;
    const r = record(c, sim);
    const [v1, v2] = channelVolts(c, sim);
    r.t.push(sim.time);
    r.v[0].push(v1);
    r.v[1].push(v2);
    // Старое — выбросить разом, когда накопится
    if (r.t.length > 2000 && r.t[0] < sim.time - KEEP - 1) {
      let i = 0;
      while (r.t[i] < sim.time - KEEP) i++;
      r.t.splice(0, i);
      r.v[0].splice(0, i);
      r.v[1].splice(0, i);
    }
  },
  voltage: (c, sim) => channelVolts(c, sim)[0],
  current: () => 0,
  power: () => 0,
  visual: (c, sim) => ({ screen: () => scopeFrame(c, sim) }),
  toggle(c) {
    c.hold = !c.hold;
  },

  panel(c, sim) {
    const f = scopeFrame(c, sim);
    const W = 300, H = 240, px = 30;
    const grid: string[] = [];
    for (let i = 1; i < 10; i++) grid.push(`M${i * px} 0V${H}`);
    for (let i = 1; i < 8; i++) grid.push(`M0 ${i * px}H${W}`);
    const lines = f.channels
      .map((ch, k) =>
        ch.points.length
          ? `<polyline fill="none" stroke="${CHANNEL_COLORS[k]}" stroke-width="1.6" stroke-linejoin="round" points="${ch.points
              .map(([x, y]) => `${(x * px).toFixed(1)},${(H - y * px).toFixed(1)}`)
              .join(" ")}"/>`
          : "",
      )
      .join("");
    const gy = H - f.ground * px;
    const svg = `<svg class="scope-screen" viewBox="0 0 ${W} ${H}" role="img" aria-label="Экран осциллографа">
      <rect width="${W}" height="${H}" fill="#0c1410"/>
      <path d="${grid.join("")}" stroke="#23372c" stroke-width="1"/>
      <path d="M0 ${gy}H8M${W - 8} ${gy}H${W}" stroke="#7d8f84" stroke-width="2"/>
      ${lines}</svg>`;
    const legend = f.channels
      .map(
        (ch, k) =>
          `<div class="kv"><span><i class="dot" style="background:${CHANNEL_COLORS[k]}"></i> Канал ${k + 1}: ${formatSI(ch.vdiv, "В")}/дел${c.voltsDiv[k] ? "" : " (авто)"}</span><span>${formatSI(Math.abs(ch.now) < 1e-4 ? 0 : ch.now, "В")}</span></div>`,
      )
      .join("");
    return {
      title: "Осциллограф",
      body: `${svg}${legend}
        <div class="kv"><span>Развёртка</span><span>${fmtTime(c.timeDiv)}/дел, на экране ${fmtTime(10 * c.timeDiv)}</span></div>
        <div class="row"><button class="btn inline" data-act="toggle" id="btn-scope-run">${c.hold ? "Пуск" : "Стоп"}</button></div>
        <p class="sub">Самописец: новое появляется справа. Напряжение каналов — относительно общего (чёрного) провода, его подключают к минусу схемы; без него прибор ничего не покажет. Вход 1 МОм на канал.</p>`,
      editor:
        timeSelect(c.timeDiv) +
        [0, 1].map((k) => selectField(`scopeV${k + 1}`, `Канал ${k + 1}, В/дел`, [["0", "авто"], ...VOLT_DIVS.map((d): [string, string] => [String(d), formatSI(d, "В")])], String(c.voltsDiv[k]))).join(""),
    };
  },
  edit(c, field, value) {
    if (field === "scopeTime") c.timeDiv = Number(value);
    if (field === "scopeV1") c.voltsDiv = [Number(value), c.voltsDiv[1]];
    if (field === "scopeV2") c.voltsDiv = [c.voltsDiv[0], Number(value)];
  },
  readout(c, sim) {
    const [v1, v2] = channelVolts(c, sim);
    const f = (v: number) => formatSI(Math.abs(v) < 1e-4 ? 0 : v, "В");
    return `<dl class="readout">
      <div><dt>К1</dt><dd>${f(v1)}</dd></div>
      <div><dt>К2</dt><dd>${f(v2)}</dd></div>
      <div><dt>t</dt><dd>${fmtTime(c.timeDiv)}/д</dd></div>
    </dl>`;
  },
  status: (c) => (c.hold ? pill("warn", "СТОП — КАРТИНКА ЗАМЕРЛА") : pill("ok", "ИДЁТ ЗАПИСЬ")),
};

function timeSelect(timeDiv: number): string {
  return selectField("scopeTime", "Развёртка", TIME_DIVS.map((d) => [String(d), `${fmtTime(d)}/дел (экран ${fmtTime(10 * d)})`]), String(timeDiv));
}

// ─── 3D: осциллограф ────────────────────────────────────────────────────────

/** Передняя панель: экран с сеткой 10 × 8 и лучами, подписи гнёзд. */
class ScopeFace {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;

  constructor() {
    this.canvas.width = 800;
    this.canvas.height = 500;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  draw(f: ScopeFrame | undefined): void {
    const g = this.canvas.getContext("2d")!;
    g.fillStyle = "#3a4046";
    g.fillRect(0, 0, 800, 500);
    // Экран 500 × 400: по 50 пикселей на деление
    const X = 30, Y = 30, D = 50;
    g.fillStyle = "#0c1410";
    g.fillRect(X, Y, 10 * D, 8 * D);
    g.strokeStyle = "#23372c";
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 1; i < 10; i++) g.moveTo(X + i * D, Y), g.lineTo(X + i * D, Y + 8 * D);
    for (let i = 1; i < 8; i++) g.moveTo(X, Y + i * D), g.lineTo(X + 10 * D, Y + i * D);
    g.stroke();
    if (f) {
      g.lineWidth = 4;
      g.lineJoin = "round";
      f.channels.forEach((ch, k) => {
        if (!ch.points.length) return;
        g.strokeStyle = CHANNEL_COLORS[k];
        g.beginPath();
        ch.points.forEach(([x, y], i) => (i ? g.lineTo(X + x * D, Y + (8 - y) * D) : g.moveTo(X + x * D, Y + (8 - y) * D)));
        g.stroke();
      });
    }
    // Подписи гнёзд и ручки
    g.fillStyle = "#cfd5d9";
    g.font = `600 28px "IBM Plex Sans", system-ui, sans-serif`;
    g.textAlign = "center";
    ["⏚", "CH1", "CH2"].forEach((t, i) => g.fillText(t, SCOPE_JACKS[i], 380));
    g.font = `500 22px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText("TIME/DIV", 640, 80);
    g.fillText("VOLTS/DIV", 640, 230);
    this.texture.needsUpdate = true;
  }
}

/** Гнёзда (x в пикселях панели 800 × 500, на высоте 440): общий, канал 1, канал 2. */
const SCOPE_JACKS = [570, 650, 730];

/** Настольный осциллограф 80 × 50 × 45 мм, экран смотрит в +Z; гнёзда внизу справа. */
function scopeView(c: Oscilloscope): ComponentView {
  if (c.placement.mode !== "free") throw new Error("Осциллограф стоит только на столе");
  const group = new THREE.Group();
  const W = mm(80), H = mm(50), Dp = mm(45);
  const face = new ScopeFace();
  face.draw(undefined);
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.2 });
  const faceMat = new THREE.MeshStandardMaterial({
    map: face.texture,
    roughness: 0.6,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: face.texture,
    emissiveIntensity: 0.35,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, Dp), [caseMat, caseMat, caseMat, caseMat, faceMat, caseMat]);
  box.position.y = H / 2;
  group.add(box);
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4 });
  for (const v of [140 / 500, 290 / 500]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(mm(4), mm(4.3), mm(4), 24), knobMat);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(-W / 2 + (640 / 800) * W, H - v * H, Dp / 2 + mm(2));
    group.add(knob);
  }
  const pins: THREE.Vector3[] = [];
  SCOPE_JACKS.forEach((u, i) => {
    const color = i === 0 ? 0x1b1d20 : new THREE.Color(CHANNEL_COLORS[i - 1]).getHex();
    const jack = new THREE.Mesh(new THREE.CylinderGeometry(mm(2.4), mm(2.4), mm(5), 20), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    jack.rotation.x = Math.PI / 2;
    const p = new THREE.Vector3(-W / 2 + (u / 800) * W, H - (440 / 500) * H, Dp / 2 + mm(2.5));
    jack.position.copy(p);
    group.add(jack);
    pins.push(p.clone().setZ(Dp / 2 + mm(5)));
  });
  group.position.set(c.placement.x, 0, c.placement.z);
  group.rotation.y = c.placement.rot;
  tagPickable(group, c.id);
  let lastDraw = -1;
  return {
    group,
    pins: pins.map((p) => freeTransform(c, p)),
    hotspot: freeTransform(c, new THREE.Vector3(0, H, 0)),
    update(v) {
      // Экран перерисовываем 10 раз в секунду, а не каждый кадр
      if (v.time - lastDraw < 0.1 && lastDraw >= 0) return;
      lastDraw = v.time;
      face.draw(v.screen?.() as ScopeFrame | undefined);
    },
    dispose: () => disposeGroup(group),
  };
}
