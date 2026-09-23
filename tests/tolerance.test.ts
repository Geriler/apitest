import { describe, expect, it } from "vitest";
import { blinkerScene, demoScene } from "../src/demo";
import type { Component } from "../src/model/types";
import { Simulation, diodeParams, VT } from "../src/sim/simulation";
import * as tol from "../src/sim/tolerance";

const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const on = (seed: number): tol.Tolerance => ({ enabled: true, seed });

describe("отклонения", () => {
  it("выключенный режим — ровно номиналы", () => {
    const r: Component = { id: "R1", type: "resistor", variant: "tht", ohms: 220, smdSize: "0805", placement: free };
    if (r.type !== "resistor") throw new Error();
    expect(tol.resistance(r, tol.NO_TOLERANCE)).toBe(220);
    expect(tol.deviation(tol.NO_TOLERANCE, "R1", "R")).toBe(0);
  });

  it("повторяемы: тот же seed и id — то же значение; другой seed — другое", () => {
    expect(tol.deviation(on(7), "R1", "R")).toBe(tol.deviation(on(7), "R1", "R"));
    expect(tol.deviation(on(7), "R1", "R")).not.toBe(tol.deviation(on(8), "R1", "R"));
    expect(tol.deviation(on(7), "R1", "R")).not.toBe(tol.deviation(on(7), "R2", "R"));
  });

  it("распределены по всему диапазону [−1, 1] примерно равномерно", () => {
    const xs = Array.from({ length: 4000 }, (_, i) => tol.deviation(on(1), `R${i}`, "R"));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    // Каждая десятая часть диапазона получает 8–12 % значений
    for (let k = 0; k < 10; k++) {
      const share = xs.filter((x) => x >= -1 + k * 0.2 && x < -1 + (k + 1) * 0.2).length / xs.length;
      expect(share).toBeGreaterThan(0.08);
      expect(share).toBeLessThan(0.12);
    }
  });

  it("все параметры в пределах допусков для сотен деталей", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const t = on(seed);
      const r = tol.resistance({ id: "R1", type: "resistor", variant: "tht", ohms: 1000, smdSize: "0805", placement: free }, t);
      expect(r).toBeGreaterThanOrEqual(950);
      expect(r).toBeLessThanOrEqual(1050);
      const c = tol.capacitance({ id: "C1", type: "capacitor", variant: "electrolytic", uF: 100, placement: free }, t);
      expect(c).toBeGreaterThanOrEqual(80e-6);
      expect(c).toBeLessThanOrEqual(120e-6);
      const beta = tol.betaF({ id: "VT1", type: "transistor", kind: "BC547", placement: free }, t);
      expect(beta).toBeGreaterThanOrEqual(200);
      expect(beta).toBeLessThanOrEqual(450);
      const fet = tol.mosfetParams({ id: "VT2", type: "mosfet", kind: "2N7000", placement: free }, t);
      expect(fet.vth).toBeGreaterThanOrEqual(0.8);
      expect(fet.vth).toBeLessThanOrEqual(3);
      const vf = tol.ledVf({ id: "HL1", type: "led", color: "red", placement: free }, t);
      expect(vf).toBeGreaterThanOrEqual(1.85);
      expect(vf).toBeLessThanOrEqual(2.15);
    }
  });

  it("1N4007: множитель тока насыщения 2^±1 меняет падение на ±n·Vt·ln 2 ≈ 32 мВ", () => {
    const d: Component = { id: "VD1", type: "diode", placement: free };
    const vAt = (is: number) => 1.808 * VT * Math.log(0.01 / is);
    const nominal = vAt(diodeParams(d).is);
    for (let seed = 1; seed <= 100; seed++) {
      const v = vAt(diodeParams(d, on(seed)).is);
      expect(Math.abs(v - nominal)).toBeLessThanOrEqual(1.808 * VT * Math.LN2 + 1e-12);
    }
  });
});

describe("симуляция с допусками", () => {
  it("включение меняет токи, выключение возвращает номинальные", () => {
    const scene = demoScene();
    const sim = new Simulation(scene);
    const hl1 = scene.components.find((c) => c.id === "HL1")!;
    const nominal = sim.current(hl1);
    sim.tolerance = on(42);
    sim.solve();
    const real = sim.current(hl1);
    expect(real).not.toBeCloseTo(nominal, 6);
    expect(Math.abs(real / nominal - 1)).toBeLessThan(0.2);
    sim.tolerance = { ...sim.tolerance, enabled: false };
    sim.solve();
    expect(sim.current(hl1)).toBe(nominal);
    sim.tolerance = on(42);
    sim.solve();
    expect(sim.current(hl1)).toBe(real);
  });

  it("мигалка мигает при любых экземплярах деталей, период 0,69·R·C с учётом допусков", () => {
    const periods: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const scene = blinkerScene();
      const sim = new Simulation(scene, on(seed));
      const hl1 = scene.components.find((c) => c.id === "HL1")!;
      let prev: boolean | undefined;
      const edges: number[] = [];
      for (let t = 0; t < 6; t += 0.01) {
        sim.step(0.01);
        const lit = sim.current(hl1) > 0.005;
        if (prev !== undefined && lit && !prev) edges.push(t);
        prev = lit;
      }
      expect(edges.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(sim.nonConverged, `seed ${seed}`).toBe(0);
      const p = (edges.at(-1)! - edges[0]) / (edges.length - 1);
      periods.push(p);
      // Оценка периода по фактическим R и C этого набора: 0,69·(R2·C2 + R4·C1)
      const get = (id: string) => scene.components.find((c) => c.id === id)!;
      const R = (id: string) => tol.resistance(get(id) as Extract<Component, { type: "resistor" }>, on(seed));
      const C = (id: string) => tol.capacitance(get(id) as Extract<Component, { type: "capacitor" }>, on(seed));
      const estimate = 0.69 * (R("R2") * C("C2") + R("R4") * C("C1"));
      expect(p / estimate, `seed ${seed}`).toBeGreaterThan(0.85);
      expect(p / estimate, `seed ${seed}`).toBeLessThan(1.15);
    }
    // Разброс периода заметный, как у настоящих мигалок
    expect(Math.max(...periods) - Math.min(...periods)).toBeGreaterThan(0.15);
    console.log(`периоды мигалки при 20 наборах деталей: ${Math.min(...periods).toFixed(2)}–${Math.max(...periods).toFixed(2)} с`);
  }, 60_000);
});
