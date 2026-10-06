// Pop effects' Shredder (a Line's) and Portal (an Underline's), 1.7.7:
// what Backspace and Delete take, cut into ribbons by the Line broken into
// blades, or dropped straight through the Underline - a still floor, cut
// off at its top edge, the floor lit while it passes. The pure parts
// (shredDash, shredBlades, shredFeed; holeFall, holeGlow), the runs and
// the poses, the deletion, the settings, the drawing.
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

section("Portal: straight through");
{
  // "the portal looks bad, the letters look like fallen trees and the
  // portal like a bouncy bed": no stretch, no turn, no spring.
  const l = { char: "a", cx: 104.5, cy: 10, half: 4.8, w: 9, font: "16px x", color: "#ddd", t0: 0 };
  const F = T.HOLE_FALL_MS, at = (f, ll = l) => T.holeFall(ll, 22, f * F);
  const ks = Array.from({ length: 21 }, (_, i) => at(i / 20));
  ok("a letter over the floor drops straight down from where it stood, never sideways", ks[0].foot === 14.8 && ks[0].through === 0 && ks[0].phase === 0 && ks.every((f) => f.x === 104.5));
  ok("...slow to start, faster as it goes in, always down till it is through", ks.every((f, i) => i === 0 || f.foot > ks[i - 1].foot || ks[i - 1].through === 1) && ks[2].foot - ks[1].foot > ks[1].foot - ks[0].foot && ks[8].foot - ks[7].foot > ks[2].foot - ks[1].foot);
  const crossing = ks.find((f) => f.through > 0 && f.through < 1);
  ok("...into the floor, part of it through (cut off there)", !!crossing && crossing.phase === 2 && crossing.foot > 22);
  ok("...all of it through by the end, its top past the floor's top edge, and gone", ks[20].through === 1 && ks[20].foot - T.HOLE_TALL * l.half >= 22 && ks[20].done && !ks[19].done);
  ok("no turn, no stretch: nothing in the pose but where it is", Object.keys(ks[10]).sort().join() === "done,foot,phase,through,x");
  // A word taken at once: "slid over to the floor, a word's letters piled
  // up on it" - each drops where it stood, the floor reaching under it.
  const far = { ...l, cx: 104.5 + 6 * 9 };
  const fs2 = Array.from({ length: 41 }, (_, i) => at(i / 40, far));
  const first = fs2.findIndex((f) => f.through > 0), last = fs2.findIndex((f) => f.through === 1);
  ok("a word's letter away from the floor drops straight down where it stood too", fs2.every((f) => f.x === far.cx) && fs2[40].done);
  ok("...the floor reaching under it before it goes in, and back only once it is through", T.holeSpan(0) === 0 && T.holeSpan(first / 40) === 1 && T.holeSpan(last / 40) === 1 && T.holeSpan(1) === 0 && T.holeSpan(0.92) > 0 && T.holeSpan(0.92) < 1, [first, last]);
  ok("the glow: none until it goes in, at its height half through, none once gone", T.holeGlow(0) === 0 && T.holeGlow(1) === 0 && Math.abs(T.holeGlow(0.5) - 1) < 1e-9 && T.holeGlow(0.25) > 0.5);
}

section("Shredder and Vacuum: the runs");
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
    ok("Backspace on an Underline: the floor out, the letter dropping from the middle of its cell", !!q && q.letters.length === 1 && q.letters[0].cx === 204.5 && q.letters[0].cy === 12 && q.letters[0].half === 4.8);
    now += 0.6 * T.HOLE_FALL_MS;
    q = ul.holePose(now);
    ok("...going through, the floor still there", !!q && q.letters.length === 1 && Object.keys(q).join() === "letters");
    now += 0.5 * T.HOLE_FALL_MS;
    q = ul.holePose(now);
    ok("...gone through: the floor stays a moment after", !!q && q.letters.length === 0);
    now += T.HOLE_HOLD_MS;
    ok("...and then it is the bar again", ul.holePose(now) === null && !ul.holeMoving(now));
    ul._holeBite();
    ok("a key that took nothing readable: the floor out for the hold, then the bar", !!ul.holePose(now + T.HOLE_HOLD_MS - 1) && ul.holePose(now + T.HOLE_HOLD_MS) === null);
    const off = makeEngine({ cursorStyle: "Underline", popEffects: false, rabbitHole: true });
    off.styleFor = (k) => off.look[k];
    off._holeBite();
    ok("...not with Pop effects off", off.holePose(now) === null);
  } finally {
    performance.now = realNow;
  }
}

