import { describe, expect, it } from "vitest";
import { HOLES, HOLE_BY_ID, PCB, holeAt, padsAlong } from "../src/model/breadboard";
import type { Component, Endpoint, PowerSupply, Scene } from "../src/model/types";
import { Simulation, traceResistance, wireResistance } from "../src/sim/simulation";

const free = { mode: "free" as const, x: -30, z: 0, rot: 0 };
const pin = (comp: string, p: 0 | 1 | 2): Endpoint => ({ comp, pin: p });

describe("печатная плата", () => {
  it("24 × 14 площадок, у каждой свой узел, лежат на плате толщиной 1,6 мм", () => {
    const pads = HOLES.filter((h) => h.kind === "pad");
    expect(pads).toHaveLength(24 * 14);
    expect(new Set(pads.map((p) => p.node)).size).toBe(pads.length);
    expect(pads.every((p) => p.board === "pcb" && Math.abs(p.y - 1.6 / 2.54) < 1e-9)).toBe(true);
    // Шаг 2,54 мм = 1 единица
    expect(HOLE_BY_ID.get("pA2")!.x - HOLE_BY_ID.get("pA1")!.x).toBeCloseTo(1, 12);
    expect(HOLE_BY_ID.get("pB1")!.z - HOLE_BY_ID.get("pA1")!.z).toBeCloseTo(1, 12);
    // Плата не пересекается с макеткой (макетка до z = 10,5)
    expect(PCB.z - PCB.depth / 2).toBeGreaterThan(10.5);
    expect(holeAt("pcb", HOLE_BY_ID.get("pC3")!.x + 1, HOLE_BY_ID.get("pC3")!.z)?.id).toBe("pC4");
  });

  it("дорожка через площадки делится в каждой: A1 → A5 проходит A2, A3, A4; диагональ — по диагональным", () => {
    expect(padsAlong("pA1", "pA5")).toEqual(["pA1", "pA2", "pA3", "pA4", "pA5"]);
    expect(padsAlong("pA1", "pD4")).toEqual(["pA1", "pB2", "pC3", "pD4"]);
    // Ход конём не задевает соседние площадки: их центры дальше радиуса площадки
    expect(padsAlong("pA1", "pB3")).toEqual(["pA1", "pB3"]);
  });

  it("сопротивление дорожки шириной с площадку: 25,4 мм × 0,269 мОм/мм ≈ 6,8 мОм", () => {
    expect(traceResistance("pA1", "pA11") * 1000).toBeCloseTo(25.4 * 0.2687, 2);
  });

  it("сопротивление провода по длине: 22 AWG ≈ 53 мОм/м", () => {
    // Между отверстиями a1 и a30 29 шагов = 73,7 мм, плюс подъём концов 2 × 7 шагов (потолок) = 35,6 мм
    const scene: Scene = { components: [], wires: [] };
    const r = wireResistance(scene, { a: { hole: "a1" }, b: { hole: "a30" } });
    expect(r * 1000).toBeCloseTo((29 + 2 * 7) * 2.54 * 0.0528, 1);
  });

  function pcbCircuit(withTraces: boolean): Scene {
    return {
      components: [
        { id: "GB1", type: "battery", kind: "9V", placement: free },
        { id: "R1", type: "resistor", variant: "tht", ohms: 1000, smdSize: "0805", placement: { mode: "board", holes: ["pA5", "pA9"] } },
      ],
      wires: [
        { id: "W1", a: pin("GB1", 1), b: { hole: "pA1" }, color: "" },
        { id: "W2", a: pin("GB1", 0), b: { hole: "pD9" }, color: "" },
      ],
      traces: withTraces
        ? [
            { id: "T1", a: "pA1", b: "pA5" },
            { id: "T2", a: "pA9", b: "pD9" },
          ]
        : [],
    };
  }

  it("ток идёт по дорожкам: батарея → дорожка → резистор → дорожка → батарея", () => {
    const scene = pcbCircuit(true);
    const sim = new Simulation(scene);
    const rTraces = traceResistance("pA1", "pA5") + traceResistance("pA9", "pD9");
    const rWires = scene.wires.reduce((sum, w) => sum + wireResistance(scene, w), 0);
    const expected = 9 / (1000 + 1.5 + rWires + rTraces);
    expect(sim.branch("R1").current).toBeCloseTo(expected, 9);
    expect(Math.abs(sim.branch("T1").current)).toBeCloseTo(expected, 9);
  });

  it("без дорожек площадки не соединены — тока нет", () => {
    const sim = new Simulation(pcbCircuit(false));
    expect(sim.branch("R1").current).toBe(0);
  });
});

