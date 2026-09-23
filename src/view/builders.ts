import * as THREE from "three";
import { BOARD, HOLE_BY_ID } from "../model/breadboard";
import {
  BATTERIES,
  CERAMICS,
  LEDS,
  SMD_SIZES,
  THT_RESISTOR,
  TRANSISTORS,
  electrolyticSize,
  type Battery,
  type Capacitor,
  type Component,
  type Diode,
  type Lamp,
  type Led,
  type Resistor,
  type Switch,
  type Transistor,
} from "../model/types";
import { colorBands, smdCode } from "../sim/resistorCodes";
import { smdLabelTexture } from "./textures";

/** Миллиметры → единицы сцены (шаг 2,54 мм). */
export const mm = (v: number) => v / 2.54;
const H = BOARD.height;
const Y = new THREE.Vector3(0, 1, 0);

export interface Visual {
  /** Яркость лампы или светодиода: доля номинальной мощности (лампа) или тока (светодиод). */
  brightness: number;
  /** Накопленный перегрев 0…1. */
  heat: number;
  burned: boolean;
  shorted: boolean;
  time: number;
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

const leadMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.32 });
const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.85, roughness: 0.35 });
const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6 });

function lead(points: THREE.Vector3[], radius = mm(0.3)): THREE.Mesh {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) path.add(new THREE.LineCurve3(points[i], points[i + 1]));
  const geom = new THREE.TubeGeometry(path, Math.max(8, points.length * 10), radius, 8, false);
  const mesh = new THREE.Mesh(geom, leadMaterial);
  mesh.castShadow = true;
  return mesh;
}

function holePos(id: string): THREE.Vector3 {
  const h = HOLE_BY_ID.get(id)!;
  return new THREE.Vector3(h.x, H, h.z);
}

/** Мировые позиции точек, заданных в локальных координатах свободно стоящей детали. */
function freeTransform(c: Component, local: THREE.Vector3): THREE.Vector3 {
  if (c.placement.mode !== "free") throw new Error("ожидалась свободная деталь");
  return local.clone().applyAxisAngle(Y, c.placement.rot).add(new THREE.Vector3(c.placement.x, 0, c.placement.z));
}

