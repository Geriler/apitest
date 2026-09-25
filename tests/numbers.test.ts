import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, sequenceExpected, truth, type LogicFunc } from "../src/career/levels";
import { checkLevel, publicChips, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const bits = (x: number, n: number) => Array.from({ length: n }, (_, i) => !!(x & (1 << i)));

describe("числа: 74HC85, 74HC595, АЛУ", () => {
  it("74HC85 по таблице TI: сравнение, каскад, строки параллельного каскада", () => {
    const t = (a: number, b: number, g: boolean, e: boolean, l: boolean) => truth("mag4", [...bits(a, 4), ...bits(b, 4), g, e, l]);
    expect(t(9, 3, false, true, false)).toEqual([true, false, false]);
    expect(t(3, 9, false, true, false)).toEqual([false, false, true]);
    expect(t(5, 5, false, true, false)).toEqual([false, true, false]);
    expect(t(5, 5, true, false, false)).toEqual([true, false, false]);
    expect(t(5, 5, true, false, true)).toEqual([false, false, false]);
    expect(t(5, 5, false, false, false)).toEqual([true, false, true]);
  });
  it("АЛУ: 7 − 9 = −2 (1110, заём), 9 − 7 = 2 (C4 = 1), 9 + 9 = 18 (C4 = 1)", () => {
    const f = (a: number, b: number, sub: boolean) => truth("addsub", [...bits(a, 4), ...bits(b, 4), sub]);
    expect(f(7, 9, true)).toEqual([...bits(14, 4), false]);
    expect(f(9, 7, true)).toEqual([...bits(2, 4), true]);
    expect(f(9, 9, false)).toEqual([...bits(2, 4), true]);
  });
  it("74HC595: выходы меняются только по RCLK; при общих часах хранение на такт позади", () => {
    const l = levelById("hc595")!;
    const exp = sequenceExpected(l, 0);
    const i = l.sequence!.findIndex((s, k) => k > 3 && s.in.join() === [true, false, true, true, false].join());
    // После RCLK в хранении 101 (QA = 1, QB = 0, QC = 1)
    expect(exp[i].slice(0, 3)).toEqual([true, false, true]);
    expect(exp[i + 2].slice(0, 3)).toEqual([true, false, true]);
  });
  it("учебные разряд компаратора и АЛУ не попадают в песочницу", () => {
    const shown = publicChips(refs).map((d) => d.id);
    expect(shown).not.toContain("ref:mag1");
    expect(shown).not.toContain("ref:alu4");
    expect(shown).toContain("ref:hc85");
    expect(shown).toContain("ref:hc595");
  });
  for (const id of ["mag1", "hc85", "hc595", "alu4"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const t0 = performance.now();
      const r = checkLevel(level, scene, allChips);
      console.log(id, Math.round(performance.now() - t0), "мс", r.rows.length, "строк", r.problems, r.diagnosis ?? "");
      expect(r.ok).toBe(true);
    }, 120000);
  }

  it("595 без регистра хранения (выходы прямо с 164-го) не проходит: выходы меняются при сдвиге", () => {
    const level = levelById("hc595")!;
    const nets = level.recipe.nets.map((n) => n.filter((e) => !/^D[2-9]\./.test(e))).filter((n) => n.length > 1)
      .concat([3, 4, 5, 6, 10, 11, 12, 13].map((p, k) => [`D1.${p}`, `P${[15, 1, 2, 3, 4, 5, 6, 7][k]}`]));
    const scene = recipeScene({ ...level, recipe: { ...level.recipe, nets } }, chipFor);
    applyBoards(scene.boards!);
    expect(checkLevel(level, scene, allChips).ok).toBe(false);
  }, 60000);
  it("АЛУ без «+1» (перенос сумматора на общем) вычитает на единицу меньше и не проходит", () => {
    const level = levelById("alu4")!;
    const nets = level.recipe.nets.map((n) => n.filter((e) => e !== "D1.7")).concat([["P8", "D1.7"]]);
    const scene = recipeScene({ ...level, recipe: { ...level.recipe, nets } }, chipFor);
    applyBoards(scene.boards!);
    expect(checkLevel(level, scene, allChips).ok).toBe(false);
  }, 60000);
});
