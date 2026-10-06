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
  ok("a tick as thick as a Line's serif on the bar (no thicker than it), small: a third of the letter", s.t === 2 && s.t <= 3 && Math.abs(s.len - 2.7) < 1e-9, s);
  ok("...never under 1.5 px, nor over an eighth of the line", T.underSerifSize(3, 24, 1).len === 1.5 && Math.abs(T.underSerifSize(3, 16, 40).len - 1.92) < 1e-9);

  const e = makeEngine({ cursorStyle: "Underline", underlineSerifs: true });
  e.smearCorners = () => null;
  const active = { x: 100, top: 40, w: 9, h: 24, actualCharWidth: 9 };
  const q = e.underSerifQuads(active, 100, 9, 61, 3);
  const [l, r] = q.quads;
  ok("two ticks, one at each end of the bar", q.quads.length === 2 && l.tl.x === 100 && l.bl.x === 100 && r.tr.x === 109 && r.br.x === 109);
  ok("...from the bar's foot up past its top by their length - up only", l.bl.y === 64 && r.br.y === 64 && Math.abs(l.tl.y - 58.3) < 1e-9 && Math.abs(r.tr.y - 58.3) < 1e-9 && Math.abs(q.top - 58.3) < 1e-9);
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
  ok("smeared down, at its foot (the head), not its top", v.quads[0].bl.y === 64 && Math.abs(v.quads[0].tl.y - 58.3) < 1e-9, [v.quads[0].tl.y, v.quads[0].bl.y]);

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

section("Vacuum: no serifs");
{
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
  const fp = pts(T.holeOutline(9, 3, 0));
  ok("no dip: the bar, its ends, its top and its foot", Math.min(...fp.map((p) => p[0])) === 0 && Math.max(...fp.map((p) => p[0])) === 9 && Math.min(...fp.map((p) => p[1])) === 0 && Math.max(...fp.map((p) => p[1])) === 3);
  const u = pts(T.holeOutline(9, 3, 2.7));
  ok("dipping: its ends where they were, nothing above them (no arms), the middle of its foot 2.7 down", Math.min(...u.map((p) => p[0])) === 0 && Math.max(...u.map((p) => p[0])) === 9 && Math.min(...u.map((p) => p[1])) >= 0 && Math.abs(Math.max(...u.map((p) => p[1])) - 5.7) < 1e-9);
  const round = T.holeOutline(9, 3, 2.7, 1.5);
  ok("rounded: its corners curves (Rounded corners), inside the bar's ends", pts(round).every((p) => p[0] >= 0 && p[0] <= 9) && round[0][2] === 1.5);
  const src = fs.readFileSync(srcPath("demo.ts"), "utf8");
  ok("the preview draws the same outline", /holeOutline\(ew, bh, sag, d\.shape\.radius\)/.test(src));
}

