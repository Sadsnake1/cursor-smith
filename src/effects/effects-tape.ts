// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Typewriter's Correction tape (1.7.2): what Backspace (or Delete) takes is
// lifted off the page the way a Selectric II's correcting tape did it - a
// strip of white tape strikes each deleted letter, and lifts away with the
// letter stuck to it, fading. Where each letter stood comes from
// effects-delete.ts, shared with the Pop effects' deletions.
import type { DeletedLetters, TapeStrip } from "../types";
import type CursorSmithPlugin from "../plugin";

// One letter's tape, start to gone; each lifts this long after the one
// nearer the caret; the share of it the tape spends coming down onto the
// letter (the rest is the lift).
export const TAPE_MS = 560;
const TAPE_STAGGER_MS = 22;
export const TAPE_DOWN = 0.2;
// How high the tape lifts the letter, in lines, and how tall the strip is
// against the line.
const TAPE_LIFT_LINES = 0.55;
const TAPE_STRIP = 0.64;

export const effectsTapeMethods = {
  // Whether the effect is on: Typewriter, then its own.
  _tapeOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.typewriter && this.look.typewriterTape);
  },

  // The letters of one deletion, nearest the caret first. A space takes its
  // room and gets no tape.
  spawnTape(this: CursorSmithPlugin, deleted: DeletedLetters) {
    if (!this._tapeOn()) return;
    const old = deleted.old;
    const t0 = performance.now();
    const color = old.textColor || this.getActiveColor() || "#888888";
    deleted.letters.forEach((l, k) => {
      if (!l.char.trim()) return;
      this.typeTapes.push({
        char: l.char, x: l.x, w: l.w, top: old.top, h: old.h || 20,
        fontSize: old.fontSize, fontFamily: old.fontFamily, fontWeight: old.fontWeight, fontStyle: old.fontStyle,
        color, start: t0, delay: k * TAPE_STAGGER_MS,
      });
    });
  },

  // Where the tape and its letter are at `t` (0 struck, 1 gone): coming down
  // over the letter first (it shows under the tape), then lifting away with
  // the letter on it, both fading.
  tapePose(this: CursorSmithPlugin, g: TapeStrip, t: number) {
    const u = Math.max(0, Math.min(1, t));
    if (u < TAPE_DOWN) {
      const d = u / TAPE_DOWN;
      return { tapeDy: -(1 - (1 - (1 - d) * (1 - d))) * g.h * 0.25, tapeAlpha: 0.92 * d, letterDy: 0, letterAlpha: 1, onTape: false };
    }
    const v = (u - TAPE_DOWN) / (1 - TAPE_DOWN);
    const lift = -(1 - (1 - v) * (1 - v)) * g.h * TAPE_LIFT_LINES;
    return { tapeDy: lift, tapeAlpha: 0.92 * Math.pow(1 - v, 1.2), letterDy: lift, letterAlpha: Math.pow(1 - v, 1.5), onTape: true };
  },

  drawTape(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.typeTapes.length) return;
    const now = performance.now();
    // Correction tape is white; on a dark page a paper white, a little
    // softer, so it does not glare.
    // On a light page the strip is pure white with a thin shadow under it,
    // so it reads as a piece of tape and not as more page.
    const dark = this.isDarkTheme();
    const tape = dark ? "#e6e2d6" : "#ffffff";
    const edge = dark ? "rgba(0, 0, 0, 0.35)" : "rgba(0, 0, 0, 0.16)";
    const shadow = dark ? "rgba(0, 0, 0, 0.45)" : "rgba(0, 0, 0, 0.18)";
    this.typeTapes = this.typeTapes.filter((g) => {
      const t = (now - g.start - g.delay) / TAPE_MS;
      if (t >= 1) return false;
      if (t < 0) return true;
      const p = this.tapePose(g, t);
      ctx.save();
      ctx.font = this.fontString(g.fontSize, g.fontFamily, g.fontWeight, g.fontStyle);
      const m = ctx.measureText(g.char);
      const ascent = m.fontBoundingBoxAscent ?? g.fontSize * 0.8;
      const descent = m.fontBoundingBoxDescent ?? g.fontSize * 0.2;
      const baseline = g.top + ascent + (g.h - ascent - descent) / 2;
      const sh = g.h * TAPE_STRIP, sw = Math.max(g.w, m.width) + 4;
      const sx = g.x - 2, sy = g.top + (g.h - sh) / 2 + p.tapeDy;
      const letter = () => {
        ctx.globalAlpha = Math.max(0, p.letterAlpha);
        ctx.fillStyle = g.color;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(g.char, g.x, baseline + p.letterDy);
      };
      // The letter under the tape as it comes down; on it as it lifts.
      if (!p.onTape) letter();
      ctx.globalAlpha = Math.max(0, p.tapeAlpha);
      ctx.fillStyle = shadow;
      ctx.fillRect(sx + 1, sy + 1.5, sw, sh);
      ctx.fillStyle = tape;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
      if (p.onTape) letter();
      ctx.restore();
      this._markDirty(sx - 2, g.top - g.h * (TAPE_LIFT_LINES + 0.3), sw + 4, g.h * (TAPE_LIFT_LINES + 1.6));
      return true;
    });
  },
};

export type EffectsTapeMethods = typeof effectsTapeMethods;
