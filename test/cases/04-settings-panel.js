// the panel: renders, gates, rail, callers, the whole tree, descriptions, donate row.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("palette: Toggle Vim mode");

// This command was removed from the palette once, for real reasons, and is
// back because the chain underneath it has since been hardened - see the note
// where the commands are registered. What is tested here is the part that is
// genuinely new: toggleUiMode's own contract. setVimModeEnabled is stubbed
// throughout; what IT does needs Obsidian's vim adapter, and is not what this
// command added.
{
  // Deferred assertions land at the bottom of the run, after every
  // synchronous section, so they get a header of their own rather than
  // appearing as loose passes under whatever finished last.
  later(() => section("palette: Toggle Vim mode (after the await)"));

  const mkPlugin = (settings, over = {}) => {
    const p = Object.create(Plugin.prototype);
    p.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    p.calls = [];
    p.refreshed = 0;
    p.setVimModeEnabled = async (v) => {
      p.calls.push(v);
      p.settings.uiMode = v ? "vim" : "cua";
      p.settings.vimModeEnabled = v;
    };
    p.refreshSettingTab = () => { p.refreshed++; };
    return Object.assign(p, over);
  };

  // setVimModeEnabled is called SYNCHRONOUSLY, before toggleUiMode's first
  // await, so direction and the latch can both be read without waiting.
  {
    const cua = mkPlugin({ uiMode: "cua", vimModeEnabled: false });
    cua.toggleUiMode();
    ok("CUA toggles to Vim", cua.calls.length === 1 && cua.calls[0] === true, cua.calls);

    const vim = mkPlugin({ uiMode: "vim", vimModeEnabled: true });
    vim.toggleUiMode();
    ok("Vim toggles back to CUA", vim.calls.length === 1 && vim.calls[0] === false, vim.calls);

    // An install predating uiMode carries only vimModeEnabled. Reading
    // settings.uiMode directly would see "cua" here and switch the user INTO
    // the mode they are already in, so the first press would look dead.
    const legacy = mkPlugin({ vimModeEnabled: true });
    delete legacy.settings.uiMode;
    legacy.toggleUiMode();
    ok("a pre-uiMode install toggles the right way", legacy.calls[0] === false, legacy.calls);
  }

  // Single-flight. This is the one guard that exists because of the palette: a
  // held hotkey re-fires where a button cannot be clicked mid-flight, and
  // setVimModeEnabled awaits a disk write partway through a chain that
  // rebuilds every editor's extensions.
  {
    let release;
    const p = mkPlugin({ uiMode: "cua" });
    p.setVimModeEnabled = (v) => { p.calls.push(v); return new Promise((r) => { release = r; }); };
    p.toggleUiMode();
    p.toggleUiMode();
    p.toggleUiMode();
    ok("a held hotkey cannot stack switches", p.calls.length === 1, p.calls);
    ok("...the latch is up while one is in flight", p._uiModeSwitching === true);
    release();
    later(async () => {
      await Promise.resolve(); await Promise.resolve();
      ok("...and drops once the switch settles", p._uiModeSwitching === false);
      p.settings.uiMode = "vim";
      p.setVimModeEnabled = async (v) => { p.calls.push(v); };
      await p.toggleUiMode();
      ok("...leaving the command usable again", p.calls.length === 2 && p.calls[1] === false, p.calls);
    });
  }

  // The latch is released in a `finally`. setVimModeEnabled guards its own
  // side effects but saveSettings() inside it is not guarded, and a latch
  // stuck true would kill the command for the rest of the session - a much
  // worse failure than the one that caused it.
  {
    const p = mkPlugin({ uiMode: "cua" });
    p.setVimModeEnabled = async () => { throw new Error("disk full"); };
    later(async () => {
      let threw = false;
      try { await p.toggleUiMode(); } catch { threw = true; }
      ok("a failed switch still rejects", threw === true);
      ok("...but does not wedge the command", p._uiModeSwitching === false);
    });
  }

  // Feedback. The status bar indicator only exists in Vim mode, so switching
  // TO CUA removes the one thing that was showing the mode - without a notice
  // that direction is a command with no visible effect at all.
  {
    later(async () => {
      T.Notice.messages.length = 0;
      const toVim = mkPlugin({ uiMode: "cua" });
      await toVim.toggleUiMode();
      const toCua = mkPlugin({ uiMode: "vim", vimModeEnabled: true });
      await toCua.toggleUiMode();
      ok("both directions say which mode you landed in", T.Notice.messages.length === 2,
         T.Notice.messages);
      ok("...naming Vim", /vim/i.test(T.Notice.messages[0] || ""), T.Notice.messages[0]);
      ok("...and naming CUA", /cua/i.test(T.Notice.messages[1] || ""), T.Notice.messages[1]);
      ok("the open settings panel is refreshed", toVim.refreshed === 1, toVim.refreshed);
    });
  }
}

// refreshSettingTab is the real method here, not a stub. It exists because the
// panel is built from definitions Obsidian keeps: the mode switch, the preset
// lists and the loaded values are baked in when getSettingDefinitions() runs,
// and Obsidian renders the last set it was handed - so a palette command that
// changes any of them has to hand it a new set, or the panel opens showing
// the state you just left.
{
  const mkTab = () => {
    const tab = { containerEl: {}, updated: 0, update() { tab.updated++; } };
    return tab;
  };
  const run = (tab) => {
    const p = Object.create(Plugin.prototype);
    p.settingTab = tab;
    p.refreshSettingTab();
    return p;
  };

  const tab = mkTab();
  run(tab);
  ok("the panel's definitions are rebuilt", tab.updated === 1, tab.updated);

  // Whether or not it is on screen: update() stores the definitions and only
  // re-renders if the tab is the one showing, so there is nothing to check.
  const again = mkTab();
  run(again); run(again);
  ok("...every time it is asked", again.updated === 2, again.updated);

  let threw = false;
  try { run(undefined); } catch { threw = true; }
  ok("never having opened Settings is fine", threw === false);

  // Fails closed, like every other decorative step in this plugin: a stale
  // panel is far cheaper than a palette command that throws.
  {
    const bad = mkTab();
    bad.display = () => { throw new Error("panel exploded"); };
    const realError = console.error;
    console.error = () => {};
    let blew = false;
    try { run(bad); } catch { blew = true; } finally { console.error = realError; }
    ok("a throwing panel cannot take the command down", blew === false);
  }
}

// ---------------------------------------------------------------------------
section("settings panel renders");

// This section exists because of a real bug that shipped past every other test
// here: a row referenced a bare `plugin` where only `this.plugin` is in scope,
// which threw a ReferenceError mid-render and silently removed that row AND
// every row after it from the panel. Nothing engine-side can see that - the
// effect worked perfectly, you just couldn't reach its toggle.
//
// The panel is declarative since 1.5.4 (getSettingDefinitions): the harness
// plays Obsidian's part, building a row for every definition and calling its
// render callback, so a throw inside one still shows up here the same way.
//
// Since 1.5.5 every row is built every time and the rows a gate controls
// carry a `visible` predicate (a class toggle on refreshDomState(), not a
// re-render - the re-render cost 60-80ms per press in the settings window).
// So "the panel shows X" is "a row named X is built AND visible".

function panelRows(settings) {
  try { return renderPanel(settings); }
  catch (e) { return { threw: e }; }
}
const named = (rows, name) => rows.some(r => r.name === name && r.visible);

{
  const rows = panelRows({});
  ok("the panel renders without throwing", !rows.threw, rows.threw && rows.threw.message);
  ok("it produces a substantial number of rows", rows.length > 25, rows.length);
}

// Every effect's top-level row must be reachable at default settings. A missing
// name here means something threw before it, or a gate is wrong.
{
  const rows = panelRows({});
  for (const name of ["Pop effects", "Pixel trail", "Speed demon", "CRT effects"]) {
    ok(`"${name}" is reachable`, named(rows, name), rows.map(r => r.name).filter(Boolean));
  }
  ok("Text Crawl is gone", !rows.some(r => (r.name || "").includes("Crawl")),
     rows.map(r => r.name).filter(n => n && n.includes("Crawl")));
}

// The four cards, in order, each a group with a heading - that is what
// Obsidian renders as a card and indexes for settings search.
{
  const rows = panelRows({});
  const { sectionOf } = require("../panel_harness");
  const sections = [...new Set(rows.map(sectionOf))].filter((s) => s !== null);
  ok("the look settings are four cards", sections.join() === "Appearance,Blinking,Smooth movement,Effects", sections);
  ok("every row has a name or a note",
     rows.every((r) => r.name || r.def.render), rows.filter((r) => !r.name && !r.def.render).map((r) => r.def));
}

// Pop effects' five sub-options, and the rows that hang off them.
{
  const rows = panelRows({ popEffects: true });
  for (const name of ["Rainbow", "Popping letters", "Backspace disintegration",
                      "Thunderstrike", "Fireworks"]) {
    ok(`Pop effects shows "${name}"`, named(rows, name), name);
  }
  // Built and removed; asserted absent so a half-finished revert can't put it
  // back unnoticed.
  ok("Matrix Rain is gone", !named(rows, "Matrix rain") && !named(rows, "Matrix Rain"));
  ok("Rain Density is gone", !named(rows, "Rain density") && !named(rows, "Rain Density"));

  const closed = panelRows({ popEffects: false });
  ok("the group gate hides its sub-options", !named(closed, "Fireworks"));
}

// Sub-sliders appear only with their parent on - and crucially, the rows AFTER
// them still render, which is what the original ReferenceError bug broke.
{
  const on = panelRows({ popEffects: true, fireworks: true });
  ok("Quantity appears with Fireworks on", named(on, "Quantity"));
  const off = panelRows({ popEffects: true, fireworks: false });
  ok("Quantity is hidden with Fireworks off", !named(off, "Quantity"));

  const bolt = panelRows({ popEffects: true, thunderstrike: true });
  ok("Thunderstrike's sliders appear", named(bolt, "Bolt size") && named(bolt, "Bolt strength"));
  ok("rows after Thunderstrike still render", named(bolt, "Fireworks"));
}

// Blink-to-solid's row, and the rows either side of it. Per ARCHITECTURE:
// assert a row renders AND that a row after it still does, since a throw takes
// out everything downstream of itself.
{
  const on = panelRows({ blinkingEnabled: true });
  ok("\"Stop after\" is reachable", named(on, "Stop after"), on.map(r => r.name).filter(Boolean));
  ok("...the row before it still renders", named(on, "Blink delay"));
  ok("...and the row after it does too", named(on, "Breathing"));
  const off = panelRows({ blinkingEnabled: false });
  ok("...and the blink gate hides it", !named(off, "Stop after"));
}

// Speed demon's custom ramp rows, including the Keep cursor color interaction.
{
  const on = panelRows({ speedDemon: true, speedDemonGradient: true });
  ok("custom heat stops render", named(on, "Stages (dark theme)") && named(on, "Stages (light theme)"));
  const keep = panelRows({ speedDemon: true, speedDemonNoCursorHeat: true });
  ok("Keep cursor color hides the custom ramp", !named(keep, "Custom gradient"));
}

// CRT rows. Inverted Trail was built and then removed; assert it is gone
// rather than dropping the check, so a half-finished revert can't sneak back.
{
  const on = panelRows({ crtEffect: true });
  ok("CRT sub-options render", named(on, "Glow") && named(on, "Signal glitch"));
  ok("Inverted Trail is gone", !named(on, "Inverted trail") && !named(on, "Inverted Trail"));
  ok("Inversion Strength is gone", !named(on, "Inversion strength") && !named(on, "Inversion Strength"));
  const off = panelRows({ crtEffect: false });
  ok("CRT off hides its sub-options", !named(off, "Signal glitch"));
}

// Flip was a Box-only row; with Text Crawl gone it must not reappear anywhere.
{
  for (const style of ["Box", "Line", "Underline"]) {
    const rows = panelRows({ cursorStyle: style, popEffects: true });
    ok(`"${style}" style renders cleanly`, !rows.threw && rows.length > 20,
       rows.threw && rows.threw.message);
  }
}

