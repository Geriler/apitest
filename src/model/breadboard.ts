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
 * Корпус микросхемы — площадки, как у печатной платы, внутри контура DIP и выводы 1…N по краям,
 * на своих местах. На нём собирают свою микросхему.
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
  /** main и rail — макетка; pad — площадка печатной платы или корпуса. */
  kind: "main" | "rail" | "pad";
  board: "breadboard" | "pcb";
  /** Плата, на которой отверстие: «BB1», «PCB1»… */
  boardId: string;
  /** Для шин: знак, чтобы подсветить + и − цветом. */
  polarity?: "+" | "-";
  /** Площадка вывода корпуса: номер вывода (с 1). */
  pin?: number;
  /** Площадка посадочного места SMD: обозначение детали и номер вывода корпуса (с 1). */
  seat?: string;
  seatPin?: number;
  /** Площадка посадочного места: размер по X и по Z, в шагах (уже с поворотом). */
  w?: number;
  d?: number;
  /** Круглая площадка с отверстием (выводная деталь на плате под SMD). */
  round?: boolean;
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
  /** «BB1», «BB2»… — макетки, «PCB1», «PCB2»… — печатные платы, «S1» — платы под SMD, «K1» — корпус микросхемы. */
  id: string;
  kind: "breadboard" | "pcb" | "chip" | "smd";
  x: number;
  z: number;
  /** У печатной платы — число столбцов и рядов площадок; у платы под SMD — размер поля в шагах. */
  cols?: number;
  rows?: number;
  /** Только у корпуса: вид корпуса (по умолчанию DIP), число выводов, их назначение и имена, название. */
  package?: ChipPackage;
  pins?: number;
  roles?: ChipPinRole[];
  names?: string[];
  label?: string;
  /** Корпус из задания карьеры: вид, назначение и имена выводов менять нельзя. */
  fixed?: boolean;
  /** Вместимость, клеток, если не обычная (2 на вывод). */
  room?: number;
  /** Корпус: поле начинки под SMD (без сетки площадок — площадки появляются под деталями). */
  smd?: boolean;
  /** Посадочные места SMD-деталей (у платы под SMD и у корпуса с полем под SMD). */
  seats?: Seat[];
}

/**
 * Посадочное место SMD-детали: площадки её корпуса под ней, где бы она ни стояла.
 * x, z — центр относительно центра платы, в шагах; rot — поворот в четвертях оборота.
 */
export interface Seat {
  /** Обозначение детали, которая на нём стоит (id площадок — «s:U1.3»). */
  id: string;
  fp: Footprint;
  x: number;
  z: number;
  rot: number;
}

/**
 * Посадочные места корпусов. SMD (IPC-7351, номинальные): SOT-23 (3 вывода, шаг 0,95 мм),
 * SOT-23-5/6, SO-n (SOIC, шаг 1,27 мм), двухвыводные чипы 1206…0402. Выводные — отверстия
 * с площадками на шаге 2,54 мм: DIP-n (ряды через 7,62 мм), TH3 (три в ряд: TO-92, TO-220,
 * потенциометр), TH2-k (два вывода через k шагов: резистор, диод, светодиод…). NODE — узел
 * дорожки: точка излома или развилки, без детали.
 */
export type SmdFootprint = "SOT-23" | "SOT-23-5" | "SOT-23-6" | "SO-4" | "SO-6" | "SO-8" | "SO-14" | "SO-16" | "1206" | "0805" | "0603" | "0402";
export type Footprint = SmdFootprint | `DIP-${number}` | "TH3" | `TH2-${number}` | "NODE";

/** Выводное посадочное место (отверстия), а не SMD. */
export const isThtFootprint = (fp: Footprint): boolean => fp.startsWith("DIP-") || fp.startsWith("TH");

/** Площадка в мм в своей системе координат: вывод 1 — слева в ближнем ряду (+z к себе). */
interface PadMm {
  x: number;
  z: number;
  w: number;
  d: number;
  round?: boolean;
}

/** Площадка выводной детали: кольцо Ø 1,8 мм, как у печатной платы. */
const TH_PAD = 1.8;
/** Узел дорожки: точка шириной с дорожку. */
const NODE_PAD = 0.3;

