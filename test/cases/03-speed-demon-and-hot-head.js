// Speed demon's ramp and glow, Hot-head.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("Speed Demon: custom heat ramp");

function heatEngine(extra) {
  const e = makeEngine(Object.assign({ speedDemon: true }, extra));
  e.heat = 0;
  return e;
}

{
  const e = heatEngine({ speedDemonGradient: true });
  // Stage 1 at rest, stage 4 flat out, exactly.
  ok("heat 0 lands on stage 1", e.sampleHeatRamp(0).toLowerCase() === T.DEFAULT_SETTINGS.speedHeatDark1.toLowerCase(), e.sampleHeatRamp(0));
  ok("heat 1 lands on stage 4", e.sampleHeatRamp(1).toLowerCase() === T.DEFAULT_SETTINGS.speedHeatDark4.toLowerCase(), e.sampleHeatRamp(1));
  // The two middle stops are hit exactly at the segment boundaries.
  ok("heat 1/3 lands on stage 2", e.sampleHeatRamp(1/3).toLowerCase() === T.DEFAULT_SETTINGS.speedHeatDark2.toLowerCase(), e.sampleHeatRamp(1/3));
  ok("heat 2/3 lands on stage 3", e.sampleHeatRamp(2/3).toLowerCase() === T.DEFAULT_SETTINGS.speedHeatDark3.toLowerCase(), e.sampleHeatRamp(2/3));
  // Out-of-range heat clamps rather than running off the ramp.
  ok("heat clamps low", e.sampleHeatRamp(-5) === e.sampleHeatRamp(0));
  ok("heat clamps high", e.sampleHeatRamp(99) === e.sampleHeatRamp(1));
  // Every sample is a valid hex colour.
  let bad = 0;
  for (let h = 0; h <= 1.0001; h += 0.02) if (!/^#[0-9a-f]{6}$/.test(e.sampleHeatRamp(h))) bad++;
  ok("every sample is a valid hex", bad === 0, bad);
}

// The custom ramp ignores the base colour; the built-in curve doesn't.
{
  const custom = heatEngine({ speedDemonGradient: true });
  ok("custom ramp ignores the cursor colour",
     custom.heatColor(0.5, "#ff0000") === custom.heatColor(0.5, "#00ff00"));
  const builtin = heatEngine({ speedDemonGradient: false });
  ok("built-in curve still follows the cursor colour",
     builtin.heatColor(0.3, "#ff0000") !== builtin.heatColor(0.3, "#00ff00"));
}

// Theme awareness.
{
  const e = heatEngine({ speedDemonGradient: true });
  const dark = e.sampleHeatRamp(0);
  e.isDarkTheme = () => false;
  ok("light theme uses its own stops", e.sampleHeatRamp(0) !== dark, { dark, light: e.sampleHeatRamp(0) });
}

// A gradient cursor keeps its own stops at rest and collapses into the heat
// ramp as it warms. It used to flatten at rest too, which is what made a custom
// ramp look like it had replaced the cursor's colour with stage 1.
{
  const e = heatEngine({
    speedDemonGradient: true, gradientEnabled: true, gradientCount: 3,
    gradientDark1: "#ff0000", gradientDark2: "#00ff00", gradientDark3: "#0000ff",
  });
  e.heat = 0;
  const rest = e.gradientStops();
  ok("at rest the gradient is still the user's own stops",
     rest.join(",") === "#ff0000,#00ff00,#0000ff", rest);
  e.heat = 1;
  const hot = e.gradientStops();
  ok("gradient collapses to one colour when hot", new Set(hot).size === 1, hot);
  ok("resting and hot differ", rest[0] !== hot[0], { rest: rest[0], hot: hot[0] });
  // The collapse must be gradual, or enabling the ramp pops on first keystroke.
  e.heat = SPEED_LIFTOFF / 2;
  const mid = e.gradientStops();
  ok("...and gets there by blending, not snapping",
     mid[0] !== rest[0] && mid[0] !== hot[0], { rest: rest[0], mid: mid[0], hot: hot[0] });

  // Without the custom ramp, a gradient cursor keeps its distinct stops.
  const plain = heatEngine({
    speedDemonGradient: false, gradientEnabled: true, gradientCount: 3,
    gradientDark1: "#ff0000", gradientDark2: "#00ff00", gradientDark3: "#0000ff",
  });
  plain.heat = 0;
  ok("built-in curve leaves the gradient intact", new Set(plain.gradientStops()).size === 3, plain.gradientStops());
}

// Keep Cursor Color still wins over everything.
{
  const e = heatEngine({ speedDemonGradient: true, speedDemonNoCursorHeat: true, colorDark: "#39ff14" });
  e.heat = 1;
  ok("Keep Cursor Color overrides the custom ramp", e.getActiveColor() === "#39ff14", e.getActiveColor());
}

// ---------------------------------------------------------------------------
section("Speed Demon: glow scales with heat");

{
  const off = makeEngine({ speedDemon: false });
  off.heat = 1;
  ok("no scaling without Speed Demon", off.glowHeatScale() === 1, off.glowHeatScale());

  const e = heatEngine({});
  e.heat = 0;
  ok("cold cursor keeps the base glow", e.glowHeatScale() === 1, e.glowHeatScale());
  e.heat = 1;
  ok("hot cursor swells the glow", Math.abs(e.glowHeatScale() - (1 + T.GLOW_HEAT_GAIN)) < 1e-9, e.glowHeatScale());
  e.heat = 0.5;
  ok("scaling is proportional to heat", Math.abs(e.glowHeatScale() - (1 + T.GLOW_HEAT_GAIN / 2)) < 1e-9, e.glowHeatScale());

  // Monotonic and bounded, including on junk heat values.
  let prev = -1, mono = true;
  for (let h = 0; h <= 1.0001; h += 0.05) { e.heat = h; const v = e.glowHeatScale(); if (v < prev) mono = false; prev = v; }
  ok("monotonic in heat", mono);
  e.heat = 99;  ok("clamps above 1", e.glowHeatScale() === 1 + T.GLOW_HEAT_GAIN, e.glowHeatScale());
  e.heat = -5;  ok("clamps below 0", e.glowHeatScale() === 1, e.glowHeatScale());
  e.heat = undefined; ok("survives undefined heat", e.glowHeatScale() === 1, e.glowHeatScale());

  // Keep Cursor Color means "don't react to speed", halo included.
  const keep = heatEngine({ speedDemonNoCursorHeat: true });
  keep.heat = 1;
  ok("Keep Cursor Color pins the glow", keep.glowHeatScale() === 1, keep.glowHeatScale());
}

// ---------------------------------------------------------------------------
section("fireworks: trails, twinkle, secondary pops");

{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 3 });
  e.spawnFireworks(caret);
  const fw = e.fireworks[0];

  ok("sparks carry a palette index, not their own channels",
     fw.sparks.every((s) => Number.isInteger(s.ci) && s.r === undefined), fw.sparks[0]);
  ok("every index is inside the palette",
     fw.sparks.every((s) => s.ci >= 0 && s.ci < fw.palette.length), fw.palette.length);
  ok("the palette is small enough to batch",
     fw.palette.length <= T.FIREWORK_PALETTE_MAX, fw.palette.length);
  // Sorting is what lets the draw set fillStyle once per colour rather than
  // once per spark; unsorted, the batching silently does nothing.
  ok("sparks are pre-sorted by colour",
     fw.sparks.every((s, i) => i === 0 || fw.sparks[i - 1].ci <= s.ci));
  ok("every spark has a twinkle phase and rate",
     fw.sparks.every((s) => Number.isFinite(s.tw) && s.tr > 0));

  ok("secondaries are generated", fw.secondaries.length > 0, fw.secondaries.length);
  ok("...within the cap", fw.secondaries.length <= T.FIREWORK_SECOND_MAX);
  ok("...popping partway down the fall",
     fw.secondaries.every((x) => x.at > 0 && x.at < 1), fw.secondaries.map((x) => x.at));
  ok("...each with its own sparks",
     fw.secondaries.every((x) => x.sparks.length > 0 && x.sparks.every((k) => k.ci < fw.palette.length)));
  ok("...also pre-sorted",
     fw.secondaries.every((x) => x.sparks.every((k, i) => i === 0 || x.sparks[i - 1].ci <= k.ci)));

  // The damage box has to cover the secondaries or they leave streaks behind:
  // a secondary pops from a parent that has already travelled, so it reaches
  // further than the primary spray.
  ok("the damage box is widened for them",
     (fw.maxX - fw.minX) > 0 && Number.isFinite(fw.maxX) && Number.isFinite(fw.minY));
}

