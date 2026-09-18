// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The other carets: the plain 2px line past SECONDARY_FULL_MAX, and the
// full-effect secondaries painted with the primary's own painters, each
// with its state swapped in.

import { hexToRgbTuple, hexToRgba } from "./color";
import type { Bounds } from "./types";
import type CursorSmithPlugin from "./plugin";

export const paintSecondariesMethods = {
  // The plain fallback: a solid 2px vertical line for every non-primary caret
  // PAST SECONDARY_FULL_MAX. The first SECONDARY_FULL_MAX get the primary's
  // whole pipeline instead (drawFullSecondaries); this is what the rest
  // are, and what every secondary was before that. Blinks in sync with the
  // main cursor so all carets fade together.
  //
  // Colour follows the primary cursor, including its Gradient: with Gradient
  // on, each secondary caret gets the whole ramp down its own height, the same
  // way cursorPaint() paints the primary one. It used to take getActiveColor()
  // in every case, which for a gradient cursor is the ramp's FIRST STOP - so a
  // multi-cursor edit put one caret in full colour and the rest in a flat slice
  // of it, which reads as the extra carets being a different, wrong colour.
  //
  // The ramp is resolved ONCE per frame, not once per caret. A CanvasGradient
  // is tied to absolute canvas coordinates, so each caret does need its own
  // object - but the expensive part (walking the stops, applying Speed Demon's
  // heat, building an rgba() string per stop) does not depend on position, and
  // multi-cursor edits are exactly where the caret count can run into the
  // hundreds. Same reasoning as the firework sparks' baked palette.
  drawSecondaryCarets(this: CursorSmithPlugin) {
    const carets = this.secondaryCarets;
    if (!carets || carets.length === 0) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const alpha = this.blinkAlpha(performance.now()) * opacity;
    if (alpha <= 0.01) return;
    const strokeAlpha = 0.9 * alpha;

    // Exactly one of these is used, decided once for the whole frame.
    let ramp = null;
    if (this.look.gradientEnabled) {
      ramp = this.gradientStops().map((hex) => {
        const [r, g, b] = hexToRgbTuple(hex);
        return `rgba(${r}, ${g}, ${b}, ${strokeAlpha})`;
      });
    }

    ctx.save();
    ctx.lineWidth = 2;
    // A secondary caret is a stroked segment rather than a filled shape, so
    // its "corners" are line caps. A round cap extends the stroke by half the
    // line width past each endpoint; at lineWidth 2 that is 1px each way,
    // inside the 2px padding _markDirty already allows below.
    ctx.lineCap = this.styleFor("cursorRounded") ? "round" : "butt";
    if (!ramp) ctx.strokeStyle = hexToRgba(this.getActiveColor(), strokeAlpha);
    for (const c of carets) {
      // 0.5-pixel offset so a 2px stroke lands on whole pixels rather than
      // straddling a boundary and antialiasing to a blurry 3px stripe.
      const x = Math.round(c.x) + 0.5;
      const h = c.bottom - c.top;
      if (ramp) {
        // A zero-length gradient line paints nothing at all (canvas spec), so
        // a caret with no measured height falls back to a flat first stop
        // rather than silently vanishing.
        if (h > 0) {
          const grad = ctx.createLinearGradient(x, c.top, x, c.bottom);
          for (let i = 0; i < ramp.length; i++) {
            grad.addColorStop(i / (ramp.length - 1), ramp[i]);
          }
          ctx.strokeStyle = grad;
        } else {
          ctx.strokeStyle = ramp[0];
        }
      }
      this._markDirty(x - 3, c.top - 2, 6, h + 4);
      ctx.beginPath();
      ctx.moveTo(x, c.top);
      ctx.lineTo(x, c.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },

  // Draw every full-effect secondary with the primary's own painters, and
  // return each one's damage bounds for draw() to mark after its snapshot
  // (see the note on _dirtyRaw there: a cursor's own bounds must not be in
  // the effects-only union).
  drawFullSecondaries(this: CursorSmithPlugin) {
    const states = this._secondaries;
    const bounds: Bounds[] = [];
    if (!states || states.length === 0) return bounds;
    const ctx = this.ctx;
    if (!ctx) return bounds;
    const style = this.styleFor("cursorStyle");
    for (const st of states) {
      if (!st.animActive) continue;
      this._withCaret(st, () => {
        const a = this.animActive;
        if (!a) return;
        const cb = this._cursorBounds();
        if (cb) bounds.push(cb);
        // Breathing, as in draw(): a transform round the whole caret draw.
        const breath = this.breathScale(performance.now());
        const breathing = breath < 0.999;
        if (breathing) {
          const cx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
          const cy = a.top + (a.h || 0) / 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(breath, breath);
          ctx.translate(-cx, -cy);
        }
        switch (style) {
          case "Line": this.drawGenericCaret(false); break;
          case "Underline": this.drawGenericCaret(true); break;
          case "Box": this.drawBoxCursor(); break;
        }
        if (breathing) ctx.restore();
      });
    }
    return bounds;
  },
};
