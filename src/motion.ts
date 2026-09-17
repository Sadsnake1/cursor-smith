// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

import { TORCH_FLICKER_PHASES, TORCH_FLICKER_RATES, TORCH_FLICKER_WEIGHTS } from "./constants";

// Candle flicker, as a multiplier on the torch's base glow strength.
//
// Returns 1 with amount 0, and swings within 1 ± amount otherwise - so at the
// maximum the flame drops to nothing and doubles, and at the default 0.35 it
// breathes gently either side of the level the Glow Strength slider set.
//
// Pure, closed-form, and driven by wall clock: it is sampled from the torch
// tick under the frame governor, NOT from a CSS animation. The previous
// implementation was a keyframe animation, which runs on the compositor
// entirely outside the governor and therefore pinned the display at full
// refresh rate for as long as the torch was lit, in whichever gear the loops
// had otherwise chosen. See the notes in injectStyles and styles.css.
export function torchFlickerScale(nowMs, amount) {
  const a = Math.max(0, Math.min(1, amount));
  if (a === 0) return 1;
  const t = nowMs / 1000;
  let n = 0;
  for (let i = 0; i < TORCH_FLICKER_RATES.length; i++) {
    n += Math.sin(t * TORCH_FLICKER_RATES[i] + TORCH_FLICKER_PHASES[i]) * TORCH_FLICKER_WEIGHTS[i];
  }
  // Dips only, never brightens: a candle gutters down from steady and comes
  // back, it does not flare above its own level. (The reference's keyframes run
  // brightness 1.0 down to 0.75 and back, never above 1.) Mapping the -1..1 sum
  // onto 1-a..1 rather than 1-a..1+a is the difference between a flame and a
  // throbbing lamp.
  return 1 - a * (1 - n) / 2;
}

// prefers-reduced-motion, applied as ONE gate over the effective settings
// rather than as a check inside each effect. Every read in both render loops
// goes through effectiveSettings, so suppressing keys here reaches the spawn
// sites, the draw calls, the frame governor's animating test and the settings
// the panel describes, all at once - and an effect added later is covered by
// whichever of these keys gates it, with no new plumbing.
//
// Mutates in place: it only ever runs on the freshly-merged copy inside
// effectiveSettings, never on this.settings, so nothing here is persisted and
// the panel keeps showing what the user actually chose.
//
// The line drawn is movement and emission, not the cursor's existence. A caret
// that is a different colour or shape is not motion, and blinking is left alone
// - it is the platform-standard behaviour of every text caret, it is well under
// the flash thresholds, and someone who wants it gone has a switch for it.
export const REDUCED_MOTION_OFF_KEYS = [
  "smoothEnabled",       // the cursor gliding to its destination
  "smear",               // corner springs
  "popEffects",          // letters, disintegration, thunderstrike, fireworks
  "flameTrail",          // pixel trail, including the jump streak
  "stardustEnabled",     // ambient drift
  "hotHead",             // continuous fire
  "speedDemonSparks",    // emission; the heat colour itself is not motion
  "crtGlitch",           // whole-cursor displacement bursts
  "energyEffect",        // wall-clock shimmer inside the cursor body
  "blinkBreathing",      // size oscillation
  "overlayBlinkSync",    // torch radius pulse
  "overlayFlicker",      // torch candle flicker
];

export function applyReducedMotion(obj) {
  for (const k of REDUCED_MOTION_OFF_KEYS) obj[k] = false;
  return obj;
}

export function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

// Deterministic 0..1 hash of three small integers, used to drive the Signal
// Glitch. Math.random() is deliberately NOT used: the glitch re-rolls its
// slice offsets on a time bucket rather than per frame, so the SAME roll has
// to be reproducible for every frame inside one bucket. With Math.random()
// each frame would draw a different arrangement and the effect would smear
// into noise instead of stepping between a few distinct broken states, which
// is what actually reads as a mistracked signal.
export function glitchNoise(a, b, c) {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Returns true only for elements that actually host a blinking text caret.
// contentEditable and <textarea> always qualify. For <input> we filter by
// type: text/search/url/tel/email/password/number are text fields; checkbox,
// radio, range, color, button, etc. don't have a caret and must be excluded
// so clicking an Obsidian settings toggle (which is <input type="checkbox">)
// doesn't cause the plugin to draw a cursor on top of it.
export function isTextCaretHost(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return (
      type === "text" || type === "search" || type === "url" || type === "tel" ||
      type === "email" || type === "password" || type === "number"
    );
  }
  return false;
}

export function blinkAlphaAt(nowMs, speed, onOffBalance = 0.5, fade = 0.15) {
  if (speed <= 0) return 1;
  const period = 2500 / speed; 
  const phase = (nowMs % period) / period; 
  // Fraction of the period spent fading, per side. Clamped below 0.5 so the two
  // fades never overrun the cycle; at exactly 0.5 the holds are gone and the
  // blink is one continuous ease down-and-up (a gentle "breathing" fade).
  fade = Math.max(0.02, Math.min(0.5, fade ?? 0.15));
  const balance = Math.max(0.1, Math.min(0.9, onOffBalance));
  const hold = 1 - fade * 2; 
  const onHold = hold * balance;
  const offHold = hold * (1 - balance);
  const p1 = onHold;
  const p2 = p1 + fade;
  const p3 = p2 + offHold;
  let a;
  if (phase < p1) a = 1;
  else if (phase < p2) a = 1 - easeInOutSine((phase - p1) / fade);
  else if (phase < p3) a = 0;
  else a = easeInOutSine((phase - p3) / fade);
  return a;
}
