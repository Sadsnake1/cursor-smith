// Part of the plugin class, split out by seam (HANDOFF §1.16, ARCHITECTURE
// "Should this be split?"): the methods below are assigned onto
// CursorSmithPlugin.prototype and declared on the class, so every `this.x`
// read and every test reach them exactly as before. `this` is the plugin.
//
// Painting the cursor itself: colour (the ramp, the heat, the blink), the
// shapes (box, line, underline, serifs, rounded corners, the smear quad),
// the energy beam and aurora, the bracket tether, the secondaries, and
// draw() - the frame's painter, in the order the layers stack.

import { hexToRgbTuple, hexToRgba, readableGlyphColor } from "./color";
import {
  DIRTY_RECT_CLEAR,
  GLOW_HEAT_GAIN,
  ROUNDED_BLOCK_FRACTION,
  ROUNDED_THIN_PX,
  SERIF_HEIGHT_RATIO,
  SERIF_MAX_SPAN_RATIO,
  SERIF_MIN_SPAN_PX,
  SERIF_STEM_RATIO,
  SERIF_TAPER,
  SMEAR_LEAD_BOOST_CAP,
  SMEAR_VOLUME_MIN_FACTOR,
  SPEED_RAMP_LIFTOFF,
  TAPER_FULL_LAG,
  TAPER_MIN_LAG,
  TRANSLUCENT_ALPHA,
} from "./constants";
import { blinkAlphaAt, easeInOutSine } from "./motion";
import { DEFAULT_SETTINGS } from "./settings";
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
import type {
  Bounds,
  CaretRecord,
  CursorSmithSettings,
  Pt,
  Quad,
  QuadKey,
  Rect,
  SettingKey,
  SmearQuad,
  TetherSeg,
} from "./types";
import type CursorSmithPlugin from "./plugin";

