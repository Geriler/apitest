import * as THREE from "three";
import type { MeterMode, Multimeter } from "../model/types";
import { formatLimit } from "../sim/devices";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import type { Simulation } from "../sim/simulation";
import { type ComponentView, disposeGroup, freeTransform, mm, tagPickable } from "../view/kit";
import { pill, selectField } from "../view/panel";
import { stampBurned, twoPin } from "./common";
import { toolFor, type PartDef } from "./types";

/** Входное сопротивление в режиме вольтметра, Ом (как у обычного цифрового мультиметра). */
export const VOLTMETER_R = 10e6;
/** Шунт и предохранитель в режимах тока. */
export const AMMETER = { mA: { r: 1, fuse: 0.4 }, A: { r: 0.01, fuse: 10 } } as const;
/** Омметр: источник 3 В через 3 кОм (ток при замкнутых щупах — 1 мА). */
export const OHMMETER = { emf: 3, r: 3000 };
/** Больше этого омметр показывает OL. */
const OHM_LIMIT = 40e6;

const MODES: Record<MeterMode, { name: string; option: string; letter: string }> = {
  V: { name: "вольтметр", option: "вольтметр (V)", letter: "V" },
  mA: { name: "миллиамперметр", option: "миллиамперметр (мА, до 400 мА)", letter: "mA" },
  A: { name: "амперметр", option: "амперметр (А, до 10 А)", letter: "A" },
  ohm: { name: "омметр", option: "омметр (Ω)", letter: "Ω" },
};

const isAmmeter = (m: MeterMode): m is "mA" | "A" => m === "mA" || m === "A";

/**
 * Показание прибора. value не задано — OL (обрыв у омметра). Знак — как у настоящего:
 * напряжение красного щупа относительно чёрного, ток, втекающий в красное гнездо.
 */
export function meterReading(c: Multimeter, sim: Simulation): { value?: number; unit: "В" | "А" | "Ом" } {
  const br = sim.branch(c.id); // ветвь от COM (a) к красному гнезду (b)
  if (c.mode === "V") return { value: br.voltage, unit: "В" };
  if (isAmmeter(c.mode)) return { value: -br.current, unit: "А" };
  if (br.current < 1e-11) return { unit: "Ом" };
  const r = br.voltage / br.current;
  return r > OHM_LIMIT ? { unit: "Ом" } : { value: r, unit: "Ом" };
}

/** Текст на индикаторе: четыре значащие цифры, латинские приставки, OL. */
export function lcdText(c: Multimeter, sim: Simulation): string {
  const { value, unit } = meterReading(c, sim);
  const u = unit === "В" ? "V" : unit === "А" ? "A" : "Ω";
  if (value === undefined) return `OL ${u === "Ω" ? "MΩ" : u}`;
  let v = value;
  const a = Math.abs(v);
  if (u !== "Ω" && a < 1e-4) v = 0; // шум ниже младшего разряда
  const [k, p] = v === 0 ? [1, ""] : a >= 1e6 ? [1e-6, "M"] : a >= 1e3 ? [1e-3, "k"] : a >= 1 ? [1, ""] : a >= 1e-3 ? [1e3, "m"] : [1e6, "µ"];
  const x = v * k;
  const digits = Math.abs(x) >= 100 ? 1 : Math.abs(x) >= 10 ? 2 : 3;
  return `${x.toFixed(digits)} ${p}${u}`;
}

/** Показание для панели и схемы, по-русски. */
function readingText(c: Multimeter, sim: Simulation): string {
  const { value, unit } = meterReading(c, sim);
  if (value === undefined) return "OL — обрыв или больше 40 МОм";
  if (unit === "Ом") return formatOhms(value);
  return formatSI(Math.abs(value) < 1e-4 ? 0 : value, unit);
}