/** Двухвыводные чипы: расстояние от центра до центра площадки и размер площадки, мм. */
const CHIP_PADS: Record<string, { c: number; w: number; d: number; body: [number, number, number] }> = {
  "1206": { c: 1.45, w: 1.15, d: 1.8, body: [3.2, 1.6, 0.55] },
  "0805": { c: 0.95, w: 1.0, d: 1.45, body: [2.0, 1.25, 0.5] },
  "0603": { c: 0.8, w: 0.9, d: 0.95, body: [1.6, 0.8, 0.45] },
  "0402": { c: 0.5, w: 0.55, d: 0.6, body: [1.0, 0.5, 0.35] },
};

/** SOT-23: шаг 0,95 мм, ряды площадок в ±1,1 мм от центра; SOIC: шаг 1,27 мм, ряды в ±2,7 мм. */
const SOT = { pitch: 0.95, row: 1.1, w: 0.6, d: 1.0 };
const SO = { pitch: 1.27, row: 2.7, w: 0.6, d: 1.55 };

/** Площадки корпуса по порядку выводов (1…n), мм. */
export function footprintPads(fp: Footprint): PadMm[] {
  if (fp === "NODE") return [{ x: 0, z: 0, w: NODE_PAD, d: NODE_PAD, round: true }];
  const th = (x: number, z: number): PadMm => ({ x: x * 2.54, z: z * 2.54, w: TH_PAD, d: TH_PAD, round: true });
  if (fp === "TH3") return [th(-1, 0), th(0, 0), th(1, 0)];
  if (fp.startsWith("TH2-")) {
    const k = Number(fp.slice(4));
    return [th(-k / 2, 0), th(k / 2, 0)];
  }
  if (fp.startsWith("DIP-")) {
    const n = Number(fp.slice(4));
    const k = n / 2;
    return pinOffsets("DIP", n).map(([along, across]) => th(along - (k - 1) / 2, across === 0 ? 1.5 : -1.5));
  }
  const chip = CHIP_PADS[fp];
  if (chip) return [{ x: -chip.c, z: 0, w: chip.w, d: chip.d }, { x: chip.c, z: 0, w: chip.w, d: chip.d }];
  const at = (g: typeof SOT, x: number, near: boolean): PadMm => ({ x: x * g.pitch, z: near ? g.row : -g.row, w: g.w, d: g.d });
  // SOT-23: 1 и 2 — ближний ряд, 3 — дальний посередине
  if (fp === "SOT-23") return [at(SOT, -1, true), at(SOT, 1, true), at(SOT, 0, false)];
  if (fp === "SOT-23-5") return [at(SOT, -1, true), at(SOT, 0, true), at(SOT, 1, true), at(SOT, 1, false), at(SOT, -1, false)];
  if (fp === "SOT-23-6") return [at(SOT, -1, true), at(SOT, 0, true), at(SOT, 1, true), at(SOT, 1, false), at(SOT, 0, false), at(SOT, -1, false)];
  const n = Number(fp.slice(3));
  const k = n / 2;
  return Array.from({ length: n }, (_, i) => (i < k ? at(SO, i - (k - 1) / 2, true) : at(SO, n - 1 - i - (k - 1) / 2, false)));
}

/** Корпус детали: длина вдоль ряда выводов, ширина, высота, мм. */
export function footprintBody(fp: Footprint): [number, number, number] {
  // У выводных корпус над платой может быть любым — место считается по площадкам
  if (fp === "NODE" || isThtFootprint(fp)) return [0, 0, 0];
  const chip = CHIP_PADS[fp];
  if (chip) return chip.body;
  if (fp === "SOT-23") return [2.9, 1.3, 1.0];
  if (fp === "SOT-23-5" || fp === "SOT-23-6") return [2.9, 1.6, 1.1];
  const n = Number(fp.slice(3));
  return [(n / 2) * 1.27 - 0.2, 3.9, 1.5];
}

/** Поворот на rot четвертей оборота (как rotation.y в сцене). */
function turnXZ(x: number, z: number, rot: number): [number, number] {
  const r = ((rot % 4) + 4) % 4;
  return r === 0 ? [x, z] : r === 1 ? [z, -x] : r === 2 ? [-x, -z] : [-z, x];
}

