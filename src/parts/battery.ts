import * as THREE from "three";
import { type ComponentView, disposeGroup, freeTransform, labelTexture, leadMaterial, mm, tagPickable } from "../view/kit";
import { BATTERIES, type Battery, type BatteryKind } from "../model/types";
import * as tolerance from "../sim/tolerance";
import { twoPin } from "./common";
import type { PartDef } from "./types";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import { actualRow, batterySelect, readout } from "../view/panel";

/** Батарея считается замкнутой накоротко, если ток больше половины тока КЗ. */
export const SHORT_CIRCUIT_FRACTION = 0.5;

export const battery: PartDef<Battery> = {
  type: "battery",
  prefix: "GB",
  pins: 2,
  onBoard: () => false,
  polar: () => true,
  label: (c) => BATTERIES[c.kind].label,
  value: (c) => BATTERIES[c.kind].label,
  // Вывод 1 — плюс: длинная тонкая пластина со стороны вывода 1 (внизу), короткая толстая — минус
  symbol: () => `<path d="M0 -20V-4M0 4V20M-13 4H13"/><path d="M-7 -4H7" class="thick"/><path d="M9 11H15M12 8V14" class="thin"/>`,
  burn: (c) => [`${c.id} вышел из строя`, ""],

  // Батарея не горит; вывод 0 — минус, вывод 1 — плюс
  stamp(c, sim, { out }) {
    const bat = tolerance.battery(c, sim.tolerance);
    out.push(twoPin(c, bat.rInt, bat.emf));
  },
  // Мощность, которую батарея отдаёт в цепь
  power: (c, sim) => Math.abs(sim.current(c)) * tolerance.battery(c, sim.tolerance).emf,
  shorted(c, sim) {
    const bat = tolerance.battery(c, sim.tolerance);
    return Math.abs(sim.branch(c.id).current) > SHORT_CIRCUIT_FRACTION * (bat.emf / bat.rInt);
  },
  panel(c) {
    const bat = BATTERIES[c.kind];
    return {
      title: `Батарея ${bat.label}`,
      body: `<p class="sub">ЭДС ${formatSI(bat.emf, "В")}, внутреннее сопротивление ${formatOhms(bat.rInt)}. Ток короткого замыкания ≈ ${formatSI(bat.emf / bat.rInt, "А")}. Красный провод — плюс.</p>`,
      editor: batterySelect(c.kind),
    };
  },
  edit(c, field, value) {
    if (field === "battery") c.kind = value as BatteryKind;
  },
  // Показываем то, что батарея отдаёт: напряжение плюса относительно минуса и ток наружу
  readout: (c, sim) => readout(-sim.voltage(c), Math.abs(sim.current(c)), sim.power(c)),
  noFlip: true,
  actual(c, tol) {
    const b = tolerance.battery(c, tol);
    return actualRow("ЭДС фактически", formatSI(b.emf, "В")) + actualRow("Внутр. сопротивление", formatOhms(b.rInt));
  },
  view: batteryView,
};

// ─── 3D: Батарея ──────────



