// Renders the settings panel outside Obsidian, to catch the class of bug that
// engine-side tests structurally cannot see: a row that throws while being
// built takes every row after it out of the panel, and nothing else notices.
//
// The panel is declarative (getSettingDefinitions in main.js): the tab hands
// Obsidian a tree of groups and rows, and Obsidian builds a Setting for each
// row and calls the row's `render` with it. This harness does the same with
// a recording Setting stub and just enough of Obsidian's DOM helpers
// (createEl / createDiv / addClass) for the render callbacks to run to
// completion - and it plays Obsidian's part in update(): a control that adds
// or removes rows calls tab.update(), and the harness renders the tree again.
const Plugin = require("./harness");

function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, classes: [], parent: null, listeners: {},
    createEl(t, opts = {}) {
      const child = makeEl(t);
      child.text = opts.text;
      child.parent = el;
      if (opts.cls) child.classes.push(...opts.cls.split(" "));
      if (opts.attr) child.attrs = Object.assign({}, opts.attr);
      el.children.push(child);
      return child;
    },
    createDiv(opts = {}) { return el.createEl("div", opts); },
    createSpan(opts = {}) { return el.createEl("span", opts); },
    addClass(...cs) { el.classes.push(...cs); },
    removeClass(...cs) { el.classes = el.classes.filter((c) => !cs.includes(c)); },
    setCssStyles(styles) { Object.assign(el.style, styles); },
    addEventListener(type, fn) { el.listeners[type] = fn; },
    empty() { el.children.length = 0; },
  };
  return el;
}

// Records what it was configured with as well as accepting it. `_click` and
// `_tooltip` are what let a test actually press a row's reset button and see
// where it writes, rather than only that the button exists.
function control() {
  const c = {
    setValue: (v) => { c._value = v; return c; },
    setLimits: (min, max, step) => { c._limits = { min, max, step }; return c; },
    setPlaceholder: () => c,
    addOption: (k, v) => { (c._options = c._options || {})[k] = v; return c; },
    addOptions: (o) => { c._options = Object.assign(c._options || {}, o); return c; },
    setButtonText: (t) => { c._text = t; return c; },
    setCta: () => c, setDestructive: () => { c._destructive = true; return c; },
    setTooltip: (t) => { c._tooltip = t; return c; },
    setIcon: (i) => { c._icon = i; return c; },
    setDisabled: () => c,
    onChange: (fn) => { c._change = fn; return c; },
    onClick: (fn) => { c._click = fn; return c; },
    inputEl: makeEl("input"),
    extraSettingsEl: makeEl("div"),
  };
  return c;
}

// One rendered row: what Obsidian would have made a Setting of. `controls`
// stays a list of plain kind strings - several tests assert on it. Components
// a test needs to reach into are also collected, by kind, alongside it.
class FakeSetting {
  constructor(def, section, rows) {
    this.settingEl = makeEl("div");
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
    this.row = {
      name: def.name ?? "", desc: typeof def.desc === "string" ? def.desc : (def.desc ? "[fragment]" : ""),
      def, section, controls: [], sliders: [], toggles: [], dropdowns: [], extras: [], buttons: [],
      settingEl: this.settingEl, controlEl: this.controlEl,
    };
    rows.push(this.row);
  }
  setName(n) { this.row.name = n; return this; }
  setDesc(d) { this.row.desc = typeof d === "string" ? d : "[fragment]"; return this; }
  setHeading() { return this; }
  setClass() { return this; }
  addToggle(cb) { const c = control(); this.row.controls.push("toggle"); this.row.toggles.push(c); cb(c); return this; }
  addSlider(cb) { const c = control(); this.row.controls.push("slider"); this.row.sliders.push(c); cb(c); return this; }
  addColorPicker(cb) { this.row.controls.push("color"); cb(control()); return this; }
  addDropdown(cb) { const c = control(); this.row.controls.push("dropdown"); this.row.dropdowns.push(c); cb(c); return this; }
  addText(cb) { this.row.controls.push("text"); cb(control()); return this; }
  addTextArea(cb) { this.row.controls.push("textarea"); cb(control()); return this; }
  addButton(cb) { const c = control(); this.row.controls.push("button"); this.row.buttons.push(c); cb(c); return this; }
  addExtraButton(cb) { const c = control(); this.row.controls.push("extra"); this.row.extras.push(c); cb(c); return this; }
}

