// Visual regression: what a frame paints, pinned.
//
// The suite pins structure and behavior thoroughly; nothing pinned how a
// frame LOOKS, so a paint regression relied on someone noticing. This is
// the net: an engine with no DOM draws a short script of frames into a
// context that records every 2D call - method, arguments rounded to two
// decimals, every property set - and the recording is compared to a golden
// file per scenario in test/goldens/. A scenario is one shipped preset (or
// the defaults) through the same script: the caret at rest, a keystroke,
// a longer jump, and the frames after each, with the spawners the tick
// would run. Time and randomness are pinned (a virtual clock and a seeded
// PRNG stand in for performance.now and Math.random for the run), so the
// recording is a pure function of the paint code.
//
// A difference is a failure that names the scenario, the frame and the
// first op that differs, with both sides. When the change is intended:
//
//     UPDATE_GOLDENS=1 npm test
//
// rewrites the files; the diff of test/goldens/ in the hand-over is then
// the record of what the paint change did. Do not update goldens to make
// a failure go away without reading the diff.
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "goldens");

// --- The recorder ----------------------------------------------------------
const round = (v) => (typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 100) / 100 : String(v)) : v);
function fmt(v) {
  if (typeof v === "number") return round(v);
  if (typeof v === "string" || typeof v === "boolean" || v == null) return v;
  if (v && v.__gradient) return { gradient: v.stops };
  if (Array.isArray(v)) return v.map(fmt);
  if (typeof v === "object") return "[object]";
  return String(v);
}
function recordingCtx(ops) {
  const state = {
    globalAlpha: 1, fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowColor: "rgba(0, 0, 0, 0)", shadowOffsetX: 0, shadowOffsetY: 0,
    font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", imageSmoothingEnabled: true, miterLimit: 10, lineDashOffset: 0,
  };
  const gradient = (kind, args) => {
    const g = { __gradient: true, stops: [], addColorStop(o, c) { g.stops.push([round(o), String(c)]); } };
    ops.push([kind, ...args.map(fmt)]);
    return g;
  };
  const ctx = new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in state) return state[prop];
      if (prop === "canvas") return { width: 0, height: 0 };
      if (prop === "measureText") return (t) => ({ width: 8 * String(t).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") return (...a) => gradient(prop, a);
      if (prop === "createPattern") return () => ({ __pattern: true });
      if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (prop === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (prop === "isPointInPath") return () => false;
      if (prop === "getLineDash") return () => [];
      return (...args) => { ops.push([prop, ...args.map(fmt)]); };
    },
    set(_, prop, v) {
      if (state[prop] !== v) { state[prop] = v; ops.push(["=" + String(prop), fmt(v)]); }
      return true;
    },
  });
  return ctx;
}

// --- Determinism -------------------------------------------------------------
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pinned(run) {
  const random = Math.random;
  const now = performance.now;
  const dateNow = Date.now;
  const clock = { t: 100000 };
  Math.random = seeded(20260918);
  performance.now = () => clock.t;
  Date.now = () => 1758153600000 + clock.t;
  try { return run(clock); } finally { Math.random = random; performance.now = now; Date.now = dateNow; }
}

// --- The engine with no DOM ------------------------------------------------
const caretAt = (x, top, pos, ch) => ({
  x, top, bottom: top + 24, h: 24, w: 8, actualCharWidth: 8, rowLeft: 100, rowRight: 900,
  char: ch, textColor: "#dcdcdc", fontSize: 16, fontFamily: "monospace", fontWeight: "400", fontStyle: "normal", letterSpacing: 0,
  focused: true, pos, assoc: 1, empty: true, visible: true, holdChar: null,
});

function makeGoldenEngine(T, Plugin, look, ops) {
  const e = Object.create(Plugin.prototype);
  e._resetEngineState();
  e.settings = Object.assign({}, T.DEFAULT_SETTINGS, T.presetWithDefaults(look));
  e.manifest = { version: "0.0.0-golden" };
  e.app = { workspace: { activeEditor: null }, vault: { getConfig: () => false } };
  e.canvas = { width: 0, height: 0, style: {}, ownerDocument: { defaultView: { devicePixelRatio: 1 } } };
  e.ctx = recordingCtx(ops);
  e._clipRect = { x: 100, y: 50, w: 1000, h: 700 };
  e._wrapperPos = { left: 100, top: 50 };
  e._canvasRect = null;
  e._canvasDpr = 0;
  e._dirtyFull = true;
  e.isDarkTheme = () => true;
  e.reducedMotion = () => false;
  e.windowFocused = () => true;
  // No editor to read the typed character back from; the record carries it.
  e.resolveHoldChar = (c) => c.char || null;
  e.hotSyncScroll = () => {};
  e.getCaretClipRect = () => e._clipRect;
  e.getFullViewportRect = () => e._clipRect;
  e.getPaneRect = () => e._clipRect;
  e.noteEditorFocused = () => true;
  e.bracketTetherCoords = () => null;
  e.mergeTethers = (t) => t;
  e.updateSecondaryCarets = () => {};
  e.rematchCaretStates = () => {};
  e._reportOnce = (site, err) => { throw err instanceof Error ? err : new Error(site + ": " + String(err)); };
  return e;
}

// One frame of what the tick does between measuring and drawing.
function frame(e, caret) {
  e.updateActivePoint(caret);
  e.updateSmoothCursor();
  e.updateSmearQuad();
  e.pruneTrail();
  if (e.heat > 0) { e.heat *= 0.985; if (e.heat < 0.001) e.heat = 0; }
  if (e.look.speedDemon && e.look.speedDemonSparks && e.animActive) e.maybeSpawnSpeedDemonSparks();
  e.updateHotHeadInertia();
  if (e.styleFor("hotHead") && e.animActive) e.maybeSpawnHotHead();
  e.maybeSpawnStardust();
  e._fitCanvasRegion();
  e.draw();
}

