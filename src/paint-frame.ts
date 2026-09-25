// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The frame: the cursor's damage bounds, draw() in the order the layers
// stack, and the wrapper's blend.

import { DIRTY_RECT_CLEAR, SERIF_MAX_SPAN_RATIO, SERIF_MIN_SPAN_PX } from "./constants";
import type { Bounds, QuadKey } from "./types";
import type CursorSmithPlugin from "./plugin";

export const paintFrameMethods = {
  // The cursor's own damage bounds, in client coordinates: the interpolated
  // caret, the entire smear quad (which overshoots well past the caret on a
  // fast move), any held character and the serifs, padded for glow
  // (shadowBlur maxes at 10), outline width, antialiasing and a Signal Glitch
  // throw. Marked dirty once from draw() rather than threaded through every
  // branch of drawBoxCursor/drawGenericCaret - and read by _frameNeed to place
  // the canvas, so the region and the damage rect cannot disagree.
  // Null when there is no caret.
  _cursorBounds(this: CursorSmithPlugin): Bounds | null {
    const a = this.animActive;
    if (!a) return null;
    let x0 = a.x, y0 = a.top;
    let x1 = a.x + Math.max(a.w || 0, a.actualCharWidth || 0);
    let y1 = a.top + (a.h || 0);
    // Bound BOTH the raw spring quad and the tapered shape actually painted.
    // The taper usually pulls corners inward, but it works by preserving each
    // corner's distance ALONG the travel line while pulling it toward that
    // line - and on a fast diagonal jump that can nudge a corner slightly
    // PAST the raw quad's axis-aligned bounds (shrinking one axis grows the
    // other). Marking only the raw quad then under-reports by a sliver, which
    // never gets cleared: the tapered-tail artifact. smearShape is usually
    // the same object as smearQuad (taper off or below threshold), so the
    // second pass is a cheap no-op then.
    for (const src of [this.smearQuad, this.smearShape]) {
      if (!src) continue;
      for (const k of Object.keys(src) as QuadKey[]) {
        if (src[k].x < x0) x0 = src[k].x;
        if (src[k].y < y0) y0 = src[k].y;
        if (src[k].x > x1) x1 = src[k].x;
        if (src[k].y > y1) y1 = src[k].y;
      }
    }
    // Serifs reach out to either side of the stem, and the left one reaches
    // OUTSIDE the caret's own x. The base pad below covers that at ordinary
    // font sizes, but the span follows the character width, so a large
    // heading can push the outer edge past it - and anything painted
    // outside the damage rect is never cleared. Widen explicitly instead of
    // relying on the pad happening to be enough.
    if (this.styleFor("cursorStyle") === "Line" && this.look.lineSerifs) {
      const halfSpan = Math.max(
        SERIF_MIN_SPAN_PX,
        Math.min(a.actualCharWidth || 0, (a.h || 0) * SERIF_MAX_SPAN_RATIO),
      ) / 2;
      const cx = a.x + (a.w || 0) / 2;
      if (cx - halfSpan < x0) x0 = cx - halfSpan;
      if (cx + halfSpan > x1) x1 = cx + halfSpan;
    }
    let pad = 24 + Math.max(0, this.look.caretWidthPx || 0);
    // The CRT glow's blur grows with Speed Demon's heat (glowHeatScale), and
    // a shadow spreads roughly its blur radius. 24 comfortably covers the
    // base blur of 8-10; at full heat that becomes ~26 and would paint
    // outside the rect this frame clears, leaving a halo smeared across the
    // pane. Scale the pad by the same factor rather than picking a fixed
    // worst case, so an idle cursor still clears the small rect.
    if (this.look.crtEffect && this.look.glow) {
      pad += 10 * (this.glowHeatScale() - 1);
    }
    // A Signal Glitch throws slices far outside the caret box, and anything
    // painted outside the damage rect is never cleared - it would leave
    // permanent debris on the canvas. Widen the rect to cover the worst-case
    // throw for the current settings rather than the average one: the
    // envelope decays, so a rect sized for "typical" would under-report on
    // exactly the first and most violent frames.
    if (this.glitch) {
      const st = Math.max(0, Math.min(2.5, this.look.crtGlitchStrength ?? 1));
      const abr = Math.max(0, Math.min(3, this.look.crtGlitchAberration ?? 1));
      // 14 * strength * reach(<=2.2) is the slice throw; the width stretch
      // adds up to ~28% of the caret width per side; then the channel split.
      pad += 14 * st * 2.2 + 3.2 * abr + (a.w || 0) * 0.3 + 4;
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  },

  draw(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx) return;
    // The surface is the region, not the window (issue #30): clears and the
    // clamp on the damage rect are both against it.
    const r = this._canvasRect;
    if (!r) return;
    const rx0 = r.x, ry0 = r.y, rx1 = r.x + r.w, ry1 = r.y + r.h;

    if (!DIRTY_RECT_CLEAR || this._dirtyFull) {
      ctx.clearRect(rx0, ry0, r.w, r.h);
      this._dirtyFull = false;
    } else if (this._dirtyPrev) {
      const p = this._dirtyPrev;
      ctx.clearRect(p.x, p.y, p.w, p.h);
    }
    // A null _dirtyPrev means last frame painted nothing, so the surface is
    // already clean and needs no clear at all.
    this._dirty = null;

    this.drawLettersParticles();
    this.drawCarriageReturns();
    // Underneath everything else: it's a background guide, and the cursor and
    // its motes should read as sitting on top of it.
    this.drawBracketTether();
    // Behind the flame pixels and the cursor: motes are ambient background,
    // and a mote crossing the caret shouldn't paint over it.
    this.drawStardust();
    this.drawFlamePixels();
    // The fire sits behind the caret so the caret reads as the thing that is
    // burning rather than a shape floating in front of a fire.
    this.drawHotHead();
    // Behind the cursor, like every other effect here: the bolt lands ON the
    // caret, and the caret should be the thing you see it hit.
    this.drawThunderbolts();
    // Behind the cursor for the same reason, and after the bolt: a shell
    // launched by the same Enter that called down lightning should climb out
    // in front of it rather than being swallowed by the strike.
    this.drawFireworks();

    // Cursor bounds are marked once, at the END of the frame rather than
    // here, so the effects-only union can be snapshotted first - see the
    // note on _dirtyRaw below. Computed here, before anything cursor-shaped
    // paints, exactly as it always was.
    const a = this.animActive;
    const cb = this._cursorBounds();

    // Breathing is applied as a transform around the whole cursor draw rather
    // than by shrinking the rect each painter is handed. Two reasons: with
    // Motion Smear on, fillCursorShape ignores that rect entirely and draws the
    // spring's quad instead, so a shrunken rect would silently do nothing; and
    // scaling here catches the glow, the outline and the held character in one
    // go, so the caret breathes as one object instead of coming apart.
    //
    // Note it does NOT touch getActiveRect(), which is what the smear spring
    // chases. Breathing the spring's target would mean the spring never
    // settles, and `_smearMoving` would hold the hot gear for as long as the
    // caret blinked.
    const breath = a ? this.breathScale(performance.now()) : 1;
    const breathing = breath < 0.999;
    if (breathing && a) {
      const cx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
      const cy = a.top + (a.h || 0) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breath, breath);
      ctx.translate(-cx, -cy);
    }
    // Typewriter: the caret dips with each character typed and springs back
    // (typewriterPose) - shifted and squashed as a whole, like breathing,
    // and the damage rect follows it.
    const pose = a ? this.typewriterPose(performance.now()) : null;
    const dipping = !!pose && !!a && (Math.abs(pose.dx) > 0.01 || Math.abs(pose.dy) > 0.01 || Math.abs(pose.sy - 1) > 0.001);
    if (dipping && pose && a) {
      ctx.save();
      ctx.translate(pose.dx, pose.dy);
      if (Math.abs(pose.sy - 1) > 0.001) {
        const bx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
        const by = a.top + (a.h || 0);
        ctx.translate(bx, by);
        ctx.scale(1, pose.sy);
        ctx.translate(-bx, -by);
      }
      if (cb) {
        cb.x0 += Math.min(0, pose.dx);
        cb.x1 += Math.max(0, pose.dx);
        cb.y0 += Math.min(0, pose.dy) - (a.h || 0) * Math.max(0, pose.sy - 1);
        cb.y1 += Math.max(0, pose.dy);
      }
    }
    // Before the dispatch, not inside the Box branch: this both sets the
    // blend for a highlighter-translucent box AND clears it for every other
    // style, and the other styles don't call drawBoxCursor.
    this.applyCanvasBlend();
    switch (this.styleFor("cursorStyle")) {
      case "Line":
        this.drawGenericCaret(false);
        break;
      case "Underline":
        this.drawGenericCaret(true);
        break;
      case "Box":
        this.drawBoxCursor();
        break;
    }
    if (dipping) ctx.restore();
    if (breathing) ctx.restore();

    // Multi-cursor. The full-effect secondaries are painted with the very
    // same painters as the primary, each with its own state swapped in; the
    // carets past SECONDARY_FULL_MAX are the plain 2px line. Both sit on top
    // of the primary's trail and particles.
    const secBounds = this.drawFullSecondaries();
    this.drawSecondaryCarets();

    // The UNCLAMPED union of everything EXCEPT the cursor, kept for
    // _frameNeed to place the canvas next frame: particles, embers, motes,
    // trail ghosts, secondaries - whatever was painted somewhere this frame
    // will be painted near there next frame, and a painter that reached past
    // the region is exactly what the region has to grow to include. The
    // cursor is left out on purpose. Its NEXT position is known before the
    // draw (_cursorBounds), and its last one needs no coverage: a re-anchor
    // blanks the surface, and inside the region _dirtyPrev clears it. With
    // the cursor in here a caret jump dragged its old position into the
    // need, and the region grew to span the jump instead of sliding.
    const e = this._dirty as Bounds | null;
    this._dirtyRaw = e ? { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 } : null;
    // Now the cursor, for the clear: see _cursorBounds for what it spans.
    // The full-effect secondaries are cursors too, and out of _dirtyRaw for
    // the same reason.
    if (cb) this._markDirty(cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0);
    for (const b of secBounds) this._markDirty(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);

    // Freeze this frame's union for the next frame to clear, clamped to the
    // surface so an off-screen particle can't inflate the cleared region.
    const d = this._dirty as Bounds | null;
    if (!d) {
      this._dirtyPrev = null;
      return;
    }
    const cx0 = Math.max(rx0, Math.floor(d.x0) - 2);
    const cy0 = Math.max(ry0, Math.floor(d.y0) - 2);
    const cx1 = Math.min(rx1, Math.ceil(d.x1) + 2);
    const cy1 = Math.min(ry1, Math.ceil(d.y1) + 2);
    this._dirtyPrev =
      cx1 > cx0 && cy1 > cy0 ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null;
  },

  // Puts the canvas layer into (or back out of) a blend mode, which is what
  // cursorTranslucent actually is.
  //
  // This CANNOT be done with ctx.globalCompositeOperation. The cursor canvas
  // is its own layer stacked over the editor, so a canvas-level "multiply"
  // blends against what this canvas has already painted this frame - nothing,
  // it was just cleared - not against the text underneath. Real backdrop
  // blending has to come from CSS.
  //
  // And it has to go on the WRAPPER, not the canvas. The wrapper is
  // position:fixed with a z-index, which makes it a stacking context, and a
  // stacking context confines its descendants' blending to itself: a
  // mix-blend-mode on the canvas inside would blend against the wrapper's own
  // empty background and produce no visible change at all. On the wrapper the
  // blend applies to the whole group against its parent's content - i.e. the
  // editor. (Which also means an `isolation: isolate` anywhere between the
  // wrapper and .app-container would silently turn this feature off. Don't
  // add one, in either file.)
  //
  // Multiply darkens and screen lightens, so which of the two reads as ink on
  // the page depends on what's behind it: multiply on a light theme, screen
  // on a dark one. Picking by theme keeps the cursor legible in both instead
  // of sinking into the background in one of them.
  //
  // Called from the draw dispatch, before the per-style branch, so it runs on
  // every frame regardless of style - including the frames that have to CLEAR
  // it. Writes only on change: a blend-mode style write forces the compositor
  // to re-evaluate the layer, so doing it per frame would cost real work to
  // set the value it already had.
  applyCanvasBlend(this: CursorSmithPlugin) {
    const el = this.canvasWrapper;
    if (!el) return;
    const want = this.styleFor("cursorTranslucent")
      ? (this.isDarkTheme() ? "screen" : "multiply")
      : "normal";
    if (this._canvasBlend === want) return;
    this._canvasBlend = want;
    el.style.mixBlendMode = want;
  },
};
