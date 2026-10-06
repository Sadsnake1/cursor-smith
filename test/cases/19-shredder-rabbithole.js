// Pop effects' Shredder (a Line's) and Rabbit hole (an Underline's), 1.7.7:
// what Backspace and Delete take, cut into ribbons by the Line broken into
// blades, or pulled down into the hole the Underline opens into. The pure
// parts (shredDash, shredBlades, shredFeed; holeOpen, holeShape,
// holeFall), the runs and the poses, the deletion, the settings, the
// drawing.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine, renderPanel } = require("../lib");

section("Shredder: the blades and the ribbons");
{
  ok("the line is whole before and after, all blades between", T.shredDash(0, 0) === 0 && T.shredDash(100, 0) === 1 && T.shredDash(100, T.SHRED_HOLD_MS) === 0 && T.shredDash(100, T.SHRED_HOLD_MS - 45) > 0.4 && T.shredDash(100, T.SHRED_HOLD_MS - 45) < 0.6);
  const whole = T.shredBlades(0, 2, 24, 0), cut = T.shredBlades(1, 2, 24, 0);
  const covered = (b) => b.reduce((n, [, , len]) => n + len, 0);
  ok("whole: the blades meet, the line's full height, not a hair aside", Math.abs(covered(whole) - 24) < 1e-9 && whole.every(([dx]) => dx === 0));
  ok("cut: six blades with gaps between, buzzing a little sideways", cut.length === 6 && covered(cut) < 0.65 * 24 && covered(cut) > 0.5 * 24 && cut.some(([dx]) => Math.abs(dx) > 0.1) && cut.every(([dx]) => Math.abs(dx) <= 0.7));
  const l = { char: "a", x: 100, w: 9, top: 0, h: 24, font: "16px x", color: "#ddd", t0: 0 };
  const start = T.shredFeed(l, 100, 0), end = T.shredFeed(l, 100, T.SHRED_FEED_MS), gone = T.shredFeed(l, 100, T.SHRED_FEED_MS + T.SHRED_FALL_MS);
  ok("a letter: from where it stood, through the cut to a pixel past it", start.dx === 0 && Math.abs(end.dx - -10) < 1e-9);
  ok("...its ribbons falling and fading after, then gone", start.dy === 0 && end.dy > 0 && end.alpha === 1 && T.shredFeed(l, 100, T.SHRED_FEED_MS + T.SHRED_FALL_MS / 2).alpha < 0.6 && gone.done);
}

section("Rabbit hole: the hole and the fall");
{
  ok("the hole opens fast and closes over the hold's end", T.holeOpen(0, 0) === 0 && T.holeOpen(T.HOLE_OPEN_MS, 0) === 1 && T.holeOpen(500, T.HOLE_HOLD_MS) === 0 && T.holeOpen(500, T.HOLE_HOLD_MS - 60) === 0.5);
  const shut = T.holeShape(0, 9, 2), wide = T.holeShape(1, 9, 2);
  ok("shut: the bar itself; open: wider than the bar and deep", shut.rx === 4.5 && shut.ry === 1 && wide.rx > 4.5 && wide.ry > 3 && wide.cx === 4.5 && wide.cy === 1);
  const l = { char: "a", cx: 104.5, cy: 10, font: "16px x", color: "#ddd", t0: 0 };
  const a = T.holeFall(l, 104.5, 23, 0), b = T.holeFall(l, 104.5, 23, T.HOLE_FALL_MS / 2), c = T.holeFall(l, 104.5, 23, T.HOLE_FALL_MS);
  ok("a letter: from where it stood, pulled down into the hole faster and faster, shrinking and swirling", a.y === 10 && a.k === 1 && a.rot === 0 && b.y > 10 && b.y - 10 < (23 - 10) / 2 && b.k < 1 && b.rot > 0 && c.done && c.y === 23 && c.k < 0.2);
}

