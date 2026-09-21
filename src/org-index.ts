// Word-Smith — org-index: the Organizer's index of the vault, and the walks
// over it.

import { FrontMatterCache } from "obsidian";

// ── THE ORGANIZER INDEX — pure core (Phase 1, RULES-OF-THE-WINDOW.md) ──────
//
// One vault-wide store of per-note readings, and the arithmetic over it.
// Module-level and pure ON PURPOSE: tests/org_index_test.js drives every
// branch in plain node, which is the treatment the fold-acts-as-filter bug
// class earned — three separate faults in this project were "a number
// computed from what was DRAWN instead of what is IN THE VAULT", and a
// store that never hears about drawing cannot have them.
//
// What lives here: the Map, its one writer, the staleness rule the mtime
// cache runs on, and the aggregates (sum the measures, enumerate the
// properties, newest mtime). What does NOT live here: reading files,
// Obsidian events, membership rules (isFileCounted) — that glue is
// `orgIndex*` in src/38-org-index.js, and it is deliberately thin.
//
// The reading is one plain object per note:
//   { words, paras, charsNoSpaces, charsWithSpaces, sentences,
//     tasks: {all, done}|null, grade: number|null,
//     mtime, ctime, props: {}|null }

// ONE NOTE'S READING — the shape the one writer below makes, and nothing
// else ever writes an entry. `tasks` is null where a note has no boxes,
// `grade` null where it has no sentence, `props` the frontmatter copied.
export interface WsOrgReading {
	words: number; paras: number; charsNoSpaces: number; charsWithSpaces: number; sentences: number; footnotes: number;
	tasks: { all: number; done: number } | null; grade: number | null; mtime: number; ctime: number;
	props: Record<string, unknown> | null;
}
export type WsOrgIndexMap = Map<string, WsOrgReading>;
// A FRONTMATTER VALUE AS TEXT, for counting and telling apart: a word as
// itself, a number or a flag by its digits, an object by its JSON. (The
// preamble's `wsStr` is this; the pure core imports nothing.)
const wsPlain = (v: unknown): string => {
	if (v == null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return ''; } }
	return (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') ? String(v) : '';
};
export const wsOrgIndex = (): WsOrgIndexMap => new Map();

// THE ONE WRITER. Every entry passes through here, so the shape above is a
// fact rather than a hope: numbers are coerced, props are shallow-copied
// (the caller's cache object must not be shared — Obsidian mutates its
// metadata cache in place), and nothing else ever writes an entry.
// FOOTNOTES IN A NOTE: every definition line `[^id]: …` and every inline
// footnote `^[…]`, each once; a reference `[^id]` in the prose is not a
// second footnote. Code blocks are left as they are — a footnote written
// inside one is not a footnote, and the counter that skips code lines
// (`scanNonProseLines`) is the word counter's; this is a cheap line
// scan, and the rare fenced `[^x]:` is the price of keeping it so.
export const wsCountFootnotes = (text: string) => {
	const s = String(text || '');
	let n = 0;
	const defs = s.match(/^[ \t]*\[\^[^\]\s]+\]:/gm);
	if (defs) n += defs.length;
	const inl = s.match(/\^\[[^\]\n]+\]/g);
	if (inl) n += inl.length;
	return n;
};
export const wsOrgPut = (ix: WsOrgIndexMap, path: string, r: { words?: number; paras?: number; charsNoSpaces?: number; charsWithSpaces?: number; sentences?: number; footnotes?: number; tasks?: { done: number; all: number; }; grade?: number; mtime?: number; ctime?: number; props?: FrontMatterCache | null; }) => {
	if (!ix || !path) return null;
	const src = r || {};
	let props: Record<string, unknown> | null = null;
	if (src.props && typeof src.props === 'object') {
		props = {};
		for (const k of Object.keys(src.props)) props[k] = src.props[k];
	}
	const entry: WsOrgReading = {
		words: Number(src.words) || 0,
		paras: Number(src.paras) || 0,
		// ── THREE READINGS THAT WERE ALREADY BEING MEASURED ─────────────
		//
		// THEY COST NOTHING: `orgIndexRead` already calls `analyzeText` on every
		// note and already receives all three. Carrying them is a field in this
		// shape, not a second pass over the vault. THE NAMES ARE THE COUNTER'S
		// OWN: `countProse` returns `charsNoSpaces` and `charsWithSpaces`, and
		// it also returns `chars` as a synonym for the first — a name that has
		// meant two things. A store that changes UNIT changes NAME, and
		// "characters" is two units; neither is called `chars` here.
		charsNoSpaces: Number(src.charsNoSpaces) || 0,
		charsWithSpaces: Number(src.charsWithSpaces) || 0,
		sentences: Number(src.sentences) || 0,
		footnotes: Number(src.footnotes) || 0,
		tasks: src.tasks && Number(src.tasks.all) > 0
			? { all: Number(src.tasks.all) || 0, done: Number(src.tasks.done) || 0 }
			: null,
		grade: (typeof src.grade === 'number' && isFinite(src.grade))
			? src.grade : null,
		mtime: Number(src.mtime) || 0,
		// WHEN IT WAS STARTED. Kept beside mtime rather than derived: `ctime`
		// is the vault's own stat and nothing else can reconstruct it.
		ctime: Number(src.ctime) || 0,
		props
		// (The writer is the shape: a field it does not set cannot reach an
		// entry, so a caller still passing a retired one is dropped rather
		// than carried.)
	};
	ix.set(String(path), entry);
	return entry;
};

