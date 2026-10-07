// Anvil sparks (1.7.9): the trigger, the burst, the budget, the paint.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine, makeCtx, renderPanel } = require("../lib");

const PI = Math.PI;
// An engine with Anvil sparks on, a recording canvas, and a stand-in note:
// one line, `text`, each character 10 px wide from x = 100, its row 300-320.
function anvilEngine(over = {}, text = "hello ") {
  const e = makeEngine(Object.assign({ popEffects: true, anvilSparks: true, anvilSparksQuantity: 1 }, over));
  e.anvils = [];
  e._lastAnvilT = -1e9;
  e._anvilPending = 0;
  e.text = text;
  e.lastActive = { docLen: text.length - 1 };
  e._reportOnce = (site, err) => { throw err instanceof Error ? err : new Error(site); };
  e._measureCtx = { font: "", measureText: () => ({ width: 8, fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 4 }) };
  e.fontString = () => "16px monospace";
  e.isObsidianVimOn = () => false;
  e.detectVimMode = () => null;
  const view = {
    state: { doc: { lineAt: () => ({ from: 0, text: e.text }) } },
    coordsAtPos: (pos) => ({ left: 100 + pos * 10, right: 100 + pos * 10, top: 300, bottom: 320 }),
  };
  e.app = { workspace: { activeEditor: { editor: { cm: view } } } };
  return e;
}
const caretAfter = (text, extra = {}) => Object.assign({
  x: 100 + text.length * 10, top: 300, bottom: 320, h: 20, w: 8, actualCharWidth: 8, rowLeft: 100, rowRight: 900,
  char: "", textColor: "#ddd", fontSize: 16, fontFamily: "monospace", fontWeight: "400", fontStyle: "normal", letterSpacing: 0,
  pos: text.length, docLen: text.length,
}, extra);

// ---------------------------------------------------------------------------
section("anvil sparks: which keystrokes strike");
{
  const k = T.anvilKeyStrikes;
  ok("a Space strikes", k({ key: " " }) && k({ key: "Spacebar" }));
  ok("...a letter does not", !k({ key: "a" }) && !k({ key: "Enter" }));
  ok("...not with Ctrl, Alt or Meta held", !k({ key: " ", ctrl: true }) && !k({ key: " ", alt: true }) && !k({ key: " ", meta: true }));
  ok("...Shift is fine", k({ key: " ", shift: true }));
  ok("...not inside a composition", !k({ key: " ", composing: true }));
  ok("a phone's Space (beforeinput insertText) strikes", k({ inputType: "insertText", data: " " }));
  ok("...and a swiped word with its Space", k({ inputType: "insertText", data: "anvil " }));
  ok("...a word without one does not", !k({ inputType: "insertText", data: "anvil" }));
  ok("...nor an input method's composition text", !k({ inputType: "insertCompositionText", data: "ni " }) && !k({ inputType: "insertText", data: " ", composing: true }));
  ok("...nor a deletion or a paste", !k({ inputType: "deleteContentBackward" }) && !k({ inputType: "insertFromPaste", data: "a " }));
}

section("anvil sparks: the word a Space finished");
{
  const w = T.anvilWordBefore;
  ok("right after a word", JSON.stringify(w("hello ", 6)) === JSON.stringify({ from: 0, to: 5 }), w("hello ", 6));
  ok("the last word of several", JSON.stringify(w("a bb ", 5)) === JSON.stringify({ from: 2, to: 4 }), w("a bb ", 5));
  ok("punctuation is part of the word", JSON.stringify(w("one, ", 5)) === JSON.stringify({ from: 0, to: 4 }));
  ok("a Space after a Space finishes nothing", w("hello  ", 7) === null);
  ok("...nor one at the line's start", w(" ", 1) === null && w("", 0) === null);
  ok("...nor a caret not after a Space", w("hello", 5) === null);
  ok("a no-break space counts as the Space", w("x ", 2) !== null);
  const long = "x".repeat(100) + " ";
  const r = w(long, long.length);
  ok("a very long word is taken from its last 64", r && r.to === 100 && r.to - r.from === 64, r);
}

