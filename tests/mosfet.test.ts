import { describe, expect, it } from "vitest";
import { mosfetPin, type Component, type Endpoint, type Mosfet, type MosfetKind, type Scene } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";

const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const R = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: { ...free } });
const M = (id: string, kind: MosfetKind): Mosfet => ({ id, type: "mosfet", kind, placement: { ...free } });
const pin = (comp: string, p: 0 | 1 | 2): Endpoint => ({ comp, pin: p });
/** Вывод MOSFET по роли: G, D, S (у разных корпусов ножки в разном порядке). */
const fet = (q: Mosfet, role: "G" | "D" | "S"): Endpoint => pin(q.id, mosfetPin(q.kind, role));
const PLUS = pin("GB1", 1);
const MINUS = pin("GB1", 0);

/** Напряжение на клеммах батареи под нагрузкой (ЭДС минус падение на внутреннем сопротивлении). */
const terminal = (sim: Simulation, scene: Scene) => -sim.voltage(scene.components[0]);

function circuit(parts: Component[], nets: [Endpoint, Endpoint][]): Scene {
  return {
    components: [{ id: "GB1", type: "battery", kind: "9V", placement: { ...free } }, ...parts],
    wires: nets.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
  };
}

/** Установившийся режим (ёмкостям затвора нужно зарядиться). */
function settled(scene: Scene, seconds = 0.3): Simulation {
  const sim = new Simulation(scene);
  for (let t = 0; t < seconds; t += 0.01) sim.step(0.01);
  return sim;
}

/** Нижний ключ: + → Rн → сток, исток → −; затвор — делитель Rв (к +) / Rн (к −). */
function lowSide(kind: MosfetKind, rLoad: number, rTop: number, rBottom: number) {
  const q = M("VT1", kind);
  const scene = circuit(
    [q, R("Rload", rLoad), R("Rtop", rTop), R("Rbot", rBottom)],
    [
      [PLUS, pin("Rload", 0)],
      [pin("Rload", 1), fet(q, "D")],
      [fet(q, "S"), MINUS],
      [PLUS, pin("Rtop", 0)],
      [pin("Rtop", 1), fet(q, "G")],
      [fet(q, "G"), pin("Rbot", 0)],
      [pin("Rbot", 1), MINUS],
    ],
  );
  return { q, scene };
}

