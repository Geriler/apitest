import { describe, expect, it } from "vitest";
import type { Component, Scene } from "../src/model/types";
import { Simulation, VT, diodeParams, shockley } from "../src/sim/simulation";

const free = (x = 0) => ({ mode: "free" as const, x, z: 0, rot: 0 });
const bat = (kind: "9V" | "4.5V" = "9V"): Component => ({ id: "GB1", type: "battery", kind, placement: free() });
const res = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free() });
/** Последовательная цепь: плюс батареи → детали по порядку (вывод 0 → вывод 1) → минус. */
function series(parts: Component[], battery = bat()): Scene {
  const wires = [];
  let prev = { comp: battery.id, pin: 1 as 0 | 1 };
  parts.forEach((p, i) => {
    wires.push({ id: `W${i}`, a: prev, b: { comp: p.id, pin: 0 as const }, color: "" });
    prev = { comp: p.id, pin: 1 };
  });
  wires.push({ id: "Wend", a: prev, b: { comp: battery.id, pin: 0 as const }, color: "" });
  return { components: [battery, ...parts], wires };
}
const find = (s: Scene, id: string) => s.components.find((c) => c.id === id)!;

describe("диод 1N4007", () => {
  it("в прямом включении падает ≈ 0,6–0,7 В, ток по закону Ома для остатка", () => {
    const scene = series([res("R1", 1000), { id: "VD1", type: "diode", placement: free() }]);
    const sim = new Simulation(scene);
    const vd = sim.voltage(find(scene, "VD1"));
    const i = sim.current(find(scene, "VD1"));
    expect(vd).toBeGreaterThan(0.6);
    expect(vd).toBeLessThan(0.7);
    // Батарея: 9 В, r = 1,5 Ом; провода 3 × 5 мОм
    expect(i).toBeCloseTo((9 - vd) / (1000 + 1.5 + 0.015), 6);
    // Решение согласовано с уравнением Шокли
    const p = diodeParams(find(scene, "VD1"));
    expect(shockley(p, vd - i * p.rs)).toBeCloseTo(i, 9);
  });

  it("в обратном включении ток — наноамперы", () => {
    const d: Component = { id: "VD1", type: "diode", placement: free() };
    const scene = series([res("R1", 1000), d]);
    // Перевернуть диод: поменять местами провода к его выводам
    scene.wires = scene.wires.map((w) => ({
      ...w,
      a: "comp" in w.a && w.a.comp === "VD1" ? { comp: "VD1", pin: (1 - w.a.pin) as 0 | 1 } : w.a,
      b: "comp" in w.b && w.b.comp === "VD1" ? { comp: "VD1", pin: (1 - w.b.pin) as 0 | 1 } : w.b,
    }));
    const sim = new Simulation(scene);
    expect(Math.abs(sim.current(d))).toBeLessThan(1e-7);
    expect(sim.voltage(d)).toBeCloseTo(-9, 3);
    expect(sim.isReversed(d)).toBe(true);
  });
});

