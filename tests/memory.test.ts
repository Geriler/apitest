import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Chip, ChipDef, Endpoint, Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { LEVELS, levelById, sequenceExpected, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });

/** Проверить уровень со своей сборкой вместо эталонной. */
function checkWith(level: Level, recipe: Level["recipe"]) {
  const scene = recipeScene({ ...level, recipe }, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
}

/** Стенд с микросхемами на столе: выводы — «D1.3», питание — G1; входы переключаются set(). */
function bench(chips: Record<string, ChipDef>, links: [string, string][], expand: string[] = []) {
  const ep = (s: string): Endpoint => {
    if (s === "+") return { comp: "G1", pin: 1 };
    if (s === "-") return { comp: "G1", pin: 0 };
    const [c, p] = s.split(".");
    return { comp: c, pin: Number(p) - 1 };
  };
  const comps: Chip[] = Object.entries(chips).map(([id, d]) => ({ id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: free() }));
  const scene: Scene = {
    components: [{ id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free() }, ...comps],
    wires: [],
    boards: [],
    chips: allChips,
  };
  let inputs: Record<string, boolean> = {};
  const wire = () => {
    const all: [string, string][] = [...links, ...Object.entries(inputs).map(([pin, b]): [string, string] => [pin, b ? "+" : "-"])];
    scene.wires = all.map(([a, b], i) => ({ id: `W${i}`, a: ep(a), b: ep(b), color: "" }));
  };
  wire();
  const sim = new Simulation(scene, undefined, { expand });
  return {
    sim,
    set(next: Record<string, boolean>) {
      inputs = { ...inputs, ...next };
      wire();
      sim.solve();
      sim.step(0.02);
    },
    v: (s: string) => {
      const [c, p] = s.split(".");
      return sim.solution.voltage.get(pinNode(comps.find((x) => x.id === c)!, Number(p) - 1))!;
    },
  };
}

describe("память: защёлки и триггер", () => {
  it("последовательности: подготовительный шаг не проверяется, у триггера каждый шаг меняет один вход", () => {
    const dff = levelById("dff")!;
    expect(dff.sequence![0].prep).toBe(true);
    for (let i = 1; i < dff.sequence!.length; i++) {
      const changed = dff.sequence![i].in.filter((b, k) => b !== dff.sequence![i - 1].in[k]).length;
      expect(changed).toBe(1);
    }
    // D = 1 при высоком CLK (без фронта) не должен пройти на выход
    const exp = sequenceExpected(dff);
    expect(exp[2]).toEqual([false]);
    expect(exp[4]).toEqual([true]);
  });

  it("RS-защёлка без обратной связи — просто два ИЛИ-НЕ — не проходит: не хранит", () => {
    const level = levelById("sr")!;
    const r = checkWith(level, {
      parts: level.recipe.parts,
      nets: [
        ["P6", "D1.5", "D2.5"],
        ["P3", "D1.3", "D2.3", "D1.2", "D2.2"],
        ["P2", "D1.1"],
        ["D1.4", "P4"],
        ["P1", "D2.1"],
        ["D2.4", "P5"],
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.rows.some((x) => x.step && !x.ok)).toBe(true);
    expect(r.diagnosis!.join(" ")).toMatch(/На шаге \d+ \(S = 0, R = 0\)/);
  });

  it("D-триггер из одной D-защёлки не проходит: она пропускает D, пока CLK = 1", () => {
    const level = levelById("dff")!;
    const r = checkWith(level, {
      parts: [level.recipe.parts[1]],
      nets: [["P5", "M.6"], ["P3", "M.3"], ["P1", "M.1"], ["P2", "M.2"], ["M.4", "P4"]],
    });
    expect(r.ok).toBe(false);
    // Шаг 2: D стал 1 при CLK = 1 — у настоящего триггера Q остаётся 0
    expect(r.rows[1].ok).toBe(false);
  });

  it("защёлка из двух ИЛИ-НЕ, посчитанных по транзисторам, хранит состояние", () => {
    const nor = refById.get("ref:nor-cmos")!;
    const b = bench(
      { D1: nor, D2: nor },
      [["D1.5", "+"], ["D2.5", "+"], ["D1.3", "-"], ["D2.3", "-"], ["D1.4", "D2.2"], ["D2.4", "D1.2"]],
      ["D1", "D2"],
    );
    expect(b.sim.modelOf("D1")).toBeUndefined();
    b.set({ "D2.1": true, "D1.1": false }); // S = 1
    expect(b.v("D1.4")).toBeGreaterThan(4.5);
    b.set({ "D2.1": false }); // хранить
    expect(b.v("D1.4")).toBeGreaterThan(4.5);
    b.set({ "D1.1": true }); // R = 1
    expect(b.v("D1.4")).toBeLessThan(0.5);
    b.set({ "D1.1": false }); // хранить
    expect(b.v("D1.4")).toBeLessThan(0.5);
  });

  it("74LVC1G79 на столе (моделью): срабатывает по фронту CLK, в остальное время хранит", () => {
    const b = bench({ U1: refById.get("ref:dff")! }, [["U1.5", "+"], ["U1.3", "-"]]);
    expect(b.sim.modelOf("U1")).toBeDefined();
    b.set({ "U1.1": false, "U1.2": false });
    b.set({ "U1.2": true }); // фронт, D = 0
    expect(b.v("U1.4")).toBeLessThan(0.5);
    b.set({ "U1.1": true }); // D = 1 без фронта
    expect(b.v("U1.4")).toBeLessThan(0.5);
    b.set({ "U1.2": false });
    expect(b.v("U1.4")).toBeLessThan(0.5);
    b.set({ "U1.2": true }); // фронт, D = 1
    expect(b.v("U1.4")).toBeGreaterThan(4.5);
    b.set({ "U1.1": false, "U1.2": false });
    expect(b.v("U1.4")).toBeGreaterThan(4.5);
  });
});
