// the reset, the gears, frame caps, wake sources, the report, resting more, the derived signature and the watchdog.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

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
  // The caret's fields live on e._caret (an object since 1.5.8, carets.ts);
  // read back through their accessors they are part of the surface.
  const own = (e) => [...Object.keys(e).filter((k) => k !== "_caret"), ...Object.keys(e._caret)];
  const KEYS = own(quiescent());
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
    // The trail only under CRT, which is the one thing that paints it.
    const e = engine(pool === "trail" ? { crtEffect: true } : {});
    e[pool].push({});
    ok(`a live ${pool} keeps the loop hot`, e._isAnimating(NOW) === true);
  }
  {
    // A trail with CRT off is invisible (forEachTrailPoint paints nothing),
    // and pushTrail records none; one left over from the effect being
    // switched off mid-fade must not hold the hot gear either. Until 1.5.8
    // it did, and typing on the default look drew sixty frames a second.
    const e = engine();
    e.trail.push({});
    ok("a live trail with CRT off does NOT (nothing paints it)", e._isAnimating(NOW) === false);
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
      const e = engine(field === "trail" ? { crtEffect: true } : {}); e._secondaries.push({ [field]: value });
      ok(`a secondary's ${field} keeps the loop hot`, e._isAnimating(NOW) === true);
    }
    {
      const e = engine(); e._secondaries.push({ trail: [{ x: 1 }] });
      ok("a secondary's trail with CRT off does not", e._isAnimating(NOW) === false);
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
    const { renderGlobalRows } = require("../panel_harness");
    const rows = renderGlobalRows({});
    const row = rows.find((r) => r.name === "Low power mode");
    ok("the panel has the Low power mode row", !!row);
    ok("...among the global options, not the look", rows.map((r) => r.name).indexOf("Low power mode") < rows.map((r) => r.name).indexOf("Respect reduced motion"));
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

  // --- the content watched for changes ---------------------------------------------
  // A heading's markup revealed a beat after a click (Live Preview) moves
  // the text under the caret with no event: the content's MutationObserver
  // bumps the layout generation and wakes a frame, so the next measurement
  // reads the revealed line instead of the cache.
  {
    const e = mk();
    const observed = []; let disconnected = 0; let cb = null;
    const MO = function (fn) { cb = fn; this.observe = (el, opts) => observed.push({ el, opts }); this.disconnect = () => { disconnected++; }; };
    const hadMO = "MutationObserver" in globalThis; const prevMO = globalThis.MutationObserver;
    globalThis.MutationObserver = MO;
    try {
      const content = { tag: "cm-content" }; const view = { contentDOM: content, scrollDOM: { tag: "cm-scroller" } };
      let woke = 0; e._wakeLoop = () => { woke++; };
      e._observeEditorLayout(view);
      ok("the content is watched for child, subtree and text changes", observed.length === 1 && observed[0].el === content && observed[0].opts.childList === true && observed[0].opts.subtree === true && observed[0].opts.characterData === true, observed);
      const gen = e._layoutGen | 0; woke = 0;
      cb([{ type: "childList" }]);
      ok("...and a change bumps the layout generation and wakes a frame", (e._layoutGen | 0) === gen + 1 && woke === 1, [e._layoutGen, gen, woke]);
      e._observeEditorLayout(view);
      ok("...the same view again observes nothing new", observed.length === 1);
      e._observeEditorLayout(null);
      ok("...and no view disconnects it", disconnected === 1 && e._mo === null);
    } finally { if (hadMO) globalThis.MutationObserver = prevMO; else delete globalThis.MutationObserver; }
  }

  // --- on this device -------------------------------------------------------------
  // Issue #31. The synced "Enable plugin" is every device's; "On this
  // device" is Obsidian's local storage, never synced, and gates the engines.
  {
    const e = mk();
    const saved = []; let started = 0, stopped = 0;
    e.app = { loadLocalStorage: () => null, saveLocalStorage: (k, v) => saved.push([k, v]) };
    e.settings.enabled = true;
    e.enableCanvasEngine = () => { started++; }; e.disableCanvasEngine = () => { stopped++; }; e.disableTorchOverlay = () => {}; e.torchPossible = () => false;
    e.saveSettings = async () => {}; // toggle() saves; the bare object has no vault
    e._deviceEnabled = true;
    e.enable();
    ok("on this device: enable() starts the engine", started === 1);
    e.setDeviceEnabled(false);
    ok("switched off here: saved as the string off under its key (a falsy value would be dropped), the engine stopped", e._deviceEnabled === false && saved.length === 1 && saved[0][0] === T.DEVICE_ENABLED_KEY && saved[0][1] === "off" && stopped >= 1, saved);
    started = 0;
    e.enable();
    ok("...and enable() starts nothing while it is off, whatever the synced settings say", started === 0);
    e.toggle();
    ok("...the synced wish still flips off and on without reading the engines", e.settings.enabled === false && (e.toggle(), e.settings.enabled === true) && started === 0);
    e.setDeviceEnabled(true);
    ok("switched back on: the key removed (a new device starts on) and the engine started", e._deviceEnabled === true && saved[saved.length - 1][1] === null && started === 1, saved);
    e.settings.enabled = false; started = 0;
    e.setDeviceEnabled(true);
    ok("...unless the synced switch is off", started === 0);
    const plug = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "plugin.ts"), "utf8");
    ok("read from local storage before anything starts, absent meaning on", /this\._deviceEnabled = this\.app\.loadLocalStorage\(DEVICE_ENABLED_KEY\) !== "off";/.test(plug) && /if \(this\.settings\.enabled && this\._deviceEnabled\) this\.enable\(\);/.test(plug));
    ok("the key names the plugin", T.DEVICE_ENABLED_KEY === "cursor-smith-enabled-on-this-device");
  }

  // --- the wrapper's home ----------------------------------------------------------
  // Inside the focused editor's scroller (a layer of the scrolled content,
  // carried by the compositor between ticks) - on a phone since 1.6.2, on the
  // desktop since 1.6.5 while no torch can be on; the app container while
  // focus is elsewhere, the scroller is another document's or in a Canvas
  // card, and on the desktop with a torch.
  {
    const e = mk();
    const docOf = (mobile, app) => ({ body: { classList: { contains: (c) => c === "is-mobile" && mobile } }, querySelector: (sel) => (sel === ".app-container" ? app : null) });
    const app = { name: "app" };
    const deskDoc = docOf(false, app), phoneDoc = docOf(true, app);
    const scOf = (doc, card = false) => ({ isConnected: true, ownerDocument: doc, closest: (sel) => (card && sel === ".canvas-node" ? {} : null) });
    const sc = scOf(phoneDoc);
    const view = { hasFocus: true, scrollDOM: sc };
    ok("a phone with the editor focused: its scroller", e._wrapperHome(phoneDoc, view) === sc);
    ok("...focus elsewhere: the app container", e._wrapperHome(phoneDoc, { hasFocus: false, scrollDOM: sc }) === app && e._wrapperHome(phoneDoc, null) === app);
    ok("...a scroller of another document, or a detached one: the app container", e._wrapperHome(phoneDoc, { hasFocus: true, scrollDOM: scOf(deskDoc) }) === app && e._wrapperHome(phoneDoc, { hasFocus: true, scrollDOM: Object.assign(scOf(phoneDoc), { isConnected: false }) }) === app);
    // The desktop (1.6.5): a wheel tick left the fixed caret a scroll step
    // behind for a frame - "the cursor jitters around when scrolling".
    const dsc = scOf(deskDoc);
    ok("desktop with the editor focused and no torch: its scroller too", e._wrapperHome(deskDoc, { hasFocus: true, scrollDOM: dsc }) === dsc);
    ok("...focus elsewhere: the app container", e._wrapperHome(deskDoc, { hasFocus: false, scrollDOM: dsc }) === app && e._wrapperHome(deskDoc, null) === app);
    const torch = mk({ torchEffect: true });
    ok("...but with the torch on, the app container (its layers are built around the fixed wrapper)", torch._wrapperHome(deskDoc, { hasFocus: true, scrollDOM: dsc }) === app);
    const vimTorch = mk({ vimModeEnabled: true });
    vimTorch.settings.vimModes = Object.assign({}, vimTorch.settings.vimModes, { insert: Object.assign({}, (vimTorch.settings.vimModes || {}).insert, { torchEffect: true }) });
    ok("...and with a Vim mode that lights one, too", vimTorch._wrapperHome(deskDoc, { hasFocus: true, scrollDOM: dsc }) === app);
    ok("...a phone keeps its scroller with a torch, as since 1.6.2", torch._wrapperHome(phoneDoc, view) === sc);
    ok("an editor in a Canvas card (scaled by a transform): the app container, desktop and phone", e._wrapperHome(deskDoc, { hasFocus: true, scrollDOM: scOf(deskDoc, true) }) === app && e._wrapperHome(phoneDoc, { hasFocus: true, scrollDOM: scOf(phoneDoc, true) }) === app);
    ok("...and no app container: the body", e._wrapperHome({ body: { classList: { contains: () => false } }, querySelector: () => null }, null).classList !== undefined);
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "engine.ts"), "utf8");
    ok("the tick re-places the canvas on every tick the scrolled wrapper's client position moved", /if \(!this\._wrapperPos \|\| this\._wrapperPos\.left !== left \|\| this\._wrapperPos\.top !== top\) \{\s*this\._wrapperPos = \{ left, top \};\s*this\._canvasPlaced = false;/.test(src));
    ok("...sized to the content at its origin, the fixed mode's inline top, left and clip taken off", /removeProperty\("top"\);\s*this\.canvasWrapper\.style\.removeProperty\("left"\);\s*this\.canvasWrapper\.style\.removeProperty\("clip-path"\);\s*this\.canvasWrapper\.style\.width = width \+ "px";\s*this\.canvasWrapper\.style\.height = height \+ "px";/.test(src));
    const css = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "styles.css"), "utf8");
    ok("the scrolled wrapper is an absolute layer above CodeMirror's cursor layer (150)", /\.cursor-smith-wrapper\.cursor-smith-wrapper-scrolled \{\s*position: absolute;\s*z-index: 151;\s*\}/.test(css));
  }

  // --- the scroll lock ------------------------------------------------------------
  // While the note scrolls the hot gear's frame cap is lifted: the text moves
  // every frame, and a caret placed every other frame (14 ms on 120 Hz) or
  // every third (30 ms in low power) trails it by a scroll step - the wobble
  // the user saw, worse on a phone. Short, so the cap is back right after.
  {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "engine.ts"), "utf8");
    ok("the scroll lock is short: past the gap between a slow drag's scroll events, well under the input window", T.SCROLL_LOCK_MS >= 60 && T.SCROLL_LOCK_MS <= 200 && T.SCROLL_LOCK_MS < T.INPUT_HOT_MS, T.SCROLL_LOCK_MS);
    ok("the tick skips a capped frame only when the cap is not lifted", /if \(!this\._hotCapLifted\(n\) && n - \(this\._lastHotFrameT \|\| 0\) < this\._frameCaps\(\)\.hotMinMs\)/.test(src));
    const cap = (over, set = {}) => { const g = Object.create(Plugin.prototype); g.settings = Object.assign({}, T.DEFAULT_SETTINGS, set); Object.assign(g, { _lastScrollT: 0, _realKeyT: 0, _smoothMoving: false, _smearMoving: false }, over); return g._hotCapLifted(10000); };
    ok("a scroll this recent lifts the hot gear's cap, on the scroll's own stamp (the activity kind is overwritten by touch and pointer moves between two scroll events)", cap({ _lastScrollT: 10000 - T.SCROLL_LOCK_MS + 5 }) && !cap({ _lastScrollT: 10000 - T.SCROLL_LOCK_MS - 5 }));
    ok("...in Low Power too", cap({ _lastScrollT: 9990 }, { lowPowerMode: true }));
    // Typing (1.6.4): the caret moves with the text while it glides, its
    // smear moves, or a key was just pressed - "the whole cursor is laggy
    // when typing fast" was 60 ticks a second on a 120 Hz screen.
    ok("a gliding caret lifts the cap", cap({ _smoothMoving: true }));
    ok("...a moving smear too", cap({ _smearMoving: true }));
    ok("...and a key this recent", cap({ _realKeyT: 10000 - T.SCROLL_LOCK_MS + 5 }) && !cap({ _realKeyT: 10000 - T.SCROLL_LOCK_MS - 5 }));
    ok("...but not in Low Power, which keeps its cap while typing", !cap({ _smoothMoving: true, _smearMoving: true, _realKeyT: 9990 }, { lowPowerMode: true }));
    ok("a caret at rest keeps the cap", !cap({}));
    const plug = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "plugin.ts"), "utf8");
    ok("...stamped where the scroller's scroll and wheel events are read", /this\._lastScrollT = performance\.now\(\); this\._markActivity\(e\.type\);/.test(plug));
  }

  // --- the covers: bands and bars fixed over the editor ----------------------------
  // Word-Smith's letterbox masks and its status bar (CARET_COVERS) hide the
  // editor's caret; since the layers moved above them (§1.22) they are below
  // our canvas, so the chrome insets carry their edges and the wrapper stops
  // there. A full-width element only; a narrow one is not a cover.
  {
    const e = mk();
    e._isVisiblyRendered = () => true;
    e._chromeCache = null;
    const el = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) });
    const covers = [el(320, 78, 776, 79), el(320, 593, 776, 79), el(289, 672, 840, 30), el(600, 300, 100, 20)];
    const doc = { body: { classList: { contains: () => false } }, defaultView: { innerWidth: 1330, innerHeight: 702 }, querySelector: () => null, querySelectorAll: (sel) => (sel === T.CARET_COVERS ? covers : []) };
    const ins = e._chromeInsets(doc);
    ok("the top band moves the canvas's top to its bottom edge", ins.coverTop === 157, ins.coverTop);
    ok("the bottom band and the bar move its bottom to the higher of their tops", ins.coverBottom === 593, ins.coverBottom);
    e._chromeCache = null;
    const none = e._chromeInsets({ body: { classList: { contains: () => false } }, defaultView: { innerWidth: 1330, innerHeight: 702 }, querySelector: () => null, querySelectorAll: () => [] });
    ok("with no covers the canvas is free: 0 and Infinity", none.coverTop === 0 && none.coverBottom === Infinity, [none.coverTop, none.coverBottom]);
    ok("the selector names Word-Smith's masks and its bar", T.CARET_COVERS === ".ws-mask, .ws-status-bar");
  }

  // --- geometry cache ----------------------------------------------------------
  {
    const e = mk();
    e._chromeInsets = () => ({ top: 0, bottomInset: 0, coverTop: 0, coverBottom: Infinity });
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

  // --- a caret swap is a pointer (1.5.8) --------------------------------------
  {
    const e = mk(); e._resetEngineState();
    const primary = e._caret;
    const b1 = e._freshCaretState(), b2 = e._freshCaretState();
    let inside = null, nested = null;
    e._withCaret(b1, () => { inside = e._caret; e._withCaret(b2, () => { nested = e._caret; }); });
    ok("a secondary's bundle IS the caret while it is in, and the primary's object comes back", inside === b1 && nested === b2 && e._caret === primary);
    ok("nothing is copied: a field written inside lands on the bundle", e._withCaret(b1, () => { e.trail = [{ x: 1 }]; return b1.trail.length; }) === 1 && e.trail.length === 0);
    ok("a fresh bundle has every per-caret field the reset writes", T.CARET_STATE_FIELDS.every((k) => k in b2) && b2.trail.length === 0 && b2._smearLead === null, T.CARET_STATE_FIELDS.filter((k) => !(k in b2)));
    ok("the smear's two points and the volume buffer are per caret (they were shared until 1.5.8)", ["_smearLead", "_smearTrail", "_volumeBuf"].every((k) => T.CARET_STATE_FIELDS.includes(k)));
    // The latent bug: with the points shared, a secondary's spring
    // integrated the primary's leading point toward its own target.
    const s = mk({ smear: true }); s._resetEngineState();
    s.animActive = { x: 100, top: 200, w: 8, h: 24, actualCharWidth: 8 };
    const sb = s._freshCaretState(); sb.animActive = { x: 500, top: 300, w: 8, h: 24, actualCharWidth: 8 };
    const real = performance.now; let now = 5000; performance.now = () => now;
    try {
      s.updateSmearQuad(); s._withCaret(sb, () => s.updateSmearQuad());
      now += 16; s.updateSmearQuad(); s._withCaret(sb, () => s.updateSmearQuad());
      ok("two carets keep two smear springs", s._smearLead !== sb._smearLead && s._smearLead.x === 100 && sb._smearLead.x === 500, [s._smearLead && s._smearLead.x, sb._smearLead && sb._smearLead.x]);
    } finally { performance.now = real; }
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
section("frame governor: resting more (1.5.8)");

// Profiled in a live Obsidian (HANDOFF §1.19): typing on the default look
// drew sixty frames a second for an invisible trail, blink fades started up
// to a heartbeat late, the idle tick re-read computed styles four times a
// second for a caret that had not moved, Hot-head read the scroller's
// offsets on every hot tick, and every stray selectionchange or resize bought
// 1.2 s of the hot gear. Each of those is pinned here.
{
  const mk = (settings = {}) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    e.app = { workspace: { activeEditor: null } };
    return e;
  };
  const rec = (x, top, pos) => ({ x, top, bottom: top + 24, h: 24, w: 8, actualCharWidth: 8, char: "a", focused: true, pos, assoc: 1 });
  const src = (f) => require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", f), "utf8");

  // --- the trail is recorded only under CRT -----------------------------------
  {
    const off = mk(); off.lastActive = rec(10, 10, 5);
    off.spawnFlamePixels = () => {}; off.spawnJumpTrail = () => {}; off.spawnGlitch = () => {};
    off.commitMove(rec(18, 10, 6));
    ok("a caret move with CRT off records no trail ghost", off.trail.length === 0, off.trail.length);
    ok("...so nothing holds the hot gear after the move", off._isAnimating(performance.now()) === false);
    const on = mk({ crtEffect: true }); on.lastActive = rec(10, 10, 5);
    on.spawnFlamePixels = () => {}; on.spawnJumpTrail = () => {}; on.spawnGlitch = () => {};
    on.commitMove(rec(18, 10, 6));
    ok("...with CRT on it does", on.trail.length === 1, on.trail.length);
    ok("...and a fading ghost keeps the loop hot", on._isAnimating(performance.now()) === true);
    on.settings.crtEffect = false; on._effCache = null;
    ok("...but not once the effect is switched off under it", on._isAnimating(performance.now()) === false);
  }

  // --- blinkWindow: the same clock as blinkPhase, landing on the fades --------
  {
    const e = mk({ blinkingEnabled: true, blinkSpeed: 1.2, blinkOnOffBalance: 0.5, blinkFade: 0.15 });
    e.lastMoveTime = 1000;
    const seg = T.blinkSegments(1.2, 0.5, 0.15);
    ok("the segments are one period long and in order", seg.period === 2500 / 1.2 && seg.p1 < seg.p2 && seg.p2 < seg.p3 && seg.p3 < 1, seg);
    let agree = true, samples = 0;
    for (let t = 1001; t < 1000 + seg.period * 3; t += 7) {
      const a = e.blinkPhase(t), w = e.blinkWindow(t);
      if (w.fading !== (a > 0 && a < 1)) { agree = false; break; }
      samples++;
    }
    ok(`fading is exactly "the alpha is between its ends", over ${samples} samples`, agree, samples);
    const w0 = e.blinkWindow(1001);
    const tFade = 1001 + w0.msToNext;
    ok("from the lit hold the next wake is where the fade-out begins", !w0.fading && e.blinkPhase(tFade - 1) === 1 && e.blinkPhase(tFade + 1) < 1, w0);
    const w1 = e.blinkWindow(tFade + 1);
    ok("...inside the fade it is the fade's end", w1.fading && e.blinkPhase(tFade + 1 + w1.msToNext + 1) === 0, w1);
    ok("no blink, no wake", mk({ blinkingEnabled: false }).blinkWindow(5000).msToNext === Infinity);
    const hold = mk({ blinkingEnabled: true, blinkDelayMs: 600, blinkSpeed: 1 }); hold.lastMoveTime = 1000;
    const wh = hold.blinkWindow(1100);
    ok("the post-move hold sleeps through to the first fade", !wh.fading && Math.abs(wh.msToNext - (500 + T.blinkSegments(1).p1 * 2500)) < 1e-6, wh);
    const solid = mk({ blinkingEnabled: true, blinkSpeed: 1, blinkStopAfter: 2 }); solid.lastMoveTime = 0;
    ok("gone solid, no wake", solid.blinkWindow(2500 * 2 + 10).msToNext === Infinity && solid.blinkWindow(2500 + 10).msToNext !== Infinity);
    const engineSrc = src("engine.ts");
    ok("the idle gear sleeps until the heartbeat or that wake, whichever is sooner", /Math\.min\(caps\.idleMs, Math\.max\(1, Math\.ceil\(this\._idleWakeMs/.test(engineSrc));
    ok("...and a parked loop drops the wake, so it cannot spin on a stale one", /this\._idleWakeMs = 0;\s*schedule\(\);/.test(engineSrc));
    ok("the torch parks the same way while Blink Sync is on", /this\._torchIdleWakeMs = w\.msToNext/.test(src("torch.ts")) && /Math\.min\(caps\.torchIdleMs, Math\.max\(1, Math\.ceil\(this\._torchIdleWakeMs/.test(src("torch.ts")));
  }

  // --- selectionchange wakes only when the selection went somewhere ----------
  {
    const e = mk();
    const view = { hasFocus: true, dom: { ownerDocument: null }, state: { doc: {}, selection: { main: { anchor: 10, head: 10, assoc: 0 }, ranges: [{}] } } };
    const doc = { activeElement: null, getSelection: () => null };
    view.dom.ownerDocument = doc;
    e.app = { workspace: { activeEditor: { editor: { cm: view } } } };
    ok("the first selectionchange counts", e._selectionMoved(doc) === true);
    ok("the same selection again does not", e._selectionMoved(doc) === false && e._selectionMoved(doc) === false);
    view.state.selection.main = { anchor: 10, head: 11, assoc: 0 };
    ok("a moved head does", e._selectionMoved(doc) === true);
    view.state = Object.assign({}, view.state, { doc: {} });
    ok("...and so does an edit under the same head", e._selectionMoved(doc) === true);
    view.state.selection.ranges = [{}, {}];
    ok("...and a caret added", e._selectionMoved(doc) === true);
    ok("...then quiet again", e._selectionMoved(doc) === false);
    view.hasFocus = false;
    const field = { selectionStart: 3, selectionEnd: 3 };
    doc.activeElement = field;
    ok("a focused field's selection counts on first sight", e._selectionMoved(doc) === true);
    ok("...and not while it stays", e._selectionMoved(doc) === false);
    field.selectionStart = field.selectionEnd = 4;
    ok("...and does when it moves", e._selectionMoved(doc) === true);
    doc.activeElement = { tagName: "DIV" };
    const n1 = {}, n2 = {};
    doc.getSelection = () => ({ anchorNode: n1, anchorOffset: 2, focusNode: n1, focusOffset: 2, rangeCount: 1 });
    ok("a DOM selection counts on first sight", e._selectionMoved(doc) === true);
    ok("...and not while it stays", e._selectionMoved(doc) === false);
    doc.getSelection = () => ({ anchorNode: n2, anchorOffset: 2, focusNode: n2, focusOffset: 2, rangeCount: 1 });
    ok("...and does when it moves", e._selectionMoved(doc) === true);
    const bad = mk(); bad.app = { workspace: { get activeEditor() { throw new Error("mid-teardown"); } } };
    ok("a probe that throws wakes the loop", bad._selectionMoved(doc) === true);

    // Wired that way, and the listeners come off again with the same functions.
    const listeners = {}, removed = {}, winL = {};
    const fakeDoc = {
      addEventListener(type, fn) { listeners[type] = fn; },
      removeEventListener(type, fn) { removed[type] = fn; },
      defaultView: { addEventListener(type, fn) { winL[type] = fn; }, removeEventListener() {} },
      activeElement: null, body: {}, getSelection: () => null,
    };
    const w = mk(); w.registeredDocuments = new Set(); w._docCleanups = new Map();
    const hadDoc = "document" in globalThis;
    globalThis.document = fakeDoc;
    try { w.registerWindowEvents(fakeDoc); } finally { if (!hadDoc) delete globalThis.document; }
    const woke = []; w._markActivity = (k) => woke.push(k);
    listeners.selectionchange(); listeners.selectionchange();
    ok("selectionchange wakes once for a selection that then sits still", woke.length === 1 && woke[0] === "selectionchange", woke);
    winL.resize();
    ok("a resize says it is one (the report used to blame the previous kind)", woke[1] === "resize", woke);
    w._docCleanups.get(fakeDoc)();
    ok("unregistering removes the scroll, wheel and selectionchange listeners it registered",
       removed.scroll === listeners.scroll && removed.wheel === listeners.wheel && removed.selectionchange === listeners.selectionchange,
       Object.keys(removed));
  }

  // --- the hot gear's post-input window -----------------------------------------
  ok("the hot gear is held half a second after an input, down from 1.2", T.INPUT_HOT_MS === 500, T.INPUT_HOT_MS);
  ok("...and the tick reads it", /< INPUT_HOT_MS/.test(src("engine.ts")));

  // --- the caret's style is re-read on a style change, not on every tick -------
  {
    const e = mk();
    e._chromeInsets = () => ({ top: 0, bottomInset: 0, coverTop: 0, coverBottom: Infinity });
    let styleReads = 0, hits = 0;
    const lineEl = { closest: () => lineEl, contains: () => true, textContent: "abc" };
    const rootEl = { getBoundingClientRect: () => ({ top: 50, bottom: 650, left: 100, right: 900, width: 800, height: 600 }), ownerDocument: null };
    const view = {
      state: { selection: { main: { head: 10, assoc: 0, empty: true } }, doc: { length: 100, sliceString: () => "a" } },
      dom: { closest: () => rootEl, ownerDocument: null }, contentDOM: { querySelector: () => lineEl },
      defaultCharacterWidth: 8, hasFocus: true, coordsAtPos: () => ({ left: 200, top: 300, bottom: 324 }),
    };
    const win = { getComputedStyle: () => { styleReads++; return { color: "#fff", fontSize: "16px", fontFamily: "m", fontWeight: "400", fontStyle: "normal", letterSpacing: "0px", lineHeight: "24px" }; } };
    const doc = { activeElement: { closest: () => null, tagName: "DIV", isContentEditable: true }, defaultView: win, documentElement: { clientWidth: 1000 }, elementFromPoint: () => { hits++; return lineEl; }, createRange: () => ({ selectNodeContents() {}, getClientRects: () => [] }) };
    view.dom.ownerDocument = doc; rootEl.ownerDocument = doc;
    e.measureCharWidth = () => 8;
    e.cmCaretCoords(view); e.cmCaretCoords(view); e.cmCaretCoords(view);
    ok("the first frame reads the computed styles and hit-tests the line; the next two do not", styleReads === 2 && hits === 1, { styleReads, hits });
    e._markActivity("scroll"); e.cmCaretCoords(view);
    ok("a scroll (any activity) does not re-read the style", hits === 1, hits);
    e._invalidateStyle(); e.cmCaretCoords(view);
    ok("a style invalidation (css-change, layout-change, resize) does", hits === 2, hits);
    e._caretStyleCache.t -= T.CARET_STYLE_TTL_MS + 1; e.cmCaretCoords(view);
    ok("...and the TTL, as the backstop", hits === 3, hits);
    ok("the backstop is a second, not a quarter of one", T.CARET_STYLE_TTL_MS >= 1000, T.CARET_STYLE_TTL_MS);
    ok("css-change, layout-change and resize bump the style generation; an active-leaf change only the layout's",
       /const style = ev !== "active-leaf-change";/.test(src("plugin.ts")) && /style \? this\._invalidateStyle\(\) : this\._invalidateLayout\(\)/.test(src("plugin.ts")));
  }

  // --- a settled smear is left alone ----------------------------------------------
  {
    const e = mk({ smear: true, smearStiffness: 0.5, smearDamping: 0.5, smearTrailingStiffness: 0.5, smearTaper: true, smearConserveVolume: true });
    e.animActive = { x: 100, top: 200, w: 8, h: 24, actualCharWidth: 8 };
    const real = performance.now; let t = 5000; performance.now = () => t;
    try {
      e.updateSmearQuad();
      for (let i = 0; i < 5; i++) { t += 16; e.updateSmearQuad(); }
      e.animActive.x = 140;
      for (let i = 0; i < 400; i++) { t += 16; e.updateSmearQuad(); }
      ok("after a move the spring settles exactly onto the target", !e._smearMoving && e.smearQuad.tl.x === 140 && e._smearLead.x === 140 && e._smearTrail.x === 140 && e.smearShape === e.smearQuad,
         [e._smearMoving, e.smearQuad.tl.x, e._smearLead.x, e._smearTrail.x]);
      const settled = JSON.stringify([e.smearQuad, e._smearLead, e._smearTrail]);
      for (let i = 0; i < 50; i++) { t += 200; e.updateSmearQuad(); }
      ok("...and fifty idle heartbeats later nothing has moved, and the frame clock kept up", JSON.stringify([e.smearQuad, e._smearLead, e._smearTrail]) === settled && e._smearDtT === t);
      e.animActive.h = 30;
      t += 16; e.updateSmearQuad();
      ok("...a taller caret is not 'settled': the corners follow", e.smearQuad.bl.y === 230, e.smearQuad.bl.y);
    } finally { performance.now = real; }
  }

  // --- the smear settles when it stops being visible ------------------------------
  // Headless, at 60 Hz: after a keystroke's 8 px move, the frame of the last
  // half-pixel change in the painted corners against the frame the spring
  // stops claiming the hot gear. It used to claim it for 200-370 ms more
  // (a velocity floor of 0.1 px/s) on every shipped look with the smear.
  {
    const tail = (look) => {
      const e = mk(Object.assign({ smear: true }, look));
      e.animActive = { x: 100, top: 200, w: 8, h: 24, actualCharWidth: 8 };
      const real = performance.now; let t = 1000; performance.now = () => t;
      try {
        e.updateSmearQuad(); t += 16; e.updateSmearQuad();
        e.animActive.x = 108;
        let lastVisible = 0, movingUntil = 0, prev = e._smearSig();
        for (let frame = 1; frame < 300; frame++) {
          t += 16.67; e.updateSmearQuad();
          const sig = e._smearSig();
          if (sig !== prev) lastVisible = frame; prev = sig;
          if (e._smearMoving) movingUntil = frame;
          if (!e._smearMoving && frame > lastVisible + 5) break;
        }
        return { lastVisible, movingUntil, tailFrames: movingUntil - lastVisible };
      } finally { performance.now = real; }
    };
    for (const [name, look] of [["the defaults", {}], ["Jell-O", T.DEFAULT_PRESETS["Jell-O"]], ["FairyDust", T.DEFAULT_PRESETS.FairyDust]]) {
      const r = tail(look);
      ok(`${name}: the spring stops claiming the hot gear within two frames of its last half-pixel change`, r.tailFrames <= 2 && r.lastVisible > 5, r);
    }
    ok("the settle velocity is half a pixel per frame at 60 Hz", T.SMEAR_SETTLE_V === 30, T.SMEAR_SETTLE_V);
  }

  // --- what wakes a dozing loop besides input ------------------------------------
  {
    const e = mk();
    let cleared = 0, rafs = 0;
    const realCT = window.clearTimeout, realRAF = window.requestAnimationFrame;
    window.clearTimeout = () => { cleared++; }; window.requestAnimationFrame = () => { rafs++; return 1; };
    try {
      e._canvasIdleT = 42; e.canvasEngineActive = true; e._canvasTick = () => {};
      e._invalidateLayout();
      ok("a layout invalidation wakes a dozing loop", cleared === 1 && rafs === 1 && e._canvasIdleT === 0, { cleared, rafs });
      e._invalidateLayout();
      ok("...once: a loop already on a frame is left alone", cleared === 1 && rafs === 1, { cleared, rafs });
    } finally { window.clearTimeout = realCT; window.requestAnimationFrame = realRAF; }
    const save = src("plugin.ts").split("async saveSettings()")[1].split("\n  }")[0];
    ok("saveSettings wakes it too, so a settings change shows on the next frame", /this\._wakeLoop\(\);/.test(save));
  }

  // --- reduced motion is read once ------------------------------------------------
  {
    const e = mk(); e.canvas = null;
    let reads = 0, handler = null;
    const had = "matchMedia" in globalThis, realMM = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ get matches() { reads++; return false; }, addEventListener: (type, fn) => { handler = fn; } });
    try {
      e.reducedMotion(); e.reducedMotion(); e.reducedMotion();
      ok("the media query is read once, then kept", reads === 1 && typeof handler === "function", reads);
      handler({ matches: true });
      ok("...and a change reaches it through the listener", e.reducedMotion() === true && reads === 1);
    } finally { if (had) globalThis.matchMedia = realMM; else delete globalThis.matchMedia; }
  }
}

// ---------------------------------------------------------------------------
section("the derived signature, the gear decision, the watchdog (1.5.8)");

// From the code review after the performance pass (HANDOFF §1.20): the
// static-frame signature is derived from a look generation instead of a
// hand-kept list of keys, the gear decision is a method, a watchdog restarts
// a dead loop and hands the native caret back, the Vim status interval runs
// only with the indicator, and the blink has one clock.
{
  const mk = (settings = {}) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    e.app = { workspace: { activeEditor: null } };
    return e;
  };
  const rec = (x, top) => ({ x, top, bottom: top + 24, h: 24, w: 8, actualCharWidth: 8, char: "a", focused: true, pos: 1, assoc: 1 });
  const src = (f) => require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", f), "utf8");

  // --- the static-frame signature is derived, not enumerated ------------------
  {
    const e = mk(); e.lastActive = rec(100, 200); e.animActive = rec(100, 200);
    const s0 = e._frameSignature(null, 1);
    ok("a settled frame's signature is stable", e._frameSignature(null, 1) === s0);
    let changed = 0, keys = 0;
    for (const k of T.LOOK_KEYS) {
      if (!(k in T.DEFAULT_SETTINGS)) continue;
      keys++;
      const before = e._frameSignature(null, 1);
      const v = e.settings[k];
      e.settings[k] = typeof v === "boolean" ? !v : typeof v === "number" ? v + 1 : String(v) + "x";
      e._lookChanged();
      if (e._frameSignature(null, 1) !== before) changed++;
    }
    ok(`every one of the ${keys} look keys changes the signature through _lookChanged (the list used to be kept by hand)`, changed === keys, { changed, keys });
    const e2 = mk(); e2.lastActive = rec(100, 200);
    const a = e2._frameSignature(null, 1);
    e2.lastActive = rec(108, 200);
    ok("...and so does the caret moving", e2._frameSignature(null, 1) !== a);
    ok("...the blink's half", e2._frameSignature(null, 0) !== e2._frameSignature(null, 1));
    ok("...and the Vim mode", e2._frameSignature("insert", 1) !== e2._frameSignature("normal", 1));
    const p = src("plugin.ts");
    ok("saveSettings goes through _lookChanged, and nothing else drops the memo behind its back",
       /this\._lookChanged\(\);\s*this\._wakeLoop\(\);/.test(p) && (p.match(/this\._effCache = null;/g) || []).length === 1);
    ok("the tick paints on a static frame only when the signature changed", /if \(g\.staticFrame\) \{\s*const sig = this\._frameSignature\(_vimMode, g\.blinkBucket\);/.test(src("engine.ts")));
  }

  // --- the gear decision --------------------------------------------------------
  {
    const NOW = 10000;
    const e = mk({ blinkingEnabled: false });
    const g0 = e._decideGear(NOW, true);
    ok("a settled engine with no caret is idle", g0.gear === "idle" && g0.why === "idle" && g0.staticFrame === true, g0);
    e._lastActivityT = NOW - 100; e._lastActivityKind = "key";
    const g = e._decideGear(NOW, true);
    ok("an input within the window is hot, and says which", g.gear === "hot" && g.why === "input:key" && g.staticFrame === true, g);
    e._lastActivityT = NOW - T.INPUT_HOT_MS - 1;
    ok("...and not past it", e._decideGear(NOW, true).gear === "idle");
    // Speed 1: a 2500 ms period; balance 0.5 and fade 0.15 put the fade-out
    // at 875 ms. 800 ms after a move: lit, 75 ms to the fade.
    const b = mk({ blinkingEnabled: true, blinkSpeed: 1 }); b.lastActive = rec(1, 1); b.lastMoveTime = NOW - 800;
    const gb = b._decideGear(NOW, true);
    ok("a lit hold is idle with a wake at the fade", gb.gear === "idle" && Math.abs(gb.idleWake - 75) < 1e-6 && gb.blinkBucket === 1, gb);
    const gf = b._decideGear(NOW + 100, true);
    ok("...inside the fade it is warm, not static, and says blink", gf.gear === "warm" && !gf.staticFrame && gf.why === "blink", gf);
    const s = mk({ smear: true }); s._smearMoving = true;
    ok("a moving smear is hot and says smear", s._decideGear(NOW, true).gear === "hot" && s._decideGear(NOW, true).why === "smear");
    ok("without a report the reason is not built", s._decideGear(NOW, false).why === "");
    const en = mk({ energyEffect: true, blinkingEnabled: false }); en.lastActive = rec(1, 1);
    const ge = en._decideGear(NOW, true);
    ok("the shimmer alone takes the energy gear and is never static", ge.gear === "energy" && !ge.staticFrame && ge.why === "energy", ge);
  }

  // --- the watchdog ---------------------------------------------------------------
  {
    const e = mk(); e.canvasEngineActive = true; e.canvas = { ownerDocument: { visibilityState: "visible" } };
    let enables = 0, classes = 0;
    e.enable = () => { enables++; e._watchdogGaveUp = false; };
    e.applyBodyClasses = () => { classes++; };
    const logged = []; e._reportOnce = (site) => logged.push(site);
    let t = 100000; e._lastTickT = t;
    e._watchdog(t); t += 2000; e._watchdog(t);
    ok("a loop that ticked recently is left alone", enables === 0 && !e._watchdogGaveUp && !e._watchdogTrips);
    t += 2000; e._watchdog(t);
    ok("a loop silent past WATCHDOG_STALE_MS is restarted, once, and the console told", enables === 1 && e._watchdogTrips === 1 && !e._watchdogGaveUp && logged.length === 1, { enables, logged, trips: e._watchdogTrips });
    e._lastTickT = t; t += 2000; e._watchdog(t);
    ok("...and left alone again while it ticks", enables === 1);
    t += 4000; e._watchdog(t);
    ok("an interval that was itself late is the main thread blocked, not the loop dead", enables === 1 && e._watchdogTrips === 1);
    t += 2000; e._watchdog(t); t += 2000; e._watchdog(t);
    ok("a second stall restarts again and hands the native caret back", enables === 2 && e._watchdogTrips === 2 && e._watchdogGaveUp === true && classes === 1, { enables, trips: e._watchdogTrips, classes });
    ok("...which hideNativeActive honours", e.hideNativeActive() === false);
    e.enable();
    ok("...until the next enable", e._watchdogGaveUp === false);
    const h = mk(); h.canvasEngineActive = true; h.canvas = { ownerDocument: { visibilityState: "hidden" } };
    h.enable = () => { throw new Error("must not restart"); };
    h._lastTickT = 1; h._watchdogLastT = 98000; h._watchdog(100000);
    ok("a hidden document never trips (no animation frames there, by design)", h._lastTickT === 100000 && !h._watchdogTrips);
    const off = mk(); off.canvasEngineActive = false; off.enable = () => { throw new Error("must not restart"); }; off._lastTickT = 1; off._watchdogLastT = 98000;
    off._watchdog(100000);
    ok("nor an engine that is off", !off._watchdogTrips);
    ok("the watchdog runs on an interval from onload", /this\._watchdog\(performance\.now\(\)\), WATCHDOG_INTERVAL_MS\)/.test(src("plugin.ts")));
    ok("the tick stamps its time for it", /this\._lastTickT = performance\.now\(\);/.test(src("engine.ts")));
  }

  // --- the Vim status bar's interval runs only with the indicator ------------------
  {
    const e = mk({ vimModeEnabled: true, vimStatusBar: true });
    const timers = [];
    const realSI = window.setInterval, realCI = window.clearInterval;
    window.setInterval = (fn, ms) => { timers.push(ms); return timers.length; };
    window.clearInterval = (id) => { timers[id - 1] = "cleared"; };
    try {
      const el = { addClass() {}, remove() {}, setText() {}, setCssStyles() {}, style: {}, ownerDocument: { body: { classList: { contains: () => true } } } };
      e.addStatusBarItem = () => el;
      e.statusBarVimMode = () => null;
      e.syncVimStatusBar();
      ok("the indicator's 250 ms backstop starts with the indicator", e.vimStatusEl === el && timers[0] === 250 && e._vimStatusTimer === 1, timers);
      e.syncVimStatusBar();
      ok("...once", timers.length === 1);
      e.settings.vimModeEnabled = false; e.syncVimStatusBar();
      ok("...and stops with it", e.vimStatusEl === null && timers[0] === "cleared" && e._vimStatusTimer === 0, timers);
      const cua = mk({ vimModeEnabled: false }); cua.addStatusBarItem = () => el; cua.statusBarVimMode = () => null;
      cua.syncVimStatusBar();
      ok("in CUA mode there is no indicator and no timer (it used to tick four times a second for everyone)", cua.vimStatusEl == null && !cua._vimStatusTimer);
      ok("onload registers no such interval any more", !/setInterval\(\(\) => this\.updateVimStatusBar\(\)/.test(src("plugin.ts")));
    } finally { window.setInterval = realSI; window.clearInterval = realCI; }
  }

  // --- one blink clock -------------------------------------------------------------
  {
    // The formula blinkAlphaAt had until 1.5.8, as the oracle.
    const oracle = (nowMs, speed, onOffBalance = 0.5, fade = 0.15) => {
      if (speed <= 0) return 1;
      const period = 2500 / speed; const phase = (nowMs % period) / period;
      fade = Math.max(0.02, Math.min(0.5, fade ?? 0.15)); const balance = Math.max(0.1, Math.min(0.9, onOffBalance));
      const hold = 1 - fade * 2; const p1 = hold * balance, p2 = p1 + fade, p3 = p2 + hold * (1 - balance);
      if (phase < p1) return 1; if (phase < p2) return 1 - T.easeInOutSine((phase - p1) / fade); if (phase < p3) return 0; return T.easeInOutSine((phase - p3) / fade);
    };
    let worst = 0, n = 0;
    for (const [speed, bal, fade] of [[1, 0.5, 0.15], [1.2, 0.3, 0.05], [0.4, 0.9, 0.5], [3, 0.1, 0.02], [2, 0.7, 0.9], [0, 0.5, 0.15]]) {
      for (let t = 0; t < 9000; t += 13) { worst = Math.max(worst, Math.abs(oracle(t, speed, bal, fade) - T.blinkAlphaAt(t, speed, bal, fade))); n++; }
    }
    ok(`blinkAlphaAt over blinkSegments matches its old self over ${n} samples`, worst === 0, worst);
    ok("blinkPhase reads the same clock for blink-to-solid", /stopAfter \* blinkSegments\(speed\)\.period/.test(src("paint-blink.ts")));
  }
}
