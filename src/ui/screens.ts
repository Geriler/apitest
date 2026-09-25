/**
 * Экраны поверх стола: стартовое меню (песочница или карьера) и карта карьеры — компоненты-узлы,
 * стрелки «из чего собирается», как дерево исследований.
 */

import { LESSONS, type Lesson } from "../career/lessons";
import { REPAIRS, stageById } from "../career/repairs";
import { FUNC_NAMES, LEVELS, gateIo, kitLabel, type Level, type LogicFunc } from "../career/levels";
import { bestOf, isDone, loadSlot, missing } from "../career/session";
import { metricsHtml } from "./career";
import { PIN_ROLES } from "../chips/roles";
import { packageName } from "../model/breadboard";
import { plural } from "../chips/count";

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
          <span>Открывайте компоненты, собирая их из выданного набора деталей — от инвертора до четырёхразрядного сумматора.</span>
          <small>Открыто ${done} из ${LEVELS.length} · уроков ${LESSONS.filter((l) => isDone(l.id)).length} из ${LESSONS.length} · ремонтов ${REPAIRS.filter((l) => isDone(l.id)).length} из ${REPAIRS.length}</small>
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
  "xor-nor": [3, 1],
  and: [3, 2],
  "and-nor": [3, 3],
  or: [3, 4],
  "or-nand": [3, 5],
  buf: [3, 6],
  xnor: [4, 0],
  "xnor-nor": [4, 1],
  "xnor-xor": [4, 2],
  half: [4, 3.5],
  mux: [4, 5],
  "mux-aoi": [4, 6],
  hc7266: [5, 1],
  full: [5, 3.5],
  eq2: [6, 1],
  hc283: [6, 3.5],
  "fix-led-open": [0, 10.5],
  "fix-led-dim": [1, 10.5],
  "fix-divider": [2, 10.5],
  "fix-switch-short": [3, 10.5],
  "fix-switch-reversed": [4, 10.5],
  "fix-pcb-crack": [5, 10.5],
  "fix-adder": [6, 10.5],
  "fix-blinker": [6, 11.5],
  schmitt: [5, 5.5],
  osc: [6, 5.5],
  dlatchr: [6, 8.7],
  dffr: [7, 9],
  sreg8: [8, 8.4],
  tffr: [8, 9.4],
  cnt393: [9, 9.4],
  div2: [7, 7],
  cnt4: [8, 7],
  sreg4: [7, 8],
  sr: [4, 7.5],
  dlatch: [5, 7.5],
  dff: [6, 7.5],
  dec2: [2, 9],
  hc138: [3, 9],
  seg7: [4, 9],
  hc4511: [5, 9],
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
const W = 200, H = 64, COLW = 270, ROWH = 88, PAD = 40;
const at = (id: string) => ({ x: PAD + PLACE[id][0] * COLW, y: PAD + PLACE[id][1] * ROWH });

/** Из каких функций собирается уровень (по микросхемам набора). */
const needs = (l: Level): LogicFunc[] => l.kit.flatMap((k) => (k.part === "chip" ? [k.func] : []));

const variant = (l: Level) => l.variant ?? (l.id.endsWith("-cmos") ? "КМОП" : l.id.endsWith("-rtl") ? "РТЛ" : "из микросхем");

