/** Панель «Карьера»: список уровней или, на столе уровня, задание, набор и результат проверки. */

import { CHECK_VOLTS, kitUsed, rowText, type CheckResult, type Metrics } from "../career/build";
import { formatOhms, formatSI } from "../sim/resistorCodes";
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
    ["работает от", (x) => (x.vmin === undefined ? "—" : formatSI(x.vmin, "В")), "vmin"],
    ["выходное сопр.", (x) => (x.rOut === undefined ? "—" : formatOhms(x.rOut)), "rOut"],
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
          check.ok ? `<p class="sub"><b>Готово!</b> ${lesson.repair ? "Починено" : "Урок пройден"} — дальше на карте.</p>` : ""
        }`
      : "";
    const how = lesson.repair
      ? "Токов и напряжений деталей на ремонте не видно — меряйте приборами на столе (щупы — проводом, 2; нажмите на прибор, чтобы сменить режим). Запасные детали — в группе «Набор»; чинить можно и проводом или дорожкой (T), ставить на место — перетаскиванием."
      : "Детали — из группы «Набор» слева; щупы приборов и соединения — проводом (2). Нажмите на прибор, чтобы сменить режим.";
    return `<div class="eyebrow">${lesson.repair ? "ремонт" : "введение"}</div><h2>${esc(lesson.title)}</h2>
      <p>${esc(lesson.about)}</p>${kit}
      <p class="sub">${how}</p>
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
    const open = LEVELS.filter((l) => isDone(l.id) && !l.intermediate);
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
    const outs = io.outputs.map((p) => level.names[p - 1] || `вывод ${p}`);
    const compact = names.length > 4 || outs.length > 2;
    const table = check?.rows.length && compact
      ? this.compactTable(names, outs, check)
      : check?.rows.length
      ? `${level.sequence ? `<p class="sub">Проверка — шаги сверху вниз, по очереди: схема должна помнить, что было на прошлых шагах.</p>` : ""}<table class="truth"><tr>${level.sequence ? "<th>шаг</th>" : ""}${names.map((n) => `<th>${esc(n)}</th>`).join("")}${outs.map((n) => `<th>${esc(n)} нужно</th><th>${esc(n)}</th>`).join("")}<th></th></tr>${check.rows
          .map(
            (r) =>
              `<tr>${r.step ? `<td>${r.step}</td>` : ""}${r.inputs.map((b) => `<td>${b ? 1 : 0}</td>`).join("")}${r.expected
                .map((e, k) => `<td>${e ? 1 : 0}</td><td class="${r.each[k] ? "" : "bad"}" title="${esc(rowText(r))}">${r.volts[k].toFixed(2).replace(".", ",")} В</td>`)
                .join("")}<td class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</td></tr>`,
          )
          .join("")}</table>`
      : "";
    const verdict = check
      ? check.ok
        ? `<p class="sub"><b>Работает!</b> ${esc(level.part)} открыт: теперь он в группе «Набор» уровней, где нужен, и остаётся вашим — внутри ваша сборка.</p>
          <div class="eyebrow">цифры сборки</div>${metricsHtml(check.metrics, bestOf(level.id), check.better)}
          <p class="sub">Меньше — лучше. Площадь — прямоугольник, в который помещается всё на поле корпуса; соединения — провода и дорожки внутри. Ток покоя и число транзисторов показывают разницу между КМОП и РТЛ. «Работает от» — наименьшее питание из 5; 4; 3,3; 2,5 и 2 В, при котором таблица ещё сходится (настоящие 74LVC — от 1,65 В). Выходное сопротивление — насколько твёрдо выход держит уровень под нагрузкой: чем меньше, тем больше входов он потянет.</p>`
        : check.problems.map((t) => `<p class="sub bad">${esc(t)}</p>`).join("") +
          (check.diagnosis?.length ? `<div class="eyebrow">что проверить</div><ul class="kitlist">${check.diagnosis.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "")
      : "";
    // Проверки кроме таблицы: пороги триггера Шмитта, период генератора
    const steps = check?.steps
      ? `<ul class="list steps">${check.steps.map((x) => `<li><span>${esc(x.text)}</span><span class="${x.ok ? "ok" : "bad"}">${x.ok ? "✓" : "✗"}</span></li>`).join("")}</ul>`
      : "";
    const hints = this.hintsHtml(level);
    return `<div class="eyebrow">карьера · ${esc(FUNC_NAMES[level.func])}</div><h2>${esc(level.part)}</h2>
      <p><b>${esc(level.title)}.</b> ${esc(level.about)}</p>
      <div class="eyebrow">набор</div><ul class="kitlist">${kit}</ul>
      <div class="eyebrow">выводы корпуса</div><ul class="list">${pins}</ul>
      <p class="sub">Детали — из группы «Набор» слева, ставьте их на площадки корпуса и соединяйте дорожками (T) или проводами. Для своей проверки можно взять питание и приборы — в микросхему они не входят.</p>
      <div class="row"><button class="btn inline" data-career-act="check">Проверить</button>
      <button class="btn inline" data-career-act="leave">К карте</button></div>
      ${table}${steps}${verdict}${hints}${!check && bestOf(level.id) ? `<div class="eyebrow">лучшие цифры</div>${metricsHtml(undefined, bestOf(level.id))}` : ""}`;
  }

  /**
   * Таблица большой микросхемы: входы и выходы — строками битов под своими именами, неверные
   * биты выделены; напряжения — во всплывающей подсказке.
   */
  private compactTable(names: string[], outs: string[], check: CheckResult): string {
    const bits = (xs: string[], labels: string[]) => xs.map((x, i) => x.padStart(labels[i].length)).join(" ");
    const head = (labels: string[]) => esc(labels.join(" "));
    const rows = check.rows
      .map((r) => {
        const got = r.volts
          .map((v, k) => {
            const bit = (v > CHECK_VOLTS / 2 ? "1" : "0").padStart(outs[k].length);
            return r.each[k] ? bit : `<b class="bad">${bit}</b>`;
          })
          .join(" ");
        const need = r.ok ? "" : ` · нужно ${r.expected.map((b) => (b ? 1 : 0)).join(" ")}`;
        return `<tr title="${esc(rowText(r) + need)}"><td>${bits(r.inputs.map((b) => (b ? "1" : "0")), names)}</td><td>${got}</td><td class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</td></tr>`;
      })
      .join("");
    const failed = check.rows.filter((r) => !r.ok).length;
    return `<p class="sub">Проверено ${check.rows.length} наборов входов${check.rows.length < 2 ** names.length ? ` из ${2 ** names.length} возможных — как проверяют настоящие микросхемы` : ""}${failed ? `, неверных ${failed}; красным — выходы не такие, как нужно (что нужно — в подсказке строки)` : ""}.</p>
      <div class="truth-scroll"><table class="truth compact"><tr><th>входы<br />${head(names)}</th><th>выходы<br />${head(outs)}</th><th></th></tr>${rows}</table></div>`;
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
