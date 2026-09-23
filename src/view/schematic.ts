/**
 * Принципиальная схема, построенная по сборке. Без Three.js и DOM: на выходе строка SVG.
 *
 * Цепь — всё, что соединено между собой: полоса макетки, провода, дорожки. На чертеже цепь —
 * горизонтальная линия; линии идут сверху вниз по убыванию потенциала (сверху плюс питания,
 * снизу минус), детали стоят вертикально между линиями своих выводов. Обозначения — по ЕСКД
 * (ГОСТ 2.728, 2.730): резистор — прямоугольник, лампа — круг с крестом и т. д.
 * Пересечение линий без точки — не соединение, точка — соединение.
 */

import { HOLE_BY_ID } from "../model/breadboard";
import {
  MOSFETS,
  TRANSISTORS,
  mosfetPin,
  type Component,
  type Mosfet,
  type Pin,
  type Scene,
  type SchematicLayout,
  type Transistor,
} from "../model/types";
import { formatSI } from "../sim/resistorCodes";
import { endpointNode, pinNode, type Simulation } from "../sim/simulation";
import { part } from "../parts";

export interface Netlist {
  /** Узлы расчёта в каждой цепи (только цепи, к которым подключены детали). */
  nets: string[][];
  /** Деталь → номер цепи для каждого вывода. */
  pins: Map<string, number[]>;
}

/** Цепи сборки: узлы, соединённые проводами и дорожками, сливаются в одну цепь. */
export function buildNetlist(scene: Scene): Netlist {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    if (!parent.has(a)) parent.set(a, a);
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let x = a; x !== r; ) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const pinNodes = new Map<string, string[]>();
  for (const c of scene.components) {
    const nodes = Array.from({ length: part(c).pins }, (_, p) => pinNode(c, p as Pin));
    nodes.forEach(find);
    pinNodes.set(c.id, nodes);
  }
  for (const w of scene.wires) union(endpointNode(scene, w.a), endpointNode(scene, w.b));
  for (const t of scene.traces ?? []) {
    const a = HOLE_BY_ID.get(t.a);
    const b = HOLE_BY_ID.get(t.b);
    if (a && b) union(a.node, b.node);
  }
  const index = new Map<string, number>();
  const nets: string[][] = [];
  const pins = new Map<string, number[]>();
  for (const c of scene.components) {
    pins.set(
      c.id,
      pinNodes.get(c.id)!.map((n) => {
        const root = find(n);
        if (!index.has(root)) {
          index.set(root, nets.length);
          nets.push([]);
        }
        return index.get(root)!;
      }),
    );
  }
  for (const n of parent.keys()) {
    const i = index.get(find(n));
    if (i !== undefined) nets[i].push(n);
  }
  return { nets, pins };
}

const ROW = 92;
const COL = 112;
const LEFT = 78;
const TOP = 34;
/** Половина длины обозначения двухвыводной детали. */
const HALF = 20;