/** Можно ли на плате ставить SMD-детали (плата под SMD или корпус с полем под SMD). */
export function isSmdBoard(b: Pick<BoardSpec, "kind" | "smd"> | undefined): boolean {
  return !!b && (b.kind === "smd" || (b.kind === "chip" && !!b.smd));
}

/** Площадки посадочного места на плате b: мировые координаты и размеры в шагах. */
export function seatPads(b: BoardSpec, seat: Pick<Seat, "fp" | "x" | "z" | "rot">): { x: number; z: number; w: number; d: number; round?: boolean }[] {
  return footprintPads(seat.fp).map((p) => {
    const [dx, dz] = turnXZ(p.x / 2.54, p.z / 2.54, seat.rot);
    const odd = seat.rot % 2 !== 0;
    return { x: b.x + seat.x + dx, z: b.z + seat.z + dz, w: (odd ? p.d : p.w) / 2.54, d: (odd ? p.w : p.d) / 2.54, ...(p.round ? { round: true } : {}) };
  });
}

/** Занятый местом прямоугольник на плате (площадки и корпус с зазором 0,25 мм), мировые координаты. */
export function seatRect(b: BoardSpec, seat: Pick<Seat, "fp" | "x" | "z" | "rot">): { x0: number; x1: number; z0: number; z1: number } {
  const [bl, bw] = footprintBody(seat.fp);
  const pads = footprintPads(seat.fp);
  const gap = 0.25;
  const hx = Math.max(bl / 2, ...pads.map((p) => Math.abs(p.x) + p.w / 2)) + gap;
  const hz = Math.max(bw / 2, ...pads.map((p) => Math.abs(p.z) + p.d / 2)) + gap;
  const [ax, az] = seat.rot % 2 !== 0 ? [hz, hx] : [hx, hz];
  const cx = b.x + seat.x, cz = b.z + seat.z;
  return { x0: cx - ax / 2.54, x1: cx + ax / 2.54, z0: cz - az / 2.54, z1: cz + az / 2.54 };
}

/** Поле, где можно ставить SMD-детали: у платы — без края с площадками для проводов, у корпуса — поле начинки. */
export function seatField(b: BoardSpec): { x0: number; x1: number; z0: number; z1: number } {
  const r = boardRect(b);
  if (b.kind === "chip") {
    const f = chipField(b);
    return { x0: padX(b, 1) - 0.5, x1: padX(b, f.cols) + 0.5, z0: padZ(b, 0) - 0.5, z1: padZ(b, f.rows - 1) + 0.5 };
  }
  return { x0: r.x0 + 0.5, x1: r.x1 - 0.5, z0: r.z0 + 0.5, z1: r.z1 - 2 };
}

/** Шаг, по которому встают SMD-детали: четверть шага 2,54 мм (0,635 мм). */
export const SEAT_SNAP = 0.25;

/** Почему место не годится (вне поля, налезает на другое); undefined — годится. */
export function seatProblem(b: BoardSpec, seat: Seat): string | undefined {
  const r = seatRect(b, seat);
  const f = seatField(b);
  const eps = 1e-6;
  if (r.x0 < f.x0 - eps || r.x1 > f.x1 + eps || r.z0 < f.z0 - eps || r.z1 > f.z1 + eps) {
    return b.kind === "chip" ? "деталь вышла бы за поле корпуса" : "деталь вышла бы за край платы (у ближнего края — площадки для проводов)";
  }
  // Узел дорожки ничего не занимает
  if (seat.fp === "NODE") return undefined;
  for (const o of b.seats ?? []) {
    if (o.id === seat.id || o.fp === "NODE") continue;
    const q = seatRect(b, o);
    if (r.x0 < q.x1 - eps && q.x0 < r.x1 - eps && r.z0 < q.z1 - eps && q.z0 < r.z1 - eps) return `там уже стоит ${o.id}`;
  }
  return undefined;
}

/** Id площадки вывода pin (с 1) посадочного места seat на плате b: «s:U1.3», «k:VT1.2». */
export function seatHole(b: BoardSpec, seat: string, pin: number): string {
  return `${prefixes(b).id}${seat}.${pin}`;
}

