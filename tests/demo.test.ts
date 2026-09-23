import { describe, expect, it } from "vitest";
import { demoScene, ledDemoScene } from "../src/demo";
import { Simulation } from "../src/sim/simulation";

describe("пример схемы", () => {
  it("HL1 горит почти в номинал, R1 в пределах 0,25 Вт, ветвь 2 обесточена", () => {
    const scene = demoScene();
    const sim = new Simulation(scene);
    const byId = (id: string) => scene.components.find((c) => c.id === id)!;
    expect(sim.overload(byId("HL1"))).toBeGreaterThan(0.9);
    expect(sim.overload(byId("HL1"))).toBeLessThan(1.3);
    expect(sim.overload(byId("R1"))).toBeLessThan(1);
    expect(sim.branch("R2").current).toBeCloseTo(0, 12);
  });

  it("если замкнуть SA2, R2 22 Ом перегружен, а 68 Ом — нет", () => {
    const scene = demoScene();
    const sim = new Simulation(scene);
    const sa2 = scene.components.find((c) => c.id === "SA2")!;
    const r2 = scene.components.find((c) => c.id === "R2")!;
    if (sa2.type !== "switch" || r2.type !== "resistor") throw new Error("demo изменился");
    sa2.closed = true;
    sim.solve();
    expect(sim.overload(r2)).toBeGreaterThan(1.3);
    expect(sim.overload(scene.components.find((c) => c.id === "R1")!)).toBeLessThan(1);
    r2.ohms = 68;
    sim.solve();
    expect(sim.overload(r2)).toBeLessThan(1);
  });
});

describe("пример «Конденсатор и светодиоды»", () => {
  it("HL1 и HL2 горят, перевёрнутый HL3 — нет; после переворота HL3 горит как HL2", () => {
    const scene = ledDemoScene();
    const sim = new Simulation(scene);
    for (let i = 0; i < 60; i++) sim.step(0.05); // C1 успевает зарядиться
    const c = (id: string) => scene.components.find((x) => x.id === id)!;
    expect(sim.current(c("HL1"))).toBeGreaterThan(0.01);
    expect(sim.current(c("HL2"))).toBeGreaterThan(0.012);
    expect(sim.current(c("HL2"))).toBeLessThan(0.02);
    expect(Math.abs(sim.current(c("HL3")))).toBeLessThan(1e-9);
    expect(sim.isReversed(c("HL3"))).toBe(true);
    const hl3 = c("HL3");
    if (hl3.placement.mode !== "board") throw new Error("demo изменился");
    hl3.placement.holes = [hl3.placement.holes[1], hl3.placement.holes[0]];
    sim.solve();
    expect(sim.current(hl3)).toBeCloseTo(sim.current(c("HL2")), 4);
    // Ни одна деталь не перегружена
    for (const x of scene.components) expect(sim.state(x.id).burned).toBe(false);
  });

  it("если разомкнуть SA1, HL1 гаснет за несколько секунд, а не мгновенно", () => {
    const scene = ledDemoScene();
    const sim = new Simulation(scene);
    for (let i = 0; i < 60; i++) sim.step(0.05);
    const sa1 = scene.components.find((x) => x.id === "SA1")!;
    const hl1 = scene.components.find((x) => x.id === "HL1")!;
    if (sa1.type !== "switch") throw new Error("demo изменился");
    sa1.closed = false;
    sim.solve();
    for (let i = 0; i < 20; i++) sim.step(0.05); // 1 с
    expect(sim.current(hl1)).toBeGreaterThan(0.004);
    for (let i = 0; i < 100; i++) sim.step(0.05); // ещё 5 с
    expect(sim.current(hl1)).toBeLessThan(0.002);
  });
});