// ---------------------------------------------------------------------------
section("hot-head: the cursor-colour fire is never darker than the cursor");

// On a light theme the cursor is dark, and "Use cursor color" ran the
// colour's value from 0.45x up - so with the temperature range capped at
// half the ramp, every chunk was darker than the cursor: a black fire. The
// ramp now starts at exactly the cursor's colour and only lightens.
{
  const palette = (base) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, { hotHead: true, hotHeadFlat: true, colorDark: base, colorLight: base });
    e.styleFor = (k) => e.settings[k];
    e.isDarkTheme = () => true;
    e.getBaseColor = () => base;
    e.heat = 0;
    e.animActive = { x: 100, top: 100, h: 24, w: 8, fontSize: 16 };
    e.ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, fill() {}, fillRect() {}, fillStyle: "" };
    e._markDirty = () => {};
    e.flameEmbers.push({ x: 100, y: 90, vx: 0, vy: 0, life: 300, life0: 300, maxLife: 620, temp: 1, cw: 8, lift: 1, shape0: 0 });
    e.drawHotHead();
    return e._hotPalette;
  };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const base of ["#333333", "#1f8a3b", "#39ff14"]) {
    const pal = palette(base);
    const b = T.parseColorTuple ? T.parseColorTuple(base) : null;
    ok(`${base}: the ramp starts at the cursor's own colour`, pal[0].join() === [parseInt(base.slice(1, 3), 16), parseInt(base.slice(3, 5), 16), parseInt(base.slice(5, 7), 16)].join(), pal[0]);
    ok(`${base}: ...and never gets darker along it`, pal.every((c, i) => i === 0 || lum(c) >= lum(pal[i - 1]) - 1), pal.map(lum).map(Math.round));
    ok(`${base}: ...ending lighter`, lum(pal[pal.length - 1]) > lum(pal[0]) + 20, [lum(pal[0]), lum(pal[pal.length - 1])]);
    void b;
  }
}

