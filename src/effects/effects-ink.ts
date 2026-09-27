// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Typewriter's Fresh ink (on trial, 2026-09-27): the characters just typed stay wet in
// the cursor's colour and dry into the text over a second or two. Each run
// of typing is one mark - where it starts in the document, its text, and
// when each character went in - and the draw finds every character's own
// box through CodeMirror on every frame, so the ink stays on its letters
// through a wrap, a scroll or an edit before it. A mark whose text is no
// longer where it was is cut back to what is left of it (Backspace), looked
// for nearby (an edit before it), or dropped. The letters are drawn over
// the real ones the way the Box draws its letter: the same font, centred in
// the line box, on whole device pixels. With Gradient on, the ink is the
// ramp: each letter takes the colour at its place in the text, the ramp
// looping every INK_RAMP_SPAN letters, so a word carries the whole gradient
// and a letter keeps its colour while it dries. It was the ramp's first stop
// alone, flat - and a first stop near the text's colour hid the ink.
import { easeInOutSine } from "../util/motion";
import type { EditorView } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import type { CaretRecord, InkMark } from "../types";
import type CursorSmithPlugin from "../plugin";

// An insertion longer than this is a paste or a completion, not typing.
export const INK_MAX_RUN = 12;
// The most wet characters at once; the oldest go first.
export const INK_MAX_CHARS = 80;
// How far a mark is looked for after an edit before it, in characters.
const INK_SEARCH = 64;
// The share of the drying time the ink stays fully wet before it fades.
const INK_HOLD = 0.3;
// With Gradient on, the ramp loops once every this many letters.
export const INK_RAMP_SPAN = 10;

