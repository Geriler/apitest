import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BOARDS, applyBoards } from "../src/model/breadboard";
import { WIRE_OHM_PER_MM, isFlatWire, jumperPoints, type Scene, type Wire } from "../src/model/types";
import { wireResistance } from "../src/sim/simulation";
import * as THREE from "three";
import { MAX_WIRE_LAYERS, wireCurve, wireLifts } from "../src/view/builders";

afterEach(() => applyBoards(DEFAULT_BOARDS));

const scene: Scene = { components: [], wires: [] };

describe("прямая перемычка", () => {
  it("лежит на плате, только если оба конца в отверстиях одной платы", () => {
    const w = (a: Wire["a"], b: Wire["b"], shape?: Wire["shape"]) => ({ a, b, shape });
    expect(isFlatWire(w({ hole: "top+1" }, { hole: "top+6" }, "flat"))).toBe(true);
    expect(isFlatWire(w({ hole: "a1" }, { hole: "pA1" }, "flat"))).toBe(false); // макетка → печатная
    expect(isFlatWire(w({ comp: "GB1", pin: 0 }, { hole: "a1" }, "flat"))).toBe(false); // к детали на столе
    expect(isFlatWire(w({ hole: "a1" }, { hole: "a9" }, "arc"))).toBe(false);
    expect(isFlatWire(w({ hole: "a1" }, { hole: "a9" }))).toBe(false); // старые схемы — дугой
    applyBoards([...DEFAULT_BOARDS, { id: "BB2", kind: "breadboard", x: 32, z: 0 }]);
    expect(isFlatWire(w({ hole: "a1" }, { hole: "2:a1" }, "flat"))).toBe(false); // две макетки
    expect(isFlatWire(w({ hole: "2:a1" }, { hole: "2:j9" }, "flat"))).toBe(true);
  });

  it("короче дуги: сопротивление по расстоянию плюс два загнутых конца", () => {
    // a1 → a30: 29 шагов; перемычка 29 + 1 шаг, дуга 29 + 2 × 7 шагов
    const flat = wireResistance(scene, { a: { hole: "a1" }, b: { hole: "a30" }, shape: "flat" });
    const arc = wireResistance(scene, { a: { hole: "a1" }, b: { hole: "a30" }, shape: "arc" });
    expect(flat * 1000).toBeCloseTo(30 * 2.54 * WIRE_OHM_PER_MM * 1000, 6);
    expect(arc * 1000).toBeCloseTo((29 + 14) * 2.54 * WIRE_OHM_PER_MM * 1000, 6);
  });
});

const v = (x: number, z: number, y = 0.6) => new THREE.Vector3(x, y, z);
const R = 0.75 / 2.54;

describe("провода друг над другом", () => {
  it("перемычки крестом: каждая следующая на этаж выше; четвёртая в том же месте не ложится", () => {
    // Четыре перемычки через одну точку (0, 0) под разными углами и пятая
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1]];
    const wires = dirs.map(([dx, dz], i) => ({ id: `W${i}`, a: v(-3 * dx, -3 * dz), b: v(3 * dx, 3 * dz), flat: true }));
    const lifts = wireLifts(wires);
    expect([0, 1, 2].map((i) => lifts.get(`W${i}`))).toEqual([0, 1, 2].map((k) => k * 2 * R));
    expect(MAX_WIRE_LAYERS).toBe(3);
    expect(lifts.get("W3")).toBeNull();
    // Гибкие провода — без предела: пятая дуга крест-накрест всё равно ложится выше
    const arcs = wireLifts(dirs.map(([dx, dz], i) => ({ id: `A${i}`, a: v(-3 * dx, -3 * dz), b: v(3 * dx, 3 * dz), flat: false })));
    expect(arcs.get("A4")).not.toBeNull();
  });

  it("соседние параллельные перемычки не мешают; через ножку другой — поднимается", () => {
    const lifts = wireLifts([
      { id: "A", a: v(0, 0), b: v(5, 0), flat: true },
      { id: "B", a: v(0, 1), b: v(5, 1), flat: true },
      // Проходит над отверстием, где стоит конец A
      { id: "C", a: v(0, -2), b: v(0, 2), flat: true },
    ]);
    expect(lifts.get("A")).toBe(0);
    expect(lifts.get("B")).toBe(0);
    expect(lifts.get("C")).toBeGreaterThan(0);
  });

  it("дуги крест-накрест: вторая в точке пересечения выше первой на толщину провода", () => {
    const a = { id: "A", a: v(-4, 0), b: v(4, 0), flat: false };
    const b = { id: "B", a: v(0, -4), b: v(0, 4), flat: false };
    const lifts = wireLifts([a, b]);
    expect(lifts.get("A")).toBe(0);
    const ya = wireCurve(a.a, a.b, 0).getPoint(0.5).y;
    const yb = wireCurve(b.a, b.b, lifts.get("B")!).getPoint(0.5).y;
    expect(yb - ya).toBeGreaterThanOrEqual(2 * R);
    // Не пересекаются — не поднимается
    expect(wireLifts([a, { id: "C", a: v(-4, 5), b: v(4, 5), flat: false }]).get("C")).toBe(0);
  });
});

describe("Г-образная перемычка", () => {
  it("угол: сначала вдоль ряда или столбца; на одной линии и в старых схемах — прямо", () => {
    expect(jumperPoints([0, 0], [3, 2], "x")).toEqual([[0, 0], [3, 0], [3, 2]]);
    expect(jumperPoints([0, 0], [3, 2], "z")).toEqual([[0, 0], [0, 2], [3, 2]]);
    expect(jumperPoints([0, 0], [3, 2], "none")).toEqual([[0, 0], [3, 2]]);
    expect(jumperPoints([0, 0], [3, 2], undefined)).toEqual([[0, 0], [3, 2]]);
    expect(jumperPoints([0, 0], [5, 0], "x")).toEqual([[0, 0], [5, 0]]);
  });

  it("сопротивление — по двум сторонам угла; этажи — по обоим отрезкам", () => {
    // pA1 → pD5: 4 столбца и 3 ряда — Г длиной 7 шагов против диагонали 5
    const bent = wireResistance(scene, { a: { hole: "pA1" }, b: { hole: "pD5" }, shape: "flat", bend: "x" });
    const straight = wireResistance(scene, { a: { hole: "pA1" }, b: { hole: "pD5" }, shape: "flat", bend: "none" });
    expect(bent / straight).toBeCloseTo((7 + 1) / (5 + 1), 6);
    // Вторая перемычка пересекает только вертикальную сторону Г
    const lifts = wireLifts([
      { id: "L", a: v(0, 0), b: v(4, 3), flat: true, bend: "x" },
      { id: "S", a: v(3, 1.5), b: v(6, 1.5), flat: true },
      { id: "F", a: v(-2, 1.5), b: v(1, 1.5), flat: true },
    ]);
    expect(lifts.get("S")).toBeGreaterThan(0);
    expect(lifts.get("F")).toBe(0);
  });
});
