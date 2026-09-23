/** Ветви, общие для многих деталей. */

import type { Component } from "../model/types";
import type { Simulation } from "../sim/simulation";
import { pinNode } from "../sim/nodes";
import type { Branch } from "../sim/solver";

/** Ветвь между выводами 0 и 1 детали. */
export function twoPin(c: Component, r: number, emf?: number): Branch {
  const b: Branch = { id: c.id, a: pinNode(c, 0), b: pinNode(c, 1), r };
  if (emf !== undefined) b.emf = emf;
  return b;
}

/** Сгоревшая деталь — обрыв. true, если деталь сгорела и ветвь уже добавлена. */
export function stampBurned(c: Component, sim: Simulation, out: Branch[]): boolean {
  if (!sim.state(c.id).burned) return false;
  out.push(twoPin(c, Infinity));
  return true;
}