// The Box style's Letter color hangs off Show letter inside cursor, so that
// toggle has to refresh the panel when pressed - it used to save without a
// redraw, and the row it reveals stayed hidden until something else redrew.
{
  const rows = panelRows({ cursorStyle: "Box", showChar: false });
  ok("Letter color is hidden while the letter is", !named(rows, "Letter color"));
  const row = rows.find((r) => r.name === "Show letter inside cursor");
  const before = rows.length;
  row.toggles[0]._change(true);
  ok("pressing Show letter inside cursor refreshes the panel", rows.tab.refreshes === 1, rows.tab.refreshes);
  ok("...without rebuilding it", rows.length === before && rows.tab.updates === 0);
  ok("...and Letter color appears", named(rows, "Letter color"));
}

// Cursor color: one row carrying both swatches, not two labelled rows. Asserted
// on the control count as well as the name, since a row that lost a picker
// would still be named right.
{
  const rows = panelRows({ gradientEnabled: false });
  const color = rows.filter((r) => r.name === "Cursor color");
  ok("the flat cursor colors share one row", color.length === 1, rows.filter(r => /Cursor color/.test(r.name || "")).map(r => r.name));
  ok("that row carries both swatches", color[0] && color[0].controls.length === 2,
     color[0] && color[0].controls);
  ok("the old per-theme color rows are gone",
     !named(rows, "Cursor color (dark theme)") && !named(rows, "Cursor color (light theme)"));

  // Same helper builds the gradient rows, so a break in it shows up here too.
  const grad = panelRows({ gradientEnabled: true, gradientCount: 3 });
  const dark = grad.find((r) => r.name === "Colors (dark theme)");
  ok("gradient rows still carry one swatch per color", dark && dark.controls.length === 3,
     dark && dark.controls.length);
  ok("the flat color row is hidden while Gradient is on", !named(grad, "Cursor color"));
}

// Pop effects' Rainbow: last in the group, and only once there is something for
// it to recolour. The gate is on the four effects, NOT on popEffects - the
// group can be on with everything inside it off, and that is exactly the state
// where the toggle would recolour nothing.
{
  const allOff = panelRows({
    popEffects: true, popLetters: false, backspaceDisintegrate: false,
    thunderstrike: false, fireworks: false,
  });
  ok("Pop effects with nothing on hides Rainbow", !named(allOff, "Rainbow"));
  ok("...but the group's own effects are still offered",
     named(allOff, "Popping letters") && named(allOff, "Fireworks"));

  // Each of the four independently reveals it. backspaceDisintegrate is the one
  // that mattered: it saved without redrawing until Rainbow's visibility came
  // to depend on it, so switching it on would have left Rainbow unreachable
  // until some other row happened to redraw the panel.
  for (const key of ["popLetters", "backspaceDisintegrate", "thunderstrike", "fireworks"]) {
    const rows = panelRows({
      popEffects: true, popLetters: false, backspaceDisintegrate: false,
      thunderstrike: false, fireworks: false, [key]: true,
    });
    ok(`${key} alone reveals Rainbow`, named(rows, "Rainbow"));
  }

  // Order: it is a modifier across the group, so it reads as a summary at the
  // bottom rather than as another sibling effect at the top.
  const on = panelRows({
    popEffects: true, popLetters: true, backspaceDisintegrate: true,
    thunderstrike: true, fireworks: true,
  });
  const at = (n) => on.findIndex((r) => r.name === n);
  ok("Rainbow sits below all four effects",
     at("Rainbow") > at("Popping letters") && at("Rainbow") > at("Backspace disintegration") &&
     at("Rainbow") > at("Thunderstrike") && at("Rainbow") > at("Fireworks"),
     { rainbow: at("Rainbow"), fireworks: at("Fireworks") });
  // Its sub-options belong to their own effects, so it must not have swallowed
  // them on the way down.
  ok("the effects kept their own sub-options",
     named(on, "Bolt size") && named(on, "Quantity"));
  ok("the whole group still renders past Rainbow", named(on, "Pixel trail"));
}

// Torch Flicker, restored on the key that stayed in LOOK_KEYS while it was
// gone. Depth is conditional on the gate, like every other dial in the panel.
{
  const off = panelRows({ torchEffect: true, overlayFlicker: false });
  ok("Flicker is offered with the torch on", named(off, "Flicker"));
  ok("Flicker depth is hidden while Flicker is off", !named(off, "Flicker depth"));

  const on = panelRows({ torchEffect: true, overlayFlicker: true });
  ok("Flicker depth appears with Flicker on", named(on, "Flicker depth"));
  // The panel harness exists for exactly this: a row that throws while being
  // built silently removes itself and every row after it.
  ok("rows after Flicker still render", named(on, "Keep sidebars lit"));

  const noTorch = panelRows({ torchEffect: false });
  ok("no torch, no Flicker", !named(noTorch, "Flicker") && !named(noTorch, "Flicker depth"));
}

// Row names are sentence case (Obsidian's UI style, and its review's
// obsidianmd/ui/sentence-case rule): after the first word, only proper
// nouns and acronyms keep a capital.
{
  const wideOpen = {
    popEffects: true, popLetters: true, backspaceDisintegrate: true,
    thunderstrike: true, fireworks: true, flameTrail: true, flameTrailGravity: 0.5,
    stardustEnabled: true, stardustOrbit: true, bracketTether: true,
    smear: true, smearTaper: true, energyEffect: true, energyAurora: true, gradientEnabled: true,
    crtEffect: true, crtNeon: true, crtGlitch: true, speedDemon: true, speedDemonSparks: true,
    speedDemonGradient: true, hotHead: true, hotHeadFlat: true,
    torchEffect: true, overlayFlicker: true, overlayBlinkSync: true,
    blinkingEnabled: true, blinkBreathing: true, smoothEnabled: true,
    smoothAdaptive: true, cursorStyle: "Box", boxHollow: true, showChar: true,
  };
  const allowed = new Set(["CRT", "Vim", "Obsidian", "Obsidian's", "CUA", "I-beam", "Hot-head", "Speed", "Rainbow"]);
  const offenders = [];
  for (const r of panelRows(wideOpen)) {
    if (!r.name) continue;
    const words = r.name.split(/[\s/]+/).slice(1);
    for (const w of words) {
      const bare = w.replace(/[()]/g, "");
      if (/^[A-Z]/.test(bare) && !allowed.has(bare)) offenders.push(r.name);
    }
  }
  ok("every row name is sentence case", offenders.length === 0, [...new Set(offenders)]);
}

// Every slider carries a "restore default" button. Checked as a completeness
// rule over whatever the panel actually built rather than as a list of names,
// so a slider added later fails this until it has one too - the same shape as
// the _isAnimating() completeness check.
{
  // Settings chosen to open as many gated groups as possible, so the sweep
  // sees the conditional sliders and not just the always-visible ones.
  const wideOpen = {
    popEffects: true, popLetters: true, backspaceDisintegrate: true,
    thunderstrike: true, fireworks: true, flameTrail: true, flameTrailGravity: 0.5,
    stardustEnabled: true, stardustOrbit: true, bracketTether: true,
    smear: true, smearTaper: true, energyBeam: true, trailEnabled: true,
    crtEffect: true, crtGlitch: true, speedDemon: true, speedDemonSparks: true,
    torchEffect: true, overlayFlicker: true, overlayBlinkSync: true,
    blinkingEnabled: true, blinkBreathing: true, smoothEnabled: true,
    smoothAdaptive: true, cursorStyle: "Box", boxHollow: true,
  };
  const rows = panelRows(wideOpen);
  ok("the wide-open panel renders", !rows.threw, rows.threw && rows.threw.message);

  const sliderRows = rows.filter((r) => r.controls.includes("slider"));
  ok("the sweep actually found the sliders", sliderRows.length > 30, sliderRows.length);

  const naked = sliderRows.filter((r) => r.extras.length === 0).map((r) => r.name);
  ok("every slider row has a reset button", naked.length === 0, naked);

  const unlabelled = sliderRows
    .filter((r) => !r.extras.some((b) => b._icon && b._tooltip && typeof b._click === "function"))
    .map((r) => r.name);
  ok("...each with an icon, a tooltip and something to do", unlabelled.length === 0, unlabelled);

  // A toggle-only row must NOT have grown one: the button is a slider
  // affordance, and this is what catches a mis-scoped edit that stapled it
  // onto every row in the panel.
  const toggleOnly = rows.filter((r) => r.controls.length === 1 && r.controls[0] === "toggle");
  ok("toggles did not get one", toggleOnly.every((r) => r.extras.length === 0),
     toggleOnly.filter((r) => r.extras.length).map((r) => r.name));

  // No slider asks for the tooltip that 1.13 draws anyway (setDynamicTooltip
  // is deprecated there); the value shows inline.
  ok("no slider calls setDynamicTooltip", !/setDynamicTooltip/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "build", "test-bundle.js"), "utf8")));
}

// Pressing reset writes that slider's DEFAULT_SETTINGS value - not the
// `?? fallback` at the call site, and not some other row's key.
{
  const D = T.DEFAULT_SETTINGS;
  // Every slider starts somewhere other than its default, so a button that
  // wrote nothing at all would be indistinguishable from one that worked.
  const moved = {
    popEffects: true, thunderstrike: true, fireworks: true, flameTrail: true,
    blinkingEnabled: true, smoothEnabled: true, torchEffect: true,
    cursorStyle: "Line", caretWidthPx: 11, cursorOpacity: 0.35, blinkSpeed: 2.7,
    trailLength: 27, overlayRadius: 780, fireworksQuantity: 2.8,
  };
  const rows = panelRows(moved);
  // Presses a slider's reset and returns what it wrote, the row, and the
  // rows a rebuild would have appended (the harness's rows array is
  // append-only).
  const press = (name) => {
    const row = rows.find((r) => r.name === name && r.controls.includes("slider"));
    if (!row || !row.extras.length) return null;
    rows.writes.length = 0;
    const before = rows.length;
    row.extras[0]._click();
    return { w: rows.writes[0] || null, row, added: rows.slice(before) };
  };

  for (const [name, key] of [["Cursor thickness", "caretWidthPx"],
                             ["Cursor opacity", "cursorOpacity"],
                             ["Blink speed", "blinkSpeed"]]) {
    const { w, row, added } = press(name) || {};
    ok(`"${name}" resets its own key`, w && w.key === key, w);
    ok(`...to the default (${D[key]})`, w && w.value === D[key], w && w.value);
    // Not the cheaper `set` alone: a slider's handle is DOM state nothing
    // else updates, so the button moves the handle itself - and does NOT
    // rebuild the panel for it, which is what made every reset cost a
    // 60-80ms re-render.
    ok("...and moves the slider's own handle to it",
       row && row.sliders[0]._value === D[key], row && row.sliders[0]._value);
    ok("...without a rebuild", added.length === 0 && rows.tab.updates === 0, rows.tab.updates);
  }
  // A reset on a slider that gates other rows (Gravity reveals Gravity
  // direction) refreshes them too, through the slider's own onChange path.
  {
    const g = panelRows({ flameTrail: true, flameTrailGravity: 0.5 });
    ok("Gravity direction is offered while Gravity pulls", named(g, "Gravity direction"));
    const row = g.find((r) => r.name === "Gravity");
    row.extras[0]._click();
    ok("...and a reset of Gravity to 0 hides it again", !named(g, "Gravity direction") && g.tab.refreshes === 1,
       { refreshes: g.tab.refreshes });
  }

  // Sweep the rest: whatever key each button writes, it must write that key's
  // default, and it must be a key the defaults actually know about. A typo'd
  // key would otherwise write `undefined` and read as a working button.
  const sliderRows = rows.filter((r) => r.controls.includes("slider") && r.extras.length);
  const bad = [];
  for (const row of sliderRows) {
    rows.writes.length = 0;
    row.extras[0]._click();
    const w = rows.writes[0];
    if (!w || !(w.key in D) || w.value !== D[w.key] || w.value === undefined) {
      bad.push({ row: row.name, wrote: w });
    }
  }
  ok("every reset button writes a real default", bad.length === 0, bad);
}

// ---------------------------------------------------------------------------
section("settings panel: gates refresh visibility in place");

