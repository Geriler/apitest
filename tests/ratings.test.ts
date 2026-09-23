import { describe, expect, it } from "vitest";
import { LEDS, capacitorVolts, diodeSpec, electrolyticSize, ledSpec, thtResistorSpec, type Component, type Scene } from "../src/model/types";
import { part } from "../src/parts";
import { Simulation, VT, diodeParams } from "../src/sim/simulation";

const free = (x: number) => ({ mode: "free" as const, x, z: 0, rot: 0 });

/** Блок питания volts / amps, нагрузка между его клеммами; seconds секунд работы. */
function run(load: Component, volts: number, amps = 3, seconds = 10) {
  const scene: Scene = {
    components: [{ id: "G1", type: "psu", volts, amps, on: true, placement: free(-30) }, load],
    wires: [
      { id: "W1", a: { comp: "G1", pin: 1 }, b: { comp: load.id, pin: 0 }, color: "" },
      { id: "W2", a: { comp: load.id, pin: 1 }, b: { comp: "G1", pin: 0 }, color: "" },
    ],
  };
  const sim = new Simulation(scene);
  const ratio = sim.overload(load);
  for (let i = 0; i < seconds * 20; i++) sim.step(0.05);
  return { sim, ratio, burned: sim.state(load.id).burned };
}

const R = (watts?: number): Component => ({ id: "R1", type: "resistor", variant: "tht", ohms: 100, smdSize: "0805", watts, placement: free(0) });

describe("номиналы деталей", () => {
  it("старые схемы без номинала: резистор 0,25 Вт, электролит 16 В, керамика 50 В, 1N4007, светодиод 5 мм", () => {
    expect(part(R()).rated!(R())).toBe(0.25);
    expect(capacitorVolts({ variant: "electrolytic" })).toBe(16);
    expect(capacitorVolts({ variant: "ceramic" })).toBe(50);
    expect(diodeSpec({}).label).toBe("1N4007");
    expect(ledSpec({}).ratedA).toBe(0.02);
  });

  it("резистор 100 Ом на 9 В (0,81 Вт): 0,5 Вт сгорает, 1 Вт выдерживает", () => {
    expect(run(R(0.5), 9).burned).toBe(true);
    const ok = run(R(1), 9);
    expect(ok.ratio).toBeCloseTo(0.81, 2);
    expect(ok.burned).toBe(false);
    expect(thtResistorSpec({ watts: 2 }).lengthMm).toBeGreaterThan(thtResistorSpec({ watts: 1 }).lengthMm);
  });

  it("электролит на 12 В: 10-вольтовый вздувается, 16-вольтовый держит", () => {
    const C = (volts: number): Component => ({ id: "C1", type: "capacitor", variant: "electrolytic", uF: 10, volts, placement: free(0) });
    // Перегрузка всего 20 % — греется медленно, выходит из строя примерно за 12 с
    expect(run(C(10), 12, 3, 30).burned).toBe(true);
    expect(run(C(16), 12, 3, 30).burned).toBe(false);
  });

  it("банка электролита растёт с напряжением: 1000 мкФ 35 В ≈ 13 × 21 мм", () => {
    const s = electrolyticSize(1000, 35);
    expect(s.diaMm).toBeCloseTo(13, 0);
    expect(s.heightMm).toBeCloseTo(20.8, 0);
    expect(electrolyticSize(1000, 16)).toEqual({ uF: 1000, diaMm: 10, heightMm: 16 });
  });

  it("диоды: прямое падение по паспорту, 1N4148 не выдерживает 0,5 А, 1N4007 выдерживает", () => {
    const D = (kind: "1N4148" | "1N4007" | "1N5408"): Component => ({ id: "VD1", type: "diode", kind, placement: free(0) });
    const vf = (kind: "1N4148" | "1N4007" | "1N5408", i: number) => {
      const p = diodeParams(D(kind));
      return p.n * VT * Math.log(i / p.is) + i * p.rs;
    };
    expect(vf("1N4148", 0.01)).toBeGreaterThan(0.6);
    expect(vf("1N4148", 0.01)).toBeLessThan(0.75);
    expect(vf("1N5408", 3)).toBeGreaterThan(0.75);
    expect(vf("1N5408", 3)).toBeLessThan(1); // паспорт: не больше 1 В при 3 А
    // Ограничение блока 0,5 А задаёт ток
    expect(run(D("1N4148"), 5, 0.5).burned).toBe(true);
    expect(run(D("1N4007"), 5, 0.5).burned).toBe(false);
  });

  it("светодиод 350 мА: 5-миллиметровый сгорает, мощный 1 Вт горит в номинал", () => {
    const L = (size: "5mm" | "1W"): Component => ({ id: "HL1", type: "led", color: "red", size, placement: free(0) });
    expect(run(L("5mm"), 12, 0.35).burned).toBe(true);
    const p = run(L("1W"), 12, 0.35);
    expect(p.burned).toBe(false);
    expect(p.ratio).toBeCloseTo(1, 3);
    // Напряжение при номинальном токе — на 0,3 В выше, чем у 5-миллиметрового при 20 мА
    expect(Math.abs(p.sim.voltage(L("1W")))).toBeCloseTo(LEDS.red.vf + 0.3, 2);
  });
});
