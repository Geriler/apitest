/** Модель песочницы: что стоит на столе и как соединено. Без Three.js. */

import { DEFAULT_BOARDS, HOLE_BY_ID, boardsFromLayout, holeIdsFor, type BoardSpec, type ChipPackage, type ChipPinRole, type Layout } from "./breadboard";
export type { ChipPinRole } from "./breadboard";

export type SmdSize = "1206" | "0805" | "0603" | "0402";

/** Типовые размеры корпусов (длина × ширина, мм) и мощность, Вт. У конкретных серий могут отличаться. */
export const SMD_SIZES: Record<SmdSize, { lengthMm: number; widthMm: number; heightMm: number; ratedW: number }> = {
  "1206": { lengthMm: 3.2, widthMm: 1.6, heightMm: 0.55, ratedW: 0.25 },
  "0805": { lengthMm: 2.0, widthMm: 1.25, heightMm: 0.5, ratedW: 0.125 },
  "0603": { lengthMm: 1.6, widthMm: 0.8, heightMm: 0.45, ratedW: 0.1 },
  "0402": { lengthMm: 1.0, widthMm: 0.5, heightMm: 0.35, ratedW: 0.063 },
};

/** Выводной резистор 0,25 Вт: корпус ≈ 6,3 × 2,4 мм. */
export const THT_RESISTOR = { lengthMm: 6.3, diameterMm: 2.4, ratedW: 0.25 };

/**
 * Выводные резисторы разной мощности: типичные размеры корпусов (металлоплёночные до 0,5 Вт,
 * металлооксидные 1 и 2 Вт). Чем мощнее, тем крупнее — больше площадь, лучше отдаёт тепло.
 */
export const THT_RESISTORS = [
  { ratedW: 0.125, lengthMm: 3.5, diameterMm: 1.8 },
  { ratedW: 0.25, lengthMm: 6.3, diameterMm: 2.4 },
  { ratedW: 0.5, lengthMm: 9, diameterMm: 3.2 },
  { ratedW: 1, lengthMm: 11, diameterMm: 4.5 },
  { ratedW: 2, lengthMm: 15.5, diameterMm: 5 },
] as const;

/** Корпус выводного резистора по его мощности (в старых схемах мощности нет — 0,25 Вт). */
export function thtResistorSpec(c: { watts?: number }) {
  return THT_RESISTORS.find((r) => r.ratedW === (c.watts ?? 0.25)) ?? THT_RESISTORS[1];
}

export const BATTERIES = {
  "9V": { label: "Крона 9 В", emf: 9, rInt: 1.5 },
  "4.5V": { label: "3 × AA, 4,5 В", emf: 4.5, rInt: 0.45 },
  "3V": { label: "2 × AA, 3 В", emf: 3, rInt: 0.3 },
  "1.5V": { label: "AA, 1,5 В", emf: 1.5, rInt: 0.15 },
} as const;
export type BatteryKind = keyof typeof BATTERIES;

/** Миниатюрные лампы накаливания, номинал «напряжение × ток». */
export const LAMPS = {
  "2.5V": { label: "2,5 В × 0,3 А", ratedV: 2.5, ratedA: 0.3 },
  "3.5V": { label: "3,5 В × 0,26 А", ratedV: 3.5, ratedA: 0.26 },
  "6.3V": { label: "6,3 В × 0,3 А", ratedV: 6.3, ratedA: 0.3 },
  "12V": { label: "12 В × 0,1 А", ratedV: 12, ratedA: 0.1 },
} as const;
export type LampKind = keyof typeof LAMPS;

/**
 * Электролитические конденсаторы 16 В. Размеры (Ø × высота, мм) типовые для этих номиналов,
 * у разных серий отличаются. Электролит полярный: обратное напряжение больше ~1 В его портит.
 */
