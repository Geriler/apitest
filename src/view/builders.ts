import * as THREE from "three";
import { HOLE_BY_ID, type Hole } from "../model/breadboard";
import { TRACE_WIDTH_MM, type Component } from "../model/types";
import { part } from "../parts";
import { Y, leadMaterial, mm, type ComponentView } from "./kit";

export { mm, type ComponentView, type Visual } from "./kit";


/** Припой на площадках печатной платы: конус вокруг вывода. */
const solderMaterial = new THREE.MeshStandardMaterial({ color: 0xd4d6d8, metalness: 0.9, roughness: 0.25 });
const solderGeometry = new THREE.ConeGeometry(mm(1.1), mm(1.2), 16);

export function buildComponentView(c: Component): ComponentView {
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

/** Больше стольких проводов друг над другом в одном месте не кладём. */
export const MAX_WIRE_LAYERS = 4;

export interface WireLayout {
  id: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  flat: boolean;
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
 * дуга — выгибается выше в точке пересечения. null — выше четвёртого этажа уже не положить.
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
        if (segDist(w.a, w.b, o.a, o.b) < 2 * WIRE_R) lvl = Math.max(lvl, level.get(o.id)! + 1);
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
    out.set(w.id, lvl >= MAX_WIRE_LAYERS ? null : w.flat ? lvl * 2 * WIRE_R : THREE.MathUtils.clamp(lift, 0, 6));
  }
  return out;
}

/**
 * Прямая перемычка: ножки из отверстий вверх до изоляции, загиб, прямой участок, лежащий
 * на плате, загиб, ножка вниз. a и b — отверстия на поверхности одной платы.
 */
export function flatWireCurve(a: THREE.Vector3, b: THREE.Vector3, lift = 0): THREE.CurvePath<THREE.Vector3> {
  const y = a.y + WIRE_R + lift;
  const bottom = a.y - 0.2;
  const dir = b.clone().sub(a).setY(0).normalize();
  const bend = Math.min(0.2, a.distanceTo(b) / 4);
  const corner = (p: THREE.Vector3, sign: number) => [p.clone().setY(y - bend), p.clone().setY(y), p.clone().setY(y).addScaledVector(dir, sign * bend)] as const;
  const [a0, a1, a2] = corner(a, 1);
  const [b0, b1, b2] = corner(b, -1);
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.LineCurve3(a.clone().setY(bottom), a0));
  path.add(new THREE.QuadraticBezierCurve3(a0, a1, a2));
  path.add(new THREE.LineCurve3(a2, b2));
  path.add(new THREE.QuadraticBezierCurve3(b2, b1, b0));
  path.add(new THREE.LineCurve3(b0, b.clone().setY(bottom)));
  return path;
}

export function buildWireView(id: string, a: THREE.Vector3, b: THREE.Vector3, color: string, flat = false, lift = 0): WireView {
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
  // Голая медь по всей длине (видна на ножках) и изоляция на прямом участке
  const curve = flatWireCurve(a, b, lift);
  const group = new THREE.Group();
  const copper = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, mm(0.32), 8, false), leadMaterial);
  group.add(copper);
  const dir = b.clone().sub(a).setY(0).normalize();
  const d = a.distanceTo(b);
  const bare = Math.min(0.35, d * 0.2); // у отверстий изоляция срезана
  const y = a.y + WIRE_R + lift;
  const p0 = a.clone().setY(y).addScaledVector(dir, bare);
  const p1 = b.clone().setY(y).addScaledVector(dir, -bare);
  const insulation = new THREE.Mesh(new THREE.CylinderGeometry(WIRE_R, WIRE_R, p0.distanceTo(p1), 14, 1), mat);
  insulation.position.copy(p0).add(p1).multiplyScalar(0.5);
  insulation.quaternion.setFromUnitVectors(Y, dir);
  group.add(insulation);
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
      insulation.geometry.dispose();
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
  const r = TRACE_WIDTH_MM / 2.54 / 2;
  // Контур «стадион» вдоль оси X от 0 до len, в плоскости XY
  const shape = new THREE.Shape();
  shape.moveTo(0, -r);
  shape.lineTo(len, -r);
  shape.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(0, r);
  shape.absarc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  for (const x of [0, len]) {
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
