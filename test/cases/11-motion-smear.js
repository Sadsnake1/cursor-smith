// max length, conserved volume, the twist.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

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
section("motion smear: max length and conserved volume (after smear-cursor.nvim)");

// Two things taken from smear-cursor.nvim in 1.5.4. Max length caps how far
// the tail trails the head, written into the spring's state so the tail
// arrives sooner rather than just being drawn shorter. Conserve volume
// thins a diagonal streak across its direction of travel so its area stays
// near the caret's own, and is a shape pass like the taper: derived per
// frame, never written back. Both are off by default, so every look and
// share code from before reads as it did.
{
  const fresh = (over) => {
    const e = makeEngine(Object.assign({ smear: true, smearTaper: false, cursorStyle: "Line",
      smearStiffness: 0.65, smearTrailingStiffness: 0.15, smearDamping: 0.45, blinkingEnabled: false }, over));
    e.styleFor = (k) => e.settings[k];
    e.renderWidth = (a) => a.w;
    e.underlineThickness = () => 3;
    e._catchUpBoost = 1;
    e.smearQuad = null; e.smearShape = null; e.smearCenterPrev = null;
    e._smearDtT = 0; e._smearDir = null;
    return e;
  };
  // Rest at (100, 40), then jump the caret to (x, y) and run `frames` frames.
  const jump = (e, x, y, frames, caret = { w: 3, h: 24 }) => {
    const real = performance.now;
    let t = 1000;
    const out = [];
    try {
      for (let i = 0; i < 5 + frames; i++) {
        e.animActive = Object.assign({ x: i < 5 ? 100 : x, top: i < 5 ? 40 : y }, caret);
        performance.now = () => t;
        e.updateSmearQuad();
        t += 16.7;
        if (i >= 5) out.push({ q: JSON.parse(JSON.stringify(e.smearQuad)), s: JSON.parse(JSON.stringify(e.smearShape)) });
      }
    } finally { performance.now = real; }
    return out;
  };
  const longest = (q) => {
    const pts = Object.values(q);
    let m = 0;
    for (const a of pts) for (const b of pts) m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y));
    return m;
  };
  const area = (q) => {
    const pts = [q.tl, q.tr, q.br, q.bl];
    let a2 = 0;
    for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; a2 += a.x * b.y - b.x * a.y; }
    return Math.abs(a2) / 2;
  };

  // --- Max length ----------------------------------------------------------
  ok("Max length is off by default", T.DEFAULT_SETTINGS.smearMaxLength === 0);
  {
    const free = jump(fresh({}), 700, 40, 20);
    const capped = jump(fresh({ smearMaxLength: 60 }), 700, 40, 20);
    const peak = (frames) => Math.max(...frames.map((f) => longest(f.q)));
    ok("an uncapped jump stretches the quad past the cap", peak(free) > 60, peak(free).toFixed(1));
    // The cap is per corner: no corner may lag its own target by more.
    const lagOf = (q, x, y) => Math.max(
      Math.hypot(q.tl.x - x, q.tl.y - y), Math.hypot(q.tr.x - (x + 3), q.tr.y - y),
      Math.hypot(q.br.x - (x + 3), q.br.y - (y + 24)), Math.hypot(q.bl.x - x, q.bl.y - (y + 24)));
    ok("the cap holds every frame", capped.every((f) => lagOf(f.q, 700, 40) <= 60 + 1e-6),
       Math.max(...capped.map((f) => lagOf(f.q, 700, 40))).toFixed(1));
    ok("...and the head still reaches the target",
       Math.abs(capped[19].q.tr.x - 703) < 30, capped[19].q.tr.x);
    // Per corner: the caret keeps its shape, the tail sits the cap behind it.
    const tiny = jump(fresh({ smearMaxLength: 5 }), 700, 40, 2);
    ok("a tiny cap leaves the caret its own shape, five pixels behind at most",
       Math.abs(longest(tiny[1].q) - Math.hypot(3, 24)) <= 10 && Math.abs(tiny[1].q.tl.x - tiny[1].q.tr.x) <= 3 + 10, longest(tiny[1].q));
    // The cap pulls a corner in along its own line of travel, so a capped
    // quad is still a parallelogram: the tail is not pinched to a point.
    const capped80 = jump(fresh({ smearMaxLength: 80 }), 700, 40, 6);
    const pinch = Math.min(...capped80.map((f) => Math.abs(f.q.bl.y - f.q.tl.y)));
    ok("...and the tail keeps the caret's height rather than pinching to a corner", pinch > 20, pinch);
    // Settles like before: the cap only ever shortens.
    const settled = jump(fresh({ smearMaxLength: 60 }), 700, 40, 200);
    const q = settled[settled.length - 1].q;
    ok("...and the quad still settles exactly on target", Math.abs(q.tl.x - 700) < 1e-9 && Math.abs(q.br.x - 703) < 1e-9, q);
  }

  // --- Conserve volume -------------------------------------------------------
  ok("Conserve volume is off by default", T.DEFAULT_SETTINGS.smearConserveVolume === false);
  {
    // A diagonal jump: down-left, the Enter move.
    const plain = jump(fresh({}), 30, 200, 4);
    const thin = jump(fresh({ smearConserveVolume: true, smearVolumeStrength: 1 }), 30, 200, 4);
    ok("with it off the painted shape is the spring's quad", plain.every((f) => JSON.stringify(f.s) === JSON.stringify(f.q)));
    const f = thin[1];
    ok("with it on the painted shape is derived, not the state", JSON.stringify(f.s) !== JSON.stringify(f.q));
    ok("...smaller in area than the stretched quad", area(f.s) < area(f.q) * 0.8, [area(f.s).toFixed(0), area(f.q).toFixed(0)]);
    ok("...and the state itself is untouched", JSON.stringify(f.q) === JSON.stringify(plain[1].q));
    // The floor: never thinner than SMEAR_VOLUME_MIN_FACTOR of the width.
    ok("...but never below the floor", area(f.s) > area(f.q) * 0.3, [area(f.s).toFixed(0), area(f.q).toFixed(0)]);
    // A horizontal move is left alone: thinning a typing smear would shrink
    // the caret's height.
    const flat = jump(fresh({ smearConserveVolume: true, smearVolumeStrength: 1 }), 400, 40, 4);
    ok("an axis-aligned move is not thinned", flat.every((x) => JSON.stringify(x.s) === JSON.stringify(x.q)));
    const weak = jump(fresh({ smearConserveVolume: true, smearVolumeStrength: 0.3 }), 30, 200, 4);
    ok("a lower strength thins less", area(weak[1].s) > area(f.s) && area(weak[1].s) < area(weak[1].q), [area(weak[1].s).toFixed(0), area(f.s).toFixed(0)]);
  }

  // --- Share codes: appended, so nothing else moved ----------------------
  ok("the three smear keys were appended, and only the Line cursor's height (1.6.6) came after them",
     T.LOOK_KEYS.slice(-4).join() === "smearMaxLength,smearConserveVolume,smearVolumeStrength,caretHeightPct", T.LOOK_KEYS.slice(-4));
  {
    const code = T.presetToCode("Capped", { smearMaxLength: 240, smearConserveVolume: true, smearVolumeStrength: 0.5 });
    const back = T.codeToPreset(code);
    ok("they round-trip through a share code",
       back && back.snap.smearMaxLength === 240 && back.snap.smearConserveVolume === true && back.snap.smearVolumeStrength === 0.5, back && back.snap);
  }
}