export const ELECTROLYTICS = [
  { uF: 10, diaMm: 5, heightMm: 11 },
  { uF: 100, diaMm: 6.3, heightMm: 11 },
  { uF: 470, diaMm: 8, heightMm: 12 },
  { uF: 1000, diaMm: 10, heightMm: 16 },
  { uF: 2200, diaMm: 13, heightMm: 21 },
  { uF: 4700, diaMm: 16, heightMm: 26 },
] as const;
export const ELECTROLYTIC_RATED_V = 16;
/** Ряд номинальных напряжений электролитов, В. */
export const ELECTROLYTIC_VOLTAGES = [6.3, 10, 16, 25, 35, 50, 63] as const;
/** Допустимое обратное напряжение электролита, В (ориентир, не паспортное значение). */
export const ELECTROLYTIC_REVERSE_V = 1;

/** Керамические конденсаторы 50 В, неполярные. */
export const CERAMICS = [
  { uF: 0.01, code: "103" },
  { uF: 0.1, code: "104" },
  { uF: 1, code: "105" },
] as const;
export const CERAMIC_RATED_V = 50;
/** Ряд номинальных напряжений керамических конденсаторов, В. */
export const CERAMIC_VOLTAGES = [16, 50, 100] as const;

/** Номинальное напряжение конденсатора (в старых схемах нет: электролит 16 В, керамика 50 В). */
export function capacitorVolts(c: { variant: "electrolytic" | "ceramic"; volts?: number }): number {
  return c.volts ?? (c.variant === "electrolytic" ? ELECTROLYTIC_RATED_V : CERAMIC_RATED_V);
}

/**
 * Параметры диодов для уравнения Шокли I = Is·(e^(V/(n·Vt)) − 1) с последовательным Rs.
 * 1N4007 — из распространённой SPICE-модели. Светодиоды подобраны так, чтобы
 * при 20 мА падение было около vf (типовое значение, у конкретных светодиодов разброс).
 */
export const DIODE_1N4007 = { label: "1N4007", is: 7.03e-9, n: 1.808, rs: 0.034, maxA: 1 };

/**
 * Выпрямительные и импульсные диоды: чем больше допустимый ток, тем крупнее корпус.
 * 1N4148 и 1N4007 — распространённые SPICE-модели; 1N5408 — подобрано по паспорту
 * (≈ 0,75 В при 1 А, ≈ 0,8 В при 3 А), это ориентир, не модель производителя.
 */
export const DIODES = {
  "1N4148": { label: "1N4148", is: 2.52e-9, n: 1.752, rs: 0.568, maxA: 0.2, lengthMm: 3.8, diameterMm: 1.8, glass: true },
  "1N4007": { ...DIODE_1N4007, lengthMm: 5.2, diameterMm: 2.7, glass: false },
  "1N5408": { label: "1N5408", is: 63e-9, n: 1.7, rs: 0.014, maxA: 3, lengthMm: 9.5, diameterMm: 5.3, glass: false },
} as const;
export type DiodeKind = keyof typeof DIODES;

/** Модель диода (в старых схемах нет — 1N4007). */
export function diodeSpec(c: { kind?: DiodeKind }) {
  return DIODES[c.kind ?? "1N4007"];
}

export const LEDS = {
  red: { label: "красный", vf: 2.0, hex: "#ff2a1a", glass: "#b8221a" },
  yellow: { label: "жёлтый", vf: 2.1, hex: "#ffc21a", glass: "#c9971a" },
  green: { label: "зелёный", vf: 2.2, hex: "#3dff5a", glass: "#2a9a3a" },
  blue: { label: "синий", vf: 3.0, hex: "#3a7bff", glass: "#2a4fb8" },
  white: { label: "белый", vf: 3.1, hex: "#f4f6ff", glass: "#d8dde8" },
} as const;
export type LedColor = keyof typeof LEDS;
/** Номинальный ток светодиода 5 мм, А. */
export const LED_RATED_A = 0.02;
export const LED_N = 2;
export const LED_RS = 8;

/**
 * Светодиоды по мощности: обычный 5 мм на 20 мА и мощный на 1 Вт (350 мА).
 * У мощного прямое напряжение при номинальном токе на ≈ 0,3 В выше, сопротивление меньше.
 */
