// Word-Smith — organizer-props.

import { Notice, setIcon, Platform } from 'obsidian';
import { wsCatch, wsElOf, wsNodeOf, wsStr } from './preamble';
import type { WsPropItem } from './preamble';
import type { WsOrgCol } from './organizer-cols';
import type WordSmith from './plugin';
import type { WordSmithSettings, WsHost } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE PROPERTIES — the panel's list, the pop-over, the field editor
// ════════════════════════════════════════════════════════════════════════
//
// THE PROPERTIES: the Properties button's list (which keys are columns,
// in what order, dragged), the pop-over that adds a property by type,
// the sub-menu, the drafts, the edit guard, and `orgFieldEditor` — the
// one editor every property cell opens, which knows what a date is, what
// a number is, what the registry says and what to do when the value at
// hand disagrees.
//
// WHAT IT READS, through `d`: the settings (`d.s`), the column table and
// its sorts (`d.COLS`, `d.SORTS`, `d.colOff`, `d.orgColFit`,
// `d.addProp`), the property doors (`d.ORG_PROP_DOORS`, `d.orgPropSet`,
// `d.orgPropListSet`), the tag pill (`d.orgTagWrap`, `d.orgTagPill`),
// the panel and its windows (`d.panel`, `d.ownerDoc`, `d.ownerWin`), the
// draw (`d.draw`, `d.drawPanel`, `d.fill`, `d.liveFiles`), and
// `d.plugin`.
//
// FOUR OF ITS `let`s ARE LIVE — `orgEditGuard`, `orgOpenAfter`,
// `orgRedrawPending`, `orgFieldEscape` — reassigned in here and read by
// the window's cells and draws; they come back as getters, and the
// window reads them as `orgProps.<name>`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgPropsMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (12 of 20).
export interface OrgPropsDeps {
	plugin: WordSmith;
	readonly COLS: WsOrgCol[];
	readonly ORG_PROP_DOORS: { label: string; icons: string[]; types: { id: string; label: string; }[]; pick: (type: string, ev2: MouseEvent) => void; open: (ev2: MouseEvent) => void; }[];
	readonly SORTS: { id: string; label: string; icon: string; }[];
	readonly addProp: (info: WsPropItem) => Promise<void>;
	readonly colOff: Set<string>;
	readonly draw: () => void;
	readonly drawPanel: () => void;
	readonly fill: () => Promise<void>;
	readonly liveFiles: () => string[];
	readonly orgColFit: () => void;
	readonly orgPropListSet: (path: string, key: string, list: unknown, before: unknown) => Promise<boolean>;
	readonly orgPropSet: (path: string, key: string, value: unknown) => Promise<boolean>;
	readonly orgTagPill: (host: HTMLElement, text: string, o: { intext?: boolean; remove?: (() => void) | null; }) => HTMLSpanElement;
	readonly orgTagWrap: (host: HTMLElement, type: string) => HTMLElement;
	readonly ownerDoc: () => Document;
	readonly ownerWin: () => typeof window;
	readonly panel: HTMLDivElement;
	readonly s: WordSmithSettings;
	readonly host: WsHost;
}

