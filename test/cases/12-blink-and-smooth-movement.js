// the blink's anchor, blink-to-solid, the fire on the glyphs, smooth movement, the catch-up boost.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx, srcPath, srcFiles } = require("../lib");

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

  // The twist itself, pinned (HANDOFF §2, five attempts): the lead/trail
  // split used to flip at atan(w/h) - 7 degrees for a Line, 21 for a Box -
  // from a shear to a rotation, and the sweep read a lean of 0 at 5 degrees
  // and 56 at 10. Since 1.5.6 the split is measured in the caret's own
  // units and blended linearly in the spring's time constant, so the lean
  // grows with the angle and never jumps. Swept in 5-degree steps over the
  // whole quadrant for every style; a CLIFF is the bug, not a lean.
  {
    const sweep = (style, w) => {
      const leans = [];
      for (let deg = 0; deg <= 90; deg += 5) {
        const e = makeEngine({ smear: true, smearTaper: false, cursorStyle: style, smearStiffness: 0.65, smearTrailingStiffness: 0.15, smearDamping: 0.45 });
        e.styleFor = (k) => e.settings[k]; e.renderWidth = (a) => a.w; e.underlineThickness = () => 3; e._catchUpBoost = 1;
        e.smearQuad = null; e.smearShape = null; e.smearCenterPrev = null; e._smearDtT = 0; e._smearDir = null;
        const a = deg * Math.PI / 180;
        const real = performance.now;
        let tt = 1000, lean = 0, para = 0, slant = 0;
        try {
          for (let i = 0; i < 40; i++) {
            e.animActive = { x: 400 + Math.cos(a) * 6 * i, top: 400 + Math.sin(a) * 6 * i, w, h: 24, actualCharWidth: w };
            performance.now = () => tt;
            e.updateSmearQuad();
            tt += 16.7;
            const q = e.smearQuad;
            if (!q) continue;
            const l = Math.atan2(q.bl.x - q.tl.x, q.bl.y - q.tl.y) * 180 / Math.PI;
            const r = Math.atan2(q.br.x - q.tr.x, q.br.y - q.tr.y) * 180 / Math.PI;
            lean = Math.max(lean, Math.abs((l + r) / 2));
            para = Math.max(para, Math.abs((q.tl.x + q.br.x) - (q.tr.x + q.bl.x)) / 2, Math.abs((q.tl.y + q.br.y) - (q.tr.y + q.bl.y)) / 2);
            // An end's slant as a share of the smear's length - the measure
            // that means something for a 3px-tall underline, where a 3px
            // offset already reads as 45 degrees of "lean".
            const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
            const len = Math.max(...xs) - Math.min(...xs) - w;
            if (len > 10) slant = Math.max(slant, Math.max(Math.abs(q.tl.x - q.bl.x), Math.abs(q.tr.x - q.br.x)) / len);
          }
        } finally { performance.now = real; }
        leans.push({ deg, lean, para, slant });
      }
      return leans;
    };
    for (const [style, w] of [["Line", 3], ["Box", 9], ["Underline", 9]]) {
      const rows = sweep(style, w);
      ok(`${style}: the quad stays close to a parallelogram`, Math.max(...rows.map((r) => r.para)) < 6, rows.map((r) => r.para.toFixed(1)).join(" "));
      ok(`${style}: flat and vertical travel do not lean`, rows[0].lean < 0.01 && rows[rows.length - 1].lean < 0.01);
      if (style === "Underline") {
        // Shallow travel only: a flat bar moving diagonally sweeps a
        // parallelogram with slanted ends, and that is the true shape.
        ok("Underline: at a shallow angle the bar's ends stay near square", rows.slice(0, 3).every((r) => r.slant < 0.3), rows.slice(0, 3).map((r) => r.slant.toFixed(2)).join(" "));
      } else {
        const jumps = rows.slice(1).map((r, i) => Math.abs(r.lean - rows[i].lean));
        ok(`${style}: no cliff in the lean across the quadrant`, Math.max(...jumps) < 8, rows.map((r) => r.deg + ":" + r.lean.toFixed(0)).join(" "));
        ok(`${style}: a shallow diagonal is a shear, not a rotation`, rows[2].lean < 5 && rows[6].lean < 8, [rows[2].lean, rows[6].lean]);
      }
    }
  }

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
  ok("blinkStopAfter was appended after every earlier key",
     T.LOOK_KEYS.indexOf("blinkStopAfter") > T.LOOK_KEYS.indexOf("glyphColorMode"), T.LOOK_KEYS.indexOf("blinkStopAfter"));
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
    // Under half the change in one 60 Hz frame: the glide eases it (1.7.1 made
    // the default glide faster, 39% of the gap a frame; it was 27%).
    ok("height is no longer snapped in a single frame", biggest < 36 * 0.5, biggest);
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
    ok("width eases too", biggest < 21 * 0.5, biggest);
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
          e._keyStepT = t;
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
        e._keyStepT = t;
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
section("keeping up with a held key, and what the smooth controls do (1.7.1)");