// ---------------------------------------------------------------------------
section("hot-head: Speed Demon heat needs flat mode");

{
  const mk = (over) => {
    const e = Object.create(Plugin.prototype);
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS,
      { hotHead: true, speedDemon: true, colorDark: "#39ff14" }, over);
    e.styleFor = (k) => e.settings[k];
    e.isDarkTheme = () => true;
    e.heat = 0;
    return e;
  };
  // Rebuild each branch's palette the way drawHotHead does, and count how many
  // entries actually move between cold and flat-out.
  const moved = (e, flat) => {
    const at = (h) => {
      e.heat = h;
      const base = e.heatColor(h, e.getBaseColor());
      if (flat) return [base];                       // whole palette derives from it
      const out = [];
      for (let j = 0; j <= 16; j++) out.push(e.hotFireColor(j / 16, base));
      return out;
    };
    const cold = at(0), hot = at(1);
    return cold.filter((c, i) => c !== hot[i]).length;
  };

  // Why the toggle is nested rather than standalone: in gradient mode `base`
  // is only the ignition colour and the rest of the ramp is fixed fire stops,
  // so heat barely reaches the flames.
  const e = mk({});
  ok("gradient mode: heat moves almost nothing", moved(e, false) <= 2, moved(e, false));
  ok("flat mode: heat moves the whole palette", moved(e, true) === 1, moved(e, true));

  // The engine gate, which must hold even when the panel isn't the one asking
  // - a share code or preset can carry the key on with flat mode off.
  const heats = (over) => {
    const g = mk(over);
    return !!(g.styleFor("hotHeadFlat") && g.styleFor("hotHeadSpeedHeat") && g.settings.speedDemon);
  };
  ok("on with flat mode and Speed Demon",
     heats({ hotHeadFlat: true, hotHeadSpeedHeat: true }) === true);
  ok("off without flat mode",
     heats({ hotHeadFlat: false, hotHeadSpeedHeat: true }) === false);
  ok("off without Speed Demon",
     heats({ hotHeadFlat: true, hotHeadSpeedHeat: true, speedDemon: false }) === false);
  ok("off when the toggle itself is off",
     heats({ hotHeadFlat: true, hotHeadSpeedHeat: false }) === false);

  // Still a look key, and still at the index it was appended at - the
  // share-code wire format doesn't care that the panel nests it.
  //
  // This used to assert the key was LAST, which made it a tripwire for
  // appending rather than for the thing that actually breaks share codes.
  // Appending is safe and expected; what must never happen is a key being
  // INSERTED above an existing one, silently reindexing every code in the
  // wild. Pinning known indices catches exactly that, and leaves adding a new
  // key at the tail as a no-op for this test.
  const idx = {
    cursorStyle: 0,
    popLetters: 29,
    cursorTranslucent: 102,
    popEffects: 103,
    overlayFlickerAmount: 115,
    hotHeadSpeedHeat: 116,
  };
  for (const [key, want] of Object.entries(idx)) {
    ok(`LOOK_KEYS index is pinned: ${key} @ ${want}`,
       T.LOOK_KEYS.indexOf(key) === want, T.LOOK_KEYS.indexOf(key));
  }
}