// Every row is built on every render; a row that depends on a gate carries a
// `visible` predicate. A gate's write calls the tab's refreshDomState(), and
// Obsidian re-asks every predicate and toggles a class per row - nothing is
// re-rendered, no element is replaced, focus and scroll stay where they are.
// A gate in one card that a row in ANOTHER card reads (Gradient in
// Appearance, Pixel trail's Gradient colors in Effects) needs no registry,
// because every predicate is re-asked. The one thing the predicates cannot
// express - how many colour pickers the gradient rows carry - is the one
// write that still rebuilds through update().
{
  const { sectionOf } = require("../panel_harness");
  const D = T.DEFAULT_SETTINGS;

  // Flip a toggle by name and return the rows a rebuild appended (none, for
  // a gate).
  const flip = (rows, name) => {
    const row = rows.find((r) => r.name === name && r.toggles.length);
    if (!row) return null;
    const before = rows.length;
    row.toggles[0]._change(!row.toggles[0]._value);
    return rows.slice(before);
  };

  // --- A gate refreshes the panel, once, without a rebuild ------------------
  {
    const rows = panelRows({ crtEffect: false });
    ok("CRT's sub-options are built even while it is off", rows.some((r) => r.name === "Trail length"));
    ok("...but hidden", !named(rows, "Trail length"));
    const n = rows.length;
    const added = flip(rows, "CRT effects");
    ok("flipping an Effects gate refreshes the panel", rows.tab.refreshes === 1, rows.tab.refreshes);
    ok("...and does not rebuild it", added && added.length === 0 && rows.tab.updates === 0 && rows.length === n,
       { added: added && added.length, updates: rows.tab.updates });
    ok("...with the toggle now on", rows.settings.crtEffect === true);
    ok("...revealing the gate's own sub-options", named(rows, "Trail length") && named(rows, "Signal glitch"));
    flip(rows, "CRT effects");
    ok("...and off hides them again", !named(rows, "Trail length") && rows.tab.refreshes === 2);
  }

  // --- A plain toggle does neither -----------------------------------------
  {
    const rows = panelRows({ cursorStyle: "Line" });
    const added = flip(rows, "Serifs");
    ok("a toggle that reveals nothing writes without a refresh or a rebuild",
       added && added.length === 0 && rows.tab.updates === 0 && rows.tab.refreshes === 0 && rows.settings.lineSerifs === true,
       { added: added && added.length, updates: rows.tab.updates, refreshes: rows.tab.refreshes });
  }

  // --- A gate another card reads --------------------------------------------
  {
    // Gradient lives in Appearance; three Effects rows show only with it on.
    const rows = panelRows({ gradientEnabled: false, flameTrail: true, energyEffect: true, crtEffect: true, crtNeon: true });
    // Since 1.5.6 a row that needs a setting from ANOTHER card stays visible
    // and is disabled with a hint, instead of vanishing: hidden, it read as a
    // missing option and was reported as one.
    const needs = (name) => { const r = rows.find((x) => x.name === name); return r && r.settingEl.classes.includes("cursor-smith-needs"); };
    const disabled = (name) => { const r = rows.find((x) => x.name === name); return r && r.components.every((c) => c._disabled === true); };
    ok("with Gradient off, the Effects rows that need it are shown",
       named(rows, "Gradient colors") && named(rows, "Aurora") && named(rows, "Gradient trail"));
    ok("...but disabled, with the hint", needs("Gradient colors") && needs("Aurora") && needs("Gradient trail")
       && disabled("Gradient colors") && disabled("Aurora") && disabled("Gradient trail"));
    const hint = rows.find((x) => x.name === "Aurora").descEl.querySelector(".cursor-smith-needs-hint");
    ok("...naming the setting and its card", hint && /Gradient, in Appearance/.test(hint.text) && hint.classes.includes("is-shown"), hint && hint.text);
    flip(rows, "Gradient");
    ok("flipping Gradient refreshes once", rows.tab.refreshes === 1 && rows.tab.updates === 0, rows.tab);
    ok("...and the rows come alive", !needs("Gradient colors") && !needs("Aurora") && !needs("Gradient trail")
       && !disabled("Gradient colors") && !disabled("Aurora"));
    ok("...with the hint gone", !hint.classes.includes("is-shown"));
    ok("...while the flat colour row goes", !named(rows, "Cursor color") && named(rows, "Colors (dark theme)"));
  }
  {
    // Blinking lives in Blinking; the torch's Sync with blink needs it.
    const rows = panelRows({ blinkingEnabled: false, torchEffect: true });
    const sync = rows.find((x) => x.name === "Sync with blink");
    ok("with Blinking off, the torch's Sync with blink is shown but disabled", sync && sync.visible && sync.settingEl.classes.includes("cursor-smith-needs"));
    flip(rows, "Blinking");
    ok("...and flipping Blinking enables it", !sync.settingEl.classes.includes("cursor-smith-needs") && rows.tab.refreshes === 1);
  }

  // --- The one structural write rebuilds ------------------------------------
  {
    const rows = panelRows({ gradientEnabled: true, gradientCount: 2 });
    const count = rows.find((r) => r.name === "Number of colors");
    const before = rows.length;
    count.dropdowns[0]._change("4");
    ok("the colour count writes a number", rows.settings.gradientCount === 4, rows.settings.gradientCount);
    ok("...and rebuilds the panel through update()", rows.tab.updates === 1 && rows.length > before, rows.tab.updates);
    const rebuilt = rows.slice(before).find((r) => r.name === "Colors (dark theme)");
    ok("...so the swatch rows carry the new count", rebuilt && rebuilt.controls.length === 4, rebuilt && rebuilt.controls);
  }

  // --- The gates are what the tests say they are ----------------------------
  {
    const rows = panelRows({});
    ok("every gate key is a real setting", [...rows.gates].every((k) => k in D),
       [...rows.gates].filter((k) => !(k in D)));
    ok("the two caller-built controls are gates too",
       rows.gates.has("cursorStyle") && rows.gates.has("torchEffect"));
    ok("Show letter inside cursor is a gate (it reveals Letter color)", rows.gates.has("showChar"));
    ok("the colour count is a gate", rows.gates.has("gradientCount"));
  }

  // --- Completeness: every key that changes what shows is a gate ------------
  // For every look key: flip it, build again, and see whether any row's
  // visibility changed. If it did, the key must be a gate - otherwise the
  // row it controls would stay stale after the press. And the other way
  // round: no key but the colour count may change the tree itself (names,
  // descriptions, controls), because nothing but update() would show that
  // change - a description that reads another setting is the bug this
  // catches. Run from two baselines so both directions are exercised.
  {
    const ALL_ON = {
      popEffects: true, popLetters: true, backspaceDisintegrate: true, thunderstrike: true,
      fireworks: true, flameTrail: true, energyEffect: true, energyAurora: true,
      crtEffect: true, crtNeon: true, crtGlitch: true, torchEffect: true,
      overlayBlinkSync: true, overlayFlicker: true, blinkingEnabled: true, blinkBreathing: true,
      smoothEnabled: true, smoothAdaptive: true, gradientEnabled: true, boxHollow: true,
      cursorTranslucent: true, hotHead: true, hotHeadFlat: true, speedDemon: true, speedDemonSparks: true,
      speedDemonGradient: true, stardustEnabled: true, stardustOrbit: true,
      bracketTether: true, lineSerifs: true, showChar: true, smear: true, smearTaper: true,
      popRainbow: true, glow: true, overlayIntensity: 0.5,
    };
    const ALL_OFF = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, typeof ALL_ON[k] === "number" ? 0 : false]));
    const shown = (rows) => rows.map((r) => sectionOf(r) + "|" + r.name + "=" + (r.visible ? 1 : 0)).join("\n");
    const tree = (rows) => rows.map((r) => sectionOf(r) + "|" + r.name + "=" + r.desc + "=" + r.controls.join(",")).join("\n");
    const flipped = (key, v) => {
      if (typeof v === "boolean") return !v;
      if (key === "cursorStyle") return v === "Box" ? "Line" : "Box";
      if (key === "gradientCount") return v === 4 ? 2 : 4;
      if (typeof v === "number") return v ? 0 : 0.5;
      return v;
    };
    const missing = [];
    const structural = [];
    for (const base of [ALL_ON, ALL_OFF]) {
      const rows = panelRows(base);
      const before = shown(rows), shape = tree(rows);
      for (const key of T.LOOK_KEYS) {
        const after = panelRows(Object.assign({}, base, { [key]: flipped(key, rows.settings[key]) }));
        if (before !== shown(after) && !rows.gates.has(key)) missing.push(key);
        if (shape !== tree(after) && key !== "gradientCount") structural.push(key);
      }
    }
    ok("every key that changes what shows is a gate", missing.length === 0, [...new Set(missing)]);
    ok("no key but the colour count changes the tree", structural.length === 0, [...new Set(structural)]);
    // And the check has teeth: it must be able to see a change at all.
    const rows = panelRows(ALL_OFF);
    const after = panelRows(Object.assign({}, ALL_OFF, { gradientEnabled: true }));
    ok("...and it does see the rows a gate changes", shown(rows) !== shown(after));
    ok("...and the rows the count changes", tree(panelRows({ gradientEnabled: true, gradientCount: 2 })) !== tree(panelRows({ gradientEnabled: true, gradientCount: 4 })));

    // The pressed gate lands the panel in the same state as a fresh render
    // from the new value: what refreshDomState() shows after the press is
    // what update() would have built.
    const same = [];
    let pressed = 0;
    for (const base of [ALL_ON, ALL_OFF]) {
      const names = panelRows(base).filter((r) => r.toggles.length).map((r) => r.name);
      for (const name of names) {
        const rows = panelRows(base);
        const row = rows.find((r) => r.name === name && r.toggles.length);
        rows.writes.length = 0;
        row.toggles[0]._change(!row.toggles[0]._value);
        const w = rows.writes[0];
        if (!w || !rows.gates.has(w.key)) continue;
        pressed++;
        const fresh = panelRows(Object.assign({}, base, { [w.key]: w.value }));
        if (shown(rows) !== shown(fresh)) same.push(name);
      }
    }
    ok("a pressed gate shows exactly what a fresh render would", same.length === 0, [...new Set(same)]);
    ok("...over every gating toggle in the panel", pressed > 40, pressed);
  }
}

// ---------------------------------------------------------------------------
section("settings panel: the rail, the summaries, the resets, the cards");

