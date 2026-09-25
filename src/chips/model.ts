/**
 * Модель микросхемы для расчёта: вместо сотен транзисторов начинки — логика и несколько
 * сопротивлений, снятых с её же проверки по транзисторам (см. career/build: characterize).
 *
 * Выход k — ключ: к выводу питания через rHigh, когда по таблице единица, и к общему через rLow,
 * когда ноль. Вход — сопротивление rIn на общий (у КМОП почти бесконечное, у РТЛ — ток базы).
 * Между питанием и общим — ток покоя. Вход считается единицей выше половины питания.
 *
 * Так считаются микросхемы, которые уже прошли проверку, — внутри чужой сборки или на столе.
 * То, что игрок собирает сейчас, раскрывается до транзисторов (Simulation, опция expand).
 */

import type { ChipDef, Scene } from "../model/types";

/** Установившееся состояние модели: входы и выходы после прошлого расчёта. */
export interface ModelState {
  inputs: boolean[];
  outputs: boolean[];
}

export interface ChipModel {
  /** Выводы (с 1): входы и выходы в порядке таблицы истинности, питание и общий. */
  inputs: number[];
  outputs: number[];
  vcc: number;
  gnd: number;
  /**
   * Что на выходах при данных входах. prev — установившееся состояние с прошлого расчёта (входы
   * и выходы): по нему триггеры помнят, что хранят, и узнают фронт. У вентилей не нужен.
   */
  logic(bits: boolean[], prev?: ModelState): boolean[];
  /** Параметры, снятые при разных напряжениях питания, — по возрастанию напряжения. */
  points: ModelPoint[];
  /**
   * В каком диапазоне питания модель проверена, В. Вне его (и выше 0,5 В) в свободной схеме
   * микросхема считается по транзисторам — модели там верить нельзя.
   */
  vmin: number;
  vmax: number;
  /** Предельное питание, В: выше — выходит из строя (у заводских 74LVC — 6,5 В, как в паспорте). */
  absMax?: number;
}

/** Параметры модели при одном напряжении питания. */
export interface ModelPoint {
  volts: number;
  /** Сопротивление выхода к питанию (когда единица) и к общему (когда ноль), Ом. */
  rHigh: number[];
  rLow: number[];
  /** Просадка выхода без нагрузки, В: единица — питание минус dHigh, ноль — общий плюс dLow. */
  dHigh: number[];
  dLow: number[];
  /** Сопротивление входа, Ом: у РТЛ — на общий (ток базы), у КМОП — почти бесконечное. */
  rIn: number[];
  /** Ток покоя от питания, А (в среднем по таблице). */
  iq: number;
}

/** Параметры при питании span: между снятыми точками — по прямой, за краями — как у крайней. */
export function modelAt(m: ChipModel, span: number): ModelPoint {
  const ps = m.points;
  if (span <= ps[0].volts) return ps[0];
  if (span >= ps[ps.length - 1].volts) return ps[ps.length - 1];
  const i = ps.findIndex((p) => p.volts >= span);
  const a = ps[i - 1], b = ps[i];
  const t = (span - a.volts) / (b.volts - a.volts);
  const mix = (x: number[], y: number[]) => x.map((v, k) => v + (y[k] - v) * t);
  return { volts: span, rHigh: mix(a.rHigh, b.rHigh), rLow: mix(a.rLow, b.rLow), dHigh: mix(a.dHigh, b.dHigh), dLow: mix(a.dLow, b.dLow), rIn: mix(a.rIn, b.rIn), iq: a.iq + (b.iq - a.iq) * t };
}

/** Предельное питание заводских 74LVC, В (абсолютный максимум по паспорту). */
export const REF_ABS_MAX = 6.5;
/** Во сколько раз слабее ключи неопределённого выхода: оба приоткрыты. */
export const X_FACTOR = 20;

/** Вход КМОП (сопротивление больше этого) не тянется ни к чему: висящий уходит к середине питания. */
export const CMOS_INPUT = 1e8;

/** Выход сверх такого тока перегружен: как предел по току выхода у логики 74-й серии. */
export const MODEL_MAX_OUT = 0.05;
/** «Разомкнуто»: ключ выхода выключен. */
export const MODEL_OFF = 1e9;

type Source = (def: ChipDef, scene: Scene) => ChipModel | undefined;
let source: Source = () => undefined;

/** Откуда брать модели (приложение и проверка карьеры подключают снятие параметров). */
export function setModelSource(f: Source): void {
  source = f;
}

/** Модель микросхемы или undefined — тогда её начинка считается целиком. */
export const chipModel = (def: ChipDef, scene: Scene): ChipModel | undefined => source(def, scene);
