// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Anvil sparks (1.7.9): Space after a word knocks a small spray
// of pixel sparks down and out from under that word, like a hammer hit on an
// anvil - the sparks under the words in the intro video. Built the way
// Fireworks is (effects-pops.ts): the whole burst is generated ONCE at spawn
// (origin, every spark's angle, speed, life and tint) and the draw only
// advances it along a closed-form path, so its shape never depends on the
// frame rate the governor picked. Its own toggle; Fireworks may fire on the
// same Space. Hot metal, white to red - or, with Pop effects' Rainbow, the
// sweep's next hue for each burst, white-hot to deep (anvilRainbow).
import {
  ANVIL_ANGLE, ANVIL_CELL, ANVIL_CELL_MIN, ANVIL_DRAG, ANVIL_DROP, ANVIL_FADE_ALPHA, ANVIL_FADE_AT,
  ANVIL_GRAVITY, ANVIL_LIFE, ANVIL_MIN_GAP_MS, ANVIL_PALETTE, ANVIL_RAINBOW_SL, ANVIL_SPARKS, ANVIL_SPARK_BUDGET,
  ANVIL_SPARK_MIN, ANVIL_SPEED, ANVIL_SPREAD, ANVIL_TRAIL_ALPHA, ANVIL_TRAIL_DT, ANVIL_TRAIL_UNTIL,
  ANVIL_WORD_MAX,
} from "../constants";
import { hslToRgbTuple, rgbTupleToHex } from "../util/color";
import type { AnvilBurst, AnvilSpark, CaretRecord } from "../types";
import type CursorSmithPlugin from "../plugin";

// A keystroke that may strike, as keydown or beforeinput describes it: a
// Space (a whole word ending in one, from a swipe or autocorrect), with no
// Ctrl, Alt or Meta held, not inside an input method's composition.
export interface AnvilKey {
  key?: string; data?: string | null; inputType?: string;
  ctrl?: boolean; alt?: boolean; meta?: boolean; composing?: boolean;
}
export function anvilKeyStrikes(k: AnvilKey): boolean {
  if (k.composing || k.inputType === "insertCompositionText") return false;
  if (k.ctrl || k.alt || k.meta) return false;
  if (k.inputType !== undefined) return k.inputType === "insertText" && typeof k.data === "string" && k.data.endsWith(" ");
  return k.key === " " || k.key === "Spacebar";
}

// The word a Space just finished, in `text` (a line) with the caret at `at`
// (right after the Space): [from, to) of the run of non-whitespace before
// the Space, or null - a Space after a Space, at a line's start, or with
// nothing typed before it.
export function anvilWordBefore(text: string, at: number): { from: number; to: number } | null {
  if (at < 2 || at > text.length) return null;
  if (text[at - 1] !== " " && text[at - 1] !== " ") return null;
  const to = at - 1;
  if (/\s/.test(text[to - 1])) return null;
  let from = to - 1;
  while (from > 0 && to - from < ANVIL_WORD_MAX && !/\s/.test(text[from - 1])) from--;
  return { from, to };
}

// Where a spark is `t` seconds after the strike: thrown at (vx, vy), slowed
// by exponential drag, pulled down by gravity. Closed form - the same at any
// frame rate.
export function anvilPoint(s: AnvilSpark, y0: number, g: number, t: number): { x: number; y: number } {
  const f = (1 - Math.exp(-ANVIL_DRAG * t)) / ANVIL_DRAG;
  return { x: s.x0 + s.vx * f, y: y0 + s.vy * f + 0.5 * g * t * t };
}

// The palette step (0 hottest .. 3 coolest) of a spark with `remaining` of
// its life left: it cools as it goes, a cool-tinted one a little faster.
export function anvilStep(remaining: number, tint: number): number {
  return Math.min(3, Math.floor((1 - remaining) * 4 * (0.85 + 0.15 * tint)));
}

// A burst's four shades in one hue (Rainbow), hot to cool as the hot-metal
// palette goes: near white, then bright, then deep.
export function anvilRainbow(hue: number): string[] {
  return ANVIL_RAINBOW_SL.map(([s, l]) => rgbTupleToHex(hslToRgbTuple(hue, s, l)));
}

// The pixel cell for a font size: a fifth of the em, rounded, at least 2 px.
export function anvilCell(em: number): number {
  return Math.max(ANVIL_CELL_MIN, Math.round(ANVIL_CELL * em));
}

