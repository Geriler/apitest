/**
 * Упаковка схемы в микросхему: площадки корпуса (деталь «Корпус») становятся выводами, остальные
 * детали — начинкой. Соединения (полосы макетки, провода, дорожки) сворачиваются в список цепей, поэтому
 * начинка не зависит от плат и считается одинаково в любом месте.
 */

import type { ChipCase, ChipDef, Component, Scene } from "../model/types";
import { part } from "../parts";
import { buildNetlist } from "../view/schematic";
import { chipsUsed } from "./registry";

/** Больше выводов в DIP пока не бывает. */
export const MAX_CHIP_PINS = 16;

/** Не входят в микросхему: это обвязка для проверки (питание и приборы). */
export function excludedFromChip(c: Component): boolean {
  return !!part(c).source || c.type === "meter" || c.type === "scope";
}

/** Вместимость корпуса, клеток: 2 на вывод (DIP-4 — 8, DIP-16 — 32). */
export const spaceOf = (pins: number) => 2 * pins;

/** Сколько места займёт начинка этой схемы, клеток. */
export function spaceUsed(scene: Scene): number {
  return scene.components.filter((c) => !excludedFromChip(c)).reduce((sum, c) => sum + (part(c).chipSpace?.(c, scene) ?? 1), 0);
}

/** Корпус схемы (первый, если их почему-то несколько). */
export function caseOf(scene: Scene): ChipCase | undefined {
  return scene.components.find((c): c is ChipCase => c.type === "chipcase");
}

/** Сколько выводов будет у микросхемы (0 — корпуса нет). */
export function dipSize(scene: Scene): number {
  return caseOf(scene)?.pins ?? 0;
}

/** Что мешает упаковать: пусто — можно. */
export function packageProblems(scene: Scene): string[] {
  const box = caseOf(scene);
  const out: string[] = [];
  if (!box) return ["Нет корпуса: поставьте «Корпус» (группа «Микросхемы» слева) и подведите провода к его площадкам."];
  const cases = scene.components.filter((c) => c.type === "chipcase");
  if (cases.length > 1) out.push(`Корпус должен быть один, а их ${cases.length}: ${cases.map((c) => c.id).join(", ")}.`);
  if (box.pins > MAX_CHIP_PINS) out.push(`Выводов — не больше ${MAX_CHIP_PINS}.`);
  const inner = scene.components.filter((c) => c.type !== "chipcase" && !excludedFromChip(c));
  if (!inner.length) out.push("Внутри нет ни одной детали.");
  if (!box.roles.some((r) => r !== "nc")) out.push("Ни одному выводу не назначено, для чего он: откройте панель корпуса.");
  // Площадка не подключена по назначению, но к ней что-то подведено — так не бывает
  const { pins } = buildNetlist(scene);
  const used = new Set(inner.flatMap((c) => pins.get(c.id) ?? []));
  const wiredNc = box.roles.map((r, i) => (r === "nc" && used.has(pins.get(box.id)![i]) ? i + 1 : 0)).filter(Boolean);
  if (wiredNc.length) out.push(`${wiredNc.length > 1 ? "Выводы" : "Вывод"} ${wiredNc.join(", ")} подключен${wiredNc.length > 1 ? "ы" : ""} к схеме, но назначен${wiredNc.length > 1 ? "ы" : ""} «не подключён»: выберите, для чего ${wiredNc.length > 1 ? "они" : "он"}.`);
  for (const c of scene.components) {
    if (excludedFromChip(c)) continue;
    const why = part(c).notInChip?.(c);
    if (why) out.push(`${c.id} не может быть внутри: ${why}.`);
  }
  const space = spaceUsed(scene);
  const room = spaceOf(box.pins);
  if (space > room) {
    out.push(`Не помещается в DIP-${box.pins}: начинка занимает ${space} клеток из ${room}. Уберите детали или возьмите корпус больше.`);
  }
  return out;
}

/** Упаковать схему. id — обновить существующую микросхему (число выводов должно совпасть). */
export function packageChip(scene: Scene, name: string, id: string = newChipId(), now = Date.now()): ChipDef {
  const { pins } = buildNetlist(scene);
  const box = caseOf(scene)!;
  const inner = scene.components.filter((c) => c.type !== "chipcase" && !excludedFromChip(c));
  const nets = new Map<number, { members: [string, number][]; pins: number[] }>();
  const net = (i: number) => {
    let n = nets.get(i);
    if (!n) nets.set(i, (n = { members: [], pins: [] }));
    return n;
  };
  for (const c of inner) pins.get(c.id)!.forEach((i, p) => net(i).members.push([c.id, p]));
  // Неподключённые площадки наружу не выходят
  box.roles.forEach((r, i) => r !== "nc" && net(pins.get(box.id)![i]).pins.push(i + 1));
  const pinNames = box.roles.map((r, i) => (r === "nc" ? "NC" : box.names[i]?.trim() ?? ""));
  const pinRoles = [...box.roles];
  const source: Scene = JSON.parse(JSON.stringify({ ...scene, editingChip: undefined }));
  source.chips = chipsUsed(scene);
  return {
    id,
    name: name.trim() || "Микросхема",
    package: "DIP",
    pins: box.pins,
    space: spaceUsed(scene),
    pinNames,
    pinRoles,
    parts: inner.map((c) => ({ ...JSON.parse(JSON.stringify(c)), placement: { mode: "free", x: 0, z: 0, rot: 0 } }) as Component),
    nets: [...nets.values()].filter((n) => n.members.length + n.pins.length > 1 || n.pins.length).map((n) => (n.pins.length ? n : { members: n.members })),
    scene: source,
    updatedAt: now,
  };
}

export function newChipId(): string {
  return `chip-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
