import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Scene } from "../src/model/types";
import { REPAIRS } from "../src/career/repairs";
import { kitUsed } from "../src/career/build";
import { Simulation } from "../src/sim/simulation";
import { schematicSvg } from "../src/view/schematic";

setLibrary([]);

/** Как починить: правка стартового стола. */
const FIX: Record<string, (s: Scene) => void> = {
  "fix-led-open": (s) => void delete s.components.find((c) => c.id === "R1")!.fault,
  "fix-led-dim": (s) => void ((s.components.find((c) => c.id === "R1") as { ohms: number }).ohms = 470),
  "fix-divider": (s) => void (s.components.find((c) => c.id === "R2")!.placement = { mode: "board", holes: ["d8", "d12"] }),
  "fix-switch-short": (s) => void delete s.components.find((c) => c.id === "VT1")!.fault,
  "fix-switch-reversed": (s) => void (s.components.find((c) => c.id === "VT1")!.placement = { mode: "board", holes: ["e8", "e9", "e10"] }),
  // Трещину обходят перемычкой — саму дорожку не трогаем
  "fix-pcb-crack": (s) => void s.wires.push({ id: "WX", a: { hole: "pD8" }, b: { hole: "pE8" }, color: "#2f9e5a" }),
  "fix-adder": (s) => void s.wires.push({ id: "WX", a: { comp: "SA2", pin: 1 }, b: { comp: "D2", pin: 1 }, color: "#e3b21c" }),
  "fix-blinker": (s) => void delete s.components.find((c) => c.id === "C1")!.fault,
};

describe("ремонт", () => {
  for (const r of REPAIRS) {
    it(`${r.title} (${r.id}): неисправная не проходит, починенная — проходит`, () => {
      const start = r.start();
      applyBoards(start.boards ?? []);
      expect(start.career?.repair).toBe(true);
      // Детали на столе с начала — не из набора: запасные все свободны
      expect(kitUsed(r.kit, start)).toEqual(r.kit.map(() => 0));
      expect(r.check(start).every((x) => x.ok)).toBe(false);
      const fixed: Scene = JSON.parse(JSON.stringify(start));
      FIX[r.id](fixed);
      const steps = r.check(fixed);
      expect(steps.filter((x) => !x.ok).map((x) => x.text)).toEqual([]);
    }, 30000);
  }

  it("на схеме ремонта нет ни токов, ни напряжений цепей; в песочнице — есть", () => {
    const start = REPAIRS[0].start();
    applyBoards(start.boards ?? []);
    const svg = schematicSvg(start, new Simulation(start));
    expect(svg).not.toMatch(/class="volt"/);
    expect(svg).not.toMatch(/class="sub">[^<]*А</);
    const open: Scene = { ...start, career: undefined };
    expect(schematicSvg(open, new Simulation(open))).toMatch(/class="volt"/);
  });

  it("у каждого ремонта есть починка в тесте", () => {
    expect(Object.keys(FIX).sort()).toEqual(REPAIRS.map((r) => r.id).sort());
  });
});
