// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Portal (1.7.7; asked as "Portal. It sucks the letters in",
// named Rabbit hole, then Vacuum when "it does not look like a rabbit
// hole", then Portal again when "the underline vacuum needs to open a bit.
// so a gap could work. and maybe rename it to Portal" - the code keeps the
// old names, rabbitHole and hole*, as the saved settings do): the
// Underline cursor - the floor under the letter - takes the letters
// Backspace or Delete takes down through it. The floor stays still; a
// letter drops straight down into it and is cut off at its top edge, out
// of sight below - the part of it nearest the floor lit in the cursor's
// color (HOLE_TINT), as into the portal's light - and the floor brightens
// while it passes (HOLE_GLOW). A halo round the floor went: on a 2 px
// Underline it read as "the portal just get thicker". "Straight through",
// picked of three mockups ("do A"). What
// it replaced: a gap opening for a day read as a trapdoor ("remove that
// gap"); then a letter stretched tall, turning as it sank, over a floor
// that dipped, rippled and sprang back read as "the letters look like
// fallen trees and the portal like a bouncy bed" - so no stretch, no turn,
// no spring. A word taken at once (a phone's held Backspace) drops
// straight down too, every letter where it stood: the floor reaches along
// under it as it goes in and draws back as it is gone (holeSpan) - slid
// over to the floor, a word's letters piled up on it. Only ahead of the
// caret, where the letters a deletion leaves are (a held Backspace's still
// going down, a word's): behind it are only letters typed over again, and
// reaching back to them laid a long bar under the new ones. A floor: on a Box or
// a Line the cursor morphs into one first (effects-eaters.ts). No serifs:
// the Underline's give way to it.
import type { CaretRecord, DeletedLetters } from "../types";
import { letterChoiceOf } from "../settings/settings";
import { parseColorTuple } from "../util/color";
import type CursorSmithPlugin from "../plugin";

// A letter's way: from where it stood until it is out of sight below the
// floor's top edge (all but the last HOLE_REACH of it), then the floor
// drawing back (holeSpan).
export const HOLE_FALL_MS = 420;
// How tall a letter is, from its foot up, in halves (half: from its middle
// to its foot, 0.3 of the font): a capital's or an ascender's top.
export const HOLE_TALL = 2.5;
// The floor reaching under a letter that stood away from it: out over the
// first HOLE_REACH of the letter's way, back over the last.
export const HOLE_REACH = 0.15;
// The glow while a letter passes: white over the floor's paint, this
// strong at its height - the floor keeps its thickness.
export const HOLE_GLOW = 0.6;
// The portal's light on a letter going in: its lowest HOLE_TINT of its
// height above the floor in the cursor's color, fading up from the floor.
export const HOLE_TINT = 0.45;
// How long the floor stays after the last key or letter.
export const HOLE_HOLD_MS = 200;
// Where in its way the letters' effect plays for a letter: Burst as it
// goes through, Evaporate once it is gone.
export const HOLE_BURST_AT = 0.5;
const EVAPORATE_AT = 0.9;
const MEAL_MAX = 12;

// A letter going down: where its middle stood, half its height (from its
// middle to its foot), its font and color, when it set off.
// fx: the letters' effect played for it.
export interface HoleLetter { char: string; cx: number; cy: number; half: number; w: number; old: CaretRecord; font: string; color: string; t0: number; fx?: boolean }
// The letters, and the last key or the last letter's end (the floor stays
// HOLE_HOLD_MS after). floor: where the floor's middle was last drawn (its
// top edge: the letters' effect plays there).
export interface HoleState { at: number; letters: HoleLetter[]; floor?: { x: number; y: number } }
export interface HolePose { letters: HoleLetter[] }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

// A letter at `now`, the floor's top edge at `fy`: where its foot is (x,
// foot - straight down from where it stood, slow to start, faster as it
// goes in), how much of it is through the floor (through, 0 none, 1 all),
// which part of its way it is on (0 above, 2 going through) and whether it
// is gone. Pure.
export function holeFall(l: HoleLetter, fy: number, now: number) {
  const u = clamp01((now - l.t0) / HOLE_FALL_MS);
  const foot0 = l.cy + l.half;
  const tall = HOLE_TALL * l.half;
  const foot = foot0 + (Math.max(0, fy - foot0) + tall + 1) * smooth(clamp01(u / (1 - HOLE_REACH)));
  const through = clamp01((foot - fy) / tall);
  return { x: l.cx, foot, through, phase: through > 0 ? 2 : 0, done: u >= 1 };
}

// How far the floor reaches under a letter that stood away from it, `u` of
// the letter's way along: all the way while it goes through, out before it
// reaches the floor, back once it is gone. Pure.
export function holeSpan(u: number): number {
  return smooth(clamp01(u / HOLE_REACH)) * (1 - smooth(clamp01((u - (1 - HOLE_REACH)) / HOLE_REACH)));
}

// The glow for a letter `through` of the way through the floor: up as it
// goes in, gone as it is out of sight. Pure.
export function holeGlow(through: number): number {
  return through > 0 && through < 1 ? Math.sin(Math.PI * through) : 0;
}

