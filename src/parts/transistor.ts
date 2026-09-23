import * as THREE from "three";
import { boardFrame, type ComponentView, disposeGroup, freeTransform, holePos, lead, mm, tagPickable } from "../view/kit";
import { MOSFETS, TRANSISTORS, type Mosfet, type Pin, type Transistor, type TransistorKind } from "../model/types";
import { VT, diodeBranch, limitJunction } from "../sim/devices";
import { pinNode } from "../sim/nodes";
import type { Simulation } from "../sim/simulation";
import * as tolerance from "../sim/tolerance";
import type { Tolerance } from "../sim/tolerance";
import type { PartDef, Stamp } from "./types";
import { holeLabel } from "../model/breadboard";
import { formatSI } from "../sim/resistorCodes";
import { actualRow, bjtSelect, pill } from "../view/panel";

/** Режим работы транзистора. */
export type TransistorMode = "отсечка" | "усиление" | "насыщение" | "инверсный";

export interface TransistorState {
  /** Токи в «прямом» смысле: для n-p-n втекают в коллектор и базу, для p-n-p — вытекают. */
  ic: number;
  ib: number;
  ie: number;
  /** Напряжения в «прямом» смысле: для n-p-n Vбэ = Vб − Vэ, для p-n-p Vэб. */
  vbe: number;
  vce: number;
  vbc: number;
  mode: TransistorMode;
}

/**
 * Ёмкость переходов транзистора, Ф. У настоящего BC547 — единицы пикофарад; здесь намеренно 10 нФ:
 * без ёмкостей переключение мгновенное, и у схем с положительной обратной связью (мигалка, триггер)
 * в момент переключения нет непрерывного решения — метод Ньютона блуждает. С ёмкостью переключение
 * занимает микросекунды, для глаза это всё равно мгновенно.
 */
export const JUNCTION_CAPACITANCE = 10e-9;

/** Модель транзистора: знак (+1 n-p-n, −1 p-n-p) и параметры Эберса–Молла. */
function bjt(c: Transistor, tol: Tolerance) {
  const t = TRANSISTORS[c.kind];
  const sign = t.polarity === "npn" ? 1 : -1;
  return {
    sign,
    is: t.is,
    /** Переходы как диоды: ток базы через каждый — Is/β. */
    be: { is: t.is / tolerance.betaF(c, tol), n: 1, rs: 0 },
    bc: { is: t.is / t.betaR, n: 1, rs: 0 },
    /** Для ограничения шага: весь ток перехода, а не только базовая часть. */
    junction: { is: t.is, n: 1, rs: 0 },
  };
}

/** Токи и напряжения транзистора из текущего решения. */
export function transistorState(c: Transistor, sim: Simulation): TransistorState {
  const zero: TransistorState = { ic: 0, ib: 0, ie: 0, vbe: 0, vce: 0, vbc: 0, mode: "отсечка" };
  const v = (pin: Pin) => sim.solution.voltage.get(pinNode(c, pin));
  const [vc, vb, ve] = [v(0), v(1), v(2)];
  if (vc === undefined || vb === undefined || ve === undefined) return zero;
  const m = bjt(c, sim.tolerance);
  const vbe = m.sign * (vb - ve);
  const vbc = m.sign * (vb - vc);
  if (sim.state(c.id).burned) return { ...zero, vbe, vbc, vce: vbe - vbc };
  const ibe = sim.solution.branches.get(`${c.id}:be`)?.current ?? 0;
  const ibc = sim.solution.branches.get(`${c.id}:bc`)?.current ?? 0;
  const it = m.is * (Math.exp(vbe / VT) - Math.exp(vbc / VT));
  const ic = it - ibc;
  const ib = ibe + ibc;
  const mode: TransistorMode =
    Math.abs(ic) < 1e-6 && Math.abs(ib) < 1e-6
      ? "отсечка"
      : vbe < 0.3 && vbc > 0.4
        ? "инверсный"
        : vbc > 0.4
          ? "насыщение"
          : "усиление";
  return { ic, ib, ie: ic + ib, vbe, vbc, vce: vbe - vbc, mode };
}

