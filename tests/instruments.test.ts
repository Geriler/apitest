import { describe, expect, it } from "vitest";
import { mosfetPin, type Component, type Endpoint, type MeterMode, type Multimeter, type Oscilloscope, type Scene } from "../src/model/types";
import { AMMETER, VOLTMETER_R, lcdText, meterReading } from "../src/parts/multimeter";
import { scopeFrame } from "../src/parts/scope";
import { Simulation } from "../src/sim/simulation";
import * as tolerance from "../src/sim/tolerance";

const free = () => ({ mode: "free" as const, x: 0, z: 0, rot: 0 });
const pin = (comp: string, p: 0 | 1 | 2): Endpoint => ({ comp, pin: p });
const bat = (): Component => ({ id: "GB1", type: "battery", kind: "9V", placement: free() });
const R = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free() });
const meter = (mode: MeterMode): Multimeter => ({ id: "P1", type: "meter", mode, placement: free() });
const scene = (components: Component[], nets: [Endpoint, Endpoint][]): Scene => ({
  components,
  wires: nets.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
  boards: [],
});
const run = (sim: Simulation, seconds: number, dt = 0.05) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) sim.step(dt);
};

describe("мультиметр", () => {
  it("вольтметр на батарее: ЭДС за вычетом падения на внутреннем сопротивлении от тока 10 МОм", () => {
    const m = meter("V");
    const sc = scene([bat(), m], [[pin("GB1", 1), pin("P1", 1)], [pin("GB1", 0), pin("P1", 0)]]);
    const sim = new Simulation(sc);
    const b = tolerance.battery(sc.components[0] as never, sim.tolerance);
    expect(meterReading(m, sim).value).toBeCloseTo((b.emf * VOLTMETER_R) / (VOLTMETER_R + b.rInt), 6);
    expect(lcdText(m, sim)).toBe("9.000 V");
    // Щупы наоборот — минус
    const sc2 = scene([bat(), meter("V")], [[pin("GB1", 0), pin("P1", 1)], [pin("GB1", 1), pin("P1", 0)]]);
    expect(meterReading(sc2.components[1] as Multimeter, new Simulation(sc2)).value).toBeLessThan(-8.9);
  });

  it("миллиамперметр в разрыв цепи: ток через 1 кОм, с учётом шунта 1 Ом", () => {
    const m = meter("mA");
    const sc = scene([bat(), R("R1", 1000), m], [
      [pin("GB1", 1), pin("R1", 0)],
      [pin("R1", 1), pin("P1", 1)],
      [pin("P1", 0), pin("GB1", 0)],
    ]);
    const sim = new Simulation(sc);
    const i = meterReading(m, sim).value!;
    const b = tolerance.battery(sc.components[0] as never, sim.tolerance);
    // Провода — миллиомы, поэтому сравниваем до долей процента
    expect(i).toBeCloseTo(b.emf / (1000 + AMMETER.mA.r + b.rInt), 5);
    expect(lcdText(m, sim)).toMatch(/^8\.9\d\d mA$/);
  });

  it("миллиамперметр параллельно батарее: предохранитель 400 мА сгорает, прибор уже не проводит", () => {
    const m = meter("mA");
    const sc = scene([bat(), m], [[pin("GB1", 1), pin("P1", 1)], [pin("GB1", 0), pin("P1", 0)]]);
    const sim = new Simulation(sc);
    expect(Math.abs(meterReading(m, sim).value!)).toBeGreaterThan(1);
    run(sim, 0.3);
    expect(sim.state("P1").burned).toBe(true);
    expect(Math.abs(sim.branch("P1").current)).toBe(0);
    // В режиме вольтметра прибор работает и без предохранителя
    m.mode = "V";
    sim.solve();
    expect(meterReading(m, sim).value).toBeGreaterThan(8.9);
  });

  it("омметр: 1 кОм без питания — 1 кОм; разомкнутые щупы — OL", () => {
    const m = meter("ohm");
    const sc = scene([R("R1", 1000), m], [[pin("R1", 0), pin("P1", 1)], [pin("R1", 1), pin("P1", 0)]]);
    const sim = new Simulation(sc);
    expect(meterReading(m, sim).value).toBeCloseTo(1000, 0);
    expect(lcdText(m, sim)).toBe("1.000 kΩ");
    const open = meter("ohm");
    const sim2 = new Simulation(scene([open], []));
    expect(meterReading(open, sim2).value).toBeUndefined();
    expect(lcdText(open, sim2)).toBe("OL MΩ");
  });

  it("вольтметр 10 МОм на висящем затворе притягивает его к истоку (как настоящий)", () => {
    const q: Component = { id: "VT1", type: "mosfet", kind: "2N7000", placement: free() };
    const m = meter("V");
    const G = mosfetPin("2N7000", "G"), D = mosfetPin("2N7000", "D"), S = mosfetPin("2N7000", "S");
    const sc = scene([bat(), q, m], [
      [pin("GB1", 1), pin("VT1", D)],
      [pin("GB1", 0), pin("VT1", S)],
      [pin("P1", 1), pin("VT1", G)],
      [pin("P1", 0), pin("VT1", S)],
    ]);
    const sim = new Simulation(sc);
    // τ = 11 нФ · 10 МОм ≈ 0,1 с: через секунду затвор у истока
    run(sim, 1);
    expect(Math.abs(meterReading(m, sim).value!)).toBeLessThan(0.01);
  });
});

