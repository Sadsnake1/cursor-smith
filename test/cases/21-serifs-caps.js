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
  ok("look keys, appended: the serifs and Caps Lock and Shift off, its parts on", T.LOOK_KEYS.slice(T.LOOK_KEYS.indexOf("underlineSerifs"), T.LOOK_KEYS.indexOf("underlineSerifs") + 6).join() === "underlineSerifs,capsLook,capsLookCapsLock,capsLookShift,capsLookInvert,capsLookGrow" && T.LOOK_KEYS.indexOf("underlineSerifs") > T.LOOK_KEYS.indexOf("shredderLetters") && T.DEFAULT_SETTINGS.underlineSerifs === false && T.DEFAULT_SETTINGS.capsLook === false &&
     ["capsLookCapsLock", "capsLookShift", "capsLookInvert", "capsLookGrow"].every((k) => T.DEFAULT_SETTINGS[k] === true));
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
  e.settings.capsLookShift = false;
  ok("...not with Shift off in its parts", e._capsWanted() === false);
  e.settings.capsLookShift = true;
  // Half a second on: the key pressed then, the look out until then.
  e._capsChangeT = performance.now() - 500;
  e._caps = { amt: 0, at: e._capsChangeT, on: false };
  e._flip = { amt: 0, at: e._capsChangeT, on: false };
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
  e._capsGrow(ctx, 40, 56, 20, 24, performance.now());
  ok("...a Box grown from its foot, the same both ways", ops.length === 3 && ops[0][1] === 50 && ops[0][2] === 80 && ops[1][1] === 1 + T.CAPS_GROW && ops[1][2] === 1 + T.CAPS_GROW && ops[2][1] === -50);
  ops.length = 0;
  e._capsGrow(ctx, 49, 40, 2, 24, performance.now(), true);
  ok("...a Line thicker and only a little taller, from its middle (not up into the line above)", ops.length === 3 && ops[0][1] === 50 && ops[0][2] === 52 && ops[1][1] > 1.4 && ops[1][2] < 1.1 && ops[1][2] > 1, ops);
  ops.length = 0;
  e.settings.capsLookGrow = false;
  e._capsGrow(ctx, 40, 56, 20, 24, performance.now());
  ok("Grow off: not grown", ops.length === 0);
  e.settings.capsLookGrow = true;
  e.settings.capsLookInvert = false;
  e._capsChangeT = e._flip.at = performance.now() - 500;
  e._capsCanvas(performance.now());
  ok("Invert colors off: eased out, the canvas unturned, a white cursor white", e.canvas.style.filter === "" && e.getBaseColor() === "#ffffff");
  e.settings.capsLookInvert = true;
  e._capsCanvas(performance.now());
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  ok("Shift let go: easing out, the frames kept coming until it is out", e._capsWanted() === false && e.capsMoving(performance.now()) === true);
  e._capsChangeT = e._caps.at = e._flip.at = performance.now() - 500;
  e._capsCanvas(performance.now());
  ok("...then the cursor as it was, the canvas unturned, the frames let go", e.getBaseColor() === "#ffffff" && e.capsMoving(performance.now()) === false && e.canvas.style.filter === "");
  e.settings.capsLookGrow = false;
  e._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  e._capsChangeT = performance.now() - 500;
  e._caps.at = e._flip.at = performance.now() - 500;
  e._capsCanvas(performance.now());
  ok("...with Grow off too: both settle, the loop is not held awake", e.capsMoving(performance.now()) === false);
  e.settings.capsLookGrow = true;
  e._capsKey({ shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, getModifierState: () => false });
  e._capsBlur();
  ok("the window losing focus lets go of Shift (its keyup goes elsewhere)", e._shiftHeld === false && e._capsWanted() === false);
  e._capsKey({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, getModifierState: (k) => k === "CapsLock" });
  ok("Caps Lock on: wanted, as long as it is on", e._capsWanted() === true);
  e.settings.capsLookCapsLock = false;
  ok("...not with Caps Lock off in its parts", e._capsWanted() === false);
  e.settings.capsLookCapsLock = true;
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
  ok("a setting in Appearance, after Rounded corners, hidden on a phone", !!row && rows.findIndex((x) => x.name === "Caps Lock and Shift") === rows.findIndex((x) => x.name === "Rounded corners") + 1 && /const desktop = \(\) => !Platform\.isMobile/.test(fs.readFileSync(srcPath("settings-tab.ts"), "utf8")));
  const subs = renderPanel({ capsLook: true });
  const at = subs.findIndex((x) => x.name === "Caps Lock and Shift");
  ok("its parts under it, shown with it on: Caps Lock, Shift, Invert colors, Grow", subs.slice(at + 1, at + 5).map((x) => x.name).join() === "Caps Lock,Shift,Invert colors,Grow" && subs.slice(at + 1, at + 5).every((x) => x.def.visible()));
  const offRows = renderPanel({ capsLook: false });
  const sub = offRows.find((x) => x.name === "Invert colors");
  ok("...hidden with it off", !sub || !sub.def.visible());
  const roll = T.rollLook({ chaos: 100, color: 50, motion: 50 }, T.seededRandom(3));
  ok("the Randomizer keeps it as it is", !("capsLook" in roll));
}

