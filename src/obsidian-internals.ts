// Word-Smith — obsidian-internals.

import type { App, View } from 'obsidian';

// ════════════════════════════════════════════════════════════════════════════
// WHAT THIS PLUGIN KNOWS ABOUT OBSIDIAN'S INSIDES
// ════════════════════════════════════════════════════════════════════════════
//
// EVERY DEPENDENCE ON A PRIVATE API OR ON OBSIDIAN'S OWN DOM, IN ONE PLACE.
//
// `ws-dev/selectors.js` already does this for the class names WE emit, and
// says why: "a renamed class breaks THIS file loudly instead of a probe
// silently". This is the same idea pointed the other way — at names Obsidian
// owns, which are the ones that change without warning and without a
// changelog entry, because they were never promised.
//
// THE RECORD SAYS WHAT THAT COSTS. `.modal-close-button` being renamed took
// five rounds to find. A DEFERRED VIEW — a leaf Obsidian had not built yet —
// produced three separate warnings telling two writers their Obsidian "has
// no getSortedFolderItems", on a build that has it. Neither was a hard
// failure; both were a slow one, which is worse.
//
// THREE FIELDS, AND THE MIDDLE ONE IS THE POINT:
//
//   what      the name, exactly as the code asks for it
//   without   what a writer loses when it is gone — in their words, not
//             ours, because this is what a message to them has to say
//   probe     how to ask the running app, once, at load
//
// `without` IS NOT DOCUMENTATION. It is the sentence a feature shows when its
// capability is false, and having it here rather than at the call site is what
// stopped three sites from each inventing their own — and each blaming
// Obsidian for a pane that had simply not loaded yet.
//
// WHAT THIS IS NOT: it is not a list of everything the plugin touches. It is
// the list of things that are NOT PROMISED — a public, documented API needs no
// entry, because breaking it is Obsidian's bug and it will be in the release
// notes. `Menu`, `Setting`, `Modal`, `processFrontMatter`, `Platform` and the
// CSS variables belong to that other list and are deliberately absent.
export const WS_INTERNALS = [
	// ── THE FILE EXPLORER'S VIEW ────────────────────────────────────────
	//
	// The comparator patch is the one private call this plugin cannot do
	// without and cannot replace: there is no public way to order a folder.
	// `78-file-tree-order.js` argues that trade and the argument holds; what
	// it needed was to be the EXCEPTION YOU CAN LIST rather than one of a
	// scattered dozen.
	{
		id: 'explorerSort',
		kind: 'method',
		what: 'getSortedFolderItems',
		where: 'the file-explorer view',
		without: 'manuscript order is not applied to the file tree; it keeps '
			+ 'Obsidian’s own sort. Everything else still works.',
		probe: (app: App) => wsInternalView(app, 'file-explorer',
			(v) => typeof v.getSortedFolderItems === 'function')
	},
	{
		id: 'explorerResort',
		kind: 'method',
		what: 'requestSort / tree.infinityScroll.compute / fileItems[/].updateChildren',
		where: 'the file-explorer view',
		// THREE, TRIED IN ORDER, because there is no public one — see
		// `repaintExplorerOrder`. The capability is "any of them", which is
		// why this probe is an OR rather than three entries: a writer does
		// not care which one answered.
		without: 'a dragged row may not move until the folder is folded and '
			+ 'opened again.',
		probe: (app: App) => wsInternalView(app, 'file-explorer', (v) => {
			if (typeof v.requestSort === 'function') return true;
			const sc = v.tree && v.tree.infinityScroll;
			if (sc && typeof sc.compute === 'function') return true;
			const root = v.fileItems && v.fileItems['/'];
			return !!(root && typeof root.updateChildren === 'function');
		})
	},
	{
		id: 'sortMenu',
		kind: 'method',
		what: 'onHeaderMenu',
		where: 'the file-explorer view',
		without: '“Manuscript order” is not added to the file tree’s own '
			+ 'sort menu. The switch in Settings → File tree still works.',
		probe: (app: App) => wsInternalView(app, 'file-explorer',
			(v) => typeof v.onHeaderMenu === 'function')
	},
	{
		id: 'sortOrder',
		kind: 'method',
		what: 'setSortOrder',
		where: 'the file-explorer view',
		without: 'picking a sort from that menu cannot hand the tree back to '
			+ 'Obsidian’s ordering.',
		probe: (app: App) => wsInternalView(app, 'file-explorer',
			(v) => typeof v.setSortOrder === 'function')
	},
	// ── THE WORKSPACE ───────────────────────────────────────────────────
	//
	// NOT A CAPABILITY, A FACT ABOUT THE BUILD. Since 1.7.2 a sidebar leaf
	// that was not visible at startup is DEFERRED and its `view` is a stub.
	// Asking a stub for a method and reporting the answer as "this Obsidian
	// build has no …" is exactly what happened to two writers, so
	// the state has to be askable before anything else here means anything.
	{
		id: 'deferredLeaves',
		kind: 'flag',
		what: 'leaf.isDeferred',
		where: 'a workspace leaf',
		without: 'a pane that has not been opened yet cannot be told apart '
			+ 'from one that lacks a method, so a warning may name the wrong '
			+ 'cause.',
		probe: (app: App) => {
			try {
				const ls = app.workspace.getLeavesOfType('file-explorer') || [];
				return ls.length ? typeof ls[0].isDeferred === 'boolean' : null;
			} catch { return null; }
		}
	},
	// ── THE METADATA TYPE REGISTRY ──────────────────────────────────────
	{
		id: 'propertyTypes',
		kind: 'method',
		what: 'app.metadataTypeManager',
		where: 'the app',
		without: 'a property’s type is guessed from its value rather than '
			+ 'read from the vault’s registry, so a date typed as text may '
			+ 'sort as text.',
		probe: (app: App) => !!(app && app.metadataTypeManager)
	},
	// ── OBSIDIAN'S OWN DOM ──────────────────────────────────────────────
	//
	// A SELECTOR IS A PRIVATE API WITH BETTER MANNERS: it fails quietly and
	// looks like nothing happened. These are the ones this plugin cannot
	// paint without.
	//
	// `sometimes` MARKS WHAT IS LEGITIMATELY ABSENT. A menu exists only while
	// one is open, and reporting it missing at load would be a false alarm
	// every single time — the fastest way to teach a reader to ignore a
	// table. Those are probed for SHAPE, never for presence.
	{
		id: 'explorerLeaf',
		kind: 'selector',
		what: '.workspace-leaf-content[data-type="file-explorer"]',
		where: 'the workspace',
		without: 'nothing this plugin draws in the file tree is drawn at all: '
			+ 'no counts, no flags, no folder colors.',
		probe: () => wsInternalSeen('.workspace-leaf-content[data-type="file-explorer"]')
	},
	{
		id: 'treeRows',
		kind: 'selector',
		what: '.nav-file-title / .nav-folder-title',
		where: 'the file tree',
		without: 'counts, flags and goal badges have no row to attach to.',
		probe: () => wsInternalSeen('.nav-file-title, .nav-folder-title')
	},
	{
		id: 'treeChildren',
		kind: 'selector',
		what: '.tree-item-children',
		where: 'the file tree',
		without: 'a folder’s word count cannot be summed from the notes '
			+ 'under it, and the selection accent has no guide line to sit on.',
		probe: () => wsInternalSeen('.tree-item-children')
	},
	{
		id: 'editorScroller',
		kind: 'selector',
		what: '.cm-scroller',
		where: 'a markdown editor',
		sometimes: true,
		without: 'the letterbox masks and typewriter scrolling have nothing '
			+ 'to measure.',
		probe: () => wsInternalSeen('.cm-scroller')
	},
	{
		id: 'menuLayer',
		kind: 'selector',
		what: '.menu',
		where: 'an open menu',
		sometimes: true,
		without: 'a menu this plugin opens cannot be positioned or dismissed '
			+ 'by the same rules as Obsidian’s own.',
		probe: () => wsInternalSeen('.menu')
	}
];

