// The Randomizer (1.7.7): a whole cursor rolled at once from three dials
// (Chaos, Color, Motion) and a switch (Include sounds) - the roll itself
// (randomize.ts, rolled with a seed here), what applying one does and
// takes back (library.ts), and its page.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, Plugin, ok, section, later, renderPanel } = require("../lib");
const { renderWholePanel } = require("../panel_harness");

const roll = (o, seed) => T.rollLook(Object.assign({ chaos: 35, color: 60, motion: 50, sounds: false }, o), T.seededRandom(seed));
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
     T.LOOK_KEYS.filter((k) => !k.startsWith("overlay") && !k.startsWith("typewriterSound")).every((k) => k in a));
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
  ok("Chaos 100: every effect, all at once, with their extras", chaos.every((l) => effectsOn(l) === T.ROLL_EFFECTS.length && l.fireworks && l.thunderstrike && l.backspaceDisintegrate && l.crtNeon && l.crtGlitch && l.glow && l.smoothEnabled && l.smear));
  const fireworks = (ls) => ls.filter((l) => l.popEffects).reduce((n, l) => n + l.fireworksQuantity, 0) / Math.max(1, ls.filter((l) => l.popEffects).length);
  ok("...and stronger: the higher, the more fireworks per key", fireworks(calm) < fireworks(wild), [fireworks(calm), fireworks(wild)]);
  const grey = many({ color: 0 }), rainbow = many({ color: 100 });
  ok("Color 0: mostly one color; 100: gradients, most of four", share(grey, (l) => l.gradientEnabled) < 0.25 && share(rainbow, (l) => l.gradientEnabled) > 0.9 && share(rainbow.filter((l) => l.gradientEnabled), (l) => l.gradientCount === 4) > 0.9,
     [share(grey, (l) => l.gradientEnabled), share(rainbow, (l) => l.gradientEnabled)]);
  const still = many({ motion: 0 }), moving = many({ motion: 100 });
  ok("Motion 0: rarely gliding or smeared; 100: mostly", share(still, (l) => l.smoothEnabled) < 0.3 && share(moving, (l) => l.smoothEnabled) > 0.9 && share(still, (l) => l.smear) < 0.2 && share(moving, (l) => l.smear) > 0.7,
     [share(still, (l) => l.smoothEnabled), share(moving, (l) => l.smoothEnabled)]);
  const loud = many({ sounds: true }, 100);
  ok("Include sounds: a sound every roll, any of them, near the default level", loud.every((l) => l.typewriterSound && T.SOUND_MACHINES.some((m) => m.id === l.typewriterSoundVoice) && l.typewriterSoundVolume >= 40 && l.typewriterSoundVolume <= 60) &&
     new Set(loud.map((l) => T.soundMachine(l.typewriterSoundVoice).kind)).size === 3);
  ok("...off: a silent cursor, the chosen sound left as it was", many({ sounds: false }, 50).every((l) => l.typewriterSound === false && !("typewriterSoundVoice" in l)));
  ok("a pop group or a typewriter rolled always has something of its own on",
     many({ chaos: 20 }, 400).every((l) => (!l.popEffects || l.popLetters || l.backspaceDisintegrate || l.backspaceEvaporate || l.thunderstrike || l.fireworks) &&
       (!l.typewriter || l.typewriterSpring || l.typewriterInk || l.typewriterFreshInk || l.typewriterReturn || l.typewriterAdvance || l.typewriterTape)));
  ok("the dials are settings, not looks: in no preset or share code",
     ["rollChaos", "rollColor", "rollMotion", "rollSounds"].every((k) => k in T.DEFAULT_SETTINGS && !T.LOOK_KEYS.includes(k)) &&
     T.DEFAULT_SETTINGS.rollChaos === 35 && T.DEFAULT_SETTINGS.rollColor === 60 && T.DEFAULT_SETTINGS.rollMotion === 50 && T.DEFAULT_SETTINGS.rollSounds === false);
}

// A plugin enough for rollCursor: settings, a Vim panel or not, the engine
// and torch calls counted.
function rollPlugin(settings = {}, vim = false) {
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, T.DEFAULT_SETTINGS, { torchEffect: true }, settings);
  p.settings.vimModes = {};
  for (const m of ["normal", "insert", "visual", "replace", "command"]) p.settings.vimModes[m] = Object.assign(T.pickLook(T.DEFAULT_SETTINGS), { colorDark: "#123456" });
  p._rollUndo = [];
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

