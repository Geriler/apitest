import * as THREE from "three";
import type { Relay, RelayKind } from "../model/types";
import { pinNode } from "../sim/nodes";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import type { Simulation } from "../sim/simulation";
import { type ComponentView, disposeGroup, freeTransform, labelTexture, mm, tagPickable } from "../view/kit";
import { kv, pill, readout, selectField } from "../view/panel";
import { toolFor, type PartDef } from "./types";

/**
 * Реле Songle SRD (как на модулях для Arduino). Паспорт: срабатывает не выше 75 % номинала,
 * отпускает не ниже 10 %; контакты 10 А.
 */
export const RELAYS: Record<RelayKind, { label: string; volts: number; coil: number; pullIn: number; dropOut: number }> = {
  "5V": { label: "SRD-05VDC", volts: 5, coil: 70, pullIn: 3.75, dropOut: 0.5 },
  "12V": { label: "SRD-12VDC", volts: 12, coil: 400, pullIn: 9, dropOut: 1.2 },
};
/** Сопротивление замкнутого контакта, Ом, и предельный ток контактов, А. */
export const RELAY_CONTACT_R = 0.05;
export const RELAY_CONTACT_A = 10;
/** Катушка выдерживает долго до 130 % номинального напряжения. */
const COIL_MAX = 1.3;

/** Выводы: 0, 1 — катушка; 2 — COM (общий), 3 — NO (замкнут при сработавшем реле), 4 — NC. */
export const RELAY_PINS = ["катушка A1", "катушка A2", "COM", "NO", "NC"];

/** Притянут ли якорь (реле сработало). */
export function relayOn(c: Relay, sim: Simulation): boolean {
  if (sim.state(c.id).burned) return false;
  return (sim.memory.get(c.id) as { on: boolean } | undefined)?.on ?? false;
}

/** Напряжение на катушке (по модулю — катушке всё равно, куда ток), В. */
function coilVolts(c: Relay, sim: Simulation): number {
  return Math.abs(sim.branch(`${c.id}:coil`).voltage);
}

