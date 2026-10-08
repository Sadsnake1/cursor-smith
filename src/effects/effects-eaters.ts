// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The cursor that eats what Backspace and Delete take - Back-man, Shredder,
// Rabbit hole - on any cursor (1.7.7: "make all 3 shredder, back-man and
// rabbit hole work for every caret type. animate the transitions
// smoothly"). Each has a shape of its own: Back-man a box, Shredder a
// standing line, Rabbit hole a floor. At the first key the cursor morphs
// from its own shape into that one (EATER_IN_MS, fast, so it answers the
// key at once), the effect plays in it, and when it is done the cursor
// morphs back into its own (EATER_OUT_MS, with a little overshoot). A
// cursor already of that shape just plays it. Which one, if any, is the
// cursor's choice on delete (eaterChoiceOf, settings.ts).
import type CursorSmithPlugin from "../plugin";
import { BACKMAN_BEND_MAX, BACKMAN_BIG, BACKMAN_GROW } from "./effects-backman";
import { eaterChoiceOf, letterChoiceOf } from "../settings/settings";
import type { CaretRecord, DeletedLetters } from "../types";
import type { EaterChoice } from "../settings/settings";

export const EATER_IN_MS = 90;
export const EATER_OUT_MS = 160;

export type Eater = "backman" | "shredder" | "rabbithole";
export interface Rect { x: number; y: number; w: number; h: number }
// The morph: which eater, when it began, when it began going back (or 0).
export interface EaterState { kind: Eater; t0: number; exit: number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
// Out with a little overshoot, back to rest.
const easeOutBack = (t: number) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// The eater a choice is, or null (nothing). Pure.
export function eaterOf(e: EaterChoice): Eater | null {
  return e === "none" ? null : e;
}

// Each eater's shape for a caret at the gap `gx` on the row (top, h), a
// letter `cw` wide, a Line `lw` thick (spanning lineTop..+lineH), an
// Underline `uh` thick: Back-man the letter's box, Shredder the line,
// Rabbit hole the floor. On a Box (`box`) Shredder keeps the box - the
// whole of it shredded into strips ("make the shredder for box cursor, be a
// shreded box entirely (horizontal lines)"). Pure.
export function eaterForm(kind: Eater, gx: number, top: number, h: number, cw: number, lw: number, lineTop: number, lineH: number, uh: number, box = false): Rect {
  if (kind === "backman" || (kind === "shredder" && box)) return { x: gx, y: top, w: cw, h };
  if (kind === "shredder") return { x: gx - lw / 2, y: lineTop, w: lw, h: lineH };
  return { x: gx, y: top + h - uh, w: cw, h: uh };
}

// A rect between `a` (k 0) and `b` (k 1). Pure.
export function lerpRect(a: Rect, b: Rect, k: number): Rect {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: Math.max(0.5, a.w + (b.w - a.w) * k), h: Math.max(0.5, a.h + (b.h - a.h) * k) };
}

// How far into its eater's shape the cursor is (1 all the way): `sinceIn`
// ms after it began, `sinceOut` ms after it began going back (or -1, not
// going back). In fast and smooth; back with a little overshoot. Pure.
export function eaterMorph(sinceIn: number, sinceOut: number): number {
  if (sinceOut >= 0) return 1 - easeOutBack(clamp01(sinceOut / EATER_OUT_MS));
  return easeOut(clamp01(sinceIn / EATER_IN_MS));
}