const num = (v: number) => String(Math.round(v * 10) / 10);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Потенциал цепи: до сотых вольта, «−0,00» не бывает. */
function formatVolts(v: number): string {
  const t = (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace(".", ",").replace("-", "−");
  return `${t} В`;
}

const isSource = (c: Component) => c.type === "battery" || c.type === "psu";

/**
 * Порядок цепей сверху вниз — только по соединениям, не по напряжениям, чтобы чертёж не
 * перестраивался, когда щёлкают тумблером: сверху плюс источников, снизу минус, между ними —
 * по числу деталей от плюса (ближе к плюсу — выше). Цепи, до которых от плюса не дойти, — перед минусом.
 */
function netOrder(scene: Scene, count: number, pins: Map<string, number[]>): number[] {
  const plus = new Set<number>();
  const minus = new Set<number>();
  for (const c of scene.components) {
    if (!isSource(c)) continue;
    plus.add(pins.get(c.id)![1]);
    minus.add(pins.get(c.id)![0]);
  }
  const adj = new Map<number, Set<number>>();
  for (const c of scene.components) {
    if (isSource(c)) continue;
    const ns = pins.get(c.id)!;
    for (const a of ns) for (const b of ns) if (a !== b) (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  }
  // Без источников — от цепи первой детали
  const start = plus.size ? [...plus] : count ? [0] : [];
  const dist = new Map<number, number>(start.map((n) => [n, 0]));
  const queue = [...start];
  while (queue.length) {
    const n = queue.shift()!;
    if (minus.has(n) && !plus.has(n)) continue; // через минус дальше не идём
    for (const m of adj.get(n) ?? []) {
      if (!dist.has(m)) {
        dist.set(m, dist.get(n)! + 1);
        queue.push(m);
      }
    }
  }
  const group = (n: number) => (plus.has(n) ? 0 : minus.has(n) ? 3 : dist.has(n) ? 1 : 2);
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => group(a) - group(b) || (dist.get(a) ?? 0) - (dist.get(b) ?? 0) || a - b);
}

/** Устойчивое имя цепи для ручной раскладки: первый по алфавиту вывод на ней («R1.0»). */
function netKeys(scene: Scene, count: number, pins: Map<string, number[]>): string[] {
  const names: string[][] = Array.from({ length: count }, () => []);
  for (const c of scene.components) pins.get(c.id)!.forEach((n, p) => names[n].push(`${c.id}.${p}`));
  return names.map((list) => list.sort()[0] ?? "");
}

interface Placed {
  c: Component;
  x: number;
  /** Точки подключения к цепям: [номер цепи, x]. */
  attach: [number, number][];
  svg: string;
  /** Нижний край (для высоты чертежа). */
  bottom: number;
}

/**
 * Схема сборки строкой SVG. highlight — деталь, выделенная сейчас (обводится медным цветом).
 * Пустая строка, если деталей нет.
 */
export function schematicSvg(scene: Scene, sim: Simulation, highlight?: string, layout: SchematicLayout = scene.schematic ?? {}): string {
  if (!scene.components.length) return "";
  const { nets, pins } = buildNetlist(scene);
  // Потенциал цепи — первое известное значение среди её узлов
  const volts = nets.map((nodes) => {
    for (const n of nodes) {
      const v = sim.solution?.voltage.get(n);
      if (v !== undefined) return v;
    }
    return undefined;
  });
  const order = netOrder(scene, nets.length, pins);
  const row = new Map(order.map((net, r) => [net, r]));
  const keys = netKeys(scene, nets.length, pins);
  const Y = (net: number) => layout.y?.[keys[net]] ?? TOP + row.get(net)! * ROW;

  // Сначала источники, потом остальное — по верхней и нижней цепи
  const rank = (c: Component) => (c.type === "battery" || c.type === "psu" ? 0 : 1);
  const span = (c: Component) => pins.get(c.id)!.map((n) => row.get(n)!);
  const parts = [...scene.components].sort(
    (a, b) => rank(a) - rank(b) || Math.min(...span(a)) - Math.min(...span(b)) || Math.max(...span(a)) - Math.max(...span(b)),
  );

  const placed: Placed[] = [];
  let x = LEFT;
  for (const c of parts) {
    const netOf = pins.get(c.id)!;
    const auto = part(c).pins === 2 ? x : x + COL * 0.4;
    // Ручной сдвиг детали по горизонтали: остальные остаются на своих местах
    const px = layout.x?.[c.id] ?? auto;
    const current = Math.abs(c.type === "transistor" ? sim.transistor(c).ic : c.type === "mosfet" ? sim.mosfet(c).id : sim.current(c));
    const label = (lx: number, ly: number) =>
      `<text x="${num(lx)}" y="${num(ly - 6)}" class="ref">${esc(c.id)}</text><text x="${num(lx)}" y="${num(ly + 7)}">${esc(part(c).value(c))}</text>` +
      `<text x="${num(lx)}" y="${num(ly + 20)}" class="sub">${current > 1e-9 ? formatSI(current, "А") : "0 А"}</text>`;
    if (part(c).pins === 2) {
      const [ya, yb] = [Y(netOf[0]), Y(netOf[1])];
      let top = Math.min(ya, yb);
      let bottom = Math.max(ya, yb);
      let extra = "";
      const attach: [number, number][] = [
        [netOf[0], px],
        [netOf[1], px],
      ];
      if (ya === yb) {
        // Оба вывода в одной цепи: деталь висит петлёй под линией
        bottom = top + ROW * 0.7;
        extra = `<path d="M${px} ${num(bottom)}H${px + 24}V${num(top)}"/>`;
        attach[1] = [netOf[1], px + 24];
      }
      const yc = (top + bottom) / 2;
      const flip = ya > yb ? -1 : 1; // вывод 0 внизу — переворачиваем обозначение
      const svg =
        // Невидимая область щелчка: обозначение и подпись
        `<rect class="hit" x="${num(px - 16)}" y="${num(yc - 26)}" width="96" height="52"/>` +
        `<path d="M${num(px)} ${num(top)}V${num(yc - HALF)}M${num(px)} ${num(yc + HALF)}V${num(bottom)}"/>${extra}` +
        `<g transform="translate(${num(px)} ${num(yc)}) scale(1 ${flip})">${part(c).symbol?.(c) ?? ""}</g>` +
        label(px + 18, yc);
      placed.push({ c, x: px, attach, svg, bottom });
      x += COL;
    } else {
      // Транзистор: основной путь (К–Э или С–И) вертикально, управляющий вывод — слева
      const t = c as Transistor | Mosfet;
      x += COL * 0.4;
      const tx = px;
      const roles =
        t.type === "transistor"
          ? { up: 0 as Pin, ctrl: 1 as Pin, down: 2 as Pin }
          : { up: mosfetPin(t.kind, "D"), ctrl: mosfetPin(t.kind, "G"), down: mosfetPin(t.kind, "S") };
      const yUp = Y(netOf[roles.up]);
      const yDown = Y(netOf[roles.down]);
      const swap = yUp > yDown; // коллектор (сток) ниже эмиттера (истока) — рисуем перевёрнутым
      let top = Math.min(yUp, yDown);
      let bottom = Math.max(yUp, yDown);
      let extra = "";
      const lx = tx + 8;
      const attach: [number, number][] = [
        [netOf[roles.up], lx],
        [netOf[roles.down], lx],
        [netOf[roles.ctrl], tx - 30],
      ];
      if (yUp === yDown) {
        bottom = top + ROW * 0.8;
        extra = `<path d="M${num(lx)} ${num(bottom)}H${num(lx + 22)}V${num(top)}"/>`;
        attach[1] = [netOf[roles.down], lx + 22];
      }
      const yc = (top + bottom) / 2;
      const yCtrl = Y(netOf[roles.ctrl]);
      let body: string;
      if (t.type === "transistor") {
        const npn = TRANSISTORS[t.kind].polarity === "npn";
        // Эмиттер внизу (в своей системе); стрелка у n-p-n — от базы, у p-n-p — к базе
        const arrow = npn ? `<path d="M8 13L1.2 11.8L4.2 7.6Z" class="fill"/>` : `<path d="M-6 6L0.4 5.6L-2.6 10.4Z" class="fill"/>`;
        body = `<circle r="17"/><path d="M-6 -11V11" class="thick"/><path d="M-6 -5L8 -13V-17M-6 5L8 13V17"/>${arrow}`;
      } else {
        const n = MOSFETS[t.kind].channel === "n";
        const arrow = n ? `<path d="M-4 0L2 -3V3Z" class="fill"/>` : `<path d="M8 0L2 -3V3Z" class="fill"/>`;
        body =
          `<circle r="17"/><path d="M-9 -10V10" /><path d="M-4 -11V-5M-4 -3V3M-4 5V11" class="thick"/>` +
          `<path d="M-4 -8H8V-17M-4 8H8V17M-4 0H8V8"/>${arrow}`;
      }
      // Управляющий вывод: от затвора / базы влево и к своей цепи
      const gx = t.type === "transistor" ? -6 : -9;
      const svg =
        `<rect class="hit" x="${num(tx - 22)}" y="${num(yc - 34)}" width="110" height="56"/>` +
        `<path d="M${num(lx)} ${num(top)}V${num(yc - 17)}M${num(lx)} ${num(yc + 17)}V${num(bottom)}"/>${extra}` +
        `<path d="M${num(tx + gx)} ${num(yc)}H${num(tx - 30)}V${num(yCtrl)}"/>` +
        `<g transform="translate(${num(tx)} ${num(yc)}) scale(1 ${swap ? -1 : 1})">${body}</g>` +
        label(tx + 24, yc - 20);
      placed.push({ c, x: tx, attach, svg, bottom: Math.max(bottom, yCtrl) });
      x += COL * 1.1;
    }
  }

  // Линии цепей: от крайней левой до крайней правой точки подключения; точки — в T-соединениях.
  // Подпись потенциала — над линией у левого края; широкая невидимая полоса — чтобы линию было легко взять мышью.
  const netsSvg: string[] = [];
  for (const [net] of row) {
    const xs = placed.flatMap((p) => p.attach.filter(([n]) => n === net).map(([, ax]) => ax));
    if (!xs.length) continue;
    const y = num(Y(net));
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const [a, b] = min === max ? [min - 10, max + 10] : [min, max];
    const dots = [...new Set(xs)]
      .filter((ax) => ax > min && ax < max)
      .map((ax) => `<circle cx="${num(ax)}" cy="${y}" r="2.6" class="dot"/>`)
      .join("");
    const v = volts[net];
    netsSvg.push(
      `<g class="net" data-net="${esc(keys[net])}" data-y="${y}">` +
        `<path class="nethit" d="M${num(a)} ${y}H${num(b)}"/><path d="M${num(a)} ${y}H${num(b)}"/>${dots}` +
        `<text x="${num(a + 4)}" y="${num(Number(y) - 5)}" class="volt">${v === undefined ? "—" : formatVolts(v)}</text></g>`,
    );
  }

  const width = Math.max(x, ...placed.map((p) => p.x + 60)) + 110;
  const height = Math.max(...placed.map((p) => p.bottom), ...order.map((n) => Y(n))) + 40;
  const partsSvg = placed
    .map((p) => `<g class="part${p.c.id === highlight ? " sel" : ""}" data-part="${esc(p.c.id)}" data-x="${num(p.x)}">${p.svg}</g>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="sch" viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" role="img" aria-label="Принципиальная схема">` +
    `<g class="nets">${netsSvg.join("")}</g>${partsSvg}</svg>`
  );
}
