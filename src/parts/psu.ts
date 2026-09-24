import * as THREE from "three";
import { type ComponentView, disposeGroup, freeTransform, mm, tagPickable, type Visual } from "../view/kit";
import { PSU_LIMITS, type PowerSupply } from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import { stampBurned, twoPin } from "./common";
import { toolFor, type PartDef } from "./types";
import { pill, readout } from "../view/panel";

/** Выходное сопротивление лабораторного блока в режиме CV, Ом. */
const PSU_R_CV = 0.005;
/** В режиме CC блок — источник тока; внутренняя проводимость ничтожна (100 МОм параллельно). */
const PSU_R_CC = 1e8;

export const psu: PartDef<PowerSupply> = {
  type: "psu",
  prefix: "G",
  pins: 2,
  pinLabels: ["минус", "плюс"],
  onBoard: () => false,
  tools: [
    toolFor<PowerSupply>()({
      id: "psu",
      group: "power",
      icon: `<rect x="5" y="2" width="20" height="14" rx="1.5" /><path d="M8 5h9v4H8zM20 12.5h1M23 12.5h0" /><circle cx="10" cy="12.5" r="1.5" />`,
      label: "Блок питания",
      title: "Лабораторный блок питания 0–30 В, 0–3 А",
      settings: { volts: 5, amps: 0.5 },
      name: () => "Блок питания",
      note: () => "",
      editor: () => "",
      set() {},
      create: (s) => ({ type: "psu", volts: s.volts, amps: s.amps, on: true }),
      hint: () => "Нажмите на стол рядом с платой. Напряжение и ограничение тока — в панели справа.",
      boardRefusal: "Блок питания ставится на стол. Подключите клеммы к плате проводами.",
    }),
  ],
  polar: () => true,
  label: (c) => (c.on ? `блок питания ${formatSI(c.volts, "В")} / ${formatSI(c.amps, "А")}` : "блок питания, выход выкл."),
  value: (c) => (c.on ? `${formatSI(c.volts, "В")} / ${formatSI(c.amps, "А")}` : "выход выкл."),
  symbol: () => `<path d="M0 -20V-12M0 12V20"/><circle r="12"/><path d="M0 -6V6M-4 2L0 6L4 2" class="thin"/><path d="M8 17H14M11 14V20" class="thin"/>`,
  burn: (c) => [`${c.id} вышел из строя`, ""],

  stamp(c, sim, { out }) {
    if (stampBurned(c, sim, out)) return;
    if (!c.on) out.push(twoPin(c, Infinity));
    // CV: ЭДС = уставка, почти нулевое сопротивление. CC: ток = ограничение (эквивалент Нортона).
    else if (sim.psuMode.get(c.id) === "CC") out.push(twoPin(c, PSU_R_CC, c.amps * PSU_R_CC));
    else out.push(twoPin(c, PSU_R_CV, c.volts));
  },
  // CV, пока ток меньше ограничения; иначе CC, пока напряжение не выше уставки
  newton(c, sim, _iter, shared) {
    if (!c.on) return true;
    const br = sim.solution.branches.get(c.id)!;
    const mode = sim.psuMode.get(c.id) ?? "CV";
    const next = mode === "CV" ? (br.current > c.amps * (1 + 1e-9) ? "CC" : "CV") : br.voltage > c.volts * (1 + 1e-9) ? "CV" : "CC";
    if (next === mode || shared.flips >= 8) return true;
    sim.psuMode.set(c.id, next);
    shared.flips++;
    return false;
  },
  power: (c, sim) => Math.max(0, sim.branch(c.id).current * sim.branch(c.id).voltage),
  panel: (c) => ({
    title: "Лабораторный блок питания",
    body: `<div class="field"><label for="f-psuV">Напряжение: <b>${formatSI(c.volts, "В")}</b></label>
            <input type="range" id="f-psuV" data-field="psuV" data-unit="В" min="0" max="${PSU_LIMITS.maxV}" step="0.1" value="${c.volts}" /></div>
          <div class="field"><label for="f-psuA">Ограничение тока: <b>${formatSI(c.amps, "А")}</b></label>
            <input type="range" id="f-psuA" data-field="psuA" data-unit="А" min="0.01" max="${PSU_LIMITS.maxA}" step="0.01" value="${c.amps}" /></div>
          <div class="row"><button class="btn inline" data-act="toggle" id="btn-psu">${c.on ? "Выключить выход" : "Включить выход"}</button></div>
          <p class="sub">Держит заданное напряжение (CV), пока нагрузка берёт меньше тока, чем ограничение. Если больше — держит ток (CC), а напряжение само падает. Поэтому короткое замыкание ему не страшно, а светодиод можно питать без резистора, выставив 20 мА.</p>`,
  }),
  readout: (c, sim) => readout(-sim.voltage(c), Math.abs(sim.current(c)), sim.power(c)),
  status(c, sim) {
    if (!c.on) return pill("warn", "ВЫХОД ВЫКЛЮЧЕН");
    return sim.psuMode.get(c.id) === "CC" ? pill("warn", "CC — ОГРАНИЧЕНИЕ ТОКА") : pill("ok", "CV — ДЕРЖИТ НАПРЯЖЕНИЕ");
  },
  noFlip: true,
  source: true,
  leadColors: ["#1b1d20", "#c8261f"],
  visual: (c, sim) => ({
    display: {
      volts: Math.abs(sim.branch(c.id).voltage),
      amps: Math.max(0, sim.branch(c.id).current),
      mode: sim.psuMode.get(c.id) ?? "CV",
      on: c.on,
    },
  }),
  toggle(c) {
    c.on = !c.on;
  },
  // Ползунки панели: уставка напряжения и ограничение тока
  edit(c, field, value) {
    if (field === "psuV") c.volts = Number(value);
    if (field === "psuA") c.amps = Number(value);
  },
  view: psuView,
};

