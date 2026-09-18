// reduced motion, this.settings never swapped, silent catches, the tether's blocks.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("reduced motion");

{
  const KEYS = T.REDUCED_MOTION_OFF_KEYS;
  // Taken before anything below runs, so the "did it mutate the defaults?"
  // check further down has a real baseline rather than a restatement.
  const DEFAULTS_BEFORE = {};
  for (const k of KEYS) DEFAULTS_BEFORE[k] = T.DEFAULT_SETTINGS[k];
  // The failure this catches is a typo'd or renamed key, which would sit in the
  // table doing nothing at all and look exactly like a working entry.
  const unknown = KEYS.filter((k) => !(k in T.DEFAULT_SETTINGS));
  ok("every suppressed key exists in DEFAULT_SETTINGS", unknown.length === 0, unknown);
  ok("no duplicates in the table", new Set(KEYS).size === KEYS.length);

  const obj = Object.assign({}, T.DEFAULT_SETTINGS, {
    smoothEnabled: true, smear: true, popEffects: true, flameTrail: true,
    stardustEnabled: true, hotHead: true, speedDemonSparks: true, crtGlitch: true,
    energyEffect: true, blinkBreathing: true, overlayBlinkSync: true, overlayFlicker: true,
  });
  T.applyReducedMotion(obj);
  ok("every moving effect is switched off", KEYS.every((k) => obj[k] === false),
     KEYS.filter((k) => obj[k] !== false));

  // The line is movement and emission, not the cursor's existence: a caret of a
  // different colour or shape is not motion, and blinking is the platform
  // behaviour of every text caret and has its own switch.
  ok("the cursor's own look is untouched",
     obj.cursorStyle === T.DEFAULT_SETTINGS.cursorStyle &&
     obj.colorDark === T.DEFAULT_SETTINGS.colorDark &&
     obj.cursorOpacity === T.DEFAULT_SETTINGS.cursorOpacity);
  ok("blinking is deliberately NOT suppressed", obj.blinkingEnabled === true);
  // `in` on an array tests indices, not values - includes() is the check meant
  // here. The torch is a reading light, not an animation: it keeps lighting,
  // it just stops pulsing and flickering.
  ok("the torch itself still lights, it just stops moving",
     !KEYS.includes("torchEffect") && obj.overlayRadius === T.DEFAULT_SETTINGS.overlayRadius);

  // It runs on the merged copy inside effectiveSettings, never on this.settings,
  // so nothing it does can reach disk. Compared field by field against a
  // snapshot taken before the call above, because a mutation here would be
  // invisible until it turned up in someone's data.json.
  {
    const leaked = KEYS.filter((k) => T.DEFAULT_SETTINGS[k] !== DEFAULTS_BEFORE[k]);
    ok("DEFAULT_SETTINGS was not mutated", leaked.length === 0, leaked);
  }
  const probe = { smear: true, cursorStyle: "Line" };
  ok("it returns the object it was given", T.applyReducedMotion(probe) === probe);
  ok("respectReducedMotion is a global, not a look key",
     ("respectReducedMotion" in T.DEFAULT_SETTINGS) &&
     T.LOOK_KEYS.indexOf("respectReducedMotion") === -1);
}

// ---------------------------------------------------------------------------
section("the look: this.settings is never swapped");

