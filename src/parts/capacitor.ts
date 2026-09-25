import * as THREE from "three";
import { blackPlastic, type ComponentView, disposeGroup, labelTexture, mm, radialLayout, tagPickable } from "../view/kit";
import { CERAMICS, ELECTROLYTIC_REVERSE_V, capacitorVolts, electrolyticSize, formatFarads, type Capacitor } from "../model/types";
import { formatLimit } from "../sim/devices";
import * as tolerance from "../sim/tolerance";
import { stampBurned, twoPin } from "./common";
import { formatV } from "./format";
import { toolFor, type PartDef } from "./types";
import { formatSI } from "../sim/resistorCodes";
import { actualRow, capacitanceSelect, pct, pill, polarNote, readout, selectField, superscript, twoPinHint, voltsSelect } from "../view/panel";

export const capacitor: PartDef<Capacitor> = {
  type: "capacitor",
  prefix: "C",
  pins: 2,
  pinLabel: (c, i) => (c.variant === "electrolytic" ? ["плюс", "минус"][i] : `вывод ${i + 1}`),
  countAs: () => ({ name: "конденсатор" }),
  // Даже маленький электролит (5 × 11 мм) выше и шире корпуса DIP
  notInChip: (c) => (c.variant === "electrolytic" ? "электролитический конденсатор выше и шире корпуса DIP — возьмите керамический" : undefined),
  onBoard: () => true,
  tools: [
    toolFor<Capacitor>()({
      id: "cap",
      group: "passive",
      icon: `<path d="M1 9h11M18 9h11M12 3v12M18 3v12" />`,
      label: "Конденсатор",
      title: "Конденсатор: электролитический или керамический",
      settings: { variant: "electrolytic" as Capacitor["variant"], smd: false, electrolyticUF: 1000, ceramicUF: 0.1, electrolyticV: 16, ceramicV: 50 },
      name: () => "Конденсатор",
      note: (s) =>
        `<p class="sub">Копит заряд: заряжается через резистор, потом отдаёт энергию. Чем больше ёмкость и сопротивление, тем медленнее (τ = R·C).</p>${s.variant === "electrolytic" ? polarNote("plus") : ""}`,
      editor(s) {
        const el = s.variant === "electrolytic";
        return (
          selectField("capVariant", "Тип", [["electrolytic", "электролитический (полярный)"], ["ceramic", "керамический"], ["smd", "керамический SMD 0805 (на плату под SMD)"]], s.smd && s.variant === "ceramic" ? "smd" : s.variant) +
          capacitanceSelect(s.variant, el ? s.electrolyticUF : s.ceramicUF) +
          voltsSelect(s.variant, el ? s.electrolyticV : s.ceramicV)
        );
      },
      set(s, field, value) {
        const el = s.variant === "electrolytic";
        if (field === "capVariant") {
          s.smd = value === "smd";
          s.variant = value === "smd" ? "ceramic" : (value as Capacitor["variant"]);
        }
        if (field === "uF") el ? (s.electrolyticUF = Number(value)) : (s.ceramicUF = Number(value));
        if (field === "capV") el ? (s.electrolyticV = Number(value)) : (s.ceramicV = Number(value));
      },
      create(s) {
        const el = s.variant === "electrolytic";
        return { type: "capacitor", variant: s.variant, uF: el ? s.electrolyticUF : s.ceramicUF, volts: el ? s.electrolyticV : s.ceramicV, ...(!el && s.smd ? { smd: true } : {}) };
      },
      hint: (s, pending) => twoPinHint(pending, s.variant === "electrolytic" ? "plus" : undefined),
    }),
  ],
  polar: (c) => c.variant === "electrolytic",
  label: (c) => `${formatFarads(c.uF)} ${formatV(capacitorVolts(c))}${c.variant === "electrolytic" ? "" : c.smd ? " керамический 0805" : " керамический"}`,
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
  panel(c, sim) {
    let title: string;
    let body: string;
    if (c.variant === "electrolytic") {
      title = `Конденсатор ${formatFarads(c.uF)}, ${formatV(capacitorVolts(c))}`;
      body = `<p class="sub">Электролитический, <b>полярный</b>: на плюсе должен быть бо́льший потенциал. Полоса с «−» на корпусе — со стороны минуса. Заряд хранится, даже если отключить батарею.</p>`;
    } else {
      const code = CERAMICS.find((x) => x.uF === c.uF)?.code ?? "";
      title = `Конденсатор ${formatFarads(c.uF)}`;
      body = c.smd
        ? `<p class="sub">Керамический многослойный в корпусе 0805 (2 × 1,25 мм), неполярный, до ${formatV(capacitorVolts(c))}. Маркировки на таких нет — номинал знают по катушке.</p>`
        : `<p class="sub">Керамический, неполярный, до ${formatV(capacitorVolts(c))}. Код <b>${code}</b>: ${code.slice(0, 2)} × 10${superscript(Number(code[2]))} пФ.</p>`;
    }
    let editor = capacitanceSelect(c.variant, c.uF) + voltsSelect(c.variant, capacitorVolts(c));
    if (Math.abs(sim.voltage(c)) > 0.05) {
      editor += `<div class="row"><button class="btn inline" data-act="discharge" id="btn-discharge">Разрядить</button></div>`;
    }
    return { title, body, editor };
  },
  edit(c, field, value) {
    if (field === "uF") c.uF = Number(value);
    if (field === "capV") c.volts = Number(value);
  },
  readout: (c, sim) => readout(sim.voltage(c), sim.current(c), sim.power(c), ["W", formatSI(sim.energy(c), "Дж")]),
  status(c, sim) {
    const v = sim.voltage(c);
    const i = sim.current(c);
    if (Math.abs(i) < 1e-5) return Math.abs(v) > 0.05 ? pill("ok", "ЗАРЯЖЕН") : pill("ok", "РАЗРЯЖЕН");
    return i * v > 0 || Math.abs(v) < 0.05 ? pill("ok", "ЗАРЯЖАЕТСЯ") : pill("warn", "РАЗРЯЖАЕТСЯ");
  },
  burnedWord: "ВЗДУЛСЯ",
  reversedPill: pill("bad", "ОБРАТНАЯ ПОЛЯРНОСТЬ"),
  pinNames: ["+", "−"],
  actual(c, tol) {
    const f = tolerance.capacitance(c, tol);
    return actualRow("Ёмкость фактически", `${formatFarads(f * 1e6)} (${pct(f * 1e6, c.uF)})`);
  },
  energy(c, sim) {
    const v = sim.voltage(c);
    return 0.5 * tolerance.capacitance(c, sim.tolerance) * v * v;
  },
  view: capacitorView,
};

