// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little pixel creature - a body, one eye, a mouth on
// the side it eats from, chomping, leaning into the bite. The sprite
// (backManCells), the spell of bites and its pose, the setting.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine, renderPanel } = require("../lib");

section("Back-man: the creature");
{
  // Smooth, not pixels: an outline in a unit box, and an eye.
  const open = T.backManShape(1, 1), shut = T.backManShape(0, 1), left = T.backManShape(1, -1);
  // The mouth's corner: the right side's point furthest in, between the jaws.
  const deepest = (shape) => Math.min(...shape.body.filter(([x, y]) => x > 0.05 && y > 0.3 && y < 0.85).map(([x]) => x));
  ok("open, facing right: a V bitten into the right side, well into the box", deepest(open) < 0.5 && deepest(open) > 0.3, deepest(open));
  ok("...shut: the jaws meet, nothing bitten out", deepest(shut) === 1, shut.body);
  ok("...its corners cut, no tail (nothing outside the box)", open.body.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1) && !open.body.some(([x, y]) => (x === 0 && y === 0) || (x === 1 && y === 1)));
  ok("a big eye up near the front: four tenths of the box wide, above the mouth", open.eye.w >= 0.4 && open.eye.x + open.eye.w > 0.8 && open.eye.y + open.eye.h < 0.45, open.eye);
  ok("facing left (Backspace): the same creature mirrored, the mouth and the eye on the left",
     left.body.every(([x, y], i) => Math.abs(x - (1 - open.body[i][0])) < 1e-9 && y === open.body[i][1]) && left.eye.x < 0.2 && Math.abs(left.eye.x + left.eye.w - (1 - open.eye.x)) < 1e-9);
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
    ok("Backspace: it faces left, leaning in fully, its mouth starting shut", !!p && p.dir === -1 && p.lean === 1 && p.open < 0.01, p);
    now += T.BACKMAN_CHOMP_MS / 2;
    p = e.backManPose(now);
    ok("...half a bite on: wide open", p.open > 0.99, p.open);
    now += T.BACKMAN_CHOMP_MS / 2 + 10;
    ok("...one bite per letter: shut again after it, still there", e.backManPose(now).open === 0);
    e._backManBite(-1);
    now += T.BACKMAN_CHOMP_MS / 2;
    ok("the next letter: a bite of its own, from its key", e.backManPose(now).open > 0.99);
    now += T.BACKMAN_HOLD_MS + 1;
    ok("...and it is a Box again a moment after the last bite", e.backManPose(now) === null && !e.backManMoving(now));
    e._backManBite(1);
    ok("Delete: it faces right (the letters come from the right)", e.backManPose(now).dir === 1);
    const line = makeEngine({ cursorStyle: "Line", popEffects: true, backMan: true });
    line.styleFor = (k) => line.look[k];
    line._backManBite(-1);
    ok("a Line cursor stays a Line (no room for a face)", line.backManPose(now) === null);
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
  const pose = { open: 1, dir: -1, lean: 1 };
  T.EngineProto.drawBackMan.call({}, ctx, 100, 10, 9, 24, "#ff8800", pose);
  const erase = calls.findIndex((c) => c[0] === "set globalCompositeOperation" && c[1] === "destination-out");
  ok("filled: the creature, then its eye cut out of it - the background shows, whatever it is", calls.some((c) => c[0] === "fill") && erase > 0 && calls.slice(erase).some((c) => c[0] === "fillRect"));
  ok("...the glow kept out of the cut", calls.some((c) => c[0] === "set shadowBlur" && c[1] === 0));
  calls.length = 0;
  T.EngineProto.drawBackMan.call({}, ctx, 100, 10, 9, 24, "#ff8800", pose, 2);
  ok("hollow: its outline, at the outline's width, and no eye", calls.some((c) => c[0] === "stroke") && calls.some((c) => c[0] === "set lineWidth" && c[1] === 2) && !calls.some((c) => c[0] === "fill" || c[0] === "fillRect"));
}
