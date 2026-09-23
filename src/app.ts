import * as THREE from "three";
import { BOARD, HOLE_BY_ID, describeNode, holeLabel, holesOnNode, type Hole } from "./model/breadboard";
import {
  BATTERIES,
  LAMPS,
  SMD_SIZES,
  THT_RESISTOR,
  canGoOnBoard,
  ratedPower,
  sameEndpoint,
  type BatteryKind,
  type Component,
  type Endpoint,
  type LampKind,
  type Scene,
  type SmdSize,
} from "./model/types";
import { colorBands, e12Values, formatOhms, formatSI, smdCode } from "./sim/resistorCodes";
import { Simulation, heatThreshold, lampResistance } from "./sim/simulation";
import { buildComponentView, buildWireView, wireCurve, mm, type ComponentView, type WireView } from "./view/builders";
import type { World } from "./view/world";

type Tool = "select" | "wire" | "tht" | "smd" | "lamp" | "switch" | "battery" | "delete";
type PlaceTool = "tht" | "smd" | "lamp" | "switch" | "battery";

// SMD пока скрыт из интерфейса (вернётся вместе с печатной платой), но сохранённые схемы с ним открываются.
const PLACE_TOOLS: PlaceTool[] = ["tht", "lamp", "switch", "battery"];
const TOOL_KEYS: Record<string, Tool> = { "1": "select", "2": "wire", "3": "tht", "4": "lamp", "5": "switch", "6": "battery" };
/** Обозначения по ЕСКД: R — резистор, HL — лампа, SA — выключатель, GB — батарея. */
const PREFIX: Record<Component["type"], string> = { resistor: "R", lamp: "HL", switch: "SA", battery: "GB" };
const WIRE_COLORS = ["#e3b21c", "#2f9e5a", "#2f6fd1", "#e2762a", "#8e4cc9", "#e9e9e4"];
/** Самые длинные выводы, которые можно согнуть между двумя отверстиями (в шагах). */
const MAX_LEAD_SPAN = 12;
const STORAGE_KEY = "maketka.scene.v1";

interface Hover {
  hole?: Hole;
  pin?: { comp: string; pin: 0 | 1; pos: THREE.Vector3 };
  componentId?: string;
  wireId?: string;
  table?: THREE.Vector3;
  overBoard: boolean;
}

export class App {
  scene: Scene;
  sim: Simulation;
  tool: Tool = "select";
  selected?: string;
  hover: Hover = { overBoard: false };

