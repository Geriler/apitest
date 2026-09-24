import { describe, expect, it } from "vitest";
import type { Component, Endpoint, Potentiometer, Scene } from "../src/model/types";
import { POT_TOLERANCE, potOhms } from "../src/parts/pot";
import { Simulation, pinNode } from "../src/sim/simulation";
import * as tolerance from "../src/sim/tolerance";

const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });
const pin = (comp: string, p: 0 | 1 | 2): Endpoint => ({ comp, pin: p });
const bat = (): Component => ({ id: "GB1", type: "battery", kind: "9V", placement: free() });
const scene = (components: Component[], nets: [Endpoint, Endpoint][]): Scene => ({
  components,
  wires: nets.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
  boards: [],
});

describe("кнопка без фиксации", () => {
  it("лампа горит, только пока кнопку держат; нажатие не попадает в схему", () => {
    const sc = scene(
      [bat(), { id: "SB1", type: "button", placement: free() }, { id: "HL1", type: "lamp", kind: "6.3V", placement: free() }],
      [
        [pin("GB1", 1), pin("SB1", 0)],
        [pin("SB1", 1), pin("HL1", 0)],
        [pin("HL1", 1), pin("GB1", 0)],
      ],
    );
    const sim = new Simulation(sc);
    const lamp = sc.components[2];
    expect(Math.abs(sim.current(lamp))).toBeLessThan(1e-9);
    sim.held.add("SB1");
    sim.solve();
    expect(sim.current(lamp)).toBeGreaterThan(0.1);
    sim.held.delete("SB1");
    sim.solve();
    expect(Math.abs(sim.current(lamp))).toBeLessThan(1e-9);
    expect(JSON.stringify(sc)).not.toMatch(/held|pressed/);
    // Удалённая кнопка не остаётся «нажатой»
    sim.held.add("SB1");
    sc.components.splice(1, 1);
    sc.wires = sc.wires.filter((w) => !JSON.stringify(w).includes("SB1"));
    sim.solve();
    expect(sim.held.has("SB1")).toBe(false);
  });
});

describe("потенциометр", () => {
  const potScene = (position: number, ohms = 10_000) => {
    const p: Potentiometer = { id: "R1", type: "pot", ohms, position, placement: free() };
    return { p, sc: scene([bat(), p], [[pin("GB1", 1), pin("R1", 0)], [pin("R1", 2), pin("GB1", 0)]]) };
  };

  it("делитель без нагрузки: на движке (относительно вывода 3) — доля (1 − положение) от напряжения на дорожке", () => {
    for (const x of [0.1, 0.25, 0.5, 0.9]) {
      const { p, sc } = potScene(x);
      const sim = new Simulation(sc);
      const v = (k: 0 | 1 | 2) => sim.solution.voltage.get(pinNode(p, k))!;
      expect((v(1) - v(2)) / (v(0) - v(2))).toBeCloseTo(1 - x, 6);
      // Ток — через всю дорожку, как у резистора 10 кОм
      const b = tolerance.battery(sc.components[0] as never, sim.tolerance);
      expect(sim.current(p)).toBeCloseTo(b.emf / (10_000 + b.rInt), 7);
    }
  });

  it("реостат: батарея между краем и движком у самого края — маленький кусок дорожки сгорает", () => {
    const p: Potentiometer = { id: "R1", type: "pot", ohms: 1000, position: 0.02, placement: free() };
    const sc = scene([bat(), p], [[pin("GB1", 1), pin("R1", 0)], [pin("R1", 1), pin("GB1", 0)]]);
    const sim = new Simulation(sc);
    expect(sim.overload(p)).toBeGreaterThan(10);
    for (let t = 0; t < 1; t += 0.05) sim.step(0.05);
    expect(sim.state("R1").burned).toBe(true);
    // Движок на 80 %: 9 В на 800 Ом ≈ 0,1 Вт, а этому куску положено 0,8 · 0,25 = 0,2 Вт — выдерживает
    const q: Potentiometer = { id: "R1", type: "pot", ohms: 1000, position: 0.8, placement: free() };
    const sim2 = new Simulation(scene([bat(), q], [[pin("GB1", 1), pin("R1", 0)], [pin("R1", 1), pin("GB1", 0)]]));
    expect(sim2.overload(q)).toBeLessThan(1);
  });

  it("допуск ±20 % в режиме допусков", () => {
    const { p } = potScene(0.5);
    const rs = Array.from({ length: 40 }, (_, seed) => potOhms(p, { enabled: true, seed }));
    for (const r of rs) expect(Math.abs(r / 10_000 - 1)).toBeLessThanOrEqual(POT_TOLERANCE + 1e-12);
    expect(new Set(rs.map((r) => Math.round(r))).size).toBeGreaterThan(30);
  });
});
