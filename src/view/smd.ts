/**
 * 3D-вид SMD-детали: корпус по посадочному месту (SOT-23, SOIC, чип 0805…) и выводы «крылом
 * чайки» на площадки. На плате под SMD — над своим посадочным местом, на столе — там, где положили.
 */

import * as THREE from "three";
import { HOLE_BY_ID, PCB_HEIGHT, footprintBody, footprintPads, seatOf, type Footprint } from "../model/breadboard";
import { MOSFETS, TRANSISTORS, footprintOf, padNumbers, type Component } from "../model/types";
import { smdCode } from "../sim/resistorCodes";
import { Y, disposeGroup, lead, leadMaterial, mm, tagPickable, type ComponentView } from "./kit";

/** Где стоит деталь: центр посадочного места, поворот и высота поверхности. */
export interface SmdFrame {
  x: number;
  z: number;
  y: number;
  angle: number;
}

/** Стоит ли деталь на посадочном месте платы под SMD. */
export function isSeated(c: Component): boolean {
  return c.placement.mode === "board" && !!HOLE_BY_ID.get(c.placement.holes[0])?.seat;
}

function frameOf(c: Component): SmdFrame {
  if (c.placement.mode === "free") return { x: c.placement.x, z: c.placement.z, y: 0, angle: c.placement.rot };
  const s = seatOf(c.placement.holes[0])!;
  return { x: s.board.x + s.seat.x, z: s.board.z + s.seat.z, y: PCB_HEIGHT, angle: (s.seat.rot * Math.PI) / 2 };
}

/** Маркировка на корпусе. */
function marking(c: Component): string {
  if (c.type === "resistor") return smdCode(c.ohms);
  if (c.type === "transistor") return TRANSISTORS[c.kind].mark ?? "";
  if (c.type === "mosfet") return (MOSFETS[c.kind] as { mark?: string }).mark ?? "";
  if (c.type === "chip") return c.name;
  return "";
}

function markTexture(text: string, aspect: number, bg: string, key: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.height = 96;
  canvas.width = Math.max(96, Math.round(96 * aspect));
  const g = canvas.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#c9ccd1";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 56;
  do {
    g.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
    size -= 2;
  } while (g.measureText(text).width > canvas.width * 0.86 && size > 12);
  g.fillText(text, canvas.width / 2, canvas.height / 2);
  if (key) {
    // Ключ — точка у вывода 1 (левый ближний угол)
    g.beginPath();
    g.arc(16, canvas.height - 16, 8, 0, Math.PI * 2);
    g.fillStyle = "#3a3d42";
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Двухвыводной чип (резистор, конденсатор): корпус и металлизированные торцы. */
function chipBody(group: THREE.Group, fp: Footprint, c: Component): THREE.MeshStandardMaterial {
  const [l, w, h] = footprintBody(fp);
  const L = mm(l), W = mm(w), T = mm(h);
  const ceramic = c.type === "capacitor";
  const bodyMat = new THREE.MeshStandardMaterial({ color: ceramic ? 0xa8845a : 0x1a1c1f, roughness: 0.5 });
  const cap = L * 0.18;
  const top = ceramic ? bodyMat : new THREE.MeshStandardMaterial({ map: markTexture(marking(c), l / w, "#1a1c1f", false), roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * cap, T, W), [bodyMat, bodyMat, top, bodyMat, bodyMat, bodyMat]);
  body.position.y = T / 2 + mm(0.05);
  group.add(body);
  for (const sx of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(cap, T * 1.02, W * 1.01), leadMaterial);
    end.position.set(sx * (L / 2 - cap / 2), T / 2 + mm(0.05), 0);
    group.add(end);
  }
  return bodyMat;
}

/** Корпус с выводами «крылом чайки» (SOT-23, SOIC): от боков корпуса к площадкам. */
function gullBody(group: THREE.Group, fp: Footprint, c: Component): THREE.MeshStandardMaterial {
  const [l, w, h] = footprintBody(fp);
  const L = mm(l), W = mm(w), T = mm(h);
  const lift = mm(0.1);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.55 });
  const top = new THREE.MeshStandardMaterial({ map: markTexture(marking(c), l / w, "#1c1e21", fp.startsWith("SO-") || fp !== "SOT-23"), roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [bodyMat, bodyMat, top, bodyMat, bodyMat, bodyMat]);
  body.position.y = lift + T / 2;
  group.add(body);
  const r = mm(fp.startsWith("SO-") ? 0.2 : 0.14);
  const ym = lift + T * 0.45;
  for (const p of footprintPads(fp)) {
    const s = Math.sign(p.z);
    const x = mm(p.x);
    group.add(
      lead(
        [
          new THREE.Vector3(x, ym, s * (W / 2 - mm(0.1))),
          new THREE.Vector3(x, ym, s * (W / 2 + mm(0.2))),
          new THREE.Vector3(x, mm(0.12), s * (W / 2 + mm(0.45))),
          new THREE.Vector3(x, mm(0.12), mm(p.z) + s * mm(p.d * 0.3)),
        ],
        r,
      ),
    );
  }
  return bodyMat;
}

/** Вид SMD-детали (на посадочном месте или на столе). frame — задать место явно (для призрака). */
export function smdView(c: Component, frame: SmdFrame = frameOf(c)): ComponentView {
  const fp = footprintOf(c)!;
  const group = new THREE.Group();
  const bodyMat = footprintPads(fp).length === 2 ? chipBody(group, fp, c) : gullBody(group, fp, c);
  const baseColor = bodyMat.color.clone();
  group.position.set(frame.x, frame.y, frame.z);
  group.rotation.y = frame.angle;
  const place = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(Y, frame.angle).add(new THREE.Vector3(frame.x, frame.y, frame.z));
  const pads = footprintPads(fp);
  const pins =
    c.placement.mode === "board" && isSeated(c)
      ? c.placement.holes.map((id) => {
          const h = HOLE_BY_ID.get(id)!;
          return new THREE.Vector3(h.x, h.y + mm(0.1), h.z);
        })
      : padNumbers(c, pads.length).map((n) => place(mm(pads[n - 1].x), mm(0.1), mm(pads[n - 1].z)));
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot: place(0, mm(footprintBody(fp)[2] + 0.2), 0),
    update(v) {
      if (v.burned) {
        bodyMat.color.set(0x120e0b);
        bodyMat.emissive.set(0x000000);
        return;
      }
      bodyMat.color.copy(baseColor).lerp(new THREE.Color(0x3b2410), v.heat * 0.8);
      bodyMat.emissive.setRGB(1, 0.25, 0.05).multiplyScalar(v.heat > 0.4 ? (v.heat - 0.4) * 1.2 : 0);
    },
    dispose: () => disposeGroup(group),
  };
}
