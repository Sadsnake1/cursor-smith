// Word-Smith — History: the writing history: the store, the tallies, the tab and its chart.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { TFile, Notice, setIcon } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import { HISTORY_BAR_MAX, HISTORY_CHART_H, HISTORY_CHART_W, HISTORY_DAYNAMES, HISTORY_DEBOUNCE_MS, HISTORY_HEAT, HISTORY_IDLE_MS, HISTORY_MARK_END, HISTORY_MARK_START, HISTORY_MAX_CELLS, HISTORY_MAX_UNSAVED_MS, HISTORY_MONTHS, HISTORY_OVERLAB_PAD, HISTORY_PX, WS_HIST_LAB_GAP, WS_WRITE, wsAxisBound, wsCatch, wsErrMsg } from './preamble';
import type WordSmith from './plugin';
import type { WsHistoryTally, WsHistoryTabState, WsHistoryBucket, WsHistoryRecord } from './plugin';

export const historyMethods = {

	// ════════════════════════════════════════════════════════════════════════
	// Writing history
	// ════════════════════════════════════════════════════════════════════════
	//
	// The first thing Word-Smith stores about BEHAVIOUR rather than about
	// configuration, which is why it is opt-in and why the settings row says
	// in plain words what is kept: counts per day, never text.
	//
	// One record per local calendar day. Months and years roll up on READ and
	// are never stored — a stored rollup is a second copy of the truth, and
	// two copies of an answer is how the settings pane opened on the wrong
	// tab for several releases.

	// Local time, never UTC: a writer working at 23:40 is writing today,
	// wherever today is. Building the key by hand rather than through
	// toISOString(), which converts to UTC and hands back yesterday for half
	// the planet every evening.
	// A stored key (YYYY-MM-DD) as a person would write it: "11 August 2026".
	// The key is the right shape to SORT and the wrong shape to READ, and
	// this line is prose in the middle of a sentence. Parsed by hand rather
	// than through Date: `new Date('2026-08-11')` is UTC midnight, which in
	// any negative offset renders as the day BEFORE — the classic way a
	// date display goes wrong for exactly the readers least likely to
	// suspect the timezone. Anything that is not a key is passed through
	// untouched, so a malformed store shows what it holds rather than
	// "NaN undefined NaN".
	historyLongDate(this: WordSmith, key: string) {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
		if (!m) return String(key || '');
		const month = HISTORY_MONTHS[parseInt(m[2], 10) - 1];
		if (!month) return String(key);
		return parseInt(m[3], 10) + ' ' + month + ' ' + m[1];
	},

	historyDateKey(this: WordSmith, d?: Date) {
		const dt = d instanceof Date ? d : new Date();
		const p  = (n: number) => (n < 10 ? '0' : '') + n;
		return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
	},

	// ════════════════════════════════════════════════════════════════════════
	// The store: history.md IS the record
	// ════════════════════════════════════════════════════════════════════════
	//
	// Until 1.28 the record lived in data.json and the note was a mirror. That
	// is backwards for something a writer will want to keep: data.json is
	// invisible, is deleted with the plugin, and is not a thing you can put in
	// a folder with the manuscript it describes. So the note is now the store,
	// and the plugin FINDS it — by its marker, anywhere in the vault, under
	// any name. Move it, rename it, put it in a subfolder: it is still yours
	// and it is still found.
	//
	// data.json keeps exactly one history-related thing, and it is not
	// history: `historyBaselines`, the "what did this file weigh last time I
	// looked" cache. It is worthless to a human reader, it would be a kilobyte
	// of JSON in the middle of somebody's note, and it rebuilds itself. Delete
	// data.json and you lose the first edit of each file in the next session.
	// Delete history.md and you have lost the record — which is the honest
	// shape of the thing, and is said in the settings pane in those words.

	historyEnsure(this: WordSmith) {
		// `any` on purpose: this is the repair door for a record loaded from
		// disk, of whatever shape it was left in; it leaves as the shape below.
		let h: WsHistoryRecord | null = this._history;
		if (!h || typeof h !== 'object') h = { started: null, days: {}, paths: {}, today: { date: '', a: 0, r: 0, n: 0, by: {} } };
		if (!h.days || typeof h.days !== 'object' || Array.isArray(h.days)) h.days = {};
		if (h.started === undefined) h.started = null;
		if (!h.paths || typeof h.paths !== 'object' || Array.isArray(h.paths)) h.paths = {};
		// Switching "Remember which notes" off means the note names go, not
		// merely that no new ones are added. Anything else leaves a file full
		// of paths that a person has just asked not to keep, and a finder
		// still offering them.
		if (this.settings.historyPerFile === false) {
			if (Object.keys(h.paths).length) h.paths = {};
			if (h.today && h.today.by && Object.keys(h.today.by).length) h.today.by = {};
		}
		if (!h.today || typeof h.today !== 'object' || !h.today.date) {
			h.today = { date: this.historyDateKey(), a: 0, r: 0, n: 0, by: {} };
		}
		if (!h.today.by || typeof h.today.by !== 'object') h.today.by = {};
		for (const k of ['a', 'r', 'n'] as const) if (typeof h.today[k] !== 'number') h.today[k] = 0;
		this._history = h;
		return h;
	},

	// The baseline cache. Lives on settings, because it IS configuration-
	// adjacent bookkeeping rather than a record of anything.
	historyBaselines(this: WordSmith) {
		const s = this.settings;
		if (!s.historyBaselines || typeof s.historyBaselines !== 'object'
			|| Array.isArray(s.historyBaselines)) s.historyBaselines = {};
		return s.historyBaselines;
	},

	// No midnight timer. The date is recomputed on every event, so a laptop
	// asleep across midnight compacts correctly on the first keystroke of the
	// morning — which is the case a timer gets wrong.
	historyCompact(this: WordSmith, h: WsHistoryRecord, key: string) {
		if (!h.today || h.today.date === key) return false;
		const t = h.today;
		// A day with no activity is not stored. Absent means "did not write",
		// which is what every reader of the chart assumes a gap means.
		if (t.a || t.r) {
			h.days[t.date] = { a: t.a, r: t.r, n: t.n };
			if (Object.keys(t.by).length) h.paths[t.date] = t.by;
		}
		h.today = { date: key, a: 0, r: 0, n: 0, by: {} };
		return true;
	},

	// ── Finding the file ────────────────────────────────────────────────────

	historyDefaultPath(this: WordSmith) {
		let p = String(this.settings.historyFilePath || 'Word-Smith/ws-history.md').trim();
		p = p.replace(/^\/+/, '');
		if (!/\.md$/i.test(p)) p += '.md';
		// The history already finds itself anywhere in the vault by its
		// markers, so this is only where a NEW one is made — but an
		// upgrading vault whose file sits at the old default should not
		// have a second one made beside it before that search runs.
		return this.storeResolve(p, 'history.md');
	},

	// What the settings pane shows, and null before anything has been found.
	historyStorePath(this: WordSmith) { return this._historyPath || null; },

	// THIS VAULT HAS A HISTORY FILE, remembered across sessions. Once true,
	// a search that comes back empty is a search that FAILED — see the guards
	// in `historyWrite` for why that distinction is the difference between
	// carrying on and quietly starting a second record.
	// Reported, not discarded. A failure here means the tab shows
	// its “new” mark again next session — small, and the reason is the
	// same one that loses a writer’s settings, so it shares that latch
	// and is said once for all four writers of data.json.
	async historyMarkSeen(this: WordSmith) {
		if (this.settings.historySeen) return;
		this.settings.historySeen = true;
		try { await this.saveData(this.settings); }
		catch (e) {
			this.storeWriteFailed(WS_WRITE.settings, e,
				'Word-Smith will look for the file again next time.');
		}
	},

	historyIsStoreFile(this: WordSmith, text: string) {
		return String(text || '').indexOf(HISTORY_MARK_START) !== -1;
	},

	// ── TURNING IT ON IS ONE ACT ─────────────────────────────────
	//
	// The pane can start the record as well as the settings, so there are
	// TWO doors onto the same three steps — set the flag, find or make the
	// file, write it once — and two copies of a sequence is how the second
	// one comes to skip a step. THE FILE IS FOUND OR MADE IMMEDIATELY: the
	// settings pane says where the record lives, and without this it would
	// say "not created yet" until something else saved; a vault whose
	// `ws-history.md` survived a lost data.json gets it READ, not replaced.
	// ANSWERS WHETHER IT CHANGED ANYTHING, so a caller that redraws does
	// not redraw for nothing.
	async historyTrackingOn(this: WordSmith) {
		if (this.settings.historyTracking) return false;
		this.settings.historyTracking = true;
		await this.saveSettings();
		await this.historyLoad();
		// THE SWITCH IS THE WRITER'S WORD. A file can go while the plugin is
		// not watching, so no delete event fires and `historySeen` goes on
		// refusing a new one. A writer turning tracking ON, with the vault
		// indexed under them and no store file anywhere in it, wants a record:
		// the memory of a file that is not there goes, and the write below
		// makes a first. A file that IS found is written into, as before, and
		// the memory stands.
		try {
			let notes = [];
			try { notes = this.app.vault.getMarkdownFiles() || []; } catch { notes = []; }
			if (this.settings.historySeen && notes.length && !(await this.historyFindFile())) {
				this.settings.historySeen = false;
			}
		} catch (_) { wsCatch('historyTrackingOn: if (this.settings.historySeen && !(await this.historyFindFile()))', _); }
		await this.historyWrite(true);
		return true;
	},

	// Cheapest first, and a full scan only as a last resort. The marker is an
	// HTML comment, so the metadata cache cannot help and the contents have to
	// be read — but cachedRead is warm for anything Obsidian has already
	// opened, and this runs once per session unless the file goes missing.
	async historyFindFile(this: WordSmith) {
		const vault = this.app.vault;
		const check = async (file: TAbstractFile | null) => {
			if (!file || !(file instanceof TFile)) return false;
			try { return this.historyIsStoreFile(await vault.cachedRead(file)); }
			catch { return false; }
		};

		// 1. The one we were using, if it is still there and still ours.
		if (this._historyPath) {
			const f = vault.getAbstractFileByPath(this._historyPath);
			if (await check(f)) return f;
		}
		// 2. Where the setting says it should be.
		const want = this.historyDefaultPath();
		const at = vault.getAbstractFileByPath(want);
		if (await check(at)) return at;

		// 3. Anything with the same FILENAME elsewhere in the vault. This is
		//    the move-it-to-a-folder case, and it is the common one, so it is
		//    tried before reading the whole vault.
		const base = (want.split('/').pop() || '').toLowerCase();
		const all  = vault.getMarkdownFiles();
		const named = all.filter(f => f.path.toLowerCase().endsWith('/' + base)
			|| f.path.toLowerCase() === base);
		for (const f of named) if (await check(f)) return f;

		// 4. Renamed as well as moved. Read everything, smallest first — the
		//    store is a table of short rows, so a 2MB note is not it.
		const rest = all.filter(f => named.indexOf(f) === -1)
			.filter(f => !f.stat || f.stat.size < 4000000)
			.sort((a, b) => (a.stat ? a.stat.size : 0) - (b.stat ? b.stat.size : 0));
		for (const f of rest) if (await check(f)) return f;
		return null;
	},

	// ── Loading ─────────────────────────────────────────────────────────────

	async historyLoad(this: WordSmith) {
		if (this._historyLoading != null) return this._historyLoading;
		this._historyLoading = (async () => {
			let file = null;
			try { file = await this.historyFindFile(); } catch (_) { wsCatch('historyLoad: file = await this.historyFindFile();', _); }
			let parsed: Partial<WsHistoryRecord> = { started: null, days: {} };
			if (file) {
				this._historyPath = file.path;
				this.orgIndexStoreKnown(file.path);
				try { parsed = this.historyParse(await this.app.vault.read(file)); } catch (_) { wsCatch('historyLoad: parsed = this.historyParse(await this.app.vault.read(file));', _); }
			}

			const h: WsHistoryRecord = { started: parsed.started || null, days: parsed.days || {},
				paths: parsed.paths || {},
				today: { date: this.historyDateKey(), a: 0, r: 0, n: 0, by: {} } };
			// Today may already be in the table from earlier in the day, so it
			// is lifted back out and carries on rather than restarting at zero
			// because Obsidian was restarted at lunchtime.
			const t = h.days[h.today.date];
			if (t) {
				h.today.a = t.a; h.today.r = t.r; h.today.n = t.n;
				delete h.days[h.today.date];
			}
			if (h.paths[h.today.date]) {
				h.today.by = h.paths[h.today.date];
				delete h.paths[h.today.date];
			}
			this._history = h;
			this.historyEnsure();

			// One-time migration off data.json. 1.28 and earlier kept the
			// record there; those days are real and must not be dropped on the
			// floor by an upgrade.
			const legacy = this.settings.historyData;   // WsLegacyHistory | undefined (settings.ts)
			if (legacy && legacy.days && Object.keys(legacy.days).length) {
				let moved = 0;
				for (const k of Object.keys(legacy.days)) {
					if (h.days[k] || k === h.today.date) continue;
					h.days[k] = legacy.days[k];
					moved++;
				}
				if (legacy.started && (!h.started || legacy.started < h.started)) h.started = legacy.started;
				if (legacy.fileCounts && !Object.keys(this.historyBaselines()).length) {
					this.settings.historyBaselines = legacy.fileCounts;
				}
				delete this.settings.historyData;
				await this.saveSettings();
				if (moved) {
					await this.historyWrite(true);
					new Notice('Word-Smith: moved ' + moved + ' day'
						+ (moved === 1 ? '' : 's') + ' of writing history into '
						+ (this._historyPath || this.historyDefaultPath()) + '.');
				}
			}

			const keys = Object.keys(h.days).sort();
			if (keys.length && (!h.started || keys[0] < h.started)) h.started = keys[0];
			this._historyReady = true;
			return h;
		})();
		try { return await this._historyLoading; }
		finally { this._historyLoading = null; }
	},

	// ── Capture ─────────────────────────────────────────────────────────────

	historyNoteChange(this: WordSmith, file: TAbstractFile) {
		if (!this.settings.historyTracking) return;
		if (!file || !file.path || !/\.md$/i.test(file.path)) return;
		// Before the scope check, and unconditional: writing the store fires
		// modify ON the store, and without this the history would record
		// itself recording, forever.
		if (file.path === this._historyPath) return;
		if (!this.isFileCounted(file)) return;
		if (!this._historyTimers) this._historyTimers = new Map();
		const prev = this._historyTimers.get(file.path);
		if (prev) window.clearTimeout(prev);
		this._historyTimers.set(file.path, window.setTimeout(() => {
			this._historyTimers.delete(file.path);
			void this.historyCapture(file.path);
		}, HISTORY_DEBOUNCE_MS));
	},

	async historyCapture(this: WordSmith, path: string) {
		try {
			if (!this.settings.historyTracking) return;
			// Nothing is recorded before the store has been read. Recording
			// first would build an empty record and then have the load
			// overwrite it — losing whatever was typed in the meantime.
			if (!this._historyReady) await this.historyLoad();
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!file || !(file instanceof TFile)) return;
			if (path === this._historyPath) return;
			if (!this.isFileCounted(file)) return;
			// countWords → countProse, the single counting authority. The
			// history must never be able to disagree with the status bar.
			let count = 0;
			const hit = this.wordCountCache && this.wordCountCache.get(path);
			if (hit && hit.mtime === file.stat.mtime) {
				count = hit.count || 0;
			} else {
				const text = await this.app.vault.cachedRead(file);
				count = this.countWords(text);
				if (this.wordCountCache) this.wordCountCache.set(path, { mtime: file.stat.mtime, count });
			}
			this.historyRecord(path, count);
		} catch { /* a note deleted mid-debounce; nothing to record */ }
	},

	historyRecord(this: WordSmith, path: string|number, count: number) {
		const h    = this.historyEnsure();
		const base = this.historyBaselines();
		const key  = this.historyDateKey();
		const rolled = this.historyCompact(h, key);
		const had  = Object.prototype.hasOwnProperty.call(base, path);
		const prev = had ? base[path] : 0;
		base[path] = count;

		// A file with no baseline records NOTHING — it only establishes one.
		// This is what stops a fresh sync dump, or the first open of a
		// five-year-old note, from arriving as today's heroic word count.
		if (!had) { this.historyQueueSave(rolled); return; }

		const delta = count - prev;
		if (delta === 0) { if (rolled) this.historyQueueSave(true); return; }

		const t = h.today;
		if (delta > 0) t.a += delta; else t.r += -delta;
		t.n += delta;
		// The per-note breakdown, which is what the search box searches. Kept
		// beside the totals rather than replacing them: the totals are what a
		// person reads in the file, and deriving them from this every time
		// would make the readable half of the store a computation.
		if (this.settings.historyPerFile !== false) {
			const b = t.by[path] || (t.by[path] = { a: 0, r: 0, n: 0 });
			if (delta > 0) b.a += delta; else b.r += -delta;
			b.n += delta;
		}
		if (!h.started) h.started = key;
		this.historyQueueSave(rolled);
	},

	// The store is a note in the vault, so it is written at a human cadence,
	// not once per keystroke pause. The baseline cache rides along on the same
	// debounce through saveData — never saveSettings, which would run the full
	// refresh() and rebuild the mask while somebody is typing.
	// Written when you STOP, not on a clock. A fixed interval either writes in
	// the middle of a sentence or leaves the record stale for its whole length;
	// the moment that is actually free is the pause between paragraphs, and
	// that is a timer which RESETS on every change rather than one that runs
	// down regardless. The ceiling is the safety net: if the pauses never come
	// — a long dictated burst, a paste-heavy session — the file is written
	// anyway rather than holding an hour of work in memory.
	historyQueueSave(this: WordSmith, immediate?: boolean) {
		if (immediate) { void this.historyFlush(true); return; }
		if (!this._historyDirtyAt) this._historyDirtyAt = Date.now();
		if (Date.now() - this._historyDirtyAt >= HISTORY_MAX_UNSAVED_MS) {
			void this.historyFlush(true);
			return;
		}
		if (this._historySaveTimer) window.clearTimeout(this._historySaveTimer);
		this._historySaveTimer = window.setTimeout(() => {
			this._historySaveTimer = null;
			void this.historyFlush(true);
		}, HISTORY_IDLE_MS);
	},

	async historyFlush(this: WordSmith, force: boolean) {
		if (this._historySaveTimer) {
			window.clearTimeout(this._historySaveTimer);
			this._historySaveTimer = null;
		}
		this._historyDirtyAt = 0;
		// Reported, not discarded. `historyWrite` below already says so when
		// the history FILE cannot be written; this is the settings half of the
		// same flush, and it shares the settings latch.
		try { await this.saveData(this.settings); }
		catch (e) {
			this.storeWriteFailed(WS_WRITE.settings, e,
				'Word-Smith will look for the file again next time.');
		}
		return await this.historyWrite(force);
	},

	historyRenamePath(this: WordSmith, oldPath: string, newPath: string) {
		// The store moving is the whole point of the feature: follow it.
		if (this._historyPath && oldPath === this._historyPath) {
			this._historyPath = newPath;
			this.settings.historyFilePath = newPath;
			void this.saveSettings();
			return;
		}
		// The RECORD first, and unconditionally.
		//
		// This used to move the baseline cache and nothing else, and returned
		// early when there was no baseline to move — so a note renamed in a
		// session where it had not been edited skipped everything. With the
		// per-note breakdown added in 1.41 that meant the history kept the old
		// path forever: the finder offered a note that no longer existed, the
		// renamed one looked like it had never been written in, and a folder
		// scope silently missed every file that had ever been moved into it.
		//
		// Folders fire this event too, so it walks PREFIXES rather than
		// looking for an exact key — a folder rename has to carry every note
		// beneath it. Whole segments only, so renaming "Book" does not drag
		// "Bookmarks" along. Same rule, same reason, as renameGoalPaths.
		let moved = this.historyRenameRecord(oldPath, newPath);

		const base = this.historyBaselines();
		for (const key of Object.keys(base)) {
			const next = this.historyMovedPath(key, oldPath, newPath);
			if (next === null) continue;
			// The destination wins if something is already there: it is the
			// more recent measurement of whatever now lives at that path.
			if (!Object.prototype.hasOwnProperty.call(base, next)) base[next] = base[key];
			delete base[key];
			moved = true;
		}
		if (moved) this.historyQueueSave();
	},

	// The new path for a key when `from` moves to `to`, or null if untouched.
	// Whole path segments only: "Book" moving is not "Bookmarks" moving.
	historyMovedPath(this: WordSmith, key: string, from: string, to: string) {
		if (key === from) return to;
		if (key.indexOf(from + '/') === 0) return to + key.slice(from.length);
		return null;
	},

	historyRenameRecord(this: WordSmith, oldPath: string, newPath: string) {
		const h = this.historyEnsure();
		let changed = false;
		const rewrite = (by: Record<string, WsHistoryTally>) => {
			if (!by) return;
			for (const key of Object.keys(by)) {
				const next = this.historyMovedPath(key, oldPath, newPath);
				if (next === null || next === key) continue;
				const there = by[next];
				if (there) {
					// A note moved onto a path that already has history for
					// that day: both lots of words were really written, so
					// they are summed rather than one being dropped.
					there.a += by[key].a || 0;
					there.r += by[key].r || 0;
					there.n = there.a - there.r;
				} else {
					by[next] = by[key];
				}
				delete by[key];
				changed = true;
			}
		};
		for (const date of Object.keys(h.paths)) rewrite(h.paths[date]);
		if (h.today) rewrite(h.today.by);
		return changed;
	},

	// A delete records NOTHING. Removing a 5,000-word file is housekeeping,
	// not "deleted 5,000 words today".
	//
	// It also leaves the note's PAST in the record, deliberately. Those words
	// were written; deleting the file does not unwrite them, and a total that
	// shrinks when you tidy up is a total nobody can trust. The finder will go
	// on offering the name, which is the right answer for anyone asking how
	// much went into a draft they have since cut.
	historyForgetPath(this: WordSmith, path: string) {
		// THE VAULT SAYS IT IS GONE. `historySeen` holds "once seen, never a
		// second" against a SCAN that fails while Obsidian indexes — the file
		// is still there, the index is not. A delete event is the vault's own
		// word that the file is not there, so the memory of one goes with it
		// and the next write is a first. The guard stays for the case it was
		// built for: a scan that finds nothing with no delete reported still
		// makes no rival.
		if (this._historyPath && path === this._historyPath) {
			this._historyPath = null;
			this.settings.historySeen = false;
			return;
		}
		const base = this.historyBaselines();
		if (!Object.prototype.hasOwnProperty.call(base, path)) return;
		delete base[path];
		this.historyQueueSave();
	},

	// ── Reading ─────────────────────────────────────────────────────────────

	// Everything, or only what happened under one note or folder.
	//
	// A scope of '' is the whole vault and returns the stored totals directly.
	// A scope with a path in it rebuilds each day from the per-note breakdown,
	// so a day where you wrote 900 words across three notes contributes only
	// the part that happened inside the scope. Days recorded before the
	// breakdown existed have none, and are absent from a scoped view rather
	// than being counted in full — which is the honest answer, and is said in
	// words on screen rather than left for the reader to notice.
	historyDays(this: WordSmith, scope?: string | string[]) {
		const h   = this.historyEnsure();
		const t   = h.today;
		// NOTHING SELECTED IS THE WHOLE VAULT, and an empty LIST is nothing
		// selected. Without this an empty array is truthy, so the window
		// would take the fast path away and then sum a union of no paths —
		// a chart of zero on the day a writer opens it.
		if (!scope || (Array.isArray(scope) && !scope.length)) {
			const out = Object.assign({}, h.days);
			if (t && (t.a || t.r)) out[t.date] = { a: t.a, r: t.r, n: t.n };
			return out;
		}
		const under = this.historyPathUnder(scope);
		const out: Record<string, WsHistoryTally> = {};
		const add = (date: string, by: Record<string, WsHistoryTally>) => {
			let a = 0, r = 0;
			for (const p of Object.keys(by)) {
				if (!under(p)) continue;
				a += by[p].a || 0;
				r += by[p].r || 0;
			}
			if (a || r) out[date] = { a, r, n: a - r };
		};
		for (const date of Object.keys(h.paths)) add(date, h.paths[date]);
		if (t && t.by && Object.keys(t.by).length) add(t.date, t.by);
		return out;
	},

	// Whole path segments only, so scoping to "Book" does not sweep in
	// "Bookmarks" — the same rule the goal renames use, and for the same
	// reason. A scope that is a note matches only that note.
	//
	// SEVERAL PATHS, OR ONE. The unified window's tree can have three
	// chapters lit at once and the chart under it has to be their sum, so a
	// scope is now either a string or a list of them. A list is a UNION: a
	// note passes if any path in it covers the note, which is also what
	// makes an overlapping selection — a chapter and a scene inside it —
	// count each day once rather than twice.
	historyPathUnder(this: WordSmith, scope: string | string[] | null | undefined): (p: string) => boolean {
		if (Array.isArray(scope)) {
			const tests = scope.map(p => this.historyPathUnder(p));
			// An empty list is not a filter. It means the writer has nothing
			// selected, which the whole window reads as the whole vault.
			if (!tests.length) return () => true;
			return (p: string) => tests.some((t) => t(p));
		}
		const base = String(scope || '').replace(/\/+$/, '');
		if (!base) return () => true;
		const prefix = base + '/';
		return (p: string|string[]) => p === base || p.indexOf(prefix) === 0;
	},

	// Every note and every folder the record has ever seen, for the finder.
	historyKnownPaths(this: WordSmith) {
		const h = this.historyEnsure();
		const files = new Set<string>();
		const seen = (by: Record<string, WsHistoryTally>) => { for (const p of Object.keys(by || {})) files.add(p); };
		for (const d of Object.keys(h.paths)) seen(h.paths[d]);
		if (h.today) seen(h.today.by);
		const folders = new Set<string>();
		for (const p of files) {
			let cut = p.lastIndexOf('/');
			while (cut > 0) {
				folders.add(p.slice(0, cut));
				cut = p.lastIndexOf('/', cut - 1);
			}
		}
		return {
			files: Array.from(files).sort(),
			folders: Array.from(folders).sort()
		};
	},

	historyValue(this: WordSmith, rec: { a?: number; n?: number } | null | undefined, mode: string) {
		if (!rec) return 0;
		return mode === 'gross' ? (rec.a || 0) : (rec.n || 0);
	},

	// An ACTIVE day is one with any activity at all (a + r > 0), not one with
	// a positive net. A day spent cutting 2,000 words is a day you showed up,
	// and a streak that breaks on your hardest editing day is a metric that
	// punishes the work it claims to measure.
	historyIsActive(this: WordSmith, rec: { a?: number; r?: number } | null | undefined) {
		return !!rec && ((rec.a || 0) + (rec.r || 0)) > 0;
	},

	historyShiftKey(this: WordSmith, key: string, deltaDays: number) {
		const parts = String(key).split('-');
		const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
		d.setDate(d.getDate() + deltaDays);
		return this.historyDateKey(d);
	},

	historyFigures(this: WordSmith, mode: string, scope: string | string[]) {
		const days = this.historyDays(scope);
		const keys = Object.keys(days).sort();
		let total = 0, best = 0, bestKey = '', active = 0;
		for (const k of keys) {
			const v = this.historyValue(days[k], mode);
			total += v;
			if (v > best) { best = v; bestKey = k; }
			if (this.historyIsActive(days[k])) active++;
		}
		// THE STREAK: a run of days, and a run that survives a gap is not a run
		// — so a missed day takes it to zero, plainly, which is the whole
		// meaning of the number. The generosity is in what COUNTS as a day: an
		// active day is any day with activity at all, so the hardest editing day
		// of a project extends the streak rather than breaking it (see
		// historyIsActive).
		let longest = 0, run = 0, prevKey = null;
		for (const k of keys) {
			if (!this.historyIsActive(days[k])) { run = 0; prevKey = k; continue; }
			run = (prevKey && this.historyShiftKey(prevKey, 1) === k && run > 0) ? run + 1 : 1;
			if (run > longest) longest = run;
			prevKey = k;
		}
		// The current streak walks back from today — but starts at yesterday
		// when today is still empty, because at nine in the morning a streak
		// has not been broken, it has not been continued yet. A day only
		// counts against you once it is OVER; every day before today that
		// went unwritten takes the number straight to zero.
		let cursor = this.historyDateKey();
		if (!this.historyIsActive(days[cursor])) cursor = this.historyShiftKey(cursor, -1);
		let current = 0;
		while (this.historyIsActive(days[cursor])) { current++; cursor = this.historyShiftKey(cursor, -1); }
		return {
			total, best, bestKey, active, longest, current,
			// Averaged over days you WROTE, not over calendar days. Dividing by
			// the calendar punishes anyone who takes days off — and note that
			// no weekday is special here either: an active day is any day with
			// activity on it, so Saturday counts exactly as Tuesday does and a
			// skipped Tuesday is excluded exactly as a skipped Sunday is. The
			// chart makes the same promise by refusing to shade weekends; this
			// is the arithmetic half of it.
			average: active ? Math.round(total / active) : 0,
			days, keys
		};
	},

	// The RANGE, not the years that happen to hold data: a writer who stopped
	// for all of 2025 has a 2025, and a stepper that jumps from 2024 to 2026
	// hides the fallow year instead of showing it.
	historyYears(this: WordSmith, scope: string | string[] | undefined) {
		const days = this.historyDays(scope);
		const set  = new Set<number>();
		for (const k of Object.keys(days)) set.add(+k.slice(0, 4));
		set.add(new Date().getFullYear());
		const years = Array.from(set);
		const lo = Math.min.apply(null, years), hi = Math.max.apply(null, years);
		const out = [];
		for (let y = lo; y <= hi; y++) out.push(y);
		return out;
	},

	// ── The file format ─────────────────────────────────────────────────────

	historyBody(this: WordSmith) {
		const days = this.historyDays();
		const keys = Object.keys(days).sort().reverse();
		const byYear = new Map<string, string[]>();
		for (const k of keys) {
			const y = k.slice(0, 4);
			const ks = byYear.get(y) || [];
			ks.push(k);
			byYear.set(y, ks);
		}
		const out = [];
		out.push('This file IS your writing history \u2014 Word-Smith reads it back from here,');
		out.push('so keep it if you keep anything. Move it or rename it freely; the plugin');
		out.push('finds it by the markers below, anywhere in the vault. Counts only, never');
		out.push('your text. Everything between the markers is rewritten; write what you');
		out.push('like outside them.');
		out.push('');
		for (const [year, ks] of byYear) {
			let a = 0, r = 0;
			for (const k of ks) { a += days[k].a || 0; r += days[k].r || 0; }
			out.push('### ' + year + ' \u2014 ' + ks.length + ' day' + (ks.length === 1 ? '' : 's') + ', '
				+ (a - r > 0 ? '+' : '') + (a - r).toLocaleString('en-GB') + ' net');
			out.push('');
			out.push('| Date | Added | Deleted | Net |');
			out.push('| --- | ---: | ---: | ---: |');
			for (const k of ks) {
				const d = days[k];
				out.push('| ' + k + ' | ' + (d.a || 0) + ' | ' + (d.r || 0)
					+ ' | ' + (d.n || 0) + ' |');
			}
			out.push('');
		}

		// The per-note breakdown, under its own heading and after the totals,
		// because the totals are the half a person reads. This is the half the
		// search box reads, and it is the reason the file grows with the number
		// of notes you touch rather than only with the days you write.
		const by = this.historyPathRows();
		if (by.length) {
			out.push('### By note');
			out.push('');
			out.push('| Date | Note | Added | Deleted | Net |');
			out.push('| --- | --- | ---: | ---: | ---: |');
			for (const row of by) {
				// A pipe in a filename would end the cell early. Rare, legal,
				// and silent when it goes wrong.
				out.push('| ' + row.date + ' | ' + row.path.replace(/\|/g, '\\|')
					+ ' | ' + row.a + ' | ' + row.r + ' | ' + row.n + ' |');
			}
			out.push('');
		}
		return out.join('\n');
	},

	historyPathRows(this: WordSmith) {
		const h = this.historyEnsure();
		const out: { date: string; path: string; a: number; r: number; n: number }[] = [];
		const push = (date: string, by: Record<string, WsHistoryTally>) => {
			for (const p of Object.keys(by).sort()) {
				const v = by[p];
				if (!v || (!v.a && !v.r)) continue;
				out.push({ date, path: p, a: v.a || 0, r: v.r || 0, n: v.n || 0 });
			}
		};
		const dates = Object.keys(h.paths).sort().reverse();
		for (const d of dates) push(d, h.paths[d]);
		if (h.today && h.today.by && Object.keys(h.today.by).length) {
			const today: typeof out = [];
			push(h.today.date, h.today.by);
			// Today belongs at the top with the newest dates.
			while (out.length && out[out.length - 1].date === h.today.date) {
				today.unshift(out[out.length - 1]);
				out.pop();
			}
			return today.concat(out);
		}
		return out;
	},

	historyCompose(this: WordSmith, existing: string) {
		const block = HISTORY_MARK_START + '\n' + this.historyBody() + '\n' + HISTORY_MARK_END;
		const text  = String(existing || '');
		const i = text.indexOf(HISTORY_MARK_START);
		const j = text.indexOf(HISTORY_MARK_END);
		if (i !== -1 && j !== -1 && j > i) {
			return text.slice(0, i) + block + text.slice(j + HISTORY_MARK_END.length);
		}
		if (!text.trim()) return block + '\n';
		return text.replace(/\s*$/, '') + '\n\n' + block + '\n';
	},

	// Tolerant on purpose: a file half-merged by sync, or hand-edited, should
	// give back every row that is still legible rather than nothing at all.
	historyParse(this: WordSmith, text: string) {
		const src  = String(text || '');
		const i    = src.indexOf(HISTORY_MARK_START);
		const j    = src.indexOf(HISTORY_MARK_END);
		const body = (i !== -1 && j > i) ? src.slice(i + HISTORY_MARK_START.length, j) : src;
		const days: Record<string, WsHistoryTally> = {};
		// Three numbers now; files-touched and active-minutes were dropped in
		// 1.29 because nothing displayed them and they were two columns of
		// arithmetic in somebody's note. Files written by 1.26–1.28 carry five,
		// so the two extra are matched and thrown away rather than making the
		// whole row unreadable.
		const ROW = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|/;
		// The by-note row: a date, a path, then three numbers anchored at the
		// end of the line, which is what keeps a path containing a pipe from
		// swallowing a column.
		const PATH_ROW = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|$/;
		const paths: Record<string, Record<string, WsHistoryTally>> = {};
		for (const line of body.split('\n')) {
			const t = line.trim();
			const pm = PATH_ROW.exec(t);
			if (pm) {
				const date = pm[1];
				const p = pm[2].replace(/\\\|/g, '|');
				(paths[date] || (paths[date] = {}))[p] = { a: +pm[3], r: +pm[4], n: +pm[5] };
				continue;
			}
			const m = ROW.exec(t);
			if (!m) continue;
			days[m[1]] = { a: +m[2], r: +m[3], n: +m[4] };
		}
		const keys = Object.keys(days).sort();
		return { started: keys.length ? keys[0] : null, days, paths };
	},

	// ── Writing ─────────────────────────────────────────────────────────────

	async historyWrite(this: WordSmith, force: boolean) {
		if (!this.settings.historyTracking) return false;
		if (!this._historyReady) return false;
		if (this._historyWriting) return false;
		this._historyWriting = true;
		try {
			let file = this.app.vault.getAbstractFileByPath(this._historyPath || '');
			if (!file || !(file instanceof TFile)) file = await this.historyFindFile();
			if (file) {
				this._historyPath = file.path;
				this.orgIndexStoreKnown(file.path);
				// ONE TURN OF THE VAULT. `read` and `modify` each take a turn of the
				// adapter's queue, and the writer saving this very note — it is a note,
				// they can have it open — can take the turn between them: the plugin
				// then writes over what they just typed. `process` reads, composes and
				// writes inside one turn, and writes nothing when the text comes back
				// unchanged.
				await this.app.vault.process(file, (was) => this.historyCompose(String(was)));
				await this.historyMarkSeen();
				return true;
			}
			// ── NEVER MAKE A SECOND ONE ─────────────────────────────────────
			//
			// Reported from a vault: the file was moved, and a second
			// `ws-history.md` appeared beside it. The new one is empty, the old
			// one holds the record, and the plugin then writes to the empty
			// one — which is this store losing a writer's history, the single
			// worst thing in the plugin.
			//
			// `historyFindFile` answering null does NOT mean there is no file.
			// It reads `getMarkdownFiles()`, which is empty until Obsidian has
			// finished indexing, and a write landing in that window scans
			// nothing, finds nothing, and concludes there is nothing there.
			// A move makes it likely because a move is exactly when the
			// remembered path stops working and the scan is consulted.
			//
			// TWO GUARDS, because either alone leaves a hole:
			//
			//   · AN EMPTY VAULT IS NOT AN ANSWER. If there are no markdown
			//     files at all, the index is not ready — a vault with a history
			//     to write has notes in it by definition. Refuse, and let the
			//     next write try again; the record is in memory and nothing is
			//     lost by waiting.
			//   · IF WE HAVE EVER HAD ONE, WE STILL HAVE ONE. `historySeen` is
			//     set the first time a store file is written or found, and it
			//     survives in data.json. Once it is set, a scan that comes back
			//     empty is a scan that failed, not a vault without a history —
			//     so this says so out loud instead of starting a rival.
			let seenAny = [];
			try { seenAny = this.app.vault.getMarkdownFiles() || []; } catch (_) { wsCatch('historyWrite: seenAny = this.app.vault.getMarkdownFiles() || [];', _); }
			if (!seenAny.length) return false;
			if (this.settings.historySeen) {
				new Notice('Word-Smith: could not find ws-history.md, so nothing was '
					+ 'written. It has been moved or renamed \u2014 open it once, or set '
					+ 'its path in Settings, and the record will carry on. A new one '
					+ 'has NOT been made.');
				return false;
			}
			// Nowhere to write yet, and nowhere it could be: make it.
			const path  = this.historyDefaultPath();
			const slash = path.lastIndexOf('/');
			if (slash > 0) {
				const dir = path.slice(0, slash);
				if (!this.app.vault.getAbstractFileByPath(dir)) {
					try { await this.app.vault.createFolder(dir); } catch (_) { wsCatch('historyWrite: await this.app.vault.createFolder(dir);', _); }
				}
			}
			const made = await this.app.vault.create(path, this.historyCompose(''));
			this._historyPath = made ? made.path : path;
			this.orgIndexStoreKnown(this._historyPath);
			await this.historyMarkSeen();
			return true;
		} catch (e) {
			// Losing this write means losing the record, so it is said out
			// loud rather than swallowed the way a cache write would be.
			new Notice('Word-Smith: could not write the writing history \u2014 '
				+ wsErrMsg(e));
			return false;
		} finally {
			this._historyWriting = false;
		}
	},

	async historyClear(this: WordSmith) {
		this._history = null;
		this.settings.historyBaselines = {};
		// A RESET IS THE WRITER'S WORD: "Delete all history" with the file
		// already gone must leave a fresh one, not a notice that none was made.
		// Only when there IS no file — a file that is there is written over, as
		// before, and stays the one record.
		if (!this.app.vault.getAbstractFileByPath(this._historyPath || '')) {
			this.settings.historySeen = false;
		}
		this.historyEnsure();
		// force, or the write cadence can swallow the erase and the next
		// launch reads the old days straight back out of the file.
		await this.historyFlush(true);
	},

	// Notices the store, wherever it turns up. Called from the vault's modify
	// and create events, so moving the file on another device, restoring it
	// from a backup, or hand-editing a row all reach the plugin without the
	// user having to tell it anything.
	//
	// The guard that makes this safe is `_historyWriting`: our own write fires
	// modify on our own file, and re-reading in the middle of writing would
	// race the write and could hand back a half-saved table.
	async historyAdopt(this: WordSmith, file: TAbstractFile) {
		try {
			if (!this.settings.historyTracking || this._historyWriting) return;
			if (!file || !file.path || !/\.md$/i.test(file.path)) return;
			if (!(file instanceof TFile)) return;
			// Something we have unsaved beats something on disk: an external
			// edit is adopted only when there is nothing of our own to lose.
			if (this._historyDirtyAt) return;
			const text = await this.app.vault.cachedRead(file);
			if (!this.historyIsStoreFile(text)) return;
			// A second file carrying the markers is a copy, a conflicted sync
			// duplicate or a backup. Ours stays ours.
			if (this._historyPath && this._historyPath !== file.path) return;
			const parsed = this.historyParse(text);
			const h = this.historyEnsure();
			let gained = 0;
			for (const k of Object.keys(parsed.days)) {
				if (k === h.today.date) continue;
				if (h.days[k]) continue;
				h.days[k] = parsed.days[k];
				// The per-note rows for that day come with it. Merging the
				// totals and dropping these left a day that existed in the
				// chart and in no scoped view — present in the whole vault,
				// absent from every folder and note inside it.
				if (parsed.paths && parsed.paths[k]) h.paths[k] = parsed.paths[k];
				gained++;
			}
			this._historyPath = file.path;
			this.orgIndexStoreKnown(file.path);
			if (!this._historyReady) this._historyReady = true;
			if (gained) {
				const keys = Object.keys(h.days).sort();
				if (keys.length && (!h.started || keys[0] < h.started)) h.started = keys[0];
			}
		} catch { /* unreadable right now; the next event will try again */ }
	},

	// ════════════════════════════════════════════════════════════════════════
	// History tab — the drawing
	// ════════════════════════════════════════════════════════════════════════
	//
	// Three zoom levels answering three different questions. The year grid
	// answers "am I showing up", and streaks appear in it as unbroken runs
	// without anything having to compute them. The month answers "what is my
	// rhythm". The year curve answers "will I finish", which is why it is a
	// cumulative line against a projection and not twelve bars: twelve bars
	// are a scoreboard, the curve is a forecast.
	//
	// Everything is drawn by hand — rects, paths and block glyphs — in the
	// same no-library idiom as the goal gauges, so both Obsidian themes are
	// carried by var() rather than by a palette this file invents.

	// Plain DOM rather than createDiv/createEl throughout, for the reason
	// celebrate() gives: one throw inside a renderer kills the whole view
	// silently, and createElement cannot be broken by a class string.
	historyEl<K extends keyof HTMLElementTagNameMap>(this: WordSmith, tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
		const e = createEl(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		if (parent) parent.appendChild(e);
		return e;
	},

	// A CRUMB'S LABEL, SHORTENED IN THE TEXT ITSELF.
	//
	// The path row asked for this in CSS first — max-width, overflow: hidden,
	// text-overflow: ellipsis, white-space: nowrap, and later min-width: 0 to
	// let a flex item shrink past its content. None of it truncated anything
	// in the running app: a crumb is a <button>, and between Obsidian's own
	// button rules and the flex row it sits in, `text-overflow` is in exactly
	// the corner of the cascade where it quietly does nothing. Two attempts
	// is enough — the string is ours, so the string is what gets cut, and
	// what the writer sees no longer depends on winning an argument with a
	// stylesheet.
	//
	// The ellipsis is one character (…), not three dots: it is what the
	// typography of every other label in this plugin uses, and it costs two
	// fewer columns in a row that is short of them.
	//
	// The FULL name is never lost — every crumb carries its whole path on
	// its title, which is what a shortened label makes more important, not
	// less.
	crumbLabel(this: WordSmith, name: string | null | undefined, max?: number) {
		const s = String(name == null ? '' : name);
		const cap = Math.max(4, max || 18);
		if (s.length <= cap) return s;
		// Cut to cap INCLUDING the ellipsis, so a shortened label is never
		// wider than the limit it was given — the whole point of the limit.
		return s.slice(0, cap - 1).trimEnd() + '\u2026';
	},

	historySvg<K extends keyof SVGElementTagNameMap>(this: WordSmith, tag: K, attrs: Record<string, string | number | undefined> | null, parent: HTMLDivElement|SVGGElement): SVGElementTagNameMap[K] {
		const e = createSvg(tag);
		if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, String(attrs[k]));
		if (parent) parent.appendChild(e);
		return e;
	},

	// ── Buckets ─────────────────────────────────────────────────────────────
	//
	// One function feeds all three tabs. Day, Month and Year are the SAME
	// chart over a different bucket size, which is the whole reason the view
	// reads as one idea rather than three: the bars mean the same thing at
	// every zoom, and only the width of a bar changes.

	historyBuckets(this: WordSmith, view: string, year: number, month: number, scope: string | string[] | undefined) {
		const days = this.historyDays(scope);
		const out: { view: string; buckets: WsHistoryBucket[]; label: string } = { view, buckets: [], label: '' };
		const rightNow = new Date();
		const nowY = rightNow.getFullYear(), nowM = rightNow.getMonth();
		const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

		const blank = (key: string, label: string): WsHistoryBucket =>
			({ key, label, a: 0, r: 0, n: 0, days: 0 });
		const add = (b: WsHistoryBucket, rec: WsHistoryTally | undefined) => {
			if (!rec) return;
			b.a += rec.a || 0; b.r += rec.r || 0; b.n += rec.n || 0;
			if ((rec.a || 0) + (rec.r || 0) > 0) b.days++;
		};

		if (view === 'day') {
			const n = daysIn(year, month);
			out.label = HISTORY_MONTHS[month] + ' ' + year;
			for (let d = 1; d <= n; d++) {
				const dt  = new Date(year, month, d);
				const key = this.historyDateKey(dt);
				const b = blank(key, String(d));
				b.title = HISTORY_DAYNAMES[dt.getDay()] + ' ' + d + ' '
					+ HISTORY_MONTHS[month].slice(0, 3) + ' ' + year;
				add(b, days[key]);
				out.buckets.push(b);
			}
		} else if (view === 'month' || view === 'cal') {
			out.label = String(year);
			for (let m = 0; m < 12; m++) {
				const b = blank(year + '-' + String(m + 1).padStart(2, '0'),
					HISTORY_MONTHS[m].slice(0, 1));
				b.title = HISTORY_MONTHS[m] + ' ' + year;
				b.isNow = (year === nowY && m === nowM);
				for (let d = 1; d <= daysIn(year, m); d++) {
					add(b, days[this.historyDateKey(new Date(year, m, d))]);
				}
				out.buckets.push(b);
			}
		} else {
			// The scope this pass was CALLED with, not a window's state:
			// historyBuckets is a pure reader and knows nothing about the
			// modal. Reaching for `state` here threw the moment the Year tab
			// was drawn, which the render probe caught on its first run.
			const years = this.historyYears(scope);
			out.label = years.length > 1 ? years[0] + '\u2013' + years[years.length - 1] : String(years[0]);
			for (const y of years) {
				const b = blank(String(y), String(y));
				b.title = String(y);
				b.isNow = (y === nowY);
				for (const k of Object.keys(days)) if (+k.slice(0, 4) === y) add(b, days[k]);
				out.buckets.push(b);
			}
		}

		for (const b of out.buckets) {
			if (!b.title) b.title = b.key;
			// A DAILY AVERAGE on anything that gathers days. A month of
			// 40,000 words and a month of 4,000 are obvious from the bar;
			// what the bar cannot say is whether that was a steady 1,300 a
			// day or two enormous weekends, and the average is the shortest
			// answer to it. Over the days actually WRITTEN, not the days in
			// the month: a writer who took three weeks off did not average
			// their work across them.
			const tail = (b.a || 0).toLocaleString() + ' added \u00b7 '
				+ (b.r || 0).toLocaleString() + ' deleted \u00b7 '
				+ (b.n >= 0 ? '+' : '') + (b.n || 0).toLocaleString() + ' net'
				+ (view === 'day' ? '' : ' \u00b7 ' + b.days + ' day' + (b.days === 1 ? '' : 's') + ' written'
					+ (b.days > 0
						? ' \u00b7 ' + Math.round((b.a || 0) / b.days).toLocaleString()
							+ ' a day'
						: ''));
			b.readout = b.title + ' \u00b7 ' + ((b.a || b.r) ? tail : 'nothing written');
			// (No `b.tip`. It floated the same numbers beside the pointer in
			// the OS's own box — a second answer to a question the readout
			// line had already given, in a style belonging to neither the
			// plugin nor the theme, and covering the bars either side of
			// the one being read.)
		}
		return out;
	},

	// ── The tab ─────────────────────────────────────────────────────────────

	// Subsequence matching, ranked. Not a substring search: a writer who
	// types "ch3scene" should find "My Book/Part One/Ch 03/Scene 2.md", and a
	// substring match finds nothing there at all.
	//
	// The score rewards the two things that separate a match you meant from a
	// match that merely contains the right letters, in this order: how much of
	// the query landed in one unbroken run, and how close to the START of a
	// path segment it began. That is why typing "scene" ranks the scene files
	// above a folder that happens to contain those letters mid-word.
	historyFuzzy(this: WordSmith, query: string, candidates: string[]) {
		const q = String(query || '').toLowerCase().replace(/\s+/g, '');
		if (!q) return [];
		const out = [];
		for (const path of candidates) {
			const lower = path.toLowerCase();
			let qi = 0, score = 0, run = 0, last = -2;
			for (let i = 0; i < lower.length && qi < q.length; i++) {
				if (lower[i] !== q[qi]) continue;
				run = (i === last + 1) ? run + 1 : 0;
				// A character right after a separator, or at the very start,
				// is the beginning of a word a person was aiming at.
				const boundary = i === 0 || lower[i - 1] === '/' || lower[i - 1] === ' '
					|| lower[i - 1] === '-' || lower[i - 1] === '_';
				score += 1 + run * 3 + (boundary ? 6 : 0);
				last = i;
				qi++;
			}
			if (qi < q.length) continue;
			// Did the match END on a word boundary as well as start on one?
			// This is what separates "Scene 2.md" from "old-scenery-notes.md"
			// when the query is "scene": both contain the letters contiguously
			// after a boundary, so without this the shorter path wins on the
			// length penalty alone and the writer's actual scene files rank
			// below an archived note. A query that consumes a whole word was
			// almost certainly aimed at that word.
			const after = lower[last + 1];
			if (after === undefined || after === '/' || after === ' '
				|| after === '-' || after === '_' || after === '.') score += 8;
			// A shorter path that matched is a tighter match than a long one
			// that happened to have the letters spread through it.
			score -= lower.length * 0.05;
			out.push({ path, score });
		}
		out.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
		return out;
	},

	// Folders first when they score alike: picking a folder is the broader
	// question, and it is the one a writer usually wants from a short query.
	historyFinderMatches(this: WordSmith, query: string, limit: number) {
		const known = this.historyKnownPaths();
		const tag = (list: string[], kind: string) => this.historyFuzzy(query, list)
			.map(m => ({ path: m.path, score: m.score + (kind === 'folder' ? 1.5 : 0), kind }));
		const all = tag(known.folders, 'folder').concat(tag(known.files, 'file'));
		all.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
		return all.slice(0, limit || 8);
	},

	// ── The modal ───────────────────────────────────────────────────────────
	//
	// Its own window rather than a third tab in the report. Three reasons, and
	// the first is the one that decided it: the report is 460px because eight
	// figures and a gauge is all it has to say about one file, and a month of
	// day bars needs three times that to be readable at all. The second is
	// that the report is about the text in front of you and asks for a file;
	// the history is about a span of months and asks for nothing. The third is
	// that the zoom tabs and the report's own tabs were two rows of tabs
	// stacked on each other, which reads as one confused control.

	// This month if you have written in it, otherwise the most recent month
	// you did. Opening on a blank current month — the 1st, or after a fallow
	// spell — puts an empty chart in front of someone whose record is full,
	// and an empty chart reads as a broken feature rather than as a quiet
	// week. The period label always says which month is on screen, so this
	// cannot mislead anyone about what they are looking at.
	historyOpeningPeriod(this: WordSmith, scope?: string | string[]) {
		const now = new Date();
		const state = { year: now.getFullYear(), month: now.getMonth() };
		const days = this.historyDays(scope);
		const keys = Object.keys(days).sort();
		if (!keys.length) return state;
		const here = state.year + '-' + String(state.month + 1).padStart(2, '0');
		if (keys.some(k => k.slice(0, 7) === here)) return state;
		const last = keys[keys.length - 1];
		return { year: +last.slice(0, 4), month: +last.slice(5, 7) - 1 };
	},

	// ── THE HISTORY WINDOW IS THE HISTORY TAB ───────────────────────────────
	//
	// A WRAPPER, NOT A DELETION: the Manuscript window's History tab is the
	// history (a tree beside the record). The name is on a palette command,
	// a bar token, a settings button and a menu row, and a name that
	// disappears takes a writer's hotkey with it.
	openHistoryModal(this: WordSmith) {
		return this.orgOpenTab('history');
	},

	renderHistoryTab(this: WordSmith, body: HTMLElement, state: WsHistoryTabState, rerender: () => void) {
		const s = this.settings;
		state.rerender = rerender;
		// The window seeds these, but the renderer is reachable from anywhere
		// and must not throw on a state that predates them. Same repair-in-
		// place idiom as historySeriesOn().
		//
		// A LIST IS A SCOPE TOO now — the unified window's tree hands this
		// every path it has lit — so the repair only fires on something that
		// is neither.
		if (typeof state.scope !== 'string' && !Array.isArray(state.scope)) state.scope = '';
		if (typeof state.query !== 'string') state.query = '';
		// Nulled at the TOP of every render, not only where the stepper is
		// built: several paths return early (tracking off, empty history),
		// and the arrow keys must not keep driving a stepper from a render
		// that is no longer on screen.
		state.shiftPeriod = null;

		// ── A DEAD END THAT ANSWERS "WHAT DO I DO NOW" ───────────
		//
		// Every dead end answers the question in one tap rather than pointing
		// at a settings pane. `historyTracking` gates the LOAD as well as the
		// write, and it defaults to false — so a vault that lost data.json
		// shows this over an intact `ws-history.md`: nothing is destroyed and
		// everything looks it. The button READS that file rather than starting
		// a new one, which is why it says so.
		if (!s.historyTracking) {
			const off = this.historyEl('div', 'ws-report-ring-label is-muted', body);
			this.historyEl('div', '', off, 'You\u2019re not tracking your writing yet.');
			const act = this.historyEl('div', 'ws-hist-empty-act', off);
			const go = this.historyEl('button', 'mod-cta', act,
				'Start counting');
			const hint = this.historyEl('div', 'ws-report-hint', off,
				'Counts only \u2014 never your words, and never backwards. You can '
				+ 'switch it off again in Settings.');
			// AND IF THERE IS ALREADY A RECORD, SAY SO. Asked after the
			// button is drawn, never before: a render that waits on a vault
			// read is a pane that is blank while it waits, and the answer
			// only ever ADDS a line. `historyFindFile` is the same reader
			// the load uses, so it cannot disagree with what happens next.
			try {
				this.historyFindFile().then((f) => {
					if (!f || !hint.isConnected) return;
					hint.textContent = 'Your record is still in ' + f.path
						+ ' \u2014 switching this on reads it back.';
				}).catch(() => {});
			} catch (_) { wsCatch('renderHistoryTab: this.historyFindFile().then((f) =>', _); }
			go.addEventListener('click', () => { void (async () => {
					// DISABLED WHILE IT WORKS. Finding and writing the file is a
					// vault round trip, and a second press mid-flight would run
					// the whole act again over a half-made record.
					if (go.disabled) return;
					go.disabled = true;
					go.textContent = 'Starting\u2026';
					try { await this.historyTrackingOn(); } catch (_) { wsCatch('renderHistoryTab: await this.historyTrackingOn();', _); }
					if (rerender) rerender();
				})();
});
			return;
		}

		const h    = this.historyEnsure();
		const figs = this.historyFigures('net', state.scope);

		// The view and the series live in settings, not in the modal's state:
		// closing the report and opening it again should show you the thing
		// you were looking at, not the thing the code prefers.
		const view = ['day', 'month', 'year', 'cal'].indexOf(s.historyView) !== -1 ? s.historyView : 'day';
		const ser  = this.historySeriesOn();

		const years = this.historyYears(state.scope);
		if (years.indexOf(state.year) === -1) state.year = years[years.length - 1];

		// ── "COUNTING SINCE" IS A FOOTNOTE NOW ──────────────────────────────
		//
		// The qualification — what the figures cannot include — is a starred
		// footnote at the foot, read when a reader doubts a number; the zoom
		// tabs, which ARE navigation, take the top.
		let sinceFoot = null;
		if (s.historyView !== 'cal') {
			sinceFoot = this.historyEl('div', 'ws-report-scope ws-hist-sincefoot',
				body, h.started
					? '* Counting since ' + this.historyLongDate(h.started)
					: '* Starts counting the next time you write');
		}
		// MOVED, NOT BUILT LAST. Several paths below return early — no
		// tracking, an empty record — and a footnote appended at the end of
		// the method would be missing from exactly the states that need it
		// most, where the reader is looking at nothing and wondering why.
		const placeFoot = () => { if (sinceFoot) body.appendChild(sinceFoot); };
		// WHERE THE TOP OF OUR CONTENT IS. Held so the zoom row can be put
		// there; see the move at the end of this method.
		let topAnchor = sinceFoot;

		// ── Figures ─────────────────────────────────────────────────────────
		// ── The finder ──────────────────────────────────────────────────────
		// Above the figures, because it changes what every one of them says.
		//
		// NOT IN THE CALENDAR. A year of days has to be seen at once, and
		// the search box and the scope path together are four rows of
		// height that the grid needs more. Both are one tab away, and the
		// scope they set is REMEMBERED — switch to Calendar with a folder
		// picked and the calendar is that folder's; go back to change it.
		//
		// …AND NOT WHERE SOMETHING ELSE IS ALREADY THE NAVIGATOR. In the
		// unified window the TREE says where you are and takes you
		// somewhere else, and a finder and a crumb chain beside it would be
		// the second and third answers to a question already answered —
		// which is the exact fault four scope controls were merged to fix.
		// `hideScope` is that caller saying "I own this axis".
		const calOnly = s.historyView === 'cal' || !!state.hideScope;
		const find = this.historyEl('div',
			'ws-hist-find' + (calOnly ? ' ws-is-hidden' : ''), body);
		if (!topAnchor) topAnchor = find;
		const row  = this.historyEl('div', 'ws-hist-findrow', find);

		// Built, not merely hidden, when this window owns the axis. A chip
		// whose name is a LIST of paths reads as one path with commas in it,
		// and a clear button behind `display: none` is still in the DOM for
		// a probe to find and a screen reader to announce.
		if (state.hideScope) {
			// nothing: the tree beside this panel is the navigator
		} else if (state.scope) {
			const chip = this.historyEl('div', 'ws-hist-chip', row);
			this.historyEl('span', 'ws-hist-chipname', chip, Array.isArray(state.scope) ? state.scope.join(', ') : state.scope);
			const clear = this.historyEl('button', 'ws-hist-chipx', chip, '\u00d7');
			clear.setAttribute('aria-label', 'Show the whole vault again');
			clear.addEventListener('click', () => {
				state.scope = ''; state.query = '';
				Object.assign(state, this.historyOpeningPeriod());
				rerender();
			});
		} else {
			const input = this.historyEl('input', 'ws-hist-search', row);
			input.setAttribute('type', 'text');
			input.setAttribute('placeholder', 'Search a note or folder\u2026');
			input.value = state.query || '';
			const list = this.historyEl('div', 'ws-hist-hits', find);

			// One choosing hand or the other — same as the report's finder.
			// ↑/↓ move a highlight through the hits, Enter takes the
			// highlighted one, the pointer moves the same highlight. The
			// keys act on the hits on SCREEN, kept by paint(); Enter used
			// to re-query with a limit of 1, which could rank differently
			// from the list being shown and scope to a row the writer was
			// not looking at.
			const pick = (hit: { path: string; score?: number; kind?: string }) => {
				state.scope = hit.path;
				state.query = '';
				Object.assign(state, this.historyOpeningPeriod(hit.path));
				state.scope = hit.path;
				rerender();
			};
			let hits: { path: string; score: number; kind: string }[] = [], rows: HTMLButtonElement[] = [], sel = 0;
			const mark = () => {
				rows.forEach((r, i2) => r.classList.toggle('is-selected', i2 === sel));
				if (rows[sel] && typeof rows[sel].scrollIntoView === 'function') {
					rows[sel].scrollIntoView({ block: 'nearest' });
				}
			};
			const paint = () => {
				list.textContent = '';
				rows = []; hits = [];
				const q = state.query.trim();
				if (!q) return;
				hits = this.historyFinderMatches(q, 8);
				if (!hits.length) {
					this.historyEl('div', 'ws-hist-nohit', list, 'Nothing by that name.');
					return;
				}
				sel = Math.max(0, Math.min(sel, hits.length - 1));
				hits.forEach((hit, i2) => {
					const b = this.historyEl('button', 'ws-hist-hit-' + hit.kind + ' ws-hist-hitrow', list);
					this.historyEl('span', 'ws-hist-hitkind', b, hit.kind === 'folder' ? 'folder' : 'note');
					this.historyEl('span', 'ws-hist-hitpath', b, hit.path);
					b.addEventListener('click', () => pick(hit));
					b.addEventListener('mouseenter', () => { sel = i2; mark(); });
					rows.push(b);
				});
				mark();
			};

			input.addEventListener('input', () => { state.query = input.value; sel = 0; paint(); });
			input.addEventListener('keydown', (e) => {
				if (e.key === 'ArrowDown' && hits.length) {
					sel = Math.min(sel + 1, hits.length - 1);
					mark();
					e.preventDefault();
					return;
				}
				if (e.key === 'ArrowUp' && hits.length) {
					sel = Math.max(sel - 1, 0);
					mark();
					e.preventDefault();
					return;
				}
				if (e.key === 'Escape') { state.query = ''; input.value = ''; paint(); return; }
				if (e.key !== 'Enter') return;
				if (hits.length) pick(hits[Math.max(0, Math.min(sel, hits.length - 1))]);
			});
			paint();
		}

		// ── The path, under the search ──────────────────────────────────────
		// The same clickable chain the report wears in the same place — one
		// idiom across both windows. 01.Preface.md ‹ Chapter ‹ Book ‹ Vault:
		// each crumb SCOPES the whole history to itself, the lit crumb says
		// what every figure and bar below is counting, and Vault (scope
		// nothing) is lit when the record is unfiltered. A scope picked in
		// the finder that lives outside this chain shows in the chip above
		// instead, with no crumb lit — the chain is the open note's, not a
		// map of the vault.
		if (!calOnly) {
			const noteF = this.activeNoteFile();
			const chain = [];
			if (noteF && noteF.path) {
				const cut0 = noteF.path.lastIndexOf('/');
				let cur = cut0 > 0 ? noteF.path.slice(0, cut0) : '';
				while (cur) {
					chain.push(cur);
					const cut = cur.lastIndexOf('/');
					cur = cut > 0 ? cur.slice(0, cut) : '';
				}
			}
			const crumbs = this.historyEl('div', 'ws-report-crumbs', body);
			let first = true;
			const crumb = (label: string, scopePath: string, title: string, extra?: string) => {
				if (!first) this.historyEl('span', 'ws-crumb-sep', crumbs, '\u2039');
				first = false;
				const btn = this.historyEl('button',
					'ws-crumb' + (extra || '')
					+ (state.scope === scopePath ? ' is-active' : ''), crumbs,
					this.crumbLabel(label));
				btn.setAttribute('title', title);
				btn.addEventListener('click', () => {
					// The lit crumb stays inert HERE, unlike the report's.
					// There the press re-pours a jar, which is what somebody
					// pressing it again wants to see; here it would rebuild
					// a chart that looks identical and, worse, reset the
					// period you had stepped to. Doing nothing is the
					// kinder answer when there is nothing to show.
					if (state.scope === scopePath) return;
					state.scope = scopePath;
					state.query = '';
					Object.assign(state, this.historyOpeningPeriod(scopePath || undefined));
					state.scope = scopePath;
					rerender();
				});
			};
			if (noteF && noteF.path) {
				crumb(noteF.path.split('/').pop() || '', noteF.path, noteF.path, ' ws-crumb-note');
			}
			for (const p of chain) crumb(p.split('/').pop() || '', p, p);
			crumb('Vault', '', this.vaultWhole() + ' \u2014 everything the record holds');
		}

		// A record that started before the per-note detail did has days that
		// cannot be attributed to anything. Saying so is the difference
		// between an honest chart and one that looks like you stopped writing.
		//
		// An EMPTY LIST is not a scope, and an empty array is truthy — so the
		// test asks what the scope covers rather than whether there is one.
		const scoped = Array.isArray(state.scope) ? state.scope.length > 0 : !!state.scope;
		if (scoped) {
			const all = Object.keys(this.historyDays()).length;
			const attributed = Object.keys(this.historyDays(state.scope)).length;
			const h = this.historyEnsure();
			const detail = Object.keys(h.paths).length + (Object.keys(h.today.by).length ? 1 : 0);
			if (all > detail) {
				this.historyEl('div', 'ws-hist-partial', body,
					(all - detail) + ' earlier day' + (all - detail === 1 ? '' : 's')
					+ ' were recorded before Word-Smith started noting which note you were in, '
					+ 'so they cannot be shown per note. They are still in the whole-vault view.');
				void attributed;
			}
		}

		// ── Figures — they answer the VIEW ──────────────────────────────────
		// The four numbers used to be lifetime figures whatever the chart
		// showed: you could be looking at March while "Daily average"
		// described your whole writing life. Each zoom now gets the four
		// questions a person AT that zoom is asking. The buckets are read
		// first because the figures are computed from exactly what the
		// chart will draw — the two can never disagree.
		//   Daily   — this month: net, daily average, best day, active days
		//   Monthly — this year: net, monthly average, best month BY NAME,
		//             months active
		//   Yearly  — the whole record: net, yearly average, best year, years
		//             active
		// …and the STREAK on all three, as the fifth. It is the figure a
		// writer checks most and it lived on the Yearly view alone, where
		// most people never saw it. It belongs to no one period, which is
		// exactly why it can sit under every one of them unchanged.
		// Averages stay averaged over the periods you actually WROTE in,
		// never the calendar — the same promise the lifetime average made.
		// The calendar shows a YEAR of days, so its figures and its stepper
		// are the Monthly view's — the same twelve months, counted rather
		// than drawn.
		const dataView = view === 'cal' ? 'month' : view;
		const data = this.historyBuckets(dataView, state.year, state.month, state.scope);
		// THE FIGURES STAND DOWN FOR THE CALENDAR. A year of days is 365
		// squares and it has to be seen at once — a calendar you scroll is
		// a calendar with half its answer off screen. The five figures are
		// the same year counted, and they are one tab away on Monthly, so
		// giving their two rows of height to the grid costs nothing that
		// cannot be had by clicking once.
		const showFigs = view !== 'cal';
		const grid = this.historyEl('div',
			'ws-report-grid ws-history-grid' + (showFigs ? '' : ' ws-is-hidden'), body);
		const cell = (label: string, value: string, tip: string) => {
			if (!showFigs) return;
			const c = this.historyEl('div', 'ws-report-cell has-tip', grid);
			c.setAttribute('title', tip);
			this.historyEl('div', 'ws-report-value', c, value);
			this.historyEl('div', 'ws-report-label', c, label);
		};
		const signed = (n: number) => (n > 0 ? '+' : '') + n.toLocaleString();
		const activeB = data.buckets.filter(b => (b.a || 0) + (b.r || 0) > 0);
		const netSum  = data.buckets.reduce((a, b) => a + (b.n || 0), 0);
		const bestB   = activeB.reduce<WsHistoryBucket | null>((m, b) => (!m || (b.n || 0) > (m.n || 0) ? b : m), null);
		// THE FIFTH FIGURE, shared by all three views because it belongs to
		// no one period. Written once and used three times: it said the
		// same thing in three places before, which is three places to
		// forget when the wording changes.
		const streakTip = 'Days in a row you wrote or edited \u2014 cutting counts. '
			+ 'A missed day resets it; today doesn\u2019t count until it\u2019s over. '
			+ 'Best run: ' + figs.longest.toLocaleString() + '.';

		if (view === 'day') {
			cell('Words, net', signed(netSum),
				'In ' + data.label + ' \u2014 what you wrote minus what you cut.');
			cell('Daily average', (activeB.length ? Math.round(netSum / activeB.length) : 0).toLocaleString(),
				'Over the ' + activeB.length + ' day' + (activeB.length === 1 ? '' : 's')
				+ ' you wrote \u2014 days off don\u2019t drag it down. All-time: '
				+ figs.average.toLocaleString() + '.');
			cell('Best day', (bestB ? (bestB.n || 0) : 0).toLocaleString(),
				bestB ? 'The best single day in ' + data.label + ' \u2014 '
					+ (bestB.title || bestB.key) + '. All-time: '
					+ figs.best.toLocaleString() + '.'
					: 'Nothing here yet.');
			cell('Active days', activeB.length + ' of ' + data.buckets.length,
				'Days in ' + data.label + ' you wrote or edited \u2014 cutting counts.');
			cell('Streak', figs.current.toLocaleString()
				+ (figs.current === 1 ? ' day' : ' days'), streakTip);
		} else if (view === 'month') {
			const bestName = bestB && bestB.title ? bestB.title.split(' ')[0].slice(0, 3) : '';
			cell('Words, net', signed(netSum),
				'In ' + data.label + ' \u2014 what you wrote minus what you cut.');
			cell('Monthly average', (activeB.length ? Math.round(netSum / activeB.length) : 0).toLocaleString(),
				'Over the ' + activeB.length + ' month' + (activeB.length === 1 ? '' : 's')
				+ ' of ' + data.label + ' you wrote in.');
			cell(bestB ? 'Best month \u00b7 ' + bestName : 'Best month',
				(bestB ? (bestB.n || 0) : 0).toLocaleString(),
				bestB ? 'The best month of ' + data.label + ' \u2014 ' + (bestB.title || '') + '.'
					: 'Nothing here yet.');
			cell('Months active', activeB.length + ' of 12',
				'Months of ' + data.label + ' you wrote in.');
			cell('Streak', figs.current.toLocaleString()
				+ (figs.current === 1 ? ' day' : ' days'), streakTip);
		} else {
			const bestName = bestB ? (bestB.label || bestB.key) : '';
			cell('Words, net', signed(figs.total),
				'Everything written, minus everything cut.');
			cell('Yearly average', (activeB.length ? Math.round(netSum / activeB.length) : 0).toLocaleString(),
				'Over the ' + activeB.length + ' year' + (activeB.length === 1 ? '' : 's')
				+ ' you wrote in.');
			cell(bestB ? 'Best year \u00b7 ' + bestName : 'Best year',
				(bestB ? (bestB.n || 0) : 0).toLocaleString(),
				// THE DATE READS AS A DATE. This one tip printed the raw
				// store key — "2026-05-13" — while every other date in the
				// window goes through historyLongDate. It is the only
				// place in the report a reader is shown the file format.
				bestB ? 'Your best year. Best single day: ' + figs.best.toLocaleString()
					+ (figs.bestKey ? ', on ' + this.historyLongDate(figs.bestKey) : '') + '.'
					: 'Nothing here yet.');
			cell('Years active', activeB.length.toLocaleString(),
				'Years you wrote in.');
			cell('Streak', figs.current.toLocaleString()
				+ (figs.current === 1 ? ' day' : ' days'), streakTip);
		}

		if (!figs.keys.length) {
			const empty = this.historyEl('div', 'ws-report-ring-label is-muted ws-hist-empty', body);
			this.historyEl('div', '', empty, 'Nothing here yet.');
			this.historyEl('div', 'ws-report-hint', empty,
				'The chart fills in as you write. There\u2019s no way to go back and work out what '
				+ 'you did before today \u2014 a file only knows when it was touched, not how much '
				+ 'went into it.');
			placeFoot();
			return;
		}

		// ── Daily | Monthly | Yearly ────────────────────────────────────────
		// DIRECTLY UNDER "counting since", above everything it changes.
		//
		// `data` is read with the figures so the two can never disagree;
		// building the row up there would either duplicate that read or
		// reorder half the method. The move is one insertBefore against a
		// remembered anchor, and a test asserts the ORDER of `body`'s children.
		//
		// The tab row's own clearance is in the stylesheet. In the calendar
		// there is nothing above it — the figures, the search and the path
		// have all stood down — so `ws-is-top` drops the gap and the grid
		// gets the height.
		const sub = this.historyEl('div',
			'ws-tab-nav ws-hist-subnav' + (view === 'cal' ? ' ws-is-top' : ''), body);
		const tab = (id: string, label: string) => {
			const b = this.historyEl('button',
				'ws-tab-btn ws-hist-subbtn' + (view === id ? ' is-active' : ''), sub, label);
			b.addEventListener('click', () => {
				if (view === id) return;
				s.historyView = id;
				// NO SAVE. The view is session-only: a `saveSettings()` here would
				// write the whole file and none of this click — the strip in
				// `wsForDisk` sees to that.
				rerender();
			});
		};
		tab('day', 'Daily'); tab('month', 'Monthly'); tab('year', 'Yearly');
		// A FOURTH ZOOM, and it is a zoom: the same daily record the first
		// tab draws as a run of bars, arranged by month and weekday
		// instead. A bar run answers "how much, when"; a calendar answers
		// "which days" — the shape of a habit rather than its size.
		tab('cal', 'Calendar');

		// ── Period stepper — BESIDE the Yearly tab ──────────────────────────
		// It sat at the far end of the row with the label BETWEEN the
		// arrows — so as "March 2026" stepped to "September 2026" the
		// label's width changed and both arrows lurched sideways under
		// the pointer. Two fixes in one move: the group is anchored right
		// after the Yearly tab (no margin-left: auto), and the label
		// comes AFTER the pair — ‹ › August 2026 — so however long the
		// month's name, the buttons never move.
		const step = this.historyEl('span', 'ws-hist-step', sub);
		// The window's arrow keys drive the same shift the buttons do — the
		// handler lives on the modal (see openHistoryModal), which reads
		// whatever the CURRENT render put here. Nulled first, so the Yearly
		// view (which has nothing to step) leaves the keys inert rather
		// than stepping a control that is not on screen.
		state.shiftPeriod = null;
		if (view !== 'year') {
			// ── CHEVRONS, LIKE THE ORGANIZER'S ─────────────────────
			//
			// The Organizer draws its chevron with `setIcon` and keeps a text glyph
			// only as a fallback; two panes must not draw one idea in two alphabets
			// — a typographic character beside real line art. TRIED AND CHECKED,
			// and the name is RECORDED on the element: `setIcon` with a name this
			// build's Lucide does not know leaves the element EMPTY instead of
			// throwing, so the glyph stays as the fallback and `data-icon` says
			// WHICH name was asked for.
			const stepArrow = (glyph: string, names: string[]) => {
				const b = this.historyEl('button', 'ws-tab-btn ws-hist-arrow', step);
				for (const nm of names) {
					b.textContent = '';
					try { if (setIcon) setIcon(b, nm); } catch (_) { wsCatch('renderHistoryTab / stepArrow: if (setIcon) setIcon(b, nm);', _); }
					if (b.childElementCount > 0) { b.dataset.icon = nm; return b; }
				}
				b.dataset.icon = names[0];
				b.setText(glyph);
				return b;
			};
			const back = stepArrow('\u2039', ['chevron-left']);
			const fwd  = stepArrow('\u203a', ['chevron-right']);
			this.historyEl('span', 'ws-hist-period', step, data.label);
			// One stepper, two meanings: months inside a year on the Day tab,
			// years on the Month tab. Stepping off the end of a year rolls
			// into the next rather than stopping, because a manuscript does
			// not stop at 31 December.
			const shift = (dir: number) => {
				if (view === 'day') {
					let m = state.month + dir, y = state.year;
					if (m < 0)  { m = 11; y--; }
					if (m > 11) { m = 0;  y++; }
					if (years.indexOf(y) === -1) return;
					state.year = y; state.month = m;
				} else {
					const i = years.indexOf(state.year) + dir;
					if (i < 0 || i >= years.length) return;
					state.year = years[i];
				}
				rerender();
			};
			state.shiftPeriod = shift;
			const atStart = view === 'day'
				? (state.year === years[0] && state.month === 0)
				: state.year === years[0];
			const atEnd = view === 'day'
				? (state.year === years[years.length - 1] && state.month === 11)
				: state.year === years[years.length - 1];
			if (atStart) back.setAttribute('disabled', 'true');
			if (atEnd)   fwd.setAttribute('disabled', 'true');
			back.addEventListener('click', () => shift(-1));
			fwd .addEventListener('click', () => shift(1));
		} else {
			// Nothing to step — every year is already on the chart — but
			// the label still says what the chart covers, in the same
			// place the other views say it.
			this.historyEl('span', 'ws-hist-period', step, data.label);
		}

		// ── …and the whole row goes to the TOP ──────────────────────────────
		//
		// It was anchored under the counting-since rule; that line is a
		// footnote now, so the anchor is the first thing this render put in
		// `body` instead. NOT `body.firstChild` — the unified window hands
		// this a panel that already has things in it, and inserting before
		// somebody else's element would put the tabs above the tree's own
		// heading.
		if (topAnchor && topAnchor.parentNode === body) {
			body.insertBefore(sub, topAnchor);
		}

		// ── The calendar takes over from here ───────────────────────────────
		// It has its own legend (one metric, not three) and its own body, so
		// it returns rather than falling through to the chart's.
		if (view === 'cal') {
			this.buildHistoryCalendar(body, state, rerender);
			placeFoot();
			return;
		}

		// ── THE CHART, THEN ITS KEY ─────────────────────────────────────
		//
		// The series switches are a clickable legend under the chart (swatch +
		// name, dimmed when off), not top-level buttons — a key above the thing
		// it keys reads as a row of buttons. The build order IS the position:
		// both append to `body`. The swatch takes the step the BARS use
		// (`--ws-hist-add` is `var(--ws-add-5)`).
		this.buildHistoryChart(body, data, ser);

		// ── Series toggles, under the chart they key ────────────────────
		const legend = this.historyEl('div', 'ws-hist-series is-underchart', body);
		const pill = (id: string, label: string, tip: string) => {
			const b = this.historyEl('button',
				'ws-hist-pill is-' + id + (ser[id] ? ' is-on' : ''), legend);
			this.historyEl('span', 'ws-hist-swatch', b);
			this.historyEl('span', '', b, label);
			b.setAttribute('title', tip);
			b.addEventListener('click', () => {
				const next: Record<string, boolean> = Object.assign({}, ser);
				next[id] = !next[id];
				// Turning the last one off leaves an empty box that reads as a
				// broken chart, so the last one on cannot be turned off.
				if (!next.added && !next.removed && !next.net) return;
				s.historySeries = next;
				// NO SAVE. Which series are drawn is session-only: a `saveSettings()`
				// here would write the whole file and none of this click — the strip
				// in `wsForDisk` sees to that.
				rerender();
			});
		};
		pill('added',   'Added',   'What you wrote, going up from the line.');
		pill('removed', 'Deleted', 'What you cut, going down from the same line \u2014 so a hard '
			+ 'day of editing shows up as work instead of a gap.');
		pill('net',     'Net',     'What\u2019s left after the cutting, laid over the bars.');
		pill('average', 'Average', 'A flat line at your average, counting only the days you wrote.');
		placeFoot();

	},

	// Which series are drawn. Defaulted here rather than in DEFAULT_SETTINGS
	// so a vault upgrading from 1.26 — which had no such key — gets a sensible
	// chart instead of an empty one.
	historySeriesOn(this: WordSmith) {
		const raw = this.settings.historySeries;
		// (`goal: true` stood in this default. A stored `historySeries`
		// carrying the key is harmless: the reader below only copies keys
		// this object names.)
		const def: Record<string, boolean> = { added: true, removed: true, net: false, average: false };
		if (!raw || typeof raw !== 'object') return def;
		const out: Record<string, boolean> = {};
		const bag = raw as Record<string, unknown>;
		for (const k of Object.keys(def)) { const b = bag[k]; out[k] = typeof b === 'boolean' ? b : def[k]; }
		if (!out.added && !out.removed && !out.net) out.added = true;
		return out;
	},

	// ── The chart ───────────────────────────────────────────────────────────
	//
	// One chart, three bucket sizes, drawn on a pixel grid: every bar is a
	// stack of whole blocks and every line is a run of whole blocks, so the
	// panel matches the ink tank and the goal gauges rather than looking like
	// a dashboard that wandered in from another application.
	//
	// Added rises from the centre line and deleted falls from it — the same
	// line, not two charts stacked. That is the point of the pairing: a week
	// of hard cutting has bars, and reads as work.
	//
	// What makes it legible rather than merely decorative, in order of how
	// much each one earns:
	//
	//   A SCALE. Until 1.28 there was none, and a bar could be 300 words or
	//   3,000 with nothing on screen to tell you which — the chart looked like
	//   data without carrying any. Gridlines at round numbers, labelled.
	//   ZERO STUBS. A day you did not write draws one faint block on the axis,
	//   so a gap is a visible absence rather than a hole where the eye cannot
	//   tell chart from margin.
	//   CAPPED BARS. The top block of every bar is lighter. That is the whole
	//   difference between a flat rectangle and something that reads as drawn.
	//   A READOUT rather than a native tooltip, which arrives after a second,
	//   in the system font, in the wrong place.

	// Round numbers a person actually thinks in: 1, 2, 2.5, 5, 10 and their
	// decades. A gridline at 3,847 is arithmetic, not a scale.
	historyNiceStep(this: WordSmith, rough: number) {
		if (!(rough > 0)) return 1;
		const mag  = Math.pow(10, Math.floor(Math.log10(rough)));
		const norm = rough / mag;
		const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
		return step * mag;
	},

	historyShortNum(this: WordSmith, v: number) {
		const a = Math.abs(v);
		if (a >= 1000000) return (v / 1000000).toFixed(a % 1000000 ? 1 : 0) + 'M';
		if (a >= 1000)    return (v / 1000).toFixed(a % 1000 && a < 10000 ? 1 : 0) + 'k';
		return String(Math.round(v));
	},

	// ════════════════════════════════════════════════════════════════════════
	// THE CALENDAR
	// ════════════════════════════════════════════════════════════════════════
	//
	// A year of days as twelve small months, each cell shaded by how much
	// that day gained or lost. The bar chart answers "how much, and when";
	// this answers "WHICH DAYS" — and the two are the same record, so a
	// writer can move between them without learning a second vocabulary.
	//
	// ONE METRIC AT A TIME, and that is forced rather than chosen: a bar has
	// room for three series stacked around an axis, a calendar cell has one
	// colour. So the legend here is a PICKER, not the chart's set of
	// toggles — three buttons of which exactly one is lit.
	//
	// THE SCALE IS A PERCENTILE, NOT THE MAXIMUM. One 9,000-word day in a
	// year of 400-word days would, against the maximum, paint every other
	// day the palest step and the year would read as empty. The 90th
	// percentile of active days is the top of the ramp and anything above it
	// simply saturates, so the ordinary days are the ones the shading is
	// spent on.
	buildHistoryCalendar(this: WordSmith, host: HTMLElement, state: WsHistoryTabState, rerender: () => void) {
		const s = this.settings;
		const year = state.year;
		const days = this.historyDays(state.scope);
		const metric = ['added', 'removed', 'net'].indexOf(s.historyCalMetric) !== -1
			? s.historyCalMetric : 'net';

		const valueOf = (rec: WsHistoryTally) => {
			if (!rec) return 0;
			if (metric === 'added')   return rec.a || 0;
			if (metric === 'removed') return rec.r || 0;
			return rec.n || 0;
		};
		const key = (y: number, m: number, d: number) => this.historyDateKey(new Date(y, m, d));

		// ── The readout, ABOVE the grid ─────────────────────────────────────
		// A hovered day says what it was here rather than in a tooltip: the
		// grid is 365 small squares and a tooltip over one of them is a
		// thing you must hold still to read. One line, always in the same
		// place, so the eye can stay on the calendar and the words change
		// underneath it.
		const read = this.historyEl('div', 'ws-cal-read', host);
		const readDay = this.historyEl('span', 'ws-cal-read-day', read);
		const readFig = this.historyEl('span', 'ws-cal-read-fig', read);
		// ONE WRITER FOR THE FIGURE. The year line and the day line say the
		// same three things in the same words, because they are the same
		// record at two scales — a writer should not have to learn the row
		// twice. THE SIGN IS WRITTEN, NOT LEFT TO THE FORMATTER: the cut wears
		// a typographic minus and `toLocaleString` would give the net a hyphen,
		// so the magnitude is formatted and the sign is put in front of it, and
		// all three figures are punctuated by the same hand.
		const signed = (v: number) => (v < 0 ? '\u2212' : '+') + Math.abs(v).toLocaleString();
		const figOf = (a: number, r: number, n: number) => '+' + a.toLocaleString() + ' added \u00b7 \u2212'
			+ r.toLocaleString() + ' cut \u00b7 ' + signed(n) + ' net';

		// ── AT REST THE ROW HOLDS THE YEAR ────────────────────────────────
		//
		// Every other view in this tab answers its own question before it is
		// touched; a row that says "hover a day" until you move the mouse is a
		// row that is off while you read the picture — the grid already teaches
		// that by being hoverable. The totals are filled by the pass that
		// builds the scale, so the year is walked ONCE; `clearRead` is
		// therefore called after it rather than here.
		let yAdd = 0, yCut = 0, yNet = 0, yDays = 0;
		const clearRead = () => {
			readDay.textContent = String(year);
			readFig.textContent = figOf(yAdd, yCut, yNet) + ' \u00b7 '
				+ yDays.toLocaleString() + (yDays === 1 ? ' day written' : ' days written');
			// NOT IDLE ANY MORE, and the class goes rather than being left on a
			// line that now carries figures: `is-idle` is faint and italic, which
			// is how this stylesheet says "waiting for you".
			readFig.classList.remove('is-idle');
		};
		const showRead = (k: string, rec: WsHistoryTally) => {
			const d = new Date(k + 'T00:00:00');
			readDay.textContent = isNaN(d.getTime()) ? k : d.toLocaleDateString(undefined,
				{ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
			readFig.classList.remove('is-idle');
			if (!rec) { readFig.textContent = 'Nothing written'; return; }
			readFig.textContent = figOf(rec.a || 0, rec.r || 0, rec.n || 0);
		};
		// ── The legend: one of three ────────────────────────────────────────
		const legend = this.historyEl('div', 'ws-hist-series ws-cal-legend', host);
		const pick = (id: string, label: string) => {
			const b = this.historyEl('button',
				'ws-hist-pill is-' + (id === 'removed' ? 'removed' : id === 'added' ? 'added' : 'net')
				+ (metric === id ? ' is-on' : ''), legend);
			this.historyEl('span', 'ws-hist-swatch', b);
			this.historyEl('span', '', b, label);
			b.addEventListener('click', () => {
				if (metric === id) return;
				s.historyCalMetric = id;
				// NO SAVE. The calendar metric is session-only: a `saveSettings()` here
				// would write the whole file and none of this click — the strip in
				// `wsForDisk` sees to that.
				rerender();
			});
		};
		pick('added', 'Added'); pick('removed', 'Deleted'); pick('net', 'Net');

		// ── The scale ───────────────────────────────────────────────────────
		const mags = [];
		for (let m = 0; m < 12; m++) {
			const last = new Date(year, m + 1, 0).getDate();
			for (let d = 1; d <= last; d++) {
				const rec = days[key(year, m, d)];
				if (!rec || !this.historyIsActive(rec)) continue;
				const v = Math.abs(valueOf(rec));
				if (v > 0) mags.push(v);
				// THE YEAR, COUNTED IN THE PASS THAT IS ALREADY WALKING IT. The
				// totals are the record's own three numbers and NOT `valueOf`,
				// which answers only the metric the legend has lit — a year
				// summary that changed when you pressed Added would be reporting
				// the control rather than the year.
				yAdd += rec.a || 0; yCut += rec.r || 0; yNet += rec.n || 0;
				yDays++;
			}
		}
		clearRead();
		mags.sort((a, b) => a - b);
		// (n-1)*0.9, not n*0.9. With a handful of active days the latter
		// rounds to the LAST element — the maximum wearing a percentile's
		// name — and the outlier it exists to tame becomes the scale again.
		// Seven days of ~400 with one of 9,000 topped out at 9,000; they top
		// out at 450 now, and the 9,000 simply saturates.
		const top = mags.length
			? Math.max(1, mags[Math.floor((mags.length - 1) * 0.9)])
			: 1;
		const STEPS = 5;
		const stepOf = (v: number) => {
			const a = Math.abs(v);
			if (a <= 0) return -1;                      // nothing written
			return Math.min(STEPS, 1 + Math.floor((a / top) * STEPS));
		};

		// ── Twelve months ───────────────────────────────────────────────────
		const grid = this.historyEl('div', 'ws-cal-year', host);
		const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'];
		// Monday first: a writing week is not a spreadsheet week, and the
		// weekend belongs at the end of it where the eye expects the quiet.
		const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
		// The plugin's own key formatter, not a hand-rolled one: a calendar
		// that disagrees with the record about which string means today
		// would mark the wrong square, and only near midnight, and only
		// sometimes.
		const todayKey = this.historyDateKey(new Date());

		// ── EVERY MONTH THE SAME HEIGHT ─────────────────────────────────────
		// Reported as "the months are too far apart", and it was not the gap
		// — that is already 3px between the rows. A grid row is as tall as
		// its TALLEST item, so a four-row February beside a six-row November
		// was stretched to six and left two rows of dead page under its last
		// week. The eye reads that emptiness as the spacing, and it changes
		// from row to row, which is what made it look ragged rather than
		// merely loose.
		//
		// So every month is padded to the same number of week rows and the
		// twelve grids end level. Shrinking the gap could not have fixed
		// this: the space is INSIDE the short months, not between them.
		//
		// SIX, AS A CONSTANT, and the loop that used to compute it is the
		// reason this comment is long.
		//
		// blanks plus its days exceed 35. A 31-day month starting Saturday
		// or Sunday does it, and a 30-day month starting Sunday does. Over
		// twelve months there is no arrangement of weekday starts that
		// avoids all of them.
		const CAL_WEEK_ROWS = 6;

		for (let m = 0; m < 12; m++) {
			const box = this.historyEl('div', 'ws-cal-month', grid);
			// JUST THE MONTH. The year is on the stepper directly above the
			// grid, and repeating it twelve times is twelve reminders of the
			// one thing that cannot change while you are looking at it.
			this.historyEl('div', 'ws-cal-name', box, MONTHS[m]);
			const cells = this.historyEl('div', 'ws-cal-grid', box);
			for (const w of DOW) this.historyEl('div', 'ws-cal-dow', cells, w);
			// getDay() is Sunday-based; shift so Monday is column one.
			const lead = (new Date(year, m, 1).getDay() + 6) % 7;
			for (let i = 0; i < lead; i++) this.historyEl('div', 'ws-cal-pad', cells);
			const last = new Date(year, m + 1, 0).getDate();
			for (let d = 1; d <= last; d++) {
				const k = key(year, m, d);
				const rec = days[k];
				const v = valueOf(rec);
				const st = stepOf(v);
				// A NET LOSS IS DRAWN IN THE CUTTING PALETTE. Under `net` a
				// day can be negative, and painting it in the adding colours
				// would say the opposite of what happened.
				const fam = metric === 'removed' || (metric === 'net' && v < 0)
					? 'is-removed' : 'is-added';
				const cell = this.historyEl('div',
					'ws-cal-day ' + (st < 0 ? 'is-empty' : fam + ' s' + st)
					+ (k === todayKey ? ' is-today' : ''), cells, String(d));
				cell.addEventListener('mouseenter', () => showRead(k, rec));
				cell.addEventListener('focus', () => showRead(k, rec));
				// Touch has no hover: a tap is how a phone asks the same
				// question, and the readout is the answer either way.
				cell.addEventListener('click', () => showRead(k, rec));
			}
			// The trailing pad, which is what levels the twelve grids. Same
			// class as the leading pad — it must be, because a pad that
			// measured differently from a day would put the padded weeks at
			// a different height from the weeks they pad, which is the fault
			// this is fixing rather than a fix for it.
			const trail = (CAL_WEEK_ROWS * 7) - (lead + last);
			for (let i = 0; i < trail; i++) this.historyEl('div', 'ws-cal-pad', cells);
		}
		grid.addEventListener('mouseleave', clearRead);

	},

	buildHistoryChart(this: WordSmith, body: HTMLElement, data: { view: string; buckets: WsHistoryBucket[]; label: string }, ser: Record<string, boolean>) {
		const W = HISTORY_CHART_W, H = HISTORY_CHART_H;
		const PAD = HISTORY_PX * 3;
		const buckets = data.buckets;
		const n = buckets.length || 1;

		// ── THE AXIS FITS ORDINARY DAYS, NOT THE MAXIMUM ────────────────
		//
		// The 95th percentile of the visible days (or 3x the median, whichever
		// is larger), never the maximum: one 10k day would flatten a month of
		// real work into a line along the axis. THE VISIBLE ONES: `buckets` is
		// exactly what the chart will draw — not the whole record, and not the
		// whole month when a month is not what is on screen. PER DIRECTION, and
		// only from the series actually ON: up and down have separate scales
		// already, and a cap computed over both would let a month of heavy
		// cutting set the ceiling for the writing. ZEROES ARE NOT DATA POINTS: a
		// day nobody wrote is not a small day, and including them would drag
		// the median to nothing and make the cap 3x nothing.
		const upVals = [], dnVals = [];
		let maxUp = 0, maxDn = 0;
		for (const b of buckets) {
			if (ser.added   && b.a > 0) { upVals.push(b.a); if (b.a > maxUp) maxUp = b.a; }
			if (ser.removed && b.r > 0) { dnVals.push(b.r); if (b.r > maxDn) maxDn = b.r; }
			if (ser.net && b.n > 0) { upVals.push(b.n); if (b.n > maxUp) maxUp = b.n; }
			if (ser.net && b.n < 0) { dnVals.push(-b.n); if (-b.n > maxDn) maxDn = -b.n; }
		}
		// THE RULE LIVES IN ONE PLACE, and it is a pure function with its
		// own plain-node suite (`wsAxisBound`, 00-preamble, tests/
		// axis_bound_test.js). It was written inline here first and the
		// writer had asked for it extracted - "(values[] -> {bound,
		// clipped[]}) with plain-node tests" - which is also the only way
		// its edge cases (one day, every day identical, all-negative) get
		// driven at all: through a rendered chart they cannot be.
		//
		// PER DIRECTION. Up and down already have separate scales, and a
		// bound computed over both would let a month of heavy cutting set
		// the ceiling for the writing.
		const boundUp = wsAxisBound(upVals);
		const boundDn = wsAxisBound(dnVals);
		const capUp = boundUp.bound || maxUp;
		const capDn = boundDn.bound || maxDn;
		// WHAT WAS CLIPPED, for the caption: "scale fits ordinary days · 1 day
		// clipped". IT IS COUNTED BELOW, AFTER THE AXIS TOP IS KNOWN: `bound` is
		// the 95th-percentile figure and `topV` is that bound ROUNDED UP to a
		// whole gridline, so a value between the two would be counted as
		// clipped and drawn whole. AND IT COUNTS BUCKETS, NOT BARS: a day that
		// runs off BOTH ends is one day, and the caption's word is "days".
		//
		// The average is drawn INSIDE the existing scale rather than being
		// allowed to stretch it.
		//
		// AND IT AVERAGES NET, LIKE THE FIGURE BESIDE IT. The readout puts this
		// number directly after the net total, and the report block leads with
		// "Words, net" — an added-based average with the same divisor was the
		// odd one out, and read as the wrong answer to the question the
		// sentence had just asked. AN ACTIVE BUCKET IS STILL ANY BUCKET WITH
		// ACTIVITY, cutting included, which is what keeps the divisor the same.
		const active = buckets.filter((b) => (b.a + b.r) > 0);
		const avg = (ser.average && active.length)
			? Math.round(active.reduce((t, b) => t + b.a - b.r, 0) / active.length)
			: 0;
		if (!maxUp && !maxDn) maxUp = 1;

		// Round the top of the scale UP to a whole gridline, so the topmost
		// line is a number rather than a crop mark.
		const step  = this.historyNiceStep(Math.max(capUp, capDn) / 3.2);
		const topV  = Math.max(step, Math.ceil(capUp / step) * step);
		const botV  = capDn > 0 ? Math.max(step, Math.ceil(capDn / step) * step) : 0;
		// THE CAPTION'S NUMBER, asked of the same limits the bars are drawn
		// against, and of the same `ser` switches that decide which bars
		// exist at all — a series that is turned off cannot clip.
		// AND WHICH WAY THEY RAN OFF, because the label's room is spent only
		// on the side that has a label to put in it.
		let clippedN = 0, overUp = false, overDn = false;
		for (const b of buckets) {
			const up = (ser.added && b.a > topV)
				|| (ser.net && b.n > 0 && b.n > topV);
			const dn = (ser.removed && botV > 0 && b.r > botV)
				|| (ser.net && b.n < 0 && botV > 0 && -b.n > botV);
			if (up) overUp = true;
			if (dn) overDn = true;
			if (up || dn) clippedN++;
		}

		// THE MARGIN IS PER SIDE, and it is the only thing that changed here:
		// `PAD` on a side with nothing to say, `PAD + HISTORY_OVERLAB_PAD` on
		// a side carrying an over-label. Every reader of the old single PAD
		// below had to move with it — the plot height, the zero line and BOTH
		// half-heights — or the bars would be drawn against one margin and
		// the axis placed by another.
		const padUp = PAD + (overUp ? HISTORY_OVERLAB_PAD : 0);
		const padDn = PAD + (overDn ? HISTORY_OVERLAB_PAD : 0);
		const plot  = H - padUp - padDn;
		const share = topV + botV || 1;
		let zero = padUp + plot * (topV / share);
		zero = Math.round(zero / HISTORY_PX) * HISTORY_PX;
		const upH = zero - padUp, dnH = H - padDn - zero;
		const yUp = (v: number) => zero - (topV ? (v / topV) * upH : 0);
		const yDn = (v: number) => zero + (botV ? (v / botV) * dnH : 0);

		const slot = W / n;
		// One column for the added/deleted pair, one more if net is on. Every
		// bar in the chart is then the same width, which is the only way the
		// heights can honestly be compared by eye.
		// One column per bucket. Net is drawn OVER the pair rather than beside
		// it, at the same width, and that overlap is the point: net is always
		// smaller than added (it is added minus deleted), so the blue covers
		// the lower part of the green and what stays green is exactly the part
		// that got cut again. The two readings are the same picture.
		const ncol = 1;
		// The drawing cell, the bar width and the gap between columns are
		// solved together, because each depends on the other two. The cell is
		// coarsened only if the view would otherwise ask for an unreasonable
		// number of rects — and the estimate below is the WORST case, every
		// bar full height, which is why the threshold is generous. An earlier
		// version estimated the whole plot area as filled, which is never true
		// and quietly doubled the cell on every chart in the plugin: the
		// pixels were four units wide everywhere and nothing said so.
		let cell = HISTORY_PX, bw, gap;
		for (;;) {
			bw = Math.floor((slot * 0.82 / ncol) / cell) * cell;
			// Both bounds snapped to the cell as well, or the cap reintroduces
			// a width that is not a whole number of pixels and the right-hand
			// column of every bar sits half off the grid.
			bw = Math.max(cell * 2, Math.min(Math.floor(HISTORY_BAR_MAX / cell) * cell, bw));
			gap = Math.max(0, (slot - ncol * bw) / (ncol + 1));
			// AGAINST THE REAL PLOT, not against PAD twice. The margins are
			// per-side since the over-label got its room, so `H - PAD * 2` is no
			// longer the height anything is drawn in — it was left behind by that
			// change and would have quietly over-estimated the worst case.
			const worst = n * ncol * (bw / cell) * (plot / cell);
			if (worst <= HISTORY_MAX_CELLS || cell >= HISTORY_PX * 4) break;
			cell *= 2;
		}

		// ── The readout ─────────────────────────────────────────────────────
		// Above the chart, not floating over it: a value that moves under the
		// pointer is a value you cannot read while pointing at something else.
		let ta = 0, tr = 0;
		for (const b of buckets) { ta += b.a; tr += b.r; }
		const summary = data.label + ' \u00b7 ' + ta.toLocaleString() + ' added \u00b7 '
			+ tr.toLocaleString() + ' deleted \u00b7 ' + ((ta - tr) > 0 ? '+' : '')
			+ (ta - tr).toLocaleString() + ' net'
			// `!== 0`, NOT `> 0`. A net average can be negative — this year
			// it is — and a `> 0` test drops the clause entirely in exactly
			// the months a writer most wants to see it.
			+ (avg !== 0 ? ' \u00b7 averaging ' + avg.toLocaleString()
				+ ' per active ' + (data.view === 'day' ? 'day' : data.view) : '');
		const readout = this.historyEl('div', 'ws-hist-readout', body);
		// The line is the chart's answer, so it announces itself when it
		// changes — which is what the tooltip used to do for a reader who
		// could not see the bars.
		readout.setAttribute('aria-live', 'polite');
		const setReadout = (html: string) => { readout.textContent = html; };
		setReadout(summary);

		// ── Plot ────────────────────────────────────────────────────────────
		const plotWrap = this.historyEl('div', 'ws-hist-plot', body);
		const gutter   = this.historyEl('div', 'ws-hist-gutter', plotWrap);

		const svg = this.historySvg('svg', {
			viewBox: '0 0 ' + W + ' ' + H, class: 'ws-hist-chart',
			preserveAspectRatio: 'none', role: 'img'
		}, plotWrap);

		// One background column, and only one: the bucket you are in now. A
		// week is seven days; shading two of them because a calendar calls
		// them a weekend is the chart telling a writer when they ought to be
		// working, in a panel whose whole job is to show what they did. THE
		// CURRENT BUCKET IS NOT SHADED: a tinted column behind the bars in the
		// accent colour reads as a warning about the day rather than a note
		// that it is not over yet, and the BARS say that by painting a step
		// lighter. The KEY is still wanted: the axis label below marks the
		// current bucket too, as a weight rather than a colour.
		const todayKey = this.historyDateKey();

		// Gridlines, drawn as dotted runs of blocks like everything else. The
		// labels go in the HTML gutter beside the SVG, because the viewBox is
		// stretched horizontally and any text inside it stretches with it.
		const rule = (v: number, y: number) => {
			if (y < 1 || y > H - 1) return;
			for (let x = 0; x < W; x += cell * 4) {
				this.historySvg('rect', {
					x: x.toFixed(2), y: (y - 0.5).toFixed(2),
					// Clipped at the right edge: a fixed-width dash starting
					// near the end of the run overshoots the viewBox, which is
					// invisible on screen and a failed assertion in the probe.
					width: Math.min(cell * 2, W - x).toFixed(2), height: 1, class: 'ws-hist-grid'
				}, svg);
			}
			const lbl = this.historyEl('span', 'ws-hist-ylbl', gutter,
				(v < 0 ? '\u2212' : '') + this.historyShortNum(Math.abs(v)));
			lbl.style.top = ((y / H) * 100).toFixed(3) + '%';
		};
		for (let v = step; v <= topV + 0.001; v += step) rule(v, yUp(v));
		for (let v = step; v <= botV + 0.001; v += step) rule(-v, yDn(v));

		// ── Bars ────────────────────────────────────────────────────────────
		// Drawn cell by cell, out of tiny squares, with an ordered dither
		// between the steps of a heat ramp. Three earlier attempts got this
		// wrong in the same way: a stack of blocks with gaps between them
		// reads as an LED meter, and ONE quantised rectangle with a lighter
		// top row is just a rectangle with a lighter top row. Neither is a
		// pixel. A pixel is small, it has neighbours, and the shading between
		// it and its neighbours is where the texture comes from — which is
		// what the 2x2 Bayer threshold below is for. It is the same thing the
		// ink tank does with a canvas at low resolution; this does it with
		// rects because an SVG cannot be scaled up from a small buffer.
		const px = (g: SVGGElement, x: number, y: number, w: number, hh: number, cls: string) => this.historySvg('rect', {
			x: x.toFixed(2), y: y.toFixed(2),
			width: w.toFixed(2), height: hh.toFixed(2), class: cls
		}, g);

		// cells and still never rounds below one. A day of forty words is
		// a day that happened, and a chart that tidies it away is tidying
		// at the writer's expense - that argument did not depend on the
		// texture and does not go with it.
		const solidBar = (g: SVGGElement, x: number, v: number, w: number, series: string, down: boolean, isNow: boolean) => {
			// ── PAST THE TOP IS NOT OFF THE CHART ───────────────────────
			//
			// Writer: "anything beyond is drawn full-height with a hatched
			// top edge and its real number above it. Nothing is hidden - the
			// outlier is MORE legible than before, because it now carries a
			// label instead of being a tall bar you have to hover."
			//
			// SO THE VALUE IS CLAMPED, NOT DROPPED. The bar reaches the top
			// of the plot, the hatch says it continues, and the number says
			// how far - which is strictly more than a bar whose height a
			// reader had to estimate against a gridline.
			const lim  = down ? botV : topV;
			const over = lim > 0 && v > lim;
			const vv   = over ? lim : v;
			const span = Math.abs((down ? yDn(vv) : yUp(vv)) - zero);
			const h    = Math.max(cell, Math.round(span / cell) * cell);
			const top  = down ? zero : zero - h;
			// A CLIPPED COLUMN RUNS TO THE TOP OF THE PLOT with no mark on its
			// edge (a zigzag, a hatch and four other treatments were all turned
			// down); the label above says how far it really goes, and `is-over`
			// is how the label finds its bar — the one record in the DOM that
			// the column was cut.
			px(g, x, top, w, h, 'ws-hist-px ' + series
				+ ' h' + (HISTORY_HEAT - 1) + (isNow ? ' is-now' : '')
				+ (over ? ' is-over' : ''));
			if (!over) return;
			// AND ITS REAL NUMBER, above the bar going up and below the one going
			// down — outside the plot in both cases, so it never sits on the ink it
			// is describing. IN THE GUTTER LAYER, NOT IN THE SVG: the chart is
			// `preserveAspectRatio="none"` over a 660 viewBox rendered wider, so
			// its screen transform is wide, not tall, and every `<text>` in it
			// comes out stretched — the same rule the y-axis numbers obey.
			// PERCENTAGES, so the label follows the bar when the pane is resized —
			// the same arithmetic the y-labels use for `top`, one axis further.
			const t = this.historyEl('span',
				'ws-hist-overlab ' + series + (down ? ' is-down' : ' is-up'),
				plotWrap, (down ? '\u2212' : '+')
					+ this.historyShortNum(Math.abs(v)));
			// ── ON THE BAR, NOT BESIDE IT ─────────────────────────────────
			//
			// A percentage `left` on an absolutely positioned element resolves
			// against its containing block's PADDING BOX, and `.ws-hist-plot`
			// carries a left padding for the y-axis gutter — so a fraction of the
			// PLOT applied to gutter-plus-plot lands the label short of its bar by
			// the gutter, and further the further right the bar is. `100% - gut` IS
			// EXACTLY THE SVG: the containing block is gutter plus chart, so
			// subtracting the one leaves the other — no second copy of the number,
			// and a phone's narrower gutter follows the same token. The vertical was
			// never wrong: `top` has no gutter above it.
			const frac = ((x + w / 2) / W).toFixed(5);
			t.style.left = 'calc(var(--ws-hist-gut, 0px) + (100% - var(--ws-hist-gut, 0px)) * ' + frac + ')';
			// ONE CONSTANT, BOTH DIRECTIONS. `is-down` swaps the transform to
			// `translate(-50%, 0)` so this number places the label's TOP edge
			// going down and its BOTTOM edge going up — the edge FACING THE
			// BAR in each case. Written the old way, with one transform for
			// both, the same number meant two different distances.
			t.style.top = ((((down ? zero + h + WS_HIST_LAB_GAP * cell
				: zero - h - WS_HIST_LAB_GAP * cell) / H) * 100)).toFixed(3) + '%';
		};

		const groups: SVGGElement[] = [];
		for (let i = 0; i < n; i++) {
			const b = buckets[i];
			const g = this.historySvg('g', { class: 'ws-hist-bargroup' }, svg);
			groups.push(g);
			// NO <title>, BUT NOT NO LABEL. An SVG title is the OS tooltip,
			// and the readout line under the chart already answers the
			// same question in the plugin's own voice without covering
			// the bars either side of the one being read. It was also
			// what a screen reader and a touch device had — so the numbers
			// move to an aria-label, which those still reach and which
			// draws nothing.
			g.setAttribute('aria-label', b.readout || '');
			this.historySvg('rect', {
				x: (i * slot).toFixed(2), y: 0, width: slot.toFixed(2), height: H,
				class: 'ws-hist-hit'
			}, g);

			// Every bar in the chart is the same width. Added rises and deleted
			// falls from the one line; net is laid over whichever of the two
			// it shares a sign with, LAST so it sits on top.
			const x = i * slot + gap;
			// Whether this bucket is the one in progress — today, this
			// month, this year, whichever the view is counting in.
			const now = (b.key === this.historyDateKey()) || !!b.isNow;
			if (ser.added   && b.a > 0) solidBar(g, x, b.a, bw, 'is-added', false, now);
			if (ser.removed && b.r > 0) solidBar(g, x, b.r, bw, 'is-removed', true, now);
			// NET IS NO LONGER A BAR — see `netStep` below, drawn after this
			// loop so it lies OVER every bar rather than among them.
			if (!b.a && !b.r) px(g, x, zero - cell, bw, cell, 'ws-hist-zeroed');
		}

		// ── NET, AS A LINE OVER THE BARS ──────────────────────────────────
		//
		// A net bar in the same weight as the two it answers competes with them
		// as a third quantity; the reading that SUMS the others is a line laid
		// over them. IT CROSSES THE AXIS, which no bar does: added rises from
		// the centre line and deleted falls from it, so each lives on one side.
		// Net is signed and belongs on both — `yUp` above zero, `yDn` below,
		// against the scale the bars already use. No second scale, and the
		// clipping count above already asks `ser.net` on both sides. AFTER THE
		// BARS AND BEFORE THE AXIS: over what it answers, under the line
		// everything is measured from.
		if (ser.net) {
			const netY = (v: number) => {
				if (v > 0) return yUp(topV > 0 && v > topV ? topV : v);
				if (v < 0) return yDn(botV > 0 && -v > botV ? botV : -v);
				return zero;
			};
			const TH = HISTORY_PX;
			// ── THE NET LINE RUNS THROUGH THE BARS, CURVED ────────────────
			//
			// EXACT, NOT RESAMPLED. A cubic Hermite segment IS a cubic Bézier —
			// the control points are one third of the tangent along the span — so
			// the curve is emitted directly rather than approximated at some step
			// size: one `d` instead of a rect per two pixels.
			//
			// MONOTONE CUBIC (Fritsch–Carlson), not Catmull-Rom, and the reason is
			// honesty rather than taste: a Catmull-Rom spline OVERSHOOTS between
			// points, so a quiet day between two busy ones would be drawn with a
			// net the writer never had. A monotone fit cannot leave the interval
			// its neighbours define.
			const px = new Array<number>(buckets.length);
			const py = new Array<number>(buckets.length);
			for (let i = 0; i < buckets.length; i++) {
				// THE MIDDLE OF THE BAR, which is the half of the ask that is
				// about placement rather than shape.
				px[i] = i * slot + gap + bw / 2;
				py[i] = netY(buckets[i].n || 0);
			}
			if (px.length === 1) {
				// ONE BUCKET IS A DOT, and a dot is now a round one — a square
				// block beside a stroked curve would be the only pixel left in
				// the reading.
				this.historySvg('circle', {
					cx: px[0].toFixed(2), cy: py[0].toFixed(2),
					r: (TH / 2).toFixed(2), class: 'ws-hist-netdot'
				}, svg);
			} else if (px.length > 1) {
				const nP = px.length;
				const d = new Array<number>(nP - 1);
				for (let i = 0; i < nP - 1; i++) d[i] = (py[i + 1] - py[i]) / (px[i + 1] - px[i]);
				const m = new Array<number>(nP);
				m[0] = d[0];
				m[nP - 1] = d[nP - 2];
				for (let i = 1; i < nP - 1; i++) {
					// A TURNING POINT GETS A FLAT TANGENT. Without this the curve
					// rounds over a peak and reads as a higher day than there was.
					m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
				}
				for (let i = 0; i < nP - 1; i++) {
					if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
					const a = m[i] / d[i], bq = m[i + 1] / d[i];
					const sq = a * a + bq * bq;
					if (sq > 9) {
						const t2 = 3 / Math.sqrt(sq);
						m[i] = t2 * a * d[i];
						m[i + 1] = t2 * bq * d[i];
					}
				}
				// TODAY IS STILL MARKED, and it has to be marked per BLOCK now
				// rather than per tread: the bars say which bucket is in
				// progress, and a net line that did not would be the one reading
				// on the chart that cannot tell a finished day from one still
				// being written.
				let nowFrom = Infinity, nowTo = -Infinity;
				for (let i = 0; i < buckets.length; i++) {
					const b2 = buckets[i];
					if ((b2.key === this.historyDateKey()) || b2.isNow) {
						nowFrom = Math.min(nowFrom, i * slot + gap);
						nowTo = Math.max(nowTo, i * slot + gap + bw);
					}
				}
				// HERMITE TO BÉZIER. For a span of width h the two control points
				// sit one third of the way along it, offset by the tangent there:
				// C1 = P0 + (h/3, m0*h/3), C2 = P1 - (h/3, m1*h/3). That is an
				// identity, not a fit — the drawn curve is the same one the
				// Fritsch–Carlson tangents above define.
				const seg3 = (i: number) => {
					const h = px[i + 1] - px[i];
					return 'C' + (px[i] + h / 3).toFixed(2)
						+ ' ' + (py[i] + m[i] * h / 3).toFixed(2)
						+ ' ' + (px[i + 1] - h / 3).toFixed(2)
						+ ' ' + (py[i + 1] - m[i + 1] * h / 3).toFixed(2)
						+ ' ' + px[i + 1].toFixed(2)
						+ ' ' + py[i + 1].toFixed(2);
				};
				let d2 = 'M' + px[0].toFixed(2) + ' ' + py[0].toFixed(2);
				for (let i = 0; i < nP - 1; i++) d2 += seg3(i);
				this.historySvg('path', { d: d2, class: 'ws-hist-netline' }, svg);
				// TODAY, STROKED OVER THE TOP. The bars say which bucket is in
				// progress and the line has to say it too, or it is the one
				// reading on the chart that cannot tell a finished day from one
				// still being written.
				//
				// WHOLE SPANS, NOT A CLIPPED CURVE. A span is included when it
				// overlaps the in-progress bucket at all; splitting a Bézier at an
				// arbitrary x needs de Casteljau and buys nothing a reader could
				// see, since the emphasis is drawn over the same geometry.
				if (nowTo >= nowFrom) {
					let dN = '', open = false;
					for (let i = 0; i < nP - 1; i++) {
						if (px[i + 1] < nowFrom || px[i] > nowTo) { open = false; continue; }
						if (!open) {
							dN += 'M' + px[i].toFixed(2) + ' ' + py[i].toFixed(2);
							open = true;
						}
						dN += seg3(i);
					}
					if (dN) {
						this.historySvg('path',
							{ d: dN, class: 'ws-hist-netline is-now' }, svg);
					}
				}
			}
		}

		// The axis over the bars, so it stays readable at every scale.
		this.historySvg('rect', {
			x: 0, y: (zero - 0.5).toFixed(2), width: W, height: 1, class: 'ws-hist-axis'
		}, svg);

		// ── THE REFERENCE LINES, AND HOW HEAVY THEY ARE ────────────
		//
		// A reference reading as heavily as the AXIS — the line every bar is
		// measured from — is the fault; the thickness is an argument rather
		// than a second helper.
		const dotted = (y: number, cls: string, thick: number) => {
			const th = thick || 2;
			for (let x = 0; x < W; x += cell * 3) {
				this.historySvg('rect', {
					x: x.toFixed(2), y: (y - th / 2).toFixed(2),
					width: Math.min(cell * 2, W - x).toFixed(2), height: th, class: cls
				}, svg);
			}
		};
		// BOTH SIDES OF THE AXIS. The average is net now, so it can fall
		// below zero, and `avg > 0` would have hidden the line in precisely
		// the periods it is most worth drawing. The magnitude has to fit
		// the half it lands in: `topV` above, `botV` below, which are the
		// two limits the bars are already drawn against.
		const avgFits = avg > 0 ? (avg <= topV) : (avg < 0 && -avg <= botV);
		if (avgFits) {
			const ay = avg > 0 ? yUp(avg) : yDn(-avg);
			dotted(ay, 'ws-hist-avgline', 1);
			// AND IT SAYS WHAT IT IS: the line carries its number. AT THE RIGHT END
			// AND ABOVE THE LINE: the bars grow from the left, so the right end is
			// the emptiest part of the plot, and sitting above keeps the label off
			// the dashes it names. IN THE GUTTER LAYER — see the overlabel above.
			const lab = this.historyEl('span', 'ws-hist-avglab', plotWrap,
				'avg. ' + Math.round(avg).toLocaleString() + ' words');
			lab.style.top = ((ay / H) * 100).toFixed(3) + '%';
		}

		// ── Hover ───────────────────────────────────────────────────────────
		// ONE listener on the svg, and the bucket worked out from the pointer's
		// position across it. The previous version put mouseenter on a
		// transparent rect per bucket and it never fired in the app: an SVG
		// shape only receives pointer events under the default
		// `pointer-events: visiblePainted` if it is actually painted, and a
		// fill of `transparent` is not — so the readout sat on the period
		// total however carefully you pointed at a bar. Working out the index
		// from one rect's geometry needs nothing to be painted at all, is one
		// listener instead of thirty-one, and cannot be broken by whatever a
		// theme decides to do to `pointer-events`.
		let lastIdx = -1;
		svg.addEventListener('mousemove', (ev) => {
			const box = svg.getBoundingClientRect();
			if (!box.width) return;
			const idx = Math.floor(((ev.clientX - box.left) / box.width) * n);
			if (idx === lastIdx) return;
			lastIdx = idx;
			setReadout(idx >= 0 && idx < n ? (buckets[idx].readout || '') : summary);
			for (let k = 0; k < groups.length; k++) groups[k].classList.toggle('is-hover', k === idx);
		});
		svg.addEventListener('mouseleave', () => {
			lastIdx = -1;
			setReadout(summary);
			for (const gg of groups) gg.classList.remove('is-hover');
		});

		// ── X axis ──────────────────────────────────────────────────────────
		const axisWrap = this.historyEl('div', 'ws-hist-xwrap', body);
		const axis = this.historyEl('div', 'ws-hist-xaxis', axisWrap);
		axis.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
		// EVERY BUCKET GETS A SPAN, always. The grid is one cell per bar, so
		// a label is under its own bar only while the cells keep their
		// places — dropping a span would close its cell up and slide every
		// label after it.
		//
		// ── AND THIS MONTH AND THIS YEAR ARE NOW, TOO ────────────────────
		//
		// THE MARK EXISTED AND THE LABEL ASKED THE WRONG QUESTION. A daily
		// bucket is keyed by date, so `key === todayKey` finds today; a
		// monthly bucket is keyed by month and a yearly one by year, and
		// neither can ever equal a day. So the axis label was never marked
		// outside the Daily view.
		//
		// `isNow` IS ALREADY THE ANSWER and is already set — `32-history-tab`
		// stamps it on the monthly bucket that is this month and the yearly
		// one that is this year. The BARS have read it all along (see the
		// `now` line in the bar loop); this label was the one reader still
		// asking by date. Same question, same two ways of answering it,
		// which is how they drifted.
		const spans: HTMLSpanElement[] = [];
		for (let i = 0; i < n; i++) {
			const isNowBucket = buckets[i].key === todayKey || !!buckets[i].isNow;
			spans.push(this.historyEl('span',
				isNowBucket ? 'is-now' : '', axis, buckets[i].label));
		}
		// AND WHETHER THEY FIT IS ASKED OF THE LAYOUT, not of `n`.
		//
		// IN A FRAME, because none of this has a width until the panel has
		// been laid out — the same reason the Organizer’s name seam is
		// measured in a rAF and not at build time.
		//
		// `visibility`, NOT `display`, and that is the whole point: a hidden
		// span keeps its grid cell, so the labels that remain stay under
		// their own bars. Removing one would slide the rest.
		const fitAxis = () => {
			try {
				const w = axis.getBoundingClientRect().width;
				if (!(w > 0) || !spans.length) return;
				// THE TEXT, NOT THE BOX AROUND IT.
				//
				// A LABEL IS A GRID ITEM STRETCHED TO ITS CELL, so every way of
				// asking the ELEMENT how wide it is returns the CELL width and
				// not the number printed in it. Both drafts of this test asked
				// the element: the first compared `scrollWidth` against the cell
				// and the second against `clientWidth`, which is comparing a
				// value with itself — MEASURED IN THE WRITER’S VAULT, every span
				// reports scrollWidth 31 and clientWidth 31 in a 30.9px cell. Both
				// were true for every label always, and the axis printed every
				// OTHER day for its whole life — which is the fault this test was
				// added to remove ("if it enough space show every day").
				//
				// A RANGE OVER THE SPAN’S CONTENTS measures the glyphs. Same vault,
				// same axis: the widest label is 12.0px against a 30.9px cell, so
				// all 31 days fit and none is hidden.
				const cell = w / spans.length;
				let need = 0;
				const rng = axis.ownerDocument.createRange();
				for (const sp of spans) {
					rng.selectNodeContents(sp);
					need = Math.max(need, rng.getBoundingClientRect().width);
				}
				// A MEASUREMENT THAT CAME BACK EMPTY IS NOT AN ANSWER. A Range
				// reports 0 where there is no layout engine, and 0 would read as
				// "everything fits" — a silent pass in exactly the place two
				// always-true tests have already stood. Nothing is hidden on no
				// answer, but it is the early return saying so, not the test.
				if (!(need > 0)) { for (const sp of spans) sp.style.removeProperty('visibility'); return; }
				// ── A STRIDE, NOT A YES OR NO ─────────────────────────────────
				//
				// A thinning that can only halve is stuck at a pane's width, where every
				// OTHER day still collides. It steps until the labels fit — every 2nd,
				// 3rd, 4th — which is the same question asked until it is answered. A
				// LITTLE AIR, or two numbers sit shoulder to shoulder and read as one.
				// COUNTED BACK FROM THE END, so the newest bucket is always labelled —
				// today in Daily, this month in Monthly — rather than kept by a special
				// case that could land next to a neighbour and put the collision back.
				// `visibility`, NOT `display`: the axis is one grid cell per bar, so a
				// hidden label must keep its cell or every label after it slides off
				// its own bar.
				let stride = 1;
				while (stride < spans.length && cell * stride < need + 4) stride++;
				const last = spans.length - 1;
				for (let i = 0; i < spans.length; i++) {
					spans[i].classList.toggle('is-hid', (last - i) % stride !== 0);
				}
			} catch (_) { wsCatch('buildHistoryChart / fitAxis: const w = axis.getBoundingClientRect().width;', _); }
		};
		// THE PANEL'S OWN WINDOW, not `window`. This pane can be torn off
		// into a popout, and a rAF scheduled on the wrong window never runs
		// there — the same lookup `orgFieldEditor` and the zen chrome both
		// use.
		const awin = (axis.ownerDocument && axis.ownerDocument.defaultView)
			|| window;
		try { awin.requestAnimationFrame(fitAxis); }
		catch { fitAxis(); }
		// AND AGAIN WHEN THE PANE CHANGES WIDTH. The chart is not rebuilt when
		// a leaf is dragged or the window is zoomed, so a measurement taken
		// once at build describes a pane the writer has since resized. The
		// observer dies with the element it watches (nothing else holds it),
		// and a redraw builds a new axis with a new one.
		try {
			// WIDTH ONLY, AND ONCE PER WIDTH. `fitAxis` writes `visibility` on the
			// spans it measures, so the observer hears its own work ('ResizeObserver
			// loop completed with undelivered notifications'). The damper is the
			// one the pane watcher uses: remember the last width and do nothing
			// when it has not moved.
			const RO = awin.ResizeObserver;
			if (RO) {
				let lastW = 0;
				const ro = new RO(() => {
					let w = 0;
					try { w = Math.round(axis.getBoundingClientRect().width); } catch { return; }
					if (!w || w === lastW) return;
					lastW = w;
					fitAxis();
				});
				ro.observe(axis);
			}
		} catch (_) { wsCatch('buildHistoryChart: const RO = awin.ResizeObserver;', _); }

		// ── AND THE SCALE SAYS SO ──────────────────────────────────────
		//
		// A caption under the chart states the scale honestly — "scale fits
		// ordinary days · 1 day clipped" — and when nothing is clipped it is
		// NOT BUILT AT ALL: an empty element still takes its margin, and a
		// caption that appears and disappears while keeping its space is empty
		// furniture.
		if (clippedN > 0) {
			// THE PERIOD'S OWN WORD. On Monthly a clipped bucket is a
			// month, and calling it a day would be the same fault as the
			// tiles' - a figure that does not say what it counts.
			const unit = data.view === 'day' ? 'day'
				: (data.view === 'month' ? 'month' : 'year');
			const cap = this.historyEl('div', 'ws-hist-scalenote', body,
				'scale fits ordinary ' + unit + 's \u00b7 '
				+ clippedN + ' ' + unit + (clippedN === 1 ? '' : 's') + ' clipped');
			// THE RULE ITSELF, on hover: a reader who wants to know WHY the
			// tallest bar stops where it does should not have to find this
			// brief to be told.
			cap.setAttribute('title',
				'The scale fits the 95th percentile of ' + data.label
				+ ' \u2014 or three times the median, whichever is larger \u2014 so an'
				+ ' ordinary ' + unit + ' is readable. Anything past it is drawn'
				+ ' full height with a hatched top and its real number above.');
		}
	},
};
export type HistoryMethods = typeof historyMethods;
