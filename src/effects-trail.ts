// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The CRT trail's bookkeeping (the ghosts the caret leaves, pruned by age,
// painted flat or as a neon tube) and Speed demon's sparks.

import { hexToRgbTuple } from "./color";
import { JUMP_TRAIL_MAX_PUFFS, JUMP_TRAIL_MIN_DIST, JUMP_TRAIL_STEP } from "./constants";
import type { CaretRecord, Rect } from "./types";
import type CursorSmithPlugin from "./plugin";

export const effectsTrailMethods = {
  // Record `point` (the position being left) as a CRT trail ghost. If `dest` is
  // given and the move from point→dest is a jump, also lay intermediate ghosts
  // along that path so the trail is a continuous streak across the leap instead
  // of two dots with a gap. `dest` itself is NOT recorded here - it becomes the
  // live caret and gets its own ghost on the next move - only the bridge between
  // them is filled.
  pushTrail(this: CursorSmithPlugin, point: CaretRecord | null, dest: CaretRecord | null = null) {
    // Only under the CRT effect, which is the one painter of these ghosts
    // (forEachTrailPoint). They used to be recorded whatever the setting and
    // pruned by age, so every caret move with CRT off still held the hot
    // gear and repainted the frame for trailFadeMs (450 ms by default) - the
    // report read "awake because: trail 100%" while typing on the default
    // look, sixty draws a second of an invisible tail.
    if (!point || !this.look.crtEffect) return;
    const now = performance.now();
    const max = Math.max(0, Math.round(this.look.trailLength));

    this.trail.push({ x: point.x, y: point.top, w: point.w, h: point.h, t: now });

    // Bridge a jump with a streak of intermediate ghosts. Neon only: the neon
    // tail is meant to read as the cursor zipping across the gap, but on the
    // plain CRT effect that same bridge just smears a line of ghost boxes from
    // the old spot to the click, which isn't wanted. Plain CRT still leaves its
    // normal fading ghost at the origin (pushed above) - only the across-the-gap
    // streak is dropped. Also gated on room in the trail.
    if (dest && this.look.crtEffect && this.look.crtNeon && max > 1) {
      const dx = dest.x - point.x;
      const dy = dest.top - point.top;
      const dist = Math.hypot(dx, dy);
      if (dist >= JUMP_TRAIL_MIN_DIST) {
        // One ghost every JUMP_TRAIL_STEP px, capped so a top-to-bottom click in
        // a huge document can't flood the trail, and never more than the trail
        // can hold so the bridge doesn't instantly evict itself.
        const steps = Math.min(
          JUMP_TRAIL_MAX_PUFFS, max, Math.floor(dist / JUMP_TRAIL_STEP)
        );
        for (let i = 1; i <= steps; i++) {
          const s = i / (steps + 1);
          // Timestamps fan slightly forward from `now` toward the destination so
          // ghosts nearer the landing read as freshest - the streak fades from
          // the origin (oldest) to where the caret now sits (newest), giving it
          // a direction rather than a uniform smear.
          this.trail.push({
            x: point.x + dx * s,
            y: point.top + dy * s,
            w: dest.w, h: dest.h,
            t: now + s * 10,
          });
        }
      }
    }

    while (this.trail.length > max) this.trail.shift();
  },

  // Age out expired trail points.
  //
  // This deliberately lives in the update phase, NOT inside draw(), and is
  // deliberately NOT gated on crtEffect. It used to be the first two lines of
  // forEachTrailPoint(), which is wrong twice over:
  //
  //   1. forEachTrailPoint() early-returns when crtEffect is off, and until
  //      1.5.8 pushTrail() ran from commitMove() on every caret move
  //      regardless of that setting (it is gated on it now). With the trail
  //      effect disabled - the default - the array filled to trailLength and
  //      was never pruned by age at all, only evicted by newer entries.
  //      trail.length stayed pinned at 10 forever after the first ten
  //      keystrokes.
  //   2. Even with crtEffect on, pruning inside draw() breaks the moment the
  //      frame governor legitimately skips a draw.
  //
  // Either way the result was the same: `trail.length > 0` held `animating`
  // true permanently, which latched the hot gear and defeated every other
  // power fix in this file. Measured at a flat 60 draws/sec on a completely
  // idle editor.
  pruneTrail(this: CursorSmithPlugin) {
    if (!this.trail.length) return;
    const now = performance.now();
    const fade = Math.max(50, this.look.trailFadeMs);
    this.trail = this.trail.filter((p) => now - p.t < fade);
  },

  // The fill/stroke style and glow for one CRT trail ghost. Pulled out so the
  // Line/Underline and Box renderers paint the trail identically.
  //
  // Plain CRT: the flat (or per-dot gradient) cursor colour at the ghost's fade
  // alpha, no extra glow beyond the cursor's own. Neon: the colour is pushed
  // toward full saturation and a bright core, a real shadowBlur halo is armed on
  // the context, and - when crtNeonGradient is on with a gradient active - the
  // hue is sampled from the ramp by the ghost's position along the trail, so the
  // streak runs through the whole gradient from head to tail.
  //
  // Returns the style string; arming the glow is a side effect on ctx, so the
  // caller must ctx.save()/restore() around a run of trail points.
  trailPaint(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, p: Rect, alpha: number, age: number, flatColor: string): string | CanvasGradient {
    if (!this.look.crtNeon) {
      ctx.shadowBlur = 0;
      return this.cursorPaint(p.x, p.y, p.w, p.h, flatColor, alpha);
    }

    // Neon colour. When the gradient sub-option is on, sample the ramp by
    // trail position (freshest ghost near the head of the ramp); otherwise lift
    // the flat colour toward its own saturated, bright version.
    let r, g, b;
    if (this.look.crtNeonGradient && this.look.gradientEnabled) {
      [r, g, b] = this.sampleRamp(1 - age);
    } else {
      [r, g, b] = hexToRgbTuple(flatColor || "#39ff14");
    }
    // Push toward a neon look: pull each channel a little toward white for a hot
    // core while keeping the hue, so it reads as luminous tube-glow rather than
    // a flat swatch.
    const nr = Math.round(r + (255 - r) * 0.35);
    const ng = Math.round(g + (255 - g) * 0.35);
    const nb = Math.round(b + (255 - b) * 0.35);
    // The halo carries the pure hue (not the whitened core) so the glow around
    // each ghost is saturated colour, the way real neon spills.
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha * 2)})`;
    ctx.shadowBlur = 12;
    // Slightly boosted alpha so the streak holds up under the glow.
    return `rgba(${nr}, ${ng}, ${nb}, ${Math.min(1, alpha * 1.3)})`;
  },

  // Paint one neon trail ghost as a lit tube rather than a flat coloured bar:
  // the saturated fill + halo from trailPaint, then a thin near-white core
  // stripe down its centre so it reads as a glowing filament with coloured
  // spill - the thing that actually makes it look like neon. The core is
  // skipped once the ghost is too narrow to have an inside (e.g. a Line cursor,
  // which is basically all core already).
  drawNeonGhost(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, r: Rect, alpha: number, age: number, color: string) {
    ctx.fillStyle = this.trailPaint(ctx, r, alpha, age, color);
    this.fillTrailRect(ctx, r.x, r.y, r.w, r.h);
    if (r.w >= 3) {
      const coreW = Math.max(1, r.w * 0.34);
      // Uses the hue trailPaint already armed as the shadow, so the white core
      // casts a coloured glow - a hot filament inside a coloured tube.
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.6)})`;
      // The core is a thin bar inside the tube, so it capsules on its own
      // narrow axis whenever the tube is rounded - a sharp-ended filament
      // poking out of a rounded tube is the one artifact worth avoiding here.
      this.fillTrailRect(ctx, r.x + (r.w - coreW) / 2, r.y, coreW, r.h);
    }
  },

  // Emit small upward-rising fire embers when heat is high enough.
  // Rate scales with heat so mid-heat is a lazy simmer and full heat is
  // a proper flame. Cap total live sparks to keep the canvas fill-rate
  // sane even when the user is chugging (each spark is a small fillRect,
  // so it's not free).
  maybeSpawnSpeedDemonSparks(this: CursorSmithPlugin) {
    if (this.heat < 0.4) return;
    if (this.flamePixels.length > 120) return;
    const now = performance.now();
    // Time-gated spawn: emit at most once per (frame budget) ms, scaled by
    // heat. At heat=0.4 that's ~60ms between bursts; at heat=1 it's ~14ms.
    const gap = 70 - 55 * this.heat;
    if (now - this._lastSparkT < gap) return;
    this._lastSparkT = now;

    const active = this.animActive;
    if (!active) return;
    const anchorW = active.w || active.actualCharWidth || 8;
    const baseCount = 1 + Math.floor(this.heat * 3); // 1..4 sparks per burst
    // Spark Quantity: 0..3 multiplier on the base burst size, so 1 is the
    // original feel, 0 effectively stops sparks without touching the Fire
    // Sparks toggle, and >1 throws a heavier shower at the same heat level.
    const qty = Math.max(0, this.styleFor("speedDemonSparkQuantity") ?? 1);
    const count = Math.round(baseCount * qty);
    const heatCol = this.heatColor(Math.min(1, this.heat + 0.1), this.getBaseColor());
    const [hr, hg, hb] = hexToRgbTuple(heatCol);
    for (let i = 0; i < count; i++) {
      // Spawn along the top edge of the cursor - embers rising off a
      // white-hot surface. A little jitter on x/y keeps them from looking
      // like a straight line of pixels.
      const pX = active.x + Math.random() * anchorW;
      const pY = active.top + Math.random() * (active.h * 0.4);
      const varR = Math.max(0, Math.min(255, hr + Math.floor((Math.random() - 0.5) * 40)));
      const varG = Math.max(0, Math.min(255, hg + Math.floor((Math.random() - 0.5) * 30)));
      const varB = Math.max(0, Math.min(255, hb + Math.floor((Math.random() - 0.5) * 20)));

      this.flamePixels.push({
        x: pX,
        y: pY,
        // Upward drift + light horizontal jitter. Speed scales with heat
        // so hotter cursor throws embers further before they fade.
        vx: (Math.random() - 0.5) * 12,
        vy: -20 - Math.random() * 30 - this.heat * 20,
        size: 1.5 + Math.random() * 2, // smaller than backspace/normal pixels
        color: `rgb(${varR}, ${varG}, ${varB})`,
        // Cached numeric channels alongside `color`: the trail gradient in
        // drawFlamePixels needs r/g/b at custom alphas every frame, and
        // re-deriving them from the formatted string via regex each time
        // (for every live spark, every frame) is needless work when we
        // already have the numbers right here at spawn time.
        r: varR, g: varG, b: varB,
        alpha: 1,
        start: now,
        // Marks this particle as a Speed Demon spark (as opposed to a Pixel
        // Trail / backspace-disintegration particle sharing the same pool)
        // so drawFlamePixels only trails the ones that should have one.
        spark: true
      });
    }
  },
};
