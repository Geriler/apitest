import { describe, expect, it } from "vitest";
import elementOr from "./fixtures/element-or.json";
import { applyBoards, DEFAULT_BOARDS } from "../src/model/breadboard";
import { sceneBoards, type Component, type Endpoint, type Scene } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";
import { parseProjectFile } from "../src/projects";

const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };

describe("устойчивость расчёта", () => {
  it("светодиод последовательно с разомкнутым тумблером: сходится сразу, ток ноль", () => {
    for (const size of ["5mm", "1W"] as const) {
      const scene: Scene = {
        components: [
          { id: "G1", type: "psu", volts: 5, amps: 0.5, on: true, placement: free },
          { id: "HL1", type: "led", color: "red", size, placement: free },
          { id: "SA1", type: "switch", closed: false, placement: free },
          { id: "SA2", type: "switch", closed: false, placement: free },
        ],
        wires: [
          { id: "W1", a: { comp: "G1", pin: 1 }, b: { comp: "HL1", pin: 0 }, color: "" },
          { id: "W2", a: { comp: "HL1", pin: 1 }, b: { comp: "SA1", pin: 0 }, color: "" },
          { id: "W3", a: { comp: "HL1", pin: 1 }, b: { comp: "SA2", pin: 0 }, color: "" },
          { id: "W4", a: { comp: "SA1", pin: 1 }, b: { comp: "G1", pin: 0 }, color: "" },
          { id: "W5", a: { comp: "SA2", pin: 1 }, b: { comp: "G1", pin: 0 }, color: "" },
        ],
      };
      const sim = new Simulation(scene);
      expect(sim.lastIterations).toBeLessThan(10);
      expect(Math.abs(sim.current(scene.components[1]))).toBeLessThan(1e-9);
      // Замкнули — светодиод горит (ток ограничен блоком)
      (scene.components[2] as { closed: boolean }).closed = true;
      sim.solve();
      expect(sim.current(scene.components[1])).toBeGreaterThan(0.1);
    }
  });

  it("«Элемент ИЛИ» пользователя: лампы заменены светодиодами 1 Вт — без ошибок, HL3 работает как ИЛИ", () => {
    const { scene } = parseProjectFile(JSON.stringify(elementOr));
    applyBoards(sceneBoards(scene));
    try {
      scene.components = scene.components.map((c) =>
        c.type !== "lamp" || c.placement.mode !== "board"
          ? c
          : ({ id: c.id, type: "led", color: "red", size: "1W", placement: { mode: "board", holes: [...c.placement.holes].reverse() } } as Component),
      );
      const sim = new Simulation(scene);
      const sw = (id: string) => scene.components.find((c) => c.id === id) as { closed: boolean };
      const hl3 = scene.components.find((c) => c.id === "HL3")!;
      const lit: boolean[] = [];
      for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]]) {
        sw("SA3").closed = a;
        sw("SA4").closed = b;
        sim.solve();
        for (let i = 0; i < 4; i++) sim.step(0.05);
        lit.push(sim.current(hl3) > 0.1);
      }
      expect(lit).toEqual([false, true, true, true]);
      expect(sim.nonConverged).toBe(0);
    } finally {
      applyBoards(DEFAULT_BOARDS);
    }
  }, 60000);

  it("случайные схемы с MOSFET, светодиодами и тумблерами не роняют расчёт", () => {
    const rng = (seed: number) => {
      let s = seed >>> 0;
      return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    };
    // 84, 101, 147 — раньше падали («вырожденная матрица», «сопротивление должно быть > 0»)
    for (const seed of [84, 101, 147, ...Array.from({ length: 40 }, (_, i) => 1000 + i)]) {
      const r = rng(seed);
      const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
      const comps: Component[] = [
        r() < 0.5 ? { id: "G1", type: "psu", volts: 1 + r() * 29, amps: 0.02 + r() * 2, on: true, placement: free } : { id: "GB1", type: "battery", kind: "9V", placement: free },
      ];
      const n = 3 + Math.floor(r() * 6);
      for (let i = 0; i < n; i++) {
        const k = r();
        const id = `X${i}`;
        if (k < 0.25) comps.push({ id, type: "mosfet", kind: pick(["IRF9540N", "IRLZ44N", "2N7000", "BS250"] as const), placement: free });
        else if (k < 0.4) comps.push({ id, type: "led", color: pick(["red", "white"] as const), size: pick(["5mm", "1W"] as const), placement: free });
        else if (k < 0.6) comps.push({ id, type: "switch", closed: r() < 0.5, placement: free });
        else if (k < 0.8) comps.push({ id, type: "resistor", variant: "tht", ohms: pick([10, 100, 1000, 10000, 100000]), smdSize: "0805", placement: free });
        else if (k < 0.9) comps.push({ id, type: "lamp", kind: "6.3V", placement: free });
        else comps.push({ id, type: "capacitor", variant: "electrolytic", uF: 100, placement: free });
      }
      const pins: Endpoint[] = comps.flatMap((c) => Array.from({ length: c.type === "mosfet" ? 3 : 2 }, (_, p) => ({ comp: c.id, pin: p as 0 | 1 | 2 })));
      const netCount = 2 + Math.floor(r() * 4);
      const nets: Endpoint[][] = Array.from({ length: netCount }, () => []);
      for (const p of pins) nets[Math.floor(r() * netCount)].push(p);
      const scene: Scene = { components: comps, wires: nets.flatMap((net, ni) => net.slice(1).map((p, i) => ({ id: `W${ni}_${i}`, a: net[0], b: p, color: "" }))) };
      const run = () => {
        const sim = new Simulation(scene);
        for (let t = 0; t < 60; t++) {
          if (t % 10 === 0) for (const c of comps) if (c.type === "switch" && r() < 0.5) (c.closed = !c.closed), sim.solve();
          sim.step(0.05);
          for (const v of sim.solution.voltage.values()) expect(Number.isFinite(v)).toBe(true);
        }
      };
      expect(run, `seed ${seed}`).not.toThrow();
    }
  }, 300000);
});
