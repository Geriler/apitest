/** Панель «Проекты»: несколько схем в браузере и файл .json для обмена. */

import type { Scene } from "../model/types";
import { deleteProject, listProjects, loadProject, parseProjectFile, projectFile, saveProject } from "../projects";

/** Что панели проектов нужно от приложения. */
export interface ProjectsHost {
  readonly scene: Scene;
  replaceScene(s: Scene): void;
  toast(title: string, body: string): void;
  /** Перерисовать панель справа. */
  refreshInspector(): void;
}

export class ProjectsPanel {
  /** Имя текущего проекта (под ним он сохранён или открыт). */
  name = "";
  /** Имя в поле ввода, пока его набирают. */
  private draft?: string;
  /** Проект, который попросили удалить: второе нажатие удаляет. */
  private confirmDelete?: string;

  constructor(private host: ProjectsHost) {}

  /** Сбросить набранное имя и запрос на удаление (панель открыли заново). */
  reset(): void {
    this.confirmDelete = undefined;
    this.draft = undefined;
  }

  render(): [string, string] {
    const name = this.draft ?? this.name;
    const list = listProjects();
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const date = (ms: number) => new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const exists = list.some((p) => p.name === name.trim());
    const rows = list
      .map(
        (p) => `<li><span><b>${esc(p.name)}</b><br /><small>${date(p.savedAt)} · ${plural(p.scene.components.length, "деталь", "детали", "деталей")}</small></span>
          <span class="row"><button class="btn inline" data-proj-act="open" data-name="${esc(p.name)}">Открыть</button>
          <button class="btn inline danger" data-proj-act="delete" data-name="${esc(p.name)}">${this.confirmDelete === p.name ? "Точно?" : "Удалить"}</button></span></li>`,
      )
      .join("");
    const html = `<div class="eyebrow">проекты</div><h2>${this.name ? esc(this.name) : "Новая схема"}</h2>
      <div class="field"><label for="f-proj-name">Имя</label>
        <input id="f-proj-name" class="btn" type="text" maxlength="60" placeholder="Например, мигалка" value="${esc(name)}" /></div>
      <div class="row"><button class="btn inline" data-proj-act="save" ${name.trim() ? "" : "disabled"}>${exists ? "Перезаписать" : "Сохранить"}</button></div>
      ${rows ? `<ul class="list projects">${rows}</ul>` : `<p class="sub">Сохранённых проектов пока нет. Они хранятся в этом браузере.</p>`}
      <div class="field"><label>Файл</label>
        <div class="row"><button class="btn inline" data-proj-act="export">Скачать файл</button>
        <button class="btn inline" data-proj-act="import">Открыть файл</button></div>
        <input type="file" id="f-proj-file" accept=".json,application/json" hidden /></div>
      <p class="sub">Файл .json можно передать другому человеку или открыть в другом браузере. Открыть проект — как загрузить пример: Ctrl+Z вернёт прежнюю схему.</p>`;
    return ["p", html];
  }

  /** Имя файла из имени проекта: без символов, запрещённых в именах файлов. */
  private fileName(): string {
    const base = (this.name || "схема").replace(/[\\/:*?"<>|]+/g, " ").trim() || "схема";
    return `${base}.json`;
  }

  /** Скачать проект файлом: в claude.ai — через сохранение файлов артефакта, иначе обычной загрузкой. */
  async exportFile(): Promise<void> {
    const data = projectFile(this.name || "Без имени", this.host.scene);
    const filename = this.fileName();
    type Downloads = { save(r: { filename: string; data: string }): Promise<unknown> };
    const claude = (window as unknown as { claude?: { use?(name: string): Promise<Downloads | null> } }).claude;
    const downloads = claude?.use ? await claude.use("downloads").catch(() => null) : null;
    if (downloads) {
      try {
        await downloads.save({ filename, data });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== "declined") this.host.toast("Файл не сохранён", code === "rate_limited" ? "Окно сохранения уже открыто." : "Сохранение файлов здесь недоступно.");
      }
      return;
    }
    if (claude?.use) {
      // Внутри claude.ai без разрешения на файлы обычная загрузка ничего не делает — говорим честно
      this.host.toast("Скачивание здесь недоступно", "В этом окне песочница не может сохранять файлы. Сохраните проект в браузере (кнопка «Сохранить») или откройте песочницу отдельно.");
      return;
    }
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async importFile(file: File): Promise<void> {
    try {
      const { name, scene } = parseProjectFile(await file.text(), file.name.replace(/\.json$/i, ""));
      this.host.replaceScene(scene);
      this.name = name;
      this.draft = undefined;
      this.host.toast("Проект открыт", `«${name}» из файла. Ctrl+Z вернёт прежнюю схему.`);
    } catch (e) {
      this.host.toast("Не открылось", (e as Error).message);
    }
    this.host.refreshInspector();
  }

  /** Навесить события на отрисованную панель. */
  bind(root: HTMLElement): void {
    const input = root.querySelector<HTMLInputElement>("#f-proj-name");
    input?.addEventListener("input", () => {
      this.draft = input.value;
      const save = root.querySelector<HTMLButtonElement>('[data-proj-act="save"]');
      if (save) {
        save.disabled = !input.value.trim();
        save.textContent = listProjects().some((p) => p.name === input.value.trim()) ? "Перезаписать" : "Сохранить";
      }
    });
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") root.querySelector<HTMLButtonElement>('[data-proj-act="save"]')?.click();
    });
    const file = root.querySelector<HTMLInputElement>("#f-proj-file");
    file?.addEventListener("change", () => {
      if (file.files?.[0]) void this.importFile(file.files[0]);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-proj-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.name ?? "";
        switch (btn.dataset.projAct) {
          case "save": {
            const n = (this.draft ?? this.name).trim();
            if (!n) return;
            if (saveProject(n, this.host.scene)) {
              this.name = n;
              this.draft = undefined;
              this.host.toast("Сохранено", `Проект «${n}» — в этом браузере.`);
            } else this.host.toast("Не сохранилось", "Хранилище браузера недоступно или переполнено. Скачайте проект файлом.");
            break;
          }
          case "open": {
            const scene = loadProject(name);
            if (!scene) return;
            this.host.replaceScene(scene);
            this.name = name;
            this.draft = undefined;
            break;
          }
          case "delete":
            if (this.confirmDelete !== name) {
              this.confirmDelete = name;
            } else {
              deleteProject(name);
              this.confirmDelete = undefined;
            }
            break;
          case "export":
            void this.exportFile();
            return;
          case "import":
            file?.click();
            return;
        }
        this.host.refreshInspector();
      });
    });
  }
}

/** «1 деталь», «3 детали», «7 деталей». */
function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  return `${n} ${word}`;
}
