import { describe, expect, it } from "vitest";
import { colorBands, e12Values, formatOhms, formatSI, smdCode } from "../src/sim/resistorCodes";

const names = (ohms: number) => colorBands(ohms).map((b) => b.name);

describe("цветные полосы", () => {
  it.each([
    [1, ["коричневый", "чёрный", "золотой", "золотой"]],
    [4.7, ["жёлтый", "фиолетовый", "золотой", "золотой"]],
    [0.47, ["жёлтый", "фиолетовый", "серебряный", "золотой"]],
    [10, ["коричневый", "чёрный", "чёрный", "золотой"]],
    [220, ["красный", "красный", "коричневый", "золотой"]],
    [4700, ["жёлтый", "фиолетовый", "красный", "золотой"]],
    [10_000, ["коричневый", "чёрный", "оранжевый", "золотой"]],
    [1_000_000, ["коричневый", "чёрный", "зелёный", "золотой"]],
  ])("%s Ом", (ohms, expected) => {
    expect(names(ohms)).toEqual(expected);
  });
});

describe("код SMD", () => {
  it.each([
    [0.47, "R47"],
    [0.1, "R10"],
    [1, "1R0"],
    [4.7, "4R7"],
    [10, "100"],
    [220, "221"],
    [4700, "472"],
    [10_000, "103"],
    [1_000_000, "105"],
  ])("%s Ом → %s", (ohms, code) => {
    expect(smdCode(ohms)).toBe(code);
  });
});

describe("форматирование", () => {
  it("номиналы", () => {
    expect(formatOhms(4700)).toBe("4,7 кОм");
    expect(formatOhms(220)).toBe("220 Ом");
    expect(formatOhms(1_000_000)).toBe("1 МОм");
    expect(formatOhms(1200)).toBe("1,2 кОм");
  });

  it("величины с приставками", () => {
    expect(formatSI(0.0123, "А")).toBe("12,3 мА");
    expect(formatSI(9, "В")).toBe("9 В");
    expect(formatSI(0, "Вт")).toBe("0 Вт");
    expect(formatSI(-0.5, "А")).toBe("-500 мА");
  });

  it("ряд E12 без артефактов округления", () => {
    const values = e12Values();
    expect(values).toHaveLength(73);
    expect(values).toContain(1200);
    expect(values).toContain(820_000);
    for (const v of values) expect(v).toBe(Number(v.toPrecision(2)));
  });
});
