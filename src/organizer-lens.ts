// Word-Smith — organizer-lens: the sort and the chips the table is read
// through.

import { Notice } from 'obsidian';
import { WsPropSuggestModal, wsCatch, wsMenu, wsStr } from './preamble';
import type { WsSession } from './preamble';
import type { WsPropItem } from './preamble';

// a chip of the lens: which axis it narrows (a property, a tag, a flag), by what, and whether it is set aside
export interface WsLensChip { axis?: string; id?: string; key?: string; value?: string; off?: boolean; op?: string }
export interface WsLensSort { id: string; dir: string }
import type WordSmith from './plugin';
import type { WordSmithSettings } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE LENS — the sort and the chips the table is read through
// ════════════════════════════════════════════════════════════════════════
//
// The lens itself (`orgLens` — a sort and a list of chips, a SESSION's
// reading of the manuscript and never a setting), `orgLensOn`,
// `orgLensSet` (which remembers it on the session and redraws),
// `orgLensClear`, the scope reader `orgAt`, and the chips (`orgSameChip`,
// `orgAddChip`, `orgFilterByKey` — the menu that offers a key's values
// and adds the chip a writer picks).
//
// WHAT IT READS, through `d`: the settings (`d.s`), the session (`d.ses`,
// where the lens is remembered), the folder (`d.orgFolder`, which `orgAt`
// returns), `d.drawPanel` and `d.plugin` for the values under a key.
//
// THE LENS ITSELF IS LIVE — reassigned in here and read by the table, the
// panel and the tests' door — so it comes back as a getter and a setter
// and the window reads it as `orgLensBox.orgLens`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgLensMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (1 of 5).
export interface OrgLensDeps {
	plugin: WordSmith;
	readonly drawPanel: () => void;
	readonly orgFolder: string;
	readonly s: WordSmithSettings;
	readonly ses: WsSession;
}

