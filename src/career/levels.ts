/**
 * Карьера: уровни — компоненты, которые открываются, когда соберёшь их сам из выданного набора.
 * У компонента бывает несколько вариантов сборки (КМОП, РТЛ) — это отдельные уровни, открыть можно
 * все. Корпус — SOT-23-5 на переходнике, распиновка как у настоящих 74LVC1G.
 *
 * У каждого уровня есть эталонная сборка (recipe): из неё строится «заводской» компонент для
 * песочницы, и на ней тесты проверяют, что уровень проходим ровно с выданным набором.
 */

import type { ChipPinRole } from "../model/breadboard";
import type { MosfetKind, TransistorKind } from "../model/types";

/** Логическая функция компонента. */
export type LogicFunc = "not" | "nand" | "nor" | "and" | "or" | "xor";

/** Деталь набора: сколько штук и что именно (тип и номинал). */
export type KitItem =
  | { part: "mosfet"; kind: MosfetKind; count: number }
  | { part: "bjt"; kind: TransistorKind; count: number }
  | { part: "resistor"; ohms: number; count: number }
  | { part: "chip"; func: LogicFunc; count: number };

/**
 * Эталонная сборка на корпусе SOT-23-5 (поле 13 × 8, ряды A–H; выводы: 1 — снизу слева, 2 — снизу
 * посередине, 3 — снизу справа, 4 — сверху справа, 5 — сверху слева).
 * Концы цепей: «P1»…«P5» — выводы корпуса, «VT1.G/D/S» — MOSFET, «VT1.C/B/E» — биполярный,
 * «R1.1/2» — резистор, «D1.3» — вывод 3 микросхемы.
 */
export interface Recipe {
  parts: { id: string; holes: string[]; kind?: string; ohms?: number; func?: LogicFunc }[];
  nets: string[][];
}

export interface Level {
  id: string;
  func: LogicFunc;
  /** Обозначение: «74LVC1G00»; у вариантов без серийного номера — своё. */
  part: string;
  title: string;
  about: string;
  /** Назначение и имена выводов 1…5. */
  roles: ChipPinRole[];
  names: string[];
  /** Вместимость корпуса, клеток (по умолчанию 2 на вывод). */
  room?: number;
  kit: KitItem[];
  recipe: Recipe;
}

/** Выводы логических элементов 74LVC1G (SOT-23-5): 1 A, 2 B, 3 GND, 4 Y, 5 VCC. */
const GATE2 = { roles: ["in", "in", "gnd", "out", "vcc"] as ChipPinRole[], names: ["A", "B", "", "Y", ""] };
/** У инвертора 74LVC1G04: 1 — не подключён, 2 A, 3 GND, 4 Y, 5 VCC. */
const GATE1 = { roles: ["nc", "in", "gnd", "out", "vcc"] as ChipPinRole[], names: ["", "A", "", "Y", ""] };

/** Входы (номера выводов) и выход — для проверки таблицы истинности. */
export function gateIo(level: Level): { inputs: number[]; output: number; vcc: number; gnd: number } {
  const pin = (r: ChipPinRole) => level.roles.map((x, i) => (x === r ? i + 1 : 0)).filter(Boolean);
  return { inputs: pin("in"), output: pin("out")[0], vcc: pin("vcc")[0], gnd: pin("gnd")[0] };
}

/** Что должен выдать элемент на входах bits. */
export function truth(func: LogicFunc, bits: boolean[]): boolean {
  const [a, b] = bits;
  switch (func) {
    case "not":
      return !a;
    case "nand":
      return !(a && b);
    case "nor":
      return !(a || b);
    case "and":
      return a && b;
    case "or":
      return a || b;
    case "xor":
      return a !== b;
  }
}

const mos = (id: string, kind: MosfetKind, row: string, col: number) => ({ id, kind, holes: [0, 1, 2].map((d) => `k:${row}${col + d}`) });
const bjt = (id: string, row: string, col: number) => ({ id, kind: "BC547", holes: [0, 1, 2].map((d) => `k:${row}${col + d}`) });
const res = (id: string, ohms: number, a: string, b: string) => ({ id, ohms, holes: [`k:${a}`, `k:${b}`] });
/** Микросхема SOT-23-5 на переходнике: вывод 1 в отверстии row+col, дальний ряд на три ряда выше. */
const sot = (id: string, func: LogicFunc, row: string, col: number) => {
  const up = "ABCDEFGH"["ABCDEFGH".indexOf(row) - 3];
  return { id, func, holes: [`k:${row}${col}`, `k:${row}${col + 1}`, `k:${row}${col + 2}`, `k:${up}${col + 2}`, `k:${up}${col}`] };
};

