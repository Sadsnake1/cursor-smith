// Fresh ink and Smoke on delete: two effects on trial (2026-09-27), each in
// its own source file and its own commit so either can go on its own.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx, srcPath, srcFiles } = require("../lib");

// A CodeMirror-shaped view over a string: every character 10 px wide from
// x = 100 on one 24 px row at y = 50, unless a test says otherwise.
const docOf = (s) => ({ length: s.length, sliceString: (a, b) => s.slice(a, b === undefined ? s.length : b) });
const mkView = (text, head, coordsAtPos) => ({
  state: { doc: docOf(text), selection: { main: { head } } },
  coordsAtPos: coordsAtPos || ((pos) => ({ left: 100 + pos * 10, right: 110 + pos * 10, top: 50, bottom: 74 })),
});
// A context that records the text it is asked to draw.
const textCtx = () => {
  const calls = [];
  return {
    calls, globalAlpha: 1, font: "", fillStyle: "", textAlign: "", textBaseline: "",
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    measureText: (s) => ({ width: 10 * [...s].length, fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 4 }),
    fillText(t, x, y) { calls.push({ t, x, y, a: this.globalAlpha, fill: this.fillStyle }); },
  };
};
const last = { fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal", textColor: "#cccccc" };

// ---------------------------------------------------------------------------
section("Fresh ink: the runs it keeps");
{
  const mk = (settings = {}) => {
    const e = makeEngine(Object.assign({ freshInk: true }, settings));
    e.inkMarks = []; e._inkView = null; e.ctx = textCtx(); e._canvasDpr = 1; e._canvasRect = null;
    return e;
  };
  const e = mk();
  const v = mkView("hello!", 5);
  e.spawnFreshInk(v, last, 4, 5);
  ok("a keystroke makes a wet run: its place, its text, when it went in",
     e.inkMarks.length === 1 && e.inkMarks[0].from === 4 && e.inkMarks[0].text === "o" && e.inkMarks[0].times.length === 1, e.inkMarks);
  ok("...in the cursor's colour", e.inkMarks[0].color === e.getActiveColor());
  e.spawnFreshInk(v, last, 5, 6);
  ok("typing on grows the same run", e.inkMarks.length === 1 && e.inkMarks[0].text === "o!" && e.inkMarks[0].times.length === 2, e.inkMarks);
  e.spawnFreshInk(v, last, 5, 6);
  ok("the same insertion seen twice adds nothing", e.inkMarks.length === 1 && e.inkMarks[0].text === "o!");
  e.spawnFreshInk(v, last, 0, 1);
  ok("typing somewhere else starts a run of its own", e.inkMarks.length === 2 && e.inkMarks[1].text === "h");
  e.spawnFreshInk(v, Object.assign({}, last, { fontWeight: "bold" }), 6, 6);
  ok("an empty insertion is nothing", e.inkMarks.length === 2);

  const p = mk();
  p.spawnFreshInk(mkView("a long pasted sentence", 22), last, 0, 22);
  ok("a paste is not typing: no ink", p.inkMarks.length === 0);
  p.spawnFreshInk(mkView("a\nb", 2), last, 1, 2);
  ok("...nor a new line", p.inkMarks.length === 0);
  const off = mk({ freshInk: false });
  off.spawnFreshInk(v, last, 4, 5);
  ok("switched off, no ink", off.inkMarks.length === 0);

  const cap = mk();
  const long = "x".repeat(200);
  const lv = mkView(long, 200);
  for (let i = 0; i < 20; i++) cap.spawnFreshInk(lv, last, i * 10, i * 10 + 10);
  const total = cap.inkMarks.reduce((n, m) => n + m.text.length, 0);
  ok("the wet letters are capped, the oldest going first", total === 80 && cap.inkMarks[0].from === 120, [total, cap.inkMarks[0] && cap.inkMarks[0].from]);

  const b = mk();
  b.spawnFreshInk(mkView("😀x", 2), last, 0, 3);
  b._inkTrimFront(b.inkMarks[0], 1);
  ok("the front is never cut through the middle of an emoji", b.inkMarks[0].text === "x" && b.inkMarks[0].from === 2, b.inkMarks[0]);
}

// ---------------------------------------------------------------------------
section("Fresh ink: finding a run after an edit");
{
  const e = Object.create(Plugin.prototype);
  const m = (from, text) => ({ from, text, times: [...text].map(() => 0), color: "#fff", fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal" });
  const at = m(3, "abc");
  ok("still where it was", e._inkLocate(docOf("xyzabc"), at, 6) === true && at.from === 3);
  const bs = m(3, "abc");
  ok("Backspace: cut back to what is left, the caret at its new end",
     e._inkLocate(docOf("xyza"), bs, 4) === true && bs.text === "a" && bs.times.length === 1, bs);
  const moved = m(3, "abc");
  ok("an edit before it: found where it went", e._inkLocate(docOf("12xyzabc"), moved, 8) === true && moved.from === 5, moved);
  const gone = m(3, "abc");
  ok("gone: dropped", e._inkLocate(docOf("zzzzzz"), gone, 2) === false);
  const one = m(3, "a");
  ok("a single letter is not chased: any letter nearby could be taken for it", e._inkLocate(docOf("1234a"), one, 5) === false);
}

// ---------------------------------------------------------------------------
section("Fresh ink: drying and drawing");
{
  const e = Object.create(Plugin.prototype);
  ok("fully wet at first", e.inkWetness(0, 1000) === 1 && e.inkWetness(300, 1000) === 1);
  const mid = e.inkWetness(650, 1000);
  ok("...drying after that", mid > 0 && mid < 1, mid);
  ok("...and dry at the end", e.inkWetness(1000, 1000) === 0 && e.inkWetness(5000, 1000) === 0);

  const draw = (text, times, settings = {}, view) => {
    const d = makeEngine(Object.assign({ freshInk: true, freshInkMs: 1500, freshInkStrength: 0.8 }, settings));
    d.ctx = textCtx(); d._canvasDpr = 1; d._canvasRect = null;
    const vw = view || mkView(text, text.length);
    d.app = { workspace: { activeEditor: { editor: { cm: vw } } } };
    d._inkView = vw;
    d.inkMarks = [{ from: 0, text, times, color: "#ff0000", fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal" }];
    d.drawFreshInk();
    return d;
  };
  const now = performance.now();
  const d = draw("hi", [now, now]);
  const c = d.ctx.calls;
  ok("each wet letter is drawn on its own, at its own place", c.length === 2 && c[0].t === "h" && c[1].t === "i" && c[0].x === 100 && c[1].x === 110, c);
  ok("...on the line's baseline, centred in the line box like the Box's letter", c[0].y === 50 + 14 + (24 - 14 - 4) / 2, c[0].y);
  ok("...in the ink colour at full strength while wet", c[0].fill === "#ff0000" && Math.abs(c[0].a - 0.8) < 1e-9, c[0]);
  ok("...and marks where it painted", d.dirty.length === 2);

  const dry = draw("hi", [now - 5000, now - 5000]);
  ok("dry ink is gone: nothing drawn, the run dropped", dry.ctx.calls.length === 0 && dry.inkMarks.length === 0);
  const half = draw("hi", [now - 5000, now]);
  ok("the dry front of a run is cut off, the wet rest kept",
     half.ctx.calls.length === 1 && half.ctx.calls[0].t === "i" && half.inkMarks[0].from === 1 && half.inkMarks[0].text === "i", half.inkMarks);
  const gap = draw("a b", [now, now, now]);
  ok("a space has nothing to ink", gap.ctx.calls.length === 2);
  const wrap = draw("ab", [now, now], {}, mkView("ab", 2, (pos) => (pos === 0 ? { left: 300, top: 50, bottom: 74 } : { left: 100, top: 74, bottom: 98 })));
  ok("a letter wrapped to the next row is inked there", wrap.ctx.calls[1].x === 100 && wrap.ctx.calls[1].y === 74 + 14 + 3, wrap.ctx.calls);
  const offscreen = draw("ab", [now, now], {}, mkView("ab", 2, (pos) => (pos === 0 ? null : { left: 110, top: 50, bottom: 74 })));
  ok("a letter CodeMirror cannot place is skipped", offscreen.ctx.calls.length === 1 && offscreen.ctx.calls[0].t === "b");

  const other = draw("hi", [now, now]);
  other._inkView = mkView("hi", 2);
  other.inkMarks = [{ from: 0, text: "hi", times: [now, now], color: "#f00", fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal" }];
  other.ctx.calls.length = 0;
  other.drawFreshInk();
  ok("another note in front: the ink is dropped", other.inkMarks.length === 0 && other.ctx.calls.length === 0);
  const offd = draw("hi", [now, now], { freshInk: false });
  ok("switched off mid-stroke: dropped", offd.inkMarks.length === 0 && offd.ctx.calls.length === 0);
}

// ---------------------------------------------------------------------------
section("Fresh ink: where it hooks in");
{
  // A keystroke goes through resolveHoldChar, where the pops are spawned.
  const e = makeEngine({ freshInk: true, popEffects: false, typewriter: false });
  e.inkMarks = []; e._inkView = null; e.particles = [];
  const v = mkView("abcde", 5);
  e.app = { workspace: { activeEditor: { editor: { cm: v } } } };
  e.lastActive = Object.assign({ pos: 4, docLen: 4, x: 140, top: 50, h: 24 }, last);
  const got = e.resolveHoldChar(Object.assign({ pos: 5, docLen: 5 }, last));
  ok("a typed letter is inked", got === "e" && e.inkMarks.length === 1 && e.inkMarks[0].text === "e", e.inkMarks);
  ok("the keys are in every look, appended", ["freshInk", "freshInkMs", "freshInkStrength"].every((k) => T.LOOK_KEYS.includes(k)));
  ok("off by default", T.DEFAULT_SETTINGS.freshInk === false);
  ok("wet ink keeps the frames coming", (() => { const f = Object.create(Plugin.prototype); f.settings = Object.assign({}, T.DEFAULT_SETTINGS); f.inkMarks = [{}]; return f._isAnimating(performance.now()) === true; })());
}
