/**
 * Платы: макетные и печатные, сколько угодно, где угодно на столе. Единица длины сцены = шаг 2,54 мм.
 *
 * Макетка на 400 точек: 30 столбцов, ряды a–e и f–j. Пять отверстий столбца в одной половине
 * (например a7–e7) соединены внутри платы полосой. Сверху и снизу — по две шины питания (+ и −),
 * каждая шина соединена по всей длине. Макетки ставятся вплотную вправо; между собой не
 * соединены — как настоящие, их соединяют проводом.
 *
 * Печатная плата лежит перед макетками: площадки изначально ни с чем не соединены — соединяют
 * медные дорожки. Размер выбирается; растёт вправо и вниз, левый верхний угол на месте.
 *
 * Раскладка меняется через applyLayout: HOLES и HOLE_BY_ID перестраиваются на месте,
 * поэтому все, кто их импортировал, видят новые отверстия.
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
  /** Плата, на которой отверстие: «BB1», «PCB1»… */
  boardId: string;
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

/** Плата на столе (сохраняется вместе со схемой). x, z — центр платы. */
export interface BoardSpec {
  /** «BB1», «BB2»… — макетки, «PCB1», «PCB2»… — печатные платы. */
  id: string;
  kind: "breadboard" | "pcb";
  x: number;
  z: number;
  /** Только у печатной платы: число столбцов и рядов площадок. */
  cols?: number;
  rows?: number;
}

/** Старый формат (до того, как платы стали отдельными предметами): число макеток и размер печатной. */
export interface Layout {
  breadboards: number;
  pcbCols: number;
  pcbRows: number;
}

