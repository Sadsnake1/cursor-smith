// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Smoke on delete (on trial, 2026-09-27): what a deletion takes drifts up
// from where it stood and fades, swaying a little and spreading as it goes -
// the calm counterpart of Pop effects' burst. By the time the deletion is
// seen the text is gone from the note, so the note as it was at the last
// caret commit is kept (_smokeDoc) and the deleted letters are read back from
// it - only when the change is exactly that deletion, ending at the caret it
// was made from. Anything else (a paste over a selection, an undo, a change
// elsewhere) makes no smoke rather than the wrong letters.
import type { CaretRecord, SmokeGlyph } from "../types";
import type CursorSmithPlugin from "../plugin";

// A deletion longer than this is a selection wiped, not writing undone: the
// smoke would be a wall of text.
export const SMOKE_MAX_CHARS = 40;
// Each letter lifts off this long after the one to its right.
const SMOKE_STAGGER_MS = 16;
// How far it sways either side, and how much it spreads, at the end.
const SMOKE_SWAY = 0.16;
const SMOKE_GROW = 0.35;

export const effectsSmokeMethods = {
  // The note as it is now, for the next deletion to read from. Kept only
  // while the effect is on.
  _smokeRemember(this: CursorSmithPlugin) {
    let doc = null;
    if (this.look.popEffects && this.look.backspaceSmoke) {
      try { doc = this.app.workspace.activeEditor?.editor?.cm?.state.doc ?? null; } catch { doc = null; /* an editor mid-teardown */ }
    }
    this._smokeDoc = doc;
  },

  // `old` is the caret the deletion was made from, `now` where it landed.
  spawnSmoke(this: CursorSmithPlugin, old: CaretRecord, now: CaretRecord) {
    if (!this.look.popEffects || !this.look.backspaceSmoke) return;
    const prev = this._smokeDoc;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (!prev || !view) return;
    if (typeof old.pos !== "number" || typeof now.pos !== "number") return;
    const n = old.pos - now.pos;
    if (n <= 0 || n > SMOKE_MAX_CHARS) return;
    const doc = view.state.doc;
    // The kept note must be the one `old` was measured in, and the change
    // exactly [now.pos, old.pos) taken out of it.
    if (typeof old.docLen === "number" && old.docLen !== prev.length) return;
    if (prev.length - doc.length !== n) return;
    if (prev.sliceString(old.pos, old.pos + 24) !== doc.sliceString(now.pos, now.pos + 24)) return;
    if (prev.sliceString(Math.max(0, now.pos - 24), now.pos) !== doc.sliceString(Math.max(0, now.pos - 24), now.pos)) return;
    let text = prev.sliceString(now.pos, old.pos);
    // Only the row the caret stood on: a line joined by Backspace smokes
    // nothing of the line break.
    const nl = text.lastIndexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);
    if (!text.trim()) return;
    const chars = [...text];
    const t0 = performance.now();
    const color = old.textColor || this.getActiveColor() || "#888888";
    const rowLeft = typeof old.rowLeft === "number" ? old.rowLeft : -Infinity;
    // Laid out leftwards from where the caret stood, each letter its own
    // advance in the caret's font.
    let x = old.x;
    for (let k = 0; k < chars.length; k++) {
      const ch = chars[chars.length - 1 - k];
      const w = (this.measureCharWidth(ch, old.fontFamily, old.fontSize, old.fontWeight, old.fontStyle) ?? old.actualCharWidth ?? 8) + (old.letterSpacing || 0);
      x -= w;
      if (x < rowLeft - 1) break;
      if (!ch.trim()) continue;
      this.smokeGlyphs.push({
        char: ch, x, top: old.top, h: old.h || 20,
        fontSize: old.fontSize, fontFamily: old.fontFamily, fontWeight: old.fontWeight, fontStyle: old.fontStyle,
        color, start: t0, delay: k * SMOKE_STAGGER_MS,
        phase: Math.random() * Math.PI * 2, drift: (Math.random() - 0.5) * 0.5,
      });
    }
  },

  // Where a glyph is at `t` (0 at lift-off, 1 gone): risen, swayed, spread.
  smokePose(this: CursorSmithPlugin, g: SmokeGlyph, t: number, riseLines: number) {
    const u = Math.max(0, Math.min(1, t));
    const lift = 1 - (1 - u) * (1 - u);
    return {
      dx: (Math.sin(g.phase + u * 3.2) * SMOKE_SWAY + g.drift) * g.h * u,
      dy: -riseLines * g.h * lift,
      scale: 1 + SMOKE_GROW * u,
      alpha: Math.pow(1 - u, 1.3),
    };
  },

  drawSmoke(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.smokeGlyphs.length) return;
    const now = performance.now();
    const ms = Math.max(100, Math.min(10000, Number(this.look.backspaceSmokeMs) || 1100));
    const rise = Math.max(0, Math.min(5, Number(this.look.backspaceSmokeRise ?? 1.2)));
    this.smokeGlyphs = this.smokeGlyphs.filter((g) => {
      const t = (now - g.start - g.delay) / ms;
      if (t >= 1) return false;
      const p = this.smokePose(g, t, rise);
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