// "A small space between the cursor and the letter while I hold a key or
// Backspace", and "Catch-up speed and Speed up when typing fast don't do
// much". Measured before: the smear's leading spring settled 1.4 letters
// behind a held key, the glide half of one; every jump took the typing
// speed-up (any move in the last 150 ms counted, the jump itself too), so a
// 300 px jump took 58 ms at the slowest Catch-up speed and 17 at the
// fastest. Now a keyboard step (a short move along the row) is what counts
// as typing: the smear's lead sits on the caret, the glide runs at the
// typing rate; a jump glides at Catch-up speed on its own scale.
{
  const FRAME = 1000 / 120;
  const run = (settings, steps) => {
    const e = makeEngine(Object.assign({ smoothEnabled: true, smear: false }, settings));
    e._smoothLastT = 0; e.typingSpeedMod = 1; e._typingBoostSm = null; e.lastMoveTime = -1e9; e._keyStepT = 0;
    e.lastActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    e.animActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    const real = performance.now;
    let t = 1000;
    try {
      performance.now = () => t;
      e._smoothLastT = t;
      return steps(e, () => { t += FRAME; e.updateSmoothCursor(); return t; }, () => t);
    } finally { performance.now = real; }
  };
  // A 300 px jump: ms until 95% of it is covered.
  const jump = (catchUpSpeed) => run({ catchUpSpeed }, (e, frame, now) => {
    const t0 = now();
    e.lastActive = Object.assign({}, e.lastActive, { x: 400 }); e.lastMoveTime = t0;
    for (let i = 0; i < 400; i++) { const t = frame(); if (400 - e.animActive.x <= 15) return t - t0; }
    return Infinity;
  });
  // A held key, a letter every 33 ms: the median gap, in letters.
  const hold = (settings) => run(settings, (e, frame, now) => {
    const gaps = [];
    let x = 100, next = now();
    for (let i = 0; i < 180; i++) {
      if (now() >= next) {
        const prev = e.lastActive;
        x += 9; e.lastActive = Object.assign({}, prev, { x }); e.lastMoveTime = now();
        if (e._isKeyStep(prev, e.lastActive)) e._keyStepT = now();
        next += 33;
      }
      frame();
      if (i > 30) gaps.push(e.lastActive.x - e.animActive.x);
    }
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] / 9;
  });

  ok("Catch-up speed is an exponential scale: 10 to 90 a second, the default 30", Math.abs(T.smoothCatchRate(0.3) - 10) < 1e-9 && Math.abs(T.smoothCatchRate(0.8) - 90) < 1e-9 && Math.abs(T.smoothCatchRate(0.55) - 30) < 1e-9);
  ok("Max catch-up speed sets the typing rate: 30 to 200 a second", Math.abs(T.smoothTypingRate(0.5) - 30) < 1e-9 && Math.abs(T.smoothTypingRate(1) - 200) < 1e-9 && T.smoothTypingRate(2) === T.smoothTypingRate(1));
  const slow = jump(0.3), mid = jump(0.55), fast = jump(0.8);
  ok("a jump glides at Catch-up speed: ~0.3 s at the slow end, ~0.1 s at the default, ~35 ms at the fast end",
     slow > 250 && slow < 350 && mid > 80 && mid < 125 && fast > 20 && fast < 50, { slow, mid, fast });
  ok("...a spread you can feel: the slow end takes several times as long", slow > fast * 5, { slow, fast });
  const on = hold({ smoothAdaptive: true, maxCatchUpSpeed: 1 }), onLow = hold({ smoothAdaptive: true, maxCatchUpSpeed: 0.5 });
  ok("Speed up when typing fast, at the top of Max catch-up speed: a held key leaves no gap", on < 0.1, on);
  ok("...at its low end a glide shows, about a letter", onLow > 0.6 && onLow < 1.4, onLow);
  const off = hold({ smoothAdaptive: false, catchUpSpeed: 0.3 });
  ok("off: typing glides at Catch-up speed like any move, and trails when fast", off > 2, off);

  const e = Object.create(Plugin.prototype);
  const at = (x, top = 40) => ({ x, top, actualCharWidth: 9 });
  ok("a keyboard step: along the row by up to 2.5 letters", e._isKeyStep(at(100), at(109)) && e._isKeyStep(at(100), at(80)) && e._isKeyStep(at(100), at(122)));
  ok("...not a jump, not a row change, not standing still", !e._isKeyStep(at(100), at(130)) && !e._isKeyStep(at(100), at(109, 64)) && !e._isKeyStep(at(100), at(100)));
}

