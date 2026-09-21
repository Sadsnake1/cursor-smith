// Word-Smith — Export: the manuscript export: the ticks, the window, the preview, the writers.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { MarkdownView, TFile, TFolder, Notice, Platform } from 'obsidian';
import type { WorkspaceLeaf, TAbstractFile } from 'obsidian';
import type { WsExportOpts, WsExportRun, WsExportBoolKey, WsExportStringKey, WsExportSection } from './settings';
import { wsUnderIndex } from './org-index';
import { WS_FRAME_SHELL, WS_EXPORT_FOLDER_HEADINGS_DEFAULT, WS_PAPERS, wsAnchorId, wsBuildDocx, wsCatch, wsCtxScope, wsDemoteHeadings, wsExportRoot, wsFileHeadLevel, wsFormatHasPages, wsHeadSizeEm, wsHostTint, wsInlineRuns, wsJoinMark, wsLineOfSnippet, wsLineTwips, wsPaperMicrons, wsPaperOf, wsSnippetOf, wsTitleWords, wsTocSteps, wsTwipIn, wsGlyphWord, wsIconInto, wsIsFile, wsIsFolder, wsStr, wsErrMsg, wsElOf } from './preamble';
import type WordSmith from './plugin';
import type { WsModEvent } from './plugin';

