// secondary carets: gradient, full effects.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

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
    e.drawBoxCursor = () => drawn.push(e.animActive.x);
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
    let reads = 0;
    const scroller = { scrollLeft: 0, _top: 0, get scrollTop() { reads++; return this._top; }, set scrollTop(v) { this._top = v; } };
    e.app = { workspace: { activeEditor: { editor: { cm: { scrollDOM: scroller } } } } };
    e._tickNo = 1;
    e.hotBurns = [{ x: 10, y: 10 }]; e._hotPrev = { x: 10, y: 10, t: 0 }; e._hotEmitFrom = { x: 10, y: 10 };
    const b = e._freshCaretState(); b.hotBurns = [{ x: 50, y: 50 }]; b._hotPrev = { x: 50, y: 50, t: 0 }; b._hotEmitFrom = { x: 50, y: 50 };
    e._secondaries = [b];
    e.hotSyncScroll();                // baseline
    scroller.scrollTop = 30;
    e._tickNo = 2;
    e.hotSyncScroll();
    // scrollTop is a layout read; a scroll always fires an event that bumps
    // the layout generation before the next frame, so without one the tick
    // does not even look (1.5.8: 0.12 ms of every hot tick while typing).
    ok("without a layout change the scroller is not read again", reads === 1 && e.hotBurns[0].y === 10, reads);
    e._invalidateLayout();            // what the scroll event does
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


  // The letter held in the box (resolveHoldChar): only after an insertion
  // at the caret - the document grew by exactly the distance the caret
  // moved - never for a click or an arrow. It used to hold the character
  // before ANY forward move and, otherwise, the previous position's, so a
  // click from a word onto an empty line showed the word's letter in the
  // empty box, and a click ahead popped a letter particle.
  {
    const text = "the table.\n\nHave some";
    const cmOf = (txt) => ({ workspace: { activeEditor: { editor: { cm: { state: { doc: { sliceString: (a, b) => txt.slice(a, b), length: txt.length } } } } } } });
    const at = (pos, docLen, char) => rec(pos * 8, 20, pos, { docLen, char });
    const e = mk({ popEffects: true, popLetters: true });
    e.app = cmOf(text);
    const spawned = [];
    e.spawnLetterParticle = (ch) => spawned.push(ch);
    e.lastActive = at(4, text.length, "t");
    ok("a click ahead holds nothing: the character under the caret shows", e.resolveHoldChar(at(9, text.length, ".")) === null);
    ok("...nor a click onto the empty line", e.resolveHoldChar(at(11, text.length, "")) === null);
    ok("...nor a click back", e.resolveHoldChar(at(1, text.length, "h")) === null);
    ok("...and none of those popped a letter", spawned.length === 0, spawned);
    e.lastActive = at(4, text.length - 1, " ");
    ok("a keystroke holds the letter just typed", e.resolveHoldChar(at(5, text.length, "a")) === "t");
    ok("...and pops it", spawned.join("") === "t", spawned);
    e.lastActive = at(4, text.length - 5, " ");
    ok("a paste holds its last character", e.resolveHoldChar(at(9, text.length, ".")) === "e");
    e.lastActive = at(10, text.length - 1, "");
    ok("Enter holds nothing", e.resolveHoldChar(at(11, text.length, "")) === null);
    e.lastActive = at(4, text.length - 2, " ");
    ok("an auto-paired bracket (two inserted, one moved) holds nothing", e.resolveHoldChar(at(5, text.length, "a")) === null);
    e.lastActive = rec(32, 20, 4);
    ok("a record with no document length (a plain field) holds nothing", e.resolveHoldChar(rec(40, 20, 5)) === null);
    // The commit paths. With no move delay the box moves at once and shows
    // the character under it - past the letter just typed, so never that
    // letter (1.6.0 to 1.6.3 kept it in the box while the caret rested: the
    // letter doubled, and mid-word it covered the next one). With a delay,
    // the box waiting at the old spot sits on the typed letter and shows it.
    const c = mk({ moveDelayMs: 0, popEffects: true, popLetters: true });
    c.pushTrail = () => {}; c.spawnFlamePixels = () => {}; c.app = cmOf(text);
    const popped = [];
    c.spawnLetterParticle = (ch) => popped.push(ch);
    c.lastActive = at(4, text.length, "t");
    c.updateActivePoint(at(11, text.length, ""));
    ok("a click onto the empty line commits showing nothing", c.lastActive.pos === 11 && c.lastActive.char === "" && !("holdChar" in c.lastActive), c.lastActive);
    c.lastActive = at(4, text.length - 1, " ");
    c.updateActivePoint(at(5, text.length, "a"));
    ok("a keystroke commits showing the character under the caret, not the letter typed", c.lastActive.pos === 5 && c.lastActive.char === "a" && !("holdChar" in c.lastActive), c.lastActive);
    ok("...and still pops the letter typed", popped.join("") === "t", popped);
    c.updateActivePoint(at(5, text.length, "a"));
    ok("...the same after a re-measurement at the same spot", c.lastActive.char === "a" && !("holdChar" in c.lastActive), c.lastActive);
    c.animActive = Object.assign({}, c.lastActive);
    c.updateActivePoint(rec(40, 120, 5, { docLen: text.length, char: "a" }));
    ok("...and after a scroll shift", c.lastActive.char === "a" && c.lastActive.top === 120 && !("holdChar" in c.lastActive), c.lastActive);
    const d = mk({ moveDelayMs: 200 });
    d.pushTrail = () => {}; d.spawnFlamePixels = () => {}; d.app = cmOf(text);
    d.lastActive = at(4, text.length, "t");
    d.updateActivePoint(at(11, text.length, ""));
    ok("with a move delay, the box still at the old spot keeps the old character meanwhile", !!d.pending && d.pending.holdChar === "t", d.pending && d.pending.holdChar);
    d.lastActive = at(4, text.length - 1, " ");
    d.pending = null;
    d.updateActivePoint(at(5, text.length, "a"));
    ok("...and a keystroke's letter while the move waits", !!d.pending && d.pending.holdChar === "t", d.pending && d.pending.holdChar);
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
        save() { ops.push({ op: "save" }); }, restore() { ops.push({ op: "restore" }); },
        beginPath() { ops.push({ op: "path" }); }, rect(x, y, w, h) { ops.push({ op: "rect", x, y, w, h }); }, clip() { ops.push({ op: "clip" }); },
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
    // Regions: with the sidebars spared the painting is confined to the
    // note tabs - a clip of their rectangles, in the layer's coordinates -
    // and nothing outside them is touched. Without regions, no clip at all.
    const dr = recCtx();
    T.paintTorchDarkness(dr, 800, 600, [{ x: 10, y: 20 }], 250, 0.92, [{ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600 }, { left: 500, top: 100, width: 300, height: 500, right: 800, bottom: 600 }]);
    const names = dr.ops.map((o) => o.op);
    ok("darkness with regions: cleared whole, then clipped to the regions before the fill, restored after",
       names.slice(0, 7).join() === "composite,clear,save,path,rect,rect,clip" && names[names.length - 1] === "restore", names);
    const rects = dr.ops.filter((o) => o.op === "rect");
    ok("...the clip is the regions themselves", rects[0].x === 0 && rects[0].w === 400 && rects[0].h === 600 && rects[1].x === 500 && rects[1].y === 100 && rects[1].h === 500, rects);
    ok("...and without regions there is no clip", !dark.ops.some((o) => o.op === "clip" || o.op === "save"));
    const gr = recCtx();
    T.paintTorchGlow(gr, 800, 600, [{ x: 10, y: 20 }], 250, "255, 150, 60", [{ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600 }]);
    ok("glow with regions: the same clip, and none without", gr.ops.some((o) => o.op === "clip") && gr.ops[gr.ops.length - 1].op === "restore" && !glow.ops.some((o) => o.op === "clip"));
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
