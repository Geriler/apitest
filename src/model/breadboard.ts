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
  /** Высота поверхности платы над столом (куда входят выводы). */
  y: number;
  z: number;
  /** Электрический узел: все отверстия с одинаковым node соединены внутри платы. */
  node: string;
  /** main и rail — макетка; pad — площадка печатной платы. */
  kind: "main" | "rail" | "pad";
  board: "breadboard" | "pcb";
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

/**
 * Печатная плата перед макеткой: текстолит FR-4 толщиной 1,6 мм, лежит на столе.
 * Сетка металлизированных площадок 24 × 14 с шагом 2,54 мм, столбцы 1–24, ряды A–N.
 * Площадки изначально ни с чем не соединены — соединяют медные дорожки.
 */
export const PCB = {
  cols: 24,
  rows: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"] as const,
  /** Центр платы и её размер (с полями вокруг площадок). */
  x: 0,
  z: 21,
  width: 27,
  depth: 17,
  height: 1.6 / 2.54,
};

export function padX(col: number): number {
  return PCB.x + col - (PCB.cols + 1) / 2;
}
export function padZ(rowIndex: number): number {
  return PCB.z + rowIndex - (PCB.rows.length - 1) / 2;
}

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
        y: BOARD.height,
        z: rowZ(r),
        node: `strip:${half}:${c}`,
        kind: "main",
        board: "breadboard",
      });
    }
  }
  for (const rail of RAILS) {
    for (let g = 0; g < 5; g++) {
      for (let k = 0; k < 5; k++) {
        holes.push({
          id: `${rail.id}${g * 5 + k + 1}`,
          x: -14 + g * 6 + k,
          y: BOARD.height,
          z: rail.z,
          node: `rail:${rail.id}`,
          kind: "rail",
          board: "breadboard",
          polarity: rail.polarity,
        });
      }
    }
  }
  // Площадки печатной платы: id «pA1»…«pN24», у каждой свой узел
  PCB.rows.forEach((row, r) => {
    for (let c = 1; c <= PCB.cols; c++) {
      const id = `p${row}${c}`;
      holes.push({ id, x: padX(c), y: PCB.height, z: padZ(r), node: `pad:${id}`, kind: "pad", board: "pcb" });
    }
  });
  return holes;
}

export const HOLES: readonly Hole[] = buildHoles();
export const HOLE_BY_ID: ReadonlyMap<string, Hole> = new Map(HOLES.map((h) => [h.id, h]));

export function holesOnNode(node: string): Hole[] {
  return HOLES.filter((h) => h.node === node);
}

/** Отверстие на той же плате и в том же ряду, сдвинутое на dx шагов (для транзисторов). */
export function holeAt(board: Hole["board"], x: number, z: number): Hole | undefined {
  return HOLES.find((h) => h.board === board && Math.abs(h.x - x) < 1e-6 && Math.abs(h.z - z) < 1e-6);
}

/** Человекочитаемое описание узла: «столбец 7 (a–e)», «шина +». */
export function describeNode(node: string): string {
  const [kind, a, b] = node.split(":");
  if (kind === "strip") return `столбец ${b} (${a === "top" ? "a–e" : "f–j"})`;
  if (kind === "rail") return `шина ${a.endsWith("+") ? "+" : "−"} ${a.startsWith("top") ? "сверху" : "снизу"}`;
  if (kind === "pad") return `площадка ${a.slice(1)} (соединения — дорожками)`;
  return node;
}

/** Подпись отверстия для людей: «c7», «шина + сверху, 16». */
export function holeLabel(id: string): string {
  const h = HOLE_BY_ID.get(id);
  if (!h || h.kind === "main") return id;
  if (h.kind === "pad") return `площадка ${id.slice(1)}`;
  const m = id.match(/^(top|bot)([+-])(\d+)$/)!;
  return `шина ${m[2] === "+" ? "+" : "−"} ${m[1] === "top" ? "сверху" : "снизу"}, ${m[3]}`;
}

/**
 * Площадки печатной платы, через которые проходит отрезок от a до b (включая концы), по порядку.
 * Медь дорожки, прошедшей по площадке, с ней соединена — поэтому отрезок делится в этих точках.
 */
export function padsAlong(aId: string, bId: string): string[] {
  const a = HOLE_BY_ID.get(aId)!;
  const b = HOLE_BY_ID.get(bId)!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const on = HOLES.filter((h) => {
    if (h.board !== "pcb") return false;
    const t = ((h.x - a.x) * dx + (h.z - a.z) * dz) / len2;
    if (t < -1e-9 || t > 1 + 1e-9) return false;
    // Расстояние от центра площадки до линии дорожки меньше радиуса площадки (0,36 шага)
    const cross = Math.abs((h.x - a.x) * dz - (h.z - a.z) * dx) / Math.sqrt(len2);
    return cross < 0.36;
  });
  const t = (h: Hole) => ((h.x - a.x) * dx + (h.z - a.z) * dz) / len2;
  return on.sort((p, q) => t(p) - t(q)).map((h) => h.id);
}
