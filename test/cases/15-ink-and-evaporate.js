// Fresh ink (a part of Typewriter) and Backspace evaporation (a part of Pop
// effects; Smoke on delete, then Evaporate on delete, before): two effects
// on trial (2026-09-27), each in its own source file.
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
    const e = makeEngine(Object.assign({ typewriter: true, typewriterFreshInk: true }, settings));
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
  const off = mk({ typewriterFreshInk: false });
  off.spawnFreshInk(v, last, 4, 5);
  ok("switched off, no ink", off.inkMarks.length === 0);
  const noTw = mk({ typewriter: false });
  noTw.spawnFreshInk(v, last, 4, 5);
  ok("a part of Typewriter: with Typewriter off, no ink", noTw.inkMarks.length === 0);

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
    const d = makeEngine(Object.assign({ typewriter: true, typewriterFreshInk: true, typewriterFreshInkMs: 1500, typewriterFreshInkStrength: 0.8 }, settings));
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
  const offd = draw("hi", [now, now], { typewriterFreshInk: false });
  ok("switched off mid-stroke: dropped", offd.inkMarks.length === 0 && offd.ctx.calls.length === 0);
}

// ---------------------------------------------------------------------------
section("Fresh ink: where it hooks in");
{
  // A keystroke goes through resolveHoldChar, where the pops are spawned.
  const e = makeEngine({ typewriter: true, typewriterFreshInk: true, popEffects: false });
  e.inkMarks = []; e._inkView = null; e.particles = [];
  const v = mkView("abcde", 5);
  e.app = { workspace: { activeEditor: { editor: { cm: v } } } };
  e.lastActive = Object.assign({ pos: 4, docLen: 4, x: 140, top: 50, h: 24 }, last);
  const got = e.resolveHoldChar(Object.assign({ pos: 5, docLen: 5 }, last));
  ok("a typed letter is inked", got === "e" && e.inkMarks.length === 1 && e.inkMarks[0].text === "e", e.inkMarks);
  ok("the keys are in every look, appended", ["typewriterFreshInk", "typewriterFreshInkMs", "typewriterFreshInkStrength"].every((k) => T.LOOK_KEYS.includes(k)));
  ok("off by default", T.DEFAULT_SETTINGS.typewriterFreshInk === false);
  ok("wet ink keeps the frames coming", (() => { const f = Object.create(Plugin.prototype); f.settings = Object.assign({}, T.DEFAULT_SETTINGS); f.inkMarks = [{}]; return f._isAnimating(performance.now()) === true; })());
}

