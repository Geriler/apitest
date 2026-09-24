import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MAX_WIRE_LAYERS, wireCurve, wireLifts } from "../src/view/builders";

const v = (x: number, z: number, y = 0.6) => new THREE.Vector3(x, y, z);
const R = 0.75 / 2.54;

describe("провода друг над другом", () => {
  it("перемычки крестом: каждая следующая на этаж выше; пятая в том же месте не ложится", () => {
    // Четыре перемычки через одну точку (0, 0) под разными углами и пятая
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1]];
    const wires = dirs.map(([dx, dz], i) => ({ id: `W${i}`, a: v(-3 * dx, -3 * dz), b: v(3 * dx, 3 * dz), flat: true }));
    const lifts = wireLifts(wires);
    expect([0, 1, 2, 3].map((i) => lifts.get(`W${i}`))).toEqual([0, 1, 2, 3].map((k) => k * 2 * R));
    expect(MAX_WIRE_LAYERS).toBe(4);
    expect(lifts.get("W4")).toBeNull();
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
