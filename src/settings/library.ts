// Part of the plugin class, split out by responsibility (HANDOFF §1.17,
// ARCHITECTURE "Should this be split?"): the methods below are assigned
// onto CursorSmithPlugin.prototype and declared on the class, so every
// `this.x` read and every test reach them exactly as before. `this` is
// the plugin.
//
// The preset library: the user's presets and the Vim five-mode presets -
// save, load, delete, cycle, import from a share code - on the settings
// object, saved through saveSettings.

import { Notice } from "obsidian";
import {
  VIM_MODE_KEYS,
  VIM_STATE_KEYS,
  cloneVimModes,
  pickLook,
  presetWithDefaults,
  vimModeSnapshot,
} from "./settings";
import { codeToPreset, codeToVimPreset } from "./share";
import { rollLook } from "./randomize";
import type { RollOptions } from "./randomize";
import type { CursorSmithSettings, Look } from "../types";

// One roll taken back: the look it replaced, where (null: the global
// look; else a Vim mode), and the preset that was in use.
export interface RollUndo { mode: string | null; look: Partial<Look>; preset: string }
const ROLL_UNDO_DEPTH = 20;
import type CursorSmithPlugin from "../plugin";

export const libraryMethods = {
  // ---- User preset CRUD ----

  getUserPresets(this: CursorSmithPlugin) {
    // Keep userPresets directly on this.settings so saveSettings() persists
    // them automatically. Initialise lazily on first use.
    if (!this.settings.userPresets) this.settings.userPresets = {};
    return this.settings.userPresets;
  },

  async saveUserPreset(this: CursorSmithPlugin, name: string) {
    // Snapshot cursor settings only - exclude housekeeping keys that must
    // not be restored when the preset is loaded later.
    const snap: Partial<CursorSmithSettings> = Object.assign({}, this.settings);
    delete snap.enabled;
    delete snap.userPresets;
    // Vim theming is its own independent system with its own presets — a
    // regular cursor preset must not carry (or later clobber) it.
    for (const k of VIM_STATE_KEYS) delete snap[k];
    this.getUserPresets()[name] = snap;
    await this.saveSettings();
  },

  async loadUserPreset(this: CursorSmithPlugin, name: string) {
    const preset = this.getUserPresets()[name];
    if (!preset) return;
    const wasEnabled = this.settings.enabled;
    const presets = this.getUserPresets();   // hold ref before overwrite
    // Snapshot the independent vim state so an old/imported preset can't wipe
    // it (normal snapshots exclude these, but share codes are untrusted).
    const vimState: Partial<CursorSmithSettings> = {};
    const dst = vimState as unknown as Record<string, unknown>, src = this.settings as unknown as Record<string, unknown>;
    for (const k of VIM_STATE_KEYS) dst[k] = src[k];
    // Backfill first: an older/built-in preset saved before some setting
    // existed should land on that setting's default, not on whatever this
    // vault happened to have set beforehand (see presetWithDefaults).
    Object.assign(this.settings, presetWithDefaults(preset));
    this.settings.enabled = wasEnabled;
    this.settings.userPresets = presets;    // restore presets dict
    Object.assign(this.settings, vimState);
    await this.saveSettings();
    if (this.settings.enabled) this.enable();
    // Track which preset is active so cyclePreset() knows where to start.
    this._activePresetName = name;
  },

  // ---- The Randomizer (1.7.7, randomize.ts) ----

  // Roll a whole new cursor into the look being edited: the global one, or
  // in the Vim panel a mode - the panel's tab when rolled from the panel,
  // the mode the cursor is in when rolled from the palette. The look it
  // replaces goes on this session's undo stack. full: Chaos, Color and
  // Motion at 100. No preset is in use after it (Save keeps one you like).
  async rollCursor(this: CursorSmithPlugin, { full = false, fromPanel = false } = {}) {
    const s = this.settings;
    // Full chaos too keeps out what the switches keep out.
    const opts: RollOptions = full
      ? { chaos: 100, color: 100, motion: 100, sounds: !!s.rollSounds, allow: s.rollEffects }
      : { chaos: s.rollChaos, color: s.rollColor, motion: s.rollMotion, sounds: !!s.rollSounds, allow: s.rollEffects };
    const rolled = rollLook(opts);
    const mode = this.isVimUiMode()
      ? (fromPanel ? this._vimEditMode : (this.lookVimMode() || this._vimEditMode)) || "normal"
      : null;
    const target: Partial<Look> = mode ? s.vimModes[mode] : s;
    if (!this._rollUndo) this._rollUndo = [];
    this._rollUndo.push({ mode, look: pickLook(target), preset: mode ? s.vimActivePreset : this._activePresetName || "" });
    if (this._rollUndo.length > ROLL_UNDO_DEPTH) this._rollUndo.shift();
    Object.assign(target, rolled);
    if (mode) s.vimActivePreset = "";
    else this._activePresetName = "";
    await this._lookReplaced();
    return { mode, look: rolled };
  },

  // The look before the last roll, back where it was.
  async undoRoll(this: CursorSmithPlugin): Promise<boolean> {
    const last = this._rollUndo?.pop();
    if (!last) return false;
    const target: Partial<Look> = last.mode ? this.settings.vimModes[last.mode] : this.settings;
    Object.assign(target, last.look);
    if (last.mode) this.settings.vimActivePreset = last.preset;
    else this._activePresetName = last.preset;
    await this._lookReplaced();
    return true;
  },

  // A whole look written at once: saved, the engine restarted on it, the
  // torch's own engine started or stopped as the new look asks.
  async _lookReplaced(this: CursorSmithPlugin) {
    await this.saveSettings();
    if (!this.settings.enabled) return;
    this.enable();
    if (!this.torchPossible()) this.disableTorchOverlay();
    else if (!this.torchEngineActive) this.enableTorchOverlay();
  },

  // The palette's roll: a notice with Undo in it, and the panel redrawn if
  // it is open.
  async rollFromPalette(this: CursorSmithPlugin, full: boolean) {
    const { mode } = await this.rollCursor({ full });
    this.refreshSettingTab();
    const what = (full ? "Full chaos" : "New cursor") + (mode ? ` for ${mode[0].toUpperCase() + mode.slice(1)} mode` : "");
    const notice = new Notice(createFragment((f) => {
      f.appendText(`Cursor-Smith: ${what}. `);
      const undo = f.createEl("button", { text: "Undo", attr: { type: "button" } });
      undo.addEventListener("click", (e) => {
        e.stopPropagation();
        void (async () => { await this.undoRoll(); this.refreshSettingTab(); notice.hide(); })();
      });
    }), 6000);
  },

  async undoFromPalette(this: CursorSmithPlugin) {
    const undone = await this.undoRoll();
    this.refreshSettingTab();
    new Notice(undone ? "Cursor-Smith: the cursor before the last roll is back." : "Cursor-Smith: nothing to undo.");
  },

  async deleteUserPreset(this: CursorSmithPlugin, name: string) {
    delete this.getUserPresets()[name];
    await this.saveSettings();
  },

  // The single palette command routes here: cycle whichever preset library
  // belongs to the mode the user is actually in.
  cycleActivePreset(this: CursorSmithPlugin, direction: number) {
    if (this.isVimUiMode()) return this.cycleVimPreset(direction);
    return this.cyclePreset(direction);
  },

  cyclePreset(this: CursorSmithPlugin, direction: number) {
    const presets = this.getUserPresets();
    const names = Object.keys(presets);
    if (names.length === 0) return;

    // Find index of the currently active preset (last loaded), or start at -1
    // so the first forward step lands on index 0.
    const current = this._activePresetName ?? null;
    const currentIdx = names.indexOf(current);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];

    void (async () => {
      await this.loadUserPreset(nextName);
      this._activePresetName = nextName;
      // Persist the pending name so the settings tab reflects the active preset.
      this._pendingPresetName = nextName;
      new Notice(`Cursor-Smith: ${nextName}`);
      // The panel shows the loaded values and the pending name: hand it
      // new definitions (see refreshSettingTab).
      this.refreshSettingTab();
    })();
  },

  // Returns the name it was saved under, or null if the code was invalid.
  async importPreset(this: CursorSmithPlugin, code: string) {
    const result = codeToPreset(code.trim());
    if (!result) return null;
    this.getUserPresets()[result.name] = result.snap;
    await this.saveSettings();
    return result.name;
  },

  // ---- Vim preset CRUD (independent of the regular cursor presets) ----

  getVimPresets(this: CursorSmithPlugin) {
    if (!this.settings.vimPresets) this.settings.vimPresets = {};
    return this.settings.vimPresets;
  },

  async saveVimPreset(this: CursorSmithPlugin, name: string) {
    this.getVimPresets()[name] = cloneVimModes(this.settings.vimModes);
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  },

  async loadVimPreset(this: CursorSmithPlugin, name: string) {
    const preset = this.getVimPresets()[name];
    if (!preset) return;
    // Expand each mode to a complete snapshot so a preset saved before some key
    // existed still lands on a fully-defined config. A mode the preset has no
    // entry for at all (e.g. "command" in a preset saved before it existed)
    // falls back to that mode's starter look — see vimModeSnapshot.
    for (const mode of VIM_MODE_KEYS) {
      this.settings.vimModes[mode] = vimModeSnapshot(mode, preset[mode]);
    }
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  },

  async deleteVimPreset(this: CursorSmithPlugin, name: string) {
    delete this.getVimPresets()[name];
    if (this.settings.vimActivePreset === name) this.settings.vimActivePreset = "";
    await this.saveSettings();
  },

  async cycleVimPreset(this: CursorSmithPlugin, direction: number) {
    const names = Object.keys(this.getVimPresets());
    if (names.length === 0) {
      new Notice("Cursor-Smith: no Vim presets are saved");
      return;
    }
    const currentIdx = names.indexOf(this.settings.vimActivePreset);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];
    // Applying a preset while the feature is off makes no sense — turn it on
    // (which also flips Obsidian's vim bindings when auto-control is set).
    if (!this.settings.vimModeEnabled) await this.setVimModeEnabled(true);
    await this.loadVimPreset(nextName);
    new Notice(`Cursor-Smith: Vim preset — ${nextName}`);
    this.refreshSettingTab();
  },

  // Returns the name it was saved under, or null if the code was invalid.
  //
  // Only accepts Vim codes ("2|..."). A regular preset code describes one
  // cursor, not five, so there's no honest way to expand it into a Vim preset -
  // better to report it as the wrong kind of code than to silently paint all
  // five modes the same and let someone wonder why their Insert cursor looks
  // like their Normal one.
  async importVimPreset(this: CursorSmithPlugin, code: string) {
    const result = codeToVimPreset(code.trim());
    if (!result) return null;
    this.getVimPresets()[result.name] = cloneVimModes(result.modes);
    this.settings.vimActivePreset = result.name;
    await this.saveSettings();
    return result.name;
  },
};
export type LibraryMethods = typeof libraryMethods;
