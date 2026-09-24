import { beforeEach, describe, expect, it } from "vitest";
import { chipsUsed, setLibrary } from "../src/chips/registry";
import { chipInner, dipSize, packageChip, packageProblems } from "../src/chips/package";
import { countChip, countChips, countDetails, countParts, countShort } from "../src/chips/count";
import { HOLE_BY_ID, applyBoards, chipPinAt, holeLabel, newChipBoard, type BoardSpec, type ChipPinRole } from "../src/model/breadboard";
import { boardConflicts, mosfetPin, type Chip, type ChipDef, type Component, type Endpoint, type Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { schematicSvg } from "../src/view/schematic";
import { dropUnknownParts } from "../src/parts";

const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });
const on = (...holes: string[]) => ({ mode: "board" as const, holes });
const pin = (comp: string, p: number): Endpoint => ({ comp, pin: p });
const hole = (id: string): Endpoint => ({ hole: id });
/** Резистор на столе или (holes) в площадках корпуса. */
const R = (id: string, ohms: number, ...holes: string[]): Component => ({
  id,
  type: "resistor",
  variant: "tht",
  ohms,
  smdSize: "0805",
  placement: holes.length ? on(...holes) : free(),
});
/** Корпус DIP-pins; spec — назначение и имя выводов (номера с 1), остальные NC. */
function box(pins: number, spec: Record<number, ChipPinRole | [ChipPinRole, string]>, id = "K1"): BoardSpec {
  const b = newChipBoard(pins, 0, 0, id);
  for (const [n, v] of Object.entries(spec)) {
    const [role, name] = Array.isArray(v) ? v : [v, ""];
    b.roles![Number(n) - 1] = role;
    b.names![Number(n) - 1] = name;
  }
  return b;
}
const scene = (components: Component[], wires: [Endpoint, Endpoint][], boards: BoardSpec[] = [], traces: [string, string][] = [], chips?: Record<string, ChipDef>): Scene => {
  applyBoards(boards);
  return {
    components,
    wires: wires.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
    boards,
    traces: traces.map(([a, b], i) => ({ id: `T${i}`, a, b })),
    ...(chips ? { chips } : {}),
  };
};
const bat = (): Component => ({ id: "GB1", type: "battery", kind: "9V", placement: free() });
const chipOf = (id: string, def: ChipDef, placement: Component["placement"] = free()): Chip => ({ id, type: "chip", def: def.id, name: def.name, pins: def.pins, placement });
const volts = (sim: Simulation, c: Component, p: number) => sim.solution.voltage.get(pinNode(c, p))!;

beforeEach(() => setLibrary([]));

/**
 * Делитель 10 кОм / 10 кОм на корпусе DIP-4: вывод 1 VCC, 2 OUT (MID), 3 GND.
 * Батарея — обвязка на столе, подключена проводами к выводам 1 и 3.
 */
function divider(): ChipDef {
  const inner = scene(
    [bat(), R("R1", 10_000, "k:A1", "k:A2"), R("R2", 10_000, "k:C1", "k:C2")],
    [
      [pin("GB1", 1), hole("k:1")],
      [pin("GB1", 0), hole("k:3")],
    ],
    [box(4, { 1: "vcc", 2: ["out", "MID"], 3: "gnd" })],
    [
      ["k:1", "k:A1"],
      ["k:A2", "k:C1"],
      ["k:2", "k:A2"],
      ["k:C2", "k:3"],
    ],
  );
  expect(packageProblems(inner)).toEqual([]);
  // Обвязка работает и до упаковки: на выводе 2 — половина
  const sim = new Simulation(inner);
  const v = (id: string) => sim.solution.voltage.get(HOLE_BY_ID.get(id)!.node)!;
  expect((v("k:2") - v("k:3")) / (v("k:1") - v("k:3"))).toBeCloseTo(0.5, 6);
  // На схеме — флажки назначенных выводов, неподключённого нет
  const svg = schematicSvg(inner, sim);
  for (const t of ["1 VCC", "2 MID", "3 GND"]) expect(svg).toContain(t);
  expect(svg).not.toMatch(/4 NC|NaN|undefined/);
  return packageChip(inner, "Делитель", "div", 1);
}

