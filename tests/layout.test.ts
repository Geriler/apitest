import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, HOLES, HOLE_BY_ID, applyLayout, holeExistsIn, holeLabel } from "../src/model/breadboard";
import { layoutConflicts, type Scene } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";

afterEach(() => applyLayout(DEFAULT_LAYOUT));

describe("раскладка плат", () => {
  it("две макетки: 800 отверстий, вторая вплотную справа со своими полосами и шинами", () => {
    applyLayout({ ...DEFAULT_LAYOUT, breadboards: 2 });
    expect(HOLES.filter((h) => h.board === "breadboard")).toHaveLength(800);
    const a7 = HOLE_BY_ID.get("a7")!;
    const b7 = HOLE_BY_ID.get("2:a7")!;
    expect(b7.x - a7.x).toBe(32);
    expect(b7.node).not.toBe(a7.node);
    expect(HOLE_BY_ID.get("2:e7")!.node).toBe(b7.node);
    expect(HOLE_BY_ID.get("2:top+1")!.node).not.toBe(HOLE_BY_ID.get("top+1")!.node);
    expect(holeLabel("2:c7")).toBe("макетка 2, c7");
    expect(holeLabel("3:top+4")).toBe("3:top+4"); // третьей нет
    expect(new Set(HOLES.map((h) => h.id)).size).toBe(HOLES.length);
  });

  it("печатная плата 36 × 20: 720 площадок, прежние остаются на тех же местах", () => {
    const before = { ...HOLE_BY_ID.get("pA1")! };
    const n14 = { ...HOLE_BY_ID.get("pN14")! };
    applyLayout({ ...DEFAULT_LAYOUT, pcbCols: 36, pcbRows: 20 });
    expect(HOLES.filter((h) => h.kind === "pad")).toHaveLength(720);
    expect(HOLE_BY_ID.get("pA1")!.x).toBe(before.x);
    expect(HOLE_BY_ID.get("pA1")!.z).toBe(before.z);
    expect(HOLE_BY_ID.get("pN14")!.x).toBe(n14.x);
    expect(HOLE_BY_ID.get("pT36")).toBeDefined();
  });

  it("holeExistsIn совпадает с перестроенными платами", () => {
    for (const layout of [DEFAULT_LAYOUT, { breadboards: 3, pcbCols: 48, pcbRows: 26 }, { breadboards: 2, pcbCols: 36, pcbRows: 20 }]) {
      applyLayout({ breadboards: 3, pcbCols: 48, pcbRows: 26 });
      const all = HOLES.map((h) => h.id);
      applyLayout(layout);
      for (const id of all) expect(holeExistsIn(id, layout), `${id} в ${JSON.stringify(layout)}`).toBe(HOLE_BY_ID.has(id));
    }
  });

  it("уменьшение не пройдёт, пока на отрезаемой части что-то стоит", () => {
    applyLayout({ breadboards: 2, pcbCols: 36, pcbRows: 20 });
    const scene: Scene = {
      components: [{ id: "R1", type: "resistor", variant: "tht", ohms: 100, smdSize: "0805", placement: { mode: "board", holes: ["2:a1", "2:a5"] } }],
      wires: [{ id: "W1", a: { hole: "a1" }, b: { hole: "2:a9" }, color: "" }],
      traces: [{ id: "T1", a: "pA30", b: "pA31" }, { id: "T2", a: "pA1", b: "pA2" }],
    };
    expect(layoutConflicts(scene, DEFAULT_LAYOUT).sort()).toEqual(["R1", "T1", "W1"]);
    expect(layoutConflicts(scene, { breadboards: 2, pcbCols: 36, pcbRows: 20 })).toEqual([]);
  });

  it("цепь через две макетки: провод соединяет шины первой и второй", () => {
    applyLayout({ ...DEFAULT_LAYOUT, breadboards: 2 });
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
      layout: { ...DEFAULT_LAYOUT, breadboards: 2 },
    };
    const sim = new Simulation(scene);
    expect(sim.branch("R1").current).toBeGreaterThan(0.0089);
    // Без перемычек между макетками тока нет
    scene.wires = scene.wires.slice(0, 2);
    sim.solve();
    expect(sim.branch("R1").current).toBe(0);
  });
});
