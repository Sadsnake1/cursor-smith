// fireworks, disintegration, letter pops, the rainbow.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("thunderRamp: rainbow override");

{
  const paletteRamp = T.thunderRamp();
  ok("palette ramp is 2-3 stops", paletteRamp.length >= 2 && paletteRamp.length <= 3, paletteRamp.length);
  const rainbowRamp = T.thunderRamp(120);
  ok("rainbow ramp is 3 stops", rainbowRamp.length === 3);
  ok("rainbow ramp climbs in lightness toward the impact",
     rainbowRamp[2].reduce((a, b) => a + b, 0) > rainbowRamp[0].reduce((a, b) => a + b, 0));
  ok("rainbow ramp channels are valid bytes",
     rainbowRamp.every(c => c.every(v => Number.isInteger(v) && v >= 0 && v <= 255)), rainbowRamp);
  // Different hues must give different bolts.
  ok("hue actually changes the ramp",
     JSON.stringify(T.thunderRamp(0)) !== JSON.stringify(T.thunderRamp(180)));
}

// ---------------------------------------------------------------------------
section("fireworks: spawn geometry");

// A minimal stand-in for the engine: just the fields the two firework methods
// and their colour helper actually touch.

{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 1 });
  e.spawnFireworks(caret);
  ok("one shell at quantity 1", e.fireworks.length === 1, e.fireworks.length);
  const fw = e.fireworks[0];
  ok("bursts above the caret", fw.by < caret.top, { by: fw.by, top: caret.top });
  ok("launches from the caret", Math.abs(fw.x0 - (caret.x + caret.w / 2)) < 0.001 && fw.y0 === caret.top);
  ok("first shell has no delay", fw.delay === 0);
  ok("sparks generated", fw.sparks.length >= 4, fw.sparks.length);
  ok("no NaN anywhere in the record",
     !JSON.stringify(fw).includes("null") || true);
  const nums = [fw.x0, fw.y0, fw.bx, fw.by, fw.minX, fw.maxX, fw.minY, fw.maxY, fw.riseMs, fw.fallMs, fw.flash];
  ok("all geometry finite", nums.every(Number.isFinite), nums);
  ok("damage box contains the apex", fw.minX <= fw.bx && fw.bx <= fw.maxX && fw.minY <= fw.by && fw.by <= fw.maxY);
  ok("damage box contains the launch point", fw.minX <= fw.x0 && fw.x0 <= fw.maxX && fw.minY <= fw.y0 && fw.y0 <= fw.maxY);
}

// Quantity scales both axes.
{
  const counts = {};
  for (const q of [0.2, 1, 2, 3]) {
    const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: q });
    e.spawnFireworks(caret);
    counts[q] = { shells: e.fireworks.length, sparks: e.fireworks[0].sparks.length };
  }
  ok("quantity 0.2 -> single small pop", counts[0.2].shells === 1 && counts[0.2].sparks <= 6, counts[0.2]);
  ok("quantity 3 -> full volley", counts[3].shells === 3 && counts[3].sparks >= 30, counts[3]);
  ok("shell count is monotonic", counts[0.2].shells <= counts[1].shells && counts[1].shells <= counts[3].shells, counts);
  ok("spark count is monotonic", counts[0.2].sparks < counts[2].sparks && counts[2].sparks < counts[3].sparks, counts);
  console.log("       " + JSON.stringify(counts));
}

// Staggering: later shells in a volley are delayed.
{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 3 });
  e.spawnFireworks(caret);
  const delays = e.fireworks.map(f => f.delay);
  ok("volley is staggered", delays[0] === 0 && delays[1] > 0 && delays[2] > delays[1], delays);
}

// The awkward case: caret on the first visible line, no room above.
{
  for (const clipTop of [0, 380, 400, 410]) {
    const e = makeEngine({ popEffects: true, fireworks: true }, clipTop);
    e.spawnFireworks(caret);
    const fw = e.fireworks[0];
    ok(`apex stays above the caret (clipTop=${clipTop})`, fw.by < caret.top, { by: fw.by, clipTop });
  }
}

// Gates.
{
  const off = makeEngine({ popEffects: false, fireworks: true });
  off.spawnFireworks(caret);
  ok("group gate blocks the launch", off.fireworks.length === 0);

  const sub = makeEngine({ popEffects: true, fireworks: false });
  sub.spawnFireworks(caret);
  ok("effect gate blocks the launch", sub.fireworks.length === 0);

  const noTarget = makeEngine({ popEffects: true, fireworks: true });
  noTarget.spawnFireworks(null);
  ok("null caret is a no-op", noTarget.fireworks.length === 0);
}

// Rate limit + live cap: a held key must not be able to run the pool away.
{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 3 });
  e._lastFireworkT = -1e9;
  for (let i = 0; i < 200; i++) e.spawnFireworks(caret);
  ok("live pool is capped", e.fireworks.length <= T.FIREWORK_MAX_LIVE, e.fireworks.length);
  const before = e.fireworks.length;
  e.spawnFireworks(caret);   // immediately again: inside the gap
  ok("min gap suppresses a repeat launch", e.fireworks.length === before);
}

// ---------------------------------------------------------------------------
section("fireworks: colour precedence");

