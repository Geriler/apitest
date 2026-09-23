/** Подписи величин для панелей, схемы и сообщений: запятая, узкие единицы. */

/** «0,125 Вт», «2 Вт». */
export function formatW(w: number): string {
  return `${String(w).replace(".", ",")} Вт`;
}

/** «6,3 В», «50 В». */
export function formatV(v: number): string {
  return `${String(v).replace(".", ",")} В`;
}