/** Варианты размеров печатной платы (столбцы × ряды). */
export const PCB_SIZES: readonly [number, number][] = [
  [24, 14],
  [36, 20],
  [48, 26],
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Толщина печатной платы: текстолит FR-4 1,6 мм. */
export const PCB_HEIGHT = 1.6 / 2.54;
/** Платы кладутся в пределах стола (он 400 × 400, но дальше камера не отъезжает). */
export const TABLE_LIMIT = 120;

/** Стартовый набор: макетка и печатная плата 24 × 14 перед ней. */
export const DEFAULT_BOARDS: BoardSpec[] = [
  { id: "BB1", kind: "breadboard", x: 0, z: 0 },
  { id: "PCB1", kind: "pcb", x: 0, z: 21, cols: 24, rows: 14 },
];

/** Размер платы в шагах (у печатной — площадки плюс поля по 1,5 шага). */
export function boardSize(b: BoardSpec): { width: number; depth: number; height: number } {
  return b.kind === "breadboard"
    ? { ...BOARD }
    : { width: (b.cols ?? 24) + 3, depth: (b.rows ?? 14) + 3, height: PCB_HEIGHT };
}

/** Прямоугольник платы на столе. */
export function boardRect(b: BoardSpec): { x0: number; x1: number; z0: number; z1: number } {
  const { width, depth } = boardSize(b);
  return { x0: b.x - width / 2, x1: b.x + width / 2, z0: b.z - depth / 2, z1: b.z + depth / 2 };
}

/** Налезают ли платы друг на друга (касаться краями можно). */
export function boardsOverlap(a: BoardSpec, b: BoardSpec): boolean {
  const p = boardRect(a);
  const q = boardRect(b);
  const eps = 1e-6;
  return p.x0 < q.x1 - eps && q.x0 < p.x1 - eps && p.z0 < q.z1 - eps && q.z0 < p.z1 - eps;
}

/** Следующий свободный номер: «BB2», «PCB1»… */
export function nextBoardId(kind: BoardSpec["kind"], boards: readonly BoardSpec[]): string {
  const p = kind === "breadboard" ? "BB" : "PCB";
  for (let n = 1; ; n++) if (!boards.some((b) => b.id === `${p}${n}`)) return `${p}${n}`;
}

/** Номер платы из id: «BB2» → 2. */
function boardNumber(b: BoardSpec): number {
  return Number(b.id.replace(/^\D+/, ""));
}

/** Человекочитаемое имя: «макетка 2», «печатная плата 1». */
export function boardName(b: BoardSpec): string {
  return `${b.kind === "breadboard" ? "макетка" : "печатная плата"} ${boardNumber(b)}`;
}

/**
 * Приставки id отверстий и узлов. У первой макетки и первой печатной — как в старых схемах
 * («a7», «pA1»), у остальных с номером («2:a7», «p2:A1»).
 */
function prefixes(b: BoardSpec): { id: string; node: string } {
  const n = boardNumber(b);
  if (b.kind === "breadboard") return n === 1 ? { id: "", node: "" } : { id: `${n}:`, node: `bb${n}:` };
  return n === 1 ? { id: "p", node: "" } : { id: `p${n}:`, node: "" };
}

/** Координата X площадки в столбце col (1…) на печатной плате b. */
export function padX(b: BoardSpec, col: number): number {
  return boardRect(b).x0 + 1.5 + (col - 1);
}
/** Координата Z площадки в ряду rowIndex (0…) на печатной плате b. */
export function padZ(b: BoardSpec, rowIndex: number): number {
  return boardRect(b).z0 + 1.5 + rowIndex;
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

/** Отверстия одной платы. */
export function boardHoles(b: BoardSpec): Hole[] {
  const holes: Hole[] = [];
  const px = prefixes(b);
  if (b.kind === "breadboard") {
    for (let r = 0; r < ROWS.length; r++) {
      const half = r < 5 ? "top" : "bot";
      for (let c = 1; c <= COLUMNS; c++) {
        holes.push({
          id: `${px.id}${ROWS[r]}${c}`,
          x: b.x + c - 15.5,
          y: BOARD.height,
          z: b.z + rowZ(r),
          node: `${px.node}strip:${half}:${c}`,
          kind: "main",
          board: "breadboard",
          boardId: b.id,
        });
      }
    }
    for (const rail of RAILS) {
      for (let g = 0; g < 5; g++) {
        for (let k = 0; k < 5; k++) {
          holes.push({
            id: `${px.id}${rail.id}${g * 5 + k + 1}`,
            x: b.x - 14 + g * 6 + k,
            y: BOARD.height,
            z: b.z + rail.z,
            node: `${px.node}rail:${rail.id}`,
            kind: "rail",
            board: "breadboard",
            boardId: b.id,
            polarity: rail.polarity,
          });
        }
      }
    }
    return holes;
  }
  // Площадки печатной платы: у каждой свой узел
  const rows = LETTERS.slice(0, b.rows ?? 14);
  [...rows].forEach((row, r) => {
    for (let c = 1; c <= (b.cols ?? 24); c++) {
      const id = `${px.id}${row}${c}`;
      holes.push({ id, x: padX(b, c), y: PCB_HEIGHT, z: padZ(b, r), node: `pad:${id}`, kind: "pad", board: "pcb", boardId: b.id });
    }
  });
  return holes;
}

export const HOLES: Hole[] = [];
export const HOLE_BY_ID = new Map<string, Hole>();
/** Платы на столе сейчас (копии; менять через applyBoards). */
export const BOARDS: BoardSpec[] = [];

/** Перестроить отверстия под набор плат. HOLES, HOLE_BY_ID и BOARDS меняются на месте. */
export function applyBoards(boards: readonly BoardSpec[]): void {
  BOARDS.length = 0;
  BOARDS.push(...boards.map((b) => ({ ...b })));
  HOLES.length = 0;
  for (const b of BOARDS) HOLES.push(...boardHoles(b));
  HOLE_BY_ID.clear();
  for (const h of HOLES) HOLE_BY_ID.set(h.id, h);
}

applyBoards(DEFAULT_BOARDS);

export function boardById(id: string): BoardSpec | undefined {
  return BOARDS.find((b) => b.id === id);
}

/** Id всех отверстий набора плат (не трогая текущие). */
export function holeIdsFor(boards: readonly BoardSpec[]): Set<string> {
  const ids = new Set<string>();
  for (const b of boards) for (const h of boardHoles(b)) ids.add(h.id);
  return ids;
}

/**
 * Старое сохранение с раскладкой → платы на тех же местах: макетки вплотную вправо,
 * печатная плата с левым верхним углом в (−13,5; 12,5).
 */
export function boardsFromLayout(layout: Layout): BoardSpec[] {
  const out: BoardSpec[] = [];
  for (let i = 0; i < layout.breadboards; i++) out.push({ id: `BB${i + 1}`, kind: "breadboard", x: i * BOARD.width, z: 0 });
  const width = layout.pcbCols + 3;
  const depth = layout.pcbRows + 3;
  out.push({ id: "PCB1", kind: "pcb", x: -13.5 + width / 2, z: 12.5 + depth / 2, cols: layout.pcbCols, rows: layout.pcbRows });
  return out;
}

/** Границы всех плат (для камеры); без плат — область вокруг центра стола. */
export function boardsBounds(): { x0: number; x1: number; z0: number; z1: number } {
  if (!BOARDS.length) return { x0: -16, x1: 16, z0: -10.5, z1: 10.5 };
  const rs = BOARDS.map(boardRect);
  return {
    x0: Math.min(...rs.map((r) => r.x0)),
    x1: Math.max(...rs.map((r) => r.x1)),
    z0: Math.min(...rs.map((r) => r.z0)),
    z1: Math.max(...rs.map((r) => r.z1)),
  };
}

export function holesOnNode(node: string): Hole[] {
  return HOLES.filter((h) => h.node === node);
}

/** Отверстие платы boardId в точке (x, z), если оно там есть (для транзисторов). */
export function holeAt(boardId: string, x: number, z: number): Hole | undefined {
  return HOLES.find((h) => h.boardId === boardId && Math.abs(h.x - x) < 1e-6 && Math.abs(h.z - z) < 1e-6);
}

/** Человекочитаемое описание узла: «столбец 7 (a–e)», «шина + сверху», «макетка 2, …». */
export function describeNode(node: string): string {
  const m = node.match(/^bb(\d+):(.*)$/);
  if (m) return `макетка ${m[1]}, ${describeNode(m[2])}`;
  if (node.startsWith("pad:")) return `${holeLabel(node.slice(4))} (соединения — дорожками)`;
  const [kind, a, b] = node.split(":");
  if (kind === "strip") return `столбец ${b} (${a === "top" ? "a–e" : "f–j"})`;
  if (kind === "rail") return `шина ${a.endsWith("+") ? "+" : "−"} ${a.startsWith("top") ? "сверху" : "снизу"}`;
  return node;
}

/** Подпись отверстия для людей: «c7», «шина + сверху, 16», «макетка 2, c7», «площадка A12». */
export function holeLabel(id: string): string {
  const h = HOLE_BY_ID.get(id);
  if (!h) return id;
  if (h.kind === "pad") {
    const m = id.match(/^p(?:(\d+):)?(.*)$/)!;
    return `${m[1] ? `плата ${m[1]}, ` : ""}площадка ${m[2]}`;
  }
  const m = id.match(/^(?:(\d+):)?(.*)$/)!;
  const prefix = m[1] ? `макетка ${m[1]}, ` : "";
  const local = m[2];
  if (h.kind === "main") return `${prefix}${local}`;
  const r = local.match(/^(top|bot)([+-])(\d+)$/)!;
  return `${prefix}шина ${r[2] === "+" ? "+" : "−"} ${r[1] === "top" ? "сверху" : "снизу"}, ${r[3]}`;
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
  const t = (h: Hole) => ((h.x - a.x) * dx + (h.z - a.z) * dz) / len2;
  const on = HOLES.filter((h) => {
    if (h.boardId !== a.boardId) return false;
    const u = t(h);
    if (u < -1e-9 || u > 1 + 1e-9) return false;
    // Расстояние от центра площадки до линии дорожки меньше радиуса площадки (0,36 шага)
    const cross = Math.abs((h.x - a.x) * dz - (h.z - a.z) * dx) / Math.sqrt(len2);
    return cross < 0.36;
  });
  return on.sort((p, q) => t(p) - t(q)).map((h) => h.id);
}