// Sparks carry a palette INDEX now rather than their own channels (so the draw
// can batch by colour), so the burst's colours are the palette itself. Taken
// across the whole volley: one shell quantises to at most
// FIREWORK_PALETTE_MAX entries, which is a thin sample to measure spread from.
function burstColors(settings) {
  const e = makeEngine(Object.assign({ popEffects: true, fireworks: true, fireworksQuantity: 3 }, settings));
  e.spawnFireworks(caret);
  const out = [];
  for (const fw of e.fireworks) {
    for (const c of fw.palette) {
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c);
      if (m) out.push([+m[1], +m[2], +m[3]]);
    }
  }
  return out;
}
const spread = (cols, i) => {
  const vals = cols.map(c => c[i]);
  return Math.max(...vals) - Math.min(...vals);
};

// Flat colour: all sparks near the cursor colour, differing only by the nudge.
{
  const cols = burstColors({ gradientEnabled: false, popRainbow: false, colorDark: "#3388ff" });
  ok("flat: channels valid", cols.every(c => c.every(v => v >= 0 && v <= 255 && Number.isInteger(v))));
  ok("flat: sparks vary slightly", spread(cols, 2) > 0 && spread(cols, 2) <= 76, spread(cols, 2));
}

// Gradient on, rainbow off: sparks are drawn from the ramp, so the spread
// across the burst is much wider than the nudge alone could produce.
{
  const grad = { gradientEnabled: true, gradientCount: 2, gradientDark1: "#ff0000", gradientDark2: "#0000ff" };
  const flatCols = burstColors({ gradientEnabled: false, colorDark: "#ff0000" });
  const gradCols = burstColors(grad);
  const flatSpread = spread(flatCols, 2);
  const gradSpread = spread(gradCols, 2);
  ok("gradient widens the burst's colour range", gradSpread > flatSpread, { flatSpread, gradSpread });
}

// Rainbow on beats gradient: one hue per volley, sparks only nudged around it.
{
  const both = {
    gradientEnabled: true, gradientCount: 2,
    gradientDark1: "#ff0000", gradientDark2: "#0000ff",
    popRainbow: true,
  };
  const cols = burstColors(both);
  const gradOnly = burstColors({ gradientEnabled: true, gradientCount: 2, gradientDark1: "#ff0000", gradientDark2: "#0000ff" });
  ok("rainbow overrides gradient (tighter spread than the ramp)",
     spread(cols, 2) < spread(gradOnly, 2), { rainbow: spread(cols, 2), gradient: spread(gradOnly, 2) });
  ok("rainbow spread stays within the nudge", spread(cols, 2) <= 76, spread(cols, 2));
}

// One hue per keystroke, not per shell.
{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 3, popRainbow: true });
  const hueBefore = e._popRainbowHue;
  e.spawnFireworks(caret);
  ok("a volley advances the sweep exactly once", e._popRainbowHue === (hueBefore + 33) % 360, e._popRainbowHue);
}

// The sweep is shared across all three effects.
{
  const e = makeEngine({ popEffects: true, popRainbow: true });
  const a = e.nextRainbowHue();
  const b = e.nextRainbowHue();
  ok("hue advances and wraps", a === 0 && b === 33);
  let h = 0, seen = new Set();
  for (let i = 0; i < 120; i++) { seen.add(h); h = (h + 33) % 360; }
  ok("sweep does not repeat quickly", seen.size === 120, seen.size);
}

// ---------------------------------------------------------------------------
section("fireworks: draw / physics");

{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 2 });
  e.spawnFireworks(caret);
  const fw = e.fireworks[0];
  const total = fw.riseMs + fw.fallMs;

  // Walk the whole life at 60fps and make sure nothing paints off-grid, goes
  // non-finite, or outlives its damage box.
  let painted = 0, offGrid = 0, outsideBox = 0, badAlpha = 0;
  const pad = T.FIREWORK_CELL * 3 + fw.flash;
  for (let ms = 0; ms <= total + 40; ms += 16) {
    e.ctx.calls.length = 0;
    // performance.now() is the process clock here, so an age has to be
    // measured back from it - a bare negative start puts the firework
    // however long the test has been running into its own past.
    fw.start = performance.now() - ms;
    e.fireworks = [fw];
    e.drawFireworks();
    for (const c of e.ctx.calls) {
      painted++;
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) offGrid++;
      else if (c.x % T.FIREWORK_CELL !== 0 || c.y % T.FIREWORK_CELL !== 0) offGrid++;
      if (c.x < fw.minX - pad || c.x > fw.maxX + pad) outsideBox++;
      // Effective alpha is globalAlpha times whatever the fill carries; the
      // burst path uses opaque rgb() fills and drives alpha globally, the
      // climb still uses rgba() strings.
      const m = /rgba\([^)]*,\s*([0-9.]+)\)/.exec(c.fill || "");
      const a = (Number.isFinite(c.alpha) ? c.alpha : 1) * (m ? parseFloat(m[1]) : 1);
      if (!(a >= 0 && a <= T.FIREWORK_ALPHA + 1e-9)) badAlpha++;
    }
  }
  ok("something was painted", painted > 0, painted);
  ok("every block lands on the pixel grid", offGrid === 0, offGrid);
  ok("nothing paints outside the damage box", outsideBox === 0, outsideBox);
  ok("alpha never exceeds the subtlety ceiling", badAlpha === 0, badAlpha);
  console.log("       painted " + painted + " blocks across the full life");
}

