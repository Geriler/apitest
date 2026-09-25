import * as THREE from "three";
import { axialLayout, boardFrame, type ComponentView, disposeGroup, freeTransform, leadMaterial, mm, tagPickable } from "../view/kit";
import { smdLabelTexture } from "../view/textures";
import { SMD_SIZES, thtResistorSpec, type Resistor, type SmdSize } from "../model/types";
import { colorBands, formatOhms, formatSI, smdCode } from "../sim/resistorCodes";
import * as tolerance from "../sim/tolerance";
import { formatLimit } from "../sim/devices";
import { stampBurned, twoPin } from "./common";
import { formatW } from "./format";
import { toolFor, type PartDef } from "./types";
import { actualRow, ohmsSelect, pct, smdSelect, superscript, twoPinHint, wattsSelect } from "../view/panel";

/** Как читать код SMD-резистора. */
function smdExplain(ohms: number): string {
  const code = smdCode(ohms);
  if (code.includes("R")) return `буква R стоит на месте запятой`;
  return `${code.slice(0, 2)} × 10${superscript(Number(code[2]))} Ом`;
}

export const resistor: PartDef<Resistor> = {
  type: "resistor",
  prefix: "R",
  pins: 2,
  countAs: () => ({ name: "резистор" }),
  onBoard: (c) => c.variant !== "smd",
  tools: [
    toolFor<Resistor>()({
      id: "tht",
      group: "passive",
      icon: `<path d="M1 9h7M22 9h7" /><rect x="8" y="5" width="14" height="8" />`,
      label: "Резистор",
      title: "Выводной резистор 0,125–2 Вт",
      settings: { ohms: 220, smdSize: "0805" as SmdSize, watts: 0.25 },
      name: () => "Резистор",
      note: () =>
        `<p class="sub">Выводной резистор, маркировка — цветные полосы. Мощность больше номинала — перегреется и сгорит; чем мощнее резистор, тем он крупнее.</p>`,
      editor: (s) => ohmsSelect(s.ohms) + wattsSelect(s.watts),
      set(s, field, value) {
        if (field === "ohms") s.ohms = Number(value);
        if (field === "watts") s.watts = Number(value);
      },
      create: (s) => ({ type: "resistor", variant: "tht", ohms: s.ohms, smdSize: s.smdSize, watts: s.watts }),
      hint: (_s, pending) => twoPinHint(pending),
    }),
    toolFor<Resistor>()({
      id: "smd",
      group: "passive",
      icon: `<path d="M1 9h8M21 9h8" /><rect x="9" y="6" width="12" height="6" /><path d="M9 6v6M21 6v6" stroke-width="2.4" />`,
      label: "SMD-резистор",
      title: "Резистор без ножек (1206…0402): на плату под SMD или на стол",
      settings: { ohms: 220, smdSize: "0805" as SmdSize },
      name: () => "SMD-резистор",
      note: () =>
        `<p class="sub">Электрически это тот же резистор, но корпус меньше — и рассеять он может меньше: 1206 до 0,25 Вт, 0402 всего до 0,063 Вт.</p>`,
      editor: (s) => ohmsSelect(s.ohms) + smdSelect(s.smdSize),
      set(s, field, value) {
        if (field === "ohms") s.ohms = Number(value);
        if (field === "smd") s.smdSize = value as SmdSize;
      },
      create: (s) => ({ type: "resistor", variant: "smd", ohms: s.ohms, smdSize: s.smdSize }),
      hint: () => "SMD-резистор ставится <b>на плату под SMD</b> (под ним появятся площадки) или кладётся на стол — тогда провода паяются к торцам. R — повернуть.",
      boardRefusal: "У SMD-резистора нет ножек — в отверстия он не вставляется. Ставьте его на плату под SMD или на стол рядом и припаяйте провода к торцам.",
    }),
  ],
  polar: () => false,
  label: (c) => `${formatOhms(c.ohms)}${c.variant === "smd" ? ` SMD ${c.smdSize}` : `, ${formatW(thtResistorSpec(c).ratedW)}`}`,
  value: (c) => `${formatOhms(c.ohms)}${c.variant === "smd" ? ` ${c.smdSize}` : `, ${formatW(thtResistorSpec(c).ratedW)}`}`,
  symbol: () => `<path d="M0 -20V-15M0 15V20"/><rect x="-5" y="-15" width="10" height="30"/>`,
  rated: (c) => (c.variant === "smd" ? SMD_SIZES[c.smdSize].ratedW : thtResistorSpec(c).ratedW),
  burn: (c) =>
    c.variant === "smd"
      ? [`Резистор ${c.id} сгорел`, `Корпус ${c.smdSize} рассеивает не больше ${formatSI(SMD_SIZES[c.smdSize].ratedW, "Вт")}. Возьмите корпус крупнее или резистор с бо́льшим сопротивлением.`]
      : [`Резистор ${c.id} сгорел`, `Номинал ${formatW(thtResistorSpec(c).ratedW)}. Возьмите резистор мощнее, увеличьте сопротивление или понизьте напряжение.`],

  stamp(c, sim, { out }) {
    if (!stampBurned(c, sim, out)) out.push(twoPin(c, tolerance.resistance(c, sim.tolerance)));
  },
  load(c, sim) {
    const rated = resistor.rated!(c);
    return { ratio: sim.branch(c.id).power / rated, what: "мощность", limit: formatLimit(rated, "Вт") };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  panel(c) {
    if (c.variant === "smd") {
      const sz = SMD_SIZES[c.smdSize];
      return {
        title: `SMD-резистор ${formatOhms(c.ohms)}`,
        body: `<div class="smd-chip">${smdCode(c.ohms)}</div>
            <p class="sub">Корпус ${c.smdSize}: ${String(sz.lengthMm).replace(".", ",")} × ${String(sz.widthMm).replace(".", ",")} мм, до ${formatSI(sz.ratedW, "Вт")}. Код ${smdCode(c.ohms)} — ${smdExplain(c.ohms)}.</p>`,
        editor: ohmsSelect(c.ohms) + smdSelect(c.smdSize),
      };
    }
    const bands = colorBands(c.ohms);
    const spec = thtResistorSpec(c);
    return {
      title: `Резистор ${formatOhms(c.ohms)}`,
      body: `<div class="bands"><span class="body">${bands.map((x) => `<i style="background:${x.hex}" title="${x.name}"></i>`).join("")}</span></div>
            <p class="sub">Выводной, ${String(spec.lengthMm).replace(".", ",")} × ${String(spec.diameterMm).replace(".", ",")} мм, до ${formatW(spec.ratedW)}. Полосы: ${bands.map((x) => x.name).join(", ")}.</p>`,
      editor: ohmsSelect(c.ohms) + wattsSelect(spec.ratedW),
    };
  },
  edit(c, field, value) {
    if (field === "ohms") c.ohms = Number(value);
    if (field === "smd") c.smdSize = value as SmdSize;
    if (field === "watts") c.watts = Number(value);
  },
  actual(c, tol) {
    const r = tolerance.resistance(c, tol);
    return actualRow("Фактически", `${formatOhms(r)} (${pct(r, c.ohms)})`);
  },
  view: resistorView,
};

// ─── 3D: Резисторы ──────────

function thtBody(c: Resistor) {
  const spec = thtResistorSpec(c);
  const L = mm(spec.lengthMm);
  const r = mm(spec.diameterMm) / 2;
  const body = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c496, roughness: 0.55 });
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(r, L - 2 * r, 6, 20), bodyMat);
  capsule.rotation.z = Math.PI / 2;
  body.add(capsule);
  const bandMats: THREE.MeshStandardMaterial[] = [];
  const bands = colorBands(c.ohms);
  const positions = [0.2, 0.34, 0.48, 0.8];
  bands.forEach((band, i) => {
    const m = new THREE.MeshStandardMaterial({
      color: band.hex,
      roughness: 0.4,
      metalness: band.name === "золотой" || band.name === "серебряный" ? 0.7 : 0,
    });
    bandMats.push(m);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, L * 0.08, 20), m);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = -L / 2 + positions[i] * L;
    body.add(ring);
  });
  return { body, L, r, bodyMat, bandMats };
}

