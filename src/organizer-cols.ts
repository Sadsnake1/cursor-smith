// Word-Smith — organizer-cols: the built-in columns, the writer's own, the
// sorts, adding one.

import { Menu, Notice } from 'obsidian';
import type { WsSession } from './preamble';
import { WsPropItem, WsPropSuggestModal, wsCatch, wsMenu, wsSessionLens } from './preamble';
import type WordSmith from './plugin';
import type { wsOrgLensMake } from './organizer-lens';
import type { WordSmithSettings } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE COLUMNS — the built-ins, the writer's own, the sorts, adding one
// ════════════════════════════════════════════════════════════════════════
//
// `colDefs` (the built-in columns and the property columns the settings
// name), `COLS` and `setCols` (the list as drawn, rebuilt when a
// property is added or removed), `colOff` / `colRank` / `colSort`, the
// sorts (`BUILTIN_SORTS`, `sortDefs`, `SORTS`, `rebuildCols`),
// `propKeysInScope` and `pruneUserCols`, and the way a property becomes
// a column: `addProp`, `PROP_TYPES`, `setPropType`, `askPropType`,
// `nameNewProp`, `addNewProp`, `ORG_PROP_DOORS`, `pickProp`.
//
// WHAT IT READS, through `d`: the settings (`d.s`), the session
// (`d.ses`), the lens (`d.orgLens`, which it also sets once, restoring a
// remembered one), the draw (`d.draw`, `d.fill`, `d.drawPanel`,
// `d.liveFiles`) and `d.plugin`.
//
// TWO OF ITS `let`s ARE LIVE — `COLS` and `SORTS` — reassigned by
// `rebuildCols` and read by every draw; they come back as getters, and
// the window (and the modules the window hands them to) read them as
// `orgCols.COLS` / `orgCols.SORTS`.
//
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgColsMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (3 of 8).
export interface OrgColsDeps {
	plugin: WordSmith;
	readonly draw: () => void;
	readonly drawPanel: () => void;
	readonly fill: () => Promise<void>;
	readonly liveFiles: () => string[];
	orgLens: ReturnType<typeof wsOrgLensMake>['orgLens'];
	readonly s: WordSmithSettings;
	readonly ses: WsSession;
}