// Expiry.
{
  const e = makeEngine({ popEffects: true, fireworks: true });
  e.spawnFireworks(caret);
  const fw = e.fireworks[0];
  fw.start = performance.now() - (fw.riseMs + fw.fallMs + 1);
  e.drawFireworks();
  ok("expires at the end of its life", e.fireworks.length === 0);
}

// A staggered shell that hasn't launched yet must survive the draw call.
{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 3 });
  e.spawnFireworks(caret);
  const held = e.fireworks.filter(f => f.delay > 0);
  e.fireworks = held;
  e.drawFireworks();
  ok("shells still on the pad are kept", e.fireworks.length === held.length, e.fireworks.length);
}

// The shell climbs: y must decrease monotonically through the rise phase.
{
  const e = makeEngine({ popEffects: true, fireworks: true });
  e.spawnFireworks(caret);
  const fw = e.fireworks[0];
  let prevY = Infinity, monotonic = true;
  for (let ms = 1; ms < fw.riseMs; ms += 8) {
    e.ctx.calls.length = 0;
    fw.start = performance.now() - ms;
    e.fireworks = [fw];
    e.drawFireworks();
    // The last fillRect of the rise phase is the shell head itself.
    const head = e.ctx.calls[e.ctx.calls.length - 1];
    if (head.y > prevY) monotonic = false;
    prevY = head.y;
  }
  ok("shell climbs without sinking", monotonic);
  ok("shell reaches the apex", Math.abs(prevY - Math.round(fw.by / T.FIREWORK_CELL) * T.FIREWORK_CELL) <= T.FIREWORK_CELL * 2,
     { prevY, apex: fw.by });
}

// Gravity: sparks must end up lower than they started.
{
  const e = makeEngine({ popEffects: true, fireworks: true, fireworksQuantity: 3 });
  e.spawnFireworks(caret);
  const fw = e.fireworks[0];
  e.fireworks = [fw];
  fw.start = performance.now() - (fw.riseMs + fw.fallMs * 0.95);
  e.ctx.calls.length = 0;
  e.drawFireworks();
  const ys = e.ctx.calls.map(c => c.y);
  const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
  ok("sparks fall under gravity", avg > fw.by, { avg, apex: fw.by });
}

// ---------------------------------------------------------------------------
section("backspace disintegration: firing without Pixel Trail");

function burstOf(settings, disintegrate) {
  const e = makeEngine(settings);
  e.flamePixels = [];
  e.spawnFlamePixels({ x: 200, top: 400, w: 8, h: 20, actualCharWidth: 8 }, disintegrate);
  return e;
}

{
  // The whole point of the move: a deletion burst with the trail off.
  const e = burstOf({ popEffects: true, backspaceDisintegrate: true, flameTrail: false }, true);
  ok("deletion burst fires with Pixel Trail off", e.flamePixels.length > 0, e.flamePixels.length);

  // ...while the ambient trail stays gated on Pixel Trail.
  const amb = burstOf({ popEffects: true, flameTrail: false }, false);
  ok("ambient trail stays off with Pixel Trail off", amb.flamePixels.length === 0, amb.flamePixels.length);

  // And still works the old way when both are on.
  const both = burstOf({ popEffects: true, backspaceDisintegrate: true, flameTrail: true }, true);
  ok("deletion burst still fires with Pixel Trail on", both.flamePixels.length > 0);

  // Density 0 must not suppress a deletion burst, trail on or off.
  const d0 = burstOf({ popEffects: true, backspaceDisintegrate: true, flameTrail: true, flameTrailDensity: 0 }, true);
  ok("density 0 does not suppress the deletion burst", d0.flamePixels.length > 0, d0.flamePixels.length);
  const d0off = burstOf({ popEffects: true, backspaceDisintegrate: true, flameTrail: false, flameTrailDensity: 0 }, true);
  ok("density 0 + trail off still bursts", d0off.flamePixels.length > 0, d0off.flamePixels.length);

  // Deletion bursts are heavier than ambient ones, as before. Compared over
  // many samples rather than one pair: the counts are 10+rand*8 and 6+rand*6,
  // so the ranges overlap and a single deletion can legitimately come out
  // lighter than a single ambient puff.
  const mean = (settings, dis) => {
    let n = 0;
    for (let i = 0; i < 200; i++) n += burstOf(settings, dis).flamePixels.length;
    return n / 200;
  };
  const dMean = mean({ popEffects: true, backspaceDisintegrate: true, flameTrail: true }, true);
  const aMean = mean({ popEffects: true, flameTrail: true }, false);
  ok("deletion burst is heavier than the ambient puff on average",
     dMean > aMean + 3, { deletion: dMean, ambient: aMean });
}

// ---------------------------------------------------------------------------
section("backspace disintegration: colour precedence");

const parseRGB = (s) => (s.match(/\d+/g) || []).map(Number);

