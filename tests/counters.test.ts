import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Chip, Endpoint, Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { LEVELS, levelById, sequenceExpected, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });

function checkWith(level: Level, recipe?: Level["recipe"]) {
  const scene = recipeScene(recipe ? { ...level, recipe } : level, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
}

describe("счёт: делитель, счётчик, регистр сдвига", () => {
  it("ожидаемое считается от того, что было после включения: счётчик с 13 — 14, 15, 0, 1", () => {
    const level = levelById("cnt4")!;
    const e = sequenceExpected(level, 13, 1);
    const num = (b: boolean[]) => b.reduce((m, x, k) => m | (x ? 1 << k : 0), 0);
    expect([0, 2, 4, 6].map((i) => num(e[i]))).toEqual([14, 15, 0, 1]);
  });

  it("эталоны проходят; счётчик — 17 фронтов, регистр вдвигает 1, 0, 1, 1, 0, 0", () => {
    for (const id of ["div2", "cnt4", "sreg4"]) expect(checkWith(levelById(id)!).ok).toBe(true);
    expect(levelById("cnt4")!.sequence!.filter((s) => s.in[0]).length).toBe(17);
  });

  it("счётчик без инверторов между разрядами (разряды по фронту, а не по спаду) не проходит", () => {
    const level = levelById("cnt4")!;
    const r = checkWith(level, {
      parts: level.recipe.parts.filter((p) => !p.id.startsWith("N")),
      nets: [
        ["P8", "T0.5", "T1.5", "T2.5", "T3.5"],
        ["P4", "T0.3", "T1.3", "T2.3", "T3.3"],
        ["P1", "T0.2"],
        ["T0.4", "P3", "T1.2"],
        ["T1.4", "P5", "T2.2"],
        ["T2.4", "P6", "T3.2"],
        ["T3.4", "P7"],
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("регистр с общим D у всех разрядов (не цепочкой) не проходит", () => {
    const level = levelById("sreg4")!;
    const r = checkWith(level, {
      parts: level.recipe.parts,
      nets: [
        ["P8", "F0.5", "F1.5", "F2.5", "F3.5"],
        ["P4", "F0.3", "F1.3", "F2.3", "F3.3"],
        ["P1", "F0.1", "F1.1", "F2.1", "F3.1"],
        ["P2", "F0.2", "F1.2", "F2.2", "F3.2"],
        ["F0.4", "P3"],
        ["F1.4", "P5"],
        ["F2.4", "P6"],
        ["F3.4", "P7"],
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("регистр из четырёх 74LVC1G79 на столе (моделями): бит не пролетает насквозь за один фронт", () => {
    const d = refById.get("ref:dff")!;
    const ids = ["F0", "F1", "F2", "F3"];
    const comps: Chip[] = ids.map((id) => ({ id, type: "chip", def: d.id, name: d.name, package: d.package, pins: 5, placement: free() }));
    const e = (c: string, p: number): Endpoint => ({ comp: c, pin: p - 1 });
    const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
    const base: [Endpoint, Endpoint][] = [...ids.flatMap((id): [Endpoint, Endpoint][] => [[plus, e(id, 5)], [minus, e(id, 3)]]), [e("F0", 4), e("F1", 1)], [e("F1", 4), e("F2", 1)], [e("F2", 4), e("F3", 1)]];
    const scene: Scene = { components: [{ id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free() }, ...comps], wires: [], boards: [], chips: allChips };
    const set = (dIn: boolean, clk: boolean) => {
      const w: [Endpoint, Endpoint][] = [...base, [e("F0", 1), dIn ? plus : minus], ...ids.map((id): [Endpoint, Endpoint] => [e(id, 2), clk ? plus : minus])];
      scene.wires = w.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" }));
    };
    set(false, false);
    const sim = new Simulation(scene);
    const go = (dIn: boolean, clk: boolean) => (set(dIn, clk), sim.solve(), sim.step(0.02));
    for (let i = 0; i < 4; i++) (go(false, true), go(false, false));
    go(true, false);
    go(true, true);
    const q = () => ids.map((_, k) => (sim.solution.voltage.get(pinNode(comps[k], 3))! > 2.5 ? 1 : 0)).join("");
    expect(q()).toBe("1000");
    go(false, false);
    go(false, true);
    expect(q()).toBe("0100");
  });
});
