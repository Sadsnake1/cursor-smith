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

// The trail an eater leaves with Motion smear on (eaterSmear): a streak in
// its own height, from its edge out to where the smear reaches, at most
// EATER_TRAIL_CW letters, fading from EATER_TRAIL_ALPHA of its paint at the
// eater to nothing at the tail - "a smear trail", not a faint box beside it
// ("The shredder doesn't leave a smear trail": a flat translucent block a
// letter long read as one).
export const EATER_TRAIL_ALPHA = 0.6;
export const EATER_TRAIL_CW = 6;

// An eater's trail: the row band of its rect `r` (y, h), and a run each
// side the smear's quad `q` reaches past the cursor's own rect `own` -
// [from x, to x, dir] from the eater's edge out to the quad's far end
// (`maxReach` px at most), dir +1 going right. None without a smear, with
// one that reaches nowhere past the cursor (at rest: a trail there was a
// ghost of the cursor over the Vacuum's floor), or one across rows (a
// Backspace joining two lines). Pure.
export function eaterTrail(r: Rect, own: Rect, q: { tl: { x: number; y: number }; tr: { x: number; y: number }; br: { x: number; y: number }; bl: { x: number; y: number } } | null, maxReach: number): { y: number; h: number; runs: [number, number, number][] } | null {
  if (!q) return null;
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const up = Math.max(0, own.y - Math.min(...ys)), down = Math.max(0, Math.max(...ys) - (own.y + own.h));
  if (up > own.h * 0.5 || down > own.h * 0.5) return null;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const runs: [number, number, number][] = [];
  if (maxX - (own.x + own.w) >= 0.5) {
    const from = r.x + r.w, to = Math.min(maxX, from + maxReach);
    if (to - from >= 0.5) runs.push([from, to, 1]);
  }
  if (own.x - minX >= 0.5) {
    const to = r.x, from = Math.max(minX, to - maxReach);
    if (to - from >= 0.5) runs.push([from, to, -1]);
  }
  return runs.length ? { y: r.y, h: r.h, runs } : null;
}

// How strong a trail is `f` of the way from the eater (0) to its tail (1).
export function eaterTrailAlpha(f: number): number {
  return EATER_TRAIL_ALPHA * Math.pow(1 - Math.max(0, Math.min(1, f)), 1.6);
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
  // radius. True when it drew - the caller draws nothing of its own.
  drawEater(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, own: Rect, gx: number, paint: string | CanvasGradient | CanvasPattern, stroke: number, corner: number, now: number): boolean {
    const e = this._eaterNow(now);
    const a = this.animActive;
    if (!e || !a) return false;
    const span = this.lineSpan(a.top, a.h);
    const cw = a.actualCharWidth || own.w;
    const box = this.styleFor("cursorStyle") === "Box";
    const form = eaterForm(e.kind, gx, a.top, a.h, cw, this.caretThickness(), span.top, span.h, this.underlineThickness(a.h), box);
    const r = lerpRect(own, form, e.m);
    // With Motion smear on (eaterSmear): the eater its own size, its trail
    // behind it (eaterTrail) - its own shape stretched along the row, faint.
    // It was the eater itself stretched along the smear, and that grew it
    // far too big ("back-man is too big with smear on, just make it have the
    // trail", the Vacuum "waaaay bigger" deleting fast, "huuuge" across two
    // lines); then the cursor's own smear behind it, which on a Box was a
    // ghost box over the Vacuum's floor ("it leavs a ghost like a box on top
    // of it").
    const trail = !e.back && this.look.smear && this.look.eaterSmear !== false ? eaterTrail(r, own, this.smearCorners(), EATER_TRAIL_CW * cw) : null;
    if (this._perf && this._perf.del) { this._perf.del.eater++; if (trail) this._perf.del.trail++; }
    if (trail) {
      // In slices, each fainter than the one before (eaterTrailAlpha), the
      // first against the eater. A hollow box's is fainter again: its own
      // body is an outline.
      ctx.save();
      const base = ctx.globalAlpha * (stroke > 0 ? 0.5 : 1);
      ctx.fillStyle = paint;
      for (const [from, to, dir] of trail.runs) {
        const len = to - from, n = Math.max(3, Math.min(12, Math.round(len / 3)));
        for (let i = 0; i < n; i++) {
          ctx.globalAlpha = base * eaterTrailAlpha((i + 0.5) / n);
          const sx = dir > 0 ? from + (len * i) / n : to - (len * (i + 1)) / n;
          ctx.fillRect(sx, trail.y, len / n + 0.25, trail.h);
        }
      }
      ctx.restore();
    }
    // All it may paint, marked for the next frame's clear: the cursor's
    // own bounds (_cursorBounds) do not hold the eater's rect, and Back-man
    // grows and bends past his (BACKMAN_BIG, the bend) - what fell outside
    // stayed on the page.
    const m = Math.max(r.w, r.h) * 0.6 + 12;
    this._markDirty(r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m);
    if (trail) for (const [from, to] of trail.runs) this._markDirty(from - 12, trail.y - 12, to - from + 24, trail.h + 24);
    // Each effect's pose at `now` (asked again: the same for the same
    // `now`).
    const bm = !e.back && e.kind === "backman" ? this.backManPose(now) : null;
    const shred = !e.back && e.kind === "shredder" ? this.shredPose(now) : null;
    const hole = !e.back && e.kind === "rabbithole" ? this.holePose(now) : null;
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
      this.drawHole(ctx, r.x, r.y, r.w, r.h, paint, hole, now);
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
