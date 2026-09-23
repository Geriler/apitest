import * as THREE from "three";
import {
  BOARDS,
  HOLE_BY_ID,
  PCB_SIZES,
  TABLE_LIMIT,
  applyBoards,
  boardById,
  boardName,
  boardRect,
  boardSize,
  boardsOverlap,
  describeNode,
  holeAt,
  holeLabel,
  holesOnNode,
  nextBoardId,
  padsAlong,
  type BoardSpec,
  type Hole,
} from "./model/breadboard";
import {
  BATTERIES,
  CERAMICS,
  CERAMIC_RATED_V,
  DIODE_1N4007,
  ELECTROLYTICS,
  ELECTROLYTIC_RATED_V,
  LAMPS,
  LEDS,
  MOSFETS,
  PSU_LIMITS,
  SMD_SIZES,
  THT_RESISTOR,
  TRANSISTORS,
  canGoOnBoard,
  formatFarads,
  isFlatWire,
  isPolar,
  boardConflicts,
  pinCount,
  sameEndpoint,
  sceneBoards,
  type BatteryKind,
  type Component,
  type Endpoint,
  type LampKind,
  type LedColor,
  type Mosfet,
  type MosfetKind,
  type Pin,
  type Scene,
  type SmdSize,
  type Transistor,
  type TransistorKind,
  type Wire,
  type WireShape,
} from "./model/types";
import { colorBands, e12Values, formatOhms, formatSI, smdCode } from "./sim/resistorCodes";
import { Simulation, VT, diodeParams, heatThreshold, lampResistance, traceResistance, wireResistance } from "./sim/simulation";
import * as tolerance from "./sim/tolerance";
import { NO_TOLERANCE, type Tolerance } from "./sim/tolerance";
import { buildComponentView, buildTraceView, buildWireView, type ComponentView, type WireView } from "./view/builders";
import type { World } from "./view/world";

type Tool = "select" | "wire" | "trace" | "bb" | "pcb" | "tht" | "smd" | "cap" | "diode" | "led" | "bjt" | "fet" | "lamp" | "switch" | "battery" | "psu" | "delete";
type PlaceTool = "tht" | "smd" | "cap" | "diode" | "led" | "bjt" | "fet" | "lamp" | "switch" | "battery" | "psu";

// SMD пока скрыт из интерфейса (вернётся вместе с печатной платой), но сохранённые схемы с ним открываются.
const PLACE_TOOLS: PlaceTool[] = ["tht", "cap", "diode", "led", "bjt", "fet", "lamp", "switch", "battery", "psu"];
const TOOL_KEYS: Record<string, Tool> = {
  "1": "select", "2": "wire", "3": "tht", "4": "cap", "5": "diode", "6": "led", "7": "lamp", "8": "switch", "9": "battery", "0": "bjt", m: "fet", M: "fet", "ь": "fet", "Ь": "fet",
  t: "trace", T: "trace", "е": "trace", "Е": "trace", p: "psu", P: "psu", "з": "psu", "З": "psu",
  b: "bb", B: "bb", "и": "bb", "И": "bb", v: "pcb", V: "pcb", "м": "pcb", "М": "pcb",
};
/** Инструмент → тип детали. */
const TOOL_TYPE: Record<PlaceTool, Component["type"]> = {
  tht: "resistor", smd: "resistor", cap: "capacitor", diode: "diode", led: "led", bjt: "transistor", fet: "mosfet", lamp: "lamp", switch: "switch", battery: "battery", psu: "psu",
};
/**
 * Обозначения по ЕСКД: R — резистор, C — конденсатор, VD — диод, HL — лампа и светодиод
 * (приборы световой индикации), VT — транзистор, SA — выключатель, GB — батарея.
 */
const PREFIX: Record<Component["type"], string> = {
  resistor: "R", lamp: "HL", led: "HL", switch: "SA", battery: "GB", capacitor: "C", diode: "VD", transistor: "VT", mosfet: "VT", psu: "G",
};
const WIRE_COLORS = ["#e3b21c", "#2f9e5a", "#2f6fd1", "#e2762a", "#8e4cc9", "#e9e9e4"];
/** Палитра проводов для ручного выбора. */
export const WIRE_PALETTE: { hex: string; name: string }[] = [
  { hex: "#c8261f", name: "красный" },
  { hex: "#1b1d20", name: "чёрный" },
  { hex: "#2f6fd1", name: "синий" },
  { hex: "#e3b21c", name: "жёлтый" },
  { hex: "#2f9e5a", name: "зелёный" },
  { hex: "#e2762a", name: "оранжевый" },
  { hex: "#8e4cc9", name: "фиолетовый" },
  { hex: "#e9e9e4", name: "белый" },
];
/** Самые длинные выводы, которые можно согнуть между двумя отверстиями (в шагах). */
const MAX_LEAD_SPAN = 12;
const STORAGE_KEY = "maketka.scene.v1";
const TOLERANCE_KEY = "maketka.tolerance.v1";
const CURRENT_KEY = "maketka.showCurrent.v1";

interface Hover {
  hole?: Hole;
  pin?: { comp: string; pin: Pin; pos: THREE.Vector3 };
  componentId?: string;
  wireId?: string;
  traceId?: string;
  /** Плата под курсором (если под ним нет детали, провода или дорожки). */
  boardId?: string;
  table?: THREE.Vector3;
  overBoard: boolean;
}

export class App {
  scene: Scene;
  sim: Simulation;
  tool: Tool = "select";
  /** Выбранная щелчком деталь или провод. Панель справа показывает только выбранное, не наведённое. */
  selected?: string;
  /** Выбранное щелчком отверстие (в режиме «Выбор»). */
  selectedHole?: Hole;
  /** Выбранная щелчком плата: её можно тащить мышью. */
  selectedBoard?: string;
  hover: Hover = { overBoard: false };

  private views = new Map<string, ComponentView>();
  private wireViews = new Map<string, WireView>();
  private traceViews = new Map<string, { mesh: THREE.Object3D; curve: THREE.Curve<THREE.Vector3>; length: number }>();
  /** Площадка, от которой продолжается дорожка (инструмент «Дорожка»). */
  private pendingPad?: Hole;
  private dotPhase = new Map<string, number>();
  private pendingHole?: Hole;
  private pendingEnd?: Endpoint;
  private ghost?: THREE.Object3D;
  private ghostRot = 0;
  private drag?: { id: string; offset: THREE.Vector3 };
  /** Перенос платы: смещение от курсора до центра платы. */
  private boardDrag?: { id: string; offset: THREE.Vector3; moved: boolean };
  private boardFrame = 0;
  private down?: { x: number; y: number; t: number };
  private burnedAt = new Map<string, number>();
  private clock = new THREE.Clock();
  private lastTick = performance.now();
  private time = 0;
  /** Какая панель показана (деталь, провод, отверстие…) и её разметка. */
  private inspectorKey = "";
  private inspectorHtml = "";
  private lastInspector = 0;
  private sparkTimer = 0;
  private wireColor = 0;

  defaults = {
    ohms: 220,
    smdSize: "0805" as SmdSize,
    lamp: "3.5V" as LampKind,
    battery: "9V" as BatteryKind,
    capVariant: "electrolytic" as "electrolytic" | "ceramic",
    electrolyticUF: 1000,
    ceramicUF: 0.1,
    led: "red" as LedColor,
    transistor: "BC547" as TransistorKind,
    mosfet: "2N7000" as MosfetKind,
    psuVolts: 5,
    psuAmps: 0.5,
    /** Размер новой печатной платы: столбцы × ряды. */
    pcbSize: "24x14",
    /** "auto" — красный к плюсу, чёрный к минусу, остальные по кругу; иначе цвет из палитры. */
    wireColor: "auto",
    /** Какой провод брать: прямую перемычку (если оба конца на одной плате) или гибкий дугой. */
    wireShape: "flat" as WireShape,
  };

  constructor(
    private world: World,
    private ui: { inspector: HTMLElement; hint: HTMLElement; toasts: HTMLElement; tools: HTMLElement },
    initial: Scene,
  ) {
    this.scene = initial;
    this.adoptBoards();
    this.world.rebuildBoards(true);
    this.sim = new Simulation(this.scene, App.loadTolerance());
    try {
      this.showCurrent = localStorage.getItem(CURRENT_KEY) !== "off";
    } catch {
      /* по умолчанию показываем */
    }
    this.rebuild();
    this.bindInput();
    this.setTool("select");
    // Если кадры редкие, физика догоняет сама
    setInterval(() => this.tick(), 50);
  }

  // ─── Модель ────────────────────────────────────────────────────────────

