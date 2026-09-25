import * as THREE from "three";
import { HOLE_BY_ID, fineTrace, type Hole } from "../model/breadboard";
import { FINE_TRACE_WIDTH_MM, TRACE_WIDTH_MM, footprintOf, smdOnly, jumperPoints, type Component, type WireBend } from "../model/types";
import { part } from "../parts";
import { Y, leadMaterial, mm, type ComponentView } from "./kit";
import { isSeated, smdView } from "./smd";

export { mm, type ComponentView, type Visual } from "./kit";


/** Припой на площадках печатной платы: конус вокруг вывода. */
const solderMaterial = new THREE.MeshStandardMaterial({ color: 0xd4d6d8, metalness: 0.9, roughness: 0.25 });
const solderGeometry = new THREE.ConeGeometry(mm(1.1), mm(1.2), 16);

export function buildComponentView(c: Component): ComponentView {
  // На посадочном месте платы под SMD — корпус SMD, припой на площадках не нужен
  if (isSeated(c) || (c.placement.mode === "free" && smdOnly(c) && footprintOf(c) && !(c.type === "resistor"))) return smdView(c);
  const view = part(c).view(c);
  if (c.placement.mode === "board") {
    for (const id of c.placement.holes) {
      const h = HOLE_BY_ID.get(id)!;
      if (h.board !== "pcb") continue;
      const blob = new THREE.Mesh(solderGeometry, solderMaterial);
      blob.position.set(h.x, h.y + mm(0.5), h.z);
      blob.userData.componentId = c.id;
      blob.userData.shared = true;
      view.group.add(blob);
    }
  }
  return view;
}

// ─── Провода ───────────────────────────────────────────────────────────────

export interface WireView {
  mesh: THREE.Object3D;
  curve: THREE.Curve<THREE.Vector3>;
  length: number;
  dispose(): void;
}

/** Дуга провода: концы уходят вертикально вверх, высота зависит от длины; lift — подъём над другими. */
export function wireCurve(a: THREE.Vector3, b: THREE.Vector3, lift = 0): THREE.CubicBezierCurve3 {
  const top = arcTop(a, b) + lift;
  return new THREE.CubicBezierCurve3(a, a.clone().setY(top), b.clone().setY(top), b);
}

function arcTop(a: THREE.Vector3, b: THREE.Vector3): number {
  const d = a.distanceTo(b);
  return Math.max(a.y, b.y) + THREE.MathUtils.clamp(0.8 + d * 0.22, 1, 7);
}

/** Радиус провода в изоляции, в шагах. */
const WIRE_R = mm(0.75);

/** Больше стольких перемычек друг над другом в одном месте не кладём (гибкие провода — без предела). */
export const MAX_WIRE_LAYERS = 3;

export interface WireLayout {
  id: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  flat: boolean;
  /** Загиб перемычки (Г-образная — два отрезка). */
  bend?: WireBend;
}

/** Отрезки провода на плоскости стола: у Г-образной перемычки — два. */
function segments(w: WireLayout): [THREE.Vector3, THREE.Vector3][] {
  const c = w.flat ? jumperCorner(w.a, w.b, w.bend) : undefined;
  return c ? [[w.a, c], [c, w.b]] : [[w.a, w.b]];
}

/** Где отрезки ab и cd (на плоскости стола) пересекаются: параметры на каждом, или нет. */
function crossing(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): [number, number] | undefined {
  const r = [b.x - a.x, b.z - a.z], s = [d.x - c.x, d.z - c.z];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return undefined;
  const qp = [c.x - a.x, c.z - a.z];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  return t > 0.03 && t < 0.97 && u > 0.03 && u < 0.97 ? [t, u] : undefined;
}

/** Наименьшее расстояние между отрезками ab и cd на плоскости стола. */
function segDist(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number {
  if (crossing(a, b, c, d)) return 0;
  const pt = (p: THREE.Vector3, s0: THREE.Vector3, s1: THREE.Vector3) => {
    const vx = s1.x - s0.x, vz = s1.z - s0.z;
    const l2 = vx * vx + vz * vz || 1;
    const k = THREE.MathUtils.clamp(((p.x - s0.x) * vx + (p.z - s0.z) * vz) / l2, 0, 1);
    return Math.hypot(p.x - s0.x - k * vx, p.z - s0.z - k * vz);
  };
  return Math.min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b));
}