export const effectsRabbitHoleMethods = {
  // On for the look showing: Pop effects and Portal the cursor's choice on
  // delete - on any cursor (effects-eaters.ts morphs it into a floor).
  _holeOn(this: CursorSmithPlugin): boolean {
    return this._eaterOn() === "rabbithole";
  },

  // A key that deletes (Backspace or Delete): the floor out.
  _holeBite(this: CursorSmithPlugin) {
    if (!this._holeOn()) return;
    const now = performance.now();
    if (this._hole) this._hole.at = now;
    else this._hole = { at: now, letters: [] };
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
      s.letters.push({ char: l.char, cx: l.x + l.w / 2, cy: old.top + h / 2, half, w: l.w, old, font, color, t0: now });
      s.at = Math.max(s.at, now + HOLE_FALL_MS);
    }
  },

  // The floor at `now`: the letters still about - or null when every
  // letter is gone and HOLE_HOLD_MS has passed since the last.
  holePose(this: CursorSmithPlugin, now: number): HolePose | null {
    const s = this._hole;
    if (!s || !this._holeOn()) return null;
    // The letters' effect: Burst as a splash of pixels out of the floor as
    // a letter goes through, Evaporate as its ghost floating back up out of
    // it.
    const fx = this.look.popEffects ? letterChoiceOf(this.look) : "vanish";
    for (const l of s.letters) {
      const u = (now - l.t0) / HOLE_FALL_MS;
      if (l.fx || fx === "vanish" || u < (fx === "burst" ? HOLE_BURST_AT : EVAPORATE_AT)) continue;
      l.fx = true;
      // Where it went in: its own cell (it drops straight), at the floor.
      const fy = s.floor ? s.floor.y : l.cy + l.half;
      const h = l.old.h || 20;
      this._eatenLetterFx(l.char, l.w, l.old, l.cx - l.w / 2, fy - (fx === "burst" ? 0.6 : 0.5) * h);
    }
    s.letters = s.letters.filter((l) => now - l.t0 < HOLE_FALL_MS);
    if (!s.letters.length && now - s.at >= HOLE_HOLD_MS) { this._hole = null; return null; }
    return { letters: s.letters };
  },

  // Whether it is still about (the frame governor keeps the frames coming).
  holeMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.holePose(now);
  },

  // The Underline as the floor, in its bar (x, y, w, h) and its own paint:
  // the letters first (seen above the bar's top edge, out of sight once
  // through it), then the bar, still, rounded as Rounded corners rounds it
  // - reaching along to the right under letters that stood away from it
  // (holeSpan), lit (HOLE_GLOW) while a letter passes. A letter's part
  // nearest the floor takes the cursor's color (HOLE_TINT).
  drawHole(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: HolePose, now: number) {
    const top = y;
    if (this._hole) this._hole.floor = { x: x + w / 2, y: top };
    const rgb = parseColorTuple(typeof paint === "string" ? paint : this.getActiveColor()) || [255, 255, 255];
    const tint = (a: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
    let glow = 0, right = x + w;
    for (const l of pose.letters) {
      const f = holeFall(l, top, now);
      if (f.done) continue;
      glow = Math.max(glow, holeGlow(f.through));
      const reach = holeSpan((now - l.t0) / HOLE_FALL_MS);
      right = Math.max(right, x + w + Math.max(0, l.cx + l.w / 2 - x - w) * reach);
      const far = 6 * Math.max(l.w, Math.abs(l.cx - x) + w);
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      // Above the floor's top edge: what has gone through it is gone.
      ctx.beginPath();
      ctx.rect(x - far, top - far, w + 2 * far, far);
      ctx.clip();
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(l.char, f.x, f.foot - l.half);
      // ...and its part nearest the floor in the portal's light.
      const band = HOLE_TINT * HOLE_TALL * l.half;
      if (f.foot > top - band) {
        ctx.beginPath();
        ctx.rect(x - far, top - band, w + 2 * far, band);
        ctx.clip();
        const g = ctx.createLinearGradient(0, top - band, 0, top);
        g.addColorStop(0, tint(0));
        g.addColorStop(1, tint(1));
        ctx.fillStyle = g;
        ctx.fillText(l.char, f.x, f.foot - l.half);
      }
      ctx.restore();
      this._markDirty(l.cx - 2 * l.w, Math.min(l.cy, top) - 2 * l.w - 4 * l.half, 4 * l.w, Math.abs(top - l.cy) + 4 * l.w + 8 * l.half);
    }
    const bw = right - x;
    const r = this.cornerRadius(Math.min(bw, h));
    ctx.fillStyle = paint;
    ctx.beginPath();
    this.traceRoundedRect(ctx, x, y, bw, h, r);
    ctx.fill();
    if (glow > 0.01) {
      // The light over it, the glow kept off that.
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.fillStyle = `rgba(255, 255, 255, ${(HOLE_GLOW * glow).toFixed(3)})`;
      ctx.fill();
      ctx.restore();
    }
    this._markDirty(x - 4, y - 4, bw + 8, h + 8);
  },
};
