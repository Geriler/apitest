import * as THREE from "three";
import { HOLE_BY_ID, holeLabel, isSot, packageName, pinLayoutText, pinOffsets } from "../model/breadboard";
import type { Chip, ChipDef } from "../model/types";
import { countChip, countChips, countDetails, countShort } from "../chips/count";
import { resolveChip, toolChips } from "../chips/registry";
import { MODEL_MAX_OUT, MODEL_OFF, type ChipModel, type ModelState } from "../chips/model";
import type { Simulation } from "../sim/simulation";
import { pinNode } from "../sim/nodes";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import { type ComponentView, blackPlastic, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { kv, pill } from "../view/panel";
import { PIN_ROLES } from "../chips/roles";
import { toolFor, type PartDef } from "./types";

/** Подпись вывода корпуса: имя, у неподключённого — NC. */
export function chipPinName(def: ChipDef, i: number): string {
  const role = def.pinRoles?.[i] ?? "nc";
  return role === "nc" ? "NC" : def.pinNames[i] || PIN_ROLES[role].name;
}

/** Инструмент установки микросхемы из библиотеки. */
export function chipTool(def: ChipDef) {
  return toolFor<Chip>()({
    id: `chip:${def.id}`,
    group: "chips",
    icon: `<rect x="7" y="4" width="16" height="10" rx="1" /><path d="M9 4V1M13 4V1M17 4V1M21 4V1M9 14v3M13 14v3M17 14v3M21 14v3" /><circle cx="9.5" cy="11.5" r="1" />`,
    label: def.name,
    title: `${def.name} — ${packageName(def.package, def.pins)}, ${def.id.startsWith("ref:") ? "заводская" : "собрана вами"}`,
    settings: {},
    name: () => def.name,
    note: () =>
      `<p class="sub">${packageName(def.package, def.pins)}${isSot(def.package) ? " на переходнике" : ""}: ${def.pinNames.map((_, i) => `${i + 1} ${chipPinName(def, i)}`).join(", ")}. Встаёт поперёк центральной канавки макетки: ${pinLayoutText(def.package, def.pins)}.</p>`,
    editor: () => "",
    set() {},
    create: () => ({ type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins }),
    hint: () => `Нажмите на отверстие ряда f у канавки — туда встанет вывод 1: ${pinLayoutText(def.package, def.pins)}, дальний ряд — в ряду e. R — повернуть (до установки или выделенную): на печатной плате и корпусе — в любую сторону.`,
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
  // Инструменты — заводские компоненты карьеры и по одному на свою микросхему библиотеки
  get tools() {
    return toolChips().map(chipTool);
  },
  polar: () => true,
  label: (c) => `${c.name} (${packageName(c.package, c.pins)})`,
  value: (c) => c.name,
  burn: (c) => [`Микросхема ${c.id} вышла из строя`, "Сгорела деталь внутри или перегружен выход. Посмотрите, куда подключены выходы, откройте её схему (в панели микросхемы) или замените микросхему новой."],
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

  // Начинка — отдельные детали (Simulation разворачивает её); здесь — только соединения с выводами.
  // Проверенная микросхема считается моделью: ключи выходов, входы и ток покоя
  stamp(c, sim, { links, out }) {
    const model = sim.modelOf(c.id);
    if (model) {
      if (sim.state(c.id).burned) return;
      const node = (p: number) => pinNode(c, p - 1);
      const q = sim.junction.get(`${c.id}:q`);
      const on = q !== undefined && q >= 0;
      out.push({ id: `${c.id}:iq`, a: node(model.vcc), b: node(model.gnd), r: model.volts / Math.max(model.iq, model.volts / MODEL_OFF) });
      model.inputs.forEach((p, i) => out.push({ id: `${c.id}:in${i}`, a: node(p), b: node(model.gnd), r: model.rIn[i] }));
      model.outputs.forEach((p, k) => {
        const high = on && !!(q! & (1 << k));
        const low = on && !high;
        out.push({ id: `${c.id}:h${k}`, a: node(model.vcc), b: node(p), r: high ? model.rHigh[k] : MODEL_OFF });
        out.push({ id: `${c.id}:l${k}`, a: node(p), b: node(model.gnd), r: low ? model.rLow[k] : MODEL_OFF });
      });
      return;
    }
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
  /**
   * Модель: какие выходы включены — по входам из прошлого решения. Состояние меняется, пока не
   * устоится; число переключений на решение ограничено (как у блока питания), иначе кольцо из
   * инверторов без задержки качалось бы вечно.
   */
  newton(c, sim, _iter, shared) {
    const model = sim.modelOf(c.id);
    if (!model || sim.state(c.id).burned) return true;
    const v = (p: number) => sim.solution.voltage.get(pinNode(c, p - 1)) ?? 0;
    const gnd = v(model.gnd), span = v(model.vcc) - gnd;
    // Без питания (меньше 40 % от того, при котором сняты параметры) выходы отключены
    let q = -1;
    if (span > 0.4 * model.volts) {
      const prev = sim.memory.get(`${c.id}:seq`) as ModelState | undefined;
      const outs = model.logic(inputBits(c, model, sim), prev);
      q = outs.reduce((m, b, k) => m | (b ? 1 << k : 0), 0);
    }
    const key = `${c.id}:q`;
    if (sim.junction.get(key) === q || shared.flips >= 64) return true;
    sim.junction.set(key, q);
    shared.flips++;
    return false;
  },
  // Расчёт установился: запомнить входы и выходы — по ним триггер помнит своё и узнаёт фронт
  commit(c, sim) {
    const model = sim.modelOf(c.id);
    const q = sim.junction.get(`${c.id}:q`);
    if (!model || q === undefined || q < 0) return;
    sim.memory.set(`${c.id}:seq`, { inputs: inputBits(c, model, sim), outputs: model.outputs.map((_, k) => !!(q & (1 << k))) } satisfies ModelState);
  },
  // Перегрузка модели — по самому нагруженному выходу (предел как у логики 74-й серии)
  load(c, sim) {
    const model = sim.modelOf(c.id);
    if (!model) return undefined;
    let worst = 0;
    model.outputs.forEach((_, k) => {
      for (const key of [`${c.id}:h${k}`, `${c.id}:l${k}`]) worst = Math.max(worst, Math.abs(sim.branch(key).current));
    });
    return { ratio: worst / MODEL_MAX_OUT, what: "ток", limit: formatSI(MODEL_MAX_OUT, "А") };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  voltage: () => 0,
  current: () => 0,
  power: () => 0,
  readout: (c, sim) => {
    const def = resolveChip(sim.scene, c.def);
    return `<div class="kv"><span>${def ? `${def.name}, ${packageName(def.package, def.pins)}` : "Нет описания микросхемы"}</span><span>${def ? countShort(countChip(def, sim.scene)) : ""}</span></div>`;
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
        <p class="sub">${def.id.startsWith("ref:") ? "Заводская: внутри эталонная сборка из карьеры." : def.id.startsWith("career:") ? "Открыта в карьере: внутри ваша сборка." : "Собрана вами."} ${modelText(sim.modelOf(c.id))}</p>`,
      editor: `<div class="row"><button class="btn inline" data-act="openChip" id="btn-open-chip">Открыть схему</button></div>`,
    };
  },
};

/** Входы модели по текущему решению: единица — выше половины питания. */
function inputBits(c: Chip, model: ChipModel, sim: Simulation): boolean[] {
  const v = (p: number) => sim.solution.voltage.get(pinNode(c, p - 1)) ?? 0;
  const gnd = v(model.gnd), span = v(model.vcc) - gnd;
  return model.inputs.map((p) => v(p) - gnd > span / 2);
}

/** Как считается микросхема: моделью (и с какими параметрами) или целиком. */
function modelText(m: ChipModel | undefined): string {
  if (!m) return "Расчёт — полный, как если бы схема стояла на макетке: детали внутри греются и горят как обычно.";
  const r = (xs: number[]) => [...new Set(xs.map((x) => (x >= MODEL_OFF ? "∞" : formatOhms(x))))].join(", ");
  return `Она уже прошла проверку, поэтому считается моделью, снятой с этой проверки при ${formatSI(m.volts, "В")}: выход — ключ к питанию через ${r(m.rHigh)} или к общему через ${r(m.rLow)}, вход — ${r(m.rIn)} на общий, ток покоя ${formatSI(m.iq, "А")}. Так расчёт быстрый, даже если внутри сотни транзисторов. Перегрузка выхода сверх ${formatSI(MODEL_MAX_OUT, "А")} выводит её из строя.`;
}

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
    const offsets = pinOffsets(c.package, c.pins);
    const len = Math.max(...offsets.map(([a]) => a)) + 1;
    base = offsets.map(([along, across]) => new THREE.Vector3(along - (len - 1) / 2, mm(0.3), across === 0 ? 1.5 : -1.5));
    pins = base.map((p) => freeTransform(c, p));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
  }
  if (isSot(c.package)) return sotView(c, group, base, pins);
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

// ─── 3D: SOT-23-5/6 на переходнике ─────────────────────────────────────────────

/** Шелкография и медь переходника: дорожки от площадок SOT-23 к штырькам (5 или 6), номера, название. */
function adapterTexture(name: string, n: number): THREE.CanvasTexture {
  const P = 96;
  const canvas = document.createElement("canvas");
  canvas.width = 3.3 * P;
  canvas.height = 4.3 * P;
  const g = canvas.getContext("2d")!;
  const X = (x: number) => (x + 1.65) * P;
  const Z = (z: number) => (z + 2.15) * P;
  g.fillStyle = "#1d4f9c";
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Площадки SOT-23: 1–3 — к ближнему ряду, дальше по кругу по дальнему (у SOT-23-5 посередине пусто)
  const sot = sotPads(n).map(([x, z]): [number, number] => [x * mm(0.95), z * mm(1.2)]);
  const header = sotPads(n).map(([x, z]): [number, number] => [x, z * 1.5]);
  g.strokeStyle = "#d9a441";
  g.lineWidth = P * 0.12;
  g.lineCap = "round";
  sot.forEach(([sx, sz], i) => {
    const [hx, hz] = header[i];
    g.beginPath();
    g.moveTo(X(sx), Z(sz));
    g.lineTo(X(sx), Z((sz + hz) / 2));
    g.lineTo(X(hx), Z((sz + hz) / 2));
    g.lineTo(X(hx), Z(hz));
    g.stroke();
  });
  // Штырьки: лужёные кольца (средний дальний — не подключён)
  for (const [hx, hz] of n === 5 ? [...header, [0, -1.5] as [number, number]] : header) {
    g.fillStyle = "#d4d6d8";
    g.beginPath();
    g.arc(X(hx), Z(hz), P * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#f2f4f0";
  g.font = `700 ${P * 0.28}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  header.forEach(([hx, hz], i) => g.fillText(String(i + 1), X(hx) + P * 0.42, Z(hz) + (hz > 0 ? -P * 0.42 : P * 0.42)));
  g.font = `600 ${P * 0.24}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(name.slice(0, 14), canvas.width / 2, P * 0.95);
  g.fillText(`SOT-23-${n}`, canvas.width / 2, canvas.height - P * 0.95);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Выводы SOT-23 по порядку: [вдоль, поперёк] в долях — 1…3 снизу слева направо, дальше обратно сверху. */
function sotPads(n: number): [number, number][] {
  return n === 5
    ? [[-1, 1], [0, 1], [1, 1], [1, -1], [-1, -1]]
    : [[-1, 1], [0, 1], [1, 1], [1, -1], [0, -1], [-1, -1]];
}

/**
 * Переходник SOT-23-5/6 → 2,54 мм: синяя плата на двух рядах штырьков (через 7,62 мм, как DIP-6),
 * сверху — сама микросхема 2,9 × 1,6 мм. base — отверстия выводов (или точки на столе).
 */
function sotView(c: Chip, group: THREE.Group, base: THREE.Vector3[], pins: THREE.Vector3[]): ComponentView {
  const Hs = base[0].y;
  const u = base[2].clone().sub(base[0]).setY(0).normalize(); // вдоль ближнего ряда: 1 → 3
  const v = base[0].clone().sub(base[base.length - 1]).setY(0).normalize(); // от дальнего ряда к ближнему
  const center = base[0].clone().addScaledVector(u, 1).addScaledVector(v, -1.5).setY(Hs);
  const spacer = mm(2.5), T = mm(1.6);
  const body = new THREE.Group();
  body.position.copy(center);
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), v));
  // Колодки штырьков — чёрные планки по рядам
  for (const z of [1.5, -1.5]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3, spacer, 0.9), blackPlastic);
    bar.position.set(0, spacer / 2, z);
    body.add(bar);
  }
  // Плата переходника
  const top = new THREE.MeshStandardMaterial({ map: adapterTexture(c.name, base.length), roughness: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x1d4f9c, roughness: 0.5 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.3, T, 4.3), [edge, edge, top, edge, edge, edge]);
  board.position.y = spacer + T / 2;
  body.add(board);
  // Штырьки: от отверстия до верха платы (средний дальний — для вида, ни к чему не подключён)
  const metal = new THREE.MeshStandardMaterial({ color: 0xd4d6d8, metalness: 0.85, roughness: 0.3 });
  for (const [x, z] of [[-1, 1.5], [0, 1.5], [1, 1.5], [1, -1.5], [0, -1.5], [-1, -1.5]]) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(mm(0.64), spacer + T + mm(1.2), mm(0.64)), metal);
    pin.position.set(x, (spacer + T + mm(1.2)) / 2 - 0.2, z);
    body.add(pin);
  }
  // SOT-23: корпус 2,9 × 1,6 × 1,1 мм и пять или шесть ножек «крылом чайки»
  const chipTop = spacer + T;
  const sot = new THREE.Mesh(new THREE.BoxGeometry(mm(2.9), mm(1.1), mm(1.6)), blackPlastic);
  sot.position.y = chipTop + mm(0.15) + mm(0.55);
  body.add(sot);
  for (const [x, side] of sotPads(base.length).map(([a, b]) => [a * mm(0.95), b])) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(mm(0.4), mm(0.15), mm(0.6)), metal);
    leg.position.set(x, chipTop + mm(0.1), side * mm(1.1));
    body.add(leg);
  }
  // Ключ — точка у вывода 1 на корпусе
  const dot = new THREE.Mesh(new THREE.CircleGeometry(mm(0.2), 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8f96 }));
  dot.position.set(-mm(0.95), sot.position.y + mm(0.56), mm(0.4));
  body.add(dot);
  group.add(body);
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot: c.placement.mode === "board" ? center.clone().setY(Hs + chipTop + 1) : freeTransform(c, new THREE.Vector3(0, Hs + chipTop + 1, 0)),
    update() {},
    dispose: () => disposeGroup(group),
  };
}
