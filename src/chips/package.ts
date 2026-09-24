/**
 * Упаковка схемы в микросхему: на корпусе (плата «корпус DIP-N») стоит начинка, его площадки
 * выводов становятся выводами микросхемы. Всё остальное на столе — обвязка для проверки.
 * Соединения (провода, дорожки) сворачиваются в список цепей, поэтому начинка не зависит от плат
 * и считается одинаково в любом месте.
 */

import { HOLE_BY_ID, chipPinHole, packageName, type BoardSpec } from "../model/breadboard";
import type { ChipDef, Component, Scene } from "../model/types";
import { part } from "../parts";
import { buildNetlist } from "../view/schematic";
import { chipsUsed } from "./registry";

/** Больше выводов в DIP пока не бывает. */
export const MAX_CHIP_PINS = 16;

/** Приборы: их щупы можно ставить куда угодно, в том числе внутрь корпуса. */
function instrument(c: Component): boolean {
  return c.type === "meter" || c.type === "scope";
}

/** Вместимость корпуса, клеток: 2 на вывод (DIP-4 — 8, DIP-16 — 32). */
export const spaceOf = (pins: number) => 2 * pins;

/** Корпус схемы (первый, если их почему-то несколько). */
export function caseOf(scene: Scene): BoardSpec | undefined {
  return scene.boards?.find((b) => b.kind === "chip");
}

/** Детали, стоящие на корпусе, — начинка микросхемы. */
export function chipInner(scene: Scene, box = caseOf(scene)): Component[] {
  if (!box) return [];
  return scene.components.filter((c) => c.placement.mode === "board" && c.placement.holes.some((h) => HOLE_BY_ID.get(h)?.boardId === box.id));
}

/** Сколько места займёт начинка, клеток. */
export function spaceUsed(scene: Scene): number {
  return chipInner(scene).reduce((sum, c) => sum + (part(c).chipSpace?.(c, scene) ?? 1), 0);
}

/** Сколько выводов будет у микросхемы (0 — корпуса нет). */
export function dipSize(scene: Scene): number {
  return caseOf(scene)?.pins ?? 0;
}

/** Цепь (номер в buildNetlist) каждой площадки вывода корпуса; undefined — к площадке ничего не подключено. */
function pinNets(box: BoardSpec, nets: string[][]): (number | undefined)[] {
  return Array.from({ length: box.pins ?? 0 }, (_, i) => {
    const node = `pad:${chipPinHole(box, i + 1)}`;
    const n = nets.findIndex((net) => net.includes(node));
    return n < 0 ? undefined : n;
  });
}

/** Что мешает упаковать: пусто — можно. */
export function packageProblems(scene: Scene): string[] {
  const box = caseOf(scene);
  if (!box) return ["Нет корпуса: начните с «Новой микросхемы» в «Проектах»."];
  const out: string[] = [];
  const cases = (scene.boards ?? []).filter((b) => b.kind === "chip");
  if (cases.length > 1) out.push(`Корпус должен быть один, а их ${cases.length}.`);
  const roles = box.roles ?? [];
  const inner = chipInner(scene, box);
  if (!inner.length) out.push("На корпусе нет ни одной детали: ставьте их на площадки корпуса.");
  if (!roles.some((r) => r !== "nc")) out.push("Ни одному выводу не назначено, для чего он: нажмите на корпус и выберите в панели.");
  const { nets, pins } = buildNetlist(scene);
  const innerIds = new Set(inner.map((c) => c.id));
  const innerNets = new Set(inner.flatMap((c) => pins.get(c.id) ?? []));
  const pinNet = pinNets(box, nets);
  // Площадка помечена «не подключён», а к ней подведена начинка — так не бывает
  const wiredNc = roles.map((r, i) => (r === "nc" && pinNet[i] !== undefined && innerNets.has(pinNet[i]!) ? i + 1 : 0)).filter(Boolean);
  if (wiredNc.length) {
    const many = wiredNc.length > 1;
    out.push(`${many ? "Выводы" : "Вывод"} ${wiredNc.join(", ")} подключен${many ? "ы" : ""} к начинке, но назначен${many ? "ы" : ""} «не подключён»: выберите, для чего ${many ? "они" : "он"}.`);
  }
  // Начинка связана с обвязкой мимо выводов (провод с площадки корпуса наружу)
  const pinNetSet = new Set(pinNet.filter((n): n is number => n !== undefined));
  const leaks = new Set<string>();
  for (const c of scene.components) {
    if (innerIds.has(c.id) || instrument(c)) continue;
    for (const n of pins.get(c.id) ?? []) if (innerNets.has(n) && !pinNetSet.has(n)) leaks.add(c.id);
  }
  if (leaks.size) out.push(`Начинка соединена с ${[...leaks].join(", ")} не через выводы корпуса. Снаружи подключайтесь только к площадкам выводов.`);
  for (const c of inner) {
    const why = part(c).notInChip?.(c);
    if (why) out.push(`${c.id} не может быть внутри: ${why}.`);
  }
  const space = spaceUsed(scene);
  const room = spaceOf(box.pins ?? 0);
  if (space > room) {
    out.push(`Не помещается в ${packageName(box.package, box.pins ?? 0)}: начинка занимает ${space} клеток из ${room}. Уберите детали или возьмите корпус больше.`);
  }
  return out;
}

/** Упаковать схему. id — обновить существующую микросхему (число выводов должно совпасть). */
export function packageChip(scene: Scene, name: string, id: string = newChipId(), now = Date.now()): ChipDef {
  const { nets: netlist, pins } = buildNetlist(scene);
  const box = caseOf(scene)!;
  const roles = box.roles ?? [];
  const inner = chipInner(scene, box);
  const nets = new Map<number, { members: [string, number][]; pins: number[] }>();
  const net = (i: number) => {
    let n = nets.get(i);
    if (!n) nets.set(i, (n = { members: [], pins: [] }));
    return n;
  };
  for (const c of inner) pins.get(c.id)!.forEach((i, p) => net(i).members.push([c.id, p]));
  // Неподключённые площадки наружу не выходят; вывод без начинки — отдельная цепь
  const pinNet = pinNets(box, netlist);
  roles.forEach((r, i) => r !== "nc" && net(pinNet[i] ?? -1 - i).pins.push(i + 1));
  const pinNames = roles.map((r, i) => (r === "nc" ? "NC" : box.names?.[i]?.trim() ?? ""));
  const pinRoles = roles.map((r) => (r === "nc" ? "nc" : r));
  const source: Scene = JSON.parse(JSON.stringify({ ...scene, editingChip: undefined }));
  source.chips = chipsUsed(scene);
  return {
    id,
    name: name.trim() || box.label?.trim() || "Микросхема",
    package: box.package ?? "DIP",
    pins: box.pins ?? 0,
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