/** Посадочное место, которому принадлежит площадка. */
export function seatOf(holeId: string): { board: BoardSpec; seat: Seat } | undefined {
  const h = HOLE_BY_ID.get(holeId);
  if (!h?.seat) return undefined;
  const board = boardById(h.boardId);
  const seat = board?.seats?.find((s) => s.id === h.seat);
  return board && seat ? { board, seat } : undefined;
}

/** Назначение вывода корпуса; nc — не подключён. */
export type ChipPinRole = "nc" | "in" | "out" | "vcc" | "gnd";

/** Вид корпуса: DIP (выводы в два ряда) или SOT-23-5/6 — крошечный, на переходнике с шагом 2,54 мм. */
export type ChipPackage = "DIP" | "SOT-23-5" | "SOT-23-6";

/** Крошечный корпус на переходнике. */
export const isSot = (pkg: ChipPackage | undefined): pkg is "SOT-23-5" | "SOT-23-6" => pkg === "SOT-23-5" || pkg === "SOT-23-6";

/** Корпуса, которые можно выбрать: «DIP-4» … «DIP-16», «SOT-23-5», «SOT-23-6». */
export const PACKAGES = ["DIP-4", "DIP-6", "DIP-8", "DIP-14", "DIP-16", "SOT-23-5", "SOT-23-6"];

/** Название корпуса: «DIP-8», «SOT-23-5». */
export function packageName(pkg: ChipPackage | undefined, pins: number): string {
  return isSot(pkg) ? pkg : `DIP-${pins}`;
}

/** Из названия — вид и число выводов. */
export function parsePackage(name: string): { package: ChipPackage; pins: number } {
  if (name === "SOT-23-5" || name === "SOT-23-6") return { package: name, pins: name === "SOT-23-5" ? 5 : 6 };
  return { package: "DIP", pins: Number(name.replace(/\D/g, "")) || 8 };
}

/**
 * Где выводы корпуса относительно вывода 1: [вдоль ряда, поперёк] в шагах 2,54 мм; поперёк 0 —
 * ближний ряд, 3 — дальний. DIP: 1…N/2 по ближнему слева направо, остальные обратно по дальнему.
 * SOT-23-5 на переходнике: 1, 2, 3 по ближнему; 4 — дальний справа, 5 — дальний слева (посередине
 * дальнего ряда ножки нет) — как у самого SOT-23-5. SOT-23-6 — по кругу, как DIP-6: 4 — дальний справа,
 * 5 — посередине, 6 — слева.
 */
export function pinOffsets(pkg: ChipPackage | undefined, pins: number): [number, number][] {
  if (pkg === "SOT-23-5") return [[0, 0], [1, 0], [2, 0], [2, 3], [0, 3]];
  const k = pins / 2;
  return Array.from({ length: pins }, (_, i): [number, number] => (i < k ? [i, 0] : [pins - 1 - i, 3]));
}

/** Словами, где какие выводы: для подсказок и панелей. */
export function pinLayoutText(pkg: ChipPackage | undefined, pins: number): string {
  if (pkg === "SOT-23-6") return "выводы 1–3 — по ближнему ряду слева направо, 4–6 — обратно по дальнему (как у SOT-23-6)";
  if (pkg === "SOT-23-5") return "выводы 1–3 — по ближнему ряду слева направо, 4 — дальний справа, 5 — дальний слева (как у SOT-23-5; посередине дальнего ряда ножки нет)";
  return `выводы 1–${pins / 2} — по ближнему ряду слева направо, ${pins / 2 + 1}–${pins} — обратно по дальнему, как у DIP`;
}

/** Поле площадок корпуса: по 4 столбца на место вывода в ряду, 8 рядов. */
export function chipField(b: Pick<BoardSpec, "package" | "pins">): { cols: number; rows: number } {
  const along = Math.max(...pinOffsets(b.package, b.pins ?? 8).map(([a]) => a)) + 1;
  return { cols: 4 * along + 1, rows: 8 };
}

/** Новый корпус: все выводы не подключены. */
export function newChipBoard(pins: number, x = 0, z = 0, id = "K1", pkg: ChipPackage = "DIP"): BoardSpec {
  return { id, kind: "chip", x, z, package: pkg, pins, roles: Array(pins).fill("nc"), names: Array(pins).fill(""), label: "" };
}