function batteryView(c: Battery): ComponentView {
  const group = new THREE.Group();
  const spec = BATTERIES[c.kind];
  const casingMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.45, emissive: new THREE.Color(0xff3b1f), emissiveIntensity: 0 });
  const mats: THREE.Material[] = [casingMat];
  let pinLocal: [THREE.Vector3, THREE.Vector3];

  if (c.kind === "9V") {
    // «Крона»: 48,5 × 26,5 × 17,5 мм, лёжа, клеммы смотрят в +X
    const Lx = mm(48.5), Hy = mm(17.5), Wz = mm(26.5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(Lx, Hy, Wz), casingMat);
    box.position.y = Hy / 2;
    group.add(box);
    const labelMat = new THREE.MeshStandardMaterial({ map: labelTexture(["9 В", "6F22 · КРОНА"], "#c8372d", "#fbf3e6"), roughness: 0.5 });
    mats.push(labelMat);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(Lx * 0.8, Wz * 0.85), labelMat);
    label.rotation.x = -Math.PI / 2;
    label.position.y = Hy + 0.01;
    group.add(label);
    const plus = new THREE.Mesh(new THREE.CylinderGeometry(mm(2.9), mm(2.9), mm(3), 20), leadMaterial);
    plus.rotation.z = Math.PI / 2;
    plus.position.set(Lx / 2 + mm(1.5), Hy / 2, -mm(6.35));
    const minus = new THREE.Mesh(new THREE.CylinderGeometry(mm(4.2), mm(4.2), mm(3), 6), leadMaterial);
    minus.rotation.z = Math.PI / 2;
    minus.position.set(Lx / 2 + mm(1.5), Hy / 2, mm(6.35));
    group.add(plus, minus);
    pinLocal = [new THREE.Vector3(Lx / 2 + mm(3), Hy / 2, mm(6.35)), new THREE.Vector3(Lx / 2 + mm(3), Hy / 2, -mm(6.35))];
  } else {
    // Батарейный отсек на 1–3 элемента AA (Ø 14,5 × 50,5 мм)
    const n = c.kind === "1.5V" ? 1 : c.kind === "3V" ? 2 : 3;
    const cellR = mm(14.5) / 2, cellL = mm(50.5);
    const Lx = cellL + mm(8), Wz = n * mm(15.5) + mm(3), Hy = mm(15);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(Lx, Hy * 0.6, Wz), casingMat);
    tray.position.y = Hy * 0.3;
    group.add(tray);
    const cellMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.55, metalness: 0.1 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xb89a55, roughness: 0.5, metalness: 0.5 });
    mats.push(cellMat, capMat);
    for (let i = 0; i < n; i++) {
      const z = -Wz / 2 + mm(1.5) + mm(15.5) * (i + 0.5);
      const cell = new THREE.Mesh(new THREE.CylinderGeometry(cellR, cellR, cellL, 24), cellMat);
      cell.rotation.z = Math.PI / 2;
      cell.position.set(0, cellR + mm(1.5), z); // лежит в ложементе отсека
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(cellR * 1.001, cellR * 1.001, cellL * 0.28, 24), capMat);
      cap.rotation.z = Math.PI / 2;
      // Элементы чередуются: + то справа, то слева
      cap.position.set((i % 2 === 0 ? 1 : -1) * cellL * 0.36, cellR + mm(1.5), z);
      group.add(cell, cap);
    }
    const labelMat = new THREE.MeshStandardMaterial({ map: labelTexture([spec.label.split(", ").pop()!, spec.label.split(", ")[0]], "#22262b", "#e9e4d6"), roughness: 0.6 });
    mats.push(labelMat);
    // Наклейка на боковой стенке отсека
    const label = new THREE.Mesh(new THREE.PlaneGeometry(Hy * 1.2, Hy * 0.6), labelMat);
    label.position.set(0, Hy * 0.3, Wz / 2 + 0.01);
    group.add(label);
    // Выводные провода отсека: красный (+) и чёрный (−) с лужёными концами
    const redMat = new THREE.MeshStandardMaterial({ color: 0xc8261f, roughness: 0.5 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.5 });
    mats.push(redMat, blackMat);
    const stub = (z: number, mat: THREE.Material) => {
      const path = new THREE.CubicBezierCurve3(
        new THREE.Vector3(Lx / 2 - 0.2, Hy * 0.3, z * 0.4),
        new THREE.Vector3(Lx / 2 + 2, Hy * 0.3, z * 0.4),
        new THREE.Vector3(Lx / 2 + 2, 0.3, z),
        new THREE.Vector3(Lx / 2 + 3.4, 0.3, z),
      );
      group.add(new THREE.Mesh(new THREE.TubeGeometry(path, 16, mm(0.8), 8, false), mat));
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(mm(0.45), mm(0.45), 1, 8), leadMaterial);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(Lx / 2 + 3.9, 0.3, z);
      group.add(tip);
    };
    stub(1.4, blackMat);
    stub(-1.4, redMat);
    pinLocal = [new THREE.Vector3(Lx / 2 + 4.4, 0.3, 1.4), new THREE.Vector3(Lx / 2 + 4.4, 0.3, -1.4)];
  }

  if (c.placement.mode !== "free") throw new Error("Батарея ставится только на стол");
  group.position.set(c.placement.x, 0, c.placement.z);
  group.rotation.y = c.placement.rot;
  tagPickable(group, c.id);
  const pins = [freeTransform(c, pinLocal[0]), freeTransform(c, pinLocal[1])];
  return {
    group,
    pins,
    hotspot: pins[0].clone().add(pins[1]).multiplyScalar(0.5),
    update(v) {
      casingMat.emissiveIntensity = v.shorted ? 0.25 + 0.2 * Math.sin(v.time * 9) : 0;
    },
    dispose: () => disposeGroup(group),
  };
}