function resistorView(c: Resistor): ComponentView {
  const group = new THREE.Group();
  let pins: THREE.Vector3[];
  let hotspot: THREE.Vector3;
  let bodyMat: THREE.MeshStandardMaterial;
  let extraMats: THREE.MeshStandardMaterial[] = [];
  let baseColor: THREE.Color;

  if (c.variant === "smd") {
    const s = SMD_SIZES[c.smdSize];
    const L = mm(s.lengthMm);
    const W = mm(s.widthMm);
    const T = mm(s.heightMm);
    bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, T, W), bodyMat);
    body.position.y = T / 2;
    group.add(body);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(L * 0.16, T * 1.02, W * 1.01), leadMaterial);
      cap.position.set((sx * L * 0.84) / 2 + sx * 0.0, T / 2, 0);
      cap.position.x = sx * (L / 2 - (L * 0.16) / 2);
      group.add(cap);
    }
    const labelMat = new THREE.MeshStandardMaterial({ map: smdLabelTexture(smdCode(c.ohms)), roughness: 0.6 });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.6, W * 0.8), labelMat);
    label.rotation.x = -Math.PI / 2;
    label.position.y = T + 0.002;
    group.add(label);
    extraMats = [labelMat];
    baseColor = new THREE.Color(0x1a1c1f);
    if (c.placement.mode === "free") {
      group.position.set(c.placement.x, 0, c.placement.z);
      group.rotation.y = c.placement.rot;
      pins = [freeTransform(c, new THREE.Vector3(-L / 2, T / 2, 0)), freeTransform(c, new THREE.Vector3(L / 2, T / 2, 0))];
      hotspot = freeTransform(c, new THREE.Vector3(0, T, 0));
    } else {
      // SMD в макетку не ставится; модель это не допускает, но на всякий случай — над серединой.
      const f = boardFrame(c.placement.holes);
      group.position.copy(f.mid);
      pins = [f.p0, f.p1];
      hotspot = f.mid.clone();
    }
  } else {
    const t = thtBody(c);
    bodyMat = t.bodyMat;
    extraMats = t.bandMats;
    baseColor = new THREE.Color(0xd8c496);
    ({ pins, hotspot } = axialLayout(c, group, t.body, t.L, t.r));
  }

  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot,
    update(v) {
      if (v.burned) {
        bodyMat.color.set(0x17120e);
        bodyMat.emissive.set(0x000000);
        for (const m of extraMats) m.color.multiplyScalar(0.25);
        extraMats = [];
        return;
      }
      bodyMat.color.copy(baseColor).lerp(new THREE.Color(0x3b2410), v.heat * 0.8);
      bodyMat.emissive.setRGB(1, 0.25, 0.05).multiplyScalar(v.heat > 0.4 ? (v.heat - 0.4) * 1.2 : 0);
    },
    dispose: () => disposeGroup(group),
  };
}