/**
 * Транзистор по Эберсу–Моллу: два перехода как диоды (дают ток базы) и ток переноса
 * коллектор → эмиттер It = Is·(e^(Vбэ/Vt) − e^(Vбк/Vt)), линеаризованный в текущей точке.
 * Для p-n-p все напряжения и токи с обратным знаком.
 */
function stampTransistor(c: Transistor, sim: Simulation, { out, extras }: Stamp): void {
  const m = bjt(c, sim.tolerance);
  const [C, B, E] = [pinNode(c, 0), pinNode(c, 1), pinNode(c, 2)];
  const vbe0 = sim.junction.get(`${c.id}:be`) ?? 0;
  const vbc0 = sim.junction.get(`${c.id}:bc`) ?? 0;
  // Переходы: у n-p-n анод — база, у p-n-p — эмиттер/коллектор
  const be = diodeBranch(m.be, vbe0);
  const bc = diodeBranch(m.bc, vbc0);
  out.push(m.sign > 0 ? { id: `${c.id}:be`, a: B, b: E, ...be } : { id: `${c.id}:be`, a: E, b: B, ...be });
  out.push(m.sign > 0 ? { id: `${c.id}:bc`, a: B, b: C, ...bc } : { id: `${c.id}:bc`, a: C, b: B, ...bc });
  // Ёмкости переходов (неявный метод Эйлера, как у конденсатора)
  for (const [key, a, b] of [[`${c.id}:cbe`, B, E], [`${c.id}:cbc`, B, C]] as const) {
    out.push({ id: key, a, b, r: sim.h / JUNCTION_CAPACITANCE, emf: -(sim.capVoltage.get(key) ?? 0) });
  }
  const ef = Math.exp(vbe0 / VT);
  const er = Math.exp(vbc0 / VT);
  const gf = (m.is / VT) * ef;
  const gr = (m.is / VT) * er;
  const it0 = m.is * (ef - er);
  // I(К→Э) = знак·(It0 − gf·vbe0 + gr·vbc0) + gf·(Vб − Vэ) − gr·(Vб − Vк)
  extras.currents.push({ a: C, b: E, j: m.sign * (it0 - gf * vbe0 + gr * vbc0) });
  extras.vccs.push({ a: C, b: E, cp: B, cn: E, g: gf });
  extras.vccs.push({ a: C, b: E, cp: B, cn: C, g: -gr });
}