// The engine reads this.look - the active Vim mode's snapshot merged over the
// settings, reduced motion applied - through the memo in effectiveSettings.
// this.settings is only ever the persisted object. Until 1.5.5 the ticks
// swapped this.settings for the merged one and put it back in a finally; a
// read from anything that fired mid-frame saw the wrong object, and a save
// would have persisted a mode snapshot as the global config.
{
  const e = Object.create(Plugin.prototype);
  e.settings = Object.assign({}, T.DEFAULT_SETTINGS, {
    colorDark: "#111111", smear: false,
    vimModeEnabled: true,
    vimModes: { normal: { colorDark: "#abcdef", smear: true } },
  });
  e.currentVimMode = () => "normal";
  e.reducedMotion = () => false;

  const real = e.settings;
  ok("the look is the mode's snapshot over the settings", e.look.colorDark === "#abcdef" && e.look.smear === true, e.look.colorDark);
  ok("...and styleFor reads it", e.styleFor("colorDark") === "#abcdef");
  ok("...while this.settings keeps the persisted values", e.settings === real && e.settings.colorDark === "#111111" && e.settings.smear === false);
  ok("...and a global key reads the same either way", e.look.hideNativeCaret === e.settings.hideNativeCaret);
  ok("the look is memoized: two reads are one object", e.look === e.look);

  // A mode switch, a settings edit or a save is seen at once, with nothing
  // to refresh by hand.
  e.currentVimMode = () => "insert";
  ok("a mode with no snapshot is the settings themselves", e.look === e.settings);
  e.currentVimMode = () => "normal";
  e.settings.vimModes.normal.colorDark = "#222222";
  e._effCache = null; // what saveSettings does after a slider write
  ok("an edited snapshot is seen after the save drops the memo", e.look.colorDark === "#222222");

  // Saving from anywhere - including mid-frame - writes the real object.
  let saved = null;
  e.saveData = async (d) => { saved = d; };
  e.applyBodyClasses = () => {}; e.applyOverlayStyle = () => {}; e.syncVimStatusBar = () => {};
  e.refreshSettingTab = () => {}; e.updateVimStatusBar = () => {}; e._statusSig = "";
  const p = e.saveSettings();
  ok("saveSettings returns a promise", p && typeof p.then === "function");
  later(async () => {
    await p;
    ok("...that persists this.settings, never the look", saved === real && saved.colorDark === "#111111", saved && saved.colorDark);
  });

  // With Vim off the look IS the settings object: no merge, no copy.
  const f = Object.create(Plugin.prototype);
  f.settings = Object.assign({}, T.DEFAULT_SETTINGS);
  f.reducedMotion = () => false;
  ok("with Vim mode off the look is the settings object itself", f.look === f.settings);

  // The seam files paint, spawn and measure: they read the look and never
  // the persisted object - an alias like `const s = this.settings` at the
  // top of a painter is the regression this guards (it happened once, in
  // the flip: five painters kept the alias and read the global settings
  // in Vim mode).
  {
    const fs_ = require("fs"), path_ = require("path");
    const offenders = [];
    const isComment = (l) => /^\s*\/\//.test(l);
    // The torch's two global questions - is the overlay needed by ANY mode,
    // does the global cursor want it - read the persisted object on purpose.
    const torchGlobal = /this\.settings\.(torchEffect|vimModeEnabled|vimModes)\b/;
    // effects.ts is an aggregate since the split by effect; the four files
    // behind it are what to sweep.
    for (const f of ["effects-fire.ts", "effects-pops.ts", "effects-dust.ts", "effects-trail.ts", "paint-color.ts", "paint-blink.ts", "paint-shape.ts", "paint-energy.ts", "paint-tether.ts", "paint-secondaries.ts", "paint-smear.ts", "paint-frame.ts", "torch.ts"]) {
      const text = fs_.readFileSync(path_.join(__dirname, "..", "..", "src", f), "utf8");
      text.split("\n").forEach((l, i) => { if (/this\.settings\b/.test(l) && !isComment(l) && !(f === "torch.ts" && torchGlobal.test(l))) offenders.push(f + ":" + (i + 1)); });
    }
    const measure = fs_.readFileSync(path_.join(__dirname, "..", "..", "src", "measure.ts"), "utf8");
    measure.split("\n").forEach((l, i) => { if (/this\.settings\b/.test(l) && !/this\.settings\.noteEditorOnly/.test(l) && !isComment(l)) offenders.push("measure.ts:" + (i + 1)); });
    ok("the painters, effects, torch and measurers read the look, never this.settings", offenders.length === 0, offenders);
  }

  // And the fields the swap needed are gone for good.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "build", "test-bundle.js"), "utf8");
  ok("nothing assigns this.settings inside the ticks", !/_settingsSwapped|_realSettings/.test(src));
}

// ---------------------------------------------------------------------------
section("first-run starter preset");