// The six changes of the 1.5.6 mockup, each asserted on what the harness
// renders: the Effects rail, the card summaries and resets, the dependency
// hints (above), the preset cards, the swatch labels, the preview strip.
{
  const { renderWholePanel, sectionOf, makeEl } = require("../panel_harness");
  const D = T.DEFAULT_SETTINGS;
  const flip = (rows, name) => { const row = rows.find((r) => r.name === name && r.toggles.length); row.toggles[0]._change(!row.toggles[0]._value); };

  // --- The rail on the Effects page --------------------------------------------
  // One chip per effect - its icon, a dot for "on" - and the picked effect's
  // rows under it: one effect on screen at a time, one back to the list.
  {
    const rows = panelRows({ popEffects: true, flameTrail: true, crtEffect: false, smear: true });
    const rail = rows.find((r) => r.settingEl.classes.includes("cursor-smith-rail-row"));
    ok("the Effects card opens with the rail", !!rail && sectionOf(rail) === "Effects" && rows.filter((r) => sectionOf(r) === "Effects")[0] === rail);
    const chips = rail.settingEl.querySelectorAll(".cursor-smith-chip");
    const chip = (name) => chips.find((c) => c.children.some((k) => k.text === name));
    ok("one chip per effect, plus All", chips.length === 12, chips.length);
    ok("every effect's chip carries its Lucide icon (Hot-head a flame, Speed demon a gauge, Typewriter a keyboard, the torch the candle)",
       chips.slice(0, 11).every((c) => c.querySelector(".cursor-smith-chip-icon") && c.querySelector(".cursor-smith-chip-icon").icon)
       && chip("Hot-head").querySelector(".cursor-smith-chip-icon").icon === "flame" && chip("Speed demon").querySelector(".cursor-smith-chip-icon").icon === "gauge"
       && chip("Typewriter").querySelector(".cursor-smith-chip-icon").icon === "keyboard"
       && chip("Torch spotlight").querySelector(".cursor-smith-chip-icon").icon === "cursor-smith-candle");
    ok("the picked chip is the rail's one Tab stop, and arrows move it", chips.filter((c) => c.attrs.tabindex === "0").length === 1 && chips.find((c) => c.attrs.tabindex === "0") === chips.find((c) => c.classes.includes("is-picked")) && (() => { const i = chips.findIndex((c) => c.attrs.tabindex === "0"); rail.settingEl.querySelector(".cursor-smith-rail").listeners.keydown({ key: "ArrowRight", target: chips[i], preventDefault() {} }); return chips[(i + 1) % chips.length].focused === true && chips[(i + 1) % chips.length].attrs.tabindex === "0"; })(), chips.map((c) => c.attrs.tabindex));
    ok("a chip marks the effects that are on", chip("Pop effects").classes.includes("is-on") && chip("Motion smear").classes.includes("is-on") && !chip("CRT effects").classes.includes("is-on"));
    ok("the harness sees every effect (its pick is All)", chip("All").classes.includes("is-picked") && named(rows, "Stiffness") && !named(rows, "Trail length"));
    chip("CRT effects").click();
    ok("clicking a chip picks it", rows.tab._effectsPick === "crtEffect" && rows.tab.refreshes === 1 && chip("CRT effects").classes.includes("is-picked") && !chip("All").classes.includes("is-picked"));
    ok("...shows the picked effect's own toggle", named(rows, "CRT effects"));
    ok("...hides the other effects' rows", !named(rows, "Stiffness") && !named(rows, "Pop effects") && !named(rows, "Pixel density"));
    ok("...and its sub-options follow its own gate", !named(rows, "Trail length"));
    flip(rows, "CRT effects");
    ok("switching the picked effect on reveals its options", named(rows, "Trail length") && named(rows, "Signal glitch"));
    ok("...and lights its chip", chip("CRT effects").classes.includes("is-on"));
    const allOff = { popEffects: false, flameTrail: false, stardustEnabled: false, bracketTether: false, smear: false, energyEffect: false, crtEffect: false, speedDemon: false, hotHead: false, torchEffect: false };
    const fresh = panelRows(Object.assign({}, allOff, { crtEffect: true }));
    fresh.tab._effectsPick = null;
    fresh.tab.refreshDomState();
    ok("with no pick, the first effect that is on is shown", named(fresh, "CRT effects") && named(fresh, "Trail length") && !named(fresh, "Pop effects"));
    const none = panelRows(allOff);
    none.tab._effectsPick = null;
    none.tab.refreshDomState();
    ok("...and with nothing on, the first effect", named(none, "Pop effects") && !named(none, "Pixel trail"));
    ok("the reset for all the effects is the page's last row", rows.filter((r) => sectionOf(r) === "Effects").pop().settingEl.classes.includes("cursor-smith-reset-row"));
    ok("no effect is a page of its own any more", !rows.pages || rows.pages.length === 0);
  }

  // --- The panel's pages ---------------------------------------------------------------
  // The categories are Obsidian's sub-pages too - the "Ribbon menu
  // configuration" kind of entry, on a phone as on a desktop - under a
  // header of Enable plugin and the mode switch. Each entry says what its
  // page is set to.
  {
    const lookNow = { cursorStyle: "Box", showChar: true, cursorTranslucent: true, blinkingEnabled: true, blinkSpeed: 1.0, blinkBreathing: true, smoothEnabled: false, popEffects: true, flameTrail: true, crtEffect: true, smear: false };
    const rows = renderWholePanel(Object.assign({}, lookNow, { userPresets: { One: T.pickLook(Object.assign({}, T.DEFAULT_SETTINGS, lookNow)) } }));
    const top = rows.pages;
    ok("the pages, in order (no Presets page: the presets are in the header)", top.map((p) => p.name).join() === "Behavior,Appearance,Blinking,Smooth movement,Effects", top.map((p) => p.name));
    ok("...each with an icon and a line", top.every((p) => p.icon && p.desc.length > 10), top.map((p) => [p.icon, p.desc]));
    const header = rows.filter((r) => sectionOf(r) === null && r.def.searchable !== false).map((r) => r.name).filter(Boolean);
    ok("the header holds Enable plugin, the Vim mode toggle and the presets, in that order (the notice aside)", header.join() === "Enable plugin,Vim mode,Presets", header);
    ok("the five other switches are on the General page", ["Note editor only", "Hide real cursor", "Hide cursor when unfocused", "Low power mode", "Respect reduced motion"].every((n) => rows.find((r) => r.name === n).page === "Behavior"));
    // Issue #31: "Enable on this device" heads the Behavior page - a rendered row
    // over Obsidian's per-device local storage, not a settings key, so the
    // synced settings never carry it.
    {
      const here = rows.find((r) => r.name === "Enable on this device");
      const behavior = rows.filter((r) => r.page === "Behavior").map((r) => r.name);
      ok("Enable on this device heads the Behavior page, before Note editor only", !!here && here.page === "Behavior" && behavior[0] === "Enable on this device" && behavior[1] === "Note editor only", behavior.slice(0, 3));
      ok("...an on/off switch for this device, its line saying so and never the word sync (read as a sync option on a tablet)", !!here && /this device only/.test(here.desc) && !/sync/i.test(here.desc), here && here.desc);
      ok("...as a rendered row, not a settings key", !!here && typeof here.def.render === "function" && !here.def.control);
      const calls = [];
      rows.plugin._deviceEnabled = false;
      rows.plugin.setDeviceEnabled = (v) => calls.push(v);
      let toggle = null;
      const setting = { addToggle: (cb) => { toggle = { value: null, setValue(v) { this.value = v; return this; }, onChange(fn) { this.fn = fn; return this; } }; cb(toggle); return setting; }, settingEl: rows.tab.containerEl.createDiv(), controlEl: rows.tab.containerEl.createDiv(), setClass() { return setting; }, setName() { return setting; }, setDesc() { return setting; } };
      here.def.render(setting);
      ok("...its toggle shows the device's own switch (off here)", !!toggle && toggle.value === false, toggle && toggle.value);
      toggle.fn(true);
      ok("...and flipping it calls setDeviceEnabled", calls.length === 1 && calls[0] === true, calls);
      rows.plugin._deviceEnabled = true;
    }
    ok("the look rows are on their pages", rows.find((r) => r.name === "Cursor style").page === "Appearance" && rows.find((r) => r.name === "Blink speed").page === "Blinking" && rows.find((r) => r.name === "Glide amount").page === "Smooth movement" && rows.find((r) => r.name === "Stiffness").page === "Effects");
    const value = (name) => rows.pages.find((p) => p.name === name).displayValue;
    ok("Appearance's entry says the style and the extras", value("Appearance") === "Box · translucent · letter inside", value("Appearance"));
    ok("Blinking's says On, the speed, breathing", value("Blinking") === "On · 1.0× · breathing", value("Blinking"));
    ok("Smooth movement's says Off", value("Smooth movement") === "Off");
    ok("Effects' names what is on", value("Effects") === "Pop effects · Pixel trail · CRT effects", value("Effects"));
    // A leading icon, written into the description, moves to the front of
    // the entry's info block once rendered; the block takes the grid class.
    {
      const entry = rows.tab.containerEl.createDiv({ cls: "setting-item mod-navigable" });
      const info = entry.createDiv({ cls: "setting-item-info" });
      info.createDiv({ cls: "setting-item-name", text: "Appearance" });
      const desc = info.createDiv({ cls: "setting-item-description" });
      const icon = desc.createSpan({ cls: "cursor-smith-page-icon" }); icon.icon = "palette";
      desc.appendText("Shape, color, opacity.");
      rows.tab.decorateIcons();
      ok("a page entry's icon moves out of the description to the front of the info block, which takes the grid class", info.children[0] === icon && info.classes.includes("cursor-smith-iconed") && !desc.children.includes(icon) && desc.text === "Shape, color, opacity.", info.children.map((c) => c.classes.join(".")));
      const before = info.children.length;
      rows.tab.decorateIcons();
      ok("...and a second pass has nothing to do", info.children.length === before && info.children[0] === icon);
      // Obsidian keeps the entry across update() and writes its description
      // again, a fresh icon in it: that one moves and last time's goes - it
      // stacked one icon per preset picked until 1.6.5.
      for (let i = 0; i < 3; i++) {
        const again = desc.createSpan({ cls: "cursor-smith-page-icon" }); again.icon = "palette";
        desc.children.unshift(desc.children.pop());
        rows.tab.decorateIcons();
      }
      const icons = info.children.filter((c) => c.classes.includes("cursor-smith-page-icon"));
      ok("a description written again with a fresh icon leaves ONE icon in front, not one per render", icons.length === 1 && info.children[0] === icons[0] && !desc.children.some((c) => c.classes.includes("cursor-smith-page-icon")), icons.length);
      // Obsidian 1.13 renders a sub-page's rows beside the tab's container,
      // not inside it: the pass covers the container's parent, and the
      // effect headings on the Effects page get their icons moved too.
      {
        const tabEl = rows.tab.containerEl;
        ok("with no parent yet the pass works from the container", rows.tab._decorateRoot() === tabEl);
        const parent = makeEl("div");
        parent.appendChild(tabEl);
        ok("...and from the parent once the container has one", rows.tab._decorateRoot() === parent);
        // A page showing: Obsidian detaches the container and renders the
        // page into the same holder; the remembered holder still serves.
        parent.children = parent.children.filter((c) => c !== tabEl); tabEl.parent = null;
        ok("...and still from that holder while the container is detached for a page", rows.tab._decorateRoot() === parent);
        parent.appendChild(tabEl);
        const page = parent.createDiv({ cls: "vertical-tab-content" });
        const row = page.createDiv({ cls: "setting-item" });
        const pinfo = row.createDiv({ cls: "setting-item-info" });
        pinfo.createDiv({ cls: "setting-item-name", text: "Pop effects" });
        const pdesc = pinfo.createDiv({ cls: "setting-item-description" });
        const picon = pdesc.createSpan({ cls: "cursor-smith-page-icon" }); picon.icon = "party-popper";
        pdesc.appendText("Letters, lightning and fireworks thrown off as you type.");
        rows.tab.decorateIcons();
        ok("an effect heading on a sub-page, rendered beside the tab's container, gets its icon moved too", pinfo.children[0] === picon && pinfo.classes.includes("cursor-smith-iconed") && !pdesc.children.includes(picon), pinfo.children.map((c) => c.classes.join(".")));
        parent.children = parent.children.filter((c) => c !== tabEl); tabEl.parent = null;
      }
      // The observer lives for the tab's life: hide() keeps it. Obsidian
      // 1.13 re-renders the kept definitions on reopen without asking for
      // them again, so an observer dropped here was never recreated, and
      // from the second opening on the icons sat in their descriptions.
      const obs = rows.tab._valueObserver;
      const spy = { disconnected: false, disconnect() { this.disconnected = true; } };
      rows.tab._valueObserver = spy;
      rows.tab.hide();
      ok("hiding the tab keeps the decorate observer for the next opening", rows.tab._valueObserver === spy && !spy.disconnected);
      rows.tab.watchEffectsValue();
      ok("...and asking to watch again makes no second one", rows.tab._valueObserver === spy);
      rows.tab._valueObserver = obs;
    }
    // ...and, once Obsidian has rendered the entry, wears their icons in
    // the value instead (displayValue is a string; the icons go in after).
    {
      const entry = rows.tab.containerEl.createDiv({ cls: "setting-item mod-navigable" });
      entry.createDiv({ cls: "setting-item-info" }).createDiv({ cls: "setting-item-name", text: "Effects" });
      const val = entry.createDiv({ cls: "setting-item-control" }).createDiv({ cls: "setting-item-value", text: "Pop effects · Pixel trail · CRT effects" });
      rows.tab.decorateEffectsValue();
      const icons = val.querySelectorAll(".cursor-smith-value-icon");
      ok("the Effects entry's value is one icon per effect that is on, in the rail's order, the names in its title", icons.map((i) => i.icon).join() === "party-popper,wind,circuit-board" && val.attrs.title === "Pop effects, Pixel trail, CRT effects" && val.text === undefined, icons.map((i) => i.icon));
      const n = icons.length;
      rows.tab.decorateEffectsValue();
      ok("...decorating again changes nothing", val.querySelectorAll(".cursor-smith-value-icon").length === n);
      val.empty(); val.setText("Pop effects · Pixel trail · CRT effects");
      rows.tab.decorateEffectsValue();
      ok("...and Obsidian rewriting the text gets the icons back", val.querySelectorAll(".cursor-smith-value-icon").length === n);
      // With nothing on it writes "Off" once and then leaves the value
      // alone (a rewrite on every call re-fired the observer forever).
      const none = renderWholePanel({ popEffects: false, flameTrail: false, crtEffect: false, smear: false, energyEffect: false, speedDemon: false, hotHead: false, stardustEnabled: false, bracketTether: false, torchEffect: false });
      const entry0 = none.tab.containerEl.createDiv({ cls: "setting-item" });
      entry0.createDiv({ cls: "setting-item-info" }).createDiv({ cls: "setting-item-name", text: "Effects" });
      const val0 = entry0.createDiv({ cls: "setting-item-control" }).createDiv({ cls: "setting-item-value", text: "Off" });
      let writes = 0; const emptyOnce = val0.empty; val0.empty = () => { writes++; emptyOnce(); };
      none.tab.decorateEffectsValue(); none.tab.decorateEffectsValue(); none.tab.decorateEffectsValue();
      ok("with nothing on the value is written 'Off' once and then left alone", val0.text === "Off" && writes === 1, writes);
    }
    ok("General's has no value", rows.pages.find((p) => p.name === "Behavior").displayValue === null);

    // The presets: a strip of thin cards in the header. One per saved
    // preset - a crawling-caret demo in its look, the name, a tick on the
    // one in use, its buttons - and two more, Save and Import.
    const strip = rows.find((r) => r.name === "Presets");
    ok("the presets are a strip in the header, after the mode switch", !!strip && sectionOf(strip) === null && strip.page === null && rows.indexOf(strip) > rows.findIndex((r) => r.name === "Mode"));
    const cards = strip.controlEl.querySelectorAll(".cursor-smith-pcard");
    const named_ = (n) => cards.find((c) => c.querySelector(".cursor-smith-pcard-name").text === n);
    ok("one card per preset, then Save and Import", cards.map((c) => c.querySelector(".cursor-smith-pcard-name").text).join() === "One,Save,Import", cards.map((c) => c.querySelector(".cursor-smith-pcard-name").text));
    // Valid markup: the card is a div; the demo, name and tick are one
    // button that uses the preset, the three actions its siblings.
    const useOf = (card) => card.querySelector(".cursor-smith-pcard-use");
    ok("a card is a div holding a button that uses the preset, pressed while it is the one in use", named_("One").tag === "div" && useOf(named_("One")).tag === "button" && /Use preset One/.test(useOf(named_("One")).attrs["aria-label"]) && useOf(named_("One")).attrs["aria-pressed"] === "true");
    ok("...the name and the demo inside that button, the actions beside it", !!useOf(named_("One")).querySelector(".cursor-smith-pcard-name") && !!useOf(named_("One")).querySelector(".cursor-smith-pcard-demo") && named_("One").querySelector(".cursor-smith-pcard-actions").parent === named_("One"));
    ok("...and its two buttons beside it: copy, delete", named_("One").querySelectorAll(".cursor-smith-pcard-action").map((b) => b.icon).join() === "copy,trash");
    ok("Save and Import are plain buttons", named_("Save").tag === "button" && named_("Import").tag === "button");
    ok("the Presets row wears the bookmark, as the page entries wear theirs", strip.icon === "bookmark", strip.icon);
    ok("an effect's head row wears the rail's icon; its sub-rows none", rows.find((r) => r.name === "Hot-head").icon === "flame" && rows.find((r) => r.name === "Motion smear").icon === "paintbrush" && rows.find((r) => r.name === "Stiffness").icon === null, [rows.find((r) => r.name === "Hot-head").icon, rows.find((r) => r.name === "Stiffness").icon]);
    ok("Save wears a floppy, Import a download arrow", named_("Save").querySelector(".cursor-smith-pcard-more-icon").icon === "save" && named_("Import").querySelector(".cursor-smith-pcard-more-icon").icon === "download");
    // ...on a line of their own: a full-width break sits between the last
    // preset and Save, so they never wrap along with the presets.
    {
      const kids = strip.controlEl.querySelector(".cursor-smith-presets").children;
      const i = kids.findIndex((k) => k.classes.includes("cursor-smith-pcard-break"));
      ok("a full-width break sits between the presets and Save, Import", i > 0 && kids[i + 1] === named_("Save") && kids[i + 2] === named_("Import") && kids.slice(0, i).every((k) => k.classes.includes("cursor-smith-pcard")), kids.map((k) => k.classes.join(".")));
    }
    ok("a translucent Box carries no letter copy (the real letter shows through it)", !named_("One").querySelector(".cursor-smith-pcard-caret-text"));
    ok("...with the caret demo over the preset's own name (still here: no requestAnimationFrame in the harness)", named_("One").querySelector(".cursor-smith-pcard-caret-box") && named_("One").querySelector(".cursor-smith-pcard-text").text === "One" && /translateX\(/.test(named_("One").querySelector(".cursor-smith-pcard-caret").style.transform), named_("One").querySelector(".cursor-smith-pcard-caret").style);
    const glide = renderWholePanel({ userPresets: { Glide: { cursorStyle: "Line", smoothEnabled: true, blinkingEnabled: true }, Ghosts: { crtEffect: true, trailLength: 4 } } });
    const cardOf = (n) => glide.find((r) => r.name === "Presets").controlEl.querySelectorAll(".cursor-smith-pcard").find((c) => c.querySelector(".cursor-smith-pcard-name").text === n);
    ok("...a Line caret carries no letter copy", !cardOf("Glide").querySelector(".cursor-smith-pcard-caret-text") && cardOf("Glide").querySelector(".cursor-smith-pcard-caret-line"));
    ok("a Box caret carries the name again, clipped inside it, in a color that reads on the box", cardOf("Ghosts").querySelector(".cursor-smith-pcard-caret-text").text === "Ghosts" && /^(#|rgb)/.test(cardOf("Ghosts").querySelector(".cursor-smith-pcard-caret-text").style.color), cardOf("Ghosts").querySelector(".cursor-smith-pcard-caret-text").style);
    ok("...a CRT preset's demo has its ghosts, as many as its trail length", cardOf("Ghosts").querySelectorAll(".cursor-smith-pcard-ghost").length === 4 && cardOf("Glide").querySelectorAll(".cursor-smith-pcard-ghost").length === 0);
    // The demo's motion is a pure step, driven by the preset's numbers.
    {
      const S = T.demoStep, init = T.demoInitialState;
      // 10 ms frames, so a 170 ms keystroke lands on a frame exactly.
      const K = 170, HOLD = 650;
      const run = (look, n, ms, dt = 10) => { const s = init(0); let now = 0; while (now < ms) { now += dt; S(s, look, n, dt, now); } return s; };
      const snap = run({ smoothEnabled: false }, 3, K * 2 + 10);
      ok("a stepping preset types a letter every 170 ms and sits on it", snap.target === 2 && snap.lead === 2 && snap.trail === 2, snap);
      const mid = init(0); let now = 0; for (let i = 0; i < 17; i++) { now += 16; S(mid, { smoothEnabled: true, catchUpSpeed: 0.5, smoothness: 0.15 }, 3, 16, now); }
      ok("a smooth preset glides: just after a keystroke the caret is between letters", mid.target === 1 && mid.lead > 0 && mid.lead < 1, mid.lead);
      const smear = init(0); now = 0; for (let i = 0; i < 17; i++) { now += 16; S(smear, { smear: true, smearStiffness: 0.6, smearTrailingStiffness: 0.4 }, 3, 16, now); }
      ok("a smearing preset stretches: the trailing edge lags the leading one on a move", smear.lead > smear.trail && smear.trail >= 0, [smear.lead, smear.trail]);
      const settled = run({ smear: true }, 3, K * 4 + 500);
      ok("...and snaps back once arrived (in the pause at the end)", settled.phase === "holdEnd" && Math.abs(settled.lead - settled.trail) < 0.05 && Math.abs(settled.lead - settled.target) < 0.05, [settled.lead, settled.trail, settled.phase]);
      const end = run({}, 3, K * 4 + 10);
      ok("at the end of the name it pauses", end.target === 3 && end.phase === "holdEnd", end.phase);
      const back = run({}, 3, K * 4 + HOLD + 20);
      ok("...then jumps back to the start and pauses again", back.target === 0 && back.lead === 0 && back.phase === "holdStart", back);
      const crt = run({ crtEffect: true, trailLength: 3, trailFadeMs: 5000 }, 5, K * 5 + 10);
      ok("CRT leaves a ghost per keystroke, up to the trail length", crt.ghosts.length === 3 && crt.ghosts.every((g) => typeof g.at === "number"), crt.ghosts.length);
      const hot = run({ speedDemon: true }, 8, K * 8);
      ok("Speed demon heats up while typing", hot.heat > 0.4, hot.heat);
      const blink = T.demoBlinkAlpha;
      const fresh = init(1000);
      ok("a blinking preset holds the caret lit right after a keystroke when it doesn't blink while typing, and blinks otherwise", blink(fresh, { blinkingEnabled: true, smoothStopBlinking: true, blinkSpeed: 1 }, 1100) === 1 && blink(fresh, { blinkingEnabled: false }, 5000) === 1 && [0, 300, 600, 900, 1200, 1500, 1800].some((dt) => blink(fresh, { blinkingEnabled: true, smoothStopBlinking: false, blinkSpeed: 1 }, 5000 + dt) < 0.5));
      ok("the card in use plays two passes over its name, then rests one space past it; the others sit there still", T.DEMO_CYCLES === 2 && T.demoIdleAt(3) === 4 && String(cardOf("Glide").querySelector(".cursor-smith-pcard-caret").style.transform) === "translateX(48.00px)" && String(named_("One").querySelector(".cursor-smith-pcard-caret").style.transform) === "translateX(0.00px)" && /demos[.]add[(][^;]*isActive[)]/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "settings-tab.ts"), "utf8")), [cardOf("Glide").querySelector(".cursor-smith-pcard-caret").style.transform, named_("One").querySelector(".cursor-smith-pcard-caret").style.transform]);
      const frozen = init(0); frozen.target = 4; for (let k = 0; k < 40; k++) S(frozen, { smoothEnabled: true }, 3, 10, k * 10, true);
      ok("a frozen step runs the springs only: it settles on the target and never types", Math.abs(frozen.lead - 4) < 0.01 && frozen.phase === "type" && frozen.target === 4, frozen);
      // The Appearance page, as the engine reads it.
      const sh = T.demoShapeOf;
      const box = sh({ cursorStyle: "Box" }, "#112233", ["#ff0000", "#00ff00"], 8);
      ok("a flat Box: its color, no gradient, a letter's width, square", box.fill === "#112233" && box.gradient === null && box.thick === 7 && box.radius === 0 && box.hollowWidth === 0 && box.alphaScale === 1, box);
      const grad = sh({ cursorStyle: "Box", gradientEnabled: true }, "#112233", ["#ff0000", "#00ff00", "#0000ff"], 8);
      ok("Gradient on: a top-to-bottom CSS gradient through the stops, the first stop as the flat fallback", grad.gradient === "linear-gradient(180deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)" && grad.fill === "#ff0000", grad.gradient);
      ok("...left to right on an Underline", /^linear-gradient\(90deg/.test(sh({ cursorStyle: "Underline", gradientEnabled: true }, "#112233", ["#ff0000", "#00ff00"], 8).gradient));
      const hollow = sh({ cursorStyle: "Box", boxHollow: true, boxHollowWidth: 2, showChar: true }, "#112233", [], 8);
      ok("Hollow: an outline of the setting's width (scaled), no fill", hollow.hollowWidth === 2, hollow.hollowWidth);
      const line = sh({ cursorStyle: "Line", caretWidthPx: 4, lineSerifs: true, cursorRounded: true }, "#112233", [], 8);
      ok("a Line: thickness from the setting (scaled), serifs, and a full half-round when rounded", line.thick === 3 && line.serifs === true && line.radius === 1.5, line);
      const under = sh({ cursorStyle: "Underline", underlineWidthPx: 4 }, "#112233", [], 8);
      ok("an Underline: its own thickness (scaled), 2px when automatic", under.thick === 3 && sh({ cursorStyle: "Underline" }, "#112233", [], 8).thick === 2, under.thick);
      const soft = sh({ cursorStyle: "Box", cursorRounded: true, cursorTranslucent: true, cursorOpacity: 0.5 }, "#112233", [], 8);
      ok("a rounded Box takes the engine's ratio; translucency and opacity multiply into the alpha", soft.radius === 1.75 && Math.abs(soft.alphaScale - 0.475) < 1e-9, soft);
      const tinted = renderWholePanel({ userPresets: { Tint: { cursorStyle: "Box", glyphColorMode: "tinted", colorDark: "#3182ed" }, Hollow: { cursorStyle: "Box", boxHollow: true }, Serif: { cursorStyle: "Line", lineSerifs: true } } });
      const cardT = (n) => tinted.find((r) => r.name === "Presets").controlEl.querySelectorAll(".cursor-smith-pcard").find((c) => c.querySelector(".cursor-smith-pcard-name").text === n);
      ok("the letter inside takes the color mode; a hollow box shows the real letter instead; a serif Line is marked", /rgb|#/.test(cardT("Tint").querySelector(".cursor-smith-pcard-caret-text").style.color) && !cardT("Hollow").querySelector(".cursor-smith-pcard-caret-text") && cardT("Hollow").querySelector(".cursor-smith-pcard-caret").style.border === "2px solid #7f7f7f".replace("#7f7f7f", cardT("Hollow").querySelector(".cursor-smith-pcard-caret").style.border.split("solid ")[1]) && cardT("Serif").querySelector(".cursor-smith-pcard-caret").classes.includes("is-serif"), cardT("Hollow").querySelector(".cursor-smith-pcard-caret").style);
      ok("heat warms the color through the stops and leaves it alone when cold", T.demoHeatColor("#000000", ["#ff0000", "#00ff00", "#0000ff", "#ffffff"], 0) === "#000000" && T.demoHeatColor("#000000", ["#ff0000", "#00ff00", "#0000ff", "#ffffff"], 1).toLowerCase() === "#ffffff" && T.demoHeatColor("#000000", ["#ff0000", "#00ff00", "#0000ff", "#ffffff"], 0.25).toLowerCase() === "#ff0000" && T.demoHeatColor("#000000", ["#ff8c28", "#ff461e", "#fff0c8"], 1).toLowerCase() === "#fff0c8");
    }
    ok("...ticked at the left while it is the look in use", !!named_("One").querySelector(".cursor-smith-tick") && useOf(named_("One")).children[0].classes.includes("cursor-smith-tick") && named_("One").classes.includes("is-active"));
    rows.plugin.loadUserPreset = async (name) => { rows.plugin.loaded = name; };
    useOf(named_("One")).click();
    later(async () => {
      await new Promise((r) => setTimeout(r, 0));
      ok("tapping a card loads that preset", rows.plugin.loaded === "One", rows.plugin.loaded);
    });
    // Which preset is in use is read off the look, not off a remembered
    // name: the look that IS a saved preset is ticked after a reload too,
    // and an edit unticks it.
    const same = Object.assign({}, T.DEFAULT_SETTINGS, { cursorStyle: "Line", colorDark: "#123456" });
    const inUse = renderWholePanel({ cursorStyle: "Line", colorDark: "#123456", userPresets: { Mine: T.pickLook(same) } });
    const pc = (rows_, n) => rows_.find((r) => r.name === "Presets").controlEl.querySelectorAll(".cursor-smith-pcard").find((c) => c.querySelector(".cursor-smith-pcard-name").text === n);
    ok("a look that equals a saved preset is ticked", !!pc(inUse, "Mine").querySelector(".cursor-smith-tick") && pc(inUse, "Mine").querySelector(".cursor-smith-pcard-caret").style.backgroundColor === "#123456");
    const edited = renderWholePanel({ cursorStyle: "Line", colorDark: "#654321", userPresets: { Mine: T.pickLook(same) } });
    ok("...and an edited look is not", !pc(edited, "Mine").querySelector(".cursor-smith-tick"));
    // Delete is two taps: the first arms the trash, the second deletes.
    // (Both taps here and now: the arm lasts three seconds of wall clock,
    // and the deferred checks run after the whole file.)
    const del = renderWholePanel({ userPresets: { Gone: { cursorStyle: "Line" } } });
    del.plugin.deleteUserPreset = async (n) => { del.plugin.deleted = n; };
    const trashOf = (rows_, n) => pc(rows_, n).querySelectorAll(".cursor-smith-pcard-action").find((b) => b.icon === "trash" || b.classes.includes("is-armed"));
    trashOf(del, "Gone").click();
    const armed = trashOf(del, "Gone");
    ok("one tap on the trash arms it - 'Delete?' - and deletes nothing", del.plugin.deleted === undefined && armed.classes.includes("is-armed") && armed.text === "Delete?" && /again/.test(armed.attrs["aria-label"]), JSON.stringify({ deleted: del.plugin.deleted, classes: armed.classes, attrs: armed.attrs, text: armed.text }));
    armed.click();
    later(async () => {
      await new Promise((r) => setTimeout(r, 0));
      ok("...the second tap deletes and rebuilds", del.plugin.deleted === "Gone" && del.tab.updates > 0, del.plugin.deleted);
    });
    const none = renderWholePanel({});
    ok("with nothing saved the strip is Save and Import alone", none.find((r) => r.name === "Presets").controlEl.querySelectorAll(".cursor-smith-pcard").length === 2);
    ok("...and the row has no description, with or without presets", none.find((r) => r.name === "Presets").desc === "" && rows.find((r) => r.name === "Presets").desc === "", rows.find((r) => r.name === "Presets").desc);
    // Save opens a prompt; a name saves and rebuilds.
    const { Modal } = T;
    none.plugin.saveUserPreset = async (name) => { none.plugin.savedAs = name; };
    pc(none, "Save").click();
    const prompt = Modal.last;
    ok("Save opens a prompt for the name", prompt && prompt.opened && /Save this look as/.test(prompt.title), prompt && prompt.title);
    prompt.field.value = "  Fresh ";
    later(async () => {
      prompt.contentEl.querySelector(".mod-cta").click();
      await new Promise((r) => setTimeout(r, 0));
      ok("...and OK saves the trimmed name and closes", none.plugin.savedAs === "Fresh" && prompt.opened === false, none.plugin.savedAs);
    });
    // A taken name warns once; OK again replaces.
    const taken = renderWholePanel({ userPresets: { Mine: { cursorStyle: "Line" } } });
    taken.plugin.saveUserPreset = async (name) => { taken.plugin.savedAs = name; };
    pc(taken, "Save").click();
    const tp = Modal.last;
    tp.field.value = "Mine";
    later(async () => {
      tp.contentEl.querySelector(".mod-cta").click();
      await new Promise((r) => setTimeout(r, 0));
      ok("saving under a taken name warns and keeps the prompt", taken.plugin.savedAs === undefined && tp.opened && /Mine exists\. OK again/.test(tp.contentEl.querySelector(".cursor-smith-prompt-note").text), tp.contentEl.querySelector(".cursor-smith-prompt-note").text);
      tp.contentEl.querySelector(".mod-cta").click();
      await new Promise((r) => setTimeout(r, 0));
      ok("...and OK again replaces it", taken.plugin.savedAs === "Mine" && tp.opened === false, taken.plugin.savedAs);
    });

    // Vim mode: a Vim page with a warning while Obsidian's Vim is off, the
    // Vim presets on the Presets page, and the mode row at the top of every
    // look page.
    const modes = Object.fromEntries(["normal", "insert", "visual", "replace", "command"].map((m) => [m, Object.assign({}, T.DEFAULT_SETTINGS)]));
    const vim = renderWholePanel({ uiMode: "vim", vimModeEnabled: true, vimStatusBar: true, vimModes: modes, vimPresets: { Setup: modes }, vimActivePreset: "Setup" });
    const vtop = vim.pages;
    ok("Vim mode adds a Vim page", vtop.map((p) => p.name).join() === "Behavior,Vim,Appearance,Blinking,Smooth movement,Effects", vtop.map((p) => p.name));
    ok("...flagged while Obsidian's Vim key bindings are off", vim.pages.find((p) => p.name === "Vim").status === "warning");
    ok("...holding the Vim switches", vim.find((r) => r.name === "Control Obsidian's Vim key bindings").page === "Vim");
    ok("Vim mode adds no Presets page either", !vim.pages.some((p) => p.name === "Presets"));
    // The alert under the mode switch: the wording for a plugin that drives
    // Obsidian's Vim key bindings (the default), with the way back.
    const alerts = vim.filter((r) => r.settingEl.classes.includes("cursor-smith-alert"));
    // Three states, one place. The fixture's Obsidian says its bindings
    // are off (getConfig false) and the plugin drives them (the default):
    // the transient "look off" wording.
    ok("Vim mode shows a tiny alert in the header, between the toggle and the mode tabs, with no button of its own", alerts.length === 3 && alerts.map((a) => a.visible).join() === "false,true,false" && sectionOf(alerts[1]) === null && /look off/.test(alerts[1].desc) && alerts[1].buttons.length === 0 && vim.indexOf(alerts[1]) < vim.findIndex((r) => r.name === "Mode") && vim.indexOf(alerts[1]) > vim.findIndex((r) => r.name === "Vim mode") && alerts[1].settingEl.children[0].classes.includes("cursor-smith-alert-icon"), alerts.map((a) => a.visible));
    vim.plugin.app.vault.getConfig = () => true;
    vim.tab.refreshDomState();
    ok("...with the bindings on, the wording for the CUA user who flipped it", alerts.map((a) => a.visible).join() === "true,false,false" && /uses Vim key bindings. Not a Vim user?/.test(alerts[0].desc), alerts.map((a) => a.visible));
    const noDrive = renderWholePanel({ uiMode: "vim", vimModeEnabled: true, vimControlObsidian: false, vimModes: modes });
    const na = noDrive.filter((r) => r.settingEl.classes.includes("cursor-smith-alert"));
    ok("without the plugin driving them, the alert says the bindings are needed", na.map((a) => a.visible).join() === "false,false,true" && /Settings → Editor/.test(na[2].desc), na.map((a) => a.visible));
    noDrive.plugin.app.vault.getConfig = () => true;
    noDrive.tab.refreshDomState();
    ok("...and with them on, no alert at all", na.every((a) => a.visible === false));
    alerts[1].def.render({ settingEl: alerts[1].settingEl, controlEl: alerts[1].controlEl, descEl: alerts[1].descEl, addButton() { return this; } });
    ok("rendering the alert again (update keeps the row's element) leaves one icon, not two", alerts[1].settingEl.querySelectorAll(".cursor-smith-alert-icon").length === 1, alerts[1].settingEl.querySelectorAll(".cursor-smith-alert-icon").length);
    ok("the Vim page has no note of its own about the bindings (the header says it once)", !vim.some((r) => r.page === "Vim" && /Vim key bindings/.test(r.desc) && !r.name), vim.filter((r) => r.page === "Vim" && !r.name).map((r) => r.desc));
    ok("...its strip carries the Vim presets, ticked by the active name", !!pc(vim, "Setup") && !!pc(vim, "Setup").querySelector(".cursor-smith-tick"), vim.find((r) => r.name === "Presets").controlEl.querySelectorAll(".cursor-smith-pcard").map((c) => c.querySelector(".cursor-smith-pcard-name").text));
    ok("the mode row sits in the header, above the pages, not inside any", vim.find((r) => r.name === "Vim mode").page === null && sectionOf(vim.find((r) => r.name === "Vim mode")) === null && !vim.some((r) => r.name === "Vim mode" && r.page));
    ok("...after the Vim mode toggle", vim.findIndex((r) => r.name === "Vim mode") < vim.findIndex((r) => r.name === "Mode"));
    ok("...and in Vim mode the presets come before the mode tabs (a preset is all five modes)", vim.findIndex((r) => r.name === "Presets") < vim.findIndex((r) => r.name === "Mode"));
    ok("the Mode row wears an icon and no words", vim.find((r) => r.name === "Mode").icon === "layers" && vim.find((r) => r.name === "Mode").desc === "", vim.find((r) => r.name === "Mode").icon);
    // Arrow keys along the tabs: the picked one is the Tab stop, Right/Left
    // move it (and focus), Home/End jump.
    const tabRow = vim.find((r) => r.name === "Mode").controlEl.children[0];
    const tabs = tabRow.children;
    ok("the picked tab is the row's one Tab stop", tabs.map((b) => b.attrs.tabindex).join() === "0,-1,-1,-1,-1", tabs.map((b) => b.attrs.tabindex));
    tabRow.listeners.keydown({ key: "ArrowRight", target: tabs[0], preventDefault() {} });
    ok("Right moves focus and the Tab stop to the next tab", tabs[1].focused === true && tabs.map((b) => b.attrs.tabindex).join() === "-1,0,-1,-1,-1");
    tabRow.listeners.keydown({ key: "ArrowLeft", target: tabs[0], preventDefault() {} });
    ok("...Left from the first wraps to the last", tabs[4].focused === true && tabs[4].attrs.tabindex === "0");
    tabRow.listeners.keydown({ key: "Home", target: tabs[4], preventDefault() {} });
    ok("...Home goes to the first", tabs[0].attrs.tabindex === "0");
    let stray = false;
    tabRow.listeners.keydown({ key: "ArrowRight", target: tabRow, preventDefault() { stray = true; } });
    ok("...a key from outside the pills is left alone", stray === false);
  }

  // --- The resets --------------------------------------------------------------
  {
    const rows = panelRows({ blinkSpeed: 2.5, blinkBreathing: true, blinkingEnabled: true });
    const resetRow = (card) => rows.find((r) => sectionOf(r) === card && r.settingEl.classes.includes("cursor-smith-reset-row"));
    ok("every tab ends with its reset", ["Appearance", "Blinking", "Smooth movement", "Effects"].every((c) => !!resetRow(c)));
    const link = resetRow("Blinking").controlEl.querySelector(".cursor-smith-reset-link");
    ok("...a link naming the tab", link && /Reset Blinking to defaults/.test(link.children.map((c) => c.text).join("")), link && link.children.map((c) => c.text));
    ok("...that is the last row of its tab", rows.filter((r) => sectionOf(r) === "Blinking").pop() === resetRow("Blinking"));
    rows.writes.length = 0;
    link.click();
    later(async () => {
      await new Promise((r) => setTimeout(r, 0));
      const wrote = Object.fromEntries(rows.writes.map((w) => [w.key, w.value]));
      ok("pressing it writes the card's keys back to their defaults", wrote.blinkSpeed === D.blinkSpeed && wrote.blinkBreathing === D.blinkBreathing && wrote.blinkingEnabled === D.blinkingEnabled, wrote);
      ok("...every key the card's rows own, and no other card's", rows.cardKeys.Blinking.every((k) => k in wrote) && !("smoothness" in wrote) && !("cursorStyle" in wrote), Object.keys(wrote));
      ok("...and rebuilds the panel", rows.tab.updates === 1, rows.tab.updates);
    });
    // Every look key belongs to exactly one card, so nothing is left out of
    // a reset and nothing is reset twice.
    const owned = Object.values(rows.cardKeys).flat();
    const missing = T.LOOK_KEYS.filter((k) => !owned.includes(k));
    const twice = owned.filter((k, i) => owned.indexOf(k) !== i);
    ok("every look key is owned by a card", missing.length === 0, missing);
    ok("...by one card only", twice.length === 0, twice);
  }

  // --- The swatch labels --------------------------------------------------------
  {
    const rows = panelRows({ gradientEnabled: false });
    const color = rows.find((r) => r.name === "Cursor color");
    const labels = color.controlEl.querySelectorAll(".cursor-smith-swatch-label").map((l) => l.text);
    ok("the colour swatches are labelled", labels.join() === "Dark,Light", labels);
    ok("...each in its own cell with its picker", color.controlEl.querySelectorAll(".cursor-smith-swatch-cell").every((c) => c.children.some((k) => k.tag === "input")));
    const grad = panelRows({ gradientEnabled: true, gradientCount: 3 });
    const dark = grad.find((r) => r.name === "Colors (dark theme)");
    ok("gradient stops are numbered", dark.controlEl.querySelectorAll(".cursor-smith-swatch-label").map((l) => l.text).join() === "1,2,3");
  }

}

// ---------------------------------------------------------------------------
section("settings panel: the two callers and their hooks");

// renderPanel enters at lookDefinitions with the caller's hooks stubbed out,
// so the Cursor style dropdown and the Torch toggle - built by each caller,
// each handed a `rerender` - had no coverage at all, and neither did where
// each caller's `set` writes. The only way to see that is to drive the
// caller whole.
{
  const { renderNormal, renderVimMode, sectionOf } = require("../panel_harness");
  const sectionsOf = (list) => [...new Set(list.map(sectionOf))];
  const press = (rows, name, kind, value) => {
    const row = rows.find((r) => r.name === name && r[kind].length);
    if (!row) return null;
    const before = rows.length;
    row[kind][0]._change(value);
    return rows.slice(before);
  };

  // --- The global panel ---------------------------------------------------
  {
    let rows;
    let threw = null;
    try { rows = renderNormal({ enabled: true, cursorStyle: "Box", torchEffect: false }); }
    catch (e) { threw = e; }
    ok("normalDefinitions builds", !threw, threw && threw.message);
    ok("...the four look cards (the presets live in the header)",
       sectionsOf(rows).filter((s) => s !== null).join() === "Appearance,Blinking,Smooth movement,Effects", sectionsOf(rows));

    // Cursor style: writes to plugin.settings, restarts the engine, and
    // refreshes the panel so the new style's sub-options appear.
    ok("the Line style's rows are hidden under Box", !named(rows, "Cursor thickness"));
    const added = press(rows, "Cursor style", "dropdowns", "Line");
    ok("Cursor style writes the global setting", rows.settings.cursorStyle === "Line", rows.settings.cursorStyle);
    ok("...and restarts the engine", rows.plugin.enabled.includes("enable"), rows.plugin.enabled);
    ok("...and refreshes the panel, no rebuild", added && added.length === 0 && rows.tab.refreshes === 1 && rows.tab.updates === 0,
       { refreshes: rows.tab.refreshes, updates: rows.tab.updates });
    ok("...so the Line style's own rows appear", named(rows, "Cursor thickness") && named(rows, "Serifs"));

    // Torch: writes, starts the overlay, refreshes.
    const torch = press(rows, "Torch spotlight", "toggles", true);
    ok("Torch spotlight writes the global setting", rows.settings.torchEffect === true);
    ok("...and starts the torch engine", rows.plugin.enabled.includes("torch-on"), rows.plugin.enabled);
    ok("...and refreshes the panel", torch && torch.length === 0 && rows.tab.refreshes === 2, rows.tab.refreshes);
    ok("...so the torch's own rows appear", named(rows, "Light size") && named(rows, "Spotlight"),
       rows.filter((r) => r.visible).map((r) => r.name).slice(-8));
    const off = press(rows, "Torch spotlight", "toggles", false);
    ok("...and off stops it again", rows.settings.torchEffect === false && rows.plugin.enabled.includes("torch-off") && off.length === 0);
    ok("...and hides them", !named(rows, "Light size") && !named(rows, "Spotlight") && rows.tab.refreshes === 3);

    // With the plugin disabled the overlay is not started, but the panel
    // still responds.
    const idle = renderNormal({ enabled: false, torchEffect: false });
    press(idle, "Torch spotlight", "toggles", true);
    ok("with the plugin off, Torch saves and refreshes without touching the engine",
       idle.settings.torchEffect === true && idle.plugin.enabled.length === 0 && idle.tab.refreshes === 1,
       idle.plugin.enabled);
  }

  // --- One Vim mode's panel -----------------------------------------------
  {
    const target = { cursorStyle: "Box", torchEffect: false };
    let edits = 0;
    let rows;
    let threw = null;
    try { rows = renderVimMode({}, target, () => edits++); }
    catch (e) { threw = e; }
    ok("modeDefinitions builds", !threw, threw && threw.message);
    ok("...the four look cards and no Presets",
       sectionsOf(rows).filter((s) => s !== null).join() === "Appearance,Blinking,Smooth movement,Effects", sectionsOf(rows));

    const added = press(rows, "Cursor style", "dropdowns", "Underline");
    ok("Cursor style writes the mode's snapshot, not the global settings",
       target.cursorStyle === "Underline" && rows.settings.cursorStyle === "Box",
       [target.cursorStyle, rows.settings.cursorStyle]);
    ok("...and reports the edit (the Vim panel clears the active preset on it)", edits === 1, edits);
    ok("...and refreshes the panel", added && added.length === 0 && rows.tab.refreshes === 1, rows.tab.refreshes);
    ok("...so the Underline style's own row appears", named(rows, "Underline thickness"));
    ok("...without restarting the engine (a mode has no engine of its own)", rows.plugin.enabled.length === 0);

    const torch = press(rows, "Torch spotlight", "toggles", true);
    ok("Torch spotlight writes the snapshot", target.torchEffect === true && rows.settings.torchEffect === false);
    ok("...reports the edit", edits === 2, edits);
    ok("...and refreshes the panel", torch && torch.length === 0 && rows.tab.refreshes === 2);
    ok("...so the torch's rows appear", named(rows, "Light size"));
    ok("...without touching the torch engine", rows.plugin.enabled.length === 0);

    // A gated toggle inside the shared builder writes to the snapshot too.
    const g = press(rows, "Gradient", "toggles", true);
    ok("a shared gate writes the snapshot", target.gradientEnabled === true && rows.settings.gradientEnabled === false);
    ok("...reports the edit", edits === 3, edits);
    ok("...and refreshes the panel", g && g.length === 0 && rows.tab.refreshes === 3);
  }
}

// ---------------------------------------------------------------------------
section("settings panel: the whole tree");

// getSettingDefinitions() is what Obsidian renders and indexes. The first
// card carries the plugin's name and version, the notice and the global
// switches; the mode switch picks which panel follows.
{
  const { renderWholePanel, sectionOf, makeEl } = require("../panel_harness");
  const build = (settings, opts) => {
    try { return renderWholePanel(settings, opts); } catch (e) { return { threw: e }; }
  };

  const cua = build({});
  ok("the whole CUA panel renders", !cua.threw, cua.threw && cua.threw.message);
  const sections = [...new Set(cua.map(sectionOf))];
  ok("the header has no heading of its own",
     sections[0] === null, sections[0]);
  const foot = cua[cua.length - 1];
  ok("the version is a muted footer line under the pages, out of search",
     foot.settingEl.classes.includes("cursor-smith-footer") && foot.desc === "Cursor-Smith 0.0.0-test" && foot.def.searchable === false, foot.desc);
  ok("...then Behavior and the look cards",
     sections.slice(1).filter((s) => s !== null).join() === "Behavior,Appearance,Blinking,Smooth movement,Effects", sections);
  const names = cua.map((r) => r.name);
  ok("Enable plugin and the Vim mode toggle come first, then the strip, then General's switches in order",
     names.indexOf("Enable plugin") < names.indexOf("Vim mode") &&
     names.indexOf("Vim mode") < names.indexOf("Note editor only") &&
     names.indexOf("Note editor only") < names.indexOf("Hide real cursor") &&
     names.indexOf("Hide real cursor") < names.indexOf("Hide cursor when unfocused") &&
     names.indexOf("Hide cursor when unfocused") < names.indexOf("Low power mode") &&
     names.indexOf("Low power mode") < names.indexOf("Respect reduced motion"), names.slice(0, 9));
  ok("...as toggles Obsidian binds to the settings keys",
     ["enabled", "noteEditorOnly", "hideNativeCaret", "hideOnWindowBlur", "lowPowerMode", "respectReducedMotion"]
       .every((k) => cua.some((r) => r.def.control && r.def.control.type === "toggle" && r.def.control.key === k)));
  ok("the Vim mode switch is a toggle in its row, off in CUA",
     cua.find((r) => r.name === "Vim mode").toggles.length === 1 && cua.find((r) => r.name === "Vim mode").toggles[0]._value === false);

  // Search: every row Obsidian indexes has a name; notes and subheadings
  // opt out.
  ok("every unnamed row opts out of search",
     cua.filter((r) => !r.name).every((r) => r.def.searchable === false),
     cua.filter((r) => !r.name && r.def.searchable !== false).map((r) => r.desc));
  ok("no two rows in one card share a name (Obsidian keys rows by it)",
     !cua.threw);

  const modes = Object.fromEntries(["normal", "insert", "visual", "replace", "command"]
    .map((m) => [m, Object.assign({}, T.DEFAULT_SETTINGS)]));
  const vim = build({ uiMode: "vim", vimModeEnabled: true, vimStatusBar: true, vimModes: modes });
  ok("the whole Vim panel renders", !vim.threw, vim.threw && vim.threw.message);
  const vimSections = [...new Set(vim.map(sectionOf))].filter((s) => s !== null);
  ok("...its cards: Behavior, Vim, then the look (the mode row is in the header)",
     vimSections.join() === "Behavior,Vim,Appearance,Blinking,Smooth movement,Effects", vimSections);
  ok("the status bar colour row hangs off the status bar toggle",
     vim.some((r) => r.name === "Color status bar text to match the cursor"));
  ok("the Vim warning is a header row that shows only while Obsidian's Vim is off",
     vim.some((r) => r.def.visible && /Vim key bindings/.test(r.desc) && r.page === null));
  ok("the mode tabs are chips in the Mode row, the picked one filled in its mode's color",
     vim.find((r) => r.name === "Mode").controlEl.children[0].classes.includes("cursor-smith-mode-tabs")
     && vim.find((r) => r.name === "Mode").controlEl.children[0].children.every((b) => b.classes.includes("cursor-smith-chip"))
     && vim.find((r) => r.name === "Mode").controlEl.children[0].children.filter((b) => b.classes.includes("is-picked")).length === 1
     && !!vim.find((r) => r.name === "Mode").controlEl.children[0].children.find((b) => b.classes.includes("is-picked")).style.backgroundColor);
  ok("...and the Vim mode toggle is on", vim.find((r) => r.name === "Vim mode").toggles[0]._value === true);

  // The reduced-motion notice is the second row, under Enable plugin (a
  // hidden first row would leave Enable plugin with Obsidian's separator
  // over it), hidden unless the OS asks.
  const quiet = build({});
  const notice = quiet[1];
  ok("the notice is the second row, under Enable plugin", quiet[0].name === "Enable plugin" && notice.name === "Motion effects are off", notice.name);
  ok("...hidden while the OS isn't asking", notice.visible === false);
  const loud = build({}, { reduced: true });
  ok("...and shown when it is", loud[1].visible === true);
}

// update() rebuilds the panel through Obsidian, which then puts keyboard
// focus on the FIRST control of the row that had it - the CUA half of the
// mode switch after a click on Vim, the name box of the preset row after
// Save. That reads as a stray cursor (the plugin draws one wherever a text
// box has focus), so the tab's update() drops any focus inside the panel
// afterwards - the way the old full rebuild did by emptying it.
{
  const proto = T.SettingTabPrototype;
  const build = (focusedInside) => {
    const body = { blurred: 0, blur() { body.blurred++; } };
    const inside = { blurred: 0, blur() { inside.blurred++; } };
    const outside = { blurred: 0, blur() { outside.blurred++; } };
    const doc = { body, activeElement: focusedInside === null ? body : (focusedInside ? inside : outside) };
    const tab = Object.create(proto);
    tab.containerEl = { ownerDocument: doc, contains: (el) => el === inside };
    tab.update();
    return { tab, body, inside, outside };
  };
  const a = build(true);
  ok("update() rebuilds through Obsidian", a.tab.updates === 1, a.tab.updates);
  ok("...and drops the focus Obsidian left inside the panel", a.inside.blurred === 1);
  const b = build(false);
  ok("focus outside the panel is left alone", b.outside.blurred === 0 && b.tab.updates === 1);
  const c = build(null);
  ok("...and so is the body", c.body.blurred === 0);
  // Fails closed: a tab that is not on screen has no document to ask.
  const off = Object.create(proto);
  off.containerEl = {};
  let threw = false;
  try { off.update(); } catch { threw = true; }
  ok("an off-screen panel still updates without throwing", !threw && off.updates === 1);
}

// Section headings are groups now; a fresh tab renders them with no
// remembered collapse state at all.
{
  const rows = panelRows({});
  ok("a fresh panel renders with no remembered section state", !rows.threw && rows.length > 25,
     rows.threw && rows.threw.message);
}

// ---------------------------------------------------------------------------
section("settings descriptions stay short");

// The panel is ~105 descriptions long; at the original average of 109
// characters that was more prose than anyone reads. The rule kept is: one
// clause saying what it does, plus whatever tells you what an endpoint means -
// a slider cannot tell you what its own 0 does.
{
  // Read off the rendered panel, both modes, every gate open: a row's
  // description is what its definition says (that is what search indexes).
  // Notes - rows with no name of their own - are prose, not descriptions.
  const { renderWholePanel } = require("../panel_harness");
  const wideOpen = {
    popEffects: true, popLetters: true, backspaceDisintegrate: true, thunderstrike: true,
    fireworks: true, flameTrail: true, flameTrailGravity: 0.5, stardustEnabled: true, stardustOrbit: true,
    bracketTether: true, smear: true, smearTaper: true, energyEffect: true, energyAurora: true,
    gradientEnabled: true, crtEffect: true, crtNeon: true, crtGlitch: true, speedDemon: true,
    speedDemonSparks: true, speedDemonGradient: true, hotHead: true, hotHeadFlat: true,
    torchEffect: true, overlayFlicker: true, overlayBlinkSync: true, blinkingEnabled: true,
    blinkBreathing: true, smoothEnabled: true, smoothAdaptive: true, cursorStyle: "Box",
    boxHollow: true, showChar: true,
  };
  const modes = Object.fromEntries(["normal", "insert", "visual", "replace", "command"]
    .map((m) => [m, Object.assign({}, T.DEFAULT_SETTINGS)]));
  const rows = [
    ...renderWholePanel(wideOpen),
    ...renderWholePanel({ cursorStyle: "Underline" }),
    ...renderWholePanel({ uiMode: "vim", vimModeEnabled: true, vimStatusBar: true, vimModes: modes }),
  ];
  const descs = rows.filter((r) => r.name && r.desc && r.def.searchable !== false).map((r) => r.desc);
  ok("the panel still has its descriptions", descs.length > 90, descs.length);

  const avg = descs.reduce((a, d) => a + d.length, 0) / descs.length;
  ok("descriptions average under 70 characters", avg < 70, Math.round(avg));

  const bloated = descs.filter((d) => d.length > 110);
  ok("none has grown back past 110 characters", bloated.length === 0, bloated);

  // The endpoint semantics are the part that must survive any future trim.
  const endpoints = descs.filter((d) => /(^|[\s(])0\b|At 1\b/.test(d));
  ok("endpoint semantics are still stated", endpoints.length >= 15, endpoints.length);
  const named = (frag) => descs.some((d) => d.includes(frag));
  ok("0 = automatic underline is still explained", named("0 fits the line height"));
  ok("0 follows immediately is still explained", named("0 follows immediately"));
  ok("0 gives a pure spotlight is still explained", named("0 gives a pure spotlight"));
}

// ---------------------------------------------------------------------------
section("reduced motion: the user can find out why");

{
  // 1.3.6 started honouring prefers-reduced-motion. On Windows that is set by
  // turning off animation effects for SPEED, so a lot of people had it on
  // without knowing - and Smooth Movement and Motion Smear stopped working
  // while their toggles still read ON. The suppression is correct; being
  // silent about it was the bug.
  const KEYS = T.REDUCED_MOTION_OFF_KEYS;
  ok("smear is suppressed by the gate", KEYS.includes("smear"));
  ok("smooth movement is suppressed by the gate", KEYS.includes("smoothEnabled"));

  // The panel must keep showing the user's own choice - a saved preset must
  // never be rewritten by an OS preference. This is what makes a notice the
  // only way to explain the mismatch.
  const chosen = Object.assign({}, T.DEFAULT_SETTINGS, { smear: true, smoothEnabled: true });
  const effective = T.applyReducedMotion(Object.assign({}, chosen));
  ok("the engine really does switch them off",
     effective.smear === false && effective.smoothEnabled === false);
  ok("...while the user's own settings are left alone",
     chosen.smear === true && chosen.smoothEnabled === true);

  // --- the notice itself --------------------------------------------------
  // A row in the first card, always built and shown or hidden by its
  // `visible` predicate - which Obsidian re-evaluates after every control
  // change, so it appears and disappears with the OS preference without a
  // rebuild.
  const { makeEl } = require("../panel_harness");
  const proto = T.SettingTabPrototype;
  const build = (reduced) => {
    const tab = Object.create(proto);
    tab.plugin = { reducedMotion: () => reduced, registerWindowEvents: () => {} };
    const def = tab.reducedMotionNotice();
    const settingEl = makeEl("div");
    def.render({ settingEl, controlEl: settingEl.createDiv() }, {});
    return { def, settingEl, visible: def.visible() };
  };

  {
    const { visible } = build(false);
    ok("no notice when the OS isn't asking", visible === false);
  }
  {
    const { def, settingEl, visible } = build(true);
    ok("a notice appears when the OS is asking", visible === true);
    const text = def.name + " " + def.desc;
    // Name both features the report was about, so searching the text for
    // either one finds it.
    ok("it names Smooth movement", /Smooth movement/.test(text), text);
    ok("it names Motion smear", /Motion smear/.test(text), text);
    // And point at the control that turns it off, by its exact panel label.
    ok("it names the toggle that overrides it",
       /Respect reduced motion/.test(text), text);
    ok("it says the toggles below are still the user's own",
       /still show your own settings/.test(text), text);
    ok("it carries its styling hook",
       settingEl.classes.includes("cursor-smith-reduced-notice"), settingEl.classes);
    ok("it is not a search result of its own", def.searchable === false);
  }
  {
    // The rule panel_harness.js exists to enforce: a row that throws takes
    // every row after it out of the panel. The notice is FIRST, so if its
    // check threw it would take the entire settings panel with it.
    const tab = Object.create(proto);
    tab.plugin = { reducedMotion: () => { throw new Error("no matchMedia"); }, registerWindowEvents: () => {} };
    let threw = false;
    let visible = "sentinel";
    const realError = console.error;
    console.error = () => {};   // the guard logs; that's expected here
    try { visible = tab.reducedMotionNotice().visible(); } catch { threw = true; }
    finally { console.error = realError; }
    ok("a broken reduced-motion check cannot abort the panel", threw === false);
    ok("...it just hides the notice", visible === false);
  }
}

// ---------------------------------------------------------------------------
section("support / donate row: removed");

// The in-panel "Support Cursor-Smith" row and the fundingLinks() helper that
// built it were both removed. Asserted absent rather than simply untested, the
// same way Matrix Rain and Text Crawl are, so a half-finished revert cannot
// quietly put the donate button back.
//
// manifest.json keeps its `fundingUrl`: that field is what drives Obsidian's
// own Donate button in Community Plugins, which was never the thing removed.
{
  ok("fundingLinks is gone", T.fundingLinks === undefined);
  ok("renderSupportSection is gone",
     typeof T.SettingTabPrototype.renderSupportSection !== "function");
  const rows = panelRows({});
  ok("no row in the panel offers to take money",
     !rows.some((r) => /support|donate|coffee|sponsor/i.test(r.name || "")),
     rows.map((r) => r.name).filter((n) => n && /support|donate/i.test(n)));
}