function tagPickable(group: THREE.Group, id: string): void {
  group.traverse((o) => {
    o.userData.componentId = id;
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
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
function boardFrame(holes: string[]) {
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
function axialLayout(c: Component, group: THREE.Group, body: THREE.Object3D, L: number, r: number) {
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
function radialLayout(c: Component, group: THREE.Group, body: THREE.Object3D, spacing: number, bottom: number, height: number) {
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

// ─── Резисторы ─────────────────────────────────────────────────────────────

function thtBody(c: Resistor) {
  const L = mm(THT_RESISTOR.lengthMm);
  const r = mm(THT_RESISTOR.diameterMm) / 2;
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

// ─── Лампа ─────────────────────────────────────────────────────────────────

function lampView(c: Lamp): ComponentView {
  const group = new THREE.Group();
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xfff6e0,
    roughness: 0.08,
    transmission: 0.6,
    transparent: true,
    opacity: 0.55,
    emissive: new THREE.Color(0xffc46b),
    emissiveIntensity: 0,
  });
  const filamentMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, emissive: new THREE.Color(0xffb347), emissiveIntensity: 0 });
  const light = new THREE.PointLight(0xffc27a, 0, 14, 2);
  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;

  const bulb = (r: number) => {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), glassMat);
    glass.scale.y = 1.25;
    g.add(glass);
    const filament = new THREE.Mesh(new THREE.TorusGeometry(r * 0.28, r * 0.05, 6, 16, Math.PI), filamentMat);
    filament.position.y = -r * 0.1;
    g.add(filament);
    g.add(light);
    return g;
  };

  if (c.placement.mode === "free") {
    // Патрон E10 на подставке с двумя винтовыми клеммами
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 1.4, 28), blackPlastic);
    base.position.y = 0.7;
    group.add(base);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.6, 20), brassMaterial);
    socket.position.y = 2.2;
    group.add(socket);
    const b = bulb(1.9);
    b.position.y = 4.8;
    group.add(b);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.7, 12), brassMaterial);
      post.position.set(sx * 2.9, 0.35, 0);
      group.add(post);
    }
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    pins = [freeTransform(c, new THREE.Vector3(-2.9, 0.7, 0)), freeTransform(c, new THREE.Vector3(2.9, 0.7, 0))];
    hotspot = freeTransform(c, new THREE.Vector3(0, 4.8, 0));
  } else {
    // Миниатюрная лампа с проволочными выводами, Ø 5 мм
    const f = boardFrame(c.placement.holes);
    pins = [f.p0, f.p1];
    const r = mm(2.5);
    const y = H + 2.4;
    const b = bulb(r);
    b.position.set(f.mid.x, y, f.mid.z);
    group.add(b);
    const foot = y - r * 1.2;
    const a0 = f.mid.clone().addScaledVector(f.dir, -r * 0.3).setY(foot);
    const a1 = f.mid.clone().addScaledVector(f.dir, r * 0.3).setY(foot);
    group.add(lead([f.p0.clone().setY(H - 0.2), f.p0.clone().setY(H + 0.6), a0.clone().setY(foot - 0.3), a0.clone().setY(foot + 0.3)], mm(0.25)));
    group.add(lead([f.p1.clone().setY(H - 0.2), f.p1.clone().setY(H + 0.6), a1.clone().setY(foot - 0.3), a1.clone().setY(foot + 0.3)], mm(0.25)));
    hotspot = f.mid.clone().setY(y);
  }

  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot,
    update(v) {
      if (v.burned) {
        glassMat.color.set(0x8a8478);
        glassMat.emissiveIntensity = 0;
        filamentMat.emissiveIntensity = 0;
        light.intensity = 0;
        return;
      }
      const b = Math.min(v.brightness, 1.6);
      // Свечение нити нелинейно растёт с мощностью; при 10 % почти не видно.
      const glow = Math.pow(Math.max(0, b), 1.6);
      glassMat.emissiveIntensity = glow * 3.2;
      filamentMat.emissiveIntensity = glow * 10;
      light.intensity = glow * 22;
    },
    dispose: () => disposeGroup(group),
  };
}

// ─── Выключатель ───────────────────────────────────────────────────────────

function switchView(c: Switch): ComponentView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 1.8), blackPlastic);
  housing.position.y = 0.8;
  body.add(housing);
  const bushing = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 16), leadMaterial);
  bushing.position.y = 1.85;
  body.add(bushing);
  const lever = new THREE.Group();
  const leverMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.8, 12), leadMaterial);
  leverMesh.position.y = 0.9;
  lever.add(leverMesh);
  lever.position.y = 1.9;
  lever.rotation.z = c.closed ? -0.45 : 0.45;
  body.add(lever);

  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  if (c.placement.mode === "free") {
    body.position.y = 0.4;
    group.add(body);
    for (const sx of [-1, 1]) group.add(lead([new THREE.Vector3(sx * 0.8, 0.5, 0), new THREE.Vector3(sx * 2.2, mm(0.3), 0)]));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    pins = [freeTransform(c, new THREE.Vector3(-2.2, mm(0.3), 0)), freeTransform(c, new THREE.Vector3(2.2, mm(0.3), 0))];
    hotspot = freeTransform(c, new THREE.Vector3(0, 2.4, 0));
  } else {
    const f = boardFrame(c.placement.holes);
    pins = [f.p0, f.p1];
    const y = H + 0.7;
    body.position.set(f.mid.x, y, f.mid.z);
    body.rotation.y = f.angle;
    group.add(body);
    const e0 = f.mid.clone().addScaledVector(f.dir, -0.8).setY(y + 0.1);
    const e1 = f.mid.clone().addScaledVector(f.dir, 0.8).setY(y + 0.1);
    group.add(lead([f.p0.clone().setY(H - 0.2), f.p0.clone().setY(y - 0.2), e0]));
    group.add(lead([f.p1.clone().setY(H - 0.2), f.p1.clone().setY(y - 0.2), e1]));
    hotspot = f.mid.clone().setY(y + 2);
  }
  tagPickable(group, c.id);
  return { group, pins, hotspot, update() {}, dispose: () => disposeGroup(group) };
}

