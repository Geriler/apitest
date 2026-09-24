/**
 * Экраны поверх стола: стартовое меню (песочница или карьера) и карта карьеры — компоненты-узлы,
 * стрелки «из чего собирается», как дерево исследований.
 */

import { LESSONS, lessonById, type Lesson } from "../career/lessons";
import { FUNC_NAMES, LEVELS, gateIo, kitLabel, type Level, type LogicFunc } from "../career/levels";
import { bestOf, isDone, loadSlot, missing } from "../career/session";
import { metricsHtml } from "./career";
import { PIN_ROLES } from "../chips/roles";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ─── Стартовое меню ─────────────────────────────────────────────────────────

export interface MenuHost {
  chooseMode(mode: "sandbox" | "career"): void;
}

export class MenuScreen {
  readonly el: HTMLElement;

  constructor(private host: MenuHost) {
    this.el = document.createElement("div");
    this.el.className = "screen menu-screen";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Выбор режима");
    this.el.addEventListener("click", (e) => {
      const mode = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]")?.dataset.mode;
      if (mode === "sandbox" || mode === "career") this.host.chooseMode(mode);
    });
    document.body.appendChild(this.el);
  }

  show(current?: "sandbox" | "career"): void {
    const done = LEVELS.filter((l) => isDone(l.id)).length;
    this.el.innerHTML = `<div class="menu-box">
      <h1>Макетка</h1>
      <p class="sub">3D-песочница электрических цепей</p>
      <div class="menu-cards">
        <button class="menu-card${current === "sandbox" ? " current" : ""}" data-mode="sandbox">
          <b>Песочница</b>
          <span>Все детали, приборы и микросхемы сразу. Свои схемы, проекты, примеры.</span>
        </button>
        <button class="menu-card career${current === "career" ? " current" : ""}" data-mode="career">
          <b>Карьера</b>
          <span>Открывайте компоненты, собирая их из выданного набора деталей — от инвертора до исключающего ИЛИ.</span>
          <small>Открыто ${done} из ${LEVELS.length} · уроков ${LESSONS.filter((l) => isDone(l.id)).length} из ${LESSONS.length}</small>
        </button>
      </div>
      <p class="sub">У каждого режима свой стол и свои сохранения.</p>
    </div>`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

// ─── Карта карьеры ──────────────────────────────────────────────────────────

export interface MapHost {
  startLevel(id: string, fresh: boolean): void;
  openWorkshop(): void;
  openMenu(): void;
  /** Закрыть карту и вернуться к столу (если он есть). */
  closeMap(): void;
  /** Есть ли стол, к которому можно вернуться. */
  hasTable(): boolean;
}

/** Где узлы: [столбец, ряд]. Слева — детали, потом вентили, потом то, что из них собирается. */
const PLACE: Record<string, [number, number]> = {
  "intro-led": [0, 0],
  "intro-volts": [0, 1],
  "intro-amps": [0, 2],
  "intro-divider": [0, 3],
  "intro-switch": [0, 4],
  "intro-scope": [0, 5],
  parts: [1, 2.5],
  "nand-cmos": [2, 0],
  "nand-rtl": [2, 1],
  "not-cmos": [2, 2],
  "not-rtl": [2, 3],
  "nor-cmos": [2, 4],
  "nor-rtl": [2, 5],
  xor: [3, 0],
  and: [3, 1.6],
  or: [3, 3.6],
};
/** Короткие подписи уроков на карте. */
const SHORT: Record<string, string> = {
  "intro-led": "зажечь светодиод",
  "intro-volts": "мультиметр: напряжение",
  "intro-amps": "мультиметр: ток",
  "intro-divider": "делитель напряжения",
  "intro-switch": "транзистор-ключ",
  "intro-scope": "осциллограф",
};
const W = 200, H = 64, COLW = 300, ROWH = 88, PAD = 40;
const at = (id: string) => ({ x: PAD + PLACE[id][0] * COLW, y: PAD + PLACE[id][1] * ROWH });

/** Из каких функций собирается уровень (по микросхемам набора). */
const needs = (l: Level): LogicFunc[] => l.kit.flatMap((k) => (k.part === "chip" ? [k.func] : []));

const variant = (l: Level) => (l.id.endsWith("-cmos") ? "КМОП" : l.id.endsWith("-rtl") ? "РТЛ" : "из микросхем");

export class CareerMap {
  readonly el: HTMLElement;
  private chosen?: string;

  constructor(private host: MapHost) {
    this.el = document.createElement("div");
    this.el.className = "screen map-screen";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Карта карьеры");
    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const node = t.closest<SVGGElement>("[data-node]")?.dataset.node;
      if (node && node !== "parts") {
        this.chosen = node;
        return this.render();
      }
      const act = t.closest<HTMLElement>("[data-map]")?.dataset.map;
      if (act === "start" || act === "restart") this.host.startLevel(this.chosen!, act === "restart");
      if (act === "workshop") this.host.openWorkshop();
      if (act === "menu") this.host.openMenu();
      if (act === "close") this.host.closeMap();
    });
    document.body.appendChild(this.el);
  }

  show(focus?: string): void {
    if (focus) this.chosen = focus;
    this.render();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  private render(): void {
    const done = LEVELS.filter((l) => isDone(l.id)).length;
    const width = PAD * 2 + 3 * COLW + W;
    const height = PAD * 2 + 5 * ROWH + H;
    // Стрелки: от деталей ко всем вентилям; от вентилей — к тому, что из них собирается
    const edges: string[] = [];
    const edge = (from: string, to: string, lit: boolean) => {
      const a = at(from), b = at(to);
      const cls = `class="edge${lit ? " lit" : ""}" marker-end="url(#arrow${lit ? "-lit" : ""})"`;
      // В одном столбце — сверху вниз, между столбцами — слева направо
      if (PLACE[from][0] === PLACE[to][0]) {
        edges.push(`<path ${cls} d="M${a.x + W / 2} ${a.y + H}L${b.x + W / 2} ${b.y}"/>`);
        return;
      }
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
      edges.push(`<path ${cls} d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`);
    };
    // Введение: урок за уроком, последний ведёт к деталям (рекомендовано, но не обязательно)
    LESSONS.forEach((l, i) => edge(l.id, LESSONS[i + 1]?.id ?? "parts", isDone(l.id)));
    for (const l of LEVELS) {
      const n = needs(l);
      if (!n.length) edge("parts", l.id, true);
      for (const f of n) for (const src of LEVELS.filter((x) => x.func === f)) edge(src.id, l.id, isDone(src.id));
    }
    const nodes = [
      `<g class="node done root" data-node="parts" transform="translate(${at("parts").x} ${at("parts").y})"><rect width="${W}" height="${H}" rx="10"/><text x="14" y="27" class="t">Детали</text><text x="14" y="47" class="s">транзисторы и резисторы</text></g>`,
      ...LESSONS.map((l, i) => {
        const p = at(l.id);
        return `<g class="node ${isDone(l.id) ? "done" : "open"} lesson${this.chosen === l.id ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.title)}">
          <rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">Урок ${i + 1}${isDone(l.id) ? " ✓" : ""}</text>
          <text x="14" y="47" class="s">${esc(SHORT[l.id] ?? l.title)}</text></g>`;
      }),
      ...LEVELS.map((l) => {
        const p = at(l.id);
        const state = isDone(l.id) ? "done" : missing(l).length ? "locked" : "open";
        return `<g class="node ${state}${this.chosen === l.id ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.part)}">
          <rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">${esc(l.part)}${state === "done" ? " ✓" : state === "locked" ? " 🔒" : ""}</text>
          <text x="14" y="47" class="s">${esc(l.func === "xor" ? "Искл. ИЛИ" : FUNC_NAMES[l.func])} · ${variant(l)}</text></g>`;
      }),
    ];
    const chosen = this.chosen ? LEVELS.find((l) => l.id === this.chosen) : undefined;
    const lesson = this.chosen ? lessonById(this.chosen) : undefined;
    this.el.innerHTML = `<header class="map-head">
        <div><div class="eyebrow">карьера</div><h2>Открыто ${done} из ${LEVELS.length} · уроков ${LESSONS.filter((l) => isDone(l.id)).length} из ${LESSONS.length}</h2></div>
        <div class="row">
          ${this.host.hasTable() ? `<button class="btn inline" data-map="close">К столу</button>` : ""}
          <button class="btn inline" data-map="workshop">Мастерская</button>
          <button class="btn inline" data-map="menu">Меню</button>
        </div>
      </header>
      <div class="map-body">
        <div class="map-scroll"><svg viewBox="0 0 ${width} ${height}" class="map-svg" style="max-width:${width}px">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="arrow"/></marker>
            <marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="arrow lit"/></marker>
          </defs>
          ${edges.join("")}${nodes.join("")}
        </svg></div>
        <aside class="map-card">${lesson ? this.lessonCard(lesson) : chosen ? this.card(chosen) : `<p class="sub">Начните с введения слева, если приборы и детали пока незнакомы, — или сразу с вентилей. Выберите компонент на карте. Зелёные — открыты, светлые — можно собирать, серые — сначала откройте то, из чего они собираются.</p><p class="sub">Мастерская — свободный стол: базовые детали и все открытые модули.</p>`}</aside>
      </div>`;
  }

  private lessonCard(l: Lesson): string {
    const started = !!loadSlot(l.id);
    return `<div class="eyebrow">введение · урок ${LESSONS.indexOf(l) + 1}</div>
      <h3>${esc(l.title)}${isDone(l.id) ? " ✓" : ""}</h3>
      <p>${esc(l.about)}</p>
      ${l.kit.length ? `<div class="eyebrow">набор</div><ul class="kitlist">${l.kit.map((k) => `<li>${esc(kitLabel(k))} × ${k.count}</li>`).join("")}</ul>` : ""}
      <div class="row"><button class="btn inline primary" data-map="start">${started ? "Продолжить" : isDone(l.id) ? "Пройти ещё раз" : "Начать"}</button>
      ${started ? `<button class="btn inline" data-map="restart">Начать заново</button>` : ""}</div>`;
  }

  private card(l: Level): string {
    const need = missing(l);
    const io = gateIo(l);
    const pins = l.roles.map((r, i) => `${i + 1} ${l.names[i] || PIN_ROLES[r].name}`).join(", ");
    const started = !!loadSlot(l.id);
    const buttons = need.length
      ? `<p class="sub bad">Сначала откройте: ${esc(need.join(", "))}.</p>`
      : `<div class="row"><button class="btn inline primary" data-map="start">${started ? "Продолжить" : isDone(l.id) ? "Собрать ещё раз" : "Собрать"}</button>
         ${started ? `<button class="btn inline" data-map="restart">Начать заново</button>` : ""}</div>`;
    return `<div class="eyebrow">${esc(FUNC_NAMES[l.func])} · ${variant(l)}</div>
      <h3>${esc(l.part)}${isDone(l.id) ? " ✓" : ""}</h3>
      <p>${esc(l.about)}</p>
      <div class="eyebrow">набор</div>
      <ul class="kitlist">${l.kit.map((k) => `<li>${esc(kitLabel(k))} × ${k.count}</li>`).join("")}</ul>
      ${bestOf(l.id) ? `<div class="eyebrow">лучшие цифры</div>${metricsHtml(undefined, bestOf(l.id))}` : ""}
      <div class="eyebrow">корпус SOT-23-5</div><p class="sub">${esc(pins)}; ${io.inputs.length === 1 ? "один вход" : "два входа"}.</p>
      ${buttons}`;
  }
}
