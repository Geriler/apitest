import * as THREE from "three";
import type { ChipCase, ChipPinRole } from "../model/types";
import { pinNode } from "../sim/nodes";
import { formatSI } from "../sim/resistorCodes";
import { type ComponentView, disposeGroup, freeTransform, mm, tagPickable } from "../view/kit";
import { selectField } from "../view/panel";
import { toolFor, type PartDef } from "./types";

/** Назначения выводов: подпись, имя по умолчанию, цвет. */
export const PIN_ROLES: Record<ChipPinRole | "nc", { label: string; short: string; name: string; color: string }> = {
  nc: { label: "не подключён (NC)", short: "NC", name: "NC", color: "#8a8f96" },
  in: { label: "вход", short: "вход", name: "IN", color: "#2f9e5a" },
  out: { label: "выход", short: "выход", name: "OUT", color: "#e2762a" },
  vcc: { label: "питание (Vcc)", short: "питание", name: "VCC", color: "#c8261f" },
  gnd: { label: "общий (GND)", short: "общий", name: "GND", color: "#1b1d20" },
};

/** Корпуса DIP, которые можно выбрать. */
export const DIP_SIZES = [4, 6, 8, 14, 16];

/** Имя вывода i (с 0) для подписей: своё или по назначению; у неподключённого — NC. */
export function casePinName(c: ChipCase, i: number): string {
  const role = c.roles[i] ?? "nc";
  return role === "nc" ? "NC" : c.names[i]?.trim() || PIN_ROLES[role].name;
}

/** Сменить число выводов: номера остаются, новые — не подключены. */
export function resizeCase(c: ChipCase, pins: number): void {
  c.roles = Array.from({ length: pins }, (_, i) => c.roles[i] ?? "nc");
  c.names = Array.from({ length: pins }, (_, i) => c.names[i] ?? "");
  c.pins = pins;
}

/** Шаг площадок и расстояние между рядами на столе (в шагах макетки, 2,54 мм). */
const PITCH = 2;
const ROW = 4;

/** Где площадка вывода i: 1…N/2 — по ближнему ряду слева направо, остальные — обратно по дальнему. */
function padAt(pins: number, i: number): THREE.Vector3 {
  const k = pins / 2;
  const along = i < k ? i : pins - 1 - i;
  return new THREE.Vector3((along - (k - 1) / 2) * PITCH, 0, i < k ? ROW : -ROW);
}

const sizeSelect = (pins: number) =>
  selectField("casePins", "Корпус", DIP_SIZES.map((n): [string, string] => [String(n), `DIP-${n}`]), String(pins));

