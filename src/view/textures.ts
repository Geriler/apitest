import * as THREE from "three";
import { BOARD, COLUMNS, HOLES, PCB, ROWS, padX, padZ } from "../model/breadboard";

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
  for (const hole of HOLES) {
    if (hole.board !== "breadboard" || hole.bb !== 0) continue; // текстура общая для всех макеток
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

/** Печатная плата: зелёная маска, лужёные площадки с отверстиями, шелкография (номера и буквы). */
export function pcbTexture(): THREE.CanvasTexture {
  const w = PCB.width * PX;
  const h = PCB.depth * PX;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const X = (x: number) => (x - PCB.x + PCB.width / 2) * PX;
  const Z = (z: number) => (z - PCB.z + PCB.depth / 2) * PX;
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
  for (let c = 1; c <= PCB.cols; c++) {
    if (c === 1 || c % 5 === 0) g.fillText(String(c), X(padX(c)), Z(padZ(0)) - PX * 0.85);
  }
  PCB.rows.forEach((r, i) => g.fillText(r, X(padX(1)) - PX * 0.85, Z(padZ(i))));
  g.textAlign = "right";
  g.fillText("МАКЕТКА · PCB 1,6 мм", w - PX * 0.5, h - PX * 0.45);
  // Площадки: лужёное кольцо и отверстие
  for (const hole of HOLES) {
    if (hole.board !== "pcb") continue;
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
