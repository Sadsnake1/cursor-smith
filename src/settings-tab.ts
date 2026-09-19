import { PluginSettingTab, Setting, App, Modal, setIcon } from "obsidian";
import type { SettingDefinitionControl, SettingDefinitionItem, SettingDefinitionGroup, SettingDefinitionPage, SettingDefinitionRender, SettingGroupItem, SliderComponent } from "obsidian";
import type CursorSmithPlugin from "./plugin";
import { DEFAULT_SETTINGS, LOOK_KEYS, VIM_MODE_KEYS, VIM_MODE_LABELS, presetWithDefaults } from "./settings";
import { SHARE_VERSION, SHARE_VERSION_VIM, presetToCode, vimPresetToCode } from "./share";
import { readableGlyphColor } from "./color";
import { DemoStrip } from "./demo";
import type { DropdownOptions, Look, LookCards, LookSettingsHooks, Needs, RailEffect, RowOptions, SettingKey, SliderOptions, SwatchOptions } from "./types";

// The effects, in the order the Effects page lists them: the master key,
// the name and description of the entry, and its Lucide icon.
// The icons are Lucide's, by name, drawn by Obsidian's setIcon; the torch's
// is registered by the plugin at load (CANDLE_ICON in plugin.ts).
const RAIL_EFFECTS: RailEffect[] = [
  { key: "popEffects", name: "Pop effects", icon: "party-popper", desc: "Letters, lightning and fireworks thrown off as you type." },
  { key: "flameTrail", name: "Pixel trail", icon: "wind", desc: "A puff of colored pixels wherever the cursor has just been." },
  { key: "stardustEnabled", name: "Stardust", icon: "sparkles", desc: "Floating motes that drift up, or orbit the cursor." },
  { key: "bracketTether", name: "Bracket tether", icon: "brackets", desc: "A line under the span between matching brackets or quotes." },
  { key: "smear", name: "Motion smear", icon: "paintbrush", desc: "The cursor stretches as it moves and snaps back when it arrives." },
  { key: "energyEffect", name: "Energy beam", icon: "zap", desc: "A pulse of light along the cursor; an aurora with a gradient." },
  { key: "crtEffect", name: "CRT effects", icon: "circuit-board", desc: "Phosphor ghosts behind the cursor, neon and glitch options." },
  { key: "speedDemon", name: "Speed demon", icon: "gauge", desc: "Heats from gray to white-hot as you type, throwing sparks." },
  { key: "hotHead", name: "Hot-head", icon: "flame", desc: "Sets the text you are working on alight." },
  { key: "torchEffect", name: "Torch spotlight", icon: "cursor-smith-candle", desc: "Darkens everything except a pool of light around the cursor." },
];

// A small prompt: a title, one text field, OK. What Save and Import on the
// preset strip open. `submit` answers true to close, false to keep the
// prompt (nothing to do), or a string to show under the field and keep it.
// How long a tapped trash stays "Delete?" before it turns back.
const DELETE_ARM_MS = 3000;

class PresetPrompt extends Modal {
  constructor(app: App, title: string, placeholder: string, submit: (value: string) => Promise<boolean | string | void> | boolean | string | void) {
    super(app);
    this.setTitle(title);
    const field = this.contentEl.createEl("input", { type: "text", attr: { placeholder, spellcheck: "false" } });
    field.addClass("cursor-smith-prompt-field");
    const note = this.contentEl.createDiv({ cls: "cursor-smith-prompt-note" });
    const go = async () => {
      const value = field.value.trim();
      const result = await submit(value);
      if (result === false) return;
      if (typeof result === "string") { note.setText(result); field.focus(); return; }
      this.close();
    };
    field.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); void go(); } });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const ok = buttons.createEl("button", { cls: "mod-cta", text: "OK", attr: { type: "button" } });
    ok.addEventListener("click", () => { void go(); });
    const cancel = buttons.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    this.field = field;
  }
  field: HTMLInputElement;
  onOpen() { this.field.focus(); }
}