section("anvil sparks: the keystroke is noted");
{
  let e = anvilEngine();
  e._anvilNote({ key: " " });
  ok("a Space is noted with the effect on", e._anvilPending > 0);
  e = anvilEngine({ anvilSparks: false }); e._anvilNote({ key: " " });
  ok("...not with it off", e._anvilPending === 0);
  e = anvilEngine({ popEffects: false }); e._anvilNote({ key: " " });
  ok("...nor with Pop effects off", e._anvilPending === 0);
  e = anvilEngine(); e._anvilNote({ key: " ", ctrl: true });
  ok("...nor with Ctrl held", e._anvilPending === 0);
  e = anvilEngine(); e.isObsidianVimOn = () => true; e.detectVimMode = () => "normal"; e._anvilNote({ key: " " });
  ok("...nor in Vim's Normal mode (Space moves the caret there)", e._anvilPending === 0);
  e = anvilEngine(); e.isObsidianVimOn = () => true; e.detectVimMode = () => "insert"; e._anvilNote({ key: " " });
  ok("...but in Vim's Insert mode it is", e._anvilPending > 0);
}

section("anvil sparks: a burst under the word");
{
  let e = anvilEngine();
  e.spawnAnvilSparks(caretAfter("hello "));
  ok("a Space after a word strikes once", e.anvils.length === 1, e.anvils.length);
  const b = e.anvils[0];
  ok("14 sparks a word at quantity 1", b.sparks.length === 14, b.sparks.length);
  // The word runs x 100..150 (five letters, 10 px each): its middle is 125.
  // Baseline: top 300 + ascent 14 + (20 - 14 - 4) / 2 = 315; 0.3 em below.
  ok("from 0.3 em below the word's baseline", Math.abs(b.y0 - (315 + 0.3 * 16)) < 1e-9, b.y0);
  ok("each spark leaves from the word's middle, give or take a quarter of its width",
    b.sparks.every((s) => Math.abs(s.x0 - 125) <= 0.25 * 50 + 1e-9), b.sparks.map((s) => s.x0));
  ok("gravity is 31 em/s², the cell a fifth of the em", b.g === 31 * 16 && b.cell === 3, { g: b.g, cell: b.cell });

  e = anvilEngine({}, "hello ");
  e.lastActive = { docLen: 6 };
  e.spawnAnvilSparks(caretAfter("hello "));
  ok("no burst unless the note grew (a Space went in)", e.anvils.length === 0);
  e = anvilEngine({}, "hello  ");
  e.spawnAnvilSparks(caretAfter("hello  "));
  ok("no burst for a Space after a Space", e.anvils.length === 0);
  e = anvilEngine();
  e._clipTop = 400;
  e.spawnAnvilSparks(caretAfter("hello "));
  ok("no burst from under a word above the pane's top (_clipTop)", e.anvils.length === 0);
  e = anvilEngine();
  e.spawnAnvilSparks(caretAfter("hello "));
  e.lastActive = { docLen: 6 }; e.text = "hello a ";
  e.spawnAnvilSparks(caretAfter("hello a ", { docLen: 8 }));
  ok("key repeat: a second burst within the gap is not thrown", e.anvils.length === 1, e.anvils.length);
  e._lastAnvilT = performance.now() - T.ANVIL_MIN_GAP_MS - 1;
  e.spawnAnvilSparks(caretAfter("hello a ", { docLen: 8 }));
  ok("...after the gap it is", e.anvils.length === 2, e.anvils.length);
}

section("anvil sparks: the numbers of a burst");
{
  const e = anvilEngine({ anvilSparksQuantity: 3 });
  const sparks = [];
  for (let i = 0; i < 40; i++) { e.anvils = []; e._bakeAnvil(500, 60, 300, 20); sparks.push(...e.anvils[0].sparks); }
  ok("42 sparks a word at quantity 3", e.anvils[0].sparks.length === 42, e.anvils[0].sparks.length);
  const speed = (s) => Math.hypot(s.vx, s.vy) / 20;
  const ang = (s) => Math.atan2(s.vy, s.vx);
  ok("every throw downward and out: 0.05π to 0.95π, y down", sparks.every((s) => ang(s) >= 0.05 * PI - 1e-9 && ang(s) <= 0.95 * PI + 1e-9));
  ok("speeds 6 to 18 em/s", sparks.every((s) => speed(s) >= 6 - 1e-9 && speed(s) <= 18 + 1e-9));
  ok("lives 0.35 to 0.8 s", sparks.every((s) => s.life >= 0.35 && s.life <= 0.8));
  ok("tints 0 to 1", sparks.every((s) => s.tint >= 0 && s.tint <= 1));
  const meanAng = sparks.reduce((a, s) => a + ang(s), 0) / sparks.length;
  ok("the fan is centred straight down (mean angle near π/2)", Math.abs(meanAng - PI / 2) < 0.15, meanAng);
  const low = anvilEngine({ anvilSparksQuantity: 0.2 });
  low._bakeAnvil(500, 60, 300, 20);
  ok("3 sparks at quantity 0.2", low.anvils[0].sparks.length === 3, low.anvils[0].sparks.length);
}

