/**
 * Кусочки разметки панели свойств, общие для приложения и описаний деталей (src/parts):
 * поля выбора, показания приборов, строки «ключ — значение». Только строки HTML, без DOM.
 */

import {
  BATTERIES,
  CERAMICS,
  CERAMIC_VOLTAGES,
  DIODES,
  ELECTROLYTICS,
  ELECTROLYTIC_VOLTAGES,
  LAMPS,
  LEDS,
  LED_SIZES,
  MOSFETS,
  SMD_SIZES,
  THT_RESISTORS,
  TRANSISTORS,
  formatFarads,
  type DiodeKind,
  type LedSize,
  type MosfetKind,
  type SmdSize,
} from "../model/types";
import { formatV, formatW } from "../parts/format";
import { e12Values, formatOhms, formatSI } from "../sim/resistorCodes";

export function selectField(name: string, labelText: string, options: [string, string][], value: string): string {
  return `<div class="field"><label for="f-${name}">${labelText}</label>
      <select id="f-${name}" data-field="${name}">${options.map(([v, t]) => `<option value="${v}"${v === value ? " selected" : ""}>${t}</option>`).join("")}</select></div>`;
}

export function ohmsSelect(value: number): string {
  return selectField("ohms", "Сопротивление (ряд E12)", e12Values().map((v) => [String(v), formatOhms(v)]), String(value));
}

export function wattsSelect(value: number): string {
  return selectField("watts", "Мощность", THT_RESISTORS.map((r) => [String(r.ratedW), `${formatW(r.ratedW)} — ${String(r.lengthMm).replace(".", ",")} × ${String(r.diameterMm).replace(".", ",")} мм`]), String(value));
}

export function smdSelect(value: SmdSize): string {
  return selectField(
    "smd",
    "Типоразмер корпуса",
    (Object.keys(SMD_SIZES) as SmdSize[]).map((k) => [k, `${k} · до ${formatSI(SMD_SIZES[k].ratedW, "Вт")}`]),
    value,
  );
}

export function lampSelect(value: string): string {
  return selectField("lamp", "Лампа", Object.entries(LAMPS).map(([k, v]) => [k, v.label]), value);
}

export function batterySelect(value: string): string {
  return selectField("battery", "Батарея", Object.entries(BATTERIES).map(([k, v]) => [k, v.label]), value);
}

export function capacitanceSelect(variant: "electrolytic" | "ceramic", uF: number): string {
  return variant === "electrolytic"
    ? selectField("uF", "Ёмкость", ELECTROLYTICS.map((e) => [String(e.uF), formatFarads(e.uF)]), String(uF))
    : selectField("uF", "Ёмкость", CERAMICS.map((e) => [String(e.uF), `${formatFarads(e.uF)} (${e.code})`]), String(uF));
}

export function voltsSelect(variant: "electrolytic" | "ceramic", value: number): string {
  const list = variant === "electrolytic" ? ELECTROLYTIC_VOLTAGES : CERAMIC_VOLTAGES;
  return selectField("capV", "Напряжение (не больше)", list.map((v) => [String(v), formatV(v)]), String(value));
}

export function diodeSelect(value: DiodeKind): string {
  const note: Record<DiodeKind, string> = { "1N4148": "импульсный, стекло", "1N4007": "выпрямительный", "1N5408": "выпрямительный, мощный" };
  return selectField("diode", "Модель", (Object.keys(DIODES) as DiodeKind[]).map((k) => [k, `${DIODES[k].label} — до ${formatSI(DIODES[k].maxA, "А")}, ${note[k]}`]), value);
}

export function ledColorSelect(value: string): string {
  return selectField("led", "Цвет", Object.entries(LEDS).map(([k, v]) => [k, v.label]), value);
}

export function ledSizeSelect(value: LedSize): string {
  return selectField("ledSize", "Мощность", (Object.keys(LED_SIZES) as LedSize[]).map((k) => [k, LED_SIZES[k].label]), value);
}

export function bjtSelect(value: string): string {
  return selectField("bjt", "Тип", Object.entries(TRANSISTORS).map(([k, v]) => [k, `${v.label} (${v.polarity === "npn" ? "n-p-n" : "p-n-p"})`]), value);
}

export function fetSelect(value: string): string {
  return selectField("fet", "Тип", Object.entries(MOSFETS).map(([k, v]) => [k, `${v.label} (${v.channel.toUpperCase()}-канал, ${v.pkg})`]), value);
}

/** «исток, затвор, сток» — роли ножек корпуса слева направо. */
export function mosfetPinNames(kind: MosfetKind): string {
  const names = { G: "затвор", D: "сток", S: "исток" } as const;
  return MOSFETS[kind].pins.map((r) => names[r]).join(", ");
}

/** Три прибора в ряд: по умолчанию U, I, P. */
export function readout(u: number, i: number, p: number, third: [string, string] = ["P", formatSI(p, "Вт")]): string {
  return `<dl class="readout">
      <div><dt>U</dt><dd>${formatSI(u, "В")}</dd></div>
      <div><dt>I</dt><dd>${formatSI(i, "А")}</dd></div>
      <div><dt>${third[0]}</dt><dd>${third[1]}</dd></div>
    </dl>`;
}

/** Строка «ключ — значение». */
export function kv(name: string, value: string): string {
  return `<div class="kv"><span>${name}</span><span>${value}</span></div>`;
}

/** Строка реального параметра этого экземпляра (режим допусков). */
export function actualRow(name: string, value: string): string {
  return `<div class="kv actual"><span>${name}</span><span>${value}</span></div>`;
}

/** Отклонение от номинала: «+3,2 %», «−0,5 %». */
export function pct(actual: number, nominal: number): string {
  const d = (actual / nominal - 1) * 100;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1).replace(".", ",")} %`;
}

/** Плашка состояния. */
export function pill(cls: "ok" | "warn" | "bad", text: string): string {
  return `<span class="pill ${cls}">${text}</span>`;
}

export function superscript(n: number): string {
  return String(n).replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);
}

/** Какой вывод полярной детали ставится первым: у конденсатора — плюс, у диода — анод. */
export type PolarWords = "plus" | "anode";

/** Пояснение в панели новой полярной детали. */
export function polarNote(w: PolarWords): string {
  return `<p class="sub"><b>Полярная деталь.</b> Первое отверстие — ${w === "plus" ? "плюс" : "анод (+)"}, второе — ${w === "plus" ? "минус" : "катод (−)"}.</p>`;
}

/**
 * Подсказка при установке двухвыводной детали. pending — отверстие первого вывода;
 * polar — какие выводы у полярной детали (без него — выводы равноправны).
 */
export function twoPinHint(pending?: string, polar?: PolarWords): string {
  const first = polar === "plus" ? "плюса (+)" : "анода (+)";
  const second = polar === "plus" ? "минуса (−)" : "катода (−)";
  return pending
    ? `${polar ? (polar === "plus" ? "Плюс" : "Анод") : "Первый вывод"} в <b>${pending}</b>, теперь отверстие для ${polar ? second : "второго"}. Esc — отмена.`
    : polar
      ? `Сначала отверстие для <b>${first}</b>, потом для <b>${second}</b>. Не той стороной — выберите деталь и нажмите F.`
      : "Нажмите на <b>два отверстия</b> — деталь встанет между ними. Или на <b>стол</b>, чтобы положить рядом.";
}