export const wsOrgPropsMake = (d: OrgPropsDeps) => {
// RANKED BY USE, NOT BY ALPHABET: an alphabetical shortlist of twelve
// comes back as nine `excalidraw-*` keys belonging to another plugin,
// and not one of the writer's own properties reaches the menu. A
// vault does not choose its neighbours' namespaces.
//
// NOT `propKeysInScope`, which ranks the same way and is right there —
// it answers a DIFFERENT question ("which key could become a COLUMN")
// and drops `tags` and anything already a column. Every one of those
// exclusions is a column rule; the drawer edits all of them.
const orgPropsByUse = () => {
	const seen = new Map<string, { label: string; n: number }>();
	for (const p2 of d.liveFiles()) {
		const f = d.plugin.app.vault.getAbstractFileByPath(p2);
		const cache = f && d.plugin.app.metadataCache
			&& d.plugin.app.metadataCache.getFileCache(f);
		const fm = cache && cache.frontmatter;
		if (!fm) continue;
		for (const k of Object.keys(fm)) {
			// Obsidian's own bookkeeping, never the writer's.
			if (k === 'position') continue;
			const low = k.toLowerCase();
			const at = seen.get(low) || { label: k, n: 0 };
			at.n += 1;
			seen.set(low, at);
		}
	}
	return Array.from(seen.values())
		.sort((a, b) => (b.n - a.n) || a.label.localeCompare(b.label))
		.map((x) => x.label);
};
// ── "IS IT OPEN" IS READ FROM THE DOM, NOT REMEMBERED ───────────
//
// A `let` holding the element is one writer too many: an orphan sweep
// can remove the node without this window hearing — and then the
// button believes a panel is open, presses shut, and appears dead. The
// node IS the state; anything else is a copy that can go stale. Still
// true with the panel inside the window: a reload orphans the whole
// window with the panel inside it, which is the same stale handle by
// another route.
const orgPropPopEl = () => {
	try { return d.ownerDoc().querySelector('.ws-org-proppop'); }
	catch { return null; }
};
let orgPropPopQuery = '';
let orgPropPopOff: (() => void) | null = null;
// WHAT THE PANEL LISTS, AND IN WHAT ORDER — one function, so the
// render and every reader of it are asking the same question.
//
// A ROW IS `{ sect, col, key, name, dead }`: the section it belongs
// to, the COLUMN it switches on (or null, for a key that has never
// been made one), the FRONTMATTER KEY it switches on (or '', for a
// reading), and whether ▤ is dead.
// ── A ROW'S ID IS THE ID ITS COLUMN HAS, OR WOULD HAVE ──────────
//
// `words` for a reading, `fm:Pov` for a property — whether or not a
// column for it exists yet. That is the SAME id space `uniColOrder`
// already ranks, so one store carries the order of this panel and the
// order of the table, and a key ranked before it was ever a column
// simply starts meaning something the moment it becomes one.
// A ROW OF THE PROPERTIES PANEL: a column of the table, or a bare key the notes carry.
interface WsPropRow { col: WsOrgCol | null; key: string; name: string; dead: boolean }
const orgPropRowId = (r: WsPropRow) => (r && r.col ? r.col.id
	: (r && r.key ? d.plugin.propColId(r.key) : ''));
const orgPropPanelRows = () => {
	const rows: WsPropRow[] = [];
	const taken = new Set();
	const addRow = (col: WsOrgCol | null, key: string, name: string) => {
		const low = String(key || '').toLowerCase();
		if (low && taken.has(low)) return;
		if (low) taken.add(low);
		rows.push({ col: col || null, key: key || '',
			name: name, dead: !key });
	};
	// THE DEFAULT ORDER is the only thing a writer who has never dragged
	// anything sees: the readings as `COLS` declares them, then the
	// columns they made, then the fields they chose, then the rest of the
	// vault COMMONEST FIRST — by use and not by alphabet, because an
	// alphabetical list of a vault's 51 keys opens on nine `excalidraw-*`
	// rows and not one of the writer's own.
	for (const c of d.COLS) {
		if (c.user) continue;
		// `tags` IS THE ONE READING THAT IS ALSO A REAL KEY.
		addRow(c, (c.id === 'tags' ? 'tags' : ''), c.label);
	}
	for (const c of d.COLS) { if (c.user) addRow(c, c.key || '', c.label); }
	for (const k of orgPropsByUse()) addRow(null, k, String(k));
	for (const k of d.plugin.orgKnownProps()) addRow(null, k, String(k));
	// ── AND THEN THE WRITER'S OWN ORDER OVER THE TOP ───────────
	//
	// APPLIED AS A RANKING, not used as the list: a column added in a
	// later version is in no saved order, and a saved order used
	// directly would silently drop it. Ones it does not name keep
	// their place in the default order above, behind the ones it does.
	// This is `colRank`'s rule, applied to a longer list — the table
	// and the panel are sorting the same ids by the same store.
	const saved = Array.isArray(d.s.uniColOrder) ? d.s.uniColOrder : [];
	const at = new Map<string, number>();
	saved.forEach((id, i) => { if (!at.has(id)) at.set(id, i); });
	const rank = (x: { r?: WsPropRow; n: number; id: string }) => { const r = at.get(x.id); return r !== undefined ? r : saved.length + x.n; };
	const ordered = rows
		.map((r, n) => ({ r: r, n: n, id: orgPropRowId(r) }))
		.sort((a, b) => (rank(a) - rank(b)) || (a.n - b.n))
		.map((x) => x.r);
	// THE TICKED ONES FIRST: the rows that are columns on screen, in the
	// order above, then the rest in theirs. A tick moves the row up on the
	// render that follows the click.
	const shown = (r: WsPropRow) => !!(r.col && !d.colOff.has(r.col.id));
	return ordered.filter(shown).concat(ordered.filter((r) => !shown(r)));
};
// ── AND A DRAG REWRITES IT, BOTH HALVES (brief C3) ──────────────
//
// "The drag order drives column order AND chip order." Two stores,
// one gesture, and the second is DERIVED from the first rather than
// dragged separately: `organizerOutlineProps` keeps saying WHICH
// properties are chosen (ticking still appends, as it has since 302)
// and takes its ORDER from the panel, so the chips under a card and
// the columns across a row cannot disagree about what comes first.
//
// A DROP TAKES THE TARGET'S PLACE rather than swapping with it. The
// band's grammar since it had columns: dragging the last row to the
// front should leave everything else in the order it was in, and a
// swap moves two things when a writer moved one.
let orgPropDragId: string | null = null;
const orgPropMoveTo = async (moved: string, target: string) => {
	const here = orgPropPanelRows();
	const ids = here.map(orgPropRowId).filter(Boolean);
	const from = ids.indexOf(moved);
	if (from !== -1) ids.splice(from, 1);
	const to = ids.indexOf(target);
	ids.splice(to === -1 ? ids.length : to, 0, moved);
	// ── WHAT GETS WRITTEN DOWN, AND WHAT KEEPS ITS DEFAULT ──────
	//
	// The panel draws every key the vault carries, most of them another
	// plugin's (`excalidraw-*`, `TQ_*`); writing the whole list would put
	// them all into `data.json` on the first drag — an order the writer
	// never expressed, over rows they have never looked at, permanently
	// ranked ahead of anything added later. SO THE STORE HOLDS WHAT THE
	// WRITER HAS A VIEW ABOUT: a column that exists, a property they have
	// chosen as a field, and the row they just moved. Everything else
	// keeps its DEFAULT rank, which is `orgPropPanelRows`'s own order —
	// commonest first — and sorts after the ranked ones exactly as
	// `colRank` has always done it.
	const mattersId = new Set();
	for (const r of here) {
		const rid = orgPropRowId(r);
		if (!rid) continue;
		// A ROW MATTERS IF IT IS A COLUMN. It also mattered if the key
		// was in the outline's chosen set; there is no such set, and a
		// column is the only thing a row can now be.
		if (r.col) mattersId.add(rid);
	}
	mattersId.add(moved);
	const keep = ids.filter((id) => mattersId.has(id));
	// …then anything the store already ranked that the panel does not
	// draw — a column removed from the vault's keys still has a rank,
	// and dropping it here would silently reorder it if it came back.
	const rest = (Array.isArray(d.s.uniColOrder) ? d.s.uniColOrder : [])
		.filter((id) => keep.indexOf(id) === -1 && ids.indexOf(id) === -1);
	d.s.uniColOrder = keep.concat(rest);
	await d.plugin.saveSettings();
	d.draw(); void d.fill(); d.drawPanel();
	orgPropPopRender();
};
// THE TYPE BADGE COMES FROM OBSIDIAN'S OWN REGISTRY and from nowhere
// else. A READING HAS NO ENTRY THERE — it is counted, not declared — so
// it wears no badge and no icon rather than a guess. Hand-typing a type
// per built-in column would be a second writer of a fact this plugin
// does not own.
const orgPropKindOf = (r: { key: string }) => {
	if (!r.key) return '';
	try { return String(d.plugin.orgPropType(r.key) || ''); }
	catch { return ''; }
};
// ── AND A COLUMN TURNED ON IS BROUGHT INTO VIEW ────────────────────
//
// A new column lands PAST THE RIGHT EDGE of a pane narrower than its
// table; the pane scrolls, so the column is there, but nothing tells
// the eye — and A CONTROL THAT WORKS AND SHOWS NOTHING READS AS BROKEN
// ("unclickable" and "off screen" are the same thing from the writer's
// side). SCROLLED ONLY WHEN TURNING ON, and only when the header really
// is out of sight: scrolling on the way OFF would move the pane away
// from what the writer was looking at, and scrolling to something
// already visible is a jump for nothing.
const orgRevealCol = (id: string) => {
	try {
		const scroller = d.panel.querySelector('.ws-org-panel');
		const th = d.panel.querySelector('thead th[data-col="' + id + '"]');
		if (!scroller || !th) return;
		const hr = scroller.getBoundingClientRect();
		const tr = th.getBoundingClientRect();
		if (tr.right <= hr.right && tr.left >= hr.left) return;
		scroller.scrollLeft += (tr.right - hr.right) + 12;
	} catch (_) { wsCatch('openManuscriptModal / orgRevealCol: const host = panel.querySelector(\'.ws-org-panel\');', _); }
};
const orgPropColToggle = async (r: { col: { id: string } | null; key: string }) => {
	if (r.col) {
		const turningOn = d.colOff.has(r.col.id);
		if (d.colOff.has(r.col.id)) d.colOff.delete(r.col.id);
		else d.colOff.add(r.col.id);
		d.s.uniColsOff = Array.from<string>(d.colOff);
		await d.plugin.saveSettings();
		// The name column is `1fr` and takes whatever the columns
		// give back; and the FIGURES are gathered lazily, so a column
		// switched on draws empty until something asks for them —
		// reported as "they don't display immediately after clicking
		// word counts", which is exactly what it was.
			d.draw(); void d.fill(); d.drawPanel();
		// AFTER THE REDRAW, because the header does not exist until
		// `drawPanel` has built it and a scroll aimed at nothing does
		// nothing.
		if (turningOn) orgRevealCol(r.col.id);
	} else {
		// A KEY THAT IS NOT A COLUMN YET BECOMES ONE. This is the
		// whole of point 5 above: the panel lists the vault, so ▦ on
		// a listed key has to be able to make the column it promises.
		// `addProp` is the one writer of `uniUserCols` and redraws
		// everything derived from it.
		await d.addProp({ key: String(r.key).toLowerCase(), label: r.key });
	}
	orgPropPopRender();
};
// ── THE TYPE SUBMENU ──────────────────────────────────────────────
//
// OURS, NOT OBSIDIAN'S. This panel is a div wearing the `menu` costume,
// not a `Menu`, so `setSubmenu` has nothing to hang off even on a build
// that has it. The flyout is a second div in the same costume. AND IT
// IS BUILT WHERE THE PANEL IS: a node outside the modal is an escape as
// far as Obsidian's focus trap is concerned, and the caret is taken off
// it. READ FROM THE DOM, like the panel: the node IS the state.
const orgPropSubEl = () => {
	try { return d.ownerDoc().querySelector('.ws-org-propsub'); }
	catch { return null; }
};
const orgPropSubClose = () => {
	try {
		const d0 = d.ownerDoc();
		for (const n of Array.from<HTMLElement>(
			d0.querySelectorAll('.ws-org-propsub'))) n.remove();
	} catch (_) { wsCatch('openManuscriptModal / orgPropSubClose: const d0 = ownerDoc();', _); }
};
const orgPropPopClose = () => {
	// THE SUBMENU GOES FIRST AND ALWAYS. It is a sibling, not a
	// child, so removing the panel would leave it standing over an
	// empty space with handlers that still fire.
	orgPropSubClose();
	if (orgPropPopOff) {
		try { orgPropPopOff(); } catch (_) { wsCatch('openManuscriptModal / orgPropPopClose: orgPropPopOff();', _); }
		orgPropPopOff = null;
	}
	// EVERY ONE IN THE DOCUMENT, not only the node this window remembers.
	// The panel is a child of this window's own root, so closing takes it —
	// but a panel left by a PREVIOUS build or by an orphaned window is
	// still in the document, and this is the sweep that finds it. A query
	// that narrowed to `host.rootEl` would stop finding exactly the ones
	// nothing else will.
	try {
		const d0 = d.ownerDoc();
		const old = Array.from<HTMLElement>(d0.querySelectorAll('.ws-org-proppop'));
		for (const n of old) n.remove();
	} catch (_) { wsCatch('openManuscriptModal / orgPropPopClose: const d0 = ownerDoc();', _); }
};
const orgPropPopRender = () => {
	const pop = orgPropPopEl();
	if (!pop) return;
	const box = pop.querySelector('.ws-org-propbody');
	if (!box) return;
	box.empty();
	const q = orgPropPopQuery.trim().toLowerCase();
	const rows = orgPropPanelRows()
		.filter(r => !q || r.name.toLowerCase().indexOf(q) !== -1);
	// ONE TOGGLE, DRAWN THE SAME WAY TWICE. A dead one keeps its box
	// and its width and loses only its handler, so the column of
	// ticks stays a column.
	const tog = (into: HTMLElement, on: boolean, dead: boolean, title: string, fn: () => Promise<void>) => {
		// THE STATE CLASSES ARE WHOLE LITERALS, not `'is-' + kind`.
		// `ws-dev/selectors.js` greps main.js as TEXT, so a class
		// assembled from a prefix and a variable names nothing it can
		// find — the self-check went red on `is-fld` the first time
		// this was built, which is the check doing its job.
		const t = into.createSpan({ cls: 'ws-org-ptog is-col'
			+ (on ? ' is-on' : '') + (dead ? ' is-dead' : '') });
		// Drawn as a box by the stylesheet rather than by a glyph in the
		// markup: a character a font does not carry renders as tofu.
		t.createSpan({ cls: 'ws-org-pbox' });
		t.title = title;
		if (dead) { t.setAttribute('aria-disabled', 'true'); return t; }
		t.setAttribute('role', 'checkbox');
		t.setAttribute('aria-checked', on ? 'true' : 'false');
		t.addEventListener('click', (ev: Event) => {
			ev.preventDefault();
			ev.stopPropagation();
			void fn();
		});
		return t;
	};
	let drew = 0;
	const clearAim = () => {
		for (const el2 of Array.from<HTMLElement>(box.querySelectorAll('.ws-drop-above'))) {
			el2.removeClass('ws-drop-above');
		}
	};
	for (const r of rows) {
		const row = box.createDiv({ cls: 'ws-org-prow' });
		const rid = orgPropRowId(r);
		if (rid) row.setAttribute('data-id', rid);
		if (r.col) row.setAttribute('data-col', r.col.id);
		if (r.key) row.setAttribute('data-key', r.key);
		// ── THE GRIP, AND IT IS NOT DECORATION ─────────────────
		//
		// SEARCHING TURNS IT OFF. A drop while the list is filtered would
		// write an order over rows the writer cannot see — the fold-as-filter
		// fault, one control along.
		const grip = row.createSpan({ cls: 'ws-org-pgrip' });
		// A LUCIDE GRIP, NOT THE MOCK'S ⠿. The mock simulates Obsidian
		// in a browser with whatever font it likes; this vault reads in
		// Roboto Mono, and a braille glyph a font does not carry renders
		// as tofu. Names tried in order and CHECKED, because `setIcon`
		// fails silently on one this build's Lucide has dropped.
		for (const n2 of ['grip-vertical', 'grip', 'more-vertical']) {
			grip.textContent = '';
			try { if (setIcon) setIcon(grip, n2); } catch (_) { wsCatch('openManuscriptModal / orgPropPopRender: if (setIcon) setIcon(grip, n2);', _); }
			if (grip.childElementCount > 0) { grip.dataset.icon = n2; break; }
		}
		if (!q && rid) {
			grip.addClass('is-propdrag');
			grip.title = 'Drag to reorder — this is the column order '
				+ 'and the chip order';
			row.setAttribute('draggable', 'true');
			row.addEventListener('dragstart', (ev: DragEvent) => {
				orgPropDragId = rid;
				try { if (ev.dataTransfer) ev.dataTransfer.setData('text/plain', rid); } catch (_) { wsCatch('openManuscriptModal / orgPropPopRender: ev.dataTransfer.setData(\'text/plain\', rid);', _); }
			});
			row.addEventListener('dragover', (ev: Event) => {
				if (!orgPropDragId || orgPropDragId === rid) return;
				ev.preventDefault();
				clearAim();
				row.addClass('ws-drop-above');
			});
			row.addEventListener('drop', (ev: Event) => {
				ev.preventDefault();
				const moved = orgPropDragId;
				orgPropDragId = null;
				clearAim();
				if (!moved || moved === rid) return;
				void orgPropMoveTo(moved, rid);
			});
			row.addEventListener('dragend', () => {
				orgPropDragId = null;
				clearAim();
			});
		}
		const colOn = !!(r.col && !d.colOff.has(r.col.id));
		tog(row, colOn, false,
			r.col ? 'Show as a column in Table'
				: 'Add “' + r.name + '” as a column',
			() => orgPropColToggle(r));
		const nm = row.createSpan({ cls: 'ws-org-pname' });
		// ── AND A READING WEARS ITS OWN GLYPH TOO ────────────────────────
		//
		// A vault property's glyph is chosen from its TYPE, and a reading has
		// no type to read — but nobody has to guess: every reading was given
		// a glyph by hand in `BUILTIN_SORTS`, and the Sort menu draws them.
		// SO IT IS THE SAME LOOKUP AT A SECOND SURFACE, not a second table:
		// `BUILTIN_SORTS` stays the one writer of what a reading looks like,
		// and a column added tomorrow gets its glyph in both places or in
		// neither. GUARDED, because `SORTS` is declared further down than
		// this line is written: it is initialised long before the panel can
		// be opened, but a `let` read before its declaration throws rather
		// than returning undefined, and an empty slot is a better outcome
		// than a panel that does not draw.
		const ic = nm.createSpan({ cls: 'ws-org-piconslot' });
		if (r.key) orgPropIcon(ic, r.key);
		else if (r.col) {
			try {
				const cid = r.col.id;
				const def = d.SORTS.filter((sd) => sd.id === cid)[0];
				if (def && def.icon && setIcon) {
					setIcon(ic, def.icon);
					if (ic.childElementCount > 0) ic.dataset.icon = def.icon;
				}
			} catch (_) { wsCatch('openManuscriptModal / orgPropPopRender: const def = SORTS.filter((sd) => sd.id === r.col.id)[0];', _); }
		}
		nm.createSpan({ cls: 'ws-org-pnametext', text: r.name });
		row.createSpan({ cls: 'ws-org-pkind', text: orgPropKindOf(r) });
		// ── AND THE DELETE, WHICH LIVES HERE ───────────────────────
		//
		// This is the panel that exists to answer "which properties do I
		// have" — the one place a writer looks to manage them — so removing
		// one is here and not only on a context menu. THE CHIP'S OWN MARK:
		// `.ws-org-chipx` is the × on a lens chip and means exactly this,
		// take this one away. THE SLOT IS ALWAYS DRAWN, EMPTY WHERE IT CANNOT
		// ACT: only a property the writer ADDED can be removed — a reading
		// declared in `COLS` has nothing to delete, and a vault property that
		// is not a column yet was never added — and drawing the cell either
		// way keeps the grid's cells aligned (a missing fourth cell puts 8px
		// between the two). WHAT IS LOST, AND IT IS REAL: nothing prunes
		// `uniUserCols`, so a key added once is offered for ever, and the
		// chosen TYPE lives on that entry; if the list grows unwieldy the
		// answer is one prune in the settings tab, away from the table.
		const del = row.createSpan({ cls: 'ws-org-pdel is-dead' });
		void del;
		drew++;
	}
	if (!drew) {
		box.createDiv({ cls: 'ws-org-propnone',
			text: 'No property of that name' });
	}
};
// TOGGLES, LIKE THE PANEL'S OWN DOOR. A second press on the same row
// shuts it — without this the row looks dead, because closing and
// reopening draws the identical list in the identical place.
//
// ── A VIEWPORT POINT, IN THE COORDINATES THE FLYOUT IS PLACED IN ──
//
// The flyouts are drawn inside the host (so the modal's focus trap
// counts them as inside the window), and a `left`/`top` measured in
// the viewport is written into the frame of the offset parent. A
// MODAL's root starts at the viewport origin, where the two frames
// agree; a PANE's root starts wherever the leaf is, so the panel would
// paint a hand's width to the right of its button. ONE CONVERTER FOR
// BOTH FLYOUTS, because the panel and its type submenu place
// themselves the same way.
const orgPopBase = (el: HTMLElement) => {
	try {
		const par = el && el.offsetParent;
		if (!par || !par.getBoundingClientRect) return { left: 0, top: 0 };
		const b = par.getBoundingClientRect();
		return { left: b.left || 0, top: b.top || 0 };
	} catch (_) { wsCatch('openManuscriptModal / orgPopBase: const par = el && el.offsetParent;', _); return { left: 0, top: 0 }; }
};
const orgPropSubOpen = (anchor: HTMLElement, door: { label?: string; icons?: string[]; types: { id: string; label: string }[]; pick: (type: string, ev2: MouseEvent) => void; open?: (ev2: MouseEvent) => void }) => {
	const was = !!orgPropSubEl();
	orgPropSubClose();
	if (was) return null;
	const d0 = d.ownerDoc();
	const sub = (d.host.rootEl || d0.body)
		.createDiv({ cls: 'menu ws-org-propsub' });
	for (const t of (door.types || [])) {
		const row = sub.createDiv({ cls: 'ws-org-propsubrow' });
		row.createSpan({ text: t.label });
		row.dataset.type = t.id;
		row.addEventListener('click', (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			orgPropSubClose();
			try { door.pick(t.id, ev); } catch (_) { wsCatch('openManuscriptModal / orgPropSubOpen: door.pick(t.id, ev);', _); }
		});
	}
	// ── BESIDE THE ROW, AND FLIPPED WHEN THERE IS NO ROOM ───────
	//
	// The same idiom as the panel, and the same reason for the `try`:
	// `getBoundingClientRect` is all zeros under a bare DOM, which lands
	// this at the origin and changes nothing any assertion reads.
	// TOP-ALIGNED WITH THE ROW, not below it — a submenu that drops
	// downward from the last row of a panel goes off the foot of the
	// window.
	//
	// A SHEET ON A PHONE, LIKE THE PANEL IT HANGS OFF. This wears `menu`,
	// so app.css draws it at the foot of the screen with `top: unset
	// !important`; a placed `left` would only fight the sheet's insets.
	// The stylesheet sets its `bottom` to the bar's measured height, as
	// the panel's is.
	if (typeof Platform !== 'undefined' && Platform && Platform.isPhone) return sub;
	try {
		// OFF THE PANEL'S EDGE, NOT THE ROW'S. Measured in the vault:
		// anchored to the row, the flyout started 9px INSIDE the panel
		// and overlapped its border, because the row sits inside 8px of
		// panel padding and 6px of its own. The ROW still gives the
		// height — a submenu lines up with the thing that opened it.
		const r = anchor.getBoundingClientRect();
		const box = (orgPropPopEl() || anchor).getBoundingClientRect();
		const w0 = d.ownerWin();
		const wide = sub.offsetWidth || 0;
		const tall = sub.offsetHeight || 0;
		const vw = w0.innerWidth || 0;
		const vh = w0.innerHeight || 0;
		let x = box.right;
		if (vw && x + wide > vw) x = Math.max(0, box.left - wide);
		let y = r.top;
		if (vh && y + tall > vh) y = Math.max(0, vh - tall);
		// INTO THE FRAME IT IS PLACED IN. The reads above are all
		// viewport rects, and the flyout is positioned inside the host.
		const base = orgPopBase(sub);
		sub.style.left = Math.round(x - base.left) + 'px';
		sub.style.top = Math.round(y - base.top) + 'px';
	} catch (_) { wsCatch('openManuscriptModal / orgPropSubOpen: const r = anchor.getBoundingClientRect();', _); }
	return sub;
};
const orgPropPopOpen = (anchor: HTMLElement) => {
	orgPropPopClose();
	const d0 = d.ownerDoc();
	// ── IN THE WINDOW, NOT ON THE BODY ──────────────────────────────
	//
	// A node outside the modal is an escape as far as Obsidian's focus
	// trap is concerned: a search box appended to `body` while this window
	// is open takes focus and loses it to the first `.ws-uni-tab` within
	// the tick; appended to `rootEl` it keeps it. AND THE WINDOW'S
	// `overflow: hidden` CANNOT CLIP IT: the panel is `position: fixed`,
	// and `.ws-uni-modal` sets no transform, filter, perspective or
	// containment, so it is not a containing block for a fixed child (a
	// panel driven 176px below the modal's bottom edge is identical and
	// hit-testable from either parent). THE BODY IS STILL THE FALLBACK,
	// for a host that has no root — a panel drawn nowhere is worse than a
	// panel that cannot be typed in.
	const pop = (d.host.rootEl || d0.body)
		.createDiv({ cls: 'menu ws-org-proppop' });
	const srch = pop.createEl('input', { cls: 'ws-org-propsearch' });
	srch.type = 'text';
	srch.placeholder = 'Search properties…';
	srch.value = orgPropPopQuery;
	srch.addEventListener('input', () => {
		orgPropPopQuery = srch.value || '';
		orgPropPopRender();
	});
	pop.createDiv({ cls: 'ws-org-propbody' });
	// ── AND ONE SWITCH FOR HOW WIDE THEY ALL ARE ───────────────
	//
	// It sits at the foot with the add door because it is the only
	// other control here that is about the SET rather than about a
	// property — every row above answers "is this a column", and
	// these two answer questions about the table.
	{
		const au = pop.createDiv({ cls: 'ws-org-propauto' });
		const g = au.createSpan({ cls: 'ws-org-propautoicon' });
		for (const n of ['move-horizontal', 'unfold-horizontal', 'maximize-2']) {
			g.textContent = '';
			try { if (setIcon) setIcon(g, n); } catch (_) { wsCatch('openManuscriptModal / orgPropPopOpen: if (setIcon) setIcon(g, n);', _); }
			if (g.childElementCount > 0) { g.dataset.icon = n; break; }
		}
		au.createSpan({ text: 'Resize columns to fit' });
		au.title = 'Set every column to the width of what it holds, '
			+ 'up to six tenths of the pane. They stay draggable afterwards.';
		// A BUTTON, NOT A SWITCH: play with the column sizes, then click resize
		// columns and just that.
		au.addEventListener('click', (ev: Event) => {
			ev.preventDefault();
			ev.stopPropagation();
			d.orgColFit();
		});
	}
	// ── THE ADD DOORS, AND THEY ARE THE SAME TWO ─────────────────
	//
	// BUILT FROM A LIST so the header menu below can offer the same two
	// from the same names: a hand-typed second copy is how a door gets
	// added in one place and forgotten in the other.
	for (const door of d.ORG_PROP_DOORS) {
		const add = pop.createDiv({ cls: 'ws-org-propadd' });
		{
			const g = add.createSpan({ cls: 'ws-org-propaddicon' });
			for (const n of door.icons) {
				g.textContent = '';
				try { if (setIcon) setIcon(g, n); } catch (_) { wsCatch('openManuscriptModal / orgPropPopOpen: if (setIcon) setIcon(g, n);', _); }
				if (g.childElementCount > 0) { g.dataset.icon = n; break; }
			}
		}
		// THE LABEL IS NAMED: the chevron made it the second span after the
		// icon, and `row.textContent` would answer 'Add a new property›'
		// to a check about the label. A reader that has to strip decoration
		// off a string is one decoration away from being wrong again.
		add.createSpan({ cls: 'ws-org-propaddname', text: door.label });
		// ── THE CHEVRON IS THE DOOR ONTO THE TYPES ─────────────
		//
		// Drawn only on the door that HAS a submenu: a chevron on the row
		// that opens a modal would promise a list that never comes.
		if (door.types) {
			add.addClass('has-sub');
			add.createSpan({ cls: 'ws-org-propmore',
				text: '\u203a' });
		}
		add.addEventListener('click', (ev: MouseEvent) => {
			// The panel stays open on either door; the naming modal opens over it
			// and the panel is still there afterwards.
			ev.preventDefault();
			ev.stopPropagation();
			if (door.types) { orgPropSubOpen(add, door); return; }
			// A DOOR WITHOUT TYPES TAKES THE SUBMENU WITH IT. Two
			// flyouts open at once over one panel is a stack the
			// writer never asked for.
			orgPropSubClose();
			door.open(ev);
		});
	}
	orgPropPopRender();
	// UNDER THE BUTTON, and pulled back inside the frame when there is
	// not room to its right. `getBoundingClientRect` is all zeros under a
	// bare DOM, which lands the panel at the origin and changes nothing
	// any assertion reads.
	//
	// ON A PHONE IT IS A SHEET, AND NOT PLACED AT ALL. This element wears
	// Obsidian's `menu` class, and app.css makes every `.is-phone .menu` a
	// full-width sheet at the foot of the screen — `left` and `right` at
	// the safe-area insets, `top: unset !important`; an inline `left` would
	// beat the stylesheet's and run the sheet off the glass. The Sort and
	// Filter menus are real Obsidian menus and open as sheets there; this
	// one does the same. THE PHONE SKIPS THE PLACEMENT, NOT THE CLOSE: the
	// outside listener below is wired whatever the platform; only the
	// placing is the desktop's.
	const phoneSheet = !!(typeof Platform !== 'undefined' && Platform && Platform.isPhone);
	if (!phoneSheet) try {
		const r = anchor.getBoundingClientRect();
		const w0 = d.ownerWin();
		const wide = pop.offsetWidth || 0;
		const room = (w0.innerWidth || 0) - wide;
		// INTO THE FRAME IT IS PLACED IN: the clamp is done in VIEWPORT space,
		// where the room was measured, and the result is converted once, at
		// the end.
		const base = orgPopBase(pop);
		const x = Math.max(0, room > 0 ? Math.min(r.left, room) : r.left);
		pop.style.left = Math.round(x - base.left) + 'px';
		// TWO PIXELS UNDER THE BUTTON, LIKE THE MENUS BESIDE IT: Obsidian's
		// own positioner writes `top = y + 2` for every menu it places, so Sort
		// and Filter would sit 2px lower than this one. Same number, one row.
		pop.style.top = Math.round(r.bottom - base.top) + 2 + 'px';
	} catch (_) { wsCatch('openManuscriptModal / orgPropPopOpen: const r = anchor.getBoundingClientRect();', _); }
	// ── DISMISS: ESCAPE, AND A CLICK ANYWHERE ELSE ──────────────
	//
	// ON THE WINDOW, IN CAPTURE, for the reason the Escape ladder
	// gives: capture from the top is the only phase that cannot be
	// beaten by a listener registered earlier. And on `ownerWin`,
	// not the global — a popout's clicks happen in the popout.
	//
	// THE BUTTON IS NOT AN OUTSIDE CLICK. It toggles, so letting the
	// dismiss run first would close the panel and let the button
	// reopen it — a press that appears to do nothing.
	const onDown = (ev: Event) => {
		const hit = wsNodeOf(ev.target);
		try {
			if (pop.contains(hit)) return;
			// THE SUBMENU IS NOT AN OUTSIDE CLICK. It is a SIBLING of the panel,
			// not a child, so `pop.contains` says no to it — and picking a type
			// would shut the panel.
			const sub0 = orgPropSubEl();
			if (sub0 && sub0.contains(hit)) return;
			const t = wsElOf(ev.target) || (hit && hit.parentElement);
			if (t && t.closest('.ws-org-colsbtn')) return;
		} catch (_) { wsCatch('openManuscriptModal / onDown: if (pop.contains(ev.target)) return;', _); }
		orgPropPopClose();
	};
	// ── ESCAPE IS THE LADDER'S, AND ONLY THE LADDER'S ───────────
	//
	// The panel is not inside `host`, so the window's ladder is told about
	// it (see `onEscape`): the panel is its topmost rung, and one place
	// decides what Escape means in this window. A second listener here
	// once raced it and closed the whole window.
	try {
		const w0 = d.ownerWin();
		// POINTERDOWN, NOT MOUSEDOWN: a tap on the phone raises no compatibility
		// mousedown where a touch handler has claimed the touch, and the pane's
		// own have; a pointerdown comes for every finger.
		w0.addEventListener('pointerdown', onDown, true);
		orgPropPopOff = () => {
			try { w0.removeEventListener('pointerdown', onDown, true); } catch (_) { wsCatch('openManuscriptModal / orgPropPopOpen: w0.removeEventListener(\'mousedown\', onDown, true);', _); }
		};
	} catch (_) { wsCatch('openManuscriptModal / orgPropPopOpen: const w0 = ownerWin();', _); }
	return pop;
};

// ── THE EDIT-GUARD (spec: a focused row never redraws) ──────────────
//
// While any field editor holds focus, drawOrg DEFERS: the pane is
// not rebuilt, so the editor element — and the writer's cursor,
// selection and half-typed sentence — survive every index event,
// order change and lens ring that lands mid-edit. The deferred
// redraw runs the moment the edit ends. This is the last arrow of
// view → writer → vault → event → index → view, held until the
// writer looks up.
let orgEditGuard: { path: string; key: string } | null = null;      // truthy while an editor holds focus
// ── ONE CELL IS OPEN AT A TIME ───────────────────────────────────
//
// An opened editor DOES NOT FOCUS ITSELF — `engage` arms the guard on
// the element's own `focus` event and nothing calls `.focus()` — so
// clicking a cell opens a box that never receives focus, never blurs,
// and is never taken away; a plus left behind on `.ws-org-chipval` IS
// an editor left behind in a cell nobody is writing in. `orgEditDone`
// cannot help either: it returns early unless a redraw was already
// owed. SO IT IS FIXED WHERE THE SECOND ONE IS BORN: opening an editor
// asks whether another is open and, if so, rebuilds the pane first —
// `drawOrg` is the ONE writer of a cell's contents, so nothing here
// has to know how to un-draw one. `orgOpenAfter` carries the cell to
// re-open across that redraw, because the `td` it was clicked on does
// not survive it.
let orgOpenAfter: { path: string; id: string; key: string } | null = null;      // to re-open after a redraw
const orgOtherEditorOpen = (td: HTMLElement) => {
	try {
		return Array.from(d.panel.querySelectorAll('.ws-org-editor'))
			.some((e) => !td.contains(e));
	} catch { return false; }
};
let orgRedrawPending = false;
let orgFieldEscape: (() => void) | null = null;    // the focused editor's own Escape, for the ladder
const orgEditDone = () => {
	orgEditGuard = null;
	orgFieldEscape = null;
	if (!orgRedrawPending) return;
	// ── THE CARET MAY BE LANDING IN THE NEXT FIELD ───────────────────
	//
	// `blur` fires BEFORE the incoming `focus`, so a redraw run here would
	// tear out the field the caret is moving INTO, half a tick before it
	// gets there — both fields out of the document, focus on `body`. ONE
	// TICK IS ENOUGH TO TELL THE TWO APART: `orgEditGuard` is armed by an
	// editor's own `focus` handler, and focus follows blur in the same
	// task, so by the time this timeout runs the guard says whether the
	// writer moved to another field or left the fields altogether. AND
	// `orgRedrawPending` IS NOT CLEARED on the way out: if the caret did
	// land in another editor, the redraw is still owed and runs when THAT
	// edit ends. Clearing it here would drop the index event that queued
	// it — the pane would go stale instead of flickering, which is worse
	// and quieter.
	window.setTimeout(() => {
		if (orgEditGuard) return;
		if (!orgRedrawPending) return;
		orgRedrawPending = false;
		d.drawPanel();
	}, 0);
};

// ── ONE FIELD, TYPED FROM THE REGISTRY ──────────────────────────────
//
// input / growing textarea / chips with vault autocomplete / toggle
// / number / date — decided by `orgPropType` (metadataTypeManager,
// feature-detected) and the value at hand. Flat values only: a
// nested object is read-only here and edited in the note. Commit on
// blur and Enter; Shift+Enter is a newline in the textarea; Escape
// restores and backs out. Every write goes through the ONE
// frontmatter writer, `orgPropWrite`.
// ── WHAT THIS NOTE ACTUALLY HAS — ONE READER ─────────────────
//
// Frontmatter keys are the writer's capitals and the index keeps them,
// so every lookup is case-insensitive; two loops over `entry.props`
// that disagreed about case would show a property in one place and
// hide it in the other. AND THE STORE IS ASKED TOO: the org index is
// built from `getMarkdownFiles`, so a PDF has no entry there, and an
// editor seeded from the index alone opens EMPTY over a cell that is
// showing a stored value — the next keystroke replaces it. There are
// three readers of a property — the column (`orgColRaw`), the property
// lookup (`propRaw`) and this one — and a fallback wired into two of
// three is a value that displays and cannot be edited.
const orgPropValue = (path: string, key: string) => {
	const entry = d.plugin._orgIndex && d.plugin._orgIndex.get(path);
	if (entry && entry.props) {
		for (const k of Object.keys(entry.props)) {
			if (k.toLowerCase() === String(key).toLowerCase()) {
				return entry.props[k];
			}
		}
		return null;
	}
	const sv = d.plugin.propStoreGetSync(String(path || ''), key);
	return sv === undefined ? null : sv;
};
// ONE EDITOR, ONE CALLER, AND NO SWITCH. A growing textarea is right in
// a card and wrong in a 24px cell, where the row would change height as
// a writer types; with one caller the argument could not vary, and a
// knob with one setting is a knob somebody turns.
const orgFieldEditor = (card: HTMLElement, path: string, key: string, isDraft: boolean) => {
	// ── THE HOST WAS EMPTIED TO HOLD THIS, SO A REPAINT IS OWED ──────
	//
	// `orgEditDone` redraws only if a repaint was already held back, and a
	// click that changes nothing holds none back — so a chips box would
	// stay in the cell after the blur, at the height of two lines, with
	// its add-box still in it. ASKING AT BIRTH RATHER THAN AT EACH
	// TEARDOWN: there are four ways out of here — checkbox blur, chips
	// blur, scalar commit, scalar Escape — and one line here covers all
	// four and cannot be forgotten by a fifth. It is safe to set this
	// early: `orgEditDone` consumes it a tick later and only when no other
	// editor has taken focus, so moving between two fields still defers
	// the redraw to the last one.
	orgRedrawPending = true;
	// ── AND THE HOST SAYS IT IS HOLDING ONE ─────────────────────────
	//
	// An `<input>` takes its `size` in characters and does not grow to
	// its box, so an empty value asks for the floor of six and sits as a
	// small grey box in the middle of a wider cell. A CLASS RATHER THAN
	// `:has()`: the stylesheet needs to know that THIS cell is being
	// written in — to drop its padding, so the field reaches the edges —
	// and `td:has(> .ws-org-editor)` would say it too, but the cascade
	// check cannot read a `:has()` selector, so the rule would be
	// unguarded. NOTHING TAKES IT OFF, and nothing needs to: every way out
	// of an editor repaints the panel (the line above), and the repaint
	// builds the cell again from nothing.
	try { card.addClass('is-editing'); } catch (_) { wsCatch('openManuscriptModal / orgFieldEditor: card.addClass(\'is-editing\');', _); }
	const v = orgPropValue(path, key);
	const complex = (v !== null && typeof v === 'object' && !Array.isArray(v))
		|| (Array.isArray(v) && v.some(x => x !== null && typeof x === 'object'));
	if (complex) {
		card.createDiv({ cls: 'ws-org-editor is-complex',
			text: 'complex value — edit in note' });
		return null;
	}
	// The registry first, the VALUE AT HAND second: Obsidian's type
	// registry lags a fresh property and answers nothing for one it has
	// not met — but a value that IS a number, a boolean or a date already
	// says what widget it wants (`num: 3` draws a text box for the 900ms
	// the registry takes to learn it).
	let type = d.plugin.orgPropType(key);
	if (!type && v !== null) {
		if (typeof v === 'number') type = 'number';
		else if (typeof v === 'boolean') type = 'checkbox';
		else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(wsStr(v))) type = 'datetime';
		else if (/^\d{4}-\d{2}-\d{2}$/.test(wsStr(v))) type = 'date';
	}
	const engage = (el2: HTMLElement, esc: () => void) => {
		el2.addEventListener('focus', () => {
			orgEditGuard = { path, key };
			orgFieldEscape = esc;
		});
	};
	// `tags` IS A LIST WHATEVER THE REGISTRY SAYS. The other three
	// tests all need something to read: a type Obsidian has learnt,
	// or a value that is already an array. A note with NO tags
	// offers neither — `v` is null and a fresh registry answers
	// nothing — so the first tag on a note would have been typed
	// into a TEXT box and written as a string. This vault already
	// carries what that costs: one note whose whole tags list is
	// the single string "#ideas #todo". Named by key, once.
	const listKinds = type === 'tags' || type === 'multitext'
		|| type === 'aliases' || Array.isArray(v)
		|| String(key).toLowerCase() === 'tags';
	if (type === 'checkbox') {
		const box = card.createEl('input', { cls: 'ws-org-editor' });
		box.type = 'checkbox';
		box.checked = v === true;
		engage(box, () => { box.checked = v === true; box.blur(); });
		// A toggle says what it means the moment it flips.
		box.addEventListener('change', () => { void (async () => {
			await d.orgPropSet(path, key, box.checked);
		})(); });
		// AN UNTOUCHED DRAFT IS ABANDONED BY CLICKING AWAY, in every branch.
		// Otherwise `orgEditDone` REDRAWS, the redraw draws the still-live
		// draft again, the draft row takes focus on its timeout and re-arms
		// the guard the blur had just released — and `drawOrg` returns early
		// while that guard is up, so the whole panel stops repainting, which
		// does not look like a draft bug. AND IT REPAINTS — asked for once,
		// where the editor is built, because every editor empties its host.
		// See the head of `orgFieldEditor`.
		box.addEventListener('blur', () => {
			orgEditDone();
		});
		return box;
	}
	if (listKinds) {
		// CHIPS. Frontmatter values are the writer's and editable;
		// for `tags`, the note's BODY tags appear too — dimmed,
		// non-removable, marked "in text", because deleting a #tag
		// means editing prose and that is the editor's job.
		const wrap2 = card.createDiv({ cls: 'ws-org-editor is-chips' });
		const now = Array.isArray(v) ? v.filter(x => x !== null && typeof x !== 'object').map(String)
			: (v === null || v === '' ? [] : [wsStr(v)]);
		// ── THE LIST THE BOX IS HOLDING, NOT THE ONE IT WAS BUILT WITH ──
		//
		// While the caret is in this box the pane is not rebuilt (the
		// edit-guard, and the guard is right), so the editor — and `now`, the
		// list it closed over when it was drawn — survives the write. Every
		// Enter would therefore commit `now.concat([val])` from the SAME stale
		// snapshot: the second tag eats the first, and a writer can never get
		// past one more tag than they started with. The fix belongs HERE and
		// not in the guard — taking the guard's teeth out would fix the tags
		// by throwing away every half-typed sentence in the pane. So the box
		// keeps its own running copy: `now` stays what the note had when this
		// editor was drawn, and the chips are built from it; `live` is what it
		// has NOW, and it is the only list a commit reads or writes.
		let live = now.slice();
		const commitList = async (list: string[]) => {
			// THE DELTA IS AGAINST `live`, the list this box last wrote — a
			// chip taken off after one was added is one removal, not a
			// replay of both.
			await d.orgPropListSet(path, key, list, live);
			live = list.slice();
		};
		// ONE CHIP BUILDER, because a chip is made in two places: when the box
		// is drawn, and when a tag is added to a box that is NOT going to be
		// redrawn (see `live` above). Without the second, the tag a writer just
		// typed lands in the file and shows nothing. THE PILLS' HOST, typed by
		// the key: a tags list wears the tag colours, any other list the plain
		// pill.
		const pillHost = d.orgTagWrap(wrap2, String(key).toLowerCase() === 'tags' ? 'tags' : 'multitext');
		const mkChip = (val: string) => {
			// ── THE × IS THERE, BUT ONLY WHEN REACHED FOR ────────
			//
			// Four buttons on a row of four words is clutter, and no button at
			// all is a list you cannot take anything out of: hidden at REST and
			// shown under the pointer, the row reads as words again, and the door
			// is where a hand already is when it wants one. IT KEEPS ITS BOX AT
			// REST — `opacity`, not `display` — so the pill does not change width
			// under the pointer. OBSIDIAN'S PILL, through the one builder; the ×
			// is its remove button.
			const chip = d.orgTagPill(pillHost, String(val), { remove: () => {
				// the pill goes once the list is written, as before; a failed
				// write keeps it and reaches the console
				void commitList(live.filter(z => z !== val)).then(() => chip.remove());
			} });
			return chip;
		};
		for (const val of now) mkChip(val);
		if (String(key).toLowerCase() === 'tags') {
			const inText = new Set(now.map(t => String(t).replace(/^#/, '').toLowerCase()));
			let bodyTags = [];
			try {
				const f2 = d.plugin.app.vault.getAbstractFileByPath(path);
				const c2 = f2 && d.plugin.app.metadataCache.getFileCache(f2);
				for (const t of ((c2 && c2.tags) || [])) {
					const tag = String(t.tag || '').replace(/^#/, '');
					if (tag && !inText.has(tag.toLowerCase())
						&& bodyTags.indexOf(tag) === -1) bodyTags.push(tag);
				}
			} catch (_) { wsCatch('openManuscriptModal / orgFieldEditor: const f2 = this.app.vault.getAbstractFileByPath(path);', _); }
			for (const tag of bodyTags) {
				const chip = d.orgTagPill(pillHost, tag, { intext: true });
				chip.title = 'Written in the note itself — edit it there';
			}
		}
		const inp = wrap2.createEl('input', { cls: 'ws-org-chipval' });
		inp.placeholder = '+';
		const dlid = 'ws-org-fdl-' + Math.floor(Math.random() * 1e9);
		const dl = wrap2.createEl('datalist'); dl.id = dlid;
		for (const opt of d.plugin.orgDistinctUnder('', key).slice(0, 60)) {
			dl.createEl('option', { value: wsStr(opt) });
		}
		inp.setAttribute('list', dlid);
		engage(inp, () => { inp.value = ''; inp.blur(); });
		// ── A TAG IS NOT FREE TEXT ─────────────────────────
		//
		// THE RULE, from Obsidian's own documentation: a tag may contain
		// letters (any language), numbers but NOT as the first character,
		// underscore, hyphen, and forward slash for nesting. Nothing else — no
		// spaces — and in FRONTMATTER it is written without the leading `#`,
		// which is inline syntax. A box that takes anything produces tags
		// Obsidian indexes none of, invisible to its own search while sitting
		// in plain sight in ours.
		//
		// A SPACE IS REPAIRED, A LEADING DIGIT IS REFUSED. A writer typing two
		// words means one tag, and `-` is the form Obsidian's own docs use for
		// it — there is a right answer, so we write it. A leading digit has no
		// such answer: no character can be assumed to be the one they meant,
		// and silently inventing one is worse than saying no.
		//
		// TAGS ONLY. The same box edits `Characters` and `aliases`, where "the
		// Father" is a perfectly good value; the test asserts that pair, or
		// this would be a rule about tags quietly applied to every list.
		const isTagField = String(key).toLowerCase() === 'tags';
		const tagClean = (raw: string) => String(raw)
			// The `#` is how a tag is written IN PROSE; frontmatter carries
			// the bare name, and a writer types the hash out of habit.
			.replace(/^#+/, '')
			// Whole runs, so “a  b” does not become “a--b”.
			.replace(/\s+/g, '-')
			// Everything Obsidian will not index, dropped rather than
			// substituted — `\p{L}` so this holds for any language.
			.replace(/[^\p{L}\p{N}_\-/]/gu, '')
			// A nest separator is one slash, and never an edge.
			.replace(/\/{2,}/g, '/').replace(/^[-/]+|[-/]+$/g, '');
		inp.addEventListener('keydown', (ev: KeyboardEvent) => { void (async () => {
			if (ev.key !== 'Enter') return;
			ev.preventDefault();
			const typed = inp.value.trim();
			if (!typed) { inp.blur(); return; }
			const val = isTagField ? tagClean(typed) : typed;
			if (isTagField && (!val || /^\p{N}/u.test(val))) {
				// SAID OUT LOUD. A box that silently swallows what was typed
				// reads as broken — which is what "there is a problem with
				// Tags" was, one fault ago.
				try {
					new Notice(val ? 'A tag cannot start with a number — Obsidian '
						+ 'will not index “' + val + '”.'
						: 'That is not a tag Obsidian can index.');
				} catch (_) { wsCatch('openManuscriptModal / orgFieldEditor: new Notice(val ? \'A tag cannot start with a number — Obsidian \'', _); }
				return;
			}
			if (live.indexOf(val) === -1) {
				await commitList(live.concat([val]));
				// BEFORE THE "in text" ONES, which are the note’s prose and not
				// this list — a tag just typed belongs with the ones it joined.
				const at = wrap2.querySelector('.ws-org-tagchip.is-intext') || inp;
				wrap2.insertBefore(mkChip(val), at);
			}
			// AND THE BOX EMPTIES EITHER WAY. It did not on a successful add,
			// so the next tag was typed onto the end of the last one — the
			// other half of "i cannot enter more tags".
			inp.value = '';
		})(); });
		// The same, for a list: see the checkbox branch above.
		inp.addEventListener('blur', () => {
			orgEditDone();
		});
		return inp;
	}
	// The single-value editors share one commit/restore shape.
	const was = v === null ? '' : wsStr(v);
	let el2;
	// A TABLE ROW IS ONE LINE. A long value edits in a one-line input and
	// the resizable columns answer the width.
	{
		el2 = card.createEl('input', { cls: 'ws-org-editor' });
		if (type === 'number') el2.type = 'number';
		else if (type === 'date') el2.type = 'date';
		else if (type === 'datetime') el2.type = 'datetime-local';
		else el2.type = 'text';
		el2.value = was;
		// ── AND IT IS AS WIDE AS WHAT IT HOLDS ───────────────────
		//
		// An `<input>` takes its default size of about twenty characters and
		// does NOT grow to its content, so anything longer is cut off inside a
		// chip that has already shrink-wrapped around it. `size` IS THE
		// MECHANISM AN INPUT HAS for this — a width in characters, which is
		// what the card is measured in too. Capped at 60 so one long value
		// cannot push the line off the pane; floored at 6, which is the
		// `min-width` the chip already used.
		try {
			const n = String(was == null ? '' : was).length;
			el2.size = Math.max(6, Math.min(60, n + 1));
		} catch (_) { wsCatch('openManuscriptModal / orgFieldEditor: const n = String(was == null ? \'\' : was).length;', _); }
	}
	let settled = false;
	const commit = async () => {
		if (settled) return;
		settled = true;
		const raw = el2.value;
		// THE DRAFT IS CANCELLED BEFORE THE REDRAW, NOT AFTER IT, on every
		// branch. `orgEditDone` REDRAWS if a repaint was held back, so running
		// it first would repaint a panel whose draft was still set: the draft
		// row would come back, take focus again on its timeout, and re-arm the
		// very guard the blur had just released — a row on screen the state
		// says is gone, and a panel that has stopped redrawing, because
		// `drawOrg` returns early while the guard is up and that is the one
		// gate every repaint passes.
		if (raw === was) { orgEditDone(); return; }
		let out: string | number = raw;
		if (type === 'number') {
			const n = parseFloat(raw);
			out = raw.trim() === '' ? '' : (isFinite(n) ? n : raw);
		}
		// ── THE PANE IS HANDED BACK BEFORE THE DISK ──────
		//
		// With these two lines after the await, the edit was not over until
		// the file had been written: clicking a second cell while this one is
		// open sets `orgOpenAfter` and calls `drawOrg`, which returns early
		// WHILE THE GUARD IS UP — so the second cell opened only when the
		// write resolved, 50–70ms later against a `drawPanel` of 7–21ms. The
		// checkbox and the chips both release the guard in their own `blur` —
		// `doneDraft(); orgEditDone();`, no await — so this is the fourth
		// editor joining the other three. NOTHING RACES THE GUARD, because
		// `orgEditDone` runs here while this editor is the one that just
		// blurred. That is why the repaint below is NOT another `orgEditDone`:
		// by the time the write lands the guard may belong to the NEXT cell,
		// and clearing it would tear out the field the writer is typing in.
		const stored = d.plugin.propStoreHolds(path);
		orgEditDone();
		await d.orgPropSet(path, key, out);
		// A STORED PROPERTY FIRES NO INDEX EVENT. A markdown write
		// reaches the pane through the ring; a non-md one lands in
		// `ws-structure.md` and rings nothing, so without this the
		// cell would keep the value it had before — the same reason
		// `step` asks for a repaint on the stored path and not the
		// other. THROUGH `drawPanel`, which reaches `drawOrg` — “the
		// one gate every repaint passes”, so a late write that finds
		// another editor open waits for it instead of interrupting it.
		if (stored) d.drawPanel();
	};
	engage(el2, () => {
		// Escape RESTORES — the write never happens, the field says
		// what the note says, and the key backs out one step.
		settled = true;
		el2.value = was;
		el2.blur();
	});
	el2.addEventListener('keydown', (ev: KeyboardEvent) => {
		if (ev.key === 'Enter') {
			// Shift+Enter is a NEWLINE in the growing textarea; a
			// bare Enter commits everywhere.
			if (ev.shiftKey && el2.tagName === 'TEXTAREA') return;
			ev.preventDefault();
			// AND THE KEY STOPS HERE. The rename and the target editor stop their
			// Enter; if this one let it travel on to the document, Obsidian's
			// keymap would handle it AFTER the field had blurred below — the
			// pane's own Enter would find nothing typing and open the cursor row.
			// One act from one key.
			ev.stopPropagation();
			el2.blur();   // blur is the one committer
		}
	});
	el2.addEventListener('blur', () => {
		if (settled) { settled = false; orgEditDone(); return; }
		void commit();
	});
	// ── A DATE SHOWS THE WRITER'S FORMAT, AND EDITS ON A CLICK ──────
	//
	// A live `<input type="date">` renders in the BROWSER's locale and
	// takes no instruction, so no formatter could reach it and a Table
	// cell and this field would show the same day two ways. ONLY date AND
	// datetime: a text or number input already displays exactly what is
	// stored, so there is no disagreement to fix, and the narrow rule is
	// the whole reason this is safe. A DRAFT OPENS STRAIGHT INTO THE BOX:
	// a key being added has no value to show, and making the writer click
	// the empty space they just asked for would be a second gesture for
	// one intention.
	if ((type === 'date' || type === 'datetime') && !isDraft) {
		const shown = card.createSpan({ cls: 'ws-org-shown' });
		// ── IT SAYS WHAT THE BOX SAYS, WHENEVER IT IS ASKED ────
		//
		// This span is what a date field IS at rest. A blur that swaps two
		// classes restores the STRING the span was built with — the write
		// lands and the span goes on showing the old day, so the writer sees
		// their typing thrown away and finds it there the next time they open
		// the window. Whether a redraw arrives afterwards is a different
		// question and not one this field may depend on: the span goes back
		// in the same tick the value changes. SO IT RENDERS, rather than
		// remembering: one function, called when the field is built and again
		// whenever the box stands down — through `formatValue`, so a day at
		// rest and a day in a Table cell cannot disagree.
		const sayDay = (raw: unknown) => {
			const fmt2 = d.plugin.formatValue(key, raw, type, d.plugin.dateStyle());
			// AN EMPTY DAY STILL NEEDS SOMETHING TO CLICK, or a property
			// with no value yet becomes uneditable the moment it stops
			// being an input.
			shown.setText(fmt2.text || '—');
			shown.toggleClass('is-empty', !fmt2.text);
			shown.toggleClass('ws-org-badval', !fmt2.ok);
			shown.title = fmt2.ok ? ''
				: ('This is not a valid ' + type + ': ' + wsStr(raw));
		};
		sayDay(v);
		el2.addClass('is-editing-off');
		// FOCUSABLE, because it replaced something that was. The field
		// was reachable by Tab when it was permanently an input, and a
		// display that could only be opened with a mouse would be a
		// keyboard regression dressed as a formatting fix.
		shown.tabIndex = 0;
		const open = () => {
			shown.addClass('is-editing-off');
			el2.removeClass('is-editing-off');
			try { el2.focus(); } catch (_) { wsCatch('openManuscriptModal / open: el2.focus();', _); }
		};
		shown.addEventListener('click', open);
		shown.addEventListener('focus', open);
		shown.addEventListener('keydown', (ev: KeyboardEvent) => {
			if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
		});
		// AND IT COMES BACK IF NOTHING REDRAWS. `orgEditDone` only repaints
		// when a repaint was held back, so an unchanged value blurs with no
		// redraw at all — and the field would be left as a bare
		// locale-formatted box until something else happened. READING THE
		// BOX, NOT THE VALUE IT WAS BUILT WITH.
		el2.addEventListener('blur', () => {
			sayDay(el2.value);
			el2.addClass('is-editing-off');
			shown.removeClass('is-editing-off');
		});
	}
	return el2;
};

// The field row itself: property label (the view-wide picker), the
// editor, and the per-row "+" that adds a property to that note.
// ── A PROPERTY WEARS ITS TYPE'S GLYPH ──────────────────────────
//
// Matching Obsidian's own properties block: a small icon, the key,
// then the value. The icon is not decoration — it says what KIND of
// property this is, which is why `tags` gets a tag and `aliases` gets
// the forward arrow while an ordinary text key gets the lines. TWO
// KEYS ARE SPECIAL BY NAME rather than by type: Obsidian treats `tags`
// and `aliases` as their own things and draws them so, and a writer
// reading the row expects the same picture in both windows. Names in
// order and CHECKED, as everywhere else here: `setIcon` fails
// silently, and Lucide has renamed several of these.
const ORG_PROP_ICONS: Record<string, string[]> = {
	tags:     ['tags', 'tag'],
	aliases:  ['forward', 'corner-up-right', 'arrow-right'],
	checkbox: ['check-square', 'square-check', 'check'],
	number:   ['binary', 'hash'],
	date:     ['calendar', 'calendar-days'],
	datetime: ['clock', 'calendar-clock'],
	list:     ['list'],
	text:     ['text', 'align-left', 'list']
};
const orgPropIcon = (into: HTMLElement, key: string) => {
	const k = String(key || '').toLowerCase();
	let names = null;
	if (k === 'tags' || k === 'tag') names = ORG_PROP_ICONS.tags;
	else if (k === 'aliases' || k === 'alias') names = ORG_PROP_ICONS.aliases;
	if (!names) {
		let t = '';
		try { t = String(d.plugin.orgPropType(key) || ''); } catch { t = ''; }
		names = ORG_PROP_ICONS[t]
			|| (t === 'multitext' ? ORG_PROP_ICONS.list : ORG_PROP_ICONS.text);
	}
	const g = into.createSpan({ cls: 'ws-org-propicon' });
	for (const n of names) {
		g.textContent = '';
		try { if (setIcon) setIcon(g, n); } catch (_) { wsCatch('openManuscriptModal / orgPropIcon: if (setIcon) setIcon(g, n);', _); }
		if (g.childElementCount > 0) { g.dataset.icon = n; break; }
	}
	return g;
};
	return { orgPropPopEl, orgPropPanelRows, orgPropSubEl, orgPropSubClose, orgPropPopClose, orgPropPopOpen, orgOtherEditorOpen, orgEditDone, orgPropValue, orgFieldEditor, get orgEditGuard() { return orgEditGuard; }, set orgEditGuard(v) { orgEditGuard = v; }, get orgOpenAfter() { return orgOpenAfter; }, set orgOpenAfter(v) { orgOpenAfter = v; }, get orgRedrawPending() { return orgRedrawPending; }, set orgRedrawPending(v) { orgRedrawPending = v; }, get orgFieldEscape() { return orgFieldEscape; }, set orgFieldEscape(v) { orgFieldEscape = v; } };
};
