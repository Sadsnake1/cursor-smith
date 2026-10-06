// The Underline's serifs and the Vacuum's U, and Caps Lock and Shift
// (1.7.7). The Underline's serifs: a tick up at each end of the bar, as a
// Line's serif would be on it (underSerifSize, underSerifQuads); the
// Vacuum's floor stands its ends up into arms as it dips, a U (holeArm,
// holeOutline). Caps Lock and Shift: while Caps Lock is on or Shift held on
// its own, the cursor flips to its opposite color and grows a little from
// its foot, easing in and out (effects-caps.ts).
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, makeEngine, renderPanel, srcPath } = require("../lib");
const fs = require("fs");

section("Underline serifs");
{
  ok("two look keys, appended, off by default", T.LOOK_KEYS.slice(-2).join() === "underlineSerifs,capsLook" && T.DEFAULT_SETTINGS.underlineSerifs === false && T.DEFAULT_SETTINGS.capsLook === false);
  const s = T.underSerifSize(3, 24, 9);
  ok("a tick as thick as a Line's serif on the bar (no thicker than it), as tall as half the letter", s.t === 2 && s.t <= 3 && s.len === 4.5, s);
  ok("...clamped as a Line serif's span is", T.underSerifSize(3, 24, 1).len === 2.5 && T.underSerifSize(3, 8, 40).len === 5);

  const e = makeEngine({ cursorStyle: "Underline", underlineSerifs: true });
  e.smearCorners = () => null;
  const active = { x: 100, top: 40, w: 9, h: 24, actualCharWidth: 9 };
  const q = e.underSerifQuads(active, 100, 9, 61, 3);
  const [l, r] = q.quads;
  ok("two ticks, one at each end of the bar", q.quads.length === 2 && l.tl.x === 100 && l.bl.x === 100 && r.tr.x === 109 && r.br.x === 109);
  ok("...from the bar's foot up past its top by their length - up only", l.bl.y === 64 && r.br.y === 64 && l.tl.y === 61 - 4.5 && r.tr.y === 61 - 4.5 && q.top === 56.5);
  ok("...a tick's thickness wide", l.tr.x - l.tl.x === 2 && r.tr.x - r.tl.x === 2);
  ok("...tapered on the inside at the free end, as a Line serif's bracket", l.tr.y > l.tl.y && r.tl.y > r.tr.y && l.br.y === l.bl.y);

  // A smear: 150 px of bar streaked right; the ticks ride the head.
  const sm = makeEngine({ cursorStyle: "Underline", underlineSerifs: true, smear: true });
  sm._smearDir = { x: 1, y: 0 };
  sm.smearCorners = () => ({ tl: { x: 100, y: 61 }, tr: { x: 250, y: 61 }, br: { x: 250, y: 64 }, bl: { x: 100, y: 64 } });
  const h = sm.underSerifQuads(active, 100, 9, 61, 3);
  ok("smeared right, they ride the head of it, the caret's own width apart (the streak trails behind)", h.quads[1].tr.x === 250 && h.quads[0].tl.x === 241, [h.quads[0].tl.x, h.quads[1].tr.x]);
  sm._smearDir = { x: 0, y: 1 };
  sm.smearCorners = () => ({ tl: { x: 100, y: 21 }, tr: { x: 109, y: 21 }, br: { x: 109, y: 64 }, bl: { x: 100, y: 64 } });
  const v = sm.underSerifQuads(active, 100, 9, 61, 3);
  ok("smeared down, at its foot (the head), not its top", v.quads[0].bl.y === 64 && v.quads[0].tl.y === 56.5, [v.quads[0].tl.y, v.quads[0].bl.y]);

  // Painted: the bar and the ticks in one path, one fill.
  const paint = (over) => {
    const p = makeEngine(Object.assign({ cursorStyle: "Underline", underlineSerifs: true }, over));
    p.smearCorners = () => null;
    p.animActive = active;
    p.underlineThickness = () => 3;
    p.blinkAlpha = () => 1;
    p._glitchNow = () => null;
    p.eaterMoving = () => false;
    p._eaterOn = () => null;
    p.drawEater = () => false;
    const ops = [];
    p.ctx = new Proxy({}, {
      get: (o, k) => k in o ? o[k] : (...a) => { ops.push([k, ...a]); },
      set: (o, k, val) => { o[k] = val; return true; },
    });
    p.drawGenericCaret(true);
    return ops;
  };
  const on = paint({}), off = paint({ underlineSerifs: false });
  const subpaths = (ops) => ops.filter((o) => o[0] === "moveTo").length;
  ok("painted: the bar and both ticks in one path, one fill", subpaths(on) === 3 && on.filter((o) => o[0] === "fill").length === 1 && subpaths(off) === 1, [subpaths(on), subpaths(off)]);
  ok("...rounded with Rounded corners, the ticks on their own thickness", paint({ cursorRounded: true }).filter((o) => o[0] === "arcTo").length === 12);
  ok("...and only on the Underline's: a Line keeps its own", e.underlineSerifs === undefined && /isUnderline \? settings\.underlineSerifs : settings\.lineSerifs/.test(fs.readFileSync(srcPath("paint-shape.ts"), "utf8")));
  const rows = renderPanel({ cursorStyle: "Underline" });
  const row = rows.find((x) => x.name === "Underline serifs");
  ok("a setting under the Underline's, after its thickness", !!row && rows.findIndex((x) => x.name === "Underline serifs") === rows.findIndex((x) => x.name === "Underline thickness") + 1);
}

