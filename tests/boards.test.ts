import { afterEach, describe, expect, it } from "vitest";
import {
  BOARD,
  DEFAULT_BOARDS,
  HOLES,
  HOLE_BY_ID,
  applyBoards,
  boardRect,
  boardsFromLayout,
  boardsOverlap,
  describeNode,
  holeLabel,
  nextBoardId,
  padsAlong,
  type BoardSpec,
} from "../src/model/breadboard";
import { boardConflicts, sceneBoards, type Scene } from "../src/model/types";
import { Simulation, wireResistance } from "../src/sim/simulation";

afterEach(() => applyBoards(DEFAULT_BOARDS));

const BB1: BoardSpec = { id: "BB1", kind: "breadboard", x: 0, z: 0 };
const PCB1: BoardSpec = { id: "PCB1", kind: "pcb", x: 0, z: 21, cols: 24, rows: 14 };

describe("платы на столе", () => {
  it("стартовый набор: отверстия на прежних местах (старые схемы открываются как были)", () => {
    expect(HOLES.filter((h) => h.board === "breadboard")).toHaveLength(400);
    expect(HOLES.filter((h) => h.kind === "pad")).toHaveLength(24 * 14);
    expect(HOLE_BY_ID.get("a1")).toMatchObject({ x: -14.5, z: -5.5, boardId: "BB1" });
    expect(HOLE_BY_ID.get("top+1")).toMatchObject({ x: -14, z: -9 });
    expect(HOLE_BY_ID.get("pA1")).toMatchObject({ x: -12, z: 14, boardId: "PCB1" });
    expect(HOLE_BY_ID.get("pN24")).toMatchObject({ x: 11, z: 27 });
  });

  it("старая раскладка превращается в платы на тех же местах", () => {
    applyBoards(boardsFromLayout({ breadboards: 2, pcbCols: 36, pcbRows: 20 }));
    expect(HOLE_BY_ID.get("2:a7")!.x - HOLE_BY_ID.get("a7")!.x).toBe(32);
    expect(HOLE_BY_ID.get("pA1")).toMatchObject({ x: -12, z: 14 });
    expect(HOLE_BY_ID.get("pT36")).toBeDefined();
    expect(boardsFromLayout({ breadboards: 1, pcbCols: 24, pcbRows: 14 })).toEqual(DEFAULT_BOARDS);
  });

  it("sceneBoards: boards важнее раскладки, без того и другого — стартовый набор, [] — пустой стол", () => {
    expect(sceneBoards({ components: [], wires: [] })).toEqual(DEFAULT_BOARDS);
    expect(sceneBoards({ components: [], wires: [], layout: { breadboards: 3, pcbCols: 24, pcbRows: 14 } }).map((b) => b.id)).toEqual(["BB1", "BB2", "BB3", "PCB1"]);
    expect(sceneBoards({ components: [], wires: [], boards: [], layout: { breadboards: 3, pcbCols: 24, pcbRows: 14 } })).toEqual([]);
  });

  it("перенос платы: id отверстий те же, координаты сдвигаются вместе с платой", () => {
    applyBoards([{ ...BB1, x: 40, z: -30 }, PCB1]);
    expect(HOLE_BY_ID.get("a1")).toMatchObject({ x: 25.5, z: -35.5 });
    expect(HOLE_BY_ID.get("pA1")).toMatchObject({ x: -12, z: 14 });
  });

  it("вторая макетка где угодно: свои полосы и шины, подпись с номером", () => {
    applyBoards([BB1, PCB1, { id: "BB2", kind: "breadboard", x: -10, z: -40 }]);
    const a7 = HOLE_BY_ID.get("a7")!;
    const b7 = HOLE_BY_ID.get("2:a7")!;
    expect(b7).toMatchObject({ x: a7.x - 10, z: a7.z - 40, boardId: "BB2" });
    expect(b7.node).not.toBe(a7.node);
    expect(HOLE_BY_ID.get("2:e7")!.node).toBe(b7.node);
    expect(holeLabel("2:c7")).toBe("макетка 2, c7");
    expect(new Set(HOLES.map((h) => h.id)).size).toBe(HOLES.length);
  });

  it("вторая печатная плата: площадки «p2:A1», дорожка не цепляет площадки другой платы", () => {
    // Вторая плата вплотную справа: её площадки на тех же z, что у первой
    const r = boardRect(PCB1);
    applyBoards([PCB1, { id: "PCB2", kind: "pcb", x: r.x1 + 13.5, z: 21, cols: 24, rows: 14 }]);
    expect(holeLabel("p2:A1")).toBe("плата 2, площадка A1");
    expect(holeLabel("pA1")).toBe("площадка A1");
    expect(describeNode(HOLE_BY_ID.get("p2:A1")!.node)).toBe("плата 2, площадка A1 (соединения — дорожками)");
    expect(padsAlong("pA1", "pA5")).toEqual(["pA1", "pA2", "pA3", "pA4", "pA5"]);
    expect(padsAlong("p2:A1", "p2:A3")).toEqual(["p2:A1", "p2:A2", "p2:A3"]);
    expect(new Set(HOLES.map((h) => h.id)).size).toBe(HOLES.length);
  });

  it("платы не налезают друг на друга, касаться краями можно", () => {
    const right = { ...BB1, id: "BB2", x: BOARD.width };
    expect(boardsOverlap(BB1, right)).toBe(false);
    expect(boardsOverlap(BB1, { ...right, x: BOARD.width - 1 })).toBe(true);
    // Стартовые макетка и печатная плата не пересекаются
    expect(boardsOverlap(BB1, PCB1)).toBe(false);
    expect(boardsOverlap(BB1, { ...PCB1, z: 18 })).toBe(true); // z0 = 9,5 < 10,5
  });

  it("номер новой платы: первый свободный", () => {
    expect(nextBoardId("breadboard", DEFAULT_BOARDS)).toBe("BB2");
    expect(nextBoardId("pcb", [BB1])).toBe("PCB1");
    expect(nextBoardId("breadboard", [{ ...BB1, id: "BB2" }])).toBe("BB1");
  });

  it("убрать плату или уменьшить нельзя, пока на ней что-то стоит", () => {
    const BB2: BoardSpec = { id: "BB2", kind: "breadboard", x: 32, z: 0 };
    const big: BoardSpec = { ...PCB1, cols: 36, rows: 20 };
    const scene: Scene = {
      components: [{ id: "R1", type: "resistor", variant: "tht", ohms: 100, smdSize: "0805", placement: { mode: "board", holes: ["2:a1", "2:a5"] } }],
      wires: [{ id: "W1", a: { hole: "a1" }, b: { hole: "2:a9" }, color: "" }],
      traces: [{ id: "T1", a: "pA30", b: "pA31" }, { id: "T2", a: "pA1", b: "pA2" }],
    };
    expect(boardConflicts(scene, [BB1, BB2, big])).toEqual([]);
    expect(boardConflicts(scene, [BB1, big]).sort()).toEqual(["R1", "W1"]);
    expect(boardConflicts(scene, [BB1, BB2, PCB1])).toEqual(["T1"]);
    expect(boardConflicts(scene, [BB2, big])).toEqual(["W1"]);
  });

  it("цепь через две макетки: провод соединяет шины; длиннее перемычка — больше её сопротивление", () => {
    const boards = [BB1, { id: "BB2", kind: "breadboard", x: 32, z: 0 } as BoardSpec];
    applyBoards(boards);
    const scene: Scene = {
      components: [
        { id: "GB1", type: "battery", kind: "9V", placement: { mode: "free", x: -30, z: 0, rot: 0 } },
        { id: "R1", type: "resistor", variant: "tht", ohms: 1000, smdSize: "0805", placement: { mode: "board", holes: ["2:top+3", "2:top-3"] } },
      ],
      wires: [
        { id: "W1", a: { comp: "GB1", pin: 1 }, b: { hole: "top+1" }, color: "" },
        { id: "W2", a: { comp: "GB1", pin: 0 }, b: { hole: "top-1" }, color: "" },
        { id: "W3", a: { hole: "top+25" }, b: { hole: "2:top+1" }, color: "" },
        { id: "W4", a: { hole: "top-25" }, b: { hole: "2:top-1" }, color: "" },
      ],
      boards,
    };
    const sim = new Simulation(scene);
    expect(sim.branch("R1").current).toBeGreaterThan(0.0089);
    const near = wireResistance(scene, scene.wires[2]);
    applyBoards([BB1, { ...boards[1], x: 32, z: 60 }]);
    expect(wireResistance(scene, scene.wires[2])).toBeGreaterThan(near * 1.5);
    // Без перемычек между макетками тока нет
    scene.wires = scene.wires.slice(0, 2);
    sim.solve();
    expect(sim.branch("R1").current).toBe(0);
  });
});
