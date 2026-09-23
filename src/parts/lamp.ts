import * as THREE from "three";
import { blackPlastic, boardFrame, brassMaterial, type ComponentView, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { LAMPS, type Lamp, type LampKind } from "../model/types";
import { formatLimit } from "../sim/devices";
import * as tolerance from "../sim/tolerance";
import { stampBurned, twoPin } from "./common";
import type { PartDef } from "./types";
import { formatOhms } from "../sim/resistorCodes";
import { NO_TOLERANCE } from "../sim/tolerance";
import { actualRow, lampSelect } from "../view/panel";

export const lamp: PartDef<Lamp> = {
  type: "lamp",
  prefix: "HL",
  pins: 2,
  onBoard: () => true,
  polar: () => false,
  label: (c) => `лампа ${LAMPS[c.kind].label}`,
  value: (c) => LAMPS[c.kind].label,
  symbol: () => `<path d="M0 -20V-11M0 11V20"/><circle r="11"/><path d="M-7.8 -7.8L7.8 7.8M7.8 -7.8L-7.8 7.8"/>`,
  rated: (c) => LAMPS[c.kind].ratedV * LAMPS[c.kind].ratedA,
  burn: (c) => [`Лампа ${c.id} перегорела`, `Номинал ${LAMPS[c.kind].label}. Добавьте последовательно резистор или возьмите батарею слабее.`],

  stamp(c, sim, { out }) {
    if (!stampBurned(c, sim, out)) out.push(twoPin(c, tolerance.lampResistance(c, sim.tolerance)));
  },
  load(c, sim) {
    const rated = lamp.rated!(c);
    return { ratio: sim.branch(c.id).power / rated, what: "мощность", limit: formatLimit(rated, "Вт") };
  },
  thermal: { threshold: 1.3, rate: 1.2, cooling: 1 },
  panel: (c) => ({
    title: `Лампа ${LAMPS[c.kind].label}`,
    body: `<p class="sub">Сопротивление нити ${formatOhms(tolerance.lampResistance(c, NO_TOLERANCE))} (в горячем состоянии, считается постоянным).</p>`,
    editor: lampSelect(c.kind),
  }),
  edit(c, field, value) {
    if (field === "lamp") c.kind = value as LampKind;
  },
  burnedWord: "ПЕРЕГОРЕЛА",
  warmWord: (k) => (k <= 1.05 ? "ПОЛНЫЙ НАКАЛ" : "ГРЕЕТСЯ"),
  nearLimitOk: true,
  actual: (c, tol) => actualRow("Нить фактически", formatOhms(tolerance.lampResistance(c, tol))),
  visual: (c, sim) => ({ brightness: sim.overload(c) }),
  view: lampView,
};

// ─── 3D: Лампа ──────────

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
    const H = f.p0.y;
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
