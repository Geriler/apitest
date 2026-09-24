/**
 * Реестр типов деталей. Чтобы добавить деталь: описать её тип в model/types.ts (данные),
 * сделать файл с PartDef в этой папке и добавить строку сюда.
 */

import type { Component, Scene } from "../model/types";
import { battery } from "./battery";
import { button } from "./button";
import { capacitor } from "./capacitor";
import { chip } from "./chip";
import { diode } from "./diode";
import { lamp } from "./lamp";
import { led } from "./led";
import { mosfet } from "./mosfet";
import { multimeter } from "./multimeter";
import { pot } from "./pot";
import { psu } from "./psu";
import { relay } from "./relay";
import { resistor } from "./resistor";
import { scope } from "./scope";
import { switchPart } from "./switch";
import { transistor } from "./transistor";
import type { PartDef } from "./types";

type ComponentOf<K extends Component["type"]> = Extract<Component, { type: K }>;

export const PARTS: { [K in Component["type"]]: PartDef<ComponentOf<K>> } = {
  resistor,
  lamp,
  switch: switchPart,
  battery,
  psu,
  capacitor,
  diode,
  led,
  transistor,
  mosfet,
  meter: multimeter,
  scope,
  button,
  pot,
  relay,
  chip,
};

/** Название вывода: «база», «2 MID», «COM»… (по умолчанию «вывод N»). */
export function pinLabelOf(c: Component, pin: number, scene: Scene): string {
  return part(c).pinLabel?.(c, pin, scene) ?? part(c).pinLabels?.[pin] ?? `вывод ${pin + 1}`;
}

/** Число выводов этой детали. */
export function pinsOf(c: Component): number {
  return part(c).pinCount?.(c) ?? part(c).pins;
}

/** Описание типа этой детали. */
export function part<C extends Component>(c: C): PartDef<C> {
  return PARTS[c.type as C["type"]] as unknown as PartDef<C>;
}

export type { PartDef, ToolDef } from "./types";

/**
 * Убрать из схемы детали, которых больше нет в реестре (например, из старой версии песочницы),
 * и провода к ним. Возвращает обозначения убранных.
 */
export function dropUnknownParts(scene: Scene): string[] {
  const gone = scene.components.filter((c) => !(c.type in PARTS)).map((c) => c.id);
  if (!gone.length) return gone;
  const set = new Set(gone);
  scene.components = scene.components.filter((c) => !set.has(c.id));
  scene.wires = scene.wires.filter((w) => ![w.a, w.b].some((e) => "comp" in e && set.has(e.comp)));
  return gone;
}
