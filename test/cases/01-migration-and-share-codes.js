// migration, share codes, defaults, the starter preset, removed keys, disintegration's regrouping.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

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

ok("popEffects defaults on (matches old popLetters default)", D.popEffects === true);
ok("popLetters still on by default", D.popLetters === true);
ok("fireworks off by default", D.fireworks === false);
ok("thunderstrike off by default", D.thunderstrike === false);
ok("fireworksQuantity defaults to 1", D.fireworksQuantity === 1);

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
section("no catch is silent");

// A defensive catch that swallows turns a bug into a cursor that is quietly
// wrong - the settings-window ghost of 1.5.5 was invisible to every check
// because nothing failed. So every catch in the source is one of two things:
// an EXPECTED failure with a comment naming it, or a guard that reports once
// per site through _reportOnce. This sweeps the TypeScript source (the
// bundle has no comments left to read) for a catch that is neither.
{
  const fs_ = require("fs"), path_ = require("path");
  const srcDir = path_.join(__dirname, "..", "..", "src");
  const bare = [], silent = [];
  let reporting = 0, commented = 0, total = 0;
  for (const f of fs_.readdirSync(srcDir).filter((n) => n.endsWith(".ts"))) {
    const text = fs_.readFileSync(path_.join(srcDir, f), "utf8");
    const re = /\bcatch\b(?:\s*\([^)]*\))?\s*\{/g;
    let m;
    while ((m = re.exec(text))) {
      total++;
      // The block: from the brace to its match.
      let depth = 1, i = m.index + m[0].length;
      while (i < text.length && depth) { if (text[i] === "{") depth++; else if (text[i] === "}") depth--; i++; }
      const body = text.slice(m.index + m[0].length, i - 1);
      const line = text.slice(0, m.index).split("\n").length;
      if (/_reportOnce\(|console\.(error|warn)\(/.test(body)) reporting++;
      else if (/\/\*|\/\//.test(body)) commented++;
      else if (!body.trim()) bare.push(f + ":" + line);
      else silent.push(f + ":" + line + " " + body.trim().replace(/\s+/g, " ").slice(0, 60));
    }
  }
  ok("the sweep found the catches", total > 60, total);
  ok("no catch has an empty body", bare.length === 0, bare);
  ok("every silent catch says which failure it expects", silent.length === 0, silent);
  ok("the guards that must not take a frame down report", reporting >= 30, reporting);
  ok("...and the expected failures are the minority", commented < reporting, { commented, reporting });
}

// _reportOnce: the first occurrence of a site is in the console, the rest are
// not, and a fresh engine run starts over.
{
  const e = Object.create(Plugin.prototype);
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a);
  try {
    e._reportOnce("probe A", new Error("one"));
    e._reportOnce("probe A", new Error("two"));
    e._reportOnce("probe B", new Error("three"));
    ok("one line per site", logged.length === 2, logged.length);
    ok("...naming the site and saying it is once", /probe A \(reported once\)/.test(logged[0][0]) && logged[0][1].message === "one", logged[0]);
    ok("...the second site on its own line", /probe B/.test(logged[1][0]));
    e._resetEngineState();
    e._reportOnce("probe A", new Error("again"));
    ok("a fresh engine run reports again", logged.length === 3, logged.length);
  } finally {
    console.error = orig;
  }
  const engineSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "engine.ts"), "utf8");
  const torchSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "torch.ts"), "utf8");
  ok("the two ticks report through it too", /_reportOnce\("canvas tick/.test(engineSrc) && /_reportOnce\("torch tick/.test(torchSrc));
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
