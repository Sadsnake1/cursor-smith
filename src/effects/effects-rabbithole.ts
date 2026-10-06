// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Vacuum (1.7.7; asked as "Portal. It sucks the letters in",
// named Rabbit hole, renamed when "it does not look like a rabbit hole" -
// the code keeps the old names, rabbitHole and hole*, as the saved
// settings do): the Underline cursor - the floor under the letter - sucks
// the letters Backspace or Delete takes down into it. A letter is pulled
// down, faster and faster, stretching tall and thin toward it (no streaks:
// the user's word); the floor dips in one quick pull as the letter goes in
// - a shallow dip ("dont make the cursor a circle, make it curved concave
// just a bit"; a dark ellipse for a day) - and it goes through, thinner,
// out of sight; then the floor springs back up past straight and wobbles
// to rest. A floor: on a Box or a Line the cursor morphs into one
// first (effects-eaters.ts).
import type { CaretRecord, DeletedLetters } from "../types";
import { letterChoiceOf } from "../settings/settings";
import type CursorSmithPlugin from "../plugin";

// A letter's way in: pulled down to the floor (to LAND of the way), then
// through it (to the end) - SINK, where it starts going through, is LAND.
export const HOLE_FALL_MS = 420;
const LAND = 0.55, SINK = LAND;
// How far the floor dips as it pulls a letter in (a letter's width - "just
// a bit"), how much taller a letter is stretched by the pull (it goes
// thinner as much).
export const HOLE_SAG = 0.3;
export const HOLE_STRETCH = 0.5;
// The floor's spring: its frequency (Hz) and damping ratio (0.3: it springs
// back past straight and wobbles), the kick a landing gives it and a key's
// tap (letter widths a second).
export const HOLE_HZ = 5;
export const HOLE_DAMPING = 0.3;
export const HOLE_KICK = 6;
const MEAL_MAX = 12;

// A letter going down: where its middle stood, half its height (from its
// middle to its foot), its font and color, when it set off, whether it has
// landed.
// fx: the letters' effect played for it.
export interface HoleLetter { char: string; cx: number; cy: number; half: number; w: number; old: CaretRecord; font: string; color: string; t0: number; landed: boolean; fx?: boolean }
// The floor's spring (sag in letter widths, down positive) and the letters.
// floor: where the floor's middle was last drawn (the letters' effect plays
// there).
export interface HoleState { sag: number; v: number; at: number; letters: HoleLetter[]; floor?: { x: number; y: number } }
export interface HolePose { sag: number; letters: HoleLetter[] }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// The floor's spring toward `target` over dt seconds (up to two), in small
// steps so any frame rate gives the same bounce. Pure.
export function holeSpring(s: { sag: number; v: number }, dt: number, target: number) {
  const w = 2 * Math.PI * HOLE_HZ;
  dt = Math.max(0, Math.min(2, dt));
  const steps = Math.max(1, Math.ceil(dt * 480));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (-w * w * (s.sag - target) - 2 * HOLE_DAMPING * w * s.v) * h;
    s.sag += s.v * h;
  }
}

// A letter at `now`, the floor's middle at (fx, fy) (its top edge, where it
// dips deepest): where its foot is (x, foot), how it is stretched (sx, sy,
// about its foot), shrunk (k) and turned (rot, none: the pull is straight),
// how seen (alpha), which part of its way it is on (0 pulled down, 2 going
// through) and whether it is gone. Pulled down faster and faster, it
// stretches tall and thin toward the floor; then it goes through, thinner
// still, its top past the floor by the end. Pure.
export function holeFall(l: HoleLetter, fx: number, fy: number, now: number) {
  const u = clamp01((now - l.t0) / HOLE_FALL_MS);
  const foot0 = l.cy + l.half;
  if (u < LAND) {
    const e = Math.pow(u / LAND, 3);
    return { x: l.cx + (fx - l.cx) * e, foot: foot0 + (fy - foot0) * e, sx: 1 - 0.4 * e, sy: 1 + HOLE_STRETCH * e, k: 1, rot: 0, alpha: 1, phase: 0, done: false };
  }
  const c = (u - SINK) / (1 - SINK);
  const sx = 0.6 - 0.35 * c, sy = 1 + HOLE_STRETCH + 0.4 * c, k = 1 - 0.2 * c;
  return { x: fx, foot: fy + 2 * l.half * sy * k * Math.pow(c, 1.2) + 1, sx, sy, k, rot: 0, alpha: 1, phase: 2, done: u >= 1 };
}

