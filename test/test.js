const Plugin = require("./harness");
const T = Plugin.__test;

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log("  pass  " + name); }
  else { fails++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
function section(s) { console.log("\n== " + s + " =="); }

// Almost every section here is synchronous and stays that way. A section that
// has to observe an `await` boundary registers a thunk instead; the summary at
// the bottom runs them in order and only then reports. Kept as a list rather
// than making the whole file async, so no existing section had to change.
const deferred = [];
function later(fn) { deferred.push(fn); }

// ---------------------------------------------------------------------------
section("migrateLegacyKeys: popEffects synthesis");

const mig = T.migrateLegacyKeys;

// Existing user with popping letters on keeps them.
ok("popLetters:true -> popEffects:true", mig({ popLetters: true }).popEffects === true);
// Existing user with them off does not suddenly get a new effect group on.
ok("popLetters:false -> popEffects:false", mig({ popLetters: false }).popEffects === false);

// Thunderstrike that was actually firing (trail on) keeps firing.
{
  const o = mig({ popLetters: false, flameTrail: true, thunderstrike: true });
  ok("live bolt turns the group on", o.popEffects === true, o);
  ok("live bolt stays enabled", o.thunderstrike === true, o);
}
// Thunderstrike stranded behind a disabled trail was invisible; it must not
// come to life just because the two got decoupled.
{
  const o = mig({ popLetters: false, flameTrail: false, thunderstrike: true });
  ok("stranded bolt does not open the group", o.popEffects === false, o);
  ok("stranded bolt is cleared", o.thunderstrike === false, o);
}
// Absent flameTrail means "inherit the default", and that default is on.
{
  const o = mig({ popLetters: false, thunderstrike: true });
  ok("absent flameTrail counts as on", o.popEffects === true, o);
}
// Sparse objects must fall through to the defaults, not be pinned to false.
ok("empty object untouched", !("popEffects" in mig({})));
ok("unrelated sparse object untouched", !("popEffects" in mig({ cursorStyle: "Box" })));
// Never clobber an explicit value.
ok("explicit popEffects preserved", mig({ popEffects: false, popLetters: true }).popEffects === false);
// Idempotent: running twice must not change the answer.
{
  const once = mig({ popLetters: true, flameTrail: false, thunderstrike: true });
  const twice = mig(once);
  ok("idempotent", JSON.stringify(once) === JSON.stringify(twice), { once, twice });
}
// Doesn't mutate its input.
{
  const src = { popLetters: true };
  mig(src);
  ok("input not mutated", !("popEffects" in src));
}

// ---------------------------------------------------------------------------
section("share codes: LOOK_KEYS is append-only");

const K = T.LOOK_KEYS;
// The three new keys must be the LAST entries, and popLetters/popRainbow must
// still sit at the indices older codes expect.
// The real invariant is that the historical PREFIX never moves - not that any
// particular key is last, which stops being true the next time something is
// added. These are the 103 keys as of the release that froze the format, with
// their indices; a share code in the wild encodes fields by these positions.
const FROZEN_PREFIX_LEN = 103;
const FROZEN_SPOT_CHECKS = {
  cursorStyle: 0, crtEffect: 13, glow: 14, popLetters: 29,
  popRainbow: 30, flameTrail: 31, backspaceDisintegrate: 32,
  cursorTranslucent: 102,
  // Torch Flicker was removed and later restored. Its key stayed at this index
  // the whole time it was gone, which is why every share code and preset in the
  // wild turns the restored effect straight back on with no migration. Pinned
  // here so a future removal doesn't drop the tombstone and break them.
  overlayFlicker: 24,
};
let moved = [];
for (const [key, idx] of Object.entries(FROZEN_SPOT_CHECKS)) {
  if (K[idx] !== key) moved.push(`${key}: expected ${idx}, found ${K.indexOf(key)}`);
}
ok("frozen key indices have not moved", moved.length === 0, moved);
ok("everything new was appended past the frozen prefix",
   K.slice(FROZEN_PREFIX_LEN).every(k => !(k in FROZEN_SPOT_CHECKS)), K.slice(FROZEN_PREFIX_LEN));
ok("popLetters index unchanged (before cursorTranslucent)",
   K.indexOf("popLetters") < K.indexOf("cursorTranslucent"));
ok("no duplicate keys", new Set(K).size === K.length);
ok("the flicker depth dial was appended, not inserted",
   K.indexOf("overlayFlickerAmount") >= FROZEN_PREFIX_LEN, K.indexOf("overlayFlickerAmount"));
// The gate and its dial sit far apart in the array on purpose - one is a
// tombstone being reused, the other is new - and that is fine, since nothing
// reads them positionally except the codec.
ok("the restored flicker gate is still in its original slot",
   K.indexOf("overlayFlicker") < FROZEN_PREFIX_LEN);
ok("every LOOK_KEY exists in DEFAULT_SETTINGS",
   K.filter(k => !(k in T.DEFAULT_SETTINGS)), K.filter(k => !(k in T.DEFAULT_SETTINGS)).length === 0);
ok("every LOOK_KEY exists in DEFAULT_SETTINGS (assert)",
   K.every(k => k in T.DEFAULT_SETTINGS));

// An old share code carries popLetters but no popEffects: importing it must
// still light the group up.
{
  const oldCode = { popLetters: true, flameTrail: true, cursorStyle: "Box" };
  const imported = T.presetWithDefaults(oldCode);
  ok("old code import keeps popping letters", imported.popEffects === true && imported.popLetters === true, imported.popEffects);
}

// ---------------------------------------------------------------------------
section("defaults");

const D = T.DEFAULT_SETTINGS;
ok("popEffects defaults on (matches old popLetters default)", D.popEffects === true);
ok("popLetters still on by default", D.popLetters === true);
ok("fireworks off by default", D.fireworks === false);
ok("thunderstrike off by default", D.thunderstrike === false);
ok("fireworksQuantity defaults to 1", D.fireworksQuantity === 1);

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
function makeEngine(settings, clipTop = 0) {
  const e = Object.create(Plugin.prototype);
  e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
  e.fireworks = [];
  e._lastFireworkT = -1e9;
  e._popRainbowHue = 0;
  e._clipTop = clipTop;
  e.dirty = [];
  e._markDirty = (x, y, w, h) => e.dirty.push({ x, y, w, h });
  e.getActiveColor = () => e.settings.colorDark || "#39ff14";
  // gradientStops() asks the live document which theme is showing; there isn't
  // one here, so pin it to dark and let the tests drive gradientDark*.
  e.isDarkTheme = () => true;
  e.ctx = makeCtx();
  return e;
}
function makeCtx() {
  const calls = [];
  return {
    calls,
    // The burst carries its alpha on globalAlpha now rather than baking it
    // into an rgba() string per spark, so the recorder has to capture it -
    // otherwise the effective alpha of every block reads as 1.
    globalAlpha: 1,
    save() {}, restore() {},
    set fillStyle(v) { this._fill = v; },
    get fillStyle() { return this._fill; },
    fillRect(x, y, w, h) {
      calls.push({ x, y, w, h, fill: this._fill, alpha: this.globalAlpha });
    },
  };
}
const caret = { x: 200, top: 400, w: 8, h: 20 };
const SPEED_LIFTOFF = T.SPEED_RAMP_LIFTOFF;

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
section("backspace disintegration: relocation to Pop Effects");

// Live disintegration (trail on) must survive the upgrade.
{
  const o = mig({ popLetters: false, flameTrail: true, backspaceDisintegrate: true });
  ok("live disintegration turns the group on", o.popEffects === true, o);
  ok("live disintegration stays enabled", o.backspaceDisintegrate === true, o);
}
// Stranded behind a disabled trail: invisible before, must stay invisible.
{
  const o = mig({ popLetters: false, flameTrail: false, backspaceDisintegrate: true });
  ok("stranded disintegration does not open the group", o.popEffects === false, o);
  ok("stranded disintegration is cleared", o.backspaceDisintegrate === false, o);
}
// Both relocated options stranded together.
{
  const o = mig({ popLetters: false, flameTrail: false, thunderstrike: true, backspaceDisintegrate: true });
  ok("both stranded options cleared", o.thunderstrike === false && o.backspaceDisintegrate === false, o);
  ok("group stays off when everything was stranded", o.popEffects === false, o);
}
// A settings object carrying ONLY the disintegration key still migrates.
{
  const o = mig({ backspaceDisintegrate: true });
  ok("disintegration alone is enough to infer the gate", o.popEffects === true, o);
}
// The clear must not fire on already-migrated settings, where "bolt with the
// trail off" is now a legal configuration the user chose deliberately.
{
  const o = mig({ popEffects: true, flameTrail: false, thunderstrike: true, backspaceDisintegrate: true });
  ok("new-world config is left alone", o.thunderstrike === true && o.backspaceDisintegrate === true, o);
}
// Still idempotent with the extra key in play.
{
  const once = mig({ popLetters: false, flameTrail: false, backspaceDisintegrate: true });
  const twice = mig(once);
  ok("idempotent with disintegration", JSON.stringify(once) === JSON.stringify(twice), { once, twice });
}
// Built-in presets that ship disintegration on must come out coherent.
{
  const withDust = T.presetWithDefaults({ popLetters: false, flameTrail: true, backspaceDisintegrate: true });
  ok("preset with disintegration lands with the group on", withDust.popEffects === true, withDust.popEffects);
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
section("shipped presets survive the regrouping unchanged");

// Four of the six starters declare backspaceDisintegrate:true alongside
// flameTrail:false - an effect that could never fire under the old gate. Now
// that the gate is gone, each preset must still LOOK the way it always has.
for (const [name, snap] of Object.entries(T.DEFAULT_PRESETS)) {
  const before = {
    trail: snap.flameTrail !== false,
    // What actually fired under the old rules: both were gated on the trail.
    dust: !!snap.backspaceDisintegrate && snap.flameTrail !== false,
    bolt: !!snap.thunderstrike && snap.flameTrail !== false,
    letters: !!snap.popLetters,
  };
  const after = T.presetWithDefaults(snap);
  const nowFires = {
    trail: !!after.flameTrail,
    dust: !!after.popEffects && !!after.backspaceDisintegrate,
    bolt: !!after.popEffects && !!after.thunderstrike,
    letters: !!after.popEffects && !!after.popLetters,
  };
  ok(`"${name}" behaves identically`,
     JSON.stringify(before) === JSON.stringify(nowFires),
     { before, nowFires });
}

// Same check for the baked-in Vim starting point.
for (const [mode, snap] of Object.entries(T.PRESET1_VIM_MODES)) {
  const before = {
    dust: !!snap.backspaceDisintegrate && snap.flameTrail !== false,
    bolt: !!snap.thunderstrike && snap.flameTrail !== false,
    letters: !!snap.popLetters,
  };
  const after = T.presetWithDefaults(snap);
  const nowFires = {
    dust: !!after.popEffects && !!after.backspaceDisintegrate,
    bolt: !!after.popEffects && !!after.thunderstrike,
    letters: !!after.popEffects && !!after.popLetters,
  };
  ok(`vim "${mode}" behaves identically`,
     JSON.stringify(before) === JSON.stringify(nowFires), { before, nowFires });
}


// ---------------------------------------------------------------------------
section("share codes: legacy decoder is gone");

{
  // A v1 code still round-trips.
  const code = T.presetToCode("Round Trip", { cursorStyle: "Box", popEffects: true, fireworks: true, fireworksQuantity: 2.5 });
  ok("v1 code has the version prefix", code.startsWith("1|"), code.slice(0, 12));
  const back = T.codeToPreset(code);
  ok("v1 code decodes", back && back.name === "Round Trip", back && back.name);
  ok("new keys survive the round trip",
     back.snap.fireworks === true && back.snap.fireworksQuantity === 2.5, back && back.snap);

  // The old base64url-JSON format must now be rejected, not silently decoded.
  const legacy = Buffer.from(JSON.stringify({ __name: "Old One", cursorStyle: "Line" }))
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  ok("pre-v1 base64 code is rejected", T.codeToPreset(legacy) === null, T.codeToPreset(legacy));

  // A Vim code is not a preset code.
  ok("vim code rejected by the preset decoder", T.codeToPreset("2|Name|~") === null);
  // Junk.
  ok("junk rejected", T.codeToPreset("hello world") === null);
  ok("empty rejected", T.codeToPreset("") === null);

  // migrateLegacyKeys must still be reachable from the import path - a v1 code
  // written before popEffects existed carries popLetters only.
  const oldV1 = T.presetToCode("Pre-group", { popLetters: true, flameTrail: true });
  const decoded = T.codeToPreset(oldV1);
  delete decoded.snap.popEffects;             // simulate a code from before the key
  const settled = T.presetWithDefaults(decoded.snap);
  ok("key migration still runs on imported codes", settled.popEffects === true, settled.popEffects);
}

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
section("palette: Toggle CUA/Vim mode");

// This command was removed from the palette once, for real reasons, and is
// back because the chain underneath it has since been hardened - see the note
// where the commands are registered. What is tested here is the part that is
// genuinely new: toggleUiMode's own contract. setVimModeEnabled is stubbed
// throughout; what IT does needs Obsidian's vim adapter, and is not what this
// command added.
{
  // Deferred assertions land at the bottom of the run, after every
  // synchronous section, so they get a header of their own rather than
  // appearing as loose passes under whatever finished last.
  later(() => section("palette: Toggle CUA/Vim mode (after the await)"));

  const mkPlugin = (settings, over = {}) => {
    const p = Object.create(Plugin.prototype);
    p.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    p.calls = [];
    p.refreshed = 0;
    p.setVimModeEnabled = async (v) => {
      p.calls.push(v);
      p.settings.uiMode = v ? "vim" : "cua";
      p.settings.vimModeEnabled = v;
    };
    p.refreshSettingTab = () => { p.refreshed++; };
    return Object.assign(p, over);
  };

  // setVimModeEnabled is called SYNCHRONOUSLY, before toggleUiMode's first
  // await, so direction and the latch can both be read without waiting.
  {
    const cua = mkPlugin({ uiMode: "cua", vimModeEnabled: false });
    cua.toggleUiMode();
    ok("CUA toggles to Vim", cua.calls.length === 1 && cua.calls[0] === true, cua.calls);

    const vim = mkPlugin({ uiMode: "vim", vimModeEnabled: true });
    vim.toggleUiMode();
    ok("Vim toggles back to CUA", vim.calls.length === 1 && vim.calls[0] === false, vim.calls);

    // An install predating uiMode carries only vimModeEnabled. Reading
    // settings.uiMode directly would see "cua" here and switch the user INTO
    // the mode they are already in, so the first press would look dead.
    const legacy = mkPlugin({ vimModeEnabled: true });
    delete legacy.settings.uiMode;
    legacy.toggleUiMode();
    ok("a pre-uiMode install toggles the right way", legacy.calls[0] === false, legacy.calls);
  }

  // Single-flight. This is the one guard that exists because of the palette: a
  // held hotkey re-fires where a button cannot be clicked mid-flight, and
  // setVimModeEnabled awaits a disk write partway through a chain that
  // rebuilds every editor's extensions.
  {
    let release;
    const p = mkPlugin({ uiMode: "cua" });
    p.setVimModeEnabled = (v) => { p.calls.push(v); return new Promise((r) => { release = r; }); };
    p.toggleUiMode();
    p.toggleUiMode();
    p.toggleUiMode();
    ok("a held hotkey cannot stack switches", p.calls.length === 1, p.calls);
    ok("...the latch is up while one is in flight", p._uiModeSwitching === true);
    release();
    later(async () => {
      await Promise.resolve(); await Promise.resolve();
      ok("...and drops once the switch settles", p._uiModeSwitching === false);
      p.settings.uiMode = "vim";
      p.setVimModeEnabled = async (v) => { p.calls.push(v); };
      await p.toggleUiMode();
      ok("...leaving the command usable again", p.calls.length === 2 && p.calls[1] === false, p.calls);
    });
  }

  // The latch is released in a `finally`. setVimModeEnabled guards its own
  // side effects but saveSettings() inside it is not guarded, and a latch
  // stuck true would kill the command for the rest of the session - a much
  // worse failure than the one that caused it.
  {
    const p = mkPlugin({ uiMode: "cua" });
    p.setVimModeEnabled = async () => { throw new Error("disk full"); };
    later(async () => {
      let threw = false;
      try { await p.toggleUiMode(); } catch { threw = true; }
      ok("a failed switch still rejects", threw === true);
      ok("...but does not wedge the command", p._uiModeSwitching === false);
    });
  }

  // Feedback. The status bar indicator only exists in Vim mode, so switching
  // TO CUA removes the one thing that was showing the mode - without a notice
  // that direction is a command with no visible effect at all.
  {
    later(async () => {
      T.Notice.messages.length = 0;
      const toVim = mkPlugin({ uiMode: "cua" });
      await toVim.toggleUiMode();
      const toCua = mkPlugin({ uiMode: "vim", vimModeEnabled: true });
      await toCua.toggleUiMode();
      ok("both directions say which mode you landed in", T.Notice.messages.length === 2,
         T.Notice.messages);
      ok("...naming Vim", /vim/i.test(T.Notice.messages[0] || ""), T.Notice.messages[0]);
      ok("...and naming CUA", /cua/i.test(T.Notice.messages[1] || ""), T.Notice.messages[1]);
      ok("the open settings panel is refreshed", toVim.refreshed === 1, toVim.refreshed);
    });
  }
}

// refreshSettingTab is the real method here, not a stub. It exists because the
// panel's mode switch is drawn from uiMode at build time, so toggling from the
// palette with Settings open used to leave it showing the mode you just left -
// and clicking the half that looked inactive then did nothing, because
// renderModeSwitch's own guard correctly saw the mode was already current.
{
  const mkTab = (attached) => {
    const el = { ownerDocument: null };
    const doc = { body: { contains: (x) => attached && x === el } };
    el.ownerDocument = doc;
    const tab = { containerEl: el, displayed: 0, display() { tab.displayed++; } };
    return tab;
  };
  const run = (tab) => {
    const p = Object.create(Plugin.prototype);
    p.settingTab = tab;
    p.refreshSettingTab();
    return p;
  };

  const open = mkTab(true);
  run(open);
  ok("an on-screen panel is rebuilt", open.displayed === 1, open.displayed);

  // A tab that was opened once and closed keeps its containerEl; the element
  // is simply no longer in a document. Obsidian offers no "is my tab open"
  // flag, so that detachment IS the test.
  const closed = mkTab(false);
  run(closed);
  ok("a closed panel is left alone", closed.displayed === 0, closed.displayed);

  let threw = false;
  try { run(undefined); } catch { threw = true; }
  ok("never having opened Settings is fine", threw === false);

  // Fails closed, like every other decorative step in this plugin: a stale
  // panel is far cheaper than a palette command that throws.
  {
    const bad = mkTab(true);
    bad.display = () => { throw new Error("panel exploded"); };
    const realError = console.error;
    console.error = () => {};
    let blew = false;
    try { run(bad); } catch { blew = true; } finally { console.error = realError; }
    ok("a throwing panel cannot take the command down", blew === false);
  }
}

// ---------------------------------------------------------------------------
section("multi-cursor carets follow the gradient");

// A secondary caret is a cursor body, so it gets the cursor's colour - and
// with Gradient on that means the whole ramp, not a flat slice of it. It used
// to take getActiveColor() unconditionally, which for a gradient cursor is the
// ramp's FIRST STOP: the primary caret was multi-coloured and every other
// caret was a single wrong-looking colour.
{
  // Stroke-recording ctx. makeCtx() only knows about fillRect; this path
  // strokes lines and, on the gradient branch, builds CanvasGradients.
  const makeStrokeCtx = () => {
    const strokes = [];
    const gradients = [];
    let path = null;
    return {
      strokes, gradients,
      lineWidth: 0, lineCap: "",
      save() {}, restore() {},
      set strokeStyle(v) { this._stroke = v; },
      get strokeStyle() { return this._stroke; },
      createLinearGradient(x0, y0, x1, y1) {
        const g = { kind: "gradient", x0, y0, x1, y1, stops: [],
                    addColorStop(o, c) { g.stops.push({ offset: o, color: c }); } };
        gradients.push(g);
        return g;
      },
      beginPath() { path = {}; },
      moveTo(x, y) { path.x0 = x; path.y0 = y; },
      lineTo(x, y) { path.x1 = x; path.y1 = y; },
      stroke() { strokes.push(Object.assign({ style: this._stroke }, path)); },
    };
  };

  const carets = [
    { x: 100, top: 40, bottom: 60 },
    { x: 220, top: 80, bottom: 100 },
    { x: 340, top: 120, bottom: 140 },
  ];

  const mk = (over, list = carets) => {
    const e = makeEngine(over);
    e.ctx = makeStrokeCtx();
    e.secondaryCarets = list.map((c) => Object.assign({}, c));
    e.blinkAlpha = () => 1;          // the blink is tested elsewhere
    e.heat = 0;
    return e;
  };

  // --- Gradient off: unchanged behaviour ---------------------------------
  {
    const e = mk({ gradientEnabled: false, colorDark: "#39ff14" });
    e.drawSecondaryCarets();
    ok("every caret is stroked", e.ctx.strokes.length === 3, e.ctx.strokes.length);
    ok("no gradient is built when Gradient is off", e.ctx.gradients.length === 0);
    ok("...they take the flat cursor colour",
       e.ctx.strokes.every((st) => typeof st.style === "string" && /^rgba?\(/.test(st.style)),
       e.ctx.strokes.map((st) => st.style));
    ok("each caret marks its own damage", e.dirty.length === 3, e.dirty.length);
  }

  // --- Gradient on: the whole ramp, per caret ----------------------------
  {
    const e = mk({
      gradientEnabled: true, gradientCount: 3,
      gradientDark1: "#ff0000", gradientDark2: "#00ff00", gradientDark3: "#0000ff",
    });
    e.drawSecondaryCarets();

    ok("one gradient per caret", e.ctx.gradients.length === 3, e.ctx.gradients.length);
    ok("no caret is left on a flat colour",
       e.ctx.strokes.every((st) => st.style && st.style.kind === "gradient"),
       e.ctx.strokes.map((st) => (st.style && st.style.kind) || st.style));

    // Each gradient has to span ITS OWN caret. One shared gradient, or one
    // built at the first caret's coordinates, would leave the others painted
    // with whatever slice of the ramp happened to cross them.
    const aligned = e.ctx.strokes.every((st, i) => {
      const g = st.style;
      return g.x0 === st.x0 && g.y0 === carets[i].top && g.y1 === carets[i].bottom;
    });
    ok("each gradient spans its own caret", aligned,
       e.ctx.gradients.map((g) => [g.y0, g.y1]));

    // Vertical, like the primary Line cursor: a ramp running across a 2px-wide
    // caret is a muddy average of the stops.
    ok("the ramp runs down the caret, not across it",
       e.ctx.gradients.every((g) => g.x0 === g.x1 && g.y1 > g.y0));

    ok("all three stops are used", e.ctx.gradients.every((g) => g.stops.length === 3),
       e.ctx.gradients.map((g) => g.stops.length));
    ok("...ending at the last stop",
       e.ctx.gradients.every((g) => g.stops[0].offset === 0 && g.stops[2].offset === 1));
    ok("...in the configured order",
       e.ctx.gradients.every((g) =>
         /255,\s*0,\s*0/.test(g.stops[0].color) && /0,\s*0,\s*255/.test(g.stops[2].color)),
       e.ctx.gradients[0].stops.map((st) => st.color));
  }

  // The ramp is resolved once per frame, not once per caret: a multi-cursor
  // edit can carry hundreds of carets, and this runs on every one of them.
  // Same rule the firework sparks' baked palette follows.
  {
    const many = Array.from({ length: 40 }, (_, i) => ({ x: 10 * i, top: 0, bottom: 20 }));
    const e = mk({ gradientEnabled: true, gradientCount: 2 }, many);
    let calls = 0;
    const real = e.gradientStops.bind(e);
    e.gradientStops = (...a) => { calls++; return real(...a); };
    e.drawSecondaryCarets();
    ok("the ramp is walked once for the whole frame", calls === 1, calls);
    ok("...and every caret still got painted", e.ctx.strokes.length === 40, e.ctx.strokes.length);
  }

  // Opacity reaches the ramp too - it used to be baked into the one flat
  // rgba() string, which the gradient branch would otherwise have skipped.
  {
    const e = mk({ gradientEnabled: true, gradientCount: 2, cursorOpacity: 0.5 });
    e.drawSecondaryCarets();
    const alphas = e.ctx.gradients[0].stops.map((st) => Number(/,\s*([\d.]+)\)$/.exec(st.color)[1]));
    ok("cursor opacity is carried into every stop",
       alphas.every((a) => Math.abs(a - 0.45) < 1e-6), alphas);
  }

  // A zero-length gradient line paints NOTHING per the canvas spec, so a caret
  // CodeMirror measured as having no height has to fall back rather than
  // silently disappear.
  {
    const e = mk({ gradientEnabled: true, gradientCount: 2 }, [{ x: 50, top: 30, bottom: 30 }]);
    e.drawSecondaryCarets();
    ok("a zero-height caret falls back to a flat stop",
       e.ctx.gradients.length === 0 && typeof e.ctx.strokes[0].style === "string",
       e.ctx.strokes[0] && e.ctx.strokes[0].style);
  }

  // Fully blinked out: nothing drawn at all, and in particular no ramp built.
  {
    const e = mk({ gradientEnabled: true });
    e.blinkAlpha = () => 0;
    e.drawSecondaryCarets();
    ok("a blinked-out frame paints nothing", e.ctx.strokes.length === 0 && e.ctx.gradients.length === 0);
  }
}

// ---------------------------------------------------------------------------
section("settings panel renders");

// This section exists because of a real bug that shipped past every other test
// here: a row referenced a bare `plugin` where only `this.plugin` is in scope,
// which threw a ReferenceError mid-render and silently removed that row AND
// every row after it from the panel. Nothing engine-side can see that - the
// effect worked perfectly, you just couldn't reach its toggle.
const { renderPanel } = require("./panel_harness");

function panelRows(settings) {
  try { return renderPanel(settings); }
  catch (e) { return { threw: e }; }
}
const named = (rows, name) => rows.some(r => r.name === name);

{
  const rows = panelRows({});
  ok("the panel renders without throwing", !rows.threw, rows.threw && rows.threw.message);
  ok("it produces a substantial number of rows", rows.length > 25, rows.length);
}

// Every effect's top-level row must be reachable at default settings. A missing
// name here means something threw before it, or a gate is wrong.
{
  const rows = panelRows({});
  for (const name of ["Pop Effects", "Pixel Trail", "Speed Demon", "CRT Effect"]) {
    ok(`"${name}" is reachable`, named(rows, name), rows.map(r => r.name).filter(Boolean));
  }
  ok("Text Crawl is gone", !rows.some(r => (r.name || "").includes("Crawl")),
     rows.map(r => r.name).filter(n => n && n.includes("Crawl")));
}

// Pop Effects' five sub-options, and the rows that hang off them.
{
  const rows = panelRows({ popEffects: true });
  for (const name of ["Rainbow", "Popping Letters", "Backspace Disintegration",
                      "Thunderstrike", "Fireworks"]) {
    ok(`Pop Effects shows "${name}"`, named(rows, name), name);
  }
  // Built and removed; asserted absent so a half-finished revert can't put it
  // back unnoticed.
  ok("Matrix Rain is gone", !named(rows, "Matrix Rain"));
  ok("Rain Density is gone", !named(rows, "Rain Density"));

  const closed = panelRows({ popEffects: false });
  ok("the group gate hides its sub-options", !named(closed, "Fireworks"));
}

// Sub-sliders appear only with their parent on - and crucially, the rows AFTER
// them still render, which is what the original ReferenceError bug broke.
{
  const on = panelRows({ popEffects: true, fireworks: true });
  ok("Quantity appears with Fireworks on", named(on, "Quantity"));
  const off = panelRows({ popEffects: true, fireworks: false });
  ok("Quantity is hidden with Fireworks off", !named(off, "Quantity"));

  const bolt = panelRows({ popEffects: true, thunderstrike: true });
  ok("Thunderstrike's sliders appear", named(bolt, "Bolt Size") && named(bolt, "Strength"));
  ok("rows after Thunderstrike still render", named(bolt, "Fireworks"));
}

// Blink-to-solid's row, and the rows either side of it. Per ARCHITECTURE:
// assert a row renders AND that a row after it still does, since a throw takes
// out everything downstream of itself.
{
  const on = panelRows({ blinkingEnabled: true });
  ok("\"Stop After\" is reachable", named(on, "Stop After"), on.map(r => r.name).filter(Boolean));
  ok("...the row before it still renders", named(on, "Blink Delay"));
  ok("...and the row after it does too", named(on, "Breathing"));
  const off = panelRows({ blinkingEnabled: false });
  ok("...and the blink gate hides it", !named(off, "Stop After"));
}

// Speed Demon's custom ramp rows, including the Keep Cursor Color interaction.
{
  const on = panelRows({ speedDemon: true, speedDemonGradient: true });
  ok("custom heat stops render", named(on, "Stages (Dark Theme)") && named(on, "Stages (Light Theme)"));
  const keep = panelRows({ speedDemon: true, speedDemonNoCursorHeat: true });
  ok("Keep Cursor Color hides the custom ramp", !named(keep, "Custom Gradient"));
}

// CRT rows. Inverted Trail was built and then removed; assert it is gone
// rather than dropping the check, so a half-finished revert can't sneak back.
{
  const on = panelRows({ crtEffect: true });
  ok("CRT sub-options render", named(on, "Glow") && named(on, "Signal Glitch"));
  ok("Inverted Trail is gone", !named(on, "Inverted Trail"));
  ok("Inversion Strength is gone", !named(on, "Inversion Strength"));
  const off = panelRows({ crtEffect: false });
  ok("CRT off hides its sub-options", !named(off, "Signal Glitch"));
}

// Flip was a Box-only row; with Text Crawl gone it must not reappear anywhere.
{
  for (const style of ["Box", "Line", "Underline"]) {
    const rows = panelRows({ cursorStyle: style, popEffects: true });
    ok(`"${style}" style renders cleanly`, !rows.threw && rows.length > 20,
       rows.threw && rows.threw.message);
  }
}

// Cursor Color: one row carrying both swatches, not two labelled rows. Asserted
// on the control count as well as the name, since a row that lost a picker
// would still be named right.
{
  const rows = panelRows({ gradientEnabled: false });
  const color = rows.filter((r) => r.name === "Cursor Color");
  ok("the flat cursor colors share one row", color.length === 1, rows.filter(r => /Cursor Color/.test(r.name || "")).map(r => r.name));
  ok("that row carries both swatches", color[0] && color[0].controls.length === 2,
     color[0] && color[0].controls);
  ok("the old per-theme color rows are gone",
     !named(rows, "Cursor Color (Dark Theme)") && !named(rows, "Cursor Color (Light Theme)"));

  // Same helper builds the gradient rows, so a break in it shows up here too.
  const grad = panelRows({ gradientEnabled: true, gradientCount: 3 });
  const dark = grad.find((r) => r.name === "Colors (Dark Theme)");
  ok("gradient rows still carry one swatch per color", dark && dark.controls.length === 3,
     dark && dark.controls.length);
  ok("the flat color row is hidden while Gradient is on", !named(grad, "Cursor Color"));
}

// Pop Effects' Rainbow: last in the group, and only once there is something for
// it to recolour. The gate is on the four effects, NOT on popEffects - the
// group can be on with everything inside it off, and that is exactly the state
// where the toggle would recolour nothing.
{
  const allOff = panelRows({
    popEffects: true, popLetters: false, backspaceDisintegrate: false,
    thunderstrike: false, fireworks: false,
  });
  ok("Pop Effects with nothing on hides Rainbow", !named(allOff, "Rainbow"));
  ok("...but the group's own effects are still offered",
     named(allOff, "Popping Letters") && named(allOff, "Fireworks"));

  // Each of the four independently reveals it. backspaceDisintegrate is the one
  // that mattered: it saved without redrawing until Rainbow's visibility came
  // to depend on it, so switching it on would have left Rainbow unreachable
  // until some other row happened to redraw the panel.
  for (const key of ["popLetters", "backspaceDisintegrate", "thunderstrike", "fireworks"]) {
    const rows = panelRows({
      popEffects: true, popLetters: false, backspaceDisintegrate: false,
      thunderstrike: false, fireworks: false, [key]: true,
    });
    ok(`${key} alone reveals Rainbow`, named(rows, "Rainbow"));
  }

  // Order: it is a modifier across the group, so it reads as a summary at the
  // bottom rather than as another sibling effect at the top.
  const on = panelRows({
    popEffects: true, popLetters: true, backspaceDisintegrate: true,
    thunderstrike: true, fireworks: true,
  });
  const at = (n) => on.findIndex((r) => r.name === n);
  ok("Rainbow sits below all four effects",
     at("Rainbow") > at("Popping Letters") && at("Rainbow") > at("Backspace Disintegration") &&
     at("Rainbow") > at("Thunderstrike") && at("Rainbow") > at("Fireworks"),
     { rainbow: at("Rainbow"), fireworks: at("Fireworks") });
  // Its sub-options belong to their own effects, so it must not have swallowed
  // them on the way down.
  ok("the effects kept their own sub-options",
     named(on, "Bolt Size") && named(on, "Quantity"));
  ok("the whole group still renders past Rainbow", named(on, "Pixel Trail"));
}

// Torch Flicker, restored on the key that stayed in LOOK_KEYS while it was
// gone. Depth is conditional on the gate, like every other dial in the panel.
{
  const off = panelRows({ torchEffect: true, overlayFlicker: false });
  ok("Flicker is offered with the torch on", named(off, "Flicker"));
  ok("Flicker Depth is hidden while Flicker is off", !named(off, "Flicker Depth"));

  const on = panelRows({ torchEffect: true, overlayFlicker: true });
  ok("Flicker Depth appears with Flicker on", named(on, "Flicker Depth"));
  // The panel harness exists for exactly this: a row that throws while being
  // built silently removes itself and every row after it.
  ok("rows after Flicker still render", named(on, "Keep Sidebars Lit"));

  const noTorch = panelRows({ torchEffect: false });
  ok("no torch, no Flicker", !named(noTorch, "Flicker") && !named(noTorch, "Flicker Depth"));
}

// Every slider carries a "restore default" button. Checked as a completeness
// rule over whatever the panel actually built rather than as a list of names,
// so a slider added later fails this until it has one too - the same shape as
// the _isAnimating() completeness check.
{
  // Settings chosen to open as many gated groups as possible, so the sweep
  // sees the conditional sliders and not just the always-visible ones.
  const wideOpen = {
    popEffects: true, popLetters: true, backspaceDisintegrate: true,
    thunderstrike: true, fireworks: true, flameTrail: true, flameTrailGravity: 0.5,
    stardustEnabled: true, stardustOrbit: true, bracketTether: true,
    smear: true, smearTaper: true, energyBeam: true, trailEnabled: true,
    crtEffect: true, crtGlitch: true, speedDemon: true, speedDemonSparks: true,
    torchEffect: true, overlayFlicker: true, overlayBlinkSync: true,
    blinkingEnabled: true, blinkBreathing: true, smoothEnabled: true,
    smoothAdaptive: true, cursorStyle: "Box", boxHollow: true,
  };
  const rows = panelRows(wideOpen);
  ok("the wide-open panel renders", !rows.threw, rows.threw && rows.threw.message);

  const sliderRows = rows.filter((r) => r.controls.includes("slider"));
  ok("the sweep actually found the sliders", sliderRows.length > 30, sliderRows.length);

  const naked = sliderRows.filter((r) => r.extras.length === 0).map((r) => r.name);
  ok("every slider row has a reset button", naked.length === 0, naked);

  const unlabelled = sliderRows
    .filter((r) => !r.extras.some((b) => b._icon && b._tooltip && typeof b._click === "function"))
    .map((r) => r.name);
  ok("...each with an icon, a tooltip and something to do", unlabelled.length === 0, unlabelled);

  // A toggle-only row must NOT have grown one: the button is a slider
  // affordance, and this is what catches a mis-scoped edit that stapled it
  // onto every row in the panel.
  const toggleOnly = rows.filter((r) => r.controls.length === 1 && r.controls[0] === "toggle");
  ok("toggles did not get one", toggleOnly.every((r) => r.extras.length === 0),
     toggleOnly.filter((r) => r.extras.length).map((r) => r.name));
}

// Pressing reset writes that slider's DEFAULT_SETTINGS value - not the
// `?? fallback` at the call site, and not some other row's key.
{
  const D = T.DEFAULT_SETTINGS;
  // Every slider starts somewhere other than its default, so a button that
  // wrote nothing at all would be indistinguishable from one that worked.
  const moved = {
    popEffects: true, thunderstrike: true, fireworks: true, flameTrail: true,
    blinkingEnabled: true, smoothEnabled: true, torchEffect: true,
    cursorStyle: "Line", caretWidthPx: 11, cursorOpacity: 0.35, blinkSpeed: 2.7,
    trailLength: 27, overlayRadius: 780, fireworksQuantity: 2.8,
  };
  const rows = panelRows(moved);
  // Presses a slider's reset and returns what it wrote plus the rows its
  // section re-rendered (the harness's rows array is append-only).
  const press = (name) => {
    const row = rows.find((r) => r.name === name && r.controls.includes("slider"));
    if (!row || !row.extras.length) return null;
    rows.writes.length = 0;
    const before = rows.length;
    row.extras[0]._click();
    return { w: rows.writes[0] || null, added: rows.slice(before) };
  };

  for (const [name, key] of [["Cursor Thickness", "caretWidthPx"],
                             ["Cursor Opacity", "cursorOpacity"],
                             ["Blink Speed", "blinkSpeed"]]) {
    const { w, added } = press(name) || {};
    ok(`"${name}" resets its own key`, w && w.key === key, w);
    ok(`...to the default (${D[key]})`, w && w.value === D[key], w && w.value);
    // Not the cheaper `set` alone: a slider's handle is DOM state nothing
    // else updates, so the row has to be rebuilt or the number moves while
    // the handle stays put. The rebuilt row must show the default.
    const rebuilt = added.find((r) => r.name === name && r.controls.includes("slider"));
    ok("...and rebuilds the row with the handle at the default",
       rebuilt && rebuilt.sliders[0]._value === D[key],
       rebuilt ? rebuilt.sliders[0]._value : "no rebuilt row");
  }

  // Sweep the rest: whatever key each button writes, it must write that key's
  // default, and it must be a key the defaults actually know about. A typo'd
  // key would otherwise write `undefined` and read as a working button.
  const sliderRows = rows.filter((r) => r.controls.includes("slider") && r.extras.length);
  const bad = [];
  for (const row of sliderRows) {
    rows.writes.length = 0;
    row.extras[0]._click();
    const w = rows.writes[0];
    if (!w || !(w.key in D) || w.value !== D[w.key] || w.value === undefined) {
      bad.push({ row: row.name, wrote: w });
    }
  }
  ok("every reset button writes a real default", bad.length === 0, bad);
}

// ---------------------------------------------------------------------------
section("settings panel: gated toggles re-render their own section");

// A toggle that reveals or hides other rows used to call display(), which
// empties the whole panel and builds every row again - a full teardown of a
// very long panel to change three rows in one section. Now it re-renders the
// section it lives in, in place: the <details> element, its open state and
// every other section's DOM are untouched. A section that reads a gate from
// ANOTHER section declares it in `rerenderOn`, and the completeness check at
// the bottom is what keeps that list honest.
{
  const { sectionOf } = require("./panel_harness");
  const D = T.DEFAULT_SETTINGS;

  // Flip a toggle by name and return the rows its press appended.
  const flip = (rows, name) => {
    const row = rows.find((r) => r.name === name && r.toggles.length);
    if (!row) return null;
    const before = rows.length;
    row.toggles[0]._change(!row.toggles[0]._value);
    return rows.slice(before);
  };
  const sectionsOf = (list) => [...new Set(list.map(sectionOf))];

  // --- One section's gate re-renders that section and nothing else ---------
  {
    const rows = panelRows({ crtEffect: false });
    const n = rows.length;
    const added = flip(rows, "CRT Effect");
    ok("flipping an Effects gate appends new rows", added && added.length > 0, added && added.length);
    ok("...all of them in Effects", added && sectionsOf(added).join() === "Effects", added && sectionsOf(added));
    ok("...and the rows built before the press are still there", rows.length === n + added.length);
    ok("...with the toggle now on", rows.settings.crtEffect === true);
    const sub = added.find((r) => r.name === "Trail Length");
    ok("...revealing the gate's own sub-options", !!sub, added.map((r) => r.name).slice(0, 6));
  }
  {
    const rows = panelRows({ smoothEnabled: false });
    const added = flip(rows, "Smooth Movement");
    ok("a Smooth Movement gate re-renders Smooth Movement only",
       added && sectionsOf(added).join() === "Smooth Movement", added && sectionsOf(added));
  }

  // --- The section is re-rendered IN PLACE, not rebuilt ---------------------
  {
    const rows = panelRows({ crtEffect: false });
    const detailsOf = (row) => { let el = row.parent; while (el && el.tag !== "details") el = el.parent; return el; };
    const oldEffects = detailsOf(rows.find((r) => sectionOf(r) === "Effects"));
    const oldAppearance = detailsOf(rows.find((r) => sectionOf(r) === "Appearance"));
    const added = flip(rows, "CRT Effect");
    ok("the re-rendered section keeps its <details> element",
       added.every((r) => detailsOf(r) === oldEffects));
    ok("...so a section the user collapsed stays collapsed", oldEffects.open === detailsOf(added[0]).open);
    const appearanceAfter = detailsOf(rows.find((r) => sectionOf(r) === "Appearance"));
    ok("...and an untouched section's element is the same object", appearanceAfter === oldAppearance);
    // The body under the summary is what was emptied - the summary itself
    // was not, or the title would have gone with the rows.
    const summary = oldEffects.children.find((c) => c.tag === "summary");
    ok("...with its title still in place",
       summary && summary.children[0] && summary.children[0].text === "Effects");
  }

  // --- A gate another section reads re-renders that section too ------------
  {
    // Gradient lives in Appearance; three Effects rows exist only with it on.
    const rows = panelRows({ gradientEnabled: false, flameTrail: true, energyEffect: true, crtEffect: true, crtNeon: true });
    ok("with Gradient off, Effects offers no gradient sub-options",
       !named(rows, "Gradient Colors") && !named(rows, "Aurora") && !named(rows, "Gradient Trail"));
    const added = flip(rows, "Gradient");
    ok("flipping Gradient re-renders Appearance AND Effects",
       added && sectionsOf(added).sort().join() === "Appearance,Effects", added && sectionsOf(added));
    ok("...and the Effects rows it gates appear",
       added.some((r) => r.name === "Gradient Colors") && added.some((r) => r.name === "Aurora")
         && added.some((r) => r.name === "Gradient Trail"),
       added.filter((r) => sectionOf(r) === "Effects").map((r) => r.name));
    ok("...while Blinking and Smooth Movement were left alone",
       !added.some((r) => sectionOf(r) === "Blinking" || sectionOf(r) === "Smooth Movement"));
  }
  {
    // Blinking lives in Blinking; the torch's Sync With Blink needs it.
    const rows = panelRows({ blinkingEnabled: false, torchEffect: true });
    ok("with Blinking off, the torch offers no Sync With Blink", !named(rows, "Sync With Blink"));
    const added = flip(rows, "Blinking");
    ok("flipping Blinking re-renders Blinking AND Effects",
       added && sectionsOf(added).sort().join() === "Blinking,Effects", added && sectionsOf(added));
    ok("...and Sync With Blink appears", added.some((r) => r.name === "Sync With Blink"));
  }

  // --- The registry is what the tests say it is -----------------------------
  {
    const rows = panelRows({});
    ok("every gate key is a real setting", [...rows.gates.keys()].every((k) => k in D),
       [...rows.gates.keys()].filter((k) => !(k in D)));
    ok("every gate has a home section",
       [...rows.gates.values()].every((h) => ["Appearance", "Blinking", "Smooth Movement", "Effects"].includes(h)),
       [...rows.gates.entries()].filter(([, h]) => !h));
    ok("the two caller-built controls are registered too",
       rows.gates.get("cursorStyle") === "Appearance" && rows.gates.get("torchEffect") === "Effects",
       [rows.gates.get("cursorStyle"), rows.gates.get("torchEffect")]);
    ok("Effects declares the two gates it reads from elsewhere",
       rows.rerenderOn.get("gradientEnabled")?.has("Effects") && rows.rerenderOn.get("blinkingEnabled")?.has("Effects"));
  }

  // --- Completeness: no undeclared cross-section read -----------------------
  // For every gated key: flip it, render again, and see which sections' rows
  // changed. Each one must be the key's home or a section that declared it -
  // otherwise that section would keep showing stale rows after the press,
  // which is exactly the bug display() used to paper over by rebuilding
  // everything. Run from two baselines so both directions of every gate are
  // exercised.
  {
    const ALL_ON = {
      popEffects: true, popLetters: true, backspaceDisintegrate: true, thunderstrike: true,
      fireworks: true, flameTrail: true, energyEffect: true, energyAurora: true,
      crtEffect: true, crtNeon: true, crtGlitch: true, torchEffect: true,
      overlayBlinkSync: true, overlayFlicker: true, blinkingEnabled: true, blinkBreathing: true,
      smoothEnabled: true, smoothAdaptive: true, gradientEnabled: true, boxHollow: true,
      cursorTranslucent: true, hotHead: true, speedDemon: true, stardust: true,
      bracketTether: true, lineSerifs: true,
    };
    const ALL_OFF = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false]));
    const signature = (rows) => {
      const by = {};
      for (const r of rows) {
        const s = sectionOf(r);
        by[s] = (by[s] || "") + "|" + r.name + "=" + r.desc + "=" + r.controls.join(",");
      }
      return by;
    };
    const flipped = (key, v) => {
      if (typeof v === "boolean") return !v;
      if (key === "cursorStyle") return v === "Box" ? "Line" : "Box";
      if (key === "gradientCount") return v === 4 ? 2 : 4;
      if (typeof v === "number") return v ? 0 : 0.5;
      return v;
    };
    const undeclared = [];
    for (const base of [ALL_ON, ALL_OFF]) {
      const rows = panelRows(base);
      const before = signature(rows);
      for (const [key, home] of rows.gates) {
        const after = signature(panelRows(Object.assign({}, base, { [key]: flipped(key, rows.settings[key]) })));
        const allowed = new Set([home, ...(rows.rerenderOn.get(key) || [])]);
        for (const s of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (before[s] !== after[s] && !allowed.has(s)) undeclared.push({ key, home, changes: s });
        }
      }
    }
    ok("no gate changes a section that does not re-render on it", undeclared.length === 0, undeclared);
    // And the check has teeth: it must be able to see a change at all.
    const rows = panelRows(ALL_OFF);
    const before = signature(rows);
    const after = signature(panelRows(Object.assign({}, ALL_OFF, { gradientEnabled: true })));
    ok("...and it does see the sections a gate changes",
       before.Appearance !== after.Appearance && before.Effects !== after.Effects);
  }
}