section("anvil sparks: the budget");
{
  const e = anvilEngine();
  const full = { y0: 0, g: 0, cell: 3, palette: T.ANVIL_PALETTE, start: performance.now(), end: 1, minX: 0, maxX: 0, minY: 0, maxY: 0,
    sparks: Array.from({ length: T.ANVIL_SPARK_BUDGET - T.ANVIL_SPARK_MIN + 1 }, () => ({ x0: 0, vx: 0, vy: 1, life: 1, tint: 0 })) };
  e.anvils.push(full);
  const before = e._liveAnvilCount();
  const got = e._bakeAnvil(500, 60, 300, 20);
  ok("a burst that cannot afford its minimum is skipped", got === null && e.anvils.length === 1);
  ok("...nothing in flight is evicted", e.anvils[0] === full && e._liveAnvilCount() === before);
  ok("...and the gap is not stamped (the next word may try at once)", e._lastAnvilT === -1e9);
  full.sparks.length = T.ANVIL_SPARK_BUDGET - 10;
  const shrunk = e._bakeAnvil(500, 60, 300, 20);
  ok("a burst with less room left is shrunk to fit", shrunk && shrunk.sparks.length === 10, shrunk && shrunk.sparks.length);
  ok("...still evicting nothing", e.anvils[0] === full && full.sparks.length === T.ANVIL_SPARK_BUDGET - 10);
}

section("anvil sparks: the path and the color");
{
  const s = { x0: 100, vx: 160, vy: 240, life: 0.6, tint: 0.5 };
  const p = T.anvilPoint(s, 300, 496, 0.25);
  const f = (1 - Math.exp(-1.6 * 0.25)) / 1.6;
  ok("x(t) = x0 + vx·(1 − e^(−k·t))/k", Math.abs(p.x - (100 + 160 * f)) < 1e-9);
  ok("y(t) = y0 + vy·(1 − e^(−k·t))/k + ½·g·t²", Math.abs(p.y - (300 + 240 * f + 0.5 * 496 * 0.0625)) < 1e-9);
  const q0 = T.anvilPoint(s, 300, 496, 0);
  ok("at t = 0 it is at its origin", q0.x === 100 && q0.y === 300);
  ok("hottest at the start", T.anvilStep(1, 0) === 0 && T.anvilStep(1, 1) === 0);
  ok("coolest at the end", T.anvilStep(0, 0) === 3 && T.anvilStep(0, 1) === 3);
  ok("halfway, the tint decides", T.anvilStep(0.5, 0) === 1 && T.anvilStep(0.5, 1) === 2);
  ok("the cell: a fifth of the em, at least 2 px", T.anvilCell(16) === 3 && T.anvilCell(36) === 7 && T.anvilCell(5) === 2);
}

