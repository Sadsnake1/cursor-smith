// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Shredder (1.7.7, "if the line style is on then a new
// backspace effect. the line becomes dashed - call it Shredder"): while
// Backspace or Delete eats the text, the Line cursor breaks into dashes -
// a shredder's blades, turning (their gaps run down the line, SHRED_SPIN)
// and jolting as each bite goes in (SHRED_JOLT) - and the letters it takes
// are fed through them, coming out the other side cut into ribbons that
// fan apart, then flutter down each its own way (shredRibbon: its own
// speed, swaying and twisting) and fade; when the last is through, the
// line is whole again. A new key hurries the letters still going in
// through (SHRED_RUSH_MS): on a held key the line moves on a letter every
// ~33 ms and they trailed behind it. With Burst, a cross-cut shredder: once
// all through, each ribbon breaks into bits (SHRED_CROSS across it) that
// scatter, tumbling, and fall (shredChip) - the letter's own pieces, in its
// color, where Burst's pixels were played apart from it. A standing line:
// on an Underline the
// cursor morphs into one first (effects-eaters.ts); a Box stays a box, the
// whole of it cut into strips.
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
// A letter still going in when the next key comes: through by this long
// after it (under a held key's ~33 ms, so it is through before the next).
export const SHRED_RUSH_MS = 25;
// The ribbons' flutter: each falls between SHRED_FALL_SPREAD below and
// above the letter's pace, sways up to SHRED_SWAY of the letter's width,
// tilts up to SHRED_TILT radians and twists (seen edge on and back) about
// SHRED_TWIST_HZ times a second - all growing in over their first
// SHRED_FLUTTER_IN_S of falling.
export const SHRED_FALL_SPREAD = 0.25;
export const SHRED_SWAY = 0.3;
export const SHRED_TILT = 0.4;
export const SHRED_TWIST_HZ = 3;
const SHRED_FLUTTER_IN_S = 0.12;
// The blades turning: their gaps run down the line this many blades a
// second.
export const SHRED_SPIN = 6;
// The jolt as a bite goes in: px aside at most (a letter's, a word's),
// gone over SHRED_JOLT_MS.
export const SHRED_JOLT = 0.8;
export const SHRED_JOLT_WORD = 1.8;
export const SHRED_JOLT_MS = 140;
// Burst's cross-cut: each ribbon broken into this many bits across (about
// square: a letter's width over two, a row's height over five); how fast
// they scatter (px a second, at a 24 px row) and tumble (radians a
// second, at most).
export const SHRED_CROSS = 2;
export const SHRED_SCATTER = 90;
export const SHRED_TUMBLE = 9;
// The most letters drawn as bits at once (10 bits each): a held key keeps
// about 13 breaking, 200 clipped letters a frame (~0.8 ms on a desktop,
// three times that on a phone) - the oldest, mostly faded, go first. As
// many as the ribbons drew before.
export const SHRED_CHIP_LETTERS = 10;
const MEAL_MAX = 12;

// A letter going through: its cell (x, w) and row (top, h), its font and
// color, when it set off.
// rush: when the next key hurried it through.
export interface ShredLetter { char: string; x: number; w: number; top: number; h: number; old: CaretRecord; font: string; color: string; t0: number; rush?: number }
// t0: when this run of cutting began; t: its last key; jolt: the last
// bite's jolt (when, how hard).
export interface ShredState { t0: number; t: number; letters: ShredLetter[]; jolt?: { t: number; amp: number } }
// jolt: the line's offset aside now (px).
export interface ShredPose { dash: number; jolt: number; letters: ShredLetter[] }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// How cut the line is (0 whole, 1 all blades), `first` ms into the run and
// `last` ms after its last key: in at once, out over the hold's end. Pure.
export function shredDash(first: number, last: number): number {
  return Math.min(clamp01(first / 40), last < SHRED_HOLD_MS - 90 ? 1 : clamp01((SHRED_HOLD_MS - last) / 90));
}

