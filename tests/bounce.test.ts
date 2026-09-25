import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, type LogicFunc } from "../src/career/levels";
import { BOUNCE_AT, buttonClosed, checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

describe("дребезг: RC-антидребезг → MAX6816", () => {
  it("сценарий: дребезг при нажатии и отпускании, потом держится; импульс 1 мс", () => {
    expect(buttonClosed(BOUNCE_AT.press - 1)).toBe(false);
    expect(buttonClosed(BOUNCE_AT.press + 0.1)).toBe(true);
    expect(buttonClosed(BOUNCE_AT.press + 0.5)).toBe(false);
    expect(buttonClosed(BOUNCE_AT.press + 10)).toBe(true);
    expect(buttonClosed(BOUNCE_AT.release + 0.1)).toBe(false);
    expect(buttonClosed(BOUNCE_AT.release + 0.5)).toBe(true);
    expect(buttonClosed(BOUNCE_AT.release + 10)).toBe(false);
    expect(buttonClosed(BOUNCE_AT.glitch + 0.5)).toBe(true);
    expect(buttonClosed(BOUNCE_AT.glitch + 2)).toBe(false);
  });

  for (const id of ["rcdb", "max6816"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const t0 = performance.now();
      const r = checkLevel(level, scene, allChips);
      console.log(id, Math.round(performance.now() - t0), "мс", r.steps?.map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n"));
      expect(r.ok).toBe(true);
    }, 120000);
  }

  it("без конденсатора (только подтяжка и два триггера Шмитта) дребезг проходит насквозь", () => {
    const level = levelById("rcdb")!;
    const recipe = { parts: level.recipe.parts, nets: level.recipe.nets.map((n) => (n.includes("C1.1") ? n.filter((e) => e !== "C1.1") : n)).filter((n) => !n.includes("C1.2")) };
    const scene = recipeScene({ ...level, recipe }, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.steps!.find((s) => s.text.startsWith("Нажатие"))!.ok).toBe(false);
  }, 60000);
});

import { Simulation } from "../src/sim/simulation";
import type { Scene } from "../src/model/types";

describe("кнопка с дребезгом в песочнице", () => {
  const scene = (bounce: boolean): Scene => {
    const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
    return {
      components: [
        { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: f },
        { id: "SB1", type: "button", ...(bounce ? { bounce: true } : {}), placement: f },
        { id: "R1", type: "resistor", variant: "tht", ohms: 1000, smdSize: "0805", placement: f },
      ],
      wires: [
        { id: "W1", a: { comp: "G1", pin: 1 }, b: { comp: "SB1", pin: 0 }, color: "" },
        { id: "W2", a: { comp: "SB1", pin: 1 }, b: { comp: "R1", pin: 0 }, color: "" },
        { id: "W3", a: { comp: "R1", pin: 1 }, b: { comp: "G1", pin: 0 }, color: "" },
      ],
      boards: [],
    };
  };
  const trace = (bounce: boolean) => {
    const s = scene(bounce);
    const sim = new Simulation(s);
    sim.solve();
    const r = s.components[2];
    const out: number[] = [];
    for (let i = 0; i < 4; i++) sim.step(0.005);
    sim.held.add("SB1");
    sim.solve();
    for (let i = 0; i < 8; i++) {
      out.push(Math.round(sim.voltage(r)));
      sim.step(0.0025);
    }
    return out;
  };
  it("идеальная замыкается сразу и держит; с дребезгом — замкнулась, разомкнулась, снова замкнулась", () => {
    expect(trace(false)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    const b = trace(true);
    expect(b[0]).toBe(5);
    expect(b).toContain(0);
    expect(b.at(-1)).toBe(5);
  });
  it("отпущенная кнопка с дребезгом сама не замыкается", () => {
    const s = scene(true);
    const sim = new Simulation(s);
    sim.solve();
    for (let i = 0; i < 10; i++) {
      sim.step(0.005);
      expect(Math.abs(sim.voltage(s.components[2]))).toBeLessThan(0.01);
    }
  });
});
