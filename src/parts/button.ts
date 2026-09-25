import * as THREE from "three";
import { SWITCH_RESISTANCE, type PushButton } from "../model/types";
import { blackPlastic, boardFrame, type ComponentView, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { pill, selectField, twoPinHint } from "../view/panel";
import type { Simulation } from "../sim/simulation";
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
      settings: { bounce: true },
      name: () => "Кнопка",
      note: () =>
        `<p class="sub">Без фиксации: контакты замкнуты, только пока кнопку держат (зажмите на ней указатель). Отпустили — цепь разомкнута.</p>`,
      editor: (s) => bounceSelect(s.bounce),
      set(s, field, value) {
        if (field === "bounce") s.bounce = value === "1";
      },
      create: (s) => ({ type: "button", ...(s.bounce ? { bounce: true } : {}) }),
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
    out.push(twoPin(c, contactClosed(c, sim) ? SWITCH_RESISTANCE : Infinity));
  },
  // С дребезгом контакт меняется со временем — расчёт идёт шагами
  isDynamic: (c) => !!c.bounce,
  momentary: true,
  visual: (c, sim) => ({ pressed: sim.held.has(c.id) }),

  panel: (c) => ({
    title: "Кнопка",
    body: `<p class="sub">Без фиксации: замкнута, пока её держат. Зажмите указатель на кнопке на макетке или на кнопке ниже.</p>${c.bounce ? `<p class="sub">С дребезгом: при нажатии контакт замыкается, размыкается и снова замыкается — около 15 мс, при отпускании — около 10 мс. Счётчик на такой кнопке насчитает лишнее; подавляют дребезг RC-цепью с триггером Шмитта или микросхемой вроде MAX6816. (У настоящих кнопок дребезг — доли миллисекунды и миллисекунды; здесь он растянут, чтобы его было видно при шаге расчёта 5 мс.)</p>` : ""}`,
    editor: `${bounceSelect(!!c.bounce)}<div class="row"><button class="btn inline" data-hold id="btn-hold">Нажать и держать</button></div>`,
  }),
  edit(c, field, value) {
    if (field === "bounce") c.bounce = value === "1" ? true : undefined;
  },
  status: (c, sim) => (sim.held.has(c.id) ? pill("ok", "НАЖАТА — ЗАМКНУТА") : pill("warn", "ОТПУЩЕНА — РАЗОМКНУТА")),
};

/** Когда (мс от нажатия или отпускания) контакт с дребезгом меняет состояние; после последнего — как надо. */
const BOUNCE_PRESS = [0, 4, 7, 11, 14];
const BOUNCE_RELEASE = [0, 5, 9];

/** Замкнут ли контакт: без дребезга — пока держат; с дребезгом — по времени от нажатия или отпускания. */
export function contactClosed(c: PushButton, sim: Simulation): boolean {
  const held = sim.held.has(c.id);
  if (!c.bounce) return held;
  const key = `${c.id}:since`;
  let m = sim.memory.get(key) as { held: boolean; t: number } | undefined;
  // Впервые — кнопка давно в этом положении, дребезг уже прошёл
  if (!m || m.held !== held) sim.memory.set(key, (m = { held, t: m ? sim.time : -Infinity }));
  const ms = (sim.time - m.t) * 1000;
  const k = (held ? BOUNCE_PRESS : BOUNCE_RELEASE).filter((x) => ms >= x).length;
  return (k % 2 === 1) === held;
}

const bounceSelect = (on: boolean) => selectField("bounce", "Контакты", [["1", "с дребезгом (как у настоящей)"], ["0", "идеальные"]], on ? "1" : "0");

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
