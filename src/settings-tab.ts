// Word-Smith — settings-tab: the settings, declared.
//
// THE PANEL is Obsidian 1.13's declarative one: `getSettingDefinitions()`
// hands Obsidian a tree, Obsidian draws it, indexes it for search, and
// re-renders it IN PLACE on `update()` (rows reconciled by name — the
// scroll and every untouched row survive). No `display()`.
//
//   THE HEADER is a heading-less group: Enable plugin, alone. Everything
//   else is a PAGE — Obsidian's own sub-page, one slide in and one back,
//   on a phone as on a desktop — with a Lucide icon in front of its name
//   (iconDesc: written into the description, laid out by the sheet), one
//   plain line of description, and a `displayValue` saying what the page
//   is set to. Then a muted FOOTER with the version read off the
//   manifest. No plugin-name heading, no page called General.
//
//   A LONG PAGE has a RAIL of pills at its top (Focus, Prose, Powerline):
//   one pill per section with its icon, a tick at the left while that
//   section's switch is on, the picked one filled with the accent; the
//   picked section's rows under it, one section at a time. The pick is
//   panel state for the session, never a setting. A row of pills is a
//   keyboard group (rovingRow): the picked pill is the one Tab stop,
//   Left/Right/Home/End walk it, `aria-pressed` on each.
//
//   A GATE is a `visible` predicate and `refreshDomState()` — never
//   `update()` for a gate (it re-renders in 60-85 ms and steals focus);
//   `update()` only when the TREE changes (a flag added, a path added).
//   This tab's `refreshDomState` also runs what the rows registered
//   (`onRefresh`): the rail's ticks, the alerts' state.
//
//   A RENDER puts what it builds in `controlEl`, which Obsidian empties on
//   a re-render; anything it must add to `settingEl` outside it (an
//   alert's icon) removes last time's copy first — Obsidian keeps a row's
//   element across `update()` and runs the render again.
//
//   DELETE IS TWO TAPS, no dialog: the first turns the trash into a red
//   "Delete?" for three seconds, the second deletes. A card is a `div`
//   holding one "use" button and its action buttons as siblings — no button
//   inside a button (invalid HTML; a screen reader skips a button's
//   children). Icon buttons carry Obsidian's `clickable-icon`.
//
//   A WARNING CARD (icon, one line, no button) sits under every switch that
//   changes the editor's behavior — Hemingway, Typography, Zen, the Vim
//   motions — so a curious user is never stuck.
//
//   EVERY SECTION ENDS WITH ITS RESET: a small link that puts the keys its
//   rows write (a control's `key`, a render row's declared keys — read off
//   the definitions, the one writer of "what this section sets") back to
//   their defaults through `settingsResetKeys`, the door a load and a paste
//   use.
//
//   DESCRIPTIONS are one plain line each, American spelling, no em dashes,
//   sentence case; the plugin's names are brands (the lint's list).
//
//   THE PRESETS are the strip of cards under the Powerline switch —
//   presetsRow, below.
import { PluginSettingTab, Setting, TFolder, Notice, Platform, Modal, setIcon } from 'obsidian';
import type { App, SettingDefinition, SettingDefinitionItem, SettingDefinitionGroup, SettingDefinitionPage, SettingDefinitionRender, SettingGroupItem } from 'obsidian';
import {
	BAR_KEYS_LIVE,
	BAR_SHARE_VERSION,
	DEFAULT_SETTINGS,
	MENU_MAX_COLS,
	MENU_RULE_STYLES,
	PL_BG_COUNT,
	PL_THEME_BGS,
	WS_FLAG_SHAPES,
	WS_MASK_MIN_PX,
	WS_STATE_IDS,
	WsPathSuggestModal,
	barMenuFuzzy,
	barPresetToCode,
	barPresetWithDefaults,
	wsCatch,
	wsFlagSvg,
	wsSvgInto,
} from './preamble';
import type WordSmith from './plugin';
import type { WordSmithSettings } from './settings';

type Key = keyof WordSmithSettings;
type Def = SettingDefinition<Key>;
type Item = SettingDefinitionItem<Key>;
type Group = SettingDefinitionGroup<Key>;
type Page = SettingDefinitionPage<Key>;
type Row = SettingGroupItem<Key>;
type Render = SettingDefinitionRender;
type Pred = () => boolean;

// A rail's sections: the pill's key, name and icon, and (for a section
// with a switch) the predicate that draws the tick.
interface RailEntry { key: string; name: string; icon: string; on?: Pred; draw?: (el: HTMLElement) => void }
// what `railed()` hands a section: the class its rail toggles, and its own gate
interface RailSlot { cls: string; visible?: Pred }
// a hotkeys card's entry: a command id, or one with the switch it answers to
type WsKeyEntry = string | { id: string; on: Pred };

// How long a tapped trash stays "Delete?" before it turns back.
const DELETE_ARM_MS = 3000;

// The keys a render row governs, so a section's reset can name them: a
// render row has no `control.key`, and `rendered(def, keys)` is the one
// place it says what it writes.
const RENDER_KEYS = new WeakMap<object, Key[]>();
const rendered = (def: Render, keys: Key[]): Render => { RENDER_KEYS.set(def, keys); return def; };

// the settings as a bag, for the rows that address a key by name
const bag = (s: WordSmithSettings) => s as unknown as Record<string, unknown>;
const DEFAULTS = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
const str = (v: unknown) => typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : '';
const between = (lo: number, hi: number) => (v: number) => (isFinite(v) && v >= lo && v <= hi) ? undefined : 'Between ' + lo + ' and ' + hi + '.';
const all = (...ps: Pred[]): Pred => () => ps.every((p) => p());
// a class set only when it changes: Chromium queues a mutation record on a
// `classList.add` of a token already there, and the tab's watch listens for
// class changes — a paint that rewrote what was there fed the watch forever
const setClass = (el: Element, cls: string, on: boolean) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };
const setAttr = (el: Element, name: string, value: string) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };

// A small prompt: a title, one field, OK. What Save and Import on the
// preset strip open. `submit` answers true to close, false to keep the
// prompt (nothing to do), or a line to show under the field and keep it.
class WsPrompt extends Modal {
	field: HTMLInputElement;
	constructor(app: App, title: string, placeholder: string, submit: (value: string) => Promise<boolean | string>) {
		super(app);
		this.setTitle(title);
		this.field = this.contentEl.createEl('input', { type: 'text', cls: 'ws-prompt-field', attr: { placeholder, spellcheck: 'false' } });
		const note = this.contentEl.createDiv({ cls: 'ws-prompt-note' });
		const go = async () => {
			const result = await submit(this.field.value.trim());
			if (result === false) return;
			if (typeof result === 'string') { note.setText(result); this.field.focus(); return; }
			this.close();
		};
		this.field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void go(); } });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { cls: 'mod-cta', text: 'OK', attr: { type: 'button' } }).addEventListener('click', () => { void go(); });
		buttons.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).addEventListener('click', () => { this.close(); });
	}
	onOpen() { this.field.focus(); }
}

export class WordSmithSettingTab extends PluginSettingTab {
	plugin: WordSmith;
	// What a refresh repaints beyond Obsidian's own `visible` pass: the
	// rails' ticks and picks, the alerts. Rows register these while they
	// render; the list is emptied whenever the tree is built again.
	_refreshers: (() => void)[];
	// Each rail's pick, by page: a section's key, or unset (the first section
	// whose switch is on). Panel state for the session, never a setting.
	_picks: Record<string, string | null>;
	// the letter box's last arrow count, for the way back from "no arrows"
	_lastArrowCount: number | null;
	// the watch that moves a page entry's icon in front of its name and
	// opens a rail's section on a search hit; the document it watches
	_entryWatch: MutationObserver | null;
	_entryDoc: Document | null;
	// the rails' paints, run by the watch when a section is drawn
	_rails: (() => void)[];

	constructor(app: App, plugin: WordSmith) {
		super(app, plugin);
		this.plugin = plugin;
		this._refreshers = [];
		this._picks = {};
		this._lastArrowCount = null;
		this._entryWatch = null;
		this._entryDoc = null;
		this._rails = [];
		// a dark/light switch refreshes the page (the theme inks read the half the
		// workspace wears) — through the plugin's one door for app events, which
		// guards the handler and registers it for unload; a test's workspace may
		// carry no bus, and the door skips one that does not
		try {
			if (this.app.workspace && typeof this.app.workspace.on === 'function') plugin.onAppEvent(this.app.workspace, 'css-change', () => { this.refreshDomState(); });
		} catch (_) { wsCatch('WordSmithSettingTab: css-change', _); }
	}

	// ── THE DOORS OBSIDIAN CALLS ────────────────────────────────────────────

	getControlValue(key: string): unknown {
		return bag(this.plugin.settings)[key];
	}

	// A control's write: the key, its AFTER effect, the save, then the
	// predicates — so a switch hides and shows its rows in place.
	async setControlValue(key: string, value: unknown): Promise<void> {
		bag(this.plugin.settings)[key] = value;
		const after = AFTER[key];
		if (after) await after(this, value);
		await this.plugin.saveSettings(SAVE_NOW.has(key));
		this.refreshDomState();
	}

	// Obsidian's refresh re-asks every row's `visible`; ours also repaints
	// what the rows registered. A gate's write calls this.
	refreshDomState() {
		super.refreshDomState();
		for (const f of this._refreshers) {
			try { f(); } catch (_) { wsCatch('settings tab refresher', _); }
		}
	}

	onRefresh(f: () => void) { this._refreshers.push(f); }

	// ── THE TREE ────────────────────────────────────────────────────────────

	getSettingDefinitions(): Item[] {
		this._refreshers = [];
		this._rails = [];
		this.watchEntries();
		const s = this.plugin.settings;
		// the pages describe surfaces a blocked start did not build
		const on: Pred = () => !!s.pluginEnabled && !this.plugin._startBlocked;
		return [
			this.headerGroup(),
			this.pagePowermenu(on),
			this.pagePowerline(on),
			this.pageFocus(on),
			this.pageProse(on),
			this.pageText(on),
			this.pageManuscript(on),
			this.pageNavigation(on),
			// under Navigation
			this.pageThemes(on),
			this.pageVault(on),
			this.footerRow(),
		];
	}

	// The header: the switch, and the blocked-start card while a start is
	// blocked. No heading (the version is the footer).
	headerGroup(): Group {
		return {
			type: 'group',
			cls: 'ws-set-header',
			items: [
				{ name: 'Enable plugin', control: { type: 'toggle', key: 'pluginEnabled' }, visible: () => !this.plugin._startBlocked },
				this.blockedStartRow(),
			],
		};
	}

	// A BLOCKED START: the reason, and the door where there is one — the
	// pages describe surfaces that were not built.
	blockedStartRow(): Render {
		return {
			name: '',
			desc: '',
			searchable: false,
			visible: () => !!this.plugin._startBlocked,
			render: (st) => {
				const b = this.plugin._startBlocked;
				this.alertInto(st, 'triangle-alert');
				st.setDesc(b ? b.text : '');
				st.settingEl.toggleClass('is-safe', !!b && b.kind === 'safe');
				if (b && b.kind === 'safe') st.addButton((btn) => btn.setButtonText('Try again').setCta().onClick(() => { void this.plugin.startAgain(); }));
			},
		};
	}

	// THE ENTRIES' ICONS, IN FRONT OF THEIR NAMES. Obsidian draws a page's
	// entry itself (the name, then the description holding the icon); once
	// drawn, the icon moves to the front of the info block and the row is
	// classed, so the sheet can lay the two out as a grid without `:has()`.
	// The tab's container is observed once, for as long as the tab lives —
	// Obsidian adopts it into the settings window after the definitions are
	// asked for, which is why the watch is on the container and not a
	// document. Runs again on every re-render; a moved icon is left alone.
	watchEntries() {
		if (!this.containerEl) return;
		const doc = this.containerEl.ownerDocument;
		if (this._entryWatch && this._entryDoc === doc) return;
		if (this._entryWatch) { try { this._entryWatch.disconnect(); } catch (_) { wsCatch('watchEntries: disconnect', _); } }
		// a guard on a watch: a throw inside an observer's callback is reported
		// to the window, which a page of Obsidian's does not want either
		const own = (r: MutationRecord) => {
			if (r.type !== 'attributes' || r.target.nodeType !== 1) return false;
			const cl = (r.target as Element).classList;
			return cl.contains('ws-pill') || cl.contains('ws-set-section') || cl.contains('ws-set-entry');
		};
		const run = (records?: MutationRecord[]) => {
			try {
				// the tab's own class writes (the rail's pills, the sections it
				// hides, the entries it dresses) are not a reason to run again
				if (records && records.length && records.every(own)) return;
				this.dressEntries();
			} catch (_) { wsCatch('watchEntries: dressEntries', _); }
		};
		try {
			// the document's body, not the container: a sub-page renders beside
			// the tab's container, and the container is adopted into the settings
			// window after the first definitions are asked for (re-seated then)
			// the settings window's own MutationObserver: the window can be a
			// document of its own (Obsidian's "open settings in a new window")
			const win = doc.defaultView || window;
			this._entryWatch = new win.MutationObserver((records) => run(records));
			this._entryWatch.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
			this._entryDoc = doc;
		} catch (_) { wsCatch('watchEntries: new MutationObserver', _); }
		run();
	}

	// THE OBSERVER OUTLIVES hide() AND DIES IN onunload: Obsidian 1.13 does
	// not ask for the definitions again on reopen, it re-renders the ones it
	// has — an observer disconnected on hide() would never come back, and the
	// icons would sit in the descriptions from the second opening on. The
	// plugin's onunload calls this; nothing else does.
	teardown() {
		if (this._entryWatch) { try { this._entryWatch.disconnect(); } catch (_) { wsCatch('teardown: disconnect', _); } }
		this._entryWatch = null;
		this._entryDoc = null;
	}

	dressEntries() {
		if (!this.containerEl) return;
		const doc = this.containerEl.ownerDocument;
		doc.querySelectorAll('.setting-item-description > .ws-page-icon').forEach((icon) => {
			const info = icon.closest('.setting-item-info');
			const row = icon.closest('.setting-item');
			if (!info || !row) return;
			info.prepend(icon);
			setClass(row, 'ws-set-entry', true);
		});
		// a section drawn after its rail's paint (the same render pass) is
		// dressed now — FIRST, so a search hit is judged against the rail's
		// state: Obsidian opens the page and marks the row it found
		// `is-flashing` in the same breath as the sections are drawn, and a
		// hit inside a section the rail hides moves the pick to that section
		this.refreshRails();
		const hit = doc.querySelector('.setting-item.is-flashing');
		const offGroup = hit ? hit.closest('.ws-set-section.is-railed-off') : null;
		if (offGroup) {
			const m = /\bws-rs-([a-z]+)-([a-z]+)\b/.exec(offGroup.className);
			if (m) { this._picks[m[1]] = m[2]; this.refreshRails(); }
			if (hit && typeof hit.scrollIntoView === 'function') hit.scrollIntoView({ block: 'center' });
		}
	}

	// the rails' paints only (the class toggles), without Obsidian's pass
	refreshRails() {
		for (const f of this._rails) { try { f(); } catch (_) { wsCatch('settings tab rail', _); } }
	}

	// The version, a muted line under the pages. Not a heading: Obsidian's
	// guidelines ask plugins not to head their settings with their own name,
	// and Community plugins lists the version anyway.
	footerRow(): Render {
		const version = this.plugin.manifest && this.plugin.manifest.version ? this.plugin.manifest.version : '';
		return {
			name: '',
			desc: ('Word-Smith ' + version).trim(),
			searchable: false,
			// the footer renders with the top level, in the settings window's
			// document: the watch is re-seated there (measured: Obsidian asks for
			// the definitions once, at load, before the container is adopted)
			render: (st) => { st.settingEl.addClass('ws-set-footer'); this.watchEntries(); },
		};
	}

	// ── THE BUILDERS ────────────────────────────────────────────────────────

	// A page: Obsidian's sub-page entry, with the icon in front of its name
	// and its value on the entry.
	page(name: string, icon: string, desc: string, items: Item[], displayValue: () => string, visible: Pred): Page {
		return { type: 'page', name, desc: this.iconDesc(icon, desc), items, displayValue, visible };
	}

