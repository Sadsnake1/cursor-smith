// Word-Smith — Menu: the Powermenu: its rows, the layout, the panel, the pop-up.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { setIcon } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { WsMenuRowSpec, WsOpenedPanel, WsMenuPickItem } from './settings';
import { MENU_MAX_COLS, MENU_RULE_STYLES, WS_MENU_ESC, WS_MENU_VIEW, WsMenuView, barMenuFuzzy, wsCatch, wsMenuSearchInto } from './preamble';
import type WordSmith from './plugin';

export const menuMethods = {

	// ── The menu ─────────────────────────────────────────────────────────────
	//
	// One modal, everything the bar's buttons carry, and NO SECOND POPUP.
	//
	// The first version routed: a row opened the same picker the bar button
	// opens. That reused the pickers exactly, and it was wrong for the thing
	// this is FOR — the pickers are anchored popovers built for a mouse, so
	// "keyboard-only menu" became "keyboard until you pick something, then
	// reach for the mouse". A front door with a mouse-shaped step in the
	// middle is not a front door.
	//
	// So the rows expand IN PLACE, and the items come from the same
	// *PickerItems() the bar buttons use — one source of truth about what a
	// mode is and whether it is on, without inheriting the popover.
	// ── The menu's layout ────────────────────────────────────────────────────
	// What the menu can hold, as data the Menu tab and the menu
	// itself both read — one list, two surfaces, the same contract the
	// theme shelf keeps with themesPickerItems. `search` and the `rule-N`
	// separators are POSITIONAL like everything else: the finder renders
	// wherever its card was dropped, and a writer can own as many rules as
	// they like, each a card of its own.
	// ── AND AN ICON EACH ────────────────────────────────────────────────────
	//
	// In THIS table rather than in a fourth list. A row already has to be
	// named in three places — here, in `menuRowSpecs`, and in `menuLayout`'s
	// default — and each of those has been the one somebody missed. A fourth
	// would be a fourth chance, and the icon is a fact about the row, which is
	// what this table is for.
	//
	// The docked pane is a column of words in somebody's sidebar, beside a
	// file explorer whose every row carries a glyph. A writer reaching for
	// Font among ten words reads all ten; reaching for a letter shape, they
	// read none.
	//
	// `lightdark` HAS NO ICON. It is the one row whose meaning flips — it
	// reads "Dark" while you are light — and a sun that sometimes means moon
	// is worse than no picture at all. Its label already says what pressing it
	// does, which is the whole job.
	// ── THE GLYPHS ──────────────────────────────────────────────────────────
	//
	// Lucide names, which is what `setIcon` takes. Chosen from a vault report
	// and named here for why, because "a better icon" is the kind of change
	// that gets reverted by the next person who does not know it was asked
	// for:
	//
	//   modes      `sliders-horizontal` said "settings"; `focus` was next and
	//              the vault called it "poorely chosen" — at 16px its corner
	//              brackets read as a camera, not a way of seeing. The row
	//              holds Letter Box, Typewriter, Hemingway and Zen — four
	//              ways of LOOKING at the page — and `glasses` says exactly
	//              that at any size. Third glyph for this row: the reasons
	//              stay listed so the fourth is chosen knowing all three.
	//   prose      a pen tip, asked for by name. `pen-tool` is the nib.
	//   markers    the pilcrow, asked for by name.
	//   font       the Aa, asked for by name. `case-sensitive` draws it;
	//              `type` was a single capital and named the wrong thing.
	//   export     a file with an arrow pointing right, asked for by name.
	//              `book-open` was the Manuscript window's idea, not this
	//              row's.
	//
	// `lightdark` is a FUNCTION, which is the one structural change here —
	// see `menuIconFor`. Every other row's glyph is fixed for the life of the
	// build; this one has to change under the writer as the theme does.
	// ── DRAWING A ROW'S GLYPH, ONCE ─────────────────────────────────────
	//
	// `menuIconFor` is the shared resolver that says WHICH glyph; the DRAWING
	// lives here so a second caller (the modal beside the pane) cannot be
	// written without the fallbacks the first one paid for:
	//
	// THE `cmd:` FALLBACK. A pinned command's id is `cmd:` + the command
	// id, which is never in `menuFeatureDefs`, so `menuIconFor` returns ''
	// and this decides. Do not add a defs entry per command — the ids are
	// the writer's and unbounded.
	//
	// THE ALTERNATIVES LOOP. `setIcon` with a name this build's Lucide has
	// never heard of does not throw: it leaves the element EMPTY, so a row
	// gets a silent blank where every other row has a picture and nothing
	// says why. Export was that row — `file-output` is not in every
	// bundled set. `childElementCount` is the test, because what setIcon
	// inserts is an <svg>.
	//
	// THE MIRROR. The arrow leaves the page, so it points AWAY from it;
	// Lucide draws this family pointing left. Mirrored rather than swapped
	// for another glyph, because the file half must stay the right way
	// round.
	//
	// AND A SPACER WHEN THERE IS NO GLYPH, or the labels start at two
	// different left edges.
	menuDrawIcon(this: WordSmith, el: HTMLElement, rowId: string) {
		const glyph = this.menuIconFor(rowId)
			|| (this.menuIsCommand(rowId) ? 'terminal' : '');
		if (!glyph) return el.createDiv({ cls: 'ws-menu-icon is-blank' });
		const g = el.createDiv({ cls: 'ws-menu-icon' });
		let drew = false;
		for (const n of this.menuIconAlts(glyph)) {
			g.textContent = '';
			try { if (setIcon) setIcon(g, n); } catch (_) { wsCatch('menuDrawIcon: if (setIcon) setIcon(g, n);', _); }
			if (g.childElementCount > 0) { drew = true; break; }
		}
		if (drew && this.menuIconMirrored(rowId)) g.addClass('is-mirrored');
		return g;
	},

	menuFeatureDefs(this: WordSmith) {
		return [
			{ id: 'search',    name: 'Search',       icon: 'search' },
			// A FEATHER: glasses were a reading mark on a row that turns writing
			// modes on.
			{ id: 'modes',    name: 'Modes',         icon: 'feather' },
			{ id: 'syntax',    name: 'Syntax',       icon: 'code' },
			{ id: 'prose',    name: 'Prose',         icon: 'pen-tool' },
			{ id: 'markers',    name: 'Markers',     icon: 'pilcrow' },
			{ id: 'font',    name: 'Font',           icon: 'case-sensitive' },
			// THE MOON AND THE SUN CHANGE PLACES ON EVERY PRESS.
			//
			// It had no icon at all, on the reasoning that "a sun that
			// sometimes means moon is worse than no picture". That was the
			// right worry about the wrong row: it only bites if the glyph
			// names what pressing does while the LABEL names where you are.
			//
			// They agree now. The label reads "Dark" while the theme is
			// dark, so the glyph is the moon while the theme is dark — one
			// row saying one thing twice, rather than a picture arguing
			// with the word beside it.
			{ id: 'lightdark',    name: 'Light / Dark',
			  icon: () => (this.isDarkTheme() ? 'moon' : 'sun') },
			{ id: 'theme',    name: 'Theme',         icon: 'palette' },
			{ id: 'report',    name: 'Report',       icon: 'bar-chart-2' },
			{ id: 'history',    name: 'History',     icon: 'history' },
			// THE THIRD PLACE a row has to be named. `menuRowSpecs` makes it
			// work, `menuLayout`'s default list makes it REACH a saved
			// order, and this makes the Menu tab call it something. Miss
			// this one and the card appears wearing its raw id — which is
			// what "export" in lower case was, and exactly what the
			// assertion about raw ids exists to catch.
			{ id: 'export',    name: 'Export',       icon: 'file-output' },
		{ id: 'organizer', name: 'Organizer',    icon: 'list-tree' }
		];
	},

	// The glyph for a row, or '' where there is deliberately none.
	//
	// RESOLVED, because `lightdark` answers with a function: its glyph
	// depends on the theme in force, and a string baked in at build time
	// would show whichever half the writer happened to be in when the panel
	// was drawn. The same shape `menuRowSpecs` already uses for that row's
	// label, for the same reason.
	// The names to try for one glyph, best first. A build whose Lucide has
	// never heard of the first draws nothing at all rather than failing, so
	// every icon that is not certain to be present needs a fallback that is.
	menuIconAlts(this: WordSmith, name: string) {
		const ALTS: Record<string, string[]> = {
			'file-output': ['file-output', 'file-symlink', 'file-up',
				'external-link', 'share'],
			// `setIcon` fails SILENTLY on a name a build's Lucide has never
			// heard of, and `glasses` is newer than `focus`: the fallbacks
			// are the row's previous glyphs, which every build has.
			'glasses': ['glasses', 'focus', 'sliders-horizontal'],
			// Lucide renamed `terminal-square` to `square-terminal` in the
			// same sweep that renamed `chevron-right-circle` to
			// `circle-chevron-right`, so BOTH spellings are listed and the
			// old clock-ish circle is kept LAST - a row that draws nothing
			// is worse than a row wearing the shape we are replacing, and
			// `setIcon` fails silently, so nothing else would tell us.
			// PLAIN >_ , NOT THE BOXED ONE: Obsidian's own command-palette entry in
			// settings wears the bare glyph, so the pinned rows match what the
			// writer already reads as "a command". The boxed spellings stay in the
			// chain behind it, because a build whose Lucide lacks the bare name
			// must still draw something rather than nothing.
			'terminal': ['terminal', 'terminal-square', 'square-terminal',
				'chevron-right-circle']
		};
		return ALTS[name] || [name];
	},

	// Which rows wear a glyph that has to be flipped. Kept beside the alts
	// rather than in the draw, so both facts about an icon live together.
	menuIconMirrored(this: WordSmith, id: string) { return id === 'export'; },

	menuIconFor(this: WordSmith, id: string) {
		const d = this.menuFeatureDefs().filter((x) => x.id === id)[0];
		const icon = d && d.icon;
		if (typeof icon === 'function') {
			try { return icon() || ''; } catch { return ''; }
		}
		return icon || '';
	},

	// The full order \u2014 saved first, then anything the save does not name,
	// in shipped order, so a feature added by an update APPEARS rather
	// than waiting for the writer to find a reset. Unknown saved ids are
	// kept: same rule as the theme shelf's hidden row \u2014 an id this build
	// cannot name must stay reachable, not silently swept.
	menuLayout(this: WordSmith) {
		// EVERY ROW THAT EXISTS, or the new one is invisible. The loop below
		// appends anything in this list that a saved order does not already
		// carry — which is exactly how a new row reaches a vault that has
		// rearranged its menu once. `export` was added to `menuRowSpecs`
		// and NOT here, so the row existed, worked, and could not be found
		// by anybody: their saved order had no id for it and nothing ever
		// added one. Adding a row means adding it in both places.
		// THE SHIPPED SHAPE: Search, Modes, then pairs — Syntax | Prose, Font |
		// Markers, Theme | Light / Dark — a rule, Report | History, Organizer |
		// Export. The pairs are `menuJoined`'s default; this is the order.
		const def = ['search', 'modes', 'syntax', 'prose', 'font', 'markers',
			'theme', 'lightdark', 'rule-1', 'report', 'history', 'organizer',
			'export'];
		const out: string[] = [];
		for (const id of (this.settings.menuOrder || [])) {
			if (!out.includes(id)) out.push(id);
		}
		for (const id of def) if (!out.includes(id)) out.push(id);
		return out;
	},

	menuVisibleLayout(this: WordSmith) {
		const hidden = new Set(this.settings.menuHidden || []);
		// THE ORGANIZER'S SWITCH: off, its row is not among the visible ones —
		// the panel, the bands and the pop-up all draw from this list, and the
		// Menu tab keeps naming the card, so nothing wears a raw id.
		return this.menuLayout().filter(id => !hidden.has(id) && (id !== 'organizer' || this.settings.organizerOn !== false));
	},

	// Drag semantics, verbatim from barThemeMove: position IS priority, and
	// the write is the WHOLE materialised order, so the default stops being
	// implicit the first time anyone rearranges it.
	// ── Lines ────────────────────────────────────────────────────────────────
	// The visible layout, grouped into the lines it will actually draw as.
	// Positional, so it heals itself: hide the leader of a line and the
	// entry that was joined to it simply becomes the next leader, with no
	// stored state to correct. A rule is always a line of its own — it IS
	// a horizontal line, and half of one beside a button means nothing.
	menuBands(this: WordSmith) {
		const joined = new Set(this.settings.menuJoined || []);
		const isRule = (id: string) => /^rule-\d+$/.test(id);
		const out = [];
		for (const id of this.menuVisibleLayout()) {
			const band = out[out.length - 1];
			// THE FINDER never shares a line either, and for the same
			// reason as a rule: it is not a cell. A text field squeezed
			// into a fifth of the width is unusable, and a writer whose
			// line-leader gets hidden should not find their search box
			// suddenly beside a button — which is exactly what the probe
			// caught the first time this ran.
			const solo = (x: string) => isRule(x) || x === 'search';
			const canJoin = band && joined.has(id) && band.length < MENU_MAX_COLS
				&& !solo(id) && !solo(band[0]);
			if (canJoin) band.push(id); else out.push([id]);
		}
		return out;
	},

	menuIsJoined(this: WordSmith, id: string) { return (this.settings.menuJoined || []).includes(id); },

	menuSetJoined(this: WordSmith, id: string, on: boolean) {
		const set = new Set(this.settings.menuJoined || []);
		if (on) set.add(id); else set.delete(id);
		this.settings.menuJoined = [...set];
	},

	// Drop ONTO a card: the dragged entry lands directly after it and
	// continues its line. Refused when that line is already full — the
	// entry lands after it as a line of its own instead, which is the
	// honest outcome of "there is no room here" and never loses the drag.
	menuJoinAfter(this: WordSmith, id: string, targetId: string) {
		if (id === targetId) return;
		const band = this.menuBands().find((b) => b.includes(targetId));
		const full = band && band.length >= MENU_MAX_COLS && !band.includes(id);
		const ids = this.menuLayout().filter((x) => x !== id);
		const at = ids.indexOf(targetId);
		ids.splice(at < 0 ? ids.length : at + 1, 0, id);
		this.settings.menuOrder = ids;
		this.menuSetJoined(id, !full && !/^rule-\d+$/.test(id));
	},

	// Drop into the gap between two lines: its own line, at that point.
	menuBreakAt(this: WordSmith, id: string, toIdx: number) {
		this.menuMove(id, toIdx);
		this.menuSetJoined(id, false);
	},

	menuMove(this: WordSmith, id: string, toIdx: number) {
		const ids = this.menuLayout().filter((x) => x !== id);
		const at = Math.max(0, Math.min(toIdx, ids.length));
		ids.splice(at, 0, id);
		this.settings.menuOrder = ids;
	},

	menuHide(this: WordSmith, id: string) {
		const hidden = this.settings.menuHidden || [];
		if (!hidden.includes(id)) hidden.push(id);
		this.settings.menuHidden = hidden;
	},

	menuRestore(this: WordSmith, id: string) {
		this.settings.menuHidden =
			(this.settings.menuHidden || []).filter((h) => h !== id);
	},

	// A separator is writer-made and content-free, so its \u2715 DELETES where
	// a feature's \u2715 shelves: there is nothing in a rule worth keeping a
	// route back to, and \u201cAdd separator\u201d remakes one in a click.
	menuAddRule(this: WordSmith, afterIdx?: number) {
		let n = 1;
		for (const id of this.menuLayout()) {
			const m = /^rule-(\d+)$/.exec(id);
			if (m) n = Math.max(n, parseInt(m[1], 10) + 1);
		}
		const ids = this.menuLayout();
		const at = afterIdx == null ? ids.length : Math.max(0, Math.min(afterIdx, ids.length));
		ids.splice(at, 0, 'rule-' + n);
		this.settings.menuOrder = ids;
		return 'rule-' + n;
	},

	// ── Pinned commands ──────────────────────────────────────────────────────
	// Any Obsidian command can be a menu row. It rides the same order as
	// everything else — menuLayout() already keeps ids it cannot name, so
	// order, move, hide and restore work for these WITHOUT knowing they
	// exist. Only naming and rendering are command-aware.
	//
	// The id is `cmd:` + the command's own id, and a command id contains
	// colons of its own (`templater-obsidian:insert-templater`), so this
	// is parsed by PREFIX and never by splitting on ':'.
	menuIsCommand(this: WordSmith, id: string) { return typeof id === 'string' && id.startsWith('cmd:'); },

	menuCommandId(this: WordSmith, id: string) { return this.menuIsCommand(id) ? id.slice(4) : null; },

	// The live command, or null when the plugin that owned it is gone.
	// Guarded throughout: probes stub `app` thinly, and a settings tab
	// that throws is a settings tab nobody can open.
	menuCommandFor(this: WordSmith, id: string) {
		const cid = this.menuCommandId(id);
		if (!cid) return null;
		try {
			const cmds = this.app.commands;
			if (!cmds) return null;
			if (cmds.commands && cmds.commands[cid]) return cmds.commands[cid];
			if (typeof cmds.listCommands === 'function') {
				return cmds.listCommands().find(c => c && c.id === cid) || null;
			}
		} catch (_) { wsCatch('menuCommandFor: const cmds = this.app.commands;', _); }
		return null;
	},

	// The name to offer when a command is first pinned: everything after
	// the plugin's own prefix, so "Templater: Insert template modal"
	// offers "Insert template modal". A stripped name that COLLIDES with
	// something already on the shelf offers the full name instead — two
	// rows called the same thing is worse than one long row, and a rare
	// case must not complicate the common one.
	menuDefaultAlias(this: WordSmith, name: string) {
		const full = String(name == null ? '' : name).trim();
		const cut = full.indexOf(': ');
		const short = cut > 0 ? full.slice(cut + 2).trim() : full;
		if (!short || short === full) return full;
		const taken = new Set();
		for (const f of this.menuFeatureDefs()) taken.add(f.name.toLowerCase());
		taken.add('separator');
		for (const v of Object.values(this.settings.menuAliases || {})) {
			if (v) taken.add(String(v).toLowerCase());
		}
		return taken.has(short.toLowerCase()) ? full : short;
	},

	// What a pinned command is CALLED. Falls through: the saved alias, the
	// stripped default from the live command, then the raw id — which is
	// the honest name for a command this vault can no longer resolve and
	// never pinned a name for, exactly as an unknown layout id renders.
	menuAliasOf(this: WordSmith, id: string) {
		const saved = (this.settings.menuAliases || {})[id];
		if (saved) return saved;
		const cmd = this.menuCommandFor(id);
		if (cmd && cmd.name) return this.menuDefaultAlias(cmd.name);
		return this.menuCommandId(id) || id;
	},

	// The FULL name, for the places full names belong: tooltips, aria
	// labels, and the finder's keywords. A dead command has only its id
	// left, which is still more use than nothing.
	menuCommandName(this: WordSmith, id: string) {
		const cmd = this.menuCommandFor(id);
		return (cmd && cmd.name) ? cmd.name : (this.menuCommandId(id) || id);
	},

	menuPinCommand(this: WordSmith, cid: string) {
		const id = 'cmd:' + cid;
		const ids = this.menuLayout();
		if (!ids.includes(id)) ids.push(id);
		this.settings.menuOrder = ids;
		this.settings.menuHidden =
			(this.settings.menuHidden || []).filter((h) => h !== id);
		return id;
	},

	// An EMPTY alias deletes the entry rather than saving a blank: that is
	// the revert path, and it is why no card needs a reset button.
	menuSetAlias(this: WordSmith, id: string, alias: string) {
		const map = this.settings.menuAliases || {};
		const val = String(alias == null ? '' : alias).trim();
		if (val) map[id] = val; else delete map[id];
		this.settings.menuAliases = map;
	},

	// The only true delete besides menuDeleteRule — and it lives on the
	// Removed chip, not on the card, because a pin carries the writer's
	// naming work and ✕ should never throw that away by accident.
	menuUnpin(this: WordSmith, id: string) {
		this.settings.menuOrder  = this.menuLayout().filter((x) => x !== id);
		this.settings.menuHidden = (this.settings.menuHidden || []).filter((h) => h !== id);
		const map = this.settings.menuAliases || {};
		delete map[id];
		this.settings.menuAliases = map;
		this.menuSetJoined(id, false);
	},

	// ── How a separator draws ────────────────────────────────────────────────
	// Solid, dashed, dotted or double — the same four the bar's own edge
	// rules offer, because a writer who has met one of these lists has met
	// the other. Anything unrecognised reads as solid: a saved style from a
	// newer build must not leave a gap where a line should be.
	menuRuleStyle(this: WordSmith, id: string) {
		const v = (this.settings.menuRuleStyles || {})[id];
		return MENU_RULE_STYLES.includes(v) ? v : 'solid';
	},

	menuSetRuleStyle(this: WordSmith, id: string, style: string) {
		const map = this.settings.menuRuleStyles || {};
		if (MENU_RULE_STYLES.includes(style) && style !== 'solid') map[id] = style;
		else delete map[id];   // solid is the default, and a default is not worth storing
		this.settings.menuRuleStyles = map;
	},

	menuDeleteRule(this: WordSmith, id: string) {
		this.settings.menuOrder = this.menuLayout().filter((x) => x !== id);
		this.settings.menuHidden =
			(this.settings.menuHidden || []).filter((h) => h !== id);
		const map = this.settings.menuRuleStyles || {};
		delete map[id];
		this.settings.menuRuleStyles = map;
	},

	// ── The menu's rows ──────────────────────────────────────────────────────
	// The one source both surfaces read: the pop-up menu and the docked
	// panel. It lived inside openBarMenu as a local until the panel existed,
	// and moving it out is the whole reason the two cannot drift — the same
	// rows, the same pickers, the same labels, whichever surface a writer
	// is looking at.
	menuRowSpecs(this: WordSmith): WsMenuRowSpec[] {
		return [
		{ id: 'modes',   label: 'Modes',   items: () => this.modesPickerItems() },
		{ id: 'syntax',  label: 'Syntax',  items: () => this.syntaxPickerItems() },
		{ id: 'prose',   label: 'Prose',   items: () => this.checksPickerItems() },
		{ id: 'markers', label: 'Markers', items: () => this.markersPickerItems() },
		{ id: 'font',    label: 'Font',    items: () => this.fontPickerItems(), count: false },
		// Above Theme, because it changes which HALF of a theme you are
		// looking at: the question "dark or light" comes before the
		// question "which scheme".
		//
		// A TOGGLE, not a drawer. Two items behind an expander is one
		// keystroke too many for a binary, and the open row always
		// showed one dead option — the mode you were already in.
		//
		// THE LABEL NAMES WHERE YOU ARE: "Dark" while the theme is dark.
		// The comment here claimed the opposite for several releases —
		// "it reads Light Mode while you are dark" — and the code has
		// never done that. Confirmed from a vault as the wanted
		// behaviour, so the PROSE was the thing that was wrong. The
		// glyph in `menuFeatureDefs` follows the label for the same
		// reason: one row should not say two things.
		//
		// `label` is a function here, which is why render resolves it:
		// the text changes with the app, not with the menu opening.
		{
			id: 'lightdark',
			// "Dark" and "Light", not "Dark Mode" and "Light Mode". Every other
			// row in this menu is a noun — Markers, Font, Theme — and "Mode"
			// was doing no work in a list where nothing else needed the word.
			label: () => this.isDarkTheme() ? 'Dark' : 'Light',
			// Both words, so the finder answers "dark" and "light"
			// whichever one the label happens to be showing.
			keywords: 'light dark mode appearance',
			toggle: () => this.barSetColorMode(!this.isDarkTheme())
		},
		{ id: 'theme',   label: 'Theme',   items: () => this.themesPickerItems(), count: false },
		// These OPEN something rather than setting it — a different
		// kind of act, still centred (is-wide) so the pair reads as a
		// footer. The divider that used to be Report's own flag is a
		// layout entry now: the shipped order carries one rule above
		// Report, and the Menu tab can move it, delete it, or add more.
		{ id: 'report',  label: 'Report',  wide: true, reopen: true,
			run: () => this.openReportModal() },
		{ id: 'history', label: 'History', wide: true, reopen: true,
			run: () => this.openHistoryModal() },
		// Export joins the pair for the same reason they are a pair: it
		// OPENS a window rather than setting a switch. Third in the run,
		// because it is the one you reach for least often and last in the
		// order of things you do — write, look at what you wrote, send it.
		{ id: 'export',  label: 'Export',  wide: true, reopen: true,
			run: () => this.openExportModal() },
		// The Organizer among the window-openers, and FIRST of the four, not
		// last: Report, History and Export all look at writing that exists, and
		// this is where the writing is arranged.
		{ id: 'organizer', label: 'Organizer', wide: true, reopen: true,
			// THE PANE: one door in.
			run: () => this.orgOpenTab('organizer') },
		];
	},

	registerMenuPanel(this: WordSmith) {
		const View = WsMenuView;
		if (!View || this._menuPanelRegistered) return;
		try {
			this.registerView(WS_MENU_VIEW, (leaf: WorkspaceLeaf) => new View(leaf, this));
			this._menuPanelRegistered = true;
		} catch (_) { wsCatch('registerMenuPanel: this.registerView(WS_MENU_VIEW, (leaf) => new WsMenuView(leaf, this));', _); }
	},

	// The panel's leaves, however the writer has arranged them — left
	// sidebar, right, or dragged into the main area.
	// Which side the panel was on, so switching the plugin back on returns
	// it there. Kept in memory rather than in settings: it describes THIS
	// session's workspace, and a saved value would fight the layout
	// Obsidian itself restores at startup.
	rememberMenuPanelSpot(this: WordSmith) {
		const leaf = this.menuPanelLeaves()[0];
		if (!leaf) return;
		this._panelWasOpen = true;
		this._panelSide = 'left';
		try {
			const root = leaf.getRoot && leaf.getRoot();
			if (root && root === this.app.workspace.rightSplit) this._panelSide = 'right';
		} catch (_) { wsCatch('rememberMenuPanelSpot: const root = leaf.getRoot && leaf.getRoot();', _); }
	},

	async restoreMenuPanelSpot(this: WordSmith) {
		if (!this._panelWasOpen || !this.settings.menuDock) return;
		this._panelWasOpen = false;
		try {
			const leaf = this._panelSide === 'right'
				? this.app.workspace.getRightLeaf(false)
				: this.app.workspace.getLeftLeaf(false);
			if (leaf) await leaf.setViewState({ type: WS_MENU_VIEW, active: false });
		} catch (_) { wsCatch('restoreMenuPanelSpot: const leaf = this._panelSide === \'right\'', _); }
	},

	menuPanelLeaves(this: WordSmith) {
		try { return this.app.workspace.getLeavesOfType(WS_MENU_VIEW) || []; }
		catch { return []; }
	},

	// THE GHOST. When the plugin unloads — an update, a disable — Obsidian
	// keeps every leaf of our view type as a PLACEHOLDER that draws Lucide's
	// ghost and the type's name, so the pane can come back. Registering the
	// type again does NOT bring it back, and getLeavesOfType COUNTS the
	// placeholders — so the plugin would see "a pane exists", open none,
	// and the sidebar would show a ghost where the W was. Setting a
	// placeholder's own state again builds the real view in it. So: after
	// the type is registered, every placeholder of ours is revived — one
	// per side, the rest go, so the ghosts a vault collected before this do
	// not all wake as panes. One pass in flight at a time (the start and
	// openMenuPanel can ask together), the live panes' sides taken first so
	// a ghost beside a live pane goes rather than waking as a second one,
	// and a second look after the awaits: a placeholder Obsidian is still
	// settling (a leaf reads as `empty` for a moment after the unload) can
	// slip one pass.
	reviveMenuPanel(this: WordSmith): Promise<void> {
		const View = WsMenuView;
		if (!View || !this._menuPanelRegistered) return Promise.resolve();
		if (this._reviving !== null) return this._reviving;
		const sideOf = (leaf: WorkspaceLeaf): unknown => { try { return leaf.getRoot(); } catch (_) { wsCatch('reviveMenuPanel: leaf.getRoot();', _); return null; } };
		const pass = async () => {
			const leaves = this.menuPanelLeaves();
			const sides = new Set<unknown>(leaves.filter((l) => l.view instanceof View).map(sideOf));
			let woke = 0;
			for (const leaf of leaves) {
				if (leaf.view instanceof View) continue;
				const side = sideOf(leaf);
				if (sides.has(side)) { try { leaf.detach(); } catch (_) { wsCatch('reviveMenuPanel: leaf.detach();', _); } continue; }
				sides.add(side);
				woke++;
				try { await leaf.setViewState({ type: WS_MENU_VIEW, active: false }); }
				catch (_) { wsCatch('reviveMenuPanel: await leaf.setViewState({ type: WS_MENU_VIEW, active: false });', _); }
			}
			return woke;
		};
		this._reviving = (async () => {
			try { if (await pass()) await pass(); }
			finally { this._reviving = null; }
		})();
		return this._reviving;
	},

	async openMenuPanel(this: WordSmith, reveal: boolean) {
		if (!WsMenuView || this.settings.menuDock === false) return null;
		this.registerMenuPanel();
		await this.reviveMenuPanel();
		let leaf: WorkspaceLeaf | null = this.menuPanelLeaves()[0] || null;
		if (!leaf) {
			try {
				leaf = this.app.workspace.getLeftLeaf(false);
				if (leaf) await leaf.setViewState({ type: WS_MENU_VIEW, active: true });
			} catch { return null; }
		}
		if (leaf && reveal) { try { void this.app.workspace.revealLeaf(leaf); } catch (_) { wsCatch('openMenuPanel: this.app.workspace.revealLeaf(leaf);', _); } }
		return leaf;
	},

	closeMenuPanel(this: WordSmith) {
		for (const leaf of this.menuPanelLeaves()) {
			try { leaf.detach(); } catch (_) { wsCatch('closeMenuPanel: leaf.detach();', _); }
		}
	},

	// Every open panel redraws. Called wherever the pop-up would have been
	// re-rendered by its own click — a mode flipped from the bar must show
	// in the panel too, or the two surfaces disagree about the same state.
	// A REDRAW THAT DOES NOT EAT THE CLICK THAT CAUSED IT.
	//
	// Clicking a row makes the panel the active leaf, which fires
	// active-leaf-change, which redrew the panel — BETWEEN MOUSEDOWN AND
	// MOUSEUP. A click event only fires when both land on the same
	// element, so the element the writer pressed was gone before they let
	// go and nothing happened. The second click worked because the leaf
	// was already active by then and no event fired. That is the whole of
	// "sometimes I have to click twice".
	//
	// So a redraw asked for while a pointer is down inside a panel is
	// DEFERRED to pointerup. Nothing is skipped — the panel still shows
	// live state — it simply does not rebuild the ground under a gesture
	// that is still in progress.
	refreshMenuPanels(this: WordSmith) {
		if (this._panelPointerDown) { this._panelRefreshPending = true; return; }
		this.refreshMenuPanelsNow();
	},

	// A REBUILD, unconditionally: the LAYOUT changed, not the state. Used
	// by the Menu tab, where every edit changes which rows exist — the
	// note-comparison in refreshMenuPanelsNow would answer "same note,
	// nothing to redraw" and leave the panel showing the old arrangement.
	rebuildMenuPanels(this: WordSmith) {
		for (const leaf of this.menuPanelLeaves()) {
			try { if (leaf.view && leaf.view.render) leaf.view.render(); } catch (_) { wsCatch('rebuildMenuPanels: if (leaf.view && leaf.view.render) leaf.view.render();', _); }
		}
	},

	refreshMenuPanelsNow(this: WordSmith) {
		// A REBUILD ONLY WHEN THE ROWS WOULD DIFFER. The panel redraws on
		// active-leaf-change so its counts follow the writer — but
		// clicking the panel IS an active-leaf-change, and rebuilding then
		// destroys the drawer the click just opened and replays its
		// animation. On screen: a folder closing and opening again under
		// the pointer.
		//
		// The note is the only thing a leaf change can alter about these
		// rows, so it is the whole test. Same note, nothing to rebuild —
		// the states are refreshed in place instead, which is cheap and
		// leaves every element where it was.
		let file = null;
		try {
			const v = this.activeMarkdownView();
			file = v && v.file ? v.file.path : null;
		} catch (_) { wsCatch('refreshMenuPanelsNow: const v = this.activeMarkdownView();', _); }
		void file;
		// NEVER A REBUILD HERE. A note change alters what the rows SAY —
		// the counts, the current font, the mode — and never which rows
		// exist; that is the Menu tab's business, and it calls
		// rebuildMenuPanels for it. Rebuilding on every file-open threw
		// away open drawers and the scroll position, which is the flicker
		// the vault filmed when clicking through the file tree.
		//
		// The note comparison that used to guard this is gone with it: a
		// guard is only needed for an act that should sometimes not
		// happen, and refreshing state is always safe.
		for (const leaf of this.menuPanelLeaves()) {
			try {
				const v = leaf.view;
				if (v && v.refreshStates) v.refreshStates();
			} catch (_) { wsCatch('refreshMenuPanelsNow: const v = leaf.view;', _); }
		}
	},

	openBarMenu(this: WordSmith) {
		// one line of the menu as the keys walk it: a row with its band, or an item of a drawer
		type WsBarMenuFlat = { el: HTMLElement; kind: 'row'; ri: number; band: HTMLElement | null } | { el: HTMLElement; kind: 'item'; item: WsMenuPickItem; ri?: undefined; band?: undefined };
		const modal = this.wsModal();
		if (!modal) return;
		modal.modalEl.addClass('ws-menu-modal');
		// The container gets a class of its own so the stylesheet can reach a
		// close button hung off IT rather than off the modal — which is where
		// some Obsidian builds put it. A class rather than `:has`, which this
		// stylesheet does not use anywhere near body (see selfcarry_probe).
		try { modal.containerEl.addClass('ws-menu-container'); } catch (_) { wsCatch('openBarMenu: modal.containerEl.addClass(\'ws-menu-container\');', _); }
		// The menu is a PALETTE, not an interruption: it sits beside the
		// writing and applies live, so dimming the workspace behind it hides
		// exactly the thing every click is changing. The scrim stays for
		// click-to-close; only its paint goes.
		// `.ws-menu-container .modal-bg` in styles.css takes the paint off.
		modal.contentEl.addClass('ws-menu-content');
		// The list first, and the finder INSIDE it: the search is a
		// positional entry of the layout now, rendered wherever its card
		// was dropped in the Menu tab. It is created once and never
		// rebuilt — render() moves its SIBLINGS around it — because
		// emptying it with the rest would blur the field on the very
		// keystroke that triggered the render.
		const list = modal.contentEl.createDiv({ cls: 'ws-menu-list' });
		// A menu with any wide line needs the width: three picker rows at a
		// third of 320px crush the state text against the label. A menu of
		// single lines keeps the narrow palette it has always been.
		if (this.menuBands().some((b) => b.length > 1)) {
			try { modal.modalEl.addClass('is-tabular'); } catch (_) { wsCatch('openBarMenu: modal.modalEl.addClass(\'is-tabular\');', _); }
		}
		// One column, row labels centred by the stylesheet, nothing to configure.
		// The finder searches ROWS AND THEIR ITEMS at once — a writer
		// looking for "nord" should not have to know it lives under Theme
		// — and each result carries the row it came from, so the answer
		// teaches the menu instead of bypassing it.
		// THE DOCKED MENU'S BOX, not one that looks like it: `type="search"`
		// inside `search-input-container`, so the app draws the magnifier, and
		// three dots where the other two boxes use three dots.
		const search = wsMenuSearchInto(list);
		const layout = this.menuVisibleLayout();
		// Hidden is hidden, not gone: the node stays (render() steers by
		// it), it just neither shows nor takes the opening focus.
		const searchShown = layout.includes('search');
		// THE WRAPPER, NOT THE INPUT. There is a box around the field now, and
		// hiding what is inside a visible container leaves the container —
		// which here is a bordered strip with nothing in it.
		if (!searchShown) (search.parentElement || search).addClass('is-hidden');

		const FEATURES = this.menuRowSpecs();
		// The rows the layout actually shows, in its order — ri, the index
		// every keyboard path steers by, is an index into THIS.
		//
		// A pinned command resolves to a row of the same shape as any
		// other `run` row: the writer's ALIAS as the label, the full
		// command name and its plugin prefix as keywords — which is the
		// entire search story, since the finder already matches run rows
		// against both (the light/dark toggle is the precedent). So a row
		// reading "Template" is still found by typing "templater".
		//
		// A DEAD command — its plugin uninstalled — resolves to nothing,
		// and the render loop's existing `ri == null` skip drops it with
		// no new branch. Its card stays on the shelf; see displayMenuTab.
		const rowFor = (id: string): WsMenuRowSpec | null => {
			const feat = FEATURES.find((f: { id: string; }) => f.id === id);
			if (feat) return feat;
			if (!this.menuIsCommand(id)) return null;
			const cmd = this.menuCommandFor(id);
			if (!cmd) return null;
			const full = this.menuCommandName(id);
			const cut = full.indexOf(': ');
			// A pinned command is an ACT — centred like Report and History,
			// and it closes the menu on its way out.
			return {
				id,
				label: this.menuAliasOf(id),
				full,
				keywords: full + ' ' + (cut > 0 ? full.slice(0, cut) : ''),
				wide: true,
				run: () => {
					try { const cid = this.menuCommandId(id); if (cid) this.app.commands.executeCommandById(cid); }
					catch (_) { wsCatch('openBarMenu / run: plugin.app.commands.executeCommandById(plugin.menuCommandId(id));', _); }
				}
			};
		};
		const ROWS: WsMenuRowSpec[] = layout.map(rowFor).filter((r): r is WsMenuRowSpec => !!r);
		const RI: Record<string, number> = {};
		ROWS.forEach((r, i) => { RI[r.id] = i; });

		// One flat list of what is currently on screen, rebuilt whenever a
		// row opens or closes. Flat because the keyboard walks it: j and k
		// move by VISIBLE line, so a nested model would need the same list
		// derived anyway.
		let open = -1;       // which row is expanded, -1 for none
		let at = 0;          // index into the flat list
		let flat: WsBarMenuFlat[] = [];

		// A row's label may be a function of the app's state — the
		// light/dark toggle names the mode it would switch TO.
		const rowLabel = (row: WsMenuRowSpec) =>
			(typeof row.label === 'function' ? row.label() : row.label);

		// Everything but the finder goes; the finder is the one node whose
		// identity must survive a render, or typing into it would blur it.
		//
		// AND THE FINDER IS NOT A CHILD OF THIS LIST: it sits inside
		// `search-input-container`, which is the wrapper Obsidian draws the
		// magnifier on, so the child of `list` is the WRAPPER — a test on
		// `el !== search` would remove the box and the field inside it on the
		// first render. KEPT BY CONTAINMENT, not by identity, so a second
		// wrapper one day costs nothing.
		const clearList = () => {
			for (const el of Array.from(list.children)) {
				if (el !== search && !el.contains(search)) el.remove();
			}
		};

		const render = () => {
			clearList();
			flat = [];
			// Nodes are appended by createDiv and then, for every entry
			// that sits BEFORE the finder in the layout, moved in front of
			// it — which is what makes the finder's position real without
			// ever rebuilding the finder itself.
			let pastSearch = !searchShown;
			// AGAINST THE BOX, NOT THE FIELD. `insertBefore` needs a node that is
			// actually a child of `list`, and the finder is inside its own
			// wrapper now — passing the input threw NotFoundError, "The child
			// can not be found in the parent". One `searchBox` is used by both
			// this and `clearList`, so the two cannot disagree about which node
			// represents the finder in the list.
			const searchBox = (search.parentElement && search.parentElement !== list)
				? search.parentElement : search;
			const place = (el: HTMLDivElement) => { if (!pastSearch) list.insertBefore(el, searchBox); };

			// SEARCH MODE. Rows collapse and the matches stand alone, best
			// first, each labelled with the row it belongs to. Results are
			// pushed into the SAME `flat` list the browsing mode uses, with
			// the same kinds, so every key, click and activate path below
			// works here without knowing search exists.
			const q = (search.value || '').trim().toLowerCase();
			if (q) {
				const hits: ({ sc: number; row: string; kind: 'row'; ri: number } | { sc: number; row: string; kind: 'item'; item: WsMenuPickItem })[] = [];
				ROWS.forEach((row, ri) => {
					// A row that DOES something — opens a panel, or flips a
					// toggle — is itself a result. Matched against its
					// keywords as well as its label, so the light/dark row
					// answers to BOTH words rather than only to the one it
					// is currently showing.
					if (row.run || row.toggle) {
						const label = rowLabel(row);
						const sc = Math.max(
							barMenuFuzzy(q, label),
							row.keywords ? barMenuFuzzy(q, row.keywords) - 1 : -1);
						if (sc >= 0) hits.push({ sc, row: label, kind: 'row', ri });
					}
					if (!row.items) return;
					for (const item of row.items()) {
						// Matched against "row label + item label", so both
						// "theme nord" and plain "nord" find the same thing.
						const sc = Math.max(
							barMenuFuzzy(q, item.label),
							barMenuFuzzy(q, rowLabel(row) + ' ' + item.label) - 2);
						if (sc >= 0) hits.push({ sc, row: rowLabel(row), kind: 'item', item });
					}
				});
				hits.sort((a, b) => b.sc - a.sc);
				for (const h of hits.slice(0, 12)) {
					const isOn = h.kind === 'item'
						&& (typeof h.item.on === 'function' ? h.item.on() : h.item.on);
					const sub = list.createDiv({
						cls: 'ws-menu-sub ws-picker-row ws-menu-result'
							+ (h.kind === 'item' && !isOn ? ' is-off' : '')
					});
					if (h.kind === 'item' && h.item.color) {
						const dot = sub.createSpan({ cls: 'ws-picker-dot' });
						if (h.item.color !== 'currentColor') dot.style.backgroundColor = h.item.color;
					}
					sub.createSpan({ cls: 'ws-picker-label',
						text: h.kind === 'row' ? h.row : h.item.label });
					if (h.kind === 'item') sub.createSpan({ cls: 'ws-menu-in', text: h.row });
					const entry: WsBarMenuFlat = h.kind === 'row'
						? { el: sub, kind: 'row', ri: h.ri, band: null }
						: { el: sub, kind: 'item', item: h.item };
					flat.push(entry);
					sub.addEventListener('click', () => {
						at = flat.indexOf(entry); void activate();
					});
				}
				if (!flat.length) {
					list.createDiv({ cls: 'ws-menu-empty', text: 'Nothing matches' });
				}
				at = Math.min(at, Math.max(0, flat.length - 1));
				paint();
				return;
			}

			// LINES. Each band is one line of the menu: a single entry
			// spans the width as it always has, and two to five share it
			// evenly. The band element is what carries the grid, so a
			// line of one costs no wrapper at all and every existing menu
			// renders byte for byte as before.
			//
			// A drawer opens BENEATH THE WHOLE BAND rather than under its
			// cell: growing one cell would leave dead space beside it and
			// shove the line apart, and the point of a line is that it
			// holds still while you read along it.
			this.menuBands().forEach((band) => {
				if (band.length === 1 && band[0] === 'search') { pastSearch = true; return; }
				const multi = band.length > 1;
				let bandEl = null;
				if (multi) {
					bandEl = list.createDiv({ cls: 'ws-menu-band' });
					try { bandEl.style.setProperty('--ws-menu-cells', String(band.length)); } catch (_) { wsCatch('openBarMenu / render: bandEl.style.setProperty(\'--ws-menu-cells\', String(band.length));', _); }
					place(bandEl);
				}
				// Anything the band opens is collected and drawn after it,
				// inside ONE container — which is what lets the block be
				// centred under the line and scroll when it is long,
				// instead of each item stretching the modal on its own.
				const drawers: HTMLDivElement[] = [];
				band.forEach((id: string) => {
			if (id === 'search') { pastSearch = true; return; }
			{
				if (/^rule-\d+$/.test(id)) {
					place(list.createDiv({
						cls: 'ws-menu-rule is-' + this.menuRuleStyle(id)
					}));
					return;
				}
				const ri = RI[id];
				if (ri == null) return;   // an id this build cannot name: inert, kept
				const row = ROWS[ri];
				const el = (bandEl || list).createDiv({
					cls: 'ws-menu-row' + (row.wide && !multi ? ' is-wide' : '')
						+ (multi ? ' ws-menu-cell' : '')
				});
				if (!multi) place(el);
				// The full name, where full names belong. The row wears the
				// writer's short alias; hovering it says what it really runs.
				if (row.full) {
					el.setAttribute('title', row.full);
					el.setAttribute('aria-label', row.full);
				}
				// THE GLYPH, through the one drawer. It was absent here and
				// present in the pane; the row is the same row.
				this.menuDrawIcon(el, id);
				el.createSpan({ cls: 'ws-menu-label', text: rowLabel(row) });
				// A count of what is on, for the rows where that is a
				// question. NOT for Font: exactly one typeface is always
				// selected, so "1 on" states a tautology and reads as though
				// something might have been zero. A `choose` picker has a
				// current value, not a count — so it shows the value.
				if (row.items && row.count !== false) {
					const its = row.items();
					const on = its.filter(i => (typeof i.on === 'function' ? i.on() : i.on)).length;
					el.createSpan({ cls: 'ws-menu-state', text: on ? String(on) + ' on' : 'off' });
				} else if (row.items) {
					const cur = row.items().find(i => (typeof i.on === 'function' ? i.on() : i.on));
					if (cur) el.createSpan({ cls: 'ws-menu-state', text: cur.label });
				}
				flat.push({ el, kind: 'row', ri, band: bandEl });
				el.addEventListener('click', () => { at = flat.findIndex(f => f.el === el); void activate(); });

				if (open === ri && row.items) {
					for (const item of row.items()) {
						// Built the way the bar's own popup builds a row —
						// same classes, so the swatch, the drawn icon, the
						// font preview and the fade of an unselected row all
						// come from the stylesheet that already describes
						// them. The menu should look like the thing it
						// replaces, and reusing the classes is the only way
						// that stays true when the popup is restyled.
						const isOn = (typeof item.on === 'function' ? item.on() : item.on);
						const sub = list.createDiv({
							cls: 'ws-menu-sub ws-picker-row' + (isOn ? '' : ' is-off')
						});
						// Parked either way: the container is built and
						// placed once, after the loop.
						drawers.push(sub);
						if (item.color) {
							const dot = sub.createSpan({ cls: 'ws-picker-dot' });
							if (item.color !== 'currentColor') dot.style.backgroundColor = item.color;
						}
						if (item.icon) {
							const ic = item.icon();
							ic.classList.add('ws-picker-icon');
							sub.appendChild(ic);
						}
						const lab = sub.createSpan({ cls: 'ws-picker-label', text: item.label });
						if (item.font) lab.style.fontFamily = item.font;
						flat.push({ el: sub, kind: 'item', item });
						sub.addEventListener('click', () => {
							at = flat.findIndex(f => f.el === sub); void activate();
						});
					}
				}
			}
				});
				// The drawer: one container under the line that owns it,
				// centred as a block and scrolling past a certain height.
				// A theme list is forty entries long, and a modal that
				// grows to hold all of them stops being a palette.
				if (drawers.length) {
					const box = list.createDiv({ cls: 'ws-menu-drawer' });
					for (const d of drawers) box.appendChild(d);
					place(box);
				}
				if (bandEl) bandEl.toggleClass('is-open', drawers.length > 0);
			});
			paint();
		};

		const paint = () => {
			flat.forEach((f, i) => f.el.toggleClass('is-active', i === at));
			// Follow the keys. With every row open the list outgrows the
			// modal, and an arrow-moved selection that walks below the fold
			// reads as "arrows don't work" — the active row must bring the
			// scroll with it. 'nearest', so mouse users' scroll position is
			// never yanked when a click repaints.
			const cur = flat[at];
			if (cur && cur.el && cur.el.scrollIntoView) {
				try { cur.el.scrollIntoView({ block: 'nearest' }); } catch (_) { wsCatch('openBarMenu / paint: cur.el.scrollIntoView( block: \'nearest\' );', _); }
			}
		};

		const activate = async () => {
			const cur = flat[at];

			if (!cur) return;
			if (cur.kind === 'item') {
				// Applies live, behind the modal. Every one of these is a
				// toggle or a choice, so there is nothing to confirm and
				// nothing to cancel — which is why Escape can just close.
				if (cur.item.onClick) await cur.item.onClick();
				const keep = at;
				render();
				at = Math.min(keep, flat.length - 1);
				paint();
				return;
			}
			const row = ROWS[cur.ri];
			// A toggle acts and STAYS: the menu is a palette, and closing
			// it on a mode flip would hide the thing the flip just changed.
			// The re-render is what re-reads the label.
			if (row.toggle) {
				row.toggle();
				const keep = at;
				render();
				at = Math.min(keep, flat.length - 1);
				paint();
				return;
			}
			if (row.run) {
				modal.close();
				const opened = row.run() as WsOpenedPanel | void;
				// A row that OPENS A PANEL comes back here when the panel
				// closes: Report and History are things you look at and
				// leave, and leaving them should put the writer back where
				// they were rather than in the note with the menu gone.
				// Chained rather than replaced, so whatever the panel does
				// on close still happens — and guarded, because a build
				// where the opener returns nothing must simply not reopen
				// rather than throw on the way out.
				if (row.reopen && opened && typeof opened === 'object') {
					// BOTH DOORS, and once only. A panel leaves by Escape,
					// by the ✕, or by a click outside, and those do not all
					// travel the same way on every build — onClose is the
					// documented one, close() is the one every path calls.
					// Wrapping only onClose left Report and History failing
					// to come back for a writer who pressed Escape.
					let came = false;
					const back = () => {
						if (came) return;
						came = true;
						this.openBarMenu();
					};
					// Each door is rebound to the modal before it is wrapped, so the
					// wrapper never holds an unbound method.
					const prevOnClose = typeof opened.onClose === 'function' ? opened.onClose.bind(opened) : null;
					opened.onClose = () => {
						try { if (prevOnClose) prevOnClose(); }
						finally { back(); }
					};
					if (typeof opened.close === 'function') {
						const prevClose = opened.close.bind(opened);
						opened.close = () => {
							try { return prevClose(); }
							finally { back(); }
						};
					}
				}
				return;
			}
			open = (open === cur.ri) ? -1 : cur.ri;
			const keep = cur.ri;
			render();
			at = flat.findIndex(f => f.kind === 'row' && f.ri === keep);
			paint();
		};

		// The flat list, grouped back into the LINES it draws as: each entry
		// is an array of indices into `flat`. A drawer item, a rule and a
		// single row are lines of one; a band is a line of up to five. The
		// keyboard reads this rather than `flat` directly, because "down"
		// means the next LINE, not the next cell — stepping through a
		// five-cell band with Down would be walking sideways while pressing
		// down.
		const lines = () => {
			const out: number[][] = [];
			let cur: number[] = [], curBand: HTMLElement | null | undefined = undefined;
			flat.forEach((f, i) => {
				const b = f.band || null;
				if (b && b === curBand) { cur.push(i); return; }
				cur = [i]; curBand = b; out.push(cur);
			});
			return out;
		};
		const wheresAt = (ls: number[][]) => {
			for (let r = 0; r < ls.length; r++) {
				const c = ls[r].indexOf(at);
				if (c >= 0) return { r, c };
			}
			return { r: 0, c: 0 };
		};
		// Down and up move by line, keeping the column where the next line
		// is wide enough and clamping where it is not — so walking down a
		// column of narrow lines does not lose your place in the wide one.
		const move = (d: number) => {
			const ls = lines();
			if (!ls.length) return;
			const { r, c } = wheresAt(ls);
			const nr = Math.max(0, Math.min(r + d, ls.length - 1));
			const line = ls[nr];
			at = line[Math.min(c, line.length - 1)];
			paint();
		};
		// Left and right walk ALONG a line when there is a line to walk.
		// On a line of one they keep their old meanings — right opens,
		// left closes — which is what every existing menu is, so nothing
		// a writer already knows changes until they build a wide line.
		const sideways = (d: number, fallback: (() => void) | (() => boolean)) => {
			// INSIDE AN OPEN DRAWER, left and right walk the items. Each
			// item is a line of its own, so the grid logic below would
			// find nothing to walk and the keys would go dead — which is
			// exactly what a writer reported: open a row, press right,
			// nothing happens. A drawer is a list, and a list answers to
			// both axes.
			//
			// Left at the FIRST item backs out to the row that owns the
			// drawer, which is the one place left still means "out": it
			// reads as leaving the way you came in.
			const cur = flat[at];
			if (cur && cur.kind === 'item') {
				let lo = at, hi = at;
				while (lo > 0 && flat[lo - 1].kind === 'item') lo--;
				while (hi < flat.length - 1 && flat[hi + 1].kind === 'item') hi++;
				const nx = at + d;
				if (nx < lo) { fallback(); return; }
				if (nx > hi) return;
				at = nx;
				paint();
				return;
			}
			const ls = lines();
			const { r, c } = wheresAt(ls);
			const line = ls[r] || [];
			if (line.length < 2) { fallback(); return; }
			const nc = c + d;
			if (nc < 0 || nc >= line.length) { fallback(); return; }
			at = line[nc];
			paint();
		};
		const collapse = () => {
			if (open === -1) return false;
			const keep = open; open = -1; render();
			at = flat.findIndex(f => f.kind === 'row' && f.ri === keep);
			paint();
			return true;
		};

		// Vim-shaped, because the sidebars already are, with arrows beside
		// them so the dialect is optional.
		// The letter keys and the finder want the same keystrokes, and the
		// arbitration is the writer's own setting: HJKL STEER ONLY WITH
		// OBSIDIAN'S VIM MODE ON. Off, they are letters and nothing else —
		// which is the honest default, because a writer who never chose Vim
		// has no reason to expect 'h' to mean anything but 'h', and the
		// finder above them is full of schemes spelled with those letters
		// (Habamax, Kanagawa, Light / Dark).
		//
		// Even with Vim on they yield while the field has focus: typing
		// "habamax" must not collapse a row on its first character.
		// Returning true lets the key through to the input rather than
		// swallowing it. The arrows, Enter and Escape steer in every case,
		// and Ctrl+j / Ctrl+k steer while typing, for hands that would
		// rather not leave the home row.
		const typing = () => document.activeElement === search;
		const vimKeys = () => this.isVimKeysOn();
		const letter = (fn: () => void) => () => {
			if (typing() || !vimKeys()) return true;
			fn(); return false;
		};
		// The ARROWS steer unconditionally — they are not letters and can
		// never be typed into the field. Pairing them with hjkl in one
		// loop, as the first draft did, put them behind the Vim gate and
		// left a non-Vim writer with no keyboard at all; the probe caught
		// it on the first run.
		const always = (fn: () => void) => () => { fn(); return false; };
		modal.scope.register([], 'ArrowDown',  always(() => move(1)));
		modal.scope.register([], 'ArrowUp',    always(() => move(-1)));
		// Right walks along a line and does NOTHING at its end. It used to
		// open the row — which read as "sideways" on a table, where right
		// means the next cell and a drawer appearing instead is a jolt.
		// ENTER opens, in both dialects, and is the only thing that does.
		// Right on a row whose drawer is OPEN steps INTO it. Opening with
		// Enter leaves the row selected, and right then did nothing at all
		// — the drawer was on screen with no way into it but Down, which
		// is not what "right" means next to an open thing. At the end of a
		// line with nothing open, right still does nothing: there is
		// simply nowhere further right.
		const enterDrawer = () => {
			const cur = flat[at];
			if (!cur || cur.kind !== 'row' || open !== cur.ri) return;
			for (let i = at + 1; i < flat.length; i++) {
				if (flat[i].kind === 'item') { at = i; paint(); return; }
				if (flat[i].kind === 'row') return;
			}
		};
		modal.scope.register([], 'ArrowRight', always(() => sideways(1, enterDrawer)));
		modal.scope.register([], 'ArrowLeft',  always(() => sideways(-1, collapse)));
		modal.scope.register([], 'j', letter(() => move(1)));
		modal.scope.register([], 'k', letter(() => move(-1)));
		modal.scope.register([], 'l', letter(() => sideways(1, enterDrawer)));
		modal.scope.register([], 'h', letter(() => sideways(-1, collapse)));
		modal.scope.register([], 'Enter', () => { void activate(); return false; });
		// Space activates only when it cannot be a character: in the field
		// it types, and with Vim off the field is where every keystroke is
		// meant to go.
		modal.scope.register([], ' ', () => {
			if (typing() || !vimKeys()) return true;
			void activate(); return false;
		});
		modal.scope.register(['Mod'], 'j', () => { move(1);  return false; });
		modal.scope.register(['Mod'], 'k', () => { move(-1); return false; });
		// Escape closes an open row first and the modal second, so backing
		// out of a submenu does not throw the whole panel away.
		// ESCAPE, ON THE DOCUMENT, IN THE CAPTURE PHASE — and that is the
		// whole point. Obsidian's Modal registers its OWN Escape on the
		// same scope in its constructor, before this one exists, and the
		// scope runs handlers in registration order: its close() fired and
		// ours never ran at all. Every backing-out step written here was
		// dead code, which is why the drawer would not close and a typed
		// query was thrown away with the panel.
		//
		// A capture listener on `document` sees the key before any scope
		// does, so this decides. Removed on close, or it would answer for
		// a menu that is no longer on screen.
		// WHICH MENU OWNS ESCAPE is `WS_MENU_ESC.owner` — the document's, not
		// this instance's: a menu another instance leaked (a reload) sits first
		// in the listener list and would answer first.
		const onEsc = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			// Not the menu on screen: say nothing, and above all do not
			// stop the event on behalf of a panel that has gone.
			if (WS_MENU_ESC.owner !== onEsc) return;
			const stop = () => {
				e.preventDefault();
				e.stopPropagation();
				if (e.stopImmediatePropagation) e.stopImmediatePropagation();
			};
			// A query goes first: the first press undoes the typing, the
			// second leaves. Closing on the first would throw away the
			// browsing state a writer was two keystrokes from using.
			if ((search.value || '').trim()) {
				stop();
				search.value = ''; at = 0; render();
				try { search.focus(); } catch (_) { wsCatch('openBarMenu / onEsc: search.focus();', _); }
				return;
			}
			// Then an open drawer, and the menu last — backing out of a
			// submenu must not throw the whole panel away.
			if (collapse()) { stop(); return; }
			stop();
			modal.close();
		};
		document.addEventListener('keydown', onEsc, true);
		WS_MENU_ESC.owner = onEsc;
		// AND the scope, with Obsidian's own Escape taken out of it first.
		//
		// The capture listener above should be enough — it sees the key
		// before any scope does — but "should" has been wrong twice here
		// already: a listener registered earlier on the SAME node can stop
		// the event before ours is reached, and Obsidian's keymap is
		// registered at app start. So the scope path is repaired as well:
		// its own Escape entry is dropped, and ours takes its place. Both
		// paths call the same handler, and the handler is idempotent —
		// whichever arrives first does the work.
		try {
			if (modal.scope && Array.isArray(modal.scope.keys)) {
				modal.scope.keys = modal.scope.keys.filter((k) => k && k.key !== 'Escape');
			}
		} catch (_) { wsCatch('openBarMenu: if (modal.scope && Array.isArray(modal.scope.keys))', _); }
		modal.scope.register([], 'Escape', () => {
			onEsc({ key: 'Escape', preventDefault() {}, stopPropagation() {} } as KeyboardEvent);
			return false;
		});

		// Every keystroke re-renders the results. Cheap: the lists are
		// short and already rebuilt on every open and close.
		search.addEventListener('input', () => { at = 0; render(); });

		// Focused on open, because a finder you must click into is not one.
		// The list keeps its tabindex so Escape-to-list still has somewhere
		// to land.
		// RE-ASSERT ON CLOSE. A theme picked from this menu flashed on and
		// then reverted, while the very same callback fired from the
		// settings cards stuck — the difference is not the code, it is the
		// container. Obsidian's mobile modals snapshot body's style
		// attribute when they open and restore it when they close, so
		// anything written to body WHILE a modal is open is discarded the
		// moment it closes. A theme is written to body. That is the whole
		// bug, and it is why a restart appeared to fix it: at load there is
		// no modal to undo the write.
		//
		// The observer-driven guard catches this too, but only after the
		// restore fires; doing it here as well means the workspace never
		// shows the undressed frame between the two.
		modal.onClose = () => {
			try { document.removeEventListener('keydown', onEsc, true); } catch (_) { wsCatch('openBarMenu: document.removeEventListener(\'keydown\', onEsc, true);', _); }
			if (WS_MENU_ESC.owner === onEsc) WS_MENU_ESC.owner = null;
			try { document.body.classList.remove('ws-menu-open'); } catch (_) { wsCatch('openBarMenu: document.body.classList.remove(\'ws-menu-open\');', _); }
			this.barThemeOnCssChange();
			this.barThemeGuard();
		};

		// THE ✕ COMES BACK, by request — and this is a reversal of a fix
		// that took five rounds, so the reasoning is kept rather than
		// deleted. The argument for removing it was that this menu is a
		// PALETTE, not a dialogue: it applies live behind itself, Escape
		// closes it, clicking away closes it, and a close button only
		// undoes the act of opening. The vault has overruled that: the
		// affordance every other modal in Obsidian has should be here
		// too, and a writer who reaches for the corner should find it.
		//
		// What went with it: a `stripClose` sweep over three possible
		// roots (the button is a child of the modal on some builds and of
		// the CONTAINER on others), a MutationObserver re-sweeping for as
		// long as the menu was open, two more sweeps after `open()`, and
		// three stylesheet selectors — including a `body.ws-menu-open`
		// one written because the ✕ sat outside both known ancestors.
		// All of it is gone; Obsidian's own button is simply left alone.
		// The `ws-menu-open` body class STAYS: it is the marker the
		// stylesheet uses for this modal generally, not only for hiding
		// that button.
		modal.onOpen = () => {
			// A BODY CLASS, which is the one ancestor nothing can move the
			// button out of. Every earlier selector named an ancestor that
			// turned out to be wrong on this writer's build — the
			// inspector showed the rule not matching AT ALL, meaning the
			// ✕ sits outside both the modal element and the container we
			// classed. body is not a guess: while this menu is open, the
			// close button of the modal on screen is ours, and it goes.
			// classList, not addClass: the sugar is Obsidian's and this line
			// must work anywhere body does — including under a probe.
			try { document.body.classList.add('ws-menu-open'); } catch (_) { wsCatch('openBarMenu: document.body.classList.add(\'ws-menu-open\');', _); }
			list.setAttribute('tabindex', '-1');
			// A hidden finder cannot take focus \u2014 the list does, so the
			// arrows work from the first keystroke either way.
			if (searchShown) { try { search.focus(); } catch { list.focus(); } }
			else { try { list.focus(); } catch (_) { wsCatch('openBarMenu: list.focus();', _); } }
		};
		render();
		modal.open();
		return modal;
	},
};
export type MenuMethods = typeof menuMethods;