// The line's jolt `since` ms after a bite `amp` px hard: a quick shake
// aside, dying out. Pure.
export function shredJolt(since: number, amp: number): number {
  if (!(since >= 0) || since >= SHRED_JOLT_MS) return 0;
  const k = 1 - since / SHRED_JOLT_MS;
  return amp * k * k * Math.sin(since * 0.12);
}

// The blades of a Line w x h, `dash` cut, at `now`: [x offset, top,
// height] each, px from the line's top left - their gaps running down the
// line (SHRED_SPIN), a blade going out at the foot coming back in at the
// top; every other one jolted a little less (`jolt`, px aside), so they
// chatter. Pure.
export function shredBlades(dash: number, w: number, h: number, now: number, jolt = 0): [number, number, number][] {
  const n = Math.max(4, Math.min(8, Math.round(h / 4)));
  const pitch = h / n, gap = pitch * 0.42 * clamp01(dash);
  const run = gap > 0 ? (((now / 1000) * SHRED_SPIN * pitch) % pitch + pitch) % pitch : 0;
  const out: [number, number, number][] = [];
  for (let i = -1; i < n; i++) {
    const top = i * pitch + gap / 2 + run, bottom = top + pitch - gap;
    const a = Math.max(0, top), b = Math.min(h, bottom);
    if (b - a > 0.01) out.push([jolt * ((i + n) % 2 ? 1 : 0.6), a, b - a]);
  }
  return out;
}

// A letter fed through the cut at x `cut`, at `now`: how far it has moved
// (toward the cut and past it, its right edge a pixel beyond at the end of
// the feed - sooner if the next key hurried it, `l.rush`), how far its
// ribbons have fallen (from a fifth of the way in; with `rise`, risen -
// Evaporate) and for how long (s), how faded they are, and whether it is
// all gone. Pure.
export function shredFeed(l: ShredLetter, cut: number, now: number, rise = false) {
  const age = now - l.t0;
  const u = Math.max(clamp01(age / SHRED_FEED_MS), l.rush !== undefined ? clamp01((now - l.rush) / SHRED_RUSH_MS) : 0);
  const e = u * u * (3 - 2 * u);
  // Falling as soon as they are out, fast enough to clear the row before
  // the next letter over: they drop out of the text, not over it.
  const fall = Math.max(0, age - 0.2 * SHRED_FEED_MS) / 1000;
  return {
    dx: -(l.x + l.w - cut + 1) * e,
    dy: rise ? -0.5 * (4 * l.h) * fall * fall : 0.5 * (12 * l.h) * fall * fall,
    fall,
    alpha: 1 - clamp01((age - SHRED_FEED_MS) / SHRED_FALL_MS),
    done: age >= SHRED_FEED_MS + SHRED_FALL_MS,
  };
}

// A number in 0..1 for ribbon `i` of a letter, the same every frame. Pure.
function ribbonSeed(l: ShredLetter, i: number): number {
  const v = Math.sin((l.char.charCodeAt(0) || 0) * 12.9898 + i * 78.233 + l.x * 0.37 + l.t0 * 0.011) * 43758.5453;
  return v - Math.floor(v);
}