// ─── Батарея ───────────────────────────────────────────────────────────────

function labelTexture(lines: string[], bg: string, fg: string, w = 512, h = 256): THREE.CanvasTexture {
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

function batteryView(c: Battery): ComponentView {
  const group = new THREE.Group();
  const spec = BATTERIES[c.kind];
  const casingMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.45, emissive: new THREE.Color(0xff3b1f), emissiveIntensity: 0 });
  const mats: THREE.Material[] = [casingMat];
  let pinLocal: [THREE.Vector3, THREE.Vector3];

  if (c.kind === "9V") {
    // «Крона»: 48,5 × 26,5 × 17,5 мм, лёжа, клеммы смотрят в +X
    const Lx = mm(48.5), Hy = mm(17.5), Wz = mm(26.5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(Lx, Hy, Wz), casingMat);
    box.position.y = Hy / 2;
    group.add(box);
    const labelMat = new THREE.MeshStandardMaterial({ map: labelTexture(["9 В", "6F22 · КРОНА"], "#c8372d", "#fbf3e6"), roughness: 0.5 });
    mats.push(labelMat);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(Lx * 0.8, Wz * 0.85), labelMat);
    label.rotation.x = -Math.PI / 2;
    label.position.y = Hy + 0.01;
    group.add(label);
    const plus = new THREE.Mesh(new THREE.CylinderGeometry(mm(2.9), mm(2.9), mm(3), 20), leadMaterial);
    plus.rotation.z = Math.PI / 2;
    plus.position.set(Lx / 2 + mm(1.5), Hy / 2, -mm(6.35));
    const minus = new THREE.Mesh(new THREE.CylinderGeometry(mm(4.2), mm(4.2), mm(3), 6), leadMaterial);
    minus.rotation.z = Math.PI / 2;
    minus.position.set(Lx / 2 + mm(1.5), Hy / 2, mm(6.35));
    group.add(plus, minus);
    pinLocal = [new THREE.Vector3(Lx / 2 + mm(3), Hy / 2, mm(6.35)), new THREE.Vector3(Lx / 2 + mm(3), Hy / 2, -mm(6.35))];
  } else {
    // Батарейный отсек на 1–3 элемента AA (Ø 14,5 × 50,5 мм)
    const n = c.kind === "1.5V" ? 1 : c.kind === "3V" ? 2 : 3;
    const cellR = mm(14.5) / 2, cellL = mm(50.5);
    const Lx = cellL + mm(8), Wz = n * mm(15.5) + mm(3), Hy = mm(15);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(Lx, Hy * 0.6, Wz), casingMat);
    tray.position.y = Hy * 0.3;
    group.add(tray);
    const cellMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.55, metalness: 0.1 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xb89a55, roughness: 0.5, metalness: 0.5 });
    mats.push(cellMat, capMat);
    for (let i = 0; i < n; i++) {
      const z = -Wz / 2 + mm(1.5) + mm(15.5) * (i + 0.5);
      const cell = new THREE.Mesh(new THREE.CylinderGeometry(cellR, cellR, cellL, 24), cellMat);
      cell.rotation.z = Math.PI / 2;
      cell.position.set(0, cellR + mm(1.5), z); // лежит в ложементе отсека
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(cellR * 1.001, cellR * 1.001, cellL * 0.28, 24), capMat);
      cap.rotation.z = Math.PI / 2;
      // Элементы чередуются: + то справа, то слева
      cap.position.set((i % 2 === 0 ? 1 : -1) * cellL * 0.36, cellR + mm(1.5), z);
      group.add(cell, cap);
    }
    const labelMat = new THREE.MeshStandardMaterial({ map: labelTexture([spec.label.split(", ").pop()!, spec.label.split(", ")[0]], "#22262b", "#e9e4d6"), roughness: 0.6 });
    mats.push(labelMat);
    // Наклейка на боковой стенке отсека
    const label = new THREE.Mesh(new THREE.PlaneGeometry(Hy * 1.2, Hy * 0.6), labelMat);
    label.position.set(0, Hy * 0.3, Wz / 2 + 0.01);
    group.add(label);
    // Выводные провода отсека: красный (+) и чёрный (−) с лужёными концами
    const redMat = new THREE.MeshStandardMaterial({ color: 0xc8261f, roughness: 0.5 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.5 });
    mats.push(redMat, blackMat);
    const stub = (z: number, mat: THREE.Material) => {
      const path = new THREE.CubicBezierCurve3(
        new THREE.Vector3(Lx / 2 - 0.2, Hy * 0.3, z * 0.4),
        new THREE.Vector3(Lx / 2 + 2, Hy * 0.3, z * 0.4),
        new THREE.Vector3(Lx / 2 + 2, 0.3, z),
        new THREE.Vector3(Lx / 2 + 3.4, 0.3, z),
      );
      group.add(new THREE.Mesh(new THREE.TubeGeometry(path, 16, mm(0.8), 8, false), mat));
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(mm(0.45), mm(0.45), 1, 8), leadMaterial);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(Lx / 2 + 3.9, 0.3, z);
      group.add(tip);
    };
    stub(1.4, blackMat);
    stub(-1.4, redMat);
    pinLocal = [new THREE.Vector3(Lx / 2 + 4.4, 0.3, 1.4), new THREE.Vector3(Lx / 2 + 4.4, 0.3, -1.4)];
  }

  if (c.placement.mode !== "free") throw new Error("Батарея ставится только на стол");
  group.position.set(c.placement.x, 0, c.placement.z);
  group.rotation.y = c.placement.rot;
  tagPickable(group, c.id);
  const pins = [freeTransform(c, pinLocal[0]), freeTransform(c, pinLocal[1])];
  return {
    group,
    pins,
    hotspot: pins[0].clone().add(pins[1]).multiplyScalar(0.5),
    update(v) {
      casingMat.emissiveIntensity = v.shorted ? 0.25 + 0.2 * Math.sin(v.time * 9) : 0;
    },
    dispose: () => disposeGroup(group),
  };
}