export const effectsRabbitHoleMethods = {
  // On for the look showing: Pop effects and Vacuum the cursor's choice on
  // delete - on any cursor (effects-eaters.ts morphs it into a floor).
  _holeOn(this: CursorSmithPlugin): boolean {
    return this._eaterOn() === "rabbithole";
  },

  // A key that deletes (Backspace or Delete): a light tap on the floor.
  _holeBite(this: CursorSmithPlugin) {
    if (!this._holeOn()) return;
    const now = performance.now();
    const s = this._hole;
    if (s) {
      if (now > s.at) { holeSpring(s, (now - s.at) / 1000, 0); s.at = now; }
      s.v += 0.25 * HOLE_KICK;
    } else {
      this._hole = { sag: 0, v: 0.25 * HOLE_KICK, at: now, letters: [] };
    }
  },

  // What the key took (effects-delete.ts): the letters, each dropping from
  // where it stood.
  spawnHoleMeal(this: CursorSmithPlugin, deleted: DeletedLetters) {
    const s = this._hole;
    if (!s) return;
    const old = deleted.old;
    const h = old.h || 20;
    const font = this.fontString(old.fontSize, old.fontFamily, old.fontWeight, old.fontStyle);
    const color = old.textColor || this.getActiveColor() || "#888888";
    // From a glyph's middle to its foot (the baseline): about 0.3 of the font.
    const half = 0.3 * (old.fontSize || 16);
    const now = performance.now();
    for (const l of deleted.letters.slice(0, MEAL_MAX)) {
      if (!l.char.trim()) continue;
      s.letters.push({ char: l.char, cx: l.x + l.w / 2, cy: old.top + h / 2, half, w: l.w, old, font, color, t0: now, landed: false });
    }
  },

  // The floor at `now`: how far it sags (the spring run up to now - pulled
  // down while a letter is on it or going through, kicked by each landing)
  // and the letters still about - or null when every letter is gone and
  // the floor has come to rest.
  holePose(this: CursorSmithPlugin, now: number): HolePose | null {
    const s = this._hole;
    if (!s || !this._holeOn()) return null;
    // The letters' effect: Burst as a splash of pixels out of the dip as a
    // letter goes in, Evaporate as its ghost floating back up out of it.
    const fx = this.look.popEffects ? letterChoiceOf(this.look) : "vanish";
    for (const l of s.letters) {
      const u = (now - l.t0) / HOLE_FALL_MS;
      if (l.fx || fx === "vanish" || u < (fx === "burst" ? SINK : 0.9)) continue;
      l.fx = true;
      const at = s.floor || { x: l.cx, y: l.cy + l.half };
      const h = l.old.h || 20;
      this._eatenLetterFx(l.char, l.w, l.old, at.x - l.w / 2, at.y - (fx === "burst" ? 0.6 : 0.5) * h);
    }
    s.letters = s.letters.filter((l) => now - l.t0 < HOLE_FALL_MS);
    let weighed = false;
    for (const l of s.letters) {
      const u = (now - l.t0) / HOLE_FALL_MS;
      if (u >= LAND) weighed = true;
      if (u >= LAND && !l.landed) { l.landed = true; s.v += HOLE_KICK; }
    }
    if (now > s.at) { holeSpring(s, (now - s.at) / 1000, weighed ? HOLE_SAG : 0); s.at = now; }
    if (!s.letters.length && Math.abs(s.sag) < 0.003 && Math.abs(s.v) < 0.05) { this._hole = null; return null; }
    return { sag: s.sag, letters: s.letters };
  },

  // Whether it is still about (the frame governor keeps the frames coming).
  holeMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.holePose(now);
  },

  // The Underline as the floor, in its bar (x, y, w, h) and its own paint:
  // the letters first (seen above the bar's top edge, curved as the bar is;
  // out of sight once through it), then the bar along the curve - its ends
  // where they were, its middle down (or up, springing back), its thickness
  // the bar's.
  drawHole(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: HolePose, now: number) {
    const sag = pose.sag * w;
    const cx = x + w / 2, mid = y + h / 2, top = y;
    if (this._hole) this._hole.floor = { x: cx, y: top + sag };
    for (const l of pose.letters) {
      const f = holeFall(l, cx, top + sag, now);
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
      // About its foot: squashed onto the floor, shrunk and turned going
      // through.
      ctx.translate(f.x, f.foot);
      ctx.rotate(f.rot);
      ctx.scale(f.sx * f.k, f.sy * f.k);
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(l.char, 0, -l.half);
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