// ---------------------------------------------------------------------------
section("Backspace evaporation: what Backspace took");
{
  // The note kept at the last commit (before) and the note now (after).
  const mk = (before, after, settings = {}) => {
    const e = makeEngine(Object.assign({ backspaceEvaporate: true }, settings));
    e.evaporateGlyphs = [];
    e.measureCharWidth = () => 10;
    e._deletionDoc = docOf(before);
    e.app = { workspace: { activeEditor: { editor: { cm: mkView(after, 0) } } } };
    return e;
  };
  const rec = (pos, docLen, x, extra = {}) => Object.assign({ pos, docLen, x, top: 50, h: 24, rowLeft: 100, actualCharWidth: 10, letterSpacing: 0 }, last, extra);

  const e = mk("say hello", "say hell");
  e._deletionFx(rec(9, 9, 190), rec(8, 8, 180));
  ok("Backspace: the letter it took, where it stood",
     e.evaporateGlyphs.length === 1 && e.evaporateGlyphs[0].char === "o" && e.evaporateGlyphs[0].x === 180 && e.evaporateGlyphs[0].top === 50, e.evaporateGlyphs);
  ok("...in the text's own colour", e.evaporateGlyphs[0].color === "#cccccc");

  const w = mk("say hello", "say ");
  w._deletionFx(rec(9, 9, 190), rec(4, 4, 140));
  ok("a whole word: every letter, laid out leftwards from the caret",
     w.evaporateGlyphs.map((g) => g.char).join("") === "olleh" && w.evaporateGlyphs[4].x === 140, w.evaporateGlyphs.map((g) => [g.char, g.x]));
  ok("...lifting off right to left", w.evaporateGlyphs[0].delay === 0 && w.evaporateGlyphs[4].delay > w.evaporateGlyphs[1].delay);

  const sp = mk("say hello", "say");
  sp._deletionFx(rec(9, 9, 190), rec(3, 3, 130));
  ok("a space takes its room but nothing rises from it", sp.evaporateGlyphs.length === 5 && sp.evaporateGlyphs[4].x === 140, sp.evaporateGlyphs.map((g) => [g.char, g.x]));

  const j = mk("ab\ncd", "abcd");
  j._deletionFx(rec(3, 5, 100), rec(2, 4, 120));
  ok("joining two lines evaporates nothing", j.evaporateGlyphs.length === 0);
  const big = mk("x".repeat(60), "");
  big._deletionFx(rec(60, 60, 700), rec(0, 0, 100));
  ok("a wiped selection does not evaporate", big.evaporateGlyphs.length === 0);
  const other = mk("say hello", "say hell");
  other._deletionFx(rec(9, 10, 190), rec(8, 8, 180));
  ok("a kept note that is not the one the caret stood in: nothing", other.evaporateGlyphs.length === 0);
  const notDel = mk("say hello!", "say hell?");
  notDel._deletionFx(rec(9, 10, 190), rec(8, 9, 180));
  ok("a change that is not exactly that deletion: nothing", notDel.evaporateGlyphs.length === 0);
  const off = mk("say hello", "say hell", { backspaceEvaporate: false });
  off._deletionFx(rec(9, 9, 190), rec(8, 8, 180));
  ok("switched off, nothing", off.evaporateGlyphs.length === 0);
  const noPop = mk("say hello", "say hell", { popEffects: false });
  noPop._deletionFx(rec(9, 9, 190), rec(8, 8, 180));
  ok("a part of Pop effects: with the group off, nothing", noPop.evaporateGlyphs.length === 0);
  const noLetters = mk("say hello", "say hell", { popLetters: false });
  noLetters._deletionFx(rec(9, 9, 190), rec(8, 8, 180));
  ok("...not of Popping letters: it works with them off", noLetters.evaporateGlyphs.length === 1);
  const none = mk("say hello", "say hell");
  none._deletionDoc = null;
  none._deletionFx(rec(9, 9, 190), rec(8, 8, 180));
  ok("with no note kept, nothing", none.evaporateGlyphs.length === 0);
  const row = mk("say hello", "say ");
  row._deletionFx(rec(9, 9, 190, { rowLeft: 175 }), rec(4, 4, 140));
  ok("letters that stood on the row above do not rise from this one", row.evaporateGlyphs.length === 1 && row.evaporateGlyphs[0].char === "o");

  const keep = mk("a", "b");
  keep._deletionRemember();
  ok("the note is kept at each commit", keep._deletionDoc === keep.app.workspace.activeEditor.editor.cm.state.doc);
  const keepOff = mk("a", "b", { backspaceEvaporate: false });
  keepOff._deletionRemember();
  ok("...and nothing is kept with the effect off", keepOff._deletionDoc === null);
  const carets = require("fs").readFileSync(srcPath("carets.ts"), "utf8");
  ok("a commit spawns it before it keeps the new note, for the primary caret",
     carets.includes("this._deletionFx(this.lastActive, caret)") && carets.indexOf("this._deletionFx(this.lastActive, caret)") < carets.indexOf("this._deletionRemember();"));
}

