// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little creature - the box with a mouth on the side it
// eats from, one bite per letter, its head and feet the box's, its sides
// bent in a V on a spring and swelling while it eats. The outline
// (backManShape), the spring (backManSpring), the bites and the pose, the
// setting, the drawing.
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
  ok("...no tail, no eye: an outline inside the box and nothing more", Array.isArray(open) && open.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
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
    ok("Backspace: it faces left, swollen, its mouth starting shut", !!p && p.dir === -1 && p.grow > 0.9 * T.BACKMAN_GROW && p.open < 0.01, p);
    ok("...a frame stamped a hair before the key still shows it", !!e.backManPose(now - 2));
    now += T.BACKMAN_CHOMP_MS / 2;
    p = e.backManPose(now);
    ok("...half a bite on: wide open, bending toward the letters it eats", p.open > 0.99 && p.bend < -0.1, p);
    now += T.BACKMAN_CHOMP_MS / 2 + 10;
    p = e.backManPose(now);
    ok("...one bite per letter: shut again after it, still there, swelling less", p.open === 0 && p.grow < 0.8 * T.BACKMAN_GROW);
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
    ok("a Line cursor stays a Line (no room for a mouth)", line.backManPose(now) === null);
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
  ok("a look key, appended last, off by default", T.LOOK_KEYS[T.LOOK_KEYS.length - 1] === "backMan" && T.DEFAULT_SETTINGS.backMan === false);
  const rows = renderPanel({ popEffects: true, cursorStyle: "Box" });
  const i = rows.findIndex((r) => r.name === "Back-man");
  const row = rows[i];
  ok("a switch under Pop effects, after the Backspace ones", !!row && row.toggles.length === 1 && i > rows.findIndex((r) => r.name === "Backspace evaporation") && i < rows.findIndex((r) => r.name === "Thunderstrike") && rows.cardKeys.Effects.includes("backMan"));
  const lineRows = renderPanel({ popEffects: true, cursorStyle: "Line" });
  const lr = lineRows.find((r) => r.name === "Back-man");
  const hint = lr && lr.descEl.querySelector(".cursor-smith-needs-hint");
  ok("...shown but disabled on a Line, with the hint that it needs the Box cursor", !!lr && lr.settingEl.classes.includes("cursor-smith-needs") && !!hint && /Box cursor/.test(hint.text || ""), hint && hint.text);
  ok("...and not on a Box", !row.settingEl.classes.includes("cursor-smith-needs"));
  const rolls = Array.from({ length: 300 }, (_, k) => T.rollLook({ chaos: 100, color: 50, motion: 50, sounds: false }, T.seededRandom(500 + k)));
  ok("the Randomizer rolls it sometimes, on a Box only", rolls.some((l) => l.backMan) && rolls.every((l) => !l.backMan || l.cursorStyle === "Box"));
}

section("Back-man: drawn");
{
  // A canvas that records what is drawn.
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => { calls.push([k, ...a]); }),
    set: (o, k, v) => { o[k] = v; calls.push(["set " + String(k), v]); return true; },
  });
  const pose = { open: 1, dir: -1, bend: -0.3, grow: 0.1 };
  T.EngineProto.drawBackMan.call({}, ctx, 100, 10, 9, 24, "#ff8800", pose);
  const pts = calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => [c[1], c[2]]);
  ok("filled: the creature, in the box's paint, no eye cut out", calls.some((c) => c[0] === "fill") && !calls.some((c) => c[0] === "fillRect" || (c[0] === "set globalCompositeOperation")));
  ok("...its head and feet exactly the box's: the top at the box's top, the bottom at its bottom, the corners where the box's are",
     Math.min(...pts.map(([, y]) => y)) === 10 && Math.max(...pts.map(([, y]) => y)) === 34 &&
     [[100, 10], [109, 10], [109, 34], [100, 34]].every(([cx, cy]) => pts.some(([x, y]) => Math.abs(x - cx) < 1e-9 && y === cy)), pts);
  ok("...nothing grows it taller or skews it (no transform)", !calls.some((c) => c[0] === "transform" || c[0] === "setTransform" || c[0] === "scale"));
  calls.length = 0;
  T.EngineProto.drawBackMan.call({}, ctx, 100, 10, 9, 24, "#ff8800", { ...pose, open: 0 });
  const shutPts = calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => [c[1], c[2]]);
  ok("...its middle bent and swollen past the box's left edge (the mouth shut)", shutPts.some(([x, y]) => y === 22 && Math.abs(x - (100 - 0.4 * 9)) < 1e-9), shutPts);
  calls.length = 0;
  T.EngineProto.drawBackMan.call({}, ctx, 100, 10, 9, 24, "#ff8800", pose, 2);
  ok("hollow: its outline, at the outline's width, no fill", calls.some((c) => c[0] === "stroke") && calls.some((c) => c[0] === "set lineWidth" && c[1] === 2) && !calls.some((c) => c[0] === "fill" || c[0] === "fillRect"));
}
