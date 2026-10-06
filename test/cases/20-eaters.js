// On delete (1.7.7): two choices - the cursor's (Nothing, Back-man,
// Shredder, Vacuum) and the letters' (None, Burst, Evaporate),
// every pair working together - kept in the five switches they replaced
// (eaterChoiceOf, letterChoiceOf); the eaters on any cursor (the cursor
// morphs from its own shape into its eater's and back); and the combos (the
// letters' effect played where the eater is done with a letter).
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine, renderPanel, srcPath, makePathCtx } = require("../lib");

section("On delete: two choices, in the switches they replaced");
{
  ok("nothing on: Nothing, and the letters just go", T.eaterChoiceOf({}) === "none" && T.letterChoiceOf({}) === "vanish");
  ok("each switch its choice", T.EATER_KEYS.every(([c, key]) => T.eaterChoiceOf({ [key]: true }) === c) && T.LETTER_KEYS.every(([c, key]) => T.letterChoiceOf({ [key]: true }) === c));
  ok("one of each set, together: Back-man and Burst", T.eaterChoiceOf({ backMan: true, backspaceDisintegrate: true }) === "backman" && T.letterChoiceOf({ backMan: true, backspaceDisintegrate: true }) === "burst");
  ok("a set saved with two on is its first: Evaporate before Burst, Back-man before Shredder", T.letterChoiceOf({ backspaceDisintegrate: true, backspaceEvaporate: true }) === "evaporate" && T.eaterChoiceOf({ shredder: true, backMan: true }) === "backman");
  ok("the eaters, and nothing", T.eaterOf("backman") === "backman" && T.eaterOf("rabbithole") === "rabbithole" && T.eaterOf("none") === null);
}

section("The eaters' shapes and the morph");
{
  // A caret at the gap x 100 on a row 24 high at y 10, a letter 9 wide, a
  // Line 2 thick spanning the row, an Underline 2 thick.
  const form = (k) => T.eaterForm(k, 100, 10, 24, 9, 2, 10, 24, 2);
  const box = form("backman"), line = form("shredder"), floor = form("rabbithole");
  ok("Back-man: the letter's box", box.x === 100 && box.y === 10 && box.w === 9 && box.h === 24);
  ok("Shredder: the line, centered on the gap", line.x === 99 && line.w === 2 && line.y === 10 && line.h === 24);
  ok("Vacuum: the floor, at the row's foot", floor.x === 100 && floor.w === 9 && floor.y === 32 && floor.h === 2);
  const mid = T.lerpRect(line, box, 0.5);
  ok("a shape between two: halfway", mid.x === 99.5 && mid.w === 5.5 && mid.h === 24);
  ok("the way in: fast, eased, all the way by its end", T.eaterMorph(0, -1) === 0 && T.eaterMorph(T.EATER_IN_MS / 3, -1) > 0.6 && T.eaterMorph(T.EATER_IN_MS, -1) === 1);
  let past = 0;
  for (let ms = 0; ms <= T.EATER_OUT_MS; ms += 4) past = Math.min(past, T.eaterMorph(1e9, ms));
  ok("the way back: from all the way, a little past its own shape, and home", T.eaterMorph(1e9, 0) === 1 && past < -0.02 && T.eaterMorph(1e9, T.EATER_OUT_MS) === 0, past);
}