/** Старый формат (до того, как платы стали отдельными предметами): число макеток и размер печатной. */
export interface Layout {
  breadboards: number;
  pcbCols: number;
  pcbRows: number;
}

/** Размеры платы под SMD, шагов (40 × 25, 60 × 38 и 80 × 50 мм). */
export const SMD_BOARD_SIZES: readonly [number, number][] = [
  [16, 10],
  [24, 15],
  [32, 20],
];

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
  if (b.kind === "chip") {
    // Поле, по два шага до рядов выводов и по полтора — поля
    const f = chipField(b);
    return { width: f.cols + 3, depth: f.rows + 6, height: PCB_HEIGHT };
  }
  if (b.kind === "smd") return { width: b.cols ?? 24, depth: b.rows ?? 15, height: PCB_HEIGHT };
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
  const p = kind === "breadboard" ? "BB" : kind === "chip" ? "K" : kind === "smd" ? "S" : "PCB";
  for (let n = 1; ; n++) if (!boards.some((b) => b.id === `${p}${n}`)) return `${p}${n}`;
}

/** Номер платы из id: «BB2» → 2. */
function boardNumber(b: BoardSpec): number {
  return Number(b.id.replace(/^\D+/, ""));
}

/** Человекочитаемое имя: «макетка 2», «печатная плата 1». */
export function boardName(b: BoardSpec): string {
  if (b.kind === "chip") return `корпус ${packageName(b.package, b.pins ?? 8)}`;
  if (b.kind === "smd") return `плата под SMD ${boardNumber(b)}`;
  return `${b.kind === "breadboard" ? "макетка" : "печатная плата"} ${boardNumber(b)}`;
}

/**
 * Приставки id отверстий и узлов. У первой макетки и первой печатной — как в старых схемах
 * («a7», «pA1»), у остальных с номером («2:a7», «p2:A1»).
 */
function prefixes(b: BoardSpec): { id: string; node: string } {
  const n = boardNumber(b);
  if (b.kind === "breadboard") return n === 1 ? { id: "", node: "" } : { id: `${n}:`, node: `bb${n}:` };
  if (b.kind === "chip") return { id: n === 1 ? "k:" : `k${n}:`, node: "" };
  if (b.kind === "smd") return { id: n === 1 ? "s:" : `s${n}:`, node: "" };
  return n === 1 ? { id: "p", node: "" } : { id: `p${n}:`, node: "" };
}

/** Координата X площадки в столбце col (1…) на печатной плате или корпусе b. */
export function padX(b: BoardSpec, col: number): number {
  return boardRect(b).x0 + 1.5 + (col - 1);
}
/** Координата Z площадки в ряду rowIndex (0…) на печатной плате или корпусе b. */
export function padZ(b: BoardSpec, rowIndex: number): number {
  return boardRect(b).z0 + (b.kind === "chip" ? 3.5 : 1.5) + rowIndex;
}

/** Id площадки вывода n (с 1) корпуса b: «k:3», у второго корпуса — «k2:3». */
export function chipPinHole(b: BoardSpec, n: number): string {
  return `${prefixes(b).id}${n}`;
}

/**
 * Где площадка вывода i (с 0) корпуса b: по раскладке корпуса (pinOffsets), ближний ряд — у ближнего
 * края корпуса, дальний — у дальнего.
 */