  private nextId(type: Component["type"]): string {
    const p = PREFIX[type];
    let n = 1;
    for (const c of this.scene.components) {
      const m = c.id.match(new RegExp(`^${p}(\\d+)$`));
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    return `${p}${n}`;
  }

  private nextWireId(): string {
    let n = 1;
    for (const w of this.scene.wires) {
      const m = w.id.match(/^W(\d+)$/);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    return `W${n}`;
  }

  component(id: string): Component | undefined {
    return this.scene.components.find((c) => c.id === id);
  }

  /** Занятые отверстия: отверстие → кто в нём (вывод детали или провод). */
  private occupied(): Map<string, string> {
    const occ = new Map<string, string>();
    for (const c of this.scene.components) {
      if (c.placement.mode === "board") for (const h of c.placement.holes) occ.set(h, c.id);
    }
    for (const w of this.scene.wires) for (const e of [w.a, w.b]) if ("hole" in e) occ.set(e.hole, w.id);
    return occ;
  }

  /** Вызывать после любого изменения сцены. */
  changed(): void {
    this.sim.solve();
    this.rebuild();
    this.save();
    this.inspectorHtml = "";
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scene));
    } catch {
      /* хранилище недоступно — не страшно */
    }
  }

  // ─── Платы и отображение тока ──────────────────────────────────────────

  /** Показывать бегущие точки тока (расчёт и показания в панелях не зависят от этого). */
  showCurrent = true;

  setShowCurrent(on: boolean): void {
    this.showCurrent = on;
    try {
      localStorage.setItem(CURRENT_KEY, on ? "on" : "off");
    } catch {
      /* хранилище недоступно */
    }
    if (!on) this.world.setDots([]);
  }

  /** Надпись в шапке панели инструментов: сколько точек на всех макетках. */
  private updateBrand(): void {
    const el = this.ui.tools.querySelector(".brand span");
    if (el) el.textContent = `${BOARDS.filter((b) => b.kind === "breadboard").length * 400} точек`;
  }

  /** Платы сцены (старая раскладка превращается в платы) → отверстия. */
  private adoptBoards(): void {
    this.scene.boards = sceneBoards(this.scene);
    delete this.scene.layout;
    applyBoards(this.scene.boards);
    this.updateBrand();
  }

  /**
   * Почему плату нельзя положить сюда (пусто — можно): край стола, другая плата
   * или деталь, стоящая на столе.
   */
  private boardProblem(b: BoardSpec): string | undefined {
    const r = boardRect(b);
    if (Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) > TABLE_LIMIT) return "Там край стола.";
    const other = (this.scene.boards ?? []).find((o) => o.id !== b.id && boardsOverlap(o, b));
    if (other) return `Место занято: там ${boardName(other)}.`;
    const part = this.scene.components.find(
      (c) => c.placement.mode === "free" && c.placement.x > r.x0 - 1 && c.placement.x < r.x1 + 1 && c.placement.z > r.z0 - 1 && c.placement.z < r.z1 + 1,
    );
    if (part) return `Место занято: там лежит ${part.id}.`;
    return undefined;
  }

  /** Новая плата выбранного вида с центром в точке стола (по сетке отверстий). */
  private newBoard(kind: BoardSpec["kind"], at: THREE.Vector3): BoardSpec {
    const b: BoardSpec = { id: nextBoardId(kind, this.scene.boards ?? []), kind, x: Math.round(at.x), z: Math.round(at.z) };
    if (kind === "pcb") [b.cols, b.rows] = this.defaults.pcbSize.split("x").map(Number);
    return b;
  }

  /** После изменения набора плат: отверстия, сцена, сохранение. */
  private boardsChanged(): void {
    applyBoards(this.scene.boards ?? []);
    this.world.rebuildBoards();
    this.updateBrand();
    if (this.selectedHole) this.selectedHole = HOLE_BY_ID.get(this.selectedHole.id);
    if (this.selectedBoard && !boardById(this.selectedBoard)) this.selectedBoard = undefined;
    this.changed();
  }

  /** Сказать, что мешает, и ничего не менять. */
  private refuse(title: string, conflicts: string[], advice: string): void {
    this.toast(title, `На ней стоят: ${conflicts.slice(0, 8).join(", ")}${conflicts.length > 8 ? " и др." : ""}. ${advice}`);
    this.inspectorHtml = "";
  }

  /** Убрать плату со стола — только пустую. */
  removeBoard(id: string): boolean {
    const b = boardById(id);
    if (!b) return false;
    const rest = (this.scene.boards ?? []).filter((x) => x.id !== id);
    const conflicts = boardConflicts(this.scene, rest);
    if (conflicts.length) {
      this.refuse(`${boardName(b)[0].toUpperCase()}${boardName(b).slice(1)} не пустая`, conflicts, "Уберите их — потом плату.");
      return false;
    }
    this.scene.boards = rest;
    if (this.selectedBoard === id) this.selectedBoard = undefined;
    if (this.selectedHole?.boardId === id) this.selectedHole = undefined;
    this.boardsChanged();
    return true;
  }

  /**
   * Сменить размер печатной платы. Левый верхний угол на месте, поэтому стоящее на плате
   * не сдвигается. Уменьшить можно, только если на отрезаемой части ничего нет.
   */
  resizeBoard(id: string, cols: number, rows: number): boolean {
    const b = boardById(id);
    if (!b || b.kind !== "pcb") return false;
    const r = boardRect(b);
    const next: BoardSpec = { ...b, cols, rows, x: r.x0 + (cols + 3) / 2, z: r.z0 + (rows + 3) / 2 };
    const boards = (this.scene.boards ?? []).map((x) => (x.id === id ? next : x));
    const conflicts = boardConflicts(this.scene, boards);
    if (conflicts.length) {
      this.refuse("Не помещается", conflicts, "Уберите их или перенесите — потом уменьшайте.");
      return false;
    }
    const problem = this.boardProblem(next);
    if (problem) {
      this.toast("Не помещается", `${problem} Сдвиньте плату или то, что рядом.`);
      this.inspectorHtml = "";
      return false;
    }
    this.scene.boards = boards;
    this.boardsChanged();
    return true;
  }

  /** Раздел панели о плате: название, размер, что можно сделать. */
  private boardSection(b: BoardSpec): string {
    const size = boardSize(b);
    const mmSize = `${Math.round(size.width * 2.54)} × ${Math.round(size.depth * 2.54)} мм`;
    const sizeRow =
      b.kind === "pcb"
        ? this.selectField("boardSize", "Размер", PCB_SIZES.map(([c, r]) => [`${c}x${r}`, `${c} × ${r} площадок (${Math.round((c + 3) * 2.54)} × ${Math.round((r + 3) * 2.54)} мм)`]), `${b.cols}x${b.rows}`)
        : `<div class="kv"><span>Размер</span><span>400 точек, ${mmSize}</span></div>`;
    return `<div class="board-section">
      <div class="eyebrow">плата</div>
      <h3>${boardName(b)[0].toUpperCase()}${boardName(b).slice(1)}</h3>
      ${sizeRow}
      <p class="sub">Чтобы передвинуть, тащите плату мышью — детали, провода и дорожки поедут вместе с ней.</p>
      <div class="row"><button class="btn inline danger" data-board-act="remove">Убрать плату</button></div>
    </div>`;
  }

  private boardPanel(b: BoardSpec): [string, string] {
    return [`b:${b.id}`, this.boardSection(b)];
  }

  private boardToolPanel(kind: BoardSpec["kind"]): [string, string] {
    const html =
      kind === "breadboard"
        ? `<div class="eyebrow">новая плата</div><h2>Макетка</h2>
      <p>400 точек: 30 столбцов по 5 соединённых отверстий и по две шины питания сверху и снизу.</p>
      <p class="sub">Нажмите на свободное место на столе. Макетки между собой не соединены — как настоящие: соединяйте проводом.</p>`
        : `<div class="eyebrow">новая плата</div><h2>Печатная плата</h2>
      ${this.selectField("pcbSize", "Размер", PCB_SIZES.map(([c, r]) => [`${c}x${r}`, `${c} × ${r} площадок (${Math.round((c + 3) * 2.54)} × ${Math.round((r + 3) * 2.54)} мм)`]), this.defaults.pcbSize)}
      <p class="sub">Нажмите на свободное место на столе. Площадки ни с чем не соединены — соединяйте медными дорожками (T).</p>`;
    return [`bt:${kind}`, html];
  }

  // ─── Допуски ───────────────────────────────────────────────────────────

  get tolerance(): Tolerance {
    return this.sim.tolerance;
  }

  /** Включить или выключить «реальные допуски»; seed сохраняется, поэтому детали остаются теми же. */
  setTolerance(t: Tolerance): void {
    this.sim.tolerance = t;
    this.sim.solve();
    try {
      localStorage.setItem(TOLERANCE_KEY, JSON.stringify(t));
    } catch {
      /* хранилище недоступно */
    }
    this.inspectorHtml = "";
    this.renderInspector();
  }

  static loadTolerance(): Tolerance {
    try {
      const t = JSON.parse(localStorage.getItem(TOLERANCE_KEY) ?? "null") as Tolerance | null;
      if (t && typeof t.enabled === "boolean" && typeof t.seed === "number") return t;
    } catch {
      /* нет сохранённого */
    }
    return { ...NO_TOLERANCE, seed: Math.floor(Math.random() * 1e9) };
  }

  /**
   * Строки «Фактически» для панели детали: реальные параметры этого экземпляра.
   * Пусто, если режим допусков выключен.
   */
  private actualRows(c: Component): string {
    const t = this.sim.tolerance;
    if (!t.enabled) return "";
    const pct = (actual: number, nominal: number) => {
      const d = (actual / nominal - 1) * 100;
      return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1).replace(".", ",")} %`;
    };
    const row = (name: string, value: string) => `<div class="kv actual"><span>${name}</span><span>${value}</span></div>`;
    switch (c.type) {
      case "resistor": {
        const r = tolerance.resistance(c, t);
        return row("Фактически", `${formatOhms(r)} (${pct(r, c.ohms)})`);
      }
      case "lamp": {
        const r = lampResistance(c, t);
        return row("Нить фактически", formatOhms(r));
      }
      case "battery": {
        const b = tolerance.battery(c, t);
        return row("ЭДС фактически", formatSI(b.emf, "В")) + row("Внутр. сопротивление", formatOhms(b.rInt));
      }
      case "capacitor": {
        const f = tolerance.capacitance(c, t);
        return row("Ёмкость фактически", `${formatFarads(f * 1e6)} (${pct(f * 1e6, c.uF)})`);
      }
      case "led":
        return row("Прямое напряжение при 20 мА", formatSI(tolerance.ledVf(c, t), "В"));
      case "diode": {
        const p = diodeParams(c, t);
        return row("Прямое напряжение при 10 мА", formatSI(p.n * VT * Math.log(0.01 / p.is), "В"));
      }
      case "transistor":
        return row("β этого экземпляра", String(Math.round(tolerance.betaF(c, t))));
      case "mosfet": {
        const m = tolerance.mosfetParams(c, t);
        return row("Порог этого экземпляра", `${MOSFETS[c.kind].channel === "p" ? "−" : ""}${formatSI(m.vth, "В")}`);
      }
      default:
        return "";
    }
  }

  static load(): Scene | undefined {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      const s = JSON.parse(raw) as Scene;
      return Array.isArray(s.components) && Array.isArray(s.wires) ? s : undefined;
    } catch {
      return undefined;
    }
  }

  replaceScene(s: Scene): void {
    this.scene = s;
    this.adoptBoards();
    this.world.rebuildBoards(true);
    this.sim = new Simulation(s, this.sim.tolerance);
    this.selected = undefined;
    this.selectedHole = undefined;
    this.selectedBoard = undefined;
    this.burnedAt.clear();
    this.cancelPending();
    this.changed();
  }

  // ─── Сборка 3D ─────────────────────────────────────────────────────────

  private rebuild(): void {
    for (const v of this.views.values()) {
      this.world.componentLayer.remove(v.group);
      v.dispose();
    }
    for (const w of this.wireViews.values()) {
      this.world.wireLayer.remove(w.mesh);
      w.dispose();
    }
    for (const t of this.traceViews.values()) {
      this.world.traceLayer.remove(t.mesh);
      t.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.views.clear();
    this.wireViews.clear();
    this.traceViews.clear();
    for (const t of this.scene.traces ?? []) {
      const tv = buildTraceView(t.id, HOLE_BY_ID.get(t.a)!, HOLE_BY_ID.get(t.b)!);
      this.traceViews.set(t.id, tv);
      this.world.traceLayer.add(tv.mesh);
    }
    for (const c of this.scene.components) {
      const v = buildComponentView(c);
      this.views.set(c.id, v);
      this.world.componentLayer.add(v.group);
      if (this.sim.state(c.id).burned) v.update(this.visual(c));
    }
    for (const w of this.scene.wires) {
      const wv = buildWireView(w.id, this.endpointPos(w.a), this.endpointPos(w.b), w.color, isFlatWire(w));
      this.wireViews.set(w.id, wv);
      this.world.wireLayer.add(wv.mesh);
    }
    // Для попадания курсора до следующего кадра
    this.world.componentLayer.updateMatrixWorld(true);
    this.world.wireLayer.updateMatrixWorld(true);
    this.world.traceLayer.updateMatrixWorld(true);
    this.refreshMarks();
  }

  endpointPos(e: Endpoint): THREE.Vector3 {
    if ("hole" in e) {
      const h = HOLE_BY_ID.get(e.hole)!;
      return new THREE.Vector3(h.x, h.y, h.z);
    }
    return this.views.get(e.comp)!.pins[e.pin].clone();
  }

  private visual(c: Component) {
    const s = this.sim.state(c.id);
    return {
      brightness: c.type === "lamp" || c.type === "led" ? this.sim.overload(c) : 0,
      heat: s.heat,
      burned: s.burned,
      shorted: this.sim.isShorted(c),
      time: this.time,
      display:
        c.type === "psu"
          ? {
              volts: Math.abs(this.sim.branch(c.id).voltage),
              amps: Math.max(0, this.sim.branch(c.id).current),
              mode: this.sim.psuMode.get(c.id) ?? "CV",
              on: c.on,
            }
          : undefined,
    };
  }

  // ─── Кадр ──────────────────────────────────────────────────────────────

  /**
   * Шаг физики по реальным часам, отдельно от отрисовки: при медленном рендере
   * (слабый телефон, браузер без видеокарты) детали всё равно греются с нормальной скоростью.
   */
  tick(): void {
    const now = performance.now();
    const real = Math.min((now - this.lastTick) / 1000, 1);
    this.lastTick = now;
    const steps = Math.max(1, Math.ceil(real / 0.05));
    const dt = real / steps;
    for (let i = 0; i < steps; i++) {
      this.time += dt;
      for (const c of this.sim.step(dt)) this.onBurn(c);
    }
  }

  frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.tick();

    let anyShort = false;
    for (const c of this.scene.components) {
      const v = this.views.get(c.id)!;
      const vis = this.visual(c);
      v.update(vis);
      if (vis.shorted) anyShort = true;
      const threshold = heatThreshold(c);
      if (threshold) {
        const k = this.sim.overload(c);
        if (!vis.burned && k > threshold && Math.random() < Math.min(0.9, (k - threshold) * 0.6 + 0.15)) {
          this.world.emitSmoke(v.hotspot, 1);
        }
        const t = this.burnedAt.get(c.id);
        if (vis.burned && t !== undefined && this.time - t < 2.5 && Math.random() < 0.35) this.world.emitSmoke(v.hotspot, 1);
      }
    }
    if (anyShort) {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.12 + Math.random() * 0.25;
        for (const c of this.scene.components) {
          if (c.type === "battery" && this.sim.isShorted(c)) {
            this.world.emitSparks(this.views.get(c.id)!.pins[Math.random() < 0.5 ? 0 : 1], 6);
          }
        }
      }
    }

    this.updateDots(dt);
    this.world.stepParticles(dt);
    if (this.time - this.lastInspector > 0.2) {
      this.lastInspector = this.time;
      this.renderInspector();
    }
    this.world.render();
  }

  private updateDots(dt: number): void {
    if (!this.showCurrent) return;
    const items: { curve: THREE.Curve<THREE.Vector3>; phases: number[] }[] = [];
    for (const w of this.scene.wires) {
      const wv = this.wireViews.get(w.id);
      if (!wv) continue;
      const i = this.sim.branch(w.id).current;
      const a = Math.abs(i);
      if (a < 1e-6) continue;
      // Скорость растёт логарифмически: 1 мА → 2, 100 мА → 6,4, 1 А → 8,6 ед/с
      const speed = THREE.MathUtils.clamp(2 + 2.2 * Math.log10(a / 1e-3), 0.6, 14) * Math.sign(i);
      const phase = ((this.dotPhase.get(w.id) ?? 0) + (speed * dt) / wv.length + 1) % 1;
      this.dotPhase.set(w.id, phase);
      const n = Math.max(2, Math.floor(wv.length / 1.6));
      const phases: number[] = [];
      for (let k = 0; k < n; k++) phases.push((k / n + phase) % 1);
      items.push({ curve: wv.curve, phases });
    }
    for (const t of this.scene.traces ?? []) {
      const tv = this.traceViews.get(t.id);
      if (!tv) continue;
      const i = this.sim.branch(t.id).current;
      const a = Math.abs(i);
      if (a < 1e-6) continue;
      const speed = THREE.MathUtils.clamp(2 + 2.2 * Math.log10(a / 1e-3), 0.6, 14) * Math.sign(i);
      const phase = ((this.dotPhase.get(t.id) ?? 0) + (speed * dt) / tv.length + 1) % 1;
      this.dotPhase.set(t.id, phase);
      // На дорожках точки реже, чем на проводах: иначе они засвечивают медь
      const n = Math.max(1, Math.floor(tv.length / 3));
      const phases: number[] = [];
      for (let k = 0; k < n; k++) phases.push((k / n + phase) % 1);
      items.push({ curve: tv.curve, phases });
    }
    this.world.setDots(items);
  }

  private onBurn(c: Component): void {
    this.burnedAt.set(c.id, this.time);
    const v = this.views.get(c.id)!;
    this.world.emitSparks(v.hotspot, 18);
    this.world.emitSmoke(v.hotspot, 10);
    const [what, note] = burnMessage(c);
    this.toast(what, note);
  }

  toast(title: string, body: string): void {
    const el = document.createElement("div");
    el.className = "toast panel";
    el.innerHTML = `<b>${title}</b>${body}`;
    this.ui.toasts.appendChild(el);
    while (this.ui.toasts.children.length > 3) this.ui.toasts.firstChild!.remove();
    setTimeout(() => el.remove(), 7000);
  }

  // ─── Инструменты ───────────────────────────────────────────────────────

  setTool(tool: Tool): void {
    this.tool = tool;
    this.cancelPending();
    this.ghostRot = 0;
    for (const b of this.ui.tools.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    }
    if (tool !== "select") {
      this.selected = undefined;
      this.selectedHole = undefined;
      this.selectedBoard = undefined;
    }
    this.updateHint();
    this.inspectorHtml = "";
    this.renderInspector();
  }

  private cancelPending(): void {
    this.pendingHole = undefined;
    this.pendingPad = undefined;
    this.pendingEnd = undefined;
    this.clearGhost();
    this.refreshMarks();
    this.updateHint();
  }

  private clearGhost(): void {
    if (!this.ghost) return;
    this.world.overlay.remove(this.ghost);
    this.ghost.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.ghost = undefined;
  }

  private ghostMaterial = new THREE.MeshStandardMaterial({
    color: 0xe0955c,
    transparent: true,
    opacity: 0.55,
    emissive: new THREE.Color(0xb0612a),
    emissiveIntensity: 0.4,
    depthWrite: false,
  });

  private showGhost(obj: THREE.Object3D): void {
    this.clearGhost();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.ghostMaterial;
        m.castShadow = false;
      }
      if ((o as THREE.Light).isLight) (o as THREE.Light).intensity = 0;
      o.userData = {};
    });
    this.ghost = obj;
    this.world.overlay.add(obj);
  }

  private newComponent(tool: PlaceTool, placement: Component["placement"]): Component {
    switch (tool) {
      case "tht":
        return { id: this.nextId("resistor"), type: "resistor", variant: "tht", ohms: this.defaults.ohms, smdSize: this.defaults.smdSize, placement };
      case "smd":
        return { id: this.nextId("resistor"), type: "resistor", variant: "smd", ohms: this.defaults.ohms, smdSize: this.defaults.smdSize, placement };
      case "lamp":
        return { id: this.nextId("lamp"), type: "lamp", kind: this.defaults.lamp, placement };
      case "switch":
        return { id: this.nextId("switch"), type: "switch", closed: true, placement };
      case "battery":
        return { id: this.nextId("battery"), type: "battery", kind: this.defaults.battery, placement };
      case "cap": {
        const variant = this.defaults.capVariant;
        const uF = variant === "electrolytic" ? this.defaults.electrolyticUF : this.defaults.ceramicUF;
        return { id: this.nextId("capacitor"), type: "capacitor", variant, uF, placement };
      }
      case "diode":
        return { id: this.nextId("diode"), type: "diode", placement };
      case "led":
        return { id: this.nextId("led"), type: "led", color: this.defaults.led, placement };
      case "bjt":
        return { id: this.nextId("transistor"), type: "transistor", kind: this.defaults.transistor, placement };
      case "fet":
        return { id: this.nextId("mosfet"), type: "mosfet", kind: this.defaults.mosfet, placement };
      case "psu":
        return { id: this.nextId("psu"), type: "psu", volts: this.defaults.psuVolts, amps: this.defaults.psuAmps, on: true, placement };
    }
  }

  /**
   * Три соседних отверстия ряда для транзистора: начиная с данного и вправо
   * (у правого края платы — сдвиг влево). Только основное поле: в шине все выводы замкнулись бы.
   */
  private transistorHoles(h: Hole): string[] | undefined {
    if (h.kind === "rail") return undefined;
    // Три подряд вправо; если справа край платы — сдвигаемся влево
    for (const shift of [0, -1, -2]) {
      const holes = [0, 1, 2].map((k) => holeAt(h.boardId, h.x + shift + k, h.z));
      if (holes.every((x) => x && x.kind !== "rail")) return holes.map((x) => x!.id);
    }
    return undefined;
  }

  /**
   * Перевернуть полярную деталь: на плате выводы меняются отверстиями,
   * на столе провода перецепляются на другой вывод.
   */
  flip(id?: string): void {
    const c = id ? this.component(id) : undefined;
    if (!c || c.type === "battery" || c.type === "psu") return;
    if (c.placement.mode === "board") {
      // Для транзистора: К-Б-Э → Э-Б-К
      c.placement.holes = [...c.placement.holes].reverse();
    } else {
      const last = pinCount(c) - 1;
      for (const w of this.scene.wires) {
        for (const k of ["a", "b"] as const) {
          const e = w[k];
          if ("comp" in e && e.comp === c.id) w[k] = { comp: c.id, pin: (last - e.pin) as Pin };
        }
      }
    }
    this.changed();
  }

  private isPlaceTool(t: Tool): t is PlaceTool {
    return (PLACE_TOOLS as Tool[]).includes(t);
  }

  // ─── Ввод ──────────────────────────────────────────────────────────────

  private bindInput(): void {
    const el = this.world.renderer.domElement;
    el.addEventListener("pointermove", (e) => this.onMove(e));
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    el.addEventListener("pointerup", (e) => this.onUp(e));
    el.addEventListener("pointerleave", () => {
      this.hover = { overBoard: false };
      this.refreshMarks();
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).tagName === "SELECT") return;
      if (e.key === "Escape") {
        if (this.pendingHole || this.pendingEnd || this.pendingPad) this.cancelPending();
        else if (this.tool !== "select") this.setTool("select");
        else {
          this.selected = undefined;
          this.selectedHole = undefined;
          this.selectedBoard = undefined;
          this.inspectorHtml = "";
          this.refreshMarks();
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (this.selected) this.remove(this.selected);
        else if (this.selectedBoard) this.removeBoard(this.selectedBoard);
        else this.setTool("delete");
      } else if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") {
        this.rotate();
      } else if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") {
        this.flip(this.selected);
      } else if (TOOL_KEYS[e.key]) {
        this.setTool(TOOL_KEYS[e.key]);
      }
    });
    this.ui.tools.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
      if (b) this.setTool(b.dataset.tool as Tool);
    });
  }

  private rotate(): void {
    if (this.isPlaceTool(this.tool)) {
      this.ghostRot = (this.ghostRot + Math.PI / 2) % (Math.PI * 2);
      this.updateGhost();
      return;
    }
    const c = this.selected ? this.component(this.selected) : undefined;
    if (c && c.placement.mode === "free") {
      c.placement.rot = (c.placement.rot + Math.PI / 2) % (Math.PI * 2);
      this.changed();
    }
  }

  private computeHover(e: PointerEvent): Hover {
    const ndc = this.world.ndcFromEvent(e);
    const h: Hover = { overBoard: this.world.overBoard(ndc) };
    // Выводы свободных деталей ищем в экранных координатах: SMD 0402 меньше миллиметра.
    let best = 18;
    for (const c of this.scene.components) {
      if (c.placement.mode !== "free") continue;
      const v = this.views.get(c.id)!;
      v.pins.forEach((p, i) => {
        const s = this.world.toScreen(p);
        const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
        if (d < best) {
          best = d;
          h.pin = { comp: c.id, pin: i as Pin, pos: p };
        }
      });
    }
    const obj = this.world.pickObject(ndc);
    h.componentId = obj?.componentId;
    h.wireId = obj?.wireId;
    h.traceId = obj?.traceId;
    if (this.tool === "trace") {
      // Дорожку рисуем по площадкам: детали и провода не мешают
      h.hole = this.world.pickHole(ndc);
      return h;
    }
    if (!h.componentId && !h.wireId && !h.traceId) {
      h.boardId = this.world.pickBoard(ndc)?.boardId;
      h.hole = this.world.pickHole(ndc);
      if (!h.overBoard) h.table = this.world.pickTable(ndc);
    } else if (this.tool !== "select" && this.tool !== "delete") {
      // При установке и проводке детали не мешают целиться в отверстия
      h.hole = this.world.pickHole(ndc);
      if (!h.overBoard) h.table = this.world.pickTable(ndc);
    }
    return h;
  }

  private onMove(e: PointerEvent): void {
    if (this.boardDrag) {
      const d = this.boardDrag;
      const p = this.world.pickTablePlane(this.world.ndcFromEvent(e));
      const b = (this.scene.boards ?? []).find((x) => x.id === d.id);
      if (!p || !b) return;
      const x = Math.round(p.x + d.offset.x);
      const z = Math.round(p.z + d.offset.z);
      if (x === b.x && z === b.z) return;
      // На занятое место плата не едет: остаётся на последнем свободном
      if (this.boardProblem({ ...b, x, z })) return;
      b.x = x;
      b.z = z;
      d.moved = true;
      applyBoards(this.scene.boards ?? []);
      // Перестраиваем сцену не чаще раза за кадр
      if (!this.boardFrame) {
        this.boardFrame = requestAnimationFrame(() => {
          this.boardFrame = 0;
          this.world.rebuildBoards();
          this.rebuild();
        });
      }
      return;
    }
    if (this.drag) {
      const p = this.world.pickTable(this.world.ndcFromEvent(e));
      const c = this.component(this.drag.id);
      if (p && c && c.placement.mode === "free") {
        c.placement.x = p.x + this.drag.offset.x;
        c.placement.z = p.z + this.drag.offset.z;
        this.rebuild();
      }
      return;
    }
    this.hover = this.computeHover(e);
    const el = this.world.renderer.domElement;
    const interactive =
      (this.tool === "select" && (this.hover.componentId || this.hover.wireId || this.hover.traceId)) ||
      (this.tool === "delete" && (this.hover.componentId || this.hover.wireId || this.hover.traceId)) ||
      (this.tool === "trace" && this.hover.hole?.board === "pcb") ||
      (this.tool === "wire" && (this.hover.hole || this.hover.pin)) ||
      (this.isPlaceTool(this.tool) && (this.hover.hole || this.hover.table)) ||
      ((this.tool === "bb" || this.tool === "pcb") && this.hover.table) ||
      (this.tool === "delete" && this.hover.boardId);
    // Выбранную плату можно тащить
    const grab = this.tool === "select" && !interactive && this.hover.boardId !== undefined && this.hover.boardId === this.selectedBoard;
    el.style.cursor = grab ? "grab" : interactive ? "pointer" : "";
    this.refreshMarks();
    this.updateGhost();
  }

  private onDown(e: PointerEvent): void {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (this.tool !== "select" || e.button !== 0) return;
    const h = this.computeHover(e);
    const c = h.componentId ? this.component(h.componentId) : undefined;
    if (c && c.placement.mode === "free") {
      const p = this.world.pickTable(this.world.ndcFromEvent(e));
      if (p) {
        this.drag = { id: c.id, offset: new THREE.Vector3(c.placement.x - p.x, 0, c.placement.z - p.z) };
        this.world.controls.enabled = false;
      }
      return;
    }
    // Выбранную плату можно тащить; невыбранная не мешает вращать камеру
    const b = h.boardId ? boardById(h.boardId) : undefined;
    if (b && b.id === this.selectedBoard) {
      const p = this.world.pickTablePlane(this.world.ndcFromEvent(e));
      if (p) {
        this.boardDrag = { id: b.id, offset: new THREE.Vector3(b.x - p.x, 0, b.z - p.z), moved: false };
        this.world.controls.enabled = false;
      }
    }
  }

  private onUp(e: PointerEvent): void {
    const moved = this.down ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) : 99;
    const wasDrag = this.drag;
    if (this.boardDrag) {
      const d = this.boardDrag;
      this.boardDrag = undefined;
      this.world.controls.enabled = true;
      if (d.moved) {
        cancelAnimationFrame(this.boardFrame);
        this.boardFrame = 0;
        this.boardsChanged();
        return;
      }
    }
    if (this.drag) {
      this.drag = undefined;
      this.world.controls.enabled = true;
      if (moved > 4) {
        this.changed();
        return;
      }
    }
    if (moved > 5 || e.button !== 0) return; // это было вращение камеры
    this.hover = this.computeHover(e);
    this.click(wasDrag?.id);
  }

  private click(pressedId?: string): void {
    const h = this.hover;
    switch (this.tool) {
      case "select": {
        const id = pressedId ?? h.componentId;
        if (id) {
          const c = this.component(id)!;
          if (c.type === "switch" && this.selected === id) {
            c.closed = !c.closed;
            this.changed();
          }
          this.selected = id;
        } else if (h.wireId || h.traceId) {
          this.selected = h.wireId ?? h.traceId;
        } else {
          this.selected = undefined;
        }
        const onBoard = !id && !h.wireId && !h.traceId;
        this.selectedHole = onBoard ? h.hole : undefined;
        this.selectedBoard = onBoard ? (h.hole?.boardId ?? h.boardId) : undefined;
        this.refreshMarks();
        this.inspectorHtml = "";
        this.renderInspector();
        return;
      }
      case "delete":
        if (h.componentId) this.remove(h.componentId);
        else if (h.wireId) this.remove(h.wireId);
        else if (h.traceId) this.remove(h.traceId);
        else if (h.boardId) this.removeBoard(h.boardId);
        return;
      case "wire":
        return this.clickWire();
      case "trace":
        return this.clickTrace();
      case "bb":
      case "pcb":
        return this.clickBoard(this.tool === "bb" ? "breadboard" : "pcb");
      default:
        return this.clickPlace(this.tool);
    }
  }

  private clickWire(): void {
    const h = this.hover;
    let end: Endpoint | undefined;
    if (h.pin) end = { comp: h.pin.comp, pin: h.pin.pin };
    else if (h.hole) {
      const owner = this.occupied().get(h.hole.id);
      if (owner) return this.setHint(`Отверстие <b>${holeLabel(h.hole.id)}</b> занято (${owner}). Возьмите соседнее в той же полосе — они соединены.`);
      end = { hole: h.hole.id };
    }
    if (!end) return;
    if (!this.pendingEnd) {
      this.pendingEnd = end;
      this.refreshMarks();
      this.updateHint();
      return;
    }
    if (sameEndpoint(this.pendingEnd, end)) return this.cancelPending();
    this.scene.wires.push({ id: this.nextWireId(), a: this.pendingEnd, b: end, color: this.pickWireColor(this.pendingEnd, end), shape: this.defaults.wireShape });
    this.pendingEnd = undefined;
    this.clearGhost();
    this.changed();
    this.updateHint();
  }

  /**
   * Дорожка рисуется цепочкой: щелчок по площадке — начало, каждый следующий — новый отрезок
   * от предыдущей площадки. Щелчок по той же площадке или Esc — конец.
   */
  private clickTrace(): void {
    const h = this.hover.hole;
    if (!h) return;
    if (h.board !== "pcb") return this.setHint("Дорожки рисуются только на печатной плате. На макетке соединяйте проводами.");
    if (!this.pendingPad) {
      this.pendingPad = h;
      this.refreshMarks();
      this.updateHint();
      return;
    }
    if (h.id === this.pendingPad.id) return this.cancelPending();
    if (h.boardId !== this.pendingPad.boardId) return this.setHint("Дорожка не переходит с платы на плату. Между платами — провод.");
    const traces = (this.scene.traces ??= []);
    // Дорожка, проходящая по площадкам, соединяется с каждой из них — делим на отрезки
    const pads = padsAlong(this.pendingPad.id, h.id);
    for (let i = 0; i < pads.length - 1; i++) {
      const [a, b] = [pads[i], pads[i + 1]];
      if (!traces.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a))) {
        traces.push({ id: this.nextTraceId(), a, b });
      }
    }
    this.pendingPad = h;
    this.clearGhost();
    this.changed();
    this.updateHint();
  }

  /** Положить новую плату на свободное место стола. */
  private clickBoard(kind: BoardSpec["kind"]): void {
    const at = this.hover.table;
    if (!at) return this.setHint(this.hover.overBoard ? "Здесь уже плата. Нажмите на свободное место на столе." : "");
    const b = this.newBoard(kind, at);
    const problem = this.boardProblem(b);
    if (problem) return this.setHint(`${problem} Выберите место посвободнее.`);
    (this.scene.boards ??= []).push(b);
    this.clearGhost();
    this.boardsChanged();
    this.toast(`${boardName(b)[0].toUpperCase()}${boardName(b).slice(1)} на столе`, "Чтобы передвинуть, выберите её («Выбор», 1) и тащите мышью. Убрать — инструментом «Удалить» или в панели платы.");
  }

  private nextTraceId(): string {
    let n = 1;
    for (const t of this.scene.traces ?? []) {
      const m = t.id.match(/^T(\d+)$/);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    return `T${n}`;
  }

  /** Все площадки, соединённые с данной дорожками (обход графа); для макетки — отверстия полосы. */
  private netHoles(hole: Hole): Hole[] {
    if (hole.board !== "pcb") return holesOnNode(hole.node);
    const seen = new Set([hole.id]);
    const queue = [hole.id];
    while (queue.length) {
      const id = queue.pop()!;
      for (const t of this.scene.traces ?? []) {
        const other = t.a === id ? t.b : t.b === id ? t.a : undefined;
        if (other && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    return [...seen].map((id) => HOLE_BY_ID.get(id)!);
  }

  /** Выбранный цвет или «авто»: красный к плюсу батареи, чёрный к минусу, остальные по кругу. */
  private pickWireColor(a: Endpoint, b: Endpoint): string {
    if (this.defaults.wireColor !== "auto") return this.defaults.wireColor;
    for (const e of [a, b]) {
      const t = "comp" in e ? this.component(e.comp)?.type : undefined;
      if ("comp" in e && (t === "battery" || t === "psu")) return e.pin === 1 ? "#c8261f" : "#1b1d20";
      if ("hole" in e) {
        const pol = HOLE_BY_ID.get(e.hole)!.polarity;
        if (pol) return pol === "+" ? "#c8261f" : "#1b1d20";
      }
    }
    return WIRE_COLORS[this.wireColor++ % WIRE_COLORS.length];
  }

  private clickPlace(tool: PlaceTool): void {
    const h = this.hover;
    const boardOk = canGoOnBoard(TOOL_TYPE[tool], tool === "smd" ? "smd" : "tht");

    if ((tool === "bjt" || tool === "fet") && h.hole) {
      const holes = this.transistorHoles(h.hole);
      if (!holes) return this.setHint("Транзистор ставится в основное поле: в шине все три вывода оказались бы замкнуты.");
      const occ = this.occupied();
      const busy = holes.find((id) => occ.has(id));
      if (busy) return this.setHint(`Отверстие <b>${holeLabel(busy)}</b> занято (${occ.get(busy)}). Нужны три свободных отверстия подряд.`);
      this.scene.components.push(this.newComponent(tool, { mode: "board", holes }));
      this.clearGhost();
      this.changed();
      return;
    }
    if (h.hole && boardOk) {
      const owner = this.occupied().get(h.hole.id);
      if (owner) return this.setHint(`Отверстие <b>${holeLabel(h.hole.id)}</b> занято (${owner}).`);
      if (!this.pendingHole) {
        this.pendingHole = h.hole;
        this.refreshMarks();
        this.updateHint();
        return;
      }
      if (this.pendingHole.id === h.hole.id) return this.cancelPending();
      if (this.pendingHole.boardId !== h.hole.boardId) return this.setHint("Выводы детали должны быть на одной плате. Между платами — провод.");
      const span = Math.hypot(this.pendingHole.x - h.hole.x, this.pendingHole.z - h.hole.z);
      if (span > MAX_LEAD_SPAN) return this.setHint(`Слишком далеко: выводы дотянутся максимум на ${MAX_LEAD_SPAN} отверстий. Для дальних точек используйте провод.`);
      const c = this.newComponent(tool, { mode: "board", holes: [this.pendingHole.id, h.hole.id] });
      this.scene.components.push(c);
      this.pendingHole = undefined;
      this.clearGhost();
      this.changed();
      this.updateHint();
      return;
    }
    if (h.overBoard && !boardOk) {
      return this.setHint(
        tool === "smd"
          ? "У SMD-резистора нет ножек — в макетку он не вставляется. Положите его на стол рядом и припаяйте провода к торцам."
          : tool === "psu"
            ? "Блок питания ставится на стол. Подключите клеммы к плате проводами."
            : "Батарея ставится на стол. Подключите её к шинам платы проводами.",
      );
    }
    if (this.pendingHole) return; // ждём второе отверстие
    if (h.table) {
      const c = this.newComponent(tool, { mode: "free", x: h.table.x, z: h.table.z, rot: this.ghostRot });
      this.scene.components.push(c);
      this.clearGhost();
      this.changed();
    }
  }

  remove(id: string): void {
    const c = this.component(id);
    if (c) {
      this.scene.components = this.scene.components.filter((x) => x.id !== id);
      this.scene.wires = this.scene.wires.filter((w) => !["a", "b"].some((k) => {
        const e = w[k as "a" | "b"];
        return "comp" in e && e.comp === id;
      }));
    } else {
      this.scene.wires = this.scene.wires.filter((w) => w.id !== id);
      this.scene.traces = (this.scene.traces ?? []).filter((t) => t.id !== id);
    }
    this.sim.scene = this.scene;
    if (this.selected === id) this.selected = undefined;
    this.changed();
  }

  // ─── Подсветка и «призраки» ────────────────────────────────────────────

  private refreshMarks(): void {
    const marks = new Map<string, THREE.ColorRepresentation>();
    const strip = (hole: Hole, color: string, own: string) => {
      for (const x of this.netHoles(hole)) marks.set(x.id, color);
      marks.set(hole.id, own);
    };
    const h = this.hover;
    if (h.hole && !h.componentId) strip(h.hole, "#f0c9a8", "#b0612a");
    else if (h.hole && this.tool !== "select" && this.tool !== "delete") strip(h.hole, "#f0c9a8", "#b0612a");
    if (this.pendingHole) strip(this.pendingHole, "#f0c9a8", "#b0612a");
    if (this.pendingPad) strip(this.pendingPad, "#f0c9a8", "#b0612a");
    if (this.selectedHole) strip(this.selectedHole, "#f0c9a8", "#b0612a");
    if (this.pendingEnd && "hole" in this.pendingEnd) strip(HOLE_BY_ID.get(this.pendingEnd.hole)!, "#f0c9a8", "#b0612a");
    // Выделенная деталь на плате: её отверстия
    const sel = this.selected ? this.component(this.selected) : undefined;
    if (sel?.placement.mode === "board") for (const id of sel.placement.holes) marks.set(id, "#b0612a");
    this.world.markHoles(marks);
    this.world.highlightBoard(this.tool === "select" ? this.selectedBoard : undefined);
  }

  private updateGhost(): void {
    const h = this.hover;
    if (this.tool === "wire" && this.pendingEnd) {
      const target = h.pin?.pos ?? (h.hole ? new THREE.Vector3(h.hole.x, h.hole.y, h.hole.z) : h.table);
      if (!target) return this.clearGhost();
      const a = this.endpointPos(this.pendingEnd);
      const flat = !!h.hole && !h.pin && isFlatWire({ a: this.pendingEnd, b: { hole: h.hole.id }, shape: this.defaults.wireShape });
      return this.showGhost(buildWireView("ghost", a, target, "#ffffff", flat).mesh);
    }
    if (this.tool === "trace" && this.pendingPad && h.hole?.boardId === this.pendingPad.boardId && h.hole.id !== this.pendingPad.id) {
      return this.showGhost(buildTraceView("ghost", this.pendingPad, h.hole).mesh);
    }
    if ((this.tool === "bb" || this.tool === "pcb") && h.table) {
      const b = this.newBoard(this.tool === "bb" ? "breadboard" : "pcb", h.table);
      if (this.boardProblem(b)) return this.clearGhost();
      const size = boardSize(b);
      const box = new THREE.Mesh(new THREE.BoxGeometry(size.width, size.height, size.depth));
      box.position.set(b.x, size.height / 2, b.z);
      return this.showGhost(box);
    }
    if (!this.isPlaceTool(this.tool)) return this.clearGhost();
    const tool = this.tool;
    if ((tool === "bjt" || tool === "fet") && h.hole) {
      const holes = this.transistorHoles(h.hole);
      return holes ? this.showGhost(buildComponentView(this.newComponent(tool, { mode: "board", holes })).group) : this.clearGhost();
    }
    if (this.pendingHole && h.hole && h.hole.id !== this.pendingHole.id) {
      const span = Math.hypot(this.pendingHole.x - h.hole.x, this.pendingHole.z - h.hole.z);
      if (span > MAX_LEAD_SPAN) return this.clearGhost();
      const c = this.newComponent(tool, { mode: "board", holes: [this.pendingHole.id, h.hole.id] });
      return this.showGhost(buildComponentView(c).group);
    }
    if (!this.pendingHole && h.table && !h.overBoard) {
      const c = this.newComponent(tool, { mode: "free", x: h.table.x, z: h.table.z, rot: this.ghostRot });
      return this.showGhost(buildComponentView(c).group);
    }
    this.clearGhost();
  }

  // ─── Подсказки ─────────────────────────────────────────────────────────

  private hintTimer?: ReturnType<typeof setTimeout>;

  /** Сообщение об ошибке: показывается 4 с, потом возвращается обычная подсказка. */
  private setHint(html: string): void {
    this.showHint(html);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.updateHint(), 4000);
  }

  private showHint(html: string): void {
    this.ui.hint.innerHTML = html;
    this.ui.hint.hidden = html === "";
  }

  /**
   * Подсказка видна только во время действия: выбран инструмент установки или провода.
   * В режиме выбора и удаления её нет — справка в панели справа.
   */
  updateHint(): void {
    clearTimeout(this.hintTimer);
    const t = this.tool;
    let s = "";
    if (t === "wire") s = this.pendingEnd ? "Второй конец: <b>отверстие</b> или <b>вывод</b> детали. Esc — отмена." : "Первый конец провода: <b>отверстие</b> или <b>вывод</b> детали на столе.";
    else if (t === "smd") s = "SMD кладётся <b>на стол</b>, провода паяются к торцам. R — повернуть.";
    else if (t === "battery") s = "Нажмите на стол рядом с платой. R — повернуть.";
    else if (t === "bb") s = "Нажмите на свободное место на столе — туда ляжет макетка на 400 точек.";
    else if (t === "pcb") s = "Нажмите на свободное место на столе — туда ляжет печатная плата. Размер — в панели справа.";
    else if (t === "psu") s = "Нажмите на стол рядом с платой. Напряжение и ограничение тока — в панели справа.";
    else if (t === "trace") s = this.pendingPad
      ? `Дорожка от <b>${holeLabel(this.pendingPad.id)}</b>: следующая площадка. Щелчок по той же или Esc — закончить.`
      : "Нажмите на <b>площадку</b> печатной платы, затем на следующую — между ними ляжет медная дорожка.";
    else if (t === "bjt") s = "Нажмите на отверстие — транзистор займёт его и два соседних справа: <b>коллектор, база, эмиттер</b>. F — перевернуть.";
    else if (t === "fet") s = `Нажмите на отверстие — MOSFET займёт его и два соседних справа: <b>${mosfetPinNames(this.defaults.mosfet)}</b>. F — перевернуть.`;
    else if (t !== "select" && t !== "delete") {
      // Для полярных деталей первым ставится анод / плюс
      const polar = t === "diode" || t === "led" || (t === "cap" && this.defaults.capVariant === "electrolytic");
      const first = t === "cap" ? "плюса (+)" : "анода (+)";
      const second = t === "cap" ? "минуса (−)" : "катода (−)";
      s = this.pendingHole
        ? `${polar ? (t === "cap" ? "Плюс" : "Анод") : "Первый вывод"} в <b>${holeLabel(this.pendingHole.id)}</b>, теперь отверстие для ${polar ? second : "второго"}. Esc — отмена.`
        : polar
          ? `Сначала отверстие для <b>${first}</b>, потом для <b>${second}</b>. Не той стороной — выберите деталь и нажмите F.`
          : "Нажмите на <b>два отверстия</b> — деталь встанет между ними. Или на <b>стол</b>, чтобы положить рядом.";
    }
    this.showHint(s);
  }

  // ─── Инспектор ─────────────────────────────────────────────────────────

  renderInspector(): void {
    const target = this.selected;
    let html: string;
    let key: string;
    if (target && this.component(target)) {
      [key, html] = this.componentPanel(this.component(target)!, true);
    } else if (target && (this.scene.traces ?? []).some((t) => t.id === target)) {
      [key, html] = this.tracePanel(target);
    } else if (target && this.scene.wires.some((w) => w.id === target)) {
      [key, html] = this.wirePanel(target);
    } else if (this.selectedHole && this.tool === "select") {
      [key, html] = this.holePanel(this.selectedHole);
    } else if (this.selectedBoard && boardById(this.selectedBoard) && this.tool === "select") {
      [key, html] = this.boardPanel(boardById(this.selectedBoard)!);
    } else if (this.tool === "bb" || this.tool === "pcb") {
      [key, html] = this.boardToolPanel(this.tool === "bb" ? "breadboard" : "pcb");
    } else if (this.isPlaceTool(this.tool)) {
      [key, html] = this.newPartPanel(this.tool);
    } else if (this.tool === "wire") {
      [key, html] = this.wireToolPanel();
    } else if (this.tool === "trace") {
      [key, html] = this.traceToolPanel();
    } else {
      [key, html] = this.overviewPanel();
    }
    // На узком экране общий список занимал бы полэкрана — показываем панель только по делу
    this.ui.inspector.hidden = key === "o" && window.innerWidth <= 760;
    // Не пересоздаём разметку, пока в этой же панели открыт выпадающий список
    const focused = document.activeElement;
    if ((focused instanceof HTMLSelectElement || focused instanceof HTMLInputElement) && this.ui.inspector.contains(focused) && key === this.inspectorKey) return;
    if (key === this.inspectorKey && html === this.inspectorHtml) return;
    this.inspectorKey = key;
    this.inspectorHtml = html;
    this.ui.inspector.innerHTML = html;
    this.bindInspector();
  }

  private readout(u: number, i: number, p: number, third: [string, string] = ["P", formatSI(p, "Вт")]): string {
    return `<dl class="readout">
      <div><dt>U</dt><dd>${formatSI(u, "В")}</dd></div>
      <div><dt>I</dt><dd>${formatSI(i, "А")}</dd></div>
      <div><dt>${third[0]}</dt><dd>${third[1]}</dd></div>
    </dl>`;
  }

  private mosfetReadout(c: Mosfet): string {
    const f = this.sim.mosfet(c);
    return `<dl class="readout">
      <div><dt>U<sub>ЗИ</sub></dt><dd>${formatSI(f.vgs, "В")}</dd></div>
      <div><dt>I<sub>С</sub></dt><dd>${formatSI(this.sim.current(c), "А")}</dd></div>
      <div><dt>U<sub>СИ</sub></dt><dd>${formatSI(f.vds, "В")}</dd></div>
    </dl>`;
  }

  private transistorReadout(c: Transistor): string {
    const t = this.sim.transistor(c);
    return `<dl class="readout">
      <div><dt>I<sub>Б</sub></dt><dd>${formatSI(t.ib, "А")}</dd></div>
      <div><dt>I<sub>К</sub></dt><dd>${formatSI(t.ic, "А")}</dd></div>
      <div><dt>U<sub>КЭ</sub></dt><dd>${formatSI(t.vce, "В")}</dd></div>
    </dl>`;
  }

  private statusPill(c: Component): string {
    const s = this.sim.state(c.id);
    if (s.burned) return `<span class="pill bad">${c.type === "lamp" ? "ПЕРЕГОРЕЛА" : c.type === "capacitor" ? "ВЗДУЛСЯ" : "СГОРЕЛ"}</span>`;
    if (this.sim.isShorted(c)) return `<span class="pill bad">КОРОТКОЕ ЗАМЫКАНИЕ</span>`;
    if (c.type === "capacitor" && this.sim.isReversed(c)) return `<span class="pill bad">ОБРАТНАЯ ПОЛЯРНОСТЬ</span>`;
    if ((c.type === "diode" || c.type === "led") && this.sim.isReversed(c)) return `<span class="pill warn">ОБРАТНОЕ ВКЛЮЧЕНИЕ — ТОК НЕ ИДЁТ</span>`;
    const k = this.sim.overload(c);
    const t = heatThreshold(c);
    if (t && k > t) return `<span class="pill bad">ПЕРЕГРУЗКА ×${k.toFixed(1).replace(".", ",")}</span>`;
    if (t && k > t * 0.7) return `<span class="pill warn">${c.type === "lamp" && k <= 1.05 ? "ПОЛНЫЙ НАКАЛ" : "ГРЕЕТСЯ"}</span>`;
    if (c.type === "switch") return c.closed ? `<span class="pill ok">ЗАМКНУТ</span>` : `<span class="pill warn">РАЗОМКНУТ</span>`;
    if (c.type === "psu") {
      if (!c.on) return `<span class="pill warn">ВЫХОД ВЫКЛЮЧЕН</span>`;
      return this.sim.psuMode.get(c.id) === "CC"
        ? `<span class="pill warn">CC — ОГРАНИЧЕНИЕ ТОКА</span>`
        : `<span class="pill ok">CV — ДЕРЖИТ НАПРЯЖЕНИЕ</span>`;
    }
    if (c.type === "mosfet") {
      const mode = this.sim.mosfet(c).mode;
      if (mode === "диод") return `<span class="pill warn">ТОК ЧЕРЕЗ ПАРАЗИТНЫЙ ДИОД</span>`;
      if (mode === "закрыт") return `<span class="pill warn">ЗАКРЫТ</span>`;
      if (mode === "насыщение") return `<span class="pill ok">НАСЫЩЕНИЕ — ТОК ЗАДАЁТ ЗАТВОР</span>`;
      return `<span class="pill ok">ОТКРЫТ</span>`;
    }
    if (c.type === "transistor") {
      const mode = this.sim.transistor(c).mode;
      if (mode === "инверсный") return `<span class="pill bad">К И Э ПЕРЕПУТАНЫ — ИНВЕРСНЫЙ РЕЖИМ</span>`;
      if (mode === "отсечка") return `<span class="pill warn">ЗАКРЫТ (ОТСЕЧКА)</span>`;
      if (mode === "насыщение") return `<span class="pill ok">ОТКРЫТ (НАСЫЩЕНИЕ)</span>`;
      return `<span class="pill ok">УСИЛЕНИЕ</span>`;
    }
    if (c.type === "led") return this.sim.current(c) > 0.0005 ? `<span class="pill ok">ГОРИТ</span>` : `<span class="pill warn">НЕ ГОРИТ</span>`;
    if (c.type === "capacitor") {
      const v = this.sim.voltage(c);
      const i = this.sim.current(c);
      if (Math.abs(i) < 1e-5) return Math.abs(v) > 0.05 ? `<span class="pill ok">ЗАРЯЖЕН</span>` : `<span class="pill ok">РАЗРЯЖЕН</span>`;
      return i * v > 0 || Math.abs(v) < 0.05 ? `<span class="pill ok">ЗАРЯЖАЕТСЯ</span>` : `<span class="pill warn">РАЗРЯЖАЕТСЯ</span>`;
    }
    return `<span class="pill ok">НОРМА</span>`;
  }

  private powerMeter(c: Component): string {
    const load = this.sim.load(c);
    if (!load) return "";
    const k = load.ratio;
    const t = heatThreshold(c);
    const cls = k > t ? "bad" : k > t * 0.7 && c.type !== "lamp" && c.type !== "led" ? "warn" : "";
    const what = load.what[0].toUpperCase() + load.what.slice(1);
    return `<div class="kv"><span>${what} / предел ${load.limit}</span><span>${Math.round(k * 100)} %</span></div>
      <div class="meter ${cls}"><i style="width:${Math.min(100, k * 100)}%"></i></div>`;
  }

  private componentPanel(c: Component, pinned: boolean): [string, string] {
    const s = this.sim.state(c.id);
    const polar = isPolar(c) && c.type !== "battery" && c.type !== "psu";
    const pinName = c.type === "capacitor" ? ["+", "−"] : ["анод", "катод"];
    const where =
      c.type === "mosfet"
        ? c.placement.mode === "board"
          ? MOSFETS[c.kind].pins.map((r, i) => `${ROLE_RU[r]} ${holeLabel((c.placement as { holes: string[] }).holes[i])}`).join(", ")
          : "на столе, на проводах"
        : c.type === "transistor"
        ? c.placement.mode === "board"
          ? `К ${holeLabel(c.placement.holes[0])}, Б ${holeLabel(c.placement.holes[1])}, Э ${holeLabel(c.placement.holes[2])}`
          : "на столе, на проводах"
        : c.placement.mode === "board"
        ? polar
          ? `${pinName[0]} ${holeLabel(c.placement.holes[0])}, ${pinName[1]} ${holeLabel(c.placement.holes[1])}`
          : c.placement.holes.map(holeLabel).join(" ↔ ")
        : "на столе, на проводах";
    let title = "";
    let body = "";
    let editor = "";
    switch (c.type) {
      case "resistor": {
        if (c.variant === "smd") {
          const sz = SMD_SIZES[c.smdSize];
          title = `SMD-резистор ${formatOhms(c.ohms)}`;
          body = `<div class="smd-chip">${smdCode(c.ohms)}</div>
            <p class="sub">Корпус ${c.smdSize}: ${String(sz.lengthMm).replace(".", ",")} × ${String(sz.widthMm).replace(".", ",")} мм, до ${formatSI(sz.ratedW, "Вт")}. Код ${smdCode(c.ohms)} — ${smdExplain(c.ohms)}.</p>`;
          editor = this.ohmsSelect(c.ohms) + this.smdSelect(c.smdSize);
        } else {
          title = `Резистор ${formatOhms(c.ohms)}`;
          const bands = colorBands(c.ohms);
          body = `<div class="bands"><span class="body">${bands.map((x) => `<i style="background:${x.hex}" title="${x.name}"></i>`).join("")}</span></div>
            <p class="sub">Выводной, ${String(THT_RESISTOR.lengthMm).replace(".", ",")} × ${String(THT_RESISTOR.diameterMm).replace(".", ",")} мм, до ${formatSI(THT_RESISTOR.ratedW, "Вт")}. Полосы: ${bands.map((x) => x.name).join(", ")}.</p>`;
          editor = this.ohmsSelect(c.ohms);
        }
        break;
      }
      case "lamp":
        title = `Лампа ${LAMPS[c.kind].label}`;
        body = `<p class="sub">Сопротивление нити ${formatOhms(lampResistance(c))} (в горячем состоянии, считается постоянным).</p>`;
        editor = this.selectField("lamp", "Лампа", Object.entries(LAMPS).map(([k, v]) => [k, v.label]), c.kind);
        break;
      case "switch":
        title = "Тумблер";
        body = `<p class="sub">${c.closed ? "Контакты замкнуты." : "Контакты разомкнуты — ток не идёт."}</p>`;
        editor = `<div class="row"><button class="btn inline" data-act="toggle" id="btn-toggle">${c.closed ? "Разомкнуть" : "Замкнуть"}</button></div>`;
        break;
      case "battery": {
        const bat = BATTERIES[c.kind];
        title = `Батарея ${bat.label}`;
        body = `<p class="sub">ЭДС ${formatSI(bat.emf, "В")}, внутреннее сопротивление ${formatOhms(bat.rInt)}. Ток короткого замыкания ≈ ${formatSI(bat.emf / bat.rInt, "А")}. Красный провод — плюс.</p>`;
        editor = this.selectField("battery", "Батарея", Object.entries(BATTERIES).map(([k, v]) => [k, v.label]), c.kind);
        break;
      }
      case "capacitor": {
        const v = this.sim.voltage(c);
        if (c.variant === "electrolytic") {
          title = `Конденсатор ${formatFarads(c.uF)}, ${ELECTROLYTIC_RATED_V} В`;
          body = `<p class="sub">Электролитический, <b>полярный</b>: на плюсе должен быть бо́льший потенциал. Полоса с «−» на корпусе — со стороны минуса. Заряд хранится, даже если отключить батарею.</p>`;
          editor = this.selectField("uF", "Ёмкость", ELECTROLYTICS.map((e) => [String(e.uF), formatFarads(e.uF)]), String(c.uF));
        } else {
          const code = CERAMICS.find((x) => x.uF === c.uF)?.code ?? "";
          title = `Конденсатор ${formatFarads(c.uF)}`;
          body = `<p class="sub">Керамический, неполярный, до ${CERAMIC_RATED_V} В. Код <b>${code}</b>: ${code.slice(0, 2)} × 10${superscript(Number(code[2]))} пФ.</p>`;
          editor = this.selectField("uF", "Ёмкость", CERAMICS.map((e) => [String(e.uF), `${formatFarads(e.uF)} (${e.code})`]), String(c.uF));
        }
        if (Math.abs(v) > 0.05) {
          editor += `<div class="row"><button class="btn inline" data-act="discharge" id="btn-discharge">Разрядить</button></div>`;
        }
        break;
      }
      case "diode":
        title = `Диод ${DIODE_1N4007.label}`;
        body = `<p class="sub">Пропускает ток только от анода к катоду, падение ≈ 0,6–0,8 В. Кольцо на корпусе — катод. До ${formatSI(DIODE_1N4007.maxA, "А")}.</p>`;
        break;
      case "psu": {
        title = "Лабораторный блок питания";
        body = `<div class="field"><label for="f-psuV">Напряжение: <b>${formatSI(c.volts, "В")}</b></label>
            <input type="range" id="f-psuV" data-field="psuV" min="0" max="${PSU_LIMITS.maxV}" step="0.1" value="${c.volts}" /></div>
          <div class="field"><label for="f-psuA">Ограничение тока: <b>${formatSI(c.amps, "А")}</b></label>
            <input type="range" id="f-psuA" data-field="psuA" min="0.01" max="${PSU_LIMITS.maxA}" step="0.01" value="${c.amps}" /></div>
          <div class="row"><button class="btn inline" data-act="psuToggle" id="btn-psu">${c.on ? "Выключить выход" : "Включить выход"}</button></div>
          <p class="sub">Держит заданное напряжение (CV), пока нагрузка берёт меньше тока, чем ограничение. Если больше — держит ток (CC), а напряжение само падает. Поэтому короткое замыкание ему не страшно, а светодиод можно питать без резистора, выставив 20 мА.</p>`;
        break;
      }
      case "mosfet": {
        const spec = MOSFETS[c.kind];
        const f = this.sim.mosfet(c);
        const n = spec.channel === "n";
        const rds = f.mode === "открыт" && Math.abs(f.id) > 1e-6 ? f.vds / f.id : undefined;
        title = `MOSFET ${spec.label} (${n ? "N" : "P"}-канал)`;
        body = `<div class="kv"><span>Ток затвора</span><span>0 А</span></div>
          <div class="kv"><span>Порог U<sub>пор</sub></span><span>${n ? "" : "−"}${String(spec.vth).replace(".", ",")} В</span></div>
          ${rds !== undefined ? `<div class="kv"><span>Сопротивление канала</span><span>${formatOhms(rds)}</span></div>` : ""}
          <div class="kv"><span>Мощность</span><span>${formatSI(this.sim.power(c), "Вт")}</span></div>
          <p class="sub">Управляется <b>напряжением</b> затвор–исток, ток через затвор не идёт. ${
            n ? "N-канал открывается, когда затвор выше истока больше чем на порог; исток — к минусу." : "P-канал открывается, когда затвор ниже истока больше чем на порог; исток — к плюсу."
          } Открытый канал — это малое сопротивление (${spec.rdsNote}). «Насыщение» у полевого транзистора — наоборот, приоткрытый режим: ток задаёт затвор, а не нагрузка. Затвор без стягивающего резистора «помнит» заряд. Внутри есть паразитный диод исток → сток. Выводы слева направо: ${mosfetPinNames(c.kind)}.</p>`;
        editor = this.selectField("fet", "Тип", Object.entries(MOSFETS).map(([k, v]) => [k, `${v.label} (${v.channel.toUpperCase()}-канал, ${v.pkg})`]), c.kind);
        break;
      }
      case "transistor": {
        const spec = TRANSISTORS[c.kind];
        const t = this.sim.transistor(c);
        const beta = t.ib > 1e-9 ? t.ic / t.ib : 0;
        title = `Транзистор ${spec.label} (${spec.polarity === "npn" ? "n-p-n" : "p-n-p"})`;
        body = `<div class="kv"><span>U<sub>бэ</sub></span><span>${formatSI(t.vbe, "В")}</span></div>
          <div class="kv"><span>I<sub>к</sub> / I<sub>б</sub></span><span>${beta ? Math.round(beta) : "—"}</span></div>
          <div class="kv"><span>Мощность</span><span>${formatSI(this.sim.power(c), "Вт")}</span></div>
          <p class="sub">Малый ток базы управляет большим током коллектора: в режиме усиления I<sub>к</sub> ≈ β·I<sub>б</sub>, β ≈ ${spec.betaF}. В насыщении ток коллектора ограничивает уже нагрузка, и отношение меньше β. ${
            spec.polarity === "npn"
              ? "n-p-n открывается, когда база выше эмиттера на ≈ 0,6 В."
              : "p-n-p открывается, когда база ниже эмиттера на ≈ 0,6 В; эмиттер — к плюсу."
          } Выводы слева направо (маркировкой к себе): К, Б, Э.</p>`;
        editor = this.selectField("bjt", "Тип", Object.entries(TRANSISTORS).map(([k, v]) => [k, `${v.label} (${v.polarity === "npn" ? "n-p-n" : "p-n-p"})`]), c.kind);
        break;
      }
      case "led": {
        const spec = LEDS[c.color];
        const vf = String(spec.vf).replace(".", ",");
        title = `Светодиод ${spec.label}`;
        body = `<p class="sub">Прямое падение ≈ ${vf} В, номинальный ток 20 мА. <b>Без резистора сгорает.</b> Длинная ножка — анод (+). Резистор: R = (U<sub>бат</sub> − ${vf}) / 0,02.</p>`;
        editor = this.selectField("led", "Цвет", Object.entries(LEDS).map(([k, v]) => [k, v.label]), c.color);
        break;
      }
    }
    const actions = pinned
      ? `<div class="row">
          ${s.burned ? `<button class="btn inline" data-act="repair" id="btn-repair-one">Заменить новой</button>` : ""}
          ${polar ? `<button class="btn inline" data-act="flip" id="btn-flip">Перевернуть (F)</button>` : ""}
          ${c.placement.mode === "free" ? `<button class="btn inline" data-act="rotate" id="btn-rotate">Повернуть (R)</button>` : ""}
          <button class="btn inline danger" data-act="delete" id="btn-delete">Удалить</button>
        </div>`
      : `<p class="sub">Нажмите, чтобы выбрать и изменить.</p>`;
    const html = `<div class="eyebrow"><span class="ref">${c.id}</span></div>
      <h2>${title}</h2>
      ${this.statusPill(c)}
      ${c.type === "transistor" ? this.transistorReadout(c) : c.type === "mosfet" ? this.mosfetReadout(c) : this.readout(
        c.type === "battery" || c.type === "psu" ? -this.sim.voltage(c) : this.sim.voltage(c),
        c.type === "battery" || c.type === "psu" ? Math.abs(this.sim.current(c)) : this.sim.current(c),
        this.sim.power(c),
        c.type === "capacitor" ? ["W", formatSI(this.sim.energy(c), "Дж")] : undefined,
      )}
      ${this.powerMeter(c)}
      <div class="kv"><span>Где</span><span>${where}</span></div>
      ${this.actualRows(c)}
      ${body}
      ${pinned ? editor : ""}
      ${actions}`;
    return [`c:${c.id}`, html];
  }

  private wirePanel(id: string): [string, string] {
    const w = this.scene.wires.find((x) => x.id === id)!;
    const b = this.sim.branch(id);
    const name = (e: Endpoint) => ("hole" in e ? holeLabel(e.hole) : `вывод ${e.pin + 1} детали ${e.comp}`);
    const sameBoard = isFlatWire({ ...w, shape: "flat" });
    const shapeRow = sameBoard
      ? `<div class="field"><label>Какой провод</label>${this.shapeButtons(w.shape ?? "arc")}</div>`
      : `<p class="sub">Концы не на одной плате — такой провод идёт только дугой.</p>`;
    const html = `<div class="eyebrow"><span class="ref">${id}</span> · провод</div>
      <h2>${isFlatWire(w) ? "Прямая перемычка" : "Провод"}</h2>
      ${this.readout(Math.abs(b.voltage), Math.abs(b.current), b.power)}
      <div class="kv"><span>От</span><span>${name(w.a)}</span></div>
      <div class="kv"><span>До</span><span>${name(w.b)}</span></div>
      <div class="field"><label>Цвет</label>${this.swatches(w.color, false)}</div>
      ${shapeRow}
      <div class="kv"><span>Сопротивление</span><span>${formatOhms(wireResistance(this.scene, w))}</span></div>
      <p class="sub">Медь 22 AWG, ≈ 53 мОм на метр — сопротивление зависит от длины провода. Светлые точки показывают направление тока (от плюса к минусу), скорость — его силу.</p>
      ${this.selected === id ? `<div class="row"><button class="btn inline danger" data-act="delete" id="btn-delete">Удалить</button></div>` : ""}`;
    return [`w:${id}`, html];
  }

  /** Кружки цветов; auto — с вариантом «Авто». */
  private swatches(current: string, auto: boolean): string {
    const items = [...(auto ? [{ hex: "auto", name: "авто: красный к плюсу, чёрный к минусу" }] : []), ...WIRE_PALETTE];
    return `<div class="swatches" role="group" aria-label="Цвет провода">${items
      .map(
        (c) =>
          `<button class="swatch${c.hex === "auto" ? " auto" : ""}" data-color="${c.hex}" title="${c.name}" aria-label="${c.name}" aria-pressed="${c.hex === current}"${
            c.hex === "auto" ? "" : ` style="background:${c.hex}"`
          }>${c.hex === "auto" ? "A" : ""}</button>`,
      )
      .join("")}</div>`;
  }

  /** Переключатель «прямая перемычка / гибкий дугой». */
  private shapeButtons(current: WireShape): string {
    const b = (shape: WireShape, text: string) =>
      `<button class="btn inline" data-shape="${shape}" aria-pressed="${current === shape}">${text}</button>`;
    return `<div class="row">${b("flat", "Прямая перемычка")}${b("arc", "Гибкий, дугой")}</div>`;
  }

  private tracePanel(id: string): [string, string] {
    const t = (this.scene.traces ?? []).find((x) => x.id === id)!;
    const b = this.sim.branch(id);
    const a = HOLE_BY_ID.get(t.a)!;
    const c = HOLE_BY_ID.get(t.b)!;
    const lengthMm = Math.hypot(a.x - c.x, a.z - c.z) * 2.54;
    const html = `<div class="eyebrow"><span class="ref">${id}</span> · дорожка</div>
      <h2>Медная дорожка</h2>
      ${this.readout(Math.abs(b.voltage), Math.abs(b.current), b.power)}
      <div class="kv"><span>От</span><span>${holeLabel(t.a)}</span></div>
      <div class="kv"><span>До</span><span>${holeLabel(t.b)}</span></div>
      <div class="kv"><span>Длина</span><span>${String(lengthMm.toFixed(1)).replace(".", ",")} мм</span></div>
      <div class="kv"><span>Сопротивление</span><span>${formatOhms(traceResistance(t.a, t.b))}</span></div>
      <p class="sub">Медь 35 мкм, ширина с площадку — 1,8 мм: ≈ 0,27 мОм на миллиметр. Чтобы набрать хотя бы 1 Ом, понадобилось бы ≈ 3,7 м такой дорожки.</p>
      <div class="row"><button class="btn inline danger" data-act="delete" id="btn-delete">Удалить</button></div>`;
    return [`t:${id}`, html];
  }

  private traceToolPanel(): [string, string] {
    const html = `<div class="eyebrow">печатная плата</div><h2>Дорожка</h2>
      <p class="sub">На печатной плате площадки <b>ничем не соединены</b> — в отличие от макетки. Соединения рисуются медными дорожками: площадка → площадка → … Esc — закончить.</p>
      <p class="sub">Детали ставятся на площадки так же, как в макетку, и припаиваются. Провода можно вести от площадок к батарее, блоку питания или макетке.</p>`;
    return [`tt`, html];
  }

  private wireToolPanel(): [string, string] {
    const cur = this.defaults.wireColor;
    const name = cur === "auto" ? "авто" : (WIRE_PALETTE.find((x) => x.hex === cur)?.name ?? "");
    const html = `<div class="eyebrow">новый провод</div><h2>Провод</h2>
      <div class="field"><label>Какой провод</label>${this.shapeButtons(this.defaults.wireShape)}</div>
      <p class="sub">${
        this.defaults.wireShape === "flat"
          ? "Прямая перемычка лежит на плате, концы загнуты в отверстия — аккуратно и не мешает. Работает, если оба конца на одной плате; к детали на столе или на другую плату провод всё равно пойдёт дугой."
          : "Гибкий провод идёт дугой — дотянется куда угодно: к детали на столе, на другую плату."
      }</p>
      <div class="field"><label>Цвет: ${name}</label>${this.swatches(cur, true)}</div>
      <p class="sub">Принято: <b>красный — плюс</b>, <b>чёрный или синий — минус</b>. «Авто» красит так сам, если провод идёт к батарее или шине, остальные — по очереди. Цвет готового провода меняется, если нажать на него в режиме «Выбор».</p>`;
    return [`wt`, html];
  }

  private holePanel(h: Hole): [string, string] {
    const v = this.sim.solution.voltage.get(h.node);
    const occ = this.occupied().get(h.id);
    const html = `<div class="eyebrow">отверстие</div>
      <h2>${holeLabel(h.id)}</h2>
      <div class="kv"><span>Соединено с</span><span>${describeNode(h.node)}</span></div>
      <div class="kv"><span>Потенциал</span><span>${v === undefined ? "не подключено" : formatSI(v, "В")}</span></div>
      <div class="kv"><span>Занято</span><span>${occ ?? "свободно"}</span></div>
      <p class="sub">Подсвечены все отверстия, соединённые с этим внутри платы. Esc — закрыть.</p>
      ${boardById(h.boardId) ? this.boardSection(boardById(h.boardId)!) : ""}`;
    return [`h:${h.id}`, html];
  }

  private newPartPanel(tool: PlaceTool): [string, string] {
    const names: Record<PlaceTool, string> = {
      tht: "Резистор", smd: "SMD-резистор", cap: "Конденсатор", diode: "Диод 1N4007", led: "Светодиод", bjt: "Транзистор", fet: "MOSFET", psu: "Блок питания", lamp: "Лампа", switch: "Тумблер", battery: "Батарея",
    };
    let editor = "";
    if (tool === "tht" || tool === "smd") editor = this.ohmsSelect(this.defaults.ohms) + (tool === "smd" ? this.smdSelect(this.defaults.smdSize) : "");
    if (tool === "lamp") editor = this.selectField("lamp", "Лампа", Object.entries(LAMPS).map(([k, v]) => [k, v.label]), this.defaults.lamp);
    if (tool === "battery") editor = this.selectField("battery", "Батарея", Object.entries(BATTERIES).map(([k, v]) => [k, v.label]), this.defaults.battery);
    if (tool === "cap") {
      const el = this.defaults.capVariant === "electrolytic";
      editor =
        this.selectField("capVariant", "Тип", [["electrolytic", "электролитический (полярный)"], ["ceramic", "керамический"]], this.defaults.capVariant) +
        (el
          ? this.selectField("uF", "Ёмкость", ELECTROLYTICS.map((e) => [String(e.uF), formatFarads(e.uF)]), String(this.defaults.electrolyticUF))
          : this.selectField("uF", "Ёмкость", CERAMICS.map((e) => [String(e.uF), `${formatFarads(e.uF)} (${e.code})`]), String(this.defaults.ceramicUF)));
    }
    if (tool === "led") editor = this.selectField("led", "Цвет", Object.entries(LEDS).map(([k, v]) => [k, v.label]), this.defaults.led);
    if (tool === "fet") {
      editor = this.selectField(
        "fet",
        "Тип",
        Object.entries(MOSFETS).map(([k, v]) => [k, `${v.label} (${v.channel.toUpperCase()}-канал, ${v.pkg})`]),
        this.defaults.mosfet,
      );
    }
    if (tool === "bjt") {
      editor = this.selectField(
        "bjt",
        "Тип",
        Object.entries(TRANSISTORS).map(([k, v]) => [k, `${v.label} (${v.polarity === "npn" ? "n-p-n" : "p-n-p"})`]),
        this.defaults.transistor,
      );
    }
    const polarNote = `<p class="sub"><b>Полярная деталь.</b> Первое отверстие — ${tool === "cap" ? "плюс" : "анод (+)"}, второе — ${tool === "cap" ? "минус" : "катод (−)"}.</p>`;
    const note =
      tool === "cap"
        ? `<p class="sub">Копит заряд: заряжается через резистор, потом отдаёт энергию. Чем больше ёмкость и сопротивление, тем медленнее (τ = R·C).</p>${this.defaults.capVariant === "electrolytic" ? polarNote : ""}`
        : tool === "diode"
          ? `<p class="sub">Пропускает ток в одну сторону.</p>${polarNote}`
          : tool === "led"
            ? `<p class="sub">Ставьте последовательно с резистором: от 9 В для красного ≈ 330–470 Ом.</p>${polarNote}`
            : tool === "fet"
              ? `<p class="sub">Полевой транзистор: управляется <b>напряжением</b> на затворе, ток через затвор не течёт. Ставьте резистор 10–100 кОм от затвора к истоку, иначе затвор «зависнет». Порядок ножек у корпусов разный: сейчас <b>${mosfetPinNames(this.defaults.mosfet)}</b>.</p>`
            : tool === "bjt"
              ? `<p class="sub">Три вывода: <b>коллектор, база, эмиттер</b> — встаёт в три соседних столбца слева направо. Маленький ток базы (через резистор 10–100 кОм) управляет большим током коллектора. Базу без резистора к батарее не подключайте.</p>`
            : tool === "smd"
        ? `<p class="sub">Электрически это тот же резистор, но корпус меньше — и рассеять он может меньше: 1206 до 0,25 Вт, 0402 всего до 0,063 Вт.</p>`
        : tool === "tht"
          ? `<p class="sub">Выводной резистор 0,25 Вт, маркировка — цветные полосы. Мощность больше номинала — перегреется и сгорит.</p>`
          : "";
    const html = `<div class="eyebrow">новая деталь</div><h2>${names[tool]}</h2>${note}${editor}`;
    return [`n:${tool}`, html];
  }

  private overviewPanel(): [string, string] {
    const rows: string[] = [];
    for (const c of this.scene.components) {
      const s = this.sim.state(c.id);
      const t = heatThreshold(c);
      const flag = s.burned
        ? " — вышел из строя"
        : this.sim.isShorted(c)
          ? " — КЗ"
          : this.sim.isReversed(c)
            ? " — наоборот"
            : t && this.sim.overload(c) > t
              ? " — перегрузка"
              : "";
      rows.push(`<li><span><span class="ref">${c.id}</span> ${label(c)}${flag}</span><span>${formatSI(Math.abs(this.sim.current(c)), "А")}</span></li>`);
    }
    const html = `<div class="eyebrow">схема</div>
      <h2>${this.scene.components.length ? "Токи через детали" : "Стол пуст"}</h2>
      ${rows.length ? `<ul class="list">${rows.join("")}</ul>` : BOARDS.length
            ? `<p>Начните с батареи (9), затем добавьте резистор (3) и светодиод (6). Или выберите пример вверху.</p>`
            : `<p>На столе пусто. Положите макетку (B) или печатную плату (V), потом батарею (9), резистор (3) и светодиод (6). Или выберите пример вверху.</p>`}
      <div class="help">
        <b>Как устроена макетка.</b> Пять отверстий столбца (a–e или f–j) соединены внутри. Шины + и − вдоль краёв соединены по всей длине. Наведите курсор на отверстие — подсветятся все, что с ним соединены.
      </div>
      <div class="help">
        <b>Допуски.</b> ${
          this.sim.tolerance.enabled
            ? "Включены: у каждой детали параметры немного отличаются от номинала, как у настоящих. Значения видны в панели детали."
            : "Выключены: все детали точно по номиналу. Кнопка «Допуски» вверху включает разброс, как у настоящих деталей."
        }
      </div>
      <div class="help">
        <b>Управление.</b> Нажмите на деталь, провод или отверстие — здесь появятся ток и напряжение. Детали на столе можно перетаскивать. Повторное нажатие на тумблер переключает его. Вращать вид — зажать и тянуть, приближать — колесом.
      </div>`;
    return [`o`, html];
  }

  private selectField(name: string, labelText: string, options: [string, string][], value: string): string {
    return `<div class="field"><label for="f-${name}">${labelText}</label>
      <select id="f-${name}" data-field="${name}">${options.map(([v, t]) => `<option value="${v}"${v === value ? " selected" : ""}>${t}</option>`).join("")}</select></div>`;
  }

  private ohmsSelect(value: number): string {
    return this.selectField("ohms", "Сопротивление (ряд E12)", e12Values().map((v) => [String(v), formatOhms(v)]), String(value));
  }

  private smdSelect(value: SmdSize): string {
    return this.selectField(
      "smd",
      "Типоразмер корпуса",
      (Object.keys(SMD_SIZES) as SmdSize[]).map((k) => [k, `${k} · до ${formatSI(SMD_SIZES[k].ratedW, "Вт")}`]),
      value,
    );
  }

  private bindInspector(): void {
    const root = this.ui.inspector;
    root.querySelectorAll<HTMLSelectElement>("select[data-field]").forEach((sel) => {
      sel.addEventListener("change", () => this.applyField(sel.dataset.field!, sel.value));
    });
    // Ползунки блока питания: меняем уставку на лету, без перестройки сцены
    root.querySelectorAll<HTMLInputElement>("input[type=range][data-field]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const c = this.selected ? this.component(this.selected) : undefined;
        if (c?.type !== "psu") return;
        const v = Number(inp.value);
        if (inp.dataset.field === "psuV") c.volts = v;
        if (inp.dataset.field === "psuA") c.amps = v;
        this.sim.solve();
        this.save();
        const label = inp.previousElementSibling?.querySelector("b");
        if (label) label.textContent = formatSI(v, inp.dataset.field === "psuV" ? "В" : "А");
      });
      inp.addEventListener("change", () => {
        inp.blur();
        this.inspectorHtml = "";
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.color!;
        const w = this.selected ? this.scene.wires.find((x) => x.id === this.selected) : undefined;
        if (w) {
          w.color = color;
          this.changed();
        } else {
          this.defaults.wireColor = color;
          this.inspectorHtml = "";
        }
        this.renderInspector();
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-shape]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const shape = btn.dataset.shape as WireShape;
        const w: Wire | undefined = this.selected ? this.scene.wires.find((x) => x.id === this.selected) : undefined;
        if (w) {
          w.shape = shape;
          this.changed();
        } else {
          this.defaults.wireShape = shape;
          this.inspectorHtml = "";
          this.updateGhost();
        }
        this.renderInspector();
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-board-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = this.selectedHole?.boardId ?? this.selectedBoard;
        if (id && btn.dataset.boardAct === "remove") this.removeBoard(id);
        this.renderInspector();
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = this.selected;
        const act = btn.dataset.act;
        if (!id) return;
        if (act === "delete") this.remove(id);
        if (act === "rotate") this.rotate();
        if (act === "flip") this.flip(id);
        if (act === "discharge") {
          const v = Math.abs(this.sim.voltage(this.component(id)!));
          if (v > 3) this.world.emitSparks(this.views.get(id)!.hotspot, Math.min(30, Math.round(v * 2)));
          this.sim.discharge(id);
          this.inspectorHtml = "";
        }
        if (act === "repair") {
          this.sim.repair(id);
          this.burnedAt.delete(id);
          this.changed();
        }
        if (act === "psuToggle") {
          const c = this.component(id);
          if (c?.type === "psu") {
            c.on = !c.on;
            this.changed();
          }
        }
        if (act === "toggle") {
          const c = this.component(id);
          if (c?.type === "switch") {
            c.closed = !c.closed;
            this.changed();
          }
        }
      });
    });
  }

  private applyField(field: string, value: string): void {
    if (field === "pcbSize") {
      this.defaults.pcbSize = value;
      this.inspectorHtml = "";
      this.updateGhost();
      return;
    }
    if (field === "boardSize") {
      const id = this.selectedHole?.boardId ?? this.selectedBoard;
      const [cols, rows] = value.split("x").map(Number);
      if (id) this.resizeBoard(id, cols, rows);
      this.inspectorHtml = "";
      this.renderInspector();
      return;
    }
    const c = this.selected ? this.component(this.selected) : undefined;
    if (!c) {
      if (field === "ohms") this.defaults.ohms = Number(value);
      if (field === "smd") this.defaults.smdSize = value as SmdSize;
      if (field === "lamp") this.defaults.lamp = value as LampKind;
      if (field === "battery") this.defaults.battery = value as BatteryKind;
      if (field === "capVariant") this.defaults.capVariant = value as "electrolytic" | "ceramic";
      if (field === "uF") {
        if (this.defaults.capVariant === "electrolytic") this.defaults.electrolyticUF = Number(value);
        else this.defaults.ceramicUF = Number(value);
      }
      if (field === "led") this.defaults.led = value as LedColor;
      if (field === "bjt") this.defaults.transistor = value as TransistorKind;
      if (field === "fet") this.defaults.mosfet = value as MosfetKind;
      this.inspectorHtml = "";
      this.updateHint();
      this.updateGhost();
      return;
    }
    if (c.type === "resistor" && field === "ohms") c.ohms = Number(value);
    if (c.type === "resistor" && field === "smd") c.smdSize = value as SmdSize;
    if (c.type === "lamp" && field === "lamp") c.kind = value as LampKind;
    if (c.type === "battery" && field === "battery") c.kind = value as BatteryKind;
    if (c.type === "capacitor" && field === "uF") c.uF = Number(value);
    if (c.type === "led" && field === "led") c.color = value as LedColor;
    if (c.type === "transistor" && field === "bjt") c.kind = value as TransistorKind;
    if (c.type === "mosfet" && field === "fet") c.kind = value as MosfetKind;
    // Поменяли номинал — значит, поставили новую деталь
    this.sim.repair(c.id);
    this.burnedAt.delete(c.id);
    this.changed();
  }

  repairAll(): void {
    for (const c of this.scene.components) if (this.sim.state(c.id).burned) this.sim.states.set(c.id, { burned: false, heat: 0 });
    this.burnedAt.clear();
    this.changed();
  }
}

function label(c: Component): string {
  switch (c.type) {
    case "resistor":
      return `${formatOhms(c.ohms)}${c.variant === "smd" ? ` SMD ${c.smdSize}` : ""}`;
    case "lamp":
      return `лампа ${LAMPS[c.kind].label}`;
    case "switch":
      return c.closed ? "тумблер, вкл." : "тумблер, выкл.";
    case "battery":
      return BATTERIES[c.kind].label;
    case "capacitor":
      return `${formatFarads(c.uF)}${c.variant === "electrolytic" ? "" : " керамический"}`;
    case "diode":
      return DIODE_1N4007.label;
    case "led":
      return `светодиод ${LEDS[c.color].label}`;
    case "transistor":
      return `транзистор ${TRANSISTORS[c.kind].label}, I<sub>к</sub>`;
    case "mosfet":
      return `MOSFET ${MOSFETS[c.kind].label}, I<sub>с</sub>`;
    case "psu":
      return c.on ? `блок питания ${formatSI(c.volts, "В")} / ${formatSI(c.amps, "А")}` : "блок питания, выход выкл.";
  }
}

const ROLE_RU = { G: "З", D: "С", S: "И" } as const;

/** «исток, затвор, сток» — роли ножек корпуса слева направо. */
function mosfetPinNames(kind: MosfetKind): string {
  const names = { G: "затвор", D: "сток", S: "исток" } as const;
  return MOSFETS[kind].pins.map((r) => names[r]).join(", ");
}

/** Заголовок и пояснение для уведомления о выходе детали из строя. */
function burnMessage(c: Component): [string, string] {
  switch (c.type) {
    case "lamp":
      return [`Лампа ${c.id} перегорела`, `Номинал ${LAMPS[c.kind].label}. Добавьте последовательно резистор или возьмите батарею слабее.`];
    case "resistor":
      return c.variant === "smd"
        ? [`Резистор ${c.id} сгорел`, `Корпус ${c.smdSize} рассеивает не больше ${formatSI(SMD_SIZES[c.smdSize].ratedW, "Вт")}. Возьмите корпус крупнее или резистор с бо́льшим сопротивлением.`]
        : [`Резистор ${c.id} сгорел`, `Номинал ${formatSI(THT_RESISTOR.ratedW, "Вт")}. Увеличьте сопротивление или понизьте напряжение.`];
    case "led":
      return [`Светодиод ${c.id} сгорел`, `Ток больше 30 мА. Поставьте последовательно резистор: R = (U − ${String(LEDS[c.color].vf).replace(".", ",")} В) / 0,02 А.`];
    case "diode":
      return [`Диод ${c.id} сгорел`, "Ток больше 1 А. Ограничьте ток резистором."];
    case "mosfet":
      return [
        `MOSFET ${c.id} сгорел`,
        `Больше ${String(MOSFETS[c.kind].maxP).replace(".", ",")} Вт без радиатора или ток выше предела. Полевой транзистор греется, когда приоткрыт: подайте на затвор полное напряжение или ограничьте ток нагрузкой.`,
      ];
    case "transistor":
      return [
        `Транзистор ${c.id} сгорел`,
        "Ток коллектора больше 100 мА или мощность больше 0,5 Вт. Поставьте резистор в цепь коллектора и резистор в базу.",
      ];
    case "capacitor":
      return c.variant === "electrolytic"
        ? [`Конденсатор ${c.id} вздулся`, `Электролит не терпит обратной полярности и напряжения выше ${ELECTROLYTIC_RATED_V} В. Проверьте, где плюс (F — перевернуть).`]
        : [`Конденсатор ${c.id} пробит`, `Напряжение выше ${CERAMIC_RATED_V} В.`];
    default:
      return [`${c.id} вышел из строя`, ""];
  }
}

function smdExplain(ohms: number): string {
  const code = smdCode(ohms);
  if (code.includes("R")) return `буква R стоит на месте запятой`;
  return `${code.slice(0, 2)} × 10${superscript(Number(code[2]))} Ом`;
}

function superscript(n: number): string {
  return String(n).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);
}
