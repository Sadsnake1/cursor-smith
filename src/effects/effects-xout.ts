// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Typewriter's X-out: what Backspace (or Delete) takes stays on the page a
// moment, each letter overtyped with an x the way a typist struck out a
// mistake, then the x'd letters fade and the line closes up over them.
//
// The note has closed up already - the rest of the line sits where the
// deleted letters were - so while a run is shown the line is drawn held
// apart: the rest of the row covered with the page's color where it really
// is and drawn again after the x'd letters, sliding back as they fade. On a
// page with no solid color behind the text (a background image) there is
// nothing to cover it with, and the x'd letters fade where they stood.
//
// 1.7.2 lifted each letter off with a bit of correction tape, then a strip
// of tape was rolled along the line; in the middle of a line it sat over the
// text that closed up ("deleting midline is what looks bad"), and of six
// ways shown the user picked the x-out (2026-09-29).
//
// A run is pinned to the note: its left end is a place in the document
// (anchor), carried through every edit by _recordEdit (engine/measure.ts);
// a run of deletions there is one run, lengthened by each; typing while it
// shows closes it at once. Where each deleted letter stood comes from
// effects-delete.ts, shared with the Pop effects' deletions.
import type { DeletedLetters } from "../types";
import type CursorSmithPlugin from "../plugin";

// Each letter of one deletion is struck this long after the one before;
// its x lands over this long (a little large, settling); the run holds this
// long after its last x, then closes over XOUT_CLOSE_MS.
export const XOUT_STAGGER_MS = 40;
const XOUT_POP_MS = 70;
export const XOUT_HOLD_MS = 260;
export const XOUT_CLOSE_MS = 240;
// How far a struck letter dims under its x.
const XOUT_DIM = 0.5;
// At most this many characters of the rest of a row held apart.
const XOUT_MAX_TEXT = 200;