// ---------------------------------------------------------------------------
section("blink phase is anchored to the caret, not the wall clock");

{
  const mk = (over) => {
    const e = makeEngine(Object.assign({ blinkingEnabled: true, blinkSpeed: 1,
      blinkDelayMs: 500, smoothEnabled: false }, over));
    return e;
  };

  // THE BUG. blinkAlphaAt took `now` and did `now % period`, so nothing
  // anchored the cycle. The hold pins alpha at 1 and then handed back to
  // whatever phase absolute time was at - snapping 1.00 to 0.00 in one frame
  // about half the time, with none of the blinkFade easing applying because
  // the fade only exists inside the cycle.
  const e = mk({});
  let worst = 0;
  for (let k = 0; k < 24; k++) {
    const stop = 10000 + k * (2500 / 24);
    e.lastMoveTime = stop;
    worst = Math.max(worst, Math.abs(e.blinkPhase(stop + 499) - e.blinkPhase(stop + 501)));
  }
  ok("no discontinuity when the hold window expires", worst < 0.05, worst);

  // It must still blink, and still start lit.
  const e2 = mk({ blinkDelayMs: 0 });
  e2.lastMoveTime = 0;
  ok("the cycle starts fully lit", e2.blinkPhase(1) > 0.99, e2.blinkPhase(1));
  let sawOff = false;
  for (let t = 0; t < 2500; t += 25) if (e2.blinkPhase(t) < 0.02) sawOff = true;
  ok("...and still goes dark within the cycle", sawOff);

  // Moving the caret restarts the cycle from lit, which is the behaviour the
  // anchor buys and what every other editor does.
  e2.lastMoveTime = 9999;
  ok("a caret move restarts the blink from lit", e2.blinkPhase(10000) > 0.99);

}