/** Короткие названия функций для узлов карты. */
const FUNC_SHORT: Partial<Record<LogicFunc, string>> = { xor: "Искл. ИЛИ", xnor: "XNOR", xnor4: "4 × XNOR", eq2: "сравнение", mux: "мультиплексор", add4: "сумматор 4 бит", sr: "память", dlatch: "память", dff: "память, по фронту", schmitt: "два порога", osc: "сам меняется", div2: "счёт", cnt4: "счёт", sreg4: "сдвиг", dlatchr: "память, сброс", dffr: "по фронту, сброс", sreg8: "сдвиг, 8 бит", tffr: "счёт по спаду", cnt393: "2 × счёт 4 бит", dec2: "выбор 1 из 4", dec3: "выбор 1 из 8", seg7: "цифра на индикатор", bcd7: "цифра, защёлка" };
/** Подпись узла: функция и вариант; не влезает — только вариант. */
function nodeSub(l: Level): string {
  const full = `${FUNC_SHORT[l.func] ?? FUNC_NAMES[l.func]} · ${variant(l)}`;
  return full.length > 27 ? variant(l) : full;
}

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
    const cols = Math.max(...Object.values(PLACE).map(([c]) => c));
    const rows = Math.max(...Object.values(PLACE).map(([, r]) => r));
    const width = PAD * 2 + cols * COLW + W;
    const height = PAD * 2 + rows * ROWH + H;
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
    // Ремонт — отдельной цепочкой после уроков про приборы (рекомендовано, не обязательно)
    edge(LESSONS.at(-1)!.id, REPAIRS[0].id, isDone(LESSONS.at(-1)!.id));
    REPAIRS.slice(1).forEach((r, i) => edge(REPAIRS[i].id, r.id, isDone(REPAIRS[i].id)));
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
      ...REPAIRS.map((l, i) => {
        const p = at(l.id);
        return `<g class="node ${isDone(l.id) ? "done" : "open"} lesson repair${this.chosen === l.id ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.title)}">
          <rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">Ремонт ${i + 1}${isDone(l.id) ? " ✓" : ""}</text>
          <text x="14" y="47" class="s">${esc(l.title.length > 25 ? l.title.slice(0, 24) + "…" : l.title)}</text></g>`;
      }),
      ...LEVELS.map((l) => {
        const p = at(l.id);
        const state = isDone(l.id) ? "done" : missing(l).length ? "locked" : "open";
        return `<g class="node ${state}${l.intermediate ? " step" : ""}${this.chosen === l.id ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.part)}">
          <rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">${esc(l.part)}${state === "done" ? " ✓" : state === "locked" ? " 🔒" : ""}</text>
          <text x="14" y="47" class="s">${esc(nodeSub(l))}</text></g>`;
      }),
    ];
    const chosen = this.chosen ? LEVELS.find((l) => l.id === this.chosen) : undefined;
    const lesson = this.chosen ? stageById(this.chosen) : undefined;
    this.el.innerHTML = `<header class="map-head">
        <div><div class="eyebrow">карьера</div><h2>Открыто ${done} из ${LEVELS.length} · уроков ${LESSONS.filter((l) => isDone(l.id)).length} из ${LESSONS.length} · ремонтов ${REPAIRS.filter((l) => isDone(l.id)).length} из ${REPAIRS.length}</h2></div>
        <div class="row">
          ${this.host.hasTable() ? `<button class="btn inline" data-map="close">К столу</button>` : ""}
          <button class="btn inline" data-map="workshop">Мастерская</button>
          <button class="btn inline" data-map="menu">Меню</button>
        </div>
      </header>
      <div class="map-body">
        <div class="map-scroll"><svg viewBox="0 0 ${width} ${height}" class="map-svg" style="max-width:${width}px;min-width:${Math.round(width * 0.7)}px">
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
    return `<div class="eyebrow">${l.repair ? `ремонт ${REPAIRS.indexOf(l) + 1}` : `введение · урок ${LESSONS.indexOf(l) + 1}`}</div>
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
      ${l.intermediate ? `<p class="sub">Учебная ступенька: в мастерской и песочнице её нет, она нужна только для следующего уровня цепочки.</p>` : ""}
      <div class="eyebrow">набор</div>
      <ul class="kitlist">${l.kit.map((k) => `<li>${esc(kitLabel(k))} × ${k.count}</li>`).join("")}</ul>
      ${bestOf(l.id) ? `<div class="eyebrow">лучшие цифры</div>${metricsHtml(undefined, bestOf(l.id))}` : ""}
      <div class="eyebrow">корпус ${packageName(l.package ?? "SOT-23-5", l.roles.length)}</div><p class="sub">${esc(pins)}; ${plural(io.inputs.length, "вход", "входа", "входов")}${io.outputs.length > 1 ? `, ${plural(io.outputs.length, "выход", "выхода", "выходов")}` : ""}.${l.sequence ? " С памятью: проверяется последовательностью шагов." : ""}${l.check === "sweep" ? " Проверяются ещё пороги: вход плавно растёт и падает." : l.check === "osc" ? " Проверка записывает выход 6 секунд, как осциллограф." : ""}</p>
      ${buttons}`;
  }
}
