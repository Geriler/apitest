import * as THREE from "three";
import {
  HOLE_BY_ID,
  TABLE_LIMIT,
  applyBoards,
  boardById,
  boardName,
  boardRect,
  boardSize,
  boardsOverlap,
  holeAt,
  holeLabel,
  holesOnNode,
  isSmdBoard,
  newChipBoard,
  PCB_HEIGHT,
  SEAT_SNAP,
  footprintPads,
  seatHole,
  seatOf,
  seatProblem,
  nextBoardId,
  packageName,
  parsePackage,
  pinOffsets,
  padsAlong,
  type BoardSpec,
  type ChipPackage,
  type ChipPinRole,
  type Hole,
  type Seat,
} from "./model/breadboard";
import {
  isFlatWire,
  boardConflicts,
  footprintOf,
  padNumbers,
  smdOnly,
  sameEndpoint,
  sceneBoards,
  type Component,
  type Endpoint,
  type Pin,
  type Scene,
  type Wire,
  type WireBend,
  type WireShape,
} from "./model/types";
import { formatSI } from "./sim/resistorCodes";
import { Simulation, heatThreshold, pinNode } from "./sim/simulation";
import { NO_TOLERANCE, type Tolerance } from "./sim/tolerance";
import { isSeated, smdView } from "./view/smd";
import { MAX_WIRE_LAYERS, buildComponentView, buildTraceView, buildWireView, wireLifts, type ComponentView, type WireView } from "./view/builders";
import { PARTS, dropUnknownParts, part, pinLabelOf, pinsOf } from "./parts";
import type { World } from "./view/world";
import { ProjectsPanel } from "./ui/projects";
import { loadLibrary, saveLibrary } from "./chips/library";
import { caseOf, chipInner, dipSize, packageChip, packageProblems, spaceUsed } from "./chips/package";
import { chipsUsed, libraryChips, referenceList, resolveChip, setCareerChips, setChipToolSource, setLibrary, setReference } from "./chips/registry";
import { checkLevel, levelScene, publicChips, referenceChips, type CheckResult } from "./career/build";
import { levelById, type Level } from "./career/levels";
import type { Lesson } from "./career/lessons";
import { stageById } from "./career/repairs";
import { activeLesson, activeLevel, careerDefs, isDone, passLesson, kitTools, loadSlot, missing, recordFail, recordMetrics, revealHint, saveSlot, slotOf, toolAllowed, unlock, workshopScene } from "./career/session";
import { CareerMap, MenuScreen } from "./ui/screens";
import { CareerPanel } from "./ui/career";
import { countParts } from "./chips/count";
import { TOOL_KEYS, placeTools, renderToolButtons, setKitTools, setToolFilter, type PlaceTool, type Tool } from "./ui/tools";
import { SchematicPanel } from "./ui/schematicPanel";
import { boardPanel, boardToolPanel, componentPanel, holePanel, overviewPanel, traceToolPanel, tracePanel, wirePanel, wireToolPanel } from "./ui/panels";

const WIRE_COLORS = ["#e3b21c", "#2f9e5a", "#2f6fd1", "#e2762a", "#8e4cc9", "#e9e9e4"];
/** Палитра проводов для ручного выбора. */
/** Самые длинные выводы, которые можно согнуть между двумя отверстиями (в шагах). */
const MAX_LEAD_SPAN = 12;
const STORAGE_KEY = "maketka.scene.v1";
/** Стол карьеры (уровень или мастерская), как его оставили. */
const CAREER_SCENE_KEY = "maketka.career.scene.v1";
/** Режим, в котором был человек в прошлый раз. */
const MODE_KEY = "maketka.mode.v1";
type Mode = "sandbox" | "career";
const TOLERANCE_KEY = "maketka.tolerance.v1";
const CURRENT_KEY = "maketka.showCurrent.v1";
/** Путь внутрь открытых микросхем (чтобы вернуться и после перезагрузки). */
const CHIP_STACK_KEY = "maketka.chipstack.v1";
/** Сколько шагов можно отменить. */
const HISTORY_LIMIT = 100;
/** Сколько времени расчёт может занять за один такт, мс. */
const TICK_BUDGET_MS = 25;
/** Долгое нажатие на сенсорном экране (вместо Shift+щелчка), мс. */
const LONG_PRESS_MS = 450;

interface Hover {
  hole?: Hole;
  pin?: { comp: string; pin: Pin; pos: THREE.Vector3 };
  /** Вывод под курсором для подсказки (любой детали, и на плате тоже). */
  pinTip?: { comp: string; pin: Pin; pos: THREE.Vector3 };
  componentId?: string;
  wireId?: string;
  traceId?: string;
  /** Плата под курсором (если под ним нет детали, провода или дорожки). */
  boardId?: string;
  /** При установке детали: плата под курсором и точка на ней (для посадочных мест SMD). */
  onBoard?: { boardId: string; point: THREE.Vector3 };
  table?: THREE.Vector3;
  overBoard: boolean;
}

export class App {
  scene: Scene;
  sim: Simulation;
  tool: Tool = "select";
  /** Выбранная щелчком деталь или провод. Панель справа показывает только выбранное, не наведённое. */
  selected?: string;
  /**
   * Выделенная обычным щелчком деталь, провод или дорожка — без панели (работают Del, R, F).
   * Панель открывает Shift+щелчок (на телефоне — долгое нажатие), тогда элемент в selected.
   */
  picked?: string;
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
  /** Перенос детали по плате: за какое отверстие взяли и где выводы были в начале. */
  private partDrag?: { id: string; grab: Hole; from: string[]; moved: boolean };
  /** Перенос SMD-детали по её плате: посадочное место едет вместе с ней. */
  private seatDrag?: { id: string; boardId: string; offset: THREE.Vector3; moved: boolean };
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
  /** Настройки новых деталей по инструментам (что выбрано в панели, пока инструмент активен). */
  private toolSettings = new Map<PlaceTool, unknown>();
  /** Настройки новой детали для инструмента (при первом обращении — начальные из описания). */
  private settingsOf(tool: PlaceTool): unknown {
    if (!this.toolSettings.has(tool)) this.toolSettings.set(tool, structuredClone(placeTools().get(tool)?.def.settings ?? {}));
    return this.toolSettings.get(tool);
  }

  defaults = {
    /** Размер новой печатной платы: столбцы × ряды. */
    pcbSize: "24x14",
    smdSize: "24x15",
    /** "auto" — красный к плюсу, чёрный к минусу, остальные по кругу; иначе цвет из палитры. */
    wireColor: "auto",
    /** Какой провод брать: прямую перемычку (если оба конца на одной плате) или гибкий дугой. */
    wireShape: "flat" as WireShape,
  };

  constructor(
    private world: World,
    private ui: { inspector: HTMLElement; hint: HTMLElement; toasts: HTMLElement; tools: HTMLElement; schematic?: HTMLElement },
    initial: Scene,
  ) {
    const gone = dropUnknownParts(initial);
    this.scene = initial;
    setLibrary(loadLibrary());
    // Заводские компоненты карьеры (для песочницы) и открытые игроком
    setReference(referenceChips());
    setCareerChips(careerDefs());
    setToolFilter((t) => toolAllowed(this.scene, t));
    setKitTools(kitTools(this.scene));
    this.applyMode();
    this.adoptChips(initial);
    this.loadChipStack();
    renderToolButtons(this.ui.tools);
    this.schematic = new SchematicPanel(this.ui.schematic, {
      scene: () => this.scene,
      sim: () => this.sim,
      highlighted: () => this.selected ?? this.picked,
      layoutChanged: () => {
        this.save();
        this.record();
      },
      partClicked: (c) => this.schematicClick(c),
    });
    this.adoptBoards();
    this.world.rebuildBoards(true);
    this.sim = new Simulation(this.scene, App.loadTolerance());
    try {
      this.showCurrent = localStorage.getItem(CURRENT_KEY) !== "off";
    } catch {
      /* по умолчанию показываем */
    }
    this.rebuild();
    this.snapshot = JSON.stringify(this.scene);
    this.bindInput();
    this.setTool("select");
    // Открыли страницу внутри микросхемы — вернуть полоску пути (или забыть устаревший путь)
    this.syncChipStack();
    this.syncCareer();
    this.reportDropped(gone);
    // Если кадры редкие, физика догоняет сама
    setInterval(() => this.tick(), 50);
  }

  // ─── Модель ────────────────────────────────────────────────────────────