	// A description with a Lucide icon in front of it. Obsidian renders the
	// entry — the name, then the description — and the description is the
	// one slot that takes markup, so the icon is written here and moved in
	// front of the NAME once the entry is drawn (dressEntries): this sheet
	// bans `:has()` and `display: contents` (the review's CSS lint), so the
	// move is DOM, watched by an observer on the tab's own container.
	iconDesc(icon: string, text: string): DocumentFragment {
		return createFragment((f) => {
			setIcon(f.createSpan({ cls: 'ws-page-icon' }), icon);
			f.appendText(text);
		});
	}

	// A section of a page: a group whose heading is not shown (the page's
	// title, or the rail's pill, is it). Its keys are read off its rows for
	// the reset link at its end.
	section(title: string, items: Row[], visible?: Pred | RailSlot, reset = true): Group {
		const keys = WordSmithSettingTab.keysOf(items);
		if (reset && keys.length) items.push(this.resetLinkRow(title, keys));
		const slot = typeof visible === 'object' ? visible : null;
		const gate = slot ? slot.visible : (typeof visible === 'function' ? visible : undefined);
		return { type: 'group', heading: title, cls: 'ws-set-section' + (slot ? ' ' + slot.cls : ''), items, visible: gate };
	}

	// A SECTION UNDER A RAIL is not hidden by `visible`: a row whose section
	// is invisible when Obsidian builds its index is left out of the settings
	// search (measured: "No settings found" for a row of a section the rail
	// had not picked). The section stays visible to Obsidian and wears a
	// class the rail's refresh toggles `is-railed-off` on (the sheet hides
	// it); `visible` is kept for a real gate (the Powerline being off).
	railed(pageKey: string, key: string, visible?: Pred): RailSlot {
		return { cls: 'ws-rs-' + pageKey + '-' + key, visible };
	}

	// The keys a section owns, read off its definitions: a control's key, a
	// render row's declared keys.
	static keysOf(items: Item[] | undefined): Key[] {
		const out = new Set<Key>();
		const walk = (list: Item[] | undefined) => {
			for (const it of list || []) {
				if ('control' in it && it.control) out.add(it.control.key);
				for (const k of RENDER_KEYS.get(it) || []) out.add(k);
				if ('items' in it) walk(it.items);
			}
		};
		walk(items);
		return Array.from(out);
	}

	// The last row of a section: a small link that puts its keys back
	// through the door a load and a paste use (the repair pass runs; Undo,
	// under Vault, has the previous settings).
	resetLinkRow(title: string, keys: Key[]): Render {
		return {
			name: '',
			searchable: false,
			render: (st) => {
				st.settingEl.addClass('ws-set-reset-row');
				const btn = st.controlEl.createEl('button', { cls: 'ws-set-reset-link', attr: { type: 'button' } });
				setIcon(btn, 'rotate-ccw');
				btn.createSpan({ text: 'Reset ' + title + ' to defaults' });
				btn.addEventListener('click', () => { void (async () => {
					const r = await this.plugin.settingsResetKeys(keys);
					new Notice('Word-Smith: ' + (r.error || (r.changed + ' of ' + r.keys + ' back to the default' + (r.changed === 1 ? '' : 's') + '. Undo is under Vault.')), 6000);
					this.update();
				})(); });
			},
		};
	}

	// A small all-caps label between runs of rows on a page with no rail.
	subheadRow(title: string): Render {
		return { name: title, searchable: false, render: (st) => { st.settingEl.addClass('ws-set-subhead'); } };
	}

	// THE HOTKEYS, WHERE THEY MATTER: a card under a feature that has
	// commands, each command with the hotkey it has now, read off Obsidian's
	// hotkey manager (empty when none is set). Set under Settings → Hotkeys;
	// this card only says. THE KEYS, UNDER WHAT THEY DRIVE AND BEFORE THE
	// RESET: the card is the last row of its own section, so a pill's section
	// ends card, then reset link.
	//
	// WHAT IS ON, ONLY: an entry may carry the switch its command answers to;
	// off, its line is not drawn, and the card goes when none is left. The
	// lines are drawn again when that set changes (a switch flips, the tab
	// refreshes), the keys re-read on every refresh.
	hotkeysRow(entries: WsKeyEntry[], visible?: Pred): Render {
		const norm: { id: string; on: Pred | null }[] = entries.map((e) => typeof e === 'string' ? { id: e, on: null } : { id: e.id, on: e.on });
		const shown = () => norm.filter((e) => !e.on || e.on()).map((e) => e.id);
		// no card without a command to name (a blocked start registers none)
		const any = () => { const cmds: Record<string, unknown> = (this.app.commands && this.app.commands.commands) || {}; return shown().some((id) => !!cmds['word-smith:' + id]); };
		const def: Render = {
			name: '',
			desc: 'Hotkeys',
			searchable: false,
			visible: () => any() && (!visible || visible()),
			render: (st) => {
				st.settingEl.addClass('ws-set-keys');
				st.settingEl.querySelectorAll('.ws-set-keys-icon').forEach((old) => { old.remove(); });
				const icon = st.settingEl.createSpan({ cls: 'ws-set-keys-icon' });
				setIcon(icon, 'keyboard');
				st.settingEl.prepend(icon);
				// private API, both halves: a build without them draws the names alone
				const cmds: Record<string, { name?: string } | undefined> = (this.app.commands && this.app.commands.commands) || {};
				const keyOf = (full: string) => { try { return String(this.app.hotkeyManager.printHotkeyForCommand(full) || ''); } catch (_) { wsCatch('hotkeysRow: printHotkeyForCommand', _); return ''; } };
				let keyEls: [string, HTMLElement][] = [];
				let drawn = '';
				const draw = () => {
					const ids = shown();
					drawn = ids.join(' ');
					keyEls = [];
					st.descEl.empty();
					for (const id of ids) {
						const full = 'word-smith:' + id;
						const cmd = cmds[full];
						if (!cmd) continue;
						const line = st.descEl.createDiv({ cls: 'ws-set-keys-line' });
						line.createSpan({ cls: 'ws-set-keys-name', text: String(cmd.name || id).replace(/^Word-Smith: /, '') });
						const keys = keyOf(full);
						// OBSIDIAN'S OWN CHIP AND PLUS: the Hotkeys page's `setting-hotkey` chip,
						// `mod-empty` and "Blank" with no key, and its `setting-add-hotkey-button`
						// with the circled plus (as 1.13.7 draws them). The plus opens Settings →
						// Hotkeys with this command searched, where the key is set. In one control
						// beside the name, under our own class rather than Obsidian's
						// setting-command-hotkeys, whose rules sit the chip at the bottom.
						const ctl = line.createSpan({ cls: 'ws-set-keys-ctl' });
						keyEls.push([full, ctl.createSpan({ cls: 'setting-hotkey ws-set-keys-key' + (keys ? '' : ' mod-empty is-blank'), text: keys || 'Blank' })]);
						const name = String(cmd.name || id);
						const add = ctl.createEl('button', { cls: 'clickable-icon setting-add-hotkey-button ws-set-keys-add', attr: { type: 'button', 'aria-label': 'Set a hotkey for ' + name.replace(/^Word-Smith: /, '') } });
						setIcon(add, 'plus-circle');
						add.addEventListener('click', () => { this.openHotkeysFor(name); });
					}
					st.descEl.createDiv({ cls: 'ws-set-keys-note', text: 'Or set them under Settings \u2192 Hotkeys.' });
				};
				draw();
				// READ AGAIN, NOT ONCE: a hotkey set under Settings → Hotkeys and a
				// return to this page reached a card that still said "Blank" (the
				// definitions are asked once). The keys are re-read on every refresh
				// and whenever the settings window changes (the watch), and the text
				// is rewritten only when it differs — the watch must see no idle write.
				const paint = () => {
					if (shown().join(' ') !== drawn) { draw(); return; }
					for (const [full, el] of keyEls) {
						const keys = keyOf(full);
						const text = keys || 'Blank';
						if (el.textContent !== text) el.setText(text);
						setClass(el, 'is-blank', !keys);
						setClass(el, 'mod-empty', !keys);
					}
				};
				this.onRefresh(paint);
				this._rails.push(paint);
			},
		};
		return def;
	}

	// Settings → Hotkeys with one command searched, through the tab's own
	// `setQuery` (1.13.7: the box set, focused, the list drawn). A build
	// without it still lands on the Hotkeys tab.
	openHotkeysFor(name: string) {
		try {
			this.app.setting.open();
			const tab = this.app.setting.openTabById('hotkeys');
			if (tab && typeof tab.setQuery === 'function') tab.setQuery(name);
		} catch (_) { wsCatch('openHotkeysFor', _); }
	}

	// A note among the rows: a description and nothing else, as an INFO CARD —
	// the hotkeys card's box with an info glyph in front of the text.
	noteRow(text: string, visible?: Pred): Render {
		const def: Render = { name: '', desc: text, searchable: false, render: (st) => { this.infoInto(st); } };
		if (visible) def.visible = visible;
		return def;
	}

	// The info card's dress: the class and the glyph, the glyph on `settingEl`
	// outside the area Obsidian empties (as the alert's), so last time's goes
	// first. A ROW WITH A BLOCK OF ITS OWN (the frontmatter help, the format
	// reference) wears the glyph INLINE before its name and no box: the box
	// hides the control area, and the block lives there.
	infoInto(st: Setting, inline = false) {
		st.settingEl.querySelectorAll('.ws-set-note-icon').forEach((old) => { old.remove(); });
		const el = st.settingEl.createSpan({ cls: 'ws-set-note-icon' });
		setIcon(el, 'info');
		if (inline) { st.nameEl.prepend(el); return; }
		st.settingEl.addClass('ws-set-note');
		st.settingEl.prepend(el);
	}

	// A warning card under a switch that changes the editor's behavior: an
	// icon, one line, no button (the switch above it is the way back).
	alertRow(text: string, visible: Pred): Render {
		return { name: '', desc: text, searchable: false, visible, render: (st) => { this.alertInto(st, 'triangle-alert'); } };
	}

	// The alert's dress. The icon goes on `settingEl`, outside the control
	// area Obsidian empties — so last time's goes first.
	alertInto(st: Setting, icon: string) {
		st.settingEl.addClass('ws-set-alert');
		st.settingEl.querySelectorAll('.ws-set-alert-icon').forEach((old) => { old.remove(); });
		const el = st.settingEl.createSpan({ cls: 'ws-set-alert-icon' });
		setIcon(el, icon);
		st.settingEl.prepend(el);
	}

	// A row with Obsidian's own button at the right — not an `action` row
	// (the whole row clickable, its name in the accent), which reads as a
	// link.
	buttonRow(name: string, desc: string, text: string, run: () => void, visible?: Pred): Render {
		const def: Render = { name, desc, render: (st) => { st.addButton((b) => b.setButtonText(text).onClick(run)); } };
		if (visible) def.visible = visible;
		return def;
	}

	// A destructive button that is two taps: the first turns it red and asks
	// ("Delete?") for three seconds, the second runs `del`. Left alone, it
	// turns back. The row's size of button, not a card's icon.
	twoTapButton(st: Setting, text: string, del: () => void) {
		st.addButton((b) => {
			b.setButtonText(text);
			let armed = 0;
			b.onClick(() => {
				if (b.buttonEl.hasClass('mod-destructive')) { window.clearTimeout(armed); del(); return; }
				b.setDestructive().setButtonText(text + '?');
				armed = window.setTimeout(() => { b.buttonEl.removeClass('mod-destructive'); b.setButtonText(text); }, DELETE_ARM_MS);
			});
		});
	}

	// A row whose control area is a block of its own under the name (the
	// shelf, the status rows, the cards). Built in `controlEl`, which
	// Obsidian empties on a re-render.
	block(st: Setting, cls: string) {
		st.settingEl.addClass('ws-set-block');
		return st.controlEl.createDiv({ cls });
	}

	// A pill: a tick (drawn only while `on`), an icon, the name. One shape
	// everywhere — the rails, the theme shelf, the scope switch.
	pill(parent: HTMLElement, name: string, icon: string | null, opts: { cls?: string; tick?: boolean; label?: string; draw?: (el: HTMLElement) => void } = {}) {
		const el = parent.createEl('button', { cls: 'ws-pill' + (opts.cls ? ' ' + opts.cls : ''), attr: { type: 'button' } });
		if (opts.label) el.setAttribute('aria-label', opts.label);
		if (opts.tick) setIcon(el.createSpan({ cls: 'ws-tick' }), 'check');
		// the plugin's own glyph where it has one, a Lucide name otherwise
		if (opts.draw) opts.draw(el.createSpan({ cls: 'ws-pill-icon' }));
		else if (icon) setIcon(el.createSpan({ cls: 'ws-pill-icon' }), icon);
		el.createSpan({ cls: 'ws-pill-name', text: name });
		return el;
	}

	// Arrow keys across a row of pills: one pill is in the Tab order — the
	// picked one — and Left/Right/Home/End move focus and the Tab stop along
	// the row. `picked` re-seats the stop when the pick changes.
	rovingRow(row: HTMLElement, pills: HTMLElement[]) {
		const seat = (i: number) => pills.forEach((p, k) => setAttr(p, 'tabindex', k === i ? '0' : '-1'));
		row.addEventListener('keydown', (ev) => {
			const i = pills.indexOf(ev.target as HTMLElement);
			if (i < 0) return;
			let j = -1;
			if (ev.key === 'ArrowRight') j = (i + 1) % pills.length;
			else if (ev.key === 'ArrowLeft') j = (i - 1 + pills.length) % pills.length;
			else if (ev.key === 'Home') j = 0;
			else if (ev.key === 'End') j = pills.length - 1;
			if (j < 0) return;
			ev.preventDefault();
			seat(j);
			pills[j].focus();
		});
		return { picked: seat };
	}

	// A rail: one pill per section of a page, the picked one filled,
	// a tick on a section whose switch is on. A click sets the pick and
	// refreshes — the picked section's rows show, the others hide.
	railRow(pageKey: string, entries: RailEntry[]): Render {
		const pick = () => this.pickOf(pageKey, entries);
		return {
			name: 'Sections',
			desc: '',
			searchable: false,
			render: (st) => {
				this.watchEntries();   // a page renders in the settings window's document
				st.settingEl.addClass('ws-set-rail-row');
				const rail = st.controlEl.createDiv({ cls: 'ws-rail' });
				const pills: { key: string; el: HTMLElement }[] = [];
				for (const e of entries) {
					const el = this.pill(rail, e.name, e.icon, { tick: !!e.on, draw: e.draw });
					el.addEventListener('click', () => { this._picks[pageKey] = e.key; this.refreshDomState(); });
					pills.push({ key: e.key, el });
				}
				const roving = this.rovingRow(rail, pills.map((p) => p.el));
				const paint = () => {
					const p = pick();
					for (const c of pills) {
						const e = entries.find((x) => x.key === c.key);
						setClass(c.el, 'is-picked', c.key === p);
						setClass(c.el, 'is-on', !!(e && e.on && e.on()));
						setAttr(c.el, 'aria-pressed', c.key === p ? 'true' : 'false');
					}
					roving.picked(Math.max(0, pills.findIndex((c) => c.key === p)));
					this.paintRail(pageKey, entries, st.settingEl.ownerDocument);
				};
				paint();
				this.onRefresh(paint);
				this._rails.push(paint);
			},
		};
	}

	// The sections a rail governs, shown or hidden by class — only when the
	// class would change, so the watch below sees no idle mutation.
	paintRail(pageKey: string, entries: RailEntry[], doc: Document) {
		const p = this.pickOf(pageKey, entries);
		for (const e of entries) {
			const off = p !== e.key;
			doc.querySelectorAll('.ws-rs-' + pageKey + '-' + e.key).forEach((g) => { setClass(g, 'is-railed-off', off); });
		}
	}

	pickOf(pageKey: string, entries: RailEntry[]): string {
		const p = this._picks[pageKey];
		if (p) return p;
		const first = entries.find((e) => e.on && e.on());
		return first ? first.key : entries[0].key;
	}

