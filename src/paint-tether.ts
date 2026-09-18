// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The bracket tether: matching a bracket or a quote in the raw text, the
// block boundaries a span may not cross, the line boxes between the two
// ends, and the guide that is painted along them.

import { hexToRgbTuple, hexToRgba } from "./color";
import {
  BLOCK_HEAD_MAX,
  BLOCK_LINE_LOOKBACK,
  BLOCK_PREFIX_MAX,
  BRACKET_CLOSE,
  BRACKET_OPEN,
  BRACKET_SCAN_LIMIT,
  CODE_FENCE_PREFIX,
  CURLY_QUOTE_OPEN,
  QUOTE_CHARS,
  QUOTE_LINE_SCAN,
  blockLineInfo,
  isBlockquoteMarker,
  isQuoteDelimiter,
} from "./text";
import type { Text } from "@codemirror/state";
import type { Rect as CMRect, EditorView } from "@codemirror/view";
import type { TetherSeg } from "./types";
import type CursorSmithPlugin from "./plugin";

export const paintTetherMethods = {
  // ---- Bracket Tether ----------------------------------------------------
  // Find the position of the bracket matching the one at `at`, or -1.
  //
  // This is a plain depth count over the raw text, not a syntax-aware match:
  // CodeMirror's own bracket matching lives in @codemirror/language, which
  // isn't reachable from a plugin without bundling it. The practical
  // difference is that a bracket inside a string or comment still counts, so
  // the tether can occasionally point somewhere a compiler wouldn't. For a
  // decorative guide in a Markdown editor that's an acceptable trade; it is
  // NOT a good enough basis for anything that edits text.
  //
  // The one Markdown fact it does know is that a ">" opening a line is a
  // blockquote marker, not an angle bracket. Without that, every line of a
  // callout offers a fresh false partner to any "<" above it, which is the
  // most visible way this goes wrong in a real vault - and no boundary check
  // catches it, because the marker sits at the same quote depth as the "<".
  matchingBracketPos(this: CursorSmithPlugin, doc: Text, at: number, ch: string): number {
    const open = BRACKET_OPEN[ch] ? ch : BRACKET_CLOSE[ch];
    if (!open) return -1;
    const close = BRACKET_OPEN[open];
    const forward = ch === open;
    const len = doc.length;

    // Read one slice and index into it rather than calling sliceString per
    // character - the same scan done a character at a time is thousands of
    // rope walks per frame.
    if (forward) {
      const end = Math.min(len, at + BRACKET_SCAN_LIMIT);
      const text = doc.sliceString(at, end);
      let depth = 0;
      // Whether we're still inside a line's blockquote prefix. False to begin
      // with because `at` is itself a bracket, so nothing before the first
      // newline can be a marker. Tracked inline rather than by calling
      // isBlockquoteMarker per ">": going forwards the prefix state is simply
      // carried along, at no cost.
      let inPrefix = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\n") { inPrefix = true; continue; }
        if (inPrefix) {
          if (c === " " || c === "\t" || c === ">") continue; // still the prefix
          inPrefix = false;
        }
        if (c === open) depth++;
        else if (c === close) { if (--depth === 0) return at + i; }
      }
    } else {
      const start = Math.max(0, at - BRACKET_SCAN_LIMIT + 1);
      const text = doc.sliceString(start, at + 1);
      // Only angle brackets can collide with a marker, so the look-back is
      // skipped entirely for every other pair.
      const angles = close === ">";
      let depth = 0;
      for (let i = text.length - 1; i >= 0; i--) {
        const c = text[i];
        if (angles && c === ">" && isBlockquoteMarker(text, i, start)) continue;
        if (c === close) depth++;
        else if (c === open) { if (--depth === 0) return start + i; }
      }
    }
    return -1;
  },

  // Whether the character at `at` is a blockquote marker. Used to stop the
  // caret tethering FROM one - parking next to the ">" that opens a callout
  // line should do nothing, not hunt backwards for a "<".
  isQuoteMarkerAt(this: CursorSmithPlugin, doc: Text, at: number) {
    if (doc.sliceString(at, at + 1) !== ">") return false;
    const back = Math.max(0, at - BLOCK_PREFIX_MAX);
    return isBlockquoteMarker(doc.sliceString(back, at + 1), at - back, back);
  },

  // The text of the line containing `pos`, plus that line's start offset.
  // Capped rather than using doc.lineAt so this works on any doc-like object
  // exposing length/sliceString, and so a pathological single-line file can't
  // turn one frame into a megabyte read.
  lineBoundsAt(this: CursorSmithPlugin, doc: Text, pos: number): { start: number; text: string } {
    const from = Math.max(0, pos - QUOTE_LINE_SCAN);
    const to = Math.min(doc.length, pos + QUOTE_LINE_SCAN);
    const chunk = doc.sliceString(from, to);
    const rel = pos - from;
    const s = rel <= 0 ? 0 : chunk.lastIndexOf("\n", rel - 1) + 1;
    let e = chunk.indexOf("\n", rel);
    if (e < 0) e = chunk.length;
    return { start: from + s, text: chunk.slice(s, e) };
  },

  // The innermost quoted run on this line that contains (or touches) the
  // caret. Straight quotes are taken left to right - 1st with 2nd, 3rd with
  // 4th - among the quotes that qualify as delimiters. Curly quotes are
  // directional, so an opener is matched to its own nearest closer instead.
  quoteSpanAt(this: CursorSmithPlugin, doc: Text, pos: number): { from: number; to: number } | null {
    const { start, text } = this.lineBoundsAt(doc, pos);
    const rel = pos - start;
    let best: { from: number; to: number } | null = null;
    const consider = (a: number, b: number) => {
      // Inclusive of both edges: the caret counts as "in" the run whether it's
      // inside it or parked just outside either quote.
      if (rel < a || rel > b + 1) return;
      if (!best || a > best.from) best = { from: start + a, to: start + b };
    };

    // Straight quotes: symmetric, paired left-to-right.
    for (const q of QUOTE_CHARS) {
      const marks = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === q && isQuoteDelimiter(text, i)) marks.push(i);
      }
      for (let i = 0; i + 1 < marks.length; i += 2) consider(marks[i], marks[i + 1]);
    }

    // Curly quotes: directional, so scan for an opener and take the nearest
    // matching closer after it. Nesting of the same pair (“ … “ … ” … ”) is
    // rare enough in prose that a simple depth count per opener type is plenty.
    for (const openCh in CURLY_QUOTE_OPEN) {
      const closeCh = CURLY_QUOTE_OPEN[openCh];
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== openCh) continue;
        let depth = 1;
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] === openCh) depth++;
          else if (text[j] === closeCh && isQuoteDelimiter(text, j)) {
            if (--depth === 0) { consider(i, j); break; }
          }
        }
      }
    }
    return best;
  },

  // The innermost bracket pair the caret sits *inside*, for when it isn't
  // touching a bracket at all. Walks back looking for an opener that hasn't
  // already been closed, tracking each bracket type separately so an unrelated
  // `]` in the middle of a `(...)` doesn't derail the count.
  enclosingBracketSpan(this: CursorSmithPlugin, doc: Text, pos: number) {
    const start = Math.max(0, pos - BRACKET_SCAN_LIMIT);
    const text = doc.sliceString(start, pos);
    // One counter per closer, built from the pair table so every bracket type
    // (including angle brackets) is tracked without hardcoding the list here.
    const depth: Record<string, number> = {};
    for (const closer in BRACKET_CLOSE) depth[closer] = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      const c = text[i];
      if (BRACKET_CLOSE[c]) {
        // A ">" opening a line is a blockquote marker, not a closer - counting
        // it would leave depth[">"] permanently ahead inside any callout and
        // hide every real angle pair in it.
        if (c === ">" && isBlockquoteMarker(text, i, start)) continue;
        depth[c]++;
        continue;
      }
      const closer = BRACKET_OPEN[c];
      if (!closer) continue;
      if (depth[closer] > 0) { depth[closer]--; continue; }
      const from = start + i;
      const to = this.matchingBracketPos(doc, from, c);
      return to >= 0 ? { from, to } : null;
    }
    return null;
  },

  // True when a structural block boundary falls between two offsets - i.e. the
  // pair runs into, out of, or clean across a code block, blockquote or
  // callout. See blockLineInfo for why fences and quotes are detected
  // differently but resolved in one walk.
  //
  // The line the span BEGINS on sets the baseline depth and is exempt from the
  // fence test: a bracket sitting on a fence line must not cut its own tether,
  // and only lines that actually begin inside the span can introduce a fence.
  crossesBlockBoundary(this: CursorSmithPlugin, doc: Text, from: number, to: number): boolean {
    if (!(to > from)) return false;
    // Reach back for the start of `from`'s line, and slightly past `to` so a
    // fence opening the final line is still matchable when the span stops
    // mid-fence.
    const back = Math.max(0, from - BLOCK_LINE_LOOKBACK);
    const text = doc.sliceString(back, Math.min(doc.length, to + CODE_FENCE_PREFIX));
    const rel = from - back;
    const relTo = to - back;

    let ls = rel <= 0 ? 0 : text.lastIndexOf("\n", rel - 1) + 1;
    let base = -1;
    while (ls <= relTo) {
      let le = text.indexOf("\n", ls);
      if (le < 0) le = text.length;
      // Cap the read: only the head of a line decides its depth and fence, and
      // a span can legitimately cover very long lines.
      const info = blockLineInfo(text.slice(ls, Math.min(le, ls + BLOCK_HEAD_MAX)));
      if (base < 0) {
        base = info.depth;
      } else {
        if (info.fence) return true;          // a code fence opens inside the span
        if (info.depth !== base) return true; // moved into, out of, or between quotes
      }
      if (le >= text.length) break;
      ls = le + 1;
    }
    return false;
  },

  // What the tether should join, as { from, to } document offsets with
  // from <= to, or null.
  //
  // Order matters: a bracket the caret is actually touching wins over anything
  // it merely sits inside, because that's the one you just typed or arrowed
  // onto. Failing that, the innermost enclosing run wins - whichever of the
  // quote or bracket candidates opens closest to the caret.
  tetherSpan(this: CursorSmithPlugin, doc: Text, pos: number) {
    const len = doc.length;
    const adjacent = [];
    if (pos > 0) adjacent.push(pos - 1);
    if (pos < len) adjacent.push(pos);
    for (const at of adjacent) {
      const ch = doc.sliceString(at, at + 1);
      if (!BRACKET_OPEN[ch] && !BRACKET_CLOSE[ch]) continue;
      // Parking beside the ">" that opens a quoted or callout line must do
      // nothing - it's punctuation belonging to the block, not a bracket.
      if (ch === ">" && this.isQuoteMarkerAt(doc, at)) continue;
      const m = this.matchingBracketPos(doc, at, ch);
      if (m < 0) continue;
      const from = Math.min(at, m), to = Math.max(at, m);
      // A match across a block boundary isn't a match. `continue` rather than
      // `return null` so the caret still gets whatever run it's sitting in -
      // the touched bracket losing its partner says nothing about the pair
      // enclosing it.
      if (this.crossesBlockBoundary(doc, from, to)) continue;
      return { from, to };
    }

    const q = this.quoteSpanAt(doc, pos);
    // Not filtered: quoteSpanAt is scoped to a single line (see the note on
    // QUOTE_CHARS), and both a fence and a quote-depth change are properties
    // of a whole line, so a quote span cannot cross either.
    let b = this.enclosingBracketSpan(doc, pos);
    if (b && this.crossesBlockBoundary(doc, b.from, b.to)) b = null;
    if (q && b) return q.from > b.from ? q : b;
    return q || b || null;
  },

  // The tether for this frame, as an array of horizontal rules ordered top to
  // bottom - one per line the pair covers - in viewport pixels (the canvas is
  // fixed at 0,0, so viewport coords ARE canvas coords, the same assumption
  // cmCaretCoords and secondaryCaretCoords make). Returns null when there's
  // nothing to draw.
  // With no head this is the primary's tether, at the main selection. A
  // secondary passes its own head (and whether its range is empty), with its
  // bundle swapped in so the caches below are its own.
  bracketTetherCoords(this: CursorSmithPlugin, view: EditorView | null | undefined, head?: number, empty?: boolean): TetherSeg[] | null {
    if (!view || !view.hasFocus) return null;
    try {
      const state = view.state;
      const main = state.selection.main;
      if (head === undefined) { head = main.head; empty = main.empty; }
      // Only for a collapsed caret: over a selection the line would fight the
      // selection highlight and there's no single "the caret is here" point.
      if (!empty) return null;

      const doc = state.doc;
      const pos = head;
      const len = doc.length;

      // The scan is the expensive part and depends only on where the caret is
      // in what text, so cache it across frames. Coordinates still resolve
      // every frame, since scrolling moves them without moving the caret.
      const key = pos + ":" + len;
      let from, to;
      if (this._tetherKey === key) {
        from = this._tetherFrom;
        to = this._tetherTo;
      } else {
        const span = this.tetherSpan(doc, pos);
        from = span ? span.from : -1;
        to = span ? span.to : -1;
        this._tetherKey = key;
        this._tetherFrom = from;
        this._tetherTo = to;
      }
      if (from < 0 || to < 0) return null;

      const a = view.coordsAtPos(from, 1) || view.coordsAtPos(from, -1);
      const b = view.coordsAtPos(to, 1) || view.coordsAtPos(to, -1);
      if (!a || !b) return null;

      // Same out-of-view guard the other caret readers use: CodeMirror will
      // happily return a clamped coordinate for a position scrolled off the
      // pane, which would stake the tether to the pane edge instead of to the
      // bracket. Drop the tether rather than draw a line to a lie.
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1;
        for (const c of [a, b]) {
          const cBottom = c.bottom ?? c.top;
          if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) return null;
        }
      }

      const segs = this.tetherSegments(view, from, to, a, b);
      return segs && segs.length ? segs : null;
    } catch (e) {
      // A bad frame shouldn't kill the tick loop.
      this._reportOnce("bracketTetherCoords", e);
      return null;
    }
  },

  // The tether as one or more horizontal rules, ordered top to bottom, each
  // { x1, y1, x2, y2 } in viewport pixels.
  //
  // A pair that fits on one line is a single rule from the opener to the
  // closer. A pair that does NOT - because the text is long enough to soft-wrap
  // or because it genuinely spans several lines - used to be that same single
  // rule, which meant one long diagonal drawn from the opening bracket down and
  // across to the closing one: it sloped through the middle of everything in
  // between, struck out text it had nothing to say about, and gave no sense of
  // what the pair actually contained. So a multi-line span is now measured
  // per line instead, and each covered line gets its own level rule beneath
  // just the part of that line the pair spans - the whole span underlined,
  // rather than a chord cut across it.
  //
  // `a` and `b` are the already-resolved coordinates of the two brackets.
  tetherSegments(this: CursorSmithPlugin, view: EditorView, from: number, to: number, a: CMRect, b: CMRect): TetherSeg[] {
    // The rules run *under* the text rather than through it, so each sits just
    // below its line box. The closing end gets a glyph width added so the span
    // covers that character instead of stopping at its left edge.
    const drop = 1.5;
    const glyph = Math.max(3, (b.bottom - b.top) * 0.42);
    const flat = [{
      x1: a.left,
      y1: a.bottom + drop,
      x2: b.left + glyph,
      y2: b.bottom + drop,
    }];
    // Both brackets on the same line box: the two endpoints already describe
    // the whole rule, and none of the measuring below is needed.
    if (Math.abs(a.bottom - b.bottom) < 1) return flat;

    // Measuring line boxes means walking the DOM, which is far too expensive to
    // repeat on every frame for a span that hasn't moved. Scrolling translates
    // the whole span by a single delta, so a previous measurement can just be
    // shifted - and the two endpoints, which are resolved every frame anyway,
    // are the check that one translation really does explain the new layout.
    // If they disagree, something reflowed underneath us (a wrap point moved, a
    // fold opened, the pane resized) and the span is measured again.
    const key = from + ":" + to + ":" + view.state.doc.length;
    const cached = this._tetherSegs;
    if (cached && this._tetherSegKey === key && this._tetherAnchorA && this._tetherAnchorB) {
      const dx = a.left - this._tetherAnchorA.x;
      const dy = a.bottom - this._tetherAnchorA.y;
      if (Math.abs((b.left - this._tetherAnchorB.x) - dx) < 0.5 &&
          Math.abs((b.bottom - this._tetherAnchorB.y) - dy) < 0.5) {
        if (dx === 0 && dy === 0) return cached;
        return cached.map((s) => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }));
      }
    }

    // `to + 1` so the closing bracket's own glyph is inside the measured range,
    // which is what the `glyph` fudge above stands in for on the single-line
    // path.
    const rects = this.rangeLineRects(view, from, Math.min(view.state.doc.length, to + 1));
    const segs = rects.length >= 2
      ? rects.map((r) => ({ x1: r.left, y1: r.bottom + drop, x2: r.right, y2: r.bottom + drop }))
      : flat;

    this._tetherSegKey = key;
    this._tetherSegs = segs;
    this._tetherAnchorA = { x: a.left, y: a.bottom };
    this._tetherAnchorB = { x: b.left, y: b.bottom };
    return segs;
  },

  // The line boxes a document range occupies, as { left, right, bottom } in
  // viewport pixels, one entry per line, top to bottom.
  //
  // Measured through a DOM Range rather than through coordsAtPos because only
  // the DOM knows where a soft-wrapped line actually breaks: getClientRects
  // hands back one rect per line box, so a span that wraps comes back already
  // split at its wrap points, with proportional glyph widths and bidi runs
  // accounted for. CodeMirror can only answer "where is offset N", which would
  // find the hard line breaks and miss every soft one - i.e. exactly the case
  // this is here for.
  //
  // One Range per logical line, rather than one Range for the whole span, on
  // purpose: a Range that FULLY contains a .cm-line element also reports that
  // element's own border box, which is the full width of the editor, so every
  // middle line would measure as a full-width rule running way past the end of
  // its text. Keeping each Range strictly inside one line means only the text
  // within it is ever measured.
  rangeLineRects(this: CursorSmithPlugin, view: EditorView, from: number, to: number): { left: number; right: number; bottom: number }[] {
    const doc = view.state.doc;
    const out: { left: number; right: number; bottom: number }[] = [];
    if (to <= from) return out;
    const first = doc.lineAt(from);
    const last = doc.lineAt(to);
    // A pair spanning more than a screenful can't be usefully underlined and
    // isn't worth the measuring; the caller falls back to the single rule.
    if (last.number - first.number > 300) return out;
    const ownerDoc = view.dom.ownerDocument;

    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n);
      const s = Math.max(from, line.from);
      const e = Math.min(to, line.to);
      // Blank line, or a line the span only touches at a break: nothing under
      // which to draw anything.
      if (e <= s) continue;

      let rects;
      try {
        const ds = view.domAtPos(s);
        const de = view.domAtPos(e);
        if (!ds || !de || !ds.node || !de.node) continue;
        const range = ownerDoc.createRange();
        range.setStart(ds.node, ds.offset);
        range.setEnd(de.node, de.offset);
        rects = range.getClientRects();
      } catch {
        // A line scrolled out of the rendered viewport, or hidden behind a fold
        // or a widget, has no DOM to measure. Skipping it beats abandoning the
        // whole tether.
        continue;
      }

      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r || r.width < 0.5 || r.height < 0.5) continue;
        // Styled runs inside one line box - a bold stretch, a link, a search
        // highlight - each report their own rect. Fold everything sharing a
        // baseline into a single span so the line gets one continuous rule
        // instead of a dashed row of fragments.
        let merged = false;
        for (const o of out) {
          if (Math.abs(o.bottom - r.bottom) < 1.5) {
            o.left = Math.min(o.left, r.left);
            o.right = Math.max(o.right, r.right);
            merged = true;
            break;
          }
        }
        if (!merged) out.push({ left: r.left, right: r.right, bottom: r.bottom });
      }
    }

    out.sort((p, q) => p.bottom - q.bottom || p.left - q.left);
    return out;
  },

  // Stroke for one rule of the tether, where that rule covers t0..t1 (as
  // fractions) of the whole run.
  //
  // With the gradient on, the ramp is spread across the entire span rather than
  // restarted on each line: the canvas gradient is anchored at the virtual
  // points where fractions 0 and 1 would land on this rule's own axis, so
  // consecutive lines pick up consecutive slices of one ramp and the tether
  // still reads as a single object, the way it does with the cursor.
  tetherStroke(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, s: TetherSeg, t0: number, t1: number, alpha: number) {
    if (!this.look.gradientEnabled) return hexToRgba(this.getActiveColor(), alpha);
    const span = Math.max(1e-4, t1 - t0);
    const ux = (s.x2 - s.x1) / span;
    const uy = (s.y2 - s.y1) / span;
    const g = ctx.createLinearGradient(
      s.x1 - ux * t0, s.y1 - uy * t0,
      s.x1 + ux * (1 - t0), s.y1 + uy * (1 - t0),
    );
    const stops = this.gradientStops();
    for (let i = 0; i < stops.length; i++) {
      const [r, gg, b] = hexToRgbTuple(stops[i]);
      g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, `rgba(${r}, ${gg}, ${b}, ${alpha})`);
    }
    return g;
  },

  drawBracketTether(this: CursorSmithPlugin) {
    const segs = this.bracketTether;
    if (!segs || !segs.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const strength = Math.max(0, Math.min(1, this.look.bracketTetherStrength ?? 0.35));
    const alpha = strength * opacity;
    if (alpha <= 0.01) return;

    // Total length of the run, so the gradient can be spread across every rule
    // as one ramp (see tetherStroke) instead of restarting on each line.
    const lens = [];
    let total = 0;
    for (const s of segs) {
      const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      lens.push(l);
      total += l;
    }
    // Caret sitting right on its own match (an empty pair): nothing to underline.
    if (total < 2) return;

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";

    // Short ticks turning up toward the text, at the opening bracket and at the
    // closing one only - NOT at the end of every rule. They mark where the pair
    // begins and ends, so putting them on each line's edge would claim a
    // boundary at every wrap point, which is precisely the thing the reader
    // should be able to ignore.
    const tick = 4;
    const last = segs.length - 1;
    let run = 0;

    for (let i = 0; i <= last; i++) {
      const s = segs[i];
      const len = lens[i];
      if (len < 0.5) continue;
      ctx.strokeStyle = this.tetherStroke(ctx, s, run / total, (run + len) / total, alpha);
      run += len;

      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      if (i === 0) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x1, s.y1 - tick);
      }
      if (i === last) {
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2, s.y2 - tick);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Damage covers every rule plus the ticks standing above them. One box over
    // the lot rather than one per line: the rules are stacked a line apart, so
    // per-line boxes would cover nearly the same area for more bookkeeping.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of segs) {
      minX = Math.min(minX, s.x1, s.x2);
      maxX = Math.max(maxX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2);
      maxY = Math.max(maxY, s.y1, s.y2);
    }
    const pad = tick + 4;
    this._markDirty(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2);
  },

  // The primary's tether segments plus every secondary's, as one list for
  // drawBracketTether; null when nobody has one.
  mergeTethers(this: CursorSmithPlugin, primary: TetherSeg[] | null): TetherSeg[] | null {
    let out = primary && primary.length ? primary : null;
    const states = this._secondaries;
    if (states && states.length) {
      for (const st of states) {
        const t = st._tetherOut;
        if (t && t.length) out = out ? out.concat(t) : t.slice();
      }
    }
    return out;
  },
};