export const LED_SIZES = {
  "5mm": { label: "5 мм, 20 мА", ratedA: LED_RATED_A, rs: LED_RS, vfAdd: 0 },
  "1W": { label: "мощный 1 Вт, 350 мА", ratedA: 0.35, rs: 1, vfAdd: 0.3 },
} as const;
export type LedSize = keyof typeof LED_SIZES;

/** Вид светодиода (в старых схемах нет — 5 мм). */
export function ledSpec(c: { size?: LedSize }) {
  return LED_SIZES[c.size ?? "5mm"];
}

/**
 * Биполярные транзисторы в корпусе TO-92, модель Эберса–Молла.
 * Is, βF, βR — по порядку величин распространённых SPICE-моделей BC547B / BC557B
 * (у разных производителей и экземпляров β заметно разнится: у BC547B паспорт 200–450).
 * Цоколёвка (плоской стороной к себе, выводы вниз, слева направо): К, Б, Э.
 */
export const TRANSISTORS = {
  BC547: { label: "BC547B", polarity: "npn" as const, is: 2e-14, betaF: 300, betaR: 8, maxIc: 0.1, maxP: 0.5 },
  BC557: { label: "BC557B", polarity: "pnp" as const, is: 2e-14, betaF: 250, betaR: 8, maxIc: 0.1, maxP: 0.5 },
};
export type TransistorKind = keyof typeof TRANSISTORS;

/**
 * MOSFET: квадратичная модель канала I = K/2·(Uзи − Uпор)² с плавным переходом в подпороговую область.
 * K подобран по сопротивлению открытого канала из даташита, Uпор — типовое (у экземпляров разброс,
 * у 2N7000 по даташиту 0,8–3 В). maxP — без радиатора. pins — роли ножек слева направо.
 */
export const MOSFETS = {
  "2N7000": {
    label: "2N7000", channel: "n" as const, pkg: "TO-92" as const, pins: ["S", "G", "D"] as const,
    vth: 2.1, k: 0.065, maxId: 0.2, maxP: 0.4, rdsNote: "≈ 2 Ом при Uзи = 10 В",
  },
  // P-канальная пара к 2N7000. Паспорт BS250P: −45 В, −230 мА, 0,7 Вт, порог −1…−3,5 В,
  // Rси не больше 14 Ом при Uзи = −10 В; k подобран на типичные ≈ 5–6 Ом.
  BS250: {
    label: "BS250", channel: "p" as const, pkg: "TO-92" as const, pins: ["D", "G", "S"] as const,
    vth: 2.2, k: 0.026, maxId: 0.23, maxP: 0.7, rdsNote: "≈ 5–6 Ом при Uзи = −10 В, по паспорту до 14 Ом",
  },
  IRLZ44N: {
    label: "IRLZ44N", channel: "n" as const, pkg: "TO-220" as const, pins: ["G", "D", "S"] as const,
    vth: 1.5, k: 13, maxId: 47, maxP: 2, rdsNote: "≈ 0,02 Ом при Uзи = 5 В",
  },
  IRF9540N: {
    label: "IRF9540N", channel: "p" as const, pkg: "TO-220" as const, pins: ["G", "D", "S"] as const,
    vth: 3, k: 1.2, maxId: 23, maxP: 2, rdsNote: "≈ 0,12 Ом при Uзи = −10 В",
  },
};
export type MosfetKind = keyof typeof MOSFETS;
export type MosfetRole = "G" | "D" | "S";

/** Номер вывода детали с данной ролью. */
export function mosfetPin(kind: MosfetKind, role: MosfetRole): 0 | 1 | 2 {
  return MOSFETS[kind].pins.indexOf(role) as 0 | 1 | 2;
}

/**
 * Сопротивление провода-перемычки на миллиметр длины, Ом: медь 22 AWG (0,326 мм²),
 * ρ/S = 1,72e−8 / 0,326e−6 ≈ 53 мОм/м. Провод 10 см — около 5 мОм.
 */
export const WIRE_OHM_PER_MM = 1.72e-8 / 0.326e-6 / 1000;
/** Сопротивление замкнутого выключателя, Ом. */
export const SWITCH_RESISTANCE = 0.01;

