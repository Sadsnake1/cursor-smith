// What every test file shares: the plugin under test, its test surface,
// the assertion, the section banner, `later` for a section that has to
// observe an await (the runner runs those thunks in order at the end), and
// the engine builders several areas use. test/test.js is the runner; the
// files are test/cases/*.js, one per area.
const Plugin = require("./harness");
const T = Plugin.__test;

const state = { fails: 0, passes: 0, deferred: [] };
function ok(name, cond, extra) {
  if (cond) { state.passes++; console.log("  pass  " + name); }
  else { state.fails++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
function section(s) { console.log("\n== " + s + " =="); }
function later(fn) { state.deferred.push(fn); }

// --- shared helpers (they were section-level in the one-file suite) -----------
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

const D = T.DEFAULT_SETTINGS;

const { renderPanel } = require("./panel_harness");

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

// The plugin's source files by name, wherever they sit under src/ (grouped
// into folders since 2026-09-27, every name kept and unique): a test reads
// "engine.ts" without knowing its folder. srcFiles lists every one.
const SRC_DIR = require("path").join(__dirname, "..", "src");
function srcFiles(dir = SRC_DIR) {
  const out = [];
  for (const e of require("fs").readdirSync(dir, { withFileTypes: true })) {
    const p = require("path").join(dir, e.name);
    if (e.isDirectory()) out.push(...srcFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}
const SRC_INDEX = new Map(srcFiles().map((p) => [require("path").basename(p), p]));
function srcPath(name) {
  const p = SRC_INDEX.get(require("path").basename(name));
  if (!p) throw new Error("no source file named " + name);
  return p;
}

module.exports = { Plugin, T, ok, section, later, state, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx, srcPath, srcFiles };