section("The eaters on any cursor");
{
  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    const mk = (style, keys) => {
      const e = makeEngine({ cursorStyle: style, popEffects: true, ...keys });
      e.styleFor = (k) => e.look[k];
      e.fontString = () => "16px x";
      e.getActiveColor = () => "#ccc";
      e.animActive = { x: 99, top: 10, bottom: 34, h: 24, w: 2, actualCharWidth: 9, rowLeft: 0, rowRight: 500, char: "a", textColor: "#ccc", fontSize: 16, fontFamily: "x", fontWeight: "400", fontStyle: "normal", letterSpacing: 0 };
      e.lastActive = e.animActive;
      e.lineSpan = (top, h) => ({ top, h });
      e.caretThickness = () => 2;
      e.underlineThickness = () => 2;
      return e;
    };
    const line = mk("Line", { backMan: true });
    line._backManBite(-1);
    const drawn = [];
    line.drawBackMan = (ctx, x, y, w, h) => drawn.push({ x, y, w, h });
    line.drawEater({}, { x: 99, y: 10, w: 2, h: 24 }, 100, "#f80", 0, 0, now);
    ok("a Line with Back-man: the eater has it from the key, starting from the line's own shape", !!line._eat && line._eat.kind === "backman" && drawn.length === 1 && drawn[0].w === 2);
    now += T.EATER_IN_MS;
    line.drawEater({}, { x: 99, y: 10, w: 2, h: 24 }, 100, "#f80", 0, 0, now);
    ok("...all the way into the box by the end of the way in", drawn[1].x === 100 && drawn[1].w === 9 && drawn[1].h === 24, drawn[1]);
    ok("...and the frames keep coming while it does", line.eaterMoving(now));
    now += 3000;
    const fills = [];
    const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => { fills.push([k, ...a]); }), set: (o, k, v) => { o[k] = v; return true; } });
    ok("Back-man done: on its way back (drawn as the plain shape)", line.drawEater(ctx, { x: 99, y: 10, w: 2, h: 24 }, 100, "#f80", 0, 0, now) && !!line._eat.exit && fills.some((c) => c[0] === "rect"));
    now += T.EATER_OUT_MS;
    ok("...and home: the cursor its own again", !line.drawEater(ctx, { x: 99, y: 10, w: 2, h: 24 }, 100, "#f80", 0, 0, now) && line._eat === null && !line.eaterMoving(now));

    const box = mk("Box", { shredder: true });
    box._shredBite();
    const blades = [];
    box.drawShredLine = (ctx, x, y, w, h) => blades.push({ x, w, h });
    box.drawShreds = () => {};
    now += 100;
    box.drawEater({}, { x: 100, y: 10, w: 9, h: 24 }, 100, "#f80", 0, 0, now);
    now += T.EATER_IN_MS;
    box.drawEater({}, { x: 100, y: 10, w: 9, h: 24 }, 100, "#f80", 0, 0, now);
    ok("a Box with Shredder: the box kept, the whole of it shredded into strips ('a shreded box entirely (horizontal lines)')", blades.every((b) => b.w === 9 && b.x === 100 && b.h === 24) && blades.length === 2, blades);
    ok("...the strips across the box's whole width, gaps between them while it cuts", (() => { const bl = T.shredBlades(1, 9, 24, 0); return bl.length >= 4 && bl.every(([dx, top, len], i) => len < 24 / bl.length && (i === 0 || top > bl[i - 1][1] + bl[i - 1][2])); })());

    const off = mk("Box", { backspaceEvaporate: true });
    ok("Evaporate chosen: no eater, the cursor its own", !off.drawEater({}, { x: 100, y: 10, w: 9, h: 24 }, 100, "#f80", 0, 0, now) && off._eaterOn() === null);
    const nopop = mk("Box", { popEffects: false, backMan: true });
    ok("...nor with Pop effects off", nopop._eaterOn() === null);
  } finally {
    performance.now = realNow;
  }
}