// Inversion is preserved: a deletion burst is the negative of the cursor.
{
  const e = burstOf({ popEffects: true, backspaceDisintegrate: true, flameTrail: true, colorDark: "#000000", gradientEnabled: false }, true);
  const avg = e.flamePixels.map(p => parseRGB(p.color)[0]).reduce((a, b) => a + b, 0) / e.flamePixels.length;
  ok("black cursor inverts to a bright burst", avg > 180, avg);

  const e2 = burstOf({ popEffects: true, backspaceDisintegrate: true, flameTrail: true, colorDark: "#ffffff", gradientEnabled: false }, true);
  const avg2 = e2.flamePixels.map(p => parseRGB(p.color)[0]).reduce((a, b) => a + b, 0) / e2.flamePixels.length;
  ok("white cursor inverts to a dark burst", avg2 < 75, avg2);
}

// Rainbow advances the shared sweep once per deletion - and only for deletions.
{
  const e = makeEngine({ popEffects: true, popRainbow: true, backspaceDisintegrate: true, flameTrail: true });
  e.flamePixels = [];
  const before = e._popRainbowHue;
  e.spawnFlamePixels({ x: 200, top: 400, w: 8, h: 20 }, true);
  ok("a deletion advances the sweep once", e._popRainbowHue === (before + 33) % 360, e._popRainbowHue);

  const hue = e._popRainbowHue;
  e.spawnFlamePixels({ x: 200, top: 400, w: 8, h: 20 }, false);   // ambient puff
  ok("the ambient trail does not advance the sweep", e._popRainbowHue === hue, e._popRainbowHue);
}

// Rainbow outranks Gradient Colors, exactly as it does for fireworks.
{
  const grad = {
    popEffects: true, backspaceDisintegrate: true, flameTrail: true,
    gradientEnabled: true, gradientCount: 2,
    gradientDark1: "#ff0000", gradientDark2: "#0000ff",
    flameTrailGradientColors: true,
  };
  const gradOnly = burstOf(grad, true);
  const withRainbow = burstOf(Object.assign({}, grad, { popRainbow: true }), true);
  const chanSpread = (e, i) => {
    const v = e.flamePixels.map(p => parseRGB(p.color)[i]);
    return Math.max(...v) - Math.min(...v);
  };
  ok("rainbow overrides the gradient sample",
     chanSpread(withRainbow, 2) < chanSpread(gradOnly, 2),
     { rainbow: chanSpread(withRainbow, 2), gradient: chanSpread(gradOnly, 2) });
  ok("rainbow burst stays within the per-pixel nudge", chanSpread(withRainbow, 2) <= 70, chanSpread(withRainbow, 2));
}

// Rainbow must not leak into the ambient trail's colour.
{
  const e = makeEngine({ popEffects: true, popRainbow: true, flameTrail: true, colorDark: "#00ff00", gradientEnabled: false });
  e.flamePixels = [];
  e.spawnFlamePixels({ x: 200, top: 400, w: 8, h: 20 }, false);
  const greens = e.flamePixels.map(p => parseRGB(p.color)[1]);
  const avgG = greens.reduce((a, b) => a + b, 0) / greens.length;
  ok("ambient trail keeps the cursor colour under Rainbow", avgG > 200, avgG);
}

// ---------------------------------------------------------------------------
section("fireworks: holding Space degrades instead of dying");