describe("корпус своей микросхемы", () => {
  it("выводы на местах настоящего DIP: 1…N/2 по ближнему краю слева направо, остальные обратно по дальнему", () => {
    const b = box(8, {});
    applyBoards([b]);
    const at = (n: number) => chipPinAt(b, n - 1);
    expect(at(1).x).toBeLessThan(at(4).x);
    expect(at(1).z).toBe(at(4).z);
    expect(at(5).x).toBe(at(4).x);
    expect(at(8).x).toBe(at(1).x);
    expect(at(5).z).toBeLessThan(at(1).z);
    // Площадки выводов — отверстия корпуса с номером; поле — между рядами выводов
    expect(HOLE_BY_ID.get("k:1")!.pin).toBe(1);
    expect(HOLE_BY_ID.get("k:A1")!.z).toBeGreaterThan(at(8).z);
    expect(HOLE_BY_ID.get("k:H1")!.z).toBeLessThan(at(1).z);
    expect(holeLabel("k:3")).toBe("вывод 3 NC");
    b.roles![2] = "vcc";
    applyBoards([b]);
    expect(holeLabel("k:3")).toBe("вывод 3 VCC");
    expect(holeLabel("k:B5")).toBe("корпус, площадка B5");
  });

  it("сменить корпус: провода к выводам остаются на своих номерах; к пропавшим выводам — мешают", () => {
    const small = box(4, { 1: "in" });
    const sc = scene([bat()], [[pin("GB1", 0), hole("k:3")]], [small]);
    expect(boardConflicts(sc, [box(8, { 1: "in" })])).toEqual([]);
    const big = scene([bat()], [[pin("GB1", 0), hole("k:7")]], [box(8, { 1: "in" })]);
    expect(boardConflicts(big, [box(4, { 1: "in" })])).toEqual(["W0"]);
  });
});

