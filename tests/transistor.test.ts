import { describe, expect, it } from "vitest";
import type { Component, Endpoint, Scene, Transistor, TransistorKind } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";

const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const R = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: { ...free } });
const Q = (id: string, kind: TransistorKind = "BC547"): Transistor => ({ id, type: "transistor", kind, placement: { ...free } });
const pin = (comp: string, p: 0 | 1 | 2): Endpoint => ({ comp, pin: p });
/** «+» и «−» батареи GB1 (9 В). */
const PLUS = pin("GB1", 1);
const MINUS = pin("GB1", 0);
const C = 0,
  B = 1,
  E = 2;

/** Установившийся режим: у транзистора есть ёмкости переходов, при включении им нужно зарядиться. */
function settled(scene: Scene): Simulation {
  const sim = new Simulation(scene);
  for (let i = 0; i < 20; i++) sim.step(0.01);
  return sim;
}

function circuit(parts: Component[], nets: [Endpoint, Endpoint][]): Scene {
  return {
    components: [{ id: "GB1", type: "battery", kind: "9V", placement: { ...free } }, ...parts],
    wires: nets.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
  };
}

describe("транзистор BC547 (n-p-n)", () => {
  it("ключ: ток базы 0,83 мА насыщает транзистор, Uкэ < 0,2 В", () => {
    const q = Q("VT1");
    const scene = circuit(
      [q, R("Rb", 10_000), R("Rc", 1000)],
      [
        [PLUS, pin("Rb", 0)],
        [pin("Rb", 1), pin("VT1", B)],
        [PLUS, pin("Rc", 0)],
        [pin("Rc", 1), pin("VT1", C)],
        [pin("VT1", E), MINUS],
      ],
    );
    const sim = settled(scene);
    const t = sim.transistor(q);
    expect(t.mode).toBe("насыщение");
    expect(t.vce).toBeLessThan(0.2);
    expect(t.ib).toBeGreaterThan(0.8e-3);
    expect(t.ib).toBeLessThan(0.86e-3);
    // Ток коллектора ограничен резистором: (9 − Uкэ)/(1000 + 1,5 + провода)
    expect(t.ic).toBeCloseTo((9 - 1.5 * (t.ic + t.ib) - t.vce) / 1000, 4);
    // Закон Кирхгофа: ток эмиттера = ток базы + ток коллектора = ток в проводе эмиттера
    expect(Math.abs(sim.branch("W4").current)).toBeCloseTo(t.ie, 9);
  });

  it("усиление: Iк/Iб ≈ β = 300, транзистор в активном режиме", () => {
    const q = Q("VT1");
    const scene = circuit(
      [q, R("Rb", 1_000_000), R("Rc", 1000)],
      [
        [PLUS, pin("Rb", 0)],
        [pin("Rb", 1), pin("VT1", B)],
        [PLUS, pin("Rc", 0)],
        [pin("Rc", 1), pin("VT1", C)],
        [pin("VT1", E), MINUS],
      ],
    );
    const sim = settled(scene);
    const t = sim.transistor(q);
    expect(t.mode).toBe("усиление");
    expect(t.ib).toBeCloseTo((9 - t.vbe) / 1e6, 8);
    expect(t.ic / t.ib).toBeGreaterThan(295);
    expect(t.ic / t.ib).toBeLessThan(301);
    expect(t.ic).toBeGreaterThan(2.3e-3);
    expect(t.ic).toBeLessThan(2.6e-3);
    expect(t.vbe).toBeGreaterThan(0.5);
    expect(t.vbe).toBeLessThan(0.7);
  });

  it("база ни к чему не подключена — транзистор закрыт", () => {
    const q = Q("VT1");
    const scene = circuit(
      [q, R("Rc", 1000)],
      [
        [PLUS, pin("Rc", 0)],
        [pin("Rc", 1), pin("VT1", C)],
        [pin("VT1", E), MINUS],
      ],
    );
    const sim = settled(scene);
    // Практически закрыт: в тысячу раз меньше тока, при котором светится светодиод. Остаток —
    // дозарядка ёмкости база–коллектор (в модели она завышена до 10 нФ ради сходимости).
    expect(Math.abs(sim.transistor(q).ic)).toBeLessThan(1e-5);
    expect(sim.transistor(q).mode).toBe("отсечка");
  });

  it("коллектор и эмиттер перепутаны — инверсный режим, усиление ≈ βR = 8", () => {
    const q = Q("VT1");
    const scene = circuit(
      [q, R("Rb", 1_000_000), R("Rc", 1000)],
      [
        [PLUS, pin("Rb", 0)],
        [pin("Rb", 1), pin("VT1", B)],
        [PLUS, pin("Rc", 0)],
        [pin("Rc", 1), pin("VT1", E)], // эмиттер вместо коллектора
        [pin("VT1", C), MINUS],
      ],
    );
    const sim = settled(scene);
    const t = sim.transistor(q);
    expect(t.mode).toBe("инверсный");
    expect(sim.isReversed(q)).toBe(true);
    // В инверсном режиме «коллектором» работает эмиттер; ток через Rc ≈ (βR) · Iб
    const irc = sim.branch("W3").current;
    expect(Math.abs(irc) / t.ib).toBeGreaterThan(6);
    expect(Math.abs(irc) / t.ib).toBeLessThan(9);
  });

  it("перегрузка по току: без резистора в коллекторе транзистор сгорает", () => {
    const q = Q("VT1");
    const scene = circuit(
      [q, R("Rb", 1000)],
      [
        [PLUS, pin("Rb", 0)],
        [pin("Rb", 1), pin("VT1", B)],
        [PLUS, pin("VT1", C)],
        [pin("VT1", E), MINUS],
      ],
    );
    const sim = new Simulation(scene);
    expect(sim.overload(q)).toBeGreaterThan(2);
    let failed: string[] = [];
    for (let t = 0; t < 5 && !failed.length; t += 0.05) failed = sim.step(0.05).map((c) => c.id);
    expect(failed).toContain("VT1");
  });
});