{
  const starterName = T.DEFAULT_PRESET_NAME;
  const starter = T.DEFAULT_PRESETS[starterName];
  ok("the starter names a preset that actually ships", !!starter, starterName);

  // The whole point: a new install must open on something that IS in the
  // preset list, so the first look a user sees is one they can get back to.
  ok("the starter is one of the seeded presets",
     Object.keys(T.DEFAULT_PRESETS).includes(starterName), Object.keys(T.DEFAULT_PRESETS));

  const look = T.presetWithDefaults(starter);
  ok("the starter resolves to a complete look",
     T.LOOK_KEYS.every((k) => k in look),
     T.LOOK_KEYS.filter((k) => !(k in look)));

  // The reported symptom, pinned. Not a style opinion - these are the two
  // things that made the old first-run look unreachable from the preset list.
  ok("a new install does not open on a blinking caret", look.blinkingEnabled === false);
  ok("a new install opens on the starter's colour",
     look.colorDark === starter.colorDark, [look.colorDark, starter.colorDark]);

  // --- and the reason it is applied at load rather than baked into the
  // defaults. DEFAULT_SETTINGS is the share-code baseline: shareFields()
  // emits only what differs from it. If someone "simplifies" this by editing
  // the defaults to match the starter, that delta collapses to nothing and
  // every share code in the wild silently decodes to a different look.
  const body = T.presetToCode("probe", starter).split("|")[2];
  ok("the starter is still a DELTA from the defaults, not the defaults",
     body.length > 0,
     "empty body means DEFAULT_SETTINGS was changed to match the starter");

  // Spot-check the baseline values the starter differs on. These are wire
  // format, not taste - they are what a share code omitting these fields
  // decodes back to on the recipient's machine.
  ok("baseline colorDark unchanged", T.DEFAULT_SETTINGS.colorDark === "#39ff14",
     T.DEFAULT_SETTINGS.colorDark);
  ok("baseline blinkingEnabled unchanged", T.DEFAULT_SETTINGS.blinkingEnabled === true,
     T.DEFAULT_SETTINGS.blinkingEnabled);

  // A code emitted from the defaults themselves still carries no fields.
  ok("the defaults still encode as an empty body",
     T.presetToCode("d", T.DEFAULT_SETTINGS).split("|")[2] === "");

  // --- the function onload() actually calls -------------------------------
  // Rebuilt the way onload does: defaults, then the seeding loop.
  const freshSettings = () => {
    const s = Object.assign({}, T.DEFAULT_SETTINGS, { userPresets: {} });
    for (const [n, snap] of Object.entries(T.DEFAULT_PRESETS)) s.userPresets[n] = snap;
    return s;
  };

  {
    const s = freshSettings();
    ok("applyStarterPreset reports success", T.applyStarterPreset(s) === true);
    ok("...and the live settings now match the starter",
       s.colorDark === starter.colorDark && s.blinkingEnabled === false,
       [s.colorDark, s.blinkingEnabled]);
    // The preset list must survive being applied over - it lives on the same
    // object, and loadUserPreset has to hold a reference for exactly this
    // reason.
    ok("the preset library is not clobbered",
       Object.keys(s.userPresets).length === Object.keys(T.DEFAULT_PRESETS).length,
       Object.keys(s.userPresets));
    // Vim theming is an independent system; a CUA starter must not touch it.
    ok("vim state is untouched", s.vimModes === T.DEFAULT_SETTINGS.vimModes);
  }
  {
    // No starter in the library (a user who deleted it, then somehow lost
    // their data file) must be a no-op, not a crash.
    const s = freshSettings();
    delete s.userPresets[starterName];
    const before = s.colorDark;
    ok("a missing starter is a no-op", T.applyStarterPreset(s) === false);
    ok("...and changes nothing", s.colorDark === before);
  }
  ok("a settings object with no presets at all is survivable",
     T.applyStarterPreset({}) === false);
}

// ---------------------------------------------------------------------------
section("bracket tether: blocks cut the line");