section("Shredder and Rabbit hole: the runs");
{
  const realNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    const line = makeEngine({ cursorStyle: "Line", popEffects: true, shredder: true });
    line.styleFor = (k) => line.look[k];
    line.fontString = () => "16px x";
    line.getActiveColor = () => "#ccc";
    ok("no key, no blades", line.shredPose(now) === null);
    line._shredBite();
    line.spawnShreds({ letters: [{ char: "a", x: 100, w: 9 }, { char: " ", x: 91, w: 9 }], forward: false, old: { top: 0, h: 24, textColor: "#ddd" } });
    now += 50;
    let p = line.shredPose(now);
    ok("Backspace on a Line: the blades out, the letter going through (no space)", !!p && p.dash === 1 && p.letters.length === 1 && p.letters[0].color === "#ddd");
    now += T.SHRED_HOLD_MS + 20;
    p = line.shredPose(now);
    ok("...after the hold the line is whole again, the ribbons still falling", !!p && p.dash === 0 && p.letters.length === 1);
    now += T.SHRED_FALL_MS;
    ok("...and then it is all over", line.shredPose(now) === null && !line.shredMoving(now));
    const box = makeEngine({ cursorStyle: "Box", popEffects: true, shredder: true, rabbitHole: true });
    box.styleFor = (k) => box.look[k];
    box._shredBite(); box._holeBite();
    ok("a Box neither shreds nor opens a hole", box.shredPose(now) === null && box.holePose(now) === null);

    const ul = makeEngine({ cursorStyle: "Underline", popEffects: true, rabbitHole: true });
    ul.styleFor = (k) => ul.look[k];
    ul.fontString = () => "16px x";
    ul.getActiveColor = () => "#ccc";
    ul._holeBite();
    ul.spawnHoleMeal({ letters: [{ char: "b", x: 200, w: 9 }], forward: false, old: { top: 0, h: 24, textColor: "#eee" } });
    now += T.HOLE_OPEN_MS;
    let q = ul.holePose(now);
    ok("Backspace on an Underline: the hole wide open, the letter going in from the middle of its cell", !!q && q.open === 1 && q.letters.length === 1 && q.letters[0].cx === 204.5 && q.letters[0].cy === 12);
    now += 100;
    ul._holeBite();
    now += T.HOLE_HOLD_MS - 130;
    ok("a held key keeps it open", ul.holePose(now).open === 1);
    now += 400;
    ok("...then it closes and is the bar again", ul.holePose(now) === null);
    const off = makeEngine({ cursorStyle: "Underline", popEffects: false, rabbitHole: true });
    off.styleFor = (k) => off.look[k];
    off._holeBite();
    ok("...not with Pop effects off", off.holePose(now) === null);
  } finally {
    performance.now = realNow;
  }
}

section("Shredder and Rabbit hole: they have the letters");
{
  const mk = (style, keys) => {
    const e = makeEngine({ cursorStyle: style, popEffects: true, backspaceEvaporate: true, backspaceDisintegrate: true, ...keys });
    e.styleFor = (k) => e.look[k];
    e._resetEngineState();
    e.evaporateGlyphs = [];
    e.fontString = () => "16px x";
    e.getActiveColor = () => "#ccc";
    e.deletedLetters = () => ({ letters: [{ char: "a", x: 80, w: 8 }], forward: false, old: { top: 0, h: 24, textColor: "#ddd" } });
    return e;
  };
  const line = mk("Line", { shredder: true });
  line._shredBite();
  ok("Shredder takes the deleted letters: no evaporation, no burst where the caret stood", line._deletionFx({}, {}) === true && line._shred.letters.length === 1 && line.evaporateGlyphs.length === 0);
  const ul = mk("Underline", { rabbitHole: true });
  ul._holeBite();
  ok("...and Rabbit hole", ul._deletionFx({}, {}) === true && ul._hole.letters.length === 1 && ul.evaporateGlyphs.length === 0);
  const plain = mk("Underline", { shredder: true });
  plain._deletionFx({}, {});
  ok("...but only on their own cursor: Shredder on an Underline leaves them to evaporation", plain.evaporateGlyphs.length === 1);
}

