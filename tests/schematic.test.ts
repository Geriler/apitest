import { describe, expect, it } from "vitest";
import { blinkerScene, demoScene, mosfetScene, pcbScene } from "../src/demo";
import type { Scene } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";
import { buildNetlist, schematicSvg } from "../src/view/schematic";

const free = (x: number) => ({ mode: "free" as const, x, z: 0, rot: 0 });

describe("принципиальная схема", () => {
  it("цепи: провод сливает узлы, резистор между батареей и лампой — три цепи", () => {
    // GB1+ → R1 → HL1 → GB1−
    const scene: Scene = {
      components: [
        { id: "GB1", type: "battery", kind: "9V", placement: free(-30) },
        { id: "R1", type: "resistor", variant: "tht", ohms: 100, smdSize: "0805", placement: { mode: "board", holes: ["a3", "a8"] } },
        { id: "HL1", type: "lamp", kind: "6.3V", placement: { mode: "board", holes: ["c8", "c12"] } },
      ],
      wires: [
        { id: "W1", a: { comp: "GB1", pin: 1 }, b: { hole: "e3" }, color: "" },
        { id: "W2", a: { hole: "e12" }, b: { comp: "GB1", pin: 0 }, color: "" },
      ],
    };
    const { nets, pins } = buildNetlist(scene);
    expect(nets).toHaveLength(3);
    // Плюс батареи и первый вывод резистора — одна цепь (через провод и полосу 3)
    expect(pins.get("GB1")![1]).toBe(pins.get("R1")![0]);
    // Резистор и лампа соединены полосой 8
    expect(pins.get("R1")![1]).toBe(pins.get("HL1")![0]);
    expect(pins.get("HL1")![1]).toBe(pins.get("GB1")![0]);
    expect(new Set([...pins.values()].flat()).size).toBe(3);
  });

  it("дорожки печатной платы сливают площадки в одну цепь", () => {
    const scene = pcbScene();
    const { pins } = buildNetlist(scene);
    // Верхние выводы обоих резисторов сидят на шине + (дорожка по ряду A)
    expect(pins.get("R1")![0]).toBe(pins.get("R2")![0]);
  });

  it("чертёж: каждая деталь подписана, цепи идут сверху вниз по убыванию потенциала, без NaN", () => {
    for (const scene of [demoScene(), blinkerScene(), mosfetScene(), pcbScene()]) {
      const sim = new Simulation(scene);
      const svg = schematicSvg(scene, sim, scene.components[0].id);
      expect(svg).not.toMatch(/NaN|undefined/);
      for (const c of scene.components) expect(svg).toContain(`data-part="${c.id}"`);
      expect(svg).toContain('class="part sel"');
      // Подписи напряжений цепей идут в порядке убывания
      const volts = [...svg.matchAll(/class="volt"[^>]*>([^<]+)</g)].map((m) => m[1]);
      const toNum = (t: string) => {
        const m = t.match(/^(−?-?[\d,]+)\s*(мк|м)?В$/);
        if (!m) return NaN;
        const k = m[2] === "м" ? 1e-3 : m[2] === "мк" ? 1e-6 : 1;
        return Number(m[1].replace(",", ".").replace("−", "-")) * k;
      };
      const ys = [...svg.matchAll(/<path d="M[\d.]+ ([\d.]+)H[\d.]+"\/>(?:<circle[^>]*>)*<text[^>]*class="volt"[^>]*>([^<]+)</g)].map((m) => [Number(m[1]), toNum(m[2])]);
      expect(ys.length).toBe(volts.length);
      const sorted = [...ys].sort((a, b) => a[0] - b[0]).map(([, v]) => v).filter((v) => !Number.isNaN(v));
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]).toBeLessThanOrEqual(sorted[i - 1] + 1e-9);
    }
  });

  it("пустой стол — пустая схема", () => {
    const scene: Scene = { components: [], wires: [], boards: [] };
    expect(schematicSvg(scene, new Simulation(scene))).toBe("");
  });
});
