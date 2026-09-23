import { DEFAULT_BOARDS, applyBoards, padsAlong } from "./model/breadboard";
import type { Scene, Trace } from "./model/types";

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

/**
 * Пример 3: мигалка на двух транзисторах (симметричный мультивибратор).
 *
 * Сверху VT1 (BC547) в c10–c12, снизу VT2 в h20–h22. В коллекторах — светодиоды
 * через 470 Ом, базы через 10 кОм и 12 кОм к плюсу, перекрёстные конденсаторы 100 мкФ
 * плюсом к коллектору; минус каждого конденсатора проводом идёт на базу другого транзистора.
 * Полупериоды ≈ 0,69·R·C: 0,69 с и 0,83 с — светодиоды мигают по очереди примерно раз в 1,5 с.
 * Номиналы баз разные нарочно: в идеально симметричной схеме оба транзистора могут открыться сразу.
 */
export function blinkerScene(): Scene {
  const r = (id: string, ohms: number, holes: string[]) =>
    ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: { mode: "board", holes } }) as const;
  return {
    components: [
      { id: "GB1", type: "battery", kind: "9V", placement: { mode: "free", x: -32, z: -4, rot: 0 } },
      { id: "VT1", type: "transistor", kind: "BC547", placement: { mode: "board", holes: ["c10", "c11", "c12"] } },
      r("R1", 470, ["top+6", "b7"]),
      { id: "HL1", type: "led", color: "red", placement: { mode: "board", holes: ["d7", "d10"] } },
      r("R2", 10_000, ["top+14", "b11"]),
      { id: "C1", type: "capacitor", variant: "electrolytic", uF: 100, placement: { mode: "board", holes: ["e10", "e14"] } },
      { id: "VT2", type: "transistor", kind: "BC547", placement: { mode: "board", holes: ["h20", "h21", "h22"] } },
      r("R3", 470, ["bot+16", "i17"]),
      { id: "HL2", type: "led", color: "green", placement: { mode: "board", holes: ["g17", "g20"] } },
      r("R4", 12_000, ["bot+24", "i21"]),
      { id: "C2", type: "capacitor", variant: "electrolytic", uF: 100, placement: { mode: "board", holes: ["f20", "f24"] } },
    ],
    wires: [
      { id: "W1", a: { comp: "GB1", pin: 0 }, b: { hole: "top-1" }, color: "#1b1d20" },
      { id: "W2", a: { comp: "GB1", pin: 1 }, b: { hole: "top+1" }, color: "#c8261f" },
      { id: "W3", a: { hole: "top+25" }, b: { hole: "bot+25" }, color: "#c8261f" },
      { id: "W4", a: { hole: "top-25" }, b: { hole: "bot-25" }, color: "#1b1d20" },
      // Эмиттеры на минус
      { id: "W5", a: { hole: "a12" }, b: { hole: "top-10" }, color: "#2f6fd1" },
      { id: "W6", a: { hole: "j22" }, b: { hole: "bot-19" }, color: "#2f6fd1" },
      // Перекрёстные связи: минус C1 → база VT2, минус C2 → база VT1
      { id: "W7", a: { hole: "d14" }, b: { hole: "g21" }, color: "#e3b21c" },
      { id: "W8", a: { hole: "g24" }, b: { hole: "d11" }, color: "#2f9e5a" },
    ],
  };
}

/**
 * Пример 4: MOSFET — ключ и «память» затвора. «Крона» 9 В.
 *
 * Сверху: 2N7000 (ножки И-З-С в c10–c12) включает красный светодиод через 470 Ом.
 *   Затвор — тумблер SA1 к плюсу и резистор 100 кОм от затвора к истоку: разомкнули SA1 — погас.
 * Снизу: IRLZ44N (З-С-И в h20–h22) включает лампу 12 В. Стягивающего резистора нет:
 *   замкните и разомкните SA2 — лампа продолжит гореть, затвор держит заряд. SA3 замыкает
 *   затвор на исток и гасит лампу.
 */
