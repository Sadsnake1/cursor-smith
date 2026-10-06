// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Shredder (1.7.7, "if the line style is on then a new
// backspace effect. the line becomes dashed - call it Shredder"): while
// Backspace or Delete eats the text, the Line cursor breaks into dashes -
// a shredder's blades, buzzing - and the letters it takes are fed through
// them, coming out the other side cut into ribbons that fan apart, then
// flutter down and fade; when the last is through, the line is whole
// again. A standing line: on an Underline the cursor morphs into one first
// (effects-eaters.ts); a Box stays a box, the whole of it cut into strips.
import type { CaretRecord, DeletedLetters } from "../types";
import { letterChoiceOf } from "../settings/settings";
import type CursorSmithPlugin from "../plugin";

// A letter's way through the blades, its ribbons' fall after, how long the
// line stays dashed after the last key (its last 90 ms closing), how many
// ribbons a letter is cut into, how far they fan (px down per px out).
export const SHRED_FEED_MS = 260;
export const SHRED_FALL_MS = 420;
export const SHRED_HOLD_MS = 320;
export const SHRED_RIBBONS = 5;
export const SHRED_FAN = 0.22;
const MEAL_MAX = 12;

// A letter going through: its cell (x, w) and row (top, h), its font and
// color, when it set off.
// popped: burst into pixels (Burst), its ribbons no more.
export interface ShredLetter { char: string; x: number; w: number; top: number; h: number; old: CaretRecord; font: string; color: string; t0: number; popped?: boolean }
// t0: when this run of cutting began; t: its last key.
export interface ShredState { t0: number; t: number; letters: ShredLetter[] }
export interface ShredPose { dash: number; letters: ShredLetter[] }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// How cut the line is (0 whole, 1 all blades), `first` ms into the run and
// `last` ms after its last key: in at once, out over the hold's end. Pure.
export function shredDash(first: number, last: number): number {
  return Math.min(clamp01(first / 40), last < SHRED_HOLD_MS - 90 ? 1 : clamp01((SHRED_HOLD_MS - last) / 90));
}

// The blades of a Line w x h, `dash` cut, at `now` (their buzz): [x offset,
// top, height] each, px from the line's top left. Pure.
export function shredBlades(dash: number, w: number, h: number, now: number): [number, number, number][] {
  const n = Math.max(4, Math.min(8, Math.round(h / 4)));
  const pitch = h / n, gap = pitch * 0.42 * clamp01(dash);
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) out.push([Math.sin(now * 0.11 + i * 2.3) * 0.7 * clamp01(dash), i * pitch + gap / 2, pitch - gap]);
  return out;
}

// A letter fed through the cut at x `cut`, at `now`: how far it has moved
// (toward the cut and past it, its right edge a pixel beyond at the end of
// the feed), how far its ribbons have fallen (from a fifth of the way in;
// with `rise`, risen - Evaporate), how faded they are, and whether it is all
// gone. Pure.
export function shredFeed(l: ShredLetter, cut: number, now: number, rise = false) {
  const age = now - l.t0;
  const u = clamp01(age / SHRED_FEED_MS);
  const e = u * u * (3 - 2 * u);
  // Falling as soon as they are out, fast enough to clear the row before
  // the next letter over: they drop out of the text, not over it.
  const fall = Math.max(0, age - 0.2 * SHRED_FEED_MS) / 1000;
  return {
    dx: -(l.x + l.w - cut + 1) * e,
    dy: rise ? -0.5 * (4 * l.h) * fall * fall : 0.5 * (12 * l.h) * fall * fall,
    alpha: 1 - clamp01((age - SHRED_FEED_MS) / SHRED_FALL_MS),
    done: age >= SHRED_FEED_MS + SHRED_FALL_MS,
  };
}