export type Placement =
  /** Отверстия по выводам: [вывод 0, вывод 1] или для транзистора [коллектор, база, эмиттер]. */
  | { mode: "board"; holes: string[] }
  | { mode: "free"; x: number; z: number; rot: number };

interface Base {
  id: string;
  placement: Placement;
}

export interface Resistor extends Base {
  type: "resistor";
  variant: "tht" | "smd";
  ohms: number;
  smdSize: SmdSize;
  /** Мощность выводного резистора, Вт (нет — 0,25 Вт). */
  watts?: number;
}

export interface Lamp extends Base {
  type: "lamp";
  kind: LampKind;
}

export interface Battery extends Base {
  type: "battery";
  kind: BatteryKind;
}

export interface Switch extends Base {
  type: "switch";
  closed: boolean;
}

/** Выводы полярных деталей: 0 — анод / плюс, 1 — катод / минус. */
export interface Capacitor extends Base {
  type: "capacitor";
  variant: "electrolytic" | "ceramic";
  uF: number;
  /** Номинальное напряжение, В (нет — 16 В у электролита, 50 В у керамики). */
  volts?: number;
}

export interface Diode extends Base {
  type: "diode";
  /** Модель (нет — 1N4007). */
  kind?: DiodeKind;
}

export interface Led extends Base {
  type: "led";
  color: LedColor;
  /** Обычный 5 мм или мощный 1 Вт (нет — 5 мм). */
  size?: LedSize;
}

/** Биполярный транзистор. Выводы: 0 — коллектор, 1 — база, 2 — эмиттер. */
export interface Transistor extends Base {
  type: "transistor";
  kind: TransistorKind;
}

/**
 * Полевой транзистор с изолированным затвором (MOSFET). Выводы — в порядке ножек корпуса
 * слева направо (маркировкой к себе); какой из них затвор, сток и исток — см. MOSFETS[kind].pins.
 */
export interface Mosfet extends Base {
  type: "mosfet";
  kind: MosfetKind;
}

/**
 * Лабораторный источник питания: держит заданное напряжение (режим CV), пока ток меньше
 * ограничения; если нагрузка требует больше — держит ток (режим CC), напряжение падает.
 * Выводы: 0 — минус (чёрная клемма), 1 — плюс (красная).
 */
export interface PowerSupply extends Base {
  type: "psu";
  volts: number;
  amps: number;
  on: boolean;
}

export const PSU_LIMITS = { maxV: 30, maxA: 3 };

/** Кнопка без фиксации: замкнута, пока её держат. Нажата ли — состояние расчёта (Simulation.held), не схемы. */
export interface PushButton extends Base {
  type: "button";
}

/** Потенциометр: вывод 0 и 2 — концы дорожки, 1 — движок. */
export interface Potentiometer extends Base {
  type: "pot";
  /** Полное сопротивление дорожки, Ом. */
  ohms: number;
  /** Положение движка: 0 — у вывода 0, 1 — у вывода 2. */
  position: number;
}

/** Реле на 5 или 12 В. */
export type RelayKind = "5V" | "12V";

/** Реле: выводы 0, 1 — катушка; 2 — COM, 3 — NO, 4 — NC. Положение якоря — состояние расчёта. */
export interface Relay extends Base {
  type: "relay";
  kind: RelayKind;
}

/** Микросхема, собранная из своей схемы. Что внутри — ChipDef по def. */
export interface Chip extends Base {
  type: "chip";
  /** Обозначение описания микросхемы (ChipDef.id). */
  def: string;
  /** Имя, корпус и число выводов — копия из описания (для подписей и места на плате). */
  name: string;
  package?: ChipPackage;
  pins: number;
}

/**
 * Описание микросхемы: схема, из которой её собрали, и её «плоская» начинка для расчёта.
 * Хранится в библиотеке браузера и в проекте (Scene.chips), чтобы файл проекта был самодостаточным.
 */