	// A trash that is two taps: the first turns it into a red "Delete?" for
	// three seconds, the second runs `del`. Left alone, it turns back.
	twoTapDelete(parent: HTMLElement, label: string, del: () => void) {
		const b = parent.createEl('button', { cls: 'ws-card-action clickable-icon', attr: { type: 'button', 'aria-label': label, title: label } });
		setIcon(b, 'trash');
		let armed = 0;
		b.addEventListener('click', () => {
			if (b.hasClass('is-armed')) { window.clearTimeout(armed); del(); return; }
			b.addClass('is-armed');
			b.setText('Delete?');
			b.setAttribute('aria-label', 'Tap again to delete');
			armed = window.setTimeout(() => {
				b.removeClass('is-armed');
				b.empty();
				setIcon(b, 'trash');
				b.setAttribute('aria-label', label);
			}, DELETE_ARM_MS);
		});
		return b;
	}

	// An icon button beside a card.
	action(parent: HTMLElement, icon: string, label: string, run: (e: MouseEvent) => void) {
		const b = parent.createEl('button', { cls: 'ws-card-action clickable-icon', attr: { type: 'button', 'aria-label': label, title: label } });
		setIcon(b, icon);
		b.addEventListener('click', run);
		return b;
	}

	// A ROW THAT HOLDS SWATCHES: Obsidian's phone rule widens every input in a
	// control area to 100%, a colour input included, so a swatch grows to
	// whatever room its row has. The class lets the sheet hold the swatch
	// width there; every colour picker of ours is added through this.
	swatchRow(st: Setting) {
		try { st.settingEl.addClass('ws-set-swatches'); } catch (_) { wsCatch('swatchRow: st.settingEl.addClass(ws-set-swatches)', _); }
	}

	// A colour swatch bound to one key, saved now (the bar repaints on save).
	swatch(st: Setting, key: Key) {
		const s = bag(this.plugin.settings);
		this.swatchRow(st);
		st.addColorPicker((cp) => cp.setValue(str(s[key] || DEFAULTS[key]))
			.onChange((v) => { void (async () => { s[key] = v; await this.plugin.saveSettings(true); })(); }));
	}

	// ── WHERE IT APPLIES ────────────────────────────────────────────────────

	// The scope's two rows open the Vault page.
	scopeSection(): Group {
		const s = this.plugin.settings;
		const count = () => Array.isArray(s.scopePaths) ? s.scopePaths.length : 0;
		return this.section('Where it applies', [
				this.subheadRow('Where it applies'),
				rendered({ name: 'Rule', desc: 'Only the listed paths, or everywhere except them.', render: (st) => this.renderScopeMode(st), visible: () => count() > 0 }, ['scopeMode']),
				rendered({ name: 'Paths', desc: 'Folders and notes. With none listed, Word-Smith applies to every note.', render: (st) => this.renderPaths(st, 'scopePaths', 'Add a folder or note', 'Apply to…', true) }, ['scopePaths']),
		]);
	}

	// Two pills: only these, or everywhere except.
	renderScopeMode(st: Setting) {
		const s = this.plugin.settings;
		const wrap = st.controlEl.createDiv({ cls: 'ws-pills' });
		const modes: [string, string, string][] = [['include', 'Only these', 'list-check'], ['exclude', 'Everywhere except', 'list-x']];
		const pills = modes.map(([id, name, icon]) => {
			const el = this.pill(wrap, name, icon);
			el.addEventListener('click', () => { void (async () => {
				if (s.scopeMode === id) return;
				s.scopeMode = id;
				await this.plugin.saveSettings(true);
				paint();
				this.update();   // the entry's value changes
			})(); });
			return el;
		});
		const roving = this.rovingRow(wrap, pills);
		const paint = () => {
			const cur = s.scopeMode === 'exclude' ? 1 : 0;
			pills.forEach((p, i) => { setClass(p, 'is-picked', i === cur); setAttr(p, 'aria-pressed', i === cur ? 'true' : 'false'); });
			roving.picked(cur);
		};
		paint();
	}

	// The paths as cards: the path, its kind, a two-tap trash; then a dashed
	// pill that opens the picker.
	renderPaths(st: Setting, key: 'scopePaths' | 'countExclude', addLabel: string, placeholder: string, withRoot: boolean) {
		const s = this.plugin.settings;
		const paths = () => Array.isArray(s[key]) ? s[key] : (s[key] = []);
		const box = this.block(st, 'ws-cards');
		paths().forEach((path, i) => {
			const card = box.createDiv({ cls: 'ws-card' });
			const text = card.createSpan({ cls: 'ws-card-text' });
			text.createSpan({ cls: 'ws-card-name', text: path === '/' ? 'Entire vault' : path });
			text.createSpan({ cls: 'ws-card-kind', text: /\.md$/i.test(path) ? 'note' : 'folder' });
			this.twoTapDelete(card, 'Remove ' + path, () => { void (async () => {
				paths().splice(i, 1);
				await this.plugin.saveSettings(true);
				this.update();
			})(); });
		});
		const add = this.pill(box, addLabel, 'plus', { cls: 'ws-pill-more' });
		add.addEventListener('click', () => this.pickPath(key, placeholder, withRoot));
	}

	// The one picker for both lists: folders first (the vault itself where a
	// list takes it), then notes; what the list already holds is left out.
	pickPath(key: 'scopePaths' | 'countExclude', placeholder: string, withRoot: boolean) {
		if (!WsPathSuggestModal) return;
		const s = this.plugin.settings;
		const have = new Set<string>(Array.isArray(s[key]) ? s[key] : []);
		const folders = this.app.vault.getAllLoadedFiles()
			.filter((f) => f instanceof TFolder).map((f) => f.path)
			.filter((path) => path && path !== '/' && !have.has(path));
		const notes = this.app.vault.getMarkdownFiles().map((f) => f.path).filter((path) => !have.has(path));
		const items = (withRoot && !have.has('/') ? ['/'] : []).concat(folders, notes);
		if (!items.length) return;
		new WsPathSuggestModal(this.app, items, placeholder, (picked: string) => { void (async () => {
			const list = Array.isArray(s[key]) ? s[key] : (s[key] = []);
			if (!list.includes(picked)) list.push(picked);
			await this.plugin.saveSettings(true);
			this.update();
		})(); }).open();
	}

	// ── POWERMENU ───────────────────────────────────────────────────────────

	pagePowermenu(on: Pred): Page {
		const s = this.plugin.settings;
		return this.page('Powermenu', 'layout-grid', 'The menu of everything, floating or docked.', [
			this.section('Powermenu', [
				{ name: 'Dock it as a panel', desc: 'In a sidebar instead of a floating panel.', control: { type: 'toggle', key: 'menuDock' } },
				rendered({ name: 'What the menu holds', desc: 'Drag to reorder, drop a card on another to share a row, pin any command.', render: (st) => this.renderMenuShelf(st) },
					['menuOrder', 'menuHidden', 'menuAliases', 'menuJoined', 'menuRuleStyles']),
				this.hotkeysRow(['open-menu', 'open-menu-panel']),
			]),
		], () => s.menuDock ? 'Docked' : 'Floating', on);
	}

	renderMenuShelf(st: Setting) {
		const plugin = this.plugin;
		const box = this.block(st, 'ws-menu-shelf');
		const redisplay = () => { this.update(); plugin.rebuildMenuPanels(); };

		const defs = plugin.menuFeatureDefs();
		const nameOf = (id: string) => {
			if (/^rule-\d+$/.test(id)) return 'Separator';
			if (plugin.menuIsCommand(id)) return plugin.menuAliasOf(id);
			const d = defs.find((f) => f.id === id);
			return d ? d.name : id;   // an unknown id is shown as itself: reachable beats pretty
		};

		const grid = box.createDiv({ cls: 'ws-menu-bands' });
		const fullOrder = plugin.menuLayout();
		const dropGap = (toIdx: number) => {
			const gap = grid.createDiv({ cls: 'ws-menu-gap' });
			gap.addEventListener('dragover', (e) => { e.preventDefault(); gap.addClass('is-dropzone'); });
			gap.addEventListener('dragleave', () => gap.removeClass('is-dropzone'));
			gap.addEventListener('drop', (e) => { void (async () => {
				e.preventDefault();
				const dragged = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
				if (!dragged) return;
				plugin.menuBreakAt(dragged, toIdx);
				await plugin.saveSettings();
				redisplay();
			})(); });
			return gap;
		};

		plugin.menuBands().forEach((band) => {
			dropGap(fullOrder.indexOf(band[0]));
			const bandEl = grid.createDiv({ cls: 'ws-menu-bandrow' });
			if (band.length >= MENU_MAX_COLS) bandEl.addClass('is-full');
			band.forEach((id: string) => {
				const isRule = /^rule-\d+$/.test(id);
				const isCmd = plugin.menuIsCommand(id);
				const isDead = isCmd && !plugin.menuCommandFor(id);
				// the card is a div: the handle (glyph and name) and the action
				// buttons are siblings in it
				const card = bandEl.createDiv({ cls: 'ws-card ws-menu-card' + (isRule ? ' is-rule' : '') + (isCmd ? ' is-cmd' : '') + (isDead ? ' is-dead' : '') });
				card.setAttribute('title', isRule ? 'Separator' : isCmd ? plugin.menuCommandName(id) : nameOf(id));
				card.setAttribute('draggable', 'true');
				card.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', id); card.addClass('is-dragging'); });
				card.addEventListener('dragend', () => card.removeClass('is-dragging'));
				card.addEventListener('dragover', (e) => { e.preventDefault(); card.addClass('is-dropzone'); });
				card.addEventListener('dragleave', () => card.removeClass('is-dropzone'));
				card.addEventListener('drop', (e) => { void (async () => {
					e.preventDefault();
					const dragged = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
					if (!dragged || dragged === id) return;
					plugin.menuJoinAfter(dragged, id);
					await plugin.saveSettings();
					redisplay();
				})(); });
				card.setAttribute('data-menucard', id);
				plugin.touchDrag(card, id, {
					rows: () => Array.from(box.querySelectorAll('.ws-menu-card')),
					idOf: (cardEl: HTMLElement) => cardEl.getAttribute('data-menucard'),
					drop: (from: string, to: string) => {
						if (!from || from === to) return;
						plugin.menuJoinAfter(from, to);
						void plugin.saveSettings().then(() => redisplay());
					},
				});

				const handle = card.createSpan({ cls: 'ws-card-text' });
				// the card wears the glyph the menu wears, through the drawer the
				// menu uses, so the card and the row cannot come to disagree
				if (!isRule) { try { plugin.menuDrawIcon(handle, id); } catch (_) { wsCatch('renderMenuShelf: the card’s glyph', _); } }
				const nameEl = handle.createSpan({ cls: 'ws-card-name' + (isRule ? ' is-rule-' + plugin.menuRuleStyle(id) : ''), text: isRule ? '' : nameOf(id) });
				if (isRule) {
					// Obsidian's own `dropdown`, as every other select on the tab; the sheet
					// only keeps it from taking the card's width
					const sel = card.createEl('select', { cls: 'dropdown ws-rule-style' });
					sel.setAttribute('aria-label', 'How this separator draws');
					for (const style of MENU_RULE_STYLES) { const o = sel.createEl('option', { text: style.charAt(0).toUpperCase() + style.slice(1) }); o.value = style; }
					sel.value = plugin.menuRuleStyle(id);
					sel.addEventListener('click', (e) => e.stopPropagation());
					sel.addEventListener('change', () => { void (async () => {
						plugin.menuSetRuleStyle(id, sel.value);
						await plugin.saveSettings();
						redisplay();
					})(); });
				}
				if (isCmd) {
					this.action(card, 'pencil', 'Rename ' + nameOf(id), (e) => {
						e.stopPropagation();
						nameEl.empty();
						card.setAttribute('draggable', 'false');
						const inp = nameEl.createEl('input', { cls: 'ws-card-nameinput' });
						inp.type = 'text';
						inp.value = nameOf(id);
						let done = false;
						const finish = async (save: boolean) => {
							if (done) return;
							done = true;
							if (save) { plugin.menuSetAlias(id, inp.value); await plugin.saveSettings(); }
							redisplay();
						};
						inp.addEventListener('click', (ev) => ev.stopPropagation());
						inp.addEventListener('keydown', (ev) => {
							if (ev.key === 'Enter') { ev.preventDefault(); void finish(true); }
							if (ev.key === 'Escape') { ev.preventDefault(); void finish(false); }
						});
						inp.addEventListener('blur', () => { void finish(true); });
						try { inp.focus(); inp.select(); } catch (_) { wsCatch('renderMenuShelf: inp.focus();', _); }
					});
				}
				this.action(card, 'x', isRule ? 'Delete this separator' : 'Set ' + nameOf(id) + ' aside', (e) => { void (async () => {
					e.stopPropagation();
					if (isRule) plugin.menuDeleteRule(id); else plugin.menuHide(id);
					await plugin.saveSettings();
					redisplay();
				})(); });
			});
		});
		dropGap(fullOrder.length);

		// under the bands: add a separator, pin a command, and what was set aside
		const tools = box.createDiv({ cls: 'ws-pills ws-menu-tools' });
		const addRule = this.pill(tools, 'Add a separator', 'minus', { cls: 'ws-pill-more' });
		addRule.addEventListener('click', () => { void (async () => {
			plugin.menuAddRule();
			await plugin.saveSettings();
			redisplay();
		})(); });

		const finder = box.createDiv({ cls: 'ws-cmd-finder' });
		// OBSIDIAN'S OWN SEARCH BOX: the container draws the magnifier and the
		// clear button, as "Search settings..." above it does, and the placeholder
		// ends as that one does.
		const cmdSearch = finder.createDiv({ cls: 'search-input-container' }).createEl('input', { cls: 'ws-cmd-search' });
		cmdSearch.type = 'search';
		cmdSearch.placeholder = 'Search any command to pin…';
		cmdSearch.setAttribute('aria-label', 'Search any command to pin');
		const cmdHits = finder.createDiv({ cls: 'ws-cmd-hits' });
		const pinnedNow = new Set(plugin.menuLayout());
		const drawHits = () => {
			cmdHits.empty();
			const q = (cmdSearch.value || '').trim();
			if (!q) return;
			let cmds: { id: string; name: string }[] = [];
			try { cmds = plugin.app.commands.listCommands() || []; } catch (_) { wsCatch('renderMenuShelf / drawHits: cmds = plugin.app.commands.listCommands();', _); }
			const hits: { sc: number; c: { id: string; name: string } }[] = [];
			for (const c of cmds) {
				if (!c || !c.id || pinnedNow.has('cmd:' + c.id)) continue;
				const sc = Math.max(barMenuFuzzy(q, c.name || ''), barMenuFuzzy(q, c.id) - 1);
				if (sc >= 0) hits.push({ sc, c });
			}
			hits.sort((a, b) => b.sc - a.sc);
			if (!hits.length) { cmdHits.createDiv({ cls: 'ws-cmd-empty', text: 'Nothing matches' }); return; }
			for (const h of hits.slice(0, 8)) {
				const hit = cmdHits.createEl('button', { cls: 'ws-cmd-hit', text: h.c.name || h.c.id, attr: { type: 'button' } });
				hit.addEventListener('click', () => { void (async () => {
					plugin.menuPinCommand(h.c.id);
					await plugin.saveSettings();
					redisplay();
				})(); });
			}
		};
		cmdSearch.addEventListener('input', drawHits);

		const hiddenIds = plugin.settings.menuHidden || [];
		if (hiddenIds.length) {
			box.createDiv({ cls: 'ws-set-label', text: 'Set aside' });
			const row = box.createDiv({ cls: 'ws-pills' });
			for (const id of hiddenIds) {
				const restore = () => { void (async () => { plugin.menuRestore(id); await plugin.saveSettings(); redisplay(); })(); };
				if (plugin.menuIsCommand(id)) {
					const card = row.createDiv({ cls: 'ws-card' });
					card.setAttribute('title', plugin.menuCommandName(id));
					const back = card.createEl('button', { cls: 'ws-card-use', attr: { type: 'button', 'aria-label': 'Put ' + nameOf(id) + ' back in the menu' } });
					setIcon(back.createSpan({ cls: 'ws-pill-icon' }), 'undo-2');
					back.createSpan({ cls: 'ws-card-name', text: nameOf(id) });
					back.addEventListener('click', restore);
					this.action(card, 'x', 'Unpin ' + nameOf(id), (e) => { void (async () => { e.stopPropagation(); plugin.menuUnpin(id); await plugin.saveSettings(); redisplay(); })(); });
					continue;
				}
				const chip = this.pill(row, nameOf(id), 'undo-2', { label: 'Put ' + nameOf(id) + ' back in the menu' });
				chip.addEventListener('click', restore);
			}
		}
	}

