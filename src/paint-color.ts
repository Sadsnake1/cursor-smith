// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The cursor's colour: the active colour with Speed demon's heat, the
// base colour, the theme, the gradient ramp and its sampling, the paint for
// one fill, the heat ramps.

import { hexToRgbTuple, hexToRgba } from "./color";
import { GLOW_HEAT_GAIN, SPEED_RAMP_LIFTOFF } from "./constants";
import { easeInOutSine } from "./motion";
import { DEFAULT_SETTINGS } from "./settings";
import type { CursorSmithSettings, SettingKey } from "./types";
import type CursorSmithPlugin from "./plugin";

export const paintColorMethods = {
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
};