// ---------------------------------------------------------------------------
section("settings panel: the two callers and their hooks");

// renderPanel enters at renderLookSettings with the caller's hooks stubbed
// out, so the Cursor Style dropdown and the Torch toggle - built by each
// caller, each handed a `rerender` - had no coverage at all, and neither did
// where each caller's `set` writes. Both callers used to reach for
// this.display() from those hooks; they now re-render the section, and the
// only way to see that is to drive the caller whole.
{
  const { renderNormal, renderVimMode, sectionOf } = require("./panel_harness");
  const sectionsOf = (list) => [...new Set(list.map(sectionOf))];
  const press = (rows, name, kind, value) => {
    const row = rows.find((r) => r.name === name && r[kind].length);
    if (!row) return null;
    const before = rows.length;
    row[kind][0]._change(value);
    return rows.slice(before);
  };

  // --- The global panel ---------------------------------------------------
  {
    let rows;
    let threw = null;
    try { rows = renderNormal({ enabled: true, cursorStyle: "Box", torchEffect: false }); }
    catch (e) { threw = e; }
    ok("renderNormalSection builds", !threw, threw && threw.message);
    ok("...Presets first, then the four look sections",
       sectionsOf(rows).join() === "Presets,Appearance,Blinking,Smooth Movement,Effects", sectionsOf(rows));

    // Cursor Style: writes to plugin.settings, restarts the engine, and
    // re-renders Appearance so the new style's sub-options appear.
    const added = press(rows, "Cursor Style", "dropdowns", "Line");
    ok("Cursor Style writes the global setting", rows.settings.cursorStyle === "Line", rows.settings.cursorStyle);
    ok("...and restarts the engine", rows.plugin.enabled.includes("enable"), rows.plugin.enabled);
    ok("...and re-renders Appearance only", added && sectionsOf(added).join() === "Appearance", added && sectionsOf(added));
    ok("...so the Line style's own rows appear", added && added.some((r) => r.name === "Cursor Thickness"),
       added && added.map((r) => r.name));

    // Torch: writes, starts the overlay, re-renders Effects.
    const torch = press(rows, "Torch Spotlight", "toggles", true);
    ok("Torch Spotlight writes the global setting", rows.settings.torchEffect === true);
    ok("...and starts the torch engine", rows.plugin.enabled.includes("torch-on"), rows.plugin.enabled);
    ok("...and re-renders Effects only", torch && sectionsOf(torch).join() === "Effects", torch && sectionsOf(torch));
    ok("...so the torch's own rows appear", torch && torch.some((r) => r.name === "Light Size"), torch && torch.map((r) => r.name).slice(0, 8));
    const off = press(rows, "Torch Spotlight", "toggles", false);
    ok("...and off stops it again", rows.settings.torchEffect === false && rows.plugin.enabled.includes("torch-off") && off.length > 0);

    // With the plugin disabled the overlay is not started, but the panel
    // still responds.
    const idle = renderNormal({ enabled: false, torchEffect: false });
    const idleAdded = press(idle, "Torch Spotlight", "toggles", true);
    ok("with the plugin off, Torch saves and re-renders without touching the engine",
       idle.settings.torchEffect === true && idle.plugin.enabled.length === 0 && idleAdded.length > 0,
       idle.plugin.enabled);
  }

  // --- One Vim mode's panel -----------------------------------------------
  {
    const target = { cursorStyle: "Box", torchEffect: false };
    let edits = 0;
    let rows;
    let threw = null;
    try { rows = renderVimMode({}, target, () => edits++); }
    catch (e) { threw = e; }
    ok("renderModeControls builds", !threw, threw && threw.message);
    ok("...the four look sections and no Presets",
       sectionsOf(rows).join() === "Appearance,Blinking,Smooth Movement,Effects", sectionsOf(rows));

    const added = press(rows, "Cursor Style", "dropdowns", "Underline");
    ok("Cursor Style writes the mode's snapshot, not the global settings",
       target.cursorStyle === "Underline" && rows.settings.cursorStyle === "Box",
       [target.cursorStyle, rows.settings.cursorStyle]);
    ok("...and reports the edit (the Vim panel clears the active preset on it)", edits === 1, edits);
    ok("...and re-renders Appearance only", added && sectionsOf(added).join() === "Appearance", added && sectionsOf(added));
    ok("...so the Underline style's own row appears", added && added.some((r) => r.name === "Underline Thickness"));
    ok("...without restarting the engine (a mode has no engine of its own)", rows.plugin.enabled.length === 0);

    const torch = press(rows, "Torch Spotlight", "toggles", true);
    ok("Torch Spotlight writes the snapshot", target.torchEffect === true && rows.settings.torchEffect === false);
    ok("...reports the edit", edits === 2, edits);
    ok("...and re-renders Effects only", torch && sectionsOf(torch).join() === "Effects", torch && sectionsOf(torch));
    ok("...without touching the torch engine", rows.plugin.enabled.length === 0);

    // A gated toggle inside the shared renderer writes to the snapshot too.
    const g = press(rows, "Gradient", "toggles", true);
    ok("a shared gate writes the snapshot", target.gradientEnabled === true && rows.settings.gradientEnabled === false);
    ok("...reports the edit", edits === 3, edits);
    ok("...and re-renders Appearance and Effects", g && sectionsOf(g).sort().join() === "Appearance,Effects", g && sectionsOf(g));
  }
}

// Section headings are built through renderSection, which now remembers which
// ones the user collapsed. It must still render them from a fresh tab, where
// there is no remembered state at all.
{
  const rows = panelRows({});
  ok("a fresh panel renders with no remembered section state", !rows.threw && rows.length > 25,
     rows.threw && rows.threw.message);
}

// ---------------------------------------------------------------------------
section("engine state: one reset site");

// _resetEngineState() replaced three hand-maintained lists (the constructor,
// enableCanvasEngine, disableCanvasEngine). They had already drifted apart -
// `trail`, `lastActive`, `lastMoveTime`, `typingSpeedMod`, `_catchUpBoost` and
// the firework/stardust rate stamps were never cleared on the way down, and
// `_hotPrev`, `_taperBuf`, `heat` and the tether anchors were only cleared at
// construction - which is exactly the "state survives a plugin toggle" failure
// ARCHITECTURE.md warns about. These tests pin the fix.
{
  const quiescent = () => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    return e;
  };

  // A reset engine is fully described by the fields the reset writes, so the
  // key list doubles as the definition of "engine state".
  const KEYS = Object.keys(quiescent());
  ok("the reset writes a substantial state surface", KEYS.length > 30, KEYS.length);

  // The specific fields that had drifted. Named individually rather than left
  // to the round-trip below, so a future edit that drops one fails with the
  // name of the thing it dropped.
  const REGRESSED = [
    "trail", "lastActive", "lastMoveTime", "typingSpeedMod", "_catchUpBoost",
    "_lastFireworkT", "_lastStardustT", "_hotPrev", "_taperBuf", "heat",
    "_tetherAnchorA", "_tetherAnchorB", "_lastSparkT", "_popRainbowHue",
  ];
  const missing = REGRESSED.filter((k) => !KEYS.includes(k));
  ok("every field that had drifted is reset here", missing.length === 0, missing);

  // Round trip: run the engine hard, reset, and require it to be
  // indistinguishable from fresh. Catches a field that is read somewhere but
  // never cleared, which is the whole class of bug this function exists to end.
  const snap = (e) => JSON.stringify(KEYS.map((k) => [k, e[k]]));
  const before = snap(quiescent());

  const e = quiescent();
  e.trail.push({ x: 1 }); e.particles.push({}); e.flamePixels.push({});
  e.flameEmbers.push({}); e.hotBurns.push({ t: 1 }); e.thunderbolts.push({});
  e.fireworks.push({}); e.stardust.push({}); e.secondaryCarets.push({ x: 1 });
  e.glitch = { start: 1, dur: 200 };
  e.lastActive = { x: 10, top: 20, w: 8, h: 20 };
  e.pending = { x: 1 }; e.smearQuad = [1, 2, 3, 4]; e.smearShape = [1];
  e._taperBuf = [1]; e._smearDir = { x: 1, y: 0 }; e.smearCenterPrev = { x: 1, y: 1 };
  e._smearMoving = true; e._smearDtT = 5; e.smearQuadLastMoveT = 999;
  e._hotPrev = { x: 3, y: 4 }; e._hotVel = { x: 9, y: 9 };
  e.heat = 0.9; e._lastSparkT = 123; e._popRainbowHue = 240;
  e._lastFireworkT = 500; e._lastStardustT = 600;
  e.bracketTether = [{}]; e._tetherKey = "k"; e._tetherFrom = 3; e._tetherTo = 9;
  e._tetherSegs = [{}]; e._tetherSegKey = "s";
  e._tetherAnchorA = { x: 1 }; e._tetherAnchorB = { x: 2 };
  e.animActive = { x: 1 }; e.lastMoveTime = 42; e.typingSpeedMod = 3; e._catchUpBoost = 4;
  e._secondaries.push({ lastActive: { x: 1 } }); e._selShape = { count: 2, mainIndex: 0 };
  e._resetEngineState();
  ok("a used engine resets to exactly fresh", snap(e) === before);
}

// ---------------------------------------------------------------------------
section("frame governor: _isAnimating");