export const wsOrgRemove = (ix: WsOrgIndexMap, path: string) => ix.delete(String(path));

// A rename MOVES the reading: the text did not change, so re-reading the
// file would be work for nothing — and during a folder rename Obsidian
// fires one event per descendant, so that work would be the whole folder.
export const wsOrgRename = (ix: WsOrgIndexMap, from: string, to: string) => {
	const r = ix.get(String(from));
	if (r === undefined) return false;
	ix.delete(String(from));
	ix.set(String(to), r);
	return true;
};

// The mtime cache's whole rule: unknown is stale, changed is stale. An
// entry whose mtime matches is the file we already read.
export const wsOrgStale = (ix: WsOrgIndexMap, path: string, mtime: number) => {
	const r = ix.get(String(path));
	return !r || r.mtime !== (Number(mtime) || 0);
};

// Every indexed note under a folder — '' means all of them. The `+ '/'`
// is load-bearing: '01 Work' must not collect '01 Workshop/…', which is
// the prefix bug every path-keyed store in this plugin has had to dodge.
export const wsOrgPathsUnder = (ix: WsOrgIndexMap, folder: string) => {
	const out: string[] = [];
	if (!ix) return out;
	const f = String(folder || '');
	const pre = f ? f + '/' : '';
	for (const p of ix.keys()) {
		if (!pre || p.startsWith(pre)) out.push(p);
	}
	return out;
};

