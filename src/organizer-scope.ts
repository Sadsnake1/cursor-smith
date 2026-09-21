// Word-Smith — organizer-scope: what the window is pointed at, and what a
// click does to it.

import type WordSmith from './plugin';
import type { wsOrgSelMake } from './organizer-sel';
import type { WordSmithSettings } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE SCOPE — what the window is pointed at, and what a click does to it
// ════════════════════════════════════════════════════════════════════════
//
// `orgSelect` (the ONE writer of `organizerFolder` — a folder chosen,
// saved, drawn), `orgNote` (the note the pane holds), `orgMark` (which
// row wears the mark), `orgFolderHolds` / `orgScopeHolds`, `orgFollow` (a
// click on a note row: the scope stays where it already holds the note
// and moves to the note's folder when it does not — view state, no
// store), and `showItem`.
//
// WHAT IT READS, through `d`: the folder and its guards (`d.orgFolder`,
// `d.orgFolderOk`, `d.orgFolderSet`, `d.folderOf`), the selection
// (`d.orgSel`, `d.keyOf`), the settings (`d.s`), the draw (`d.draw`,
// `d.drawPanel`) and `d.plugin`.
//
// TWO `let`s ARE LIVE — `orgNote` (read by the tabs, the subject line and
// the keys) and `orgDrawTimer` (the index's debounce) — so they come back
// as getters and setters and the window reads them as `orgScope.<name>`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgScopeMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (6 of 11).
export interface OrgScopeDeps {
	plugin: WordSmith;
	readonly draw: () => void;
	readonly drawPanel: () => void;
	readonly folderOf: (path: string) => string;
	readonly keyOf: (it: { path: string; kind: string; }) => string;
	readonly orgFolder: string;
	readonly orgFolderOk: (p: string) => boolean;
	readonly orgFolderSet: (v: string) => string;
	readonly orgSel: ReturnType<typeof wsOrgSelMake>;
	readonly s: WordSmithSettings;
}