export class CursorSmithSettingTab extends PluginSettingTab {
  plugin: CursorSmithPlugin;
  // What a refresh repaints beyond Obsidian's own `visible` pass: the rail's
  // chips, the cards' summaries, the rows disabled by a setting elsewhere.
  // Rows register these while they render; the list is emptied whenever the
  // tree is built again, because the rows are then rendered again.
  _refreshers: (() => void)[] = [];
  // Which effect the Effects page's rail shows, by its master key, or "all";
  // null until the user picks one (then the first effect that is on). Panel
  // state for the session, never in the settings.
  _effectsPick: string | null = null;
  // The effects that are on in the look the pages show (set with the
  // pages), for the Effects entry's icons; and the observer that puts
  // them there.
  _effectsOn: (() => RailEffect[]) | null = null;
  _valueObserver: MutationObserver | null = null;
  // The element that holds the pages (see _decorateRoot).
  _pagesRoot: HTMLElement | null = null;
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
    this._refreshers = [];
    const vim = (this.plugin.settings.uiMode || "cua") === "vim";
    const items: SettingDefinitionItem[] = [
      this.headerGroup(),
      this.page("Behavior", "sliders-horizontal", "Where it draws, power saving, reduced motion.", [this.generalGroup()]),
    ];
    if (vim) items.push(...this.vimDefinitions());
    else items.push(...this.normalDefinitions());
    items.push(this.footerRow());
    return items;
  }

  // The version, a muted line under the pages. Not a heading: Obsidian's
  // guidelines ask plugins not to head their settings with their own name,
  // and Community plugins lists the version anyway. Read off the manifest,
  // so a release is a one-line edit in manifest.json.
  footerRow(): SettingDefinitionRender {
    const plugin = this.plugin;
    return {
      name: "",
      desc: `Cursor-Smith ${plugin.manifest?.version ?? ""}`.trim(),
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-footer");
      },
    };
  }

  // -------------------------------------------------------------------------
  // The categories are Obsidian's own sub-pages: an entry in the list that
  // slides its page in when clicked, with a back button - the "Ribbon menu
  // configuration" kind - on desktop and on a phone alike. An entry shows
  // its icon and one line of description, and `displayValue` says what the
  // page is set to (Box · translucent; On · 1.2x; 3 on) so the whole
  // cursor reads at a glance without opening anything. Obsidian evaluates
  // displayValue when it renders the entry, which it does again when the
  // page is left.
  // -------------------------------------------------------------------------
  page(name: string, icon: string, desc: string, items: SettingDefinitionItem[], displayValue?: () => string, status?: () => "warning" | null): SettingDefinitionPage {
    return {
      type: "page",
      name,
      desc: this.iconDesc(icon, desc),
      items,
      displayValue,
      status,
    };
  }

  // A description with a Lucide icon in front of it, for a page's entry
  // (and the rows that wear one). Obsidian renders the entry itself - the
  // name, then the description - and the description is the one slot that
  // takes markup, so the icon is written here; once the entry is in the
  // DOM, decorateIcons moves it out of the description to the front of
  // the entry's info block, which styles.css lays out as a grid with the
  // icon in the first column (.cursor-smith-iconed). It used to be done
  // in CSS alone with :has() and display: contents; the plugin review
  // warns on both, and this is the same picture without them.
  iconDesc(icon: string, text: string): DocumentFragment {
    return createFragment((f) => {
      setIcon(f.createSpan({ cls: "cursor-smith-page-icon" }), icon);
      f.appendText(text);
    });
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

  // Obsidian's refresh re-asks every row's `visible`; ours also repaints
  // what the rows registered (see _refreshers). A gate's write calls this.
  refreshDomState() {
    super.refreshDomState();
    this.runRefreshers();
    this.decoratePanel();
  }

  hide() {
    super.hide();
    // The decorate observer stays. Obsidian 1.13 does not ask for the
    // definitions again when the tab is reopened - it re-renders the ones it
    // has - so an observer dropped here was never recreated (watchEffectsValue
    // runs from getSettingDefinitions), and from the second opening on every
    // leading icon sat in its description and the Effects entry showed its
    // names. A hidden tab mutates nothing, so a kept observer costs nothing;
    // the plugin's onunload disconnects it.
  }

  // Two things Obsidian's own rendering cannot be told to do go in after
  // it renders: the Effects entry's value becomes the icons of the effects
  // that are on (displayValue takes a string only), and every leading icon
  // written into a description moves to the front of its entry. An
  // observer on the tab's own element - the settings window is its own
  // document, so not on `document` - runs the pass whenever an entry is
  // rendered or its text refreshed; refreshDomState runs it too.
  watchEffectsValue() {
    if (this._valueObserver) return;
    const win = this.containerEl?.ownerDocument?.defaultView;
    if (!win || typeof win.MutationObserver !== "function") return;
    this._valueObserver = new win.MutationObserver(() => { this.decoratePanel(); });
    this._observe();
    this.decoratePanel();
  }

  // Where the pass looks and the observer listens: the element that holds
  // the pages, not the tab's container. Obsidian 1.13 shows a sub-page
  // (Behavior, Effects and the rest) by DETACHING the tab's container and
  // rendering the page (div.setting-page) into the same
  // .vertical-tab-content-container, so a pass over the container decorated
  // the root list and never a page - the effect headings on the Effects
  // page kept their icons in the descriptions - and while a page shows the
  // container has no parent to climb to. So the holder is remembered while
  // the container is attached (the root list showing) and used while it is
  // still in the document. The container is the tab's for life; the holder
  // can be a new element when the settings window is opened again, and the
  // container itself is watched as well, which is what wakes the pass when
  // the root list is rendered into it again, so the new holder is taken.
  _decorateRoot(): HTMLElement | null {
    const c = this.containerEl;
    if (!c) return null;
    const parent = c.parentElement as HTMLElement | null;
    if (parent) this._pagesRoot = parent;
    const root = this._pagesRoot;
    return root && root.isConnected !== false ? root : c;
  }

  _observe() {
    const o = this._valueObserver;
    const root = this._decorateRoot();
    if (!o || !root) return;
    const opts = { childList: true, subtree: true, characterData: true };
    o.observe(root, opts);
    if (root !== this.containerEl) o.observe(this.containerEl, opts);
  }

  // The pass. It writes to the DOM the observer watches, so the observer
  // is paused while it writes, and each job leaves nothing for itself to
  // do on the next call (a rewrite on every call re-fired the observer
  // forever once, and hung Obsidian).
  decoratePanel() {
    const observer = this._valueObserver;
    if (observer) observer.disconnect();
    try {
      this.decorateIcons();
      this.decorateEffectsValue();
    } finally {
      this._observe();
    }
  }

  // A leading icon still inside its description moves to the front of
  // the entry's info block, which takes the grid class. Nothing to do
  // once it has moved (its parent is the info block, not a description).
  decorateIcons() {
    const root = this._decorateRoot();
    if (!root) return;
    for (const icon of Array.from(root.querySelectorAll(".cursor-smith-page-icon"))) {
      const desc = icon.parentElement;
      if (!desc || !desc.hasClass("setting-item-description")) continue;
      const info = desc.parentElement;
      if (!info || !info.hasClass("setting-item-info")) continue;
      info.addClass("cursor-smith-iconed");
      info.prepend(icon);
    }
  }

  decorateEffectsValue() {
    const on = this._effectsOn ? this._effectsOn() : null;
    // The container, not the pages' holder: the Effects entry is in the
    // root list, and the holder shows another tab's rows once the user
    // switches tabs - a row of theirs named "Effects" is not ours to dress.
    const root = this.containerEl;
    if (!on || !root) return;
    const sig = on.map((e) => e.key).join(",");
    // A value already in the wanted state is left alone - a write fires the
    // observer, which runs this again (decoratePanel pauses it, but the
    // guard is what makes the pass converge; the first cut re-wrote "Off"
    // on every call and hung Obsidian in a mutation loop).
    const wanted = (value: Element) => value.getAttribute("data-cs-effects") === sig
      && (on.length ? !!value.querySelector(".cursor-smith-value-icon") : value.getText() === "Off");
    const rows = Array.from(root.querySelectorAll(".setting-item")).filter((row) => {
      const name = row.querySelector(".setting-item-name");
      return !!name && name.getText().trim() === "Effects" && !!row.querySelector(".setting-item-value") && !wanted(row.querySelector(".setting-item-value") as Element);
    });
    for (const row of rows) {
      const value = row.querySelector(".setting-item-value") as HTMLElement;
      value.empty();
      value.setAttribute("data-cs-effects", sig);
      if (!on.length) { value.setText("Off"); continue; }
      value.setAttribute("title", on.map((e) => e.name).join(", "));
      for (const e of on) setIcon(value.createSpan({ cls: "cursor-smith-value-icon", attr: { "aria-label": e.name } }), e.icon);
    }
  }

  onRefresh(f: () => void) {
    (this._refreshers ||= []).push(f);
  }

  runRefreshers() {
    for (const f of this._refreshers || []) {
      try { f(); } catch (e) { this.plugin._reportOnce("settings panel refresher", e); }
    }
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
  row(name: string, desc: string | DocumentFragment, build: (setting: Setting) => void, depth = 0): SettingDefinitionRender {
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
  // A page's rows, as one of Obsidian's setting groups - a row is a Setting
  // inside it, indexed for settings search. The group's own heading is not
  // shown (the page's title is it) and the card's box is opted out of
  // (styles.css), keeping the flat look.
  // -------------------------------------------------------------------------
  section(title: string, items: SettingGroupItem[]): SettingDefinitionGroup {
    return { type: "group", heading: title, cls: "cursor-smith-section cursor-smith-in-page", items };
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
  // for when the OS is suppressing motion, and the two switches that decide
  // what the rest of the panel IS - the plugin on or off, and one cursor or
  // one per Vim mode. Everything else is a page.
  // -------------------------------------------------------------------------
  headerGroup(): SettingDefinitionGroup {
    const plugin = this.plugin;
    const vim = (plugin.settings.uiMode || "cua") === "vim";
    // The notice is second, not first: Obsidian drops the separator above
    // a group's first row only, and with the (usually hidden) notice
    // first, Enable plugin wore a line across the top of the panel.
    const items: SettingGroupItem[] = [
        {
          name: "Enable plugin",
          control: { type: "toggle", key: "enabled" },
        },
        this.reducedMotionNotice(),
        {
          name: "Vim mode",
          render: (setting) => this.renderVimToggle(setting),
        },
    ];
    // In Vim mode the row of mode tabs sits here, above the pages: every
    // look page is that mode's, so the choice belongs outside them all.
    if (vim) items.push(...this.vimAlertRows());
    // The presets, out of every page: a strip of thin cards, the CUA look's
    // or the Vim five-mode ones while Vim is on (that is the cursor in use).
    // In Vim mode they come before the mode tabs: a preset is all five
    // modes, the tabs pick one to edit.
    items.push(this.presetStripRow(vim));
    if (vim) {
      if (!VIM_MODE_KEYS.includes(plugin._vimEditMode)) plugin._vimEditMode = "normal";
      items.push(...this.vimModeRows(plugin._vimEditMode));
    }
    // No heading: the version is the footer (footerRow).
    return {
      type: "group",
      cls: "cursor-smith-global",
      items,
    };
  }

  // --- The preset strip ------------------------------------------------------------
  // One thin card per saved preset: a little text with a caret crawling it
  // in that preset's look (pure CSS - the shape, the colour, the glow, the
  // blink; it crawls three letters and jumps back, or sits still under
  // reduced motion), the name, a tick on the one in use, and its buttons
  // beside it: update it with the current look, copy its share code,
  // delete it. Tap the card to use it. Two more cards save the current
  // look under a name and import a share code, each through a small
  // prompt. The Vim library while Vim is on, with the Normal mode's look
  // on the card.
  presetStripRow(vim: boolean): SettingDefinitionRender {
    const plugin = this.plugin;
    const library = vim ? plugin.getVimPresets() : plugin.getUserPresets();
    const names = Object.keys(library);
    return {
      name: "Presets",
      // No description (the user: "presets don't need one"); the cards say
      // it, and Save and Import are their own words.
      desc: this.iconDesc("bookmark", ""),
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-presets-row");
        const strip = setting.controlEl.createDiv({ cls: "cursor-smith-presets" });
        const active = vim ? plugin.settings.vimActivePreset : this.presetInUse();
        // Every card's demo on one frame loop (demo.ts); a re-render drops
        // the old ones as their elements leave the document.
        const demos = new DemoStrip();
        const dark = plugin.isDarkTheme();
        const reduced = plugin.reducedMotion();
        for (const name of names) {
          const entry = library[name];
          const look = presetWithDefaults(vim ? (entry as Record<string, Look>).normal : (entry));
          const isActive = name === active;
          // The card is a div, not a button: buttons inside a button are
          // invalid HTML, and a screen reader skips a button's children.
          // Instead the demo, the name and the tick are one button that
          // uses the preset, filling the card's left side, and the actions
          // are its siblings - every one of them reachable by Tab.
          const card = strip.createDiv({ cls: "cursor-smith-pcard" + (isActive ? " is-active" : "") });
          const use = card.createEl("button", { cls: "cursor-smith-pcard-use", attr: { type: "button", "aria-label": `Use preset ${name}`, "aria-pressed": isActive ? "true" : "false" } });
          if (isActive) setIcon(use.createSpan({ cls: "cursor-smith-tick" }), "check");
          // Speed demon's ramp: the engine's own warm one, or the preset's
          // four stops with Custom gradient on (paint.ts, heatColorFor).
          const ramp = !look.speedDemonGradient ? ["#ff8c28", "#ff461e", "#fff0c8"] : dark
            ? [look.speedHeatDark1, look.speedHeatDark2, look.speedHeatDark3, look.speedHeatDark4].map((c) => c ?? "")
            : [look.speedHeatLight1, look.speedHeatLight2, look.speedHeatLight3, look.speedHeatLight4].map((c) => c ?? "");
          // The gradient's stops for the theme, as many as Number of colors.
          const count = Math.max(2, Math.min(4, look.gradientCount ?? 2));
          const gradient = (dark
            ? [look.gradientDark1, look.gradientDark2, look.gradientDark3, look.gradientDark4]
            : [look.gradientLight1, look.gradientLight2, look.gradientLight3, look.gradientLight4]).slice(0, count).map((c) => c ?? "");
          // Only the card in use plays (two passes, then it rests); the
          // others sit still.
          demos.add(use, name, look, (dark ? look.colorDark : look.colorLight) ?? "", ramp, gradient, reduced, isActive);
          use.addEventListener("click", () => {
            void (vim ? plugin.loadVimPreset(name) : plugin.loadUserPreset(name)).then(() => this.update());
          });
          const actions = card.createSpan({ cls: "cursor-smith-pcard-actions" });
          const action = (icon: string, label: string, run: () => void) => {
            const b = actions.createEl("button", { cls: "cursor-smith-pcard-action clickable-icon", attr: { type: "button", "aria-label": label, title: label } });
            setIcon(b, icon);
            b.addEventListener("click", run);
            return b;
          };
          const copy = action("copy", "Copy its share code", () => {
            const code = vim ? vimPresetToCode(name, entry as Record<string, Look>) : presetToCode(name, entry);
            void navigator.clipboard.writeText(code).then(() => {
              setIcon(copy, "check");
              window.setTimeout(() => { setIcon(copy, "copy"); }, 1500);
            });
          });
          // Delete is two taps and no dialog: the first turns the trash
          // into a red "Delete?" for three seconds, the second deletes.
          // Left alone, it turns back into the trash.
          let armed = 0;
          const trash = action("trash", "Delete this preset", () => {
            if (trash.hasClass("is-armed")) {
              window.clearTimeout(armed);
              void (vim ? plugin.deleteVimPreset(name) : plugin.deleteUserPreset(name)).then(() => this.update());
              return;
            }
            trash.addClass("is-armed");
            trash.setText("Delete?");
            trash.setAttribute("aria-label", "Tap again to delete");
            armed = window.setTimeout(() => {
              trash.removeClass("is-armed");
              trash.empty();
              setIcon(trash, "trash");
              trash.setAttribute("aria-label", "Delete this preset");
            }, DELETE_ARM_MS);
          });
        }
        // Save the current look, import a code.
        const more = (icon: string, label: string, run: () => void) => {
          const b = strip.createEl("button", { cls: "cursor-smith-pcard cursor-smith-pcard-more", attr: { type: "button" } });
          setIcon(b.createSpan({ cls: "cursor-smith-pcard-more-icon" }), icon);
          b.createSpan({ cls: "cursor-smith-pcard-name", text: label });
          b.addEventListener("click", run);
        };
        // Save and Import on a line of their own below the presets, however
        // many there are: a full-width item breaks the wrapping row before
        // them (styles.css). They used to wrap along with the presets.
        strip.createDiv({ cls: "cursor-smith-pcard-break" });
        more("save", "Save", () => {
          // A name that is already taken warns once and keeps the prompt;
          // OK again with the same name replaces the preset.
          let warned = "";
          new PresetPrompt(this.app, vim ? "Save these five mode cursors as" : "Save this look as", vim ? "Vim preset name" : "Preset name", async (name) => {
            if (!name) return false;
            if (name in library && warned !== name) {
              warned = name;
              return `A preset named ${name} exists. OK again to replace it.`;
            }
            if (vim) await plugin.saveVimPreset(name); else await plugin.saveUserPreset(name);
            this.update();
            return true;
          }).open();
        });
        more("download", "Import", () => {
          new PresetPrompt(this.app, vim ? "Import a Vim share code" : "Import a share code", "Paste the code here", async (code) => {
            if (!code) return false;
            const ok = vim ? await plugin.importVimPreset(code) : await plugin.importPreset(code);
            if (ok) { this.update(); return true; }
            // The two code kinds are one character apart at a glance, so say
            // which mistake was made rather than a flat "invalid".
            const other = vim ? SHARE_VERSION + "|" : SHARE_VERSION_VIM + "|";
            return code.startsWith(other) ? (vim ? "That's a regular code, not a Vim one" : "That's a Vim code, not a regular one") : "Invalid code";
          }).open();
        });
      },
    };
  }

  // Which saved preset the look in use IS: the one whose every look key
  // equals the settings'. Read off the look rather than off a name
  // remembered at load time, which is gone after a reload and would stay
  // after an edit. Empty when the look is nothing that was saved.
  presetInUse(): string {
    const plugin = this.plugin;
    const presets = plugin.getUserPresets();
    const look = plugin.settings;
    for (const name of Object.keys(presets)) {
      const p = presetWithDefaults(presets[name]);
      if (LOOK_KEYS.every((k) => p[k] === look[k])) return name;
    }
    return "";
  }


  // A tiny alert under the Vim mode toggle while it is on, for the new
  // user who flipped it out of curiosity: what just happened to the
  // editor, and the way back (the toggle right above it - no button of
  // its own). Three wordings by state, all predicates so a flip of
  // "Control Obsidian's Vim key bindings" is a visibility refresh: the
  // plugin drives Obsidian's bindings and they are on (the editor takes
  // Vim keys now); it drives them but they look off (transient - reopen
  // the editor); it does not drive them and they are off (nothing shows
  // until they are on). A Vim user driving nothing, with them on, sees
  // none. The one place this is said: the Vim page has no note of its
  // own.
  vimAlertRows(): SettingDefinitionRender[] {
    const plugin = this.plugin;
    const alert = (text: string, visible: () => boolean): SettingDefinitionRender => ({
      name: "",
      desc: text,
      searchable: false,
      visible,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-alert");
        // Obsidian keeps the row's element across update() and runs this
        // again: the icon from last time has to go first, or every mode
        // tab click adds one more (it did - nine in a row).
        setting.settingEl.querySelectorAll(".cursor-smith-alert-icon").forEach((old) => { old.remove(); });
        const icon = setting.settingEl.createSpan({ cls: "cursor-smith-alert-icon" });
        setIcon(icon, "triangle-alert");
        setting.settingEl.prepend(icon);
      },
    });
    const drives = () => !!plugin.settings.vimControlObsidian;
    const on = () => plugin.isObsidianVimOn();
    return [
      alert("Your editor now uses Vim key bindings. Not a Vim user? Turn Vim mode off.",
        () => drives() && on()),
      alert("Vim key bindings look off. Reopen the editor if the mode cursors don't show.",
        () => drives() && !on()),
      alert("This needs Vim key bindings on in Settings → Editor. Not a Vim user? Turn Vim mode off.",
        () => !drives() && !on()),
    ];
  }

  // The Behavior page: the five global switches. They are structural rather
  // than looks - none is in LOOK_KEYS, so none is part of a preset or of a
  // per-Vim-mode snapshot - they apply to whatever cursor is on screen, in
  // both modes.
  generalGroup(): SettingDefinitionGroup {
    const items: SettingDefinitionControl[] = [
      {
        name: "Note editor only",
        desc: "Notes only; search, settings and dialogs keep Obsidian's caret.",
        control: { type: "toggle", key: "noteEditorOnly", defaultValue: false },
      },
      {
        name: "Hide real cursor",
        desc: "Hides Obsidian's own caret so only this one shows.",
        control: { type: "toggle", key: "hideNativeCaret" },
      },
      {
        name: "Hide cursor when unfocused",
        desc: "Hides the cursor while Obsidian isn't the active window.",
        control: { type: "toggle", key: "hideOnWindowBlur", defaultValue: true },
      },
      {
        name: "Low power mode",
        desc: "Halves every effect's frame rate, for battery or a slow machine.",
        control: { type: "toggle", key: "lowPowerMode", defaultValue: false },
      },
      {
        name: "Respect reduced motion",
        desc: "Pauses the moving effects when your system asks for reduced motion.",
        control: { type: "toggle", key: "respectReducedMotion", defaultValue: true },
      },
    ];
    return this.section("Behavior", items);
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
      desc: "Your system asks for reduced motion, so Smooth movement, Motion smear and the other moving effects are paused - the toggles below still show your own settings. Turn off \"Respect reduced motion\" to override.",
      searchable: false,
      visible: () => this.reducedMotionActive(),
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-reduced-notice");
        // This row is built on every render (hidden or not), so it is
        // where the panel's own document gets registered - see
        // registerPanelDocument.
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
  // The Vim mode toggle. On turns Vim-aware cursors on (and, per
  // vimControlObsidian, flips Obsidian's own Vim key bindings); off turns
  // them off. This one control is both the panel switch and the feature's
  // on/off switch. (It was a CUA / Vim segmented switch until the eighth
  // UI pass; the user: "make Vim a toggle instead, drop the CUA thing".)
  // -------------------------------------------------------------------------
  renderVimToggle(setting: Setting) {
    const plugin = this.plugin;
    const isVim = () => (plugin.settings.uiMode || "cua") === "vim";
    setting.addToggle((t) => t.setValue(isVim()).onChange(async (on) => {
      if (isVim() === on) return;
      // Deliberately NOT setting uiMode here: setVimModeEnabled writes it
      // (keeping both flags in one place), and it needs the pre-click state
      // intact to decide whether the "restore Obsidian's vim" path applies.
      // Writing uiMode first blinded that check whenever the two flags had
      // drifted apart, silently skipping the restore.
      await plugin.setVimModeEnabled(on);
      this.update();
    }));
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
    const cards = this.lookDefinitions({
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
      });
    return this.lookPages(cards);
  }


  // The four look cards as pages, each entry saying what it is set to.
  lookPages(cards: LookCards): SettingDefinitionPage[] {
    const s = cards.summaries || {};
    this._effectsOn = cards.effectsOn ?? null;
    this.watchEffectsValue();
    const meta: [string, string, string][] = [
      ["Appearance", "palette", "Shape, color, opacity."],
      ["Blinking", "eye-closed", "If it blinks, how, and how fast."],
      ["Smooth movement", "spline", "Gliding to the new spot instead of jumping."],
      ["Effects", "wand", "Trails, sparks, fire, lightning, a torch."],
    ];
    return cards.map((group, i) => this.page(meta[i][0], meta[i][1], meta[i][2], [group], s[meta[i][0]]));
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

    const cards = this.modeDefinitions(target, () => {
      plugin.settings.vimActivePreset = "";
    });
    return [
      this.page("Vim", "terminal", "Obsidian's Vim key bindings, and the mode in the status bar.", [this.vimCursorsGroup()],
        undefined, () => (plugin.isObsidianVimOn() ? null : "warning")),
      ...this.lookPages(cards),
    ];
  }

  vimCursorsGroup(): SettingDefinitionGroup {
    const plugin = this.plugin;
    const items = [];

    items.push(this.row("Control Obsidian's Vim key bindings",
      "Turns Obsidian's Vim key bindings on and off with the mode above.", (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimControlObsidian).onChange(async (value) => {
            plugin.settings.vimControlObsidian = value;
            // Taking ownership mid-session: immediately enforce the current
            // mode so the keybindings match what the panel shows.
            if (value) plugin.setObsidianVim(!!plugin.settings.vimModeEnabled);
            await plugin.saveSettings();
            // The warning below picks its wording by this value.
            this.refreshDomState();
          }));
      }));

    items.push(this.row("Show Vim mode in status bar",
      "Shows the mode in the status bar: -- NORMAL --.", (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimStatusBar).onChange(async (value) => {
            plugin.settings.vimStatusBar = value;
            plugin.syncVimStatusBar();
            await plugin.saveSettings();
            this.refreshDomState();
          }));
      }));

    const colorRow = this.row("Color status bar text to match the cursor",
      "Tints the mode name with that mode's cursor color.", (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimStatusBarColor).onChange(async (value) => {
            plugin.settings.vimStatusBarColor = value;
            await plugin.saveSettings();
          }));
      }, 1);
    colorRow.visible = () => !!plugin.settings.vimStatusBar;
    items.push(colorRow);

    // No warning of its own about Obsidian's Vim key bindings being off:
    // the header's alert (vimAlertRows) says it, in every state, and this
    // page's entry carries the warning badge.
    return this.section("Vim", items);
  }


  // Per-mode editor: pick one mode, then edit its FULL cursor config in the
  // look cards that follow this one.
  vimModeRows(mode: string): SettingDefinitionRender[] {
    const items: SettingDefinitionRender[] = [];

    items.push(this.row("Mode", this.iconDesc("layers", ""),
      (setting) => this.renderModeTabs(setting.controlEl)));

    if (mode === "command") {
      items.push(this.noteRow(
        "Applies whenever the caret leaves the note editor: the built-in Vim command " +
        "line (the \":\" / \"/\" prompt) and the rest of the Obsidian interface — Command " +
        "Palette, Quick Switcher, search, rename boxes, Settings fields and plugin modals. " +
        "Motion effects (smear, smooth movement, CRT trail) are best left off here: these " +
        "are all single-line fields, so they read as jitter rather than movement."));
    }

    return items;
  }

  // Tab row — one tab per Vim mode. Same visual language as the CUA/Vim
  // segmented switch at the top of the panel. Each inactive tab's label is
  // tinted with that mode's own cursor color (for the current theme), so the
  // row doubles as a live color legend; the active tab uses the accent
  // background instead, where a tint would be unreadable.
  renderModeTabs(containerEl: HTMLElement) {
    const plugin = this.plugin;
    const isDarkTheme = containerEl.ownerDocument?.body?.classList?.contains("theme-dark") ?? true;
    // Pills, the Effects chips' (.cursor-smith-chip), so the header's
    // pills all read alike; each in its mode's cursor color - the text of
    // an idle tab, the fill of the picked one with black or white on it,
    // whichever reads.
    const tabWrap = containerEl.createDiv({ cls: "cursor-smith-mode-tabs" });
    const tabs: HTMLElement[] = [];
    for (const m of VIM_MODE_KEYS) {
      const active = plugin._vimEditMode === m;
      const cfg: Partial<Look> = plugin.settings.vimModes[m] || {};
      const tint = isDarkTheme ? cfg.colorDark : cfg.colorLight;
      const btn = tabWrap.createEl("button", {
        text: VIM_MODE_LABELS[m],
        cls: "cursor-smith-chip cursor-smith-mode-tab" + (active ? " is-picked" : ""),
        attr: { type: "button", "aria-pressed": active ? "true" : "false" },
      });
      if (tint) btn.setCssStyles(active ? { backgroundColor: tint, borderColor: tint, color: readableGlyphColor(tint, "contrast") } : { color: tint });
      btn.addEventListener("click", () => {
        if (plugin._vimEditMode === m) return;
        plugin._vimEditMode = m;
        this.update();
      });
      tabs.push(btn);
    }
    this.rovingRow(tabWrap, tabs).picked(Math.max(0, VIM_MODE_KEYS.indexOf(plugin._vimEditMode)));
  }

  // The FULL set of cursor look/effect cards bound to an arbitrary
  // settings-shaped `target` object (here, one Vim mode's snapshot).
  modeDefinitions(target: Look, onEdit: () => void): LookCards {
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
  lookDefinitions({ get, set, renderCursorStyleSetting, renderTorchToggleSetting, afterReset }: LookSettingsHooks): LookCards {
    const gates: Set<keyof Look> = new Set();
    // Every key each card's rows write, for the card's reset button (and
    // the tests, which check that no look key is left out).
    const cardKeys: Record<string, (keyof Look)[]> = { Appearance: [], Blinking: [], "Smooth movement": [], Effects: [] };
    let card = "Appearance";
    const owns = (key: keyof Look) => { if (!cardKeys[card].includes(key)) cardKeys[card].push(key); };

    // --- What a write does to the panel ------------------------------------
    // Every row is built every time; a row that depends on a gate carries a
    // `visible` predicate, and Obsidian re-evaluates every predicate on
    // refreshDomState() - a class toggle per row, no re-render - and this
    // tab's override repaints what the rows registered (the rail's chips,
    // the card summaries, the rows a setting elsewhere disables). That is
    // what a gate's write calls. update(), which hands Obsidian a new tree
    // and has it rebuilt and reconciled, costs 60-80ms for this panel's 70
    // rows (measured in the 1.13.7 settings window) and is kept for the one
    // change that alters the tree: the number of colour pickers in a row.
    //
    // The write itself runs before the refresh, so the predicates read the
    // new value; the save's promise is returned so a failure surfaces.
    const refresh = () => this.refreshDomState();
    const redraw = <K extends keyof Look>(key: K) => {
      gates.add(key);
      return async (v: Look[K]) => {
        const saved = set(key)(v);
        refresh();
        await saved;
      };
    };
    const rebuild = <K extends keyof Look>(key: K) => {
      gates.add(key);
      return async (v: Look[K]) => {
        const saved = set(key)(v);
        this.update();
        await saved;
      };
    };
    // For the two caller-built controls: what they call after their own write.
    const afterWrite = (key: keyof Look) => {
      gates.add(key);
      owns(key);
      return refresh;
    };
    // A card's reset: its keys back to their defaults, then a rebuild (every
    // handle on the card moves) and the caller's own follow-up.
    const resetCard = (title: string) => () => {
      const writes = cardKeys[title].map((key) => Promise.resolve(set(key)(DEFAULT_SETTINGS[key])));
      void Promise.all(writes).then(() => {
        if (afterReset) afterReset();
        this.update();
      });
    };

    // --- Predicates ------------------------------------------------------------
    const on = (key: keyof Look) => () => !!get(key);
    const off = (key: keyof Look) => () => !get(key);
    const all = (...ps: (() => boolean)[]) => () => ps.every((p) => p());
    const isStyle = (s: string) => () => get("cursorStyle") === s;

    // --- Row builders ---------------------------------------------------------
    // `needs` is a dependency on ANOTHER card (Aurora needs Gradient from
    // Appearance): the row stays visible and is disabled, with the hint in
    // its description, while that setting is off - hidden, it read as a
    // missing option and was reported as one. The state is repainted on
    // every refresh, so a flip of the setting it needs is seen at once.
    const row = (name: string, desc: string, build: (s: Setting) => void, { depth = 0, when, needs }: SwatchOptions = {}) => {
      // An effect's head row (its name is the rail's) wears the rail's icon
      // in front of its name, as a page entry does.
      const effect = depth === 0 ? RAIL_EFFECTS.find((e) => e.name === name) : undefined;
      const def = this.row(name, effect ? this.iconDesc(effect.icon, desc) : desc, (s) => {
        build(s);
        if (needs) this.needsHint(s, needs);
      }, depth);
      if (when) def.visible = when;
      return def;
    };
    const toggle = (name: string, desc: string, key: keyof Look, { depth = 0, gate = false, when, needs }: RowOptions = {}) => {
      owns(key);
      return row(name, desc, (s) => { s.addToggle((t) => t.setValue(!!get(key)).onChange(gate ? redraw(key) : set(key))); }, { depth, when, needs });
    };
    const dropdown = (name: string, desc: string, key: keyof Look, options: Record<string, string>, { depth = 0, value, onChange, when }: DropdownOptions = {}) => {
      owns(key);
      return row(name, desc, (s) => {
        s.addDropdown((d) => d.addOptions(options)
          .setValue(value !== undefined ? value : get(key) as string)
          .onChange(onChange || set(key)));
      }, { depth, when });
    };

    // --- Every slider, with "restore default" ------------------------------
    // A small icon button sitting to the right of a slider, putting that one
    // dial back to its DEFAULT_SETTINGS value. Every slider in this panel gets
    // one, from this one helper - so there is no per-row copy of "what is this
    // slider's default" to drift out of date, and a new slider that forgets
    // the button is visibly the odd one out.
    //
    // The button writes the default and moves the slider's own handle to it
    // (a handle is DOM state nothing else updates), through the slider's
    // own onChange path - so a dial that gates other rows (Gravity, say)
    // refreshes them too.
    //
    // The default is read from DEFAULT_SETTINGS rather than from the
    // `fallback` a row shows: those fallbacks are what a *sparse* Vim-mode
    // snapshot displays for a key it has never been given, and the two are
    // not obliged to agree (overlayFlickerAmount's don't). What the button
    // promises is the default, so it reads the defaults.
    //
    // No dynamic tooltip on the slider: since 1.13 it always shows its value.
    const slider = (name: string, desc: string, key: keyof Look, [min, max, step]: number[], { depth = 0, fallback, gate = false, when, needs }: SliderOptions = {}) => {
      owns(key);
      return row(name, desc, (s) => {
        const write = gate ? redraw(key) : set(key);
        let handle: SliderComponent | null = null;
        s.addSlider((sl) => { handle = sl; sl.setLimits(min, max, step).setValue((get(key) ?? fallback) as number).onChange(write); })
          .addExtraButton((btn) => btn
            .setIcon("rotate-ccw")
            .setTooltip(`Restore default (${DEFAULT_SETTINGS[key]})`)
            .onClick(() => {
              const v = DEFAULT_SETTINGS[key];
              if (handle) handle.setValue(v as number);
              void write(v);
            }));
      }, { depth, when, needs });
    };

    // Several colour pickers on ONE row, so they lay out side by side in that
    // row's control area (Obsidian's .setting-item-control is already a flex
    // row; .cursor-smith-color-row only adds the gap between swatches)
    // instead of each claiming its own full-width labelled row. A label
    // under each swatch says which is which.
    const swatchRow = (name: string, keys: (keyof Look)[], labels: string[], desc: string, { depth = 0, when }: SwatchOptions = {}) => {
      keys.forEach(owns);
      return row(name, desc, (s) => {
        s.settingEl.addClass("cursor-smith-color-row");
        keys.forEach((key, i) => {
          const cell = s.controlEl.createDiv({ cls: "cursor-smith-swatch-cell" });
          s.addColorPicker((cp) => cp.setValue((get(key) || DEFAULT_SETTINGS[key]) as string).onChange(set(key)));
          // The picker's input is the last thing the Setting appended; it
          // moves into the cell so the label can sit under it.
          const input = s.controlEl.lastElementChild;
          if (input && input !== cell) cell.appendChild(input);
          cell.createSpan({ cls: "cursor-smith-swatch-label", text: labels[i] ?? "" });
        });
      }, { depth, when });
    };
    const subheading = (title: string, depth: number, when: () => boolean) => {
      const def = this.subheadingRow(title, depth);
      def.visible = when;
      return def;
    };

    // --- Appearance ----------------------------------------------------------
    const appearance = [];
    appearance.push(row("Cursor style", "The shape of the cursor itself.",
      (s) => renderCursorStyleSetting(s, afterWrite("cursorStyle"))));

    // Everything that applies to exactly one cursor style lives here, in a
    // sub-group hanging directly off the dropdown that selects it, so the
    // card reads as "Cursor style, then the options for the style you
    // picked".
    const line = isStyle("Line"), underline = isStyle("Underline"), box = isStyle("Box");
    appearance.push(slider("Cursor thickness", "How thick the Line cursor is, in pixels.", "caretWidthPx", [1, 12, 1], { depth: 1, when: line }));
    appearance.push(toggle("Serifs", "Adds I-beam serifs at the top and bottom of the line.", "lineSerifs", { depth: 1, when: line }));
    appearance.push(slider("Underline thickness", "Underline thickness in pixels. 0 fits the line height.",
      "underlineWidthPx", [0, 12, 1], { depth: 1, fallback: 0, when: underline }));
    appearance.push(toggle("Show letter inside cursor", "Shows the letter inside the block, colors flipped.",
      "showChar", { depth: 1, gate: true, when: box }));
    appearance.push(dropdown("Letter color",
      "Contrast: black or white. Tinted: the flipped color, kept legible. Inverted: a raw flip.",
      "glyphColorMode", { contrast: "Contrast", tinted: "Tinted", invert: "Inverted" },
      { depth: 2, value: get("glyphColorMode") || "contrast", when: all(box, on("showChar")) }));
    appearance.push(toggle("Hollow", "Draws only the outline of the box instead of a filled block.", "boxHollow", { depth: 1, gate: true, when: box }));
    // Nested one level deeper: Outline width is conditional on Hollow, which
    // is itself a sub-option of the style.
    appearance.push(slider("Outline width", "Thickness of the hollow box's outline, in pixels.", "boxHollowWidth", [1, 6, 1],
      { depth: 2, when: all(box, on("boxHollow")) }));

    appearance.push(toggle("Gradient", "Blends several colors instead of one flat color.", "gradientEnabled", { gate: true }));
    const gradient = on("gradientEnabled");
    // Dropdown values are strings; store a number so the engine's clamping
    // arithmetic doesn't have to care where the value came from. The count
    // is how many pickers the two rows below carry, so this one rebuilds.
    const writeCount = rebuild("gradientCount");
    appearance.push(dropdown("Number of colors", "How many colors the blend runs through, from 2 to 4.",
      "gradientCount", { 2: "2", 3: "3", 4: "4" }, {
        depth: 1, when: gradient,
        value: String(get("gradientCount") ?? 2),
        onChange: (v) => writeCount(Number(v)),
      }));
    const count = Math.max(2, Math.min(4, Number(get("gradientCount")) || 2));
    const keys = (prefix: string) => Array.from({ length: count }, (_, i) => (prefix + (i + 1)) as keyof Look);
    // The card owns all four stops of each ramp, shown or not, so a reset
    // puts the hidden ones back too.
    for (let i = 1; i <= 4; i++) { owns(("gradientDark" + i) as keyof Look); owns(("gradientLight" + i) as keyof Look); }
    const stops = Array.from({ length: count }, (_, i) => String(i + 1));
    appearance.push(swatchRow("Colors (dark theme)", keys("gradientDark"), stops,
      "From the top of the cursor to the bottom — or left to right for the Underline style.", { depth: 1, when: gradient }));
    appearance.push(swatchRow("Colors (light theme)", keys("gradientLight"), stops,
      "The same ramp for light themes, where neon colors tend to wash out.", { depth: 1, when: gradient }));
    appearance.push(swatchRow("Cursor color", ["colorDark", "colorLight"], ["Dark", "Light"],
      "One for each theme. Neon colors that look right on a dark background wash out on a white page.", { when: off("gradientEnabled") }));

    appearance.push(slider("Cursor opacity", "How see-through the cursor is.", "cursorOpacity", [0.1, 1, 0.05]));
    appearance.push(toggle("Translucent", "Blends the cursor into the page instead of painting over it.",
      "cursorTranslucent"));
    appearance.push(toggle("Rounded corners", "Softens the corners: rounded bars for Line and Underline, a gentle curve for Box.",
      "cursorRounded"));
    // --- Blinking ------------------------------------------------------------
    card = "Blinking";
    const blinking = [];
    blinking.push(toggle("Blinking", "Makes the cursor blink.", "blinkingEnabled", { gate: true }));
    const blink = on("blinkingEnabled");
    blinking.push(slider("Blink speed", "How fast the cursor blinks.", "blinkSpeed", [0.1, 3, 0.1], { depth: 1, when: blink }));
    blinking.push(slider("Blink balance", "How the blink cycle is split between lit and dark.", "blinkOnOffBalance", [0.1, 0.9, 0.05], { depth: 1, when: blink }));
    blinking.push(slider("Fade smoothness", "How gradually the cursor fades in and out.", "blinkFade", [0.05, 0.5, 0.05], { depth: 1, fallback: 0.15, when: blink }));
    blinking.push(toggle("Don't blink while typing", "Keeps the cursor fully lit while you type or move it.", "smoothStopBlinking", { depth: 1, when: blink }));
    blinking.push(slider("Blink delay", "How long the cursor stays lit after a keystroke, in ms.", "blinkDelayMs", [0, 2000, 50], { depth: 1, fallback: 0, when: blink }));
    blinking.push(slider("Stop after", "Blink this many times after each move, then stay lit. 0 blinks forever.", "blinkStopAfter", [0, 20, 1], { depth: 1, fallback: 0, when: blink }));
    blinking.push(toggle("Breathing", "The cursor swells and shrinks instead of fading out.", "blinkBreathing", { depth: 1, gate: true, when: blink }));
    blinking.push(slider("Breath depth", "How far the cursor shrinks at the bottom of the breath.", "blinkBreathDepth", [0.05, 0.5, 0.05],
      { depth: 2, fallback: 0.2, when: all(blink, on("blinkBreathing")) }));
    // --- Smooth movement -----------------------------------------------------
    card = "Smooth movement";
    const smooth = [];
    smooth.push(toggle("Smooth movement", "The cursor glides to its new spot instead of jumping.", "smoothEnabled", { gate: true }));
    const gliding = on("smoothEnabled");
    smooth.push(slider("Glide amount", "How much the cursor eases as it travels.", "smoothness", [0.05, 0.30, 0.05], { depth: 1, when: gliding }));
    smooth.push(slider("Catch-up speed", "How quickly the cursor chases the real caret.", "catchUpSpeed", [0.30, 0.80, 0.05], { depth: 1, when: gliding }));
    // Max catch-up speed is meaningless on its own - it is only ever read
    // inside the adaptive branch - so it hangs off that toggle rather than
    // sitting beside it as a live-looking slider that does nothing.
    smooth.push(toggle("Speed up when typing fast", "Goes past Catch-up speed while you type, so it never falls behind.", "smoothAdaptive", { depth: 1, gate: true, when: gliding }));
    smooth.push(slider("Max catch-up speed", "The fastest the speed-up is allowed to get.", "maxCatchUpSpeed", [0.50, 1.0, 0.05],
      { depth: 2, when: all(gliding, on("smoothAdaptive")) }));
    smooth.push(slider("Movement delay", "Delay before the cursor sets off, in ms. 0 follows immediately.", "moveDelayMs", [0, 500, 10], { depth: 1, when: gliding }));
    // --- Effects -------------------------------------------------------------
    // The Effects page: a RAIL of chips at the top, one per effect with its
    // icon and a dot for "on", and the picked effect's rows under it - one
    // effect on screen at a time, one back to the list of pages (an effect
    // per sub-page was one back too many). "All" shows every effect's rows.
    // The pick is panel state, kept for the session, never in the settings.
    //
    // Every effect's rows carry the pick in their predicate, on top of their
    // own gates. Rows that read gates living in OTHER cards - Gradient
    // decides whether Pixel trail's Gradient colors, Energy beam's Aurora
    // and Neon's Gradient trail do anything, Blinking whether the torch's
    // Sync with blink does - say so with `needs`: shown, disabled, with the
    // hint, instead of hidden.
    card = "Effects";
    const effects: SettingGroupItem[] = [];
    const pick = (): string => {
      if (this._effectsPick) return this._effectsPick;
      const first = RAIL_EFFECTS.find((e) => !!get(e.key));
      return first ? first.key : RAIL_EFFECTS[0].key;
    };
    const shown = (key: keyof Look) => () => { const p = pick(); return p === "all" || p === key; };
    effects.push(this.railRow(get, pick, (key) => { this._effectsPick = key; refresh(); }));
    const needsGradient: Needs = { when: gradient, hint: "Needs Gradient, in Appearance." };
    const needsBlink: Needs = { when: on("blinkingEnabled"), hint: "Needs Blinking." };

    // Pop effects: one group for everything the cursor throws off in
    // response to a keystroke. Rainbow is a modifier across all four, so it
    // sits at the BOTTOM of the group rather than nested under any one of
    // them - and only once at least one of them is actually on, since with
    // the whole group idle it is a switch that recolours nothing.
    const showPop = shown("popEffects");
    effects.push(toggle("Pop effects", "Letters, lightning and fireworks thrown off as you type.", "popEffects", { gate: true, when: showPop }));
    const pop = all(showPop, on("popEffects"));
    effects.push(toggle("Popping letters", "Each letter you type springs out of the cursor and tumbles away.", "popLetters", { depth: 1, gate: true, when: pop }));
    // Sits next to Popping letters on purpose: they're the pair that fires
    // per character, one for adding and one for removing. The two below
    // are the bigger, rarer events.
    effects.push(toggle("Backspace disintegration", "Deleting throws a burst outward in flipped colors.",
      "backspaceDisintegrate", { depth: 1, gate: true, when: pop }));
    effects.push(toggle("Thunderstrike", "Enter calls down a bolt of pixelated lightning onto the new line.", "thunderstrike", { depth: 1, gate: true, when: pop }));
    effects.push(slider("Bolt size", "How fine the lightning is, in pixels per block.", "thunderstrikeSize", [1, 5, 1], { depth: 2, fallback: 2, when: all(pop, on("thunderstrike")) }));
    effects.push(slider("Bolt strength", "How bright the strike is.", "thunderstrikeStrength", [0.1, 1, 0.05],
      { depth: 2, fallback: 0.5, when: all(pop, on("thunderstrike")) }));
    effects.push(toggle("Fireworks", "Space and Enter send shells up from the cursor to burst above it.", "fireworks", { depth: 1, gate: true, when: pop }));
    // The colour source isn't configurable - it follows Rainbow, then
    // Gradient, then the cursor colour - so it's described rather than
    // offered.
    effects.push(slider("Quantity", "How many shells go up per keypress, and how much each throws.", "fireworksQuantity", [0.2, 3, 0.1], { depth: 2, fallback: 1, when: all(pop, on("fireworks")) }));
    // Rainbow last, and only when there is something for it to recolour: the
    // gate is on the four effects, NOT on popEffects. The group can be on
    // with every effect inside it off, and that is exactly the state where
    // a Rainbow toggle is a switch that visibly does nothing.
    const anyPop = () => pop() && (!!get("popLetters") || !!get("backspaceDisintegrate") || !!get("thunderstrike") || !!get("fireworks"));
    effects.push(toggle("Rainbow", "Sweeps every pop effect around the color wheel as you type.", "popRainbow", { depth: 1, when: anyPop }));

    const showTrail = shown("flameTrail");
    effects.push(toggle("Pixel trail", "A puff of colored pixels wherever the cursor has just been.", "flameTrail", { gate: true, when: showTrail }));
    const trail = all(showTrail, on("flameTrail"));
    effects.push(slider("Pixel density", "How many pixels the trail sheds. 0 hides them entirely.", "flameTrailDensity", [0, 3, 0.1], { depth: 1, fallback: 1, when: trail }));
    effects.push(toggle("Trail on jump", "Lays pixels along the whole path of a jump, not just at the start.", "flameTrailOnJump", { depth: 1, when: trail }));
    effects.push(slider("Pixel lifetime", "How long each pixel lasts before it fades out, in milliseconds.", "flameTrailLifeMs", [100, 2000, 50], { depth: 1, fallback: 400, when: trail }));
    effects.push(slider("Pixel size", "How big each pixel is.", "flameTrailPixelSize", [1, 12, 0.5], { depth: 1, fallback: 4, when: trail }));
    effects.push(toggle("Gradient colors", "Colors the pixels from the cursor's gradient.", "flameTrailGradientColors", { depth: 1, when: trail, needs: needsGradient }));
    effects.push(slider("Gravity", "A steady pull on the pixels. 0 leaves them drifting sideways.", "flameTrailGravity", [0, 1, 0.05], { depth: 1, fallback: 0, gate: true, when: trail }));
    effects.push(slider("Gravity direction", "Where the pull goes, in degrees: 0 down, 90 right, 180 up, 270 left.", "flameTrailGravityAngle", [0, 359, 5],
      { depth: 2, fallback: 0, when: () => trail() && (get("flameTrailGravity") ?? 0) > 0 }));

    const showStardust = shown("stardustEnabled");
    effects.push(toggle("Stardust", "A slow stream of floating pixels that drift up and fade.", "stardustEnabled", { gate: true, when: showStardust }));
    const stardust = all(showStardust, on("stardustEnabled"));
    effects.push(toggle("Always on", "Streams continuously instead of waiting for the cursor to settle.", "stardustAlwaysOn", { depth: 1, gate: true, when: stardust }));
    // The delay is what Always on overrides, so hide it rather than leave a
    // live-looking slider that no longer does anything.
    effects.push(slider("Idle delay", "How long the cursor sits still before the stardust starts, in ms.", "stardustDelayMs", [500, 8000, 250],
      { depth: 1, fallback: 2000, when: all(stardust, off("stardustAlwaysOn")) }));
    effects.push(slider("Stardust density", "How thickly the stardust streams off the cursor.", "stardustRate", [0.2, 3, 0.1], { depth: 1, fallback: 1, when: stardust }));
    effects.push(toggle("Orbit", "Motes circle the cursor like fireflies instead of drifting up.", "stardustOrbit", { depth: 1, gate: true, when: stardust }));
    effects.push(slider("Orbit radius", "How wide the motes circle, in pixels.", "stardustOrbitRadius", [10, 60, 2], { depth: 2, fallback: 22, when: all(stardust, on("stardustOrbit")) }));

    const showTether = shown("bracketTether");
    effects.push(toggle("Bracket tether", "Underlines the span between matching brackets or quotes.", "bracketTether", { gate: true, when: showTether }));
    effects.push(slider("Tether strength", "How visible the line is.", "bracketTetherStrength", [0.1, 1, 0.05], { depth: 1, fallback: 0.35, when: all(showTether, on("bracketTether")) }));

    const showSmear = shown("smear");
    effects.push(toggle("Motion smear", "The cursor stretches as it moves and snaps back when it arrives.", "smear", { gate: true, when: showSmear }));
    const smear = all(showSmear, on("smear"));
    effects.push(slider("Stiffness", "How hard the leading edge is pulled toward the new position.", "smearStiffness", [0.1, 1, 0.05], { depth: 1, when: smear }));
    effects.push(slider("Trailing stiffness", "The same for the edge left behind.", "smearTrailingStiffness", [0.05, 1, 0.05], { depth: 1, when: smear }));
    effects.push(slider("Damping", "How much the leading edge resists overshooting.", "smearDamping", [0.05, 1, 0.05], { depth: 1, when: smear }));
    effects.push(toggle("Tapered trail", "Narrows the smear to a point behind the cursor, like a comet tail.", "smearTaper", { depth: 1, gate: true, when: smear }));
    effects.push(slider("Taper amount", "How sharply the tail closes. At 1 it comes to a full point.", "smearTaperAmount", [0.1, 1, 0.05], { depth: 2, fallback: 0.7, when: all(smear, on("smearTaper")) }));
    effects.push(slider("Max length", "How far the tail may trail, in pixels. 0 is no limit.", "smearMaxLength", [0, 400, 10], { depth: 1, fallback: 0, when: smear }));
    effects.push(toggle("Conserve area", "A jump to another line thins as it stretches, keeping its area.", "smearConserveVolume", { depth: 1, gate: true, when: smear }));
    effects.push(slider("Thinning", "How strongly the area is held. At 1, twice as long is half as wide.", "smearVolumeStrength", [0.1, 1, 0.05], { depth: 2, fallback: 0.3, when: all(smear, on("smearConserveVolume")) }));

    const showEnergy = shown("energyEffect");
    effects.push(toggle("Energy beam", "A pulse of light along the cursor; with Gradient on, it scrolls your colors.", "energyEffect", { gate: true, when: showEnergy }));
    const energy = all(showEnergy, on("energyEffect"));
    effects.push(slider("Beam speed", "How fast the pulse travels along the cursor.", "energySpeed", [0.2, 3, 0.1], { depth: 1, when: energy }));
    // Aurora has nothing to work with without a ramp - it warps and
    // cross-mixes gradient colors - so it needs Gradient.
    effects.push(toggle("Aurora", "Swirls your gradient colors instead of scrolling them past.", "energyAurora", { depth: 1, gate: true, when: energy, needs: needsGradient }));
    effects.push(slider("Waviness", "How hard the bands bend. 0 keeps them flat.", "energyAuroraWaviness", [0, 2, 0.05], { depth: 2, fallback: 1, when: all(energy, on("energyAurora")), needs: needsGradient }));

    const showCrt = shown("crtEffect");
    effects.push(toggle("CRT effects", "Old-monitor phosphor look: the cursor leaves fading ghosts behind it.", "crtEffect", { gate: true, when: showCrt }));
    const crt = all(showCrt, on("crtEffect"));
    effects.push(slider("Trail length", "How many ghosts are kept behind the cursor. 0 leaves none.", "trailLength", [0, 30, 1], { depth: 1, when: crt }));
    effects.push(slider("Trail fade time", "How long (in ms) each ghost takes to fade out.", "trailFadeMs", [50, 1500, 25], { depth: 1, when: crt }));
    effects.push(toggle("Glow", "A soft halo around the cursor in its own color.", "glow", { depth: 1, when: crt }));
    effects.push(toggle("Neon trail", "Renders the ghosts as a glowing neon tube instead of fading boxes.", "crtNeon", { depth: 1, gate: true, when: crt }));
    effects.push(toggle("Gradient trail", "Runs the cursor's gradient along the streak, newest ghost to oldest.", "crtNeonGradient", { depth: 2, when: all(crt, on("crtNeon")), needs: needsGradient }));
    effects.push(toggle("Signal glitch", "Long jumps break up like a mistracked video signal.", "crtGlitch", { depth: 1, gate: true, when: crt }));
    const glitch = all(crt, on("crtGlitch"));
    effects.push(slider("Break-up", "How far the slices are thrown and how much the cursor's shape warps.", "crtGlitchStrength", [0.2, 2.5, 0.1], { depth: 2, fallback: 1, when: glitch }));
    effects.push(slider("Color split", "How far the color channels separate. 0 only tears the shape.", "crtGlitchAberration", [0, 3, 0.1], { depth: 2, fallback: 1, when: glitch }));
    effects.push(slider("Duration", "How long each burst lasts, in milliseconds.", "crtGlitchMs", [60, 600, 10], { depth: 2, fallback: 220, when: glitch }));

    const showDemon = shown("speedDemon");
    effects.push(toggle("Speed demon", "Heats from gray to white-hot as you type, cools when you stop.", "speedDemon", { gate: true, when: showDemon }));
    const demon = all(showDemon, on("speedDemon"));
    effects.push(toggle("Fire sparks", "Throws embers off the cursor once it is hot enough.", "speedDemonSparks", { depth: 1, gate: true, when: demon }));
    const sparks = all(demon, on("speedDemonSparks"));
    effects.push(slider("Spark quantity", "How many embers per burst. 0 stops them.", "speedDemonSparkQuantity", [0, 3, 0.1], { depth: 2, fallback: 1, when: sparks }));
    effects.push(slider("Spark trail", "Gives each spark a fading comet tail, in pixels. 0 = no trail.", "speedDemonSparkTrail", [0, 30, 1], { depth: 2, fallback: 0, when: sparks }));
    effects.push(toggle("Keep cursor color", "The cursor keeps your color; only the sparks react to speed.", "speedDemonNoCursorHeat", { depth: 1, gate: true, when: demon }));
    effects.push(slider("Sensitivity", "How fast typing and caret movement heat the cursor up.", "speedDemonSensitivity", [0.5, 2, 0.1], { depth: 1, when: demon }));
    // Hidden while Keep cursor color is on: that option says the cursor
    // shouldn't change colour with speed at all, which makes a custom
    // colour ramp for exactly that a contradiction rather than a choice.
    const heatRamp = all(demon, off("speedDemonNoCursorHeat"));
    effects.push(toggle("Custom gradient", "Replaces the built-in heat curve with four colors of your own.", "speedDemonGradient", { depth: 1, gate: true, when: heatRamp }));
    const stages = all(heatRamp, on("speedDemonGradient"));
    const heat = (prefix: string) => [1, 2, 3, 4].map((i) => (prefix + i) as keyof Look);
    const stageLabels = ["Warm", "Hot", "Hotter", "Flat out"];
    effects.push(swatchRow("Stages (dark theme)", heat("speedHeatDark"), stageLabels,
      "Warming to flat out. At rest the cursor keeps its own color.", { depth: 2, when: stages }));
    effects.push(swatchRow("Stages (light theme)", heat("speedHeatLight"), stageLabels,
      "The same four stages for light themes, where a white-hot final stage disappears into the page.", { depth: 2, when: stages }));

    const showHot = shown("hotHead");
    effects.push(toggle("Hot-head", "Sets the text you're working on alight.", "hotHead", { gate: true, when: showHot }));
    const hot = all(showHot, on("hotHead"));
    effects.push(slider("Fire quantity", "How much fire. 0 puts it out.", "hotHeadQuantity", [0, 3, 0.1], { depth: 1, fallback: 1, when: hot }));
    effects.push(slider("Fire spread", "How many characters around the cursor catch. 0 burns only its own column.", "hotHeadSpread", [0, 14, 1], { depth: 1, fallback: 4, when: hot }));
    effects.push(slider("Trail over text", "Fire left along the path. 0 keeps it where the cursor stops.", "hotHeadTrail", [0, 30, 1], { depth: 1, fallback: 6, when: hot }));
    effects.push(slider("Flame height", "How high the flames climb before they burn out.", "hotHeadHeight", [0.15, 1.5, 0.05], { depth: 1, fallback: 0.55, when: hot }));
    effects.push(slider("Fade time", "How long a single fire particle lasts, in milliseconds.", "hotHeadFade", [200, 1600, 20], { depth: 1, fallback: 620, when: hot }));
    effects.push(slider("Idle timeout", "Idle time before the fire burns out. 0 keeps it burning forever.", "hotHeadIdleMs", [0, 6000, 100], { depth: 1, fallback: 1500, when: hot }));
    effects.push(slider("Fire opacity", "How solid the fire is, independent of the cursor's own opacity.", "hotHeadOpacity", [0.1, 1, 0.05], { depth: 1, fallback: 1, when: hot }));
    effects.push(toggle("Use cursor color", "Paints the fire in the cursor's color instead of the heat gradient.", "hotHeadFlat", { depth: 1, gate: true, when: hot }));
    // Nested under Use cursor color, and hidden without it, because that is
    // the only mode it can actually do anything in - see hotHeadSpeedHeat's
    // gate in drawHotHead. It needs Speed demon for the heat to follow.
    effects.push(toggle("Heat with speed demon", "The fire warms up as you type, following Speed demon's heat.", "hotHeadSpeedHeat",
      { depth: 2, when: all(hot, on("hotHeadFlat")), needs: { when: on("speedDemon"), hint: "Needs Speed demon." } }));

    const showTorch = shown("torchEffect");
    effects.push(row("Torch spotlight", "Darkens everything except a pool of light around the cursor.",
      (s) => renderTorchToggleSetting(s, afterWrite("torchEffect")), { when: showTorch }));
    const torch = all(showTorch, on("torchEffect"));
    // The two subheadings are labels within the torch's options, not
    // siblings of the torch toggle itself.
    effects.push(subheading("Spotlight", 1, torch));
    effects.push(dropdown("Follow", "What the light tracks.", "overlayFollowMode",
      { caret: "Text cursor only", mouse: "Mouse pointer only", auto: "Auto intelligent swap" }, { depth: 1, when: torch }));
    effects.push(slider("Light size", "How far the lit circle reaches, in pixels.", "overlayRadius", [100, 800, 10], { depth: 1, when: torch }));
    effects.push(toggle("Sync with blink", "The light closes as the cursor blinks out and opens as it returns.", "overlayBlinkSync", { depth: 1, gate: true, when: torch, needs: needsBlink }));
    effects.push(slider("Pulse depth", "How far the light closes at its darkest. At 1 it goes out.", "overlayBlinkDepth", [0.05, 1, 0.05],
      { depth: 2, fallback: 0.25, when: all(torch, on("overlayBlinkSync")), needs: needsBlink }));
    owns("overlayColor");
    effects.push(row("Light color", "The color of the light at its center.",
      (s) => { s.addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor"))); }, { depth: 1, when: torch }));
    effects.push(slider("Follow speed", "How quickly the light catches up when the cursor moves.", "overlaySpeed", [0.05, 1, 0.05], { depth: 1, when: torch }));

    effects.push(subheading("Environment", 1, torch));
    effects.push(slider("Darkness", "How far everything outside the light is dimmed.", "overlayDarkness", [0.2, 1, 0.01], { depth: 1, when: torch }));
    effects.push(slider("Glow strength", "Strength of the warm glow. 0 gives a pure spotlight.", "overlayIntensity", [0, 1, 0.05], { depth: 1, when: torch }));
    // Sits under Glow strength because that is the value it modulates: the
    // flame swings either side of whatever that slider is set to, so at 0
    // there is nothing to flicker and this says so rather than appearing to
    // be broken.
    effects.push(toggle("Flicker", "The light gutters like a candle.", "overlayFlicker", { depth: 1, gate: true, when: torch }));
    effects.push(slider("Flicker depth", "How far the flame swings. At 1 it gutters right out.", "overlayFlickerAmount", [0.05, 1, 0.05],
      { depth: 2, fallback: 0.35, when: all(torch, on("overlayFlicker")) }));
    effects.push(toggle("Keep sidebars lit", "Darkens every note tab; sidebars, ribbon and other views stay lit. Desktop only.", "overlaySpareSidebars", { depth: 1, when: torch }));
    // Each tab ends with its reset.
    appearance.push(this.resetLinkRow("Appearance", resetCard("Appearance")));
    blinking.push(this.resetLinkRow("Blinking", resetCard("Blinking")));
    smooth.push(this.resetLinkRow("Smooth movement", resetCard("Smooth movement")));
    effects.push(this.resetLinkRow("Effects", resetCard("Effects")));

    // What each page's entry says it is set to.
    const summaries: Record<string, () => string> = {
      Appearance: () => {
        const parts = [String(get("cursorStyle") || "Box")];
        if (get("gradientEnabled")) parts.push("gradient");
        if (get("cursorTranslucent")) parts.push("translucent");
        if (get("cursorStyle") === "Box" && get("showChar")) parts.push("letter inside");
        if (get("cursorRounded")) parts.push("rounded");
        return parts.join(" · ");
      },
      Blinking: () => (get("blinkingEnabled") ? `On · ${Number(get("blinkSpeed") ?? 1).toFixed(1)}×` + (get("blinkBreathing") ? " · breathing" : "") : "Off"),
      "Smooth movement": () => (get("smoothEnabled") ? "On" : "Off"),
      // Every effect that is on, by name; Obsidian ellipsizes a long one.
      Effects: () => {
        const on = RAIL_EFFECTS.filter((e) => !!get(e.key));
        return on.length ? on.map((e) => e.name).join(" · ") : "Off";
      },
    };

    const cards: LookCards = [
      this.section("Appearance", appearance),
      this.section("Blinking", blinking),
      this.section("Smooth movement", smooth),
      this.section("Effects", effects),
    ];
    cards.gates = gates;
    cards.cardKeys = cardKeys;
    cards.summaries = summaries;
    cards.effectsOn = () => RAIL_EFFECTS.filter((e) => !!get(e.key));
    return cards;
  }


  // The last row of a look tab: a small link that puts the tab's settings
  // back to their defaults.
  resetLinkRow(title: string, reset: () => void): SettingDefinitionRender {
    return {
      name: "",
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-reset-row");
        const btn = setting.controlEl.createEl("button", { cls: "cursor-smith-reset-link", attr: { type: "button" } });
        setIcon(btn, "rotate-ccw");
        btn.createSpan({ text: `Reset ${title} to defaults` });
        btn.addEventListener("click", reset);
      },
    };
  }


  // --- The Effects rail ------------------------------------------------------
  // One row of chips, one per effect plus "All": a tick while the effect
  // is on, the effect's icon, its name; the picked chip filled with the
  // accent. Repainted on every
  // refresh - an effect's toggle row changes its dot - and a click on one
  // sets the pick and refreshes, which shows its rows and hides the others.
  // In the control area, which Obsidian empties on a re-render.
  railRow(get: LookSettingsHooks["get"], pick: () => string, choose: (key: string) => void): SettingDefinitionRender {
    return {
      name: "Effects",
      desc: "Pick an effect. A tick marks the ones that are on.",
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-rail-row");
        const rail = setting.controlEl.createDiv({ cls: "cursor-smith-rail" });
        const chips: { key: string; el: HTMLElement }[] = [];
        // Tick, icon, name: the tick - the preset cards' - shows while the
        // effect is on (the stylesheet hides it otherwise, so a flip is a
        // class change and no rebuild). "All" has none.
        const chip = (key: string, name: string, icon: string | null) => {
          const el = rail.createEl("button", { cls: "cursor-smith-chip", attr: { type: "button" } });
          if (icon) setIcon(el.createSpan({ cls: "cursor-smith-tick" }), "check");
          if (icon) setIcon(el.createSpan({ cls: "cursor-smith-chip-icon" }), icon);
          el.createSpan({ text: name });
          el.addEventListener("click", () => choose(key));
          chips.push({ key, el });
        };
        for (const e of RAIL_EFFECTS) chip(e.key, e.name, e.icon);
        chip("all", "All", null);
        const roving = this.rovingRow(rail, chips.map((c) => c.el));
        const paint = () => {
          const p = pick();
          for (const c of chips) {
            c.el.toggleClass("is-picked", c.key === p);
            c.el.toggleClass("is-on", c.key !== "all" && !!get(c.key as keyof Look));
            c.el.setAttribute("aria-pressed", c.key === p ? "true" : "false");
          }
          roving.picked(Math.max(0, chips.findIndex((c) => c.key === p)));
        };
        paint();
        this.onRefresh(paint);
      },
    };
  }

  // Arrow keys across a row of pills (the Effects rail, the Vim mode tabs).
  // One pill is in the Tab order - the picked one - and Left/Right/Home/End
  // move focus (and the Tab stop) along the row, so a keyboard user does
  // not Tab through ten chips to reach the rows under them. Enter and
  // Space press the focused pill, as on any button. `picked` re-seats the
  // Tab stop when the pick changes without a rebuild (the rail's refresh).
  rovingRow(row: HTMLElement, pills: HTMLElement[]) {
    const seat = (i: number) => pills.forEach((p, k) => p.setAttribute("tabindex", k === i ? "0" : "-1"));
    row.addEventListener("keydown", (ev) => {
      const i = pills.indexOf(ev.target as HTMLElement);
      if (i < 0) return;
      let j = -1;
      if (ev.key === "ArrowRight") j = (i + 1) % pills.length;
      else if (ev.key === "ArrowLeft") j = (i - 1 + pills.length) % pills.length;
      else if (ev.key === "Home") j = 0;
      else if (ev.key === "End") j = pills.length - 1;
      if (j < 0) return;
      ev.preventDefault();
      seat(j);
      pills[j].focus();
    });
    return { picked: seat };
  }

  // A row that needs a setting from another card: disabled, dimmed, with the
  // hint in its description, while that setting is off. Repainted on every
  // refresh (see _refreshers).
  needsHint(setting: Setting, needs: Needs) {
    const hint = setting.descEl.createSpan({ cls: "cursor-smith-needs-hint", text: " " + needs.hint });
    const paint = () => {
      const ok = needs.when();
      setting.settingEl.toggleClass("cursor-smith-needs", !ok);
      hint.toggleClass("is-shown", !ok);
      for (const c of setting.components) c.setDisabled(!ok);
    };
    paint();
    this.onRefresh(paint);
  }
}
/* nosourcemap */
/* nosourcemap */