export interface ChipDef {
  id: string;
  name: string;
  /** Корпус: DIP или SOT-23-5 на переходнике. */
  package: ChipPackage;
  /** Выводов в корпусе (у DIP — чётное, 4…16). */
  pins: number;
  /** Имена выводов 1…pins ("" — без имени, "NC" — не подключён). */
  pinNames: string[];
  /** Назначение выводов 1…pins; "nc" — вывод не подключён. */
  pinRoles: ChipPinRole[];
  /** Сколько места занимает начинка, клеток (вместимость DIP — 2 клетки на вывод). */
  space?: number;
  /** Детали внутри (все — «на столе»: соединения задаёт nets). */
  parts: Component[];
  /** Цепи начинки: какие выводы каких деталей соединены и с каким выводом корпуса (с 1). */
  nets: { members: [string, Pin][]; pins?: number[] }[];
  /** Исходная схема — чтобы открыть и поправить. */
  scene: Scene;
  /** Когда упакована, мс с 1970 года (новее — важнее). */
  updatedAt: number;
}

/** Режим мультиметра: вольтметр, миллиамперметр, амперметр, омметр. */
export type MeterMode = "V" | "mA" | "A" | "ohm";

/** Мультиметр на столе. Вывод 0 — гнездо COM (чёрный щуп), вывод 1 — гнездо V/Ω/A (красный). */
export interface Multimeter extends Base {
  type: "meter";
  mode: MeterMode;
}

/** Осциллограф на столе. Вывод 0 — общий провод щупов, 1 — канал 1, 2 — канал 2. */
export interface Oscilloscope extends Base {
  type: "scope";
  /** Развёртка, секунд на деление (по горизонтали 10 делений). */
  timeDiv: number;
  /** Вольт на деление по каналам; 0 — подбирать самому. */
  voltsDiv: [number, number];
  /** «Стоп»: запись остановлена, на экране последняя картинка. */
  hold?: boolean;
}

export type Component = Resistor | Lamp | Battery | Switch | Capacitor | Diode | Led | Transistor | Mosfet | PowerSupply | Multimeter | Oscilloscope | PushButton | Potentiometer | Relay | Chip;
export type ComponentType = Component["type"];

/** Конец провода: отверстие макетки или вывод свободно стоящей детали. */
/** Номер вывода детали с нуля (у микросхем их до 16). */
export type Pin = number;
export type Endpoint = { hole: string } | { comp: string; pin: Pin };

export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
  color: string;
  /**
   * «flat» — прямая перемычка: лежит на плате, концы загнуты в отверстия. Только если оба конца
   * в отверстиях одной платы, иначе провод идёт дугой. «arc» или нет (старые схемы) — гибкий провод дугой.
   */
  shape?: WireShape;
}

export type WireShape = "flat" | "arc";

/** Насколько прямая перемычка длиннее расстояния между отверстиями: два загнутых конца, в шагах. */
export const FLAT_WIRE_EXTRA = 1;

/** Лежит ли провод на плате прямой перемычкой (выбрана перемычка и оба конца на одной плате). */
export function isFlatWire(w: { a: Endpoint; b: Endpoint; shape?: WireShape }): boolean {
  if (w.shape !== "flat" || !("hole" in w.a) || !("hole" in w.b)) return false;
  const a = HOLE_BY_ID.get(w.a.hole);
  const b = HOLE_BY_ID.get(w.b.hole);
  return !!a && !!b && a.boardId === b.boardId;
}

/**
 * Медная дорожка печатной платы между двумя площадками (отрезок).
 * Фольга 35 мкм, ширина с площадку (1,83 мм): сопротивление ≈ 0,27 мОм на миллиметр длины.
 */
export interface Trace {
  id: string;
  a: string;
  b: string;
}

/** Ширина дорожки, мм: как диаметр площадки (0,72 шага). */
export const TRACE_WIDTH_MM = 0.72 * 2.54;
/** Удельное сопротивление дорожки, Ом/мм: ρ(Cu) / (ширина × толщина) = 1,72e−8 / (1,83e−3 × 35e−6) / 1000. */
export const TRACE_OHM_PER_MM = 1.72e-8 / (TRACE_WIDTH_MM * 1e-3 * 35e-6) / 1000;

