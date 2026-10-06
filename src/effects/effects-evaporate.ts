// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Backspace evaporation (since 1.7.0): the letters a
// deletion takes rise from where they stood and fade, swaying a little and
// spreading as they go - with Backspace (the letters before the caret, right
// to left) or Delete (the letters after it, left to right). What was taken,
// and where, is read in effects-delete.ts, shared with Backspace
// disintegration. Smoke on delete, then Evaporate on delete (a part of
// Popping letters), before the user settled the name and the place.
import { hslToRgbString } from "../util/color";
import { deleteEffectOf } from "../settings/settings";
import type { DeletedLetters, EvaporateGlyph } from "../types";
import type CursorSmithPlugin from "../plugin";

// How long a letter takes to go, and how high it rises, in lines: baked in
// (they were sliders for a day; the user: "bake those in").
export const EVAPORATE_MS = 1100;
export const EVAPORATE_RISE_LINES = 1.2;
// Each letter lifts off this long after the one nearer the caret.
const EVAPORATE_STAGGER_MS = 16;
// How far it sways either side, and how much it spreads, at the end.
const EVAPORATE_SWAY = 0.16;
const EVAPORATE_GROW = 0.35;

export const effectsEvaporateMethods = {
  // Whether the effect is on: the group, then its own.
  _evaporateOn(this: CursorSmithPlugin): boolean {
    return !!this.look.popEffects && deleteEffectOf(this.look) === "evaporate";
  },

  // The letters of one deletion, nearest the caret first, rising away. A
  // space takes its room and raises nothing. In the text's own colour; with
  // Pop effects' Rainbow each letter takes the sweep's next hue, shared with
  // the popping letters, the bolts and the fireworks.
  spawnEvaporate(this: CursorSmithPlugin, deleted: DeletedLetters) {
    if (!this._evaporateOn()) return;
    const old = deleted.old;
    const t0 = performance.now();
    const rainbow = !!this.styleFor("popRainbow");
    const textColor = old.textColor || this.getActiveColor() || "#888888";
    deleted.letters.forEach((l, k) => {
      if (!l.char.trim()) return;
      const color = rainbow ? hslToRgbString(this.nextRainbowHue(), 0.85, 0.6) : textColor;
      this.evaporateGlyphs.push({
        char: l.char, x: l.x, top: old.top, h: old.h || 20,
        fontSize: old.fontSize, fontFamily: old.fontFamily, fontWeight: old.fontWeight, fontStyle: old.fontStyle,
        color, start: t0, delay: k * EVAPORATE_STAGGER_MS,
        phase: Math.random() * Math.PI * 2, drift: (Math.random() - 0.5) * 0.5,
      });
    });
  },

  // Where a glyph is at `t` (0 at lift-off, 1 gone): risen, swayed, spread.
  evaporatePose(this: CursorSmithPlugin, g: EvaporateGlyph, t: number, riseLines: number) {
    const u = Math.max(0, Math.min(1, t));
    const lift = 1 - (1 - u) * (1 - u);
    return {
      dx: (Math.sin(g.phase + u * 3.2) * EVAPORATE_SWAY + g.drift) * g.h * u,
      dy: -riseLines * g.h * lift,
      scale: 1 + EVAPORATE_GROW * u,
      alpha: Math.pow(1 - u, 1.3),
    };
  },

  drawEvaporate(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.evaporateGlyphs.length) return;
    const now = performance.now();
    const ms = EVAPORATE_MS;
    const rise = EVAPORATE_RISE_LINES;
    this.evaporateGlyphs = this.evaporateGlyphs.filter((g) => {
      const t = (now - g.start - g.delay) / ms;
      if (t >= 1) return false;
      const p = this.evaporatePose(g, t, rise);
      ctx.save();
      ctx.font = this.fontString(g.fontSize, g.fontFamily, g.fontWeight, g.fontStyle);
      const m = ctx.measureText(g.char);
      const ascent = m.fontBoundingBoxAscent ?? g.fontSize * 0.8;
      const descent = m.fontBoundingBoxDescent ?? g.fontSize * 0.2;
      const baseline = g.top + ascent + (g.h - ascent - descent) / 2;
      const cx = g.x + p.dx + m.width / 2, cy = g.top + p.dy + g.h / 2;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = g.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.translate(cx, cy);
      ctx.scale(p.scale, p.scale);
      ctx.translate(-cx, -cy);
      ctx.fillText(g.char, g.x + p.dx, baseline + p.dy);
      ctx.restore();
      const ext = Math.max(m.width, g.h) * p.scale;
      this._markDirty(cx - ext, cy - ext, ext * 2, ext * 2);
      return true;
    });
  },
};
