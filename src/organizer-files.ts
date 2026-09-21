// Word-Smith — organizer-files: which of the vault's files this window is
// about, and what each one is called.

import type WordSmith from './plugin';
import type { wsOrgSelMake } from './organizer-sel';

// ════════════════════════════════════════════════════════════════════════
// THE FILES — which of the vault's files this window is about, and what
// each one is called
// ════════════════════════════════════════════════════════════════════════
//
// `allFiles` (EVERY file, not every markdown file — the tree draws what
// is there — with the order stores kept out), `folderOf`, `nameOf` (the
// name a row shows, which is the base name and not the path),
// `keptFiles` / `liveFiles` (what survives the shape, the kinds and the
// lens), `orgDrawnSig` (what the last draw drew, so a redraw that would
// change nothing is skipped) and `orgCellHint` (the cell a repaint should
// land on).
//
// WHAT IT READS, through `d`: the selection (`d.orgSel`, `d.keyOf`) and
// `d.plugin` — the vault, the index and the settings.
//
// TWO `let`s ARE LIVE — `orgDrawnSig` and `orgCellHint`, both read and
// set by the table's context — so they come back as getters and setters
// and the window reads them as `orgFiles.<name>`.
//
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgFilesMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (2 of 3).
export interface OrgFilesDeps {
	plugin: WordSmith;
	readonly keyOf: (it: { path: string; kind: string; }) => string;
	readonly orgSel: ReturnType<typeof wsOrgSelMake>;
}

export const wsOrgFilesMake = (d: OrgFilesDeps) => {
// WHERE WORD-SMITH APPLIES IS STILL A SETTING, and it still governs
// what gets counted, compiled and reported on. It simply does not
// govern this window's tree any more.
//
// The store files stay out: an order file inside a chapter folder
// would be counted, targeted and flagged like a scene.
const allFiles = () => {
	try {
		// EVERY file, not every markdown file — the tree draws what
		// exists and the TYPE FILTER says which kinds survive. The
		// default set is 'md' alone, so a vault that has never
		// touched the menu gets byte-for-byte the list this used to
		// return. `getFiles` is not on the stubbed vaults the probes
		// drive, so the markdown list stands in where it is absent —
		// under a stub the type filter has nothing to add anyway.
		const v = d.plugin.app.vault;
		const raw = (v.getFiles ? v.getFiles() : v.getMarkdownFiles()) || [];
		// ── THE PLUGIN'S OWN FILES ARE STILL FILES ──────────────────────
		//
		// `isFileCounted` keeps the stores out of every TOTAL — "a record of
		// the writing should not record itself being kept" — and that is a
		// different question from whether they are in the LIST OF FILES IN THE
		// VAULT: one predicate answering both hides `ws-structure.md` and shows
		// `ws-settings.md` with no rule a writer could infer between them. WHAT
		// DOES NOT COME BACK IS THE DRAG: see `orgRowDrag`, where a store row is
		// refused. A row that reorders the file the order is stored in is a row
		// that writes itself.
		return raw
			.filter(f => d.plugin.uniTypeAllows(f));
	} catch { return []; }
};
const folderOf = (path: string) => {
	const cut = String(path).lastIndexOf('/');
	return cut === -1 ? '' : path.slice(0, cut);
};
const nameOf = (path: string) => (path === '' ? 'Vault root'
	: (String(path).split('/').pop() || '').replace(/\.md$/, ''));

// THE CURSOR GOES TO THE NOTE IN HAND, on a first opening only. The
// window opens on the whole vault with NOTHING SELECTED — that is the
// decision, and it is what makes the inspector useful before the first
// click. But arriving at a four-hundred-note vault with no idea where
// you are standing is a wall, so the chapter the writer is actually in
// is unfolded and cursored. Shown, not chosen: the inspector still
// answers for the vault until they pick something. AND IT DEFERS TO
// WHAT THE WRITER LEFT: a guess is the right answer only when there is
// no answer — once somebody has folded something themselves, that is
// what the window is for remembering.
{
	const here = d.plugin.activeNoteFile && d.plugin.activeNoteFile();
	if (here && here.path) d.orgSel.cursor = d.keyOf({ path: here.path, kind: 'file' });
}

// ── THE LIST BEFORE THE PRUNE, WHICH IS A SEPARATE QUESTION ─────────
//
// "Which files survive the filters" and "which of those have anything
// in the sorted column" are two stages, and they have to stay two:
// `sortingProp` sniffs a property's TYPE over the files on screen, and
// pointing it at the pruned list made a cycle — prune asks `sortText`,
// `sortText` asks `sortingProp`, `sortingProp` asks for the list, which
// prunes. It recursed until the stack went, and the probe reported it
// as an unhandled exception with two siblings missing from a tree.
//
// AND THE SNIFF IS BETTER OFF HERE ANYWAY. A type worked out from only
// the rows that survived a prune that DEPENDS on that type is circular
// reasoning even where it terminates: the question "is this column
// dates or text" is about every value present, not about the ones a
// previous answer kept.
const keptFiles = () => allFiles().map(f => f.path);
// EVERY KEPT FILE IS A LIVE FILE. The prune above it is gone, so
// this is the identity it has always computed.
const liveFiles = () => keptFiles();

// A search OPENS what it finds — once, by unfolding the ancestors of
// each match and then getting out of the way. Overriding the fold
// state on every draw is what made the board's chevrons look dead
// while anything was typed: they toggled a set the draw ignored.

// WHERE A FOLDER'S CHILDREN STAND, when the tree is in manuscript
// order. Read once per draw per folder rather than per comparison:
// a sort is O(n log n) comparisons and this is a map lookup either
// way, but building it inside the comparator would rebuild it for
// every one of them.
// ── WHAT THE PANE IS CURRENTLY SHOWING ───────────────────────────
//
// The paths of the drawn rows, in order. A redraw compares the list it
// has just computed against this: identical means nothing moved or
// vanished, and a one-cell change can be painted as one cell. `null`
// MEANS NOTHING HAS BEEN DRAWN YET, which is not the same as an empty
// pane — an empty table has an empty signature, and taking the fast
// path against a pane that was never built would repaint a cell that is
// not there.
let orgDrawnSig: string | null = null;
// The row a one-cell change is about, set by the writer that made it
// and consumed by the next draw. Cleared as it is read, so a hint
// cannot survive into a later draw that is about something else.
let orgCellHint: { td: HTMLElement; path: string } | null = null;
// ── WHICH FILES A ROW GOVERNS, ONCE PER DRAW ─────────────────────
//
// Asked PER ROW the expensive way — `exportFiles().map(f => f.path)
// .filter(under)` — one draw of the Export tree is ROWS × FILES, three
// times over, and doubling the manuscript is four times the work. ONE
// WALK: each file adds itself to every folder above it, and the row
// looks its answer up. Same lists, same order — the writer's order,
// which is why this pushes in gather order rather than sorting — and
// the same shape as `rankFor` above it: born empty at the top of
// `draw`, so it can never answer about a vault that has changed since.
// THE PER-DRAW INDEX of what each row governs is the ticks module's:
// its `index()` builds on the first row that asks, its `dropIndex()` is
// the one door that drops it, and the panel draw calls that.
	return { folderOf, nameOf, liveFiles, get orgDrawnSig() { return orgDrawnSig; }, set orgDrawnSig(v) { orgDrawnSig = v; }, get orgCellHint() { return orgCellHint; }, set orgCellHint(v) { orgCellHint = v; } };
};
