// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little creature - the box with a soft-lipped mouth on
// the side it eats from and a big square eye with a square glint, one bite
// per letter (the letter sliding into the mouth), a gulp after it (the
// front swelling, then the back, the eye squinting happily), its head and
// feet the box's (rounded as the box is), its sides bent in a V on a
// spring; a held key chewed at its own steady pace, a word or a selection
// one big bite. A Box's only. The outline (backManShape, backManOutline),
// the eye (backManEye), the bite and the chewing (backManBite, backManChew, backManDown), the spring
// (backManSpring), the bites and the pose, the meal, the setting, the
// drawing.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine, renderPanel } = require("../lib");

section("Back-man: the creature");
{
  // Smooth, not pixels: an outline in a unit box, no eye.
  const open = T.backManShape(1, 1), shut = T.backManShape(0, 1), left = T.backManShape(1, -1);
  // The mouth's corner: the right side's point furthest in, between the jaws.
  const deepest = (body) => Math.min(...body.filter(([x, y]) => x > 0.05 && y > 0.2 && y < 0.8).map(([x]) => x));
  ok("open, facing right: a V bitten into the right side at its middle, most of the way into the box", deepest(open) < 0.3 && deepest(open) > 0.1 && open.some(([x, y]) => x === deepest(open) && y === 0.5), deepest(open));
  ok("...shut: the jaws meet, nothing bitten out", deepest(shut) === 1, shut);
  ok("...no tail: an outline inside the box and nothing more", Array.isArray(open) && open.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
  const corners = (body) => [[0, 0], [1, 0], [1, 1], [0, 1]].every(([cx, cy]) => body.some(([x, y]) => Math.abs(x - cx) < 1e-9 && y === cy));
  ok("its head and feet are the box's: the four corners, square, and nothing else on the top or the bottom edge", corners(open) && open.filter(([, y]) => y === 0 || y === 1).length === 4);
  ok("facing left (Backspace): the same creature mirrored, the mouth on the left",
     left.every(([x, y], i) => Math.abs(x - (1 - open[i][0])) < 1e-9 && y === open[i][1]) && left.some(([x, y]) => y === 0.5 && x > 0.7 && x < 0.9));
  const bent = T.backManShape(0, -1, -0.4);
  ok("bent (leftward): the sides a V from the middle - the middles moved the whole bend, the head and feet not at all",
     corners(bent) && bent.filter(([, y]) => y === 0.5).every(([x]) => x === 0 - 0.4 || x === 1 - 0.4), bent);
  const jawTop = T.backManShape(1, -1, -0.4).find(([, y]) => Math.abs(y - 0.14) < 1e-9);
  ok("...nearer the head, less: the upper jaw, a seventh down, bends under a third as far (a straight V, not a curve)", !!jawTop && Math.abs(jawTop[0] - -0.4 * 0.28) < 1e-9, jawTop);
  const fat = T.backManShape(0, 1, 0, 0.2);
  ok("swelling: both sides out at the middle, the head and feet the box's", corners(fat) && fat.some(([x, y]) => y === 0.5 && Math.abs(x - 1.2) < 1e-9) && fat.some(([x, y]) => y === 0.5 && Math.abs(x + 0.2) < 1e-9));
}

section("Back-man: the lips and the eye");
{
  const w = 9, h = 24;
  const open = T.backManOutline(T.backManShape(1, 1), 1, w, h), shut = T.backManOutline(T.backManShape(0, 1), 0, w, h);
  ok("soft lips: the two lips and the mouth's corner rounded (three curves), the rest straight", open.filter((c) => c[0] === "Q").length === 3 && open[0][0] === "M" && open[open.length - 1][0] === "Z", open);
  ok("...the curves through the lips themselves", [[w, 0.14 * h], [0.22 * w, 0.5 * h], [w, 0.86 * h]].every(([x, y]) => open.some((c) => c[0] === "Q" && Math.abs(c[1] - x) < 1e-9 && Math.abs(c[2] - y) < 1e-9)));
  ok("...shut, nothing to round", !shut.some((c) => c[0] === "Q"));
  const at = (cmds, x, y) => cmds.some((c) => (c[0] === "M" || c[0] === "L") && Math.abs(c[1] - x) < 1e-9 && c[2] === y);
  ok("...the head's and feet's corners square, where the box's are", [[0, 0], [w, 0], [w, h], [0, h]].every(([x, y]) => at(open, x, y)));
  const round = T.backManOutline(T.backManShape(1, 1), 1, w, h, 2);
  const curveAt = (cmds, x, y) => cmds.some((c) => c[0] === "Q" && Math.abs(c[1] - x) < 1e-9 && Math.abs(c[2] - y) < 1e-9);
  ok("...with Rounded corners, rounded as the box's are: a curve at each of the four (and the lips')", round.filter((c) => c[0] === "Q").length === 7 && [[0, 0], [w, 0], [w, h], [0, h]].every(([x, y]) => curveAt(round, x, y)));
  const span = (pts) => { const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
  const right = T.backManEye(1, 0, 0, w, h), left = T.backManEye(-1, 0, 0, w, h);
  const er = span(right.shape), el = span(left.shape);
  ok("a big square eye: a square more than half the box wide, inside the box, up at the top", right.shape.length === 4 && Math.abs((er.x1 - er.x0) - (er.y1 - er.y0)) < 1e-9 && er.x1 - er.x0 >= 0.55 * w && er.x0 > 0 && er.x1 < w && er.y0 > 0 && er.y1 < 0.3 * h, er);
  const lipY = (x) => 0.14 * h + ((w - x) / (0.78 * w)) * 0.36 * h;
  ok("...clear of the upper lip with the mouth wide open", er.y1 < lipY(er.x1), [er, lipY(er.x1)]);
  ok("...its front edge seven tenths of the way to the front; facing left, mirrored", Math.abs(er.x1 - 0.7 * w) < 1e-9 && Math.abs(el.x0 - 0.3 * w) < 1e-9 && Math.abs((el.x1 - el.x0) - (er.x1 - er.x0)) < 1e-9);
  const gr = right.glint && span(right.glint), gl = left.glint && span(left.glint);
  ok("...a tiny square glint in its upper front corner", !!gr && Math.abs((gr.x1 - gr.x0) - (gr.y1 - gr.y0)) < 1e-9 && gr.x1 - gr.x0 < (er.x1 - er.x0) / 3 && gr.x0 > (er.x0 + er.x1) / 2 && gr.x1 < er.x1 && gr.y0 > er.y0 && gr.y1 < (er.y0 + er.y1) / 2 && !!gl && gl.x1 < (el.x0 + el.x1) / 2, [gr, er]);
  const half = T.backManEye(-1, 0, 0.4, w, h), shutEye = T.backManEye(-1, 0, 1, w, h);
  const hs = span(half.shape);
  ok("squinting: narrower, the glint gone; shut, a happy ^ (its point up)", hs.y1 - hs.y0 < hs.x1 - hs.x0 && !half.closed && !half.glint && shutEye.closed && !shutEye.glint && shutEye.shape.length === 6 && shutEye.shape[1][1] === Math.min(...shutEye.shape.map((q) => q[1])));
  ok("...moved with the bend", span(T.backManEye(-1, -0.4, 0, w, h).shape).x0 < el.x0);
}

section("Back-man: the bite and the gulp");
{
  const b0 = T.backManBite(0), mid = T.backManBite(T.BACKMAN_CHOMP_MS / 2);
  ok("the bite: the mouth shut at the key, wide open half a bite on", b0.open === 0 && mid.open > 0.99 && b0.front === 0 && b0.squint === 0);
  let fT = 0, fMax = 0, bT = 0, bMax = 0, sT = 0, sMax = 0;
  for (let ms = 0; ms <= T.BACKMAN_HOLD_MS; ms += 2) {
    const b = T.backManBite(ms);
    if (b.front > fMax) { fMax = b.front; fT = ms; }
    if (b.back > bMax) { bMax = b.back; bT = ms; }
    if (b.squint > sMax) { sMax = b.squint; sT = ms; }
  }
  ok("the gulp: the front swells, then the back - going down - as the jaws shut", fT > T.BACKMAN_CHOMP_MS / 2 && bT > fT + 40 && fMax > 0.95 * T.BACKMAN_GROW && bMax > 0.95 * T.BACKMAN_GROW, [fT, bT]);
  ok("...with a happy squint, shut at its height", sMax > 0.99 && sT > fT && sT < bT + 40 && T.backManEye(-1, 0, T.backManBite(sT).squint, 9, 24).closed, sT);
  const end = T.backManBite(T.BACKMAN_HOLD_MS);
  ok("...all over by the end of the hold", end.open === 0 && end.front === 0 && end.back === 0 && end.squint === 0 && end.done);
}

section("Back-man: chewing at its own pace");
{
  const CH = T.BACKMAN_CHOMP_MS;
  // A held key: a letter every 33 ms for 600 ms.
  let c = null;
  for (let t = 0; t <= 594; t += 33) c = T.backManChew(c, t, false);
  ok("a held key is one run of chewing (each key does not start the bite again)", c.c0 === 0 && c.t === 594);
  let peaks = 0, half = 0, prev = 0, rising = true;
  const b = (tn) => T.backManBite(tn, c.t - c.c0, false);
  for (let tn = 0; tn <= b(0).end + 20; tn++) {
    const o = b(tn).open;
    if (rising && o < prev) { if (prev > 0.99) peaks++; else half++; rising = false; }
    if (o > prev) rising = true;
    prev = o;
  }
  ok("...the mouth opens all the way every chomp, about seven a second - never a flicker of half bites", peaks === Math.round(b(0).end / CH) && half === 0 && Math.abs(1000 / CH - 7) < 0.2, [peaks, half, b(0).end]);
  ok("...and finishes the chomp the last key fell in, then gulps", b(b(0).end - 1).open > 0 && b(b(0).end).open === 0 && b(b(0).end).front > 0);
  let taps = T.backManChew(null, 0, false);
  taps = T.backManChew(taps, 200, false);
  ok("taps slower than it chews: each a bite of its own, from its key", taps.c0 === 200 && T.backManBite(CH / 2, 0, false).open > 0.99);
  const quick = T.backManChew(T.backManChew(null, 0, false), 100, false);
  ok("...a tap mid-chomp: the next chomp, straight after (two letters, two chomps)", quick.c0 === 0 && T.backManBite(0, 100, false).end === 2 * CH);
  const big = T.backManChew(quick, 120, true);
  ok("a big bite (a word, a selection) starts a run of its own", big.c0 === 120 && big.big === true);
  let bigFront = 0, bigOpen = 0;
  for (let tn = 0; tn < 1000; tn += 2) { const q = T.backManBite(tn, 0, true); bigFront = Math.max(bigFront, q.front); if (q.open > 0.99 && !bigOpen) bigOpen = tn; }
  ok("...slower, and a much bigger gulp", bigOpen > 0.6 * CH && T.backManBite(0, 0, true).end === T.BACKMAN_BIG.chomp * CH && bigFront > 1.8 * T.BACKMAN_GROW, [bigOpen, bigFront]);
  ok("a letter set off is down when the chomp it fell in shuts (the next, when that one is nearly shut)", T.backManDown({ c0: 0, big: false }, 30) === CH && T.backManDown({ c0: 0, big: false }, 120) === 2 * CH);
}

section("Back-man: the spring");

section("Back-man: the spring");
{
  const s = { bend: 0, v: -T.BACKMAN_BEND_KICK };
  let peak = 0, back = 0, t = 0;
  for (; t < 2; t += 1 / 60) {
    T.backManSpring(s, 1 / 60);
    peak = Math.min(peak, s.bend);
    if (peak < -0.1) back = Math.max(back, s.bend);
  }
  ok("a bite (leftward) bends it a good part of a box width", peak < -0.2 && peak >= -T.BACKMAN_BEND_MAX, peak);
  ok("...then it eases back, a hair past straight (a little inertia, no wobble)", back > 0.002 && back < 0.15 * -peak, back);
  ok("...and settles", Math.abs(s.bend) < 0.004 && Math.abs(s.v) < 0.05, s);
  const a = { bend: 0, v: 3 }, b = { bend: 0, v: 3 };
  for (let k = 0; k < 30; k++) T.backManSpring(a, 1 / 120);
  T.backManSpring(b, 0.25);
  ok("the same swing at any frame rate", Math.abs(a.bend - b.bend) < 0.01, [a.bend, b.bend]);
  const held = { bend: 0, v: 0 };
  for (let k = 0; k < 60; k++) { held.v -= T.BACKMAN_BEND_KICK; T.backManSpring(held, 1 / 30); }
  ok("a held key never bends it past the most", held.bend >= -T.BACKMAN_BEND_MAX - 1e-9 && held.bend < -0.2, held.bend);
}

section("Back-man: the bites");
{
  const e = makeEngine({ cursorStyle: "Box", popEffects: true, backMan: true });
  e.styleFor = (k) => e.look[k];
  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    ok("no bite, no creature", e.backManPose(now) === null);
    e._backManBite(-1);
    let p = e.backManPose(now);
    ok("Backspace: it faces left, its mouth starting shut, its eye open", !!p && p.dir === -1 && p.open < 0.01 && p.squint === 0, p);
    ok("...a frame stamped a hair before the key still shows it", !!e.backManPose(now - 2));
    now += T.BACKMAN_CHOMP_MS / 2;
    p = e.backManPose(now);
    ok("...half a bite on: wide open, bending toward the letters it eats", p.open > 0.99 && p.bend < -0.1, p);
    now += T.BACKMAN_CHOMP_MS / 2 + 10;
    p = e.backManPose(now);
    ok("...one bite per letter: shut again after it, still there, gulping", p.open === 0 && p.front > 0);
    e._backManBite(-1);
    now += T.BACKMAN_CHOMP_MS / 2;
    p = e.backManPose(now);
    ok("the next letter: a bite of its own, from its key", p.open > 0.99);
    const atBite = Math.abs(p.bend);
    const last = now - T.BACKMAN_CHOMP_MS / 2;
    now = last + T.BACKMAN_HOLD_MS - 1;
    p = e.backManPose(now);
    ok("after the last bite: the mouth shut, the bend easing back", !!p && p.open === 0 && Math.abs(p.bend) < atBite / 2, [atBite, p]);
    now = last + 500;
    ok("...and a Box again within half a second", e.backManPose(now) === null && !e.backManMoving(now));
    now += 1500;
    e._backManBite(1);
    now += T.BACKMAN_CHOMP_MS / 2;
    p = e.backManPose(now);
    ok("Delete: it faces right and bends right (the letters come from the right)", p.dir === 1 && p.bend > 0.1, p);
    const line = makeEngine({ cursorStyle: "Line", popEffects: true, backMan: true });
    line.styleFor = (k) => line.look[k];
    line._backManBite(-1);
    ok("on a Line too (the cursor morphs into its box: effects-eaters.ts)", !!line.backManPose(now));
    const under = makeEngine({ cursorStyle: "Underline", popEffects: true, backMan: true });
    under.styleFor = (k) => under.look[k];
    under._backManBite(-1);
    ok("...and on an Underline", !!under.backManPose(now));
    const held = makeEngine({ cursorStyle: "Box", popEffects: true, backMan: true });
    held.styleFor = (k) => held.look[k];
    const start = now + 5000;
    for (let k = 0; k < 18; k++) { now = start + k * 33; held._backManBite(-1); }
    const mids = [0.5, 1.5, 2.5].map((c) => held.backManPose(start + c * T.BACKMAN_CHOMP_MS));
    ok("a held Backspace: one run, the mouth wide open at every chomp's middle though keys keep coming", held._backMan.c0 === start && mids.every((p) => p && p.open > 0.99), mids.map((p) => p && p.open));
    now = start + 5000;
    const small = makeEngine({ cursorStyle: "Box", popEffects: true, backMan: true }), wide = makeEngine({ cursorStyle: "Box", popEffects: true, backMan: true });
    for (const x of [small, wide]) x.styleFor = (k) => x.look[k];
    small._backManBite(-1); wide._backManBite(-1, true);
    ok("a big bite (Ctrl+Backspace, a selection) kicks harder and chews slower", Math.abs(wide._backMan.v) > Math.abs(small._backMan.v) && wide._backMan.big && wide.backManPose(now + T.BACKMAN_CHOMP_MS).open > 0.5 && small.backManPose(now + T.BACKMAN_CHOMP_MS).open < 0.01);
    const off = makeEngine({ cursorStyle: "Box", popEffects: false, backMan: true });
    off.styleFor = (k) => off.look[k];
    off._backManBite(-1);
    ok("...nor with Pop effects off", off.backManPose(now) === null);
  } finally {
    performance.now = realNow;
  }
}

section("Back-man: the setting");
{
  ok("a look key, appended (Shredder and Rabbit hole after it), off by default", T.LOOK_KEYS.slice(-4, -1).join() === "backMan,shredder,rabbitHole" && T.DEFAULT_SETTINGS.backMan === false);
  const rows = renderPanel({ popEffects: true, cursorStyle: "Line", backMan: true });
  const dd = rows.find((r) => r.name === "When you delete").dropdowns[0];
  ok("a choice of \"When you delete\" - on a Line as on a Box, no switch of its own, no hint", dd._value === "backman" && dd._options.backman === "Back-man" && !rows.some((r) => r.name === "Back-man") && rows.cardKeys.Effects.includes("backMan"));
  const rolls = Array.from({ length: 300 }, (_, k) => T.rollLook({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(500 + k)));
  ok("the Randomizer rolls it sometimes, on any cursor", rolls.some((l) => l.backMan && l.cursorStyle === "Box") && rolls.some((l) => l.backMan && l.cursorStyle !== "Box"));
}

section("Back-man: the meal");
{
  const e = makeEngine({ cursorStyle: "Box", popEffects: true, backMan: true, backspaceEvaporate: true, backspaceDisintegrate: true });
  e.styleFor = (k) => e.look[k];
  e.evaporateGlyphs = [];
  const realNow = performance.now;
  let now = 5000;
  performance.now = () => now;
  try {
    const old = { top: 10, h: 24, fontSize: 16, fontFamily: "Inter", fontWeight: "400", fontStyle: "normal", textColor: "#dddddd" };
    e.deletedLetters = () => ({ letters: [{ char: "a", x: 80, w: 8 }, { char: " ", x: 72, w: 8 }, { char: "b", x: 64, w: 8 }], forward: false, old });
    e._backManBite(-1);
    const along = e._deletionFx({}, {});
    const meal = e._backMan.meal;
    ok("a deletion feeds it the letters (no spaces), each from the middle of where it stood, in the text's color", meal.length === 2 && meal[0].char === "a" && meal[0].cx === 84 && meal[0].cy === 22 && meal[0].color === "#dddddd" && meal[1].char === "b", meal);
    ok("...and it has them: no evaporation, no burst where the caret stood", along === true && e.evaporateGlyphs.length === 0);
    let p = e.backManPose(now);
    ok("the letters start where they stood", p.meal.length === 2 && p.meal[0].e === 0);
    now += T.BACKMAN_CHOMP_MS / 2;
    p = e.backManPose(now);
    ok("...most of the way in by the mouth's widest", p.meal[0].e > 0.7 && p.meal[0].e < 1);
    now += T.BACKMAN_CHOMP_MS / 2 + 1;
    ok("...and gone as the jaws shut", e.backManPose(now).meal.length === 0);
  } finally {
    performance.now = realNow;
  }
}

section("Back-man: drawn");
{
  // A canvas that records what is drawn.
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => { calls.push([k, ...a]); }),
    set: (o, k, v) => { o[k] = v; calls.push(["set " + String(k), v]); return true; },
  });
  const pose = { open: 1, dir: -1, bend: -0.3, front: 0.1, back: 0.1, squint: 0 };
  const plugin = { _markDirty() {}, _drawBackManMeal: T.EngineProto._drawBackManMeal };
  T.EngineProto.drawBackMan.call(plugin, ctx, 100, 10, 9, 24, "#ff8800", pose);
  const pts = calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => [c[1], c[2]]);
  const at = (name, value) => calls.findIndex((c) => c[0] === "set " + name && c[1] === value);
  const bodyFill = calls.findIndex((c) => c[0] === "fill");
  ok("filled: the creature in the box's paint, soft-lipped", bodyFill > 0 && calls.filter((c) => c[0] === "quadraticCurveTo").length === 3);
  const after = calls.slice(bodyFill + 1);
  ok("...then its eye cut out of it (the background shows), square", at("globalCompositeOperation", "destination-out") > bodyFill && after.filter((c) => c[0] === "moveTo").length === 2 && after.filter((c) => c[0] === "lineTo").length === 6 && !calls.some((c) => c[0] === "ellipse" || c[0] === "arc"));
  ok("...and a white square glint in the eye", at("fillStyle", "#ffffff") > at("globalCompositeOperation", "destination-out"));
  ok("...the glow kept out of the eye", at("shadowBlur", 0) > bodyFill);
  ok("...its head and feet exactly the box's: the top at the box's top, the bottom at its bottom, the corners where the box's are",
     Math.min(...pts.map(([, y]) => y)) === 10 && Math.max(...pts.map(([, y]) => y)) === 34 &&
     [[100, 10], [109, 10], [109, 34], [100, 34]].every(([cx, cy]) => pts.some(([x, y]) => Math.abs(x - cx) < 1e-9 && y === cy)), pts);
  ok("...nothing grows it taller or skews it (no transform)", !calls.some((c) => c[0] === "transform" || c[0] === "setTransform" || c[0] === "scale"));
  calls.length = 0;
  T.EngineProto.drawBackMan.call(plugin, ctx, 100, 10, 9, 24, "#ff8800", { ...pose, open: 0 });
  const shutPts = calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => [c[1], c[2]]);
  ok("...its middle bent and swollen past the box's left edge (the mouth shut)", shutPts.some(([x, y]) => y === 22 && Math.abs(x - (100 - 0.4 * 9)) < 1e-9), shutPts);
  calls.length = 0;
  T.EngineProto.drawBackMan.call(plugin, ctx, 100, 10, 9, 24, "#ff8800", { ...pose, squint: 1 });
  const shutAfter = calls.slice(calls.findIndex((c) => c[0] === "fill") + 1);
  ok("squinting shut: the eye a happy ^ (six corners), no glint", shutAfter.filter((c) => c[0] === "moveTo").length === 1 && shutAfter.filter((c) => c[0] === "lineTo").length === 5 && at("fillStyle", "#ffffff") < 0);
  calls.length = 0;
  T.EngineProto.drawBackMan.call(plugin, ctx, 100, 10, 9, 24, "#ff8800", pose, 0, 2);
  ok("with Rounded corners: the head and feet rounded as the box's (four more curves)", calls.filter((c) => c[0] === "quadraticCurveTo").length === 7);
  calls.length = 0;
  T.EngineProto.drawBackMan.call(plugin, ctx, 100, 10, 9, 24, "#ff8800", pose, 2);
  const stroke = calls.findIndex((c) => c[0] === "stroke");
  ok("hollow: its outline, at the outline's width, not filled", stroke > 0 && at("lineWidth", 2) >= 0 && calls.findIndex((c) => c[0] === "fill") > stroke);
  ok("...the eye a dot of its paint, the glint cut out of it", at("globalCompositeOperation", "source-over") > stroke && at("globalCompositeOperation", "destination-out") > at("globalCompositeOperation", "source-over"));
  calls.length = 0;
  const morsel = { char: "a", cx: 84, cy: 22, font: "16px Inter", color: "#dddddd", t0: 0 };
  T.EngineProto.drawBackMan.call(plugin, ctx, 100, 10, 9, 24, "#ff8800", { ...pose, meal: [{ m: morsel, e: 0.5 }] });
  const text = calls.findIndex((c) => c[0] === "fillText" && c[1] === "a");
  ok("a letter going in: drawn before the body (under it: seen in the mouth, gone behind the jaws), shrunk, in the text's color",
     text >= 0 && text < calls.findIndex((c) => c[0] === "fill") && calls.some((c) => c[0] === "scale" && c[1] < 1) && at("fillStyle", "#dddddd") >= 0);
}
