import * as THREE from "three";
import { BOARD, COLUMNS, ROWS, boardHoles, boardSize, chipField, chipPinName, packageName, padX, pinOffsets, padZ, type BoardSpec } from "../model/breadboard";
import { PIN_ROLES } from "../chips/roles";

/** Пикселей на единицу длины (шаг 2,54 мм) в текстуре платы. */
const PX = 48;

/** Верх макетной платы: отверстия, подписи столбцов и рядов, линии шин. */
export function breadboardTexture(): THREE.CanvasTexture {
  const w = BOARD.width * PX;
  const h = BOARD.depth * PX;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const X = (x: number) => (x + BOARD.width / 2) * PX;
  const Z = (z: number) => (z + BOARD.depth / 2) * PX;

  g.fillStyle = "#f3f1ea";
  g.fillRect(0, 0, w, h);

  // Центральная канавка
  g.fillStyle = "#dcd8cc";
  g.fillRect(0, Z(-0.45), w, 0.9 * PX);

  // Линии шин: красная у «+», синяя у «−»
  for (const [z, color] of [
    [-9.75, "#d2332a"],
    [-7.25, "#2b5fb8"],
    [7.25, "#2b5fb8"],
    [9.75, "#d2332a"],
  ] as const) {
    g.fillStyle = color;
    g.fillRect(X(-14.6), Z(z) - 2, (28.2) * PX, 4);
  }

  g.font = `600 ${PX * 0.5}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#d2332a";
  g.fillText("+", X(-15.3), Z(-9));
  g.fillText("+", X(-15.3), Z(9));
  g.fillStyle = "#2b5fb8";
  g.fillText("−", X(-15.3), Z(-8));
  g.fillText("−", X(-15.3), Z(8));

  // Подписи столбцов и рядов
  g.fillStyle = "#8a8474";
  g.font = `500 ${PX * 0.36}px "IBM Plex Mono", ui-monospace, monospace`;
  for (let c = 1; c <= COLUMNS; c++) {
    if (c === 1 || c % 5 === 0) {
      g.fillText(String(c), X(c - 15.5), Z(-6.45));
      g.fillText(String(c), X(c - 15.5), Z(6.45));
    }
  }
  ROWS.forEach((r, i) => {
    const z = i < 5 ? -5.5 + i : 1.5 + (i - 5);
    g.fillText(r, X(-15.3), Z(z));
    g.fillText(r, X(15.3), Z(z));
  });

  // Отверстия: квадратные гнёзда с тенью
  const s = 0.42 * PX;
  // Текстура общая для всех макеток: отверстия платы с центром в начале координат
  for (const hole of boardHoles({ id: "BB1", kind: "breadboard", x: 0, z: 0 })) {
    const cx = X(hole.x);
    const cz = Z(hole.z);
    g.fillStyle = "#c9c4b5";
    g.fillRect(cx - s / 2 - 2, cz - s / 2 - 2, s + 4, s + 4);
    g.fillStyle = "#2a2926";
    g.fillRect(cx - s / 2, cz - s / 2, s, s);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Антистатический коврик: матовый серо-зелёный с сеткой 10 мм. */
export function matTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#4d676c";
  g.fillRect(0, 0, size, size);
  // лёгкий шум
  for (let i = 0; i < 6000; i++) {
    const v = Math.random() * 18 - 9;
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  g.strokeStyle = "rgba(20,32,35,0.35)";
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i * size) / 4;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Маркировка на верхней грани SMD-резистора. */
export function smdLabelTexture(code: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#15171a";
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#e9e6dc";
  g.font = `600 84px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(code, 128, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Мягкое круглое пятно для дыма и искр. */
export function puffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Печатная плата cols × rows: зелёная маска, лужёные площадки с отверстиями, шелкография
 * (номера и буквы). Общая для всех плат этого размера.
 */
export function pcbTexture(cols: number, rows: number): THREE.CanvasTexture {
  const spec: BoardSpec = { id: "PCB1", kind: "pcb", x: 0, z: 0, cols, rows };
  const size = boardSize(spec);
  const holes = boardHoles(spec);
  const w = size.width * PX;
  const h = size.depth * PX;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const X = (x: number) => (x + size.width / 2) * PX;
  const Z = (z: number) => (z + size.depth / 2) * PX;
  g.fillStyle = "#1f5c3a";
  g.fillRect(0, 0, w, h);
  // Рамка шелкографии
  g.strokeStyle = "#e8ecdf";
  g.lineWidth = 3;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = "#e8ecdf";
  g.font = `500 ${PX * 0.36}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let c = 1; c <= cols; c++) {
    if (c === 1 || c % 5 === 0) g.fillText(String(c), X(padX(spec, c)), Z(padZ(spec, 0)) - PX * 0.85);
  }
  for (let i = 0; i < rows; i++) g.fillText("ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i], X(padX(spec, 1)) - PX * 0.85, Z(padZ(spec, i)));
  g.textAlign = "right";
  g.fillText("МАКЕТКА · PCB 1,6 мм", w - PX * 0.5, h - PX * 0.45);
  // Площадки: лужёное кольцо и отверстие
  for (const hole of holes) {
    const cx = X(hole.x);
    const cz = Z(hole.z);
    g.fillStyle = "#c9ccc4";
    g.beginPath();
    g.arc(cx, cz, PX * 0.36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#15191a";
    g.beginPath();
    g.arc(cx, cz, PX * 0.16, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Плата под SMD: зелёная маска без сетки (площадки появляются под деталями), вдоль ближнего
 * края — площадки для проводов J1…Jn с подписями.
 */
export function smdBoardTexture(cols: number, rows: number): THREE.CanvasTexture {
  const spec: BoardSpec = { id: "S1", kind: "smd", x: 0, z: 0, cols, rows };
  const size = boardSize(spec);
  const w = size.width * PX;
  const h = size.depth * PX;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const X = (x: number) => (x + size.width / 2) * PX;
  const Z = (z: number) => (z + size.depth / 2) * PX;
  g.fillStyle = "#1f5c3a";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#e8ecdf";
  g.lineWidth = 3;
  g.strokeRect(6, 6, w - 12, h - 12);
  // Граница поля деталей
  g.setLineDash([10, 8]);
  g.lineWidth = 2;
  g.strokeRect(PX * 0.5, PX * 0.5, w - PX, h - PX * 2.5);
  g.setLineDash([]);
  g.fillStyle = "#e8ecdf";
  g.textAlign = "right";
  g.textBaseline = "middle";
  g.font = `500 ${PX * 0.34}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText("ПЛАТА ПОД SMD · PCB 1,6 мм", w - PX * 0.7, PX * 0.95);
  g.textAlign = "center";
  for (const hole of boardHoles(spec)) {
    const cx = X(hole.x);
    const cz = Z(hole.z);
    g.fillStyle = "#c9ccc4";
    g.beginPath();
    g.arc(cx, cz, PX * 0.34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#15191a";
    g.beginPath();
    g.arc(cx, cz, PX * 0.14, 0, Math.PI * 2);
    g.fill();
    const n = Number(hole.id.replace(/^.*J/, ""));
    if (n === 1 || n % 5 === 0) {
      g.fillStyle = "#e8ecdf";
      g.fillText(`J${n}`, cx, cz - PX * 0.62);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Корпус своей микросхемы: чёрный пластик, посередине — поле площадок (как кристалл),
 * по краям — площадки выводов с номерами и назначением, ключ у вывода 1, название.
 */
export function chipTexture(b: BoardSpec): THREE.CanvasTexture {
  const spec: BoardSpec = { ...b, x: 0, z: 0 };
  const size = boardSize(spec);
  const f = chipField(spec);
  const w = size.width * PX;
  const h = size.depth * PX;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const X = (x: number) => (x + size.width / 2) * PX;
  const Z = (z: number) => (z + size.depth / 2) * PX;
  g.fillStyle = "#1c1e21";
  g.fillRect(0, 0, w, h);
  // Поле начинки — светлее, как кристалл
  const fx0 = X(padX(spec, 1)) - PX * 0.7, fx1 = X(padX(spec, f.cols)) + PX * 0.7;
  const fz0 = Z(padZ(spec, 0)) - PX * 0.7, fz1 = Z(padZ(spec, f.rows - 1)) + PX * 0.7;
  g.fillStyle = "#34383d";
  g.fillRect(fx0, fz0, fx1 - fx0, fz1 - fz0);
  g.strokeStyle = "#5b6168";
  g.lineWidth = 2;
  g.strokeRect(fx0, fz0, fx1 - fx0, fz1 - fz0);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const n = spec.pins ?? 8;
  for (const hole of boardHoles(spec)) {
    // Площадки SMD-деталей рисуются медью поверх (они двигаются вместе с деталями)
    if (hole.seat) continue;
    const cx = X(hole.x);
    const cz = Z(hole.z);
    if (hole.pin) {
      const i = hole.pin - 1;
      const role = spec.roles?.[i] ?? "nc";
      const near = pinOffsets(spec.package, n)[i][1] === 0;
      // Площадка вывода — золочёная, с полоской цвета назначения к краю корпуса
      g.fillStyle = PIN_ROLES[role].color === "#1b1d20" ? "#e8e9eb" : PIN_ROLES[role].color;
      g.fillRect(cx - PX * 0.42, near ? cz + PX * 0.45 : cz - PX * 0.75, PX * 0.84, PX * 0.3);
      g.fillStyle = "#d4a24a";
      g.fillRect(cx - PX * 0.42, cz - PX * 0.42, PX * 0.84, PX * 0.84);
      g.fillStyle = "#15191a";
      g.beginPath();
      g.arc(cx, cz, PX * 0.16, 0, Math.PI * 2);
      g.fill();
      // Номер и имя — между площадкой и полем
      g.fillStyle = role === "nc" ? "#8a8f96" : "#e8e9eb";
      g.font = `700 ${PX * 0.42}px "IBM Plex Mono", ui-monospace, monospace`;
      const label = `${hole.pin} ${chipPinName(spec, i)}`;
      g.fillText(label, cx, cz + (near ? -1 : 1) * PX * 0.95);
      continue;
    }
    g.fillStyle = "#b9bcb4";
    g.beginPath();
    g.arc(cx, cz, PX * 0.34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#15191a";
    g.beginPath();
    g.arc(cx, cz, PX * 0.15, 0, Math.PI * 2);
    g.fill();
  }
  // Ключ — точка у вывода 1 (левый ближний угол)
  g.fillStyle = "#5b6168";
  g.beginPath();
  g.arc(PX * 0.75, h - PX * 0.75, PX * 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#c9ccd1";
  g.font = `600 ${PX * 0.42}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "left";
  g.fillText(`${spec.label || "СВОЯ МИКРОСХЕМА"} · ${packageName(spec.package, n)}${spec.smd ? " · ПОЛЕ ПОД SMD" : ""}`, PX * 0.6, PX * 0.55);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
