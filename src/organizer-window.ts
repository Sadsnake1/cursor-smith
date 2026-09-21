// Word-Smith — Organizer: the Organizer: the window, its doors, the index glue, the ticks, the tree hooks.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { Menu, Notice, setIcon, getAllTags, Platform, ItemView } from 'obsidian';
import type { Events, WorkspaceLeaf, TAbstractFile, Modifier, KeymapEventListener, MenuItem } from 'obsidian';
import type { WsFlagDef, WsHost, WsFileLike, WsOrgDoor } from './settings';
import { wsCountFootnotes, wsOrgAgg, wsOrgCounts, wsOrgDistinct, wsOrgIndex, wsOrgPathsUnder, wsOrgPut, wsOrgRemove, wsOrgRename, wsOrgStale } from './org-index';
import { wsOrgCellsMake } from './organizer-cells';
import { wsOrgChromeMake } from './organizer-chrome';
import { wsOrgChipsMake } from './organizer-chips';
import { wsOrgColsMake } from './organizer-cols';
import { wsOrgDragMake } from './organizer-drag';
import { wsOrgFilesMake } from './organizer-files';
import { wsOrgFlagsMake } from './organizer-flags';
import { wsOrgJournalMake } from './organizer-journal';
import { wsOrgKeysMake } from './organizer-keys';
import { WsLensSort, WsLensChip, wsOrgLensMake } from './organizer-lens';
import { wsOrgModeMake } from './organizer-mode';
import { wsOrgNavMake } from './organizer-nav';
import { wsOrgPropsMake } from './organizer-props';
import { wsOrgReadingsMake } from './organizer-readings';
import { wsOrgRenameMake } from './organizer-rename';
import { wsOrgRowsMake } from './organizer-rows';
import { wsOrgScopeMake } from './organizer-scope';
import { wsOrgSelMake } from './organizer-sel';
import { wsOrgShapeMake } from './organizer-shape';
import { wsOrgTicksMake } from './organizer-ticks';
import { wsOrgWidthsMake } from './organizer-widths';
import { wsOrgWritesMake } from './organizer-writes';
import { wsOrgZoomMake } from './organizer-zoom';
import type { WsOrgCtx, WsOrgCtxOwn } from './org-ctx';
import type { WsOrgRow } from './organizer-rows';
import type { WsOrgColAgg } from './organizer-readings';
import { WS_FOLDER_COLOURS, WS_OUTLINER_VIEW, WS_PANE_CLASSES, WS_PANE_VIEWS, WS_STATUSES, WS_WRITE, WsOutlinerView, WsPropSuggestModal, wsCatch, wsCtxLend, wsElShown, wsFlagSvg, wsFolderSvg, wsGuard, wsGuardReport, wsMenu, wsSessionNew, wsSortArrow, wsSvgInto, wsBag, wsStatOf, wsStr, wsErrMsg, wsElOf } from './preamble';
import type { WsPropItem } from './preamble';
import type WordSmith from './plugin';
import type { WsModEvent, WsHistoryTabState, WsOrgExportCtx, WsExportPanelHandle, WsOrgHistoryCtx } from './plugin';

export const organizerWindowMethods = {

	// ── A FOLDER'S OWN MENU ──────────────────────────────────────────────────
	//
	// A METHOD, not a closure inside `onload`: everything this adds to a
	// folder's right-click — its colour, its flag — is behaviour a test can
	// drive only if it can build the menu.
	// THE REPORT ROW, on both trees. It was on the Outliner's menu and not on
	// the file explorer's, so the same right-click answered differently
	// depending on which tree the row was in — and the explorer is the tree a
	// writer is in most of the time.
	fileMenuReportRow(this: WordSmith, menu: Menu, path: string) {
		if (!path) return;
		menu.addItem((i: MenuItem) => i.setTitle('Report on this').setIcon('bar-chart-2')
			.onClick(() => { try { this.openReportModal(path); } catch (_) { wsCatch('fileMenuReportRow: this.openReportModal(path);', _); } }));
	},

	fileMenuFor(this: WordSmith, menu: Menu, file: WsFileLike) {
		if (!file || !file.path) return;
		const isFolder = !!file.children;
		// ── NOT ON EMPTY SPACE ──────────────────────────────────────────────
		//
		// Right-clicking the blank area under the last row of the file explorer
		// fires this event for the VAULT ROOT, and Obsidian's own menu there is
		// the two things you can do with no row under the pointer: New note, New
		// folder. Every row this plugin adds is about a thing that was clicked.
		// The root is `/` here and `''` everywhere else in this plugin.
		if (file.path === '/' || file.path === '') return;
		const path = file.path;

		this.fileMenuReportRow(menu, path);
		// The Organizer's rows: Organizer here, Export this, History here — the
		// tree as the window's remote, from the menu.
		try { this.fileMenuOrganizerRows(menu, file); } catch (_) { wsCatch('fileMenuFor: this.fileMenuOrganizerRows(menu, file);', _); }

		// FILE-ONLY: only files have flags. The row that reaches this closure is
		// refused for a folder below, and there is no folder store to name.
		const store = 'fileStatus';
		const nowFlag = (this.settings[store] || {})[path] || '';
		const setFlag = async (id: string) => {
			const all = Object.assign({}, this.settings[store] || {});
			if (id) all[path] = id; else delete all[path];
			this.settings[store] = all;
			await this.saveSettings(true);
			try { void this.patchExplorerDOM(); } catch (_) { wsCatch('fileMenuFor / setFlag: this.patchExplorerDOM();', _); }
		};
		const flagRows = (into: Menu) => {
			// EVERY STATE LISTED, not a cycle: a menu is a place to choose,
			// and asking somebody to press a row four times to reach "Done" is
			// a cycle wearing a menu's clothes.
			for (const st of WS_STATUSES) {
				into.addItem((i: { setTitle: (arg0: DocumentFragment) => void; setChecked: (arg0: boolean) => void; onClick: (arg0: () => Promise<void>) => void; }) => {
					const frag = createFragment();
					const mark = createSpan();
					mark.className = 'ws-menuflag is-' + st.id;
					wsSvgInto(mark, wsFlagSvg(st.id, 12));
					frag.appendChild(mark);
					frag.appendChild(document.createTextNode(st.label));
					i.setTitle(frag);
					i.setChecked(nowFlag === st.id);
					i.onClick(() => setFlag(st.id));
				});
			}
			into.addItem((i: MenuItem) => i.setTitle('No flag').setChecked(!nowFlag)
				.onClick(() => setFlag('')));
		};

		const nowColour = (this.settings.folderColors || {})[path] || '';
		const colourRow = (into: Menu) => {
			into.addItem((i: { setTitle: (arg0: DocumentFragment) => void; }) => {
				const frag = createFragment();
				const row = createSpan();
				row.className = 'ws-folderdots';
				for (const c of WS_FOLDER_COLOURS) {
					const dot = createSpan();
					dot.className = 'ws-folderdot' + (c.id ? '' : ' is-none')
						+ (nowColour === c.id ? ' is-on' : '');
					if (c.css) dot.style.backgroundColor = c.css;
					dot.setAttribute('aria-label', c.label);
					dot.title = c.label;
					dot.addEventListener('click', (ev2) => { void (async () => {
						ev2.preventDefault();
						ev2.stopPropagation();
						const all = Object.assign({}, this.settings.folderColors || {});
						if (c.id) all[path] = c.id; else delete all[path];
						this.settings.folderColors = all;
						await this.saveSettings();
						try { void this.patchExplorerDOM(); } catch (_) { wsCatch('fileMenuFor / colourRow: this.patchExplorerDOM();', _); }
						// …AND EVERY OTHER TREE SHOWING THIS FOLDER. The line above repaints
						// Obsidian's explorer and nothing else; without this a colour set from
						// the Organizer's own right-click changed the explorer behind it and not
						// the row that had just been clicked.
						try { this.treeOrderChanged(); } catch (_) { wsCatch('fileMenuFor / colourRow: this.treeOrderChanged();', _); }
						try { menu.hide(); } catch (_) { wsCatch('fileMenuFor / colourRow: menu.hide();', _); }
					})(); });
					row.appendChild(dot);
				}
				frag.appendChild(row);
				i.setTitle(frag);
			});
		};

		// SUBMENUS, because this is somebody else's menu. A right-click
		// already carries eight of Obsidian's own rows, and ours in the middle
		// of them made the plugin the loudest thing in a menu that is mostly
		// about renaming and deleting. `setSubmenu` is recent; where it is
		// missing the rows go inline, which is what they did before and is
		// worse rather than broken.
		const folded = (title: string, icon: string, fill: (into: Menu) => void) => {
			menu.addItem((i) => {
				i.setTitle(title);
				try { if (i.setIcon) i.setIcon(icon); } catch (_) { wsCatch('fileMenuFor / folded: if (i.setIcon) i.setIcon(icon);', _); }
				let sub = null;
				try { if (typeof i.setSubmenu === 'function') sub = i.setSubmenu(); } catch (_) { wsCatch('fileMenuFor / folded: if (typeof i.setSubmenu === \'function\') sub = i.setSubmenu();', _); }
				if (sub) fill(sub);
				else { i.setIsLabel(true); fill(menu); }
			});
		};

		// COLOUR IS A FOLDER'S. It is drawn on the folder glyph, and a note
		// has none — a colour that changed nothing anybody can see is a
		// setting that reads as broken.
		if (isFolder) folded('Folder color', 'palette', colourRow);
		// AND A FLAG IS A FILE'S, the mirror of the line above it. ONE guard
		// closes all THREE doors, because all three funnel through here: the
		// explorer's right-click, the Organizer tree's row menu, and the
		// table's group-header menu.
		if (!isFolder && WS_STATUSES.length) folded('Flag', 'flag', flagRows);

	},

	// ── ANY PROPERTY, AS A COLUMN ───────────────────────────────────────────
	//
	// A writer who keeps `deadline:` or `pov:` in their frontmatter can put it
	// in the Organizer beside the word counts — out of the metadata cache,
	// never written.
	//
	// A USER COLUMN'S ID IS NAMESPACED — `fm:deadline`, not `deadline` —
	// because the built-in ids are stored in `uniColsOff` and as the sort, and
	// a property called `words` or `mark` would otherwise silently become one
	// of ours.
	propColId(this: WordSmith, key: string) { return 'fm:' + String(key || ''); },

	propColKey(this: WordSmith, id: string) {
		const s = String(id || '');
		return s.indexOf('fm:') === 0 ? s.slice(3) : '';
	},

	// The raw value, whatever YAML made of it.
	//
	// ── THE KEY IS MATCHED WITHOUT REGARD TO CASE ───────────────────────────
	//
	// YAML keys ARE case-sensitive and Obsidian's cache reports them exactly
	// as typed, so `date:` in one note and `Date:` in another are two
	// different properties as far as the vault is concerned. They are not two
	// different properties as far as the WRITER is concerned — it is the same
	// field typed twice over months — and the consequence is two columns,
	// both labelled DATE, each half full.
	//
	// So one column reads either spelling. This is the plugin being lenient
	// about a distinction the writer did not mean to draw, which is the same
	// judgement the goals file makes when it accepts a hyphen where it writes
	// an em dash.
	//
	// EXACT FIRST, THEN THE FIRST CASE-INSENSITIVE MATCH IN THE NOTE'S OWN KEY
	// ORDER. A note carrying BOTH spellings is the case that has to be
	// decided rather than left to chance: the exact one is what the column
	// asked for and wins, and where neither is exact the note's own ordering
	// decides, which is stable across reads.
	propRaw(this: WordSmith, path: string, key: string): unknown {
		try {
			const want = String(key || '');
			if (!want) return undefined;
			const f = this.app.vault.getAbstractFileByPath(String(path || ''));
			if (!f || f.children) return undefined;
			const cache = this.app.metadataCache
				&& this.app.metadataCache.getFileCache(f);
			const fm = cache && cache.frontmatter;
			// ── NO FRONTMATTER IS NOT THE SAME AS NO PROPERTY ─────────────────
			//
			// A `.md` with none has none: Obsidian owns that answer and this
			// must not offer a second one. A file that CANNOT hold
			// frontmatter keeps its properties in `ws-structure.md`, and
			// `propStoreHolds` is the one predicate that tells the two apart
			// — so a note falls straight through this branch unchanged.
			if (!fm) {
				const sv = this.propStoreGetSync(String(path || ''), want);
				return sv === '' ? undefined : sv;
			}
			if (Object.prototype.hasOwnProperty.call(fm, want)) return fm[want];
			const low = want.toLowerCase();
			for (const k of Object.keys(fm)) {
				if (k.toLowerCase() === low) return fm[k];
			}
			return undefined;
		} catch { return undefined; }
	},

	// What a cell says. A LIST BECOMES A COUNT, with the values on the hover:
	// the Tags column already learnt this — six values rendered small are six
	// unreadable words in a column that then decides how wide every row is.
	// A nested map has no reading at all and says so rather than printing
	// `[object Object]`.
	propText(this: WordSmith, path: string, key: string) {
		const v = this.propRaw(path, key);
		if (v == null || v === '') return '';
		// ── A LIST SAYS WHAT IS IN IT, NOT HOW MUCH ────────────────────────
		//
		// JOINED, AND LET THE COLUMN CUT IT. `widthOf` caps a property column
		// at COL_MAX_TEXT_CH, the cell ellipses, and `propTitle` already put
		// the whole list on the hover — so "Anna, Ben, Cora" becomes
		// "Anna, Ben, C…" in a narrow pane and the full list is one hover
		// away. That is strictly more than a count could say in the same room,
		// which is the answer to what a long list of tags does here.
		if (Array.isArray(v)) {
			const kept = v.filter(x => x != null && typeof x !== 'object');
			return kept.length ? kept.map(String).join(', ') : '';
		}
		if (typeof v === 'object') return '\u2014';
		if (typeof v === 'boolean') return v ? 'yes' : 'no';
		return wsStr(v);
	},

	propTitle(this: WordSmith, path: string, key: string) {
		const v = this.propRaw(path, key);
		if (Array.isArray(v)) {
			return v.filter(x => x != null && typeof x !== 'object').map(String).join(', ');
		}
		if (v && typeof v === 'object') return 'Word-Smith cannot show a nested property in a column.';
		return v == null ? '' : wsStr(v);
	},

	// ── HOW A PROPERTY SORTS, WHICH IS THE WHOLE DIFFICULTY ─────────────────
	//
	// `deadline: 2028-08-18` is parsed by YAML as a DATE. `deadline: 18 Aug
	// 2028` is a STRING — and sorted as one, "18 Aug 2028" comes before
	// "2 Sep 2027", because "1" sorts before "2". The column looks sorted.
	// It is confidently wrong and nothing on screen says so.
	//
	// So the type is SNIFFED ACROSS THE VALUES ACTUALLY PRESENT rather than
	// guessed from the first one: every value a number is numeric, every
	// value a parseable date is chronological, anything else is text. All or
	// nothing — one unparseable value among fifty dates makes the column
	// text, because a mixed column sorted as dates puts that row somewhere
	// arbitrary and the writer cannot see which rule it lost to.
	//
	// AND THE ANSWER IS SHOWN, in the column's own menu, and can be
	// overridden — a guess a writer can see and correct is a different thing
	// from a guess.
	//
	// DATES ARE NOT PARSED BY `new Date(string)` ALONE. That accepts almost
	// anything and invents a reading for it: `new Date('Chapter 4')` is
	// Invalid, but `new Date('4')` is the year 2001. So a bare number is
	// never a date, and a string has to carry a month name or two
	// separators before it is offered to the parser at all.
	propLooksLikeDate(this: WordSmith, v: unknown) {
		if (v instanceof Date) return !isNaN(v.getTime());
		if (typeof v !== 'string') return false;
		const s = v.trim();
		if (!s || /^-?[\d.,]+$/.test(s)) return false;
		const shaped = /\d{4}-\d{2}-\d{2}/.test(s)
			|| /\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(s)
			|| /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s);
		if (!shaped) return false;
		const t = Date.parse(s);
		return !isNaN(t);
	},

	propSortAs(this: WordSmith, key: string, paths: string[]) {
		const seen = [];
		for (const p of (paths || [])) {
			const v = this.propRaw(p, key);
			if (v == null || v === '') continue;
			if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) continue;
			seen.push(v);
		}
		if (!seen.length) return 'text';
		if (seen.every(v => typeof v === 'number'
			|| (typeof v === 'string' && /^-?[\d.,]+$/.test(v.trim()) && v.trim() !== ''))) {
			return 'number';
		}
		if (seen.every(v => this.propLooksLikeDate(v))) return 'date';
		return 'text';
	},

	// ── WHAT KINDS OF FILE THE ORGANIZER DRAWS ──────────────────────────────
	//
	// One table, so the menu that offers the toggles and the test that
	// applies them cannot drift apart. `icons` is a LIST tried in order,
	// because `setIcon` with a name this build's Lucide does not know draws
	// NOTHING and does not throw.
	// ── THE TAGS ON A NOTE, AS OBSIDIAN SEES THEM ───────────────────────────
	//
	//
	// THROUGH THE METADATA CACHE, and that is the whole design decision here.
	// A tag can be written in two places — the `tags:` property and an inline
	// `#tag` in the body — and Obsidian has already resolved both. Reading the
	// frontmatter alone would quietly miss every inline tag; parsing the body
	// ourselves would be a second implementation of something the app is
	// already authoritative about, free to disagree with it.
	//
	// `getAllTags` IS THE ONE THAT KNOWS BOTH, and it is not on every API
	// version — so the cache's own two lists are the fallback, and an empty
	// array is the answer when neither is there. A throw inside a filter
	// predicate runs once per row per draw.
	//
	// THE LEADING `#` IS KEPT. It is what Obsidian returns, it is what a writer
	// recognises, and stripping it here would mean putting it back in every
	// place that shows one.
	uniTagsOf(this: WordSmith, path: string) {
		try {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (!f) return [];
			const cache = this.app.metadataCache
				&& this.app.metadataCache.getFileCache(f);
			if (!cache) return [];
			const all = (typeof getAllTags === 'function') ? getAllTags(cache) : null;
			if (Array.isArray(all)) return all;
			const out = [];
			for (const t of (cache.tags || [])) {
				if (t && t.tag) out.push(String(t.tag));
			}
			const fm: unknown = cache.frontmatter && cache.frontmatter.tags;
			for (const t of (Array.isArray(fm) ? fm : (fm ? [fm] : []))) {
				const v = String(t || '').trim();
				if (v) out.push(v[0] === '#' ? v : '#' + v);
			}
			return out;
		} catch { return []; }
	},

	// Every tag in the notes currently in scope, commonest first — the list
	// the filter menu offers. Same shape as `propKeysInScope`, and for the
	// same reason: a menu of four hundred tags is not a menu, so the ones a
	// writer actually uses come first and the tail is reachable by search.
	uniTagsInScope(this: WordSmith, paths: string[]) {
		const seen = new Map<string, number>();
		for (const p of (paths || [])) {
			for (const t of this.uniTagsOf(p)) {
				seen.set(t, (seen.get(t) || 0) + 1);
			}
		}
		return Array.from(seen.keys())
			.sort((a, b) => ((seen.get(b) || 0) - (seen.get(a) || 0)) || a.localeCompare(b))
			.map(t => ({ tag: t, n: seen.get(t) || 0 }));
	},

	uniTypeGroups(this: WordSmith) {
		return [
			{ id: 'md',     label: 'Notes',  icons: ['file-text', 'file'],
				ext: ['md'] },
			{ id: 'image',  label: 'Images', icons: ['image', 'file-image', 'file'],
				ext: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'] },
			{ id: 'canvas', label: 'Canvas', icons: ['layout-dashboard', 'layout', 'file'],
				ext: ['canvas'] },
			{ id: 'base',   label: 'Bases',  icons: ['database', 'table', 'file'],
				ext: ['base'] },
			// THE PLAIN SHEET: `file-type` drew a page with an A on it, so a .pdf row
			// wore a different glyph from the .docx and .xlsx rows beside it — one
			// difference, in the one place the format is already written out in words.
			{ id: 'pdf',    label: 'PDFs',   icons: ['file'],
				ext: ['pdf'] },
			{ id: 'audio',  label: 'Audio',  icons: ['file-audio', 'music', 'file'],
				ext: ['mp3', 'wav', 'm4a', 'ogg', 'flac', '3gp'] },
			{ id: 'video',  label: 'Video',  icons: ['file-video', 'video', 'file'],
				ext: ['mp4', 'mkv', 'mov', 'webm', 'ogv'] },
			// The catch-all has no extension list: it claims whatever no
			// group above did, so a kind nobody thought of has a door in.
			{ id: 'other',  label: 'Other files', icons: ['file'], ext: null }
		];
	},

	// The group a file belongs to, by extension — 'other' when nothing
	// claims it. `file` may be a TFile or anything with a path; the stubbed
	// vaults carry no `extension`, so the path answers when it is absent.
	uniTypeGroupOf(this: WordSmith, file: { path: string; extension?: string }) {
		const ext = String((file && file.extension)
			|| String((file && file.path) || '').split('.').pop() || '')
			.toLowerCase();
		for (const g of this.uniTypeGroups()) {
			if (g.ext && g.ext.indexOf(ext) !== -1) return g.id;
		}
		return 'other';
	},

	// The enabled set, normalised. Absent or empty settings mean the
	// default — notes only — because an empty set would draw a tree of
	// folders with nothing in them and read as broken rather than as strict.
	uniTypeSet(this: WordSmith) {
		const raw = this.settings && this.settings.uniTypes;
		const list = Array.isArray(raw) && raw.length ? raw : ['md'];
		return new Set(list);
	},

	uniTypeAllows(this: WordSmith, file: { path: string; extension?: string }) {
		const set = this.uniTypeSet();
		const g = this.uniTypeGroupOf(file);
		if (g !== 'other') return set.has(g);
		// AN EXTENSION OF ITS OWN: `ext:docx` in the set narrows Other to that
		// extension; `other` itself is still everything the kinds do not name.
		if (set.has('other')) return true;
		const ext = String((file && file.extension)
			|| String((file && file.path) || '').split('.').pop() || '').toLowerCase();
		return !!ext && set.has('ext:' + ext);
	},

	// Move one row to another's place, keeping everything else in order.
	// Split out of the drag handler so the ORDER can be tested without a
	// pointer: dragging is untestable in a headless probe, and the thing
	// worth testing is not the drag, it is that a novel comes out in the
	// order the writer left it in.
	// ── Dragging, on a screen with no mouse ─────────────────────────────────
	//
	// HTML5 drag-and-drop DOES NOT EXIST ON TOUCH. `dragstart` and its
	// family are never fired by a finger, so every reorderable list in this
	// plugin — the export tree, the menu's rows, the theme shelf — looked
	// draggable on a tablet and moved for nobody. Obsidian runs on iPads
	// and Android tablets, which is exactly the machine somebody curates a
	// manuscript on, so this is a missing feature rather than a small one.
	//
	// One helper for all three, because three hand-rolled touch handlers
	// is three chances to get the scroll interaction wrong. It is
	// deliberately NOT a drag library: press, hold briefly, move, drop.
	//
	//   el        the row being made draggable
	//   id        what to hand back on a drop
	//   opts.rows () => every draggable element, to hit-test against
	//   opts.idOf (element) => its id
	//   opts.drop (fromId, toId, after) => do the move and redraw
	//
	// THE HOLD IS THE WHOLE DESIGN. A list that scrolls and a list whose
	// rows drag are the same pixels, and the only thing that can tell a
	// scroll from a drag is intent expressed in TIME: move within 400ms and
	// the list scrolls as it always did; hold still first and the row comes
	// with you. Under the threshold nothing is preventDefault'd, so a
	// flick scrolls exactly as it would if this code were not here.
	touchDrag(this: WordSmith, el: HTMLElement, id: string, opts: { rows: () => HTMLElement[]; idOf: (el: HTMLElement) => string | null; drop: (from: string, to: string, below: boolean) => void }) {
		const HOLD = 400;          // ms before a press becomes a drag
		const SLOP = 10;           // px of movement that cancels the hold
		let timer: number | null = null, dragging = false, startY = 0, startX = 0;

		const marks = () => {
			for (const r of opts.rows()) {
				r.removeClass('is-over-top');
				r.removeClass('is-over-bottom');
			}
		};
		const stop = () => {
			if (timer) { window.clearTimeout(timer); timer = null; }
			if (dragging) el.removeClass('is-dragging');
			dragging = false;
			marks();
		};
		const under = (y: number) => {
			for (const r of opts.rows()) {
				const b = r.getBoundingClientRect();
				if (y >= b.top && y <= b.bottom) return { row: r, below: (y - b.top) > b.height / 2 };
			}
			return null;
		};

		el.addEventListener('touchstart', (ev: TouchEvent) => {
			if (!ev.touches || ev.touches.length !== 1) return;
			startY = ev.touches[0].clientY;
			startX = ev.touches[0].clientX;
			timer = window.setTimeout(() => {
				dragging = true;
				el.addClass('is-dragging');
				// A short buzz where the platform has one: the hold is
				// invisible otherwise, and a writer holding a row with
				// nothing happening lets go at 300ms every time.
				try { if (window.navigator && window.navigator.vibrate) window.navigator.vibrate(15); } catch (_) { wsCatch('touchDrag: if (window.navigator && window.navigator.vibrate) …', _); }
			}, HOLD);
		}, { passive: true });

		el.addEventListener('touchmove', (ev: TouchEvent) => {
			if (!ev.touches || !ev.touches.length) return;
			const y = ev.touches[0].clientY;
			if (!dragging) {
				// Moved before the hold finished: this is a scroll, and
				// the timer must not fire underneath it.
				if (Math.abs(y - startY) > SLOP || Math.abs(ev.touches[0].clientX - startX) > SLOP) stop();
				return;
			}
			// Now it is a drag, so the list must NOT scroll under it.
			ev.preventDefault();
			marks();
			const hit = under(y);
			if (hit && hit.row !== el) hit.row.addClass(hit.below ? 'is-over-bottom' : 'is-over-top');
		}, { passive: false });

		el.addEventListener('touchend', (ev: TouchEvent) => {
			if (!dragging) { stop(); return; }
			const t = (ev.changedTouches && ev.changedTouches[0]) || null;
			const hit = t ? under(t.clientY) : null;
			stop();
			if (!hit || hit.row === el) return;
			const to = opts.idOf(hit.row);
			if (to == null || to === id) return;
			opts.drop(id, to, hit.below);
		});
		el.addEventListener('touchcancel', stop);
	},

	// ── THE UNIFIED WINDOW ──────────────────────────────────────────────────
	//
	// ONE WINDOW. A tree on the left, an inspector on the right, and the tabs
	// across the inspector answer for whatever the tree has lit.
	// THE TREE IS THE NAVIGATOR, and it is the only one. Everything this
	// window knows about "where are we looking" is the set of rows lit in it.
	// Ticks belong to the Export tab and to nothing else: a checkbox means
	// "this one is in", which is meaningless in the other two tabs.
	// ── THE HOST SEAM ───────────────────────────────────────────────────────
	//
	// The window is usable BESIDE the writing — dragged out, docked to a
	// side, or opened as a tab, the way Obsidian's own panes work. A modal
	// cannot be any of those: it is a sheet over the app that takes the
	// whole window and gives it back when you close it. So the eight lines
	// that touch the host are named as a HOST, and somebody else supplies one.
	//
	// What a host owes this window:
	//   `rootEl`     the element that wears `ws-uni-modal` and `is-narrow`
	//   `contentEl`  what the window is built into
	//   `key`        register a keystroke, and hand back nothing
	//   `contains`   is this event inside us? \u2014 for the Escape ladder
	//   `onClose`    run this when the window goes
	//   `show`       put it on screen
	//
	// `modalHost` below is the sheet; the pane's host is built by
	// `WsOutlinerView` (preamble.ts) to the same shape.
	modalHost(this: WordSmith): WsHost | null {
		// `wsModal`, not the constructor: a window that is not on the
		// register outlives its plugin.
		const modal = this.wsModal();
		if (!modal) return null;
		return {
			kind: 'modal',
			modal,
			rootEl: modal.modalEl,
			contentEl: modal.contentEl,
			containerEl: modal.containerEl,
			closes: true,
			key: (mods: Modifier[], k: string, fn: KeymapEventListener) => modal.scope.register(mods, k, fn),
			contains: (el: Node) => {
				try { return !!(modal.containerEl && modal.containerEl.contains(el)); }
				catch { return false; }
			},
			onClose: (fn: () => void) => {
				const was = modal.onClose ? modal.onClose.bind(modal) : null;
				modal.onClose = () => { try { fn(); } catch (_) { wsCatch('modalHost / onClose: fn();', _); } if (was) was(); };
			},
			show: () => modal.open(),
			// ── AND A WINDOW CAN REFUSE TO GO ────────────────────────────
			//
			// Obsidian's own Escape runs before anything this window can register:
			// the modal's scope runs the first match, and the app's keymap is bound
			// above a capture listener on the container and even on `window`. So
			// instead of racing for the EVENT the EFFECT is guarded: whoever wins
			// the key, closing goes through `close()`, and a window that declines to
			// shut cannot be shut by an Escape it never saw. The test does the
			// cancelling too, so one press still ends the rename.
			blockClose: (test: () => boolean) => {
				const real = modal.close.bind(modal);
				modal.close = () => { if (test()) return; real(); };
			},
			handle: () => modal
		};
	},

	// ── THE ORGANIZER INDEX — the glue ─────────────────────────────────────
	//
	// The pure store and its arithmetic live in org-index.ts; these methods
	// are the only place the store meets Obsidian. The rules:
	//
	// · FED BY THE VAULT AND ITS EVENTS, never by what is drawn or
	// folded. Nothing in here may touch the DOM, and nothing in the
	// window may write the index — the edit flow is strictly
	// view → writer → vault → metadata event → index → view.
	// · MEMBERSHIP IS `isFileCounted`, the same one writer every other
	// total in this plugin uses. If a note is out of the report's
	// figures it is out of these, or two windows would disagree about
	// one manuscript.
	// · MTIME-CACHED: the sweep re-reads only what changed. Opening the
	// window twice costs one read of the notes that were edited
	// between, not a read of the vault.
	// · COUNTED BY `analyzeText`/`countTasks` — the counters the report
	// already answers with. The index adds no third opinion about what
	// a word is.

	// Start (or join) the index. Idempotent: the first call builds and
	// watches; every later call returns the same store's build promise.
	orgIndexEnsure(this: WordSmith) {
		if (this._orgIndex) {
			// AN EMPTY INDEX OVER A VAULT WITH NOTES IS NOT AN ANSWER. The tree's
			// first paint of a session starts the index before the vault has listed
			// its files; that sweep sees nothing and, left alone, the index stayed
			// empty for the session. Sweep again the moment the vault answers.
			if (this._orgIndexBuild == null && !this._orgIndex.size && this.orgIndexVaultHasNotes()) return this.orgIndexResweep();
			return this._orgIndexBuild ?? Promise.resolve(this._orgIndex);
		}
		this._orgIndex = wsOrgIndex();
		this._orgIndexWatch();
		return this.orgIndexResweep();
	},

	// One sweep, joined if one is running: the build promise is the one every
	// caller waits on, and the bell rings when it lands.
	orgIndexResweep(this: WordSmith) {
		if (this._orgIndexBuild != null) return this._orgIndexBuild;
		this._orgIndexBuild = this.orgIndexSweep()
			.then((ix) => { this._orgIndexRing(); return ix; })
			.finally(() => { this._orgIndexBuild = null; });
		return this._orgIndexBuild;
	},

	orgIndexVaultHasNotes(this: WordSmith) {
		try { return !!(this.app.vault.getMarkdownFiles && this.app.vault.getMarkdownFiles().length); }
		catch { return false; }
	},

	// A STORE PATH JUST BECAME KNOWN. The history store is located lazily —
	// `historyFindFile` reads the vault for it the first time the history is
	// needed — and the structure store's memory of where it was found fills
	// on its first read; an index swept before either answered counted the
	// note like any other, and the tree showed the plugin's own table as the
	// writer's words. The stores are left out everywhere else, so the moment
	// one is located its reading leaves the index and the bell rings; a
	// store the index never held costs one lookup.
	orgIndexStoreKnown(this: WordSmith, path: string | null | undefined) {
		if (!path || !this._orgIndex) return;
		if (wsOrgRemove(this._orgIndex, path)) this._orgIndexRing();
	},

	// The index's change bell. A view subscribes to repaint FROM the index
	// (never to re-derive); the glue rings it after every write it takes.
	// Rung once per sweep and once per event — the subscriber owns its own
	// debounce, because how often to repaint is a VIEW question.
	orgIndexOnChange(this: WordSmith, cb: () => void) {
		if (!this._orgIndexSubs) this._orgIndexSubs = new Set();
		this._orgIndexSubs.add(cb);
		return () => { this._orgIndexSubs.delete(cb); };
	},

	_orgIndexRing(this: WordSmith) {
		for (const cb of (this._orgIndexSubs || [])) {
			try { cb(); } catch (_) { wsCatch('_orgIndexRing: cb();', _); }
		}
	},

	// One pass over the vault's markdown files. Reads what is stale,
	// removes what stopped belonging (deleted while we were not looking,
	// or excluded by a membership change) — so the sweep leaves the index
	// EXACTLY the counted vault, whatever happened while the plugin was
	// off. Folds, panes and tabs do not exist down here.
	async orgIndexSweep(this: WordSmith) {
		const ix = this._orgIndex;
		const files = (this.app.vault.getMarkdownFiles
			&& this.app.vault.getMarkdownFiles()) || [];
		const seen = new Set();
		for (const f of files) {
			if (!f || !f.path) continue;
			if (!this.isFileCounted(f)) continue;
			seen.add(f.path);
			const mt = (f.stat && f.stat.mtime) || 0;
			if (!wsOrgStale(ix, f.path, mt)) continue;
			try { await this.orgIndexRead(f); } catch (_) { wsCatch('orgIndexSweep: await this.orgIndexRead(f);', _); }
		}
		for (const p of Array.from(ix.keys())) {
			if (!seen.has(p)) wsOrgRemove(ix, p);
		}
		return ix;
	},

	// Read ONE file into the index: one cachedRead, both counters, and the
	// cache's frontmatter (shallow-copied by the store's writer — Obsidian
	// mutates that object in place).
	async orgIndexRead(this: WordSmith, f: TAbstractFile) {
		if (!this._orgIndex || !f || !f.path) return null;
		const text = await this.app.vault.cachedRead(f);
		// MEMBERSHIP AGAIN, AFTER THE READ. The history store is located lazily
		// (`historyFindFile`, a read of the vault), so a note can become a store
		// while its own read is in flight. What is not counted is not put,
		// whoever asked.
		if (!this.isFileCounted(f)) { wsOrgRemove(this._orgIndex, f.path); return null; }
		const st = this.analyzeText(text);
		const tk = this.countTasks(text);
		let props = null;
		try {
			const c = this.app.metadataCache.getFileCache(f);
			props = (c && c.frontmatter) || null;
		} catch (_) { wsCatch('orgIndexRead: const c = this.app.metadataCache.getFileCache(f);', _); }
		return wsOrgPut(this._orgIndex, f.path, {
			words: st.words, paras: st.paragraphs,
			// Straight from the same `analyzeText` call that gives the words:
			// measured already, discarded until now.
			charsNoSpaces: st.charsNoSpaces,
			charsWithSpaces: st.charsWithSpaces,
			sentences: st.sentences,
			// Footnotes — the definitions written in the note and its inline ones,
			// counted once each.
			footnotes: wsCountFootnotes(text),
			tasks: tk, grade: st.sentences ? st.grade : undefined,
			mtime: (wsStatOf(f) || { mtime: 0 }).mtime || 0,
			ctime: (wsStatOf(f) || { ctime: 0 }).ctime || 0,
			props
		});
	},

	// The events. `metadataCache.changed` fires after a file's content and
	// cache are both current, which is the moment a reading can be taken;
	// rename MOVES the entry (the text did not change); delete removes it.
	// Registered through `registerEvent`, so unload cleans up.
	_orgIndexWatch(this: WordSmith) {
		const md = (f: TAbstractFile) => f && f.path && /\.md$/i.test(f.path);
		// Guarded registration: a stub vault (and, in principle, a host build)
		// may carry no event bus. An index that cannot watch is still an index —
		// the sweep still answers.
		const reg = (bus: Events, name: string, fn: (...data: never[]) => unknown) => {
			try {
				if (!bus || typeof bus.on !== 'function') return;
				// Guarded like the rest; its own registration rather than `onAppEvent`
				// because of the stub-vault check above.
				const ref = bus.on(name, wsGuard(fn, 'the org index\u2019s ' + name + ' handler'));
				try { this.registerEvent(ref); } catch (_) { wsCatch('_orgIndexWatch / reg: this.registerEvent(ref);', _); }
			} catch (_) { wsCatch('_orgIndexWatch / reg: if (!bus || typeof bus.on !== \'function\') return;', _); }
		};
		reg(this.app.metadataCache, 'changed', (f: TAbstractFile) => {
			if (!md(f) || !this._orgIndex) return;
			if (!this.isFileCounted(f)) {
				if (wsOrgRemove(this._orgIndex, f.path)) this._orgIndexRing();
				return;
			}
			this.orgIndexRead(f).then(() => this._orgIndexRing()).catch(() => {});
		});
		reg(this.app.vault, 'delete', (f: TAbstractFile) => {
			if (md(f) && this._orgIndex
				&& wsOrgRemove(this._orgIndex, f.path)) this._orgIndexRing();
		});
		// THE VAULT ARRIVES AFTER THE PLUGIN: `resolved` is the cache's word
		// that its first pass over the vault is done — and later, that a batch
		// of changes has settled. A sweep then is the one that FILLS an index
		// started too early; on a settled vault it is a walk of mtimes and
		// nothing read.
		reg(this.app.metadataCache, 'resolved', () => {
			if (!this._orgIndex) return;
			void this.orgIndexResweep();
		});
		reg(this.app.vault, 'rename', (f: TAbstractFile, oldPath: string) => {
			if (!md(f) || !this._orgIndex) return;
			if (wsOrgRename(this._orgIndex, oldPath, f.path)) {
				this._orgIndexRing();
			} else {
				// A file we had never read moved into view — read it.
				this.orgIndexRead(f).then(() => this._orgIndexRing()).catch(() => {});
			}
		});
		// No 'create' handler: a brand-new note fires `metadataCache.changed`
		// once its cache exists, and reading it before that would index a
		// note whose frontmatter Obsidian has not parsed yet.
	},

	// ── THE ONE FRONTMATTER WRITER ─────────────────────────────────────────
	//
	// Every property edit in the Organizer lands here and nowhere else,
	// through `app.fileManager.processFrontMatter` — atomic, and the only
	// API that keeps the writer's other keys. CAVEAT (in the README): the
	// first write may normalize that note's frontmatter formatting (quoting,
	// key order).
	//
	// An EMPTY value deletes the key: an empty field means "no value", and a
	// `pov: ""` line left behind would be a value to every filter and
	// enumeration in the window. The add-property flow never writes an empty
	// value at all — it opens an editor and commits only what gets typed.
	//
	// The key is matched without regard to case against what the note
	// already carries (the propRaw rule), so editing `Pov` from a column
	// labelled `pov` rewrites the writer's key rather than adding a twin.
	async orgPropWrite(this: WordSmith, path: string, key: string, value: unknown) {
		const f = this.app.vault.getAbstractFileByPath(String(path || ''));
		if (!f || f.children || !key) return false;
		// ── A FILE WITH NO FRONTMATTER TO PROCESS ────────────────────────
		//
		// `processFrontMatter` writes into the file itself, which is the
		// right answer for a `.md` and impossible for a `.pdf`. The fork is
		// HERE, at the one writer, rather than at the cells: the drafts, the
		// menus and anything added later all reach this function without
		// passing a cell, and a guard on the door is not a guard on the
		// write.
		//
		// THE SAME PREDICATE BOTH WAYS. `propStoreHolds` decides who stores
		// where, and it is asked here and in every read — so a property can
		// never be written to one place and looked for in the other.
		if (this.propStoreHolds(String(path || ''))) {
			return await this.propStoreSet(String(path), key, value);
		}
		const empty = value === undefined || value === null || value === ''
			|| (Array.isArray(value) && !value.length);
		try {
			await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
				let real = String(key);
				for (const k of Object.keys(fm || {})) {
					if (k.toLowerCase() === String(key).toLowerCase()) { real = k; break; }
				}
				if (empty) delete fm[real];
				else fm[real] = value;
			});
			// Told once per subject, and re-armed here so the next failure is news.
			// The value on screen goes back on its own — the cell repaints from the
			// note, so a writer sees their typing appear and then vanish. Without a
			// word for it that reads as the plugin throwing the edit away.
			return this.storeWriteOk(WS_WRITE.prop);
		} catch (e) {
			return this.storeWriteFailed(WS_WRITE.prop, e,
				'The cell has gone back to what the note says.');
		}
	},

	// WHAT THE WRITER CHOSE FOR THIS KEY IN OUR OWN PANEL, or '' if they
	// never said. Stored on the column beside its label, so it travels with
	// the column and disappears with it — a type for a column nobody has is
	// a fact about nothing.
	orgPropTypeChosen(this: WordSmith, key: string) {
		const k = String(key || '').toLowerCase();
		if (!k) return '';
		try {
			const cols = (this.settings && this.settings.uniUserCols) || [];
			for (const c of cols) {
				if (!c || !c.key || !c.type) continue;
				if (String(c.key).toLowerCase() === k) return String(c.type);
			}
		} catch (_) { wsCatch('orgPropTypeChosen: const cols = (this.settings && this.settings.uniUserCols) || [];', _); }
		return '';
	},

