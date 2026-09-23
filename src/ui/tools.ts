/** Инструменты: встроенные и установки деталей (из реестра src/parts), горячие клавиши, кнопки. */

import type { Component } from "../model/types";
import { PARTS, type ToolDef } from "../parts";

/** Инструмент: встроенный (выбор, провод, дорожка, платы, удаление) или установка детали (id из PartDef.tools). */
export type Tool = "select" | "wire" | "trace" | "bb" | "pcb" | "delete" | PlaceTool;
export type PlaceTool = string;

/** Инструменты установки деталей из реестра: id → тип детали и описание инструмента. */
export const PLACE_TOOLS = new Map<PlaceTool, { type: Component["type"]; def: ToolDef }>(
  Object.values(PARTS).flatMap((p) => p.tools.map((t) => [t.id, { type: p.type, def: t as ToolDef }] as const)),
);
export const TOOL_KEYS: Record<string, Tool> = {
  "1": "select", "2": "wire",
  t: "trace", T: "trace", "е": "trace", "Е": "trace",
  b: "bb", B: "bb", "и": "bb", "И": "bb", v: "pcb", V: "pcb", "м": "pcb", "М": "pcb",
  ...Object.fromEntries([...PLACE_TOOLS.values()].flatMap(({ def }) => def.keys.map((k) => [k, def.id]))),
};

/** Кнопки инструментов деталей — в группы на панели слева, в порядке реестра. */
export function renderToolButtons(tools: HTMLElement): void {
  for (const { def } of PLACE_TOOLS.values()) {
    if (!def.group) continue;
    const body = tools.querySelector(`details[data-group="${def.group}"] .group-body`);
    body?.insertAdjacentHTML(
      "beforeend",
      `<button class="tool" data-tool="${def.id}" aria-pressed="false" title="${def.title}">
        <svg viewBox="0 0 30 18">${def.icon}</svg>${def.label}<kbd>${def.kbd ?? def.keys[0]}</kbd>
      </button>`,
    );
  }
}
