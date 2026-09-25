import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Chip, Endpoint, Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { LEVELS, levelById, type Level, type LogicFunc } from "../src/career/levels";
import { SCHMITT_LIMITS, checkLevel, oscillation, packageRecipe, recipeScene, referenceChips, thresholds } from "../src/career/build";

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

describe("время: триггер Шмитта и генератор", () => {
  it("74LVC1G14: пороги эталона — в пределах даташита TI, гистерезис больше 0,5 В", () => {
    const { up, down } = thresholds(refById.get("ref:schmitt")!, levelById("schmitt")!, allChips);
    expect(up!).toBeGreaterThanOrEqual(SCHMITT_LIMITS.up[0]);
    expect(up!).toBeLessThanOrEqual(SCHMITT_LIMITS.up[1]);
    expect(down!).toBeGreaterThanOrEqual(SCHMITT_LIMITS.down[0]);
    expect(down!).toBeLessThanOrEqual(SCHMITT_LIMITS.down[1]);
    expect(up! - down!).toBeGreaterThan(0.5);
  });

  it("три инвертора без обратной связи — таблица сходится, а гистерезиса нет: не проходит", () => {
    const level = levelById("schmitt")!;
    const r = checkWith(level, {
      parts: level.recipe.parts.filter((p) => p.id !== "R2"),
      nets: level.recipe.nets.map((n) => n.filter((e) => !e.startsWith("R2."))).filter((n) => n.length > 1),
    });
    expect(r.rows.every((x) => x.ok)).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.steps!.find((s) => s.text.startsWith("Гистерезис"))!.ok).toBe(false);
  });

  it("генератор: 1 МОм × 1 мкФ — период около 0,9 с, проходит; 100 кОм — в 10 раз быстрее, не проходит", () => {
    const level = levelById("osc")!;
    const def = packageRecipe(level, "career:osc", chipFor);
    const o = oscillation(def, level, { ...allChips, [def.id]: def });
    expect(o.period).toBeGreaterThan(0.8);
    expect(o.period).toBeLessThan(1);
    expect(o.duty).toBeGreaterThan(0.35);
    expect(o.duty).toBeLessThan(0.65);
    expect(checkWith(level).ok).toBe(true);
    const fast = checkWith(level, { ...level.recipe, parts: level.recipe.parts.map((p) => (p.id === "R1" ? { ...p, ohms: 100_000 } : p)) });
    expect(fast.ok).toBe(false);
    expect(fast.steps![0].text).toMatch(/мс/);
  });

  it("кольцо из трёх инверторов без RC генерирует быстрее, чем видно: выход посередине", () => {
    const not = refById.get("ref:not-cmos")!;
    const ids = ["D1", "D2", "D3"];
    const comps: Chip[] = ids.map((id) => ({ id, type: "chip", def: not.id, name: not.name, package: not.package, pins: 5, placement: free() }));
    const e = (c: string, p: number): Endpoint => ({ comp: c, pin: p - 1 });
    const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
    const w: [Endpoint, Endpoint][] = [...ids.flatMap((id): [Endpoint, Endpoint][] => [[plus, e(id, 5)], [minus, e(id, 3)]]), [e("D1", 4), e("D2", 2)], [e("D2", 4), e("D3", 2)], [e("D3", 4), e("D1", 2)]];
    const scene: Scene = { components: [{ id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free() }, ...comps], wires: w.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: allChips };
    const sim = new Simulation(scene);
    for (let i = 0; i < 5; i++) sim.step(0.05);
    const v = sim.solution.voltage.get(pinNode(comps[2], 3))! - sim.solution.voltage.get(pinNode(comps[2], 2))!;
    expect(v).toBeGreaterThan(1);
    expect(v).toBeLessThan(4);
  });
});
