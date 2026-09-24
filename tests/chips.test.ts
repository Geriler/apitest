import { describe, expect, it } from "vitest";
import { chipsUsed, setLibrary } from "../src/chips/registry";
import { dipSize, packageChip, packageProblems } from "../src/chips/package";
import { countChip, countChips, countDetails, countParts, countShort } from "../src/chips/count";
import { mosfetPin, type Chip, type ChipDef, type ChipPin, type ChipPinRole, type Component, type Endpoint, type Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { schematicSvg } from "../src/view/schematic";

const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });
const pin = (comp: string, p: number): Endpoint => ({ comp, pin: p });
const R = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free() });
const P = (id: string, number: number, role: ChipPinRole, name = ""): ChipPin => ({ id, type: "chippin", number, role, name, placement: free() });
const scene = (components: Component[], nets: [Endpoint, Endpoint][], chips?: Record<string, ChipDef>): Scene => ({
  components,
  wires: nets.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
  boards: [],
  ...(chips ? { chips } : {}),
});
const bat = (): Component => ({ id: "GB1", type: "battery", kind: "9V", placement: free() });
const chipOf = (id: string, def: ChipDef): Chip => ({ id, type: "chip", def: def.id, name: def.name, pins: def.pins, placement: free() });
const volts = (sim: Simulation, c: Component, p: number) => sim.solution.voltage.get(pinNode(c, p))!;

setLibrary([]);

/** Делитель 10 кОм / 10 кОм: вывод 1 VCC, 2 OUT, 3 GND; батарея — обвязка, в микросхему не входит. */
function divider(): ChipDef {
  const inner = scene(
    [bat(), R("R1", 10_000), R("R2", 10_000), P("X1", 1, "vcc"), P("X2", 2, "out", "MID"), P("X3", 3, "gnd")],
    [
      [pin("GB1", 1), pin("R1", 0)],
      [pin("R1", 1), pin("R2", 0)],
      [pin("R2", 1), pin("GB1", 0)],
      [pin("X1", 0), pin("R1", 0)],
      [pin("X2", 0), pin("R1", 1)],
      [pin("X3", 0), pin("R2", 1)],
    ],
  );
  expect(packageProblems(inner)).toEqual([]);
  return packageChip(inner, "Делитель", "div", 1);
}