// The smear's leading edge on a keyboard step.
{
  const smearAt = (stepping) => {
    const e = makeEngine({ smear: true, smoothEnabled: false });
    e.styleFor = (k) => e.settings[k]; e.renderWidth = (a) => a.w; e.underlineThickness = () => 3;
    e._catchUpBoost = 1; e.smearQuad = null; e.smearShape = null; e.smearCenterPrev = null; e._smearDtT = 0; e._smearDir = null;
    const real = performance.now;
    let t = 1000;
    try {
      performance.now = () => t;
      e.animActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
      e.updateSmearQuad();
      t += 8.3;
      e.animActive = { x: 109, top: 40, w: 3, h: 24, actualCharWidth: 9 };
      e._keyStepT = stepping ? t : 0;
      e.updateSmearQuad();
      return e._smearLead.x;
    } finally { performance.now = real; }
  };
  ok("on a keyboard step the smear's leading edge sits on the caret", smearAt(true) === 109, smearAt(true));
  ok("...on any other move it is still the spring, behind", smearAt(false) < 109, smearAt(false));
}

// ---------------------------------------------------------------------------
section("Glide style: Ease out, Smooth, Springy (1.7.1)");
{
  // Glide amount scaled the speed by 0.7 - 0.95, a second weaker Glide
  // speed; Glide style replaced it: the shape of the move.
  const FRAME = 1000 / 120;
  const glide = (settings, typing = false) => {
    const e = makeEngine(Object.assign({ smoothEnabled: true, smear: false, catchUpSpeed: 0.55 }, settings));
    e._smoothLastT = 0; e.typingSpeedMod = 1; e._typingBoostSm = null; e.lastMoveTime = -1e9; e._keyStepT = 0; e._glideV = null;
    e.lastActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    e.animActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    const real = performance.now;
    let t = 1000;
    const xs = [];
    try {
      performance.now = () => t;
      e._smoothLastT = t;
      const to = typing ? 109 : 400;
      e.lastActive = Object.assign({}, e.lastActive, { x: to }); e.lastMoveTime = t;
      if (typing) e._keyStepT = t;
      for (let i = 0; i < 240; i++) { t += FRAME; e.updateSmoothCursor(); xs.push(e.animActive.x); }
      return { xs, to, moving: e._smoothMoving, v: e._glideV };
    } finally { performance.now = real; }
  };
  const ease = glide({ smoothStyle: "ease" }), smooth = glide({ smoothStyle: "smooth" }), springy = glide({ smoothStyle: "springy" });
  const over = (g) => Math.max(...g.xs) - g.to;
  const t95 = (g) => g.xs.findIndex((x) => Math.abs(g.to - x) <= 15) * FRAME;
  ok("Ease out never overshoots", over(ease) <= 1e-9, over(ease));
  ok("Smooth never overshoots either", over(smooth) <= 0.5, over(smooth));
  ok("...and starts softer: after 25 ms it has gone less far than Ease out", smooth.xs[2] < ease.xs[2], [smooth.xs[2], ease.xs[2]]);
  ok("...landing in about the same time", Math.abs(t95(smooth) - t95(ease)) < 60, [t95(smooth), t95(ease)]);
  ok("Springy overshoots a little - under a fifth of the way - and settles", over(springy) > 0.05 * 300 && over(springy) < 0.2 * 300, over(springy));
  for (const [name, g] of [["Ease out", ease], ["Smooth", smooth], ["Springy", springy]]) {
    ok(name + " lands exactly and stops", g.xs[g.xs.length - 1] === g.to && g.moving === false && (!g.v || (g.v.x === 0 && g.v.y === 0)), [g.xs[g.xs.length - 1], g.moving, g.v]);
  }
  // Linear (1.7.1, "add linear too"): one speed, a dead stop.
  const linear = glide({ smoothStyle: "linear" });
  const steps = linear.xs.map((x, i) => x - (i ? linear.xs[i - 1] : 100)).filter((d) => d > 0);
  ok("Linear runs at one speed: every frame's step the same", steps.length > 3 && steps.slice(0, -1).every((d) => Math.abs(d - steps[0]) < 1e-6), steps);
  ok("Linear lands exactly and stops", linear.xs[linear.xs.length - 1] === linear.to && linear.moving === false, [linear.xs[linear.xs.length - 1], linear.moving]);
  ok("...never overshoots and stops dead on the spot", over(linear) <= 1e-9 && linear.xs[linear.xs.indexOf(linear.to) + 1] === linear.to, over(linear));
  const landsAt = linear.xs.indexOf(linear.to) * FRAME;
  ok("...in GLIDE_LINEAR_SPAN / rate - about when Ease out looks there", Math.abs(landsAt - 1000 * T.GLIDE_LINEAR_SPAN / 30) <= FRAME + 1, landsAt);
  {
    // A new target mid-run: a new run from where the cursor is, no jump.
    const e = makeEngine({ smoothEnabled: true, smear: false, catchUpSpeed: 0.55, smoothStyle: "linear" });
    e._smoothLastT = 0; e.typingSpeedMod = 1; e._typingBoostSm = null; e.lastMoveTime = -1e9; e._keyStepT = 0; e._glideV = null; e._glideRun = null;
    e.lastActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    e.animActive = { x: 100, top: 40, w: 3, h: 24, actualCharWidth: 9 };
    const real = performance.now;
    let t = 1000;
    const xs = [];
    try {
      performance.now = () => t;
      e._smoothLastT = t;
      e.lastActive = Object.assign({}, e.lastActive, { x: 400 }); e.lastMoveTime = t;
      for (let i = 0; i < 4; i++) { t += FRAME; e.updateSmoothCursor(); xs.push(e.animActive.x); }
      e.lastActive = Object.assign({}, e.lastActive, { x: 200, top: 80 }); e.lastMoveTime = t;
      for (let i = 0; i < 40; i++) { t += FRAME; e.updateSmoothCursor(); xs.push(e.animActive.x); }
    } finally { performance.now = real; }
    const jumps = xs.map((x, i) => (i ? Math.abs(x - xs[i - 1]) : 0));
    ok("...a new target mid-run turns it from where it is, no jump", Math.max(...jumps) < 60 && xs[xs.length - 1] === 200 && e.animActive.top === 80, [Math.max(...jumps), xs[xs.length - 1]]);
  }
  const typed = glide({ smoothStyle: "springy", smoothAdaptive: true }, true);
  ok("a typed letter never bounces, whatever the style: typing takes the chase", over(typed) <= 1e-9, over(typed));
  ok("Glide style is a look key, appended, Ease out by default", T.LOOK_KEYS.includes("smoothStyle") && T.DEFAULT_SETTINGS.smoothStyle === "ease");
}
