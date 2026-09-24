/** Панель «Карьера»: список уровней или, на столе уровня, задание, набор и результат проверки. */

import { kitUsed, rowText, type CheckResult } from "../career/build";
import { FUNC_NAMES, LEVELS, gateIo, kitLabel, type Level } from "../career/levels";
import { isDone, missing } from "../career/session";
import { PIN_ROLES } from "../chips/roles";
import type { Scene } from "../model/types";

export interface CareerHost {
  readonly scene: Scene;
  /** Уровень, который сейчас собирают (или нет). */
  careerLevel(): Level | undefined;
  startLevel(id: string): void;
  checkLevel(): void;
  leaveLevel(): void;
  /** Последняя проверка на этом столе. */
  lastCheck?: CheckResult;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export class CareerPanel {
  constructor(private host: CareerHost) {}

  render(): [string, string] {
    const level = this.host.careerLevel();
    return level ? ["cl", this.levelHtml(level)] : ["cc", this.listHtml()];
  }

  private listHtml(): string {
    const done = LEVELS.filter((l) => isDone(l.id)).length;
    const items = LEVELS.map((l) => {
      const need = missing(l);
      const kit = l.kit.map((k) => `${kitLabel(k)} × ${k.count}`).join(", ");
      const state = isDone(l.id) ? "открыт — ваша сборка идёт в наборы следующих уровней" : need.length ? `сначала откройте: ${need.join(", ")}` : "доступен";
      return `<li class="${isDone(l.id) ? "done" : need.length ? "locked" : ""}"><span><b>${esc(l.part)}</b> ${esc(l.title)}<br />
        <small>${esc(kit)}</small><br /><small>${esc(state)}</small></span>
        <span class="row"><button class="btn inline" data-career-act="start" data-id="${l.id}" ${need.length ? "disabled" : ""}>${isDone(l.id) ? "Заново" : "Собрать"}</button></span></li>`;
    }).join("");
    return `<div class="eyebrow">карьера</div><h2>Открыто ${done} из ${LEVELS.length}</h2>
      <p class="sub">Каждый компонент открывается, когда соберёшь его сам — ровно из выданного набора, ни деталью больше. Корпус — SOT-23-5 на переходнике, выводы как у настоящих 74LVC1G. Собрал — нажми «Проверить»: песочница сама прогонит таблицу истинности при питании 5 В. Открытое становится деталью, из которой собираются следующие уровни.</p>
      <ul class="list projects levels">${items}</ul>
      <p class="sub">В песочнице все эти компоненты есть сразу — в «заводском» исполнении.</p>`;
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
        ? `<p class="sub"><b>Работает!</b> ${esc(level.part)} открыт: теперь он в группе «Набор» уровней, где нужен, и остаётся вашим — внутри ваша сборка.</p>`
        : check.problems.map((t) => `<p class="sub bad">${esc(t)}</p>`).join("")
      : "";
    return `<div class="eyebrow">карьера · ${esc(FUNC_NAMES[level.func])}</div><h2>${esc(level.part)}</h2>
      <p><b>${esc(level.title)}.</b> ${esc(level.about)}</p>
      <div class="eyebrow">набор</div><ul class="kitlist">${kit}</ul>
      <div class="eyebrow">выводы корпуса</div><ul class="list">${pins}</ul>
      <p class="sub">Детали — из группы «Набор» слева, ставьте их на площадки корпуса и соединяйте дорожками (T) или проводами. Для своей проверки можно взять питание и приборы — в микросхему они не входят.</p>
      <div class="row"><button class="btn inline" data-career-act="check">Проверить</button>
      <button class="btn inline" data-career-act="leave">Выйти из уровня</button></div>
      ${table}${verdict}`;
  }

  bind(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>("[data-career-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.careerAct;
        if (act === "start") this.host.startLevel(btn.dataset.id!);
        if (act === "check") this.host.checkLevel();
        if (act === "leave") this.host.leaveLevel();
      });
    });
  }
}
