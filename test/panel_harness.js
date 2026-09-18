// Renders the settings panel outside Obsidian, to catch the class of bug that
// engine-side tests structurally cannot see: a row that throws while being
// built takes every row after it out of the panel, and nothing else notices.
//
// The panel is declarative (getSettingDefinitions in main.js): the tab hands
// Obsidian a tree of groups and rows, and Obsidian builds a Setting for each
// row and calls the row's `render` with it. This harness does the same with
// a recording Setting stub and just enough of Obsidian's DOM helpers
// (createEl / createDiv / addClass) for the render callbacks to run to
// completion - and it plays Obsidian's part in update() and
// refreshDomState(): the one structural control (the gradient's colour
// count) calls tab.update() and the harness renders the tree again; a gate
// calls tab.refreshDomState() and the harness re-asks every row's `visible`
// predicate in place, as Obsidian does.
const Plugin = require("./harness");

// Obsidian's createFragment global: a fragment is an element here, with
// appendText as Obsidian adds it.
if (typeof globalThis.createFragment === "undefined") {
  globalThis.createFragment = (cb) => { const f = makeEl("fragment"); if (cb) cb(f); return f; };
}
// createDiv, for the Modal stub's title and content elements.
if (typeof globalThis.createDiv === "undefined") {
  globalThis.createDiv = (opts) => makeEl("div", opts);
}

function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, classes: [], parent: null, listeners: {}, attrs: {},
    createEl(t, opts = {}) {
      const child = makeEl(t);
      child.text = opts.text;
      child.parent = el;
      if (opts.cls) child.classes.push(...opts.cls.split(" ").filter(Boolean));
      if (opts.attr) child.attrs = Object.assign({}, opts.attr);
      el.children.push(child);
      return child;
    },
    createDiv(opts = {}) { return el.createEl("div", opts); },
    createSpan(opts = {}) { return el.createEl("span", opts); },
    addClass(...cs) { for (const c of cs) if (!el.classes.includes(c)) el.classes.push(c); },
    removeClass(...cs) { el.classes = el.classes.filter((c) => !cs.includes(c)); },
    toggleClass(c, force) { const has = el.classes.includes(c); const want = force === undefined ? !has : !!force; if (want && !has) el.classes.push(c); if (!want && has) el.classes = el.classes.filter((x) => x !== c); },
    hasClass(c) { return el.classes.includes(c); },
    setCssStyles(styles) { Object.assign(el.style, styles); },
    setCssProps(props) { Object.assign(el.style, props); },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    setText(t) { el.text = t; },
    getText() { return el.text ?? ""; },
    focus() { el.focused = true; },
    get value() { return el._value ?? ""; },
    set value(v) { el._value = v; },
    appendText(t) { el.text = (el.text || "") + t; },
    addEventListener(type, fn) { el.listeners[type] = fn; },
    click() { if (el.listeners.click) el.listeners.click({ target: el, stopPropagation() {} }); },
    prepend(child) { if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child); child.parent = el; el.children.unshift(child); return child; },
    appendChild(child) { if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child); child.parent = el; el.children.push(child); return child; },
    get lastElementChild() { return el.children[el.children.length - 1] || null; },
    get parentElement() { return el.parent; },
    get classList() { return { contains: (c) => el.classes.includes(c), add: (...cs) => el.addClass(...cs), remove: (...cs) => el.removeClass(...cs) }; },
    // Enough of querySelector for the panel: one class name, or a tag.
    querySelector(sel) {
      const cls = sel.startsWith(".") ? sel.slice(1) : null;
      const walk = (node) => {
        for (const c of node.children) {
          if (cls ? c.classes.includes(cls) : c.tag === sel) return c;
          const found = walk(c); if (found) return found;
        }
        return null;
      };
      return walk(el);
    },
    querySelectorAll(sel) {
      const cls = sel.startsWith(".") ? sel.slice(1) : null;
      const out = [];
      const walk = (node) => { for (const c of node.children) { if (cls ? c.classes.includes(cls) : c.tag === sel) out.push(c); walk(c); } };
      walk(el);
      return out;
    },
    closest(sel) { const cls = sel.slice(1); let n = el; while (n) { if (n.classes.includes(cls)) return n; n = n.parent; } return null; },
    empty() { el.children.length = 0; el.text = undefined; },
    remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); el.parent = null; },
    contains(node) { let n = node; while (n) { if (n === el) return true; n = n.parent; } return false; },
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
    setDisabled: (d) => { c._disabled = !!d; return c; },
    // As in Obsidian: the component holds the new value by the time its
    // onChange runs, so a second press sees the first.
    onChange: (fn) => { c._change = (v) => { c._value = v; return fn(v); }; return c; },
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
    const info = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = info.createDiv({ cls: "setting-item-name" });
    this.descEl = info.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
    // Obsidian's Setting keeps every component it built; setDisabled loops
    // read it.
    this.components = [];
    this.row = {
      name: def.name ?? "", desc: typeof def.desc === "string" ? def.desc : (def.desc ? def.desc.text ?? "[fragment]" : ""),
      icon: def.desc && def.desc.children ? (def.desc.children.find((c) => c.icon) || {}).icon || null : null,
      def, section, controls: [], sliders: [], toggles: [], dropdowns: [], extras: [], buttons: [], colors: [],
      settingEl: this.settingEl, controlEl: this.controlEl, descEl: this.descEl, components: this.components,
    };
    rows.push(this.row);
  }
  setName(n) { this.row.name = n; return this; }
  setDesc(d) { this.row.desc = typeof d === "string" ? d : "[fragment]"; return this; }
  setHeading() { return this; }
  setClass() { return this; }
  _add(kind, list, cb) {
    const c = control();
    this.row.controls.push(kind);
    if (list) list.push(c);
    this.components.push(c);
    // Obsidian appends the component's element to controlEl; a colour
    // picker's input is what swatchRow moves into its labelled cell.
    c.el = this.controlEl.createEl(kind === "color" ? "input" : "div", { cls: "setting-" + kind });
    cb(c);
    return this;
  }
  addToggle(cb) { return this._add("toggle", this.row.toggles, cb); }
  addSlider(cb) { return this._add("slider", this.row.sliders, cb); }
  addColorPicker(cb) { return this._add("color", this.row.colors, cb); }
  addDropdown(cb) { return this._add("dropdown", this.row.dropdowns, cb); }
  addText(cb) { return this._add("text", null, cb); }
  addTextArea(cb) { return this._add("textarea", null, cb); }
  addButton(cb) { return this._add("button", this.row.buttons, cb); }
  addExtraButton(cb) { return this._add("extra", this.row.extras, cb); }
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
    if (item && item.type === "page") {
      renderPage(item, tab, rows);
    } else if (isGroup(item)) {
      renderGroup(item, tab, rows);
    } else {
      renderGroup({ type: "group", heading: null, items: [item] }, tab, rows);
    }
  }
}

