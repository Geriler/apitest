import { describe, expect, it } from "vitest";
import { applyBoards } from "../src/model/breadboard";
import type { Component, Endpoint, Scene } from "../src/model/types";
import { LESSONS, lessonById } from "../src/career/lessons";

const lesson = (id: string) => lessonById(id)!;
const pass = (id: string, s: Scene) => {
  applyBoards(s.boards!);
  return lesson(id).check(s);
};
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const R = (id: string, ohms: number, holes: string[]): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: { mode: "board", holes } });
const wire = (id: string, a: Endpoint, b: Endpoint) => ({ id, a, b, color: "" });
const hole = (h: string): Endpoint => ({ hole: h });
const pin = (comp: string, p: number): Endpoint => ({ comp, pin: p });

/** Светодиод от столбца 7 к 10, резистор с плюса на столбец 7, столбец 10 — на минус. */
function led(id: string, ohms: number): Scene {
  const s = lesson(id).start();
  s.components.push(R("R1", ohms, ["top+6", "b7"]), { id: "HL1", type: "led", color: "red", placement: { mode: "board", holes: ["d7", "d10"] } });
  s.wires.push(wire("W9", hole("a10"), hole("top-10")));
  return s;
}

describe("введение: уроки", () => {
  it("стартовый стол ни одного урока сам не проходит", () => {
    for (const l of LESSONS) expect(ok(pass(l.id, l.start())), l.id).toBe(false);
  });

  it("урок 1: 470 Ом — горит нормально; 100 Ом — сгорает или перегружен; 10 кОм — еле светит", () => {
    expect(ok(pass("intro-led", led("intro-led", 470)))).toBe(true);
    const hot = pass("intro-led", led("intro-led", 100));
    expect(ok(hot)).toBe(false);
    expect(hot.find((x) => /сгорело/.test(x.text))!.ok).toBe(false);
    const dim = pass("intro-led", led("intro-led", 10_000));
    expect(ok(dim)).toBe(false);
    expect(dim.find((x) => /Ток светодиода/.test(x.text))!.ok).toBe(false);
  });

  it("урок 2: вольтметр на светодиоде; щупы наоборот — не засчитано", () => {
    const s = lesson("intro-volts").start();
    (s.components.find((c) => c.id === "P1") as { mode: string }).mode = "V";
    s.wires.push(wire("W8", pin("P1", 1), hole("c7")), wire("W9", pin("P1", 0), hole("c10")));
    const steps = pass("intro-volts", s);
    expect(steps.map((x) => x.ok)).toEqual([true, true, true, true]);
    expect(steps[3].text).toMatch(/1,[5-9]\d* В|2,\d+ В/);
    s.wires = s.wires.filter((w) => !["W8", "W9"].includes(w.id));
    s.wires.push(wire("W8", pin("P1", 0), hole("c7")), wire("W9", pin("P1", 1), hole("c10")));
    expect(ok(pass("intro-volts", s))).toBe(false);
  });

  it("урок 3: амперметр в разрыв — засчитано; параллельно светодиоду — нет", () => {
    const s = lesson("intro-amps").start();
    (s.components.find((c) => c.id === "P1") as { mode: string }).mode = "mA";
    s.wires = s.wires.filter((w) => w.id !== "W3");
    s.wires.push(wire("W8", pin("P1", 1), hole("a10")), wire("W9", pin("P1", 0), hole("top-12")));
    expect(pass("intro-amps", s).map((x) => x.ok)).toEqual([true, true, true, true]);
    // Параллельно светодиоду: светодиод гаснет (прибор его закорачивает)
    const t = lesson("intro-amps").start();
    (t.components.find((c) => c.id === "P1") as { mode: string }).mode = "mA";
    t.wires.push(wire("W8", pin("P1", 1), hole("c7")), wire("W9", pin("P1", 0), hole("c10")));
    expect(ok(pass("intro-amps", t))).toBe(false);
  });

  it("урок 4: 5,6 кОм + 3,3 кОм дают ≈ 3,34 В; 10 кОм + 10 кОм (4,5 В) — нет", () => {
    const div = (top: number, bottom: number) => {
      const s = lesson("intro-divider").start();
      s.components.push(R("R1", top, ["top+6", "b7"]), R("R2", bottom, ["c7", "c12"]));
      s.wires.push(wire("W7", hole("a12"), hole("top-12")), wire("W8", pin("P1", 1), hole("d7")), wire("W9", pin("P1", 0), pin("GB1", 0)));
      return pass("intro-divider", s);
    };
    expect(ok(div(5_600, 3_300))).toBe(true);
    expect(ok(div(10_000, 10_000))).toBe(false);
  });

  it("урок 5: кнопка через резистор в базу — засчитано; светодиод прямо от кнопки — нет", () => {
    const s = lesson("intro-switch").start();
    s.components.push(
      { id: "VT1", type: "transistor", kind: "BC547", placement: { mode: "board", holes: ["c20", "c21", "c22"] } },
      R("R1", 470, ["top+15", "b16"]),
      { id: "HL1", type: "led", color: "green", placement: { mode: "board", holes: ["d16", "d20"] } },
      { id: "SB1", type: "button", placement: { mode: "board", holes: ["top+24", "b26"] } },
      R("R2", 10_000, ["c26", "d21"]),
    );
    s.wires.push(wire("W8", hole("a22"), hole("top-22")));
    const steps = pass("intro-switch", s);
    expect(steps.map((x) => x.ok)).toEqual([true, true, true, true]);
    // Без транзистора: кнопка → резистор → светодиод → минус
    const t = lesson("intro-switch").start();
    t.components.push(
      { id: "SB1", type: "button", placement: { mode: "board", holes: ["top+24", "b26"] } },
      R("R1", 470, ["c26", "c28"]),
      { id: "HL1", type: "led", color: "green", placement: { mode: "board", holes: ["d28", "d30"] } },
      { id: "VT1", type: "transistor", kind: "BC547", placement: { mode: "board", holes: ["h20", "h21", "h22"] } },
    );
    t.wires.push(wire("W8", hole("a30"), hole("top-25")));
    const bad = pass("intro-switch", t);
    expect(bad.find((x) => /через транзистор/.test(x.text))!.ok).toBe(false);
  });

  it("урок 6: щупы на коллектор и минус, развёртка на 2–10 периодов", () => {
    const s = lesson("intro-scope").start();
    s.wires.push(wire("W20", pin("P1", 0), pin("GB1", 0)), wire("W21", pin("P1", 1), hole("a10")));
    const fast = pass("intro-scope", s);
    expect(fast[0].ok && fast[1].ok).toBe(true);
    expect(fast[2].ok).toBe(false);
    const scope = s.components.find((c) => c.id === "P1") as { timeDiv: number };
    const period = Number(fast[2].text.match(/период ([\d,]+)/)![1].replace(",", "."));
    expect(period).toBeGreaterThan(0.1);
    scope.timeDiv = 0.5;
    expect(ok(pass("intro-scope", s)), fast[2].text).toBe(true);
  });
});
