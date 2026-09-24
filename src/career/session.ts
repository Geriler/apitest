/**
 * Карьера в приложении: что открыто (хранится в браузере), какой уровень сейчас собирают и какие
 * инструменты при этом доступны — только детали набора (с остатком) и приборы для проверки.
 */

import type { ChipDef, Scene } from "../model/types";
import { PARTS, type ToolDef } from "../parts";
import { chipTool } from "../parts/chip";
import { chipFunc, kitUsed, type Metrics } from "./build";
import { FUNC_NAMES, LEVELS, kitLabel, levelById, type KitItem, type Level } from "./levels";
import { lessonById, type Lesson } from "./lessons";

const STORE_KEY = "maketka.career.v1";

interface Progress {
  /** Открытые компоненты: уровень → микросхема, собранная игроком. */
  defs: Record<string, ChipDef>;
  /** Незаконченные столы: уровень (или «workshop») → сцена, как её оставили. */
  slots?: Record<string, Scene>;
  /** Лучшие цифры по уровням — каждая сама по себе (меньше — лучше). */
  best?: Record<string, Metrics>;
  /** Неудачных проверок по уровням и сколько подсказок открыто. */
  fails?: Record<string, number>;
  hints?: Record<string, number>;
  /** Пройденные уроки введения. */
  lessons?: Record<string, boolean>;
}

/** После скольких неудачных проверок можно попросить подсказку. */
export const HINT_AFTER = 2;

function load(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Progress | null;
    if (p && typeof p.defs === "object") return p;
  } catch {
    /* нет сохранённого */
  }
  return { defs: {} };
}

let progress: Progress = load();

/** Открытые игроком микросхемы. */
export const careerDefs = (): ChipDef[] => Object.values(progress.defs);
export const isDone = (id: string) => !!progress.defs[id] || !!progress.lessons?.[id];

/** Урок пройден. */
export function passLesson(id: string): boolean {
  progress = { ...progress, lessons: { ...progress.lessons, [id]: true } };
  return store();
}