export const wsOrgScopeMake = (d: OrgScopeDeps) => {
// ── AND THE NARROW WINDOW'S ONE DOOR SWINGS BOTH WAYS ───────────
//
// In the narrow layout the back button is a TOGGLE, meaningful in both
// states, and the GLYPH has to carry it — a phone has no hover, so a
// `title` nobody can read is not the door. `is-panel` gets one writer
// while it is being touched: the label is a second fact about the same
// state, and a fifth place setting the class beside four others is the
// drift this window keeps removing.
const orgSelect = (p: string) => {
	d.orgFolderSet(p);
	// ── AND THE NOTE MARK CANNOT OUTLIVE ITS FOLDER ──────────────────
	//
	// A folder chosen that does not hold the marked note drops the mark:
	// two marks that agree are one selection seen at two depths; two that
	// disagree are two selections. Of the writers of `orgFolder` this is
	// the only one that moves one half of the pair — the initial read has
	// no mark to orphan, and `orgFollow` sets both together in either
	// branch.
	if (orgNote && !orgFolderHolds(d.orgFolder, orgNote)) orgNote = '';
	d.s.organizerFolder = d.orgFolder;
	d.plugin.saveSettings().catch(() => {});
	// One pane at a time when there is only room for one: choosing a
	// folder IS the move to the right pane, and the back button is the
	// way home — same grammar as the old tabs' narrow layout.
	d.draw();
	d.drawPanel();
};
// ── SELECTION FOLLOWS THE NOTE ─────────────────────────────────
// `orgNote` is the marked note — accent in the tree AND the table — and
// `orgFollow` is its one writer: the cursor keys feed it, and the
// open-time active-file follow feeds it. It is VIEW state (not saved):
// the persisted folder stays `orgSelect`'s.
let orgNote = '';
// WHICH OF THE TWO THE TREE MARKS: one thing, the last thing chosen —
// two marks in the tree are confusing. View state, like orgNote: the
// STORE keeps the folder and the note both, because the pane needs the
// folder to know what it shows.
//
// ── …AND `keepScope` IS HOW IT STOPS OVERRULING A CHOICE ─────
//
// A remembered folder that is READ at open and then thrown away by the
// follow a few lines later is worse than not storing it — the writer's
// choice is on disk, being ignored. `keepScope` moves the scope only
// when the folder being held does not already CONTAIN the note — so a
// writer mid-scene inside their chosen scope keeps the scope and still
// gets the scene marked, and a writer editing something outside it is
// followed. ONLY THE OPEN PASSES IT: the cursor keys call this with no
// flag, because arrowing onto a note in another folder is a writer
// ASKING to be taken there.
//
// WHOLE SEGMENTS, so a folder named `Book` does not claim a note under
// `Bookshelf`. One reader, because two places asking "is this note
// inside the scope" is two chances to answer it differently. AN EMPTY
// SCOPE HOLDS NOTHING, here: it is the whole vault, so it contains every
// note in the ordinary sense — but this reader answers ONE question,
// "may the follow leave the scope alone", and the answer for a pane
// with no folder chosen is no: that is exactly when the open-time
// follow should take it to the active note.
//
// ── AND THE CONTAINMENT ITSELF HAS ONE READER ────────────
//
// `orgSelect` needs the same question asked of a DIFFERENT folder — the
// one being chosen — so the test is lifted out rather than typed a
// second time. THE EMPTY-FOLDER POLICY STAYS AT THE CALLER, because the
// two callers genuinely disagree about it and that disagreement is
// correct: plain containment says the whole vault holds every note;
// `orgScopeHolds` then refuses the empty scope on purpose, and
// `orgSelect` wants the plain answer. Folding either policy into this
// reader would give one of them the other's behaviour.
const orgFolderHolds = (folder: string, path: string) => !folder
	|| String(path).indexOf(String(folder) + '/') === 0;
const orgScopeHolds = (path: string) => !!d.orgFolder
	&& orgFolderHolds(d.orgFolder, path)
	&& d.orgFolderOk(d.orgFolder);
const orgFollow = (it: { path: string; kind: string }, keepScope: boolean, markOnly?: boolean) => {
	if (!it || !it.path) return;
	if (it.kind === 'folder') {
		orgNote = '';
		d.orgFolderSet(it.path);
	} else {
		orgNote = it.path;
		// The held scope already covers this note: mark it and leave the
		// scope alone. AND THE WHOLE VAULT HOLDS EVERY NOTE: a guard that is
		// false for the widest case — the empty scope — is the wrong way
		// round. MARK AND NOTHING ELSE for a table row: a click there
		// selects, and the way into a folder is the tree on the left. Checked
		// BEFORE the containment test, because it is not a question about the
		// scope: it holds whatever the scope is, including the empty one.
		if (markOnly) return;
		if (keepScope && orgScopeHolds(it.path)) return;
		const par = d.folderOf(it.path);
		d.orgFolderSet(par);
	}
};
// ── SINGLE CLICK SHOWS, DOUBLE CLICK OPENS ──────────────
//
// History and Export open on a double click; the Organizer's binder row
// and table row do the same. NOTHING NEW IS WRITTEN: `orgFollow` above
// is the ONE writer of which note is marked — the accent in the tree
// and `ws-org-active` in the table are both its doing — and this is the
// same three lines `moveCursor` runs, minus the scroll: a writer who
// just clicked a row does not need it brought into view. AND OPENING
// KEEPS THREE DOORS, so the gesture is not the only way in: double
// click, Enter on the cursor, and Open in the row's right-click menu.
const showItem = (it: { path: string; kind: string }, markOnly?: boolean) => {
	if (!it || !it.path) return;
	d.orgSel.cursor = d.keyOf(it);
	d.orgSel.cursorDrives = true;
	orgFollow(it, false, markOnly);
	d.draw();
	// AT ONCE, NOT ON THE DEBOUNCE. `moveCursor` ends in
	// `schedulePanel()` because a held arrow key would otherwise
	// rebuild the table on every step; a click is one deliberate act
	// and 140ms of nothing after it reads as a dead row.
	d.drawPanel();
};

// The index rings after every write it takes; while the Organizer tab
// is up, that repaints the numbers FROM it — one debounced clock,
// because a paste into a big note lands as several events.
let orgDrawTimer: number | null = null;
	// (orgScopeHolds is out for the pin: the explorer's door asks it)
	return { orgSelect, orgFollow, showItem, orgScopeHolds, get orgNote() { return orgNote; }, set orgNote(v) { orgNote = v; }, get orgDrawTimer() { return orgDrawTimer; }, set orgDrawTimer(v) { orgDrawTimer = v; } };
};