describe("транзистор BC557 (p-n-p)", () => {
  it("зеркально n-p-n: эмиттер на плюсе, ток базы вытекает, β ≈ 250", () => {
    const q = Q("VT1", "BC557");
    const scene = circuit(
      [q, R("Rb", 1_000_000), R("Rc", 1000)],
      [
        [PLUS, pin("VT1", E)],
        [pin("VT1", B), pin("Rb", 0)],
        [pin("Rb", 1), MINUS],
        [pin("VT1", C), pin("Rc", 0)],
        [pin("Rc", 1), MINUS],
      ],
    );
    const sim = settled(scene);
    const t = sim.transistor(q);
    expect(t.mode).toBe("усиление");
    expect(t.ic / t.ib).toBeGreaterThan(245);
    expect(t.ic / t.ib).toBeLessThan(251);
    // Ток идёт из коллектора в Rc (вниз, к минусу)
    expect(sim.branch("W3").current).toBeGreaterThan(1.5e-3);
  });
});

describe("мигалка на двух транзисторах", () => {
  /**
   * Симметричный мультивибратор: в коллекторах — светодиоды с резисторами 470 Ом,
   * базы через 10 кОм и 12 кОм к плюсу, перекрёстные конденсаторы 100 мкФ (плюсом к коллектору).
   * Полупериоды ≈ 0,69·R·C: 0,69 с и 0,83 с.
   */
  function astable(): Scene {
    const led = (id: string): Component => ({ id, type: "led", color: "red", placement: { ...free } });
    const cap = (id: string): Component => ({ id, type: "capacitor", variant: "electrolytic", uF: 100, placement: { ...free } });
    return circuit(
      [Q("VT1"), Q("VT2"), R("Rc1", 470), R("Rc2", 470), R("Rb1", 10_000), R("Rb2", 12_000), led("HL1"), led("HL2"), cap("C1"), cap("C2")],
      [
        // Коллекторные цепи: + → Rc → светодиод → коллектор
        [PLUS, pin("Rc1", 0)],
        [pin("Rc1", 1), pin("HL1", 0)],
        [pin("HL1", 1), pin("VT1", C)],
        [PLUS, pin("Rc2", 0)],
        [pin("Rc2", 1), pin("HL2", 0)],
        [pin("HL2", 1), pin("VT2", C)],
        // Базовые резисторы
        [PLUS, pin("Rb1", 0)],
        [pin("Rb1", 1), pin("VT1", B)],
        [PLUS, pin("Rb2", 0)],
        [pin("Rb2", 1), pin("VT2", B)],
        // Перекрёстные конденсаторы: + к коллектору, − к базе другого транзистора
        [pin("VT1", C), pin("C1", 0)],
        [pin("C1", 1), pin("VT2", B)],
        [pin("VT2", C), pin("C2", 0)],
        [pin("C2", 1), pin("VT1", B)],
        // Эмиттеры на минус
        [pin("VT1", E), MINUS],
        [pin("VT2", E), MINUS],
      ],
    );
  }

  it("светодиоды мигают по очереди с периодом около 1,5 с", () => {
    const scene = astable();
    const sim = new Simulation(scene);
    const hl1 = scene.components.find((c) => c.id === "HL1")!;
    const hl2 = scene.components.find((c) => c.id === "HL2")!;
    const dt = 0.01;
    let prev: boolean | undefined;
    const edges: number[] = [];
    let both = 0;
    for (let t = 0; t < 8; t += dt) {
      sim.step(dt);
      const on1 = sim.current(hl1) > 0.005;
      const on2 = sim.current(hl2) > 0.005;
      if (t > 1 && on1 && on2) both++;
      if (prev !== undefined && on1 && !prev) edges.push(t);
      prev = on1;
    }
    // Включений HL1 за 8 с — несколько, а не одно
    expect(edges.length).toBeGreaterThanOrEqual(4);
    const periods = edges.slice(1).map((t, i) => t - edges[i]);
    const avg = periods.reduce((a, b) => a + b, 0) / periods.length;
    expect(avg).toBeGreaterThan(1.2);
    expect(avg).toBeLessThan(1.8);
    // Горят по очереди. Одновременно — только короткое «послесвечение» после переключения:
    // конденсатор перезаряжается через коллекторный резистор и светодиод (τ ≈ 470 Ом · 100 мкФ ≈ 50 мс).
    expect((both * dt) / 7).toBeLessThan(0.15);
    for (const c of scene.components) expect(sim.state(c.id).burned).toBe(false);
    // Каждое решение сошлось — иначе переключения считаются неверно
    expect(sim.nonConverged).toBe(0);
  });
});
