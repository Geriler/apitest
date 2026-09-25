import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Chip, ChipDef, Endpoint, Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { LEVELS, levelById, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });

/** И-НЕ def при питании volts; входы: true/false — к питанию или общему, undefined — висит. */
function nand(def: ChipDef, volts: number, a: boolean | undefined, b: boolean | undefined) {
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free() };
  const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
  const w: [Endpoint, Endpoint][] = [[plus, { comp: "U1", pin: 4 }], [minus, { comp: "U1", pin: 2 }]];
  if (a !== undefined) w.push([{ comp: "U1", pin: 0 }, a ? plus : minus]);
  if (b !== undefined) w.push([{ comp: "U1", pin: 1 }, b ? plus : minus]);
  const scene: Scene = { components: [{ id: "G1", type: "psu", volts, amps: 1, on: true, placement: free() }, u], wires: w.map(([x, y], i) => ({ id: `W${i}`, a: x, b: y, color: "" })), boards: [], chips: allChips };
  const sim = new Simulation(scene);
  sim.step(0.05);
  return { sim, out: () => sim.solution.voltage.get(pinNode(u, 3))! - sim.solution.voltage.get(pinNode(u, 2))!, amps: () => Math.abs(sim.current(scene.components[0])) };
}

describe("питание и нагрузка", () => {
  it("цифры сборки: КМОП на 2N7000 работает от 2,5 В и держит выход десятком ом; РТЛ — от 2 В, но выход ≈ 1 кОм", () => {
    const run = (id: string) => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      return checkLevel(level, scene, allChips).metrics!;
    };
    const cmos = run("not-cmos"), rtl = run("not-rtl");
    expect(cmos.vmin).toBe(2.5);
    expect(rtl.vmin).toBe(2);
    expect(cmos.rOut!).toBeLessThan(50);
    expect(rtl.rOut!).toBeGreaterThan(500);
  });

  it("буфер должен отдавать 10 мА: из РТЛ-инверторов не проходит, из КМОП — проходит", () => {
    const level = levelById("buf")!;
    const build = (not: string) => {
      const scene = recipeScene(level, () => refById.get(not)!);
      applyBoards(scene.boards!);
      return checkLevel(level, scene, allChips);
    };
    expect(build("ref:not-cmos").ok).toBe(true);
    const rtl = build("ref:not-rtl");
    expect(rtl.ok).toBe(false);
    // Не проходит единица: резистор 1 кОм не удержит 70 % питания на нагрузке 350 Ом
    expect(rtl.rows.filter((r) => !r.ok).every((r) => r.expected[0])).toBe(true);
    expect(rtl.diagnosis!.join(" ")).toMatch(/под нагрузкой 10 мА проседает/);
  });

  it("висящий вход КМОП не определён: выход посередине и сквозной ток; у РТЛ висящий вход — ноль", () => {
    const cmos = refById.get("ref:nand-cmos")!;
    const ok = nand(cmos, 5, true, true);
    const hang = nand(cmos, 5, true, undefined);
    expect(ok.out()).toBeLessThan(0.5);
    expect(hang.out()).toBeGreaterThan(1.5);
    expect(hang.out()).toBeLessThan(3.5);
    expect(hang.amps()).toBeGreaterThan(1000 * ok.amps());
    // РТЛ: база без тока — транзистор закрыт, как при нуле: И-НЕ даёт единицу
    const rtl = nand(refById.get("ref:nand-rtl")!, 5, true, undefined);
    expect(rtl.out()).toBeGreaterThan(3.5);
  });

  it("вне проверенного диапазона питания микросхема считается по транзисторам", () => {
    const def = refById.get("ref:nand-cmos")!;
    const low = nand(def, 1.5, true, true);
    low.sim.step(0.05);
    expect(low.sim.modelOf("U1")).toBeUndefined();
    expect(nand(def, 5, true, true).sim.modelOf("U1")).toBeDefined();
  });

  it("заводская 74LVC от 9 В выходит из строя (предел 6,5 В); от 5 В — нет", () => {
    const def = refById.get("ref:nand-cmos")!;
    const hot = nand(def, 9, true, false);
    const fine = nand(def, 5, true, false);
    for (let i = 0; i < 100; i++) {
      hot.sim.step(0.1);
      fine.sim.step(0.1);
    }
    expect(hot.sim.state("U1").burned).toBe(true);
    expect(fine.sim.state("U1").burned).toBe(false);
  });
});