section("The combos: the letters' effect where the eater is done with them");
{
  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    const old = { top: 0, h: 24, fontSize: 16, fontFamily: "x", fontWeight: "400", fontStyle: "normal", textColor: "#ddd", x: 0, w: 9, actualCharWidth: 9 };
    const deleted = { letters: [{ char: "a", x: 91, w: 9 }], forward: false, old };
    const mk = (keys) => {
      const e = makeEngine({ cursorStyle: "Box", popEffects: true, ...keys });
      e.styleFor = (k) => e.look[k];
      e.fontString = () => "16px x";
      e.getActiveColor = () => "#ccc";
      e._markDirty = () => {};
      e.fired = [];
      e.spawnDisintegration = (d) => { e.fired.push(["burst", d.letters[0].x, d.old.top]); return true; };
      e.spawnEvaporate = (d) => { e.fired.push(["evaporate", d.letters[0].x, d.old.top]); };
      return e;
    };
    const bm = mk({ backMan: true, backspaceDisintegrate: true });
    bm._backManBite(-1);
    bm.spawnBackManMeal(deleted);
    bm._backMan.mouth = { x: 102, y: 12 };
    bm.backManPose(now + 10);
    ok("Back-man and Burst: nothing yet while the letter is going in", bm.fired.length === 0);
    bm.backManPose(now + 400);
    ok("...the jaws shut on it: a burst at the mouth", bm.fired.length === 1 && bm.fired[0][0] === "burst" && bm.fired[0][1] === 102 - 4.5 && bm.fired[0][2] === 0, bm.fired);
    const bmEv = mk({ backMan: true, backspaceEvaporate: true });
    bmEv._backManBite(-1);
    bmEv.spawnBackManMeal(deleted);
    bmEv._backMan.head = { x: 104, y: 0 };
    bmEv.backManPose(now + 400);
    ok("Back-man and Evaporate: its ghost rising from the head", bmEv.fired.length === 1 && bmEv.fired[0][0] === "evaporate" && bmEv.fired[0][1] === 104 - 4.5 && bmEv.fired[0][2] < 0, bmEv.fired);
    const bmNone = mk({ backMan: true });
    bmNone._backManBite(-1);
    bmNone.spawnBackManMeal(deleted);
    bmNone.backManPose(now + 400);
    ok("Back-man, the letters just going: nothing more", bmNone.fired.length === 0);

    const hole = mk({ rabbitHole: true, backspaceDisintegrate: true });
    hole._holeBite();
    hole.spawnHoleMeal(deleted);
    hole._hole.floor = { x: 95, y: 24 };
    hole.holePose(now + 0.3 * T.HOLE_FALL_MS);
    ok("Vacuum and Burst: nothing while it drops", hole.fired.length === 0);
    hole.holePose(now + 0.7 * T.HOLE_FALL_MS);
    hole.holePose(now + 0.8 * T.HOLE_FALL_MS);
    ok("...a splash out of the floor as it goes through, once, where it stood (it drops straight)", hole.fired.length === 1 && hole.fired[0][0] === "burst" && hole.fired[0][1] === 91, hole.fired);
    const holeEv = mk({ rabbitHole: true, backspaceEvaporate: true });
    holeEv._holeBite();
    holeEv.spawnHoleMeal(deleted);
    holeEv.holePose(now + 0.7 * T.HOLE_FALL_MS);
    ok("Vacuum and Evaporate: not as it goes through...", holeEv.fired.length === 0);
    holeEv.holePose(now + T.HOLE_FALL_MS + 5);
    ok("...but once gone, its ghost floating back up out of the hole", holeEv.fired.length === 1 && holeEv.fired[0][0] === "evaporate");

    const l = { char: "a", x: 100, w: 9, top: 0, h: 24, font: "16px x", color: "#ddd", t0: 0 };
    ok("Shredder and Evaporate: the ribbons rise instead of falling", T.shredFeed(l, 100, T.SHRED_FEED_MS, true).dy < 0 && T.shredFeed(l, 100, T.SHRED_FEED_MS).dy > 0);
    const sh = mk({ cursorStyle: "Line", shredder: true, backspaceDisintegrate: true });
    sh._shredBite();
    sh.spawnShreds(deleted);
    const calls = [];
    const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => { calls.push([k, ...a]); }), set: (o, k, v) => { o[k] = v; return true; } });
    const pose = sh.shredPose(now);
    sh.drawShreds(ctx, 91, pose, now + T.SHRED_FEED_MS / 2);
    ok("Shredder and Burst: half through, cut as ever", sh.fired.length === 0 && calls.some((c) => c[0] === "fillText"));
    calls.length = 0;
    sh.drawShreds(ctx, 91, pose, now + T.SHRED_FEED_MS + 20);
    sh.drawShreds(ctx, 91, pose, now + T.SHRED_FEED_MS + 60);
    // A cross-cut shredder: the letter's own bits, not Burst's pixels apart
    // from it.
    ok("...all through: each ribbon breaks into its bits (the letter's own pieces), no pixels played apart", sh.fired.length === 0 && calls.filter((c) => c[0] === "fillText").length === 2 * T.SHRED_RIBBONS * T.SHRED_CROSS && calls.filter((c) => c[0] === "clip").length === 2 * T.SHRED_RIBBONS * T.SHRED_CROSS, sh.fired);
  } finally {
    performance.now = realNow;
  }
}