export function chipPinAt(b: BoardSpec, i: number): { x: number; z: number } {
  const [along, across] = pinOffsets(b.package, b.pins ?? 8)[i];
  const { rows } = chipField(b);
  return { x: padX(b, 4 * along + 3), z: across === 0 ? padZ(b, rows - 1) + 2 : padZ(b, 0) - 2 };
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
  if (b.kind === "smd") {
    // Площадки для проводов вдоль ближнего края, J1…Jn
    const r = boardRect(b);
    for (let i = 1; i < (b.cols ?? 24); i++) {
      const id = `${px.id}J${i}`;
      holes.push({ id, x: r.x0 + i, y: PCB_HEIGHT, z: r.z1 - 1, node: `pad:${id}`, kind: "pad", board: "pcb", boardId: b.id });
    }
    return [...holes, ...seatHoles(b)];
  }
  if (b.kind === "chip") {
    const f = chipField(b);
    for (let r = 0; r < (b.smd ? 0 : f.rows); r++) {
      for (let c = 1; c <= f.cols; c++) {
        const id = `${px.id}${LETTERS[r]}${c}`;
        holes.push({ id, x: padX(b, c), y: PCB_HEIGHT, z: padZ(b, r), node: `pad:${id}`, kind: "pad", board: "pcb", boardId: b.id });
      }
    }
    for (let i = 0; i < (b.pins ?? 8); i++) {
      const id = `${px.id}${i + 1}`;
      const at = chipPinAt(b, i);
      holes.push({ id, x: at.x, y: PCB_HEIGHT, z: at.z, node: `pad:${id}`, kind: "pad", board: "pcb", boardId: b.id, pin: i + 1 });
    }
    return b.smd ? [...holes, ...seatHoles(b)] : holes;
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

/** Площадки посадочных мест платы. */
function seatHoles(b: BoardSpec): Hole[] {
  return (b.seats ?? []).flatMap((seat) =>
    seatPads(b, seat).map((p, i): Hole => {
      const id = seatHole(b, seat.id, i + 1);
      return { id, x: p.x, y: PCB_HEIGHT, z: p.z, node: `pad:${id}`, kind: "pad", board: "pcb", boardId: b.id, seat: seat.id, seatPin: i + 1, w: p.w, d: p.d, ...(p.round ? { round: true } : {}) };
    }),
  );
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
  if (h.pin) return `вывод ${h.pin} ${chipPinName(boardById(h.boardId), h.pin - 1)}`;
  if (h.seat) return boardById(h.boardId)?.seats?.find((x) => x.id === h.seat)?.fp === "NODE" ? `узел дорожки ${h.seat}` : `площадка ${h.seatPin} под ${h.seat}`;
  if (h.kind === "pad" && /^s\d*:/.test(id)) {
    const m = id.match(/^s(\d*):(.*)$/)!;
    return `${m[1] ? `плата под SMD ${m[1]}, ` : ""}площадка ${m[2]}`;
  }
  if (h.kind === "pad" && id.startsWith("k")) return `корпус, площадка ${id.slice(id.indexOf(":") + 1)}`;
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

/** Подпись вывода i (с 0) корпуса: своё имя или по назначению; неподключённый — NC. */
export function chipPinName(b: BoardSpec | undefined, i: number): string {
  const role = b?.roles?.[i] ?? "nc";
  return role === "nc" ? "NC" : b?.names?.[i]?.trim() || ROLE_NAMES[role];
}

const ROLE_NAMES: Record<ChipPinRole, string> = { nc: "NC", in: "IN", out: "OUT", vcc: "VCC", gnd: "GND" };

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
    // Расстояние от центра площадки до линии дорожки меньше радиуса площадки (0,36 шага);
    // прямоугольная SMD-площадка — если линия проходит через её прямоугольник
    if (h.w !== undefined && h.d !== undefined && !h.round) return segmentHitsRect(a, b, h);
    if (h.round && h.w !== undefined) return Math.abs((h.x - a.x) * dz - (h.z - a.z) * dx) / Math.sqrt(len2) < h.w / 2;
    const cross = Math.abs((h.x - a.x) * dz - (h.z - a.z) * dx) / Math.sqrt(len2);
    return cross < 0.36;
  });
  return on.sort((p, q) => t(p) - t(q)).map((h) => h.id);
}


/** Проходит ли отрезок a–b через прямоугольную площадку r (x, z — центр; w, d — размер). */
function segmentHitsRect(a: Hole, b: Hole, r: Hole): boolean {
  const hw = r.w! / 2, hd = r.d! / 2;
  // Отсечение отрезка прямоугольником (Лианг — Барски)
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [p, q] of [[-dx, a.x - (r.x - hw)], [dx, r.x + hw - a.x], [-dz, a.z - (r.z - hd)], [dz, r.z + hd - a.z]]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Дорожка на плате под SMD (или на поле корпуса под SMD) — тонкая, 0,3 мм. */
export function fineTrace(aId: string): boolean {
  return isSmdBoard(boardById(HOLE_BY_ID.get(aId)?.boardId ?? ""));
}
