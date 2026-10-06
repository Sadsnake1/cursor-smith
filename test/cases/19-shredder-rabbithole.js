// Pop effects' Shredder (a Line's) and Rabbit hole (an Underline's), 1.7.7:
// what Backspace and Delete take, cut into ribbons by the Line broken into
// blades, or dropped onto the Underline - a little trampoline - squashing,
// and pulled through as it sags, the floor springing back after. The pure
// parts (shredDash, shredBlades, shredFeed; holeFall, holeSpring), the
// runs and the poses, the deletion, the settings, the
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

section("Rabbit hole: the drop, the squash, the pull, the bounce");
{
  const l = { char: "a", cx: 104.5, cy: 10, half: 4.8, font: "16px x", color: "#ddd", t0: 0, landed: false };
  const F = T.HOLE_FALL_MS, at = (f) => T.holeFall(l, 104.5, 22, f * F);
  const start = at(0), dropping = at(0.2), landing = at(0.5), through = at(0.8), gone = at(1);
  ok("a letter drops from where it stood onto the floor, whole, faster and faster", start.foot === 14.8 && start.sx === 1 && start.sy === 1 && start.phase === 0 && dropping.foot > 14.8 && dropping.foot - 14.8 < (22 - 14.8) / 2);
  ok("...squashes flat as it lands, on the floor", landing.phase === 1 && landing.foot === 22 && landing.sy < 1 - 0.8 * T.HOLE_SQUASH && landing.sx > 1.2);
  ok("...then goes through it, turning a little, its top past the floor by the end", through.phase === 2 && through.foot > 22 && through.rot > 0 && gone.done && gone.foot - 2 * l.half * gone.k > 22);
  const sp = { sag: 0, v: 0 };
  let low = 0;
  for (let k = 0; k < 30; k++) { T.holeSpring(sp, 1 / 60, T.HOLE_SAG); low = Math.max(low, sp.sag); }
  ok("the floor sags under the weight, a little past it (it gives)", low > T.HOLE_SAG && low < 2 * T.HOLE_SAG, low);
  let up = 0;
  for (let k = 0; k < 60; k++) { T.holeSpring(sp, 1 / 60, 0); up = Math.min(up, sp.sag); }
  ok("...let go, it springs back up past straight - the trampoline", up < -0.05, up);
  for (let k = 0; k < 120; k++) T.holeSpring(sp, 1 / 60, 0);
  ok("...and settles", Math.abs(sp.sag) < 0.003 && Math.abs(sp.v) < 0.05, sp);
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
    const box = makeEngine({ cursorStyle: "Box", popEffects: true, shredder: true });
    box.styleFor = (k) => box.look[k];
    box._shredBite();
    ok("a Box shreds too (it morphs into the line: effects-eaters.ts)", !!box.shredPose(now));

    const ul = makeEngine({ cursorStyle: "Underline", popEffects: true, rabbitHole: true });
    ul.styleFor = (k) => ul.look[k];
    ul.fontString = () => "16px x";
    ul.getActiveColor = () => "#ccc";
    ul._holeBite();
    ul.spawnHoleMeal({ letters: [{ char: "b", x: 200, w: 9 }], forward: false, old: { top: 0, h: 24, textColor: "#eee", fontSize: 16 } });
    let q = ul.holePose(now);
    ok("Backspace on an Underline: a light tap, the letter dropping from the middle of its cell", !!q && q.letters.length === 1 && q.letters[0].cx === 204.5 && q.letters[0].cy === 12 && q.letters[0].half === 4.8);
    now += 0.5 * T.HOLE_FALL_MS;
    q = ul.holePose(now);
    ok("...landed: the floor kicked and sagging under it", q.letters[0].landed && q.sag > 0.1, q.sag);
    let up = 0;
    for (let k = 0; k < 40 && ul._hole; k++) { now += 16; const r = ul.holePose(now); if (r) up = Math.min(up, r.sag); }
    ok("...gone through: the floor springs back up past straight", up < -0.02, up);
    now += 3000;
    ok("...and then it is the bar again", ul.holePose(now) === null && !ul.holeMoving(now));
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
  const bare = mk("Line", { shredder: true, shredderLetters: false });
  bare._shredBite();
  ok("...Shredded letters off: the blades alone - the letters simply gone, still not evaporating", bare._deletionFx({}, {}) === true && bare._shred.letters.length === 0 && bare.evaporateGlyphs.length === 0);
  const ul = mk("Underline", { rabbitHole: true });
  ul._holeBite();
  ok("...and Rabbit hole", ul._deletionFx({}, {}) === true && ul._hole.letters.length === 1 && ul.evaporateGlyphs.length === 0);
  const both = mk("Underline", { shredder: true, rabbitHole: true });
  both._shredBite(); both._holeBite();
  both._deletionFx({}, {});
  ok("...one at a time: a look with two on (saved before) is the first of them - Shredder, on an Underline too", both._shred.letters.length === 1 && !both._hole && both.evaporateGlyphs.length === 0);
}