describe("2N7000 (N-канал)", () => {
  it("ключ: Uзи ≈ 8,2 В, канал ≈ 2,5 Ом, ток нагрузки по закону Ома", () => {
    const { q, scene } = lowSide("2N7000", 470, 10_000, 100_000);
    const sim = settled(scene);
    const f = sim.mosfet(q);
    expect(f.mode).toBe("открыт");
    expect(f.vgs).toBeCloseTo((terminal(sim, scene) * 100) / 110, 2);
    const rds = f.vds / f.id;
    expect(rds).toBeGreaterThan(2.3);
    expect(rds).toBeLessThan(2.7);
    expect(f.id).toBeCloseTo(9 / (470 + 1.5 + rds), 4);
    // Затвор не потребляет ток: через верхний резистор делителя течёт ровно ток делителя
    expect(sim.branch("Rtop").current).toBeCloseTo(terminal(sim, scene) / 110_000, 9);
  });

  it("ниже порога (Uзи ≈ 0,96 В) транзистор закрыт", () => {
    const { q, scene } = lowSide("2N7000", 470, 100_000, 12_000);
    const sim = settled(scene);
    expect(sim.mosfet(q).mode).toBe("закрыт");
    expect(Math.abs(sim.mosfet(q).id)).toBeLessThan(1e-9);
  });

  it("насыщение: ток ≈ K/2·(Uзи − Uпор)² и почти не зависит от нагрузки", () => {
    const a = lowSide("2N7000", 470, 100_000, 39_000);
    const b = lowSide("2N7000", 220, 100_000, 39_000);
    const sa = settled(a.scene);
    const sb = settled(b.scene);
    const fa = sa.mosfet(a.q);
    expect(fa.mode).toBe("насыщение");
    const vov = fa.vgs - 2.1;
    expect(fa.id).toBeGreaterThan(0.95 * (0.065 / 2) * vov * vov);
    expect(fa.id).toBeLessThan(1.05 * (0.065 / 2) * vov * vov);
    expect(sb.mosfet(b.q).id).toBeCloseTo(fa.id, 5);
  });

  it("паразитный диод проводит в обратную сторону даже у закрытого транзистора", () => {
    const q = M("VT1", "2N7000");
    const scene = circuit(
      [q, R("R1", 1000), R("Rgs", 100_000)],
      [
        [PLUS, pin("R1", 0)],
        [pin("R1", 1), fet(q, "S")],
        [fet(q, "D"), MINUS],
        [fet(q, "G"), pin("Rgs", 0)],
        [pin("Rgs", 1), fet(q, "S")],
      ],
    );
    const sim = settled(scene);
    const f = sim.mosfet(q);
    expect(f.mode).toBe("диод");
    expect(-f.vds).toBeGreaterThan(0.6);
    expect(-f.vds).toBeLessThan(0.85);
    expect(f.idiode).toBeCloseTo((9 + f.vds) / 1001.5, 4);
  });

  it("открытый канал проводит и в обратную сторону — с малым падением, а не 0,7 В как диод", () => {
    // Сток ниже истока, затвор открыт: ток идёт исток → сток через канал (так устроена защита от переполюсовки)
    const q = M("VT1", "2N7000");
    const scene = circuit(
      [q, R("R1", 1000), R("Rg", 10_000)],
      [
        [PLUS, pin("R1", 0)],
        [pin("R1", 1), fet(q, "S")],
        [fet(q, "D"), MINUS],
        [PLUS, pin("Rg", 0)],
        [pin("Rg", 1), fet(q, "G")],
      ],
    );
    const sim = settled(scene);
    const f = sim.mosfet(q);
    expect(f.vds).toBeLessThan(0);
    expect(-f.vds).toBeLessThan(0.05);
    expect(-sim.current(q)).toBeCloseTo((terminal(sim, scene) + f.vds) / 1000, 4);
  });

  it("«висящий» затвор при стоке на 9 В наводится ёмкостью затвор–сток, но ниже порога", () => {
    const q = M("VT1", "2N7000");
    const scene = circuit(
      [q, R("Rload", 470)],
      [
        [PLUS, pin("Rload", 0)],
        [pin("Rload", 1), fet(q, "D")],
        [fet(q, "S"), MINUS],
      ],
    );
    const sim = settled(scene);
    const f = sim.mosfet(q);
    // Ёмкостный делитель 1 нФ / (1 + 10) нФ от ≈ 9 В
    expect(f.vgs).toBeCloseTo((9 * 1) / 11, 1);
    expect(f.mode).toBe("закрыт");
  });

  it("утечка затвора (по 1 пСм к истоку и стоку): висящий затвор медленно уплывает к середине, τ ≈ 5500 с", () => {
    const q = M("VT1", "2N7000");
    const scene = circuit(
      [q, R("Rload", 470)],
      [
        [PLUS, pin("Rload", 0)],
        [pin("Rload", 1), fet(q, "D")],
        [fet(q, "S"), MINUS],
      ],
    );
    const sim = new Simulation(scene);
    const vds = sim.mosfet(q).vds;
    const v0 = sim.mosfet(q).vgs;
    expect(v0).toBeCloseTo(vds / 11, 3);
    // 60 с: Uзи(t) = Uси/2 + (U0 − Uси/2)·e^(−t/τ), τ = 11 нФ / 2 пСм
    for (let t = 0; t < 60; t += 0.5) sim.step(0.5);
    const tau = (10e-9 + 1e-9) / (2 * 1e-12);
    const expected = vds / 2 + (v0 - vds / 2) * Math.exp(-60 / tau);
    expect(sim.mosfet(q).vgs).toBeCloseTo(expected, 3);
    expect(sim.mosfet(q).vgs - v0).toBeGreaterThan(0.03);
  });

  it("затвор «помнит» заряд: без стягивающего резистора транзистор остаётся открытым", () => {
    const q = M("VT1", "2N7000");
    const scene = circuit(
      [q, R("Rload", 470), { id: "SA1", type: "switch", closed: true, placement: { ...free } }],
      [
        [PLUS, pin("Rload", 0)],
        [pin("Rload", 1), fet(q, "D")],
        [fet(q, "S"), MINUS],
        [PLUS, pin("SA1", 0)],
        [pin("SA1", 1), fet(q, "G")],
      ],
    );
    const sim = settled(scene);
    expect(sim.mosfet(q).id).toBeGreaterThan(0.015);
    (scene.components.find((c) => c.id === "SA1") as { closed: boolean }).closed = false;
    sim.solve();
    for (let t = 0; t < 2; t += 0.01) sim.step(0.01);
    expect(sim.mosfet(q).vgs).toBeGreaterThan(8);
    expect(sim.mosfet(q).id).toBeGreaterThan(0.015);
  });

  it("со стягивающим резистором 100 кОм транзистор закрывается, когда затвор отключили", () => {
    const q = M("VT1", "2N7000");
    const scene = circuit(
      [q, R("Rload", 470), R("Rpd", 100_000), { id: "SA1", type: "switch", closed: true, placement: { ...free } }],
      [
        [PLUS, pin("Rload", 0)],
        [pin("Rload", 1), fet(q, "D")],
        [fet(q, "S"), MINUS],
        [PLUS, pin("SA1", 0)],
        [pin("SA1", 1), fet(q, "G")],
        [fet(q, "G"), pin("Rpd", 0)],
        [pin("Rpd", 1), MINUS],
      ],
    );
    const sim = settled(scene);
    (scene.components.find((c) => c.id === "SA1") as { closed: boolean }).closed = false;
    sim.solve();
    // τ ≈ 100 кОм × (10 нФ + 1 нФ) ≈ 1 мс
    for (let t = 0; t < 0.1; t += 0.01) sim.step(0.01);
    expect(sim.mosfet(q).mode).toBe("закрыт");
  });
});