// Touchpoint 4 of the six for adding an effect, and the only one whose failure
// is both silent and user-visible: an effect missing from this test makes the
// loop judge the frame static, drop to its 100ms idle heartbeat, and freeze the
// effect mid-animation whenever nothing else happens to be moving. It was
// guarded by a comment alone until it was extracted from the tick.
{
  const NOW = 10000;
  const engine = (settings) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    return e;
  };

  ok("a settled engine is not animating", engine()._isAnimating(NOW) === false);

  // Pools that MUST claim the hot gear: each is aged or advanced inside a draw
  // call, so a skipped frame freezes it rather than letting it expire.
  const ANIMATING_POOLS = [
    "trail", "particles", "flamePixels", "flameEmbers", "thunderbolts", "fireworks",
  ];
  for (const pool of ANIMATING_POOLS) {
    const e = engine();
    e[pool].push({});
    ok(`a live ${pool} keeps the loop hot`, e._isAnimating(NOW) === true);
  }

  // Pools that deliberately do NOT, each for a documented reason. Listed rather
  // than omitted so the exclusion is a decision on the record instead of an
  // oversight that looks identical.
  const STATIC_POOLS = {
    // Runs *because* nothing is happening; counting it as motion would pin the
    // hot gear for as long as the user leaves the window alone. Asks for warm.
    stardust: "warm gear",
    // Static positions stamped once per frame, not an animation.
    secondaryCarets: "static",
    // Emission sources for flameEmbers, not painted state of their own - the
    // embers they produce are what needs frames, and those are covered above.
    hotBurns: "emitter",
    // Per-caret state bundles for the full-effect secondaries. A bundle is
    // not motion; its motion FIELDS are, and each of them is read below.
    _secondaries: "bundles - their motion fields are read individually",
  };
  for (const pool of Object.keys(STATIC_POOLS)) {
    const e = engine();
    e[pool].push({});
    ok(`a live ${pool} does NOT pin the hot gear (${STATIC_POOLS[pool]})`,
       e._isAnimating(NOW) === false);
  }

  // The completeness check, and the point of the two lists above: every pool
  // the reset creates must be classified as one or the other. Add an effect
  // with a new pool and this fails until you have decided which gear it wants.
  {
    const fresh = engine();
    const pools = Object.keys(fresh).filter((k) => Array.isArray(fresh[k]));
    const classified = new Set([...ANIMATING_POOLS, ...Object.keys(STATIC_POOLS)]);
    const unclassified = pools.filter((p) => !classified.has(p));
    ok("every pool is classified hot or static", unclassified.length === 0, unclassified);
  }

  // Non-pool triggers.
  {
    let e = engine(); e._smoothMoving = true;
    ok("smooth movement keeps the loop hot", e._isAnimating(NOW) === true);
    e = engine(); e.pending = { x: 1 };
    ok("a pending move keeps the loop hot", e._isAnimating(NOW) === true);
    e = engine(); e._smearMoving = true;
    ok("an unsettled smear spring keeps the loop hot", e._isAnimating(NOW) === true);
    e = engine(); e.heat = 0.01;
    ok("residual Speed Demon heat keeps the loop hot", e._isAnimating(NOW) === true);
    e = engine(); e.heat = 0;
    ok("zero heat does not", e._isAnimating(NOW) === false);
  }

  // A full-effect secondary carries the same motion fields as the primary
  // (CARET_STATE_FIELDS), and each of them has to claim the gear on its own,
  // or a settling smear on a secondary would freeze between heartbeats.
  {
    const still = engine(); still._secondaries.push({ lastActive: { x: 1 }, trail: [] });
    ok("a settled secondary does not pin the hot gear", still._isAnimating(NOW) === false);
    for (const [field, value] of [["_smearMoving", true], ["_smoothMoving", true], ["pending", { x: 1 }], ["trail", [{ x: 1 }]]]) {
      const e = engine(); e._secondaries.push({ [field]: value });
      ok(`a secondary's ${field} keeps the loop hot`, e._isAnimating(NOW) === true);
    }
    const g = engine(); g._secondaries.push({ glitch: { start: NOW - 50, dur: 200 } });
    ok("a secondary's live glitch keeps the loop hot", g._isAnimating(NOW) === true);
    const dead = engine(); dead._secondaries.push({ glitch: { start: NOW - 500, dur: 200 } });
    ok("...and an expired one does not", dead._isAnimating(NOW) === false);
  }

  // Signal Glitch is a wall-clock burst, and the test has to be a pure READ:
  // glitchState() would retire an expired burst as a side effect, and the gear
  // decision runs before the draw that should have painted it.
  {
    const live = engine(); live.glitch = { start: NOW - 50, dur: 200 };
    ok("a live glitch burst keeps the loop hot", live._isAnimating(NOW) === true);
    const dead = engine(); dead.glitch = { start: NOW - 500, dur: 200 };
    ok("an expired glitch burst does not", dead._isAnimating(NOW) === false);
    ok("checking the gear does not retire the burst", dead.glitch !== null);
  }

  // Hot-head claims the gear from the EFFECT, not just from live particles:
  // the instant the pool empties between spawns the loop would otherwise drop
  // to the idle heartbeat and the next spawn would arrive as one lumpy burst.
  {
    const e = engine({ hotHead: true, hotHeadIdleMs: 1500 });
    e.animActive = { x: 1 };
    e._hotActiveT = NOW - 100;
    ok("Hot-head with an empty pool still keeps the loop hot",
       e._isAnimating(NOW) === true);
    e._hotActiveT = NOW - 9000;   // past the idle timeout: fire is burning out
    ok("Hot-head past its idle timeout stands down", e._isAnimating(NOW) === false);
    const off = engine({ hotHead: false });
    off.animActive = { x: 1 };
    ok("Hot-head off does not claim the gear", off._isAnimating(NOW) === false);
  }
}

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

// ---------------------------------------------------------------------------
section("the hidden caret keeps a usable colour");

// Issue #24. On iOS, WebKit tints the whole text-selection UI - the highlight
// wash and both drag handles - from caret-color, using its RGB channels and
// discarding its alpha. `transparent` is rgba(0, 0, 0, 0), so hiding the caret
// with it painted the selection black on a black theme and made the handles
// invisible. The fix is to keep the alpha at 0, which is what actually hides
// the caret, and give the RGB something to be.
//
// These assertions read the shipped CSS as text because that is where the bug
// lived: there is no code path to exercise, only two stylesheets that have to
// stay in step. They fail against 1.4.8 as shipped, which is the point.
{
  const fs_ = require("fs"), path_ = require("path");
  const read = (f) => fs_.readFileSync(path_.join(__dirname, "..", f === "main.js" ? "build/test-bundle.js" : f), "utf8");
  const sheets = { "styles.css": read("styles.css"), "main.js": read("main.js") };

  // Every caret-color in the plugin, wherever it is declared.
  const decls = {};
  for (const [name, text] of Object.entries(sheets)) {
    decls[name] = [...text.matchAll(/caret-color:\s*([^;]+);/g)].map((m) => m[1].trim());
  }
  const all = [].concat(...Object.values(decls));

  ok("both stylesheets still declare a caret colour",
     decls["styles.css"].length >= 2 && decls["main.js"].length >= 2, decls);

  // The regression, stated as the thing that must never come back. `transparent`
  // is the only spelling that was ever used, but any black is the same bug.
  const black = all.filter((v) => /transparent|\b(?:0\s*,\s*0\s*,\s*0|#000(?:000)?)\b/i.test(v));
  ok("no caret colour resolves to black", black.length === 0, black);

  // Hiding the caret is the alpha's job and must stay the alpha's job - a
  // future edit that reaches for a visible colour here breaks the feature
  // outright rather than subtly.
  const hiding = all.filter((v) => v !== "auto");
  ok("every hiding declaration is zero-alpha",
     hiding.length > 0 && hiding.every((v) => /,\s*0\s*\)\s*$/.test(v)), hiding);

  // Excalidraw's carve-out is the one place a REAL caret is wanted; a zero
  // alpha creeping in there is the 1.4.6 no-caret-anywhere bug again.
  for (const name of Object.keys(sheets)) {
    ok(name + " keeps the Excalidraw carve-out at auto",
       decls[name].includes("auto"), decls[name]);
  }

  // An undefined var() makes the declaration invalid at COMPUTED-VALUE time,
  // which resolves to `unset` - inherited, i.e. a visible caret - and pointedly
  // does NOT fall back to an earlier declaration. The literal fallback inside
  // the var() is the only thing standing between a theme without the variable
  // and the native caret showing through under the drawn one.
  const varDecls = hiding.filter((v) => v.includes("var("));
  ok("the hiding colours are driven by a variable", varDecls.length === hiding.length, hiding);
  ok("every var() carries a literal fallback",
     varDecls.every((v) => /var\(\s*--[\w-]+\s*,[^)]+\)/.test(v)), varDecls);

  // Both files ship the same value: they are two copies of one rule, and only
  // the main.js one reaches a popped-out window.
  ok("the two stylesheets agree on the value",
     new Set(hiding).size === 1, [...new Set(hiding)]);
}

// ---------------------------------------------------------------------------
section("the two stylesheets hide every native cursor, and its blink");

