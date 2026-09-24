import * as THREE from "three";
import { HOLE_BY_ID } from "../model/breadboard";
import type { ChipPin, ChipPinRole } from "../model/types";
import { pinNode } from "../sim/nodes";
import { formatSI } from "../sim/resistorCodes";
import { type ComponentView, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { kv, selectField } from "../view/panel";
import { toolFor, type PartDef } from "./types";

/** Назначения выводов: подпись, имя по умолчанию, цвет флажка. */
export const PIN_ROLES: Record<ChipPinRole, { label: string; name: string; color: string }> = {
  in: { label: "вход", name: "IN", color: "#2f9e5a" },
  out: { label: "выход", name: "OUT", color: "#e2762a" },
  vcc: { label: "питание (Vcc)", name: "VCC", color: "#c8261f" },
  gnd: { label: "общий (GND)", name: "GND", color: "#1b1d20" },
};

/** Имя вывода для подписей: своё или по назначению. */
export const pinTitle = (c: ChipPin) => c.name.trim() || PIN_ROLES[c.role].name;

export const chipPin: PartDef<ChipPin> = {
  type: "chippin",
  prefix: "X",
  pins: 1,
  pinLabel: (c) => `вывод ${c.number} ${pinTitle(c)}`,
  chipSpace: () => 0,
  onBoard: () => true,
  tools: [
    toolFor<ChipPin>()({
      id: "chippin",
      group: "chips",
      icon: `<path d="M15 16V6" /><path d="M15 3h9v5h-9z" /><circle cx="15" cy="16" r="1.5" />`,
      label: "Вывод",
      title: "Отметить точку, которая станет выводом микросхемы",
      settings: { role: "in" as ChipPinRole },
      name: () => "Вывод микросхемы",
      note: () =>
        `<p class="sub">Поставьте в отверстие (или на стол и подключите проводом) — эта точка станет выводом микросхемы. Номер назначается следующий свободный, его и назначение можно поменять в панели. Когда выводы расставлены, «Проекты» → «Упаковать в DIP».</p>`,
      editor: (s) => roleSelect(s.role),
      set(s, field, value) {
        if (field === "pinRole") s.role = value as ChipPinRole;
      },
      create: (s) => ({ type: "chippin", role: s.role, number: 1, name: "" }),
      adjust(c, scene) {
        const used = new Set(scene.components.filter((x): x is ChipPin => x.type === "chippin" && x.id !== c.id).map((x) => x.number));
        let n = 1;
        while (used.has(n)) n++;
        c.number = n;
      },
      hint: () => "Нажмите на отверстие — там будет вывод микросхемы. Номер — следующий свободный.",
    }),
  ],
  polar: () => false,
  noFlip: true,
  label: (c) => `вывод ${c.number} ${pinTitle(c)} (${PIN_ROLES[c.role].label})`,
  value: (c) => `${c.number} ${pinTitle(c)}`,
  schematicParts: (c) => [{ key: "", pins: [0], flag: { text: `${c.number} ${pinTitle(c)}`, color: PIN_ROLES[c.role].color }, value: "", current: 0 }],
  burn: (c) => [`${c.id} вышел из строя`, ""],
  view: chipPinView,

  // Метка ничего не добавляет в схему
  stamp() {},
  readout: (c, sim) => `<div class="lcd">${formatSI(sim.solution.voltage.get(pinNode(c, 0)) ?? 0, "В")}</div>`,
  panel: (c) => ({
    title: `Вывод ${c.number} ${pinTitle(c)}`,
    body: `${kv("Назначение", PIN_ROLES[c.role].label)}
      <p class="sub">Эта точка станет выводом ${c.number} микросхемы. Сама метка в схему ничего не добавляет. Выводы 1…N/2 идут по нижнему ряду слева направо, остальные — обратно по верхнему, как у настоящих DIP. Питание и приборы в микросхему не входят — это обвязка для проверки.</p>`,
    editor:
      selectField("pinNumber", "Номер", Array.from({ length: 16 }, (_, i): [string, string] => [String(i + 1), String(i + 1)]), String(c.number)) +
      roleSelect(c.role) +
      `<div class="field"><label for="f-pinName">Имя (A, B, Y…; пусто — ${PIN_ROLES[c.role].name})</label><input id="f-pinName" class="btn" type="text" maxlength="8" data-field="pinName" value="${c.name.replace(/"/g, "&quot;")}" /></div>`,
  }),
  edit(c, field, value) {
    if (field === "pinNumber") c.number = Number(value);
    if (field === "pinRole") c.role = value as ChipPinRole;
    if (field === "pinName") c.name = value.trim().slice(0, 8);
  },
};

function roleSelect(role: ChipPinRole): string {
  return selectField("pinRole", "Назначение", (Object.keys(PIN_ROLES) as ChipPinRole[]).map((r) => [r, PIN_ROLES[r].label]), role);
}

// ─── 3D: флажок с номером ───────────────────────────────────────────────────

function flagTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const g = canvas.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = "#ffffff";
  g.font = `700 54px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function chipPinView(c: ChipPin): ComponentView {
  const group = new THREE.Group();
  const H = mm(9);
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTexture(`${c.number} ${pinTitle(c)}`, PIN_ROLES[c.role].color), roughness: 0.6, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(mm(8), mm(3)), flagMat);
  let pin: THREE.Vector3;
  let base: THREE.Vector3;
  if (c.placement.mode === "board") {
    const h = HOLE_BY_ID.get(c.placement.holes[0])!;
    base = new THREE.Vector3(h.x, h.y, h.z);
    pin = base.clone();
  } else {
    base = new THREE.Vector3(c.placement.x, 0, c.placement.z);
    pin = freeTransform(c, new THREE.Vector3(0, mm(0.3), 0));
  }
  group.add(lead([base.clone().setY(base.y - 0.2), base.clone().setY(base.y + H)], mm(0.35)));
  flag.position.set(base.x + mm(4), base.y + H - mm(1.5), base.z);
  group.add(flag);
  tagPickable(group, c.id);
  return { group, pins: [pin], hotspot: base.clone().setY(base.y + H), update() {}, dispose: () => disposeGroup(group) };
}