for (const kind of ["IRF9540N", "BS250"] as const) {
  describe(`${kind} (P-канал)`, () => {
    function highSide(gateToPlus: boolean) {
      const q = M("VT1", kind);
      const scene = circuit(
        [q, R("Rload", 1000), R("Rg", 10_000)],
        [
          [PLUS, fet(q, "S")],
          [fet(q, "D"), pin("Rload", 0)],
          [pin("Rload", 1), MINUS],
          [fet(q, "G"), pin("Rg", 0)],
          [pin("Rg", 1), gateToPlus ? PLUS : MINUS],
        ],
      );
      return { q, scene, sim: settled(scene) };
    }

    it("затвор ниже истока — открыт, ток нагрузки ≈ 9 мА", () => {
      const { q, scene, sim } = highSide(false);
      const f = sim.mosfet(q);
      expect(f.mode).toBe("открыт");
      expect(f.vgs).toBeCloseTo(terminal(sim, scene), 3);
      // У BS250 на канале падает несколько десятков милливольт (Rси ≈ 5–6 Ом)
      expect(f.id).toBeCloseTo(9 / (1000 + 1.5), kind === "BS250" ? 3 : 4);
    });

    it("затвор на плюсе — закрыт", () => {
      const { q, sim } = highSide(true);
      expect(sim.mosfet(q).mode).toBe("закрыт");
      expect(Math.abs(sim.mosfet(q).id)).toBeLessThan(1e-9);
    });
  });
}

describe("BS250: P-канал в TO-92", () => {
  it("ножки С-З-И (у 2N7000 наоборот: И-З-С), сопротивление открытого канала ≈ 5–6 Ом при Uзи ≈ −9 В", () => {
    expect([mosfetPin("BS250", "D"), mosfetPin("BS250", "G"), mosfetPin("BS250", "S")]).toEqual([0, 1, 2]);
    const q = M("VT1", "BS250");
    const scene = circuit(
      [q, R("Rload", 1000)],
      [
        [PLUS, fet(q, "S")],
        [fet(q, "D"), pin("Rload", 0)],
        [pin("Rload", 1), MINUS],
        [fet(q, "G"), MINUS],
      ],
    );
    const sim = settled(scene);
    const f = sim.mosfet(q);
    const rds = Math.abs(f.vds / f.id);
    expect(rds).toBeGreaterThan(4);
    expect(rds).toBeLessThan(7);
  });
});

describe("IRLZ44N (N-канал, мощный)", () => {
  it("приоткрытый без нагрузки рассеивает ватты и сгорает", () => {
    const q = M("VT1", "IRLZ44N");
    const scene = circuit(
      [q, R("Rtop", 100_000), R("Rbot", 27_000)],
      [
        [PLUS, fet(q, "D")],
        [fet(q, "S"), MINUS],
        [PLUS, pin("Rtop", 0)],
        [pin("Rtop", 1), fet(q, "G")],
        [fet(q, "G"), pin("Rbot", 0)],
        [pin("Rbot", 1), MINUS],
      ],
    );
    const sim = settled(scene, 0.05);
    expect(sim.power(q)).toBeGreaterThan(2);
    let failed: string[] = [];
    for (let t = 0; t < 5 && !failed.length; t += 0.05) failed = sim.step(0.05).map((c) => c.id);
    expect(failed).toContain("VT1");
    expect(sim.nonConverged).toBe(0);
  });
});