export const effectsInkMethods = {
  // From resolveHoldChar, where a keystroke's insertion is known: `last` is
  // the caret it was typed at, [from, to) what it put in.
  spawnFreshInk(this: CursorSmithPlugin, view: EditorView, last: CaretRecord, from: number, to: number) {
    if (!this.look.typewriter || !this.look.typewriterFreshInk || to <= from || to - from > INK_MAX_RUN) return;
    const text = view.state.doc.sliceString(from, to);
    if (!text || text.includes("\n")) return;
    if (this._inkView !== view) { this.inkMarks = []; this._inkView = view; }
    const now = performance.now();
    const color = this.getActiveColor() || last.textColor || "#888888";
    const prev = this.inkMarks[this.inkMarks.length - 1];
    // The same insertion seen twice (a pending move re-read): nothing new.
    if (prev && from >= prev.from && to <= prev.from + prev.text.length) return;
    const sameFont = prev && prev.fontSize === last.fontSize && prev.fontFamily === last.fontFamily &&
      prev.fontWeight === last.fontWeight && prev.fontStyle === last.fontStyle;
    if (prev && sameFont && prev.from + prev.text.length === from) {
      // Typing on: the run grows.
      prev.text += text;
      for (let i = 0; i < text.length; i++) prev.times.push(now);
      prev.color = color;
    } else {
      this.inkMarks.push({
        from, text, times: new Array<number>(text.length).fill(now), color,
        fontSize: last.fontSize, fontFamily: last.fontFamily, fontWeight: last.fontWeight, fontStyle: last.fontStyle,
      });
    }
    let total = 0;
    for (const m of this.inkMarks) total += m.text.length;
    while (total > INK_MAX_CHARS && this.inkMarks.length) {
      const m = this.inkMarks[0];
      const cut = Math.min(m.text.length, total - INK_MAX_CHARS);
      this._inkTrimFront(m, cut);
      total -= cut;
      if (!m.text.length) this.inkMarks.shift();
    }
  },

  // Drop `n` code units from the front of a mark, never half a surrogate
  // pair (the two halves of an emoji dry together anyway).
  _inkTrimFront(this: CursorSmithPlugin, m: InkMark, n: number) {
    if (n > 0 && n < m.text.length) {
      const c = m.text.charCodeAt(n);
      if (c >= 0xdc00 && c <= 0xdfff) n++;
    }
    m.from += n;
    m.text = m.text.slice(n);
    m.times = m.times.slice(n);
  },

  // Where a mark's text is now. True with m.from (and m.text, cut back)
  // brought up to date; false when it is gone.
  _inkLocate(this: CursorSmithPlugin, doc: Text, m: InkMark, head: number): boolean {
    const len = m.text.length;
    if (m.from + len <= doc.length && doc.sliceString(m.from, m.from + len) === m.text) return true;
    // Backspace: the run's end is gone and the caret sits where it now ends.
    const here = doc.sliceString(m.from, Math.min(doc.length, m.from + len));
    let k = 0;
    while (k < here.length && here.charCodeAt(k) === m.text.charCodeAt(k)) k++;
    if (k > 0 && head === m.from + k) {
      m.text = m.text.slice(0, k);
      m.times = m.times.slice(0, k);
      return true;
    }
    // An edit before it moved it: the nearest copy of its text, if it is long
    // enough to be itself rather than any letter nearby.
    if (len < 2) return false;
    const lo = Math.max(0, m.from - INK_SEARCH);
    const win = doc.sliceString(lo, Math.min(doc.length, m.from + len + INK_SEARCH));
    let best = -1;
    for (let i = win.indexOf(m.text); i >= 0; i = win.indexOf(m.text, i + 1)) {
      if (best < 0 || Math.abs(lo + i - m.from) < Math.abs(lo + best - m.from)) best = i;
    }
    if (best < 0) return false;
    m.from = lo + best;
    return true;
  },

  // How wet a character is at `age` ms: fully for the first part of the
  // drying time, then easing to dry.
  inkWetness(this: CursorSmithPlugin, age: number, ms: number): number {
    const u = age / Math.max(1, ms);
    if (u >= 1) return 0;
    if (u <= INK_HOLD) return 1;
    return 1 - easeInOutSine((u - INK_HOLD) / (1 - INK_HOLD));
  },

  drawFreshInk(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.inkMarks.length) return;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (!this.look.typewriter || !this.look.typewriterFreshInk || !view || view !== this._inkView) { this.inkMarks = []; return; }
    const doc = view.state.doc;
    const head = view.state.selection.main.head;
    const now = performance.now();
    const ms = Math.max(100, Math.min(10000, Number(this.look.typewriterFreshInkMs) || 1500));
    const strength = Math.max(0, Math.min(1, Number(this.look.typewriterFreshInkStrength ?? 0.8)));
    const ramp = !!this.look.gradientEnabled;
    const dpr = this._canvasDpr || 1;
    const region = this._canvasRect;
    const ox = region ? region.x : 0, oy = region ? region.y : 0;
    const snapX = (v: number) => Math.round((v - ox) * dpr) / dpr + ox;
    const snapY = (v: number) => Math.round((v - oy) * dpr) / dpr + oy;

    this.inkMarks = this.inkMarks.filter((m) => {
      if (!this._inkLocate(doc, m, head)) return false;
      // The dry front of the run goes: only wet letters are kept.
      let dry = 0;
      while (dry < m.times.length && now - m.times[dry] >= ms) dry++;
      if (dry) this._inkTrimFront(m, dry);
      if (!m.text.length) return false;
      ctx.save();
      ctx.font = this.fontString(m.fontSize, m.fontFamily, m.fontWeight, m.fontStyle);
      const metrics = ctx.measureText("M");
      const ascent = metrics.fontBoundingBoxAscent ?? m.fontSize * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? m.fontSize * 0.2;
      ctx.fillStyle = m.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      let i = 0;
      for (const ch of m.text) {
        const pos = m.from + i;
        const a = strength * this.inkWetness(now - m.times[i], ms);
        i += ch.length;
        if (a <= 0 || !ch.trim()) continue;
        const c = view.coordsAtPos(pos, 1);
        if (!c) continue;
        const h = c.bottom - c.top;
        const baseline = c.top + ascent + (h - ascent - descent) / 2;
        if (ramp) {
          const [r, g, b] = this.sampleRamp(pos / INK_RAMP_SPAN, true);
          ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        }
        ctx.globalAlpha = a;
        ctx.fillText(ch, snapX(c.left), snapY(baseline));
        const w = ctx.measureText(ch).width;
        this._markDirty(c.left - 2, c.top - 2, w + 4, h + 4);
      }
      ctx.restore();
      return true;
    });
  },
};
