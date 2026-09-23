import * as THREE from "three";
import { blackPlastic, type ComponentView, disposeGroup, labelTexture, mm, radialLayout, tagPickable } from "../view/kit";
import { ELECTROLYTIC_REVERSE_V, capacitorVolts, formatFarads, type Capacitor, CERAMICS, electrolyticSize } from "../model/types";
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