// The script every scenario runs: rest, a keystroke, frames, a jump to
// another line, frames. Frame `k` of the recording is the ops of draw
// number k.
function runScenario(T, Plugin, look) {
  return pinned((clock) => {
    const ops = [];
    const e = makeGoldenEngine(T, Plugin, look, ops);
    const frames = [];
    const snap = (label) => { frames.push({ label, ops: ops.splice(0, ops.length) }); };
    const tick = (caret, ms = 16) => { clock.t += ms; frame(e, caret); };
    let c = caretAt(200, 300, 10, "a");
    tick(c); snap("rest");
    tick(c, 400); snap("rest 400ms later");
    c = caretAt(208, 300, 11, "b");
    tick(c); snap("a keystroke");
    tick(c); snap("+16ms");
    tick(c); tick(c); tick(c); snap("+64ms");
    tick(c, 200); snap("+264ms");
    c = caretAt(420, 348, 40, "z");
    tick(c); snap("a jump to the next line");
    tick(c); snap("+16ms");
    tick(c); tick(c); tick(c); tick(c); snap("+80ms");
    tick(c, 300); snap("+380ms");
    tick(c, 1500); snap("+1880ms, at rest");
    return frames;
  });
}

// The torch paints its own overlay, not the cursor canvas: two pure
// painters (torch-paint.ts) called the way the torch tick calls them, with
// the look's radius, darkness and color, for a spot at the caret and for
// two spots (a secondary caret), on a phone-sized overlay.
function runTorchScenario(T) {
  return pinned(() => {
    const look = Object.assign({}, T.DEFAULT_SETTINGS, { torchEffect: true });
    const frames = [];
    for (const [label, spots] of [["one spot", [{ x: 200, y: 312 }]], ["two spots", [{ x: 200, y: 312 }, { x: 420, y: 360 }]], ["a spot near the edge", [{ x: 30, y: 20 }]]]) {
      const ops = [];
      const ctx = recordingCtx(ops);
      T.paintTorchDarkness(ctx, 384, 800, spots, look.overlayRadius, look.overlayDarkness);
      const dark = ops.splice(0, ops.length);
      T.paintTorchGlow(ctx, 384, 800, spots, look.overlayRadius, "255, 150, 60");
      frames.push({ label: label + ", darkness", ops: dark });
      frames.push({ label: label + ", glow", ops: ops.splice(0, ops.length) });
    }
    return frames;
  });
}

// --- The comparison ------------------------------------------------------------
function compare(name, got, want) {
  if (!want) return `no golden for "${name}" (run with UPDATE_GOLDENS=1 to write it)`;
  if (got.length !== want.length) return `${name}: ${got.length} frames, golden has ${want.length}`;
  for (let f = 0; f < got.length; f++) {
    const a = got[f].ops, b = want[f].ops;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = JSON.stringify(a[i]), y = JSON.stringify(b[i]);
      if (x !== y) return `${name}, frame ${f} ("${got[f].label}"), op ${i} of ${a.length} (golden ${b.length}):\n      now:    ${x ?? "(none)"}\n      golden: ${y ?? "(none)"}`;
    }
  }
  return null;
}

function goldenFile(name) { return path.join(DIR, name.replace(/[^\w.-]+/g, "_") + ".json"); }

// Runs every scenario; returns [{ name, error }] with error null on a match.
// With UPDATE_GOLDENS set, writes the goldens instead and reports what changed.
// The shipped presets, the defaults, and the effects no shipped preset
// carries - Hot-head (the heaviest painter), Speed demon's sparks,
// Stardust, the pops - each as a synthetic look; and the torch's overlay.
const EXTRA = {
  "hot-head": { cursorStyle: "Box", hotHead: true, hotHeadQuantity: 1.5, hotHeadSpread: 3, hotHeadTrail: 8, smoothEnabled: true },
  "speed-demon sparks": { speedDemon: true, speedDemonSparks: true, cursorStyle: "Line" },
  "stardust": { stardustEnabled: true, stardustAlwaysOn: true, stardustOrbit: true },
  "pops": { popEffects: true, popLetters: true, popDisintegrate: true, thunderstrike: true, fireworks: true },
};
function checkGoldens(T, Plugin) {
  const scenarios = [["defaults", {}], ...Object.entries(T.DEFAULT_PRESETS), ...Object.entries(EXTRA), ["torch", null]];
  const update = !!process.env.UPDATE_GOLDENS;
  if (update) fs.mkdirSync(DIR, { recursive: true });
  const out = [];
  for (const [name, look] of scenarios) {
    let frames;
    try { frames = look === null ? runTorchScenario(T) : runScenario(T, Plugin, look); }
    catch (err) { out.push({ name, error: `${name}: the scenario threw: ${err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err}` }); continue; }
    const file = goldenFile(name);
    const had = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    if (update) {
      const changed = compare(name, frames, had);
      fs.writeFileSync(file, JSON.stringify(frames, null, 0) + "\n");
      out.push({ name, error: null, wrote: true, changed: changed !== null });
    } else {
      out.push({ name, error: compare(name, frames, had), frames: frames.length, ops: frames.reduce((s, f) => s + f.ops.length, 0) });
    }
  }
  return out;
}

module.exports = { checkGoldens, runScenario, runTorchScenario, recordingCtx, pinned, EXTRA };