// ---------------------------------------------------------------------------
section("Backspace evaporation: the rise");
{
  const e = Object.create(Plugin.prototype);
  const g = { h: 20, phase: 0, drift: 0 };
  const p0 = e.evaporatePose(g, 0, 1.2), p5 = e.evaporatePose(g, 0.5, 1.2), p1 = e.evaporatePose(g, 1, 1.2);
  ok("it lifts off where it stood, solid", p0.dx === 0 && p0.dy === 0 && p0.scale === 1 && p0.alpha === 1, p0);
  ok("...rises, spreads and fades", p5.dy < 0 && p5.scale > 1 && p5.alpha < 1 && p5.alpha > 0, p5);
  ok("...to its height, gone at the end", Math.abs(p1.dy + 24) < 1e-9 && p1.alpha === 0, p1);

  const d = makeEngine({ backspaceEvaporate: true, backspaceEvaporateMs: 1000, backspaceEvaporateRise: 1 });
  d.ctx = textCtx();
  const t0 = performance.now();
  const glyph = (char, x, start) => ({ char, x, top: 50, h: 24, fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal", color: "#cccccc", start, delay: 0, phase: 0, drift: 0 });
  d.evaporateGlyphs = [glyph("o", 180, t0), glyph("x", 170, t0 - 5000)];
  d.drawEvaporate();
  ok("a drifting letter is drawn, a finished one dropped", d.ctx.calls.length === 1 && d.ctx.calls[0].t === "o" && d.evaporateGlyphs.length === 1, d.ctx.calls);
  ok("...starting on the real letter's baseline", Math.abs(d.ctx.calls[0].y - (50 + 14 + 3)) < 1, d.ctx.calls[0].y);
  ok("the keys are in every look, appended; off by default; stilled by reduced motion with Pop effects",
     ["backspaceEvaporate", "backspaceEvaporateMs", "backspaceEvaporateRise"].every((k) => T.LOOK_KEYS.includes(k)) && T.DEFAULT_SETTINGS.backspaceEvaporate === false && T.REDUCED_MOTION_OFF_KEYS.includes("popEffects"));
  ok("rising letters keep the frames coming", (() => { const f = Object.create(Plugin.prototype); f.settings = Object.assign({}, T.DEFAULT_SETTINGS); f.evaporateGlyphs = [{}]; return f._isAnimating(performance.now()) === true; })());
}

// ---------------------------------------------------------------------------
section("Fresh ink: a gradient cursor");
{
  // It was the ramp's first stop alone, flat: "Fresh ink doesn't work for
  // a gradient cursor" - a first stop near the text's colour hid it.
  const d = makeEngine({ typewriter: true, typewriterFreshInk: true, typewriterFreshInkMs: 1500, typewriterFreshInkStrength: 1,
    gradientEnabled: true, gradientCount: 2, gradientDark1: "#ff0000", gradientDark2: "#0000ff" });
  d.ctx = textCtx(); d._canvasDpr = 1; d._canvasRect = null;
  const text = "abcdef";
  const vw = mkView(text, text.length);
  d.app = { workspace: { activeEditor: { editor: { cm: vw } } } };
  d._inkView = vw;
  const now = performance.now();
  d.inkMarks = [{ from: 0, text, times: [...text].map(() => now), color: "#ff0000", fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal" }];
  d.drawFreshInk();
  const fills = d.ctx.calls.map((c) => c.fill);
  const want = (pos) => { const [r, g, b] = d.sampleRamp(pos / 10, true); return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`; };
  ok("with Gradient on, each letter takes the ramp's colour at its place", fills.length === 6 && fills.every((f, i) => f === want(i)), fills);
  ok("...so a word carries more than one colour", new Set(fills).size > 3, fills);
  ok("...starting from the first stop", fills[0] === "rgb(255, 0, 0)", fills[0]);
}

// ---------------------------------------------------------------------------
section("Backspace evaporation: what Delete took");
{
  // Delete takes the text after the caret and leaves the caret where it was.
  const mk = (before, after, settings = {}) => {
    const e = makeEngine(Object.assign({ backspaceEvaporate: true }, settings));
    e.evaporateGlyphs = [];
    e.measureCharWidth = () => 10;
    e._deletionDoc = docOf(before);
    e.app = { workspace: { activeEditor: { editor: { cm: mkView(after, 0) } } } };
    return e;
  };
  const rec = (pos, docLen, x, extra = {}) => Object.assign({ pos, docLen, x, top: 50, h: 24, rowLeft: 100, rowRight: 400, actualCharWidth: 10, letterSpacing: 0 }, last, extra);

  const one = mk("abc", "ac");
  one._deletionFx(rec(1, 3, 110), rec(1, 2, 110));
  ok("Delete: the letter after the caret, where it stood", one.evaporateGlyphs.length === 1 && one.evaporateGlyphs[0].char === "b" && one.evaporateGlyphs[0].x === 110, one.evaporateGlyphs);
  const word = mk("say hello world", "say  world");
  word._deletionFx(rec(4, 15, 140), rec(4, 10, 140));
  ok("Ctrl+Delete: the word, laid out rightwards from the caret",
     word.evaporateGlyphs.map((g) => g.char).join("") === "hello" && word.evaporateGlyphs[0].x === 140 && word.evaporateGlyphs[4].x === 180, word.evaporateGlyphs.map((g) => [g.char, g.x]));
  ok("...lifting off left to right, the nearest first", word.evaporateGlyphs[0].delay === 0 && word.evaporateGlyphs[4].delay > word.evaporateGlyphs[1].delay);
  const join = mk("ab\ncd", "abcd");
  join._deletionFx(rec(2, 5, 120), rec(2, 4, 120));
  ok("Delete at a line's end joins the lines: nothing rises", join.evaporateGlyphs.length === 0);
  const edge = mk("say hello", "say ");
  edge._deletionFx(rec(4, 9, 140, { rowRight: 165 }), rec(4, 4, 140));
  ok("letters past the row's end are not raised on this row", edge.evaporateGlyphs.map((g) => g.char).join("") === "he", edge.evaporateGlyphs.map((g) => g.char));
  const elsewhere = mk("say hello", "sy hello");
  elsewhere._deletionFx(rec(4, 9, 140), rec(4, 8, 140));
  ok("a letter gone from somewhere else, the caret still: nothing", elsewhere.evaporateGlyphs.length === 0);

  // The frames the caret sits still (updateActivePoint): where Delete is seen.
  const still = mk("abc", "ac");
  still._deletePending = performance.now();
  still._deletionStill(rec(1, 3, 110), rec(1, 2, 110));
  ok("a still frame after Delete raises the letter", still.evaporateGlyphs.length === 1 && still.evaporateGlyphs[0].char === "b");
  ok("...and keeps the note it now is", still._deletionDoc === still.app.workspace.activeEditor.editor.cm.state.doc);
  const quiet = mk("abc", "ac");
  quiet._deletePending = 0;
  quiet._deletionStill(rec(1, 3, 110), rec(1, 2, 110));
  ok("with no Delete pressed, nothing rises - the note is kept all the same", quiet.evaporateGlyphs.length === 0 && quiet._deletionDoc === quiet.app.workspace.activeEditor.editor.cm.state.doc);
  const same = mk("abc", "abc");
  same._deletionDoc = same.app.workspace.activeEditor.editor.cm.state.doc;
  same._deletePending = performance.now();
  same._deletionStill(rec(1, 3, 110), rec(1, 3, 110));
  ok("the same note: nothing to read", same.evaporateGlyphs.length === 0);
  const off = mk("abc", "ac", { backspaceEvaporate: false });
  off._deletePending = performance.now();
  off._deletionStill(rec(1, 3, 110), rec(1, 2, 110));
  ok("switched off: nothing, and no note kept", off.evaporateGlyphs.length === 0 && off._deletionDoc === null);
  const carets = require("fs").readFileSync(srcPath("carets.ts"), "utf8");
  ok("the still frames hand it the caret before it is replaced, both of them",
     carets.split("this._deletionStill(this.lastActive, caret);").length === 3);
}

// ---------------------------------------------------------------------------
section("Backspace evaporation: in the panel");
{
  const rows = renderPanel({ popEffects: true, popLetters: true, backspaceEvaporate: true });
  rows.tab._effectsPick = "popEffects";
  rows.tab.refreshDomState();
  const names = rows.filter((r) => r.visible).map((r) => r.name);
  const at = (n) => names.indexOf(n);
  ok("a Pop effect of its own, right after Backspace disintegration",
     at("Backspace disintegration") >= 0 && at("Backspace evaporation") === at("Backspace disintegration") + 1 && at("Popping letters") < at("Backspace disintegration"), names);
  ok("...with its time and height under it", at("Evaporation time") === at("Backspace evaporation") + 1 && at("Evaporation height") === at("Backspace evaporation") + 2, names);
  const row = (n) => rows.find((r) => r.name === n);
  ok("...at the burst's level, its sliders one in",
     row("Backspace evaporation").settingEl.classes.includes("cursor-smith-sub-1") && row("Evaporation time").settingEl.classes.includes("cursor-smith-sub-2"));
  const noLetters = renderPanel({ popEffects: true, popLetters: false, backspaceEvaporate: true });
  noLetters.tab._effectsPick = "popEffects";
  noLetters.tab.refreshDomState();
  ok("shown with Popping letters off", noLetters.some((r) => r.visible && r.name === "Backspace evaporation"));
  const noPop = renderPanel({ popEffects: false, backspaceEvaporate: true });
  noPop.tab._effectsPick = "popEffects";
  noPop.tab.refreshDomState();
  ok("hidden with Pop effects off", !noPop.some((r) => r.visible && r.name === "Backspace evaporation"));
}

// ---------------------------------------------------------------------------
section("Backspace disintegration: along the letters, both ways");
{
  // "Make it work for Delete and Ctrl+Backspace and all that": the burst goes
  // into each deleted letter's cell, not only where the caret stood, and
  // Delete - which never moved the caret, so never committed - bursts too.
  const mk = (before, after, settings = {}) => {
    const e = makeEngine(Object.assign({ backspaceDisintegrate: true, backspaceEvaporate: false }, settings));
    e.evaporateGlyphs = []; e.flamePixels = [];
    e.measureCharWidth = () => 10;
    e._deletionDoc = docOf(before);
    e.app = { workspace: { activeEditor: { editor: { cm: mkView(after, 0) } } } };
    return e;
  };
  const rec = (pos, docLen, x, extra = {}) => Object.assign({ pos, docLen, x, top: 50, h: 24, w: 10, rowLeft: 100, rowRight: 400, actualCharWidth: 10, letterSpacing: 0 }, last, extra);
  const xs = (e) => e.flamePixels.map((p) => p.x);
  const inCell = (e, x0, x1) => e.flamePixels.some((p) => p.x >= x0 && p.x < x1);

  const one = mk("say hello", "say hell");
  ok("Backspace: the burst in the letter's cell", one._deletionFx(rec(9, 9, 190), rec(8, 8, 180)) === true && one.flamePixels.length >= 10 && xs(one).every((x) => x >= 180 && x <= 190), xs(one));
  const word = mk("say hello", "say ");
  word._deletionFx(rec(9, 9, 190), rec(4, 4, 140));
  ok("Ctrl+Backspace: along the whole word, first letter to last", inCell(word, 140, 150) && inCell(word, 180, 190) && xs(word).every((x) => x >= 140 && x <= 190), xs(word));
  ok("...thinner in each letter than a single burst", word.flamePixels.length < 5 * 18 && word.flamePixels.length >= 5 * 3, word.flamePixels.length);

  const del = mk("say hello world", "say  world");
  del._deletePending = performance.now();
  del._deletionStill(rec(4, 15, 140), rec(4, 10, 140));
  ok("Ctrl+Delete: the word after the caret bursts, though the caret never moved", inCell(del, 140, 150) && inCell(del, 180, 190) && xs(del).every((x) => x >= 140 && x <= 190), xs(del));
  const single = mk("abc", "ac");
  single._deletePending = performance.now();
  single._deletionStill(rec(1, 3, 110), rec(1, 2, 110));
  ok("Delete: one letter, one burst in its cell", single.flamePixels.length >= 10 && xs(single).every((x) => x >= 110 && x <= 120), xs(single));

  const blind = mk("x".repeat(60), "");
  blind._deletePending = performance.now();
  blind._deletionStill(rec(0, 60, 100), rec(0, 0, 100));
  ok("a deletion too long to lay out still bursts, where the caret is", blind.flamePixels.length >= 10 && xs(blind).every((x) => x >= 100 && x <= 110), xs(blind));
  const none = mk("say hello", "say hell");
  none._deletionDoc = null;
  ok("with no note kept, the letters are unknown: the caller makes the one burst", none._deletionFx(rec(9, 9, 190), rec(8, 8, 180)) === false && none.flamePixels.length === 0);
  const space = mk("say ", "say");
  ok("a space alone has no cell to burst in: the one burst where the caret stood", space._deletionFx(rec(4, 4, 140), rec(3, 3, 130)) === false);
  const offd = mk("say hello", "say hell", { backspaceDisintegrate: false });
  ok("switched off: no burst", offd._deletionFx(rec(9, 9, 190), rec(8, 8, 180)) === false && offd.flamePixels.length === 0);
  const noPop = mk("say hello", "say hell", { popEffects: false });
  ok("...nor with Pop effects off", noPop._deletionFx(rec(9, 9, 190), rec(8, 8, 180)) === false && noPop.flamePixels.length === 0);
  const both = mk("say hello", "say ", { backspaceEvaporate: true });
  both._deletionFx(rec(9, 9, 190), rec(4, 4, 140));
  ok("with Backspace evaporation on too, the letters burst and rise", both.flamePixels.length > 0 && both.evaporateGlyphs.map((g) => g.char).join("") === "olleh");
  const keep = mk("a", "b", { backspaceEvaporate: false });
  keep._deletionRemember();
  ok("the note is kept for the burst alone", keep._deletionDoc === keep.app.workspace.activeEditor.editor.cm.state.doc);
  const carets = require("fs").readFileSync(srcPath("carets.ts"), "utf8");
  ok("a commit makes the one burst where the caret stood only when the letters did not get it",
     carets.includes("if (!(disintegrate && burstAlong)) this.spawnFlamePixels(this.lastActive, disintegrate);"));
}