section("Randomizer: rolling and taking it back");
later(async () => {
  const p = rollPlugin({ cursorStyle: "Line", colorDark: "#abcdef", hotHead: true, rollChaos: 100, rollColor: 100, rollMotion: 100 });
  const before = T.pickLook(p.settings);
  const { mode, look } = await p.rollCursor({ fromPanel: true });
  ok("a roll lands on the global look (no Vim panel), all of it", mode === null && Object.entries(look).every(([k, v]) => p.settings[k] === v) && p.settings.torchEffect === false);
  ok("...saved, the engine restarted, the torch's engine stopped (the torch was on)", p.calls.join() === "save,enable,torch-off", p.calls);
  ok("...no preset in use after it", p._activePresetName === "");
  ok("...the dials' own settings untouched", p.settings.rollChaos === 100 && p.settings.rollColor === 100);
  await p.rollCursor({});
  ok("two rolls, two looks to go back through", p._rollUndo.length === 2);
  await p.undoRoll(); await p.undoRoll();
  ok("Undo twice: the look before the first roll, whole, and its preset", T.LOOK_KEYS.every((k) => JSON.stringify(p.settings[k]) === JSON.stringify(before[k])) && p._activePresetName === "Typer" && p.settings.torchEffect === true);
  ok("...and nothing more to undo", (await p.undoRoll()) === false);
  for (let i = 0; i < 25; i++) await p.rollCursor({});
  ok("the undo stack keeps the last 20", p._rollUndo.length === 20);

  const v = rollPlugin({ vimModeEnabled: true, uiMode: "vim", vimActivePreset: "Preset1" }, true);
  const global = T.pickLook(v.settings);
  const r1 = await v.rollCursor({ fromPanel: true });
  ok("Vim panel: the mode whose tab is picked is rolled, the others and the global look untouched",
     r1.mode === "insert" && v.settings.vimModes.insert.colorDark !== "#123456" && v.settings.vimModes.normal.colorDark === "#123456" &&
     T.LOOK_KEYS.every((k) => JSON.stringify(v.settings[k]) === JSON.stringify(global[k])) && v.settings.vimActivePreset === "");
  const r2 = await v.rollCursor({});
  ok("...from the palette: the mode the cursor is in", r2.mode === "normal" && v.settings.vimModes.normal.colorDark !== "#123456");
  await v.undoRoll(); await v.undoRoll();
  ok("...Undo puts each mode back, and the Vim preset", v.settings.vimModes.normal.colorDark === "#123456" && v.settings.vimModes.insert.colorDark === "#123456" && v.settings.vimActivePreset === "Preset1");

  const full = rollPlugin({ rollChaos: 0, rollColor: 0, rollMotion: 0 });
  await full.rollCursor({ full: true });
  ok("full chaos ignores the dials: every effect", T.ROLL_EFFECTS.every((k) => full.settings[k]));
});

section("Randomizer: its page");
{
  const rows = renderWholePanel({});
  const named = (n) => rows.find((r) => r.name === n);
  ok("a page of its own, last, with the pill, the buttons, three dials and the sounds switch",
     ["Preview", "Roll", "Chaos", "Color", "Motion", "Include sounds"].every((n) => named(n)));
  const pill = named("Preview");
  const stage = pill.controlEl.children.find((c) => c.classes.includes("cursor-smith-roll-stage"));
  const demo = stage && stage.children.find((c) => c.classes.includes("cursor-smith-roll-demo"));
  ok("the pill is a stage with the demo in it, the sentence to write in two halves (none written yet)",
     !!demo && !!demo.querySelector(".cursor-smith-pcard-caret") && demo.querySelector(".cursor-smith-roll-unwritten").text === T.SCRIPT_TEXT);
  const roll = named("Roll");
  ok("Randomize and Undo; Undo off with nothing to undo", roll.buttons.length === 2 && roll.buttons[0]._text === "Randomize" && roll.buttons[1]._text === "Undo");
  const chaos = named("Chaos");
  ok("the dials are 0 - 100 sliders on their settings, each with its reset", chaos.sliders[0]._limits.min === 0 && chaos.sliders[0]._limits.max === 100 && chaos.sliders[0]._value === 35 && chaos.extras.length === 1);
  ok("the switch reads its setting", named("Include sounds").toggles[0]._value === false);
}

section("Randomizer: the pill's script");
{
  const n = T.SCRIPT_TEXT.length;
  const tour = T.scriptTour(T.SCRIPT_TEXT);
  ok("the sentence, and a tour of word starts that ends at its end", T.SCRIPT_TEXT === "The quick brown fox jumps over the lazy dog." &&
     tour.length === 7 && tour[tour.length - 1] === n && tour.slice(0, -1).every((i) => i === 0 || T.SCRIPT_TEXT[i - 1] === " "), tour);
  const look = {};
  const s = T.demoInitialState(0);
  let now = 0;
  const run = (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; T.demoStepScript(s, look, n, 16, now, tour); } };
  run(85 * 10 + 20);
  ok("it writes a letter a keystroke, the caret after it", s.phase === "type" && s.shown === s.target && s.shown >= 9 && s.shown <= 11, [s.shown, s.target]);
  run(85 * n);
  ok("...the whole sentence, then holds", s.shown === n && s.target === n && (s.phase === "holdEnd" || s.phase === "jump"));
  const seen = [];
  for (let i = 0; i < 400 && s.phase !== "clear"; i++) { run(16); if (seen[seen.length - 1] !== s.target) seen.push(s.target); }
  ok("...jumps through it, stop by stop, to the end", seen.join() === [n, ...tour].join() || seen.join() === tour.join(), seen);
  run(800);
  ok("...then clears it and starts over at the start", s.shown === 0 && s.target === 0);
  run(500 + 85 * 3);
  ok("...writing again", s.phase === "type" && s.shown > 0);
}
