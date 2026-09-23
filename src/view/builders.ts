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

/** Дуга провода: концы уходят вертикально вверх, высота зависит от длины. */
export function wireCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.CubicBezierCurve3 {
  const d = a.distanceTo(b);
  const h = THREE.MathUtils.clamp(0.8 + d * 0.22, 1, 7);
  const top = Math.max(a.y, b.y) + h;
  return new THREE.CubicBezierCurve3(a, a.clone().setY(top), b.clone().setY(top), b);
}

/** Радиус провода в изоляции, в шагах. */
const WIRE_R = mm(0.75);

/**
 * Прямая перемычка: ножки из отверстий вверх до изоляции, загиб, прямой участок, лежащий
 * на плате, загиб, ножка вниз. a и b — отверстия на поверхности одной платы.
 */
export function flatWireCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.CurvePath<THREE.Vector3> {
  const y = a.y + WIRE_R;
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

export function buildWireView(id: string, a: THREE.Vector3, b: THREE.Vector3, color: string, flat = false): WireView {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  if (!flat) {
    const curve = wireCurve(a, b);
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
  const curve = flatWireCurve(a, b);
  const group = new THREE.Group();
  const copper = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, mm(0.32), 8, false), leadMaterial);
  group.add(copper);
  const dir = b.clone().sub(a).setY(0).normalize();
  const d = a.distanceTo(b);
  const bare = Math.min(0.35, d * 0.2); // у отверстий изоляция срезана
  const y = a.y + WIRE_R;
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
