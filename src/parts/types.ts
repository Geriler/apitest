/**
 * Описание типа детали: всё, что отличает резистор от светодиода, — в одном месте.
 * Сама деталь в схеме — простые данные (Component, сохраняются как JSON); поведение —
 * в описании её типа (PARTS[c.type]). Новая деталь = новый файл в этой папке + строка в index.ts.
 */

import type { Component } from "../model/types";
import type { Load, Simulation } from "../sim/simulation";
import type { Branch, Extras } from "../sim/solver";
import type { ComponentView } from "../view/kit";

/** Куда деталь складывает свои ветви для решателя. */
export interface Stamp {
  out: Branch[];
  extras: Required<Extras>;
}

/** Перегрев: выше порога «тепло» копится со скоростью (нагрузка − порог)·rate, ниже — остывает. */
export interface Thermal {
  threshold: number;
  rate: number;
  cooling: number;
}

export interface PartDef<C extends Component = Component> {
  type: C["type"];
  /** Буква обозначения по ЕСКД: R, C, VD, HL, VT, SA, GB, G. */
  prefix: string;
  /** Число выводов. */
  pins: number;
  /** Встаёт ли в плату (у SMD-резистора нет ножек, батарея и блок питания — на столе). */
  onBoard(variant?: "tht" | "smd"): boolean;
  /** Важно ли, какой вывод куда (тогда деталь можно перевернуть клавишей F). */
  polar(c: C): boolean;
  /** Короткая подпись в списке деталей. */
  label(c: C): string;
  /** Номинал для подписи на принципиальной схеме. */
  value(c: C): string;
  /**
   * Обозначение на схеме для двухвыводной детали, в своей системе координат: вывод 0 вверху
   * (y = −20), вывод 1 внизу (y = 20). У трёхвыводных (транзисторы) — своя отрисовка.
   */
  symbol?(c: C): string;
  /** Номинальная мощность, Вт (для перегрева по мощности), если есть. */
  rated?(c: C): number;
  /** Заголовок и пояснение уведомления, когда деталь выходит из строя. */
  burn(c: C): [string, string];
  /** 3D-вид детали на столе или на плате (без припоя — его добавляет builders.ts). */
  view(c: C): ComponentView;

  // ─── Расчёт ─────────────────────────────────────────────────────────────

  /**
   * Ветви детали для решателя при текущих линеаризациях (sim.junction) и шаге sim.h.
   * Вызывается и для сгоревшей детали: она сама решает, что от неё остаётся (обычно — обрыв).
   */
  stamp(c: C, sim: Simulation, s: Stamp): void;
  /**
   * Шаг Ньютона после очередного решения: обновить свои переходы в sim.junction.
   * Возвращает true, если деталь сошлась. Только у нелинейных деталей и только у исправных.
   */
  newton?(c: C, sim: Simulation, iter: number, shared: { flips: number }): boolean;
  /** Есть ли у детали ёмкости (тогда время идёт шагами и нужен remember). */
  dynamic?: boolean;
  /** После шага по времени: запомнить заряд своих ёмкостей в sim.capVoltage. */
  remember?(c: C, sim: Simulation): void;
  /** Напряжение между выводами 0 и 1, В (по умолчанию — по своей ветви). */
  voltage?(c: C, sim: Simulation): number;
  /** Ток от вывода 0 к выводу 1, А (по умолчанию — по своей ветви). */
  current?(c: C, sim: Simulation): number;
  /** Мощность, которая выделяется теплом, Вт (по умолчанию — по своей ветви). */
  power?(c: C, sim: Simulation): number;
  /** Нагрузка относительно предела (для перегрева и панели). */
  load?(c: C, sim: Simulation): Load | undefined;
  thermal?: Thermal;
  /** Короткое замыкание (для батареи — искры). */
  shorted?(c: C, sim: Simulation): boolean;
  /** Включена наоборот и напряжение приложено против неё. */
  reversed?(c: C, sim: Simulation): boolean;
}
