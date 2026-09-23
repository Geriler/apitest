import { describe, expect, it } from "vitest";
import { demoScene } from "../src/demo";
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