describe("свои микросхемы", () => {
  it("упаковка: выводы по меткам, DIP-4, батарея не входит, начинка — две цепи-резистора", () => {
    const d = divider();
    expect(d.pins).toBe(4);
    expect(d.pinNames).toEqual(["", "MID", "", "NC"]);
    expect(d.pinRoles).toEqual(["vcc", "out", "gnd", "nc"]);
    expect(d.parts.map((c) => c.id).sort()).toEqual(["R1", "R2"]);
    expect(d.parts.every((c) => c.placement.mode === "free")).toBe(true);
    expect(d.nets.find((n) => n.pins?.includes(2))!.members.sort()).toEqual([["R1", 1], ["R2", 0]]);
  });

  it("место в корпусе: 2 клетки на вывод; девять резисторов в DIP-4 не лезут, в DIP-6 — да; реле и электролит не лезут никуда", () => {
    const rs = Array.from({ length: 9 }, (_, i) => R(`R${i + 1}`, 1000));
    const small = scene([...rs, P("X1", 1, "in"), P("X2", 2, "out")], []);
    expect(dipSize(small)).toBe(4);
    expect(packageProblems(small).join()).toMatch(/Не помещается в DIP-4: начинка занимает 9 клеток из 8/);
    const bigger = scene([...rs, P("X1", 1, "in"), P("X2", 6, "out")], []);
    expect(packageProblems(bigger)).toEqual([]);
    expect(packageChip(bigger, "R", "r", 1).space).toBe(9);
    // Реле, лампа, электролит, кнопка в DIP физически не помещаются; керамика — да
    const big = scene(
      [
        { id: "K1", type: "relay", kind: "5V", placement: free() },
        { id: "C1", type: "capacitor", variant: "electrolytic", uF: 10, placement: free() },
        { id: "C2", type: "capacitor", variant: "ceramic", uF: 0.1, placement: free() },
        { id: "SB1", type: "button", placement: free() },
        P("X1", 1, "in"),
        P("X2", 8, "out"),
      ],
      [],
    );
    const why = packageProblems(big).join(" ");
    expect(why).toMatch(/K1 не может быть внутри: реле/);
    expect(why).toMatch(/C1 не может быть внутри/);
    expect(why).toMatch(/SB1 не может быть внутри/);
    expect(why).not.toMatch(/C2/);
  });

  it("что мешает упаковать: нет выводов, одинаковые номера, больше 16", () => {
    expect(packageProblems(scene([R("R1", 1)], []))[0]).toMatch(/Нет ни одного вывода/);
    expect(packageProblems(scene([R("R1", 1), P("X1", 2, "in"), P("X2", 2, "out")], [])).join()).toMatch(/Номер 2 у двух/);
    expect(dipSize(scene([P("X1", 7, "in")], []))).toBe(8);
    expect(packageProblems(scene([R("R1", 1), P("X1", 17, "in")], [])).join()).toMatch(/не больше 16/);
  });

  it("в схеме микросхема работает как её начинка: делитель даёт половину", () => {
    const d = divider();
    const u = chipOf("D1", d);
    const sc = scene([bat(), u], [[pin("GB1", 1), pin("D1", 0)], [pin("GB1", 0), pin("D1", 2)]], { [d.id]: d });
    const sim = new Simulation(sc);
    const top = volts(sim, u, 0), mid = volts(sim, u, 1), low = volts(sim, u, 2);
    expect((mid - low) / (top - low)).toBeCloseTo(0.5, 9);
    // Схема: прямоугольник с подписями выводов, без NaN
    const svg = schematicSvg(sc, sim);
    expect(svg).toContain("2 MID");
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it("сгорела деталь внутри — вышла из строя эта микросхема, соседняя цела; «Заменить» чинит начинку", () => {
    const hot = scene([R("R1", 22), P("X1", 1, "in"), P("X2", 2, "out")], [[pin("X1", 0), pin("R1", 0)], [pin("X2", 0), pin("R1", 1)]]);
    const d = packageChip(hot, "22 Ом", "hot", 1);
    const [a, b] = [chipOf("D1", d), chipOf("D2", d)];
    const sc = scene([bat(), a, b], [[pin("GB1", 1), pin("D1", 0)], [pin("GB1", 0), pin("D1", 1)]], { [d.id]: d });
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

  it("вложенная микросхема: делитель внутри другой микросхемы работает; описания собираются рекурсивно", () => {
    const d = divider();
    const inner = scene(
      [chipOf("D1", d), P("X1", 1, "vcc"), P("X2", 2, "out"), P("X3", 3, "gnd")],
      [[pin("X1", 0), pin("D1", 0)], [pin("X2", 0), pin("D1", 1)], [pin("X3", 0), pin("D1", 2)]],
      { [d.id]: d },
    );
    const outer = packageChip(inner, "Обёртка", "wrap", 2);
    expect(Object.keys(outer.scene.chips ?? {})).toEqual(["div"]);
    const u = chipOf("D9", outer);
    const sc = scene([bat(), u], [[pin("GB1", 1), pin("D9", 0)], [pin("GB1", 0), pin("D9", 2)]], { wrap: outer, div: d });
    expect(Object.keys(chipsUsed(sc)).sort()).toEqual(["div", "wrap"]);
    const sim = new Simulation(sc);
    expect((volts(sim, u, 1) - volts(sim, u, 2)) / (volts(sim, u, 0) - volts(sim, u, 2))).toBeCloseTo(0.5, 9);
    expect(sim.state("D9/D1/R2").burned).toBe(false);
  });

  it("КМОП-вентиль И-НЕ (NAND) из четырёх MOSFET, упакованный в DIP: таблица истинности на выводах", () => {
    // Два p-канальных BS250 параллельно (VCC → Y), два n-канальных 2N7000 последовательно (Y → GND)
    const m = (id: string, kind: "2N7000" | "BS250"): Component => ({ id, type: "mosfet", kind, placement: free() });
    const g = (id: string, k: "2N7000" | "BS250", r: "G" | "D" | "S") => pin(id, mosfetPin(k, r));
    const inner = scene(
      [m("VT1", "BS250"), m("VT2", "BS250"), m("VT3", "2N7000"), m("VT4", "2N7000"), P("X1", 1, "in", "A"), P("X2", 2, "in", "B"), P("X3", 3, "gnd"), P("X4", 4, "out", "Y"), P("X5", 5, "vcc")],
      [
        [g("VT1", "BS250", "S"), pin("X5", 0)],
        [g("VT2", "BS250", "S"), pin("X5", 0)],
        [g("VT1", "BS250", "D"), pin("X4", 0)],
        [g("VT2", "BS250", "D"), pin("X4", 0)],
        [g("VT3", "2N7000", "D"), pin("X4", 0)],
        [g("VT3", "2N7000", "S"), g("VT4", "2N7000", "D")],
        [g("VT4", "2N7000", "S"), pin("X3", 0)],
        [g("VT1", "BS250", "G"), pin("X1", 0)],
        [g("VT3", "2N7000", "G"), pin("X1", 0)],
        [g("VT2", "BS250", "G"), pin("X2", 0)],
        [g("VT4", "2N7000", "G"), pin("X2", 0)],
      ],
    );
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
    const m = (id: string, kind: "2N7000" | "BS250"): Component => ({ id, type: "mosfet", kind, placement: free() });
    const cmos = packageChip(
      scene([m("VT1", "BS250"), m("VT2", "BS250"), m("VT3", "2N7000"), m("VT4", "2N7000"), P("X1", 1, "in"), P("X2", 2, "out")], []),
      "Мой NAND",
      "nand4",
      1,
    );
    const k = countChip(cmos, scene([], []));
    expect(countShort(k)).toBe("4 транзистора");
    expect(countDetails(k)).toBe("2 × 2N7000, 2 × BS250");
    const bjt = (id: string): Component => ({ id, type: "transistor", kind: "BC547", placement: free() });
    const rtl = packageChip(scene([bjt("VT1"), bjt("VT2"), R("R1", 1000), P("X1", 1, "in"), P("X2", 2, "out")], []), "RTL", "rtl", 1);
    expect(countShort(countChip(rtl, scene([], [])))).toBe("3 детали, из них 2 транзистора");
    // Триггер из двух своих NAND: считаем по кусочкам
    const latch = scene([chipOf("D1", cmos), chipOf("D2", cmos), P("X1", 1, "in"), P("X2", 2, "out")], [], { [cmos.id]: cmos });
    const kl = countParts(latch.components, latch);
    expect(countShort(kl)).toBe("8 транзисторов");
    expect(countChips(kl)).toBe("2 × Мой NAND");
    const packed = packageChip(latch, "Триггер", "latch", 2);
    expect(countShort(countChip(packed, scene([], [])))).toBe("8 транзисторов");
    // Обвязка (батарея) и сами выводы не считаются
    expect(countParts([bat(), P("X9", 1, "in"), R("R1", 1)], scene([], [])).total).toBe(1);
  });
});