const isGroup = (item) => item && (item.type === "group" || item.type === "list");

// Obsidian's part: walk the definitions and build a row for each. A `render`
// row gets a Setting; a `control` row gets the component Obsidian would build
// for it, wired to the tab's getControlValue / setControlValue. Every row is
// built whether or not its `visible` predicate holds - that is how Obsidian
// does it too (visibility is a class on the built row) - and the predicate's
// answer is recorded as `row.visible`.
function renderDefinitions(items, tab, rows) {
  for (const item of items) {
    if (isGroup(item)) {
      renderGroup(item, tab, rows);
    } else {
      renderGroup({ type: "group", heading: null, items: [item] }, tab, rows);
    }
  }
}

function renderGroup(group, tab, rows) {
  const section = group.heading ?? null;
  const names = new Set();
  for (const def of group.items || []) {
    if (def.type === "page") continue;
    // Obsidian keys the rows of a group by name and logs an error on a
    // duplicate; here it is a throw, so the test suite cannot miss it.
    if (def.name) {
      if (names.has(def.name)) throw new Error(`duplicate row name "${def.name}" in "${section}"`);
      names.add(def.name);
    }
    const setting = new FakeSetting(def, section, rows);
    const row = setting.row;
    row.visible = def.visible === undefined ? true : (typeof def.visible === "function" ? !!def.visible() : !!def.visible);
    if (def.control) {
      const ctl = def.control;
      const value = tab.getControlValue(ctl.key) ?? ctl.defaultValue;
      const change = (v) => Promise.resolve(tab.setControlValue(ctl.key, v));
      if (ctl.type === "toggle") setting.addToggle((t) => t.setValue(value).onChange(change));
      else if (ctl.type === "slider") setting.addSlider((s) => s.setLimits(ctl.min, ctl.max, ctl.step).setValue(value).onChange(change));
      else if (ctl.type === "dropdown") setting.addDropdown((d) => d.addOptions(ctl.options).setValue(value).onChange(change));
      else if (ctl.type === "color") setting.addColorPicker((c) => c.setValue(value).onChange(change));
      else if (ctl.type === "text") setting.addText((t) => t.setValue(value).onChange(change));
      else throw new Error(`control type ${ctl.type} is not stubbed`);
    } else if (def.render) {
      def.render(setting, { heading: section });
    } else if (def.action) {
      row.controls.push("action");
    }
  }
}

// The section (card heading) a row was built inside, or null for a row
// outside any card.
function sectionOf(row) {
  return row.section;
}

// A stub plugin with the settings merged over the defaults, and every method
// the panel's rows reach for on a press.
function makePlugin(settings) {
  const merged = Object.assign({}, Plugin.__test.DEFAULT_SETTINGS, settings);
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = merged;
  plugin.manifest = { version: "0.0.0-test" };
  plugin.isDarkTheme = () => true;
  plugin.reducedMotion = () => false;
  plugin.saveSettings = async () => {};
  plugin.enabled = [];
  plugin.enable = () => { plugin.enabled.push("enable"); };
  plugin.disable = () => { plugin.enabled.push("disable"); };
  plugin.enableTorchOverlay = () => { plugin.enabled.push("torch-on"); };
  plugin.disableTorchOverlay = () => { plugin.enabled.push("torch-off"); };
  plugin.registerWindowEvents = () => {};
  return plugin;
}

// A tab whose update() renders the given definition builder again, appending
// the new rows to the same array - so a test can read the rows a press
// rebuilt as `rows.slice(n)`.
function makeTab(plugin, rows, build) {
  const tab = Object.create(Plugin.__test.SettingTabPrototype);
  tab.plugin = plugin;
  tab.containerEl = makeEl("div");
  tab.updates = 0;
  tab.update = () => { tab.updates++; renderDefinitions(build(tab), tab, rows); };
  return tab;
}

