// The Randomizer (1.7.7): a whole cursor rolled at once from three dials
// (Chaos, Color, Motion) - the sound never touched - the roll itself
// (randomize.ts, rolled with a seed here), what applying one does and
// takes back (library.ts), and its page.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, Plugin, ok, section, later, renderPanel } = require("../lib");
const { renderWholePanel } = require("../panel_harness");

const roll = (o, seed) => T.rollLook(Object.assign({ chaos: 35, color: 60, motion: 50 }, o), T.seededRandom(seed));
const many = (o, n = 300) => Array.from({ length: n }, (_, i) => roll(o, 1000 + i));
const share = (looks, f) => looks.filter(f).length / looks.length;
const effectsOn = (l) => T.ROLL_EFFECTS.filter((k) => l[k]).length;

// Every slider's range, as the panel has them: a roll is one the panel
// could have made.
const RANGES = {
  caretWidthPx: [0.5, 7], boxHollowWidth: [0.5, 6], blinkSpeed: [0.1, 3], blinkFade: [0.05, 0.5], catchUpSpeed: [0.3, 0.8],
  thunderstrikeSize: [1, 5], thunderstrikeStrength: [0.1, 1], fireworksQuantity: [0.2, 3],
  typewriterDepth: [5, 40], typewriterBounce: [0, 2], typewriterSquash: [0, 40], typewriterStrikeMs: [120, 600], typewriterInkSize: [1, 2],
  typewriterSoundVolume: [0, 100], flameTrailDensity: [0, 3], flameTrailLifeMs: [100, 2000], flameTrailPixelSize: [1, 12], flameTrailGravity: [0, 1],
  stardustDelayMs: [500, 8000], stardustRate: [0.2, 3], stardustOrbitRadius: [10, 60], bracketTetherStrength: [0.1, 1],
  smearStiffness: [0.1, 1], smearTrailingStiffness: [0.05, 1], energySpeed: [0.2, 3], energyAuroraWaviness: [0, 2],
  trailLength: [0, 30], trailFadeMs: [50, 1500], crtGlitchStrength: [0.2, 2.5], crtGlitchAberration: [0, 3],
  speedDemonSparkQuantity: [0, 3], speedDemonSparkTrail: [0, 30], speedDemonSensitivity: [0.5, 2],
  hotHeadQuantity: [0, 3], hotHeadSpread: [0, 14], hotHeadTrail: [0, 30], hotHeadHeight: [0.15, 1.5],
};

