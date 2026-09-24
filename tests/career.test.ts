import { describe, expect, it } from "vitest";
import { applyBoards } from "../src/model/breadboard";
import type { ChipDef, Component } from "../src/model/types";
import { chipInner } from "../src/chips/package";
import { setLibrary } from "../src/chips/registry";
import { LEVELS, levelById, type LogicFunc } from "../src/career/levels";
import { checkLevel, kitIndex, kitUsed, packageRecipe, recipeScene, referenceChips, truthTable, type Metrics } from "../src/career/build";
import { bestOf, failsOf, hintsOf, recordFail, recordMetrics, revealHint } from "../src/career/session";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

describe("карьера: уровни", () => {
  for (const level of LEVELS) {
    it(`${level.part} (${level.id}): эталон собран ровно из набора и проходит таблицу истинности`, () => {
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      // Всё на корпусе — из набора и не больше выданного
      const inner = chipInner(scene);
      expect(inner.map((c) => kitIndex(level.kit, c)).every((i) => i >= 0)).toBe(true);
      const used = kitUsed(level.kit, scene);
      level.kit.forEach((k, i) => expect(used[i], JSON.stringify(k)).toBeLessThanOrEqual(k.count));
      const t0 = performance.now();
      const r = checkLevel(level, scene, allChips);
      const ms = performance.now() - t0;
      expect(r.problems).toEqual([]);
      expect(r.rows.map((x) => x.ok)).toEqual(r.rows.map(() => true));
      expect(r.ok).toBe(true);
      expect(r.def!.id).toBe(`career:${level.id}`);
      expect(r.def!.package).toBe(level.package ?? "SOT-23-5");
      // Время проверки — чтобы видеть, не тормозят ли составные
      expect(ms).toBeLessThan(20_000);
    });
  }

  it("лишняя деталь и чужой номинал не проходят; схема с ошибкой — строки с ✗", () => {
    const level = levelById("not-rtl")!;
    const scene = recipeScene(level, chipFor);
    applyBoards(scene.boards!);
    // Резистор 1 кОм заменили на 470 Ом — такого в наборе нет
    const r2 = scene.components.find((c) => c.id === "R2") as Extract<Component, { type: "resistor" }>;
    r2.ohms = 470;
    expect(checkLevel(level, scene, allChips).problems.join(" ")).toMatch(/R2 — не из набора/);
    r2.ohms = 1000;
    // Второй транзистор сверх набора
    scene.components.push({ id: "VT9", type: "transistor", kind: "BC547", placement: { mode: "board", holes: ["k:H10", "k:H11", "k:H12"] } });
    expect(checkLevel(level, scene, allChips).problems.join(" ")).toMatch(/BC547: в наборе 1, а стоит 2/);
    scene.components.pop();
    // Забыли резистор в коллекторе: выход не поднимается в единицу
    scene.wires = scene.wires.filter((w) => !["a", "b"].some((k) => JSON.stringify(w[k as "a" | "b"]).includes('"k:5"')));
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.rows.some((x) => !x.ok)).toBe(true);
  });

  it("эталоны для песочницы: у каждого уровня свой, составные внутри из эталонных КМОП-вентилей; XOR — 16 транзисторов", () => {
    expect(refs.map((d) => d.id).sort()).toEqual(LEVELS.map((l) => `ref:${l.id}`).sort());
    const xor = refById.get("ref:xor")!;
    expect(xor.parts.every((p) => p.type === "chip" && p.def === "ref:nand-cmos")).toBe(true);
    const rows = truthTable(xor, levelById("xor")!, allChips);
    expect(rows.map((r) => r.ok)).toEqual([true, true, true, true]);
  });

  it("составной уровень из своих микросхем игрока: И из РТЛ-вентилей тоже проходит", () => {
    const own = (func: LogicFunc): ChipDef => {
      const level = LEVELS.find((l) => l.func === func && l.id.endsWith("rtl"))!;
      return packageRecipe(level, `career:${level.id}`, chipFor);
    };
    const level = levelById("and")!;
    const mine = { nand: own("nand"), not: own("not") } as Record<string, ChipDef>;
    const scene = recipeScene(level, (f) => mine[f]);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, { ...allChips, ...Object.fromEntries(Object.values(mine).map((d) => [d.id, d])) });
    expect(r.rows.map((x) => x.ok)).toEqual([true, true, true, true]);
  });
});

describe("карьера: цифры сборки", () => {
  const run = (id: string) => {
    const level = levelById(id)!;
    const scene = recipeScene(level, chipFor);
    applyBoards(scene.boards!);
    return { scene, r: checkLevel(level, scene, allChips) };
  };

  it("ток покоя: КМОП — почти ноль, РТЛ — миллиамперы; транзисторы по кусочкам; соединения и площадь — по сборке", () => {
    const cmos = run("not-cmos").r.metrics!;
    const rtl = run("not-rtl").r.metrics!;
    expect(cmos.idle).toBeLessThan(1e-6);
    // Выход в нуле: через резистор 1 кОм от 5 В течёт около 5 мА
    expect(rtl.idle).toBeGreaterThan(4e-3);
    expect(rtl.idle).toBeLessThan(6e-3);
    expect([cmos.transistors, rtl.transistors]).toEqual([2, 1]);
    const { scene, r } = run("xor");
    expect(r.metrics!.transistors).toBe(16);
    // Соединения — все перемычки эталона (они внутри корпуса)
    expect(r.metrics!.links).toBe(scene.wires.length);
    expect(r.metrics!.width).toBeGreaterThan(0);
    expect(r.metrics!.height).toBeGreaterThan(0);
  });

  it("лучшие цифры: каждая запоминается сама; хуже — не затирает", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    const base: Metrics = { width: 5, height: 4, links: 10, idle: 1e-3, transistors: 2 };
    expect(recordMetrics("t", base)).toEqual([]);
    expect(recordMetrics("t", { ...base, width: 3, links: 12 })).toEqual(["width"]);
    expect(recordMetrics("t", { ...base, links: 8, idle: 2e-3 })).toEqual(["links"]);
    expect(bestOf("t")).toEqual({ width: 3, height: 4, links: 8, idle: 1e-3, transistors: 2 });
  });
});