section("Vacuum: the U");
{
  ok("its arms: the serifs' height at rest, standing up as it dips, not past most of its width, down again springing back", T.holeArm(0, 0, 9) === 0 && T.holeArm(4.5, 0, 9) === 4.5 && T.holeArm(0, 2, 9) === 2 * T.HOLE_ARM_PULL && T.holeArm(0, 50, 9) <= 9 && T.holeArm(4.5, -2, 9) === 4.5);
  const flat = T.holeOutline(9, 3, 0, 0, 2);
  // An outline's points: the ends of its segments and each curve's middle.
  const pts = (cmds) => {
    let cur = [0, 0];
    return cmds.flatMap((c) => {
      if (c[0] === "M" || c[0] === "L") { cur = [c[1], c[2]]; return [cur]; }
      if (c[0] !== "Q") return [];
      const mid = [0.25 * cur[0] + 0.5 * c[1] + 0.25 * c[3], 0.25 * cur[1] + 0.5 * c[2] + 0.25 * c[4]];
      cur = [c[3], c[4]];
      return [mid, cur];
    });
  };
  const fp = pts(flat);
  ok("no arms and no dip: the bar, its ends, its top and its foot", Math.min(...fp.map((p) => p[0])) === 0 && Math.max(...fp.map((p) => p[0])) === 9 && Math.min(...fp.map((p) => p[1])) === 0 && Math.max(...fp.map((p) => p[1])) === 3 && flat[flat.length - 1][0] === "Z");
  const u = pts(T.holeOutline(9, 3, 2.7, 5, 2));
  ok("dipping with arms: a U - both ends standing 5 up, the middle of its foot 2.7 down", u.some((p) => p[0] === 0 && p[1] === -5) && u.some((p) => p[0] === 9 && p[1] === -5) && Math.abs(Math.max(...u.map((p) => p[1])) - 5.7) < 1e-9);
  ok("...its arms' free ends tapered on the inside", u.some((p) => p[0] === 2 && p[1] > -5 && p[1] < 0) && u.some((p) => p[0] === 7 && p[1] > -5 && p[1] < 0));
  const round = T.holeOutline(9, 3, 2.7, 5, 2, 1.5, 1);
  ok("rounded: its corners curves (Rounded corners), the same outline", round.filter((c) => c[0] === "Q").length === T.holeOutline(9, 3, 2.7, 5, 2).filter((c) => c[0] === "Q").length && pts(round).every((p) => p[0] >= 0 && p[0] <= 9));
  const src = fs.readFileSync(srcPath("demo.ts"), "utf8");
  ok("the preview draws the same outline", /holeOutline\(ew, bh, sag, arm/.test(src));
}

section("Caps Lock and Shift");
{
  ok("the keys: Caps Lock on, Shift on its own (with Ctrl, Alt or Cmd a shortcut)", T.capsKeys({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: (k) => k === "CapsLock" }).caps === true &&
     T.capsKeys({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }).shift === true && T.capsKeys({ shiftKey: true, ctrlKey: true, altKey: false, metaKey: false }).shift === false && T.capsKeys({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: true }).shift === false);
  ok("eased: most of the way in 80 ms, all the way after, back out the same", T.capsEase(0, true, 80) > 0.9 && T.capsEase(0, true, 200) === 1 && T.capsEase(1, false, 200) === 0 && T.capsEase(0, true, 10) < 0.5);
  ok("the opposite color, as bright: orange to azure", T.capsColor("#ff8000", 1, "#7f6df2") === "#007fff");
  ok("...halfway between, halfway in", T.capsColor("#ff8000", 0.5, "#7f6df2") === "#808080");
  ok("...a white or gray cursor (no opposite hue) to the accent", T.capsColor("#ffffff", 1, "#7f6df2") === "#7f6df2" && T.capsColor("#333333", 1, "#7f6df2") === "#7f6df2");
  ok("...none of it at 0", T.capsColor("#ff8000", 0, "#000") === "#ff8000");

  const e = makeEngine({ capsLook: true, cursorStyle: "Box", colorDark: "#ff8000" });
  e.lookVimMode = () => null;
  e._capsAccent = () => "#7f6df2";
  e._markActivity = () => {};
  delete e.getActiveColor;
  e._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  ok("Shift held: wanted", e._capsWanted() === true);
  e._caps = { amt: 0, at: performance.now() - 500 };
  ok("...the cursor's color flipped (and so its glow and trail, which read it)", e.getBaseColor() === "#007fff" && e.getActiveColor() === "#007fff", e.getBaseColor());
  e.settings.gradientEnabled = true;
  e.settings.gradientDark1 = "#ff8000";
  ok("...a gradient's every stop", e.gradientStops()[0] === "#007fff", e.gradientStops());
  e.settings.gradientEnabled = false;
  const ops = [];
  const ctx = { translate: (x, y) => ops.push(["t", x, y]), scale: (x, y) => ops.push(["s", x, y]) };
  e._capsGrow(ctx, 50, 80, performance.now());
  ok("...grown from its foot", ops.length === 3 && ops[0][1] === 50 && ops[0][2] === 80 && ops[1][1] === 1 + T.CAPS_GROW && ops[1][2] === 1 + T.CAPS_GROW && ops[2][1] === -50);
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  ok("Shift let go: easing out, the frames kept coming until it is out", e._capsWanted() === false && e.capsMoving(performance.now()) === true);
  e._caps.at = performance.now() - 500;
  ok("...then the cursor as it was", e.getBaseColor() === "#ff8000" && e.capsMoving(performance.now()) === false);
  e._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  e._capsBlur();
  ok("the window losing focus lets go of Shift (its keyup goes elsewhere)", e._shiftHeld === false && e._capsWanted() === false);
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: (k) => k === "CapsLock" });
  ok("Caps Lock on: wanted, as long as it is on", e._capsWanted() === true);
  e.lookVimMode = () => "normal";
  ok("...but not in Vim's normal mode, where Shift runs commands", e._capsWanted() === false);
  // A Vim mode has its own look, which carries the setting.
  e.lookVimMode = () => "insert";
  Object.defineProperty(e, "look", { value: { capsLook: true }, configurable: true });
  ok("...and in insert mode", e._capsWanted() === true);
  Object.defineProperty(e, "look", { value: { capsLook: false }, configurable: true });
  ok("...nor with the setting off", e._capsWanted() === false);

  const src = fs.readFileSync(srcPath("plugin.ts"), "utf8");
  ok("both keydown and keyup read the keys; the window's blur lets go", /this\._capsKey\(e\)/.test(src) && /addEventListener\("keyup", onKeyUp, true\)/.test(src) && /removeEventListener\("keyup", onKeyUp, true\)/.test(src) && /addEventListener\("blur", onWindowBlur\)/.test(src) && /removeEventListener\("blur", onWindowBlur\)/.test(src));
  const shape = fs.readFileSync(srcPath("paint-shape.ts"), "utf8");
  ok("both painters grow the body, and the Box its letter", (shape.match(/this\._capsGrow\(ctx,/g) || []).length === 3);
  const rows = renderPanel({});
  const row = rows.find((x) => x.name === "Caps Lock and Shift");
  ok("a setting in Appearance, after Rounded corners, hidden on a phone", !!row && rows.findIndex((x) => x.name === "Caps Lock and Shift") === rows.findIndex((x) => x.name === "Rounded corners") + 1 && /when: \(\) => !Platform\.isMobile/.test(fs.readFileSync(srcPath("settings-tab.ts"), "utf8")));
  const roll = T.rollLook({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(3));
  ok("the Randomizer keeps it as it is", !("capsLook" in roll));
}