section("Randomizer: the roll");
{
  const a = roll({}, 7), b = roll({}, 7), c = roll({}, 8);
  ok("a seed rolls the same cursor; another seed another", JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c));
  const all = [...many({ chaos: 0 }), ...many({ chaos: 50, color: 30, motion: 80 }), ...many({ chaos: 100, color: 100, motion: 100, sounds: true }, 50)];
  ok("only look keys, every one but the torch's settings", all.every((l) => Object.keys(l).every((k) => T.LOOK_KEYS.includes(k)) && !("overlayRadius" in l) && !("overlayColor" in l)) &&
     T.LOOK_KEYS.filter((k) => !k.startsWith("overlay") && !k.startsWith("typewriterSound") && k !== "capsLook").every((k) => k in a));
  ok("Caps Lock and Shift kept as it is (a signal, not a look to roll)", all.every((l) => !("capsLook" in l)));
  ok("the torch never lit (it darkens the window, not the cursor)", all.every((l) => l.torchEffect === false));
  const bad = [];
  for (const l of all) for (const [k, [lo, hi]] of Object.entries(RANGES)) if (typeof l[k] === "number" && (l[k] < lo - 1e-9 || l[k] > hi + 1e-9)) bad.push([k, l[k]]);
  ok("every value in its slider's range", bad.length === 0, bad.slice(0, 5));
  ok("colors are colors: #rrggbb, for both themes", all.every((l) => ["colorDark", "colorLight", "gradientDark1", "gradientDark4", "gradientLight1", "gradientLight4"].every((k) => /^#[0-9a-f]{6}$/.test(l[k]))));
  ok("a style of the three", all.every((l) => ["Box", "Line", "Underline"].includes(l.cursorStyle)) && ["Box", "Line", "Underline"].every((s) => all.some((l) => l.cursorStyle === s)));
  const light = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  ok("dark themes get light colors, light themes deep ones", all.every((l) => light(l.colorDark) > light(l.colorLight)));
}

section("Randomizer: the dials");
{
  const calm = many({ chaos: 0 }), mid = many({ chaos: 50 }), wild = many({ chaos: 90 });
  const mean = (ls) => ls.reduce((n, l) => n + effectsOn(l), 0) / ls.length;
  ok("Chaos 0: one effect", calm.every((l) => effectsOn(l) === 1), mean(calm));
  ok("...more as it rises", mean(calm) < mean(mid) && mean(mid) < mean(wild), [mean(calm), mean(mid), mean(wild)]);
  const chaos = many({ chaos: 100, color: 100, motion: 100 }, 20);
  ok("Chaos 100: every effect, all at once, with their extras", chaos.every((l) => effectsOn(l) === T.ROLL_EFFECTS.length && l.fireworks && l.thunderstrike && ["backMan", "shredder", "rabbitHole", "backspaceEvaporate", "backspaceDisintegrate"].some((k) => l[k]) && l.crtNeon && l.crtGlitch && l.glow && l.smoothEnabled && l.smear));
  const fireworks = (ls) => ls.filter((l) => l.popEffects).reduce((n, l) => n + l.fireworksQuantity, 0) / Math.max(1, ls.filter((l) => l.popEffects).length);
  ok("...and stronger: the higher, the more fireworks per key", fireworks(calm) < fireworks(wild), [fireworks(calm), fireworks(wild)]);
  const grey = many({ color: 0 }), rainbow = many({ color: 100 });
  ok("Color 0: mostly one color; 100: gradients, most of four", share(grey, (l) => l.gradientEnabled) < 0.25 && share(rainbow, (l) => l.gradientEnabled) > 0.9 && share(rainbow.filter((l) => l.gradientEnabled), (l) => l.gradientCount === 4) > 0.9,
     [share(grey, (l) => l.gradientEnabled), share(rainbow, (l) => l.gradientEnabled)]);
  const still = many({ motion: 0 }), moving = many({ motion: 100 });
  ok("Motion 0: rarely gliding or smeared; 100: mostly", share(still, (l) => l.smoothEnabled) < 0.3 && share(moving, (l) => l.smoothEnabled) > 0.9 && share(still, (l) => l.smear) < 0.2 && share(moving, (l) => l.smear) > 0.7,
     [share(still, (l) => l.smoothEnabled), share(moving, (l) => l.smoothEnabled)]);
  ok("a roll never touches the sound: no sound key in it, so the sound stays as it was", many({ chaos: 100 }, 100).every((l) => ["typewriterSound", "typewriterSoundVoice", "typewriterSoundVolume", "typewriterSoundBell"].every((k) => !(k in l))));
  ok("a pop group or a typewriter rolled always has something of its own on",
     many({ chaos: 20 }, 400).every((l) => (!l.popEffects || l.popLetters || ["backMan", "shredder", "rabbitHole", "backspaceEvaporate", "backspaceDisintegrate"].some((k) => l[k]) || l.thunderstrike || l.fireworks) &&
       (!l.typewriter || l.typewriterSpring || l.typewriterInk || l.typewriterFreshInk || l.typewriterReturn || l.typewriterAdvance || l.typewriterTape)));
  ok("the dials are settings, not looks: in no preset or share code",
     ["rollChaos", "rollColor", "rollMotion", "rollEffects"].every((k) => k in T.DEFAULT_SETTINGS && !T.LOOK_KEYS.includes(k)) && !("rollSounds" in T.DEFAULT_SETTINGS) &&
     JSON.stringify(T.DEFAULT_SETTINGS.rollEffects) === "{}" &&
     T.DEFAULT_SETTINGS.rollChaos === 35 && T.DEFAULT_SETTINGS.rollColor === 60 && T.DEFAULT_SETTINGS.rollMotion === 50);
}

// A plugin enough for rollCursor: settings, a Vim panel or not, the engine
// and torch calls counted.
function rollPlugin(settings = {}, vim = false) {
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, T.DEFAULT_SETTINGS, { torchEffect: true }, settings);
  p.settings.vimModes = {};
  for (const m of ["normal", "insert", "visual", "replace", "command"]) p.settings.vimModes[m] = Object.assign(T.pickLook(T.DEFAULT_SETTINGS), { colorDark: "#123456" });
  p._activePresetName = "Typer";
  p._vimEditMode = "insert";
  p.isVimUiMode = () => vim;
  p.lookVimMode = () => "normal";
  p.calls = [];
  p.saveSettings = async () => { p.calls.push("save"); };
  p.enable = () => { p.calls.push("enable"); };
  p.torchPossible = () => !!p.settings.torchEffect;
  p.torchEngineActive = true;
  p.disableTorchOverlay = () => { p.calls.push("torch-off"); };
  p.enableTorchOverlay = () => { p.calls.push("torch-on"); };
  p.refreshSettingTab = () => {};
  return p;
}

section("Randomizer: the effects it can roll");
{
  ok("a switch per effect a roll may pick, in the Effects page's order: no torch, no bracket tether", T.ROLL_TOGGLES.join() === "popEffects,typewriter,flameTrail,stardustEnabled,smear,energyEffect,crtEffect,speedDemon,hotHead");
  ok("...all let in by default; the torch and the tether never, switch or not", T.ROLL_TOGGLES.every((k) => T.rollAllowed({}, k)) && T.rollAllowed(null, "hotHead") && !T.rollAllowed({ hotHead: false }, "hotHead") &&
     !T.rollAllowed({ torchEffect: true }, "torchEffect") && !T.rollAllowed({ bracketTether: true }, "bracketTether"));
  const noPops = many({ chaos: 80, allow: { popEffects: false, hotHead: false } }, 200);
  ok("an effect switched off is never rolled", noPops.every((l) => !l.popEffects && !l.hotHead) && noPops.some((l) => l.typewriter));
  const noSmear = many({ motion: 100, allow: { smear: false } }, 100);
  ok("...Motion smear too, whatever Motion says", noSmear.every((l) => !l.smear) && noSmear.some((l) => l.smoothEnabled));
  const none = many({ chaos: 100, allow: Object.fromEntries(T.ROLL_TOGGLES.map((k) => [k, false])) }, 30);
  ok("all switched off: a cursor with no effects (its shape, colors, blink, glide)", none.every((l) => effectsOn(l) === 0 && !l.smear && !l.torchEffect && ["Box", "Line", "Underline"].includes(l.cursorStyle)));
  const two = many({ chaos: 100, allow: Object.assign(Object.fromEntries(T.ROLL_TOGGLES.map((k) => [k, false])), { stardustEnabled: true, crtEffect: true }) }, 30);
  ok("...two let in at Chaos 100: those two, every time", two.every((l) => effectsOn(l) === 2 && l.stardustEnabled && l.crtEffect));
  const calmTwo = many({ chaos: 0, allow: Object.assign(Object.fromEntries(T.ROLL_TOGGLES.map((k) => [k, false])), { stardustEnabled: true, crtEffect: true }) }, 60);
  ok("...and at Chaos 0, one of them", calmTwo.every((l) => effectsOn(l) === 1));
  const wild = many({ chaos: 100, allow: { torchEffect: true, bracketTether: true } }, 40);
  ok("the torch and the bracket tether are never rolled, even at Chaos 100 with a stale switch for them", wild.every((l) => l.torchEffect === false && l.bracketTether === false && !("overlayRadius" in l)));
}

section("Randomizer: rolling");
later(async () => {
  const p = rollPlugin({ cursorStyle: "Line", colorDark: "#abcdef", hotHead: true, rollChaos: 100, rollColor: 100, rollMotion: 100 });
  const { vim, look } = await p.rollCursor();
  ok("a roll lands on the global look (no Vim panel), all of it", vim === false && Object.entries(look).every(([k, v]) => p.settings[k] === v) && p.settings.torchEffect === false);
  ok("...saved, the engine restarted, the torch's engine stopped (the torch was on)", p.calls.join() === "save,enable,torch-off", p.calls);
  ok("...no preset in use after it", p._activePresetName === "");
  ok("...the dials' own settings untouched", p.settings.rollChaos === 100 && p.settings.rollColor === 100);
  const first = T.pickLook(p.settings);
  await p.rollCursor();
  ok("...and another roll, another cursor (no undo: none kept)", T.LOOK_KEYS.some((k) => JSON.stringify(p.settings[k]) !== JSON.stringify(first[k])) && !("_rollUndo" in p) && typeof p.undoRoll === "undefined");

  const v = rollPlugin({ vimModeEnabled: true, uiMode: "vim", vimActivePreset: "Preset1" }, true);
  const global = T.pickLook(v.settings);
  const r1 = await v.rollCursor();
  const modes = ["normal", "insert", "visual", "replace", "command"];
  ok("Vim on: every mode rolled, each its own cursor; the global look untouched; no Vim preset in use",
     r1.vim === true && modes.every((m) => v.settings.vimModes[m].colorDark !== "#123456") &&
     new Set(modes.map((m) => JSON.stringify(T.pickLook(v.settings.vimModes[m])))).size === 5 &&
     T.LOOK_KEYS.every((k) => JSON.stringify(v.settings[k]) === JSON.stringify(global[k])) && v.settings.vimActivePreset === "");
  ok("...and it answers the look of the mode whose tab is open (the preview plays it)", JSON.stringify(T.pickLook(r1.look)) === JSON.stringify(T.pickLook(Object.fromEntries(Object.keys(r1.look).map((k) => [k, v.settings.vimModes.insert[k]])))));

  const full = rollPlugin({ rollChaos: 100, rollColor: 100, rollMotion: 100 });
  await full.rollCursor();
  ok("Chaos at 100: every effect", T.ROLL_EFFECTS.every((k) => full.settings[k]));
  const kept = rollPlugin({ rollChaos: 100, rollEffects: { hotHead: false, popEffects: false } });
  await kept.rollCursor();
  ok("...but not what the switches keep out", !kept.settings.hotHead && !kept.settings.popEffects && kept.settings.typewriter);
});

section("Randomizer: its page");
{
  const rows = renderWholePanel({});
  const named = (n) => rows.find((r) => r.name === n);
  ok("a page of its own, last, with the pill, the buttons and three dials - no sounds switch",
     ["Preview", "Roll", "Chaos", "Color", "Motion"].every((n) => named(n)) && !named("Include sounds"));
  const pill = named("Preview");
  const stage = pill.controlEl.children.find((c) => c.classes.includes("cursor-smith-roll-stage"));
  const demo = stage && stage.children.find((c) => c.classes.includes("cursor-smith-roll-demo"));
  ok("the pill is a stage with the demo in it, the sentence to write in two halves (none written yet)",
     !!demo && !!demo.querySelector(".cursor-smith-pcard-caret") && T.SCRIPT_LINES.includes(demo.querySelector(".cursor-smith-roll-unwritten").text));
  const roll = named("Roll");
  ok("Randomize alone: no Undo", roll.buttons.length === 1 && roll.buttons[0]._text === "Randomize");
  const chaos = named("Chaos");
  ok("the dials are 0 - 100 sliders on their settings, each with its reset", chaos.sliders[0]._limits.min === 0 && chaos.sliders[0]._limits.max === 100 && chaos.sliders[0]._value === 35 && chaos.extras.length === 1);
  const head = rows.findIndex((r) => r.name === "Effects it can roll");
  const switches = rows.slice(head + 1, head + 10);
  ok("then a switch per effect a roll may pick, under its own subheading, the Effects page's names, out of settings search - no torch, no bracket tether",
     head > rows.indexOf(named("Motion")) && switches.map((r) => r.name).join() === "Pop effects,Typewriter,Pixel trail,Stardust,Motion smear,Energy beam,CRT effects,Speed demon,Hot-head" &&
     switches.every((r) => r.def.searchable === false && r.toggles.length === 1) && !rows.slice(head).some((r) => r.name === "Torch spotlight" || r.name === "Bracket tether"), switches.map((r) => r.name));
  ok("...all on", switches.every((r) => r.toggles[0]._value === true));
  const before = T.DEFAULT_SETTINGS.rollEffects;
  switches[8].toggles[0]._change(false);
  ok("...a switch writes a new object (never the defaults' own)", rows.settings.rollEffects.hotHead === false && rows.settings.rollEffects !== before && JSON.stringify(T.DEFAULT_SETTINGS.rollEffects) === "{}");
}

section("Randomizer: the pill's demo waits while its page is away");
{
  const { makeEl } = require("../panel_harness");
  // A window: frames and timers by hand.
  const frames = [], timers = [];
  const win = { requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {}, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {} };
  const doc = { defaultView: win, createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 30 * 7 }) }) };
  const stage = makeEl("div");
  stage.ownerDocument = doc;
  stage.clientWidth = 700;
  const strip = new T.DemoStrip();
  strip.add(stage, "", { cursorStyle: "Box", blinkingEnabled: false }, "#ff3366", [], [], false, true, true);
  const demo = stage.children[0];
  demo.isConnected = true;
  const text = demo.querySelector(".cursor-smith-pcard-text");
  text.ownerDocument = doc;
  let t = 1000;
  const run = (ms) => { for (let i = 0; i < ms / 16; i++) { const f = frames.shift(); if (!f) return false; t += 16; f(t); } return true; };
  // The text: a letter an element (Typewriter's ink is per letter).
  const written = () => text.children[0].children.map((c) => c.text).join("");
  ok("it plays: frame after frame, the sentence written", run(1000) && written().length > 6, written());
  demo.isConnected = false;
  const at = written();
  run(16);
  ok("its page away (the element out of the document): no frames, a slow look in a while instead", frames.length === 0 && timers.length === 1 && written() === at);
  timers.shift()();
  ok("...still away at the look: it waits again", frames.length === 1 && (run(16), frames.length === 0 && timers.length === 1));
  demo.isConnected = true;
  timers.shift()();
  // On from where it was: within a few seconds the line grows (it was
  // being typed) or is cleared for the next (it was done) - either way the
  // text changes at some point. Watched every frame: a short line can be
  // cleared and typed all over again inside the window, and end as it was.
  let changed = false;
  for (let i = 0; i < 7000 / 16 && frames.length; i++) { run(16); if (written() !== at) { changed = true; break; } }
  ok("back: it plays on from where it was (the preview's cursor keeps going)", changed, [at, written()]);
  // One line per roll: the same line again after it is cleared.
  // Typos never touch a line's first three letters: after each clear, the
  // text typed again starts as the line does.
  const texts = [];
  for (let i = 0; i < 1600; i++) { run(16); if (texts[texts.length - 1] !== written()) texts.push(written()); }
  const full = texts.filter((w) => T.SCRIPT_LINES.includes(w));
  const line = full[0];
  const clears = texts.map((w, i) => (w === "" && i > 0 ? i : -1)).filter((i) => i > 0);
  const after = clears.map((i) => texts.slice(i + 1).find((w) => w.length >= 3)).filter(Boolean);
  ok("one line per roll: cleared, it is typed again - the same line, not another",
     !!line && new Set(full).size === 1 && after.length >= 1 && after.every((w) => w.slice(0, 3) === line.slice(0, 3)), [line, clears.length, after]);
  strip.reset();
  run(16);
  ok("reset lets it go: the loop stops", frames.length === 0 && timers.length === 0);
  // The next roll: another line.
  const stage2 = makeEl("div");
  stage2.ownerDocument = doc;
  stage2.clientWidth = 700;
  const lines = [];
  for (let k = 0; k < 12; k++) {
    strip.reset();
    strip.add(stage2, "", { cursorStyle: "Box", blinkingEnabled: false }, "#ff3366", [], [], true, true, true);
    const dm = stage2.children[stage2.children.length - 1];
    lines.push(dm.querySelector(".cursor-smith-pcard-text").children[0].children.map((c) => c.text).join(""));
  }
  ok("...and each roll's line is never the last roll's", lines.every((l, i) => T.SCRIPT_LINES.includes(l) && (i === 0 || l !== lines[i - 1])), lines);
}

