/**
 * Общие заготовки 3D-вида деталей: выводы, раскладка на плате и на столе, материалы.
 * Сами виды — в файлах деталей (src/parts), сборка — в builders.ts.
 */

import * as THREE from "three";
import { HOLE_BY_ID } from "../model/breadboard";
import type { Component } from "../model/types";

/** Миллиметры → единицы сцены (шаг 2,54 мм). */
export const mm = (v: number) => v / 2.54;
export const Y = new THREE.Vector3(0, 1, 0);

export interface Visual {
  /** Яркость лампы или светодиода: доля номинальной мощности (лампа) или тока (светодиод). */
  brightness: number;
  /** Накопленный перегрев 0…1. */
  heat: number;
  burned: boolean;
  shorted: boolean;
  time: number;
  /** Картинка для экрана прибора (осциллограф, мультиметр): считается, только когда её рисуют. */
  screen?: () => unknown;
  /** Показания лабораторного блока (для его дисплея). */
  display?: { volts: number; amps: number; mode: "CV" | "CC"; on: boolean };
}

export interface ComponentView {
  group: THREE.Group;
  /** Мировые координаты выводов: куда цепляются провода. */
  pins: THREE.Vector3[];
  /** Точка, откуда идёт дым или свет. */
  hotspot: THREE.Vector3;
  update(v: Visual): void;
  dispose(): void;
}

export const leadMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.32 });
export const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.85, roughness: 0.35 });
export const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6 });

export function lead(points: THREE.Vector3[], radius = mm(0.3)): THREE.Mesh {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) path.add(new THREE.LineCurve3(points[i], points[i + 1]));
  const geom = new THREE.TubeGeometry(path, Math.max(8, points.length * 10), radius, 8, false);
  const mesh = new THREE.Mesh(geom, leadMaterial);
  mesh.castShadow = true;
  return mesh;
}

export function holePos(id: string): THREE.Vector3 {
  const h = HOLE_BY_ID.get(id)!;
  return new THREE.Vector3(h.x, h.y, h.z);
}

/** Мировые позиции точек, заданных в локальных координатах свободно стоящей детали. */
export function freeTransform(c: Component, local: THREE.Vector3): THREE.Vector3 {
  if (c.placement.mode !== "free") throw new Error("ожидалась свободная деталь");
  return local.clone().applyAxisAngle(Y, c.placement.rot).add(new THREE.Vector3(c.placement.x, 0, c.placement.z));
}

export function tagPickable(group: THREE.Group, id: string): void {
  group.traverse((o) => {
    o.userData.componentId = id;
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

export function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (m.userData.shared) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (mat === leadMaterial || mat === brassMaterial || mat === blackPlastic) continue;
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    }
  });
}

/** Оставляет два вывода на плате так, чтобы корпус оказался посередине над ними. */
export function boardFrame(holes: string[]) {
  const p0 = holePos(holes[0]);
  const p1 = holePos(holes[1]);
  const mid = p0.clone().add(p1).multiplyScalar(0.5);
  const dir = p1.clone().sub(p0).setY(0);
  const dist = dir.length();
  dir.normalize();
  const angle = Math.atan2(-dir.z, dir.x); // поворот вокруг Y, чтобы локальная +X смотрела вдоль dir
  return { p0, p1, mid, dir, dist, angle };
}


/**
 * Раскладка детали с выводами по оси (резистор, диод). Корпус t.body построен вдоль локальной +X
 * от вывода 0 к выводу 1. На столе лежит; на плате лежит над отверстиями, а если они слишком близко — стоит.
 */
