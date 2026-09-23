import { describe, expect, it } from "vitest";
import { solveCircuit } from "../src/sim/solver";

const battery = (id: string, minus: string, plus: string, emf: number, r = 1e-3) => ({
  id,
  a: minus,
  b: plus,
  r,
  emf,
});
const resistor = (id: string, a: string, b: string, r: number) => ({ id, a, b, r });

describe("solveCircuit", () => {
  it("закон Ома: 9 В на 1 кОм (почти идеальная батарея)", () => {
    const s = solveCircuit([battery("bat", "n0", "n1", 9), resistor("R", "n1", "n0", 1000)]);
    expect(s.branches.get("R")!.current).toBeCloseTo(9 / 1000.001, 9);
    expect(s.branches.get("R")!.power).toBeCloseTo(0.081, 4);
  });

  it("внутреннее сопротивление батареи снижает напряжение на нагрузке", () => {
    // 9 В, r = 1 Ом, нагрузка 8 Ом → I = 1 А, U = 8 В
    const s = solveCircuit([battery("bat", "m", "p", 9, 1), resistor("R", "p", "m", 8)]);
    expect(s.branches.get("R")!.current).toBeCloseTo(1, 12);
    expect(s.voltage.get("p")! - s.voltage.get("m")!).toBeCloseTo(8, 12);
    expect(s.branches.get("bat")!.current).toBeCloseTo(1, 12);
  });

  it("делитель напряжения", () => {
    const s = solveCircuit([
      battery("bat", "gnd", "vcc", 10, 1e-6),
      resistor("R1", "vcc", "mid", 3000),
      resistor("R2", "mid", "gnd", 1000),
    ]);
    expect(s.voltage.get("mid")! - s.voltage.get("gnd")!).toBeCloseTo(2.5, 5);
  });

  it("параллельные резисторы: 100 || 100 = 50 Ом", () => {
    const s = solveCircuit([
      battery("bat", "g", "v", 5, 1e-9),
      resistor("R1", "v", "g", 100),
      resistor("R2", "v", "g", 100),
    ]);
    const total = s.branches.get("R1")!.current + s.branches.get("R2")!.current;
    expect(total).toBeCloseTo(0.1, 6);
    expect(s.branches.get("bat")!.current).toBeCloseTo(0.1, 6);
  });

  it("идеальные соединения (links) сливают узлы", () => {
    // Резистор стоит в отверстиях h1, h2; батарея подключена к s1, s2 той же полосы.
    const s = solveCircuit(
      [battery("bat", "s2", "s1", 6, 1e-6), resistor("R", "h1", "h2", 60)],
      [
        ["h1", "s1"],
        ["h2", "s2"],
      ],
    );
    expect(s.branches.get("R")!.current).toBeCloseTo(0.1, 6);
    expect(s.nodeOf.get("h1")).toBe(s.nodeOf.get("s1"));
  });

  it("короткое замыкание: ток ограничен внутренним сопротивлением, система не вырождается", () => {
    const s = solveCircuit([battery("bat", "m", "p", 9, 1.5), resistor("wire", "p", "m", 0.01)]);
    expect(s.branches.get("bat")!.current).toBeCloseTo(9 / 1.51, 9);
  });

  it("выводы батареи в одном узле — ток emf/r", () => {
    const s = solveCircuit([battery("bat", "x", "y", 9, 1.5)], [["x", "y"]]);
    expect(s.branches.get("bat")!.current).toBeCloseTo(6, 12);
  });

  it("разомкнутая ветвь (r = ∞) не проводит ток", () => {
    const s = solveCircuit([
      battery("bat", "m", "p", 9, 1),
      resistor("sw", "p", "q", Infinity),
      resistor("R", "q", "m", 100),
    ]);
    expect(s.branches.get("R")!.current).toBe(0);
    expect(s.branches.get("bat")!.current).toBe(0);
    // Батарея без нагрузки показывает полную ЭДС
    expect(s.voltage.get("p")! - s.voltage.get("m")!).toBeCloseTo(9, 12);
  });

  it("несвязанные части цепи считаются независимо", () => {
    const s = solveCircuit([
      battery("b1", "a0", "a1", 3, 1e-6),
      resistor("R1", "a1", "a0", 30),
      battery("b2", "b0", "b1", 12, 1e-6),
      resistor("R2", "b1", "b0", 6),
      resistor("floating", "c0", "c1", 100), // ни к чему не подключён
    ]);
    expect(s.branches.get("R1")!.current).toBeCloseTo(0.1, 5);
    expect(s.branches.get("R2")!.current).toBeCloseTo(2, 5);
    expect(s.branches.get("floating")!.current).toBe(0);
  });

  it("мост Уитстона в равновесии: ток через диагональ ≈ 0", () => {
    const s = solveCircuit([
      battery("bat", "g", "v", 10, 1e-6),
      resistor("R1", "v", "a", 100),
      resistor("R2", "a", "g", 200),
      resistor("R3", "v", "b", 50),
      resistor("R4", "b", "g", 100),
      resistor("Rg", "a", "b", 10),
    ]);
    expect(Math.abs(s.branches.get("Rg")!.current)).toBeLessThan(1e-9);
  });

  it("мост Уитстона вне равновесия совпадает с ручным расчётом", () => {
    // Все резисторы 100 Ом, кроме R4 = 200 Ом, диагональ 100 Ом.
    // Ручное решение (узлы a, b; g = 0, v = 10):
    //  a: (a−10)/100 + a/100 + (a−b)/100 = 0 → 3a − b = 10
    //  b: (b−10)/100 + b/200 + (b−a)/100 = 0 → −2a + 5b = 20
    //  → a = 70/13, b = 80/13, I(a→b) = (a − b)/100 = −1/130 А
    const s = solveCircuit([
      battery("bat", "g", "v", 10, 1e-12),
      resistor("R1", "v", "a", 100),
      resistor("R2", "a", "g", 100),
      resistor("R3", "v", "b", 100),
      resistor("R4", "b", "g", 200),
      resistor("Rg", "a", "b", 100),
    ]);
    expect(s.voltage.get("a")).toBeCloseTo(70 / 13, 6);
    expect(s.voltage.get("b")).toBeCloseTo(80 / 13, 6);
    expect(s.branches.get("Rg")!.current).toBeCloseTo(-1 / 130, 8);
  });

  it("опорный узел — минус батареи", () => {
    const s = solveCircuit([battery("bat", "minus", "plus", 9, 1e-9), resistor("R", "plus", "minus", 9)]);
    expect(s.voltage.get("minus")).toBe(0);
    expect(s.voltage.get("plus")).toBeCloseTo(9, 6);
  });

  it("последовательно соединённые батареи складываются", () => {
    const s = solveCircuit([
      battery("b1", "g", "m", 1.5, 1e-9),
      battery("b2", "m", "p", 1.5, 1e-9),
      resistor("R", "p", "g", 30),
    ]);
    expect(s.branches.get("R")!.current).toBeCloseTo(0.1, 6);
  });

  it("отклоняет нулевое сопротивление", () => {
    expect(() => solveCircuit([resistor("R", "a", "b", 0)])).toThrow();
  });
});

describe("источники тока", () => {
  it("источник тока 1 мА через 1 кОм даёт 1 В", () => {
    const s = solveCircuit([{ id: "R", a: "n", b: "g", r: 1000 }], [], {
      currents: [{ a: "g", b: "n", j: 1e-3 }],
    });
    expect(s.voltage.get("n")! - s.voltage.get("g")!).toBeCloseTo(1, 9);
  });

  it("управляемый источник: ток g·Vупр в нагрузке", () => {
    // Управляющая цепь: 2 В на резисторе. Выход: ток 0,01·2 = 20 мА из узла o в землю через 100 Ом → −2 В.
    const s = solveCircuit(
      [
        { id: "bat", a: "g", b: "c", r: 1e-9, emf: 2 },
        { id: "Rc", a: "c", b: "g", r: 1000 },
        { id: "Rl", a: "o", b: "g", r: 100 },
      ],
      [],
      { vccs: [{ a: "o", b: "g", cp: "c", cn: "g", g: 0.01 }] },
    );
    expect(s.voltage.get("o")! - s.voltage.get("g")!).toBeCloseTo(-2, 6);
  });
});
