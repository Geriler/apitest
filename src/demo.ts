import type { Scene } from "./model/types";

/**
 * Пример: отсек 3 × AA (4,5 В) слева от платы, провода к верхним шинам.
 *
 * Ветвь 1 (включена): SA1 → R1 3,3 Ом (выводной) → HL1 3,5 В × 0,26 А.
 *   I ≈ 4,5 / (0,45 + 3,3 + 13,5) ≈ 0,26 А — лампа горит в полный накал,
 *   на R1 ≈ 0,23 Вт при номинале 0,25 Вт.
 * Верхние шины соединены с нижними перемычками W3, W4.
 * Ветвь 2 (выключена, внизу): SA2 → R2 22 Ом → HL2 2,5 В × 0,3 А.
 *   Если замкнуть SA2: на R2 ≈ 0,45 Вт (178 % от 0,25 Вт) — сгорит примерно за 2 с.
 *   68 Ом выдержат (≈ 88 %), но лампа почти погаснет: нужен резистор помощнее.
 */
export function demoScene(): Scene {
  return {
    components: [
      { id: "GB1", type: "battery", kind: "4.5V", placement: { mode: "free", x: -32, z: -4, rot: 0 } },
      { id: "SA1", type: "switch", closed: true, placement: { mode: "board", holes: ["top+3", "a4"] } },
      { id: "R1", type: "resistor", variant: "tht", ohms: 3.3, smdSize: "0805", placement: { mode: "board", holes: ["c4", "c9"] } },
      { id: "HL1", type: "lamp", kind: "3.5V", placement: { mode: "board", holes: ["a9", "top-8"] } },
      { id: "SA2", type: "switch", closed: false, placement: { mode: "board", holes: ["bot+16", "j20"] } },
      { id: "R2", type: "resistor", variant: "tht", ohms: 22, smdSize: "0805", placement: { mode: "board", holes: ["h20", "h25"] } },
      { id: "HL2", type: "lamp", kind: "2.5V", placement: { mode: "board", holes: ["j25", "bot-22"] } },
    ],
    wires: [
      { id: "W1", a: { comp: "GB1", pin: 0 }, b: { hole: "top-1" }, color: "#1b1d20" },
      { id: "W2", a: { comp: "GB1", pin: 1 }, b: { hole: "top+1" }, color: "#c8261f" },
      { id: "W3", a: { hole: "top+25" }, b: { hole: "bot+25" }, color: "#c8261f" },
      { id: "W4", a: { hole: "top-24" }, b: { hole: "bot-24" }, color: "#1b1d20" },
    ],
  };
}

/**
 * Пример 2: «Крона» 9 В, конденсатор и светодиоды.
 *
 * Сверху: SA1 → R1 100 Ом → C1 4700 мкФ (плюс в a8, минус на шину −).
 *   От C1 через R2 470 Ом питается красный светодиод HL1. Пока SA1 замкнут, C1 заряжен
 *   и HL1 горит (≈ 12 мА). Если разомкнуть SA1, HL1 питается только от C1 и гаснет
 *   за несколько секунд: τ ≈ 470 Ом × 4700 мкФ ≈ 2,2 с.
 * Снизу: два одинаковых зелёных светодиода с резисторами 470 Ом, HL3 вставлен наоборот
 *   (анод на минусе) — он не горит. Выберите его и нажмите F.
 */
export function ledDemoScene(): Scene {
  return {
    components: [
      { id: "GB1", type: "battery", kind: "9V", placement: { mode: "free", x: -32, z: -4, rot: 0 } },
      { id: "SA1", type: "switch", closed: true, placement: { mode: "board", holes: ["top+3", "a4"] } },
      { id: "R1", type: "resistor", variant: "tht", ohms: 100, smdSize: "0805", placement: { mode: "board", holes: ["c4", "c8"] } },
      { id: "C1", type: "capacitor", variant: "electrolytic", uF: 4700, placement: { mode: "board", holes: ["a8", "top-6"] } },
      { id: "R2", type: "resistor", variant: "tht", ohms: 470, smdSize: "0805", placement: { mode: "board", holes: ["e8", "e13"] } },
      { id: "HL1", type: "led", color: "red", placement: { mode: "board", holes: ["d13", "top-12"] } },
      { id: "R3", type: "resistor", variant: "tht", ohms: 470, smdSize: "0805", placement: { mode: "board", holes: ["bot+17", "j20"] } },
      { id: "HL2", type: "led", color: "green", placement: { mode: "board", holes: ["i20", "bot-19"] } },
      { id: "R4", type: "resistor", variant: "tht", ohms: 470, smdSize: "0805", placement: { mode: "board", holes: ["bot+22", "j26"] } },
      // Вставлен наоборот: анод на шине −, катод к резистору
      { id: "HL3", type: "led", color: "green", placement: { mode: "board", holes: ["bot-24", "i26"] } },
    ],
    wires: [
      { id: "W1", a: { comp: "GB1", pin: 0 }, b: { hole: "top-1" }, color: "#1b1d20" },
      { id: "W2", a: { comp: "GB1", pin: 1 }, b: { hole: "top+1" }, color: "#c8261f" },
      { id: "W3", a: { hole: "top+25" }, b: { hole: "bot+25" }, color: "#c8261f" },
      { id: "W4", a: { hole: "top-25" }, b: { hole: "bot-25" }, color: "#1b1d20" },
    ],
  };
}
