// Part of the plugin class, split out by seam (HANDOFF §1.16, ARCHITECTURE
// "Should this be split?"): the methods below are assigned onto
// CursorSmithPlugin.prototype and declared on the class, so every `this.x`
// read and every test reach them exactly as before. `this` is the plugin.
//
// Where the caret is. The CodeMirror path (cmCaretCoords) and the generic
// one for every other editable surface - form fields through a mirror
// element, contenteditables through the selection - plus the glyph under
// the caret and the clip rects the canvas is fitted to.

import { View } from "obsidian";
import { CARET_COVERS, CARET_STYLE_TTL_MS, GEOMETRY_TTL_MS, CARET_THICKNESS_MAX, TW_SPRING_DOWN } from "./constants";
import { isTextCaretHost, lastGrapheme } from "./motion";
import { DEFAULT_SETTINGS } from "./settings";
import type { EditorView } from "@codemirror/view";
import type { Box, CaretCoords, CaretRecord, CaretState, ChromeInsets, CoordsLTB, LineStyle, MainRectCache, TypewriterPose, Look } from "./types";
import type CursorSmithPlugin from "./plugin";

export const measureMethods = {
  caretCoords(this: CursorSmithPlugin): CaretRecord | null {
    const view = this.app.workspace.activeEditor?.editor?.cm;

    // The note editor (CodeMirror) itself has focus - use the precise,
    // CodeMirror-aware caret info (real glyph metrics, table handling, etc).
    if (view && this.editorFocused(view)) {
      return this.cmCaretCoords(view);
    }

    // Focus is somewhere else in the app that isn't CodeMirror at all - the
    // file-tree rename box, the Command Palette / Quick Switcher input,
    // Settings text fields, other plugins' modals, and so on. These never
    // had a caret to draw before, which is why the custom cursor (and the
    // native one, hidden globally by our CSS) both went missing there.
    // Fall back to a generic caret built from the browser's own selection/
    // element rect so the cursor still shows up on any editable surface.
    return this.genericCaretCoords();
  },

  cmCaretCoords(this: CursorSmithPlugin, view: EditorView): CaretRecord | null {
    try {
      const main = view.state.selection.main;
      const pos = main.head;
      const doc = view.dom.ownerDocument;
      const active = doc.activeElement;
      const activeIsEditable = isTextCaretHost(active);
      const inTable = !!active?.closest?.("table");

      // At a soft-wrap boundary the same document position has TWO valid
      // visual locations: end of the previous visual row (side -1) or start
      // of the next visual row (side 1). CodeMirror records which one the
      // cursor logically sits at in selection.main.assoc (this is exactly
      // what its own drawSelection plugin uses: coordsAtPos(head, assoc || 1)),
      // so honor it instead of hardcoding -1. Note: CodeMirror's rightward
      // char motion always produces assoc -1, so arrowing right across a
      // wrap renders end-of-row then before-the-second-char, never stopping
      // at the start of the new row - that matches CodeMirror's own native
      // cursor and is left as-is deliberately.
      const side = main.assoc || 1;
      // Geometry cache. coordsAtPos is a layout read (and, in Obsidian, a
      // getComputedStyle for the line's text direction) and it used to run
      // every frame the caret merely sat there. Keyed on (doc identity, pos,
      // assoc) like the style cache below, plus the layout generation every
      // wake source bumps, plus a short TTL as the backstop for what has no
      // event. Tables go through selectionFallbackCoords and are not cached.
      const geoNow = performance.now();
      let gc = this._caretGeoCache;
      let c;
      if (!inTable && gc && gc.doc === view.state.doc && gc.pos === pos && gc.assoc === (main.assoc || 0) &&
          gc.gen === (this._layoutGen | 0) && (geoNow - gc.t) < GEOMETRY_TTL_MS) {
        c = gc.c;
      } else {
        c = inTable ? null : (view.coordsAtPos(pos, side) || view.coordsAtPos(pos, -side));
        if (c && !inTable) {
          this._caretGeoCache = { doc: view.state.doc, pos, assoc: main.assoc || 0, gen: this._layoutGen | 0, t: geoNow, c };
        }
      }

      if (!c) {
        c = this.selectionFallbackCoords(view);
        if (!c) return null;
      }

      // When the caret's document position is scrolled outside the visible
      // editor pane (e.g. mouse-wheel scrolling without moving the text
      // cursor), CodeMirror can still return a coordinate for it - typically
      // clamped near the top or bottom edge of the rendered content, which
      // lands right on the titlebar or just above the status bar. Treat an
      // out-of-view caret the same as "not focused" rather than drawing a
      // ghost cursor there; this also stops the smear spring from reacting
      // to that spurious jump (which is what caused the wiggle on fast
      // scrolling).
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1; // avoid flicker right at the pane edge
        const cBottom = c.bottom ?? c.top;
        if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) {
          return null;
        }
      }

      const rawChar = view.state.doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";

      const win = doc.defaultView || window;

      // --- Cached style + metric reads -----------------------------------
      // getComputedStyle (up to 3x) and elementFromPoint (which forces a
      // layout + hit-test) are the most expensive things in this per-frame
      // function, and the canvas measureText for the glyph width is next.
      // Their inputs only change when the caret moves to a different document
      // position, the document is edited, or the theme/font changes - none of
      // which happen on the frames where a caret merely sits and blinks.
      //
      // Cache the RESOLVED scalars, NOT the live CSSStyleDeclaration (reading
      // a property off that re-flushes style, defeating the point). Key on
      // (doc identity, pos, assoc): in CM6 a pure selection move reuses the
      // same Text object, so the key holds across scrolling and blinking,
      // while any edit swaps the Text object and busts it. A short TTL
      // backstops theme / font-size changes that touch none of those keys.
      // ...plus the style generation (css-change, layout-change, resize -
      // see _invalidateStyle), so a theme or font change re-measures at once
      // and the TTL is only the backstop for a change nothing announces. The
      // layout generation would be the wrong key here: every scroll and
      // keystroke bumps it, and neither changes the font under a caret that
      // has not moved.
      const assocKey = main.assoc || 0;
      const nowMs = performance.now();
      const styleGen = this._styleGen | 0;
      let sc = this._caretStyleCache;
      if (!(sc && sc.doc === view.state.doc && sc.pos === pos &&
            sc.assoc === assocKey && sc.gen === styleGen && (nowMs - sc.t) < CARET_STYLE_TTL_MS)) {
        const contentStyle = win.getComputedStyle(view.contentDOM);

        // Find the actual DOM element rendering the character at the caret
        // (not just "the first .cm-line in the document"), so headings,
        // inline code, and any other differently-sized text report their own
        // real font metrics instead of the editor's base font-size/family.
        const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
        const sampleY = (c.top + c.bottom) / 2;
        const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
        const lineEl = (elAtCaret && elAtCaret.closest && elAtCaret.closest(".cm-line")) ||
          view.contentDOM.querySelector(".cm-line");
        const charStyle = elAtCaret && lineEl && lineEl.contains(elAtCaret)
          ? win.getComputedStyle(elAtCaret)
          : (lineEl ? win.getComputedStyle(lineEl) : contentStyle);

        const _textColor = charStyle.color || contentStyle.color || "#ffffff";

        // Extract exact font metrics
        const _fontSize = parseFloat(charStyle.fontSize) || parseFloat(contentStyle.fontSize) || 14;
        const _fontFamily = charStyle.fontFamily || contentStyle.fontFamily || "monospace";
        const _fontWeight = charStyle.fontWeight || contentStyle.fontWeight || "normal";
        const _fontStyleCss = charStyle.fontStyle || contentStyle.fontStyle || "normal";

        // getComputedStyle resolves letter-spacing to 'px' even if set in 'em'.
        const letterSpacingStr = charStyle.letterSpacing || contentStyle.letterSpacing;
        let _letterSpacing = 0;
        if (letterSpacingStr && letterSpacingStr.endsWith("px")) {
          _letterSpacing = parseFloat(letterSpacingStr) || 0;
        }

        const _lineHeightStr = charStyle.lineHeight || contentStyle.lineHeight || "";

        // Width: canvas measurement primary (accurate for proportional fonts,
        // respects letter-spacing), coordsAtPos delta as fallback only when
        // there's no character to measure (end of text, blank line).
        // Note: coordsAtPos(pos+1) at end-of-line returns the start of the
        // NEXT line, making the delta garbage - so it must be the fallback,
        // not the primary source. The canvas measurement handles end-of-line
        // correctly because it measures the actual glyph, not a position delta.
        let _charWidth = view.defaultCharacterWidth || 8;
        if (char) {
          const measuredW = this.measureCharWidth(char, _fontFamily, _fontSize, _fontWeight, _fontStyleCss);
          if (measuredW) {
            _charWidth = measuredW + _letterSpacing;
          } else {
            try {
              const nextCoords = view.coordsAtPos(pos + 1, -1) || view.coordsAtPos(pos + 1, 1);
              if (nextCoords) {
                const measured = nextCoords.left - c.left;
                if (measured > 0.5 && measured < _charWidth * 6) _charWidth = measured;
              }
            } catch {
              /* fall back to defaultCharacterWidth */
            }
          }
        }

        // Horizontal extent of the rendered text on the caret's own VISUAL row.
        //
        // Hot-head needs this for two things: to keep fire off the empty part
        // of a line, and to know when the caret is at a row's first or last
        // character. The .cm-line element is the whole LOGICAL line, so its
        // bounding box is useless once soft wrapping is on - it spans every
        // wrapped row at once and is as wide as the editor. getClientRects()
        // on the line's contents returns one rect per visual row instead, so
        // picking the rect that vertically contains the caret gives the row the
        // caret is actually sitting on, wrapped or not.
        let _rowLeft = null, _rowRight = null;
        if (lineEl) {
          try {
            const rng = doc.createRange();
            rng.selectNodeContents(lineEl);
            const rects = rng.getClientRects();
            // Overlap against the caret's whole vertical span, not just whether
            // the caret's midpoint falls inside a rect. Inline spans with a
            // smaller font (inline code, sub/superscript, a smaller heading
            // fragment) produce rects shorter than the caret, and a strict
            // midpoint test misses them entirely - which is what left whole
            // stretches of text with no fire on them.
            let best = null;
            let nearest = null, nearestD = Infinity;
            for (let ri = 0; ri < rects.length; ri++) {
              const r = rects[ri];
              if (r.width <= 0 && r.height <= 0) continue;
              const overlap = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
              if (overlap > 0) {
                // Several rects share a row (one per styled span), so grow the
                // extent across all of them rather than taking the first.
                if (!best) best = { left: r.left, right: r.right };
                else { best.left = Math.min(best.left, r.left); best.right = Math.max(best.right, r.right); }
              } else {
                const d = Math.abs((r.top + r.bottom) / 2 - (c.top + c.bottom) / 2);
                if (d < nearestD) { nearestD = d; nearest = r; }
              }
            }
            if (!best && nearest && nearestD < (c.bottom - c.top)) {
              // Nothing overlapped, but a row sits within a line-height of the
              // caret - close enough to be the caret's own row on a display
              // where the rects and the caret box don't quite line up.
              best = { left: nearest.left, right: nearest.right };
            }
            if (best && best.right - best.left > 0.5) {
              _rowLeft = best.left; _rowRight = best.right;
            } else if (!(lineEl.textContent || "").trim()) {
              // Genuinely blank line: a zero-width row is correct, and keeps the
              // fire from spreading out into the empty margin.
              _rowLeft = c.left; _rowRight = c.left;
            } else {
              // There IS text here but we couldn't resolve which row - leave the
              // extent unknown so the fire simply isn't clamped. Falling back to
              // a zero-width row instead (as this used to) squeezes the fire
              // down to a single column and reads as the effect being broken on
              // those lines.
              _rowLeft = null; _rowRight = null;
            }
          } catch {
            // A line whose DOM is not rendered (folded, off-screen) has no
            // rects to read; the row extent is simply unknown.
            _rowLeft = null; _rowRight = null;
          }
        }

        sc = this._caretStyleCache = {
          doc: view.state.doc, pos, assoc: assocKey, gen: styleGen, t: nowMs,
          textColor: _textColor, fontSize: _fontSize, fontFamily: _fontFamily,
          fontWeight: _fontWeight, fontStyle: _fontStyleCss,
          letterSpacing: _letterSpacing, lineHeightStr: _lineHeightStr,
          charWidth: _charWidth, rowLeft: _rowLeft, rowRight: _rowRight,
        };
      }

      const {
        textColor, fontSize, fontFamily, fontWeight, fontStyle: fontStyleCss,
        letterSpacing, lineHeightStr, charWidth, rowLeft, rowRight,
      } = sc;

      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.caretThickness();
      }

      // Height: match the browser's native selection highlight box by
      // reading CSS line-height (resolved once, from the cache above). The
      // char element's line-height is preferred, falling back to the CM
      // editor's; when neither is a usable value we keep the coordsAtPos
      // span (c.bottom - c.top) as the floor.
      let h = Math.max(4, c.bottom - c.top);
      const rawLineHeight = lineHeightStr;
      if (rawLineHeight && rawLineHeight.endsWith('px')) {
        h = parseFloat(rawLineHeight);
      } else if (rawLineHeight && !isNaN(parseFloat(rawLineHeight)) && rawLineHeight !== "normal") {
        h = fontSize * parseFloat(rawLineHeight);
      }

      // Center the box vertically around the CodeMirror line coordinate
      const centerY = (c.top + c.bottom) / 2;
      const top = centerY - (h / 2);
      const bottom = centerY + (h / 2);

      return {
        x: c.left,
        top: top,
        bottom: bottom,
        h: h,
        w: finalWidth,
        actualCharWidth: charWidth,
        // Text extent of the caret's own visual row, in canvas coords (the
        // canvas is position:fixed at 0,0 so client coords map straight over).
        // Hot-head uses it to keep fire on the text and to spot row edges.
        rowLeft, rowRight,
        char,
        textColor,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle: fontStyleCss,
        // Carried so the glyph drawn inside a Box cursor can be centered on
        // the true glyph advance (charWidth minus this) rather than on the
        // letter-spacing-padded cell, which would push it right by half the
        // spacing on any theme that sets letter-spacing.
        letterSpacing,
        focused: this.editorFocused(view) || (inTable && activeIsEditable),
        pos,
        // The document length, for resolveHoldChar: with pos, an insertion
        // at the caret (typing) is told from a click or an arrow.
        docLen: view.state.doc.length,
        // Needed by updateActivePoint: an assoc flip at a wrap boundary is a
        // real cursor move (row1-end -> row2-start) even though pos is equal,
        // and must NOT be swallowed by the scroll-compensation branch.
        assoc: main.assoc,
      };
    } catch (e) {
      // A caret that cannot be measured is drawn nowhere; say so once.
      this._reportOnce("cmCaretCoords", e);
      return null;
    }
  },

  // CodeMirror 6 supports multiple cursors: state.selection.ranges is an
  // array and state.selection.mainIndex points at the "primary" one that
  // this.* tracks. This returns one entry per OTHER range, in range order,
  // with the caret head's raw pixel coords - or `visible: false` for a range
  // that has scrolled out of the pane, which keeps the array aligned with
  // the per-caret state bundles in this._secondaries (see
  // updateSecondaryCarets; an off-screen entry there clears its caret the
  // way the primary clears when it scrolls out). Returns [] when there is
  // only one range or the view isn't focused.
  secondaryCaretCoords(this: CursorSmithPlugin, view: EditorView | null | undefined, states: CaretState[]): CaretCoords[] {
    const out: CaretCoords[] = [];
    if (!view || !this.editorFocused(view)) return out;
    const gen = this._layoutGen | 0;
    const now = performance.now();
    const doc = view.state.doc;
    try {
      const sel = view.state.selection;
      const ranges = sel.ranges;
      if (!ranges || ranges.length <= 1) return out;
      const mainIndex = sel.mainIndex;

      // Same out-of-view clamp as cmCaretCoords: CodeMirror can hand back a
      // coordinate for a caret that's scrolled off, and drawing it would
      // stamp a stray dashed line at the pane edge.
      const paneRect = this.getPaneRect(view);
      const margin = 1;

      for (let i = 0; i < ranges.length; i++) {
        if (i === mainIndex) continue;
        const head = ranges[i].head;
        // Same soft-wrap disambiguation as the primary caret in cmCaretCoords.
        const s = ranges[i].assoc || 1;
        // Same geometry cache as the primary's, kept on the bundle when there
        // is one (index-aligned with the entries, see updateSecondaryCarets).
        const st = states && states[out.length];
        let c = null;
        const g = st && st._geo;
        if (g && g.doc === doc && g.pos === head && g.gen === gen && (now - g.t) < GEOMETRY_TTL_MS) {
          c = g.c;
        } else {
          c = view.coordsAtPos(head, s) || view.coordsAtPos(head, -s);
          if (st && c) st._geo = { doc, pos: head, gen, t: now, c };
        }
        let visible = !!c;
        if (c && paneRect) {
          const cBottom = c.bottom ?? c.top;
          if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) visible = false;
        }
        // pos/assoc are for the full-effect path; the plain line ignores them.
        const empty = !!ranges[i].empty;
        out.push(visible && c
          ? { x: c.left, top: c.top, bottom: c.bottom, pos: head, assoc: ranges[i].assoc || 0, empty, visible: true }
          : { x: 0, top: 0, bottom: 0, pos: head, assoc: ranges[i].assoc || 0, empty, visible: false });
      }
    } catch (e) {
      // Fall through - a bad frame shouldn't kill the tick loop.
      this._reportOnce("secondaryCaretCoords", e);
    }
    return out;
  },

  // The full caret record for one secondary - what cmCaretCoords builds for
  // the primary - from its coordsAtPos geometry plus the style of the line it
  // sits on. No elementFromPoint: that is a layout hit-test per caret per
  // edit, and a column edit re-measures every caret on every keystroke. The
  // line element from domAtPos is cheap and right for everything but a
  // caret inside an inline span with its own font, which draws with the
  // line's metrics instead. Cached on the bundle the way the primary's
  // style is (doc identity + pos + a short TTL), and shared per line within
  // a frame through `lineStyles`.
  secondaryCaretRecord(this: CursorSmithPlugin, view: EditorView, c: CaretCoords, state: CaretState, lineStyles: Map<Element, LineStyle>): CaretRecord | null {
    const doc = view.state.doc;
    const pos = c.pos;
    const now = performance.now();
    let st = state._style;
    if (!(st && st.doc === doc && st.pos === pos && (now - st.t) < 250)) {
      const win = view.dom.ownerDocument.defaultView || window;
      let lineEl = null;
      try {
        const d = view.domAtPos(pos);
        const n = (d && d.node && d.node.nodeType === 3 ? d.node.parentElement : d && d.node) as Element | null;
        lineEl = n && n.closest ? n.closest(".cm-line") : null;
      } catch { /* fall back to the editor's own style */ }
      const key = lineEl || view.contentDOM;
      let ls = lineStyles.get(key);
      if (!ls) {
        const cs = win.getComputedStyle(key);
        const letterSpacingStr = cs.letterSpacing;
        ls = {
          textColor: cs.color || "#ffffff",
          fontSize: parseFloat(cs.fontSize) || 14,
          fontFamily: cs.fontFamily || "monospace",
          fontWeight: cs.fontWeight || "normal",
          fontStyle: cs.fontStyle || "normal",
          letterSpacing: letterSpacingStr && letterSpacingStr.endsWith("px") ? (parseFloat(letterSpacingStr) || 0) : 0,
          lineHeightStr: cs.lineHeight || "",
        };
        lineStyles.set(key, ls);
      }
      const rawChar = doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";
      let charWidth = view.defaultCharacterWidth || 8;
      if (char) {
        const m = this.measureCharWidth(char, ls.fontFamily, ls.fontSize, ls.fontWeight, ls.fontStyle);
        if (m) charWidth = m + ls.letterSpacing;
      }
      st = state._style = Object.assign({ doc, pos, t: now, char, charWidth }, ls);
    }
    let h = Math.max(4, c.bottom - c.top);
    const lh = st.lineHeightStr;
    if (lh && lh.endsWith("px")) h = parseFloat(lh);
    else if (lh && !isNaN(parseFloat(lh)) && lh !== "normal") h = st.fontSize * parseFloat(lh);
    const centerY = (c.top + c.bottom) / 2;
    const w = this.styleFor("cursorStyle") === "Line" ? this.caretThickness() : st.charWidth;
    return {
      x: c.x, top: centerY - h / 2, bottom: centerY + h / 2, h, w,
      actualCharWidth: st.charWidth,
      rowLeft: null, rowRight: null,
      char: st.char, textColor: st.textColor,
      fontSize: st.fontSize, fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontStyle: st.fontStyle,
      letterSpacing: st.letterSpacing,
      focused: true, pos, assoc: c.assoc,
      docLen: view.state.doc.length,
    };
  },

  selectionFallbackCoords(this: CursorSmithPlugin, view: EditorView | null): CoordsLTB | null {
    const doc = view ? view.dom.ownerDocument : this.canvas?.ownerDocument ?? document;
    const active = doc.activeElement;
    if (!active) return null;
    // Only text-caret input types count as editable here. Toggles, radios,
    // range sliders, colour pickers, etc. are all <input> but have no caret -
    // treating them as editable made the plugin draw a cursor on top of them
    // (visible when clicking the toggle boxes in the plugin's own settings).
    if (!isTextCaretHost(active)) return null;
    const isFormField = active.tagName === "TEXTAREA" || active.tagName === "INPUT";

    // <input>/<textarea> don't participate in window.getSelection() at all -
    // the caret lives at el.selectionStart, not in the DOM Selection API, so
    // this used to fall straight through to getBoundingClientRect() below
    // and report the same left-edge coordinate no matter where the caret
    // actually was (which is why it "stuck to the left side" in the Command
    // Palette and other search boxes). Measure the real position instead.
    if (isFormField) {
      const fieldRect = this.formFieldCaretCoords(active as HTMLInputElement | HTMLTextAreaElement);
      if (fieldRect) return fieldRect;
    }

    const win = doc.defaultView || window;
    const sel = win.getSelection();
    if (sel && sel.rangeCount > 0 && sel.focusNode && active.isContentEditable) {
      const isDegenerate = (r: DOMRect | null) => !r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0);

      // Prefer measuring an actual adjacent character over a collapsed
      // point. A *collapsed* range's client rect is inconsistent across
      // browsers and often reports only the glyph's own tight font metrics
      // rather than the full rendered line-box - which is exactly what made
      // the cursor's height mismatch the browser's own (line-box-based)
      // selection highlight, and, downstream, made the character drawn
      // inside the box sit higher than the real text. A *non-collapsed*
      // one-character range renders the same way real text/selections do,
      // so its rect uses the real line-height metrics.
      const spanRect = this.adjacentCharRect(doc, sel.focusNode, sel.focusOffset);
      if (spanRect) return spanRect;

      // sel.getRangeAt(0) is always normalized to document order (start
      // before end), which isn't necessarily where the live caret is - drag
      // a selection right-to-left and the blinking caret sits at the range's
      // start, not its end. sel.focusNode/focusOffset is the actual, live,
      // direction-aware caret position.
      let range;
      try {
        range = doc.createRange();
        range.setStart(sel.focusNode, sel.focusOffset);
        range.collapse(true);
      } catch {
        // setStart rejects a focus node that is no longer in the document;
        // the normalized range is the next best thing.
        range = sel.getRangeAt(0).cloneRange();
        range.collapse(true);
      }
      let rect = range.getClientRects()[0] || (range.getBoundingClientRect?.() ?? null);

      if (isDegenerate(rect)) {
        // Blank lines often have no text node for the range to measure -
        // there's simply nothing there to produce a client rect. Rather than
        // mutating the document to force one (risky in a third-party editor
        // we don't own, e.g. it could confuse its own input handling), climb
        // from the range's container to its nearest element - i.e. that
        // line's own wrapper - and use its rect instead. This keeps the
        // caret at the correct line and left edge without touching the DOM.
        let node = range.startContainer;
        let lineEl = node.nodeType === 1 ? node : node.parentElement;
        // Skip past the direct wrapper if it's the entire editable surface
        // itself (e.g. a fully empty editor) - that's handled by the
        // size-clamped fallback further down instead.
        if (lineEl && lineEl !== active) {
          const lineRect = (lineEl as Element).getBoundingClientRect();
          if (!isDegenerate(lineRect)) rect = lineRect;
        }
      }

      if (!isDegenerate(rect)) {
        return { left: rect.left, top: rect.top, bottom: rect.bottom || rect.top + rect.height };
      }
    }

    // No usable in-place caret rect. Only fall back to the focused element's
    // own bounding box when it's small enough to plausibly BE a single-line
    // caret host (e.g. a compact rename/edit box) - never for a large
    // multi-line surface like a full code editor, where that produces a
    // cursor that's as tall as the entire view.
    const rect = active.getBoundingClientRect();
    if (!rect) return null;
    const style = win.getComputedStyle(active);
    const approxLineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
    if (rect.height > approxLineHeight * 3) return null;
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  },

  // Measures a real, rendered one-character span next to the caret (rather
  // than a collapsed point) so the resulting rect uses the browser's actual
  // line-box metrics - the same metrics it uses to paint text and selection
  // highlights - instead of a font's tight glyph metrics.
  adjacentCharRect(this: CursorSmithPlugin, doc: Document, node: Node, offset: number): CoordsLTB | null {
    if (!node || node.nodeType !== 3) return null;
    const text = (node as CharacterData).data || "";
    const isDegenerate = (r: DOMRect | null) => !r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0);

    // The horizontal comes from a COLLAPSED range at the caret itself, and
    // only the vertical from the character next to it.
    //
    // "The caret sits after this character, so anchor to its right edge" is
    // true in LTR and exactly backwards in RTL, where after means to the
    // left - and in bidi text neither is decidable from the offset alone,
    // because which side of a glyph an offset falls on is a property of the
    // run's resolved level. The same issue as #28 and the same shape: a
    // position inferred from a direction we assumed rather than measured.
    // Measured at a character's full width of error on every RTL offset in a
    // contentEditable - the tab-title rename box is one of these.
    //
    // A collapsed range is the engine's own answer and needs no assumption.
    // It is only its HEIGHT that could not be trusted, which is what this
    // function exists to fix and what the one-character rect still supplies.
    let caretX: number | null = null, caretTop = 0, caretBottom = 0;
    try {
      const c = doc.createRange();
      c.setStart(node, offset);
      c.collapse(true);
      const cr = c.getClientRects()[0] || c.getBoundingClientRect();
      if (!isDegenerate(cr)) { caretX = cr.left; caretTop = cr.top; caretBottom = Math.max(cr.bottom, cr.top + (cr.height || 0)); }
    } catch {
      /* no collapsed rect here - fall back to the character edges below */
    }
    // At a soft-wrap boundary the collapsed range answers for the END of the
    // line that wraps - upstream - while the caret the user sees after a
    // click or a keystroke sits at the start of the next line, before the
    // next character. The two disagree by a whole line. The character's
    // own rect knows which line it is on, so the collapsed x is trusted
    // only while its rect overlaps that line vertically (a collapsed rect
    // carries tight font metrics, so its top is not the line's - overlap,
    // not equality); otherwise the caret is at the character's edge. Seen
    // on the settings panel's preview line: the caret drawn after "lazy" at
    // the end of line one while the real one was before "dog." at the
    // start of line two.
    const onLine = (rect: DOMRect) => caretX === null || (caretTop < rect.bottom && caretBottom > rect.top);

    try {
      if (offset < text.length) {
        const r = doc.createRange();
        r.setStart(node, offset);
        r.setEnd(node, offset + 1);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX !== null && onLine(rect) ? caretX : rect.left, top: rect.top, bottom: rect.bottom };
      }
      if (offset > 0) {
        const r = doc.createRange();
        r.setStart(node, offset - 1);
        r.setEnd(node, offset);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX !== null && onLine(rect) ? caretX : rect.right, top: rect.top, bottom: rect.bottom };
      }
    } catch {
      /* fall through to the collapsed-range approach */
    }
    return null;
  },

  // Caret info for editable elements outside the note editor entirely -
  // file-tree rename input, Command Palette / Quick Switcher, Settings text
  // fields, other plugins' modals, etc. There's no CodeMirror here, so we
  // don't have real glyph metrics; approximate them from the focused
  // element's own computed style instead.
  // Stable opaque id for a DOM node, so a caret's location can be compared
  // across frames without holding a reference that would keep a detached node
  // alive (WeakMap - entries vanish with the node).
  _nodeKey(this: CursorSmithPlugin, node: Node): string {
    if (!node) return "0";
    if (!this._nodeIds) {
      this._nodeIds = new WeakMap();
      this._nodeIdSeq = 0;
    }
    let id = this._nodeIds.get(node);
    if (id === undefined) {
      id = ++this._nodeIdSeq;
      this._nodeIds.set(node, id);
    }
    return String(id);
  },

  // "Where is the caret", for a field that has no CodeMirror document. Two
  // frames reporting the same value mean the caret did not logically move, so
  // any change in its screen coordinates was a scroll or a layout shift.
  //
  // Deliberately built from the caret's position WITHIN its field, never from
  // its coordinates - coordinates are the very thing being tested against.
  genericCaretPos(this: CursorSmithPlugin, active: Element, doc: Document): string | null {
    try {
      const el = this._nodeKey(active);
      if (active.tagName === "TEXTAREA" || active.tagName === "INPUT") {
        // Form fields keep their caret in selectionStart, outside the DOM
        // Selection API entirely.
        const field = active as HTMLInputElement;
        return el + ":" + (field.selectionStart ?? 0) + ":" + (field.selectionEnd ?? 0);
      }
      const win = (doc && doc.defaultView) || window;
      const sel = win.getSelection();
      if (sel && sel.focusNode) {
        return el + ":" + this._nodeKey(sel.focusNode) + ":" + sel.focusOffset;
      }
      return el + ":0";
    } catch (e) {
      this._reportOnce("genericCaretPos", e);
      // null keeps the old behaviour (every shift treated as a move) rather
      // than risking a wrong match that would swallow a real caret move.
      return null;
    }
  },

  genericCaretCoords(this: CursorSmithPlugin): CaretRecord | null {
    try {
      // Note Editor Only. This function IS the interface caret: every surface
      // it serves - Command Palette, Quick Switcher, Search, Settings, modals,
      // the tab-title rename box - is by construction not the note editor,
      // because caretCoords() only reaches here when CodeMirror does not have
      // focus. So the whole option is one early return, and its other half -
      // leaving the native caret alone in those same places - falls out of
      // hideNativeActive() instead of being a second list to keep in step.
      if (this.settings.noteEditorOnly) return null;

      // Follow the canvas's document rather than hardcoding the main
      // window's - the canvas migrates to whichever window hosts the
      // active view, so this keeps interface carets working in pop-outs.
      const doc = this.canvas?.ownerDocument ?? document;
      const active = doc.activeElement;
      // See isTextCaretHost: this excludes checkboxes, radios, sliders, etc.
      // so the plugin doesn't draw a cursor on top of Obsidian's own toggle
      // controls when they gain focus (e.g. clicking a setting toggle box).
      if (!isTextCaretHost(active)) return null;

      // Plugins that draw their own caret onto a transformed surface. See
      // isExcalidrawCaretHost for why measuring one is not merely redundant
      // but actively wrong. Returning null here (rather than gating further
      // down) keeps the whole thing off the CodeMirror path, which never
      // reaches this function at all.
      if (this.isExcalidrawCaretHost(active)) return null;

      const c = this.selectionFallbackCoords(null);
      if (!c) return null;

      const win = doc.defaultView || window;

      // Sample the actual element under the caret rather than just the
      // editable container's own style, so syntax-highlighted text (e.g. in
      // other CodeMirror-based plugins like a CSS editor) reports its own
      // real color instead of one flat container color.
      const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
      const sampleY = (c.top + c.bottom) / 2;
      const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
      const styleSource = elAtCaret && active.contains?.(elAtCaret) ? elAtCaret : active;
      const style = win.getComputedStyle(styleSource);

      const fontSize = parseFloat(style.fontSize) || 14;
      const fontFamily = style.fontFamily || "inherit";
      const char = this.genericCaretChar(active);

      // Generic inputs aren't fixed-width like the note editor, so there's
      // no single "character width" to assume - measure the actual glyph
      // under the caret with a canvas (accurate for proportional fonts,
      // unlike a flat fontSize-based guess). Falls back to an estimate only
      // when there's no character to measure (end of text, blank line).
      const measured = char
        ? this.measureCharWidth(char, fontFamily, fontSize, style.fontWeight, style.fontStyle)
        : null;
      const charWidth = measured || Math.max(4, fontSize * 0.55);
      const height = Math.max(4, (c.bottom - c.top) || fontSize * 1.2);

      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.caretThickness();
      }

      return {
        x: c.left,
        top: c.top,
        bottom: c.top + height,
        h: height,
        w: finalWidth,
        actualCharWidth: charWidth,
        // No line-element geometry on this path (plain textarea /
        // contenteditable); null means "unknown", and Hot-head falls back to
        // burning around the caret without clamping.
        rowLeft: null, rowRight: null,
        char,
        textColor: style.color || "#ffffff",
        fontSize,
        fontFamily,
        fontWeight: style.fontWeight || "normal",
        fontStyle: style.fontStyle || "normal",
        // Generic inputs don't fold letter-spacing into the box width, so the
        // glyph is centered on its own advance directly.
        letterSpacing: 0,
        focused: true,
        // Logical identity of this caret, standing in for the document
        // position CodeMirror provides and a plain input doesn't.
        //
        // This used to be hardcoded null, which failed the `caret.pos !== null`
        // test in updateActivePoint and so disqualified every interface caret
        // from the scroll-shift path. Scrolling a Settings pane moves the
        // field on screen without moving the caret within it, but with no
        // identity to compare, each scrolled pixel looked like a genuine caret
        // move and went through commitMove() - pushing a trail point at every
        // step, which is why scrolling smeared a trail up and down the panel.
        // With a real identity, a pure scroll is recognised as one and the
        // cursor is translated instantly instead (no trail, no smear wiggle).
        pos: this.genericCaretPos(active, doc),
      };
    } catch (e) {
      this._reportOnce("genericCaretCoords", e);
      return null;
    }
  },

  // Measures the real rendered width of a single character in a given font,
  // used to size the Box/Underline cursor accurately for proportional
  // (non-monospace) fonts - a flat fontSize-based guess consistently under-
  // or over-shoots for anything but a true monospace font. Weight and style
  // matter: a bold glyph is meaningfully wider than its regular counterpart,
  // and measuring without them left the box visibly too narrow on bold or
  // italic text.
  // Build a canvas ctx.font string from resolved CSS font values. This lives
  // in ONE place on purpose: the character-in-box drift bug came from
  // drawBoxCursor building this string WITHOUT weight/style while
  // measureCharWidth built it WITH them - so the box was sized for a
  // bold/italic glyph and a regular upright one was drawn inside it. Every
  // site that measures OR draws a glyph must route through here so the two can
  // never diverge again.
  fontString(this: CursorSmithPlugin, fontSize: number, fontFamily: string, fontWeight: string, fontStyle: string) {
    const w = fontWeight && fontWeight !== "normal" ? fontWeight + " " : "";
    const s = fontStyle && fontStyle !== "normal" ? fontStyle + " " : "";
    return `${s}${w}${fontSize}px ${fontFamily}`;
  },

  measureCharWidth(this: CursorSmithPlugin, char: string, fontFamily: string, fontSize: number, fontWeight: string, fontStyle: string): number | null {
    try {
      // Detached, and in no particular window: a measuring context only
      // needs the fonts, which every window of the process shares.
      const ctx = this._measureCtx || (this._measureCtx = createEl("canvas").getContext("2d"));
      if (!ctx) return null;
      ctx.font = this.fontString(fontSize, fontFamily, fontWeight, fontStyle);
      const w = ctx.measureText(char).width;
      return w > 0 ? w : null;
    } catch {
      // No 2D context (the test harness, a headless window): the caller
      // falls back to the font-size estimate.
      return null;
    }
  },

  // The character sitting immediately after the caret, for elements outside
  // the note editor - mirrors what cmCaretCoords does for CodeMirror. Used
  // to draw the "letter inside the cursor" effect in non-editor fields too.
  genericCaretChar(this: CursorSmithPlugin, active: Element) {
    try {
      if (active.tagName === "INPUT" || active.tagName === "TEXTAREA") {
        const field = active as HTMLInputElement;
        const value = field.value != null ? String(field.value) : "";
        let selStart = value.length;
        try {
          const s = field.selectionStart, e = field.selectionEnd;
          if (typeof s === "number" && typeof e === "number") {
            selStart = field.selectionDirection === "backward" ? s : e;
          }
        } catch {
          /* input types without selectionStart support */
        }
        const ch = value.charAt(selStart);
        return ch && ch !== "\n" ? ch : "";
      }

      if ((active as HTMLElement).isContentEditable) {
        const doc = active.ownerDocument;
        const win = doc.defaultView || window;
        const sel = win.getSelection();
        if (sel && sel.focusNode && sel.focusNode.nodeType === 3) {
          const text = (sel.focusNode as CharacterData).data || "";
          const ch = text.charAt(sel.focusOffset);
          return ch && ch !== "\n" ? ch : "";
        }
      }
    } catch {
      /* fall through */
    }
    return "";
  },

  // The letter just typed, for the letter pop and for the box that WAITS at
  // the old spot through a Move delay - the spot the letter now occupies.
  // Once the box moves it sits past the letter and shows the character
  // under the caret (nothing at the end of a line), so nothing holds it
  // there. Only for an insertion at the caret - the document grew by
  // exactly the distance the caret moved: a keystroke, a paste - and null
  // for every other move. A click or an arrow, forward or back, shows the
  // character under the caret, or nothing on an empty line.
  //
  // It used to hold the character before ANY forward move (a click ahead
  // held whatever preceded the click, a space at a word's start included,
  // and popped a letter particle for it) and, for every other move, the
  // previous position's character - so a click from a word onto an empty
  // line showed the word's letter in the empty box.
  resolveHoldChar(this: CursorSmithPlugin, newCaret: CaretRecord): string | null {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      const last = this.lastActive;
      if (
        view && last &&
        typeof newCaret.pos === "number" && typeof last.pos === "number" &&
        typeof newCaret.docLen === "number" && typeof last.docLen === "number" &&
        newCaret.pos > last.pos &&
        newCaret.docLen - last.docLen === newCaret.pos - last.pos
      ) {
        // The last CHARACTER inserted, not the last code unit: an emoji is
        // two units or more, and the single unit before the caret was half
        // of one - it popped as a broken glyph (1.6.7).
        const justTyped = lastGrapheme(view.state.doc.sliceString(last.pos, newCaret.pos));
        if (justTyped && justTyped !== "\n") {
          // Both gates, in the same shape Thunderstrike and Fireworks use:
          // the group's master toggle, then the effect's own.
          if (this.look.popEffects && this.look.popLetters) {
            this.spawnLetterParticle(justTyped, last);
          }
          // Typewriter: the stroke starts now (typewriterPose), and the ink
          // stamp on the letter just typed, in its own cell.
          if (this.look.typewriter) {
            this._typewriterT = performance.now();
            if (this.look.typewriterInk) this.spawnInkStamp(justTyped, last);
          }
          return justTyped;
        }
      }
    } catch {
      /* fall through */
    }
    return null;
  },

  // True when `el` is Excalidraw's own text editor.
  //
  // Excalidraw edits text through a <textarea> absolutely positioned over its
  // canvas and CSS-transformed to match the shape - scaled with the zoom, and
  // rotated with the element. isTextCaretHost says yes to any <textarea>, so
  // that editor fell straight through to genericCaretCoords and we drew on it.
  //
  // Which cannot work, because formFieldCaretCoords measures the caret offset
  // in an offscreen mirror div that carries none of those transforms, then
  // adds getBoundingClientRect() as the origin. Untransformed offsets on a
  // transformed origin: near-enough on the first character, drifting further
  // with every one after it, and meaningless the moment the shape is rotated.
  //
  // Excalidraw draws its own caret anyway, so there is nothing here for us to
  // replace - we just get out of the way. See also the caret-color carve-out
  // in styles.css: suppressing our drawing is only half the
  // job, because our global hide-native rule would otherwise leave the
  // textarea with no visible caret at all.
  //
  // The DOM check is the load-bearing one, NOT the view-type check below it:
  // Excalidraw also renders through a markdown post-processor, so a drawing
  // embedded in a note lives inside a leaf whose view type is "markdown", and
  // a view-type test alone would miss every embed.
  isExcalidrawCaretHost(this: CursorSmithPlugin, el: Element) {
    if (!el) return false;
    try {
      // Cached against the focused element rather than on a timer: focus is
      // the only thing that can change the answer, which makes this exact and
      // free on every repeat frame. Same convention as _clipChainFor.
      if (this._excaliHostFor !== el) {
        this._excaliHostFor = el;
        this._excaliHostVal = !!(
          el.closest?.(".excalidraw, .excalidraw-wrapper, .excalidraw-view") ||
          el.classList?.contains("excalidraw-wysiwyg")
        );
      }
      if (this._excaliHostVal) return true;

      // Cheap belt-and-braces for a full Excalidraw leaf, in case a future
      // release renames the container classes out from under the selector.
      //
      // SCOPED TO THAT LEAF'S OWN CONTENT, and that scoping is the whole
      // point. This used to be a bare view-type test that never looked at
      // `el` at all, so while a drawing was the active tab EVERY text field
      // in the app answered yes: the rename dialog, the settings search, any
      // modal. Those are siblings of the workspace rather than part of the
      // drawing, so we declined to draw a caret in them AND the hide-native
      // rule still applied to them (the caret-color carve-out only reaches
      // Excalidraw's own textarea) - leaving them with no caret from either
      // source. Issues #26 and #27.
      //
      // contentEl and NOT containerEl, which is the follow-up on #26. A view's
      // containerEl is `.view-header` + `.view-content`, so a container-wide
      // test also claims the tab title bar - and `.view-header-title` is
      // permanently contentEditable on desktop, because clicking it is how you
      // rename the file from there. That is ordinary Obsidian chrome with an
      // ordinary caret, not the drawing, and the container scope swallowed it
      // exactly the way the bare view-type test swallowed the modals.
      //
      // Nothing is lost by narrowing: Excalidraw puts `.excalidraw-view` on
      // contentEl itself, so everything the container test would add below the
      // header is already caught by the DOM branch above.
      const view = this.app.workspace.getActiveViewOfType(View);
      if (view?.getViewType?.() !== "excalidraw") return false;
      if (view.contentEl) return view.contentEl.contains(el);
      // No contentEl - not an ItemView, so we cannot name the content box.
      // Fall back to the container minus the header, that being the only
      // caret-bearing chrome the container adds.
      return !!(
        view.containerEl &&
        view.containerEl.contains(el) &&
        !el.closest?.(".view-header")
      );
    } catch (e) {
      this._reportOnce("isExcalidrawCaretHost", e);
      return false;
    }
  },

  // Is the caret in the note editor itself, rather than somewhere else in the
  // app? This is the same question caretCoords() asks to choose between its
  // CodeMirror path and the generic interface one, asked of the same object -
  // and deliberately not a DOM or selector test.
  //
  // "Note Editor Only" has to stop drawing a caret and stop hiding the native
  // one in EXACTLY the same places, and the only way to guarantee two halves
  // agree is to derive both from one predicate. A selector-based version is
  // how issue #26 happened: we declined to draw in a field whose native caret
  // we were still hiding, and it had a caret from neither source.
  noteEditorFocused(this: CursorSmithPlugin) {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      return !!(view && this.editorFocused(view));
    } catch (e) {
      this._reportOnce("noteEditorFocused", e);
      // Unreachable in practice, but this feeds the hide-native class, so the
      // answer matters: "no" leaves the user with Obsidian's own caret, which
      // is the safe way to be wrong.
      return false;
    }
  },

  // True when the element is actually painted (not display:none, hidden,
  // or fully transparent). Used by _chromeInsets to decide whether the
  // STATUS BAR should clamp the overlay: an invisible-but-in-flow status
  // bar (zen-mode themes hide it via opacity so it can reveal on hover)
  // shouldn't leave a dead unshaded strip. Deliberately NOT used for the
  // titlebar - see _chromeInsets for why the titlebar clamps regardless
  // of visibility.
  _isVisiblyRendered(this: CursorSmithPlugin, el: Element) {
    if (!el) return false;
    const win = el.ownerDocument.defaultView || window;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) <= 0.01) return false;
    return true;
  },

  // Cached top/bottom insets around Obsidian's window chrome, refreshed at
  // most every 500ms (or on window resize via _bumpChromeInsets). Both tick
  // loops need these every frame; uncached, that's 2 querySelectors + 2
  // getBoundingClientRects + 2 getComputedStyles per frame per loop, which
  // is measurable jank on weak GPUs (ChromeOS Crostini) - and Chromium has
  // a known slow path where layout reads get more expensive whenever any
  // app-region: drag element exists in the document, which is always true
  // in frameless Obsidian.
  //
  // Titlebar: clamps whenever it occupies layout space, VISIBLE OR NOT.
  // Drag hit-testing doesn't care about visibility - an opacity-0 titlebar
  // (zen-mode themes) still owns the window's drag region, and covering it
  // breaks dragging just the same. Drag correctness beats the cosmetic
  // cost of a few undarkened pixels.
  //
  // Status bar: clamps only when visibly rendered. It has no drag role, so
  // for an invisible-but-in-flow status bar the clamp would just leave a
  // dead unshaded strip for no benefit (the concern _isVisiblyRendered was
  // originally written for).
  _chromeInsets(this: CursorSmithPlugin, doc: Document): ChromeInsets {
    // performance.now() like every other timestamp in this file. Both this and
    // its cache stamp were Date.now(), which was self-consistent but is a wall
    // clock: an NTP correction or a DST jump can move it backwards, and this
    // cache would then hold a stale inset for as long as the clock was behind.
    const now = performance.now();
    const c = this._chromeCache;
    if (c && c.doc === doc && now - c.t < 500) return c;

    let top = 0;
    const titleBar = doc.querySelector(".titlebar");
    // is-hidden-frameless: titlebar element exists but contains no visible
    // content (window controls hidden). The tab bar spacers are the drag
    // surface but they're visually transparent - we can paint over them
    // since our overlay has no app-region declaration and doesn't affect
    // Electron's drag hit-testing. Start from t:0 in this mode.
    // is-frameless (without is-hidden-frameless): custom titlebar IS visible,
    // clamp below it so we don't cover the window controls.
    const isHiddenFrameless = doc.body.classList.contains("is-hidden-frameless");
    if (titleBar && !isHiddenFrameless) {
      const tb = titleBar.getBoundingClientRect();
      if (tb.height > 0 && tb.top <= tb.height) top = Math.max(top, tb.bottom);
    }
    // When there's no titlebar at all (native frame style or non-Electron),
    // tab bars at t:0 are still the drag surface but again our overlay
    // doesn't affect app-region so no clamp needed there either.
    // Only clamp against tab bars when a VISIBLE titlebar pushes them down
    // and we need to cover the gap between titlebar bottom and tab bar bottom.

    // No bottom clamp for the status bar. It sits above our overlay via its
    // own stacking context (the overlay is z-index:10004 and the status bar
    // renders on top naturally). Clamping to sb.top was incorrectly cutting
    // the torch overlay short before the status bar, leaving the bottom of
    // the note unilluminated. The original file had no bottom clamp here.

    // Bottom inset: the height a visibly-rendered status bar occupies at the
    // window's bottom edge. This is deliberately NOT applied to the torch
    // overlay (z-10004) - that renders beneath the status bar and is meant to
    // reach the window bottom, which is the illumination regression the note
    // above is about. It is applied only to the cursor CANVAS (z-10006), which
    // would otherwise paint over the status bar (worst while scrolling, when
    // the pane's own bottom briefly reaches the window edge). An
    // invisible-but-in-flow status bar is skipped, same as the top clamp.
    let bottomInset = 0;
    let statusLeft = 0, statusRight = 0;
    const statusBar = doc.querySelector<HTMLElement>(".status-bar");
    if (statusBar && this._isVisiblyRendered(statusBar)) {
      const sb = statusBar.getBoundingClientRect();
      const win = doc.defaultView || window;
      // Only when it's actually parked at the window's bottom edge, so a
      // mispositioned or stale-rect bar can't pull the clip up over content.
      if (sb.height > 0 && sb.bottom >= win.innerHeight - 1) {
        bottomInset = Math.max(0, win.innerHeight - sb.top);
        // Its horizontal extent too: a floating status bar is usually a
        // pill at the bottom right, and the clip has to spare only THAT,
        // not the whole bottom band (see wrapperClipForStatusBar).
        statusLeft = sb.left;
        statusRight = sb.right;
      }
    }

    // The covers (CARET_COVERS): a visibly rendered element at least 40% of
    // the window wide, in the upper half of the window, moves the canvas's
    // top down to its bottom edge; in the lower half, the canvas's bottom
    // up to its top edge. Word-Smith's two letterbox masks and its status
    // bar are the three there are today; the read is cheap and cached with
    // the rest of this.
    let coverTop = 0;
    let coverBottom = Number.POSITIVE_INFINITY;
    const win2 = doc.defaultView || window;
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(CARET_COVERS))) {
      if (!this._isVisiblyRendered(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width < win2.innerWidth * 0.4) continue;
      if (r.top + r.height / 2 < win2.innerHeight / 2) coverTop = Math.max(coverTop, r.bottom);
      else coverBottom = Math.min(coverBottom, r.top);
    }

    this._chromeCache = { doc, t: now, top, bottomInset, statusLeft, statusRight, coverTop, coverBottom };
    return this._chromeCache;
  },

  // Full-window rect minus the window chrome. Never returns a rect that
  // overlaps the titlebar: a full-viewport fixed-position layer sitting
  // over the titlebar - even one with pointer-events: none - breaks
  // Electron's native window-drag hit-testing on frameless/custom-titlebar
  // windows (Electron composes drag regions in DOM order; z-index and
  // pointer-events don't participate). Seen in the wild on Linux X11 (KDE)
  // and ChromeOS Crostini: window resizes fine, refuses to move.
  // Note: when Obsidian runs with the NATIVE frame there's no .titlebar in
  // the DOM at all - and none is needed, because the OS titlebar lives
  // outside the web contents where nothing we render can cover it. The
  // zero inset we compute in that case is correct, not a missed clamp.
  getFullViewportRect(this: CursorSmithPlugin, doc: Document) {
    const win = doc.defaultView || window;
    const { top } = this._chromeInsets(doc);
    const bottom = win.innerHeight; // no bottom clamp - status bar stacks above us
    if (bottom <= top) {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    }
    return {
      top,
      bottom,
      left: 0,
      right: win.innerWidth,
      width: win.innerWidth,
      height: bottom - top,
    };
  },

  // Clip rect for a caret that isn't in the note editor: the Settings tab's
  // scroll frame, a modal body, the file tree, and so on. Returns the
  // intersection of every clipping ancestor of the focused field, or null when
  // it has none (then the caller falls back to the viewport, as before).
  //
  // The editor path clips the canvas to the pane so the cursor physically
  // cannot paint outside it; this path had no equivalent and handed back the
  // whole viewport, so a caret in a Settings text box was free to paint
  // anywhere. It only showed up while scrolling, because getBoundingClientRect
  // keeps reporting a position for an input that has scrolled out of its own
  // scroll container - the DOM clips the element, the geometry doesn't - so
  // the cursor was still drawn at that position: outside the settings frame,
  // over the main window, and over the titlebar.
  getCaretClipRect(this: CursorSmithPlugin, doc: Document): Box | null {
    const active = doc && doc.activeElement;
    if (!active || active === doc.body) return null;

    // Resolving the chain costs a getComputedStyle per ancestor, so it's
    // cached against the focused element - the chain only changes when focus
    // does, but the RECTS have to be re-read every frame because scrolling is
    // exactly what moves them.
    if (this._clipChainFor !== active) {
      this._clipChainFor = active;
      this._clipChain = this._resolveClipChain(active as HTMLElement);
    }
    const chain = this._clipChain;
    if (!chain || !chain.length) return null;

    const win = doc.defaultView || window;
    const { top: chromeTop } = this._chromeInsets(doc);
    let top = chromeTop, left = 0;
    let bottom = win.innerHeight, right = win.innerWidth;

    for (const el of chain) {
      // Focus moved on and the old chain is stale (settings closed, modal
      // torn down). Drop the cache and let the viewport fallback apply until
      // the next frame resolves a fresh chain.
      if (!el.isConnected) {
        this._clipChainFor = null;
        return null;
      }
      const b = el.getBoundingClientRect();
      if (b.top > top) top = b.top;
      if (b.left > left) left = b.left;
      if (b.bottom < bottom) bottom = b.bottom;
      if (b.right < right) right = b.right;
    }

    if (bottom <= top || right <= left) return null;
    return { top, bottom, left, right, width: right - left, height: bottom - top };
  },

  // Every ancestor of `el` that actually clips it, nearest first. Walking
  // stops short of <body>/<html>: those are covered by the viewport clamp in
  // getCaretClipRect, and their rects can legitimately exceed the viewport.
  //
  // "Actually clips" is not the same as "has overflow" - CSS positioning lets
  // an element escape its ancestors' overflow, and getting that wrong here
  // means clipping a cursor away to nothing, which is a worse bug than the one
  // this whole path exists to fix. So: a fixed-positioned element is clipped
  // by nothing above it, and an absolutely-positioned one is only clipped by
  // ancestors that are themselves positioned (its containing block and up).
  // Popovers, suggestion dropdowns and tooltips all rely on exactly this.
  _resolveClipChain(this: CursorSmithPlugin, el: HTMLElement): Element[] {
    const chain: Element[] = [];
    try {
      const doc = el.ownerDocument;
      const win = doc.defaultView || window;
      let curPos = win.getComputedStyle(el).position;
      if (curPos === "fixed") return chain;

      let node = el.parentElement;
      let guard = 0;
      while (node && node !== doc.body && node !== doc.documentElement && guard++ < 24) {
        const st = win.getComputedStyle(node);
        const positioned = st.position !== "static";
        const clips = st.overflowX !== "visible" || st.overflowY !== "visible";
        // An absolute box ignores clipping by anything that isn't at least
        // its containing block.
        if (clips && (curPos !== "absolute" || positioned)) chain.push(node);
        if (positioned) {
          if (st.position === "fixed") break;
          curPos = st.position;
        }
        node = node.parentElement;
      }
    } catch (e) {
      // No chain means the viewport clip, which is the safe way to be wrong.
      this._reportOnce("_resolveClipChain", e);
      return [];
    }
    return chain;
  },

  getPaneRect(this: CursorSmithPlugin, view: EditorView | null | undefined): Box | null {
    if (!view) return null;
    // Called twice a frame (the clip window and the caret's out-of-view
    // test); a getBoundingClientRect each time. Cached on the layout
    // generation and a short TTL, like the caret geometry: the pane does not
    // move on an inner scroll, and everything that does move it bumps the
    // generation.
    const now = performance.now();
    const pc = this._paneRectCache;
    if (pc && pc.view === view && pc.gen === (this._layoutGen | 0) && (now - pc.t) < GEOMETRY_TTL_MS) return pc.rect;
    const rootEl = view.dom.closest(".cm-editor") || view.dom.closest(".workspace-leaf");
    if (!rootEl) return null;
    const rect = rootEl.getBoundingClientRect();
    const out = this._paneRectFrom(rect, rootEl);
    this._paneRectCache = { view, gen: this._layoutGen | 0, t: now, rect: out };
    return out;
  },

  // The workspace's main area: the root split, which is every tab group
  // and nothing of the docks, the ribbon or the status bar - the torch
  // overlay's box with "Keep sidebars lit" on - and, within it, the NOTE
  // TABS: the rectangle of each tab group whose front tab is a note (a
  // markdown view; Obsidian hides the group's other tabs with an inline
  // display: none). Those are what the torch darkens: not the active
  // editor's pane (one lit tab beside a dark one undid the effect, and the
  // pane changed with focus), and not the views beside the notes either
  // (Word-Smith's History, Export and Organizer, a graph, an empty tab -
  // "not ok" dark). Both clamped below a visible titlebar like the pane.
  // The rect is null where there is no root split and no workspace (the
  // torch then dims the window). Cached like the pane, on the layout
  // generation and the geometry TTL.
  _mainArea(this: CursorSmithPlugin, doc: Document): MainRectCache {
    const now = performance.now();
    const mc = this._mainRectCache;
    if (mc && mc.doc === doc && mc.gen === (this._layoutGen | 0) && (now - mc.t) < GEOMETRY_TTL_MS) return mc;
    const rootEl = doc.querySelector(".workspace-split.mod-root") || doc.querySelector(".workspace");
    const box = rootEl ? this._paneRectFrom(rootEl.getBoundingClientRect(), rootEl) : null;
    const rect = box && box.width > 0 && box.height > 0 ? box : null;
    const notes: Box[] = [];
    if (rootEl) {
      for (const group of Array.from(rootEl.querySelectorAll(".workspace-tabs"))) {
        let front: Element | null = null;
        for (const leaf of Array.from(group.querySelectorAll(":scope > .workspace-tab-container > .workspace-leaf"))) {
          if ((leaf as HTMLElement).style.display !== "none") { front = leaf; break; }
        }
        const content = front && front.querySelector(":scope > .workspace-leaf-content");
        if (!content || content.getAttribute("data-type") !== "markdown") continue;
        const b = this._paneRectFrom(group.getBoundingClientRect(), group);
        if (b && b.width > 0 && b.height > 0) notes.push(b);
      }
    }
    this._mainRectCache = { doc, gen: this._layoutGen | 0, t: now, rect, notes };
    return this._mainRectCache;
  },

  getMainAreaRect(this: CursorSmithPlugin, doc: Document): Box | null {
    return this._mainArea(doc).rect;
  },

  // The note tabs' rectangles (client coordinates); empty when no note is
  // in front anywhere in the main area.
  getNoteTabRects(this: CursorSmithPlugin, doc: Document): Box[] {
    return this._mainArea(doc).notes;
  },

  _paneRectFrom(this: CursorSmithPlugin, rect: DOMRect, rootEl: Element): Box | null {

    // Clipping to the pane's own rect assumes the titlebar/status bar take
    // up real space in flow, pushing the pane to stop short of them. Some
    // themes float those bars over the pane instead (fixed/absolute), so
    // the pane's rect extends underneath - and our z-index 10006 canvas
    // would paint over them, with the same drag-breaking consequence as
    // the full-viewport case for the titlebar. Clamp against the cached
    // chrome insets (cheap - no extra layout reads per frame).
    const doc = rootEl.ownerDocument;
    const { top: chromeTop } = this._chromeInsets(doc);
    const top = Math.max(rect.top, chromeTop);
    const bottom = rect.bottom; // no bottom clamp - status bar stacks above us

    if (bottom <= top) return rect;

    return {
      top,
      bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: bottom - top,
    };
  },

  getActiveRect(this: CursorSmithPlugin) {
    const active = this.animActive;
    if (!active) return null;
    if (this.styleFor("cursorStyle") === "Underline") {
      // Must use the same thickness the painter does. This is the rect the
      // smear spring chases, and fillCursorShape draws the smear quad INSTEAD
      // of the rect it's handed whenever smear is on - so a thickness computed
      // independently here doesn't just desync the spring, it silently becomes
      // the thickness that actually gets painted, and the slider stops doing
      // anything at all with Motion Smear enabled.
      const uThickness = this.underlineThickness(active.h);
      return { x: active.x, y: active.top + active.h - uThickness, w: active.actualCharWidth, h: uThickness };
    }
    if (this.styleFor("cursorStyle") === "Line") {
      // The same span the painter uses: this is the rect the smear chases,
      // and with the smear on it is what gets painted (see Underline above).
      const span = this.lineSpan(active.top, active.h);
      return { x: active.x, y: span.top, w: this.renderWidth(active), h: span.h };
    }
    return { x: active.x, y: active.top, w: this.renderWidth(active), h: active.h };
  },

  // The Line cursor's vertical extent in a line box (top, h): Cursor height
  // (caretHeightPct) of it, centred on the line - "the cursor height, which
  // matches the height of the line itself exactly, is a bit too large for
  // me" (issue #33, as VS Code allows). 100 is the whole line, as always.
  // One helper for the painter, the serifs, the smear's rect and the trail
  // ghosts, so the parts of the caret agree.
  lineSpan(this: CursorSmithPlugin, top: number, h: number): { top: number; h: number } {
    const pct = Math.max(20, Math.min(100, Number(this.styleFor("caretHeightPct") ?? 100) || 100)) / 100;
    if (pct >= 1) return { top, h };
    const hh = h * pct;
    return { top: top + (h - hh) / 2, h: hh };
  },

  renderWidth(this: CursorSmithPlugin, active: CaretRecord): number {
    return active.w;
  },

  // A Typewriter slider's value: the look's, or the default, held in the
  // slider's own range so a hand-edited file cannot throw the caret about.
  twOpt(this: CursorSmithPlugin, key: keyof Look, lo: number, hi: number): number {
    const v = Number(this.look[key] ?? DEFAULT_SETTINGS[key]);
    const d = Number(DEFAULT_SETTINGS[key]);
    return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : d));
  },

  // Typewriter: where the caret is drawn at `now` - dx, dy in px and sy,
  // its height as a share, squashed about its bottom edge. Typewriter alone
  // moves nothing (it was a small dip until the user's word: "the spring
  // action should be set only with Springy strike"). Springy strike dips it
  // on a damped spring that rises past rest before it settles, squashed at
  // the bottom and stretched a little on the rebound (Depth, Bounce, Squash,
  // Duration); Carriage advance carries it forward past its new spot and
  // back (Distance, Duration). At rest: 0, 0, 1.
  typewriterPose(this: CursorSmithPlugin, now: number): TypewriterPose {
    const rest = { dx: 0, dy: 0, sy: 1 };
    if (!this.look.typewriter) return rest;
    const a = this.animActive;
    const dt = now - (this._typewriterT || 0);
    if (!a || !this._typewriterT || dt < 0) return rest;
    const lh = a.h || 20;
    const pose = { dx: 0, dy: 0, sy: 1 };
    if (this.look.typewriterSpring) {
      const ms = this.twOpt("typewriterStrikeMs", 80, 1000);
      if (dt < ms) {
        const u = dt / ms;
        let sh;
        if (u < TW_SPRING_DOWN) sh = 1 - Math.pow(1 - u / TW_SPRING_DOWN, 2);
        else {
          const v = (u - TW_SPRING_DOWN) / (1 - TW_SPRING_DOWN);
          sh = Math.cos(v * Math.PI * 1.5) * Math.pow(1 - v, 1.2);
          // Past rest (the negative lobe): Bounce scales it, 0 none.
          if (sh < 0) sh *= this.twOpt("typewriterBounce", 0, 3);
        }
        pose.dy = sh * (this.twOpt("typewriterDepth", 0, 60) / 100) * lh;
        const squash = this.twOpt("typewriterSquash", 0, 60) / 100;
        pose.sy = sh > 0 ? 1 - squash * sh : 1 + squash * 1.8 * -sh;
      }
    }
    if (this.look.typewriterAdvance) {
      const ms = this.twOpt("typewriterAdvanceMs", 40, 1000);
      if (dt < ms) {
        const u = dt / ms;
        // sin(pi u)(1-u) peaks at 0.5796 (u = 0.35): scaled so the peak is the reach.
        pose.dx = (Math.sin(Math.PI * u) * (1 - u) / 0.5796) * this.twOpt("typewriterAdvanceCw", 0, 3) * (a.actualCharWidth || a.w || 8);
      }
    }
    return pose;
  },

  // The Line cursor's thickness, in px: the setting, in 0.1 px steps since
  // 1.6.6 (issue #32), held between 0.5 and CARET_THICKNESS_MAX - a value
  // saved before the cap came down from 12 draws at the cap.
  caretThickness(this: CursorSmithPlugin): number {
    const v = Number(this.styleFor("caretWidthPx"));
    return Number.isFinite(v) && v > 0 ? Math.max(0.5, Math.min(CARET_THICKNESS_MAX, v)) : 2;
  },

  // Thickness of the Underline cursor's bar, in px.
  //
  // 0 (the default) means "auto": 15% of the line height, which is exactly
  // what this style did before the setting existed - so an existing setup, and
  // any Vim mode that never overrode the key, keeps the look it already had.
  // Anything else is a literal pixel thickness, clamped to the line height so
  // a large value on a small font degrades to a filled block rather than
  // painting outside the line. Fractional since 1.6.6, like the Line's (the
  // slider steps by 0.1 px; it was rounded to whole pixels here), and never
  // above CARET_THICKNESS_MAX.
  underlineThickness(this: CursorSmithPlugin, lineHeight: number): number {
    const h = Math.max(1, Math.round(lineHeight || 0));
    const px = this.look.underlineWidthPx || 0;
    if (px > 0) return Math.max(0.5, Math.min(px, CARET_THICKNESS_MAX, h));
    return Math.max(2, Math.round(h * 0.15));
  },
};
export type MeasureMethods = typeof measureMethods;