section("Shredder and Rabbit hole: the settings");
{
  ok("two look keys, appended last, off by default", T.LOOK_KEYS.slice(-2).join() === "shredder,rabbitHole" && T.DEFAULT_SETTINGS.shredder === false && T.DEFAULT_SETTINGS.rabbitHole === false);
  const rows = (style) => renderPanel({ popEffects: true, cursorStyle: style });
  const needs = (style, name) => { const r = rows(style).find((x) => x.name === name); return r && r.settingEl.classes.includes("cursor-smith-needs"); };
  const all = rows("Line");
  const i = all.findIndex((r) => r.name === "Shredder"), j = all.findIndex((r) => r.name === "Rabbit hole");
  ok("two switches under Pop effects, right after Back-man", i === all.findIndex((r) => r.name === "Back-man") + 1 && j === i + 1 && all.cardKeys.Effects.includes("shredder") && all.cardKeys.Effects.includes("rabbitHole"));
  ok("...each live on its own cursor, shown but disabled with its hint on the others", !needs("Line", "Shredder") && needs("Box", "Shredder") && needs("Underline", "Shredder") && !needs("Underline", "Rabbit hole") && needs("Line", "Rabbit hole") && needs("Box", "Rabbit hole"));
  const rolls = Array.from({ length: 400 }, (_, k) => T.rollLook({ chaos: 100, color: 50, motion: 50, sounds: false }, T.seededRandom(900 + k)));
  ok("the Randomizer rolls each sometimes, on its own cursor only", rolls.some((l) => l.shredder) && rolls.some((l) => l.rabbitHole) && rolls.every((l) => (!l.shredder || l.cursorStyle === "Line") && (!l.rabbitHole || l.cursorStyle === "Underline")));
}

section("Shredder and Rabbit hole: drawn");
{
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => { calls.push([k, ...a]); }),
    set: (o, k, v) => { o[k] = v; calls.push(["set " + String(k), v]); return true; },
  });
  const plugin = { _markDirty() {} };
  T.EngineProto.drawShredLine.call(plugin, ctx, 100, 0, 2, 24, "#f80", { dash: 1, letters: [] }, 0);
  ok("the Line as blades: six rects in one fill, in the line's paint", calls.filter((c) => c[0] === "rect").length === 6 && calls.filter((c) => c[0] === "fill").length === 1);
  calls.length = 0;
  const l = { char: "a", x: 100, w: 9, top: 0, h: 24, font: "16px x", color: "#ddd", t0: 0 };
  T.EngineProto.drawShreds.call(plugin, ctx, 100, { dash: 1, letters: [l] }, T.SHRED_FEED_MS / 2);
  ok("a letter half through: drawn whole past the cut, and as five sheared ribbons before it", calls.filter((c) => c[0] === "fillText").length === 1 + T.SHRED_RIBBONS && calls.filter((c) => c[0] === "transform").length === T.SHRED_RIBBONS && calls.filter((c) => c[0] === "clip").length === 1 + T.SHRED_RIBBONS);
  calls.length = 0;
  const h = { char: "b", cx: 104.5, cy: 10, font: "16px x", color: "#ddd", t0: 0 };
  T.EngineProto.drawHole.call(plugin, ctx, 100, 22, 9, 2, "#f80", { open: 1, letters: [h] }, T.HOLE_FALL_MS / 2);
  const kinds = calls.filter((c) => ["fill", "stroke", "fillText", "clip"].includes(c[0])).map((c) => c[0]).join();
  ok("the Underline as a hole: the dark inside, the far rim, the letter clipped to above the bar and the hole, the near rim", kinds === "fill,fill,stroke,clip,fillText,stroke", kinds);
  ok("...the rims at the bar's thickness, in its paint", calls.some((c) => c[0] === "set lineWidth" && c[1] === 2) && calls.some((c) => c[0] === "set strokeStyle" && c[1] === "#f80"));
}