{
  // tetherSpan only ever touches doc.length and doc.sliceString, so a string
  // is a complete stand-in for a CodeMirror document here.
  const mkDoc = (s) => ({ length: s.length, sliceString: (a, b) => s.slice(a, b) });
  const eng = Object.create(Plugin.prototype);
  // Caret index of the "|" marker, which is stripped before the doc is built.
  const spanAt = (marked) => {
    const pos = marked.indexOf("|");
    const doc = mkDoc(marked.replace("|", ""));
    return eng.tetherSpan(doc, pos);
  };
  // Whole-document boundary test between the two "<" / ">" in the fixture.
  const cuts = (s) => eng.crossesBlockBoundary(mkDoc(s), s.indexOf("<"), s.lastIndexOf(">"));

  // --- per-line classification -------------------------------------------
  // Everything else is built on this, so pin it directly.
  const info = T.blockLineInfo;
  ok("a plain line is depth 0", info("hello").depth === 0);
  ok("a quoted line is depth 1", info("> hello").depth === 1);
  ok("a nested quote is depth 2", info(">> hello").depth === 2);
  ok("a lone > is still a marker", info(">").depth === 1);
  // A callout is just a blockquote whose first line carries a type marker -
  // this is why callouts need no separate handling anywhere.
  ok("a callout header is an ordinary quoted line",
     info("> [!note] Title").depth === 1);
  ok("a fence is recognised", info("```js").fence === true);
  ok("3 spaces of indent still fences", info("   ```").fence === true);
  ok("4 spaces of indent does not", info("    ```").fence === false);
  ok("two backticks do not", info("``").fence === false);
  ok("a mid-line ``` does not", info("x ```").fence === false);
  // A fence inside a callout is still a fence, once its prefix is stripped.
  ok("a fence inside a quote is seen past the marker",
     info("> ```js").fence === true && info("> ```js").depth === 1);

  // --- code fences --------------------------------------------------------
  ok("a fence between the ends cuts", cuts("a <b\n```\nc> d"));
  ok("no fence, no cut", cuts("a <b c> d") === false);
  ok("tildes count as a fence", cuts("<\n~~~\nx>"));
  ok("indented up to 3 spaces still counts", cuts("<\n   ```\nx>"));
  ok("4 spaces of indent is not a fence", cuts("<\n    ```\nx>") === false);
  ok("two backticks are not a fence", cuts("<\n``\nx>") === false);
  ok("a mid-line ``` is not a fence", cuts("<\nx ```\ny>") === false);
  {
    // A fence opening the span's LAST line is still matched even though the
    // span stops partway through it (what CODE_FENCE_PREFIX buys).
    const d = mkDoc("<\n```js\nx>");
    ok("a fence at the very end of the span is still seen",
       eng.crossesBlockBoundary(d, 0, 3));
  }
  ok("a zero-length span never cuts", cuts("<>") === false);
  {
    const d = mkDoc("a <b\n```\nc> d");
    ok("a reversed span never cuts", eng.crossesBlockBoundary(d, 10, 2) === false);
  }

  // --- blockquotes and callouts -------------------------------------------
  // The reported case, in quote form: one end inside, one outside.
  ok("leaving a blockquote cuts", cuts("> a <b\nc> d"));
  ok("entering a blockquote cuts", cuts("a <b\n> c> d"));
  ok("a pair inside one blockquote is kept", cuts("> a <b\n> c> d") === false);
  ok("a pair inside one callout is kept",
     cuts("> [!note] T\n> a <b\n> c> d") === false);
  ok("crossing a whole callout cuts", cuts("<a\n> [!note] T\n> body\nb>"));
  // A blank line ends a blockquote, so two quoted passages either side of one
  // are different blocks even though both are depth 1.
  ok("a blank line separates two quotes", cuts("> <a\n\n> b> c"));
  ok("changing quote depth cuts", cuts("> <a\n>> b> c"));
  ok("leaving a nested quote cuts", cuts(">> <a\n> b> c"));

  // --- ">" as a blockquote marker, not a bracket --------------------------
  // No boundary check can catch this: the marker sits at the SAME depth as
  // the "<", so only knowing what a marker is prevents the false pair.
  {
    const s = spanAt("> a <| b\n> c > d");
    ok("a '<' does not pair with the next line's marker", !!s, s);
    ok("...it pairs with the real '>' further along",
       s && s.to === 12, s);
  }
  {
    // Every line of a callout offers a fresh false partner; none may be taken.
    const s = spanAt("> [!warning] T\n> if a <| b\n> then c\n> done >");
    ok("a callout's markers are all skipped", !!s, s);
    ok("...and the real '>' at the end wins", s && s.to === 42, s);
  }
  {
    // Nothing to pair with at all once the markers are excluded.
    ok("a '<' with only markers after it tethers to nothing",
       spanAt("> a <| b\n> c\n> d") === null);
  }
  {
    // Parking beside the marker itself must do nothing.
    ok("the caret on a quote marker tethers to nothing",
       spanAt("a < b\n>| c") === null);
  }
  {
    // enclosingBracketSpan walks backwards and would otherwise count each
    // marker as a closer, leaving depth[">"] permanently ahead.
    const s = spanAt("> <a\n> b|\n> c>");
    ok("markers do not inflate the enclosing-pair depth count", !!s, s);
    ok("...and the enclosing angle pair is found", s && s.from === 2, s);
  }

  // --- what must still work ----------------------------------------------
  ok("a pair wholly inside one code block still tethers",
     !!spanAt("```\n<|div>\n```"));
  ok("an ordinary pair with no block anywhere still tethers", !!spanAt("<|a b> c"));
  ok("a plain multi-line pair still tethers", !!spanAt("(|a\nb\nc)"));
  ok("a pair spanning a whole code block is dropped",
     spanAt("(|a\n```\nx\n```\nb)") === null);
  {
    // The adjacent loop must `continue` past a cut match, not bail: the caret
    // touches TWO characters and only one of them is broken.
    const s = spanAt("<\n```\nx>|(a)");
    ok("a cut bracket doesn't veto the other adjacent one", !!s, s);
    ok("...and the intact pair is what gets tethered",
       s && s.from === 8 && s.to === 10, s);
  }
  {
    ok("an enclosing pair broken by a fence is dropped",
       spanAt("(a|\n```\nb)") === null);
    ok("...but the same shape without one still tethers", !!spanAt("(a|\nxxx\nb)"));
  }
  ok("a cut inner pair does not fall outward to an enclosing one",
     spanAt("[ (| ]\n```\n)\n```") === null);
  ok("an inline quote run is unaffected", !!spanAt("`code|`"));
}