/**
 * Высота проводов, чтобы они не проходили друг сквозь друга: каждый следующий (по порядку в схеме)
 * ложится поверх тех, что уже лежат на его пути. Перемычка — на этаж выше (этаж — толщина провода),
 * дуга — выгибается выше в точке пересечения. null — перемычку выше третьего этажа уже не положить.
 */
export function wireLifts(wires: WireLayout[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const level = new Map<string, number>();
  const clear = 2.2 * WIRE_R;
  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    let lvl = 0;
    let lift = 0;
    for (let j = 0; j < i; j++) {
      const o = wires[j];
      if (o.flat !== w.flat || out.get(o.id) == null) continue;
      if (w.flat) {
        // Перемычки лежат на плате: мешает и та, что проходит рядом, и её ножка в отверстии
        const near = segments(w).some(([p, q]) => segments(o).some(([r, t]) => segDist(p, q, r, t) < 2 * WIRE_R));
        if (near) lvl = Math.max(lvl, level.get(o.id)! + 1);
        continue;
      }
      const x = crossing(w.a, w.b, o.a, o.b);
      if (!x) continue;
      lvl = Math.max(lvl, level.get(o.id)! + 1);
      // Высота той дуги в точке пересечения — наша должна быть выше на толщину провода
      const [t, u] = x;
      const other = wireCurve(o.a, o.b, out.get(o.id)!).getPoint(u).y;
      const mine = wireCurve(w.a, w.b).getPoint(t).y;
      lift = Math.max(lift, (other + clear - mine) / (3 * t * (1 - t)));
    }
    level.set(w.id, lvl);
    // Пересечение у самого края требовало бы огромной дуги — выше 6 шагов не поднимаем
    out.set(w.id, w.flat ? (lvl >= MAX_WIRE_LAYERS ? null : lvl * 2 * WIRE_R) : THREE.MathUtils.clamp(lift, 0, 6));
  }
  return out;
}

/**
 * Перемычка: ножки из отверстий вверх до изоляции, загиб, участок, лежащий на плате (прямой или
 * буквой Г через corner), загиб, ножка вниз. a и b — отверстия на поверхности одной платы.
 */
export function flatWireCurve(a: THREE.Vector3, b: THREE.Vector3, lift = 0, corner?: THREE.Vector3): THREE.CurvePath<THREE.Vector3> {
  const y = a.y + WIRE_R + lift;
  const bottom = a.y - 0.2;
  const pts = [a, ...(corner ? [corner] : []), b].map((p) => p.clone().setY(y));
  const first = pts[1].clone().sub(pts[0]).setY(0).normalize();
  const last = pts.at(-1)!.clone().sub(pts.at(-2)!).setY(0).normalize();
  const bend = Math.min(0.2, a.distanceTo(b) / 4);
  const path = new THREE.CurvePath<THREE.Vector3>();
  // Ножка a вверх и загиб на плату
  const a0 = a.clone().setY(y - bend), a2 = pts[0].clone().addScaledVector(first, bend);
  path.add(new THREE.LineCurve3(a.clone().setY(bottom), a0));
  path.add(new THREE.QuadraticBezierCurve3(a0, pts[0], a2));
  let from = a2;
  if (corner) {
    // Скруглённый угол Г
    const r = Math.min(0.35, pts[0].distanceTo(pts[1]) / 3, pts[1].distanceTo(pts[2]) / 3);
    const c0 = pts[1].clone().addScaledVector(first, -r), c1 = pts[1].clone().addScaledVector(last, r);
    path.add(new THREE.LineCurve3(from, c0));
    path.add(new THREE.QuadraticBezierCurve3(c0, pts[1], c1));
    from = c1;
  }
  const b2 = pts.at(-1)!.clone().addScaledVector(last, -bend), b0 = b.clone().setY(y - bend);
  path.add(new THREE.LineCurve3(from, b2));
  path.add(new THREE.QuadraticBezierCurve3(b2, pts.at(-1)!, b0));
  path.add(new THREE.LineCurve3(b0, b.clone().setY(bottom)));
  return path;
}

/** Угол Г-образной перемычки (или нет) по её концам и загибу. */
export function jumperCorner(a: THREE.Vector3, b: THREE.Vector3, bend: WireBend | undefined): THREE.Vector3 | undefined {
  const pts = jumperPoints([a.x, a.z], [b.x, b.z], bend);
  return pts.length === 3 ? new THREE.Vector3(pts[1][0], a.y, pts[1][1]) : undefined;
}