export const exportMethods = {

	// ── Export ──────────────────────────────────────────────────────────────

	// Everything in scope, in the order it will be compiled. A folder is
	// walked depth-first so the structure a writer built is the structure
	// they get; a single note is a one-item list.
	//
	// NATURAL sort, not alphabetical, and this is not a nicety: plain
	// sorting puts "Ch 10" before "Ch 2", which silently reorders a novel.
	// It is the first thing that would be reported and the last thing
	// anyone would suspect, because the file list LOOKS right in the
	// explorer, which sorts the same wrong way.
	// Every folder and markdown note in the vault, fuzzy-matched — the same
	// scorer the report and the history use, so the three finders behave
	// identically. It cannot reuse `historyKnownPaths` though, and the
	// difference matters: that lists only paths the HISTORY has seen, and a
	// writer exporting a book they have not written in since installing the
	// plugin would find nothing at all.
	exportKnownPaths(this: WordSmith) {
		const files: string[] = [], folders: string[] = [];
		const walk = (f: TFolder) => {
			for (const k of (f.children || [])) {
				if (wsIsFolder(k)) { folders.push(k.path); walk(k); }
				else if (k.extension === 'md') files.push(k.path);
			}
		};
		try { walk(this.app.vault.getRoot()); } catch (_) { wsCatch('exportKnownPaths: walk(this.app.vault.getRoot());', _); }
		return { files, folders };
	},

	// What to offer before anything is typed: the folder of the note in
	// hand and its parents, then the folders holding the most notes. A
	// picker that shows nothing until it is typed at makes the writer
	// guess what it will accept.
	exportNearbyScopes(this: WordSmith, limit: number) {
		const out: { path: string; kind: string; score: number; }[] = [];
		const seen = new Set();
		const add = (p2: string) => {
			if (!p2 || seen.has(p2)) return;
			seen.add(p2);
			out.push({ path: p2, kind: 'folder', score: 0 });
		};
		try {
			let up: TFile | TFolder | null = this.app.workspace.getActiveFile();
			up = up && up.parent ? up.parent : null;
			while (up && up.path && up.path !== '/') { add(up.path); up = up.parent; }
		} catch (_) { wsCatch('exportNearbyScopes: let up = this.app.workspace.getActiveFile();', _); }
		const known = this.exportKnownPaths();
		const count: Record<string, number> = {};
		for (const p2 of known.files) {
			const cut = p2.lastIndexOf('/');
			if (cut > 0) count[p2.slice(0, cut)] = (count[p2.slice(0, cut)] || 0) + 1;
		}
		Object.keys(count).sort((a, b) => count[b] - count[a]).forEach(add);
		return out.slice(0, limit || 8);
	},

	exportFinderMatches(this: WordSmith, query: string, limit: number) {
		const known = this.exportKnownPaths();
		// Folders score above files: exporting a folder is the common case,
		// and a folder named like its first scene should not be buried
		// under it.
		const tag = (list: string[], kind: string) => this.historyFuzzy(query, list)
			.map(m => ({ path: m.path, score: m.score + (kind === 'folder' ? 1.5 : 0), kind }));
		const all = tag(known.folders, 'folder').concat(tag(known.files, 'file'));
		all.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
		return all.slice(0, limit || 8);
	},

	exportGather(this: WordSmith, scopePath: string) {
		const vault = this.app.vault;
		const out: TFile[] = [];
		// THE EMPTY PATH MEANS THE WHOLE VAULT, AND THE APP DOES NOT AGREE:
		// `getAbstractFileByPath('')` returns null on 1.13.7 while `'/'`
		// returns the root — so the whole-vault scope once gathered NOTHING,
		// and every tick in the tree was inert. `getRoot()` first because it is
		// the API that MEANS the root; the '/' form is the fallback for a build
		// without it.
		const at = scopePath
			? vault.getAbstractFileByPath(scopePath)
			: (typeof vault.getRoot === 'function'
				? vault.getRoot()
				: vault.getAbstractFileByPath('/'));
		// a note, by shape: a stub file may be a plain object
		const isMd = (f: TAbstractFile | null): f is TFile => !!f && (f as { extension?: string }).extension === 'md';
		if (!at) return out;
		if (isMd(at)) { out.push(at); return out; }
		// THE TREE'S ORDER, WHERE THERE IS ONE. This is what putting the file
		// tree's order in `ws-export.md` was for: a writer who has dragged
		// their chapters into the order the book is in has already answered
		// "what order does this compile in", and asking them again — in a
		// second list, with a second drag — is the two-answers-to-one-question
		// fault this plugin keeps removing.
		//
		// PER FOLDER, so it composes: a folder with a stored order uses it and
		// a folder without one falls back to natural sort, in the same tree.
		// Nothing has to be ordered for this to be safe, and a vault that has
		// never switched the feature on compiles exactly as it did.
		const ordered = (folder: TFolder) => {
			const kids = (folder.children || []).slice();
			// NOT GATED ON THE MISC TOGGLE. That switch decides whether
			// OBSIDIAN'S explorer is patched — a question about somebody
			// else's tree. The order itself is a fact about the manuscript,
			// set by dragging in either tree, and the compile follows it
			// wherever it was set from. A writer who turns the explorer patch
			// off has not said their book is in a different order.
			const stored = this.treeOrderFor(folder.path === '/' ? '' : folder.path);
			if (stored.length) {
				const rank = new Map();
				for (let i = 0; i < stored.length; i++) if (!rank.has(stored[i])) rank.set(stored[i], i);
				const known: TAbstractFile[] = [], rest: TAbstractFile[] = [];
				for (const k of kids) (rank.has(k.path) ? known : rest).push(k);
				known.sort((a, b) => rank.get(a.path) - rank.get(b.path));
				// What has no stored place falls in behind, sorted the way the
				// whole list used to be — the same rule the tree draws by, so
				// a new note is in the same place in both.
				rest.sort((a, b) => {
					const af = !!(a.children), bf = !!(b.children);
					if (af !== bf) return af ? 1 : -1;
					return this.exportNatural(a.name, b.name);
				});
				return known.concat(rest);
			}
			kids.sort((a, b) => {
				// Folders after files at the same level: a chapter's own
				// notes come before its sub-scenes, which is the order a
				// reader of the tree expects.
				const af = !!(a.children), bf = !!(b.children);
				if (af !== bf) return af ? 1 : -1;
				return this.exportNatural(a.name, b.name);
			});
			return kids;
		};
		const walk = (folder: TFolder) => {
			for (const k of ordered(folder)) {
				if (wsIsFolder(k)) walk(k);
				else if (isMd(k)) out.push(k);
			}
		};
		if (wsIsFolder(at)) walk(at);
		return out;
	},

	// "Ch 2" before "Ch 10". Digit runs compare as numbers, everything else
	// as lower-cased text.
	exportNatural(this: WordSmith, a: string, b: string) {
		const re = /(\d+)|(\D+)/g;
		const ax = String(a).toLowerCase().match(re) || [];
		const bx = String(b).toLowerCase().match(re) || [];
		for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
			const an = parseInt(ax[i], 10), bn = parseInt(bx[i], 10);
			if (!isNaN(an) && !isNaN(bn)) { if (an !== bn) return an - bn; }
			else if (ax[i] !== bx[i]) return ax[i] < bx[i] ? -1 : 1;
		}
		return ax.length - bx.length;
	},

	// Apply a remembered list to what is on disk NOW. Both halves matter:
	// a file added to the folder since last time must appear (at the end,
	// where a new scene usually belongs), and a file deleted since must not
	// linger as a row pointing at nothing.
	//
	// A SET, NOT `indexOf`, so a manuscript of n scenes costs n lookups and
	// not n²/2 comparisons (251ms at 8,000 notes). A SEPARATE SET, AND NOT
	// `chosen`: a remembered file the writer UNTICKED is in `order` and not
	// in `chosen`, so the second loop would find it missing, append it a
	// second time and tick it back on.
	exportApplyRemembered(this: WordSmith, files: { path: string }[], remembered: { path: string; on?: boolean }[] | null | undefined) {
		const have = new Map(files.map((f) => [f.path, f]));
		const order = [];
		const seen = new Set();
		const chosen = new Set<string>();
		for (const r of (remembered || [])) {
			if (!have.has(r.path)) continue;
			// A STORE CAN NAME ONE PATH TWICE — synced, or hand-edited — and
			// `indexOf` used to make that harmless by accident. Kept on
			// purpose now.
			if (seen.has(r.path)) continue;
			seen.add(r.path);
			order.push(r.path);
			if (r.on) chosen.add(r.path);
		}
		for (const f of files) {
			if (seen.has(f.path)) continue;
			seen.add(f.path);
			order.push(f.path);
			// New since last time: IN by default. A scene written today and
			// silently left out of tonight's export is the worse mistake.
			chosen.add(f.path);
		}
		return { order, chosen };
	},

	exportMove(this: WordSmith, list: string[], fromPath: string, toPath: string, after: boolean) {
		const from = list.indexOf(fromPath);
		if (from === -1 || fromPath === toPath) return list;
		const out = list.slice();
		out.splice(from, 1);
		let to = out.indexOf(toPath);
		if (to === -1) return list;
		out.splice(after ? to + 1 : to, 0, fromPath);
		return out;
	},

	// Move a whole folder's run of files to another folder's place. Its own
	// function beside exportMove for the same reason: dragging cannot be
	// tested headlessly, and what matters is that a chapter arrives whole
	// and in its own order — the way a block move goes wrong is by
	// scattering, dropping or duplicating the files it carries.
	exportMoveFolder(this: WordSmith, list: string[], fromFolder: string | null, toFolder: string | null, after: string | null, folderOf: (p: string) => string) {
		if (fromFolder == null || toFolder == null || fromFolder === toFolder) return list;
		const block = list.filter((p2) => folderOf(p2) === fromFolder);
		if (!block.length) return list;
		const rest = list.filter((p2) => folderOf(p2) !== fromFolder);
		// The target's own run, in what is LEFT — computing the insertion
		// point against the original list would be off by the block just
		// removed whenever the folder moves downward.
		let at = -1;
		for (let i = 0; i < rest.length; i++) {
			if (folderOf(rest[i]) !== toFolder) continue;
			if (at === -1) at = i;
			if (after) at = i + 1;
		}
		if (at === -1) return list;
		return rest.slice(0, at).concat(block, rest.slice(at));
	},

	// The folder each row belongs to, for the headings in the list. A row
	// whose parent differs from the row above opens a new group — which
	// means a file dragged out of its chapter takes a heading with it and
	// the writer can SEE that it has moved, rather than finding out from
	// the compiled manuscript.
	exportFolderOf(this: WordSmith, path: string) {
		const cut = String(path || '').lastIndexOf('/');
		return cut === -1 ? '' : path.slice(0, cut);
	},

	// EVERY folder between the scope and the file, outermost first. The list
	// used to show ONE heading per file — its immediate parent — which is
	// the whole truth for `Book/Ch 01.md` and a lie for
	// `Book/Part One/Ch 03.md`: two parts with a "Ch 03" in each drew two
	// headings called the same thing, one after another, with no way to see
	// which was which or to fold either away.
	//
	// STARTS AT THE SCOPE, not at the vault root. A writer exporting
	// `Novels/Book Two/Manuscript` does not need three headings restating
	// where they already told the window to look; the chain begins where
	// their attention does.
	//
	// A file at the vault root gets `['']`, which is the empty-string folder
	// the list has always drawn as "Vault root" — the one path through here
	// that must not return an empty chain, or such a file would be drawn
	// with no heading at all and could not be folded.
	exportFolderChain(this: WordSmith, path: string, scope: string) {
		const dir = this.exportFolderOf(path);
		if (!dir) return [''];
		const segs = dir.split('/');
		const base = String(scope || '');
		const inScope = !!base && (dir === base || dir.indexOf(base + '/') === 0);
		const startAt = inScope ? base.split('/').length - 1 : 0;
		const out = [];
		for (let i = startAt; i < segs.length; i++) out.push(segs.slice(0, i + 1).join('/'));
		return out;
	},

	// Is this file anywhere INSIDE that folder — not merely directly in it?
	// A parent's tick, its total and its drag all cover everything beneath
	// it, which is what a folder means once folders can nest.
	exportInFolder(this: WordSmith, path: string, folder: string | null) {
		if (folder === '' || folder == null) return this.exportFolderOf(path) === '';
		return String(path || '').indexOf(folder + '/') === 0;
	},

	// A file name that will not collide and will not surprise: the scope's
	// own name, the date, and the right extension.
	// The folder the file lands in, made if it is not there. A writer who
	// exports a book six times in an afternoon gets six files, and six
	// files loose in the vault root is how a vault stops being tidy — but
	// a chosen folder that does not exist should be created rather than
	// reported, because the writer has already said what they want.
	async exportEnsureFolder(this: WordSmith, folder: string) {
		const f = String(folder || '').replace(/^\/+|\/+$/g, '');
		if (!f) return '';
		try {
			const at = this.app.vault.getAbstractFileByPath(f);
			if (at && at.children) return f;
			if (at) return '';           // a NOTE by that name: use the root
			await this.app.vault.createFolder(f);
			return f;
		} catch {
			// Already there, or not creatable. Either way the write below
			// will tell the writer more usefully than a guess here.
			const at2 = this.app.vault.getAbstractFileByPath(f);
			return at2 && at2.children ? f : '';
		}
	},

	exportFileName(this: WordSmith, scopePath: string, ext: string) {
		// A title can be typed with the characters a path cannot hold; the
		// export is named after the title.
		const base = (String(scopePath || 'export').split('/').pop() || '').replace(/\.md$/, '')
			.replace(/[\\:*?"<>|]+/g, '-').trim() || 'export';
		const d = new Date();
		const p2 = (n: number) => String(n).padStart(2, '0');
		// dd-mm-yyyy and the time, by request. The clock matters more than
		// it looks: a writer exports the same manuscript three times in an
		// afternoon, and with only a date the second export collides with
		// the first — `vault.create` throws on an existing path, so the
		// export failed rather than making a second file. Minutes are
		// enough to tell those apart and short enough to read.
		// TIME FIRST, then the date: exports of one book cluster in a
		// folder, and what tells two of them apart is nearly always the
		// hour — sorting by name then puts this afternoon's attempts in
		// the order they were made rather than scattered by day.
		return base.replace(/[\\/:*?"<>|]/g, '-') + ' '
			+ p2(d.getHours()) + '-' + p2(d.getMinutes()) + ' '
			+ p2(d.getDate()) + '-' + p2(d.getMonth() + 1) + '-' + d.getFullYear()
			+ '.' + ext;
	},

	// Read every chosen file and hand back the sections the builders take.
	// `onStep` is called with (done, total) as each file is read. Worth the
	// parameter: a novel is three hundred files and JavaScript is
	// single-threaded, so without a yield between them the window freezes
	// for the whole compile and the writer's only evidence that anything is
	// happening is that nothing is.
	async exportSections(this: WordSmith, files: TFile[], opts: WsExportOpts, onStep: ((done: number, total: number) => void) | null, scope: string) {
		const secs = [];
		let n = 0;
		// ── A HEADING WHERE A FOLDER BEGINS ─────────────────────────────
		//
		// HERE RATHER THAN IN THE THREE TARGETS. Markdown, HTML and .docx
		// each walk this list; emitting the boundary once means they all
		// get it, and a fourth target would too. The alternative is the
		// same walk written three times and drifting.
		//
		// ORDER IS ALREADY ANSWERED: the compile follows the book's order,
		// so the folders arrive in sequence and a boundary is simply the
		// point where this file's folders stop matching the last one's.
		//
		// AN EMPTY LEVEL IS STILL A HEADING, and that is deliberate. A
		// folder holding only folders emits its name with the next level
		// directly beneath it — which is exactly what a Part/Chapter split
		// looks like, and is the shape the user asking for this described.
		//
		// `depth` TRAVELS ON EVERY SECTION, folder and file alike, because
		// the targets need it twice over: to set the folder's own level, and
		// to know how far to push a file's heading down beneath it.
		const wantFolders = !!(opts && opts.folderHeadings);
		// THE SCOPE REACHES THE ROOT READER: a folder the writer picked is not
		// common context, so it keeps its name (`wsExportRoot`). AND THE TICKS'
		// OWN FOLDER IS THE PICK: the export is the vault and no caller has a
		// scope, so the reader would strip the folder every ticked file shares
		// — and a manuscript kept in one folder would get no heading at all
		// with the switch on. The folder the ticks fill is the folder the
		// writer chose; it steps up one and keeps its name.
		const paths = files.map((f: TAbstractFile) => f.path);
		const picked = scope || wsExportRoot(paths, '');
		const root = wantFolders ? wsExportRoot(paths, picked) : '';
		let seen: string[] = [];
		for (const f of files) {
			let text = '';
			try { text = await this.app.vault.read(f); } catch { continue; }
			let depth = 0;
			if (wantFolders) {
				const rel = root ? String(f.path).slice(root.length + 1) : String(f.path);
				const bits = rel.split('/').slice(0, -1);
				let i = 0;
				while (i < seen.length && i < bits.length && seen[i] === bits[i]) i++;
				for (let k = i; k < bits.length; k++) {
					secs.push({
						folder: true,
						depth: Math.min(6, k + 1),
						title: bits[k],
						markdown: '',
						path: (root ? root + '/' : '') + bits.slice(0, k + 1).join('/')
					});
				}
				seen = bits;
				depth = Math.min(6, bits.length);
			}
			secs.push({ title: f.basename, markdown: text, path: f.path, depth });
			n++;
			if (onStep && (n % 5 === 0 || n === files.length)) {
				onStep(n, files.length);
				// A REAL yield, not a microtask: awaiting an already
				// resolved promise never lets the frame paint, so the bar
				// would fill in one jump at the end — a bar that lies
				// about the one thing it exists to say.
				await new Promise((r) => window.setTimeout(r, 0));
			}
		}
		return secs;
	},

	// The Markdown target. Built first and kept, because it proves the join
	// — the order, the dividers, the section titles — with nothing binary in
	// the way, and because a writer who wants their own pipeline wants this
	// file rather than a .docx.
	exportToMarkdown(this: WordSmith, sections: WsExportSection[], o: WsExportRun) {
		const parts = [];
		if (o.titlePage) {
			parts.push('# ' + (o.title || 'Untitled'));
			if (o.author) parts.push('*by ' + o.author + '*');
			if (o.wordCount != null) {
				parts.push('*' + wsTitleWords(o) + '*');
			}
			parts.push('');
		}
		if (o.toc && sections.length > 1) {
			parts.push('## Contents\n');
			// Markdown's own heading anchors: lower case, spaces to
			// hyphens. They work in Obsidian and on GitHub, which is where
			// a compiled .md actually gets read.
			// INDENTED BY THE LEVEL THE ENTRY WILL CARRY. Two spaces per level,
			// which is what every markdown renderer reads as a nested list item.
			// With folder headings off every section is level 2 and the list comes
			// out flat.
			//
			// ── TWO SECTIONS CAN SHARE A NAME, AND THE LINKS MUST NOT ───────
			//
			// A slug of the title is the anchor here, and a NESTED contents is
			// where sibling chapters reuse scene names as a matter of course. The
			// other two targets never had it: `wsAnchorId(title, i)` takes the
			// index. Markdown cannot borrow that id — its anchors are whatever the
			// renderer derives from the heading text — so it follows the renderers'
			// own rule, which GitHub and Obsidian share: the second `Scene 3` is
			// `scene-3-1`, the third `scene-3-2`.
			const stepOf = wsTocSteps(o, sections);
			const seenSlug: Record<string, number> = {};
			sections.forEach((sec: WsExportSection) => {
				const t = sec.title || 'Section';
				const pad = '  '.repeat(stepOf(sec));
				const base = String(t).toLowerCase()
					.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
				const nth = seenSlug[base] || 0;
				seenSlug[base] = nth + 1;
				parts.push(pad + '- [' + t + '](#' + base
					+ (nth ? '-' + nth : '') + ')');
			});
			parts.push('');
		}
		sections.forEach((sec: WsExportSection, i: number) => {
			// A FOLDER IS A HEADING AND NOTHING ELSE — no divider above it, no
			// prose under it, and it does not answer to `sectionTitles`, which
			// is about whether a FILE contributes its name.
			if (sec.folder) {
				parts.push('#'.repeat(Math.min(6, sec.depth || 1)) + ' ' + sec.title + '\n');
				return;
			}
			if (o.sectionTitles && sec.title) {
				parts.push('#'.repeat(wsFileHeadLevel(o, sec)) + ' ' + sec.title + '\n');
			}
			// Frontmatter travels only if the writer asked for it — see the
			// note in wsBlocksFromMarkdown.
			let md = String(sec.markdown || '');
			if (!o.keepFrontmatter && /^---\s*\n/.test(md)) {
				md = md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
			}
			if (!o.keepComments) md = md.replace(/%%[\s\S]*?%%/g, '');
			// AND THE NOTE'S OWN HEADINGS MOVE DOWN UNDER THE FOLDER'S. See
			// `wsDemoteHeadings`: a scene opening `# The Sea` under a folder
			// heading `# Chapter 1` would outrank the chapter it is in.
			if (o.folderHeadings) md = wsDemoteHeadings(md, sec.depth || 0);
			parts.push(md.trim());
			// Only when asked for. This used to divide EVERY pair of files
			// unconditionally, which put a divider where a writer had asked
			// for a page break and nothing else — the markdown target
			// should compile what the options say, or it stops being a
			// preview of the others.
			if (o.starBetween && i < sections.length - 1) {
				parts.push('\n' + (o.divider == null ? '#' : o.divider) + '\n');
			}
		});
		return parts.join('\n') + '\n';
	},

	// ── THE EXPORT OPTIONS' DEFAULTS ────────────────────────────────────────
	//
	// CALLED BY EVERYTHING THAT READS THE OPTIONS, not by one window: the
	// Export tab, the act line, the options panel and the compile itself.
	// A default that lives inside a drawing routine is a default that a
	// caller can skip — the compile once read `undefined` for the format,
	// the divider and the running header when the window that set them
	// was not open.
	exportOptionDefaults(this: WordSmith) {
		const o = this.settings.exportOpts || (this.settings.exportOpts = {});
		const bag = o as Record<string, unknown>;
		const dflt = (k: string, v: string | boolean | number) => { if (bag[k] === undefined) bag[k] = v; };
		// MANUSCRIPT IS THE DEFAULT, rather than a preset to choose. These
		// are the values the "Manuscript" button used to write, which is
		// what nearly every writer wanted from it.
		dflt('format', 'docx');   dflt('titlePage', true);
		dflt('sectionTitles', false); dflt('pageBreaks', true);
		dflt('runningHeaderOn', true); dflt('author', '');
		dflt('divider', '#');     dflt('a4', false);
		dflt('starBetween', true);
		// Folder names as headings — off, because it changes the shape of
		// every existing export and a flat folder of scenes gains nothing.
		dflt('folderHeadings', WS_EXPORT_FOLDER_HEADINGS_DEFAULT);
		// …and these two are pinned, because the convention decides them
		// and a switch nobody moves is a switch that only takes up room.
		o.wordCountOnTitle = true;
		o.pageNumbers = true;
		// IMAGES: dropped by default and no longer PINNED. A manuscript
		// does not carry pictures, embedding one needs the binary part and
		// the EMU sizing this writer does not do, and a placeholder in the
		// middle of prose is a line an agent reads — all still true, which
		// is why the answer is still no by default. But a writer proofing
		// an illustrated piece needs to see where the pictures fall, and
		// `dropImages` is written from the switch rather than nailed shut.
		// It is stored the way the switch reads — "include" — because a
		// toggle labelled with a negative is a toggle people get backwards.
		dflt('keepImages', false);
		o.dropImages = !o.keepImages;
		dflt('keepFrontmatter', false);
		dflt('keepComments', false);
		// The two merged controls read from the booleans they write, so a
		// vault that predates them opens on whatever it already had.
		if (!o.joinMode) o.joinMode = o.pageBreaks ? 'page' : (o.starBetween ? 'divider' : 'run');
		if (!o.chapterTitles) {
		o.chapterTitles = o.sectionTitles ? 'file' : (o.keepHeadings === false ? 'none' : 'note');
		}
		// …AND THEN WRITTEN BACK FROM IT, on the way in. Reading was only
		// half the job: the drop-downs write the booleans when they CHANGE,
		// so a vault could hold joinMode 'page' beside a stale
		// starBetween: true — one saying "start a new page" and the other
		// still saying "put a mark between them". The window drew a
		// Divider box for a divider nothing would draw, and the compile
		// took the booleans. One answer decides both, from the moment the
		// window opens.
		o.pageBreaks  = o.joinMode === 'page';
		o.starBetween = o.joinMode === 'divider';
		o.sectionTitles = o.chapterTitles === 'file';
		o.keepHeadings  = o.chapterTitles === 'note';
		dflt('font', 'Times New Roman'); dflt('pt', 12);
		dflt('justify', false);   dflt('keepHeadings', true);
		dflt('smartQuotes', false); dflt('wordCountOnTitle', true);
		dflt('roundWordCount', true);
		// Which reading the list's right-hand column shows. Remembered,
		// because a writer who works by flags works by flags every time.
		if (['words', 'flag', 'pct'].indexOf(String(o.listColumn)) === -1) o.listColumn = 'words';
		dflt('pageNumbers', true);
		dflt('outFolder', '');  dflt('toc', false);  dflt('lastScope', '');
		dflt('titleText', '');
		dflt('doubleSpaced', true); dflt('indent', true);
		// SPACING, from the boolean it replaced — and written back to it on
		// the way in, for the same reason the join and heading answers are:
		// two keys saying the same thing must not be able to disagree.
		if (!o.lineSpacing) o.lineSpacing = o.doubleSpaced === false ? 'single' : 'double';
		o.doubleSpaced = o.lineSpacing !== 'single';
		// The size is stored as a number and a <select> hands back a
		// string, so it is coerced here as well as at the control: a vault
		// that has been through one is read by builders that multiply it.
		o.pt = parseInt(String(o.pt), 10) || 12;
		// Footnotes were unconditional, so absent means on.
		dflt('footnotes', true);
		dflt('highlights', false);
		// Which tab the column opens on, remembered: a writer setting up a
		// proof is in Typesetting for six exports in a row.
		// PAPER, from the boolean it replaced: a vault saved before the
		// table opens on the paper it already had rather than on Letter.
		if (!o.paperId) o.paperId = o.a4 ? 'a4' : 'letter';
		return o;
	},

	openExportModal(this: WordSmith, scopeHint?: undefined) {
		// The pane is the one door in.
		return this.orgOpenTab('export');
	},

	// ── THE FIGURES LINE HAS ONE WRITER ────────────────────
	//
	// It is written from TWO places — the preview, and the early return
	// that runs when nothing is ticked — and a line that says how much is
	// going out must not be able to disagree with itself. "notes", NOT
	// "files": what goes out is notes. "n folders · m notes · w words": the
	// folders are the ones the tree shows ticked — every note under them
	// going out; the notes are the ticked notes. No folder ticked, no
	// folder figure.
	exportFiguresText(this: WordSmith, fileCount: number, words: number, folderCount: number) {
		const folders = typeof folderCount === 'number' && folderCount > 0
			? folderCount.toLocaleString() + (folderCount === 1 ? ' folder' : ' folders') + ' \u00b7 '
			: '';
		return folders + fileCount.toLocaleString() + (fileCount === 1 ? ' note' : ' notes')
			+ ' \u00b7 ' + words.toLocaleString() + ' words';
	},

	// The folders the tree shows ticked: every note under them is going out.
	// Counted over the notes the tab gathers, so a folder outside the scope
	// is not a folder here.
	exportFoldersTicked(this: WordSmith, files: { path: string }[], ticks: { has: (p: string) => boolean } | null) {
		if (!ticks) return 0;
		const ix = wsUnderIndex(files || []);
		let n = 0;
		for (const [, under] of ix.byFolder) {
			if (under.length && under.every((p) => ticks.has(p))) n++;
		}
		return n;
	},

	// "Tick all" until everything is, then "Untick all". One element,
	// re-said wherever the figures are.
	exportTickAllSay(this: WordSmith, row: HTMLElement | null, picked: number, total: number) {
		const b = row && row.querySelector('.ws-export-tickall');
		if (!b) return;
		const all = total > 0 && picked >= total;
		// A GLYPH BEFORE THE WORD: a ticked box to tick all, an empty one to
		// untick all — the state the press leads to, as the word says.
		wsGlyphWord(b, all ? ['square'] : ['check-square', 'list-checks'], all ? 'Untick all' : 'Tick all');
		b.dataset.all = all ? '1' : '0';
	},

	// CLICK A PARAGRAPH, OPEN THE NOTE THERE, so a writer sees how their
	// text flows. ON THE FRAME'S DOCUMENT, not the pane: the paragraphs
	// live inside the iframe, and a listener outside it hears nothing.
	// READS THE STAMP the screen render puts on a section (`data-ws-note`,
	// never in a delivered file). READER ONLY: in pages a click is a click
	// on paper. A link stays a link, a selection stays a selection — a
	// writer dragging to copy a line is not leaving.
	exportReaderClicks(this: WordSmith, doc: Document | null, open: ((path: string, snippet: string, ev: MouseEvent) => unknown) | null, frame: HTMLIFrameElement) {
		// THE MEMORY LIVES ON THE DOCUMENT, WITH THE LISTENER. A paint swaps
		// the root and keeps the document AND its listeners, so the flag goes
		// where the listener is: on the root it would wire again at every
		// paint.
		if (!doc || !doc.documentElement || doc.__wsReaderClicks) return;
		doc.__wsReaderClicks = true;
		if (typeof open !== 'function') open = (path, snippet, ev) => this.openNoteAt(path, snippet, ev, frame);
		doc.addEventListener('click', (ev: MouseEvent) => {
			try {
				const t = ev.target as HTMLElement | null;
				if (!t || !t.closest) return;
				if (!doc.documentElement || !doc.documentElement.classList.contains('is-flow')) return;
				if (t.closest('a')) return;
				const sec = t.closest('section[data-ws-note]');
				if (!sec) return;
				const path = sec.getAttribute('data-ws-note');
				if (!path) return;
				try {
					const sel = doc.getSelection && doc.getSelection();
					if (sel && String(sel).length) return;
				} catch (_) { wsCatch('exportReaderClicks: const sel = doc.getSelection && doc.getSelection();', _); }
				const block = t.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre');
				if (ev.preventDefault) ev.preventDefault();
				// LIT: the block the reader is in stays marked while the note is open
				// beside it — one at a time.
				try {
					doc.querySelectorAll('.is-here').forEach((el: HTMLElement) => el.classList.remove('is-here'));
					if (block) block.classList.add('is-here');
				} catch (_) { wsCatch('exportReaderClicks: block.classList.add(is-here)', _); }
				open(path, wsSnippetOf(block ? block.textContent : ''), ev);
			} catch (_) { wsCatch('exportReaderClicks: const t = ev.target;', _); }
		});
	},

	// THE KEYS A READER EXPECTS. On the frame's document, reader only,
	// wired once per written document like the clicks. Space and PgDn page
	// down, Shift+Space and PgUp page up, the arrows step, Home and End go
	// to the ends, Escape collapses, Enter opens the section under the top
	// edge, j/k step under Obsidian's Vim and only then. A chorded key
	// belongs to whoever owns the chord; a plain letter is not ours.
	exportReaderKeys(this: WordSmith, doc: Document | null, act: { collapse?: () => void; open?: (path: string, snippet: string) => unknown; step?: (by: number) => void; vim?: () => boolean }) {
		// ON THE DOCUMENT, as the clicks are: see exportReaderClicks.
		if (!doc || !doc.documentElement || doc.__wsReaderKeys) return;
		doc.__wsReaderKeys = true;
		act = act || {};
		doc.addEventListener('keydown', (ev: KeyboardEvent) => {
			try {
				if (!doc.documentElement || !doc.documentElement.classList.contains('is-flow')) return;
				if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
				const win = doc.defaultView;
				if (!win) return;
				const page = Math.max(120, Math.round((win.innerHeight || 800) * 0.88));
				const step = 64;
				const vim = !!(typeof act.vim === 'function' && act.vim());
				let dy: number | null = null, to: number | null = null;
				switch (ev.key) {
					case ' ': dy = ev.shiftKey ? -page : page; break;
					case 'PageDown': dy = page; break;
					case 'PageUp': dy = -page; break;
					case 'ArrowDown': dy = step; break;
					case 'ArrowUp': dy = -step; break;
					case 'j': if (!vim) return; dy = step; break;
					case 'k': if (!vim) return; dy = -step; break;
					case 'Home': to = 0; break;
					case 'End': to = Math.max(1, (doc.documentElement && doc.documentElement.scrollHeight) || 1e9); break;
					// PREVIOUS AND NEXT FILE: the same jump the foot's file list and the
					// tree make, one file either way from the one at the top.
					case '[': case ']':
						ev.preventDefault();
						if (typeof act.step === 'function') act.step(ev.key === ']' ? 1 : -1);
						return;
					case 'Escape':
						ev.preventDefault();
						if (typeof act.collapse === 'function') act.collapse();
						return;
					case 'Enter': {
						ev.preventDefault();
						// THE SECTION UNDER THE TOP EDGE: the last one whose top is
						// at or above the fold, which is the one being read.
						const secs = Array.from<HTMLElement>(doc.querySelectorAll('section[data-ws-note]'));
						let hit = secs[0] || null;
						for (const sec of secs) {
							const r = sec.getBoundingClientRect();
							if (r.top <= 12) hit = sec; else break;
						}
						if (hit && typeof act.open === 'function') {
							const first = hit.querySelector('p, h1, h2, h3, h4, h5, h6, li, blockquote');
							act.open(hit.getAttribute('data-ws-note') || '', wsSnippetOf(first ? first.textContent : ''));
						}
						return;
					}
					default: return;
				}
				ev.preventDefault();
				if (to !== null) win.scrollTo(0, to);
				else win.scrollBy(0, dy || 0);
			} catch (_) { wsCatch('exportReaderKeys: if (!doc.documentElement || !doc.documentElement.classList.contains(\'i …', _); }
		});
	},

	// The note, in the pane the tree's own row click uses (`openRow`: the
	// active leaf, or a tab with a modifier), and then the caret on the
	// paragraph — the first line of the note that reads the same as the
	// clicked words. Words the note does not hold move no caret: the note
	// still opens, at the top. `frame`: the reader's own frame, when the
	// click came from one — the note opens BESIDE the reader, in one leaf
	// every next click reuses, and the reader stays where it is.
	async openNoteAt(this: WordSmith, path: string, snippet: string | null, ev?: WsModEvent, frame?: Node) {
		const newTab = !!(ev && (ev.ctrlKey || ev.metaKey));
		// THE NOTE LANDS IN THE MAIN WINDOW. `openLinkText` opens beside the
		// most recent leaf, which, when the reader lives in a pop-out, is the
		// pop-out's own — so the note opened inside the reader's window, on
		// top of the reader. The main window's most recent leaf is asked for
		// by its root; a modifier makes a tab beside it. Where the workspace
		// cannot say (an older API, a stub), the old door is the fallback.
		let view = null;
		let opened = false;
		try {
			const ws = this.app.workspace;
			const file = this.app.vault.getAbstractFileByPath(path);
			const root = ws.rootSplit;
			// THE READER’S OWN LEAF, found by the frame the click came from. The
			// most recent leaf IS the reader when the reader is a docked pane —
			// which is how the note used to land on top of it.
			let readerLeaf: WorkspaceLeaf | null = null;
			try {
				if (frame && ws.iterateAllLeaves) ws.iterateAllLeaves((l) => { if (!readerLeaf && l && l.containerEl && l.containerEl.contains && l.containerEl.contains(frame)) readerLeaf = l; });
			} catch (_) { wsCatch('openNoteAt: ws.iterateAllLeaves((l) => l.containerEl.contains(frame))', _); readerLeaf = null; }
			let leaf = null;
			if (readerLeaf && !newTab) {
				// ONE LEAF BESIDE IT, reused while it lives; split again once it is
				// closed. Never the reader itself.
				const kept = this._readerBeside;
				const alive = !!(kept && kept !== readerLeaf && ws.getLeafById && ws.getLeafById(kept.id || '') === kept);
				if (alive) leaf = kept;
				else if (ws.createLeafBySplit) { leaf = ws.createLeafBySplit(readerLeaf, 'vertical'); this._readerBeside = leaf; }
			}
			if (!leaf) leaf = (root && ws.getMostRecentLeaf) ? ws.getMostRecentLeaf(root) : null;
			if (leaf && readerLeaf && leaf === readerLeaf && !newTab && ws.createLeafBySplit) { leaf = ws.createLeafBySplit(readerLeaf, 'vertical'); this._readerBeside = leaf; }
			if (leaf && wsIsFile(file) && typeof file.extension === 'string') {
				if (newTab && leaf.parent && ws.createLeafInParent) {
					leaf = ws.createLeafInParent(leaf.parent, (leaf.parent.children || []).length);
				}
				await leaf.openFile(file, { active: true });
				view = leaf.view && leaf.view.editor ? leaf.view : null;
				opened = true;
			}
		} catch (_) { wsCatch('openNoteAt: the main window’s leaf', _); opened = false; }
		if (!opened) {
			try { await this.app.workspace.openLinkText(path, '', newTab ? 'tab' : false); }
			catch { return false; }
		}
		try {
			if (!view) view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const ed = view && view.editor;
			if (!ed || !snippet) return true;
			const line = wsLineOfSnippet(ed.getValue(), snippet);
			if (line < 0) return true;
			ed.setCursor({ line, ch: 0 });
			if (ed.scrollIntoView) ed.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
		} catch (_) { wsCatch('openNoteAt: if (!view) view = this.app.workspace.getActiveViewOfType(MarkdownView) …', _); }
		return true;
	},

	exportPreviewInto(this: WordSmith, host: HTMLElement, sections: WsExportSection[], o: WsExportRun, fileCount: number, words: number, onExport: (() => unknown) & { label?: string } | null, headHost: HTMLElement | null,
		folderCount: number, onRefresh: () => void) {
		if (!host) return null;
		// WHERE THE READER WAS, TAKEN NOW. The session's `flowScroll` is
		// written on the reader's every scroll event — and a NEW frame fires
		// one as it lays out, at zero, before `after` reads the number back.
		// So the number is read once, here, before the new frame exists, and
		// `after` restores THAT.
		const flowY0 = (this._wsSession && typeof this._wsSession.flowScroll === 'number')
			? this._wsSession.flowScroll : 0;
		// AND THE PARAGRAPH AT THE TOP, with its offset. A refresh rebuilds
		// through `paint()`, three writes of the frame's document, each at
		// scroll zero — so every paint re-arms a restore that waits for the
		// frame to be tall enough, puts the remembered paragraph back where it
		// stood (pixels when there is none — the text may have moved, a
		// paragraph index moves with it), and the read-out does not write the
		// session while that is pending, so a fresh frame's zero cannot
		// overwrite the place.
		const flowTop0 = (this._wsSession && this._wsSession.flowTop && typeof this._wsSession.flowTop.idx === 'number')
			? { idx: this._wsSession.flowTop.idx, off: Number(this._wsSession.flowTop.off) || 0 } : null;
		let restoring = false;
		const body = host.createDiv({ cls: 'ws-export-prevbody' });

		const head = (headHost || body).createDiv({ cls: 'ws-export-prevhead'
			+ (headHost ? ' is-inact' : '') });
		// BEFORE THE BUTTON IN THE DOM, not merely to its left on screen.
		// Appended, it came out last in the row and rendered third of four,
		// so a screen reader met the button before the figures it is about to
		// act on. Reading order is the order it is READ in.
		if (headHost) {
			const goBtn = headHost.querySelector('.ws-export-go');
			if (goBtn) headHost.insertBefore(head, goBtn);
		}
		head.createSpan({
			text: this.exportFiguresText(fileCount, words, folderCount) });
		// A MARKDOWN EXPORT PREVIEWS AS MARKDOWN. Showing a typeset page for
		// a .md file is a preview of a document that will not exist: none
		// of the paper, the margins or the running header survives into
		// the file, and the one thing that DOES — where the dividers and
		// the headings fall — is exactly what a page hides. The preview
		// should be of the thing being made.
		// Markdown previews as text because that is what it IS; .html and
		// .docx both preview as pages, and for .html the preview and the
		// file are literally the same document.
		const asText = o.format === 'md';
		// BORN FROM A DOCTYPE SHELL (`srcdoc`), so the frame's document is in
		// standards mode; the page itself never goes through srcdoc — it would
		// have to be HTML-escaped whole, and a manuscript is full of quotes and
		// ampersands, one mistake there turning a page of prose into markup.
		const frame = body.createEl('iframe',
			{ cls: 'ws-export-paper' + (asText ? ' is-plain' : ''), attr: { srcdoc: WS_FRAME_SHELL } });
		const html = asText
			? this.exportPreviewMarkdown(this.exportToMarkdown(sections, o))
			: this.exportToHtml(sections, o, true);

		// ── ZOOM ────────────────────────────────────────────────────────
		//
		// The sheet was drawn at its true size — 8.5 inches is 816 CSS
		// pixels — inside a frame about seven hundred wide, so a writer met
		// the page already cropped: the right margin was past the edge, and
		// the FIRST thing a preview has to show is that there are margins
		// at all. The whole point of looking is the shape of the page.
		//
		// FIT IS THE DEFAULT and it is computed, not guessed: the frame's
		// own width against the paper's own width, from the same table the
		// .docx reads, less a little air so the sheet does not touch the
		// sides. Capped at 1 — a 4.25-inch mass-market page would otherwise
		// open at 180% and look like a bug.
		const paperPx = () => (wsPaperOf(o).w / 1440) * 96;
		// ── FIT MEANS THE WHOLE PAGE ─────────────────────────────────
		//
		// Fitting by width alone is right in a tall modal and wrong in a side
		// column: the sheet comes out as wide as the frame and twice as tall,
		// so "what will page one look like" shows its top third. A page has
		// two dimensions and the smaller ratio is the one that fits both. THE
		// HEIGHT COMES FROM THE SAME TABLE AS THE WIDTH — `wsPaperOf`, which
		// the .docx reads — so the two never disagree about what US Letter is.
		const paperHighPx = () => (wsPaperOf(o).h / 1440) * 96;
		const fitZoom = () => {
			const w = frame.clientWidth || 640;
			const h = frame.clientHeight || 0;
			const byW = (w - 28) / paperPx();
			// A frame with no measured height yet must not fit to nothing.
			const byH = h > 40 ? (h - 24) / paperHighPx() : byW;
			return Math.max(0.2, Math.min(1, Math.min(byW, byH)));
		};
		// ── A CHOSEN ZOOM HAS TO OUTLIVE THE REDRAW ────────────────────
		//
		// `zoom` is a local of this method, and the pane calls this method
		// again on every option change — debounced 220ms, on change AND click
		// AND input. A zoom held only here is fitted again at the next redraw.
		//
		// A RUNTIME FIELD, NOT A SETTING. It is deliberately forgotten when
		// Obsidian restarts: a zoom is about the window you are looking at
		// now, and fit is the right answer on opening a pane you have not seen
		// yet. Nothing is written to the vault, so nothing is owed a migration.
		//
		// `null` MEANS FOLLOW THE FIT, a number means the writer chose it —
		// which is why Fit clears it rather than storing what it computed.
		// Storing the fitted number would freeze the page at whatever size the
		// pane happened to be when Fit was pressed, and it would stop
		// following the pane on the next resize.
		let zoom = 0;                      // 0 = not measured yet
		// ── AND THE READER HAS ITS OWN ───────────────────────────
		//
		// THE PAGE ZOOM IS A PAGE-FITTING DEVICE. It exists to get 8.5 inches
		// of paper into a 445px column, and in flow there is no page to fit,
		// so there is nothing for that number to be the answer to — the reader
		// would inherit half-size type. ONE, MEANING LIFE SIZE: the writer's
		// own point size, at the size they chose it. And `zoom` STAYS the
		// mechanism — scaling the document scales the type and the `ch`
		// measure together, so the column holds the same number of characters
		// at any setting, which is the one thing a reading measure must not
		// lose.
		//
		// SEPARATE FROM THE PAGE ZOOM, not shared: coming back to pages must
		// find the fit the writer left, and going back to the reader must find
		// the reading size — they are answers to different questions.
		// REMEMBERED FOR THE SESSION, on the session rather than on `this`,
		// because it is a way of LOOKING: back when you reopen the window,
		// gone when Obsidian restarts.
		let flowZoom = 1;
		try {
			const z0 = this._wsSession && this._wsSession.flowZoom;
			if (typeof z0 === 'number' && z0 > 0) flowZoom = z0;
		} catch (_) { wsCatch('exportPreviewInto: const z0 = this._wsSession && this._wsSession.flowZoom;', _); }
		let pct: HTMLElement | null = null;                  // the read-out, once the foot exists
		let fitSay: (() => void) | null = null;          // the Fit/100% toggle's word, once it exists
		let dark = !!((this.settings && this.settings.exportOpts
			&& this.settings.exportOpts.previewDark) || false);
		const applyDark = () => {
			try {
				const doc = frame.contentDocument
					|| (frame.contentWindow && frame.contentWindow.document);
				if (!doc || !doc.documentElement) return;
				doc.documentElement.classList.toggle('is-dark', dark);
			} catch (_) { wsCatch('exportPreviewInto / applyDark: const doc = frame.contentDocument', _); }
		};
		const apply = () => {
			try {
				const doc = frame.contentDocument
					|| (frame.contentWindow && frame.contentWindow.document);
				if (!doc || !doc.documentElement) return;
				// `zoom` rather than a transform: a transform scales the
				// painted result and leaves the scrollable area the size it
				// was, so the bottom of a long manuscript becomes
				// unreachable. Zoom relays out, which is what a page wants.
				doc.documentElement.style.zoom = String(flow ? flowZoom : zoom);
			} catch (_) { wsCatch('exportPreviewInto / apply: const doc = frame.contentDocument', _); }
			if (pct) pct.setText(Math.round((flow ? flowZoom : zoom) * 100) + '%');
			if (fitSay) fitSay();
			// A ZOOM RELAYS OUT, so the page the writer was on is at a different
			// `scrollLeft` than it was a moment ago. The PAGE does not change —
			// every length on the sheet scales by the same factor, so the same
			// words fall on the same page — only the number of pixels to it does.
			syncPages();
		};
		// `keep` is false only for Fit, which is a request to stop choosing.
		const setZoom = (z: number, keep?: boolean) => {
			// THE SAME BUTTONS, THE OTHER NUMBER. `+`, `−`, Fit and 100% all come
			// through here, so the reader gets working zoom controls without a
			// second row of them. AND THE READER'S SIZE IS NOT REMEMBERED ON THE
			// PLUGIN: `_exportZoom` is the FIT the writer chose for a page; a
			// reading size is about the text, and storing it there would have one
			// of them overwrite the other every time the reader was opened.
			if (flow) {
				flowZoom = Math.max(0.5, Math.min(2.5, z));
				try { if (this._wsSession) this._wsSession.flowZoom = flowZoom; } catch (_) { wsCatch('exportPreviewInto / setZoom: if (this._wsSession) this._wsSession.flowZoom = flowZoom;', _); }
				apply();
				return;
			}
			zoom = Math.max(0.25, Math.min(2, z));
			if (keep !== false) this._exportZoom = zoom;
			apply();
		};

		// ── A STACK OF PAGES, SCROLLED ─────────────────────────────
		//
		// THE DOCUMENT PAGINATES ITSELF: `.flow` is a box one page tall with
		// columns one page wide, so the engine breaks the manuscript and
		// queues the pages sideways. What the reader gets is a STACK, and the
		// two are reconciled here — a pool of sheets, each a copy of that flow
		// scrolled to its own column, laid down the stack in order.
		//
		// WHY COPIES, WHICH IS THE ONE EXPENSIVE THING HERE. A multicol box
		// shows one of its columns at a time and its columns are not elements
		// — there is no arrangement of a single flow that puts two of its
		// pages on screen at once. So a sheet needs its own flow, and the pool
		// is sized to what FITS plus a margin either side: a 213-page book
		// costs a handful of copies, never 213.
		//
		// AND THE SCROLLING IS THE BROWSER'S. The stack is as tall as the
		// book, the frame scrolls it, and nothing here listens for a wheel —
		// better than any handler: keyboard, scrollbar, trackpad momentum and
		// all.
		let pageAt = Math.max(0, Number(this._exportPage) || 0);
		let pageNum = null, prevBtn: { disabled: boolean; } | null = null, nextBtn: { disabled: boolean; } | null = null;
		let pageNow: HTMLElement | null = null, pageEst: HTMLElement | null = null;
		// ── THE READER ─────────────────────────────────────────────
		//
		// Expanded is SESSION STATE: the reader you left open is open when you
		// come back to the window, and is not after a restart. Read here
		// rather than defaulted, so a pane rebuilt by a redraw comes back the
		// way the writer left it.
		let flow = false;
		try { flow = !!(this._wsSession && this._wsSession.flow); } catch (_) { wsCatch('exportPreviewInto: flow = !!(this._wsSession && this._wsSession.flow);', _); }
		let pageBox: HTMLElement | null = null;
		// ── THE RAIL ───────────────────────────────────────────────
		//
		// IN THE PANE, NOT THE FRAME. Three reasons, in order of weight:
		//
		// • it must not scroll with the text — inside the document it would
		// ride up the page with everything else;
		// • it is furniture, so it wants the plugin's own theme variables,
		// and the frame's stylesheet is a manuscript's, not an app's;
		// • nothing that belongs to the READER should be able to reach the
		// exported file, and the frame's document is what gets written.
		//
		// It reads across the boundary the way the pager already does.
		let readPage: HTMLElement | null = null;
		// WHICH PAGE EACH PARAGRAPH IS ON, captured WHILE THE PAGES EXIST.
		// In flow there are no columns to measure, so the mapping cannot be
		// worked out there — it is taken on the way in, in one pass, and it is
		// EXACT rather than a fraction of the scroll.
		let pageOf: WeakMap<HTMLElement, number> | null = null, pagesTotal = 0;
		let pool: HTMLElement[] = [];
		const docOf = () => {
			try {
				return frame.contentDocument
					|| (frame.contentWindow && frame.contentWindow.document) || null;
			} catch { return null; }
		};
		// ONE PAGE PLUS ONE GUTTER, DOWN the stack and ACROSS the flow. Both
		// are read off the document rather than carried from the stylesheet
		// that wrote them: `--sheet-gap` has one writer, and a second copy of
		// it here would drift the day it changes.
		// the reader's page pool, measured: its document and window, the stack and the
		// first sheet, the gap, the pitch across and down, and how many pages there are
		type WsPoolMetrics = { doc: Document; win: Window; stack: HTMLElement; first: HTMLElement; gap: number; across: number; down: number; pages: number };
		const metrics = (): WsPoolMetrics | null => {
			const doc = docOf();
			const stack = doc && doc.querySelector('.stack');
			// ── NOT A HIDDEN ONE ───────────────────────────────────────
			//
			// AT THE END OF THE BOOK THE POOL RUNS OUT OF PAGES TO SHOW: two of
			// four sheets are wanted, the other two are hidden — and the FIRST
			// sheet in the document is one of them. `querySelector('.sheet')` then
			// hands back a `display: none` element, whose flow measures ZERO wide,
			// so the book measures ONE PAGE, the stack is resized to one page
			// tall, and the frame has nowhere left to be scrolled to.
			//
			// A HIDDEN ELEMENT DOES NOT ANSWER, IT DECLINES — and a zero read off
			// it is not the number zero, it is the absence of a reading. Both
			// halves are fixed here: ask a sheet that is showing, and refuse to
			// answer at all if the width comes back zero.
			const sheet = doc && (doc.querySelector('.sheet:not([hidden])')
				|| doc.querySelector('.sheet'));
			const flow = sheet && sheet.querySelector('.flow');
			if (!doc || !stack || !sheet || !flow) return null;
			const win = doc.defaultView;
			if (!win) return null;
			let gap = 18;
			try {
				const g = parseFloat(win.getComputedStyle(doc.documentElement)
					.getPropertyValue('--sheet-gap'));
				if (isFinite(g)) gap = g;
			} catch (_) { wsCatch('exportPreviewInto / metrics: const g = parseFloat(win.getComputedStyle(doc.documentElement)', _); }
			let colGap = 0;
			try {
				const g = parseFloat(win.getComputedStyle(flow).columnGap);
				if (isFinite(g)) colGap = g;
			} catch (_) { wsCatch('exportPreviewInto / metrics: const g = parseFloat(win.getComputedStyle(flow).columnGap);', _); }
			const sheetH = sheet.offsetHeight || 0;
			const across = (flow.clientWidth || 0) + colGap;
			// NOTHING TO MEASURE IS NOT A MEASUREMENT OF NOTHING. A sheet with
			// no height or no width has been hidden, or detached, or has not
			// been laid out yet — and every caller of this reads `pages` and
			// RESIZES THE STACK from it, so one bad answer collapses the book
			// and throws the reader to the top.
			if (!sheetH || (flow.clientWidth || 0) <= 0) return null;
			// THE LAST PAGE CARRIES NO TRAILING GUTTER, so one is added back
			// before dividing. Without it a two-page manuscript measures 1.9
			// pages and reads as two only because `round` was kind.
			const pages = across > 0
				? Math.max(1, Math.round((flow.scrollWidth + colGap) / across)) : 1;
			return { doc: doc, win: win, stack: stack, first: sheet,
				gap: gap, across: across, down: sheetH + gap, pages: pages };
		};
		// WHERE A SHEET SITS IN THE STACK — in the document's own CSS pixels,
		// which is what `top` takes. The zoom scales the result and leaves
		// these numbers alone, so nothing here has to know about it.
		const topOf = (m: WsPoolMetrics, n: number) => n * m.down;
		// ── THE POOL ────────────────────────────────────────────────────
		//
		// Enough sheets to fill the frame plus one either side, so a page is
		// already drawn before it is scrolled into view. Grown, never shrunk
		// within a paint: a reader who zooms out to see four pages and back
		// in should not pay for the copies twice.
		const wantPool = (m: WsPoolMetrics) => {
			let visible = 1;
			try {
				const h = frame.clientHeight || 0;
				const z = parseFloat(m.doc.documentElement.style.zoom) || 1;
				if (h > 0 && m.down > 0) visible = Math.ceil(h / (m.down * z));
			} catch (_) { wsCatch('exportPreviewInto / wantPool: const h = frame.clientHeight || 0;', _); }
			// CAPPED. Somebody at 25% on a tall screen can see a dozen pages,
			// and a dozen copies of a manuscript is a cost with no reader
			// behind it — beyond the cap the sheets past the pool simply are
			// not there, which reads as blank paper rather than as a hang.
			return Math.max(2, Math.min(8, visible + 2));
		};
		const fillPool = (m: WsPoolMetrics) => {
			const want = wantPool(m);
			// ── THE POOL DIES WITH THE DOCUMENT ──────────────────────
			//
			// `paint` writes the document up to three times, and every write
			// throws away the sheets in it. A pool that only checks whether it is
			// EMPTY then keeps a list of DETACHED nodes for ever — every clone
			// alive in an array and in no document. Anything holding on to what
			// is inside that frame is reapplied after every write, and the test is
			// IDENTITY, not emptiness.
			if (!pool.length || pool[0] !== m.first) pool = [m.first];
			while (pool.length < want) {
				// A CLONE OF THE FIRST, which already holds the manuscript —
				// so the document carries the bytes once however many sheets
				// are on screen. The layout is the cost, and it is paid once
				// per sheet rather than once per page.
				const copy = m.first.cloneNode(true) as HTMLElement;
				copy.dataset.pooled = '1';
				m.stack.appendChild(copy);
				pool.push(copy);
			}
		};
		// THE FIRST PAGE THE POOL SHOWS. One before the reader's, so the page
		// above is already drawn — but never so far along that the pool hangs
		// off the end of the book with half its sheets showing nothing.
		const windowStart = (m: WsPoolMetrics, n: number) => Math.max(0,
			Math.min(n - 1, m.pages - pool.length));

		// ── WHICH PAGE EACH SHEET SHOWS ─────────────────────────────────
		//
		// Recycled by index: a sheet already showing the page it is wanted
		// for is left alone, which is what keeps a scroll from re-laying
		// anything out. Only the sheets that have to move are touched.
		const placeSheets = (m: WsPoolMetrics, from: number) => {
			const need = [];
			for (let i = 0; i < pool.length; i++) {
				const n = from + i;
				if (n >= 0 && n < m.pages) need.push(n);
			}
			const held = new Map<number, HTMLElement>();
			for (const el of pool) {
				const at = el.dataset.page === undefined ? null : Number(el.dataset.page);
				if (at != null && need.indexOf(at) !== -1 && !held.has(at)) held.set(at, el);
			}
			const spare = pool.filter(el => {
				const at = el.dataset.page === undefined ? null : Number(el.dataset.page);
				return !(at != null && held.get(at) === el);
			});
			for (const n of need) {
				if (held.has(n)) continue;
				const el = spare.shift();
				if (!el) break;
				el.dataset.page = String(n);
				held.set(n, el);
			}
			for (const [n, el] of held) {
				el.style.top = topOf(m, n) + 'px';
				el.hidden = false;
				const flow = el.querySelector('.flow');
				if (flow) flow.scrollLeft = n * m.across;
				const hdr = el.querySelector('.hdr');
				// NOT ON THE TITLE PAGE, because the .docx does not put it
				// there: `w:titlePg` writes a separate empty first-page
				// header, and the preview is meant to be the sheet in the
				// file. The number is the PAGE — it was `counter(sheet)`,
				// which counted FILES, so a forty-page chapter said the same
				// number on all forty of its pages.
				if (hdr) {
					const bare = !!o.titlePage && n === 0;
					hdr.textContent = (!o.runningHeader || bare) ? ''
						: (o.runningHeader + ' ' + (n + 1));
				}
			}
			// A SHEET WITH NO PAGE IS HIDDEN rather than left showing page one
			// somewhere down the stack — at the end of a short book the pool is
			// bigger than the book. Built once, not once per sheet.
			const placed = new Set(held.values());
			for (const el of pool) if (!placed.has(el)) el.hidden = true;
		};
		// ── THE READ-OUT FOLLOWS THE SCROLL ─────────────────────────────
		//
		// The scroll is the truth: it is the reader's hand, and a read-out
		// that moved it would fight them mid-gesture. `showPage` below is the
		// other direction — the buttons, which land exactly on a page.
		// ── THE PARAGRAPH AT THE TOP, AS AN ELEMENT ──────────────
		//
		// Pages and flow measure position in different units: one is a column
		// index across a box one page wide, the other is a pixel offset down a
		// single column. A NUMBER carried across the flip means nothing on the
		// other side. An element means the same thing in both — and it is the
		// thing the writer is actually looking at.
		//
		// FROM `pool[0]` AND NOWHERE ELSE. The pooled copies are clones with
		// the same content at different scroll offsets, so asking one of them
		// would answer about a page the reader may not be on.
		const topNow = () => {
			try {
				const sheet = pool[0];
				const fl = sheet && sheet.querySelector('.flow');
				if (!fl) return null;
				const kids = fl.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
				if (!kids.length) return null;
				if (flow) {
					// ── ASKED OF THE VIEWPORT, NOT OF AN ANCESTOR ───────────
					//
					// `getBoundingClientRect` answers in the same units the scroll does,
					// so nothing here has to know the zoom — and nothing depends on WHICH
					// ancestor happens to be positioned. `offsetTop` would: `.sheet` is
					// `position: absolute` in pages and `static` in flow, so the offset
					// parent CHANGES with the very class this function exists to survive.
					for (const k of kids) {
						if (k.getBoundingClientRect().bottom > 0) return k;
					}
					return kids[kids.length - 1];
				}
				// PAGED: the first thing in the column the reader is on.
				// `offsetLeft` inside a multicol is the column's own offset, so
				// dividing by `across` names the page without measuring anything
				// this file does not already measure.
				const m = metrics();
				if (!m || !(m.across > 0)) return null;
				for (const k of kids) {
					if (Math.floor((k.offsetLeft + 1) / m.across) >= pageAt) return k;
				}
				return kids[kids.length - 1];
			} catch { return null; }
		};
		// AND PUT THEM BACK ON IT, on the other side of the flip. Read after
		// `flow` has already changed, so each branch is the destination's.
		const topTo = (el: HTMLElement | null) => {
			if (!el) return;
			const doc = el.ownerDocument;
			const win = doc && doc.defaultView;
			if (!win) return;
			// CALLED WITH THE LAYOUT ALREADY SETTLED — `flowSet` owns the frame,
			// because the page arithmetic has to be redone in the SAME frame as
			// the scroll and doing it here would be one rAF too late.
			try {
				if (flow) {
					// THE VIEWPORT'S OWN UNITS, both of them: a rect and a scroll
					// offset are in the same space `scrollTo` takes, so nothing
					// here has to know the zoom. A LINE OF AIR ABOVE IT, so the
					// paragraph is not welded to the top edge of the frame.
					const y = el.getBoundingClientRect().top + (win.scrollY || 0);
					win.scrollTo(0, Math.max(0, y - 12));
					return;
				}
				// ── AND COLLAPSING LANDS WHERE IT LEFT ──
				//
				// The second frame in `flowSet` is what makes this exact: the
				// scrollbar leaves with the flow class and `clientWidth` is half the
				// divisor. THE ONE CASE THAT MISSES IS ON THE OTHER SIDE OF THE TRIP:
				// flip back before the EXPAND has restored and this reads a position
				// the writer never saw. Nothing here waits that out — a settle loop
				// was tried for it and taken back out, because it missed too.
				const m = metrics();
				if (!m || !(m.across > 0)) return;
				showPage(Math.floor((el.offsetLeft + 1) / m.across));
			} catch (_) { wsCatch('exportPreviewInto / topTo: if (flow)', _); }
		};
		// ── THE FLIP. Two classes and nothing else ───────────────
		//
		// One on the iframe's root, which takes away the column rules and the
		// page frame; one on the pane's split, which folds the options column
		// away. NO RENDER, no rewrite of the frame, no second document — the
		// nodes on screen after the flip are the nodes that were there before.
		let flowSay: (() => void) | null = null;
		const flowApply = () => {
			try {
				const doc = docOf();
				if (doc && doc.documentElement) {
					doc.documentElement.classList.toggle('is-flow', flow);
				}
			} catch (_) { wsCatch('exportPreviewInto / flowApply: const doc = docOf();', _); }
			// THE PANE IS NOT OURS TO EMPTY, so the class goes on the split and
			// the stylesheet decides what that means — the same arrangement the
			// narrow layout already uses, rather than this function reaching in
			// and hiding somebody else's column.
			try {
				const split = host && host.closest && host.closest('.ws-export-split');
				if (split) split.classList.toggle('is-flow', flow);
				// THE READER TAKES THE WINDOW: the split's own flip folds the options
				// away, and one class on the body has the stylesheet give the reader
				// every column — the same shape the narrow layout draws with the
				// panel up.
				const body = split && split.closest && split.closest('.ws-uni-body');
				if (body) body.classList.toggle('is-reader', flow);
			} catch (_) { wsCatch('exportPreviewInto / flowApply: const split = host && host.closest && …', _); }
			// THE PAGE CONTROLS DESCRIBE A THING THAT IS NOT THERE. Hidden
			// rather than removed: they come back on collapse, and they are the
			// elements `syncPages` writes into.
			try { if (pageBox) pageBox.toggleClass('is-gone', flow); } catch (_) { wsCatch('exportPreviewInto / flowApply: if (pageBox) pageBox.toggleClass(\'is-gone\', flow);', _); }
			// THE ZOOM CHANGES MEANING WITH THE MODE, so it is re-written here:
			// a fit of 0.51 is right for a page and half-size for a reader.
			try { apply(); } catch (_) { wsCatch('exportPreviewInto / flowApply: apply();', _); }
			// THE RAIL IS THE READER'S, so it is raised with it and taken down
			// with it. BUILT ON FIRST USE rather than with the pane: a writer
			// who never expands never pays for it.
			// THE POSITION READ-OUT IS THE READER'S, and leaves with it. It is
			// in the footer beside the zoom, not on a rail of its own.
			try { if (readPage) readPage.toggleClass('is-gone', !flow); } catch (_) { wsCatch('exportPreviewInto / flowApply: if (readPage) readPage.toggleClass(\'is-gone\', !flow);', _); }
			try { if (readFile) { readFile.toggleClass('is-gone', !flow); if (flow) readFileSay(); } } catch (_) { wsCatch('exportPreviewInto / flowApply: readFile.toggleClass(is-gone)', _); }
			if (flowSay) { try { flowSay(); } catch (_) { wsCatch('exportPreviewInto / flowApply: flowSay();', _); } }
		};
		// ── THE PAGE OF EVERY PARAGRAPH, TAKEN ONCE ──────────────
		//
		// `offsetLeft` inside a multicol is the column's own offset, so one
		// division names the page. Read in a single pass with no writes
		// between, so the engine lays out once and every read after that is
		// off the same measurement — 2,000 paragraphs cost one reflow, not two
		// thousand. A WeakMap, so nothing here keeps a document alive after
		// the pane has thrown it away.
		const pageMap = () => {
			try {
				const m = metrics();
				const sheet = pool[0];
				const fl = sheet && sheet.querySelector('.flow');
				if (!m || !fl || !(m.across > 0)) return;
				const map = new WeakMap<HTMLElement, number>();
				const kids = fl.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
				for (const k of kids) {
					map.set(k, Math.floor((k.offsetLeft + 1) / m.across));
				}
				pageOf = map;
				pagesTotal = m.pages;
			} catch (_) { wsCatch('exportPreviewInto / pageMap: const m = metrics();', _); }
		};
		// ── WHICH PAGE THE READER IS ON ──────────────────────────
		//
		// The read-out is in the footer beside the zoom — the same row that
		// says `1 / ~259` in pages. One place for "where am I", whichever
		// mode is up. THE PAGE COUNT IS EXACT AND WEARS NO TILDE: the `~` on
		// the footer is about the DELIVERED FILE — Word lays a .docx out with
		// its own engine — and this number is about the thing on screen, which
		// the preview counted itself. NO OBSERVER: the frame's own scroll
		// event is already listened to, and this rides it.
		//
		// ── JUMPING TO A NOTE ────────────────────────────────────
		//
		// THE TREE IS THE NAVIGATION: it is where the writer already is, it
		// already shows which files are going out, and it is a list of names.
		// BY PATH, not by index: a section's position changes with the sort,
		// the scope and the tick list, and a number captured when the tree was
		// drawn would point at the wrong chapter the moment any of those moved.
		const jumpTo = (path: string) => {
			if (!flow || !path) return false;
			try {
				const doc = docOf();
				const sheet = pool[0];
				const fl = sheet && sheet.querySelector('.flow');
				if (!doc || !fl) return false;
				const esc2 = String(path).replace(/"/g, '\\"');
				const sec = fl.querySelector('section[data-ws-note="' + esc2 + '"]');
				if (!sec) return false;
				const win = doc.defaultView;
				if (!win) return false;
				// THE VIEWPORT'S OWN UNITS, the way the scroll carry does it: a
				// rect and a scroll offset are in the same space `scrollTo` takes,
				// so nothing here has to know the zoom.
				const y = sec.getBoundingClientRect().top + (win.scrollY || 0);
				win.scrollTo(0, Math.max(0, y - 12));
				return true;
			} catch { return false; }
		};
		// ── BACK TO THE PLACE, ONCE THE FRAME IS TALL ENOUGH ─────────
		//
		// The frame's document is written and laid out over a few frames; a
		// `scrollTo` before the text is there is clamped to the top and the
		// place is gone. So the restore waits — up to a dozen short beats —
		// for the document to be tall enough to hold the target, then scrolls
		// once and lets the read-out write the session again.
		const restorePlace = (tries: number) => {
			if (!restoring || !flow) { restoring = false; return; }
			try {
				const doc = docOf();
				const win = doc && doc.defaultView;
				const sheet = pool[0] || (doc && (doc.querySelector('.sheet:not([hidden])') || doc.querySelector('.sheet')));
				const fl = sheet && sheet.querySelector('.flow');
				if (!win || !fl) {
					if (tries > 0) { window.setTimeout(() => restorePlace(tries - 1), 80); return; }
					restoring = false; return;
				}
				let target = flowY0;
				if (flowTop0 && flowTop0.idx >= 0) {
					const kids = fl.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
					const k = kids[flowTop0.idx];
					if (k) target = k.getBoundingClientRect().top + (win.scrollY || 0) - flowTop0.off;
				}
				const max = Math.max(0, ((doc.documentElement && doc.documentElement.scrollHeight) || 0) - (win.innerHeight || 0));
				if (target > max + 2 && tries > 0) { window.setTimeout(() => restorePlace(tries - 1), 80); return; }
				win.scrollTo(0, Math.max(0, Math.min(target, max)));
				restoring = false;
				try { if (this._wsSession) this._wsSession.flowScroll = win.scrollY || 0; } catch (_) { wsCatch('exportPreviewInto / restorePlace: this._wsSession.flowScroll = win.scrollY', _); }
				try { readSay(); } catch (_) { wsCatch('exportPreviewInto / restorePlace: readSay();', _); }
			} catch (_) { restoring = false; wsCatch('exportPreviewInto / restorePlace: const doc = docOf();', _); }
		};
		const restoreArm = () => {
			if (!flow || !(flowY0 > 0 || (flowTop0 && flowTop0.idx >= 0))) return;
			restoring = true;
			let w = null;
			try { const d0 = docOf(); w = d0 && d0.defaultView; } catch { w = null; }
			if (w && w.requestAnimationFrame) w.requestAnimationFrame(() => restorePlace(12));
			else window.setTimeout(() => restorePlace(12), 0);
		};
		// ── WHICH FILE IS AT THE TOP, AND THE FILE LIST ──────────────
		//
		// The sections carry `data-ws-note` (the tree's `jumpTo` reads it), so
		// the file at the top is the last section whose top is at or above the
		// viewport's, and the list is the sections in order. One scroller —
		// `jumpTo` — serves the list, the keys and the tree. THE SHEET AS
		// `metrics` FINDS IT, not as the pool holds it: the pool is filled by
		// the page sync, which needs a laid-out frame, while the file list only
		// needs the sections — and they are in the document the moment it is
		// written.
		const fileSecs = () => {
			try {
				const doc = docOf();
				const sheet = pool[0] || (doc && (doc.querySelector('.sheet:not([hidden])') || doc.querySelector('.sheet')));
				const fl = sheet && sheet.querySelector('.flow');
				return fl ? Array.from<HTMLElement>(fl.querySelectorAll('section[data-ws-note]')) : [];
			} catch { return []; }
		};
		const fileAtTop = () => {
			const secs = fileSecs();
			let hit = secs[0] || null;
			for (const sec of secs) {
				try { if (sec.getBoundingClientRect().top <= 12) hit = sec; else break; } catch { break; }
			}
			return hit ? hit.getAttribute('data-ws-note') : null;
		};
		const fileStep = (by: number) => {
			const secs = fileSecs().map((s) => s.getAttribute('data-ws-note'));
			if (!secs.length) return false;
			const at = secs.indexOf(fileAtTop());
			const to = Math.max(0, Math.min(secs.length - 1, (at === -1 ? 0 : at) + by));
			return jumpTo(secs[to] || '');
		};
		let readFile: HTMLSelectElement | null = null;
		const readFileSay = () => {
			if (!flow || !readFile) return;
			try {
				const secs = fileSecs();
				const want = secs.map((s) => s.getAttribute('data-ws-note')).join('\n');
				if (readFile.getAttribute('data-ws-list') !== want) {
					readFile.empty();
					for (const s of secs) {
						const p = s.getAttribute('data-ws-note');
						const o = readFile.createEl('option', { text: (String(p).split('/').pop() || '').replace(/\.md$/i, '') });
						o.value = p || '';
					}
					readFile.setAttribute('data-ws-list', want);
				}
				const top = fileAtTop();
				if (top !== null && readFile.value !== top) readFile.value = top;
				readFile.toggleClass('is-gone', !secs.length);
			} catch (_) { wsCatch('exportPreviewInto / readFileSay: const secs = fileSecs();', _); }
		};
		const readSay = () => {
			readFileSay();
			if (!flow || !readPage) return;
			try {
				// THE SHEET AS `metrics` FINDS IT: the pool is filled by the page
				// sync, and the read-out has a place to record before that.
				const doc0 = docOf();
				const sheet = pool[0] || (doc0 && (doc0.querySelector('.sheet:not([hidden])') || doc0.querySelector('.sheet')));
				const fl = sheet && sheet.querySelector('.flow');
				const doc = fl && fl.ownerDocument;
				const win = doc && doc.defaultView;
				if (!win) return;
				// WHERE YOU HAD READ TO, recorded on the same event that moves it —
				// written on every change rather than on close: a deploy orphans this
				// window.
				const top = topNow();
				if (!restoring) {
					try {
						if (this._wsSession) {
							this._wsSession.flowScroll = win.scrollY || 0;
							if (top) {
								const kids = fl.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
								this._wsSession.flowTop = { idx: Array.prototype.indexOf.call(kids, top), off: top.getBoundingClientRect().top };
							}
						}
					} catch (_) { wsCatch('exportPreviewInto / readSay: if (this._wsSession) this._wsSession.flowScroll = win.scrollY || 0;', _); }
				}
				const n = (top && pageOf && pageOf.has(top)) ? pageOf.get(top) : null;
				// NOTHING RATHER THAN A GUESS. A paragraph the map does not know
				// — one drawn after the map was taken — has no page, and saying a
				// wrong one is worse than saying none.
				readPage.setText(n == null || !pagesTotal
					? '' : ('p. ' + (n + 1) + ' of ' + pagesTotal));
			} catch (_) { wsCatch('exportPreviewInto / readSay: const sheet = pool[0];', _); }
		};
		const flowSet = (on: boolean) => {
			const was = !!flow;
			if (was === !!on) return;
			// TAKEN ON THE WAY IN, while the columns are still there to divide
			// by. Going the other way there is nothing to capture and nothing
			// that needs it — the pager answers for itself in pages.
			if (!was) pageMap();
			// TAKEN BEFORE THE FLIP, read after it: `topNow` answers in the
			// units of the side it is on, and `topTo` in the units of the side
			// it has arrived at.
			const keep = topNow();
			flow = !!on;
			// SESSION STATE, written on the change rather than on close: a deploy
			// orphans this window and Obsidian can close it under us.
			try { if (this._wsSession) this._wsSession.flow = flow; } catch (_) { wsCatch('exportPreviewInto / flowSet: if (this._wsSession) this._wsSession.flow = flow;', _); }
			flowApply();
			// ── ONE FRAME LATER, AND BOTH THINGS IN IT ──────────────────────
			//
			// The class was flipped a moment ago and the engine has not re-laid
			// the document out; measuring now reads the shape that is going away.
			// And the two have to be in the SAME frame, in this order: `syncPages`
			// run while the document is still one column sets the stack to the
			// FLOW-shaped height, and a `showPage` after it scrolls past the end
			// of that height and is CLAMPED — half a page short. So: settle,
			// restore the height, THEN scroll into it.
			const after = () => {
				if (!flow) { try { syncPages(); } catch (_) { wsCatch('exportPreviewInto / after: syncPages();', _); } }
				// THE KEYS REACH THE FRAME ONLY IF IT HAS FOCUS: Expand hands it over,
				// so Space pages down at once rather than after a click on the paper.
				if (flow) {
					try {
						const d = docOf();
						if (d && d.body) { d.body.setAttribute('tabindex', '-1'); d.body.focus(); }
					} catch (_) { wsCatch('exportPreviewInto / after: const d = docOf();', _); }
				}
				// THE TICKS ARE PLACED FROM THE FLOWED LAYOUT, so they cannot be
				// worked out until it exists — the same frame the scroll waits
				// for, and for the same reason. And the read-out is said once on
				// arrival: riding the scroll alone leaves it empty until the
				// reader happens to move.
				if (flow) {
					// AND BACK WHERE YOU HAD READ TO — but only when this is a fresh
					// reader. `keep` is the paragraph the writer was looking at a moment
					// ago, and it beats a remembered offset from an earlier session every
					// time: one is where they ARE, the other is where they were.
					if (!keep) {
						try {
							// THE NUMBER TAKEN AT ENTRY, not the session's now — the new frame's
							// first scroll event has zeroed that.
							const y0 = flowY0;
							const d0 = docOf();
							const w0 = d0 && d0.defaultView;
							if (w0 && typeof y0 === 'number' && y0 > 0) {
								w0.scrollTo(0, y0);
								try { if (this._wsSession) this._wsSession.flowScroll = y0; } catch (_) { wsCatch('exportPreviewInto / after: this._wsSession.flowScroll = y0;', _); }
							}
						} catch (_) { wsCatch('exportPreviewInto / after: const y0 = flowY0;', _); }
					}
					try { readSay(); } catch (_) { wsCatch('exportPreviewInto / after: readSay();', _); }
				}
				// ── AND A SECOND FRAME BEFORE THE SCROLL ────────────────────
				//
				// COLLAPSING SETTLES IN TWO STEPS, not one. The class comes off and
				// the document goes back to columns; that removes the vertical
				// SCROLLBAR, which changes `clientWidth`, which is half of the `across`
				// the column arithmetic divides by — fifteen pixels of scrollbar on
				// the divisor turns 39.1 pages into 38. Expanding needs none of this —
				// it measures a RECT, which is not divided by anything. The second
				// frame is the price of the one direction that has to count columns.
				// (A settle loop that waited for `across` to answer the same twice was
				// tried here and taken back out: it fixed nothing measurable, and a
				// correction pass that does not correct is machinery somebody later
				// trusts.)
				const scroll = () => topTo(keep);
				if (!flow && win0 && win0.requestAnimationFrame) {
					win0.requestAnimationFrame(scroll);
				} else { scroll(); }
			};
			let win0: Window | null = null;
			try { const d = docOf(); win0 = d && d.defaultView; } catch (_) { wsCatch('exportPreviewInto / flowSet: const d = docOf();', _); }
			if (win0 && win0.requestAnimationFrame) win0.requestAnimationFrame(after);
			else after();
		};
		const syncPages = () => {
			// NOT IN FLOW. `metrics()` measures a sheet one page tall and divides
			// by it; in flow the sheet is as tall as the manuscript, so every
			// number it returns is arithmetic about a shape that is not there —
			// and `stack.style.height` would then be set from it, which is how a
			// reader gets thrown to the top of the book.
			if (flow) return;
			const m = metrics();
			if (!m) return;
			fillPool(m);
			m.stack.style.height = (m.pages * m.down - m.gap) + 'px';
			const z = parseFloat(m.doc.documentElement.style.zoom) || 1;
			const y = (m.win.scrollY || 0) / (z || 1);
			// ROUNDED, so the page named is the one MOST on screen: halfway
			// between two, the number turns over, which is the moment a
			// reader would say they had reached the next one.
			const at = m.down > 0 ? Math.round(y / m.down) : 0;
			pageAt = Math.max(0, Math.min(m.pages - 1, at));
			this._exportPage = pageAt;
			// ONE EITHER SIDE, so the page above and below are already drawn —
			// and SHIFTED BACK at the end of the book rather than left half
			// empty, so the last screen is as fully drawn as any other and no
			// sheet is hidden merely for being near the end.
			placeSheets(m, windowStart(m, pageAt));
			// `~` ON THE TOTAL, NOT ON THE PAGE YOU ARE ON. Which page is on
			// screen is exact — it is the sheet in front of them. How many there
			// are is this engine's answer for this paper and this type, and the
			// file may be laid out by another. One character, in the one place
			// that is actually uncertain.
			// WRITTEN TO THE TWO HALVES, never to the container: `setText` on the
			// parent would replace the estimate span — mark, title, focus and
			// all — with a text node on the first page turn.
			if (pageNow) pageNow.setText(String(pageAt + 1));
			if (pageEst) pageEst.setText('~' + m.pages);
			// A DOOR THAT LEADS NOWHERE IS SHUT. At the ends of the book the
			// arrow that cannot move says so, rather than clicking and
			// leaving a reader wondering whether the preview is stuck.
			if (prevBtn) prevBtn.disabled = pageAt <= 0;
			if (nextBtn) nextBtn.disabled = pageAt >= m.pages - 1;
		};
		const showPage = (n: number) => {
			const m = metrics();
			if (!m) return;
			fillPool(m);
			// CLAMPED AGAINST THE COUNT AS IT IS NOW. An option change can
			// make the book shorter — turning off the title page, or a
			// smaller font — and a remembered page 300 of 240 is a blank
			// frame with no way back.
			const at = Math.max(0, Math.min(m.pages - 1, n));
			// DRAWN BEFORE IT IS SCROLLED TO, or the frame lands on a sheet
			// that has not been given its page yet and shows blank paper for
			// a frame.
			placeSheets(m, windowStart(m, at));
			const z = parseFloat(m.doc.documentElement.style.zoom) || 1;
			try { m.win.scrollTo(0, topOf(m, at) * z); } catch (_) { wsCatch('exportPreviewInto / showPage: m.win.scrollTo(0, topOf(m, at) * z);', _); }
			syncPages();
		};
		// ── AND THE FRAME'S OWN SCROLLBAR DRIVES IT ─────────────────────
		//
		// RE-ARMED AFTER EVERY WRITE, NOT ONCE. `paint` runs three times, and
		// the first runs against a frame still loading `about:blank`; when
		// that load completes the browser swaps the inner window for a fresh
		// one and every listener on it goes with it. The `WindowProxy` the
		// parent holds looks the same, so nothing says so. Removing first is
		// what makes re-arming safe: the same function reference cannot be
		// bound twice, so three paints leave one listener rather than three.
		let readSoon = false;
		const onScroll = () => {
			// ONCE A FRAME, not once an event: a scroll fires dozens of times
			// a second and each read of `scrollWidth` forces the engine to
			// settle the layout before answering.
			if (readSoon) return;
			readSoon = true;
			const doc = docOf();
			const raf = (fn: () => void) => {
				const w = doc && doc.defaultView;
				try { if (w) w.requestAnimationFrame(fn); else fn(); } catch { fn(); }
			};
			raf(() => {
				readSoon = false;
				syncPages();
				// THE READ-OUT RIDES THE SAME EVENT: the scroll is already listened
				// to, already throttled to a frame, and already the moment both
				// read-outs are wrong.
				readSay();
			});
		};
		// ONE STEP PER NOTCH, and the step is proportional: 10% of where you
		// are, so the same gesture feels the same at 60% and at 200%. A fixed
		// 0.1 is a fifth of the way at the bottom of the range and a twentieth
		// at the top.
		const onWheel = (ev: WheelEvent) => {
			if (!flow || !ev || !ev.ctrlKey) return;
			try { ev.preventDefault(); } catch (_) { wsCatch('exportPreviewInto / onWheel: ev.preventDefault();', _); }
			const dir = (ev.deltaY || 0) > 0 ? -1 : 1;
			setZoom(flowZoom * (1 + dir * 0.1));
		};
		const armScroll = () => {
			if (asText) return;
			let win = null;
			try { win = frame.contentWindow; } catch (_) { wsCatch('exportPreviewInto / armScroll: win = frame.contentWindow;', _); }
			if (!win) return;
			try { win.removeEventListener('scroll', onScroll); } catch (_) { wsCatch('exportPreviewInto / armScroll: win.removeEventListener(\'scroll\', onScroll);', _); }
			try { win.addEventListener('scroll', onScroll, { passive: true }); } catch (_) { wsCatch('exportPreviewInto / armScroll: win.addEventListener(\'scroll\', onScroll, passive: true );', _); }
			// ── CTRL+WHEEL SIZES THE TEXT ────────────────────────────
			//
			// The gesture every reader already has in their hands. NOT PASSIVE,
			// and it has to be: without `preventDefault` the browser takes the
			// gesture and zooms its own page instead — the one case this file's
			// rule about passive listeners does not cover. AND ONLY WITH CTRL, AND
			// ONLY IN THE READER. A bare wheel is scrolling and must stay
			// scrolling; in pages the zoom is a page FIT, and a writer nudging it
			// by accident would lose the fit they chose with no way of knowing
			// what happened.
			try { win.removeEventListener('wheel', onWheel); } catch (_) { wsCatch('exportPreviewInto / armScroll: win.removeEventListener(\'wheel\', onWheel);', _); }
			try { win.addEventListener('wheel', onWheel, { passive: false }); } catch (_) { wsCatch('exportPreviewInto / armScroll: win.addEventListener(\'wheel\', onWheel, passive: false );', _); }
		};

		// Written through the document rather than `srcdoc`: srcdoc has to be
		// HTML-escaped whole, and a manuscript is full of quotes and
		// ampersands — one escaping mistake there turns a page of prose into
		// markup on screen. The click wiring goes on the frame's document,
		// once — the document persists across paints (the swap below keeps
		// it), so the wiring's latch lives on it.
		const paint = () => {
			try {
				const doc = frame.contentDocument
					|| (frame.contentWindow && frame.contentWindow.document);
				if (!doc) return;
				// THE ROOT IS SWAPPED, NOT THE DOCUMENT WRITTEN. The page is parsed
				// apart and its root adopted in place of the frame's: one step, no
				// blank beat, and the document — with its listeners — stays what it
				// was. (`document.write` is deprecated, and the review refuses it.)
				const fresh = new (doc.defaultView || window).DOMParser().parseFromString(html, 'text/html');
				const root = doc.adoptNode(fresh.documentElement);
				if (doc.documentElement) doc.replaceChild(root, doc.documentElement); else doc.appendChild(root);
			} catch (_) { wsCatch('exportPreviewInto / paint: const doc = frame.contentDocument', _); }
			// After every paint, because the swap replaces the root the zoom
			// and the colour were set on.
			if (!zoom) zoom = asText ? 1 : (this._exportZoom || fitZoom());
			apply();
			applyDark();
			try { this.exportReaderClicks(docOf(), null, frame); } catch (_) { wsCatch('exportPreviewInto / paint: this.exportReaderClicks(docOf(), null, frame);', _); }
			try { this.exportReaderKeys(docOf(), { collapse: () => flowSet(false), open: (p: string, sn: string | null) => this.openNoteAt(p, sn), step: (by: number) => fileStep(by), vim: () => !!(this.app.vault.getConfig && this.app.vault.getConfig('vimMode')) }); } catch (_) { wsCatch('exportPreviewInto / paint: this.exportReaderKeys(docOf(), collapse: () => flowSet(false), open: …', _); }
			// ── AND THE READER, RE-APPLIED ──────────────────────────
			//
			// `is-flow` LIVES ON THE DOCUMENT'S ROOT, and the swap replaces the
			// root: without this every recompile dropped an expanded pane back
			// into PAGE layout — inside a pane still sized for the reader, which
			// shows sheet one and sheet one alone.
			if (flow) { try { flowApply(); } catch (_) { wsCatch('exportPreviewInto / paint: flowApply();', _); } }
			armScroll();
			try { restoreArm(); } catch (_) { wsCatch('exportPreviewInto / paint: restoreArm();', _); }
			// A COUNT NEEDS A LAYOUT. `doc.close()` above has parsed the
			// document but the engine has not necessarily flowed it, and
			// `scrollWidth` on an unflowed multicol is one page. `apply` asks
			// once for the common case; this asks again on the next frame, for
			// the manuscript long enough that it did not.
			try { window.requestAnimationFrame(() => syncPages()); } catch (_) { wsCatch('exportPreviewInto / paint: window.requestAnimationFrame(() => syncPages());', _); }
		};
		// ── WRITTEN BEFORE THE EMPTY FRAME CAN BE PAINTED ───────────────
		//
		// An option change rebuilds the pane, so a NEW iframe is created, and
		// handing the writing of its document to a later tick lets the browser
		// paint the blank one in between — a flash on every change. An iframe
		// that is already in the document has a `contentDocument` the moment
		// it exists, so there is nothing to wait for. SO IT IS WRITTEN NOW.
		//
		// THE OTHER TWO STAY: `load` fires when the doctype shell lands — a
		// fresh, standards-mode document in place of the about:blank one the
		// first paint went into — and paints it; the timeout covers a browser
		// that hands back a document only after a tick. `paint` is idempotent
		// — it swaps in the same page — so running it three times costs a
		// swap and guarantees the frame is never left empty by whichever of
		// the three does not fire.
		paint();
		frame.addEventListener('load', paint);
		window.setTimeout(paint, 0);

		// THREE GROUPS, LEFT TO RIGHT: the PAGES (‹ 1 / ~4 ›), the ZOOM (−
		// 100% + and one Fit/100% toggle), the VIEW (Dark, Expand, Refresh,
		// and the file list the reader shows). A glyph on every control but
		// the two that name an act — Expand/Collapse keeps its word and Export
		// is the CTA — and every glyph-only button says its name for the
		// pointer and the reader (`title`, `aria-label`); the toggles say
		// which way they are (`aria-pressed`).
		const foot = body.createDiv({ cls: 'ws-export-prevfoot' });
		const iconBtn = (into: HTMLElement, cls: string, names: string[], glyph: string, aria: string, fn: (ev: MouseEvent) => void) => {
			const b = into.createEl('button', { cls: 'ws-export-mini ws-export-ico ' + cls });
			wsIconInto(b, names, glyph);
			b.setAttribute('aria-label', aria);
			b.title = aria;
			b.addEventListener('click', fn);
			return b;
		};
		// A MARKDOWN PREVIEW HAS NO PAGE TO FIT, so it has no zoom: the
		// controls would be there to shrink a column of plain text, which
		// is a thing a reader can do to no purpose.
		if (!asText) {
			// ── THE FLIPPER, FIRST IN THE ROW ────────────────────
			//
			// Reading the footer left to right is the order the controls are used
			// in, and which page you are on is the question a paginated preview
			// is answered by. The zoom follows it; the Export button ends the
			// looking. NOT `ws-export-pages`, WHICH IS TAKEN: that class means
			// "this control only applies to a format that has pages" and is swept
			// with `is-gone` by the format table.
			pageBox = foot.createDiv({ cls: 'ws-export-flip' });
			prevBtn = iconBtn(pageBox, 'ws-export-prev', ['chevron-left'], '\u2039', 'Previous page', () => showPage(pageAt - 1));
			// TWO PARTS, BECAUSE ONLY ONE OF THEM IS UNCERTAIN. The page you are
			// on is a fact; the total is an estimate, and the `~` is attached to
			// that half alone. Splitting them is what lets the mark below sit on
			// the estimate rather than on the whole read-out.
			pageNum = pageBox.createSpan({ cls: 'ws-export-pagenum' });
			pageNow = pageNum.createSpan({ cls: 'ws-export-pagenow', text: '1' });
			pageNum.createSpan({ cls: 'ws-export-pagesep', text: ' / ' });
			// ── A VISIBLE DOOR ON THE ESTIMATE ───────────────────
			//
			// A gesture is not a door. The `~` signals "estimate" to somebody who
			// already knows; nobody hovers a number they have no reason to
			// suspect. A dotted underline and a help cursor are the web's oldest
			// word for "there is more here", which beats inventing a second
			// vocabulary for one number.
			pageEst = pageNum.createSpan({ cls: 'ws-export-pageest', text: '~1' });
			pageEst.setAttribute('tabindex', '0');
			pageEst.setAttribute('role', 'note');
			// WHAT THE `~` MEANS, on the thing wearing it: a hover costs no room
			// and is where a reader who wonders about the tilde would put the
			// pointer. ONE CLAUSE: the count is approximate; how the preview
			// relates to the file is the mark's own business.
			pageEst.title = (o.format === 'html' || o.format === 'pdf')
				? 'Roughly this many pages — the file breaks in near enough the '
					+ 'same places.'
				: 'Roughly this many pages — Word will break the .docx its own way.';
			nextBtn = iconBtn(pageBox, 'ws-export-next', ['chevron-right'], '\u203a', 'Next page', () => showPage(pageAt + 1));
			const zoomBox = foot.createDiv({ cls: 'ws-export-zoom' });
			// ── THE BUTTONS READ THE ACTIVE ZOOM ─────────────────
			//
			// In the reader `zoom` is the page fit — a constant — so `+` computed
			// the same number from it every press and the text jumped once and
			// then never moved again. `setZoom` writes to the right number; it has
			// to be handed the right one to start from.
			const zoomNow = () => (flow ? flowZoom : zoom);
			iconBtn(zoomBox, 'ws-export-zoomout', ['zoom-out'], '\u2212', 'Zoom out', () => setZoom(zoomNow() - 0.1));
			pct = zoomBox.createSpan({ cls: 'ws-export-zoompct', text: '100%' });
			iconBtn(zoomBox, 'ws-export-zoomin', ['zoom-in'], '+', 'Zoom in', () => setZoom(zoomNow() + 0.1));
			// ONE CONTROL FOR THE TWO SIZES THAT MATTER: at any other size it
			// offers Fit; fitted, it offers the printed size (100%). Two buttons
			// said both at once, and one of them was always the size you were
			// already at.
			const fitBtn = zoomBox.createEl('button', { cls: 'ws-export-mini ws-export-fit' });
			const fitted = () => !flow && this._exportZoom == null;
			const sayFit = () => {
				const atFit = fitted();
				fitBtn.setText(atFit ? '100%' : 'Fit');
				fitBtn.title = atFit ? 'Show the page at its printed size' : 'Fit the page to the window';
				fitBtn.setAttribute('aria-label', fitBtn.title);
			};
			fitSay = sayFit;
			fitBtn.addEventListener('click', () => {
				if (fitted()) { setZoom(1); return; }
				this._exportZoom = null;
				// FIT HAS NO PAGE TO FIT IN THE READER, so it means life size —
				// the writer's own point size at the size they chose it, which is
				// what the reader opens at.
				setZoom(flow ? 1 : fitZoom(), false);
			});
			sayFit();
			// LIGHT OR DARK, and it is a property of the READING rather than of
			// the document: the sheet is white because paper is, which is right
			// for proofing and is a lamp in the face for the hour before that
			// spent reading the thing. Print resets to ink on paper regardless, so
			// this cannot reach a file.
			const viewBox = foot.createDiv({ cls: 'ws-export-view' });
			const dk = viewBox.createEl('button', { cls: 'ws-export-mini ws-export-ico ws-export-prevdark' });
			const sayDark = () => {
				wsIconInto(dk, dark ? ['sun'] : ['moon'], dark ? 'Light' : 'Dark');
				dk.title = dark ? 'Show the page as paper' : 'Dim the page for reading';
				dk.setAttribute('aria-label', dk.title);
				dk.setAttribute('aria-pressed', dark ? 'true' : 'false');
				dk.toggleClass('is-on', dark);
			};
			dk.addEventListener('click', () => {
				dark = !dark;
				// Remembered on the WINDOW's options rather than on this
				// compiled copy, which is thrown away when the preview
				// closes — a reader who wants a dark page wants it next
				// time too.
				try {
					if (this.settings && this.settings.exportOpts) {
						this.settings.exportOpts.previewDark = dark;
						void this.saveSettings();
					}
				} catch (_) { wsCatch('exportPreviewInto: if (this.settings && this.settings.exportOpts)', _); }
				applyDark();
				sayDark();
			});
			sayDark();

			// ── EXPAND ─────────────────────────────────────────────────
			//
			// Not another window — the options column folds away and the preview
			// takes the tab. A second window is an orphan, and a hidden pane that
			// goes on recompiling is waste. LAST IN THE ROW, after Light, because
			// it is the only control here that changes the SHAPE of the pane
			// rather than what is drawn in it.
			//
			// IT DOES NOT RECOMPILE. The refresh is hung on delegated listeners
			// over the whole options container, and this button is inside the
			// preview foot — which `refreshPreview` returns early for. So the flip
			// is a class and nothing else.
			//
			// WHERE YOU ARE, IN THE ROW THAT SAYS IT: the paged read-out is three
			// controls to the left of here; this is its opposite number. Before
			// the Expand button, so the button that changes the mode stays at the
			// end of the row. THE FILE LIST: a drop-down of the compiled files in
			// their order, the one at the top ticked, following the scroll as the
			// page read-out does; picking one jumps there. Only in the reader.
			const rfile = viewBox.createEl('select', { cls: 'ws-export-readfile dropdown is-gone' });
			readFile = rfile;
			rfile.title = 'Go to a file \u2014 [ and ] step through them';
			rfile.setAttribute('aria-label', 'Go to a file');
			rfile.addEventListener('change', () => {
				try { jumpTo(rfile.value); } catch (_) { wsCatch('exportPreviewInto / readFile change: jumpTo(readFile.value);', _); }
			});
			readPage = viewBox.createSpan({ cls: 'ws-export-readpage is-gone' });
			const xb = viewBox.createEl('button',
				{ cls: 'ws-export-mini ws-export-expand' });
			const expandIcon = xb.createSpan({ cls: 'ws-export-ico-in' });
			const expandWord = xb.createSpan({ cls: 'ws-export-word' });
			const sayFlow = () => {
				wsIconInto(expandIcon, flow ? ['book-open'] : ['scroll-text', 'align-justify'], '');
				// PAIRED WITH ITS OWN OTHER HALF: "Pages" named the DESTINATION while
				// "Expand" named the ACTION, so one control said two different kinds
				// of thing depending on which way round it was. Both are actions now.
				expandWord.setText(flow ? 'Collapse' : 'Expand');
				xb.title = flow
					? 'Back to the page preview'
					: 'Read the whole thing as one text';
				xb.setAttribute('aria-label', xb.title);
				// A TOGGLE SAYS WHICH WAY IT IS, to anything that cannot see it.
				xb.setAttribute('aria-pressed', flow ? 'true' : 'false');
				xb.toggleClass('is-on', flow);
			};
			xb.addEventListener('click', () => flowSet(!flow));
			sayFlow();
			flowSay = sayFlow;
			// ── REFRESH. The preview follows every change made IN THE PANE (a
			// tick, an option) 220ms behind; a change made in the NOTE reaches it
			// only on the next of those. This is the door for that: it runs the
			// same recompile, through the same `refreshPreview`, which the foot's
			// own clicks are otherwise excused from. Beside Expand, in both views
			// — a stale page is stale whichever way it is read.
			if (typeof onRefresh === 'function') {
				// ITS WORD BESIDE ITS GLYPH, as Expand has: the two acts in the row
				// are read, the adjustments beside them are glyphs.
				const rf = viewBox.createEl('button', { cls: 'ws-export-mini ws-export-refresh' });
				wsGlyphWord(rf, ['refresh-cw'], 'Refresh');
				rf.title = 'Compile again, with what the notes say now';
				rf.setAttribute('aria-label', rf.title);
				rf.addEventListener('click', (ev: MouseEvent) => {
					ev.preventDefault();
					ev.stopPropagation();
					rf.disabled = true;
					try { onRefresh(); } finally { window.setTimeout(() => { rf.disabled = false; }, 400); }
				});
			}
			// AND IF THE SESSION SAYS EXPANDED, IT OPENS EXPANDED. The class
			// goes on after the foot exists, because `flowApply` speaks to the
			// button as well as to the document.
			if (flow) flowApply();
			apply();   // the read-outs exist now, so they can be told
		}
		// The button runs the export the pane is already set up for, in the
		// format its own drop-down is showing.
		//
		// AT THE RIGHT-HAND END, past the zoom. The zoom controls change
		// what you are LOOKING at; this ends the looking. Reading the
		// footer left to right is the order the two are used in.
		if (onExport) {
			const go = foot.createEl('button', { cls: 'mod-cta ws-export-prevgo' });
			// ONE WORD, as the pane's button; a caller with a word of its own
			// passes it as `label`. (The pane passes no `onExport`, so this button
			// is on no screen today.)
			wsGlyphWord(go, ['file-output', 'download'], onExport.label || 'Export');
			go.addEventListener('click', () => { void (async () => {
					go.disabled = true;
					// THE PREVIEW STAYS OPEN. The file is written and the
					// window that reported it is still on the page a writer was
					// reading — closing it here would answer a question nobody
					// asked, and they can close it themselves in one gesture.
					try { await onExport(); } finally { go.disabled = false; }
				})();
});
		}
		// ── AND A WAY IN ─────────────────────────────────────────
		//
		// This returns the body element, and it carries the jump as well, so
		// the file tree can ask the reader to go to a note.
		try { body.wsJumpTo = jumpTo; } catch (_) { wsCatch('exportPreviewInto: body.wsJumpTo = jumpTo;', _); }
		return body;
	},

	// The compiled markdown, shown as the file it will be: monospaced,
	// wrapped, on the editor's own surface. Not rendered — a rendered
	// preview would hide the `#` dividers and the heading marks, which are
	// the whole of what a writer checks in a compiled .md.
	// ── AND IT FOLLOWS THE THEME ───────────────────────
	//
	// An iframe is a document of its own and inherits none of the host's
	// custom properties, so the value is READ OFF THE HOST and written
	// in: the theme's own editor surface and text colour, which is what a
	// writer looking at Markdown source expects to see it in. A literal
	// dark surface was a black box in a light window.
	//
	// `color-scheme` GOES WITH THEM, so the frame's scrollbar and any
	// default-coloured chrome match the sheet rather than the app's idea
	// of a fresh document.
	exportPreviewMarkdown(this: WordSmith, md: string) {
		const esc = (t: string) => String(t == null ? '' : t)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		let dark = false, bg = '#ffffff', ink = '#1f1f1f';
		try {
			dark = document.body.classList.contains('theme-dark');
			const cs = getComputedStyle(document.body);
			const b = cs.getPropertyValue('--background-primary');
			const t2 = cs.getPropertyValue('--text-normal');
			if (b && b.trim()) bg = b.trim();
			if (t2 && t2.trim()) ink = t2.trim();
		} catch (_) { wsCatch('exportPreviewMarkdown: dark = document.body.classList.contains(\'theme-dark\');', _); }
		return '<!doctype html><html><head><meta charset="utf-8"><style>'
			+ ':root { color-scheme: ' + (dark ? 'dark' : 'light') + '; }'
			+ 'html, body { margin: 0; background: ' + bg + '; }'
			+ 'pre { margin: 0; padding: 18px 20px; color: ' + ink + ';'
			+ ' font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;'
			+ ' font-size: 12px; line-height: 1.6;'
			+ ' white-space: pre-wrap; word-break: break-word; }'
			+ '</style></head><body><pre>' + esc(md) + '</pre></body></html>';
	},

	exportToHtml(this: WordSmith, sections: WsExportSection[], o: WsExportRun, forScreen: boolean) {
		const esc = (t: string) => String(t == null ? '' : t)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const parts = [];
		// TRUE FOR EXACTLY ONE SECTION: the file that comes straight after a
		// folder heading, which is already on a page of its own.
		let heldPage = false;
		// A FOLDER'S HEADING, CARRIED to the top of the next file rather than
		// printed on a sheet of its own. `pendingBreak` is whether that file
		// should open a page — the folder decided it, and the file is the one
		// that acts on it.
		let pendingFolder = '';
		let pendingBreak = false;
		if (o.titlePage) {
			parts.push('<section class="page tp"><div class="tpinner">'
				+ '<h1>' + esc(o.title || 'Untitled') + '</h1>'
				+ (o.author ? '<p>by ' + esc(o.author) + '</p>' : '')
				+ (o.wordCount != null && o.wordCountOnTitle !== false
					? '<p>' + esc(wsTitleWords(o)) + '</p>' : '')
				+ '</div></section>');
		}
		if (o.toc && sections.length > 1) {
			parts.push('<section class="page"><h2>Contents</h2><ol class="toc">');
			// INDENTED BY THE LEVEL THE ENTRY WILL CARRY. A CLASS, not an
			// inline style: this markup is also what the print path lays out,
			// and an indent a stylesheet cannot reach is one a page size
			// cannot adjust.
			const stepOf = wsTocSteps(o, sections);
			sections.forEach((sec: WsExportSection, i: number) => {
				const lv = stepOf(sec);
				parts.push('<li class="l' + lv + '"><a href="#'
					+ wsAnchorId(sec.title, i) + '">'
					+ esc(sec.title || ('Section ' + (i + 1))) + '</a></li>');
			});
			parts.push('</ol></section>');
		}
		sections.forEach((sec: WsExportSection, i: number) => {
			// ── A FOLDER HEADING OPENS A PAGE, AND KEEPS ITS FIRST CHAPTER ──
			//
			// THREE STATES, AND EACH FIXED THE LAST ONE'S REAL FAULT:
			//
			// 1. no break at all — "Part Two" printed under the last
			// paragraph of the previous chapter.
			// 2. a section of its own — which broke correctly, but `.page`
			// carries `min-height: 11in`, so the heading got a whole sheet
			// and the chapter began on the next one. Two near-empty pages.
			// 3. this: the break happens, and the heading is emitted INSIDE
			// the following file's section, at the top of it.
			//
			// `heldPage` does half of this: it exists so the file after a folder
			// does not open a SECOND page. The heading is carried rather than
			// printed, and the section that would have held it alone is never
			// opened. A FOLDER WITH NOTHING UNDER IT still gets its heading — see
			// the flush after the loop. Losing a heading because a folder happened
			// to be last would be a silent hole in the manuscript.
			if (sec.folder) {
				const lv = Math.min(6, sec.depth || 1);
				const fbrk = !!(i > 0 || o.titlePage || o.toc) && o.pageBreaks !== false;
				pendingFolder = '<h' + lv + ' class="folderhead" id="'
					+ wsAnchorId(sec.title, i) + '">' + esc(sec.title) + '</h' + lv + '>';
				pendingBreak = fbrk;
				return;
			}
			if (o.starBetween && i > 0) {
				parts.push('<p class="div">' + esc(wsJoinMark(o)) + '</p>');
			}
			// Each file opens a page when page breaks are on; otherwise the prose
			// simply runs on, which is what "continuous" means. …EXCEPT THE FILE
			// THAT FOLLOWS A FOLDER HEADING, which has just had a page opened for
			// it. A CARRIED HEADING DECIDES THE BREAK: the folder worked out
			// whether a page was owed; this section is the one that opens it, and
			// then prints the heading at the top of itself.
			const brk = pendingFolder
				? pendingBreak
				: (!heldPage
					&& (i > 0 || o.titlePage || o.toc) && o.pageBreaks !== false);
			heldPage = false;
			// ── AND WHICH NOTE IT IS, ON SCREEN ONLY ─────────────
			//
			// The tree knows a path; the reader has to be able to find the section
			// that path became. `forScreen` ONLY, and that is the whole care here:
			// this one function renders the preview AND the file, so an attribute
			// added without the gate would put vault paths into every .html and
			// .pdf a writer sends anybody. The exported bytes are unchanged, and a
			// test checks that rather than trusting this comment.
			const note = (forScreen && sec.path) ? (' data-ws-note="'
				+ esc(sec.path) + '"') : '';
			parts.push('<section class="' + (brk ? 'page' : 'run')
				+ '" id="' + wsAnchorId(sec.title, i) + '"' + note + '>');
			if (pendingFolder) {
				// ── AND IT SITS TIGHT AGAINST THE HEADING BELOW IT ──────────
				//
				// A folder heading's bottom margin collapsing with the file heading's
				// top one left 11px of air between them. MARKED HERE RATHER THAN ASKED
				// IN CSS, because the question is "is a heading about to follow" and
				// only this line knows: the stylesheet has no previous-sibling
				// selector, and `:has()` is banned in this repo. A FOLDER HEADING
				// FOLLOWED BY PROSE KEEPS ITS AIR: the class is only added when a file
				// heading really comes next.
				const tight = !!(o.sectionTitles && sec.title);
				parts.push(tight
					? pendingFolder.replace('class="folderhead"',
						'class="folderhead is-tight"')
					: pendingFolder);
				pendingFolder = '';
				pendingBreak = false;
			}
			if (o.sectionTitles && sec.title) {
				const fl = wsFileHeadLevel(o, sec);
				parts.push('<h' + fl + '>' + esc(sec.title) + '</h' + fl + '>');
			}
			let md = String(sec.markdown || '');
			// The note's own headings move down under the folder's — see
			// `wsDemoteHeadings`, and the markdown target, which does the same.
			if (o.folderHeadings) md = wsDemoteHeadings(md, sec.depth || 0);
			const fm = md.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
			if (fm) {
				md = md.slice(fm[0].length);
				// Verbatim and monospaced, because it is data — the same
				// decision the .docx makes.
				if (o.keepFrontmatter) parts.push('<pre class="fm">' + esc(fm[0].trim()) + '</pre>');
			}
			let inComment = false;
			let firstPara = true;
			for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
				const t = line.trim();
				if (!t) continue;   // …and the same in the printed target.
				// A COMMENT BLOCK — opened on its own line, closed lines
				// later, and therefore invisible to the inline stripper,
				// which is why one used to leak into the manuscript a line
				// at a time. Set apart when kept, so a note to self can
				// never be mistaken for prose.
				if (inComment) {
					if (/%%\s*$/.test(t)) inComment = false;
					if (o.keepComments) {
						const inner = t.replace(/^%%/, '').replace(/%%\s*$/, '').trim();
						if (inner) parts.push('<p class="cmt">' + esc(inner) + '</p>');
					}
					continue;
				}
				if (/^%%/.test(t)) {
					const oneLine = /^%%.*%%\s*$/.test(t);
					if (!oneLine) inComment = true;
					if (o.keepComments) {
						const inner = t.replace(/^%%/, '').replace(/%%\s*$/, '').trim();
						if (inner) parts.push('<p class="cmt">' + esc(inner) + '</p>');
					}
					firstPara = true;
					continue;
				}
				if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(t)) {
					parts.push('<p class="div">' + esc(o.divider == null ? '#' : o.divider) + '</p>');
					firstPara = true; continue;
				}
				const h = t.match(/^(#{1,6})\s+(.*)$/);
				if (h) {
					if (o.keepHeadings !== false) {
						parts.push('<h' + Math.min(3, h[1].length) + '>' + esc(h[2])
							+ '</h' + Math.min(3, h[1].length) + '>');
					}
					firstPara = true; continue;
				}
				const runs = wsInlineRuns(t, o).map(r => {
					let x = esc(r.text);
					if (r.bold) x = '<strong>' + x + '</strong>';
					if (r.ital) x = '<em>' + x + '</em>';
					// <mark>, which is what the element is FOR, and which
					// prints and reads as the yellow the .docx sets.
					if (r.high) x = '<mark>' + x + '</mark>';
					return x;
				}).join('');
				parts.push('<p' + (firstPara ? ' class="first"' : '') + '>' + runs + '</p>');
				firstPara = false;
			}
			parts.push('</section>');
		});
		// A FOLDER WITH NOTHING AFTER IT still prints its heading. The heading
		// is carried to the next file, and if there is no next file the carrier
		// would simply be dropped — a folder silently missing from the
		// manuscript, which is worse than the sheet-of-its-own this replaced.
		if (pendingFolder) {
			parts.push('<section class="' + (pendingBreak ? 'page' : 'run') + '">');
			parts.push(pendingFolder);
			parts.push('</section>');
			pendingFolder = '';
			pendingBreak = false;
		}

		// ONE LINE HEIGHT, read twice: by the body and by the title page's
		// drop, which is eight of these lines because the .docx drops eight
		// empty paragraphs. Two copies of this number would put the title in
		// two places.
		const lineH = ({ 240: '1.45', 360: '1.7', 480: '2' }[wsLineTwips(o)] || '2');
		const head = o.runningHeader ? esc(o.runningHeader) : '';
		const font = JSON.stringify(o.font || 'Times New Roman');
		const pt = o.pt || 12;
		// The same table the .docx and the RTF read, so the sheet on screen
		// is the sheet in the file — including its margins, which travel
		// with the paper because an inch of white on a 5.5-inch page is a
		// different decision from an inch on Letter.
		const paper = wsPaperOf(o);
		const pw = wsTwipIn(paper.w), ph = wsTwipIn(paper.h), pm = wsTwipIn(paper.mar);
		// THE CONTENT BOX, which is the page the preview paginates into.
		// Written as a `calc` off the same three lengths rather than worked
		// out here: one writer for the paper, and a margin changed in
		// `WS_PAPERS` cannot leave a stale number behind in this file.
		const cw = 'calc(' + pw + ' - 2 * ' + pm + ')';
		const ch = 'calc(' + ph + ' - 2 * ' + pm + ')';
		// Air between paragraphs when there is no indent to separate them —
		// see wsStylesXml. Half a line, matching the .docx's 120 twips.
		const pgap = o.indent === false ? '0.5em' : '0';
		return '<!doctype html><html><head><meta charset="utf-8">'
			+ '<title>' + esc(o.title || 'Manuscript') + '</title><style>'
			// ── THE MARGIN BOX IS THE PRINTED HEADER ────────────────────
			//
			// A MARGIN BOX IS THE ONLY THING THAT CAN PAINT IN THE MARGIN. The
			// `.page::before` below is `position: absolute` inside `.page`, and in
			// the PRINTED document `.page` carries no padding — the sheet's white
			// space is the `@page` margin, which is outside the element — so a
			// header drawn there lands half a margin DOWN INTO THE PROSE. And a
			// margin box renders ONLY when printing. SO EACH MEDIUM KEEPS THE ONE
			// THAT WORKS IN IT, and neither document carries both: this box prints
			// and is inert on screen; the `::before` is emitted only for the
			// preview, where `.page` IS a padded sheet and the header lands in its
			// white space. `size` and `margin` are what makes the document
			// printable at the manuscript's paper from any browser, and
			// `preferCSSPageSize` in `exportPdfOptions` reads them.
			+ '@page { size: ' + pw + ' ' + ph + '; margin: ' + pm + ';'
			+ (head ? ' @top-right { content: "' + head + ' " counter(page); }' : '')
			+ ' }'
			// DECLARED LIGHT. A page is white, and an iframe inherits the
			// app's colour scheme — so under a dark theme the engine was
			// treating this document as dark and everything that had not
			// been given an explicit colour came out inverted: form
			// controls, scrollbars, the default canvas behind a page that
			// had not painted yet. Saying so once here stops a manuscript
			// being previewed in a colour nobody chose.
			+ ':root { color-scheme: light; }'
			// ── THE DESK THE SHEET SITS ON ─────────────────────────
			//
			// THE THEME'S OWN SECONDARY SURFACE, so the frame belongs to the
			// window it is inset into rather than to a photograph of a desk — and
			// it follows a writer who changes theme, which a literal hex never
			// did. RESOLVED HERE, NOT PASSED AS A VARIABLE: the preview is an
			// IFRAME, a document of its own, and inherits none of the host's
			// custom properties, so `var(--background-secondary)` inside it is
			// simply unset. Read it off the host and write the value in.
			+ 'html { background: ' + (forScreen ? wsHostTint() : '#fff') + '; }'
			// THE LIT BLOCK, on screen only: the file never carries it.
			+ (forScreen ? 'html.is-flow .is-here { background: rgba(127, 127, 127, 0.14); box-shadow: 0 0 0 4px rgba(127, 127, 127, 0.14); border-radius: 2px; }' : '')
			+ 'body { margin: 0; padding: ' + (forScreen ? '18px 0' : '0') + ';'
			+ ' font-family: ' + font + ', Times, serif; font-size: ' + pt + 'pt;'
			// The same three answers the .docx sets, as CSS multiples: 240
			// twips is one line, so the ratio is the twips over 240 — with
			// a little air added to single, because a printed page at a
			// flat 1 is tighter than any word processor actually sets it.
			+ ' line-height: ' + lineH + ';'
			+ ' color: #111; }'
			// THE PAGE ITSELF, on screen: a letter-width sheet with inch
			// margins and a shadow. It is the same box print uses, so the
			// preview is not an impression of the output — it is the
			// output, shown on a desk instead of on paper.
			+ '.page, .run { background: #fff; }'
			// ── THE RUNNING HEADER, AS SOMETHING THAT ACTUALLY DRAWS ───
			//
			// The `@page` margin box above is a PRINT box: Chromium draws none of
			// them on screen, so the preview needs a header of its own. It is one
			// element, told the real page by the pane that scrolls it — a
			// per-section pseudo-element would draw the header inside the prose,
			// once per file, wherever that file happened to start, and a
			// `counter(sheet)` counted FILES, so a forty-page chapter said the
			// same number on all forty of its pages.
			//
			// NOT ON THE TITLE PAGE, because the .docx does not put it there:
			// `wantFirst = runningHeader && titlePage` writes `w:titlePg` and a
			// separate empty first-page header. SCREEN ONLY: in the printed
			// document it has no padding to sit in and lands in the prose.
			// NOT ON THE TITLE PAGE, which is why the pane empties it rather than
			// hiding the box: `w:titlePg` in the .docx gives the first sheet a
			// separate empty header, and the preview is meant to be the sheet in
			// the file.
			+ (head && forScreen
				? '.hdr { position: absolute; top: calc(' + pm + ' / 2); right: ' + pm + ';'
					// INHERITED, NOT PINNED: a pinned #111 on a dark sheet is the header
					// present and unreadable. One writer for the ink: `inherit` walks to
					// the sheet and on to the body, which is the element the dark toggle
					// moves.
					+ ' font-size: 0.9em; color: inherit; }' : '')
			// ── PAGES, NOT ONE VERY LONG SHEET ───────────────────────
			//
			// A `min-height` is a floor, not a page: each file as one `.page`
			// section given the paper's width and AT LEAST its height is a
			// forty-page chapter on one sheet forty pages tall. NO BROWSER RENDERS
			// PAGED MEDIA ON SCREEN, so nothing paginates unless this plugin does.
			//
			// SO THE ENGINE IS ASKED TO DO THE BREAKING, which it can: a box
			// exactly one content-height tall, with columns exactly one
			// content-width wide and `column-fill: auto`, fills column one to the
			// bottom of the page and starts column two. EVERY COLUMN IS A PAGE,
			// and orphans, widows and `break-before` come with it for nothing. The
			// pane scrolls the box sideways to show one. AND IT COSTS ONE LAYOUT
			// OF THE TEXT — the measuring alternative, a hidden galley with block
			// heights summed, is a second layout engine to keep.
			//
			// SCREEN ONLY. `forScreen` is false for the .html file and for the
			// .docx's source, and both keep the page-break rules at the foot of
			// this branch. A column rule reaching a file is a manuscript in
			// columns.
			+ (forScreen
				// ── A STACK OF SHEETS, SCROLLED ────────
				//
				// THE STACK IS THE SCROLLER. Its height is the whole book, the sheets
				// are positioned inside it, and the FRAME'S OWN SCROLLBAR moves
				// through them — it costs no wheel handler at all: the browser scrolls
				// a document better than any listener can.
				//
				// ONLY THE SHEETS IN VIEW EXIST. A multicol box shows ONE of its
				// columns at a time and its columns cannot be pulled apart, so two
				// pages side by side means two flows. The pane therefore keeps a small
				// POOL of sheets, each a copy of the flow scrolled to its own column,
				// and recycles them as the reader moves. A 213-page book is a handful
				// of copies, not 213.
				//
				// `--sheet-gap` IS DECLARED HERE AND READ BY THE PANE, so the air
				// between sheets has one writer.
				? ':root { --sheet-gap: 18px; }'
					+ '.stack { position: relative; width: ' + pw + '; margin: 0 auto; }'
					+ '.sheet { position: absolute; left: 0; top: 0;'
					+ ' box-sizing: border-box;'
					+ ' width: ' + pw + '; height: ' + ph + '; padding: ' + pm + ';'
					+ ' background: #fff;'
					+ ' box-shadow: 0 2px 10px rgba(0,0,0,0.45); }'
					// OUT OF FLOW WHETHER OR NOT THERE IS A HEADER TO DRAW, and the box is
					// in the markup either way so the pane has one thing to find. An empty
					// block is zero tall, so the rule is about the LAYOUT rather than the
					// contents: the flow box begins at the top of the sheet's content area
					// whatever the overlay ever comes to hold, and `height: 100%` resolves
					// against the sheet rather than against what is left of it.
					+ '.hdr { position: absolute; }'
					// THE COLUMN IS THE PAGE. `height: 100%` of a parent with a
					// definite height is itself definite, which is what
					// `column-fill: auto` requires — without it the engine
					// BALANCES, and a balanced column is a page as tall as the
					// manuscript divided by however many columns it felt like.
					//
					// NO `column-count`. Count is left auto so the used count is
					// one and the rest of the pages overflow to the right, where
					// the pane can scroll to them. Setting it to 1 would put the
					// whole manuscript in one column and paginate nothing.
					//
					// `overflow: hidden` AND NOT `clip`: hidden still makes a
					// scroll container, so `scrollLeft` moves it; clip does not,
					// and the flipper would have nothing to hold on to.
					+ '.flow { height: 100%; column-width: ' + cw + ';'
					+ ' column-gap: ' + pm + '; column-fill: auto;'
					+ ' overflow: hidden; }'
					// THE SECTIONS STOP BEING SHEETS. They keep their identity —
					// `.page` still means "this file opens a page" — and hand the
					// paper, the margins and the shadow to the one box above.
					+ '.page, .run { background: none; box-shadow: none;'
					+ ' width: auto; margin: 0; padding: 0; min-height: 0; }'
					+ '.page { break-before: column; }'
					+ '.page:first-child { break-before: avoid; }'
					// A TITLE PAGE IS A WHOLE PAGE, and it centres its three
					// lines in one — which needs a height to centre in. It had
					// `min-height` from `.page`; now it is told the content box
					// AS A LENGTH, because a percentage height inside a multicol
					// resolves against nothing an engine agrees about.
					+ '.tp { height: ' + ch + '; }'
					// ── AND THE SAME DOCUMENT, READ AS ONE TEXT ──────
					//
					// The reader is not a second render. Everything above stays exactly
					// as it is and `html.is-flow` takes two things away: the column rules
					// and the page frame. Nothing is rebuilt, no node is replaced, and
					// collapsing puts both back. THIS IS THE PRINT LAYOUT ON SCREEN: the
					// print block below does the same three things for paper. What flow
					// adds is a measure and the dark ground — print wants neither.
					+ 'html.is-flow .stack { width: auto; height: auto !important; }'
					// THE CLONES GO. The pane keeps up to eight copies of this flow, each
					// scrolled to its own column, because a multicol box shows one column
					// at a time. In flow there are no columns, so the copies are eight
					// identical manuscripts down the page. HIDDEN, NOT REMOVED: the pane
					// owns that pool and removing them here would leave it holding
					// detached nodes it still counts. `[data-pooled]` is the stamp
					// `fillPool` puts on every copy it makes, so the original is the one
					// that stays.
					+ 'html.is-flow .sheet[data-pooled] { display: none; }'
					// THE FRAME GOES, THE PAPER STAYS. `background: none` here would make
					// the sheet transparent over the frame's own dark ground, with #111
					// text on it in Light — and survive in Dark by accident, where
					// `html.is-dark .sheet` wins the tie. The sheet is the full width of
					// the reader, so the paper becomes the ground and the colours stay
					// exactly the ones the preview already uses.
					+ 'html.is-flow .sheet { position: static; width: auto;'
					+ ' height: auto; margin: 0; padding: 0;'
					+ ' box-shadow: none; min-height: 100vh; }'
					// A RUNNING HEADER IS A PROPERTY OF A PAGE. With no pages there
					// is nothing for it to head, and it would sit once at the top of
					// the whole text reading as a title.
					+ 'html.is-flow .hdr { display: none; }'
					// THE MEASURE IS PROVISIONAL AND SAYS SO. `ch` is the advance of "0":
					// exact in a monospace face, loose in a proportional one — 68ch is 68
					// characters of Courier, 85 of Times, 94 of Georgia — so one cap cannot
					// serve every face. Right for the Courier default and wide for a
					// serif.
					+ 'html.is-flow .flow { height: auto; columns: auto;'
					+ ' overflow: visible; max-width: 68ch; margin: 0 auto;'
					+ ' padding: ' + pm + ' 24px; }'
					// A SECTION NO LONGER OPENS A PAGE, because there are none.
					// `break-before` has to go here or the engine keeps a column break in
					// a document with one column and drops everything after it.
					+ 'html.is-flow .page { break-before: auto; }'
					// ── AND ONE FILE ENDS WHERE THE NEXT BEGINS ──────
					//
					// In pages the page break IS the delimiter; take the pages away and
					// every file runs into the next with one blank line between them. AIR
					// FIRST, because that is what a book uses — a chapter opening is
					// mostly white space and a reader knows it without being told.
					+ 'html.is-flow section + section { margin-top: 4em; }'
					// ── AND A DASHED LINE BETWEEN FILES ──────────────
					//
					// `currentColor` at low strength, so the mark belongs to the page and
					// needs no second declaration for the other theme.
					+ 'html.is-flow section + section::before { content: "";'
					+ ' display: block; border-top: 2px dashed currentColor;'
					+ ' opacity: 0.28; margin: 0 0 3.2em; }'
					// THE FIRST LINE AFTER A BREAK IS NOT INDENTED, which is the
					// same typographic rule `p.first` already states for the top of
					// a page — it just has nothing to key on here, because in flow
					// there is no page for a paragraph to be first on.
					+ 'html.is-flow section > p:first-child { text-indent: 0; }'
					// AND A TITLE PAGE STOPS BEING A PAGE TALL, or the reader opens
					// on eleven inches of nothing above the first line.
					+ 'html.is-flow .tp { height: auto; padding: 2em 0 3em; }'
					// THE PRINTED DOCUMENT IS NOT THE SCREEN ONE: a drop shadow is a
					// compositing effect, and asked to print one Chromium rasterises the
					// page it cannot describe in vector terms — a PDF that is a picture of
					// the text. The screen decoration is switched off for print rather
					// than the document being rebuilt — one document, two media. AND THE
					// COLUMNS GO WITH IT: print HAS paged media; asking it to also flow
					// through a fixed box would paginate twice and print one page of a
					// manuscript.
					+ '@media print {'
					// INK ON PAPER, whatever the screen was set to. The dark
					// sheet is a reading light, not a document: a manuscript
					// printed white-on-black is a ream of toner.
					+ ' html, html.is-dark { background: #fff; color-scheme: light; }'
					+ ' html.is-dark body { color: #111; }'
					+ ' html.is-dark .sheet, html.is-dark .page,'
					+ ' html.is-dark .run { background: #fff; }'
					+ ' body { padding: 0; }'
					+ ' .stack { width: auto; height: auto !important; }'
					+ ' .sheet { position: static; width: auto; height: auto;'
					+ '   padding: 0; margin: 0; box-shadow: none; }'
					+ ' .hdr { display: none; }'
					+ ' .flow { height: auto; overflow: visible; columns: auto; }'
					+ ' .tp { height: auto; }'
					+ ' .page, .run { width: auto; margin: 0; padding: 0;'
					+ '   min-height: 0; box-shadow: none; }'
					+ ' .page { page-break-before: always; break-before: page; }'
					+ ' .page:first-child { page-break-before: avoid;'
					+ '   break-before: avoid; }'
					+ '}'
				: '.page { page-break-before: always; } .page:first-child { page-break-before: avoid; }')
			+ 'p { margin: 0 0 ' + pgap + ' 0; text-indent: ' + (o.indent === false ? '0' : '0.5in') + ';'
			+ (o.justify ? ' text-align: justify;' : '')
			// Widows and orphans are the whole reason to print rather than
			// draw: one line of a paragraph alone on a page is what makes a
			// generated manuscript look generated.
			+ ' orphans: 2; widows: 2; }'
			+ 'p.first, p.div { text-indent: 0; }'
			// A DARK SHEET, for reading rather than for proofing. It is not
			// what the file looks like and it does not pretend to be — the
			// point is the hour spent reading the preview before sending
			// it, and a white page at that size is a lamp. Print always
			// resets to ink on paper (below), so nothing here can reach
			// the .docx or a PDF.
			+ 'html.is-dark { color-scheme: dark; background: #17181b; }'
			+ 'html.is-dark body { color: #dcdcdc; }'
			// `.sheet` LEADS, because on screen it is the only one of the three
			// that paints paper. `.page` and `.run` keep the colour for the
			// exported .html, which has no sheet around it.
			+ 'html.is-dark .sheet, html.is-dark .page,'
			+ ' html.is-dark .run { background: #212327; }'
			+ 'html.is-dark pre.fm { color: #b9b9b9; border-left-color: #55565a; }'
			+ 'html.is-dark p.cmt { color: #b9b9b9; border-left-color: #55565a; }'
			+ 'html.is-dark mark { background: #6c5a1e; color: #f4f0e2; }'
			+ 'html.is-dark a { color: #9cc4ff; }'
			// The two things that only appear when a writer asks for them,
			// and both are set so they cannot be mistaken for the prose
			// they sit beside: properties as data, comments as an aside.
			+ 'pre.fm { font-family: ui-monospace, Menlo, Consolas, monospace;'
			+ ' font-size: 0.8em; line-height: 1.35; white-space: pre-wrap;'
			+ ' color: #444; border-left: 2px solid #bbb; padding-left: 8px; margin: 0 0 1em; }'
			+ 'p.cmt { text-indent: 0; font-style: italic; color: #555;'
			+ ' border-left: 2px solid #bbb; padding-left: 8px; margin: 0.4em 0; }'
			+ 'p.div { text-align: center; margin: 1em 0; }'
			+ 'h1, h2, h3 { text-align: center; page-break-after: avoid; font-weight: 700; }'
			// THE SAME SIZES THE FILE USES, from the same helper — see
			// `wsHeadSizeEm`. These were 1.5em / 1.15em / 1em, which matched the
			// .docx at exactly one level out of three.
			+ 'h1, h2 { font-size: ' + wsHeadSizeEm(o, 1).toFixed(4) + 'em; }'
			+ 'h3, h4, h5, h6 { font-size: ' + wsHeadSizeEm(o, 3).toFixed(4) + 'em; }'
			// AND THE TITLE PAGE IS THE BODY SIZE IN BOLD, because `WsTitle`
			// carries no size of its own and inherits the document default.
			+ '.tp .tpinner h1 { font-size: 1em; }'
			// AND NO FIRST-LINE INDENT ON THE TITLE PAGE. `text-align: center`
			// centres the LINE BOX; `text-indent` moves the first line inside it,
			// so the base rule's half-inch indent pushed the author and the word
			// count right of the centred title. The .docx has no such indent on
			// WsTitle.
			+ '.tp .tpinner p { text-indent: 0; }'
			// ── THE TITLE SITS WHERE WORD PUTS IT ──────
			//
			// The .docx drops EIGHT EMPTY PARAGRAPHS before the title, so its drop
			// is eight lines of the body style and moves with the font size and
			// the spacing (`wsTitleDropLines`). A WHOLE-LINE DROP CANNOT CENTRE
			// THIS BLOCK on screen: 27 text lines less a 4-line block leaves an
			// ODD number to split, and the `h1` carries a top margin the line
			// count does not model. SO THE SCREEN STOPS COUNTING: the sheet is a
			// flex column and the block is centred in it, which is exact and
			// cannot drift when the paper, the point size or the spacing change.
			// `wsTitleDropLines` STAYS for the .docx — Word has no other way to
			// place a block. The two differ by less than a line, which is the
			// trade for a sheet that is never visibly off-centre.
			+ '.tp { display: flex; flex-direction: column; justify-content: center; }'
			+ '.tp .tpinner { text-align: center; }'
			// AND THE TITLE BRINGS NO MARGIN INTO THE CENTRING. The h1 carries a
			// top margin from the base rules; inside a centred flex item that
			// margin is part of the BOX, so the box centres and the words sit
			// half of it low. EVENLY SPACED, LIKE THE FILE: the .docx is three
			// consecutive paragraphs of one style, spaced by the document's line
			// height and nothing else. Zeroing the margins here says the same
			// thing in CSS. `> *` and not `> :first-child`: the h1's BOTTOM margin
			// does the same thing one line down.
			+ '.tp .tpinner > * { margin-top: 0; margin-bottom: 0; }'
			// ── A PART TITLE LOOKS LIKE ONE ────────────────────
			//
			// Letterspaced small caps, centred, at a heading's size from the same
			// helper as the rest (`wsHeadSizeEm` — a size of its own here would
			// beat the helper by specificity and the preview would differ from the
			// file). It sits at the top of its chapter's page, not on a sheet of
			// its own. 1em BELOW, WHICH IS WHAT THE .docx LEAVES: `WsHeading*`
			// carries `w:before="240"` — 240 twips is 12pt, exactly 1em of a 12pt
			// body. AND NOTHING AT ALL WHEN A HEADING FOLLOWS — BOTH SIDES, because
			// adjacent margins collapse to the LARGER: zeroing only the folder's
			// would leave the heading's own top margin and read as no change.
			+ '.folderhead.is-tight { margin-bottom: 0; }'
			+ '.folderhead.is-tight + h1, .folderhead.is-tight + h2,'
			+ ' .folderhead.is-tight + h3, .folderhead.is-tight + h4,'
			+ ' .folderhead.is-tight + h5, .folderhead.is-tight + h6'
			+ ' { margin-top: 0; }'
			+ '.folderhead { margin: 0 0 1em; text-align: center;'
			+ ' font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;'
			+ ' font-size: ' + wsHeadSizeEm(o, 1).toFixed(4) + 'em;'
			+ ' page-break-after: avoid; }'
			+ 'ol.toc { list-style: none; padding: 0; }'
			+ 'ol.toc a { color: inherit; text-decoration: none; }'
			// One rule per level rather than a calc: this stylesheet is
			// inlined into a file a writer may open in Word or a browser, and
			// six literal rules survive anything that reads CSS at all.
			// l0 IS THE MARGIN and gets no rule at all — the class counts
			// steps in from the top of this list, not heading levels, so a
			// flat contents is every entry at l0 and no padding is emitted.
			+ 'ol.toc li.l1 { padding-left: 1.5em; }'
			+ 'ol.toc li.l2 { padding-left: 3em; }'
			+ 'ol.toc li.l3 { padding-left: 4.5em; }'
			+ 'ol.toc li.l4 { padding-left: 6em; }'
			+ 'ol.toc li.l5 { padding-left: 7.5em; }'
			// ── THE SHEET IS MARKUP, NOT A SECTION ───────────────
			//
			// One paper-sized box, one header overlay in its top margin, one
			// paginating flow inside it — around the SAME sections the file gets.
			// The preview is a paginator over the export's own HTML, so there is
			// no second compile to keep in step with the first. THE FILE GETS NONE
			// OF IT: `forScreen` is false there, and the sections are the
			// document.
			+ '</style></head><body>'
			+ (forScreen
				// ONE SHEET IS EMITTED AND THE PANE CLONES IT. The document
				// carries the manuscript once; every other sheet in the pool is
				// a `cloneNode` of this one with a different column showing, so
				// the bytes are written once however many pages are on screen.
				? '<div class="stack"><div class="sheet">'
					+ '<div class="hdr"></div><div class="flow">'
					+ parts.join('\n') + '</div></div></div>'
				: parts.join('\n'))
			+ '</body></html>';
	},

	exportDefaultScope(this: WordSmith) {
		try {
			const f = this.app.workspace.getActiveFile();
			if (f && f.parent && f.parent.path && f.parent.path !== '/') return f.parent.path;
			if (f && f.path) return f.path;
		} catch (_) { wsCatch('exportDefaultScope: const f = this.app.workspace.getActiveFile();', _); }
		return '';
	},

	// ── The last export ─────────────────────────────────────────────────────
	//
	// Written at each SUCCESS, not when the button is pressed: a run that
	// failed on a name collision or a missing folder is not something to
	// offer to do again, and recording the intention rather than the outcome
	// is how a window ends up cheerfully proposing to repeat a mistake.
	//
	// Everything needed to put the window back where it was — except what
	// was TICKED, which is already remembered per scope in the export store
	// and comes back on its own the moment the scope does. That is the whole
	// reason this holds a scope rather than a list of paths: the list would
	// be a second copy of something already kept, and two copies of a set of
	// ticks is one of them going stale.
	exportRemember(this: WordSmith, scope: string, kind: string, opt: WsExportOpts, count: number, name: string) {
		try {
			if (!this.settings || !this.settings.exportOpts) return;
			this.settings.exportOpts.lastRun = {
				scope: String(scope || ''),
				format: kind,
				into: String((opt && opt.outFolder) || ''),
				files: count || 0,
				name: String(name || ''),
				at: Date.now()
			};
			void this.saveSettings();
		} catch (_) { wsCatch('exportRemember: if (!this.settings || !this.settings.exportOpts) return;', _); }
	},

	// "just now", "2 hours ago", "yesterday". Rounded down and deliberately
	// vague past a day: the point of the line is whether this was the run a
	// writer half-remembers doing, and "3 days ago" answers that where a
	// timestamp makes them do the arithmetic.
	exportWhen(this: WordSmith, at: number | null | undefined) {
		const ms = Date.now() - (at || 0);
		if (!at || ms < 0) return '';
		const min = Math.floor(ms / 60000);
		if (min < 2) return 'just now';
		if (min < 60) return min + ' minutes ago';
		const hr = Math.floor(min / 60);
		if (hr < 2) return 'an hour ago';
		if (hr < 24) return hr + ' hours ago';
		const d = Math.floor(hr / 24);
		if (d < 2) return 'yesterday';
		if (d < 31) return d + ' days ago';
		return 'a while ago';
	},

	// TASKS IN A NOTE: `- [ ]` open, anything else in the box done.
	//
	// ANYTHING ELSE, deliberately. Obsidian's own tasks are `[ ]` and `[x]`,
	// but half the community uses `[/]` for in-progress, `[-]` for dropped,
	// `[?]` for a question — and a count that called those "open" would tell
	// a writer they had work left on a scene they had finished with. Open is
	// the empty box; everything else has been touched.
	countTasks(this: WordSmith, text: string) {
		const out = { done: 0, all: 0 };
		if (!text) return out;
		const re = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[(.)\]/gm;
		let m;
		while ((m = re.exec(text)) !== null) {
			out.all++;
			if (m[1] !== ' ') out.done++;
		}
		return out;
	},

	// THE TAGS ON A NOTE, from the cache Obsidian already keeps — frontmatter
	// and inline both, because a writer who tags in one place should not find
	// half of them missing.
	tagsOf(this: WordSmith, path: string) { return this.tagsWithSource(path).map(t => t.tag); },

	// ── AND WHERE EACH ONE LIVES ───────────────────────────
	//
	// The two sources are not interchangeable to a writer: a frontmatter
	// tag can be edited from this plugin, and one written mid-sentence
	// cannot be, because removing it means editing the sentence.
	//
	// ONE READER OF THE CACHE. `tagsOf` derives from this rather than
	// reading the cache a second time, so the merged list and the sourced
	// list can never disagree about what a note carries. IN-PROSE WINS A
	// TIE: a tag in both places is ONE tag; marking it editable when half
	// of it is welded into a sentence would be a promise the editor cannot
	// keep.
	tagsWithSource(this: WordSmith, path: string) {
		const out: { tag: string; inText: boolean; }[] = [];
		const seen = new Map<string, { tag: string; inText: boolean }>();
		const add = (raw: string, inText: boolean) => {
			const tag = String(raw || '').replace(/^#/, '').trim();
			if (!tag) return;
			const had = seen.get(tag);
			if (had) { if (inText) had.inText = true; return; }
			const rec = { tag, inText: !!inText };
			seen.set(tag, rec);
			out.push(rec);
		};
		try {
			const f = this.app.vault.getAbstractFileByPath(path);
			const cache = f ? this.app.metadataCache.getFileCache(f) : null;
			// ── AND A FILE WITH NO CACHE MAY STILL HAVE TAGS ──────
			//
			// A PDF never has a metadata cache; its tags live in the store, and
			// the tags column reaches them through here. NOT `inText`: a tag in
			// the store was TYPED INTO THE ROW, not written in prose, so it is
			// ours to remove and must carry the same × as a frontmatter tag. AND
			// `!cache` IS NOT THE TEST: on a .pdf `getFileCache` returns an EMPTY
			// OBJECT, not null — truthy — so a guard written that way never fires.
			// The predicate is the one every other reader asks (`propStoreHolds`),
			// which is also why it cannot drift from them.
			if (this.propStoreHolds && this.propStoreHolds(path)) {
				let sv;
				try { sv = this.propStoreGetSync(path, 'tags'); } catch { sv = undefined; }
				const kept: string[] = Array.isArray(sv)
					? sv.map(String)
					: (typeof sv === 'string' && sv ? sv.split(/[,\s]+/) : []);
				for (const t of kept) add(t, false);
				return out;
			}
			if (!cache) return out;
			for (const t of (cache.tags || [])) add(t && t.tag, true);
			const fm: unknown = cache.frontmatter && (cache.frontmatter.tags || cache.frontmatter.tag);
			const list: string[] = Array.isArray(fm) ? fm.map(String) : (typeof fm === 'string' ? fm.split(/[,\s]+/) : []);
			for (const t of list) add(t, false);
		} catch (_) { wsCatch('tagsWithSource: const f = this.app.vault.getAbstractFileByPath(path);', _); }
		return out;
	},

	exportWhenShort(this: WordSmith, at: number) {
		if (!at) return '\u2013';
		const ms = Date.now() - at;
		if (ms < 0) return 'now';
		const min = Math.floor(ms / 60000);
		if (min < 60) return min < 2 ? 'now' : min + 'm';
		const hr = Math.floor(min / 60);
		if (hr < 24) return hr + 'h';
		const d = Math.floor(hr / 24);
		if (d < 31) return d + 'd';
		try {
			return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
		} catch { return d + 'd'; }
	},

	async exportFillCounts(this: WordSmith, files: TAbstractFile[], listWrap: HTMLElement, done: () => void, store: Map<string, number> | null) {
		for (const f of files) {
			let text = '';
			try { text = await this.app.vault.cachedRead(f); } catch (_) { wsCatch('exportFillCounts: text = await this.app.vault.cachedRead(f);', _); }
			const n = this.countWords(text);
			if (store) store.set(f.path, n);
			const el = listWrap.querySelector('[data-path="' + CSS.escape(f.path) + '"]');
			if (el) { el.setAttribute('data-words', String(n)); el.setText(n.toLocaleString()); }
		}
		if (done) done();
	},

	// The options a target actually receives: the window's, plus the three
	// derived from the scope. Split out because the preview must be given
	// EXACTLY what the export will be \u2014 a preview assembled separately is
	// a preview of something else, and the running header drifted first.
	exportOptsFor(this: WordSmith, scope: string, o: WsExportOpts, words: number): WsExportRun {
		// The writer's title if they gave one, the folder's name if not.
		// Trimmed, because a box someone tabbed through holding a space is
		// a title of one space, and it would go on the title page.
		const typed = String(o.titleText || '').trim();
		// The vault's name when there is no folder to be named after (the
		// export is the vault), before 'Untitled'.
		const title = typed
			|| (String(scope || '').split('/').pop() || '').replace(/\.md$/, '')
			|| (this.vaultName && this.vaultName())
			|| 'Untitled';
		return Object.assign({}, o, {
			title, wordCount: words,
			// WRITTEN HERE, not left in the stored options: the switch a
			// writer sees says "include", the three builders ask "drop",
			// and the one place both are true is the moment of compiling.
			// Deriving it at the edge also means a vault saved with the
			// old pinned value cannot contradict the switch.
			dropImages: !o.keepImages,
			runningHeader: o.runningHeaderOn
				? ((o.author ? o.author.split(/\s+/).pop() + ' / ' : '') + title + ' /')
				: ''
		});
	},

	// ── THE ACT, as a line anybody can ask for ──────────────────────────────
	//
	// What to make, where to put it, look at it, make it — the top line of
	// the Export tab. `ctx` is what belongs to the WINDOW rather than to
	// the act:
	//
	// scope()        the folder this export is about — the compiled file's
	// name, and what the store remembers ticks against
	// compileList()  the files, in order, ticked only. ONE function, because
	// Export and Preview must be handed the same list: a
	// preview of a different book is worse than no preview,
	// and it is a bug nobody reports because it looks like
	// the export working
	// onDone()       what the window does afterwards
	//
	// The progress handle comes back out, because the caller owns the
	// container this was drawn into.
	//
	// ── THE PREVIEW COLUMN IS AS TALL AS THE PANEL SHOWS ────────
	//
	// A sticky column as tall as the thing it is meant to stay beside
	// never sticks: it scrolls away with the options and its foot is off
	// screen whenever they are taller than the pane. So the column takes
	// the height the panel SHOWS, from where it stands at scroll 0 to the
	// panel's bottom, and the stylesheet lets it stand at its own height
	// (`is-fit`) rather than the row's. A ResizeObserver on the panel
	// keeps the number true as the window and the pane move; the page
	// frame inside is `flex: 1` and fills what it is given. Read in the
	// body's zoom: rects are in window pixels, the height is in the
	// column's own.
	exportPrevColFit(this: WordSmith, panel: HTMLElement, split: HTMLElement, prevCol: HTMLElement) {
		const win = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || window;
		if (!win || typeof win.ResizeObserver !== 'function') return;
		const fit = () => {
			if (!split.isConnected) { try { ro.disconnect(); } catch { /* gone */ } return; }
			try {
				const body = split.closest('.ws-uni-body');
				const z = Number(body && win.getComputedStyle(body).zoom) || 1;
				const pr = panel.getBoundingClientRect();
				const sr = split.getBoundingClientRect();
				const rise = parseFloat(win.getComputedStyle(prevCol).marginTop) || 0;
				const padB = parseFloat(win.getComputedStyle(panel).paddingBottom) || 0;
				const top0 = (sr.top - pr.top) / z + panel.scrollTop + rise;
				const h = Math.floor(panel.clientHeight - top0 - padB);
				if (!(h > 0)) { split.classList.remove('is-fit'); return; }
				split.style.setProperty('--ws-export-prevh', h + 'px');
				split.classList.add('is-fit');
			} catch (_) { wsCatch('exportPrevColFit / fit', _); }
		};
		const ro = new win.ResizeObserver(() => fit());
		try { ro.observe(panel); ro.observe(split); } catch (_) { wsCatch('exportPrevColFit: ro.observe(panel);', _); }
		// AND BY HAND after every preview (`_wsFit`): the observer answers
		// only while the window renders — an occluded window gets no frame and
		// no callback — and the first sync reading below can land on a pane
		// that is not yet sized.
		split._wsFit = fit;
		fit();
	},

	buildExportAct(this: WordSmith, into: HTMLElement, ctx: { scope: () => string; compileList: () => TFile[]; total: () => number; tickAll: (on: boolean) => void; onDone: () => void }) {
		// THE DEFAULTS ARE ENSURED HERE, not by whoever opened a window. See
		// `exportOptionDefaults`.
		this.exportOptionDefaults();
		const o = this.settings.exportOpts || (this.settings.exportOpts = {});
		let exportProgress: { show: (done: number, total: number, what: string) => void; hide: () => void } | null = null;
		const fmt = into.createDiv({ cls: 'ws-export-fmt' });
		// TICK ALL / UNTICK ALL, left of "Export as". Says which it will do;
		// the figures' writer re-says it on every change of what is ticked.
		const tickAll = fmt.createEl('button', { cls: 'ws-export-tickall ws-export-mini', text: 'Tick all' });
		tickAll.addEventListener('click', () => {
			if (!ctx.tickAll) return;
			ctx.tickAll(tickAll.dataset.all !== '1');
		});
		this.exportTickAllSay(into,
			(ctx.compileList ? ctx.compileList() : []).length,
			typeof ctx.total === 'function' ? ctx.total() : 0);
		fmt.createSpan({ cls: 'ws-export-fmtlabel', text: 'Export as' });
		// FOUR FORMATS, and each one is a different question answered: Word
		// for the person who asked for the manuscript, PDF for a page that is
		// final, HTML for anyone with a browser, Markdown for the writer's own
		// pipeline. PDF is desktop only — ABSENT rather than present-and-
		// refusing where there is no engine: a choice that fails when taken is
		// worse than a choice that was never offered, and this is the one
		// format whose availability is a fact about the machine rather than
		// about the manuscript.
		//
		// ── WHICH CONTROLS APPLY, AS A TABLE ───────
		//
		// THE FACT IS PAGES. A .docx, a PDF and a printed web page all have
		// them; Markdown does not, and everything hidden for it is hidden for
		// that one reason: paper size, the face it is set in, the margins, and
		// a running header, which is a line printed at the top of a page that
		// does not exist. One question asked once. THE WEB PAGE HAS PAGES, and
		// that is not a technicality — the HTML carries its own @page rule,
		// which is what makes it printable and what the PDF is produced from.
		const FORMATS = [
			// `pages` READ FROM THE SHARED HELPER, not restated here: the
			// Structure group needs the same fact and cannot see this table.
			{ id: 'docx', label: 'Word', ext: '.docx', pages: wsFormatHasPages('docx') },
			{ id: 'pdf',  label: 'PDF',  ext: '.pdf', desktopOnly: true,
				pages: wsFormatHasPages('pdf') },
			{ id: 'html', label: 'Web page', ext: '.html', pages: wsFormatHasPages('html') },
			{ id: 'md',   label: 'Markdown', ext: '.md', pages: wsFormatHasPages('md') }
		].filter(f => !f.desktopOnly || this.exportPdfAvailable());
		// Held so that paintFmt can put them back when "Set up again" writes
		// the options from outside the controls that normally own them.
		let fmtSel: { value: string; } | null = null, intoInput: { value: string; } | null = null;
		const paintFmt = () => {
			const f = FORMATS.filter(x => x.id === o.format)[0] || FORMATS[0];
			// THE DROP-DOWN ITSELF: "Set up again" writes `o.format` from outside
			// it, and a window whose menu says Word while the options say .html is
			// worse than one that had never offered to help.
			if (fmtSel && fmtSel.value !== o.format) fmtSel.value = o.format || 'docx';
			if (intoInput && intoInput.value !== (o.outFolder || '')) {
				intoInput.value = o.outFolder || '';
			}
			// ── AND TYPESETTING IS ONLY SHOWN WHERE IT APPLIES ─────────
			//
			// HIDDEN, NOT CLEARED. The paper size and the spacing a writer set for
			// their PDF are still in the settings and still apply the moment they
			// pick PDF again; a writer who flicks to Markdown to check something
			// must not come back to defaults.
			//
			// FOUND BY CLASS, NOT HELD IN A VARIABLE: THE SECTION IS BUILT IN A
			// DIFFERENT METHOD (`buildExportOptions`), and a `let` here cannot be
			// assigned there. SCOPED TO THIS WINDOW, not the document: a second
			// window open on another format must not have its section hidden by
			// this one.
			const scope = into.closest('.ws-uni-body') || into.ownerDocument;
			// EVERYTHING THAT NEEDS PAGES, in one sweep. The class is stamped
			// where each control is built; the format table above says whether
			// the target has pages at all.
			for (const el of Array.from<HTMLElement>(
				scope.querySelectorAll('.ws-export-pages'))) {
				el.toggleClass('is-gone', !f.pages);
			}
		};
		// A vault whose saved format no longer exists comes back to Word
		// rather than to a choice that is not on the list. Written as a
		// whitelist for that reason: naming the formats that DO exist cannot
		// go stale. AND PDF IS ON THE LIST ONLY WHERE IT EXISTS: a writer who
		// chose PDF on the desktop and opens the same synced vault on a phone
		// gets Word, not a button for a format that machine cannot make.
		// `FORMATS` is already filtered, so asking it is asking one question.
		if (!FORMATS.some(f => f.id === o.format)) o.format = 'docx';
		// A DROP-DOWN, not a third row of segmented buttons. The layout and
		// the paper are already that control, and the format answers a
		// categorically different question — WHAT FILE comes out, not how
		// it is set — so wearing the same idiom made three unrelated
		// choices look like one bank of settings. A select beside the
		// button reads as part of the act: choose the thing, press the
		// thing.
		const sel = fmt.createEl('select', { cls: 'ws-export-fmtsel dropdown' });
		fmtSel = sel;
		for (const f of FORMATS) {
			const opt2 = sel.createEl('option', { text: f.label + '  (' + f.ext + ')' });
			opt2.value = f.id;
		}
		sel.value = o.format || 'docx';
		sel.addEventListener('change', () => {
			o.format = sel.value; void this.saveSettings(); paintFmt();
		});
		// ── WHERE PDF IS ABSENT, SAY HOW TO GET ONE ──
		//
		// The writer's question on a phone is still "can I have a PDF", and
		// the answer is yes: the Web page carries its paper size, margins and
		// running header as an `@page` rule — the very thing the desktop PDF
		// is printed from — and Safari and Chrome honour the same rule. One
		// sentence here beats a second typesetting engine in the bundle. ASKED
		// OF THE SAME TEST THAT HIDES THE FORMAT, so the two cannot disagree.
		if (!this.exportPdfAvailable()) {
			fmt.addClass('has-note');
			fmt.createDiv({ cls: 'ws-export-fmtnote',
				text: 'For a PDF, export the web page, open it in your browser '
					+ 'and print it. Same pages, saved as PDF.' });
		}
		// WHAT ACTUALLY GETS COMPILED, in one place. ORDER, not the gathered
		// list — a manual move is the whole point of the drag, and reading
		// `files` here would throw it away silently at the last step. One
		// function because the Export button and the Preview must be given
		// the same list: a preview of a different book is worse than none.
		const compileList = () => ctx.compileList();
		const runBtn = (label: string, kind: string) => {
			const b = into.createEl('button', { cls: 'mod-cta ws-export-go' });
			wsGlyphWord(b, ['file-output', 'download'], label);
			b.addEventListener('click', () => { void (async () => {
				b.disabled = true;
				// ORDER, not the gathered list — a manual move is the whole
				// point of the drag, and compiling from `files` would throw
				// it away silently at the last step.
				try {
					await this.runExport(o.format || 'docx', ctx.scope(), compileList(), o, exportProgress);
				}
				finally { b.disabled = false; if (exportProgress) exportProgress.hide(); }
				if (ctx.onDone) ctx.onDone();
			})(); });
			return b;
		};
		// WHERE IT LANDS, beside what it will be. A folder picker rather
		// than a path to type: every other place in this window that wants
		// a folder searches for one, and a bare box meant typing a path
		// exactly and getting silence when it was wrong.
		{
			// `intoRow`, not `into`: the argument this act draws into is called
			// `into`, and a local of the same name here would shadow it — the row
			// would try to build itself out of itself.
			const intoRow = into.createDiv({ cls: 'ws-export-into' });
			intoRow.createSpan({ cls: 'ws-export-fmtlabel', text: 'into' });
			const pick = intoRow.createDiv({ cls: 'ws-export-folderpick' });
			const inp = pick.createEl('input', { cls: 'ws-export-text' });
			inp.type = 'text';
			inp.value = o.outFolder || '';
			intoInput = inp;
			inp.placeholder = 'Vault root';
			const hits = pick.createDiv({ cls: 'ws-export-hits ws-export-foldhits' });
			const paintHits = () => {
				hits.textContent = '';
				const q = inp.value.trim();
				const found = q
					? this.exportFinderMatches(q, 6).filter(h => h.kind === 'folder')
					: this.exportNearbyScopes(6);
				for (const h of found) {
					const r = hits.createDiv({ cls: 'ws-export-hit' });
					r.createSpan({ cls: 'ws-export-hitpath', text: h.path });
					r.addEventListener('mousedown', (ev: Event) => {
						ev.preventDefault();
						o.outFolder = h.path; inp.value = h.path;
						hits.textContent = ''; void this.saveSettings();
					});
				}
			};
			inp.addEventListener('input', paintHits);
			inp.addEventListener('focus', paintHits);
			// A typed path is still honoured — the list is help, not a gate.
			inp.addEventListener('change', () => { o.outFolder = inp.value; void this.saveSettings(); });
			inp.addEventListener('blur', () => {
				window.setTimeout(() => { hits.textContent = ''; }, 120);
			});
		}
		runBtn('Export', o.format || 'docx');
		paintFmt();
		// The progress line sits in the footer beside the button that
		// starts the work, not over the list a writer may still be reading.
		// THE PROGRESS LINE RIDES THE TOP BAR'S BOTTOM EDGE, absolutely
		// positioned, so that a bar appearing mid-export cannot move a
		// single control on the row it belongs to. It replaces the border
		// under the bar while it runs, which is a rule already drawn there.
		const prog = into.createDiv({ cls: 'ws-export-prog' });
		const progBar = prog.createDiv({ cls: 'ws-export-progbar' });
		const progTxt = prog.createDiv({ cls: 'ws-export-progtxt' });
		exportProgress = {
			show: (done: number, total: number, what: string) => {
				prog.addClass('is-on');
				progBar.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
				progTxt.setText(what + (total ? '  ' + done + '/' + total : ''));
			},
			hide: () => { prog.removeClass('is-on'); progBar.style.removeProperty('width'); }
		};
		return { progress: exportProgress, repaint: () => paintFmt() };
	},

	// ── THE EXPORT'S OPTIONS, as a panel anybody can ask for ────────────────
	//
	// Six hundred lines of switches, three drop-downs that rewrite each
	// other — one copy, so nothing can fall behind and be the one
	// somebody's manuscript comes out of. Everything here is
	// `settings.exportOpts`, which is where these belong: a writer sets
	// their manuscript up once, and it is the CHOICE OF FILES that belongs
	// to the export in front of them. `ctx` is an object rather than bare
	// arguments because a second positional one added later is how a
	// shared builder starts growing callers that pass them in the wrong
	// order.
	buildExportOptions(this: WordSmith, into: HTMLElement, ctx: { scope: () => string; compileList?: () => TFile[]; total?: () => number; folders?: () => number }) {
		// Same reason as the act line: a panel that draws switches for options
		// that have no value draws them all off.
		this.exportOptionDefaults();
		const o = this.settings.exportOpts || (this.settings.exportOpts = {});
		// ── THE PRINTING, BESIDE THE SWITCHES THAT DECIDE IT ────────────────
		//
		// The compile is cheap — reading, sectioning, counting and rendering
		// a whole vault in tens of milliseconds. THE LAYOUT IS NOT: the same
		// nodes cost five times as much laid out inline in this window as
		// inside an IFRAME, because the frame carries none of Obsidian's
		// cascade. So the preview is a frame, and nothing is truncated or
		// counted out. THE PREVIEW COLUMN IS A SIBLING OF THE OPTIONS, not
		// inside them: `buildOpts` empties its own column on every change, and
		// an iframe rebuilt on every toggle would flash and re-lay-out for
		// nothing.
		const split = into.createDiv({ cls: 'ws-export-split' });
		const optSide = split.createDiv({ cls: 'ws-export-optside' });
		const prevCol = split.createDiv({ cls: 'ws-export-prevcol' });
		this.exportPrevColFit(into, split, prevCol);
		const rightCol = optSide.createDiv({ cls: 'ws-export-right' });
		// The options redraw themselves, because three of them CHANGE what
		// the others should say: a layout rewrites five switches, the
		// paper choice moves a segment, and the divider's text box only
		// exists while there is a divider. Rebuilding the block keeps one
		// description of what is on screen — hand-updating each control
		// from every other is where a panel starts telling small lies
		// about itself.
		let redrawOpts = () => {};
		// ── AND IT FOLLOWS EVERY CHANGE, ON A DELAY ─────────────────────────
		//
		// DEBOUNCED AT 220ms: a refresh costs about 45ms of compile plus 70ms
		// of frame layout, so a slider dragged across its range would
		// otherwise recompile the manuscript forty times on the way. 220 is
		// longer than a keystroke and shorter than a thought.
		//
		// ONE LISTENER ON THE PANEL, delegated, rather than a hook in every
		// control. There are about twenty switches, four drop-downs, two text
		// boxes and a file list here; hooking each is twenty chances to miss
		// one, and a preview that is right except after the divider box is
		// worse than none. `redrawOpts` calls it too, for the changes that
		// rebuild the column rather than firing an event.
		let prevTimer: number | null = null;
		let prevRun = 0;
		// ── WHAT THE PREVIEW IS CURRENTLY SHOWING ────────────────
		//
		// A SELECTION IS NOT ALWAYS A CHANGE. Picking a different folder can
		// leave the compiled list exactly as it was — same notes, same order,
		// same options — and rewriting a document to produce the same document
		// is a flash for nothing.
		let prevSig: string | null = null;
		// THE READER'S OWN HANDLE, so a caller outside this panel can ask it
		// to go somewhere. Replaced on every recompile: an older one points
		// into a document that has been written over.
		let prevHandle: HTMLElement | null = null;
		// ── THE PREVIEW'S OWN CONTROLS MUST NOT RECOMPILE IT ──────────────
		//
		// The refresh is hung on delegated `change`/`click`/`input` listeners
		// over the entire options container, and the zoom foot is built INSIDE
		// the preview column, which is inside that container. So pressing +
		// would gather the files, compile every section, rebuild the HTML and
		// rewrite the iframe — to set one CSS property that is already being
		// set directly. THE WHOLE FOOT, not just the zoom buttons: Dark/Light
		// only toggles a class on the frame's `documentElement`.
		const refreshPreview = (ev?: Event) => {
			try {
				const t = wsElOf(ev && ev.target);
				if (t && t.closest('.ws-export-prevfoot')) return;
			} catch (_) { wsCatch('buildExportOptions / refreshPreview: const t = ev && ev.target;', _); }
			if (prevTimer) { window.clearTimeout(prevTimer); prevTimer = null; }
			prevTimer = window.setTimeout(async () => {
				prevTimer = null;
				const run = ++prevRun;
				let picked: TFile[] = [];
				try { picked = ctx.compileList ? ctx.compileList() : []; } catch (_) { wsCatch('buildExportOptions / refreshPreview: picked = ctx.compileList ? ctx.compileList() : [];', _); }
				// NOTHING TICKED IS A SENTENCE, NOT AN EMPTY FRAME. An empty
				// preview reads as a broken preview.
				if (!picked.length) {
					// ── NOTHING TICKED STILL READS ZERO ────
					//
					// The row beside the Export button must say something about a compile
					// that would produce an empty file. The preview column does say
					// "Nothing ticked yet", and that is not the same thing: it is inches
					// away, and the only place a writer with the preview scrolled would
					// not be looking. The figure belongs beside the button it describes.
					try {
						const stale = into.querySelector('.ws-export-top .ws-export-prevhead');
						if (stale) stale.remove();
						const actRow0 = into.querySelector('.ws-export-top');
						if (actRow0) {
							const head0 = actRow0.createDiv({ cls: 'ws-export-prevhead' });
							head0.createSpan({ text: this.exportFiguresText(0, 0, 0) });
							const go0 = actRow0.querySelector('.ws-export-go');
							if (go0) actRow0.insertBefore(head0, go0);
							this.exportTickAllSay(actRow0, 0,
								typeof ctx.total === 'function' ? ctx.total() : 0);
						}
					} catch (_) { wsCatch('buildExportOptions / refreshPreview: const stale = into.querySelector(\'.ws-export-top …', _); }
					prevCol.empty();
					prevCol.createDiv({ cls: 'ws-export-prevnone',
						text: 'Nothing ticked yet \u2014 the preview shows what will print.' });
					// THE FRAME IS GONE, SO THE SIGNATURE GOES TOO. Untick all empties the
					// column; Tick all brings back the same set, whose signature would
					// match the last frame's, and the early return below would re-say the
					// figures over an empty column.
					prevSig = null;
					prevHandle = null;
					return;
				}
				let secs = [];
				// THE SAME SCOPE THE EXPORT USES, or the preview would show a heading
				// the file does not get — and the preview exists to say what will
				// print.
				let scope0 = '';
				try { scope0 = (ctx && typeof ctx.scope === 'function')
					? ctx.scope() : ''; } catch { scope0 = ''; }
				try { secs = await this.exportSections(picked, o, null, scope0); }
				catch { return; }
				// A SLOWER RUN MUST NOT LAND ON A NEWER ONE. Two changes inside
				// one compile and the first to finish is not the first started.
				if (run !== prevRun) return;
				let words = 0;
				for (const sec of secs) words += this.countWords(sec.markdown);
				// ── THE SAME DOCUMENT IS NOT REDRAWN ─────────────────
				//
				// THE PROSE ITSELF, not a count of it. Lengths collide — an edit that
				// swaps two words leaves every number identical — and the one thing
				// this must never do is hold a stale preview over a changed
				// manuscript. The compile has already read every file by this line,
				// so joining what it read costs nothing beside it. THE OPTIONS ARE IN
				// IT TOO: paper, font, spacing and the rest change the document
				// without changing a word of the text.
				let sig = null;
				try {
					sig = JSON.stringify(o) + '\u0002'
						+ secs.map(x => (x.path || '') + '\u0000' + (x.title || '')
							+ '\u0000' + (x.markdown || '')).join('\u0001');
				} catch { sig = null; }
				// THE FIGURES STILL MOVE. “11 out of 47” has a second number in
				// it that the compiled list knows nothing about — the notes in
				// SCOPE — and choosing a different folder changes it while the
				// ticked list stays as it was. So the head is rewritten and only
				// the document is left alone.
				if (sig !== null && sig === prevSig) {
					try {
						const row0 = into.querySelector('.ws-export-top');
						const had = row0 && row0.querySelector('.ws-export-prevhead');
						if (row0 && had) {
							had.empty();
							had.createSpan({ text: this.exportFiguresText(
								picked.length, words,
								typeof ctx.folders === 'function' ? ctx.folders() : 0) });
							this.exportTickAllSay(row0, picked.length,
								typeof ctx.total === 'function' ? ctx.total() : 0);
						}
					} catch (_) { wsCatch('buildExportOptions / refreshPreview: const row0 = into.querySelector(\'.ws-export-top\');', _); }
					return;
				}
				prevSig = sig;
				prevCol.empty();
				// NO `onExport`: the pane has its own button, and the same act
				// offered twice on one screen is a question about which one is
				// the real one.
				// THE ACT ROW IF THERE IS ONE, and the old line goes first: the
				// preview column is emptied on every refresh, but the act row is
				// not ours to empty — it holds the format, the folder, the count
				// and the button. Removing exactly what we put there last time is
				// the only safe way to write into somebody else's row.
				const actRow = into.querySelector('.ws-export-top');
				if (actRow) {
					const old = actRow.querySelector('.ws-export-prevhead');
					if (old) old.remove();
				}
				this.exportTickAllSay(actRow, picked.length,
					typeof ctx.total === 'function' ? ctx.total() : 0);
				prevHandle = this.exportPreviewInto(prevCol, secs,
					this.exportOptsFor(ctx.scope(), o, words), picked.length, words,
					null, actRow || null,
					typeof ctx.folders === 'function' ? ctx.folders() : 0,
					// THE FOOT'S REFRESH: the same recompile, asked for by hand.
					// `refreshPreview` excuses the foot's clicks, so this is the one way a
					// press there reaches it.
					() => refreshPreview());
				try { if (split._wsFit) split._wsFit(); } catch (_) { wsCatch('buildExportOptions / refreshPreview: split._wsFit();', _); }
			}, 220);
		};
		into.addEventListener('change', refreshPreview);
		into.addEventListener('click', refreshPreview);
		into.addEventListener('input', refreshPreview);
		// ── ONE VIEW, NOT TABS ──────────────────────────────────────
		//
		// Setting up a PDF means visiting what the document is MADE OF and how
		// the words are SET every time, so a tab between them costs a click per
		// export and hides half the state behind the other half. One column
		// fits because the switches sit several to a row, the drop-down
		// captions are titles rather than a permanent line each, and ALSO
		// INCLUDE is behind one control.
		//
		// TITLE AND AUTHOR still come first: they are what the manuscript
		// IS, and the two boxes most likely to be wrong on any export.
		let optPanel: HTMLDivElement | null = null;
		const optGroup = (label: string) => {
			// Sub-headings WITHIN a tab, for the run of switches that answer
			// a narrower question than the tab does — "Also include" earns
			// one because off-by-default is a promise worth naming.
			const into = optPanel || rightCol;
			if (label) into.createDiv({ cls: 'ws-export-eyebrow', text: label });
			return into.createDiv({ cls: 'ws-export-opts' });
		};
		const buildOpts = () => {
		rightCol.empty();
		// ── The options ─────────────────────────────────────────────────
		//
		// ── THE NAME IS THE CONTROL ─────────────────────────────────────
		//
		// One pressable block that says what it is, accented when on — not a
		// switch and not a checkbox. (The helper is still named `toggle`;
		// export_probe pins the spelling against the source.)
		//
		// `aria-pressed`, BECAUSE A CHECKBOX GAVE THAT AWAY FREE. An
		// `input[type=checkbox]` announces itself as checked or unchecked; a
		// button announces nothing about its state unless told to. The colour
		// says "on" to anyone who can see it; this says it to anyone who
		// cannot.
		//
		// `type="button"` IS NOT DECORATION: a button defaults to `submit`
		// inside a form. These sit in a pane today, and naming the type keeps
		// that true if one is ever wrapped in one.
		const toggle = (parent: HTMLElement, key: WsExportBoolKey, label: string, hint: string) => {
			// A CHECKBOX, NOT AN ACCENT BUTTON: five toggles ON at once, in a
			// column, beside an accent Export button, had the accent saying three
			// things on one screen — "this is on", "this is the action", and "this
			// is the highlight colour". An input says what it is without being
			// told to. A LABEL WRAPPING THE INPUT, so the whole row is the hit
			// target rather than a 13px square. `.ws-export-toggle` stays on it —
			// tests find these by that class and read their text, and the layout
			// rules that size the row are hung on it too.
			const row = parent.createEl('label', {
				cls: 'ws-export-opt ws-export-toggle ws-export-check' });
			const box = row.createEl('input', { cls: 'ws-export-checkbox' });
			box.type = 'checkbox';
			const on = !!o[key];
			box.checked = on;
			row.toggleClass('is-on', on);
			row.createSpan({ cls: 'ws-export-checklabel', text: label });
			if (hint) row.title = hint;
			row.addEventListener('change', () => {
				o[key] = !!box.checked;
				void this.saveSettings();
				// STILL REDRAWS: `titlePage` decides whether `roundWordCount`
				// is available, and the two selects rewrite their own captions.
				// The new state is painted from the store by that redraw rather
				// than set on the element here — one writer for what is on.
				redrawOpts();
			});
			return row;
		};
		// THE FONT BOX: type to search, click to take, and every name is set
		// in its own face.
		//
		//   A SPECIMEN, NOT A WORD. A font is a shape; a column of names all
		//   set in the interface face is a list of words, and the writer has
		//   to pick, export and open the file to find out what they chose.
		//   A TYPED NAME IS STILL TAKEN. The list is help, not a gate — the
		//   same rule the folder box keeps — because a writer setting a
		//   manuscript for someone ELSE'S machine has a reason to name a
		//   face this one does not have.
		//   …AND IT SAYS SO, quietly, underneath. That is the whole argument
		//   the fixed list was built on, kept as a warning instead of as a
		//   wall.
		const fontOpt = (parent: HTMLElement, key: WsExportStringKey, label: string, inRow: boolean) => {
			const row = parent.createDiv({ cls: 'ws-export-opt ws-export-textrow ws-export-fontrow'
				+ (inRow ? ' is-inrow' : '') });
			row.createSpan({ cls: 'ws-export-optname', text: label });
			const pick = row.createDiv({ cls: 'ws-export-fontpick' });
			const inp = pick.createEl('input', { cls: 'ws-export-text ws-export-fontinput' });
			inp.type = 'text';
			inp.value = o[key] || '';
			inp.placeholder = 'Times New Roman';
			// A font name is not prose: a red underline under "Alegreya" is
			// the editor calling a correct answer a mistake.
			inp.setAttribute('spellcheck', 'false');
			// ── THE CAVEAT IS NOT PART OF THE ANCHOR ────────────────────
			//
			// Inside the trio `pick` is 151px wide, so six lines of prose in it
			// would make the box 126px tall — centring the LABEL halfway down its
			// own row and dropping the results list, which is `top: 100%` of this
			// box, a hundred pixels below the field it belongs to. SO IT GOES
			// OUTSIDE, on its own full-width line under the trio. `pick` is the
			// FIELD and nothing else, which is what an anchor has to be.
			const noteHost = (inRow && parent.parentElement)
				? parent.parentElement : pick;
			const note = noteHost.createDiv({
				cls: 'ws-export-fontnote' + (inRow ? ' is-wide' : '') });
			const hits = pick.createDiv({ cls: 'ws-export-hits ws-export-fonthits' });
			let rows: HTMLElement[] = [], found: string[] = [], sel = -1;
			const face = (n: string) => '"' + String(n).replace(/["\\]/g, '') + '"';
			const wear = () => {
				const n = String(inp.value || '').trim();
				inp.style.fontFamily = n ? face(n) : '';
			};
			const sayNote = () => {
				const n = String(inp.value || '').trim();
				note.setText(this.fontIsInstalled(n) ? ''
					: 'Not found on this machine \u2014 it goes into the file as written, '
						+ 'and whatever opens it will substitute.');
			};
			// THE CAVEAT STANDS DOWN WHILE THE LIST IS UP. They sit on the
			// same strip of screen now that the note has the full column
			// width, and an open list covered the middle of its own warning.
			// It is a statement about what has been TYPED, so it has nothing
			// to say while a list of real families is open and the answer is
			// still being chosen.
			const noteShow = () => note.toggleClass('is-under',
				hits.childElementCount > 0);
			// ── WHERE THE LIST GOES, IN SCREEN COORDINATES ──────────────
			//
			// It is `position: fixed`, so it escapes `.ws-export-right`'s scroll
			// clip — and so it has no layout parent to take its place from. Written
			// from the field's own rect, every time anything could have moved. AND
			// IT IS CLAMPED TO THE ROOM THERE ACTUALLY IS, then flipped above the
			// field when there is more room up than down.
			const placeHits = () => {
				if (!hits.childElementCount) return;
				const r = inp.getBoundingClientRect();
				// CLAMPED TO THE WINDOW IT BELONGS TO, not to the screen: `position:
				// fixed` escapes every ancestor's overflow — which is the whole point
				// of it here — and that includes the modal's own edge. A FLOOR AND A
				// CEILING ARE Y COORDINATES; A CAP IS A HEIGHT — `42vh` taken off a
				// coordinate looks right only while the window starts near the top of
				// the screen. THE FIELD'S OWN WINDOW, not the app's: in a popout
				// `window` is still the main one, so the list would be sized against
				// a screen the writer is not looking at
				const host2 = inp.closest('.ws-uni-modal, .workspace-leaf-content');
				const hb = host2 ? host2.getBoundingClientRect() : null;
				// .
				const fwin = (inp.ownerDocument && inp.ownerDocument.defaultView)
					|| window;
				const winH = fwin.innerHeight || 800;
				const floorY = Math.min(winH, hb ? hb.bottom : Infinity);
				const ceilY = hb ? hb.top : 0;
				const below = floorY - r.bottom - 8;
				const above = r.top - ceilY - 8;
				const up = below < 160 && above > below;
				const cap = winH * 0.42;
				const room = Math.max(96, Math.min(up ? above : below, cap));
				// AND IT STAYS ON THE SCREEN: on a phone the font field sits at the
				// right edge, so width is capped to the window and the left is pulled
				// back until the box fits, in that order.
				const winW = fwin.innerWidth || 0;
				let boxW = Math.max(r.width, 220);
				if (winW > 8) boxW = Math.min(boxW, winW - 8);
				let boxL = Math.round(r.left);
				if (winW > 0) boxL = Math.max(4, Math.min(boxL, winW - boxW - 4));
				hits.style.width = boxW + 'px';
				hits.style.left = boxL + 'px';
				hits.style.maxHeight = Math.round(room) + 'px';
				if (up) {
					hits.style.removeProperty('top');
					hits.style.bottom = Math.round(winH - r.top + 2) + 'px';
				} else {
					hits.style.removeProperty('bottom');
					hits.style.top = Math.round(r.bottom + 2) + 'px';
				}
			};
			// A FIXED BOX DOES NOT TRAVEL WITH ITS FIELD. Scrolling the
			// options column moves the input and leaves the list behind, so
			// the list is re-placed on any scroll anywhere (capture, because
			// the scroll happens on an ancestor) and on any resize. Both
			// return immediately while the list is shut.
			const onMove = () => placeHits();
			// ON THE FIELD'S OWN WINDOW, for the reason `placeHits` gives: a
			// popout scrolls and resizes in its own window, and listeners on
			// the main one would never hear it - the list would sit where it
			// was first put while its field moved out from under it.
			const iwin = (inp.ownerDocument && inp.ownerDocument.defaultView)
				|| window;
			iwin.addEventListener('scroll', onMove, true);
			iwin.addEventListener('resize', onMove);
			const close = () => {
				hits.textContent = ''; rows = []; found = []; sel = -1;
				noteShow();
			};
			const mark = () => rows.forEach((r, i) => r.classList.toggle('is-selected', i === sel));
			const take = (name: string) => {
				o[key] = name; inp.value = name;
				void this.saveSettings(); wear(); sayNote(); close();
			};
			const paint = () => {
				hits.textContent = ''; rows = []; sel = -1;
				found = this.fontFinderMatches(inp.value, 40);
				for (const name of found) {
					const r  = hits.createDiv({ cls: 'ws-export-hit ws-export-fonthit' });
					const nm = r.createSpan({ cls: 'ws-export-fontname', text: name });
					nm.style.fontFamily = face(name);
					if (name === String(o[key] || '')) {
						r.createSpan({ cls: 'ws-export-fonttag', text: 'in use' });
					}
					const i = rows.length;
					r.addEventListener('mouseenter', () => { sel = i; mark(); });
					// mousedown, not click: the box blurs first, blur closes
					// the list, and a click landing on a row that has already
					// gone is a click that does nothing.
					r.addEventListener('mousedown', (ev: Event) => { ev.preventDefault(); take(name); });
					rows.push(r);
				}
				if (!found.length) hits.createDiv({ cls: 'ws-export-nohit', text: 'No font by that name.' });
				noteShow();
				placeHits();
			};
			// The real list arrives asynchronously; the box opens on whatever
			// is known and repaints when it lands.
			const wake = () => {
				paint();
				void this.ensureSystemFonts().then(() => { if (rows.length) paint(); sayNote(); });
			};
			inp.addEventListener('focus', wake);
			inp.addEventListener('input', () => { wear(); sayNote(); paint(); });
			// Saved on change, like every other box here: a keystroke is not
			// a decision, and blurring or pressing Enter is.
			inp.addEventListener('change', () => {
				o[key] = String(inp.value || '').trim();
				void this.saveSettings(); wear(); sayNote();
			});
			inp.addEventListener('keydown', (ev: KeyboardEvent) => {
				if (ev.key === 'Escape') { close(); return; }
				if (!found.length) return;
				if (ev.key === 'ArrowDown') { sel = (sel + 1) % found.length; mark(); ev.preventDefault(); }
				else if (ev.key === 'ArrowUp') { sel = (sel - 1 + found.length) % found.length; mark(); ev.preventDefault(); }
				else if (ev.key === 'Enter') {
					// Enter takes the row ON SCREEN, and only if one is
					// picked out: Enter on a name typed in full must keep
					// that name rather than swap it for the nearest match.
					if (sel >= 0) { take(found[sel]); ev.preventDefault(); }
					else close();
				}
			});
			// A moment, because a click on a row is a blur first.
			inp.addEventListener('blur', () => { window.setTimeout(close, 120); });
			wear(); sayNote();
			return inp;
		};

		// A DROP-DOWN for anything with a small fixed set of answers. Paper
		// was two segmented buttons, which is a control shaped like a
		// choice between equals — but nobody switches paper twice in a
		// session, and it was taking a row and a half to say so.
		//
		// AND A LINE UNDER IT SAYING WHAT THE ANSWER MEANS. "Between files:
		// divider, same page" is precise and it is not an explanation —
		// vault feedback was, in as many words, "I don't understand what
		// these do", and re-reading them shows why: they name the SETTING
		// and leave the writer to imagine the page. Six words of plain
		// English under the box costs one line and removes the guess. The
		// caption belongs to the CHOICE, not to the control, so it changes
		// as the drop-down does — a tooltip could not do that, and neither
		// could a hint on the label.
		// `inRow` stops the row spanning its grid, so several can share a line
		// inside a `.ws-export-trio`. Last argument on purpose: a dozen tests
		// pin the FIRST three arguments of these calls against the source
		// text, so anything new goes on the end.
		// `whenMissing` IS FOR A CHOICE THE FORMAT DOES NOT OFFER. A stored
		// value that is not in `items` leaves a `<select>` showing its first
		// option while reporting an empty value — so the box would say one
		// thing and the manuscript do another. Naming the fallback keeps the
		// STORED choice untouched: a writer whose Word export starts each file
		// on a new page must not have that rewritten by looking at Markdown.
		const selOpt = (parent: HTMLElement, key: WsExportStringKey | 'pt', label: string, items: { id: string | number; label: string; hint?: string }[], after: () => void, inRow: boolean, whenMissing?: string) => {
			const row = parent.createDiv({ cls: 'ws-export-opt ws-export-textrow'
				+ (inRow ? ' is-inrow' : '') });
			row.createSpan({ cls: 'ws-export-optname', text: label });
			const sel = row.createEl('select', { cls: 'dropdown ws-export-sel' });
			for (const it of items) {
				const op = sel.createEl('option', { text: it.label });
				op.value = String(it.id);
			}
			sel.value = String(o[key]);
			if (whenMissing && !items.some((x) => String(x.id) === String(o[key]))) {
				sel.value = String(whenMissing);
			}
			// THE CAPTION IS THE ROW'S TITLE, NOT A ROW OF ITS OWN. ON THE ROW,
			// not the select: the label is half the row and a reader hovering
			// 'Each file' is asking the same question as one hovering the box
			// beside it.
			const sayHint = () => {
				const it = items.filter((x) => x.id === String(o[key]))[0];
				if (it && it.hint) row.title = it.hint; else row.removeAttribute('title');
			};
			sayHint();
			sel.addEventListener('change', () => {
				// a select answers a string; the size's `after` parses it to the number it is
				(o as Record<string, string | number | boolean | undefined>)[key] = sel.value;
				sayHint();
				void this.saveSettings();
				if (after) after();
			});
			return sel;
		};
		const textOpt = (parent: HTMLElement, key: WsExportStringKey, label: string, ph: string, hint?: string) => {
			const row = parent.createDiv({ cls: 'ws-export-opt ws-export-textrow' });
			row.createSpan({ cls: 'ws-export-optname', text: label });
			const inp = row.createEl('input', { cls: 'ws-export-text' });
			inp.type = 'text'; inp.value = o[key] || ''; inp.placeholder = ph || '';
			inp.addEventListener('change', () => { o[key] = inp.value; void this.saveSettings(); });
			// A box can need help as much as a drop-down can - "Scene break"
			// is a field whose whole meaning is which of two marks it sets, and
			// that cannot be said in a label. It is a TITLE now, for the same
			// reason selOpt's is: this row only appears when a star divider is
			// chosen, and a caption that costs a line the moment a writer picks
			// an option is a page that grows as it is used.
			if (hint) row.title = hint;
			return inp;
		};


		// ── Who and what it is ──────────────────────────────────────────
		// The author FIRST, because it is the one field a writer fills in
		// by hand and the one that ends up on the title page and in the
		// running header — it was at the bottom, under a dozen switches
		// nobody needs to read to type their own name.
		{
			// NO EYEBROW ON THE FIRST GROUP. A heading over the top of a
			// column names the column, not a section of it — "The
			// manuscript" sat above three fields in a panel that is
			// entirely about the manuscript, so it said nothing and cost
			// a line. The groups below it divide something; this one is
			// just where the column starts.
			optPanel = null;                      // above the tabs
			// NAMED: the groups divide the column, and a group that does not say
			// what it is divides nothing.
			const grp = optGroup('Manuscript');
			// TITLE, and the folder's name is what it falls back to rather
			// than a switch saying so. "Use the folder name" as a toggle
			// would be a control for the case where the writer has
			// nothing to say — an empty box already means that, and it
			// shows what it will use in the placeholder, so the default
			// is visible instead of merely documented.
			const ti = textOpt(grp, 'titleText', 'Title',
				(String(wsCtxScope(ctx)).split('/').pop() || '').replace(/\.md$/, '') || 'Untitled');
			ti.addClass('ws-export-wideinput');
			const au = textOpt(grp, 'author', 'Author', 'A. Writer');
			au.addClass('ws-export-wideinput');
		}

		// THE PANEL EVERYTHING BELOW DRAWS INTO. `optGroup` routes through it —
		// Title and Author set `optPanel = null` to sit above.
		optPanel = rightCol.createDiv({ cls: 'ws-export-panel' });

		// ── How it is put together ──────────────────────────────────────
		// Every switch here decides where one thing ENDS and the next begins —
		// a title page before the text, a header across the top, a heading or
		// a break or a mark between files. That is structure, and a writer
		// looking for "should each chapter start a new page" looks under
		// structure.
		{
			// The title page, the running header, the contents page, and how the
			// word count on the title page reads. Publishing's own word for the
			// pages before the text, which is what three of the four are; the
			// rounding belongs here because the number it rounds is printed on
			// the title page and nowhere else.
			const grp = optGroup('Front matter');
			toggle(grp, 'titlePage', 'Title page',
				'A page of its own at the front with the title, your name and the '
				+ 'word count \u2014 what a submission opens with.');
			// A LINE PRINTED AT THE TOP OF A PAGE, so it goes with the pages.
			// It sits in Front matter beside the title page and the contents,
			// both of which Markdown really does produce — which is why this is
			// marked one control at a time and not one group at a time.
			toggle(grp, 'runningHeaderOn', 'Running header',
				'Your surname, the title and the page number along the top of every '
				+ 'page, so a printed manuscript can be put back in order.')
				.addClass('ws-export-pages');
			// "Contents page" named the paper it lands on; "Table of
			// contents" is what the thing is called, in Word's own menus and
			// in every book that has one.
			// UNDER THE TITLE PAGE, because it is a line ON that page and
			// nowhere else — a switch for something invisible until another
			// switch is on belongs against that switch, and this window has
			// been taught that once already by the divider box.
			if (o.titlePage) {
				toggle(grp, 'roundWordCount', 'Round the word count',
					'\u201cAbout 90,000 words\u201d on the title page, which is what a '
					+ 'publisher costing paper expects. Off prints the count exactly.');
			}
			toggle(grp, 'toc', 'Table of contents',
				'A list of the files at the front, each one a link that jumps to it.');
			// ONE QUESTION, THREE ANSWERS: how does one file join the next? As two
			// booleans it allowed both at once — a page break AND a divider —
			// which no manuscript wants. TWO ROWS THAT READ AS SENTENCES: the
			// LABEL is a subject and the ANSWER is its predicate — "Each file —
			// starts a new page", "Its heading — the file's name" — so both labels
			// fit the column and both rows read left to right in one go.
			//
			// THE TWO OF THEM ON ONE ROW: they are one question asked twice — what
			// separates one file from the next, and what is printed at the top of
			// it — and `.ws-export-pair` is the trio's shape with two columns. THE
			// LAST ARGUMENT IS LOAD-BEARING: without `true` each row spans its
			// container, so the pair would be two stacked rows inside a new box.
			//
			// A GROUP OF THEIR OWN: these three decide the SHAPE of the book
			// itself — where one file ends, what is printed at the top of the
			// next, and whether a folder announces itself — where Front matter is
			// what is printed BEFORE the book.
			const structGrp = optGroup('Structure');
			// ONE COLUMN IN HERE. The two-column grid is right for a bank of short
			// switches; this group holds a two-control ROW and one long label,
			// which a half-width cell cut short with the other half empty beside
			// it.
			structGrp.addClass('is-structure');
			const pair = structGrp.createDiv({ cls: 'ws-export-pair' });
			// ── AND A PAGELESS FORMAT IS NOT OFFERED A PAGE ─────────────
			//
			// `exportToMarkdown` reads `starBetween` and never `pageBreaks`, so
			// for .md "starts a new page" does LITERALLY NOTHING while the other
			// two both work. THE STORED VALUE IS LEFT ALONE and `run` is shown
			// instead, which is also what .md actually does with `page`. Flick to
			// Markdown and back and the Word setting is exactly where it was.
			selOpt(pair, 'joinMode', 'Each file', [
				{ id: 'page',    label: 'Starts a new page',
					hint: 'Every file begins at the top of a fresh page \u2014 how a book '
						+ 'starts a chapter, and what a submission expects.' },
				{ id: 'divider', label: 'Follows a divider',
					hint: 'Files run on down the same page, with the mark below '
						+ 'centered between them \u2014 a scene break.' },
				{ id: 'run',     label: 'Runs straight on',
					hint: 'Nothing between one file and the next: the prose reads as '
						+ 'though it were all one note.' }
			].filter((c) => c.id !== 'page' || wsFormatHasPages(o.format || '')), () => {
				o.pageBreaks = o.joinMode === 'page';
				o.starBetween = o.joinMode === 'divider';
				void this.saveSettings();
				redrawOpts();
			}, true, 'run');
			// THE MARK, DIRECTLY UNDER THE ANSWER THAT ASKS FOR IT. It was
			// written last in this group, so it appeared beneath the
			// HEADING row and its caption \u2014 a box called "Divider" sitting
			// under a sentence about chapter headings, which reads as a
			// setting for the wrong thing entirely. A control that exists
			// only because of another control has to sit against it.
			//
			// It still only exists when there IS a divider to name: a field
			// for a mark that is switched off is a control that does
			// nothing, sitting where a writer reads it as one that does.
			if (o.starBetween) {
				// INTO STRUCTURE WITH THE ROW IT ANSWERS, and AFTER "Each file": a
				// mark box first was read as a setting for the heading above it.
				textOpt(structGrp, 'divider', 'Its mark', '#',
					'Centered on its own line between one file and the next.');
			}
			// "INSERT HEADING", NOT "ITS HEADING": "its" names a heading the file
			// already has, so "None" reads as a claim about the note rather than
			// an instruction about the export. "Insert" says who is doing it, and
			// then None means what it says. With the file's name on AND the note
			// opening with its own `# Chapter One`, the title would be set twice
			// — and a book whose notes are named for its chapters is the commonest
			// way anyone organises one.
			selOpt(pair, 'chapterTitles', 'Insert heading', [
				{ id: 'file', label: 'The file\u2019s name',
					hint: 'Each file opens with its own name as the heading. A '
						+ '# heading inside the note is dropped, so the title is not '
						+ 'set twice.' },
				{ id: 'note', label: 'The note\u2019s own',
					hint: 'Whatever the note already says \u2014 its # headings are kept '
						+ 'as written, and nothing is added.' },
				{ id: 'none', label: 'None',
					hint: 'No headings at all: unbroken prose, with only the dividers '
						+ 'or page breaks above to separate the files.' }
			], () => {
				o.sectionTitles = o.chapterTitles === 'file';
				o.keepHeadings = o.chapterTitles !== 'none';
				// From the file name means the note's own heading would be
				// the same title again: it is dropped, not printed twice.
				if (o.chapterTitles === 'file') o.keepHeadings = false;
				void this.saveSettings();
				redrawOpts();
			}, true);
			// ── AND THE FOLDERS THEMSELVES CAN BE HEADINGS ──────────────────
			//
			// A book kept as `Section 1/Chapter 1/Some topic.md` compiles to
			// `Section 1`, `Chapter 1`, then the prose — the chapter headings live
			// apart from the body text, so pieces move between chapters without
			// dragging a heading with them. DIRECTLY UNDER `Insert heading`,
			// because the two are one question asked at two scales: that one says
			// whether a FILE contributes a heading, this one whether the FOLDERS
			// above it do.
			//
			// IT WORKS WITH ALL THREE ANSWERS. With "None" the folders are the
			// only headings. With "The file's name" each file sits one level under
			// its folder. With "The note's own" the note's headings are pushed
			// down by the folder depth, or a scene's # would outrank its chapter.
			// IN THE GROUP, NOT THE PAIR: a third child would take one of the
			// pair's cells and leave the other empty.
			toggle(structGrp, 'folderHeadings', 'Folder names as headings',
				'A folder becomes a heading where it begins — the folders below the deepest one every file shares, one level per folder. A note’s own headings move down to sit under them.');
		}

		// ── The words ───────────────────────────────────────────────────
		// …and these decide how the prose itself is set, which is the other
		// question entirely — which is why they are the other tab.
		{
			const grp = optGroup('Typesetting');
			// BOTH HALVES OF THE SECTION. `optGroup` makes an eyebrow and then
			// the options box, and returns only the box — so the heading is
			// the element immediately before it. Hiding one and not the other
			// leaves a title over nothing, which reads as a section that
			// failed to draw rather than one that does not apply.
			//
			// CHECKED BY CLASS, not taken on faith: if the shape of `optGroup`
			// ever changes, this marks the box alone rather than hiding
			// whatever happens to sit above it.
			//
			// A CLASS RATHER THAN A VARIABLE, because `paintFmt` — which does
			// the hiding — is in another method entirely, and a name assigned
			// across that boundary is a global, not a shared reference.
			grp.addClass('ws-export-pages');
			{
				const eb = grp.previousElementSibling;
				if (eb && eb.classList.contains('ws-export-eyebrow')) {
					eb.addClass('ws-export-pages');
				}
			}
			// PAPER FIRST, then the face it is set in. NINE SIZES, from one table
			// (WS_PAPERS), because "A4 or not" only answers the submission
			// question: a writer setting a proof of their own novel is working to
			// a TRIM SIZE — 6 x 9, digest, mass market — and those are pages in
			// their own right, not variants of Letter. The margin travels with the
			// paper: an inch on a 5.5-inch page is a third of the sheet.
			//
			// A SEARCH BOX OVER THE MACHINE'S OWN FAMILIES for the font, the way
			// Obsidian's font setting does it (see WS_SAFE_FONTS). Plain
			// substring, not fuzzy: a font list is a thing you READ, and fuzzy
			// matching puts "Times New Roman" three rows below something that
			// merely contains a t, an i and an m. THE PAPER, THE FACE, THE SIZE
			// AND THE SPACING ARE ONE QUESTION, so they are one row; the class
			// still says trio, because it is the ROW SHAPE beside
			// `.ws-export-pair`, the same shape for two.
			const trio = grp.createDiv({ cls: 'ws-export-trio' });
			// PAPER FIRST, and creation order is DOM order — the sheet is
			// chosen before the face that is set on it, the size of that face,
			// and the space between its lines. Reading the row left to right
			// is reading the decisions in the order they are made.
			selOpt(trio, 'paperId', 'Paper',
				WS_PAPERS.map(p => ({ id: p.id, label: p.label })),
				() => { o.a4 = o.paperId === 'a4'; void this.saveSettings(); }, true);
			fontOpt(trio, 'font', 'Font', true);
			// SIZE, which was pinned at 12pt. That is the manuscript
			// convention and it is still the default \u2014 but the paper is
			// nine sizes now, and 12pt double spaced on a 6 \u00d7 9 page is
			// about a hundred and ninety words to the page, which is a
			// proof nobody would set on purpose.
			selOpt(trio, 'pt', 'Size', [
				{ id: '10', label: '10 pt' },
				{ id: '11', label: '11 pt' },
				// THE CAPTION IS A HINT, NOT PART OF THE LABEL: spelled out in the
				// closed box it made this the widest of the five by more than double,
				// and it sets the width of a control that shares its line with three
				// others. `selOpt` puts an item's hint on the row as a title when that
				// item is the chosen one.
				{ id: '12', label: '12 pt', hint: 'The manuscript standard.' },
				{ id: '13', label: '13 pt' },
				{ id: '14', label: '14 pt' }
			], () => { o.pt = parseInt(String(o.pt), 10) || 12; void this.saveSettings(); }, true);
			// THREE ANSWERS, where a boolean could only give two. Double is
			// what a submission expects and stays the default; single is
			// closer to a finished book; one and a half is what a reader
			// who is not an editor actually prefers, and it was the answer
			// the switch could not give.
			// NO CAPTIONS on this one. The other two drop-downs describe a
			// LAYOUT — what lands on the page, which cannot be guessed from
			// three words — and single, one and a half and double are three
			// words everyone already knows. A line of explanation under a
			// self-evident answer teaches a reader to stop reading the
			// lines under the ones that are not.
			selOpt(trio, 'lineSpacing', 'Spacing', [
				{ id: 'single',  label: 'Single' },
				{ id: 'onehalf', label: 'One and a half' },
				{ id: 'double',  label: 'Double' }
			], () => {
				// The boolean the builders and older vaults still read is
				// written from the answer, in one place, on every change.
				o.doubleSpaced = o.lineSpacing !== 'single';
				void this.saveSettings();
			}, true);
			// INDENT PARAGRAPHS, BACK. It was removed because turning it
			// off with double spacing on — the pairing a manuscript uses —
			// left NO paragraph boundary at all, and the result read as a
			// broken document rather than a styled one. The switch was
			// never the fault; the missing second boundary was. Off now
			// puts a half-line of air after each paragraph in all three
			// targets (see `gap` in wsStylesXml), which is block-set prose
			// — what a business letter, a blog post and most non-fiction
			// use — rather than a document with its paragraph ends
			// deleted. On by default, because the manuscript convention is
			// still the default here.
			toggle(grp, 'indent', 'Indent paragraphs',
				'A half-inch first line on every paragraph but the first of a scene '
				+ '\u2014 the manuscript convention. Off sets them block style, with a '
				+ 'space between instead.');
			// UNDER THE INDENT, not above the size. The two switches in this
			// tab are the only two things here a writer flips rather than
			// chooses from a list, and the grid lays toggles two to a row —
			// so with one of them stranded at the top of the group and the
			// other at the bottom, each sat alone on a line with a
			// half-width hole beside it. Together they pair up, and the
			// three drop-downs above them read as one run rather than as
			// two runs with a switch wedged in the middle.
			toggle(grp, 'smartQuotes', 'Curly quotes',
				'Turns \' and " into \u2018 \u2019 \u201c \u201d as it compiles. Only in the exported '
				+ 'file \u2014 your notes keep what you typed.');
		}

		// ── What comes along ────────────────────────────────────────────
		// Everything here is OFF, and everything here is something the
		// compile deliberately leaves behind: the note's plumbing, the
		// writer's asides, the pictures. Off is right — a manuscript is
		// prose and none of this is prose — but "right by default" is not
		// the same as "never wanted", and the alternative a writer had was
		// to strip these by hand from the note and put them back after.
		//
		// Its own group, and named for the question rather than for the
		// items, because what these three share is not what they ARE but
		// that the export drops them.
		{
			// Named "Also include", and on the pane rather than behind a button
			// reading "0 of 5": a count is not a control — it is a promise that
			// there is one somewhere else. THE HINTS are each switch's own title,
			// which is where every other switch on this pane keeps its explanation.
			const grp = optGroup('Also include');
			const ALSO: [WsExportBoolKey, string, string][] = [
				['keepFrontmatter', 'Properties',
					'The --- block at the top of a note: status, tags, dates. '
					+ 'Printed verbatim in monospace, because it is data rather '
					+ 'than prose.'],
				['keepComments', 'Comments',
					'Your %% notes to self %%, kept where they sit and set apart '
					+ 'from the prose so a query to yourself cannot be read as a '
					+ 'sentence.'],
				['keepImages', 'Image placeholders',
					'[Image: cover.png] where a picture sits. The picture itself '
					+ 'is not embedded \u2014 this is a mark that something belongs '
					+ 'there.'],
				// HIGHLIGHTS is a bug fix wearing an option's clothes:
				// `==marked==` text matched nothing in the converter, so it
				// travelled into the manuscript as literal equals signs. The
				// marks are consumed either way now; this decides whether the
				// highlight survives, and off is the default because a
				// highlight is usually a note to self about the prose.
				['highlights', 'Highlights',
					'Your ==marked== passages come through highlighted, the same '
					+ 'yellow Word\u2019s own pen writes. Off keeps the words and '
					+ 'drops the marks.'],
				// THE ONE HERE THAT IS ON. Footnotes were unconditional, so
				// absent has to mean on — which breaks this group's "off until
				// you ask" promise. It sits here anyway: what happens to the
				// notes in a file is the same question as what happens to its
				// properties and its comments. Off drops the markers too,
				// because a `[^3]` pointing at a note that is no longer in the
				// document is worse than either having them or not.
				['footnotes', 'Footnotes',
					'Your [^1] notes, gathered as endnotes at the back with their '
					+ 'markers left in the text. Off removes both.']
			];
			for (const [key, lab, hint] of ALSO) toggle(grp, key, lab, hint);
		}

		// ("Save into" is in the footer,
		// beside "Export as": where a file lands is part of the ACT of
		// exporting, not a property of the manuscript, and it was the only
		// row in this column that answered a question about the export
		// rather than about the book.)
		};
		// THE REDRAW REFRESHES THE PREVIEW TOO. Three options rewrite the
		// whole column rather than firing a change event on one control — a
		// layout writes five switches, the paper choice moves a segment — so
		// the delegated listener never sees them.
		redrawOpts = () => { buildOpts(); refreshPreview(); };
		buildOpts();
		// AND IT PAINTS ONCE ON OPEN, or the pane offers an empty frame until
		// the writer happens to touch something. The debounce makes this the
		// same 220ms every other refresh takes.
		refreshPreview();
		// The redraw is handed back: three of these options CHANGE what the
		// others should say, and a caller drawing its own furniture around
		// this panel has to be able to ask for it.
		// AND A REFRESH THAT BUILDS NOTHING. `redraw` rewrites the options
		// column; this only recompiles the preview, which is what a caller
		// wants when the SCOPE moved and the controls did not.
		return { el: rightCol, redraw: () => redrawOpts(),
			refresh: () => refreshPreview(),
			// ASKED OF THE HANDLE THAT EXISTS NOW, not of one captured when this
			// object was made: the preview is rebuilt on every real change, and a
			// caller holding the old one would scroll a document nobody can see.
			jumpTo: (path: string) => {
				try {
					if (!prevHandle || typeof prevHandle.wsJumpTo !== 'function') return false;
					prevHandle.wsJumpTo(path);
					return true;
				} catch { return false; }
			} };
	},

	async runExport(this: WordSmith, kind: string, scope: string, files: TFile[], o: WsExportOpts, progress: { show: (done: number, total: number, what: string) => void; hide: () => void } | null) {
		if (!files.length) { new Notice('Word-Smith: nothing selected to export.'); return; }
		const sections = await this.exportSections(files, o,
			progress ? (d: number, t: number) => progress.show(d, t, 'Reading') : null,
			scope);
		if (progress) {
			progress.show(files.length, files.length, 'Building');
			// One frame for "Building" to appear before the synchronous
			// build blocks everything — otherwise the label changes and
			// the UI repaints in the same moment, which is after the work.
			await new Promise((r) => window.setTimeout(r, 0));
		}
		let words = 0;
		for (const s of sections) words += this.countWords(s.markdown);
		const folder = await this.exportEnsureFolder(o.outFolder || '');
		// A FREE NAME, ALWAYS. The stamp is dd-mm-yyyy hhmm, so two
		// exports inside the same minute asked the vault for a path that
		// already existed — and `vault.create` throws on that, so the
		// second one FAILED with "File already exists" rather than making
		// a file. Tweaking one option and pressing Export again is the
		// most ordinary thing to do in this window, which made it the
		// most ordinary way to see an error.
		//
		// Counting up rather than overwriting: the first file may be the
		// one already sent to somebody, and no export is worth silently
		// replacing it.
		const into = (n: string) => {
			let path = folder ? folder + '/' + n : n;
			try {
				if (!this.app.vault.getAbstractFileByPath(path)) return path;
				const dot = n.lastIndexOf('.');
				const stem = dot === -1 ? n : n.slice(0, dot);
				const ext = dot === -1 ? '' : n.slice(dot);
				for (let i = 2; i < 200; i++) {
					const next = (folder ? folder + '/' : '') + stem + ' ' + i + ext;
					if (!this.app.vault.getAbstractFileByPath(next)) return next;
				}
			} catch (_) { wsCatch('runExport / into: if (!this.app.vault.getAbstractFileByPath(path)) return path;', _); }
			return path;
		};
		const opt = this.exportOptsFor(scope, o, words);
		try {
			// WHAT WAS DONE, remembered — see `exportRemember` below for why
			// it is written HERE, at each success, rather than where the
			// button is pressed.
			if (kind === 'md') {
				const name = into(this.exportFileName(scope, 'md'));
				await this.app.vault.create(name, this.exportToMarkdown(sections, opt));
				this.exportRemember(scope, kind, opt, files.length, name);
				new Notice('Word-Smith: exported ' + name);
				return;
			}

			if (kind === 'pdf') {
				// THE SAME HTML THE WEB PAGE EXPORT WRITES, handed to the
				// engine Obsidian is already running. One builder, so a PDF
				// cannot drift from the pages the preview drew — and no page
				// layout of our own, which is the part that would mean owning
				// line breaking, font metrics and font embedding.
				const html = this.exportToHtml(sections, opt, false);
				const pdfName = into(this.exportFileName(scope, 'pdf'));
				try {
					const bytes = await this.exportPdfRender(html, opt);
					if (!bytes || !bytes.length) throw new Error('the engine returned nothing');
					// `.buffer` is the whole file: the render resolves with a fresh
					// `new Uint8Array(buf)`, offset 0, no pool behind it.
					await this.app.vault.createBinary(pdfName, bytes.buffer);
					this.exportRemember(scope, kind, opt, files.length, pdfName);
					new Notice('Word-Smith: exported ' + pdfName);
					return;
				} catch (e) {
					// ── NO CONSOLATION FILE ─────────────────────────────────
					//
					// It says what went wrong and stops — it does not write the web page
					// instead: a file nobody asked for costs more than pressing Export twice.
					console.error('Word-Smith: PDF export failed', e);
					new Notice('Word-Smith: could not make a PDF \u2014 '
						+ wsErrMsg(e)
						+ '. Nothing was written.');
					return;
				}
			}

			if (kind === 'html') {
				// THE SAME DOCUMENT THE PREVIEW DRAWS, with the screen
				// decoration off: one builder, so the file cannot drift
				// from the thing the writer just looked at. Plain text,
				// so `create` rather than `createBinary` — there is no
				// container to malform, no relationship to dangle and no
				// part to leave out, which are the three ways a .docx
				// breaks. It also carries the @page rules, which is why
				// printing it from any browser gives a PDF with the
				// pagination, the margins and the running header intact.
				const htmlName = into(this.exportFileName(scope, 'html'));
				await this.app.vault.create(htmlName, this.exportToHtml(sections, opt, false));
				this.exportRemember(scope, kind, opt, files.length, htmlName);
				new Notice('Word-Smith: exported ' + htmlName);
				return;
			}
			const bytes = wsBuildDocx(sections, opt);
			const name = into(this.exportFileName(scope, 'docx'));
			await this.app.vault.createBinary(name, bytes.buffer);
			// Word is the default format, so the export a writer actually repeats
			// is the one that most needs remembering.
			this.exportRemember(scope, kind, opt, files.length, name);
			new Notice('Word-Smith: exported ' + name);
		} catch (e) {
			console.error('Word-Smith export failed', e);
			new Notice('Word-Smith: export failed — ' + wsErrMsg(e));
		}
	},

	// ── PDF, THROUGH A WEBVIEW'S OWN printToPDF ────────────────────────────
	//
	// Rendering the manuscript to HTML and printing it gets real
	// pagination, widow and orphan control and a running header from CSS —
	// all the hard parts of a page layout engine, for free. Writing a PDF
	// by hand would mean owning line breaking, font metrics and page
	// geometry, and embedding a font for anything outside WinAnsi.
	//
	// · NO DIALOG. A print dialog needs a hand on it; `printToPDF` returns
	// bytes, so the PDF lands beside the .docx with the same name and no
	// questions.
	// · THE HALF THAT CAN BE PROVED IS SPLIT OUT. The mapping from a writer's
	// options to Chromium's is pure (`exportPdfOptions`); only the call
	// itself cannot run headlessly, and that is one function with one
	// job.
	//
	// It is desktop only, and the format is absent on a phone rather than
	// present and failing.
	exportPdfOptions(this: WordSmith, o: WsExportRun) {
		const paper = wsPaperOf(o);
		const m = wsPaperMicrons(paper);
		// ── NO HEADER OF OURS. THE DOCUMENT ALREADY HAS ONE ─────────────────
		//
		// Chromium honours the HTML's own `@page { @top-right { … } }` rule. One
		// document, one header, and it is the document's — which is also what
		// makes the PDF and the browser-printed page the same pages rather
		// than two arrangements that agree.
		//
		// If the header ever needs suppressing on the title page, that is the
		// HTML's @page rule to fix, and fixing it there fixes both outputs.
		return {
			// MICRONS. A number in the wrong unit here does not fail, it
			// silently makes a page the size of a postage stamp.
			pageSize: { width: m.width, height: m.height },
			// …and INCHES, in the same object.
			margins: { top: m.margin, bottom: m.margin,
				left: m.margin, right: m.margin },
			// …AND THE DOCUMENT'S OWN @page WINS OVER BOTH.
			//
			// The HTML this prints already carries `@page { size: …; margin: …; }`
			// built from the same paper table — it is what makes the Web page
			// export printable from any browser. With this on, Chromium honours
			// it, so the PDF and the browser-printed page are the same pages
			// rather than two arrangements that happen to agree. The two fields
			// above stay as the answer for a document without an @page rule.
			preferCSSPageSize: true,
			landscape: false,
			// A MANUSCRIPT IS BLACK ON WHITE. Without this the page carries
			// whatever the theme's background is, which on a dark theme is a
			// PDF nobody can print and an agent cannot read.
			printBackground: false,
			displayHeaderFooter: false
		};
	},

	// IS THERE AN ENGINE HERE AT ALL. Asked once and answered honestly: a
	// phone has no Electron, and neither answer is more useful to the writer
	// than the other, because their question is "can I have a PDF".
	//
	// `window.require` IS THE WHOLE TEST. It exists in Obsidian's desktop
	// renderer and nowhere else, and it is what makes the `<webview>` tag
	// available — see `exportPdfRender` for why that tag is the engine.
	exportPdfAvailable(this: WordSmith) {
		try {
			if (Platform && Platform.isMobile) return false;
			if (Platform && Platform.isDesktopApp === false) return false;
		} catch (_) { wsCatch('exportPdfAvailable: if (Platform && Platform.isMobile) return false;', _); }
		try { return typeof window.require === 'function'; } catch { return false; }
	},

	// ── THE ENGINE IS A <webview>, NOT A BrowserWindow ──────────────────────
	//
	// A `<webview>` tag carries its OWN `printToPDF`. It needs no remote, no
	// main-process call and no permission: it is an element, it goes in the
	// document, it loads a page and prints it. That is why it works.
	//
	// With thanks to StoryLine (PixeroJan, MIT), whose export settled which of
	// the two mechanisms Obsidian actually permits.
	exportPdfWebview(this: WordSmith) {
		// The tag only exists when Electron's webview integration is on, which
		// is the same condition as `window.require`.
		if (!this.exportPdfAvailable()) return null;
		try {
			const el = createEl('webview');
			if (typeof el.printToPDF !== 'function' && !('src' in el)) return null;
			return el;
		} catch { return null; }
	},

	// Render HTML to PDF bytes. Resolves with a Uint8Array, or throws with a
	// reason the writer can act on.
	async exportPdfRender(this: WordSmith, html: string, o: WsExportRun) {
		const view = this.exportPdfWebview();
		if (!view) throw new Error('this build has no print engine');
		// HIDDEN, NOT DISPLAY:NONE. A webview that is not laid out does not
		// render, and a page that has not rendered prints blank — so it is
		// moved off screen at one pixel rather than removed from the flow —
		// `.ws-print-webview` in styles.css.
		view.addClass('ws-print-webview');
		// NOTHING FROM THE PAGE RUNS. The document is the writer's own prose,
		// but it is HTML we assembled and it is being loaded into a real
		// browser context: a note carrying a script tag must not execute
		// inside Obsidian's process.
		view.setAttribute('nodeintegration', 'false');
		view.setAttribute('webpreferences', 'contextIsolation=true');
		view.setAttribute('src', 'data:text/html;charset=utf-8,' + encodeURIComponent(html));
		document.body.appendChild(view);

		const done = () => { try { view.remove(); } catch (_) { wsCatch('exportPdfRender: view.remove();', _); } };
		return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
			// A TIMEOUT, because `dom-ready` is not promised. A webview that
			// never loads would otherwise leave the export waiting for ever
			// with nothing on screen to say so, and leave the element in the
			// document for the rest of the session.
			const bail = window.setTimeout(() => {
				done();
				reject(new Error('the print engine did not answer in time'));
			}, 20000);
			view.addEventListener('did-fail-load', () => {
				window.clearTimeout(bail); done();
				reject(new Error('the manuscript could not be loaded for printing'));
			});
			view.addEventListener('dom-ready', () => { void (async () => {
				try {
					// AND A BEAT AFTER IT. `dom-ready` means the document
					// exists, not that Chromium has laid it out — and printing
					// mid-layout is the other way this returns "Printing
					// failed". Half a second is what StoryLine settled on and
					// it costs nothing next to a compile.
					await new Promise((r) => window.setTimeout(r, 500));
					if (typeof view.printToPDF !== 'function') throw new Error('the print engine has no printToPDF');
					const buf = await view.printToPDF(this.exportPdfOptions(o));
					window.clearTimeout(bail); done();
					if (!buf || !buf.length) {
						reject(new Error('the print engine returned nothing'));
						return;
					}
					resolve(new Uint8Array(buf));
				} catch (e) {
					window.clearTimeout(bail); done();
					reject(e instanceof Error ? e : new Error(wsStr(e)));
				}
			})(); });
		});
	},
};
export type ExportMethods = typeof exportMethods;
