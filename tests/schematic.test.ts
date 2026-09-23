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

  it("чертёж: каждая деталь подписана, плюс источника сверху, минус снизу, без NaN", () => {
    for (const scene of [demoScene(), blinkerScene(), mosfetScene(), pcbScene()]) {
      const sim = new Simulation(scene);
      const svg = schematicSvg(scene, sim, scene.components[0].id);
      expect(svg).not.toMatch(/NaN|undefined/);
      for (const c of scene.components) expect(svg).toContain(`data-part="${c.id}"`);
      expect(svg).toContain('class="part sel"');
      const src = scene.components.find((c) => c.type === "battery" || c.type === "psu")!;
      const ys = [...svg.matchAll(/data-net="([^"]+)" data-y="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])] as const);
      const yOf = (key: string) => ys.find(([k]) => k === key)?.[1];
      // Имя цепи — первый по алфавиту вывод на ней; у источника вывод 1 — плюс, 0 — минус
      const { pins } = buildNetlist(scene);
      const keyOf = (net: number) =>
        scene.components.flatMap((c) => pins.get(c.id)!.map((n, p) => (n === net ? `${c.id}.${p}` : ""))).filter(Boolean).sort()[0];
      const plusY = yOf(keyOf(pins.get(src.id)![1]))!;
      const minusY = yOf(keyOf(pins.get(src.id)![0]))!;
      for (const [, y] of ys) {
        expect(y).toBeGreaterThanOrEqual(plusY);
        expect(y).toBeLessThanOrEqual(minusY);
      }
    }
  });

  it("чертёж не перестраивается, когда щёлкают тумблером: меняется только его значок и цифры", () => {
    const scene = demoScene();
    const sim = new Simulation(scene);
    // Без цифр и без самих тумблеров (их значок меняется); всё остальное должно совпасть до символа
    const shape = (svg: string) =>
      svg
        .replace(/>[^<]*<\/text>/g, "></text>")
        .split('<g class="part')
        .filter((seg) => !/^[^>]*data-part="SA\d"/.test(seg))
        .join('<g class="part');
    const before = shape(schematicSvg(scene, sim));
    for (const c of scene.components) if (c.type === "switch") c.closed = !c.closed;
    sim.solve();
    expect(shape(schematicSvg(scene, sim))).toBe(before);
  });

  it("ручная раскладка: деталь сдвигается по горизонтали, линия цепи — по вертикали", () => {
    const scene = demoScene();
    const sim = new Simulation(scene);
    const auto = schematicSvg(scene, sim);
    const partX = (svg: string, id: string) => Number(svg.match(new RegExp(`data-part="${id}" data-x="([\\d.]+)"`))![1]);
    const netY = (svg: string, key: string) => Number(svg.match(new RegExp(`data-net="${key.replace(".", "\\.")}" data-y="([\\d.]+)"`))![1]);
    const key = auto.match(/data-net="([^"]+)"/)![1];
    const moved = schematicSvg(scene, sim, undefined, { x: { R1: partX(auto, "R1") + 200 }, y: { [key]: netY(auto, key) + 37 } });
    expect(partX(moved, "R1")).toBe(partX(auto, "R1") + 200);
    expect(netY(moved, key)).toBe(netY(auto, key) + 37);
    // Остальные детали на месте
    expect(partX(moved, "R2")).toBe(partX(auto, "R2"));
  });

  it("пустой стол — пустая схема", () => {
    const scene: Scene = { components: [], wires: [], boards: [] };
    expect(schematicSvg(scene, new Simulation(scene))).toBe("");
  });
});