section("Backspace and Delete: the colors inverted while deleting");
{
  ok("a look key, appended, off by default", T.LOOK_KEYS.indexOf("deleteInvert") > T.LOOK_KEYS.indexOf("capsLookGrow") && T.DEFAULT_SETTINGS.deleteInvert === false);
  const rows = renderPanel({});
  const at = rows.findIndex((x) => x.name === "Backspace and Delete");
  ok("a setting in Appearance, after Caps Lock and Shift's parts, on any device", at > rows.findIndex((x) => x.name === "Caps Lock and Shift") && (!rows[at].def.visible || rows[at].def.visible()) && !rows.some((x) => x.name === "Invert colors" && x.cardKeys && x.cardKeys.Effects && x.cardKeys.Effects.includes("eaterInvert")));

  const e = makeEngine({ deleteInvert: true, colorDark: "#ffffff" });
  e.canvas = { style: {} };
  e._markActivity = () => {};
  e._capsAccent = () => "#7f6df2";
  delete e.getActiveColor;
  const t0 = performance.now();
  e._flip = { amt: 0, at: t0 - 10000, on: false };
  e._deleteFlip();
  ok("a Backspace: the flip wanted, the governor sees it, a static frame is not the same frame", e._flipWanted(e._deleteT) && e.capsMoving(e._deleteT) && e._capsSig() !== "c0f0");
  const a = e.flipAmount(e._deleteT + 16);
  ok("...eased in from the key", a > 0.2 && a < 0.8, a);
  e.flipAmount(e._deleteT + 200);
  e._capsCanvas(e._deleteT + 200);
  ok("...the whole canvas's hue turned (the cursor and every effect, any cursor, no eater needed)", e.canvas.style.filter === "hue-rotate(180deg)", e.canvas.style.filter);
  ok("...a white cursor painted so it shows as the accent", e._capsFlip("#ffffff") === T.hueTurn("#7f6df2", 180));
  ok("...wanted for a moment after the key, then not", e._flipWanted(e._deleteT + T.DELETE_INVERT_MS - 1) && !e._flipWanted(e._deleteT + T.DELETE_INVERT_MS + 1));
  e._eat = { kind: "backman", t0: e._deleteT, exit: 0 };
  ok("...but for as long as an eater has the cursor", e._flipWanted(e._deleteT + 2000));
  e._eat.exit = e._deleteT + 2000;
  ok("...and not once it lets go", !e._flipWanted(e._deleteT + 2001));
  e._eat = null;
  e.flipAmount(e._deleteT + 2000);
  e._capsCanvas(e._deleteT + 2000);
  ok("...then the canvas unturned", e.canvas.style.filter === "", e.canvas.style.filter);
  e.settings.deleteInvert = false;
  e._deleteT = -1e9;
  e._deleteFlip();
  ok("off: a delete flips nothing (its moment kept, for the effects' When)", !e._flipWanted(performance.now()) && e._deleteT > 0 && e._deleting(performance.now()));
  const src = fs.readFileSync(srcPath("plugin.ts"), "utf8");
  ok("both the Backspace and Delete keys and the input events where keys are not reported flip it", (src.match(/this\._deleteFlip\(\);/g) || []).length === 2);
  ok("the eaters keep no flip of their own (the canvas's covers them)", !/ctx\.filter/.test(fs.readFileSync(srcPath("effects-eaters.ts"), "utf8")) && !T.LOOK_KEYS.includes("eaterInvert"));
  ok("the preview flips on its deletes", /d\.delUntil = now \+ DELETE_INVERT_MS/.test(fs.readFileSync(srcPath("demo.ts"), "utf8")));
}

