import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { HOLE_BY_ID, applyBoards, footprintPads, padsAlong, seatHole, seatProblem, type BoardSpec } from "../src/model/breadboard";
import { MOSFETS, TRANSISTORS, footprintOf, padNumbers, smdOnly, type Component, type Scene } from "../src/model/types";
import { Simulation, pinNode, traceResistance } from "../src/sim/simulation";
import { LEVELS, SMD_TWIN, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, kitIndex, levelCase, levelScene, recipeScene, referenceChips } from "../src/career/build";
import { kitTools } from "../src/career/session";

setLibrary([]);

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) * 2.54;

describe("посадочные места SMD", () => {
  it("SOT-23: шаг 0,95 мм, вывод 3 напротив; SOIC-14: шаг 1,27 мм, вывод 8 напротив 7, как у DIP", () => {
    const sot = footprintPads("SOT-23");
    expect(sot[1].x - sot[0].x).toBeCloseTo(1.9);
    expect(sot[2].x).toBeCloseTo(0);
    expect(sot[2].z).toBeLessThan(0);
    const so = footprintPads("SO-14");
    expect(so[1].x - so[0].x).toBeCloseTo(1.27);
    expect(so[7].x).toBeCloseTo(so[6].x);
    expect(so[0].z - so[13].z).toBeCloseTo(5.4);
    const s5 = footprintPads("SOT-23-5");
    expect([s5[3].x, s5[4].x]).toEqual([s5[2].x, s5[0].x]);
    expect(footprintPads("0805")[1].x - footprintPads("0805")[0].x).toBeCloseTo(1.9);
  });

  it("площадки появляются под деталью, поворачиваются с ней и не налезают на соседей", () => {
    const b: BoardSpec = { id: "S1", kind: "smd", x: 10, z: 5, cols: 24, rows: 15, seats: [{ id: "U1", fp: "SO-14", x: 0, z: -2, rot: 0 }] };
    applyBoards([b]);
    const p1 = HOLE_BY_ID.get(seatHole(b, "U1", 1))!;
    const p2 = HOLE_BY_ID.get("s:U1.2")!;
    expect(dist(p1, p2)).toBeCloseTo(1.27);
    expect(p1.w! * 2.54).toBeCloseTo(0.6);
    expect(p1.seat).toBe("U1");
    // Поворот на четверть: ряд выводов идёт вдоль Z, площадки поворачиваются
    b.seats![0].rot = 1;
    applyBoards([b]);
    const q1 = HOLE_BY_ID.get("s:U1.1")!, q2 = HOLE_BY_ID.get("s:U1.2")!;
    expect(q1.x).toBeCloseTo(q2.x);
    expect(q1.d! * 2.54).toBeCloseTo(0.6);
    b.seats![0].rot = 0;
    expect(seatProblem(b, { id: "R1", fp: "0805", x: 1, z: -2, rot: 0 })).toMatch(/U1/);
    expect(seatProblem(b, { id: "R1", fp: "0805", x: 0, z: 3, rot: 0 })).toBeUndefined();
    // У ближнего края — площадки J для проводов, туда нельзя
    expect(seatProblem(b, { id: "R1", fp: "0805", x: 0, z: 6.5, rot: 0 })).toMatch(/край/);
  });

  it("выводные детали делают себе отверстия на шаге 2,54 мм: DIP-14 — ряды через 7,62 мм, резистор 0,25 Вт — 10,16 мм", () => {
    const at = { mode: "free" as const, x: 0, z: 0, rot: 0 };
    const dip = footprintPads("DIP-14");
    expect(dip[1].x - dip[0].x).toBeCloseTo(2.54);
    expect(dip[0].z - dip[13].z).toBeCloseTo(7.62);
    expect(dip[7].x).toBeCloseTo(dip[6].x);
    const r = footprintOf({ id: "R1", type: "resistor", variant: "tht", ohms: 1e3, smdSize: "0805", placement: at })!;
    expect(r).toBe("TH2-4");
    expect(footprintOf({ id: "HL1", type: "led", color: "red", placement: at })).toBe("TH2-1");
    expect(footprintOf({ id: "EL1", type: "lamp", kind: "6.3V", placement: at })).toBe("TH2-2");
    expect(footprintOf({ id: "VT1", type: "mosfet", kind: "2N7000", placement: at })).toBe("TH3");
    // Узел дорожки ничего не занимает — его можно поставить и под корпус
    const b: BoardSpec = { id: "S1", kind: "smd", x: 0, z: 0, cols: 24, rows: 15, seats: [{ id: "U1", fp: "SO-14", x: 0, z: 0, rot: 0 }] };
    expect(seatProblem(b, { id: "n1", fp: "NODE", x: 0, z: 0, rot: 0 })).toBeUndefined();
    expect(seatProblem(b, { id: "R1", fp: "TH2-4", x: 0, z: 0, rot: 0 })).toMatch(/U1/);
  });

  it("корпуса деталей: SOT-23 у SMD-транзисторов, SOIC у DIP-микросхем; у BC847 коллектор — вывод 3", () => {
    const at = { mode: "free" as const, x: 0, z: 0, rot: 0 };
    const bc: Component = { id: "VT1", type: "transistor", kind: "BC847", placement: at };
    expect(footprintOf(bc)).toBe("SOT-23");
    expect(padNumbers(bc, 3)).toEqual([3, 1, 2]);
    expect(smdOnly(bc)).toBe(true);
    expect(smdOnly({ id: "VT2", type: "mosfet", kind: "2N7000", placement: at })).toBe(false);
    expect(footprintOf({ id: "U1", type: "chip", def: "x", name: "x", package: "DIP", pins: 16, placement: at })).toBe("DIP-16");
    expect(footprintOf({ id: "U1", type: "chip", def: "x", name: "x", package: "DIP", pins: 16, smd: true, placement: at })).toBe("SO-16");
    expect(footprintOf({ id: "R1", type: "resistor", variant: "smd", ohms: 1e3, smdSize: "0805", placement: at })).toBe("0805");
    expect(MOSFETS["2N7002"].pins).toEqual(["G", "S", "D"]);
    expect(MOSFETS.BSS84.pins).toEqual(["G", "S", "D"]);
    expect(TRANSISTORS.BC847.maxP).toBe(0.31);
  });

  it("тонкая дорожка 0,3 мм — в 6 раз больше сопротивление; дорожка через чужую площадку с ней соединяется", () => {
    const b: BoardSpec = {
      id: "S1", kind: "smd", x: 0, z: 0, cols: 24, rows: 15,
      seats: [{ id: "VT1", fp: "SOT-23", x: -4, z: -2, rot: 0 }, { id: "VT2", fp: "SOT-23", x: 4, z: -2, rot: 0 }],
    };
    applyBoards([b, { id: "PCB1", kind: "pcb", x: 0, z: 30, cols: 24, rows: 14 }]);
    const fine = traceResistance("s:J1", "s:J11");
    const wide = traceResistance("pA1", "pA11");
    expect(fine / wide).toBeCloseTo(1.83 / 0.3, 1);
    // От затвора VT1 к затвору VT2 по прямой — прямо через исток VT1
    expect(padsAlong("s:VT1.1", "s:VT2.1")).toEqual(["s:VT1.1", "s:VT1.2", "s:VT2.1"]);
  });

  it("инвертор на плате под SMD: BSS84 + 2N7002 в SOT-23, дорожки, питание к площадкам J", () => {
    const b: BoardSpec = {
      id: "S1", kind: "smd", x: 0, z: 0, cols: 24, rows: 15,
      seats: [{ id: "VT1", fp: "SOT-23", x: -4, z: -2, rot: 0 }, { id: "VT2", fp: "SOT-23", x: 4, z: -2, rot: 0 }],
    };
    applyBoards([b]);
    const holes = (id: string) => [1, 2, 3].map((n) => `s:${id}.${n}`);
    const tr: [string, string][] = [["s:VT1.2", "s:J1"], ["s:VT2.2", "s:J2"], ["s:VT1.1", "s:J5"], ["s:VT2.1", "s:J5"], ["s:VT1.3", "s:J10"], ["s:VT2.3", "s:J10"]];
    const scene: Scene = {
      components: [
        { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: { mode: "free", x: 0, z: 20, rot: 0 } },
        { id: "VT1", type: "mosfet", kind: "BSS84", placement: { mode: "board", holes: holes("VT1") } },
        { id: "VT2", type: "mosfet", kind: "2N7002", placement: { mode: "board", holes: holes("VT2") } },
      ],
      wires: [
        { id: "W1", a: { comp: "G1", pin: 1 }, b: { hole: "s:J1" }, color: "" },
        { id: "W2", a: { comp: "G1", pin: 0 }, b: { hole: "s:J2" }, color: "" },
      ],
      traces: tr.map(([a, b2], i) => ({ id: `T${i}`, a, b: b2 })),
      boards: [b],
    };
    const out = (input: 0 | 1) => {
      scene.wires = scene.wires.slice(0, 2).concat({ id: "W3", a: { comp: "G1", pin: input }, b: { hole: "s:J5" }, color: "" });
      const sim = new Simulation(scene);
      sim.solve();
      return sim.solution.voltage.get(HOLE_BY_ID.get("s:J10")!.node)! - sim.solution.voltage.get(pinNode(scene.components[0], 0))!;
    };
    expect(out(0)).toBeGreaterThan(4.9);
    expect(out(1)).toBeLessThan(0.1);
  });
});