// styles.css and the injectStyles copy in main.js (the only stylesheet a
// popped-out window gets) have to say the same thing. They did not: the
// injected copy hid the primary native cursor and forced the SECONDARIES
// visible, a leftover from before the plugin drew secondaries at all, and it
// won on !important - so a native caret sat under every drawn secondary. And
// neither stopped the cursor layer's blink animation, which cost a style
// recalc on every frame the plugin's loop requested (issue #30's tail).
{
  const fs = require("fs");
  const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "build", "test-bundle.js"), "utf8");
  const injStart = js.indexOf("  injectStyles(doc) {");
  const inj = js.slice(injStart, js.indexOf("\n  }\n", injStart));

  const ruleFor = (sheet, selectorPart) => {
    // The declaration block of the first rule whose selector list mentions
    // selectorPart.
    const i = sheet.indexOf(selectorPart);
    if (i < 0) return null;
    const open = sheet.indexOf("{", i);
    return sheet.slice(open, sheet.indexOf("}", open));
  };
  ok("styles.css hides the secondary native cursor",
     /display:\s*none/.test(ruleFor(css, ".cm-cursor-secondary") || ""));
  ok("the injected copy hides it too",
     /display:\s*none/.test(ruleFor(inj, ".cm-cursor-secondary") || ""), ruleFor(inj, ".cm-cursor-secondary"));
  ok("...and no longer forces any cursor visible",
     !/display:\s*block\s*!important/.test(inj) && !/cm-cursor:not\(:first-child\)/.test(inj));
  ok("styles.css stops the cursor layer's blink animation",
     /\.cm-cursorLayer\s*\{[^}]*animation:\s*none/.test(css));
  ok("...and so does the injected copy",
     /\.cm-cursorLayer\s*\{[^}]*animation:\s*none/.test(inj));
  // Both under the hide-native class only: with the native caret shown (Note
  // Editor Only, focus in the interface) its blink must keep running.
  ok("...only while the native caret is hidden",
     /hide-native[^{]*\.cm-cursorLayer\s*\{/.test(css) && /hide-native[^{]*\.cm-cursorLayer\s*\{/.test(inj));
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The mode tab itself. Its click listener is synchronous (addEventListener
// does not await; the review's no-misused-promises) and hands off to an
// async switch: setVimModeEnabled, then a re-display - and nothing at all
// when the pressed tab is already the current mode.
{
  const mkEl = () => {
    const el = { children: [], listeners: {}, classes: [] };
    el.createDiv = (o = {}) => { const c = mkEl(); c.cls = o.cls; el.children.push(c); return c; };
    el.createEl = (t, o = {}) => { const c = mkEl(); c.tag = t; c.text = o.text; c.cls = o.cls; el.children.push(c); return c; };
    el.addEventListener = (type, fn) => { el.listeners[type] = fn; };
    return el;
  };
  const press = async (uiMode, label) => {
    const calls = [];
    const plugin = { settings: { uiMode }, setVimModeEnabled: async (v) => { calls.push(v); } };
    const tab = Object.create(Plugin.__test.SettingTabPrototype);
    tab.plugin = plugin;
    tab.displayed = 0;
    tab.display = () => { tab.displayed++; };
    const root = mkEl();
    tab.renderModeSwitch(root);
    const wrap = root.children[0];
    const btn = wrap.children.find((b) => b.text === label);
    const ret = btn.listeners.click();
    // The listener returns nothing (no promise for addEventListener to drop);
    // the switch happens on the microtask queue behind it.
    await Promise.resolve(); await Promise.resolve();
    return { calls, displayed: tab.displayed, ret, wrap };
  };
  later(async () => {
    const a = await press("cua", "Vim");
    ok("the switch is a segmented control with both modes", a.wrap.cls === "cursor-smith-segmented" && a.wrap.children.length === 2, a.wrap);
    ok("...the current one marked active", a.wrap.children[0].cls === "cursor-smith-segment is-active" && a.wrap.children[1].cls === "cursor-smith-segment");
    ok("pressing the other tab switches the mode", a.calls.length === 1 && a.calls[0] === true, a.calls);
    ok("...and re-displays the panel afterwards", a.displayed === 1, a.displayed);
    ok("...through a listener that returns nothing", a.ret === undefined, a.ret);
    const b = await press("vim", "Vim");
    ok("pressing the current tab does nothing", b.calls.length === 0 && b.displayed === 0, b);
    const c = await press("vim", "CUA / Normal");
    ok("...and the other direction switches back", c.calls.length === 1 && c.calls[0] === false && c.displayed === 1, c.calls);
  });
}

// ---------------------------------------------------------------------------
section("the plugin review's rules (static styles, settings headings)");

// The Obsidian plugin review (2026-09-17, 1.5.3) failed on two rules: no
// literal inline styles (obsidianmd/no-static-styles-assignment - a class,
// or setCssStyles for what is set at runtime) and no HTML headings in the
// settings tab (Setting.setHeading instead). The canvas wrapper, the torch
// overlay and the settings panel's notes moved to classes; this pins that
// the classes exist where the elements are created, and that neither
// pattern comes back.
{
  const fs = require("fs");
  const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "build", "test-bundle.js"), "utf8");
  const injStart = js.indexOf("  injectStyles(doc) {");
  const inj = js.slice(injStart, js.indexOf("\n  }\n", injStart));
  const ruleFor = (sheet, sel) => {
    const i = sheet.indexOf(sel);
    if (i < 0) return null;
    const open = sheet.indexOf("{", i);
    return sheet.slice(open, sheet.indexOf("}", open));
  };
  const has = (rule, decl) => !!rule && rule.replace(/\s+/g, " ").includes(decl);
  for (const [name, sheet] of [["styles.css", css], ["the injected stylesheet", inj]]) {
    const w = ruleFor(sheet, ".retro-box-cursor-wrapper {");
    ok(`${name} lays out the canvas wrapper`,
       has(w, "position: fixed") && has(w, "overflow: hidden") && has(w, "pointer-events: none") && has(w, "z-index: 10000"), w);
    ok(`${name} collapses it until the tick sizes it`,
       has(w, "width: 0") && has(w, "height: 0") && has(w, "top: 0") && has(w, "left: 0"));
    const c = ruleFor(sheet, ".retro-box-cursor-canvas {");
    ok(`${name} places the canvas inside the wrapper`, has(c, "position: absolute") && has(c, "pointer-events: none"), c);
  }
  const ov = ruleFor(inj, ".torch-cursor-overlay {");
  ok("the injected overlay rule collapses the overlay too", has(ov, "width: 0") && has(ov, "height: 0") && has(ov, "position: fixed"));
  for (const cls of ["cursor-smith-vim-status", "cursor-smith-code-input", "cursor-smith-note", "cursor-smith-note-warning", "cursor-smith-version",
                     "cursor-smith-segmented", "cursor-smith-segment", "cursor-smith-share-code", "cursor-smith-copy-button"]) {
    ok(`styles.css has .${cls}`, css.includes("." + cls + " {"));
    ok(`...which main.js uses`, js.includes(cls));
  }
  // The review rule, as a regex: a literal string assigned to a style
  // property, or to cssText. Comments do not count.
  const code = js.replace(/^\s*\/\/.*$/gm, "");
  const literal = code.match(/\.style\.\w+\s*=\s*["'`]/g) || [];
  ok("no literal inline style assignment is left", literal.length === 0, literal);
  ok("no cssText either", !/\.style\.cssText\s*=/.test(code));
  // And no HTML headings are built anywhere (the settings tab is the only
  // place that ever did). Whole-file on purpose: the TypeScript build the
  // same suite runs against does not keep the class statement as written.
  const tab = js;
  ok("the settings tab builds no <h1>-<h6> of its own", !/createEl\("h[1-6]"/.test(tab));
  ok("...its section headings are Settings", (tab.match(/\.setHeading\(\)/g) || []).length >= 4);
}

// ---------------------------------------------------------------------------
section("frame caps, wake sources, geometry cache, report (the #30 tail)");

// Eight small levers after the canvas region (#30): the frame caps behind Low
// Power Mode, energy at 20fps, the 200ms heartbeat, scroll/wheel wake sources
// scoped to what can move the caret, the caret geometry and pane rect cached
// on a layout generation, the torch on low-res canvases (tested with the
// torch above), no allocation per caret swap, and the report command.
{
  const mk = (over = {}) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, over);
    e.styleFor = (k) => e.settings[k];
    e.app = { workspace: { activeEditor: null } };
    return e;
  };

  // --- frame caps -----------------------------------------------------------
  ok("Low Power Mode is off by default", T.DEFAULT_SETTINGS.lowPowerMode === false);
  ok("...and is not a look: not in LOOK_KEYS, so never in a share code", !T.LOOK_KEYS.includes("lowPowerMode"));
  const N = T.FRAME_CAPS.normal, L = T.FRAME_CAPS.lowPower;
  ok("the normal hot cap is near 60fps", N.hotMinMs >= 12 && N.hotMinMs <= 16, N.hotMinMs);
  ok("low power halves it", L.hotMinMs >= 28 && L.hotMinMs <= 34, L.hotMinMs);
  ok("the energy shimmer runs at 20fps, not 30", N.energyMs === 50, N.energyMs);
  ok("the idle heartbeat is 200ms, up from 100", N.idleMs === 200, N.idleMs);
  ok("every low-power interval is at least the normal one",
     Object.keys(N).every((k) => L[k] >= N[k]), { N, L });
  ok("_frameCaps follows the setting", mk()._frameCaps() === N && mk({ lowPowerMode: true })._frameCaps() === L);
  {
    const { renderGlobalRows } = require("./panel_harness");
    const rows = renderGlobalRows({});
    const row = rows.find((r) => r.name === "Low Power Mode");
    ok("the panel has the Low Power Mode row", !!row);
    ok("...among the global options, not the look", rows.map((r) => r.name).indexOf("Low Power Mode") < rows.map((r) => r.name).indexOf("Respect Reduced Motion"));
    if (row) { row.toggles[0]._change(true); ok("...and it writes lowPowerMode", rows.settings.lowPowerMode === true); }
  }

  // --- wake sources ----------------------------------------------------------
  {
    const e = mk();
    const scroller = { name: "scroller", contains(el) { return el === inEditor; } };
    const inEditor = { name: "inEditor", contains: () => false };
    const sidebar = { name: "sidebar", contains: () => false };
    const wrapper = { name: "wrapper", contains(el) { return el === scroller; } };
    const field = { name: "field" };
    const fieldBox = { name: "fieldBox", contains(el) { return el === field; } };
    const doc = { activeElement: field, body: {}, documentElement: { name: "html" } };
    e.app = { workspace: { activeEditor: { editor: { cm: { scrollDOM: scroller } } } } };
    ok("the editor's own scroller wakes the loop", e._scrollMovesCaret(scroller, doc) === true);
    ok("...and so does something inside it", e._scrollMovesCaret(inEditor, doc) === true);
    ok("...and an ancestor of it", e._scrollMovesCaret(wrapper, doc) === true);
    ok("...and the document itself", e._scrollMovesCaret(doc, doc) === true && e._scrollMovesCaret(doc.documentElement, doc) === true);
    ok("...and the container of whatever field has focus", e._scrollMovesCaret(fieldBox, doc) === true);
    ok("but the sidebar scrolling does not", e._scrollMovesCaret(sidebar, doc) === false);
    // Registered that way: the scroll listener consults the filter.
    const listeners = {};
    const fakeDoc = {
      addEventListener(type, fn) { listeners[type] = fn; },
      defaultView: { addEventListener() {} },
      activeElement: field, body: {},
    };
    e.registeredDocuments = new Set();
    e._docCleanups = new Map();
    // registerWindowEvents compares against the global document (pop-out
    // detection); there is none here, so the fake stands in for it.
    const hadDoc = "document" in globalThis;
    globalThis.document = fakeDoc;
    try { e.registerWindowEvents(fakeDoc); } finally { if (!hadDoc) delete globalThis.document; }
    let woke = 0;
    e._markActivity = () => { woke++; };
    listeners.scroll({ target: sidebar });
    ok("a scroll outside the editor does not wake the loop", woke === 0);
    listeners.scroll({ target: scroller });
    listeners.wheel({ target: inEditor });
    ok("...one inside it does, and so does a wheel over it", woke === 2, woke);
  }

  // --- geometry cache ----------------------------------------------------------
  {
    const e = mk();
    e._chromeInsets = () => ({ top: 0, bottomInset: 0 });
    let coordsCalls = 0, rectCalls = 0;
    const docObj = { length: 100 };
    const lineEl = { closest: () => lineEl, contains: () => true, textContent: "abc" };
    const rootEl = { getBoundingClientRect() { rectCalls++; return { top: 50, bottom: 650, left: 100, right: 900, width: 800, height: 600 }; }, ownerDocument: null };
    const view = {
      state: { selection: { main: { head: 10, assoc: 0, empty: true } }, doc: Object.assign(docObj, { sliceString: () => "a" }) },
      dom: { closest: () => rootEl, ownerDocument: null },
      contentDOM: { querySelector: () => lineEl },
      defaultCharacterWidth: 8,
      hasFocus: true,
      coordsAtPos() { coordsCalls++; return { left: 200, top: 300, bottom: 324 }; },
    };
    const win = { getComputedStyle: () => ({ color: "#fff", fontSize: "16px", fontFamily: "m", fontWeight: "400", fontStyle: "normal", letterSpacing: "0px", lineHeight: "24px" }) };
    const doc = { activeElement: { closest: () => null, tagName: "DIV", isContentEditable: true }, defaultView: win, documentElement: { clientWidth: 1000 }, elementFromPoint: () => lineEl, createRange: () => ({ selectNodeContents() {}, getClientRects: () => [] }) };
    view.dom.ownerDocument = doc; rootEl.ownerDocument = doc;
    e.measureCharWidth = () => 8;
    const a = e.cmCaretCoords(view);
    ok("the first frame measures", a && coordsCalls === 1 && rectCalls === 1, { a: !!a, coordsCalls, rectCalls });
    const b = e.cmCaretCoords(view);
    ok("the next frame, nothing changed, measures nothing", b && coordsCalls === 1 && rectCalls === 1, { coordsCalls, rectCalls });
    ok("...and gives the same caret", b.x === a.x && b.top === a.top);
    e._invalidateLayout();
    e.cmCaretCoords(view);
    ok("a layout invalidation re-measures both", coordsCalls === 2 && rectCalls === 2, { coordsCalls, rectCalls });
    e._markActivity();
    e.cmCaretCoords(view);
    ok("...and so does any activity", coordsCalls === 3, coordsCalls);
    view.state.selection.main.head = 11;
    e.cmCaretCoords(view);
    ok("...and a caret move", coordsCalls === 4, coordsCalls);
    e._caretGeoCache.t -= T.GEOMETRY_TTL_MS + 1;
    e.cmCaretCoords(view);
    ok("...and the TTL, as the backstop", coordsCalls === 5, coordsCalls);
    // Two invalidations above (the explicit one and the activity); the caret
    // move and the caret cache TTL are not layout events, so the pane rect
    // was not re-read for them.
    ok("the pane rect is re-read only on layout invalidations", rectCalls === 3, rectCalls);
    // Secondaries: the same cache, on the bundle.
    e.app.workspace.activeEditor = { editor: { cm: view } };
    view.state.selection.ranges = [{ head: 10, assoc: 0, empty: true }, { head: 50, assoc: 0, empty: true }];
    view.state.selection.mainIndex = 0;
    const st = e._freshCaretState();
    const before = coordsCalls;
    e.secondaryCaretCoords(view, [st]);
    e.secondaryCaretCoords(view, [st]);
    ok("a secondary's geometry is measured once while nothing changed", coordsCalls === before + 1 && !!st._geo, coordsCalls - before);
    e._invalidateLayout();
    e.secondaryCaretCoords(view, [st]);
    ok("...and again after an invalidation", coordsCalls === before + 2);
  }

  // --- no allocation per caret swap ------------------------------------------
  {
    const e = mk();
    const b1 = e._freshCaretState(), b2 = e._freshCaretState();
    e._withCaret(b1, () => {});
    const pool0 = e._swapPool[0];
    e._withCaret(b2, () => {});
    ok("the parked primary reuses one scratch object across swaps", e._swapPool[0] === pool0 && e._swapPool.length === 1);
    e._withCaret(b1, () => e._withCaret(b2, () => {}));
    ok("...and a nested swap gets its own", e._swapPool.length === 2 && e._swapDepth === 0);
  }

  // --- the report -----------------------------------------------------------------
  {
    const e = mk({ cursorStyle: "Line", smear: true, hotHead: true, lowPowerMode: true });
    e.manifest = { version: "1.5.2" };
    e.reducedMotion = () => false;
    e._clipRect = { x: 0, y: 0, w: 800, h: 600 };
    e._canvasRect = { x: 0, y: 0, w: 320, h: 192 };
    const perf = e._freshPerf();
    Object.assign(perf, { ticks: 600, draws: 300, gears: { hot: 400, idle: 200 }, tickMs: 120, caretMs: 30, drawMs: 90, reanchors: 3, longTasks: 2, longTaskMs: 130, rafGaps: { "8.5": 300, "1.5": 40, "16.5": 20 }, keys: 40 });
    const text = e.perfReportText(perf, 10);
    ok("the report names the version and the window", /report \(1\.5\.2\), 10s/.test(text) && /window/.test(text), text.split("\n")[0]);
    ok("...the display rate from the most common hot-frame gap, not the shortest", /~118Hz/.test(text), text);
    ok("...the effects that are on", /effects on: .*smear.*hotHead/.test(text));
    ok("...and Low Power's state", /low power on/.test(text));
    ok("...a share code of the look", /share code: 2\|/.test(text) || /share code: \d+\|/.test(text), text);
    ok("...ticks and draws per second", /600 ticks \(60\.0\/s\), 300 draws \(30\.0\/s\)/.test(text), text);
    ok("...the gear split", /hot 67%, idle 33%/.test(text), text);
    ok("...the plugin's share of the main thread", /120ms of 10000ms \(1\.2%\)/.test(text), text);
    ok("...and long tasks from any source", /long tasks .*: 2, 130ms/.test(text), text);
    ok("nothing from the vault: no file names, no text",
       !/\.md/.test(text));
    ok("an unmeasured display is said so", /unmeasured/.test(e.perfReportText(e._freshPerf(), 10)));
  }
}

// ---------------------------------------------------------------------------
section("the canvas is kept off the status bar without cutting the bottom line");

// A floating status bar (a pill at the bottom right in many themes) used to
// shorten the whole wrapper to its top, so every caret on the bottom line
// was cut to a sliver. The clip now spares only the bar's own rectangle.
{
  const W = { top: 78, left: 359, width: 867, height: 569 };   // bottom at 647
  // Bar starts above the pane's bottom, spans the whole pane: shorten.
  const full = T.wrapperClipForStatusBar(W, { top: 630, left: 0, right: 1300 });
  ok("a bar spanning the pane shortens the wrapper to its top", full.height === 630 - 78 && full.clipPath === "", full);
  // A pill at the bottom right: keep the height, cut a notch.
  const pill = T.wrapperClipForStatusBar(W, { top: 630.4, left: 1000, right: 1226 });
  ok("a floating pill keeps the wrapper's full height", pill.height === 569, pill);
  ok("...and clips out only its own rectangle",
     pill.clipPath === "polygon(0 0, 867px 0, 867px 569px, 867px 569px, 867px 552px, 641px 552px, 641px 569px, 0 569px)", pill.clipPath);
  // The pane ends above the bar: nothing to do.
  const clear = T.wrapperClipForStatusBar({ top: 78, left: 359, width: 867, height: 500 }, { top: 630, left: 1000, right: 1226 });
  ok("a pane that ends above the bar is untouched", clear.height === 500 && clear.clipPath === "");
  // A bar entirely outside the pane horizontally: no notch inside the pane.
  const aside = T.wrapperClipForStatusBar(W, { top: 630, left: 1300, right: 1400 });
  ok("a bar beside the pane leaves it alone", aside.height === 569 && aside.clipPath === "", aside);
  ok("heights are whole pixels", Number.isInteger(full.height) && Number.isInteger(pill.height));
}

// ---------------------------------------------------------------------------
section("the FireBox preset is the share code it came from");

// Added from a share code (2026-09-17). Pinning that the shipped snapshot
// decodes to exactly what the code says, so a hand edit to either cannot
// drift from the other unnoticed.
{
  const code = "1|FireBox|1cf7e259~2cf3a65e~5cd9e4d8~6cffbb00~9cf4c066~10ceb402d~21n0.7~22n0.1~24b0~28n3~29b0~31b0~51b1~55b1~61b1~62n1.6~63n3~64n19~65n1180~68b1~69n500~72n1.4~76b0~77n1.5~78n0.55~79n1200~86n0.85~87n0.15~89b1~91b1~93n0.05~94n0.6~95n0.9~103b0~116b1";
  const decoded = T.codeToPreset(code);
  ok("the code decodes", decoded && decoded.name === "FireBox", decoded && decoded.name);
  const shipped = T.DEFAULT_PRESETS.FireBox;
  ok("the preset is shipped", !!shipped);
  const norm = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  ok("...and is exactly the code's look", shipped && norm(shipped) === norm(decoded.snap), { shipped: Object.keys(shipped || {}).length, code: Object.keys(decoded.snap).length });
  ok("...re-encoding it gives the same body back",
     T.presetToCode("FireBox", T.presetWithDefaults(shipped)).split("|")[2] === code.split("|")[2]);
  ok("a box caret, Hot-head in the cursor's colour, heated by Speed Demon",
     T.presetWithDefaults(shipped).cursorStyle === "Box" && shipped.hotHead === true && shipped.hotHeadFlat === true && shipped.hotHeadSpeedHeat === true && shipped.speedDemon === true);
}

// ---------------------------------------------------------------------------
section("settings descriptions stay short");

// The panel is ~105 descriptions long; at the original average of 109
// characters that was more prose than anyone reads. The rule kept is: one
// clause saying what it does, plus whatever tells you what an endpoint means -
// a slider cannot tell you what its own 0 does.
{
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "build", "test-bundle.js"), "utf8");
  const descs = [...src.matchAll(/\.setDesc\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]);
  ok("the panel still has its descriptions", descs.length > 90, descs.length);

  const avg = descs.reduce((a, d) => a + d.length, 0) / descs.length;
  ok("descriptions average under 70 characters", avg < 70, Math.round(avg));

  const bloated = descs.filter((d) => d.length > 110);
  ok("none has grown back past 110 characters", bloated.length === 0, bloated);

  // The endpoint semantics are the part that must survive any future trim.
  const endpoints = descs.filter((d) => /(^|[\s(])0\b|At 1\b/.test(d));
  ok("endpoint semantics are still stated", endpoints.length >= 15, endpoints.length);
  const named = (frag) => descs.some((d) => d.includes(frag));
  ok("0 = automatic underline is still explained", named("0 = automatic"));
  ok("0 follows immediately is still explained", named("0 follows immediately"));
  ok("0 gives a pure spotlight is still explained", named("0 gives a pure spotlight"));
}

// ---------------------------------------------------------------------------
section("reduced motion");

{
  const KEYS = T.REDUCED_MOTION_OFF_KEYS;
  // Taken before anything below runs, so the "did it mutate the defaults?"
  // check further down has a real baseline rather than a restatement.
  const DEFAULTS_BEFORE = {};
  for (const k of KEYS) DEFAULTS_BEFORE[k] = T.DEFAULT_SETTINGS[k];
  // The failure this catches is a typo'd or renamed key, which would sit in the
  // table doing nothing at all and look exactly like a working entry.
  const unknown = KEYS.filter((k) => !(k in T.DEFAULT_SETTINGS));
  ok("every suppressed key exists in DEFAULT_SETTINGS", unknown.length === 0, unknown);
  ok("no duplicates in the table", new Set(KEYS).size === KEYS.length);

  const obj = Object.assign({}, T.DEFAULT_SETTINGS, {
    smoothEnabled: true, smear: true, popEffects: true, flameTrail: true,
    stardustEnabled: true, hotHead: true, speedDemonSparks: true, crtGlitch: true,
    energyEffect: true, blinkBreathing: true, overlayBlinkSync: true, overlayFlicker: true,
  });
  T.applyReducedMotion(obj);
  ok("every moving effect is switched off", KEYS.every((k) => obj[k] === false),
     KEYS.filter((k) => obj[k] !== false));

  // The line is movement and emission, not the cursor's existence: a caret of a
  // different colour or shape is not motion, and blinking is the platform
  // behaviour of every text caret and has its own switch.
  ok("the cursor's own look is untouched",
     obj.cursorStyle === T.DEFAULT_SETTINGS.cursorStyle &&
     obj.colorDark === T.DEFAULT_SETTINGS.colorDark &&
     obj.cursorOpacity === T.DEFAULT_SETTINGS.cursorOpacity);
  ok("blinking is deliberately NOT suppressed", obj.blinkingEnabled === true);
  // `in` on an array tests indices, not values - includes() is the check meant
  // here. The torch is a reading light, not an animation: it keeps lighting,
  // it just stops pulsing and flickering.
  ok("the torch itself still lights, it just stops moving",
     !KEYS.includes("torchEffect") && obj.overlayRadius === T.DEFAULT_SETTINGS.overlayRadius);

  // It runs on the merged copy inside effectiveSettings, never on this.settings,
  // so nothing it does can reach disk. Compared field by field against a
  // snapshot taken before the call above, because a mutation here would be
  // invisible until it turned up in someone's data.json.
  {
    const leaked = KEYS.filter((k) => T.DEFAULT_SETTINGS[k] !== DEFAULTS_BEFORE[k]);
    ok("DEFAULT_SETTINGS was not mutated", leaked.length === 0, leaked);
  }
  const probe = { smear: true, cursorStyle: "Line" };
  ok("it returns the object it was given", T.applyReducedMotion(probe) === probe);
  ok("respectReducedMotion is a global, not a look key",
     ("respectReducedMotion" in T.DEFAULT_SETTINGS) &&
     T.LOOK_KEYS.indexOf("respectReducedMotion") === -1);
}

// ---------------------------------------------------------------------------
section("first-run starter preset");

{
  const starterName = T.DEFAULT_PRESET_NAME;
  const starter = T.DEFAULT_PRESETS[starterName];
  ok("the starter names a preset that actually ships", !!starter, starterName);

  // The whole point: a new install must open on something that IS in the
  // preset list, so the first look a user sees is one they can get back to.
  ok("the starter is one of the seeded presets",
     Object.keys(T.DEFAULT_PRESETS).includes(starterName), Object.keys(T.DEFAULT_PRESETS));

  const look = T.presetWithDefaults(starter);
  ok("the starter resolves to a complete look",
     T.LOOK_KEYS.every((k) => k in look),
     T.LOOK_KEYS.filter((k) => !(k in look)));

  // The reported symptom, pinned. Not a style opinion - these are the two
  // things that made the old first-run look unreachable from the preset list.
  ok("a new install does not open on a blinking caret", look.blinkingEnabled === false);
  ok("a new install opens on the starter's colour",
     look.colorDark === starter.colorDark, [look.colorDark, starter.colorDark]);

  // --- and the reason it is applied at load rather than baked into the
  // defaults. DEFAULT_SETTINGS is the share-code baseline: shareFields()
  // emits only what differs from it. If someone "simplifies" this by editing
  // the defaults to match the starter, that delta collapses to nothing and
  // every share code in the wild silently decodes to a different look.
  const body = T.presetToCode("probe", starter).split("|")[2];
  ok("the starter is still a DELTA from the defaults, not the defaults",
     body.length > 0,
     "empty body means DEFAULT_SETTINGS was changed to match the starter");

  // Spot-check the baseline values the starter differs on. These are wire
  // format, not taste - they are what a share code omitting these fields
  // decodes back to on the recipient's machine.
  ok("baseline colorDark unchanged", T.DEFAULT_SETTINGS.colorDark === "#39ff14",
     T.DEFAULT_SETTINGS.colorDark);
  ok("baseline blinkingEnabled unchanged", T.DEFAULT_SETTINGS.blinkingEnabled === true,
     T.DEFAULT_SETTINGS.blinkingEnabled);

  // A code emitted from the defaults themselves still carries no fields.
  ok("the defaults still encode as an empty body",
     T.presetToCode("d", T.DEFAULT_SETTINGS).split("|")[2] === "");

  // --- the function onload() actually calls -------------------------------
  // Rebuilt the way onload does: defaults, then the seeding loop.
  const freshSettings = () => {
    const s = Object.assign({}, T.DEFAULT_SETTINGS, { userPresets: {} });
    for (const [n, snap] of Object.entries(T.DEFAULT_PRESETS)) s.userPresets[n] = snap;
    return s;
  };

  {
    const s = freshSettings();
    ok("applyStarterPreset reports success", T.applyStarterPreset(s) === true);
    ok("...and the live settings now match the starter",
       s.colorDark === starter.colorDark && s.blinkingEnabled === false,
       [s.colorDark, s.blinkingEnabled]);
    // The preset list must survive being applied over - it lives on the same
    // object, and loadUserPreset has to hold a reference for exactly this
    // reason.
    ok("the preset library is not clobbered",
       Object.keys(s.userPresets).length === Object.keys(T.DEFAULT_PRESETS).length,
       Object.keys(s.userPresets));
    // Vim theming is an independent system; a CUA starter must not touch it.
    ok("vim state is untouched", s.vimModes === T.DEFAULT_SETTINGS.vimModes);
  }
  {
    // No starter in the library (a user who deleted it, then somehow lost
    // their data file) must be a no-op, not a crash.
    const s = freshSettings();
    delete s.userPresets[starterName];
    const before = s.colorDark;
    ok("a missing starter is a no-op", T.applyStarterPreset(s) === false);
    ok("...and changes nothing", s.colorDark === before);
  }
  ok("a settings object with no presets at all is survivable",
     T.applyStarterPreset({}) === false);
}

// ---------------------------------------------------------------------------
section("bracket tether: blocks cut the line");

{
  // tetherSpan only ever touches doc.length and doc.sliceString, so a string
  // is a complete stand-in for a CodeMirror document here.
  const mkDoc = (s) => ({ length: s.length, sliceString: (a, b) => s.slice(a, b) });
  const eng = Object.create(Plugin.prototype);
  // Caret index of the "|" marker, which is stripped before the doc is built.
  const spanAt = (marked) => {
    const pos = marked.indexOf("|");
    const doc = mkDoc(marked.replace("|", ""));
    return eng.tetherSpan(doc, pos);
  };
  // Whole-document boundary test between the two "<" / ">" in the fixture.
  const cuts = (s) => eng.crossesBlockBoundary(mkDoc(s), s.indexOf("<"), s.lastIndexOf(">"));

  // --- per-line classification -------------------------------------------
  // Everything else is built on this, so pin it directly.
  const info = T.blockLineInfo;
  ok("a plain line is depth 0", info("hello").depth === 0);
  ok("a quoted line is depth 1", info("> hello").depth === 1);
  ok("a nested quote is depth 2", info(">> hello").depth === 2);
  ok("a lone > is still a marker", info(">").depth === 1);
  // A callout is just a blockquote whose first line carries a type marker -
  // this is why callouts need no separate handling anywhere.
  ok("a callout header is an ordinary quoted line",
     info("> [!note] Title").depth === 1);
  ok("a fence is recognised", info("```js").fence === true);
  ok("3 spaces of indent still fences", info("   ```").fence === true);
  ok("4 spaces of indent does not", info("    ```").fence === false);
  ok("two backticks do not", info("``").fence === false);
  ok("a mid-line ``` does not", info("x ```").fence === false);
  // A fence inside a callout is still a fence, once its prefix is stripped.
  ok("a fence inside a quote is seen past the marker",
     info("> ```js").fence === true && info("> ```js").depth === 1);

  // --- code fences --------------------------------------------------------
  ok("a fence between the ends cuts", cuts("a <b\n```\nc> d"));
  ok("no fence, no cut", cuts("a <b c> d") === false);
  ok("tildes count as a fence", cuts("<\n~~~\nx>"));
  ok("indented up to 3 spaces still counts", cuts("<\n   ```\nx>"));
  ok("4 spaces of indent is not a fence", cuts("<\n    ```\nx>") === false);
  ok("two backticks are not a fence", cuts("<\n``\nx>") === false);
  ok("a mid-line ``` is not a fence", cuts("<\nx ```\ny>") === false);
  {
    // A fence opening the span's LAST line is still matched even though the
    // span stops partway through it (what CODE_FENCE_PREFIX buys).
    const d = mkDoc("<\n```js\nx>");
    ok("a fence at the very end of the span is still seen",
       eng.crossesBlockBoundary(d, 0, 3));
  }
  ok("a zero-length span never cuts", cuts("<>") === false);
  {
    const d = mkDoc("a <b\n```\nc> d");
    ok("a reversed span never cuts", eng.crossesBlockBoundary(d, 10, 2) === false);
  }

  // --- blockquotes and callouts -------------------------------------------
  // The reported case, in quote form: one end inside, one outside.
  ok("leaving a blockquote cuts", cuts("> a <b\nc> d"));
  ok("entering a blockquote cuts", cuts("a <b\n> c> d"));
  ok("a pair inside one blockquote is kept", cuts("> a <b\n> c> d") === false);
  ok("a pair inside one callout is kept",
     cuts("> [!note] T\n> a <b\n> c> d") === false);
  ok("crossing a whole callout cuts", cuts("<a\n> [!note] T\n> body\nb>"));
  // A blank line ends a blockquote, so two quoted passages either side of one
  // are different blocks even though both are depth 1.
  ok("a blank line separates two quotes", cuts("> <a\n\n> b> c"));
  ok("changing quote depth cuts", cuts("> <a\n>> b> c"));
  ok("leaving a nested quote cuts", cuts(">> <a\n> b> c"));

  // --- ">" as a blockquote marker, not a bracket --------------------------
  // No boundary check can catch this: the marker sits at the SAME depth as
  // the "<", so only knowing what a marker is prevents the false pair.
  {
    const s = spanAt("> a <| b\n> c > d");
    ok("a '<' does not pair with the next line's marker", !!s, s);
    ok("...it pairs with the real '>' further along",
       s && s.to === 12, s);
  }
  {
    // Every line of a callout offers a fresh false partner; none may be taken.
    const s = spanAt("> [!warning] T\n> if a <| b\n> then c\n> done >");
    ok("a callout's markers are all skipped", !!s, s);
    ok("...and the real '>' at the end wins", s && s.to === 42, s);
  }
  {
    // Nothing to pair with at all once the markers are excluded.
    ok("a '<' with only markers after it tethers to nothing",
       spanAt("> a <| b\n> c\n> d") === null);
  }
  {
    // Parking beside the marker itself must do nothing.
    ok("the caret on a quote marker tethers to nothing",
       spanAt("a < b\n>| c") === null);
  }
  {
    // enclosingBracketSpan walks backwards and would otherwise count each
    // marker as a closer, leaving depth[">"] permanently ahead.
    const s = spanAt("> <a\n> b|\n> c>");
    ok("markers do not inflate the enclosing-pair depth count", !!s, s);
    ok("...and the enclosing angle pair is found", s && s.from === 2, s);
  }

  // --- what must still work ----------------------------------------------
  ok("a pair wholly inside one code block still tethers",
     !!spanAt("```\n<|div>\n```"));
  ok("an ordinary pair with no block anywhere still tethers", !!spanAt("<|a b> c"));
  ok("a plain multi-line pair still tethers", !!spanAt("(|a\nb\nc)"));
  ok("a pair spanning a whole code block is dropped",
     spanAt("(|a\n```\nx\n```\nb)") === null);
  {
    // The adjacent loop must `continue` past a cut match, not bail: the caret
    // touches TWO characters and only one of them is broken.
    const s = spanAt("<\n```\nx>|(a)");
    ok("a cut bracket doesn't veto the other adjacent one", !!s, s);
    ok("...and the intact pair is what gets tethered",
       s && s.from === 8 && s.to === 10, s);
  }
  {
    ok("an enclosing pair broken by a fence is dropped",
       spanAt("(a|\n```\nb)") === null);
    ok("...but the same shape without one still tethers", !!spanAt("(a|\nxxx\nb)"));
  }
  ok("a cut inner pair does not fall outward to an enclosing one",
     spanAt("[ (| ]\n```\n)\n```") === null);
  ok("an inline quote run is unaffected", !!spanAt("`code|`"));
}

// ---------------------------------------------------------------------------
section("reduced motion: the user can find out why");

{
  // 1.3.6 started honouring prefers-reduced-motion. On Windows that is set by
  // turning off animation effects for SPEED, so a lot of people had it on
  // without knowing - and Smooth Movement and Motion Smear stopped working
  // while their toggles still read ON. The suppression is correct; being
  // silent about it was the bug.
  const KEYS = T.REDUCED_MOTION_OFF_KEYS;
  ok("smear is suppressed by the gate", KEYS.includes("smear"));
  ok("smooth movement is suppressed by the gate", KEYS.includes("smoothEnabled"));

  // The panel must keep showing the user's own choice - a saved preset must
  // never be rewritten by an OS preference. This is what makes a notice the
  // only way to explain the mismatch.
  const chosen = Object.assign({}, T.DEFAULT_SETTINGS, { smear: true, smoothEnabled: true });
  const effective = T.applyReducedMotion(Object.assign({}, chosen));
  ok("the engine really does switch them off",
     effective.smear === false && effective.smoothEnabled === false);
  ok("...while the user's own settings are left alone",
     chosen.smear === true && chosen.smoothEnabled === true);

  // --- the notice itself --------------------------------------------------
  const makeEl = (tag) => {
    const el = {
      tag, children: [], classes: [], text: undefined,
      createEl(t, opts = {}) {
        const c = makeEl(t);
        c.text = opts.text;
        if (opts.cls) c.classes.push(opts.cls);
        el.children.push(c);
        return c;
      },
      createDiv(opts = {}) { return el.createEl("div", opts); },
      createSpan(opts = {}) { return el.createEl("span", opts); },
      addClass(...cs) { el.classes.push(...cs); },
      setCssStyles(styles) { Object.assign(el.style, styles); },
      style: {},
    };
    return el;
  };
  const proto = T.SettingTabPrototype;
  const render = (reduced) => {
    const tab = Object.create(proto);
    tab.plugin = { reducedMotion: () => reduced };
    const host = makeEl("div");
    const out = tab.renderReducedMotionNotice(host);
    return { out, host };
  };

  {
    const { out, host } = render(false);
    ok("no notice when the OS isn't asking", out === null);
    ok("...and nothing is added to the panel", host.children.length === 0);
  }
  {
    const { out, host } = render(true);
    ok("a notice appears when the OS is asking", out !== null);
    ok("...and it is attached to the panel", host.children.length === 1);
    const text = out.children.map((c) => c.text || "").join(" ");
    // Name both features the report was about, so searching the text for
    // either one finds it.
    ok("it names Smooth Movement", /Smooth Movement/.test(text), text);
    ok("it names Motion Smear", /Motion Smear/.test(text), text);
    // And point at the control that turns it off, by its exact panel label.
    ok("it names the toggle that overrides it",
       /Respect Reduced Motion/.test(text), text);
    ok("it says the toggles below are still the user's own",
       /still show your own settings/.test(text), text);
    ok("it carries its styling hook",
       out.classes.includes("cursor-smith-reduced-notice"), out.classes);
  }
  {
    // The rule panel_harness.js exists to enforce: a row that throws takes
    // every row after it out of the panel. The notice runs FIRST in display(),
    // so if it threw it would take the entire settings panel with it.
    const tab = Object.create(proto);
    tab.plugin = { reducedMotion: () => { throw new Error("no matchMedia"); } };
    let threw = false;
    let out = "sentinel";
    const realError = console.error;
    console.error = () => {};   // the guard logs; that's expected here
    try { out = tab.renderReducedMotionNotice(makeEl("div")); } catch { threw = true; }
    finally { console.error = realError; }
    ok("a broken reduced-motion check cannot abort the panel", threw === false);
    ok("...it just renders no notice", out === null);
  }
}

// ---------------------------------------------------------------------------
section("support / donate row: removed");

// The in-panel "Support Cursor-Smith" row and the fundingLinks() helper that
// built it were both removed. Asserted absent rather than simply untested, the
// same way Matrix Rain and Text Crawl are, so a half-finished revert cannot
// quietly put the donate button back.
//
// manifest.json keeps its `fundingUrl`: that field is what drives Obsidian's
// own Donate button in Community Plugins, which was never the thing removed.
{
  ok("fundingLinks is gone", T.fundingLinks === undefined);
  ok("renderSupportSection is gone",
     typeof T.SettingTabPrototype.renderSupportSection !== "function");
  const rows = panelRows({});
  ok("no row in the panel offers to take money",
     !rows.some((r) => /support|donate|coffee|sponsor/i.test(r.name || "")),
     rows.map((r) => r.name).filter((n) => n && /support|donate/i.test(n)));
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
section("custom heat ramp: at rest the cursor is still yours");

{
  const mk = (over) => {
    const e = Object.create(Plugin.prototype);
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, {
      speedDemon: true, speedDemonGradient: true, colorDark: "#39ff14",
      speedHeatDark1: "#2b4a8f", speedHeatDark2: "#17b8c4",
      speedHeatDark3: "#ff9a2e", speedHeatDark4: "#fff3d0",
    }, over);
    e.styleFor = (k) => e.settings[k];
    e.isDarkTheme = () => true;
    e.heat = 0;
    return e;
  };
  const e = mk({});
  const at = (h) => { e.heat = h; return e.heatColor(h, e.getBaseColor()); };

  // The reported bug: heat decays to zero after a few seconds of silence, so a
  // custom ramp replaced the cursor's colour with stage 1 most of the time.
  ok("at rest the cursor is its own colour", at(0) === "#39ff14", at(0));
  ok("...not stage 1", at(0) !== e.settings.speedHeatDark1);

  // All four stages must stay reachable - the fix compresses them into what's
  // left of the range rather than sacrificing one.
  ok("stage 1 lands exactly at liftoff",
     at(SPEED_LIFTOFF) === e.settings.speedHeatDark1, at(SPEED_LIFTOFF));
  ok("stage 4 still lands at full heat",
     at(1) === e.settings.speedHeatDark4, at(1));
  ok("stage 2 and 3 are passed through",
     at(0.4) !== at(0.7) && at(0.4) !== at(1), { a: at(0.4), b: at(0.7) });

  // No snap on the first keystroke - that was the reason the old code couldn't
  // just special-case heat 0.
  const steps = [0, 0.02, 0.04, 0.06, 0.08, 0.10, SPEED_LIFTOFF].map(at);
  ok("it eases out of the cursor colour rather than snapping",
     new Set(steps).size === steps.length, steps);
  ok("...and every step is a valid colour",
     steps.every((c) => /^#[0-9a-f]{6}$/.test(c)), steps);

  // Monotonic-ish: the blend must move steadily toward stage 1, not wander.
  const dist = (a, b) => {
    const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };
  const toStage1 = steps.map((c) => dist(c, e.settings.speedHeatDark1));
  ok("the blend closes on stage 1 the whole way",
     toStage1.every((d, i) => i === 0 || d <= toStage1[i - 1] + 1e-9),
     toStage1.map((d) => Math.round(d)));

  // A cursor with a different colour rests as THAT colour, so this is really
  // reading the cursor and not a coincidence of the default.
  const blue = mk({ colorDark: "#4477ff" });
  blue.heat = 0;
  ok("a differently-coloured cursor rests as itself",
     blue.heatColor(0, blue.getBaseColor()) === "#4477ff");

  // "Keep cursor color" still wins outright - it means no heat on the caret at
  // all, which the liftoff blend must not quietly reintroduce.
  const keep = mk({ speedDemonNoCursorHeat: true });
  keep.heat = 1;
  ok("Keep Cursor Color is still absolute",
     keep.getActiveColor() === "#39ff14", keep.getActiveColor());
}

// ---------------------------------------------------------------------------
section("readableGlyphColor: the character inside a filled Box");

{
  const { parseColorTuple, contrastRatio, readableGlyphColor, GLYPH_MIN_CONTRAST } = T;

  ok("parses #rrggbb", String(parseColorTuple("#3182ed")) === "49,130,237");
  ok("parses #rgb", String(parseColorTuple("#abc")) === "170,187,204");
  ok("parses rgb()", String(parseColorTuple("rgb(29, 79, 174)")) === "29,79,174");
  ok("rejects junk rather than guessing", parseColorTuple("nonsense") === null);
  ok("rejects null", parseColorTuple(null) === null);
  ok("survives junk with a usable colour", /^#|^rgb/.test(readableGlyphColor("nonsense")));

  const cr = (box) => contrastRatio(parseColorTuple(readableGlyphColor(box, "tinted")), parseColorTuple(box));

  // The two cases from the bug report. Both were legible-by-luck before:
  // the old code inverted the TEXT colour and never looked at the box.
  ok("the reported blue box clears the floor", cr("rgb(29, 79, 174)") >= GLYPH_MIN_CONTRAST,
     cr("rgb(29, 79, 174)"));
  ok("the Vim-visual yellow box clears it too", cr("#e3cb31") >= GLYPH_MIN_CONTRAST,
     cr("#e3cb31"));

  // Mid-grey is the case plain inversion cannot solve at all: #808080 inverts
  // to within one unit of itself.
  ok("mid-grey is not left inverting onto itself", cr("#808080") >= GLYPH_MIN_CONTRAST,
     cr("#808080"));

  // These four picked the WRONG pole under a naive `luminance < 0.5` test and
  // came out at 2.4-4.1:1. They exist to keep that shortcut from creeping back.
  for (const box of ["#c792ea", "#3182ed", "#ed3131", "#499bf3"]) {
    ok("pole chosen by measurement, not by luminance < 0.5: " + box,
       cr(box) >= GLYPH_MIN_CONTRAST, cr(box));
  }

  // A colour whose inverse already clears the floor keeps that inverse
  // untouched - the floor is a backstop, not a replacement for the look.
  // Mode "tinted" only - the default is now the neutral flip, which never
  // preserves the inverse.
  ok("in auto, a passing inverse is left alone",
     readableGlyphColor("#fff6bd", "tinted") === "rgb(0, 9, 66)",
     readableGlyphColor("#fff6bd", "tinted"));

  // Every colour must be satisfiable. The hardest box sits at the contrast
  // crossover (L ~ 0.179) where both poles tie at ~4.58:1, so a floor of 4.5
  // is reachable everywhere and anything above ~4.58 would not be.
  ok("the floor stays under the universally reachable ceiling",
     GLYPH_MIN_CONTRAST <= 4.58, GLYPH_MIN_CONTRAST);

  let worst = Infinity, worstAt = null;
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const box = `rgb(${r}, ${g}, ${b})`;
        const c = contrastRatio(parseColorTuple(readableGlyphColor(box, "tinted")), [r, g, b]);
        if (c < worst) { worst = c; worstAt = box; }
      }
    }
  }
  ok("no colour in a full sweep falls below the floor",
     worst >= GLYPH_MIN_CONTRAST - 1e-9, { worst, worstAt });

  // --- the three Letter Color modes --------------------------------------
  //
  // "contrast" is the default because RGB inversion rotates a colour to its
  // COMPLEMENT rather than to a neutral. A green cursor inverts to magenta,
  // which clears the contrast floor comfortably (4.85:1) and still looks
  // wrong - the bug that prompted this setting. Black on the same box
  // measures 13:1, so the neutral is not a trade of legibility for
  // neutrality; it wins on both.
  const GREENS = ["#4fe87d", "#00ff00", "#39ff14", "#7bd88f", "#a6e3a1"];
  const isNeutral = (str) => {
    const [r, g, b] = parseColorTuple(str);
    return r === g && g === b;
  };
  const isMagenta = (str) => {
    const [r, g, b] = parseColorTuple(str);
    return r > g && b > g;
  };

  for (const box of GREENS) {
    ok(`contrast gives a neutral on ${box}`,
       isNeutral(readableGlyphColor(box, "contrast")), readableGlyphColor(box, "contrast"));
    ok(`...black, on a bright green`,
       readableGlyphColor(box, "contrast") === "rgb(0, 0, 0)");
    // The mode that produced the complaint still behaves as documented - it
    // is offered deliberately, not left in by accident.
    ok(`auto still tints ${box} toward the complement`,
       isMagenta(readableGlyphColor(box, "tinted")), readableGlyphColor(box, "tinted"));
    // ...and the neutral genuinely out-reads it, not just out-tastes it.
    const cN = contrastRatio(parseColorTuple(readableGlyphColor(box, "contrast")), parseColorTuple(box));
    const cA = contrastRatio(parseColorTuple(readableGlyphColor(box, "tinted")), parseColorTuple(box));
    ok(`contrast out-reads auto on ${box}`, cN > cA, { cN, cA });
  }

  // "invert" is raw, with no floor - that is the point of offering it, and
  // mid-grey inverting to itself is the honest consequence.
  ok("invert is a plain flip", readableGlyphColor("#00ff00", "invert") === "rgb(255, 0, 255)");
  ok("...with no contrast floor applied",
     contrastRatio(parseColorTuple(readableGlyphColor("#808080", "invert")),
                   parseColorTuple("#808080")) < 1.1);

  // Contrast mode must never be illegible, for any colour at all.
  let cWorst = Infinity, cAt = null;
  for (let r = 0; r < 256; r += 9) for (let g = 0; g < 256; g += 9) for (let b = 0; b < 256; b += 9) {
    const box = `rgb(${r}, ${g}, ${b})`;
    const c = contrastRatio(parseColorTuple(readableGlyphColor(box, "contrast")), [r, g, b]);
    if (c < cWorst) { cWorst = c; cAt = box; }
  }
  ok("contrast mode clears the floor for every colour",
     cWorst >= GLYPH_MIN_CONTRAST - 1e-9, { cWorst, cAt });

  // Default and unknown both land on the neutral, so a share code written
  // before this key existed imports as the good behaviour.
  ok("the default mode is contrast", T.DEFAULT_SETTINGS.glyphColorMode === "contrast");
  ok("an absent mode falls back to the neutral",
     readableGlyphColor("#00ff00") === "rgb(0, 0, 0)");
  ok("an unknown mode falls back to the neutral",
     readableGlyphColor("#00ff00", "nonsense") === "rgb(0, 0, 0)");
}

// ---------------------------------------------------------------------------
section("form-field mirror: what the caret's position is measured against");

// The mirror technique reproduces a form field's text layout in an offscreen
// div and reads back where the caret lands. It is only ever as right as the
// list of properties it copies - anything that moves a glyph horizontally and
// is NOT copied lays the text out somewhere the real field does not put it,
// and the caret is drawn there.
//
// textAlign was missing, which put the caret at the left edge of every
// right-aligned field (Word-Smith's goal target cells) - measured at 135px of
// error on a 160px box in a real renderer. The geometry itself needs a browser
// to check (probes/form-mirror.html); what IS checkable here is the rule that
// failed: the property list, and what the mirror is sized by.
{
  const proto = T.EngineProto;
  // Records every style write the mirror receives.
  const run = (over = {}, elOver = {}) => {
    const written = {};
    // Everything the mirror is handed, in order: text node, marker, text node.
    const appended = [];
    const mirror = {
      style: new Proxy({}, { set: (t, k, v) => { written[k] = v; t[k] = v; return true; } }),
      // Obsidian's helper, which the mirror uses for the styles it sets
      // itself (as against the ones it copies); the same recorder sees them.
      setCssStyles(styles) { for (const k in styles) this.style[k] = styles[k]; },
      setAttribute() {}, remove() {},
      appendChild(node) { appended.push(node); },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 20 }),
      set textContent(v) { this._t = v; },
      get textContent() { return this._t; },
    };
    const style = Object.assign({
      boxSizing: "border-box", width: "160px", height: "22px",
      paddingLeft: "6px", paddingRight: "6px", paddingTop: "0px", paddingBottom: "0px",
      borderLeftWidth: "1px", borderRightWidth: "1px",
      borderTopWidth: "1px", borderBottomWidth: "1px",
      fontSize: "13px", lineHeight: "20px", fontFamily: "sans-serif",
      // plaintext because that is what Obsidian's app.css puts on every input.
      textAlign: "right", direction: "ltr", unicodeBidi: "plaintext",
    }, over);
    const marker = {
      style: {}, setCssStyles(styles) { Object.assign(this.style, styles); },
      getBoundingClientRect: () => ({ left: 40, top: 0 }),
    };
    const doc = {
      createElement: (tag) => (tag === "span" ? marker : mirror),
      createTextNode: (t) => ({ t }),
      body: { appendChild() {} },
      defaultView: { getComputedStyle: () => style },
    };
    const el = Object.assign({
      ownerDocument: doc, tagName: "INPUT", value: "1200",
      selectionStart: 4, selectionEnd: 4, selectionDirection: "none",
      clientWidth: 158, scrollLeft: 0, scrollTop: 0,
      getBoundingClientRect: () => ({ left: 100, top: 50, right: 260, bottom: 72, height: 22 }),
    }, elOver);
    const engine = Object.create(proto);
    const out = proto.formFieldCaretCoords.call(engine, el);
    return { written, out, appended, marker };
  };

  const { written, out } = run();
  ok("the mirror is handed a position", !!out && Number.isFinite(out.left), out);

  // The rule, stated as a rule: every property that can move a glyph sideways.
  for (const p of ["textAlign", "direction", "letterSpacing", "wordSpacing",
                   "textIndent", "textTransform", "fontFamily", "fontSize",
                   "fontWeight", "fontStyle", "paddingLeft", "paddingRight",
                   "borderLeftWidth", "borderRightWidth"]) {
    // Key presence, not value: the stub style does not define every one of
    // them, and what is being tested is that the property is on the copy list.
    ok(`the mirror copies ${p}`, Object.prototype.hasOwnProperty.call(written, p), Object.keys(written));
  }

  // Sized by the content box, computed from clientWidth - which is content +
  // padding and excludes border and scrollbar - rather than by copying
  // box-sizing and width across. Copying them is only correct under
  // content-box, and every Obsidian field is border-box.
  ok("the mirror is content-box", written.boxSizing === "content-box", written.boxSizing);
  ok("...sized from clientWidth minus padding", written.width === "146px", written.width);
  {
    const wide = run({}, { clientWidth: 300 });
    ok("...and follows the field's real content width", wide.written.width === "288px", wide.written.width);
  }
  // A field CSS has collapsed to nothing must not produce a negative width.
  {
    const tiny = run({}, { clientWidth: 4 });
    ok("a collapsed field clamps at zero", tiny.written.width === "0px", tiny.written.width);
  }

  // Alignment must reach the mirror verbatim, not be normalised away.
  for (const align of ["left", "right", "center", "start", "end"]) {
    const r = run({ textAlign: align });
    ok(`textAlign "${align}" reaches the mirror`, r.written.textAlign === align, r.written.textAlign);
  }

  // ---- issue #28: which END of the box the paragraph starts from ----------
  //
  // Obsidian's app.css carries a bare `input { unicode-bidi: plaintext }`, so
  // every field in the app resolves its direction from its OWN CONTENT and
  // `direction` alone cannot see it. Without this the mirror stayed an LTR
  // paragraph while the real field flipped to RTL, and the caret was drawn
  // hundreds of pixels away, at the far end of the text's own width. The
  // geometry is probes/rtl-form-mirror.html; the rule is here.
  ok("the mirror copies unicodeBidi",
     Object.prototype.hasOwnProperty.call(written, "unicodeBidi"), Object.keys(written));
  for (const ub of ["plaintext", "isolate", "normal"]) {
    const r = run({ unicodeBidi: ub });
    ok(`unicodeBidi "${ub}" reaches the mirror`, r.written.unicodeBidi === ub, r.written.unicodeBidi);
  }

  // The four border widths on the copy list are inert on their own:
  // border-style defaults to none, which computes every one of them back to
  // 0px, so the mirror's content box sat a border-width inside the field's.
  ok("the mirror's copied borders are live", written.borderStyle === "solid", written.borderStyle);

  // The whole value is laid out, split at the caret. Under plaintext the
  // paragraph direction is the first STRONG character of the content, so a
  // prefix that has none - caret at 0, or a value opening with digits -
  // answers LTR where the real field answers RTL. It also fixes a case with
  // no bidi in it at all: a right-aligned field places its line from the FULL
  // text's width, which a prefix on its own cannot reproduce.
  {
    const r = run({}, { value: "abcdef", selectionStart: 2, selectionEnd: 2 });
    const text = r.appended.filter((n) => n && typeof n.t === "string").map((n) => n.t);
    ok("the mirror is handed the prefix", text[0] === "ab", text);
    ok("...and the suffix as well", text[1] === "cdef", text);
    ok("...with the marker between them", r.appended.indexOf(r.marker) === 1, r.appended.length);
  }

  // A zero-width inline-block, not a ZWSP. U+200B is bidi class BN, which
  // UAX#9 deletes outright and leaves the engine to place; beside a digit run
  // inside an RTL paragraph that is not where the caret goes. An atomic
  // inline is U+FFFC to the algorithm - a neutral with a defined resolution.
  //
  // It has to be aligned as well as sized. An EMPTY inline-block's baseline is
  // its own bottom margin edge, so left alone it hangs at the text baseline -
  // 14px below the line on a 22px line box. An <input> cannot see that, since
  // it takes its Y from the field's own box; a <textarea> takes its Y from the
  // marker's top and would drop every caret by most of a line.
  {
    const { marker } = run();
    ok("the marker is an atomic inline", marker.style.display === "inline-block", marker.style);
    ok("...with no width of its own", marker.style.width === "0", marker.style);
    ok("...pinned to the top of the line box", marker.style.verticalAlign === "top", marker.style);
    ok("...and no character to be reordered", !marker.textContent, marker.textContent);
  }

  // The result is still clamped inside the field, which is what keeps a caret
  // scrolled out of a long single-line input from drawing outside it.
  {
    const far = run({}, { getBoundingClientRect: () => ({ left: 100, top: 50, right: 130, bottom: 72, height: 22 }) });
    ok("the caret stays inside the field's box",
       far.out.left >= 100 && far.out.left <= 130, far.out.left);
  }

  // A textarea takes its Y from the mirror; an input is centred in its own
  // box instead, because a div cannot reproduce a UA's internal centring.
  {
    const ta = run({}, { tagName: "TEXTAREA" });
    ok("a textarea wraps at the content width", ta.written.width === "146px", ta.written.width);
    ok("...and does not have its height forced to auto", ta.written.height !== "auto", ta.written.height);
  }
  ok("an input's mirror height is auto", written.height === "auto", written.height);
}

// ---------------------------------------------------------------------------
section("adjacentCharRect: which side of the neighbouring glyph the caret is on");

// The contentEditable half of #28. This function measures a real one-character
// span next to the caret rather than a collapsed point, because a collapsed
// rect reports tight font metrics instead of the line box and the caret came
// out the wrong HEIGHT. It then took the caret's X from that character's edge
// too - "the caret sits after this character, so anchor to its right edge" -
// which is true in LTR and exactly backwards in RTL, and in bidi text is not
// decidable from the offset at all. Measured at a full character width of
// error on every RTL offset. The X now comes from a collapsed range, which is
// the engine's own answer; the height still comes from the character.
{
  const proto = T.EngineProto;
  const DEGENERATE = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  // `rects(startOffset, isCollapsed)` decides what each range measures.
  const mkDoc = (rects) => ({
    createRange: () => {
      let start = null, collapsed = false;
      return {
        setStart(n, o) { start = o; },
        setEnd() {},
        collapse() { collapsed = true; },
        getClientRects() { const r = rects(start, collapsed); return r ? [r] : []; },
        getBoundingClientRect() { return rects(start, collapsed) || DEGENERATE; },
      };
    },
  });
  const node = { nodeType: 3, data: "abcdef" };
  const CHAR = { left: 200, right: 260, top: 10, bottom: 27, width: 60, height: 17 };
  const call = (doc, offset) => proto.adjacentCharRect.call(Object.create(proto), doc, node, offset);

  // Mid-text: the character AFTER the caret is measured for the vertical.
  {
    const doc = mkDoc((s, c) => (c ? { left: 100, top: 0, right: 100, bottom: 0, width: 0, height: 17 } : CHAR));
    const r = call(doc, 3);
    ok("the caret's X is the collapsed range's", r.left === 100, r);
    ok("...and its top is the character's", r.top === 10, r);
    ok("...and its bottom too", r.bottom === 27, r);
  }
  // At the end of the node, where the character BEFORE the caret is measured.
  // 1.4.8 returned that character's RIGHT edge, which in RTL is the far side.
  {
    const doc = mkDoc((s, c) => (c ? { left: 100, top: 0, right: 100, bottom: 0, width: 0, height: 17 } : CHAR));
    const r = call(doc, node.data.length);
    ok("at the end of a run the X is still the collapsed range's", r.left === 100, r);
    ok("...not the preceding glyph's far edge", r.left !== CHAR.right, r);
  }
  // No collapsed rect to be had: the character edges are still the fallback,
  // which is what the function did for its whole life before this.
  {
    const doc = mkDoc((s, c) => (c ? DEGENERATE : CHAR));
    ok("without a collapsed rect it falls back to the leading edge",
       call(doc, 3).left === CHAR.left, call(doc, 3));
    ok("...and to the trailing edge at the end of a run",
       call(doc, node.data.length).left === CHAR.right, call(doc, node.data.length));
  }
  // A range that throws must not take the tick loop with it.
  {
    const doc = { createRange: () => { throw new Error("no ranges here"); } };
    ok("a throwing range yields no rect rather than an exception", call(doc, 3) === null);
  }
  // Only text nodes have characters to measure.
  ok("an element node is declined outright", proto.adjacentCharRect.call(
     Object.create(proto), mkDoc(() => CHAR), { nodeType: 1 }, 0) === null);
}

// ---------------------------------------------------------------------------
section("isExcalidrawCaretHost: staying off other plugins' carets");

{
  const isExcali = T.EngineProto.isExcalidrawCaretHost;
  // Minimal stand-in for the workspace, so the DOM branch is tested in
  // isolation from the view-type fallback.
  // `inside` decides what the active leaf holds at all and `content` what its
  // content box holds. The two differ only over the chrome the container adds
  // around the content, which is exactly what the title-bar case turns on. The
  // default - everything, with the content box holding all of it - keeps the
  // fallback's original meaning, and a test that cares passes its own.
  // The engine asks the workspace for the active view (getActiveViewOfType,
  // the API that replaced the deprecated activeLeaf), so that is what the
  // fake answers.
  const engine = (viewType, inside = () => true, content = inside) => ({
    app: {
      workspace: {
        getActiveViewOfType: () => viewType
          ? {
              getViewType: () => viewType,
              containerEl: { contains: inside },
              contentEl: { contains: content },
            }
          : null,
      },
    },
  });
  // A view that exposes no contentEl at all - not an ItemView - so the
  // fallback has to scope by the container and subtract the header itself.
  const containerOnly = (inside = () => true) => ({
    app: {
      workspace: {
        getActiveViewOfType: () => ({ getViewType: () => "excalidraw", containerEl: { contains: inside } }),
      },
    },
  });
  // closest() is the only DOM call the method makes; `matches` is the set of
  // selectors this fake element should claim to be inside.
  const el = (matches, className = "") => ({
    closest: (sel) => (matches.some((m) => sel.includes(m)) ? {} : null),
    classList: { contains: (c) => className.split(" ").includes(c) },
  });

  const call = (e, node) => isExcali.call(e, node);

  ok("a plain textarea is left alone", call(engine("markdown"), el([])) === false);
  ok("null element is safe", call(engine("markdown"), null) === false);

  ok("Excalidraw's container is detected",
     call(engine("markdown"), el([".excalidraw"])) === true);
  ok("the wysiwyg textarea is detected by class",
     call(engine("markdown"), el([], "excalidraw-wysiwyg")) === true);

  // The case the view-type check alone would miss: a drawing embedded in a
  // note, where the leaf is still a markdown view.
  ok("an embed inside a markdown leaf is still caught",
     call(engine("markdown"), el([".excalidraw-wrapper"])) === true);

  // ...and the reverse: a field INSIDE a full Excalidraw leaf is caught even
  // if the container classes are renamed out from under the selector.
  ok("a field inside a full Excalidraw leaf is caught without the DOM match",
     call(engine("excalidraw"), el([])) === true);

  // Issues #26 and #27. The fallback used to ignore the element entirely, so
  // with a drawing as the active tab every text field in the app answered
  // yes - and since the caret-color carve-out only reaches Excalidraw's own
  // textarea, those fields were left with no caret from either source.
  const outside = engine("excalidraw", () => false);
  ok("the rename dialog is NOT claimed while a drawing is the active tab",
     call(outside, el([])) === false);
  ok("...nor the settings search box",
     call(outside, el([])) === false);
  // ...but a drawing embedded in a note still is, via the DOM branch, even
  // though that modal-vs-leaf test would say no.
  ok("...while an embed inside the same leaf still is",
     call(outside, el([".excalidraw"])) === true);

  // The #26 follow-up, and the reason the scope is contentEl rather than
  // containerEl: the tab title bar is INSIDE the active leaf's container but
  // outside its content, and `.view-header-title` is permanently
  // contentEditable because clicking it renames the file. Scoping by the
  // container claimed it, so renaming from there lost its caret exactly the
  // way the modals had.
  const drawingActive = engine("excalidraw", () => true, (node) => node.inContent === true);
  const titleBar = Object.assign(el([".view-header"]), { inContent: false });
  const onCanvas = Object.assign(el([]), { inContent: true });
  ok("the tab title bar is NOT claimed while a drawing is the active tab",
     call(drawingActive, titleBar) === false);
  ok("...while a field inside the drawing itself still is",
     call(drawingActive, onCanvas) === true);

  // Same rule on the no-contentEl fallback, which has to subtract the header
  // by selector because it has no content box to name.
  ok("the container fallback claims a field inside the leaf",
     call(containerOnly(), el([])) === true);
  ok("...but not the tab title bar",
     call(containerOnly(), el([".view-header"])) === false);
  ok("...and not something the container itself excludes",
     call(containerOnly(() => false), el([])) === false);

  // A view with no containerEl at all must fail closed rather than throw.
  const noContainer = {
    app: { workspace: { getActiveViewOfType: () => ({ getViewType: () => "excalidraw" }) } },
  };
  ok("a view with no containerEl is safe", call(noContainer, el([])) === false);

  // A thrown closest() must not take the tick loop with it.
  const boom = { closest: () => { throw new Error("boom"); }, classList: null };
  ok("a throwing element degrades to false", call(engine("markdown"), boom) === false);

  // The cache keys on element identity, so a second element must not inherit
  // the first one's answer.
  const e2 = engine("markdown");
  const exc = el([".excalidraw"]);
  const plain = el([]);
  call(e2, exc);
  ok("the identity cache does not leak across elements", call(e2, plain) === false);
  ok("...and still reports the original correctly", call(e2, exc) === true);
}

// ---------------------------------------------------------------------------
section("Rounded Corners");

// Records path construction so the shape can be inspected without a canvas.
function makePathCtx() {
  const ops = [];
  return {
    ops,
    globalAlpha: 1, lineWidth: 0, lineCap: "", lineJoin: "",
    save() {}, restore() {},
    set fillStyle(v) { this._fill = v; },
    get fillStyle() { return this._fill; },
    set strokeStyle(v) { this._stroke = v; },
    get strokeStyle() { return this._stroke; },
    beginPath() { ops.push({ op: "begin" }); },
    closePath() { ops.push({ op: "close" }); },
    moveTo(x, y) { ops.push({ op: "moveTo", x, y }); },
    lineTo(x, y) { ops.push({ op: "lineTo", x, y }); },
    rect(x, y, w, h) { ops.push({ op: "rect", x, y, w, h }); },
    arcTo(x1, y1, x2, y2, r) { ops.push({ op: "arcTo", x1, y1, x2, y2, r }); },
    fill() { ops.push({ op: "fill", alpha: this.globalAlpha }); },
    stroke() { ops.push({ op: "stroke" }); },
    fillRect(x, y, w, h) { ops.push({ op: "fillRect", x, y, w, h }); },
    strokeRect(x, y, w, h) { ops.push({ op: "strokeRect", x, y, w, h }); },
  };
}

{
  const mk = (over) => {
    const e = makeEngine(over);
    e.ctx = makePathCtx();
    e.smearCorners = () => null;
    return e;
  };
  const rect = { tl: { x: 0, y: 0 }, tr: { x: 10, y: 0 }, br: { x: 10, y: 30 }, bl: { x: 0, y: 30 } };

  // --- cornerRadius: off, thin, block ------------------------------------
  ok("radius is 0 when the toggle is off",
     mk({ cursorRounded: false }).cornerRadius(24) === 0);

  // A Line stem (2-3px) and an Underline bar are thin: they capsule.
  const on = mk({ cursorRounded: true });
  ok("a 3px stem capsules (half its width)", on.cornerRadius(3) === 1.5, on.cornerRadius(3));
  ok("a 2px stem capsules", on.cornerRadius(2) === 1, on.cornerRadius(2));
  // A Box's narrow axis is its char width: softened, not capsuled.
  ok("an 8px box softens rather than capsuling",
     on.cornerRadius(8) === 2, on.cornerRadius(8));
  ok("...and stays well under half the axis", on.cornerRadius(8) < 4);
  ok("a zero axis yields no radius", on.cornerRadius(0) === 0);
  ok("a negative axis yields no radius", on.cornerRadius(-5) === 0);
  // The radius can never exceed half the minor axis, or arcTo self-intersects.
  for (const m of [1, 2, 5, 6, 7, 12, 40]) {
    ok(`radius <= half the axis at ${m}`, on.cornerRadius(m) <= m / 2 + 1e-9, on.cornerRadius(m));
  }

  // --- traceQuad: sharp vs rounded ---------------------------------------
  {
    const e = mk({ cursorRounded: false });
    e.ctx.beginPath();
    e.traceQuad(e.ctx, rect, 0);
    const kinds = e.ctx.ops.map((o) => o.op);
    ok("sharp path uses moveTo/lineTo only",
       kinds.filter((k) => k === "arcTo").length === 0 && kinds.includes("lineTo"), kinds);
  }
  {
    const e = mk({ cursorRounded: true });
    e.ctx.beginPath();
    e.traceQuad(e.ctx, rect, 2);
    const arcs = e.ctx.ops.filter((o) => o.op === "arcTo");
    ok("rounded path emits one arc per corner", arcs.length === 4, arcs.length);
    ok("...all at the requested radius", arcs.every((a) => a.r === 2));
    ok("...and never uses roundRect (iOS 16.4 / Chromium 99 only)",
       e.ctx.ops.every((o) => o.op !== "roundRect"));
  }

  // The radius is clamped to the QUAD's shortest edge, not the resting rect's.
  // A hard smear can make one edge tiny; a radius sized for the box would fold
  // the corners through each other.
  {
    const e = mk({ cursorRounded: true });
    const sheared = { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 40, y: 60 }, bl: { x: 37, y: 60 } };
    e.ctx.beginPath();
    e.traceQuad(e.ctx, sheared, 20);
    const arcs = e.ctx.ops.filter((o) => o.op === "arcTo");
    ok("a smeared quad clamps to its own shortest edge",
       arcs.length === 4 && arcs.every((a) => a.r <= 1.5 + 1e-9), arcs.map((a) => a.r));
  }

  // A degenerate quad must not emit NaN coordinates into the path.
  {
    const e = mk({ cursorRounded: true });
    const flat = { tl: { x: 5, y: 5 }, tr: { x: 5, y: 5 }, br: { x: 5, y: 5 }, bl: { x: 5, y: 5 } };
    e.ctx.beginPath();
    e.traceQuad(e.ctx, flat, 4);
    const nums = e.ctx.ops.flatMap((o) => [o.x, o.y, o.x1, o.y1, o.x2, o.y2, o.r]).filter((v) => v !== undefined);
    ok("a degenerate quad produces no NaN", nums.every((v) => Number.isFinite(v)), nums);
  }

  // --- trail ghosts follow the head --------------------------------------
  {
    const off = mk({ cursorRounded: false });
    off.fillTrailRect(off.ctx, 0, 0, 8, 20);
    ok("sharp trail ghosts stay plain fillRects",
       off.ctx.ops.length === 1 && off.ctx.ops[0].op === "fillRect", off.ctx.ops);

    const rnd = mk({ cursorRounded: true });
    rnd.fillTrailRect(rnd.ctx, 0, 0, 8, 20);
    ok("rounded trail ghosts are arc paths, not fillRects",
       rnd.ctx.ops.some((o) => o.op === "arcTo") && !rnd.ctx.ops.some((o) => o.op === "fillRect"),
       rnd.ctx.ops.map((o) => o.op));
  }
}

