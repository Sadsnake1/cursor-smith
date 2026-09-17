// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

import { PluginSettingTab, Setting } from "obsidian";
import type CursorSmithPlugin from "./plugin";
import { DEFAULT_SETTINGS, VIM_MODE_KEYS, VIM_MODE_LABELS } from "./settings";
import { SHARE_VERSION, SHARE_VERSION_VIM, presetToCode, vimPresetToCode } from "./share";

export class CursorSmithSettingTab extends PluginSettingTab {
  [key: string]: any;
  plugin: CursorSmithPlugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // --- "Why is nothing moving?" ------------------------------------------
  // Reduced motion is deliberately invisible to the rest of the panel: the
  // suppression runs on the merged copy inside effectiveSettings(), never on
  // this.settings, so every toggle below keeps showing what the USER chose
  // (see applyReducedMotion). That is the right call for the data - a saved
  // preset must not be rewritten by an OS preference - but on its own it
  // produces the worst possible symptom: Motion Smear and Smooth Movement read
  // as ON and do nothing, with nothing anywhere saying why.
  //
  // This is the missing half. It says so, in the one place someone goes to
  // find out, and only while the OS is actually asking.
  //
  // Windows is where this bites hardest, which is why it arrived as a bug
  // report from there. Turning off Settings > Accessibility > Visual effects >
  // Animation effects - or choosing "Adjust for best performance" in the old
  // Performance Options dialog, which does the same thing - sets
  // prefers-reduced-motion for every Chromium app on the machine. People do
  // that for speed, years earlier, with no idea it is an accessibility signal
  // that anything will later read.
  //
  // Deliberately NOT fixed by flipping the respectReducedMotion default: the
  // preference is real and honouring it by default is correct. The defect was
  // only ever that it was silent.
  renderReducedMotionNotice(containerEl: HTMLElement) {
    // Fail closed. This runs FIRST in display(), so anything thrown here takes
    // the entire settings panel down with it - the exact failure panel_harness
    // exists to catch, and a far worse outcome than the silent suppression
    // this notice is here to explain. reducedMotion() already swallows a
    // missing matchMedia, but it reads this.settings before its own try, and
    // an explanatory banner is never worth the risk of an empty panel.
    let reduced = false;
    try {
      reduced = this.plugin.reducedMotion();
    } catch (e) {
      console.error("[cursor-smith] reduced-motion check failed:", e);
      return null;
    }
    if (!reduced) return null;
    const notice = containerEl.createDiv({ cls: "cursor-smith-reduced-notice" });
    notice.createDiv({
      cls: "cursor-smith-reduced-notice-title",
      text: "Motion effects are off",
    });
    notice.createDiv({
      text: "Your system is set to reduce motion, so Smooth Movement, Motion " +
            "Smear and the other moving effects are suppressed - the toggles " +
            "below still show your own settings. Turn off \"Respect Reduced " +
            "Motion\" to override this.",
    });
    return notice;
  }

