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
  presetWithDefaults,
  vimModeSnapshot,
} from "./settings";
import { codeToPreset, codeToVimPreset } from "./share";
import type { CursorSmithSettings } from "./types";
import type CursorSmithPlugin from "./plugin";

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

    void this.loadUserPreset(nextName).then(() => {
      this._activePresetName = nextName;
      // Persist the pending name so the settings tab reflects the active preset.
      this._pendingPresetName = nextName;
      new Notice(`Cursor-Smith: ${nextName}`);
      // The panel shows the loaded values and the pending name: hand it
      // new definitions (see refreshSettingTab).
      this.refreshSettingTab();
    });
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
