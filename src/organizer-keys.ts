// Word-Smith — organizer-keys: the cursor, the bindings, and what Escape
// backs out of.

import { wsCatch, wsGuardReport, wsNodeOf, wsStatusNext } from './preamble';
import type WordSmith from './plugin';
import type { WsModEvent } from './plugin';
import type { Modifier } from 'obsidian';
import type { WsHost } from './settings';
import type { wsOrgPropsMake } from './organizer-props';
import type { wsOrgSelMake } from './organizer-sel';

// ════════════════════════════════════════════════════════════════════════
// THE KEYS — the cursor, the bindings, and what Escape backs out of
// ════════════════════════════════════════════════════════════════════════
//
// The cursor over the table's rows (`cursorItem`, `tableOrder`,
// `moveCursor`), the binder every shortcut goes through (`key`, which
// refuses while something is being typed into), `nudge` (a row moved by
// the keyboard, through the one reorder writer), and THE ESCAPE LADDER —
// `escapeLadder` with `onEscape` over it, the rungs in order: a field
// being edited, the properties pop-over, the lens, and then, on the tabs
// a selection outlives, the selection itself.
//
// THE LADDER LISTENS ON THE WINDOW, above the app's own keymap and below
// nothing; `onEscape` is what the window binds and unbinds, and a ladder
// that outlives its window swallows Escape for the rest of the session.
//
// WHAT IT READS, through `d`: the tab (`d.tab`), the host and its panel
// (`d.host`, `d.panel`), the selection (`d.sel`, `d.orgSel`, `d.keyOf`,
// `d.itemOf`), the lens (`d.orgLensOn`, `d.orgLensClear`), the properties
// pop-over and its edit guard (`d.orgProps`, `d.orgPropPopEl`,
// `d.orgPropPopClose`, `d.orgPropSubEl`, `d.orgPropSubClose`), the row
// doors (`d.openRow`, `d.orgFollow`, `d.orgFlagSet`, `d.markOf`,
// `d.orgNote`, `d.folderOf`, `d.exportScope`), the draw (`d.draw`,
// `d.drawPanel`), `d.typing` and `d.plugin`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgKeysMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (17 of 25).
export interface OrgKeysDeps {
	plugin: WordSmith;
	readonly draw: () => void;
	readonly drawPanel: () => void;
	readonly exportScope: () => string;
	readonly folderOf: (path: string) => string;
	readonly host: WsHost;
	readonly itemOf: (key: string) => { kind: string; path: string; };
	readonly keyOf: (it: { kind: string; path: string }) => string;
	readonly markOf: (path: string | number, kind: string) => string;
	readonly openRow: (it: { kind: string; path: string; }, ev?: WsModEvent) => void;
	readonly orgFlagSet: (row: { path: string }, id: string, cell: HTMLElement | null) => Promise<void>;
	readonly orgFollow: (it: { kind: string; path: string; }, keepScope: boolean, markOnly: boolean) => void;
	readonly orgLensClear: () => void;
	readonly orgLensOn: () => boolean;
	readonly orgNote: string;
	readonly orgPropPopClose: () => void;
	readonly orgPropPopEl: () => HTMLElement | null;
	readonly orgPropSubClose: () => void;
	readonly orgPropSubEl: () => HTMLElement | null;
	readonly orgProps: ReturnType<typeof wsOrgPropsMake>;
	readonly orgSel: ReturnType<typeof wsOrgSelMake>;
	readonly panel: HTMLDivElement;
	readonly sel: ReturnType<typeof wsOrgSelMake>['sel'];
	readonly tab: string;
	readonly typing: (fromSearch: boolean) => boolean;
}

