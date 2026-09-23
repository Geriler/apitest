import * as THREE from "three";
import { blackPlastic, type ComponentView, disposeGroup, freeTransform, lead, mm, radialLayout, tagPickable } from "../view/kit";
import { LEDS, ledSpec, type Led, type LedColor, type LedSize } from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import { formatLimit } from "../sim/devices";
import { DIODE_SYMBOL, REVERSED_PILL } from "./diode";
import { junctionSim } from "./junction";
import type { PartDef } from "./types";
import * as tolerance from "../sim/tolerance";
import { actualRow, ledColorSelect, ledSizeSelect, pill } from "../view/panel";

export const led: PartDef<Led> = {
  type: "led",
  prefix: "HL",
  pins: 2,
  onBoard: () => true,
  polar: () => true,
  label: (c) => `светодиод ${LEDS[c.color].label}${c.size === "1W" ? " 1 Вт" : ""}`,
  value: (c) => `${LEDS[c.color].label}${c.size === "1W" ? ", 1 Вт" : ""}`,
  symbol: () => `${DIODE_SYMBOL}<path d="M10 -6L17 -13M13 -1L20 -8M14 -13H17V-10M17 -8H20V-5" class="thin"/>`,
  burn: (c) => {
    const s = ledSpec(c);
    const vf = String(Math.round((LEDS[c.color].vf + s.vfAdd) * 10) / 10).replace(".", ",");
    return [`Светодиод ${c.id} сгорел`, `Ток больше ${formatSI(s.ratedA * 1.5, "А")}. Поставьте последовательно резистор: R = (U − ${vf} В) / ${String(s.ratedA).replace(".", ",")} А.`];
  },

  ...junctionSim,
  load(c, sim) {
    const rated = ledSpec(c).ratedA;
    return { ratio: Math.max(0, sim.current(c)) / rated, what: "ток", limit: formatLimit(rated, "А") };
  },
  thermal: { threshold: 1.5, rate: 1.5, cooling: 1 },
  panel(c) {
    const spec = LEDS[c.color];
    const size = ledSpec(c);
    const vf = String(Math.round((spec.vf + size.vfAdd) * 10) / 10).replace(".", ",");
    const amps = String(size.ratedA).replace(".", ",");
    return {
      title: `Светодиод ${spec.label}${c.size === "1W" ? ", 1 Вт" : ""}`,
      body: `<p class="sub">Прямое падение ≈ ${vf} В, номинальный ток ${formatSI(size.ratedA, "А")}. <b>Без резистора сгорает.</b> ${c.size === "1W" ? "Минус помечен на корпусе." : "Длинная ножка — анод (+)."} Резистор: R = (U<sub>бат</sub> − ${vf}) / ${amps}.</p>`,
      editor: ledColorSelect(c.color) + ledSizeSelect(c.size ?? "5mm"),
    };
  },
  edit(c, field, value) {
    if (field === "led") c.color = value as LedColor;
    if (field === "ledSize") c.size = value as LedSize;
  },
  status: (c, sim) => (sim.current(c) > 0.0005 ? pill("ok", "ГОРИТ") : pill("warn", "НЕ ГОРИТ")),
  reversedPill: REVERSED_PILL,
  nearLimitOk: true,
  actual: (c, tol) => actualRow("Прямое напряжение при 20 мА", formatSI(tolerance.ledVf(c, tol), "В")),
  visual: (c, sim) => ({ brightness: sim.overload(c) }),
  view: ledView,
};

// ─── 3D: Светодиод 5 мм ──────────

function ledView(c: Led): ComponentView {
  const group = new THREE.Group();
  const spec = LEDS[c.color];
  const power = ledSpec(c).ratedA > 0.1;
  // Мощный: низкий чёрный корпус Ø 8 мм с прозрачной линзой Ø 5,5 мм сверху
  const r = mm(power ? 2.75 : 2.5);
  const h = mm(power ? 6.3 : 5.8);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: spec.glass,
    roughness: 0.15,
    transmission: 0.35,
    transparent: true,
    opacity: 0.8,
    emissive: new THREE.Color(spec.hex),
    emissiveIntensity: 0,
  });
  const body = new THREE.Group();
  const chipMat = new THREE.MeshStandardMaterial({ color: 0x777066, emissive: new THREE.Color(spec.hex), emissiveIntensity: 0 });
  if (power) {
    const base = mm(3.3);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(mm(4), mm(4), base, 40), blackPlastic);
    housing.position.y = base / 2;
    body.add(housing);
    // Окно под линзой, белый корпус излучателя
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(mm(2.9), mm(2.9), mm(0.2), 32), new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.4 }));
    pad.position.y = base + mm(0.1);
    body.add(pad);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    lens.position.y = base;
    body.add(lens);
    const chip = new THREE.Mesh(new THREE.BoxGeometry(mm(1), mm(0.3), mm(1)), chipMat);
    chip.position.y = base + mm(0.3);
    body.add(chip);
  } else {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(mm(2.9), mm(2.9), mm(1), 32), glassMat);
    rim.position.y = mm(0.5);
    body.add(rim);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h - r, 32), glassMat);
    barrel.position.y = (h - r) / 2;
    body.add(barrel);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    dome.position.y = h - r;
    body.add(dome);
    // Кристалл внутри
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), chipMat);
    chip.position.y = h * 0.45;
    body.add(chip);
  }
  const light = new THREE.PointLight(spec.hex, 0, power ? 30 : 10, 2);
  light.position.y = h * 0.6;
  body.add(light);

  let layout: { pins: THREE.Vector3[]; hotspot: THREE.Vector3 };
  if (c.placement.mode === "free") {
    // На столе видно, что анод (вывод 0) длиннее катода
    body.position.y = 1.4;
    group.add(body);
    const s = mm(1.27);
    group.add(lead([new THREE.Vector3(-s, 1.5, 0), new THREE.Vector3(-s, 0.4, 0), new THREE.Vector3(-s - 2.2, mm(0.3), 0)], mm(0.25)));
    group.add(lead([new THREE.Vector3(s, 1.5, 0), new THREE.Vector3(s, 0.4, 0), new THREE.Vector3(s + 1.4, mm(0.3), 0)], mm(0.25)));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    layout = {
      pins: [freeTransform(c, new THREE.Vector3(-s - 2.2, mm(0.3), 0)), freeTransform(c, new THREE.Vector3(s + 1.4, mm(0.3), 0))],
      hotspot: freeTransform(c, new THREE.Vector3(0, 1.4 + h, 0)),
    };
  } else {
    layout = radialLayout(c, group, body, mm(2.54), 1.2, h);
  }

  tagPickable(group, c.id);
  return {
    group,
    pins: layout.pins,
    hotspot: layout.hotspot,
    update(v) {
      if (v.burned) {
        glassMat.emissiveIntensity = 0;
        chipMat.emissiveIntensity = 0;
        chipMat.color.set(0x111111);
        light.intensity = 0;
        return;
      }
      // Яркость ≈ пропорциональна току; 20 мА — полная
      const b = Math.min(Math.max(v.brightness, 0), 1.6);
      const glow = b < 0.005 ? 0 : 0.25 + b;
      glassMat.emissiveIntensity = glow * 1.6;
      chipMat.emissiveIntensity = glow * 9;
      // Мощный светит в разы сильнее
      light.intensity = glow * (power ? 40 : 6);
    },
    dispose: () => disposeGroup(group),
  };
}
