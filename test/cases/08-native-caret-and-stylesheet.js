// the hidden caret's colour, the stylesheet, the review's rules, note editor only, the status bar clip.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("the hidden caret keeps a usable colour");

// Issue #24. On iOS, WebKit tints the whole text-selection UI - the highlight
// wash and both drag handles - from caret-color, using its RGB channels and
// discarding its alpha. `transparent` is rgba(0, 0, 0, 0), so hiding the caret
// with it painted the selection black on a black theme and made the handles
// invisible. The fix is to keep the alpha at 0, which is what actually hides
// the caret, and give the RGB something to be.
//
// These assertions read the shipped CSS as text because that is where the bug
// lived: there is no code path to exercise, only a stylesheet. They fail
// against 1.4.8 as shipped, which is the point. (Until 1.5.4 main.js
// injected a second copy of these rules into every window; Obsidian clones
// the main window's stylesheets into pop-outs and the settings window
// itself, so styles.css is the one place now - and main.js must declare no
// caret colour at all.)
{
  const fs_ = require("fs"), path_ = require("path");
  const read = (f) => fs_.readFileSync(path_.join(__dirname, "..", "..", f === "main.js" ? "build/test-bundle.js" : f), "utf8");
  const sheets = { "styles.css": read("styles.css") };

  // Every caret-color in the plugin, wherever it is declared.
  const decls = {};
  for (const [name, text] of Object.entries(sheets)) {
    decls[name] = [...text.matchAll(/caret-color:\s*([^;]+);/g)].map((m) => m[1].trim());
  }
  const all = [].concat(...Object.values(decls));

  ok("the stylesheet still declares a caret colour", decls["styles.css"].length >= 2, decls);
  ok("main.js declares none", !/caret-color\s*:/.test(read("main.js")));

  // The regression, stated as the thing that must never come back. `transparent`
  // is the only spelling that was ever used, but any black is the same bug.
  const black = all.filter((v) => /transparent|\b(?:0\s*,\s*0\s*,\s*0|#000(?:000)?)\b/i.test(v));
  ok("no caret colour resolves to black", black.length === 0, black);

  // Hiding the caret is the alpha's job and must stay the alpha's job - a
  // future edit that reaches for a visible colour here breaks the feature
  // outright rather than subtly.
  const hiding = all.filter((v) => v !== "auto");
  ok("every hiding declaration is zero-alpha",
     hiding.length > 0 && hiding.every((v) => /,\s*0\s*\)\s*$/.test(v)), hiding);

  // Excalidraw's carve-out is the one place a REAL caret is wanted; a zero
  // alpha creeping in there is the 1.4.6 no-caret-anywhere bug again.
  for (const name of Object.keys(sheets)) {
    ok(name + " keeps the Excalidraw carve-out at auto",
       decls[name].includes("auto"), decls[name]);
  }

  // An undefined var() makes the declaration invalid at COMPUTED-VALUE time,
  // which resolves to `unset` - inherited, i.e. a visible caret - and pointedly
  // does NOT fall back to an earlier declaration. The literal fallback inside
  // the var() is the only thing standing between a theme without the variable
  // and the native caret showing through under the drawn one.
  const varDecls = hiding.filter((v) => v.includes("var("));
  ok("the hiding colours are driven by a variable", varDecls.length === hiding.length, hiding);
  ok("every var() carries a literal fallback",
     varDecls.every((v) => /var\(\s*--[\w-]+\s*,[^)]+\)/.test(v)), varDecls);

  // Both files ship the same value: they are two copies of one rule, and only
  // the main.js one reaches a popped-out window.
  ok("the two stylesheets agree on the value",
     new Set(hiding).size === 1, [...new Set(hiding)]);
}

// ---------------------------------------------------------------------------
section("the stylesheet hides every native cursor, and its blink");

