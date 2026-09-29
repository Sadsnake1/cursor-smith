// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Typewriter's Correction tape: a strip of white tape rolled along the line
// over what Backspace (or Delete) takes, the way a correction roller lays
// it. The deleted letters stay where they stood until the tape runs over
// them; the strip stays a moment - what is typed next lands on it - and
// fades. A run of deletions is one strip, lengthened by each.
//
// 1.7.2 lifted each letter off with a square of tape of its own, up and
// away, Selectric-style; "show it in line, more like a tape" (2026-09-29).
//
// The strip is pinned to the note, not the screen: its left end is a place
// in the document (anchor), carried through every edit by _recordEdit
// (engine/measure.ts), sticking before text typed there - so the letters
// typed next go onto the tape, a deletion in the middle of a line leaves
// the rest of the line on it, and it scrolls with the text. Where each
// deleted letter stood comes from effects-delete.ts, shared with the Pop
// effects' deletions.
import { contrastRatio, parseColorTuple } from "../util/color";
import type { DeletedLetters, TapeStrip } from "../types";
import type CursorSmithPlugin from "../plugin";

// How fast the tape is laid: never slower than this (px per ms), and
// catching up on a long deletion with this time constant.
const TAPE_ROLL_PX_MS = 0.3;
const TAPE_ROLL_TAU_MS = 70;
// How long a strip stays after its last deletion, then how long it fades.
export const TAPE_HOLD_MS = 1500;
export const TAPE_FADE_MS = 450;
// The strip's height against the letters' box (ascent + descent).
const TAPE_BAND = 0.92;
// At most this many characters of the note drawn onto one strip.
const TAPE_MAX_TEXT = 160;
// The tape's white, on a light page and on a dark one; the ink on it when
// the page's own text color would not show on it.
const TAPE_WHITE = "#fdfdfb", TAPE_WHITE_DARK = "#e9e5da", TAPE_INK = "#1f1f22";