section("Caps Lock and Shift");
{
  {
    // Shift tapped after ten seconds idle: the last frame drawn long ago.
    const t = makeEngine({ capsLook: true, cursorStyle: "Line" });
    t.lookVimMode = () => null;
    t._markActivity = () => {};
    const t0 = performance.now();
    t._caps = { amt: 0, at: t0 - 10000, on: false };
    const before = t._capsSig();
    t._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
    ok("Shift tapped after a while idle: the governor sees it moving, and a static frame is not the same frame", t.capsMoving(t0) === true && t._capsSig() !== before);
    const a = t.capsAmount(t._capsChangeT + 16);
    ok("...the ease starts at the key, not at the last frame drawn (no jump to the end)", a > 0.2 && a < 0.8, a);
    t._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
    const b = t.capsAmount(t._capsChangeT + 16);
    ok("...and let go, eases back out from there: it can be tapped again and again", b < a && b > 0 && t.capsMoving(t._capsChangeT + 16) === true, b);
  }
  ok("the keys: Caps Lock on, Shift on its own (with Ctrl, Alt or Cmd a shortcut)", T.capsKeys({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: (k) => k === "CapsLock" }).caps === true &&
     T.capsKeys({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }).shift === true && T.capsKeys({ shiftKey: true, ctrlKey: true, altKey: false, metaKey: false }).shift === false && T.capsKeys({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: true }).shift === false);
  ok("eased: most of the way in 80 ms, all the way after, back out the same", T.capsEase(0, true, 80) > 0.9 && T.capsEase(0, true, 200) === 1 && T.capsEase(1, false, 200) === 0 && T.capsEase(0, true, 10) < 0.5);
  ok("a hue turn as CSS's: half the wheel takes orange to blue, and back", T.hueTurn("#ff8000", 180) !== "#ff8000" && /^#[0-4][0-9a-f][4-9a-f][0-9a-f]ff$/.test(T.hueTurn("#ff8000", 180)) && T.hueTurn(T.hueTurn("#7f6df2", 180), 180) === "#7f6df2", T.hueTurn("#ff8000", 180));
  ok("a colorful cursor painted as it is (the canvas's turn flips it, and every effect with it)", T.capsColor("#ff8000", 1, "#7f6df2") === "#ff8000");
  ok("...a white or gray one painted as the accent's half-turn, which the canvas's turn brings back to the accent", T.capsColor("#ffffff", 1, "#7f6df2") === T.hueTurn("#7f6df2", 180) && T.capsColor("#333333", 1, "#7f6df2") === T.hueTurn("#7f6df2", 180));
  ok("...none of it at 0", T.capsColor("#ffffff", 0, "#7f6df2") === "#ffffff");

  const e = makeEngine({ capsLook: true, cursorStyle: "Box", colorDark: "#ffffff" });
  e.canvas = { style: {} };
  e.lookVimMode = () => null;
  e._capsAccent = () => "#7f6df2";
  e._markActivity = () => {};
  delete e.getActiveColor;
  e._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  ok("Shift held: wanted", e._capsWanted() === true);
  // Half a second on: the key pressed then, the look out until then.
  e._capsChangeT = performance.now() - 500;
  e._caps = { amt: 0, at: e._capsChangeT, on: false };
  e._capsCanvas(performance.now());
  ok("...the whole canvas's hue turned half the wheel: the cursor and every effect on it flip", e.canvas.style.filter === "hue-rotate(180deg)", e.canvas.style.filter);
  ok("...a white cursor painted so it shows as the accent (and its glow and trail, which read it)", e.getBaseColor() === T.hueTurn("#7f6df2", 180) && e.getActiveColor() === e.getBaseColor(), e.getBaseColor());
  e.settings.gradientEnabled = true;
  e.settings.gradientDark1 = "#ffffff";
  e.settings.gradientDark2 = "#ff8000";
  ok("...a gradient's white stops the same, its colorful ones left to the turn", e.gradientStops()[0] === T.hueTurn("#7f6df2", 180) && e.gradientStops()[1] === "#ff8000", e.gradientStops());
  e.settings.gradientEnabled = false;
  const ops = [];
  const ctx = { translate: (x, y) => ops.push(["t", x, y]), scale: (x, y) => ops.push(["s", x, y]) };
  e._capsGrow(ctx, 50, 80, performance.now());
  ok("...grown from its foot", ops.length === 3 && ops[0][1] === 50 && ops[0][2] === 80 && ops[1][1] === 1 + T.CAPS_GROW && ops[1][2] === 1 + T.CAPS_GROW && ops[2][1] === -50);
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  ok("Shift let go: easing out, the frames kept coming until it is out", e._capsWanted() === false && e.capsMoving(performance.now()) === true);
  e._capsChangeT = e._caps.at = performance.now() - 500;
  e._capsCanvas(performance.now());
  ok("...then the cursor as it was, the canvas unturned", e.getBaseColor() === "#ffffff" && e.capsMoving(performance.now()) === false && e.canvas.style.filter === "");
  e._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  e._capsBlur();
  ok("the window losing focus lets go of Shift (its keyup goes elsewhere)", e._shiftHeld === false && e._capsWanted() === false);
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: (k) => k === "CapsLock" });
  ok("Caps Lock on: wanted, as long as it is on", e._capsWanted() === true);
  // A Vim mode has its own look, which carries the setting.
  e.lookVimMode = () => "normal";
  Object.defineProperty(e, "look", { value: { capsLook: true }, configurable: true });
  ok("...in every Vim mode: in Normal mode it is the warning you want", e._capsWanted() === true);
  e._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  ok("Shift alone in Vim's Normal mode: no (it runs commands there)", e._capsWanted() === false);
  e.lookVimMode = () => "insert";
  ok("...in insert mode, yes", e._capsWanted() === true);
  Object.defineProperty(e, "look", { value: { capsLook: false }, configurable: true });
  ok("...nor with the setting off", e._capsWanted() === false);
  delete e.look;
  e.lookVimMode = () => null;
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  e._capsPointer({ getModifierState: (k) => k === "CapsLock", shiftKey: true });
  ok("the mouse reads Caps Lock (changed in another app), not Shift (a Shift-click selects)", e._capsOn === true && e._shiftHeld === false);
  e._capsPointer({ getModifierState: () => false, shiftKey: false });
  ok("...and sees it go off", e._capsOn === false);

  const src = fs.readFileSync(srcPath("plugin.ts"), "utf8");
  ok("the mouse moving or pressed reads Caps Lock", /onMouseMove = \(e: MouseEvent\) => \{\s*this\._capsPointer\(e\)/.test(src) && /if \(e instanceof MouseEvent\) this\._capsPointer\(e\)/.test(src));
  ok("the canvas turned every frame it is drawn (written only on change)", /this\._capsCanvas\(performance\.now\(\)\)/.test(fs.readFileSync(srcPath("paint-frame.ts"), "utf8")));
  ok("both keydown and keyup read the keys; the window's blur lets go", /this\._capsKey\(e\)/.test(src) && /addEventListener\("keyup", onKeyUp, true\)/.test(src) && /removeEventListener\("keyup", onKeyUp, true\)/.test(src) && /addEventListener\("blur", onWindowBlur\)/.test(src) && /removeEventListener\("blur", onWindowBlur\)/.test(src));
  const shape = fs.readFileSync(srcPath("paint-shape.ts"), "utf8");
  ok("both painters grow the body, and the Box its letter", (shape.match(/this\._capsGrow\(ctx,/g) || []).length === 3);
  const rows = renderPanel({});
  const row = rows.find((x) => x.name === "Caps Lock and Shift");
  ok("a setting in Appearance, after Rounded corners, hidden on a phone", !!row && rows.findIndex((x) => x.name === "Caps Lock and Shift") === rows.findIndex((x) => x.name === "Rounded corners") + 1 && /when: \(\) => !Platform\.isMobile/.test(fs.readFileSync(srcPath("settings-tab.ts"), "utf8")));
  const roll = T.rollLook({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(3));
  ok("the Randomizer keeps it as it is", !("capsLook" in roll));
}
