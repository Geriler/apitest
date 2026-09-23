/**
 * Проекты: несколько именованных схем в хранилище браузера и файл .json для обмена.
 * Без Three.js и DOM — хранилище передаётся параметром (в тестах — своё).
 */

import type { Scene } from "./model/types";

const KEY = "maketka.projects.v1";
/** Метка файла проекта: по ней отличаем свой файл от любого другого JSON. */
const FILE_APP = "maketka";
const FILE_VERSION = 1;

export interface SavedProject {
  name: string;
  scene: Scene;
  /** Когда сохранён, мс с 1970 года. */
  savedAt: number;
}

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // хранилище запрещено (приватный режим, песочница)
  }
}

function readAll(store: Store | undefined): Record<string, SavedProject> {
  try {
    const raw = store?.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, SavedProject>) : {};
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

function writeAll(store: Store | undefined, all: Record<string, SavedProject>): boolean {
  try {
    if (!store) return false;
    store.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false; // переполнено или запрещено
  }
}

/** Сохранённые проекты, свежие первыми. */
export function listProjects(store = browserStore()): SavedProject[] {
  return Object.values(readAll(store)).sort((a, b) => b.savedAt - a.savedAt);
}

/** Сохранить (или перезаписать) проект под именем. false — хранилище недоступно. */
export function saveProject(name: string, scene: Scene, store = browserStore(), now = Date.now()): boolean {
  const all = readAll(store);
  all[name] = { name, scene: JSON.parse(JSON.stringify(scene)) as Scene, savedAt: now };
  return writeAll(store, all);
}

export function loadProject(name: string, store = browserStore()): Scene | undefined {
  const p = readAll(store)[name];
  return p ? (JSON.parse(JSON.stringify(p.scene)) as Scene) : undefined;
}

export function deleteProject(name: string, store = browserStore()): boolean {
  const all = readAll(store);
  if (!(name in all)) return false;
  delete all[name];
  return writeAll(store, all);
}

/** Текст файла проекта. */
export function projectFile(name: string, scene: Scene): string {
  return JSON.stringify({ app: FILE_APP, version: FILE_VERSION, name, scene }, null, 2);
}

/**
 * Разобрать файл проекта. Принимает и «голую» схему (как в хранилище песочницы).
 * Бросает Error с понятным текстом, если это не проект.
 */
export function parseProjectFile(text: string, fallbackName = "Без имени"): { name: string; scene: Scene } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Это не файл проекта: внутри не JSON.");
  }
  const obj = data as { app?: unknown; version?: unknown; name?: unknown; scene?: unknown };
  const scene = (obj && obj.app === FILE_APP ? obj.scene : data) as Scene | undefined;
  if (!scene || !Array.isArray(scene.components) || !Array.isArray(scene.wires)) {
    throw new Error("Это не файл проекта Макетки: нет списка деталей и проводов.");
  }
  if (obj.app === FILE_APP && typeof obj.version === "number" && obj.version > FILE_VERSION) {
    throw new Error("Файл сохранён более новой версией Макетки.");
  }
  const name = obj.app === FILE_APP && typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : fallbackName;
  return { name, scene };
}
