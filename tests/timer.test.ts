import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, sequenceExpected, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

describe("компараторы и таймер: LMV331 → LM393 → NE555", () => {
  it("таблица 555 — как у TI: RESET̅ главнее всего, TRIG главнее THRES, между порогами — как было", () => {
    const l = levelById("ne555")!;
    const exp = sequenceExpected(l, 0);
    const at = (s: string) => l.sequence!.findIndex((x, i) => i > 0 && x.in.map(Number).join("") === s);
    expect(exp[at("001")]).toEqual([true, true]);
    expect(exp[at("111")]).toEqual([false, false]);
    expect(exp[at("011")]).toEqual([true, true]);
    expect(exp[at("000")]).toEqual([false, false]);
  });
  for (const id of ["lmv331", "lm393", "ne555"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const t0 = performance.now();
      const r = checkLevel(level, scene, allChips);
      console.log(id, Math.round(performance.now() - t0), "мс\n" + (r.steps ?? []).map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n"), r.problems, r.diagnosis ?? "");
      expect(r.ok).toBe(true);
    }, 180000);
  }

  it("компаратор без входных повторителей (вход прямо на пару) не проходит: у общего провода вход берёт ток", () => {
    const level = levelById("lmv331")!;
    const nets = level.recipe.nets.map((n) => n.map((e) => (e === "VT6.B" ? "VT1.B" : e === "VT7.B" ? "VT2.B" : e))).map((n) => n.filter((e) => !/^VT[67]\.|^R[23]\./.test(e))).filter((n) => n.length > 1);
    const scene = recipeScene({ ...level, recipe: { ...level.recipe, nets } }, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.steps!.find((x) => x.text.startsWith("Вход"))!.ok).toBe(false);
  }, 60000);
  it("555, у которого выход берут прямо с Q (сброс главнее установки), не проходит таблицу", () => {
    const level = levelById("ne555")!;
    const nets = level.recipe.nets.map((n) => n.filter((e) => e !== "D7.4" && e !== "P3")).filter((n) => n.length > 1).concat([["D4.4", "P3"]]);
    const scene = recipeScene({ ...level, recipe: { ...level.recipe, nets } }, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
  }, 120000);
});
