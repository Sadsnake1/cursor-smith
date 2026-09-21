// Word-Smith — organizer-writes: a property written, and what the cell
// says until it lands.

import { wsCatch, wsStr } from './preamble';
import type WordSmith from './plugin';
import type { WsOrgJournalEntry } from './organizer-journal';

// ════════════════════════════════════════════════════════════════════════
// THE WRITES — a property written, and what the cell says until it lands
// ════════════════════════════════════════════════════════════════════════
//
// The pending overlay (`orgPend`, `ORG_PEND_MS`, `orgPendKey`,
// `orgPendSet`, `orgPendDrop`, `orgPendGet`, `orgPendSame` — what was just
// typed, shown until the reader agrees) and the writers over it
// (`orgPropWriteOne`, `orgPropSet`, `orgPropListSet`, which set the
// overlay, write through the plugin, push the undo entry and drop the
// overlay on a failure).
//
// WHAT IT READS, through `d`: the journal (`d.orgHistPush`, `d.orgHistOn`),
// the bulk selection (`d.orgBulkPaths`, `d.orgBulkSay`), the editor's
// reading of a value (`d.orgPropValue`) and `d.plugin`.
//
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgWritesMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (5 of 6).
export interface OrgWritesDeps {
	plugin: WordSmith;
	readonly orgBulkPaths: (row: { path: string; kind?: string; } | null | undefined) => string[];
	readonly orgBulkSay: (n: number, what: string) => void;
	readonly orgHistOn: (paths: string[], what: string) => string;
	readonly orgHistPush: (entry: WsOrgJournalEntry) => void;
	readonly orgPropValue: (path: string, key: string) => unknown;
}

