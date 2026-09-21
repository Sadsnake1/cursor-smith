// Word-Smith — organizer-rows: what the table has to draw, and what a
// row's links say.

import { wsCatch } from './preamble';
import type WordSmith from './plugin';

// ════════════════════════════════════════════════════════════════════════
// THE ROWS — what the table has to draw, and what a row's links say
// ════════════════════════════════════════════════════════════════════════
//
// `orgRowList` (the binder — a folder's children in the book's order,
// folders and notes, folded or not), the vault's path list behind one
// cache (`orgAllFilePaths`), `orgUnder` (everything beneath a path, which
// the aggregates and the export scope both read), and the link readings
// `orgOutLinks` and `orgBackMap`. Every draw walks these.
//
// WHAT IT READS, through `d`: `d.orgIsOpen` (is this folder unfolded) and
// `d.plugin` — the vault, the metadata cache and the order. That is all:
// the rows are a reading of the vault, not of the window.
//
// ONE `let` IS LIVE — `orgFilePathCache`, dropped by the table's context
// when a draw begins — so it comes back as a getter and a setter and the
// window reads it as `orgRows.orgFilePathCache`.
//
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgRowsMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (1 of 2).
// A ROW OF THE TABLE: what the walk emits per file or folder — the path,
// the folder it sits in, its kind and group, how deep, the folder's path
// relative to the subject, and its place in the list. Not a TAbstractFile:
// a row survives its file (`WsFileLike`), and the cells read only these.
export interface WsOrgRow { path: string; parent: string; kind: 'file' | 'folder'; group: string; depth: number; rel: string; idx: number }
export interface OrgRowsDeps {
	plugin: WordSmith;
	readonly orgIsOpen: (p: string) => boolean;
}