section("Shredder and Rabbit hole: the settings");
{
  ok("two look keys, appended, off by default; Shredder's letters after them, on", T.LOOK_KEYS.slice(-3).join() === "shredder,rabbitHole,shredderLetters" && T.DEFAULT_SETTINGS.shredder === false && T.DEFAULT_SETTINGS.rabbitHole === false && T.DEFAULT_SETTINGS.shredderLetters === true);
  const dd = (look) => renderPanel({ popEffects: true, ...look }).find((r) => r.name === "Cursor on delete").dropdowns[0];
  ok("choices of \"Cursor on delete\", on any cursor", dd({ cursorStyle: "Box", shredder: true })._value === "shredder" && dd({ cursorStyle: "Line", rabbitHole: true })._value === "rabbithole" && dd({ cursorStyle: "Box" })._options.rabbithole === "Rabbit hole");
  const on = renderPanel({ popEffects: true, cursorStyle: "Box", shredder: true });
  const sub = on.find((r) => r.name === "Shredded letters");
  ok("Shredded letters: under the choice, shown with Shredder chosen, on any cursor", !!sub && on.findIndex((r) => r.name === "Shredded letters") === on.findIndex((r) => r.name === "Cursor on delete") + 1 && sub.def.visible() && on.cardKeys.Effects.includes("shredderLetters"));
  const other = renderPanel({ popEffects: true, cursorStyle: "Line", rabbitHole: true });
  ok("...hidden with another choice", !other.find((r) => r.name === "Shredded letters").def.visible());
  const rolls = Array.from({ length: 400 }, (_, k) => T.rollLook({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(900 + k)));
  ok("the Randomizer rolls each sometimes, on any cursor, one choice at a time", rolls.some((l) => l.shredder && l.cursorStyle !== "Line") && rolls.some((l) => l.rabbitHole && l.cursorStyle !== "Underline") && rolls.every((l) => ["backMan", "shredder", "rabbitHole"].filter((k) => l[k]).length <= 1 && ["backspaceEvaporate", "backspaceDisintegrate"].filter((k) => l[k]).length <= 1) && rolls.some((l) => l.backMan && l.backspaceDisintegrate));
}

section("Shredder and Rabbit hole: drawn");
{
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => { calls.push([k, ...a]); }),
    set: (o, k, v) => { o[k] = v; calls.push(["set " + String(k), v]); return true; },
  });
  const plugin = { _markDirty() {}, look: {} };
  T.EngineProto.drawShredLine.call(plugin, ctx, 100, 0, 2, 24, "#f80", { dash: 1, letters: [] }, 0);
  ok("the Line as blades: six rects in one fill, in the line's paint", calls.filter((c) => c[0] === "rect").length === 6 && calls.filter((c) => c[0] === "fill").length === 1);
  calls.length = 0;
  const l = { char: "a", x: 100, w: 9, top: 0, h: 24, font: "16px x", color: "#ddd", t0: 0 };
  T.EngineProto.drawShreds.call(plugin, ctx, 100, { dash: 1, letters: [l] }, T.SHRED_FEED_MS / 2);
  ok("a letter half through: drawn whole past the cut, and as five sheared ribbons before it", calls.filter((c) => c[0] === "fillText").length === 1 + T.SHRED_RIBBONS && calls.filter((c) => c[0] === "transform").length === T.SHRED_RIBBONS && calls.filter((c) => c[0] === "clip").length === 1 + T.SHRED_RIBBONS);
  calls.length = 0;
  const h = { char: "b", cx: 104.5, cy: 10, half: 4.8, font: "16px x", color: "#ddd", t0: 0, landed: true };
  T.EngineProto.drawHole.call(plugin, ctx, 100, 22, 9, 2, "#f80", { sag: T.HOLE_SAG, letters: [h] }, T.HOLE_FALL_MS / 2);
  const kinds = calls.filter((c) => ["fill", "stroke", "fillText", "clip"].includes(c[0])).map((c) => c[0]).join();
  ok("the Underline sagging: the letter (squashed on it), clipped to above the bar, then the bar - no hole, no circle", kinds === "clip,fillText,stroke" && !calls.some((c) => c[0] === "ellipse" || c[0] === "arc") && calls.some((c) => c[0] === "scale" && c[2] < c[1]), kinds);
  const bend = calls.filter((c) => c[0] === "quadraticCurveTo").pop();
  ok("...the bar a shallow curve: its ends where they were, its middle down a little, at its thickness in its paint",
     !!bend && bend[3] === 109 && bend[4] === 23 && bend[2] > 23 && bend[2] - 23 <= 2 * 0.35 * 9 && calls.some((c) => c[0] === "set lineWidth" && c[1] === 2) && calls.some((c) => c[0] === "set strokeStyle" && c[1] === "#f80"));
}
