// Word-Smith — Tree: Obsidian's file tree: the counts, the flags, the ticks, the order, the moves.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { TFile, TFolder, Menu, Modal, Notice, setIcon } from 'obsidian';
import type { TAbstractFile, View, MenuItem } from 'obsidian';
import type { WordSmithSettings, WsFlagDef, WsOrgMenuCtx } from './settings';
import { wsOrgFolderWords } from './org-index';
import type { WsOrgIndexMap } from './org-index';
import { DEFAULT_SETTINGS, WS_FOLDER_COLOURS, WS_STORM_MS, WS_STORM_PASSES, WS_STYLESHEET_VERSION, wsCatch, wsFlagShapeOf, wsFlagSvg, wsManuscriptSvg, wsPassState, wsPassStorm, wsSoon, wsStatusLabel, wsSvgInto, wsTaskSay, wsIsFile, wsErrMsg, wsElOf, WS_STATE_IDS, WS_STATUSES, wsIsFolder } from './preamble';
import type { WsExplorerItem } from './obsidian-private';
import type WordSmith from './plugin';

// what making a note or a folder answers: a refusal with its reason, or the
// path made and what it is
type WsTreeMade = { ok: false; said: string } | { ok: true; said: string; path: string; kind: string };

export const treeMethods = {

	// The single question every counting surface should ask: the writing
	// history, the folder totals behind a goal, and the badges in the file
	// explorer. Scope first, because "ignore this note entirely" outranks
	// "count it or not".
	// The plugin's own three notes. Compared by path AND by the configured
	// address, so a file a writer has moved is still recognised — the
	// stores are found by their markers, not their names, and the resolver
	// answers where each one actually lives.
	// ── THE MANUSCRIPT'S ROOTS ──────────────────────────────────────────────
	//
	// "Which folders are my writing?" — asked once, answered here, and read by
	// the window, the tree's order and the totals. It is a FILTER, not a
	// definition: nothing has to be declared for this plugin to work, and a
	// vault with no roots behaves exactly as it did before they existed.
	//
	// Why it matters is visible in any vault that is not only a manuscript:
	// the window opened on `999 Archive`, `9999 Trash` and `999 .CSS`, and
	// the foot added their words to the book's. Every figure was true and
	// none of them was about the writing.
	// ── THE FLAGS, AS THE WRITER SET THEM ───────────────────────────────────
	//
	// One place turns the setting into the two things everything else reads:
	// the module table `WS_STATUSES`, which every label, cycle and shape goes
	// through, and the `--ws-flag-*` custom properties the stylesheet paints
	// from. Called on load, whenever the setting changes, and on `css-change`
	// — a theme switch is when the OTHER colour becomes the right one.
	//
	// THE COLOURS ARE OURS NOW. They were theme variables, so a community
	// theme could quietly repaint a writer's manuscript states — including
	// making two of them the same colour.
	flagDefs(this: WordSmith) {
		const stored = Array.isArray(this.settings.flags) ? this.settings.flags : [];
		return WS_STATE_IDS.map((id, i) => {
			const was: Partial<WsFlagDef> = stored.filter(f => f && f.id === id)[0] || {};
			const def: Partial<WsFlagDef> = (DEFAULT_SETTINGS.flags || [])[i] || {};
			return {
				id,
				label: String(was.label || def.label || id),
				shape: was.shape || def.shape || 'pennant',
				light: was.light || def.light || '#888888',
				dark:  was.dark  || def.dark  || '#888888'
			};
		});
	},

	flagCount(this: WordSmith) {
		const n = Number(this.settings.flagCount);
		// Repaired rather than trusted: this is a number in a JSON file a
		// writer can edit, and a count of 9 would offer states that do not
		// exist while a count of -1 would break the cycle.
		if (!isFinite(n) || n < 0) return WS_STATE_IDS.length;
		return Math.min(WS_STATE_IDS.length, Math.floor(n));
	},

	flagsApply(this: WordSmith) {
		const defs = this.flagDefs();
		// ONLY THE STATES IN USE are in the ring — that is what the count
		// means. A flag already written against a note keeps its id and its
		// label, because taking a state out of the ring must not silently
		// unflag work that was already marked.
		WS_STATUSES.splice(0, WS_STATUSES.length, ...defs.slice(0, this.flagCount())
			.map(f => ({ id: f.id, label: f.label, shape: f.shape })));
		let dark = true;
		try { dark = document.body.classList.contains('theme-dark'); } catch (_) { wsCatch('flagsApply: dark = document.body.classList.contains(\'theme-dark\');', _); }
		try {
			const root = document.body;
			for (const f of defs) {
				root.style.setProperty('--ws-flag-' + f.id, dark ? f.dark : f.light);
			}
			// The ink inside an alert triangle, which has to stay legible on
			// whatever colour the triangle was set to.
			root.style.setProperty('--ws-flag-ink', dark ? '#1b1b1b' : '#ffffff');
		} catch (_) { wsCatch('flagsApply: const root = document.body;', _); }
		// AND AN OPEN ORGANIZER IS TOLD. The colours above reach the table as
		// variables the moment they change; the count, the labels and the shapes
		// are read at draw time. A signature of the live set, and a redraw of the
		// pane when it moves — not on every save, which runs this on nearly every
		// interaction.
		try {
			const sig = JSON.stringify(WS_STATUSES);
			if (this._flagsSig !== undefined && sig !== this._flagsSig && typeof this._orgDraw === 'function') {
				this._orgDraw();
			}
			this._flagsSig = sig;
		} catch (_) { wsCatch('flagsApply: if (sig !== this._flagsSig) this._orgDraw();', _); }
		// ── AND THE FILE TREE IS TOLD ─────────────────────────────────────
		//
		// A colour is a CSS custom property, so the tree repaints itself the
		// moment the variable changes; a shape is drawn markup, and
		// `WS_STATUSES` holding the new one changes nothing already on screen.
		// `setFlagBadge`'s `data-drew` stamp carries the shape and the label,
		// not just the id, precisely so a reshaped flag reads as different — but
		// a guard only speaks when it runs, and nothing else redraws the tree
		// after a settings save.
		//
		// STAMPED, NOT SCHEDULED BLIND. A settings save happens on every
		// keystroke in a dozen tabs and a full explorer pass reads the flag maps
		// for every note — the cost `repaintExplorerFlag` exists to avoid. So
		// the pass is asked for only when the flags THEMSELVES changed, which is
		// the same trick `data-drew` plays one level down.
		try {
			const stamp = JSON.stringify(
				WS_STATUSES.map((st) => [st.id, st.shape, st.label]));
			if (this._flagStamp !== stamp) {
				this._flagStamp = stamp;
				if (this.explorerWanted()) this.scheduleExplorerPatch();
			}
		} catch (_) { wsCatch('flagsApply: const stamp = JSON.stringify(', _); }
	},

	// WHO ELSE IS SHOWING THIS ORDER. Obsidian's explorer is asked to sort
	// again by `repaintExplorerOrder`, and that half worked from the first
	// day — but a Manuscript window standing open beside it drew whatever it
	// had drawn last, because nothing told it. A drag in one tree has to move
	// the row in both, or the two are two orders again.
	//
	// A set of callbacks rather than an event: there is at most a handful of
	// them, they live exactly as long as the window that registered one, and
	// a window that forgets to unregister would otherwise keep a dead modal's
	// draw alive for the session.
	onTreeOrderChange(this: WordSmith, fn: () => void) {
		if (!this._treeOrderWatchers) this._treeOrderWatchers = new Set();
		this._treeOrderWatchers.add(fn);
		return () => { try { this._treeOrderWatchers.delete(fn); } catch (_) { wsCatch('onTreeOrderChange: this._treeOrderWatchers.delete(fn);', _); } };
	},

	// A NOTE'S CONTENTS CHANGED, which is a different fact from its SHAPE.
	//
	// Separate from `onTreeOrderChange` because the answer is different: a
	// shape change means redraw the tree, and this means throw away what you
	// remember about ONE path and then redraw. Folding them together would make
	// every keystroke in the editor rebuild every open tree, which is the cost
	// the per-path cache exists to avoid in the first place.
	//
	// The path goes TO the watcher rather than being resolved here: a folder
	// row shows the sum of its children, so a window has to forget the note and
	// every folder above it, and only the window knows which of those it is
	// drawing.
	onTreeCountsChange(this: WordSmith, fn: (paths: string[]) => void) {
		if (!this._treeCountWatchers) this._treeCountWatchers = new Set();
		this._treeCountWatchers.add(fn);
		return () => { try { this._treeCountWatchers.delete(fn); } catch (_) { wsCatch('onTreeCountsChange: this._treeCountWatchers.delete(fn);', _); } };
	},

	// DEBOUNCED, because this fires on every save and Obsidian saves while you
	// type. Two seconds is long enough that a paragraph is one redraw, and
	// short enough that a writer who glances at the window sees the truth.
	// Nothing is queued at all when no window is open — the common case is a
	// vault with no Manuscript window in it, and that case should cost one
	// property lookup per save.
	treeCountsChanged(this: WordSmith, path: string) {
		if (!path) return;
		if (!this._treeCountWatchers || !this._treeCountWatchers.size) return;
		if (!this._treeCountDirty) this._treeCountDirty = new Set();
		this._treeCountDirty.add(path);
		if (this._treeCountTimer) window.clearTimeout(this._treeCountTimer);
		this._treeCountTimer = window.setTimeout(() => {
			this._treeCountTimer = null;
			const paths = Array.from(this._treeCountDirty || []);
			this._treeCountDirty = new Set();
			for (const fn of (this._treeCountWatchers || [])) {
				try { fn(paths); } catch (_) { wsCatch('treeCountsChanged: fn(paths);', _); }
			}
		}, 2000);
	},

	// THE VAULT'S SHAPE CHANGED — something created, renamed, moved or deleted.
	//
	// Separate from `treeOrderChanged`, and it exists because of when it
	// fires. A move is `fileManager.renameFile`, and the drop handler redraws
	// the moment that resolves — which is BEFORE Obsidian's own index has the
	// note at its new address, so the tree redraws showing exactly what it
	// showed before and only some later event puts it right. That is the
	// "visual refresh is lagging" that survived the last fix: the redraw was
	// not late, it was early.
	//
	// So the vault's own events are the trigger, because they fire when the
	// vault is ready to be asked. Coalesced into one frame: a burst of
	// creates on a sync should redraw the tree once, not forty times.
	treeShapeChanged(this: WordSmith) {
		if (this._treeShapeQueued) return;
		this._treeShapeQueued = true;
		const run = () => {
			this._treeShapeQueued = false;
			this.treeOrderChanged();
		};
		try {
			if (typeof window !== 'undefined' && window.requestAnimationFrame) {
				window.requestAnimationFrame(run);
				return;
			}
		} catch (_) { wsCatch('treeShapeChanged: if (typeof window !== \'undefined\' && window.requestAnimationFrame)', _); }
		window.setTimeout(run, 0);
	},

	treeOrderChanged(this: WordSmith) {
		// GUARDED, AND FIRST. This was a bare call, and every watcher ran
		// AFTER it — so anything thrown while repainting Obsidian's explorer
		// took the whole notification with it and no open window was ever
		// told. The window then looked like it was refreshing slowly or not
		// at all, with nothing in the console, because the throw was inside a
		// requestAnimationFrame callback nobody was catching.
		//
		// The watchers are independent of each other and of this, so each gets
		// its own guard: one window failing to draw must not stop the next.
		try { this.repaintExplorerOrder(); } catch (e) {
			console.error('Word-Smith: could not repaint the explorer order', e);
		}
		for (const fn of (this._treeOrderWatchers || [])) {
			try { fn(); } catch (e) {
				console.error('Word-Smith: a tree watcher failed', e);
			}
		}
	},

	// MOVE A NOTE OR A FOLDER INTO ANOTHER FOLDER — the other half of what a
	// drag means in a file tree, and the half Obsidian's own tree does.
	//
	// `fileManager.renameFile`, never `vault.rename`: the file manager is what
	// rewrites every link that pointed at the note. A move that quietly broke
	// forty links would be the worst thing in this plugin.
	async treeMoveInto(this: WordSmith, movedPath: string, intoFolder: string) {
		const vault = this.app.vault;
		let af = null;
		try { af = vault.getAbstractFileByPath(movedPath); } catch (_) { wsCatch('treeMoveInto: af = vault.getAbstractFileByPath(movedPath);', _); }
		// EVERY REFUSAL SAYS WHY: a bare `false` leaves the writer to guess
		// whether they missed the row, whether the feature is broken, or whether
		// the plugin has an opinion they have not been told.
		if (!af) return { ok: false, said: 'That file is no longer there.' };
		const name = String(movedPath).split('/').pop() || '';
		const dest = intoFolder ? intoFolder + '/' + name : name;
		if (dest === movedPath) return { ok: false, said: '' };   // already there; nothing to say
		// A FOLDER CANNOT GO INSIDE ITSELF, and this is not hypothetical: the
		// tree is nested, the rows are close together, and the result would be
		// a folder that no longer exists at any path.
		if (af.children && (intoFolder === movedPath
			|| String(intoFolder).indexOf(movedPath + '/') === 0)) {
			return { ok: false, said: 'A folder cannot go inside itself.' };
		}
		// Something already there of that name. Obsidian refuses too, but it
		// throws where a writer can only see a drag that did nothing.
		let clash = null;
		try { clash = vault.getAbstractFileByPath(dest); } catch (_) { wsCatch('treeMoveInto: clash = vault.getAbstractFileByPath(dest);', _); }
		if (clash) {
			return { ok: false, said: 'There is already something called \u201c' + name
				+ '\u201d there, so nothing was moved.' };
		}
		const from = (() => {
			const cut = String(movedPath).lastIndexOf('/');
			return cut === -1 ? '' : movedPath.slice(0, cut);
		})();
		// WHICH LINE IT WAS ON, read BEFORE the move — afterwards the row is
		// gone from that folder and the number is unrecoverable. An undo that
		// dropped the file back at the END of the folder it came from would be
		// a second move dressed as a reversal, and a writer who had spent an
		// evening on a running order would have to find the place again.
		const wasAt = this.treeOrderCurrent(from).indexOf(movedPath);
		try {
			await this.app.fileManager.renameFile(af, dest);
		} catch (e) {
			return { ok: false, said: 'Could not move that \u2014 '
				+ wsErrMsg(e) };
		}
		// THE ORDER FOLLOWS THE FILE. Both folders are rewritten: the one it
		// left, which would otherwise keep a line for a path that is not there
		// any more, and the one it joined, where it goes on the end — the same
		// place a new note goes, because that is what it now is to that
		// chapter.
		try {
			const after = this.treeOrderCurrent(intoFolder || '');
			if (after.indexOf(dest) === -1) after.push(dest);
			await this.treeOrderWrite(intoFolder || '', after);
			if (from !== (intoFolder || '')) {
				await this.treeOrderWrite(from, this.treeOrderCurrent(from));
			}
		} catch (_) { wsCatch('treeMoveInto: const after = this.treeOrderCurrent(intoFolder || \'\');', _); }
		this.treeOrderChanged();
		// ENOUGH TO REVERSE IT, in the result. The alternative was for the
		// caller to remember the addresses itself, which is one more place to
		// get them wrong and a second description of a move.
		return { ok: true, said: '', moved: movedPath, from, dest, wasAt };
	},

	// ── MAKING A NODE ───────────────────────────────────────────────────────
	//
	// The act that turns a view of a folder into an outliner. Until a chapter
	// could be MADE here, a writer who decided on one mid-arrangement had to
	// leave for the file explorer, make it there, and come back to find where
	// it had landed.

	// WHERE A NEW THING GOES, given what is selected. Every other act in this
	// window reads the selection, and a create that always went to the vault
	// root would be the one gesture that ignored where the writer was
	// standing.
	//
	// A CHOSEN NOTE MEANS BESIDE IT, not inside it. A note is not a container;
	// the only sane reading of "add a scene while I have a scene selected" is
	// "another one here". The manuscript root is the fallback rather than the
	// vault root when one is set — this window is about the writing.
	outlinerNewParent(this: WordSmith, sel: Iterable<{ kind: string; path: string }> | null) {
		const rows = Array.from(sel || []);
		const first = rows[0];
		if (!first) {
			try {
				void 0;
			} catch (_) { wsCatch('outlinerNewParent: void 0;', _); }
			return '';
		}
		if (first.kind === 'folder') return first.path;
		const cut = String(first.path).lastIndexOf('/');
		return cut === -1 ? '' : first.path.slice(0, cut);
	},

	// A NAME NOTHING IS USING. `vault.create` THROWS on an existing path, so
	// without this the second "Untitled" of a session is not a second note —
	// it is an exception in a catch block and a button that did nothing, which
	// is the export's own silent-failure shape.
	outlinerFreeName(this: WordSmith, parent: string, base: string, ext: string) {
		const dir = parent ? parent + '/' : '';
		const at = (n: number) => dir + base + (n > 1 ? ' ' + n : '') + (ext || '');
		for (let n = 1; n < 500; n++) {
			const want = at(n);
			let taken = null;
			try { taken = this.app.vault.getAbstractFileByPath(want); } catch (_) { wsCatch('outlinerFreeName: taken = this.app.vault.getAbstractFileByPath(want);', _); }
			if (!taken) return want;
		}
		// Five hundred Untitleds is not a vault this can help, but it must not
		// spin: the timestamp cannot collide with the sequence above.
		return dir + base + ' ' + Date.now() + (ext || '');
	},

	// The new row goes on the END of its folder's order. The running order is
	// the point of this tab, and a scene that appeared alphabetically in the
	// middle of a book would be the one row the writer did not put where it
	// is. Same rule as a note that arrives from a sync — see
	// `exportApplyRemembered`.
	async outlinerJoinOrder(this: WordSmith, parent: string, path: string) {
		try {
			const now = this.treeOrderCurrent(parent || '');
			if (now.indexOf(path) === -1) now.push(path);
			await this.treeOrderWrite(parent || '', now);
		} catch { /* the file exists; its position is the lesser loss */ }
	},

	async outlinerAddNote(this: WordSmith, parent: string, opts: { open: boolean; }): Promise<WsTreeMade> {
		const path = this.outlinerFreeName(parent, 'Untitled', '.md');
		try {
			// NO `storeEnsureFolder` HERE. The parent came off a row in the
			// tree, so it exists by construction — and calling it anyway
			// creates the folder a second time on any vault whose
			// `getAbstractFileByPath` is slower than the create, which is one
			// more way to end up with two of something.
			await this.app.vault.create(path, '');
			// KEPT VISIBLE, for the reason a new folder is: made outside a
			// manuscript root it is not in the tree's set, and a writer who
			// just pressed New note would watch nothing happen.
		} catch (e) {
			return { ok: false, said: 'Could not make that \u2014 '
				+ wsErrMsg(e) };
		}
		await this.outlinerJoinOrder(parent, path);
		// IT OPENS. A note made and not opened is a note the writer has to go
		// and find, and the reason they made it was to write in it. BEHIND THE
		// RENAME: an ACTIVE open takes the focus the caret in the row needs a
		// frame later — the rename would blur and commit "Untitled". The tab is
		// still made; it does not take the focus, and it follows the rename
		// through fileManager.
		//
		// AND NOT AT ALL FROM THE ORGANIZER. The Organizer is a LEAF, and
		// `openLinkText` with no new leaf opens in the ACTIVE one — the
		// Organizer's own, which the note would take over, `active: false` or
		// not. The Organizer draws the new row and starts the rename on it; that
		// is the feedback, and `opts.open === false` is how it says so. Enter on
		// the row opens the note when wanted.
		if (!(opts && opts.open === false)) {
			try { void this.app.workspace.openLinkText(path, '', false, { active: false }); } catch (_) { wsCatch('outlinerAddNote: this.app.workspace.openLinkText(path, \'\', false, { active: false });', _); }
		}
		this.treeShapeChanged();
		// `kind` SAID RATHER THAN GUESSED. The caller starts a rename on
		// what was made, and the rename needs to know which it is — a
		// caller inferring "file" from the fact that it called the note
		// maker is the same fact written twice, and the second copy is the
		// one that goes wrong when a third caller appears.
		return { ok: true, said: '', path, kind: 'file' };
	},

	// DELETED RATHER THAN LEFT: a method with no caller is a name somebody
	// reuses, and `drawHead` is what that costs when it is left for later —
	// 322 unreachable lines for nine days, then a no-op stub with three
	// callers for another five. Both gone now; the example is kept because
	// the cost was real.

	async outlinerAddFolder(this: WordSmith, parent: string): Promise<WsTreeMade> {
		const path = this.outlinerFreeName(parent, 'New folder', '');
		try {
			await this.app.vault.createFolder(path);
		} catch (e) {
			return { ok: false, said: 'Could not make that \u2014 '
				+ wsErrMsg(e) };
		}
		await this.outlinerJoinOrder(parent, path);
		// A FOLDER DOES NOT OPEN. There is nothing in it to read, and opening
		// the last note of a different folder because this one is empty would
		// be worse than doing nothing.
		this.treeShapeChanged();
		return { ok: true, said: '', path, kind: 'folder' };
	},

	// A CONFIRMATION, for the path that does not go through Obsidian's own
	// delete command. It asks the question the explorer asks, in the same
	// shape: the name, what will happen to it, and a destructive button that
	// is not the default focus.
	//
	// Returns a promise for yes/no. A closed dialog is a no — the writer who
	// presses Escape has said something, and reading that as consent is how a
	// chapter disappears.
	confirmDelete(this: WordSmith, file: TAbstractFile) {
		return new Promise((resolve) => {
			if (!file || !Modal) { resolve(false); return; }
			const isFolder = !!file.children;
			const name = String(file.path).split('/').pop();
			let answered = false;
			const done = (v: boolean) => { if (!answered) { answered = true; resolve(v); } };
			const m = this.wsModal();
			if (!m) { done(false); return; }
			m.titleEl.setText('Delete ' + (isFolder ? 'folder' : 'file'));
			m.contentEl.createEl('p', { text: isFolder
				? 'Delete \u201c' + name + '\u201d and everything in it?'
				: 'Delete \u201c' + name + '\u201d?' });
			m.contentEl.createEl('p', { cls: 'ws-settings-note', text:
				'It goes wherever Obsidian\u2019s deleted-files setting sends things.' });
			const row = m.contentEl.createDiv({ cls: 'ws-confirm-row' });
			const no = row.createEl('button', { text: 'Cancel' });
			no.addEventListener('click', () => { done(false); m.close(); });
			const yes = row.createEl('button', { cls: 'mod-warning', text: 'Delete' });
			yes.addEventListener('click', () => { done(true); m.close(); });
			// ESCAPE, THE × AND A CLICK OUTSIDE ALL MEAN NO. `onClose` is the
			// one place all three arrive.
			const wasClose = m.onClose ? m.onClose.bind(m) : null;
			m.onClose = () => { done(false); if (wasClose) wasClose(); };
			m.open();
			// The cancel takes focus, so a stray Return does not delete.
			try { window.setTimeout(() => no.focus(), 0); } catch (_) { wsCatch('confirmDelete: window.setTimeout(() => no.focus(), 0);', _); }
		});
	},

	// ── RENAMING A ROW, THE WAY THE EXPLORER DOES ───────────────────────────
	//
	// The NAME ONLY. A note called `Ch 01.md` is offered as "Ch 01" and comes
	// back as `Ch 01.md`: the extension is not part of the name a writer typed
	// and putting it in the box invites them to delete it by accident. A
	// folder has no extension and is offered whole.
	outlinerRenameParts(this: WordSmith, path: string, isFolder: boolean) {
		const full = String(path || '');
		const cut = full.lastIndexOf('/');
		const dir = cut === -1 ? '' : full.slice(0, cut);
		const name = cut === -1 ? full : full.slice(cut + 1);
		const dot = isFolder ? -1 : name.lastIndexOf('.');
		return {
			dir,
			base: dot > 0 ? name.slice(0, dot) : name,
			ext:  dot > 0 ? name.slice(dot) : ''
		};
	},

	// Returns {ok, said, path}. Refuses rather than guesses, for the same
	// reasons the move does: a rename that lands on an existing name is a
	// rename that could destroy something.
	async outlinerRenameTo(this: WordSmith, path: string, isFolder: boolean, typed: string) {
		const parts = this.outlinerRenameParts(path, isFolder);
		const want = String(typed == null ? '' : typed).trim();
		// AN EMPTY BOX IS A CANCEL, not a file called nothing. A writer who
		// selects the name and presses Escape-then-Enter, or clears it and
		// clicks away, has not asked for anything.
		if (!want || want === parts.base) return { ok: false, said: '' };
		// The separator would silently MOVE the file, which is a different act
		// with a different gesture, and it is the one act here that is hard to
		// undo by hand.
		if (want.indexOf('/') !== -1) {
			return { ok: false, said: 'A name cannot contain a slash \u2014 drag the row to move it.' };
		}
		const dest = (parts.dir ? parts.dir + '/' : '') + want + parts.ext;
		if (dest === path) return { ok: false, said: '' };
		let taken = null;
		try { taken = this.app.vault.getAbstractFileByPath(dest); } catch (_) { wsCatch('outlinerRenameTo: taken = this.app.vault.getAbstractFileByPath(dest);', _); }
		if (taken) {
			return { ok: false, said: 'There is already something called \u201c' + want + '\u201d here.' };
		}
		try {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (!f) return { ok: false, said: 'That has moved since \u2014 nothing was renamed.' };
			// `fileManager`, never `vault.rename`: it is what rewrites every
			// link pointing at the note. Same rule as the move.
			if (this.app.fileManager && this.app.fileManager.renameFile) {
				await this.app.fileManager.renameFile(f, dest);
			} else {
				await this.app.vault.rename(f, dest);
			}
		} catch (e) {
			return { ok: false, said: 'Could not rename that \u2014 '
				+ wsErrMsg(e) };
		}
		this.treeShapeChanged();
		return { ok: true, said: '', path: dest };
	},

	// ── THE RIGHT-CLICK MENU, FOR A TREE THAT IS A FILE TREE ────────────────
	//
	// The outliner shows the same files the explorer shows, so it should
	// answer the same gesture. A writer who has learnt that right-clicking is
	// how you rename, delete or make something should not find that the tree
	// twelve inches away has a different answer — and worse, a SMALLER one.
	//
	// ONE BUILDER FOR OUR OWN ROWS. `fileMenuFor` is what the explorer's menu
	// uses, and calling it here rather than listing flags and colours again is
	// what stops the two menus disagreeing the first time one gains a state.
	outlinerRowMenu(this: WordSmith, menu: Menu, item: { path: string; kind: string }, ctx: WsOrgMenuCtx) {
		const c = ctx || {};
		const path = item && item.path;
		const isFolder = !!(item && item.kind === 'folder');
		const file = path ? this.app.vault.getAbstractFileByPath(path) : null;

		// ── MAKE SOMETHING ──────────────────────────────────────────────────
		// First, because on empty space it is the whole menu, and a row's menu
		// reads better opening with the thing that adds rather than the thing
		// that destroys.
		const parent = isFolder ? path : this.outlinerNewParent(item ? [item] : []);
		// ── A THING JUST MADE IS SHOWN, AND ASKS FOR ITS NAME ───────────────
		//
		// Both were half-wired and in different halves, which is why they
		// failed differently: `New note` never revealed, so a note made
		// inside a shut folder appeared in the file explorer and NOWHERE in
		// this tree; `New folder` revealed and never asked for a name, so it
		// arrived called "Untitled" and stayed that way.
		//
		// THE RENAME IS THE POINT OF MAKING ONE. Obsidian's own explorer
		// puts the caret in the name the moment a file is created, and a
		// writer adding a scene has its name in their head — a row that
		// appears already named "Untitled 1" makes them go and find it
		// again.
		//
		// REVEAL FIRST, THEN RENAME. The rename finds its row by
		// `data-path`, and a row inside a folder still shut has not been
		// drawn — so renaming before revealing types into nothing. `made`
		// is one function because the two acts are one act, and because
		// having written it twice is how they ended up wired differently.
		const made = (r: WsTreeMade) => {
			if (!r || !r.ok) {
				if (c.said && r) c.said(r.said, true);
				return;
			}
			if (c.reveal) c.reveal();
			// The tree redraws on a vault change, and that redraw is what
			// puts the row on screen; the rename has to run after it rather
			// than against the tree as it was. A frame is enough and is what
			// the drag-undo path already waits.
			window.setTimeout(() => {
				if (c.rename) c.rename({ path: r.path, kind: r.kind });
			}, 0);
		};
		menu.addItem((i: MenuItem) => i.setTitle('New note').setIcon('file-text')
			.onClick(async () => { made(await this.outlinerAddNote(parent, { open: c.opens !== false })); }));
		menu.addItem((i: MenuItem) => i.setTitle('New folder').setIcon('folder')
			.onClick(async () => { made(await this.outlinerAddFolder(parent)); }));
		// NOTHING BELOW THIS NEEDS A ROW, so on empty space the menu stops
		// here. A greyed-out Delete on a click that selected nothing is a
		// control promising something it cannot do.
		if (!path) return menu;
		menu.addSeparator();

		if (!isFolder) {
			menu.addItem((i: MenuItem) => i.setTitle('Open').setIcon('file')
				.onClick(() => { try { void this.app.workspace.openLinkText(path, '', false); } catch (_) { wsCatch('outlinerRowMenu: this.app.workspace.openLinkText(path, \'\', false);', _); } }));
			// A FOLDER CANNOT BE OPENED IN A TAB, so it is not offered one.
			menu.addItem((i: MenuItem) => i.setTitle('Open in new tab').setIcon('lucide-file-plus')
				.onClick(() => { try { void this.app.workspace.openLinkText(path, '', true); } catch (_) { wsCatch('outlinerRowMenu: this.app.workspace.openLinkText(path, \'\', true);', _); } }));
		}
		menu.addSeparator();

		// OUR OWN ROWS, from the one builder — which now carries the report
		// row too, so both trees answer a right-click the same way. It used to
		// be added here and not there, and the same gesture did different
		// things depending on which tree the row was in.
		try { this.fileMenuFor(menu, file || { path, children: isFolder ? [] : undefined }); } catch (_) { wsCatch('outlinerRowMenu: this.fileMenuFor(menu, file || path, children: isFolder ? [] : …', _); }
		menu.addSeparator();

		// ── RENAME AND DELETE, THROUGH OBSIDIAN'S OWN COMMANDS ──────────────
		//
		// Delete goes through Obsidian's own command, so the writer gets the
		// dialog they know — the confirmation included, and whatever it grows
		// into later. The file has to be the ACTIVE one first, which is what the
		// explorer does when you click a row. `executeCommandById` is not a
		// documented API; where it is missing the fallback is the old
		// behaviour rather than a row that does nothing.
		const runFileCommand = async (id: string, fallback: () => Promise<void>) => {
			try {
				// The row has to be the one the command acts on. Obsidian's
				// file commands read the active leaf's file, so a note is
				// opened first; a folder has no leaf and falls back below.
				if (file && !file.children && this.app.workspace.openLinkText) {
					await this.app.workspace.openLinkText(file.path, '', false);
				}
				const cmds = this.app.commands;
				if (cmds && cmds.executeCommandById && file && !file.children) {
					if (cmds.executeCommandById(id)) return;
				}
			} catch (_) { wsCatch('outlinerRowMenu / runFileCommand: if (file && !file.children && this.app.workspace.openLinkText)', _); }
			try { await fallback(); } catch (e) {
				if (c.said) c.said('Could not do that \u2014 '
					+ wsErrMsg(e), true);
			}
		};

		// ── RENAME HAPPENS ON THE ROW ───────────────────────────────────────
		//
		// The explorer renames IN PLACE: the name becomes an editable field on
		// the row, with the basename selected and the caret in it. That is what
		// a writer means by "like the file explorer", and the reason to build
		// it rather than borrow it is that the explorer's inline rename lives
		// on ITS rows, in the sidebar, which may not even be open.
		menu.addItem((i: MenuItem) => i.setTitle('Rename').setIcon('pencil')
			.onClick(() => { if (c.rename) c.rename(item); }));
		menu.addItem((i: MenuItem) => i.setTitle('Delete').setIcon('trash')
			.onClick(() => {
				void runFileCommand('app:delete-file', async () => {
					// THE FALLBACK ASKS TOO. A confirmation is not a nicety
					// here — it is the difference between a mis-aimed click
					// and a lost chapter — so the path that does not go
					// through Obsidian's command puts up its own.
					if (!file) return;
					const ok2 = await this.confirmDelete(file);
					if (!ok2) return;
					// The file manager honours the writer's deletion preference.
					if (file) await this.app.fileManager.trashFile(file);
				});
			}));

		// ── AND EVERYBODY ELSE'S ROWS ───────────────────────────────────────
		// Obsidian broadcasts `file-menu` from its own tree so any plugin can
		// add to it. A tree that does not broadcast is a tree where a writer's
		// other plugins silently stop working — and they will blame the row,
		// not the window.
		//
		// The source string is this window's own, so a plugin that cares WHERE
		// it was clicked can tell.
		try {
			if (file) this.app.workspace.trigger('file-menu', menu, file, 'word-smith-outliner');
		} catch (_) { wsCatch('outlinerRowMenu: if (file) this.app.workspace.trigger(\'file-menu\', menu, file, …', _); }
		return menu;
	},

	// ── TAKING A MOVE BACK ──────────────────────────────────────────────────
	//
	// Only a MOVE, and deliberately not a reorder. Reordering is cheap to
	// reverse by hand: the rows are all on screen and the writer drags one
	// back. A move is not — the file has left the folder they were looking at
	// and its links have been rewritten, so the cost of the mistake is a file
	// they cannot find. That asymmetry is the whole argument, and it is why
	// there is no undo stack here: one move, offered back for as long as the
	// say-line holds it, and then gone.
	//
	// It REFUSES rather than guesses. If the file has been renamed, moved
	// again or deleted since, or something now sits at the address it came
	// from, putting it back would be a fresh mistake wearing the word "undo".
	async treeMoveUndo(this: WordSmith, rec: { ok: boolean; undone: boolean; dest: string; from: string; wasAt: number }) {
		if (!rec || !rec.ok || rec.undone) {
			return { ok: false, said: 'There is nothing to undo.' };
		}
		// SPENT ON USE, before anything can fail. An undo offered twice is a
		// second move — the say-line is still on screen while the first one
		// runs, and a double press is a thing hands do.
		rec.undone = true;
		const vault = this.app.vault;
		let af = null;
		try { af = vault.getAbstractFileByPath(rec.dest); } catch (_) { wsCatch('treeMoveUndo: af = vault.getAbstractFileByPath(rec.dest);', _); }
		if (!af) {
			return { ok: false, said: 'That file has moved again since, so it '
				+ 'was left where it is.' };
		}
		const name = String(rec.dest).split('/').pop() || '';
		const home = rec.from ? rec.from + '/' + name : name;
		let clash = null;
		try { clash = vault.getAbstractFileByPath(home); } catch (_) { wsCatch('treeMoveUndo: clash = vault.getAbstractFileByPath(home);', _); }
		if (clash) {
			return { ok: false, said: 'There is something called \u201c' + name
				+ '\u201d back there now, so nothing was moved.' };
		}
		try {
			await this.app.fileManager.renameFile(af, home);
		} catch (e) {
			return { ok: false, said: 'Could not put that back \u2014 '
				+ wsErrMsg(e) };
		}
		try {
			// BACK ON THE LINE IT WAS ON. `treeOrderCurrent` answers with the
			// folder as it is now, which is the folder minus this file, so the
			// remembered index is still the right place to splice it into —
			// unless the folder has shrunk since, which the clamp covers.
			const home2 = rec.from || '';
			const rows = this.treeOrderCurrent(home2).filter((p2) => p2 !== home);
			const at = Math.max(0, Math.min(rows.length,
				typeof rec.wasAt === 'number' && rec.wasAt >= 0 ? rec.wasAt : rows.length));
			rows.splice(at, 0, home);
			await this.treeOrderWrite(home2, rows);
			const leftBehind = (() => {
				const cut = String(rec.dest).lastIndexOf('/');
				return cut === -1 ? '' : rec.dest.slice(0, cut);
			})();
			if (leftBehind !== home2) {
				await this.treeOrderWrite(leftBehind, this.treeOrderCurrent(leftBehind));
			}
		} catch (_) { wsCatch('treeMoveUndo: const home2 = rec.from || \'\';', _); }
		this.treeOrderChanged();
		return { ok: true, said: '', path: home };
	},

	// ════════════════════════════════════════════════════════════════════════
	// THE FILE TREE'S ORDER
	// ════════════════════════════════════════════════════════════════════════
	//
	// Obsidian sorts the explorer by name, and a manuscript is not in
	// alphabetical order — which is why writers number their chapters `01 - `,
	// `02 - `, and then live with those numbers in every link, tab title and
	// search result forever. This is the plugin's answer: the order lives in
	// `ws-export.md` and the explorer is told to use it.
	//
	// PATCHED AT THE COMPARATOR, NOT AT THE DOM. The tempting version reorders
	// the tiles after Obsidian has drawn them — the mutation observer is
	// already there, and it would take an afternoon. It also loses: the
	// explorer VIRTUALISES its rows, so anything moved is put back the moment
	// the list scrolls or re-renders, and the fight is invisible until a vault
	// is big enough to scroll. Going through `getSortedFolderItems` means the
	// order is Obsidian's own render, so collapse state, drag-and-drop,
	// renames and creation all keep working with nothing to keep in step.
	//
	// IT IS A PRIVATE METHOD, and this is the price of the feature: some
	// future release can rename it. So the patch is written to FAIL BACK, not
	// to throw — a missing method leaves the tree alphabetical and says so
	// once, and anything the sort itself throws returns Obsidian's own answer.
	// A tree that will not draw is a vault a writer cannot navigate, which is
	// a far worse failure than a tree in the wrong order.
	explorerSortWanted(this: WordSmith) {
		const s: Partial<WordSmithSettings> = this.settings || {};
		return !!(s.pluginEnabled && s.treeOrder);
	},

	// Every file-explorer view currently open. There is normally one; there
	// are two in a pop-out window, and none before the layout is ready.
	// ── A DEFERRED PANE IS NOT A BUILD WITHOUT THE METHOD ─────────
	//
	// Since Obsidian 1.7.2 a sidebar leaf that is not visible at startup is
	// DEFERRED: `leaf.view` is a stub with none of the explorer's methods
	// until the tab is shown. A writer whose left sidebar opened on Search
	// rather than Files gets the stub, and asking it for a method it will
	// have in a moment — and latching a warning that blames the build — is
	// a message that misattributes a fault, which is worse than no message.
	//
	// SKIPPED, NOT LOADED. `leaf.loadIfDeferred()` exists, and forcing a
	// hidden pane to build itself is a side effect nobody asked for — a
	// plugin that wakes panes the writer left shut is a plugin deciding
	// what their sidebar is for. `layout-change` already re-runs the patch,
	// and showing the tab IS a layout change, so the order is applied the
	// moment there is a view to apply it to.
	explorerViews(this: WordSmith) {
		try {
			return (this.app.workspace.getLeavesOfType('file-explorer') || [])
				.filter(l => l && !l.isDeferred)
				.map(l => l && l.view).filter(v => !!v);
		} catch { return []; }
	},

	// The order a folder's children are in RIGHT NOW, as the explorer draws
	// them. This is what a drag edits: an order file that only ever held the
	// rows somebody had moved would leave every other row's position implied
	// by a rule nobody can see, and the first new note would shuffle the lot.
	treeOrderCurrent(this: WordSmith, folderPath: string) {
		const out = [];
		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath || '/');
			const kids = (folder && folder.children) || [];
			const stored = this.treeOrderFor(folderPath || '');
			const at = new Map();
			for (let i = 0; i < stored.length; i++) if (!at.has(stored[i])) at.set(stored[i], i);
			const ranked = [], rest = [];
			for (const c of kids) {
				if (!c || !c.path) continue;
				// ── THE STORES ARE SEEN HERE AND REFUSED AT THE WRITE ────
				//
				// This function is what the file tree AND the Organizer's table both
				// read to know which rows exist, so refusing the plugin's own stores
				// here would make the files INVISIBLE, with no rule a writer could
				// infer. The reason for a refusal survives one step along: this order
				// is STORED IN `ws-structure.md`, so a store path reaching the persisted
				// list is that file writing its own name into itself. `treeOrderWrite`
				// is the single site every persist goes through, and it drops them
				// there. Seen, never written.
				if (at.has(c.path)) ranked.push(c.path); else rest.push(c.path);
			}
			ranked.sort((a, b) => at.get(a) - at.get(b));
			// The leftovers alphabetically, which is where Obsidian would put
			// them and therefore where the writer last saw them.
			rest.sort((a, b) => (this.exportNatural
				? this.exportNatural(a.split('/').pop() || '', b.split('/').pop() || '')
				: a.localeCompare(b)));
			out.push(...ranked, ...rest);
		} catch (_) { wsCatch('treeOrderCurrent: const folder = this.app.vault.getAbstractFileByPath(folderPath || …', _); }
		return out;
	},

	// Move one child to sit before another, and write the whole folder back.
	// `beforePath` null means the end.
	async treeOrderMove(this: WordSmith, folderPath: string, movedPath: string, beforePath: string | null) {
		const now = this.treeOrderCurrent(folderPath);
		const from = now.indexOf(movedPath);
		if (from === -1) return false;
		now.splice(from, 1);
		let to = beforePath == null ? now.length : now.indexOf(beforePath);
		if (to === -1) to = now.length;
		now.splice(to, 0, movedPath);
		await this.treeOrderWrite(folderPath || '', now);
		return true;
	},

	// ── DRAGGING A ROW INTO PLACE ───────────────────────────────────────────
	//
	// The explorer already has a drag, and it means MOVE INTO FOLDER. This
	// feature needs the same gesture to mean something else, so the two share
	// it by ZONE: the middle of a row is Obsidian's — drop a scene on a
	// chapter and it moves into it, exactly as it always did — and the top and
	// bottom edges are ours, where a drop means "put it here". An insertion
	// line says which one is about to happen, because a gesture with two
	// meanings and no feedback is a gesture writers stop trusting.
	//
	// WITHIN ONE FOLDER ONLY. Reordering across folders would have to mean
	// moving the file as well, which is Obsidian's job and is what the middle
	// of the row already does; a drag whose parent has changed is handed
	// straight back rather than intercepted.
	//
	// One delegated listener set, bound at load and gated on the switch, so
	// there is no per-leaf bookkeeping to keep in step with a layout change —
	// and nothing at all to unbind when the toggle goes off.
	// ── HOW WIDE AN EDGE IS, AND WHY IT IS THIS WIDE ────────────────────────
	//
	// A FIFTH, not near a third. The band is a fraction of ONE row, but a
	// writer aims at the gap BETWEEN two rows — and that gap is one row's
	// bottom band plus the next row's top band, so it is twice as wide as the
	// number suggests.
	//
	// At 0.3 on a 26px row that is 8px of edge each side, a 10px middle, and a
	// 16px reorder strip between two middles. The strip is WIDER than the
	// target it separates, so moving down a column of folders feels like there
	// are two middles with a third place in between them — reported exactly
	// that way, and a console log from a real vault showed the edge engaging on
	// nearly every folder passed over. At 0.2 the edges are 5px, the middle is
	// 16px, and the strip is 10px: smaller than the middle, which is the
	// relationship that makes the middle findable at all.
	//
	// THE TRADE IS DELIBERATE AND IT IS NOT SYMMETRIC. Reordering is a gesture
	// a writer repeats — miss it and you drag again, with every row still on
	// screen. Moving into a folder happens occasionally, is Obsidian's own
	// gesture rather than ours, and getting it wrong takes a file out of the
	// folder they were looking at. So the occasional one gets the easier target
	// and the repeated one gets the smaller.
	//
	// A METHOD rather than a constant so a probe can drive both sides of the
	// boundary without knowing the number.
	// Narrowing the middle again makes the strip between two middles narrower
	// still — the geometry is zero-sum — so the number stays and the
	// spring-open went instead (`treeStopSpringLoad`). Two assertions hold it.
	treeDragZone(this: WordSmith) { return 0.2; },

	// ── OBSIDIAN'S SPRING-LOADED FOLDERS, NOT UNDONE BUT NOT TRIGGERED ──────
	//
	// Undoing somebody's behaviour after the fact — a snapshot of collapsed
	// folders at `dragstart` and delayed passes that shut again whatever had
	// opened — invents a state the app never has, and reads as folders
	// opening and snapping shut. Declining to arm it during a drag THIS
	// PLUGIN is steering is just not asking for it.
	//
	// The explorer decides what to unfold from the element it last saw a
	// drag over, held on the view as `lastDropTargetEl`. Cleared on every
	// dragover frame, it never accumulates the hover that the unfold is
	// timed from — so nothing opens, nothing closes, and there is no timer
	// anywhere in this. Dropping a note INTO a folder still works: that is
	// the drop, not the hover.
	//
	// TAKEN FROM A SHIPPING PLUGIN, not deduced: `kh4f/flexplorer` (MIT)
	// does exactly this, one line. It is an INTERNAL and it is not in the
	// public API, so every part of it is optional: no view, no property, no
	// throw, and the drag behaves as it did before.
	treeStopSpringLoad(this: WordSmith) {
		try {
			for (const view of this.explorerViews()) {
				if (view && 'lastDropTargetEl' in view) view.lastDropTargetEl = null;
			}
		} catch (_) { wsCatch('treeStopSpringLoad: for (const view of this.explorerViews())', _); }
	},

	// Where this drop would land, or null when it is not ours to take.
	treeDropAim(this: WordSmith, ev: MouseEvent, row: HTMLElement | null) {
		if (!this.explorerSortWanted()) return null;
		const moved = this._wsDragPath;
		if (!moved || !row || !row.dataset) return null;
		const over = row.dataset.path;
		if (!over || over === moved) return null;
		const parent = (p: string) => {
			const cut = String(p).lastIndexOf('/');
			return cut === -1 ? '' : p.slice(0, cut);
		};
		// A drag out of one folder and into another is a MOVE, and Obsidian
		// already does that better than this could.
		if (parent(moved) !== parent(over)) return null;
		let rect = null;
		try { rect = row.getBoundingClientRect(); } catch { return null; }
		if (!rect || !rect.height) return null;
		const at = (ev.clientY - rect.top) / rect.height;
		const edge = this.treeDragZone();
		if (at > edge && at < 1 - edge) return null;   // the middle is Obsidian's
		const above = at <= edge;
		// Dropping BELOW a row means before whatever follows it — expressed as
		// "before" rather than "after" so there is one insertion rule and the
		// end of a folder is simply `null`.
		let before: string | null = over;
		if (!above) {
			const now = this.treeOrderCurrent(parent(over));
			const next = now[now.indexOf(over) + 1];
			before = next == null ? null : next;
		}
		return { parent: parent(over), row, above, before, moved };
	},

	// WAS THAT US? A record whose added and removed nodes are ALL things this
	// plugin draws is this plugin hearing itself finish. Anything else — a row
	// Obsidian added, a folder it collapsed, a text node — is news.
	//
	// A RECORD WITH NO NODES IS NEWS BY DEFAULT. This watcher asks for
	// `childList` only, so that should not arrive; if it ever does, the safe
	// answer is to repaint, not to guess.
	explorerRecordsMatter(this: WordSmith, recs: MutationRecord[]) {
		const ours = (n: Node) => {
			const c = n && (n as HTMLElement).classList;
			if (!c) return false;
			return c.contains('ws-count') || c.contains('ws-treeflag')
				|| c.contains('ws-tasks')
				|| c.contains('ws-treemarks') || c.contains('ws-foldericon')
				// The export ticks are ours too; a box arriving on a row is not a tree
				// change to redraw over.
				|| c.contains('ws-treetick');
		};
		for (const m of (recs || [])) {
			const nodes = Array.from(m.addedNodes || [])
				.concat(Array.from(m.removedNodes || []));
			if (!nodes.length) return true;
			for (const n of nodes) if (!ours(n)) return true;
		}
		return false;
	},

	// Anything this plugin draws into the file explorer or the outline. One
	// answer, asked everywhere, so a fourth thing added next year cannot be
	// forgotten in one of the three places that used to ask separately.
	explorerWanted(this: WordSmith) {
		const s: Partial<WordSmithSettings> = this.settings || {};
		// ── ONE LIST, WHICH IS WHAT THE COMMENT HERE KEPT ASKING FOR ────────
		//
		// This was a chain of `||`, and FIVE times a feature that paints in the
		// tree was left out of it — each time drawing once and never again,
		// because nothing then watched the explorer for changes. Reported once
		// as "if I add a folder, where Word-Smith applies does not update".
		// The note said "if there is a sixth, build this from a list"; the
		// goal percentage was the fifth and the excuse for not doing it was
		// that two entries are arrays rather than booleans.
		//
		// PREDICATES, so that stops being an excuse. Every reading this plugin
		// paints in somebody else's tree is one line here, and adding the next
		// one is adding a line rather than remembering to.
		const REASONS = [
			() => s.enableFileTreeCounts,
			() => s.enableOutlineCounts,
			() => s.fileTreeFlags,
			() => s.fileTreeFolderIcons,
			() => s.fileTreeKindIcons,
			() => s.fileTreeTasks,
			() => s.folderColors && Object.keys(s.folderColors).length,
			// The tree's own order is drawn by a patched comparator rather than
			// by a mark on a row, and it still needs the tree watched: a folder
			// opened after the patch went on has to be sorted when it renders.
			() => s.treeOrder
		];
		for (const why of REASONS) {
			try { if (why()) return true; } catch (_) { wsCatch('explorerWanted: if (why()) return true;', _); }
		}
		return false;
	},

	// WHERE THIS PLUGIN'S MARKS GO IN SOMEBODY ELSE'S ROW.
	//
	// One trailing box, made once, holding everything we add to a tree row in
	// a fixed order. Three passes used to place their own marks their own way
	// — the flag was inserted before the count, the book used `margin-left:
	// auto`, and the count pass set `justify-content: space-between` on the
	// row — so what a row looked like depended on WHICH features were on and
	// in what order they had painted. Reported exactly: the flag sat beside
	// the name with the book removed, and everything jumped to the right
	// after a restart, because the count pass had run by then and relaid the
	// row.
	//
	// The row is made a flex line and the name given the slack, which is what
	// the count pass did to it anyway; doing it here means it is true whether
	// or not counts are switched on.
	treeMarksBox(this: WordSmith, rowEl: HTMLElement) {
		if (!rowEl) return null;
		try {
			// The row is left as Obsidian styles it unless it is not a flex
			// line at all: setting `display` on somebody else's row is how the
			// counts came to depend on this function running first.
			const how = rowEl.style.display;
			if (how && how !== 'flex') rowEl.setCssStyles({ display: 'flex' });
			// The layout is two classes (`.ws-treerow`, `.ws-treeinner` in
			// styles.css), taken off by removeWordCounts.
			rowEl.classList.add('ws-treerow');
			const inner = rowEl.querySelector(
				'.nav-file-title-content, .nav-folder-title-content, .tree-item-inner');
			if (inner) inner.classList.add('ws-treeinner');
			let box = rowEl.querySelector(':scope > .ws-treemarks');
			if (!box) {
				box = createSpan();
				box.className = 'ws-treemarks';
				rowEl.appendChild(box);
			} else if (box !== rowEl.lastElementChild) {
				// Kept LAST even after Obsidian has appended something of its
				// own to the row, which it does on rename and on drag.
				rowEl.appendChild(box);
			}
			return box;
		} catch { return null; }
	},

	// TASKS IN THE FILE EXPLORER, beside the count.
	//
	// The same reading the Manuscript window carries, in the tree a writer
	// opens notes from: `3/5` is what is done over what is there, and a
	// folder sums its children, so a chapter says where the work is left.
	//
	// READ FROM THE SAME CACHE the counts use, keyed on path and mtime — the
	// text is being read for the word count anyway, and reading every note
	// twice to draw two badges is how a tree starts to feel slow.
	// One note's tasks, from the cache while its mtime holds.
	async treeTasksOf(this: WordSmith, f: TFile) {
		// The plugin's own store keeps its ticks as `- [x]` lines; they are not
		// the writer's tasks.
		if (this.isStoreFile && this.isStoreFile(f.path)) return { done: 0, all: 0 };
		const key = 'tasks:' + f.path;
		const hit = this.wordCountCache && this.wordCountCache.get(key);
		if (hit && f.stat && hit.mtime === f.stat.mtime) return hit.tasks;
		const t = this.countTasks(await this.app.vault.cachedRead(f));
		if (this.wordCountCache && f.stat) {
			this.wordCountCache.set(key, { mtime: f.stat.mtime, tasks: t });
		}
		return t;
	},

	// A folder's tasks: every note under it, at any depth.
	async treeTasksUnder(this: WordSmith, folder: TAbstractFile) {
		let done = 0, all = 0;
		const walk = async (dir: TAbstractFile) => {
			for (const c of (dir && dir.children) || []) {
				if (!c) continue;
				if (wsIsFolder(c)) { await walk(c); continue; }
				if (!wsIsFile(c) || !/\.md$/i.test(String(c.path || ''))) continue;
				let t = null;
				try { t = await this.treeTasksOf(c); } catch { continue; }
				if (t) { done += t.done || 0; all += t.all || 0; }
			}
		};
		await walk(folder);
		return { done, all };
	},

	// THE TREE'S INDEX: the Organizer's, started here if no window has
	// started it, and its bell wired ONCE to the painter — the sweep that
	// fills it rings when it is done, and every note the vault re-reads rings
	// after the index has the new number, which is the moment a badge can
	// change. Answers whatever the index holds NOW: on the first paint of a
	// big vault that is a partial index and a partial tree, filled in by the
	// bell rather than held back by the sweep.
	treeCountIndex(this: WordSmith) {
		void this.orgIndexEnsure();
		if (!this._treeIndexBell) this._treeIndexBell = this.orgIndexOnChange(() => this.scheduleExplorerPatch());
		return this._orgIndex;
	},

	patchExplorerSortMenu(this: WordSmith, view: View) {
		if (view._wsMenuPatched) return;
		if (typeof view.onHeaderMenu !== 'function') {
			this.capMissing('sortMenu');
			return;
		}
		view._wsMenuPatched = true;

		const origMenu = view.onHeaderMenu;
		view._wsMenuOrig = origMenu;
		view.onHeaderMenu = (menu: Menu) => {
			origMenu.call(view, menu);
			try {
				menu.addSeparator();
				menu.addItem((i) => i
					.setTitle('Custom sort')
					.setChecked(!!this.settings.treeOrder)
					.onClick(async () => {
						this.settings.treeOrder = !this.settings.treeOrder;
						await this.saveSettings();
						this.patchExplorerSort();
					}));
			} catch (_) { wsCatch('patchExplorerSortMenu: menu.addSeparator();', _); }
		};

		// …AND THE OTHER WAY ROUND. Picking "File name (Z to A)" while ours is
		// on has to mean ours is off, or the writer has chosen an order and
		// been given a different one — which is the dead control again with
		// an extra step. Wrapped rather than listened for: there is no event,
		// and this is the one function every entry in that menu calls.
		if (typeof view.setSortOrder === 'function') {
			const origSort = view.setSortOrder;
			view._wsSortOrderOrig = origSort;
			view.setSortOrder = (order: string) => {
				if (this.settings.treeOrder) {
					this.settings.treeOrder = false;
					// Not awaited: Obsidian is mid-click and the sort has to
					// happen now. The write lands a tick later and the
					// unpatch below does not wait for it.
					void this.saveSettings();
					this.unpatchExplorerSort();
				}
				return origSort.call(view, order);
			};
		}
	},

	// THE MENU ROW, ADDED TO THE MENU THAT ACTUALLY OPENS.
	//
	// `onHeaderMenu` was a guess at an internal and it was wrong: on a real
	// vault the mark appeared on the button and the row never did, because
	// that build builds its sort menu somewhere else. One console warning and
	// a feature that could not be reached.
	//
	// So this stops guessing. Obsidian opens its own menu, exactly as it
	// always did, and the row is appended to the element once it is on
	// screen. Nothing is intercepted, nothing is replaced, their six entries
	// keep their own labels in their own language — and if no menu appears,
	// nothing is added and nothing is broken.
	//
	// FOUND BY WAITING A FEW FRAMES, not by a fixed timeout: a menu is
	// rendered in the same tick on a fast machine and a frame or two later on
	// a slow one, and a 50ms guess is wrong on both.
	attachSortMenuRow(this: WordSmith) {
		if (this._wsSortRowBound) return;
		this._wsSortRowBound = true;
		this.registerDomEvent(document, 'click', (ev: MouseEvent) => {
			if (!this.settings || !this.settings.pluginEnabled) return;
			const t = wsElOf(ev.target);
			if (!t) return;
			const btn = t.closest('.workspace-leaf-content[data-type="file-explorer"] '
				+ '.nav-buttons-container .clickable-icon');
			if (!btn) return;
			const said = (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '');
			// Ours carries the mark and its own label; theirs says sort.
			if (!/sort/i.test(said) && btn.getAttribute('data-ws-sort') !== '1') return;
			let tries = 0;
			const look = () => {
				const menus = document.querySelectorAll('body > .menu');
				const menu = menus.length ? menus[menus.length - 1] : null;
				if (menu && !menu.querySelector('.ws-menu-msorder')) {
					this.addSortMenuRow(menu);
					return;
				}
				if (++tries < 8) window.requestAnimationFrame(look);
			};
			window.requestAnimationFrame(look);
		}, true);
	},

	addSortMenuRow(this: WordSmith, menu: HTMLElement) {
		try {
			// NOT TWICE. `patchExplorerSortMenu` adds the same entry through
			// `onHeaderMenu` on builds that HAVE that method, and this adds it
			// to the element. The guard in `attachSortMenuRow` looks for our
			// own class, which their Menu item does not wear — so on a build
			// carrying both, a writer got two "Custom sort" rows. Ask
			// what the menu SAYS, not what it is made of.
			const scroll0 = menu.querySelector('.menu-scroll') || menu;
			const already = Array.from(scroll0.querySelectorAll('.menu-item-title'))
				.some(t => (t.textContent || '').trim() === 'Custom sort');
			if (already) return;
			// BUILT THE WAY THEIRS ARE BUILT, from their own markup rather
			// than from a guess. Every row in that menu is
			//
			//   .menu-scroll > .menu-group > .menu-item.tappable
			//     > .menu-item-icon        (the leading glyph)
			//     > .menu-item-title
			//     > .menu-item-icon.mod-checked   (the tick, when set)
			//
			// and the item that is SET carries `mod-checked` on itself. Ours
			// was a direct child of `.menu-scroll` — outside every group —
			// wearing `is-selected`, a class of our own invention. It drew,
			// and it drew as something stuck to the bottom of somebody else's
			// menu.
			const scroll = menu.querySelector('.menu-scroll') || menu;
			scroll.createDiv({ cls: 'menu-separator' });
			const group = scroll.createDiv({ cls: 'menu-group' });
			const on = !!this.settings.treeOrder;
			const item = group.createDiv({
				cls: 'menu-item tappable ws-menu-msorder' + (on ? ' mod-checked' : '') });
			const icon = item.createDiv({ cls: 'menu-item-icon' });
			// The same written mark the sort button wears, so the row and the
			// state it turns on are one thing rather than two to connect.
			wsSvgInto(icon, wsManuscriptSvg(16));
			item.createDiv({ cls: 'menu-item-title', text: 'Custom sort' });
			if (on) {
				const tick = item.createDiv({ cls: 'menu-item-icon mod-checked' });
				try { if (setIcon) setIcon(tick, 'check'); } catch { tick.setText('\u2713'); }
				// ── ONE TICK IN A MENU THAT ASKS ONE QUESTION ───────────
				//
				// Reported from a vault: with Custom sort on, "File
				// name (A to Z)" stayed ticked beside it. Both rows
				// answered "what order is this tree in?" and the menu gave
				// two answers, one of which was not true — the alphabetical
				// sort is exactly what ours has taken over.
				//
				// Their rows are not ours to rebuild, so nothing here adds
				// or removes an entry: the MARK comes off, which is the
				// only part that was lying. `mod-checked` sits on the row
				// AND on the tick element inside it, so both go, or the row
				// keeps its glyph and loses only its highlight.
				//
				// Done to their rows rather than by refusing to draw ours,
				// because the menu is rebuilt from scratch every time it
				// opens — there is nothing here to put back.
				for (const other of Array.from(scroll.querySelectorAll('.menu-item.mod-checked'))) {
					if (other === item) continue;
					try {
						other.removeClass('mod-checked');
						for (const t of Array.from(other.querySelectorAll('.menu-item-icon.mod-checked'))) {
							t.detach ? t.detach() : t.remove();
						}
					} catch (_) { wsCatch('addSortMenuRow: other.removeClass(\'mod-checked\');', _); }
				}
			}
			// THE HIGHLIGHT IS THEIRS AND IT IS NOT CSS. Obsidian marks the
			// row under the pointer by putting `selected` on it — its own
			// keyboard cursor and its hover are the same state — and that is
			// done by the menu's own handlers, which know nothing about a row
			// this plugin appended. So the row does it for itself, and clears
			// its neighbours the way the menu would.
			item.addEventListener('mouseenter', () => {
				try {
					for (const el of Array.from(scroll.querySelectorAll('.menu-item.selected'))) {
						el.removeClass('selected');
					}
				} catch (_) { wsCatch('addSortMenuRow: for (const el of Array.from(scroll.querySelectorAll(\'.menu-item.select …', _); }
				item.addClass('selected');
			});
			item.addEventListener('mouseleave', () => item.removeClass('selected'));
			item.addEventListener('click', (ev: Event) => { void (async () => {
					ev.preventDefault();
					ev.stopPropagation();
					this.settings.treeOrder = !this.settings.treeOrder;
					await this.saveSettings();
					this.patchExplorerSort();
					try { menu.hide(); } catch (_) { wsCatch('addSortMenuRow: menu.hide();', _); }
				})();
});
		} catch (_) { wsCatch('addSortMenuRow: const scroll0 = (menu.querySelector && …', _); }
	},

	unpatchExplorerSortMenu(this: WordSmith, view: View) {
		if (!view._wsMenuPatched) return;
		try { if (view._wsMenuOrig) view.onHeaderMenu = view._wsMenuOrig; } catch (_) { wsCatch('unpatchExplorerSortMenu: if (view._wsMenuOrig) view.onHeaderMenu = view._wsMenuOrig;', _); }
		try { if (view._wsSortOrderOrig) view.setSortOrder = view._wsSortOrderOrig; } catch (_) { wsCatch('unpatchExplorerSortMenu: if (view._wsSortOrderOrig) view.setSortOrder = view._wsSortOrderOrig;', _); }
		view._wsMenuPatched = false;
		view._wsMenuOrig = null;
		view._wsSortOrderOrig = null;
	},

	patchExplorerSort(this: WordSmith) {
		// THE MENU ENTRY GOES ON WHATEVER THE SWITCH SAYS, and before the
		// early return below. It is not a consequence of the feature being
		// on — it is how the feature is turned on, and an entry that only
		// appears once you have found the settings tab is an entry nobody
		// needs.
		if (this.settings && this.settings.pluginEnabled) {
			for (const view of this.explorerViews()) {
				try { this.patchExplorerSortMenu(view); } catch (_) { wsCatch('patchExplorerSort: this.patchExplorerSortMenu(view);', _); }
			}
		}
		// The mark goes on and comes off with the switch, which is not a
		// change to the tree and so does not reach the observer's pass.
		try { this.paintExplorerSortIcon(); } catch (_) { wsCatch('patchExplorerSort: this.paintExplorerSortIcon();', _); }
		try { this.attachSortMenuRow(); } catch (_) { wsCatch('patchExplorerSort: this.attachSortMenuRow();', _); }
		if (!this.explorerSortWanted()) { this.unpatchExplorerSort(); return; }
		// SWITCHED ON MID-SESSION. A writer who has never opened the export
		// window has no parsed store, so every folder would report no order
		// and the tree would not move — a switch that appears to do nothing.
		// The read is fired once and the tree asked to sort again when it
		// lands; the sort itself stays synchronous, because it runs inside
		// Obsidian's render and cannot wait for a file.
		// The drag binds once and gates itself, so this is safe to call from
		// every layout change. Guarded, and not out of habit: the SORT is the
		// feature, the drag is how you set it, and a drag binding that threw
		// would take the sort down with it and leave a writer with a switch
		// that does nothing at all rather than one they cannot drag into.
		try { this.attachTreeDrag(); } catch (_) { wsCatch('patchExplorerSort: this.attachTreeDrag();', _); }
		if (!this._structStore && !this._treeOrderLoading) {
			this._treeOrderLoading = true;
			this.treeOrderLoad().then(() => {
				this._treeOrderLoading = false;
				this.repaintExplorerOrder();
			}).catch(() => { this._treeOrderLoading = false; });
		}
		for (const view of this.explorerViews()) {
			if (view._wsSortPatched) continue;
			if (typeof view.getSortedFolderItems !== 'function') {
				// Said once, and only to the console: a Notice on every
				// layout change would be a nag about something the writer
				// cannot fix.
				this.capMissing('explorerSort');
				continue;
			}
			// Whether the method was the VIEW's or its prototype's decides how
			// it is put back: assigning the prototype's function as an own
			// property would leave a copy shadowing the real one for ever,
			// and a later Obsidian update would then be patching a method
			// this plugin had frozen.
			view._wsSortOwn = Object.prototype.hasOwnProperty.call(view, 'getSortedFolderItems');
			view._wsSortOrig = view.getSortedFolderItems;
			const orig = view._wsSortOrig;
			view.getSortedFolderItems = (folder: TFolder) => {
				let items: WsExplorerItem[] = [];
				items = orig.call(view, folder);
				try { return this.sortFolderItems(folder, items); } catch { return items; }
			};
			view._wsSortPatched = true;
		}
		this.repaintExplorerOrder();
	},

	unpatchExplorerSort(this: WordSmith) {
		for (const view of this.explorerViews()) {
			if (!view._wsSortPatched) continue;
			try {
				if (view._wsSortOwn && view._wsSortOrig) view.getSortedFolderItems = view._wsSortOrig;
				else delete view.getSortedFolderItems;
			} catch (_) { wsCatch('unpatchExplorerSort: if (view._wsSortOwn) view.getSortedFolderItems = view._wsSortOrig;', _); }
			view._wsSortPatched = false;
			view._wsSortOrig = null;
		}
		this.repaintExplorerOrder();
	},

	// Ask the explorer to sort again.
	//
	// THREE WAYS, TRIED IN ORDER, because there is no public one. `requestSort`
	// is the view's own and is what should happen; if a build does not have it
	// the tree goes on drawing the order it drew before, and the only way to
	// see a dragged row move is to fold the folder and open it again — which
	// is exactly what was reported from a vault ("not refreshing fast enough —
	// I must open a folder to work").
	//
	// So the fallbacks: the tree's virtual scroller can be told to recompute,
	// and failing that the view can be asked to rebuild the folder outright.
	// Each is guarded on its own, and none of them throwing matters — the
	// worst case is the tree redrawing on the next thing that touches it,
	// which is where this started.
	repaintExplorerOrder(this: WordSmith) {
		for (const view of this.explorerViews()) {
			let done = false;
			try {
				if (typeof view.requestSort === 'function') { view.requestSort(); done = true; }
			} catch (_) { wsCatch('repaintExplorerOrder: if (typeof view.requestSort === \'function\') view.requestSort();', _); }
			if (!done) {
				try {
					const scroll = view.tree && view.tree.infinityScroll;
					if (scroll && typeof scroll.compute === 'function') { scroll.compute(); done = true; }
				} catch (_) { wsCatch('repaintExplorerOrder: const scroll = view.tree && view.tree.infinityScroll;', _); }
			}
			if (!done) {
				// The last resort: the root folder's own children are rebuilt.
				// Coarser than a sort and visible as a flicker on a big vault,
				// which is why it is third rather than first.
				try {
					const root = view.fileItems && view.fileItems['/'];
					if (root && typeof root.updateChildren === 'function') {
						root.updateChildren();
						done = true;
					}
				} catch (_) { wsCatch('repaintExplorerOrder: const root = view.fileItems && view.fileItems[\'/\'];', _); }
			}
			if (!done) this.capMissing('explorerResort');
		}
	},

	// The rule, and it is deliberately small.
	//
	// WHAT IS ORDERED COMES FIRST, in the order it was stored. EVERYTHING ELSE
	// KEEPS OBSIDIAN'S OWN ORDER, after it. That second half is why this is
	// not a comparator: by deferring to the list Obsidian handed us rather
	// than sorting the leftovers ourselves, a new note lands alphabetically
	// among the other new notes, folders still group first among them, and a
	// writer who has changed the explorer's sort setting keeps it — none of
	// which this function has to know anything about.
	//
	// Folders are ordered exactly as notes are: a writer who wants Part Two
	// above a stray note in the same folder can say so, and the shape of a
	// manuscript is folders and files together.
	sortFolderItems(this: WordSmith, folder: TFolder, items: unknown): WsExplorerItem[] {
		const list: WsExplorerItem[] = Array.isArray(items) ? (items as WsExplorerItem[]) : [];
		if (!list.length) return list;
		const path = (folder && folder.path && folder.path !== '/') ? folder.path : '';
		const order = this.treeOrderFor(path);
		if (!order.length) return list;
		const at = new Map<string, number>();
		for (let i = 0; i < order.length; i++) if (!at.has(order[i])) at.set(order[i], i);
		const ranked: WsExplorerItem[] = [], rest: WsExplorerItem[] = [];
		for (const it of list) {
			const p = it && it.file && it.file.path;
			if (p && at.has(p)) ranked.push(it); else rest.push(it);
		}
		// A stable sort by stored position. The leftovers are NOT sorted at
		// all — they are already in the order Obsidian chose.
		const rank = (it: WsExplorerItem) => at.get(it.file ? it.file.path : '') || 0;
		ranked.sort((a, b) => rank(a) - rank(b));
		return ranked.concat(rest);
	},

	attachTreeDrag(this: WordSmith) {
		if (this._wsTreeDragBound) return;
		this._wsTreeDragBound = true;
		const inExplorer = (el: HTMLElement) => !!(el && el.closest
			&& el.closest('.workspace-leaf-content[data-type="file-explorer"]'));
		const rowUnder = (ev: Event) => {
			const t = ev.target as HTMLElement | null;
			if (!t || !t.closest || !inExplorer(t)) return null;
			return t.closest('.nav-file-title, .nav-folder-title');
		};

		// WHICH FOLDERS WERE SHUT WHEN THE DRAG BEGAN.
		//
		// Obsidian opens a folder you hover over mid-drag, which is right —
		// it is how you drop something INTO a folder three levels down. What
		// is wrong is that they all stay open afterwards, so a drag across a
		// tree leaves it unfolded and the writer has to shut six folders they
		// never asked to see.
		//
		// FOUGHT BY PUTTING THEM BACK, not by stopping the expand: the expand
		// is a real feature and cancelling it would break dropping into a
		// shut folder. What was open before the drag stays open; what the
		// writer actually dropped into stays open too, because that is where
		// they just sent something and it would be perverse to hide it.

		this.registerDomEvent(document, 'dragstart', (ev: DragEvent) => {
			// The dragged path is taken from the ROW, not from `dataTransfer`:
			// what Obsidian puts in there is its own business and has changed
			// between releases, and the row is in front of us.
			this._wsDragPath = null;
			if (!this.explorerSortWanted()) return;
			const row = rowUnder(ev);
			this._wsDragPath = (row && row.dataset && row.dataset.path) || null;
		}, true);

		this.registerDomEvent(document, 'dragover', (ev: DragEvent) => {
			// ── THE SPRING-OPEN IS STOPPED BEFORE IT STARTS ─────────────
			//
			// Unconditionally, and BEFORE the aim is worked out: a folder
			// springs open from being hovered, which happens in the middle
			// band where `treeDropAim` answers null and everything below
			// this line returns early. Doing it only for drops we claim is
			// doing it only where it never happened.
			this.treeStopSpringLoad();
			const aim = this.treeDropAim(ev, rowUnder(ev));
			this.paintTreeDrop(aim);
			if (!aim) return;
			// Taken from Obsidian only when it is ours. `stopPropagation` in
			// the CAPTURE phase keeps the event from reaching the row's own
			// handler, so the "drop into this folder" highlight does not draw
			// under an insertion line that means something else.
			ev.preventDefault();
			ev.stopPropagation();
			try { if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; } catch (_) { wsCatch('attachTreeDrag: ev.dataTransfer.dropEffect = \'move\';', _); }
		}, true);

		this.registerDomEvent(document, 'drop', (ev: Event) => {
			const aim = this.treeDropAim(ev as DragEvent, rowUnder(ev));
			this.paintTreeDrop(null);
			if (!aim) return;
			ev.preventDefault();
			ev.stopPropagation();
			this._wsDragPath = null;
			// The folds are left as the drag left them: a folder that springs
			// open during a drag is what this app does everywhere, and a plugin
			// that re-collapsed it a fifth of a second later was more visible
			// than the thing it repaired.
			void this.treeOrderMove(aim.parent, aim.moved, aim.before);
		}, true);

		// Both, because a drag that leaves the window fires one and a drag
		// that is cancelled fires the other, and a line left painted across a
		// row outlives the gesture that drew it.
		// AFTER THE DUST SETTLES, not on the event. `dragend` fires — the
		// console log from a real vault says so — and collapsing there did
		// nothing, because Obsidian is still finishing the drop: it re-renders
		// the tree and re-expands what it expanded, after us. So the restore
		// waits a beat, and does it twice: once when the drag ends and once a
		// few frames later, for the render that lands in between.
		//
		// The snapshot is NOT cleared by the first pass, or the second would
		// have nothing to put back.
		this.registerDomEvent(document, 'dragend', () => {
			this._wsDragPath = null;
			this.paintTreeDrop(null);
		}, true);
		this.registerDomEvent(document, 'dragleave', (ev: Event) => {
			if (ev.target === document || !rowUnder(ev)) this.paintTreeDrop(null);
		}, true);
	},

	// The insertion line. One row wears it at a time, and the class says which
	// edge, so the line is drawn by the stylesheet rather than by a floating
	// element this would then have to position and remove.
	paintTreeDrop(this: WordSmith, aim: { parent?: string; row: HTMLElement; above: boolean; before?: string | null } | null) {
		const was = this._wsDropRow;
		if (was && was !== (aim && aim.row)) {
			try { was.removeClass('ws-drop-above'); was.removeClass('ws-drop-below'); } catch (_) { wsCatch('paintTreeDrop: was.removeClass(\'ws-drop-above\');', _); }
			this._wsDropRow = null;
		}
		if (!aim || !aim.row) return;
		this._wsDropRow = aim.row;
		try {
			aim.row.toggleClass('ws-drop-above', !!aim.above);
			aim.row.toggleClass('ws-drop-below', !aim.above);
		} catch (_) { wsCatch('paintTreeDrop: aim.row.toggleClass(\'ws-drop-above\', !!aim.above);', _); }
	},

	// ════════════════════════════════════════════════════════════════════════
	// SIDEBAR WORD COUNTS
	// ════════════════════════════════════════════════════════════════════════

	attachExplorerObserver(this: WordSmith) {
		// Observe only the file-explorer and outline leaf containers — the
		// old body-wide observer scheduled a full explorer re-scan on any DOM
		// change anywhere (typing repaints, tooltips, …). Re-bound from the
		// layout-change handler since these leaves can be recreated.
		this.detachExplorerObserver();
		this.scheduleExplorerPatch();
		// ── AND IT STOPS HEARING ITSELF ──────────────────────────────
		//
		// This watches the subtree that `patchExplorerDOM` WRITES INTO — badges,
		// flags, folder glyphs — and would wake on its own writes: an observer
		// must not write what it watches. A settled pass moves nothing; this is
		// the FIRST pass after a real change, which necessarily draws and would
		// necessarily wake this.
		const observer = new MutationObserver((recs) => {
			if (!this.explorerRecordsMatter(recs)) return;
			this.scheduleExplorerPatch();
		});
		const targets = document.querySelectorAll(
			'.workspace-leaf-content[data-type="file-explorer"], .workspace-leaf-content[data-type="outline"]');
		this.explorerObserver = observer;
		targets.forEach(t => observer.observe(t, { childList: true, subtree: true }));
	},

	detachExplorerObserver(this: WordSmith) {
		if (this.explorerObserver) { this.explorerObserver.disconnect(); this.explorerObserver = null; }
	},

	// ONE ROW, when only one row changed.
	//
	// Flagging a note from the bar redrew every tile in the tree: on a
	// four-hundred-note vault that is four hundred reads of the flag maps and
	// a full pass of the folder sums, to change eleven pixels on one line.
	// The tile is found by its path — the explorer keeps it in `data-path` —
	// and nothing else is touched.
	repaintExplorerFlag(this: WordSmith, path: string) {
		if (!path || !this.settings.fileTreeFlags) return;
		try {
			const sel = '.nav-file-title[data-path="' + String(path).replace(/"/g, '\\"') + '"]';
			for (const el of Array.from(document.querySelectorAll(sel))) {
				this.setFlagBadge(el, path, false);
			}
		} catch (_) { wsCatch('repaintExplorerFlag: const sel = \'.nav-file-title[data-path="\' + String(path).replace(/"/g, …', _); }
	},

	// ── ONE PASS AT A TIME ───────────────────────────────────────
	//
	// The pass is `async` — it awaits a `cachedRead` per note — so a latch
	// cleared BEFORE the pass runs lets a mutation arriving during those
	// awaits start a SECOND pass while the first is still writing, and on a
	// big tree the passes multiply rather than queue. CLEARED WHEN THE PASS
	// FINISHES, and if anything arrived while it ran, exactly ONE more is
	// scheduled — not one per mutation.
	scheduleExplorerPatch(this: WordSmith) {
		if (this._patchRunning) { this._patchAgain = true; return; }
		if (this._patchScheduled) return;
		this._patchScheduled = true;
		// ── A TIMER, NOT A FRAME ─────────────────────────
		//
		// AN OCCLUDED ELECTRON WINDOW THROTTLES rAF TO NOTHING, and a 500 ms
		// timer can wait seconds there too — a 0 ms one fires. This painter
		// draws counts into the file tree, which a writer expects to be right
		// the moment they look back at the window. THE COALESCING IS UNCHANGED:
		// `_patchScheduled` is the latch, and a storm is still caught by
		// `wsPassStorm` inside.
		wsSoon(() => {
			this._patchScheduled = false;
			// ── A STORM STOPS THE PAINTER, NOT THE APP ────────────
			//
			// The same trade `is-narrow` makes: a freeze becomes a missing
			// decoration and a sentence a writer can quote back. A frozen Obsidian
			// cannot have its console opened, so the console is not where this can
			// be said.
			if (!this._passState) this._passState = wsPassState();
			if (wsPassStorm(this._passState, Date.now())) {
				this._passState = wsPassState();
				try { this.detachExplorerObserver(); } catch (_) { wsCatch('scheduleExplorerPatch: this.detachExplorerObserver();', _); }
				try {
					new Notice('Word-Smith: the file tree kept asking to be '
						+ 'redrawn, so its counts and marks are paused. Reopen the '
						+ 'pane to try again, or switch them off in Settings \u2192 '
						+ 'File tree.', 15000);
				} catch (_) { wsCatch('scheduleExplorerPatch: new Notice(\'Word-Smith: the file tree kept asking to be \'', _); }
				try {
					console.error('Word-Smith: the file-tree painter ran more than '
						+ WS_STORM_PASSES + ' times in ' + (WS_STORM_MS / 1000)
						+ 's and has been stopped.');
				} catch (_) { wsCatch('scheduleExplorerPatch: console.error(\'Word-Smith: the file-tree painter ran more than \'', _); }
				return;
			}
			this._patchRunning = true;
			void Promise.resolve()
				.then(() => this.patchExplorerDOM())
				.catch(() => {})
				.then(() => {
					this._patchRunning = false;
					// WHAT THE PASS ITSELF PRODUCED IS NOT NEWS. Flushing the
					// queue here drops the records our own writes just made,
					// so they cannot schedule the next pass even if the filter
					// above ever misses one.
					try {
						if (this.explorerObserver) this.explorerObserver.takeRecords();
					} catch (_) { wsCatch('scheduleExplorerPatch: if (this.explorerObserver) this.explorerObserver.takeRecords();', _); }
					if (this._patchAgain) {
						this._patchAgain = false;
						this.scheduleExplorerPatch();
					}
				});
		});
	},

	async patchExplorerDOM(this: WordSmith) {
		// Covers scheduleExplorerPatch() calls from active-leaf-change, vault
		// modify, and the mutation observer while the plugin is toggled off.
		if (!this.settings.pluginEnabled) return;
		// THE FLAG IS ITS OWN QUESTION. A writer may want the flags and not
		// the counts — the counts are a number on every row, the flags are a
		// mark on the few they have flagged — so the two switches are
		// independent and this pass runs when EITHER is on.
		this.paintExplorerSortIcon();
		this.paintExplorerFolderColours();
		// ONE PASS DRAWS THE FOLDER GLYPHS, and it decides for itself which
		// rows get one: every folder when the switch is on, and a manuscript
		// folder either way. The roots pass used to draw its own mark and this
		// line then stripped every glyph when the switch was off — including
		// the book it had just drawn.
		this.paintExplorerRoots();
		// AND THE TASKS ARE A THIRD: with the counts and the flags both off,
		// this pass must still run for "Tasks left".
		if (this.settings.enableFileTreeCounts || this.settings.fileTreeFlags || this.settings.fileTreeTasks) {
			// THE COUNTS COME FROM THE INDEX. A tree pass that reads every note on
			// screen and sums a folder from the badges under it is wrong twice:
			// Obsidian keeps a shut folder's rows out of the DOM, so a shut folder
			// has no count until first opened and a parent counts only what is
			// unfolded beneath it. The Organizer's index holds every counted note,
			// vault-wide, whatever is folded: a note's badge is its entry, a
			// folder's the sum over its descendants, and this pass reads no file at
			// all.
			const ix = this.settings.enableFileTreeCounts ? this.treeCountIndex() : null;
			const sums = ix ? wsOrgFolderWords(ix) : null;
			const roots = document.querySelectorAll('.workspace-leaf-content[data-type="file-explorer"]');
			for (let ri = 0; ri < roots.length; ri++) {
				const root  = roots[ri];
				const tiles = root.querySelectorAll('.nav-file-title');
				for (let i = 0; i < tiles.length; i++) {
					const path = tiles[i].dataset && tiles[i].dataset.path;
					if (!path) continue;
					this.setFlagBadge(tiles[i], path, false);
					if (ix && path.endsWith('.md')) this.applyFileWordCount(tiles[i], path, ix);
				}
				await this.paintExplorerTasks(root);
				for (const fEl of Array.from(root.querySelectorAll('.nav-folder-title'))) {
					const fp = fEl.dataset && fEl.dataset.path;
					if (fp) this.setFlagBadge(fEl, fp, true);
				}
				if (sums) this.applyFolderSums(root, sums);
				else {
					root.querySelectorAll('.ws-count').forEach(el => el.remove());
				}
			}
		} else {
			document.querySelectorAll('.nav-file-title .ws-count, .nav-folder-title .ws-count').forEach(el => el.remove());
		}
		if (!this.settings.fileTreeFlags) {
			document.querySelectorAll('.ws-treeflag').forEach(el => el.remove());
		}
		// The pass above is skipped with every switch off, so the badges it
		// would have taken down are taken down here.
		if (!this.settings.fileTreeTasks) {
			document.querySelectorAll('.ws-tasks').forEach(el => el.remove());
		}
		if (this.settings.enableOutlineCounts) {
			const oroots = document.querySelectorAll('.workspace-leaf-content[data-type="outline"]');
			await Promise.all(Array.from(oroots, r => this.applyOutlineWordCounts(r)));
		} else {
			// ── THE OUTLINE CLEARS THE OUTLINE, AND NOTHING ELSE ─────────────
			//
			// This was `.tree-item-self .ws-count`, document-wide, and it took
			// the FILE TREE's counts with it: the explorer's rows are
			// `tree-item-self` too (`tree-item-self nav-file-title tappable
			// is-clickable`, measured in the vault). Every badge the block above
			// had just drawn was deleted at the end of the same pass, so “File
			// tree counts” was ON and drew nothing, and the switch that really
			// turned it off was OUTLINE counts — a different switch, on a
			// different pane. Reported as “the toggles in the filetree tab do
			// not work”.
			//
			// Scoped to the outline leaf, which is the same container the ON
			// branch above walks — the two halves of one switch now name the
			// same rows. The tree's own counts are cleared by the `else` inside
			// the block above, which names `.nav-file-title` / `.nav-folder-title`
			// and always did.
			document.querySelectorAll(
				'.workspace-leaf-content[data-type="outline"] .ws-count'
			).forEach(el => el.remove());
		}
	},

	// THE SORT BUTTON SAYS WHAT IT IS SET TO.
	//
	// The alternative was hiding it, which would be subtracting one of
	// Obsidian's own controls from a pane this plugin does not own — and
	// stranding anyone who wanted their alphabetical tree back, since that
	// button is now where manuscript order is turned off. A marked button
	// takes nothing away and answers the same question.
	//
	// FOUND BY WHAT IT SAYS, not by where it sits. The header's buttons have
	// no stable order or class of their own, but the sort one carries an
	// aria-label; a build that labels it in another language simply does not
	// match, and then nothing is marked and nothing is broken.
	paintExplorerSortIcon(this: WordSmith) {
		const on = !!(this.settings && this.settings.treeOrder);
		const hosts = document.querySelectorAll(
			'.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');
		for (const host of Array.from(hosts)) {
			let btn = null;
			for (const b of Array.from(host.children)) {
				const said = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
				if (/sort/i.test(said)) { btn = b; break; }
			}
			if (!btn) continue;
			if (on) {
				// Stashed ONCE. Stashing on every pass would eventually stash
				// our own icon and the button could never be put back.
				if (btn.getAttribute('data-ws-sort') !== '1') {
					btn.setAttribute('data-ws-was', btn.innerHTML);
					btn.setAttribute('data-ws-said', btn.getAttribute('aria-label') || '');
					btn.setAttribute('data-ws-sort', '1');
					wsSvgInto(btn, wsManuscriptSvg(18));
					btn.setAttribute('aria-label', 'Sorted in custom order');
				}
			} else if (btn.getAttribute('data-ws-sort') === '1') {
				wsSvgInto(btn, btn.getAttribute('data-ws-was') || '');
				const said = btn.getAttribute('data-ws-said');
				if (said) btn.setAttribute('aria-label', said);
				btn.removeAttribute('data-ws-was');
				btn.removeAttribute('data-ws-said');
				btn.removeAttribute('data-ws-sort');
			}
		}
	},

	// A MANUSCRIPT FOLDER, MARKED IN THE TREE.
	//
	// The setting is invisible otherwise: a writer sets a root, the window
	// quietly changes what it is about, and nothing in the tree says which
	// folder did that. The book goes at the END of the row rather than beside
	// the name, so it cannot be mistaken for the folder's own icon and does
	// not push the names of two hundred other folders sideways.
	paintExplorerRoots(this: WordSmith) {
		this.paintExplorerFolderIcons();
		// AND THE FILE KINDS, the same glyph the Manuscript window draws.
		// After the folders because they are the same pass and the folder
		// rows are the ones a theme is fussiest about.
		this.paintExplorerKindIcons();
	},

	async paintExplorerTasks(this: WordSmith, root: HTMLElement) {
		if (!this.settings.fileTreeTasks) {
			for (const el of Array.from(document.querySelectorAll('.ws-tasks'))) el.remove();
			return;
		}
		// FOLDERS TOO: the setting says "Folders sum their children". Summed
		// from the VAULT, not from the rows beneath: a collapsed folder has no
		// rows beneath it (Obsidian does not render them), which is how a sum
		// taken from the DOM shows nothing on a closed folder.
		const rows = root.querySelectorAll('.nav-file-title, .nav-folder-title');
		for (const row of Array.from(rows)) {
			const path = (row.dataset && row.dataset.path) || '';
			const isFolder = row.classList.contains('nav-folder-title');
			if (!path || (!isFolder && !path.endsWith('.md'))) continue;
			let t = null;
			try {
				const f = this.app.vault.getAbstractFileByPath(path);
				if (!f) continue;
				t = (!isFolder && wsIsFile(f)) ? await this.treeTasksOf(f) : await this.treeTasksUnder(f);
			} catch { continue; }
			const box = this.treeMarksBox(row);
			let badge = row.querySelector('.ws-tasks');
			// A NOTE WITH NO TASKS SHOWS NOTHING. A `0/0` on every scene in a
			// manuscript is a column of noughts saying "this note is not that
			// kind of note", four hundred times.
			if (!t || !t.all) { if (badge) badge.remove(); continue; }
			if (!badge) {
				badge = createSpan();
				badge.className = 'ws-tasks';
				(box || row).appendChild(badge);
			}
			// Through `wsTaskSay`, the one writer of this notation — the
			// reasoning lives beside it. This was the FOURTH copy, found by
			// counting after the first three were merged.
			const said = wsTaskSay(t.done, t.all);
			if (badge.textContent !== said) {
				badge.textContent = said;
				badge.title = (t.all - t.done) + ' left of ' + t.all;
			}
			badge.toggleClass('is-done', t.done === t.all);
		}
	},

	// A FOLDER GLYPH IN OBSIDIAN'S OWN TREE.
	//
	// The same `wsFolderSvg` the Manuscript window and the export list draw,
	// so a folder is one shape in all three places rather than three that
	// resemble each other.
	//
	// BEFORE THE NAME, INSIDE THE TITLE ROW, and after Obsidian's own
	// collapse chevron — which is a child of that row too, so the glyph is
	// inserted before the `.nav-folder-title-content` rather than at the
	// front of the row. Putting it first pushed the chevron out of the
	// indent guides and every folder line sat a few pixels off its children.
	//
	// OPEN OR SHUT WITH THE FOLDER. Obsidian marks a collapsed folder on the
	// row's parent (`.is-collapsed`), so the state is read from there and the
	// glyph is redrawn only when it has actually changed — this pass runs on
	// every explorer mutation, and rewriting forty SVGs on each one is how a
	// tree starts to feel slow.
	// A FOLDER'S COLOUR, on the row rather than on the glyph.
	//
	// The glyph, the name and the chevron all take it, because a colour that
	// only reached a twelve-pixel icon is a colour nobody can see down a tree
	// — which is the whole reason to have one. Set as a custom property so
	// the stylesheet decides WHICH parts of the row use it, and a theme can
	// take it further without this pass knowing.
	paintExplorerFolderColours(this: WordSmith) {
		const map = (this.settings && this.settings.folderColors) || {};
		const rows = document.querySelectorAll(
			'.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title');
		for (const row of Array.from(rows)) {
			const path = (row.dataset && row.dataset.path) || '';
			const id = map[path === '/' ? '' : path] || '';
			const def = WS_FOLDER_COLOURS.filter(c => c.id === id)[0];
			const want = (def && def.css) || '';
			if ((row.getAttribute('data-ws-colour') || '') === id) continue;
			row.setAttribute('data-ws-colour', id);
			if (want) row.style.setProperty('--ws-folder-colour', want);
			else row.style.removeProperty('--ws-folder-colour');
			row.toggleClass('ws-has-colour', !!want);
		}
	},

	// ── A FILE’S KIND, IN OBSIDIAN’S OWN TREE ───────────────────
	//
	// THE SAME GLYPH, NOT A SECOND DRAWING OF IT: `orgKindIcon` is a class
	// method so the tree, the table and this pane call one writer; copying
	// the kind rules here would be the second writer this plugin keeps
	// deleting.
	//
	// TWO GATES, and they answer different questions. `fileTreeKindIcons`
	// is whether this PANE gets glyphs at all; `organizerIcons` is which
	// glyphs the plugin draws anywhere, and `orgKindIcon` reads it
	// itself. A writer who set the style to `none` has said they want no
	// glyphs, and it would be strange for somebody else’s tree to be the
	// one place that ignored them — so `none` stands this pass down too,
	// rather than letting the call draw nothing on every row forever.
	paintExplorerKindIcons(this: WordSmith) {
		const rows = document.querySelectorAll(
			'.workspace-leaf-content[data-type="file-explorer"] .nav-file-title');
		// (The style gate went with `organizerIcons` at 346 — there is one
		// icon set now, so this switch is the whole of the question.)
		const on = !!(this.settings && this.settings.fileTreeKindIcons);
		for (const row of Array.from(rows)) {
			const path = (row.dataset && row.dataset.path) || '';
			if (!on) {
				const stray = row.querySelector(':scope > .ws-treekind');
				if (stray) stray.remove();
				continue;
			}
			// IDEMPOTENT, AND IT HAS TO BE. This pass runs on every explorer
			// mutation and the observer that schedules it watches the tree it
			// writes into — an observer must not write what it watches, and the
			// version of that bug in this plugin froze Obsidian on enable with no
			// error at all.
			//
			// THE STAMP IS THE PATH AND THE GLYPH SET'S VERSION. A cache keyed on
			// less than the thing it caches serves the old answer for ever: a row
			// stamped with its path alone is skipped by the check below however
			// the glyph it should wear has changed, so after an upgrade that
			// changes a glyph every already-stamped row keeps the old one — a row
			// only repaints if its PATH changes, which for an upgrade is never. The
			// stylesheet version moves with every release, so it is exactly the
			// right stamp: rows repaint once after an upgrade and never again in
			// between.
			const kindKey = path + '|' + WS_STYLESHEET_VERSION;
			let box = row.querySelector(':scope > .ws-treekind');
			if (box && box.getAttribute('data-kindfor') === kindKey) continue;
			if (!box) {
				box = createSpan();
				box.className = 'ws-treekind';
				// BEFORE THE NAME, where every other glyph in this tree sits.
				const name = row.querySelector('.nav-file-title-content');
				if (name && name.parentElement === row) row.insertBefore(box, name);
				else row.appendChild(box);
			}
			box.textContent = '';
			box.setAttribute('data-kindfor', kindKey);
			// `orgKindIcon` ANSWERS NULL for a row it has nothing to draw for
			// — an .md under the `drawn` style. The span stays, stamped, so
			// the next pass leaves it alone; the stylesheet hides it while it
			// is empty. Removing it instead would rebuild and remove it again
			// on every mutation, which is the churn the stamp exists to stop.
			this.orgKindIcon(box, path);
		}
	},

	paintExplorerFolderIcons(this: WordSmith) {
		const rows = document.querySelectorAll(
			'.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title');
		const iconsOn = !!(this.settings && this.settings.fileTreeFolderIcons);
		for (const row of Array.from(rows)) {
			const path = (row.dataset && row.dataset.path) || '';
			if (!iconsOn) {
				const stray = row.querySelector(':scope > .ws-treefolder');
				if (stray) stray.remove();
				continue;
			}
			let open = true;
			try {
				const holder = row.parentElement;
				open = !(holder && holder.classList.contains('is-collapsed'));
			} catch (_) { wsCatch('paintExplorerFolderIcons: const holder = row.parentElement;', _); }
			let icon = row.querySelector(':scope > .ws-treefolder');
			// ── THE STAMP KEYS ON THE COLOUR TOO (346) ─────────────────
			//
			// It was the open state alone, which was the whole of what the
			// glyph depended on while this painter drew `wsFolderSvg`
			// itself. It asks `orgFolderIcon` now, and that reads
			// `folderColors` — so the colour is part of the answer and
			// therefore part of the key.
			//
			// FOUND BY THE FIX FAILING IN THE VAULT. Pointing the painter at
			// the Organizer changed nothing on screen: every folder row
			// still carried the old hand-drawn svg, because `data-open` had
			// not changed and the pass said `continue`. The same fault pair
			// 344 fixed on the kind glyphs, one element along, introduced by
			// the very change that was meant to make the two panes agree.
			//
			// A CACHE MUST KEY ON EVERYTHING ITS OUTPUT DEPENDS ON. That is
			// now the third time this session, so it is in FACTS rather than
			// only here.
			const cid = String((this.settings.folderColors || {})[path] || '');
			const want = (open ? '1' : '0') + '|' + cid;
			if (icon && icon.getAttribute('data-open') === want) continue;
			if (!icon) {
				icon = createSpan();
				icon.className = 'ws-treefolder';
				const name = row.querySelector('.nav-folder-title-content');
				if (name && name.parentElement === row) row.insertBefore(icon, name);
				else row.appendChild(icon);
			}
			icon.setAttribute('data-open', want);
			// ── THE ORGANIZER'S FOLDER, NOT A SECOND DRAWING OF ONE ────
			//
			// `orgFolderIcon` is the class method that says what a folder looks
			// like, so this asks it instead of answering for itself: colour, the
			// Lucide names, the try-them-in-order and the silent-`setIcon` fallback
			// all arrive with it, and a fourth surface would cost nothing. (A
			// second drawing here painted the shape and never read `folderColors`,
			// so every coloured folder was grey in the tree.) IT BUILDS ITS OWN
			// SPAN, so the wrapper is emptied first — the stamp and the placement
			// above stay this painter's job, and the glyph inside is the
			// Organizer's.
			icon.textContent = '';
			this.orgFolderIcon(icon, path, open);
		}
	},

	// A note's badge is its index entry. A note the index does not hold — out
	// of the scope you set, a store of the plugin's own, not yet swept — gets
	// no badge and loses one it had: the same membership every total in the
	// plugin answers with (`isFileCounted`, the index's one rule), so the
	// tree, the Organizer, the report and the history agree about a folder.
	// The missing badge is worth something on its own: it is how you see, at
	// a glance, which notes are outside the scope.
	applyFileWordCount(this: WordSmith, el: HTMLElement, path: string, ix: WsOrgIndexMap) {
		const r = ix.get(path);
		if (!r) {
			const had = el.querySelector(':scope > .ws-count');
			if (had) had.remove();
			return;
		}
		this.setCountBadge(el, r.words);
	},

	// ── A FOLDER'S WORDS, FROM THE INDEX ─────────────────────────────
	//
	// A sum taken from the BADGES under `.nav-folder-children` is wrong
	// twice: Obsidian keeps a shut folder's rows out of the DOM, so a shut
	// folder is skipped (a fold read as a reading) and a parent adds up
	// only what is unfolded; and a nested folder's badge carries `data-wc`
	// too, so deepest-first a parent adds its own notes AND its
	// sub-folders' totals, which are those same notes over again — a book
	// of 1,600 words reads 6,400 at the top and is right only on the
	// shelves holding nothing but notes. A number computed from what was
	// DRAWN instead of what is IN THE VAULT. `sums` is `wsOrgFolderWords`
	// over the index: every folder's words in one walk, folded or not. A
	// folder with no counted note under it has no entry and no badge — not
	// a zero.
	applyFolderSums(this: WordSmith, root: HTMLElement, sums: Map<string, number>) {
		for (const t of Array.from(root.querySelectorAll<HTMLElement>('.nav-folder-title'))) {
			const fp = t.dataset && t.dataset.path;
			if (!fp) continue;
			const n = sums.get(fp);
			if (n == null) {
				const had = t.querySelector(':scope > .ws-count');
				if (had) had.remove();
				continue;
			}
			this.setCountBadge(t, n);
		}
	},

	async applyOutlineWordCounts(this: WordSmith, outlineRoot: HTMLElement) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;
		const cache = this.app.metadataCache.getFileCache(activeFile);
		if (!cache || !cache.headings) return;
		let text;
		try { text = await this.app.vault.cachedRead(activeFile); } catch { return; }
		const counts = new Map<string, number>();
		const heads = cache.headings;
		heads.forEach((h, i) => {
			const start = h.position.end.offset;
			const end   = (i + 1 < heads.length) ? heads[i + 1].position.start.offset : text.length;
			const slice = text.slice(start, end).trim();
			counts.set('plain:' + h.heading, slice === '' ? 0 : slice.split(/\s+/).length);
		});
		outlineRoot.querySelectorAll('.tree-item-self').forEach((node: HTMLElement) => {
			const inner = node.querySelector('.tree-item-inner');
			if (!inner) return;
			const count = counts.get('plain:' + inner.textContent.trim());
			if (count != null) this.setCountBadge(node, count);
		});
	},

	// A FLAG IN THE FILE EXPLORER, beside the count.
	//
	// The flag a writer set on the board is invisible where they actually
	// work: the tree they open notes from. This is the same store, drawn at
	// eleven pixels, and it is the reason the three states are a fill
	// density rather than three colours — at this size, in a column of
	// twenty, colour alone is a guess.
	//
	// REFUSED HERE rather than at the two call sites, and the difference
	// matters: this is also the only path that REMOVES a badge, so a folder
	// that already carries one is cleaned by the same visit that used to
	// paint it. Refusing in the caller would have left every existing
	// folder badge on screen until something else happened to repaint.
	setFlagBadge(this: WordSmith, parentEl: HTMLElement, path: string, isFolder: boolean) {
		if (isFolder) {
			const stale = parentEl.querySelector('.ws-treeflag');
			if (stale) stale.remove();
			return;
		}
		const want = this.settings.fileTreeFlags
			&& (this.settings.fileStatus || {})[path];
		let flag = parentEl.querySelector('.ws-treeflag');
		if (!want) { if (flag) flag.remove(); return; }
		if (!flag) {
			flag = createSpan();
			flag.className = 'ws-treeflag';
			// IN THE MARKS BOX, first — so the flag, the book and the count
			// are always in the same order however many of them there are.
			// This used to insert itself before `.ws-count`, which meant the
			// flag's position depended on whether counts were switched on.
			const box = this.treeMarksBox(parentEl);
			if (box) box.insertBefore(flag, box.firstChild);
			else parentEl.appendChild(flag);
		}
		// THE STAMP IS WHAT WAS DRAWN, not which flag it is.
		//
		// A guard that compares the flag ID misses a change of shape or label —
		// the id is the one thing a writer CANNOT change in Settings → Flags,
		// so "draft" stays "draft", the guard sees no difference, and the badge
		// keeps flying the shape it was born with until the note happens to be
		// re-flagged. Every other surface redraws from scratch, so the tree
		// would be the only one that lied.
		//
		// `data-flag` STAYS THE ID — tree_flag_probe reads it as the id and
		// it is the honest name for that attribute. The compound goes in its own.
		const drew = JSON.stringify([want, wsFlagShapeOf(want), wsStatusLabel(want)]);
		if (flag.getAttribute('data-drew') !== drew) {
			flag.setAttribute('data-flag', want);
			flag.setAttribute('data-drew', drew);
			wsSvgInto(flag, wsFlagSvg(want, 11));
			flag.title = wsStatusLabel(want);
		}
	},

	setCountBadge(this: WordSmith, parentEl: HTMLElement, count: number) {
		// THE BADGE GOES ON THE ROW, and this is a step BACK on purpose.
		//
		// Everything this plugin adds could sit in one box, `.ws-treemarks` —
		// the right shape, and it cost the counts entirely in a real vault,
		// where they stopped displaying for a cause in markup or CSS a bare DOM
		// does not have. So the counts keep the arrangement they worked in, and
		// the ALIGNMENT — which is what the box was for — is done in the
		// stylesheet instead, where it costs nothing if it is wrong. A tidy
		// structure is not worth a reading a writer cannot see.
		this.treeMarksBox(parentEl);
		let badge = parentEl.querySelector(':scope > .ws-count');
		if (!badge) {
			badge = createSpan();
			badge.className = 'ws-count';
			parentEl.appendChild(badge);
		}
		badge.dataset.wc = String(count);
		if (badge.textContent !== count.toLocaleString()) badge.textContent = count.toLocaleString();
	},

	// EVERYTHING THE EXPLORER PAINTERS ADD, not only the counts: the folder
	// icon, the kind icon, the marks box, the colour attribute and variable
	// on a folder row, and the inline flex the marks box writes on a row
	// and its title. This is the one remover both teardowns call; the name
	// is historical, and the lifecycle test holds the explorer to "as found"
	// across the switch and across unload.
	removeWordCounts(this: WordSmith) {
		for (const sel of ['.ws-count', '.ws-tasks', '.ws-treeflag',
			'.ws-treemarks', '.ws-treefolder', '.ws-treekind']) {
			document.querySelectorAll(sel).forEach(el => el.remove());
		}
		const rows = document.querySelectorAll(
			'.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title,'
			+ ' .workspace-leaf-content[data-type="file-explorer"] .nav-file-title');
		for (const row of Array.from(rows)) {
			try {
				row.removeAttribute('data-ws-colour');
				row.style.removeProperty('--ws-folder-colour');
				row.classList.remove('ws-has-colour', 'ws-drop-above', 'ws-drop-below');
				// treeMarksBox's layout, taken back only where it is ours: the
				// values it writes, and no other inline value Obsidian or another
				// plugin may have put there.
				if (row.style.display === 'flex') row.style.removeProperty('display');
				row.classList.remove('ws-treerow');
				const inner = row.querySelector(
					'.nav-file-title-content, .nav-folder-title-content, .tree-item-inner');
				if (inner) inner.classList.remove('ws-treeinner');
			} catch (_) { wsCatch('removeWordCounts: row.removeAttribute(\'data-ws-colour\');', _); }
		}
		if (this.wordCountCache) this.wordCountCache.clear();
	},
};
export type TreeMethods = typeof treeMethods;