// styles.css has to hide every native cursor - the primary and the
// secondaries, which the plugin draws itself - and stop the cursor layer's
// blink animation, which otherwise costs a style recalc on every frame the
// plugin's loop requests (issue #30's tail). Until 1.5.4 main.js injected a
// second copy of these rules, which had drifted (it forced the secondaries
// visible and won on !important); there is one copy now, and main.js must
// not grow another.
{
  const fs = require("fs");
  const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "styles.css"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "..", "build", "test-bundle.js"), "utf8");

  const ruleFor = (sheet, selectorPart) => {
    // The declaration block of the first rule whose selector list mentions
    // selectorPart.
    const i = sheet.indexOf(selectorPart);
    if (i < 0) return null;
    const open = sheet.indexOf("{", i);
    return sheet.slice(open, sheet.indexOf("}", open));
  };
  ok("styles.css hides the secondary native cursor",
     /display:\s*none/.test(ruleFor(css, ".cm-cursor-secondary") || ""));
  ok("main.js injects no stylesheet of its own",
     !/injectStyles|createEl\("style"|cm-cursor-secondary/.test(js));
  ok("styles.css stops the cursor layer's blink animation",
     /\.cm-cursorLayer\s*\{[^}]*animation:\s*none/.test(css));
  // Under the hide-native class only: with the native caret shown (Note
  // editor only, focus in the interface) its blink must keep running.
  ok("...only while the native caret is hidden",
     /hide-native[^{]*\.cm-cursorLayer\s*\{/.test(css));
  // The torch layers moved here from the injected copy, collapsed like the
  // canvas wrapper until the tick sizes them.
  const overlay = ruleFor(css, ".cursor-smith-torch-overlay {");
  ok("styles.css lays out the torch overlay",
     /position:\s*fixed/.test(overlay || "") && /width:\s*0/.test(overlay || "") && /height:\s*0/.test(overlay || ""), overlay);
  const glow = ruleFor(css, ".cursor-smith-torch-glow {");
  ok("...and the glow layer, driven by --torch-glow",
     /mix-blend-mode:\s*screen/.test(glow || "") && /var\(--torch-glow/.test(glow || ""), glow);
  ok("...with no animation on either", !/cursor-smith-torch-(overlay|glow)[^{]*\{[^}]*animation:/.test(css));
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The mode tab itself. Its click listener is synchronous (addEventListener
// does not await; the review's no-misused-promises) and hands off to an
// async switch: setVimModeEnabled, then a re-display - and nothing at all
// when the pressed tab is already the current mode.
{
  const { renderWholePanel: whole } = require("../panel_harness");
  const modes = Object.fromEntries(["normal", "insert", "visual", "replace", "command"].map((m) => [m, Object.assign({}, Plugin.__test.DEFAULT_SETTINGS)]));
  later(async () => {
    const cua = whole({ uiMode: "cua" });
    const calls = [];
    // As the real one does, the switch writes uiMode.
    cua.plugin.setVimModeEnabled = async (v) => { calls.push(v); cua.plugin.settings.uiMode = v ? "vim" : "cua"; };
    const t = cua.find((r) => r.name === "Vim mode").toggles[0];
    ok("the Vim mode switch is a toggle, off in CUA", t._value === false, t._value);
    await t._change(true);
    ok("flipping it on switches the mode and rebuilds", calls.join() === "true" && cua.tab.updates === 1, calls);
    await t._change(true);
    ok("...and flipping to the state it is in does nothing", calls.length === 1 && cua.tab.updates === 1, calls);
    const vim = whole({ uiMode: "vim", vimModeEnabled: true, vimModes: modes });
    const vcalls = [];
    vim.plugin.setVimModeEnabled = async (v) => { vcalls.push(v); };
    const vt = vim.find((r) => r.name === "Vim mode").toggles[0];
    ok("...on in Vim mode", vt._value === true, vt._value);
    await vt._change(false);
    ok("...and flipping it off switches back", vcalls.join() === "false" && vim.tab.updates === 1, vcalls);
  });
}

// ---------------------------------------------------------------------------
section("the plugin review's rules (static styles, settings headings)");

// The Obsidian plugin review (2026-09-17, 1.5.3) failed on two rules: no
// literal inline styles (obsidianmd/no-static-styles-assignment - a class,
// or setCssStyles for what is set at runtime) and no HTML headings in the
// settings tab (Setting.setHeading instead). The canvas wrapper, the torch
// overlay and the settings panel's notes moved to classes; this pins that
// the classes exist where the elements are created, and that neither
// pattern comes back.
{
  const fs = require("fs");
  const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "styles.css"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "..", "build", "test-bundle.js"), "utf8");
  const ruleFor = (sheet, sel) => {
    const i = sheet.indexOf(sel);
    if (i < 0) return null;
    const open = sheet.indexOf("{", i);
    return sheet.slice(open, sheet.indexOf("}", open));
  };
  const has = (rule, decl) => !!rule && rule.replace(/\s+/g, " ").includes(decl);
  for (const [name, sheet] of [["styles.css", css]]) {
    const w = ruleFor(sheet, ".cursor-smith-wrapper {");
    ok(`${name} lays out the canvas wrapper`,
       has(w, "position: fixed") && has(w, "overflow: hidden") && has(w, "pointer-events: none") && has(w, "z-index: 10000"), w);
    ok(`${name} collapses it until the tick sizes it`,
       has(w, "width: 0") && has(w, "height: 0") && has(w, "top: 0") && has(w, "left: 0"));
    const c = ruleFor(sheet, ".cursor-smith-canvas {");
    ok(`${name} places the canvas inside the wrapper`, has(c, "position: absolute") && has(c, "pointer-events: none"), c);
  }
  const ov = ruleFor(css, ".cursor-smith-torch-overlay {");
  ok("styles.css collapses the torch overlay too", has(ov, "width: 0") && has(ov, "height: 0") && has(ov, "position: fixed"));
  ok("the footer names the plugin, with the manifest's version, and no card is headed by it",
     /desc: `Cursor-Smith \$\{plugin\.manifest\?\.version/.test(js) && !/heading: `Cursor-Smith/.test(js));
  for (const cls of ["cursor-smith-vim-status", "cursor-smith-note-row", "cursor-smith-note-warning",
                     "cursor-smith-section", "cursor-smith-sub", "cursor-smith-subsection-row", "cursor-smith-reduced-notice",
                     "cursor-smith-mode-tabs", "cursor-smith-mode-tab", "cursor-smith-page-icon", "cursor-smith-chip", "cursor-smith-rail",
                     "cursor-smith-pcard", "cursor-smith-pcard-use", "cursor-smith-pcard-caret", "cursor-smith-tick", "cursor-smith-alert", "cursor-smith-footer", "cursor-smith-pcard-caret-text", "cursor-smith-pcard-ghost", "cursor-smith-pcard-particle", "cursor-smith-value-icon", "cursor-smith-iconed", "cursor-smith-prompt-field", "cursor-smith-needs-hint", "cursor-smith-reset-link"]) {
    ok(`styles.css has .${cls}`, new RegExp("\\." + cls + "(?![\\w-])").test(css));
    ok(`...which main.js uses`, js.includes(cls));
  }
  // The review rule, as a regex: a literal string assigned to a style
  // property, or to cssText. Comments do not count.
  const code = js.replace(/^\s*\/\/.*$/gm, "");
  const literal = code.match(/\.style\.\w+\s*=\s*["'`]/g) || [];
  ok("no literal inline style assignment is left", literal.length === 0, literal);
  ok("no cssText either", !/\.style\.cssText\s*=/.test(code));
  // And no HTML headings are built anywhere (the settings tab is the only
  // place that ever did). Whole-file on purpose: the TypeScript build the
  // same suite runs against does not keep the class statement as written.
  const tab = js;
  ok("the settings tab builds no <h1>-<h6> of its own", !/createEl\("h[1-6]"/.test(tab));
  ok("...its headings are setting groups", (tab.match(/type: "group"/g) || []).length >= 2 && !/\.setHeading\(\)/.test(tab));
  // The 1.13 declarative panel, and none of the API it replaced.
  ok("the tab implements getSettingDefinitions", /^  getSettingDefinitions\(\) \{/m.test(tab));
  ok("...and no display()", !/^  display\(\) \{/m.test(tab) && !/\.display\(\)/.test(tab));
  ok("no setWarning (setDestructive since 1.13)", !/setWarning/.test(tab));
  ok("no createElement (Obsidian's createEl / createDiv / createSpan)", !/\.createElement\(/.test(tab));
  ok("the command ids do not repeat the plugin id", !/id: "[^"]*cursor-smith/.test(tab));
  ok("the manifest asks for the Obsidian this needs",
     JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "manifest.json"), "utf8")).minAppVersion === "1.13.7");
  ok("...and versions.json says so for this release",
     JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "versions.json"), "utf8"))["1.5.8"] === "1.13.7");
}

// ---------------------------------------------------------------------------
section("the canvas is kept off the status bar without cutting the bottom line");

// A floating status bar (a pill at the bottom right in many themes) used to
// shorten the whole wrapper to its top, so every caret on the bottom line
// was cut to a sliver. The clip now spares only the bar's own rectangle.
{
  const W = { top: 78, left: 359, width: 867, height: 569 };   // bottom at 647
  // Bar starts above the pane's bottom, spans the whole pane: shorten.
  const full = T.wrapperClipForStatusBar(W, { top: 630, left: 0, right: 1300 });
  ok("a bar spanning the pane shortens the wrapper to its top", full.height === 630 - 78 && full.clipPath === "", full);
  // A pill at the bottom right: keep the height, cut a notch.
  const pill = T.wrapperClipForStatusBar(W, { top: 630.4, left: 1000, right: 1226 });
  ok("a floating pill keeps the wrapper's full height", pill.height === 569, pill);
  ok("...and clips out only its own rectangle",
     pill.clipPath === "polygon(0 0, 867px 0, 867px 569px, 867px 569px, 867px 552px, 641px 552px, 641px 569px, 0 569px)", pill.clipPath);
  // The pane ends above the bar: nothing to do.
  const clear = T.wrapperClipForStatusBar({ top: 78, left: 359, width: 867, height: 500 }, { top: 630, left: 1000, right: 1226 });
  ok("a pane that ends above the bar is untouched", clear.height === 500 && clear.clipPath === "");
  // A bar entirely outside the pane horizontally: no notch inside the pane.
  const aside = T.wrapperClipForStatusBar(W, { top: 630, left: 1300, right: 1400 });
  ok("a bar beside the pane leaves it alone", aside.height === 569 && aside.clipPath === "", aside);
  ok("heights are whole pixels", Number.isInteger(full.height) && Number.isInteger(pill.height));
}

// ---------------------------------------------------------------------------
section("Note Editor Only: the plugin stays out of the interface");

// Issue #29. The plugin draws a caret on every editable surface in the app -
// Command Palette, Quick Switcher, Search, Settings, the tab-title rename box,
// other plugins' modals - and hides the native one everywhere at once with a
// single body class. This option confines both halves to the note editor.
//
// "Both halves" is what these assertions are about. Declining to draw while
// still hiding the native caret leaves a field with no caret from EITHER
// source, which is precisely what issues #26 and #27 were, and it is invisible
// until someone tries to type in the field it happened to. The guarantee here
// is structural rather than careful: one predicate answers for the drawing and
// for the hiding, so the two cannot drift apart.
{
  const proto = T.EngineProto;

  // An engine with just enough on it to answer both questions: a settings
  // object and a workspace whose active editor may or may not have focus.
  // focus === null means there is no active editor at all - no note open -
  // which has to read the same as one that is merely unfocused.
  const engine = (settings, focus) => {
    const e = Object.create(proto);
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    e.app = {
      workspace: {
        activeEditor: focus === null ? null : { editor: { cm: { hasFocus: focus } } },
      },
    };
    return e;
  };

  // --- the setting ------------------------------------------------------
  ok("it is off by default", T.DEFAULT_SETTINGS.noteEditorOnly === false);
  // Structural, like hideNativeCaret and hideOnWindowBlur: it says WHERE the
  // plugin applies, not what the cursor looks like, so it has no business in a
  // preset, a share code or a per-Vim-mode snapshot. LOOK_KEYS is positional
  // as well, so a structural key appended to it burns an index forever.
  ok("it is not a look key", !T.LOOK_KEYS.includes("noteEditorOnly"));
  const carrying = Object.entries(T.DEFAULT_PRESETS)
    .filter(([, p]) => "noteEditorOnly" in p).map(([n]) => n);
  ok("no shipped preset carries it", carrying.length === 0, carrying);

  // --- noteEditorFocused: the one predicate ------------------------------
  ok("the focused note editor is the note editor",
     engine({}, true).noteEditorFocused() === true);
  ok("an unfocused editor is not", engine({}, false).noteEditorFocused() === false);
  ok("no open editor is not", engine({}, null).noteEditorFocused() === false);
  {
    // It feeds the hide-native body class, so a throw has to answer "no" -
    // which hands the user Obsidian's own caret - rather than propagate into
    // the frame that stamps the class.
    const e = Object.create(proto);
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS);
    e.app = { get workspace() { throw new Error("mid-teardown"); } };
    e.reports = [];
    e._reportOnce = (site, err) => e.reports.push([site, err.message]);
    let threw = false, out;
    try { out = e.noteEditorFocused(); } catch { threw = true; }
    ok("a broken workspace lookup does not throw", threw === false);
    ok("...and fails safe, toward the native caret", out === false);
    ok("...and reports it once, naming the site", e.reports.length === 1 && e.reports[0][0] === "noteEditorFocused", e.reports);
  }

  // --- hideNativeActive: what the body class means now -------------------
  ok("off: the native caret is hidden everywhere, exactly as before",
     engine({ noteEditorOnly: false }, false).hideNativeActive() === true);
  ok("on, in the editor: still hidden",
     engine({ noteEditorOnly: true }, true).hideNativeActive() === true);
  ok("on, anywhere else: the native caret comes back",
     engine({ noteEditorOnly: true }, false).hideNativeActive() === false);
  ok("on, with no note open: the native caret comes back",
     engine({ noteEditorOnly: true }, null).hideNativeActive() === false);
  // Hide Real Cursor still outranks it in both focus states - this option
  // scopes that toggle, it does not replace or override it.
  for (const focus of [true, false]) {
    ok("Hide Real Cursor off still wins (focus=" + focus + ")",
       engine({ hideNativeCaret: false, noteEditorOnly: true }, focus).hideNativeActive() === false);
  }

  // --- genericCaretCoords: the drawn half --------------------------------
  // The gate sits at the very front of the function, ahead of any DOM work.
  // isExcalidrawCaretHost is the first thing past it, so spying on that says
  // how far execution actually got - "returned null" alone would also be true
  // of a dozen unrelated reasons further down.
  const runGeneric = (noteEditorOnly) => {
    const e = engine({ noteEditorOnly }, false);
    let reached = false;
    e.isExcalidrawCaretHost = () => { reached = true; return true; };
    e.canvas = { ownerDocument: { activeElement: { tagName: "INPUT", type: "text" } } };
    // Called first, into a local. Building the object around the call would
    // read `reached` before the call that sets it - which is how this test
    // passed against an engine that never reached the spy at all.
    const out = e.genericCaretCoords();
    return { reached, out };
  };
  {
    const off = runGeneric(false);
    ok("off: the interface caret is still measured", off.reached === true);
    const on = runGeneric(true);
    ok("on: no caret is drawn in the interface", on.out === null);
    ok("...and nothing is measured to decide that", on.reached === false);
  }

  // --- the invariant, stated over every focus state ----------------------
  for (const [label, focus] of [["in the editor", true], ["elsewhere", false], ["no note open", null]]) {
    const e = engine({ noteEditorOnly: true }, focus);
    e.isExcalidrawCaretHost = () => false;
    e.canvas = { ownerDocument: { activeElement: { tagName: "INPUT", type: "text" } } };
    const hides = e.hideNativeActive();
    if (focus === true) {
      // caretCoords() routes to cmCaretCoords here, which this option never
      // touches - so a caret IS drawn, and the native one must stay hidden.
      ok(label + ": we draw, so the native caret stays hidden", hides === true);
    } else {
      ok(label + ": no caret is drawn", e.genericCaretCoords() === null);
      ok(label + ": ...so the native one is handed back", hides === false);
    }
  }

  // --- the row that turns it on ------------------------------------------
  {
    const { renderGlobalRows } = require("../panel_harness");
    const rows = renderGlobalRows({});
    const names = rows.map((r) => r.name).filter(Boolean);
    ok("the row is in the panel", names.includes("Note editor only"), names);
    // It belongs above the CUA/Vim switch with the other structural options.
    // In Vim mode the whole Look panel below that switch is replaced, so a row
    // rendered down there is unreachable for half the plugin's users - which
    // is exactly what once happened to Hide Real Cursor.
    ok("...above the mode switch, among the global options",
       names.indexOf("Note editor only") > names.indexOf("Enable plugin") &&
       names.indexOf("Note editor only") < names.indexOf("Respect reduced motion"), names);
    // The rule panel_harness.js exists to enforce: a row that throws takes out
    // every row after it, and this one is now second of five.
    ok("...and the rows after it still render",
       names.includes("Hide real cursor") && names.includes("Hide cursor when unfocused"), names);

    const row = rows.find((r) => r.name === "Note editor only");
    ok("it is one toggle", row.controls.join() === "toggle", row.controls);
    ok("it shows the saved value", row.toggles[0]._value === false);
    row.toggles[0]._change(true);
    ok("...and pressing it writes noteEditorOnly", rows.settings.noteEditorOnly === true);
    // The row it was copied from writes a different key. Wiring both to the
    // same one is the likeliest way to get this wrong and would look, from the
    // panel, like the new toggle simply did nothing.
    rows.find((r) => r.name === "Hide real cursor").toggles[0]._change(false);
    ok("Hide real cursor still writes its own key",
       rows.settings.hideNativeCaret === false && rows.settings.noteEditorOnly === true,
       { hideNativeCaret: rows.settings.hideNativeCaret, noteEditorOnly: rows.settings.noteEditorOnly });
  }
}