describe("осциллограф", () => {
  /** 9 В → R 1 кОм → C 1000 мкФ (τ ≈ 1 с); канал 1 — на конденсаторе, канал 2 — на батарее. */
  function rc() {
    const osc: Oscilloscope = { id: "P1", type: "scope", timeDiv: 0.5, voltsDiv: [0, 0], placement: free() };
    const sc = scene(
      [bat(), R("R1", 1000), { id: "C1", type: "capacitor", variant: "electrolytic", uF: 1000, volts: 16, placement: free() }, osc],
      [
        [pin("GB1", 1), pin("R1", 0)],
        [pin("R1", 1), pin("C1", 0)],
        [pin("C1", 1), pin("GB1", 0)],
        [pin("P1", 0), pin("GB1", 0)],
        [pin("P1", 1), pin("C1", 0)],
        [pin("P1", 2), pin("GB1", 1)],
      ],
    );
    return { osc, sc, sim: new Simulation(sc) };
  }

  it("пишет заряд конденсатора: через τ ≈ 63 % от 9 В, развёртка 0,5 с/дел — на экране 5 с", () => {
    const { osc, sc, sim } = rc();
    run(sim, 3);
    const f = scopeFrame(osc, sim);
    const b = tolerance.battery(sc.components[0] as never, sim.tolerance);
    const tau = ((1000 + b.rInt) * 1000e-6);
    const ch1 = f.channels[0];
    expect(ch1.now).toBeCloseTo(b.emf * (1 - Math.exp(-3 / tau)), 1);
    // Кривая растёт слева направо и занимает 3 с из 5 (правые 6 делений)
    expect(ch1.points[0][0]).toBeGreaterThan(3.9);
    expect(ch1.points.at(-1)![0]).toBeCloseTo(10, 1);
    for (let i = 1; i < ch1.points.length; i++) expect(ch1.points[i][1]).toBeGreaterThanOrEqual(ch1.points[i - 1][1] - 1e-9);
    // Авто: 9 В на 7 делений выше нуля — 2 В/дел
    expect(ch1.vdiv).toBe(2);
    expect(f.channels[1].now).toBeGreaterThan(8.9);
  });

  it("«Стоп» замораживает запись, «Пуск» продолжает", () => {
    const { osc, sim } = rc();
    run(sim, 1);
    osc.hold = true;
    const frozen = JSON.stringify(scopeFrame(osc, sim).channels.map((c) => c.points));
    run(sim, 1);
    expect(JSON.stringify(scopeFrame(osc, sim).channels.map((c) => c.points))).toBe(frozen);
    osc.hold = false;
    run(sim, 0.5);
    expect(JSON.stringify(scopeFrame(osc, sim).channels.map((c) => c.points))).not.toBe(frozen);
  });

  it("без общего провода показывает ноль, как настоящий", () => {
    const osc: Oscilloscope = { id: "P1", type: "scope", timeDiv: 0.1, voltsDiv: [0, 0], placement: free() };
    const sc = scene([bat(), osc], [[pin("P1", 1), pin("GB1", 1)]]);
    const sim = new Simulation(sc);
    run(sim, 0.5);
    expect(Math.abs(scopeFrame(osc, sim).channels[0].now)).toBeLessThan(1e-6);
  });
});