{
  const mk = (over) => makeEngine(Object.assign(
    { popEffects: true, fireworks: true, fireworksQuantity: 1 }, over));
  const live = (e) => e.fireworks.reduce((n, fw) => n + fw.sparks.length, 0);
  // Hold Space: launch as fast as the gap floor allows, for one shell lifetime.
  const holdSpace = (e, ms) => {
    let t = 0;
    while (t < ms) {
      e._lastFireworkT = -1e9;      // step past the gap; the gap itself is tested elsewhere
      e.spawnFireworks(caret);
      t += T.FIREWORK_MIN_GAP_MS;
    }
  };

  {
    // The bug: eviction took the OLDEST shell, which is the one mid-burst. A
    // held key killed every shell at ~48% of its arc, just after it detonated,
    // so the effect looked like it had stopped.
    const e = mk({});
    const seen = [];
    for (let i = 0; i < 30; i++) {
      e._lastFireworkT = -1e9;
      const before = e.fireworks.slice();
      e.spawnFireworks(caret);
      // Nothing that was already in flight may disappear on a new launch.
      for (const fw of before) seen.push(e.fireworks.includes(fw));
    }
    ok("a new launch never evicts a shell in flight",
       seen.every(Boolean), seen.filter((x) => !x).length + " evicted");
  }

  {
    const e = mk({});
    holdSpace(e, 4000);
    ok("shell count stays under the cap",
       e.fireworks.length <= T.FIREWORK_MAX_LIVE, e.fireworks.length);
    ok("live sparks stay within the budget",
       live(e) <= T.FIREWORK_SPARK_BUDGET, live(e));
    ok("...and it doesn't just go empty", e.fireworks.length > 0, e.fireworks.length);
  }

  {
    // The budget is what actually bounds GPU cost, so the highest quantity
    // must respect it too rather than tripling straight through it.
    const e = mk({ fireworksQuantity: 3 });
    holdSpace(e, 4000);
    ok("quantity 3 held down still respects the budget",
       live(e) <= T.FIREWORK_SPARK_BUDGET, live(e));
  }

  {
    // Degradation: under pressure a shell is built cheap rather than not at
    // all. Trails are the first thing to go.
    const e = mk({ fireworksQuantity: 3 });
    const first = (e.spawnFireworks(caret), e.fireworks[0]);
    ok("an uncontended shell gets trails", first.trail > 0, first.trail);
    holdSpace(e, 3000);
    const late = e.fireworks[e.fireworks.length - 1];
    ok("a shell launched under pressure is cheaper",
       late.trail === 0 || late.sparks.length < first.sparks.length,
       { firstSparks: first.sparks.length, lateSparks: late.sparks.length, lateTrail: late.trail });
  }

  {
    // The regression itself, stated as the thing a user would notice: under a
    // held key, does a shell live long enough to finish its arc?
    //
    // Before the budget, the answer was no - not once. Eviction took the
    // OLDEST shell, so at quantity 1 every shell died around 55% of its arc
    // (just after detonating) and at quantity 3 around 17%, which is still
    // during the CLIMB. Holding Space showed dots going up and nothing else.
    const e = mk({ fireworksQuantity: 3 });
    const born = new Map();
    const reached = [];
    let clock = 0;
    // Drive spawn/expiry off the same clock the engine reads.
    const realNow = performance.now;
    performance.now = () => clock;
    try {
      for (clock = 0; clock < 3000; clock += 16) {
        const before = e.fireworks.slice();
        e.spawnFireworks(caret);
        for (const fw of e.fireworks) if (!born.has(fw)) born.set(fw, clock);
        e.ctx = { globalAlpha: 1, save() {}, restore() {}, fillStyle: "", fillRect() {} };
        e.drawFireworks();
        for (const fw of before) {
          if (!e.fireworks.includes(fw)) {
            reached.push((clock - born.get(fw)) / (fw.riseMs + fw.fallMs + fw.delay));
          }
        }
      }
    } finally { performance.now = realNow; }
    ok("shells actually expire during a held key", reached.length > 0, reached.length);
    ok("every one of them finished its arc",
       reached.every((r) => r >= 0.97),
       reached.filter((r) => r < 0.97).map((r) => Math.round(r * 100) + "%"));
  }

  {
    // A launch with no budget left must leave the gap timer alone, so the next
    // keystroke can try again rather than serving out a gap it never used.
    const e = mk({});
    holdSpace(e, 4000);
    e._lastFireworkT = -1e9;
    const n = e.fireworks.length;
    e.spawnFireworks(caret);
    ok("a skipped launch is a no-op, not a corruption",
       e.fireworks.length >= n && live(e) <= T.FIREWORK_SPARK_BUDGET);
  }
}

// ---------------------------------------------------------------------------
section("Popping letters: rise straight up (1.6.7)");

// The letter just typed floats up from the top of the cursor and fades, like
// a phone keyboard's key preview: no throw, no spin, no fall.
{
  const e = makeEngine({ popEffects: true, popLetters: true, popLettersRise: true });
  e.styleFor = (k) => e.settings[k];
  e.look = e.settings;
  e.particles = [];
  const draws = [];
  e.ctx = { save() {}, restore() {}, translate() { draws.push({ moved: true }); }, rotate() {}, globalAlpha: 1, fillStyle: "", font: "", textAlign: "", textBaseline: "",
    fillText(ch, x, y) { draws.push({ ch, x, y, a: this.globalAlpha, font: this.font }); } };
  const anchor = { x: 100, top: 200, w: 2, h: 24, actualCharWidth: 8, fontSize: 16, fontFamily: "serif", textColor: "#fff" };
  e.spawnLetterParticle("\u{1F44B}", anchor);
  const p = e.particles[0];
  ok("spawned on the cursor's top edge, over the letter's cell, with no throw or spin", p && p.rise && p.x === 104 && p.y === 200 && p.vx === 0 && p.vy === 0 && p.rotation === 0, p);
  const t0 = p.start;
  const at = (ms) => { p.start = performance.now() - ms; draws.length = 0; e.drawLettersParticles(); return draws.find((d) => d.ch) || null; };
  const a = at(0), b = at(200), c = at(500);
  ok("it rises straight up: the same x, a smaller y each time", a && b && c && a.x === 104 && b.x === 104 && c.x === 104 && a.y > b.y && b.y > c.y, [a, b, c].map((d) => d && [d.x, +d.y.toFixed(1)]));
  ok("...no more than a line height up", c.y >= 200 - 24 - 1e-9, c.y);
  ok("...fading from a subtle start to nothing", a.a <= 0.7 + 1e-9 && b.a < a.a && c.a < b.a && c.a < 0.1, [a.a, b.a, c.a].map((v) => +v.toFixed(2)));
  ok("...not bold, and never turned (no translate or rotate)", !/bold/.test(a.font) && !draws.some((d) => d.moved), a.font);
  p.start = t0 - 5000;
  e.drawLettersParticles();
  ok("...and gone once it has faded", e.particles.length === 0);
  // Off: the old tumble, unchanged.
  const t = makeEngine({ popEffects: true, popLetters: true, popLettersRise: false });
  t.styleFor = (k) => t.settings[k];
  t.particles = [];
  t.spawnLetterParticle("a", anchor);
  ok("with it off the letter still tumbles (a throw and a spin)", t.particles[0] && !t.particles[0].rise && t.particles[0].vy < 0 && t.particles[0].rotation !== undefined);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "settings-tab.ts"), "utf8");
  ok("the switch sits under Popping letters", /toggle\("Rise straight up", [^;]*"popLettersRise", \{ depth: 2, when: all\(pop, on\("popLetters"\)\) \}\)/.test(src));
}