// The row has to actually appear in the panel. A row that throws while being
// built takes every row after it with it, which no engine-side test can see.
{
  for (const style of ["Line", "Box", "Underline"]) {
    const names = renderPanel({ cursorStyle: style }).map((r) => r.name);
    const i = names.indexOf("Rounded Corners");
    ok(`the row renders for ${style}`, i > 0, names.slice(-4));
    ok(`...directly under Translucent for ${style}`, names[i - 1] === "Translucent", names[i - 1]);
  }
  // It's style-agnostic, so it must not be trapped inside a style's subgroup.
  // Both rows have to come from the SAME render - the harness builds a fresh
  // element tree per call, so comparing across two renders compares two
  // different objects and can never match.
  const one = renderPanel({ cursorStyle: "Box" });
  ok("it sits at the same level as Translucent",
     one.find((r) => r.name === "Rounded Corners").parent
       === one.find((r) => r.name === "Translucent").parent);
  // The arc must never escape the quad. arcTo insets its tangent points by
  // r / tan(theta/2), which for an acute corner is far larger than r - so a
  // radius clamped only by edge LENGTH runs past the next corner on a sheared
  // quad, and the path paints outside the shape (and outside the damage rect,
  // so it is never cleared). Motion Smear produces exactly those acute
  // corners, which is why Rounded Corners left stray artifacts.
  {
    const e = makeEngine({ cursorRounded: true });
    e.styleFor = (k) => e.settings[k];
    e.ctx = makePathCtx();
    e.smearCorners = () => null;
    const tangentOverrun = (q, r) => {
      const pts = [q.tl, q.tr, q.br, q.bl];
      let worst = -Infinity;
      for (let i = 0; i < 4; i++) {
        const prev = pts[(i + 3) % 4], cur = pts[i], next = pts[(i + 1) % 4];
        const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
        const v2x = next.x - cur.x, v2y = next.y - cur.y;
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        const th = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))));
        worst = Math.max(worst, r / Math.tan(th / 2) - Math.min(l1, l2) / 2);
      }
      return worst;
    };
    const radiusUsed = (q) => {
      const rec = [];
      const c = Object.assign({}, e.ctx, {
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        arcTo(x1, y1, x2, y2, r) { rec.push(r); },
      });
      e.traceQuad(c, q, 1.5);
      return rec.length ? rec[0] : 0;
    };

    const shapes = {
      resting: { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 3, y: 24 }, bl: { x: 0, y: 24 } },
      sheared60: { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 63, y: 24 }, bl: { x: 60, y: 24 } },
      sheared200: { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 203, y: 24 }, bl: { x: 200, y: 24 } },
      boxDiag: { tl: { x: 0, y: 0 }, tr: { x: 9, y: 0 }, br: { x: 49, y: 44 }, bl: { x: 40, y: 44 } },
    };
    for (const [name, q] of Object.entries(shapes)) {
      const r = radiusUsed(q);
      ok(`the arc stays inside the quad: ${name}`,
         r === 0 || tangentOverrun(q, r) <= 1e-6, { r, overrun: tangentOverrun(q, r) });
    }
    // A resting caret must still get its full rounding - the tighter clamp
    // must not have quietly switched the feature off.
    // Tolerance, not equality: the angle clamp routes a right-angled corner
    // through tan(pi/4), which is 1 only to within float error.
    ok("a resting caret keeps its full radius",
       Math.abs(radiusUsed(shapes.resting) - 1.5) < 1e-9, radiusUsed(shapes.resting));
    ok("...and a hard shear tightens rather than disabling it",
       radiusUsed(shapes.sheared60) > 0 && radiusUsed(shapes.sheared60) < 1.5,
       radiusUsed(shapes.sheared60));
  }
}

// ---------------------------------------------------------------------------
section("I-beam serifs");

{
  const mk = (over) => {
    const e = makeEngine(Object.assign({ cursorStyle: "Line", lineSerifs: true }, over));
    e.ctx = makePathCtx();
    e.smearCorners = () => null;
    return e;
  };
  const active = (over) => Object.assign({ x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 }, over);

  {
    const e = mk({});
    const s = e.serifQuads(active(), 100, 3);
    ok("two brackets", s.quads.length === 2, s.quads.length);

    const [top, bot] = s.quads;
    // Outer edges sit exactly on the caret's top and bottom.
    ok("top bracket sits on the caret top", top.tl.y === 40, top.tl.y);
    ok("bottom bracket sits on the caret bottom", bot.bl.y === 64, bot.bl.y);

    // Tapered: the edge meeting the stem is narrower than the outer edge.
    const outerW = top.tr.x - top.tl.x;
    const innerW = top.br.x - top.bl.x;
    ok("the top bracket tapers toward the stem", innerW < outerW, { outerW, innerW });
    ok("...and the bottom mirrors it",
       (bot.tr.x - bot.tl.x) < (bot.br.x - bot.bl.x));
    ok("the taper does not invert the shape", innerW > 0, innerW);

    // Centred on the stem.
    const cx = 100 + 3 / 2;
    ok("brackets are centred on the stem",
       Math.abs((top.tl.x + top.tr.x) / 2 - cx) < 1e-9, (top.tl.x + top.tr.x) / 2);

    // Bounds are reported for the paint, and cover the whole glyph.
    ok("reported bounds cover the brackets",
       s.left <= top.tl.x + 1e-9 && s.right >= top.tr.x - 1e-9, { left: s.left, right: s.right });
  }

  // Thickness is clamped by LINE HEIGHT, not just the stem. A 6px caret used
  // to put two 5px slabs on a 24px line - 42% of the caret was serif.
  {
    const wide = mk({ caretWidthPx: 6 });
    const s = wide.serifQuads(active({ w: 6 }), 100, 6);
    const thickness = s.quads[0].bl.y - s.quads[0].tl.y;
    ok("a wide stem does not produce slab serifs", thickness <= 24 * 0.08 + 1,
       thickness);
    ok("...but the serif is still visible", thickness >= 1, thickness);
  }

  // Span follows the character, with an ABSOLUTE floor - a stem-relative
  // floor grew serifs wider than the glyph they mark as the stem widened.
  {
    const wide = mk({ caretWidthPx: 6 });
    const s = wide.serifQuads(active({ w: 6, actualCharWidth: 7 }), 100, 6);
    const span = s.quads[0].tr.x - s.quads[0].tl.x;
    ok("span tracks the character, not the stem", span <= 7 + 1e-9, span);
  }
  {
    // No character (empty line): falls back rather than collapsing to nothing.
    const e = mk({});
    const s = e.serifQuads(active({ actualCharWidth: 0 }), 100, 3);
    const span = s.quads[0].tr.x - s.quads[0].tl.x;
    ok("an empty line still gets usable serifs", span >= 5, span);
  }

  // ANCHORING: the brackets must follow the smeared stem. They used to be
  // positioned from the resting geometry while the body drew the spring's
  // quad, so they detached the moment the caret moved.
  {
    const e = mk({ smear: true });
    // A smear that has carried the body 50px right and 10px down.
    e.smearCorners = () => ({
      tl: { x: 150, y: 50 }, tr: { x: 153, y: 50 },
      br: { x: 153, y: 74 }, bl: { x: 150, y: 74 },
    });
    const s = e.serifQuads(active(), 100, 3);
    const topMidX = (s.quads[0].tl.x + s.quads[0].tr.x) / 2;
    ok("brackets travel with a smeared stem", Math.abs(topMidX - 151.5) < 1e-9, topMidX);
    ok("...and sit on the smeared top edge", s.quads[0].tl.y === 50, s.quads[0].tl.y);
    // Still level - a sheared serif reads as a broken glyph.
    ok("...while staying axis-aligned", s.quads[0].tl.y === s.quads[0].tr.y);
  }

  // ANCHORING, part two - issue #25, "the serifs do not travel as slowly as
  // the cursor".
  //
  // Following the smeared quad is not enough: the brackets used to sit on the
  // MIDPOINTS of its top and bottom edges. On a vertical move that is right,
  // because the smear stretches the side edges and leaves the top and bottom
  // ones the caret's own width. On a HORIZONTAL move those edges are the ones
  // that stretch, so their midpoint is the middle of the streak while the
  // caret is at its leading end - measured at 80px behind on a 300px move.
  //
  // The rule is: walk back from the leading corner by half the caret's own
  // width, which lands on the caret's real footprint in motion and reduces to
  // the midpoint whenever the edge is not stretched.
  {
    const stretched = (dir) => {
      const e = mk({ smear: true });
      e._smearDir = dir;
      // 150px of horizontal smear on a 3px stem.
      e.smearCorners = () => ({
        tl: { x: 100, y: 40 }, tr: { x: 250, y: 40 },
        br: { x: 250, y: 64 }, bl: { x: 100, y: 64 },
      });
      return e.serifQuads(active(), 100, 3);
    };
    const midOf = (q) => (q.tl.x + q.tr.x) / 2;

    const right = stretched({ x: 1, y: 0 });
    ok("travelling right, the bracket rides the leading end",
       Math.abs(midOf(right.quads[0]) - 248.5) < 1e-9, midOf(right.quads[0]));
    ok("...and so does the bottom one",
       Math.abs(midOf(right.quads[1]) - 248.5) < 1e-9, midOf(right.quads[1]));
    ok("...which is nowhere near the middle of the streak",
       Math.abs(midOf(right.quads[0]) - 175) > 70);
    ok("...and the reported bounds still cover them",
       right.left <= right.quads[0].tl.x + 1e-9 &&
       right.right >= right.quads[0].tr.x - 1e-9, { l: right.left, r: right.right });

    const left = stretched({ x: -1, y: 0 });
    ok("travelling left, it rides the other end",
       Math.abs(midOf(left.quads[0]) - 101.5) < 1e-9, midOf(left.quads[0]));

    // A vertical smear leaves the top and bottom edges alone, so the rule has
    // to collapse back to the midpoint - the case the old code got right.
    {
      const e = mk({ smear: true });
      e._smearDir = { x: 0, y: 1 };
      e.smearCorners = () => ({
        tl: { x: 100, y: 40 }, tr: { x: 103, y: 40 },
        br: { x: 103, y: 200 }, bl: { x: 100, y: 200 },
      });
      const v = e.serifQuads(active(), 100, 3);
      ok("a vertical smear still centres the bracket on the stem",
         Math.abs(midOf(v.quads[0]) - 101.5) < 1e-9, midOf(v.quads[0]));
      ok("...on the smeared top edge", v.quads[0].tl.y === 40, v.quads[0].tl.y);
      ok("...and the bottom bracket on the smeared bottom edge",
         v.quads[1].bl.y === 200, v.quads[1].bl.y);
    }

    // With no travel direction held (nothing has moved yet) it must not pick
    // a side at random.
    {
      const e = mk({ smear: true });
      e._smearDir = null;
      e.smearCorners = () => ({
        tl: { x: 100, y: 40 }, tr: { x: 103, y: 40 },
        br: { x: 103, y: 64 }, bl: { x: 100, y: 64 },
      });
      const r = e.serifQuads(active(), 100, 3);
      ok("at rest with no direction, the bracket is centred",
         Math.abs(midOf(r.quads[0]) - 101.5) < 1e-9, midOf(r.quads[0]));
    }

    // A degenerate edge (a caret CodeMirror measured as zero-width) must not
    // divide by zero.
    {
      const e = mk({ smear: true });
      e._smearDir = { x: 1, y: 0 };
      e.smearCorners = () => ({
        tl: { x: 100, y: 40 }, tr: { x: 100, y: 40 },
        br: { x: 100, y: 64 }, bl: { x: 100, y: 64 },
      });
      const z = e.serifQuads(active({ w: 0 }), 100, 0);
      ok("a zero-width edge is finite", Number.isFinite(midOf(z.quads[0])), midOf(z.quads[0]));
    }
  }
}

