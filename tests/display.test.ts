import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, sequenceExpected, truth, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";
import { DISPLAY_SEGMENTS, type Component, type Endpoint, type Scene } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";
import { segmentCurrent } from "../src/parts/display";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

describe("индикация: дешифраторы и 7 сегментов", () => {
  it("таблицы: 74HC138 и 74HC4511 — как в даташитах TI", () => {
    // 74HC138: C B A = 5, разрешён — ноль только на Y̅5
    expect(truth("dec3", [true, false, true, false, false, true])).toEqual([true, true, true, true, true, false, true, true]);
    // Запрещён (G1 = 0) — все единицы
    expect(truth("dec3", [true, false, true, false, false, false]).every(Boolean)).toBe(true);
    // 4511: 6 — без верхней черты (a не горит), 9 — без нижней (d не горит); 12 — пусто; LT̅ главнее BL̅
    expect(truth("seg7", [false, true, true, false, true, true])).toEqual([false, false, true, true, true, true, true]);
    expect(truth("seg7", [true, false, false, true, true, true])).toEqual([true, true, true, false, false, true, true]);
    expect(truth("seg7", [false, false, true, true, true, true]).some(Boolean)).toBe(false);
    expect(truth("seg7", [false, false, false, false, false, false]).every(Boolean)).toBe(true);
    // Защёлка: при LE̅ = 1 показывает запомненное, а не новый код
    const lvl = levelById("hc4511")!;
    const exp = sequenceExpected(lvl);
    const i = lvl.sequence!.findIndex((s) => s.in.join() === [false, true, true, false, true, true, true].join());
    expect(exp[i]).toEqual(truth("seg7", [true, false, true, false, true, true]));
  });

  for (const id of ["dec2", "hc138", "seg7", "hc4511"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const t0 = performance.now();
      const r = checkLevel(level, scene, allChips);
      expect(r.diagnosis ?? []).toEqual([]);
      expect(r.ok).toBe(true);
      console.log(id, Math.round(performance.now() - t0), "мс", r.rows.length, "строк");
    }, 60000);
  }

  it("74HC4511 без защёлки (код прямо на дешифратор) не проходит: при LE̅ = 1 показывает новый код", () => {
    const level = levelById("hc4511")!;
    const scene = recipeScene({ ...level, recipe: { ...level.recipe, nets: level.recipe.nets.map((n) => n.filter((e) => !/^D[2-5]\./.test(e))).concat([["P7", "D1.7"], ["P1", "D1.1"], ["P2", "D1.2"], ["P6", "D1.6"]]).filter((n) => n.length > 1) } }, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.rows.some((x) => x.step && !x.ok && x.inputs[6])).toBe(true);
  }, 60000);

  it("74HC4511 → резисторы 330 Ом → индикатор SC56-11SRWA: цифра 2 — горят a, b, d, e, g по ≈ 8 мА", () => {
    const def = refById.get("ref:hc4511")!;
    const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });
    const comps: Component[] = [
      { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free() },
      { id: "D1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free() },
      { id: "HG1", type: "display", placement: free() },
    ];
    const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
    const w: [Endpoint, Endpoint][] = [
      [plus, { comp: "D1", pin: 15 }], [minus, { comp: "D1", pin: 7 }],
      // 2 = D1 (вывод 1) в единице; LT̅, BL̅ — единица, LE̅ — ноль
      [minus, { comp: "D1", pin: 6 }], [plus, { comp: "D1", pin: 0 }], [minus, { comp: "D1", pin: 1 }], [minus, { comp: "D1", pin: 5 }],
      [plus, { comp: "D1", pin: 2 }], [plus, { comp: "D1", pin: 3 }], [minus, { comp: "D1", pin: 4 }],
      [minus, { comp: "HG1", pin: 2 }],
    ];
    // Выводы 4511: a 13, b 12, c 11, d 10, e 9, f 15, g 14 → сегменты индикатора
    const chipPin: Record<string, number> = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };
    for (const [seg, p] of Object.entries(chipPin)) {
      const id = `R${seg}`;
      comps.push({ id, type: "resistor", variant: "tht", ohms: 330, smdSize: "0805", placement: free() });
      w.push([{ comp: "D1", pin: p - 1 }, { comp: id, pin: 0 }], [{ comp: id, pin: 1 }, { comp: "HG1", pin: DISPLAY_SEGMENTS.find((s) => s.name === seg)!.pin - 1 }]);
    }
    const scene: Scene = { components: comps, wires: w.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: allChips };
    const sim = new Simulation(scene);
    sim.solve();
    sim.step(0.05);
    const hg = comps[2] as Extract<Component, { type: "display" }>;
    const lit = DISPLAY_SEGMENTS.filter((_, k) => segmentCurrent(hg, sim, k) > 0.003).map((s) => s.name);
    expect(lit).toEqual(["a", "b", "d", "e", "g"]);
    const ia = segmentCurrent(hg, sim, 0);
    expect(ia).toBeGreaterThan(0.006);
    expect(ia).toBeLessThan(0.011);
  });
});