section("Randomizer: the preview's script");
{
  ok("its lines: the user's four and more, none longer than the box holds, all different",
     ["The quick brown fox... you know the rest.", "Obsidian made me do it.", "Cursor-Smith is not even real.", "Hello, Mr. Anderson..."].every((l) => T.SCRIPT_LINES.includes(l)) &&
     T.SCRIPT_LINES.length >= 16 && T.SCRIPT_LINES.every((l) => l.length <= T.SCRIPT_MAX) && new Set(T.SCRIPT_LINES).size === T.SCRIPT_LINES.length,
     T.SCRIPT_LINES.filter((l) => l.length > T.SCRIPT_MAX));
  // Every line, many seeds: what a script types, played on the text, is the line.
  const play = (acts) => { let b = "", at = 0; const moves = []; for (const a of acts) { if (a.do === "type") { b += a.ch; at = b.length; } else if (a.do === "back") { b = b.slice(0, -1); at = b.length; } else if (a.do === "move") { at = a.to; moves.push(a); } } return { b, at, moves }; };
  let typos = 0, ok1 = true, okMoves = true, okEnd = true, fast = true;
  for (const line of T.SCRIPT_LINES) for (let seed = 1; seed <= 30; seed++) {
    const acts = T.scriptFor(line, T.seededRandom(seed * 7919 + line.length));
    const clearAt = acts.findIndex((a) => a.do === "clear");
    const r = play(acts.slice(0, clearAt));
    if (r.b !== line) ok1 = false;
    if (r.at !== line.length || acts[acts.length - 1].do !== "clear") okEnd = false;
    if (!r.moves.every((m) => m.to >= 0 && m.to <= line.length) || r.moves.length < 5) okMoves = false;
    const backs = acts.filter((a) => a.do === "back").length;
    if (backs) typos++;
    if (acts.filter((a) => a.do === "type").some((a) => a.ms > 75)) fast = false;
  }
  ok("every script types its line exactly, typos and all put right", ok1);
  ok("...typos now and then, not always (a neighboring key, backspaced)", typos > 3 * T.SCRIPT_LINES.length && typos < T.SCRIPT_LINES.length * 30, typos);
  ok("...typed fast (under 75 ms a key)", fast);
  ok("...then plays with the cursor - five or more moves, all inside the line - and ends at the line's end, cleared", okMoves && okEnd);
  const jumps = T.scriptFor("Obsidian made me do it.", T.seededRandom(3)).filter((a) => a.do === "move");
  ok("...quick jumps (under 350 ms) and single steps (75 ms)", jumps.every((a) => a.ms === 75 || (a.ms >= 230 && a.ms <= 340) || a.ms === 620), jumps.map((a) => a.ms));
  const typo = T.scriptFor("The quick brown fox... you know the rest.", T.seededRandom(11));
  const i = typo.findIndex((a) => a.do === "back");
  ok("a typo is a key next to the right one", i < 0 || (() => { const r = play(typo.slice(0, i)); const line = "The quick brown fox... you know the rest."; let k = 0; while (r.b[k] === line[k]) k++; return "wqesrtfygdhujikolpaszxcvbnm".includes(r.b[k].toLowerCase()) && r.b[k] !== line[k]; })());

  // Played: the text grows, a typo shows and goes, the line is cleared, the
  // next one is another.
  const lines = [];
  const s = T.demoInitialState(0);
  let now = 0;
  const next = () => { const l = T.SCRIPT_LINES[(lines.length * 5) % T.SCRIPT_LINES.length]; lines.push(l); return T.scriptFor(l, T.seededRandom(lines.length)); };
  const events = [];
  const run = (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; T.demoStepScript(s, {}, 16, now, next); events.push(...s.events); s.events.length = 0; } };
  run(600);
  ok("it plays: letters typed, the caret at the text's end", s.buffer.length >= 6 && s.target === s.buffer.length && lines[0].startsWith(s.buffer.slice(0, 3)), s.buffer);
  run(20000);
  ok("...lines one after another, each cleared, every key an event (typed, backspaced, cleared)",
     lines.length >= 2 && events.filter((e) => e.do === "clear").length >= 1 && events.filter((e) => e.do === "type").length > 30 && events.every((e) => ["type", "back", "clear"].includes(e.do)), [lines.length, events.length]);
}

