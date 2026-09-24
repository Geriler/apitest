/**
 * Состав схемы или микросхемы: сколько каких деталей внутри, с раскрытием вложенных микросхем —
 * чтобы большую микросхему можно было посчитать «по кусочкам» (сколько в ней транзисторов).
 */

import type { ChipDef, Component, Scene } from "../model/types";
import { part } from "../parts";
import { excludedFromChip } from "./package";
import { resolveChip } from "./registry";

export interface PartCount {
  /** Всего деталей (после раскрытия вложенных микросхем; выводы и обвязка не считаются). */
  total: number;
  /** Из них транзисторов (биполярных и полевых). */
  transistors: number;
  /** По видам: «резистор» → 2, «BS250» → 2… */
  byKind: Map<string, number>;
  /** Свои микросхемы прямо внутри (не раскрытые): имя → сколько. */
  chips: Map<string, number>;
}

/** Состав деталей list (начинка микросхемы или схема на столе). */
export function countParts(list: Component[], scene: Scene): PartCount {
  const out: PartCount = { total: 0, transistors: 0, byKind: new Map(), chips: new Map() };
  const walk = (items: Component[], lookup: Scene, depth: number, top: boolean) => {
    for (const c of items) {
      if (c.type === "chipcase" || excludedFromChip(c)) continue;
      if (c.type === "chip") {
        const def = resolveChip(scene, c.def) ?? resolveChip(lookup, c.def);
        if (top) out.chips.set(def?.name ?? c.name, (out.chips.get(def?.name ?? c.name) ?? 0) + 1);
        if (def && depth < 8) walk(def.parts, def.scene, depth + 1, false);
        continue;
      }
      const k = part(c).countAs?.(c) ?? { name: part(c).label(c) };
      out.total++;
      if (k.transistor) out.transistors++;
      out.byKind.set(k.name, (out.byKind.get(k.name) ?? 0) + 1);
    }
  };
  walk(list, scene, 0, true);
  return out;
}

export function countChip(def: ChipDef, scene: Scene): PartCount {
  return countParts(def.parts, { ...scene, chips: { ...def.scene.chips, ...scene.chips } });
}

/** «1 деталь», «3 детали», «7 деталей». */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  return `${n} ${word}`;
}

/** Коротко: «4 транзистора» или «5 деталей, из них 4 транзистора». */
export function countShort(k: PartCount): string {
  const t = plural(k.transistors, "транзистор", "транзистора", "транзисторов");
  if (!k.total) return "пусто";
  if (k.transistors === k.total) return t;
  const all = plural(k.total, "деталь", "детали", "деталей");
  return k.transistors ? `${all}, из них ${t}` : all;
}

/** Подробно: «2 × BS250, 2 × 2N7000, 1 × резистор». */
export function countDetails(k: PartCount): string {
  return [...k.byKind].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).map(([name, n]) => `${n} × ${name}`).join(", ");
}

/** Из каких своих микросхем собрано: «2 × Мой NAND». */
export function countChips(k: PartCount): string {
  return [...k.chips].map(([name, n]) => `${n} × ${name}`).join(", ");
}
