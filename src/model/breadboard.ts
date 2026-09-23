/**
 * Платы: макетные (1–3 штуки рядом) и печатная. Единица длины сцены = шаг отверстий 2,54 мм.
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
  /** Номер макетки, начиная с 0 (у площадок печатной платы не задан). */
  bb?: number;
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

/** Раскладка плат (сохраняется вместе со схемой). */
export interface Layout {
  breadboards: number;
  pcbCols: number;
  pcbRows: number;
}

export const DEFAULT_LAYOUT: Layout = { breadboards: 1, pcbCols: 24, pcbRows: 14 };

/** Варианты размеров печатной платы (столбцы × ряды). */
export const PCB_SIZES: readonly [number, number][] = [
  [24, 14],
  [36, 20],
  [48, 26],
];
export const MAX_BREADBOARDS = 3;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Левый и верхний край печатной платы — не меняются при изменении размера. */
const PCB_LEFT = -13.5;
const PCB_TOP = 12.5;

/**
 * Печатная плата: текстолит FR-4 1,6 мм, площадки с шагом 2,54 мм.
 * Поля пересчитываются в applyLayout.
 */
export const PCB = {
  cols: 24,
  rows: [...LETTERS.slice(0, 14)] as string[],
  /** Центр платы и её размер (с полями вокруг площадок). */
  x: 0,
  z: 21,
  width: 27,
  depth: 17,
  height: 1.6 / 2.54,
};

export let LAYOUT: Layout = { ...DEFAULT_LAYOUT };

export function padX(col: number): number {
  return PCB_LEFT + 1.5 + (col - 1);
}
export function padZ(rowIndex: number): number {
  return PCB_TOP + 1.5 + rowIndex;
}

/** Смещение макетки номер bb (0, 1, 2) по X: вплотную вправо. */
export function breadboardX(bb: number): number {
  return bb * BOARD.width;
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

/** Приставка обозначений и узлов макетки: у первой пусто (совместимость со старыми схемами). */
function bbPrefix(bb: number): { id: string; node: string } {
  return bb === 0 ? { id: "", node: "" } : { id: `${bb + 1}:`, node: `bb${bb + 1}:` };
}

function buildHoles(layout: Layout): Hole[] {
  const holes: Hole[] = [];
  for (let bb = 0; bb < layout.breadboards; bb++) {
    const px = bbPrefix(bb);
    const dx = breadboardX(bb);
    for (let r = 0; r < ROWS.length; r++) {
      const half = r < 5 ? "top" : "bot";
      for (let c = 1; c <= COLUMNS; c++) {
        holes.push({
          id: `${px.id}${ROWS[r]}${c}`,
          x: dx + c - 15.5,
          y: BOARD.height,
          z: rowZ(r),
          node: `${px.node}strip:${half}:${c}`,
          kind: "main",
          board: "breadboard",
          bb,
        });
      }
    }
    for (const rail of RAILS) {
      for (let g = 0; g < 5; g++) {
        for (let k = 0; k < 5; k++) {
          holes.push({
            id: `${px.id}${rail.id}${g * 5 + k + 1}`,
            x: dx - 14 + g * 6 + k,
            y: BOARD.height,
            z: rail.z,
            node: `${px.node}rail:${rail.id}`,
            kind: "rail",
            board: "breadboard",
            bb,
            polarity: rail.polarity,
          });
        }
      }
    }
  }
  // Площадки печатной платы: id «pA1»…, у каждой свой узел
  PCB.rows.forEach((row, r) => {
    for (let c = 1; c <= PCB.cols; c++) {
      const id = `p${row}${c}`;
      holes.push({ id, x: padX(c), y: PCB.height, z: padZ(r), node: `pad:${id}`, kind: "pad", board: "pcb" });
    }
  });
  return holes;
}

export const HOLES: Hole[] = [];
export const HOLE_BY_ID = new Map<string, Hole>();

/** Перестроить платы. Отверстия, которые остаются, сохраняют id и координаты. */
export function applyLayout(layout: Layout): void {
  LAYOUT = { ...layout };
  PCB.cols = layout.pcbCols;
  PCB.rows = [...LETTERS.slice(0, layout.pcbRows)];
  PCB.width = layout.pcbCols + 3;
  PCB.depth = layout.pcbRows + 3;
  PCB.x = PCB_LEFT + PCB.width / 2;
  PCB.z = PCB_TOP + PCB.depth / 2;
  HOLES.length = 0;
  HOLES.push(...buildHoles(layout));
  HOLE_BY_ID.clear();
  for (const h of HOLES) HOLE_BY_ID.set(h.id, h);
}

applyLayout(DEFAULT_LAYOUT);

/** Правая граница всех плат (для камеры). */
export function layoutRight(): number {
  return Math.max(breadboardX(LAYOUT.breadboards - 1) + BOARD.width / 2, PCB_LEFT + PCB.width);
}
/** Нижняя граница всех плат (для камеры). */
export function layoutBottom(): number {
  return PCB_TOP + PCB.depth;
}

export function holesOnNode(node: string): Hole[] {
  return HOLES.filter((h) => h.node === node);
}

/** Отверстие на той же плате и в том же ряду, сдвинутое на dx шагов (для транзисторов). */
export function holeAt(board: Hole["board"], x: number, z: number): Hole | undefined {
  return HOLES.find((h) => h.board === board && Math.abs(h.x - x) < 1e-6 && Math.abs(h.z - z) < 1e-6);
}

/** Человекочитаемое описание узла: «столбец 7 (a–e)», «шина + сверху», «макетка 2, …». */
export function describeNode(node: string): string {
  const m = node.match(/^bb(\d+):(.*)$/);
  if (m) return `макетка ${m[1]}, ${describeNode(m[2])}`;
  const [kind, a, b] = node.split(":");
  if (kind === "strip") return `столбец ${b} (${a === "top" ? "a–e" : "f–j"})`;
  if (kind === "rail") return `шина ${a.endsWith("+") ? "+" : "−"} ${a.startsWith("top") ? "сверху" : "снизу"}`;
  if (kind === "pad") return `площадка ${a.slice(1)} (соединения — дорожками)`;
  return node;
}

/** Подпись отверстия для людей: «c7», «шина + сверху, 16», «макетка 2, c7», «площадка A12». */
export function holeLabel(id: string): string {
  const h = HOLE_BY_ID.get(id);
  if (!h) return id;
  if (h.kind === "pad") return `площадка ${id.slice(1)}`;
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
    if (h.board !== "pcb") return false;
    const u = t(h);
    if (u < -1e-9 || u > 1 + 1e-9) return false;
    // Расстояние от центра площадки до линии дорожки меньше радиуса площадки (0,36 шага)
    const cross = Math.abs((h.x - a.x) * dz - (h.z - a.z) * dx) / Math.sqrt(len2);
    return cross < 0.36;
  });
  return on.sort((p, q) => t(p) - t(q)).map((h) => h.id);
}

/** Есть ли отверстие с таким id в раскладке (не перестраивая платы). */
export function holeExistsIn(id: string, layout: Layout): boolean {
  const pad = id.match(/^p([A-Z])(\d+)$/);
  if (pad) return LETTERS.indexOf(pad[1]) < layout.pcbRows && Number(pad[2]) <= layout.pcbCols;
  const bb = id.match(/^(\d+):/);
  return (bb ? Number(bb[1]) : 1) <= layout.breadboards;
}
