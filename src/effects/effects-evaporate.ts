// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Popping letters' Evaporate on delete (on trial, 2026-09-27): the letters a
// deletion takes rise from where they stood and fade, swaying a little and
// spreading as they go - with Backspace (the letters before the caret, right
// to left) or Delete (the letters after it, left to right). By the time the
// deletion is seen the text is gone from the note, so the note as it was is
// kept (_evaporateDoc) and the letters are read back from it - only when the
// change is exactly that deletion at the caret. Anything else (a paste over
// a selection, an undo, a change elsewhere) evaporates nothing rather than
// the wrong letters. Named Smoke on delete until the user renamed it.
import type { CaretRecord, EvaporateGlyph } from "../types";
import type CursorSmithPlugin from "../plugin";

// A deletion longer than this is a selection wiped, not writing undone: it
// would be a wall of text.
export const EVAPORATE_MAX_CHARS = 40;
// Each letter lifts off this long after the one nearer the caret.
const EVAPORATE_STAGGER_MS = 16;
// How far it sways either side, and how much it spreads, at the end.
const EVAPORATE_SWAY = 0.16;
const EVAPORATE_GROW = 0.35;

export const effectsEvaporateMethods = {
  // Whether the effect is on: the group, Popping letters, then its own.
  _evaporateOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.popEffects && this.look.popLetters && this.look.popLettersEvaporate);
  },

  // The note as it is now, for the next deletion to read from. Kept only
  // while the effect is on.
  _evaporateRemember(this: CursorSmithPlugin) {
    let doc = null;
    if (this._evaporateOn()) {
      try { doc = this.app.workspace.activeEditor?.editor?.cm?.state.doc ?? null; } catch { doc = null; /* an editor mid-teardown */ }
    }
    this._evaporateDoc = doc;
  },

  // A frame the caret sat still (updateActivePoint, no move to commit): the
  // Delete key takes the text after the caret and leaves it where it is, so
  // this is where that deletion is seen. The note is kept current either way.
  _evaporateStill(this: CursorSmithPlugin, old: CaretRecord, now: CaretRecord) {
    if (!this._evaporateOn()) { this._evaporateDoc = null; return; }
    const doc = this.app.workspace.activeEditor?.editor?.cm?.state.doc ?? null;
    if (!doc || doc === this._evaporateDoc) return;
    if (this._deletePending && performance.now() - this._deletePending < 250) this.spawnEvaporate(old, now);
    this._evaporateDoc = doc;
  },

  // `old` is the caret the deletion was made from, `now` where it is after:
  // before it (Backspace) or at the same place (Delete).
  spawnEvaporate(this: CursorSmithPlugin, old: CaretRecord, now: CaretRecord) {
    if (!this._evaporateOn()) return;
    const prev = this._evaporateDoc;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (!prev || !view) return;
    if (typeof old.pos !== "number" || typeof now.pos !== "number") return;
    const doc = view.state.doc;
    // The kept note must be the one `old` was measured in.
    if (typeof old.docLen === "number" && old.docLen !== prev.length) return;
    const n = prev.length - doc.length;
    if (n <= 0 || n > EVAPORATE_MAX_CHARS) return;
    // Backspace takes [now.pos, old.pos); Delete takes n after the caret.
    const forward = now.pos === old.pos;
    if (!forward && old.pos - now.pos !== n) return;
    const from = forward ? old.pos : now.pos, to = from + n;
    // ...and the note around it must be untouched: exactly that deletion.
    if (prev.sliceString(to, to + 24) !== doc.sliceString(from, from + 24)) return;
    if (prev.sliceString(Math.max(0, from - 24), from) !== doc.sliceString(Math.max(0, from - 24), from)) return;
    let text = prev.sliceString(from, to);
    // Only the row the caret stands on: a line joined by the deletion
    // evaporates nothing of the line break or the line past it.
    if (forward) { const nl = text.indexOf("\n"); if (nl >= 0) text = text.slice(0, nl); }
    else { const nl = text.lastIndexOf("\n"); if (nl >= 0) text = text.slice(nl + 1); }
    if (!text.trim()) return;
    const chars = [...text];
    const t0 = performance.now();
    const color = old.textColor || this.getActiveColor() || "#888888";
    const width = (ch: string) => (this.measureCharWidth(ch, old.fontFamily, old.fontSize, old.fontWeight, old.fontStyle) ?? old.actualCharWidth ?? 8) + (old.letterSpacing || 0);
    const glyph = (ch: string, x: number, k: number): EvaporateGlyph => ({
      char: ch, x, top: old.top, h: old.h || 20,
      fontSize: old.fontSize, fontFamily: old.fontFamily, fontWeight: old.fontWeight, fontStyle: old.fontStyle,
      color, start: t0, delay: k * EVAPORATE_STAGGER_MS,
      phase: Math.random() * Math.PI * 2, drift: (Math.random() - 0.5) * 0.5,
    });
    if (forward) {
      // Laid out rightwards from the caret, the nearest letter first.
      const rowRight = typeof old.rowRight === "number" ? old.rowRight : Infinity;
      let x = old.x;
      for (let k = 0; k < chars.length; k++) {
        const w = width(chars[k]);
        if (x + w > rowRight + 1) break;
        if (chars[k].trim()) this.evaporateGlyphs.push(glyph(chars[k], x, k));
        x += w;
      }
    } else {
      // Laid out leftwards from where the caret stood, the nearest first.
      const rowLeft = typeof old.rowLeft === "number" ? old.rowLeft : -Infinity;
      let x = old.x;
      for (let k = 0; k < chars.length; k++) {
        const ch = chars[chars.length - 1 - k];
        x -= width(ch);
        if (x < rowLeft - 1) break;
        if (ch.trim()) this.evaporateGlyphs.push(glyph(ch, x, k));
      }
    }
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
    const ms = Math.max(100, Math.min(10000, Number(this.look.popLettersEvaporateMs) || 1100));
    const rise = Math.max(0, Math.min(5, Number(this.look.popLettersEvaporateRise ?? 1.2)));
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
