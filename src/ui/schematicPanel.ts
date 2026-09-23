/**
 * Окно принципиальной схемы: отрисовка (обновляет подписи на месте, если поменялись только цифры),
 * ручная раскладка перетаскиванием и щелчки по деталям.
 */

import type { Component, Scene, SchematicLayout } from "../model/types";
import type { Simulation } from "../sim/simulation";
import { schematicSvg } from "../view/schematic";

/** Что окну схемы нужно от приложения. */
export interface SchematicHost {
  scene(): Scene;
  sim(): Simulation;
  /** Выделенная деталь (подсвечивается на схеме). */
  highlighted(): string | undefined;
  /** Раскладку поменяли: сохранить и записать шаг для отмены. */
  layoutChanged(): void;
  /** Щёлкнули по детали на схеме. */
  partClicked(c: Component): void;
}

export class SchematicPanel {
  /** Показана ли панель со схемой. */
  visible = false;
  private html = "";
  /** Перетаскивание на схеме: деталь — по горизонтали, линия цепи — по вертикали. */
  private drag?: { kind: "part" | "net"; id: string; base: number; start: number; scale: number; value: number; moved: boolean };
  /** Только что тащили — щелчок, который браузер пришлёт следом, не считается. */
  private justDragged = false;

  constructor(
    private el: HTMLElement | undefined,
    private host: SchematicHost,
  ) {
    if (el) {
      this.bindDrag(el);
      el.addEventListener("click", (e) => {
        if (this.justDragged) return;
        const g = (e.target as Element).closest<SVGGElement>("[data-part]");
        const c = g ? this.host.scene().components.find((x) => x.id === g.dataset.part) : undefined;
        if (!c) return;
        this.host.partClicked(c);
        this.render();
      });
    }
  }

  setVisible(on: boolean): void {
    this.visible = on;
    const el = this.el;
    if (!el) return;
    el.hidden = !on;
    this.html = "";
    this.render();
  }

  /** Вернуть автоматическую раскладку (отменяется Ctrl+Z). */
  resetLayout(): void {
    delete this.host.scene().schematic;
    this.host.layoutChanged();
    this.html = "";
    this.render();
  }

  /** Перерисовать, если схема видна и что-то поменялось (токи, выделение, сама сборка). */
  render(): void {
    const el = this.el;
    if (!el || !this.visible) return;
    let svg: string;
    try {
      svg = schematicSvg(this.host.scene(), this.host.sim(), this.host.highlighted(), this.layout());
    } catch {
      svg = ""; // сборка в промежуточном состоянии (например, пропало отверстие) — нарисуем в следующий раз
    }
    const reset = el.querySelector<HTMLElement>("#btn-sch-reset");
    if (reset) reset.hidden = !this.host.scene().schematic;
    const html = svg || `<p class="sub">На столе нет деталей — схема появится, когда вы что-нибудь соберёте.</p>`;
    if (html === this.html) return;
    const body = el.querySelector(".sch-body");
    if (!body) return;
    // Если поменялись только цифры (токи, напряжения), меняем текст подписей на месте: иначе
    // элементы пересоздаются каждые 0,2 с и щелчок, начатый на старом элементе, теряется
    const shape = (h: string) => h.replace(/>[^<]*<\/text>/g, "></text>");
    if (this.html && shape(html) === shape(this.html)) {
      const next = [...html.matchAll(/>([^<]*)<\/text>/g)].map((m) => m[1]);
      body.querySelectorAll("text").forEach((t, i) => {
        const v = next[i]?.replace(/&lt;/g, "<").replace(/&amp;/g, "&");
        if (v !== undefined && t.textContent !== v) t.textContent = v;
      });
    } else {
      body.innerHTML = html;
    }
    this.html = html;
  }

  /** Ручная раскладка с учётом перетаскивания, которое идёт прямо сейчас. */
  private layout(): SchematicLayout {
    const base = this.host.scene().schematic ?? {};
    const d = this.drag;
    if (!d?.moved) return base;
    return d.kind === "part" ? { ...base, x: { ...base.x, [d.id]: d.value } } : { ...base, y: { ...base.y, [d.id]: d.value } };
  }

  private bindDrag(el: HTMLElement): void {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      const svg = target.closest("svg.sch") as SVGSVGElement | null;
      const part = target.closest<SVGGElement>("[data-part]");
      const net = part ? null : target.closest<SVGGElement>("[data-net]");
      if (!svg || (!part && !net)) return;
      // Экранных пикселей на единицу чертежа (схема может быть вписана в панель)
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width || 1;
      this.drag = part
        ? { kind: "part", id: part.dataset.part!, base: Number(part.dataset.x), start: e.clientX, scale, value: Number(part.dataset.x), moved: false }
        : { kind: "net", id: net!.dataset.net!, base: Number(net!.dataset.y), start: e.clientY, scale, value: Number(net!.dataset.y), moved: false };
    });
    el.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d) return;
      const delta = ((d.kind === "part" ? e.clientX : e.clientY) - d.start) / d.scale;
      if (!d.moved && Math.abs(delta * d.scale) < 4) return;
      // Указатель захватываем, только когда действительно потащили: иначе щелчок уйдёт панели, а не детали
      if (!d.moved) el.setPointerCapture(e.pointerId);
      d.moved = true;
      // Шаг 4 единицы — линии проще выровнять
      const value = Math.max(20, Math.round((d.base + delta) / 4) * 4);
      if (value === d.value) return;
      d.value = value;
      this.render();
    });
    const finish = () => {
      const d = this.drag;
      this.drag = undefined;
      if (!d?.moved) return;
      const base = this.host.scene().schematic ?? {};
      this.host.scene().schematic = d.kind === "part" ? { ...base, x: { ...base.x, [d.id]: d.value } } : { ...base, y: { ...base.y, [d.id]: d.value } };
      this.justDragged = true;
      setTimeout(() => (this.justDragged = false), 0);
      this.host.layoutChanged();
      this.render();
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
  }
}