export const effectsXoutMethods = {
  // Whether the effect is on: Typewriter, then its own (the key is the
  // correction's since 1.7.2, when it was a tape).
  _xoutOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.typewriter && this.look.typewriterTape);
  },

  // One deletion: a new run of its letters, or the run it continues made
  // longer - a Backspace after a Backspace at the run's left end, a Delete
  // after a Delete there - before it starts to close. Nearest the caret is
  // struck first.
  spawnXout(this: CursorSmithPlugin, deleted: DeletedLetters) {
    if (!this._xoutOn()) return;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (!view || typeof deleted.from !== "number" || !deleted.letters.length) return;
    const old = deleted.old;
    const now = performance.now();
    let left = Infinity, right = -Infinity;
    for (const l of deleted.letters) { left = Math.min(left, l.x); right = Math.max(right, l.x + l.w); }
    const width = right - left;
    if (!(width > 0.5)) return;
    const struck = deleted.letters.map((l, i) => ({ char: l.char, dx: l.x - left, w: l.w, t: now + i * XOUT_STAGGER_MS }));
    const closeT = now + (deleted.letters.length - 1) * XOUT_STAGGER_MS + XOUT_HOLD_MS;
    const join = this.xouts.find((r) => r.view === view && r.forward === deleted.forward &&
      r.anchor === deleted.from && now < r.closeT && Math.abs(r.x0 - old.x) < 2);
    if (join) {
      if (deleted.forward) {
        // Delete: the next letter stood right of the last, before the text
        // closed up.
        for (const g of struck) join.ghosts.push(Object.assign(g, { dx: join.w + g.dx }));
      } else {
        // Backspace: the run grows to the left.
        for (const g of join.ghosts) g.dx += width;
        for (const g of struck) join.ghosts.push(g);
        join.x0 = left;
      }
      join.w += width;
      join.closeT = closeT;
      return;
    }
    // A run already closing gives way: two would each hold the line apart.
    this.xouts = this.xouts.filter((r) => r.view !== view || now < r.closeT);
    let bg: string | null = null;
    try { bg = this._cellBackground(view, deleted.from); } catch { bg = null; /* a position outside the view */ }
    this.xouts.push({
      view, anchor: deleted.from, forward: deleted.forward, w: width, x0: left, ghosts: struck, closeT, bg,
      fontSize: old.fontSize, fontFamily: old.fontFamily, fontWeight: old.fontWeight, fontStyle: old.fontStyle,
      textColor: old.textColor || this.getActiveColor() || "#888888",
    });
  },

  // How far a run has closed at `now`: 0 while it holds, easing to 1.
  xoutClosed(this: CursorSmithPlugin, closeT: number, now: number): number {
    const k = Math.max(0, Math.min(1, (now - closeT) / XOUT_CLOSE_MS));
    return k * k * (3 - 2 * k);
  },

  drawXout(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.xouts.length) return;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    const now = performance.now();
    // (Reduced motion turns Typewriter off, and this with it.)
    this.xouts = this.xouts.filter((r) => {
      if (!view || r.view !== view || !this._xoutOn()) return false;
      if (now - r.closeT >= XOUT_CLOSE_MS) return false;
      const closed = this.xoutClosed(r.closeT, now);
      const doc = view.state.doc;
      const at = Math.max(0, Math.min(r.anchor, doc.length));
      let c = null;
      try { c = view.coordsAtPos(at, 1); } catch { c = null; /* a position outside the view */ }
      // Scrolled out of sight: kept, not drawn.
      if (!c) return true;
      r.x0 = c.left;
      const rowTop = c.top, rowH = c.bottom - c.top;
      const x0 = c.left;
      ctx.save();
      ctx.font = this.fontString(r.fontSize, r.fontFamily, r.fontWeight, r.fontStyle);
      const m = ctx.measureText("Hg");
      const ascent = m.fontBoundingBoxAscent ?? r.fontSize * 0.8;
      const descent = m.fontBoundingBoxDescent ?? r.fontSize * 0.2;
      const baseline = rowTop + ascent + (rowH - ascent - descent) / 2;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      // On whole device pixels, as the page's own text is: off them the line
      // drawn again over it read soft.
      const dpr = this._canvasDpr || 1;
      const region = this._canvasRect;
      const ox = region ? region.x : 0, oy = region ? region.y : 0;
      const snapX = (v: number) => Math.round((v - ox) * dpr) / dpr + ox;
      const base = Math.round((baseline - oy) * dpr) / dpr + oy;
      let right = x0 + r.w;
      // The rest of the row, held apart by what is still open, sliding back
      // as the run closes: covered where it really is, drawn after the x'd
      // letters.
      if (r.bg) {
        const open = r.w * (1 - closed);
        // Where each letter of the rest of the row stands, measured once per
        // edit, not every frame: a coordsAtPos a letter (a DOM range each),
        // up to XOUT_MAX_TEXT of them, was most of a frame while Backspace
        // was held on a phone (HANDOFF 1.63). Kept relative to the anchor,
        // so a scroll moves them with it.
        const width = view.contentDOM.clientWidth;
        let measured = r.rest && r.rest.doc === doc && r.rest.at === at && r.rest.width === width ? r.rest : null;
        if (!measured) {
          // Two places measured, not one a letter: where the row's last
          // letter stands (found by halving, a few measurements), and the
          // anchor's own. The letters between are spaced by their widths in
          // the run's font, stretched to land on the last one exactly.
          const items: [string, number][] = [];
          const lineEnd = doc.lineAt(at).to;
          const limit = Math.min(lineEnd, at + XOUT_MAX_TEXT);
          const onRow = (p: number) => {
            const cc = view.coordsAtPos(p, 1);
            return cc && Math.abs(cc.top - rowTop) <= 2 ? cc : null;
          };
          let lo = at, hi = limit - 1;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (onRow(mid)) lo = mid; else hi = mid - 1;
          }
          const lastC = limit > at ? onRow(lo) : null;
          if (lastC) {
            let acc = 0;
            for (let pos = at; pos <= lo && pos < lineEnd;) {
              const ch = String.fromCodePoint(doc.sliceString(pos, pos + 2).codePointAt(0) ?? 32);
              items.push([ch, acc]);
              acc += ctx.measureText(ch).width;
              pos += ch.length;
            }
            const span = items.length ? items[items.length - 1][1] : 0;
            const k = span > 0 ? (lastC.left - x0) / span : 1;
            for (const it of items) it[1] *= k;
          }
          let edge = Infinity;
          try { edge = view.contentDOM.getBoundingClientRect().right - x0; } catch { edge = Infinity; /* no layout to read */ }
          measured = r.rest = { doc, at, width, items, edge };
        }
        const rest: [string, number][] = measured.items.map(([ch, dx]) => [ch, x0 + dx]);
        if (rest.length) {
          const last = rest[rest.length - 1];
          const edge = x0 + measured.edge;
          right = Math.min(edge, Math.max(right, last[1] + ctx.measureText(last[0]).width + r.w) + 1);
          ctx.globalAlpha = 1;
          ctx.fillStyle = r.bg;
          ctx.fillRect(x0 - 0.5, rowTop, right - x0 + 0.5, rowH);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0 - 1, rowTop - 2, right - x0 + 1, rowH + 4);
          ctx.clip();
          ctx.fillStyle = r.textColor;
          for (const [ch, x] of rest) if (ch.trim()) ctx.fillText(ch, snapX(x + open), base);
          ctx.restore();
        }
      }
      // The deleted letters where they stood, each overtyped with an x once
      // struck - landing a little large and settling - fading as it closes.
      // A struck letter dims to half under its x: in the same ink, letter
      // and x read as one blot.
      const fade = 1 - closed;
      ctx.fillStyle = r.textColor;
      const xw = ctx.measureText("x").width;
      for (const g of r.ghosts) {
        if (!g.char.trim()) continue;
        const land = now < g.t ? -1 : Math.min(1, (now - g.t) / XOUT_POP_MS);
        ctx.globalAlpha = fade * (land < 0 ? 1 : 1 - XOUT_DIM * land);
        ctx.fillText(g.char, snapX(x0 + g.dx), base);
        if (land < 0) continue;
        ctx.globalAlpha = fade;
        const s = 1 + 0.35 * (1 - land) * (1 - land);
        const cx = x0 + g.dx + g.w / 2, cy = base - xw / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(s, s);
        ctx.fillText("x", -xw / 2, xw / 2);
        ctx.restore();
      }
      ctx.restore();
      this._markDirty(x0 - 6, rowTop - 4, Math.max(right, x0 + r.w) - x0 + 12, rowH + 8);
      return true;
    });
  },
};

export type EffectsXoutMethods = typeof effectsXoutMethods;
