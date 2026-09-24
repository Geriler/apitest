import * as THREE from "three";
import { axialLayout, type ComponentView, disposeGroup, mm, tagPickable } from "../view/kit";
import { DIODES, diodeSpec, type Diode, type DiodeKind } from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import { VT, diodeParams, formatLimit } from "../sim/devices";
import { junctionSim } from "./junction";
import { toolFor, type PartDef } from "./types";
import { actualRow, diodeSelect, pill, polarNote, twoPinHint } from "../view/panel";

/** Анод (вывод 0) сверху: треугольник остриём к катоду. Общее для диода и светодиода. */
export const DIODE_SYMBOL = `<path d="M0 -20V-8M0 8V20M-9 8H9"/><path d="M-9 -8H9L0 8Z"/>`;

/** Плашка диода и светодиода, включённых наоборот. */
export const REVERSED_PILL = pill("warn", "ОБРАТНОЕ ВКЛЮЧЕНИЕ — ТОК НЕ ИДЁТ");

export const diode: PartDef<Diode> = {
  type: "diode",
  prefix: "VD",
  pins: 2,
  countAs: (c) => ({ name: `диод ${diodeSpec(c).label}` }),
  onBoard: () => true,
  tools: [
    toolFor<Diode>()({
      id: "diode",
      group: "semi",
      icon: `<path d="M1 9h10M19 9h10M11 4l8 5-8 5zM19 4v10" />`,
      label: "Диод",
      title: "Диод 1N4148 / 1N4007 / 1N5408",
      settings: { kind: "1N4007" as DiodeKind },
      name: (s) => `Диод ${DIODES[s.kind].label}`,
      note: () => `<p class="sub">Пропускает ток в одну сторону.</p>${polarNote("anode")}`,
      editor: (s) => diodeSelect(s.kind),
      set(s, field, value) {
        if (field === "diode") s.kind = value as DiodeKind;
      },
      create: (s) => ({ type: "diode", kind: s.kind }),
      hint: (_s, pending) => twoPinHint(pending, "anode"),
    }),
  ],
  polar: () => true,
  label: (c) => diodeSpec(c).label,
  value: (c) => diodeSpec(c).label,
  symbol: () => DIODE_SYMBOL,
  burn: (c) => [`Диод ${c.id} сгорел`, `Ток больше ${formatSI(diodeSpec(c).maxA, "А")}. Ограничьте ток резистором или возьмите диод мощнее.`],

  ...junctionSim,
  load(c, sim) {
    const maxA = diodeSpec(c).maxA;
    return { ratio: Math.max(0, sim.current(c)) / maxA, what: "ток", limit: formatLimit(maxA, "А") };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  panel: (c) => ({
    title: `Диод ${diodeSpec(c).label}`,
    body: `<p class="sub">Пропускает ток только от анода к катоду, падение ≈ 0,6–0,9 В. Кольцо на корпусе — катод. До ${formatSI(diodeSpec(c).maxA, "А")}.</p>`,
    editor: diodeSelect(c.kind ?? "1N4007"),
  }),
  edit(c, field, value) {
    if (field === "diode") c.kind = value as DiodeKind;
  },
  reversedPill: REVERSED_PILL,
  actual(c, tol) {
    const p = diodeParams(c, tol);
    return actualRow("Прямое напряжение при 10 мА", formatSI(p.n * VT * Math.log(0.01 / p.is), "В"));
  },
  view: diodeView,
};

// ─── 3D: Диоды 1N4148, 1N4007, 1N5408 ──────────

function diodeView(c: Diode): ComponentView {
  const group = new THREE.Group();
  const spec = diodeSpec(c);
  const L = mm(spec.lengthMm);
  const r = mm(spec.diameterMm) / 2;
  const body = new THREE.Group();
  // 1N4148 — в прозрачном оранжевом стекле с чёрным кольцом, выпрямительные — в чёрном пластике с серым
  const baseColor = spec.glass ? 0xd9772a : 0x1b1c1f;
  const bodyMat = spec.glass
    ? new THREE.MeshPhysicalMaterial({ color: baseColor, roughness: 0.1, transmission: 0.3, transparent: true, opacity: 0.85 })
    : new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.35 });
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(r, L - 2 * r, 6, 20), bodyMat);
  capsule.rotation.z = Math.PI / 2;
  body.add(capsule);
  // Серебристое кольцо — катод (вывод 1, локальная +X)
  const bandMat = spec.glass ? new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }) : new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.35 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, L * 0.14, 20), bandMat);
  band.rotation.z = Math.PI / 2;
  band.position.x = L * 0.3;
  body.add(band);
  const { pins, hotspot } = axialLayout(c, group, body, L, r);
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot,
    update(v) {
      bodyMat.color.set(v.burned ? 0x0c0b0a : baseColor);
      bodyMat.emissive.setRGB(1, 0.3, 0.05).multiplyScalar(!v.burned && v.heat > 0.3 ? (v.heat - 0.3) * 1.2 : 0);
    },
    dispose: () => disposeGroup(group),
  };
}