// Ribbon `i` of a letter fed through the cut at `cut` (`f` its shredFeed
// at `now`), as a canvas transform [a, b, c, d, e, f] on the letter drawn
// where it is (its cell moved by f.dx): sheared about the cut, fanning
// out; then fallen at its own pace, swayed aside, tilted and twisted about
// its own middle. Pure.
export function shredRibbon(l: ShredLetter, i: number, cut: number, f: { dy: number; fall: number }, now: number): [number, number, number, number, number, number] {
  const n = SHRED_RIBBONS, band = l.h / n;
  const a = -(i - (n - 1) / 2) * SHRED_FAN;
  const k = ribbonSeed(l, i);
  const grow = clamp01(f.fall / SHRED_FLUTTER_IN_S);
  const ph = 2 * Math.PI * k, w = 2 * Math.PI * SHRED_TWIST_HZ * (0.8 + 0.4 * k) * f.fall;
  const sway = SHRED_SWAY * l.w * grow * Math.sin(ph + 0.6 * w);
  const tilt = SHRED_TILT * grow * Math.sin(ph * 1.7 + w);
  // The twist: seen edge on and back (a third of its height at the
  // thinnest).
  const flip = 1 - 0.67 * grow * (0.5 - 0.5 * Math.cos(ph * 2.3 + 1.3 * w));
  const dy = f.dy * (1 + SHRED_FALL_SPREAD * (2 * k - 1));
  // Its middle, sheared: half a letter left of the cut, at its band's
  // middle.
  const mx = cut - l.w / 2, my = l.top + (i + 0.5) * band - (a * l.w) / 2;
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  // R = rotate(tilt) * scale(1, flip), about (mx, my), moved by (sway, dy).
  const ra = cos, rb = sin, rc = -sin * flip, rd = cos * flip;
  const re = mx + sway - (ra * mx + rc * my), rf = my + dy - (rb * mx + rd * my);
  // ...after the shear about the cut: [1, a, 0, 1, 0, -a * cut].
  return [ra + rc * a, rb + rd * a, rc, rd, re - rc * a * cut, rf - rd * a * cut];
}

type Mat = [number, number, number, number, number, number];
// A then B's transform as one (B first, as canvas's transform() stacks).
const mul = (A: Mat, B: Mat): Mat => [
  A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
];

// When a letter is all through the cut: the feed's end, or sooner if the
// next key hurried it. Pure.
export function shredThrough(l: ShredLetter): number {
  return l.rush !== undefined ? Math.min(l.t0 + SHRED_FEED_MS, l.rush + SHRED_RUSH_MS) : l.t0 + SHRED_FEED_MS;
}

// Bit `c` (across) of ribbon `i` of a letter cut through at `cut`, at
// `now` past shredThrough: the ribbon as it was when the letter got
// through (shredRibbon), then thrown out on its own - away from the cut,
// mostly up a little, pulled down as the ribbons are - and tumbling about
// its own middle; and how seen (fading over SHRED_FALL_MS). Its rect on
// the letter: across from cut - 1 - w + c w / SHRED_CROSS, a SHRED_CROSS-th
// of it wide; its ribbon's band down. `fallH`: the row its fall is paced
// by, when not its own (the settings preview's letters stand in a smaller
// box than their row). Pure.
export function shredChip(l: ShredLetter, i: number, c: number, cut: number, now: number, fallH = l.h) {
  const tb = shredThrough(l);
  const at = shredFeed(fallH === l.h ? l : { ...l, h: fallH }, cut, tb);
  const M = shredRibbon(l, i, cut, at, tb);
  const band = l.h / SHRED_RIBBONS, bw = l.w / SHRED_CROSS;
  const x = cut - 1 - l.w + (c + 0.5) * bw, y = l.top + (i + 0.5) * band;
  const px = M[0] * x + M[2] * y + M[4], py = M[1] * x + M[3] * y + M[5];
  const k1 = ribbonSeed(l, 11 + i * SHRED_CROSS + c), k2 = ribbonSeed(l, 41 + i * SHRED_CROSS + c), k3 = ribbonSeed(l, 71 + i * SHRED_CROSS + c);
  const t = Math.max(0, now - tb) / 1000, sc = fallH / 24;
  const vx = -(0.25 + 0.75 * k1) * SHRED_SCATTER * sc, vy = (-0.8 + 0.9 * k2) * SHRED_SCATTER * sc;
  const th = (2 * k3 - 1) * SHRED_TUMBLE * t, cos = Math.cos(th), sin = Math.sin(th);
  const ox = px + vx * t, oy = py + vy * t + 0.5 * (12 * fallH) * t * t;
  // Moved to (ox, oy) and turned there: T(o) R(th) T(-p), after M.
  const R: Mat = [cos, sin, -sin, cos, ox - (cos * px - sin * py), oy - (sin * px + cos * py)];
  return { m: mul(R, M), alpha: 1 - clamp01((now - tb) / SHRED_FALL_MS), rect: [cut - 1 - l.w + c * bw, l.top + i * band, bw, band] as [number, number, number, number] };
}

