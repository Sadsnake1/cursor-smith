// Part of the plugin class, split out by responsibility (HANDOFF §1.17,
// ARCHITECTURE "Should this be split?"): the methods below are assigned
// onto CursorSmithPlugin.prototype and declared on the class, so every
// `this.x` read and every test reach them exactly as before. `this` is
// the plugin.
//
// Vim mode: the switch (uiMode / vimModeEnabled kept in step, Obsidian's
// own Vim key bindings driven when allowed), which mode the editor is in
// right now (the CM5 adapter, the command line, the interface), and the
// status bar's -- NORMAL --.

import { Notice } from "obsidian";
import { isTextCaretHost } from "./motion";
import { VIM_MODE_LABELS } from "./settings";
import type { EditorView } from "@codemirror/view";
import type CursorSmithPlugin from "./plugin";

export const vimMethods = {
  // Whether the plugin is currently "in Vim mode" for command purposes.
  // uiMode is the user-facing switch and vimModeEnabled is the feature flag;
  // renderModeSwitch and setVimModeEnabled keep them in step, but an install that
  // predates uiMode can have only the latter, so treat either as Vim.
  isVimUiMode(this: CursorSmithPlugin): boolean {
    return (this.settings.uiMode || "cua") === "vim" || !!this.settings.vimModeEnabled;
  },

  // The palette's CUA/Vim switch. Deliberately a wrapper around
  // setVimModeEnabled rather than a second way of doing the same thing: the
  // panel's segmented control and this command have to stay on one path, or
  // the two drift the moment either grows a step.
  //
  // Single-flight, and that guard exists FOR the palette. A segmented button
  // cannot be clicked again mid-flight; a hotkey held down re-fires as fast as
  // the OS repeats it, and setVimModeEnabled awaits a disk write in the middle
  // of a chain that rebuilds every editor's extensions. Without this, a held
  // key stacks overlapping switches whose saveSettings() calls race.
  //
  // Reads through isVimUiMode() rather than settings.uiMode directly, so an
  // install predating uiMode (vimModeEnabled only) toggles the right way on
  // the first press instead of appearing to do nothing.
  async toggleUiMode(this: CursorSmithPlugin) {
    if (this._uiModeSwitching) return;
    this._uiModeSwitching = true;
    try {
      const next = !this.isVimUiMode();
      await this.setVimModeEnabled(next);
      // The status bar indicator only exists in Vim mode, so switching TO CUA
      // would otherwise be a silent no-feedback command - it removes the one
      // thing that was showing the mode. Say which mode you landed in.
      new Notice(`Cursor-Smith: ${next ? "Vim" : "CUA / Normal"} mode`);
      this.refreshSettingTab();
    } finally {
      // In a finally, not after the await: setVimModeEnabled swallows its own
      // side-effect failures but saveSettings() is not guarded, and a flag
      // left stuck true would kill the command for the rest of the session.
      this._uiModeSwitching = false;
    }
  },

  // =========================================================================
  // Vim-aware cursors
  // =========================================================================

  // Single entry point for turning the plugin's Vim cursors on/off. Two
  // callers, and they must stay the only two: the settings panel's CUA/Vim
  // switch (renderModeSwitch) and the palette command (toggleUiMode, which
  // wraps this rather than repeating it). Also:
  //  • drives Obsidian's own Vim keybindings when vimControlObsidian is set
  //    (remembering the prior state so turning the feature off restores it),
  //  • creates/removes the status bar mode indicator.
  async setVimModeEnabled(this: CursorSmithPlugin, value: boolean) {
    value = !!value;

    // 1. Flip and PERSIST the core state before any side effect runs, so the
    //    mode change is on disk no matter what the steps below do.
    this.settings.vimModeEnabled = value;
    this.settings.uiMode = value ? "vim" : "cua";
    await this.saveSettings();

    // 2. Drive Obsidian's own Vim keybindings — symmetric and level-triggered:
    //    Vim mode means ON, CUA mode means OFF, every time, no edge detection
    //    and no memory. This used to "restore whatever Obsidian's vim was
    //    before we forced it on", which is cleverer but proved fragile in
    //    practice: any bug or crash that captured OUR OWN forced-on state as
    //    the "previous" value poisoned the restore permanently — switching to
    //    CUA would then dutifully restore vim to on, forever, and the toggle
    //    looked dead. With vimControlObsidian the user has said the plugin
    //    owns this setting, so own it plainly in both directions. (Someone who
    //    manages Obsidian's vim by hand should keep vimControlObsidian off,
    //    which skips this entirely.)
    if (this.settings.vimControlObsidian) {
      try {
        if (value) {
          this.setObsidianVim(true);
          // Switching the vim engine on mid-session leaves the editor in
          // insert mode: the vim extension is added to an editor that was
          // already accepting free-form typing, and nothing tells it to enter
          // normal. Vim itself would land you in normal, so force it.
          this.forceVimNormalMode();
        } else {
          this.setObsidianVim(false);
        }
      } catch (e) {
        console.error("[cursor-smith] driving Obsidian vim keybindings failed:", e);
      }
    }

    // 3. Create or tear down the status bar item to match the new mode.
    try {
      this.syncVimStatusBar();
    } catch (e) {
      console.error("[cursor-smith] vim status bar update failed:", e);
    }
  },

  // Drop every open editor into Normal mode.
  //
  // Sending a synthetic Escape rather than poking cm.state.vim.insertMode
  // directly is deliberate: exiting insert is not just a flag flip. The vim
  // engine also has to close the change/undo group it opened on entry, run any
  // pending repeat (so a half-finished "3i" doesn't fire later), and move the
  // caret back one column the way real vim does. Clearing the flag by hand
  // skips all of that and leaves the engine inconsistent — Escape runs the
  // engine's own exit path, which is the only thing that gets it all right.
  //
  // updateOptions() rebuilds the editor's extensions asynchronously, so the
  // vim extension usually isn't installed yet on the first attempt; retry on a
  // short timer until the adapter shows up, then give up rather than spin.
  forceVimNormalMode(this: CursorSmithPlugin, attempt = 0) {
    // Single-flight: a fresh call (or a mode flip back to CUA) supersedes any
    // pending retry, so rapid toggling of the settings switch can never stack
    // parallel retry chains, each dispatching its own Escapes.
    if (this._vimNormalRetryT) {
      window.clearTimeout(this._vimNormalRetryT);
      this._vimNormalRetryT = 0;
    }
    // The feature was switched off while a retry was pending — stop.
    if (!this.settings.vimModeEnabled) return;
    let anyEditor = false;
    try {
      for (const view of this.allEditorViews()) {
        anyEditor = true;
        const cm = this.getVimAdapter(view);
        // No adapter yet => the vim extension hasn't loaded into this editor.
        if (!cm) { anyEditor = false; break; }
        const v = cm.state.vim || {};
        if (!v.insertMode && !v.visualMode) continue; // already normal
        const target = view.contentDOM;
        if (!target) continue;
        const win = target.ownerDocument.defaultView || window;
        target.dispatchEvent(new win.KeyboardEvent("keydown", {
          key: "Escape", code: "Escape", keyCode: 27, which: 27,
          bubbles: true, cancelable: true,
        }));
      }
    } catch (e) {
      // Best effort - never let this break the mode switch itself.
      this._reportOnce("forceVimNormalMode", e);
    }
    if (!anyEditor && attempt < 20) {
      this._vimNormalRetryT = window.setTimeout(() => {
        this._vimNormalRetryT = 0;
        this.forceVimNormalMode(attempt + 1);
      }, 50);
    }
  },

  // Every live CodeMirror view across all open markdown leaves (including
  // pop-out windows), not just the focused one — switching modes should settle
  // every editor, otherwise a background tab stays in insert until you visit
  // it and press Escape yourself.
  allEditorViews(this: CursorSmithPlugin): EditorView[] {
    const views: EditorView[] = [];
    const push = (v: EditorView | null | undefined) => { if (v && !views.includes(v)) views.push(v); };
    try {
      push(this.app.workspace.activeEditor?.editor?.cm);
      this.app.workspace.iterateAllLeaves?.((leaf) => {
        push(leaf?.view?.editor?.cm);
      });
    } catch (e) {
      // iterateAllLeaves is stable API, but stay defensive.
      this._reportOnce("allEditorViews", e);
    }
    return views;
  },

  // Turn Obsidian's built-in Vim keybindings on/off. setConfig is semi-internal
  // (guarded); updateOptions asks the workspace to re-derive editor extensions
  // so the change can take effect without a reload where that's supported.
  setObsidianVim(this: CursorSmithPlugin, on: boolean) {
    try {
      if (this.app.vault.setConfig) this.app.vault.setConfig("vimMode", !!on);
      this.app.workspace.updateOptions?.();
    } catch (e) {
      // Best effort; otherwise it applies on the next editor reload.
      this._reportOnce("setObsidianVim", e);
    }
  },

  // Whether Obsidian's own Vim keybindings are turned on (Settings → Editor →
  // Vim key bindings). getConfig is a semi-internal API, so it's fully guarded.
  isObsidianVimOn(this: CursorSmithPlugin): boolean {
    try {
      return !!(this.app.vault.getConfig && this.app.vault.getConfig("vimMode"));
    } catch (e) {
      // "Off" is the safe answer, but a config read that throws is news.
      this._reportOnce("isObsidianVimOn", e);
      return false;
    }
  },

  // @replit/codemirror-vim (the vim engine Obsidian bundles) stashes a CM5-
  // compatible adapter on the EditorView; its own getCM(view) helper just
  // returns view.cm. We read it directly rather than importing the vim module,
  // since that module isn't guaranteed to be requireable from a plugin. The
  // adapter exposes the live vim state at cm.state.vim, which is what we need.
  getVimAdapter(this: CursorSmithPlugin, view: EditorView) {
    try {
      const cm = view && view.cm;
      if (cm && cm.state && cm.state.vim) return cm;
    } catch {
      /* fall through to DOM detection */
    }
    return null;
  },

  // Is a block ("fat") cursor currently shown? @replit/codemirror-vim toggles
  // the .cm-fat-cursor class on the content element for block-cursor modes
  // (normal/visual/replace). Insert mode uses a thin caret. This is the
  // fallback signal when the adapter isn't reachable.
  _vimBlockCursorShown(this: CursorSmithPlugin, view: EditorView): boolean {
    try {
      const content = view.contentDOM;
      if (content && content.classList && content.classList.contains("cm-fat-cursor")) return true;
      const root = view.dom;
      return !!(root && "querySelector" in root && root.querySelector(".cm-fat-cursor"));
    } catch (e) {
      this._reportOnce("_vimBlockCursorShown", e);
      return false;
    }
  },

  // Resolve the current Vim mode to one of VIM_MODE_KEYS, or null when it
  // can't be determined. Prefers the adapter's authoritative state (the only
  // way to reliably see "replace"); falls back to selection + block-cursor
  // heuristics, which cover normal/insert/visual but report replace as normal.
  detectVimMode(this: CursorSmithPlugin, view: EditorView): string | null {
    const cm = this.getVimAdapter(view);
    if (cm) {
      const v = cm.state.vim || {};
      if (v.visualMode) return "visual";
      if (v.insertMode) {
        // Overwrite/replace ("R") is an insert-family state; the adapter marks
        // it via state.overwrite (and, in some builds, a vim flag). Either one
        // means replace.
        const replace = cm.state.overwrite || v.insertModeReplace || v.replaceMode;
        return replace ? "replace" : "insert";
      }
      return "normal";
    }
    // Adapter unavailable — infer from the editor.
    try {
      if (!view.state.selection.main.empty) return "visual";
      return this._vimBlockCursorShown(view) ? "normal" : "insert";
    } catch (e) {
      this._reportOnce("detectVimMode", e);
      return null;
    }
  },

  // Is the caret currently somewhere in Obsidian's interface rather than in a
  // note? That covers both halves of what "Command" means here:
  //
  //   • the built-in Vim command line — the ":" / "/" prompt, which the vim
  //     engine mounts as a CodeMirror panel with its own <input>, and
  //   • every other interface text field: Command Palette, Quick Switcher,
  //     search, file-tree rename, Settings inputs, other plugins' modals.
  //
  // The test is "a text field has focus and it isn't the note editor", which
  // is exactly the condition under which caretCoords() falls through to
  // genericCaretCoords() — so Command mode themes precisely the carets the
  // editor-aware path doesn't handle, with no gap and no overlap.
  //
  // isTextCaretHost keeps this off elements that have no caret at all
  // (checkboxes, sliders, buttons); without it, clicking a toggle in Obsidian's
  // own settings would count as entering Command mode.
  isVimCommandContext(this: CursorSmithPlugin) {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      // The note editor has focus, so a real editing mode applies instead.
      if (view && view.hasFocus) return false;
      // Follow the active editor's window, then the canvas's, so this keeps
      // working in pop-out windows (same convention as the caret helpers).
      const doc =
        (view && view.dom && view.dom.ownerDocument) ||
        this.canvas?.ownerDocument ||
        document;
      return isTextCaretHost(doc.activeElement);
    } catch (e) {
      this._reportOnce("isVimCommandContext", e);
      return false;
    }
  },

  // The Vim mode that should currently drive the cursor's look, or null when
  // vim theming shouldn't apply (feature off, Obsidian vim off, or no caret
  // anywhere). Memoized for a frame so the several styleFor()/color reads per
  // draw don't each re-run detection.
  currentVimMode(this: CursorSmithPlugin): string | null {
    if (!this.settings.vimModeEnabled) return null;
    const now = performance.now();
    if (this._vimModeCacheT && now - this._vimModeCacheT < 15) return this._vimModeCache;

    let mode = null;
    try {
      if (this.isObsidianVimOn()) {
        // Interface/command line first. Whenever one of those fields has focus
        // the editor does not, so view.hasFocus is false and the branch below
        // would report null (no vim theming at all) — this check has to happen
        // before that gate, not inside it.
        if (this.isVimCommandContext()) {
          mode = "command";
        } else {
          const view = this.app.workspace.activeEditor?.editor?.cm;
          if (view && view.hasFocus) mode = this.detectVimMode(view);
        }
      }
    } catch (e) {
      this._reportOnce("currentVimMode", e);
      mode = null;
    }
    this._vimModeCache = mode;
    this._vimModeCacheT = now;
    return mode;
  },

  // Called from the canvas tick the frame the active Vim mode changes. The
  // torch tick already reacts per-frame to the effective settings, but clearing
  // its cached style/rect signatures here makes the spotlight update on the
  // very next frame instead of waiting for the dedupe key to differ.
  onVimModeChanged(this: CursorSmithPlugin) {
    this._overlaySig = "";
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    // Repaint the status bar label on the same frame as the cursor, so the two
    // never disagree about which mode you're in.
    this.updateVimStatusBar();
  },

  // =========================================================================
  // Vim mode indicator in Obsidian's status bar
  // =========================================================================

  // The mode the status bar should name. Falls back to reading the editor
  // directly when currentVimMode() returns null (focus is on a button, the
  // ribbon, empty space...): the editor is still in whatever mode it was, and
  // blanking the item every time focus touches a non-text element would make
  // it flicker constantly.
  statusBarVimMode(this: CursorSmithPlugin) {
    if (!this.settings.vimModeEnabled || !this.isObsidianVimOn()) return null;
    const live = this.currentVimMode();
    if (live) return live;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (view) return this.detectVimMode(view);
    } catch {
      /* no editor open */
    }
    return null;
  },

  // Create the status bar element on demand, remove it when it shouldn't be
  // there. Kept as add/remove rather than a permanently-present hidden element
  // so the status bar doesn't carry an empty slot (and its separator padding)
  // for everyone who has the indicator switched off.
  syncVimStatusBar(this: CursorSmithPlugin) {
    // addStatusBarItem is a desktop-only Obsidian API (mobile has no status
    // bar). Guarded so the whole mode toggle can't die over an indicator.
    if (typeof this.addStatusBarItem !== "function") return;
    const wanted = !!(this.settings.vimStatusBar && this.settings.vimModeEnabled);
    if (wanted && !this.vimStatusEl) {
      this.vimStatusEl = this.addStatusBarItem();
      this.vimStatusEl.addClass?.("cursor-smith-vim-status");
      // Pin to the LEFT edge of the status bar. Obsidian lays status items
      // out in one flex row packed toward the right; there's no official
      // "left side" API. flex `order` puts this item first in the row, and
      // `margin-right: auto` then absorbs all the free space after it, which
      // shoves every other item to the right and leaves this one flush left
      // — the standard flexbox left/right split. The class is styles.css's
      // (.cursor-smith-vim-status); it used to be inline out of a worry about
      // a stale cached stylesheet, and the plugin review rules static inline
      // styles out (obsidianmd/no-static-styles-assignment).
      this.vimStatusEl.addClass("cursor-smith-vim-status");
      this._vimStatusSig = null;
    } else if (!wanted && this.vimStatusEl) {
      this.vimStatusEl.remove();
      this.vimStatusEl = null;
      this._vimStatusSig = null;
    }
    this.updateVimStatusBar();
  },

  updateVimStatusBar(this: CursorSmithPlugin) {
    const el = this.vimStatusEl;
    if (!el) return;
    try {
      const mode = this.statusBarVimMode();

      // Theme is part of the signature because the per-mode colors are
      // theme-dependent: switching dark→light has to re-tint the text even
      // though the mode itself never changed.
      const doc = el.ownerDocument || document;
      const isDark = doc.body.classList.contains("theme-dark");
      const tint = !!this.settings.vimStatusBarColor;
      const sig = `${mode}|${isDark}|${tint}`;
      if (sig === this._vimStatusSig) return;
      this._vimStatusSig = sig;

      if (!mode) { el.setText(""); el.setCssStyles({ color: "" }); return; }

      // Vim's own showmode format: "-- INSERT --", all caps.
      el.setText(`-- ${(VIM_MODE_LABELS[mode] || mode).toUpperCase()} --`);
      if (!tint) {
        // Clear rather than assign a "default": the status bar's own color is
        // theme-provided, so inheriting it is the only way to stay correct
        // across themes.
        el.setCssStyles({ color: "" });
        return;
      }
      // The mode's stored config, not the look: this tints the status bar for
      // the mode it names, whether or not that mode is the active one.
      const cfg = (this.settings.vimModes && this.settings.vimModes[mode]) || null;
      el.style.color = cfg ? (isDark ? cfg.colorDark : cfg.colorLight) : "";
    } catch (e) {
      // A bad frame must not kill the interval.
      this._reportOnce("updateVimStatusBar", e);
    }
  },
};
export type VimMethods = typeof vimMethods;