describe("лабораторный источник питания", () => {
  function psuCircuit(psu: Partial<PowerSupply>, load: Component | "short"): { scene: Scene; sim: Simulation; p: PowerSupply } {
    const p: PowerSupply = { id: "G1", type: "psu", volts: 12, amps: 1, on: true, placement: free, ...psu };
    const scene: Scene =
      load === "short"
        ? { components: [p], wires: [{ id: "W1", a: pin("G1", 1), b: pin("G1", 0), color: "" }] }
        : {
            components: [p, load],
            wires: [
              { id: "W1", a: pin("G1", 1), b: pin(load.id, 0), color: "" },
              { id: "W2", a: pin(load.id, 1), b: pin("G1", 0), color: "" },
            ],
          };
    return { scene, sim: new Simulation(scene), p };
  }
  const R = (ohms: number): Component => ({ id: "R1", type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free });

  it("CV: 12 В на 100 Ом — 120 мА, напряжение держится", () => {
    const { sim, p, scene } = psuCircuit({ volts: 12, amps: 1 }, R(100));
    expect(sim.psuMode.get(p.id) ?? "CV").toBe("CV");
    const rWires = scene.wires.reduce((sum, w) => sum + wireResistance(scene, w), 0);
    expect(sim.branch("R1").current).toBeCloseTo(12 / (100 + 0.005 + rWires), 9);
  });

  it("CC: ограничение 50 мА — ток 50 мА, напряжение падает до 5 В", () => {
    const { sim, p } = psuCircuit({ volts: 12, amps: 0.05 }, R(100));
    expect(sim.psuMode.get(p.id)).toBe("CC");
    expect(sim.branch("R1").current).toBeCloseTo(0.05, 6);
    expect(Math.abs(sim.branch("R1").voltage)).toBeCloseTo(5, 3);
  });

  it("короткое замыкание не страшно: ток ограничен уставкой", () => {
    const { sim, p, scene } = psuCircuit({ volts: 5, amps: 0.5 }, "short");
    expect(sim.psuMode.get(p.id)).toBe("CC");
    expect(sim.current(p)).toBeCloseTo(0.5, 6);
    expect(sim.isShorted(scene.components[0])).toBe(false);
  });

  it("выключенный выход — тока нет", () => {
    const { sim } = psuCircuit({ on: false }, R(100));
    expect(sim.branch("R1").current).toBe(0);
  });

  it("светодиод без резистора выживает, если ограничить ток 20 мА", () => {
    const led: Component = { id: "R1", type: "led", color: "red", placement: free };
    const { sim, p } = psuCircuit({ volts: 12, amps: 0.02 }, led);
    expect(sim.psuMode.get(p.id)).toBe("CC");
    expect(sim.current(led)).toBeCloseTo(0.02, 6);
    for (let i = 0; i < 100; i++) sim.step(0.05);
    expect(sim.state("R1").burned).toBe(false);
  });

  it("при изменении нагрузки блок сам переходит из CC обратно в CV", () => {
    const load = R(10);
    const { sim, p, scene } = psuCircuit({ volts: 12, amps: 0.5 }, load);
    expect(sim.psuMode.get(p.id)).toBe("CC"); // 12 В / 10 Ом = 1,2 А > 0,5 А
    (scene.components[1] as { ohms: number }).ohms = 1000;
    sim.solve();
    expect(sim.psuMode.get(p.id)).toBe("CV");
    expect(sim.branch("R1").current).toBeCloseTo(12 / 1000, 5);
  });
});
