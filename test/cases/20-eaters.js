// "When you delete" (1.7.7): one choice - Nothing, Burst, Evaporate,
// Back-man, Shredder, Rabbit hole - kept in the five switches it replaced
// (deleteEffectOf), and the eaters on any cursor: the cursor morphs from
// its own shape into its eater's and back (effects-eaters.ts).
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine } = require("../lib");

section("When you delete: one choice, in the switches it replaced");
{
  ok("nothing on: Nothing", T.deleteEffectOf({}) === "none");
  ok("each switch its choice", T.DELETE_EFFECTS.every(([effect, key]) => T.deleteEffectOf({ [key]: true }) === effect));
  ok("a look saved with several on is the first of them: an eater before Evaporate before Burst",
     T.deleteEffectOf({ backspaceDisintegrate: true, backspaceEvaporate: true }) === "evaporate" && T.deleteEffectOf({ backspaceDisintegrate: true, rabbitHole: true }) === "rabbithole" && T.deleteEffectOf({ shredder: true, backMan: true }) === "backman");
  ok("the eaters, and the rest not", T.eaterOf("backman") === "backman" && T.eaterOf("shredder") === "shredder" && T.eaterOf("rabbithole") === "rabbithole" && T.eaterOf("burst") === null && T.eaterOf("none") === null);
}

section("The eaters' shapes and the morph");
{
  // A caret at the gap x 100 on a row 24 high at y 10, a letter 9 wide, a
  // Line 2 thick spanning the row, an Underline 2 thick.
  const form = (k) => T.eaterForm(k, 100, 10, 24, 9, 2, 10, 24, 2);
  const box = form("backman"), line = form("shredder"), floor = form("rabbithole");
  ok("Back-man: the letter's box", box.x === 100 && box.y === 10 && box.w === 9 && box.h === 24);
  ok("Shredder: the line, centered on the gap", line.x === 99 && line.w === 2 && line.y === 10 && line.h === 24);
  ok("Rabbit hole: the floor, at the row's foot", floor.x === 100 && floor.w === 9 && floor.y === 32 && floor.h === 2);
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
    box.drawShredLine = (ctx, x, y, w, h) => blades.push({ x, w });
    box.drawShreds = () => {};
    now += 100;
    box.drawEater({}, { x: 100, y: 10, w: 9, h: 24 }, 100, "#f80", 0, 0, now);
    now += T.EATER_IN_MS;
    box.drawEater({}, { x: 100, y: 10, w: 9, h: 24 }, 100, "#f80", 0, 0, now);
    ok("a Box with Shredder: squeezed from its own width into the line's", blades[0].w === 9 && blades[1].w === 2 && blades[1].x === 99, blades);

    const off = mk("Box", { backspaceEvaporate: true });
    ok("Evaporate chosen: no eater, the cursor its own", !off.drawEater({}, { x: 100, y: 10, w: 9, h: 24 }, 100, "#f80", 0, 0, now) && off._eaterOn() === null);
    const nopop = mk("Box", { popEffects: false, backMan: true });
    ok("...nor with Pop effects off", nopop._eaterOn() === null);
  } finally {
    performance.now = realNow;
  }
}