// ─── 3D: Лабораторный источник питания ──────────

/**
 * Передняя панель: дисплей (напряжение и ток), индикаторы CV/CC и «Выход», подписи ручек.
 * Рисуется на canvas и обновляется, только когда показания меняются.
 */
class PsuPanel {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private last = "";

  constructor() {
    this.canvas.width = 700;
    this.canvas.height = 350;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw({ volts: 0, amps: 0, mode: "CV", on: false });
  }

  draw(d: NonNullable<Visual["display"]>): void {
    const v = d.on ? d.volts.toFixed(2).padStart(5, " ") : "--.--";
    const a = d.on ? d.amps.toFixed(3) : "-.---";
    const key = `${v}|${a}|${d.mode}|${d.on}`;
    if (key === this.last) return;
    this.last = key;
    const g = this.canvas.getContext("2d")!;
    const W = this.canvas.width, Hh = this.canvas.height;
    g.fillStyle = "#2b2f33";
    g.fillRect(0, 0, W, Hh);
    // Дисплей
    g.fillStyle = "#0b0f0c";
    g.fillRect(30, 30, 420, 200);
    g.font = `600 84px "IBM Plex Mono", ui-monospace, monospace`;
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillStyle = "#ff5a3c";
    g.fillText(`${v}V`, 430, 85);
    g.fillStyle = "#5dff8a";
    g.fillText(`${a}A`, 430, 180);
    // Индикаторы CV / CC / ВЫХОД
    const lamp = (x: number, y: number, lit: boolean, color: string, label: string) => {
      g.fillStyle = lit ? color : "#3a3f44";
      g.beginPath();
      g.arc(x, y, 14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#cfd5d9";
      g.font = `600 26px "IBM Plex Sans", system-ui, sans-serif`;
      g.textAlign = "left";
      g.fillText(label, x + 24, y + 1);
    };
    lamp(490, 60, d.on && d.mode === "CV", "#5dff8a", "CV");
    lamp(490, 110, d.on && d.mode === "CC", "#ff5a3c", "CC");
    lamp(490, 160, d.on, "#ffd23c", "ВЫХОД");
    // Подписи
    g.fillStyle = "#cfd5d9";
    g.font = `600 30px "IBM Plex Sans", system-ui, sans-serif`;
    g.textAlign = "center";
    g.fillText("U", 95, 300);
    g.fillText("I", 225, 300);
    g.fillText("−", 470, 300);
    g.fillText("+", 610, 300);
    g.font = `500 22px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText("0–30 V · 0–3 A", 560, 215);
    this.texture.needsUpdate = true;
  }
}

/**
 * Компактный лабораторный блок 70 × 35 × 50 мм (настоящие больше, но тогда он заслонил бы макетку).
 * Передняя панель смотрит в +Z; клеммы внизу справа: чёрная (минус, вывод 0) и красная (плюс, вывод 1).
 */
function psuView(c: PowerSupply): ComponentView {
  const group = new THREE.Group();
  const W = mm(70), Hh = mm(35), D = mm(50);
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x3d4449, roughness: 0.5, metalness: 0.2 });
  const panel = new PsuPanel();
  const faceMat = new THREE.MeshStandardMaterial({
    map: panel.texture,
    roughness: 0.6,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: panel.texture,
    emissiveIntensity: 0.35,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, D), [caseMat, caseMat, caseMat, caseMat, faceMat, caseMat]);
  box.position.y = Hh / 2;
  group.add(box);
  // Ручки U и I
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4 });
  for (const u of [95 / 700, 225 / 700]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(mm(4), mm(4.3), mm(4), 24), knobMat);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(-W / 2 + u * W, Hh * 0.33, D / 2 + mm(2));
    group.add(knob);
  }
  // Клеммы
  const posts: THREE.Vector3[] = [];
  for (const [u, color] of [[470 / 700, 0x1b1d20], [610 / 700, 0xc8261f]] as const) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(mm(2.6), mm(2.6), mm(6), 20), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    post.rotation.x = Math.PI / 2;
    const p = new THREE.Vector3(-W / 2 + u * W, Hh * 0.33, D / 2 + mm(3));
    post.position.copy(p);
    group.add(post);
    posts.push(p.clone().setZ(D / 2 + mm(6)));
  }
  if (c.placement.mode !== "free") throw new Error("Блок питания ставится только на стол");
  group.position.set(c.placement.x, 0, c.placement.z);
  group.rotation.y = c.placement.rot;
  tagPickable(group, c.id);
  const pins = posts.map((p) => freeTransform(c, p));
  return {
    group,
    pins,
    hotspot: freeTransform(c, new THREE.Vector3(0, Hh, 0)),
    update(v) {
      if (v.display) panel.draw(v.display);
    },
    dispose: () => disposeGroup(group),
  };
}
