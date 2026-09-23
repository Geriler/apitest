import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BOARDS, applyBoards } from "../src/model/breadboard";
import { WIRE_OHM_PER_MM, isFlatWire, type Scene, type Wire } from "../src/model/types";
import { wireResistance } from "../src/sim/simulation";

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