export const wsOrgLensMake = (d: OrgLensDeps) => {
// ── THE LENS — one variable, one writer (spec, WRITES) ──────────────
//
// Sort, search and filter chips are LENSES on the right pane: they
// change what is shown and never what is stored. One object holds
// all three, `orgLensSet` is the only thing that assigns it, and
// `orgLensOn()` is the one question everything else asks — the
// grouped/flat rule, the hide-empties rule and (Phase 3) whether
// drag affordances render at all.
// RESTORED BELOW, once the columns exist to check it against — a lens
// is validated against what the table HAS, and `colDefs()` has not run
// yet at this line. See `sesLensRestore`.
let orgLens: { sort: WsLensSort | null; chips: WsLensChip[] } = { sort: null, chips: [] };
// An UNTICKED chip is set aside, not gone: it narrows nothing, so a lens
// of only-unticked chips is NO lens — groups and drag come back while
// the chip waits. A SORT THAT CANNOT APPLY IS NOT A LENS: a sort chosen
// against columns the view does not have is kept and unread, not
// cleared — dropping it would throw away the writer's arrangement every
// time they glance elsewhere. AND IT IS ASKED IN ONE PLACE: this is the
// question the grouped/flat rule, the hide-empties rule and the drag
// affordances all ask.
const orgLensOn = () => !!(orgLens.sort
	|| orgLens.chips.some(c => !c.off));
const orgLensSet = (patch: { sort?: WsLensSort | null; chips?: WsLensChip[] }) => {
	orgLens = Object.assign({}, orgLens, patch);
	// THE ONE WRITER OF THE LENS is the one writer of the memory of it.
	// Every chip, every sort and every clear passes through here.
	d.ses.lens = orgLensOn() ? orgLens : null;
	// AND TO THE SETTINGS: the arrangement comes back after a restart,
	// validated on read against the columns the table then has, as the
	// session's copy is. One writer still — every chip, sort and clear
	// passes through here — and the key is absent rather than null when
	// there is no lens, like the table's other choices.
	if (d.ses.lens) d.s.uniLens = JSON.parse(JSON.stringify(d.ses.lens)) as Record<string, unknown>;
	else delete d.s.uniLens;
	d.plugin.saveSettings().catch(() => {});
	d.drawPanel();
};
const orgLensClear = () => {
	orgLensSet({ sort: null, chips: [] });
};

// ── WHAT THE TABLE IS OVER ──────────────────────────────────────────
// The vault root when nothing is selected.
const orgAt = () => d.orgFolder;
// ── ONE WRITER FOR A FILTER CHIP, AND ONE VALUE PICKER ──────────
//
// The filter button and the table header's "Filter by this…" both build
// a chip; two builders of one chip is how one gains a row the other has
// not. THE SUBJECT IS ASKED FOR, NOT PASSED IN: `orgAt()` is the folder
// the pane is about, and reading it here means a picker opened from the
// header enumerates the same values as one opened from the bar.
//
// ── …AND ONE CHIP FOR ONE NARROWING ─────────────────────
//
// TWO CHIPS FOR ONE NARROWING IS UNANSWERABLE. They AND together, so a
// live twin and a dimmed one narrow exactly as the live one alone does —
// the strip shows a filter that is doing nothing, beside an identical
// one that is, and nothing on either says which. Reaching for a filter
// that is set aside turns it back on rather than making a second. HERE
// AND NOT IN `orgLensSet`, which is the lens's one writer but is also
// how the tests' door sets a whole list at once: a chip is BORN in this
// function and nowhere else, and a rule about what may be born belongs
// where the birth happens. MATCHED THE WAY THE MATCHER MATCHES:
// `orgChipHit` lowercases the value before comparing, so two chips that
// narrow identically must count as the same chip here even when their
// values differ in case.
const orgSameChip = (a: WsLensChip, b: WsLensChip) =>
	String(a.axis || '') === String(b.axis || '')
	&& String(a.id || '') === String(b.id || '')
	&& String(a.key || '').toLowerCase() === String(b.key || '').toLowerCase()
	&& String(a.value || '').toLowerCase()
		=== String(b.value || '').toLowerCase();
const orgAddChip = (chip: WsLensChip) => {
	// ALREADY UP: turn it back on rather than add its twin. Ticking
	// is what the writer meant — they went to the menu for this
	// narrowing, and it is the one already sitting there dimmed.
	if (orgLens.chips.some(c => orgSameChip(c, chip))) {
		orgLensSet({ chips: orgLens.chips.map(c => (orgSameChip(c, chip)
			? Object.assign({}, c, { off: false }) : c)) });
		return;
	}
	orgLensSet({ chips: orgLens.chips.concat([chip]) });
};
const orgFilterByKey = (key: string, ev: MouseEvent) => {
	const at = orgAt();
	let vals: unknown[] = [];
	try { vals = d.plugin.orgDistinctUnder(at, key) || []; }
	catch { vals = []; }
	if (!vals.length) {
		try { new Notice('No values for ' + key); } catch (_) { wsCatch('openManuscriptModal / orgFilterByKey: new Notice(\'No values for \' + key);', _); }
		return;
	}
	// ── WITH HOW MANY NOTES BEHIND EACH (brief C2) ─────────────
	//
	// “per-value counts (‘Draft 4’)”. A list of bare names cannot tell
	// a value that narrows to twelve scenes from one that narrows to a
	// single stub, and picking the second is how a writer ends up
	// staring at an empty table wondering what they broke.
	let counts = new Map<string, number>();
	try { counts = d.plugin.orgCountsUnder(at, key) || new Map<string, number>(); }
	catch { counts = new Map(); }
	const items = vals.map(v => {
		const c = counts.get(wsStr(v).trim());
		return { value: wsStr(v), label: wsStr(v) + (c ? '   ' + c : '') };
	});
	const take = (it: WsPropItem) => orgAddChip({ key: key, value: String(it.value) });
	if (WsPropSuggestModal) {
		try {
			new WsPropSuggestModal(d.plugin.app, items, take,
				'Which value of ' + key + '?').open();
			return;
		} catch (_) { wsCatch('openManuscriptModal / orgFilterByKey: new WsPropSuggestModal(this.app, items, take,', _); }
	}
	const pv = wsMenu();
	for (const it of items.slice(0, 20)) {
		pv.addItem((i3) => i3.setTitle(it.label).onClick(() => take(it)));
	}
	try { pv.showAtMouseEvent(ev); }
	catch { try { pv.showAtPosition({ x: 0, y: 0 }); } catch (_e) { wsCatch('openManuscriptModal / orgFilterByKey: pv.showAtPosition( x: 0, y: 0 );', _e); } }
};
// WHICH FOLDERS ARE OPEN, remembered. Empty is all-shut, which is the
// state the window opens in: only the folders and files on the same
// level.
if (!Array.isArray(d.s.organizerOpen)) d.s.organizerOpen = [];
	return { orgLensOn, orgLensSet, orgLensClear, orgAt, orgAddChip, orgFilterByKey, get orgLens() { return orgLens; }, set orgLens(v) { orgLens = v; } };
};
