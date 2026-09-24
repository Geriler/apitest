/** Инструменты: встроенные и установки деталей (из реестра src/parts), горячие клавиши встроенных, кнопки. */

import type { Component } from "../model/types";
import { PARTS, type ToolDef } from "../parts";

/** Инструмент: встроенный (выбор, провод, дорожка, платы, удаление) или установка детали (id из PartDef.tools). */
export type Tool = "select" | "wire" | "trace" | "bb" | "pcb" | "delete" | PlaceTool;
export type PlaceTool = string;

/** Инструменты установки деталей из реестра: id → тип детали и описание инструмента. Список меняется (микросхемы библиотеки). */
export function placeTools(): Map<PlaceTool, { type: Component["type"]; def: ToolDef }> {
  const all = new Map(Object.values(PARTS).flatMap((p) => p.tools.map((t) => [t.id, { type: p.type, def: t as ToolDef }] as const)));
  for (const k of kit) all.set(k.id, { type: k.type as Component["type"], def: k.def });
  return all;
}

/** Инструменты набора уровня карьеры (приложение обновляет их при каждом изменении схемы). */
let kit: { id: string; type: string; def: ToolDef }[] = [];
export function setKitTools(list: typeof kit): void {
  kit = list;
}

/** Какие инструменты показывать (в карьере — только набор и приборы). */
let visible: (tool: string) => boolean = () => true;
export function setToolFilter(f: (tool: string) => boolean): void {
  visible = f;
}
/** Горячие клавиши инструментов (в латинской и в русской раскладке). Детали выбираются только кнопками. */
export const TOOL_KEYS: Record<string, Tool> = {
  "1": "select", "2": "wire",
  t: "trace", T: "trace", "е": "trace", "Е": "trace",
  b: "bb", B: "bb", "и": "bb", "И": "bb", v: "pcb", V: "pcb", "м": "pcb", "М": "pcb",
};

/** Кнопки инструментов деталей — в группы на панели слева, в порядке реестра. */
export function renderToolButtons(tools: HTMLElement): void {
  // Перерисовка (библиотека микросхем поменялась): сначала убрать прежние кнопки деталей
  tools.querySelectorAll(".group-body [data-part-tool]").forEach((b) => b.remove());
  for (const { def } of placeTools().values()) {
    if (!def.group || !visible(def.id)) continue;
    const body = tools.querySelector(`details[data-group="${def.group}"] .group-body`);
    body?.insertAdjacentHTML(
      "beforeend",
      `<button class="tool" data-tool="${def.id}" data-part-tool aria-pressed="false" title="${def.title.replace(/"/g, "&quot;")}">
        <svg viewBox="0 0 30 18">${def.icon}</svg>${def.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}
      </button>`,
    );
  }
  // Встроенные инструменты (выбор, провод, платы…) — тоже по фильтру
  tools.querySelectorAll<HTMLElement>(".tool[data-tool]:not([data-part-tool])").forEach((b) => (b.hidden = !visible(b.dataset.tool!)));
  // Пустую группу не показываем (например, «Микросхемы», пока своих нет)
  tools.querySelectorAll<HTMLElement>("details[data-group]").forEach((g) => (g.hidden = !g.querySelector(".group-body [data-tool]")));
}
