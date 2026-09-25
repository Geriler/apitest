import * as THREE from "three";
import { DISPLAY_OFFSETS, HOLE_BY_ID } from "../model/breadboard";
import { DISPLAY_SEGMENTS, DISPLAY_SPEC, type Display } from "../model/types";
import { VT, damp, diodeBranch, junctionSettled, limitJunction, type DiodeParams } from "../sim/devices";
import { pinNode } from "../sim/nodes";
import { formatSI } from "../sim/resistorCodes";
import type { Simulation } from "../sim/simulation";
import { type ComponentView, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { kv, pill } from "../view/panel";
import { toolFor, type PartDef } from "./types";

/**
 * Переход сегмента: Is подобран так, чтобы при 10 мА на выводах было 1,8 В (типичное по даташиту
 * SC56-11SRWA), с учётом падения на Rs.
 */
const SEG: DiodeParams = (() => {
  const s = DISPLAY_SPEC;
  return { is: s.atA / Math.exp((s.vf - s.atA * s.rs) / (s.n * VT)), n: s.n, rs: s.rs };
})();

/** Выводы с 0: общий катод — 3 и 8 по даташиту. */
const K1 = 2, K2 = 7;
const key = (c: Display, k: number) => `${c.id}:${DISPLAY_SEGMENTS[k].name}`;

/** Ток сегмента k (от анода к общему катоду), А. */
export function segmentCurrent(c: Display, sim: Simulation, k: number): number {
  return sim.state(c.id).burned ? 0 : sim.branch(key(c, k)).current;
}

const PIN_NAMES = ["e", "d", "общий катод", "c", "точка", "b", "a", "общий катод", "f", "g"];

export const display: PartDef<Display> = {
  type: "display",
  prefix: "HG",
  pins: 10,
  pinLabels: PIN_NAMES.map((n, i) => `${i + 1} ${n}`),
  countAs: () => ({ name: "индикатор" }),
  notInChip: () => "индикатор ставят туда, где на него смотрят, — в корпус микросхемы его не прячут",
  onBoard: () => true,
  layout: () => DISPLAY_OFFSETS,
  tools: [
    toolFor<Display>()({
      id: "display",
      group: "semi",
      icon: `<rect x="8" y="1" width="14" height="16" rx="1" /><path d="M12 4h6M11 5v3M19 5v3M12 9h6M11 10v3M19 10v3M12 14h6" stroke-width="1.2" />`,
      label: "Индикатор",
      title: "Семисегментный индикатор SC56-11SRWA, общий катод",
      settings: {},
      name: () => "Индикатор 7 сегментов",
      note: () =>
        `<p class="sub">Восемь красных светодиодов (сегменты a…g и точка) с общим катодом. Каждый сегмент — через свой резистор: от 5 В при 10 мА ≈ 330 Ом. Выводы: ${PIN_NAMES.map((n, i) => `${i + 1} ${n}`).join(", ")}.</p>`,
      editor: () => "",
      set() {},
      create: () => ({ type: "display" }),
      hint: () => "Нажмите на отверстие — туда встанет вывод 1 (e), выводы 1–5 по ряду вправо, 6–10 — обратно рядом через 6 шагов: на макетке — поперёк канавки, от ряда h к ряду d. R — повернуть.",
    }),
  ],
  polar: () => true,
  noFlip: true,
  label: () => `индикатор ${DISPLAY_SPEC.label}`,
  value: () => DISPLAY_SPEC.label,
  schematicParts: (c, sim) => [
    {
      key: "",
      pins: [6, 5, 3, 1, 0, 8, 9, 4, 2, 7],
      box: ["a", "b", "c", "d", "e", "f", "g", "DP", "K", "K"],
      value: DISPLAY_SPEC.label,
      current: DISPLAY_SEGMENTS.reduce((s, _, k) => s + Math.max(0, segmentCurrent(c, sim, k)), 0),
    },
  ],
  burn: (c) => [`Индикатор ${c.id} сгорел`, `Ток сегмента больше ${formatSI(DISPLAY_SPEC.maxA, "А")}. Каждый сегмент — через свой резистор: R = (U − 1,8 В) / 0,01 А.`],
  view: displayView,

  stamp(c, sim, { out, links }) {
    const k1 = pinNode(c, K1);
    links.push([k1, pinNode(c, K2)]);
    const burned = sim.state(c.id).burned;
    DISPLAY_SEGMENTS.forEach((s, k) => {
      const a = pinNode(c, s.pin - 1);
      if (burned) return void out.push({ id: key(c, k), a, b: k1, r: Infinity });
      const { r, emf } = diodeBranch(SEG, sim.junction.get(key(c, k)) ?? 0);
      out.push({ id: key(c, k), a, b: k1, r, emf });
    });
  },
  newton(c, sim, iter) {
    let ok = true;
    DISPLAY_SEGMENTS.forEach((_, k) => {
      const br = sim.solution.branches.get(key(c, k))!;
      const vold = sim.junction.get(key(c, k)) ?? 0;
      const target = -br.voltage - br.current * SEG.rs;
      const vnew = damp(limitJunction(target, vold, SEG), vold, iter);
      sim.junction.set(key(c, k), vnew);
      ok = junctionSettled(SEG, vold, vnew, target) && ok;
    });
    return ok;
  },
  voltage: (c, sim) => Math.max(...DISPLAY_SEGMENTS.map((_, k) => -sim.branch(key(c, k)).voltage)),
  current: (c, sim) => DISPLAY_SEGMENTS.reduce((s, _, k) => s + segmentCurrent(c, sim, k), 0),
  power: (c, sim) => DISPLAY_SEGMENTS.reduce((s, _, k) => s + Math.max(0, -sim.branch(key(c, k)).voltage * segmentCurrent(c, sim, k)), 0),
  load(c, sim) {
    const worst = Math.max(0, ...DISPLAY_SEGMENTS.map((_, k) => segmentCurrent(c, sim, k)));
    return { ratio: worst / DISPLAY_SPEC.maxA, what: "ток", limit: `${formatSI(DISPLAY_SPEC.maxA, "А")} на сегмент` };
  },
  thermal: { threshold: 1, rate: 1.5, cooling: 1 },
  nearLimitOk: true,
  visual: (c, sim) => ({ segments: DISPLAY_SEGMENTS.map((_, k) => Math.max(0, segmentCurrent(c, sim, k)) / DISPLAY_SPEC.atA) }),
  readout(c, sim) {
    const lit = DISPLAY_SEGMENTS.filter((_, k) => segmentCurrent(c, sim, k) > 0.0003);
    return `<div class="readout"><span>горят: <b>${lit.length ? lit.map((s) => s.name).join(" ") : "—"}</b></span></div>`;
  },
  status: (c, sim) => (DISPLAY_SEGMENTS.some((_, k) => segmentCurrent(c, sim, k) > 0.0003) ? pill("ok", "ГОРИТ") : pill("warn", "НЕ ГОРИТ")),
  panel(c, sim) {
    const rows = DISPLAY_SEGMENTS.map((s, k) => kv(`${s.name} (вывод ${s.pin})`, formatSI(Math.max(0, segmentCurrent(c, sim, k)), "А"))).join("");
    return {
      title: `Индикатор ${DISPLAY_SPEC.label}`,
      body: `<p class="sub">0,56″, красный, общий катод (выводы 3 и 8 соединены внутри). По даташиту: 1,8 В при 10 мА (до 2,3 В), не больше 30 мА на сегмент. Каждому сегменту — свой резистор: с одним общим яркость зависела бы от числа горящих.</p>${rows}`,
    };
  },
};

// ─── 3D ─────────────────────────────────────────────────────────────────────

/** Сегменты цифры на лицевой стороне, мм от центра: [x, z, длина, горизонтальный]. */
const SEG_GEOM: [number, number, number, boolean][] = [
  [0.4, -6.0, 4.8, true], // a
  [3.2, -3.1, 4.8, false], // b
  [2.6, 3.1, 4.8, false], // c
  [-0.4, 6.0, 4.8, true], // d
  [-3.2, 3.1, 4.8, false], // e
  [-2.6, -3.1, 4.8, false], // f
  [0.0, 0.0, 4.8, true], // g
];

function displayView(c: Display): ComponentView {
  const group = new THREE.Group();
  const W = mm(12.7), D = mm(19.05), H = mm(8);
  let base: THREE.Vector3[];
  if (c.placement.mode === "board") {
    base = c.placement.holes.map((id) => {
      const h = HOLE_BY_ID.get(id)!;
      return new THREE.Vector3(h.x, h.y, h.z);
    });
  } else {
    // На столе: выводы вниз, провода — к их концам
    base = DISPLAY_OFFSETS.map(([a, b]) => freeTransform(c, new THREE.Vector3(a - 2, mm(0.3), b === 0 ? 3 : -3)));
  }
  const Hs = base[0].y;
  const center = base.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / base.length);
  const u = base[4].clone().sub(base[0]).setY(0).normalize(); // вдоль ряда 1…5
  const v = base[0].clone().sub(base[9]).setY(0).normalize(); // от дальнего ряда к ближнему (низ цифры)
  const body = new THREE.Group();
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), v));
  body.position.set(center.x, Hs + mm(1), center.z);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6 }));
  housing.position.y = H / 2;
  body.add(housing);
  const segMats: THREE.MeshStandardMaterial[] = [];
  const addSeg = (x: number, z: number, len: number, horiz: boolean) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, emissive: new THREE.Color(0xff2a1a), emissiveIntensity: 0, roughness: 0.4 });
    segMats.push(m);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(mm(horiz ? len : 1.1), mm(0.2), mm(horiz ? 1.1 : len)), m);
    seg.position.set(mm(x), H + mm(0.1), mm(z));
    // Наклон цифры 8°, как у индикатора
    if (!horiz) seg.rotation.y = -0.14;
    body.add(seg);
  };
  for (const [x, z, len, horiz] of SEG_GEOM) addSeg(x, z, len, horiz);
  // Точка справа внизу
  const dpMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, emissive: new THREE.Color(0xff2a1a), emissiveIntensity: 0, roughness: 0.4 });
  segMats.push(dpMat);
  const dp = new THREE.Mesh(new THREE.CylinderGeometry(mm(0.75), mm(0.75), mm(0.2), 16), dpMat);
  dp.position.set(mm(4.8), H + mm(0.1), mm(6.3));
  body.add(dp);
  group.add(body);
  // Ножки: из-под корпуса вниз в отверстия
  for (const p of base) group.add(lead([p.clone().setY(Hs + mm(1.2)), p.clone().setY(Hs - 0.2)], mm(0.25)));
  tagPickable(group, c.id);
  return {
    group,
    pins: base,
    hotspot: center.clone().setY(Hs + mm(1) + H),
    update(vis) {
      segMats.forEach((m, k) => {
        const b = vis.burned ? 0 : Math.min(1.5, vis.segments?.[k] ?? 0);
        m.emissiveIntensity = b * 1.6;
        m.color.set(b > 0.05 ? 0xff5040 : 0xd9d6cf);
      });
    },
    dispose: () => disposeGroup(group),
  };
}