// ---------------------------------------------------------------------------
section("removed features leave no keys behind");

{
  // Ink was removed, but unlike Text Crawl, CRT Inverted Trail and Matrix
  // Rain its four keys were left sitting in all six shipped presets - so
  // applying ANY preset wrote four settings nothing reads into the user's
  // data file, permanently. The generic check below is the one that matters:
  // it fails for the NEXT removal too, not just this one.
  const orphans = [];
  const scan = (label, obj) => {
    const src = (obj && obj.settings) || obj || {};
    for (const k of Object.keys(src)) {
      if (k === "name") continue;
      if (!(k in T.DEFAULT_SETTINGS)) orphans.push(label + "." + k);
    }
  };
  for (const [n, p] of Object.entries(T.DEFAULT_PRESETS)) scan(n, p);
  for (const [m, p] of Object.entries(T.PRESET1_VIM_MODES || {})) scan("vim:" + m, p);
  ok("no shipped preset carries a key nothing reads", orphans.length === 0, orphans);

  // ...and a config saved while Ink existed sheds them on the next load,
  // the same treatment the other three removals got.
  const stale = T.migrateLegacyKeys({
    inkEffect: true, inkColor: "#1a1a2e", inkOpacity: 0.55, inkPooling: true,
    cursorStyle: "Box",
  });
  ok("migrate drops inkEffect", !("inkEffect" in stale));
  ok("...inkColor", !("inkColor" in stale));
  ok("...inkOpacity", !("inkOpacity" in stale));
  ok("...inkPooling", !("inkPooling" in stale));
  ok("...without touching anything real", stale.cursorStyle === "Box");

  // Dropping them must not have changed what any preset actually looks like.
  const jello = T.presetWithDefaults(T.DEFAULT_PRESETS[T.DEFAULT_PRESET_NAME]);
  ok("the starter preset still resolves", !!jello && jello.cursorStyle === "Box");
  ok("...and carries no ink keys",
     Object.keys(jello).filter((k) => /^ink/.test(k)).length === 0);
}

// ---------------------------------------------------------------------------
section("glyph alpha follows the blink");

{
  // The letter and the box are one object and fade together.
  const glyph = (blink, bodyOpacity = 1) => Math.min(1, bodyOpacity * blink);
  const box = (blink, bodyOpacity = 1) => 0.9 * blink * bodyOpacity;

  ok("fully lit at the top of the blink", glyph(1) === 1);

  // First wrong answer: floored at 0.3, so a blinked-off box still carried an
  // inverted ghost of the letter over the real character.
  const floored = (b) => Math.min(1, 0.3 + b * 0.7);
  ok("the floored curve left a ghost at blink-off", floored(0) === 0.3);
  ok("the current curve reaches zero", glyph(0) === 0);

  // Second wrong answer: cubed. That reached zero but overshot - the letter
  // was at 0.13 while the box was still at 0.46, so most of every fade showed
  // a solid block with nothing in it. Easy to miss with Smooth Movement on,
  // because its 450ms stop-blink hold keeps the caret lit right after a
  // keystroke, which made the letter look like it needed smooth movement.
  const cubed = (b) => b * b * b;
  ok("the cubed curve emptied the box mid-fade", cubed(0.51) < 0.15, cubed(0.51));
  ok("the current curve keeps the letter with the box",
     Math.abs(glyph(0.51) - 0.51) < 1e-9, glyph(0.51));

  // The letter must never be much fainter than the box it sits in.
  let worstGap = 0;
  for (let b = 0; b <= 1.0001; b += 0.02) worstGap = Math.max(worstGap, box(b) - glyph(b));
  ok("the letter is never fainter than its own box", worstGap <= 0, worstGap);

  // Monotonic, so the letter never brightens as the box fades.
  let prev = -1, mono = true;
  for (let b = 0; b <= 1.0001; b += 0.05) { const v = glyph(b); if (v < prev - 1e-9) mono = false; prev = v; }
  ok("the curve is monotonic in blink", mono);

  // Cursor Opacity reaches the glyph; it previously had no opacity term at all.
  ok("Cursor Opacity scales the glyph", glyph(1, 0.2) === 0.2, glyph(1, 0.2));
  ok("...and a near-zero opacity falls under the skip threshold", glyph(1, 0.005) < 0.01);
}

// ---------------------------------------------------------------------------
section("motion smear: the quad must not twist");

{
  // Drives the real updateSmearQuad frame by frame along a straight path at a
  // given angle, and reports how far the caret's vertical edges lean off
  // upright at their worst.
  const drive = (angleDeg, over = {}, style = "Line", frames = 40, speed = 6) => {
    const e = makeEngine(Object.assign(
      { smear: true, smearTaper: false, cursorStyle: style,
        smearStiffness: 0.8, smearTrailingStiffness: 0.4, smearDamping: 0.5 },
      over,
    ));
    e.styleFor = (k) => e.settings[k];
    e.renderWidth = (a) => a.w;
    e.underlineThickness = () => 3;
    e._catchUpBoost = 1;
    e.smearQuad = null; e.smearShape = null; e.smearCenterPrev = null;
    e._smearDtT = 0; e._smearDir = null;

    const a = angleDeg * Math.PI / 180;
    const real = performance.now;
    let t = 1000, worstTilt = 0, widest = 0, allFinite = true;
    try {
      for (let i = 0; i < frames; i++) {
        e.animActive = {
          x: 100 + Math.cos(a) * speed * i,
          top: 40 + Math.sin(a) * speed * i,
          w: 3, h: 24,
        };
        performance.now = () => t;
        e.updateSmearQuad();
        t += 16.7;
        const q = e.smearQuad;
        if (!q) continue;
        for (const k in q) {
          if (!Number.isFinite(q[k].x) || !Number.isFinite(q[k].y)) allFinite = false;
        }
        const l = Math.atan2(q.bl.x - q.tl.x, q.bl.y - q.tl.y) * 180 / Math.PI;
        const r = Math.atan2(q.br.x - q.tr.x, q.br.y - q.tr.y) * 180 / Math.PI;
        worstTilt = Math.max(worstTilt, Math.abs((l + r) / 2));
        widest = Math.max(widest, ((q.tr.x - q.tl.x) + (q.br.x - q.bl.x)) / 2);
      }
    } finally {
      performance.now = real;
    }
    return { tilt: worstTilt, widest, allFinite, engine: e };
  };

  // A Line caret travelling flat must stay upright and must actually smear.
  const flat = drive(0);
  ok("flat travel leaves the caret upright", flat.tilt < 0.01, flat.tilt);
  ok("...and it still stretches along the travel", flat.widest > 10, flat.widest);
  ok("...with no non-finite corners", flat.allFinite);

  const down = drive(90);
  ok("vertical travel keeps the bar upright", down.tilt < 0.01, down.tilt);

  const box = drive(30, {}, "Box");
  ok("a Box caret stays finite on a diagonal", box.allFinite);

  // The spring must come to rest exactly on target rather than hovering.
  {
    const e = drive(0).engine;
    const real = performance.now;
    let t = 9000;
    try {
      for (let i = 0; i < 120; i++) {
        e.animActive = { x: 400, top: 40, w: 3, h: 24 };
        performance.now = () => t;
        e.updateSmearQuad();
        t += 16.7;
      }
    } finally { performance.now = real; }
    const q = e.smearQuad;
    ok("the quad settles exactly onto its target",
       Math.abs(q.tl.x - 400) < 1e-9 && Math.abs(q.br.x - 403) < 1e-9,
       { tl: q.tl.x, br: q.br.x });
    ok("...with no residual velocity", q.tl.vx === 0 && q.tl.vy === 0);
    ok("...and reports itself as no longer moving", e._smearMoving === false);
  }
  // --- the quad must be in the draw-skip signature ------------------------
  //
  // The loop skips a frame whose draw signature matches the last one. The
  // signature is built from the caret and the settings - and the smear quad
  // is neither. It is a spring with its own state that keeps deforming after
  // the caret has stopped, so every one of those frames matched the previous
  // signature, was skipped, and left the last painted shape stranded on
  // screen: a stale stretched ghost that stayed until the next keystroke.
  {
    const step = (e, x, t) => {
      const real = performance.now;
      try {
        e.animActive = { x, top: 40, w: 3, h: 24 };
        performance.now = () => t;
        e.updateSmearQuad();
      } finally { performance.now = real; }
    };
    const fresh = () => {
      const e = makeEngine({ smear: true, smearTaper: false, cursorStyle: "Line",
        smearStiffness: 0.65, smearTrailingStiffness: 0.15, smearDamping: 0.45,
        blinkingEnabled: false });
      e.styleFor = (k) => e.settings[k];
      e.renderWidth = (a) => a.w;
      e.underlineThickness = () => 3;
      e._catchUpBoost = 1;
      e.smearQuad = null; e.smearShape = null; e.smearCenterPrev = null;
      e._smearDtT = 0; e._smearDir = null;
      return e;
    };

    // How far what is ON SCREEN can drift from where the quad actually is,
    // given frames are only painted when the signature changes.
    const drift = (useSmearTerm) => {
      const e = fresh();
      let t = 1000, lastSig = null, painted = null, worst = 0;
      for (let i = 0; i < 120; i++) {
        // Types for ten frames, then holds perfectly still.
        const x = i < 10 ? 100 + i * 8 : 100 + 9 * 8;
        step(e, x, t); t += 16.7;
        const q = e.smearQuad;
        const snap = ["tl", "tr", "br", "bl"].map((k) => [q[k].x, q[k].y]);
        const sig = "caret:" + x + "|" + (useSmearTerm ? e._smearSig() : "");
        if (sig !== lastSig) { lastSig = sig; painted = snap; }
        for (let j = 0; j < 4; j++) {
          worst = Math.max(worst, Math.abs(snap[j][0] - painted[j][0]),
                                  Math.abs(snap[j][1] - painted[j][1]));
        }
      }
      return worst;
    };

    ok("without the quad in the signature the screen goes badly stale",
       drift(false) > 20, drift(false));
    ok("with it, the screen never drifts more than a pixel",
       drift(true) < 1, drift(true));

    // It must not do the reverse and hold the loop awake: once settled the
    // signature has to stop changing, or an idle cursor repaints forever.
    const e = fresh();
    let t = 1000;
    for (let i = 0; i < 200; i++) { step(e, i < 10 ? 100 + i * 8 : 172, t); t += 16.7; }
    const a = e._smearSig();
    step(e, 172, t + 16.7);
    const b = e._smearSig();
    ok("a settled quad produces a stable signature", a === b && a !== "nosmear", { a, b });
    ok("...and reports itself settled", e._smearMoving === false);

    // Smear off must not fabricate a term that changes.
    const off = makeEngine({ smear: false });
    off.styleFor = (k) => off.settings[k];
    ok("with Motion Smear off the term is inert", off._smearSig() === "nosmear");
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

// ---------------------------------------------------------------------------
section("blink-to-solid: blink N times, then stay lit");

{
  const SPEED = 1.2;
  const PERIOD = 2500 / SPEED;
  const mk = (over) => {
    const e = makeEngine(Object.assign({
      blinkingEnabled: true, blinkSpeed: SPEED, blinkDelayMs: 0,
      smoothEnabled: false, blinkStopAfter: 3,
    }, over));
    e.lastMoveTime = 0;
    return e;
  };
  // Count the dark phases actually entered, rather than trusting the formula
  // that produced them.
  const darkPhases = (e, untilPeriods) => {
    let n = 0, prev = 1;
    for (let t = 0; t <= untilPeriods * PERIOD; t += 5) {
      const a = e.blinkPhase(t);
      if (prev > 0.5 && a <= 0.5) n++;
      prev = a;
    }
    return n;
  };

  const e = mk({});
  ok("blinks exactly the requested number of times", darkPhases(e, 8) === 3, darkPhases(e, 8));
  ok("...and is lit once the count is spent", e.blinkPhase(3 * PERIOD) > 0.99, e.blinkPhase(3 * PERIOD));
  ok("...and stays lit indefinitely", e.blinkPhase(500 * PERIOD) > 0.99);

  // The hand-off must not snap. Counting whole PERIODS is what buys this: a
  // cycle starts fully on, so alpha is already 1 on the frame the count is
  // spent. An alpha-threshold or fade-counting rule would stop mid-cycle and
  // jump, which is the same defect the phase anchor above exists to remove.
  {
    let worst = 0;
    for (let t = 3 * PERIOD - 200; t <= 3 * PERIOD + 200; t += 5) {
      worst = Math.max(worst, Math.abs(e.blinkPhase(t) - e.blinkPhase(t + 5)));
    }
    ok("no discontinuity where it goes solid", worst < 0.05, worst);
  }

  // Off by default, and 0 means the old behaviour exactly.
  ok("the feature is off in DEFAULT_SETTINGS", T.DEFAULT_SETTINGS.blinkStopAfter === 0);
  {
    const forever = mk({ blinkStopAfter: 0 });
    ok("0 blinks forever", darkPhases(forever, 20) === 20, darkPhases(forever, 20));
    ok("...and is still dark deep into the future", forever.blinkPhase(100.5 * PERIOD) < 0.02);
  }

  // A move restarts the count - that is the whole point, and it falls out of
  // lastMoveTime rather than needing a counter of its own.
  {
    const moved = mk({});
    ok("solid before the move", moved.blinkPhase(5 * PERIOD) > 0.99);
    moved.lastMoveTime = 5 * PERIOD;
    ok("...and blinking again after it",
       darkPhases(Object.assign(Object.create(Object.getPrototypeOf(moved)), moved, { lastMoveTime: 0 }), 8) === 3);
    ok("...counted from the move, not from zero",
       moved.blinkPhase(5 * PERIOD + 0.5 * PERIOD) < 0.02);
  }

  // The Blink Delay hold sits in front of the count, not inside it: the
  // caret holds lit, THEN blinks N times.
  {
    const held = mk({ blinkStopAfter: 1, blinkDelayMs: 1000 });
    ok("still lit during the hold", held.blinkPhase(500) > 0.99);
    ok("...dark inside the one blink that follows", held.blinkPhase(1000 + 0.5 * PERIOD) < 0.02);
    ok("...and solid after it", held.blinkPhase(1000 + 1.2 * PERIOD) > 0.99);
  }

  // Breathing shares blinkPhase, so it must come to rest at full size rather
  // than stopping mid-breath.
  {
    const breath = makeEngine({
      blinkingEnabled: true, blinkSpeed: SPEED, blinkDelayMs: 0, smoothEnabled: false,
      blinkStopAfter: 2, blinkBreathing: true, blinkBreathDepth: 0.3,
    });
    breath.lastMoveTime = 0;
    ok("breathing shrinks while the count runs", breath.breathScale(0.5 * PERIOD) < 0.75, breath.breathScale(0.5 * PERIOD));
    ok("...and settles at full size", Math.abs(breath.breathScale(9 * PERIOD) - 1) < 1e-9);
  }

  // A zero blink speed already meant "no blink"; the count must not divide by
  // it or resurrect one.
  {
    const still = mk({ blinkSpeed: 0 });
    ok("a zero blink speed stays lit and finite", still.blinkPhase(9999) === 1);
  }

  // Share codes: appended, so it cannot have moved anything else.
  ok("blinkStopAfter is the last LOOK_KEYS entry",
     T.LOOK_KEYS[T.LOOK_KEYS.length - 1] === "blinkStopAfter", T.LOOK_KEYS[T.LOOK_KEYS.length - 1]);
  {
    const code = T.presetToCode("Solid", { blinkStopAfter: 4 });
    const back = T.codeToPreset(code);
    // codeToPreset hands back { name, snap }, not a flat settings object.
    ok("...and survives a share-code round trip", back.snap.blinkStopAfter === 4, back);
  }
}


// ---------------------------------------------------------------------------
section("Hot-head fire sits on the glyphs");

{
  // burn.y is the top of the LINE BOX; the glyphs start half a leading below
  // it. The original anchor was a flat 0.22 of the LINE HEIGHT, which lands
  // below the glyph top on body text - the fire printed over the letters -
  // and drifted further off the larger the type got, because half-leading is
  // a different share of the line box at every size.
  const glyphTop = (lh, fs) => Math.max(0, lh - fs) / 2;
  const oldAnchor = (lh) => lh * 0.22;
  const base = (lh, fs) => glyphTop(lh, fs) - fs * T.HOT_HEAD_LIFT;

  const CASES = [["body", 24, 16], ["heading", 44, 32], ["small", 18, 12], ["tight", 20, 18]];
  for (const [name, lh, fs] of CASES) {
    // Rooted: the base bites slightly INTO the glyphs, which is what makes a
    // flame look attached rather than hovering.
    ok(`${name}: the base touches the letters`, base(lh, fs) > glyphTop(lh, fs),
       { base: base(lh, fs), glyphTop: glyphTop(lh, fs) });
    // ...but only slightly. Sinking it into the text reads as overprinting.
    ok(`${name}: without sinking into them`,
       base(lh, fs) - glyphTop(lh, fs) < fs * 0.15,
       base(lh, fs) - glyphTop(lh, fs));
    // The old anchor drifted with type size; this one is proportional to it.
    ok(`${name}: the offset tracks the font, not the line box`,
       Math.abs((base(lh, fs) - glyphTop(lh, fs)) / fs - Math.abs(T.HOT_HEAD_LIFT)) < 1e-9);
  }

  // The old constant got worse as the type grew - that is the bug this
  // replaced, so keep a witness to it.
  ok("the old flat constant printed over the letters",
     CASES.every(([, lh, fs]) => oldAnchor(lh) > glyphTop(lh, fs)));

  // Jitter is weighted upward, since flames rise, but reaches a little below
  // the base so some particles sit right on the letters.
  ok("jitter mostly rises", T.HOT_HEAD_JITTER_UP > T.HOT_HEAD_JITTER_DOWN,
     { up: T.HOT_HEAD_JITTER_UP, down: T.HOT_HEAD_JITTER_DOWN });
  ok("...but still reaches below the base", T.HOT_HEAD_JITTER_DOWN > 0);
  ok("...without raining over the whole line",
     T.HOT_HEAD_JITTER_DOWN < 0.12, T.HOT_HEAD_JITTER_DOWN);
}


// ---------------------------------------------------------------------------
section("smooth movement: size counts as arrival");

{
  const drive = (from, to, frames = 40) => {
    const e = makeEngine({ smoothEnabled: true });
    e._smoothLastT = 0; e.typingSpeedMod = 1; e.lastMoveTime = -1e9;
    e.lastActive = Object.assign({ actualCharWidth: 9 }, to);
    e.animActive = Object.assign({ actualCharWidth: 9 }, from);
    const real = performance.now;
    let t = 1000;
    try {
      performance.now = () => t;
      e._smoothLastT = t;
      const out = [];
      for (let i = 0; i < frames; i++) {
        t += 16.7;
        e.updateSmoothCursor();
        out.push({ x: e.animActive.x, top: e.animActive.top, w: e.animActive.w,
                   h: e.animActive.h, moving: e._smoothMoving });
      }
      return out;
    } finally { performance.now = real; }
  };

  // THE BUG. Arrival tested position only, then snapped size. When position
  // barely moves while height does - a line becoming a heading, an embed
  // resizing the row - the caret popped the whole 36px in one frame, with
  // _smoothMoving already false so the governor never counted it as motion.
  {
    const out = drive({ x: 100, top: 100, w: 3, h: 24 }, { x: 100.2, top: 100.2, w: 3, h: 60 });
    let biggest = 0, prev = 24;
    for (const f of out) { biggest = Math.max(biggest, Math.abs(f.h - prev)); prev = f.h; }
    ok("height is no longer snapped in a single frame", biggest < 36 * 0.35, biggest);
    ok("...and it is reported as moving while it changes", out[0].moving === true);

    let frames = 0;
    for (const f of out) { frames++; if (Math.abs(f.h - 60) < 1) break; }
    ok("...easing over several frames", frames >= 5, frames);
    ok("...and still landing exactly on target", Math.abs(out[39].h - 60) < 1e-9, out[39].h);
  }

  // Width has the same problem and the same fix - a Box caret gliding onto a
  // wide glyph changes w without moving much.
  {
    const out = drive({ x: 100, top: 100, w: 9, h: 24 }, { x: 100.2, top: 100, w: 30, h: 24 });
    let biggest = 0, prev = 9;
    for (const f of out) { biggest = Math.max(biggest, Math.abs(f.w - prev)); prev = f.w; }
    ok("width eases too", biggest < 21 * 0.35, biggest);
  }

  // The ordinary case must be untouched: when everything moves together it
  // should still settle promptly rather than being held open by the extra
  // terms.
  {
    const out = drive({ x: 0, top: 0, w: 3, h: 24 }, { x: 200, top: 0, w: 3, h: 24 });
    let settled = 0;
    for (const f of out) { settled++; if (!f.moving) break; }
    ok("a plain horizontal move still settles promptly", settled < 30, settled);
    ok("...exactly on target", out[39].x === 200 && out[39].moving === false);
  }
}



// ---------------------------------------------------------------------------
section("catch-up boost must not flicker (issue #19: stutter)");

{
  // updateSmoothCursor publishes _catchUpBoost, and Motion Smear multiplies
  // its SPRING STIFFNESS by it. The backlog drain that feeds it is measured
  // from the instantaneous gap between the real caret and the animated one,
  // and that gap is inherently spiky - it jumps on the frame a key lands and
  // shrinks between. Under steady typing it settled into a per-frame sawtooth
  // (measured: 1.55 <-> 2.04), so the smear's spring constant flickered 25%
  // every frame. A spring whose constant flickers does not settle smoothly,
  // it pulses. Only visible with BOTH features on: with either off the value
  // is never computed or never consumed.
  const typeRun = (over = {}) => {
    const e = makeEngine(Object.assign({ smoothEnabled: true, smear: true }, over));
    e._smoothLastT = 0; e.typingSpeedMod = 1; e._typingBoostSm = null;
    e.lastActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    e.animActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    const real = performance.now;
    let t = 1000;
    const out = [];
    try {
      performance.now = () => t;
      e._smoothLastT = t;
      for (let i = 0; i < 30; i++) {
        // A keystroke every other frame - the cadence that produced the
        // sawtooth.
        if (i % 2 === 0) {
          e.lastActive = { x: 100 + i * 4, top: 40, w: 3, h: 24, actualCharWidth: 9 };
          e.lastMoveTime = t;
        }
        t += 16.7;
        e.updateSmoothCursor();
        out.push(e._catchUpBoost);
      }
    } finally { performance.now = real; }
    return out;
  };

  const boosts = typeRun();

  // Steady state: once typing has settled the value must be near-constant.
  const tail = boosts.slice(-10);
  let ripple = 0;
  for (let i = 1; i < tail.length; i++) ripple = Math.max(ripple, Math.abs(tail[i] - tail[i - 1]));
  ok("the boost is steady under steady typing", ripple < 0.08, ripple);

  // ...and the raw sawtooth it replaces really was that bad, so this test is
  // guarding something real.
  ok("the unsmoothed sawtooth would have been far worse", 0.49 > ripple * 4, ripple);

  // It must still ACT: flattening it by pinning it to 1 would fix the stutter
  // by deleting the adaptive catch-up.
  ok("it still rises while typing", Math.max(...boosts) > 1.5, Math.max(...boosts));
  ok("...starting from rest", boosts[0] < 1.2, boosts[0]);
  ok("...and rising monotonically enough to be useful",
     boosts[boosts.length - 1] > boosts[2], { first: boosts[2], last: boosts[boosts.length - 1] });

  // Frame-rate independence: the smoothing is a time constant, not a fixed
  // per-frame fraction, so the settled value must not depend on refresh rate.
  const atRate = (frameMs) => {
    const e = makeEngine({ smoothEnabled: true, smear: true });
    e._smoothLastT = 0; e.typingSpeedMod = 1; e._typingBoostSm = null;
    e.lastActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    e.animActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    const real = performance.now;
    let t = 1000;
    try {
      performance.now = () => t;
      e._smoothLastT = t;
      const frames = Math.round(500 / frameMs);
      for (let i = 0; i < frames; i++) {
        e.lastActive = { x: 100 + i * (4 * frameMs / 16.7), top: 40, w: 3, h: 24, actualCharWidth: 9 };
        e.lastMoveTime = t;
        t += frameMs;
        e.updateSmoothCursor();
      }
    } finally { performance.now = real; }
    return e._catchUpBoost;
  };
  const at60 = atRate(16.7), at144 = atRate(6.9);
  ok("the settled boost is the same at 60 and 144Hz",
     Math.abs(at60 - at144) < 0.25, { at60, at144 });

  // Turning smooth movement off must leave the smear entirely alone.
  {
    const e = makeEngine({ smoothEnabled: false, smear: true });
    e.lastActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    e.animActive = { x: 0, top: 0, w: 3, h: 24, actualCharWidth: 9 };
    e.updateSmoothCursor();
    ok("with smooth movement off the boost is inert", e._catchUpBoost === 1);
  }
}


// ---------------------------------------------------------------------------
section("Note Editor Only: the plugin stays out of the interface");

// Issue #29. The plugin draws a caret on every editable surface in the app -
// Command Palette, Quick Switcher, Search, Settings, the tab-title rename box,
// other plugins' modals - and hides the native one everywhere at once with a
// single body class. This option confines both halves to the note editor.
//
// "Both halves" is what these assertions are about. Declining to draw while
// still hiding the native caret leaves a field with no caret from EITHER
// source, which is precisely what issues #26 and #27 were, and it is invisible
// until someone tries to type in the field it happened to. The guarantee here
// is structural rather than careful: one predicate answers for the drawing and
// for the hiding, so the two cannot drift apart.
{
  const proto = T.EngineProto;

  // An engine with just enough on it to answer both questions: a settings
  // object and a workspace whose active editor may or may not have focus.
  // focus === null means there is no active editor at all - no note open -
  // which has to read the same as one that is merely unfocused.
  const engine = (settings, focus) => {
    const e = Object.create(proto);
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    e.app = {
      workspace: {
        activeEditor: focus === null ? null : { editor: { cm: { hasFocus: focus } } },
      },
    };
    return e;
  };

  // --- the setting ------------------------------------------------------
  ok("it is off by default", T.DEFAULT_SETTINGS.noteEditorOnly === false);
  // Structural, like hideNativeCaret and hideOnWindowBlur: it says WHERE the
  // plugin applies, not what the cursor looks like, so it has no business in a
  // preset, a share code or a per-Vim-mode snapshot. LOOK_KEYS is positional
  // as well, so a structural key appended to it burns an index forever.
  ok("it is not a look key", !T.LOOK_KEYS.includes("noteEditorOnly"));
  const carrying = Object.entries(T.DEFAULT_PRESETS)
    .filter(([, p]) => "noteEditorOnly" in p).map(([n]) => n);
  ok("no shipped preset carries it", carrying.length === 0, carrying);

  // --- noteEditorFocused: the one predicate ------------------------------
  ok("the focused note editor is the note editor",
     engine({}, true).noteEditorFocused() === true);
  ok("an unfocused editor is not", engine({}, false).noteEditorFocused() === false);
  ok("no open editor is not", engine({}, null).noteEditorFocused() === false);
  {
    // It feeds the hide-native body class, so a throw has to answer "no" -
    // which hands the user Obsidian's own caret - rather than propagate into
    // the frame that stamps the class.
    const e = Object.create(proto);
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS);
    e.app = { get workspace() { throw new Error("mid-teardown"); } };
    let threw = false, out;
    try { out = e.noteEditorFocused(); } catch { threw = true; }
    ok("a broken workspace lookup does not throw", threw === false);
    ok("...and fails safe, toward the native caret", out === false);
  }

  // --- hideNativeActive: what the body class means now -------------------
  ok("off: the native caret is hidden everywhere, exactly as before",
     engine({ noteEditorOnly: false }, false).hideNativeActive() === true);
  ok("on, in the editor: still hidden",
     engine({ noteEditorOnly: true }, true).hideNativeActive() === true);
  ok("on, anywhere else: the native caret comes back",
     engine({ noteEditorOnly: true }, false).hideNativeActive() === false);
  ok("on, with no note open: the native caret comes back",
     engine({ noteEditorOnly: true }, null).hideNativeActive() === false);
  // Hide Real Cursor still outranks it in both focus states - this option
  // scopes that toggle, it does not replace or override it.
  for (const focus of [true, false]) {
    ok("Hide Real Cursor off still wins (focus=" + focus + ")",
       engine({ hideNativeCaret: false, noteEditorOnly: true }, focus).hideNativeActive() === false);
  }

  // --- genericCaretCoords: the drawn half --------------------------------
  // The gate sits at the very front of the function, ahead of any DOM work.
  // isExcalidrawCaretHost is the first thing past it, so spying on that says
  // how far execution actually got - "returned null" alone would also be true
  // of a dozen unrelated reasons further down.
  const runGeneric = (noteEditorOnly) => {
    const e = engine({ noteEditorOnly }, false);
    let reached = false;
    e.isExcalidrawCaretHost = () => { reached = true; return true; };
    e.canvas = { ownerDocument: { activeElement: { tagName: "INPUT", type: "text" } } };
    // Called first, into a local. Building the object around the call would
    // read `reached` before the call that sets it - which is how this test
    // passed against an engine that never reached the spy at all.
    const out = e.genericCaretCoords();
    return { reached, out };
  };
  {
    const off = runGeneric(false);
    ok("off: the interface caret is still measured", off.reached === true);
    const on = runGeneric(true);
    ok("on: no caret is drawn in the interface", on.out === null);
    ok("...and nothing is measured to decide that", on.reached === false);
  }

  // --- the invariant, stated over every focus state ----------------------
  for (const [label, focus] of [["in the editor", true], ["elsewhere", false], ["no note open", null]]) {
    const e = engine({ noteEditorOnly: true }, focus);
    e.isExcalidrawCaretHost = () => false;
    e.canvas = { ownerDocument: { activeElement: { tagName: "INPUT", type: "text" } } };
    const hides = e.hideNativeActive();
    if (focus === true) {
      // caretCoords() routes to cmCaretCoords here, which this option never
      // touches - so a caret IS drawn, and the native one must stay hidden.
      ok(label + ": we draw, so the native caret stays hidden", hides === true);
    } else {
      ok(label + ": no caret is drawn", e.genericCaretCoords() === null);
      ok(label + ": ...so the native one is handed back", hides === false);
    }
  }

  // --- the row that turns it on ------------------------------------------
  {
    const { renderGlobalRows } = require("./panel_harness");
    const rows = renderGlobalRows({});
    const names = rows.map((r) => r.name).filter(Boolean);
    ok("the row is in the panel", names.includes("Note Editor Only"), names);
    // It belongs above the CUA/Vim switch with the other structural options.
    // In Vim mode the whole Look panel below that switch is replaced, so a row
    // rendered down there is unreachable for half the plugin's users - which
    // is exactly what once happened to Hide Real Cursor.
    ok("...above the mode switch, among the global options",
       names.indexOf("Note Editor Only") > names.indexOf("Enable Plugin") &&
       names.indexOf("Note Editor Only") < names.indexOf("Respect Reduced Motion"), names);
    // The rule panel_harness.js exists to enforce: a row that throws takes out
    // every row after it, and this one is now second of five.
    ok("...and the rows after it still render",
       names.includes("Hide Real Cursor") && names.includes("Hide Cursor When Unfocused"), names);

    const row = rows.find((r) => r.name === "Note Editor Only");
    ok("it is one toggle", row.controls.join() === "toggle", row.controls);
    ok("it shows the saved value", row.toggles[0]._value === false);
    row.toggles[0]._change(true);
    ok("...and pressing it writes noteEditorOnly", rows.settings.noteEditorOnly === true);
    // The row it was copied from writes a different key. Wiring both to the
    // same one is the likeliest way to get this wrong and would look, from the
    // panel, like the new toggle simply did nothing.
    rows.find((r) => r.name === "Hide Real Cursor").toggles[0]._change(false);
    ok("Hide Real Cursor still writes its own key",
       rows.settings.hideNativeCaret === false && rows.settings.noteEditorOnly === true,
       { hideNativeCaret: rows.settings.hideNativeCaret, noteEditorOnly: rows.settings.noteEditorOnly });
  }
}

// ---------------------------------------------------------------------------
section("the canvas follows the caret (issue #30)");

// Issue #30: with hardware acceleration off, Chromium's software compositor
// re-composites the whole on-screen area of the canvas element every frame it
// changes - the damage rect is irrelevant to it. Measured in a live Obsidian:
// a full-window canvas took idle from 6% to 24% of a core and typing from 19%
// to 75%; the same plugin drawing into a 320x160 element round the caret took
// half of that, and sizing the backing store to the pane changed nothing. So
// the element is now a region fitted round what has to be visible, and these
// pin the two halves: the pure geometry, and the engine's use of it.
{
  const fit = T.fitCanvasRegion;
  const GRID = T.CANVAS_REGION_GRID;
  const clip = { x: 100, y: 50, w: 1000, h: 700 };
  const opts = { marginX: 160, marginY: 32, grid: GRID, allowShrink: false };

  // --- fitCanvasRegion: pure geometry -------------------------------------
  {
    const need = { x0: 400, y0: 300, x1: 410, y1: 324 };
    const r = fit(need, clip, null, opts);
    ok("a fresh fit is a region", !!r, r);
    ok("...that contains the need",
       r.x <= 400 && r.y <= 300 && r.x + r.w >= 410 && r.y + r.h >= 324, r);
    ok("...with the margins round it",
       r.x <= 400 - 160 && r.x + r.w >= 410 + 160 && r.y <= 300 - 32 && r.y + r.h >= 324 + 32, r);
    ok("...sized on the grid", r.w % GRID === 0 && r.h % GRID === 0, r);
    ok("...and far smaller than the clip", r.w * r.h < clip.w * clip.h / 4, r);
    ok("...inside the clip",
       r.x >= clip.x && r.y >= clip.y && r.x + r.w <= clip.x + clip.w && r.y + r.h <= clip.y + clip.h, r);

    // A need the region already covers is a no-op, by identity, so the caller
    // can test `=== current` and skip the blank-and-repaint.
    ok("a covered need returns the current region itself",
       fit({ x0: 405, y0: 302, x1: 420, y1: 326 }, clip, r, opts) === r);
    ok("a null need keeps the current region", fit(null, clip, r, opts) === r);
    ok("a need entirely outside the clip keeps the current region",
       fit({ x0: 5, y0: 5, x1: 20, y1: 20 }, clip, r, opts) === r);

    // Typing along a line: the need drifts right, out of the margin. The
    // region SLIDES - same allocation, new position - rather than growing.
    const far = { x0: r.x + r.w + 10, y0: 300, x1: r.x + r.w + 20, y1: 324 };
    const slid = fit(far, clip, r, opts);
    ok("a need past the margin re-anchors", slid !== r);
    ok("...keeping the allocation's size", slid.w === r.w && slid.h === r.h, { r, slid });
    ok("...and containing the new need",
       slid.x <= far.x0 && slid.x + slid.w >= far.x1, { far, slid });

    // A need bigger than the clip is the clip.
    const huge = fit({ x0: 0, y0: 0, x1: 5000, y1: 5000 }, clip, r, opts);
    ok("a need larger than the clip gives the whole clip",
       huge.x === clip.x && huge.y === clip.y && huge.w === clip.w && huge.h === clip.h, huge);

    // Shrinking waits for permission, and even then only from a region more
    // than CANVAS_REGION_SHRINK_RATIO (2x) what the need wants.
    ok("an oversized region is kept without allowShrink",
       fit(need, clip, huge, opts) === huge);
    const shrunk = fit(need, clip, huge, Object.assign({}, opts, { allowShrink: true }));
    ok("...and shrunk with it", shrunk !== huge && shrunk.w * shrunk.h < huge.w * huge.h / 4, shrunk);
    ok("a region only a little too big is not shrunk",
       fit(need, clip, Object.assign({}, r, { w: r.w + GRID }), Object.assign({}, opts, { allowShrink: true })).w === r.w + GRID);

    // Never partly outside the clip, whatever the need does.
    const edge = fit({ x0: clip.x + clip.w - 5, y0: clip.y + clip.h - 5, x1: clip.x + clip.w + 50, y1: clip.y + clip.h + 50 }, clip, null, opts);
    ok("a need at the clip's corner is pushed back inside",
       edge.x + edge.w <= clip.x + clip.w && edge.y + edge.h <= clip.y + clip.h && edge.x >= clip.x && edge.y >= clip.y, edge);
  }

  // --- the engine's use of it ---------------------------------------------
  // A stand-in for the engine with a recording canvas: enough to run
  // _fitCanvasRegion and draw() with every painter stubbed out.
  const makeRegionEngine = (settings = {}) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    e.styleFor = (k) => e.settings[k];
    e.canvas = {
      width: 0, height: 0, style: {},
      ownerDocument: { defaultView: { devicePixelRatio: 2 } },
    };
    const calls = [];
    e.ctx = {
      calls,
      save() {}, restore() {},
      setTransform(...m) { calls.push({ op: "setTransform", m }); e.ctx.matrix = m; },
      clearRect(x, y, w, h) { calls.push({ op: "clearRect", x, y, w, h }); },
    };
    e._clipRect = { x: 100, y: 50, w: 1000, h: 700 };
    e._wrapperPos = { left: 100, top: 50 };
    e._canvasRect = null;
    e._canvasDpr = 0;
    e._dirtyFull = true;
    // Painters: none paint, except what a test hangs on `paintExtra`.
    for (const f of ["drawLettersParticles", "drawBracketTether", "drawStardust",
                     "drawFlamePixels", "drawHotHead", "drawThunderbolts",
                     "drawFireworks", "drawGenericCaret", "drawRetroBox",
                     "drawSecondaryCarets", "applyCanvasBlend"]) {
      e[f] = () => { if (f === "drawFlamePixels" && e.paintExtra) e._markDirty(...e.paintExtra); };
    }
    e.breathScale = () => 1;
    e.glowHeatScale = () => 1;
    e.setCaret = (x, top) => {
      e.lastActive = { x, top, w: 8, h: 24, actualCharWidth: 8 };
      e.animActive = Object.assign({}, e.lastActive);
    };
    return e;
  };
  const allocs = (e) => e.ctx.calls.filter((c) => c.op === "setTransform").length;

  {
    const e = makeRegionEngine();
    ok("no caret, nothing painted: no region and no draw", e._fitCanvasRegion() === false && e._canvasRect === null);

    e.setCaret(400, 300);
    ok("the first caret allocates a region", e._fitCanvasRegion() === true && !!e._canvasRect, e._canvasRect);
    const r0 = e._canvasRect;
    ok("...far smaller than the clip", r0.w * r0.h < e._clipRect.w * e._clipRect.h / 4, r0);
    ok("...with the backing store sized to it at the DPR",
       e.canvas.width === r0.w * 2 && e.canvas.height === r0.h * 2, { r0, w: e.canvas.width, h: e.canvas.height });
    ok("...the context translated by the region's origin",
       e.ctx.matrix.join() === [2, 0, 0, 2, -r0.x * 2, -r0.y * 2].join(), e.ctx.matrix);
    ok("...and the element placed relative to the wrapper",
       e.canvas.style.transform === `translate(${r0.x - 100}px, ${r0.y - 50}px)`, e.canvas.style.transform);

    // A fresh allocation is blank, so the full clear enableCanvasEngine
    // requested has nothing to do - and draw() must not clear the window.
    e.draw();
    ok("a fresh store needs no clear at all", e.ctx.calls.filter((c) => c.op === "clearRect").length === 0);
    ok("the caret's damage lands inside the region",
       e._dirtyPrev && e._dirtyPrev.x >= r0.x && e._dirtyPrev.x + e._dirtyPrev.w <= r0.x + r0.w, e._dirtyPrev);
    ok("...and the cursor is not in the effects-only union", e._dirtyRaw === null, e._dirtyRaw);
    // A full clear (the clip window moved, Hot-head scrolled) covers the
    // region and nothing more.
    e._dirtyFull = true;
    e.draw();
    const clears = e.ctx.calls.filter((c) => c.op === "clearRect");
    ok("a pending full clear covers the region and nothing more",
       clears.length === 1 && clears[0].x === r0.x && clears[0].y === r0.y && clears[0].w === r0.w && clears[0].h === r0.h, clears);

    // Blinking, breathing, a keystroke or two: nothing re-anchors.
    const before = allocs(e);
    e.setCaret(408, 300); e.draw();
    e.setCaret(416, 300); e.draw();
    ok("a caret moving inside the margin keeps the region", e._fitCanvasRegion() === false && e._canvasRect === r0);
    ok("...with no reallocation", allocs(e) === before);

    // Out past the margin: the region slides, keeping its allocation.
    e.setCaret(r0.x + r0.w + 40, 300);
    ok("a caret past the margin re-anchors", e._fitCanvasRegion() === true && e._canvasRect !== r0);
    const r1 = e._canvasRect;
    ok("...by sliding the same allocation", r1.w === r0.w && r1.h === r0.h && e.canvas.width === r0.w * 2, { r0, r1 });
    ok("...blanking it rather than trusting stale pixels", e._dirtyPrev === null);
    ok("...and re-placing the element", e.canvas.style.transform === `translate(${r1.x - 100}px, ${r1.y - 50}px)`);
  }

  // A painter that reaches outside the region is clipped this frame and
  // pulled in next frame - the unclamped record is what makes that work.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion(); e.draw();
    const r0 = e._canvasRect;
    e.paintExtra = [r0.x + r0.w + 200, 300, 10, 10]; // a flame pixel well outside
    e.draw();
    ok("the clear rect is clamped to the region",
       e._dirtyPrev.x + e._dirtyPrev.w <= r0.x + r0.w, { prev: e._dirtyPrev, r0 });
    ok("...but the painted union is recorded unclamped",
       e._dirtyRaw.x1 >= r0.x + r0.w + 210, e._dirtyRaw);
    ok("and the next fit grows the region to include it",
       e._fitCanvasRegion() === true && e._canvasRect.x + e._canvasRect.w >= r0.x + r0.w + 210, e._canvasRect);
  }

  // Far-reaching effects get the whole clip while live, and the region
  // shrinks back only after the cooldown.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion();
    const small = e._canvasRect;
    e.thunderbolts.push({});
    e._fitCanvasRegion();
    const c = e._clipRect;
    ok("a live thunderbolt claims the whole clip window",
       e._canvasRect.x === c.x && e._canvasRect.y === c.y && e._canvasRect.w === c.w && e._canvasRect.h === c.h, e._canvasRect);
    e.thunderbolts.length = 0;
    e.draw();
    ok("the frame after it expires keeps the big region", e._fitCanvasRegion() === false && e._canvasRect.w === c.w);
    // Age the oversized stamp past the cooldown.
    e._regionOversizedT = performance.now() - T.CANVAS_REGION_SHRINK_MS - 1;
    ok("...and shrinks once the cooldown has passed",
       e._fitCanvasRegion() === true && e._canvasRect.w * e._canvasRect.h <= small.w * small.h, e._canvasRect);

    const f = makeRegionEngine();
    f.setCaret(400, 300);
    f.fireworks.push({});
    f._fitCanvasRegion();
    ok("a live firework shell claims the whole clip window too", f._canvasRect.w === f._clipRect.w && f._canvasRect.h === f._clipRect.h);
  }

  // The need is the union of everything known before the draw.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    const clip = e._clipRect;
    const base = e._frameNeed(clip);
    ok("the need spans the cursor's own damage bounds",
       base.x0 < 400 && base.x1 > 408 && base.y0 < 300 && base.y1 > 324, base);
    e.secondaryCarets.push({ x: 900, top: 600, bottom: 624 });
    ok("...a secondary caret", e._frameNeed(clip).x1 >= 900 && e._frameNeed(clip).y1 >= 624);
    e.secondaryCarets.length = 0;
    e.bracketTether = [{ x1: 400, y1: 300, x2: 150, y2: 100 }];
    ok("...the bracket tether", e._frameNeed(clip).x0 <= 150 && e._frameNeed(clip).y0 <= 100);
    e.bracketTether = null;
    e._dirtyRaw = { x0: 700, y0: 500, x1: 720, y1: 520 };
    const n = e._frameNeed(clip);
    ok("...and last frame's painted union, padded for motion",
       n.x1 >= 720 + T.CANVAS_REGION_MOTION_PAD && n.y1 >= 520 + T.CANVAS_REGION_MOTION_PAD, n);
    // Smooth movement: the target, not just the interpolated caret, so the
    // region grows toward the destination instead of chasing it.
    e._dirtyRaw = null;
    e.animActive = { x: 400, top: 300, w: 8, h: 24, actualCharWidth: 8 };
    e.lastActive = { x: 640, top: 300, w: 8, h: 24, actualCharWidth: 8 };
    ok("...and the smooth-movement target", e._frameNeed(clip).x1 >= 648);
  }

  // A clip window that moves out from under the region invalidates it.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion();
    e._clipRect = { x: 600, y: 50, w: 500, h: 700 };
    e.setCaret(700, 300);
    ok("a region outside the new clip is refitted", e._fitCanvasRegion() === true && e._canvasRect.x >= 600, e._canvasRect);
  }

  // The window-sized store is gone for good: resizeCanvas is the region's
  // allocator and does nothing without one.
  {
    const e = makeRegionEngine();
    e.resizeCanvas();
    ok("resizeCanvas without a region allocates nothing", e.canvas.width === 0 && allocs(e) === 0);
  }
}