export const effectsEatersMethods = {
  // The eater chosen, with Pop effects on, or null.
  _eaterOn(this: CursorSmithPlugin): Eater | null {
    return this.look.popEffects ? eaterOf(eaterChoiceOf(this.look)) : null;
  },

  // The cursor at `now` as an eater draws it: which one, whether it is
  // going back, how far into its shape - or null, the cursor its own.
  // Starts the morph at an eater's first pose, starts the way back when its
  // pose ends, and lets it go once back.
  _eaterNow(this: CursorSmithPlugin, now: number) {
    const kind = this._eaterOn();
    const pose = kind === "backman" ? this.backManPose(now) : kind === "shredder" ? this.shredPose(now) : kind === "rabbithole" ? this.holePose(now) : null;
    let s = this._eat;
    if (pose && kind) {
      if (!s || s.kind !== kind) s = this._eat = { kind, t0: now, exit: 0 };
      else if (s.exit) { s.t0 = now - EATER_IN_MS * (1 - eaterMorph(0, now - s.exit)); s.exit = 0; }
    } else if (s) {
      if (!s.exit) s.exit = now;
      if (now - s.exit >= EATER_OUT_MS) { this._eat = null; return null; }
    } else return null;
    const m = eaterMorph(now - s.t0, s.exit ? now - s.exit : -1);
    return { kind: s.kind, back: !!s.exit, m };
  },

  // The letters' own effect (Burst, Evaporate) for a letter an eater is
  // done with - Back-man's bite, the Shredder's cut, the Rabbit hole's drop -
  // played there: the letter `w` wide, its cell's left at x, its row's top
  // at `top`, in the caret's font (`old`, the caret it was deleted from).
  _eatenLetterFx(this: CursorSmithPlugin, char: string, w: number, old: CaretRecord, x: number, top: number) {
    if (!this.look.popEffects) return;
    const fx = letterChoiceOf(this.look);
    if (fx === "vanish") return;
    const deleted: DeletedLetters = { letters: [{ char, x, w }], forward: false, old: { ...old, top } };
    if (fx === "evaporate") this.spawnEvaporate(deleted);
    else this.spawnDisintegration(deleted);
  },

  // Whether an eater has the cursor (the frame governor keeps the frames
  // coming while it morphs).
  eaterMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this._eat && (!this._eat.exit || now - this._eat.exit < EATER_OUT_MS);
  },

  // Draws the cursor as its eater, if one has it: the shape morphed from
  // `own` (the cursor's own rect) toward the eater's (for a caret at the gap
  // `gx`), the effect played in it; going back, the cursor's own shape coming
  // back. `stroke`: a hollow Box's outline width (Back-man draws its
  // outline; going back, the rect is outlined). `corner`: the box's corner
  // radius. `paintFor`: the cursor's paint over a given rect - built over
  // all the eater may cover, not the cursor's own rect: Energy's Aurora is a
  // pattern that ends at the rect it is built for, so on an Underline (a bar
  // 2 px tall) Back-man's box and the Shredder's line were seen only where
  // they crossed the bar ("the shredder is very tiny ... even back-man is
  // weird"). True when it drew - the caller draws nothing of its own.
  drawEater(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, own: Rect, gx: number, paint: string | CanvasGradient | CanvasPattern, stroke: number, corner: number, now: number, paintFor?: (x: number, y: number, w: number, h: number) => string | CanvasGradient | CanvasPattern): boolean {
    const e = this._eaterNow(now);
    const a = this.animActive;
    if (!e || !a) return false;
    const span = this.lineSpan(a.top, a.h);
    const cw = a.actualCharWidth || own.w;
    const box = this.styleFor("cursorStyle") === "Box";
    const form = eaterForm(e.kind, gx, a.top, a.h, cw, this.caretThickness(), span.top, span.h, this.underlineThickness(a.h), box);
    const r = lerpRect(own, form, e.m);
    // No trail behind it (eaterSmear, unused since): stretched with the smear
    // it grew far too big, then its trails read as a fast trail rather than a
    // smear - "remove the smear suboption for those too" (1.7.7).
    if (this._perf && this._perf.del) this._perf.del.eater++;
    // All it may paint, marked for the next frame's clear: the cursor's
    // own bounds (_cursorBounds) do not hold the eater's rect, and Back-man
    // grows and bends past his (BACKMAN_BIG, the bend) - what fell outside
    // stayed on the page.
    const m = Math.max(r.w, r.h) * 0.6 + 12;
    this._markDirty(r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m);
    // Each effect's pose at `now` (asked again: the same for the same
    // `now`).
    const bm = !e.back && e.kind === "backman" ? this.backManPose(now) : null;
    const shred = !e.back && e.kind === "shredder" ? this.shredPose(now) : null;
    const hole = !e.back && e.kind === "rabbithole" ? this.holePose(now) : null;
    if (paintFor) {
      // The room each takes past its rect: Back-man's bend and gulp each
      // side (BACKMAN_BEND_MAX, the big swell), the blades' jolt, the
      // floor's reach right under a word's letters.
      let x0 = r.x, x1 = r.x + r.w;
      if (bm) { const g = (BACKMAN_BEND_MAX + BACKMAN_GROW * BACKMAN_BIG.grow) * r.w + 1; x0 -= g; x1 += g; }
      else if (shred) { x0 -= 3; x1 += 3; }
      else if (hole) for (const l of hole.letters) x1 = Math.max(x1, l.cx + l.w / 2);
      paint = paintFor(x0, r.y, x1 - x0, r.h);
    }
    if (bm) {
      this.drawBackMan(ctx, r.x, r.y, r.w, r.h, paint, bm, stroke, corner);
    } else if (shred) {
      // The letters cut where the line is going (the caret's own gap),
      // then the blades over them.
      const la = this.lastActive;
      const style = this.styleFor("cursorStyle");
      const cut = la ? la.x + (style === "Line" ? this.caretThickness() / 2 : 0) : gx;
      this.drawShreds(ctx, cut, shred, now);
      this.drawShredLine(ctx, r.x, r.y, r.w, r.h, paint, shred, now, stroke);
    } else if (hole) {
      this.drawHole(ctx, r.x, r.y, r.w, r.h, paint, hole, now, form);
    } else {
      // Going back: the plain shape, between the eater's and its own, its
      // corners rounded as Rounded corners rounds it.
      ctx.beginPath();
      this.traceRoundedRect(ctx, r.x, r.y, r.w, r.h, this.cornerRadius(Math.min(r.w, r.h)));
      if (stroke > 0) {
        ctx.strokeStyle = paint;
        ctx.lineWidth = stroke;
        ctx.stroke();
      } else {
        ctx.fillStyle = paint;
        ctx.fill();
      }
    }
    return true;
  },
};