// Render the look cards against a given settings object. Returns every row,
// or rethrows whatever the panel threw.
//
// The rows array is append-only across the life of the render: a control
// that rebuilds the panel (a gated toggle, a slider's reset button) calls
// update(), which pushes the rebuilt rows AFTER everything built so far, so
// a test can read them as `rows.slice(n)`. `rows.settings` is the object
// `set` writes into, so a rebuilt row shows the value just written, as it
// does in Obsidian.
//
// The returned array also carries `rows.writes`: every (key, value) the panel
// handed to `set` while the test was driving it. Nothing is written during a
// plain render - it fills in when a test presses a button on a row, which is
// how the sliders' reset buttons are checked. `rows.gates` is the set of keys
// whose change rebuilds the panel, as lookDefinitions reports it; `rows.tab`
// is the tab, whose `updates` counts the rebuilds.
function renderPanel(settings) {
  const rows = [];
  const writes = [];
  const plugin = makePlugin(settings);
  const merged = plugin.settings;
  let gates = new Set();
  const tab = makeTab(plugin, rows, (t) => {
    const cards = t.lookDefinitions({
      get: (k) => merged[k],
      set: (k) => (v) => { merged[k] = v; writes.push({ key: k, value: v }); },
      renderCursorStyleSetting: () => {},
      renderTorchToggleSetting: () => {},
    });
    gates = cards.gates;
    return cards;
  });
  tab.update();
  tab.updates = 0;
  rows.writes = writes;
  rows.settings = merged;
  rows.gates = gates;
  rows.tab = tab;
  return rows;
}

// Render the GLOBAL rows: the first card getSettingDefinitions builds itself -
// the reduced-motion notice, Enable plugin, Note editor only, Hide real
// cursor, Hide cursor when unfocused, Low power mode, Respect reduced motion
// and the mode switch. The two panels below the switch are stubbed on the
// instance rather than driven: everything under them is renderPanel's job.
// What this has to show is that the global card renders in order with
// nothing throwing part-way through it - the same take-out-every-row-after-me
// failure renderPanel exists for.
//
// Returns the rows, with the settings object the toggles write into attached
// as `rows.settings`, so a test can press a row and see where it landed.
function renderGlobalRows(settings, { reduced = false } = {}) {
  const rows = [];
  const plugin = makePlugin(settings);
  plugin.reducedMotion = () => reduced;
  const tab = makeTab(plugin, rows, (t) => t.getSettingDefinitions());
  tab.normalDefinitions = () => [];
  tab.vimDefinitions = () => [];
  tab.update();
  tab.updates = 0;
  rows.settings = plugin.settings;
  rows.plugin = plugin;
  rows.tab = tab;
  return rows;
}

// The whole panel, every card, as Obsidian would render it for these
// settings.
function renderWholePanel(settings, { reduced = false } = {}) {
  const rows = [];
  const plugin = makePlugin(settings);
  plugin.reducedMotion = () => reduced;
  const tab = makeTab(plugin, rows, (t) => t.getSettingDefinitions());
  tab.update();
  tab.updates = 0;
  rows.settings = plugin.settings;
  rows.plugin = plugin;
  rows.tab = tab;
  return rows;
}

// The two CALLERS of lookDefinitions, driven whole. renderPanel enters at
// lookDefinitions with the caller's hooks stubbed out, so the hooks
// themselves - the Cursor style dropdown and the Torch toggle, each built by
// the caller and each handed a `rerender` - had no coverage, and neither did
// where each caller's `set` writes. These build the real thing.
//
// renderNormal(settings) drives normalDefinitions: rows write into
// `rows.settings`, presets and all. renderVimMode(settings, target, onEdit)
// drives modeDefinitions: rows write into `rows.target`, the one Vim mode's
// snapshot, and `onEdit` fires on every write the way the Vim panel uses it
// to clear the active preset. Both return the same append-only rows array as
// renderPanel, so a press's rebuild is `rows.slice(n)`.
function withTab(settings, build) {
  const rows = [];
  const plugin = makePlugin(settings);
  const tab = makeTab(plugin, rows, build);
  tab.update();
  tab.updates = 0;
  rows.settings = plugin.settings;
  rows.plugin = plugin;
  rows.tab = tab;
  return rows;
}
function renderNormal(settings) {
  return withTab(settings, (tab) => tab.normalDefinitions());
}
function renderVimMode(settings, target, onEdit) {
  const rows = withTab(settings, (tab) => tab.modeDefinitions(target, onEdit));
  rows.target = target;
  return rows;
}

module.exports = { renderPanel, renderGlobalRows, renderWholePanel, renderNormal, renderVimMode, sectionOf, makeEl };
