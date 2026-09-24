import * as THREE from "three";
import { HOLE_BY_ID, holeLabel } from "../model/breadboard";
import type { Chip, ChipDef } from "../model/types";
import { countChip, countChips, countDetails, countShort } from "../chips/count";
import { libraryChips, resolveChip } from "../chips/registry";
import { pinNode } from "../sim/nodes";
import { formatSI } from "../sim/resistorCodes";
import { type ComponentView, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { kv, pill } from "../view/panel";
import { PIN_ROLES } from "../chips/roles";
import { toolFor, type PartDef } from "./types";

/** Подпись вывода корпуса: имя, у неподключённого — NC. */
export function chipPinName(def: ChipDef, i: number): string {
  const role = def.pinRoles?.[i] ?? "nc";
  return role === "nc" ? "NC" : def.pinNames[i] || PIN_ROLES[role].name;
}

/** Инструмент установки микросхемы из библиотеки. */
function chipTool(def: ChipDef) {
  return toolFor<Chip>()({
    id: `chip:${def.id}`,
    group: "chips",
    icon: `<rect x="7" y="4" width="16" height="10" rx="1" /><path d="M9 4V1M13 4V1M17 4V1M21 4V1M9 14v3M13 14v3M17 14v3M21 14v3" /><circle cx="9.5" cy="11.5" r="1" />`,
    label: def.name,
    title: `${def.name} — DIP-${def.pins}, собрана вами`,
    settings: {},
    name: () => def.name,
    note: () =>
      `<p class="sub">DIP-${def.pins}: ${def.pinNames.map((_, i) => `${i + 1} ${chipPinName(def, i)}`).join(", ")}. Встаёт поперёк центральной канавки макетки.</p>`,
    editor: () => "",
    set() {},
    create: () => ({ type: "chip", def: def.id, name: def.name, pins: def.pins }),
    hint: () => `Нажмите на отверстие ряда f у канавки: туда встанет вывод 1, выводы 1–${def.pins / 2} пойдут вправо по ряду f, остальные — обратно по ряду e. R — повернуть (до установки или выделенную): на печатной плате и корпусе — в любую сторону.`,
  });
}

export const chip: PartDef<Chip> = {
  type: "chip",
  prefix: "D",
  pins: 0,
  pinLabel: (c, i, scene) => {
    const def = resolveChip(scene, c.def);
    return def ? `${i + 1} ${chipPinName(def, i)}` : `вывод ${i + 1}`;
  },
  pinCount: (c) => c.pins,
  // Вложенная микросхема занимает столько, сколько её начинка
  chipSpace: (c, scene) => {
    const def = resolveChip(scene, c.def);
    return def ? def.space ?? def.parts.length : c.pins;
  },
  where: (_c, holes) => holes.map((h, i) => `${i + 1} ${holeLabel(h)}`).join(", "),
  onBoard: () => true,
  // Инструменты — по одному на микросхему библиотеки
  get tools() {
    return libraryChips().map(chipTool);
  },
  polar: () => true,
  label: (c) => `${c.name} (DIP-${c.pins})`,
  value: (c) => c.name,
  burn: (c) => [`Микросхема ${c.id} вышла из строя`, "Сгорела деталь внутри. Откройте её схему (в панели микросхемы), чтобы найти причину, или замените микросхему новой."],
  burnedWord: "ВЫШЛА ИЗ СТРОЯ",
  view: chipView,

  schematicParts: (c, sim) => {
    const def = resolveChip(sim.scene, c.def);
    return [
      {
        key: "",
        pins: Array.from({ length: c.pins }, (_, i) => i),
        box: Array.from({ length: c.pins }, (_, i) => `${i + 1} ${def ? chipPinName(def, i) : ""}`.trim()),
        value: def?.name ?? "нет описания",
        current: 0,
      },
    ];
  },

  // Начинка — отдельные детали (Simulation разворачивает её); здесь — только соединения с выводами
  stamp(c, sim, { links }) {
    const def = resolveChip(sim.scene, c.def);
    if (!def) return;
    for (const net of def.nets) {
      const nodes = [
        ...net.members.map(([id, p]) => `pin:${c.id}/${id}:${p}`),
        ...(net.pins ?? []).filter((n) => n <= c.pins).map((n) => pinNode(c, n - 1)),
      ];
      for (let i = 1; i < nodes.length; i++) links.push([nodes[0], nodes[i]]);
    }
  },
  voltage: () => 0,
  current: () => 0,
  power: () => 0,
  readout: (c, sim) => {
    const def = resolveChip(sim.scene, c.def);
    return `<div class="kv"><span>${def ? `${def.name}, DIP-${def.pins}` : "Нет описания микросхемы"}</span><span>${def ? countShort(countChip(def, sim.scene)) : ""}</span></div>`;
  },
  status: (c, sim) => (resolveChip(sim.scene, c.def) ? pill("ok", "РАБОТАЕТ") : pill("bad", "НЕТ ОПИСАНИЯ — ОТКРОЙТЕ ПРОЕКТ, ГДЕ ОНА ЕСТЬ")),

  panel(c, sim) {
    const def = resolveChip(sim.scene, c.def);
    if (!def) return { title: "Микросхема", body: `<p class="sub">Описания этой микросхемы нет ни в библиотеке, ни в проекте.</p>` };
    const volts = (i: number) => sim.solution.voltage.get(pinNode(c, i));
    const rows = Array.from({ length: c.pins }, (_, i) => {
      const v = volts(i);
      return kv(`${i + 1} ${chipPinName(def, i)}`, v === undefined ? "не подключён" : formatSI(v, "В"));
    }).join("");
    const burned = def.parts.filter((p) => sim.state(`${c.id}/${p.id}`).burned).map((p) => p.id);
    const k = countChip(def, sim.scene);
    return {
      title: def.name,
      body: `${kv("Внутри", countShort(k))}
        <p class="sub">${countDetails(k)}${k.chips.size ? `. Собрана из своих микросхем: ${countChips(k)}` : ""}.</p>
        ${burned.length ? kv("Сгорело внутри", burned.join(", ")) : ""}
        <div class="eyebrow">выводы (потенциал)</div>${rows}
        <p class="sub">Собрана вами. Расчёт — полный, как если бы схема стояла на макетке: детали внутри греются и горят как обычно.</p>`,
      editor: `<div class="row"><button class="btn inline" data-act="openChip" id="btn-open-chip">Открыть схему</button></div>`,
    };
  },
};

// ─── 3D: корпус DIP ──────────────────────────────────────────────────────────

function nameTexture(text: string, pinsHalf: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64 * pinsHalf;
  canvas.height = 160;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#1c1e21";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#c9ccd1";
  g.font = `600 ${Math.min(46, (canvas.width / Math.max(4, text.length)) * 1.5)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, canvas.width / 2, 84);
  // Ключ — точка у вывода 1 (левый нижний угол)
  g.beginPath();
  g.arc(26, 128, 11, 0, Math.PI * 2);
  g.fillStyle = "#34373b";
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * DIP: выводы 1…N/2 — вдоль одной стороны, N/2+1…N — обратно вдоль другой; между рядами 7,62 мм.
 * На плате — по отверстиям (в том порядке, как выводы); на столе — ножки вниз, провода к их концам.
 */
function chipView(c: Chip): ComponentView {
  const group = new THREE.Group();
  const k = c.pins / 2;
  let pins: THREE.Vector3[];
  let base: THREE.Vector3[];
  if (c.placement.mode === "board") {
    base = c.placement.holes.map((id) => {
      const h = HOLE_BY_ID.get(id)!;
      return new THREE.Vector3(h.x, h.y, h.z);
    });
    pins = base;
  } else {
    base = Array.from({ length: c.pins }, (_, i) => {
      const along = i < k ? i : c.pins - 1 - i;
      return new THREE.Vector3(along - (k - 1) / 2, mm(0.3), i < k ? 1.5 : -1.5);
    });
    pins = base.map((p) => freeTransform(c, p));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
  }
  const Hs = base[0].y; // поверхность платы (или стола)
  const center = base.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / base.length);
  const u = base[k - 1].clone().sub(base[0]).setY(0).normalize(); // вдоль ряда выводов 1…k
  const v = base[0].clone().sub(base[c.pins - 1]).setY(0).normalize(); // поперёк: от второго ряда к первому
  const body = new THREE.Group();
  const L = k - 0.25, W = mm(6.35), T = mm(3.3);
  const top = new THREE.MeshStandardMaterial({ map: nameTexture(c.name, k), roughness: 0.55 });
  const side = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.55 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [side, side, top, side, side, side]);
  body.add(box);
  const y = Hs + mm(1) + T / 2;
  body.position.set(center.x, y, center.z);
  // Локальная +X — вдоль u, локальная +Z — вдоль v
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), v));
  group.add(body);
  // Ножки: от боковой грани корпуса наружу и вниз в отверстие
  for (const p of base) {
    const toward = p.clone().sub(center).setY(0);
    const across = v.clone().multiplyScalar(Math.sign(toward.dot(v)) || 1);
    const edge = p.clone().addScaledVector(across, -(1.5 - W / 2 - mm(0.2))).setY(y - T / 4);
    group.add(lead([edge, p.clone().setY(y - T / 4), p.clone().setY(Hs + mm(1)), p.clone().setY(Hs - 0.2)], mm(0.25)));
  }
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot: c.placement.mode === "board" ? center.clone().setY(y + T) : freeTransform(c, new THREE.Vector3(0, y + T, 0)),
    update() {},
    dispose: () => disposeGroup(group),
  };
}
