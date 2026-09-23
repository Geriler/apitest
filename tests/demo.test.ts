import { describe, expect, it } from "vitest";
import { blinkerScene, demoScene, ledDemoScene, mosfetScene, pcbScene, scopeScene } from "../src/demo";
import { scopeFrame } from "../src/parts/scope";
import { DEFAULT_BOARDS, applyBoards, padsAlong } from "../src/model/breadboard";
import type { Oscilloscope, Scene } from "../src/model/types";
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

describe("пример «MOSFET: ключ и память затвора»", () => {
  const find = (s: Scene, id: string) => s.components.find((c) => c.id === id)!;
  const run = (sim: Simulation, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.01) sim.step(0.01);
  };
  const toggle = (s: Scene, sim: Simulation, id: string, closed: boolean) => {
    (find(s, id) as { closed: boolean }).closed = closed;
    sim.solve();
  };

  it("SA1 включает светодиод, после размыкания резистор 100 кОм закрывает 2N7000", () => {
    const scene = mosfetScene();
    const sim = new Simulation(scene);
    run(sim, 0.3);
    expect(sim.current(find(scene, "HL1"))).toBeGreaterThan(0.012);
    toggle(scene, sim, "SA1", false);
    run(sim, 0.2);
    expect(sim.current(find(scene, "HL1"))).toBeLessThan(1e-6);
  });

  it("затвор IRLZ44N помнит заряд: лампа горит после размыкания SA2 и гаснет от SA3", () => {
    const scene = mosfetScene();
    const sim = new Simulation(scene);
    run(sim, 0.2);
    const lamp = find(scene, "HL2");
    expect(sim.current(lamp)).toBeLessThan(1e-6);
    toggle(scene, sim, "SA2", true);
    run(sim, 0.2);
    const on = sim.current(lamp);
    expect(on).toBeGreaterThan(0.07);
    toggle(scene, sim, "SA2", false);
    run(sim, 3);
    expect(sim.current(lamp)).toBeCloseTo(on, 3);
    toggle(scene, sim, "SA3", true);
    run(sim, 0.2);
    expect(sim.current(lamp)).toBeLessThan(1e-6);
    for (const c of scene.components) expect(sim.state(c.id).burned).toBe(false);
    expect(sim.nonConverged).toBe(0);
  });

  it("в раскладке нет занятых дважды отверстий", () => {
    const used = new Map<string, string>();
    const scene = mosfetScene();
    for (const c of scene.components) if (c.placement.mode === "board") for (const h of c.placement.holes) {
      expect(used.get(h), `${h}: ${c.id} и ${used.get(h)}`).toBeUndefined();
      used.set(h, c.id);
    }
    for (const w of scene.wires) for (const e of [w.a, w.b]) if ("hole" in e) {
      expect(used.get(e.hole), `${e.hole}: ${w.id} и ${used.get(e.hole)}`).toBeUndefined();
      used.set(e.hole, w.id);
    }
  });
});

describe("пример «Печатная плата и блок питания»", () => {
  it("загружается и на пустой стол (после «Очистить»): свои платы, те же дорожки", () => {
    const expected = pcbScene();
    applyBoards([]);
    let scene: Scene | undefined;
    expect(() => (scene = pcbScene())).not.toThrow();
    expect(scene!.traces).toEqual(expected.traces);
    expect(scene!.boards).toEqual(DEFAULT_BOARDS);
  });

  it("оба светодиода горят ≈ 15 мА от шин по дорожкам, блок в CV", () => {
    const scene = pcbScene();
    const sim = new Simulation(scene);
    const led = (id: string) => scene.components.find((c) => c.id === id)!;
    for (const id of ["HL1", "HL2"]) {
      expect(sim.current(led(id))).toBeGreaterThan(0.013);
      expect(sim.current(led(id))).toBeLessThan(0.016);
    }
    expect(sim.psuMode.get("G1") ?? "CV").toBe("CV");
  });

  it("ограничение 20 мА переводит блок в CC: на оба светодиода вместе 20 мА", () => {
    const scene = pcbScene();
    const g1 = scene.components.find((c) => c.id === "G1")!;
    if (g1.type !== "psu") throw new Error("demo изменился");
    g1.amps = 0.02;
    const sim = new Simulation(scene);
    expect(sim.psuMode.get("G1")).toBe("CC");
    const total = ["HL1", "HL2"].reduce((sum, id) => sum + sim.current(scene.components.find((c) => c.id === id)!), 0);
    expect(total).toBeCloseTo(0.02, 5);
  });

  it("в раскладке нет занятых дважды площадок; каждая дорожка — отрезок между соседними площадками", () => {
    const scene = pcbScene();
    const used = new Map<string, string>();
    for (const c of scene.components) if (c.placement.mode === "board") for (const h of c.placement.holes) {
      expect(used.get(h), `${h}: ${c.id} и ${used.get(h)}`).toBeUndefined();
      used.set(h, c.id);
    }
    for (const w of scene.wires) for (const e of [w.a, w.b]) if ("hole" in e) {
      expect(used.get(e.hole), `${e.hole}: ${w.id} и ${used.get(e.hole)}`).toBeUndefined();
      used.set(e.hole, w.id);
    }
    for (const t of scene.traces!) expect(padsAlong(t.a, t.b)).toEqual([t.a, t.b]);
  });
});

describe("пример «Осциллограф: как работает мигалка»", () => {
  it("на экране коллектор VT1 качается 0 ↔ 7 В, база проваливается ниже −5 В; щупы в свободных отверстиях", () => {
    const scene = scopeScene();
    applyBoards(DEFAULT_BOARDS);
    const holes = scene.components.flatMap((c) => (c.placement.mode === "board" ? c.placement.holes : []));
    expect(holes).not.toContain("a10");
    expect(holes).not.toContain("a11");
    const sim = new Simulation(scene);
    for (let t = 0; t < 6; t += 0.05) sim.step(0.05);
    const osc = scene.components.find((c) => c.id === "P1") as Oscilloscope;
    const f = scopeFrame(osc, sim);
    const volts = (k: number) => f.channels[k].points.map(([, y]) => (y - f.ground) * f.channels[k].vdiv);
    // Самописец заполнил весь экран: 5 с при 0,5 с/дел
    expect(f.channels[0].points[0][0]).toBeLessThan(0.1);
    expect(Math.min(...volts(0))).toBeLessThan(0.5);
    expect(Math.max(...volts(0))).toBeGreaterThan(6.5);
    expect(Math.min(...volts(1))).toBeLessThan(-5);
    expect(Math.max(...volts(1))).toBeLessThan(1);
    // Есть минус — ноль посередине экрана
    expect(f.ground).toBe(4);
  });
});