function store(): boolean {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

/** Открыть компонент: сохранить собранную микросхему. false — хранилище недоступно. */
export function unlock(def: ChipDef, levelId: string): boolean {
  progress = { ...progress, defs: { ...progress.defs, [levelId]: def } };
  return store();
}

/** Неудачных проверок на уровне и открытых подсказок. */
export const failsOf = (levelId: string) => progress.fails?.[levelId] ?? 0;
export const hintsOf = (levelId: string) => progress.hints?.[levelId] ?? 0;

export function recordFail(levelId: string): void {
  progress = { ...progress, fails: { ...progress.fails, [levelId]: failsOf(levelId) + 1 } };
  store();
}

/** Открыть следующую подсказку (если уже можно). */
export function revealHint(levelId: string, total: number): void {
  if (failsOf(levelId) < HINT_AFTER || hintsOf(levelId) >= total) return;
  progress = { ...progress, hints: { ...progress.hints, [levelId]: hintsOf(levelId) + 1 } };
  store();
}

/** Лучшие цифры уровня. */
export const bestOf = (levelId: string): Metrics | undefined => progress.best?.[levelId];

/** Запомнить цифры сборки; вернуть, какие стали лучше прежних (при первом прохождении — пусто). */
export function recordMetrics(levelId: string, m: Metrics): (keyof Metrics)[] {
  const old = progress.best?.[levelId];
  const area = (x: Metrics) => x.width * x.height;
  const better: (keyof Metrics)[] = [];
  let best: Metrics = m;
  if (old) {
    best = { ...old };
    if (area(m) < area(old)) {
      best.width = m.width;
      best.height = m.height;
      better.push("width");
    }
    for (const k of ["links", "idle", "transistors"] as const) {
      if (m[k] < old[k] * (k === "idle" ? 0.99 : 1)) {
        best[k] = m[k];
        better.push(k);
      }
    }
  }
  progress = { ...progress, best: { ...progress.best, [levelId]: best } };
  store();
  return better;
}

/** Стол уровня или мастерской, как его оставили (слот — id уровня или «workshop»). */
export const loadSlot = (slot: string): Scene | undefined => progress.slots?.[slot];
export function saveSlot(slot: string, scene: Scene): void {
  progress = { ...progress, slots: { ...progress.slots, [slot]: scene } };
  store();
}
export const slotOf = (scene: Scene): string | undefined => (scene.career?.workshop ? "workshop" : (scene.career?.level ?? scene.career?.lesson));

/** Чего не хватает, чтобы взяться за уровень: функции микросхем набора, которые ещё не открыты. */
export function missing(level: Level | Lesson): string[] {
  return level.kit
    .filter((k): k is Extract<KitItem, { part: "chip" }> => k.part === "chip")
    .filter((k) => !careerDefs().some((d) => chipFunc(d.id) === k.func))
    .map((k) => FUNC_NAMES[k.func]);
}

// ─── Текущий уровень ─────────────────────────────────────────────────────────

/** Уровень, который собирают на столе (по сцене). */
export const activeLevel = (scene: Scene): Level | undefined => (scene.career?.level ? levelById(scene.career.level) : undefined);
export const activeLesson = (scene: Scene): Lesson | undefined => (scene.career?.lesson ? lessonById(scene.career.lesson) : undefined);
/** Набор деталей стола: уровня или урока. */
const activeKit = (scene: Scene): KitItem[] | undefined => activeLevel(scene)?.kit ?? activeLesson(scene)?.kit;

/** Приборы и питание — для проверки на столе; в микросхему они не входят. */
const TEST_TOOLS = new Set(["psu", "battery", "meter", "scope", "switch", "button"]);
const BUILTIN = new Set(["select", "wire", "trace", "delete", "bb", "pcb"]);

/** Можно ли пользоваться инструментом в этой сцене. */
export function toolAllowed(scene: Scene, tool: string): boolean {
  // Урок: только провода и набор (приборы уже на столе)
  if (scene.career?.lesson) return ["select", "wire", "delete"].includes(tool) || tool.startsWith("kit:");
  // Песочница и мастерская — все детали (микросхемы — по режиму: заводские или открытые)
  if (!scene.career?.level) return !tool.startsWith("kit:");
  return BUILTIN.has(tool) || TEST_TOOLS.has(tool) || tool.startsWith("kit:");
}

/** Мастерская: свободный стол карьеры — базовые детали и открытые модули. */
export function workshopScene(): Scene {
  return {
    components: [],
    wires: [],
    boards: [
      { id: "BB1", kind: "breadboard", x: 0, z: 0 },
      { id: "PCB1", kind: "pcb", x: 0, z: 21, cols: 24, rows: 14 },
    ],
    career: { workshop: true },
  };
}

/** Базовый инструмент детали набора и её фиксированные настройки. */
function baseTool(k: KitItem): { tool: ToolDef; preset: Record<string, unknown> }[] {
  const find = (id: string) => Object.values(PARTS).flatMap((p) => p.tools as ToolDef[]).find((t) => t.id === id)!;
  if (k.part === "mosfet") return [{ tool: find("fet"), preset: { kind: k.kind } }];
  if (k.part === "bjt") return [{ tool: find("bjt"), preset: { kind: k.kind } }];
  if (k.part === "resistor") return [{ tool: find("tht"), preset: { ohms: k.ohms, watts: 0.25 } }];
  if (k.part === "other") return [{ tool: find(k.tool), preset: k.preset }];
  return careerDefs()
    .filter((d) => chipFunc(d.id) === k.func)
    .map((d) => ({ tool: chipTool(d) as ToolDef, preset: {} }));
}

/**
 * Инструменты набора уровня: по кнопке на деталь (у микросхем — на каждую открытую нужной функции),
 * с остатком в подписи. Настройки не меняются — номинал задан набором.
 */
export function kitTools(scene: Scene): { id: string; type: string; def: ToolDef; row: number; left: number }[] {
  const kit = activeKit(scene);
  if (!kit) return [];
  const used = kitUsed(kit, scene);
  return kit.flatMap((k, row) =>
    baseTool(k).map(({ tool, preset }, j) => {
      const left = k.count - used[row];
      const settings = { ...structuredClone(tool.settings ?? {}), ...preset };
      const label = k.part === "chip" ? tool.label : kitLabel(k);
      const def: ToolDef = {
        ...tool,
        id: `kit:${row}:${j}`,
        group: "kit",
        label: `${label} · ${left > 0 ? `осталось ${left}` : "всё поставлено"}`,
        title: `Из набора: ${kitLabel(k)}, ${k.count} шт.`,
        settings,
        editor: () => "",
        set() {},
        create: () => tool.create(settings),
        note: (s) => `${tool.note(s)}<p class="sub">Из набора уровня: ${kitLabel(k)} — ${k.count} шт., осталось ${left}. Номинал задан набором.</p>`,
      };
      const type = k.part === "mosfet" ? "mosfet" : k.part === "bjt" ? "transistor" : k.part === "resistor" ? "resistor" : k.part === "other" ? k.type : "chip";
      return { id: def.id, type, def, row, left };
    }),
  );
}

export { LEVELS };