describe("светодиоды", () => {
  it("красный через 330 Ом от 9 В: около 21 мА, падение около 2 В", () => {
    const led: Component = { id: "HL1", type: "led", color: "red", placement: free() };
    const scene = series([res("R1", 330), led]);
    const sim = new Simulation(scene);
    const i = sim.current(led);
    expect(i).toBeGreaterThan(0.019);
    expect(i).toBeLessThan(0.022);
    expect(sim.voltage(led)).toBeGreaterThan(1.9);
    expect(sim.voltage(led)).toBeLessThan(2.1);
    expect(sim.overload(led)).toBeLessThan(1.5);
  });

  it("при 20 мА падение равно паспортному vf для каждого цвета", () => {
    for (const color of ["red", "yellow", "green", "blue", "white"] as const) {
      const led: Component = { id: "HL1", type: "led", color, placement: free() };
      const p = diodeParams(led);
      const vj = p.n * VT * Math.log(0.02 / p.is + 1);
      const vf = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.0, white: 3.1 }[color];
      expect(vj + 0.02 * p.rs).toBeCloseTo(vf, 6);
    }
  });

  it("без резистора на 9 В светодиод сгорает, и цепь размыкается", () => {
    const led: Component = { id: "HL1", type: "led", color: "red", placement: free() };
    const scene = series([led]);
    const sim = new Simulation(scene);
    expect(sim.overload(led)).toBeGreaterThan(10);
    let burned: string[] = [];
    for (let t = 0; t < 5 && !burned.length; t += 0.05) burned = sim.step(0.05).map((c) => c.id);
    expect(burned).toEqual(["HL1"]);
    expect(sim.current(led)).toBe(0);
  });

  it("перевёрнутый светодиод не горит", () => {
    const led: Component = { id: "HL1", type: "led", color: "red", placement: free() };
    const scene = series([res("R1", 330)]);
    scene.components.push(led);
    // R1 → катод, анод → минус батареи
    scene.wires = [
      { id: "W0", a: { comp: "GB1", pin: 1 }, b: { comp: "R1", pin: 0 }, color: "" },
      { id: "W1", a: { comp: "R1", pin: 1 }, b: { comp: "HL1", pin: 1 }, color: "" },
      { id: "W2", a: { comp: "HL1", pin: 0 }, b: { comp: "GB1", pin: 0 }, color: "" },
    ];
    const sim = new Simulation(scene);
    expect(Math.abs(sim.current(led))).toBeLessThan(1e-9);
    expect(sim.isReversed(led)).toBe(true);
  });

  it("решатель сходится быстро и из холодного старта", () => {
    const led: Component = { id: "HL1", type: "led", color: "blue", placement: free() };
    const sim = new Simulation(series([res("R1", 100), led]));
    expect(sim.lastIterations).toBeLessThan(60);
    sim.solve();
    expect(sim.lastIterations).toBeLessThanOrEqual(3); // тёплый старт
  });
});