// Obsidian's sub-page: an entry in the list (recorded on rows.pages with
// its displayValue and status as evaluated now), and its items rendered
// as if the page were open, so the tests see every row.
function renderPage(page, tab, rows) {
  const evalFn = (v) => (typeof v === "function" ? v() : v);
  const entry = {
    name: page.name, desc: typeof page.desc === "string" ? page.desc : (page.desc ? page.desc.text ?? "[fragment]" : ""),
    icon: page.desc && page.desc.children ? (page.desc.children.find((c) => c.icon) || {}).icon || null : null,
    displayValue: evalFn(page.displayValue) ?? null, status: evalFn(page.status) ?? null,
    visible: page.visible === undefined ? true : !!evalFn(page.visible), def: page,
    refresh() { this.displayValue = evalFn(page.displayValue) ?? null; this.status = evalFn(page.status) ?? null; },
  };
  rows.pages = rows.pages || [];
  rows.pages.push(entry);
  rows.pageStack = rows.pageStack || [];
  rows.pageStack.push(page.name);
  renderDefinitions(page.items || [], tab, rows);
  rows.pageStack.pop();
}

function renderGroup(group, tab, rows) {
  const section = group.heading ?? null;
  const names = new Set();
  // The card's heading, with the extra buttons Obsidian would build on it:
  // the collapse chevron (and its summary) and the reset. The heading is
  // an element the buttons can find with closest(), which is how they
  // reach the card.
  if (section !== null) {
    const groupEl = makeEl("div"); groupEl.classes.push("setting-group");
    const heading = groupEl.createDiv({ cls: "setting-item setting-item-heading" });
    heading.createDiv({ cls: "setting-item-info" }).createDiv({ cls: "setting-item-name", text: section });
    const ctl = heading.createDiv({ cls: "setting-item-control" });
    const buttons = [];
    for (const build of group.extraButtons || []) {
      const btn = control();
      btn.extraSettingsEl = ctl.createDiv({ cls: "clickable-icon extra-setting-button" });
      build(btn);
      buttons.push(btn);
    }
    rows.groups = rows.groups || {};
    rows.groups[section] = { el: groupEl, heading, buttons, summaryEl: heading.querySelector(".cursor-smith-section-summary") };
  }
  for (const def of group.items || []) {
    if (def.type === "page") { renderPage(def, tab, rows); continue; }
    // Obsidian keys the rows of a group by name and logs an error on a
    // duplicate; here it is a throw, so the test suite cannot miss it.
    if (def.name) {
      if (names.has(def.name)) throw new Error(`duplicate row name "${def.name}" in "${section}"`);
      names.add(def.name);
    }
    const setting = new FakeSetting(def, section, rows);
    const row = setting.row;
    row.page = rows.pageStack && rows.pageStack.length ? rows.pageStack[rows.pageStack.length - 1] : null;
    row.visible = askVisible(def);
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

// A row's `visible` predicate, asked now. A row without one is visible.
function askVisible(def) {
  return def.visible === undefined ? true : (typeof def.visible === "function" ? !!def.visible() : !!def.visible);
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
  // The Vim warning row asks Obsidian whether its Vim key bindings are on,
  // through app.vault.getConfig; answer "off".
  plugin.app = { vault: { getConfig: () => false } };
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
// rebuilt as `rows.slice(n)` - and whose refreshDomState() re-asks every
// row's `visible` predicate in place, counting in `refreshes`.
function makeTab(plugin, rows, build) {
  const tab = Object.create(Plugin.__test.SettingTabPrototype);
  tab.plugin = plugin;
  tab.containerEl = makeEl("div");
  tab.updates = 0;
  tab.refreshes = 0;
  // The Effects rail shows one effect at a time; the tests want to see every
  // row, so the pick starts as "all" (a test of the rail picks for itself).
  tab._effectsPick = "all";
  tab.update = () => { tab.updates++; renderDefinitions(build(tab), tab, rows); };
  tab.refreshDomState = () => { tab.refreshes++; for (const row of rows) row.visible = askVisible(row.def); tab.runRefreshers(); };
  return tab;
}

// Render the look cards against a given settings object. Returns every row,
// or rethrows whatever the panel threw.
//
// Every row is in the array whether or not it is visible; `row.visible` is
// its predicate's answer, refreshed in place when a gate's write calls
// refreshDomState(). The array is append-only: the one control that
// rebuilds the panel (the gradient's colour count) calls update(), which
// pushes the rebuilt rows AFTER everything built so far, so a test can read
// them as `rows.slice(n)`. `rows.settings` is the object `set` writes into.
//
// The returned array also carries `rows.writes`: every (key, value) the panel
// handed to `set` while the test was driving it. Nothing is written during a
// plain render - it fills in when a test presses a button on a row, which is
// how the sliders' reset buttons are checked. `rows.gates` is the set of keys
// whose write refreshes or rebuilds the panel, as lookDefinitions reports
// it; `rows.tab` is the tab, whose `refreshes` and `updates` count them.
function renderPanel(settings) {
  const rows = [];
  const writes = [];
  const plugin = makePlugin(settings);
  const merged = plugin.settings;
  let gates = new Set();
  let cardKeys = {};
  const tab = makeTab(plugin, rows, (t) => {
    const cards = t.lookDefinitions({
      get: (k) => merged[k],
      set: (k) => (v) => { merged[k] = v; writes.push({ key: k, value: v }); },
      renderCursorStyleSetting: () => {},
      renderTorchToggleSetting: () => {},
    });
    gates = cards.gates;
    cardKeys = cards.cardKeys;
    return cards;
  });
  tab.update();
  tab.updates = 0;
  tab.refreshes = 0;
  rows.writes = writes;
  rows.settings = merged;
  rows.gates = gates;
  rows.cardKeys = cardKeys;
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
  tab.refreshes = 0;
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
  tab.refreshes = 0;
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
// to clear the active preset. Both return the same rows array as
// renderPanel: `row.visible` refreshed in place by a gate, a rebuild
// appended as `rows.slice(n)`.
function withTab(settings, build) {
  const rows = [];
  const plugin = makePlugin(settings);
  const tab = makeTab(plugin, rows, build);
  tab.update();
  tab.updates = 0;
  tab.refreshes = 0;
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
