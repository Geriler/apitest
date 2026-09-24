/**
 * Упаковка схемы в микросхему: метки «Вывод» становятся выводами корпуса, остальные детали —
 * начинкой. Соединения (полосы макетки, провода, дорожки) сворачиваются в список цепей, поэтому
 * начинка не зависит от плат и считается одинаково в любом месте.
 */

import type { ChipDef, ChipPin, Component, Scene } from "../model/types";
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

export function chipPins(scene: Scene): ChipPin[] {
  return scene.components.filter((c): c is ChipPin => c.type === "chippin").sort((a, b) => a.number - b.number);
}

/** Сколько выводов будет у корпуса: по наибольшему номеру, чётное, не меньше 4. */
export function dipSize(scene: Scene): number {
  const max = Math.max(0, ...chipPins(scene).map((p) => p.number));
  return Math.max(4, Math.ceil(max / 2) * 2);
}

/** Что мешает упаковать: пусто — можно. */
export function packageProblems(scene: Scene): string[] {
  const pins = chipPins(scene);
  const out: string[] = [];
  if (!pins.length) out.push("Нет ни одного вывода: поставьте детали «Вывод» в точки, которые выйдут наружу.");
  if (dipSize(scene) > MAX_CHIP_PINS) out.push(`Номера выводов — не больше ${MAX_CHIP_PINS}.`);
  const seen = new Map<number, string>();
  for (const p of pins) {
    if (seen.has(p.number)) out.push(`Номер ${p.number} у двух выводов: ${seen.get(p.number)} и ${p.id}.`);
    seen.set(p.number, p.id);
  }
  if (!scene.components.some((c) => c.type !== "chippin" && !excludedFromChip(c))) out.push("Внутри нет ни одной детали.");
  for (const c of scene.components) {
    if (excludedFromChip(c)) continue;
    const why = part(c).notInChip?.(c);
    if (why) out.push(`${c.id} не может быть внутри: ${why}.`);
  }
  const used = spaceUsed(scene);
  const room = spaceOf(dipSize(scene));
  if (used > room) {
    out.push(`Не помещается в DIP-${dipSize(scene)}: начинка занимает ${used} клеток из ${room}. Уберите детали или возьмите корпус больше (выводы с бо́льшими номерами).`);
  }
  return out;
}

/** Упаковать схему. id — обновить существующую микросхему (число выводов должно совпасть). */
export function packageChip(scene: Scene, name: string, id: string = newChipId(), now = Date.now()): ChipDef {
  const { pins } = buildNetlist(scene);
  const inner = scene.components.filter((c) => c.type !== "chippin" && !excludedFromChip(c));
  const nets = new Map<number, { members: [string, number][]; pins: number[] }>();
  const net = (i: number) => {
    let n = nets.get(i);
    if (!n) nets.set(i, (n = { members: [], pins: [] }));
    return n;
  };
  for (const c of inner) pins.get(c.id)!.forEach((i, p) => net(i).members.push([c.id, p]));
  for (const p of chipPins(scene)) net(pins.get(p.id)![0]).pins.push(p.number);
  const size = dipSize(scene);
  const pinNames = Array.from({ length: size }, (_, i) => {
    const p = chipPins(scene).find((x) => x.number === i + 1);
    return p ? p.name : "NC";
  });
  const pinRoles = Array.from({ length: size }, (_, i) => chipPins(scene).find((x) => x.number === i + 1)?.role ?? "nc");
  const source: Scene = JSON.parse(JSON.stringify({ ...scene, editingChip: undefined }));
  source.chips = chipsUsed(scene);
  return {
    id,
    name: name.trim() || "Микросхема",
    package: "DIP",
    pins: size,
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