export function axialLayout(c: Component, group: THREE.Group, body: THREE.Object3D, L: number, r: number) {
  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  if (c.placement.mode === "free") {
    const lift = r;
    body.position.y = lift;
    group.add(body);
    const reach = L / 2 + 1.4;
    group.add(lead([new THREE.Vector3(-L / 2 + 0.1, lift, 0), new THREE.Vector3(-reach, mm(0.3), 0)]));
    group.add(lead([new THREE.Vector3(L / 2 - 0.1, lift, 0), new THREE.Vector3(reach, mm(0.3), 0)]));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    pins = [freeTransform(c, new THREE.Vector3(-reach, mm(0.3), 0)), freeTransform(c, new THREE.Vector3(reach, mm(0.3), 0))];
    hotspot = freeTransform(c, new THREE.Vector3(0, lift * 2, 0));
    return { pins, hotspot };
  }
  const f = boardFrame(c.placement.holes);
  const H = f.p0.y; // поверхность платы: макетка или печатная плата
  pins = [f.p0, f.p1];
  if (f.dist >= L + 0.8) {
    // Лёжа над платой
    const y = H + 0.9;
    body.position.set(f.mid.x, y, f.mid.z);
    body.rotation.y = f.angle;
    group.add(body);
    const e0 = f.mid.clone().addScaledVector(f.dir, -L / 2 + 0.1).setY(y);
    const e1 = f.mid.clone().addScaledVector(f.dir, L / 2 - 0.1).setY(y);
    group.add(lead([f.p0.clone().setY(H - 0.2), f.p0.clone().setY(y - 0.25), f.p0.clone().setY(y), e0]));
    group.add(lead([f.p1.clone().setY(H - 0.2), f.p1.clone().setY(y - 0.25), f.p1.clone().setY(y), e1]));
    hotspot = f.mid.clone().setY(y + r);
  } else {
    // Стоя: корпус над первым отверстием, второй вывод загнут сверху
    const bottom = H + 0.4;
    body.position.set(f.p0.x, bottom + L / 2, f.p0.z);
    body.rotation.z = Math.PI / 2;
    body.rotation.y = f.angle;
    group.add(body);
    const top = bottom + L + 0.35;
    group.add(lead([f.p0.clone().setY(H - 0.2), f.p0.clone().setY(bottom + 0.1)]));
    group.add(lead([f.p0.clone().setY(bottom + L - 0.1), f.p0.clone().setY(top), f.p1.clone().setY(top), f.p1.clone().setY(H - 0.2)]));
    hotspot = f.p0.clone().setY(bottom + L);
  }
  return { pins, hotspot };
}

/**
 * Раскладка радиальной детали (конденсатор, светодиод): корпус стоит вертикально,
 * оба вывода выходят снизу. Корпус построен так, что локальная +X смотрит на вывод 1.
 * spacing — расстояние между выводами у корпуса, bottom — высота низа корпуса над платой/столом.
 */
export function radialLayout(c: Component, group: THREE.Group, body: THREE.Object3D, spacing: number, bottom: number, height: number) {
  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  if (c.placement.mode === "free") {
    body.position.y = bottom;
    group.add(body);
    for (const sx of [-1, 1]) {
      group.add(lead([new THREE.Vector3((sx * spacing) / 2, bottom + 0.1, 0), new THREE.Vector3((sx * spacing) / 2, 0.4, 0), new THREE.Vector3(sx * (spacing / 2 + 1.2), mm(0.3), 0)]));
    }
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    const reach = spacing / 2 + 1.2;
    pins = [freeTransform(c, new THREE.Vector3(-reach, mm(0.3), 0)), freeTransform(c, new THREE.Vector3(reach, mm(0.3), 0))];
    hotspot = freeTransform(c, new THREE.Vector3(0, bottom + height, 0));
    return { pins, hotspot };
  }
  const f = boardFrame(c.placement.holes);
  const H = f.p0.y;
  pins = [f.p0, f.p1];
  const y = H + bottom;
  body.position.set(f.mid.x, y, f.mid.z);
  body.rotation.y = f.angle;
  group.add(body);
  const a0 = f.mid.clone().addScaledVector(f.dir, -spacing / 2);
  const a1 = f.mid.clone().addScaledVector(f.dir, spacing / 2);
  group.add(lead([f.p0.clone().setY(H - 0.2), f.p0.clone().setY(H + 0.3), a0.clone().setY(H + 0.6), a0.clone().setY(y + 0.1)]));
  group.add(lead([f.p1.clone().setY(H - 0.2), f.p1.clone().setY(H + 0.3), a1.clone().setY(H + 0.6), a1.clone().setY(y + 0.1)]));
  hotspot = f.mid.clone().setY(y + height);
  return { pins, hotspot };
}


/** Табличка с надписью на canvas (этикетка батареи и т. п.). */
export function labelTexture(lines: string[], bg: string, fg: string, w = 512, h = 256): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((line, i) => {
    g.font = i === 0 ? `700 ${h * 0.42}px "IBM Plex Sans", system-ui, sans-serif` : `500 ${h * 0.14}px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText(line, w / 2, i === 0 ? h * 0.42 : h * 0.78);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
