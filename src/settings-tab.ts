// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

import { PluginSettingTab, Setting, App, ExtraButtonComponent } from "obsidian";
import type { SettingDefinitionItem, SettingDefinitionGroup, SettingDefinitionRender, SettingGroupItem } from "obsidian";
import type CursorSmithPlugin from "./plugin";
import { DEFAULT_SETTINGS, VIM_MODE_KEYS, VIM_MODE_LABELS } from "./settings";
import { SHARE_VERSION, SHARE_VERSION_VIM, presetToCode, vimPresetToCode } from "./share";
import type { DropdownOptions, Look, LookCards, LookSettingsHooks, PresetRowActions, RowOptions, SettingKey, SliderOptions } from "./types";

export class CursorSmithSettingTab extends PluginSettingTab {
  plugin: CursorSmithPlugin;
  // Which cards the user collapsed, by title.
  _sectionOpen: Record<string, boolean> | null = null;
  constructor(app: App, plugin: CursorSmithPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // -------------------------------------------------------------------------
  // The panel is declarative, the Obsidian 1.13 way: getSettingDefinitions()
  // returns the tree of groups and rows, Obsidian renders it, indexes every
  // row for settings search, and re-renders it IN PLACE - reconciling rows
  // by name, so the scroll position and every untouched row survive -
  // whenever update() is called. update() is what display() and the
  // per-section re-render used to be: every control that adds or removes
  // rows, and every preset load, calls it.
  //
  // Rows are `render` definitions: the name and description live on the
  // definition (that is what search sees), and the control is built in the
  // render callback with the same Setting API as before. The six global
  // toggles are `control` definitions, read and written through
  // getControlValue / setControlValue below. Nothing is built at definition
  // time except the tree itself, so this is cheap to call.
  //
  // The tree depends on the mode switch, the preset lists and which Vim mode
  // is being edited, and Obsidian renders the LAST definitions it was given
  // (it does not ask again on open) - so anything that changes those from
  // outside the panel goes through plugin.refreshSettingTab(), which calls
  // update().
  // -------------------------------------------------------------------------
  getSettingDefinitions(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem[] = [this.globalGroup()];
    if ((this.plugin.settings.uiMode || "cua") === "vim") items.push(...this.vimDefinitions());
    else items.push(...this.normalDefinitions());
    return items;
  }

  // Obsidian re-renders the panel on update() and then puts keyboard focus
  // on the FIRST control of whichever row had it: the CUA half of the mode
  // switch after a click on Vim, the name box of the preset row after Save.
  // A focus the user did not put there reads as a stray cursor - this
  // plugin draws one wherever a text box has focus - so it is dropped, which
  // is what the old full rebuild did by emptying the panel.
  update() {
    super.update();
    try {
      const doc = this.containerEl.ownerDocument;
      const el = doc && doc.activeElement;
      if (el && el !== doc.body && this.containerEl.contains(el)) (el as HTMLElement).blur();
    } catch { /* not on screen; nothing has focus in it */ }
  }

  // The `control` rows read and write plugin.settings directly. Enable Plugin
  // is the one with a side effect: the engine starts or stops with it.
  getControlValue(key: string): unknown {
    return this.plugin.settings[key as SettingKey];
  }

  async setControlValue(key: string, value: unknown) {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    if (key === "enabled") value ? this.plugin.enable() : this.plugin.disable();
    await this.plugin.saveSettings();
  }

  // -------------------------------------------------------------------------
  // Row and group builders. A group is a card with a heading; a row is one
  // Setting inside it. `depth` indents a row under the toggle (or the style
  // dropdown) it belongs to, so conditional sub-options read as a hierarchy
  // rather than a flat list.
  // -------------------------------------------------------------------------
  row(name: string, desc: string, build: (setting: Setting) => void, depth = 0): SettingDefinitionRender {
    return {
      name,
      desc,
      render: (setting) => {
        this.resetRow(setting);
        if (depth) setting.settingEl.addClass("cursor-smith-sub", "cursor-smith-sub-" + Math.min(depth, 3));
        build(setting);
      },
    };
  }

  // Obsidian keeps a row's element across update() when its name matches
  // and empties its controls - but not its classes, so a row that changed
  // kind or depth between two renders would keep the old ones (a known
  // 1.13 issue). Every row builder starts from a clean slate.
  resetRow(setting: Setting) {
    setting.settingEl.removeClass(
      "cursor-smith-sub", "cursor-smith-sub-1", "cursor-smith-sub-2", "cursor-smith-sub-3",
      "cursor-smith-note-row", "cursor-smith-note-warning", "cursor-smith-subsection-row",
      "cursor-smith-color-row", "cursor-smith-reduced-notice");
  }

  // A muted note under a group's rows (no presets yet, what Command mode
  // covers), or the warning variant (Vim key bindings off).
  noteRow(text: string, { warning = false, visible }: { warning?: boolean; visible?: () => boolean } = {}): SettingDefinitionRender {
    const def: SettingDefinitionRender = {
      name: "",
      desc: text,
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-note-row");
        if (warning) setting.settingEl.addClass("cursor-smith-note-warning");
      },
    };
    if (visible) def.visible = visible;
    return def;
  }

