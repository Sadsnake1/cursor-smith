// Word-Smith — organizer-drag: a row moved within its parent, a file
// dropped into a folder.

import { wsOrgDropBefore } from './org-index';
import { wsCatch } from './preamble';
import type WordSmith from './plugin';

// ════════════════════════════════════════════════════════════════════════
// THE DRAG — a row moved within its parent, a file dropped into a folder
// ════════════════════════════════════════════════════════════════════════
//
// The drag state (`orgDragPath`, `orgDragCol`, `orgLastGrouping`),
// `orgDropMarks` and `orgDropRun` (the one drop executor for mouse and
// finger, aimed by `wsOrgDropBefore` and written by `treeOrderMove`), the
// edge grammar (`ORG_EDGE`, `orgAtEdge`), `orgGroupDrop` (a file dropped
// on a folder row goes through `treeMoveInto`) and `orgRowDrag` (the
// row's own drag handlers, mouse and touch).
//
// WHAT IT READS, through `d`: the panel (`d.panel`, for the rows and the
// marks), the bar (`d.said`), the names (`d.nameOf`, `d.folderOf`) and
// `d.plugin` for the movers and the order.
//
// TWO OF ITS `let`s ARE LIVE — `orgDragCol` (the header drag) and
// `orgLastGrouping` — read and set by the table context; they come back as
// getters and setters, and the window reads them as `orgDrag.<name>`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgDragMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (4 of 5).
export interface OrgDragDeps {
	plugin: WordSmith;
	readonly folderOf: (path: string) => string;
	readonly nameOf: (path: string) => string;
	readonly panel: HTMLDivElement;
	readonly said: (msg: string, bad?: boolean, offer?: { run: () => unknown; label: string }) => void;
}