// ONE NON-DEFERRED VIEW, asked a question. Every method probe goes through
// this so that none of them reports a method missing by asking a stub.
export function wsInternalView(app: App, type: string, ask: (v: View) => boolean) {
	try {
		const leaves = app.workspace.getLeavesOfType(type) || [];
		for (const l of leaves) {
			if (!l || l.isDeferred) continue;
			if (l.view) return !!ask(l.view);
		}
	} catch { return null; }
	// NULL IS NOT FALSE. There was no loaded pane to ask, which says nothing
	// about the build — and reporting it as "missing" blames the build for a
	// pane that was not there to ask.
	return null;
}

export function wsInternalSeen(sel: string) {
	try { return !!document.querySelector(sel); } catch { return null; }
}

// ── THE ANSWER, ONCE ────────────────────────────────────────────────────────
//
// Run at load and again when the layout settles, because half of it cannot be
// answered before there are panes. Returns capability flags, and the rows a
// diagnostics dump prints — so a writer on a build this has never seen can
// say what broke in their FIRST message rather than their third.
//
// `null` IS A THIRD ANSWER and it is kept as one. "Could not ask" and "is not
// there" are different, and collapsing them is what turned an unopened sidebar
// pane into a bug report against Obsidian.
// one line of the report: a dependence, its state at the running app, and what goes without it
export interface WsCompatRow { id: string; what: string; state: string; without: string }
export function wsCompat(app: App): { caps: Record<string, boolean | null>; rows: WsCompatRow[] } {
	const caps: Record<string, boolean | null> = {};
	const rows: WsCompatRow[] = [];
	for (const item of WS_INTERNALS) {
		let ok: boolean | null = null;
		try { ok = item.probe(app); } catch { ok = null; }
		caps[item.id] = ok;
		// ── `sometimes` IS HONOURED HERE, AND IT WAS NOT ────────────────
		//
		// The flag was declared with a comment saying an absent menu
		// “would be a false alarm every single time — the fastest way to
		// teach a reader to ignore a table”, and then nothing read it. The
		// first real run printed `MISSING menuLayer` with no menu open,
		// which is precisely the alarm that comment forbade.
		//
		// A THING THAT IS ONLY THERE SOMETIMES CANNOT BE MISSING. It is
		// “not open”, which is a fact about the moment and not about the
		// build, and it never carries the `without` sentence.
		const state = ok === true ? 'ok'
			: ok === false ? (item.sometimes ? 'not open' : 'MISSING')
				: 'unknown';
		rows.push({
			id: item.id,
			what: item.what,
			state: state,
			without: state === 'MISSING' ? item.without : ''
		});
	}
	return { caps: caps, rows: rows };
}

// The printable form, for the diagnostics dump and for a console that is
// being read by somebody who did not write this.
export function wsCompatText(report: { caps?: Record<string, boolean | null>; rows: WsCompatRow[] } | null) {
	const out: string[] = [];
	for (const r of (report && report.rows) || []) {
		// 10, BECAUSE 'not open' IS EIGHT CHARACTERS and padEnd(8) gave it no
		// gap at all: the first real run printed 'not openmenuLayer'. A column
		// width has to clear its widest word, not its expected one.
		out.push(r.state.padEnd(10) + r.id.padEnd(16) + r.what);
		if (r.without) out.push('         └ ' + r.without);
	}
	return out.join('\n');
}