export const effectsTapeMethods = {
  // Whether the effect is on: Typewriter, then its own.
  _tapeOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.typewriter && this.look.typewriterTape);
  },

  // One deletion: a new strip over its letters, or the strip it continues
  // made longer - a Backspace after a Backspace at the strip's left end, a
  // Delete after a Delete there. Spaces are taped over too: the strip is
  // one piece.
  spawnTape(this: CursorSmithPlugin, deleted: DeletedLetters) {
    if (!this._tapeOn()) return;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (!view || typeof deleted.from !== "number" || !deleted.letters.length) return;
    const old = deleted.old;
    const now = performance.now();
    let left = Infinity, right = -Infinity;
    for (const l of deleted.letters) { left = Math.min(left, l.x); right = Math.max(right, l.x + l.w); }
    const width = right - left;
    if (!(width > 0.5)) return;
    const ghosts = deleted.letters.map((l) => ({ char: l.char, dx: l.x - left, w: l.w }));
    // The strip this deletion continues: its left end is where the caret
    // stood (the anchor, carried through this deletion already).
    const join = this.typeTapes.find((s) => s.view === view && s.forward === deleted.forward &&
      s.anchor === deleted.from && now - s.last < TAPE_HOLD_MS && Math.abs(s.x0 - old.x) < 2);
    if (join) {
      if (deleted.forward) {
        // Delete: the next letter was right of the last, before the text
        // closed up.
        for (const g of ghosts) join.ghosts.push({ char: g.char, dx: join.w + g.dx, w: g.w });
      } else {
        // Backspace: the strip grows to the left; its right end stays.
        for (const g of join.ghosts) g.dx += width;
        for (const g of ghosts) join.ghosts.push(g);
        join.x0 = left;
      }
      join.w += width;
      join.last = now;
      return;
    }
    this.typeTapes.push({
      view, anchor: deleted.from, forward: deleted.forward,
      w: width, cover: 0, t: now, last: now, x0: left, ghosts,
      fontSize: old.fontSize, fontFamily: old.fontFamily, fontWeight: old.fontWeight, fontStyle: old.fontStyle,
      textColor: old.textColor || this.getActiveColor() || "#888888",
      frame: null,
    });
  },

  // The strip's opacity at `age` ms after its last deletion: whole while it
  // holds, then fading to nothing.
  tapeAlpha(this: CursorSmithPlugin, age: number): number {
    if (age <= TAPE_HOLD_MS) return 1;
    return Math.max(0, 1 - (age - TAPE_HOLD_MS) / TAPE_FADE_MS);
  },

  // The tape itself, from xa to xb: white (on a dark page a paper white, a
  // little softer, so it does not glare), a touch darker at its long edges
  // where it curves onto the page, and a thin shadow under it - its
  // thickness, so it reads as tape and not as more page.
  _paintTapeBand(this: CursorSmithPlugin, xa: number, xb: number, top: number, h: number, alpha: number, shadow: boolean) {
    const ctx = this.ctx;
    if (!ctx || !(xb - xa > 0.2) || !(alpha > 0)) return;
    const dark = this.isDarkTheme();
    const base = dark ? TAPE_WHITE_DARK : TAPE_WHITE;
    ctx.save();
    // Opaque: where a stamp's cover is patched with it, a see-through tape
    // left a seam between the letters.
    ctx.globalAlpha = alpha;
    if (shadow) {
      ctx.shadowColor = dark ? "rgba(0, 0, 0, 0.55)" : "rgba(0, 0, 0, 0.22)";
      ctx.shadowBlur = 2.5;
      ctx.shadowOffsetY = 1;
    }
    if (typeof ctx.createLinearGradient === "function") {
      const g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, dark ? "#dcd8cc" : "#f1f1ed");
      g.addColorStop(0.2, base);
      g.addColorStop(0.8, base);
      g.addColorStop(1, dark ? "#d2cdc0" : "#e9e8e2");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = base;
    }
    ctx.fillRect(xa, top, xb - xa, h);
    ctx.restore();
  },

  // The color of letters on the tape: the page's text color where it reads
  // on white, else dark ink - on a dark page the text is light, and was
  // white on white.
  tapeInk(this: CursorSmithPlugin, textColor: string): string {
    const tape = parseColorTuple(this.isDarkTheme() ? TAPE_WHITE_DARK : TAPE_WHITE);
    const text = parseColorTuple(textColor);
    return tape && text && contrastRatio(tape, text) >= 3 ? textColor : TAPE_INK;
  },

  drawTape(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.typeTapes.length) return;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    const now = performance.now();
    // (Reduced motion turns Typewriter off, tape and all.)
    this.typeTapes = this.typeTapes.filter((s) => {
      s.frame = null;
      if (!view || s.view !== view || !this._tapeOn()) return false;
      const alpha = this.tapeAlpha(now - s.last);
      if (alpha <= 0) return false;
      // Laying it: from where the caret stood, the way the caret went.
      const dt = Math.max(0, now - s.t);
      s.t = now;
      if (s.cover < s.w) s.cover = Math.min(s.w, s.cover + Math.max(TAPE_ROLL_PX_MS * dt, (s.w - s.cover) * (1 - Math.exp(-dt / TAPE_ROLL_TAU_MS))));
      const doc = view.state.doc;
      const at = Math.max(0, Math.min(s.anchor, doc.length));
      let c = null;
      try { c = view.coordsAtPos(at, 1); } catch { c = null; /* a position outside the view */ }
      // Scrolled out of sight: kept, not drawn.
      if (!c) return true;
      s.x0 = c.left;
      const rowTop = c.top, rowH = c.bottom - c.top;
      ctx.save();
      ctx.font = this.fontString(s.fontSize, s.fontFamily, s.fontWeight, s.fontStyle);
      const m = ctx.measureText("Hg");
      const ascent = m.fontBoundingBoxAscent ?? s.fontSize * 0.8;
      const descent = m.fontBoundingBoxDescent ?? s.fontSize * 0.2;
      const baseline = rowTop + ascent + (rowH - ascent - descent) / 2;
      const bandH = (ascent + descent) * TAPE_BAND;
      const bandTop = baseline - ascent + (ascent + descent - bandH) / 2;
      const x0 = c.left, x1 = x0 + s.w;
      const c0 = s.forward ? x0 : x1 - s.cover, c1 = s.forward ? x0 + s.cover : x1;
      s.frame = { rowTop, c0, c1, top: bandTop, h: bandH, alpha };
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      // The deleted letters where they stood, until the tape is over them.
      if (s.cover < s.w) {
        ctx.save();
        ctx.beginPath();
        if (s.forward) ctx.rect(c1, rowTop - 2, x1 - c1 + 4, rowH + 4);
        else ctx.rect(x0 - 4, rowTop - 2, c0 - x0 + 4, rowH + 4);
        ctx.clip();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.textColor;
        for (const g of s.ghosts) if (g.char.trim()) ctx.fillText(g.char, x0 + g.dx, baseline);
        ctx.restore();
      }
      if (c1 - c0 > 0.2) {
        this._paintTapeBand(c0, c1, bandTop, bandH, alpha, true);
        // What is on the tape now: the note's own text over it - the rest
        // of the line after a deletion in its middle, the letters typed
        // onto it - drawn on it, as the page's is under it.
        ctx.save();
        ctx.beginPath();
        ctx.rect(c0, bandTop - 1, c1 - c0, bandH + 2);
        ctx.clip();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.tapeInk(s.textColor);
        const lineEnd = doc.lineAt(at).to;
        let pos = at;
        for (let k = 0; k < TAPE_MAX_TEXT && pos < lineEnd; k++) {
          const cc = view.coordsAtPos(pos, 1);
          if (!cc || Math.abs(cc.top - rowTop) > 2 || cc.left >= c1) break;
          const ch = String.fromCodePoint(doc.sliceString(pos, pos + 2).codePointAt(0) ?? 32);
          if (ch.trim()) ctx.fillText(ch, cc.left, baseline);
          pos += ch.length;
        }
        ctx.restore();
      }
      // The roller's edge, pressing the tape down as it goes.
      if (s.cover < s.w - 0.5) {
        const fx = s.forward ? c1 : c0;
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillStyle = this.isDarkTheme() ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.28)";
        ctx.fillRect(fx - 0.75, bandTop - 1.5, 1.5, bandH + 3);
      }
      ctx.restore();
      this._markDirty(x0 - 6, rowTop - 4, s.w + 12, rowH + 8);
      return true;
    });
  },

  // The tape back over a cover the Ink stamp laid on the page (the page's
  // color, hiding the real letter while the stamp strikes): a letter typed
  // onto the tape is stamped onto the tape.
  // True when it put any back.
  // The cover is x, top, w wide and h tall; the tape's strip is the one it
  // overlaps (the stamp's top is the cursor's, not the row's).
  _tapeUnder(this: CursorSmithPlugin, x: number, top: number, w: number, h: number): boolean {
    let any = false;
    for (const s of this.typeTapes) {
      const f = s.frame;
      if (!f || top >= f.top + f.h || top + h <= f.top) continue;
      // A pixel past the cover each side: its edges are anti-aliased, and
      // matched exactly they left a hairline seam between the letters.
      const xa = Math.max(x - 1, f.c0), xb = Math.min(x + w + 1, f.c1);
      if (xb > xa) { this._paintTapeBand(xa, xb, f.top, f.h, f.alpha, false); any = true; }
    }
    return any;
  },
};

export type EffectsTapeMethods = typeof effectsTapeMethods;