// ─── 3D: Конденсаторы ──────────

/** Оболочка электролита: тёмно-синяя, со светлой полосой «−» по центру развёртки (u = 0,25 → +X). */
function sleeveTexture(uF: number, volts: number): THREE.CanvasTexture {
  const w = 512, h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#1c3a6b";
  g.fillRect(0, 0, w, h);
  // Полоса минуса смотрит на вывод 1 (локальная +X ↔ u = 0,25)
  const cx = w * 0.25;
  g.fillStyle = "#c9d3e0";
  g.fillRect(cx - w * 0.07, 0, w * 0.14, h);
  g.fillStyle = "#1c3a6b";
  g.font = `700 ${h * 0.2}px "IBM Plex Sans", system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < 4; i++) g.fillText("−", cx, h * (0.14 + i * 0.24));
  // Номинал — с противоположной стороны
  g.fillStyle = "#e9eef5";
  g.font = `600 ${h * 0.16}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(`${uF}µF`, w * 0.75, h * 0.38);
  g.fillText(`${volts}V`, w * 0.75, h * 0.62);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ventTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#b9bec6";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#6c727b";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(64, 14);
  g.lineTo(64, 114);
  g.moveTo(14, 64);
  g.lineTo(114, 64);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function capacitorView(c: Capacitor): ComponentView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  let bodyMat: THREE.MeshStandardMaterial;
  let top: THREE.Mesh | undefined;
  let layout: { pins: THREE.Vector3[]; hotspot: THREE.Vector3 };

  if (c.variant === "electrolytic") {
    const size = electrolyticSize(c.uF, capacitorVolts(c));
    const r = mm(size.diaMm) / 2;
    const h = mm(size.heightMm);
    bodyMat = new THREE.MeshStandardMaterial({ map: sleeveTexture(c.uF, capacitorVolts(c)), roughness: 0.45 });
    const can = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), bodyMat);
    can.position.y = h / 2;
    body.add(can);
    top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 40), new THREE.MeshStandardMaterial({ map: ventTexture(), metalness: 0.6, roughness: 0.4 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = h;
    body.add(top);
    const bottomDisc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), blackPlastic);
    bottomDisc.rotation.x = Math.PI / 2;
    body.add(bottomDisc);
    // Шаг выводов: 2,5 мм у маленьких, 5 мм у средних, 7,5 мм у больших
    const spacing = mm(size.diaMm <= 6.3 ? 2.5 : size.diaMm <= 10 ? 5 : 7.5);
    layout = radialLayout(c, group, body, spacing, 0.3, h);
  } else {
    // Керамический дисковый: Ø 5 мм, код на лицевой стороне
    const r = mm(2.6);
    bodyMat = new THREE.MeshStandardMaterial({ color: 0xd98a3b, roughness: 0.6 });
    const code = CERAMICS.find((x) => x.uF === c.uF)?.code ?? "";
    const faceMat = new THREE.MeshStandardMaterial({ map: labelTexture([code], "#d98a3b", "#5a2e0e", 256, 256), roughness: 0.6 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, mm(1.6), 32), [bodyMat, faceMat, faceMat]);
    disc.rotation.x = Math.PI / 2; // плоскостью к зрителю, выводы снизу
    disc.position.y = r;
    body.add(disc);
    layout = radialLayout(c, group, body, mm(2.5), 0.6, 2 * r);
  }

  tagPickable(group, c.id);
  const baseScale = body.scale.clone();
  return {
    group,
    pins: layout.pins,
    hotspot: layout.hotspot,
    update(v) {
      if (v.burned) {
        // Вздувшийся электролит: крышка выгнута, корпус потемнел
        bodyMat.color.set(0x55504a);
        if (top) top.scale.setScalar(1.08);
        body.scale.set(baseScale.x * 1.06, baseScale.y * 1.04, baseScale.z * 1.06);
        return;
      }
      bodyMat.emissive.setRGB(1, 0.3, 0.05).multiplyScalar(v.heat > 0.3 ? (v.heat - 0.3) * 0.8 : 0);
    },
    dispose: () => disposeGroup(group),
  };
}