// ── WHICH FILES SIT UNDER EACH FOLDER, IN ONE WALK ────────────────
//
// `wsOrgPathsUnder` above answers for ONE folder by walking every key,
// which is right for one question and wrong in a loop: asked PER ROW,
// one draw is rows × files, and doubling the manuscript quadruples the
// work (440ms against 2ms at 4,000 files). A module function rather
// than a closure in the window, so a test drives it directly and the
// scale test measures the real arithmetic rather than a copy.
//
// EVERY ANCESTOR, which is a prefix test walked the other way:
// `Book/Part 1/Ch 2/Scene.md` counts toward `Book/Part 1/Ch 2`,
// `Book/Part 1` and `Book`. The `+ '/'` that `wsOrgPathsUnder` is
// careful about is free here — a path is cut AT its separators, so
// '01 Work' can never collect '01 Workshop/…' the way a bare prefix test
// would.
//
// `all` IS THE WHOLE VAULT AND IS NOT A BUCKET. The root folder's path is
// the EMPTY STRING, and no file's path begins with '/', so a prefix test
// on it matches nothing; it is a separate list here so the root's box
// governs every file rather than none.
//
// IN THE ORDER GIVEN, deduped: a writer who picks Part Three then Part
// One has said something about the order, and re-sorting would overrule
// them.
// The paths under every folder, from a list of files or of paths: what a tick on a
// folder ticks, what a folder sums.
export interface WsUnderIndex { byFolder: Map<string, string[]>; files: Set<string>; all: string[] }
export const wsUnderIndex = (files: ({ path: string } | string)[] | null | undefined): WsUnderIndex => {
	const byFolder = new Map<string, string[]>();
	const seen = new Set<string>();
	const all: string[] = [];
	for (const f of (files || [])) {
		const p = typeof f === 'string' ? f : (f && f.path ? String(f.path) : '');
		if (!p || seen.has(p)) continue;
		seen.add(p); all.push(p);
		let cut = p.lastIndexOf('/');
		while (cut > -1) {
			const dir = p.slice(0, cut);
			let arr = byFolder.get(dir);
			if (!arr) { arr = []; byFolder.set(dir, arr); }
			arr.push(p);
			cut = dir.lastIndexOf('/');
		}
	}
	return { byFolder: byFolder, files: seen, all: all };
};

// WHAT ONE ROW GOVERNS, from that index. A folder takes everything beneath
// it and the root takes the vault; a file takes itself, or nothing when the
// compile never gathered it — which is what stops a box being drawn on a row
// outside the scope, a box that could be neither full nor empty.
export const wsUnderRow = (ix: WsUnderIndex | null | undefined, path: string | null | undefined, kind: string): string[] => {
	if (!ix) return [];
	const p = String(path == null ? '' : path);
	if (kind === 'folder') return p === '' ? ix.all : (ix.byFolder.get(p) || []);
	return ix.files.has(p) ? [p] : [];
};

// SUM the measures, NEWEST the mtime (spec, AGGREGATION). Computed from
// the index over whatever paths the caller hands in — folded, undrawn and
// lens-hidden notes included, because this function cannot see any of
// those states. `files` is how many entries actually answered, so a
// caller can compare it against the vault and notice a hole.
export const wsOrgAgg = (ix: WsOrgIndexMap, paths: string[]) => {
	const out = { files: 0, words: 0, paras: 0, tasksAll: 0, tasksDone: 0, newest: 0 };
	if (!ix) return out;
	for (const p of (paths || [])) {
		const r = ix.get(String(p));
		if (!r) continue;
		out.files++;
		out.words += r.words;
		out.paras += r.paras;
		if (r.tasks) { out.tasksAll += r.tasks.all; out.tasksDone += r.tasks.done; }
		if (r.mtime > out.newest) out.newest = r.mtime;
	}
	return out;
};

// EVERY FOLDER'S WORDS IN ONE WALK: each note's words go to every folder
// above it, so a shut folder and a parent of shut folders answer the
// same as an open one — the index cannot see a fold. Keyed by folder
// path; the root is '/'. A folder with no counted note under it has no
// entry, which a painter reads as "nothing to say", not 0.
export const wsOrgFolderWords = (ix: WsOrgIndexMap) => {
	const m = new Map<string, number>();
	if (!ix) return m;
	for (const [p, r] of ix) {
		const w = Number(r && r.words) || 0;
		let i = p.lastIndexOf('/');
		while (i > 0) {
			const f = p.slice(0, i);
			m.set(f, (m.get(f) || 0) + w);
			i = p.lastIndexOf('/', i - 1);
		}
		m.set('/', (m.get('/') || 0) + w);
	}
	return m;
};

