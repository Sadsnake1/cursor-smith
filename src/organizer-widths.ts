// Word-Smith — organizer-widths: what a column measures, and the grips.

import { wsCatch } from './preamble';
import type { WsSession } from './preamble';
import type WordSmith from './plugin';
import type { WordSmithSettings } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE WIDTHS — what a column measures, and the grips that let a writer say
// ════════════════════════════════════════════════════════════════════════
//
// The floors and ceilings (`ORG_NAME_MIN` / `_MAX`, `ORG_COL_MIN`,
// `ORG_COL_MAXFRAC`, `orgColCeil`), the scroll the session remembers, a
// column's width and how it is read, stored and stamped (`orgColW`,
// `orgColWSet`, `orgColFit`, `orgColApply`, `orgColUnfix`, `orgColLive`,
// `orgColMark`, `orgColStamp`), the name column's own (`orgNameW`,
// `orgNameStamp` with its ResizeObserver), and the grips (`orgGripAt`,
// `orgGripHover`, `orgColGripBind`, `orgNameGripBind`) with the two test
// doors `_orgGripAt` and `_orgGripDrag`.
//
// WHAT IT READS, through `d`: the settings (`d.s`), the session (`d.ses`),
// the phone test (`d.orgNarrowNow`), the window (`d.ownerWin`),
// `d.drawPanel`, `d.orgGripDrag` (which it also sets: the window's drag
// latch) and `d.plugin`. Every `host` in here is a PARAMETER — the table's
// element, never the window's host.
//
// SIX OF ITS `let`s ARE LIVE — `orgScrollTop`, `orgScrollLeft`,
// `orgColFitNow`, `orgNameLineNow`, `orgNameRO`, `orgGripReleasedAt` —
// read and set by the table context the window hands the table module;
// they come back as getters and setters, and the window reads them as
// `orgWidths.<name>`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgWidthsMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (3 of 7).
export interface OrgWidthsDeps {
	plugin: WordSmith;
	readonly drawPanel: () => void;
	orgGripDrag: number;
	readonly orgNarrowNow: () => boolean;
	readonly ownerWin: () => typeof window;
	readonly s: WordSmithSettings;
	readonly ses: WsSession;
}