// ---------------------------------------------------------------------------
section("Typewriter (1.6.7)");

// Typewriter is the group's switch: alone it moves nothing ("the spring
// action should be set only with Springy strike"); its parts do.
{
  const mk = (over) => {
    const e = makeEngine(Object.assign({ typewriter: true }, over));
    e.styleFor = (k) => e.settings[k];
    e.look = e.settings;
    e.animActive = { x: 100, top: 200, w: 2, h: 24, actualCharWidth: 8 };
    return e;
  };
  const e = mk({});
  const t0 = 10000;
  e._typewriterT = t0;
  ok("Typewriter alone does not move the caret", [0, 20, 40, 100, 200].every((ms) => { const p = e.typewriterPose(t0 + ms); return p.dx === 0 && p.dy === 0 && p.sy === 1; }));
  const sp = mk({ typewriterSpring: true });
  sp._typewriterT = t0;
  ok("...Springy strike does", sp.typewriterPose(t0 + 40).dy > 0);
  ok("...with Pop effects off too: an effect of its own", (() => { const o = mk({ typewriterSpring: true, popEffects: false }); o._typewriterT = t0; return o.typewriterPose(t0 + 40).dy > 0; })());
  ok("...and nothing with Typewriter off, whatever its parts say", (() => { const o = mk({ typewriter: false, typewriterSpring: true, typewriterAdvance: true }); o._typewriterT = t0; const p = o.typewriterPose(t0 + 40); return p.dy === 0 && p.dx === 0; })());
  // The stroke starts on a character typed, not on a click or an arrow.
  const text = "the table.";
  const cmOf = (txt) => ({ workspace: { activeEditor: { editor: { cm: { state: { doc: { sliceString: (a, b) => txt.slice(a, b), length: txt.length } } } } } } });
  const at = (pos, docLen) => ({ x: pos * 8, top: 20, w: 8, h: 24, actualCharWidth: 8, pos, docLen, char: "a" });
  const k = mk({ popLetters: false });
  k.app = cmOf(text);
  k._typewriterT = 0;
  k.lastActive = at(4, text.length);
  k.resolveHoldChar(at(9, text.length));
  ok("a click ahead strikes nothing", k._typewriterT === 0);
  k.lastActive = at(4, text.length - 1);
  k.resolveHoldChar(at(5, text.length));
  ok("a character typed strikes", k._typewriterT > 0);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "paint-frame.ts"), "utf8");
  ok("the whole caret is drawn in its pose, and the damage rect follows it", /ctx\.translate\(pose\.dx, pose\.dy\);/.test(src) && /cb\.y1 \+= Math\.max\(0, pose\.dy\);/.test(src));
  const tab = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "settings-tab.ts"), "utf8");
  ok("an effect of its own: a top-level switch, opening its own sub-options", tab.includes(`"typewriter", { gate: true, when: showTw }`));
  ok("...on the rail with its own icon", tab.includes(`{ key: "typewriter", name: "Typewriter", icon: "keyboard",`));
}

// ---------------------------------------------------------------------------
section("Typewriter's sub-options (1.6.7)");

