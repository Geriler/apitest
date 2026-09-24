import * as THREE from "three";
import { HOLE_BY_ID } from "../model/breadboard";
import type { Potentiometer } from "../model/types";
import { formatLimit } from "../sim/devices";
import { pinNode } from "../sim/nodes";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import { deviation, type Tolerance } from "../sim/tolerance";
import { type ComponentView, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { actualRow, kv, pct, readout, selectField } from "../view/panel";
import { toolFor, type PartDef } from "./types";

/** Номиналы подстроечных резисторов, Ом. */
export const POT_VALUES = [1000, 4700, 10_000, 47_000, 100_000];
/** Мощность всей дорожки, Вт (как у подстроечника 3386 при 70 °C — берём с запасом). */
export const POT_RATED_W = 0.25;
/** Допуск полного сопротивления: у угольных потенциометров ±20 %. */
export const POT_TOLERANCE = 0.2;
/** Движок в крайнем положении: остаётся сопротивление контакта, 0,5 % от полного. */
const END = 0.005;

/** Полное сопротивление с учётом допуска. */
export function potOhms(c: Potentiometer, tol: Tolerance): number {
  return c.ohms * (1 + POT_TOLERANCE * deviation(tol, c.id, "R"));
}

/** Сопротивления от вывода 0 до движка и от движка до вывода 2, Ом. */
export function potSections(c: Potentiometer, tol: Tolerance): [number, number] {
  const r = potOhms(c, tol);
  return [r * Math.max(c.position, END), r * Math.max(1 - c.position, END)];
}

const pctText = (x: number) => `${Math.round(x * 100)} %`;

export const pot: PartDef<Potentiometer> = {
  type: "pot",
  prefix: "R",
  pins: 3,
  onBoard: () => true,
  tools: [
    toolFor<Potentiometer>()({
      id: "pot",
      group: "passive",
      icon: `<path d="M1 12h7M22 12h7" /><rect x="8" y="8" width="14" height="8" /><path d="M15 2v5M13 5l2 2 2-2" />`,
      label: "Потенциометр",
      title: "Подстроечный резистор: крайний вывод, движок, крайний вывод",
      settings: { ohms: 10_000 },
      name: () => "Потенциометр",
      note: () =>
        `<p class="sub">Три вывода: <b>крайний, движок, крайний</b> — встаёт в три соседних столбца. Между крайними — всё сопротивление, движок делит его. Как делитель напряжения — крайние к плюсу и минусу, выход с движка; как регулятор тока — крайний и движок.</p>`,
      editor: (s) => ohmsSelect(s.ohms),
      set(s, field, value) {
        if (field === "potOhms") s.ohms = Number(value);
      },
      create: (s) => ({ type: "pot", ohms: s.ohms, position: 0.5 }),
      hint: () => "Нажмите на отверстие — потенциометр займёт его и два соседних справа: крайний вывод, движок, крайний вывод. F — перевернуть.",
    }),
  ],
  polar: () => false,
  label: (c) => `потенциометр ${formatOhms(c.ohms)}, ${pctText(c.position)}`,
  value: (c) => `${formatOhms(c.ohms)}, ${pctText(c.position)}`,
  symbol3: () => ({
    // Дорожка — прямоугольник на основном пути (x = 8), движок — стрелка слева
    roles: { up: 0, ctrl: 1, down: 2 },
    body: `<path d="M8 -17V-15M8 15V17"/><rect x="3" y="-15" width="10" height="30"/><path d="M-6 0H0"/><path d="M3 0L-1.5 -3V3Z" class="fill"/>`,
    ctrlX: -6,
  }),
  burn: (c) => [
    `Потенциометр ${c.id} сгорел`,
    `Дорожка рассчитана на ${formatSI(POT_RATED_W, "Вт")}, а когда движок близко к краю, почти весь ток идёт через маленький кусок дорожки. Поставьте последовательно ограничивающий резистор или возьмите номинал больше.`,
  ],
  view: potView,

  stamp(c, sim, { out }) {
    const [a, w, b] = [pinNode(c, 0), pinNode(c, 1), pinNode(c, 2)];
    const burned = sim.state(c.id).burned;
    const [r1, r2] = potSections(c, sim.tolerance);
    out.push({ id: `${c.id}:aw`, a, b: w, r: burned ? Infinity : r1 });
    out.push({ id: `${c.id}:wb`, a: w, b, r: burned ? Infinity : r2 });
  },
  // Напряжение между крайними выводами и ток, втекающий в вывод 0
  voltage: (c, sim) => (sim.solution.voltage.get(pinNode(c, 0)) ?? 0) - (sim.solution.voltage.get(pinNode(c, 2)) ?? 0),
  current: (c, sim) => sim.branch(`${c.id}:aw`).current,
  power: (c, sim) => sim.branch(`${c.id}:aw`).power + sim.branch(`${c.id}:wb`).power,
  load(c, sim) {
    // Каждый кусок дорожки выдерживает свою долю мощности
    const share = (x: number) => POT_RATED_W * Math.max(x, 0.05);
    const ratio = Math.max(sim.branch(`${c.id}:aw`).power / share(c.position), sim.branch(`${c.id}:wb`).power / share(1 - c.position));
    return { ratio, what: "мощность", limit: formatLimit(POT_RATED_W, "Вт") };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },

  panel(c, sim) {
    const [r1, r2] = potSections(c, sim.tolerance);
    return {
      title: `Потенциометр ${formatOhms(c.ohms)}`,
      body: `<div class="field"><label for="f-potPos">Движок: <b>${pctText(c.position)}</b></label>
          <input type="range" id="f-potPos" data-field="potPos" data-unit="%" min="0" max="100" step="1" value="${Math.round(c.position * 100)}" /></div>
        ${kv("Вывод 1 — движок", formatOhms(r1))}
        ${kv("Движок — вывод 3", formatOhms(r2))}
        <p class="sub">Движок делит дорожку на две части, в сумме — всё сопротивление. Мощность дорожки ${formatSI(POT_RATED_W, "Вт")} — на всю длину: у края маленький кусок перегреется от большого тока.</p>`,
      editor: ohmsSelect(c.ohms),
    };
  },
  edit(c, field, value) {
    if (field === "potPos") c.position = Math.min(1, Math.max(0, Number(value) / 100));
    if (field === "potOhms") c.ohms = Number(value);
  },
  readout(c, sim) {
    const v = (p: 0 | 1 | 2) => sim.solution.voltage.get(pinNode(c, p)) ?? 0;
    return readout(v(0) - v(2), sim.current(c), sim.power(c), ["U<sub>движка</sub>", formatSI(v(1) - v(2), "В")]);
  },
  actual(c, tol) {
    const r = potOhms(c, tol);
    return actualRow("Фактически", `${formatOhms(r)} (${pct(r, c.ohms)})`);
  },
};

function ohmsSelect(ohms: number): string {
  return selectField("potOhms", "Сопротивление", POT_VALUES.map((v) => [String(v), formatOhms(v)]), String(ohms));
}

// ─── 3D: подстроечный резистор 3386 ─────────────────────────────────────────

/** Синий корпус 9,5 × 10 мм с латунным винтом; шлиц поворачивается вместе с движком (от −135° до +135°). */
function potView(c: Potentiometer): ComponentView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const W = mm(9.5), H = mm(4.8), D = mm(10);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial({ color: 0x2f6fd1, roughness: 0.5 }));
  housing.position.y = H / 2;
  body.add(housing);
  const screw = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.85, roughness: 0.35 });
  screw.add(new THREE.Mesh(new THREE.CylinderGeometry(mm(1.6), mm(1.6), mm(0.8), 24), brass));
  const slot = new THREE.Mesh(new THREE.BoxGeometry(mm(2.6), mm(0.3), mm(0.5)), new THREE.MeshStandardMaterial({ color: 0x3a2e14 }));
  slot.position.y = mm(0.35);
  screw.add(slot);
  screw.position.y = H + mm(0.4);
  body.add(screw);

  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  if (c.placement.mode === "free") {
    body.position.y = 0.8;
    group.add(body);
    for (const sx of [-1, 0, 1]) group.add(lead([new THREE.Vector3(sx, 0.85, 0), new THREE.Vector3(sx, 0.4, 0), new THREE.Vector3(sx * 1.2, mm(0.3), 1.6)]));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
    pins = [-1, 0, 1].map((sx) => freeTransform(c, new THREE.Vector3(sx * 1.2, mm(0.3), 1.6)));
    hotspot = freeTransform(c, new THREE.Vector3(0, 2.6, 0));
  } else {
    const p = c.placement.holes.map((id) => {
      const h = HOLE_BY_ID.get(id)!;
      return new THREE.Vector3(h.x, h.y, h.z);
    });
    const Hb = p[1].y;
    const dir = p[2].clone().sub(p[0]).setY(0).normalize();
    body.position.set(p[1].x, Hb + 0.35, p[1].z);
    body.rotation.y = Math.atan2(-dir.z, dir.x);
    group.add(body);
    for (const q of p) group.add(lead([q.clone().setY(Hb - 0.2), q.clone().setY(Hb + 0.4)]));
    pins = p;
    hotspot = p[1].clone().setY(Hb + 2.6);
  }
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot,
    update() {
      // Положение движка меняется ползунком без перестройки сцены — читаем его прямо из детали
      screw.rotation.y = (0.5 - c.position) * 1.5 * Math.PI;
    },
    dispose: () => disposeGroup(group),
  };
}