export interface Scene {
  components: Component[];
  wires: Wire[];
  /** Платы на столе. Нет — стартовый набор (макетка и печатная плата 24 × 14). */
  boards?: BoardSpec[];
  /** Старый формат раскладки плат: при загрузке превращается в boards. */
  layout?: Layout;
  /** Дорожки печатной платы (в старых сохранениях может не быть). */
  traces?: Trace[];
  /** Ручная раскладка принципиальной схемы (поверх автоматической). */
  schematic?: SchematicLayout;
  /** Описания микросхем, которые стоят в этой схеме (копия из библиотеки — для переноса файлом). */
  chips?: Record<string, ChipDef>;
  /** Эта схема — начинка микросхемы с таким обозначением (её открыли, чтобы поправить). */
  editingChip?: string;
  /** Стол карьеры: уровень (набор деталей ограничен) или мастерская (открытые модули). */
  career?: { level?: string; workshop?: boolean };
}

/**
 * Ручные правки принципиальной схемы: x — положение детали по горизонтали (по обозначению),
 * y — высота линии цепи (цепь узнаётся по первому по алфавиту выводу на ней, например «R1.0»).
 */
export interface SchematicLayout {
  x?: Record<string, number>;
  y?: Record<string, number>;
}

/** Что с деталью происходит во время симуляции. */
export interface ComponentState {
  burned: boolean;
  /** Накопленный перегрев, 0…1; при 1 деталь сгорает. */
  heat: number;
}

export function sameEndpoint(p: Endpoint, q: Endpoint): boolean {
  if ("hole" in p) return "hole" in q && q.hole === p.hole;
  return "comp" in q && q.comp === p.comp && q.pin === p.pin;
}



/**
 * Размер банки электролита. Таблица — для 16 В; на другое напряжение объём растёт примерно
 * пропорционально ему, поэтому диаметр и высота — как корень кубический из V / 16
 * (1000 мкФ: 6,3 В ≈ 7 × 12 мм, 35 В ≈ 13 × 21 мм, 63 В ≈ 16 × 25 мм — близко к каталогам).
 */
export function electrolyticSize(uF: number, volts = ELECTROLYTIC_RATED_V) {
  const base = ELECTROLYTICS.find((e) => e.uF === uF) ?? ELECTROLYTICS[ELECTROLYTICS.length - 1];
  const k = Math.cbrt(volts / ELECTROLYTIC_RATED_V);
  return { uF: base.uF, diaMm: Math.round(base.diaMm * k * 10) / 10, heightMm: Math.round(base.heightMm * k * 10) / 10 };
}

/** «4700 мкФ», «100 нФ». */
export function formatFarads(uF: number): string {
  if (uF >= 1) return `${String(uF).replace(".", ",")} мкФ`;
  return `${String(Math.round(uF * 1000)).replace(".", ",")} нФ`;
}



/** Платы сцены: из boards, из старой раскладки или стартовый набор. */
export function sceneBoards(scene: Scene): BoardSpec[] {
  return scene.boards ?? (scene.layout ? boardsFromLayout(scene.layout) : DEFAULT_BOARDS.map((b) => ({ ...b })));
}

/**
 * Что помешает перейти на такой набор плат: детали, провода и дорожки в отверстиях,
 * которых в нём не будет. Пустой список — можно менять.
 */
export function boardConflicts(scene: Scene, boards: readonly BoardSpec[]): string[] {
  const ids = holeIdsFor(boards);
  const out = new Set<string>();
  for (const c of scene.components) {
    if (c.placement.mode === "board" && c.placement.holes.some((h) => !ids.has(h))) out.add(c.id);
  }
  for (const w of scene.wires) {
    if ([w.a, w.b].some((e) => "hole" in e && !ids.has(e.hole))) out.add(w.id);
  }
  for (const t of scene.traces ?? []) {
    if (!ids.has(t.a) || !ids.has(t.b)) out.add(t.id);
  }
  return [...out];
}