// What KIND of value a property holds, from Obsidian's own registry
// (metadataTypeManager) — feature-detected, because the API has moved
// between builds and a stub has none. '' means "unknown; infer from the
// value at hand".
	orgPropType(this: WordSmith, key: string) {
		const k = String(key || '').toLowerCase();
		if (k === 'tags') return 'tags';
		if (k === 'aliases') return 'multitext';
		try {
			const mt = this.app.metadataTypeManager;
			if (mt) {
				// THE NAMES THIS BUILD HAS (measured on 1.13.7): `getAssignedType` is
				// NOT a function — the call threw straight into the catch below, silently
				// — and `properties[k]` is `{ name, widget, occurrences }`: the field is
				// `widget`, `.type` is undefined on every entry. Both misses were
				// invisible, because '' means "infer from the value" and the fallbacks
				// guess right often enough.
				//
				// Ordered assigned-then-inferred, which is Obsidian's own precedence:
				// `getAssignedWidget` is what the WRITER chose in the properties UI,
				// `getPropertyInfo` is what Obsidian worked out for itself (and it
				// answers 'text' for a key it has never seen, which is a better default
				// than '').
				if (typeof mt.getAssignedWidget === 'function') {
					const w = mt.getAssignedWidget(k);
					// a name, or (1.13) the widget object with its type
					if (typeof w === 'string' && w) return w;
					if (w && typeof w === 'object' && w.type) return String(w.type);
				}
				// ── AND THEN WHAT THE WRITER CHOSE HERE ───────────────────
				//
				// `getPropertyInfo` answers 'text' for a key it has never seen — a fair
				// default for a key the vault knows; for one invented a second ago it is
				// an assertion dressed as an inference. So a remembered type goes here,
				// between what OBSIDIAN WAS TOLD and what OBSIDIAN GUESSED: an explicit
				// choice in either interface beats an inference, and a choice made in
				// Obsidian's own properties pane still wins over ours, because that is
				// the vault's answer about the vault's data. It matters most where
				// Obsidian can never learn: a non-md file keeps its properties in
				// `ws-structure.md`, which Obsidian does not read.
				const mine = this.orgPropTypeChosen(k);
				if (mine) return mine;
				if (typeof mt.getPropertyInfo === 'function') {
					const pi = mt.getPropertyInfo(k);
					if (pi && pi.widget) return String(pi.widget);
				}
				const info = mt.properties && mt.properties[k];
				if (info && info.widget) return String(info.widget);
				// THE OLDER SPELLINGS, kept and kept LAST. They are not
				// dead code to delete on sight: this plugin ships to vaults
				// on other builds, the API has moved once already, and a
				// feature-detected branch costs nothing when it is absent.
				if (typeof mt.getAssignedType === 'function') {
					const t = mt.getAssignedType(k);
					if (t) return String(t);
				}
				if (info && info.type) return String(info.type);
			}
		} catch (_) { wsCatch('orgPropType: const mt = this.app.metadataTypeManager;', _); }
		return '';
	},

	// ── ONE PLACE A DAY BECOMES A STRING ───────────────────────────────
	//
	// PURE, AND THE STYLE IS PASSED IN. `formatValue` hands it through so it
	// stays testable without settings; `orgStamp` below reads the setting and
	// hands it to the same function. A third format cannot appear without
	// being added here.
	dateText(this: WordSmith, y: number, mo: number, d: number, hh: number | null | undefined, mi: number | null | undefined, style: string) {
		const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
			'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const two = (n: number) => (n < 10 ? '0' : '') + n;
		const st = String(style || 'human');
		let out;
		if (st === 'iso') out = y + '-' + two(mo + 1) + '-' + two(d);
		else if (st === 'dmy') out = two(d) + '/' + two(mo + 1) + '/' + y;
		else if (st === 'mdy') out = two(mo + 1) + '/' + two(d) + '/' + y;
		// 'human' AND ANYTHING UNRECOGNISED. A hand-edited data.json must not
		// be able to make every date in the window disappear.
		else out = d + ' ' + MONTHS[mo] + ' ' + y;
		if (hh !== null && hh !== undefined) out += ' ' + two(hh) + ':' + two(mi || 0);
		return out;
	},

	// The writer's choice, with the default spelled once.
	dateStyle(this: WordSmith) {
		try { return String((this.settings && this.settings.organizerDateFormat) || 'human'); }
		catch { return 'human'; }
	},

	// A FILE TIME, THROUGH THE SAME RENDERER. Local getters on purpose: a
	// file's mtime is a moment, and the writer wants it in their own clock.
	// (A date PROPERTY is a written-down day and is read as typed — see the
	// UTC note in `formatValue`. Those are different facts, not two answers
	// to one; only the SHAPE is shared.)
	orgStamp(this: WordSmith, ms: number) {
		const n = Number(ms);
		if (!n || !isFinite(n)) return '';
		const dt = new Date(n);
		return this.dateText(dt.getFullYear(), dt.getMonth(), dt.getDate(),
			dt.getHours(), dt.getMinutes(), this.dateStyle());
	},

	// ── ONE VALUE, ONE FORMATTER ─────────────────────────────────────────
	//
	// PURE, AND A METHOD ONLY SO IT CAN BE TESTED. It touches no `this`; the
	// prototype is simply how a plain-node test reaches it. Every caller
	// passes the type in rather than looking it up, so this cannot become a
	// second reader of the registry.
	//
	// `ok: false` IS THE POINT OF THE RETURN SHAPE. A value that does not
	// parse as its DECLARED type is not printed as though it were fine — the
	// caller draws it muted with the raw string on hover. Malformed
	// frontmatter becomes visible instead of plausible.
	//
	// NO LOCALE IN THE MONTH, deliberately: a locale month makes every
	// reading a function of the machine drawing it.
	//
	// AND THE DATE IS PARSED BY PATTERN, NOT BY `new Date(string)`. `new
	// Date('1999-01-22')` is UTC midnight while `new Date('1999-01-22T09:30')`
	// is LOCAL — mixing them puts a note a day earlier for anyone west of
	// Greenwich. A regex has no timezone.
	formatValue(this: WordSmith, key: string, raw: unknown, type: string, style: string) {
		const done = (text: string, ok: boolean) => ({ text: text, ok: ok !== false });

		// NOTHING IS A STATE, NOT A FAULT. A property a note has not filled in
		// is the commonest value in any vault.
		if (raw === null || raw === undefined || raw === '') return done('', true);

		const t = String(type || '').toLowerCase();

		if (t === 'checkbox' || typeof raw === 'boolean') {
			return done(raw === true ? '\u2713' : '', true);
		}

		// LISTS FIRST, and by the VALUE's shape as well as the declared type:
		// a `tags` key holding one string is still a list to the writer.
		if (Array.isArray(raw) || t === 'tags' || t === 'multitext' || t === 'aliases') {
			const arr = Array.isArray(raw) ? raw : [raw];
			const kept = arr.filter((x: null) => x !== null && x !== undefined && typeof x !== 'object');
			return done(kept.map((x) => String(x).trim()).join(', '), true);
		}

		// An object that is not an array has no honest one-line rendering.
		if (typeof raw === 'object' && !(raw instanceof Date)) return done('\u2014', false);

		if (t === 'number') {
			const n = Number(raw);
			// A NUMBER WRITTEN AS TEXT IS STILL A NUMBER. Frontmatter is typed
			// by hand and `count: "1234"` is what a hand types.
			if (raw === true || raw === false || !isFinite(n)) return done(wsStr(raw), false);
			return done(n.toLocaleString(), true);
		}

		if (t === 'date' || t === 'datetime' || raw instanceof Date) {
			let y, mo, d, hh = null, mi = null;
			if (raw instanceof Date) {
				if (isNaN(raw.getTime())) return done(String(raw), false);
				// UTC GETTERS, to match the pattern branch below: a YAML parser
				// that hands over a Date built from an ISO day built it at UTC
				// midnight, and local getters would move it a day west of here.
				y = raw.getUTCFullYear(); mo = raw.getUTCMonth(); d = raw.getUTCDate();
				if (t === 'datetime') { hh = raw.getUTCHours(); mi = raw.getUTCMinutes(); }
			} else {
				const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(wsStr(raw).trim());
				if (!m) return done(wsStr(raw).trim(), false);
				y = Number(m[1]); mo = Number(m[2]) - 1; d = Number(m[3]);
				if (m[4] !== undefined) { hh = Number(m[4]); mi = Number(m[5]); }
				// A PATTERN IS NOT A CALENDAR. `2026-02-31` matches the shape and
				// is not a day; saying so is the whole reason `ok` exists.
				//
				const LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
				const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
				const max = (mo === 1 && leap) ? 29 : LEN[mo];
				if (mo < 0 || mo > 11 || d < 1 || d > max) return done(wsStr(raw).trim(), false);
				if (hh !== null && (hh > 23 || (mi !== null && mi > 59))) return done(wsStr(raw).trim(), false);
			}
			// THROUGH THE ONE RENDERER, so a date property and a Modified cell
			// cannot disagree about what a day looks like.
			return done(this.dateText(y, mo, d, hh, mi, style), true);
		}

		// TEXT, AND ANYTHING UNDECLARED. `app.metadataTypeManager` is a private
		// API: when it is absent every key comes back typeless, and a formatter
		// that flagged those would make a whole vault look broken.
		return done(wsStr(raw).trim(), true);
	},

	// Every property name the vault knows — the registry first (it holds
	// names from notes this index may exclude), the index as the fallback.
	orgKnownProps(this: WordSmith) {
		const seen = new Map<string, string>();
		try {
			const mt = this.app.metadataTypeManager;
			const all = mt && mt.properties;
			if (all) {
				for (const k of Object.keys(all)) {
					const name = (all[k] && all[k].name) || k;
					if (!seen.has(String(name).toLowerCase())) {
						seen.set(String(name).toLowerCase(), String(name));
					}
				}
			}
		} catch (_) { wsCatch('orgKnownProps: const mt = this.app.metadataTypeManager;', _); }
		if (this._orgIndex) {
			for (const r of this._orgIndex.values()) {
				if (!r || !r.props) continue;
				for (const k of Object.keys(r.props)) {
					if (!seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k);
				}
			}
		}
		return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
	},

	// The questions the window asks. Null when the index has not answered
	// yet — a caller renders a blank, never a zero: unknown is not empty.
	orgWordsOf(this: WordSmith, path: string) {
		const r = this._orgIndex && this._orgIndex.get(String(path));
		return r ? r.words : null;
	},

	orgAggUnder(this: WordSmith, folder: string) {
		if (!this._orgIndex) return null;
		return wsOrgAgg(this._orgIndex, wsOrgPathsUnder(this._orgIndex, folder));
	},

	// WITH THE STORE'S ROWS: a .pdf has no index row, and its values would
	// otherwise never be offered or counted.
	orgDistinctUnder(this: WordSmith, folder: string, key: string) {
		if (!this._orgIndex) return [];
		return wsOrgDistinct(this._orgIndex,
			wsOrgPathsUnder(this._orgIndex, folder), key, this.propStoreRowsUnder(folder, key));
	},

	// …and how many notes carry each of them. Same paths, same rules, one
	// walk apart — see `wsOrgCounts` for why it is a sibling of the
	// enumerator rather than a wider return from it.
	orgCountsUnder(this: WordSmith, folder: string, key: string) {
		if (!this._orgIndex) return new Map<string, number>();
		return wsOrgCounts(this._orgIndex,
			wsOrgPathsUnder(this._orgIndex, folder), key, this.propStoreRowsUnder(folder, key));
	},

	openManuscriptModal(this: WordSmith, opts: { tab?: string; host?: WsHost; only?: boolean }) {
		const o = opts || {};
		// A HOST IS HANDED IN by the pane, or the sheet's is made here: the
		// caller decides what this window lives inside, and the window does not
		// know or care.
		const host = o.host || this.modalHost();
		if (!host) return;
		// ── NO TITLE ON THIS WINDOW ─────────────────────────────────────────
		//
		// The title ELEMENT stays where Obsidian put it and simply holds
		// nothing. Removing it is not ours to do: it is the modal's own
		// furniture, and a theme that positions the close button against it
		// would have nothing to position against.
		host.rootEl.addClass('ws-uni-modal');
		if (host.paneClass) host.rootEl.addClass(host.paneClass);
		// One aurora palette per OPENING, not per draw: the inspector
		// rebuilds on every tab switch and on every cursor move, and
		// re-rolling the colours there reads as a glitch rather than as a
		// thing you were dealt. Same reason, same line, as the report.
		this._auroraSeed = Math.random();

		const s = this.settings;
		for (const k of ['fileGoals', 'fileStatus']) {
			if (!wsBag(s)[k]) wsBag(s)[k] = {};
		}
		// DEAD KEYS, DELETED ON LOAD: a dead key that still parses is a trap for
		// whoever reuses the name.
		delete s.orgLenses;
		delete s.uniSlimCol;
		delete s.organizerView;
		delete s.organizerDrawer;
		// ONE STORE FOR TARGETS: a folder is the sum of its notes, and the table
		// gets a folder row's number from `ORG_AGG` summing over the rows as shown.
		const goalStore   = (): 'fileGoals' => 'fileGoals';
		// ONE STORE, because only files have flags; `markOf` answers '' for a
		// folder rather than reading a key that does not exist.
		const statusStore = (): 'fileStatus' => 'fileStatus';
		const targetOf = (path: string|number) => Number(s[goalStore()][path]) || 0;
		const markOf   = (path: string|number, kind: string) => (kind === 'folder' ? ''
			: (s[statusStore()][path] || ''));

		// ── WHICH DOCUMENT THIS WINDOW IS IN ────────────────────────────
		//
		// A POPOUT IS A DIFFERENT DOCUMENT. This window is a leaf as well as
		// a sheet, and a leaf can be dragged into its own OS window - which
		// `openOutlinerPane` has always said is the whole reason it is one.
		// In that window `document` and `window` still name the MAIN one, so
		// every bare reference addresses a page the writer is not looking at:
		// a selection that never highlights, a drag whose mouseup never
		// arrives, an Escape that reaches nothing.
		//
		// ONE WRITER FOR THE FACT. Everything below asks these two rather
		// than the globals, so there is one description of where this window
		// lives instead of eight that have to be kept in step.
		//
		// FALLING BACK TO THE GLOBALS is not a nicety: `contentEl` is detached
		// in a fixture, where `ownerDocument` is still right but `defaultView`
		// can be null.
		const ownerDoc = () => {
			try { return host.contentEl.ownerDocument || document; }
			catch { return document; }
		};
		const ownerWin = () => {
			try { return ownerDoc().defaultView || window; }
			catch { return window; }
		};
		const body  = host.contentEl.createDiv({ cls: 'ws-uni-body' });
		// ACROSS THE TOP OF THE WINDOW, not inside the inspector: a tab that
		// hides the inspector would hide the tabs with it.
		const tabsRow = body.createDiv({ cls: 'ws-uni-tabs' });
		// ONE TAB ONLY: a pane built for one tab hides the strip — the three
		// tabs are three panes — and its tab cannot be switched.
		const single = !!o.only;
		if (single) body.addClass('is-single');
		// ONE COLUMN. `cols` keeps its box for the stylesheet's sake and holds
		// the one pane there is.
		const cols  = body.createDiv({ cls: 'ws-uni-cols' });
		const right = cols.createDiv({ cls: 'ws-uni-right' });
		const foot  = body.createDiv({ cls: 'ws-uni-foot' });

		// NARROW IS MEASURED, NOT ASKED OF THE PLATFORM. A sheet is always the
		// same size, but a leaf is whatever width the writer dragged it to —
		// docked into a sidebar it can be 260px on a desktop. The phone still
		// declares itself, because a phone is narrow before anything has been
		// measured; a pane is measured, and re-measured when it is dragged
		// (`ResizeObserver`).
		//
		// THE THRESHOLD HAS ONE READER: `--ws-uni-narrow`, declared on
		// `.ws-uni-modal` in the stylesheet beside the rules it switches. The
		// `700` is a fallback for a root that is not styled yet; a test
		// holds it against the stylesheet's own number so the two cannot drift.
		// A PANE BUILT FOR ONE TAB HAS NO TREE COLUMN TO STACK, so its limit is
		// the phone's, `--ws-uni-narrow-single`, not the two-column window's.
		const orgNarrowLimit = () => {
			const fallback = single ? 420 : 700;
			try {
				const said = getComputedStyle(host.rootEl)
					.getPropertyValue(single ? '--ws-uni-narrow-single' : '--ws-uni-narrow');
				const n = parseInt(String(said).trim(), 10);
				return isFinite(n) && n > 0 ? n : fallback;
			} catch { return fallback; }
		};
		const narrow = !!(Platform && Platform.isMobile);
		if (narrow) host.rootEl.addClass('is-narrow');
		// organizer-nav.ts reads this closure through the names below and
		// nothing else; the aliases keep the names the closure calls.
		const orgNav = wsOrgNavMake({
			plugin: this,
			get body() { return body; },
			get host() { return host; },
			get narrow() { return narrow; },
			get orgNarrowLimit() { return orgNarrowLimit; },
		});
		// ── THE SELECTION ───────────────────────────────────────────────────
		//
		// One object the whole window shares. Each path carries its own kind —
		// a selection can hold a chapter FOLDER and a scene at once, which two
		// clicks produce — and the Map keeps them in the order they were picked.
		//
		// EMPTY MEANS THE WHOLE VAULT. The window is useful the instant it
		// opens: before anything is clicked the inspector is already answering
		// for the entire manuscript.
		// ── HOW YOU WERE LOOKING LAST TIME ───────────────────────────────
		//
		// The window remembers its state while Obsidian runs and forgets it on
		// a restart. ON THE INSTANCE, never on disk: a restart, a reload and a
		// disable/enable cycle each give a fresh window for free — there is
		// nothing to migrate and no key to go stale.
		//
		// WRITTEN ON EVERY CHANGE, NOT ON CLOSE, which is the whole design: a
		// deploy orphans this window, Escape closes it, and Obsidian can close
		// it under us — an on-close snapshot misses all three.
		const ses = this._wsSession || (this._wsSession = wsSessionNew());
		// organizer-zoom.ts reads this closure through the names below.
		const orgZoom = wsOrgZoomMake({
			plugin: this,
			get body() { return body; },
			get ses() { return ses; },
		});
		const zoomTag = orgZoom.zoomTag;
		// organizer-sel.ts reads this closure through the names below.
		const orgSel = wsOrgSelMake({
			plugin: this,
			get orgNarrowNow() { return orgNarrowNow; },
			get ses() { return ses; },
		});
		const sel = orgSel.sel;
		const keyOf = orgSel.keyOf;
		const itemOf = orgSel.itemOf;
		const selRows = orgSel.selRows;
		const orgBulkPaths = orgSel.orgBulkPaths;
		const orgBulkSay = orgSel.orgBulkSay;
		// THE HISTORY OF ONE NOTE: the note the tree handed the window (`orgNote`,
		// set by `orgFollow`) is the History tab's subject while it is set; the
		// Organizer's table is a folder's and keeps reading the folder.
		const subjectRows = () => {
			const note = tab === 'history' ? orgScope.orgNote : '';
			if (note) return [{ kind: 'file', path: note }];
			return orgFolder ? [{ kind: 'folder', path: orgFolder }] : [];
		};

		// ── THE TICKS ───────────────────────────────────────────────────────
		//
		// What is IN the manuscript, as against what order it is in. A tick is
		// the only thing the Export tab adds to a row, and it means one thing:
		// this one is in. THE TREE GROWS A CHECKBOX COLUMN ON THIS TAB AND LOSES
		// IT ON THE OTHERS — a tick is meaningless in the Organizer and History
		// tabs, and a column of boxes nobody can act on is a column to read past.
		//
		// THE EXPORT IS THE VAULT, AND THE TREE'S BOXES CHOOSE. The Export tab
		// does not follow the Organizer's folder: it gathers the vault, its ticks
		// live in the store's root section, and "Export this" on a folder or a
		// note is a set of ticks (`ticksOnly`), not a scope.
		const exportScopes = (): string[] | null => null;
		const exportScope = () => {
			const many = exportScopes();
			if (many && many.length === 1) return many[0];
			// NOTHING CHOSEN MEANS THE VAULT. Several folders are never a scope: a
			// composite key like `A|B` would be an entry in a PATH-KEYED store that
			// no rename walk could follow.
			return '';
		};
		// organizer-ticks.ts owns the tick set, the scope it was read for, the
		// write's debounce and the per-draw index of what each row governs, and
		// reads this closure through the names below.
		const orgTicks = wsOrgTicksMake({
			plugin: this,
			scopes: () => exportScopes(),
			scope: () => exportScope(),
			select: (p) => { orgSelect(p); },
			redraw: () => { draw(); drawPanel(); },
			said: (m) => said(m),
			// ON SCREEN, NOT MERELY ON THE EXPORT TAB. A docked pane left on Export
			// and put behind another tab, or in a collapsed sidebar, would keep the
			// boxes of a tab nobody can see. Obsidian's `isShown` is the same
			// question the leaf answers for itself.
			wanted: () => tab === 'export' && wsElShown(host.rootEl)
		});
		const exportFiles = orgTicks.files;
		const loadTicks = orgTicks.load;

		// organizer-shape.ts reads this closure through the names below.
		const orgShape = wsOrgShapeMake({
			plugin: this,
			get draw() { return draw; },
			get drawPanel() { return drawPanel; },
			get fill() { return fill; },
			get s() { return s; },
		});
		// ── THREE TABS, ALL LABELLED ────────────────────────────────────────
		//
		// The Organizer and the Export are two answers to one question: what is
		// in the book, and in what order. They belong side by side and they
		// belong labelled. Only the LABEL says Organizer: the view type stays
		// `word-smith-outliner` and the command ids stay as they are, because
		// those are written into saved workspaces and into whatever hotkeys the
		// writer has set, and renaming them would silently drop a pane on the
		// next restart.
		const TABS = [
			{ id: 'organizer', label: 'Organizer', icon: 'list-tree', tree: 'binder' },
			// THE EXPORT'S OWN GLYPH, the one the docked menu has always used
			// for the same command. Two pictures for one act is how a writer
			// learns two things instead of one; `book-open` was this window's
			// invention and nothing else in the plugin used it.
			{ id: 'export',   label: 'Export',    icon: 'file-output', tree: 'ticks' },
			{ id: 'history',  label: 'History',   icon: 'history',   tree: 'slim' }
		// THE SWITCH: with the Organizer off the window has two tabs.
		].filter((t) => t.id !== 'organizer' || this.settings.organizerOn !== false);
		// AN EXPLICIT ASK WINS OVER THE MEMORY. A command that says “open on
		// History” means it; the memory is only the answer to “open it again”.
		let tab: string = TABS.some(t => t.id === o.tab) ? String(o.tab)
			: (TABS.some(t => t.id === ses.tab) ? String(ses.tab) : TABS[0].id);
		ses.tab = tab;

		// ── THE ORGANIZER'S SELECTION — one variable, one writer ────────────
		//
		// WHICH FOLDER the right pane is about. Empty means the whole vault.
		// `orgSelect` is the only thing that CALLS it — the crumbs and the
		// explorer's door do — so there is exactly one place a selection change
		// can happen and exactly one place to persist it (it survives sessions).
		//
		// Validated on the way in, not on the way out: a folder deleted while
		// the window was shut falls back to the root rather than leaving the
		// right pane describing a path nothing has.
		const orgFolderOk = (p: string) => {
			if (!p) return false;
			try {
				const at = this.app.vault.getAbstractFileByPath(p);
				return !!(at && at.children);
			} catch { return false; }
		};
		let orgFolder = orgFolderOk(String(s.organizerFolder || ''))
			? String(s.organizerFolder) : '';
		// ── AND THE SESSION WINS INSIDE A SESSION ────────────────────────
		//
		// `organizerFolder` is the folder ACROSS restarts; the session is the
		// folder across opens, and the fresher of the two. TAKEN AS-IS, not
		// re-validated: it can only have come from `orgFolderSet`, which
		// validated it on the way in, and `''` is a real answer meaning the
		// whole vault.
		if (ses.folder !== null) orgFolder = String(ses.folder);
		// ── AND THERE ARE THREE WRITERS OF IT, NOT ONE ───────────────
		//
		// `orgSelect`, and `orgFollow` twice — once for a folder row, once for
		// the parent of a note. A session recorded in one writer only stayed
		// blank on the path a writer takes most, so THE ASSIGNMENT IS THE DOOR
		// and all three go through it.
		const orgFolderSet = (v: string) => {
			orgFolder = orgFolderOk(v) ? String(v) : '';
			try { if (this._wsSession) this._wsSession.folder = orgFolder; } catch (_) { wsCatch('openManuscriptModal / orgFolderSet: if (this._wsSession) this._wsSession.folder = orgFolder;', _); }
			return orgFolder;
		};
		// A pane can be dragged narrow on a desktop, so narrowness is the
		// CLASS the ResizeObserver maintains, not the platform flag — asking
		// `narrow` here would give a docked 300px pane the wide behaviour.
		const orgNarrowNow = () => {
			try { return host.rootEl.classList.contains('is-narrow'); }
			catch { return false; }
		};
		// organizer-scope.ts reads this closure through the names below.
		const orgScope = wsOrgScopeMake({
			plugin: this,
			get draw() { return draw; },
			get drawPanel() { return drawPanel; },
			get folderOf() { return folderOf; },
			get keyOf() { return keyOf; },
			get orgFolder() { return orgFolder; },
			get orgFolderOk() { return orgFolderOk; },
			get orgFolderSet() { return orgFolderSet; },
			get orgSel() { return orgSel; },
			get s() { return s; },
		});
		const orgSelect = orgScope.orgSelect;
		const orgFollow = orgScope.orgFollow;
		const orgIndexChanged = this.orgIndexOnChange(() => {
			if (tab !== 'organizer') return;
			if (orgScope.orgDrawTimer) window.clearTimeout(orgScope.orgDrawTimer);
			orgScope.orgDrawTimer = window.setTimeout(() => {
				orgScope.orgDrawTimer = null;
				if (tab !== 'organizer') return;
				try { pruneUserCols(); } catch (_) { wsCatch('orgIndexChanged: pruneUserCols();', _); }
				draw();
				drawPanel();
			}, 150);
		});

		// organizer-lens.ts reads this closure through the names below.
		const orgLensBox = wsOrgLensMake({
			plugin: this,
			get drawPanel() { return drawPanel; },
			get orgFolder() { return orgFolder; },
			get s() { return s; },
			get ses() { return ses; },
		});
		const orgLensOn = orgLensBox.orgLensOn;
		const orgLensSet = orgLensBox.orgLensSet;
		const orgLensClear = orgLensBox.orgLensClear;
		const orgAt = orgLensBox.orgAt;
		const orgOpen = new Set<string>(s.organizerOpen);
		const orgIsOpen = (p: string) => orgOpen.has(p);
		// The table always shows its rows; the bar's Collapse all folds the
		// folders.
		// ── ONE WRITE AND ONE REDRAW, HOWEVER MANY FOLDERS MOVE ────────
		//
		// Fold-all once looped over every foldable path calling the single-path
		// setter, and each call saved the settings AND rebuilt the whole panel —
		// six full `drawPanel` runs for five rows, seconds on a real book. SO
		// THE MANY-PATH FORM IS THE ONE THAT DOES THE WORK and the single-path
		// form calls it.
		const orgOpenSetMany = (paths: string[], on: boolean) => {
			let moved = 0;
			for (const p of paths) {
				if (on ? orgOpen.has(p) : !orgOpen.has(p)) continue;
				if (on) orgOpen.add(p); else orgOpen.delete(p);
				moved++;
			}
			// NOTHING MOVED, NOTHING WRITTEN. Folding an already-folded set
			// used to cost a save and a redraw all the same.
			if (!moved) return;
			s.organizerOpen = Array.from(orgOpen);
			this.saveSettings().catch(() => {});
			drawPanel();
		};
		const orgOpenSet = (p: string, on: boolean) => orgOpenSetMany([p], on);
		// organizer-rows.ts reads this closure through the names below.
		const orgRows = wsOrgRowsMake({
			plugin: this,
			get orgIsOpen() { return orgIsOpen; },
		});
		const orgRowList = orgRows.orgRowList;
		const orgUnder = orgRows.orgUnder;
		const orgOutLinks = orgRows.orgOutLinks;
		const orgBackMap = orgRows.orgBackMap;
		// ── UNDO AND REDO — THE JOURNAL (organizer-journal.ts) ──────────────
		//
		// `wsOrgJournalMake` takes the three things it reads — the bar's
		// repaint, the word beside the buttons, the foot for a failure — and
		// hands back push / run / api / on.
		//
		// THE WORD BESIDE UNDO AND REDO: held on the context for six seconds,
		// painted by the bar — which the draw rebuilds, so the word cannot live
		// on the bar's own element.
		const ORG_BARSAY_MS = 6000;
		const orgBarSay = (msg: string) => {
			tableCtx.orgBarSaid = msg ? { msg: String(msg), until: Date.now() + ORG_BARSAY_MS } : null;
			try { if (tableCtx.orgBarSayPaint) tableCtx.orgBarSayPaint(); } catch (_) { wsCatch('orgBarSay: tableCtx.orgBarSayPaint();', _); }
		};
		this._orgBarSay = () => (tableCtx.orgBarSaid && Date.now() < tableCtx.orgBarSaid.until) ? tableCtx.orgBarSaid.msg : '';
		const orgJournal = wsOrgJournalMake({
			paint: () => { if (tableCtx.orgHistPaint) tableCtx.orgHistPaint(); },
			say: orgBarSay,
			fail: (msg) => said(msg, true)
		});
		const orgHistPush = orgJournal.push;
		const orgHistRun = orgJournal.run;
		const orgHistApi = orgJournal.api;
		const orgHistOn = orgJournal.on;
		// organizer-writes.ts reads this closure through the names below.
		const orgWrites = wsOrgWritesMake({
			plugin: this,
			get orgBulkPaths() { return orgBulkPaths; },
			get orgBulkSay() { return orgBulkSay; },
			get orgHistOn() { return orgHistOn; },
			get orgHistPush() { return orgHistPush; },
			get orgPropValue() { return orgPropValue; },
		});
		const orgPendDrop = orgWrites.orgPendDrop;
		const orgPendGet = orgWrites.orgPendGet;
		const orgPendSame = orgWrites.orgPendSame;
		const orgPropSet = orgWrites.orgPropSet;
		const orgPropListSet = orgWrites.orgPropListSet;
		// organizer-readings.ts reads this closure through the names below.
		const orgReadings = wsOrgReadingsMake({
			plugin: this,
			get markOf() { return markOf; },
			get nameOf() { return nameOf; },
			get orgBackMap() { return orgBackMap; },
			get orgOutLinks() { return orgOutLinks; },
			get orgPendDrop() { return orgPendDrop; },
			get orgPendGet() { return orgPendGet; },
			get orgPendSame() { return orgPendSame; },
			get targetOf() { return targetOf; },
		});
		const orgColRaw = orgReadings.orgColRaw;
		const orgColText = orgReadings.orgColText;
		const orgColAgg = orgReadings.orgColAgg;
		// organizer-chips.ts reads this closure through the names below.
		const orgChips = wsOrgChipsMake({
			plugin: this,
			get markOf() { return markOf; },
			get orgRowList() { return orgRowList; },
		});
		const orgPropKeys = orgChips.orgPropKeys;
		// organizer-rename.ts reads this closure through the names below.
		const orgRename = wsOrgRenameMake({
			plugin: this,
			get orgEditDone() { return orgEditDone; },
			get orgHistPush() { return orgHistPush; },
			get orgProps() { return orgProps; },
			get ownerDoc() { return ownerDoc; },
			get ownerWin() { return ownerWin; },
			get panel() { return panel; },
			get said() { return said; },
		});
		const orgFlags = wsOrgFlagsMake({
			plugin: this,
			get s() { return s; },
			get statusStore() { return statusStore; },
			get markOf() { return markOf; },
			get drawPanel() { return drawPanel; },
			get orgBulkPaths() { return orgBulkPaths; },
			get orgBulkSay() { return orgBulkSay; },
			get orgCellHint() { return orgFiles.orgCellHint; }, set orgCellHint(v) { orgFiles.orgCellHint = v; },
			get orgHistPush() { return orgHistPush; },
			get orgHistOn() { return orgHistOn; },
			get COLS() { return orgCols.COLS; },
			get orgColText() { return orgColText; },
			get orgColRaw() { return orgColRaw; },
			get orgColAgg() { return orgColAgg; },
			get orgUnder() { return orgUnder; },
			get orgAt() { return orgAt; },
			get tableCtx() { return tableCtx; },
		});
		const orgFlagSet = orgFlags.orgFlagSet;
		// organizer-cells.ts reads this closure through the names below.
		const orgCells = wsOrgCellsMake({
			plugin: this,
			get drawPanel() { return drawPanel; },
			get drawOrg() { return drawOrg; },
			get goalStore() { return goalStore; },
			get nameOf() { return nameOf; },
			get openRow() { return openRow; },
			get orgBulkPaths() { return orgBulkPaths; },
			get orgBulkSay() { return orgBulkSay; },
			get orgColRaw() { return orgColRaw; },
			get orgEditDone() { return orgEditDone; },
			get orgFieldEditor() { return orgFieldEditor; },
			get orgHistOn() { return orgHistOn; },
			get orgHistPush() { return orgHistPush; },
			get orgOtherEditorOpen() { return orgOtherEditorOpen; },
			get orgProps() { return orgProps; },
			get s() { return s; },
			get targetOf() { return targetOf; },
		});
		const orgTagWrap = orgCells.orgTagWrap;
		const orgTagPill = orgCells.orgTagPill;
		// organizer-drag.ts reads this closure through the names below.
		const orgDrag = wsOrgDragMake({
			plugin: this,
			get folderOf() { return folderOf; },
			get nameOf() { return nameOf; },
			get panel() { return panel; },
			get said() { return said; },
		});
		// organizer-mode.ts reads this closure through the names below.
		const orgModeBox = wsOrgModeMake({
			plugin: this,
			get drawPanel() { return drawPanel; },
			get orgOpen() { return orgOpen; },
			get orgOpenSet() { return orgOpenSet; },
			get s() { return s; },
		});
		const orgWidths = wsOrgWidthsMake({
			plugin: this,
			get drawPanel() { return drawPanel; },
			get orgGripDrag() { return orgZoom.orgGripDrag; }, set orgGripDrag(v) { orgZoom.orgGripDrag = v; },
			get orgNarrowNow() { return orgNarrowNow; },
			get ownerWin() { return ownerWin; },
			get s() { return s; },
			get ses() { return ses; },
		});
		const orgColFit = orgWidths.orgColFit;
		// THE FOLDER THE PANE IS ON, FOR A TEST TO READ. A READER, NOT A WRITER:
		// `orgSelect` stays the one thing that sets this — a door that could set
		// it would be a second writer of the folder.
		this._orgAt = () => orgFolder;
		// ── THE TREE'S REMOTE ───────────────────────────────────────────
		//
		// Obsidian's own tree drives this window: a folder click chooses, the
		// note you open is followed. The window registers what it can do with
		// the plugin and takes itself off the list when it closes. `select` is
		// the one writer of organizerFolder; `follow` keeps the scope when it
		// already holds the note and moves to the note's folder when it does not.
		const treeDoor: WsOrgDoor = {
			kind: host.kind,
			select: (p: string) => {
				// PINNED, THE DOOR IS SHUT: a folder clicked in the explorer is the
				// explorer's business; the pane stays where it was pinned.
				if (s.organizerPinned) return;
				// A folder chosen while History is up is the folder's history: the note
				// it was scoped to is let go. `orgSelect` keeps a note that is under the
				// folder, which is right for the table's cursor and wrong for a scope.
				if (tab === 'history') orgScope.orgNote = '';
				orgSelect(p == null || p === '/' ? '' : String(p));
			},
			follow: (p: string) => {
				if (!p) return;
				// PINNED: a note the folder holds is still marked; one it does not hold
				// changes nothing — no jump, no mark outside the pane.
				if (s.organizerPinned && !orgScope.orgScopeHolds(String(p))) return;
				orgFollow({ kind: 'file', path: String(p) }, true);
				draw();
				drawPanel();
				// THE READER FOLLOWS TOO: click a ticked file in Obsidian's tree and the
				// reader goes to it.
				if (exportOpts && exportOpts.jumpTo && tab === 'export') {
					try { exportOpts.jumpTo(String(p)); } catch (_) { wsCatch('treeDoor.follow: exportOpts.jumpTo(String(p));', _); }
				}
			},
			tab: () => tab,
			single: () => single,
			// THE MENUS' DOORS: switch the tab and say which host this is so a pane
			// can be revealed.
			tabSet: (id: string) => tabSet(id),
			host: () => host,
			// THE TICKS FOR OBSIDIAN'S TREE are the ticks module's door: state and
			// toggle, all / some / none.
			ticks: orgTicks.door,
			// "Export this" / "Export these" from the tree: exactly these go out.
			// The ticks are read first, so the set lands on the vault's list and not
			// on nothing.
			ticksOnly: (paths: string[]) => orgTicks.setOnly(paths)
		};
		this.orgWindowAdd(treeDoor);
		// A READER, like _orgAt: the note the pane holds, so a test can tell
		// "unmarked in the tree" from "forgotten".
		this._orgNote = () => orgScope.orgNote;
		// ── THE LENS, DRIVEN ────────────────────────────────────
		//
		// The filters are built through SUBMENUS, which open on a real pointer
		// event and cannot be driven by script; this door is how a test sets a
		// lens. IT WRITES NO STORE. `orgLens` is a local: the lens is a
		// session's reading of the manuscript, not a setting.
		this._orgLens = () => JSON.parse(JSON.stringify(orgLensBox.orgLens)) as typeof orgLensBox.orgLens;
		this._orgLensSet = (patch: { sort?: WsLensSort|null; chips?: WsLensChip[]; }) => orgLensSet(patch);
		// A door for a test: the key picker's list goes to a suggest modal no
		// script can open.
		this._orgPropKeys = (at: string) => orgPropKeys(at);
		this._orgPropRows = () => orgPropPanelRows();
		// organizer-props.ts reads this closure through the names below.
		const orgProps = wsOrgPropsMake({
			plugin: this,
			get COLS() { return orgCols.COLS; },
			get ORG_PROP_DOORS() { return ORG_PROP_DOORS; },
			get SORTS() { return orgCols.SORTS; },
			get addProp() { return addProp; },
			get colOff() { return colOff; },
			get draw() { return draw; },
			get drawPanel() { return drawPanel; },
			get fill() { return fill; },
			get liveFiles() { return liveFiles; },
			get orgColFit() { return orgColFit; },
			get orgPropListSet() { return orgPropListSet; },
			get orgPropSet() { return orgPropSet; },
			get orgTagPill() { return orgTagPill; },
			get orgTagWrap() { return orgTagWrap; },
			get ownerDoc() { return ownerDoc; },
			get ownerWin() { return ownerWin; },
			get panel() { return panel; },
			get s() { return s; },
			get host() { return host; },
		});
		const orgPropPopEl = orgProps.orgPropPopEl;
		const orgPropPanelRows = orgProps.orgPropPanelRows;
		const orgPropSubEl = orgProps.orgPropSubEl;
		const orgPropSubClose = orgProps.orgPropSubClose;
		const orgPropPopClose = orgProps.orgPropPopClose;
		const orgOtherEditorOpen = orgProps.orgOtherEditorOpen;
		const orgEditDone = orgProps.orgEditDone;
		const orgPropValue = orgProps.orgPropValue;
		const orgFieldEditor = orgProps.orgFieldEditor;
		// organizer-cols.ts reads this closure through the names below.
		const orgCols = wsOrgColsMake({
			plugin: this,
			get draw() { return draw; },
			get drawPanel() { return drawPanel; },
			get fill() { return fill; },
			get liveFiles() { return liveFiles; },
			get orgLens() { return orgLensBox.orgLens; }, set orgLens(v) { orgLensBox.orgLens = v; },
			get s() { return s; },
			get ses() { return ses; },
		});
		const colOff = orgCols.colOff;
		const pruneUserCols = orgCols.pruneUserCols;
		const addProp = orgCols.addProp;
		const ORG_PROP_DOORS = orgCols.ORG_PROP_DOORS;
		// organizer-files.ts reads this closure through the names below.
		const orgFiles = wsOrgFilesMake({
			plugin: this,
			get keyOf() { return keyOf; },
			get orgSel() { return orgSel; },
		});
		const folderOf = orgFiles.folderOf;
		const nameOf = orgFiles.nameOf;
		const liveFiles = orgFiles.liveFiles;
		let draw = () => {};
		let fill = async () => {};
		let drawPanel = () => {};

		// ── A row's five readings ───────────────────────────────────────────
		// One builder for both kinds: a folder and a note carry exactly the
		// same five, and two builders would be two places for the flag to
		// stop matching the target.
		//
		this._orgSel = () => selRows().map(it => it.path);
		this._orgPropSet = (p: string, k: string, v: unknown) => orgPropSet(p, k, v);
		this._orgPropListSet = (p: string, k: string, v: unknown, before: unknown) => orgPropListSet(p, k, v, before);
		// THE CELL TOO: a test driving the one-cell fast path hands the cell in.
		this._orgFlagSet = (row: { path: string }, id: string, cell: HTMLElement | null) => orgFlagSet(row, id, cell || null);
		// AND THE FIELD EDITOR, opened on a live cell by a test, which cannot
		// keep one open across the redraws the index sends.
		this._orgFieldEditor = (td: HTMLElement, p: string, k: string) => orgFieldEditor(td, p, k, false);
		this._orgSelSet = (paths: string[]) => {
			sel.clear();
			for (const p of (paths || [])) sel.set(keyOf({ kind: 'file', path: p }), { kind: 'file', path: p });
		};

		// THE MODIFIERS BY NAME, off a mouse event or a key event alike —
		// `instanceof MouseEvent` is false in a popout's realm.
		const openRow = (it: { kind: string; path: string; }, ev?: WsModEvent) => {
			if (!it || it.kind !== 'file') return;
			const newTab = !!(ev && (ev.ctrlKey || ev.metaKey));
			try { void this.app.workspace.openLinkText(it.path, '', newTab ? 'tab' : false); }
			catch (_) { wsCatch('openRow: this.app.workspace.openLinkText(it.path)', _); }
		};

		// ── THE CHROME: the titlebar doors, the tab strip, the subject line
		// and the say-line (organizer-chrome.ts). Made before the doors are
		// drawn; the boxes it draws into later come as getters.
		const chrome = wsOrgChromeMake({
			plugin: this,
			host, single, TABS, ses, body, tabsRow, foot,
			get tab() { return tab; },
			set tab(v: string) { tab = v; },
			get subject() { return subject; },
			get orgSel() { return orgSel; },
			get orgScope() { return orgScope; },
			get orgFolder() { return orgFolder; },
			get orgUnder() { return orgUnder; },
			get zoomTag() { return zoomTag; },
			get draw() { return draw; },
			get drawPanel() { return drawPanel; },
		});
		const { drawTabs, tabSet, drawSubject, said } = chrome;
		chrome.doors();

		const subject = right.createDiv({ cls: 'ws-uni-subject' });
		orgZoom.zoomHost = subject;
		const panel = right.createDiv({ cls: 'ws-uni-panel' });
		// ── AND EMPTY SPACE PUTS THEM AWAY ─────────────────────────
		//
		// A property cell's own handler calls `stopPropagation` before anything
		// else, so this listener sees exactly the clicks that are NOT in a cell
		// being edited. BOUND ONCE, HERE, rather than inside `drawOrg`: a
		// listener added on every redraw is a listener stacked hundreds deep by
		// the end of a session, and each copy would call `drawOrg` again.
		panel.addEventListener('click', () => {
			if (panel.querySelector('.ws-org-editor')) drawOrg();
		});
		// ── AND THE PROPERTY STORE IS READ ONCE, HERE ────────────────
		//
		// The only other `structureRead()` on this side lives inside the
		// Export's tick memory; without this the store loaded when a writer
		// visited Export and not otherwise, and a non-md row showed nothing it
		// had been given. ONE SHOT, AND A REDRAW WHEN IT LANDS. `structureRead`
		// caches, so a second call is free — but a redraw per call would not
		// be, and `drawOrg` is called on every keystroke's worth of state change.
		if (!this._structStore) {
			// THROUGH `drawPanel`, NOT `drawOrg`: this window may be showing
			// History or Export when the read lands, and `drawOrg` would paint the
			// Organizer over whichever tab the writer is looking at. `drawPanel`
			// asks which tab first.
			this.structureRead()
				.then(() => { try { drawPanel(); } catch (_) { wsCatch('openManuscriptModal: drawPanel();', _); } })
				.catch(() => {});
		}

		// The history keeps its own view state across tab switches — which
		// month you were looking at is not something to lose because you
		// glanced at the report — and it is told that the TREE owns the
		// scope, so it draws no finder and no crumbs of its own.
		const histState: WsHistoryTabState = Object.assign({ scope: '', query: '', shiftPeriod: null, hideScope: true }, this.historyOpeningPeriod());


		this._orgSubject = () => subject;
		this._orgScope = () => exportScope();
		this._orgScopes = () => exportScopes();
		this._orgSubjectRows = () => subjectRows();

		// THE TABLE (`orgTableMake`) reads the window's state through this
		// context — every name the region reads or writes, and nothing else.
		const tableCtx: WsOrgCtx = wsCtxLend<WsOrgCtxOwn>({
			// THE CLOSURE'S OWN: its state, its draws, its doors — what no module
			// holds. What the modules hold is LENT below, by name.
			// The bar's word is set on the context by `orgBarSay` and read by the
			// table's bar; a property from the start, so a name the table reads is
			// a name the context has before anything is said.
			orgBarSaid: null,
			get colTextish() { return colTextish; },
			get draw() { return draw; },
			get drawPanel() { return drawPanel; },
			get fill() { return fill; },
			get openRow() { return openRow; },
			get orgFolder() { return orgFolder; },
			get orgIsOpen() { return orgIsOpen; },
			get orgNarrowNow() { return orgNarrowNow; },
			get orgOpenSet() { return orgOpenSet; },
			// THE SELECTION'S DOORS.
			get orgOpenSetMany() { return orgOpenSetMany; },
			get orgHist() { return orgHistApi; },
			get orgPruneUserCols() { return pruneUserCols; },
			get ownerWin() { return ownerWin; },
			get panel() { return panel; },
			get s() { return s; },
			get ses() { return ses; },
			get drawSubject() { return drawSubject; },
			get tab() { return tab; },
		})
		// LENT FROM THE MODULES: each name a getter onto the module — and a
		// setter where the module has one, so a live let written through the
		// context lands where it lives. `wsCtxLend` refuses a name the module
		// does not have, and the checker holds the chain's type against
		// `WsOrgCtx` (org-ctx.ts).
			.lend(orgWidths, ['ORG_COL_MIN', 'ORG_GRIP_CLICK_MS', 'orgColCeil', 'orgColCeilReset', 'orgColFitNow', 'orgColGripBind', 'orgColPx', 'orgColStamp', 'orgColUnfix', 'orgGripReleasedAt', 'orgNameGripBind', 'orgNameLineNow', 'orgNameRO', 'orgNameStamp', 'orgScrollTop', 'orgScrollLeft'])
			.lend(orgCells, ['orgBackCell', 'orgOutCell', 'orgCanHoldProps', 'orgGoalBand', 'orgGoalCell', 'orgPropCell', 'orgPropRefuse', 'orgTagsCell'])
			.lend(orgLensBox, ['orgAddChip', 'orgAt', 'orgFilterByKey', 'orgLens', 'orgLensClear', 'orgLensOn', 'orgLensSet'])
			.lend(orgReadings, ['orgColAgg', 'orgColRaw', 'orgColSortKey', 'orgColText', 'orgFolderIcon'])
			.lend(orgProps, ['orgEditDone', 'orgEditGuard', 'orgFieldEditor', 'orgOpenAfter', 'orgPropPopClose', 'orgPropPopEl', 'orgPropPopOpen', 'orgRedrawPending'])
			.lend(orgShape, ['setShape', 'showShape', 'typeLabel', 'typeRows'])
			.lend(orgSel, ['orgSelClick', 'orgSelHas', 'orgSelCount'])
			.lend(orgCols, ['SORTS', 'colOff', 'setCols'])
			.lend(orgChips, ['orgChipHit', 'orgPropKeys'])
			.lend(orgFlags, ['orgFlagCell', 'orgRepaintFlagCell'])
			.lend(orgDrag, ['orgDragCol', 'orgGroupDrop', 'orgLastGrouping', 'orgRowDrag'])
			.lend(orgRows, ['orgFilePathCache', 'orgRowList', 'orgUnder'])
			.lend(orgFiles, ['nameOf', 'orgCellHint', 'orgDrawnSig'])
			.lend(orgModeBox, ['orgChevron'])
			.lend(orgRename, ['orgMenuCtx'])
			.lend(orgWrites, ['orgPropSet'])
			.lend(orgScope, ['orgNote', 'showItem'])
			.bag();
		const { drawOrg } = this.orgTableMake(tableCtx);
		// A DOOR ONTO THE CONTEXT, so a test can hold every `ctx.<name>` the
		// table's source reads to a name the live context answers.
		this._orgCtx = () => tableCtx;
		// Left-aligned columns: the ones holding WORDS rather than figures.
		// `ftype` IS A WORD, not a figure: "xlsx" lines up with "md" on its
		// first letter, the way every other column of words in this table
		// does. `read` is deliberately NOT here — "12 min" and "1 h 5 m" are
		// quantities, and quantities line up on the right.
		const colTextish = (col: { id: string; user?: boolean }) =>
			col.id === 'mark' || col.id === 'tags' || col.id === 'ftype'
			|| col.id === 'backlinks' || col.id === 'outlinks' || !!col.user
			|| String(col.id).indexOf('fm:') === 0;

		let panelGen = 0;
		drawPanel = () => {
			const gen = ++panelGen;
			// WHICH FILES A ROW GOVERNS IS A PER-DRAW CACHE, and this is where it
			// is dropped: the scope can change, a file can be added, a tick can
			// move. It is built on the first row that asks and dropped here, the
			// one door every tab's redraw walks through.
			orgTicks.dropIndex();
			// The Organizer wears its own layout on the SHARED panel and
			// subject elements; toggled here, the one door every tab's
			// redraw walks through, so leaving the tab always undresses them.
			panel.toggleClass('ws-org-host', tab === 'organizer');
			subject.toggleClass('ws-org-strip', tab === 'organizer');
			// NOT ON EXPORT: the tree beside it says where you are; the act row
			// says what is going out.
			subject.toggleClass('is-gone', tab === 'export');
			// The new Organizer draws its own pane and asks nothing async.
			if (tab === 'organizer') { drawOrg(); return; }
			const rows = subjectRows();
			// The one subject line: crumbs and counts, the same on every tab.
			drawSubject();
			// ── THE EXPORT TAB IS REFRESHED, NOT REBUILT ──────────────
			//
			// A row click once rebuilt the whole tab — the split, the act row, the
			// preview column — so the buttons slid left and the preview vanished
			// for the 210ms until the debounced compile put everything back.
			// NOTHING IN THIS PANEL IS SHAPED BY THE SCOPE: `buildExportAct` and
			// `buildExportOptions` are handed FUNCTIONS — `scope`, `compileList`,
			// `total` — precisely so they read live state rather than a captured
			// copy.
			//
			// `loadTicks` IS STILL AWAITED, and it is the reason this is not
			// merely a repaint: its cache is keyed on the scope, so a new
			// selection genuinely reloads that folder's remembered ticks. An
			// unchanged scope returns the same Set without touching disk.
			//
			// AND THE GENERATION IS CHECKED after the await, like every other
			// async draw here: a third selection arriving mid-read must not
			// have the second one's figures painted over it.
			if (tab === 'export' && exportOpts && panel.querySelector('.ws-export-split')) {
				Promise.resolve(loadTicks()).then(() => {
					if (gen !== panelGen) return;
					try { if (exportOpts && exportOpts.refresh) exportOpts.refresh(); } catch (_) { wsCatch('openManuscriptModal: if (exportOpts && exportOpts.refresh) exportOpts.refresh();', _); }
					// AND THE TREE: the click drew it at once, with the ticks of the scope
					// it was LEAVING, and nothing drew it again once its own section had
					// been read.
					try { draw(); } catch (_) { wsCatch('openManuscriptModal: draw();', _); }
				}, () => {});
				return;
			}
			// EMPTIED, SO THE HANDLES ARE DEAD: a stale handle would repaint a row
			// that is no longer on screen.
			exportOpts = null;
			panel.textContent = '';
			if (tab === 'export') { void drawExport(); return; }
			drawHistory(rows);
			void gen;
		};


		// ── The Export tab ──────────────────────────────────────────────────
		//
		// The same two builders as the compile itself, handed the scope from
		// the tree and the list from the ticks. NO DRAG HERE: order is the
		// tree's — Obsidian's own — and a third place to set it would be two
		// answers to one question.
		//
		// WHAT THE EXPORT TAB WAS BUILT WITH, so a redraw can ask it to refresh
		// instead of building it again. Cleared whenever the panel is emptied,
		// because a handle to a detached row is worse than none. ONE HANDLE,
		// NOT TWO: the act row's `repaint` did nothing on this path.
		let exportOpts: WsExportPanelHandle | null = null;
		// The Export and History panels are methods (`orgDrawExport`,
		// `orgDrawHistory`); the window hands them what they read.
		const drawExport = () => this.orgDrawExport({ panel, tab: () => tab, ticks: () => orgTicks.current(),
			tickAll: (on: boolean) => orgTicks.setAll(on),
			draw: () => draw(), drawPanel: () => drawPanel(), exportFiles, exportScope, exportScopes, loadTicks,
			setExportOpts: (o: WsExportPanelHandle | null) => { exportOpts = o; } });
		const drawHistory = (rows: { kind: string; path: string }[]) => this.orgDrawHistory({ panel, tab: () => tab, drawPanel: () => drawPanel(), histState }, rows);


		// ── The keyboard ────────────────────────────────────────────────────
		//
		// The file explorer's, because that is the tree this window stands in
		// for: up and down to move, right and left to open and shut a folder,
		// Enter to open the note, space to flag it. Not while the writer is
		// typing: every target box is inside this scope, and a down-arrow in a
		// text field means "go to the end of the line" everywhere else in the
		// app.
		const typing = (fromSearch: boolean) => {
			const el = ownerDoc().activeElement;
			return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
				|| (el as HTMLElement).isContentEditable));
		};
		// organizer-keys.ts reads this closure through the names below.
		const orgKeys = wsOrgKeysMake({
			plugin: this,
			get draw() { return draw; },
			get drawPanel() { return drawPanel; },
			get exportScope() { return exportScope; },
			get folderOf() { return folderOf; },
			get host() { return host; },
			get itemOf() { return itemOf; },
			get keyOf() { return keyOf; },
			get markOf() { return markOf; },
			get openRow() { return openRow; },
			get orgFlagSet() { return orgFlagSet; },
			get orgFollow() { return orgFollow; },
			get orgLensClear() { return orgLensClear; },
			get orgLensOn() { return orgLensOn; },
			get orgNote() { return orgScope.orgNote; },
			get orgPropPopClose() { return orgPropPopClose; },
			get orgPropPopEl() { return orgPropPopEl; },
			get orgPropSubClose() { return orgPropSubClose; },
			get orgPropSubEl() { return orgPropSubEl; },
			get orgProps() { return orgProps; },
			get orgSel() { return orgSel; },
			get panel() { return panel; },
			get sel() { return sel; },
			get tab() { return tab; },
			get typing() { return typing; },
		});
		const onEscape = orgKeys.onEscape;
		const onHistKey = (ev: KeyboardEvent) => {
			if (tab !== 'organizer') return;
			if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
			const k = String(ev.key || '').toLowerCase();
			if (k !== 'z' && k !== 'y') return;
			const t = ev.target as HTMLElement | null;
			const doc = ownerDoc();
			const inPane = t && host.contains(t);
			const onBody = t === doc.body || t === doc.documentElement;
			if (!inPane && !onBody) return;
			if (inPane && t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
			// A KEY FROM THE BODY — a row was clicked, nothing took the focus —
			// goes to ONE pane: a leaf's when Obsidian says its leaf is the active
			// one, a modal's when it is the pane last touched. A last-touched mark
			// can point at a modal that has since closed, its listener gone with
			// it, so the leaf is asked of the API first.
			if (onBody && !orgHistMine()) return;
			const root = host.rootEl || host.contentEl;
			if (!root || !doc.body || !doc.body.contains(root)) return;
			ev.preventDefault();
			ev.stopPropagation();
			if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
			void orgHistRun((k === 'y' || ev.shiftKey) ? 'redo' : 'undo');
		};
		const orgHistMine = () => {
			try {
				if (host.kind === 'leaf' && host.view && host.view.leaf && this.app.workspace) {
					// The active view, asked of the API (activeLeaf is deprecated): ours
					// is an ItemView, so the question is whether the active one IS it.
					return this.app.workspace.getActiveViewOfType(ItemView) === host.view;
				}
			} catch (_) { wsCatch('orgHistMine: this.app.workspace.getActiveViewOfType(ItemView) === host.view', _); }
			return this._orgHistActive === onHistKey;
		};
		this._orgHist = orgHistApi;
		this._orgHistKey = (ev: KeyboardEvent) => onHistKey(ev);
		this._orgHistActive = onHistKey;
		try { (host.rootEl || host.contentEl).addEventListener('pointerdown', () => { this._orgHistActive = onHistKey; }, true); } catch (_) { wsCatch('openManuscriptModal: host.rootEl.addEventListener(pointerdown, orgHistActive)', _); }
		let stopEscape = () => {};
		try {
			// ON THIS WINDOW'S OWN DOCUMENT. Bare `window` here meant Escape
			// in a popout reached nothing: the keydown happens in the popout
			// and the listener is sitting on the main window.
			const ew = ownerWin();
			ew.addEventListener('keydown', onEscape, true);
			ew.addEventListener('keydown', onHistKey, true);
			stopEscape = () => {
				try { ew.removeEventListener('keydown', onEscape, true); } catch (_) { wsCatch('openManuscriptModal: ew.removeEventListener(\'keydown\', onEscape, true);', _); }
				try { ew.removeEventListener('keydown', onHistKey, true); } catch (_) { wsCatch('openManuscriptModal: ew.removeEventListener(\'keydown\', onHistKey, true);', _); }
			};
		} catch (_) { wsCatch('openManuscriptModal: const ew = ownerWin();', _); }

		// THE OTHER TREE COUNTS TOO. Dragging a chapter in Obsidian's explorer
		// used to leave this window drawing the order it had drawn last: the
		// explorer was asked to sort again and nothing asked this. Registered
		// here and dropped in `onClose`, so a window that has been shut is not
		// still being redrawn for the rest of the session.
		const stopWatching = this.onTreeOrderChange(() => {
			draw();
			void fill();
			// The Organizer's table IS the order too: a drag in either pane, in
			// Obsidian's explorer, or an edit to the order file must move the rows
			// in both places or the two are two orders again — the fault this
			// window exists to remove.
			if (tab === 'organizer') drawPanel();
		});
		// BOTH WATCHERS COME OFF. A window that unregisters one of two keeps a
		// dead window's `draw` alive for the rest of the session, drawing into
		// an element nothing can see — and doing it on every save.
		//
		// THROUGH THE HOST, which chains rather than overwrites: a leaf has
		// its own teardown to run and a window that replaced it would leave
		// the pane half-dismantled.
		host.onClose(() => {
			// THE DOOR GOES WITH THE WINDOW: a closed window that kept its door
			// would be chosen into by every folder click.
			try { this.orgWindowDrop(treeDoor); } catch (_) { wsCatch('openManuscriptModal: this.orgWindowDrop(treeDoor);', _); }
			try { stopWatching(); } catch (_) { wsCatch('openManuscriptModal: stopWatching();', _); }
			// THE THIRD ONE. The Escape ladder is on `window`, which means a
			// window that forgets to unregister it does not merely leak — it
			// goes on swallowing Escape for a window nobody can see.
			try { stopEscape(); } catch (_) { wsCatch('openManuscriptModal: stopEscape();', _); }
			try { if (this._orgHistActive === onHistKey) this._orgHistActive = null; } catch (_) { wsCatch('openManuscriptModal: this._orgHistActive = null;', _); }
			// AND THE WIDTH WATCHER. A ResizeObserver holds its callback, and
			// its callback holds this whole window — a pane closed without
			// this keeps two thousand lines alive and toggles a class on an
			// element nothing can see, every time the workspace moves.
			try { orgNav.stopWidth(); } catch (_) { wsCatch('openManuscriptModal: stopWidth();', _); }
			try { orgNav.stopNav(); } catch (_) { wsCatch('openManuscriptModal: stopNav();', _); }
			// AND THE INDEX BELL, for the same reason: the index outlives the
			// window on purpose (it is the plugin's), so a subscription left
			// behind would redraw a tree nothing can see on every keystroke.
			try { orgIndexChanged(); } catch (_) { wsCatch('openManuscriptModal: orgIndexChanged();', _); }
			try { if (orgScope.orgDrawTimer) window.clearTimeout(orgScope.orgDrawTimer); } catch (_) { wsCatch('openManuscriptModal: if (orgDrawTimer) window.clearTimeout(orgDrawTimer);', _); }
			// AND THE PROPERTIES PANEL, which hangs on the shared body and
			// would otherwise outlive the window that opened it — with two
			// capture listeners on the window still eating clicks and Escape.
			// AND THE SEAM’S OBSERVER, for the reason every other one here is
			// dropped: it holds a callback that holds this whole window, and it
			// would go on measuring a table nothing can see.
			try {
				if (orgWidths.orgNameRO) { orgWidths.orgNameRO.disconnect(); orgWidths.orgNameRO = null; }
			} catch (_) { wsCatch('openManuscriptModal: if (orgNameRO) orgNameRO.disconnect();', _); }
			try { orgPropPopClose(); } catch (_) { wsCatch('openManuscriptModal: orgPropPopClose();', _); }
		});

		// SET AT BUILD, not only on a click: the window can OPEN on this tab,
		// not only switch to it.
		body.toggleClass('is-organizer', tab === 'organizer');
		// (`is-treeoff` is the one-column layout's class.)
		body.toggleClass('is-treeoff', !ses.treeShown);
		// ── THE ACTIVE NOTE IS THE OPENING SELECTION ────────────────────────
		// A writer mid-scene opens the Organizer ABOUT that scene: the pane
		// shows its folder, the note is marked, the cursor stands on it so
		// the arrows continue from there, and its shut ancestors open so the
		// mark is on screen. Open-time only — arrowing away is not undone by
		// a redraw, and a pane host keeps the writer's later choices.
		if (tab === 'organizer') {
			try {
				// `activeNoteFile()` — the SAME source the cursor placement
				// above reads. Two answers to "the note in hand" is how the
				// mark and the cursor came to stand on different rows.
				const af = this.activeNoteFile ? this.activeNoteFile() : null;
				if (af && af.path && /\.md$/i.test(af.path)
					&& !(this.isStoreFile && this.isStoreFile(af.path))) {
					// ── THE ACTIVE NOTE CHOOSES THE FOLDER ONCE A SESSION ─────────
					//
					// Two good rules meet here: a writer mid-scene opens the Organizer
					// ABOUT that scene, and the window comes back the way it was left.
					// They are split by the session. The FIRST time this window opens after
					// Obsidian starts, the note in hand chooses the folder — nothing has
					// been left anywhere to come back to. Every open after that keeps the
					// folder the writer was in.
					//
					// THE NOTE IS STILL MARKED EITHER WAY — `markOnly` marks and leaves the
					// scope alone, so "the note I am in is highlighted" survives; it is
					// only the JUMP that stops.
					let been = null;
					try { been = this._wsSession ? this._wsSession.folder : null; } catch (_) { wsCatch('openManuscriptModal: been = this._wsSession ? this._wsSession.folder : null;', _); }
					// (and never while pinned: the pin outranks the session's first open)
					orgFollow({ path: af.path, kind: 'file' }, true, been !== null || !!s.organizerPinned);
					// (The cursor is already standing on the active note —
					// the open logic above placed it; one writer.)
					let dir = folderOf(af.path);
					// ── …AND IN THE TABLE, WHICH FOLDS ON ITS OWN STORE ──────
					//
					// The table folds on `orgOpen`. Keeping the writer's chosen folder
					// (see `keepScope`) can leave the note nested two levels down inside
					// it, and a marked row nobody can see is not a mark.
					//
					// SET DIRECTLY, NOT THROUGH `orgOpenSet`: that one saves and redraws
					// on every call, which down a deep path is a write and a repaint per
					// ancestor, before the first paint has happened. Persisted once below —
					// and only when an ancestor was shut: every open of the window wrote
					// data.json whole otherwise, on the pane's rebuild at every plugin load.
					let opened = 0;
					while (dir) {
						if (!orgOpen.has(dir)) { orgOpen.add(dir); opened++; }
						dir = folderOf(dir);
					}
					if (opened) {
						s.organizerOpen = Array.from(orgOpen);
						this.saveSettings().catch(() => {});
					}
				}
			} catch (_) { wsCatch('openManuscriptModal: const af = this.activeNoteFile ? this.activeNoteFile() : null;', _); }
		}
		drawTabs();
		// …and here too, not only in the tab handler. The window can be OPENED
		// on any tab — `openManuscriptModal({tab})`, the palette, the bar — and
		// a control drawn only by the handler is a control that is wrong for
		// every entry that does not go through it.
		draw();
		void fill();
		drawPanel();
		// The opening mark is brought ON SCREEN — a selection the writer
		// cannot see is indistinguishable from none.
		if (orgScope.orgNote) {
			try {
				// ON THE PANEL: the mark is a table row.
				const el0 = panel.querySelector('tr.ws-org-row.ws-org-active');
				if (el0 && el0.scrollIntoView) el0.scrollIntoView({ block: 'center' });
			} catch (_) { wsCatch('openManuscriptModal: const el0 = panel.querySelector(tr.ws-org-row.ws-org-active);', _); }
		}
		host.show();
		// THE HOST'S OWN HANDLE, so a caller gets back the thing it can act
		// on — a modal or a leaf — rather than the seam.
		return host.handle();
	},

	// ── WHAT A FOLDER LOOKS LIKE, ASKED IN ONE PLACE ────────────────────────
	//
	// A CLASS METHOD, because the explorer's painter (tree.ts) cannot reach
	// a closure inside the window and would otherwise need a COPY of the
	// colour lookup — a second writer of the fact. Three surfaces, one
	// function: a colour set in the tree and absent elsewhere is two answers
	// to "which folder is this".

	orgFolderIcon(this: WordSmith, into: HTMLElement, path: string, open: boolean) {
		// ── THE SWITCH IS ANSWERED WHERE THE GLYPH IS BORN ──────────────
		//
		// HERE RATHER THAN AT THE CALL SITES. There are five of those, and a
		// switch read at five places is four chances to add a sixth that
		// forgets. Nothing reads the return value, so leaving early costs
		// nothing, and the span is never made rather than being made and
		// hidden: an element with `margin-inline-end` that is only invisible
		// leaves its gap behind.
		if (this.settings.orgFolderIcons === false) return null;
		const ic = into.createSpan({ cls: 'ws-foldericon' });
		// TRIED IN ORDER AND CHECKED: `setIcon` on a name this build's Lucide
		// does not know leaves the element empty instead of throwing — how the
		// export icon went missing for a release.
		let drew = false;
		for (const n of (open
			? ['folder-open', 'folder'] : ['folder-closed', 'folder'])) {
			ic.textContent = '';
			try { if (setIcon) setIcon(ic, n); } catch (_) { wsCatch('orgFolderIcon: if (setIcon) setIcon(ic, n);', _); }
			if (ic.childElementCount > 0) { drew = true; break; }
		}
		// THE FALLBACK IS LOAD-BEARING.
		if (!drew) wsSvgInto(ic, wsFolderSvg(!!open, 12));
		// A COLOURED FOLDER IS COLOURED EVERYWHERE.
		const cid = ((this.settings.folderColors || {})[path]) || '';
		const cdef = WS_FOLDER_COLOURS.filter(c => c.id === cid)[0];
		if (cdef && cdef.css) ic.style.color = cdef.css;
		return ic;
	},

	// ── WHAT A TARGET CELL SAYS ────────────────────────
	//
	// The reading lives in the column that already holds the target rather
	// than in a column of its own. A CLASS METHOD, so every cell says it
	// the same way — two answers to one question is the mistake this window
	// keeps deleting.
	//
	// NO TARGET, NOTHING SAID. Zero is a measurement and blank is the
	// absence of one; a cell reading "0%" claims a scene has a goal and has
	// made no progress towards it.
	//
	// AND THE PERCENTAGE NEVER ROUNDS UP TO 100 BEFORE IT IS MET. 4,999 of
	// 5,000 is 99.98%, and a writer who reads 100% stops. It is not capped
	// at the top either: past the target is past it, which is the one thing
	// an over-long scene needs to say.
	orgTargetSay(this: WordSmith, words: number, target: number) {
		const t = Number(target) || 0;
		if (t <= 0) return '';
		const w = Number(words) || 0;
		const how = (this.settings && this.settings.orgTargetShow)
			|| 'percent';
		if (how === 'percent') {
			const raw = (w / t) * 100;
			// ROUNDED, THEN CLAMPED — not floored. Flooring made 42.9% read
			// as 42%, which is a different lie from the one being avoided:
			// the clamp is only there to stop 99.98% printing as 100%,
			// because a writer who reads 100% stops writing.
			const pct = (raw < 100) ? Math.min(99, Math.round(raw))
				: Math.round(raw);
			return pct + '%';
		}
		return w.toLocaleString() + '/' + t.toLocaleString();
	},

	orgKindIcon(this: WordSmith, into: HTMLElement, path: string) {
		// The file half of the pair above, on the same terms: one gate at
		// the one place a file glyph is made.
		if (this.settings.orgFileIcons === false) return null;
		const isMd = /\.md$/i.test(String(path));
		const kindIc = into.createSpan({ cls: 'ws-uni-kindicon' });
		let names = ['file'];
		// A NOTE GETS THE PLAIN SHEET, NOT THE RULED ONE: lucide's file-text
		// draws three rules inside the sheet, which at 14px reads as texture
		// rather than as a kind. THIS IS THE ONE WRITER of the glyph: the
		// explorer, the Organizer and the export list all call orgKindIcon, so
		// all three change together. The fallback chain stays a chain on
		// purpose: setIcon fails SILENTLY on a name this build's Lucide does
		// not know.
		if (isMd) names = ['file'];
		else {
			const grp = this.uniTypeGroups()
				.filter((g) => g.id === this.uniTypeGroupOf({ path }))[0];
			names = (grp && grp.icons) || ['file'];
		}
		// `setIcon` FAILS SILENTLY on a name this build's Lucide does not
		// know - it leaves the element empty and throws nothing - so the
		// names are tried in order and the result is checked.
		for (const n of names) {
			kindIc.textContent = '';
			try { if (setIcon) setIcon(kindIc, n); } catch (_) { wsCatch('orgKindIcon: if (setIcon) setIcon(kindIc, n);', _); }
			// THE NAME THAT DREW IS RECORDED. `setIcon` fails silently, so a test
			// with no renderer cannot see a glyph at all — but it can see which
			// name was asked for, which is the half that tells a plain sheet from a
			// badge. Same pattern as the history stepper and the lens buttons.
			kindIc.dataset.icon = n;
			if (kindIc.childElementCount > 0) break;
		}
		return kindIc;
	},

	// ── AND THE FORMAT IS SAID IN WORDS, WHERE OBSIDIAN SAYS IT ───────
	//
	// `nav-file-tag` IS OBSIDIAN'S OWN CLASS, borrowed rather than copied.
	// Our rows are already built out of the explorer's markup —
	// `tree-item-self`, `nav-file-title`, `tree-item-inner` — so the label
	// needs no rule of ours to look right, and it goes on looking right
	// when a theme restyles the real explorer.
	//
	// A NOTE GETS NONE. Obsidian omits the tag for .md because every row
	// in a vault would carry the same word, which is no information at
	// all; the same is true here. LOWER CASE, as the app writes it.
	orgKindTag(this: WordSmith, into: HTMLElement, path: string) {
		const p = String(path || '');
		if (/\.md$/i.test(p)) return null;
		const bits = (p.split('/').pop() || '').split('.');
		if (bits.length < 2) return null;
		const ext = (bits.pop() || '').toLowerCase();
		if (!ext) return null;
		return into.createDiv({ cls: 'nav-file-tag', text: ext });
	},

	// ════════════════════════════════════════════════════════════════════════
	// THE EXPORT AND HISTORY PANELS, OUT OF THE WINDOW
	// ════════════════════════════════════════════════════════════════════════
	//
	// Methods, handed exactly the handful of the window's names they read
	// as `ctx` — the reads as functions (`tab()`, `ticks()`), because a
	// `let` copied at call time is the value it had then; the one write
	// (`exportOpts`) as a setter.

	async orgDrawExport(this: WordSmith, ctx: WsOrgExportCtx) {
		const { panel, exportFiles, exportScope, loadTicks } = ctx;
		const draw = () => ctx.draw();
		const drawPanel = () => ctx.drawPanel();
		// ── ONE LIST, AND THE PANE COUNTS THE ONE THE BUTTON COMPILES ───
		//
		// One filter for `compileList` and for the figures under the controls:
		// the count cannot drift from the compile, because there is nothing
		// for it to drift from.
		const exportGoing = () => { const ticks = ctx.ticks(); return exportFiles().filter(
(			f: TAbstractFile) => ticks && ticks.has(f.path)); };
		panel.createDiv({ cls: 'ws-report-loading', text: 'Reading\u2026' });
		await loadTicks();
		if (ctx.tab() !== 'export') return;
		panel.textContent = '';
		const act = panel.createDiv({ cls: 'ws-export-top ws-uni-act' });
		const actHandle = this.buildExportAct(act, {
			scope: () => exportScope(),
			compileList: () => exportGoing(),
			total: () => exportFiles().length,
			tickAll: (on: boolean) => ctx.tickAll(on),
			// A TAB DOES NOT CLOSE ITSELF after a compile: the writer is standing
			// in their manuscript and has somewhere to go back to.
			onDone: () => { draw(); drawPanel(); }
		});
		// THE COUNT BESIDE THE BUTTON, because it is the fact that matters. The
		// act row (`.ws-export-top`) is built first, so the count is put INTO
		// that row rather than a copy made there; if the row is not there, the
		// panel keeps the count where it has always been.
		const actRow = panel.querySelector('.ws-export-top');
		const goEl = actRow ? actRow.querySelector('.ws-export-go') : null;
		const countEl = (actRow || panel).createDiv({
			cls: 'ws-uni-count' + (actRow ? ' is-besidego' : '') });
		// BEFORE the button, so it reads as the sentence the button acts on.
		if (actRow && goEl) actRow.insertBefore(countEl, goEl);
		const bits: string[] = [];
		countEl.setText(bits.join('  \u00b7  '));
		countEl.style.display = bits.length ? '' : 'none';
		// THE OPTIONS GET THE LIST TOO. The preview lives beside them and
		// compiles what is TICKED — THE SAME TWO THE ACT LINE GETS, from the
		// same two functions: a preview compiling a different list from the
		// button beside it is the fault `compileList` exists to prevent.
		ctx.setExportOpts(this.buildExportOptions(panel, {
			scope: () => exportScope(),
			compileList: () => exportGoing(),
			// HOW MANY THERE ARE TO GO OUT, not how many are ticked. The
			// figures line beside the button says "11 out of 47 notes" now,
			// and 47 is a fact only this side knows: the preview is handed a
			// compiled list and cannot see what was left out of it.
			//
			// A FUNCTION, NOT A NUMBER, for the same reason `scope` and
			// `compileList` are: the pane recompiles on every option change
			// and a captured count would be the one that was true when the
			// pane was built.
			total: () => exportFiles().length,
			// THE FOLDERS THE TREE SHOWS TICKED, for the figures line.
			folders: () => this.exportFoldersTicked(exportFiles(), ctx.ticks())
		}));
		// ── AND THEN THE FORMAT IS PAINTED AGAIN ────────────────────
		//
		// `buildExportAct` ends by calling its own `paintFmt`, which sweeps the
		// pane for the controls that need pages and hides them — and the act
		// row is built ABOVE the options, so at that moment there is nothing in
		// the pane to find. `repaint` runs the sweep once the options exist.
		// Guarded, because a future caller may not return one.
		try { if (actHandle && actHandle.repaint) actHandle.repaint(); } catch (_) { wsCatch('orgDrawExport: if (actHandle && actHandle.repaint) actHandle.repaint();', _); }
		// The tree grows its boxes when this tab comes up, and loses them
		// when it goes. Drawn after the panel so a slow store read cannot
		// leave the tree showing boxes it has no ticks for.
		draw();
	},

	orgDrawHistory(this: WordSmith, ctx: WsOrgHistoryCtx, rows: { kind: string; path: string }[]) {
		const { panel, histState } = ctx;
		const drawPanel = () => ctx.drawPanel();
		// The paths, not the rows: the record is kept per path, and a
		// folder covers everything beneath it by prefix — which is also
		// what makes an overlapping selection count a day once.
		histState.scope = rows.map((r) => r.path);
		try {
			if (this.settings.historyTracking && !this._historyReady) {
				panel.createDiv({ cls: 'ws-report-loading', text: 'Reading\u2026' });
				void this.historyLoad().then(() => {
					// The period, not the scope: reopening the record must
					// not throw away the tree's selection.
					const at = this.historyOpeningPeriod();
					histState.year = at.year;
					histState.month = at.month;
					if (ctx.tab() === 'history') drawPanel();
				});
				return;
			}
			this.renderHistoryTab(panel, histState, () => drawPanel());
		} catch (e) {
			panel.textContent = '';
			panel.createDiv({ text: 'History failed \u2014 '
				+ wsErrMsg(e) });
		}
	},

	// ════════════════════════════════════════════════════════════════════════
	// THE TABLE, OUT OF THE WINDOW
	// ════════════════════════════════════════════════════════════════════════
	//
	// A factory. `ctx` is the window's own state seen through accessor
	// properties: a read of `ctx.tab` is the window's `tab` at that moment,
	// an assignment through `ctx` sets the window's variable. Nothing here
	// copies a value; nothing here owns one the window also owns.
	orgTableMake(this: WordSmith, ctx: WsOrgCtx) {
		const s = ctx.s;
		const fill = () => ctx.fill();
		// ── THE ORGANIZER'S RIGHT PANE — the Table view ────────────────────
		//
		// A native <table>, because the data is flat: column sizing from real
		// glyphs, header/cell alignment by construction, sticky header and
		// sticky name column — no custom sizing code. Caps are `max-width` +
		// ellipsis on the cell, the full value on the hover.
		//
		// Custom order (no lens): rows grouped under folder headers, book
		// order. ANY lens up: the groups DISSOLVE to a flat list, each row
		// carrying its faint path — groups pin rows to folders, a sort claims
		// the order, and both cannot hold. Everything is drawn from the INDEX
		// and the stores; the fold state and the tree's DOM do not exist on
		// this side of the window.
		const drawOrg = () => {
			// THE SCAN IS ONE DRAW OLD AT MOST — see `orgAllFilePaths`.
			ctx.orgFilePathCache = null;
			// AND SO IS THE COLUMN CEILING: the pane may have been resized since
			// the last draw, so the cached `clientWidth` is dropped here and
			// re-read ONCE, rather than once a cell.
			ctx.orgColCeilReset();
			// THE EDIT-GUARD'S TEETH: while an editor holds focus, the pane
			// is not rebuilt — the redraw waits for the edit to end. This is
			// the one gate every repaint passes, so no caller can forget it.
			if (ctx.orgEditGuard) { ctx.orgRedrawPending = true; return; }
			// ── AND WHERE THE WRITER WAS LOOKING ─────────────────
			//
			// THE SCROLLER IS BUILT FRESH EVERY DRAW. `.ws-org-panel` is
			// `overflow: auto` and it is created by this function — so the element
			// the writer scrolled is thrown away and a new one, at zero, takes its
			// place. Every redraw — a commit, Escape, a click on another cell, a
			// property landing from the index ring — would throw the writer to the
			// first row, so the position is carried HERE, at the one gate every
			// repaint passes. READ FROM THE VARIABLE, NOT FROM THE ELEMENT — see
			// `orgScrollTop`, where the reason is.
			const orgKeepScroll = ctx.orgScrollTop;
			const orgKeepScrollX = ctx.orgScrollLeft || 0;
			// Idempotent kick: the first draw starts the sweep, the ring
			// repaints when it lands. Everything below reads what the index
			// knows NOW and blanks what it does not — unknown is not empty.
			void this.orgIndexEnsure();
			// A COLUMN WITH NO PROPERTY BEHIND IT GOES: once the index is built, a
			// user column whose key no note carries is dropped before the columns
			// are read.
			try { if (this._orgIndexBuild == null && ctx.orgPruneUserCols) ctx.orgPruneUserCols(); } catch (_) { wsCatch('drawOrg: ctx.orgPruneUserCols();', _); }
			const at = ctx.orgAt();
			// THE COLUMNS ARE A LIST, so every row, header, drag, sort and drawer
			// below reads `cols` — a second renderer would be a second writer of
			// the row. `uniColsOff` is the writer's own choice and nothing here
			// touches it.
			const cols = ctx.setCols();
			const lensed = ctx.orgLensOn();
			// A LENS SEES THE WHOLE SELECTION, FLAT; the book's own order is a
			// hierarchy. One list function, two questions.
			//
			// ── …AND THE THIRD QUESTION IS WHAT SHAPE OF THING ─────────
			//
			// HERE AND NOT IN `orgRowList`. That walk has two other callers —
			// `orgPropKeys` and the tag list — which use it to ENUMERATE what is
			// under the selection for the filter menu. Narrowing it there would
			// empty both menus while Folders only is up, leaving a writer unable to
			// build the filter that would get them out.
			//
			// FILES ONLY FLATTENS, and it has to. Dropping folder ROWS from a
			// grouped walk strands every note in a shut folder: no row left to
			// unfold, and a fold that filters is a filter nobody can see. A lens
			// flattens for the same reason.
			const shaped = ctx.showShape();
			// ── AND THE FOURTH QUESTION IS WHICH KINDS ────────────────────
			//
			// `orgRowList` enumerates the vault and the narrowing is here, next to
			// the shape, for the same reason the shape is here and not in the walk.
			// NOTHING CHANGES FOR A WRITER WHO HAS NOT ASKED: `uniTypeSet` answers
			// `['md']` when the store is absent or empty. ONE STORE, ASKED ONCE:
			// the tree, the chip and the kinds menu all read `uniTypes`. THE ONE
			// PREDICATE: `uniTypeAllows` is the membership rule — an extension of
			// its own under Other included; the stamped group stays for whoever
			// else reads it.
			const list = ctx.orgRowList(at, lensed || shaped === 'files')
				.filter((r0: { kind: string; path: string }) => r0.kind === 'folder' || this.uniTypeAllows({ path: r0.path }))
				.filter((r0: { kind: string; }) => (shaped === 'folders' ? r0.kind === 'folder'
					: shaped === 'files' ? r0.kind !== 'folder' : true));
			const sort = ctx.orgLens.sort;
			const sortCol = sort ? (cols.filter((c) => c.id === sort.id)[0] || null) : null;
			const sortDir = sort ? sort.dir : 'desc';
			// THE NAME SORT HAS NO COLUMN: the button, the chip and the menu all
			// ask "what is the sort called" and would get nothing for it.
			const sortByName = !sortCol && !!sort && sort.id === 'name';
			const sortLabel = sortCol ? sortCol.label + wsSortArrow(sortDir)
				: sortByName ? 'Name' + wsSortArrow(sortDir) : '';

			// ── which rows the lens leaves ──────────────────────────────
			const shown = list.filter((row: WsOrgRow) => {
				for (const c of ctx.orgLens.chips) {
					if (!c.off && !ctx.orgChipHit(c, row.path)) return false;
				}
				// Sorting BY a reading hides what has no value for it; the
				// strip's "N of M" accounts for them below.
				if (sortCol && ctx.orgColRaw(sortCol, row.path) === null) return false;
				return true;
			});
			let rows = shown;
			// BY NAME, WHICH IS NOT A READING: `sortCol` is looked up in the
			// reading columns and the Name is not one — its heading is built
			// outside the column loop. The key is the name the row SHOWS
			// (`nameOf`), compared the way the readings' text keys are, so "Ch 2"
			// sorts before "Ch 10". A lens flattens the list to files, so there is
			// no folder to place.
			if (sortByName) {
				const dir = sortDir === 'asc' ? 1 : -1;
				rows = shown.slice().sort((a, b) => {
					const d = String(ctx.nameOf(a.path)).localeCompare(
						String(ctx.nameOf(b.path)), undefined, { numeric: true });
					if (d) return d * dir;
					return a.idx - b.idx;
				});
			}
			if (sortCol) {
				const dir = sortDir === 'asc' ? 1 : -1;
				rows = shown.slice().sort((a, b) => {
					const ka = ctx.orgColSortKey(sortCol, a.path);
					const kb = ctx.orgColSortKey(sortCol, b.path);
					let d = 0;
					if (typeof ka === 'number' && typeof kb === 'number') d = ka - kb;
					else d = String(ka).localeCompare(String(kb), undefined, { numeric: true });
					if (d) return d * dir;
					return a.idx - b.idx;   // stable: ties keep book order
				});
			}

			// ── AND IF NOTHING BUT ONE CELL CHANGED, ONLY THAT CELL ──────
			//
			// THE GUARD IS THE REAL LIST, NOT A GUESS ABOUT IT. A flag can
			// legitimately MOVE a row — the table can be sorted by it — or HIDE
			// one, because a lens chip can filter on it. So the rows are computed
			// FIRST, by the code that always computes them, and the shortcut is
			// taken only when the answer is identical: if the list moved, this
			// falls through and the pane is rebuilt exactly as before. The data
			// half is not the cost (0.1ms against 8ms for the draw).
			// ── ROW NUMBERS, IN THE BOOK'S ORDER ─────────────────────
			//
			// The opened folder is 0 and is not a row; its rows count 1, 2, 3 in
			// the order shown, folders and files alike; a folder's rows count
			// inside it, 1.1, 1.2; deeper, 1.1.1. One counter per depth, the deeper
			// ones dropped each time a shallower row comes — so a folded folder's
			// files keep their numbers, being absent, and its siblings keep theirs.
			// Under a lens the list is flat and sorted: 1..n as shown. The widest
			// number sets the column's width, stamped on the table for the sheet
			// to read (`--ws-org-numw`).
			const nums = s.uniRowNumbers ? new Map<string, string>() : null;
			let numW = 0;
			if (nums) {
				const counters: number[] = [];
				for (const r0 of rows) {
					const d = lensed ? 0 : (r0.depth || 0);
					counters.length = d + 1;
					counters[d] = (counters[d] || 0) + 1;
					const label = counters.slice(0, d + 1).join('.');
					nums.set(r0.path, label);
					if (label.length > numW) numW = label.length;
				}
			}
			const sig = rows.map((r0: { path: string }) => r0.path).join('\n');
			const hint = ctx.orgCellHint;
			ctx.orgCellHint = null;
			if (hint && ctx.orgDrawnSig !== null && sig === ctx.orgDrawnSig
				&& ctx.orgRepaintFlagCell(hint.td, hint.path)) {
				return;
			}
			ctx.orgDrawnSig = sig;

			// ── the summary strip ────
			// THE ONE SUBJECT LINE: the window draws it the same on every tab.
			ctx.drawSubject();
			// ── TODAY'S NET UNDER THIS FOLDER ──
			// The history store is loaded on demand the first time the
			// Organizer draws; until it answers, the figure simply is not
			// there — unknown is not zero.
			if (this.settings.historyTracking && !this._historyReady) {
				this.historyLoad().then(() => {
					if (ctx.tab === 'organizer') ctx.drawPanel();
				}).catch(() => {});
			}
			// N OF M IS ABOUT NOTES: a folder is a row and not a note, and so is one
			// of the plugin's own store notes (`ws-structure.md`, `ws-settings.md`,
			// `ws-history.md`), which the index leaves out through `isFileCounted`.
			// The rows stay — the count moves. ASKED OF `isFileCounted` AND NOT OF
			// THE INDEX, deliberately: the index fills in asynchronously, so "not in
			// the index" also means "not read yet", and a fresh window would count
			// 0 notes for a moment. Unknown is not empty.
			const orgCounted = (p0: string) => {
				try {
					const f0 = this.app.vault.getAbstractFileByPath(String(p0 || ''));
					return !!f0 && !f0.children && this.isFileCounted(f0);
				} catch { return false; }
			};
			const noteCount = (rr: WsOrgRow[]) => rr.filter((r0) => r0.kind !== 'folder'
				&& orgCounted(r0.path)).length;
			const narrowed = noteCount(rows) < noteCount(list);

			// ── the bar: Sort by + AND-combined property chips ──────────
			ctx.panel.textContent = '';
			const bar = ctx.panel.createDiv({ cls: 'ws-org-bar' });
			// ── A BAR MENU OPENS UNDER ITS BUTTON ─────────────
			//
			// `showAtMouseEvent` puts the menu's corner where the click landed, so
			// a wide button like "Sort: Words ↓" opened its menu anywhere along its
			// own width — the same list arriving in a different place each time.
			// NO BASE CONVERSION HERE: an Obsidian `Menu` hangs off the document,
			// not off our host, so a viewport point is the right frame. The mouse
			// event stays as the fallback — a rect of all zeros is what a fixture
			// hands back, and a menu at the origin would be worse than one at the
			// pointer.
			const menuUnder = (menu: Menu, btn: HTMLElement, ev: MouseEvent) => {
				try {
					const r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
					if (r && (r.width || r.height)) {
						// THE ANCHOR'S WIDTH AND `overlap`, which is how Obsidian places its
						// own dropdowns. Without them the positioner adds 2px to the LEFT as
						// well as the top, so the menu sat a hair right of its button; with
						// them it lines up on the button's left edge and opens 2px under it,
						// the same 2px the Properties flyout uses.
						menu.showAtPosition({ x: Math.round(r.left), y: Math.round(r.bottom), width: Math.round(r.width), overlap: true });
						return;
					}
				} catch (_) { wsCatch('orgTableMake / menuUnder: const r = btn && btn.getBoundingClientRect', _); }
				try { menu.showAtMouseEvent(ev); }
				catch { try { menu.showAtPosition({ x: 0, y: 0 }); } catch (_e) { wsCatch('orgTableMake / menuUnder: menu.showAtPosition( x: 0, y: 0 )', _e); } }
			};
			// ── SORT BY ────────────────────────────────────────────────
			// The header click still cycles; this menu is the same lens through a
			// control a writer can FIND. One writer underneath: everything goes
			// through orgLensSet.
			// ── THE THREE LENSES WEAR BASES' OWN ICONS ──────────────────
			//
			// A writer who has used Bases already knows what these three do, and
			// this window is dressed as Obsidian everywhere else — borrowing the
			// app's vocabulary is cheaper than teaching our own.
			//
			// TRIED IN ORDER AND CHECKED, and the chosen name is RECORDED on the
			// element: `setIcon` with a name this build's Lucide does not know
			// leaves the element empty instead of throwing. `data-icon` records the
			// name that DREW, or the first candidate when none did — never the word
			// 'none', so a test can assert a real name where nothing can draw.
			const lensIcon = (btn: HTMLElement, names: string[]) => {
				for (const n of names) {
					try { if (setIcon) setIcon(btn, n); } catch (_) { wsCatch('orgTableMake / lensIcon: if (setIcon) setIcon(btn, n);', _); }
					if (btn.childElementCount > 0) { btn.dataset.icon = n; return n; }
					btn.textContent = '';
				}
				btn.dataset.icon = names[0];
				return null;
			};
			const sortBtn = bar.createEl('button',
				{ cls: 'ws-export-mini ws-org-sortby' });
			lensIcon(sortBtn, ['arrow-up-down', 'arrow-down-up',
				'arrow-up-narrow-wide', 'sort-asc']);
			// A LABEL SPAN, not `setText`: setText replaces every child, so
			// it would take the icon straight back out again.
			sortBtn.createSpan({ text: sortLabel ? 'Sort: ' + sortLabel : 'Sort' });
			sortBtn.title = 'Arrange the rows by a reading — custom order is a click away';
			sortBtn.addEventListener('click', (ev: MouseEvent) => {
				const menu = wsMenu();
				menu.addItem((i) => i.setTitle('Custom order')
					.setIcon('list-ordered')
					.setChecked(!ctx.orgLens.sort)
					.onClick(() => ctx.orgLensSet({ sort: null })));
				// NAME, ONE ROW LIKE THE COLUMNS': A to Z first, the way a name column
				// reads; the same row again turns it round. Under Custom order and
				// above the readings, because the Name is the column that is always
				// there.
				menu.addItem((i) => i.setTitle('Name' + (sortByName ? wsSortArrow(sortDir) : ''))
					.setIcon('case-sensitive')
					.setChecked(!!sortByName)
					.onClick(() => ctx.orgLensSet({ sort: { id: 'name',
						dir: sortByName && sortDir === 'asc' ? 'desc' : 'asc' } })));
				menu.addSeparator();
				// THE SORT MENU HAS AN ORDER OF ITS OWN. A column order says what you
				// want to READ side by side; a sort order says what you want to ARRANGE
				// by, and those are not the same ranking. Ordered by what a writer
				// steers on: the size of the thing and the size it is meant to be, then
				// what is outstanding and where it is up to, then time, then the
				// analytical readings, and last the metadata columns — which fall
				// through with rank `length`, so a writer's own property columns keep
				// their table order among themselves (array sort is stable).
				//
				// A NEW COLUMN NEEDS NO ENTRY HERE: an unnamed id ranks last rather
				// than throwing or vanishing.
				const SORT_RELEVANCE = ['words', 'goal', 'tasks', 'mark',
					'modified', 'created', 'grade', 'paras', 'tags'];
				const sortRank = (c: { id: string; }) => {
					const at = SORT_RELEVANCE.indexOf(c.id);
					return at === -1 ? SORT_RELEVANCE.length : at;
				};
				const sortMenuCols = cols.slice()
					.sort((a, b) => sortRank(a) - sortRank(b));
				for (const col of sortMenuCols) {
					menu.addItem((i) => {
						const here = sortCol && sortCol.id === col.id;
						i.setTitle(col.label + (here
							? wsSortArrow(sortDir) : ''));
						// ── AND EACH ROW WEARS ITS OWN GLYPH ────────
						//
						// LOOKED UP BY ID in `SORTS`, so `BUILTIN_SORTS` stays the ONE writer
						// of what each built-in reading looks like. A writer's own property
						// column gets one too: `sortDefs` concatenates the user columns with
						// `icon: 'tag'` — one glyph for "this is a property of yours".
						try {
							const def = ctx.SORTS.filter((s) => s.id === col.id)[0];
							if (def && def.icon && i.setIcon) i.setIcon(def.icon);
						} catch (_) { wsCatch('orgTableMake / drawOrg: const def = ctx.SORTS.filter((s) => s.id === col.id)[0];', _); }
						i.setChecked(!!here);
						// First pick sorts DESC (newest-biggest first, the
						// header's own opening move); picking it again
						// turns it round.
						i.onClick(() => ctx.orgLensSet({ sort: {
							id: col.id,
							dir: here && sortDir === 'desc' ? 'asc' : 'desc'
						} }));
					});
				}
				// ── ROW NUMBERS: a checkbox at the foot of the Sort menu, because
				// numbers are about the ORDER shown, which is what this menu is for.
				// Remembered with the table's other choices.
				menu.addSeparator();
				menu.addItem((i) => i.setTitle('Row numbers')
					.setIcon('hash')
					.setChecked(!!s.uniRowNumbers)
					.onClick(() => {
						s.uniRowNumbers = !s.uniRowNumbers;
						this.saveSettings().catch(() => {});
						ctx.drawPanel();
					}));
				menuUnder(menu, sortBtn, ev);
			});
			// ── FILTER BY ──────────────────────────────────────────────
			const addBtn = bar.createEl('button',
				{ cls: 'ws-export-mini ws-org-addfilter' });
			lensIcon(addBtn, ['list-filter', 'filter', 'funnel']);
			addBtn.createSpan({ text: 'Filter' });
			// ── AND HOW MANY ARE ON ────────────────────────────────
			//
			// The chips beside it already say WHICH filters are on; this says HOW
			// MANY without reading them, and it is the half that still shows when
			// the strip is narrow. COUNTS THE APPLIED ONES ONLY. A chip can be
			// unticked and left in place — that is what its checkbox is for — and
			// a badge counting those would say the view is narrowed when it is not.
			{
				const on = ctx.orgLens.chips.filter((c) => !c.off).length;
				if (on) addBtn.createSpan({ cls: 'ws-org-filtercount', text: String(on) });
			}
			addBtn.title = 'Narrow by a property — type to search the folder’s own keys';
			addBtn.addEventListener('click', (ev: MouseEvent) => {
				// ── FILTER IS A MENU OF AXES ──────────────────────────────
				//
				// A SEARCH BAR ONLY WHERE THE LIST IS LONG. Kind is 12 rows, Flag at
				// most 6, Tasks 4 — a search box over those is furniture. Tag and
				// Property are unbounded, so those open the picker.
				//
				// ONE PROBE, ON A SCRATCH MENU: asking the live menu whether it nests
				// answers the question and leaves a titleless row behind, in every
				// build, for ever.
				let nests = false;
				try {
					wsMenu().addItem((i) => {
						nests = typeof i.setSubmenu === 'function';
					});
				} catch { nests = false; }
				const menu = wsMenu();
				// One check for all five: a build with submenus has them
				// everywhere, and asking per group could give one nested
				// heading beside two flattened ones.
				const group = (title: string, icon: string, fill: (into: Menu) => void) => {
					if (nests) {
						menu.addItem((i) => {
							i.setTitle(title);
							try { if (icon) i.setIcon(icon); } catch (_) { wsCatch('orgTableMake / group: if (icon) i.setIcon(icon);', _); }
							// FILLED INSIDE A GUARD: Obsidian pushes the item
							// AFTER the callback returns, so a throw in here
							// loses the whole row and the menu comes back
							// silently missing a fifth of itself.
							try { fill(i.setSubmenu()); }
							catch (e) { console.error('Word-Smith: filter menu', e); }
						});
						return;
					}
					menu.addSeparator();
					menu.addItem((i) => i.setTitle(title).setIsLabel(true));
					fill(menu);
				};
				// `orgAddChip`, kept local so the call sites in this handler read short.
				const addChip = ctx.orgAddChip;

				// KIND writes the store, not a chip: `uniTypes` already holds
				// this and already draws its own chip in the bar. A second
				// copy in the lens would be two writers of one fact.
				group('Kind', 'shapes', (into) => ctx.typeRows(into));

				// TASKS is a question, not a value - there is nothing to
				// enumerate, so the four answers are named here. They are the
				// only axis whose reading is an OBJECT, which is why
				// orgChipHit has to know about it.
				// TWO ROWS: has tasks, no tasks.
				group('Tasks', 'check-square', (into) => {
					for (const t of [
						{ id: 'any',  label: 'Has tasks' },
						{ id: 'none', label: 'No tasks' }
					]) {
						into.addItem((i: MenuItem) => i.setTitle(t.label)
							.onClick(() => addChip({ axis: 'tasks', id: t.id,
								key: 'Tasks', value: t.label })));
					}
				});

				// FLAG carries the ID and shows the LABEL: a writer can rename
				// a flag in settings, and a chip holding the old word would
				// quietly stop matching the rows it used to.
				// ── AND EACH ROW WEARS ITS FLAG ────────────────────────
				//
				// A DocumentFragment holding a `.ws-menuflag` span with `wsFlagSvg`
				// inside it, then the label as a text node — a menu title takes a
				// fragment, and no Lucide name draws these shapes, so `setIcon` is not
				// an option here. ONE WRITER: `wsFlagSvg` is the only thing that knows
				// what a flag looks like.
				group('Flag', 'flag', (into: Menu) => {
					let defs: WsFlagDef[] = [];
					try { defs = this.flagDefs() || []; } catch { defs = []; }
					const titled = (id: string, label: string) => {
						const frag = createFragment();
						const mark = createSpan();
						mark.className = 'ws-menuflag is-' + id;
						wsSvgInto(mark, wsFlagSvg(id, 12));
						frag.appendChild(mark);
						frag.appendChild(document.createTextNode(label));
						return frag;
					};
					for (const d of defs) {
						into.addItem((i: MenuItem) => i.setTitle(titled(d.id, d.label))
							.onClick(() => addChip({ axis: 'flag', id: d.id,
								key: 'Flag', value: d.label })));
					}
					// "No flag" GETS THE SLOT AND NO SHAPE. It is the absence
					// of a flag, so drawing one would be a lie — but without
					// the span its label starts at a different x from the six
					// above it, which is the ragged column this window keeps
					// removing. `wsFlagSvg('')` returns the outline mark, and
					// the stylesheet's `.ws-menuflag.is-` holds the width.
					into.addItem((i: MenuItem) => i.setTitle(titled('', 'No flag'))
						.onClick(() => addChip({ axis: 'flag', id: '',
							key: 'Flag', value: 'none' })));
				});

				// TAG is unbounded, so it opens the picker. `uniTagsInScope`
				// is the enumerator whose own header says it is "the list the
				// filter menu offers" - scope-scoped and commonest-first, and
				// its counts are real, so the picker's count line is not a
				// number nobody counted.
				group('Tag', 'tag', (into) => {
					into.addItem((i: MenuItem) => i.setTitle('Search tags…')
						.onClick(() => {
							let tags: { tag: string; n: number }[] = [];
							try {
								tags = this.uniTagsInScope(
									ctx.orgRowList(at, true).map((r) => r.path)) || [];
							} catch { tags = []; }
							if (!tags.length) {
								try { new Notice('No tags in these notes'); } catch (_) { wsCatch('orgTableMake / drawOrg: new Notice(\'No tags in these notes\');', _); }
								return;
							}
							const items = tags.map(t => ({ tag: t.tag,
								label: '#' + t.tag, n: t.n }));
							const take = (it: WsPropItem) => addChip({ axis: 'tag',
								key: 'Tag', value: it.tag });
							if (WsPropSuggestModal) {
								try {
									new WsPropSuggestModal(this.app, items, take,
										'Which tag?').open();
									return;
								} catch (_) { wsCatch('orgTableMake / drawOrg: new WsPropSuggestModal(this.app, items, take,', _); }
							}
							const pick = wsMenu();
							for (const it of items.slice(0, 20)) {
								pick.addItem((i2) => i2.setTitle(it.label)
									.onClick(() => take(it)));
							}
							try { pick.showAtMouseEvent(ev); }
							catch { try { pick.showAtPosition({ x: 0, y: 0 }); } catch (_e) { wsCatch('orgTableMake / drawOrg: pick.showAtPosition( x: 0, y: 0 );', _e); } }
						}));
				});

				// PROPERTY: two long lists, so two pickers - the key, then its
				// values under this selection. `orgPropKeys` is the right
				// enumerator rather than `propKeysInScope`, which is built for
				// COLUMNS: it drops tags and drops keys already shown, and a
				// writer may well want to filter on a column they can see.
				group('Property', 'table-properties', (into: Menu) => {
					// ── THE TWO QUESTIONS THAT NEED NO VALUE ───────────────────
					//
					// They come FIRST because they are the ones a writer arrives wanting —
					// "which scenes have no synopsis" cannot be asked by picking a value:
					// there is no value to pick. ONE KEY PICKER, TWO ROWS, rather than a
					// value picker with two special entries hidden in it: the value list is
					// built from what EXISTS under the selection, so a key nobody has
					// filled in has an empty list — and that is exactly the key this
					// question is for.
					const askEmpty = (op: string) => {
						const keys = ctx.orgPropKeys(at);
						if (!keys.length) {
							try { new Notice('No properties in these notes'); } catch (_) { wsCatch('orgTableMake / askEmpty: new Notice(\'No properties in these notes\');', _); }
							return;
						}
						const items = keys.map((k: string) => ({ key: k, label: k }));
						const take = (it: WsPropItem) => addChip({ key: it.key, op: op, value: '' });
						if (WsPropSuggestModal) {
							try {
								new WsPropSuggestModal(this.app, items, take,
									op === 'empty' ? 'Which property is empty?'
										: 'Which property is filled in?').open();
								return;
							} catch (_) { wsCatch('orgTableMake / askEmpty: new WsPropSuggestModal(this.app, items, take,', _); }
						}
						const pk2 = wsMenu();
						for (const it of items.slice(0, 20)) {
							pk2.addItem((i4) => i4.setTitle(it.label).onClick(() => take(it)));
						}
						try { pk2.showAtMouseEvent(ev); }
						catch { try { pk2.showAtPosition({ x: 0, y: 0 }); } catch (_e) { wsCatch('orgTableMake / askEmpty: pk2.showAtPosition( x: 0, y: 0 );', _e); } }
					};
					into.addItem((i: MenuItem) => i.setTitle('Is empty…')
						.onClick(() => askEmpty('empty')));
					into.addItem((i: MenuItem) => i.setTitle('Is not empty…')
						.onClick(() => askEmpty('filled')));
					into.addItem((i: MenuItem) => i.setTitle('Search properties…')
						.onClick(() => {
							const keys = ctx.orgPropKeys(at);
							if (!keys.length) {
								try { new Notice('No properties in these notes'); } catch (_) { wsCatch('orgTableMake / drawOrg: new Notice(\'No properties in these notes\');', _); }
								return;
							}
							// `orgFilterByKey`, so the header's "Filter by this…" and this one
							// enumerate the same values from the same subject.
							const pickValue = (key: string) => ctx.orgFilterByKey(key, ev);
							const items = keys.map((k) => ({ key: k, label: k }));
							if (WsPropSuggestModal) {
								try {
									new WsPropSuggestModal(this.app, items,
										(it) => pickValue(it.key || ''),
										'Which property?').open();
									return;
								} catch (_) { wsCatch('orgTableMake / drawOrg: new WsPropSuggestModal(this.app, items,', _); }
							}
							const pk = wsMenu();
							for (const it of items.slice(0, 20)) {
								pk.addItem((i2) => i2.setTitle(it.label)
									.onClick(() => pickValue(it.key)));
							}
							try { pk.showAtMouseEvent(ev); }
							catch { try { pk.showAtPosition({ x: 0, y: 0 }); } catch (_e) { wsCatch('orgTableMake / drawOrg: pk.showAtPosition( x: 0, y: 0 );', _e); } }
						}));
				});
				menuUnder(menu, addBtn, ev);
			});
			// PROPERTIES, not Columns: the menu lists the readings AND the writer's
			// own frontmatter keys, which is what Obsidian calls properties —
			// "Columns" named the container rather than the contents.
			const colsBtn = bar.createEl('button',
				{ cls: 'ws-export-mini ws-org-colsbtn' });
			lensIcon(colsBtn, ['table-properties', 'settings-2', 'list',
				'columns-3']);
			colsBtn.createSpan({ text: 'Properties' });
			// ── AND ONE DOOR THAT SHUTS EVERYTHING ────────────────────
			//
			// ONE BUTTON, TWO JOBS, so its label is the only thing telling a writer
			// which they are about to get — and the test is whether ANY folder is
			// open, not whether all are. With nine folders and one open, "Expand
			// all" would be a lie about the eight that are shut and would do
			// nothing to the one that is not. IT WRITES THROUGH `orgOpenSet`, the
			// one writer of the fold, so a folded-away row and a hidden row cannot
			// come to mean two different things.
			const foldBtn = bar.createEl('button',
				{ cls: 'ws-export-mini ws-org-foldall' });
			// EVERY ROW THAT CAN BE OPENED, note or folder: a note's open state is
			// its property card. `orgOpen` holds both, and `orgIsOpen` is the same
			// question asked of either.
			//
			// ── AND IT READS THE WHOLE SUBTREE, NOT WHAT IS ON SCREEN ───────
			//
			// NEITHER FLAG ALONE IS "EVERYTHING": `flat` dives through every folder
			// regardless of its fold but OMITS the folders from what it returns,
			// and `!flat` returns both kinds but walks only what is open. So the
			// files come from the flat walk and the folders from their own paths —
			// no second tree walk, and no chance of a second walker disagreeing
			// with the first about what is under a folder.
			//
			// A FOLDER WITH NO NOTES UNDER IT IS NOT IN THE LIST, because no file
			// names it. Opening it would reveal nothing, so the only difference is
			// its own chevron.
			const foldable = () => {
				const out = new Set<string>();
				for (const r0 of ctx.orgRowList(ctx.orgFolder, true)) {
					out.add(r0.path);
					const bits = String(r0.path).split('/');
					bits.pop();
					let acc = '';
					for (const b of bits) {
						acc = acc ? acc + '/' + b : b;
						// Only what is at or under the scope: an ancestor above it
						// is not a row in this view and is not ours to fold.
						if (!ctx.orgFolder || acc === ctx.orgFolder
							|| acc.indexOf(ctx.orgFolder + '/') === 0) out.add(acc);
					}
				}
				return Array.from<string>(out);
			};
			const anyOpen = foldable().some(p0 => ctx.orgIsOpen(p0));
			lensIcon(foldBtn, anyOpen ? ['chevrons-down-up', 'fold-vertical', 'minimize-2']
				: ['chevrons-up-down', 'unfold-vertical', 'maximize-2']);
			// THE GLYPH ALONE: it sits in a row of four labelled controls and was
			// the widest of them for the least-used job. SO THE TITLE CARRIES THE
			// WHOLE NAME, and it has to: the icon flips with the state, which means
			// the picture is the only thing on screen saying which of two jobs a
			// click will do. An `aria-label` as well, because a button whose only
			// text is a drawing has no name at all to a screen reader.
			const foldSay = anyOpen ? 'Collapse all \u2014 shut every folder and card'
				: 'Expand all \u2014 open every folder and card';
			foldBtn.title = foldSay;
			foldBtn.setAttribute('aria-label', foldSay);
			foldBtn.addEventListener('click', (ev: Event) => {
				ev.stopPropagation();
				const want = !anyOpen;
				// ONE CALL, NOT ONE PER FOLDER — see `orgOpenSetMany`.
				ctx.orgOpenSetMany(foldable(), want);
			});
			// UNDO AND REDO: two buttons at the bar's end, greyed when there is
			// nothing to do, their titles saying what they would do — "Undo: Flag
			// Draft on Chapter Two (Ctrl+Z)" — repainted by the journal whenever
			// it moves.
			if (ctx.orgHist) {
				const histBtn = (kind: 'undo' | 'redo', names: string[], keySay: string) => {
					const b = bar.createEl('button', { cls: 'ws-export-mini ws-org-hist ws-org-' + kind });
					lensIcon(b, names);
					const paint = () => {
						const h = ctx.orgHist;
						const has = kind === 'undo' ? h.canUndo() : h.canRedo();
						const lab = kind === 'undo' ? h.undoLabel() : h.redoLabel();
						const say = (has ? (kind === 'undo' ? 'Undo: ' : 'Redo: ') + lab : 'Nothing to ' + kind) + ' (' + keySay + ')';
						b.disabled = !has;
						b.title = say;
						b.setAttribute('aria-label', say);
					};
					paint();
					b.addEventListener('click', (ev: Event) => {
						ev.stopPropagation();
						void ctx.orgHist.run(kind);
					});
					return paint;
				};
				const paintUndo = histBtn('undo', ['undo-2', 'undo', 'corner-up-left'], 'Ctrl+Z');
				const paintRedo = histBtn('redo', ['redo-2', 'redo', 'corner-up-right'], 'Ctrl+Shift+Z');
				ctx.orgHistPaint = () => { paintUndo(); paintRedo(); };
				// THE WORD BESIDE THEM. One slot: what the journal just did, for six
				// seconds, and otherwise how many rows the selection holds when it
				// holds two or more. The message lives on the context, since the bar
				// is rebuilt by the draw an undo ends with.
				const sayEl = bar.createSpan({ cls: 'ws-org-barsay' });
				let sayTimer: number | null = null;
				const paintSay = () => {
					const held = ctx.orgBarSaid;
					const live = held && held.msg && Date.now() < held.until;
					const n = ctx.orgSelCount ? ctx.orgSelCount() : 0;
					sayEl.setText(live ? held.msg : (n >= 2 ? n + ' selected' : ''));
					sayEl.toggleClass('is-sel', !live && n >= 2);
					if (sayTimer) { window.clearTimeout(sayTimer); sayTimer = null; }
					if (live) sayTimer = window.setTimeout(paintSay, Math.max(50, held.until - Date.now()));
				};
				paintSay();
				ctx.orgBarSayPaint = paintSay;
			}
			// ── ONE DOOR ONTO THE PROPERTIES ────────────────────────────
			colsBtn.title = 'Which properties this window shows — a column'
				+ ' in the table, a field under every row in Outline';
			// IT TOGGLES. A second press on an open panel shuts it, which is what
			// a writer expects of a button that opened one — and what a test
			// driving this door has to know, because re-reading the list after a
			// tick would otherwise CLOSE the panel and read nothing at all.
			colsBtn.addEventListener('click', () => {
				if (ctx.orgPropPopEl()) { ctx.orgPropPopClose(); return; }
				ctx.orgPropPopOpen(colsBtn);
			});

			// ── THE ACTIVE CHIPS, UNDER THE CONTROLS THAT MADE THEM ──
			//
			// Under the buttons is where a writer looks. A SIBLING OF THE BAR, NOT
			// A CHILD OF IT: `.ws-org-bar` is `flex-wrap`, so chips appended into
			// it would sit BESIDE the buttons until the line filled, which is not
			// "under". Built LAZILY so a lens-free window pays no empty row and no
			// gap for it.
			let chipRowEl: HTMLDivElement | null = null;
			const chipHost = () => (chipRowEl
				|| (chipRowEl = ctx.panel.createDiv({ cls: 'ws-org-chiprow' })));
			// The active lens, as dismissible chips — pressing one takes
			// only ITS narrowing away.
			const chipBtn = (label: string, undo: () => void) => {
				const b = chipHost().createEl('button', { cls: 'ws-org-chip' });
				b.createSpan({ text: label });
				b.createSpan({ cls: 'ws-org-chipx', text: '×' });
				b.title = 'Remove this';
				b.addEventListener('click', undo);
			};
			if (sortLabel) {
				chipBtn(sortLabel, () => ctx.orgLensSet({ sort: null }));
			}
			for (const c of ctx.orgLens.chips) {
				// A filter chip carries a CHECKBOX: unticking sets the filter aside
				// without losing what was typed; the × still removes it for good. A
				// sort chip has no box — there is nothing of its to keep while off.
				const b = chipHost().createEl('button',
					{ cls: 'ws-org-chip' + (c.off ? ' is-off' : '') });
				const tick = b.createEl('input', { cls: 'ws-org-chiptick' });
				tick.type = 'checkbox';
				tick.checked = !c.off;
				tick.title = c.off ? 'Tick to apply this filter again'
					: 'Untick to set this filter aside';
				tick.addEventListener('click', (ev: Event) => {
					ev.stopPropagation();
					ctx.orgLensSet({ chips: ctx.orgLens.chips.map((x) => x === c
						? Object.assign({}, x, { off: !x.off }) : x) });
				});
				// A CHIP SAYS WHAT IT ASKS. `synopsis: ` with nothing after the
				// colon would be an empty-looking chip for a filter that is
				// precisely ABOUT emptiness — unreadable, and indistinguishable
				// from a filter whose value had been lost.
				b.createSpan({ text: c.op === 'empty' ? c.key + ' is empty'
					: c.op === 'filled' ? c.key + ' is not empty'
					: c.key + ': ' + c.value });
				b.createSpan({ cls: 'ws-org-chipx', text: '×' });
				b.title = 'Remove this';
				b.addEventListener('click', () => ctx.orgLensSet({
					chips: ctx.orgLens.chips.filter((x) => x !== c) }));
			}
			// ── WHAT THE LENS COSTS, AND THE WAY OUT, BESIDE THE CHIPS ──
			//
			// THE COUNT ONLY WHEN SOMETHING IS HIDDEN: "5 of 5 shown" is a sentence
			// about nothing. THE WAY OUT WHENEVER THE LENS IS ON: a filter matching
			// every note still has to come off.
			// ── THE KIND NARROWING, IN THE SAME ROW AND THE SAME SHAPE ──
			//
			// A BUTTON, not a div, dismissed by pressing it anywhere rather than by
			// hitting the × alone — which is what every chip beside it does. The ×
			// stays as the sign that it can be dismissed. NOT `chipBtn`, though it
			// is its twin: this one carries a second class so `selectors.js` can
			// name it, and its undo is async.
			//
			// OUTSIDE `orgLensOn()`, deliberately: the kinds are narrowed by
			// the shape picker, not by the lens, so this chip must appear with
			// no lens on at all. `chipHost()` builds the row lazily, so asking
			// for it here is what makes the row exist in that case.
			{
				const onKinds = this.uniTypeSet();
				const allKinds = this.uniTypeGroups();
				if (onKinds.size < allKinds.length || ctx.showShape() !== 'all') {
					const kc = chipHost().createEl('button',
						{ cls: 'ws-org-chip ws-org-kindchip' });
					kc.createSpan({ text: 'kind: ' + ctx.typeLabel() });
					kc.createSpan({ cls: 'ws-org-chipx', text: '×' });
					kc.title = 'Only some kinds of file are shown — press to show every kind again';
					// BOTH STORES, as the old chip's × learnt the hard way:
					// on "Folders only" (every kind, one shape) undoing the
					// kinds alone changed nothing at all.
					const showEvery = async () => {
						this.settings.uniTypes = allKinds.map((g) => g.id);
						await ctx.setShape('all');
						ctx.drawPanel();
					};
					kc.addEventListener('click', () => { void showEvery(); });
				}
			}
			if (ctx.orgLensOn()) {
				const tail = chipHost().createDiv({ cls: 'ws-org-chiptail' });
				if (narrowed) {
					tail.createSpan({ cls: 'ws-org-shownof',
						text: noteCount(rows) + ' of ' + noteCount(list) + ' shown' });
				}
				const cl = tail.createEl('button', { cls: 'ws-org-clearlens' });
				cl.setText('Clear all');
				cl.title = 'Take the lens off — Escape does this too';
				cl.addEventListener('click', (ev: Event) => {
					ev.stopPropagation();
					ctx.orgLensClear();
				});
			}

			// ── the table ───────────────────────────────────────────────
			const wrap = ctx.panel.createDiv({ cls: 'ws-org-panel' });
			// AND IT REPORTS WHERE IT IS. A fresh box every draw means a fresh
			// listener every draw — which is right, not wasteful: the old box is
			// discarded with its listener, so nothing accumulates. `passive`
			// because this never calls `preventDefault`, and a non-passive scroll
			// listener makes the browser wait for it.
			wrap.addEventListener('scroll', () => {
				ctx.orgScrollTop = wrap.scrollTop;
				ctx.ses.scroll = ctx.orgScrollTop;
				// Sideways too: a sort rebuilds this box and must not throw the
				// columns back to the left edge.
				ctx.orgScrollLeft = wrap.scrollLeft;
			}, { passive: true });
			// Everything that differs between arrangements is in the stylesheet,
			// keyed off stamped classes — not in a second renderer, which is how a
			// window ends up with two descriptions of a row that have to be kept
			// in step.
			const table = wrap.createEl('table', { cls: 'ws-org-table' });
			ctx.orgNameStamp(table);
			if (nums) {
				table.addClass('has-num');
				table.style.setProperty('--ws-org-numw', 'calc(' + Math.max(1, numW) + 'ch + 8px)');
			}
			const thead = table.createEl('thead');
			const hr = thead.createEl('tr');
			// THE HEADER'S RIGHT-CLICK is an extra entry point, never a second copy
			// of a list: sort up, sort down, filter by this, hide the column. The
			// columns themselves are the Properties panel and the kinds are behind
			// Filter by, so nothing is reachable only from the gesture. Built beside
			// the drag, below.
			// THE NAME HEADING, AND THE EDGE THAT SIZES IT.
			const nameTh = hr.createEl('th',
				{ cls: 'ws-org-name', text: 'Name' });
			// THE HEADING SAYS # OVER THE NUMBERS, at the cell's left, where the
			// numbers are; the word stays centred over the names.
			if (nums) nameTh.createSpan({ cls: 'ws-org-numhead', text: '#' });
			ctx.orgNameGripBind(ctx.panel, nameTh, table);
			// A CLICK SORTS BY NAME: A to Z first — the way a name column reads —
			// then Z to A, then the book's order; the lens's one writer, and the
			// same guard against the click a grip release synthesises.
			nameTh.title = 'Sort: ascending, then descending, then the book’s order';
			if (ctx.orgLens.sort && ctx.orgLens.sort.id === 'name') {
				nameTh.createSpan({ cls: 'ws-org-sortmark',
					text: wsSortArrow(ctx.orgLens.sort.dir) });
			}
			nameTh.addEventListener('click', () => {
				if (Date.now() - ctx.orgGripReleasedAt < ctx.ORG_GRIP_CLICK_MS) return;
				const cur = ctx.orgLens.sort;
				if (!cur || cur.id !== 'name') ctx.orgLensSet({ sort: { id: 'name', dir: 'asc' } });
				else if (cur.dir === 'asc') ctx.orgLensSet({ sort: { id: 'name', dir: 'desc' } });
				else ctx.orgLensSet({ sort: null });
			});
			// ── AND THE SEAM RUNS THE PANE, NOT THE ROWS ──────────────
			//
			// A column separator that ends with the data reads as a fragment. SO
			// IT IS THE HOST'S, NOT THE CELLS': the Name column is sticky at the
			// wrap's left edge, so its right edge is at the SAME screen x whatever
			// the table is scrolled to — which is exactly what lets one line
			// outside the scroller stand in for a border on every cell. The cells'
			// own `border-right` comes off with this: two writers of one line is
			// how a seam ends up doubled or stepped.
			//
			// MEASURED IN A FRAME, not at build time. The width is the table's
			// answer to its own content and there is no layout to ask until the
			// rows are in.
			// ── ONE DEVICE PIXEL, NOT ONE CSS PIXEL ────────────────────────
			//
			// A 1px CSS bar at a fractional device position lights two device
			// columns partly and reads as a soft two-pixel line (at a ratio of
			// 1.25, CSS x 441.8 is device 552.25 to 553.5). SO IT IS SNAPPED ONTO
			// THE DEVICE GRID and given exactly one device pixel of width — both
			// numbers read from the machine at draw time, so nothing here is a
			// literal that a different display would make wrong.
			//
			// THE OFFSET IS READ FROM THE PSEUDO-ELEMENT, which is the one writer
			// of where the bar is: `getComputedStyle(el, '::before')` resolves the
			// `calc(guidex + (depth - 1) * step)` the stylesheet owns, so this
			// never restates that expression and cannot drift from it. THE SNAP IS
			// ZEROED BEFORE READING, or the second call would measure a position
			// that already includes the first call's correction and double it.
			//
			// BOTH SURFACES — the tree and the table — or they come to disagree.
			const orgZoomOf = (el: HTMLElement) => {
				let z = 1;
				try {
					const w0 = (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
					for (let n: HTMLElement | null = el; n && n.nodeType === 1; n = n.parentElement) {
						const v = parseFloat(w0.getComputedStyle(n).zoom);
						if (isFinite(v) && v > 0 && v !== 1) z *= v;
					}
				} catch (_) { wsCatch('orgTableMake / orgZoomOf: const w0 = el && el.ownerDocument', _); }
				return (isFinite(z) && z > 0) ? z : 1;
			};
			const orgSnapAccent = () => {
				const w0 = ctx.ownerWin();
				const dpr = (w0 && w0.devicePixelRatio) || 1;
				// FROM THE WINDOW, AND WALKED UP FROM THE TABLE. NOT FROM `host`: the
				// `host` in scope here is the window's, which is not always an element
				// (`orgNameLine` has its own, `wrap.parentElement`). `table` is an
				// element in both.
				const scope: HTMLElement | null = table.closest('.ws-uni-modal')
					|| table.closest('.modal') || table.ownerDocument.documentElement;
				// THE RATIO GOES ON THE WINDOW, THE SNAP ON THE MARK. They are two
				// different facts knowable at different times: the ratio is true of
				// the whole window from the first paint, while the snap needs the mark
				// to EXIST and be laid out. Inherited from here, the width is right on
				// both surfaces from the start; the position follows on the next draw.
				if (scope && scope.style) {
					scope.style.setProperty('--ws-dpr', String(dpr));
				}
				// EVERY MARKED ROW: the active one and each selected one wear the bar,
				// and a bar not snapped straddles two device columns.
				const marks = Array.from<HTMLElement>(table.querySelectorAll(
					'.ws-org-row.ws-org-active td.ws-org-name, .ws-org-row.is-selected td.ws-org-name'));
				for (const el of marks) {
					if (!el) continue;
					try {
						el.setCssProps({ '--ws-dpr': String(dpr), '--ws-org-snap': '0px' });
						const off = parseFloat(
							w0.getComputedStyle(el, '::before').insetInlineStart);
						if (!isFinite(off)) continue;
						// IN THE FRAME THE SNAP IS WRITTEN IN. `off` is a computed length —
						// the element's own frame — and the rect is the zoomed one, so at any
						// zoom but 1 the sum of the two would be of two different units.
						const zoom = orgZoomOf(el);
						const x = el.getBoundingClientRect().left / zoom + off;
						// ── SNAP TO THE GUIDE, NOT TO THE PIXEL GRID ──
						//
						// The guide is Obsidian's own border and lands where its layout puts
						// it — not on the device grid — so snapping to the grid moves the bar
						// AWAY from the line it exists to sit on. SO THE GUIDE IS THE TARGET
						// WHEN THERE IS ONE: the `- 4.8px` in the stylesheet gets the bar close
						// from a measurement taken once; this puts it exactly there, per row,
						// at whatever depth and whatever that inset really is today. The
						// constant is the first guess and the measurement is the answer.
						const box = (typeof el.closest === 'function')
							? el.closest('.tree-item-children') : null;
						let want = null;
						if (box) {
							const bx = box.getBoundingClientRect().left / zoom;
							if (isFinite(bx)) want = bx;
						}
						// NO GUIDE, NO TARGET. The table's mark has no indentation line beside
						// it, so it keeps the device grid — a hairline with nothing to align
						// to should at least be crisp.
						if (want === null) want = Math.round(x * dpr) / dpr;
						el.style.setProperty('--ws-org-snap', (want - x).toFixed(3) + 'px');
					} catch (_) { wsCatch('orgTableMake / orgSnapAccent: el.style.setProperty(\'--ws-dpr\', String(dpr));', _); }
				}
			};
			// ── A RECT IS IN THE ZOOMED FRAME; A STAMP IS NOT ─────
			//
			// `getBoundingClientRect` answers in the zoomed frame and `offsetLeft`
			// in the element's own; a seam stamped as `wrap.offsetLeft +
			// rect.width` was written at zoom 0.8 as 246 for a column that ends at
			// 304. NOT `offsetWidth`, the obvious swap: it is rounded to a whole
			// pixel, and the seam's end is kept to two decimals below — a table is
			// not a whole number of pixels tall. The rect keeps its decimals and is
			// divided back into the frame it will be read in.
			//
			// UP THE TREE, MULTIPLYING: zoom nests. The pane sets one on
			// `.ws-uni-body` and a theme may set another above it.
			const orgNameLine = () => {
				try {
					const host = wrap.parentElement;
					if (!host) return;
					// The variables are REMOVED rather than zeroed: the host keeps its
					// style attribute across a redraw, so a stale width left behind would
					// put a line down the pane the moment anything else repainted it.
					host.style.removeProperty('--ws-org-outw');
					const zoom = orgZoomOf(nameTh);
					let w = nameTh.getBoundingClientRect().width / zoom;
					if (!(w > 0)) return;
					// ── THE NAME TAKES THE ROOM THE READINGS LEAVE ──
					//
					// On a narrow pane the stylesheet caps the name at 150px so six
					// readings can share a phone. With TWO readings that cap leaves half
					// the screen empty while every name truncates. So the room is measured
					// — the wrap's width less what the other columns take — and handed to
					// the sheet as the FLOOR of that cap; 32ch stays the ceiling, as on the
					// desktop.
					//
					// The readings' width is the table less the name, which does not
					// depend on the name, so this does not chase its own tail; and the
					// name is re-measured after the stamp, so the seam below is drawn from
					// the width the column actually ends up with.
					try {
						const narrow = !!(ctx.orgNarrowNow && ctx.orgNarrowNow());
						if (narrow) {
							const tableW = table.getBoundingClientRect().width / zoom;
							const room = Math.floor(wrap.clientWidth - Math.max(0, tableW - w));
							const was = table.style.getPropertyValue('--ws-org-nameroom');
							const now = room > 0 ? room + 'px' : '';
							// AND THE CEILING A DRAG MAY REACH. A dragged width wins on a narrow
							// pane, and a width dragged on the DESKTOP is in the same store — so
							// the sheet is told where the grip would have stopped, from the same
							// host the grip asks: the SCROLLER, whose client width is the table's
							// room. The host beside it is 20px wider — the vertical bar and the
							// inset — and a name at that ceiling put the table 12px over.
							const ceil = ctx.orgColCeil(wrap);
							const ceilNow = ceil > 0 ? ceil + 'px' : '';
							const ceilWas = table.style.getPropertyValue('--ws-org-nameceil');
							if (was !== now || ceilWas !== ceilNow) {
								if (now) table.style.setProperty('--ws-org-nameroom', now);
								else table.style.removeProperty('--ws-org-nameroom');
								if (ceilNow) table.style.setProperty('--ws-org-nameceil', ceilNow);
								else table.style.removeProperty('--ws-org-nameceil');
								w = nameTh.getBoundingClientRect().width / zoom;
							}
						} else if (table.style.getPropertyValue('--ws-org-nameroom')
							|| table.style.getPropertyValue('--ws-org-nameceil')) {
							table.style.removeProperty('--ws-org-nameroom');
							table.style.removeProperty('--ws-org-nameceil');
							w = nameTh.getBoundingClientRect().width / zoom;
						}
					} catch (_) { wsCatch('orgNameLine / nameroom: const narrow = !!(ctx.orgNarrowNow && ctx.orgNarrowNow());', _); }
					// THE WRAP'S OWN INSET COUNTS. The seam is positioned against the HOST
					// and the column is measured inside the WRAP, and the wrap does not
					// start at the host's left edge.
					host.style.setProperty('--ws-org-nameline',
						Math.round(wrap.offsetLeft + w) + 'px');
					host.style.setProperty('--ws-org-nametop',
						Math.round(wrap.offsetTop) + 'px');
					// AND THE HEADER'S OWN HEIGHT, for a finger's Name grip to be exactly
					// as tall as the header it lives on. Measured, not the token: the
					// heading is `height: 44px` under a finger and measures 49 — a table
					// cell's height is a minimum, and the narrow pane's padding-block adds
					// to it.
					host.style.setProperty('--ws-org-headh',
						(nameTh.getBoundingClientRect().height / zoom).toFixed(2) + 'px');
					// AND IT STOPS WITH THE ROWS: the logical stop is the last row,
					// because that is where the columns it separates end. CLAMPED TO THE
					// PANE, or a table taller than its pane would stamp a height that
					// reaches past the bottom of the window.
					//
					// AND NOT ROUNDED. Every row height here is fractional (23.6px rows, a
					// 24.4px header), so rounding to a whole pixel cannot land on a row
					// edge except by accident — and the grip takes this as its height. TWO
					// DECIMALS, NOT NONE: the raw double would stamp a seventeen-digit
					// string into a style attribute on every draw; hundredths are finer
					// than a device pixel at any ratio this runs at.
					//
					// (A SILENT CATCH AROUND A WHOLE FUNCTION BODY IS A PLACE A MISSING
					// LINE CAN HIDE: `tall` once went missing here, and the symptom was a
					// grip 23.6px tall with no error anywhere.)
					const tall = Math.min(table.getBoundingClientRect().height / zoom,
						wrap.clientHeight);
					host.style.setProperty('--ws-org-nameend',
						Math.max(0, tall).toFixed(2) + 'px');
				} catch (_) { wsCatch('orgTableMake / orgNameLine: const host = wrap.parentElement;', _); }
				// WITH THE SEAM, so the accent is re-snapped by every trigger the
				// seam already has — the synchronous stamp, the ResizeObserver on
				// the table, and the task queued after the build. A pane dragged
				// narrower moves the cell, which moves the bar off the grid.
				// GUARDED ON ITS OWN. This is decoration; the seam and the grip
				// height above are structure. A throw in here must not take them
				// with it — which it can, because the stamp above sits in a try
				// whose catch is silent, so the failure would show up as a grip
				// with no height and no error anywhere.
				try { orgSnapAccent(); } catch (_) { wsCatch('orgTableMake / orgNameLine: orgSnapAccent();', _); }
			};
			// THE FIT MEASURES THIS TABLE. Installed beside the seam’s own
			// closure and for the same reason: both are built here and read
			// from somewhere else.
			//
			// READ EVERYTHING, THEN WRITE. The stamps come off, one layout is
			// forced by the first read, every width is taken, and only then is
			// anything set — interleaving makes the browser lay the table out
			// again on every column.
			ctx.orgColFitNow = () => {
				const ths = Array.from<HTMLElement>(table.querySelectorAll('thead th[data-col]'));
				// THE NAME IS NOT IN `ths` — its heading carries no `data-col`, and on
				// a wide pane the fit never touches it. On a NARROW one it is the way
				// back: a dragged width wins there, so this is what returns the column
				// to the room the readings leave. A pane with no readings still has a
				// name to hand back, hence the second half of the guard.
				const narrow = !!(ctx.orgNarrowNow && ctx.orgNarrowNow());
				if (!ths.length && !narrow) return;
				// EVERY CELL, not every header — `orgColLive` writes a column by
				// walking `th, td`, and this is the same walk undone. Measuring
				// after clearing only the headers is what made this button a
				// round trip; see `orgColUnfix`.
				for (const cell of Array.from<HTMLElement>(
					table.querySelectorAll('th[data-col], td[data-col]'))) {
					ctx.orgColUnfix(cell);
				}
				const ceil = ctx.orgColCeil(wrap);
				// MEASURED IN THE FRAME THE WIDTH IS WRITTEN BACK IN: a stored column
				// width is applied as a CSS length inside the zoom, so measuring the
				// zoomed rect would shrink every column by the zoom each time the
				// writer dragged one — and again the next time.
				const zoomC = orgZoomOf(table);
				const got = ths.map((th2) => ({
					id: th2.getAttribute('data-col'),
					w: Math.round(th2.getBoundingClientRect().width / zoomC)
				}));
				const m = Object.assign({}, ctx.orgColPx());
				for (const g of got) {
					if (!g.id || !(g.w > 0)) continue;
					// THE CEILING BINDS HERE TOO: a Description holding a sentence is
					// exactly the column that would take the pane.
					m[g.id] = Math.max(ctx.ORG_COL_MIN, Math.min(ceil, g.w));
				}
				// CLEARED, NOT WRITTEN AT THE CAP. The undragged state IS the cap on a
				// phone, and a stored 150 would open the desktop on a width the writer
				// never chose.
				if (narrow) delete m.name;
				s.uniColPx = m;
				this.saveSettings().catch(() => {});
				ctx.drawPanel();
			};
			ctx.orgNameLineNow = orgNameLine;
			// STAMPED NOW, BY AN OBSERVER, AND ONCE MORE AFTER THE BUILD. A seam
			// that shows NOTHING when its stamp has not run is one missed frame
			// away from that state at any time, so reading the width here forces
			// the layout synchronously. At this instant the cell can measure 0 —
			// the call runs between creating the Name heading and the loop that
			// adds the other columns — so a ResizeObserver is the answer, not a
			// later call site: it fires once as soon as the cell HAS a size, and
			// again whenever it changes, so the seam follows a pane being dragged
			// narrower. ONE AT A TIME: an observer per draw would hold every dead
			// table in the session and stamp from all of them.
			orgNameLine();
			try {
				if (ctx.orgNameRO) { ctx.orgNameRO.disconnect(); ctx.orgNameRO = null; }
				const w0 = ctx.ownerWin();
				if (w0 && w0.ResizeObserver) {
					// THE TABLE, NOT THE HEADING. Observing the cell alone fired once while
					// the header held only the Name column, stamped from that, and had no
					// reason to fire again — adding rows does not resize a cell. The TABLE
					// changes size as it is built, so it is the thing to watch.
					ctx.orgNameRO = new w0.ResizeObserver(() => orgNameLine());
					ctx.orgNameRO.observe(table);
					ctx.orgNameRO.observe(wrap);
				}
				// AND ONCE MORE AFTER THE BUILD, unconditionally. The panel is
				// drawn in one synchronous pass, so a task queued here runs
				// with the finished table in front of it — which is the one
				// moment every number this needs is knowable. The observer is
				// what keeps it true afterwards; this is what makes it true.
				if (w0 && w0.setTimeout) w0.setTimeout(() => {
					orgNameLine();
				}, 0);
			} catch (_) { wsCatch('orgTableMake / drawOrg: if (ctx.orgNameRO) ctx.orgNameRO.disconnect();', _); }
			for (const col of cols) {
				const th = hr.createEl('th', { cls: ctx.colTextish(col) ? 'is-text' : '' });
				th.setAttribute('data-col', col.id);
				// NAMED, so it can be given a box of its own to be clipped in.
				// The `th` cannot do it: the resize grip is a CHILD of this cell
				// and hangs 3px past its right edge and the whole height of the
				// table, so `overflow: hidden` here would clip the control the
				// writer just asked to be able to grab.
				th.createSpan({ cls: 'ws-org-headlabel', text: col.label });
				// ── THE STORED WIDTH, IF THERE IS ONE ──────────────────
				//
				// Absent means "the table decides", which is what every
				// column has always got and what a double-click hands back.
				// All three properties, because a `<table>` treats `width` as
				// a suggestion and will overrule it from the content alone.
				ctx.orgColStamp(th, col.id, wrap);
				ctx.orgColGripBind(th, col, wrap);
				if (sortCol && sortCol.id === col.id) {
					th.createSpan({ cls: 'ws-org-sortmark',
						text: wsSortArrow(sortDir) });
				}
				// desc → asc → custom. A click is a LENS, so it goes through the
				// lens's one writer.
				th.title = 'Sort: newest-biggest first, then smallest, then the book’s order';
				th.addEventListener('click', () => {
					// NOT THE ONE THAT ENDS A DRAG. See `orgGripReleasedAt`: the
					// click a grip release synthesises lands here, because the
					// grip itself takes no pointer events.
					if (Date.now() - ctx.orgGripReleasedAt < ctx.ORG_GRIP_CLICK_MS) return;
					const cur = ctx.orgLens.sort;
					if (!cur || cur.id !== col.id) {
						ctx.orgLensSet({ sort: { id: col.id, dir: 'desc' } });
					} else if (cur.dir === 'desc') {
						ctx.orgLensSet({ sort: { id: col.id, dir: 'asc' } });
					} else {
						ctx.orgLensSet({ sort: null });
					}
				});
				// ── AND A DRAG MOVES IT ──────
				// A drop TAKES THE TARGET'S PLACE (not a swap), the hidden columns keep
				// their rank, `uniColOrder` is the one store. The NAME header is
				// outside this loop on purpose — it is the sticky first column and does
				// not move.
				th.setAttribute('draggable', 'true');
				th.addEventListener('dragstart', (ev: DragEvent) => {
					ctx.orgDragCol = col.id;
					try { if (ev.dataTransfer) ev.dataTransfer.setData('text/plain', col.id); } catch (_) { wsCatch('orgTableMake / drawOrg: ev.dataTransfer.setData(\'text/plain\', col.id);', _); }
				});
				th.addEventListener('dragover', (ev: Event) => {
					if (ctx.orgDragCol && ctx.orgDragCol !== col.id) ev.preventDefault();
				});
				// the column lands before this one; the order is saved and the table redrawn
				const dropCol = async (moved: string) => {
					const now: string[] = cols.map((x) => x.id);
					const from = now.indexOf(moved);
					if (from !== -1) now.splice(from, 1);
					const at = now.indexOf(col.id);
					now.splice(at === -1 ? now.length : at, 0, moved);
					const rest = (Array.isArray(s.uniColOrder) ? s.uniColOrder : [])
						.filter((id) => now.indexOf(id) === -1);
					s.uniColOrder = now.concat(rest);
					await this.saveSettings();
					ctx.drawPanel();
				};
				th.addEventListener('drop', (ev: Event) => {
					ev.preventDefault();
					const moved = ctx.orgDragCol;
					ctx.orgDragCol = null;
					if (!moved || moved === col.id) return;
					void dropCol(moved);
				});
				th.addEventListener('dragend', () => { ctx.orgDragCol = null; });
				// ── AND A RIGHT-CLICK ON THE HEADER ─────────────────────────
				//
				// A gesture is not a door, and this is not the only door to any of
				// these: Sort and Filter are bar buttons, the columns are the
				// Properties panel. It is an extra ENTRY POINT into the same state.
				// The header is still the sort control on a plain click, which is
				// why the two sort rows say ↑ and ↓ rather than repeating the
				// cycle: the click cycles, the menu picks.
				th.addEventListener('contextmenu', (ev: MouseEvent) => {
					ev.preventDefault();
					ev.stopPropagation();
					const menu = wsMenu();
					menu.addItem((i) => i.setTitle(col.label).setIsLabel(true));
					menu.addItem((i) => i.setTitle('Sort \u2191')
						.setIcon('arrow-up')
						.onClick(() => ctx.orgLensSet({
							sort: { id: col.id, dir: 'asc' } })));
					menu.addItem((i) => i.setTitle('Sort \u2193')
						.setIcon('arrow-down')
						.onClick(() => ctx.orgLensSet({
							sort: { id: col.id, dir: 'desc' } })));
					// FILTER ONLY WHERE THERE ARE VALUES TO ENUMERATE. A reading
					// is arithmetic over the note, not a value the note carries,
					// and `orgDistinctUnder` has nothing to answer with — a row
					// that always ends in "No values for Words" is a control
					// that only ever apologises.
					const fkey = col.user ? String(col.key)
						: (col.id === 'tags' ? 'tags' : '');
					if (fkey) {
						menu.addItem((i) => i.setTitle('Filter by this\u2026')
							.setIcon('list-filter')
							.onClick(() => ctx.orgFilterByKey(fkey, ev)));
					}
					menu.addSeparator();
					// This plugin shows and hides columns; Obsidian deletes properties.
					menu.addItem((i) => i.setTitle('Hide this column')
						.setIcon('eye-off')
						.onClick(async () => {
							ctx.colOff.add(col.id);
							s.uniColsOff = Array.from<string>(ctx.colOff);
							await this.saveSettings();
							ctx.draw(); void fill(); ctx.drawPanel();
						}));
					// RIGHT UNDER IT: the same act the Properties panel's row calls — one
					// fit, two doors — with the panel row's own words.
					menu.addItem((i) => i.setTitle('Resize columns to fit')
						.setIcon('move-horizontal')
						.onClick(() => { if (ctx.orgColFitNow) ctx.orgColFitNow(); }));
					// WHERE DELETION LIVES NOW: a note's property is removed in
					// Obsidian's own Properties view or by editing the
					// frontmatter; a non-md file's is removed by CLEARING ITS
					// CELL, which drops the row from `ws-structure.md`.
					try { menu.showAtMouseEvent(ev); }
					catch { try { menu.showAtPosition({ x: 0, y: 0 }); } catch (_e) { wsCatch('orgTableMake / drawOrg: menu.showAtPosition( x: 0, y: 0 );', _e); } }
				});
			}
			// THE PICK CELL IS A COLUMN WITH NO BUTTON IN IT. Every row builds a
			// matching `ws-org-pickcell`, and the drawer rows' colspan is
			// `cols.length + 2`, the second of which is this cell: a header one
			// cell short is a ragged table. Dropping the column would move the
			// colspan with it.
			//
			// NOT DRAGGABLE AND NOT A SORT, still: every other th in this row
			// is both, and this one never was, because it is not a column.
			hr.createEl('th', { cls: 'ws-org-headpick' });
			const tbody = table.createEl('tbody');
			// +2, NOT +1: the Name column and the picker's own header cell.
			// A drawer row that spans one column short leaves the picker's
			// column drawing a stray vertical rule down the whole table.
			const colspan = cols.length + 2;
			// THE ONE TRANSITION the table allows: a ~150ms fade when the binder
			// dissolves into the flat list or comes back — it teaches "my folders
			// melted because I sorted". Only on the CHANGE, never on an ordinary
			// repaint, and the stylesheet stands down under prefers-reduced-motion.
			if (ctx.orgLastGrouping !== null && lensed !== ctx.orgLastGrouping) {
				table.addClass('is-melt');
			}
			ctx.orgLastGrouping = lensed;
			// A FOLDER IS A ROW. It sits in the one interleaved order its parent
			// already stores, it carries the same cells every other row carries,
			// and it folds — the folder glyph, the folder's context menu, being a
			// drop target that MOVES a note in, the row does on itself.
			// ── THE TOTAL ROW ─────────────────────────────────────────
			//
			// One row for the whole table, emitted once, HERE — outside the loop
			// below — so that it cannot become a run-break header. THE COUNT COMES
			// FROM THE INDEX, not from `rows`: `rows` is what is DRAWN — folded
			// folders keep their contents out of it — so a caption counting them
			// would say "2 notes" about a folder holding forty, and change when a
			// writer folded something.
			// ── THE LENS EMPTIED IT, OR A FOLD DID ────────────────────
			//
			// The total row hides when a LENS emptied the table and stays when a
			// FOLD did. THE TERMS: `!rows.length` — nothing is drawn; `list.length`
			// — but there was something to draw. `list` is post-SHAPE and
			// pre-LENS, so "Folders only" over a folder with no subfolders leaves
			// it 0 and this stays false: that is a scope with nothing in it, not a
			// filter that hid things.
			//
			// ONE WRITER: the empty-state block below asks the same question to
			// choose its own words, and reads this rather than repeating the terms.
			const orgLensEmptied = !rows.length && !!list.length;
			if (!orgLensEmptied) {
				// A TOTAL ROW AT THE FOOT, NOT A SUBJECT ROW AT THE HEAD: the
				// aggregates over what is shown, the flags' pairs, the mark cell
				// `orgRepaintFlagCell` redraws — built here and appended after the
				// rows, and it says Total. The folder's name and glyph are the subject
				// line's; the fold-all is the bar's Collapse all.
				const subj = tbody.createEl('tr', { cls: 'ws-org-subrow is-total' });
				subj.remove();
				const std = subj.createEl('td', { cls: 'ws-org-name' });
				const box = std.createDiv({ cls: 'ws-org-subject-in' });
				try { std.setCssProps({ '--ws-org-depth': '0' }); }
				catch (_) { wsCatch('orgTableMake / drawOrg: std.setCssProps({ --ws-org-depth: 0 });', _); }
				box.createSpan({ cls: 'ws-org-subjectname', text: 'Total' });
				std.title = at ? 'Everything under ' + ctx.nameOf(at) : 'Everything in the vault';
				const subUnder = ctx.orgUnder(at);
				// ONE DRAWER FOR AN AGGREGATE, the total row's and the folder rows'
				// alike: text for most, and for the Flag column a number and the
				// flag's own glyph per flag — `2 ▸ 3 ▸`, each pair one span so the gap
				// between pairs is the sheet's and not a space character's.
				const aggInto = (td: HTMLElement, agg: WsOrgColAgg) => {
					if (!agg) return;
					if (agg.flags) {
						td.addClass('ws-org-aggflags');
						for (const f of agg.flags) {
							const pair = td.createSpan({ cls: 'ws-org-aggflag' });
							pair.createSpan({ cls: 'ws-org-aggflagn', text: String(f.n) });
							const ic = pair.createSpan({ cls: 'ws-org-flagic' });
							wsSvgInto(ic, wsFlagSvg(String(f.id), 10));
							pair.title = f.n + (f.n === 1 ? ' file ' : ' files ') + f.label;
						}
					} else {
						td.setText(agg.text);
					}
					// a folder's target wears the band its notes wear
					if (agg.goal) ctx.orgGoalBand(td, agg.goal.words, agg.goal.target);
					if (agg.title) td.title = agg.title;
				};
				ctx.orgAggInto = aggInto;
				for (const col of cols) {
					const td = subj.createEl('td',
						{ cls: ctx.colTextish(col) ? 'is-text' : '' });
					td.setAttribute('data-col', col.id);
					// THE WIDTH REACHES THE CELL, not only the header — see
					// `orgColStamp`. Without this the column is as wide as its
					// widest cell whatever the header asks for.
					ctx.orgColStamp(td, col.id, wrap);
					const agg = ctx.orgColAgg(col, subUnder);
					if (agg) aggInto(td, agg);
				}
				// AND THE PICKER’S COLUMN, so the row is not one cell short
				// and the table draws level - the same trailing cell every
				// other row emits, for the same reason. In Outline the subject
				// spans instead, exactly as the rows under it do.
				subj.createEl('td', { cls: 'ws-org-pickcell' });
				ctx.orgTotalRow = subj;
			}
			// THE SELECTION'S TINT, repainted in place on a modified click: a full
			// redraw for a class on a row would rebuild the table for every
			// Ctrl-click of a long selection.
			ctx.orgSelPaint = (body: HTMLElement) => {
				for (const tr0 of Array.from<HTMLElement>(body.querySelectorAll('tr.ws-org-row'))) {
					const p = tr0.getAttribute('data-path') || '';
					tr0.toggleClass('is-selected', !tr0.classList.contains('is-folder') && ctx.orgSelHas(p));
				}
				table.toggleClass('has-sel', ctx.orgSelCount() >= 2);
				// THE BAR ON EACH, snapped to the device grid as the active one's is —
				// the click painted the class, the snap follows.
				try { orgSnapAccent(); } catch (_) { wsCatch('orgSelPaint: orgSnapAccent();', _); }
				// AND THE COUNT BESIDE UNDO.
				try { if (ctx.orgBarSayPaint) ctx.orgBarSayPaint(); } catch (_) { wsCatch('orgSelPaint: ctx.orgBarSayPaint();', _); }
			};
			// A RULE OVER A FOLDER ROW — unless the row above already draws one
			// under itself (a folder row), which would make two. The draw knows the
			// order; the sheet does not. The first row has the header's rule over
			// it.
			let prevRuled = true;
			for (const row of rows) {
				const isFolder = row.kind === 'folder';
				// KEEPS `ws-org-row`, and that is a decision rather than a convenience:
				// it is the class the first-column freeze, the touch-drag row list and
				// the measurements all select on.
				const tr = tbody.createEl('tr',
					{ cls: 'ws-org-row' + (isFolder ? ' is-folder' : '') + (isFolder && !prevRuled ? ' is-topline' : '') });
				prevRuled = isFolder;
				tr.setAttribute('data-path', row.path);
				// The followed note is marked HERE too: the table is where the folder
				// is read.
				if (row.path === ctx.orgNote) tr.addClass('ws-org-active');
				// A ROW IN THE SELECTION WEARS IT, across a redraw too.
				if (!isFolder && ctx.orgSelHas(row.path)) tr.addClass('is-selected');
				const nameTd = tr.createEl('td', { cls: 'ws-org-name' });
				// A TABLE CELL AGAIN, WITH THE FLEX ROW INSIDE IT. A cell that is
				// itself `display: flex` is a flex box in an anonymous cell rather than
				// a cell: it stops at its own content while a taller cell sets the row
				// (a checkbox property makes the row 25px, a phone-sized hit 44), and
				// the guide painted on the cell — and the cell's own opaque background
				// — ends short of every such row. `height: 100%` and `align-self` do
				// nothing for a flex box in that position. So the chevron, the glyph,
				// the label and the tag sit in this wrapper, which is the flex row, and
				// the cell stretches with its row as cells do.
				//
				// THE NUMBER FIRST, at the cell's left edge before the indent — a
				// column of its own inside the sticky Name, so the seam and the guides
				// need not learn about a second column.
				if (nums && nums.has(row.path)) {
					nameTd.createSpan({ cls: 'ws-org-num', text: nums.get(row.path) });
				}
				const nameIn = nameTd.createDiv({ cls: 'ws-org-namein' });
				// THE ROW'S KIND, drawn by the tree's own builder — same dropdown, same
				// checked names, so a note reads as a note and a PDF as a PDF in both
				// places. BEFORE the label, which is where the tree puts it and where
				// the eye looks for it.
				// THE INDENT, as a depth the stylesheet turns into padding:
				// the step is read from Obsidian's own --nested-item-* vars
				// there, which is where the tree beside this table reads it,
				// so both panes step by the same amount under any theme. A top-level
				// row is depth 0. A lens draws no folder rows, so the guide lines a
				// depth would draw point at rows that are not on screen: under a
				// lens every row is at 0.
				try {
					nameTd.style.setProperty('--ws-org-depth',
						String(lensed ? 0 : (row.depth || 0)));
				} catch (_) { wsCatch('orgTableMake / drawOrg: nameTd.style.setProperty(\'--ws-org-depth\',', _); }
				// A FOLDER'S CHEVRON IS ITS DOOR. Every control needs a visible one,
				// and folding is the only thing here that has no other way in.
				if (isFolder) {
					const open = ctx.orgIsOpen(row.path);
					const twist = ctx.orgChevron(nameIn, open);
					twist.title = open ? 'Fold this folder' : 'Unfold this folder';
					twist.addEventListener('click', (ev: Event) => {
						ev.stopPropagation();
						ctx.orgOpenSet(row.path, !ctx.orgIsOpen(row.path));
					});
				} else {
					// ── AND A NOTE RESERVES THE SLOT ───────────────────────────
					//
					// A folder row spends 16px of chevron plus 2px of margin that a note
					// row would spend nothing on, and the indent step is only 16px — so
					// without the spacer a note's glyph drew LEFT of its parent folder's.
					// Obsidian's explorer reserves it, and the menu pane draws the same
					// spacer for the same reason.
					//
					// IT WEARS THE APP'S CHEVRON BOX TOO, empty: that is how it is
					// guaranteed to be exactly as wide as the real one under any theme. A
					// DIFFERENT CLASS FROM THE REAL ONE, deliberately: seven places reach
					// for the first `.ws-org-twist` in a row and click it, and a blank one
					// answering them would be a dead door reporting as a live one.
					nameIn.createSpan({ cls: 'ws-org-twistgap tree-item-icon'
						+ ' collapse-icon nav-folder-collapse-indicator' });
				}
				// A FOLDER WEARS THE TREE'S FOLDER GLYPH, drawn open or shut
				// to match its own state; a note wears its kind glyph.
				// `orgKindIcon` tests for `.md` and would give a folder the
				// generic file glyph, which is the sort of miss that reads
				// as a theme problem rather than a wiring one.
				if (isFolder) ctx.orgFolderIcon(nameIn, row.path, ctx.orgIsOpen(row.path));
				else this.orgKindIcon(nameIn, row.path);
				// The label wears a class because the rename finds it by one:
				// a bare span would make the lookup positional, and the first
				// markup change would point the rename at the wrong element.
				// ── THE FOLDER LEADS, THE FILE FOLLOWS ──────────────────
				//
				// Folder paths vary in length, so the file names no longer align down
				// a left edge; the order is what was asked for. ORDER IN THE DOM, NOT
				// `order:` IN THE SHEET. The cell is a flex row and CSS could reorder
				// it — but the tick box and the kind glyph are flex items here too,
				// and an `order` that only mentions two of four is a rule the next
				// item silently joins the wrong side of. It also keeps reading order
				// and paint order the same thing, which is what a screen reader gets.
				if (lensed && row.rel) {
					nameIn.createDiv({ cls: 'ws-org-path', text: row.rel });
				}
				nameIn.createSpan({ cls: 'ws-org-namelabel', text: ctx.nameOf(row.path) });
				// AND THE FORMAT IS SAID IN WORDS, AFTER THE NAME — the labels
				// Obsidian's own explorer draws. A note gets none, because every row
				// in a vault would carry the same word.
				if (!isFolder) this.orgKindTag(nameIn, row.path);
				// THE WHOLE LOCATION ON HOVER, now that the row shows both
				// halves: a truncated cell is exactly when a writer asks.
				nameTd.title = (lensed && row.rel)
					? row.rel + ' / ' + ctx.nameOf(row.path)
					: ctx.nameOf(row.path);
				// THE FLAG IS STILL A FILE'S — see below. `markOf` returns '' for a
				// folder, so a flag there would be a control that cycles nothing.
				for (const col of cols) {
					const td = tr.createEl('td', { cls: ctx.colTextish(col) ? 'is-text' : '' });
					td.setAttribute('data-col', col.id);
					ctx.orgColStamp(td, col.id, wrap);
					// A FOLDER'S CELLS ARE ITS SUBTREE'S TOTAL, the way Scrivener's Total
					// columns do it. Taken from the INDEX via `orgUnder`, never from the
					// drawn rows: read off what is on screen, shutting a folder would
					// change its own number, and a fold that moves a total is a fold
					// acting as a filter.
					if (isFolder) {
						const agg = ctx.orgColAgg(col, ctx.orgUnder(row.path));
						if (agg) {
							// A SUMMARY IS NOT A MEASUREMENT: folder aggregate cells render in a
							// visibly different weight from note values, so nobody reads a
							// folder's average as a measurement. It matters most for the weighted
							// grade, which is a figure no note actually carries.
							td.addClass('ws-org-aggcell');
							// THE TOTAL ROW'S DRAWER: a folder's flags are a number and a glyph
							// per flag, drawn the same in both.
							if (ctx.orgAggInto) ctx.orgAggInto(td, agg);
							else { td.setText(agg.text); if (agg.title) td.title = agg.title; }
						}
						continue;
					}
					const text = ctx.orgColText(col, row.path);
					// ── MALFORMED FRONTMATTER IS VISIBLE, NOT PLAUSIBLE ──────
					//
					// A value that does not parse as its DECLARED type is drawn muted with
					// the raw string on hover — `28 07` sitting in a date. ASKED ONLY OF
					// THE PROPERTY COLUMNS, which is what `col.user` marks. The built-in
					// readings are computed by this plugin, not typed by a person, so there
					// is nothing there to be malformed — and parse-checking them would
					// invent a way for a word count to look broken.
					if (col.user) {
						const raw = ctx.orgColRaw(col, row.path);
						const pk = col.key || col.id;
						const fmt = this.formatValue(pk, raw, this.orgPropType(pk),
							this.dateStyle());
						if (!fmt.ok) {
							td.addClass('ws-org-badval');
							td.title = 'This is not a valid ' + (this.orgPropType(pk) || 'value')
								+ ': ' + wsStr(raw);
						}
					}
					// The mark and goal cells are CONTROLS as well as readings: the flag
					// cycles, the target edits.
					if (col.id === 'mark') { ctx.orgFlagCell(td, row, text); continue; }
					if (col.id === 'goal') { ctx.orgGoalCell(td, row, text); continue; }
					if (col.id === 'tags') { ctx.orgTagsCell(td, row); continue; }
					// A FILE ROW ONLY. A folder has no backlinks of its own; its cell
					// is the aggregate over the notes beneath it, which is a count and
					// not a list of doors.
					if (col.id === 'backlinks' && !isFolder) {
						td.textContent = '';
						ctx.orgBackCell(td, row);
						continue;
					}
					if (col.id === 'outlinks' && !isFolder) {
						td.textContent = '';
						ctx.orgOutCell(td, row);
						continue;
					}
					// ── A PROPERTY IS WRITTEN WHERE IT IS READ ──────
					//
					// A property COLUMN's cell edits in place like the flag and the target
					// beside it.
					//
					// ── A CHECKBOX IS A BOX, NOT A TICK GLYPH ────
					//
					// `formatValue` answers '✓' for true and THE EMPTY STRING for false, so
					// the cell would be a tick or nothing at all — and an unticked box and
					// an empty cell are different facts: one says "not done", the other
					// "never answered". OBSIDIAN'S OWN INPUT, undressed: a bare
					// `input[type=checkbox]` is what the app styles for every other
					// checkbox a theme sees, so this takes the theme's look for free and
					// follows it when the theme changes. NOT DRAWN FOR A FOLDER ROW: that
					// cell is the aggregate over what is beneath it, a count and not a
					// state.
					if (col.user && !isFolder
						&& String(this.orgPropType(col.key || col.id)).toLowerCase() === 'checkbox') {
						// ── AND ABSENT IS NOT FALSE ──────
						//
						// A CHECKBOX HAS TWO STATES AND A PROPERTY HAS THREE. A box on every
						// row would make a note that has never carried the key look exactly
						// like one deliberately left unticked. SO THE CELL CYCLES, which is
						// this window's own grammar (the flag cell has always cycled):
						//
						// nothing  ->  ticked  ->  unticked  ->  nothing
						//
						// AND THAT IS THE ONLY WAY "DISPLAY NOTHING UNTIL I ADD IT" CAN HOLD:
						// once empty means absent, there has to be a road back to empty, or a
						// property could be added and never removed. The third press is that
						// road.
						const raw0 = ctx.orgColRaw(col, row.path);
						const rawv = (typeof raw0 === 'boolean' || typeof raw0 === 'string') ? raw0 : (raw0 == null ? '' : wsStr(raw0));
						const has = rawv !== null && rawv !== undefined && rawv !== '';
						td.textContent = '';
						const canEdit = ctx.orgCanHoldProps(row.path);
						if (canEdit) td.addClass('is-prop');
						const bx = has
							? td.createEl('input', { cls: 'ws-org-cellcheck' })
							: null;
						if (bx) {
							bx.type = 'checkbox';
							bx.checked = rawv === true;
							bx.disabled = !canEdit;
						}
						td.title = !canEdit
							? 'This kind of file cannot hold properties'
							: (!has
								? 'Not set \u2014 press to add it, ticked'
								: (rawv === true
									? 'Ticked \u2014 press to untick'
									: 'Unticked \u2014 press to remove it from this file'));
						// THE WHOLE CELL IS THE TARGET, which is the other half
						// of the report: a 13px box in a 24px row is a thing to
						// aim at, and the cell is not.
						// ONE WRITER FOR THE CYCLE, whichever element was pressed.
						// The box and the cell both land in `step`, and the next
						// state is worked out from the VALUE — not from what the
						// input is showing. A checkbox toggled by the browser has
						// already changed itself, and reading that back would
						// lose the third state before it was ever written.
						const nextOf = (v: string|boolean) => {
							if (v === null || v === undefined || v === '') return true;
							if (v === true) return false;
							return '';
						};
						const step = async () => {
							if (!canEdit) { ctx.orgPropRefuse(row.path); return; }
							const stored = this.propStoreHolds(row.path);
							ctx.orgRedrawPending = true;
							await ctx.orgPropSet(row.path,
								col.key || col.id, nextOf(rawv));
							if (stored) ctx.orgEditDone();
						};
						td.addEventListener('click', (ev: Event) => {
							ev.stopPropagation();
							void step();
						});
						if (bx) {
							// THE BROWSER'S OWN TOGGLE IS REFUSED. Left to itself the input would
							// flip to a state the cycle may not be going to — unticked is not what
							// follows unticked — and the redraw would then correct it in front of
							// the writer.
							bx.addEventListener('click', (ev: Event) => {
								ev.stopPropagation();
								ev.preventDefault();
								void step();
							});
						}
						// ── ONE REDRAW, AND NOT BEFORE THE WRITE LANDS ──────
						//
						// On-off-on is two redraws racing one write: the click sets the box
						// (on); a redraw reads the value BACK before `processFrontMatter` has
						// landed and Obsidian's cache has caught up, so it paints the old state
						// (off); the cache updates and it paints on again. A NOTE ALREADY GETS
						// ITS REDRAW FOR FREE — writing frontmatter changes the file, Obsidian
						// fires a metadata event and the index ring redraws — so asking for
						// another here is the second of the two. A STORE-HELD FILE FIRES
						// NOTHING, so that one still has to be asked. (`step` above is the one
						// writer; a `change` handler beside it would write twice for one
						// press.)
						continue;
					}
					if (col.user) { ctx.orgPropCell(td, row, col, text); continue; }
					td.setText(text);
					// The cap cuts, the hover answers — same trade the old
					// table made, kept because it is the right one.
					if (text) td.title = text;
				}
				// THE PICKER'S COLUMN, kept level: the header carries a cell, so every
				// row does.
				//
				// THE PICK CELL IS THE TABLE'S: the header picker needs a column to
				// sit in, and every row emits one so the table draws level.
				tr.createEl('td', { cls: 'ws-org-pickcell' });
				// SINGLE CLICK SHOWS, DOUBLE CLICK OPENS. FILES ONLY: a folder row
				// already has the one door folding has — its twist — and making the
				// row body navigate into the folder is a second act nobody asked for.
				//
				// GUARDED THE WAY THE BINDER ROW IS, and the same list. Every control
				// in these cells already stops propagation itself, so this changes
				// nothing TODAY — it is here so the next cell to grow a handler does
				// not have to remember. A TAG CHIP IS NOT ON THE LIST: it carries no
				// handler — it is text in a cell — so excluding it would make one
				// patch of the row inert for no reason a writer could see.
				const inCtl = (ev: Event) => !!(ev.target && ev.target !== tr
					&& (ev.target as HTMLElement).closest && (ev.target as HTMLElement).closest(
						'input, select, button, textarea, .ws-goals-chip,'
						+ ' .ws-goals-chev, .ws-org-twist'));
				tr.addEventListener('click', (ev: MouseEvent) => {
					if (inCtl(ev)) return;
					// ── A FOLDER ROW FOLDS ITSELF ON A NARROW SCREEN ────────
					//
					// The twist is 16 x 15.6px, the smallest control in the window and
					// the one that opens a folder. It reaches 28 x 44 under `is-narrow`
					// and no further, because its width IS the tree's indent per level —
					// at 44 a three-deep folder would spend 132px of a 390px screen on
					// indent alone. The row is 44 tall and costs nothing: the SAME act as
					// the twist, with a bigger target.
					//
					// NARROW ONLY. On a desktop the twist is a good target for a mouse,
					// and a whole row that folds on any stray click is worse than a small
					// one you aim at. `orgNarrowNow` reads the CLASS the ResizeObserver
					// maintains, not the platform flag — a docked 300px pane on a desktop
					// is narrow too. AND THE TWIST IS NOT DOUBLE-FIRED: `inCtl` already
					// names `.ws-org-twist`, so a tap on the chevron returns above.
					if (isFolder) {
						if (ctx.orgNarrowNow()) ctx.orgOpenSet(row.path, !ctx.orgIsOpen(row.path));
						return;
					}
					// ── A CLICK HERE SELECTS. IT DOES NOT NAVIGATE ─────────
					//
					// The way into a folder is Obsidian's explorer; a click on a note row
					// here selects it and shows it, a double click opens it. A MODIFIED
					// CLICK SELECTS: Ctrl/Cmd toggles the row, Shift takes the range over
					// the rows shown; the table is repainted for the tint and the note is
					// NOT shown — a click that gathers rows is not a click that opens one.
					// A plain click clears the selection and shows the note.
					if (ctx.orgSelClick(ev, row, rows.map((r0) => r0.path))) {
						if (ctx.orgSelPaint) ctx.orgSelPaint(tbody);
						return;
					}
					if (ctx.orgSelPaint) ctx.orgSelPaint(tbody);
					ctx.showItem({ path: row.path, kind: row.kind }, true);
				});
				tr.addEventListener('dblclick', (ev: MouseEvent) => {
					if (inCtl(ev) || isFolder) return;
					ctx.openRow({ path: row.path, kind: row.kind });
				});
				// The right-click is the tree's own menu — see orgMenuCtx.
				tr.addEventListener('contextmenu', (ev: MouseEvent) => {
					ev.preventDefault();
					ev.stopPropagation();
					const menu = wsMenu();
					this.outlinerRowMenu(menu,
						{ path: row.path, kind: row.kind }, ctx.orgMenuCtx);
					menu.showAtMouseEvent(ev);
				});
				// Drag exists only while the book's own order is showing — under any
				// lens this call is simply never made. A FOLDER ROW CARRIES BOTH:
				// reorder at its edges, and the move-into, so a note can be moved
				// between folders from the right pane.
				if (!lensed) {
					ctx.orgRowDrag(tr, row);
					if (isFolder) ctx.orgGroupDrop(tr, row.path);
				}
			}
			// THE TOTAL ROW, LAST. Under a folder row it is stamped `is-ruled` and
			// draws no top rule of its own: the folder row's bottom rule is the
			// line between them.
			if (ctx.orgTotalRow) {
				if (prevRuled) ctx.orgTotalRow.classList.add('is-ruled');
				tbody.appendChild(ctx.orgTotalRow);
				ctx.orgTotalRow = null;
			}
			// A FOLD IS NOT AN EMPTY RESULT. "Nothing passes the lens — clear it"
			// whenever there are no rows and the list is not empty would be a LIE
			// when a fold did the emptying — offering a button that would fix
			// nothing. SAME QUESTION, ONE WRITER: `orgLensEmptied` decides, and
			// the `if` one line down reads `list.length` to choose between the two
			// sentences.
			if (orgLensEmptied || !rows.length) {
				// A DEAD END MUST SPEAK AND OFFER THE WAY OUT — the clearing is a
				// BUTTON here, not a sentence about one.
				const tr0 = tbody.createEl('tr', { cls: 'ws-org-row is-empty' });
				const td0 = tr0.createEl('td');
				td0.setAttribute('colspan', String(colspan));
				if (list.length) {
					td0.createSpan({ text: 'Nothing passes the lens — ' });
					const b0 = td0.createEl('button', {
						cls: 'ws-export-mini ws-org-clearempty', text: 'Clear it' });
					b0.addEventListener('click', (ev: Event) => {
						ev.stopPropagation();
						ctx.orgLensClear();
					});
					td0.createSpan({ text: ' to see the '
						// `noteCount`, the strip's own counter, so this and the strip say the
						// same number.
						+ noteCount(list) + ' notes here.' });
				} else {
					// IT NAMES WHAT IT WENT LOOKING FOR. With "Folders only" up,
					// a scope holding no subfolder is not a scope holding no
					// notes, and saying the second sends a writer to check the
					// wrong thing.
					td0.setText(shaped === 'folders'
						? 'No folders under this folder.'
						: 'No notes under this folder.');
				}
			}
			// ── THE CELL THE WRITER ACTUALLY PRESSED ────────────────────
			//
			// A click on a cell while another editor was open rebuilds the
			// pane rather than opening a second box, and the `td` it was
			// pressed on does not survive that. This re-opens the one that
			// was asked for, so the redraw is invisible to the writer: they
			// pressed a cell and that cell is open.
			//
			// TAKEN BEFORE IT IS USED, so a failure to find the cell cannot
			// leave the request standing and re-open it on the NEXT redraw,
			// which would be a box appearing from nothing.
			if (ctx.orgOpenAfter) {
				const want = ctx.orgOpenAfter;
				ctx.orgOpenAfter = null;
				try {
					const td2 = ctx.panel.querySelector('.ws-org-row[data-path="'
						+ want.path + '"] td[data-col="' + want.id + '"]');
					if (td2 && !td2.querySelector('.ws-org-editor')) {
						td2.textContent = '';
						ctx.orgFieldEditor(td2, want.path, want.key, false);
					}
				} catch (_) { wsCatch('orgTableMake / drawOrg: const td2 = ctx.panel.querySelector(\'.ws-org-row[data-path="\'', _); }
			}
			// AND THE WRITER IS PUT BACK WHERE THEY WERE. LAST, because the rows
			// have to exist first: a scroller whose content is not in yet clamps
			// the assignment to whatever fits, which is usually zero — the same
			// fault, silently.
			if (orgKeepScroll > 0) {
				try {
					const w1 = ctx.panel.querySelector('.ws-org-panel');
					// WRITTEN, NEVER READ BACK. Setting it is a layout write and costs
					// nothing here; reading it to check would force a layout.
					if (w1) w1.scrollTop = orgKeepScroll;
				} catch (_) { wsCatch('orgTableMake / drawOrg: const w1 = ctx.panel.querySelector(\'.ws-org-panel\');', _); }
			}
			// AND THE COLUMNS: the sideways position the last box reported, put
			// back on the new one.
			if (orgKeepScrollX > 0) {
				try {
					const w2 = ctx.panel.querySelector('.ws-org-panel');
					if (w2) w2.scrollLeft = orgKeepScrollX;
				} catch (_) { wsCatch('orgTableMake / drawOrg: w2.scrollLeft = orgKeepScrollX;', _); }
			}
		};
		return { drawOrg };
	},

	// ════════════════════════════════════════════════════════════════════════
	// THE TREE'S REMOTE: Obsidian's file tree drives the Organizer
	// ════════════════════════════════════════════════════════════════════════
	//
	// Every open window — tab and pop-out — registers a DOOR here when it
	// opens and takes it away when it closes; the tree and the active note
	// drive every door there is. A door that throws is contained and
	// named, so one broken window cannot stop the others.
	//
	// THE CLICK IS WATCHED, NOT ASKED FOR. A capture-phase click listener
	// on the document sees a click on a folder row before Obsidian folds
	// the folder, and does not stop it: the fold is Obsidian's, the
	// choosing is ours. It is attached with the first door and let go with
	// the last, so a tree with no Organizer open has nothing of ours on
	// it. Notes need no listener: a click on a note opens it, `file-open`
	// fires, and the door follows it.

	orgWindows(this: WordSmith) {
		return (this._orgWindows || []).slice();
	},

	orgWindowAdd(this: WordSmith, door: WsOrgDoor) {
		this._orgWindows = this.orgWindows().filter((d) => d !== door);
		this._orgWindows.push(door);
		this.orgTreeHookAttach();
		this.orgTicksSchedule();
	},

	orgWindowDrop(this: WordSmith, door: WsOrgDoor) {
		this._orgWindows = this.orgWindows().filter((d) => d !== door);
		if (!this._orgWindows.length) this.orgTreeHookDetach();
		this.orgTicksSchedule();
	},

	// ── THE EXPORT TICKS, IN OBSIDIAN'S TREE ──────────────────
	//
	// While a window has its Export tab up, every note row and folder row
	// in the file explorer carries a box: the same tick, the same store,
	// the same all / some / none. Off otherwise, and taken away when the
	// last window closes.
	//
	// PAINTED BY PATH, NOT BY SCAN: Obsidian's explorer keeps `fileItems`,
	// a map from path to the row it built, and reuses those rows when its
	// virtual scroller detaches and reattaches them — so a box put on
	// `selfEl` survives scrolling and no observer has to put it back. A
	// row scan is the fallback for a build without the map.
	//
	// THE TICK NEVER OPENS THE NOTE OR FOLDS THE FOLDER: the box stops its
	// own click and mousedown before the row's handlers see them, and the
	// folder-click hook above ignores it by class.
	orgTicksDoor(this: WordSmith) {
		for (const w of this.orgWindows()) {
			try {
				if (!w.ticks) continue;
				if (w.ticks.wanted()) return w;
			} catch (e) { wsGuardReport('the Organizer answering whether the tree wants ticks', e); }
		}
		return null;
	},

	orgTicksWanted(this: WordSmith) { return !!this.orgTicksDoor(); },

	// One repaint a tick, however many asks arrive in it. A TIMEOUT, NOT A
	// FRAME: an occluded Electron window throttles requestAnimationFrame
	// to nothing, and a writer with the window behind another app would
	// come back to a tree with no ticks.
	orgTicksSchedule(this: WordSmith) {
		if (this._ticksScheduled) return;
		this._ticksScheduled = true;
		window.setTimeout(() => { this._ticksScheduled = false; this.orgTicksRepaint(); }, 0);
	},

	// The rows of every explorer leaf, by path: `{ path, el, kind }`.
	orgTicksRows(this: WordSmith) {
		const out = [];
		for (const view of this.explorerViews()) {
			const items = view && view.fileItems;
			if (items && typeof items === 'object') {
				for (const path of Object.keys(items)) {
					if (path === '/' || path === '') continue;
					const it = items[path];
					const el = it && (it.selfEl || it.titleEl);
					if (!el) continue;
					const kind = (it.file && it.file.children) || (el.classList && el.classList.contains('nav-folder-title')) ? 'folder' : 'file';
					out.push({ path, el, kind });
				}
				continue;
			}
			// The fallback: the rows as drawn.
			const root = view && view.containerEl;
			if (!root || root.nodeType !== 1) continue;
			for (const el of Array.from(root.querySelectorAll('.nav-file-title[data-path], .nav-folder-title[data-path]'))) {
				const path = el.getAttribute('data-path');
				if (!path || path === '/') continue;
				out.push({ path, el, kind: el.classList.contains('nav-folder-title') ? 'folder' : 'file' });
			}
		}
		return out;
	},

	orgTicksRepaint(this: WordSmith) {
		const door = this.orgTicksDoor();
		if (!door) { this.orgTicksClear(); return 0; }
		let n = 0;
		for (const row of this.orgTicksRows()) {
			try {
				if (row.kind === 'file' && !/\.md$/i.test(row.path)) continue;
				let box = row.el.querySelector(':scope > .ws-treetick') as HTMLInputElement | null;
				if (!box) {
					box = createEl('input');
					box.type = 'checkbox';
					box.className = 'ws-treetick ws-uni-check';
					box.draggable = false;
					box.addEventListener('mousedown', (ev: Event) => ev.stopPropagation());
					box.addEventListener('click', (ev: Event) => ev.stopPropagation());
					box.addEventListener('change', (ev: Event) => {
						ev.stopPropagation();
						const d = this.orgTicksDoor();
						try { if (d) d.ticks.toggle(row.path, row.kind); }
						catch (e) { wsGuardReport('the tree ticking a row for Export', e); }
						this.orgTicksSchedule();
					});
					// RIGHT AFTER THE CHEVRON, before everything else on the row — our own
					// folder icon included. A note row has no chevron, so the box is its
					// first thing.
					const chev = row.el.querySelector(':scope > .tree-item-icon, :scope > .collapse-icon');
					if (chev && chev.nextSibling) row.el.insertBefore(box, chev.nextSibling);
					else if (chev) row.el.appendChild(box);
					else row.el.insertBefore(box, row.el.firstChild);
				}
				const st = door.ticks.state(row.path, row.kind);
				// A ROW OUTSIDE THE EXPORT IS NOT DEAD: its box is empty and live, and
				// a tick brings the row in.
				const dead = !st || !st.mine;
				box.disabled = false;
				box.title = dead ? 'Nothing here goes into an export' : '';
				box.checked = !dead && st.all;
				box.indeterminate = !dead && st.some;
				box.classList.toggle('is-part', !dead && st.some);
				n++;
			} catch (e) { wsGuardReport('the tree painting an Export tick', e); }
		}
		return n;
	},

	// BY THE SAME ROWS THE PAINT WALKS, not by a document query alone: the
	// explorer keeps a row for every path, and the rows of a folder that is
	// shut are built and DETACHED — a box painted on one of those is not in
	// the document, so a query there left it, and the folder opened later
	// with its ticks on and no Export tab to answer for them.
	orgTicksClear(this: WordSmith) {
		for (const row of this.orgTicksRows()) {
			try { row.el.querySelectorAll(':scope > .ws-treetick').forEach((el) => el.remove()); }
			catch (_) { wsCatch('orgTicksClear: row.el.querySelectorAll(:scope > .ws-treetick)', _); }
		}
		try { document.querySelectorAll('.ws-treetick').forEach((el) => el.remove()); }
		catch (_) { wsCatch('orgTicksClear: document.querySelectorAll(.ws-treetick)', _); }
	},

	// ── THE RIGHT-CLICK ────────────────────────────────────────
	//
	// "Organizer here", "Export this", "History here" on a folder; the
	// first and last on a note. This is the path that keeps working if the
	// click hook ever stops, and what a phone gets as a long-press. A
	// window already open is used and brought forward; none open, the pane
	// is opened. Either way the folder is CHOSEN through the same door a
	// click uses, so it persists like a click.

	async orgOpenAt(this: WordSmith, path: string, tabId: string, opts?: { note?: string; only?: string[] }) {
		const p = (path == null || path === '/') ? '' : String(path);
		const o = opts || {};
		const id = tabId || 'organizer';
		let door = this.orgDoorFor(id);
		if (!door) {
			try { this._wsSession = this._wsSession || wsSessionNew(); } catch (_) { wsCatch('orgOpenAt: this._wsSession = this._wsSession || wsSessionNew();', _); }
			if (this._wsSession) this._wsSession.tab = id;
			try { await this.openOutlinerPane(id); } catch (e) { wsGuardReport('the tree opening the Organizer', e); }
			door = this.orgDoorFor(id);
			if (!door) return false;
		}
		try { if (door.tab() !== id && door.tabSet) door.tabSet(id); } catch (e) { wsGuardReport('the tree switching the Organizer’s tab', e); }
		if (o.only) {
			// The export's ticks, exactly these. The Organizer's folder is left
			// where it was: the export is the vault.
			try { if (door.ticksOnly) void door.ticksOnly(o.only); } catch (e) { wsGuardReport('the tree ticking what to export', e); }
		} else {
			this.orgTreeSelect(p);
			if (o.note) this.orgTreeFollow(o.note);
		}
		this.orgReveal(door);
		return true;
	},

	// A pane host is brought forward; a modal is already in front.
	orgReveal(this: WordSmith, door: { host: () => WsHost | null }) {
		try {
			const host = door && door.host && door.host();
			const h = host && host.handle && host.handle();
			const leaf = h && 'leaf' in h ? h.leaf : null;
			if (leaf && this.app.workspace.revealLeaf) void this.app.workspace.revealLeaf(leaf);
		} catch (e) { wsGuardReport('the tree bringing the Organizer forward', e); }
	},

	// The rows for one file or folder. Called from fileMenuFor.
	fileMenuOrganizerRows(this: WordSmith, menu: Menu, file: WsFileLike) {
		if (!file || !file.path) return;
		const isFolder = !!file.children;
		const path = String(file.path);
		const here = isFolder ? path : (path.lastIndexOf('/') > 0 ? path.slice(0, path.lastIndexOf('/')) : '');
		const note = isFolder ? null : path;
		const row = (title: string, icon: string, tabId: string) => {
			menu.addItem((i) => {
				i.setTitle(title);
				try { if (i.setIcon) i.setIcon(icon); } catch (_) { wsCatch('fileMenuOrganizerRows: if (i.setIcon) i.setIcon(icon);', _); }
				// MIRRORED WHERE THE MENU MIRRORS IT. Obsidian's MenuItem holds its
				// glyph in `iconEl`; the same class the bar menu stamps, so one rule
				// flips both — and only when the glyph that drew is the one the menu
				// flips, never a fallback.
				try {
					if (this.menuIconMirrored && this.menuIconMirrored(tabId) && i.iconEl
						&& i.iconEl.querySelector('svg')) i.iconEl.addClass('is-mirrored');
				} catch (_) { wsCatch('fileMenuOrganizerRows: i.iconEl.addClass(\'is-mirrored\');', _); }
				// "Export this" is a set of ticks, not a scope: the export is the
				// vault, and exactly this goes out.
				i.onClick(() => { void this.orgOpenAt(here, tabId, tabId === 'export' ? { note: note || undefined, only: [path] } : { note: note || undefined }); });
			});
		};
		row('Organizer here', 'list-tree', 'organizer');
		// On notes too.
		row('Export this', 'file-output', 'export');
		row('History here', 'history', 'history');
	},

	// ── THE ONE WAY IN ───────────────────────────────────────────────
	//
	// The command, the menu row, the bar button, and the Export and History
	// openers all come here. A window already open is used — its tab
	// switched, a pane brought forward. None open, the pane is opened with
	// the session carrying the tab. The sheet is not a door; `modalHost()`
	// stays only as the fallback for a workspace with no leaf to give (an
	// old API, a stub), which the running app never is.
	//
	// THREE PANES: the door for a tab is a window ON that tab — a pane
	// built for it, or a window that can switch to it. None: that tab's own
	// pane is opened.
	orgDoorFor(this: WordSmith, tabId: string) {
		const doors = this.orgWindows();
		for (const d of doors) { try { if (d.tab() === tabId) return d; } catch (_) { wsCatch('orgDoorFor: d.tab()', _); } }
		for (const d of doors) { try { if (!(d.single && d.single())) return d; } catch (_) { wsCatch('orgDoorFor: d.single()', _); } }
		return null;
	},

	async orgOpenTab(this: WordSmith, tabId: string) {
		const id = tabId || 'organizer';
		const door = this.orgDoorFor(id);
		if (door) {
			try { if (door.tab() !== id && door.tabSet) door.tabSet(id); } catch (e) { wsGuardReport('switching the Organizer’s tab', e); }
			this.orgReveal(door);
			return door;
		}
		try { this._wsSession = this._wsSession || wsSessionNew(); } catch (_) { wsCatch('orgOpenTab: this._wsSession = this._wsSession || wsSessionNew();', _); }
		if (this._wsSession) this._wsSession.tab = id;
		let leaf = null;
		try { leaf = await this.openOutlinerPane(id); } catch (e) { wsGuardReport('opening the Organizer', e); leaf = null; }
		if (leaf) return leaf;
		return this.openManuscriptModal({ tab: id });
	},

	// Several rows selected in Obsidian's tree: "Export these" when two or
	// more of them are folders.
	filesMenuFor(this: WordSmith, menu: Menu, files: TAbstractFile[]) {
		// Folders and notes alike: what is chosen is what is ticked.
		const paths = (files || []).filter((f: TAbstractFile) => f && f.path && f.path !== '/').map((f: TAbstractFile) => f.path);
		if (paths.length < 2) return;
		menu.addItem((i: { setTitle: (arg0: string) => void; setIcon: (arg0: string) => void; onClick: (arg0: () => void) => void; }) => {
			i.setTitle('Export these');
			try { if (i.setIcon) i.setIcon('file-output'); } catch (_) { wsCatch('filesMenuFor: if (i.setIcon) i.setIcon(file-output);', _); }
			i.onClick(() => { void this.orgOpenAt('', 'export', { only: paths }); });
		});
	},

	// A folder chosen in Obsidian's tree. '' and '/' are the whole vault.
	orgTreeSelect(this: WordSmith, path: string) {
		const p = (path == null || path === '/') ? '' : String(path);
		let n = 0;
		for (const w of this.orgWindows()) {
			try { w.select(p); n++; }
			catch (e) { wsGuardReport('the file tree choosing a folder for the Organizer', e); }
		}
		return n;
	},

	// The note you opened. A door keeps its folder when it holds the note
	// and moves to the note's own folder when it does not.
	orgTreeFollow(this: WordSmith, path: string) {
		if (!path) return 0;
		let n = 0;
		for (const w of this.orgWindows()) {
			try { w.follow(String(path)); n++; }
			catch (e) { wsGuardReport('the Organizer following the note you opened', e); }
		}
		return n;
	},

	orgTreeHookAttach(this: WordSmith) {
		if (this._explorerClick) return;
		this._explorerClick = (ev: Event) => {
			try {
				if (!this.orgWindows().length) return;
				const t = wsElOf(ev.target);
				if (!t) return;
				if (!t.closest('.workspace-leaf-content[data-type="file-explorer"]')) return;
				// Our own tick box is not a choosing; nor is a control somebody else
				// put on the row.
				if (t.closest('.ws-treetick, input, button')) return;
				const row = t.closest('.nav-folder-title[data-path]');
				if (!row) return;
				const p = row.getAttribute('data-path');
				if (p == null) return;
				this.orgTreeSelect(p);
			} catch (e) { wsGuardReport('the file tree choosing a folder for the Organizer', e); }
		};
		document.addEventListener('click', this._explorerClick, true);
	},

	orgTreeHookDetach(this: WordSmith) {
		if (!this._explorerClick) return;
		try { document.removeEventListener('click', this._explorerClick, true); }
		catch (_) { wsCatch('orgTreeHookDetach: document.removeEventListener(click)', _); }
		this._explorerClick = null;
	},

	// ── A HOST BACKED BY A LEAF ─────────────────────────────────────────────
	//
	// The other half of the seam in `modalHost`. Same seven things,
	// answered by a pane instead of a sheet — so the window does not learn
	// a second shape.
	//
	// THREE OF THE SEVEN DIFFER, and each difference is the point:
	//
	// `key`   a modal has a `scope`; a view has none. The keys are a
	// listener on the view's OWN element, which means they only
	// fire while focus is inside it — so the Organizer's arrows
	// cannot move the cursor in a note the writer is typing in.
	// A modal never had that problem because it took the whole
	// application; a pane sits beside something live.
	//
	// `show`  nothing. The leaf is already on screen — Obsidian put it
	// there, and a pane that "opened" itself would fight the
	// workspace it lives in.
	//
	// `closes` FALSE. See the Escape ladder: its bottom rung hands the key
	// back so the modal can close. A docked pane must not vanish
	// when a writer presses Escape, so the rung stops at "nothing
	// left to back out of" and the press does nothing.
	leafHost(this: WordSmith, view: ItemView): WsHost {
		const teardowns: (() => void)[] = [];
		return {
			kind: 'leaf',
			view,
			rootEl: view.containerEl,
			contentEl: view.contentEl,
			closes: false,
			// ── A PANE IS NOT A SHEET, AND THE STYLESHEET HAS TO KNOW ────
			//
			// The root wears `ws-uni-modal` either way, because that class
			// carries everything this window LOOKS like — the bands, the
			// tabs, the panel, the heat ramp. What it also carries is the
			// SIZE of a modal: `88vw` wide and `82vh` tall, which inside a
			// leaf is a pane trying to be most of the screen regardless of
			// the space the workspace gave it.
			//
			// So a pane says so, and the two sizing rules stand down for it.
			// One extra class rather than splitting the shared look in two:
			// the size is the only thing a sheet and a pane disagree about.
			paneClass: 'ws-uni-pane',
			key: (mods: Modifier[], k: string, fn: KeymapEventListener) => {
				const want = Array.isArray(mods) ? mods : [];
				const handler = (ev: KeyboardEvent) => {
					if (ev.key !== k) return;
					// THE MODIFIERS ARE CHECKED BOTH WAYS. Matching only the ones asked
					// for lets Ctrl+ArrowDown run a plain ArrowDown binding — somebody
					// else's hotkey answered by ours — and a plain ArrowDown match the
					// Alt+ArrowDown NUDGE, so every arrow walked the cursor AND reordered
					// the book under it. A modal never had this: `modal.scope.register` is
					// Obsidian's own Scope and checks all four.
					const mod = ev.ctrlKey || ev.metaKey;
					if (mod !== (want.indexOf('Mod') !== -1)) return;
					if (ev.shiftKey !== (want.indexOf('Shift') !== -1)) return;
					if (ev.altKey !== (want.indexOf('Alt') !== -1)) return;
					if (fn(ev, { modifiers: '', key: k, vkey: k }) === false) ev.preventDefault();
				};
				view.containerEl.addEventListener('keydown', handler);
				teardowns.push(() => {
					try { view.containerEl.removeEventListener('keydown', handler); } catch (_) { wsCatch('leafHost / key: view.containerEl.removeEventListener(\'keydown\', handler);', _); }
				});
			},
			contains: (el: Node | null | undefined) => {
				try { return !!(el && view.containerEl && view.containerEl.contains(el)); }
				catch { return false; }
			},
			onClose: (fn: () => void) => { teardowns.push(fn); },
			// RUN BY THE VIEW when Obsidian takes the pane away. Everything
			// the window registered comes off, in the order it was added.
			teardown: () => { for (const t of teardowns) { try { t(); } catch (_) { wsCatch('leafHost: t();', _); } } },
			show: () => {},
			handle: () => view
		};
	},

	registerOutlinerPane(this: WordSmith) {
		if (!WsOutlinerView || this._outlinerPaneRegistered) return;
		try {
			// THREE VIEWS: Organizer, Export and History, each a pane of its own —
			// the same window built on one tab. Registered together, so a saved
			// workspace holding any of the three ids finds its view.
			for (const id of Object.keys(WS_PANE_VIEWS)) {
				const Cls = WS_PANE_CLASSES[id];
				if (Cls) this.registerView(WS_PANE_VIEWS[id], (leaf: WorkspaceLeaf) => new Cls(leaf, this));
			}
			this._outlinerPaneRegistered = true;
		} catch (_) { wsCatch('registerOutlinerPane: this.registerView(WS_OUTLINER_VIEW, (leaf) => new WsOutlinerView(leaf, …', _); }
	},

	outlinerPaneLeaves(this: WordSmith, tabId: string) {
		const type = WS_PANE_VIEWS[tabId || 'organizer'] || WS_OUTLINER_VIEW;
		try { return this.app.workspace.getLeavesOfType(type) || []; }
		catch { return []; }
	},

	// ONE PANE, REVEALED RATHER THAN STACKED. Asking twice used to be the way
	// to end up with two of a thing; a writer pressing the command again means
	// "show me the one I have".
	async openOutlinerPane(this: WordSmith, tabId?: string) {
		if (!WsOutlinerView) return null;
		const type = WS_PANE_VIEWS[tabId || 'organizer'] || WS_OUTLINER_VIEW;
		this.registerOutlinerPane();
		let leaf = this.outlinerPaneLeaves(tabId || 'organizer')[0];
		if (!leaf) {
			try {
				// THE MAIN AREA, not a sidebar. This is a working surface —
				// a tree, a band of readings and a panel — and a sidebar is
				// too narrow for it by default. A writer who wants it docked
				// can drag it there, or out into its own window, which is
				// the whole reason it is a leaf.
				// BESIDE A PANE OF OURS, AS A TAB: Export opened while an Organizer
				// pane stands should join its tab group, not carve a third vertical
				// split. With none of ours open, a split.
				const sibling = Object.keys(WS_PANE_VIEWS).map((t) => this.outlinerPaneLeaves(t)[0]).filter(Boolean)[0];
				const ws = this.app.workspace;
				if (sibling && sibling.parent && typeof ws.createLeafInParent === 'function') {
					leaf = ws.createLeafInParent(sibling.parent, (sibling.parent.children || []).length);
				} else {
					leaf = ws.getLeaf('split', 'vertical');
				}
				if (leaf) await leaf.setViewState({ type, active: true });
			} catch { return null; }
		}
		try { void this.app.workspace.revealLeaf(leaf); } catch (_) { wsCatch('openOutlinerPane: this.app.workspace.revealLeaf(leaf);', _); }
		return leaf;
	},

	// ── AND OUT INTO ITS OWN OS WINDOW ─────────────────────────────
	//
	// IT BUILDS ON THE PANE rather than beside it. `openOutlinerPane`
	// already finds-or-makes the leaf and is the one writer of what that
	// leaf is; a second path that made its own would be a second answer to
	// "where does the Organizer live".
	//
	// BOTH API NAMES ARE TRIED AND CHECKED. `moveLeafToPopout` and
	// `openPopoutLeaf` both exist on 1.13.7, but neither is in the
	// published typings, so this must survive an Obsidian that has dropped
	// one. Failing back to the PANE is the honest failure: the writer asked
	// for a window and gets the thing a window is made of, still holding
	// their work.
	async openOutlinerPopout(this: WordSmith) {
		const leaf = await this.openOutlinerPane();
		if (!leaf) return null;
		const w = this.app.workspace;
		try {
			if (typeof w.moveLeafToPopout === 'function') {
				const out = w.moveLeafToPopout(leaf);
				// It returns the popout's WorkspaceWindow on some builds and
				// nothing on others; the leaf is what the caller wants back.
				void out;
				return leaf;
			}
		} catch (_) { wsCatch('openOutlinerPopout: if (typeof w.moveLeafToPopout === \'function\')', _); }
		try {
			if (typeof w.openPopoutLeaf === 'function') {
				const pl = w.openPopoutLeaf();
				if (pl) {
					await pl.setViewState({ type: WS_OUTLINER_VIEW, active: true });
					// THE ONE WE CAME FROM GOES. Otherwise the writer has the
					// Organizer twice - which is the fault every door in this
					// window is written to avoid.
					try { if (pl !== leaf) leaf.detach(); } catch (_) { wsCatch('openOutlinerPopout: if (pl !== leaf) leaf.detach();', _); }
					return pl;
				}
			}
		} catch (_) { wsCatch('openOutlinerPopout: if (typeof w.openPopoutLeaf === \'function\')', _); }
		return leaf;
	},
};
export type OrganizerWindowMethods = typeof organizerWindowMethods;