export const multimeter: PartDef<Multimeter> = {
  type: "meter",
  prefix: "P",
  pins: 2,
  pinLabels: ["COM", "V/Ω/A"],
  onBoard: () => false,
  tools: [
    toolFor<Multimeter>()({
      id: "meter",
      group: "instruments",
      icon: `<rect x="8" y="1.5" width="14" height="15" rx="2" /><path d="M11 4h8v4h-8z" /><circle cx="15" cy="12" r="2" /><path d="M15 12l1.4-1.4" />`,
      label: "Мультиметр",
      title: "Мультиметр: напряжение, ток, сопротивление",
      settings: { mode: "V" as MeterMode },
      name: () => "Мультиметр",
      note: () =>
        `<p class="sub">Щупы — это провода: от чёрного гнезда COM и от красного к точкам схемы. <b>Вольтметр</b> — параллельно участку, <b>амперметр</b> — в разрыв цепи, <b>омметр</b> — только на обесточенную деталь.</p>`,
      editor: (s) => modeSelect(s.mode),
      set(s, field, value) {
        if (field === "meterMode") s.mode = value as MeterMode;
      },
      create: (s) => ({ type: "meter", mode: s.mode }),
      hint: () => "Нажмите на стол рядом с платой, потом протяните провода-щупы от гнёзд к схеме. R — повернуть.",
      boardRefusal: "Мультиметр лежит на столе. Щупы — провода от его гнёзд к точкам схемы.",
    }),
  ],
  polar: () => true,
  noFlip: true,
  label: (c) => `мультиметр, ${MODES[c.mode].name}`,
  value: (c) => MODES[c.mode].name,
  symbol: () => `<path d="M0 -20V-12M0 12V20"/><circle r="12"/>`,
  symbolText: (c) => MODES[c.mode].letter,
  leadColors: ["#1b1d20", "#c8261f"],
  burn: (c) => [
    `Сгорел предохранитель мультиметра ${c.id}`,
    `Ток больше ${isAmmeter(c.mode) ? formatSI(AMMETER[c.mode].fuse, "А") : "допустимого"}. Амперметр включают в разрыв цепи, последовательно с нагрузкой: у него почти нулевое сопротивление, и параллельно источнику он устраивает короткое замыкание.`,
  ],
  view: meterView,

  stamp(c, sim, { out }) {
    // Предохранитель стоит только в цепи измерения тока
    if (isAmmeter(c.mode) && stampBurned(c, sim, out)) return;
    if (c.mode === "V") out.push(twoPin(c, VOLTMETER_R));
    else if (isAmmeter(c.mode)) out.push(twoPin(c, AMMETER[c.mode].r));
    else out.push(twoPin(c, OHMMETER.r, OHMMETER.emf)); // плюс источника — на красном гнезде
  },
  load(c, sim) {
    if (!isAmmeter(c.mode)) return undefined;
    const fuse = AMMETER[c.mode].fuse;
    return { ratio: Math.abs(sim.branch(c.id).current) / fuse, what: "ток", limit: formatLimit(fuse, "А") };
  },
  // Предохранитель: сгорает за доли секунды при двукратной перегрузке
  thermal: { threshold: 1, rate: 20, cooling: 5 },
  burnedWord: "ПРЕДОХРАНИТЕЛЬ СГОРЕЛ",
  visual: (c, sim) => ({ screen: () => ({ text: sim.state(c.id).burned && isAmmeter(c.mode) ? "0.000 A" : lcdText(c, sim), mode: c.mode }) }),

  panel(c) {
    const notes: Record<MeterMode, string> = {
      V: "Вольтметр подключают <b>параллельно</b> участку: красный щуп — туда, где ожидаете плюс. Входное сопротивление 10 МОм — прибор почти не влияет на схему, но «висящую» точку (затвор без резистора) притягивает к чёрному щупу.",
      mA: "Миллиамперметр включают <b>в разрыв цепи</b>: ток должен пройти через прибор. Внутри шунт 1 Ом и предохранитель 400 мА. Параллельно батарее он сгорит.",
      A: "Амперметр включают <b>в разрыв цепи</b>. Шунт 0,01 Ом, предохранитель 10 А: для больших токов (лампы, мощные светодиоды, блок питания).",
      ohm: "Омметр пропускает через деталь небольшой ток (до 1 мА от 3 В) и делит напряжение на ток. Мерить только <b>без питания</b>: чужое напряжение в цепи исказит показания. Параллельные цепи тоже влияют — деталь лучше вынуть или отключить одним выводом.",
    };
    return {
      title: `Мультиметр — ${MODES[c.mode].name}`,
      body: `<p class="sub">${notes[c.mode]} Чёрное гнездо — COM, красное — V/Ω/A.</p>`,
      editor: modeSelect(c.mode),
    };
  },
  edit(c, field, value) {
    if (field === "meterMode") c.mode = value as MeterMode;
  },
  readout: (c, sim) => `<div class="lcd" aria-label="Показание">${readingText(c, sim)}</div>`,
  status: (c) => pill("ok", MODES[c.mode].name.toUpperCase()),
};