section("anvil sparks: what a frame paints");
{
  const e = anvilEngine();
  const b = e._bakeAnvil(500, 60, 300, 20);
  b.start = performance.now() - 100;
  e.ctx = makeCtx();
  e.dirty = [];
  e.drawAnvilSparks();
  const calls = e.ctx.calls;
  ok("it paints", calls.length > b.sparks.length - 1, calls.length);
  ok("every block is one cell, square", calls.every((c) => c.w === b.cell && c.h === b.cell));
  ok("...on the burst's grid (floor-snapped)", calls.every((c) => c.x % b.cell === 0 && c.y % b.cell === 0));
  ok("...in the hot-to-cool palette", calls.every((c) => T.ANVIL_PALETTE.includes(c.fill)));
  ok("...at full strength, or the trail's 0.7 and 0.45", calls.every((c) => [1, 0.7, 0.45, 0.6].some((a) => Math.abs(c.alpha - a) < 1e-9)), [...new Set(calls.map((c) => c.alpha))]);
  const d = e.dirty;
  ok("one damage box covers every block it painted", d.length === 1 && calls.every((c) => c.x >= d[0].x && c.y >= d[0].y && c.x + c.w <= d[0].x + d[0].w && c.y + c.h <= d[0].y + d[0].h), d);
  ok("the region's box (worked out at spawn) covers them too", calls.every((c) => c.x >= b.minX - b.cell && c.x + c.w <= b.maxX + b.cell && c.y >= b.minY - b.cell && c.y + c.h <= b.maxY + b.cell));

  // Frame-rate independence: drawn once at 250 ms, or at every 8 ms up to
  // it, the 250 ms frame is the same.
  const once = anvilEngine();
  const twice = anvilEngine();
  const seed = T.seededRandom(7);
  const rnd = Math.random;
  Math.random = seed; const b1 = once._bakeAnvil(500, 60, 300, 20); Math.random = T.seededRandom(7); const b2 = twice._bakeAnvil(500, 60, 300, 20); Math.random = rnd;
  const real = performance.now;
  let clock = 1000;
  performance.now = () => clock;
  try {
    b1.start = 1000; b2.start = 1000;
    for (let t = 8; t < 250; t += 8) { clock = 1000 + t; twice.ctx = makeCtx(); twice.drawAnvilSparks(); }
    clock = 1250;
    once.ctx = makeCtx(); once.drawAnvilSparks();
    twice.ctx = makeCtx(); twice.drawAnvilSparks();
    ok("the shape at a moment does not depend on the frames before it", JSON.stringify(once.ctx.calls) === JSON.stringify(twice.ctx.calls) && once.ctx.calls.length > 0);
    // A young spark has its two trail cells; an old one has none.
    const young = { y0: 300, g: 31 * 20, cell: 4, palette: T.ANVIL_PALETTE, start: 1000, end: 1, minX: 0, maxX: 1000, minY: 0, maxY: 1000,
      sparks: [{ x0: 500, vx: 0, vy: 400, life: 1, tint: 0 }] };
    const e2 = anvilEngine(); e2.anvils = [young];
    clock = 1100; e2.ctx = makeCtx(); e2.drawAnvilSparks();
    ok("a young spark: its head and two trail cells", e2.ctx.calls.length === 3, e2.ctx.calls);
    ok("...the trail a step cooler each and fainter (0.7, 0.45)",
      e2.ctx.calls[1].fill === T.ANVIL_PALETTE[1] && e2.ctx.calls[2].fill === T.ANVIL_PALETTE[2] &&
      Math.abs(e2.ctx.calls[1].alpha - 0.7) < 1e-9 && Math.abs(e2.ctx.calls[2].alpha - 0.45) < 1e-9, e2.ctx.calls);
    ok("...never on a cell the spark already lit", new Set(e2.ctx.calls.map((c) => c.x + "," + c.y)).size === 3);
    clock = 1800; e2.ctx = makeCtx(); e2.drawAnvilSparks();
    ok("an old spark (under 0.35 of its life left): no trail, dimmed to 0.6", e2.ctx.calls.length === 1 && Math.abs(e2.ctx.calls[0].alpha - 0.6) < 1e-9, e2.ctx.calls);
    clock = 2001; e2.ctx = makeCtx(); e2.drawAnvilSparks();
    ok("a burst past its last spark's life is gone", e2.anvils.length === 0 && e2.ctx.calls.length === 0);
  } finally { performance.now = real; }
}