describe("свои микросхемы", () => {
  it("упаковка: начинка — то, что на корпусе; выводы — по назначению; обвязка не входит", () => {
    const d = divider();
    expect(d.pins).toBe(4);
    expect(d.pinNames).toEqual(["", "MID", "", "NC"]);
    expect(d.pinRoles).toEqual(["vcc", "out", "gnd", "nc"]);
    expect(d.parts.map((c) => c.id).sort()).toEqual(["R1", "R2"]);
    expect(d.parts.every((c) => c.placement.mode === "free")).toBe(true);
    expect(d.nets.find((n) => n.pins?.includes(2))!.members.sort()).toEqual([["R1", 1], ["R2", 0]]);
  });

  it("место в корпусе: 2 клетки на вывод; девять резисторов в DIP-4 не лезут, в DIP-6 — да; реле и электролит не лезут никуда", () => {
    const rs = (p: string) => Array.from({ length: 9 }, (_, i) => R(`R${i + 1}`, 1000, `${p}${"ABCDEFGH"[i % 8]}${1 + 2 * Math.floor(i / 8)}`, `${p}${"ABCDEFGH"[i % 8]}${2 + 2 * Math.floor(i / 8)}`));
    const small = scene(rs("k:"), [], [box(4, { 1: "in", 2: "out" })]);
    expect(packageProblems(small).join()).toMatch(/Не помещается в DIP-4: начинка занимает 9 клеток из 8/);
    const bigger = scene(rs("k:"), [], [box(6, { 1: "in", 6: "out" })]);
    expect(packageProblems(bigger)).toEqual([]);
    expect(packageChip(bigger, "R", "r", 1).space).toBe(9);
    // Резистор на столе — не начинка
    expect(chipInner(scene([...rs("k:"), R("R99", 1)], [], [box(6, { 1: "in" })])).length).toBe(9);
    const big = scene(
      [
        { id: "K1", type: "relay", kind: "5V", placement: on("k:A1", "k:A2", "k:A3", "k:A4", "k:A5") },
        { id: "C1", type: "capacitor", variant: "electrolytic", uF: 10, placement: on("k:C1", "k:C2") },
        { id: "C2", type: "capacitor", variant: "ceramic", uF: 0.1, placement: on("k:D1", "k:D2") },
        { id: "SB1", type: "button", placement: on("k:E1", "k:E2") },
      ],
      [],
      [box(8, { 1: "in", 8: "out" })],
    );
    const why = packageProblems(big).join(" ");
    expect(why).toMatch(/K1 не может быть внутри: реле/);
    expect(why).toMatch(/C1 не может быть внутри/);
    expect(why).toMatch(/SB1 не может быть внутри/);
    expect(why).not.toMatch(/C2/);
  });

  it("что мешает упаковать: нет корпуса, два корпуса, пусто, ничего не назначено, начинка на NC, обвязка мимо выводов", () => {
    expect(packageProblems(scene([R("R1", 1)], []))[0]).toMatch(/Нет корпуса/);
    const two = scene([R("R1", 1, "k:A1", "k:A2")], [], [box(4, { 1: "in" }), { ...box(4, { 1: "in" }, "K2"), x: 40 }]);
    expect(packageProblems(two).join()).toMatch(/Корпус должен быть один, а их 2/);
    expect(packageProblems(scene([R("R1", 1)], [], [box(4, { 1: "in" })])).join()).toMatch(/На корпусе нет ни одной детали/);
    expect(packageProblems(scene([R("R1", 1, "k:A1", "k:A2")], [], [box(4, {})])).join()).toMatch(/Ни одному выводу не назначено/);
    // Выводы 2 и 3 соединены дорожками с резистором, но назначены «не подключён»
    const nc = scene([R("R1", 1, "k:A1", "k:A2")], [], [box(4, { 1: "in" })], [["k:2", "k:A1"], ["k:3", "k:A2"]]);
    expect(packageProblems(nc).join()).toMatch(/Выводы 2, 3 подключены к начинке, но назначены «не подключён»/);
    // Батарея подключена прямо к площадке поля — мимо выводов
    const leak = scene([bat(), R("R1", 1000, "k:A1", "k:A2")], [[pin("GB1", 1), hole("k:A1")], [pin("GB1", 0), hole("k:1")]], [box(4, { 1: "gnd" })], [["k:1", "k:A2"]]);
    expect(packageProblems(leak).join()).toMatch(/Начинка соединена с GB1 не через выводы корпуса/);
    // Щуп прибора внутри корпуса — можно
    const probe = scene(
      [{ id: "P1", type: "meter", mode: "V", placement: free() } as Component, R("R1", 1000, "k:A1", "k:A2")],
      [[pin("P1", 1), hole("k:A1")]],
      [box(4, { 1: "gnd" })],
      [["k:1", "k:A2"]],
    );
    expect(packageProblems(probe)).toEqual([]);
    expect(dipSize(scene([], [], [box(8, {})]))).toBe(8);
    expect(dipSize(scene([], []))).toBe(0);
  });

  it("в схеме микросхема работает как её начинка: делитель даёт половину", () => {
    const d = divider();
    const u = chipOf("D1", d);
    const sc = scene([bat(), u], [[pin("GB1", 1), pin("D1", 0)], [pin("GB1", 0), pin("D1", 2)]], [], [], { [d.id]: d });
    const sim = new Simulation(sc);
    const top = volts(sim, u, 0), mid = volts(sim, u, 1), low = volts(sim, u, 2);
    expect((mid - low) / (top - low)).toBeCloseTo(0.5, 9);
    const svg = schematicSvg(sc, sim);
    expect(svg).toContain("2 MID");
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it("сгорела деталь внутри — вышла из строя эта микросхема, соседняя цела; «Заменить» чинит начинку", () => {
    const hot = scene([R("R1", 22, "k:A1", "k:A2")], [], [box(4, { 1: "in", 2: "out" })], [["k:1", "k:A1"], ["k:2", "k:A2"]]);
    const d = packageChip(hot, "22 Ом", "hot", 1);
    const [a, b] = [chipOf("D1", d), chipOf("D2", d)];
    const sc = scene([bat(), a, b], [[pin("GB1", 1), pin("D1", 0)], [pin("GB1", 0), pin("D1", 1)]], [], [], { [d.id]: d });
    const sim = new Simulation(sc);
    const failed: string[] = [];
    for (let t = 0; t < 3; t += 0.05) failed.push(...sim.step(0.05).map((c) => c.id));
    expect(failed).toContain("D1/R1");
    expect(sim.state("D1").burned).toBe(true);
    expect(sim.state("D2").burned).toBe(false);
    sim.repair("D1");
    expect(sim.state("D1").burned).toBe(false);
    expect(sim.state("D1/R1").burned).toBe(false);
  });

  it("вложенная микросхема: делитель, поставленный на корпус другой микросхемы, работает; описания собираются рекурсивно", () => {
    const d = divider();
    // Делитель DIP-4 на поле корпуса DIP-4: выводы 1–2 в ряду D, 3–4 обратно в ряду A
    const inner = scene(
      [chipOf("D1", d, on("k:D1", "k:D2", "k:A2", "k:A1"))],
      [],
      [box(4, { 1: "vcc", 2: "out", 3: "gnd" })],
      [["k:1", "k:D1"], ["k:2", "k:D2"], ["k:3", "k:A2"]],
      { [d.id]: d },
    );
    expect(packageProblems(inner)).toEqual([]);
    const outer = packageChip(inner, "Обёртка", "wrap", 2);
    expect(Object.keys(outer.scene.chips ?? {})).toEqual(["div"]);
    const u = chipOf("D9", outer);
    const sc = scene([bat(), u], [[pin("GB1", 1), pin("D9", 0)], [pin("GB1", 0), pin("D9", 2)]], [], [], { wrap: outer, div: d });
    expect(Object.keys(chipsUsed(sc)).sort()).toEqual(["div", "wrap"]);
    const sim = new Simulation(sc);
    expect((volts(sim, u, 1) - volts(sim, u, 2)) / (volts(sim, u, 0) - volts(sim, u, 2))).toBeCloseTo(0.5, 9);
    expect(sim.state("D9/D1/R2").burned).toBe(false);
  });

  it("КМОП-вентиль И-НЕ (NAND) из четырёх MOSFET на корпусе DIP-6: таблица истинности на выводах", () => {
    // Два p-канальных BS250 параллельно (VCC → Y), два n-канальных 2N7000 последовательно (Y → GND)
    const kinds = { VT1: "BS250", VT2: "BS250", VT3: "2N7000", VT4: "2N7000" } as const;
    const rows = { VT1: "A", VT2: "C", VT3: "E", VT4: "G" } as const;
    type Id = keyof typeof kinds;
    const m = (id: Id): Component => ({ id, type: "mosfet", kind: kinds[id], placement: on(...[1, 2, 3].map((c) => `k:${rows[id]}${c}`)) });
    const at = (id: Id, r: "G" | "D" | "S") => `k:${rows[id]}${mosfetPin(kinds[id], r) + 1}`;
    const inner = scene(
      (Object.keys(kinds) as Id[]).map(m),
      [],
      [box(6, { 1: ["in", "A"], 2: ["in", "B"], 3: "gnd", 4: ["out", "Y"], 5: "vcc" })],
      [
        ["k:5", at("VT1", "S")],
        ["k:5", at("VT2", "S")],
        ["k:4", at("VT1", "D")],
        ["k:4", at("VT2", "D")],
        ["k:4", at("VT3", "D")],
        [at("VT3", "S"), at("VT4", "D")],
        [at("VT4", "S"), "k:3"],
        ["k:1", at("VT1", "G")],
        ["k:1", at("VT3", "G")],
        ["k:2", at("VT2", "G")],
        ["k:2", at("VT4", "G")],
      ],
    );
    expect(packageProblems(inner)).toEqual([]);
    const d = packageChip(inner, "Мой NAND", "nand", 1);
    expect(d.pins).toBe(6);
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      const u = chipOf("D1", d);
      // Питание 5 В от блока питания; входы — перемычками на VCC или GND; выход — через 100 кОм на GND
      const sc = scene(
        [{ id: "G1", type: "psu", volts: 5, amps: 0.5, on: true, placement: free() }, u, R("RL", 100_000)],
        [
          [pin("G1", 1), pin("D1", 4)],
          [pin("G1", 0), pin("D1", 2)],
          [pin("D1", 0), a ? pin("G1", 1) : pin("G1", 0)],
          [pin("D1", 1), b ? pin("G1", 1) : pin("G1", 0)],
          [pin("D1", 3), pin("RL", 0)],
          [pin("RL", 1), pin("G1", 0)],
        ],
        [],
        [],
        { [d.id]: d },
      );
      const sim = new Simulation(sc);
      for (let t = 0; t < 0.3; t += 0.05) sim.step(0.05);
      const y = volts(sim, u, 3) - volts(sim, u, 2);
      if (a && b) expect(y, `A=${a} B=${b}`).toBeLessThan(0.5);
      else expect(y, `A=${a} B=${b}`).toBeGreaterThan(4.5);
    }
  });

  it("состав: 4 MOSFET — «4 транзистора»; RTL-вариант — «3 детали, из них 2 транзистора»; из двух NAND — 8 транзисторов «по кусочкам»", () => {
    const m = (id: string, kind: "2N7000" | "BS250", row: string): Component => ({ id, type: "mosfet", kind, placement: on(`k:${row}1`, `k:${row}2`, `k:${row}3`) });
    const cmos = packageChip(
      scene([m("VT1", "BS250", "A"), m("VT2", "BS250", "C"), m("VT3", "2N7000", "E"), m("VT4", "2N7000", "G")], [], [box(4, { 1: "in", 2: "out" })]),
      "Мой NAND",
      "nand4",
      1,
    );
    const k = countChip(cmos, scene([], []));
    expect(countShort(k)).toBe("4 транзистора");
    expect(countDetails(k)).toBe("2 × 2N7000, 2 × BS250");
    const bjt = (id: string, row: string): Component => ({ id, type: "transistor", kind: "BC547", placement: on(`k:${row}1`, `k:${row}2`, `k:${row}3`) });
    const rtl = packageChip(scene([bjt("VT1", "A"), bjt("VT2", "C"), R("R1", 1000, "k:E1", "k:E2")], [], [box(4, { 1: "in", 2: "out" })]), "RTL", "rtl", 1);
    expect(countShort(countChip(rtl, scene([], [])))).toBe("3 детали, из них 2 транзистора");
    // Триггер из двух своих NAND: считаем по кусочкам
    const latch = scene(
      [chipOf("D1", cmos, on("k:D1", "k:D2", "k:A2", "k:A1")), chipOf("D2", cmos, on("k:H1", "k:H2", "k:E2", "k:E1"))],
      [],
      [box(4, { 1: "in", 2: "out" })],
      [],
      { [cmos.id]: cmos },
    );
    const kl = countParts(chipInner(latch), latch);
    expect(countShort(kl)).toBe("8 транзисторов");
    expect(countChips(kl)).toBe("2 × Мой NAND");
    const packed = packageChip(latch, "Триггер", "latch", 2);
    expect(countShort(countChip(packed, scene([], [])))).toBe("8 транзисторов");
    // Обвязка (батарея) не считается
    expect(countParts([bat(), R("R1", 1)], scene([], [])).total).toBe(1);
  });
});

describe("схемы из старых версий", () => {
  it("деталь, которой больше нет (старый «Корпус»), убирается вместе с проводами; расчёт не падает", () => {
    const sc = scene(
      [{ id: "X1", type: "chipcase", placement: free() } as unknown as Component, R("R1", 1000), bat()],
      [[pin("X1", 0), pin("R1", 0)], [pin("GB1", 1), pin("R1", 0)], [pin("GB1", 0), pin("R1", 1)]],
    );
    expect(dropUnknownParts(sc)).toEqual(["X1"]);
    expect(sc.components.map((c) => c.id)).toEqual(["R1", "GB1"]);
    expect(sc.wires.map((w) => w.id)).toEqual(["W1", "W2"]);
    expect(Math.abs(new Simulation(sc).current(sc.components[0]))).toBeGreaterThan(0);
  });
});