	// ── POWERLINE ───────────────────────────────────────────────────────────

	pagePowerline(on: Pred): Page {
		const s = this.plugin.settings;
		const bar: Pred = () => !!s.enableRetroStatus;
		const rules: Pred = () => (s.statusBarBorderStyle || 'solid') !== 'none';
		// weight 0 is the hairline; as `barRuleIsHair` reads it
		const hair: Pred = () => rules() && s.statusBarBorderWidth != null && Number(s.statusBarBorderWidth) === 0;
		const RAIL: RailEntry[] = [
			{ key: 'rows', name: 'Rows', icon: 'rows-3' },
			{ key: 'look', name: 'Look', icon: 'ruler' },
			// Tokens before Colors, Vim last
			{ key: 'tokens', name: 'Tokens', icon: 'braces' },
			{ key: 'colors', name: 'Colors', icon: 'palette' },
			{ key: 'vim', name: 'Vim', icon: 'terminal' },
		];
		const tokenFormat = (token: string, id: string, word: string, desc: string): Def => rendered({
			name: token, desc, render: (st) => this.renderTokenIconFormat(st, id, word),
		}, ['barTokenIcons']);
		const palette = (prefix: 'powerlineColor' | 'powerlineColorLight') => {
			const keys: Key[] = [];
			for (let n = 1; n <= PL_BG_COUNT; n++) keys.push((prefix + n) as Key);
			return keys;
		};
		const value = () => {
			if (!s.enableRetroStatus) return 'Off';
			const n = this.plugin.getStatusRows().length;
			const preset = this.presetInUse();
			return 'On · ' + (preset ? preset + ' · ' : '') + n + (n === 1 ? ' row' : ' rows');
		};
		return this.page('Powerline', 'panel-bottom', 'Rows, colors, borders, tokens.', [
			this.section('Powerline', [
				{ name: 'Powerline status bar', desc: 'Replaces the status bar with rows of readings and buttons.', control: { type: 'toggle', key: 'enableRetroStatus' } },
				this.presetsRow(bar),
			], undefined, false),
			this.section('Sections', [this.railRow('powerline', RAIL)], bar),
			this.section('Rows', [
				rendered({ name: 'What each row says', desc: 'Left, center and right of every row, written in tokens.', render: (st) => this.renderStatusRows(st) }, ['statusRows']),
				{ name: 'How to write a row', desc: 'Every token, and how to color a segment.', render: (st) => this.renderFormatReference(st), searchable: false },
			], this.railed('powerline', 'rows', bar)),
			this.section('Look', [
				{ name: 'Match the note’s text size', desc: 'The bar follows the editor’s font size.', control: { type: 'toggle', key: 'statusBarFontFollowNote' } },
				{ name: 'Font size', desc: 'In pixels.', control: { type: 'slider', key: 'statusBarFontSize', min: 8, max: 24, step: 1 }, visible: () => !s.statusBarFontFollowNote },
				{ name: 'Interface font', desc: 'Obsidian’s own face for the bar, whatever font the note is in.', control: { type: 'toggle', key: 'statusBarUiFont' } },
				{ name: 'Row height', desc: 'In pixels.', control: { type: 'slider', key: 'statusBarHeight', min: 12, max: 30, step: 1 } },
				{ name: 'Space above', desc: 'In pixels.', control: { type: 'slider', key: 'statusBarPadTop', min: 0, max: 24, step: 1 } },
				{ name: 'Space below', desc: 'In pixels.', control: { type: 'slider', key: 'statusBarPadBottom', min: 0, max: 24, step: 1 } },
				{ name: 'Gap under the bar', desc: 'Pixels between the bar and the window’s edge.', control: { type: 'slider', key: 'barBottomGap', min: 0, max: 30, step: 1 } },
				{ name: 'Top rule', desc: 'A line above the bar.', control: { type: 'toggle', key: 'statusBarBorderTop' } },
				// hidden for a hairline bar on the window's edge: the frame's own
				// hairline is its bottom rule, and one drawn under it moves the tokens
				// up a pixel; lifted off the edge (a gap), the bar gets its own again
				{ name: 'Bottom rule', desc: 'A line under the bar.', control: { type: 'toggle', key: 'statusBarBorderBottom' }, visible: () => !hair() || this.plugin.barBottomGapPx() > 0 },
				{ name: 'Rule style', desc: 'None hides both rules.', control: { type: 'dropdown', key: 'statusBarBorderStyle',
					options: { none: 'None', solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double' } } },
				// 0 is the hairline, so the edges and the colours still apply to it
				{ name: 'Rule weight', desc: 'In pixels; 0 is a hairline, the thinnest line the screen can draw.', control: { type: 'slider', key: 'statusBarBorderWidth', min: 0, max: 8, step: 1 }, visible: rules },
				rendered({ name: 'Rule colors, dark theme', desc: 'Top, then bottom.', render: (st) => this.renderColorPair(st, 'barRuleDarkTopColor', 'barRuleDarkBottomColor'), visible: rules }, ['barRuleDarkTopColor', 'barRuleDarkBottomColor']),
				rendered({ name: 'Rule colors, light theme', desc: 'Top, then bottom.', render: (st) => this.renderColorPair(st, 'barRuleLightTopColor', 'barRuleLightBottomColor'), visible: rules }, ['barRuleLightTopColor', 'barRuleLightBottomColor']),
				{ name: 'Show the bar on phones', desc: 'Off by default: a phone screen is small for a status line.', control: { type: 'toggle', key: 'retroBarOnPhone' }, visible: () => !!Platform.isPhone },
			], this.railed('powerline', 'look', bar)),
			this.section('Colors', [
				rendered({ name: 'Palette, dark theme', desc: 'The seven segment colors a row can name, :1 to :7.', render: (st) => this.renderPalette(st, palette('powerlineColor')) }, palette('powerlineColor')),
				rendered({ name: 'Palette, light theme', desc: 'The same seven for light themes.', render: (st) => this.renderPalette(st, palette('powerlineColorLight')) }, palette('powerlineColorLight')),
			], this.railed('powerline', 'colors', bar)),
			this.section('Vim', [
				{ name: 'Follow the Vim mode', desc: 'Recolors the {vim} segment as the mode changes.', control: { type: 'toggle', key: 'powerlineModeColors' } },
				{ name: 'Follow Cursor-Smith', desc: 'Borrows its caret colors instead of the five below.', control: { type: 'toggle', key: 'vimFollowCursorSmith' } },
				...this.vimModeRows(),
			], this.railed('powerline', 'vim', bar)),
			this.section('Tokens', [
				{ name: '{file}', desc: 'The note’s name, with or without its folders.', control: { type: 'dropdown', key: 'fileTokenFormat', options: { path: 'Full path', name: 'File name only' } } },
				{ name: '{flag}', desc: 'The flag’s icon, its name, or both.', control: { type: 'dropdown', key: 'flagTokenFormat', options: { icon: 'Icon', name: 'Name', both: 'Icon and name' } } },
				{ name: '{font}', desc: 'The menu’s icon, the word, or both.', control: { type: 'dropdown', key: 'fontTokenFormat', options: { glyph: 'Icon', word: 'Name', both: 'Icon and name' } } },
				{ name: '{markers}', desc: 'The menu’s icon, the word, or both.', control: { type: 'dropdown', key: 'markersTokenFormat', options: { glyph: 'Icon', word: 'Name', both: 'Icon and name' } } },
				tokenFormat('{mode}', 'modes', 'Modes', 'The menu’s icon, the word, or both.'),
				tokenFormat('{syntax}', 'syntax', 'Syntax', 'The menu’s icon, the word, or both.'),
				tokenFormat('{prose}', 'prose', 'Prose', 'The menu’s icon, the word, or both.'),
				tokenFormat('{theme}', 'theme', 'Theme', 'The menu’s icon, the word, or both.'),
				tokenFormat('{report}', 'report', 'Report', 'The menu’s icon, the word, or both.'),
				tokenFormat('{history}', 'history', 'History', 'The menu’s icon, the word, or both.'),
				tokenFormat('{export}', 'export', 'Export', 'The menu’s icon, the word, or both.'),
				tokenFormat('{organizer}', 'organizer', 'Organizer', 'The menu’s icon, the word, or both.'),
				tokenFormat('{powermenu}', 'powermenu', 'Menu', 'The Powermenu’s icon, the word, or both.'),
				tokenFormat('{properties}', 'properties', '6 properties', 'The number, then the pane’s icon, the word, or both.'),
				tokenFormat('{backlinks}', 'backlinks', '3 backlinks', 'The number, then the pane’s icon, the word, or both.'),
				this.noteRow('Dates are written a piece at a time, like {dd}.{mm}.{yy}.'),
			], this.railed('powerline', 'tokens', bar)),
			// the bar's own key at the page's foot: it is no pill's, and the top
			// section has no reset to be last
			this.section('Hotkeys', [this.hotkeysRow(['toggle-retro-bar'])], undefined, false),
		], value, on);
	}

	// the three slots of every row, as text: the rows are a list under one
	// key, which no control can address, so they are drawn by hand
	renderStatusRows(st: Setting) {
		const rows = this.plugin.getStatusRows();
		const box = this.block(st, 'ws-status-rows');
		const SLOTS: ['left' | 'center' | 'right', string][] = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
		rows.forEach((row, i) => {
			if (rows.length > 1) box.createDiv({ cls: 'ws-set-label', text: 'Row ' + (i + 1) });
			for (const [slot, label] of SLOTS) {
				const r = new Setting(box).setName(label)
					.addText((t) => t.setPlaceholder('e.g. {file}').setValue(row[slot])
						.onChange((v) => { void (async () => {
							this.plugin.settings.statusRows[i][slot] = v;
							await this.plugin.saveSettings();
						})(); }));
				r.settingEl.addClass('ws-row-fmt');
			}
		});
	}

	renderPalette(st: Setting, keys: Key[]) {
		st.settingEl.addClass('ws-color-row');
		for (const key of keys) this.swatch(st, key);
	}

	// two colors on one row (the section's reset link puts them back)
	renderColorPair(st: Setting, bgKey: Key, textKey: Key) {
		st.settingEl.addClass('ws-color-row', 'ws-color-pair');
		this.swatch(st, bgKey);
		this.swatch(st, textKey);
	}

	// How {vim} writes each mode and what colors it wears: two swatches
	// (dark theme, then light) and the label.
	vimModeRows(): Def[] {
		const s = bag(this.plugin.settings);
		const MODES: [Key, string, string, Key][] = [
			['vimLabelNormal', 'Normal', '-- NORMAL --', 'vimColorNormal'],
			['vimLabelInsert', 'Insert', '-- INSERT --', 'vimColorInsert'],
			['vimLabelVisual', 'Visual', '-- VISUAL --', 'vimColorVisual'],
			['vimLabelReplace', 'Replace', '-- REPLACE --', 'vimColorReplace'],
			['vimLabelCommand', 'Command', '-- COMMAND --', 'vimColorCommand'],
		];
		const cs = this.plugin.cursorSmithSettings();
		const borrowed = !!(cs && cs.vimModeEnabled && this.plugin.settings.vimFollowCursorSmith !== false);
		return MODES.map(([key, name, dflt, colorKey]): Def => rendered({
			name,
			desc: borrowed ? 'Cursor-Smith picks these while Follow Cursor-Smith is on.' : 'Dark theme, light theme, and the label.',
			render: (st) => {
				st.settingEl.addClass('ws-color-row', 'ws-vim-row');
				this.swatch(st, colorKey);
				this.swatch(st, (colorKey + 'Light') as Key);
				st.addText((t) => t.setPlaceholder(dflt).setValue(s[key] != null ? str(s[key]) : dflt)
					.onChange((v) => { void (async () => { s[key] = v; await this.plugin.saveSettings(true); })(); }));
			},
		}, [key, colorKey, (colorKey + 'Light') as Key]));
	}

	// a button token's format is a map keyed by the token's id, absent meaning the word
	renderTokenIconFormat(st: Setting, id: string, word: string) {
		st.addDropdown((dd) => dd.addOption('icon', 'Icon').addOption('word', 'Name (' + word + ')').addOption('both', 'Icon and name')
			.setValue(this.plugin.barTokenFormat(id))
			.onChange((v) => { void (async () => {
				const m = Object.assign({}, this.plugin.settings.barTokenIcons || {});
				if (v === 'icon' || v === 'both') m[id] = v; else delete m[id];
				this.plugin.settings.barTokenIcons = m;
				await this.plugin.saveSettings();
				this.plugin.updateRetroStatusBar();
			})(); }));
	}

	// the reference is a page of material, closed by default so it does not
	// bury the fields it documents
	renderFormatReference(st: Setting) {
		// AN INFO GLYPH ON THE ROW, inline before its name: the row keeps its
		// block
		this.infoInto(st, true);
		const box = this.block(st, 'ws-token-help-box').createDiv({ cls: 'ws-token-help' });
		// A TABLE UNDER A RAIL: pills, one group shown; a group is a rounded
		// table, its sub-headings rows of their own, each line its tokens as
		// chips and one gloss in the words docs/powerline.md uses. No
		// disclosure: the pills are the way in.
		const rail = box.createDiv({ cls: 'ws-rail ws-help-rail' });
		const groups: { el: HTMLElement; pill: HTMLElement }[] = [];
		let table: HTMLElement | null = null, body: HTMLElement | null = null;
		const pick = (i: number) => {
			groups.forEach((g, k) => {
				setClass(g.el, 'is-picked', k === i);
				setClass(g.pill, 'is-picked', k === i);
				setAttr(g.pill, 'aria-pressed', k === i ? 'true' : 'false');
			});
			roving.picked(i);
		};
		const G = (name: string, icon: string) => {
			const el = box.createDiv({ cls: 'ws-help-sect' });
			table = el.createEl('table', { cls: 'ws-help-table' });
			body = null;
			const pill = this.pill(rail, name, icon);
			const i = groups.length;
			pill.addEventListener('click', () => pick(i));
			groups.push({ el, pill });
			return el;
		};
		const SUB = (title: string) => {
			if (!table) return;
			body = table.createEl('tbody');
			body.createEl('tr', { cls: 'ws-help-sub' }).createEl('th', { text: title, attr: { colspan: '2' } });
		};
		const L = (tokens: string[], gloss: string) => {
			if (!table) return;
			if (!body) body = table.createEl('tbody');
			const tr = body.createEl('tr', { cls: 'ws-help-line' });
			const toks = tr.createEl('td', { cls: 'ws-help-toks' });
			for (const t of tokens) toks.createSpan({ cls: 'ws-help-tok', text: t });
			tr.createEl('td', { cls: 'ws-help-gloss', text: gloss });
		};
		const N = (el: HTMLElement, text: string) => { el.createDiv({ cls: 'ws-help-note', text }); };
		// FIVE PILLS: Readouts, Buttons, Dividers (the fades under them), Colors
		// (a colon paints the background, a semicolon the text), Misc last.
		let g = G('Readouts', 'book-open');
		SUB('The note');
		L(['{file}'], 'The note\u2019s name. Click it to reveal the note in the explorer.');
		L(['{words}', '{chars}'], 'The note, or your selection.');
		L(['{readtime}'], 'How long the note takes to read.');
		L(['{#>}'], 'The heading path: Chapter 3 \u203a The Ferry \u203a Beat 2.');
		L(['{flag}'], 'The flag of the note you\u2019re in. Click to change it.');
		SUB('Where you are');
		L(['{ln:col}'], 'The line and column the cursor is on.');
		L(['{paragraph}'], 'The paragraph the cursor is in.');
		SUB('Counts');
		L(['{tasks}'], 'Tasks ticked over tasks in the note, [3/7], as the Organizer shows them. Nothing when there are none.');
		L(['{properties}'], 'How many properties the note has. Click to open the Properties pane.');
		L(['{backlinks}'], 'How many notes link here. Click to open the backlinks pane.');
		g = G('Buttons', 'mouse-pointer-click');
		SUB('Pickers');
		L(['{syntax}', '{prose}', '{markers}', '{font}', '{theme}'], 'Each opens its picker, right on the bar.');
		SUB('Panes and the menu');
		L(['{report}', '{history}', '{export}', '{organizer}'], 'Each opens that pane; the Organizer on the tab you arrange it in.');
		L(['{powermenu}'], 'Opens the Powermenu, the menu of everything.');
		SUB('Modes');
		L(['{mode}'], 'A Modes button: letter box, typewriter, Hemingway, right on the bar.');
		N(g, 'Buttons are never dropped, however narrow the window gets. Under Token formats, each can be the icon, the word, or both.');
		g = G('Dividers', 'separator-vertical');
		SUB('Hard dividers: the cut between two segments');
		L(['>', '<'], 'Arrows.');
		L(['|'], 'Straight. Type \\| for a real bar in your text.');
		L([')', '('], 'Curves.');
		L(['~'], 'A wave.');
		L(['/', '\\'], 'Slanted cuts.');
		SUB('Soft dividers: marks inside a segment');
		L(['::'], 'A short thin line.');
		L(['>>', '<<'], 'Chevrons: the same line bent to a point.');
		L(['{s}'], 'A quarter-space.');
		SUB('Fades: one color stepping into the next');
		L(['{g}'], 'One narrow step.');
		L(['{g}{g}{g}'], 'Three narrow steps.');
		L(['{ggg}'], 'One wide step.');
		N(g, 'The character you type is the shape you get; dividers are drawn, so no patched font is needed. Fades are the first thing dropped when the window gets narrow.');
		g = G('Colors', 'palette');
		SUB('A colon paints the background');
		L(['{words}:3'], 'Palette color nr. 3 behind the segment; the text picks itself, light or dark.');
		L(['{file}:b1', ':b2', ':b3', ':b4'], 'Your theme\u2019s own surfaces.');
		L(['{file}:bs'], 'The status line\u2019s own color.');
		L(['{file}:bc'], 'The caret\u2019s color, live.');
		L(['{file}:f'], 'The color of this note\u2019s flag.');
		SUB('A semicolon paints the text');
		L(['{words};1'], 'Palette color nr. 1 for the words.');
		L(['{file};t1', ';t2', ';t3'], 'Your theme\u2019s normal, muted and faint text.');
		L(['{words};vim'], 'Text that follows your Vim mode.');
		SUB('Both at once');
		L(['{words}:3;1'], 'Background nr. 3, text nr. 1.');
		SUB('The whole bar');
		L([':3 {file} \u2026'], 'A colon before the first token of row 1 paints the whole bar\u2019s background: palette color nr. 3 here, or :b1, :vim, :f.');
		L([';2 {file} \u2026'], 'A semicolon there paints all of its text: palette color nr. 2 here, or ;t1, ;vim, ;f.');
		L([':3;2 {file} \u2026'], 'Both at once. A token with a color of its own keeps it.');
		N(g, 'Seven palette colors, a dark set and a light set, under Colors. A token with no color lies flush with the bar.');
		g = G('Misc', 'more-horizontal');
		SUB('Time and date');
		L(['{time}'], 'The time, written.');
		L(['{clock}'], 'The time, drawn as a dial.');
		L(['{dd}', '{mm}', '{yyyy}', '{yy}'], 'Date parts, joined however you like: {dd}/{mm}/{yy}.');
		SUB('The machine');
		L(['{battery}'], 'The battery.');
		L(['{caps}', '{num}'], 'Caps lock and num lock, only when on.');
		L(['{vim}'], 'Which Vim mode you\u2019re in.');
		SUB('And');
		L(['{obsidian}'], 'A small Obsidian crystal.');
		const roving = this.rovingRow(rail, groups.map((x) => x.pill));
		pick(0);
	}

	// ── The presets ─────────────────────────────────────────────────────────
	// One thin card per saved bar, the way Cursor-Smith's strip is: a "use"
	// button holding a tick while that bar is the one in use, a small demo of
	// its look and its name; beside it Copy its share code and a two-tap
	// Delete. Then Save and Import, two more cards, each through a prompt:
	// Save under a taken name warns once and replaces on the second OK; a
	// code that is not one of ours says so under the field. The card is a div
	// — one button inside another is invalid HTML — and the use buttons are
	// one keyboard group.
	presetsRow(visible: Pred): Render {
		return rendered({
			name: 'Presets',
			desc: 'Tap a bar to use it. Save keeps the bar as it is; Import takes a code someone sent you.',
			visible,
			render: (st) => this.renderPresetStrip(st),
		}, ['barPresets']);
	}

	renderPresetStrip(st: Setting) {
		const plugin = this.plugin;
		const box = this.block(st, 'ws-preset-strip');
		const strip = box.createDiv({ cls: 'ws-cards' });
		const library = plugin.getBarPresets();
		const names = Object.keys(library);
		const active = this.presetInUse();
		const redisplay = () => this.update();
		const uses: HTMLElement[] = [];
		for (const name of names) {
			const snap = library[name];
			const isActive = name === active;
			const card = strip.createDiv({ cls: 'ws-card ws-preset-card' + (isActive ? ' is-active' : '') });
			const use = card.createEl('button', { cls: 'ws-card-use', attr: { type: 'button', 'aria-label': 'Use the ' + name + ' bar', 'aria-pressed': isActive ? 'true' : 'false' } });
			if (isActive) setIcon(use.createSpan({ cls: 'ws-tick' }), 'check');
			this.presetDemo(use, snap);
			use.createSpan({ cls: 'ws-card-name', text: name });
			use.addEventListener('click', () => { void (async () => { await plugin.loadBarPreset(name); redisplay(); })(); });
			uses.push(use);
			// the code goes to the clipboard, and the icon says so for a moment;
			// where the clipboard is out of reach (some Electron/Wayland setups,
			// silently) a notice says that instead of a check over nothing
			const copy = this.action(card, 'copy', 'Copy its share code', () => { void (async () => {
				try { await navigator.clipboard.writeText(barPresetToCode(name, snap)); }
				catch (_) { wsCatch('presets: the clipboard', _); new Notice('The clipboard is out of reach here.'); return; }
				setIcon(copy, 'check');
				window.setTimeout(() => { setIcon(copy, 'copy'); }, 1500);
			})(); });
			this.twoTapDelete(card, 'Delete the ' + name + ' bar', () => { void (async () => { await plugin.deleteBarPreset(name); redisplay(); })(); });
		}
		this.rovingRow(strip, uses).picked(Math.max(0, names.indexOf(active)));
		// Save the bar as it is, import a code: a card that is one plain button,
		// on a line of their own under the bars
		const acts = box.createDiv({ cls: 'ws-cards ws-preset-acts' });
		const more = (icon: string, label: string, run: () => void) => {
			const b = acts.createEl('button', { cls: 'ws-card ws-card-more', attr: { type: 'button' } });
			setIcon(b.createSpan({ cls: 'ws-card-more-icon' }), icon);
			b.createSpan({ cls: 'ws-card-name', text: label });
			b.addEventListener('click', run);
			return b;
		};
		more('save', 'Save', () => {
			// a taken name warns once and keeps the prompt; OK again with the
			// same name replaces the bar
			let warned = '';
			new WsPrompt(this.app, 'Save this bar as', 'Preset name', async (name) => {
				if (!name) return false;
				if (name in library && warned !== name) { warned = name; return 'A preset named ' + name + ' exists. OK again to replace it.'; }
				await plugin.saveBarPreset(name);
				redisplay();
				return true;
			}).open();
		});
		more('download', 'Import', () => {
			new WsPrompt(this.app, 'Import a share code', 'Paste the code here', async (code) => {
				if (!code) return false;
				const added = await plugin.importBarPreset(code);
				if (added) { redisplay(); return true; }
				return code.startsWith(BAR_SHARE_VERSION + '|') ? 'The code is cut short.' : 'That is not a Word-Smith bar code.';
			}).open();
		});
	}

	// The demo: up to three small segments in the colors the bar's rows
	// name, in order — a palette number in the bar's own palette (dark or
	// light, as the window is), a theme surface as the theme paints it, the
	// Vim slot in its Normal color. A bar that names no color shows one plain
	// segment. Colors ride a custom property; the shape is the sheet's.
	presetDemo(parent: HTMLElement, snap: Record<string, unknown>) {
		const full = barPresetWithDefaults(snap);
		const dark = document.body.classList.contains('theme-dark');
		const rows = Array.isArray(full.statusRows) ? full.statusRows as { left?: string; center?: string; right?: string }[] : [];
		const text = rows.map((r) => [r.left, r.center, r.right].join(' ')).join(' ');
		const colors: string[] = [];
		const re = /:(bs|b\d|vim|\d)\b/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) && colors.length < 3) {
			const k = m[1].toLowerCase();
			let c = '';
			if (/^\d$/.test(k)) c = str(full[(dark ? 'powerlineColor' : 'powerlineColorLight') + k]);
			else if (k === 'vim') c = str(full[dark ? 'vimColorNormal' : 'vimColorNormalLight']);
			else {
				const chain = PL_THEME_BGS[k];
				if (chain) c = chain.reduceRight((acc, v) => 'var(' + v + (acc ? ', ' + acc : '') + ')', '');
			}
			if (c && colors.indexOf(c) === -1) colors.push(c);
		}
		if (!colors.length) colors.push('var(--background-modifier-border)');
		const demo = parent.createSpan({ cls: 'ws-preset-demo', attr: { 'aria-hidden': 'true' } });
		for (const c of colors) demo.createSpan({ cls: 'ws-preset-seg' }).setCssProps({ '--ws-seg': c });
	}

	// Which saved bar the settings ARE: the one whose every live key equals
	// them — read off the settings, as Cursor-Smith reads it, not off a name
	// remembered at load, which is gone after a reload and would stay after
	// an edit. Empty when the bar is nothing that was saved.
	presetInUse(): string {
		const s = bag(this.plugin.settings);
		const library = this.plugin.getBarPresets();
		for (const name of Object.keys(library)) {
			const p = barPresetWithDefaults(library[name]);
			if (BAR_KEYS_LIVE.every((k) => JSON.stringify(p[k]) === JSON.stringify(s[k]))) return name;
		}
		return '';
	}

	// ── THEMES ──────────────────────────────────────────────────────────────

	pageThemes(on: Pred): Page {
		const plugin = this.plugin;
		const s = plugin.settings;
		const themed: Pred = () => s.barThemeEnabled !== false;
		const schemeOn: Pred = () => themed() && !!s.barTheme && s.barTheme !== 'custom';
		const NEEDS_SCHEME = 'Needs a scheme; under Default there are no inks to derive from.';
		const csThere = () => { try { return !!(plugin.app.plugins && plugin.app.plugins.plugins && plugin.app.plugins.plugins['cursor-smith']); } catch { return false; } };
		// an option that needs a scheme is disabled, and says so, under Default
		const opt = (name: string, desc: string, key: Key, needsScheme: boolean): Def => ({
			name, desc: needsScheme && !schemeOn() ? NEEDS_SCHEME : desc,
			control: { type: 'toggle', key, disabled: needsScheme ? () => !schemeOn() : false },
			visible: themed,
		});
		const value = () => {
			if (!themed()) return 'Off';
			const t = s.barTheme && s.barTheme !== 'custom' ? plugin.barThemeById(s.barTheme) : null;
			const parts = [t ? t.name : 'Default'];
			if (schemeOn() && s.barThemeHeadings) parts.push('headings');
			if (schemeOn() && s.barThemeCode) parts.push('code');
			if (schemeOn() && s.barThemeMarkdown) parts.push('markdown');
			if (s.barThemeBorderless) parts.push('borderless');
			return parts.join(' · ');
		};
		// ONE SHELF, ONE RESET: the scheme worn in both modes, the set-aside
		// pills under it, the options.
		return this.page('Themes', 'palette', 'A workspace color scheme, dark and light.', [
			this.section('Themes', [
				{ name: 'Themes', desc: 'A color scheme for the whole workspace, dark and light.', control: { type: 'toggle', key: 'barThemeEnabled', defaultValue: true } },
				rendered({ name: 'Scheme', desc: 'Tap one to wear it. Drag to reorder; the x sets one aside.', render: (st) => this.renderThemeShelf(st), searchable: false, visible: themed }, ['barTheme', 'barThemeOrder', 'barThemeHidden']),
				this.subheadRow('Options'),
				opt('Colored headings', 'H1 to H6 take inks derived from the scheme’s accents.', 'barThemeHeadings', true),
				opt('Colored code', 'Code blocks sit on the scheme’s panel surface, with its inks.', 'barThemeCode', true),
				opt('Simplified theme', 'One wash for sidebars, header and title bar, dividers painted out.', 'barThemeSimplified', true),
				{ name: 'Checkbox shape', desc: 'Circle, square, retro or markdown; or your theme’s own.', control: { type: 'dropdown', key: 'barThemeCheckbox',
					options: { '': 'Theme’s own', circle: 'Circle', square: 'Square', retro: 'Retro', markdown: 'Markdown' } }, visible: themed },
				opt('Hide workspace borders', 'Empties the dividers between panes and the tab outlines. Works under Default too.', 'barThemeBorderless', false),
				opt('Colored markdown', 'Bold, italics, links and tags take the scheme’s inks.', 'barThemeMarkdown', true),
				{ name: 'Color the cursor',
					desc: csThere() ? 'Hands the scheme’s loudest ink to Cursor-Smith; its shape and effects stay yours.' : 'Needs the Cursor-Smith plugin, which isn’t installed.',
					control: { type: 'toggle', key: 'barThemeCursor' }, visible: themed },
				{ name: 'Color Vim modes',
					desc: csThere() ? 'Each Vim mode wears its own color: Insert green, Visual purple, Replace red.' : 'Needs the Cursor-Smith plugin, which isn’t installed.',
					control: { type: 'toggle', key: 'barThemeVim' }, visible: () => themed() && !!s.barThemeCursor },
			]),
		], value, on);
	}

	// The shelf: a card per scheme (Default first, always, and it neither
	// drags nor goes aside), the one in use ticked; the x sets one aside;
	// set-aside schemes come back from the pills under. The name alone: the
	// writer cut the swatches ("without those colored balls").
	renderThemeShelf(st: Setting) {
		const plugin = this.plugin;
		const box = this.block(st, 'ws-theme-shelf');
		const redisplay = () => this.update();
		const grid = box.createDiv({ cls: 'ws-cards' });
		const items = plugin.themesPickerItems();
		const uses: HTMLElement[] = [];
		items.forEach((item, sIdx: number) => {
			const isDefault = item.id === 'custom';
			const idx = sIdx - 1;
			const card = grid.createDiv({ cls: 'ws-card ws-theme-card' + (item.on ? ' is-active' : '') + (isDefault ? ' is-custom is-alone' : '') });
			if (!isDefault) card.setAttribute('draggable', 'true');
			card.addEventListener('dragstart', (e) => { if (e.dataTransfer) e.dataTransfer.setData('text/plain', item.id); card.addClass('is-dragging'); });
			card.addEventListener('dragend', () => card.removeClass('is-dragging'));
			card.addEventListener('dragover', (e) => { e.preventDefault(); card.addClass('is-dropzone'); });
			card.addEventListener('dragleave', () => card.removeClass('is-dropzone'));
			card.addEventListener('drop', (e) => { void (async () => {
				e.preventDefault();
				if (isDefault) return;
				const dragged = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
				if (!dragged || dragged === item.id || dragged === 'custom') return;
				plugin.barThemeMove(dragged, idx);
				await plugin.saveSettings();
				redisplay();
			})(); });
			const use = card.createEl('button', { cls: 'ws-card-use', attr: { type: 'button', 'aria-label': 'Use ' + item.label, 'aria-pressed': item.on ? 'true' : 'false', title: item.note } });
			if (item.on) setIcon(use.createSpan({ cls: 'ws-tick' }), 'check');
			use.createSpan({ cls: 'ws-card-name', text: item.label });
			if (!isDefault) this.themeInks(use, item.id);
			use.addEventListener('click', () => { void (async () => { await item.onClick(); redisplay(); })(); });
			uses.push(use);
			if (!isDefault) {
				this.action(card, 'x', 'Set ' + item.label + ' aside', (e) => { void (async () => { e.stopPropagation(); plugin.barThemeHide(item.id); await plugin.saveSettings(); redisplay(); })(); });
			}
		});
		this.rovingRow(grid, uses).picked(Math.max(0, items.findIndex((i) => i.on)));
		const hiddenIds = plugin.settings.barThemeHidden || [];
		if (hiddenIds.length) {
			box.createDiv({ cls: 'ws-set-label', text: 'Set aside' });
			const row = box.createDiv({ cls: 'ws-pills' });
			for (const id of hiddenIds) {
				const t = plugin.barThemeById(id);
				const chip = this.pill(row, t ? t.name : id, 'undo-2', { label: 'Put ' + (t ? t.name : id) + ' back on the shelf' });
				this.themeInks(chip, id);
				chip.addEventListener('click', () => { void (async () => { plugin.barThemeShow(id); await plugin.saveSettings(); redisplay(); })(); });
			}
		}
	}

	// THREE INKS AFTER A SCHEME'S NAME: the page, the side panels and the
	// accent of the half the workspace wears now, read off the same half
	// `barThemeVars` paints from. Colors go in as a custom property (the
	// sheet draws the square), never as a static style.
	themeInks(into: HTMLElement, id: string) {
		const t = this.plugin.barThemeById(id);
		if (!t || !this.plugin.barThemeHalf(t)) return;
		const inks = into.createSpan({ cls: 'ws-theme-inks', attr: { 'aria-hidden': 'true' } });
		const sq = [0, 1, 2].map(() => inks.createSpan({ cls: 'ws-theme-ink' }));
		// THE HALF THE WORKSPACE WEARS NOW, on every refresh: a dark/light
		// switch with the page open reaches the squares through `css-change`
		const paint = () => {
			const h = this.plugin.barThemeHalf(t);
			if (!h) return;
			[h.b1, h.b2, h.t4].forEach((c, i) => { if (sq[i].style.getPropertyValue('--ws-ink') !== c) sq[i].setCssProps({ '--ws-ink': c }); });
		};
		paint();
		this.onRefresh(paint);
	}

	// ── FOCUS ───────────────────────────────────────────────────────────────

	pageFocus(on: Pred): Page {
		const s = this.plugin.settings;
		const zen: Pred = () => !!s.zenEnabled;
		const box: Pred = () => !!s.enableLetterbox;
		const arrows: Pred = () => s.arrowCount > 0;
		const custom: Pred = () => !!s.letterboxCustomColors;
		const tw: Pred = () => !!s.enableTypewriter;
		const hem: Pred = () => !!s.hemingwayEnabled;
		// the pills wear the mode glyphs the menu and the bar wear (buildModeGlyph)
		const glyph = (kind: string) => (el: HTMLElement) => { el.appendChild(this.plugin.buildModeGlyph(kind)); };
		const RAIL: RailEntry[] = [
			{ key: 'zen', name: 'Zen', icon: 'eye-off', on: zen, draw: glyph('zen') },
			{ key: 'letterbox', name: 'Letter box', icon: 'rectangle-horizontal', on: box, draw: glyph('lb') },
			{ key: 'typewriter', name: 'Typewriter', icon: 'type', on: tw, draw: glyph('tw') },
			{ key: 'hemingway', name: 'Hemingway', icon: 'feather', on: hem, draw: glyph('hem') },
		];
		const value = () => { const names = RAIL.filter((e) => e.on && e.on()).map((e) => e.name); return names.length ? names.join(' · ') : 'Off'; };
		return this.page('Focus', 'eye', 'Zen, letter box, typewriter, Hemingway.', [
			this.section('Sections', [this.railRow('focus', RAIL)]),
			this.section('Zen', [
				{ name: 'Zen', desc: 'Clears the workspace down to the words until you leave.', control: { type: 'toggle', key: 'zenEnabled' } },
				this.alertRow('Panes, ribbon and title are hidden while Zen is on. Escape or the Powermenu brings them back.', zen),
				{ name: 'Full screen', desc: 'The window goes full screen with Zen.', control: { type: 'toggle', key: 'fullscreen' }, visible: zen },
				{ name: 'Match the title bar', desc: 'The title bar takes the page’s color.', control: { type: 'toggle', key: 'zenTitlebarMatch' }, visible: zen },
				{ name: 'Focused file mode', desc: 'Only the note you are in stays open.', control: { type: 'toggle', key: 'focusedFileMode' }, visible: zen },
				{ name: 'Hide properties', desc: 'Properties and frontmatter, in Zen.', control: { type: 'toggle', key: 'hideProperties' }, visible: zen },
				{ name: 'Hide the inline title', desc: 'The note’s title above the text.', control: { type: 'toggle', key: 'hideInlineTitle' }, visible: zen },
				{ name: 'Hide the native status bar', desc: 'Obsidian’s own status bar.', control: { type: 'toggle', key: 'hideStatusBar' }, visible: zen },
				{ name: 'Hide linked mentions', desc: 'The backlinks under the note.', control: { type: 'toggle', key: 'hideLinkedMentions' }, visible: zen },
				{ name: 'Hide the scroll bar', desc: 'The editor’s scroll bar.', control: { type: 'toggle', key: 'hideScrollBar' }, visible: zen },
				{ name: 'Hide the ribbon', desc: 'The column of icons at the left.', control: { type: 'toggle', key: 'hideRibbon' }, visible: zen },
				{ name: 'Hide the Powerline bar', desc: 'The bar too, in Zen.', control: { type: 'toggle', key: 'zenHideBar' }, visible: zen },
				{ name: 'Bring it back on hover', desc: 'Milliseconds it stays after the pointer leaves; 0 never brings it back.',
					control: { type: 'slider', key: 'barPeekMs', min: 0, max: 6000, step: 250 }, visible: all(zen, () => !!s.zenHideBar) },
				{ name: 'Breathing room', desc: 'Pixels the caret keeps clear of the bar and the letter box, in and out of Zen.',
					control: { type: 'slider', key: 'caretMarginPx', min: 0, max: 120, step: 2 }, visible: zen },
				{ name: 'Escape exits Zen', desc: 'One key out.', control: { type: 'toggle', key: 'zenEscExits' }, visible: zen },
				this.hotkeysRow(['toggle-zen']),
			], this.railed('focus', 'zen')),
			this.section('Letter box', [
				{ name: 'Letter box', desc: 'Dims the top and bottom of the screen so only your band stays lit.', control: { type: 'toggle', key: 'enableLetterbox' } },
				rendered({ name: 'Mask height', desc: 'In pixels; drag either edge on the page to set it too.', render: (st) => this.renderMaskHeight(st), visible: box }, ['letterboxPx']),
				{ name: 'Match the text width', desc: 'The band is as wide as the text.', control: { type: 'toggle', key: 'maskMatchText' }, visible: box },
				{ name: 'Include the editor’s padding', desc: 'Off hugs the words; on takes the page.', control: { type: 'toggle', key: 'maskMatchTextPadded' }, visible: all(box, () => !!s.maskMatchText) },
				{ name: 'Horizontal inset', desc: 'In pixels.', control: { type: 'slider', key: 'maskPaddingH', min: 0, max: 400, step: 10 }, visible: all(box, () => !s.maskMatchText) },
				rendered({ name: 'Arrows', desc: 'Arrows along the band’s edges, and how many.', render: (st) => this.renderArrows(st), visible: box }, ['arrowCount']),
				{ name: 'Arrow style', desc: 'The shape of the arrows.', control: { type: 'dropdown', key: 'arrowStyle', options: {
					'solid-triangle': 'Solid triangles', 'outline-triangle': 'Outline triangles', 'standard-arrow': 'Standard arrows',
					chevron: 'Chevrons', 'double-chevron': 'Double chevrons', custom: 'Custom characters' } }, visible: all(box, arrows) },
				{ name: 'Top character', desc: 'One or two characters.', control: { type: 'text', key: 'customArrowTop' }, visible: all(box, arrows, () => s.arrowStyle === 'custom') },
				{ name: 'Bottom character', desc: 'One or two characters.', control: { type: 'text', key: 'customArrowBottom' }, visible: all(box, arrows, () => s.arrowStyle === 'custom') },
				{ name: 'Arrow scale', desc: 'How big the arrows are.', control: { type: 'slider', key: 'arrowScale', min: 0.5, max: 3, step: 0.1 }, visible: all(box, arrows) },
				{ name: 'Cap the line ends', desc: 'An arrow at each end of the line.', control: { type: 'toggle', key: 'arrowLineEnds' }, visible: all(box, arrows) },
				{ name: 'Line style', desc: 'The line along each edge of the band.', control: { type: 'dropdown', key: 'separatorStyle', options: { none: 'None', solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double' } }, visible: box },
				{ name: 'Line weight', desc: 'In pixels.', control: { type: 'slider', key: 'separatorWeight', min: 1, max: 8, step: 1 }, visible: box },
				{ name: 'Custom colors', desc: 'Off, the arrows and lines borrow your theme’s text color.', control: { type: 'toggle', key: 'letterboxCustomColors' }, visible: box },
				{ name: 'Arrows, dark theme', desc: 'The arrows’ color under a dark theme.', control: { type: 'color', key: 'arrowDarkColor' }, visible: all(box, custom) },
				{ name: 'Arrows, light theme', desc: 'And under a light one.', control: { type: 'color', key: 'arrowLightColor' }, visible: all(box, custom) },
				{ name: 'Lines, dark theme', desc: 'The lines’ color under a dark theme.', control: { type: 'color', key: 'lineDarkColor' }, visible: all(box, custom) },
				{ name: 'Lines, light theme', desc: 'And under a light one.', control: { type: 'color', key: 'lineLightColor' }, visible: all(box, custom) },
				this.hotkeysRow(['toggle-letterbox']),
			], this.railed('focus', 'letterbox')),
			this.section('Typewriter', [
				{ name: 'Typewriter mode', desc: 'Keeps the line you are writing at one height; the page moves under the cursor.', control: { type: 'toggle', key: 'enableTypewriter' } },
				{ name: 'Rests at', desc: 'Percent of the editor’s height: 0 the top, 50 the middle, 100 the bottom.', control: { type: 'slider', key: 'typewriterAnchor', min: 0, max: 100, step: 5 }, visible: tw },
				{ name: 'Highlight current line', desc: 'A tint behind the line you are on.', control: { type: 'toggle', key: 'highlightCurrentLine' }, visible: tw },
				{ name: 'Highlight, dark theme', desc: 'The tint under a dark theme.', control: { type: 'color', key: 'lineHighlightDarkColor' }, visible: all(tw, () => !!s.highlightCurrentLine) },
				{ name: 'Highlight, light theme', desc: 'And under a light one.', control: { type: 'color', key: 'lineHighlightLightColor' }, visible: all(tw, () => !!s.highlightCurrentLine) },
				{ name: 'Highlight opacity', desc: 'How strong the tint is.', control: { type: 'slider', key: 'lineHighlightOpacity', min: 0.05, max: 1, step: 0.05 }, visible: all(tw, () => !!s.highlightCurrentLine) },
				{ name: 'Dim unfocused text', desc: 'Everything but the paragraph or sentence you are in fades.', control: { type: 'toggle', key: 'dimUnfocusedEnabled' }, visible: tw },
				{ name: 'Focus area', desc: 'What stays lit.', control: { type: 'dropdown', key: 'dimFocusMode', options: { paragraph: 'Paragraph', sentence: 'Sentence' } }, visible: all(tw, () => !!s.dimUnfocusedEnabled) },
				{ name: 'Dim opacity', desc: 'How far the rest fades.', control: { type: 'slider', key: 'dimOpacity', min: 0.05, max: 1, step: 0.05 }, visible: all(tw, () => !!s.dimUnfocusedEnabled) },
				this.hotkeysRow(['toggle-typewriter']),
			], this.railed('focus', 'typewriter')),
			this.section('Hemingway', [
				{ name: 'Hemingway mode', desc: 'Blocks the keys you would use to go back, so a draft can only move forward.', control: { type: 'toggle', key: 'hemingwayEnabled' } },
				this.alertRow('Backspace, undo and the arrow keys are blocked while you write. Not for you? Turn Hemingway mode off.', hem),
				{ name: 'Block backspace', desc: 'No deleting backwards.', control: { type: 'toggle', key: 'hemBlockBackspace' }, visible: hem },
				{ name: 'Block delete', desc: 'No deleting forwards.', control: { type: 'toggle', key: 'hemBlockDelete' }, visible: hem },
				{ name: 'Block undo and redo', desc: 'What is written stays written.', control: { type: 'toggle', key: 'hemBlockUndo' }, visible: hem },
				{ name: 'Block cut', desc: 'No cutting text out.', control: { type: 'toggle', key: 'hemBlockCut' }, visible: hem },
				{ name: 'Block paste', desc: 'No pasting text in.', control: { type: 'toggle', key: 'hemBlockPaste' }, visible: hem },
				{ name: 'Block arrow keys', desc: 'The caret stays where the writing is.', control: { type: 'toggle', key: 'hemBlockArrows' }, visible: hem },
				{ name: 'Block jump keys', desc: 'Home, End, Page Up and Page Down.', control: { type: 'toggle', key: 'hemBlockJumpKeys' }, visible: hem },
				{ name: 'Block select all', desc: 'No selecting everything.', control: { type: 'toggle', key: 'hemBlockSelectAll' }, visible: hem },
				{ name: 'Block mouse', desc: 'Clicking, right-clicking and dragging in the note.', control: { type: 'toggle', key: 'hemBlockMouse' }, visible: hem },
				{ name: 'Flash when blocked', desc: 'Where the flash shows when a key is refused.', control: { type: 'dropdown', key: 'hemFlashTarget',
					options: { none: 'Nowhere', icon: 'The modes button', retrobar: 'The Powerline bar', screen: 'The screen', both: 'Screen and bar' } }, visible: hem },
				this.hotkeysRow(['toggle-hemingway']),
			], this.railed('focus', 'hemingway')),
		], value, on);
	}

	// the mask's height is a number in px, or, from before it was, a count of
	// lines, which the slider shows converted until the writer moves it
	renderMaskHeight(st: Setting) {
		const s = this.plugin.settings;
		st.addSlider((sl) => sl.setLimits(WS_MASK_MIN_PX, 400, 2)
			.setValue(s.letterboxPx != null ? Math.round(s.letterboxPx) : (s.letterboxLines || 8) * 26)
			.onChange((v) => { void (async () => { s.letterboxPx = v; await this.plugin.saveSettings(); })(); }));
	}

	// "arrows" is the count being more than none: a switch and the count on
	// one row, the count remembered on the tab for the way back
	renderArrows(st: Setting) {
		const s = this.plugin.settings;
		let countInput: HTMLInputElement | null = null;
		st.addToggle((t) => t.setValue(s.arrowCount > 0).onChange((v) => { void (async () => {
			if (!v) this._lastArrowCount = s.arrowCount || 5;
			s.arrowCount = v ? (this._lastArrowCount || 5) : 0;
			if (countInput) countInput.value = String(s.arrowCount);
			await this.plugin.saveSettings();
			this.refreshDomState();
		})(); }));
		st.addText((t) => {
			countInput = t.inputEl;
			t.inputEl.type = 'number';
			t.inputEl.min = '0';
			t.inputEl.max = '10';
			t.inputEl.addClass('ws-set-num');
			t.inputEl.setAttribute('aria-label', 'How many arrows');
			t.setValue(String(s.arrowCount));
			t.onChange((v) => { void (async () => {
				const n = parseInt(v, 10);
				if (!isFinite(n) || n < 0 || n > 10) return;
				s.arrowCount = n;
				await this.plugin.saveSettings();
				this.refreshDomState();
			})(); });
		});
	}

	// ── PROSE ───────────────────────────────────────────────────────────────

	pageProse(on: Pred): Page {
		const s = this.plugin.settings;
		const pos: Pred = () => !!s.posEnabled;
		const ck: Pred = () => !!s.checksEnabled;
		// the pills wear the menu's own icons where the menu has the row
		const menuIcon = (id: string) => (el: HTMLElement) => { this.plugin.menuDrawIcon(el, id); };
		const RAIL: RailEntry[] = [
			{ key: 'syntax', name: 'Syntax', icon: 'code', on: pos, draw: menuIcon('syntax') },
			{ key: 'checks', name: 'Checks', icon: 'pen-tool', on: ck, draw: menuIcon('prose') },
		];
		const value = () => { const names = RAIL.filter((e) => e.on && e.on()).map((e) => e.name); return names.length ? names.join(' · ') : 'Off'; };
		// a category is a color and a switch on one row
		const cat = (name: string, desc: string, onKey: Key, colorKey: Key, visible: Pred): Def => rendered({
			name, desc, visible, render: (st) => this.renderCategory(st, onKey, colorKey),
		}, [onKey, colorKey]);
		return this.page('Prose', 'pen-tool', 'Parts of speech, and the checks.', [
			// ABOVE THE TABS: the one switch both sections obey sits over the rail,
			// not inside Syntax; no reset link for a lone switch
			this.section('Sections', [
				// one card, first, for both sections
				this.noteRow('No AI, no API, nothing leaves your vault: word lists and regex rules. A mark is a nudge, not a verdict.'),
				{ name: 'Skip code and math', desc: 'Leaves code, frontmatter and math alone, for the syntax and the checks.', control: { type: 'toggle', key: 'syntaxSkipCode' } },
				this.railRow('prose', RAIL),
			], undefined, false),
			this.section('Syntax', [
				{ name: 'Syntax highlight', desc: 'Colors parts of speech as you write. Fully local.', control: { type: 'toggle', key: 'posEnabled' } },
				{ name: 'Display style', desc: 'How a part of speech is marked.', control: { type: 'dropdown', key: 'syntaxStyle', options: { text: 'Colored text', highlight: 'Highlight', line: 'Underline' } }, visible: pos },
				cat('Nouns', 'Nouns and pronouns.', 'posNoun', 'posNounColor', pos),
				cat('Verbs', 'Verbs, auxiliaries and modals.', 'posVerb', 'posVerbColor', pos),
				cat('Adverbs', 'All adverbs, including not and very.', 'posAdverb', 'posAdverbColor', pos),
				cat('Adjectives', 'Adjectives; articles are left out.', 'posAdjective', 'posAdjectiveColor', pos),
				cat('Conjunctions', 'Conjunctions and prepositions.', 'posConjunction', 'posConjunctionColor', pos),
				{ name: 'Mute everything else', desc: 'Fades what you didn’t tick.', control: { type: 'toggle', key: 'posDimOthers' }, visible: pos },
				this.hotkeysRow(['toggle-syntax']),
			], this.railed('prose', 'syntax')),
			this.section('Checks', [
				{ name: 'Prose checks', desc: 'Things worth a second look, not mistakes. Fully local.', control: { type: 'toggle', key: 'checksEnabled' } },
				{ name: 'Display style', desc: 'How a finding is marked.', control: { type: 'dropdown', key: 'checkStyle', options: { line: 'Underline', highlight: 'Highlight', text: 'Colored text' } }, visible: ck },
				cat('Filler words', 'Words like very, really, basically, kind of.', 'checkFiller', 'checkFillerColor', ck),
				{ name: 'Also flag vague quantifiers', desc: 'Many, most, some, often. Stricter, and it flags more.', control: { type: 'toggle', key: 'checkFillerSoft' }, visible: all(ck, () => !!s.checkFiller) },
				cat('Passive voice', 'Was written, is being considered.', 'checkPassive', 'checkPassiveColor', ck),
				cat('Loose pronouns', 'A sentence opening with an unclear it or this.', 'checkPronoun', 'checkPronounColor', ck),
				cat('Repetition radar', 'The same uncommon word twice, close together.', 'checkRepetition', 'checkRepetitionColor', ck),
				{ name: 'Window', desc: 'How far apart two words can be and still count as a repeat.', control: { type: 'slider', key: 'repetitionWindow', min: 15, max: 150, step: 5 }, visible: all(ck, () => !!s.checkRepetition) },
				{ name: 'Minimum length', desc: 'Skips words shorter than this.', control: { type: 'slider', key: 'repetitionMinLength', min: 3, max: 10, step: 1 }, visible: all(ck, () => !!s.checkRepetition) },
				cat('Commonly misused', 'Affect and effect, its and it’s, fewer and less.', 'checkMisused', 'checkMisusedColor', ck),
				cat('Lexical illusions', 'The same word twice in a row.', 'checkIllusion', 'checkIllusionColor', ck),
				cat('Dialogue focus', 'Everything inside quotes.', 'checkDialogue', 'checkDialogueColor', ck),
				rendered({ name: 'Sentence rhythm', desc: 'Shades each sentence by how hard it reads: two tints, and the switch.', render: (st) => this.renderRhythm(st), visible: ck }, ['checkRhythm', 'checkRhythmHardColor', 'checkRhythmVeryHardColor']),
				{ name: 'Hard above grade', desc: 'Flesch-Kincaid grade for the first tint.', control: { type: 'slider', key: 'checkRhythmHardGrade', min: 6, max: 16, step: 1 }, visible: all(ck, () => !!s.checkRhythm) },
				{ name: 'Very hard above', desc: 'And for the second.', control: { type: 'slider', key: 'checkRhythmVeryHardGrade', min: 8, max: 22, step: 1 }, visible: all(ck, () => !!s.checkRhythm) },
				{ name: 'Mute everything else', desc: 'Fades what you didn’t tick, so the marks stand out.', control: { type: 'toggle', key: 'checkDimOthers' }, visible: ck },
				this.hotkeysRow(['toggle-prose-checks']),
			], this.railed('prose', 'checks')),
		], value, on);
	}

	// ── TEXT ────────────────────────────────────────────────────────────────
	// Markers, Typography and Layout.
	pageText(on: Pred): Page {
		const s = this.plugin.settings;
		const marks: Pred = () => !!s.markersEnabled;
		const ty: Pred = () => !!s.typographyEnabled;
		const quotes: Pred = all(ty, () => !!s.typoSmartQuotes, () => !!s.typoCustomQuotes);
		const text: Pred = () => !!s.miscEnabled;
		const menuIcon = (id: string) => (el: HTMLElement) => { this.plugin.menuDrawIcon(el, id); };
		const RAIL: RailEntry[] = [
			{ key: 'markers', name: 'Markers', icon: 'pilcrow', on: marks, draw: menuIcon('markers') },
			{ key: 'typography', name: 'Typography', icon: 'quote', on: ty },
			{ key: 'layout', name: 'Layout', icon: 'align-left', on: text },
		];
		const value = () => { const names = RAIL.filter((e) => e.on && e.on()).map((e) => e.name); return names.length ? names.join(' · ') : 'Off'; };
		return this.page('Text', 'type', 'Hidden markers, typography, layout.', [
			this.section('Sections', [this.railRow('text', RAIL)]),
			this.section('Markers', [
				{ name: 'Show hidden markers', desc: 'Draws the characters you cannot normally see. Your text is untouched.', control: { type: 'toggle', key: 'markersEnabled' } },
				{ name: 'Tabs', desc: 'Shown as →', control: { type: 'toggle', key: 'markTabs' }, visible: marks },
				{ name: 'Spaces', desc: 'Shown as ·', control: { type: 'toggle', key: 'markSpaces' }, visible: marks },
				{ name: 'End of lines', desc: 'Shown as ↵', control: { type: 'toggle', key: 'markEndOfLines' }, visible: marks },
				{ name: 'Paragraphs', desc: 'Shown as ¶', control: { type: 'toggle', key: 'markParagraphs' }, visible: marks },
				{ name: 'End of buffer', desc: 'Tildes down the empty space after your last line.', control: { type: 'toggle', key: 'markBlankLines' }, visible: marks },
			], this.railed('text', 'markers')),
			this.section('Typography', [
				{ name: 'Typography', desc: 'Turns what you type into the proper characters as you go.', control: { type: 'toggle', key: 'typographyEnabled' } },
				this.alertRow('Quotes, dashes and arrows change as you type. Not for you? Turn Typography off.', ty),
				{ name: 'Curly quotes', desc: 'Straight quotes turn curly as you type.', control: { type: 'toggle', key: 'typoSmartQuotes' }, visible: ty },
				{ name: 'Choose the characters', desc: 'Your own quote marks instead of the usual ones.', control: { type: 'toggle', key: 'typoCustomQuotes' }, visible: all(ty, () => !!s.typoSmartQuotes) },
				{ name: 'Open double', desc: 'Replaces " at the start of a quotation.', control: { type: 'text', key: 'typoOpenDouble' }, visible: quotes },
				{ name: 'Close double', desc: 'Replaces " at the end.', control: { type: 'text', key: 'typoCloseDouble' }, visible: quotes },
				{ name: 'Open single', desc: 'Replaces the straight single quote at the start.', control: { type: 'text', key: 'typoOpenSingle' }, visible: quotes },
				{ name: 'Close single', desc: 'And at the end.', control: { type: 'text', key: 'typoCloseSingle' }, visible: quotes },
				{ name: 'Apostrophe', desc: 'Used mid-word, where it is not a quote at all.', control: { type: 'text', key: 'typoApostrophe' }, visible: quotes },
				{ name: 'Ellipsis', desc: '... becomes …', control: { type: 'toggle', key: 'typoEllipsis' }, visible: ty },
				{ name: 'Dashes', desc: '-- becomes –, --- becomes —', control: { type: 'toggle', key: 'typoDashes' }, visible: ty },
				{ name: 'Arrows', desc: '-> →, <- ←, => ⇒', control: { type: 'toggle', key: 'typoArrows' }, visible: ty },
				{ name: 'Comparisons', desc: '<= ≤, >= ≥, /= ≠', control: { type: 'toggle', key: 'typoComparisons' }, visible: ty },
				{ name: 'Guillemets', desc: '<< « and >> »', control: { type: 'toggle', key: 'typoGuillemets' }, visible: ty },
				{ name: 'Fractions', desc: '1/2 ½, 3/4 ¾, and the rest.', control: { type: 'toggle', key: 'typoFractions' }, visible: ty },
			], this.railed('text', 'typography')),
			this.section('Layout', [
				{ name: 'Text options', desc: 'Margins, indents, line length and spacing, justification.', control: { type: 'toggle', key: 'miscEnabled' } },
				{ name: 'Horizontal padding', desc: 'Pixels between the text and the pane’s edges, in and out of Zen.', control: { type: 'slider', key: 'editorPaddingH', min: 0, max: 400, step: 10 }, visible: text },
				{ name: 'Paragraph indent', desc: 'The first line of each paragraph set in, as a book does. Reading view only.', control: { type: 'toggle', key: 'enableParagraphIndent' }, visible: text },
				{ name: 'Indent trigger', desc: 'What starts a paragraph in your writing: a blank line, or every new line.',
					control: { type: 'dropdown', key: 'paragraphIndentMode', options: { double: 'A blank line (double Enter)', single: 'Every line (single Enter)' } }, visible: all(text, () => !!s.enableParagraphIndent) },
				{ name: 'Indent size', desc: 'In em.', control: { type: 'slider', key: 'paragraphIndentEm', min: 0.5, max: 8, step: 0.5 }, visible: all(text, () => !!s.enableParagraphIndent) },
				{ name: 'Limit line length', desc: 'Wraps the text at a number of characters.', control: { type: 'toggle', key: 'limitLineLength' }, visible: text },
				{ name: 'Characters per line', desc: '20 to 200; 64 suits prose.', control: { type: 'number', key: 'maxLineChars', min: 20, max: 200, step: 1, validate: between(20, 200) }, visible: all(text, () => !!s.limitLineLength) },
				{ name: 'Line spacing', desc: '0.8 to 4.', control: { type: 'number', key: 'lineSpacing', min: 0.8, max: 4, step: 0.1, validate: between(0.8, 4) }, visible: text },
				{ name: 'Justify text', desc: 'Straight edges on both sides.', control: { type: 'toggle', key: 'justifyText' }, visible: text },
				{ name: 'Paragraph numbers', desc: 'Numbers in the left margin, on prose paragraphs only; in reading view too.', control: { type: 'toggle', key: 'paragraphNumbers' }, visible: text },
			], this.railed('text', 'layout')),
		], value, on);
	}

	renderCategory(st: Setting, onKey: Key, colorKey: Key) {
		const s = bag(this.plugin.settings);
		this.swatchRow(st);
		st.addColorPicker((cp) => cp.setValue(str(s[colorKey]))
			.onChange((v) => { void (async () => { s[colorKey] = v; await this.plugin.saveSettings(); })(); }));
		st.addToggle((t) => t.setValue(!!s[onKey])
			.onChange((v) => { void (async () => { s[onKey] = v; await this.plugin.saveSettings(); this.refreshDomState(); })(); }));
	}

	renderRhythm(st: Setting) {
		const s = this.plugin.settings;
		this.swatchRow(st);
		st.addColorPicker((cp) => cp.setValue(s.checkRhythmHardColor).onChange((v) => { void (async () => { s.checkRhythmHardColor = v; await this.plugin.saveSettings(); })(); }));
		st.addColorPicker((cp) => cp.setValue(s.checkRhythmVeryHardColor).onChange((v) => { void (async () => { s.checkRhythmVeryHardColor = v; await this.plugin.saveSettings(); })(); }));
		st.addToggle((t) => t.setValue(!!s.checkRhythm).onChange((v) => { void (async () => { s.checkRhythm = v; await this.plugin.saveSettings(); this.refreshDomState(); })(); }));
	}

	// ── MANUSCRIPT ──────────────────────────────────────────────────────────

	pageManuscript(on: Pred): Page {
		const plugin = this.plugin;
		const s = plugin.settings;
		const org: Pred = () => s.organizerOn !== false;
		const flags: Pred = () => org() && plugin.flagCount() > 0;
		const hist: Pred = () => !!s.historyTracking;
		const dateOptions = () => {
			const out: Record<string, string> = {};
			for (const id of ['human', 'iso', 'dmy', 'mdy']) out[id] = plugin.dateText(1999, 0, 22, null, null, id);
			return out;
		};
		const RAIL: RailEntry[] = [
			{ key: 'organizer', name: 'Organizer', icon: 'list-tree', on: org, draw: (el) => { plugin.menuDrawIcon(el, 'organizer'); } },
			{ key: 'tree', name: 'File tree', icon: 'folder-tree', on: () => !!(s.enableFileTreeCounts || s.fileTreeFlags || s.fileTreeTasks || s.fileTreeFolderIcons || s.treeOrder || s.enableOutlineCounts) },
			{ key: 'history', name: 'History', icon: 'history', on: hist, draw: (el) => { plugin.menuDrawIcon(el, 'history'); } },
		];
		const value = () => {
			const parts: string[] = [];
			if (org()) parts.push('Organizer');
			const n = plugin.flagCount();
			if (org() && n) parts.push(n + (n === 1 ? ' flag' : ' flags'));
			if (hist()) parts.push('History');
			return parts.length ? parts.join(' · ') : 'Off';
		};
		return this.page('Manuscript', 'book-open', 'The Organizer, the file tree, the history.', [
			this.section('Sections', [this.railRow('manuscript', RAIL)]),
			this.section('Organizer', [
				{ name: 'Organizer', desc: 'Off, the window is hidden and its file is never written.', control: { type: 'toggle', key: 'organizerOn', defaultValue: true } },
				{ name: 'Target column shows', desc: 'Words and target, or a percentage.', control: { type: 'dropdown', key: 'orgTargetShow', options: { ratio: 'Words and target (2,145/5,000)', percent: 'Percentage (43%)' } }, visible: org },
				{ name: 'Folder icons', desc: 'A glyph beside each folder name in the window.', control: { type: 'toggle', key: 'orgFolderIcons' }, visible: org },
				// the sample is a real render, not a hand-typed example: a second
				// writer of the format would drift from `dateText` and lie quietly
				{ name: 'Date format', desc: 'For every date the Organizer shows. A file time reads: ' + plugin.orgStamp(Date.UTC(1999, 0, 22, 9, 30)),
					control: { type: 'dropdown', key: 'organizerDateFormat', defaultValue: 'human', options: dateOptions() }, visible: org },
				rendered({ name: 'Number of flags', desc: '',
					render: (st) => this.renderFlagCount(st), visible: org }, ['flagCount']),
				...this.flagRows(flags),
				// two cards at the foot: what the window can do that no control on this
				// page says — the bulk edit (desktop only) and the zoom (Ctrl and the
				// wheel; two fingers on a phone)
				this.noteRow('Ctrl-click or Shift-click picks several notes; a flag, target or property set on one lands on all (desktop).', org),
				this.noteRow('Ctrl + scroll zooms the window (Cmd on a Mac); on a phone, pinch with two fingers.', org),
			], this.railed('manuscript', 'organizer')),
			this.section('File tree', [
				{ name: 'Word counts', desc: 'Next to each note, added up for folders.', control: { type: 'toggle', key: 'enableFileTreeCounts' } },
				{ name: 'Flags', desc: 'A tiny flag on anything flagged in the Organizer.', control: { type: 'toggle', key: 'fileTreeFlags' } },
				{ name: 'Tasks left', desc: 'Unticked boxes beside the count; folders sum their children.', control: { type: 'toggle', key: 'fileTreeTasks' } },
				{ name: 'Folder icons', desc: 'A glyph beside each folder name.', control: { type: 'toggle', key: 'fileTreeFolderIcons' } },
				this.noteRow('Right-click a folder in the file tree to give it a color.', () => !!s.fileTreeFolderIcons),
				{ name: 'Custom order', desc: 'The Organizer’s order in the file tree; off, Obsidian’s sort.', control: { type: 'toggle', key: 'treeOrder' } },
				{ name: 'Outline counts', desc: 'Next to each heading in the outline.', control: { type: 'toggle', key: 'enableOutlineCounts' } },
			], this.railed('manuscript', 'tree')),
			this.section('History', [
				this.buttonRow('Writing history', 'Day by day, month by month, or year by year.', 'Open', () => { void this.plugin.openHistoryModal(); }),
				{ name: 'Track writing history', desc: 'Counts only, never your words; wherever Word-Smith applies.', control: { type: 'toggle', key: 'historyTracking' } },
				{ name: 'Remember which notes', desc: 'A rename or a move takes its history along.', control: { type: 'toggle', key: 'historyPerFile' }, visible: hist },
				rendered({ name: 'Never counted', desc: 'Folders and notes left out of the history and every folder total.', render: (st) => this.renderPaths(st, 'countExclude', 'Add a folder or note', 'Never count…', false), visible: hist }, ['countExclude']),
				{ name: 'Delete all history', desc: 'Every day on record. No second copy, no undo.', render: (st) => this.renderHistoryDelete(st), visible: hist },
				this.hotkeysRow(['open-history']),
			], this.railed('manuscript', 'history')),
		], value, on);
	}

	// the count is a number in the settings; a dropdown's value is a string,
	// so the row is drawn by hand and converts
	renderFlagCount(st: Setting) {
		st.addDropdown((d) => {
			d.addOption('0', 'None');
			for (let i = 1; i <= WS_STATE_IDS.length; i++) d.addOption(String(i), i === 1 ? '1 flag' : i + ' flags');
			d.setValue(String(this.plugin.flagCount()));
			d.onChange((v) => { void (async () => {
				this.plugin.settings.flagCount = Number(v);
				await this.plugin.saveSettings();
				this.update();   // the flag rows come and go with the count
			})(); });
		});
	}

	flagRows(visible: Pred): Def[] {
		const plugin = this.plugin;
		const count = plugin.flagCount();
		const defs = plugin.flagDefs();
		const rows: Def[] = [];
		for (let i = 0; i < count; i++) {
			const f = defs[i];
			rows.push(rendered({
				name: 'Flag ' + (i + 1), desc: '', visible, searchable: false,
				// an ordinary row: the name and its line at the left, the controls at
				// the right like every other row's; the glyph leads the controls as
				// their preview
				render: (st) => {
					st.settingEl.addClass('ws-flagrow');
					const icon = st.controlEl.createSpan({ cls: 'ws-flagrow-icon' });
					wsSvgInto(icon, wsFlagSvg(f.id, 13));
					const write = async (patch: Record<string, string>) => {
						const all = plugin.flagDefs().map((x) => Object.assign({}, x));
						Object.assign(all.filter((x) => x.id === f.id)[0], patch);
						plugin.settings.flags = all;
						await plugin.saveSettings();
					};
					st.addText((t) => t.setPlaceholder(f.id).setValue(f.label).onChange((v) => { void write({ label: String(v || '').trim() || f.id }); }));
					st.addDropdown((d) => {
						for (const sh of WS_FLAG_SHAPES) d.addOption(sh.id, sh.label);
						d.setValue(f.shape);
						d.onChange((v) => { void (async () => { await write({ shape: v }); this.update(); })(); });
					});
					this.swatchRow(st);
					st.addColorPicker((cp) => cp.setValue(f.light).onChange((v) => { void write({ light: v }); }));
					st.addColorPicker((cp) => cp.setValue(f.dark).onChange((v) => { void write({ dark: v }); }));
				},
			}, ['flags']));
		}
		return rows;
	}

	// the delete is two taps, like every delete here
	renderHistoryDelete(st: Setting) {
		this.twoTapButton(st, 'Delete', () => { void (async () => {
			await this.plugin.historyClear();
			new Notice('Word-Smith: writing history deleted.');
			this.update();
		})(); });
	}

	// ── NAVIGATION ──────────────────────────────────────────────────────────

	pageNavigation(on: Pred): Page {
		const plugin = this.plugin;
		const s = plugin.settings;
		const value = () => {
			const parts: string[] = [];
			if (s.quickExplorer || s.quickOutline || s.quickCycle) parts.push('Quick panels');
			if (s.vimSoftWrapMotion) parts.push('Vim motions');
			return parts.length ? parts.join(' · ') : 'Off';
		};
		return this.page('Navigation', 'compass', 'Quick panels and Vim motions.', [
			this.section('Quick panels', [
				this.subheadRow('Quick panels'),
				{ name: 'Quick file explorer', desc: 'A command that opens the file explorer and focuses it.', control: { type: 'toggle', key: 'quickExplorer' } },
				{ name: 'Quick outline', desc: 'And one for the outline.', control: { type: 'toggle', key: 'quickOutline' } },
				{ name: 'Quick cycle', desc: 'Four commands for directional jumps; bind them to Alt and the arrows.', control: { type: 'toggle', key: 'quickCycle' } },
				{ name: 'Close a sidebar when you leave it', desc: 'Only when you move out with a direction key, never when you pick something.', control: { type: 'toggle', key: 'quickCycleCloseOnLeave' }, visible: () => !!s.quickCycle },
				// under Quick panels, not under Vim, and only what is ticked: each line
				// behind its switch
				this.hotkeysRow([
					{ id: 'quick-file-explorer', on: () => !!s.quickExplorer },
					{ id: 'quick-outline', on: () => !!s.quickOutline },
					{ id: 'quick-cycle-left', on: () => !!s.quickCycle },
					{ id: 'quick-cycle-right', on: () => !!s.quickCycle },
					{ id: 'quick-cycle-up', on: () => !!s.quickCycle },
					{ id: 'quick-cycle-down', on: () => !!s.quickCycle },
				]),
			]),
			this.section('Vim', [
				this.subheadRow('Vim'),
				{ name: 'Motions follow wrapped lines', desc: 'Maps j, k, 0 and $ to their g forms. Needs Obsidian’s Vim key bindings on.', control: { type: 'toggle', key: 'vimSoftWrapMotion' } },
				this.alertRow(plugin.vimApi() ? 'j and k now move by screen line, not by paragraph.' : 'This needs Vim key bindings on in Settings → Editor. Reopen this page after.', () => !!s.vimSoftWrapMotion),
			]),
		], value, on);
	}

	// ── VAULT ───────────────────────────────────────────────────────────────

	pageVault(on: Pred): Page {
		const plugin = this.plugin;
		const s = plugin.settings;
		// READ WHEN DRAWN, AND AGAIN ON EVERY REFRESH: the definitions are asked
		// before the vault has listed its files and before the history has
		// located its store, and a path decided then is wrong for the session.
		const fileRow = (name: string, at: () => string | null, note: string): Render => ({
			name, desc: note,
			render: (st) => {
				const paint = () => {
					const p = at();
					const exists = !!(p && plugin.app.vault.getAbstractFileByPath(p));
					const text = (exists ? 'At ' + p + '. ' : 'Not made yet. ') + note;
					if (st.descEl.textContent !== text) st.setDesc(text);
				};
				paint();
				this.onRefresh(paint);
			},
		});
		return this.page('Vault', 'vault', 'Where it applies, settings as text, a repair, the files kept.', [
			this.scopeSection(),
			this.section('Your settings', [
				this.subheadRow('Your settings'),
				{ name: 'As text', desc: 'Copy every setting as JSON, paste a copy back, or undo the last paste or reset.', render: (st) => this.renderSettingsText(st) },
				this.buttonRow('Repair the display', 'Draws every surface again from the settings as they are.', 'Repair', () => { plugin.repairDisplay(); new Notice('Word-Smith: repaired.', 4000); }),
				{ name: 'Keep a copy of my settings in the vault', desc: 'A readable copy, read back only after a reinstall. Editing it changes nothing.',
					control: { type: 'toggle', key: 'settingsMirror', defaultValue: true } },
				// no hotkeys card here: the four commands stay under Settings → Hotkeys
			], undefined, false),
			this.section('Files', [
				this.subheadRow('The files Word-Smith keeps'),
				fileRow('Custom order file', () => plugin.structurePathNow(), 'Custom order, flags, targets, ticks, colors, columns, and the details of files that are not notes.'),
				fileRow('Settings copy file', () => s.settingsMirror !== false ? plugin.settingsMirrorPathFor() : null, 'Machine settings and other vaults’ paths are skipped on restore.'),
				fileRow('History file', () => plugin.historyStorePath(), 'Every day you have written; the only copy.'),
			]),
			this.section('Notes', [
				this.subheadRow('Good to know'),
				{ name: 'Read your book back', desc: 'In the Export pane, press Expand and click a paragraph: its note opens beside the reader, caret on it.', render: (st) => this.infoInto(st) },
				{ name: 'More fonts', desc: 'Obsidian’s own font list; add one under Settings → Appearance → Text font.', render: (st) => this.infoInto(st) },
				{ name: 'Frontmatter overrides', desc: 'A note’s frontmatter overrides these settings, just for that note.', render: (st) => { this.infoInto(st); this.renderFrontmatterHelp(st); } },
			]),
		], () => {
			// the scope first, since it is the page's first section
			const n = Array.isArray(s.scopePaths) ? s.scopePaths.length : 0;
			const scope = !n ? 'Everywhere' : (s.scopeMode === 'exclude' ? 'Everywhere except ' : 'Only ') + n + (n === 1 ? ' path' : ' paths');
			return scope + ' · ' + (s.settingsMirror !== false ? 'copy in vault' : 'no copy in vault');
		}, on);
	}

	renderSettingsText(st: Setting) {
		const plugin = this.plugin;
		st.addButton((b) => b.setButtonText('Copy').onClick(() => { void (async () => {
			try { await navigator.clipboard.writeText(plugin.settingsCopyText()); new Notice('Word-Smith: settings copied.', 4000); }
			catch { new Notice('Word-Smith: could not reach the clipboard.', 6000); }
		})(); }));
		st.addButton((b) => b.setButtonText('Paste').onClick(() => { void (async () => {
			let text = '';
			try { text = await navigator.clipboard.readText(); }
			catch { new Notice('Word-Smith: could not read the clipboard.', 6000); return; }
			const r = await plugin.settingsPasteText(text);
			if (r.error !== undefined) { new Notice('Word-Smith: ' + r.error, 8000); return; }
			new Notice('Word-Smith: ' + r.applied + ' setting' + (r.applied === 1 ? '' : 's') + ' pasted'
				+ (r.repaired.length ? ', ' + r.repaired.length + ' reset to the default (' + r.repaired.join(', ') + ')' : '')
				+ '. Undo is beside this button.', 8000);
			this.update();
		})(); }));
		st.addButton((b) => b.setButtonText('Undo').setDisabled(!plugin._settingsUndo).onClick(() => { void (async () => {
			const r = await plugin.settingsUndoPaste();
			new Notice('Word-Smith: ' + (r.error || 'the previous settings are back.'), 6000);
			this.update();
		})(); }));
	}

	// IN THE CARD'S OWN COLUMN, under the description: the row is the info
	// card the two above it are (the glyph at the left, the words beside it),
	// and the block sits with the words rather than in the control area the
	// card hides.
	renderFrontmatterHelp(st: Setting) {
		st.infoEl.createEl('pre', {
			cls: 'ws-fm-block',
			text: 'wordsmith: off       the plugin does nothing in this note\n'
				+ 'ws-zen: true         override a mode for this note only\n'
				+ 'ws-typewriter: false\n'
				+ 'ws-hemingway: true\n'
				+ 'ws-syntax: true      the word classes, the prose checks\n'
				+ 'ws-checks: false\n'
				+ 'ws-typography: false',
		});
	}
}

// WHAT A KEY'S CHANGE DOES BESIDES SAVING: the rows' old callbacks, by key.
// Run before the save; `saveSettings` refreshes every surface after it, so a
// key with no entry here needs none.
const AFTER: Record<string, (tab: WordSmithSettingTab, value: unknown) => void | Promise<void>> = {
	pluginEnabled: (tab) => { tab.update(); },   // the tree: every page comes or goes
	zenEnabled: (tab, v) => { tab.plugin.settings.zenMode = !!v; },
	enableRetroStatus: (tab) => { tab.plugin.updateStatusBar(); tab.plugin.updateRetroStatusBar(); },
	retroBarOnPhone: (tab) => { tab.plugin.updateStatusBar(); tab.plugin.updateRetroStatusBar(); },
	// both application sites restamped now: the var reference and the inline size the fit pass pins
	statusBarFontFollowNote: (tab) => { tab.plugin.applyCssVariables(); tab.plugin.fitStatusBarText(); },
	statusBarUiFont: (tab) => { tab.plugin.applyBodyClasses(); tab.plugin.fitStatusBarText(); },   // the class, then the fit at the new face's widths
	fileTokenFormat: (tab) => { tab.plugin.updateRetroStatusBar(); },
	flagTokenFormat: (tab) => { tab.plugin.updateRetroStatusBar(); },
	fontTokenFormat: (tab) => { tab.plugin.updateRetroStatusBar(); },
	markersTokenFormat: (tab) => { tab.plugin.updateRetroStatusBar(); },
	barThemeEnabled: (tab) => { tab.plugin.applyThemeClass(); tab.plugin.applyThemeVars(); void tab.plugin.barThemeCursorSync(); },
	barThemeHeadings: (tab) => { tab.plugin.applyThemeVars(); },
	barThemeCode: (tab) => { tab.plugin.applyThemeVars(); },
	barThemeSimplified: (tab) => { tab.plugin.applyThemeVars(); },
	barThemeMarkdown: (tab) => { tab.plugin.applyThemeVars(); },
	barThemeBorderless: (tab) => { tab.plugin.applyThemeVars(); tab.plugin.applyThemeClass(); },
	barThemeCheckbox: (tab) => { tab.plugin.applyThemeClass(); },
	barThemeCursor: (tab) => { tab.plugin.applyThemeVars(); void tab.plugin.barThemeCursorSync(); },
	barThemeVim: (tab) => { tab.plugin.applyThemeVars(); void tab.plugin.barThemeCursorSync(); },
	menuDock: async (tab, v) => {
		if (v) { tab.plugin.registerMenuPanel(); await tab.plugin.openMenuPanel(true); }
		else tab.plugin.closeMenuPanel();
	},
	hemingwayEnabled: (tab) => { tab.plugin._hemSaid = false; },   // a lock should land now, not in 120 ms
	paragraphNumbers: (tab) => { tab.plugin.reconfigureEditors(); },
	organizerOn: (tab) => { try { tab.plugin.refreshMenuPanelsNow(); } catch (_) { wsCatch('AFTER organizerOn: refreshMenuPanelsNow();', _); } },
	// THROUGH THE ONE WRITER: the three steps that turning it on means —
	// flag, find or make the file, write it once — live in `historyTrackingOn`
	historyTracking: async (tab, v) => { if (v) await tab.plugin.historyTrackingOn(); },
	organizerDateFormat: (tab) => { tab.update(); },   // the sample time in the description follows
	settingsMirror: (tab) => { tab.update(); },   // the file row's text follows
};

// the keys whose row saved with `saveSettings(true)`: landed now, not debounced
const SAVE_NOW = new Set<string>([
	'pluginEnabled', 'scopeMode', 'zenEnabled', 'zenHideBar', 'enableLetterbox', 'enableRetroStatus', 'retroBarOnPhone',
	'statusBarBorderTop', 'statusBarBorderBottom', 'powerlineModeColors', 'vimFollowCursorSmith', 'posEnabled', 'checksEnabled',
	'checkFillerSoft', 'hemingwayEnabled', 'typographyEnabled', 'orgTargetShow', 'orgFolderIcons',
]);