export function buildWireView(id: string, a: THREE.Vector3, b: THREE.Vector3, color: string, flat = false, lift = 0, bend?: WireBend): WireView {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  if (!flat) {
    const curve = wireCurve(a, b, lift);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, WIRE_R, 10, false), mat);
    mesh.castShadow = true;
    mesh.userData.wireId = id;
    return {
      mesh,
      curve,
      length: curve.getLength(),
      dispose() {
        mesh.geometry.dispose();
        mat.dispose();
      },
    };
  }
  // Голая медь по всей длине (видна на ножках) и изоляция на участках, лежащих на плате
  const corner = jumperCorner(a, b, bend);
  const curve = flatWireCurve(a, b, lift, corner);
  const group = new THREE.Group();
  const copper = new THREE.Mesh(new THREE.TubeGeometry(curve, corner ? 96 : 64, mm(0.32), 8, false), leadMaterial);
  group.add(copper);
  const y = a.y + WIRE_R + lift;
  const pts = [a, ...(corner ? [corner] : []), b].map((p) => p.clone().setY(y));
  const bare = Math.min(0.35, a.distanceTo(b) * 0.2); // у отверстий изоляция срезана
  const geoms: THREE.BufferGeometry[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const dir = pts[k + 1].clone().sub(pts[k]).normalize();
    const p0 = pts[k].clone().addScaledVector(dir, k === 0 ? bare : 0);
    const p1 = pts[k + 1].clone().addScaledVector(dir, k === pts.length - 2 ? -bare : 0);
    const geo = new THREE.CylinderGeometry(WIRE_R, WIRE_R, p0.distanceTo(p1), 14, 1);
    const seg = new THREE.Mesh(geo, mat);
    seg.position.copy(p0).add(p1).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(Y, dir);
    group.add(seg);
    geoms.push(geo);
  }
  if (corner) {
    // Изоляция на изгибе
    const geo = new THREE.SphereGeometry(WIRE_R, 14, 10);
    const knee = new THREE.Mesh(geo, mat);
    knee.position.copy(pts[1]);
    group.add(knee);
    geoms.push(geo);
  }
  group.traverse((o) => {
    o.userData.wireId = id;
    o.castShadow = true;
  });
  return {
    mesh: group,
    curve,
    length: curve.getLength(),
    dispose() {
      copper.geometry.dispose();
      for (const g of geoms) g.dispose();
      mat.dispose();
    },
  };
}

// ─── Дорожки печатной платы ────────────────────────────────────────────────

const copperMaterial = new THREE.MeshStandardMaterial({ color: 0xc8793a, metalness: 0.35, roughness: 0.4 });
/** Радиус отверстия площадки (в шагах) — как на текстуре платы. */
const PAD_HOLE_R = 0.16;

/**
 * Медная дорожка между двумя площадками: полоса шириной с площадку (1,8 мм), концы скруглены
 * по контуру площадок, отверстия площадок остаются открытыми.
 */
export function buildTraceView(id: string, a: Hole, b: Hole) {
  const group = new THREE.Group();
  const y = a.y + 0.004;
  const pa = new THREE.Vector3(a.x, y, a.z);
  const pb = new THREE.Vector3(b.x, y, b.z);
  const len = pa.distanceTo(pb);
  const fine = fineTrace(a.id);
  const r = (fine ? FINE_TRACE_WIDTH_MM : TRACE_WIDTH_MM) / 2.54 / 2;
  // Контур «стадион» вдоль оси X от 0 до len, в плоскости XY
  const shape = new THREE.Shape();
  shape.moveTo(0, -r);
  shape.lineTo(len, -r);
  shape.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(0, r);
  shape.absarc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  for (const x of fine ? [] : [0, len]) {
    const hole = new THREE.Path();
    hole.absarc(x, 0, PAD_HOLE_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 16 });
  geom.rotateX(-Math.PI / 2); // Y контура → −Z, толщина вверх
  const strip = new THREE.Mesh(geom, copperMaterial);
  strip.position.copy(pa);
  strip.rotation.y = Math.atan2(-(pb.z - pa.z), pb.x - pa.x);
  group.add(strip);
  group.traverse((o) => (o.userData.traceId = id));
  const lift = new THREE.Vector3(0, 0.2, 0);
  const curve = new THREE.LineCurve3(pa.clone().add(lift), pb.clone().add(lift));
  return { mesh: group, curve, length: Math.max(len, 0.01) };
}