export const wsOrgDragMake = (d: OrgDragDeps) => {
// ── TABLE ROW DRAG (Phase 3) — within one parent, no lens ───────────
//
// The affordance is NOT RENDERED under a lens: no draggable
// attribute, no grab cursor, no touch hold — drawOrg simply never
// calls this — so drag-in-sorted-view corruption has no code path to
// live in (spec, "what this design makes structural"). Cross-folder
// moves are the TREE's job; a drop from another parent is refused
// before the writer sees an indicator for it.
//
// One drop executor for mouse and finger: the ONE reorder writer
// (`treeOrderMove`), aimed by the ONE drop arithmetic
// (`wsOrgDropBefore`) — the same pair the tree's touch path uses.
let orgDragPath: string | null = null;
// The table HEADER drag (inbox: draggable columns) — see the th
// handlers in drawOrg; `uniColOrder` is the one store they write.
let orgDragCol: string | null = null;
// Whether the last draw GROUPED — null until a first draw, so the
// opening paint never animates (design brief: the melt marks a
// change, not an arrival).
let orgLastGrouping: boolean | null = null;
// EVERY MARK THIS PANEL CAN PAINT, cleared in one place: a drag
// ABANDONED over a header must not leave a mark lit until the next
// redraw, and a clearer that knows about some of the marks is worse
// than none — it looks like the marks are handled.
const orgDropMarks = () => {
	for (const el2 of d.panel.querySelectorAll(
		'.ws-drop-above, .ws-drop-below, .ws-drop-into')) {
		el2.removeClass('ws-drop-above');
		el2.removeClass('ws-drop-below');
		el2.removeClass('ws-drop-into');
	}
};
const orgDropRun = async (movedPath: string, ontoPath: string, below: boolean) => {
	if (!movedPath || !ontoPath || movedPath === ontoPath) return;
	if (d.folderOf(movedPath) !== d.folderOf(ontoPath)) return;
	const parent = d.folderOf(movedPath);
	await d.plugin.treeOrderMove(parent, movedPath,
		wsOrgDropBefore(d.plugin.treeOrderCurrent(parent),
			movedPath, ontoPath, below));
};
// ── EDGES REORDER, THE MIDDLE MOVES IN ──────────────────────────
//
// Now that a folder is a ROW, one element carries both gestures:
// dropping ON it means "put this inside", dropping at its top or
// bottom edge means "put this next to it". That is the grammar both
// trees already use, so the table reads the same way.
//
// 0.2 IS NOT A NEW NUMBER. The tree records it being wrong at 0.28
// and at 0.3 before it settled here; it is read from the tree
// rather than re-derived, and it is named ONCE so the two handlers
// below cannot drift into disagreeing about where an edge ends.
const ORG_EDGE = 0.2;
const orgAtEdge = (el: HTMLElement, ev: MouseEvent) => {
	const r = el.getBoundingClientRect();
	if (!r.height) return true;
	const at = (ev.clientY - r.top) / r.height;
	return at <= ORG_EDGE || at >= 1 - ORG_EDGE;
};
// ── A FILE MOVES BETWEEN FOLDERS, FROM THE TABLE ──────────────────
//
// The target is the GROUP HEADER, which is a thing to aim at because it
// carries a folder glyph rather than being a colspan banner.
//
// THROUGH `treeMoveInto`, the tree's own mover: it rewrites every
// link that pointed at the note, writes the order in BOTH folders,
// and returns a reason when it refuses. A second implementation of
// "a file moved" is the one thing this window must not grow — the
// cost of getting it wrong is a file the writer cannot find.
//
// ONLY WHERE THE BOOK'S ORDER IS SHOWING. Group headers are built
// only when `!lensed`, so a filtered table has nothing to drop onto
// — which is what the writer asked for ("dont make available the
// drag when the view is filtered") and is already the rule for row
// drag. The affordance is absent, not guarded.
const orgGroupDrop = (g: HTMLElement, parentPath: string) => {
	g.addEventListener('dragover', (ev: DragEvent) => {
		orgDropMarks();
		if (!orgDragPath) return;
		// A file cannot move to where it already is: its own
		// header offers nothing, so the gesture says "no" by not
		// lighting up rather than by refusing after the drop.
		if (d.folderOf(orgDragPath) === parentPath) return;
		// THE MIDDLE ONLY: the edges belong to the reorder gesture on
		// the same row. Without this the two fight, and the writer
		// gets an into-highlight while aiming between two rows.
		if (orgAtEdge(g, ev)) return;
		ev.preventDefault();
		g.addClass('ws-drop-into');
		try { if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; } catch (_) { wsCatch('openManuscriptModal / orgGroupDrop: ev.dataTransfer.dropEffect = \'move\';', _); }
	});
	g.addEventListener('dragleave', () => g.removeClass('ws-drop-into'));
	g.addEventListener('drop', (ev: DragEvent) => { void (async () => {
		// …and the mirror of it: the edges are the reorder's, so
		// this hand-off happens before the drag state is touched.
		if (orgAtEdge(g, ev)) return;
		const moved = orgDragPath;
		orgDropMarks();
		g.removeClass('ws-drop-into');
		orgDragPath = null;
		if (!moved || d.folderOf(moved) === parentPath) return;
		ev.preventDefault();
		const done = await d.plugin.treeMoveInto(moved, parentPath);
		// SAID EITHER WAY, exactly as the tree says it: a refusal
		// names its reason, a move names where it went. The foot
		// stands up only while there is something to say (263).
		if (done && !done.ok && done.said) d.said(done.said, true);
		else if (done && done.ok) {
			d.said('Moved “' + d.nameOf(moved) + '” into '
				+ (parentPath ? d.nameOf(parentPath) : 'the vault root')
				+ '.', false);
		}
	})(); });
};
const orgRowDrag = (tr: HTMLElement, row: { path: string; parent: string; kind: string }) => {
	// ── A STORE FILE IS NOT DRAGGED ───────────────────────────
	//
	// The plugin's own files are LISTED (`allFiles` carries the reasoning),
	// but they are not part of anybody's book and they must not be arranged.
	//
	// Dragging a row writes the new order into `ws-structure.md`.
	// So a draggable row FOR `ws-structure.md` writes itself into
	// its own order file — and `78-file-tree-order.js` refuses
	// store files when it reads that order back, so the write would
	// be dropped on the next read. A gesture that appears to work,
	// saves something, and has no effect is worse than no gesture:
	// this window has removed three of them for exactly that.
	//
	// REFUSED HERE, WHERE A ROW IS BORN DRAGGABLE, rather than by
	// filtering the shared list this row came from — the list is
	// read by the tree, the table, the counts and the export, and
	// four features would pay for one refusal.
	if (d.plugin.isStoreFile && d.plugin.isStoreFile(row.path)) return;
	tr.setAttribute('draggable', 'true');
	tr.addClass('is-draggable');
	tr.addEventListener('dragstart', (ev: DragEvent) => {
		orgDragPath = row.path;
		tr.addClass('is-dragging');
		try { if (ev.dataTransfer) ev.dataTransfer.setData('text/plain', row.path); } catch (_) { wsCatch('openManuscriptModal / orgRowDrag: ev.dataTransfer.setData(\'text/plain\', row.path);', _); }
	});
	tr.addEventListener('dragover', (ev: DragEvent) => {
		orgDropMarks();
		if (!orgDragPath || orgDragPath === row.path) return;
		if (d.folderOf(orgDragPath) !== row.parent) return;
		// …and a folder's MIDDLE belongs to move-into, which is bound
		// to the same row. Edges only, there.
		if (row.kind === 'folder' && !orgAtEdge(tr, ev)) return;
		ev.preventDefault();
		const r = tr.getBoundingClientRect();
		const below = (ev.clientY - r.top) > r.height / 2;
		tr.addClass(below ? 'ws-drop-below' : 'ws-drop-above');
		try { if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; } catch (_) { wsCatch('openManuscriptModal / orgRowDrag: ev.dataTransfer.dropEffect = \'move\';', _); }
	});
	tr.addEventListener('drop', (ev: MouseEvent) => { void (async () => {
		// WHOSE BAND IS THIS? Asked FIRST, and that ordering is the
		// whole of it: a folder row carries this handler AND the
		// move-into one, on the same element. Both used to read
		// `orgDragPath` and null it straight away, so whichever was
		// registered first consumed the drag and the other saw
		// nothing - a drop in the middle of a folder did no reorder
		// and no move either. Caught by the probe, not by looking.
		if (row.kind === 'folder' && !orgAtEdge(tr, ev)) return;
		const moved = orgDragPath;
		orgDropMarks();
		orgDragPath = null;
		if (!moved || d.folderOf(moved) !== row.parent) return;
		ev.preventDefault();
		const r = tr.getBoundingClientRect();
		await orgDropRun(moved, row.path,
			(ev.clientY - r.top) > r.height / 2);
	})(); });
	tr.addEventListener('dragend', () => {
		orgDragPath = null;
		orgDropMarks();
		tr.removeClass('is-dragging');
	});
	// The same move with a finger — the shared long-press helper the
	// tree rows already use, aimed at the same two writers.
	d.plugin.touchDrag(tr, row.path, {
		rows: () => Array.from<HTMLElement>(d.panel.querySelectorAll(
			'.ws-org-row[data-path]')),
		idOf: (el2: HTMLElement) => el2.getAttribute('data-path'),
		drop: (from: string, to: string, below: boolean) => { void orgDropRun(from, to, below); }
	});
};
	return { orgGroupDrop, orgRowDrag, get orgDragCol() { return orgDragCol; }, set orgDragCol(v) { orgDragCol = v; }, get orgLastGrouping() { return orgLastGrouping; }, set orgLastGrouping(v) { orgLastGrouping = v; } };
};