// ─── Конденсаторы ──────────────────────────────────────────────────────────

/** Оболочка электролита: тёмно-синяя, со светлой полосой «−» по центру развёртки (u = 0,25 → +X). */
function sleeveTexture(uF: number): THREE.CanvasTexture {
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
  g.fillText("16V", w * 0.75, h * 0.62);
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
    const size = electrolyticSize(c.uF);
    const r = mm(size.diaMm) / 2;
    const h = mm(size.heightMm);
    bodyMat = new THREE.MeshStandardMaterial({ map: sleeveTexture(c.uF), roughness: 0.45 });
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

// ─── Диод 1N4007 ───────────────────────────────────────────────────────────

function diodeView(c: Diode): ComponentView {
  const group = new THREE.Group();
  const L = mm(5.2);
  const r = mm(2.7) / 2;
  const body = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.35 });
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(r, L - 2 * r, 6, 20), bodyMat);
  capsule.rotation.z = Math.PI / 2;
  body.add(capsule);
  // Серебристое кольцо — катод (вывод 1, локальная +X)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, L * 0.14, 20), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.6, roughness: 0.35 }));
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
      bodyMat.color.set(v.burned ? 0x0c0b0a : 0x1b1c1f);
      bodyMat.emissive.setRGB(1, 0.3, 0.05).multiplyScalar(!v.burned && v.heat > 0.3 ? (v.heat - 0.3) * 1.2 : 0);
    },
    dispose: () => disposeGroup(group),
  };
}

// ─── Светодиод 5 мм ────────────────────────────────────────────────────────

function ledView(c: Led): ComponentView {
  const group = new THREE.Group();
  const spec = LEDS[c.color];
  const r = mm(2.5);
  const h = mm(5.8);
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
  const chipMat = new THREE.MeshStandardMaterial({ color: 0x777066, emissive: new THREE.Color(spec.hex), emissiveIntensity: 0 });
  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), chipMat);
  chip.position.y = h * 0.45;
  body.add(chip);
  const light = new THREE.PointLight(spec.hex, 0, 10, 2);
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
      light.intensity = glow * 6;
    },
    dispose: () => disposeGroup(group),
  };
}

// ─── Транзистор TO-92 ──────────────────────────────────────────────────────