section("When: typing, deleting or both (Hot-head, Pixel trail, Signal glitch)");
{
  ok("look keys, appended; as before by default (Hot-head and Pixel trail both, the glitch on jumps)", T.LOOK_KEYS.slice(T.LOOK_KEYS.indexOf("hotHeadWhen"), T.LOOK_KEYS.indexOf("hotHeadWhen") + 3).join() === "hotHeadWhen,flameTrailWhen,crtGlitchWhen" && T.LOOK_KEYS.indexOf("hotHeadWhen") > T.LOOK_KEYS.indexOf("deleteInvert") &&
     T.DEFAULT_SETTINGS.hotHeadWhen === "both" && T.DEFAULT_SETTINGS.flameTrailWhen === "both" && T.DEFAULT_SETTINGS.crtGlitchWhen === "jumps");
  ok("what each choice allows", T.whenAllows("both", true) && T.whenAllows("both", false) && T.whenAllows(undefined, true) && T.whenAllows("typing", false) && !T.whenAllows("typing", true) &&
     T.whenAllows("deleting", true) && !T.whenAllows("deleting", false) && T.whenAllows("jumps", false) && !T.whenAllows("jumps", true));
  const rows = renderPanel({ hotHead: true, flameTrail: true, crtEffect: true, crtGlitch: true });
  const under = (name, parent) => { const i = rows.findIndex((x) => x.name === name); return i > rows.findIndex((x) => x.name === parent) && (!rows[i].def.visible || rows[i].def.visible()); };
  ok("a dropdown under each: Burns while (Hot-head), Trails while (Pixel trail), Glitches on (Signal glitch)", under("Burns while", "Hot-head") && under("Trails while", "Pixel trail") && under("Glitches on", "Signal glitch"));

  // Hot-head: marks laid only when its When allows.
  const hh = (when, deleting) => {
    const e = makeEngine({ hotHead: true, hotHeadWhen: when });
    e.hotSyncScroll = () => {};
    const at = (x) => ({ x, top: 40, w: 9, h: 24, actualCharWidth: 9, rowLeft: 0, rowRight: 500, fontSize: 16 });
    e._deleteT = deleting ? performance.now() : -1e9;
    e.animActive = e.lastActive = at(100);
    e.updateHotHeadInertia();
    e.animActive = e.lastActive = at(91);
    e.updateHotHeadInertia();
    return (e.hotBurns || []).length;
  };
  ok("Hot-head burning while deleting: marks laid as the caret goes back over what it deletes, none as it types", hh("deleting", true) > 0 && hh("deleting", false) === 0);
  ok("...burning while typing: the other way round; both: either", hh("typing", false) > 0 && hh("typing", true) === 0 && hh("both", true) > 0 && hh("both", false) > 0);
  const lit = makeEngine({ hotHead: true, hotHeadWhen: "deleting" });
  ok("...and the loop not held hot for it with nothing alight", lit._hotLit([]) === false && lit._hotLit([{}]) === true && makeEngine({ hotHead: true })._hotLit([]) === true);

  // Signal glitch: a deletion's short move breaks it up, gently.
  const g = makeEngine({ crtEffect: true, crtGlitch: true });
  const from = { x: 100, top: 40, w: 9, h: 24 }, to = { x: 91, top: 40, w: 9, h: 24 };
  g.spawnGlitch(from, to);
  ok("Signal glitch: a short move is no jump", !g.glitch);
  g.spawnGlitch(from, to, true);
  ok("...but a deletion's glitches it, gently", !!g.glitch && g.glitch.reach === 0.8);
  const src = fs.readFileSync(srcPath("carets.ts"), "utf8");
  ok("the committed move: the trail's puff and its jump trail by Trails while, the glitch by Glitches on, Hot-head's flare by Burns while",
     /\(disintegrate \|\| trailOk\)/.test(src) && /flameTrailOnJump && !disintegrate && trailOk/.test(src) && /gw !== "deleting"/.test(src) && /gw !== "jumps" && deleted/.test(src) && /whenAllows\(this\.look\.hotHeadWhen, deleted\)/.test(src));
}

