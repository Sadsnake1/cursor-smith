// Renders the settings panel outside Obsidian, to catch the class of bug that
// engine-side tests structurally cannot see: a row that throws while being
// built takes every row after it out of the panel, and nothing else notices.
//
// Stubs just enough of Obsidian's Setting builder and Obsidian's DOM helpers
// (createEl / createDiv / addClass) for renderLookSettings to run to completion.
const Plugin = require("./harness");

function makeEl(tag) {
  const el = {
    tag, children: [], open: true, style: {}, classes: [], parent: null,
    createEl(t, opts = {}) {
      const child = makeEl(t);
      child.text = opts.text;
      child.parent = el;
      if (opts.cls) child.classes.push(opts.cls);
      el.children.push(child);
      return child;
    },
    createDiv(opts = {}) { return el.createEl("div", opts); },
    createSpan(opts = {}) { return el.createEl("span", opts); },
    addClass(...cs) { el.classes.push(...cs); },
    setCssStyles(styles) { Object.assign(el.style, styles); },
    empty() { el.children.length = 0; },
  };
  return el;
}

// Records every row the panel builds, in order.
function makeSettingClass(rows) {
  // A handler a test presses runs AFTER renderPanel has put the real Setting
  // stub back - and a gated control re-renders its section from inside that
  // handler, building new rows. Those rows have to come from this class too,
  // or the re-render throws on the first builder method the real stub lacks
  // (addExtraButton) and the press looks like it did nothing. So every
  // recorded handler swaps this class in for its own synchronous extent,
  // which is exactly where the re-render happens.
  let Fake = null;
  const swapped = (fn) => (...args) => {
    Plugin.__test.setSettingClass(Fake);
    try { return fn(...args); } finally { Plugin.__test.restoreSettingClass(); }
  };
  // Records what it was configured with as well as accepting it. `_click` and
  // `_tooltip` are what let a test actually press a row's reset button and see
  // where it writes, rather than only that the button exists.
  const control = () => {
    const c = {
      setValue: (v) => { c._value = v; return c; },
      setLimits: (min, max, step) => { c._limits = { min, max, step }; return c; },
      setDynamicTooltip: () => c,
      setPlaceholder: () => c, addOption: () => c, addOptions: () => c,
      setButtonText: (t) => { c._text = t; return c; },
      setCta: () => c, setWarning: () => c,
      setTooltip: (t) => { c._tooltip = t; return c; },
      setIcon: (i) => { c._icon = i; return c; },
      setDisabled: () => c,
      onChange: (fn) => { c._change = swapped(fn); return c; },
      onClick: (fn) => { c._click = swapped(fn); return c; },
      inputEl: makeEl("input"),
    };
    return c;
  };
  Fake = class FakeSetting {
    constructor(el) {
      this.settingEl = makeEl("div");
      // `controls` stays a list of plain kind strings - several tests assert on
      // it. Components that a test needs to reach into are also collected, by
      // kind, alongside it.
      this.row = { name: null, desc: null, controls: [], sliders: [], toggles: [], dropdowns: [], extras: [], parent: el };
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
    addButton(cb) { this.row.controls.push("button"); cb(control()); return this; }
    addExtraButton(cb) { const c = control(); this.row.controls.push("extra"); this.row.extras.push(c); cb(c); return this; }
  };
  return Fake;
}

// The collapsible section a row was built inside, by title - or null for a
// row outside any section. Walks the stub tree's parent pointers up to the
// <details>, whose summary's first span carries the title.
function sectionOf(row) {
  for (let el = row.parent; el; el = el.parent) {
    if (el.tag === "details") {
      const summary = el.children.find((c) => c.tag === "summary");
      const span = summary && summary.children.find((c) => c.tag === "span");
      return span ? span.text : null;
    }
  }
  return null;
}

// Render the Look settings against a given settings object. Returns every row,
// or rethrows whatever the panel threw.
//
// The rows array is append-only across the life of the render: a section that
// re-renders itself (a gated toggle, a slider's reset button) pushes its new
// rows AFTER everything built so far, so a test can read the rows added by a
// press as `rows.slice(n)`. `rows.settings` is the object `set` writes into,
// so a re-rendered row shows the value just written, as it does in Obsidian.
//
// The returned array also carries `rows.writes`: every (key, value) the panel
// handed to `set` while the test was driving it. Nothing is written during a
// plain render - it fills in when a test presses a button on a row, which is
// how the sliders' reset buttons are checked. `rows.gates` and
// `rows.rerenderOn` are the registry renderLookSettings returns: which
// section each gated key lives in, and which sections declared a key from
// elsewhere.
function renderPanel(settings) {
  const rows = [];
  const writes = [];
  const FakeSetting = makeSettingClass(rows);
  const tabProto = Plugin.__test.SettingTabPrototype;

  const merged = Object.assign({}, Plugin.__test.DEFAULT_SETTINGS, settings);
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = merged;
  plugin.isDarkTheme = () => true;
  plugin.saveSettings = async () => {};

  const tab = Object.create(tabProto);
  tab.plugin = plugin;

  // The panel closes over the module-level `Setting`; swap it for the duration.
  Plugin.__test.setSettingClass(FakeSetting);
  let registry = null;
  try {
    registry = tab.renderLookSettings(makeEl("div"), {
      get: (k) => merged[k],
      set: (k) => (v) => { merged[k] = v; writes.push({ key: k, value: v }); },
      renderCursorStyleSetting: () => {},
      renderTorchToggleSetting: () => {},
    });
  } finally {
    Plugin.__test.restoreSettingClass();
  }
  rows.writes = writes;
  rows.settings = merged;
  rows.gates = registry ? registry.gates : new Map();
  rows.rerenderOn = registry ? registry.rerenderOn : new Map();
  return rows;
}

// Render the GLOBAL rows: the structural ones display() builds itself, above
// the CUA/Vim switch - Enable Plugin, Note Editor Only, Hide Real Cursor, Hide
// Cursor When Unfocused, Respect Reduced Motion. renderPanel above enters at
// renderLookSettings, which never sees any of them, so until this existed the
// only rows in the panel that apply in BOTH modes were the only rows with no
// coverage at all.
//
// The two section renderers below the switch are stubbed on the instance
// rather than driven: everything under them is renderPanel's job and building
// it here would only duplicate that. What this has to show is that the global
// block renders in order with nothing throwing part-way through it - the same
// take-out-every-row-after-me failure renderPanel exists for.
//
// Returns the rows, with the settings object the toggles write into attached
// as `rows.settings`, so a test can press a row and see where it landed.
function renderGlobalRows(settings) {
  const rows = [];
  const FakeSetting = makeSettingClass(rows);

  const merged = Object.assign({}, Plugin.__test.DEFAULT_SETTINGS, settings);
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = merged;
  plugin.manifest = { version: "0.0.0-test" };
  plugin.isDarkTheme = () => true;
  plugin.reducedMotion = () => false;
  plugin.enable = () => {};
  plugin.disable = () => {};
  plugin.saveSettings = async () => {};

  const tab = Object.create(Plugin.__test.SettingTabPrototype);
  tab.plugin = plugin;
  // No ownerDocument, so display()'s settings-window registration short-
  // circuits before it can reach for the `document` global that Node has not
  // got. That branch is guarded anyway; skipping it keeps the log clean.
  tab.containerEl = makeEl("div");
  tab.renderModeSwitch = () => {};
  tab.renderNormalSection = () => {};
  tab.renderVimSection = () => {};

  Plugin.__test.setSettingClass(FakeSetting);
  try {
    tab.display();
  } finally {
    Plugin.__test.restoreSettingClass();
  }
  rows.settings = merged;
  return rows;
}

// The two CALLERS of renderLookSettings, driven whole. renderPanel enters at
// renderLookSettings with the caller's hooks stubbed out, so the hooks
// themselves - the Cursor Style dropdown and the Torch toggle, each built by
// the caller and each handed a `rerender` - had no coverage, and neither did
// where each caller's `set` writes. These build the real thing.
//
// renderNormal(settings) drives renderNormalSection: rows write into
// `rows.settings`, presets and all. renderVimMode(settings, target, onEdit)
// drives renderModeControls: rows write into `rows.target`, the one Vim mode's
// snapshot, and `onEdit` fires on every write the way the Vim panel uses it to
// clear the active preset. Both return the same append-only rows array as
// renderPanel, so a press's re-render is `rows.slice(n)`.
function withTab(settings, build) {
  const rows = [];
  const FakeSetting = makeSettingClass(rows);
  const merged = Object.assign({}, Plugin.__test.DEFAULT_SETTINGS, settings);
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = merged;
  plugin.isDarkTheme = () => true;
  plugin.saveSettings = async () => {};
  plugin.enabled = [];
  plugin.enable = () => { plugin.enabled.push("enable"); };
  plugin.enableTorchOverlay = () => { plugin.enabled.push("torch-on"); };
  plugin.disableTorchOverlay = () => { plugin.enabled.push("torch-off"); };
  const tab = Object.create(Plugin.__test.SettingTabPrototype);
  tab.plugin = plugin;
  tab.containerEl = makeEl("div");
  Plugin.__test.setSettingClass(FakeSetting);
  try { build(tab, tab.containerEl); } finally { Plugin.__test.restoreSettingClass(); }
  rows.settings = merged;
  rows.plugin = plugin;
  return rows;
}
function renderNormal(settings) {
  return withTab(settings, (tab, el) => tab.renderNormalSection(el));
}
function renderVimMode(settings, target, onEdit) {
  const rows = withTab(settings, (tab, el) => tab.renderModeControls(el, target, onEdit));
  rows.target = target;
  return rows;
}

module.exports = { renderPanel, renderGlobalRows, renderNormal, renderVimMode, sectionOf };