function to92Label(label: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#1d1e21";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#c9ccd1";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 58px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(label.slice(0, 5), 128, 100);
  g.font = `600 46px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(label.slice(5) || " ", 128, 160);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Корпус TO-92: полуцилиндр Ø 4,8 мм с плоской гранью, на ней маркировка.
 * Выводы с шагом 2,54 мм по локальной оси X: коллектор (−X), база, эмиттер (+X);
 * плоская грань смотрит в +Z — как если держать транзистор маркировкой к себе.
 */
function transistorView(c: Transistor): ComponentView {
  const group = new THREE.Group();
  const spec = TRANSISTORS[c.kind];
  const r = mm(2.4);
  const h = mm(4.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.55 });
  const faceMat = new THREE.MeshStandardMaterial({ map: to92Label(spec.label), roughness: 0.55 });
  const body = new THREE.Group();
  // Полуцилиндр задней стороной (z ≤ 0)
  const back = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, false, Math.PI / 2, Math.PI), bodyMat);
  back.position.y = h / 2;
  body.add(back);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, h), faceMat);
  face.position.y = h / 2;
  body.add(face);
  const topCap = new THREE.Mesh(new THREE.CircleGeometry(r, 32, Math.PI, Math.PI), bodyMat);
  topCap.rotation.x = -Math.PI / 2;
  topCap.position.y = h;
  body.add(topCap);

  const step = mm(2.54);
  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  if (c.placement.mode === "free") {
    const bottom = 1.3;
    body.position.y = bottom;
    group.add(body);
    for (const k of [-1, 0, 1]) {
      group.add(lead([new THREE.Vector3(k * step * 0.5, bottom + 0.1, 0), new THREE.Vector3(k * step * 0.5, 0.5, 0), new THREE.Vector3(k * step * 1.2, mm(0.3), 0.8)], mm(0.22)));
    }
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    pins = [-1, 0, 1].map((k) => freeTransform(c, new THREE.Vector3(k * step * 1.2, mm(0.3), 0.8)));
    hotspot = freeTransform(c, new THREE.Vector3(0, bottom + h, 0));
  } else {
    // Три соседних отверстия: корпус над средним, плоской гранью «вперёд» относительно направления К → Э
    const holes = c.placement.holes;
    const f = boardFrame([holes[0], holes[2]]);
    pins = holes.map((id) => holePos(id));
    const bottom = H + 1.0;
    body.position.set(f.mid.x, bottom, f.mid.z);
    body.rotation.y = f.angle;
    group.add(body);
    pins.forEach((p, i) => {
      const atBody = f.mid.clone().addScaledVector(f.dir, (i - 1) * step * 0.5).setY(bottom + 0.1);
      group.add(lead([p.clone().setY(H - 0.2), p.clone().setY(H + 0.35), atBody.clone().setY(H + 0.7), atBody], mm(0.22)));
    });
    hotspot = f.mid.clone().setY(bottom + h);
  }

  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot,
    update(v) {
      if (v.burned) {
        bodyMat.color.set(0x0b0a09);
        faceMat.color.set(0x333333);
        bodyMat.emissive.set(0x000000);
        return;
      }
      bodyMat.emissive.setRGB(1, 0.3, 0.05).multiplyScalar(v.heat > 0.3 ? (v.heat - 0.3) * 1.2 : 0);
    },
    dispose: () => disposeGroup(group),
  };
}

export function buildComponentView(c: Component): ComponentView {
  switch (c.type) {
    case "resistor":
      return resistorView(c);
    case "lamp":
      return lampView(c);
    case "switch":
      return switchView(c);
    case "battery":
      return batteryView(c);
    case "capacitor":
      return capacitorView(c);
    case "diode":
      return diodeView(c);
    case "led":
      return ledView(c);
    case "transistor":
      return transistorView(c);
  }
}

// ─── Провода ───────────────────────────────────────────────────────────────

export interface WireView {
  mesh: THREE.Mesh;
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

export function buildWireView(id: string, a: THREE.Vector3, b: THREE.Vector3, color: string): WireView {
  const curve = wireCurve(a, b);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, mm(0.75), 10, false), mat);
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
