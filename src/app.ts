import * as THREE from "three";
import {
  BOARDS,
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
  nextBoardId,
  padsAlong,
  type BoardSpec,
  type Hole,
} from "./model/breadboard";
import {
  isFlatWire,
  boardConflicts,
  sameEndpoint,
  sceneBoards,
  type Component,
  type Endpoint,
  type Pin,
  type Scene,
  type Wire,
  type WireShape,
} from "./model/types";
import { formatSI } from "./sim/resistorCodes";
import { Simulation, heatThreshold } from "./sim/simulation";
import { NO_TOLERANCE, type Tolerance } from "./sim/tolerance";
import { buildComponentView, buildTraceView, buildWireView, type ComponentView, type WireView } from "./view/builders";
import { PARTS, part } from "./parts";
import type { World } from "./view/world";
import { ProjectsPanel } from "./ui/projects";
import { PLACE_TOOLS, TOOL_KEYS, renderToolButtons, type PlaceTool, type Tool } from "./ui/tools";
import { SchematicPanel } from "./ui/schematicPanel";
import { boardPanel, boardToolPanel, componentPanel, holePanel, overviewPanel, traceToolPanel, tracePanel, wirePanel, wireToolPanel } from "./ui/panels";

const WIRE_COLORS = ["#e3b21c", "#2f9e5a", "#2f6fd1", "#e2762a", "#8e4cc9", "#e9e9e4"];
/** Палитра проводов для ручного выбора. */
/** Самые длинные выводы, которые можно согнуть между двумя отверстиями (в шагах). */
const MAX_LEAD_SPAN = 12;
const STORAGE_KEY = "maketka.scene.v1";
const TOLERANCE_KEY = "maketka.tolerance.v1";
const CURRENT_KEY = "maketka.showCurrent.v1";
/** Сколько шагов можно отменить. */
const HISTORY_LIMIT = 100;
/** Сколько времени расчёт может занять за один такт, мс. */
const TICK_BUDGET_MS = 25;
/** Долгое нажатие на сенсорном экране (вместо Shift+щелчка), мс. */
const LONG_PRESS_MS = 450;

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
  private toolSettings = new Map([...PLACE_TOOLS].map(([id, { def }]) => [id, structuredClone(def.settings)]));

  defaults = {
    /** Размер новой печатной платы: столбцы × ряды. */
    pcbSize: "24x14",
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
    this.scene = initial;
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
    const el = this.ui.tools.querySelector(".brand-points");
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
      this.renderSchematic();
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
    if (open) this.setTool("select");
    this.inspectorHtml = "";
    this.renderInspector();
    this.onProjects?.();
  }

  /** Панель «Проекты»: имя, сохранение, список, файл. */
  readonly projects = new ProjectsPanel(this);

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
    this.tool = tool;
    this.onTool?.(tool);
    if (tool !== "select" && this.projectsOpen) {
      this.projectsOpen = false;
      this.onProjects?.();
    }
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
    const { type, def } = PLACE_TOOLS.get(tool)!;
    return { id: this.nextId(type), ...def.create(this.toolSettings.get(tool)), placement } as Component;
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
    if (!c || part(c).noFlip) return;
    if (c.placement.mode === "board") {
      // Для транзистора: К-Б-Э → Э-Б-К
      c.placement.holes = [...c.placement.holes].reverse();
    } else {
      const last = part(c).pins - 1;
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
    return PLACE_TOOLS.has(t);
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

  private rotate(): void {
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
    this.down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
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

  private onUp(e: PointerEvent): void {
    // На сенсорном экране Shift нет — вместо него долгое нажатие
    this.shiftClick = e.shiftKey || (e.pointerType !== "mouse" && !!this.down && e.timeStamp - this.down.t > LONG_PRESS_MS);
    const moved = this.down ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) : 99;
    const wasDrag = this.drag;
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
      if (part(c).pins > 2 && to.kind === "rail") return undefined;
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

  /** Выбранный цвет или «авто»: красный к плюсу батареи, чёрный к минусу, остальные по кругу. */
  private pickWireColor(a: Endpoint, b: Endpoint): string {
    if (this.defaults.wireColor !== "auto") return this.defaults.wireColor;
    for (const e of [a, b]) {
      const c = "comp" in e ? this.component(e.comp) : undefined;
      if ("comp" in e && c && part(c).source) return e.pin === 1 ? "#c8261f" : "#1b1d20";
      if ("hole" in e) {
        const pol = HOLE_BY_ID.get(e.hole)!.polarity;
        if (pol) return pol === "+" ? "#c8261f" : "#1b1d20";
      }
    }
    return WIRE_COLORS[this.wireColor++ % WIRE_COLORS.length];
  }

  private clickPlace(tool: PlaceTool): void {
    const h = this.hover;
    const sample = this.newComponent(tool, { mode: "free", x: 0, z: 0, rot: 0 });
    const boardOk = part(sample).onBoard(sample);

    if (part(sample).pins === 3 && h.hole) {
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
      return this.setHint(PLACE_TOOLS.get(tool)!.def.boardRefusal ?? "");
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
    if (PARTS[PLACE_TOOLS.get(tool)!.type].pins === 3 && h.hole) {
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
    else if (t === "bb") s = "Нажмите на свободное место на столе — туда ляжет макетка на 400 точек.";
    else if (t === "pcb") s = "Нажмите на свободное место на столе — туда ляжет печатная плата. Размер — в панели справа.";
    else if (t === "trace") s = this.pendingPad
      ? `Дорожка от <b>${holeLabel(this.pendingPad.id)}</b>: следующая площадка. Щелчок по той же или Esc — закончить.`
      : "Нажмите на <b>площадку</b> печатной платы, затем на следующую — между ними ляжет медная дорожка.";
    else if (this.isPlaceTool(t)) s = PLACE_TOOLS.get(t)!.def.hint(this.toolSettings.get(t), this.pendingHole ? holeLabel(this.pendingHole.id) : undefined);
    this.showHint(s);
  }

  // ─── Инспектор ─────────────────────────────────────────────────────────

  renderInspector(): void {
    const target = this.selected;
    let html: string;
    let key: string;
    if (this.projectsOpen) {
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
    } else if (this.tool === "bb" || this.tool === "pcb") {
      [key, html] = boardToolPanel(this, this.tool === "bb" ? "breadboard" : "pcb");
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
    this.inspectorKey = key;
    this.inspectorHtml = html;
    this.ui.inspector.innerHTML = html;
    this.bindInspector();
    if (key === "p") this.projects.bind(this.ui.inspector);
  }











  private newPartPanel(tool: PlaceTool): [string, string] {
    const { def } = PLACE_TOOLS.get(tool)!;
    const st = this.toolSettings.get(tool);
    const html = `<div class="eyebrow">новая деталь</div><h2>${def.name(st)}</h2>${def.note(st)}${def.editor(st)}`;
    return [`n:${tool}`, html];
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
      const pt = PLACE_TOOLS.get(this.tool);
      pt?.def.set(this.toolSettings.get(this.tool), field, value);
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