export const relay: PartDef<Relay> = {
  type: "relay",
  prefix: "K",
  pins: 5,
  onBoard: () => false,
  tools: [
    toolFor<Relay>()({
      id: "relay",
      group: "load",
      icon: `<rect x="4" y="3" width="10" height="12" /><path d="M1 6h3M1 12h3M14 9h3M17 9l8-5M25 4h4M25 14h4" />`,
      label: "Реле",
      title: "Реле: катушка включает контакты COM–NO, отключает COM–NC",
      settings: { kind: "5V" as RelayKind },
      name: () => "Реле",
      note: () =>
        `<p class="sub">Катушка — электромагнит: ток через неё притягивает якорь, и контакт COM переключается с NC на NO. Катушка и контакты не связаны электрически — слабой цепью можно включать сильную. Стоит на столе, пять клемм подключаются проводами.</p>`,
      editor: (s) => kindSelect(s.kind),
      set(s, field, value) {
        if (field === "relayKind") s.kind = value as RelayKind;
      },
      create: (s) => ({ type: "relay", kind: s.kind }),
      hint: () => "Нажмите на стол рядом с платой. Клеммы слева направо: катушка, катушка, COM, NO, NC. R — повернуть.",
      boardRefusal: "Реле стоит на столе, как на модуле: клеммы подключаются проводами.",
    }),
  ],
  polar: () => false,
  noFlip: true,
  label: (c) => `реле ${RELAYS[c.kind].label}`,
  value: (c) => RELAYS[c.kind].label,
  pinLabels: RELAY_PINS,
  // По ГОСТ катушка и контакты рисуются отдельно, контакты — в обесточенном состоянии
  schematicParts: (c, sim) => [
    {
      key: "",
      pins: [0, 1],
      symbol: `<path d="M0 -20V-6M0 6V20"/><rect x="-9" y="-6" width="18" height="12"/>`,
      value: `${RELAYS[c.kind].label}, катушка`,
      current: sim.branch(`${c.id}:coil`).current,
    },
    {
      key: "contacts",
      pins: [2, 3, 4],
      symbol3: {
        roles: { up: 3, ctrl: 4, down: 2 },
        body:
          `<path d="M8 -17V-8M8 17V8M-9 0H-4V-8"/><path d="M8 8L-4 -7"/>` +
          `<circle cx="8" cy="-8" r="1.8" class="dot"/><circle cx="-4" cy="-8" r="1.8" class="dot"/><circle cx="8" cy="8" r="1.8" class="dot"/>`,
        ctrlX: -9,
      },
      value: relayOn(c, sim) ? "COM–NO" : "COM–NC",
      current: Math.max(Math.abs(sim.branch(`${c.id}:no`).current), Math.abs(sim.branch(`${c.id}:nc`).current)),
    },
  ],
  burn: (c) => [
    `Реле ${c.id} вышло из строя`,
    `Либо на катушке больше ${formatSI(RELAYS[c.kind].volts * COIL_MAX, "В")} (реле на ${formatSI(RELAYS[c.kind].volts, "В")}), либо через контакты больше ${RELAY_CONTACT_A} А.`,
  ],
  view: relayView,

  stamp(c, sim, { out }) {
    const [a1, a2, com, no, nc] = ([0, 1, 2, 3, 4] as const).map((p) => pinNode(c, p));
    const burned = sim.state(c.id).burned;
    const on = relayOn(c, sim);
    out.push({ id: `${c.id}:coil`, a: a1, b: a2, r: burned ? Infinity : RELAYS[c.kind].coil });
    out.push({ id: `${c.id}:no`, a: com, b: no, r: on ? RELAY_CONTACT_R : Infinity });
    out.push({ id: `${c.id}:nc`, a: com, b: nc, r: burned || on ? Infinity : RELAY_CONTACT_R });
  },
  // Якорь двигается между шагами по времени (5 мс; у настоящего реле — до 10 мс): с гистерезисом
  dynamic: true,
  remember(c, sim) {
    const v = coilVolts(c, sim);
    const spec = RELAYS[c.kind];
    const on = relayOn(c, sim);
    if (!on && v >= spec.pullIn) sim.memory.set(c.id, { on: true });
    else if (on && v < spec.dropOut) sim.memory.set(c.id, { on: false });
  },
  voltage: (c, sim) => sim.branch(`${c.id}:coil`).voltage * -1,
  current: (c, sim) => sim.branch(`${c.id}:coil`).current,
  power: (c, sim) => sim.branch(`${c.id}:coil`).power + sim.branch(`${c.id}:no`).power + sim.branch(`${c.id}:nc`).power,
  load(c, sim) {
    const spec = RELAYS[c.kind];
    const byCoil = coilVolts(c, sim) / (spec.volts * COIL_MAX);
    const byContacts = Math.max(Math.abs(sim.branch(`${c.id}:no`).current), Math.abs(sim.branch(`${c.id}:nc`).current)) / RELAY_CONTACT_A;
    return byCoil >= byContacts
      ? { ratio: byCoil, what: "напряжение", limit: `${formatSI(spec.volts * COIL_MAX, "В")} на катушке` }
      : { ratio: byContacts, what: "ток", limit: `${RELAY_CONTACT_A} А через контакты` };
  },
  // Катушка массивная и греется медленно: при 9 В на реле 5 В выходит из строя примерно за минуту
  thermal: { threshold: 1, rate: 0.05, cooling: 0.05 },
  visual: (c, sim) => ({ pressed: relayOn(c, sim) }),

  panel(c, sim) {
    const spec = RELAYS[c.kind];
    return {
      title: `Реле ${spec.label}`,
      body: `${kv("Катушка", `${formatSI(spec.volts, "В")}, ${formatOhms(spec.coil)}, ${formatSI(spec.volts / spec.coil, "А")}`)}
        ${kv("Срабатывает / отпускает", `≥ ${formatSI(spec.pullIn, "В")} / < ${formatSI(spec.dropOut, "В")}`)}
        ${kv("Контакты", relayOn(c, sim) ? "COM замкнут с NO" : "COM замкнут с NC")}
        <p class="sub">Катушка — электромагнит: при напряжении от ${formatSI(spec.pullIn, "В")} якорь притягивается, и COM переключается с NC на NO. Отпускает, только когда напряжение упадёт ниже ${formatSI(spec.dropOut, "В")}: между этими значениями реле остаётся, как было. Катушка берёт ${formatSI(spec.volts / spec.coil, "А")} — больше, чем даёт вывод микроконтроллера, поэтому её включают транзистором. Параллельно катушке ставят диод (катодом к плюсу): в момент выключения катушка даёт выброс напряжения. В симуляторе индуктивность катушки не учитывается, но на настоящей макетке без диода транзистор может пробить.</p>`,
      editor: kindSelect(c.kind),
    };
  },
  edit(c, field, value) {
    if (field === "relayKind") c.kind = value as RelayKind;
  },
  readout: (c, sim) =>
    readout(coilVolts(c, sim), Math.abs(sim.current(c)), sim.power(c), ["Контакт", relayOn(c, sim) ? "NO" : "NC"]),
  status: (c, sim) => (relayOn(c, sim) ? pill("ok", "СРАБОТАЛО — COM↔NO") : pill("warn", "ОТПУЩЕНО — COM↔NC")),
};