export const transistor: PartDef<Transistor> = {
  type: "transistor",
  prefix: "VT",
  pins: 3,
  onBoard: () => true,
  polar: () => true,
  label: (c) => `транзистор ${TRANSISTORS[c.kind].label}, I<sub>к</sub>`,
  value: (c) => TRANSISTORS[c.kind].label,
  burn: (c) => [
    `Транзистор ${c.id} сгорел`,
    "Ток коллектора больше 100 мА или мощность больше 0,5 Вт. Поставьте резистор в цепь коллектора и резистор в базу.",
  ],

  stamp(c, sim, s) {
    if (!sim.state(c.id).burned) stampTransistor(c, sim, s);
  },
  newton(c, sim) {
    const m = bjt(c, sim.tolerance);
    const volt = (pin: Pin) => sim.solution.voltage.get(pinNode(c, pin)) ?? 0;
    const targets: [string, number][] = [
      [`${c.id}:be`, m.sign * (volt(1) - volt(2))],
      [`${c.id}:bc`, m.sign * (volt(1) - volt(0))],
    ];
    let converged = true;
    for (const [key, vterm] of targets) {
      const vold = sim.junction.get(key) ?? 0;
      const vnew = limitJunction(vterm, vold, m.junction);
      if (Math.abs(vnew - vold) > 1e-7) converged = false;
      sim.junction.set(key, vnew);
    }
    return converged;
  },
  dynamic: true,
  remember(c, sim) {
    for (const key of [`${c.id}:cbe`, `${c.id}:cbc`]) sim.capVoltage.set(key, -sim.branch(key).voltage);
  },
  voltage: (c, sim) => sim.transistor(c).vce,
  current: (c, sim) => sim.transistor(c).ic,
  power(c, sim) {
    const t = sim.transistor(c);
    return Math.max(0, t.vce * t.ic + t.vbe * t.ib);
  },
  load(c, sim) {
    const spec = TRANSISTORS[c.kind];
    const byI = Math.abs(sim.transistor(c).ic) / spec.maxIc;
    const byP = sim.power(c) / spec.maxP;
    return byI >= byP
      ? { ratio: byI, what: "ток", limit: `${spec.maxIc * 1000} мА` }
      : { ratio: byP, what: "мощность", limit: `${spec.maxP} Вт` };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  reversed: (c, sim) => sim.transistor(c).mode === "инверсный",
  panel(c, sim) {
    const spec = TRANSISTORS[c.kind];
    const t = sim.transistor(c);
    const beta = t.ib > 1e-9 ? t.ic / t.ib : 0;
    return {
      title: `Транзистор ${spec.label} (${spec.polarity === "npn" ? "n-p-n" : "p-n-p"})`,
      body: `<div class="kv"><span>U<sub>бэ</sub></span><span>${formatSI(t.vbe, "В")}</span></div>
          <div class="kv"><span>I<sub>к</sub> / I<sub>б</sub></span><span>${beta ? Math.round(beta) : "—"}</span></div>
          <div class="kv"><span>Мощность</span><span>${formatSI(sim.power(c), "Вт")}</span></div>
          <p class="sub">Малый ток базы управляет большим током коллектора: в режиме усиления I<sub>к</sub> ≈ β·I<sub>б</sub>, β ≈ ${spec.betaF}. В насыщении ток коллектора ограничивает уже нагрузка, и отношение меньше β. ${
            spec.polarity === "npn"
              ? "n-p-n открывается, когда база выше эмиттера на ≈ 0,6 В."
              : "p-n-p открывается, когда база ниже эмиттера на ≈ 0,6 В; эмиттер — к плюсу."
          } Выводы слева направо (маркировкой к себе): К, Б, Э.</p>`,
      editor: bjtSelect(c.kind),
    };
  },
  edit(c, field, value) {
    if (field === "bjt") c.kind = value as TransistorKind;
  },
  readout(c, sim) {
    const t = sim.transistor(c);
    return `<dl class="readout">
      <div><dt>I<sub>Б</sub></dt><dd>${formatSI(t.ib, "А")}</dd></div>
      <div><dt>I<sub>К</sub></dt><dd>${formatSI(t.ic, "А")}</dd></div>
      <div><dt>U<sub>КЭ</sub></dt><dd>${formatSI(t.vce, "В")}</dd></div>
    </dl>`;
  },
  status(c, sim) {
    const mode = sim.transistor(c).mode;
    if (mode === "инверсный") return pill("bad", "К И Э ПЕРЕПУТАНЫ — ИНВЕРСНЫЙ РЕЖИМ");
    if (mode === "отсечка") return pill("warn", "ЗАКРЫТ (ОТСЕЧКА)");
    if (mode === "насыщение") return pill("ok", "ОТКРЫТ (НАСЫЩЕНИЕ)");
    return pill("ok", "УСИЛЕНИЕ");
  },
  where: (_c, holes) => `К ${holeLabel(holes[0])}, Б ${holeLabel(holes[1])}, Э ${holeLabel(holes[2])}`,
  actual: (c, tol) => actualRow("β этого экземпляра", String(Math.round(tolerance.betaF(c, tol)))),
  view: transistorView,
};

// ─── 3D: Транзистор TO-92 ──────────

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
  // Маркировка одной строкой; шрифт уменьшается, чтобы длинные (IRLZ44N) влезли по ширине
  let size = 64;
  do {
    g.font = `600 ${size}px "IBM Plex Mono", ui-monospace, monospace`;
    size -= 2;
  } while (g.measureText(label).width > 230 && size > 20);
  g.fillText(label, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Корпус TO-92: полуцилиндр Ø 4,8 мм с плоской гранью, на ней маркировка.
 * Выводы с шагом 2,54 мм по локальной оси X: коллектор (−X), база, эмиттер (+X);
 * плоская грань смотрит в +Z — как если держать транзистор маркировкой к себе.
 */
export function transistorView(c: Transistor | Mosfet): ComponentView {
  const group = new THREE.Group();
  const label = c.type === "transistor" ? TRANSISTORS[c.kind].label : MOSFETS[c.kind].label;
  const pkg = c.type === "transistor" ? "TO-92" : MOSFETS[c.kind].pkg;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.55 });
  const faceMat = new THREE.MeshStandardMaterial({ map: to92Label(label), roughness: 0.55 });
  const body = new THREE.Group();
  let h: number;
  if (pkg === "TO-92") {
    const r = mm(2.4);
    h = mm(4.8);
    // Полуцилиндр задней стороной (z ≤ 0)
    const back = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, false, Math.PI / 2, Math.PI), bodyMat);
    back.position.y = h / 2;
    body.add(back);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, h), faceMat);
    face.position.y = h / 2;
    body.add(face);
    // Торцы — полукруги над той же задней половиной: после поворота на −90° вокруг X
    // верхняя половина круга (y ≥ 0) ложится на z ≤ 0
    const topCap = new THREE.Mesh(new THREE.CircleGeometry(r, 32, 0, Math.PI), bodyMat);
    topCap.rotation.x = -Math.PI / 2;
    topCap.position.y = h;
    body.add(topCap);
    const bottomCap = new THREE.Mesh(new THREE.CircleGeometry(r, 32, 0, Math.PI), bodyMat);
    bottomCap.rotation.x = Math.PI / 2; // смотрит вниз; y ≥ 0 → z ≥ 0, поэтому ещё разворот
    bottomCap.rotation.z = Math.PI;
    body.add(bottomCap);
  } else {
    // TO-220: пластиковый корпус 10 × 9 × 4,5 мм и металлический фланец с отверстием под радиатор
    const w = mm(10), hb = mm(9), t = mm(4.5);
    const plastic = new THREE.Mesh(new THREE.BoxGeometry(w, hb, t), [bodyMat, bodyMat, bodyMat, bodyMat, faceMat, bodyMat]);
    plastic.position.set(0, hb / 2, 0);
    body.add(plastic);
    const tabShape = new THREE.Shape();
    tabShape.moveTo(-w / 2, 0);
    tabShape.lineTo(w / 2, 0);
    tabShape.lineTo(w / 2, mm(6.5));
    tabShape.lineTo(-w / 2, mm(6.5));
    tabShape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, mm(3.3), mm(1.8), 0, Math.PI * 2, true);
    tabShape.holes.push(hole);
    const tab = new THREE.Mesh(
      new THREE.ExtrudeGeometry(tabShape, { depth: mm(1.3), bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.3 }),
    );
    tab.position.set(0, hb, -t / 2);
    body.add(tab);
    h = hb + mm(6.5);
  }

  const step = mm(2.54);
  // У TO-92 ножки у корпуса сведены (1,27 мм), у TO-220 идут с шагом 2,54 мм
  const bodyPitch = pkg === "TO-92" ? step * 0.5 : step;
  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  if (c.placement.mode === "free") {
    const bottom = 1.3;
    body.position.y = bottom;
    group.add(body);
    for (const k of [-1, 0, 1]) {
      group.add(lead([new THREE.Vector3(k * bodyPitch, bottom + 0.1, 0), new THREE.Vector3(k * bodyPitch, 0.5, 0), new THREE.Vector3(k * step * 1.2, mm(0.3), 0.8)], mm(0.22)));
    }
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    pins = [-1, 0, 1].map((k) => freeTransform(c, new THREE.Vector3(k * step * 1.2, mm(0.3), 0.8)));
    hotspot = freeTransform(c, new THREE.Vector3(0, bottom + h, 0));
  } else {
    // Три соседних отверстия: корпус над средним, плоской гранью «вперёд» относительно направления К → Э
    const holes = c.placement.holes;
    const f = boardFrame([holes[0], holes[2]]);
    const H = f.p0.y;
    pins = holes.map((id) => holePos(id));
    const bottom = H + 1.0;
    body.position.set(f.mid.x, bottom, f.mid.z);
    body.rotation.y = f.angle;
    group.add(body);
    pins.forEach((p, i) => {
      const atBody = f.mid.clone().addScaledVector(f.dir, (i - 1) * bodyPitch).setY(bottom + 0.1);
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
