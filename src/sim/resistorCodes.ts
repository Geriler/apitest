/** Маркировка резисторов: ряд E12, цветные полосы (выводные) и цифровой код (SMD). */

export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** Номиналы E12 от 1 Ом до 1 МОм. */
export function e12Values(): number[] {
  const out: number[] = [];
  for (let decade = 0; decade <= 5; decade++) {
    for (const v of E12) out.push(round3(v * 10 ** decade));
  }
  out.push(1_000_000);
  return out;
}

export const BAND_COLORS = [
  { name: "чёрный", hex: "#1a1a1a" },
  { name: "коричневый", hex: "#6b3a1e" },
  { name: "красный", hex: "#c8201e" },
  { name: "оранжевый", hex: "#e8741c" },
  { name: "жёлтый", hex: "#f2d024" },
  { name: "зелёный", hex: "#2e9a3c" },
  { name: "синий", hex: "#2455c8" },
  { name: "фиолетовый", hex: "#7a3ab8" },
  { name: "серый", hex: "#8a8a8a" },
  { name: "белый", hex: "#f4f4f4" },
] as const;

export const GOLD = { name: "золотой", hex: "#c9a13b" };
export const SILVER = { name: "серебряный", hex: "#b8bcc2" };

export interface Band {
  name: string;
  hex: string;
}

/**
 * Четыре полосы: две цифры, множитель, допуск (золото = ±5 %).
 * Номинал округляется до двух значащих цифр, как в ряду E12/E24.
 */
export function colorBands(ohms: number): Band[] {
  if (!(ohms >= 0.1 && ohms < 1e11)) throw new RangeError(`Номинал вне диапазона: ${ohms}`);
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const multiplier = exp === -1 ? GOLD : exp === -2 ? SILVER : BAND_COLORS[exp];
  return [BAND_COLORS[d1], BAND_COLORS[d2], multiplier, GOLD];
}

/**
 * Трёхзначный код SMD (серии E24, ±5 %): «103» = 10 × 10³ = 10 кОм.
 * Меньше 10 Ом буква R заменяет запятую: «4R7» = 4,7 Ом, «R47» = 0,47 Ом.
 */
export function smdCode(ohms: number): string {
  if (!(ohms > 0)) throw new RangeError(`Номинал должен быть > 0: ${ohms}`);
  if (ohms < 1) return `R${Math.round(ohms * 100).toString().padStart(2, "0")}`;
  if (ohms < 10) return (Math.round(ohms * 10) / 10).toFixed(1).replace(".", "R");
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  return `${digits}${exp}`;
}

/** «4,7 кОм», «220 Ом», «1 МОм». */
export function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${formatNumber(ohms / 1e6)} МОм`;
  if (ohms >= 1e3) return `${formatNumber(ohms / 1e3)} кОм`;
  return `${formatNumber(ohms)} Ом`;
}

/** Число с 3 значащими цифрами, запятая как разделитель. */
export function formatNumber(v: number): string {
  return String(round3(v)).replace(".", ",");
}

/** Величина с приставкой: 0.0123 А → «12,3 мА». */
export function formatSI(v: number, unit: string): string {
  const a = Math.abs(v);
  if (a < 1e-9) return `0 ${unit}`;
  if (a >= 1e3) return `${formatNumber(v / 1e3)} к${unit}`;
  if (a >= 1) return `${formatNumber(v)} ${unit}`;
  if (a >= 1e-3) return `${formatNumber(v * 1e3)} м${unit}`;
  if (a >= 1e-6) return `${formatNumber(v * 1e6)} мк${unit}`;
  return `${formatNumber(v * 1e9)} н${unit}`;
}

function round3(v: number): number {
  if (v === 0) return 0;
  // Только целые степени десяти, чтобы не получить 1199,9999…
  const e = Math.floor(Math.log10(Math.abs(v))) - 2;
  return e >= 0 ? Math.round(v / 10 ** e) * 10 ** e : Math.round(v * 10 ** -e) / 10 ** -e;
}
