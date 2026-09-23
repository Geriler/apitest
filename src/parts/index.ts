/**
 * Реестр типов деталей. Чтобы добавить деталь: описать её тип в model/types.ts (данные),
 * сделать файл с PartDef в этой папке и добавить строку сюда.
 */

import type { Component } from "../model/types";
import { battery } from "./battery";
import { capacitor } from "./capacitor";
import { diode } from "./diode";
import { lamp } from "./lamp";
import { led } from "./led";
import { mosfet } from "./mosfet";
import { multimeter } from "./multimeter";
import { psu } from "./psu";
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
};

/** Описание типа этой детали. */
export function part<C extends Component>(c: C): PartDef<C> {
  return PARTS[c.type as C["type"]] as unknown as PartDef<C>;
}

export type { PartDef, ToolDef } from "./types";