function modeSelect(mode: MeterMode): string {
  return selectField("meterMode", "Режим", (Object.keys(MODES) as MeterMode[]).map((m) => [m, MODES[m].option]), mode);
}

// ─── 3D: мультиметр ─────────────────────────────────────────────────────────

/** Лицевая панель: индикатор, переключатель режимов, гнёзда. Перерисовывается, когда меняются показания. */
class MeterFace {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private last = "";

  constructor() {
    this.canvas.width = 400;
    this.canvas.height = 720;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  draw(text: string, mode: MeterMode): void {
    const key = `${text}|${mode}`;
    if (key === this.last) return;
    this.last = key;
    const g = this.canvas.getContext("2d")!;
    const W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = "#e0b422"; // резиновый чехол
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#2c3034";
    g.beginPath();
    g.roundRect(22, 22, W - 44, H - 44, 26);
    g.fill();
    // Индикатор
    g.fillStyle = "#b9c4a5";
    g.fillRect(48, 50, W - 96, 150);
    g.fillStyle = "#1c2415";
    g.font = `600 64px "IBM Plex Mono", ui-monospace, monospace`;
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillText(text, W - 64, 128);
    // Переключатель
    const cx = W / 2, cy = 390, r = 92;
    g.fillStyle = "#15171a";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    const order: MeterMode[] = ["V", "mA", "A", "ohm"];
    const angle = (m: MeterMode) => -Math.PI / 2 + (order.indexOf(m) - 1.5) * 0.7;
    g.font = `600 30px "IBM Plex Sans", system-ui, sans-serif`;
    g.textAlign = "center";
    for (const m of order) {
      const a = angle(m);
      g.fillStyle = m === mode ? "#ffd23c" : "#cfd5d9";
      g.fillText(MODES[m].letter, cx + Math.cos(a) * (r + 34), cy + Math.sin(a) * (r + 34));
    }
    g.strokeStyle = "#e8eaec";
    g.lineWidth = 12;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(angle(mode)) * (r - 16), cy + Math.sin(angle(mode)) * (r - 16));
    g.stroke();
    // Подписи гнёзд
    g.fillStyle = "#cfd5d9";
    g.font = `600 26px "IBM Plex Sans", system-ui, sans-serif`;
    g.fillText("COM", JACKS[0][0], JACKS[0][1] + 58);
    g.fillText("VΩmA", JACKS[1][0], JACKS[1][1] + 58);
    this.texture.needsUpdate = true;
  }
}

/** Гнёзда на лицевой панели (в пикселях картинки 400 × 720): COM и V/Ω/A. */
const JACKS = [
  [120, 610],
  [280, 610],
] as const;

/** Мультиметр 45 × 80 мм лежит на столе лицом вверх; индикатор — к дальнему краю, гнёзда — к ближнему. */
function meterView(c: Multimeter): ComponentView {
  if (c.placement.mode !== "free") throw new Error("Мультиметр лежит только на столе");
  const group = new THREE.Group();
  const W = mm(45), H = mm(12), D = mm(80);
  const face = new MeterFace();
  face.draw("0.000 V", c.mode);
  const bootMat = new THREE.MeshStandardMaterial({ color: 0xe0b422, roughness: 0.7 });
  const faceMat = new THREE.MeshStandardMaterial({
    map: face.texture,
    roughness: 0.6,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: face.texture,
    emissiveIntensity: 0.25,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [bootMat, bootMat, faceMat, bootMat, bootMat, bootMat]);
  box.position.y = H / 2;
  group.add(box);
  const pins: THREE.Vector3[] = [];
  for (const [i, [px, py]] of JACKS.entries()) {
    const at = new THREE.Vector3(-W / 2 + (px / 400) * W, H, -D / 2 + (py / 720) * D);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(mm(3), mm(3), mm(1.6), 20),
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0x1b1d20 : 0xc8261f, roughness: 0.4 }),
    );
    ring.position.copy(at).setY(H + mm(0.6));
    group.add(ring);
    pins.push(at.clone().setY(H + mm(1.4)));
  }
  group.position.set(c.placement.x, 0, c.placement.z);
  group.rotation.y = c.placement.rot;
  tagPickable(group, c.id);
  return {
    group,
    pins: pins.map((p) => freeTransform(c, p)),
    hotspot: freeTransform(c, new THREE.Vector3(0, H, 0)),
    update(v) {
      const s = v.screen?.() as { text: string; mode: MeterMode } | undefined;
      if (s) face.draw(s.text, s.mode);
    },
    dispose: () => disposeGroup(group),
  };
}