export const wsOrgRowsMake = (d: OrgRowsDeps) => {
// ── THE TABLE IS A BINDER, NOT A FLAT LIST ─────────────────────
//
// `sortFolderItems` returns one list per folder, notes and subfolders
// INTERLEAVED, kind-blind — Obsidian's own explorer draws it that way.
// So this walks that one list in order and emits BOTH kinds. `depth` is
// how far in to indent; `kind` is what a row IS, and every cell asks it.
// A shut folder does not recurse — which is the fold — and its numbers
// are NOT taken from what is drawn, or folding would silently become a
// filter.
//
// `flat` IS WHAT A LENS SEES, and it is not the same list. A sort or a
// filter is a view over the WHOLE selection — it answers "which of my
// notes", and it cannot answer that from the folders the writer happens
// to have open. So a lens gets every descendant note, no folder rows
// and no folding. The hierarchy is the BOOK'S OWN ORDER; the flat list
// is the lens's.
const orgRowList = (at: string, flat: boolean): WsOrgRow[] => {
	const out: WsOrgRow[] = [];
	const dive = (dir: string, depth: number) => {
		for (const p of d.plugin.treeOrderCurrent(String(dir))) {
			let node = null;
			try { node = d.plugin.app.vault.getAbstractFileByPath(p); } catch (_) { wsCatch('openManuscriptModal / dive: node = this.app.vault.getAbstractFileByPath(p);', _); }
			if (!node) continue;
			const isFolder = !!node.children;
			// ── THE WALK ENUMERATES THE VAULT ────────────────────────────
			//
			// Attachments are rows too: an attachment has no index entry, so every
			// reading column is blank for one, and `isFileCounted` is
			// markdown-only so no total moves. NARROWED AT THE TABLE'S CALL SITE,
			// NOT HERE, for the reason the SHAPE filter is there too: this walk has
			// two other callers — `orgPropKeys` and the tag list — which use it to
			// ENUMERATE what is under the selection for the filter menu. A writer
			// whose kinds are set to `pdf` alone would find both menus empty and
			// no way to build the filter that would get them out. THE GROUP IS
			// STAMPED, so the table asks `uniTypeSet` once per draw instead of
			// looking every row's file up a second time. `uniTypeGroupOf` stays the
			// one writer of what kind a file is.
			if (!(flat && isFolder)) {
				out.push({
					path: p, parent: dir,
					kind: isFolder ? 'folder' : 'file',
					group: isFolder ? 'folder' : d.plugin.uniTypeGroupOf(node),
					depth: depth,
					rel: dir === at ? '' : (at ? dir.slice(at.length + 1) : dir),
					idx: out.length
				});
			}
			if (isFolder && (flat || d.orgIsOpen(p))) dive(p, depth + 1);
		}
	};
	// FOLDED MEANS NOT WALKED, which is what every other folder here
	// does with its own fold. Returning early rather than filtering
	// afterwards keeps the totals honest: the folder cells read the
	// INDEX, never the drawn rows, so a fold cannot move a number.
	dive(at, 0);
	return out;
};
// EVERY NOTE BENEATH A FOLDER, from the INDEX and not from the table. A
// folder row's numbers are its whole subtree, read from the model on
// purpose: taken from the drawn rows instead, shutting a folder would
// change its own total, and a fold that alters a number is the
// fold-as-filter fault.
//
// ── EVERY FILE UNDER IT, NOT EVERY INDEXED ONE ────────────────
//
// THE ORG INDEX IS BUILT FROM `getMarkdownFiles`, so walking its keys
// answers for notes and silently drops everything else — and a .pdf can
// carry a property, so a folder's total has to count it. THE INDEX
// STILL LEADS, and the vault only fills in what it missed: the index is
// the cheaper read and the one every other reading here uses, so this
// adds to it rather than replacing it. Two callers, both aggregates.
//
// ── ONE VAULT SCAN PER DRAW ────────────────────────────────────
//
// `orgUnder` is asked once per folder row per aggregated column, and
// rebuilding the whole vault list on each ask is thirty-six
// `vault.getFiles()` calls and a second's pause for one draw of a small
// folder. The list cannot change DURING a draw, so it is read once and
// dropped at the start of the next — no invalidation to get wrong,
// because its whole life is one pass.
let orgFilePathCache: string[] | null = null;
const orgAllFilePaths = () => {
	if (orgFilePathCache) return orgFilePathCache;
	try {
		const all = d.plugin.app.vault.getFiles ? d.plugin.app.vault.getFiles() : [];
		orgFilePathCache = all.map((f) => f && f.path).filter(Boolean);
	} catch { orgFilePathCache = []; }
	return orgFilePathCache;
};
const orgUnder = (folder: string) => {
	const pre = String(folder || '') ? String(folder) + '/' : '';
	const out = [];
	const seen = new Set();
	const ix = d.plugin._orgIndex;
	if (ix) {
		for (const p of ix.keys()) {
			if (pre && !p.startsWith(pre)) continue;
			out.push(p); seen.add(p);
		}
	}
	try {
		for (const p of orgAllFilePaths()) {
			if (seen.has(p)) continue;
			if (pre && !p.startsWith(pre)) continue;
			out.push(p);
		}
	} catch (_) { wsCatch('openManuscriptModal / orgUnder: for (const p of orgAllFilePaths())', _); }
	return out;
};


// ── ONE READING PER CELL, from the index and the stores ─────────────
//
// `null` means EMPTY — no value, not zero words. Empty is what the
// hide-empties rule hides and what a chip can never match; a real 0
// (words in a blank note) is a value like any other.
// ── WHO POINTS AT WHAT, WALKED ONCE ─────────────────────────────
//
// `resolvedLinks` is a map of the WHOLE VAULT — every note, and
// everything it points at. Reading it per row would be a walk of the
// vault per row, which is a table that gets slower the more notes
// you have; the Backlinks column would be the one reading nobody
// could afford to leave on.
//
// SO IT IS INVERTED ONCE and cached on the plugin, keyed on
// `_linkGen` — the counter the metadata cache bumps when links
// actually change. `getBacklinkCount` on the Powerline bar has
// cached against that same counter since before 1.3.9; this is the
// same bargain for a whole table rather than one note.
//
// DISTINCT NOTES, NOT LINK INSTANCES. A note that mentions this one
// four times is one note that points at you — which is what the
// backlinks pane counts, what the bar's reading means, and what a
// list of NAMES can say at all.
//
// A NOTE LINKING TO ITSELF IS NOT A BACKLINK TO ITSELF, the same
// exclusion the bar makes, for the same reason.
// WHAT A NOTE LINKS TO: Obsidian's resolved links for the
// path — the targets it found — and its unresolved ones — the names
// it could not — as the core Outgoing links pane lists them, the
// note's own path left out.
const orgOutLinks = (path: string) => {
	const out = [];
	try {
		const mc = d.plugin.app.metadataCache;
		const res = (mc && mc.resolvedLinks && mc.resolvedLinks[path]) || {};
		for (const dest of Object.keys(res)) { if (dest !== path) out.push({ path: dest }); }
		const un = (mc && mc.unresolvedLinks && mc.unresolvedLinks[path]) || {};
		for (const name of Object.keys(un)) out.push({ text: name });
	} catch (_) { wsCatch('orgOutLinks: this.app.metadataCache.resolvedLinks[path]', _); }
	return out;
};
const orgBackMap = () => {
	const gen = d.plugin._linkGen || 0;
	const hit = d.plugin._orgBackMap;
	if (hit && hit.gen === gen) return hit.map;
	const map = new Map<string, string[]>();
	try {
		const resolved = (d.plugin.app.metadataCache
			&& d.plugin.app.metadataCache.resolvedLinks) || {};
		for (const src of Object.keys(resolved)) {
			const targets = resolved[src] || {};
			for (const dest of Object.keys(targets)) {
				if (dest === src) continue;
				let arr = map.get(dest);
				if (!arr) { arr = []; map.set(dest, arr); }
				if (arr.indexOf(src) === -1) arr.push(src);
			}
		}
	} catch (_) { wsCatch('openManuscriptModal / orgBackMap: const resolved = (this.app.metadataCache', _); }
	d.plugin._orgBackMap = { gen, map };
	return map;
};
	return { orgRowList, orgUnder, orgOutLinks, orgBackMap, get orgFilePathCache() { return orgFilePathCache; }, set orgFilePathCache(v) { orgFilePathCache = v; } };
};