export const chipCase: PartDef<ChipCase> = {
  type: "chipcase",
  prefix: "X",
  pins: 0,
  pinCount: (c) => c.pins,
  pinLabel: (c, i) => `вывод ${i + 1} ${casePinName(c, i)}`,
  chipSpace: () => 0,
  onBoard: () => false,
  tools: [
    toolFor<ChipCase>()({
      id: "chipcase",
      group: "chips",
      icon: `<rect x="7" y="4" width="16" height="10" rx="1" stroke-dasharray="2 1.5" /><path d="M9 4V1M13 4V1M17 4V1M21 4V1M9 14v3M13 14v3M17 14v3M21 14v3" />`,
      label: "Корпус",
      title: "Корпус будущей микросхемы: выводы по местам, как у настоящего DIP",
      settings: { pins: 8 },
      name: () => "Корпус микросхемы",
      note: () =>
        `<p class="sub">С него начинается своя микросхема. На столе ляжет контур корпуса с площадками выводов — по местам, как у настоящего DIP. Схему соберите на макетке и проведите провода к площадкам, а в панели корпуса назначьте выводы: вход, выход, питание, общий. Корпус в схеме — один; сменить размер можно и потом.</p>`,
      editor: (s) => sizeSelect(s.pins),
      set(s, field, value) {
        if (field === "casePins") s.pins = Number(value);
      },
      create: (s) => ({ type: "chipcase", pins: s.pins, roles: Array(s.pins).fill("nc"), names: Array(s.pins).fill("") }),
      refuse: (scene) => {
        const other = scene.components.find((c) => c.type === "chipcase");
        return other ? `Корпус уже есть (${other.id}). Размер меняется в его панели.` : undefined;
      },
      hint: () => "Нажмите на стол рядом с платой — там ляжет корпус. Потом протяните провода от площадок к схеме. R — повернуть.",
      boardRefusal: "Корпус лежит на столе рядом с платой. Выводы — провода от его площадок к схеме.",
    }),
  ],
  polar: () => false,
  noFlip: true,
  label: (c) => `корпус DIP-${c.pins}`,
  value: (c) => `DIP-${c.pins}`,
  // На схеме — флажки назначенных выводов
  schematicParts: (c) =>
    c.roles.flatMap((role, i) =>
      role === "nc" ? [] : [{ key: String(i + 1), pins: [i], flag: { text: `${i + 1} ${casePinName(c, i)}`, color: PIN_ROLES[role].color }, value: "", current: 0 }],
    ),
  burn: (c) => [`${c.id} вышел из строя`, ""],
  view: caseView,

  // Корпус ничего не добавляет в схему: это места выводов
  stamp() {},
  readout: (c) => `<div class="kv"><span>DIP-${c.pins}</span><span>${c.roles.filter((r) => r !== "nc").length} из ${c.pins} выводов назначено</span></div>`,
  panel: (c, sim) => {
    const rows = c.roles
      .map((role, i) => {
        const v = sim.solution.voltage.get(pinNode(c, i));
        const opts = (Object.keys(PIN_ROLES) as (ChipPinRole | "nc")[])
          .map((r) => `<option value="${r}"${r === role ? " selected" : ""}>${PIN_ROLES[r].short}</option>`)
          .join("");
        const name = (c.names[i] ?? "").replace(/"/g, "&quot;");
        return `<div class="pinrow"><b style="border-color:${PIN_ROLES[role].color}">${i + 1}</b>
          <select data-field="role:${i}" aria-label="Назначение вывода ${i + 1}">${opts}</select>
          <input class="btn" type="text" maxlength="8" data-field="name:${i}" aria-label="Имя вывода ${i + 1}" placeholder="${PIN_ROLES[role].name}" value="${name}" ${role === "nc" ? "disabled" : ""} />
          <small>${v === undefined ? "—" : formatSI(v, "В")}</small></div>`;
      })
      .join("");
    return {
      title: `Корпус DIP-${c.pins}`,
      body: `<p class="sub">Выводы 1…${c.pins / 2} — по ближнему ряду слева направо, ${c.pins / 2 + 1}…${c.pins} — обратно по дальнему, как у настоящего DIP. Место площадок не меняется: меняется только, для чего вывод. Питание и приборы в микросхему не входят — это обвязка для проверки.</p>`,
      editor: `${sizeSelect(c.pins)}<div class="eyebrow">выводы: назначение, имя, потенциал</div><div class="pinrows">${rows}</div>`,
    };
  },
  edit(c, field, value) {
    if (field === "casePins") resizeCase(c, Number(value));
    const [what, n] = field.split(":");
    const i = Number(n);
    if (what === "role" && i < c.pins) c.roles[i] = value as ChipPinRole | "nc";
    if (what === "name" && i < c.pins) c.names[i] = value.trim().slice(0, 8);
  },
};

// ─── 3D: контур корпуса с площадками ─────────────────────────────────────────

/** Сколько пикселей текстуры на шаг макетки. */
const PX = 48;

function caseTexture(c: ChipCase, width: number, depth: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * PX);
  canvas.height = Math.round(depth * PX);
  const g = canvas.getContext("2d")!;
  const at = (p: THREE.Vector3) => [(p.x + width / 2) * PX, (p.z + depth / 2) * PX];
  g.fillStyle = "#2a2d31";
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Контур самого корпуса (между рядами площадок) пунктиром
  const k = c.pins / 2;
  const bodyW = k * PITCH, bodyD = ROW * 2 - 1.4;
  g.strokeStyle = "#8a8f96";
  g.lineWidth = 3;
  g.setLineDash([12, 8]);
  g.strokeRect((width - bodyW) / 2 * PX, (depth - bodyD) / 2 * PX, bodyW * PX, bodyD * PX);
  g.setLineDash([]);
  g.fillStyle = "#c9ccd1";
  g.font = `600 ${Math.round(PX * 0.9)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(`DIP-${c.pins}`, canvas.width / 2, canvas.height / 2);
  // Ключ — точка у вывода 1
  const [kx, ky] = at(padAt(c.pins, 0));
  g.beginPath();
  g.arc(kx, ky - 2.3 * PX, PX * 0.28, 0, Math.PI * 2);
  g.fillStyle = "#8a8f96";
  g.fill();
  // Подписи выводов — внутри контура, у своей площадки, цветом назначения
  g.font = `700 ${Math.round(PX * 0.5)}px "IBM Plex Mono", ui-monospace, monospace`;
  for (let i = 0; i < c.pins; i++) {
    const [x, y] = at(padAt(c.pins, i));
    const near = i < k;
    const role = c.roles[i] ?? "nc";
    g.fillStyle = role === "nc" ? "#8a8f96" : role === "gnd" ? "#e8e9eb" : PIN_ROLES[role].color;
    g.fillText(String(i + 1), x, y + (near ? -1.0 : 1.0) * PX);
    g.font = `600 ${Math.round(PX * 0.36)}px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText(casePinName(c, i), x, y + (near ? -1.55 : 1.55) * PX);
    g.font = `700 ${Math.round(PX * 0.5)}px "IBM Plex Mono", ui-monospace, monospace`;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function caseView(c: ChipCase): ComponentView {
  const group = new THREE.Group();
  const k = c.pins / 2;
  const width = k * PITCH + 1.5;
  const depth = ROW * 2 + 2;
  const T = mm(1.6);
  const top = new THREE.MeshStandardMaterial({ map: caseTexture(c, width, depth), roughness: 0.8 });
  const side = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width, T, depth), [side, side, top, side, side, side]);
  plate.position.y = T / 2;
  group.add(plate);
  const pad = new THREE.MeshStandardMaterial({ color: 0xd4a24a, metalness: 0.85, roughness: 0.3 });
  const padGeo = new THREE.CylinderGeometry(mm(1.4), mm(1.4), mm(0.8), 20);
  const pins: THREE.Vector3[] = [];
  for (let i = 0; i < c.pins; i++) {
    const p = padAt(c.pins, i);
    const m = new THREE.Mesh(padGeo, pad);
    m.position.set(p.x, T + mm(0.4), p.z);
    group.add(m);
    pins.push(p.clone().setY(T + mm(0.8)));
  }
  if (c.placement.mode === "free") {
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
  }
  tagPickable(group, c.id);
  return {
    group,
    pins: c.placement.mode === "free" ? pins.map((p) => freeTransform(c, p)) : pins,
    hotspot: c.placement.mode === "free" ? freeTransform(c, new THREE.Vector3(0, 1, 0)) : new THREE.Vector3(),
    update() {},
    dispose: () => disposeGroup(group),
  };
}