describe("конденсаторы", () => {
  it("RC-цепь: через τ = RC напряжение 63 % от ЭДС", () => {
    // 9 В, r = 1,5 Ом, R = 1 кОм, C = 1000 мкФ → τ ≈ 1,0015 с
    const c: Component = { id: "C1", type: "capacitor", variant: "electrolytic", uF: 1000, placement: free() };
    const scene = series([res("R1", 1000), c]);
    const sim = new Simulation(scene);
    const tau = 1001.515e-3;
    for (let t = 0; t < tau - 1e-9; t += 0.05) sim.step(Math.min(0.05, tau - t));
    expect(sim.voltage(c)).toBeCloseTo(9 * (1 - Math.exp(-1)), 1); // ±0,05 В
    expect(Math.abs(sim.voltage(c) - 9 * (1 - Math.exp(-1)))).toBeLessThan(0.03);
  });

  it("заряд сохраняется после отключения батареи и разряжается через резистор", () => {
    const c: Component = { id: "C1", type: "capacitor", variant: "electrolytic", uF: 1000, placement: free() };
    const scene = series([res("R1", 100), c]);
    const sim = new Simulation(scene);
    for (let i = 0; i < 40; i++) sim.step(0.05); // 2 с ≫ τ = 0,1 с
    expect(sim.voltage(c)).toBeCloseTo(9, 2);
    // Убрать батарею, замкнуть конденсатор на резистор 1 кОм
    scene.components = scene.components.filter((x) => x.id !== "GB1");
    scene.components.find((x) => x.id === "R1")!.type === "resistor" && ((scene.components.find((x) => x.id === "R1") as { ohms: number }).ohms = 1000);
    scene.wires = [
      { id: "W0", a: { comp: "C1", pin: 1 }, b: { comp: "R1", pin: 0 }, color: "" },
      { id: "W1", a: { comp: "R1", pin: 1 }, b: { comp: "C1", pin: 0 }, color: "" },
    ];
    sim.solve();
    expect(sim.voltage(c)).toBeCloseTo(9, 2); // заряд на месте
    expect(sim.current(c)).toBeCloseTo(-9 / 1000, 3); // ток разряда вытекает из плюса
    for (let i = 0; i < 20; i++) sim.step(0.05); // 1 с = τ
    expect(sim.voltage(c)).toBeCloseTo(9 * Math.exp(-1), 1);
    expect(sim.energy(c)).toBeCloseTo(0.5 * 1e-3 * sim.voltage(c) ** 2, 9);
  });

  it("постоянный ток через заряженный конденсатор не идёт", () => {
    const c: Component = { id: "C1", type: "capacitor", variant: "ceramic", uF: 0.1, placement: free() };
    const scene = series([res("R1", 1000), c]);
    const sim = new Simulation(scene);
    for (let i = 0; i < 10; i++) sim.step(0.05);
    expect(Math.abs(sim.current(c))).toBeLessThan(1e-9);
    expect(sim.voltage(c)).toBeCloseTo(9, 6);
  });

  it("электролит, включённый наоборот, вздувается", () => {
    const c: Component = { id: "C1", type: "capacitor", variant: "electrolytic", uF: 100, placement: free() };
    const scene = series([res("R1", 100)]);
    scene.components.push(c);
    scene.wires = [
      { id: "W0", a: { comp: "GB1", pin: 1 }, b: { comp: "R1", pin: 0 }, color: "" },
      { id: "W1", a: { comp: "R1", pin: 1 }, b: { comp: "C1", pin: 1 }, color: "" }, // плюс батареи → минус конденсатора
      { id: "W2", a: { comp: "C1", pin: 0 }, b: { comp: "GB1", pin: 0 }, color: "" },
    ];
    const sim = new Simulation(scene);
    let failed: string[] = [];
    for (let t = 0; t < 10 && !failed.length; t += 0.05) failed = sim.step(0.05).map((x) => x.id);
    expect(failed).toEqual(["C1"]);
    expect(sim.isReversed(c) || sim.state("C1").burned).toBe(true);
  });

  it("мигающий светодиод от конденсатора: после отключения батареи гаснет плавно", () => {
    // Батарея → SA1 → C1 (4700 мкФ); параллельно C1: R2 470 Ом + светодиод
    const scene: Scene = {
      components: [
        bat(),
        { id: "SA1", type: "switch", closed: true, placement: free() },
        { id: "C1", type: "capacitor", variant: "electrolytic", uF: 4700, placement: free() },
        res("R2", 470),
        { id: "HL1", type: "led", color: "red", placement: free() },
      ],
      wires: [
        { id: "W0", a: { comp: "GB1", pin: 1 }, b: { comp: "SA1", pin: 0 }, color: "" },
        { id: "W1", a: { comp: "SA1", pin: 1 }, b: { comp: "C1", pin: 0 }, color: "" },
        { id: "W2", a: { comp: "C1", pin: 1 }, b: { comp: "GB1", pin: 0 }, color: "" },
        { id: "W3", a: { comp: "C1", pin: 0 }, b: { comp: "R2", pin: 0 }, color: "" },
        { id: "W4", a: { comp: "R2", pin: 1 }, b: { comp: "HL1", pin: 0 }, color: "" },
        { id: "W5", a: { comp: "HL1", pin: 1 }, b: { comp: "GB1", pin: 0 }, color: "" },
      ],
    };
    const sim = new Simulation(scene);
    for (let i = 0; i < 40; i++) sim.step(0.05);
    const led = find(scene, "HL1");
    const lit = sim.current(led);
    expect(lit).toBeGreaterThan(0.012);
    (find(scene, "SA1") as { closed: boolean }).closed = false;
    sim.solve();
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      sim.step(0.05);
      if (i % 20 === 19) samples.push(sim.current(led));
    }
    // Ток монотонно падает. Оценка: избыток напряжения над ≈ 1,9 В спадает с τ = 478 Ом × 4700 мкФ ≈ 2,25 с:
    // через 1 с ≈ 7,1·e^(−1/2,25)/478 ≈ 9,5 мА, через 5 с ≈ 1,6 мА — светодиод гаснет с долгим «хвостом».
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
    expect(samples[0]).toBeGreaterThan(0.008);
    expect(samples[0]).toBeLessThan(0.011);
    expect(samples.at(-1)!).toBeGreaterThan(0.001);
    expect(samples.at(-1)!).toBeLessThan(0.0025);
  });
});
