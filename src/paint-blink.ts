// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The blink: its phase anchored to the caret's last move, the window the
// frame governor sleeps and wakes by, the alpha and the breathing scale.

import { blinkAlphaAt, blinkSegments } from "./motion";
import type CursorSmithPlugin from "./plugin";

export const paintBlinkMethods = {
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
    if (stopAfter > 0 && speed > 0 && elapsed >= stopAfter * blinkSegments(speed).period) return 1;

    return blinkAlphaAt(elapsed, speed, this.look.blinkOnOffBalance ?? 0.5, this.look.blinkFade ?? 0.15);
  },

  // What the blink does to opacity. Breathing swaps the fade out for a size
  // change, so the caret keeps full opacity throughout - never disappearing is
  // the entire point of that option.
  // When the blink next changes, for the frame governor: whether `now` is
  // inside one of the two fades (the loop must be awake, warm gear), and how
  // many ms until the phase next crosses into or out of a fade. Infinity
  // when the caret does not blink: off, speed 0, or gone solid (blink-to-
  // solid). During the post-move hold it is the hold's remainder plus the
  // lit segment of the first cycle. The clock and the segments are exactly
  // blinkPhase's, so what this schedules is what that will paint; a test
  // sweeps the two against each other. The idle gear used to sleep its
  // heartbeat through a fade's start and catch it up to 200 ms in, so the
  // caret popped where it should have eased.
  blinkWindow(this: CursorSmithPlugin, now: number): { fading: boolean; msToNext: number } {
    const none = { fading: false, msToNext: Infinity };
    if (!this.look.blinkingEnabled) return none;
    let holdMs = 0;
    if (this.look.smoothEnabled && this.look.smoothStopBlinking) holdMs = 450;
    const delayMs = Math.max(0, this.look.blinkDelayMs ?? 0);
    if (delayMs > holdMs) holdMs = delayMs;
    const speed = Math.max(0, this.look.blinkSpeed);
    if (speed <= 0) return none;
    const seg = blinkSegments(speed, this.look.blinkOnOffBalance ?? 0.5, this.look.blinkFade ?? 0.15);
    const elapsed = now - (this.lastMoveTime + holdMs);
    const stopAfter = Math.max(0, Math.round(this.look.blinkStopAfter ?? 0));
    if (stopAfter > 0 && elapsed >= stopAfter * seg.period) return none;
    if (!(elapsed > 0)) return { fading: false, msToNext: -elapsed + seg.p1 * seg.period };
    const phase = (elapsed % seg.period) / seg.period;
    if (phase < seg.p1) return { fading: false, msToNext: (seg.p1 - phase) * seg.period };
    if (phase < seg.p2) return { fading: true, msToNext: (seg.p2 - phase) * seg.period };
    if (phase < seg.p3) return { fading: false, msToNext: (seg.p3 - phase) * seg.period };
    return { fading: true, msToNext: (1 - phase) * seg.period };
  },

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
};