export const wsOrgWidthsMake = (d: OrgWidthsDeps) => {
// ── THE NAME COLUMN'S WIDTH IS THE WRITER'S ────────────────────
//
// The cap it overrides is `max-width: 32ch` — one number for every
// vault, which the writer never picked; a hairline seam lets them drag
// it. STORED IN PIXELS AND NAMED IN PIXELS: a store that changes UNIT
// changes NAME, and a bare `organizerNameCol` could be read as either,
// so the first reader to guess wrong would be off by a factor of eight.
// NOT DEFAULTED, so absent means "the table decides", which is what
// every vault that has never dragged it still gets.
const ORG_NAME_MIN = 120;
const ORG_NAME_MAX = 1200;
// A COLUMN THAT IS NOT THE NAME may go narrower — a Flag or a
// Grade is a glyph and a number — but not below the hit target a
// pointer needs to grab its grip.
const ORG_COL_MIN = 48;
// AND NO COLUMN MAY EAT THE TABLE. Sixty per cent of the pane the
// table is drawn in, measured at the moment of the drag rather
// than stored, so it follows the pane instead of dating from
// whatever the pane was when the writer last dragged.
const ORG_COL_MAXFRAC = 0.6;
// ── READ ONCE A DRAW, NOT ONCE A CELL ─────────────────────────
//
// `clientWidth` IS A LAYOUT READ, reached from `orgColW`, which is
// reached from `orgColStamp`, which runs for EVERY CELL — inside the
// loop that is creating those cells. Write a `<td>`, read a width,
// write the next, read again: the browser has to lay the table out
// afresh on every read, because the last write invalidated what the
// read is asking about — a uniform price paid by every cell whatever
// it contains (a flag cell as dear as a property cell), which was most
// of a draw. READ EVERYTHING, THEN WRITE, the rule `orgColFit` states.
// KEYED ON THE HOST, not a bare flag: the answer depends only on the
// element, so a different host must not read a cached number that was
// measured on another. Cleared at the top of every draw, where the
// pane may have been resized since — the same place and the same
// reason as `orgFilePathCache`.
//
// ── WHERE THE WRITER IS LOOKING, REMEMBERED AS THEY LOOK ─────
//
// `scrollTop` is a LAYOUT read too, and reading it at the top of the
// draw makes the browser lay out everything the PREVIOUS draw wrote. A
// SCROLL EVENT ALREADY KNOWS THE NUMBER: the browser fires it after it
// has scrolled, so reading there costs nothing that has not already
// been paid — and the draw then reads a plain variable. STARTS WHERE
// IT LEFT OFF: the session supplies the opening value and takes the
// closing one.
let orgScrollTop = Math.max(0, Number(d.ses.scroll) || 0);
// AND SIDEWAYS: a redraw rebuilds the table's box, and the columns you
// had scrolled to come back with it. Kept for the redraw only, not the
// session: a fresh window opens at the left edge.
let orgScrollLeft = 0;
let orgCeilHost: HTMLElement | null = null;
let orgCeilVal = 0;
const orgColCeilReset = () => { orgCeilHost = null; };
const orgColCeil = (host: HTMLElement | null) => {
	if (host && orgCeilHost === host) return orgCeilVal;
	const w = host ? host.clientWidth : 0;
	const v = !(w > 0) ? ORG_NAME_MAX
		: Math.max(ORG_COL_MIN, Math.round(w * ORG_COL_MAXFRAC));
	if (host) { orgCeilHost = host; orgCeilVal = v; }
	return v;
};
// THE ONE STORE. `name` is a member like any other; the column ids
// are `goal`, `words`, `fm:<key>` and the rest.
// RESIZE COLUMNS TO FIT, ONCE. Declared here because it needs
// `orgColWSet` and the panel needs it; the table it measures is found
// through the panel host, not held, because a table element does not
// survive a redraw. READ EVERYTHING, THEN WRITE: the stamps come off,
// ONE layout is forced, every width is read, and only then is anything
// set — interleaving the two makes the browser lay the table out again
// on every column.
const orgColFit = () => {
	if (!orgColFitNow) return;
	orgColFitNow();
};
let orgColFitNow: (() => void) | null = null;
const orgColPx = () => {
	const m = d.s.uniColPx;
	return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
};
const orgColW = (id: string, host: HTMLElement | null) => {
	const n = Number(orgColPx()[String(id)]);
	// NOT ON A PHONE: the stored widths are the desktop's, dragged on a
	// table a thousand pixels wide, and the store is shared — honoured on
	// a 360px pane they give an EMPTY Target column most of the screen. A
	// narrow pane sizes every reading to its content and gives the name
	// the room that leaves (`--ws-org-nameroom`).
	if (id !== 'name' && d.orgNarrowNow()) return 0;
	if (!isFinite(n) || n <= 0) return 0;
	const lo = id === 'name' ? ORG_NAME_MIN : ORG_COL_MIN;
	const hi = Math.min(ORG_NAME_MAX, orgColCeil(host));
	return Math.round(Math.max(lo, Math.min(hi, n)));
};
const orgColWSet = (id: string, px: number | null) => {
	const m = Object.assign({}, orgColPx());
	if (px === null) delete m[String(id)];
	else m[String(id)] = Math.round(px);
	d.s.uniColPx = m;
	d.plugin.saveSettings().catch(() => {});
};
// KEPT AS A NAME, because the seam and the stamp both ask this one
// question and neither should learn about the map.
const orgNameW = () => orgColW('name', null);
// SET BY THE PANEL EACH TIME IT DRAWS, and read by the grip while it
// is being dragged. Declared here because the two are built in
// different places and neither owns the other.
let orgNameLineNow: (() => void) | null = null;
// AND THE THING THAT KEEPS IT TRUE. See where it is armed: the seam
// is measured off a table cell, and a cell has no width until the
// table has been laid out.
let orgNameRO: ResizeObserver | null = null;
const orgNameStamp = (table: HTMLElement) => {
	// ── THE WIDTH IS THE TABLE'S, AND IT STAYS THERE ──────────
	//
	// REMOVED, NOT SKIPPED, for the reason `orgNameLine` gives beside its
	// own removals: a table element that survives a redraw would keep a
	// stale class and a stale width, and the cut would come back the next
	// time anything else repainted.
	const w = orgNameW();
	if (!w) return;
	table.addClass('is-namefixed');
	table.style.setProperty('--ws-org-namew', w + 'px');
};
// THE HAIRLINE IS THE DOOR AND THE GRIP IS ITS HIT AREA. Every control
// needs a visible one — a gesture is not a door. The hairline is drawn
// down the whole column, at rest, by the stylesheet; this is the 7px a
// pointer can actually aim at, because a 1px target is not one.
// Hovering it lights the edge.
//
// ── THE GRIP IS THE WHOLE SEAM, NOT ITS TOP ────────────────
//
// A grip that lives in the header CELL is draggable for 28px of
// heading, and the rest of the line is decoration that looks like a
// control. SO IT HANGS OFF THE HOST, exactly like the seam it aims at,
// and takes the same three variables: two things drawn from one set of
// numbers cannot drift apart.
//
// ── A COLUMN'S WIDTH HAS TO REACH ITS CELLS, NOT JUST ITS HEADER ───
//
// A `<table>` TREATS A CELL WIDTH AS A SUGGESTION: three properties on
// the TH are still only the header's opinion — the column is as wide
// as its widest cell, and the body cells have to be told. The name
// column stamps `--ws-org-namew` and a class, and the rule it drives
// names `.ws-org-name`, which is the `th` AND every `td`. ONE STAMPER
// FOR ALL THREE SITES (the header and the two body builders, the
// subject row and the ordinary rows), because a width applied by the
// header and forgotten by a body builder is the same bug in a new
// place. THE MECHANICS OF STAMPING ONE CELL, in one place: the draw
// reads the STORE for its width and the live drag has a number in hand,
// so they cannot share a function — but they must not disagree about
// what applying a width means.
const orgColApply = (cell: HTMLElement, w: string|number) => {
	// box-sizing is the sheet's (`.ws-org-table th, td`); the three widths are the drag's.
	cell.style.width = w + 'px';
	cell.style.minWidth = w + 'px';
	cell.style.maxWidth = w + 'px';
};
// ── AND ITS MIRROR ─────────────────────────────────────────────
//
// `orgColApply` stamps three properties on EVERY cell in a column; a
// fit that cleared them from `thead th` alone would leave every body
// cell carrying `min-width` and `max-width` at the old number, measure
// exactly what was already stored, and write it back — a round trip
// that looks like a button doing nothing. IT IS A FUNCTION, NEXT TO ITS
// OPPOSITE, for the reason `orgColApply` is one: three properties are
// written and all three have to go. Clearing `width` and leaving
// `min-width` is a column that cannot shrink.
const orgColUnfix = (cell: { style: { removeProperty: (arg0: string) => void; }; }) => {
	cell.style.removeProperty('width');
	cell.style.removeProperty('min-width');
	cell.style.removeProperty('max-width');
};
// AND THE WHOLE COLUMN AT ONCE, for the drag: the draw stamps every
// cell, and `move` has to stamp the same cells, or the header slides
// ahead of its own column and the body catches up in one jump on
// release.
const orgColLive = (host: HTMLElement, id: string, w: number) => {
	if (!host) return;
	for (const cell of Array.from<HTMLElement>(host.querySelectorAll('th, td'))) {
		if (cell.getAttribute('data-col') !== id) continue;
		orgColApply(cell, w);
	}
};
// AND THE WHOLE COLUMN WEARS THE DRAG: the same walk as the widths,
// once at the press and once at the release; the stylesheet turns the
// cells' own separator to the accent, top to bottom.
const orgColMark = (host: HTMLElement, id: string, on: boolean) => {
	if (!host) return;
	for (const cell of Array.from<HTMLElement>(host.querySelectorAll('th, td'))) {
		if (cell.getAttribute('data-col') !== id) continue;
		cell.toggleClass('is-gripdrag', !!on);
	}
};
const orgColStamp = (cell: HTMLElement, id: string, host: HTMLElement | null) => {
	const w = orgColW(id, host);
	if (!w) return;
	// BORDER-BOX, OR THE COLUMN CREEPS — see `orgColApply`. The grip
	// measures what it is dragging from `getBoundingClientRect()`, which
	// INCLUDES the cell's padding, and stores that number.
	orgColApply(cell, w);
};
// ── AND IT MUST NOT EAT THE COLUMN IT SITS OVER ──────────────
//
// A grip 7px wide at `z-index: 4` running the whole height of the
// table is a dead strip down every column's right edge — a tag chip's ×
// sits at the right of its chip, so it would be under the strip and
// could not be pressed. THE GRIP TAKES NO POINTER EVENTS. It is the
// visible line and the hover mark and nothing else; the DRAG is bound
// on the scroller, which asks whether the pointer went down within
// `ORG_GRIP_NEAR` of a column edge. A press anywhere else reaches
// whatever is under it. Both halves survive: the edge is grabbable
// anywhere down its height, and the cells under it are clickable.
//
// WHEN A GRIP LAST LET GO. THE PRESS IS STOPPED AND THE CLICK IS NOT:
// a click is synthesised from the pointerdown/pointerup PAIR and
// dispatched afterwards, and stopping the pointerdown does not cancel
// it. The grip is `pointer-events: none`, so that click lands on the
// `th` underneath — which IS the sort control. A TIMESTAMP, NOT A
// SWALLOWED EVENT: a one-shot capturing listener that eats the next
// click stays armed if the release never produces one — the pointer
// left the window, the press was cancelled — and eats an unrelated
// click later. A reading the sort handler consults cannot go stale
// that way.
let orgGripReleasedAt = 0;
const ORG_GRIP_CLICK_MS = 300;
const ORG_GRIP_NEAR = 4;
// WHICH EDGE IS THE POINTER ON, if any. The grips carry their column's
// id, so the answer is the grip itself rather than a second map of
// columns to positions.
const orgGripAt = (host: HTMLElement, x: number, y: number) => {
	if (!host) return null;
	const hb = host.getBoundingClientRect();
	if (y < hb.top || y > hb.bottom) return null;
	for (const g of Array.from<HTMLElement>(host.querySelectorAll('.ws-org-colgrip'))) {
		const r = g.getBoundingClientRect();
		// WITHIN THE GRIP'S OWN HEIGHT: x alone across the whole host is
		// harmless while every grip runs the table's height, and the whole
		// fault once a finger's grip is the header's height — a press on a
		// row at the seam's x would capture the pointer and resize instead of
		// panning.
		if (y < r.top || y > r.bottom) continue;
		const mid = (r.left + r.right) / 2;
		// AS FAR AS THE GRIP REACHES: 4px from the edge on a mouse, but a
		// finger-wide grip under a coarse pointer (40px in the sheet) owns the
		// touch, so the grip's own half-width, measured — the sheet decides.
		if (Math.abs(x - mid) <= Math.max(ORG_GRIP_NEAR, r.width / 2)) return g;
	}
	return null;
};
// ── AND THE POINTER HAS TO SAY SO ─────────────────────────────
//
// An element that takes no pointer events gets no `:hover` and
// contributes no `cursor`, so a stylesheet aimed at the grip can never
// match. THE ANSWER COMES FROM THE HOST, which IS hittable, keyed on
// the same `orgGripAt` reading the press uses. One writer for "is the
// pointer on an edge", answering three questions with it: the cursor,
// the accent, and the drag. BOUND ONCE PER HOST, not once per column:
// a pointermove that lights whichever edge is nearest has nothing to
// vary per column, and six copies would fight over `lit`.
const orgGripHover = (host: HTMLElement) => {
	if (!host || host.hasAttribute('data-ws-griphover')) return;
	host.setAttribute('data-ws-griphover', '1');
	let lit: HTMLElement | null = null;
	const light = (g: HTMLElement | null) => {
		if (lit === g) return;
		// AND THE HEADING BESIDE IT: the dots on the heading's own ::after
		// brighten with the grip, and the stylesheet may not reach a parent
		// from a child (`:has()` is held out by the sheet's own check).
		if (lit) { lit.removeClass('is-near'); if (lit.parentElement) lit.parentElement.removeClass('is-gripnear'); }
		lit = g;
		if (lit) { lit.addClass('is-near'); if (lit.parentElement) lit.parentElement.addClass('is-gripnear'); }
		// A CLASS, NOT AN INLINE CURSOR. `host.style.cursor` is inherited,
		// and inheritance loses to any descendant that sets its own — the rows
		// are draggable and say `grab`, so the host cursor is a true reading
		// of the wrong element. The state is a class and the stylesheet
		// reaches the whole subtree with it, at a specificity that beats
		// `.ws-org-row.is-draggable` outright rather than by sitting later in
		// the file.
		host.toggleClass('is-gripnear', !!lit);
	};
	host.addEventListener('pointermove', (ev: MouseEvent) => {
		light(orgGripAt(host, ev.clientX, ev.clientY));
	});
	// LEAVING IS NOT A MOVE. Without this the last lit edge keeps its
	// accent and the scroller keeps the resize cursor after the
	// pointer has gone.
	host.addEventListener('pointerleave', () => light(null));
	// A LONG PRESS ON A GRIP OPENS NOTHING. A finger resting on the edge
	// before it moves is a long press to the platform, and the column menu
	// would open under the drag. Capture, so the heading's own handler
	// never hears it; the heading away from an edge keeps its menu.
	host.addEventListener('contextmenu', (ev: MouseEvent) => {
		// A HEADING UNDER THE POINTER AND A GRIP WITH A WIDTH: a laid-out grip
		// has a width; a zero box (a bare DOM, where every grip is "near"
		// (0,0)) is no grip, or the guard would swallow every right-click in
		// the window.
		if (!d.orgGripDrag) {
			const target = ev.target as HTMLElement | null;
	const inHead = target && target.closest && target.closest('thead');
			const g = inHead ? orgGripAt(host, ev.clientX, ev.clientY) : null;
			if (!g || !(g.getBoundingClientRect().width > 0)) return;
		}
		ev.preventDefault();
		ev.stopPropagation();
	}, true);
};
const orgColGripBind = (th: HTMLElement, col: { id: string; label: string }, host: HTMLElement) => {
	const grip = th.createDiv({ cls: 'ws-org-colgrip' });
	orgGripHover(host);
	grip.setAttribute('data-col', col.id);
	grip.title = 'Drag to set how wide “' + col.label + '” is — '
		+ 'double-click to hand it back to the table';
	let from = 0, base = 0, live = 0;
	const move = (ev: MouseEvent) => {
		live = Math.max(ORG_COL_MIN, Math.min(orgColCeil(host),
			base + (ev.clientX - from)));
		// STAMPED ON THE WHOLE COLUMN WHILE THE DRAG IS LIVE, saved on
		// release. A settings write per pointermove is a write per pixel
		// dragged, in a file the vault syncs.
		//
		// THE COLUMN, NOT THE HEADER. This stamped `th` alone, which was
		// enough while nothing else was stamped either — and stopped
		// being enough the moment the draw started stamping every cell:
		// the header moved with the pointer and the body did not, then
		// jumped to meet it on release.
		orgColLive(host, col.id, Math.round(live));
	};
	const up = () => {
		try {
			d.ownerWin().removeEventListener('pointermove', move, true);
			d.ownerWin().removeEventListener('pointerup', up, true);
		} catch (_) { wsCatch('openManuscriptModal / up: ownerWin().removeEventListener(\'pointermove\', move, true);', _); }
		// STAMPED WHETHER OR NOT IT MOVED. A press on a separator that
		// went nowhere is still not a press on the heading, and it
		// produces the same click.
		orgGripReleasedAt = Date.now();
		d.orgGripDrag = 0;
		orgColMark(host, col.id, false);
		if (!live) return;
		orgColWSet(col.id, live);
		live = 0;
	};
	// ON THE SCROLLER, NOT ON THE GRIP. The grip takes no pointer events
	// any more — see the note above — so the press is heard here and
	// answered only when it lands on this column's edge. Registered once
	// per column, and each ignores every press but its own.
	host.addEventListener('pointerdown', (ev: PointerEvent) => {
		if (orgGripAt(host, ev.clientX, ev.clientY) !== grip) return;
		// THE GRIP KEEPS ITS POINTER: a finger that wanders off the header
		// mid-drag must not hand the move to whatever it is over.
		try { if (grip.setPointerCapture && ev.pointerId != null) grip.setPointerCapture(ev.pointerId); } catch (_) { wsCatch('openManuscriptModal / orgColGripBind: grip.setPointerCapture(ev.pointerId);', _); }
		// STOPPED, BOTH WAYS. The header cell IS the sort control and
		// it is draggable for reordering; a drag that also sorted or
		// moved the column would be three acts from one gesture.
		ev.preventDefault();
		ev.stopPropagation();
		from = ev.clientX;
		base = th.getBoundingClientRect().width || ORG_COL_MIN;
		live = 0;
		d.orgGripDrag = 1;
		// THE WHOLE COLUMN LIGHTS FOR THE DRAG.
		orgColMark(host, col.id, true);
		try {
			d.ownerWin().addEventListener('pointermove', move, true);
			d.ownerWin().addEventListener('pointerup', up, true);
		} catch (_) { wsCatch('openManuscriptModal / orgColGripBind: ownerWin().addEventListener(\'pointermove\', move, true);', _); }
	});
	// AND IT MUST NOT START THE COLUMN REORDER EITHER. The `th`
	// carries `draggable="true"`, and a pointerdown on a child of a
	// draggable element still begins that drag.
	grip.addEventListener('dragstart', (ev: Event) => {
		ev.preventDefault();
		ev.stopPropagation();
	});
	// AND THE HAND-IT-BACK GESTURE, asked of the same edge test. It was
	// on the grip and would now never fire.
	host.addEventListener('dblclick', (ev: MouseEvent) => {
		if (orgGripAt(host, ev.clientX, ev.clientY) !== grip) return;
		ev.preventDefault();
		ev.stopPropagation();
		orgColWSet(col.id, null);
		d.drawPanel();
	});
};
const orgNameGripBind = (host: HTMLElement, th: HTMLElement, table: HTMLElement) => {
	const grip = host.createDiv({ cls: 'ws-org-namegrip' });
	grip.title = 'Drag to set how wide the Name column is '
		+ '\u2014 double-click to hand it back to the table';
	let from = 0, base = 0, live = 0;
	// THE SCROLLER'S CEILING, not the host's: the host holds the grip, the
	// scroller holds the table, and the two differ by the vertical bar and
	// the inset. Every column's grip and the stamped `--ws-org-nameceil`
	// read the scroller.
	const scroller = () => table.parentElement || host;
	const move = (ev: MouseEvent) => {
		live = Math.max(ORG_NAME_MIN, Math.min(orgColCeil(scroller()),
			base + (ev.clientX - from)));
		table.addClass('is-namefixed');
		table.style.setProperty('--ws-org-namew',
			Math.round(live) + 'px');
		// THE SEAM FOLLOWS THE DRAG. It is drawn outside the scroller
		// now, so nothing else moves it — a line that stayed where the
		// column used to end would be the worst of both.
		try { if (orgNameLineNow) orgNameLineNow(); } catch (_) { wsCatch('openManuscriptModal / move: if (orgNameLineNow) orgNameLineNow();', _); }
	};
	// SAVED ON RELEASE, NOT ON EVERY MOVE. A settings write per
	// pointermove is a write per pixel dragged, in a file the vault
	// syncs — the same reason the colour picker’s mirror is
	// debounced hard.
	const up = () => {
		try {
			d.ownerWin().removeEventListener('pointermove', move, true);
			d.ownerWin().removeEventListener('pointerup', up, true);
		} catch (_) { wsCatch('openManuscriptModal / up: ownerWin().removeEventListener(\'pointermove\', move, true);', _); }
		d.orgGripDrag = 0;
		host.removeClass('is-namedrag');
		if (!live) return;
		orgColWSet('name', live);
		live = 0;
	};
	grip.addEventListener('pointerdown', (ev: MouseEvent) => {
		// STOPPED, BOTH WAYS. The header cell IS the sort control
		// and it carries a context menu; a drag that also sorted the
		// table would be two acts from one gesture.
		ev.preventDefault();
		ev.stopPropagation();
		from = ev.clientX;
		base = th.getBoundingClientRect().width || ORG_NAME_MIN;
		live = 0;
		d.orgGripDrag = 1;
		// THE SEAM LIGHTS FOR THE DRAG: the host’s own line.
		host.addClass('is-namedrag');
		try {
			d.ownerWin().addEventListener('pointermove', move, true);
			d.ownerWin().addEventListener('pointerup', up, true);
		} catch (_) { wsCatch('openManuscriptModal / orgNameGripBind: ownerWin().addEventListener(\'pointermove\', move, true);', _); }
	});
	grip.addEventListener('click', (ev: Event) => ev.stopPropagation());
	// AND THE WAY BACK IS ON THE SAME CONTROL. A width a writer can
	// set and not unset is a one-way door.
	grip.addEventListener('dblclick', (ev: Event) => {
		ev.preventDefault();
		ev.stopPropagation();
		orgColWSet('name', null);
		d.drawPanel();
	});
};
// A door for the tests, which cannot reach a closure local: the panel
// is what reads the store, so a test that writes one has to be able to
// ask for the redraw that reads it.
d.plugin._orgDraw = () => d.drawPanel();
// AND THE FIT, which is a row in the Properties panel; the door calls
// what the row calls — not a copy of it.
d.plugin._orgFit = () => { if (orgColFitNow) orgColFitNow(); };
// AND THE EDGE TEST, so a test can ask whether a press on a row at the
// seam's x is a grip — which under a finger it must not be.
d.plugin._orgGripAt = (host, x, y) => orgGripAt(host, x, y);
// AND WHETHER THE PANE THINKS A GRIP IS STILL HELD: a drag that never
// sees its release leaves every later pinch refused, and nothing on
// screen says so.
d.plugin._orgGripDrag = () => d.orgGripDrag;
	return { ORG_COL_MIN, orgColCeilReset, orgColCeil, orgColFit, orgColPx, orgNameStamp, orgColUnfix, orgColStamp, ORG_GRIP_CLICK_MS, orgColGripBind, orgNameGripBind, get orgScrollTop() { return orgScrollTop; }, set orgScrollTop(v) { orgScrollTop = v; }, get orgScrollLeft() { return orgScrollLeft; }, set orgScrollLeft(v) { orgScrollLeft = v; }, get orgColFitNow() { return orgColFitNow; }, set orgColFitNow(v) { orgColFitNow = v; }, get orgNameLineNow() { return orgNameLineNow; }, set orgNameLineNow(v) { orgNameLineNow = v; }, get orgNameRO() { return orgNameRO; }, set orgNameRO(v) { orgNameRO = v; }, get orgGripReleasedAt() { return orgGripReleasedAt; }, set orgGripReleasedAt(v) { orgGripReleasedAt = v; } };
};
