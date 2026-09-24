import * as THREE from "three";
import { SWITCH_RESISTANCE, type PushButton } from "../model/types";
import { blackPlastic, boardFrame, type ComponentView, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { pill, twoPinHint } from "../view/panel";
import { twoPin } from "./common";
import { toolFor, type PartDef } from "./types";

export const button: PartDef<PushButton> = {
  type: "button",
  prefix: "SB",
  pins: 2,
  notInChip: () => "кнопку внутри корпуса не нажать",
  onBoard: () => true,
  tools: [
    toolFor<PushButton>()({
      id: "button",
      group: "load",
      icon: `<path d="M1 12h8M21 12h8M9 12l12-4M15 9V3M11 3h8" />`,
      label: "Кнопка",
      title: "Кнопка без фиксации: замкнута, пока её держат",
      settings: {},
      name: () => "Кнопка",
      note: () =>
        `<p class="sub">Без фиксации: контакты замкнуты, только пока кнопку держат (зажмите на ней указатель). Отпустили — цепь разомкнута.</p>`,
      editor: () => "",
      set() {},
      create: () => ({ type: "button" }),
      hint: (_s, pending) => twoPinHint(pending),
    }),
  ],
  polar: () => false,
  label: () => "кнопка",
  value: () => "без фиксации",
  // По ГОСТ — в обычном состоянии (разомкнута), с толкателем
  symbol: () =>
    `<path d="M0 -20V-10M0 10V20M0 10L-10 -6"/><circle cy="-10" r="1.8" class="dot"/><circle cy="10" r="1.8" class="dot"/>` +
    `<path d="M-5 2H-15M-15 -3V7" class="thin"/>`,
  burn: (c) => [`${c.id} вышла из строя`, ""],
  view: buttonView,

  // Кнопка не горит
  stamp(c, sim, { out }) {
    out.push(twoPin(c, sim.held.has(c.id) ? SWITCH_RESISTANCE : Infinity));
  },
  momentary: true,
  visual: (c, sim) => ({ pressed: sim.held.has(c.id) }),

  panel: () => ({
    title: "Кнопка",
    body: `<p class="sub">Без фиксации: замкнута, пока её держат. Зажмите указатель на кнопке на макетке или на кнопке ниже.</p>`,
    editor: `<div class="row"><button class="btn inline" data-hold id="btn-hold">Нажать и держать</button></div>`,
  }),
  status: (c, sim) => (sim.held.has(c.id) ? pill("ok", "НАЖАТА — ЗАМКНУТА") : pill("warn", "ОТПУЩЕНА — РАЗОМКНУТА")),
};

// ─── 3D: тактовая кнопка 6 × 6 мм ────────────────────────────────────────

function buttonView(c: PushButton): ComponentView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(mm(6), mm(3.5), mm(6)), blackPlastic);
  housing.position.y = mm(1.75);
  body.add(housing);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(mm(6.1), mm(0.3), mm(6.1)),
    new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.8, roughness: 0.35 }),
  );
  plate.position.y = mm(3.6);
  body.add(plate);
  const capMat = new THREE.MeshStandardMaterial({ color: 0xc8261f, roughness: 0.45 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(mm(1.8), mm(1.8), mm(1.6), 24), capMat);
  const capUp = mm(4.5);
  cap.position.y = capUp;
  body.add(cap);

  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  if (c.placement.mode === "free") {
    body.position.y = 0.3;
    group.add(body);
    for (const sx of [-1, 1]) group.add(lead([new THREE.Vector3(sx * mm(3), 0.4, 0), new THREE.Vector3(sx * 2, mm(0.3), 0)]));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    pins = [freeTransform(c, new THREE.Vector3(-2, mm(0.3), 0)), freeTransform(c, new THREE.Vector3(2, mm(0.3), 0))];
    hotspot = freeTransform(c, new THREE.Vector3(0, 2, 0));
  } else {
    const f = boardFrame(c.placement.holes);
    const H = f.p0.y;
    pins = [f.p0, f.p1];
    const y = H + 0.1;
    body.position.set(f.mid.x, y, f.mid.z);
    body.rotation.y = f.angle;
    group.add(body);
    const e0 = f.mid.clone().addScaledVector(f.dir, -mm(3)).setY(y + 0.3);
    const e1 = f.mid.clone().addScaledVector(f.dir, mm(3)).setY(y + 0.3);
    group.add(lead([f.p0.clone().setY(H - 0.2), f.p0.clone().setY(y + 0.1), e0]));
    group.add(lead([f.p1.clone().setY(H - 0.2), f.p1.clone().setY(y + 0.1), e1]));
    hotspot = f.mid.clone().setY(y + 2);
  }
  tagPickable(group, c.id);
  let wasPressed = false;
  return {
    group,
    pins,
    hotspot,
    update(v) {
      const p = !!v.pressed;
      if (p === wasPressed) return;
      wasPressed = p;
      // Нажатая кнопка утоплена на полмиллиметра и чуть светлее
      cap.position.y = p ? capUp - mm(0.8) : capUp;
      capMat.color.setHex(p ? 0xe8584f : 0xc8261f);
    },
    dispose: () => disposeGroup(group),
  };
}
