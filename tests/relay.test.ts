import { describe, expect, it } from "vitest";
import type { Component, Endpoint, Relay, Scene } from "../src/model/types";
import { relayOn } from "../src/parts/relay";
import { Simulation } from "../src/sim/simulation";

const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });
const pin = (comp: string, p: 0 | 1 | 2 | 3 | 4): Endpoint => ({ comp, pin: p });
const scene = (components: Component[], nets: [Endpoint, Endpoint][]): Scene => ({
  components,
  wires: nets.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
  boards: [],
});
const run = (sim: Simulation, s: number) => {
  for (let t = 0; t < s - 1e-9; t += 0.05) sim.step(0.05);
};

/** Катушка — от блока питания (напряжение задаём), контакты переключают две лампы от батареи. */
function bench(volts: number, kind: "5V" | "12V" = "5V") {
  const k: Relay = { id: "K1", type: "relay", kind, placement: free() };
  const sc = scene(
    [
      { id: "G1", type: "psu", volts, amps: 1, on: true, placement: free() },
      k,
      { id: "GB1", type: "battery", kind: "9V", placement: free() },
      { id: "HL1", type: "lamp", kind: "12V", placement: free() },
      { id: "HL2", type: "lamp", kind: "12V", placement: free() },
    ],
    [
      [pin("G1", 1), pin("K1", 0)],
      [pin("K1", 1), pin("G1", 0)],
      [pin("GB1", 1), pin("K1", 2)],
      [pin("K1", 3), pin("HL1", 0)],
      [pin("K1", 4), pin("HL2", 0)],
      [pin("HL1", 1), pin("GB1", 0)],
      [pin("HL2", 1), pin("GB1", 0)],
    ],
  );
  return { k, sc, sim: new Simulation(sc), psu: sc.components[0] as Extract<Component, { type: "psu" }> };
}
const lamps = (sim: Simulation, sc: Scene) => [sim.current(sc.components[3]), sim.current(sc.components[4])];

describe("реле", () => {
  it("без тока в катушке COM замкнут с NC: горит лампа на NC", () => {
    const { sc, sim, k } = bench(0);
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(false);
    const [no, nc] = lamps(sim, sc);
    expect(Math.abs(no)).toBeLessThan(1e-9);
    expect(nc).toBeGreaterThan(0.05);
  });

  it("5 В на катушке: срабатывает, COM переключается на NO; ток катушки 5 В / 70 Ом", () => {
    const { sc, sim, k } = bench(5);
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(true);
    const [no, nc] = lamps(sim, sc);
    expect(no).toBeGreaterThan(0.05);
    expect(Math.abs(nc)).toBeLessThan(1e-9);
    expect(sim.current(k)).toBeCloseTo(5 / 70, 3);
  });

  it("гистерезис: 3 В не хватает, чтобы сработать, но хватает, чтобы держать; отпускает ниже 0,5 В", () => {
    const { sim, k, psu } = bench(3);
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(false);
    psu.volts = 4; // ≥ 3,75 В — срабатывает
    sim.solve();
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(true);
    psu.volts = 1; // между 0,5 и 3,75 В — держит
    sim.solve();
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(true);
    psu.volts = 0.3; // ниже 0,5 В — отпускает
    sim.solve();
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(false);
  });

  it("транзистор включает реле 12 В от 12-вольтового блока по сигналу на базе", () => {
    const k: Relay = { id: "K1", type: "relay", kind: "12V", placement: free() };
    const sw: Component = { id: "SA1", type: "switch", closed: false, placement: free() };
    const sc = scene(
      [
        { id: "G1", type: "psu", volts: 12, amps: 1, on: true, placement: free() },
        k,
        { id: "VT1", type: "transistor", kind: "BC547", placement: free() },
        { id: "R1", type: "resistor", variant: "tht", ohms: 10_000, smdSize: "0805", placement: free() },
        sw,
      ],
      [
        [pin("G1", 1), pin("K1", 0)],
        [pin("K1", 1), pin("VT1", 0)], // коллектор
        [pin("VT1", 2), pin("G1", 0)], // эмиттер
        [pin("G1", 1), pin("SA1", 0)],
        [pin("SA1", 1), pin("R1", 0)],
        [pin("R1", 1), pin("VT1", 1)], // база
      ],
    );
    const sim = new Simulation(sc);
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(false);
    (sw as { closed: boolean }).closed = true;
    sim.solve();
    run(sim, 0.2);
    expect(relayOn(k, sim)).toBe(true);
    expect(sim.current(k)).toBeGreaterThan(0.025);
  });

  it("12 В на реле 5 В: катушка перегревается и через полминуты реле выходит из строя", () => {
    const { sim, k } = bench(12);
    run(sim, 5);
    expect(sim.state("K1").burned).toBe(false);
    run(sim, 30);
    expect(sim.state("K1").burned).toBe(true);
    expect(relayOn(k, sim)).toBe(false);
  });
});