export const wsOrgWritesMake = (d: OrgWritesDeps) => {
// ── WHAT WAS JUST TYPED, UNTIL THE READER AGREES ─────────────────
//
// The pane redraws BEFORE the disk write (so it comes back in 0ms
// instead of 60), and that redraw runs while `orgPropWrite` is still
// in flight and the index still holds the old frontmatter — so a
// deleted value would stand in the cell for a moment and a typed one
// would flash empty. Both directions, one fault. SO THE CELL IS TOLD
// WHAT WAS COMMITTED, and reads it until the index agrees. NOT A
// CACHE: it holds only values this window has just written, it drops
// the moment the reader says the same thing, and it expires regardless
// — a write that fails must not mask the truth for the rest of the
// session, and four seconds is far past any local `processFrontMatter`
// round trip.
const orgPend = new Map<string, { v: unknown; at: number }>();
const ORG_PEND_MS = 4000;
// KEYED CASE-INSENSITIVELY, because the column reads frontmatter that
// way too — `Description` and `description` are one property here.
const orgPendKey = (path: string, key: string) =>
	String(path) + '\u0000' + String(key).toLowerCase();
const orgPendSet = (path: string, key: string, v: unknown) => {
	orgPend.set(orgPendKey(path, key), { v: v, at: Date.now() });
};
const orgPendDrop = (path: string, key: string) => { orgPend.delete(orgPendKey(path, key)); };
const orgPendGet = (path: string, key: string) => {
	const k = orgPendKey(path, key);
	const e = orgPend.get(k);
	if (!e) return null;
	if (Date.now() - e.at > ORG_PEND_MS) { orgPend.delete(k); return null; }
	return e;
};
// A LIST IS COMPARED BY ITS MEMBERS. `tags` and `aliases` come back as
// fresh arrays every read, so `===` would never agree and the overlay
// would sit there until it expired — four seconds of masking a value
// somebody may have changed in the note itself.
const orgPendSame = (a: unknown, b: unknown) => {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length
			&& a.every((x, i) => String(x) === String(b[i]));
	}
	if (a === null || a === undefined) return b === null || b === undefined;
	if (b === null || b === undefined) return false;
	return wsStr(a) === wsStr(b);
};
// ONE DOOR FOR EVERY PROPERTY WRITE THIS PANE MAKES. There are three
// editors — the scalar box, the checkbox and the chips — and a wrapper
// applied at two of them is a flash the third still has.
//
// THE OVERLAY IS NOT DROPPED ON SUCCESS, which is the whole point: the
// write resolving is not the index having caught up. It is dropped when
// the write FAILS, because then there is nothing to be optimistic about.
// ONE PATH, ONE WRITE, the pending value set before and dropped on a
// failure; `own` is the row the writer edited, whose failure is theirs
// to see, where another row's is contained and logged.
const orgPropWriteOne = async (p: string, key: string, value: unknown, own: boolean) => {
	orgPendSet(p, key, value);
	try {
		return await d.plugin.orgPropWrite(p, key, value);
	} catch (e) {
		orgPendDrop(p, key);
		if (own) throw e;
		wsCatch('orgPropSet / bulk: this.orgPropWrite(p, key, value);', e);
		return false;
	}
};
const orgPropSet = async (path: string, key: string, value: unknown) => {
	// ON EVERY NOTE THE SELECTION HOLDS: the one door every cell editor
	// commits through, so the spread lives here and not in four editors —
	// and ONE call site, in `orgPropWriteOne`, which this and the list
	// setter share. The edited note is written last, so its return value is
	// the one the editor reads and its failure is the one that throws; a
	// failure on another note is reported and the rest go on.
	const all = d.orgBulkPaths({ kind: 'file', path }).filter(p => p !== path).concat([path]);
	const before: [string, unknown][] = all.map((p) => [p, d.orgPropValue(p, key)]);
	let out = false;
	for (const p of all) {
		const r = await orgPropWriteOne(p, key, value, p === path);
		if (p === path) out = !!r;
	}
	if (all.length > 1) d.orgBulkSay(all.length, 'Property set');
	d.orgHistPush({
		label: d.orgHistOn(all, String(key)),
		undo: async () => { for (const [p, v] of before) await orgPropWriteOne(p, key, v, false); },
		redo: async () => { for (const p of all) await orgPropWriteOne(p, key, value, false); }
	});
	return out;
};
// A LIST IS THE ROW'S OWN. A scalar set on one selected row is the same
// scalar on every row — a status is a status. A list is not: what the
// writer did on the edited row was "take this one off" or "put this one
// on", and that is what the other rows get — their OWN list with
// `removed` taken out and `added` put in at the end, once, no
// duplicates. The edited row gets the list as typed. A row the delta
// leaves as it was is not written; a reorder of the chips (same set,
// new order) is a delta of nothing and touches the other rows not at
// all.
const orgPropListSet = async (path: string, key: string, list: unknown, before: unknown) => {
	const str = (a: unknown) => (Array.isArray(a) ? a : (a === null || a === undefined || a === '' ? [] : [a])).map(String);
	const now = str(list), was = str(before);
	const added = now.filter((x) => was.indexOf(x) === -1);
	const removed = was.filter((x) => now.indexOf(x) === -1);
	const writes: [string, unknown, unknown][] = [[path, d.orgPropValue(path, key), list]];
	const out = await orgPropWriteOne(path, key, list, true);
	let n = 1;
	if (added.length || removed.length) {
		const others = d.orgBulkPaths({ kind: 'file', path }).filter(p => p !== path);
		for (const p of others) {
			const own = str(d.orgPropValue(p, key));
			const next = own.filter((x) => removed.indexOf(x) === -1)
				.concat(added.filter((x) => own.indexOf(x) === -1));
			if (next.length === own.length && next.every((x, i) => x === own[i])) continue;
			writes.push([p, own, next]);
			await orgPropWriteOne(p, key, next, false);
			n++;
		}
	}
	if (n > 1) d.orgBulkSay(n, 'Property set');
	d.orgHistPush({
		label: d.orgHistOn(writes.map((w) => w[0]), String(key)),
		undo: async () => { for (const [p, v] of writes) await orgPropWriteOne(p, key, v, false); },
		redo: async () => { for (const [p, , v] of writes) await orgPropWriteOne(p, key, v, false); }
	});
	return out;
};
	return { orgPendDrop, orgPendGet, orgPendSame, orgPropSet, orgPropListSet };
};