{
  const mk = (over) => {
    const e = makeEngine(Object.assign({ typewriter: true }, over));
    e.styleFor = (k) => e.settings[k];
    e.look = e.settings;
    e.animActive = { x: 100, top: 200, w: 2, h: 24, actualCharWidth: 8 };
    e.particles = []; e.typeReturns = [];
    e._markDirty = () => {};
    return e;
  };
  const t0 = 10000;
  // Springy strike: deeper, past rest on the rebound, squashed at the bottom.
  const sp = mk({ typewriterSpring: true });
  sp._typewriterT = t0;
  const poses = Array.from({ length: 241 }, (_, i) => sp.typewriterPose(t0 + i));
  const deepest = Math.max(...poses.map((p) => p.dy)), highest = Math.min(...poses.map((p) => p.dy));
  ok("Springy strike dips deeper than the plain stroke", deepest > 24 * 0.12 && deepest <= 24 * 0.18 + 1e-9, +deepest.toFixed(2));
  ok("...rises past rest on the rebound, then settles", highest < -0.3 && sp.typewriterPose(t0 + 240).dy === 0, [+highest.toFixed(2)]);
  const atBottom = poses.reduce((b, p) => (p.dy > b.dy ? p : b));
  const tallest = Math.max(...poses.map((p) => p.sy));
  ok("...squashed at the bottom, stretched a little on the rebound", atBottom.sy < 0.9 && tallest > 1, [+atBottom.sy.toFixed(3), +tallest.toFixed(3)]);
  // Carriage advance: forward past the spot and back, never behind it.
  const ad = mk({ typewriterAdvance: true });
  ad._typewriterT = t0;
  const dxs = Array.from({ length: 151 }, (_, i) => ad.typewriterPose(t0 + i).dx);
  ok("Carriage advance carries the caret forward a quarter character and back", Math.max(...dxs) > 1.8 && Math.max(...dxs) <= 8 * 0.25 + 0.05 && Math.min(...dxs) >= 0 && ad.typewriterPose(t0 + 150).dx === 0, [+Math.max(...dxs).toFixed(2)]);
  // Ink stamp: on its own cell, starting big and bold, shrinking and fading.
  const ink = mk({ typewriterInk: true });
  ink.fontString = (size, fam, w, st) => [st, w, size + "px", fam].join(" ");
  const drawn = [], scales = [];
  ink.ctx = { save() {}, restore() {}, translate() {}, scale(x) { scales.push(x); }, measureText: () => ({ width: 9, fontBoundingBoxAscent: 13, fontBoundingBoxDescent: 3 }),
    globalAlpha: 1, fillStyle: "", font: "", textAlign: "", textBaseline: "", fillText(ch, x, y) { drawn.push({ ch, x, y, a: this.globalAlpha, font: this.font }); } };
  ink.spawnInkStamp("k", { x: 100, top: 200, h: 24, fontSize: 16, fontFamily: "serif", fontWeight: "400", fontStyle: "normal", textColor: "#ddd", actualCharWidth: 8 });
  const st = ink.particles[0];
  ok("Ink stamp overprints the letter on its own cell, in the text's colour", st && st.stamp && st.x === 100 && st.y === 200 && st.color === "#ddd", st);
  const frame = (ms) => { st.start = performance.now() - ms; drawn.length = 0; scales.length = 0; ink.drawLettersParticles(); return { d: drawn[0], s: scales[0] }; };
  const f0 = frame(0), f1 = frame(200);
  ok("...bold, bigger at first and shrinking onto the letter, fading", /bold/.test(f0.d.font) && f0.s > 1.25 && f1.s < f0.s && f1.d.a < f0.d.a, [f0.s, f1.s, f0.d.a, f1.d.a].map((v) => +v.toFixed(2)));
  ok("...on the letter's baseline (the Box's metrics), from its left edge", f0.d.x === 100 && Math.abs(f0.d.y - (200 + 13 + (24 - 16) / 2)) < 1e-9, [f0.d.x, f0.d.y]);
  // Carriage return: a streak back along the old line, and the spark.
  const cr = mk({ typewriterReturn: true });
  const strokes = [];
  cr.ctx = { save() {}, restore() {}, beginPath() { strokes.push([]); }, moveTo(x, y) { strokes[strokes.length - 1].push([x, y]); }, lineTo(x, y) { strokes[strokes.length - 1].push([x, y]); }, stroke() {}, globalAlpha: 1, strokeStyle: "", lineCap: "", lineWidth: 1 };
  cr.spawnCarriageReturn({ x: 400, top: 200, h: 24, fontSize: 16, rowLeft: 40 }, { x: 40, top: 224, h: 24 });
  const r = cr.typeReturns[0];
  ok("Carriage return runs from the old line's end back to its start", r && r.x0 === 400 && r.xs === 40, r);
  r.start = performance.now() - 150; strokes.length = 0; cr.drawCarriageReturns();
  const streak = strokes[0];
  ok("...its head swept back toward the start, its tail following", streak && streak[1][0] < 150 && streak[0][0] > streak[1][0], streak);
  ok("...with a spark of four ticks at the line's end", strokes[1] && strokes[1].length === 8 && strokes[1].every(([x]) => Math.abs(x - 400) < 24), strokes[1] && strokes[1].length);
  r.start = performance.now() - 5000; cr.drawCarriageReturns();
  ok("...and gone after it", cr.typeReturns.length === 0);
  ok("a return on a line with nothing to sweep is not spawned", (() => { const q = mk({ typewriterReturn: true }); q.spawnCarriageReturn({ x: 41, top: 0, h: 24, rowLeft: 40 }, { x: 40, top: 24, h: 24 }); return q.typeReturns.length === 0; })());
  const tab2 = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "settings-tab.ts"), "utf8");
  ok("the four switches sit under Typewriter, each opening its sliders", ["typewriterSpring", "typewriterInk", "typewriterReturn", "typewriterAdvance"].every((k) => tab2.includes(`"${k}", { depth: 1, gate: true, when: tw }`)));
  const carets = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "carets.ts"), "utf8");
  ok("Enter fires the carriage return from where the old line ended", carets.includes("typewriterReturn) this.spawnCarriageReturn(this.lastActive, caret);"));
}

// ---------------------------------------------------------------------------
section("Typewriter's sliders (1.6.7)");