export const effectsShredderMethods = {
  // On for the look showing: Pop effects and Shredder the "When you delete"
  // choice - on any cursor (effects-eaters.ts morphs it into a line).
  _shredderOn(this: CursorSmithPlugin): boolean {
    return this._eaterOn() === "shredder";
  },

  // A key that deletes (Backspace or Delete): the blades out, or kept out,
  // and the letters still going in hurried through.
  _shredBite(this: CursorSmithPlugin) {
    if (!this._shredderOn()) return;
    const now = performance.now();
    const s = this._shred;
    if (s) for (const l of s.letters) if (l.rush === undefined && now - l.t0 < SHRED_FEED_MS) l.rush = now;
    if (s && now - s.t < SHRED_HOLD_MS) s.t = now;
    else this._shred = { t0: now, t: now, letters: s ? s.letters : [] };
  },

  // What the key took (effects-delete.ts): the letters, nearest first, each
  // fed through from where it stood - unless "Shredded letters" is off:
  // then the blades alone, the letters simply gone. The line jolts, harder
  // for a word.
  spawnShreds(this: CursorSmithPlugin, deleted: DeletedLetters) {
    const s = this._shred;
    if (!s) return;
    const now = performance.now();
    const many = deleted.letters.filter((l) => l.char.trim()).length > 1;
    s.jolt = { t: now, amp: many ? SHRED_JOLT_WORD : SHRED_JOLT };
    if (this.look.shredderLetters === false) return;
    const old = deleted.old;
    const h = old.h || 20;
    const font = this.fontString(old.fontSize, old.fontFamily, old.fontWeight, old.fontStyle);
    const color = old.textColor || this.getActiveColor() || "#888888";
    for (const l of deleted.letters.slice(0, MEAL_MAX)) {
      if (!l.char.trim()) continue;
      s.letters.push({ char: l.char, x: l.x, w: l.w, top: old.top, h, old, font, color, t0: now });
    }
  },

  // The cutting at `now`: how cut the line is, its jolt and the letters
  // still about - or null when the line is whole and every ribbon gone.
  shredPose(this: CursorSmithPlugin, now: number): ShredPose | null {
    const s = this._shred;
    if (!s || !this._shredderOn()) return null;
    s.letters = s.letters.filter((l) => now - l.t0 < SHRED_FEED_MS + SHRED_FALL_MS);
    const last = Math.max(0, now - s.t);
    if (last >= SHRED_HOLD_MS && !s.letters.length) { this._shred = null; return null; }
    const jolt = s.jolt ? shredJolt(now - s.jolt.t, s.jolt.amp) : 0;
    return { dash: last >= SHRED_HOLD_MS ? 0 : shredDash(Math.max(0, now - s.t0), last), jolt, letters: s.letters };
  },

  // Whether it is still about (the frame governor keeps the frames coming).
  shredMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.shredPose(now);
  },

  // The letters going through the cut at x `cut`: the part not yet through
  // whole, the part through cut into ribbons - each a band of the row,
  // fanning out from the cut, then fluttering down (shredRibbon) and
  // fading. In the text's color, the glow kept off them.
  drawShreds(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, cut: number, pose: ShredPose, now: number) {
    // The letters' effect: Burst cross-cuts a letter into bits once it is
    // all through; Evaporate sends its ribbons up instead of down.
    const fx = this.look.popEffects ? letterChoiceOf(this.look) : "vanish";
    // The oldest broken letters past SHRED_CHIP_LETTERS, gone (the letters
    // are oldest first).
    let skip = fx === "burst" ? pose.letters.filter((l) => now >= shredThrough(l) && now - l.t0 < SHRED_FEED_MS + SHRED_FALL_MS).length - SHRED_CHIP_LETTERS : 0;
    for (const l of pose.letters) {
      const f = shredFeed(l, cut, now, fx === "evaporate");
      if (f.done) continue;
      if (fx === "burst" && now >= shredThrough(l)) {
        if (skip-- > 0) continue;
        this._drawShredChips(ctx, l, cut, now);
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
      const band = l.h / SHRED_RIBBONS;
      for (let i = 0; i < SHRED_RIBBONS; i++) {
        const m = shredRibbon(l, i, cut, f, now);
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.globalAlpha *= f.alpha;
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.beginPath();
        ctx.rect(cut - far, l.top + i * band + 0.35, far, band - 0.7);
        ctx.clip();
        glyph();
        ctx.restore();
      }
      // All it may paint, for the next frame's clear: the part not yet
      // through, anywhere up to `far` right of the cut - a word taken in one
      // go has letters standing well past it (a phone's held Backspace soon
      // deletes word by word), and marking one letter's width left the rest
      // on the page - and the ribbons left of it, fanned up and down by the
      // shear, fallen (or risen) by dy and its spread, swayed and tilted.
      const fan = SHRED_FAN * ((SHRED_RIBBONS - 1) / 2) * far;
      const drop = Math.abs(f.dy) * (1 + SHRED_FALL_SPREAD);
      this._markDirty(cut - far - l.w - 2, l.top - l.h - fan - l.w - (f.dy < 0 ? drop : 0), 2 * far + 2 * l.w + 4, 3 * l.h + 2 * fan + 2 * l.w + drop);
    }
  },

  // A letter's cross-cut bits (Burst), each its piece of the letter -
  // drawn where it lies, clipped to its rect - and the room they may take,
  // marked for the next clear.
  _drawShredChips(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, l: ShredLetter, cut: number, now: number) {
    const cx = cut - 1 - l.w / 2, cy = l.top + l.h / 2;
    let alpha = 1;
    for (let i = 0; i < SHRED_RIBBONS; i++) {
      for (let c = 0; c < SHRED_CROSS; c++) {
        const ch = shredChip(l, i, c, cut, now);
        alpha = ch.alpha;
        if (ch.alpha <= 0.01) continue;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.globalAlpha *= ch.alpha;
        ctx.transform(ch.m[0], ch.m[1], ch.m[2], ch.m[3], ch.m[4], ch.m[5]);
        ctx.beginPath();
        ctx.rect(ch.rect[0], ch.rect[1] + 0.35, ch.rect[2], ch.rect[3] - 0.7);
        ctx.clip();
        ctx.font = l.font;
        ctx.fillStyle = l.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(l.char, cx, cy);
        ctx.restore();
      }
    }
    if (alpha <= 0.01) return;
    // Thrown up to SHRED_SCATTER a second left and up, pulled down after,
    // over SHRED_FALL_MS; the ribbons' fan and fall before that.
    const sc = l.h / 24, t = SHRED_FALL_MS / 1000;
    const out = SHRED_SCATTER * sc * t + 4 * l.h, down = 0.5 * 12 * l.h * (t + (SHRED_FEED_MS / 1000)) ** 2 + 2 * l.h;
    this._markDirty(cut - out - l.w - 2, l.top - out, out + 2 * l.w + 4, out + down + l.h);
  },

  // The Line as blades, in its rect (x, y, w, h) and its own paint: the
  // dashes, turning and jolting, as one fill. A Box keeps its box: the same
  // blades across its width, strips (outlined, `stroke` wide, when the box
  // is hollow).
  drawShredLine(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: ShredPose, now: number, stroke = 0) {
    ctx.beginPath();
    for (const [dx, top, len] of shredBlades(pose.dash, w, h, now, pose.jolt || 0)) ctx.rect(x + dx, y + top, w, len);
    if (stroke > 0) {
      ctx.strokeStyle = paint;
      ctx.lineWidth = stroke;
      ctx.stroke();
    } else {
      ctx.fillStyle = paint;
      ctx.fill();
    }
    const j = Math.abs(pose.jolt || 0);
    if (j > 0) this._markDirty(x - j - 2, y - 2, w + 2 * j + 4, h + 4);
  },
};