// A COLUMN OF THE TABLE: a built-in reading by id, or (`user`) a property
// the writer added — its frontmatter `key`, how it sorts (`sortAs`: empty
// for "work it out", or number/date/text). `def`/`min` are widths.
export interface WsOrgCol { id: string; label: string; def: number; min: number; user?: boolean; key?: string; sortAs?: string }
export const wsOrgColsMake = (d: OrgColsDeps) => {
// ONE CONTROL FOR THE TARGET AND THE PROGRESS, because they are one
// fact. Two columns asked "how far along?" and "how far to go?"
// separately and a writer read them together every time: 31% means
// nothing without the 4,000 beside it, and the 4,000 is only
// interesting because of the 31%. So the pill IS the box — it fills
// to where you are, says both figures, opens for typing when clicked,
// and carries the × that clears it.
//
// GRADE IS OFF BY DEFAULT: a reading wanted occasionally and paid for
// on every row. One press away in the readings menu.
// ── THE COLUMN LIST IS REBUILT, NOT FIXED AT OPENING ────────────────
//
// It was `const COLS = [...]`, computed once when the window opened.
// The built-ins never change, so that was right for as long as they
// were all there was — and WRONG the moment a writer could add one.
// Adding a property wrote it to the settings, saved, and redrew a band
// built from a list that still had no such column in it: nothing
// appeared, and nothing said why. Reported from a vault as "the column
// does not appear", and it was not the menu, the settings or the
// metadata cache. Removing one had the mirror fault — the column stayed
// until the window was closed and opened again.
//
// FOUND BY DRIVING IT. The remove path read correctly in the source and
// its assertion — that the band no longer draws the column — was the
// one thing the source could not tell me.
const colDefs = (): WsOrgCol[] => [
	{ id: 'goal',  label: 'Target', def: 116, min: 78 },
	{ id: 'words', label: 'Words',  def: 66, min: 44 },
	// IT WAS NAMED IN EIGHT PLACES HERE: this definition, the raw
	// reader, the signed formatter, the signed aggregate, the
	// Properties menu’s Progress group, the default off-list, the
	// sort-relevance order and `BUILTIN_SORTS`. A column is named in
	// more places than it looks.
	{ id: 'grade', label: 'Grade',  def: 50, min: 34 },
	// WIDE ENOUGH FOR THE WORD, not just the glyph: "Needs revision"
	// on a hover is a state you go looking for; beside the flag it is
	// a state you read straight down the column.
	{ id: 'mark',  label: 'Flag',   def: 104, min: 30 },
	// ── The readings that wait to be asked for ───────────────────
	//
	// Each answers a question a writer has SOMETIMES, which is the
	// test for being down here rather than on by default: what have
	// I touched lately, how many pieces is this in.
	//
	// 'Last modified', not 'Modified' — the
	// Sort menu has called it that for months and the column
	// disagreed; and beside a Created column, "Modified" alone
	// reads as a state rather than a time. Both are WIDER now:
	// they carry the hour as well as the day.
	{ id: 'modified', label: 'Last modified', def: 132, min: 96 },
	// WHEN IT WAS STARTED. Off by default like every column down
	// here — it answers a question a writer has sometimes.
	{ id: 'created',  label: 'Created',  def: 132, min: 96 },
	{ id: 'paras',    label: 'Paras',    def: 60, min: 42 },
	// TASKS AS A FRACTION, not a count: "3/17" says how much is left
	// and "17" says nothing at all. A folder sums its children, which
	// is where the useful version lives — "Part One: 3/17" tells you
	// which part the work is in.
	{ id: 'tasks',    label: 'Tasks',    def: 62, min: 44 },
	// TAGS AS A COUNT, with the list on the hover. Six tags rendered
	// small is six unreadable words in a column that then decides how
	// wide every row is; the count answers "is this tagged, and about
	// how much" and the hover answers the rest.
	{ id: 'tags',     label: 'Tags',     def: 62, min: 44 },
	// ── TWO MORE READINGS ────────────────────────────────────────
	//
	// IN PROPERTIES: both are down here with the readings that wait to be
	// asked for, and both are in the fresh-vault off-list. A vault that
	// has already shaped that list gets them ON (the `created` precedent).
	{ id: 'read',     label: 'Read time', def: 84, min: 56 },
	{ id: 'ftype',    label: 'Type',     def: 62, min: 40 },
	// ── WHO POINTS HERE ──────────────────────────────────────────
	//
	// WIDER THAN THE REST, because it holds names and there are usually
	// several. It still ellipsises at that width and the hover carries the
	// full list, the way every other cell does.
	{ id: 'backlinks', label: 'Backlinks', def: 170, min: 70 },
	// Outgoing links: the notes this one links to, resolved ones by name
	// and clickable, the unresolved as written. Footnotes: a count.
	{ id: 'outlinks',  label: 'Outgoing links', def: 170, min: 70 },
	{ id: 'footnotes', label: 'Footnotes', def: 80, min: 50 },
	// ── FOUR MORE READINGS ────────────────────────────────────────
	//
	// No pages column: a page is an invented 250-words-a-page convention on
	// a row. LINKS IS A COUNT, NOT A LIST: Backlinks is the list — it
	// answers "who points here", which is a question about other notes and
	// wants their names; "how many does this one point at" is a size. THE
	// CHARACTER COLUMNS ARE TWO COLUMNS because they are two numbers. Wide
	// enough for a six-figure count with its separators.
	{ id: 'chars',     label: 'Chars',     def: 84, min: 56 },
	{ id: 'charsall',  label: 'Chars + spaces', def: 104, min: 60 },
	{ id: 'sentences', label: 'Sentences', def: 84, min: 56 }
].concat(
	// ── AND THE WRITER'S OWN ──────────────────────────────────────
	//
	// Any frontmatter property, added from the columns menu. They come
	// LAST because they were added last, and because the built-ins are the
	// ones every vault has — a column list whose first entry is somebody's
	// `pov` reads as though the plugin invented it. STORED AS A LIST, not a
	// map, because the order is the order they were added and a map has
	// none. `sortAs` is empty for "work it out from the values", or one of
	// number/date/text where the writer has corrected the guess.
	(Array.isArray(d.s.uniUserCols) ? d.s.uniUserCols : [])
		.filter(c => c && c.key)
		.map(c => ({
			id: d.plugin.propColId(c.key),
			key: String(c.key),
			label: String(c.label || c.key),
			sortAs: String(c.sortAs || ''),
			user: true,
			def: Number(c.w) || 90,
			min: 48
		}))
);
// A COLUMN COSTS EVERY ROW IN THE VAULT. A reading wanted once a week
// should not be paid for four hundred times a day, so it starts off
// and is one press away in the readings menu.
if (!Array.isArray(d.s.uniColsOff)) {
	// 'created' starts OFF on a fresh vault (the calm default) — a vault
	// whose writer has already shaped this list gets it ON, which is who
	// asked for the column.
	d.s.uniColsOff = ['grade', 'modified', 'paras', 'tasks',
		'tags', 'created', 'read', 'ftype', 'backlinks', 'outlinks', 'footnotes',
		// A COLUMN COSTS EVERY ROW IN THE VAULT, which is the note a few
		// lines down. Four more readings that wait to be asked for; a
		// vault that has already shaped this list gets them ON, which is
		// the `created` precedent.
		'chars', 'charsall', 'sentences'];
}
let COLS: WsOrgCol[] = colDefs();
// ── AND THE ARRANGEMENT COMES BACK, ONCE ─────────────────────────
//
// HERE AND NOT BESIDE `orgLens`, because a lens is checked against
// what the table HAS and the columns do not exist until this line.
// ONCE, AND THIS IS THE PART THAT WOULD BITE: `COLS` is recomputed
// whenever the column set changes, and re-applying a remembered lens
// there would undo a clear the writer had just made — the memory
// reaching back into the window instead of following it.
{
	// THE SESSION'S FIRST, THE SETTINGS' WHEN THE SESSION HAS NONE: a
	// window closed and reopened keeps what it had; a restart reads what
	// was saved. Both go through the one validator.
	const back = wsSessionLens(d.ses.lens || d.s.uniLens || null, COLS.map(c => c.id),
		COLS.map(c => c.key).filter((k): k is string => !!k));
	if (back) d.orgLens = back;
	// AND THE SETTINGS' COPY, by the same rule as the session's below: a
	// chip whose column is gone must not come back next time either.
	// Written only when the validated lens differs from what is stored — an
	// open with no lens anywhere saves nothing.
	{
		const stored = JSON.stringify(d.s.uniLens || null);
		const now = JSON.stringify(back);
		if (stored !== now) {
			if (back) d.s.uniLens = JSON.parse(now) as Record<string, unknown>;
			else delete d.s.uniLens;
			d.plugin.saveSettings().catch(() => {});
		}
	}
	// THE MEMORY IS CORRECTED TOO, not just the window: a chip whose
	// column is gone must not come back the next time either.
	d.ses.lens = back;
}
// REMEMBERED, and its own key. The board's `goalsCols` were dragged
// against a 980px window; these are a pane's.
// ── HOW WIDE A COLUMN IS: AS WIDE AS WHAT IS IN IT ──────────────────
//
// WHICH COLUMNS ARE ON. Five readings is right for a writer setting
// targets and three too many for one reading a manuscript, and the
// answer changes by the week rather than by the vault — so it is a
// menu on the band rather than a settings pane. Stored as what is
// OFF: a column added next year is on by default, which is the
// answer a writer who has never opened this menu expects.
const colOff = new Set<string>(Array.isArray(d.s.uniColsOff) ? d.s.uniColsOff : []);
// ── THE ORDER THE WRITER READS THEM IN ──────────────────────────────
//
// Which columns matter and in what order is a per-writer question:
// somebody watching a deadline wants Left first, somebody revising
// wants Flag first, and neither wants the order the columns happened
// to be declared in. STORED AS A LIST OF IDS, and applied as a SORT
// rather than as the list itself: a column added in a later version is
// not in a saved order, and a saved order used directly would silently
// drop it. Ones it does not name go on the end, in the order they were
// declared.
const colRank = () => {
	const saved = Array.isArray(d.s.uniColOrder) ? d.s.uniColOrder : [];
	const at = new Map<string, number>();
	saved.forEach((id, i) => { if (!at.has(id)) at.set(id, i); });
	return (c: WsOrgCol) => { const r = at.get(c.id); return r !== undefined ? r : saved.length + COLS.indexOf(c); };
};
const colSort = (list: WsOrgCol[]) => {
	const rank = colRank();
	return list.slice().sort((a, b) => rank(a) - rank(b));
};
// WHICH COLUMNS THE WRITER HAS SWITCHED ON, in the band's order and
// with no opinion about the tab. `shownCols` is this narrowed by what
// the current tab draws; the filter menu wants the wider answer, since
// a question is worth asking whether or not its column is on screen.
const setCols = () => colSort(COLS.filter(c => !colOff.has(c.id)));
// ── ONE TRACK LIST, AND THE BROWSER OWNS THE WIDTHS ────────────────
//
// The name column's width when the writer has dragged one is in `ch`,
// resolved against the ONE element that carries the tracks, so there
// is no second basis for a rounding bug to hide in. ONE TRACK SHAPE FOR
// EVERY READING COLUMN, and the property cap lives on the CELL instead:
// `fit-content(20ch)` shorts under a nested subgrid (a heading whose
// natural width is 67px gets a 21.5px track while its minmax(…,
// max-content) neighbours size correctly). So every column is
// `minmax(7ch, max-content)` and the property cells carry `max-width:
// 20ch` (styles.css), which caps the max-content contribution the
// track actually sees — same cap, same floor, by a door the engine
// gets right. The heading has no max-width: the cap never squeezes the
// heading.

// ── AND THE WRITER'S OWN PROPERTIES ARE SORTS TOO ───────────────────
//
// The id a property sorts under IS its column id; `sortingProp`,
// `propSortAs`, `sortText` and the `sortAs` override sort by a property
// column, and this is the row that offers it. REBUILT WITH THE COLUMNS,
// exactly as `filterDefs` is and for the same reason: a list fixed at
// opening offers a sort by a column that has just been removed, and
// not by one just added.
const sortDefs = () => BUILTIN_SORTS.concat(
	COLS.filter(c => c.user).map(c => ({
		id: c.id, label: c.label, icon: 'tag', prop: true
	})));
const BUILTIN_SORTS = [
	// THE BOOK'S OWN ORDER, and the default. It is the order stored in
	// `ws-export.md`, which is the order Obsidian's file tree draws
	// and the order the manuscript compiles in — one fact, shown in
	// three places. Dragging a row here writes it, so all three move
	// together.
	{ id: 'order',  label: 'Custom sort', icon: 'list-ordered' },
	{ id: 'name',   label: 'Name', icon: 'case-sensitive' },
	{ id: 'words',  label: 'Words', icon: 'file-text' },
	{ id: 'mark',   label: 'Where it is up to', icon: 'flag' },
	{ id: 'grade',  label: 'Reading grade', icon: 'graduation-cap' },
	{ id: 'pct',    label: 'How close to target', icon: 'percent' },
	{ id: 'goal',   label: 'Target', icon: 'target' },
	// NEWEST FIRST when picked, because the question is "what have I
	// touched lately". Oldest-first is a list of what you have
	// abandoned — a real question, and not the one anybody asks by
	// reaching for a sort called Last modified.
	{ id: 'modified', label: 'Last modified', icon: 'clock' },
	{ id: 'paras',    label: 'Paragraphs', icon: 'pilcrow' },
	{ id: 'read',     label: 'Read time',  icon: 'timer' },
	{ id: 'ftype',    label: 'Type',       icon: 'file-type' },
	{ id: 'backlinks', label: 'Backlinks', icon: 'link' },
	{ id: 'outlinks',  label: 'Outgoing links', icon: 'external-link' },
	{ id: 'footnotes', label: 'Footnotes', icon: 'file-signature' },
	{ id: 'chars',     label: 'Chars',     icon: 'case-sensitive' },
	{ id: 'charsall',  label: 'Chars + spaces', icon: 'case-sensitive' },
	{ id: 'sentences', label: 'Sentences', icon: 'pilcrow' },
	{ id: 'tasks',    label: 'Tasks left', icon: 'check-square' },
	// ── THE COLUMNS THAT ARE NOT SORTS IN THEIR OWN RIGHT ───────
	//
	// The menu looks its glyph up HERE by column id, so a column with no
	// entry draws nothing at all. THE LABELS ARE THE COLUMNS' OWN: nothing
	// reads them for the menu row (that takes `col.label`); they are what
	// the bar says after "Sorted by", so they must not disagree with the
	// header.
	{ id: 'created', label: 'Created', icon: 'calendar-plus' },
	{ id: 'tags',    label: 'Tags',    icon: 'tags' }
];
let SORTS = sortDefs();



// THREE LISTS, ONE SOURCE. The columns, the filters and the sorts are
// all derived from the same settings key, so rebuilding two of them
// and not the third is a sort menu that disagrees with the band about
// which columns exist. One call after any change to the writer's own
// columns.
const rebuildCols = () => {
	COLS = colDefs(); SORTS = sortDefs();
};
// ── THE PROPERTY KEYS IN SCOPE, SCANNED ONCE ────────────────────────
//
// OUT OF THE MENU: this scan is reachable from the "Add a
// property…" click and from the header's own button; two copies of a scan
// is two answers to "what properties are there", and the fold-by-case
// rule below is subtle enough that they would not stay the same for long.
const propKeysInScope = () => {
	const seen = new Map<string, { label: string; n: number; spellings: Map<string, number> }>();
	for (const p2 of d.liveFiles()) {
		const f = d.plugin.app.vault.getAbstractFileByPath(p2);
		const cache = f && d.plugin.app.metadataCache
			&& d.plugin.app.metadataCache.getFileCache(f);
		const fm = cache && cache.frontmatter;
		if (!fm) continue;
		for (const k of Object.keys(fm)) {
			// `position` is Obsidian's own bookkeeping rather than the
			// writer's, so it is not a property anybody chose.
			//
			if (k === 'position') continue;
		// ── AND `tags` ALREADY HAS A COLUMN ─────────────────────────
		//
		// A property column for `tags` reads the FRONTMATTER only, while the
		// built-in Tags column merges frontmatter AND inline — so adding it
		// would make a second column with the same label showing a silent
		// subset. Refused here, which is the one place a COLUMN is born; the
		// drawer still offers `tags` as a property to EDIT, because editing
		// frontmatter tags is a real thing to want and a different question.
		if (k === 'tags' || k === 'tag') continue;
			// FOLDED BY CASE, so `date` and `Date` are offered once
			// rather than twice — the column reads either (see
			// `propRaw`), so offering both builds two columns showing
			// one field, which is what a vault reported.
			//
			// The COMMONEST SPELLING is kept as the label: a writer who
			// typed `Date` once and `date` forty times means `date`.
			const low = k.toLowerCase();
			const at = seen.get(low) || { label: k, n: 0, spellings: new Map() };
			at.n += 1;
			at.spellings.set(k, (at.spellings.get(k) || 0) + 1);
			if (at.spellings.get(k) >= (at.spellings.get(at.label) || 0)) {
				at.label = k;
			}
			seen.set(low, at);
		}
	}
	// …AND A COLUMN ALREADY ADDED UNDER EITHER SPELLING COUNTS AS
	// ADDED, or `Date` could be added beside a `date` column showing
	// the same values.
	const already = new Set(COLS.filter(c => c.user)
		.map(c => String(c.key).toLowerCase()));
	return Array.from(seen.entries())
		.filter(([k]) => !already.has(k))
		.sort((a, b) => (b[1].n - a[1].n) || a[0].localeCompare(b[0]))
		.map(([k, v]) => ({
			key: k, label: v.label, n: v.n,
			spellings: v.spellings.size
		}));
};
// ── THE COLUMN GOES WITH THE PROPERTY ─────────────────────────
//
// A user column is kept as long as ANY note in the vault carries its
// key — the index sweeps the whole vault, so the test is not the folder
// on screen. A key held only in the property store (a note that is not
// markdown) counts as carried. Run when the index moves and at open; a
// drop redraws.
const pruneUserCols = () => {
	const ix = d.plugin._orgIndex;
	const list = Array.isArray(d.s.uniUserCols) ? d.s.uniUserCols : [];
	if (!ix || !list.length) return false;
	const have = new Set();
	try {
		for (const r of ix.values()) {
			if (r && r.props) for (const k of Object.keys(r.props)) have.add(String(k).toLowerCase());
		}
		for (const p of d.plugin.propStorePaths()) {
			const props = d.plugin.propStoreAllSync(p);
			if (props) for (const k of Object.keys(props)) have.add(String(k).toLowerCase());
		}
	} catch (_) { wsCatch('pruneUserCols: for (const r of ix.values())', _); return false; }
	// A COLUMN JUST ADDED IS KEPT until a note carries its key — the
	// writer adds the column first and types the values after
	// (`fresh`, set by addProp, cleared here on first use). A column
	// from before this rule has no flag and is treated as once
	// carried, which is the writer's stale one.
	let changed = false;
	const kept = [], gone = [];
	for (const c of list) {
		if (!c) continue;
		const carried = have.has(String(c.key).toLowerCase());
		if (carried) { if (c.fresh) { delete c.fresh; changed = true; } kept.push(c); continue; }
		if (c.fresh) { kept.push(c); continue; }
		gone.push(c); changed = true;
	}
	if (!changed) return false;
	d.s.uniUserCols = kept;
	for (const c of gone) { try { colOff.delete(d.plugin.propColId(c.key)); } catch (_) { wsCatch('pruneUserCols: colOff.delete', _); } }
	d.s.uniColsOff = Array.from(colOff);
	d.plugin.saveSettings().catch(() => {});
	rebuildCols();
	return true;
};
d.plugin._orgPruneUserCols = () => pruneUserCols();
d.plugin._orgColOn = (id, on) => { if (on) colOff.delete(id); else colOff.add(id); d.s.uniColsOff = Array.from(colOff); };
const addProp = async (info: WsPropItem) => {
	const shown = info.label;
	const list = Array.isArray(d.s.uniUserCols) ? d.s.uniUserCols.slice() : [];
	if (list.some(c => c && String(c.key).toLowerCase() === info.key)) return;
	// THE TYPE TRAVELS WITH THE COLUMN. Written only when the writer
	// actually chose one — an absent `type` means "ask the vault", which
	// is what every existing column does and must keep doing.
	const chosen = String((info && info.type) || '');
	list.push(chosen
		? { key: shown, label: shown, sortAs: '', type: chosen, fresh: true }
		: { key: shown, label: shown, sortAs: '', fresh: true });
	d.s.uniUserCols = list;
	// ON IMMEDIATELY. `colOff` stores what is OFF, so a new column
	// needs nothing doing — EXCEPT that a column of this name removed
	// earlier may have left its id in that list, and the writer who
	// has just asked for it back would see nothing appear.
	colOff.delete(d.plugin.propColId(shown));
	d.s.uniColsOff = Array.from(colOff);
	await d.plugin.saveSettings();
	// THE LIST FIRST, THEN EVERYTHING DRAWN FROM IT. Redrawing without
	// this rebuilds the band from a column list that has never heard
	// of the column just added.
	rebuildCols();
	d.draw(); void d.fill(); d.drawPanel();
};
// ── AND THE PICKER, WHICH IS A MODAL WHERE THERE CAN BE ONE ─────────
//
// Falls back to the menu it replaced on an API without
// `FuzzySuggestModal`, and says the same thing when there is nothing
// to add — silence there reads as a broken button.
//
// ── WHAT KIND OF PROPERTY IS THIS ───────────────────────────────
//
// Obsidian's own six, by the widget names its registry answers with —
// so a type chosen here means the same thing to `orgPropType`, to the
// editor that picks a control, and to the store's decode. A seventh
// name of our own would be a second vocabulary for one idea. TEXT FIRST
// AND NAMED, not assumed: it is the commonest answer, and being asked
// and choosing Text is a different act from not being asked.
const PROP_TYPES = [
	{ id: 'text', label: 'Text' },
	{ id: 'multitext', label: 'List' },
	{ id: 'number', label: 'Number' },
	{ id: 'checkbox', label: 'Checkbox' },
	{ id: 'date', label: 'Date' },
	{ id: 'datetime', label: 'Date & time' }
];
// WRITTEN ONTO THE COLUMN THAT ALREADY EXISTS, so there is one
// record of the choice and it disappears with the column. An empty
// answer writes nothing: absent means "ask the vault", which is what
// every column added before today does and must keep doing.
const setPropType = async (key: string, type: string) => {
	const t = String(type || '');
	if (!t) return;
	const k = String(key || '').toLowerCase();
	const list = Array.isArray(d.s.uniUserCols) ? d.s.uniUserCols.slice() : [];
	let hit = false;
	for (const c of list) {
		if (!c || String(c.key).toLowerCase() !== k) continue;
		c.type = t; hit = true; break;
	}
	if (!hit) return;
	d.s.uniUserCols = list;
	await d.plugin.saveSettings();
	// THE CELLS ARE TYPED BY THIS, so the column has to be built
	// again rather than merely repainted: a checkbox column draws a
	// box and a text one draws words.
	rebuildCols();
	d.draw(); void d.fill(); d.drawPanel();
};
const askPropType = (ev2: MouseEvent, done: (type: string) => void) => {
	// A BUILD WITHOUT `Menu` STILL ADDS THE PROPERTY. Refusing to add
	// it because we could not ask would be worse than the silence
	// this replaces — text is what they had before, and they keep it.
	if (!Menu) { done(''); return; }
	try {
		const mm = wsMenu();
		for (const t of PROP_TYPES) {
			mm.addItem((i) => i.setTitle(t.label)
				.onClick(() => done(t.id)));
		}
		if (ev2 && typeof mm.showAtMouseEvent === 'function') {
			mm.showAtMouseEvent(ev2);
		} else if (typeof mm.showAtPosition === 'function') {
			mm.showAtPosition({ x: 200, y: 200 });
		} else { done(''); }
	} catch { done(''); }
};
// ── TWO DOORS, NOT ONE ────────────────────────────────────────
//
// Search what exists, or name a new one. A single button that hides
// the naming door inside a search box makes a writer with an empty
// vault type into a list of nothing to discover it. TYPE FIRST, THEN
// NAME, and that order is safe here: nothing exists until the name is
// typed, and the name is last, so a writer who backs out of either
// step has created nothing, which is what backing out should do.
// NAMING IS ITS OWN STEP, because the type can be chosen two ways —
// the header menu asks with `askPropType`, and the panel's footer row
// opens a submenu of its own. Both end here, so there is ONE naming
// door and neither can drift from the other.
const nameNewProp = (type: string, ev2: MouseEvent) => {
	const taken = propKeysInScope();
	const named = (t2: string) => {
		// THE SAME MODAL, WITH NOTHING TO PICK. Naming a property is
		// one implementation and this is it — the create row is live
		// on every keystroke and already refuses a name the vault
		// uses. `taken` is passed separately so it can refuse keys it
		// does not offer; picking an existing one is the other door.
		if (!WsPropSuggestModal) {
			// A BUILD WITHOUT `FuzzySuggestModal` KEEPS THE OLD DOOR
			// rather than losing the ability to add anything: the flat
			// menu inside `pickProp` can still offer what exists.
			pickProp(ev2);
			return;
		}
		try {
			new WsPropSuggestModal(d.plugin.app, [], (info) => {
				if (!info || !info.key) return;
				const nk = String(info.key).toLowerCase();
				void addProp({ key: nk, label: String(info.key) });
				if (type) void setPropType(nk, type);
			}, 'Name the new property', 'Create \u201c%s\u201d',
				taken).open();
		} catch { pickProp(ev2); }
	};
	named(type);
};
const addNewProp = (ev2: MouseEvent) => {
	askPropType(ev2, (type) => nameNewProp(type, ev2));
};
// ── AND THE DOOR IS NAMED ONCE ──────────────────────────────────
//
// The panel's footer and the header menu both offer these, and a
// third place will want them too. `menuRowSpecs` is the standing
// example of what happens otherwise: a row has to be named in three
// places and forgetting one is how a control ships half-reachable.
//
// THE ICON LIST IS PER DOOR because `setIcon` fails SILENTLY on a
// name this Obsidian does not have — each door carries its own
// fallbacks, tried in order, and the first that draws wins.
const ORG_PROP_DOORS = [
	// NO ELLIPSIS ON EITHER: the convention is real — a trailing "…" means
	// the control opens something rather than doing it — and it is not
	// wanted here. THE TYPES HANG OFF THE DOOR, not off the row that draws
	// it: the header menu and the panel both read this list, and a submenu
	// declared at one of them is a door added in one place and forgotten
	// in the other. `open` is what a caller with no submenu of its own does
	// — the header menu, and any build without our flyout — and it still
	// asks with `askPropType`.
	{ label: 'Add a new property',
		icons: ['plus', 'plus-circle', 'file-plus'],
		types: PROP_TYPES,
		pick: (type: string, ev2: MouseEvent) => nameNewProp(type, ev2),
		open: (ev2: MouseEvent) => addNewProp(ev2) },
];
const pickProp = (ev2: MouseEvent) => {
	const found = propKeysInScope();
	// ── SEARCH *OR* CREATE ───────────────────────────────────────
	//
	// The picker opens on an empty list too: a vault with no properties
	// yet is exactly the vault that wants to NAME one, and the create row
	// is the door.
	if (WsPropSuggestModal) {
		try {
			new WsPropSuggestModal(d.plugin.app, found, (info) => {
				// A CREATED KEY IS A KEY LIKE ANY OTHER from here on: `addProp` reads
				// `label` for what to show and `key` for the duplicate check, and the
				// picker has already refused a name that would duplicate one.
				//
				// ── AND A NEW ONE IS ASKED WHAT IT IS ─────────────────────
				//
				// ONLY WHEN IT IS NEW, which `isNew` already tells us: a key the vault
				// already uses has a type Obsidian knows, and asking again would be a
				// question with a right answer already on file. ADDED FIRST, ASKED
				// SECOND: asked and then added, a writer who dismisses the menu would
				// have named a property and got nothing. So the column exists the
				// moment it is named, and the type REFINES it; dismissing leaves a
				// text property.
				if (info.isNew) {
					const nk = String(info.key).toLowerCase();
					void addProp({ key: nk, label: String(info.key) });
					askPropType(ev2, (type) => { void setPropType(nk, type); });
				} else {
					void addProp(info);
				}
			}, null, 'Add “%s” as a new property').open();
			return;
		} catch (_) { wsCatch('openManuscriptModal / pickProp: new WsPropSuggestModal(this.app, found, (info) =>', _); }
	}
	// A BUILD WITHOUT FuzzySuggestModal falls through to the flat
	// menu below, which can only offer what exists — and on an
	// empty list it would be a menu of nothing, so that one case
	// still says so rather than opening a blank.
	if (!found.length) {
		try { new Notice('No properties in these notes'); } catch (_) { wsCatch('openManuscriptModal / pickProp: new Notice(\'No properties in these notes\');', _); }
		return;
	}
	const pick = wsMenu();
	pick.addItem((i2) => i2.setTitle('Add a property').setIsLabel(true));
	for (const info of found.slice(0, 20)) {
		pick.addItem((i2) => i2
			.setTitle(info.label + '  ·  ' + info.n
				+ (info.n === 1 ? ' note' : ' notes')
				+ (info.spellings > 1 ? '  ·  ' + info.spellings + ' spellings' : ''))
			.onClick(() => addProp(info)));
	}
	try { pick.showAtMouseEvent(ev2); }
	catch { try { pick.showAtPosition({ x: 0, y: 0 }); } catch (_e) { wsCatch('openManuscriptModal / pickProp: pick.showAtPosition( x: 0, y: 0 );', _e); } }
};
	return { colOff, setCols, pruneUserCols, addProp, ORG_PROP_DOORS, get COLS() { return COLS; }, set COLS(v) { COLS = v; }, get SORTS() { return SORTS; }, set SORTS(v) { SORTS = v; } };
};