section("The eaters with Motion smear: their own size, no trail");
{
  ok("eaterSmear: still a look key (share codes count them in order), unused", T.LOOK_KEYS.indexOf("eaterSmear") > T.LOOK_KEYS.indexOf("crtGlitchWhen") && T.DEFAULT_SETTINGS.eaterSmear === true);
  const own = { x: 100, y: 10, w: 2, h: 24 };
  // The cursor stepped left: the smear's quad trails 9 px to the right of it.
  const q = { tl: { x: 100, y: 10 }, tr: { x: 111, y: 10 }, br: { x: 111, y: 34 }, bl: { x: 100, y: 34 } };
  // drawEater, the painters stubbed: the rect each is handed, what was
  // filled, and what was marked for the next clear.
  const run = (over, kind) => {
    const e = makeEngine({ popEffects: true, [kind === "backman" ? "backMan" : kind === "shredder" ? "shredder" : "rabbitHole"]: true, smear: true, ...over });
    e._eaterNow = () => ({ kind, back: false, m: 1 });
    e.styleFor = (k) => (k === "cursorStyle" ? "Box" : e.look[k]);
    e.shredPose = () => ({ dash: 1, letters: [] });
    e.holePose = () => ({ letters: [] });
    e.drawShreds = () => {};
    e.animActive = { x: 100, top: 10, w: 2, h: 24, actualCharWidth: 9 };
    e.smearCorners = () => q;
    e.backManPose = () => ({});
    let got = null;
    e.drawBackMan = (c, x, y, w, h) => { got = { x, y, w, h }; };
    e.drawShredLine = (c, x, y, w, h) => { got = { x, y, w, h }; };
    e.drawHole = (c, x, y, w, h) => { got = { x, y, w, h }; };
    e.dirty = [];
    const ctx = makePathCtx();
    e.drawEater(ctx, own, 100, "#f80", 0, 0, 1000);
    return Object.assign(got, { ops: ctx.ops, dirty: e.dirty });
  };
  ok("with Motion smear on: each eater its own size, never stretched", ["backman", "shredder", "rabbithole"].every((k) => run({}, k).w === run({ smear: false }, k).w));
  ok("...and no trail behind any of them (\"remove the smear suboption for those too\")", ["backman", "shredder", "rabbithole"].every((k) => !run({}, k).ops.some((o) => o.op === "fillRect" || o.op === "fill")));
  const on = run({}, "backman");
  const d = on.dirty.find((m) => m.x < 100 && m.x + m.w > 109);
  ok("all it may paint marked for the next frame's clear: its rect, grown and bent past it", !!d && d.x < 100 - 9 && d.x + d.w > 109 + 9 && d.y < 10 - 9 && d.y + d.h > 34 + 9, on.dirty);
  const rows = renderPanel({ popEffects: true, shredder: true });
  ok("no Smear setting under the eater's choice", !rows.some((x) => x.name === "Smear") && !renderPanel({ popEffects: true, rabbitHole: true }).some((x) => x.name === "Smear"));
  ok("the preview: the eater its own size, no trail", !/eatTrail|EATER_TRAIL/.test(require("fs").readFileSync(srcPath("demo.ts"), "utf8")));
}