describe("карьера на SMD", () => {
  const refs = referenceChips();
  const refById = new Map(refs.map((d) => [d.id, d]));
  const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
  const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

  it("стол уровня по умолчанию — корпус с полем под SMD; эталонная сборка — на сетке", () => {
    const level = LEVELS.find((l) => l.id === "nand-cmos")!;
    expect(levelScene(level).boards![0].smd).toBe(true);
    expect(levelScene(level, false).boards![0].smd).toBeFalsy();
    expect(recipeScene(level, chipFor).boards![0].smd).toBeFalsy();
  });

  it("корпус с полем под SMD: набор выдаёт SMD-пары — 2N7002, BSS84, резисторы 0805; они засчитываются в ту же строку", () => {
    const level = LEVELS.find((l) => l.id === "nand-cmos")!;
    const box = { ...levelCase(level), smd: true, seats: [] };
    const scene: Scene = { components: [], wires: [], boards: [box], career: { level: level.id } };
    applyBoards(scene.boards!);
    const tools = kitTools(scene);
    const made = tools.map((t) => t.def.create(t.def.settings) as { kind?: string });
    expect(made.map((m) => m.kind).sort()).toEqual(["2N7002", "BSS84"]);
    const at = { mode: "free" as const, x: 0, z: 0, rot: 0 };
    expect(kitIndex(level.kit, { id: "VT1", type: "mosfet", kind: "2N7002", placement: at })).toBe(level.kit.findIndex((k) => k.part === "mosfet" && k.kind === "2N7000"));
    // Поле под SMD — без сетки площадок, выводы корпуса на месте
    expect(HOLE_BY_ID.has("k:A1")).toBe(false);
    expect(HOLE_BY_ID.has("k:1")).toBe(true);
  });

  // Уровни из транзисторов, собранные на SMD-парах, проходят ту же проверку
  const transistorLevels = LEVELS.filter((l) => l.kit.some((k) => k.part === "mosfet" || k.part === "bjt"));
  for (const level of transistorLevels) {
    it(`${level.id}: на ${[...new Set(level.kit.flatMap((k) => (k.part === "mosfet" || k.part === "bjt" ? [SMD_TWIN[k.kind]] : [])))].join(", ")} проходит проверку`, () => {
      const smd: Level = { ...level, recipe: { ...level.recipe, parts: level.recipe.parts.map((p) => (p.kind ? { ...p, kind: SMD_TWIN[p.kind] ?? p.kind } : p)) } };
      const scene = recipeScene(smd, chipFor);
      expect(scene.components.some((c) => (c.type === "mosfet" || c.type === "transistor") && Object.values(SMD_TWIN).includes(c.kind))).toBe(true);
      applyBoards(scene.boards!);
      const r = checkLevel(level, scene, allChips);
      expect(r.diagnosis ?? []).toEqual([]);
      expect(r.ok).toBe(true);
    }, 30000);
  }
});