export const effectsShredderMethods = {
  // On for the look showing: Pop effects and Shredder the "When you delete"
  // choice - on any cursor (effects-eaters.ts morphs it into a line).
  _shredderOn(this: CursorSmithPlugin): boolean {
    return this._eaterOn() === "shredder";
  },

  // A key that deletes (Backspace or Delete): the blades out, or kept out.
  _shredBite(this: CursorSmithPlugin) {
    if (!this._shredderOn()) return;
    const now = performance.now();
    const s = this._shred;
    if (s && now - s.t < SHRED_HOLD_MS) s.t = now;
    else this._shred = { t0: now, t: now, letters: s ? s.letters : [] };
  },

  // What the key took (effects-delete.ts): the letters, nearest first, each
  // fed through from where it stood - unless "Shredded letters" is off:
  // then the blades alone, the letters simply gone.
  spawnShreds(this: CursorSmithPlugin, deleted: DeletedLetters) {
    const s = this._shred;
    if (!s || this.look.shredderLetters === false) return;
    const old = deleted.old;
    const h = old.h || 20;
    const font = this.fontString(old.fontSize, old.fontFamily, old.fontWeight, old.fontStyle);
    const color = old.textColor || this.getActiveColor() || "#888888";
    const now = performance.now();
    for (const l of deleted.letters.slice(0, MEAL_MAX)) {
      if (!l.char.trim()) continue;
      s.letters.push({ char: l.char, x: l.x, w: l.w, top: old.top, h, old, font, color, t0: now });
    }
  },

  // The cutting at `now`: how cut the line is and the letters still about -
  // or null when the line is whole and every ribbon gone.
  shredPose(this: CursorSmithPlugin, now: number): ShredPose | null {
    const s = this._shred;
    if (!s || !this._shredderOn()) return null;
    s.letters = s.letters.filter((l) => now - l.t0 < SHRED_FEED_MS + SHRED_FALL_MS);
    const last = Math.max(0, now - s.t);
    if (last >= SHRED_HOLD_MS && !s.letters.length) { this._shred = null; return null; }
    return { dash: last >= SHRED_HOLD_MS ? 0 : shredDash(Math.max(0, now - s.t0), last), letters: s.letters };
  },

  // Whether it is still about (the frame governor keeps the frames coming).
  shredMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.shredPose(now);
  },

  // The letters going through the cut at x `cut`: the part not yet through
  // whole, the part through cut into ribbons - each a band of the row,
  // fanning out from the cut, falling and fading. In the text's color, the
  // glow kept off them.
  drawShreds(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, cut: number, pose: ShredPose, now: number) {
    // The letters' effect: Burst breaks a letter into pixels once it is all
    // through; Evaporate sends its ribbons up instead of down.
    const fx = this.look.popEffects ? letterChoiceOf(this.look) : "vanish";
    for (const l of pose.letters) {
      const f = shredFeed(l, cut, now, fx === "evaporate");
      if (f.done) continue;
      if (fx === "burst" && now - l.t0 >= SHRED_FEED_MS) {
        if (!l.popped) { l.popped = true; this._eatenLetterFx(l.char, l.w, l.old, cut - l.w - 1, l.top); }
        continue;
      }
      const cx = l.x + l.w / 2 + f.dx, cy = l.top + l.h / 2;
      const far = 4 * l.h;
      const glyph = () => {
        ctx.font = l.font;
        ctx.fillStyle = l.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(l.char, cx, cy);
      };
      // Not through yet: whole.
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.beginPath();
      ctx.rect(cut, l.top - l.h, far, 3 * l.h);
      ctx.clip();
      glyph();
      ctx.restore();
      // Through: the ribbons.
      const band = l.h / SHRED_RIBBONS, mid = (SHRED_RIBBONS - 1) / 2;
      for (let i = 0; i < SHRED_RIBBONS; i++) {
        const a = -(i - mid) * SHRED_FAN;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.globalAlpha *= f.alpha;
        ctx.translate(0, f.dy);
        // Sheared about the cut: a ribbon fans out the further it is through.
        ctx.transform(1, a, 0, 1, 0, -a * cut);
        ctx.beginPath();
        ctx.rect(cut - far, l.top + i * band + 0.35, far, band - 0.7);
        ctx.clip();
        glyph();
        ctx.restore();
      }
      this._markDirty(cut - far, l.top - l.h, far + l.w + 2, 3 * l.h + f.dy);
    }
  },

  // The Line as blades, in its rect (x, y, w, h) and its own paint: the
  // dashes, buzzing a little, as one fill. A Box keeps its box: the same
  // blades across its width, strips (outlined, `stroke` wide, when the box
  // is hollow).
  drawShredLine(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: ShredPose, now: number, stroke = 0) {
    ctx.beginPath();
    for (const [dx, top, len] of shredBlades(pose.dash, w, h, now)) ctx.rect(x + dx, y + top, w, len);
    if (stroke > 0) {
      ctx.strokeStyle = paint;
      ctx.lineWidth = stroke;
      ctx.stroke();
    } else {
      ctx.fillStyle = paint;
      ctx.fill();
    }
  },
};
