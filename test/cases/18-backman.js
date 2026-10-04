// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little pixel creature - a body, one eye, a mouth on
// the side it eats from, chomping, leaning into the bite. The sprite
// (backManCells), the spell of bites and its pose, the setting.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine, renderPanel } = require("../lib");

section("Back-man: the creature");
{
  const grid = (cells, eye, C, R) => {
    const g = Array.from({ length: R }, () => Array(C).fill("."));
    for (const [c, r] of cells) g[r][c] = "#";
    g[eye[1]][eye[0]] = "o";
    return g.map((row) => row.join(""));
  };
  const C = 4, R = 10;
  const open = T.backManCells(C, R, 1, 1), shut = T.backManCells(C, R, 0, 1), left = T.backManCells(C, R, 1, -1);
  const og = grid(open.body, open.eye, C, R), sg = grid(shut.body, shut.eye, C, R), lg = grid(left.body, left.eye, C, R);
  ok("open, facing right: a wedge cut from the right side, deepest in the middle", og.some((row) => row.endsWith("..")) && og.every((row) => row[0] !== "." || [0, R - 1].includes(og.indexOf(row))), og);
  ok("...shut: a one-pixel mouth, the rest whole", sg.filter((row) => /\.$/.test(row)).length === 3 && sg.filter((row, r) => r > 0 && r < R - 1 && row.endsWith(".")).length === 1, sg);
  ok("...the corners off (a rounded block), no tail", og[0][0] === "." && og[0][C - 1] === "." && og[R - 1][0] === "." && og[R - 1][C - 1] === ".");
  ok("an eye up near the front, in the head", open.eye[0] === C - 2 && open.eye[1] < R / 2 && og[open.eye[1]][open.eye[0]] === "o");
  ok("facing left (Backspace): the same creature mirrored, the mouth and the eye on the left", lg.every((row, r) => row === og[r].split("").reverse().join("")) && left.eye[0] === 1, lg);
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
    ok("...half a chomp on: wide open", p.open > 0.99, p.open);
    now += 100; e._backManBite(-1);
    now += T.BACKMAN_CHOMP_MS / 2;
    ok("a held Backspace keeps one spell: the chomp runs on from its first bite", Math.abs(e.backManPose(now).open - Math.abs(Math.sin(Math.PI * (now - 1000) / T.BACKMAN_CHOMP_MS))) < 1e-9);
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