export const LEVELS: Level[] = [
  {
    id: "not-cmos",
    func: "not",
    part: "74LVC1G04",
    title: "НЕ (инвертор), КМОП",
    about: "Выход — противоположность входу. Пара транзисторов: p-канальный тянет выход к питанию, n-канальный — к общему; открыт всегда ровно один.",
    ...GATE1,
    kit: [
      { part: "mosfet", kind: "BS250", count: 1 },
      { part: "mosfet", kind: "2N7000", count: 1 },
    ],
    recipe: {
      parts: [mos("VT1", "BS250", "C", 5), mos("VT2", "2N7000", "F", 5)],
      nets: [["P5", "VT1.S"], ["VT1.D", "VT2.D", "P4"], ["VT2.S", "P3"], ["P2", "VT1.G", "VT2.G"]],
    },
  },
  {
    id: "not-rtl",
    func: "not",
    part: "РТЛ-НЕ",
    title: "НЕ (инвертор), резисторно-транзисторная логика",
    about: "Биполярный транзистор с резистором в коллекторе: есть ток базы — транзистор открыт и прижимает выход к общему, нет — резистор подтягивает выход к питанию.",
    ...GATE1,
    kit: [
      { part: "bjt", kind: "BC547", count: 1 },
      { part: "resistor", ohms: 10_000, count: 1 },
      { part: "resistor", ohms: 1_000, count: 1 },
    ],
    recipe: {
      parts: [bjt("VT1", "E", 6), res("R1", 10_000, "G2", "G5"), res("R2", 1_000, "B8", "B11")],
      nets: [["P2", "R1.1"], ["R1.2", "VT1.B"], ["VT1.E", "P3"], ["VT1.C", "R2.1", "P4"], ["R2.2", "P5"]],
    },
  },
  {
    id: "nand-cmos",
    func: "nand",
    part: "74LVC1G00",
    title: "И-НЕ (NAND), КМОП",
    about: "Ноль на выходе — только когда на обоих входах единица. Два p-канальных параллельно к питанию, два n-канальных последовательно к общему.",
    ...GATE2,
    kit: [
      { part: "mosfet", kind: "BS250", count: 2 },
      { part: "mosfet", kind: "2N7000", count: 2 },
    ],
    recipe: {
      parts: [mos("VT1", "BS250", "B", 2), mos("VT2", "BS250", "B", 8), mos("VT3", "2N7000", "E", 8), mos("VT4", "2N7000", "G", 8)],
      nets: [
        ["P5", "VT1.S", "VT2.S"],
        ["P4", "VT1.D", "VT2.D", "VT3.D"],
        ["VT3.S", "VT4.D"],
        ["VT4.S", "P3"],
        ["P1", "VT1.G", "VT3.G"],
        ["P2", "VT2.G", "VT4.G"],
      ],
    },
  },
  {
    id: "nand-rtl",
    func: "nand",
    part: "РТЛ-И-НЕ",
    title: "И-НЕ (NAND), резисторно-транзисторная логика",
    about: "Два транзистора последовательно: выход прижимается к общему, только когда открыты оба. Резисторы в базах ограничивают ток входов.",
    ...GATE2,
    kit: [
      { part: "bjt", kind: "BC547", count: 2 },
      { part: "resistor", ohms: 10_000, count: 2 },
      { part: "resistor", ohms: 1_000, count: 1 },
    ],
    recipe: {
      parts: [bjt("VT1", "C", 6), bjt("VT2", "F", 6), res("R1", 10_000, "D2", "D5"), res("R2", 10_000, "H2", "H5"), res("R3", 1_000, "A8", "A11")],
      nets: [["P5", "R3.2"], ["R3.1", "VT1.C", "P4"], ["VT1.E", "VT2.C"], ["VT2.E", "P3"], ["P1", "R1.1"], ["R1.2", "VT1.B"], ["P2", "R2.1"], ["R2.2", "VT2.B"]],
    },
  },
  {
    id: "nor-cmos",
    func: "nor",
    part: "74LVC1G02",
    title: "ИЛИ-НЕ (NOR), КМОП",
    about: "Единица на выходе — только когда на обоих входах ноль. Два p-канальных последовательно к питанию, два n-канальных параллельно к общему.",
    ...GATE2,
    kit: [
      { part: "mosfet", kind: "BS250", count: 2 },
      { part: "mosfet", kind: "2N7000", count: 2 },
    ],
    recipe: {
      parts: [mos("VT1", "BS250", "B", 2), mos("VT2", "BS250", "D", 2), mos("VT3", "2N7000", "F", 6), mos("VT4", "2N7000", "F", 10)],
      nets: [
        ["P5", "VT1.S"],
        ["VT1.D", "VT2.S"],
        ["VT2.D", "P4", "VT3.D", "VT4.D"],
        ["VT3.S", "VT4.S", "P3"],
        ["P1", "VT1.G", "VT3.G"],
        ["P2", "VT2.G", "VT4.G"],
      ],
    },
  },
  {
    id: "nor-rtl",
    func: "nor",
    part: "РТЛ-ИЛИ-НЕ",
    title: "ИЛИ-НЕ (NOR), резисторно-транзисторная логика",
    about: "Два транзистора параллельно: любой открытый прижимает выход к общему. Классика РТЛ — из таких вентилей собирали бортовой компьютер «Аполлона».",
    ...GATE2,
    kit: [
      { part: "bjt", kind: "BC547", count: 2 },
      { part: "resistor", ohms: 10_000, count: 2 },
      { part: "resistor", ohms: 1_000, count: 1 },
    ],
    recipe: {
      parts: [bjt("VT1", "D", 3), bjt("VT2", "D", 8), res("R1", 10_000, "G1", "G4"), res("R2", 10_000, "G6", "G9"), res("R3", 1_000, "A8", "A11")],
      nets: [["P5", "R3.2"], ["R3.1", "VT1.C", "VT2.C", "P4"], ["VT1.E", "VT2.E", "P3"], ["P1", "R1.1"], ["R1.2", "VT1.B"], ["P2", "R2.1"], ["R2.2", "VT2.B"]],
    },
  },
  {
    id: "and",
    func: "and",
    part: "74LVC1G08",
    title: "И (AND) из И-НЕ и НЕ",
    about: "И — это И-НЕ с инвертором на выходе. Собирается из уже открытых микросхем: так большие схемы складываются из кусочков.",
    ...GATE2,
    kit: [
      { part: "chip", func: "nand", count: 1 },
      { part: "chip", func: "not", count: 1 },
    ],
    recipe: {
      parts: [sot("D1", "nand", "E", 2), sot("D2", "not", "E", 8)],
      nets: [["P1", "D1.1"], ["P2", "D1.2"], ["P3", "D1.3", "D2.3"], ["P5", "D1.5", "D2.5"], ["D1.4", "D2.2"], ["D2.4", "P4"]],
    },
  },
  {
    id: "or",
    func: "or",
    part: "74LVC1G32",
    title: "ИЛИ (OR) из ИЛИ-НЕ и НЕ",
    about: "ИЛИ — это ИЛИ-НЕ с инвертором на выходе.",
    ...GATE2,
    kit: [
      { part: "chip", func: "nor", count: 1 },
      { part: "chip", func: "not", count: 1 },
    ],
    recipe: {
      parts: [sot("D1", "nor", "E", 2), sot("D2", "not", "E", 8)],
      nets: [["P1", "D1.1"], ["P2", "D1.2"], ["P3", "D1.3", "D2.3"], ["P5", "D1.5", "D2.5"], ["D1.4", "D2.2"], ["D2.4", "P4"]],
    },
  },
  {
    id: "xor",
    func: "xor",
    part: "74LVC1G86",
    title: "Исключающее ИЛИ (XOR) из четырёх И-НЕ",
    about: "Единица на выходе, когда входы разные. Классическая схема из четырёх И-НЕ: N1 = И-НЕ(A, B), N2 = И-НЕ(A, N1), N3 = И-НЕ(B, N1), Y = И-НЕ(N2, N3).",
    ...GATE2,
    // Четыре вентиля не влезли бы в 10 клеток SOT-23-5: у настоящей 74LVC1G86 кристалл плотнее
    room: 24,
    kit: [{ part: "chip", func: "nand", count: 4 }],
    recipe: {
      parts: [sot("D1", "nand", "D", 2), sot("D2", "nand", "D", 8), sot("D3", "nand", "H", 2), sot("D4", "nand", "H", 8)],
      nets: [
        ["P5", "D1.5", "D2.5", "D3.5", "D4.5"],
        ["P3", "D1.3", "D2.3", "D3.3", "D4.3"],
        ["P1", "D1.1", "D2.1"],
        ["P2", "D1.2", "D3.1"],
        ["D1.4", "D2.2", "D3.2"],
        ["D2.4", "D4.1"],
        ["D3.4", "D4.2"],
        ["D4.4", "P4"],
      ],
    },
  },
];

export const levelById = (id: string) => LEVELS.find((l) => l.id === id);

/** Название детали набора: «BS250», «резистор 10 кОм», «И-НЕ (своя)». */
export function kitLabel(k: KitItem): string {
  if (k.part === "mosfet" || k.part === "bjt") return k.kind;
  if (k.part === "resistor") return `резистор ${k.ohms >= 1000 ? `${k.ohms / 1000} кОм` : `${k.ohms} Ом`}`;
  return `${FUNC_NAMES[k.func]} — открытая микросхема`;
}

export const FUNC_NAMES: Record<LogicFunc, string> = { not: "НЕ", nand: "И-НЕ", nor: "ИЛИ-НЕ", and: "И", or: "ИЛИ", xor: "Исключающее ИЛИ" };
