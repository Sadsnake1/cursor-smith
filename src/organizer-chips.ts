// Word-Smith — organizer-chips.

import type WordSmith from './plugin';
import type { WsLensChip } from './organizer-lens';
import type { WsOrgRow } from './organizer-rows';

// ════════════════════════════════════════════════════════════════════════
// THE CHIP TEST — does a row pass the lens, and what keys are there to ask
// ════════════════════════════════════════════════════════════════════════
//
// `orgChipHit` (one chip against one row — the axis, the operator and the
// value, including the flag axis and the operators that mean "filled" and
// "empty") and `orgPropKeys` (which keys exist beneath the selection, so
// the filter menu offers what is there and not a list of everything a
// vault has ever had).
//
// WHAT IT READS, through `d`: the flag of a row (`d.markOf`), the rows
// beneath a folder (`d.orgRowList`) and `d.plugin` for the readings and
// the frontmatter. The lens that holds the chips is next door, in
// organizer-lens.ts; this is the predicate it is read through.
//
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgChipsMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (2 of 3).
export interface OrgChipsDeps {
	plugin: WordSmith;
	readonly markOf: (path: string | number, kind: string) => string;
	readonly orgRowList: (at: string, flat: boolean) => WsOrgRow[];
}

export const wsOrgChipsMake = (d: OrgChipsDeps) => {
// A chip is `axis: value`; a chip with no `axis` means `property: value`,
// and older chips have none, so they must go on working.
//
// THE AXES DISPATCH FIRST, and they have to: this function's whole
// body reads `_orgIndex.get(path).props`, which is FRONTMATTER. A
// flag lives in a path-keyed settings store, a tag can be written in
// the prose, and tasks are a `{done, all}` OBJECT that the flat-value
// guard below rejects on sight. None of the three could ever have
// matched through the property path, which is why Filter offered
// properties and nothing else until now.
//
// Modelled on `orgColRaw`, which already switches on a reading's id
// before falling through to the property lookup — same readings, same
// order, so a filter and a column can never disagree about what a
// row carries.
const orgChipHit = (chip: WsLensChip, path: string) => {
	const want = String(chip.value).trim().toLowerCase();
	if (chip.axis === 'flag') {
		// The chip carries the flag's ID (`revise`), not its label,
		// because a writer can rename a flag in settings and a chip
		// holding the old word would quietly stop matching.
		return (d.markOf(path, 'file') || '') === String(chip.id || '');
	}
	if (chip.axis === 'tag') {
		// BOTH FACES OF A TAG (spec: "tags are two-faced"), because
		// the column shows both: a tag written in the prose narrows
		// exactly as a frontmatter one does.
		let tags: string[] = [];
		try { tags = d.plugin.tagsOf(path) || []; } catch { tags = []; }
		return tags.some(t => String(t).replace(/^#/, '').toLowerCase()
			=== want.replace(/^#/, ''));
	}
	if (chip.axis === 'tasks') {
		const rr = d.plugin._orgIndex && d.plugin._orgIndex.get(path);
		const t = rr && rr.tasks;
		// `tasks` is null for a note with no boxes at all (the index
		// normalises {0,0} away), which is what 'none' asks for.
		const all = t ? Number(t.all) || 0 : 0;
		const done = t ? Number(t.done) || 0 : 0;
		if (chip.id === 'none') return all === 0;
		if (chip.id === 'any') return all > 0;
		void done;
		return false;
	}
	// ── IS EMPTY / IS NOT EMPTY, FOR EVERY PROPERTY (brief C2) ──────
	//
	// “Generalise `No flag` into `is empty` / `is not empty` available
	// for EVERY property — ‘scenes with no synopsis’ is the query this
	// tool exists to answer.” The writer's own mock calls it the sleeper
	// feature.
	//
	// IT IS ASKED OF THE ROW, NOT OF THE VALUE, which is why it cannot
	// ride on the value comparison below: a note that has never carried
	// the key has no entry to compare, and that absence IS the answer.
	//
	// AN EMPTY STRING COUNTS AS EMPTY. `synopsis:` with nothing after it
	// is a key a writer started and did not fill, and “which scenes have
	// no synopsis” plainly means that one too.
	const rEmpty = d.plugin._orgIndex && d.plugin._orgIndex.get(path);
	// A .pdf HAS NO INDEX ROW: its properties are the store's, read here as
	// the cells read them. The frontmatter wins where both answer, which is
	// never for one file.
	const side = d.plugin.propStoreHolds(path) ? d.plugin.propStoreAllSync(path) : null;
	const propsOf = Object.assign({}, side || {}, (rEmpty && rEmpty.props) || {});
	if (chip.op === 'empty' || chip.op === 'filled') {
		const props = propsOf;
		let has = false;
		if (props) {
			for (const k of Object.keys(props)) {
				if (k.toLowerCase() !== String(chip.key).toLowerCase()) continue;
				const v = props[k];
				const flat = Array.isArray(v) ? v : [v];
				has = flat.some(x => x !== null && x !== undefined
					&& typeof x !== 'object' && String(x).trim() !== '');
				break;
			}
		}
		return chip.op === 'empty' ? !has : has;
	}
	for (const k of Object.keys(propsOf)) {
		if (k.toLowerCase() !== String(chip.key).toLowerCase()) continue;
		const v = propsOf[k];
		const flat = Array.isArray(v) ? v : [v];
		return flat.some(x => x != null && typeof x !== 'object'
			&& String(x).trim().toLowerCase() === want);
	}
	return false;
};
// The keys the "+ filter" menu offers: every property any note under
// the selection carries, from the index.
const orgPropKeys = (at: string) => {
	const seen = new Map<string, string>();
	const ix = d.plugin._orgIndex;
	if (!ix) return [];
	for (const row of d.orgRowList(at, true)) {
		const r = ix.get(row.path);
		// A .pdf's KEYS ARE THE STORE'S: the index has no row for it, and a key
		// only a .pdf carries must still be offered to the filter.
		const props = (r && r.props) || (d.plugin.propStoreHolds(row.path) ? d.plugin.propStoreAllSync(row.path) : null);
		if (!props) continue;
		for (const k of Object.keys(props)) {
			const lc = k.toLowerCase();
			if (!seen.has(lc)) seen.set(lc, k);
		}
	}
	return Array.from(seen.values())
		.sort((a, b) => a.localeCompare(b));
};

// ── THE TABLE ROW'S RIGHT-CLICK (writer's pass) ─────────────────────
// The tree's own menu, on the table's rows: rename and delete run
// through Obsidian's commands, `fileMenuFor` carries the flags —
// SELF-CONTAINED, so this ctx only says how THIS pane renames and
// reveals. The writer right-clicked the table and got nothing; the
// tree twelve inches away answered. Same gesture, same menu now.
	return { orgChipHit, orgPropKeys };
};
