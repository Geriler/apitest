import * as THREE from "three";
import { blackPlastic, boardFrame, type ComponentView, disposeGroup, freeTransform, lead, leadMaterial, mm, tagPickable } from "../view/kit";
import { SWITCH_RESISTANCE, type Switch } from "../model/types";
import { twoPin } from "./common";
import { toolFor, type PartDef } from "./types";
import { pill, twoPinHint } from "../view/panel";

export const switchPart: PartDef<Switch> = {
  type: "switch",
  prefix: "SA",
  pins: 2,
  onBoard: () => true,
  tools: [
    toolFor<Switch>()({
      id: "switch",
      group: "load",
      icon: `<path d="M1 12h8l12-7M21 12h8" />`,
      label: "Тумблер",
      title: "Тумблер",
      settings: {},
      name: () => "Тумблер",
      note: () => "",
      editor: () => "",
      set() {},
      create: () => ({ type: "switch", closed: true }),
      hint: (_s, pending) => twoPinHint(pending),
    }),
  ],
  polar: () => false,
  label: (c) => (c.closed ? "тумблер, вкл." : "тумблер, выкл."),
  value: (c) => (c.closed ? "замкнут" : "разомкнут"),
  symbol: (c) =>
    c.closed
      ? `<path d="M0 -20V-10M0 10V20M0 -10L0 10"/><circle cy="-10" r="1.8" class="dot"/><circle cy="10" r="1.8" class="dot"/>`
      : `<path d="M0 -20V-10M0 10V20M0 10L11 -8"/><circle cy="-10" r="1.8" class="dot"/><circle cy="10" r="1.8" class="dot"/>`,
  burn: (c) => [`${c.id} вышел из строя`, ""],

  // Тумблер не горит
  stamp(c, _sim, { out }) {
    out.push(twoPin(c, c.closed ? SWITCH_RESISTANCE : Infinity));
  },
  panel: (c) => ({
    title: "Тумблер",
    body: `<p class="sub">${c.closed ? "Контакты замкнуты." : "Контакты разомкнуты — ток не идёт."}</p>`,
    editor: `<div class="row"><button class="btn inline" data-act="toggle" id="btn-toggle">${c.closed ? "Разомкнуть" : "Замкнуть"}</button></div>`,
  }),
  status: (c) => (c.closed ? pill("ok", "ЗАМКНУТ") : pill("warn", "РАЗОМКНУТ")),
  toggle(c) {
    c.closed = !c.closed;
  },
  clickToggles: true,
  view: switchView,
};

// ─── 3D: Выключатель ──────────

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
    const H = f.p0.y;
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