describe("карьера: что проверить и подсказки", () => {
  const broken = (id: string, change: (s: ReturnType<typeof recipeScene>) => void) => {
    const level = levelById(id)!;
    const scene = recipeScene(level, chipFor);
    change(scene);
    applyBoards(scene.boards!);
    return checkLevel(level, scene, allChips);
  };
  const dropWiresAt = (s: ReturnType<typeof recipeScene>, hole: string) =>
    (s.wires = s.wires.filter((w) => ![w.a, w.b].some((e) => "hole" in e && e.hole === hole)));

  it("выход не подтянут к питанию — «никто уверенно не тянет»; вывод питания без связи — назван", () => {
    // РТЛ-инвертор без резистора к питанию (вывод 5 ни к чему не подключён)
    const r = broken("not-rtl", (s) => dropWiresAt(s, "k:5"));
    expect(r.ok).toBe(false);
    const text = r.diagnosis!.join(" ");
    expect(text).toMatch(/Вывод 5 VCC ни к чему внутри не подключён/);
    expect(text).toMatch(/При A = 0 нужна единица, а выход (ни за что не держится|висит посередине|прижат к общему)/);
    // Решения в диагностике нет: ни «резистор», ни «транзистор»
    expect(text).not.toMatch(/резистор|транзистор/i);
  });

  it("вход прямо на базу — сгорает, и это сказано", () => {
    const level = levelById("not-rtl")!;
    const r = broken("not-rtl", (s) => {
      // Убрать резистор базы из цепи: вход — прямо на базу
      const vt = s.components.find((c) => c.id === "VT1")!;
      const base = (vt.placement as { holes: string[] }).holes[1];
      s.wires = s.wires.filter((w) => ![w.a, w.b].some((e) => "hole" in e && e.hole === "k:2"));
      s.wires.push({ id: "X", a: { hole: "k:2" }, b: { hole: base }, color: "" });
    });
    expect(r.ok).toBe(false);
    expect(r.diagnosis!.join(" ")).toMatch(/При проверке сгорело или перегружено сверх номинала: VT1/);
    expect(level.hints).toHaveLength(2);
  });

  it("подсказки: только после двух неудачных проверок и по одной", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    revealHint("h", 2);
    expect(hintsOf("h")).toBe(0);
    recordFail("h");
    revealHint("h", 2);
    expect(hintsOf("h")).toBe(0);
    recordFail("h");
    revealHint("h", 2);
    expect(hintsOf("h")).toBe(1);
    revealHint("h", 2);
    revealHint("h", 2);
    expect(hintsOf("h")).toBe(2);
    expect(failsOf("h")).toBe(2);
  });
});

describe("карьера: висящий выход", () => {
  it("И-НЕ без связи с общим не проходит: выход «идёт за нагрузкой»", () => {
    const level = levelById("nand-cmos")!;
    const scene = recipeScene(level, chipFor);
    scene.wires = scene.wires.filter((w) => ![w.a, w.b].some((e) => "hole" in e && e.hole === "k:3"));
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.rows.find((x) => x.inputs.every(Boolean))!.floating).toEqual([true]);
    expect(r.diagnosis!.join(" ")).toMatch(/Вывод 3 GND ни к чему внутри не подключён/);
    expect(r.diagnosis!.join(" ")).toMatch(/При A = 1, B = 1 нужен ноль, а выход ни за что не держится/);
  });
});


describe("карьера: несколько выходов", () => {
  it("полный сумматор: 8 строк, по два выхода; сумма и перенос по отдельности", () => {
    const level = levelById("full")!;
    const scene = recipeScene(level, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.rows).toHaveLength(8);
    // A=1 B=1 CI=1 → CO=1, S=1
    const all = r.rows.find((x) => x.inputs.every(Boolean))!;
    expect(all.expected).toEqual([true, true]);
    expect(all.volts.every((v) => v > 4.5)).toBe(true);
    expect(r.metrics!.transistors).toBeGreaterThan(30);
  });

  it("полусумматор без провода к S: сказано, что именно S не так, а C в порядке", () => {
    const level = levelById("half")!;
    const scene = recipeScene(level, chipFor);
    scene.wires = scene.wires.filter((w) => ![w.a, w.b].some((e) => "hole" in e && e.hole === "k:5"));
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.rows.every((x) => x.each[0])).toBe(true);
    const text = r.diagnosis!.join(" ");
    expect(text).toMatch(/Вывод 5 S ни к чему внутри не подключён/);
    expect(text).toMatch(/на S нужна единица, а выход S/);
    expect(text).not.toMatch(/на C нужн/);
  });
});