  // Small all-caps label splitting a run of rows into sub-groups (the torch's
  // "Spotlight" vs "Environment") without a card of its own.
  subheadingRow(title: string, depth = 0): SettingDefinitionRender {
    return {
      name: title,
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-subsection-row");
        if (depth) setting.settingEl.addClass("cursor-smith-sub", "cursor-smith-sub-" + Math.min(depth, 3));
      },
    };
  }

  // -------------------------------------------------------------------------
  // Collapsible cards. Obsidian's groups are not collapsible, so the card's
  // heading gets a chevron and the heading (or the chevron) toggles a class
  // that hides the card's rows. Which cards the user collapsed is remembered
  // for the session, keyed by title so adding a card does not shuffle it -
  // and in memory rather than in settings: it is panel state, not
  // configuration, and must not travel in a share code or a preset.
  // -------------------------------------------------------------------------
  section(title: string, items: SettingGroupItem[], { open = true }: { open?: boolean } = {}): SettingDefinitionGroup {
    return {
      type: "group",
      heading: title,
      cls: "cursor-smith-section",
      extraButtons: [this.collapseButton(title, open)],
      items,
    };
  }

  collapseButton(title: string, defaultOpen: boolean): (btn: ExtraButtonComponent) => void {
    return (btn) => {
      const remembered = this._sectionOpen || (this._sectionOpen = {});
      const isOpen = () => remembered[title] ?? defaultOpen;
      // The button is already in the card's heading when this runs, so the
      // card is reachable from it - which is how the remembered state is
      // applied to a freshly built card without any private API.
      const groupEl = btn.extraSettingsEl.closest(".setting-group");
      const paint = () => {
        btn.setIcon(isOpen() ? "chevron-down" : "chevron-right");
        if (groupEl) groupEl.toggleClass("is-collapsed", !isOpen());
      };
      const toggle = () => {
        remembered[title] = !isOpen();
        paint();
      };
      btn.setTooltip("Collapse or expand").onClick(toggle);
      const header = btn.extraSettingsEl.closest(".setting-item-heading");
      // The heading toggles too, the way the old <summary> did; the chevron's
      // own click bubbles up here and must not count twice.
      header?.addEventListener("click", (ev) => {
        if (!btn.extraSettingsEl.contains(ev.target as Node)) toggle();
      });
      paint();
    };
  }

  // The element that actually scrolls the settings pane. Obsidian's own
  // containerEl is usually it, but that is an implementation detail of the
  // settings modal rather than a promise, so walk up until something is
  // genuinely overflowing rather than assuming.
  _scrollHost(): HTMLElement {
    let el: HTMLElement | null = this.containerEl;
    for (let i = 0; el && i < 6; i++) {
      if (el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return this.containerEl;
  }

  // -------------------------------------------------------------------------
  // The first card: the plugin's name and version as its heading, the notice
  // for when the OS is suppressing motion, the six global switches, and the
  // CUA / Vim mode switch.
  //
  // The switches are structural rather than looks: none is in LOOK_KEYS, so
  // none is part of a preset or of a per-Vim-mode snapshot - they apply to
  // whatever cursor is on screen, in both modes.
  // -------------------------------------------------------------------------
  globalGroup(): SettingDefinitionGroup {
    const plugin = this.plugin;
    return {
      type: "group",
      // Read off the manifest rather than hardcoded, so a release is a
      // one-line edit in manifest.json.
      heading: `Cursor-Smith ${plugin.manifest?.version ?? ""}`.trim(),
      cls: "cursor-smith-global",
      items: [
        this.reducedMotionNotice(),
        {
          name: "Enable plugin",
          desc: "Hands you back Obsidian's own caret.",
          control: { type: "toggle", key: "enabled" },
        },
        {
          name: "Note editor only",
          desc: "Draws the cursor in notes only. Search, palettes, settings and modals keep Obsidian's caret.",
          control: { type: "toggle", key: "noteEditorOnly", defaultValue: false },
        },
        {
          name: "Hide real cursor",
          desc: "Hides the native primary cursor so only the custom one shows.",
          control: { type: "toggle", key: "hideNativeCaret" },
        },
        {
          name: "Hide cursor when unfocused",
          desc: "Hides the cursor while Obsidian isn't the active window.",
          control: { type: "toggle", key: "hideOnWindowBlur", defaultValue: true },
        },
        {
          name: "Low power mode",
          desc: "Halves every effect's frame rate. For battery, or if Obsidian feels slower with the plugin on.",
          control: { type: "toggle", key: "lowPowerMode", defaultValue: false },
        },
        {
          name: "Respect reduced motion",
          desc: "Switches off the moving effects when your system asks for reduced motion. The cursor's own look is untouched.",
          control: { type: "toggle", key: "respectReducedMotion", defaultValue: true },
        },
        {
          name: "Mode",
          desc: "One cursor for everything, or a cursor of its own for each Vim mode.",
          render: (setting) => this.renderModeSwitch(setting.controlEl),
        },
      ],
    };
  }

  // --- "Why is nothing moving?" ------------------------------------------
  // Reduced motion is deliberately invisible to the rest of the panel: the
  // suppression runs on the merged copy inside effectiveSettings(), never on
  // this.settings, so every toggle below keeps showing what the USER chose
  // (see applyReducedMotion). That is the right call for the data - a saved
  // preset must not be rewritten by an OS preference - but on its own it
  // produces the worst possible symptom: Motion smear and Smooth movement read
  // as ON and do nothing, with nothing anywhere saying why.
  //
  // This is the missing half. It says so, in the one place someone goes to
  // find out, and only while the OS is actually asking - the row is always
  // built and shown or hidden by its `visible` predicate, which Obsidian
  // re-evaluates after every control change.
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
  reducedMotionNotice(): SettingDefinitionRender {
    return {
      name: "Motion effects are off",
      desc: "Your system is set to reduce motion, so Smooth movement, Motion " +
            "smear and the other moving effects are suppressed - the toggles " +
            "below still show your own settings. Turn off \"Respect reduced " +
            "motion\" to override this.",
      searchable: false,
      visible: () => this.reducedMotionActive(),
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-reduced-notice");
        // This row is first in the panel, so it is where the panel's own
        // document gets registered - see registerPanelDocument.
        this.registerPanelDocument(setting.settingEl);
      },
    };
  }

  // Fail closed. reducedMotion() already swallows a missing matchMedia, but
  // it reads this.settings before its own try, and an explanatory banner is
  // never worth the risk of a broken panel.
  reducedMotionActive(): boolean {
    try {
      return !!this.plugin.reducedMotion();
    } catch (e) {
      console.error("[cursor-smith] reduced-motion check failed:", e);
      return false;
    }
  }

  // Since Obsidian 1.13 this panel renders in a window of its own, in a
  // document the engine has no other way to discover: documents are
  // otherwise learned from `view.dom.ownerDocument`, and the settings window
  // hosts no view. Registering it here is what lets _focusedForeignDoc offer
  // it as a canvas target, so the cursor can follow the caret into the
  // panel's own text boxes (preset names, share codes) the way it always
  // could when Settings was a modal in the main document. Set-guarded and a
  // no-op when the panel is in the main document. Fail closed: a nicety here
  // must never take the panel down.
  registerPanelDocument(el: HTMLElement) {
    try {
      const panelDoc = el && el.ownerDocument;
      if (panelDoc && typeof document !== "undefined" && panelDoc !== document) {
        this.plugin.registerWindowEvents(panelDoc);
      }
    } catch (e) {
      console.error("[cursor-smith] could not register settings window:", e);
    }
  }

  // -------------------------------------------------------------------------
  // Segmented CUA/Normal <-> Vim switch. Selecting "Vim" turns Vim-aware
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

    const makeBtn = (label: string, key: string) => {
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
        this.update();
      };
      btn.addEventListener("click", () => { void switchMode(); });
      return btn;
    };

    makeBtn("CUA / Normal", "cua");
    makeBtn("Vim", "vim");
  }

  // -------------------------------------------------------------------------
  // The CUA / Normal panel: the preset library, then the look cards for the
  // global cursor.
  // -------------------------------------------------------------------------
  normalDefinitions(): SettingDefinitionItem[] {
    const plugin = this.plugin;
    // The settings, seen as the look they contain: TypeScript will not
    // index a wider object with a narrower key type, but it will alias it.
    const look: Look = plugin.settings;
    const set = <K extends keyof Look>(key: K) => async (v: Look[K]) => { look[key] = v; await plugin.saveSettings(); };

    // Everything from "what does the cursor look like" through "what effects
    // does it use" is identical in shape whether it's this global cursor or
    // one Vim mode's own snapshot - see lookDefinitions, shared with
    // modeDefinitions below.
    return [
      this.presetsGroup(),
      ...this.lookDefinitions({
        get: <K extends keyof Look>(key: K) => plugin.settings[key],
        set,
        renderCursorStyleSetting: (setting, rerender) => {
          setting.addDropdown((dropdown) =>
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
        renderTorchToggleSetting: (setting, rerender) => {
          setting.addToggle((toggle) =>
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
      }),
    ];
  }

  presetsGroup(): SettingDefinitionGroup {
    const plugin = this.plugin;
    const items = [];

    if (plugin._pendingPresetName === undefined) plugin._pendingPresetName = "";
    items.push(this.row("Save current settings as preset", "Give your cursor a name, then click Save.", (setting) => {
      setting
        .addText((text) => {
          text.setPlaceholder("Preset name");
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
            this.update();
          });
        });
    }));

    items.push(this.row("Import preset", "Paste a share code from someone else to add their preset.", (setting) => {
      let importCode = "";
      setting
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
              this.update();
            } else {
              // The two code kinds are one character apart at a glance, so say
              // which mistake was made rather than a flat "invalid".
              btn.setButtonText(importCode.startsWith(SHARE_VERSION_VIM + "|")
                ? "That's a Vim code" : "Invalid code");
              window.setTimeout(() => { btn.setButtonText("Import"); }, 2000);
            }
          });
        });
    }));

    const presets = plugin.getUserPresets();
    const names = Object.keys(presets);
    if (names.length === 0) {
      items.push(this.noteRow("No saved presets yet. Configure your cursor below, then save it above."));
    } else {
      for (const name of names) {
        items.push(this.presetRow(name, presets[name], {
          onLoad: async () => { await plugin.loadUserPreset(name); plugin._pendingPresetName = name; this.update(); },
          onEdit: async () => {
            await plugin.loadUserPreset(name);
            plugin._pendingPresetName = name;
            this.update();
            this._scrollHost().scrollTop = 0;
          },
          onDelete: async () => { await plugin.deleteUserPreset(name); this.update(); },
        }));
      }
    }

    return this.section("Presets", items);
  }

  // -------------------------------------------------------------------------
  // Shared preset row (name, share code pill, Copy, Load, Edit, Delete).
  //
  // `code` is a caller option because the two preset kinds serialise
  // differently: a regular preset is one look (presetToCode), a Vim preset is
  // five (vimPresetToCode). This row used to build the code itself with
  // presetToCode, which is correct for one caller and silently produced an
  // empty, contentless code for the other.
  // -------------------------------------------------------------------------
  presetRow(name: string, snap: Partial<Look> | Record<string, Look>, { onLoad, onEdit, onDelete, code, active = false }: PresetRowActions): SettingDefinitionRender {
    if (code === undefined) code = presetToCode(name, snap);
    return {
      name,
      desc: active ? "Currently active" : "",
      render: (setting) => {
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
          .addButton((btn) => btn.setButtonText("Delete").setDestructive().onClick(onDelete));
      },
    };
  }

  // -------------------------------------------------------------------------
  // The Vim panel: the two Vim-only switches, the Vim preset library, the
  // mode tabs, and the look cards for whichever mode is being edited.
  // -------------------------------------------------------------------------
  vimDefinitions(): SettingDefinitionItem[] {
    const plugin = this.plugin;

    if (!VIM_MODE_KEYS.includes(plugin._vimEditMode)) plugin._vimEditMode = "normal";
    const mode = plugin._vimEditMode;
    const target = plugin.settings.vimModes[mode];

    return [
      this.vimCursorsGroup(),
      this.vimPresetsGroup(),
      this.vimModeGroup(mode),
      ...this.modeDefinitions(target, () => {
        plugin.settings.vimActivePreset = "";
      }),
    ];
  }

  vimCursorsGroup(): SettingDefinitionGroup {
    const plugin = this.plugin;
    const items = [];

    items.push(this.row("Control Obsidian's Vim key bindings",
      "Lets this plugin turn Obsidian's Vim key bindings on and off with the mode.", (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimControlObsidian).onChange(async (value) => {
            plugin.settings.vimControlObsidian = value;
            // Taking ownership mid-session: immediately enforce the current
            // mode so the keybindings match what the panel shows.
            if (value) plugin.setObsidianVim(!!plugin.settings.vimModeEnabled);
            await plugin.saveSettings();
            this.update();
          }));
      }));

    items.push(this.row("Show Vim mode in status bar",
      "Shows the live mode in the status bar, vim-style: -- NORMAL --.", (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimStatusBar).onChange(async (value) => {
            plugin.settings.vimStatusBar = value;
            plugin.syncVimStatusBar();
            await plugin.saveSettings();
            this.update();
          }));
      }));

    if (plugin.settings.vimStatusBar) {
      items.push(this.row("Color status bar text to match the cursor",
        "Tints the mode name with that mode's cursor color.", (setting) => {
          setting.addToggle((toggle) =>
            toggle.setValue(plugin.settings.vimStatusBarColor).onChange(async (value) => {
              plugin.settings.vimStatusBarColor = value;
              await plugin.saveSettings();
            }));
        }, 1));
    }

    // Shown only while Obsidian's own Vim key bindings are off, re-checked
    // by Obsidian after every control change.
    items.push(this.noteRow(plugin.settings.vimControlObsidian
      ? "⚠ Obsidian's Vim key bindings look off right now. They should switch on automatically — reopen the editor if the mode cursors don't appear."
      : "⚠ Obsidian's Vim key bindings are off, so mode cursors won't appear. Enable them in Settings → Editor → Vim key bindings, or turn on \"Control Obsidian's Vim key bindings\" above.",
      { warning: true, visible: () => !plugin.isObsidianVimOn() }));

    return this.section("Vim cursors", items);
  }

  vimPresetsGroup(): SettingDefinitionGroup {
    const plugin = this.plugin;
    const items = [];

    if (plugin._pendingVimPresetName === undefined) plugin._pendingVimPresetName = "";
    items.push(this.row("Save current Vim setup as preset",
      "Give this set of per-mode cursors a name, then click Save.", (setting) => {
        setting
          .addText((text) => {
            text.setPlaceholder("Vim preset name");
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
              this.update();
            });
          });
      }));

    items.push(this.row("Import Vim preset",
      "Paste a Vim share code to add all five mode cursors at once.", (setting) => {
        let importVimCode = "";
        setting
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
                this.update();
              } else {
                btn.setButtonText(importVimCode.startsWith(SHARE_VERSION + "|")
                  ? "That's a regular code" : "Invalid code");
                window.setTimeout(() => { btn.setButtonText("Import"); }, 2000);
              }
            });
          });
      }));

    const presets = plugin.getVimPresets();
    const names = Object.keys(presets);
    if (names.length === 0) {
      items.push(this.noteRow("No saved Vim presets yet. Configure each mode below, then save it above."));
    } else {
      for (const name of names) {
        items.push(this.presetRow(name, presets[name], {
          code: vimPresetToCode(name, presets[name]),
          active: name === plugin.settings.vimActivePreset,
          onLoad: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.update();
          },
          onEdit: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.update();
            this._scrollHost().scrollTop = 0;
          },
          onDelete: async () => { await plugin.deleteVimPreset(name); this.update(); },
        }));
      }
    }

    return this.section("Vim presets", items);
  }

  // Per-mode editor: pick one mode, then edit its FULL cursor config in the
  // look cards that follow this one.
  vimModeGroup(mode: string): SettingDefinitionGroup {
    const items = [];

    items.push(this.row("Vim mode", `The cards below are the ${VIM_MODE_LABELS[mode]} mode's cursor. Each mode has a full set of its own.`,
      (setting) => this.renderModeTabs(setting.controlEl)));

    if (mode === "command") {
      items.push(this.noteRow(
        "Applies whenever the caret leaves the note editor: the built-in Vim command " +
        "line (the \":\" / \"/\" prompt) and the rest of the Obsidian interface — Command " +
        "Palette, Quick Switcher, search, rename boxes, Settings fields and plugin modals. " +
        "Motion effects (smear, smooth movement, CRT trail) are best left off here: these " +
        "are all single-line fields, so they read as jitter rather than movement."));
    }

    return this.section("Per-mode cursors", items);
  }

  // Tab row — one tab per Vim mode. Same visual language as the CUA/Vim
  // segmented switch at the top of the panel. Each inactive tab's label is
  // tinted with that mode's own cursor color (for the current theme), so the
  // row doubles as a live color legend; the active tab uses the accent
  // background instead, where a tint would be unreadable.
  renderModeTabs(containerEl: HTMLElement) {
    const plugin = this.plugin;
    const isDarkTheme = containerEl.ownerDocument?.body?.classList?.contains("theme-dark") ?? true;
    const tabWrap = containerEl.createDiv({ cls: "cursor-smith-segmented cursor-smith-segmented-modes" });
    for (const m of VIM_MODE_KEYS) {
      const active = plugin._vimEditMode === m;
      const cfg: Partial<Look> = plugin.settings.vimModes[m] || {};
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
        this.update();
      });
    }
  }

  // The FULL set of cursor look/effect cards bound to an arbitrary
  // settings-shaped `target` object (here, one Vim mode's snapshot).
  modeDefinitions(target: Look, onEdit: () => void): SettingDefinitionGroup[] {
    const plugin = this.plugin;
    const after = onEdit || (() => {});
    const set = <K extends keyof Look>(key: K) => async (v: Look[K]) => { target[key] = v; after(); await plugin.saveSettings(); };
    // Write, then re-render - the same shape lookDefinitions gives its own
    // gated toggles.
    const setR = <K extends keyof Look>(key: K, rerender: () => void) => async (v: Look[K]) => { const saved = set(key)(v); rerender(); await saved; };

    return this.lookDefinitions({
      get: <K extends keyof Look>(key: K) => target[key],
      set,
      renderCursorStyleSetting: (setting, rerender) => {
        setting.addDropdown((d) =>
          d.addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
            .setValue(target.cursorStyle).onChange(setR("cursorStyle", rerender)));
      },
      renderTorchToggleSetting: (setting, rerender) => {
        setting.addToggle((t) => t.setValue(target.torchEffect).onChange(setR("torchEffect", rerender)));
      },
    });
  }

  // -------------------------------------------------------------------------
  // Shared look/effect cards.
  //
  // normalDefinitions (the global cursor) and modeDefinitions (one Vim mode's
  // own snapshot) build an identical set of cards - Appearance, Blinking,
  // Smooth movement, Effects. The only real differences between the two are
  // *where the values live* and *what happens after a save*, so those are
  // the only things a caller supplies:
  //
  //   get(key)                    - read the current value for `key`
  //   set(key)                    - returns an onChange handler: write the
  //                                 value where it lives and save. Must put
  //                                 the value in memory synchronously, before
  //                                 its first await - the re-render reads it
  //                                 back straight away.
  //   renderCursorStyleSetting(setting, rerender)
  //                               - fills in the "Cursor style" row's
  //                                 dropdown. Kept as a caller-supplied hook
  //                                 (rather than a generic set) because the
  //                                 global panel needs an extra
  //                                 plugin.enable() call after saving that a
  //                                 Vim mode does not. Call `rerender()`
  //                                 after the write.
  //   renderTorchToggleSetting(setting, rerender)
  //                               - fills in the "Torch spotlight" row's
  //                                 toggle. Also a caller-supplied hook: the
  //                                 global panel must start/stop the torch
  //                                 engine immediately on toggle, which has no
  //                                 Vim-mode equivalent (see the comment at
  //                                 that call site). Same `rerender` rule.
  //
  // A toggle that reveals or hides other rows goes through `redraw(key)`,
  // which writes and then calls update(): Obsidian rebuilds the panel from
  // the definitions and reconciles the rows in place, so only the rows that
  // changed are touched and the panel does not move. The rows a gate
  // controls are simply built or not built, from the value in memory.
  //
  // Returns the cards; `lookDefinitions.gates` on the result is the set of
  // keys whose change rebuilds the panel, for the tests.
  // -------------------------------------------------------------------------
  lookDefinitions({ get, set, renderCursorStyleSetting, renderTorchToggleSetting }: LookSettingsHooks): LookCards {
    const gates: Set<keyof Look> = new Set();
    const rerender = () => this.update();

    // An onChange handler for a gated control: write through `set`, then
    // re-render. The re-render runs as soon as the value is in memory rather
    // than after the save lands on disk - the rows read memory, and the
    // panel responding a disk write later is what the old full rebuild felt
    // like. The save's promise is still returned so a failure surfaces.
    const redraw = <K extends keyof Look>(key: K) => {
      gates.add(key);
      return async (v: Look[K]) => {
        const saved = set(key)(v);
        rerender();
        await saved;
      };
    };
    // For the two caller-built controls: the re-render they call after their
    // own write.
    const afterWrite = (key: keyof Look) => {
      gates.add(key);
      return rerender;
    };

    const row = (name: string, desc: string, build: (s: Setting) => void, depth?: number) => this.row(name, desc, build, depth);
    const toggle = (name: string, desc: string, key: keyof Look, { depth = 0, gate = false }: RowOptions = {}) =>
      row(name, desc, (s) => { s.addToggle((t) => t.setValue(!!get(key)).onChange(gate ? redraw(key) : set(key))); }, depth);
    const dropdown = (name: string, desc: string, key: keyof Look, options: Record<string, string>, { depth = 0, value, onChange }: DropdownOptions = {}) =>
      row(name, desc, (s) => {
        s.addDropdown((d) => d.addOptions(options)
          .setValue(value !== undefined ? value : get(key) as string)
          .onChange(onChange || set(key)));
      }, depth);

    // --- Every slider, with "restore default" ------------------------------
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
    // other rows need (flameTrailGravity's angle, say).
    //
    // The default is read from DEFAULT_SETTINGS rather than from the
    // `fallback` a row shows: those fallbacks are what a *sparse* Vim-mode
    // snapshot displays for a key it has never been given, and the two are
    // not obliged to agree (overlayFlickerAmount's don't). What the button
    // promises is the default, so it reads the defaults.
    //
    // No dynamic tooltip on the slider: since 1.13 it always shows its value.
    const resetSlider = (key: keyof Look) => (btn: ExtraButtonComponent) => {
      const reset = redraw(key);
      return btn
        .setIcon("rotate-ccw")
        .setTooltip(`Restore default (${DEFAULT_SETTINGS[key]})`)
        .onClick(() => reset(DEFAULT_SETTINGS[key]));
    };
    const slider = (name: string, desc: string, key: keyof Look, [min, max, step]: number[], { depth = 0, fallback, gate = false }: SliderOptions = {}) =>
      row(name, desc, (s) => {
        s.addSlider((sl) => sl.setLimits(min, max, step).setValue((get(key) ?? fallback) as number).onChange(gate ? redraw(key) : set(key)))
          .addExtraButton(resetSlider(key));
      }, depth);

    // Several colour pickers on ONE row, so they lay out side by side in that
    // row's control area (Obsidian's .setting-item-control is already a flex
    // row; .cursor-smith-color-row only adds the gap between swatches)
    // instead of each claiming its own full-width labelled row.
    //
    // Order carries the meaning here - there is nowhere to hang a per-swatch
    // label - so every caller's description has to state what the order is.
    const swatchRow = (name: string, keys: (keyof Look)[], desc: string, depth = 0) =>
      row(name, desc, (s) => {
        s.settingEl.addClass("cursor-smith-color-row");
        for (const key of keys) {
          s.addColorPicker((cp) =>
            cp.setValue((get(key) || DEFAULT_SETTINGS[key]) as string).onChange(set(key)));
        }
      }, depth);

    // --- Appearance ----------------------------------------------------------
    const appearance = [];
    appearance.push(row("Cursor style", "The shape of the cursor itself.",
      (s) => renderCursorStyleSetting(s, afterWrite("cursorStyle"))));

    // Everything that applies to exactly one cursor style lives here, in a
    // sub-group hanging directly off the dropdown that selects it, so the
    // card reads as "Cursor style, then the options for the style you
    // picked".
    const style = get("cursorStyle");
    if (style === "Line") {
      appearance.push(slider("Cursor thickness", "How thick the Line cursor is, in pixels.", "caretWidthPx", [1, 12, 1], { depth: 1 }));
      appearance.push(toggle("Serifs", "Adds I-beam serifs at the top and bottom of the line.", "lineSerifs", { depth: 1 }));
    }
    if (style === "Underline") {
      appearance.push(slider("Underline thickness", "Thickness of the underline, in pixels. 0 = automatic, scaled to the line height.",
        "underlineWidthPx", [0, 12, 1], { depth: 1, fallback: 0 }));
    }
    if (style === "Box") {
      appearance.push(toggle("Show letter inside cursor", get("boxHollow") || get("cursorTranslucent")
        ? `Shows the letter inside the block, colors flipped. Does nothing while ${get("boxHollow") ? "Hollow" : "Translucent"} is on.`
        : "Shows the letter inside the block, with the colors flipped.",
        "showChar", { depth: 1, gate: true }));
      if (get("showChar")) {
        appearance.push(dropdown("Letter color",
          "Contrast: neutral black or white. Tinted: the flipped colour, kept legible. Inverted: raw flip.",
          "glyphColorMode", { contrast: "Contrast", tinted: "Tinted", invert: "Inverted" },
          { depth: 2, value: get("glyphColorMode") || "contrast" }));
      }
      appearance.push(toggle("Hollow", "Draws only the outline of the box instead of a filled block.", "boxHollow", { depth: 1, gate: true }));
      if (get("boxHollow")) {
        // Nested one level deeper: Outline width is conditional on Hollow,
        // which is itself a sub-option of the style.
        appearance.push(slider("Outline width", "Thickness of the hollow box's outline, in pixels.", "boxHollowWidth", [1, 6, 1], { depth: 2 }));
      }
    }

    appearance.push(toggle("Gradient", "Blends several colors instead of one flat color.", "gradientEnabled", { gate: true }));
    if (get("gradientEnabled")) {
      // Dropdown values are strings; store a number so the engine's
      // clamping arithmetic doesn't have to care where the value came
      // from. Rebuilds the panel to add or remove color pickers.
      const writeCount = redraw("gradientCount");
      appearance.push(dropdown("Number of colors", "How many colors the blend runs through, from 2 to 4.",
        "gradientCount", { 2: "2", 3: "3", 4: "4" }, {
          depth: 1,
          value: String(get("gradientCount") ?? 2),
          onChange: (v) => writeCount(Number(v)),
        }));
      const count = Math.max(2, Math.min(4, Number(get("gradientCount")) || 2));
      const keys = (prefix: string) => Array.from({ length: count }, (_, i) => (prefix + (i + 1)) as keyof Look);
      appearance.push(swatchRow("Colors (dark theme)", keys("gradientDark"),
        "In order from the top of the cursor to the bottom — or left to right for the Underline style.", 1));
      appearance.push(swatchRow("Colors (light theme)", keys("gradientLight"),
        "The same ramp for light themes, where neon colors tend to wash out.", 1));
    } else {
      // One row, two swatches - dark theme then light - rather than two
      // full-width labelled rows. Same helper, same layout as the gradient
      // rows above: "several pickers that belong to one idea".
      appearance.push(swatchRow("Cursor color", ["colorDark", "colorLight"],
        "Dark theme first, then light. Neon colors that look right on a dark background wash out on a white page."));
    }

    appearance.push(slider("Cursor opacity", "How see-through the cursor is.", "cursorOpacity", [0.1, 1, 0.05]));
    appearance.push(toggle("Translucent", "Blends the cursor into the page instead of painting over it. Overrides Show letter inside cursor.",
      "cursorTranslucent", { gate: true }));
    appearance.push(toggle("Rounded corners", "Softens the cursor's corners. Line and Underline become fully rounded bars; Box gets a gentler curve.",
      "cursorRounded"));

    // --- Blinking ------------------------------------------------------------
    const blinking = [];
    blinking.push(toggle("Blinking", "Makes the cursor blink.", "blinkingEnabled", { gate: true }));
    if (get("blinkingEnabled")) {
      blinking.push(slider("Blink speed", "How fast the cursor blinks.", "blinkSpeed", [0.1, 3, 0.1], { depth: 1 }));
      blinking.push(slider("Blink balance", "How the blink cycle is split between lit and dark.", "blinkOnOffBalance", [0.1, 0.9, 0.05], { depth: 1 }));
      blinking.push(slider("Fade smoothness", "How gradually the cursor fades in and out. 0.15 is the original feel.", "blinkFade", [0.05, 0.5, 0.05], { depth: 1, fallback: 0.15 }));
      blinking.push(toggle("Don't blink while typing", "Keeps the cursor fully lit while you type or move it.", "smoothStopBlinking", { depth: 1 }));
      blinking.push(slider("Blink delay", "How long the cursor stays lit after a keystroke, in ms.", "blinkDelayMs", [0, 2000, 50], { depth: 1, fallback: 0 }));
      blinking.push(slider("Stop after", "Blink this many times after each move, then stay lit. 0 blinks forever.", "blinkStopAfter", [0, 20, 1], { depth: 1, fallback: 0 }));
      blinking.push(toggle("Breathing", "The cursor swells and shrinks instead of fading out.", "blinkBreathing", { depth: 1, gate: true }));
      if (get("blinkBreathing")) {
        blinking.push(slider("Breath depth", "How far the cursor shrinks at the bottom of the breath.", "blinkBreathDepth", [0.05, 0.5, 0.05], { depth: 2, fallback: 0.2 }));
      }
    }

    // --- Smooth movement -----------------------------------------------------
    const smooth = [];
    smooth.push(toggle("Smooth movement", "Makes the cursor glide to its new spot instead of jumping there instantly.", "smoothEnabled", { gate: true }));
    if (get("smoothEnabled")) {
      smooth.push(slider("Glide amount", "How much the cursor eases as it travels.", "smoothness", [0.05, 0.30, 0.05], { depth: 1 }));
      smooth.push(slider("Catch-up speed", "How quickly the cursor chases the real caret.", "catchUpSpeed", [0.30, 0.80, 0.05], { depth: 1 }));
      // Max catch-up speed is meaningless on its own - it is only ever read
      // inside the adaptive branch - so it hangs off that toggle rather than
      // sitting beside it as a live-looking slider that does nothing.
      smooth.push(toggle("Speed up when typing fast", "Lets the cursor exceed Catch-up speed while you type, so it can't fall behind.", "smoothAdaptive", { depth: 1, gate: true }));
      if (get("smoothAdaptive")) {
        smooth.push(slider("Max catch-up speed", "The fastest the speed-up is allowed to get.", "maxCatchUpSpeed", [0.50, 1.0, 0.05], { depth: 2 }));
      }
      smooth.push(slider("Movement delay", "Delay before the cursor sets off, in ms. 0 follows immediately.", "moveDelayMs", [0, 500, 10], { depth: 1 }));
    }

    // --- Effects -------------------------------------------------------------
    // One card for every effect, each a toggle with its options under it.
    // Two rows here read gates that live in other cards - Gradient decides
    // whether Pixel trail's Gradient colors, Energy beam's Aurora and Neon's
    // Gradient trail are offered, and Blinking decides whether the torch's
    // Sync with blink is - which is fine: every gate rebuilds the whole
    // panel from memory.
    const effects = [];

    // Pop effects: one group for everything the cursor throws off in
    // response to a keystroke. Rainbow is a modifier across all four, so it
    // sits at the BOTTOM of the group rather than nested under any one of
    // them - and only once at least one of them is actually on, since with
    // the whole group idle it is a switch that recolours nothing.
    effects.push(toggle("Pop effects", "Things the cursor throws off as you type — letters, lightning and fireworks.", "popEffects", { gate: true }));
    if (get("popEffects")) {
      effects.push(toggle("Popping letters", "Each character you type springs out of the cursor and tumbles away as it fades.", "popLetters", { depth: 1, gate: true }));
      // Sits next to Popping letters on purpose: they're the pair that fires
      // per character, one for adding and one for removing. The two below
      // are the bigger, rarer events.
      effects.push(toggle("Backspace disintegration", get("popRainbow")
        ? "Deleting throws a burst outward. Rainbow takes the next color in the sweep, inverted."
        : "Deleting throws a burst outward in inverted colors.",
        // A gate, not a plain set: Rainbow at the bottom of this group
        // appears as soon as any one of the four effects is on, so this row
        // controls another row's visibility.
        "backspaceDisintegrate", { depth: 1, gate: true }));
      effects.push(toggle("Thunderstrike", "Enter calls down a bolt of pixelated lightning onto the new line.", "thunderstrike", { depth: 1, gate: true }));
      if (get("thunderstrike")) {
        effects.push(slider("Bolt size", "How fine the lightning is, in pixels per block.", "thunderstrikeSize", [1, 5, 1], { depth: 2, fallback: 2 }));
        effects.push(slider("Bolt strength", get("popRainbow")
          ? "How brightly the strike shows. Rainbow colors each bolt."
          : "How brightly the strike shows.",
          "thunderstrikeStrength", [0.1, 1, 0.05], { depth: 2, fallback: 0.5 }));
      }
      effects.push(toggle("Fireworks", "Space and Enter send shells climbing out of the cursor to burst above it.", "fireworks", { depth: 1, gate: true }));
      if (get("fireworks")) {
        // The colour source isn't configurable - it follows Rainbow, then
        // Gradient, then the cursor colour - so it's described rather than
        // offered.
        effects.push(slider("Quantity", "How many shells go up per keypress, and how much each throws.", "fireworksQuantity", [0.2, 3, 0.1], { depth: 2, fallback: 1 }));
      }
      // Rainbow last, and only when there is something for it to recolour.
      // The four effects above are independent of each other; this is the one
      // control in the group that reaches all of them, so it reads as a
      // summary of the group rather than as another sibling effect.
      //
      // Note the gate is on the four effects, NOT on popEffects: the group
      // can be on with every effect inside it off, and that is exactly the
      // state where a Rainbow toggle is a switch that visibly does nothing.
      // Same rule as Sync with blink under the torch, and Gradient colors
      // under Pixel trail.
      const anyPop = !!get("popLetters") || !!get("backspaceDisintegrate") ||
                     !!get("thunderstrike") || !!get("fireworks");
      if (anyPop) {
        // A gate rather than a plain set: this toggle changes what the
        // Backspace disintegration and Thunderstrike rows above say about
        // where their colors come from, and those descriptions are built
        // at definition time.
        effects.push(toggle("Rainbow", "Sweeps every pop effect around the color wheel as you type.", "popRainbow", { depth: 1, gate: true }));
      }
    }

    effects.push(toggle("Pixel trail", "Scatters a small puff of colored pixels wherever the cursor has just been.", "flameTrail", { gate: true }));
    if (get("flameTrail")) {
      effects.push(slider("Pixel density", "How many pixels the trail sheds. 0 hides them entirely.", "flameTrailDensity", [0, 3, 0.1], { depth: 1, fallback: 1 }));
      effects.push(toggle("Trail on jump", "Lays pixels along the whole path of a jump, not just at the start.", "flameTrailOnJump", { depth: 1 }));
      effects.push(slider("Pixel lifetime", "How long each pixel lasts before it fades out, in milliseconds.", "flameTrailLifeMs", [100, 2000, 50], { depth: 1, fallback: 400 }));
      effects.push(slider("Pixel size", "How big each pixel is.", "flameTrailPixelSize", [1, 12, 0.5], { depth: 1, fallback: 4 }));
      // Only meaningful with a gradient to sample - offered only when Gradient
      // is on, so it isn't a switch that visibly does nothing.
      if (get("gradientEnabled")) {
        effects.push(toggle("Gradient colors", "Colors each pixel from the cursor's gradient instead of one flat color.", "flameTrailGradientColors", { depth: 1 }));
      }
      effects.push(slider("Gravity", "A steady pull on the pixels. 0 leaves them drifting sideways.", "flameTrailGravity", [0, 1, 0.05], { depth: 1, fallback: 0, gate: true }));
      if ((get("flameTrailGravity") ?? 0) > 0) {
        effects.push(slider("Gravity direction", "Which way the pull goes, in degrees. 0 is down, 90 right, 180 up, 270 left.", "flameTrailGravityAngle", [0, 359, 5], { depth: 2, fallback: 0 }));
      }
    }

    effects.push(toggle("Stardust", "A slow stream of floating pixels that drift up and fade.", "stardustEnabled", { gate: true }));
    if (get("stardustEnabled")) {
      effects.push(toggle("Always on", "Streams continuously instead of waiting for the cursor to settle.", "stardustAlwaysOn", { depth: 1, gate: true }));
      // The delay is what Always on overrides, so hide it rather than leave
      // a live-looking slider that no longer does anything.
      if (!get("stardustAlwaysOn")) {
        effects.push(slider("Idle delay", "How long (in ms) the cursor must sit still before the stardust starts.", "stardustDelayMs", [500, 8000, 250], { depth: 1, fallback: 2000 }));
      }
      effects.push(slider("Stardust density", "How thickly the stardust streams off the cursor.", "stardustRate", [0.2, 3, 0.1], { depth: 1, fallback: 1 }));
      effects.push(toggle("Orbit", "Motes circle the cursor like fireflies instead of drifting up.", "stardustOrbit", { depth: 1, gate: true }));
      if (get("stardustOrbit")) {
        effects.push(slider("Orbit radius", "How wide the motes circle, in pixels.", "stardustOrbitRadius", [10, 60, 2], { depth: 2, fallback: 22 }));
      }
    }

    effects.push(toggle("Bracket tether", "Underlines the span between matching brackets or quotes.", "bracketTether", { gate: true }));
    if (get("bracketTether")) {
      effects.push(slider("Tether strength", "How visible the line is.", "bracketTetherStrength", [0.1, 1, 0.05], { depth: 1, fallback: 0.35 }));
    }

    effects.push(toggle("Motion smear", "The cursor stretches as it moves and snaps back when it arrives.", "smear", { gate: true }));
    if (get("smear")) {
      effects.push(slider("Stiffness", "How hard the leading edge is pulled toward the new position.", "smearStiffness", [0.1, 1, 0.05], { depth: 1 }));
      effects.push(slider("Trailing stiffness", "The same for the edge left behind.", "smearTrailingStiffness", [0.05, 1, 0.05], { depth: 1 }));
      effects.push(slider("Damping", "How much the springs resist overshooting.", "smearDamping", [0.05, 1, 0.05], { depth: 1 }));
      effects.push(toggle("Tapered trail", "Narrows the smear to a point behind the cursor, like a comet tail.", "smearTaper", { depth: 1, gate: true }));
      if (get("smearTaper")) {
        effects.push(slider("Taper amount", "How sharply the tail closes. At 1 it comes to a full point.", "smearTaperAmount", [0.1, 1, 0.05], { depth: 2, fallback: 0.7 }));
      }
      effects.push(slider("Max length", "How far the tail may trail the cursor, in pixels. Lower keeps the smear short; 0 = no limit.", "smearMaxLength", [0, 400, 10], { depth: 1, fallback: 0 }));
      effects.push(toggle("Conserve volume", "A jump to another line thins as it stretches, keeping its area. Straight moves: use Tapered trail.", "smearConserveVolume", { depth: 1, gate: true }));
      if (get("smearConserveVolume")) {
        effects.push(slider("Thinning", "How strongly the area is held. At 1 a streak twice as long is half as wide.", "smearVolumeStrength", [0.1, 1, 0.05], { depth: 2, fallback: 0.3 }));
      }
    }

    effects.push(toggle("Energy beam", get("gradientEnabled")
      ? "Scrolls your gradient along the cursor, with a brightness pulse riding over it."
      : "Runs a shimmering pulse of light along the cursor.",
      "energyEffect", { gate: true }));
    if (get("energyEffect")) {
      effects.push(slider("Beam speed", "How fast the pulse travels along the cursor.", "energySpeed", [0.2, 3, 0.1], { depth: 1 }));
      // Aurora has nothing to work with without a ramp - it warps and
      // cross-mixes gradient colors - so it only appears once Gradient is on.
      if (get("gradientEnabled")) {
        effects.push(toggle("Aurora", "Swirls your gradient colors instead of scrolling them past.", "energyAurora", { depth: 1, gate: true }));
        if (get("energyAurora")) {
          effects.push(slider("Waviness", "How hard the bands bend. 0 keeps them flat.", "energyAuroraWaviness", [0, 2, 0.05], { depth: 2, fallback: 1 }));
        }
      }
    }

    effects.push(toggle("CRT effect", "Old-monitor phosphor look: the cursor leaves fading ghosts behind it.", "crtEffect", { gate: true }));
    if (get("crtEffect")) {
      effects.push(slider("Trail length", "How many ghosts are kept behind the cursor. 0 leaves none.", "trailLength", [0, 30, 1], { depth: 1 }));
      effects.push(slider("Trail fade time", "How long (in ms) each ghost takes to fade out.", "trailFadeMs", [50, 1500, 25], { depth: 1 }));
      effects.push(toggle("Glow", get("speedDemon") && !get("speedDemonNoCursorHeat")
        ? "Soft halo around the cursor, in its own color. With Speed demon on it swells as the cursor heats up."
        : "Soft halo around the cursor, in its own color.",
        "glow", { depth: 1, gate: true }));
      effects.push(toggle("Neon trail", "Renders the ghosts as a glowing neon tube instead of fading boxes.", "crtNeon", { depth: 1, gate: true }));
      if (get("crtNeon") && get("gradientEnabled")) {
        effects.push(toggle("Gradient trail", "Runs the cursor's gradient along the streak, newest ghost to oldest.", "crtNeonGradient", { depth: 2 }));
      }
      effects.push(toggle("Signal glitch", "Long jumps break up like a mistracked video signal.", "crtGlitch", { depth: 1, gate: true }));
      if (get("crtGlitch")) {
        effects.push(slider("Break-up", "How far the slices are thrown and how much the cursor's shape warps.", "crtGlitchStrength", [0.2, 2.5, 0.1], { depth: 2, fallback: 1 }));
        effects.push(slider("Color split", "How far the color channels separate. 0 only tears the shape.", "crtGlitchAberration", [0, 3, 0.1], { depth: 2, fallback: 1 }));
        effects.push(slider("Duration", "How long each burst lasts, in milliseconds.", "crtGlitchMs", [60, 600, 10], { depth: 2, fallback: 220 }));
      }
    }

    effects.push(toggle("Speed demon", "The cursor heats from grey to white-hot as you type, then cools when you stop.", "speedDemon", { gate: true }));
    if (get("speedDemon")) {
      effects.push(toggle("Fire sparks", "Throws embers off the cursor once it is hot enough.", "speedDemonSparks", { depth: 1, gate: true }));
      if (get("speedDemonSparks")) {
        effects.push(slider("Spark quantity", "How many embers spawn per burst. 0 stops them without switching the effect off.", "speedDemonSparkQuantity", [0, 3, 0.1], { depth: 2, fallback: 1 }));
        effects.push(slider("Spark trail", "Gives each spark a fading comet tail, in pixels. 0 = no trail.", "speedDemonSparkTrail", [0, 30, 1], { depth: 2, fallback: 0 }));
      }
      effects.push(toggle("Keep cursor color", "The cursor keeps your color; only the sparks react to speed.", "speedDemonNoCursorHeat", { depth: 1, gate: true }));
      effects.push(slider("Sensitivity", "How fast typing and caret movement heat the cursor up.", "speedDemonSensitivity", [0.5, 2, 0.1], { depth: 1 }));
      // Hidden while Keep cursor color is on: that option says the cursor
      // shouldn't change colour with speed at all, which makes a custom
      // colour ramp for exactly that a contradiction rather than a choice.
      if (!get("speedDemonNoCursorHeat")) {
        effects.push(toggle("Custom gradient", "Replaces the built-in heat curve with four colors of your own.", "speedDemonGradient", { depth: 1, gate: true }));
        if (get("speedDemonGradient")) {
          // Same one-row-of-pickers layout the Gradient rows use.
          const heat = (prefix: string) => [1, 2, 3, 4].map((i) => (prefix + i) as keyof Look);
          effects.push(swatchRow("Stages (dark theme)", heat("speedHeatDark"),
            "Warming to flat out, left to right. At rest the cursor keeps its own color.", 2));
          effects.push(swatchRow("Stages (light theme)", heat("speedHeatLight"),
            "The same four stages for light themes, where a white-hot final stage disappears into the page.", 2));
        }
      }
    }

    effects.push(toggle("Hot-head", "Sets the text you're working on alight.", "hotHead", { gate: true }));
    if (get("hotHead")) {
      effects.push(slider("Fire quantity", "How much fire is emitted. 0 puts it out without switching Hot-head off.", "hotHeadQuantity", [0, 3, 0.1], { depth: 1, fallback: 1 }));
      effects.push(slider("Fire spread", "How much surrounding text catches, in characters. 0 burns only the cursor's own column.", "hotHeadSpread", [0, 14, 1], { depth: 1, fallback: 4 }));
      effects.push(slider("Trail over text", "Fire laid along the path travelled. 0 keeps it where the cursor stops.", "hotHeadTrail", [0, 30, 1], { depth: 1, fallback: 6 }));
      effects.push(slider("Flame height", "How high the flames climb before they burn out.", "hotHeadHeight", [0.15, 1.5, 0.05], { depth: 1, fallback: 0.55 }));
      effects.push(slider("Fade time", "How long a single fire particle lasts, in milliseconds.", "hotHeadFade", [200, 1600, 20], { depth: 1, fallback: 620 }));
      effects.push(slider("Idle timeout", "Idle time before the fire burns out. 0 keeps it burning forever.", "hotHeadIdleMs", [0, 6000, 100], { depth: 1, fallback: 1500 }));
      effects.push(slider("Fire opacity", "How solid the fire is, independent of the cursor's own opacity.", "hotHeadOpacity", [0.1, 1, 0.05], { depth: 1, fallback: 1 }));
      effects.push(toggle("Use cursor color", "Paints the fire in the cursor's color instead of the heat gradient.", "hotHeadFlat", { depth: 1, gate: true }));
      // Nested under Use cursor color, and hidden without it, because that
      // is the only mode it can actually do anything in - see
      // hotHeadSpeedHeat's gate in drawHotHead. Also hidden without Speed
      // demon itself, since there would be no heat to follow.
      if (get("hotHeadFlat") && get("speedDemon")) {
        effects.push(toggle("Heat with speed demon", "The fire warms up as you type, following Speed demon's heat.", "hotHeadSpeedHeat", { depth: 2, gate: true }));
      }
    }

    effects.push(row("Torch spotlight", "Darkens everything except a pool of light around the cursor.",
      (s) => renderTorchToggleSetting(s, afterWrite("torchEffect"))));
    if (get("torchEffect")) {
      // The two subheadings are labels within the torch's options, not
      // siblings of the torch toggle itself.
      effects.push(this.subheadingRow("Spotlight", 1));
      effects.push(dropdown("Follow", "What the light tracks.", "overlayFollowMode",
        { caret: "Text cursor only", mouse: "Mouse pointer only", auto: "Auto intelligent swap" }, { depth: 1 }));
      effects.push(slider("Light size", "How far the lit circle reaches, in pixels.", "overlayRadius", [100, 800, 10], { depth: 1 }));
      // Only offered when there's a blink to sync to - with blinking off the
      // toggle would be a switch that does nothing, and the reason why would
      // be in a different card.
      if (get("blinkingEnabled")) {
        effects.push(toggle("Sync with blink", "The light closes in as the cursor blinks out and opens back up as it returns.", "overlayBlinkSync", { depth: 1, gate: true }));
        if (get("overlayBlinkSync")) {
          effects.push(slider("Pulse depth", "How far the light closes at its darkest, as a share of Light size. At 1 it goes out.", "overlayBlinkDepth", [0.05, 1, 0.05], { depth: 2, fallback: 0.25 }));
        }
      }
      effects.push(row("Light color", "The color of the light at its center.",
        (s) => { s.addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor"))); }, 1));
      effects.push(slider("Follow speed", "How quickly the light catches up when the cursor moves.", "overlaySpeed", [0.05, 1, 0.05], { depth: 1 }));

      effects.push(this.subheadingRow("Environment", 1));
      effects.push(slider("Darkness", "How far everything outside the light is dimmed.", "overlayDarkness", [0.2, 1, 0.01], { depth: 1 }));
      // A gate: Flicker's description below says whether there is anything
      // to flicker, and that depends on this value.
      effects.push(slider("Glow strength", "Strength of the warm glow. 0 gives a pure spotlight.", "overlayIntensity", [0, 1, 0.05], { depth: 1, gate: true }));
      // Sits under Glow strength because that is the value it modulates: the
      // flame swings either side of whatever that slider is set to, so at 0
      // there is nothing to flicker and this says so rather than appearing to
      // be broken.
      effects.push(toggle("Flicker", get("overlayIntensity") > 0
        ? "The light gutters like a candle instead of burning steady."
        : "The light gutters like a candle. Does nothing while Glow strength is 0.",
        "overlayFlicker", { depth: 1, gate: true }));
      if (get("overlayFlicker")) {
        effects.push(slider("Flicker depth", "How far the flame swings either side of Glow strength. At 1 it gutters right out.", "overlayFlickerAmount", [0.05, 1, 0.05], { depth: 2, fallback: 0.35 }));
      }
      effects.push(toggle("Keep sidebars lit", "Dims only the editor, leaving sidebars and ribbon lit. Desktop only.", "overlaySpareSidebars", { depth: 1 }));
    }

    const cards: LookCards = [
      this.section("Appearance", appearance),
      this.section("Blinking", blinking),
      this.section("Smooth movement", smooth),
      this.section("Effects", effects),
    ];
    cards.gates = gates;
    return cards;
  }
}
/* nosourcemap */
/* nosourcemap */
