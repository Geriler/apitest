import { describe, expect, it } from "vitest";
import { blinkerScene, demoScene, ledDemoScene } from "../src/demo";
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

describe("пример «Мигалка»", () => {
  it("светодиоды на макетке мигают по очереди с периодом около 1,5 с, ничего не перегружено", () => {
    const scene = blinkerScene();
    const sim = new Simulation(scene);
    const hl1 = scene.components.find((c) => c.id === "HL1")!;
    const hl2 = scene.components.find((c) => c.id === "HL2")!;
    const dt = 0.01;
    let prev: boolean | undefined;
    const edges: number[] = [];
    let both = 0;
    let peak = 0;
    for (let t = 0; t < 8; t += dt) {
      sim.step(dt);
      const i1 = sim.current(hl1);
      peak = Math.max(peak, i1);
      const on1 = i1 > 0.005;
      const on2 = sim.current(hl2) > 0.005;
      if (t > 1 && on1 && on2) both++;
      if (prev !== undefined && on1 && !prev) edges.push(t);
      prev = on1;
    }
    expect(edges.length).toBeGreaterThanOrEqual(4);
    const periods = edges.slice(1).map((t, i) => t - edges[i]);
    const avg = periods.reduce((a, b) => a + b, 0) / periods.length;
    expect(avg).toBeGreaterThan(1.2);
    expect(avg).toBeLessThan(1.8);
    // Одновременно горят только в короткое «послесвечение» после переключения (τ ≈ 50 мс)
    expect((both * dt) / 7).toBeLessThan(0.15);
    expect(peak).toBeGreaterThan(0.012);
    expect(peak).toBeLessThan(0.02);
    for (const c of scene.components) expect(sim.state(c.id).burned).toBe(false);
    // Каждое решение сошлось — иначе переключения считаются неверно
    expect(sim.nonConverged).toBe(0);
  });

  it("в раскладке нет занятых дважды отверстий", () => {
    const scene = blinkerScene();
    const used = new Map<string, string>();
    for (const c of scene.components) {
      if (c.placement.mode !== "board") continue;
      for (const h of c.placement.holes) {
        expect(used.get(h), `${h}: ${c.id} и ${used.get(h)}`).toBeUndefined();
        used.set(h, c.id);
      }
    }
    for (const w of scene.wires) {
      for (const e of [w.a, w.b]) {
        if (!("hole" in e)) continue;
        expect(used.get(e.hole), `${e.hole}: ${w.id} и ${used.get(e.hole)}`).toBeUndefined();
        used.set(e.hole, w.id);
      }
    }
  });
});