export const effectsAnvilMethods = {
  // Whether the effect is on: the group, then its own.
  _anvilOn(this: CursorSmithPlugin): boolean {
    return !!this.look.popEffects && !!this.look.anvilSparks;
  },

  // Noted at the keystroke (keydown, or beforeinput on a phone): a Space
  // that may finish a word. Not in Vim's Normal mode, where Space moves the
  // caret rather than typing one. The next commitMove spawns (or does not:
  // the word is checked against the note there).
  _anvilNote(this: CursorSmithPlugin, k: AnvilKey) {
    if (!this._anvilOn() || !anvilKeyStrikes(k)) return;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (view && this.isObsidianVimOn() && this.detectVimMode(view) === "normal") return;
    } catch (e) {
      this._reportOnce("anvilNote", e);
    }
    this._anvilPending = performance.now();
  },

  // Sparks in flight, across every burst - what costs anything to draw.
  _liveAnvilCount(this: CursorSmithPlugin): number {
    let n = 0;
    for (const b of this.anvils) n += b.sparks.length;
    return n;
  },

  // A Space has gone in after a word at this caret: find the word in the
  // note, and strike under it. Only for a Space that went in (the note grew),
  // right after a word; per caret, like every key effect.
  spawnAnvilSparks(this: CursorSmithPlugin, caret: CaretRecord) {
    if (!this._anvilOn() || !caret) return;
    if (performance.now() - this._lastAnvilT < ANVIL_MIN_GAP_MS) return;
    const last = this.lastActive;
    if (!last || typeof caret.pos !== "number" || typeof caret.docLen !== "number" ||
        typeof last.docLen !== "number" || caret.docLen <= last.docLen) return;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (!view) return;
      const line = view.state.doc.lineAt(caret.pos);
      const w = anvilWordBefore(line.text, caret.pos - line.from);
      if (!w) return;
      const a = view.coordsAtPos(line.from + w.from, 1);
      const b = view.coordsAtPos(line.from + w.to, -1);
      if (!a || !b) return;
      // A word wrapped across two rows: the part on the last row.
      const left = Math.abs(a.top - b.top) < 1 ? a.left : (caret.rowLeft ?? b.left);
      const em = caret.fontSize || (b.bottom - b.top) / 1.25;
      const baseline = this._anvilBaseline(b.top, b.bottom - b.top, caret);
      const y0 = baseline + ANVIL_DROP * em;
      // From under a word scrolled up behind the pane's top, nothing: the
      // sparks would fly into view from nowhere.
      if (y0 < (this._clipTop ?? 0)) return;
      this._bakeAnvil((left + b.left) / 2, Math.max(1, b.left - left), y0, em);
    } catch (e) {
      this._reportOnce("spawnAnvilSparks", e);
    }
  },

  // The baseline of a run of text whose box starts at `top` and is `h`
  // tall, in the caret's font: the box is the font's ascent and descent (a
  // character's rect) or the line's height, the text centred in it.
  _anvilBaseline(this: CursorSmithPlugin, top: number, h: number, c: CaretRecord): number {
    let ascent = c.fontSize * 0.8, descent = c.fontSize * 0.2;
    try {
      const ctx = this._measureCtx || (this._measureCtx = createEl("canvas").getContext("2d"));
      if (ctx) {
        ctx.font = this.fontString(c.fontSize, c.fontFamily, c.fontWeight, c.fontStyle);
        const m = ctx.measureText("x");
        if (m.fontBoundingBoxAscent) { ascent = m.fontBoundingBoxAscent; descent = m.fontBoundingBoxDescent; }
      }
    } catch (e) {
      this._reportOnce("anvilBaseline", e);
    }
    return top + ascent + (h - ascent - descent) / 2;
  },

  // The burst itself, all of it, once: from (cx, y0) under a word `wordW`
  // wide, in a font `em` px. What the budget leaves decides how many sparks
  // it throws; a burst that cannot afford ANVIL_SPARK_MIN is skipped and the
  // gap is left unstamped, so the next word can try at once. Returns it.
  _bakeAnvil(this: CursorSmithPlugin, cx: number, wordW: number, y0: number, em: number): AnvilBurst | null {
    const q = Math.max(0.2, Math.min(3, this.look.anvilSparksQuantity ?? 1));
    const wanted = Math.max(ANVIL_SPARK_MIN, Math.round(ANVIL_SPARKS * q));
    const room = ANVIL_SPARK_BUDGET - this._liveAnvilCount();
    if (room < ANVIL_SPARK_MIN) return null;
    const now = performance.now();
    this._lastAnvilT = now;
    const n = Math.min(wanted, room);
    const g = ANVIL_GRAVITY * em;
    const cell = anvilCell(em);
    const sparks: AnvilSpark[] = [];
    let minX = cx, maxX = cx, maxY = y0, end = 0;
    for (let i = 0; i < n; i++) {
      const ang = ANVIL_ANGLE[0] + Math.random() * (ANVIL_ANGLE[1] - ANVIL_ANGLE[0]);
      const speed = em * (ANVIL_SPEED[0] + Math.random() * (ANVIL_SPEED[1] - ANVIL_SPEED[0]));
      const s: AnvilSpark = {
        x0: cx + (Math.random() * 2 - 1) * ANVIL_SPREAD * wordW,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: ANVIL_LIFE[0] + Math.random() * (ANVIL_LIFE[1] - ANVIL_LIFE[0]),
        tint: Math.random(),
      };
      sparks.push(s);
      // Both coordinates move one way only (no gravity across, and every
      // throw is downward), so a spark's whole path lies between where it
      // starts and where it ends.
      const p = anvilPoint(s, y0, g, s.life);
      minX = Math.min(minX, s.x0, p.x); maxX = Math.max(maxX, s.x0, p.x); maxY = Math.max(maxY, p.y);
      end = Math.max(end, s.life);
    }
    // One hue a burst, a step of the sweep the letters, bolts and fireworks
    // share (nextRainbowHue): a run of words reads as one sweep.
    const palette = this.styleFor("popRainbow") ? anvilRainbow(this.nextRainbowHue()) : ANVIL_PALETTE;
    const burst: AnvilBurst = { y0, g, cell, sparks, palette, start: now, end, minX, maxX: maxX + cell, minY: y0, maxY: maxY + cell };
    this.anvils.push(burst);
    return burst;
  },

  // Every burst, advanced to now: a cell per spark, snapped to the burst's
  // grid, its two trail cells behind it while it is young. One damage box a
  // frame per burst, round what this frame painted.
  drawAnvilSparks(this: CursorSmithPlugin) {
    if (!this.anvils.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    ctx.save();
    let fill = "", alpha = -1;
    const paint = (color: string, a: number, x: number, y: number, cell: number) => {
      if (color !== fill) { fill = color; ctx.fillStyle = color; }
      if (a !== alpha) { alpha = a; ctx.globalAlpha = a; }
      ctx.fillRect(x, y, cell, cell);
    };
    this.anvils = this.anvils.filter((b) => {
      const t = (now - b.start) / 1000;
      if (t >= b.end) return false;
      const cell = b.cell, pal = b.palette;
      const snap = (v: number) => Math.floor(v / cell) * cell;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of b.sparks) {
        if (t >= s.life) continue;
        const remaining = 1 - t / s.life;
        const step = anvilStep(remaining, s.tint);
        const a = (remaining > ANVIL_FADE_AT ? 1 : ANVIL_FADE_ALPHA) * opacity;
        const p = anvilPoint(s, b.y0, b.g, t);
        const hx = snap(p.x), hy = snap(p.y);
        paint(pal[step], a, hx, hy, cell);
        if (hx < x0) x0 = hx; if (hy < y0) y0 = hy; if (hx > x1) x1 = hx; if (hy > y1) y1 = hy;
        // The trail: where it was a moment and two moments ago, a step
        // cooler and fainter each, never on a cell this spark already lit.
        if (remaining < ANVIL_TRAIL_UNTIL) continue;
        let px = hx, py = hy;
        for (let k = 0; k < 2; k++) {
          const tt = t - ANVIL_TRAIL_DT * (k + 1);
          if (tt < 0) break;
          const q = anvilPoint(s, b.y0, b.g, tt);
          const qx = snap(q.x), qy = snap(q.y);
          if ((qx === hx && qy === hy) || (qx === px && qy === py)) continue;
          paint(pal[Math.min(3, step + k + 1)], a * ANVIL_TRAIL_ALPHA[k], qx, qy, cell);
          px = qx; py = qy;
          if (qx < x0) x0 = qx; if (qy < y0) y0 = qy; if (qx > x1) x1 = qx; if (qy > y1) y1 = qy;
        }
      }
      if (x1 >= x0) this._markDirty(x0 - 1, y0 - 1, x1 - x0 + cell + 2, y1 - y0 + cell + 2);
      return true;
    });
    ctx.restore();
  },
};
export type EffectsAnvilMethods = typeof effectsAnvilMethods;
