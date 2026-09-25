import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards, packageName, parsePackage, pinOffsets } from "../src/model/breadboard";
import type { Chip, ChipDef, Endpoint, Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { modelAt } from "../src/chips/model";
import { LEVELS, levelById, type LogicFunc } from "../src/career/levels";
import { characterize, checkLevel, inputVectors, publicChips, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });

/** Стенд: питание 5 В, микросхема def, входы (номер вывода → уровень), выход — на нагрузку rl к общему. */
function stand(def: ChipDef, inputs: Record<number, boolean>, out: number, rl: number, expand: boolean) {
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free() };
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const vcc = def.pinRoles!.indexOf("vcc"), gnd = def.pinRoles!.indexOf("gnd");
  const wires: [Endpoint, Endpoint][] = [
    [plus, { comp: "U1", pin: vcc }],
    [minus, { comp: "U1", pin: gnd }],
    ...Object.entries(inputs).map(([p, b]): [Endpoint, Endpoint] => [{ comp: "U1", pin: Number(p) - 1 }, b ? plus : minus]),
    [{ comp: "U1", pin: out - 1 }, { comp: "RL", pin: 0 }],
    [{ comp: "RL", pin: 1 }, minus],
  ];
  const scene: Scene = {
    components: [
      { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free() },
      u,
      { id: "RL", type: "resistor", variant: "tht", ohms: rl, smdSize: "0805", placement: free() },
    ],
    wires: wires.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
    boards: [],
    chips: allChips,
  };
  const sim = new Simulation(scene, undefined, expand ? { expand: ["U1"] } : {});
  sim.step(0.05);
  return { sim, u, v: (p: number) => sim.solution.voltage.get(pinNode(u, p - 1))! - sim.solution.voltage.get(pinNode(u, gnd))! };
}

describe("гибридный расчёт: проверенные микросхемы — моделью", () => {
  it("модель снимается с проверки: у КМОП вход — разрыв и ток покоя почти ноль, у РТЛ — ток базы и миллиамперы", () => {
    const scene: Scene = { components: [], wires: [], chips: allChips };
    const cmos = modelAt(characterize(refById.get("ref:nand-cmos")!, scene)!, 5);
    const rtl = modelAt(characterize(refById.get("ref:nand-rtl")!, scene)!, 5);
    expect(cmos.rIn.every((r) => r >= 1e8)).toBe(true);
    expect(cmos.iq).toBeLessThan(1e-6);
    expect(cmos.rHigh[0]).toBeLessThan(100);
    expect(rtl.rIn.every((r) => r > 5e3 && r < 5e4)).toBe(true);
    expect(rtl.iq).toBeGreaterThan(1e-4);
    // Единица РТЛ — через резистор 1 кОм к питанию: выход «слабый»
    expect(rtl.rHigh[0]).toBeGreaterThan(500);
  });

  it("модель и расчёт по транзисторам сходятся: И-НЕ под нагрузкой 1 кОм", () => {
    const def = refById.get("ref:nand-cmos")!;
    for (const [a, b] of [[false, false], [true, false], [true, true]]) {
      const model = stand(def, { 1: a, 2: b }, 4, 1000, false);
      const full = stand(def, { 1: a, 2: b }, 4, 1000, true);
      expect(model.sim.modelOf("U1")).toBeDefined();
      expect(full.sim.modelOf("U1")).toBeUndefined();
      expect(Math.abs(model.v(4) - full.v(4))).toBeLessThan(0.1);
    }
  });

  it("вложенные микросхемы внутри проверяемой — модели, она сама — транзисторы; 74HC283 проверяется за доли секунды", () => {
    const level = levelById("hc283")!;
    const scene = recipeScene(level, chipFor);
    applyBoards(scene.boards!);
    const t0 = performance.now();
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(40);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("закороченный выход модели перегружен и выходит из строя", () => {
    const def = refById.get("ref:not-cmos")!;
    const { sim } = stand(def, { 2: false }, 4, 0.01, false);
    for (let i = 0; i < 40; i++) sim.step(0.1);
    expect(sim.state("U1").burned).toBe(true);
  });
});

describe("проверка больших микросхем и учебные компоненты", () => {
  it("до 6 входов — вся таблица; больше — 40 разных наборов: нули, единицы, каждый вход по отдельности", () => {
    expect(inputVectors(3)).toHaveLength(8);
    const v = inputVectors(9);
    expect(v).toHaveLength(40);
    expect(new Set(v.map((x) => x.join())).size).toBe(40);
    expect(v).toContainEqual(Array(9).fill(false));
    expect(v).toContainEqual(Array(9).fill(true));
    for (let i = 0; i < 9; i++) expect(v).toContainEqual(Array.from({ length: 9 }, (_, j) => j === i));
    // Постоянные: одни и те же при каждой проверке
    expect(inputVectors(9)).toEqual(v);
  });

  it("74HC283 с перепутанным переносом: сказано, какие выходы неверны и сколько раз", () => {
    const level = levelById("hc283")!;
    const scene = recipeScene(level, chipFor);
    // Перенос из первого разряда никуда не идёт: вход переноса второго разряда висит
    scene.wires = scene.wires.filter((w) => !(["a", "b"] as const).some((k) => "hole" in w[k] && w[k].hole === "k:E12"));
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    const text = r.diagnosis!.join(" ");
    expect(text).toMatch(/Неверные выходы: .*Σ2/);
    expect(text).not.toMatch(/Σ1 —/);
  });

  it("учебные ступеньки не выдаются в мастерскую и песочницу; одинаковые обозначения — по одной", () => {
    const shown = publicChips(refs).map((d) => d.id);
    expect(shown).not.toContain("ref:xnor");
    expect(shown).not.toContain("ref:half");
    expect(shown).toContain("ref:hc7266");
    expect(shown).toContain("ref:hc283");
    expect(shown.filter((id) => refById.get(id)!.name === "74LVC1G08")).toHaveLength(1);
  });

  it("SOT-23-6: выводы по кругу, как у DIP-6", () => {
    expect(parsePackage("SOT-23-6")).toEqual({ package: "SOT-23-6", pins: 6 });
    expect(packageName("SOT-23-6", 6)).toBe("SOT-23-6");
    expect(pinOffsets("SOT-23-6", 6)).toEqual(pinOffsets("DIP", 6));
  });
});
