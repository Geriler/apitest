/** Панель «Карьера»: список уровней или, на столе уровня, задание, набор и результат проверки. */

import { kitUsed, rowText, type CheckResult, type Metrics } from "../career/build";
import { formatSI } from "../sim/resistorCodes";
import { FUNC_NAMES, LEVELS, gateIo, kitLabel, type Level } from "../career/levels";
import { HINT_AFTER, bestOf, failsOf, hintsOf, isDone } from "../career/session";
import type { Lesson } from "../career/lessons";
import { PIN_ROLES } from "../chips/roles";
import type { Scene } from "../model/types";

export interface CareerHost {
  readonly scene: Scene;
  /** Уровень, который сейчас собирают (или нет). */
  careerLevel(): Level | undefined;
  careerLesson(): Lesson | undefined;
  startLevel(id: string, fresh?: boolean): void;
  checkLevel(): void;
  leaveLevel(): void;
  revealHint(): void;
  /** Последняя проверка на этом столе. */
  lastCheck?: CheckResult;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Цифры сборки: эта (m) и лучшие (best); better — какие только что стали лучше.
 * Меньше — лучше; звёзд нет, только сравнение с собой.
 */
export function metricsHtml(m: Metrics | undefined, best: Metrics | undefined, better: (keyof Metrics)[] = []): string {
  if (!m && !best) return "";
  const cell = (x: Metrics | undefined, f: (x: Metrics) => string) => (x ? f(x) : "—");
  const area = (x: Metrics) => `${x.width} × ${x.height} = ${x.width * x.height}`;
  const rows: [string, (x: Metrics) => string, keyof Metrics][] = [
    ["площадь, площадок", area, "width"],
    ["соединений", (x) => String(x.links), "links"],
    ["ток покоя", (x) => formatSI(x.idle, "А"), "idle"],
    ["транзисторов", (x) => String(x.transistors), "transistors"],
  ];
  return `<table class="truth metrics"><tr><th></th>${m ? "<th>сейчас</th>" : ""}<th>лучшее</th></tr>${rows
    .map(([label, f, k]) => `<tr><td>${label}</td>${m ? `<td${better.includes(k) ? ' class="ok"' : ""}>${cell(m, f)}${better.includes(k) ? " ↓" : ""}</td>` : ""}<td>${cell(best, f)}</td></tr>`)
    .join("")}</table>`;
}

export class CareerPanel {
  constructor(private host: CareerHost) {}

  render(): [string, string] {
    const level = this.host.careerLevel();
    const lesson = this.host.careerLesson();
    return level ? ["cl", this.levelHtml(level)] : lesson ? ["cs", this.lessonHtml(lesson)] : ["cc", this.workshopHtml()];
  }

  /** Урок введения: задача, набор, шаги проверки, подсказки. */
  private lessonHtml(lesson: Lesson): string {
    const used = kitUsed(lesson.kit, this.host.scene);
    const kit = lesson.kit.length
      ? `<div class="eyebrow">набор</div><ul class="kitlist">${lesson.kit.map((k, i) => `<li>${esc(kitLabel(k))}: поставлено ${used[i]} из ${k.count}</li>`).join("")}</ul>`
      : "";
    const check = this.host.lastCheck;
    const steps = check?.steps
      ? `<ul class="list steps">${check.steps.map((x) => `<li><span>${esc(x.text)}</span><span class="${x.ok ? "ok" : "bad"}">${x.ok ? "✓" : "✗"}</span></li>`).join("")}</ul>${
          check.ok ? `<p class="sub"><b>Готово!</b> Урок пройден — дальше на карте.</p>` : ""
        }`
      : "";
    return `<div class="eyebrow">введение</div><h2>${esc(lesson.title)}</h2>
      <p>${esc(lesson.about)}</p>${kit}
      <p class="sub">Детали — из группы «Набор» слева; щупы приборов и соединения — проводом (2). Нажмите на прибор, чтобы сменить режим.</p>
      <div class="row"><button class="btn inline" data-career-act="check">Проверить</button>
      <button class="btn inline" data-career-act="leave">К карте</button></div>
      ${steps}${this.hintsHtml(lesson)}`;
  }

  /** Подсказки — только по кнопке и после нескольких неудачных проверок. */
  private hintsHtml(stage: { id: string; hints: string[] }): string {
    const fails = failsOf(stage.id), shown = hintsOf(stage.id);
    if (isDone(stage.id) && !shown) return "";
    return `<div class="eyebrow">подсказки</div>${stage.hints
      .slice(0, shown)
      .map((h, i) => `<p class="sub"><b>${i + 1}.</b> ${esc(h)}</p>`)
      .join("")}${
      shown >= stage.hints.length
        ? ""
        : fails < HINT_AFTER
          ? `<p class="sub">Подсказка откроется после ${HINT_AFTER} неудачных проверок (сейчас ${fails}).</p>`
          : `<div class="row"><button class="btn inline" data-career-act="hint">Подсказка ${shown + 1} из ${stage.hints.length}</button></div>`
    }`;
  }