  private views = new Map<string, ComponentView>();
  private wireViews = new Map<string, WireView>();
  private dotPhase = new Map<string, number>();
  private pendingHole?: Hole;
  private pendingEnd?: Endpoint;
  private ghost?: THREE.Object3D;
  private ghostRot = 0;
  private drag?: { id: string; offset: THREE.Vector3 };
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
  };

  constructor(
    private world: World,
    private ui: { inspector: HTMLElement; hint: HTMLElement; toasts: HTMLElement; tools: HTMLElement },
    initial: Scene,
  ) {
    this.scene = initial;
    this.sim = new Simulation(this.scene);
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
    this.sim = new Simulation(s);
    this.selected = undefined;
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
    this.views.clear();
    this.wireViews.clear();
    for (const c of this.scene.components) {
      const v = buildComponentView(c);
      this.views.set(c.id, v);
      this.world.componentLayer.add(v.group);
      if (this.sim.state(c.id).burned) v.update(this.visual(c));
    }
    for (const w of this.scene.wires) {
      const wv = buildWireView(w.id, this.endpointPos(w.a), this.endpointPos(w.b), w.color);
      this.wireViews.set(w.id, wv);
      this.world.wireLayer.add(wv.mesh);
    }
    this.refreshMarks();
  }

  endpointPos(e: Endpoint): THREE.Vector3 {
    if ("hole" in e) {
      const h = HOLE_BY_ID.get(e.hole)!;
      return new THREE.Vector3(h.x, BOARD.height, h.z);
    }
    return this.views.get(e.comp)!.pins[e.pin].clone();
  }

  private visual(c: Component) {
    const s = this.sim.state(c.id);
    const rated = ratedPower(c);
    return {
      brightness: rated ? this.sim.branch(c.id).power / rated : 0,
      heat: s.heat,
      burned: s.burned,
      shorted: this.sim.isShorted(c),
      time: this.time,
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
      if (c.type === "resistor" || c.type === "lamp") {
        const k = this.sim.overload(c);
        const threshold = heatThreshold(c);
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
    this.world.setDots(items);
  }

  private onBurn(c: Component): void {
    this.burnedAt.set(c.id, this.time);
    const v = this.views.get(c.id)!;
    this.world.emitSparks(v.hotspot, 18);
    this.world.emitSmoke(v.hotspot, 10);
    const rated = ratedPower(c)!;
    const what =
      c.type === "lamp"
        ? `Лампа ${c.id} перегорела`
        : `Резистор ${c.id} сгорел`;
    const note =
      c.type === "resistor" && c.variant === "smd"
        ? `Корпус ${c.smdSize} рассеивает не больше ${formatSI(rated, "Вт")}. Возьмите корпус крупнее или резистор с бо́льшим сопротивлением.`
        : c.type === "lamp"
          ? `Номинал ${LAMPS[c.kind].label}. Добавьте последовательно резистор или возьмите батарею слабее.`
          : `Номинал ${formatSI(rated, "Вт")}. Увеличьте сопротивление или понизьте напряжение.`;
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
    if (tool !== "select") this.selected = undefined;
    this.updateHint();
    this.inspectorHtml = "";
    this.renderInspector();
  }

  private cancelPending(): void {
    this.pendingHole = undefined;
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
    }
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
        if (this.pendingHole || this.pendingEnd) this.cancelPending();
        else if (this.tool !== "select") this.setTool("select");
        else {
          this.selected = undefined;
          this.inspectorHtml = "";
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (this.selected) this.remove(this.selected);
        else this.setTool("delete");
      } else if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") {
        this.rotate();
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
          h.pin = { comp: c.id, pin: i as 0 | 1, pos: p };
        }
      });
    }
    const obj = this.world.pickObject(ndc);
    h.componentId = obj?.componentId;
    h.wireId = obj?.wireId;
    if (!h.componentId && !h.wireId) {
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
      (this.tool === "select" && (this.hover.componentId || this.hover.wireId)) ||
      (this.tool === "delete" && (this.hover.componentId || this.hover.wireId)) ||
      (this.tool === "wire" && (this.hover.hole || this.hover.pin)) ||
      (this.isPlaceTool(this.tool) && (this.hover.hole || this.hover.table));
    el.style.cursor = interactive ? "pointer" : "";
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
    }
  }

  private onUp(e: PointerEvent): void {
    const moved = this.down ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) : 99;
    const wasDrag = this.drag;
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
        } else if (h.wireId) {
          this.selected = h.wireId;
        } else {
          this.selected = undefined;
        }
        this.inspectorHtml = "";
        this.renderInspector();
        return;
      }
      case "delete":
        if (h.componentId) this.remove(h.componentId);
        else if (h.wireId) this.remove(h.wireId);
        return;
      case "wire":
        return this.clickWire();
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
    this.scene.wires.push({ id: this.nextWireId(), a: this.pendingEnd, b: end, color: this.pickWireColor(this.pendingEnd, end) });
    this.pendingEnd = undefined;
    this.clearGhost();
    this.changed();
    this.updateHint();
  }

  /** Красный к плюсу батареи, чёрный к минусу, остальные по кругу. */
  private pickWireColor(a: Endpoint, b: Endpoint): string {
    for (const e of [a, b]) {
      if ("comp" in e && this.component(e.comp)?.type === "battery") return e.pin === 1 ? "#c8261f" : "#1b1d20";
      if ("hole" in e) {
        const pol = HOLE_BY_ID.get(e.hole)!.polarity;
        if (pol) return pol === "+" ? "#c8261f" : "#1b1d20";
      }
    }
    return WIRE_COLORS[this.wireColor++ % WIRE_COLORS.length];
  }

  private clickPlace(tool: PlaceTool): void {
    const h = this.hover;
    const boardOk = canGoOnBoard(tool === "battery" ? "battery" : tool === "tht" || tool === "smd" ? "resistor" : tool, tool === "smd" ? "smd" : "tht");

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
    }
    this.sim.scene = this.scene;
    if (this.selected === id) this.selected = undefined;
    this.changed();
  }

  // ─── Подсветка и «призраки» ────────────────────────────────────────────

  private refreshMarks(): void {
    const marks = new Map<string, THREE.ColorRepresentation>();
    const strip = (hole: Hole, color: string, own: string) => {
      for (const x of holesOnNode(hole.node)) marks.set(x.id, color);
      marks.set(hole.id, own);
    };
    const h = this.hover;
    if (h.hole && !h.componentId) strip(h.hole, "#f0c9a8", "#b0612a");
    else if (h.hole && this.tool !== "select" && this.tool !== "delete") strip(h.hole, "#f0c9a8", "#b0612a");
    if (this.pendingHole) strip(this.pendingHole, "#f0c9a8", "#b0612a");
    if (this.pendingEnd && "hole" in this.pendingEnd) strip(HOLE_BY_ID.get(this.pendingEnd.hole)!, "#f0c9a8", "#b0612a");
    // Выделенная деталь на плате: её отверстия
    const sel = this.selected ? this.component(this.selected) : undefined;
    if (sel?.placement.mode === "board") for (const id of sel.placement.holes) marks.set(id, "#b0612a");
    this.world.markHoles(marks);
  }

  private updateGhost(): void {
    const h = this.hover;
    if (this.tool === "wire" && this.pendingEnd) {
      const target = h.pin?.pos ?? (h.hole ? new THREE.Vector3(h.hole.x, BOARD.height, h.hole.z) : h.table);
      if (!target) return this.clearGhost();
      const a = this.endpointPos(this.pendingEnd);
      const geom = new THREE.TubeGeometry(wireCurve(a, target), 40, mm(0.75), 8, false);
      return this.showGhost(new THREE.Mesh(geom));
    }
    if (!this.isPlaceTool(this.tool)) return this.clearGhost();
    const tool = this.tool;
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

  private setHint(html: string): void {
    this.ui.hint.innerHTML = html;
  }

  updateHint(): void {
    const t = this.tool;
    let s: string;
    if (t === "select") s = "Нажмите на деталь, чтобы увидеть ток и напряжение. Свободные детали можно <b>перетаскивать</b>, повторное нажатие на тумблер переключает его. Вращать вид — зажать и тянуть.";
    else if (t === "delete") s = "Нажмите на деталь или провод, чтобы удалить.";
    else if (t === "wire") s = this.pendingEnd ? "Теперь второй конец: <b>отверстие</b> или <b>вывод</b> детали на столе. Esc — отмена." : "Первый конец провода: <b>отверстие</b> макетки или <b>вывод</b> детали на столе.";
    else if (t === "smd") s = "SMD-резистор кладётся <b>на стол</b> (в макетку не вставляется), затем к торцам паяются провода. R — повернуть.";
    else if (t === "battery") s = "Нажмите на стол рядом с платой. R — повернуть. Потом соедините выводы с шинами проводами.";
    else s = this.pendingHole
      ? `Первый вывод в <b>${holeLabel(this.pendingHole.id)}</b>. Выберите отверстие для второго. Esc — отмена.`
      : "Нажмите на <b>отверстие</b>, затем на второе — деталь встанет между ними. Или нажмите на <b>стол</b>, чтобы положить деталь рядом и подключить проводами.";
    this.setHint(s);
  }

  // ─── Инспектор ─────────────────────────────────────────────────────────

  renderInspector(): void {
    const target = this.selected ?? this.hover.componentId ?? this.hover.wireId;
    let html: string;
    let key: string;
    if (target && this.component(target)) {
      [key, html] = this.componentPanel(this.component(target)!, target === this.selected);
    } else if (target && this.scene.wires.some((w) => w.id === target)) {
      [key, html] = this.wirePanel(target);
    } else if (this.hover.hole) {
      [key, html] = this.holePanel(this.hover.hole);
    } else if (this.isPlaceTool(this.tool)) {
      [key, html] = this.newPartPanel(this.tool);
    } else {
      [key, html] = this.overviewPanel();
    }
    // На узком экране общий список занимал бы полэкрана — показываем панель только по делу
    this.ui.inspector.hidden = key === "o" && window.innerWidth <= 760;
    // Не пересоздаём разметку, пока в этой же панели открыт выпадающий список
    const focused = document.activeElement;
    if (focused instanceof HTMLSelectElement && this.ui.inspector.contains(focused) && key === this.inspectorKey) return;
    if (key === this.inspectorKey && html === this.inspectorHtml) return;
    this.inspectorKey = key;
    this.inspectorHtml = html;
    this.ui.inspector.innerHTML = html;
    this.bindInspector();
  }

  private readout(u: number, i: number, p: number): string {
    return `<dl class="readout">
      <div><dt>U</dt><dd>${formatSI(Math.abs(u), "В")}</dd></div>
      <div><dt>I</dt><dd>${formatSI(Math.abs(i), "А")}</dd></div>
      <div><dt>P</dt><dd>${formatSI(p, "Вт")}</dd></div>
    </dl>`;
  }

  private statusPill(c: Component): string {
    const s = this.sim.state(c.id);
    if (s.burned) return `<span class="pill bad">${c.type === "lamp" ? "ПЕРЕГОРЕЛА" : "СГОРЕЛ"}</span>`;
    if (this.sim.isShorted(c)) return `<span class="pill bad">КОРОТКОЕ ЗАМЫКАНИЕ</span>`;
    const k = this.sim.overload(c);
    const t = heatThreshold(c);
    if (t && k > t) return `<span class="pill bad">ПЕРЕГРУЗКА ×${k.toFixed(1).replace(".", ",")}</span>`;
    if (t && k > t * 0.7) return `<span class="pill warn">${c.type === "lamp" && k <= 1.05 ? "ПОЛНЫЙ НАКАЛ" : "ГРЕЕТСЯ"}</span>`;
    if (c.type === "switch") return c.closed ? `<span class="pill ok">ЗАМКНУТ</span>` : `<span class="pill warn">РАЗОМКНУТ</span>`;
    return `<span class="pill ok">НОРМА</span>`;
  }

  private powerMeter(c: Component): string {
    const rated = ratedPower(c);
    if (!rated) return "";
    const k = this.sim.overload(c);
    const t = heatThreshold(c);
    const cls = k > t ? "bad" : k > t * 0.7 && c.type !== "lamp" ? "warn" : "";
    return `<div class="kv"><span>Мощность / номинал</span><span>${Math.round(k * 100)} %</span></div>
      <div class="meter ${cls}"><i style="width:${Math.min(100, k * 100)}%"></i></div>`;
  }

  private componentPanel(c: Component, pinned: boolean): [string, string] {
    const b = this.sim.branch(c.id);
    const s = this.sim.state(c.id);
    const where =
      c.placement.mode === "board"
        ? c.placement.holes.map(holeLabel).join(" ↔ ")
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
    }
    const actions = pinned
      ? `<div class="row">
          ${s.burned ? `<button class="btn inline" data-act="repair" id="btn-repair-one">Заменить новой</button>` : ""}
          ${c.placement.mode === "free" ? `<button class="btn inline" data-act="rotate" id="btn-rotate">Повернуть (R)</button>` : ""}
          <button class="btn inline danger" data-act="delete" id="btn-delete">Удалить</button>
        </div>`
      : `<p class="sub">Нажмите, чтобы выбрать и изменить.</p>`;
    const html = `<div class="eyebrow"><span class="ref">${c.id}</span></div>
      <h2>${title}</h2>
      ${this.statusPill(c)}
      ${this.readout(b.voltage, b.current, c.type === "battery" ? Math.abs(b.current * BATTERIES[c.kind].emf) : b.power)}
      ${this.powerMeter(c)}
      <div class="kv"><span>Где</span><span>${where}</span></div>
      ${body}
      ${pinned ? editor : ""}
      ${actions}`;
    return [`c:${c.id}`, html];
  }

  private wirePanel(id: string): [string, string] {
    const w = this.scene.wires.find((x) => x.id === id)!;
    const b = this.sim.branch(id);
    const name = (e: Endpoint) => ("hole" in e ? holeLabel(e.hole) : `вывод ${e.pin + 1} детали ${e.comp}`);
    const html = `<div class="eyebrow"><span class="ref">${id}</span> · провод</div>
      <h2>Перемычка</h2>
      ${this.readout(b.voltage, b.current, b.power)}
      <div class="kv"><span>От</span><span>${name(w.a)}</span></div>
      <div class="kv"><span>До</span><span>${name(w.b)}</span></div>
      <p class="sub">Сопротивление провода ≈ 5 мОм. Жёлтые точки показывают направление тока (от плюса к минусу), скорость — его силу.</p>
      ${this.selected === id ? `<div class="row"><button class="btn inline danger" data-act="delete" id="btn-delete">Удалить</button></div>` : ""}`;
    return [`w:${id}`, html];
  }

  private holePanel(h: Hole): [string, string] {
    const v = this.sim.solution.voltage.get(h.node);
    const occ = this.occupied().get(h.id);
    const html = `<div class="eyebrow">отверстие</div>
      <h2>${holeLabel(h.id)}</h2>
      <div class="kv"><span>Соединено с</span><span>${describeNode(h.node)}</span></div>
      <div class="kv"><span>Потенциал</span><span>${v === undefined ? "не подключено" : formatSI(v, "В")}</span></div>
      <div class="kv"><span>Занято</span><span>${occ ?? "свободно"}</span></div>
      <p class="sub">Подсвечены все отверстия, соединённые с этим внутри платы.</p>`;
    return [`h:${h.id}`, html];
  }

  private newPartPanel(tool: PlaceTool): [string, string] {
    const names: Record<PlaceTool, string> = { tht: "Резистор", smd: "SMD-резистор", lamp: "Лампа", switch: "Тумблер", battery: "Батарея" };
    let editor = "";
    if (tool === "tht" || tool === "smd") editor = this.ohmsSelect(this.defaults.ohms) + (tool === "smd" ? this.smdSelect(this.defaults.smdSize) : "");
    if (tool === "lamp") editor = this.selectField("lamp", "Лампа", Object.entries(LAMPS).map(([k, v]) => [k, v.label]), this.defaults.lamp);
    if (tool === "battery") editor = this.selectField("battery", "Батарея", Object.entries(BATTERIES).map(([k, v]) => [k, v.label]), this.defaults.battery);
    const note =
      tool === "smd"
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
      const b = this.sim.branch(c.id);
      const s = this.sim.state(c.id);
      const t = heatThreshold(c);
      const flag = s.burned ? " — сгорел" : this.sim.isShorted(c) ? " — КЗ" : t && this.sim.overload(c) > t ? " — перегрузка" : "";
      rows.push(`<li><span><span class="ref">${c.id}</span> ${label(c)}${flag}</span><span>${formatSI(Math.abs(b.current), "А")}</span></li>`);
    }
    const html = `<div class="eyebrow">схема</div>
      <h2>${this.scene.components.length ? "Токи через детали" : "Стол пуст"}</h2>
      ${rows.length ? `<ul class="list">${rows.join("")}</ul>` : `<p>Начните с батареи (6), затем добавьте резистор (3) и лампу (4). Или нажмите «Пример схемы».</p>`}
      <div class="help">
        <b>Как устроена макетка.</b> Пять отверстий столбца (a–e или f–j) соединены внутри. Шины + и − вдоль краёв соединены по всей длине. Наведите курсор на отверстие — подсветятся все, что с ним соединены.
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
    root.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = this.selected;
        const act = btn.dataset.act;
        if (!id) return;
        if (act === "delete") this.remove(id);
        if (act === "rotate") this.rotate();
        if (act === "repair") {
          this.sim.repair(id);
          this.burnedAt.delete(id);
          this.changed();
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
    const c = this.selected ? this.component(this.selected) : undefined;
    if (!c) {
      if (field === "ohms") this.defaults.ohms = Number(value);
      if (field === "smd") this.defaults.smdSize = value as SmdSize;
      if (field === "lamp") this.defaults.lamp = value as LampKind;
      if (field === "battery") this.defaults.battery = value as BatteryKind;
      this.inspectorHtml = "";
      this.updateGhost();
      return;
    }
    if (c.type === "resistor" && field === "ohms") c.ohms = Number(value);
    if (c.type === "resistor" && field === "smd") c.smdSize = value as SmdSize;
    if (c.type === "lamp" && field === "lamp") c.kind = value as LampKind;
    if (c.type === "battery" && field === "battery") c.kind = value as BatteryKind;
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