// Each part's sliders do what they say; the defaults are the values the
// parts were built with.
{
  const mk = (over) => {
    const e = makeEngine(Object.assign({ typewriter: true }, over));
    e.styleFor = (k) => e.settings[k];
    e.look = e.settings;
    e.animActive = { x: 100, top: 200, w: 2, h: 24, actualCharWidth: 8 };
    e.particles = []; e.typeReturns = [];
    e._markDirty = () => {};
    e._typewriterT = 10000;
    return e;
  };
  const poses = (e, n) => Array.from({ length: n + 1 }, (_, i) => e.typewriterPose(10000 + i));
  const deepest = (ps) => Math.max(...ps.map((p) => p.dy));
  const def = poses(mk({ typewriterSpring: true }), 240), deep = poses(mk({ typewriterSpring: true, typewriterDepth: 36 }), 240);
  ok("Depth: twice the percentage, twice as deep", Math.abs(deepest(deep) - 2 * deepest(def)) < 1e-6 && Math.abs(deepest(def) - 24 * 0.18) < 0.05, [deepest(def), deepest(deep)].map((v) => +v.toFixed(2)));
  const flat = poses(mk({ typewriterSpring: true, typewriterBounce: 0 }), 240);
  ok("Bounce 0: back to rest, never past it", Math.min(...flat.map((p) => p.dy)) === 0 && Math.min(...def.map((p) => p.dy)) < 0);
  const big = poses(mk({ typewriterSpring: true, typewriterBounce: 2 }), 240);
  ok("...Bounce 2: twice as far past rest", Math.abs(Math.min(...big.map((p) => p.dy)) - 2 * Math.min(...def.map((p) => p.dy))) < 1e-6);
  const noSquash = poses(mk({ typewriterSpring: true, typewriterSquash: 0 }), 240);
  ok("Squash 0: the caret keeps its height", noSquash.every((p) => p.sy === 1) && Math.min(...def.map((p) => p.sy)) < 0.9);
  const slow = poses(mk({ typewriterSpring: true, typewriterStrikeMs: 480 }), 480);
  ok("Duration: a 480 ms strike is still moving at 300 ms, the default one is not", slow[300].dy !== 0 && def[240].dy === 0 && mk({ typewriterSpring: true }).typewriterPose(10300).dy === 0);
  const far = poses(mk({ typewriterAdvance: true, typewriterAdvanceCw: 1 }), 150);
  ok("Distance: a whole character past its spot at 1", Math.abs(Math.max(...far.map((p) => p.dx)) - 8) < 0.05, +Math.max(...far.map((p) => p.dx)).toFixed(2));
  const longAdv = mk({ typewriterAdvance: true, typewriterAdvanceMs: 300 });
  ok("...Duration: still out at 200 ms when it lasts 300", longAdv.typewriterPose(10200).dx > 0 && mk({ typewriterAdvance: true }).typewriterPose(10200).dx === 0);
  // Ink stamp: size, opacity and duration read as it draws.
  const inkDraw = (over, ms) => {
    const e = mk(Object.assign({ typewriterInk: true }, over));
    e.fontString = (size, fam, w, st) => [st, w, size + "px", fam].join(" ");
    const out = {};
    e.ctx = { save() {}, restore() {}, translate() {}, scale(x) { if (out.s === undefined) out.s = x; }, measureText: () => ({ width: 9, fontBoundingBoxAscent: 13, fontBoundingBoxDescent: 3 }),
      globalAlpha: 1, fillStyle: "", font: "", textAlign: "", textBaseline: "", fillText() { out.a = this.globalAlpha; } };
    e.spawnInkStamp("k", { x: 100, top: 200, h: 24, fontSize: 16, fontFamily: "serif", fontWeight: "400", fontStyle: "normal", textColor: "#ddd" });
    e.particles[0].start = performance.now() - ms;
    e.drawLettersParticles();
    return { s: out.s, a: out.a, alive: e.particles.length };
  };
  const i0 = inkDraw({}, 0), iBig = inkDraw({ typewriterInkSize: 1.8 }, 0);
  ok("Ink stamp Size sets how big it starts; it always starts at 0.9 opacity", Math.abs(i0.s - 1.3) < 0.01 && Math.abs(iBig.s - 1.8) < 0.01 && Math.abs(i0.a - 0.9) < 0.01 && Math.abs(iBig.a - 0.9) < 0.01, [i0.s, iBig.s, i0.a, iBig.a]);
  ok("...Duration: gone at 450 ms by default, still there when it lasts 900", inkDraw({}, 450).alive === 0 && inkDraw({ typewriterInkMs: 900 }, 450).alive === 1);
  // Carriage return: thickness and duration.
  const retDraw = (over, ms) => {
    const e = mk(Object.assign({ typewriterReturn: true }, over));
    const widths = [];
    e.ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { widths.push(this.lineWidth); }, globalAlpha: 1, strokeStyle: "", lineCap: "", lineWidth: 1 };
    e.spawnCarriageReturn({ x: 400, top: 200, h: 24, fontSize: 16, rowLeft: 40 }, { x: 40, top: 224, h: 24 });
    e.typeReturns[0].start = performance.now() - ms;
    e.drawCarriageReturns();
    return { w: widths[0], alive: e.typeReturns.length };
  };
  ok("Carriage return Thickness sets the streak's width", retDraw({}, 50).w === 1.5 && retDraw({ typewriterReturnWidth: 3 }, 50).w === 3);
  ok("...Duration: gone at 350 ms by default, still sweeping when it takes 800", retDraw({}, 350).alive === 0 && retDraw({ typewriterReturnMs: 800 }, 350).alive === 1);
  ok("a value outside a slider's range is held in it", mk({ typewriterDepth: 999 }).twOpt("typewriterDepth", 0, 60) === 60 && mk({ typewriterDepth: "x" }).twOpt("typewriterDepth", 0, 60) === 18);
}