section("The torch flips with the rest");
{
  const e = makeEngine({ deleteInvert: true });
  e.canvas = { style: {} };
  e.overlay = { style: { filter: "" } };
  e.glowEl = { style: { filter: "" } };
  e._markActivity = () => {};
  e._flip = { amt: 0, at: performance.now() - 10000, on: false };
  e._deleteFlip();
  e.flipAmount(e._deleteT + 200);
  e._capsCanvas(e._deleteT + 200);
  ok("the torch's darkness and glow turned with the cursor's canvas", e.canvas.style.filter === "hue-rotate(180deg)" && e.overlay.style.filter === "hue-rotate(180deg)" && e.glowEl.style.filter === "hue-rotate(180deg)");
  e.glowEl = { style: { filter: "" } };
  e._capsCanvas(e._deleteT + 210);
  ok("...a glow layer rebuilt meanwhile catches up on the next frame", e.glowEl.style.filter === "hue-rotate(180deg)");
}

section("When: the CRT ghosts and Speed demon");
{
  ok("look keys, appended; as before by default", T.LOOK_KEYS.indexOf("crtTrailWhen") > T.LOOK_KEYS.indexOf("eaterSmear") && T.LOOK_KEYS.indexOf("speedDemonWhen") === T.LOOK_KEYS.indexOf("crtTrailWhen") + 1 &&
     T.DEFAULT_SETTINGS.crtTrailWhen === "both" && T.DEFAULT_SETTINGS.speedDemonWhen === "both");
  const rows = renderPanel({ crtEffect: true, speedDemon: true });
  const under = (name, parent) => { const i = rows.findIndex((x) => x.name === name); return i > rows.findIndex((x) => x.name === parent) && (!rows[i].def.visible || rows[i].def.visible()); };
  ok("a dropdown under each: Ghosts while (CRT effects), Heats while (Speed demon)", under("Ghosts while", "CRT effects") && under("Heats while", "Speed demon"));
  const carets = fs.readFileSync(srcPath("carets.ts"), "utf8"), plugin = fs.readFileSync(srcPath("plugin.ts"), "utf8");
  ok("the ghosts recorded by Ghosts while; a keystroke's heat by Heats while, a move's not while deleting alone",
     carets.includes("if (whenAllows(this.look.crtTrailWhen, deletingMove)) this.pushTrail(this.lastActive, deletingMove ? null : caret);") &&
     /if \(!whenAllows\(this\.look\.speedDemonWhen, kind === "delete"\)\) return;/.test(plugin) && /this\.look\.speedDemonWhen !== "deleting"/.test(carets));
}