  display() {
    const { containerEl } = this;
    // Since Obsidian 1.13 this panel renders in a window of its own, in a
    // document the engine has no other way to discover: documents are
    // otherwise learned from `view.dom.ownerDocument`, and the settings
    // window hosts no view. Registering it here is what lets
    // _focusedForeignDoc offer it as a canvas target, so the cursor can
    // follow the caret into the panel's own text boxes (preset names, share
    // codes) the way it always could when Settings was a modal in the main
    // document. Set-guarded and a no-op pre-1.13, where ownerDocument IS the
    // main document. Fail closed, same rule as everything else that runs at
    // the top of display(): a nicety here must never take the panel down.
    try {
      const panelDoc = containerEl.ownerDocument;
      if (panelDoc && panelDoc !== document) {
        this.plugin.registerWindowEvents(panelDoc);
      }
    } catch (e) {
      console.error("[cursor-smith] could not register settings window:", e);
    }
    // Hold the scroll position across the rebuild. The structural controls -
    // the CUA/Vim switch, preset load/save/import, the Vim tab bar and its two
    // gating toggles - call display(), which empties containerEl and builds it
    // again; before this, that threw you back to the top of a very long panel.
    // The look settings' own gated toggles no longer come through here at
    // all: they re-render their section in place (see renderLookSettings).
    const scroller = this._scrollHost();
    const scrollTop = scroller ? scroller.scrollTop : 0;
    containerEl.empty();

    // Read the version off the manifest rather than hardcoding it here, so a
    // release is a one-line edit in manifest.json instead of two edits that
    // can silently drift apart.
    // The version, as a small note rather than a heading: Obsidian's
    // guidelines want no plugin-name title in a settings tab and headings
    // built through Setting.setHeading (the review enforces both).
    containerEl.createDiv({
      cls: "cursor-smith-version",
      text: `v${this.plugin.manifest?.version ?? ""}`.trim(),
    });

    this.renderReducedMotionNotice(containerEl);

    // --- Enable Plugin: always on top ---
    new Setting(containerEl)
      .setName("Enable Plugin")
      .setDesc("Hands you back Obsidian's own caret.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            this.plugin.settings.enabled = value;
            value ? this.plugin.enable() : this.plugin.disable();
            await this.plugin.saveSettings();
          })
      );

    // --- General options: structural, so they sit above the CUA/Vim switch.
    //
    // Neither is a "look": neither is in LOOK_KEYS, so neither is part of a
    // preset or of a per-Vim-mode snapshot - they apply to whatever cursor is
    // on screen. They used to live in a "General" section inside the CUA
    // panel, which had the side effect that in Vim mode there was no way to
    // reach Hide Real Cursor at all. Rendered here, in display(), they're in
    // one place for both panels.
    const setGlobal = (key) => async (v) => {
      this.plugin.settings[key] = v;
      await this.plugin.saveSettings();
    };

    new Setting(containerEl)
      .setName("Note Editor Only")
      .setDesc("Draws the cursor in notes only. Search, palettes, settings and modals keep Obsidian's caret.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.noteEditorOnly === true).onChange(setGlobal("noteEditorOnly")));

    new Setting(containerEl)
      .setName("Hide Real Cursor")
      .setDesc("Hides the native primary cursor so only the custom one shows.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.hideNativeCaret).onChange(setGlobal("hideNativeCaret")));

    new Setting(containerEl)
      .setName("Hide Cursor When Unfocused")
      .setDesc("Hides the cursor while Obsidian isn't the active window.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hideOnWindowBlur ?? true).onChange(setGlobal("hideOnWindowBlur")));

    new Setting(containerEl)
      .setName("Low Power Mode")
      .setDesc("Halves every effect's frame rate. For battery, or if Obsidian feels slower with the plugin on.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.lowPowerMode === true).onChange(setGlobal("lowPowerMode")));

    new Setting(containerEl)
      .setName("Respect Reduced Motion")
      .setDesc("Switches off the moving effects when your system asks for reduced motion. The cursor's own look is untouched.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.respectReducedMotion !== false)
          .onChange(setGlobal("respectReducedMotion")));

    // --- CUA/Normal vs Vim mode switch ---
    this.renderModeSwitch(containerEl);

    if ((this.plugin.settings.uiMode || "cua") === "vim") {
      this.renderVimSection(containerEl);
    } else {
      this.renderNormalSection(containerEl);
    }

    // Note: a "Support Cursor-Smith" donate row used to render here, last in
    // the panel, built from manifest.json's `fundingUrl` via fundingLinks().
    // Both are gone. The manifest field is deliberately left in place - it is
    // what drives Obsidian's OWN Donate button on the plugin's entry in
    // Community Plugins, which is a separate thing and not what was removed.
    // Delete that field too if the intent is to have no donate link anywhere.

    // After the rebuild, not during: the panel has to be its full height again
    // before a scroll offset means anything. requestAnimationFrame rather than
    // a straight assignment because rows are laid out on the next frame, so
    // setting it here would clamp against a container that is still short.
    if (scroller && scrollTop) {
      window.requestAnimationFrame(() => { scroller.scrollTop = scrollTop; });
    }
  }

  // -------------------------------------------------------------------------
  // Segmented CUA/Normal ↔ Vim switch. Selecting "Vim" turns Vim-aware
  // cursors on (and, per vimControlObsidian, flips Obsidian's own Vim
  // keybindings); selecting "CUA/Normal" turns them off. This one control is
  // both the panel switch and the feature's on/off switch.
  // -------------------------------------------------------------------------
  renderModeSwitch(containerEl: HTMLElement) {
    const plugin = this.plugin;
    const current = plugin.settings.uiMode || "cua";

    // A segmented control; the look is styles.css's (.cursor-smith-segmented
    // / .cursor-smith-segment, is-active for the chosen one).
    const wrap = containerEl.createDiv({ cls: "cursor-smith-segmented" });

    const makeBtn = (label, key) => {
      const active = current === key;
      const btn = wrap.createEl("button", {
        text: label, cls: active ? "cursor-smith-segment is-active" : "cursor-smith-segment",
      });
      const switchMode = async () => {
        if ((plugin.settings.uiMode || "cua") === key) return;
        // Deliberately NOT setting uiMode here: setVimModeEnabled writes it
        // (keeping both flags in one place), and it needs the pre-click state
        // intact to decide whether the "restore Obsidian's vim" path applies.
        // Writing uiMode first blinded that check whenever the two flags had
        // drifted apart, silently skipping the restore.
        await plugin.setVimModeEnabled(key === "vim");
        this.display();
      };
      btn.addEventListener("click", () => { void switchMode(); });
      return btn;
    };

    makeBtn("CUA / Normal", "cua");
    makeBtn("Vim", "vim");
  }

  // -------------------------------------------------------------------------
  // Collapsible section helper. Wraps a named group of settings in a native
  // <details>/<summary> so the panel's 60+ settings can be collapsed down to
  // whichever groups someone actually uses - Effects alone now covers 8
  // separate features. Sections default open: collapsibility is the point,
  // not being hidden by default.
  //
  // The rows go in a body element of their own under the summary, and
  // renderFn is handed a `rerender` that empties that body and runs renderFn
  // over it again. That is how a gated toggle refreshes the rows around it
  // without display() tearing down the whole panel: the <details> element
  // itself, its open state and everything outside it are untouched, so the
  // scroll position and the other sections' DOM stay exactly where they were.
  // -------------------------------------------------------------------------
  renderSection(containerEl, title, renderFn, { open = true } = {}) {
    const details = containerEl.createEl("details", { cls: "cursor-smith-section" });
    // Remember which sections the user had collapsed. display() still rebuilds
    // the whole panel via containerEl.empty() for the structural controls
    // (the mode switch, presets, the Vim tab bar), so without this, collapsing
    // a section to get it out of the way lasted exactly until the next one of
    // those. Keyed by title rather than by index so adding a section doesn't
    // shuffle everyone's saved state.
    //
    // Deliberately in memory rather than in settings: it is panel state, not
    // configuration, and it should not travel in a share code or a preset.
    if (!this._sectionOpen) this._sectionOpen = {};
    details.open = this._sectionOpen[title] ?? open;
    // Optional-chained: the panel test harness stubs elements with just the
    // Obsidian DOM helpers renderLookSettings needs, and has no event support.
    details.addEventListener?.("toggle", () => {
      this._sectionOpen[title] = details.open;
    });
    const summary = details.createEl("summary");
    summary.createSpan({ cls: "cursor-smith-section-title", text: title });
    const body = details.createDiv({ cls: "cursor-smith-section-body" });
    const rerender = () => {
      body.empty();
      renderFn(body, rerender);
    };
    renderFn(body, rerender);
    return details;
  }

  // The element that actually scrolls the settings pane. Obsidian's own
  // containerEl is usually it, but that is an implementation detail of the
  // settings modal rather than a promise, so walk up until something is
  // genuinely overflowing rather than assuming.
  _scrollHost() {
    let el = this.containerEl;
    for (let i = 0; el && i < 6; i++) {
      if (el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return this.containerEl;
  }

  // Container for a run of sub-options belonging to whatever setting sits
  // directly above it (a toggle, or the Cursor Style dropdown).
  //
  // This is a wrapper element rather than a class stamped on each individual
  // Setting, which is what it used to be. Two reasons:
  //
  //   1. One element means one guide line for the whole group, with a proper
  //      start and end, instead of a stack of per-row line segments that only
  //      *looked* continuous as long as no row had a margin.
  //   2. It nests. The old scheme hardcoded a class per depth
  //      (cursor-smith-indent-1 / -2) with hardcoded margins, so a third level
  //      needed a third class; here, passing one group as another's parent
  //      indents it by construction.
  //
  // Matches the sub-option styling in Word-Smith (.ws-settings-sub), so the
  // two plugins' settings panels read the same way.
  subGroup(containerEl: HTMLElement) {
    return containerEl.createDiv({ cls: "cursor-smith-sub" });
  }

  // Small all-caps label used to split a section into sub-groups (e.g. Torch
  // Spotlight's "Spotlight" vs "Environment" controls) without opening a
  // whole new collapsible section for them.
  renderSubheading(containerEl: HTMLElement, title: string) {
    containerEl.createDiv({ cls: "cursor-smith-subsection-title", text: title });
  }

  // -------------------------------------------------------------------------
  // Shared look/effect settings renderer.
  //
  // renderNormalSection (the global cursor) and renderModeControls (one Vim
  // mode's own snapshot) render an identical set of settings - Appearance,
  // Blinking, Smooth Movement, Effects - that used to be duplicated by hand
  // across both, ~150 lines each. The only real differences between the two
  // are *where the values live* and *what happens after a save*, so those are
  // the only things a caller supplies:
  //
  //   get(key)                    - read the current value for `key`
  //   set(key)                    - returns an onChange handler: write the
  //                                 value where it lives and save. Must put
  //                                 the value in memory synchronously, before
  //                                 its first await - the re-render below
  //                                 reads it back straight away.
  //   renderCursorStyleSetting(body, rerender)
  //                               - builds the "Cursor Style" dropdown
  //                                 Setting. Kept as a caller-supplied hook
  //                                 (rather than a generic set) because the
  //                                 global panel needs an extra
  //                                 plugin.enable() call after saving that a
  //                                 Vim mode does not. Call `rerender()`
  //                                 after the write, never this.display().
  //   renderTorchToggleSetting(body, rerender)
  //                               - builds the "Torch Spotlight" toggle
  //                                 Setting. Also a caller-supplied hook: the
  //                                 global panel must start/stop the torch
  //                                 engine immediately on toggle, which has no
  //                                 Vim-mode equivalent (see the comment at
  //                                 that call site). Same `rerender` rule.
  //
  // There is no setAndRedraw any more. A toggle that reveals or hides other
  // rows goes through `redraw(key)` below, which re-renders only the section
  // the toggle lives in - plus any section that has declared, in its
  // `rerenderOn` list, that it reads the key from elsewhere. display() is no
  // longer involved: it empties the whole panel, and doing that for a toggle
  // two thirds of the way down a very long panel cost a full teardown and
  // rebuild of every row to change three.
  //
  // Returns the gate registry, for the tests: which section each redraw key
  // lives in, and which sections declared it. The completeness test flips
  // every key and requires that no section OTHER than those changes its rows,
  // so a new cross-section read fails the build until it is declared.
  // -------------------------------------------------------------------------
  renderLookSettings(containerEl, { get, set, renderCursorStyleSetting, renderTorchToggleSetting }) {
    // --- Section-local re-render ------------------------------------------
    // `rerenders` is filled in as the sections below are built, `current` is
    // the section being built right now, and `redraw(key)` binds to it at
    // build time - so by the time anything is clicked the registry is
    // complete and every handler knows its home.
    const rerenders = new Map();      // section title -> () => void
    const rerenderOn = new Map();     // key -> Set of section titles that declared it
    const gates = new Map();          // key -> home section title
    let current = null;

    const section = (title, opts, renderFn) => {
      for (const key of opts.rerenderOn || []) {
        if (!rerenderOn.has(key)) rerenderOn.set(key, new Set());
        rerenderOn.get(key).add(title);
      }
      this.renderSection(containerEl, title, (body, rerender) => {
        rerenders.set(title, rerender);
        const prev = current;
        current = title;
        try { renderFn(body); } finally { current = prev; }
      }, { open: opts.open });
    };

    // Re-render the section `key` lives in and every section that reads it.
    const rerenderFor = (key, home) => {
      const targets = new Set([home]);
      for (const t of rerenderOn.get(key) || []) targets.add(t);
      for (const t of targets) {
        const fn = rerenders.get(t);
        if (fn) fn();
      }
    };

    // An onChange handler for a gated control: write through `set`, then
    // re-render. The re-render runs as soon as the value is in memory rather
    // than after the save lands on disk - the rows read memory, and the
    // panel responding a disk write later is what the old full rebuild felt
    // like. The save's promise is still returned so a failure surfaces.
    const redraw = (key) => {
      const home = current;
      gates.set(key, home);
      return async (v) => {
        const saved = set(key)(v);
        rerenderFor(key, home);
        await saved;
      };
    };

    // For the two caller-built controls: the re-render they call after their
    // own write, bound to the section they were built in.
    const afterWrite = (key) => {
      const home = current;
      gates.set(key, home);
      return () => rerenderFor(key, home);
    };

    // Several colour pickers on ONE Setting, so they lay out side by side in
    // that row's control area (Obsidian's .setting-item-control is already a
    // flex row; .cursor-smith-color-row only adds the gap between swatches)
    // instead of each claiming its own full-width labelled row.
    //
    // Order carries the meaning here - there is nowhere to hang a per-swatch
    // label - so every caller's description has to state what the order is.
    const swatchRow = (parent, label, keys, desc) => {
      const row = new Setting(parent).setName(label).setDesc(desc);
      row.settingEl.addClass("cursor-smith-color-row");
      for (const key of keys) {
        row.addColorPicker((cp) =>
          cp.setValue(get(key) || DEFAULT_SETTINGS[key]).onChange(set(key)));
      }
      return row;
    };

    // --- "Restore default" on every slider ---------------------------------
    // A small icon button sitting to the right of a slider, putting that one
    // dial back to its DEFAULT_SETTINGS value. Every slider in this panel gets
    // one, from this one helper - so there is no per-row copy of "what is this
    // slider's default" to drift out of date, and a new slider that forgets
    // the button is visibly the odd one out.
    //
    // The write goes through redraw even for the sliders whose own onChange
    // is the cheaper `set`. A slider's handle position is DOM state that
    // nothing else in the panel updates, so without a re-render the value
    // would change underneath a handle still sitting where the user left it -
    // i.e. the button would look broken while working perfectly. The
    // re-render also re-runs the gates, which is what the dials that reveal
    // other rows need (flameTrailGravity's angle, say). It is the section's
    // own re-render, so the rest of the panel does not move.
    //
    // The default is read from DEFAULT_SETTINGS rather than from the
    // `?? fallback` at the call site: those fallbacks are what a *sparse*
    // Vim-mode snapshot displays for a key it has never been given, and the
    // two are not obliged to agree (overlayFlickerAmount's don't). What the
    // button promises is the default, so it reads the defaults.
    const resetSlider = (key) => (btn) => {
      const reset = redraw(key);
      return btn
        .setIcon("rotate-ccw")
        .setTooltip(`Restore default (${DEFAULT_SETTINGS[key]})`)
        .onClick(() => reset(DEFAULT_SETTINGS[key]));
    };

    section("Appearance", {}, (body) => {
      renderCursorStyleSetting(body, afterWrite("cursorStyle"));

      // Everything that applies to exactly one cursor style lives here, in a
      // sub-group hanging directly off the dropdown that selects it, so the
      // section reads as "Cursor Style, then the options for the style you
      // picked". Box's options (Show Letter Inside Cursor, Hollow) used to sit
      // below the colour pickers instead, which put three unrelated settings
      // between a style and its own sub-options.
      const style = get("cursorStyle");

      if (style === "Line") {
        const g = this.subGroup(body);
        new Setting(g)
          .setName("Cursor Thickness")
          .setDesc("How thick the Line cursor is, in pixels.")
          .addSlider((slider) => slider.setLimits(1, 12, 1).setValue(get("caretWidthPx")).setDynamicTooltip().onChange(set("caretWidthPx")))
          .addExtraButton(resetSlider("caretWidthPx"));

        new Setting(g)
          .setName("Serifs")
          .setDesc("Adds I-beam serifs at the top and bottom of the line.")
          .addToggle((toggle) => toggle.setValue(get("lineSerifs")).onChange(set("lineSerifs")));
      }

      if (style === "Underline") {
        const g = this.subGroup(body);
        new Setting(g)
          .setName("Underline Thickness")
          .setDesc("Thickness of the underline, in pixels. 0 = automatic, scaled to the line height.")
          .addSlider((slider) => slider.setLimits(0, 12, 1).setValue(get("underlineWidthPx") ?? 0).setDynamicTooltip().onChange(set("underlineWidthPx")))
          .addExtraButton(resetSlider("underlineWidthPx"));
      }

      if (style === "Box") {
        const g = this.subGroup(body);
        new Setting(g)
          .setName("Show Letter Inside Cursor")
          .setDesc(get("boxHollow") || get("cursorTranslucent")
            ? `Shows the letter inside the block, colors flipped. Does nothing while ${get("boxHollow") ? "Hollow" : "Translucent"} is on.`
            : "Shows the letter inside the block, with the colors flipped.")
          .addToggle((toggle) => toggle.setValue(get("showChar")).onChange(set("showChar")));

        if (get("showChar")) {
          new Setting(this.subGroup(g))
            .setName("Letter Color")
            .setDesc("Contrast: neutral black or white. Tinted: the flipped colour, kept legible. Inverted: raw flip.")
            .addDropdown((dd) => dd
              .addOptions({ contrast: "Contrast", tinted: "Tinted", invert: "Inverted" })
              .setValue(get("glyphColorMode") || "contrast")
              .onChange(set("glyphColorMode")));
        }

        new Setting(g)
          .setName("Hollow")
          .setDesc("Draws only the outline of the box instead of a filled block.")
          .addToggle((toggle) => toggle.setValue(get("boxHollow")).onChange(redraw("boxHollow")));

        if (get("boxHollow")) {
          // Nested one level deeper: Outline Width is conditional on Hollow,
          // which is itself a sub-option of the style.
          const g2 = this.subGroup(g);
          new Setting(g2)
            .setName("Outline Width")
            .setDesc("Thickness of the hollow box's outline, in pixels.")
            .addSlider((slider) => slider.setLimits(1, 6, 1).setValue(get("boxHollowWidth")).setDynamicTooltip().onChange(set("boxHollowWidth")))
            .addExtraButton(resetSlider("boxHollowWidth"));
        }
      }

      new Setting(body).setName("Gradient")
        .setDesc("Blends several colors instead of one flat color.")
        .addToggle((toggle) => toggle.setValue(!!get("gradientEnabled")).onChange(redraw("gradientEnabled")));

      if (get("gradientEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Number of Colors")
          .setDesc("How many colors the blend runs through, from 2 to 4.")
          .addDropdown((d) => d.addOptions({ 2: "2", 3: "3", 4: "4" })
            .setValue(String(get("gradientCount") ?? 2))
            // Dropdown values are strings; store a number so the engine's
            // clamping arithmetic doesn't have to care where the value came
            // from. Redraws the panel to add or remove color pickers.
            .onChange((v) => redraw("gradientCount")(Number(v))));

        const count = Math.max(2, Math.min(4, Number(get("gradientCount")) || 2));
        const keys = (prefix) => Array.from({ length: count }, (_, i) => prefix + (i + 1));
        swatchRow(g, "Colors (Dark Theme)", keys("gradientDark"),
          "In order from the top of the cursor to the bottom — or left to right for the Underline style.");
        swatchRow(g, "Colors (Light Theme)", keys("gradientLight"),
          "The same ramp for light themes, where neon colors tend to wash out.");
      } else {
        // One row, two swatches - dark theme then light - rather than the two
        // full-width labelled rows this used to be. Same helper, same layout as
        // the gradient rows above, and it is the pattern the panel already
        // established for "several pickers that belong to one idea"; splitting
        // a pair of colours across two rows spent a lot of vertical space in a
        // panel this long to say something the description says in six words.
        swatchRow(body, "Cursor Color", ["colorDark", "colorLight"],
          "Dark theme first, then light. Kept separate because neon colors that look right on a dark background wash out on a white page.");
      }

      new Setting(body).setName("Cursor Opacity").setDesc("How see-through the cursor is.")
        .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("cursorOpacity")).setDynamicTooltip().onChange(set("cursorOpacity")))
        .addExtraButton(resetSlider("cursorOpacity"));

      new Setting(body).setName("Translucent")
        .setDesc("Blends the cursor into the page instead of painting over it. Overrides Show Letter Inside Cursor.")
        .addToggle((toggle) => toggle.setValue(!!get("cursorTranslucent")).onChange(redraw("cursorTranslucent")));

      new Setting(body).setName("Rounded Corners")
        .setDesc("Softens the cursor's corners. Line and Underline become fully rounded bars; Box gets a gentler curve.")
        .addToggle((toggle) => toggle.setValue(!!get("cursorRounded")).onChange(set("cursorRounded")));
    });

    section("Blinking", {}, (body) => {
      new Setting(body)
        .setName("Blinking")
        .setDesc("Makes the cursor blink.")
        .addToggle((toggle) => toggle.setValue(get("blinkingEnabled")).onChange(redraw("blinkingEnabled")));

      if (get("blinkingEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Blink Speed").setDesc("How fast the cursor blinks.")
          .addSlider((s) => s.setLimits(0.1, 3, 0.1).setValue(get("blinkSpeed")).setDynamicTooltip().onChange(set("blinkSpeed")))
          .addExtraButton(resetSlider("blinkSpeed"));
        new Setting(g).setName("Blink Balance").setDesc("How the blink cycle is split between lit and dark.")
          .addSlider((s) => s.setLimits(0.1, 0.9, 0.05).setValue(get("blinkOnOffBalance")).setDynamicTooltip().onChange(set("blinkOnOffBalance")))
          .addExtraButton(resetSlider("blinkOnOffBalance"));
        new Setting(g).setName("Fade Smoothness").setDesc("How gradually the cursor fades in and out. 0.15 is the original feel.")
          .addSlider((s) => s.setLimits(0.05, 0.5, 0.05).setValue(get("blinkFade") ?? 0.15).setDynamicTooltip().onChange(set("blinkFade")))
          .addExtraButton(resetSlider("blinkFade"));
        new Setting(g).setName("Don't Blink While Typing").setDesc("Keeps the cursor fully lit while you type or move it.")
          .addToggle((toggle) => toggle.setValue(get("smoothStopBlinking")).onChange(set("smoothStopBlinking")));
        new Setting(g).setName("Blink Delay").setDesc("How long the cursor stays lit after a keystroke, in ms.")
          .addSlider((s) => s.setLimits(0, 2000, 50).setValue(get("blinkDelayMs") ?? 0).setDynamicTooltip().onChange(set("blinkDelayMs")))
          .addExtraButton(resetSlider("blinkDelayMs"));
        new Setting(g).setName("Stop After").setDesc("Blink this many times after each move, then stay lit. 0 blinks forever.")
          .addSlider((s) => s.setLimits(0, 20, 1).setValue(get("blinkStopAfter") ?? 0).setDynamicTooltip().onChange(set("blinkStopAfter")))
          .addExtraButton(resetSlider("blinkStopAfter"));
        new Setting(g).setName("Breathing").setDesc("The cursor swells and shrinks instead of fading out.")
          .addToggle((toggle) => toggle.setValue(!!get("blinkBreathing")).onChange(redraw("blinkBreathing")));
        if (get("blinkBreathing")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Breath Depth").setDesc("How far the cursor shrinks at the bottom of the breath.")
            .addSlider((s) => s.setLimits(0.05, 0.5, 0.05).setValue(get("blinkBreathDepth") ?? 0.2).setDynamicTooltip().onChange(set("blinkBreathDepth")))
            .addExtraButton(resetSlider("blinkBreathDepth"));
        }
      }
    });

    section("Smooth Movement", {}, (body) => {
      new Setting(body)
        .setName("Smooth Movement")
        .setDesc("Makes the cursor glide to its new spot instead of jumping there instantly.")
        .addToggle((toggle) => toggle.setValue(get("smoothEnabled")).onChange(redraw("smoothEnabled")));

      if (get("smoothEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Glide Amount")
          .setDesc("How much the cursor eases as it travels.")
          .addSlider((s) => s.setLimits(0.05, 0.30, 0.05).setValue(get("smoothness")).setDynamicTooltip().onChange(set("smoothness")))
          .addExtraButton(resetSlider("smoothness"));
        new Setting(g).setName("Catch-Up Speed")
          .setDesc("How quickly the cursor chases the real caret.")
          .addSlider((s) => s.setLimits(0.30, 0.80, 0.05).setValue(get("catchUpSpeed")).setDynamicTooltip().onChange(set("catchUpSpeed")))
          .addExtraButton(resetSlider("catchUpSpeed"));
        // Max Catch-Up Speed is meaningless on its own - it is only ever read
        // inside the adaptive branch - so it hangs off that toggle rather than
        // sitting beside it as a live-looking slider that does nothing.
        new Setting(g).setName("Speed Up When Typing Fast")
          .setDesc("Lets the cursor exceed Catch-Up Speed while you type, so it can't fall behind.")
          .addToggle((toggle) => toggle.setValue(get("smoothAdaptive")).onChange(redraw("smoothAdaptive")));
        if (get("smoothAdaptive")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Max Catch-Up Speed")
            .setDesc("The fastest the speed-up is allowed to get.")
            .addSlider((s) => s.setLimits(0.50, 1.0, 0.05).setValue(get("maxCatchUpSpeed")).setDynamicTooltip().onChange(set("maxCatchUpSpeed")))
            .addExtraButton(resetSlider("maxCatchUpSpeed"));
        }
        new Setting(g).setName("Movement Delay")
          .setDesc("Delay before the cursor sets off, in ms. 0 follows immediately.")
          .addSlider((s) => s.setLimits(0, 500, 10).setValue(get("moveDelayMs")).setDynamicTooltip().onChange(set("moveDelayMs")))
          .addExtraButton(resetSlider("moveDelayMs"));
      }
    });

    // Effects reads two gates that live in other sections: Gradient decides
    // whether Pixel Trail's Gradient Colors, Energy Beam's Aurora and Neon's
    // Gradient Trail are offered, and Blinking decides whether the torch's
    // Sync With Blink is. Declaring them here is what makes those rows appear
    // and disappear when the toggle in the OTHER section is flipped.
    section("Effects", { rerenderOn: ["gradientEnabled", "blinkingEnabled"] }, (body) => {
      // Pop Effects: one group for everything the cursor throws off in
      // response to a keystroke. Rainbow is a modifier across all four, so it
      // sits at the BOTTOM of the group rather than nested under any one of
      // them - and only once at least one of them is actually on, since with
      // the whole group idle it is a switch that recolours nothing.
      //
      // It used to sit directly under the group toggle, above the effects. That
      // put the modifier before the things it modifies, so the first thing
      // anyone opening Pop Effects met was an option that did nothing yet.
      new Setting(body).setName("Pop Effects")
        .setDesc("Things the cursor throws off as you type — letters, lightning and fireworks.")
        .addToggle((toggle) => toggle.setValue(!!get("popEffects")).onChange(redraw("popEffects")));
      if (get("popEffects")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Popping Letters")
          .setDesc("Each character you type springs out of the cursor and tumbles away as it fades.")
          .addToggle((toggle) => toggle.setValue(get("popLetters")).onChange(redraw("popLetters")));

        // Sits next to Popping Letters on purpose: they're the pair that fires
        // per character, one for adding and one for removing. The two below
        // are the bigger, rarer events.
        new Setting(g).setName("Backspace Disintegration")
          .setDesc(get("popRainbow")
            ? "Deleting throws a burst outward. Rainbow takes the next color in the sweep, inverted."
            : "Deleting throws a burst outward in inverted colors.")
          // redraw, not set: Rainbow at the bottom of this group appears as
          // soon as any one of the four effects is on, so this row now
          // controls another row's visibility and has to redraw the section.
          .addToggle((toggle) => toggle.setValue(get("backspaceDisintegrate")).onChange(redraw("backspaceDisintegrate")));

        new Setting(g).setName("Thunderstrike")
          .setDesc("Enter calls down a bolt of pixelated lightning onto the new line.")
          .addToggle((toggle) => toggle.setValue(!!get("thunderstrike")).onChange(redraw("thunderstrike")));
        if (get("thunderstrike")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Bolt Size")
            .setDesc("How fine the lightning is, in pixels per block.")
            .addSlider((s) => s.setLimits(1, 5, 1).setValue(get("thunderstrikeSize") ?? 2).setDynamicTooltip().onChange(set("thunderstrikeSize")))
            .addExtraButton(resetSlider("thunderstrikeSize"));
          new Setting(g2).setName("Strength")
            .setDesc(get("popRainbow")
              ? "How brightly the strike shows. Rainbow colors each bolt."
              : "How brightly the strike shows.")
            .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("thunderstrikeStrength") ?? 0.5).setDynamicTooltip().onChange(set("thunderstrikeStrength")))
            .addExtraButton(resetSlider("thunderstrikeStrength"));
        }

        new Setting(g).setName("Fireworks")
          .setDesc("Space and Enter send shells climbing out of the cursor to burst above it.")
          .addToggle((toggle) => toggle.setValue(!!get("fireworks")).onChange(redraw("fireworks")));
        if (get("fireworks")) {
          const g2 = this.subGroup(g);
          // The colour source isn't configurable - it follows Rainbow, then
          // Gradient, then the cursor colour - so it's described rather than
          // offered, and the description says which of those is currently in
          // play instead of listing rules that may not apply.
          new Setting(g2).setName("Quantity")
            .setDesc("How many shells go up per keypress, and how much each throws.")
            .addSlider((s) => s.setLimits(0.2, 3, 0.1).setValue(get("fireworksQuantity") ?? 1).setDynamicTooltip().onChange(set("fireworksQuantity")))
            .addExtraButton(resetSlider("fireworksQuantity"));
        }

        // Rainbow last, and only when there is something for it to recolour.
        // The four effects above are independent of each other; this is the one
        // control in the group that reaches all of them, so it reads as a
        // summary of the group rather than as another sibling effect.
        //
        // Note the gate is on the four effects, NOT on popEffects: the group
        // can be on with every effect inside it off, and that is exactly the
        // state where a Rainbow toggle is a switch that visibly does nothing.
        // Same rule as Sync With Blink under the torch, and Gradient Colors
        // under Pixel Trail.
        const anyPop = !!get("popLetters") || !!get("backspaceDisintegrate") ||
                       !!get("thunderstrike") || !!get("fireworks");
        if (anyPop) {
          new Setting(g).setName("Rainbow")
            .setDesc("Sweeps every pop effect around the color wheel as you type.")
            // Redraws rather than just saving: this toggle changes what the
            // Backspace Disintegration, Thunderstrike and Fireworks rows above
            // say about where their colors come from, and those descriptions
            // are built at render time.
            .addToggle((toggle) => toggle.setValue(get("popRainbow")).onChange(redraw("popRainbow")));
        }
      }

      new Setting(body).setName("Pixel Trail")
        .setDesc("Scatters a small puff of colored pixels wherever the cursor has just been.")
        .addToggle((toggle) => toggle.setValue(get("flameTrail")).onChange(redraw("flameTrail")));
      if (get("flameTrail")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Density")
          .setDesc("How many pixels the trail sheds. 0 hides them entirely.")
          .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("flameTrailDensity") ?? 1).setDynamicTooltip().onChange(set("flameTrailDensity")))
          .addExtraButton(resetSlider("flameTrailDensity"));
        new Setting(g).setName("Trail On Jump")
          .setDesc("Lays pixels along the whole path of a jump, not just at the start.")
          .addToggle((toggle) => toggle.setValue(!!get("flameTrailOnJump")).onChange(set("flameTrailOnJump")));
        new Setting(g).setName("Pixel Lifetime")
          .setDesc("How long each pixel lasts before it fades out, in milliseconds.")
          .addSlider((s) => s.setLimits(100, 2000, 50).setValue(get("flameTrailLifeMs") ?? 400).setDynamicTooltip().onChange(set("flameTrailLifeMs")))
          .addExtraButton(resetSlider("flameTrailLifeMs"));
        new Setting(g).setName("Pixel Size")
          .setDesc("How big each pixel is.")
          .addSlider((s) => s.setLimits(1, 12, 0.5).setValue(get("flameTrailPixelSize") ?? 4).setDynamicTooltip().onChange(set("flameTrailPixelSize")))
          .addExtraButton(resetSlider("flameTrailPixelSize"));
        // Only meaningful with a gradient to sample - offered only when Gradient
        // is on, so it isn't a switch that visibly does nothing.
        if (get("gradientEnabled")) {
          new Setting(g).setName("Gradient Colors")
            .setDesc("Colors each pixel from the cursor's gradient instead of one flat color.")
            .addToggle((toggle) => toggle.setValue(!!get("flameTrailGradientColors")).onChange(set("flameTrailGradientColors")));
        }
        new Setting(g).setName("Gravity")
          .setDesc("A steady pull on the pixels. 0 leaves them drifting sideways.")
          .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(get("flameTrailGravity") ?? 0).setDynamicTooltip().onChange(redraw("flameTrailGravity")))
          .addExtraButton(resetSlider("flameTrailGravity"));
        if ((get("flameTrailGravity") ?? 0) > 0) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Gravity Direction")
            .setDesc("Which way the pull goes, in degrees. 0 is down, 90 right, 180 up, 270 left.")
            .addSlider((s) => s.setLimits(0, 359, 5).setValue(get("flameTrailGravityAngle") ?? 0).setDynamicTooltip().onChange(set("flameTrailGravityAngle")))
            .addExtraButton(resetSlider("flameTrailGravityAngle"));
        }
      }

      new Setting(body).setName("Stardust")
        .setDesc("A slow stream of floating pixels that drift up and fade.")
        .addToggle((toggle) => toggle.setValue(!!get("stardustEnabled")).onChange(redraw("stardustEnabled")));
      if (get("stardustEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Always On")
          .setDesc("Streams continuously instead of waiting for the cursor to settle.")
          .addToggle((toggle) => toggle.setValue(!!get("stardustAlwaysOn")).onChange(redraw("stardustAlwaysOn")));
        // The delay is what Always On overrides, so hide it rather than leave
        // a live-looking slider that no longer does anything.
        if (!get("stardustAlwaysOn")) {
          new Setting(g).setName("Idle Delay")
            .setDesc("How long (in ms) the cursor must sit still before the stardust starts.")
            .addSlider((s) => s.setLimits(500, 8000, 250).setValue(get("stardustDelayMs") ?? 2000).setDynamicTooltip().onChange(set("stardustDelayMs")))
            .addExtraButton(resetSlider("stardustDelayMs"));
        }
        new Setting(g).setName("Density")
          .setDesc("How thickly the stardust streams off the cursor.")
          .addSlider((s) => s.setLimits(0.2, 3, 0.1).setValue(get("stardustRate") ?? 1).setDynamicTooltip().onChange(set("stardustRate")))
          .addExtraButton(resetSlider("stardustRate"));

        new Setting(g).setName("Orbit")
          .setDesc("Motes circle the cursor like fireflies instead of drifting up.")
          .addToggle((toggle) => toggle.setValue(!!get("stardustOrbit")).onChange(redraw("stardustOrbit")));
        if (get("stardustOrbit")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Orbit Radius")
            .setDesc("How wide the motes circle, in pixels.")
            .addSlider((s) => s.setLimits(10, 60, 2).setValue(get("stardustOrbitRadius") ?? 22).setDynamicTooltip().onChange(set("stardustOrbitRadius")))
            .addExtraButton(resetSlider("stardustOrbitRadius"));
        }
      }

      new Setting(body).setName("Bracket Tether")
        .setDesc("Underlines the span between matching brackets or quotes.")
        .addToggle((toggle) => toggle.setValue(!!get("bracketTether")).onChange(redraw("bracketTether")));
      if (get("bracketTether")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Strength")
          .setDesc("How visible the line is.")
          .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("bracketTetherStrength") ?? 0.35).setDynamicTooltip().onChange(set("bracketTetherStrength")))
          .addExtraButton(resetSlider("bracketTetherStrength"));
      }

      new Setting(body).setName("Motion Smear")
        .setDesc("The cursor stretches as it moves and snaps back when it arrives.")
        .addToggle((toggle) => toggle.setValue(get("smear")).onChange(redraw("smear")));
      if (get("smear")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Stiffness")
          .setDesc("How hard the leading edge is pulled toward the new position.")
          .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("smearStiffness")).setDynamicTooltip().onChange(set("smearStiffness")))
          .addExtraButton(resetSlider("smearStiffness"));
        new Setting(g).setName("Trailing Stiffness")
          .setDesc("The same for the edge left behind.")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("smearTrailingStiffness")).setDynamicTooltip().onChange(set("smearTrailingStiffness")))
          .addExtraButton(resetSlider("smearTrailingStiffness"));
        new Setting(g).setName("Damping")
          .setDesc("How much the springs resist overshooting.")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("smearDamping")).setDynamicTooltip().onChange(set("smearDamping")))
          .addExtraButton(resetSlider("smearDamping"));
        new Setting(g).setName("Tapered Trail")
          .setDesc("Narrows the smear to a point behind the cursor, like a comet tail.")
          .addToggle((toggle) => toggle.setValue(!!get("smearTaper")).onChange(redraw("smearTaper")));
        if (get("smearTaper")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Taper Amount")
            .setDesc("How sharply the tail closes. At 1 it comes to a full point.")
            .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("smearTaperAmount") ?? 0.7).setDynamicTooltip().onChange(set("smearTaperAmount")))
            .addExtraButton(resetSlider("smearTaperAmount"));
        }
      }

      new Setting(body).setName("Energy Beam")
        .setDesc(get("gradientEnabled")
          ? "Scrolls your gradient along the cursor, with a brightness pulse riding over it."
          : "Runs a shimmering pulse of light along the cursor.")
        .addToggle((toggle) => toggle.setValue(get("energyEffect")).onChange(redraw("energyEffect")));
      if (get("energyEffect")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Beam Speed")
          .setDesc("How fast the pulse travels along the cursor.")
          .addSlider((s) => s.setLimits(0.2, 3, 0.1).setValue(get("energySpeed")).setDynamicTooltip().onChange(set("energySpeed")))
          .addExtraButton(resetSlider("energySpeed"));
        // Aurora has nothing to work with without a ramp - it warps and
        // cross-mixes gradient colors - so it only appears once Gradient is on.
        if (get("gradientEnabled")) {
          new Setting(g).setName("Aurora")
            .setDesc("Swirls your gradient colors instead of scrolling them past.")
            .addToggle((toggle) => toggle.setValue(!!get("energyAurora")).onChange(redraw("energyAurora")));
          if (get("energyAurora")) {
            const g2 = this.subGroup(g);
            new Setting(g2).setName("Waviness")
              .setDesc("How hard the bands bend. 0 keeps them flat.")
              .addSlider((s) => s.setLimits(0, 2, 0.05).setValue(get("energyAuroraWaviness") ?? 1).setDynamicTooltip().onChange(set("energyAuroraWaviness")))
              .addExtraButton(resetSlider("energyAuroraWaviness"));
          }
        }
      }

      new Setting(body).setName("CRT Effect")
        .setDesc("Old-monitor phosphor look: the cursor leaves fading ghosts behind it.")
        .addToggle((toggle) => toggle.setValue(get("crtEffect")).onChange(redraw("crtEffect")));
      if (get("crtEffect")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Trail Length")
          .setDesc("How many ghosts are kept behind the cursor. 0 leaves none.")
          .addSlider((s) => s.setLimits(0, 30, 1).setValue(get("trailLength")).setDynamicTooltip().onChange(set("trailLength")))
          .addExtraButton(resetSlider("trailLength"));
        new Setting(g).setName("Trail Fade Time")
          .setDesc("How long (in ms) each ghost takes to fade out.")
          .addSlider((s) => s.setLimits(50, 1500, 25).setValue(get("trailFadeMs")).setDynamicTooltip().onChange(set("trailFadeMs")))
          .addExtraButton(resetSlider("trailFadeMs"));
        new Setting(g).setName("Glow")
          .setDesc(get("speedDemon") && !get("speedDemonNoCursorHeat")
            ? "Soft halo around the cursor, in its own color. Speed Demon is on, so the halo swells as the cursor heats up and settles back as it cools."
            : "Soft halo around the cursor, in its own color.")
          .addToggle((toggle) => toggle.setValue(get("glow")).onChange(redraw("glow")));
        new Setting(g).setName("Neon Trail")
          .setDesc("Renders the ghosts as a glowing neon tube instead of fading boxes.")
          .addToggle((toggle) => toggle.setValue(!!get("crtNeon")).onChange(redraw("crtNeon")));
        if (get("crtNeon")) {
          const g2 = this.subGroup(g);
          if (get("gradientEnabled")) {
            new Setting(g2).setName("Gradient Trail")
              .setDesc("Runs the cursor's gradient along the streak, newest ghost to oldest.")
              .addToggle((toggle) => toggle.setValue(!!get("crtNeonGradient")).onChange(set("crtNeonGradient")));
          }
        }
        new Setting(g).setName("Signal Glitch")
          .setDesc("Long jumps break up like a mistracked video signal.")
          .addToggle((toggle) => toggle.setValue(!!get("crtGlitch")).onChange(redraw("crtGlitch")));
        if (get("crtGlitch")) {
          const g3 = this.subGroup(g);
          new Setting(g3).setName("Break-Up")
            .setDesc("How far the slices are thrown and how much the cursor's shape warps.")
            .addSlider((s) => s.setLimits(0.2, 2.5, 0.1).setValue(get("crtGlitchStrength") ?? 1).setDynamicTooltip().onChange(set("crtGlitchStrength")))
            .addExtraButton(resetSlider("crtGlitchStrength"));
          new Setting(g3).setName("Color Split")
            .setDesc("How far the color channels separate. 0 only tears the shape.")
            .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("crtGlitchAberration") ?? 1).setDynamicTooltip().onChange(set("crtGlitchAberration")))
            .addExtraButton(resetSlider("crtGlitchAberration"));
          new Setting(g3).setName("Duration")
            .setDesc("How long each burst lasts, in milliseconds.")
            .addSlider((s) => s.setLimits(60, 600, 10).setValue(get("crtGlitchMs") ?? 220).setDynamicTooltip().onChange(set("crtGlitchMs")))
            .addExtraButton(resetSlider("crtGlitchMs"));
        }
      }

      new Setting(body).setName("Speed Demon")
        .setDesc("The cursor heats from grey to white-hot as you type, then cools when you stop.")
        .addToggle((toggle) => toggle.setValue(get("speedDemon")).onChange(redraw("speedDemon")));
      if (get("speedDemon")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Fire Sparks")
          .setDesc("Throws embers off the cursor once it is hot enough.")
          .addToggle((toggle) => toggle.setValue(get("speedDemonSparks")).onChange(redraw("speedDemonSparks")));
        if (get("speedDemonSparks")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Spark Quantity")
            .setDesc("How many embers spawn per burst. 0 stops them without switching the effect off.")
            .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("speedDemonSparkQuantity") ?? 1).setDynamicTooltip().onChange(set("speedDemonSparkQuantity")))
            .addExtraButton(resetSlider("speedDemonSparkQuantity"));
          new Setting(g2).setName("Spark Trail")
            .setDesc("Gives each spark a fading comet tail, in pixels. 0 = no trail.")
            .addSlider((s) => s.setLimits(0, 30, 1).setValue(get("speedDemonSparkTrail") ?? 0).setDynamicTooltip().onChange(set("speedDemonSparkTrail")))
            .addExtraButton(resetSlider("speedDemonSparkTrail"));
        }
        new Setting(g).setName("Keep Cursor Color")
          .setDesc("The cursor keeps your color; only the sparks react to speed.")
          .addToggle((toggle) => toggle.setValue(get("speedDemonNoCursorHeat") ?? false).onChange(redraw("speedDemonNoCursorHeat")));
        new Setting(g).setName("Sensitivity")
          .setDesc("How fast typing and caret movement heat the cursor up.")
          .addSlider((s) => s.setLimits(0.5, 2, 0.1).setValue(get("speedDemonSensitivity")).setDynamicTooltip().onChange(set("speedDemonSensitivity")))
          .addExtraButton(resetSlider("speedDemonSensitivity"));

        // Hidden while Keep Cursor Color is on: that option says the cursor
        // shouldn't change colour with speed at all, which makes a custom
        // colour ramp for exactly that a contradiction rather than a choice.
        if (!get("speedDemonNoCursorHeat")) {
          new Setting(g).setName("Custom Gradient")
            .setDesc("Replaces the built-in heat curve with four colors of your own.")
            .addToggle((toggle) => toggle.setValue(!!get("speedDemonGradient")).onChange(redraw("speedDemonGradient")));
          if (get("speedDemonGradient")) {
            const g2 = this.subGroup(g);
            // Same one-Setting-per-row layout the Gradient section uses, so the
            // four pickers sit side by side instead of each claiming a row.
            const heatRow = (label, prefix, desc) => {
              const row = new Setting(g2).setName(label).setDesc(desc);
              row.settingEl.addClass("cursor-smith-color-row");
              for (let i = 1; i <= 4; i++) {
                const key = prefix + i;
                row.addColorPicker((cp) =>
                  cp.setValue(get(key) || DEFAULT_SETTINGS[key]).onChange(set(key)));
              }
            };
            heatRow("Stages (Dark Theme)", "speedHeatDark",
              "Warming to flat out, left to right. At rest the cursor keeps its own color.");
            heatRow("Stages (Light Theme)", "speedHeatLight",
              "The same four stages for light themes, where a white-hot final stage disappears into the page.");
          }
        }
      }

      new Setting(body).setName("Hot-head")
        .setDesc("Sets the text you're working on alight.")
        .addToggle((toggle) => toggle.setValue(!!get("hotHead")).onChange(redraw("hotHead")));
      if (get("hotHead")) {
        const gh = this.subGroup(body);
        new Setting(gh).setName("Fire Quantity")
          .setDesc("How much fire is emitted. 0 puts it out without switching Hot-head off.")
          .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("hotHeadQuantity") ?? 1).setDynamicTooltip().onChange(set("hotHeadQuantity")))
          .addExtraButton(resetSlider("hotHeadQuantity"));
        new Setting(gh).setName("Fire Spread")
          .setDesc("How much surrounding text catches, in characters. 0 burns only the cursor's own column.")
          .addSlider((s) => s.setLimits(0, 14, 1).setValue(get("hotHeadSpread") ?? 4).setDynamicTooltip().onChange(set("hotHeadSpread")))
          .addExtraButton(resetSlider("hotHeadSpread"));
        new Setting(gh).setName("Trail Over Text")
          .setDesc("Fire laid along the path travelled. 0 keeps it where the cursor stops.")
          .addSlider((s) => s.setLimits(0, 30, 1).setValue(get("hotHeadTrail") ?? 6).setDynamicTooltip().onChange(set("hotHeadTrail")))
          .addExtraButton(resetSlider("hotHeadTrail"));
        new Setting(gh).setName("Flame Height")
          .setDesc("How high the flames climb before they burn out.")
          .addSlider((s) => s.setLimits(0.15, 1.5, 0.05).setValue(get("hotHeadHeight") ?? 0.55).setDynamicTooltip().onChange(set("hotHeadHeight")))
          .addExtraButton(resetSlider("hotHeadHeight"));
        new Setting(gh).setName("Fade Time")
          .setDesc("How long a single fire particle lasts, in milliseconds.")
          .addSlider((s) => s.setLimits(200, 1600, 20).setValue(get("hotHeadFade") ?? 620).setDynamicTooltip().onChange(set("hotHeadFade")))
          .addExtraButton(resetSlider("hotHeadFade"));
        new Setting(gh).setName("Idle Timeout")
          .setDesc("Idle time before the fire burns out. 0 keeps it burning forever.")
          .addSlider((s) => s.setLimits(0, 6000, 100).setValue(get("hotHeadIdleMs") ?? 1500).setDynamicTooltip().onChange(set("hotHeadIdleMs")))
          .addExtraButton(resetSlider("hotHeadIdleMs"));
        new Setting(gh).setName("Fire Opacity")
          .setDesc("How solid the fire is, independent of the cursor's own opacity.")
          .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("hotHeadOpacity") ?? 1).setDynamicTooltip().onChange(set("hotHeadOpacity")))
          .addExtraButton(resetSlider("hotHeadOpacity"));
        new Setting(gh).setName("Use Cursor Color")
          .setDesc("Paints the fire in the cursor's color instead of the heat gradient.")
          .addToggle((toggle) => toggle.setValue(!!get("hotHeadFlat")).onChange(redraw("hotHeadFlat")));
        // Nested under Use Cursor Color, and hidden without it, because that
        // is the only mode it can actually do anything in - see
        // hotHeadSpeedHeat's gate in drawHotHead. Also hidden without Speed
        // Demon itself, since there would be no heat to follow.
        if (get("hotHeadFlat") && get("speedDemon")) {
          const gf = this.subGroup(gh);
          new Setting(gf).setName("Heat With Speed Demon")
            .setDesc("The fire warms up as you type, following Speed Demon's heat.")
            .addToggle((toggle) => toggle.setValue(!!get("hotHeadSpeedHeat")).onChange(redraw("hotHeadSpeedHeat")));
        }
      }

      renderTorchToggleSetting(body, afterWrite("torchEffect"));
      if (get("torchEffect")) {
        // One group for the whole spotlight, with the two subheadings inside
        // it: Spotlight and Environment are labels within the torch's options,
        // not siblings of the torch toggle itself.
        const g = this.subGroup(body);
        this.renderSubheading(g, "Spotlight");
        new Setting(g).setName("Follow")
          .setDesc("What the light tracks.")
          .addDropdown((d) => d.addOptions({ caret: "Text Cursor Only", mouse: "Mouse Pointer Only", auto: "Auto Intelligent Swap" })
            .setValue(get("overlayFollowMode")).onChange(set("overlayFollowMode")));
        new Setting(g).setName("Light Size")
          .setDesc("How far the lit circle reaches, in pixels.")
          .addSlider((s) => s.setLimits(100, 800, 10).setValue(get("overlayRadius")).setDynamicTooltip().onChange(set("overlayRadius")))
          .addExtraButton(resetSlider("overlayRadius"));
        // Only offered when there's a blink to sync to - with blinking off the
        // toggle would be a switch that does nothing, and the reason why would
        // be in a different section of the panel.
        if (get("blinkingEnabled")) {
          new Setting(g).setName("Sync With Blink")
            .setDesc("The light closes in as the cursor blinks out and opens back up as it returns.")
            .addToggle((toggle) => toggle.setValue(!!get("overlayBlinkSync")).onChange(redraw("overlayBlinkSync")));
          if (get("overlayBlinkSync")) {
            const g2 = this.subGroup(g);
            new Setting(g2).setName("Pulse Depth")
              .setDesc("How far the light closes at its darkest, as a share of Light Size. At 1 it goes out.")
              .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("overlayBlinkDepth") ?? 0.25).setDynamicTooltip().onChange(set("overlayBlinkDepth")))
              .addExtraButton(resetSlider("overlayBlinkDepth"));
          }
        }
        new Setting(g).setName("Light Color")
          .setDesc("The color of the light at its center.")
          .addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor")));
        new Setting(g).setName("Follow Speed")
          .setDesc("How quickly the light catches up when the cursor moves.")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("overlaySpeed")).setDynamicTooltip().onChange(set("overlaySpeed")))
          .addExtraButton(resetSlider("overlaySpeed"));

        this.renderSubheading(g, "Environment");
        new Setting(g).setName("Darkness")
          .setDesc("How far everything outside the light is dimmed.")
          .addSlider((s) => s.setLimits(0.2, 1, 0.01).setValue(get("overlayDarkness")).setDynamicTooltip().onChange(set("overlayDarkness")))
          .addExtraButton(resetSlider("overlayDarkness"));
        new Setting(g).setName("Glow Strength")
          .setDesc("Strength of the warm glow. 0 gives a pure spotlight.")
          .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(get("overlayIntensity")).setDynamicTooltip().onChange(set("overlayIntensity")))
          .addExtraButton(resetSlider("overlayIntensity"));
        // Sits under Glow Strength because that is the value it modulates: the
        // flame swings either side of whatever that slider is set to, so at 0
        // there is nothing to flicker and this says so rather than appearing to
        // be broken.
        new Setting(g).setName("Flicker")
          .setDesc(get("overlayIntensity") > 0
            ? "The light gutters like a candle instead of burning steady."
            : "The light gutters like a candle. Does nothing while Glow Strength is 0.")
          .addToggle((toggle) => toggle.setValue(!!get("overlayFlicker")).onChange(redraw("overlayFlicker")));
        if (get("overlayFlicker")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Flicker Depth")
            .setDesc("How far the flame swings either side of Glow Strength. At 1 it gutters right out.")
            .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("overlayFlickerAmount") ?? 0.35).setDynamicTooltip().onChange(set("overlayFlickerAmount")))
            .addExtraButton(resetSlider("overlayFlickerAmount"));
        }
        new Setting(g).setName("Keep Sidebars Lit")
          .setDesc("Dims only the editor, leaving sidebars and ribbon lit. Desktop only.")
          .addToggle((toggle) => toggle.setValue(get("overlaySpareSidebars")).onChange(set("overlaySpareSidebars")));
      }
    });

    return { gates, rerenderOn };
  }

  renderNormalSection(containerEl: HTMLElement) {
    const plugin = this.plugin;
    const set = (key) => async (v) => { plugin.settings[key] = v; await plugin.saveSettings(); };

    this.renderSection(containerEl, "Presets", (body) => {
      if (plugin._pendingPresetName === undefined) plugin._pendingPresetName = "";
      new Setting(body)
        .setName("Save current settings as preset")
        .setDesc("Give your cursor a name, then click Save.")
        .addText((text) => {
          text.setPlaceholder("My cursor name");
          text.setValue(plugin._pendingPresetName);
          text.onChange((v) => { plugin._pendingPresetName = v; });
        })
        .addButton((btn) => {
          btn.setButtonText("Save").setCta();
          btn.onClick(async () => {
            const name = plugin._pendingPresetName.trim();
            if (!name) return;
            await plugin.saveUserPreset(name);
            plugin._pendingPresetName = "";
            this.display();
          });
        });

      let importCode = "";
      new Setting(body)
        .setName("Import preset")
        .setDesc("Paste a share code from someone else to add their preset.")
        .addText((text) => {
          text.setPlaceholder("Paste code here…");
          text.onChange((v) => { importCode = v.trim(); });
          text.inputEl.addClass("cursor-smith-code-input");
        })
        .addButton((btn) => {
          btn.setButtonText("Import").onClick(async () => {
            if (!importCode) return;
            const imported = await plugin.importPreset(importCode);
            if (imported) {
              this.display();
            } else {
              // The two code kinds are one character apart at a glance, so say
              // which mistake was made rather than a flat "invalid".
              btn.setButtonText(importCode.startsWith(SHARE_VERSION_VIM + "|")
                ? "That's a Vim code" : "Invalid code");
              window.setTimeout(() => { btn.setButtonText("Import"); }, 2000);
            }
          });
        });

      const presets = plugin.getUserPresets();
      const names = Object.keys(presets);

      if (names.length === 0) {
        body.createEl("p", {
          cls: "cursor-smith-note",
          text: "No saved presets yet. Configure your cursor below, then save it above.",
        });
      } else {
        for (const name of names) {
          this.renderPresetRow(body, name, presets[name], {
            onLoad: async () => { await plugin.loadUserPreset(name); plugin._pendingPresetName = name; this.display(); },
            onEdit: async () => {
              await plugin.loadUserPreset(name);
              plugin._pendingPresetName = name;
              this.display();
              containerEl.scrollTop = 0;
            },
            onDelete: async () => { await plugin.deleteUserPreset(name); this.display(); },
          });
        }
      }
    });

    // Note: "General" (Hide Real Cursor / Hide Cursor When Unfocused) used to
    // be a section here. Both are structural rather than look settings, and
    // both were unreachable from the Vim panel while they lived in this one,
    // so they now render once in display() above the CUA/Vim switch.

    // Everything from "what does the cursor look like" through "what effects
    // does it use" is identical in shape whether it's this global cursor or
    // one Vim mode's own snapshot - see renderLookSettings, shared with
    // renderModeControls below.
    this.renderLookSettings(containerEl, {
      get: (key) => plugin.settings[key],
      set,
      renderCursorStyleSetting: (body, rerender) => {
        new Setting(body)
          .setName("Cursor Style")
          .setDesc("The shape of the cursor itself.")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
              .setValue(plugin.settings.cursorStyle)
              // Re-render as soon as the value is in memory, not after the
              // save lands - the rows read memory, and enable() does too.
              .onChange(async (value) => {
                plugin.settings.cursorStyle = value;
                const saved = plugin.saveSettings();
                plugin.enable();
                rerender();
                await saved;
              })
          );
      },
      // Torch Spotlight owns a whole separate engine (torchEngineActive) that
      // needs to be started/stopped immediately on toggle, rather than just
      // having its setting saved - a Vim mode doesn't need this since its
      // torch state is already picked up by the shared engine's per-frame
      // torchPossible() scan across all modes.
      renderTorchToggleSetting: (body, rerender) => {
        new Setting(body)
          .setName("Torch Spotlight")
          .setDesc("Darkens everything except a pool of light around the cursor.")
          .addToggle((toggle) =>
            toggle.setValue(plugin.settings.torchEffect).onChange(async (value) => {
              plugin.settings.torchEffect = value;
              const saved = plugin.saveSettings();
              if (plugin.settings.enabled) {
                value ? plugin.enableTorchOverlay() : plugin.disableTorchOverlay();
              }
              rerender();
              await saved;
            })
          );
      },
    });
  }

  // -------------------------------------------------------------------------
  // Shared preset-row UI (name, share code pill, Copy, Load, Edit, Delete).
  //
  // `code` is a caller option because the two preset kinds serialise
  // differently: a regular preset is one look (presetToCode), a Vim preset is
  // five (vimPresetToCode). This row used to build the code itself with
  // presetToCode, which is correct for one caller and silently produced an
  // empty, contentless code for the other.
  // -------------------------------------------------------------------------
  renderPresetRow(containerEl: any, name: string, snap: any, { onLoad, onEdit, onDelete, code }: { onLoad?: any; onEdit?: any; onDelete?: any; code?: string }) {
    if (code === undefined) code = presetToCode(name, snap);
    const setting = new Setting(containerEl).setName(name);

    const codeEl = setting.controlEl.createEl("code", { text: code, cls: "cursor-smith-share-code" });
    codeEl.title = code;

    const copyBtn = setting.controlEl.createEl("button", { text: "Copy", cls: "cursor-smith-copy-button" });
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = "Copied!";
        window.setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    });

    setting
      .addButton((btn) => btn.setButtonText("Load").onClick(onLoad))
      .addButton((btn) => btn.setButtonText("Edit").onClick(onEdit))
      .addButton((btn) => btn.setButtonText("Delete").setWarning().onClick(onDelete));

    return setting;
  }

  // -------------------------------------------------------------------------
  // Vim Mode settings section — shown in full when the switch is on "Vim".
  // -------------------------------------------------------------------------
  renderVimSection(containerEl: HTMLElement) {
    const plugin = this.plugin;

    new Setting(containerEl).setName("⌨ Vim cursors").setHeading();

    new Setting(containerEl)
      .setName("Control Obsidian's Vim key bindings")
      .setDesc("Lets this plugin turn Obsidian's Vim key bindings on and off with the mode.")
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.vimControlObsidian).onChange(async (value) => {
          plugin.settings.vimControlObsidian = value;
          // Taking ownership mid-session: immediately enforce the current
          // mode so the keybindings match what the panel shows.
          if (value) plugin.setObsidianVim(!!plugin.settings.vimModeEnabled);
          await plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Show Vim mode in status bar")
      .setDesc("Shows the live mode in the status bar, vim-style: -- NORMAL --.")
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.vimStatusBar).onChange(async (value) => {
          plugin.settings.vimStatusBar = value;
          plugin.syncVimStatusBar();
          await plugin.saveSettings();
          this.display();
        })
      );

    if (plugin.settings.vimStatusBar) {
      new Setting(this.subGroup(containerEl))
        .setName("Color status bar text to match the cursor")
        .setDesc("Tints the mode name with that mode's cursor color.")
        .addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimStatusBarColor).onChange(async (value) => {
            plugin.settings.vimStatusBarColor = value;
            await plugin.saveSettings();
          })
        );
    }

    if (!plugin.isObsidianVimOn()) {
      const warn = containerEl.createEl("p", {
        text: plugin.settings.vimControlObsidian
          ? "⚠ Obsidian's Vim key bindings look off right now. They should switch on automatically — reopen the editor if the mode cursors don't appear."
          : "⚠ Obsidian's Vim key bindings are off, so mode cursors won't appear. Enable them in Settings → Editor → Vim key bindings, or turn on \"Control Obsidian's Vim key bindings\" above.",
      });
      warn.addClass("cursor-smith-note", "cursor-smith-note-warning");
    }

    // --- Vim presets, styled exactly like the normal preset list ---
    new Setting(containerEl).setName("Vim presets").setHeading();

    if (plugin._pendingVimPresetName === undefined) plugin._pendingVimPresetName = "";
    new Setting(containerEl)
      .setName("Save current Vim setup as preset")
      .setDesc("Give this set of per-mode cursors a name, then click Save.")
      .addText((text) => {
        text.setPlaceholder("My vim theme");
        text.setValue(plugin._pendingVimPresetName);
        text.onChange((v) => { plugin._pendingVimPresetName = v; });
      })
      .addButton((btn) => {
        btn.setButtonText("Save").setCta();
        btn.onClick(async () => {
          const name = (plugin._pendingVimPresetName || "").trim();
          if (!name) return;
          await plugin.saveVimPreset(name);
          plugin._pendingVimPresetName = "";
          this.display();
        });
      });

    let importVimCode = "";
    new Setting(containerEl)
      .setName("Import Vim preset")
      .setDesc("Paste a Vim share code to add all five mode cursors at once.")
      .addText((text) => {
        text.setPlaceholder("Paste code here…");
        text.onChange((v) => { importVimCode = v.trim(); });
        text.inputEl.addClass("cursor-smith-code-input");
      })
      .addButton((btn) => {
        btn.setButtonText("Import").onClick(async () => {
          if (!importVimCode) return;
          const imported = await plugin.importVimPreset(importVimCode);
          if (imported) {
            this.display();
          } else {
            btn.setButtonText(importVimCode.startsWith(SHARE_VERSION + "|")
              ? "That's a regular code" : "Invalid code");
            window.setTimeout(() => { btn.setButtonText("Import"); }, 2000);
          }
        });
      });

    const presets = plugin.getVimPresets();
    const names = Object.keys(presets);

    if (names.length === 0) {
      containerEl.createEl("p", {
        cls: "cursor-smith-note",
        text: "No saved Vim presets yet. Configure each mode below, then save it above.",
      });
    } else {
      for (const name of names) {
        const setting = this.renderPresetRow(containerEl, name, presets[name], {
          code: vimPresetToCode(name, presets[name]),
          onLoad: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.display();
          },
          onEdit: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.display();
            containerEl.scrollTop = 0;
          },
          onDelete: async () => { await plugin.deleteVimPreset(name); this.display(); },
        });
        if (name === plugin.settings.vimActivePreset) setting.setDesc("Currently active");
      }
    }

    // --- Per-mode editor: pick one mode, then edit its FULL cursor config ---
    new Setting(containerEl).setName("Per-mode cursors").setHeading();

    if (!VIM_MODE_KEYS.includes(plugin._vimEditMode)) plugin._vimEditMode = "normal";

    // Tab row — one tab per Vim mode, replacing the old dropdown. Same visual
    // language as the CUA/Vim segmented switch at the top of the panel. Each
    // inactive tab's label is tinted with that mode's own cursor color (for
    // the current theme), so the row doubles as a live color legend; the
    // active tab uses the accent background instead, where a tint would be
    // unreadable.
    const isDarkTheme = containerEl.ownerDocument?.body?.classList?.contains("theme-dark") ?? true;
    const tabWrap = containerEl.createDiv({ cls: "cursor-smith-segmented cursor-smith-segmented-modes" });
    for (const m of VIM_MODE_KEYS) {
      const active = plugin._vimEditMode === m;
      const cfg = plugin.settings.vimModes[m] || {};
      const tint = isDarkTheme ? cfg.colorDark : cfg.colorLight;
      const btn = tabWrap.createEl("button", {
        text: VIM_MODE_LABELS[m],
        cls: active ? "cursor-smith-segment is-active" : "cursor-smith-segment",
      });
      // The one thing that is per mode and per theme: the tab takes the
      // mode's cursor colour (the active tab is on the accent, where a tint
      // would be unreadable).
      if (!active && tint) btn.setCssStyles({ color: tint });
      btn.addEventListener("click", () => {
        if (plugin._vimEditMode === m) return;
        plugin._vimEditMode = m;
        this.display();
      });
    }

    const mode = plugin._vimEditMode;
    const target = plugin.settings.vimModes[mode];
    new Setting(containerEl).setName(`${VIM_MODE_LABELS[mode]} mode cursor`).setHeading();

    if (mode === "command") {
      const note = containerEl.createEl("p", {
        text:
          "Applies whenever the caret leaves the note editor: the built-in Vim command " +
          "line (the \":\" / \"/\" prompt) and the rest of the Obsidian interface — Command " +
          "Palette, Quick Switcher, search, rename boxes, Settings fields and plugin modals. " +
          "Motion effects (smear, smooth movement, CRT trail) are best left off here: these " +
          "are all single-line fields, so they read as jitter rather than movement.",
      });
      note.addClass("cursor-smith-note");
    }

    this.renderModeControls(containerEl, target, () => {
      plugin.settings.vimActivePreset = "";
    });
  }

  // Renders the FULL set of cursor look/effect controls bound to an arbitrary
  // settings-shaped `target` object (here, one Vim mode's snapshot).
  renderModeControls(containerEl: HTMLElement, target, onEdit) {
    const plugin = this.plugin;
    const after = onEdit || (() => {});
    const set = (key) => async (v) => { target[key] = v; after(); await plugin.saveSettings(); };
    // Write, then re-render the section - the same shape renderLookSettings
    // gives its own gated toggles.
    const setR = (key, rerender) => async (v) => { const saved = set(key)(v); rerender(); await saved; };

    this.renderLookSettings(containerEl, {
      get: (key) => target[key],
      set,
      renderCursorStyleSetting: (body, rerender) => {
        new Setting(body)
          .setName("Cursor Style")
          .setDesc("The shape of the cursor itself.")
          .addDropdown((d) =>
            d.addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
              .setValue(target.cursorStyle).onChange(setR("cursorStyle", rerender))
          );
      },
      renderTorchToggleSetting: (body, rerender) => {
        new Setting(body).setName("Torch Spotlight")
          .setDesc("Darkens everything except a pool of light around the cursor.")
          .addToggle((t) => t.setValue(target.torchEffect).onChange(setR("torchEffect", rerender)));
      },
    });
  }
}
/* nosourcemap */
/* nosourcemap */