  private workshopHtml(): string {
    const open = LEVELS.filter((l) => isDone(l.id));
    return `<div class="eyebrow">карьера</div><h2>Мастерская</h2>
      <p>Свободный стол: базовые детали — резисторы, транзисторы, приборы — и все модули, которые вы открыли. Закрытых здесь нет: открывайте их на карте.</p>
      <div class="eyebrow">открытые модули</div>
      ${open.length ? `<ul class="kitlist">${open.map((l) => `<li>${esc(l.part)} — ${esc(l.title)}</li>`).join("")}</ul>` : `<p class="sub">Пока ни одного — соберите первый уровень на карте.</p>`}
      <p class="sub">«Очистить» убирает всё с мастерской. Стол сохраняется сам и ждёт вас, пока вы на уровнях.</p>`;
  }

  private levelHtml(level: Level): string {
    const used = kitUsed(level.kit, this.host.scene);
    const kit = level.kit.map((k, i) => `<li>${esc(kitLabel(k))}: поставлено ${used[i]} из ${k.count}</li>`).join("");
    const pins = level.roles
      .map((r, i) => `<li><span><b>${i + 1}</b> ${esc(level.names[i] || PIN_ROLES[r].name)}</span><span>${PIN_ROLES[r].label}</span></li>`)
      .join("");
    const io = gateIo(level);
    const names = io.inputs.map((p) => level.names[p - 1] || `вывод ${p}`);
    const check = this.host.lastCheck;
    const table = check?.rows.length
      ? `<table class="truth"><tr>${names.map((n) => `<th>${esc(n)}</th>`).join("")}<th>нужно</th><th>${esc(level.names[io.output - 1] || "выход")}</th><th></th></tr>${check.rows
          .map(
            (r) => `<tr>${r.inputs.map((b) => `<td>${b ? 1 : 0}</td>`).join("")}<td>${r.expected ? 1 : 0}</td><td title="${esc(rowText(r))}">${r.volts.toFixed(2).replace(".", ",")} В</td><td class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</td></tr>`,
          )
          .join("")}</table>`
      : "";
    const verdict = check
      ? check.ok
        ? `<p class="sub"><b>Работает!</b> ${esc(level.part)} открыт: теперь он в группе «Набор» уровней, где нужен, и остаётся вашим — внутри ваша сборка.</p>
          <div class="eyebrow">цифры сборки</div>${metricsHtml(check.metrics, bestOf(level.id), check.better)}
          <p class="sub">Меньше — лучше. Площадь — прямоугольник, в который помещается всё на поле корпуса; соединения — провода и дорожки внутри. Ток покоя и число транзисторов показывают разницу между КМОП и РТЛ.</p>`
        : check.problems.map((t) => `<p class="sub bad">${esc(t)}</p>`).join("") +
          (check.diagnosis?.length ? `<div class="eyebrow">что проверить</div><ul class="kitlist">${check.diagnosis.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "")
      : "";
    const hints = this.hintsHtml(level);
    return `<div class="eyebrow">карьера · ${esc(FUNC_NAMES[level.func])}</div><h2>${esc(level.part)}</h2>
      <p><b>${esc(level.title)}.</b> ${esc(level.about)}</p>
      <div class="eyebrow">набор</div><ul class="kitlist">${kit}</ul>
      <div class="eyebrow">выводы корпуса</div><ul class="list">${pins}</ul>
      <p class="sub">Детали — из группы «Набор» слева, ставьте их на площадки корпуса и соединяйте дорожками (T) или проводами. Для своей проверки можно взять питание и приборы — в микросхему они не входят.</p>
      <div class="row"><button class="btn inline" data-career-act="check">Проверить</button>
      <button class="btn inline" data-career-act="leave">К карте</button></div>
      ${table}${verdict}${hints}${!check && bestOf(level.id) ? `<div class="eyebrow">лучшие цифры</div>${metricsHtml(undefined, bestOf(level.id))}` : ""}`;
  }

  bind(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>("[data-career-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.careerAct;
        if (act === "start") this.host.startLevel(btn.dataset.id!);
        if (act === "check") this.host.checkLevel();
        if (act === "leave") this.host.leaveLevel();
        if (act === "hint") this.host.revealHint();
      });
    });
  }
}
