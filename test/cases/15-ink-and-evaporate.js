// Fresh ink (a part of Typewriter) and Backspace evaporation (a part of Pop
// effects; Smoke on delete, then Evaporate on delete, before): two effects
// added in 1.7.0, each in its own source file.
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
  // Issue #41: a run whose end an input method rewrote - the pinyin
  // replaced by the characters chosen - and the commit not seen as typing.
  const py = m(3, "\u4f60\u597dshijie");
  ok("its end rewritten: what stands at its start stays wet, with its own times", e._inkLocate(docOf("xyz\u4f60\u597d\u4e16\u754cs"), py, 8) === true && py.text === "\u4f60\u597d" && py.times.length === 2, py);
  const emo = m(3, "\ud83d\ude00b");
  ok("...never half an emoji", e._inkLocate(docOf("xyz\ud83d\ude01"), emo, 5) === false, emo);
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

  const d = makeEngine({ backspaceEvaporate: true });
  d.ctx = textCtx();
  const t0 = performance.now();
  const glyph = (char, x, start) => ({ char, x, top: 50, h: 24, fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal", color: "#cccccc", start, delay: 0, phase: 0, drift: 0 });
  d.evaporateGlyphs = [glyph("o", 180, t0), glyph("x", 170, t0 - 5000)];
  d.drawEvaporate();
  ok("a drifting letter is drawn, a finished one dropped", d.ctx.calls.length === 1 && d.ctx.calls[0].t === "o" && d.evaporateGlyphs.length === 1, d.ctx.calls);
  ok("...starting on the real letter's baseline", Math.abs(d.ctx.calls[0].y - (50 + 14 + 3)) < 1, d.ctx.calls[0].y);
  ok("its key is in every look, appended; off by default; stilled by reduced motion with Pop effects",
     T.LOOK_KEYS.includes("backspaceEvaporate") && T.DEFAULT_SETTINGS.backspaceEvaporate === false && T.REDUCED_MOTION_OFF_KEYS.includes("popEffects"));
  ok("its time and height are baked in: no keys for them", !("backspaceEvaporateMs" in T.DEFAULT_SETTINGS) && !("backspaceEvaporateRise" in T.DEFAULT_SETTINGS) && !T.LOOK_KEYS.some((k) => /^backspaceEvaporate./.test(k)));
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
  const pickRow = rows.find((r) => r.name === "Letters on delete"), dd = pickRow && pickRow.dropdowns[0];
  ok("a choice of \"Letters on delete\", after Popping letters and the cursor's choice, chosen here",
     at("Letters on delete") > at("Cursor on delete") && at("Cursor on delete") > at("Popping letters") && !!dd && dd._value === "evaporate" && Object.keys(dd._options).join() === "vanish,burst,evaporate", names);
  ok("...with no sliders of its own: its time and height are baked in", !names.includes("Evaporation time") && !names.includes("Evaporation height"), names);
  const row = (n) => rows.find((r) => r.name === n);
  ok("...at Popping letters' level", row("Letters on delete").settingEl.classes.includes("cursor-smith-sub-1"));
  dd._change("burst");
  ok("...one at a time: Burst picked, evaporation off and the burst on - the cursor's choice untouched", rows.settings.backspaceEvaporate === false && rows.settings.backspaceDisintegrate === true && rows.settings.backMan === false);
  const rainbowOnly = renderPanel({ popEffects: true, popLetters: false, backspaceDisintegrate: false, thunderstrike: false, fireworks: false, backspaceEvaporate: true });
  rainbowOnly.tab._effectsPick = "popEffects";
  rainbowOnly.tab.refreshDomState();
  ok("Rainbow is offered with evaporation the only pop effect on: it recolours it", rainbowOnly.some((r) => r.visible && r.name === "Rainbow"));
  const noLetters = renderPanel({ popEffects: true, popLetters: false, backspaceEvaporate: true });
  noLetters.tab._effectsPick = "popEffects";
  noLetters.tab.refreshDomState();
  ok("shown with Popping letters off", noLetters.some((r) => r.visible && r.name === "Letters on delete"));
  const noPop = renderPanel({ popEffects: false, backspaceEvaporate: true });
  noPop.tab._effectsPick = "popEffects";
  noPop.tab.refreshDomState();
  ok("hidden with Pop effects off", !noPop.some((r) => r.visible && r.name === "Letters on delete"));
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
  ok("with evaporation on too (a look saved before the choices): one of them - they rise, no burst", both.flamePixels.length === 0 && both.evaporateGlyphs.map((g) => g.char).join("") === "olleh");
  const keep = mk("a", "b", { backspaceEvaporate: false });
  keep._deletionRemember();
  ok("the note is kept for the burst alone", keep._deletionDoc === keep.app.workspace.activeEditor.editor.cm.state.doc);
  const carets = require("fs").readFileSync(srcPath("carets.ts"), "utf8");
  ok("a commit makes the one burst where the caret stood only when the letters did not get it",
     carets.includes("if (!(disintegrate && burstAlong) && (disintegrate || trailOk)) this.spawnFlamePixels(this.lastActive, disintegrate);"));
}

// ---------------------------------------------------------------------------
section("Backspace evaporation: Rainbow");
{
  // "The rainbow modifier doesn't work for evaporation": it rose in the
  // text's colour whatever Rainbow said.
  const mk = (settings) => {
    const e = makeEngine(Object.assign({ backspaceEvaporate: true, backspaceDisintegrate: false }, settings));
    e.evaporateGlyphs = []; e.flamePixels = [];
    e.measureCharWidth = () => 10;
    e._deletionDoc = docOf("say hello");
    e.app = { workspace: { activeEditor: { editor: { cm: mkView("say ", 0) } } } };
    return e;
  };
  const rec = (pos, docLen, x) => Object.assign({ pos, docLen, x, top: 50, h: 24, w: 10, rowLeft: 100, rowRight: 400, actualCharWidth: 10, letterSpacing: 0 }, last);
  const on = mk({ popRainbow: true });
  on._deletionFx(rec(9, 9, 190), rec(4, 4, 140));
  const colors = on.evaporateGlyphs.map((g) => g.color);
  ok("with Rainbow on, each rising letter takes the sweep's next hue", colors.length === 5 && colors.every((c) => /^hsl|^rgb/.test(c) && c !== "#cccccc") && new Set(colors).size === 5, colors);
  const off = mk({ popRainbow: false });
  off._deletionFx(rec(9, 9, 190), rec(4, 4, 140));
  ok("...and with it off, the text's own colour", off.evaporateGlyphs.every((g) => g.color === "#cccccc"));
}

// ---------------------------------------------------------------------------
section("Fresh ink: keep the text's color");
{
  // "An option to keep the color of the text, so it doesn't colorize it with
  // the cursor's": the text's own color, drawn heavier while wet.
  const ink = (settings) => {
    const d = makeEngine(Object.assign({ typewriter: true, typewriterFreshInk: true, typewriterFreshInkStrength: 1 }, settings));
    const calls = [];
    d.ctx = Object.assign(textCtx(), { lineWidth: 1, strokeStyle: "", lineJoin: "", strokeText(t, x, y) { calls.push({ t, x, y, w: this.lineWidth, stroke: this.strokeStyle }); } });
    d._canvasDpr = 1; d._canvasRect = null;
    const vw = mkView("ab", 2);
    d.app = { workspace: { activeEditor: { editor: { cm: vw } } } };
    d._inkView = vw;
    const now = performance.now();
    d.inkMarks = [{ from: 0, text: "ab", times: [now, now], color: "#ff0000", textColor: "#cccccc", fontSize: 16, fontFamily: "Mono", fontWeight: "normal", fontStyle: "normal" }];
    d.drawFreshInk();
    return { fills: d.ctx.calls, strokes: calls };
  };
  const kept = ink({ typewriterFreshInkText: true });
  ok("with Keep text color the letters are filled in the text's color", kept.fills.length === 2 && kept.fills.every((c) => c.fill === "#cccccc"), kept.fills);
  ok("...and stroked in it too, the wet spread", kept.strokes.length === 2 && kept.strokes.every((c) => c.stroke === "#cccccc" && c.w > 0.3 && c.w <= 0.5), kept.strokes);
  const grad = ink({ typewriterFreshInkText: true, gradientEnabled: true, gradientCount: 2, gradientDark1: "#ff0000", gradientDark2: "#0000ff" });
  ok("...whatever the gradient says", grad.fills.every((c) => c.fill === "#cccccc"));
  const plain = ink({ typewriterFreshInkText: false });
  ok("off: the cursor's color, no spread", plain.fills.every((c) => c.fill === "#ff0000") && plain.strokes.length === 0);
  ok("its key is in every look, appended, off by default", T.LOOK_KEYS.includes("typewriterFreshInkText") && T.DEFAULT_SETTINGS.typewriterFreshInkText === false);
}

// ---------------------------------------------------------------------------
section("An input method's commit is typing (issue #38)");
{
  // Chinese typed with pinyin: "nihao" appears as it is typed, then the
  // characters chosen replace it. Fresh ink, the stamp and the popped letter
  // reached only the pinyin; the characters written got nothing.
  const before = "ok a", pinyin = "nihao", hanzi = "\u4f60\u597d";
  const mk = (text) => {
    const view = { state: { doc: { length: text.length, sliceString: (a, b) => text.slice(a, b === undefined ? text.length : b) }, selection: { main: { head: text.length } } },
      coordsAtPos: (pos) => ({ left: 100 + pos * 10, right: 110 + pos * 10, top: 50, bottom: 74 }) };
    return view;
  };
  const rec = (pos, docLen, x) => ({ x, top: 50, h: 24, pos, docLen, fontSize: 16, fontFamily: "serif", fontWeight: "400", fontStyle: "normal", textColor: "#ddd", actualCharWidth: 16 });
  const e = makeEngine({ typewriter: true, typewriterFreshInk: true, typewriterInk: true, popEffects: true, popLetters: true });
  const got = { ink: [], stamp: [], pop: [] };
  e.spawnInkStamp = (ch, a) => got.stamp.push([ch, a.pos, a.x]);
  e.spawnLetterParticle = (ch, a) => got.pop.push([ch, a.pos, a.x]);
  const realInk = e.spawnFreshInk;
  e.spawnFreshInk = (view, last, from, to) => got.ink.push(view.state.doc.sliceString(from, to));
  // The pinyin, letter by letter: typing as ever.
  let text = before;
  for (const ch of pinyin) {
    const view = mk(text + ch);
    e.app = { workspace: { activeEditor: { editor: { cm: view } } } };
    e.lastActive = rec(text.length, text.length, 100 + text.length * 10);
    e.resolveHoldChar(rec(text.length + 1, text.length + 1, 110 + text.length * 10));
    text += ch;
  }
  ok("the pinyin as it is typed: each letter heard, as before", got.ink.join("") === pinyin && got.stamp.length === pinyin.length);
  got.ink.length = 0; got.stamp.length = 0; got.pop.length = 0;
  // The commit: "nihao" becomes the two characters; the caret moves back.
  const done = before + hanzi;
  const view = mk(done);
  e.app = { workspace: { activeEditor: { editor: { cm: view } } } };
  e.lastActive = rec(text.length, text.length, 100 + text.length * 10);
  e._imeCommit = { data: hanzi, t: performance.now() };
  const held = e.resolveHoldChar(rec(done.length, done.length, 100 + done.length * 16));
  ok("the characters committed are typing: held, wet, stamped, popped", held === "\u597d" && got.ink[0] === hanzi && got.stamp.length === 1 && got.pop.length === 1, got);
  ok("...the stamp and the letter on the last character, in its own place", got.stamp[0][0] === "\u597d" && got.stamp[0][1] === done.length - 1 && got.stamp[0][2] === 100 + (done.length - 1) * 10, got.stamp[0]);
  ok("...once: the commit is used up", e._imeCommit === null && e.resolveHoldChar(rec(done.length, done.length, 100 + done.length * 16)) === null);
  // Not a commit: an older one, or text that is not what it wrote.
  e._imeCommit = { data: hanzi, t: performance.now() - 5000 };
  ok("a commit long past is not typing", e.resolveHoldChar(rec(done.length, done.length, 100 + done.length * 16)) === null);
  e._imeCommit = { data: "\u8c22", t: performance.now() };
  ok("...nor one whose text is not before the caret", e.resolveHoldChar(rec(done.length, done.length, 100 + done.length * 16)) === null);
  e._imeCommit = { data: hanzi, t: performance.now() };
  e.lastActive = rec(done.length, done.length, 0);
  e.app = { workspace: { activeEditor: { editor: { cm: mk(done + "x") } } } };
  e.resolveHoldChar(rec(done.length + 1, done.length + 1, 0));
  ok("...and a key typed after it uses it up (a later move is not the commit)", e._imeCommit === null);
  // Issue #41: the next pinyin started in the same frame as the commit - the
  // caret is already past its first letter when the move is read.
  got.ink.length = 0; got.stamp.length = 0; got.pop.length = 0;
  e.app = { workspace: { activeEditor: { editor: { cm: mk(done + "s") } } } };
  e.lastActive = rec(text.length, text.length, 100 + text.length * 10);
  e._imeCommit = { data: hanzi, t: performance.now() };
  const early = e.resolveHoldChar(rec(done.length + 1, done.length + 1, 100 + (done.length + 1) * 10));
  ok("the next pinyin already begun: the commit still found, just before the caret", early === "\u597d" && got.ink[0] === hanzi && got.stamp.length === 1 && e._imeCommit === null, got);

  // Fresh ink: the pinyin's run cut back to what still stands, the
  // characters wet after it.
  const ink = makeEngine({ typewriter: true, typewriterFreshInk: true });
  ink.getActiveColor = () => "#ff0000";
  const pv = mk(before + pinyin);
  ink._inkView = pv;
  ink.inkMarks = [{ from: 3, text: "a" + pinyin, times: new Array(6).fill(1), color: "#f00", textColor: "#ddd", fontSize: 16, fontFamily: "serif", fontWeight: "400", fontStyle: "normal" }];
  // The same view object, its document now the committed text.
  pv.state.doc = mk(done).state.doc;
  realInk.call(ink, pv, rec(done.length, done.length, 0), before.length, done.length);
  ok("Fresh ink: the letter typed before the pinyin stays wet, the characters join it", ink.inkMarks.length === 1 && ink.inkMarks[0].text === "a" + hanzi && ink.inkMarks[0].from === 3 && ink.inkMarks[0].times.length === 3, ink.inkMarks.map((m) => [m.from, m.text]));
}