section("anvil sparks: settings, reduced motion, the panel");
{
  ok("off by default, quantity 1", T.DEFAULT_SETTINGS.anvilSparks === false && T.DEFAULT_SETTINGS.anvilSparksQuantity === 1);
  const n = T.LOOK_KEYS.length;
  ok("appended to LOOK_KEYS (share codes keep their slots)", T.LOOK_KEYS[n - 2] === "anvilSparks" && T.LOOK_KEYS[n - 1] === "anvilSparksQuantity");
  ok("reduced motion turns it off", T.REDUCED_MOTION_OFF_KEYS.includes("anvilSparks") && T.applyReducedMotion({ anvilSparks: true }).anvilSparks === false);
  const off = renderPanel({ popEffects: true });
  const named = (rows, name) => rows.some((r) => r.name === name && r.visible);
  ok("Pop effects shows \"Anvil sparks\"", named(off, "Anvil sparks"));
  ok("...its Spark count hidden while it is off", !named(off, "Spark count"));
  const on = renderPanel({ popEffects: true, anvilSparks: true, popLetters: true });
  ok("Spark count appears with it on", named(on, "Spark count"));
  ok("...and the rows after it still render", named(on, "Rainbow"));
  const closed = renderPanel({ popEffects: false, anvilSparks: true });
  ok("the group gate hides it", !named(closed, "Anvil sparks") && !named(closed, "Spark count"));
  // Rainbow shows when something it recolors is on: Anvil sparks alone is.
  const alone = { popEffects: true, popLetters: false, backspaceDisintegrate: false, backspaceEvaporate: false, thunderstrike: false,
    fireworks: false, backMan: false, shredder: false, rabbitHole: false };
  ok("Rainbow hidden with no pop effect on", !named(renderPanel(alone), "Rainbow"));
  ok("...shown with Anvil sparks alone (it recolors them)", named(renderPanel(Object.assign({}, alone, { anvilSparks: true })), "Rainbow"));
}

section("anvil sparks: Rainbow");
{
  const lum = (hex) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0);
  const p = T.anvilRainbow(200);
  ok("four shades in one hue, as hex", p.length === 4 && p.every((c) => /^#[0-9a-f]{6}$/.test(c)), p);
  ok("...hot to cool: each darker than the last", lum(p[0]) > lum(p[1]) && lum(p[1]) > lum(p[2]) && lum(p[2]) > lum(p[3]), p.map(lum));
  ok("...a different hue, different shades", JSON.stringify(T.anvilRainbow(0)) !== JSON.stringify(p));
  const plain = anvilEngine();
  ok("without Rainbow: the hot-metal palette", JSON.stringify(plain._bakeAnvil(500, 60, 300, 20).palette) === JSON.stringify(T.ANVIL_PALETTE));
  const e = anvilEngine({ popRainbow: true });
  e._popRainbowHue = 0;
  const b1 = e._bakeAnvil(500, 60, 300, 20);
  const b2 = e._bakeAnvil(500, 60, 300, 20);
  ok("with Rainbow: the sweep's hue for the burst", JSON.stringify(b1.palette) === JSON.stringify(T.anvilRainbow(0)), b1.palette);
  ok("...one step of the shared sweep a burst", JSON.stringify(b2.palette) === JSON.stringify(T.anvilRainbow(33)) && e._popRainbowHue === 66, { p: b2.palette, hue: e._popRainbowHue });
  e.anvils = [b1];
  b1.start = performance.now() - 120;
  e.ctx = makeCtx();
  e.drawAnvilSparks();
  ok("...and it paints in them", e.ctx.calls.length > 0 && e.ctx.calls.every((c) => b1.palette.includes(c.fill)), [...new Set(e.ctx.calls.map((c) => c.fill))]);
}

section("anvil sparks: the Randomizer");
{
  const full = T.rollLook({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(3));
  ok("at full Chaos with Pop effects: on, Spark count in range", full.popEffects === true && full.anvilSparks === true && full.anvilSparksQuantity >= 0.6 && full.anvilSparksQuantity <= 3, { a: full.anvilSparks, q: full.anvilSparksQuantity });
  const none = T.rollLook({ chaos: 100, color: 50, motion: 50, allow: { popEffects: false } }, T.seededRandom(3));
  ok("Pop effects left out: never", none.popEffects === false && none.anvilSparks === false);
  let withPops = 0, on = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const l = T.rollLook({ chaos: 50, color: 50, motion: 50 }, T.seededRandom(seed));
    if (!l.popEffects) { if (l.anvilSparks) on = -1e9; continue; }
    withPops++;
    if (l.anvilSparks) on++;
  }
  ok("at middle Chaos: on in some rolls with Pop effects, off in others, never without them", on > 0 && on < withPops, { withPops, on });
  const vim = T.rollVimLooks({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(3));
  ok("Vim's rolls: in Insert and Replace (a typing pop)", vim.insert.anvilSparks === true && vim.replace.anvilSparks === true);
  ok("...not in Normal, Visual or Command", !vim.normal.anvilSparks && !vim.visual.anvilSparks && !vim.command.anvilSparks);
}
