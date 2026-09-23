/**
 * Панель справа: разметка для детали, провода, дорожки, отверстия, платы, инструментов и сводки.
 * Только строки HTML по текущему состоянию; события навешивает app.ts.
 */

import { BOARDS, HOLE_BY_ID, PCB_SIZES, boardById, boardName, boardSize, describeNode, holeLabel, type BoardSpec, type Hole } from "../model/breadboard";
import { isFlatWire, type Component, type Endpoint, type Scene, type WireShape } from "../model/types";
import { part } from "../parts";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import { heatThreshold, traceResistance, wireResistance, type Simulation } from "../sim/simulation";
import { pill, readout, selectField } from "../view/panel";

/** Что панели нужно знать о приложении. */
export interface PanelHost {
  readonly scene: Scene;
  readonly sim: Simulation;
  /** Выбранная (Shift+щелчком) деталь, провод или дорожка. */
  readonly selected?: string;
  readonly defaults: { wireColor: string; wireShape: WireShape; pcbSize: string };
  /** Занятые отверстия: id отверстия → обозначение детали. */
  occupied(): Map<string, string>;
}

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

export function componentPanel(h: PanelHost, c: Component, pinned: boolean): [string, string] {
  const p = part(c);
  const s = h.sim.state(c.id);
  const polar = p.polar(c) && !p.noFlip;
  const pinName = p.pinNames ?? ["анод", "катод"];
  const where =
    c.placement.mode !== "board"
      ? "на столе, на проводах"
      : p.where
        ? p.where(c, c.placement.holes)
        : polar
          ? `${pinName[0]} ${holeLabel(c.placement.holes[0])}, ${pinName[1]} ${holeLabel(c.placement.holes[1])}`
          : c.placement.holes.map(holeLabel).join(" ↔ ");
  const { title, body, editor = "" } = p.panel(c, h.sim);
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
    ${statusPill(h, c)}
    ${p.readout?.(c, h.sim) ?? readout(h.sim.voltage(c), h.sim.current(c), h.sim.power(c))}
    ${powerMeter(h, c)}
    <div class="kv"><span>Где</span><span>${where}</span></div>
    ${actualRows(h, c)}
    ${body}
    ${pinned ? editor : ""}
    ${actions}`;
  return [`c:${c.id}`, html];
}

export function statusPill(h: PanelHost, c: Component): string {
  const p = part(c);
  const s = h.sim.state(c.id);
  if (s.burned) return pill("bad", p.burnedWord ?? "СГОРЕЛ");
  if (h.sim.isShorted(c)) return pill("bad", "КОРОТКОЕ ЗАМЫКАНИЕ");
  if (p.reversedPill && h.sim.isReversed(c)) return p.reversedPill;
  const k = h.sim.overload(c);
  const t = heatThreshold(c);
  if (t && k > t) return pill("bad", `ПЕРЕГРУЗКА ×${k.toFixed(1).replace(".", ",")}`);
  if (t && k > t * 0.7) return pill("warn", p.warmWord?.(k) ?? "ГРЕЕТСЯ");
  return p.status?.(c, h.sim) ?? pill("ok", "НОРМА");
}

export function powerMeter(h: PanelHost, c: Component): string {
  const load = h.sim.load(c);
  if (!load) return "";
  const k = load.ratio;
  const t = heatThreshold(c);
  const cls = k > t ? "bad" : k > t * 0.7 && !part(c).nearLimitOk ? "warn" : "";
  const what = load.what[0].toUpperCase() + load.what.slice(1);
  return `<div class="kv"><span>${what} / предел ${load.limit}</span><span>${Math.round(k * 100)} %</span></div>
    <div class="meter ${cls}"><i style="width:${Math.min(100, k * 100)}%"></i></div>`;
}

/** Строки «Фактически» для панели детали; пусто, если режим допусков выключен. */
export function actualRows(h: PanelHost, c: Component): string {
  const t = h.sim.tolerance;
  return t.enabled ? (part(c).actual?.(c, t) ?? "") : "";
}

export function wirePanel(h: PanelHost, id: string): [string, string] {
  const w = h.scene.wires.find((x) => x.id === id)!;
  const b = h.sim.branch(id);
  const name = (e: Endpoint) => ("hole" in e ? holeLabel(e.hole) : `вывод ${e.pin + 1} детали ${e.comp}`);
  const sameBoard = isFlatWire({ ...w, shape: "flat" });
  const shapeRow = sameBoard
    ? `<div class="field"><label>Какой провод</label>${shapeButtons(w.shape ?? "arc")}</div>`
    : `<p class="sub">Концы не на одной плате — такой провод идёт только дугой.</p>`;
  const html = `<div class="eyebrow"><span class="ref">${id}</span> · провод</div>
    <h2>${isFlatWire(w) ? "Прямая перемычка" : "Провод"}</h2>
    ${readout(Math.abs(b.voltage), Math.abs(b.current), b.power)}
    <div class="kv"><span>От</span><span>${name(w.a)}</span></div>
    <div class="kv"><span>До</span><span>${name(w.b)}</span></div>
    <div class="field"><label>Цвет</label>${swatches(w.color, false)}</div>
    ${shapeRow}
    <div class="kv"><span>Сопротивление</span><span>${formatOhms(wireResistance(h.scene, w))}</span></div>
    <p class="sub">Медь 22 AWG, ≈ 53 мОм на метр — сопротивление зависит от длины провода. Светлые точки показывают направление тока (от плюса к минусу), скорость — его силу.</p>
    ${h.selected === id ? `<div class="row"><button class="btn inline danger" data-act="delete" id="btn-delete">Удалить</button></div>` : ""}`;
  return [`w:${id}`, html];
}

export function tracePanel(h: PanelHost, id: string): [string, string] {
  const t = (h.scene.traces ?? []).find((x) => x.id === id)!;
  const b = h.sim.branch(id);
  const a = HOLE_BY_ID.get(t.a)!;
  const c = HOLE_BY_ID.get(t.b)!;
  const lengthMm = Math.hypot(a.x - c.x, a.z - c.z) * 2.54;
  const html = `<div class="eyebrow"><span class="ref">${id}</span> · дорожка</div>
    <h2>Медная дорожка</h2>
    ${readout(Math.abs(b.voltage), Math.abs(b.current), b.power)}
    <div class="kv"><span>От</span><span>${holeLabel(t.a)}</span></div>
    <div class="kv"><span>До</span><span>${holeLabel(t.b)}</span></div>
    <div class="kv"><span>Длина</span><span>${String(lengthMm.toFixed(1)).replace(".", ",")} мм</span></div>
    <div class="kv"><span>Сопротивление</span><span>${formatOhms(traceResistance(t.a, t.b))}</span></div>
    <p class="sub">Медь 35 мкм, ширина с площадку — 1,8 мм: ≈ 0,27 мОм на миллиметр. Чтобы набрать хотя бы 1 Ом, понадобилось бы ≈ 3,7 м такой дорожки.</p>
    <div class="row"><button class="btn inline danger" data-act="delete" id="btn-delete">Удалить</button></div>`;
  return [`t:${id}`, html];
}

export function wireToolPanel(h: PanelHost): [string, string] {
  const cur = h.defaults.wireColor;
  const name = cur === "auto" ? "авто" : (WIRE_PALETTE.find((x) => x.hex === cur)?.name ?? "");
  const html = `<div class="eyebrow">новый провод</div><h2>Провод</h2>
    <div class="field"><label>Какой провод</label>${shapeButtons(h.defaults.wireShape)}</div>
    <p class="sub">${
      h.defaults.wireShape === "flat"
        ? "Прямая перемычка лежит на плате, концы загнуты в отверстия — аккуратно и не мешает. Работает, если оба конца на одной плате; к детали на столе или на другую плату провод всё равно пойдёт дугой."
        : "Гибкий провод идёт дугой — дотянется куда угодно: к детали на столе, на другую плату."
    }</p>
    <div class="field"><label>Цвет: ${name}</label>${swatches(cur, true)}</div>
    <p class="sub">Принято: <b>красный — плюс</b>, <b>чёрный или синий — минус</b>. «Авто» красит так сам, если провод идёт к батарее или шине, остальные — по очереди. Цвет готового провода меняется, если нажать на него в режиме «Выбор».</p>`;
  return [`wt`, html];
}

export function holePanel(h: PanelHost, hole: Hole): [string, string] {
  const v = h.sim.solution.voltage.get(hole.node);
  const occ = h.occupied().get(hole.id);
  const html = `<div class="eyebrow">отверстие</div>
    <h2>${holeLabel(hole.id)}</h2>
    <div class="kv"><span>Соединено с</span><span>${describeNode(hole.node)}</span></div>
    <div class="kv"><span>Потенциал</span><span>${v === undefined ? "не подключено" : formatSI(v, "В")}</span></div>
    <div class="kv"><span>Занято</span><span>${occ ?? "свободно"}</span></div>
    <p class="sub">Подсвечены все отверстия, соединённые с этим внутри платы. Esc — закрыть.</p>
    ${boardById(hole.boardId) ? boardSection(boardById(hole.boardId)!) : ""}`;
  return [`h:${hole.id}`, html];
}

export function boardToolPanel(h: PanelHost, kind: BoardSpec["kind"]): [string, string] {
  const html =
    kind === "breadboard"
      ? `<div class="eyebrow">новая плата</div><h2>Макетка</h2>
    <p>400 точек: 30 столбцов по 5 соединённых отверстий и по две шины питания сверху и снизу.</p>
    <p class="sub">Нажмите на свободное место на столе. Макетки между собой не соединены — как настоящие: соединяйте проводом.</p>`
      : `<div class="eyebrow">новая плата</div><h2>Печатная плата</h2>
    ${selectField("pcbSize", "Размер", PCB_SIZES.map(([c, r]) => [`${c}x${r}`, `${c} × ${r} площадок (${Math.round((c + 3) * 2.54)} × ${Math.round((r + 3) * 2.54)} мм)`]), h.defaults.pcbSize)}
    <p class="sub">Нажмите на свободное место на столе. Площадки ни с чем не соединены — соединяйте медными дорожками (T).</p>`;
  return [`bt:${kind}`, html];
}

export function overviewPanel(h: PanelHost): [string, string] {
  const rows: string[] = [];
  for (const c of h.scene.components) {
    const s = h.sim.state(c.id);
    const t = heatThreshold(c);
    const flag = s.burned
      ? " — вышел из строя"
      : h.sim.isShorted(c)
        ? " — КЗ"
        : h.sim.isReversed(c)
          ? " — наоборот"
          : t && h.sim.overload(c) > t
            ? " — перегрузка"
            : "";
    rows.push(`<li><span><span class="ref">${c.id}</span> ${part(c).label(c)}${flag}</span><span>${formatSI(Math.abs(h.sim.current(c)), "А")}</span></li>`);
  }
  const html = `<div class="eyebrow">схема</div>
    <h2>${h.scene.components.length ? "Токи через детали" : "Стол пуст"}</h2>
    ${rows.length ? `<ul class="list">${rows.join("")}</ul>` : BOARDS.length
          ? `<p>Начните с батареи (9), затем добавьте резистор (3) и светодиод (6). Или выберите пример вверху.</p>`
          : `<p>На столе пусто. Положите макетку (B) или печатную плату (V), потом батарею (9), резистор (3) и светодиод (6). Или выберите пример вверху.</p>`}
    <div class="help">
      <b>Как устроена макетка.</b> Пять отверстий столбца (a–e или f–j) соединены внутри. Шины + и − вдоль краёв соединены по всей длине. Наведите курсор на отверстие — подсветятся все, что с ним соединены.
    </div>
    <div class="help">
      <b>Допуски.</b> ${
        h.sim.tolerance.enabled
          ? "Включены: у каждой детали параметры немного отличаются от номинала, как у настоящих. Значения видны в панели детали."
          : "Выключены: все детали точно по номиналу. Кнопка «Допуски» вверху включает разброс, как у настоящих деталей."
      }
    </div>
    <div class="help">
      <b>Управление.</b> <b>Shift+нажатие</b> на деталь, провод или дорожку (на телефоне — долгое нажатие) — здесь появятся ток, напряжение и настройки. Обычное нажатие выделяет: Del — удалить, R — повернуть, F — перевернуть; тумблер от нажатия переключается. Детали можно перетаскивать мышью — и на столе, и по плате. Нажатие на отверстие показывает, с чем оно соединено. Вращать вид — зажать и тянуть, приближать — колесом.
    </div>`;
  return [`o`, html];
}

export function traceToolPanel(): [string, string] {
  const html = `<div class="eyebrow">печатная плата</div><h2>Дорожка</h2>
    <p class="sub">На печатной плате площадки <b>ничем не соединены</b> — в отличие от макетки. Соединения рисуются медными дорожками: площадка → площадка → … Esc — закончить.</p>
    <p class="sub">Детали ставятся на площадки так же, как в макетку, и припаиваются. Провода можно вести от площадок к батарее, блоку питания или макетке.</p>`;
  return [`tt`, html];
}

/** Раздел панели о плате: название, размер, что можно сделать. */
export function boardSection(b: BoardSpec): string {
  const size = boardSize(b);
  const mmSize = `${Math.round(size.width * 2.54)} × ${Math.round(size.depth * 2.54)} мм`;
  const sizeRow =
    b.kind === "pcb"
      ? selectField("boardSize", "Размер", PCB_SIZES.map(([c, r]) => [`${c}x${r}`, `${c} × ${r} площадок (${Math.round((c + 3) * 2.54)} × ${Math.round((r + 3) * 2.54)} мм)`]), `${b.cols}x${b.rows}`)
      : `<div class="kv"><span>Размер</span><span>400 точек, ${mmSize}</span></div>`;
  return `<div class="board-section">
    <div class="eyebrow">плата</div>
    <h3>${boardName(b)[0].toUpperCase()}${boardName(b).slice(1)}</h3>
    ${sizeRow}
    <p class="sub">Чтобы передвинуть, тащите плату мышью — детали, провода и дорожки поедут вместе с ней.</p>
    <div class="row"><button class="btn inline danger" data-board-act="remove">Убрать плату</button></div>
  </div>`;
}

export function boardPanel(b: BoardSpec): [string, string] {
  return [`b:${b.id}`, boardSection(b)];
}

/** Кружки цветов; auto — с вариантом «Авто». */
export function swatches(current: string, auto: boolean): string {
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
export function shapeButtons(current: WireShape): string {
  const b = (shape: WireShape, text: string) =>
    `<button class="btn inline" data-shape="${shape}" aria-pressed="${current === shape}">${text}</button>`;
  return `<div class="row">${b("flat", "Прямая перемычка")}${b("arc", "Гибкий, дугой")}</div>`;
}