section("Randomizer: the preview's caret, as the engine's");
{
  // The glide, from 0 to 10 letters, at 60 frames a second.
  const ride = (look, typing = false, ms = 1500) => {
    const s = T.demoInitialState(0);
    s.target = 10; s.phase = typing ? "type" : "jump";
    const path = [];
    for (let t = 0; t < ms; t += 16) { T.demoGlide(s, Object.assign({ smoothEnabled: true, catchUpSpeed: 0.55 }, look), 16); path.push(s.lead); }
    return path;
  };
  const ease = ride({ smoothStyle: "ease" }), smooth = ride({ smoothStyle: "smooth" }), springy = ride({ smoothStyle: "springy" }), linear = ride({ smoothStyle: "linear" });
  ok("Glide style Ease out: quickest at the start, never past the spot, arrives", ease[1] - ease[0] > ease[6] - ease[5] && Math.max(...ease) <= 10 && ease[ease.length - 1] === 10);
  ok("...Smooth: a soft start, no overshoot", smooth[1] < ease[1] && Math.max(...smooth) <= 10.0001 && smooth[smooth.length - 1] === 10);
  ok("...Springy: past the spot, then settles on it", Math.max(...springy) > 10.3 && springy[springy.length - 1] === 10, Math.max(...springy));
  // The steps before the last (the last is cut short by the stop).
  const steps = linear.slice(1, 4).map((v, i) => v - linear[i]);
  ok("...Linear: one speed, then a dead stop", steps.every((d) => Math.abs(d - steps[0]) < 1e-9) && linear.includes(10) && linear.slice(linear.indexOf(10)).every((v) => v === 10));
  const typed = ride({ smoothStyle: "springy", smoothAdaptive: true, maxCatchUpSpeed: 0.85 }, true, 400);
  ok("...typing that keeps up chases (no bounce), at the typing rate - faster", Math.max(...typed) <= 10 && typed[3] > ease[3], [typed[3], ease[3]]);
  ok("...Smooth movement off: no glide (the caret jumps)", (() => { const s = T.demoInitialState(0); s.target = 10; return T.demoGlide(s, { smoothEnabled: false }, 16) === false && s.lead === 0; })());

  const g = T.demoGeometryOf({ caretWidthPx: 2.3, caretHeightPct: 60, underlineWidthPx: 0, boxHollowWidth: 1.5 });
  ok("the caret's size: a Line's thickness to the tenth (at the preview's three quarters), its height a share of the line, centered",
     Math.abs(g.lineW - 2.3 * 0.75) < 1e-9 && Math.abs(g.lineH - 18 * 0.6) < 1e-9 && Math.abs(g.lineTop - (2 + (18 - 18 * 0.6) / 2)) < 1e-9 && g.h === 18 && g.top === 2, g);
  ok("...an Underline 15% of the line by default, its own thickness when set; an outline its width",
     Math.abs(g.ulH - 4 * 0.75) < 1e-9 && Math.abs(T.demoGeometryOf({ underlineWidthPx: 5 }).ulH - 3.75) < 1e-9 && Math.abs(g.outline - 1.125) < 1e-9);

  const s = T.demoInitialState(0);
  s.lastKeyMs = 1000;
  const look = { blinkingEnabled: true, blinkSpeed: 1, smoothStopBlinking: true, blinkDelayMs: 0 };
  // Blink speed 1: a 2.5 s cycle, off from about 1.25 s into it.
  const at = (lk, t) => T.demoBlinkReal(s, Object.assign({}, look, lk), t);
  ok("the blink: lit through the hold after a move (450 ms at least), then a cycle that starts fully on",
     at({}, 1400).alpha === 1 && at({}, 1460).alpha === 1 && at({}, 2200).alpha === 1 && [2800, 3000, 3200].every((t) => at({}, t).alpha < 0.5));
  ok("...no hold with Don't blink while typing off: the cycle from the move itself", [2400, 2600].every((t) => at({ smoothStopBlinking: false }, t).alpha < 0.5) && at({}, 2400).alpha > 0.5);
  ok("...solid after Stop after cycles; Breathing keeps it lit and breathes instead",
     at({ blinkStopAfter: 2 }, 1450 + 60000).alpha === 1 && at({ blinkStopAfter: 2 }, 3000).alpha < 0.5 &&
     [2800, 3000, 3200].every((t) => at({ blinkBreathing: true }, t).alpha === 1 && at({ blinkBreathing: true }, t).breath > 0.5));
}