section("Shredder and Vacuum: they have the letters");
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
  ok("...and Vacuum", ul._deletionFx({}, {}) === true && ul._hole.letters.length === 1 && ul.evaporateGlyphs.length === 0);
  const both = mk("Underline", { shredder: true, rabbitHole: true });
  both._shredBite(); both._holeBite();
  both._deletionFx({}, {});
  ok("...one at a time: a look with two on (saved before) is the first of them - Shredder, on an Underline too", both._shred.letters.length === 1 && !both._hole && both.evaporateGlyphs.length === 0);
}

section("Shredder and Vacuum: the settings");
{
  ok("two look keys, appended, off by default; Shredder's letters after them, on", T.LOOK_KEYS.slice(T.LOOK_KEYS.indexOf("shredder"), T.LOOK_KEYS.indexOf("shredder") + 3).join() === "shredder,rabbitHole,shredderLetters" && T.LOOK_KEYS.indexOf("shredder") > T.LOOK_KEYS.indexOf("backMan") && T.DEFAULT_SETTINGS.shredder === false && T.DEFAULT_SETTINGS.rabbitHole === false && T.DEFAULT_SETTINGS.shredderLetters === true);
  const dd = (look) => renderPanel({ popEffects: true, ...look }).find((r) => r.name === "Cursor on delete").dropdowns[0];
  ok("choices of \"Cursor on delete\", on any cursor (the floor one called Portal)", dd({ cursorStyle: "Box", shredder: true })._value === "shredder" && dd({ cursorStyle: "Line", rabbitHole: true })._value === "rabbithole" && dd({ cursorStyle: "Box" })._options.rabbithole === "Portal");
  const on = renderPanel({ popEffects: true, cursorStyle: "Box", shredder: true });
  const sub = on.find((r) => r.name === "Shredded letters");
  ok("Shredded letters: under the choice, shown with Shredder chosen, on any cursor", !!sub && on.findIndex((r) => r.name === "Shredded letters") === on.findIndex((r) => r.name === "Cursor on delete") + 1 && sub.def.visible() && on.cardKeys.Effects.includes("shredderLetters"));
  const other = renderPanel({ popEffects: true, cursorStyle: "Line", rabbitHole: true });
  ok("...hidden with another choice", !other.find((r) => r.name === "Shredded letters").def.visible());
  const rolls = Array.from({ length: 400 }, (_, k) => T.rollLook({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(900 + k)));
  ok("the Randomizer rolls each sometimes, on any cursor, one choice at a time", rolls.some((l) => l.shredder && l.cursorStyle !== "Line") && rolls.some((l) => l.rabbitHole && l.cursorStyle !== "Underline") && rolls.every((l) => ["backMan", "shredder", "rabbitHole"].filter((k) => l[k]).length <= 1 && ["backspaceEvaporate", "backspaceDisintegrate"].filter((k) => l[k]).length <= 1) && rolls.some((l) => l.backMan && l.backspaceDisintegrate));
}

section("Shredder and Vacuum: drawn");
{
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => { calls.push([k, ...a]); }),
    set: (o, k, v) => { o[k] = v; calls.push(["set " + String(k), v]); return true; },
  });
  const plugin = { _markDirty() {}, look: {}, styleFor: () => "Underline", cornerRadius: () => 0 };
  T.EngineProto.drawShredLine.call(plugin, ctx, 100, 0, 2, 24, "#f80", { dash: 1, letters: [] }, 0);
  ok("the Line as blades: six rects in one fill, in the line's paint", calls.filter((c) => c[0] === "rect").length === 6 && calls.filter((c) => c[0] === "fill").length === 1);
  calls.length = 0;
  const l = { char: "a", x: 100, w: 9, top: 0, h: 24, font: "16px x", color: "#ddd", t0: 0 };
  T.EngineProto.drawShreds.call(plugin, ctx, 100, { dash: 1, letters: [l] }, T.SHRED_FEED_MS / 2);
  ok("a letter half through: drawn whole past the cut, and as five sheared ribbons before it", calls.filter((c) => c[0] === "fillText").length === 1 + T.SHRED_RIBBONS && calls.filter((c) => c[0] === "transform").length === T.SHRED_RIBBONS && calls.filter((c) => c[0] === "clip").length === 1 + T.SHRED_RIBBONS);
  // A word taken in one go (a phone's held Backspace deletes word by word):
  // its last letter stood far right of the cut. All it may paint is marked
  // for the next clear - the part not yet through, up to 4 line heights past
  // the cut, and the ribbons fanned before it; one letter's width past the
  // cut left the rest on the page ("letter artifacts ... when the deletion
  // of words began").
  {
    const marks = [];
    const p2 = Object.assign({}, plugin, { _markDirty: (x, y, w, h2) => marks.push({ x, y, w, h: h2 }) });
    const far = { char: "z", x: 100 + 70, w: 9, top: 0, h: 24, font: "16px x", color: "#ddd", t0: 0 };
    T.EngineProto.drawShreds.call(p2, ctx, 100, { dash: 1, letters: [far] }, 10);
    const m = marks[0];
    ok("a word's far letter: everything it may paint marked - the unfed part up to 4 line heights past the cut, the fanned ribbons before it", !!m && m.x <= 100 - 4 * 24 && m.x + m.w >= 100 + 4 * 24 && m.y < -24 && m.y + m.h > 2 * 24, m);
  }
  calls.length = 0;
  const h = { char: "b", cx: 104.5, cy: 10, half: 4.8, w: 9, font: "16px x", color: "#ddd", t0: 0 };
  const hp = Object.assign({}, plugin, { traceRoundedRect: T.EngineProto.traceRoundedRect });
  T.EngineProto.drawHole.call(hp, ctx, 100, 22, 9, 2, "#f80", { letters: [h] }, 0);
  const kinds0 = calls.filter((c) => ["fill", "stroke", "fillText", "clip"].includes(c[0])).map((c) => c[0]).join();
  ok("the Portal: the letter, clipped to above the floor's top edge, then the floor, one fill, its own bar - no dip, no hole, no circle", kinds0 === "clip,fillText,fill" && calls.some((c) => c[0] === "rect" && c[2] + c[4] === 22) && calls.some((c) => c[0] === "rect" && c.slice(1).join() === "100,22,9,2") && !calls.some((c) => ["ellipse", "arc", "quadraticCurveTo"].includes(c[0])) && calls.some((c) => c[0] === "set fillStyle" && c[1] === "#f80"), kinds0);
  ok("...the letter upright and its own size (no turn, no stretch)", !calls.some((c) => c[0] === "rotate" || c[0] === "scale" || c[0] === "translate"));
  calls.length = 0;
  T.EngineProto.drawHole.call(hp, ctx, 100, 22, 9, 2, "#f80", { letters: [h] }, T.HOLE_FALL_MS / 2);
  const kinds = calls.filter((c) => ["fill", "stroke", "fillText", "clip"].includes(c[0])).map((c) => c[0]).join();
  const lit = calls.filter((c) => c[0] === "set fillStyle" && /^rgba\(255, 255, 255, /.test(c[1]));
  const soft = calls.find((c) => c[0] === "set shadowColor" && /^rgba\(255, 136, 0, /.test(c[1]));
  ok("...half through: the floor haloed soft in its own color and lit white over it", kinds === "clip,fillText,fill,fill" && lit.length === 1 && parseFloat(lit[0][1].split(", ")[3]) > 0.2 && !!soft && calls.some((c) => c[0] === "set shadowBlur" && c[1] >= T.HOLE_HALO_MIN), kinds);
  // A word taken at once: its letters to the right of the floor.
  calls.length = 0;
  const word = [0, 1, 2].map((k) => ({ ...h, cx: 104.5 + 9 * k }));
  T.EngineProto.drawHole.call(hp, ctx, 100, 22, 9, 2, "#f80", { letters: word }, T.HOLE_FALL_MS / 2);
  ok("a word: the floor reaching under all of it, from its own left end", calls.some((c) => c[0] === "rect" && c.slice(1).join() === "100,22,27,2"));
  calls.length = 0;
  T.EngineProto.drawHole.call(hp, ctx, 100, 22, 9, 2, "#f80", { letters: word }, T.HOLE_FALL_MS - 1);
  ok("...and drawn back as it is gone", calls.some((c) => c[0] === "rect" && c[1] === 100 && c[3] < 10 && c[3] >= 9));
  // Letters behind the caret: typed over again already.
  calls.length = 0;
  T.EngineProto.drawHole.call(hp, ctx, 100, 22, 9, 2, "#f80", { letters: [{ ...h, cx: 104.5 - 18 }] }, T.HOLE_FALL_MS / 2);
  ok("...but never back under letters behind it (typed over again: a long bar under the new ones)", calls.some((c) => c[0] === "rect" && c.slice(1).join() === "100,22,9,2"));
}
