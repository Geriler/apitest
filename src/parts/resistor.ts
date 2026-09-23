import * as THREE from "three";
import { axialLayout, boardFrame, type ComponentView, disposeGroup, freeTransform, leadMaterial, mm, tagPickable } from "../view/kit";
import { smdLabelTexture } from "../view/textures";
import { SMD_SIZES, thtResistorSpec, type Resistor } from "../model/types";
import { colorBands, formatOhms, formatSI, smdCode } from "../sim/resistorCodes";
import * as tolerance from "../sim/tolerance";
import { formatLimit } from "../sim/devices";
import { stampBurned, twoPin } from "./common";
import { formatW } from "./format";
import type { PartDef } from "./types";

export const resistor: PartDef<Resistor> = {
  type: "resistor",
  prefix: "R",
  pins: 2,
  onBoard: (variant) => variant !== "smd",
  polar: () => false,
  label: (c) => `${formatOhms(c.ohms)}${c.variant === "smd" ? ` SMD ${c.smdSize}` : `, ${formatW(thtResistorSpec(c).ratedW)}`}`,
  value: (c) => `${formatOhms(c.ohms)}${c.variant === "smd" ? ` ${c.smdSize}` : `, ${formatW(thtResistorSpec(c).ratedW)}`}`,
  symbol: () => `<path d="M0 -20V-15M0 15V20"/><rect x="-5" y="-15" width="10" height="30"/>`,
  rated: (c) => (c.variant === "smd" ? SMD_SIZES[c.smdSize].ratedW : thtResistorSpec(c).ratedW),
  burn: (c) =>
    c.variant === "smd"
      ? [`Резистор ${c.id} сгорел`, `Корпус ${c.smdSize} рассеивает не больше ${formatSI(SMD_SIZES[c.smdSize].ratedW, "Вт")}. Возьмите корпус крупнее или резистор с бо́льшим сопротивлением.`]
      : [`Резистор ${c.id} сгорел`, `Номинал ${formatW(thtResistorSpec(c).ratedW)}. Возьмите резистор мощнее, увеличьте сопротивление или понизьте напряжение.`],

  stamp(c, sim, { out }) {
    if (!stampBurned(c, sim, out)) out.push(twoPin(c, tolerance.resistance(c, sim.tolerance)));
  },
  load(c, sim) {
    const rated = resistor.rated!(c);
    return { ratio: sim.branch(c.id).power / rated, what: "мощность", limit: formatLimit(rated, "Вт") };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  view: resistorView,
};

// ─── 3D: Резисторы ──────────

function thtBody(c: Resistor) {
  const spec = thtResistorSpec(c);
  const L = mm(spec.lengthMm);
  const r = mm(spec.diameterMm) / 2;
  const body = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c496, roughness: 0.55 });
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(r, L - 2 * r, 6, 20), bodyMat);
  capsule.rotation.z = Math.PI / 2;
  body.add(capsule);
  const bandMats: THREE.MeshStandardMaterial[] = [];
  const bands = colorBands(c.ohms);
  const positions = [0.2, 0.34, 0.48, 0.8];
  bands.forEach((band, i) => {
    const m = new THREE.MeshStandardMaterial({
      color: band.hex,
      roughness: 0.4,
      metalness: band.name === "золотой" || band.name === "серебряный" ? 0.7 : 0,
    });
    bandMats.push(m);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, L * 0.08, 20), m);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = -L / 2 + positions[i] * L;
    body.add(ring);
  });
  return { body, L, r, bodyMat, bandMats };
}

function resistorView(c: Resistor): ComponentView {
  const group = new THREE.Group();
  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  let bodyMat: THREE.MeshStandardMaterial;
  let extraMats: THREE.MeshStandardMaterial[] = [];
  let baseColor: THREE.Color;

  if (c.variant === "smd") {
    const s = SMD_SIZES[c.smdSize];
    const L = mm(s.lengthMm);
    const W = mm(s.widthMm);
    const T = mm(s.heightMm);
    bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, T, W), bodyMat);
    body.position.y = T / 2;
    group.add(body);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(L * 0.16, T * 1.02, W * 1.01), leadMaterial);
      cap.position.set((sx * L * 0.84) / 2 + sx * 0.0, T / 2, 0);
      cap.position.x = sx * (L / 2 - (L * 0.16) / 2);
      group.add(cap);
    }
    const labelMat = new THREE.MeshStandardMaterial({ map: smdLabelTexture(smdCode(c.ohms)), roughness: 0.6 });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.6, W * 0.8), labelMat);
    label.rotation.x = -Math.PI / 2;
    label.position.y = T + 0.002;
    group.add(label);
    extraMats = [labelMat];
    baseColor = new THREE.Color(0x1a1c1f);
    if (c.placement.mode === "free") {
      group.position.set(c.placement.x, 0, c.placement.z);
      group.rotation.y = c.placement.rot;
      pins = [freeTransform(c, new THREE.Vector3(-L / 2, T / 2, 0)), freeTransform(c, new THREE.Vector3(L / 2, T / 2, 0))];
      hotspot = freeTransform(c, new THREE.Vector3(0, T, 0));
    } else {
      // SMD в макетку не ставится; модель это не допускает, но на всякий случай — над серединой.
      const f = boardFrame(c.placement.holes);
      group.position.copy(f.mid);
      pins = [f.p0, f.p1];
      hotspot = f.mid.clone();
    }
  } else {
    const t = thtBody(c);
    bodyMat = t.bodyMat;
    extraMats = t.bandMats;
    baseColor = new THREE.Color(0xd8c496);
    ({ pins, hotspot } = axialLayout(c, group, t.body, t.L, t.r));
  }

  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot,
    update(v) {
      if (v.burned) {
        bodyMat.color.set(0x17120e);
        bodyMat.emissive.set(0x000000);
        for (const m of extraMats) m.color.multiplyScalar(0.25);
        extraMats = [];
        return;
      }
      bodyMat.color.copy(baseColor).lerp(new THREE.Color(0x3b2410), v.heat * 0.8);
      bodyMat.emissive.setRGB(1, 0.25, 0.05).multiplyScalar(v.heat > 0.4 ? (v.heat - 0.4) * 1.2 : 0);
    },
    dispose: () => disposeGroup(group),
  };
}
