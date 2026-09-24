/** Инструменты: встроенные и установки деталей (из реестра src/parts), горячие клавиши встроенных, кнопки. */

import type { Component } from "../model/types";
import { PARTS, type ToolDef } from "../parts";

/** Инструмент: встроенный (выбор, провод, дорожка, платы, удаление) или установка детали (id из PartDef.tools). */
export type Tool = "select" | "wire" | "trace" | "bb" | "pcb" | "delete" | PlaceTool;
export type PlaceTool = string;

/** Инструменты установки деталей из реестра: id → тип детали и описание инструмента. Список меняется (микросхемы библиотеки). */
export function placeTools(): Map<PlaceTool, { type: Component["type"]; def: ToolDef }> {
  return new Map(Object.values(PARTS).flatMap((p) => p.tools.map((t) => [t.id, { type: p.type, def: t as ToolDef }] as const)));
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
    if (!def.group) continue;
    const body = tools.querySelector(`details[data-group="${def.group}"] .group-body`);
    body?.insertAdjacentHTML(
      "beforeend",
      `<button class="tool" data-tool="${def.id}" data-part-tool aria-pressed="false" title="${def.title.replace(/"/g, "&quot;")}">
        <svg viewBox="0 0 30 18">${def.icon}</svg>${def.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}
      </button>`,
    );
  }
}