export const wsOrgKeysMake = (d: OrgKeysDeps) => {
const cursorItem = () => (d.orgSel.cursor ? d.itemOf(d.orgSel.cursor) : null);
// THE KEYS WALK THE TABLE. Up and Down step through the note rows the
// table shows, marking the note (the scope is kept); Enter opens it;
// Alt+Up/Down nudge it within its folder through the one order writer.
// An arrow that landed on a folder row and CHANGED THE SCOPE would read
// as the table reshuffling by itself. THE TABLE'S ROWS WHERE THERE IS A
// TABLE; the scope's notes in the one order otherwise, so Export and
// History arrow through the same notes the Organizer would list.
const tableOrder = () => {
	const drawn = Array.from<HTMLElement>(d.panel.querySelectorAll('tr.ws-org-row:not(.is-folder)[data-path]'))
		.map((r) => r.getAttribute('data-path')).filter(Boolean);
	if (drawn.length) return drawn;
	try { return d.plugin.exportGather(d.exportScope()).map((f) => f.path); }
	catch (e) { wsGuardReport('the Organizer listing the notes the arrows walk', e); return []; }
};
const moveCursor = (by: number) => {
	const order = tableOrder();
	if (!order.length) return;
	const here = d.orgSel.cursor ? (d.itemOf(d.orgSel.cursor) || {}).path : (d.orgNote || null);
	const at = here ? order.indexOf(here) : -1;
	const next = Math.max(0, Math.min(order.length - 1, at + by));
	const it = { kind: 'file', path: String(order[at === -1 ? 0 : next] || '') };
	d.orgSel.cursor = d.keyOf(it);
	d.orgSel.cursorDrives = true;
	d.orgFollow(it, true, true);
	d.drawPanel();
	const el = d.panel.querySelector('tr.ws-org-row.ws-org-active');
	if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
};
const key = (combo: [Modifier[], string], fn: (() => void) | (() => Promise<void>), fromSearch?: boolean) => d.host.key(combo[0], combo[1], (ev: Event) => {
	if (d.typing(!!fromSearch)) return;
	void fn();
	ev.preventDefault();
	return false;
});
key([[], 'ArrowDown'], () => moveCursor(1), true);
key([[], 'ArrowUp'], () => moveCursor(-1), true);
const nudge = async (by: number) => {
	const it = cursorItem();
	if (!it || !it.path) return;
	const parent = d.folderOf(it.path);
	let sibs: string[] = [];
	try { sibs = d.plugin.treeOrderCurrent(parent) || []; } catch { sibs = []; }
	const at = sibs.indexOf(it.path);
	if (at === -1) return;
	const to = at + by;
	if (to < 0 || to >= sibs.length) return;
	const before = by < 0 ? sibs[to] : (sibs[to + 1] != null ? sibs[to + 1] : null);
	await d.plugin.treeOrderMove(parent, it.path, before);
	d.orgSel.cursor = d.keyOf(it);
	d.orgSel.cursorDrives = true;
	d.drawPanel();
};
key([['Alt'], 'ArrowUp'], () => { void nudge(-1); });
key([['Alt'], 'ArrowDown'], () => { void nudge(1); });
key([[], 'Enter'], () => { const it = cursorItem(); if (it) d.openRow(it); }, true);
// SPACE FLAGS THE ROW, the act this window exists for and the one
// worth a single key.
key([[], ' '], async () => {
	const it = cursorItem();
	if (!it) return;
	// ONLY FILES HAVE FLAGS. This is a place a flag is born that never
	// touches `fileMenuFor`, so the menu's refusal does not reach it.
	// Refused HERE and not in `cursorItem()`, which is shared with the
	// Alt+arrow nudge — a folder must still be reachable by the cursor, it
	// just may not be flagged.
	if (it.kind !== 'file') return;
	const next = wsStatusNext(d.markOf(it.path, it.kind));
	// THROUGH THE ONE WRITER: the journal sees it, the selection gets it,
	// and the store is written in one place.
	await d.orgFlagSet({ path: it.path }, next, null);
});
// ── ESCAPE BACKS OUT ONE STEP AT A TIME ─────────────────────────────
//
// Reported from a vault twice: pressing it left the window entirely,
// and it went on doing so after the first fix.
//
// The ladder, in the order a writer would undo them. A writer pressing
// Escape almost never means "throw all of this away" — they mean "not
// that": not this rename, not this search, not this selection. Closing
// on the first press makes the key too expensive to use, so nobody
// uses it.
const escapeLadder = (ev: KeyboardEvent) => {
	if (ev.key !== 'Escape') return false;
	// ── A RENAME IN PROGRESS IS CANCELLED HERE ──────────────────
	//
	// ── THE ORGANIZER'S OWN RUNGS (spec: Escape clears the lens) ──
	// Then, on a phone, it backs out of the right pane; then the
	// modal rule below applies as everywhere else.
	if (d.tab === 'organizer') {
		// A field being edited restores FIRST — the editor's own
		// Escape, held for this ladder, because the capture listener
		// reaches the key before the input ever would.
		if (d.orgProps.orgFieldEscape) {
			const f2 = d.orgProps.orgFieldEscape;
			d.orgProps.orgFieldEscape = null;
			try { f2(); } catch (_) { wsCatch('openManuscriptModal / escapeLadder: f2();', _); }
			return true;
		}
		// THE PROPERTIES PANEL CLOSES FIRST, because it is the topmost
		// thing on screen and Escape means the topmost thing. The panel
		// carries its own capture listener as well, for the case this
		// ladder refuses: it hangs on the body, so a keystroke typed
		// into its search box did not start inside `host` at all.
		if (d.orgPropPopEl()) { d.orgPropPopClose(); return true; }
		if (d.orgLensOn()) { d.orgLensClear(); return true; }
		// The TREE search clears next — through the one writer, so the terms
		// go with the text.
		if (d.host.closes === false) return true;
		return false;
	}
	if (d.sel.size || d.orgSel.cursorDrives) {
		d.sel.clear();
		d.orgSel.lastPicked = null;
		// …and the cursor stops speaking for the window too. Escape
		// here means "never mind, show me everything", and clearing a
		// selection only to land on whichever row the cursor happened
		// to be resting against would be a different note's report
		// arriving unasked.
		d.orgSel.cursorDrives = false;
		d.draw();
		d.drawPanel();
		return true;
	}
	// ── NOTHING LEFT TO BACK OUT OF ─────────────────────────────
	//
	// In a MODAL the key is handed back and the window closes, which
	// is what Escape means everywhere else in the app.
	//
	// IN A PANE IT MEANS NOTHING. A docked Outliner sitting beside a
	// note must not vanish because the writer pressed Escape — they
	// are as likely to have meant it for the editor, and a pane that
	// closed itself would take a workspace arrangement with it. The
	// rungs above still apply: the search clears, the selection
	// clears, and then the key stops here.
	//
	// The HOST says which it is. A window does not know what it is
	// living in and should not have to ask.
	if (d.host.closes === false) return true;
	return false;
};
// ── AND IT LISTENS ON THE WINDOW, NOT ON THE CONTAINER ──────────────
//
// Nothing can precede it except another window-capture listener
// registered earlier, and this one is registered when the window
// opens rather than when the app boots.
//
// SCOPED TO THIS MODAL, two ways, because a global listener that is
// not scoped is a key stolen from the whole application:
//   · the event must have started INSIDE our container, so a confirm
//     dialog stacked on top of the Outliner keeps its own Escape —
//     its container is a sibling of ours, not a child;
//   · and it comes off in `onClose`, so a window that has been shut
//     is not still eating Escape for the rest of the session.
const onEscape = (ev: Event) => {
	// ASKED OF THE HOST, not of a modal. A leaf-backed host answers the
	// same question about its own element, and the ladder does not have to
	// learn a second shape to work in a pane.
	//
	// ── AND THE PROPERTIES PANEL COUNTS AS INSIDE ───────────────────
	//
	// The scope test exists so a dialog stacked on top keeps its own Escape
	// — its container is a SIBLING of ours, not a child. The panel lives
	// inside `rootEl`, so `host.contains` answers yes on its own; THE NAMED
	// TEST STAYS, because `contains` is the host seam's question, a leaf
	// answers it about a different element than a modal does, and a panel
	// that has to be reachable by Escape is not something to leave resting
	// on which root a future host picks.
	const pop0 = (d.tab === 'organizer') ? d.orgPropPopEl() : null;
	const sub0 = (d.tab === 'organizer') ? d.orgPropSubEl() : null;
	const hit = wsNodeOf(ev.target);
	if (!d.host.contains(hit)
		&& !(pop0 && pop0.contains(hit))
		&& !(sub0 && sub0.contains(hit))) return;
	if (!escapeLadder(ev as KeyboardEvent)) return;
	ev.preventDefault();
	ev.stopPropagation();
	// BOTH stops. `stopPropagation` holds the event inside this
	// container; `stopImmediatePropagation` also holds it back
	// from another listener on the container itself, which is what
	// a capture-phase guard is for.
	if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
};
// ── THE RENAME KEEPS THE WINDOW OPEN, WHOEVER HEARD THE KEY ─────────
//
// The ladder is the right shape and runs when it gets the chance — but
// it can lose the race for the key, and a writer does not care which
// listener was first. So the window refuses: `close()` is the one door
// every route out goes through, whatever fired it, and while a name is
// being typed into, the answer is no — and the rename is cancelled on
// the way, so the press still does what a writer meant by it. ONE
// PRESS, ONE UNDO: the second Escape finds no rename running and the
// window closes normally.
//
// ── AND THE PROPERTIES PANEL IS THE SAME SHAPE ─────────────────
//
// A capture listener of the panel's own and a wider scope test both
// lose the same race; `blockClose` is the answer: STOP RACING FOR THE
// EVENT AND GUARD THE EFFECT. TOPMOST FIRST, so the panel is answered
// before the rename — a panel open over a half-typed name is on top of
// it. THE × STILL CLOSES THE WINDOW IN ONE CLICK, and that is not luck:
// a press on it is a `mousedown` OUTSIDE the panel first, which the
// panel's own dismiss hears, so by the time `close()` runs there is no
// panel left to refuse for. Escape has no mousedown, which is exactly
// the case this rung is for.
if (d.host.blockClose) {
	d.host.blockClose(() => {
		// THE SUBMENU IS ABOVE THE PANEL, so it backs out first: a writer
		// with a type list open who presses Escape means the list, not the
		// panel under it.
		if (d.tab === 'organizer' && d.orgPropSubEl()) {
			d.orgPropSubClose();
			return true;
		}
		if (d.tab === 'organizer' && d.orgPropPopEl()) {
			d.orgPropPopClose();
			return true;
		}
		// AND A FIELD BEING EDITED REFUSES THE CLOSE: the row rename and a
		// goal cell mid-edit are the same case — a window that throws away a
		// half-typed name on one keystroke. `orgFieldEscape` IS the editor's
		// cancel, held for exactly this.
		if (d.tab === 'organizer' && d.orgProps.orgFieldEscape) {
			const f2 = d.orgProps.orgFieldEscape;
			d.orgProps.orgFieldEscape = null;
			try { f2(); } catch (_) { wsCatch('openManuscriptModal / blockClose: f2();', _); }
			return true;
		}
		return false;
	});
}

// UNDO AND REDO KEYS: Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y (Cmd on a Mac)
// while the pane has the key — not while a field inside it does, whose
// own undo is the browser's, and not from another pane.
	return { onEscape };
};
