/**
 * Топология макетной платы на 400 точек.
 * Единица длины сцены = шаг отверстий 2,54 мм.
 *
 * Основное поле: 30 столбцов, ряды a–e и f–j. Пять отверстий столбца
 * в одной половине (например a7–e7) соединены внутри платы полосой.
 * Сверху и снизу — по две шины питания (+ и −), каждая шина соединена
 * по всей длине.
 */

export interface Hole {
  id: string;
  x: number;
  z: number;
  /** Электрический узел: все отверстия с одинаковым node соединены внутри платы. */
  node: string;
  kind: "main" | "rail";
  /** Для шин: знак, чтобы подсветить + и − цветом. */
  polarity?: "+" | "-";
}

export const COLUMNS = 30;
export const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const;

export const BOARD = {
  width: 32,
  depth: 21,
  height: 3.3,
};

function rowZ(rowIndex: number): number {
  // a..e: −5,5..−1,5; центральная канавка; f..j: 1,5..5,5
  return rowIndex < 5 ? -5.5 + rowIndex : 1.5 + (rowIndex - 5);
}

const RAILS: { id: string; z: number; polarity: "+" | "-" }[] = [
  { id: "top+", z: -9, polarity: "+" },
  { id: "top-", z: -8, polarity: "-" },
  { id: "bot-", z: 8, polarity: "-" },
  { id: "bot+", z: 9, polarity: "+" },
];

function buildHoles(): Hole[] {
  const holes: Hole[] = [];
  for (let r = 0; r < ROWS.length; r++) {
    const half = r < 5 ? "top" : "bot";
    for (let c = 1; c <= COLUMNS; c++) {
      holes.push({
        id: `${ROWS[r]}${c}`,
        x: c - 15.5,
        z: rowZ(r),
        node: `strip:${half}:${c}`,
        kind: "main",
      });
    }
  }
  for (const rail of RAILS) {
    for (let g = 0; g < 5; g++) {
      for (let k = 0; k < 5; k++) {
        holes.push({
          id: `${rail.id}${g * 5 + k + 1}`,
          x: -14 + g * 6 + k,
          z: rail.z,
          node: `rail:${rail.id}`,
          kind: "rail",
          polarity: rail.polarity,
        });
      }
    }
  }
  return holes;
}

export const HOLES: readonly Hole[] = buildHoles();
export const HOLE_BY_ID: ReadonlyMap<string, Hole> = new Map(HOLES.map((h) => [h.id, h]));

export function holesOnNode(node: string): Hole[] {
  return HOLES.filter((h) => h.node === node);
}

/** Человекочитаемое описание узла: «столбец 7 (a–e)», «шина +». */
export function describeNode(node: string): string {
  const [kind, a, b] = node.split(":");
  if (kind === "strip") return `столбец ${b} (${a === "top" ? "a–e" : "f–j"})`;
  if (kind === "rail") return `шина ${a.endsWith("+") ? "+" : "−"} ${a.startsWith("top") ? "сверху" : "снизу"}`;
  return node;
}

/** Подпись отверстия для людей: «c7», «шина + сверху, 16». */
export function holeLabel(id: string): string {
  const h = HOLE_BY_ID.get(id);
  if (!h || h.kind === "main") return id;
  const m = id.match(/^(top|bot)([+-])(\d+)$/)!;
  return `шина ${m[2] === "+" ? "+" : "−"} ${m[1] === "top" ? "сверху" : "снизу"}, ${m[3]}`;
}