  private nextId(type: Component["type"]): string {
    const p = PARTS[type].prefix;
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
  occupied(): Map<string, string> {
    const occ = new Map<string, string>();
    for (const c of this.scene.components) {
      if (c.placement.mode === "board") for (const h of c.placement.holes) occ.set(h, c.id);
    }
    for (const w of this.scene.wires) for (const e of [w.a, w.b]) if ("hole" in e) occ.set(e.hole, w.id);
    return occ;
  }

  /** Вызывать после любого изменения сцены. */
  changed(): void {
    this.simErrorShown = false;
    try {
      this.sim.solve();
    } catch (e) {
      this.simFailed(e);
    }
    this.rebuild();
    this.save();
    this.record();
    this.inspectorHtml = "";
    if (this.scene.career) this.refreshKit();
  }

  // ─── Отмена и возврат ──────────────────────────────────────────────────

  /** Снимки сцены до изменений (для Ctrl+Z) и отменённые (для Ctrl+Y). */
  private history: string[] = [];
  private future: string[] = [];
  /** Сцена после последнего изменения, как она лежит в истории. */
  private snapshot = "";
  /** Вызывается, когда меняется, есть ли что отменять или возвращать (для кнопок). */
  onHistory?: () => void;

  get canUndo(): boolean {
    return this.history.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Запомнить сцену, если она изменилась с прошлого раза. */
  record(): void {
    const now = JSON.stringify(this.scene);
    if (now === this.snapshot) return;
    if (this.snapshot) this.history.push(this.snapshot);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
    this.snapshot = now;
    this.onHistory?.();
  }

  undo(): void {
    const prev = this.history.pop();
    if (prev === undefined) return;
    this.future.push(this.snapshot);
    this.restore(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (next === undefined) return;
    this.history.push(this.snapshot);
    this.restore(next);
  }

  /**
   * Вернуть сцену из снимка. Состояние деталей (нагрев, заряд конденсаторов) хранится
   * по обозначениям и остаётся; камера остаётся на месте.
   */
  private restore(json: string): void {
    this.snapshot = json;
    this.scene = JSON.parse(json) as Scene;
    this.adoptBoards();
    this.world.rebuildBoards();
    this.sim.scene = this.scene;
    this.cancelPending();
    const exists = (id: string) => !!this.component(id) || this.scene.wires.some((w) => w.id === id) || (this.scene.traces ?? []).some((t) => t.id === id);
    if (this.selected && !exists(this.selected)) this.selected = undefined;
    if (this.picked && !exists(this.picked)) this.picked = undefined;
    if (this.selectedHole) this.selectedHole = HOLE_BY_ID.get(this.selectedHole.id);
    if (this.selectedBoard && !boardById(this.selectedBoard)) this.selectedBoard = undefined;
    this.sim.solve();
    this.rebuild();
    this.save();
    this.inspectorHtml = "";
    this.renderInspector();
    this.onHistory?.();
    this.syncChipStack();
    this.syncCareer();
  }

  private save(): void {
    // Описания микросхем — вместе со схемой: файл проекта откроется и там, где их нет в библиотеке
    const used = chipsUsed(this.scene);
    if (Object.keys(used).length) this.scene.chips = used;
    else delete this.scene.chips;
    try {
      localStorage.setItem(this.mode === "career" ? CAREER_SCENE_KEY : STORAGE_KEY, JSON.stringify(this.scene));
    } catch {
      /* хранилище недоступно — не страшно */
    }
    // Каждый уровень и мастерская помнят свой стол
    const slot = this.mode === "career" ? slotOf(this.scene) : undefined;
    if (slot) saveSlot(slot, this.scene);
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

  /** Платы сцены (старая раскладка превращается в платы) → отверстия. */
  private adoptBoards(): void {
    this.scene.boards = sceneBoards(this.scene);
    delete this.scene.layout;
    applyBoards(this.scene.boards);
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
    if (kind === "smd") [b.cols, b.rows] = this.defaults.smdSize.split("x").map(Number);
    return b;
  }

  /** После изменения набора плат: отверстия, сцена, сохранение. */
  private boardsChanged(): void {
    applyBoards(this.scene.boards ?? []);
    this.world.rebuildBoards();
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
    if (b.fixed) {
      this.toast("Корпус уровня", "Его не убрать: на нём собирают компонент уровня. Выйти из уровня — «Выйти» вверху.");
      return false;
    }
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
    // Другая схема — уже не тот проект (открытие проекта задаёт имя после загрузки)
    this.projects.name = "";
    const gone = dropUnknownParts(s);
    this.adoptChips(s);
    this.scene = s;
    this.adoptBoards();
    this.world.rebuildBoards(true);
    this.sim = new Simulation(s, this.sim.tolerance);
    this.selected = undefined;
    this.picked = undefined;
    this.selectedHole = undefined;
    this.selectedBoard = undefined;
    this.burnedAt.clear();
    this.cancelPending();
    this.changed();
    this.confirmLeave = false;
    this.syncChipStack();
    this.syncCareer();
    this.reportDropped(gone);
  }

  /** Сказать, что из схемы убраны детали, которых в этой версии нет. */
  private reportDropped(gone: string[]): void {
    if (gone.length) this.toast("Убраны устаревшие детали", `${gone.join(", ")} — таких деталей в песочнице больше нет (вместе с ними — их провода).`);
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
    const lifts = this.wireLifts(this.scene.wires);
    for (const w of this.scene.wires) {
      const wv = buildWireView(w.id, this.endpointPos(w.a), this.endpointPos(w.b), w.color, isFlatWire(w), lifts.get(w.id) ?? 0, w.bend);
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
      brightness: 0,
      heat: s.heat,
      burned: s.burned,
      shorted: this.sim.isShorted(c),
      time: this.time,
      display: undefined,
      ...part(c).visual?.(c, this.sim),
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
      // Тяжёлая схема не должна вешать страницу: не больше ~25 мс расчёта за раз,
      // остальное время пропускаем — схема идёт в замедленном времени
      if (i > 0 && performance.now() - now > TICK_BUDGET_MS) break;
      this.time += dt;
      try {
        for (const c of this.sim.step(dt)) this.onBurn(c);
      } catch (e) {
        this.simFailed(e);
        return;
      }
    }
  }

  private simErrorShown = false;

  /** Расчёт упал (так быть не должно): пишем в консоль и один раз говорим об этом, страница живёт дальше. */
  private simFailed(e: unknown): void {
    console.error("Ошибка расчёта схемы", e);
    if (this.simErrorShown) return;
    this.simErrorShown = true;
    this.toast("Расчёт схемы не справился", "Песочница продолжает работать, но показания могут быть неверными. Измените схему или отмените последнее действие (Ctrl+Z).");
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
          if (this.sim.isShorted(c)) {
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
      if (this.pinTipEl && !this.pinTipEl.hidden) this.updatePinTip();
      this.renderSchematic();
    }
    this.world.render();
  }

  private updateDots(dt: number): void {
    // На ремонте ток не подсвечивается: его ищут приборами
    if (!this.showCurrent) return;
    if (this.scene.career?.repair) return this.world.setDots([]);
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
    // Деталь внутри микросхемы («D1/R1») — дым из корпуса самой микросхемы
    const top = c.id.split("/")[0];
    if (top !== c.id) this.burnedAt.set(top, this.time);
    const v = this.views.get(c.id) ?? this.views.get(top)!;
    this.world.emitSparks(v.hotspot, 18);
    this.world.emitSmoke(v.hotspot, 10);
    const [what, note] = part(c).burn(c);
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

  /** Вызывается при смене инструмента (подсветка групп в панели инструментов). */
  onTool?: (tool: string) => void;
  /** Сводка по схеме и подсказки справа — только по кнопке «?». */
  showHelp = false;

  // ─── Свои микросхемы ───────────────────────────────────────────────────

  /** Описания из открытой схемы (файл, пример) — в библиотеку, если их там нет или там старее. */
  private adoptChips(s: Scene): void {
    const lib = new Map(loadLibrary().map((d) => [d.id, d]));
    let added = false;
    for (const d of Object.values(s.chips ?? {})) {
      // Заводские и карьерные — не в библиотеку своих микросхем
      if (/^(ref|career):/.test(d.id)) continue;
      const old = lib.get(d.id);
      if (!old || old.updatedAt < d.updatedAt) {
        lib.set(d.id, d);
        added = true;
      }
    }
    if (!added) return;
    saveLibrary([...lib.values()]);
    setLibrary(lib.values());
    renderToolButtons(this.ui.tools);
  }

  /** Сведения для раздела «Микросхема» в панели проектов. */
  chipInfo() {
    return {
      box: caseOf(this.scene),
      problems: packageProblems(this.scene),
      size: dipSize(this.scene),
      space: spaceUsed(this.scene),
      count: countParts(chipInner(this.scene), this.scene),
      editing: this.scene.editingChip ? resolveChip(this.scene, this.scene.editingChip) : undefined,
      library: libraryChips(),
    };
  }

  /** Упаковать текущую схему. update — обновить ту, чью схему открыли (все её экземпляры станут новыми). */
  packageChip(name: string, update: boolean): boolean {
    if (this.scene.career) {
      this.toast("Это уровень карьеры", "Здесь компонент открывается проверкой: «Проверить» вверху.");
      return false;
    }
    const problems = packageProblems(this.scene);
    if (problems.length) {
      this.toast("Не упаковать", problems.join(" "));
      return false;
    }
    let old = update && this.scene.editingChip ? resolveChip(this.scene, this.scene.editingChip) : undefined;
    // Заводские и открытые в карьере не переписываются — правка становится своей микросхемой
    if (old && /^(ref|career):/.test(old.id)) {
      this.toast("Упакована как своя", `«${old.name}» — ${old.id.startsWith("ref:") ? "заводская" : "из карьеры"}, её не изменить; ваша правка — новая микросхема в библиотеке.`);
      old = undefined;
    }
    const now = caseOf(this.scene);
    if (old && (old.pins !== dipSize(this.scene) || (old.package ?? "DIP") !== (now?.package ?? "DIP"))) {
      this.toast("Не обновить", `У «${old.name}» корпус ${packageName(old.package, old.pins)}, а сейчас — ${packageName(now?.package, dipSize(this.scene))}. Уже стоящие микросхемы не встанут в свои отверстия — упакуйте как новую.`);
      return false;
    }
    const box = caseOf(this.scene)!;
    if (name && name !== box.label) {
      // Название видно на корпусе
      box.label = name;
      applyBoards(this.scene.boards ?? []);
      this.world.rebuildBoards();
    }
    const def = packageChip(this.scene, name || box.label || old?.name || "", old?.id);
    const lib = loadLibrary().filter((d) => d.id !== def.id);
    lib.push(def);
    if (!saveLibrary(lib)) this.toast("Библиотека не сохранилась", "Хранилище браузера недоступно: микросхема будет только в этом проекте.");
    setLibrary(lib);
    // Новая микросхема в пути получает своё обозначение
    const top = this.chipStack.at(-1);
    if (top && top.id === this.scene.editingChip) top.id = def.id;
    this.scene.editingChip = def.id;
    this.saveChipStack();
    renderToolButtons(this.ui.tools);
    this.save();
    this.record();
    this.toast(old ? "Микросхема обновлена" : "Микросхема упакована", `«${def.name}», ${packageName(def.package, def.pins)} — в группе «Микросхемы» слева.${old ? " Все её экземпляры теперь такие же." : ""}`);
    this.refreshInspector();
    return true;
  }

  /**
   * Путь внутрь микросхем: откуда пришли (схема до «Открыть схему»), чтобы вернуться, не теряя
   * её и не откатываясь. Хранится и в браузере — перезагрузка внутри микросхемы не теряет внешнюю схему.
   */
  private chipStack: { id: string; scene: string; projectName: string; title: string; opened: string }[] = [];
  /** «Вернуться» при несохранённых правках: второе нажатие подтверждает. */
  private confirmLeave = false;
  private chipBar?: HTMLElement;

  /** Открыть схему микросхемы, чтобы поправить: вверху появится путь и «Вернуться». */
  openChip(id: string): void {
    if (this.mode === "career") return this.toast("В карьере не правится", "Открытый компонент — ваша сборка уровня. Чтобы переделать, соберите уровень заново на карте.");
    const def = resolveChip(this.scene, id);
    if (!def) return this.toast("Нет описания", "Этой микросхемы нет ни в библиотеке, ни в проекте.");
    const here = this.scene.editingChip ? resolveChip(this.scene, this.scene.editingChip)?.name : undefined;
    this.chipStack.push({ id: def.id, scene: JSON.stringify(this.scene), projectName: this.projects.name, title: here ?? (this.projects.name || "Стол"), opened: "" });
    const s: Scene = JSON.parse(JSON.stringify(def.scene));
    s.editingChip = def.id;
    this.replaceScene(s);
    this.chipStack.at(-1)!.opened = JSON.stringify(this.scene);
    this.saveChipStack();
    this.renderChipBar();
  }

  /** Новая микросхема: пустой стол с корпусом DIP-pins; вверху — путь и «Вернуться». */
  newChip(pkg: string): void {
    const { package: kind, pins } = parsePackage(pkg);
    const here = this.scene.editingChip ? resolveChip(this.scene, this.scene.editingChip)?.name : undefined;
    const id = `new:${Date.now().toString(36)}`;
    this.chipStack.push({ id, scene: JSON.stringify(this.scene), projectName: this.projects.name, title: here ?? (this.projects.name || "Стол"), opened: "" });
    // Поле нового корпуса — под SMD; сетка 2,54 мм — в панели корпуса («Поле»)
    this.replaceScene({ components: [], wires: [], boards: [{ ...newChipBoard(pins, 0, 0, "K1", kind), smd: true, seats: [] }], editingChip: id });
    this.chipStack.at(-1)!.opened = JSON.stringify(this.scene);
    this.saveChipStack();
    this.renderChipBar();
    this.setProjectsOpen(false);
    this.selectedBoard = "K1";
    this.inspectorHtml = "";
    this.renderInspector();
  }

  /** Сменить корпус («DIP-14», «SOT-23-5»): выводы сохраняют номера (и провода на них), поле растёт вправо. */
  /** Поле корпуса: сетка площадок или под SMD. Менять можно, пока на поле ничего нет. */
  setCaseSmd(id: string, smd: boolean): boolean {
    const b = boardById(id);
    if (!b || b.kind !== "chip" || !!b.smd === smd) return false;
    const next: BoardSpec = { ...b, smd, seats: smd ? [] : undefined };
    const boards = (this.scene.boards ?? []).map((x) => (x.id === id ? next : x));
    const conflicts = boardConflicts(this.scene, boards);
    if (conflicts.length || b.seats?.length) {
      this.refuse("Поле не пустое", conflicts.length ? conflicts : (b.seats ?? []).map((s) => s.id), "Уберите их с поля корпуса — потом меняйте поле.");
      return false;
    }
    this.scene.boards = boards;
    this.boardsChanged();
    this.refreshKit();
    return true;
  }

  resizeChip(id: string, pkg: string): boolean {
    const b = boardById(id);
    const { package: kind, pins } = parsePackage(pkg);
    if (!b || b.kind !== "chip" || b.fixed || (b.pins === pins && (b.package ?? "DIP") === kind)) return false;
    if (b.seats?.length) {
      this.refuse("Не поменять корпус", b.seats.map((s) => s.id), "На поле стоят SMD-детали — уберите их, потом меняйте корпус.");
      return false;
    }
    const r = boardRect(b);
    const grown: BoardSpec = {
      ...b,
      package: kind,
      pins,
      roles: Array.from({ length: pins }, (_, i) => b.roles?.[i] ?? "nc"),
      names: Array.from({ length: pins }, (_, i) => b.names?.[i] ?? ""),
    };
    const size = boardSize(grown);
    const next: BoardSpec = { ...grown, x: r.x0 + size.width / 2, z: r.z0 + size.depth / 2 };
    const boards = (this.scene.boards ?? []).map((x) => (x.id === id ? next : x));
    const conflicts = boardConflicts(this.scene, boards);
    if (conflicts.length) {
      this.refuse("Не помещается", conflicts, "Они стоят на выводах или площадках, которых в меньшем корпусе нет. Уберите их — потом меняйте корпус.");
      return false;
    }
    const problem = this.boardProblem(next);
    if (problem) {
      this.toast("Не помещается", `${problem} Сдвиньте корпус или то, что рядом.`);
      return false;
    }
    this.scene.boards = boards;
    this.boardsChanged();
    return true;
  }

  /** Назначение, имя вывода или название на корпусе. */
  private editChip(id: string, field: string, value: string): void {
    const b = (this.scene.boards ?? []).find((x) => x.id === id);
    if (!b || b.kind !== "chip" || b.fixed) return;
    const [what, n] = field.split(":");
    const i = Number(n);
    if (what === "chipRole") (b.roles ??= [])[i] = value as ChipPinRole;
    if (what === "chipName") (b.names ??= [])[i] = value.trim().slice(0, 8);
    if (what === "chipLabel") b.label = value.trim().slice(0, 24);
    this.boardsChanged();
  }

  /** Вернуться туда, откуда открыли микросхему; update — сначала обновить её по правкам. */
  leaveChip(update: boolean): void {
    const top = this.chipStack.at(-1);
    if (!top) return;
    if (update) {
      if (!this.packageChip("", true)) return;
    } else if (JSON.stringify(this.scene) !== top.opened && !this.confirmLeave) {
      this.confirmLeave = true;
      return this.renderChipBar();
    }
    this.chipStack.pop();
    this.saveChipStack();
    this.replaceScene(JSON.parse(top.scene) as Scene);
    this.projects.name = top.projectName;
    this.renderChipBar();
  }

  /** Схему сменили не через «Вернуться» (Ctrl+Z, пример, проект) — лишние уровни пути больше не нужны. */
  private syncChipStack(): void {
    // В карьере пути внутрь микросхем нет; путь песочницы ждёт её возвращения
    if (this.mode === "career") {
      if (this.chipBar) this.chipBar.hidden = true;
      return;
    }
    let popped = false;
    while (this.chipStack.length && this.scene.editingChip !== this.chipStack.at(-1)!.id) {
      this.chipStack.pop();
      popped = true;
    }
    if (popped) this.saveChipStack();
    this.renderChipBar();
  }

  private saveChipStack(): void {
    try {
      if (this.chipStack.length) localStorage.setItem(CHIP_STACK_KEY, JSON.stringify(this.chipStack));
      else localStorage.removeItem(CHIP_STACK_KEY);
    } catch {
      /* хранилище недоступно — путь живёт до перезагрузки */
    }
  }

  private loadChipStack(): void {
    try {
      const raw = localStorage.getItem(CHIP_STACK_KEY);
      const stack = raw ? (JSON.parse(raw) as App["chipStack"]) : [];
      this.chipStack = Array.isArray(stack) ? stack : [];
    } catch {
      this.chipStack = [];
    }
  }

  /** Полоска вверху: где мы («Стол › Триггер › Мой NAND») и как вернуться. */
  private renderChipBar(): void {
    if (!this.chipBar) {
      this.chipBar = document.createElement("div");
      this.chipBar.className = "chip-bar";
      this.chipBar.setAttribute("role", "navigation");
      this.chipBar.setAttribute("aria-label", "Внутри микросхемы");
      this.chipBar.addEventListener("click", (e) => {
        const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-chip-bar]")?.dataset.chipBar;
        if (act) this.leaveChip(act === "update");
      });
      document.body.appendChild(this.chipBar);
    }
    const top = this.chipStack.at(-1);
    this.chipBar.hidden = !top;
    if (!top) {
      this.confirmLeave = false;
      return;
    }
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const fresh = top.id.startsWith("new:");
    const here = resolveChip(this.scene, top.id)?.name ?? (caseOf(this.scene)?.label || "Новая микросхема");
    const path = [...this.chipStack.map((x) => x.title), here].map(esc).join(" › ");
    this.chipBar.innerHTML = `<span class="path"><small>внутри микросхемы</small> ${path}</span>
      <button class="btn inline" data-chip-bar="update">${fresh ? "Упаковать и вернуться" : "Обновить и вернуться"}</button>
      <button class="btn inline${this.confirmLeave ? " danger" : ""}" data-chip-bar="leave">${this.confirmLeave ? "Точно? Правки пропадут" : "Вернуться"}</button>`;
  }

  /** Убрать из библиотеки (в проектах, где она стоит, её копия остаётся). */
  deleteChip(id: string): void {
    const lib = loadLibrary().filter((d) => d.id !== id);
    saveLibrary(lib);
    setLibrary(lib);
    renderToolButtons(this.ui.tools);
    this.refreshInspector();
  }

  // ─── Принципиальная схема ──────────────────────────────────────────────

  private schematic!: SchematicPanel;

  /** Показана ли панель со схемой. */
  get showSchematic(): boolean {
    return this.schematic.visible;
  }

  setShowSchematic(on: boolean): void {
    this.schematic.setVisible(on);
  }

  /** Перерисовать схему, если она видна и что-то поменялось (токи, выделение, сама сборка). */
  renderSchematic(): void {
    this.schematic.render();
  }

  /** Вернуть автоматическую раскладку схемы (отменяется Ctrl+Z). */
  resetSchematicLayout(): void {
    this.schematic.resetLayout();
  }

  /** Щелчок по детали на схеме: тумблер переключается, остальное — панель детали. */
  private schematicClick(c: Component): void {
    this.setProjectsOpen(false);
    if (this.tool !== "select") this.setTool("select");
    if (part(c).clickToggles) {
      part(c).toggle!(c);
      this.changed();
    } else {
      this.selected = c.id;
      this.picked = undefined;
      this.selectedHole = undefined;
      this.selectedBoard = undefined;
      this.refreshMarks();
      this.inspectorHtml = "";
      this.renderInspector();
    }
  }

  // ─── Проекты ───────────────────────────────────────────────────────────

  /** Открыта ли панель «Проекты». */
  projectsOpen = false;
  /** Вызывается, когда панель проектов открывается или закрывается (для кнопки). */
  onProjects?: () => void;
  setProjectsOpen(open: boolean): void {
    if (this.projectsOpen === open) return;
    this.projectsOpen = open;
    this.projects.reset();
    if (open) this.careerOpen = false;
    if (open) this.setTool("select");
    this.inspectorHtml = "";
    this.renderInspector();
    this.onProjects?.();
  }

  /** Панель «Проекты»: имя, сохранение, список, файл. */
  readonly projects = new ProjectsPanel(this);

  // ─── Режимы: песочница и карьера ──────────────────────────────────────

  /** Режим: у каждого свой стол, свои сохранения и свой набор микросхем в инструментах. */
  mode: Mode = App.loadMode() ?? "sandbox";
  private menu = new MenuScreen(this);
  private map = new CareerMap(this);

  /** Сохранённый режим (или нет — тогда при открытии покажем меню). */
  static loadMode(): Mode | undefined {
    try {
      const m = localStorage.getItem(MODE_KEY);
      return m === "career" || m === "sandbox" ? m : undefined;
    } catch {
      return undefined;
    }
  }

  /** Стол карьеры, как его оставили (уровень или мастерская). */
  static loadCareer(): Scene | undefined {
    try {
      const raw = localStorage.getItem(CAREER_SCENE_KEY);
      const s = raw ? (JSON.parse(raw) as Scene) : undefined;
      return s && Array.isArray(s.components) ? s : undefined;
    } catch {
      return undefined;
    }
  }

  /** Оформление и инструменты под текущий режим. */
  private applyMode(): void {
    document.body.classList.toggle("mode-career", this.mode === "career");
    // Учебные промежуточные компоненты — только в наборах уровней, не в мастерской и не в песочнице
    setChipToolSource(this.mode === "career" ? () => publicChips(careerDefs()) : () => [...publicChips(referenceList()), ...libraryChips()]);
    setKitTools(kitTools(this.scene));
    renderToolButtons(this.ui.tools);
    this.onTool?.(this.tool);
  }

  openMenu(): void {
    this.map.hide();
    this.menu.show(this.mode);
  }

  /** Выбрать режим в меню: свой стол каждого режима сохраняется и возвращается. */
  chooseMode(mode: Mode): void {
    this.menu.hide();
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* в следующий раз снова спросим */
    }
    // В карьеру — всегда через карту, даже если она уже выбрана: стол уровня остаётся за картой
    if (mode === this.mode) {
      if (mode === "career") this.openMap();
      return;
    }
    this.save();
    this.mode = mode;
    this.careerOpen = false;
    this.applyMode();
    const scene = mode === "career" ? App.loadCareer() : App.load();
    this.replaceScene(scene ?? (mode === "career" ? workshopScene() : { components: [], wires: [], boards: [{ id: "BB1", kind: "breadboard", x: 0, z: 0 }] }));
    this.resetHistory();
    if (mode === "career") this.openMap();
  }

  openMap(): void {
    this.menu.hide();
    this.map.show(this.scene.career?.level);
  }

  closeMap(): void {
    this.map.hide();
  }

  hasTable(): boolean {
    return !!this.scene.career;
  }

  /** Отмена не должна перепрыгивать между режимами и уровнями. */
  private resetHistory(): void {
    this.history = [];
    this.future = [];
    this.snapshot = JSON.stringify(this.scene);
    this.onHistory?.();
  }

  /** Открыта ли панель задания уровня (или мастерской). */
  careerOpen = false;
  readonly career = new CareerPanel(this);
  /** Последняя проверка уровня (сбрасывается при смене стола). */
  lastCheck?: CheckResult;
  private careerBar?: HTMLElement;

  setCareerOpen(open: boolean): void {
    if (this.careerOpen === open) return;
    this.careerOpen = open;
    if (open) {
      this.setProjectsOpen(false);
      this.setTool("select");
      this.selected = undefined;
      this.selectedBoard = undefined;
    }
    this.refreshInspector();
  }

  careerLevel(): Level | undefined {
    return activeLevel(this.scene);
  }

  careerLesson(): Lesson | undefined {
    return activeLesson(this.scene);
  }

  /** Взяться за уровень: его стол, как оставили (или с чистого корпуса). */
  startLevel(id: string, fresh = false): void {
    const lesson = stageById(id);
    if (lesson) {
      const saved = fresh ? undefined : loadSlot(id);
      this.replaceScene(saved ? (JSON.parse(JSON.stringify(saved)) as Scene) : lesson.start());
      this.resetHistory();
      this.map.hide();
      this.careerOpen = false;
      return this.setCareerOpen(true);
    }
    const level = levelById(id);
    if (!level) return;
    const need = missing(level);
    if (need.length) return this.toast("Пока закрыто", `Сначала откройте: ${need.join(", ")}.`);
    const saved = fresh ? undefined : loadSlot(id);
    this.replaceScene(saved ? (JSON.parse(JSON.stringify(saved)) as Scene) : levelScene(level));
    this.resetHistory();
    this.map.hide();
    this.careerOpen = false;
    this.setCareerOpen(true);
  }

  /** Мастерская: свободный стол карьеры — базовые детали и открытые модули. */
  openWorkshop(): void {
    const saved = loadSlot("workshop");
    this.replaceScene(saved ? (JSON.parse(JSON.stringify(saved)) as Scene) : workshopScene());
    this.resetHistory();
    this.map.hide();
    this.careerOpen = false;
    this.setCareerOpen(true);
  }

  /** «Очистить»: песочница — пустой стол, уровень — чистый корпус, мастерская — пустые платы. */
  clearTable(): void {
    const level = this.careerLevel();
    const lesson = this.careerLesson();
    if (level) {
      // Поле корпуса (сетка или под SMD) остаётся, каким его выбрали
      const fresh = levelScene(level, caseOf(this.scene)?.smd ?? true);
      this.replaceScene(fresh);
    } else if (lesson) this.replaceScene(lesson.start());
    else if (this.scene.career?.workshop) this.replaceScene(workshopScene());
    else this.replaceScene({ components: [], wires: [], boards: [] });
  }

  /** Проверить сборку уровня; получилось — компонент открыт. */
  checkLevel(): void {
    const lesson = this.careerLesson();
    if (lesson) {
      const steps = lesson.check(this.scene);
      const ok = steps.every((x) => x.ok);
      this.lastCheck = { ok, problems: [], rows: [], steps };
      if (ok) {
        const first = !isDone(lesson.id);
        if (!passLesson(lesson.id)) this.toast("Прогресс не сохранился", "Хранилище браузера недоступно.");
        this.toast(first ? "Урок пройден!" : "Всё верно", `«${lesson.title}» — готово. Дальше — на карте.`);
      } else recordFail(lesson.id);
      this.careerOpen = false;
      return this.setCareerOpen(true);
    }
    const level = this.careerLevel();
    if (!level) return;
    const chips = Object.fromEntries(careerDefs().map((d) => [d.id, d]));
    this.lastCheck = checkLevel(level, this.scene, chips);
    if (this.lastCheck.ok && this.lastCheck.def) {
      const first = !careerDefs().some((d) => d.id === this.lastCheck!.def!.id);
      if (!unlock(this.lastCheck.def, level.id)) this.toast("Прогресс не сохранился", "Хранилище браузера недоступно: открытое пропадёт после перезагрузки.");
      if (this.lastCheck.metrics) this.lastCheck.better = recordMetrics(level.id, this.lastCheck.metrics);
      setCareerChips(careerDefs());
      this.applyMode();
      this.toast(first ? `Открыт ${level.part}!` : `${level.part} обновлён`, `${level.sequence ? "Все шаги проверки сошлись" : "Таблица истинности сошлась"}. Внутри — ваша сборка; ${level.intermediate ? "учебная ступенька попадёт только в набор следующего уровня." : "компонент появится в мастерской и в наборах следующих уровней."}`);
    } else if (this.lastCheck.rows.length) {
      // Собрано, но работает не так — это считается к подсказкам (ошибки набора и корпуса — нет)
      recordFail(level.id);
    }
    this.careerOpen = false;
    this.setCareerOpen(true);
  }

  /** Открыть следующую подсказку уровня. */
  revealHint(): void {
    const level = this.careerLevel() ?? this.careerLesson();
    if (!level) return;
    revealHint(level.id, level.hints.length);
    this.refreshInspector();
  }

  /** Выйти из уровня — на карту (стол уровня сохранён). */
  leaveLevel(): void {
    this.save();
    this.openMap();
  }

  /** Инструменты набора пересчитать (остаток в подписях) и перерисовать. */
  private refreshKit(): void {
    setKitTools(kitTools(this.scene));
    renderToolButtons(this.ui.tools);
    this.onTool?.(this.tool);
  }

  /** Стол сменился: инструменты по уровню, полоска вверху, проверка — заново. */
  private syncCareer(): void {
    const key = slotOf(this.scene);
    if (key !== this.careerKey) this.lastCheck = undefined;
    this.careerKey = key;
    this.refreshKit();
    if (!toolAllowed(this.scene, this.tool)) this.setTool("select");
    if (!this.careerBar) {
      this.careerBar = document.createElement("div");
      this.careerBar.className = "chip-bar career-bar";
      this.careerBar.setAttribute("role", "navigation");
      this.careerBar.setAttribute("aria-label", "Карьера");
      this.careerBar.addEventListener("click", (e) => {
        const act = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-career-bar]")?.dataset.careerBar;
        if (act === "check") this.checkLevel();
        if (act === "leave") this.leaveLevel();
        if (act === "task") this.setCareerOpen(!this.careerOpen);
      });
      document.body.appendChild(this.careerBar);
    }
    const level = this.careerLevel();
    this.careerBar.hidden = !this.scene.career;
    if (level) {
      this.careerBar.innerHTML = `<span class="path"><small>карьера</small> ${level.part} · ${level.title}</span>
        <button class="btn inline" data-career-bar="task">Задание</button>
        <button class="btn inline" data-career-bar="check">Проверить</button>
        <button class="btn inline" data-career-bar="leave">К карте</button>`;
    } else if (this.careerLesson()) {
      this.careerBar.innerHTML = `<span class="path"><small>${this.careerLesson()!.repair ? "ремонт" : "введение"}</small> ${this.careerLesson()!.title}</span>
        <button class="btn inline" data-career-bar="task">Задание</button>
        <button class="btn inline" data-career-bar="check">Проверить</button>
        <button class="btn inline" data-career-bar="leave">К карте</button>`;
    } else if (this.scene.career?.workshop) {
      this.careerBar.innerHTML = `<span class="path"><small>карьера</small> Мастерская — базовые детали и открытые модули</span>
        <button class="btn inline" data-career-bar="task">Что здесь</button>
        <button class="btn inline" data-career-bar="leave">К карте</button>`;
    }
  }
  private careerKey?: string;

  /** Имя текущего проекта (под ним он сохранён или открыт). */
  get projectName(): string {
    return this.projects.name;
  }

  /** Перерисовать панель справа, даже если разметка та же. */
  refreshInspector(): void {
    this.inspectorHtml = "";
    this.renderInspector();
  }

  setTool(tool: Tool): void {
    if (!toolAllowed(this.scene, tool)) tool = "select";
    this.tool = tool;
    this.onTool?.(tool);
    if (tool !== "select" && this.projectsOpen) {
      this.projectsOpen = false;
      this.onProjects?.();
    }
    if (tool !== "select") this.careerOpen = false;
    this.cancelPending();
    this.ghostRot = 0;
    for (const b of this.ui.tools.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    }
    if (tool !== "select") {
      this.selected = undefined;
      this.picked = undefined;
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
    const { type, def } = placeTools().get(tool)!;
    return { id: this.nextId(type), ...def.create(this.settingsOf(tool)), placement } as Component;
  }

  /**
   * Три соседних отверстия ряда для транзистора: начиная с данного и вправо
   * (у правого края платы — сдвиг влево). Только основное поле: в шине все выводы замкнулись бы.
   */
  /** Поставить деталь инструмента tool: поправить её по схеме (номер вывода) и перестроить. */
  private place(tool: PlaceTool, placement: Component["placement"]): void {
    const c = this.newComponent(tool, placement);
    placeTools().get(tool)?.def.adjust?.(c, this.scene);
    this.scene.components.push(c);
    this.clearGhost();
    this.changed();
  }

  /**
   * Отверстия DIP-n: вывод 1 — в отверстие h, выводы 1…n/2 — вправо по его ряду, остальные — обратно
   * по ряду на три шага дальше (поперёк канавки макетки: из ряда f в ряд e). Не в шины.
   */
  private dipHoles(h: Hole, n: number, turns = this.quarterTurns(), pkg: ChipPackage = "DIP"): string[] | undefined {
    if (h.kind === "rail") return undefined;
    const out = pinOffsets(pkg, n).map(([along, across]) => {
      const [dx, dz] = turn(along, -across, turns);
      return holeAt(h.boardId, h.x + dx, h.z + dz);
    });
    return out.every((x) => x && x.kind !== "rail") ? out.map((x) => x!.id) : undefined;
  }

  private transistorHoles(h: Hole, turns = this.quarterTurns()): string[] | undefined {
    if (h.kind === "rail") return undefined;
    // Три подряд по направлению поворота; если там край платы — сдвигаемся назад
    for (const shift of [0, -1, -2]) {
      const holes = [0, 1, 2].map((k) => {
        const [dx, dz] = turn(shift + k, 0, turns);
        return holeAt(h.boardId, h.x + dx, h.z + dz);
      });
      if (holes.every((x) => x && x.kind !== "rail")) return holes.map((x) => x!.id);
    }
    return undefined;
  }

  /** Поворот призрака (R) в четвертях оборота: 0 — выводы вправо, 1 — от себя, 2 — влево, 3 — к себе. */
  private quarterTurns(): number {
    return Math.round(this.ghostRot / (Math.PI / 2)) % 4;
  }

  /**
   * Повернуть деталь на плате на четверть оборота вокруг вывода 1 — если все выводы попадут
   * в свободные отверстия той же платы (многовыводные — не в шины). Иначе объяснить, что мешает.
   */
  private rotateOnBoard(c: Component): void {
    if (c.placement.mode !== "board") return;
    if (isSeated(c)) return this.rotateSeat(c);
    const holes = c.placement.holes.map((id) => HOLE_BY_ID.get(id)!);
    const [h0] = holes;
    const next = holes.map((h) => {
      const [dx, dz] = turn(h.x - h0.x, h.z - h0.z, 1);
      return holeAt(h0.boardId, h0.x + dx, h0.z + dz);
    });
    if (next.some((h) => !h)) return this.setHint("Не повернуть: выводы вышли бы за край платы.");
    if (holes.length > 2 && next.some((h) => h!.kind === "rail")) return this.setHint("Не повернуть: выводы попали бы в шину питания — там они замкнулись бы.");
    const occ = this.occupied();
    const busy = next.find((h) => occ.has(h!.id) && occ.get(h!.id) !== c.id);
    if (busy) return this.setHint(`Не повернуть: там, куда встали бы выводы, уже стоит ${occ.get(busy.id)} (<b>${holeLabel(busy.id)}</b>).`);
    c.placement.holes = next.map((h) => h!.id);
    this.changed();
  }

  /** Повернуть SMD-деталь на четверть оборота вокруг центра её посадочного места. */
  private rotateSeat(c: Component): void {
    const s = seatOf((c.placement as { holes: string[] }).holes[0]);
    const seat = s && (this.scene.boards ?? []).find((b) => b.id === s.board.id)?.seats?.find((x) => x.id === c.id);
    if (!s || !seat) return;
    const next = { ...seat, rot: (seat.rot + 1) % 4 };
    const problem = seatProblem(s.board, next);
    if (problem) return this.setHint(`Не повернуть: ${problem}.`);
    seat.rot = next.rot;
    this.boardsChanged();
  }

  /**
   * Поставить SMD-деталь инструмента tool на плату под SMD: под ней появляется посадочное место
   * её корпуса (центр — в точке point, по сетке 0,635 мм; поворот — R).
   */
  private placeSeated(tool: PlaceTool, board: BoardSpec, point: THREE.Vector3): void {
    const sample = this.newComponent(tool, { mode: "free", x: 0, z: 0, rot: 0 });
    const fp = footprintOf(sample);
    if (!fp) return this.setHint(noSmdHint(sample));
    const seat: Seat = { id: "?", fp, x: snapSeat(point.x - board.x), z: snapSeat(point.z - board.z), rot: this.quarterTurns() };
    const problem = seatProblem(board, seat);
    if (problem) return this.setHint(`Здесь не встанет: ${problem}. R — повернуть.`);
    const c = this.newComponent(tool, { mode: "board", holes: [] });
    placeTools().get(tool)?.def.adjust?.(c, this.scene);
    seat.id = c.id;
    const b = (this.scene.boards ?? []).find((x) => x.id === board.id)!;
    b.seats = [...(b.seats ?? []), seat];
    c.placement = { mode: "board", holes: padNumbers(c, footprintPads(fp).length).map((n) => seatHole(b, c.id, n)) };
    this.scene.components.push(c);
    this.clearGhost();
    this.boardsChanged();
  }

  /**
   * Перевернуть полярную деталь: на плате выводы меняются отверстиями,
   * на столе провода перецепляются на другой вывод.
   */
  flip(id?: string): void {
    const c = id ? this.component(id) : undefined;
    if (!c || part(c).noFlip) return;
    if (isSeated(c)) return this.setHint("SMD-деталь не перевернуть: выводы корпуса на своих местах. Повернуть — R.");
    if (c.placement.mode === "board") {
      // Для транзистора: К-Б-Э → Э-Б-К
      c.placement.holes = [...c.placement.holes].reverse();
    } else {
      const last = pinsOf(c) - 1;
      for (const w of this.scene.wires) {
        for (const k of ["a", "b"] as const) {
          const e = w[k];
          if ("comp" in e && e.comp === c.id) w[k] = { comp: c.id, pin: (last - e.pin) as Pin };
        }
      }
    }
    this.changed();
  }

  private isPlaceTool(t: Tool): boolean {
    return placeTools().has(t);
  }

  // ─── Ввод ──────────────────────────────────────────────────────────────

  private bindInput(): void {
    const el = this.world.renderer.domElement;
    el.addEventListener("pointermove", (e) => this.onMove(e));
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    el.addEventListener("pointerup", (e) => this.onUp(e));
    el.addEventListener("pointercancel", () => this.release());
    window.addEventListener("blur", () => this.release());
    el.addEventListener("pointerleave", () => {
      this.release();
      this.hover = { overBoard: false };
      this.updatePinTip();
      this.refreshMarks();
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).tagName === "SELECT" || (e.target as HTMLElement).tagName === "INPUT") return;
      // Ctrl+Z — отменить, Ctrl+Y или Ctrl+Shift+Z — вернуть (по коду клавиши: работает и в русской раскладке)
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        if (e.code === "KeyY" || e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        if (this.pendingHole || this.pendingEnd || this.pendingPad) this.cancelPending();
        else if (this.tool !== "select") this.setTool("select");
        else {
          this.selected = undefined;
          this.picked = undefined;
          this.selectedHole = undefined;
          this.selectedBoard = undefined;
          this.inspectorHtml = "";
          this.refreshMarks();
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (this.selected ?? this.picked) this.remove((this.selected ?? this.picked)!);
        else if (this.selectedBoard) this.removeBoard(this.selectedBoard);
        else this.setTool("delete");
      } else if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") {
        this.rotate();
      } else if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") {
        this.flip(this.selected ?? this.picked);
      } else if (TOOL_KEYS[e.key]) {
        this.setTool(TOOL_KEYS[e.key]);
      }
    });
    this.ui.tools.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
      if (b) this.setTool(b.dataset.tool as Tool);
    });
  }

  /** Форма новой перемычки, если концы не на одной линии: буквой Г (сначала вдоль ряда или столбца) или прямо. */
  private wireBend: WireBend = "x";

  private rotate(): void {
    if (this.tool === "wire") {
      this.wireBend = NEXT_BEND[this.wireBend];
      this.updateGhost();
      return this.setHint(`Перемычка: ${BEND_NAMES[this.wireBend]}. R — другая форма.`);
    }
    const wire = this.scene.wires.find((w) => w.id === (this.selected ?? this.picked));
    if (wire) {
      if (!isFlatWire(wire)) return;
      const was = wire.bend;
      wire.bend = NEXT_BEND[wire.bend ?? "none"];
      if (this.wireLifts(this.scene.wires).get(wire.id) === null) {
        wire.bend = was;
        return this.setHint(`Так не ляжет: там уже ${MAX_WIRE_LAYERS} перемычки друг над другом.`);
      }
      this.changed();
      return this.setHint(`Перемычка: ${BEND_NAMES[wire.bend]}. R — другая форма.`);
    }
    if (this.isPlaceTool(this.tool)) {
      this.ghostRot = (this.ghostRot + Math.PI / 2) % (Math.PI * 2);
      this.updateGhost();
      return;
    }
    const id = this.selected ?? this.picked;
    const c = id ? this.component(id) : undefined;
    if (c && c.placement.mode === "free") {
      c.placement.rot = (c.placement.rot + Math.PI / 2) % (Math.PI * 2);
      this.changed();
    } else if (c) this.rotateOnBoard(c);
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
    // Подсказка у вывода: ближайший вывод детали под курсором (или вывод свободной детали рядом)
    if (h.componentId) {
      let near = 30;
      this.views.get(h.componentId)?.pins.forEach((p, i) => {
        const s = this.world.toScreen(p);
        const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
        if (d < near) {
          near = d;
          h.pinTip = { comp: h.componentId!, pin: i as Pin, pos: p };
        }
      });
    }
    h.pinTip ??= h.pin;
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
    if (this.isPlaceTool(this.tool) && h.overBoard) h.onBoard = this.world.pickBoard(ndc);
    return h;
  }

  /** Ярлык у курсора: деталь, вывод и его потенциал. */
  private pinTipEl?: HTMLElement;
  private pinTipAt = { x: 0, y: 0 };

  private updatePinTip(x = this.pinTipAt.x, y = this.pinTipAt.y): void {
    this.pinTipAt = { x, y };
    const tip = this.hover.pinTip;
    const c = tip && (this.tool === "select" || this.tool === "wire") ? this.component(tip.comp) : undefined;
    if (!this.pinTipEl) {
      this.pinTipEl = document.createElement("div");
      this.pinTipEl.className = "pin-tip";
      this.pinTipEl.setAttribute("role", "status");
      document.body.appendChild(this.pinTipEl);
    }
    const el = this.pinTipEl;
    if (!c || !tip) {
      el.hidden = true;
      return;
    }
    const v = this.sim.solution.voltage.get(pinNode(c, tip.pin));
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    el.innerHTML = `<b>${esc(c.id)}</b> · ${esc(pinLabelOf(c, tip.pin, this.scene))} <span>${v === undefined ? "не подключён" : formatSI(v, "В")}</span>`;
    el.style.left = `${x + 16}px`;
    el.style.top = `${y + 14}px`;
    el.hidden = false;
  }

  private onMove(e: PointerEvent): void {
    if (this.seatDrag) {
      const d = this.seatDrag;
      const hit = this.world.pickBoard(this.world.ndcFromEvent(e));
      const b = (this.scene.boards ?? []).find((x) => x.id === d.boardId);
      const seat = b?.seats?.find((x) => x.id === d.id);
      if (!hit || !b || !seat || hit.boardId !== b.id) return;
      const x = snapSeat(hit.point.x + d.offset.x - b.x);
      const z = snapSeat(hit.point.z + d.offset.z - b.z);
      if (x === seat.x && z === seat.z) return;
      // На занятое место деталь не едет: остаётся на последнем свободном
      if (seatProblem(b, { ...seat, x, z })) return;
      seat.x = x;
      seat.z = z;
      d.moved = true;
      applyBoards(this.scene.boards ?? []);
      this.scheduleRebuild(true);
      return;
    }
    if (this.partDrag) {
      const d = this.partDrag;
      const target = this.world.pickHole(this.world.ndcFromEvent(e));
      const c = this.component(d.id);
      if (!target || !c || c.placement.mode !== "board") return;
      const holes = this.shiftedHoles(c, d.from, d.grab, target);
      if (!holes || holes.join() === c.placement.holes.join()) return;
      c.placement.holes = holes;
      d.moved = true;
      this.scheduleRebuild();
      return;
    }
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
      this.scheduleRebuild(true);
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
    this.updatePinTip(e.clientX, e.clientY);
    const el = this.world.renderer.domElement;
    const interactive =
      (this.tool === "select" && (this.hover.componentId || this.hover.wireId || this.hover.traceId)) ||
      (this.tool === "delete" && (this.hover.componentId || this.hover.wireId || this.hover.traceId)) ||
      (this.tool === "trace" && this.hover.hole?.board === "pcb") ||
      (this.tool === "wire" && (this.hover.hole || this.hover.pin)) ||
      (this.isPlaceTool(this.tool) && (this.hover.hole || this.hover.table)) ||
      (BOARD_TOOLS[this.tool] && this.hover.table) ||
      (this.tool === "delete" && this.hover.boardId);
    // Выбранную плату можно тащить
    const grab = this.tool === "select" && !interactive && this.hover.boardId !== undefined && this.hover.boardId === this.selectedBoard;
    el.style.cursor = grab ? "grab" : interactive ? "pointer" : "";
    this.refreshMarks();
    this.updateGhost();
  }

  private onDown(e: PointerEvent): void {
    this.down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (this.tool !== "select" || e.button !== 0) return;
    const h = this.computeHover(e);
    const c = h.componentId ? this.component(h.componentId) : undefined;
    // Кнопку без фиксации нажимают, а не тащат: замкнута, пока указатель не отпустят
    if (c && part(c).momentary && !e.shiftKey) {
      this.holding = c.id;
      this.sim.held.add(c.id);
      this.sim.solve();
      return;
    }
    if (c && c.placement.mode === "free") {
      const p = this.world.pickTable(this.world.ndcFromEvent(e));
      if (p) {
        this.drag = { id: c.id, offset: new THREE.Vector3(c.placement.x - p.x, 0, c.placement.z - p.z) };
        this.world.controls.enabled = false;
      }
      return;
    }
    // SMD-деталь тащим по плате вместе с её посадочным местом
    if (c && isSeated(c)) {
      const s = seatOf((c.placement as { holes: string[] }).holes[0])!;
      const hit = this.world.pickBoard(this.world.ndcFromEvent(e));
      if (hit) {
        this.seatDrag = { id: c.id, boardId: s.board.id, offset: new THREE.Vector3(s.board.x + s.seat.x - hit.point.x, 0, s.board.z + s.seat.z - hit.point.z), moved: false };
        this.world.controls.enabled = false;
      }
      return;
    }
    // Деталь на плате: берём за ближайшее отверстие под курсором
    if (c && c.placement.mode === "board") {
      const grab = this.world.pickHole(this.world.ndcFromEvent(e));
      if (grab) {
        this.partDrag = { id: c.id, grab, from: [...c.placement.holes], moved: false };
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

  /** Щелчок с Shift: у тумблера — открыть панель вместо переключения. */
  private shiftClick = false;

  /** Держат ли кнопку «Нажать и держать» в панели. */
  private panelHold = false;
  /** Кнопка, которую сейчас держат указателем. */
  private holding?: string;

  /** Отпустить кнопку, которую держали указателем. */
  private release(): void {
    if (!this.holding) return;
    this.sim.held.delete(this.holding);
    this.holding = undefined;
    this.sim.solve();
  }

  private onUp(e: PointerEvent): void {
    // На сенсорном экране Shift нет — вместо него долгое нажатие
    this.shiftClick = e.shiftKey || (e.pointerType !== "mouse" && !!this.down && e.timeStamp - this.down.t > LONG_PRESS_MS);
    if (this.holding) {
      const id = this.holding;
      this.release();
      // Долгое нажатие на телефоне — ещё и открыть панель кнопки
      if (!this.shiftClick) return;
      this.hover = this.computeHover(e);
      return this.click(id);
    }
    const moved = this.down ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) : 99;
    const wasDrag = this.drag;
    if (this.seatDrag) {
      const d = this.seatDrag;
      this.seatDrag = undefined;
      this.world.controls.enabled = true;
      if (d.moved) {
        cancelAnimationFrame(this.boardFrame);
        this.boardFrame = 0;
        if (this.selected !== d.id) this.picked = d.id;
        this.boardsChanged();
        return;
      }
      if (moved > 5 || e.button !== 0) return;
      this.hover = this.computeHover(e);
      return this.click(d.id);
    }
    if (this.partDrag) {
      const d = this.partDrag;
      this.partDrag = undefined;
      this.world.controls.enabled = true;
      if (d.moved) {
        cancelAnimationFrame(this.boardFrame);
        this.boardFrame = 0;
        if (this.selected !== d.id) this.picked = d.id;
        this.changed();
        return;
      }
      if (moved > 5 || e.button !== 0) return;
      this.hover = this.computeHover(e);
      return this.click(d.id);
    }
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
    this.setProjectsOpen(false);
    switch (this.tool) {
      case "select": {
        const id = pressedId ?? h.componentId;
        const target = id ?? h.wireId ?? h.traceId;
        if (target && this.shiftClick) {
          // Shift+щелчок (долгое нажатие) — панель с показаниями и настройками
          this.selected = target;
          this.picked = undefined;
        } else if (target) {
          const c = id ? this.component(id) : undefined;
          // Тумблер просто щёлкается
          if (c && part(c).clickToggles) {
            part(c).toggle!(c);
            this.changed();
            return;
          }
          this.picked = target;
          if (this.selected !== target) this.selected = undefined;
        } else {
          this.selected = undefined;
          this.picked = undefined;
        }
        const onBoard = !target;
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
      case "smdb":
        return this.clickBoard(BOARD_TOOLS[this.tool]!);
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
    const wire: Wire = { id: this.nextWireId(), a: this.pendingEnd, b: end, color: this.pickWireColor(this.pendingEnd, end), shape: this.defaults.wireShape };
    if (isFlatWire(wire)) wire.bend = this.wireBend;
    if (this.wireLifts([...this.scene.wires, wire]).get(wire.id) === null) {
      return this.setHint(`Здесь уже ${MAX_WIRE_LAYERS} перемычки друг над другом — ещё одна не ляжет. Проведите в обход, другой формой (R) или гибким проводом.`);
    }
    this.scene.wires.push(wire);
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

  /** Перестроить сцену в следующем кадре (не чаще раза за кадр — при перетаскивании). */
  private scheduleRebuild(boards = false): void {
    if (boards) this.boardsDirty = true;
    if (this.boardFrame) return;
    this.boardFrame = requestAnimationFrame(() => {
      this.boardFrame = 0;
      if (this.boardsDirty) this.world.rebuildBoards();
      this.boardsDirty = false;
      this.rebuild();
    });
  }
  private boardsDirty = false;

  /**
   * Выводы детали, сдвинутые так, чтобы отверстие grab оказалось в target (форма выводов
   * сохраняется, можно и на другую плату). Нет — если какого-то отверстия там нет, оно занято
   * или транзистор попал бы в шину.
   */
  private shiftedHoles(c: Component, from: string[], grab: Hole, target: Hole): string[] | undefined {
    const dx = target.x - grab.x;
    const dz = target.z - grab.z;
    const occ = this.occupied();
    const out: string[] = [];
    for (const id of from) {
      const h = HOLE_BY_ID.get(id);
      const to = h && holeAt(target.boardId, h.x + dx, h.z + dz);
      if (!to) return undefined;
      const owner = occ.get(to.id);
      if (owner && owner !== c.id) return undefined;
      // Трёхвыводная деталь в шине замкнула бы все выводы
      if (pinsOf(c) > 2 && to.kind === "rail") return undefined;
      out.push(to.id);
    }
    return out;
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

  /** Выбранный цвет или «авто»: цвет гнезда прибора или клеммы источника (красный к плюсу, чёрный к минусу), остальные по кругу. */
  private pickWireColor(a: Endpoint, b: Endpoint): string {
    if (this.defaults.wireColor !== "auto") return this.defaults.wireColor;
    for (const e of [a, b]) {
      const c = "comp" in e ? this.component(e.comp) : undefined;
      const lead = "comp" in e && c ? part(c).leadColors?.[e.pin] : undefined;
      if (lead) return lead;
      if ("hole" in e) {
        const pol = HOLE_BY_ID.get(e.hole)!.polarity;
        if (pol) return pol === "+" ? "#c8261f" : "#1b1d20";
      }
    }
    return WIRE_COLORS[this.wireColor++ % WIRE_COLORS.length];
  }

  private clickPlace(tool: PlaceTool): void {
    const h = this.hover;
    const kit = tool.startsWith("kit:") ? kitTools(this.scene).find((k) => k.id === tool) : undefined;
    if (kit && kit.left <= 0) return this.setHint("Эти детали из набора уже все стоят. Уберите одну, чтобы поставить в другое место, или перетащите.");
    const sample = this.newComponent(tool, { mode: "free", x: 0, z: 0, rot: 0 });
    // Плата под SMD: деталь встаёт куда угодно, площадки её корпуса появляются под ней
    const smdBoard = h.onBoard ? boardById(h.onBoard.boardId) : undefined;
    if (smdBoard && isSmdBoard(smdBoard) && !this.pendingHole) return this.placeSeated(tool, smdBoard, h.onBoard!.point);
    if (smdOnly(sample) && (h.hole || h.overBoard)) return this.setHint(smdOnlyHint(sample));
    const boardOk = part(sample).onBoard(sample);
    if (!boardOk && (h.hole || h.overBoard)) return this.setHint(placeTools().get(tool)!.def.boardRefusal ?? "");

    // Одновыводная деталь — в одно отверстие; DIP — поперёк канавки
    if (pinsOf(sample) === 1 && h.hole) {
      const owner = this.occupied().get(h.hole.id);
      if (owner) return this.setHint(`Отверстие <b>${holeLabel(h.hole.id)}</b> занято (${owner}).`);
      return this.place(tool, { mode: "board", holes: [h.hole.id] });
    }
    if (pinsOf(sample) >= 4 && h.hole) {
      const n = pinsOf(sample);
      const holes = this.dipHoles(h.hole, n, this.quarterTurns(), sample.type === "chip" ? sample.package : undefined);
      if (!holes) return this.setHint(`Здесь не встанет: вывод 1 — в отверстие под курсором, всем ${n} выводам нужно место (${n / 2} × 2, ряды через 3 шага), не в шинах. На макетке — поперёк канавки, от ряда f. R — повернуть.`);
      const occ = this.occupied();
      const busy = holes.find((id) => occ.has(id));
      if (busy) return this.setHint(`Отверстие <b>${holeLabel(busy)}</b> занято (${occ.get(busy)}).`);
      return this.place(tool, { mode: "board", holes });
    }
    if (pinsOf(sample) === 3 && h.hole) {
      const holes = this.transistorHoles(h.hole);
      if (!holes) return this.setHint("Деталь с тремя выводами ставится в основное поле: в шине все три вывода оказались бы замкнуты.");
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
      return this.setHint(placeTools().get(tool)!.def.boardRefusal ?? "");
    }
    if (this.pendingHole) return; // ждём второе отверстие
    if (h.table) this.place(tool, { mode: "free", x: h.table.x, z: h.table.z, rot: this.ghostRot });
  }

  remove(id: string): void {
    const c = this.component(id);
    if (c && isSeated(c)) {
      // Площадки уходят вместе с деталью — и дорожки с проводами, которые к ним шли
      const pads = new Set((c.placement as { holes: string[] }).holes);
      const s = seatOf([...pads][0])!;
      for (const h of HOLES_OF_SEAT(s.board, id)) pads.add(h);
      this.scene.traces = (this.scene.traces ?? []).filter((t) => !pads.has(t.a) && !pads.has(t.b));
      this.scene.wires = this.scene.wires.filter((w) => ![w.a, w.b].some((e) => "hole" in e && pads.has(e.hole)));
      const b = (this.scene.boards ?? []).find((x) => x.id === s.board.id)!;
      b.seats = (b.seats ?? []).filter((x) => x.id !== id);
      applyBoards(this.scene.boards ?? []);
      this.world.rebuildBoards();
    }
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
    if (this.picked === id) this.picked = undefined;
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
    // Вывод детали на плате под курсором — его цепь
    const tipComp = h.pinTip ? this.component(h.pinTip.comp) : undefined;
    if (tipComp?.placement.mode === "board" && this.tool === "select") {
      const hole = HOLE_BY_ID.get(tipComp.placement.holes[h.pinTip!.pin]);
      if (hole) strip(hole, "#f0c9a8", "#b0612a");
    }
    else if (h.hole && this.tool !== "select" && this.tool !== "delete") strip(h.hole, "#f0c9a8", "#b0612a");
    if (this.pendingHole) strip(this.pendingHole, "#f0c9a8", "#b0612a");
    if (this.pendingPad) strip(this.pendingPad, "#f0c9a8", "#b0612a");
    if (this.selectedHole) strip(this.selectedHole, "#f0c9a8", "#b0612a");
    if (this.pendingEnd && "hole" in this.pendingEnd) strip(HOLE_BY_ID.get(this.pendingEnd.hole)!, "#f0c9a8", "#b0612a");
    // Выделенная деталь на плате: её отверстия
    const selId = this.selected ?? this.picked;
    const sel = selId ? this.component(selId) : undefined;
    if (sel?.placement.mode === "board") for (const id of sel.placement.holes) marks.set(id, "#b0612a");
    this.world.markHoles(marks);
    this.world.highlightBoard(this.tool === "select" ? this.selectedBoard : undefined);
  }

  /** Высоты проводов, чтобы не проходили друг сквозь друга (last — где конец последнего, если его ещё нет в схеме). */
  private wireLifts(wires: Wire[], last?: THREE.Vector3): Map<string, number | null> {
    return wireLifts(
      wires.map((w, i) => ({
        id: w.id,
        a: this.endpointPos(w.a),
        b: last && i === wires.length - 1 ? last : this.endpointPos(w.b),
        flat: isFlatWire(w),
        bend: w.bend,
      })),
    );
  }

  private updateGhost(): void {
    const h = this.hover;
    if (this.tool === "wire" && this.pendingEnd) {
      const target = h.pin?.pos ?? (h.hole ? new THREE.Vector3(h.hole.x, h.hole.y, h.hole.z) : h.table);
      if (!target) return this.clearGhost();
      const a = this.endpointPos(this.pendingEnd);
      const b: Endpoint = h.pin ? { comp: h.pin.comp, pin: h.pin.pin } : h.hole ? { hole: h.hole.id } : { hole: "" };
      const flat = !!h.hole && !h.pin && isFlatWire({ a: this.pendingEnd, b, shape: this.defaults.wireShape });
      // Призрак — на той высоте, где ляжет провод (над теми, что на пути)
      const ghost: Wire = { id: "ghost", a: this.pendingEnd, b, color: "", shape: this.defaults.wireShape, bend: this.wireBend };
      const lift = h.hole || h.pin ? this.wireLifts([...this.scene.wires, ghost], target).get("ghost") : 0;
      if (lift === null) return this.clearGhost();
      return this.showGhost(buildWireView("ghost", a, target, "#ffffff", flat, lift ?? 0, this.wireBend).mesh);
    }
    if (this.tool === "trace" && this.pendingPad && h.hole?.boardId === this.pendingPad.boardId && h.hole.id !== this.pendingPad.id) {
      return this.showGhost(buildTraceView("ghost", this.pendingPad, h.hole).mesh);
    }
    if (BOARD_TOOLS[this.tool] && h.table) {
      const b = this.newBoard(BOARD_TOOLS[this.tool]!, h.table);
      if (this.boardProblem(b)) return this.clearGhost();
      const size = boardSize(b);
      const box = new THREE.Mesh(new THREE.BoxGeometry(size.width, size.height, size.depth));
      box.position.set(b.x, size.height / 2, b.z);
      return this.showGhost(box);
    }
    if (!this.isPlaceTool(this.tool)) return this.clearGhost();
    const tool = this.tool;
    const sample = this.newComponent(tool, { mode: "free", x: 0, z: 0, rot: 0 });
    const n = pinsOf(sample);
    const smdBoard = h.onBoard ? boardById(h.onBoard.boardId) : undefined;
    if (smdBoard && isSmdBoard(smdBoard) && !this.pendingHole) {
      const fp = footprintOf(sample);
      if (!fp) return this.clearGhost();
      const seat: Seat = { id: "?", fp, x: snapSeat(h.onBoard!.point.x - smdBoard.x), z: snapSeat(h.onBoard!.point.z - smdBoard.z), rot: this.quarterTurns() };
      if (seatProblem(smdBoard, seat)) return this.clearGhost();
      return this.showGhost(smdView(sample, { x: smdBoard.x + seat.x, z: smdBoard.z + seat.z, y: PCB_HEIGHT, angle: (seat.rot * Math.PI) / 2 }).group);
    }
    if (smdOnly(sample) && (h.hole || h.overBoard)) return this.clearGhost();
    if (!part(sample).onBoard(sample) && (h.hole || h.overBoard)) return this.clearGhost();
    if (n === 1 && h.hole) return this.showGhost(buildComponentView(this.newComponent(tool, { mode: "board", holes: [h.hole.id] })).group);
    if (n >= 4 && h.hole) {
      const holes = this.dipHoles(h.hole, n, this.quarterTurns(), sample.type === "chip" ? sample.package : undefined);
      return holes ? this.showGhost(buildComponentView(this.newComponent(tool, { mode: "board", holes })).group) : this.clearGhost();
    }
    if (n === 3 && h.hole) {
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
    if (t === "wire") s = this.pendingEnd ? `Второй конец: <b>отверстие</b> или <b>вывод</b> детали. Перемычка не по прямой — ${BEND_NAMES[this.wireBend]}, R — другая форма. Esc — отмена.` : "Первый конец провода: <b>отверстие</b> или <b>вывод</b> детали на столе.";
    else if (t === "bb") s = "Нажмите на свободное место на столе — туда ляжет макетка на 400 точек.";
    else if (t === "pcb") s = "Нажмите на свободное место на столе — туда ляжет печатная плата. Размер — в панели справа.";
    else if (t === "smdb") s = "Нажмите на свободное место на столе — туда ляжет плата под SMD. Размер — в панели справа.";
    else if (t === "trace") s = this.pendingPad
      ? `Дорожка от <b>${holeLabel(this.pendingPad.id)}</b>: следующая площадка. Щелчок по той же или Esc — закончить.`
      : "Нажмите на <b>площадку</b> печатной платы, затем на следующую — между ними ляжет медная дорожка.";
    else if (this.isPlaceTool(t)) {
      s = placeTools().get(t)!.def.hint(this.settingsOf(t), this.pendingHole ? holeLabel(this.pendingHole.id) : undefined);
      // SMD-деталь — на плату под SMD: там площадки появляются под ней, где её ни поставь
      const sample = this.newComponent(t, { mode: "free", x: 0, z: 0, rot: 0 });
      const fp = footprintOf(sample);
      const smdText = `На плате под SMD — куда угодно: под деталью появятся площадки корпуса ${fp}. R — повернуть.`;
      if (fp && smdOnly(sample)) s = `${smdText} Можно и на стол — провода паяются к выводам.`;
      else if (fp && (this.scene.boards ?? []).some(isSmdBoard)) s += ` ${smdText}`;
    }
    this.showHint(s);
  }

  // ─── Инспектор ─────────────────────────────────────────────────────────

  renderInspector(): void {
    const target = this.selected;
    let html: string;
    let key: string;
    if (this.careerOpen) {
      [key, html] = this.career.render();
    } else if (this.projectsOpen) {
      [key, html] = this.projects.render();
    } else if (target && this.component(target)) {
      [key, html] = componentPanel(this, this.component(target)!, true);
    } else if (target && (this.scene.traces ?? []).some((t) => t.id === target)) {
      [key, html] = tracePanel(this, target);
    } else if (target && this.scene.wires.some((w) => w.id === target)) {
      [key, html] = wirePanel(this, target);
    } else if (this.selectedHole && this.tool === "select") {
      [key, html] = holePanel(this, this.selectedHole);
    } else if (this.selectedBoard && boardById(this.selectedBoard) && this.tool === "select") {
      [key, html] = boardPanel(boardById(this.selectedBoard)!);
    } else if (BOARD_TOOLS[this.tool]) {
      [key, html] = boardToolPanel(this, BOARD_TOOLS[this.tool]!);
    } else if (this.isPlaceTool(this.tool)) {
      [key, html] = this.newPartPanel(this.tool);
    } else if (this.tool === "wire") {
      [key, html] = wireToolPanel(this);
    } else if (this.tool === "trace") {
      [key, html] = traceToolPanel();
    } else {
      [key, html] = overviewPanel(this);
    }
    // Сводка и подсказки — только по кнопке «?»; иначе панель справа видна, лишь когда есть что показать
    this.ui.inspector.hidden = key === "o" && !this.showHelp;
    // Не пересоздаём разметку, пока в этой же панели открыт выпадающий список
    const focused = document.activeElement;
    if ((focused instanceof HTMLSelectElement || focused instanceof HTMLInputElement) && this.ui.inspector.contains(focused) && key === this.inspectorKey) return;
    if (key === this.inspectorKey && html === this.inspectorHtml) return;
    // Кнопку в панели держат — не пересоздаём её, иначе удержание оборвётся
    if (this.panelHold && key === this.inspectorKey) return;
    this.inspectorKey = key;
    this.inspectorHtml = html;
    this.ui.inspector.innerHTML = html;
    this.bindInspector();
    if (key === "p") this.projects.bind(this.ui.inspector);
    if (key === "cl" || key === "cc" || key === "cs") this.career.bind(this.ui.inspector);
  }











  private newPartPanel(tool: PlaceTool): [string, string] {
    const { def } = placeTools().get(tool)!;
    const st = this.settingsOf(tool);
    const html = `<div class="eyebrow">новая деталь</div><h2>${def.name(st)}</h2>${def.note(st)}${def.editor(st)}`;
    return [`n:${tool}`, html];
  }


  private bindInspector(): void {
    const root = this.ui.inspector;
    root.querySelectorAll<HTMLSelectElement>("select[data-field]").forEach((sel) => {
      sel.addEventListener("change", () => this.applyField(sel.dataset.field!, sel.value));
    });
    // Текстовые поля (имя вывода микросхемы): по Enter или уходу с поля
    root.querySelectorAll<HTMLInputElement>("input[type=text][data-field]").forEach((inp) => {
      inp.addEventListener("change", () => this.applyField(inp.dataset.field!, inp.value));
    });
    // Ползунки блока питания: меняем уставку на лету, без перестройки сцены
    root.querySelectorAll<HTMLInputElement>("input[type=range][data-field]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const c = this.selected ? this.component(this.selected) : undefined;
        if (!c) return;
        part(c).edit?.(c, inp.dataset.field!, inp.value);
        this.sim.solve();
        this.save();
        const label = inp.previousElementSibling?.querySelector("b");
        if (label) label.textContent = formatSI(Number(inp.value), inp.dataset.unit ?? "");
      });
      inp.addEventListener("change", () => {
        inp.blur();
        this.record();
        this.inspectorHtml = "";
      });
    });
    // «Нажать и держать» для кнопки без фиксации
    root.querySelectorAll<HTMLButtonElement>("[data-hold]").forEach((btn) => {
      const id = this.selected;
      if (!id) return;
      const set = (on: boolean) => {
        if (on === this.sim.held.has(id)) return;
        if (on) this.sim.held.add(id);
        else this.sim.held.delete(id);
        this.sim.solve();
        // Панель не перерисовывается, пока кнопку держат, — плашку состояния меняем на месте
        const c = this.component(id);
        const pill = root.querySelector(".pill");
        if (c && pill) pill.outerHTML = part(c).status?.(c, this.sim) ?? "";
      };
      btn.addEventListener("pointerdown", (e) => {
        btn.setPointerCapture(e.pointerId);
        this.panelHold = true;
        set(true);
      });
      for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) {
        btn.addEventListener(ev, () => {
          this.panelHold = false;
          set(false);
        });
      }
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
        if (act === "openChip") {
          const c = this.component(id);
          if (c?.type === "chip") this.openChip(c.def);
          return;
        }
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
        if (act === "toggle") {
          const c = this.component(id);
          if (c && part(c).toggle) {
            part(c).toggle!(c);
            this.changed();
          }
        }
      });
    });
  }

  private applyField(field: string, value: string): void {
    if (field === "smdSize") {
      this.defaults.smdSize = value;
      this.inspectorHtml = "";
      return;
    }
    if (field === "pcbSize") {
      this.defaults.pcbSize = value;
      this.inspectorHtml = "";
      this.updateGhost();
      return;
    }
    if (field === "chipSmd") {
      const id = this.selectedHole?.boardId ?? this.selectedBoard;
      if (id) this.setCaseSmd(id, value === "smd");
      this.inspectorHtml = "";
      this.renderInspector();
      return;
    }
    if (field === "chipPkg" || field.startsWith("chipRole:") || field.startsWith("chipName:") || field === "chipLabel") {
      const id = this.selectedHole?.boardId ?? this.selectedBoard;
      if (id && field === "chipPkg") this.resizeChip(id, value);
      else if (id) this.editChip(id, field, value);
      this.inspectorHtml = "";
      this.renderInspector();
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
      const pt = placeTools().get(this.tool);
      pt?.def.set(this.settingsOf(this.tool), field, value);
      this.inspectorHtml = "";
      this.updateHint();
      this.updateGhost();
      return;
    }
    part(c).edit?.(c, field, value);
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

/**
 * Сдвиг (dx, dz), повёрнутый на turns четвертей оборота — так же, как поворот детали на столе
 * (rotation.y): при одной четверти «вправо» становится «от себя».
 */
function turn(dx: number, dz: number, turns: number): [number, number] {
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [dx, dz] = [dz, -dx];
  return [dx, dz];
}

/** Формы перемычки по кругу (R) и их названия для подсказки. */
const NEXT_BEND: Record<WireBend, WireBend> = { x: "z", z: "none", none: "x" };
const BEND_NAMES: Record<WireBend, string> = { x: "буквой Г, сначала вдоль ряда", z: "буквой Г, сначала вдоль столбца", none: "прямо наискосок" };

/** Инструменты плат: какую плату кладут. */
const BOARD_TOOLS: Partial<Record<string, BoardSpec["kind"]>> = { bb: "breadboard", pcb: "pcb", smdb: "smd" };

/** Положение посадочного места — по сетке 0,635 мм. */
function snapSeat(v: number): number {
  return Math.round(v / SEAT_SNAP) * SEAT_SNAP;
}

/** Id всех площадок посадочного места (и тех, к которым деталь не подключена). */
function HOLES_OF_SEAT(b: BoardSpec, seat: string): string[] {
  const s = b.seats?.find((x) => x.id === seat);
  return s ? footprintPads(s.fp).map((_, i) => seatHole(b, seat, i + 1)) : [];
}

/** Почему деталь с ножками не встаёт на плату под SMD. */
function noSmdHint(c: Component): string {
  const kind = c.type === "mosfet" || c.type === "transistor" ? c.kind : "";
  const twin = ({ "2N7000": "2N7002", BS250: "BSS84", BC547: "BC847" } as Record<string, string>)[kind];
  if (twin) return `${kind} — в корпусе с ножками (TO-92), на плату под SMD не встаёт. Его SMD-пара в корпусе SOT-23 — <b>${twin}</b>: выберите её в панели детали.`;
  if (c.type === "resistor") return "Выводной резистор на плату под SMD не встаёт. Возьмите SMD-резистор (Пассивные → SMD).";
  if (c.type === "capacitor") return c.variant === "ceramic" ? "Выводной конденсатор на плату под SMD не встаёт. Выберите в панели корпус «SMD 0805»." : "Электролит с ножками на плату под SMD не встаёт: ставьте его на макетку или печатную плату и подключайте проводом.";
  return "У этой детали ножки — на плату под SMD она не встаёт. Ставьте её на макетку или печатную плату, а к плате под SMD подключайте проводом (площадки J вдоль края).";
}

/** Почему SMD-деталь не встаёт в макетку и на площадки с отверстиями. */
function smdOnlyHint(c: Component): string {
  const name = c.type === "resistor" ? "SMD-резистора" : c.type === "capacitor" ? "SMD-конденсатора" : "корпуса SOT-23";
  return `У ${name} нет ножек — в отверстия он не встаёт. Ставьте на плату под SMD (Платы → «Плата под SMD») или на стол.`;
}
