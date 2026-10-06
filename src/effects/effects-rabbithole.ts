// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Rabbit hole (1.7.7, asked as "Portal. It sucks the letters
// in or something like that. Find a better name"): while Backspace or
// Delete eats the text, the Underline cursor - the floor under the letter -
// sags into a shallow dip ("dont make the cursor a circle, make it curved
// concave just a bit"; it was a dark ellipse for a day), and the letters it
// takes are pulled down into it, swirling and shrinking, out of sight as
// they pass through the bar; then it straightens. An Underline's only:
// Back-man is the Box's, Shredder the Line's.
import type { DeletedLetters } from "../types";
import type CursorSmithPlugin from "../plugin";

// How long the dip takes to sag, a letter its fall, how long the dip stays
// after the last key (its last 120 ms straightening), how deep it sags at
// its deepest (a letter's width - "just a bit").
export const HOLE_OPEN_MS = 90;
export const HOLE_FALL_MS = 300;
export const HOLE_HOLD_MS = 380;
export const HOLE_SAG = 0.3;
const MEAL_MAX = 12;

// A letter going down: where its middle stood, its font and color, when it
// set off.
export interface HoleLetter { char: string; cx: number; cy: number; font: string; color: string; t0: number }
// t0: when this run of eating began; t: its last key.
export interface HoleState { t0: number; t: number; letters: HoleLetter[] }
export interface HolePose { open: number; letters: HoleLetter[] }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// How far the dip has sagged (0 the bar straight, 1 its deepest), `first`
// ms into the run and `last` ms after its last key. Pure.
export function holeOpen(first: number, last: number): number {
  return Math.min(clamp01(first / HOLE_OPEN_MS), last < HOLE_HOLD_MS - 120 ? 1 : clamp01((HOLE_HOLD_MS - last) / 120));
}

// How far an Underline w wide sags at its middle, `open` sagged, px: its
// ends stay where they are, its middle drops - a shallow curve. Pure.
export function holeSag(open: number, w: number): number {
  return HOLE_SAG * w * clamp01(open);
}

// A letter pulled from its place (cx, cy) into the hole at (hx, hy), at
// `now`: where it is, how big, how turned (a swirl, faster as it goes),
// and whether it is gone. Pure.
export function holeFall(l: HoleLetter, hx: number, hy: number, now: number) {
  const u = clamp01((now - l.t0) / HOLE_FALL_MS);
  const e = u * u;
  return { x: l.cx + (hx - l.cx) * e, y: l.cy + (hy - l.cy) * e, k: Math.max(0.05, 1 - 0.9 * e), rot: 1.6 * Math.PI * e, done: u >= 1 };
}

export const effectsRabbitHoleMethods = {
  // On for the look showing: Pop effects and Rabbit hole, an Underline.
  _holeOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.popEffects && this.look.rabbitHole && this.styleFor("cursorStyle") === "Underline");
  },

  // A key that deletes (Backspace or Delete): the hole opens, or stays open.
  _holeBite(this: CursorSmithPlugin) {
    if (!this._holeOn()) return;
    const now = performance.now();
    const s = this._hole;
    if (s && now - s.t < HOLE_HOLD_MS) s.t = now;
    else this._hole = { t0: now, t: now, letters: s ? s.letters : [] };
  },

  // What the key took (effects-delete.ts): the letters, each pulled in from
  // where it stood.
  spawnHoleMeal(this: CursorSmithPlugin, deleted: DeletedLetters) {
    const s = this._hole;
    if (!s) return;
    const old = deleted.old;
    const h = old.h || 20;
    const font = this.fontString(old.fontSize, old.fontFamily, old.fontWeight, old.fontStyle);
    const color = old.textColor || this.getActiveColor() || "#888888";
    const now = performance.now();
    for (const l of deleted.letters.slice(0, MEAL_MAX)) {
      if (!l.char.trim()) continue;
      s.letters.push({ char: l.char, cx: l.x + l.w / 2, cy: old.top + h / 2, font, color, t0: now });
    }
  },

  // The hole at `now`: how open, the letters still going in - or null when
  // it is the bar again and every letter gone.
  holePose(this: CursorSmithPlugin, now: number): HolePose | null {
    const s = this._hole;
    if (!s || !this._holeOn()) return null;
    s.letters = s.letters.filter((l) => now - l.t0 < HOLE_FALL_MS);
    const last = Math.max(0, now - s.t);
    if (last >= HOLE_HOLD_MS && !s.letters.length) { this._hole = null; return null; }
    return { open: last >= HOLE_HOLD_MS ? 0 : holeOpen(Math.max(0, now - s.t0), last), letters: s.letters };
  },

  // Whether it is still about (the frame governor keeps the frames coming).
  holeMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.holePose(now);
  },

  // The Underline sagging, in its bar (x, y, w, h) and its own paint: the
  // letters going in first (seen above the bar's top edge, curved as the
  // bar is; out of sight once through it), then the bar along the curve -
  // its ends where they were, its middle down, its thickness the bar's.
  drawHole(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: HolePose, now: number) {
    const sag = holeSag(pose.open, w);
    const cx = x + w / 2, mid = y + h / 2, top = y;
    for (const l of pose.letters) {
      const f = holeFall(l, cx, mid + sag + h, now);
      if (f.done) continue;
      const far = 6 * Math.max(w, Math.abs(l.cx - cx) + w);
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      // Above the bar's top edge, along its curve.
      ctx.beginPath();
      ctx.moveTo(x - far, top - far);
      ctx.lineTo(x + w + far, top - far);
      ctx.lineTo(x + w + far, top);
      ctx.lineTo(x + w, top);
      ctx.quadraticCurveTo(cx, top + 2 * sag, x, top);
      ctx.lineTo(x - far, top);
      ctx.closePath();
      ctx.clip();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.scale(f.k, f.k);
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(l.char, 0, 0);
      ctx.restore();
      this._markDirty(Math.min(l.cx, cx) - w * 2, Math.min(l.cy, mid) - w * 2, Math.abs(l.cx - cx) + w * 4, Math.abs(l.cy - mid) + w * 4);
    }
    // The bar along the curve (its lowest point `sag` below its ends).
    ctx.strokeStyle = paint;
    ctx.lineWidth = h;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(x, mid);
    ctx.quadraticCurveTo(cx, mid + 2 * sag, x + w, mid);
    ctx.stroke();
  },
};