export const paintMethods = {
  getActiveColor(this: CursorSmithPlugin): string {
    const baseColor = this.getBaseColor();
    if (!this.look.speedDemon) return baseColor;
    // "Keep cursor color": the caret stays exactly the colour it's configured
    // to be, so you get Speed Demon's sparks without the cursor itself
    // changing colour underneath you as you speed up.
    if (this.styleFor("speedDemonNoCursorHeat")) return baseColor;
    return this.heatColor(this.heat, baseColor);
  },

  // Get the base (non-heated) color. Used by Speed Demon internally so its
  // damped resting colour and its ramp both start from the user's chosen
  // colour rather than always from the same grey - a green-configured cursor
  // rests as a dim moss, an orange one as slate.
  //
  // This is also the single flat colour every effect that ISN'T the cursor
  // body falls back to: the CRT glow halo, Pixel Trail particles, popping
  // letters. With Gradient on, that colour is the ramp's first stop, so those
  // effects stay in the same family as the cursor instead of going on painting
  // themselves in a per-theme colour the cursor no longer uses anywhere.
  //
  // Secondary (multi-cursor) carets used to be in that list and no longer are:
  // they are cursor bodies too, so they take the whole ramp rather than a flat
  // slice of it. See drawSecondaryCarets.
  //
  // Deliberately UNHEATED in both branches. It used to hand back
  // gradientStops()[0], which has already been through heatColor, so every
  // caller that then applied heat itself - getActiveColor, and the ember
  // colour in spawnSparks - was heating a gradient cursor twice and landing
  // way up the ramp for the actual heat level. Callers that want the heated
  // colour go through getActiveColor.
  getBaseColor(this: CursorSmithPlugin): string {
    if (this.look.gradientEnabled) return this.gradientStops(false)[0];
    return this.isDarkTheme() ? this.look.colorDark : this.look.colorLight;
  },

  // Which theme the cursor is being drawn against. Read off the document that
  // actually owns the canvas, not the main one, so a popped-out window with a
  // different theme still picks the right colours.
  isDarkTheme(this: CursorSmithPlugin): boolean {
    const doc = this.canvas ? this.canvas.ownerDocument : document;
    return doc.body.classList.contains("theme-dark");
  },

  // ---- Gradient cursor colour --------------------------------------------
  // The active theme's gradient stops, in order, as hex strings. Always at
  // least two entries, so callers can index [i] and [i+1] without guarding.
  // `applyHeat` exists for the callers that need the stops as the user
  // configured them - anything that is about to run them through heatColor
  // itself, and would otherwise apply the ramp twice.
  gradientStops(this: CursorSmithPlugin, applyHeat = true): string[] {
    const s = this.look;
    const n = Math.max(2, Math.min(4, Math.round(s.gradientCount || 2)));
    // One ramp per theme, same as colorDark/colorLight: a ramp tuned for a
    // dark background usually washes out on a light one. gradientCount is
    // shared, so both ramps always have the same number of stops.
    const prefix = this.isDarkTheme() ? "gradientDark" : "gradientLight";
    const out = [];
    for (let i = 1; i <= n; i++) {
      const key = prefix + i;
      let hex = (s[key as SettingKey] || (DEFAULT_SETTINGS as CursorSmithSettings)[key as SettingKey]) as string;
      // Speed Demon drives the whole cursor along a cold → white-hot ramp as
      // you type. Running every stop through it keeps a gradient cursor
      // heating up like a flat one does, instead of sitting frozen at its
      // configured colours while the rest of the effect reacts.
      //
      // The `heat > 0` shortcut is a free optimisation: at rest, BOTH curves
      // now hand back the stop they were given - the built-in one because its
      // cold end is the base colour, the custom one because of
      // SPEED_RAMP_LIFTOFF. It used to have to be skipped for the custom ramp,
      // which returned stage 1 at rest and would otherwise have snapped to it
      // on the first keystroke; that special case is gone with the cause.
      if (applyHeat && s.speedDemon && this.heat > 0
          && !this.styleFor("speedDemonNoCursorHeat")) {
        hex = this.heatColor(this.heat, hex);
      }
      out.push(hex);
    }
    return out;
  },

  // Colour at a position along the ramp (0 = first stop, 1 = last), as an
  // [r, g, b] tuple. With Gradient off this is just the flat active colour at
  // every position, so callers don't need to branch: Energy Beam samples this
  // per gradient stop, and Stardust samples it at a random position so a
  // gradient cursor sheds multi-coloured motes.
  //
  // `cyclic` treats the ramp as a loop (…→ last → first → last →…) instead of
  // a line with two ends. That's what makes a *scrolling* ramp possible: slide
  // a linear ramp along and the wrap from last stop back to first lands as a
  // hard seam travelling through the cursor, where a cyclic one has no seam to
  // show. Note it costs one segment: a cyclic 2-stop ramp is A→B→A, so the
  // colour returned for a given pos differs between the two modes by design.
  sampleRamp(this: CursorSmithPlugin, pos: number, cyclic: boolean = false): number[] {
    if (!this.look.gradientEnabled) {
      return hexToRgbTuple(this.getActiveColor() || "#39ff14");
    }
    const stops = this.gradientStops();
    const lerp = (a: number[], b: number[], f: number) => [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ];

    if (cyclic) {
      const wrapped = ((pos % 1) + 1) % 1;
      const p = wrapped * stops.length;
      const i = Math.floor(p) % stops.length;
      const j = (i + 1) % stops.length;
      return lerp(hexToRgbTuple(stops[i]), hexToRgbTuple(stops[j]), p - Math.floor(p));
    }

    const p = Math.max(0, Math.min(1, pos)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(p));
    return lerp(hexToRgbTuple(stops[i]), hexToRgbTuple(stops[i + 1]), p - i);
  },

  // A CanvasGradient spanning the given rect, running along the cursor's
  // LONGER axis: top→bottom for a Line or Box, left→right for an Underline
  // bar. A fixed axis would be wrong for half the styles - a vertical ramp
  // squeezed into a 3px-tall underline is just a muddy average, and a
  // horizontal one across a 2px-wide line cursor is the same in reverse.
  createCursorGradient(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, alpha: number): string | CanvasGradient {
    const ctx = this.ctx;
    const stops = this.gradientStops();
    const horizontal = w > h;
    const span = horizontal ? w : h;
    // A zero-length gradient line paints nothing at all (per the canvas spec),
    // which would silently blank the cursor rather than degrade. Fall back to
    // the first stop as a flat fill. Same answer with no canvas to draw on.
    if (!ctx || !(span > 0)) return hexToRgba(stops[0], alpha);

    const grad = horizontal
      ? ctx.createLinearGradient(x, y, x + w, y)
      : ctx.createLinearGradient(x, y, x, y + h);
    for (let i = 0; i < stops.length; i++) {
      const [r, g, b] = hexToRgbTuple(stops[i]);
      grad.addColorStop(i / (stops.length - 1), `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  },

  // The paint for one cursor-shaped fill or stroke: the gradient when Gradient
  // is on, otherwise the flat rgba string the engine has always used. Callers
  // pass the rect they are ACTUALLY about to paint (e.g. the underline bar,
  // not the whole line box) so the ramp spans the visible shape.
  //
  // Note this deliberately knows nothing about Energy Beam: the body-fill call
  // sites still pick createEnergyGradient over this one when the beam is on,
  // which keeps the beam's existing behaviour of not painting CRT trail dots.
  // The cursor body is a single flat heat colour (getActiveColor already ran
  // the ramp), or the user's gradient when that's enabled. The bottom-to-top
  // "flame column" that briefly lived here was replaced by the fire that now
  // rises off the top of the whole text line (see maybeSpawnSpeedDemonSparks) -
  // the caret just glows its heat colour, the line above it is what burns.
  cursorPaint(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, color: string, alpha: number): string | CanvasGradient {
    if (!this.look.gradientEnabled) return hexToRgba(color, alpha);
    return this.createCursorGradient(x, y, w, h, alpha);
  },

  // Map heat (0..1) to an rgb() string along a cold → hot ramp:
  //   0.00  desaturated + dimmed version of the user's cursor colour
  //   0.50  mid: user's colour blended toward warm orange
  //   0.85  vivid orange-red
  //   1.00  near-white, "white-hot"
  // Piecewise-linear in RGB is crude but reads well because each segment
  // is short and the eye interprets the sequence as temperature, not as
  // three separate interpolations.
  // Multiplier on the CRT glow's blur radius, driven by Speed Demon's heat.
  //
  // Returns 1 (no change) unless Speed Demon is actually on, so the glow keeps
  // its existing look for everyone not using the two together. Deliberately not
  // behind its own toggle: the CRT glow already only exists when you've asked
  // for the CRT effect, and heat only exists when you've asked for Speed Demon,
  // so wanting both and NOT wanting them to interact is the odd case. If that
  // turns out to be wrong, this is the one place to gate.
  //
  // Reads `speedDemonNoCursorHeat` too: someone who has explicitly said the
  // cursor should keep its own colour as it heats up has said they don't want
  // the caret reacting to speed, and a pulsing halo is exactly that.
  glowHeatScale(this: CursorSmithPlugin): number {
    if (!this.look.speedDemon) return 1;
    if (this.styleFor("speedDemonNoCursorHeat")) return 1;
    const h = Math.max(0, Math.min(1, this.heat || 0));
    return 1 + GLOW_HEAT_GAIN * h;
  },

  // The active theme's four custom heat stops, cold → hot, as hex strings.
  speedHeatStops(this: CursorSmithPlugin): string[] {
    const prefix = this.isDarkTheme() ? "speedHeatDark" : "speedHeatLight";
    const out: string[] = [];
    for (let i = 1; i <= 4; i++) {
      out.push((this.look[(prefix + i) as SettingKey] || (DEFAULT_SETTINGS as CursorSmithSettings)[(prefix + i) as SettingKey]) as string);
    }
    return out;
  },

  // Sample the custom ramp at `h` (0 = stage 1 at rest, 1 = stage 4 flat out).
  // Three equal linear segments rather than an eased curve: these are stops the
  // user picked deliberately, and easing would mean each chosen colour is only
  // hit exactly at one instant while the time is spent in between. Linear makes
  // each quarter of the speed range read as "that stage".
  sampleHeatRamp(this: CursorSmithPlugin, h: number): string {
    const stops = this.speedHeatStops();
    const t = Math.max(0, Math.min(1, h)) * 3;
    const i = Math.min(2, Math.floor(t));
    const f = t - i;
    const [r1, g1, b1] = hexToRgbTuple(stops[i]);
    const [r2, g2, b2] = hexToRgbTuple(stops[i + 1]);
    const r = Math.round(r1 + (r2 - r1) * f);
    const g = Math.round(g1 + (g2 - g1) * f);
    const b = Math.round(b1 + (b2 - b1) * f);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  },

  heatColor(this: CursorSmithPlugin, heat: number, baseHex: string): string {
    const h = Math.max(0, Math.min(1, heat));
    // Custom ramp: ignores baseHex entirely and hands back the sampled stop.
    //
    // That "ignores baseHex" is the whole behaviour, and it has one consequence
    // worth stating plainly: gradientStops() runs every stop of a Gradient
    // cursor through here, so with a custom ramp on, all of them come back the
    // same colour and the spatial gradient flattens. That's intended - two
    // features both claiming the cursor's colour can't both win - and the
    // settings panel says so where you turn it on.
    if (this.styleFor("speedDemonGradient")) {
      if (h >= SPEED_RAMP_LIFTOFF) {
        // Stops are compressed into what's left of the range, so stage 1 is hit
        // at liftoff and stage 4 still lands at full heat.
        return this.sampleHeatRamp((h - SPEED_RAMP_LIFTOFF) / (1 - SPEED_RAMP_LIFTOFF));
      }
      // Easing out of the colour this stop was actually given. Note that is
      // per-stop, not from one shared colour: gradientStops() sends every stop
      // of a Gradient cursor through here, so at rest each one returns itself
      // and the spatial gradient survives, then collapses into the heat ramp as
      // the cursor warms up.
      const [sr, sg, sb] = hexToRgbTuple(this.speedHeatStops()[0]);
      const [r0, g0, b0] = hexToRgbTuple(baseHex);
      const f = h / SPEED_RAMP_LIFTOFF;
      const rr = Math.round(r0 + (sr - r0) * f);
      const gg = Math.round(g0 + (sg - g0) * f);
      const bb = Math.round(b0 + (sb - b0) * f);
      return `#${((1 << 24) | (rr << 16) | (gg << 8) | bb).toString(16).slice(1)}`;
    }
    const [br, bg, bb] = hexToRgbTuple(baseHex);
    // Cold endpoint: the user's colour, exactly.
    //
    // It used to be a desaturated (70% toward luma grey) and dimmed (72%)
    // version of it, on the theory that "cold" should read as dulled. In
    // practice that meant switching Speed Demon on changed how the cursor
    // looked when you WEREN'T typing, which is most of the time - you picked a
    // colour and got a washed-out version of it until you started moving. The
    // effect is supposed to add heat on top of your cursor, not take the
    // colour away and hand some of it back as a reward.
    //
    // Now heat 0 is the configured colour and the ramp only ever adds: base ->
    // warm -> red-orange -> white-hot. The `nudge` below is left in place; it
    // still keeps the base colour present through the middle of the ramp,
    // which is a different job from the resting colour.
    const coldR = br;
    const coldG = bg;
    const coldB = bb;

    // Warm waypoints (classic blackbody-ish ramp).
    const warm  = [255, 140,  40];             // orange
    const hot   = [255,  70,  30];             // red-orange
    const white = [255, 240, 200];             // white-hot

    let r, g, b;
    if (h < 0.5) {
      // cold → user's colour (fully saturated again) → warm
      const t = h / 0.5;
      // First half of the interpolation blends cold → base, second half
      // blends base → warm, but doing that as two segments makes 0.5 look
      // like a kink. Smoother: use base as a midpoint of a single curve
      // via easeInOutSine.
      const e = easeInOutSine(t);
      r = coldR + (warm[0] - coldR) * e;
      g = coldG + (warm[1] - coldG) * e;
      b = coldB + (warm[2] - coldB) * e;
      // Nudge back toward the user's colour in the mid-range so it doesn't
      // feel like the base colour disappears entirely.
      const nudge = 1 - Math.abs(t - 0.5) * 2; // 0 at ends, 1 at t=0.5
      r = r * (1 - 0.25 * nudge) + br * 0.25 * nudge;
      g = g * (1 - 0.25 * nudge) + bg * 0.25 * nudge;
      b = b * (1 - 0.25 * nudge) + bb * 0.25 * nudge;
    } else if (h < 0.85) {
      const t = (h - 0.5) / 0.35;
      r = warm[0] + (hot[0] - warm[0]) * t;
      g = warm[1] + (hot[1] - warm[1]) * t;
      b = warm[2] + (hot[2] - warm[2]) * t;
    } else {
      const t = (h - 0.85) / 0.15;
      r = hot[0] + (white[0] - hot[0]) * t;
      g = hot[1] + (white[1] - hot[1]) * t;
      b = hot[2] + (white[2] - hot[2]) * t;
    }
    return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b))
      .toString(16).slice(1)}`;
  },

  // The raw blink cycle: 1 while the caret is "on", 0 while it's "off", eased
  // through the two transitions, and pinned at 1 during the post-move hold.
  //
  // This is the SHAPE of the blink, separate from what is done with it. Plain
  // blinking fades opacity by it; Breathing scales the caret by it and leaves
  // opacity alone; the torch's Blink Sync follows it whichever of those is on.
  // Splitting the two apart is what lets Breathing stop the caret vanishing
  // without also stopping everything else that keys off the blink.
  blinkPhase(this: CursorSmithPlugin, now: number): number {
    if (!this.look.blinkingEnabled) return 1;
    // Build the effective hold window from two independent sources:
    //   • smoothStopBlinking (existing): 450 ms hold, only active when smooth
    //     movement is on (behaviour unchanged for existing users).
    //   • blinkDelayMs (new): explicit user-controlled delay that works
    //     regardless of whether smooth movement is enabled.
    // We take the larger of the two so neither setting silently overrides the other.
    let holdMs = 0;
    if (this.look.smoothEnabled && this.look.smoothStopBlinking) holdMs = 450;
    const delayMs = Math.max(0, this.look.blinkDelayMs ?? 0);
    if (delayMs > holdMs) holdMs = delayMs;
    // Phase is measured from the END of the hold window, not from the wall
    // clock.
    //
    // blinkAlphaAt used to take `now` directly and do `now % period`, so the
    // cycle was anchored to nothing at all. The hold pins alpha at 1 and then
    // handed straight back to whatever phase absolute time happened to be at
    // - which, sweeping stop-times across one cycle, snapped 1.00 -> 0.00 in a
    // single frame about half the time. You stop typing, the caret sits solid
    // for the delay, then vanishes with no fade at all, precisely when your
    // eye goes looking for it. The blinkFade easing never applied at that
    // boundary because it only exists inside the cycle.
    //
    // Anchoring here means the cycle always STARTS fully on and eases down on
    // schedule, which is also what every other editor does: move the caret and
    // the blink restarts from solid rather than resuming mid-cycle.
    const elapsed = now - (this.lastMoveTime + holdMs);
    if (!(elapsed > 0)) return 1;

    const speed = Math.max(0, this.look.blinkSpeed);

    // Blink-to-solid. After N full cycles the caret stops blinking and stays
    // lit until it next moves, which resets lastMoveTime and starts the count
    // again.
    //
    // Counted in whole PERIODS, and that is what makes the hand-off free: a
    // cycle starts fully on (see the anchoring note above), so at elapsed =
    // N * period the blink is already at alpha 1 and holding there is
    // continuous. Testing an alpha threshold instead, or counting fades,
    // would stop somewhere inside a cycle and snap - the same class of jump
    // the phase anchor exists to remove.
    //
    // It also pays for itself in frames. The gear decision reads blinkPhase()
    // directly, so a caret that has gone solid reports neither a fade nor a
    // changing draw signature: the loop drops to the idle heartbeat and stops
    // repainting entirely, instead of running two fades a second forever.
    const stopAfter = Math.max(0, Math.round(this.look.blinkStopAfter ?? 0));
    if (stopAfter > 0 && speed > 0 && elapsed >= stopAfter * (2500 / speed)) return 1;

    return blinkAlphaAt(elapsed, speed, this.look.blinkOnOffBalance ?? 0.5, this.look.blinkFade ?? 0.15);
  },

  // What the blink does to opacity. Breathing swaps the fade out for a size
  // change, so the caret keeps full opacity throughout - never disappearing is
  // the entire point of that option.
  blinkAlpha(this: CursorSmithPlugin, now: number): number {
    if (this.look.blinkBreathing) return 1;
    return this.blinkPhase(now);
  },

  // What the blink does to size: 1 at the top of the cycle, shrinking to
  // (1 - depth) at the bottom. Never exceeds 1, deliberately - the damage box
  // in draw() is measured from the caret's true rect, so a caret that breathed
  // OUT past its own bounds would leave uncleared pixels behind its widest
  // frame. Shrinking from the true size is also what keeps it from shouldering
  // into the glyphs on either side.
  breathScale(this: CursorSmithPlugin, now: number) {
    if (!this.look.blinkingEnabled || !this.look.blinkBreathing) return 1;
    const depth = Math.max(0, Math.min(0.9, this.look.blinkBreathDepth ?? 0.2));
    return 1 - depth * (1 - this.blinkPhase(now));
  },

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

  // The corner radius for a shape whose narrow axis is `minor` px.
  //
  // Rounding is a toggle, not a dial, so this decides the radius - and it is
  // deliberately NOT one constant. "Rounded" means different things for a
  // 3px Line stem and a 8x24 Box: a quarter of the minor axis is a pleasant
  // soft corner on a block and invisible on a bar, while a full capsule is
  // right for a bar and turns a block into a stadium. So thin shapes (the
  // Line stem, the Underline bar, serifs) go fully round and blocks get the
  // softer quarter.
  //
  // ROUNDED_THIN_PX is the width below which a shape reads as a bar rather
  // than a block. Anything at or under it is basically all edge, so there is
  // no flat middle for a partial radius to preserve.
  cornerRadius(this: CursorSmithPlugin, minor: number): number {
    if (!this.styleFor("cursorRounded")) return 0;
    const m = Math.max(0, minor);
    if (m <= 0) return 0;
    const r = m <= ROUNDED_THIN_PX ? m / 2 : m * ROUNDED_BLOCK_FRACTION;
    // Never more than half the narrow axis: beyond that the two corners on
    // one side overlap and arcTo starts producing self-intersecting garbage.
    return Math.min(r, m / 2);
  },

  // Trace a quad - optionally with rounded corners - WITHOUT filling it.
  //
  // Split out from fillCursorShape so the hollow outline can stroke exactly
  // the shape the solid style fills. Those two used to be separate bodies of
  // code with a comment admitting the duplication, which is precisely why
  // rounding had to touch both or neither.
  //
  // arcTo does the rounding rather than roundRect, for two reasons. The
  // shape is NOT always an axis-aligned rect: with Motion Smear on it is an
  // arbitrary quad from the smear spring, which roundRect cannot express at
  // all. And roundRect needs Chromium 99 / iOS 16.4, while this plugin ships
  // with isDesktopOnly false - arcTo has been universal for a decade.
  traceQuad(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, corners: Quad, radius: number = 0) {
    const pts = [corners.tl, corners.tr, corners.br, corners.bl];

    if (!(radius > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }

    // Clamp against the quad's OWN geometry - both its edge lengths AND its
    // corner angles.
    //
    // Edge length alone is not enough, and that omission is what produced
    // stray artifacts with Rounded Corners on. arcTo does not draw an arc of
    // radius r centred on the corner: it insets the arc's tangent points
    // along both edges by r / tan(theta/2), which for an ACUTE corner is far
    // larger than r. A Motion Smear shears the quad into exactly that shape -
    // measured on a 3x24 stem sheared 60px, the corner angle falls to 22
    // degrees and a 1.5px radius reaches 7.8px along a 3px edge. The tangent
    // point lands beyond the next corner, the traced path leaves the quad
    // entirely, and whatever it paints out there is outside the damage rect
    // and never cleared.
    //
    // Inverting that relation gives the real ceiling per corner:
    //   r <= (shorter adjacent edge / 2) * tan(theta / 2)
    // which for a right angle reduces to half the edge - the old rule - and
    // tightens smoothly as the corner sharpens.
    let r = radius;
    for (let i = 0; i < 4; i++) {
      const prev = pts[(i + 3) % 4], cur = pts[i], next = pts[(i + 1) % 4];
      const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
      const v2x = next.x - cur.x, v2y = next.y - cur.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (!(l1 > 1e-6) || !(l2 > 1e-6)) { r = 0; break; }
      const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
      const theta = Math.acos(cos);
      // A straight-through corner (theta ~ pi) needs no limit from the angle;
      // a folded-back one (theta ~ 0) can take no radius at all.
      const lim = Math.min(l1, l2) / 2 * Math.tan(theta / 2);
      if (lim < r) r = lim;
    }
    if (!(r > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }

    // Start at the midpoint of the last edge - any point strictly inside an
    // edge works as a seed, and a midpoint is guaranteed to be outside both
    // of that edge's corner arcs after the clamp above.
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const seed = mid(pts[3], pts[0]);
    ctx.moveTo(seed.x, seed.y);
    for (let i = 0; i < 4; i++) {
      const corner = pts[i];
      const next = pts[(i + 1) % 4];
      ctx.arcTo(corner.x, corner.y, next.x, next.y, r);
    }
    ctx.closePath();
  },

  // The caret's body as a set of corner points: the smear quad while Motion
  // Smear is deforming it, otherwise the plain rect.
  cursorCorners(this: CursorSmithPlugin, rx: number, ry: number, rw: number, rh: number): Quad {
    return this.smearCorners() || {
      tl: { x: rx, y: ry },
      tr: { x: rx + rw, y: ry },
      br: { x: rx + rw, y: ry + rh },
      bl: { x: rx, y: ry + rh },
    };
  },

  fillCursorShape(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number) {
    const corners = this.cursorCorners(rx, ry, rw, rh);
    ctx.beginPath();
    this.traceQuad(ctx, corners, this.cornerRadius(Math.min(rw, rh)));
    ctx.fill();
  },

  // An axis-aligned rect as a rounded subpath, for the trail ghosts and the
  // neon tube. These never smear (a trail ghost is a snapshot of where the
  // caret WAS, so it has no spring state of its own), so they don't need the
  // quad machinery - but they do need to match the live caret's rounding, or
  // a rounded cursor drags a tail of little sharp boxes behind it.
  traceRoundedRect(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
    const r = Math.min(Math.max(0, radius), Math.min(w, h) / 2);
    if (!(r > 0.01)) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  fillTrailRect(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const r = this.cornerRadius(Math.min(w, h));
    if (!(r > 0.01)) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    this.traceRoundedRect(ctx, x, y, w, h, r);
    ctx.fill();
  },

  // Chooses how the Energy Beam paints the cursor.
  //
  // Aurora with any waviness becomes a genuine 2D field (auroraPattern); every
  // other case keeps the original linear gradient. Both return something usable
  // directly as a fillStyle/strokeStyle, so callers don't care which they got.
  energyPaint(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, baseColor: string, alpha: number) {
    const rampOn = !!this.look.gradientEnabled;
    const wav = this.look.energyAuroraWaviness ?? 1;
    if (rampOn && this.look.energyAurora && wav > 0.05) {
      const pat = this.auroraPattern(x, y, w, h, alpha, wav);
      if (pat) return pat;
      // else fall through to the gradient - auroraPattern self-disables on a
      // degenerate rect, an oversized one, or any canvas API failure.
    }
    return this.createEnergyGradient(x, y, w, h, baseColor, alpha);
  },

  // Aurora as a 2D pattern rather than a vertical gradient.
  //
  // Why this exists: createLinearGradient can only vary colour along ONE axis.
  // However hard the old code warped its sample position, every colour band was
  // still a perfectly horizontal line spanning the cursor - the bands could
  // slide up and down but could never bend, which is why Aurora read as
  // "scrolling stripes" rather than anything wavy. Getting curtains that
  // actually ripple sideways requires colour to be a function of x AND y, and
  // the only way to hand canvas an arbitrary 2D field as a fillStyle is to
  // rasterise it into an offscreen bitmap and wrap that in a pattern.
  //
  // Returns null (caller falls back to the gradient) rather than throwing on
  // anything unexpected, matching the defensive style used elsewhere here.
  auroraPattern(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, alpha: number, wav: number) {
    try {
      const ctx = this.ctx;
      if (!ctx) return null;

      // The pattern must cover the smear quad, not just the caret box: during a
      // smear the filled shape overshoots the box, and a "no-repeat" pattern
      // paints nothing outside its own bitmap - the overshooting part of the
      // cursor would come out fully transparent. Union the two and pad by a
      // pixel so the edges of the shape are inside the bitmap, never on its
      // boundary.
      let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
      const q = this.smearCorners();
      if (q) {
        for (const k of ["tl", "tr", "br", "bl"] as const) {
          const c = q[k];
          if (!c) continue;
          if (c.x < x0) x0 = c.x;
          if (c.y < y0) y0 = c.y;
          if (c.x > x1) x1 = c.x;
          if (c.y > y1) y1 = c.y;
        }
      }
      x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;

      const rw = x1 - x0, rh = y1 - y0;
      if (!(rw > 0.5) || !(rh > 0.5)) return null;

      const dpr = (this.canvas?.ownerDocument?.defaultView || window).devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(rw * dpr));
      const ph = Math.max(1, Math.round(rh * dpr));
      // Hard ceiling on rasterisation cost. A caret-sized rect is ~1-3k pixels
      // even at dpr 2; anything past this is a runaway (a smear mid-teleport
      // across a huge window) and is not worth a per-pixel loop on the hot
      // path, so it takes the cheap gradient for those frames instead.
      if (pw * ph > 60000) return null;

      // Offscreen surface + pixel buffer are reused across frames and only
      // reallocated when the size actually changes. Allocating a fresh
      // ImageData every frame would hand the GC a multi-kilobyte buffer 30
      // times a second for no reason.
      let ac = this._auroraCanvas;
      if (!ac || ac.width !== pw || ac.height !== ph) {
        // Detached scratch canvas; it is only ever drawn FROM.
        ac = this._auroraCanvas = createEl("canvas");
        ac.width = pw;
        ac.height = ph;
        this._auroraCtx = ac.getContext("2d");
        this._auroraImg = null;
      }
      const actx = this._auroraCtx;
      if (!actx) return null;
      let img = this._auroraImg;
      if (!img || img.width !== pw || img.height !== ph) {
        img = this._auroraImg = actx.createImageData(pw, ph);
      }
      const data = img.data;

      const speed = this.look.energySpeed ?? 1;
      const t = (performance.now() / 1000) * speed;

      // Quantise the ramp once per frame into a lookup table. sampleRamp
      // allocates a fresh array per call, so calling it per pixel would mean
      // thousands of short-lived arrays every frame; 96 entries is far finer
      // than the eye resolves across a caret and costs 96 calls instead.
      const LUT = 96;
      let lut = this._auroraLut;
      if (!lut || lut.length !== LUT * 3) lut = this._auroraLut = new Float32Array(LUT * 3);
      for (let i = 0; i < LUT; i++) {
        const s = this.sampleRamp(i / LUT, true);
        lut[i * 3] = s[0];
        lut[i * 3 + 1] = s[1];
        lut[i * 3 + 2] = s[2];
      }

      const a255 = Math.max(0, Math.min(255, Math.round(alpha * 255)));
      const invW = 1 / pw, invH = 1 / ph;

      for (let py = 0; py < ph; py++) {
        const v = py * invH;
        for (let px = 0; px < pw; px++) {
          const u = px * invW;

          // Domain warp. Each term mixes u and v, which is the whole point:
          // a term in v alone reproduces the old flat horizontal banding, and
          // it's the cross terms that let a band bend as it crosses the
          // cursor. Three incommensurate frequencies so the pattern never
          // settles into a visible repeat.
          const warp =
            Math.sin(v * 4.1 + t * 0.90 + u * 2.3) * 0.20 +
            Math.sin(v * 7.3 - t * 0.60 + u * 3.7) * 0.11 +
            Math.sin(u * 5.2 + t * 1.10 - v * 1.9) * 0.15;

          // Base coordinate drifts along the cursor; the warp bends it.
          let s = v - t * 0.30 + warp * wav;

          // Second, slower read from a different stretch of the ramp, cross
          // faded in. The warp only rearranges colours - without this, two
          // stops far apart on the ramp never meet and never blend.
          const mix = (0.5 + 0.5 * Math.sin(u * 2.1 + v * 2.3 + t * 0.7)) * 0.55;
          let s2 = (v * 0.45 + u * 0.25) + t * 0.17 + 0.37;

          // Index the LUT cyclically (positive modulo: s can go negative).
          let i1 = ((Math.floor(s * LUT) % LUT) + LUT) % LUT;
          let i2 = ((Math.floor(s2 * LUT) % LUT) + LUT) % LUT;
          i1 *= 3; i2 *= 3;

          let r = lut[i1] + (lut[i2] - lut[i1]) * mix;
          let g = lut[i1 + 1] + (lut[i2 + 1] - lut[i1 + 1]) * mix;
          let b = lut[i1 + 2] + (lut[i2 + 2] - lut[i1 + 2]) * mix;

          // Brightness wave, kept gentle for the same reason the gradient path
          // eases it: at full strength it repeatedly flattens the mix toward
          // white and black and the swirl stops being legible.
          const pulse = 0.5 + 0.5 * Math.sin((v - t * 0.6) * Math.PI * 2 + u * 1.4);
          if (pulse > 0.5) {
            const k = (pulse - 0.5) * 2 * 0.45;
            r += (255 - r) * k * 0.55;
            g += (255 - g) * k * 0.55;
            b += (255 - b) * k * 0.55;
          } else {
            const k = (0.5 - pulse) * 2 * 0.45;
            r -= r * k * 0.45;
            g -= g * k * 0.45;
            b -= b * k * 0.45;
          }

          const o = (py * pw + px) * 4;
          data[o] = r < 0 ? 0 : r > 255 ? 255 : r;
          data[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
          data[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
          data[o + 3] = a255;
        }
      }

      actx.putImageData(img, 0, 0);
      const pat = ctx.createPattern(ac, "no-repeat");
      if (!pat) return null;
      // Map the bitmap's pixel space onto user space: one bitmap pixel is
      // 1/dpr user units, and its origin sits at the padded rect's corner.
      // Without this the pattern would anchor at the canvas origin and the
      // cursor would show whatever slice of the field happened to be there.
      if (typeof pat.setTransform === "function" && typeof DOMMatrix === "function") {
        pat.setTransform(new DOMMatrix().translateSelf(x0, y0).scaleSelf(1 / dpr, 1 / dpr));
      } else {
        return null; // no way to position it correctly; use the gradient
      }
      return pat;
    } catch {
      // createPattern refuses a zero-sized source; the gradient is used instead.
      return null;
    }
  },

  createEnergyGradient(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, baseColor: string, alpha: number) {
    const ctx = this.ctx;
    if (!ctx) return hexToRgba(baseColor, alpha);
    const speed = this.look.energySpeed ?? 1;
    const t = (performance.now() / 1000) * speed;
    const base = hexToRgbTuple(baseColor);
    const rampOn = !!this.look.gradientEnabled;
    const aurora = rampOn && !!this.look.energyAurora;

    const grad = ctx.createLinearGradient(x + w / 2, y + h, x + w / 2, y);
    // A scrolling multi-colour ramp needs more stops than a single-hue beam:
    // every stop is a linear segment, and 6 of them across a 4-colour cycle
    // renders as visible facets rather than a smooth flow. Aurora warps the
    // sample position on top of that, so it needs finer steps again or the
    // warp itself shows up as kinks.
    const stops = aurora ? 20 : rampOn ? 12 : 6;
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops;
      const pulse = 0.5 + 0.5 * Math.sin((pos - t * 0.6) * Math.PI * 2);

      // With Gradient on the beam becomes an *animated* gradient: the ramp
      // itself scrolls along the cursor (sampled cyclically, so there's no
      // seam where it wraps) and the beam's brightness wave rides on top of
      // it. With Gradient off this is unchanged - one base colour, pulse only.
      let bs;
      if (aurora) {
        // Aurora: instead of sliding the ramp rigidly, warp where each point
        // samples it using three sine waves at unrelated frequencies and
        // speeds. Because they never line up into a repeating pattern, the
        // colours stretch and compress against each other and appear to swirl
        // rather than march past.
        const warp =
          Math.sin(pos * 3.1 + t * 0.85) * 0.26 +
          Math.sin(pos * 5.7 - t * 0.55) * 0.14 +
          Math.sin(pos * 1.3 + t * 1.25) * 0.20;
        const near = this.sampleRamp(pos - t * 0.3 + warp, true);
        // A second, slower read from a different part of the ramp, cross-faded
        // into the first. This is what actually *mixes* the colours - the warp
        // alone only rearranges them, so two stops far apart on the ramp would
        // never meet.
        const far = this.sampleRamp(pos * 0.45 + t * 0.17 + 0.37, true);
        const mix = (0.5 + 0.5 * Math.sin(pos * 2.3 + t * 0.7)) * 0.6;
        bs = [
          near[0] + (far[0] - near[0]) * mix,
          near[1] + (far[1] - near[1]) * mix,
          near[2] + (far[2] - near[2]) * mix,
        ];
      } else {
        bs = rampOn ? this.sampleRamp(pos - t * 0.35, true) : base;
      }
      let r = bs[0], g = bs[1], b = bs[2];
      // Aurora is carried by its colours, so the beam's hard bright/dark pulse
      // is eased off here - at full strength it repeatedly flattens the mix to
      // near-white and near-black and the swirl stops being legible.
      const punch = aurora ? 0.45 : 1;
      if (pulse > 0.5) {
        const k = (pulse - 0.5) * 2 * punch;
        r += (255 - r) * k * 0.55;
        g += (255 - g) * k * 0.55;
        b += (255 - b) * k * 0.55;
      } else {
        const k = (0.5 - pulse) * 2 * punch;
        r -= r * k * 0.45;
        g -= g * k * 0.45;
        b -= b * k * 0.45;
      }

      // Per-channel hue drift. This is what gives the single-colour beam its
      // iridescence, but it actively fights a gradient - the user picked those
      // colours exactly, and ±14 per channel visibly muddies them - so with a
      // ramp on, the scroll above supplies the motion instead.
      if (!rampOn) {
        const shift = 14;
        r += Math.sin(t * 0.7 + pos * 6) * shift;
        g += Math.sin(t * 0.7 + pos * 6 + 2.1) * shift;
        b += Math.sin(t * 0.7 + pos * 6 + 4.2) * shift;
      }

      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));

      grad.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  },

  // The two serif brackets of an I-beam caret, as corner quads ready to add
  // to the stem's path.
  //
  // Two things this fixes over the pair of fillRects it replaces.
  //
  // ANCHORING. fillCursorShape ignores the rect it is handed whenever Motion
  // Smear is on and fills the spring's quad instead - but the serifs were
  // positioned from `active`, the RESTING geometry. So the moment the caret
  // moved, the stem leaned and stretched away while the serifs stayed nailed
  // to where it had been, leaving two horizontal bars floating next to a
  // detached stem. With smear on by default that was the common case, not an
  // edge case. Here they take their centres from the smeared quad's own top
  // and bottom edges, so they travel with the stem.
  //
  // They stay AXIS-ALIGNED while doing it. Shearing a serif with the quad
  // makes it read as a broken glyph, which is what the original comment was
  // rightly worried about - but the answer to that is to keep them level,
  // not to leave them behind.
  //
  // SHAPE. A real I-beam's serifs are brackets: they thin as they approach
  // the stem rather than butting into it at full weight. Each one is a
  // trapezoid, widest at its outer edge, narrowing by SERIF_TAPER where it
  // meets the stem. Returns the union bounds too, so the caller can size a
  // gradient or pattern over the whole glyph rather than the stem alone.
  serifQuads(this: CursorSmithPlugin, active: CaretRecord, rx: number, rw: number) {
    const stem = rw;
    const lineH = active.h;

    // Clamped against BOTH the stem and the line height - see the constants.
    const thickness = Math.max(
      1,
      Math.round(Math.min(stem * SERIF_STEM_RATIO, lineH * SERIF_HEIGHT_RATIO)),
    );

    const charW = active.actualCharWidth;
    const raw = charW && charW > 0 ? charW : stem * 7;
    const span = Math.max(SERIF_MIN_SPAN_PX, Math.min(raw, lineH * SERIF_MAX_SPAN_RATIO));

    // Follow the smeared body's top and bottom edges - but ride the LEADING
    // end of each, not its midpoint.
    //
    // Midpoints were the first fix, and they are right for a vertical move:
    // there the smear stretches the long side edges and leaves the top and
    // bottom edges the caret's own width, so a midpoint IS the stem's end.
    // On a horizontal move it is the top and bottom edges themselves that
    // stretch, and their midpoint is then the middle of the streak while the
    // caret is at its front. Measured on a 300px move with Smooth Movement
    // on: the stem spanned 189 -> 348 and both brackets sat at 268, eighty
    // pixels behind the caret. Reported as the serifs travelling at a
    // different speed from the cursor, which is exactly what it looks like.
    //
    // So: find which corner of each edge leads (project the edge onto the
    // held travel direction), then walk back along the edge by half the
    // caret's OWN width. That lands the bracket centred on the caret's real
    // footprint at the head of the smear. When the edge is only as long as
    // the caret is wide - no smear, or a purely vertical one - half its width
    // back from either corner is the midpoint, so this reduces exactly to the
    // old behaviour everywhere it was already correct.
    const c = this.cursorCorners(rx, active.top, rw, lineH);
    const dir = this._smearDir;
    const anchor = (a: Pt, b: Pt) => {
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (!(len > 0.001)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // `a` leads only if the edge runs against the direction of travel.
      const aLeads = !!dir && (ex * dir.x + ey * dir.y) < 0;
      const lead = aLeads ? a : b;
      const sign = aLeads ? -1 : 1;
      const back = Math.min(len, stem) / 2;
      return {
        x: lead.x - sign * (ex / len) * back,
        y: lead.y - sign * (ey / len) * back,
      };
    };
    const top = anchor(c.tl, c.tr), bot = anchor(c.bl, c.br);
    const topCx = top.x, topCy = top.y;
    const botCx = bot.x, botCy = bot.y;

    const half = span / 2;
    const inset = half * SERIF_TAPER;

    // Top bracket: full span along its outer (upper) edge, narrowed where it
    // meets the stem. Bottom is the same shape mirrored.
    const quads = [
      {
        tl: { x: topCx - half, y: topCy },
        tr: { x: topCx + half, y: topCy },
        br: { x: topCx + half - inset, y: topCy + thickness },
        bl: { x: topCx - half + inset, y: topCy + thickness },
      },
      {
        tl: { x: botCx - half + inset, y: botCy - thickness },
        tr: { x: botCx + half - inset, y: botCy - thickness },
        br: { x: botCx + half, y: botCy },
        bl: { x: botCx - half, y: botCy },
      },
    ];

    return {
      quads,
      left: Math.min(topCx, botCx) - half,
      right: Math.max(topCx, botCx) + half,
      // A serif is a thin bar, so it rounds on its own thickness rather than
      // on the stem's width - otherwise a rounded Box-sized radius would eat
      // the whole bracket.
      radius: this.cornerRadius(thickness),
    };
  },

  drawGenericCaret(this: CursorSmithPlugin, isUnderline = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const active = this.animActive;
    const now = performance.now();
    const trailColor = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    // Same single alpha term the Box style uses (see drawBoxCursor): the blend
    // that does the visible work is layer-level, in applyCanvasBlend, and this
    // just takes the paint fractionally off full so the caret sits in the text
    // rather than on it. Applied to the trail as well as the live caret, so
    // the two never drift apart.
    const bodyOpacity = this.styleFor("cursorTranslucent")
      ? opacity * TRANSLUCENT_ALPHA
      : opacity;

    ctx.save();
    this.forEachTrailPoint((p, alpha, age) => {
      if (settings.crtNeon) {
        // Neon draws the caret's OWN footprint as a glowing tube: the same
        // width as the live cursor (a thin stem for Line, the bar for
        // Underline, the char box for Box) and the full caret height. No
        // reshaping - the tail matches the cursor instead of ballooning into a
        // height-wide ribbon.
        if (isUnderline) {
          const uThickness = this.underlineThickness(p.h);
          const ty = p.y + p.h - uThickness;
          this.drawNeonGhost(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, alpha * bodyOpacity, age, trailColor);
        } else {
          this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, alpha * bodyOpacity, age, trailColor);
        }
      } else if (isUnderline) {
        const uThickness = this.underlineThickness(p.h);
        const ty = p.y + p.h - uThickness;
        // Build the paint from the bar's own rect, not the full line box:
        // a ramp spanning the whole line height would show only the sliver
        // of itself that happens to fall across the bar.
        ctx.fillStyle = this.trailPaint(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, alpha * bodyOpacity, age, trailColor);
        this.fillTrailRect(ctx, p.x, ty, p.w, uThickness);
      } else {
        ctx.fillStyle = this.trailPaint(ctx, p, alpha * bodyOpacity, age, trailColor);
        this.fillTrailRect(ctx, p.x, p.y, p.w, p.h);
      }
    });
    ctx.restore();

    if (!active) return;
    const blinkAlpha = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";

    ctx.save();
    if (settings.crtEffect && settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * blinkAlpha * this.glowHeatScale();
    }

    let rx, ry, rw, rh;
    if (isUnderline) {
      const uThickness = this.underlineThickness(active.h);
      rx = active.x;
      ry = active.top + active.h - uThickness;
      rw = active.actualCharWidth;
      rh = uThickness;
    } else {
      rx = active.x;
      ry = active.top;
      rw = this.renderWidth(active);
      rh = active.h;
    }

    // Signal Glitch replaces the caret body for the length of a burst. For a
    // Line caret the slices are only a couple of px wide, so the channel split
    // does most of the visible work here; for Underline the bar is wide and it
    // is the slicing that dominates. Both go through the same routine as the
    // Box style so the effect is recognisably the same feature everywhere.
    const gsGen = settings.crtEffect && settings.crtGlitch
      ? this.glitchState(now) : null;

    // Line + serifs = classic I-beam. Only for the Line style: an underline
    // is already a horizontal bar, so capping it with two more reads as a
    // stack of lines rather than a glyph.
    const wantSerifs = !isUnderline && settings.lineSerifs && !gsGen;
    const serifs = wantSerifs ? this.serifQuads(active, rx, rw) : null;

    if (gsGen) {
      this.paintGlitchRect(ctx, rx, ry, rw, rh, color, 0.9 * blinkAlpha * bodyOpacity, gsGen);
    } else {
      // The paint is built over the union of stem and serifs, not the stem
      // alone. With Energy Beam + Aurora the fill is a NO-REPEAT pattern
      // sized to the rect it is handed, and a serif reaches several times the
      // stem's width to either side - so a stem-sized pattern left most of
      // each serif outside the bitmap, painting it fully transparent. The
      // serifs simply did not exist in that mode.
      let px = rx, pw = rw;
      if (serifs) {
        px = Math.min(rx, serifs.left);
        pw = Math.max(rx + rw, serifs.right) - px;
      }
      ctx.fillStyle = settings.energyEffect
        ? this.energyPaint(px, ry, pw, rh, color, 0.9 * blinkAlpha * bodyOpacity)
        : this.cursorPaint(px, ry, pw, rh, color, 0.9 * blinkAlpha * bodyOpacity);

      // Stem and serifs go into ONE path and take ONE fill.
      //
      // They used to be three separate fills sharing a fillStyle whose alpha
      // is 0.9 - so every serif was painted at 90% over a stem already at
      // 90%, compositing the overlaps to 99% and making the two crossings
      // visibly denser than the rest of the caret. The armed glow made it
      // worse: canvas casts a shadow per fill, so the intersections got a
      // doubled halo too, and under Translucent the layer blend amplified
      // the double-paint rather than hiding it.
      //
      // Non-zero winding fills overlapping subpaths as their union, so one
      // fill gives uniform alpha across the whole I-beam and a single shadow
      // cast from its combined outline.
      ctx.beginPath();
      this.traceQuad(
        ctx,
        this.cursorCorners(rx, ry, rw, rh),
        this.cornerRadius(Math.min(rw, rh)),
      );
      if (serifs) {
        for (const q of serifs.quads) this.traceQuad(ctx, q, serifs.radius);
      }
      ctx.fill();
    }
    ctx.restore();
  },

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

  drawBoxCursor(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const now = performance.now();
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const hollow = this.styleFor("boxHollow");
    const strokeW = hollow ? Math.max(1, Math.min(6, settings.boxHollowWidth || 2)) : 0;

    // Translucency is a flat multiplier on the alpha, applied everywhere this
    // style builds one - body, hollow outline, neon ghost and trail alike - so
    // the caret can't come apart from the tail it's dragging. The blend that
    // does the real work is layer-level; see applyCanvasBlend.
    const translucent = !!this.styleFor("cursorTranslucent");
    const bodyOpacity = translucent ? opacity * TRANSLUCENT_ALPHA : opacity;

    ctx.save();
    this.forEachTrailPoint((p, alpha, age) => {
      if (settings.crtNeon) {
        // Neon draws the box's own footprint as a glowing tube - the same
        // width and height as the live box cursor, filled even when the box is
        // hollow (a hollow outline of a glowing tail just reads as noise).
        this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, alpha * bodyOpacity, age, color);
      } else if (hollow) {
        ctx.strokeStyle = this.trailPaint(ctx, p, alpha * bodyOpacity, age, color);
        ctx.lineWidth = strokeW;
        // Inset by half the stroke so the outline lands inside the same
        // footprint the filled trail dot would occupy (canvas strokes
        // straddle the path centerline).
        const inset = strokeW / 2;
        const iw = Math.max(0, p.w - strokeW), ih = Math.max(0, p.h - strokeW);
        const rr = this.cornerRadius(Math.min(iw, ih));
        if (rr > 0.01) {
          ctx.beginPath();
          this.traceRoundedRect(ctx, p.x + inset, p.y + inset, iw, ih, rr);
          ctx.stroke();
        } else {
          ctx.strokeRect(p.x + inset, p.y + inset, iw, ih);
        }
      } else {
        ctx.fillStyle = this.trailPaint(ctx, p, alpha * bodyOpacity, age, color);
        this.fillTrailRect(ctx, p.x, p.y, p.w, p.h);
      }
    });
    ctx.restore();

    const active = this.animActive;
    if (active) {
      const blinkAlpha = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);

      ctx.save();
      if (settings.crtEffect && settings.glow) {
        // Canvas draws a shape's shadow BEHIND that shape, so the halo of a
        // solid box lands exactly where you want it - visible around the
        // outside, hidden under the fill. Nothing extra is needed: just arm
        // the shadow and paint the box normally, the same as the Line and
        // Underline styles do.
        //
        // This used to "seed" the shadow with a ghost pre-fill at alpha 0.01
        // and then set shadowBlur back to 0 before the real paint, which meant
        // the box got no glow at all: a canvas shadow inherits the alpha of
        // the shape casting it, so a 0.01-alpha ghost casts a 0.01-alpha
        // shadow (invisible), and zeroing the blur afterwards disarmed the
        // only paint that could have produced a visible one. Hollow boxes
        // looked fine purely because they skipped that branch. Don't
        // reintroduce a pre-fill pass here.
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * blinkAlpha * this.glowHeatScale();
      }

      // Signal Glitch takes over the body of the cursor entirely while a burst
      // is live - it replaces the fill/stroke rather than layering on top,
      // because the whole point is that the cursor's own form comes apart. The
      // glow armed above still applies, so the break-up keeps its halo.
      // Resolved before paintStyle so a burst skips the (possibly expensive,
      // e.g. Aurora's per-pixel raster) beam paint it's about to discard.
      const gsBox = settings.crtEffect && settings.crtGlitch
        ? this.glitchState(now) : null;

      if (gsBox) {
        this.paintGlitchRect(
          ctx, active.x, active.top, renderW, active.h,
          color, 0.9 * blinkAlpha * bodyOpacity, gsBox,
        );
      } else {
      const paintStyle = settings.energyEffect
        ? this.energyPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * bodyOpacity)
        : this.cursorPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * bodyOpacity);
      if (hollow) {
        // Stroke exactly the path the solid style fills, so the outline
        // deforms with a smear and rounds with Rounded Corners rather than
        // staying a sharp rectangle while the filled version curves. This
        // used to duplicate the corner logic inline, which is why the two
        // could drift apart at all.
        ctx.strokeStyle = paintStyle;
        ctx.lineWidth = strokeW;
        ctx.lineJoin = "miter";
        ctx.beginPath();
        this.traceQuad(
          ctx,
          this.cursorCorners(active.x, active.top, renderW, active.h),
          this.cornerRadius(Math.min(renderW, active.h)),
        );
        ctx.stroke();
      } else {
        ctx.fillStyle = paintStyle;
        this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
      }
      }
      ctx.restore();

      // Character-inside-box only makes sense when the box is filled
      // (invert-color glyph on a solid background). On a hollow outline
      // the real character is already visible through the middle, so
      // drawing an inverted glyph on top would duplicate it. It is also
      // suppressed mid-glitch: the box it is supposed to sit inside has been
      // torn into displaced slices, so a crisp centred glyph floating over the
      // wreckage reads as a rendering bug rather than part of the effect.
      //
      // Translucency suppresses it for the same reason hollow does, plus a
      // colour one. The real character shows through a translucent box, so an
      // inverted copy on top is a doubling artifact - and worse, the
      // inversion is calibrated against a SOLID fill: with the layer in
      // multiply/screen the inverted glyph is exactly the wrong polarity for
      // the blend (a dark glyph screened over a dark theme, a light one
      // multiplied over a light theme), so it would mostly disappear anyway.
      const displayChar = this.pending ? this.pending.holdChar : (active.holdChar || active.char);

      // The glyph fades WITH the box, at the same rate.
      //
      // Two wrong answers preceded this one. It was originally
      // `0.3 + blinkAlpha * 0.7`, which floors at 0.3 and never reaches zero,
      // so a blinked-off box still had an inverted ghost of the letter lying
      // on top of the real character. Cubing it fixed that but overshot
      // badly in the other direction: the letter was down to 0.13 while the
      // box was still at 0.46, so for most of every fade the cursor was a
      // solid block with nothing in it. That is only easy to miss when
      // Smooth Movement is on, because its 450ms stop-blink hold keeps the
      // caret lit right after a keystroke - which is exactly why the letter
      // looked like it only existed with smooth movement enabled.
      //
      // Tracking the box linearly is right because the box and the letter
      // are ONE object. They fade together, and the real character emerges
      // underneath as they go. There is no double image to avoid: the
      // inverted glyph and the real one occupy the same pixels in the same
      // shape, so a partial blend reads as the letter changing colour, not
      // as two letters. And it still reaches zero, which was the whole point
      // of the first fix.
      const glyphAlpha = Math.min(1, bodyOpacity * blinkAlpha);
      if (!hollow && !translucent && !gsBox && settings.showChar && displayChar
          && glyphAlpha >= 0.01) {
        ctx.save();
        ctx.globalAlpha = glyphAlpha;
        // `color` is the box's own fill (getActiveColor, so heat- and
        // gradient-resolved). With Gradient on this is the ramp's FIRST stop
        // rather than the exact shade under the glyph - the fill varies across
        // the box, so no single reference is exact - but it's in the right
        // family, which is all the contrast floor needs to work from.
        //
        // Cached on the colour string: this runs every frame, the input
        // changes only when the cursor colour or heat does, and the scan
        // inside is a handful of pow() calls per step.
        const glyphMode = this.styleFor("glyphColorMode") || "contrast";
        if (this._glyphColorFor !== color || this._glyphColorMode !== glyphMode) {
          this._glyphColorFor = color;
          this._glyphColorMode = glyphMode;
          this._glyphColorVal = readableGlyphColor(color, glyphMode);
        }
        ctx.fillStyle = this._glyphColorVal;
        // Route through the same builder measureCharWidth uses, so the glyph
        // is drawn in the SAME weight/style the box was sized for. Building
        // this string without weight/style here (while the width was measured
        // WITH them) is exactly what made the character sit slimmer/fatter and
        // off-baseline over bold, italic, and heading text.
        ctx.font = this.fontString(active.fontSize, active.fontFamily, active.fontWeight, active.fontStyle);

        // Canvas's "middle" baseline centers a glyph within its own font
        // em-box (roughly ascent/descent of the font itself), but active.h
        // is the rendered *line height*, which is usually taller than that
        // em-box (CSS line-height adds extra leading above/below the
        // glyph). Centering purely on font metrics ignores that leading and
        // makes the drawn character sit noticeably higher than the real
        // text, which is vertically centered within the full line box.
        // Measuring real ascent/descent and centering the glyph's em-box
        // inside active.h (the same way the browser centers line content)
        // lines it up with where the actual character renders.
        const metrics = ctx.measureText(displayChar);
        const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? active.fontSize * 0.8;
        const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? active.fontSize * 0.2;
        const glyphBoxHeight = ascent + descent;
        const leading = active.h - glyphBoxHeight;
        const baselineY = active.top + ascent + leading / 2;

        // Center on the glyph's own advance, not renderW: for a Box cursor
        // renderW is charWidth, which INCLUDES letter-spacing, so centering on
        // it would shift the glyph right by half the spacing (the browser puts
        // spacing after the glyph, not around it). Subtracting letterSpacing
        // back out lines our glyph up with where the real one renders. Zero
        // letter-spacing (the common case) makes this identical to before.
        const glyphAdvance = Math.max(1, (active.actualCharWidth ?? renderW) - (active.letterSpacing || 0));
        // On whole device pixels. The caret's coordinates are fractional
        // (coordsAtPos), and canvas text laid down at a fractional baseline
        // is resampled across two rows of pixels - the letter looked soft
        // next to the real one, which the browser snaps. The canvas is
        // scaled by the device pixel ratio and offset by the region's
        // origin (resizeCanvas), so a device pixel is 1/dpr CSS pixels from
        // that origin, not from zero.
        const dpr = this._canvasDpr || 1;
        const region = this._canvasRect;
        const ox = region ? region.x : 0, oy = region ? region.y : 0;
        const snapX = (v: number) => Math.round((v - ox) * dpr) / dpr + ox;
        const snapY = (v: number) => Math.round((v - oy) * dpr) / dpr + oy;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(displayChar, snapX(active.x + glyphAdvance / 2), snapY(baselineY));
        ctx.restore();
      }
    }
  },

  updateSmearQuad(this: CursorSmithPlugin) {
    const now = performance.now();
    // Two separate clocks, deliberately. _smearDtT is the frame delta for the
    // spring integrator and must advance every single call. smearQuadLastMoveT
    // is the last time the quad was genuinely in motion, and is what the frame
    // governor ages out against. These used to be one variable, which meant
    // the governor's `now - smearQuadLastT < 1200` test was comparing now
    // against a timestamp set microseconds earlier in the same frame - always
    // true, so an enabled smear latched the hot gear on forever.
    //
    // Do not "fix" that by making the delta clock conditional: a stale delta
    // clamps to 0.05, and the spring is explicit Euler that only stays stable
    // while dt < 2/freq (~0.05 at the maximum stiffness of 40). The first
    // frame after a wake would integrate right at the stability boundary and
    // visibly jolt.
    if (!this._smearDtT) this._smearDtT = now;
    let dt = (now - this._smearDtT) / 1000;
    this._smearDtT = now;
    dt = Math.min(dt, 0.05);

    const settings = this.look;
    const rect = settings.smear ? this.getActiveRect() : null;

    if (!rect) {
      this.smearQuad = null;
      this.smearShape = null;
      this.smearCenterPrev = null;
      this._smearLead = null;
      this._smearTrail = null;
      this._smearMoving = false;
      return;
    }

    // The quad is the caret swept along its travel: a leading face and a
    // trailing face, each the caret's own rectangle, and the four corners
    // between them. It is built from TWO tracked points - where the leading
    // face's origin is and where the trailing face's is - and every corner
    // is an affine blend of the two by how much of it trails (`rear`, below).
    // A parallelogram by construction, in every frame, whatever the two
    // points are doing: four independent corner springs were eight degrees
    // of freedom for a two-degree shape, and the surplus was where the
    // warping lived (HANDOFF §2 - five patches that each tried to constrain
    // it after the fact, and this is the shape they were approximating).
    //
    // The leading point is a spring (Stiffness, Damping - it may overshoot
    // and snap back, which is the feel). The trailing point is a first-order
    // lag behind the leading one (Trailing stiffness): no state but its
    // position, so it can neither rotate nor boomerang, and it settles as
    // the leading point does. The three sliders keep their meaning.
    const target = { x: rect.x, y: rect.y };
    const offsets = { tl: { x: 0, y: 0 }, tr: { x: rect.w, y: 0 }, br: { x: rect.w, y: rect.h }, bl: { x: 0, y: rect.h } };

    if (!this.smearQuad || !this._smearLead || !this._smearTrail) {
      this._smearLead = { x: target.x, y: target.y, vx: 0, vy: 0 };
      this._smearTrail = { x: target.x, y: target.y };
      this.smearQuad = {} as SmearQuad;
      for (const key of Object.keys(offsets) as QuadKey[]) {
        this.smearQuad[key] = { x: target.x + offsets[key].x, y: target.y + offsets[key].y, vx: 0, vy: 0 };
      }
      this.smearCenterPrev = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      this.smearShape = this.smearQuad;
      this._smearMoving = false;
      return;
    }

    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    let dirX = 0, dirY = 0;
    if (this.smearCenterPrev) {
      dirX = center.x - this.smearCenterPrev.x;
      dirY = center.y - this.smearCenterPrev.y;
    }
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen > 0.01) {
      // Held past the frame it was measured on: once the caret stops, the quad
      // spends several more frames catching up, and the tail has to keep
      // pointing back the way it came while it does.
      this._smearDir = { x: dirX / dirLen, y: dirY / dirLen };
    }
    this.smearCenterPrev = center;

    // Motion Smear sits DOWNSTREAM of Smooth Movement: this spring chases
    // getActiveRect(), which is built from animActive - itself still catching up
    // to the real caret. The two lags ADD, so with both effects on the painted
    // cursor trails further behind than the Smooth Movement sliders alone
    // suggest, and Max Catch-Up Speed looked broken: it was only ever speeding
    // up the first of the two stages, while the second stayed as slow as it had
    // always been. Carrying the same boost through fixes that.
    //
    // Only the LEADING point gets it. The smear you see is the gap between the
    // leading and trailing edges, so boosting both would fix the lag by
    // deleting the effect; boosting just the front means the cursor keeps up
    // AND smears harder, which is the right answer for both.
    //
    // Capped: the boost can reach ~13x on extreme slider combinations, and past
    // about 6x the leading edge is already arriving within a frame or two - the
    // rest buys nothing and only eats into the explicit integrator's stability
    // margin (stable while h < 2/freq, and h is held at or under 1/240 below).
    const leadBoost = settings.smoothEnabled
      ? Math.max(1, Math.min(SMEAR_LEAD_BOOST_CAP, this._catchUpBoost || 1))
      : 1;
    const freqLead = (2 + Math.max(0, Math.min(1, settings.smearStiffness)) * 38) * leadBoost;
    const freqTrail = 2 + Math.max(0, Math.min(1, settings.smearTrailingStiffness)) * 38;
    const dampingRatio = 0.15 + Math.max(0, Math.min(1, settings.smearDamping)) * 1.15;

    // Integrate on a fixed sub-step instead of the raw frame delta. This is
    // semi-implicit Euler, stable only while dt < 2/freq; freq reaches 40, so
    // the limit is dt = 0.05 - which is exactly the clamp above, and exactly
    // what the 100ms idle gear delivers. That made the spring's behaviour
    // depend on the gear while the gear depended on whether the spring was
    // moving: a closed feedback loop that kicked a settled quad back into
    // motion on every idle frame, flipping the gear thousands of times a
    // minute and cycling the GPU up and down on a completely idle editor.
    // A fixed sub-step makes the spring frame-rate independent, so it behaves
    // identically in every gear and at every display refresh rate.
    const MAX_STEP = 1 / 240;
    const steps = Math.max(1, Math.min(16, Math.ceil(dt / MAX_STEP)));
    const h = dt / steps;

    const lead = this._smearLead;
    const trail = this._smearTrail;
    const k = freqLead * freqLead;
    const damp = 2 * dampingRatio * freqLead;
    for (let i = 0; i < steps; i++) {
      const ax = k * (target.x - lead.x) - damp * lead.vx;
      const ay = k * (target.y - lead.y) - damp * lead.vy;
      lead.vx += ax * h;
      lead.vy += ay * h;
      lead.x += lead.vx * h;
      lead.y += lead.vy * h;
      // The trailing point: an exponential approach to the leading one,
      // unconditionally stable at any step.
      const f = 1 - Math.exp(-freqTrail * h);
      trail.x += (lead.x - trail.x) * f;
      trail.y += (lead.y - trail.y) * f;
    }
    if (!isFinite(lead.x) || !isFinite(lead.y) || !isFinite(lead.vx) || !isFinite(lead.vy) || !isFinite(trail.x) || !isFinite(trail.y)) {
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
    }
    // Max length caps how far the tail trails the head, in the state, so
    // the tail arrives sooner rather than just being drawn shorter.
    this.applySmearMaxLength(rect);

    // Which corners lead and which trail, and by how much. The rear FACE of
    // the rectangle trails, the front face leads; which face is the rear one
    // is decided by the area each face sweeps - the side faces sweep h*|dx|,
    // the top and bottom w*|dy| - and blended between the two by their share
    // (to the fourth power, so one clearly dominant axis wins outright and a
    // 3px-tall underline keeps square ends at a shallow angle), never by a
    // branch. The old rule projected each corner's offset as a unit vector
    // onto the travel, which for a stem is decided by the vertical component:
    // below atan(w/h) the caret sheared, above it the top corners trailed
    // and the bottom ones led - a rotation - and it snapped between the two.
    // The direction is the HELD one: once the caret stops, the fresh delta is
    // zero and the tail must keep pointing back the way it came while the
    // trailing point catches up.
    const dir = this._smearDir;
    const ax = dir ? Math.abs(dir.x) : 0, ay = dir ? Math.abs(dir.y) : 0;
    const hx = (rect.h * ax) ** 4, wy = (rect.w * ay) ** 4;
    const u = hx + wy > 0 ? hx / (hx + wy) : 0.5;
    const sgnX = dir ? Math.sign(dir.x) : 0, sgnY = dir ? Math.sign(dir.y) : 0;
    // The trailing point's velocity, for the corners' velocities (the taper
    // and the governor read them): the rate it closes on the leading point.
    const tvx = (lead.x - trail.x) * freqTrail, tvy = (lead.y - trail.y) * freqTrail;
    let moving = false;
    for (const key of Object.keys(offsets) as QuadKey[]) {
      const o = offsets[key];
      const sx = o.x > 0 ? 1 : -1;
      const sy = o.y > 0 ? 1 : -1;
      // +1 on the front face (the corner's offset points along the travel),
      // -1 on the rear face, between on a diagonal.
      const front = dir ? sx * sgnX * u + sy * sgnY * (1 - u) : 0;
      // 0 = at the leading point, 1 = at the trailing one.
      const f = (1 - front) / 2;
      const c = this.smearQuad[key];
      c.x = lead.x + (trail.x - lead.x) * f + o.x;
      c.y = lead.y + (trail.y - lead.y) * f + o.y;
      c.vx = lead.vx + (tvx - lead.vx) * f;
      c.vy = lead.vy + (tvy - lead.vy) * f;
      const tx = target.x + o.x, ty = target.y + o.y;
      // A corner still off its target, or still carrying velocity, means the
      // quad is visibly deforming and the loop must keep drawing.
      if (Math.abs(c.x - tx) > 0.5 || Math.abs(c.y - ty) > 0.5 || Math.abs(c.vx) > 0.1 || Math.abs(c.vy) > 0.1) moving = true;
    }

    this._smearMoving = moving;

    this.applySmearTaper({
      tl: { x: rect.x, y: rect.y }, tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h }, bl: { x: rect.x, y: rect.y + rect.h },
    }, center);
    this.applySmearVolume({
      tl: { x: rect.x, y: rect.y }, tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h }, bl: { x: rect.x, y: rect.y + rect.h },
    }, rect);
    if (moving) {
      this.smearQuadLastMoveT = now;
    } else {
      // Snap exactly onto the targets once settled, and kill the residual
      // velocity. Without this the quad keeps a sub-threshold offset that the
      // next long idle frame re-amplifies into visible motion. Mirrors what
      // updateSmoothCursor does for the caret itself.
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
      for (const key of Object.keys(offsets) as QuadKey[]) {
        const c = this.smearQuad[key];
        c.x = target.x + offsets[key].x;
        c.y = target.y + offsets[key].y;
        c.vx = 0;
        c.vy = 0;
      }
    }
  },

  // Cap how far the tail trails the caret. A page-down or a click across the
  // pane otherwise stretches the quad the whole way - a streak the height of
  // the pane that then takes its time contracting. With a cap, no corner may
  // lag its own target by more than the cap: a corner further out is pulled
  // in along its own line of travel until it is exactly the cap behind. The
  // caret keeps its shape - the leading corners are at their targets, the
  // trailing ones the cap behind them - and the taper does its own job on
  // what is left. This is written into the spring's STATE, deliberately:
  // the tail is meant to arrive sooner, not just to be drawn shorter.
  //
  // Not smear-cursor.nvim's version, which scales every corner toward the
  // one nearest its target: on a 9x24 box that collapses the tail to a point
  // at that corner's height, and the smear read as tapered the wrong way
  // round, narrow at the front (1.5.4, seen live).
  applySmearMaxLength(this: CursorSmithPlugin, rect: Rect) {
    const cap = this.look.smearMaxLength;
    const lead = this._smearLead, trail = this._smearTrail;
    if (!lead || !trail || !(cap > 0)) return;
    // The two tracked points, each at most `cap` from the target: the
    // corners are derived from them, so every corner's lag is capped with
    // them and the tail keeps the caret's full height.
    for (const p of [lead, trail]) {
      const dx = p.x - rect.x, dy = p.y - rect.y;
      const d = Math.hypot(dx, dy);
      if (d <= cap) continue;
      const f = cap / d;
      p.x = rect.x + dx * f;
      p.y = rect.y + dy * f;
    }
    // Velocity that was carrying the leading point further out is spent
    // against the cap; what remains is the part along the pull back in.
    // Without this the spring keeps throwing it past the cap every frame
    // and it sits there jittering instead of trailing cleanly.
    const dx = lead.x - rect.x, dy = lead.y - rect.y;
    const d = Math.hypot(dx, dy);
    if (d >= cap - 1e-9 && d > 0) {
      const away = (lead.vx * dx + lead.vy * dy) / d;
      if (away > 0) { lead.vx -= (dx / d) * away; lead.vy -= (dy / d) * away; }
    }
  },

  // Conserve the smear's area: a long streak gets thin. The quad's area is
  // compared with the caret's resting area and every corner is pulled toward
  // the centre ACROSS its own direction of travel by (rest / area) to the
  // strength, floored at SMEAR_VOLUME_MIN_FACTOR - so the stretch along the
  // move is untouched and only the width across it gives. After
  // smear-cursor.nvim's shrink_volume, with one change: the pull is weighted
  // by each corner's share of the lag, as the taper's is, so the leading
  // edge - the caret itself - keeps its full size and only the tail thins.
  // Their cursor IS the smear; ours has a caret at the front of it.
  //
  // Skipped on an axis-aligned move. A horizontal smear is a rectangle that
  // is wider than the caret, so conserving its area would thin the caret's
  // height while you type - the effect is for the diagonal streak of a
  // jump, where the parallelogram sweeps far more area than the caret has.
  //
  // Like the taper, this derives the painted corners and is never written
  // back into smearQuad: the spring integrates forward from its own state.
  applySmearVolume(this: CursorSmithPlugin, targets: Quad, rect: Rect) {
    const shape = this.smearShape;
    const strength = Math.max(0, Math.min(1, this.look.smearVolumeStrength ?? 0.3));
    if (!shape || !this.look.smearConserveVolume || strength <= 0) return;
    const cx = (shape.tl.x + shape.tr.x + shape.br.x + shape.bl.x) / 4;
    const cy = (shape.tl.y + shape.tr.y + shape.br.y + shape.bl.y) / 4;
    const tx = rect.x + rect.w / 2, ty = rect.y + rect.h / 2;
    // Axis-aligned: the centre has not moved off the target's row or column.
    if (Math.abs(tx - cx) < 1 || Math.abs(ty - cy) < 1) return;
    // Shoelace, over tl -> tr -> br -> bl.
    const pts = [shape.tl, shape.tr, shape.br, shape.bl];
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      area2 += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(area2) / 2;
    const rest = rect.w * rect.h;
    if (!(area > rest) || !(rest > 0)) return;
    const factor = Math.max(SMEAR_VOLUME_MIN_FACTOR, Math.pow(rest / area, strength / 2));
    if (factor >= 0.999) return;

    if (!this._volumeBuf) {
      this._volumeBuf = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    }
    const out = this._volumeBuf;
    let maxLag = 0;
    const lag: Record<string, number> = {};
    for (const k of Object.keys(targets) as QuadKey[]) {
      lag[k] = Math.hypot(targets[k].x - shape[k].x, targets[k].y - shape[k].y);
      if (lag[k] > maxLag) maxLag = lag[k];
    }
    if (maxLag < 0.01) return;
    for (const k of Object.keys(targets) as QuadKey[]) {
      const c = shape[k];
      // The corner's own direction of travel, and the normal to it.
      const mx = targets[k].x - c.x, my = targets[k].y - c.y;
      const ml = lag[k];
      if (ml < 0.01) { out[k].x = c.x; out[k].y = c.y; continue; }
      const nx = -my / ml, ny = mx / ml;
      // How far the corner sits from the centre across that direction.
      const proj = (c.x - cx) * nx + (c.y - cy) * ny;
      const shift = proj * (1 - factor) * (ml / maxLag);
      out[k].x = c.x - nx * shift;
      out[k].y = c.y - ny * shift;
    }
    this.smearShape = out;
  },

  // Derive the corners to PAINT from the corners the spring is holding.
  //
  // With Tapered Trail off this is just the quad itself, passed straight
  // through by reference - no copy, no work. With it on, the trailing end is
  // pulled in toward the line of travel so the smear comes to a point behind
  // the caret instead of dragging a full-width rectangle.
  //
  // The result is deliberately NOT written back into smearQuad. That object is
  // the spring's state, integrated forward from its own previous position: a
  // tapered corner stored there would become the position the next frame
  // springs from, so the corners would chase the narrowed shape and the taper
  // would eat the very lag it is drawn from. Derived fresh each frame and
  // thrown away.
  applySmearTaper(this: CursorSmithPlugin, targets: Quad, center: Pt) {
    const q = this.smearQuad;
    const amount = Math.max(0, Math.min(1, this.look.smearTaperAmount ?? 0.7));
    const dir = this._smearDir;
    if (!q || !this.look.smearTaper || amount <= 0 || !dir) {
      this.smearShape = q;
      return;
    }

    // How far each corner is lagging behind where it belongs. Corners at the
    // back of the move lag most and the ones at the front barely at all, which
    // is exactly the weighting a taper wants - the tail narrows, the leading
    // edge keeps its full width - so there's no need to work out which corner
    // is which, or to special-case diagonal movement.
    let maxLag = 0;
    const lag: Record<string, number> = {};
    for (const k of Object.keys(targets) as QuadKey[]) {
      const l = Math.hypot(q[k].x - targets[k].x, q[k].y - targets[k].y);
      lag[k] = l;
      if (l > maxLag) maxLag = l;
    }

    // Ramp the whole effect across the [MIN_LAG, FULL_LAG] band, zero below the
    // floor. The ratio between corners alone is ~1 for the laggiest corner no
    // matter how small the lag is, so without this a caret creeping one glyph
    // sideways would wear the same sharp point as one flung across the page -
    // and a resting cursor would sit there permanently misshapen. The floor is
    // what keeps the taper off during ordinary typing (see TAPER_MIN_LAG).
    const reach = Math.max(0, Math.min(1, (maxLag - TAPER_MIN_LAG) / (TAPER_FULL_LAG - TAPER_MIN_LAG)));
    if (reach <= 0.001) {
      this.smearShape = q;
      return;
    }

    // One reused buffer rather than four fresh objects per frame: this runs on
    // every frame of every move, and the corners are read and discarded within
    // the same frame.
    if (!this._taperBuf) {
      this._taperBuf = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    }
    const out = this._taperBuf;

    for (const k of Object.keys(targets) as QuadKey[]) {
      const c = q[k];
      const ox = c.x - center.x;
      const oy = c.y - center.y;
      // The part of the corner's offset that runs ACROSS the direction of
      // travel. Pulling it to zero puts the corner on the line of travel, so
      // pulling both trailing corners to zero closes that end to a point.
      const along = ox * dir.x + oy * dir.y;
      const px = ox - along * dir.x;
      const py = oy - along * dir.y;
      const w = (lag[k] / maxLag) * reach * amount;
      out[k].x = c.x - px * w;
      out[k].y = c.y - py * w;
    }
    this.smearShape = out;
  },

  // The four corners to paint the cursor through, or null when Motion Smear is
  // off and callers should use the plain caret rect instead.
  smearCorners(this: CursorSmithPlugin): Quad | null {
    if (!this.look.smear) return null;
    return this.smearShape || this.smearQuad;
  },

  // The painted quad reduced to a short string, for the draw-skip signature.
  // See the call site for why the quad has to be in that signature at all.
  _smearSig(this: CursorSmithPlugin) {
    const q = this.look.smear ? this.smearCorners() : null;
    if (!q) return "nosmear";
    let s = "";
    for (const k of ["tl", "tr", "br", "bl"] as const) {
      const c = q[k];
      if (!c) return "nosmear";
      s += Math.round(c.x * 2) + ":" + Math.round(c.y * 2) + ",";
    }
    return s;
  },
};
export type PaintMethods = typeof paintMethods;