export function mosfetScene(): Scene {
  return {
    components: [
      { id: "GB1", type: "battery", kind: "9V", placement: { mode: "free", x: -32, z: -4, rot: 0 } },
      { id: "VT1", type: "mosfet", kind: "2N7000", placement: { mode: "board", holes: ["c10", "c11", "c12"] } },
      { id: "HL1", type: "led", color: "red", placement: { mode: "board", holes: ["a15", "a12"] } },
      { id: "R1", type: "resistor", variant: "tht", ohms: 470, smdSize: "0805", placement: { mode: "board", holes: ["top+14", "b15"] } },
      { id: "SA1", type: "switch", closed: true, placement: { mode: "board", holes: ["top+7", "b11"] } },
      { id: "R2", type: "resistor", variant: "tht", ohms: 100_000, smdSize: "0805", placement: { mode: "board", holes: ["e11", "e10"] } },
      { id: "VT2", type: "mosfet", kind: "IRLZ44N", placement: { mode: "board", holes: ["h20", "h21", "h22"] } },
      { id: "HL2", type: "lamp", kind: "12V", placement: { mode: "board", holes: ["bot+22", "j21"] } },
      { id: "SA2", type: "switch", closed: false, placement: { mode: "board", holes: ["bot+16", "i20"] } },
      { id: "SA3", type: "switch", closed: false, placement: { mode: "board", holes: ["f20", "f22"] } },
    ],
    wires: [
      { id: "W1", a: { comp: "GB1", pin: 0 }, b: { hole: "top-1" }, color: "#1b1d20" },
      { id: "W2", a: { comp: "GB1", pin: 1 }, b: { hole: "top+1" }, color: "#c8261f" },
      { id: "W3", a: { hole: "top+25" }, b: { hole: "bot+25" }, color: "#c8261f" },
      { id: "W4", a: { hole: "top-25" }, b: { hole: "bot-25" }, color: "#1b1d20" },
      // Истоки на минус
      { id: "W5", a: { hole: "a10" }, b: { hole: "top-9" }, color: "#2f6fd1" },
      { id: "W6", a: { hole: "j22" }, b: { hole: "bot-19" }, color: "#2f6fd1" },
    ],
  };
}

/** Дорожки по ломаной из площадок, с делением в каждой пересечённой площадке (как в редакторе). */
function tracePath(prefix: string, pads: string[], counter: { n: number }): Trace[] {
  const out: Trace[] = [];
  for (let i = 0; i < pads.length - 1; i++) {
    const seg = padsAlong(pads[i], pads[i + 1]);
    for (let k = 0; k < seg.length - 1; k++) out.push({ id: `${prefix}${counter.n++}`, a: seg[k], b: seg[k + 1] });
  }
  return out;
}

/**
 * Пример 5: печатная плата и лабораторный блок питания.
 *
 * Блок 9 В / 100 мА подключён к площадкам A1 (+) и N1 (−). Дорожки: шина «+» по ряду A,
 * шина «−» по ряду N; от них — два светодиода с резисторами 470 Ом (красный и зелёный).
 * Ток ≈ (9 − 2) / 470 ≈ 15 мА на каждый — блок в режиме CV.
 * Если выставить ограничение 20 мА, блок перейдёт в CC: напряжение упадёт, светодиоды потускнеют.
 */
export function pcbScene(): Scene {
  // Дорожки делятся по площадкам, а их ищут среди плат на столе. На столе может не быть
  // печатной платы (после «Очистить») — поэтому сначала стартовый набор, как в самой схеме.
  applyBoards(DEFAULT_BOARDS);
  const c = { n: 1 };
  return {
    boards: DEFAULT_BOARDS.map((b) => ({ ...b })),
    components: [
      { id: "G1", type: "psu", volts: 9, amps: 0.1, on: true, placement: { mode: "free", x: -31, z: 21, rot: 0 } },
      { id: "R1", type: "resistor", variant: "tht", ohms: 470, smdSize: "0805", placement: { mode: "board", holes: ["pC4", "pC8"] } },
      { id: "HL1", type: "led", color: "red", placement: { mode: "board", holes: ["pE8", "pF8"] } },
      { id: "R2", type: "resistor", variant: "tht", ohms: 470, smdSize: "0805", placement: { mode: "board", holes: ["pC12", "pC16"] } },
      { id: "HL2", type: "led", color: "green", placement: { mode: "board", holes: ["pE16", "pF16"] } },
    ],
    wires: [
      { id: "W1", a: { comp: "G1", pin: 1 }, b: { hole: "pA1" }, color: "#c8261f" },
      { id: "W2", a: { comp: "G1", pin: 0 }, b: { hole: "pN1" }, color: "#1b1d20" },
    ],
    traces: [
      ...tracePath("T", ["pA1", "pA20"], c), // шина +
      ...tracePath("T", ["pN1", "pN20"], c), // шина −
      ...tracePath("T", ["pA4", "pC4"], c),
      ...tracePath("T", ["pC8", "pE8"], c),
      ...tracePath("T", ["pF8", "pN8"], c),
      ...tracePath("T", ["pA12", "pC12"], c),
      ...tracePath("T", ["pC16", "pE16"], c),
      ...tracePath("T", ["pF16", "pN16"], c),
    ],
  };
}
