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
import type { CaretState, CaretRecord, DeletedLetters } from "../types";
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

// The trail an eater leaves with Motion smear on (eaterSmear): what it has
// passed over along its row in the last EATER_TRAIL_MS, beyond where it is
// now (EATER_TRAIL_CW letters at most), in its own height, each stretch
// fading with how long ago it was there - from EATER_TRAIL_ALPHA of its
// paint to nothing. Kept from its path, not from the smear spring's reach
// at the moment: one slow Backspace on a phone moved the spring a letter
// for a tenth of a second ("On phone it doesn't work", "no smear work on
// deleting one phone").
export const EATER_TRAIL_ALPHA = 0.6;
export const EATER_TRAIL_CW = 8;
export const EATER_TRAIL_MS = 280;

// One frame of an eater's path: when, and the stretch of its row it covered
// (its own rect, and the smear's reach past the cursor's box).
export interface EaterPathPoint { t: number; x0: number; x1: number }

// A frame's stretch: the eater's rect `r` widened by how far the smear's
// quad `q` reaches past the cursor's own rect `own`, each way - not at
// all when the quad spans rows (a Backspace joining two lines). Pure.
export function eaterPathPoint(r: Rect, own: Rect, q: { tl: { x: number; y: number }; tr: { x: number; y: number }; br: { x: number; y: number }; bl: { x: number; y: number } } | null, t: number): EaterPathPoint {
  let left = 0, right = 0;
  if (q) {
    const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
    const up = Math.max(0, own.y - Math.min(...ys)), down = Math.max(0, Math.max(...ys) - (own.y + own.h));
    if (up <= own.h * 0.5 && down <= own.h * 0.5) {
      left = Math.max(0, own.x - Math.min(...xs));
      right = Math.max(0, Math.max(...xs) - (own.x + own.w));
    }
  }
  return { t, x0: r.x - left, x1: r.x + r.w + right };
}

// The trail's runs: [from x, to x, dir] each way the path covered past the
// eater's rect `r` within EATER_TRAIL_MS of `now`, `maxReach` px at most;
// none when it covered nothing past it (at rest: no ghost). Pure.
export function eaterTrailRuns(r: Rect, pts: EaterPathPoint[], now: number, maxReach: number): [number, number, number][] {
  let lo = r.x, hi = r.x + r.w;
  for (const p of pts) {
    if (now - p.t >= EATER_TRAIL_MS) continue;
    if (p.x0 < lo) lo = p.x0;
    if (p.x1 > hi) hi = p.x1;
  }
  const runs: [number, number, number][] = [];
  if (hi - (r.x + r.w) >= 0.5) runs.push([r.x + r.w, Math.min(hi, r.x + r.w + maxReach), 1]);
  if (r.x - lo >= 0.5) runs.push([Math.max(lo, r.x - maxReach), r.x, -1]);
  return runs;
}

// How long ago the path last covered `x` (Infinity: not in it). Pure.
export function eaterPathAge(pts: EaterPathPoint[], x: number, now: number): number {
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    if (p.x0 - 0.01 <= x && x <= p.x1 + 0.01) return now - p.t;
  }
  return Infinity;
}

// A stretch of trail's strength, `age` ms after the eater was there.
export function eaterTrailAlpha(age: number): number {
  if (!(age < EATER_TRAIL_MS)) return 0;
  return EATER_TRAIL_ALPHA * Math.pow(1 - Math.max(0, age) / EATER_TRAIL_MS, 1.4);
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
  // This caret's eater's trail this frame: its path (kept on the caret's
  // own state, so several cursors keep theirs) given this frame's stretch,
  // then the runs past where it is. A path from another row, or one gone
  // stale (the eater was away), starts afresh.
  _eaterTrail(this: CursorSmithPlugin, r: Rect, own: Rect, now: number, maxReach: number): { y: number; h: number; runs: [number, number, number][]; pts: EaterPathPoint[] } | null {
    const st = this._caret as (CaretState & { _eatPath?: { y: number; pts: EaterPathPoint[] } }) | undefined;
    if (!st) return null;
    let path = st._eatPath;
    const last = path && path.pts[path.pts.length - 1];
    if (!path || !last || Math.abs(path.y - r.y) > 2 || now - last.t > 120) path = st._eatPath = { y: r.y, pts: [] };
    path.pts.push(eaterPathPoint(r, own, this.smearCorners(), now));
    while (path.pts.length && now - path.pts[0].t >= EATER_TRAIL_MS) path.pts.shift();
    const runs = eaterTrailRuns(r, path.pts, now, maxReach);
    return runs.length ? { y: r.y, h: r.h, runs, pts: path.pts } : null;
  },

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
    const trail = !e.back && this.look.smear && this.look.eaterSmear !== false ? this._eaterTrail(form, own, now, EATER_TRAIL_CW * cw) : null;
    if (this._perf && this._perf.del) { this._perf.del.eater++; if (trail) this._perf.del.trail++; }
    if (trail) {
      // In slices, each fainter than the one before (eaterTrailAlpha), the
      // first against the eater. A hollow box's is fainter again: its own
      // body is an outline.
      ctx.save();
      const base = ctx.globalAlpha * (stroke > 0 ? 0.5 : 1);
      ctx.fillStyle = paint;
      for (const [from, to, dir] of trail.runs) {
        const len = to - from, n = Math.max(3, Math.min(16, Math.round(len / 3)));
        for (let i = 0; i < n; i++) {
          const sx = dir > 0 ? from + (len * i) / n : to - (len * (i + 1)) / n;
          const a = eaterTrailAlpha(eaterPathAge(trail.pts, sx + len / n / 2, now));
          if (a <= 0.005) continue;
          ctx.globalAlpha = base * a;
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
