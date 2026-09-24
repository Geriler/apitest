/**
 * Где искать описание микросхемы: библиотека браузера (её заполняет приложение) и копии в самой
 * схеме (Scene.chips — так файл проекта самодостаточен). Если описание есть и там, и там, берётся
 * более новое. Без DOM и хранилища — годится и для расчёта, и для тестов.
 */

import type { ChipDef, Scene } from "../model/types";

const library = new Map<string, ChipDef>();

/** Заменить содержимое библиотеки (приложение — при загрузке и после изменений). */
export function setLibrary(defs: Iterable<ChipDef>): void {
  library.clear();
  for (const d of defs) library.set(d.id, d);
}

/** Микросхемы библиотеки, по имени. */
export function libraryChips(): ChipDef[] {
  return [...library.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Эталонные («заводские») компоненты карьеры — в песочнице доступны сразу. */
const reference = new Map<string, ChipDef>();
/** Компоненты, открытые игроком в карьере (его собственные сборки). */
const career = new Map<string, ChipDef>();

export function setReference(defs: Iterable<ChipDef>): void {
  reference.clear();
  for (const d of defs) reference.set(d.id, d);
}

export function setCareerChips(defs: Iterable<ChipDef>): void {
  career.clear();
  for (const d of defs) career.set(d.id, d);
}

/** Какие микросхемы показывать кнопками (песочница — заводские и свои, карьера — открытые). */
let toolSource: () => ChipDef[] = () => [...referenceList(), ...libraryChips()];
export function setChipToolSource(f: () => ChipDef[]): void {
  toolSource = f;
}
export const toolChips = (): ChipDef[] => toolSource();

/** Эталонные компоненты, по обозначению. */
export function referenceList(): ChipDef[] {
  return [...reference.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Описание микросхемы для схемы scene. */
export function resolveChip(scene: Scene, id: string): ChipDef | undefined {
  const a = library.get(id);
  const b = scene.chips?.[id];
  if (a && b) return a.updatedAt >= b.updatedAt ? a : b;
  return a ?? b ?? career.get(id) ?? reference.get(id);
}

/** Все описания, нужные схеме (с вложенными микросхемами), — чтобы положить их в Scene.chips. */
export function chipsUsed(scene: Scene): Record<string, ChipDef> {
  const out: Record<string, ChipDef> = {};
  const visit = (s: Scene, depth: number) => {
    if (depth > 8) return;
    for (const c of s.components) {
      if (c.type !== "chip" || out[c.def]) continue;
      const d = resolveChip(scene, c.def) ?? resolveChip(s, c.def);
      if (!d) continue;
      out[d.id] = d;
      visit({ components: d.parts, wires: [], chips: d.scene.chips }, depth + 1);
    }
  };
  visit(scene, 0);
  return out;
}
