import { describe, expect, it } from "vitest";
import { HOLES, HOLE_BY_ID, describeNode } from "../src/model/breadboard";
import type { Scene } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";

/** Батарея 9 В на столе, провода к шинам, резистор между шиной и полосой, лампа от полосы к минусу. */
function demoScene(ohms: number, variant: "tht" | "smd" = "tht"): Scene {
  return {
    components: [
      { id: "bat", type: "battery", kind: "9V", placement: { mode: "free", x: -25, z: 0, rot: 0 } },
      variant === "tht"
        ? { id: "R", type: "resistor", variant, ohms, smdSize: "0805", placement: { mode: "board", holes: ["top+3", "a5"] } }
        : { id: "R", type: "resistor", variant, ohms, smdSize: "0402", placement: { mode: "free", x: 0, z: -15, rot: 0 } },
      { id: "L", type: "lamp", kind: "6.3V", placement: { mode: "board", holes: ["c5", "top-3"] } },
      { id: "S", type: "switch", closed: true, placement: { mode: "board", holes: ["top+10", "top+12"] } },
    ],
    wires: [
      { id: "w-", a: { comp: "bat", pin: 0 }, b: { hole: "top-1" }, color: "#222" },
      { id: "w+", a: { comp: "bat", pin: 1 }, b: { hole: "top+1" }, color: "#c00" },
      ...(variant === "smd"
        ? [
            { id: "ws1", a: { comp: "R", pin: 0 as const }, b: { hole: "top+20" }, color: "#c00" },
            { id: "ws2", a: { comp: "R", pin: 1 as const }, b: { hole: "b5" }, color: "#c00" },
          ]
        : []),
    ],
  };
}

describe("макетная плата", () => {
  it("400 отверстий: 300 в поле и 100 в шинах", () => {
    expect(HOLES.filter((h) => h.kind === "main")).toHaveLength(300);
    expect(HOLES.filter((h) => h.kind === "rail")).toHaveLength(100);
    expect(new Set(HOLES.map((h) => h.id)).size).toBe(400);
  });

  it("a–e одного столбца соединены, а через канавку — нет", () => {
    expect(HOLE_BY_ID.get("a7")!.node).toBe(HOLE_BY_ID.get("e7")!.node);
    expect(HOLE_BY_ID.get("e7")!.node).not.toBe(HOLE_BY_ID.get("f7")!.node);
    expect(HOLE_BY_ID.get("a7")!.node).not.toBe(HOLE_BY_ID.get("a8")!.node);
    expect(HOLE_BY_ID.get("top+1")!.node).toBe(HOLE_BY_ID.get("top+25")!.node);
    expect(describeNode(HOLE_BY_ID.get("g3")!.node)).toBe("столбец 3 (f–j)");
  });
});

describe("симуляция", () => {
  it("ток идёт: батарея → провод → шина → резистор → полоса → лампа → шина → батарея", () => {
    const sim = new Simulation(demoScene(10));
    // 9 В, rвнутр = 1,5; R = 10; лампа 6,3/0,3 = 21 Ом; провода 2 × 0,005
    const expected = 9 / (1.5 + 10 + 21 + 0.01);
    expect(sim.branch("L").current).toBeCloseTo(expected, 9);
    expect(sim.branch("R").current).toBeCloseTo(expected, 9);
    expect(Math.abs(sim.branch("w+").current)).toBeCloseTo(expected, 9);
  });

  it("выключатель на шине не влияет: он замыкает шину саму на себя", () => {
    const sim = new Simulation(demoScene(10));
    expect(sim.branch("S").current).toBeCloseTo(0, 12);
  });

  it("перегруженный выводной резистор сгорает, и ток прекращается", () => {
    // 9 В на 4,7 Ом + лампа: I ≈ 0,33 А, P(R) ≈ 0,51 Вт > 0,25 Вт
    const sim = new Simulation(demoScene(4.7));
    expect(sim.overload(sim.scene.components[1])).toBeGreaterThan(1);
    let burned: string[] = [];
    for (let t = 0; t < 30 && burned.length === 0; t += 0.05) burned = sim.step(0.05).map((c) => c.id);
    expect(burned).toEqual(["R"]);
    expect(sim.branch("L").current).toBe(0);
  });

  it("резистор в пределах номинала не греется", () => {
    // 470 Ом: P ≈ 0,16 Вт < 0,25 Вт (при 220 Ом было бы ≈ 0,30 Вт — уже перегрузка)
    const sim = new Simulation(demoScene(470));
    for (let i = 0; i < 200; i++) sim.step(0.05);
    expect(sim.state("R")).toEqual({ burned: false, heat: 0 });
  });

  it("SMD 0402 при том же номинале сгорает, а выводной — нет", () => {
    // 470 Ом: I ≈ 18 мА, P ≈ 0,16 Вт — меньше 0,25 Вт (выводной), больше 0,063 Вт (0402)
    const tht = new Simulation(demoScene(470, "tht"));
    const smd = new Simulation(demoScene(470, "smd"));
    const p = tht.branch("R").power;
    expect(p).toBeGreaterThan(0.063);
    expect(p).toBeLessThan(0.25);
    expect(smd.branch("R").power).toBeCloseTo(p, 3);
    for (let i = 0; i < 400; i++) {
      tht.step(0.05);
      smd.step(0.05);
    }
    expect(tht.state("R").burned).toBe(false);
    expect(smd.state("R").burned).toBe(true);
  });

  it("короткое замыкание батареи распознаётся", () => {
    const scene: Scene = {
      components: [{ id: "bat", type: "battery", kind: "9V", placement: { mode: "free", x: 0, z: 0, rot: 0 } }],
      wires: [{ id: "w", a: { comp: "bat", pin: 0 }, b: { comp: "bat", pin: 1 }, color: "#000" }],
    };
    const sim = new Simulation(scene);
    expect(sim.isShorted(scene.components[0])).toBe(true);
    scene.wires = [];
    sim.solve();
    expect(sim.isShorted(scene.components[0])).toBe(false);
  });

  it("разомкнутый выключатель в цепи лампы гасит её", () => {
    const scene: Scene = {
      components: [
        { id: "bat", type: "battery", kind: "4.5V", placement: { mode: "free", x: 0, z: 0, rot: 0 } },
        { id: "S", type: "switch", closed: false, placement: { mode: "board", holes: ["a1", "a4"] } },
        { id: "L", type: "lamp", kind: "3.5V", placement: { mode: "board", holes: ["b4", "b8"] } },
      ],
      wires: [
        { id: "w1", a: { comp: "bat", pin: 1 }, b: { hole: "e1" }, color: "#c00" },
        { id: "w2", a: { comp: "bat", pin: 0 }, b: { hole: "e8" }, color: "#000" },
      ],
    };
    const sim = new Simulation(scene);
    expect(sim.branch("L").current).toBe(0);
    (scene.components[1] as { closed: boolean }).closed = true;
    sim.solve();
    expect(sim.branch("L").current).toBeGreaterThan(0.1);
  });
});
