import { describe, expect, it } from "vitest";
import { demoScene } from "../src/demo";
import { deleteProject, listProjects, loadProject, parseProjectFile, projectFile, saveProject } from "../src/projects";

/** Хранилище в памяти вместо localStorage. */
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("проекты", () => {
  it("сохранить, список (свежие первыми), открыть, перезаписать, удалить", () => {
    const store = memory();
    const scene = demoScene();
    expect(saveProject("Лампы", scene, store, 1000)).toBe(true);
    expect(saveProject("Пусто", { components: [], wires: [], boards: [] }, store, 2000)).toBe(true);
    expect(listProjects(store).map((p) => p.name)).toEqual(["Пусто", "Лампы"]);
    expect(loadProject("Лампы", store)).toEqual(scene);
    // Открытая копия не связана с сохранённой
    loadProject("Лампы", store)!.components.length = 0;
    expect(loadProject("Лампы", store)!.components.length).toBe(scene.components.length);
    saveProject("Лампы", { components: [], wires: [] }, store, 3000);
    expect(listProjects(store).map((p) => p.name)).toEqual(["Лампы", "Пусто"]);
    expect(deleteProject("Пусто", store)).toBe(true);
    expect(deleteProject("Пусто", store)).toBe(false);
    expect(listProjects(store).map((p) => p.name)).toEqual(["Лампы"]);
  });

  it("без хранилища — пустой список и честный отказ, без исключений", () => {
    expect(listProjects(undefined)).toEqual([]);
    expect(saveProject("x", { components: [], wires: [] }, undefined)).toBe(false);
    const broken = { getItem: () => "{не json", setItem: () => { throw new Error("quota"); } };
    expect(listProjects(broken)).toEqual([]);
    expect(saveProject("x", { components: [], wires: [] }, broken)).toBe(false);
  });

  it("файл: туда и обратно; «голая» схема тоже открывается; чужой файл — понятная ошибка", () => {
    const scene = demoScene();
    expect(parseProjectFile(projectFile("Мигалка", scene))).toEqual({ name: "Мигалка", scene });
    expect(parseProjectFile(JSON.stringify(scene), "из файла").name).toBe("из файла");
    expect(() => parseProjectFile("hello")).toThrow(/не JSON/);
    expect(() => parseProjectFile('{"a":1}')).toThrow(/нет списка деталей/);
    expect(() => parseProjectFile(JSON.stringify({ app: "maketka", version: 99, scene }))).toThrow(/новой версией/);
  });
});
