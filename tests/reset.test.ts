import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, sequenceExpected, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, publicChips, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

function checkWith(level: Level, recipe?: Level["recipe"]) {
  const scene = recipeScene(recipe ? { ...level, recipe } : level, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
}
/** Заменить в цепях рецепта: убрать концы и добавить цепи. */
const rewire = (level: Level, drop: string[], add: string[][] = []): Level["recipe"] => ({
  parts: level.recipe.parts,
  nets: [...level.recipe.nets.map((n) => n.filter((e) => !drop.includes(e))).filter((n) => n.length > 1), ...add],
});

describe("сброс: 74LVC1G175, 74HC164, 74HC393", () => {
  it("эталоны проходят; настоящие — в песочнице, ступеньки — нет", () => {
    for (const id of ["dlatchr", "dffr", "sreg8", "tffr", "cnt393"]) expect(checkWith(levelById(id)!).ok).toBe(true);
    const shown = publicChips(refs).map((d) => d.id);
    expect(shown).toEqual(expect.arrayContaining(["ref:dffr", "ref:sreg8", "ref:cnt393"]));
    expect(shown).not.toContain("ref:dlatchr");
    expect(shown).not.toContain("ref:tffr");
  });

  it("по даташитам: 164 вдвигает A И B; 393 считает по спаду, сброс единицей, счётчики независимы", () => {
    const num = (b: boolean[]) => b.reduce((m, x, k) => m | (x ? 1 << k : 0), 0);
    const r164 = sequenceExpected(levelById("sreg8")!).map(num);
    // После сброса: 1, потом 0 (A = 0), потом 0 (B = 0), потом 1, 1: QA…QH = 1,1,0,0,1 → 0b10011
    expect(r164[15]).toBe(0b10011);
    expect(r164[16]).toBe(0);
    const r393 = sequenceExpected(levelById("cnt393")!).map(num);
    // 17 импульсов на первый: 17 mod 16 = 1; 3 на второй
    expect(r393[35] & 15).toBe(1);
    expect(r393[41] >> 4).toBe(3);
    // Сброс первого не трогает второй
    expect(r393[42]).toBe(3 << 4);
  });

  it("74LVC1G175 со сбросом только на второй защёлке не проходит: после сброса при CLK = 1 выход возвращается", () => {
    const level = levelById("dffr")!;
    expect(checkWith(level, rewire(level, ["M.6"], [["P5", "M.6"]])).ok).toBe(false);
  });

  it("74HC164 без И (только A) не проходит — вдвигает единицу при B = 0", () => {
    const level = levelById("sreg8")!;
    expect(checkWith(level, rewire(level, ["A.4", "P1", "P2"], [["P1", "F0.3"]])).ok).toBe(false);
  });

  it("74HC393 с одним сбросом на оба счётчика не проходит", () => {
    const level = levelById("cnt393")!;
    const r = checkWith(level, rewire(level, ["T4.6", "T5.6", "T6.6", "T7.6"], [["P2", "T4.6", "T5.6", "T6.6", "T7.6"]]));
    expect(r.ok).toBe(false);
  });
});
