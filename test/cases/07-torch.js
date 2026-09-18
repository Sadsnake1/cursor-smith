// the torch's flicker, glow and tuning.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("torch: candle flicker");

// Restored as a per-frame write from the torch tick, never as the CSS keyframe
// animation it used to be - that ran on the compositor outside the frame
// governor and pinned the display at full refresh for as long as the torch was
// lit. These tests cover the pure waveform; the tick's ownership of
// --torch-intensity is documented at both writers.
{
  const F = T.torchFlickerScale;
  ok("amount 0 is exactly no-op", F(0, 0) === 1 && F(123456, 0) === 1);
  ok("a negative amount is clamped to no-op", F(500, -1) === 1);

  // Closed-form, not re-rolled: the same instant must give the same value, or
  // the flame would change shape with the frame rate the governor picked.
  ok("deterministic in time", F(4242.5, 0.5) === F(4242.5, 0.5));
  ok("it actually varies over time", F(1000, 0.5) !== F(1050, 0.5));

  // The three sine weights sum to 1, so the signal spans exactly -1..1 and the
  // amount maps straight onto "share of base intensity".
  ok("weights sum to 1", Math.abs(T.TORCH_FLICKER_WEIGHTS.reduce((a, b) => a + b, 0) - 1) < 1e-12);

  // A candle gutters DOWN from steady and comes back; it never flares above its
  // own level. The reference's keyframes run brightness 1.0 to 0.75 and back,
  // never above 1, and this has to hold or the torch reads as a throbbing lamp
  // rather than a flame.
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let t = 0; t < 120000; t += 3) { const v = F(t, 0.35); lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; n++; }
  ok("never brightens past the set level", hi <= 1 + 1e-9, hi);
  ok("never dips below 1 - amount", lo >= 1 - 0.35 - 1e-9, lo);
  ok("uses most of the range it has", (hi - lo) > 0.3, hi - lo);
  ok("sits a little under the set level on average",
     Math.abs(sum / n - (1 - 0.35 / 2)) < 0.02, sum / n);

  // At full depth it gutters right out and back, which is what Flicker Depth
  // promises at 1.
  let lo1 = Infinity, hi1 = -Infinity;
  for (let t = 0; t < 120000; t += 3) { const v = F(t, 1); lo1 = Math.min(lo1, v); hi1 = Math.max(hi1, v); }
  ok("full depth gutters out and back", lo1 < 0.02 && hi1 > 0.98 && hi1 <= 1 + 1e-9, [lo1, hi1]);
}

// ---------------------------------------------------------------------------
section("torch: glow layer and tuning");

{
  const D = T.DEFAULT_SETTINGS;
  // Tuned against 0xatrilla/obsidian-torch-cursor, which ships 0.97 darkness
  // and 1.0 intensity. A near-black room with a strong warm core is what makes
  // it read as a torch; the old 0.7/0.1 pair was a vignette.
  ok("the room is genuinely dark by default", D.overlayDarkness >= 0.85, D.overlayDarkness);
  ok("the glow is strong enough to see", D.overlayIntensity >= 0.35, D.overlayIntensity);
  ok("flicker is on by default, as in the reference", D.overlayFlicker === true);

  // The glow layer must be built and destroyed on demand: a blended layer costs
  // a re-composite of everything beneath it whether or not it paints anything.
  const e = Object.create(Plugin.prototype);
  e.settings = Object.assign({}, D);
  e.glowEl = { removed: false, remove() { this.removed = true; } };
  const stale = e.glowEl;
  ok("asking for no glow returns nothing", e._ensureGlowLayer(false) === null);
  ok("...and tears the layer down rather than hiding it", stale.removed === true && e.glowEl === null);

  // With no overlay there is no document to attach to, and it must say so
  // rather than throwing inside the torch tick.
  e.overlay = null;
  ok("no overlay, no glow layer", e._ensureGlowLayer(true) === null);
}