function kindSelect(kind: RelayKind): string {
  return selectField(
    "relayKind",
    "Катушка",
    (Object.keys(RELAYS) as RelayKind[]).map((k) => [k, `${RELAYS[k].label}: ${formatSI(RELAYS[k].volts, "В")}, ${formatOhms(RELAYS[k].coil)}`]),
    kind,
  );
}

// ─── 3D: реле на колодке с клеммами ─────────────────────────────────────────

/** Синий корпус 19 × 15,5 × 15 мм на колодке с пятью винтовыми клеммами и светодиодом «сработало». */
function relayView(c: Relay): ComponentView {
  if (c.placement.mode !== "free") throw new Error("Реле стоит только на столе");
  const group = new THREE.Group();
  const baseW = mm(34), baseH = mm(1.6), baseD = mm(26);
  const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, baseH, baseD), new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.6 }));
  base.position.y = baseH / 2;
  group.add(base);
  const W = mm(19), H = mm(15.5), D = mm(15);
  const blue = new THREE.MeshStandardMaterial({ color: 0x2f5fd1, roughness: 0.45 });
  const label = new THREE.MeshStandardMaterial({ map: labelTexture([RELAYS[c.kind].label.replace("VDC", ""), "10A 250VAC · 10A 30VDC"], "#2f5fd1", "#e9eef9"), roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [blue, blue, label, blue, blue, blue]);
  body.position.set(-mm(4), baseH + H / 2, -mm(3));
  group.add(body);
  // Светодиод «сработало»
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x5a1a14, emissive: new THREE.Color(0xff3b2b), emissiveIntensity: 0, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.BoxGeometry(mm(2), mm(1), mm(1.2)), ledMat);
  led.position.set(mm(10), baseH + mm(0.5), -mm(6));
  group.add(led);
  // Клеммы: катушка (две слева), COM, NO, NC
  const pins: THREE.Vector3[] = [];
  const terminalMat = new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.5 });
  const screwMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.3 });
  for (let i = 0; i < 5; i++) {
    const x = -mm(13.5) + i * mm(6.6) + (i >= 2 ? mm(1.2) : 0);
    const block = new THREE.Mesh(new THREE.BoxGeometry(mm(6), mm(7), mm(7)), terminalMat);
    block.position.set(x, baseH + mm(3.5), mm(8.5));
    group.add(block);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(mm(1.5), mm(1.5), mm(0.8), 16), screwMat);
    screw.position.set(x, baseH + mm(7.3), mm(8.5));
    group.add(screw);
    pins.push(new THREE.Vector3(x, baseH + mm(3.5), mm(12.3)));
  }
  group.position.set(c.placement.x, 0, c.placement.z);
  group.rotation.y = c.placement.rot;
  tagPickable(group, c.id);
  return {
    group,
    pins: pins.map((p) => freeTransform(c, p)),
    hotspot: freeTransform(c, new THREE.Vector3(0, baseH + H, 0)),
    update(v) {
      ledMat.emissiveIntensity = v.pressed ? 2.2 : 0;
    },
    dispose: () => disposeGroup(group),
  };
}