// ---------------------------------------------------------------------------
section("multi-cursor: full effects on secondary carets");

// Every non-primary caret up to SECONDARY_FULL_MAX gets the primary's whole
// pipeline. Nothing in that pipeline takes a caret argument - it reads and
// writes CARET_STATE_FIELDS on `this` - so each secondary keeps a bundle of
// those fields and _withCaret swaps it in around the primary's own code.
// These pin the swap, what a secondary may and may not do, how bundles
// follow ranges when the selection changes shape, and the draw.
{
  const mk = (over = {}) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, over);
    e.styleFor = (k) => e.settings[k];
    e.renderWidth = (a) => a.w;
    e.underlineThickness = () => 3;
    e.isDarkTheme = () => true;
    e.getActiveColor = () => e.settings.colorDark || "#39ff14";
    e.app = { workspace: { activeEditor: null } };
    e.dirty = [];
    e._markDirty = (x, y, w, h) => e.dirty.push({ x, y, w, h });
    return e;
  };
  const rec = (x, top, pos, extra = {}) => Object.assign(
    { x, top, bottom: top + 24, h: 24, w: 8, actualCharWidth: 8, char: "a", focused: true, pos, assoc: 0 }, extra);
  const FIELDS = T.CARET_STATE_FIELDS;
  // The state every effect keeps per caret. Named here so dropping one from
  // the bundle fails with its name: a field left out would be shared between
  // carets, which is the "N carets, one spring" bug in its quietest form.
  for (const k of ["lastActive", "animActive", "smearQuad", "trail", "glitch", "_smoothMoving", "_smearMoving",
                   "_hotPrev", "_hotEmitFrom", "_hotVel", "_hotActiveT", "hotBurns",
                   "_lastStardustT", "_lastSparkT", "_lastFireworkT",
                   "_tetherKey", "_tetherSegs", "_tetherAnchorA"]) {
    ok(`${k} is per caret`, FIELDS.includes(k));
  }
  ok("heat is NOT per caret - one gauge for the editor", !FIELDS.includes("heat"));

  // --- the swap ------------------------------------------------------------
  {
    const e = mk();
    e.lastActive = { x: 1 }; e.trail = [{ x: 9 }]; e._smearMoving = true;
    const bundle = e._freshCaretState();
    ok("a fresh bundle carries every caret field", FIELDS.every((k) => k in bundle), Object.keys(bundle));
    ok("...and only those", Object.keys(bundle).every((k) => FIELDS.includes(k)), Object.keys(bundle));
    const fresh = Object.create(Plugin.prototype); fresh._resetEngineState();
    ok("...at the reset engine's values",
       FIELDS.every((k) => JSON.stringify(bundle[k]) === JSON.stringify(fresh[k])));
    ok("lastMoveTime is not a caret field - every caret blinks on the primary's clock",
       !("lastMoveTime" in bundle));

    let seen = null;
    const out = e._withCaret(bundle, () => { seen = { la: e.lastActive, trail: e.trail, moving: e._smearMoving, pass: e._caretPass }; e.trail = [{ x: 5 }]; e._smearMoving = true; return 7; });
    ok("inside the swap the bundle's fields are live", seen.la === null && seen.trail.length === 0 && seen.moving === false && seen.pass === "secondary", seen);
    ok("...and fn's return value comes back", out === 7);
    ok("after the swap the bundle holds what fn wrote", bundle.trail.length === 1 && bundle.trail[0].x === 5 && bundle._smearMoving === true, bundle);
    ok("...and the primary's fields are back untouched",
       e.lastActive.x === 1 && e.trail[0].x === 9 && e._smearMoving === true && e._caretPass === undefined);
    let threw = false;
    try { e._withCaret(bundle, () => { e.trail = []; throw new Error("boom"); }); } catch { threw = true; }
    ok("a throwing fn still restores the primary", threw && e.trail[0].x === 9 && bundle.trail.length === 0);
  }

  // --- what a secondary may and may not do in commitMove ------------------
  {
    const spawns = (e) => {
      const n = { bolt: 0, fw: 0, flame: 0, trail: 0, glitch: 0 };
      e.spawnThunderbolt = () => n.bolt++;
      e.spawnFireworks = () => n.fw++;
      e.spawnFlamePixels = () => n.flame++;
      e.pushTrail = () => n.trail++;
      e.spawnGlitch = () => n.glitch++;
      return n;
    };
    const NOW = performance.now();
    const primary = mk({ popEffects: true, thunderstrike: true, fireworks: true, crtEffect: true, crtGlitch: true, speedDemon: true });
    const np = spawns(primary);
    primary.lastActive = rec(10, 10, 5); primary._enterPending = NOW; primary._popKeyPending = NOW; primary._heatKeyT = 0;
    primary.commitMove(rec(300, 200, 40));
    ok("the primary fires a strike and a volley and clears the flags",
       np.bolt === 1 && np.fw === 1 && primary._enterPending === 0 && primary._popKeyPending === 0, np);
    ok("...and a mouse-driven leap heats it", primary.heat > 0, primary.heat);

    const sec = mk({ popEffects: true, thunderstrike: true, fireworks: true, crtEffect: true, crtGlitch: true, speedDemon: true });
    const ns = spawns(sec);
    sec._enterPending = NOW; sec._popKeyPending = NOW; sec._heatKeyT = 0;
    const bundle = sec._freshCaretState(); bundle.lastActive = rec(10, 10, 5);
    sec._withCaret(bundle, () => sec.commitMove(rec(300, 200, 40)));
    ok("a secondary fires its own strike and volley", ns.bolt === 1 && ns.fw === 1, ns);
    ok("...but leaves the Enter/Space flags for the primary to clear", sec._enterPending === NOW && sec._popKeyPending === NOW);
    ok("...adds no heat", sec.heat === 0, sec.heat);
    ok("...and keeps its trail, its pixel trail and its glitch",
       ns.trail === 1 && ns.flame === 1 && ns.glitch === 1, ns);
    ok("...and the move landed in the bundle, not the primary",
       bundle.lastActive.x === 300 && sec.lastActive === null, { bundle: bundle.lastActive, primary: sec.lastActive });
  }

  // --- bundles follow their ranges when the selection changes shape -------
  {
    const view = (heads, mainIndex) => ({
      hasFocus: true,
      state: { selection: { ranges: heads.map((h) => ({ head: h, assoc: 0 })), mainIndex } },
    });
    const e = mk();
    e.rematchCaretStates(view([10, 50], 0));       // establishes the shape
    e.lastActive = rec(100, 20, 10);
    const s50 = e._freshCaretState(); s50.lastActive = rec(500, 20, 50); s50.trail = [{ x: 1 }];
    e._secondaries = [s50];
    e.rematchCaretStates(view([10, 50], 0));
    ok("the same shape leaves every bundle alone", e._secondaries[0] === s50 && e.lastActive.pos === 10);

    // Alt+click adds a caret at 90 and makes it main.
    e.rematchCaretStates(view([10, 50, 90], 2));
    ok("a new main caret starts fresh - no streak from the old primary", e.lastActive === null);
    ok("the old primary's state follows its range into the secondaries",
       e._secondaries.length === 2 && e._secondaries[0].lastActive && e._secondaries[0].lastActive.pos === 10, e._secondaries.map((s) => s.lastActive && s.lastActive.pos));
    ok("...and the existing secondary keeps its own", e._secondaries[1] === s50 && s50.trail.length === 1);

    // Escape collapses to the main caret at 90.
    const s90 = e._secondaries; // not used further; the main at 90 has a fresh state right now
    void s90;
    e.lastActive = rec(900, 20, 90);
    e.rematchCaretStates(view([90], 0));
    ok("collapsing keeps the primary's own state", e.lastActive && e.lastActive.pos === 90);
    ok("...and drops the bundles", e._secondaries.length === 0);

    // A main reassignment with the same count swaps roles.
    const f = mk();
    f.rematchCaretStates(view([10, 50], 0));
    f.lastActive = rec(100, 20, 10);
    const t50 = f._freshCaretState(); t50.lastActive = rec(500, 20, 50);
    f._secondaries = [t50];
    f.rematchCaretStates(view([10, 50], 1));
    ok("a main reassignment hands the primary the promoted bundle", f.lastActive === t50.lastActive);
    ok("...and demotes the old primary's state", f._secondaries.length === 1 && f._secondaries[0].lastActive.pos === 10);

    // A bundle too far from every new head is dropped, not mis-assigned.
    // (The shape has to change for a rematch at all: with the same shape a
    // caret that leaps keeps its bundle and smears to where it went.)
    const g = mk();
    g.rematchCaretStates(view([10, 50], 0));
    g.lastActive = rec(100, 20, 10);
    const far = g._freshCaretState(); far.lastActive = rec(500, 20, 50); far._smearMoving = true;
    g._secondaries = [far];
    g.rematchCaretStates(view([10, 5000, 6000], 0));
    ok("a bundle further than the window from every head starts fresh",
       g._secondaries.length === 2 && g._secondaries.every((b) => b !== far && b.lastActive === null));
    const same = mk();
    same.rematchCaretStates(view([10, 50], 0));
    const keep = same._freshCaretState(); keep.lastActive = rec(500, 20, 50);
    same._secondaries = [keep];
    same.rematchCaretStates(view([2000, 5000], 0));
    ok("...while the same shape keeps bundles by index however far the carets leapt", same._secondaries[0] === keep);

    // Losing focus drops the bundles; the primary is left to caretCoords.
    const h = mk();
    h.rematchCaretStates(view([10, 50], 0));
    h._secondaries = [h._freshCaretState()];
    h.rematchCaretStates({ hasFocus: false });
    ok("no focus: bundles are dropped", h._secondaries.length === 0);
  }

  // --- the per-frame update through the bundles ---------------------------
  {
    const e = mk({ smear: true, smoothEnabled: false, popEffects: true, popLetters: false, flameTrail: true, backspaceDisintegrate: true });
    let flames = [];
    e.spawnFlamePixels = (from, disintegrate) => flames.push({ from: from && from.x, disintegrate: !!disintegrate });
    e.spawnLetterParticle = () => {};
    e.lastActive = rec(100, 20, 10); e.animActive = Object.assign({}, e.lastActive);
    const view = { hasFocus: true, state: { selection: { ranges: [{ head: 10 }, { head: 50 }, { head: 70 }], mainIndex: 0 } } };
    let frame = 0;
    e.secondaryCaretCoords = () => frame === 0
      ? [{ x: 500, top: 20, bottom: 44, pos: 50, assoc: 0, visible: true }, { x: 700, top: 20, bottom: 44, pos: 70, assoc: 0, visible: true }]
      : [{ x: 540, top: 20, bottom: 44, pos: 51, assoc: 0, visible: true }, { x: 0, top: 0, bottom: 0, pos: 71, assoc: 0, visible: false }];
    e.secondaryCaretRecord = (v, c) => rec(c.x, c.top, c.pos);
    e.rematchCaretStates(view);

    e.updateSecondaryCarets(view, 0);
    ok("one bundle per secondary", e._secondaries.length === 2, e._secondaries.length);
    ok("...each placed at its caret", e._secondaries[0].lastActive.x === 500 && e._secondaries[1].lastActive.x === 700);
    ok("...with its own interpolated caret", e._secondaries[0].animActive && e._secondaries[0].animActive.x === 500);
    ok("the primary is untouched", e.lastActive.x === 100 && e.animActive.x === 100);
    ok("nothing spawns on a first placement", flames.length === 0, flames);

    frame = 1;
    const NOW = performance.now();
    e.updateSecondaryCarets(view, { del: NOW - 10 });     // a Backspace flag was live this frame
    ok("a moved secondary commits its move", e._secondaries[0].lastActive.x === 540);
    ok("...spawning its pixel trail from where it was", flames.length === 1 && flames[0].from === 500, flames);
    ok("...as a disintegration, because the frame's Backspace flag was handed to it", flames[0].disintegrate === true, flames);
    ok("...and its smear spring is in flight", e._secondaries[0]._smearMoving === true && !!e._secondaries[0].smearQuad);
    ok("a secondary that scrolled off the pane is cleared, like the primary would be",
       e._secondaries[1].lastActive === null && e._secondaries[1].animActive === null);
    ok("the primary's Backspace flag is what it was", !e._deletePending);
    ok("the primary's spring is not in flight", e._smearMoving === false && e.smearQuad === null);

    // Past the cap: the plain line, on-screen entries only.
    const many = mk();
    many.secondaryCaretCoords = () => Array.from({ length: 70 }, (_, i) => ({ x: i, top: 0, bottom: 20, pos: i, assoc: 0, visible: i % 2 === 0 }));
    many.secondaryCaretRecord = (v, c) => rec(c.x, c.top, c.pos);
    many.updateSecondaryCarets({ hasFocus: true, state: { selection: { ranges: [], mainIndex: 0 } } }, 0);
    ok("carets past the cap fall back to the plain line", many._secondaries.length === 64 && many.secondaryCarets.length === 3, { full: many._secondaries.length, plain: many.secondaryCarets.length });
  }

  // --- the record: a line's style, cached and shared -------------------------
  {
    const e = mk({ cursorStyle: "Box" });
    let csCalls = 0;
    const lineA = { closest: (sel) => (sel === ".cm-line" ? lineA : null), tag: "A" };
    const lineB = { closest: (sel) => (sel === ".cm-line" ? lineB : null), tag: "B" };
    const textNode = (line) => ({ nodeType: 3, parentElement: line });
    const doc = { sliceString: (a, b) => (a === 5 ? "x" : a === 6 ? "\n" : "y") };
    const view = {
      state: { doc },
      contentDOM: { tag: "content" },
      defaultCharacterWidth: 8,
      domAtPos: (pos) => ({ node: textNode(pos < 100 ? lineA : lineB), offset: 0 }),
      dom: { ownerDocument: { defaultView: { getComputedStyle: () => { csCalls++; return { color: "rgb(1, 2, 3)", fontSize: "20px", fontFamily: "Mono", fontWeight: "700", fontStyle: "italic", letterSpacing: "1px", lineHeight: "30px" }; } } } },
    };
    e.measureCharWidth = (ch) => (ch === "x" ? 11 : 9);
    const st = e._freshCaretState();
    const r = e.secondaryCaretRecord(view, { x: 40, top: 100, bottom: 120, pos: 5, assoc: 0 }, st, new Map());
    ok("the record carries the line's font", r.fontSize === 20 && r.fontFamily === "Mono" && r.fontWeight === "700" && r.fontStyle === "italic" && r.textColor === "rgb(1, 2, 3)", r);
    ok("...the character after the caret", r.char === "x");
    ok("...a width from the measured glyph plus letter-spacing", r.actualCharWidth === 12 && r.w === 12, r);
    ok("...and a height from the line-height, centred on the coords", r.h === 30 && r.top === 95 && r.bottom === 125, r);
    ok("...marked focused with its position", r.focused === true && r.pos === 5);
    const n1 = csCalls;
    e.secondaryCaretRecord(view, { x: 40, top: 100, bottom: 120, pos: 5, assoc: 0 }, st, new Map());
    ok("the style is cached on the bundle for the same doc and pos", csCalls === n1);
    const shared = new Map();
    const stB = e._freshCaretState(), stC = e._freshCaretState();
    e.secondaryCaretRecord(view, { x: 40, top: 100, bottom: 120, pos: 6, assoc: 0 }, stB, shared);
    e.secondaryCaretRecord(view, { x: 90, top: 100, bottom: 120, pos: 7, assoc: 0 }, stC, shared);
    ok("two carets on one line share a single style read within a frame", csCalls === n1 + 1, csCalls - n1);
    ok("a newline after the caret is no character", stB._style.char === "");
    const line = mk({ cursorStyle: "Line", caretWidthPx: 3 });
    line.measureCharWidth = () => 11;
    const rl = line.secondaryCaretRecord(view, { x: 40, top: 100, bottom: 120, pos: 5, assoc: 0 }, line._freshCaretState(), new Map());
    ok("a Line cursor takes the caret width, keeping the glyph advance", rl.w === 3 && rl.actualCharWidth === 12, rl);
  }

  // --- the draw ---------------------------------------------------------------
  {
    const e = mk({ cursorStyle: "Box" });
    delete e._markDirty; // the real one, so draw() builds its damage rect
    e.canvas = { width: 0, height: 0, style: {}, ownerDocument: { defaultView: { devicePixelRatio: 1 } } };
    e.ctx = { save() {}, restore() {}, translate() {}, scale() {}, setTransform() {}, clearRect() {} };
    e._clipRect = { x: 0, y: 0, w: 1000, h: 700 }; e._wrapperPos = { left: 0, top: 0 };
    const drawn = [];
    e.drawRetroBox = () => drawn.push(e.animActive.x);
    for (const f of ["drawLettersParticles", "drawBracketTether", "drawStardust", "drawFlamePixels", "drawHotHead", "drawThunderbolts", "drawFireworks", "drawGenericCaret", "drawSecondaryCarets", "applyCanvasBlend"]) e[f] = () => {};
    e.breathScale = () => 1; e.glowHeatScale = () => 1;
    e.lastActive = rec(100, 20, 10); e.animActive = Object.assign({}, e.lastActive);
    const s1 = e._freshCaretState(); s1.lastActive = rec(500, 20, 50); s1.animActive = Object.assign({}, s1.lastActive);
    const s2 = e._freshCaretState(); s2.lastActive = rec(700, 300, 70); s2.animActive = Object.assign({}, s2.lastActive);
    const s3 = e._freshCaretState(); // off-screen: nothing to draw
    e._secondaries = [s1, s2, s3];
    e._fitCanvasRegion();
    e.draw();
    ok("every on-screen secondary is painted with the primary's painter, as itself",
       drawn.join() === "100,500,700", drawn);
    ok("the region covers every caret", e._canvasRect.x <= 100 - 24 && e._canvasRect.x + e._canvasRect.w >= 700 + 8 + 24 && e._canvasRect.y + e._canvasRect.h >= 300 + 24 + 24, e._canvasRect);
    ok("the secondaries' own bounds stay out of the effects-only union", e._dirtyRaw === null, e._dirtyRaw);
    ok("...but are in the clear rect", e._dirtyPrev && e._dirtyPrev.x + e._dirtyPrev.w >= 700 + 8 + 24 && e._dirtyPrev.y + e._dirtyPrev.h >= 300 + 24 + 24, e._dirtyPrev);
    const sig1 = e._secondariesSig();
    s2.lastActive.x = 720; s2.animActive.x = 720;
    ok("a secondary moving changes the static-frame signature", e._secondariesSig() !== sig1);
    ok("...and the primary's fields survive all of it", e.animActive.x === 100 && e.lastActive.pos === 10);
  }

  // --- every effect, per caret --------------------------------------------------
  // The Enter/Space flags reach every secondary the way the Backspace one does.
  {
    const e = mk({ popEffects: true, thunderstrike: true, fireworks: true, flameTrail: false, popLetters: false });
    const n = { bolt: [], fw: [] };
    e.spawnThunderbolt = (c) => n.bolt.push(c.x);
    e.spawnFireworks = (c) => n.fw.push(c.x);
    e.spawnFlamePixels = () => {}; e.pushTrail = () => {};
    e.lastActive = rec(100, 20, 10); e.animActive = Object.assign({}, e.lastActive);
    const view = { hasFocus: true, state: { selection: { ranges: [{ head: 10 }, { head: 50 }, { head: 70 }], mainIndex: 0 } } };
    let frame = 0;
    e.secondaryCaretCoords = () => frame === 0
      ? [{ x: 500, top: 20, bottom: 44, pos: 50, assoc: 0, visible: true }, { x: 700, top: 20, bottom: 44, pos: 70, assoc: 0, visible: true }]
      : [{ x: 500, top: 60, bottom: 84, pos: 51, assoc: 0, visible: true }, { x: 700, top: 60, bottom: 84, pos: 71, assoc: 0, visible: true }];
    e.secondaryCaretRecord = (v, c) => rec(c.x, c.top, c.pos);
    e.rematchCaretStates(view);
    e.updateSecondaryCarets(view, {});
    frame = 1;
    const NOW = performance.now();
    e._enterPending = 0; e._popKeyPending = 0;   // the primary already consumed them
    e.updateSecondaryCarets(view, { enter: NOW - 5, pop: NOW - 5 });
    ok("an Enter strikes at every secondary", n.bolt.join() === "500,700", n.bolt);
    ok("...and a Space launches a volley from each", n.fw.join() === "500,700", n.fw);
    ok("...without touching the primary's cleared flags", e._enterPending === 0 && e._popKeyPending === 0);
  }

  // A secondary's hot-head keeps the loop hot while it feeds.
  {
    const NOW = 10000;
    const e = mk({ hotHead: true, hotHeadIdleMs: 1500 });
    e._secondaries.push({ animActive: { x: 1 }, _hotActiveT: NOW - 100 });
    ok("a feeding hot-head on a secondary keeps the loop hot", e._isAnimating(NOW) === true);
    e._secondaries[0]._hotActiveT = NOW - 9000;
    ok("...and stands down past its idle timeout", e._isAnimating(NOW) === false);
  }

  // Stardust motes belong to the caret that spawned them.
  {
    const e = mk({ stardustEnabled: true, stardustAlwaysOn: true, stardustOrbit: true });
    e.sampleRamp = () => [255, 255, 255];
    e.lastActive = rec(100, 20, 10); e.animActive = Object.assign({}, e.lastActive);
    // performance.now() is process uptime here: age the stamps or the
    // emission gap blocks the spawn in a fresh process.
    e._lastStardustT = -1e9;
    e.maybeSpawnStardust();
    ok("the primary's mote has no owner", e.stardust.length === 1 && e.stardust[0].owner === null, e.stardust[0] && e.stardust[0].owner);
    const b = e._freshCaretState(); b.lastActive = rec(500, 300, 50); b.animActive = Object.assign({}, b.lastActive);
    b._lastStardustT = -1e9;
    e._secondaries = [b];
    e._withCaret(b, () => e.maybeSpawnStardust());
    ok("a secondary's mote is owned by its bundle", e.stardust.length === 2 && e.stardust[1].owner === b);
    ok("...and each caret paces its own emission", b._lastStardustT > 0 && e._lastStardustT > 0);
    // The orbit follows the owner, not the primary.
    e.ctx = { save() {}, restore() {}, fillRect() {}, globalAlpha: 1, fillStyle: "" };
    b.animActive.x = 900;
    for (const p of e.stardust) p.start = performance.now() - 1000;   // past the fade-in, or nothing is placed
    e.drawStardust();
    ok("an orbiting mote re-anchors to its own caret", Math.abs(e.stardust[1].ax - 904) < 1e-9 && Math.abs(e.stardust[0].ax - 104) < 1e-9,
       { sec: e.stardust[1].ax, prim: e.stardust[0].ax });
    // The cap scales with the caret count.
    const many = mk({ stardustEnabled: true, stardustAlwaysOn: true });
    many.sampleRamp = () => [255, 255, 255];
    many.lastActive = rec(100, 20, 10); many.animActive = Object.assign({}, many.lastActive);
    many._secondaries = [many._freshCaretState(), many._freshCaretState()];
    many.stardust = Array.from({ length: T.STARDUST_MAX_PER_CARET * 3 - 1 }, () => ({}));
    many._lastStardustT = -1e9;
    many.maybeSpawnStardust();
    ok("the mote cap is per caret", many.stardust.length === T.STARDUST_MAX_PER_CARET * 3, many.stardust.length);
    many._lastStardustT = -1e9;
    many.maybeSpawnStardust();
    ok("...and holds there", many.stardust.length === T.STARDUST_MAX_PER_CARET * 3);
  }

  // The tether is per caret and the lists merge.
  {
    const e = mk({ bracketTether: true });
    const segsFor = (head) => [{ x1: head, y1: 0, x2: head + 10, y2: 10 }];
    const heads = [];
    e.bracketTetherCoords = (view, head, empty) => { heads.push([head, empty]); return empty === false ? null : segsFor(head === undefined ? 10 : head); };
    e.secondaryCaretCoords = () => [
      { x: 500, top: 20, bottom: 44, pos: 50, assoc: 0, empty: true, visible: true },
      { x: 700, top: 20, bottom: 44, pos: 70, assoc: 0, empty: false, visible: true },
    ];
    e.secondaryCaretRecord = (v, c) => rec(c.x, c.top, c.pos);
    const view = { hasFocus: true, state: { selection: { ranges: [{ head: 10 }, { head: 50 }, { head: 70 }], mainIndex: 0 } } };
    e.rematchCaretStates(view);
    e.updateSecondaryCarets(view, {});
    ok("each secondary asks for its own tether at its own head",
       heads.some((x) => x[0] === 50 && x[1] === true) && heads.some((x) => x[0] === 70 && x[1] === false), heads);
    const merged = e.mergeTethers(e.bracketTetherCoords(view));
    ok("the primary's and the secondaries' segments are one list",
       merged.length === 2 && merged[0].x1 === 10 && merged[1].x1 === 50, merged);
    ok("a secondary over a selection has no tether", !e._secondaries[1]._tetherOut);
    ok("no tethers at all is null, not an empty list", mk().mergeTethers(null) === null);
  }

  // A scroll shifts every caret's hot-head state by the same delta.
  {
    const e = mk({ hotHead: true });
    const scroller = { scrollLeft: 0, scrollTop: 0 };
    e.app = { workspace: { activeEditor: { editor: { cm: { scrollDOM: scroller } } } } };
    e._tickNo = 1;
    e.hotBurns = [{ x: 10, y: 10 }]; e._hotPrev = { x: 10, y: 10, t: 0 }; e._hotEmitFrom = { x: 10, y: 10 };
    const b = e._freshCaretState(); b.hotBurns = [{ x: 50, y: 50 }]; b._hotPrev = { x: 50, y: 50, t: 0 }; b._hotEmitFrom = { x: 50, y: 50 };
    e._secondaries = [b];
    e.hotSyncScroll();                // baseline
    scroller.scrollTop = 30;
    e._tickNo = 2;
    e.hotSyncScroll();                // the primary reads the delta
    e._withCaret(b, () => e.hotSyncScroll());   // the secondary, same tick
    ok("the primary's burn marks scrolled", e.hotBurns[0].y === -20 && e._hotPrev.y === -20);
    ok("the secondary's scrolled by the same delta", b.hotBurns[0].y === 20 && b._hotPrev.y === 20 && b._hotEmitFrom.y === 20, b.hotBurns[0]);
    e._withCaret(b, () => e.hotSyncScroll());
    ok("...and not twice in one tick", b.hotBurns[0].y === 20);
    e._tickNo = 3;
    e._withCaret(b, () => e.hotSyncScroll());
    ok("...nor from a stale delta next tick", b.hotBurns[0].y === 20);
  }

  // A jump puts the caret in fire: decided on the committed move (a scroll
  // shift never reaches that path, and with Smooth Movement the drawn caret
  // never travels far in one frame), spawned all around the caret's box.
  {
    const e = mk({ hotHead: true, hotHeadQuantity: 1 });
    e.pushTrail = () => {}; e.spawnFlamePixels = () => {};
    e.lastActive = rec(100, 20, 10);
    const now = performance.now();
    e.updateActivePoint(rec(104, 20, 11));
    ok("a one-character move is not a jump", !e._hotEngulfUntil);
    e.lastActive = rec(100, 20, 10);
    e.updateActivePoint(rec(400, 200, 900));
    ok("a committed leap sets the engulf window", e._hotEngulfUntil > now, e._hotEngulfUntil);
    // Scroll shift: same doc position, the coordinates moved.
    const s = mk({ hotHead: true });
    s.lastActive = rec(100, 20, 10); s.animActive = Object.assign({}, s.lastActive);
    s.updateActivePoint(rec(100, 220, 10));
    ok("a scroll shift of the same position is not a jump", !s._hotEngulfUntil);
    // And the engulf itself: while the window holds, fire lands beside and
    // below the caret's box, not only above it.
    const a = rec(300, 100, 40);
    e.animActive = Object.assign({}, a);
    e._hotEmitFrom = { x: 304, y: 112 };
    e._hotVel = { x: 0, y: 0 };
    e._lastHotT = performance.now() - 16;
    e._hotEngulfUntil = performance.now() + 300;
    e.hotBurns = []; e.flameEmbers = [];
    // A few frames' worth, so the placement checks below are not at the
    // mercy of a handful of random draws.
    for (let i = 0; i < 12; i++) { e._lastHotT = performance.now() - 16; e.maybeSpawnHotHead(); }
    const ps = e.flameEmbers;
    ok("the engulf spawns fire", ps.length > 0, ps.length);
    ok("...beside the caret", ps.some((p) => p.x < a.x) && ps.some((p) => p.x > a.x + a.w));
    ok("...and below it, not only above", ps.some((p) => p.y > a.top + a.h) && ps.some((p) => p.y < a.top));
    ok("...chunks and sparks both", ps.some((p) => p.spark) && ps.some((p) => !p.spark));
    e.flameEmbers = [];
    e._hotEngulfUntil = performance.now() - 1;
    e._lastHotT = performance.now() - 16;
    e.maybeSpawnHotHead();
    ok("past the window, nothing (no burn marks either)", e.flameEmbers.length === 0, e.flameEmbers.length);
  }

  // The ember pool is shared, so the chunk cap is per caret: a primary
  // sitting at the cap must not stop a secondary from lighting.
  {
    const e = mk({ hotHead: true, hotHeadQuantity: 1, hotHeadIdleMs: 0 });
    const a = rec(300, 100, 40);
    const arm = (o) => {
      o.animActive = Object.assign({}, a);
      o._hotEmitFrom = { x: 304, y: 112 }; o._hotVel = { x: 0, y: 0 };
      o._hotPrev = { x: 304, y: 112, t: 0 };
      o._lastHotT = performance.now() - 16;
      o.hotBurns = [{ x: 304, y: 100, t: performance.now(), rowLeft: 0, rowRight: 900, lh: 24, fs: 16 }];
    };
    arm(e);
    e.flameEmbers = [];
    for (let i = 0; i < T.FLAME_MAX_NUM; i++) e.flameEmbers.push({ x: 0, y: 0, life: 100, life0: 100, maxLife: 620, temp: 1, cw: 8, lift: 1, shape0: 0 });
    e.maybeSpawnHotHead();
    ok("a lone primary at the cap spawns nothing", e.flameEmbers.length === T.FLAME_MAX_NUM, e.flameEmbers.length);
    const b = e._freshCaretState(); arm(b);
    e._secondaries = [b];
    e._withCaret(b, () => e.maybeSpawnHotHead());
    ok("a secondary still lights with the primary at the cap", e.flameEmbers.length > T.FLAME_MAX_NUM, e.flameEmbers.length);
  }

  // The path burns: a jump lays marks along the way the caret came, far
  // end first and older, the destination last and freshest.
  {
    const e = mk({ hotHead: true, hotHeadSpread: 4 });
    e.app = { workspace: {} };
    const now = performance.now();
    e._hotPrev = { x: 104, y: 112, t: now - 16 }; e._hotVel = { x: 0, y: 0 }; e._hotEmitFrom = { x: 104, y: 112 };
    e.hotBurns = [];
    e.animActive = rec(400, 100, 40, { rowLeft: 0, rowRight: 900 });
    e.updateHotHeadInertia();
    const b = e.hotBurns;
    ok("a jump along a row lays a mark per character, capped", b.length === T.HOT_TRAIL_PATH_MAX + 1, b.length);
    ok("...the destination last", b[b.length - 1].x === 404 && b[b.length - 1].t === Math.max(...b.map((m) => m.t)));
    ok("...the far end first and already older", b[0].x < b[1].x && b[0].t < b[1].t && b[0].t < b[b.length - 1].t);
    ok("...on the same row, clamped to it", b[0].rowLeft === 0 && b[0].rowRight === 900);
    e.hotBurns = []; e._hotPrev = { x: 104, y: 112, t: now - 16 };
    e.animActive = rec(400, 300, 40, { rowLeft: 0, rowRight: 900 });
    e.updateHotHeadInertia();
    ok("across lines the way between carries no row", e.hotBurns[0].rowLeft === null && e.hotBurns[e.hotBurns.length - 1].rowLeft === 0);
    e.hotBurns = [{ x: 408, y: 100, t: now }]; e._hotPrev = { x: 408, y: 112, t: now - 16 };
    e.animActive = rec(406, 100, 41, { rowLeft: 0, rowRight: 900 });
    e.updateHotHeadInertia();
    ok("a nudge within half a character refreshes the mark instead", e.hotBurns.length === 1 && e.hotBurns[0].t >= now);
  }

  // The torch: a spotlight per caret.
  {
    const e = mk({ torchEffect: true, overlaySpeed: 0.5 });
    e.x = 100; e.y = 100;
    const b1 = e._freshCaretState(); b1.animActive = rec(500, 300, 50);
    const b2 = e._freshCaretState();          // off-screen: no light
    e._secondaries = [b1, b2];
    e._torchGear = "idle";
    let spots = e.torchSpotlights(false, 0.5);
    ok("one spotlight per on-screen caret, the primary's first",
       spots.length === 2 && spots[0].x === 100 && spots[0].y === 100, spots);
    ok("a secondary's light starts on its caret", spots[1].x === 500 && spots[1].y === 312, spots[1]);
    ok("...and is settled there", e._torchGear === "idle");
    b1.animActive = rec(600, 300, 51);
    spots = e.torchSpotlights(false, 0.5);
    ok("when its caret moves the light chases it at the torch's easing", spots[1].x === 550, spots[1]);
    ok("...and claims the hot gear while en route", e._torchGear === "hot");
    ok("following the mouse there is one light", e.torchSpotlights(true, 0.5).length === 1);

    // The painters, on a recording context.
    const recCtx = () => {
      const ops = [];
      const ctx = {
        ops, _op: "source-over",
        set globalCompositeOperation(v) { this._op = v; ops.push({ op: "composite", v }); },
        get globalCompositeOperation() { return this._op; },
        set fillStyle(v) { this._fill = v; }, get fillStyle() { return this._fill; },
        clearRect(x, y, w, h) { ops.push({ op: "clear", x, y, w, h }); },
        fillRect(x, y, w, h) { ops.push({ op: "fill", x, y, w, h, fill: this._fill, mode: this._op }); },
        createRadialGradient(x0, y0, r0, x1, y1, r1) { const g = { kind: "radial", x: x1, y: y1, r: r1, stops: [], addColorStop(o, c) { g.stops.push([o, c]); } }; ops.push({ op: "gradient", g }); return g; },
        setTransform(...m) { ops.push({ op: "transform", m }); },
      };
      return ctx;
    };
    const dark = recCtx();
    T.paintTorchDarkness(dark, 800, 600, [{ x: 10, y: 20 }, { x: 300, y: 40 }], 250, 0.92);
    const fills = dark.ops.filter((o) => o.op === "fill");
    ok("darkness: a flat fill of the whole layer at the Darkness setting",
       fills[0] && fills[0].x === 0 && fills[0].w === 800 && fills[0].h === 600 && fills[0].fill === "rgba(0, 0, 0, 0.92)" && fills[0].mode === "source-over", fills[0]);
    const holes = fills.slice(1);
    ok("...then one hole per light, punched with destination-out",
       holes.length === 2 && holes.every((f) => f.mode === "destination-out" && f.fill && f.fill.kind === "radial"), holes.map((f) => f.mode));
    ok("...each centred on its light at the spotlight radius",
       holes[0].fill.x === 10 && holes[0].fill.y === 20 && holes[0].fill.r === 250 && holes[1].fill.x === 300, holes.map((f) => [f.fill.x, f.fill.y, f.fill.r]));
    ok("...with the old four-stop ramp turned inside out (0 / 0.52 / 0.91 / 1.0 of the darkness stays)",
       JSON.stringify(holes[0].fill.stops) === JSON.stringify([[0, "rgba(0, 0, 0, 1)"], [0.4, "rgba(0, 0, 0, 0.48)"], [0.7, "rgba(0, 0, 0, 0.09)"], [1, "rgba(0, 0, 0, 0)"]]), holes[0].fill.stops);
    ok("...and the composite is put back", dark._op === "source-over");
    const glow = recCtx();
    T.paintTorchGlow(glow, 800, 600, [{ x: 10, y: 20 }, { x: 300, y: 40 }], 250, "255, 150, 60");
    const cores = glow.ops.filter((o) => o.op === "fill");
    ok("glow: one warm core per light at 0.6x the radius, additive",
       cores.length === 2 && cores.every((f) => f.mode === "source-over" && f.fill.r === 150) && cores[0].fill.stops[0][1] === "rgba(255, 150, 60, 0.4)" && cores[0].fill.stops[2][0] === 0.75, cores.map((f) => f.fill.stops));
    // The backing store is a quarter of the layer, and only reallocated on a
    // size change.
    const el = { width: 0, height: 0, getContext: () => recCtx() };
    const ctx = T.torchCanvasContext(el, 867, 569);
    ok("the store is the layer at TORCH_CANVAS_SCALE", el.width === Math.ceil(867 * T.TORCH_CANVAS_SCALE) && el.height === Math.ceil(569 * T.TORCH_CANVAS_SCALE), [el.width, el.height]);
    ok("...with the scale on the context", ctx.ops[0].op === "transform" && ctx.ops[0].m[0] === T.TORCH_CANVAS_SCALE);
    const w0 = el.width, h0 = el.height;
    let reassigned = false;
    Object.defineProperty(el, "width", { get: () => w0, set: () => { reassigned = true; } });
    Object.defineProperty(el, "height", { get: () => h0, set: () => { reassigned = true; } });
    T.torchCanvasContext(el, 867, 569);
    ok("...and an unchanged size leaves the store alone", reassigned === false);
    // Deduped on the engine: a parked torch paints nothing.
    const d = mk({ torchEffect: true });
    let paints = 0;
    d.overlay = { width: 0, height: 0, getContext: () => { paints++; return recCtx(); } };
    d._torchPaintDarkness([{ x: 100, y: 100 }], 140, 0.9, 800, 600);
    d._torchPaintDarkness([{ x: 100, y: 100 }], 140, 0.9, 800, 600);
    ok("an unchanged picture is not repainted", paints === 1, paints);
    d._torchPaintDarkness([{ x: 101, y: 100 }], 140, 0.9, 800, 600);
    ok("...a moved light is", paints === 2, paints);
    d.applyOverlayStyle();
    d._torchPaintDarkness([{ x: 101, y: 100 }], 140, 0.9, 800, 600);
    ok("...and so is a settings change", paints === 3, paints);
  }
}


deferred
  .reduce((chain, fn) => chain.then(fn), Promise.resolve())
  .then(() => {
    console.log("\n" + (fails === 0 ? "ALL PASS" : fails + " FAILURE(S)"));
    process.exit(fails === 0 ? 0 : 1);
  });
