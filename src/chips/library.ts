/** Библиотека своих микросхем в хранилище браузера (как проекты: хранилище передаётся параметром). */

import type { ChipDef } from "../model/types";

const KEY = "maketka.chips.v1";
type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadLibrary(store = browserStore()): ChipDef[] {
  try {
    const raw = store?.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as ChipDef[]) : [];
    return Array.isArray(all) ? all.filter((d) => d && typeof d.id === "string" && Array.isArray(d.parts)) : [];
  } catch {
    return [];
  }
}

export function saveLibrary(defs: ChipDef[], store = browserStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(KEY, JSON.stringify(defs));
    return true;
  } catch {
    return false;
  }
}
