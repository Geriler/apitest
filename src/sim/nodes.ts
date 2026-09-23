/** Электрические узлы: вывод детали на плате — узел полосы или площадки, на столе — свой узел. */

import { HOLE_BY_ID } from "../model/breadboard";
import type { Component, Endpoint, Pin, Scene } from "../model/types";

/** Электрический узел вывода детали. На плате — узел полосы, иначе собственный узел вывода. */
export function pinNode(c: Component, pin: Pin): string {
  if (c.placement.mode === "board") {
    const hole = HOLE_BY_ID.get(c.placement.holes[pin]);
    if (!hole) throw new Error(`Нет отверстия ${c.placement.holes[pin]}`);
    return hole.node;
  }
  return `pin:${c.id}:${pin}`;
}

export function endpointNode(scene: Scene, e: Endpoint): string {
  if ("hole" in e) {
    const hole = HOLE_BY_ID.get(e.hole);
    if (!hole) throw new Error(`Нет отверстия ${e.hole}`);
    return hole.node;
  }
  const c = scene.components.find((x) => x.id === e.comp);
  if (!c) throw new Error(`Нет детали ${e.comp}`);
  return pinNode(c, e.pin);
}