// Every DISTINCT value of a property beneath a folder — not a count, not
// the commonest (spec, WHAT THE ORGANIZER IS). Flat values only: an array
// contributes its elements (tags, pov lists), a nested object is a
// complex value and enumerating it would print "[object Object]" —
// skipped here, rendered read-only by the Outline (Phase 4). Empty
// values contribute nothing: a note without the property is not a value
// of it. Distinctness is by string form; the ORIGINAL first-seen value
// is what comes back, numerically aware sorted.
// ── WHERE A DROP LANDS — one writer for the drop arithmetic ────────────────
//
// Every reorder gesture (tree touch, table mouse, table touch) ends in
// `treeOrderMove(folder, moved, before)`, and `before` is a PATH or null
// for the end. This is the only place that path is computed. It answers
// against the sibling list WITHOUT the moved row, because that is the list
// treeOrderMove splices into after taking the row out — computing against
// the full list is off by one the moment a row is dragged downward.
//
// (Found by reading: the tree's touch drop passed `!below` — a BOOLEAN —
// as the before-path, so indexOf missed and every touch reorder went to
// the END of the folder. tests/order_repair_test.js holds the red run.)
export const wsOrgDropBefore = (sibs: string[], movedPath: string, ontoPath: string, below: boolean) => {
	const rest = (sibs || []).filter((p) => p !== movedPath);
	const i = rest.indexOf(ontoPath);
	if (i === -1) return null;
	if (!below) return ontoPath;
	return (i + 1 < rest.length) ? rest[i + 1] : null;
};

// ── HOW MANY NOTES CARRY EACH VALUE ────────────────────────────
//
// A value with no notes behind it is a filter that returns nothing, and
// a writer cannot tell which is which by reading a list of names. A
// SIBLING OF `wsOrgDistinct`, NOT A REPLACEMENT: that one is called from
// several places that want the values alone, and widening its return
// would change every caller to gain a number one of them needs. It
// walks the same paths by the same rules — arrays flatten, complex
// values are not enumerable, blanks do not count — so the two cannot
// disagree about what a value IS. COUNTED PER NOTE, NOT PER OCCURRENCE:
// a note listing `pov: [Anna, Anna]` is one note with that pov. `extra`:
// rows of the property store beside the index's frontmatter — a path
// and its value, counted and enumerated exactly as a note's frontmatter
// is.
export const wsOrgCounts = (ix: WsOrgIndexMap, paths: string[], key: string, extra: { path: string; value: unknown }[]) => {
	const n = new Map<string, number>();
	if (!ix || !key) return n;
	const count = (v: unknown) => {
		const here = new Set<string>();
		const take = (x: unknown) => {
			if (x === null || x === undefined) return;
			if (Array.isArray(x)) { x.forEach(take); return; }
			if (typeof x === 'object') return;
			const s = wsPlain(x).trim();
			if (s) here.add(s);
		};
		take(v);
		for (const s of here) n.set(s, (n.get(s) || 0) + 1);
	};
	for (const p of (paths || [])) {
		const r = ix.get(String(p));
		if (!r || !r.props || !Object.prototype.hasOwnProperty.call(r.props, key)) continue;
		count(r.props[key]);
	}
	for (const e of (extra || [])) count(e && e.value);
	return n;
};
export const wsOrgDistinct = (ix: WsOrgIndexMap, paths: string[], key: string, extra: { path: string; value: unknown }[]) => {
	const seen = new Map<string, unknown>();
	if (!ix || !key) return [];
	const take = (v: unknown) => {
		if (v === null || v === undefined) return;
		if (Array.isArray(v)) { v.forEach(take); return; }
		if (typeof v === 'object') return;   // complex — not enumerable
		const s = wsPlain(v).trim();
		if (!s) return;
		if (!seen.has(s)) seen.set(s, v);
	};
	for (const p of (paths || [])) {
		const r = ix.get(String(p));
		if (r && r.props && Object.prototype.hasOwnProperty.call(r.props, key)) {
			take(r.props[key]);
		}
	}
	for (const e of (extra || [])) take(e && e.value);
	return Array.from(seen.keys())
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
		.map(s => seen.get(s));
};
