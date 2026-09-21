// Word-Smith — Stores: the files the plugin keeps: the structure, the goals, the colours, the columns, the settings mirror.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { Notice } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import type { WsUserCol, WsStructRow } from './settings';
import { EXPORT_MARK_END, EXPORT_MARK_START, GOALS_MARK_END, GOALS_MARK_START, SETTINGS_MARK_END, SETTINGS_MARK_START, STRUCT_BASENAME, STRUCT_MARK_END, STRUCT_MARK_START, WS_WRITE, wsCatch, wsPathNorm, wsStatusLabel, wsTextSameEol, wsBag, wsStatOf, wsStr } from './preamble';
import type WordSmith from './plugin';
import type { WsStructSource } from './plugin';

export const storesMethods = {

	// ── Goals, in a file the writer owns ────────────────────────────────────
	//
	// The targets themselves lived only in data.json, which is the one
	// store in this plugin a writer cannot read, cannot edit, and loses on
	// a reinstall — for a number they chose deliberately ("this book is
	// 90,000 words") that is the wrong place. `ws-goals.md` is the same
	// arrangement as the history and the export list: markers, plain
	// lines, found anywhere in the vault.
	//
	// data.json stays the working copy — everything reads `this.settings`
	// as before, so nothing downstream changes — and the file is the
	// DURABLE one: written when a target changes, and read back at startup
	// where it wins, because it is the copy a writer can have edited.
	goalsFilePath(this: WordSmith) {
		return this.storeResolve(this.settings.goalsPath, 'ws-goals.md');
	},

	goalsFileCompose(this: WordSmith) {
		const out = [];
		out.push('Word-Smith\u2019s writing goals. Edit the numbers freely \u2014 they are read');
		out.push('back when Obsidian starts, and rewritten when you change a goal in the');
		out.push('app. Everything between the markers is rewritten; keep your own notes');
		out.push('outside them.');
		out.push('');
		// ONE LINE PER PATH, carrying whichever of the two it has.
		//
		//   - Book/Ch 01.md — 2000 · revise
		//   - Book/Ch 02.md — 2000
		//   - Book/Ch 03.md — done
		//
		// A path can now appear with a status and no target: marking a scene
		// finished must not require inventing a word count for it, and the
		// window that reads this file stopped being only about goals the day
		// it could say where something is up to.
		const section = (title: string, goals: Record<string, number>, status: Record<string, string>) => {
			const keys = Array.from(new Set(
				Object.keys(goals || {}).concat(Object.keys(status || {})))).sort();
			if (!keys.length) return;
			out.push('### ' + title);
			out.push('');
			for (const k of keys) {
				const v = parseInt(String((goals || {})[k]), 10);
				const st = (status || {})[k];
				if (!v && !st) continue;
				out.push('- ' + k + ' \u2014 ' + (v ? String(v) : '')
					+ (v && st ? ' \u00b7 ' : '') + (st || ''));
			}
			out.push('');
		};
		section('Notes', this.settings.fileGoals, this.settings.fileStatus);
		// No Folders section: a folder is the sum of its files. The parser
		// still READS one, so an old file does not throw.
		return GOALS_MARK_START + '\n' + out.join('\n') + '\n' + GOALS_MARK_END + '\n';
	},

	goalsFileParse(this: WordSmith, text: string) {
		const res: { fileGoals: Record<string, number>; fileStatus: Record<string, string> } = { fileGoals: {}, fileStatus: {} };
		const body = String(text || '');
		const a = body.indexOf(GOALS_MARK_START);
		const b = body.indexOf(GOALS_MARK_END);
		if (a === -1 || b === -1 || b < a) return null;
		let into: 'fileGoals' | 'fileStatus' | null = null;
		for (const line of body.slice(a + GOALS_MARK_START.length, b).split('\n')) {
			const h = line.match(/^###\s+(.*)$/);
			if (h) {
				const name = h[1].trim().toLowerCase();
				// A `### Folders` heading in a file from before folder goals were
				// retired is SKIPPED, not stored: `into` stays null and its rows fall
				// through the reader below untouched.
				into = name === 'notes' ? 'fileGoals' : null;
				continue;
			}
			// An em dash by default, but a hyphen or a colon is what a
			// person types — the file invites editing, so it has to accept
			// what an editor actually produces.
			//
			// The value is now a number, a status word, or both: whatever
			// is left of the dash is the path, and what follows is read for
			// each of the two independently. A line with neither is a line
			// with nothing to say, and is dropped rather than stored as a
			// goal of zero.
			const r = line.match(/^\s*-\s*(.+?)\s*[\u2014\u2013:-]\s*(.*)$/);
			if (r && into) {
				const path  = r[1];
				const value = String(r[2] || '');
				const num = value.match(/\d[\d,\s]*/);
				const n = num ? parseInt(num[0].replace(/[,\s]/g, ''), 10) : 0;
				if (n > 0) res[into][path] = n;
				// The word, wherever it sits and in whatever case: this file
				// is written to be typed in.
				const word = (value.match(/[A-Za-z]+/) || [''])[0].toLowerCase();
				if (word && wsStatusLabel(word)) {
					// A legacy file may still carry a folder flag word; it is read and
					// dropped rather than resurrected.
					res.fileStatus[path] = word;
				}
			}
		}
		return res;
	},

	// ── THE GOALS, NOW A SECTION RATHER THAN A FILE ─────────────────────────
	//
	// Targets and flags ARE structure. "This chapter aims at 4,000 and is in
	// revision" belongs beside "this chapter comes third and goes in the
	// book", and while they were two files it was two writes, two parses, and
	// two separate places for a rename to be followed — which is two places
	// for it to be followed WRONGLY, and it was, twice.
	//
	// `goalsFileCompose` and `goalsFileParse` are kept and still read: they
	// are how a legacy `ws-goals.md` is understood, and how a vault that has
	// not been opened since gets its targets across.

	// settings → the store's two goals sections.
	goalsStoreApply(this: WordSmith, store?: Record<string, WsStructRow[]>) {
		const all = this.structureStore(store);
		const build = (goals: Record<string, number>, status: Record<string, string>) => {
			const keys = Array.from(new Set(
				Object.keys(goals || {}).concat(Object.keys(status || {})))).sort();
			const rows = [];
			for (const k of keys) {
				const v = parseInt(String((goals || {})[k]), 10);
				const st = (status || {})[k];
				// A path can carry a target, a flag, or both — marking a scene
				// finished must not require inventing a word count for it.
				if (!v && !st) continue;
				rows.push({ path: k, on: true,
					note: (v ? String(v) : '') + (v && st ? ' \u00b7 ' : '') + (st || '') });
			}
			return rows;
		};
		all[this.goalsSectionKey('file')] =
			build(this.settings.fileGoals, this.settings.fileStatus);
		// NO FOLDER FLAGS IN THE FILE. `{}` is passed at the CALL rather than by
		// touching `build`, which the notes section uses too — a folder TARGET is
		// still a real thing and still round-trips. A folder that carried only a
		// flag drops out of the section entirely, because build skips a path with
		// neither. The folders section: `goalsStoreAdopt` still LOOKS for one, so
		// an older vault is not read as a file with no goals at all.
		return all;
	},

	// …and back. Returns null when the store has no goals sections at all,
	// which is how the caller knows to look for a legacy file instead — an
	// EMPTY section is a different fact from a missing one, and reading them
	// as the same would let a vault whose writer deleted every target have
	// them all restored from a file that should have been retired.
	goalsStoreAdopt(this: WordSmith, store?: Record<string, WsStructRow[]>) {
		const all = this.structureStore(store);
		const fileKey = this.goalsSectionKey('file');
		const folderKey = this.goalsSectionKey('folder');
		if (!Object.prototype.hasOwnProperty.call(all, fileKey)
			&& !Object.prototype.hasOwnProperty.call(all, folderKey)) return null;
		const res: { fileGoals: Record<string, number>; fileStatus: Record<string, string> } = { fileGoals: {}, fileStatus: {} };
		// `statusInto` may be NULL, which is how folder flags are dropped. The
		// parse stays TOLERANT on purpose: a file written before folders lost
		// their flags still carries flag words on folder rows, and they are read
		// and thrown away rather than left to throw.
		const take = (rows: WsStructRow[] | undefined, into: 'fileGoals', statusInto: 'fileStatus' | null) => {
			for (const r of (rows || [])) {
				const value = String(r.note || '');
				const num = value.match(/\d[\d,\s]*/);
				const n = num ? parseInt(num[0].replace(/[,\s]/g, ''), 10) : 0;
				if (n > 0) res[into][r.path] = n;
				if (!statusInto) continue;
				const word = (value.match(/[A-Za-z]+/) || [''])[0].toLowerCase();
				if (word && wsStatusLabel(word)) res[statusInto][r.path] = word;
			}
		};
		take(all[fileKey], 'fileGoals', 'fileStatus');
		// A FOLDERS SECTION IS READ AND DROPPED. Its PRESENCE still counts above
		// — an older file whose only goals section is this one must not answer
		// "no goals anywhere", which would send the loader hunting for a legacy
		// file — but nothing it holds is stored.
		return res;
	},

	// ── THE FOLDER COLOURS LIVE HERE TOO ─────────────────────────────
	//
	// A colour a writer chose for a folder is authored work: it is
	// path-keyed, it is theirs, and re-picking nine of them is a loss.
	// Column widths and fold state are not — those cost a minute.
	//
	// THE SAME SHAPE AS THE GOALS, deliberately: one row per path, the
	// value after the dash, in a section of its own.
	//
	// THE ROOT IS `/`, WHICH THIS FILE ALREADY SAYS. `folderColors` can
	// carry the empty path, and a row with no path before the dash does
	// not parse back, so the colour would be written and silently lost.
	// `order: /` is how the root is already named in this store.
	colorsSectionKey(this: WordSmith) { return 'colors: folders'; },

	// ── AND WHICH PROPERTIES ARE COLUMNS ─────────────────────────────
	//
	// A writer who added eight properties as columns chose those eight out
	// of everything their vault carries; the VALUES are already in this
	// file, and only the choice of what to show was in data.json. Widths
	// and fold state stay there.
	//
	// THE TYPE RIDES WITH IT WHEN THERE IS ONE. `orgPropTypeChosen` reads
	// `c.type` BEFORE the registry, so it is the writer's answer overruling
	// Obsidian's — authored, and lost with the rest without this. A column
	// with no chosen type writes a bare row rather than inventing `text`,
	// which would pin it and silence the registry.
	userColsSectionKey(this: WordSmith) { return 'columns: user'; },

	userColsStoreApply(this: WordSmith, store?: Record<string, WsStructRow[]>) {
		const all = this.structureStore(store);
		const src = this.settings.uniUserCols || [];
		const rows = [];
		for (const c of src) {
			const key = String((c && c.key) || '').trim();
			if (!key) continue;
			const type = String((c && c.type) || '').trim();
			rows.push({ path: key, on: true, note: type });
		}
		all[this.userColsSectionKey()] = rows;
		return all;
	},

	// …and back. NULL when the section is absent — the same
	// unknown-is-not-empty rule the colours and the goals keep.
	//
	// THE EXISTING COLUMN OBJECT IS KEPT where the key still matches, so a
	// `sortAs` or a dragged width that this file does not carry is not
	// deleted by a round trip through it. The file decides WHICH columns
	// and their type; it does not claim to know the rest.
	userColsStoreAdopt(this: WordSmith, store?: Record<string, WsStructRow[]>) {
		const all = this.structureStore(store);
		const key = this.userColsSectionKey();
		if (!Object.prototype.hasOwnProperty.call(all, key)) return null;
		const had = this.settings.uniUserCols || [];
		const rows = all[key] || [];
		const out = [];
		for (const r of rows) {
			const k = String(r.path || '').trim();
			if (!k) continue;
			const was = had.filter((c) => c && String(c.key) === k)[0] || null;
			const col: WsUserCol = was ? Object.assign({}, was) : { key: k, label: k, sortAs: '' };
			const type = String(r.note || '').trim();
			if (type) col.type = type;
			else delete col.type;
			out.push(col);
		}
		// ROWS THAT NAME NOTHING ARE NOT AN EMPTY LIST (the colours' rule, kept
		// here so the two sections cannot drift): a section written wrongly, or
		// edited into nonsense, must not read as "the writer removed every
		// column".
		if (rows.length && !out.length) return null;
		return out;
	},

	colorsStoreApply(this: WordSmith, store?: Record<string, WsStructRow[]>) {
		const all = this.structureStore(store);
		const src = this.settings.folderColors || {};
		const rows = [];
		for (const k of Object.keys(src).sort()) {
			const v = String(src[k] || '').trim();
			if (!v) continue;
			rows.push({ path: k === '' ? '/' : k, on: true, note: v });
		}
		all[this.colorsSectionKey()] = rows;
		return all;
	},

	// …and back. NULL when the section is absent, which is how the caller
	// tells "this vault has never had colours" from "this writer removed
	// them all" — the same distinction `goalsStoreAdopt` draws, and for
	// the same reason: reading them as one would restore what was deleted.
	colorsStoreAdopt(this: WordSmith, store?: Record<string, WsStructRow[]>) {
		const all = this.structureStore(store);
		const key = this.colorsSectionKey();
		if (!Object.prototype.hasOwnProperty.call(all, key)) return null;
		const rows = all[key] || [];
		const res: Record<string, string> = {};
		for (const r of rows) {
			const v = String(r.note || '').trim();
			if (!v) continue;
			res[r.path === '/' ? '' : r.path] = v;
		}
		// ── ROWS THAT SAY NOTHING ARE NOT AN EMPTY LIST ────────────────
		//
		// A section with rows in it, none of which carries a value, is a
		// section that was written wrongly or edited into nonsense — NOT a
		// writer who removed every colour. Those two want opposite answers
		// and the difference is only visible here: a build that wrote the
		// section in the checkbox shape (`- [x] Book`, path kept, value
		// dropped) would otherwise read nine valueless rows as `{}` and let
		// the file win. SO THE ANSWER IS UNKNOWN, and settings keep what they
		// have. An empty SECTION still means empty — that is a writer's
		// deletion and it is honoured.
		if (rows.length && !Object.keys(res).length) return null;
		return res;
	},

	// The write, for when the goals are what changed. Same one file and the
	// same migration as any other write. IT CARRIES THE COLOURS AND THE
	// COLUMNS TOO: the name says goals because that is what it carried
	// first; what it IS is the one place settings reach the structure file,
	// and a second write path would be a second chance to forget one of
	// them.
	async goalsStoreWrite(this: WordSmith) {
		await this.structureRead();
		this.goalsStoreApply(this._structStore);
		this.colorsStoreApply(this._structStore);
		this.userColsStoreApply(this._structStore);
		await this.structureWrite();
	},

	// ── WHAT "UNCHANGED" MEANS, IN ONE PLACE ──────────────────────────
	//
	// Written once, read twice — to decide whether to write, and to record
	// what WAS written — because the two have to agree exactly or the
	// comparison means nothing. THE TWO FAILURE MODES ARE OPPOSITE AND
	// BOTH SILENT: shapes that differ write forever, shapes that agree on
	// too little write never.
	goalsSignature(this: WordSmith) {
		try {
			return JSON.stringify([this.settings.fileGoals,
				this.settings.fileStatus,
				this.settings.folderColors, this.settings.uniUserCols]);
		} catch { return ''; }
	},

	// Written only when the numbers differ from what is already there —
	// saveSettings runs on nearly every interaction in the plugin, and a
	// file modify on each of them would be noise in the vault and in sync.
	goalsFileSync(this: WordSmith) {
		// THE ORGANIZER'S SWITCH: no timer, no write, nothing to sync.
		if (this.settings.organizerOn === false) return;
		const sig = this.goalsSignature();
		if (!sig) return;
		if (sig === this._goalsSig) return;
		// Nothing to say and nothing said before: do not create a file of
		// empty sections in a vault that has never set a goal.
		if (sig === '[{},{},{},{}]' && !this._goalsWritten) return;
		// ── AND THE WRITE IS RECORDED WHEN IT LANDS ─────────────────────
		//
		// THE SIGNATURE IS NOT CACHED BEFORE THE WRITE. Set on the way IN, a
		// write that failed — or never ran — would leave the plugin believing
		// the file said what settings say; every later save would compare
		// against that lie and return early, and one failure would freeze the
		// file for the life of the vault with nothing said.
		//
		// AND THE DEBOUNCE CANNOT BE STARVED. Clearing the pending timer on
		// every call — in a function that runs on nearly every interaction —
		// means a vault that never goes 600ms quiet never writes at all;
		// typing in a note with history tracking on is exactly that vault. SO
		// THE TIMER IS LEFT ALONE ONCE SET: a write already coming will write
		// whatever is current when it runs (`goalsStoreWrite` reads the
		// settings at that moment, not now), so re-arming it buys nothing.
		// First change starts the clock; the write lands within 600ms
		// whatever else happens.
		if (this._goalsTimer) return;
		this._goalsTimer = window.setTimeout(() => {
			this._goalsTimer = null;
			// TAKEN AT WRITE TIME, not at schedule time: the settings may
			// have moved again while this was waiting, and the signature has
			// to describe what was actually written.
			const wrote = this.goalsSignature();
			this.goalsStoreWrite().then(() => {
				if (wrote) this._goalsSig = wrote;
				this._goalsWritten = true;
				this.storeWriteOk(WS_WRITE.goals);
			}).catch((e) => {
				// LEFT UNCACHED ON PURPOSE, so the next save tries again
				// rather than inheriting a claim that was never true.
				this.storeWriteFailed(WS_WRITE.goals, e,
					'They are still set here; the file will be tried again.');
			});
		}, 600);
	},

	// ── A FAILED WRITE REACHES THE WRITER, NOT ONLY THE CONSOLE ────────
	//
	// Ten writes carry a writer's work — the goals, the mirror, the
	// manuscript structure, a frontmatter property, a stored property, and
	// the follow-a-move walks. NOBODY OPENS A CONSOLE; the export already
	// says "export failed —" in a Notice for exactly this reason.
	//
	// ONE REPORTER, because ten bespoke messages is ten chances to write
	// the eleventh without one — the same argument as the one write path,
	// the one signature and the one path-store list.
	//
	// LATCHED PER SUBJECT: a vault that cannot be written stays that way,
	// and these run on debounces and on vault events, so without a latch
	// one broken disk paints a wall of toasts. Per SUBJECT rather than one
	// flag, so a property that will not save cannot silence the structure
	// file.
	//
	// AND THEY RETURN, so a caller reads as it did: `false` for the
	// failure and `true` for the way back.
	storeWriteFailed(this: WordSmith, subject: string, e: unknown, tail: string) {
		console.error('Word-Smith: could not ' + subject, e);
		if (!this._storeFailSaid) this._storeFailSaid = {};
		if (this._storeFailSaid[subject]) return false;
		this._storeFailSaid[subject] = true;
		const why = (e instanceof Error && e.message) ? String(e.message) : wsStr(e);
		try {
			new Notice('Word-Smith: could not ' + subject
				+ (why ? ' \u2014 ' + why : '')
				+ (tail ? '. ' + tail : '.'), 12000);
		} catch (_) { wsCatch('storeWriteFailed: new Notice(\'Word-Smith: could not \' + subject', _); }
		return false;
	},

	// …AND THE WAY BACK. Called on the success path of the same writer,
	// so the next failure of THAT subject is news again. Answers `true`
	// for the same reason its twin answers `false`: a caller can return
	// it, and a success arm that has to be remembered separately is the
	// half that gets forgotten.
	storeWriteOk(this: WordSmith, subject: string) {
		if (this._storeFailSaid) this._storeFailSaid[subject] = false;
		return true;
	},

	// At startup the FILE wins, because it is the copy a writer can have
	// edited between sessions — and because a goal they typed into a note
	// is a goal they meant. Only when it actually parses: a half-deleted
	// marker should leave the working copy alone rather than wipe it.
	//
	// READS EITHER SHAPE, and the merged file wins. A legacy `ws-goals.md` is
	// only consulted when the structure file has no goals sections at all —
	// once it has them it is the authority, and a `ws-goals.md` still lying
	// about in a vault that syncs slowly cannot put a stale target back.
	async goalsFileLoad(this: WordSmith) {
		try {
			const store = await this.structureRead();
			let parsed = this.goalsStoreAdopt(store);
			if (!parsed) {
				// Nothing merged yet: the legacy file, if there is one. Its
				// path is remembered so the first write can retire it — the
				// contents are about to live in the structure file, and two
				// files claiming the same targets is how one of them gets read
				// at the next startup.
				const found = await this.goalsFileFind();
				const f = found ? this.app.vault.getAbstractFileByPath(found) : null;
				if (f && !f.children) {
					parsed = this.goalsFileParse(await this.app.vault.read(f));
					if (parsed) this._goalsFoldedFrom = found;
				}
			}
			if (!parsed) {
				// No goals anywhere: seed from whatever data.json already has,
				// so an upgrading vault gets its targets into the open rather
				// than only new ones.
				this._goalsSig = null;
				this.goalsFileSync();
				return;
			}
			this.settings.fileGoals = parsed.fileGoals;
			this.settings.fileStatus = parsed.fileStatus || {};
			// THE COLOURS ADOPT SEPARATELY, because their section can be absent
			// while the goals sections are present — a vault upgrading from before
			// this existed has goals and no colours, and taking `null` as "the
			// writer removed them all" would wipe what data.json still holds.
			// Absent means UNKNOWN here, exactly as it does for the goals sections
			// one function up.
			const colors = this.colorsStoreAdopt(store);
			if (colors) this.settings.folderColors = colors;
			const ucols = this.userColsStoreAdopt(store);
			if (ucols) this.settings.uniUserCols = ucols;
			// THROUGH THE ONE WRITER OF THE SHAPE. A signature built by hand here
			// drifts from `goalsSignature` — one element short, and the first save
			// after every start writes the file for no change, a symptom nobody
			// asks for. SAFE HERE because everything it reads has just been
			// assigned: the goals above, the colours and the columns adopted
			// between.
			this._goalsSig = this.goalsSignature();
			this._goalsWritten = true;
		} catch (_) { wsCatch('goalsFileLoad: const store = await this.structureRead();', _); }
	},

	// ── ws-settings.md — A MIRROR, AND ONLY A MIRROR ────────────────────────
	//
	// data.json stays authoritative. Obsidian's whole settings lifecycle is
	// built on it, and a plugin that read its live settings out of a vault
	// note would earn a sync conflict on every toggle — the note is being
	// written while the writer is still flicking switches, and the flick after
	// the conflict reads back somebody else's state.
	//
	// So this is ONE-DIRECTIONAL. Written on change, debounced. Read in
	// exactly two situations, both of which mean "there is no data.json to
	// disagree with": a reinstall, and a vault restored from a backup that
	// kept the notes and not the plugin folder. That is the whole case for it
	// — every other store in this plugin already survives a reinstall, and the
	// settings were the one thing that did not.
	//
	// A FENCED JSON BLOCK, not a table of key-value lines. The settings hold
	// nested objects and arrays — the status-bar rows, the flag definitions —
	// and a markdown table of them would be readable and lossy, which is the
	// worst of the two. This is readable AND exact.
	settingsMirrorPathFor(this: WordSmith) {
		const want = wsPathNorm(this.settings.settingsMirrorPath);
		return want || 'Word-Smith/ws-settings.md';
	},

	// Keys the mirror never restores.
	//
	// MACHINE keys describe the computer, and a restore is exactly the case
	// where it is a different computer: a font that is installed here may not
	// be there, and a flag recording that a one-off migration already ran says
	// nothing about the vault it is being read into.
	// ── AND THE ANSWER TO "WINDOW-CONTROL COLOURS" ──────────────────────────
	//
	// The brief that asked for this list named two things to skip: installed
	// fonts and window-control colours. The first is `editorFont`. The second
	// does not exist as a setting and never did — `applyWindowControlOverlay`
	// reads `--titlebar-background` and `--text-muted` off the computed style
	// and hands them to Electron, and the only thing kept between calls is
	// `_wcoWas`, a runtime field for putting the frame back as it was found.
	// Nothing about the window controls is in `data.json`, so there is nothing
	// here to skip. That question is closed rather than open.
	//
	// `zenTitlebarMatch` WAS in this list on a guess and has been taken out.
	// The test for skipping a key is not "does it concern the desktop" but
	// "would restoring it be WRONG somewhere else" — a font that is not
	// installed on the new machine is wrong; a preference about the titlebar
	// in zen mode is merely inert on a phone, and skipping it would cost a
	// writer a choice they had made for no gain at all.
	settingsMirrorMachineKeys(this: WordSmith) {
		return ['editorFont', 'editorFontDefaultCleared'];
	},

	// VAULT keys name files. They are right on a reinstall into the same vault
	// and wrong in anybody else's, where they would point the plugin at
	// addresses that hold nothing — so they ride on the stamp: same vault
	// name, restore them; different vault, leave the defaults alone and let
	// the stores find themselves the way they already do.
	settingsMirrorVaultKeys(this: WordSmith) {
		return ['goalsPath', 'exportListPath', 'structurePath',
			'historyFilePath', 'settingsMirrorPath', 'scopePaths'];
	},

	vaultName(this: WordSmith) {
		try { return String(this.app.vault.getName() || ''); } catch { return ''; }
	},

	// ── WHAT "EVERYTHING" IS CALLED, SAID ONCE ────────────────────────
	//
	// "All of myNotes": it names the thing rather than describing it, and
	// it agrees with the tree's root row, which says the vault's own name.
	// A METHOD RATHER THAN A CONSTANT, because it reads the vault, and one
	// rather than five because the phrase was written out at five call
	// sites across three files — which is how a rename becomes four
	// renames and one place that still says the old thing.
	vaultWhole(this: WordSmith) {
		return 'All of ' + (this.vaultName() || 'the vault');
	},

	settingsMirrorCompose(this: WordSmith) {
		// ── THE WRITER'S CLOCK, NOT THE SERVER'S ─────────────────
		//
		// `toISOString()` is UTC; a writer on UTC+3 who saved at twenty to
		// nine and reads twenty to six answers "is this copy current?" wrong —
		// and that is the one question this line answers, in a note every
		// other line of which is addressed to a person. SAFE TO CHANGE THE
		// FORMAT: nothing reads it back (`settingsMirrorParse` returns the
		// field and no caller uses it). Same layout, local zone.
		const stamp = new Date();
		const p2 = (v: number) => String(v).padStart(2, '0');
		const iso = stamp.getFullYear() + '-' + p2(stamp.getMonth() + 1)
			+ '-' + p2(stamp.getDate()) + ' ' + p2(stamp.getHours())
			+ ':' + p2(stamp.getMinutes()) + ':' + p2(stamp.getSeconds());
		const out = [];
		out.push('A readable copy of Word-Smith\u2019s settings, written whenever they');
		out.push('change. It is a MIRROR: the plugin does not read it while it has');
		out.push('settings of its own, so editing it here changes nothing. It exists so a');
		out.push('reinstall \u2014 or a vault restored from a backup that kept the notes and');
		out.push('not the plugin folder \u2014 can get everything back.');
		out.push('');
		out.push('- vault: ' + (this.vaultName() || '(unnamed)'));
		out.push('- written: ' + iso);
		out.push('');
		let json = '{}';
		try { json = JSON.stringify(this.settings, null, 2); } catch (_) { wsCatch('settingsMirrorCompose: json = JSON.stringify(this.settings, null, 2);', _); }
		out.push('```json');
		out.push(json);
		out.push('```');
		return SETTINGS_MARK_START + '\n' + out.join('\n') + '\n' + SETTINGS_MARK_END + '\n';
	},

	settingsMirrorParse(this: WordSmith, text: string) {
		const body = String(text || '');
		const a = body.indexOf(SETTINGS_MARK_START);
		const b = body.indexOf(SETTINGS_MARK_END);
		if (a === -1 || b === -1 || b < a) return null;
		const inner = body.slice(a + SETTINGS_MARK_START.length, b);
		const vault = (inner.match(/^-\s*vault:\s*(.*)$/m) || [])[1] || '';
		const written = (inner.match(/^-\s*written:\s*(.*)$/m) || [])[1] || '';
		const fence = inner.match(/```json\s*([\s\S]*?)```/);
		if (!fence) return null;
		let settings: Record<string, unknown> | null = null;
		try { settings = JSON.parse(fence[1]) as Record<string, unknown>; } catch { return null; }
		if (!settings || typeof settings !== 'object') return null;
		return { vault: vault.trim(), written: written.trim(), settings };
	},

	// The two situations, and no third. `raw` is what `loadData` answered —
	// null when the file is not there, `{}` when it is there and empty.
	settingsMirrorShouldRestore(this: WordSmith, raw: unknown) {
		if (!raw || typeof raw !== 'object') return true;
		return Object.keys(raw).length === 0;
	},

	settingsMirrorRestorable(this: WordSmith, parsed: { vault?: string; written?: string; settings?: Record<string, unknown> } | null, intoVault: string) {
		const out: Record<string, unknown> = {};
		if (!parsed || !parsed.settings) return out;
		const skip = new Set(this.settingsMirrorMachineKeys());
		const sameVault = !!parsed.vault && parsed.vault === String(intoVault || '');
		if (!sameVault) for (const k of this.settingsMirrorVaultKeys()) skip.add(k);
		for (const k of Object.keys(parsed.settings)) {
			if (skip.has(k)) continue;
			out[k] = parsed.settings[k];
		}
		return out;
	},

	// Written only when the settings have actually changed. saveSettings runs
	// on nearly every interaction in the plugin — the same reason the goals
	// file is signature-guarded, and the same guard. THE VAULT SAYS THE
	// MIRROR IS GONE: a mirror deleted in the vault would otherwise stay gone
	// until some setting moved. Forgetting the last write here makes the next
	// save a first. Not a write of its own: a file the writer just deleted
	// must not reappear under their hand; it returns with the next save.
	settingsMirrorForget(this: WordSmith, path: string) {
		if (!path) return;
		const at = this._mirrorFoundAt || this.settingsMirrorPathFor();
		if (path !== at) return;
		this._mirrorSig = '';
		this._mirrorFoundAt = null;
	},

	async settingsMirrorWrite(this: WordSmith) {
		if (!this.settings.settingsMirror) return;
		let sig = '';
		try { sig = JSON.stringify(this.settings); } catch { return; }
		if (sig === this._mirrorSig) return;
		const text = this.settingsMirrorCompose();
		try {
			// ONE SUCCESS POINT, NOT TWO. An early `return` in the
			// found-and-modified arm — the COMMON one — would hang the latch's
			// re-arm off the rare path and never the usual one, so a mirror that
			// failed once would go quiet for ever. Leave one place to remember.
			const found = await this.storeFind(SETTINGS_MARK_START,
				this.settings.settingsMirrorPath, [], this._mirrorFoundAt);
			const f = found
				? this.app.vault.getAbstractFileByPath(found) : null;
			if (found && f && !f.children) {
				// `process`, not `modify`: one turn of the vault, and a mirror that
				// already says this — the first save after a restart, when the
				// signature is forgotten — is not written again. Nor for its line
				// endings alone.
				await this.app.vault.process(f, (was) => this.storeHandBack(found, was, text));
				this._mirrorFoundAt = found;
			} else {
				// A PATH THAT WAS FOUND BUT IS NOT A FILE falls here too, which
				// is what the old `if (found)` block did by falling out of it.
				const path = this.settingsMirrorPathFor();
				await this.storeEnsureFolder(path);
				await this.app.vault.create(path, text);
				this._mirrorFoundAt = path;
			}
			this._mirrorSig = sig;
			this.storeWriteOk(WS_WRITE.mirror);
		} catch (e) {
			this.storeWriteFailed(WS_WRITE.mirror, e,
				'data.json still has them; this file is the copy that '
				+ 'survives an uninstall.');
		}
	},

	// Debounced, because the mirror is the least urgent thing in the plugin: a
	// few seconds behind is invisible, and a write per keystroke in a colour
	// picker is not.
	//
	// ── AND IT CANNOT BE STARVED ───────────────────────────────────────
	//
	// Clearing the pending timer on every call — in a function
	// `saveSettings` reaches on nearly every interaction, with a FOUR
	// SECOND window — means a vault that never goes four seconds quiet
	// never writes the mirror at all. AND THE MIRROR IS THE WHOLE SAFETY
	// NET: `settingsMirrorShouldRestore` answers yes only when data.json is
	// EMPTY, which is exactly the uninstall it exists for, and a mirror
	// that stopped being written months ago restores a vault as it was
	// months ago and says nothing about the difference. A TIMER ALREADY
	// SET IS LEFT ALONE: the write composes from the settings when it
	// RUNS, so re-arming buys nothing. First change starts the clock; the
	// mirror is at most four seconds behind, always.
	settingsMirrorSync(this: WordSmith) {
		if (!this.settings.settingsMirror) return;
		if (this._mirrorTimer) return;
		this._mirrorTimer = window.setTimeout(() => {
			this._mirrorTimer = null;
			this.settingsMirrorWrite().catch(() => {});
		}, 4000);
	},

	// The restore. Called once, at load, and only when data.json had nothing
	// to say — see `settingsMirrorShouldRestore`.
	async settingsMirrorRestore(this: WordSmith, raw: unknown) {
		if (!this.settings.settingsMirror) return false;
		if (!this.settingsMirrorShouldRestore(raw)) return false;
		try {
			const found = await this.storeFind(SETTINGS_MARK_START,
				this.settings.settingsMirrorPath, [], null);
			if (!found) return false;
			const f = this.app.vault.getAbstractFileByPath(found);
			if (!f || f.children) return false;
			const parsed = this.settingsMirrorParse(await this.app.vault.read(f));
			if (!parsed) return false;
			const take = this.settingsMirrorRestorable(parsed, this.vaultName());
			if (!Object.keys(take).length) return false;
			Object.assign(this.settings, take);
			this._mirrorFoundAt = found;
			// The mirror is now what data.json says, so saving it back is the
			// thing that makes the restore stick — and it is the ONE write this
			// direction ever does. A FAILURE HERE IS SAID: this is the RESTORE —
			// a writer has reinstalled, data.json is empty, and the mirror is
			// being read back into it — and with the failure thrown away the
			// function would still answer TRUE, the settings would come back on
			// screen, nothing would reach the disk, and the next start would lose
			// them again. STILL TRUE, THOUGH, and deliberately: the settings ARE
			// restored — in memory, which is what the caller acts on — and the
			// next `saveSettings` tries the write again under the same latch.
			try { await this.saveData(this.settings); }
			catch (e) {
				this.storeWriteFailed(WS_WRITE.settings, e,
					'They are back for this session and will be written again '
					+ 'on the next change.');
			}
			return true;
		} catch { return false; }
	},
	renameGoalPaths(this: WordSmith, oldPath: string, newPath: string) {
		if (!oldPath || !newPath || oldPath === newPath) return false;
		let changed = false;
		// THE STATUS MAPS FOLLOW A RENAME TOO. They are keyed by path like
		// the targets, so a chapter renamed without this keeps its goal and
		// silently loses where it was up to.
		//
		// EVERY PATH-KEYED MAP IN SETTINGS BELONGS IN THIS LIST
		// (`goalPathStores`). `folderColors` was once left out and was lost by
		// every move — a colour set on a folder, gone the moment the folder
		// was filed somewhere. A new store keyed by a vault path goes there; a
		// store that is not in the list does not survive a move, and nothing
		// anywhere will say so.
		for (const which of this.goalPathStores()) {
			const map = this.settings[which];
			if (!map || typeof map !== 'object') continue;
			for (const key of Object.keys(map)) {
				let next = null;
				if (key === oldPath) next = newPath;
				else if (key.startsWith(oldPath + '/')) next = newPath + key.slice(oldPath.length);
				if (next === null || next === key) continue;
				// If something already sits at the destination it wins: the
				// user set that one deliberately and more recently.
				if (!Object.prototype.hasOwnProperty.call(map, next)) map[next] = map[key];
				delete map[key];
				changed = true;
			}
		}
		// ── AND THE MANUSCRIPT MARKS, WHICH ARE A LIST RATHER THAN A MAP ────
		//
		// Reported from a vault: a folder marked as a manuscript, dragged
		// into an unmarked folder, LOST THE MARK — and with the mark went
		// its place in the Outliner, which is built from the roots. The
		// folder was still there and still full of chapters; the plugin had
		// simply stopped believing it was the writing.
		//
		// It is the same fault as the maps above and it needed its own code
		// only because `manuscriptRoots` is an ARRAY of paths, so there is
		// no key to move — the entry is rewritten in place.
		//
		// A PREFIX WALK, not an equality test. Marking `Book` and moving
		// `Book/Part One` is the ordinary case where nothing should change;
		// marking `Book/Part One` and moving `Book` has to carry the nested
		// mark along with everything else that moved.
		//
		// NO DUPLICATES. Moving `Book` onto a path that is already marked
		// would otherwise leave the same folder in the list twice, and every
		// reading that counts roots would count it twice.
		return changed;
	},

	// ── AND THE SAME LIST, FOR A DELETE ──────────────────────────────────
	//
	// The vault's `delete` handler forgets the scope, the history and the
	// ORDER row; without this the path-keyed maps above keep a deleted
	// note's target and flag for ever, at an address nothing can reach. IT
	// IS NOT MERELY UNTIDY: `renameGoalPaths` refuses to overwrite a key
	// that already exists, on the argument that the one already there was
	// set deliberately and more recently — so a stale entry at a path the
	// writer later re-uses would BEAT the new one, and a fresh note be born
	// wearing a deleted note's goal.
	//
	// ONE LIST, READ TWICE: this reads the same array `renameGoalPaths`
	// does, so a store added there is forgotten here without anybody
	// remembering to. A PREFIX WALK, because folders fire `delete` too and
	// one call has to take everything inside with it.
	forgetGoalPaths(this: WordSmith, path: string) {
		if (!path) return false;
		let changed = false;
		for (const which of this.goalPathStores()) {
			const map = this.settings[which];
			if (!map || typeof map !== 'object') continue;
			for (const key of Object.keys(map)) {
				if (key !== path && !key.startsWith(path + '/')) continue;
				delete map[key];
				changed = true;
			}
		}
		return changed;
	},

	// THE LIST ITSELF, so the rename arm and the delete arm cannot disagree
	// about what a path-keyed store is. `folderStatus` and `folderGoals` are
	// deliberately absent: folders have no flags and no typed targets, and
	// carrying a dead key through a move — or forgetting it on a delete —
	// keeps it alive.
	goalPathStores(this: WordSmith): ('fileGoals' | 'fileStatus' | 'folderColors')[] {
		return ['fileGoals', 'fileStatus', 'folderColors'];
	},

	async renameScopePath(this: WordSmith, oldPath: string, newPath: string) {
		if (!this.hasScopeLimits() || !oldPath || !newPath) return;
		const list = this.settings.scopePaths;
		let changed = false;
		for (let i = 0; i < list.length; i++) {
			if (list[i] === oldPath) { list[i] = newPath; changed = true; }
			else if (list[i].startsWith(oldPath + '/')) {
				list[i] = newPath + list[i].slice(oldPath.length);
				changed = true;
			}
		}
		if (changed) await this.saveSettings(true);
	},

	async removeScopePath(this: WordSmith, path: string) {
		if (!this.hasScopeLimits() || !path) return;
		const list = this.settings.scopePaths;
		const next = list.filter(p => p !== path && !p.startsWith(path + '/'));
		if (next.length !== list.length) {
			this.settings.scopePaths = next;
			await this.saveSettings(true);
		}
	},

	// ── The export list, kept in a file the writer owns ─────────────────────
	//
	// Which scenes are in, and in what order, is worth more than the export
	// itself: reordering ninety of them and losing it when the window shuts
	// is worse than never having had the drag. It goes in a plain markdown
	// file with markers, exactly like `ws-history.md` and for the same
	// reasons — a writer can read it, edit it, move it, and keep it after
	// this plugin is gone. Settings JSON would be none of those things.
	// WHERE A STORE LIVES, and the migration in one place. The configured
	// path is what a NEW file is made at; an existing one keeps its home.
	// An upgrading vault has `ws-goals.md` in the root, and the default
	// moving to `Word-Smith/` must not orphan it — that would look exactly
	// like the plugin having forgotten every goal.
	storeResolve(this: WordSmith, configured: string, legacy: string) {
		const want = wsPathNorm(configured) || wsPathNorm(legacy);
		try {
			const at = this.app.vault.getAbstractFileByPath(want);
			if (at && !at.children) return want;
			// Nothing at the new address: if the old one is there, it is
			// the writer's file and it stays where they have it.
			const old = this.app.vault.getAbstractFileByPath(legacy);
			if (old && !old.children) return legacy;
		} catch (_) { wsCatch('storeResolve: const at = this.app.vault.getAbstractFileByPath(want);', _); }
		return want;
	},

	// ── A STORE FOLLOWS ITS OWN FILE ────────────────────────────────────────
	//
	// The three files this plugin keeps in the vault — the goals, the export
	// list, the history — are found at a path held in settings. A folder
	// rename moves everything inside it: rename `Word-Smith`, or keep the
	// goals in a book folder and rename the book, and the configured path
	// names nothing; the next write would find nothing there and make a NEW,
	// empty file at the old address — which the plugin would then read at
	// startup. Renaming a folder rewrites every path UNDER it, which is why
	// this tests for the prefix as well as the path itself; Obsidian fires
	// one rename for the folder and none for its children.
	storeRenameFollow(this: WordSmith, oldPath: string, newPath: string) {
		if (!oldPath || !newPath || oldPath === newPath) return false;
		const moved = (p2: string | null) => {
			const cur = String(p2 || '');
			if (!cur) return null;
			if (cur === oldPath) return newPath;
			if (cur.indexOf(oldPath + '/') === 0) return newPath + cur.slice(oldPath.length);
			return null;
		};
		let changed = false;
		for (const key of ['goalsPath', 'exportListPath', 'structurePath',
			'settingsMirrorPath', 'historyFilePath']) {
			const next = moved(wsBag(this.settings)[key] as string);
			if (!next) continue;
			wsBag(this.settings)[key] = next;
			changed = true;
		}
		// The history remembers where it FOUND its file, separately from the
		// setting, and that copy is what every later write uses.
		const foundNext = moved(this._historyPath);
		if (foundNext) { this._historyPath = foundNext; changed = true; }
		// …and the goals' own memory of where it found itself, for the same
		// reason: the search is cheap but it is not free, and a rename is
		// the one move we are actually told about.
		const goalsNext = moved(this._goalsFoundAt);
		if (goalsNext) { this._goalsFoundAt = goalsNext; changed = true; }
		const exportNext = moved(this._structFoundAt);
		if (exportNext) { this._structFoundAt = exportNext; changed = true; }
		const mirrorNext = moved(this._mirrorFoundAt);
		if (mirrorNext) { this._mirrorFoundAt = mirrorNext; changed = true; }
		return changed;
	},

	// ── FINDING A STORE WHEREVER IT ENDED UP ────────────────────────────────
	//
	// A file can leave its address in ways no rename event describes — moved
	// while Obsidian was shut, restored from a backup, synced in from another
	// machine — so the stores find themselves by the marker they carry, as
	// the history does. The search is cheapest-first and stops at the
	// first hit, and the answer is remembered for the session — the full
	// read of the vault only happens when a file has been both moved AND
	// renamed, which is the rarest case and the only one worth a scan.
	//
	// Applied to the goals and the export list; the history keeps its own
	// copy of this (`historyFindFile`) because it also caches which file it
	// is writing to across a session.
	// `marker` and `legacy` each take a string OR a list. The structure store
	// has to answer to two markers and three old addresses, because it is two
	// files that became one; the history still passes a single string and is
	// unaffected.
	async storeFind(this: WordSmith, marker: string | string[], configured: string, legacy: string | string[], remembered: string | null) {
		const vault = this.app.vault;
		const marks = ([] as string[]).concat(marker).filter(Boolean);
		const olds  = ([] as string[]).concat(legacy).filter(Boolean);
		// THE TYPED PATH IS NORMALISED HERE TOO. `structureStorePath`
		// normalises what it hands out, but the callers of this hand in the
		// SETTING as typed — a pasted `Word-Smithws-structure.md` would not be
		// found by name, its "base name" would be the whole string, and the
		// store would be found by the last resort: reading every note in the
		// vault until a marker matched. The same normaliser, at the door.
		const conf = wsPathNorm(configured);
		const check = async (file: TAbstractFile | null) => {
			if (!file || file.children) return false;
			try {
				const text = String(await vault.cachedRead(file));
				return marks.some((m: string) => text.indexOf(m) !== -1);
			}
			catch { return false; }
		};
		// 1. The one we were using, if it is still there and still ours.
		if (remembered) {
			const f = vault.getAbstractFileByPath(remembered);
			if (f && await check(f)) return f.path;
		}
		// 2. Where the setting says it should be, and where it used to be.
		for (const want of [conf].concat(olds)) {
			if (!want) continue;
			const at = vault.getAbstractFileByPath(want);
			if (at && await check(at)) return at.path;
		}
		let all = [];
		try { all = vault.getMarkdownFiles() || []; } catch { return null; }
		// 3. The same FILENAME anywhere in the vault — the move-it-to-a-
		//    folder case, which is the common one, tried before any reading
		//    of files nobody named. Every name it has ever had counts: a
		//    vault that moved `ws-export.md` into its book folder and has
		//    not been opened since is found here and not by the full scan.
		const bases = [String(conf || olds[0] || '')].concat(olds)
			.map(p => (String(p).split('/').pop() || '').toLowerCase()).filter(Boolean);
		const named = all.filter(f => bases.some(b =>
			f.path.toLowerCase().endsWith('/' + b) || f.path.toLowerCase() === b));
		for (const f of named) if (await check(f)) return f.path;
		// 4. Moved AND renamed. Read the rest, smallest first: a store is a
		//    table of short rows, so a 2MB note is not it.
		const rest = all.filter(f => named.indexOf(f) === -1)
			.filter(f => !f.stat || f.stat.size < 400000)
			.sort((a, b) => (a.stat ? a.stat.size : 0) - (b.stat ? b.stat.size : 0));
		for (const f of rest) if (await check(f)) return f.path;
		return null;
	},

	// The goals file, found rather than assumed. The answer is kept for the
	// session so the search runs once; a rename updates it in place, and a
	// write that finds the file gone starts the search again.
	async goalsFileFind(this: WordSmith) {
		if (this._goalsFoundAt) {
			const at = this.app.vault.getAbstractFileByPath(this._goalsFoundAt);
			if (at && !at.children) return this._goalsFoundAt;
			this._goalsFoundAt = null;
		}
		const found = await this.storeFind(GOALS_MARK_START,
			this.settings.goalsPath, 'ws-goals.md', this._goalsFoundAt);
		if (found) {
			this._goalsFoundAt = found;
			// The setting follows the file, so the settings pane tells the truth
			// about where it is and a later session starts there. `saveData` AND
			// NOT `saveSettings`, deliberately: this runs while a store is being
			// FOUND, and the full save drags the flags, the goals file, the mirror
			// and a refresh behind it. A failed write is reported UNDER THE
			// SETTINGS SUBJECT, so it shares a latch with the other writers of
			// that file: the cause is the same one and the writer needs telling
			// once.
			if (this.settings.goalsPath !== found) {
				this.settings.goalsPath = found;
				try { await this.saveData(this.settings); }
				catch (e) {
					this.storeWriteFailed(WS_WRITE.settings, e,
						'Word-Smith will look for the file again next time.');
				}
			}
		}
		return found;
	},

	// Makes the folder a store is about to be written into. Silent when it
	// is already there, and silent when the path has no folder at all.
	async storeEnsureFolder(this: WordSmith, path: string) {
		const cut = String(path || '').lastIndexOf('/');
		if (cut <= 0) return;
		const folder = path.slice(0, cut);
		try {
			const at = this.app.vault.getAbstractFileByPath(folder);
			if (at && at.children) return;
			await this.app.vault.createFolder(folder);
		} catch { /* already there, or a note by that name: the write reports */ }
	},

	// WHERE THE STORE IS, or where it will be the moment anything writes.
	// One meaning, because the callers want one: the settings pane says "right
	// now it's at", `isStoreFile` asks "is this note ours", and the tree's
	// adopt asks "did OUR file just change". A found file answers all three;
	// a vault that has never written one answers with the address it would be
	// created at.
	structurePathNow(this: WordSmith) {
		if (this._structFoundAt) return this._structFoundAt;
		const legacy = this.structureLegacyPaths();
		for (const p of legacy) {
			try {
				const f = this.app.vault.getAbstractFileByPath(p);
				if (f && !f.children) return p;
			} catch (_) { wsCatch('structurePathNow: const f = this.app.vault.getAbstractFileByPath(p);', _); }
		}
		return this.structureStorePath();
	},

	// ── WHERE THE STRUCTURE STORE LIVES, AND WHAT IT USED TO BE CALLED ──────
	//
	// `ws-export.md` and `ws-goals.md` are one file now — `ws-structure.md`.
	// Everything below is the migration, and the migration is the work: the
	// rename is three lines of it.
	//
	//   > READ EITHER NAME. WRITE ONLY THE NEW ONE.
	//   > RENAME ON FIRST WRITE, NEVER AT LOAD.
	//
	// Load is inert on purpose. A load that rewrites the vault turns "I opened
	// Obsidian on the laptop" into a sync conflict against the desktop that
	// was mid-write, and it does it to every vault at once on the update — the
	// one moment when nobody is watching for it and everybody has both
	// machines open. So the first thing that WANTS to write is the thing that
	// pays for the rename, and a session that only reads leaves the disk
	// exactly as it found it.

	// Every address the structure store has ever had, most recent first. The
	// configured legacy paths come first because a writer who moved either
	// file said where they wanted it.
	structureLegacyPaths(this: WordSmith) {
		const out: string[] = [];
		const add = (p: string) => {
			const s = String(p || '').replace(/^\/+/, '');
			if (s && out.indexOf(s) === -1) out.push(s);
		};
		add(this.settings.exportListPath);
		add('Word-Smith/ws-export.md');
		add('ws-export.md');
		return out;
	},

	// Where a NEW structure file is created, or where an old one is renamed to.
	//
	// THE FOLDER IS THE WRITER'S, THE NAME IS OURS. A store that was moved
	// into a book folder stays in that book folder and only changes its name;
	// dragging it back to `Word-Smith/` would be the plugin overruling a
	// choice somebody made deliberately, and it is the exact move that made a
	// second file appear the last time it was tried.
	structureStorePath(this: WordSmith, from?: string) {
		const at = String(from || '');
		if (at) {
			const cut = at.lastIndexOf('/');
			return (cut === -1 ? '' : at.slice(0, cut + 1)) + STRUCT_BASENAME;
		}
		const want = wsPathNorm(this.settings.structurePath);
		return want || ('Word-Smith/' + STRUCT_BASENAME);
	},

	// Every file on disk that is currently claiming to be the structure store,
	// newest first. Usually one. TWO is the half-synced vault: one machine
	// upgraded and wrote `ws-structure.md`, the other is still on the old
	// build and has gone on writing `ws-export.md`. Both are the writer's,
	// both are real work, and picking one and dropping the other is how a book
	// loses a chapter's place in the running order — so both are read and
	// merged, and the newer one wins where they disagree.
	async structureSources(this: WordSmith) {
		const vault = this.app.vault;
		const seen = new Set();
		const out: { path: string; text: string; legacy: boolean; mtime: number }[] = [];
		const take = async (path: string | null | undefined) => {
			if (!path || seen.has(path)) return;
			seen.add(path);
			let f: TAbstractFile | null = null;
			try { f = vault.getAbstractFileByPath(path); } catch { return; }
			if (!f || f.children) return;
			let text = '';
			try { text = String(await vault.cachedRead(f)); } catch { return; }
			const isNew = text.indexOf(STRUCT_MARK_START) !== -1;
			if (!isNew && text.indexOf(EXPORT_MARK_START) === -1) return;
			out.push({
				path: f.path, text, legacy: !isNew,
				mtime: (wsStatOf(f) || { mtime: 0 }).mtime || 0
			});
		};
		await take(this._structFoundAt);
		await take(this.structureStorePath());
		for (const p of this.structureLegacyPaths()) await take(p);
		// Nothing at any name we know: the file has been moved, or moved AND
		// renamed. One answer is enough there — a vault that has hidden its
		// store somewhere unnamed does not also have a second copy of it.
		if (!out.length) {
			const found = await this.storeFind([STRUCT_MARK_START, EXPORT_MARK_START],
				this.settings.structurePath, this.structureLegacyPaths(), this._structFoundAt);
			await take(found);
		}
		// Newest first; where two were written in the same millisecond the
		// one already on the new name wins, because it was written by the
		// build that knows about both.
		out.sort((a, b) => (b.mtime - a.mtime) || (Number(a.legacy) - Number(b.legacy)));
		return out;
	},

	// The loser of a both-files-present merge is not deleted. It is a note in the writer's vault — it can be linked to, it can be open
	// in a tab, and it may have their own prose outside the markers. So it is
	// RETIRED instead: the marker block becomes one line saying where its
	// contents went. Losing the markers is the point, and it is enough: a
	// store is found by its marker, so a file without one can never be read
	// back as a store and can never merge a stale half in again.
	async storeRetire(this: WordSmith, path: string, wentTo: string) {
		try {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (!f || f.children) return;
			const note = 'Word-Smith kept what was here in [[' + wentTo + ']].';
			// ONE TURN OF THE VAULT. `read` and `modify` each take a turn of the
			// adapter's queue, and the writer saving this very note can take the
			// turn between them: the plugin then writes over what they just typed.
			// `process` reads, replaces and writes inside one turn, and writes
			// nothing when the text comes back unchanged.
			await this.app.vault.process(f, (was) => {
				let next = String(was);
				for (const [s, e] of [[STRUCT_MARK_START, STRUCT_MARK_END],
					[EXPORT_MARK_START, EXPORT_MARK_END], [GOALS_MARK_START, GOALS_MARK_END]]) {
					const a = next.indexOf(s), b = next.indexOf(e);
					if (a === -1 || b === -1 || b < a) continue;
					next = next.slice(0, a) + note + next.slice(b + e.length);
				}
				return next;
			});
			// CONSOLE ONLY, the one exception to the reporter: retiring the legacy
			// goals file is housekeeping with no visible effect — the goals have
			// already been read out of it and the live copy is elsewhere. A toast
			// here would be the plugin telling a writer about its own filing.
		} catch (e) { console.error('Word-Smith: could not retire ' + path, e); }
	},

	// Called by the first write, and by nothing else. Returns the path the
	// store is to be written to, having moved whatever was there onto the new
	// name — by RENAMING, so the file keeps its identity, its creation date
	// and any links pointing at it. A copy would leave the writer with two
	// files and no way to tell which one the plugin is reading, which is the
	// bug this whole arrangement exists to remove.
	async structureMigrate(this: WordSmith) {
		let sources = this._structSources || [];
		// ── A CACHE IS NOT AN ANSWER ABOUT THE VAULT ──────────────────────
		//
		// `_structSources` is a CACHE. Read here, an empty one says "this
		// vault has no store", which sends the write to `structureStorePath()`
		// and `vault.create` makes the folder and the file — a fresh, empty
		// `ws-structure.md` at the old address while the real one sits where
		// the writer dragged it. LOSING AN ADDRESS IS NOT THE SAME AS HAVING
		// NO STORE, and mid-move is exactly when the cache is empty and the
		// file is real. `structureSources()` ends in a marker scan of the whole
		// vault for exactly this case, so the cache is refreshed before the
		// conclusion is drawn, on the branch that was about to invent a file.
		//
		// AND A STALE ONE IS WORSE THAN AN EMPTY ONE. Drag the folder INTO
		// another folder (a move — the rename fires, everything follows), then
		// REORDER that folder among its siblings: a reorder moves nothing on
		// disk, so there is no rename event and nothing corrects a cache entry
		// that has gone stale — and the reorder itself writes the store, so
		// the staleness is used immediately. SO THE CHECK IS EXISTENCE, NOT
		// EMPTINESS: a cached path whose file is not there is not an answer
		// about the vault either.
		const gone = (p2: string) => {
			try {
				const f = this.app.vault.getAbstractFileByPath(String(p2 || ''));
				return !f || !!f.children;
			} catch { return false; }
		};
		if (!sources.length || gone((sources[0] || {}).path)) {
			try {
				const again = await this.structureSources();
				if (again && again.length) {
					sources = again;
					this._structSources = again;
				}
			} catch { /* the create below is still the honest fallback */ }
		}
		const primary = sources[0] || null;
		// Nothing on disk yet: the store is created at the configured path.
		// Not an early return — a vault whose only store was `ws-goals.md` has
		// nothing claiming to be the structure file and STILL has a file to
		// retire, and returning here left it marked and readable, so the next
		// startup folded its targets in again over whatever had replaced them.
		let target = primary ? primary.path : this.structureStorePath();
		if (primary && (primary.legacy || primary.path.split('/').pop() !== STRUCT_BASENAME)) {
			const dest = this.structureStorePath(primary.path);
			let taken = null;
			try { taken = this.app.vault.getAbstractFileByPath(dest); } catch (_) { wsCatch('structureMigrate: taken = this.app.vault.getAbstractFileByPath(dest);', _); }
			if (!taken) {
				try {
					const f = this.app.vault.getAbstractFileByPath(primary.path);
					if (f && !f.children) {
						// fileManager rewrites the links pointing at it; the
						// vault's own rename does not. Either is better than
						// a create.
						if (this.app.fileManager && this.app.fileManager.renameFile) {
							await this.app.fileManager.renameFile(f, dest);
						} else {
							await this.app.vault.rename(f, dest);
						}
						target = dest;
					}
					this.storeWriteOk(WS_WRITE.move);
		} catch (e) {
			this.storeWriteFailed(WS_WRITE.move, e,
				'Word-Smith will look for it where it was.');
		}
			} else {
				// The destination already exists — the half-synced vault. Its
				// contents are already merged into what is about to be
				// written, so it is simply where the write goes.
				target = dest;
			}
		}

		// Everything else that was claiming to be the store, and the old goals
		// file if its targets were folded in, are retired now that the one
		// file holds all of it.
		for (const s of sources) {
			if (s.path !== target) await this.storeRetire(s.path, target);
		}
		if (this._goalsFoldedFrom && this._goalsFoldedFrom !== target) {
			await this.storeRetire(this._goalsFoldedFrom, target);
			this._goalsFoldedFrom = null;
		}
		this._structSources = [{ path: target, legacy: false, mtime: Date.now(), text: '' }];
		this._structFoundAt = target;
		// Reported, not discarded — see the note where `goalsPath` does the
		// same thing. Still `saveData` and not `saveSettings`.
		if (this.settings.structurePath !== target) {
			this.settings.structurePath = target;
			try { await this.saveData(this.settings); }
			catch (e) {
				this.storeWriteFailed(WS_WRITE.settings, e,
					'Word-Smith will look for the file again next time.');
			}
		}
		return target;
	},

	// The section names that are not folder paths. Both carry a colon, which
	// Obsidian forbids in a path, so neither can ever collide with a scope —
	// and the goals need that more than the order did: their section used to
	// be called `### Notes`, and "Notes" is one of the likeliest folder names
	// in any vault. A vault with a `Notes/` folder and a target on a note
	// inside it would have had one section meaning two things.
	goalsSectionKey(this: WordSmith, which: string) {
		return 'goals: ' + (which === 'folder' ? 'folders' : 'notes');
	},

	structureCompose(this: WordSmith, scopes: Record<string, WsStructRow[]>) {
		const out = [];
		out.push('This file is Word-Smith\u2019s manuscript structure \u2014 which files go');
		out.push('into a book, in what order, and what each one is aiming at. Tick and');
		out.push('untick freely, reorder the lines, or change a target; the plugin reads');
		out.push('it back. Everything between the markers is rewritten, so keep your own');
		out.push('notes outside them.');
		out.push('');
		for (const scope of Object.keys(scopes).sort()) {
			const rows = scopes[scope];
			if (!rows || !rows.length) continue;
			out.push('### ' + scope);
			out.push('');
			// AN ORDER SECTION IS A PLAIN LIST, and so is a goals section. A
			// checkbox means "this one is in", and every child of a folder is
			// in its own folder — a column of ticks nobody can untick is a
			// control that lies about what it does. The export's own sections
			// keep their boxes, because there the tick is the whole point.
			const goals = scope.indexOf('goals: ') === 0;
			// ── A PROPERTY SECTION IS ONE KEY ────────────────────────────
			//
			// A PDF cannot hold frontmatter, so what a note keeps in itself these
			// files keep here — one section per KEY, so a row is the same
			// `- path — value` shape a goals row already is, and a writer can read
			// a column off the page. NOTES ARE NOT IN HERE AT ALL: a `.md` keeps
			// its own frontmatter, where Obsidian owns it and it survives this
			// plugin being uninstalled. Two copies of one property is the fault
			// this store must never introduce.
			const props = scope.indexOf('props: ') === 0;
			// ── AND A COLOURS SECTION IS ONE TOO ───────────────────────────
			//
			// A folder colour is a VALUE after a path, exactly like a target or a
			// property. Without this it falls to the checkbox branch below and is
			// written as `- [x] Book` — the path kept, the COLOUR DROPPED — a
			// section that looks right and says nothing; only the round trip
			// through the FILE decides this shape.
			const colors = scope.indexOf('colors: ') === 0;
			// ── A COLUMNS ROW MAY CARRY A TYPE, OR NOTHING ───────────────
			//
			// The datum is WHICH property is a column; the type is a second,
			// optional fact about it, which `orgPropTypeChosen` reads BEFORE the
			// registry, so it overrides what Obsidian would say. It is authored
			// and it has to survive. SO A NOTE-LESS ROW IS STILL A ROW, which is
			// why this cannot reuse the value branch: that one drops a row with
			// nothing after the dash, and most columns have no chosen type. AND
			// NO TYPE IS NOT `text`: writing one would PIN the column to text and
			// stop the registry answering for it.
			const usercols = scope.indexOf('columns: ') === 0;
			const plain = goals || props || colors || usercols
				|| scope.indexOf('order: ') === 0;
			for (const r of rows) {
				if (usercols) {
					const note = String(r.note || '').trim();
					out.push(note
						? '- ' + r.path + ' \u2014 ' + note
						: '- ' + r.path);
				} else if (goals || props || colors) {
					// A path can carry a target, a flag, or both. A row with
					// neither has nothing to say and is not written.
					const note = String(r.note || '').trim();
					if (!note) continue;
					out.push('- ' + r.path + ' \u2014 ' + note);
				} else {
					out.push(plain ? '- ' + r.path : '- [' + (r.on ? 'x' : ' ') + '] ' + r.path);
				}
			}
			out.push('');
		}
		return STRUCT_MARK_START + '\n' + out.join('\n') + '\n' + STRUCT_MARK_END + '\n';
	},

	structureParse(this: WordSmith, text: string) {
		const scopes: Record<string, WsStructRow[]> = {};
		const body = String(text || '');
		// EITHER PAIR. A vault that has not been opened since the merge still
		// has `<!-- wordsmith:export:start -->` around its list, and there is
		// exactly one chance to read it: fail here and the writer's running
		// order looks to them like it was thrown away.
		let a = body.indexOf(STRUCT_MARK_START), b = body.indexOf(STRUCT_MARK_END);
		let len = STRUCT_MARK_START.length;
		if (a === -1 || b === -1 || b < a) {
			a = body.indexOf(EXPORT_MARK_START); b = body.indexOf(EXPORT_MARK_END);
			len = EXPORT_MARK_START.length;
		}
		if (a === -1 || b === -1 || b < a) return scopes;
		let scope = null;
		for (const line of body.slice(a + len, b).split('\n')) {
			const h = line.match(/^###\s+(.*)$/);
			if (h) { scope = h[1].trim(); scopes[scope] = scopes[scope] || []; continue; }
			// A GOALS ROW carries a value after the path, and the split goes at
			// the LAST separator rather than the first: `- Book/Ch 1 - Opening.md
			// — 2000` split at the first gives the path as "Book/Ch 1" and
			// attaches the target to a note that does not exist, on the naming
			// scheme half the manuscripts in the world use. Greedy is right
			// because the VALUE cannot contain a separator: it is a number, a
			// word, or a number then a word.
			//
			// A PROPS ROW SPLITS AT THE FIRST SEPARATOR. A PROPERTY VALUE IS FREE
			// TEXT and routinely can contain one: `- report.pdf — Q3 — final`
			// read greedily gives the path as `report.pdf — Q3`. SO THIS ONE IS
			// LAZY, and the cost is stated rather than hidden: a PATH containing
			// ` — ` would split in the wrong place, so `propStoreSet` refuses to
			// write one, loudly. A COLOURS ROW READS LIKE A PROPERTY ROW — a
			// colour name never contains a separator and a folder name might. A
			// COLUMNS ROW FALLS THROUGH WHEN IT HAS NO TYPE: the value shape is
			// tried first, and a bare `- key` is caught by the plain-list reader
			// below, which is what an order row uses.
			if (scope != null && (scope.indexOf('props: ') === 0
				|| scope.indexOf('colors: ') === 0
				|| scope.indexOf('columns: ') === 0)) {
				const g = line.match(/^\s*-\s+(.*?)\s+[\u2014\u2013]\s+(.*)$/);
				if (g) {
					const note = String(g[2] || '').trim();
					if (note) scopes[scope].push({ path: g[1].trim(), on: true, note });
					continue;
				}
			}
			if (scope != null && scope.indexOf('goals: ') === 0) {
				const g = line.match(/^\s*-\s+(.*)\s+[\u2014\u2013]\s+(.*)$/)
					|| line.match(/^\s*-\s+(.*)\s+[:-]\s+(.*)$/);
				if (g) {
					const note = String(g[2] || '').trim();
					if (note) scopes[scope].push({ path: g[1].trim(), on: true, note });
					continue;
				}
			}
			const r = line.match(/^\s*-\s*\[([ xX])\]\s*(.+?)\s*$/);
			if (r && scope != null) { scopes[scope].push({ path: r[2], on: r[1] !== ' ' }); continue; }
			// A PLAIN LIST ROW, which is what an order section is written as.
			// Read as ticked, because "in" is not a question these sections
			// ask — and read at all, because a writer reordering the lines by
			// hand in this file is a supported way to work: the header says
			// so, and it would be a poor promise if only one of the two kinds
			// of section honoured it.
			const p = line.match(/^\s*-\s+(?!\[)(.+?)\s*$/);
			if (p && scope != null) scopes[scope].push({ path: p[1], on: true });
		}
		return scopes;
	},

	// The store, found rather than assumed — see `storeFind` for why following
	// a rename was not enough on its own. Answers with the file the store is
	// CURRENTLY being read from, which during a migration is still the old
	// name: the rename is the writing half's job, not this one's.
	async structureFind(this: WordSmith) {
		if (this._structFoundAt) {
			const at = this.app.vault.getAbstractFileByPath(this._structFoundAt);
			if (at && !at.children) return this._structFoundAt;
			this._structFoundAt = null;
		}
		const sources = await this.structureSources();
		const found = sources.length ? sources[0].path : null;
		if (found) { this._structFoundAt = found; this.orgIndexStoreKnown(found); }
		return found;
	},

	// ── ONE READER OF THE STORE ──────────────────────────────────────
	//
	// One resolver, so a repair or a rename is remembered in one place.
	// `structureStore` answers a store whatever the state (an unread cache
	// is an empty store); `structureCached` answers null until the first
	// read, for the callers to whom "not read yet" is a different fact.
	structureStore(this: WordSmith, store?: Record<string, WsStructRow[]>) {
		return store || this._structStore || {};
	},

	structureCached(this: WordSmith) {
		return this._structStore || null;
	},

	// REPAIR ON READ. The parser is strict, but a store can also arrive from
	// a test, an older build, or a caller's own rows. Every section is a
	// list; every row has a non-empty string path and a boolean `on` (a
	// missing `on` means on, which is what every reader assumed); a note is
	// a string or absent; a duplicate path keeps its first row. Returns the
	// repaired store and the names of the sections it had to touch, which
	// structureRead keeps on `_structRepaired` and says once.
	structureRepair(this: WordSmith, store: Record<string, unknown>) {
		const out: Record<string, WsStructRow[]> = {};
		const repaired = [];
		for (const key of Object.keys(store || {})) {
			const rows = store[key];
			if (!Array.isArray(rows)) { out[key] = []; repaired.push(key); continue; }
			const seen = new Set();
			const clean = [];
			let touched = false;
			for (const r0 of rows as unknown[]) {
				const r = (r0 && typeof r0 === 'object') ? r0 as { path?: unknown; on?: unknown; note?: unknown } : null;
				const path = r ? wsStr(r.path).trim() : '';
				if (!r || !path || seen.has(path)) { touched = true; continue; }
				seen.add(path);
				const row: { path: string; on: boolean; note?: string } = { path, on: r.on === undefined ? true : !!r.on };
				if (r.note !== undefined && r.note !== null && r.note !== '') row.note = wsStr(r.note);
				if (typeof r.on !== 'boolean' || (r.note !== undefined && typeof r.note !== 'string') || path !== r.path) touched = true;
				clean.push(row);
			}
			out[key] = clean;
			if (touched) repaired.push(key);
		}
		return { store: out, repaired };
	},

	// THE VAULT IS READ AFTER THE VAULT IS LOADED. `onload`'s first
	// `refresh()` patches the explorer's sort, the sort asks for the order,
	// and the order asks for the store — while Obsidian is still indexing
	// the vault: `getAbstractFileByPath` answers null, the marker scan
	// walks an empty file list, and an EMPTY store would be cached as if it
	// were the truth; the goals write at layout-ready would then compose
	// from that cache and put the goals and the colours (regenerated from
	// data.json) over the file, and the order — which lives only in the
	// file — would be gone on every restart. So the first read WAITS for
	// layout-ready, which is after the index is built (the same reason
	// `vault.on('create')` at load fires once per existing file until
	// then), and concurrent first readers share ONE read: two in flight
	// would each parse, and the second's object would replace the first's
	// after a section had been set on it.
	vaultReady(this: WordSmith) {
		const ws = this.app && this.app.workspace;
		if (!ws || typeof ws.onLayoutReady !== 'function' || ws.layoutReady === true) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => { try { ws.onLayoutReady(resolve); } catch { resolve(); } });
	},

	async structureRead(this: WordSmith) {
		// Cached for the life of the window: the file is read when the
		// modal opens and written when something changes, not on every
		// keystroke.
		if (this._structStore) return this._structStore;
		if (this._structReading == null) {
			this._structReading = this.vaultReady()
				.then(() => this.structureReadNow())
				.finally(() => { this._structReading = null; });
		}
		return this._structReading;
	},

	async structureReadNow(this: WordSmith) {
		if (this._structStore) return this._structStore;
		let sources: WsStructSource[] = [];
		try { sources = await this.structureSources(); } catch (_) { wsCatch('structureRead: sources = await this.structureSources();', _); }
		this._structSources = sources;
		if (sources.length) { this._structFoundAt = sources[0].path; this.orgIndexStoreKnown(sources[0].path); }
		// NEWEST WINS PER SECTION, and a section only one file has survives.
		// Both halves of a half-synced vault are real work: the machine still
		// on the old build has gone on ticking and dragging in `ws-export.md`
		// while the upgraded one wrote `ws-structure.md`, and a merge that
		// took one file whole would throw away whichever the writer used last
		// on the other machine. Section by section is the finest grain the
		// file supports, and it is the grain a writer thinks in — one folder's
		// running order, one scope's ticks.
		const merged: Record<string, unknown> = {};
		for (const s of sources) {
			const parsed = this.structureParse(s.text);
			for (const k of Object.keys(parsed)) {
				if (!Object.prototype.hasOwnProperty.call(merged, k)) merged[k] = parsed[k];
			}
		}
		const fixed = this.structureRepair(merged);
		this._structRepaired = fixed.repaired;
		if (fixed.repaired.length) {
			try { console.warn('Word-Smith: ' + fixed.repaired.length + ' section(s) of ws-structure.md had the wrong shape and were repaired on read: ' + fixed.repaired.join(', ')); } catch (_) { wsCatch('structureRead: console.warn(\'Word-Smith: \' + fixed.repaired.length + \' section(s) of …', _); }
		}
		this._structStore = fixed.store;
		return this._structStore;
	},

	// AND IT ANSWERS WHETHER IT WORKED. `structureWrite` catches its own
	// failure — correctly, it is called from debounces — so the callers
	// beneath it could not otherwise tell a write that landed from one that
	// did not, and `propStoreSet` would answer TRUE for a property that
	// never reached the disk.
	async structureWriteSection(this: WordSmith, scope: string, rows: WsStructRow[]) {
		const all = await this.structureRead();
		all[scope] = rows;
		return await this.structureWrite();
	},

	// The one write. Everything that changes the store goes through here, so
	// the migration has exactly one place to happen and cannot be skipped by
	// whichever caller was added last.
	//
	// AND THEY GO ONE AT A TIME. Every caller composes the WHOLE file and
	// awaits the vault; two writes that overlap are safe only if the vault
	// lands them in the order they were started, which is observed, not
	// promised. If it ever landed them the other way the file would end as
	// the FIRST text, the older one: a property typed into the second write
	// disappears, and nothing fails. A SINGLE-SLOT CHAIN makes it true by
	// construction. It is not a debounce: every call still writes, in
	// order, and every caller gets the answer to ITS OWN write.
	// `structureCompose` runs when the turn comes rather than when the call
	// is made, so a queued write carries the freshest store. Not more work
	// than before: N overlapping calls already meant N composes and N disk
	// writes; this serialises them.
	structureWrite(this: WordSmith) {
		return this.structureQueue(() => this.structureWriteNow());
	},

	// THE CHAIN, and every writer of the file joins it here: the full write
	// above, and the rename and the forget below. It NEVER BREAKS, twice
	// over: `structureWriteNow` catches everything and answers a boolean,
	// and the link itself runs whatever the one before it did — a rejection
	// left on the tail would silently stop every later write in the
	// session. Each caller still awaits ITS OWN link, so a failure reaches
	// the one who asked and nobody else.
	structureQueue(this: WordSmith, fn: () => Promise<boolean>) {
		const q = (this._structWriteQ ?? Promise.resolve()).then(fn, fn);
		this._structWriteQ = q;
		return q;
	},

	// ── WHAT THE STORE COMPARE SAW, FOR THE DIAGNOSTICS ───────────────
	//
	// A store in CRLF is not rewritten for its line endings; this is how
	// anyone finds out whether that was a reporting user's case. The three
	// composed-text writers hand `process` its text back through here, and
	// the last comparison — which file, LF or CRLF on disk, handed back or
	// rewritten — is kept for "Copy diagnostics for a bug report" to print.
	// One record, the latest.
	storeHandBack(this: WordSmith, path: string, was: string, text: string) {
		const same = wsTextSameEol(was, text);
		this._storeLast = {
			path: String(path || ''),
			eol: /\r\n/.test(String(was == null ? '' : was)) ? 'CRLF' : 'LF',
			same, at: Date.now()
		};
		return same ? was : text;
	},

	async structureWriteNow(this: WordSmith) {
		// THE ORGANIZER'S SWITCH: off, the store is neither made nor touched —
		// no folder, no file, no mtime for a recent-files log to pick up. What
		// the session holds stays in memory. Answered false, as a write that
		// did not land is, and said nowhere: the switch is the writer's own
		// word and its row says what it costs.
		if (this.settings && this.settings.organizerOn === false) return false;
		const all = this.structureStore();
		const text = this.structureCompose(all);
		try {
			const path = await this.structureMigrate();
			// ONE SUCCESS POINT, because the latch is re-armed on it and an early
			// `return` on the common arm would re-arm only on the rare one — a
			// store that failed once would then go quiet for ever. Same shape as
			// the settings mirror.
			const f = this.app.vault.getAbstractFileByPath(path);
			// ── WHAT IS ON DISK, REMEMBERED ────────────────────────────
			//
			// The store is composed from `_structStore`, so the moment this returns
			// the file holds exactly `text`. Recording it lets the modify event
			// this write is about to fire be recognised as carrying nothing new —
			// see `treeOrderAdopt`.
			this._structText = text;
			if (f && !f.children) {
				// `process`, not `modify`: one turn of the vault, and a store that
				// composes to what is already on disk is not written again — no mtime
				// touched, nothing for a sync client to carry, no modify event to be
				// told about. AND "ALREADY ON DISK" IS READ ACROSS LINE ENDINGS: the
				// same text in CRLF is handed back as it came, so the file is not
				// rewritten for a difference nobody typed.
				await this.app.vault.process(f, (was) => this.storeHandBack(path, was, text));
			} else {
				await this.storeEnsureFolder(path);
				await this.app.vault.create(path, text);
				this._structFoundAt = path;
				this._structSources = [{ path, legacy: false, mtime: Date.now(), text }];
			}
			return this.storeWriteOk(WS_WRITE.structure);
		} catch (e) {
			return this.storeWriteFailed(WS_WRITE.structure, e,
				'The order, goals and ticks are still set here; the file '
				+ 'will be tried again.');
		}
	},

	// THE LIST FOLLOWS A RENAME, like the history and the goals before it.
	// Without this, renaming a folder silently threw away both halves of
	// what the writer had set: every remembered path stopped matching, so
	// the reconciliation dropped the lot and re-gathered the folder — the
	// deliberate order gone, every excluded scene ticked again. Silently
	// is the operative word: nothing fails, the export just quietly
	// contains the wrong scenes in the wrong order.
	//
	// Both keys move. A SECTION is keyed by the scope, so renaming the
	// exported folder has to rename the section too, and the rows inside
	// it are keyed by path. A folder rename fires once for the folder, so
	// this walks prefixes rather than looking for exact keys — the same
	// shape as renameGoalPaths, and for the same reason.
	structureRenamePath(this: WordSmith, oldPath: string, newPath: string) {
		if (!oldPath || !newPath || oldPath === newPath) return false;
		const store = this.structureCached();
		if (!store) return false;
		const moved = (p2: string) => (p2 === oldPath ? newPath
			: (p2.startsWith(oldPath + '/') ? newPath + p2.slice(oldPath.length) : null));
		let changed = false;
		for (const scope of Object.keys(store)) {
			const rows = store[scope] || [];
			for (const r of rows) {
				const next = moved(r.path);
				if (next) { r.path = next; changed = true; }
			}
			// ── A SECTION KEY IS NOT A PATH ───────────────────────
			//
			// An order section is keyed `'order: ' + folder` (see
			// `treeOrderSection`), and that string can never equal a path or start
			// with one — so asking `moved()` of the key alone always answers no,
			// and a renamed folder's order section stays behind naming the old
			// one: the order the writer set is orphaned, and the folder under its
			// new name has none. The ROWS are plain paths and do follow, which is
			// why this looks like it works without the key moving. THE EXPORT
			// SECTION AND THE `goals:` SECTIONS NAME NO FOLDER, and neither does
			// `order: /`, the vault root; all of them answer no, which is right.
			const ORDERKEY = 'order: ';
			const movedScope = (sc: string) => {
				const k = String(sc || '');
				if (k.indexOf(ORDERKEY) !== 0) return moved(k);
				const folder = k.slice(ORDERKEY.length);
				if (!folder || folder === '/') return null;
				const next = moved(folder);
				return next === null ? null : ORDERKEY + next;
			};
			const nextScope = movedScope(scope);
			if (nextScope && nextScope !== scope) {
				// If a list already exists at the destination it wins: the
				// writer set that one deliberately and more recently.
				if (!Object.prototype.hasOwnProperty.call(store, nextScope)) {
					store[nextScope] = rows;
				}
				delete store[scope];
				changed = true;
			}
		}
		return changed;
	},

	// Reads the store if it has not been read yet, moves the paths, and
	// writes it back. Async and fire-and-forget: a rename must not wait on
	// a file write, and if the store has never been opened there is
	// nothing on disk to correct anyway.
	//
	// ── AND A DELETE LEAVES NOTHING BEHIND ───────────────────
	//
	// The vault's delete handler prunes the scope list, the history
	// baseline and the word cache; without this, rows for deleted notes
	// and whole sections for deleted folders accumulate for the life of
	// the vault (`exportApplyRemembered` SKIPS them when it builds the
	// list, which is why nothing breaks and nothing cleans up either). NOT
	// THE CHOICE ws-history MAKES, and deliberately: that store keeps a
	// deleted note's past because the words were written and a total that
	// shrinks when you tidy up is a total nobody can trust. An ORDER for a
	// file that is gone answers no question at all. WHOLE SEGMENTS, the
	// same rule as the rename: deleting `Book` must not take `Bookshelf`
	// with it.
	structureForgetPath(this: WordSmith, gone: string) {
		if (!gone) return false;
		const store = this.structureCached();
		if (!store) return false;
		const hit = (p2: string) => {
			const cur = String(p2 || '');
			if (!cur) return false;
			return cur === gone || cur.indexOf(gone + '/') === 0;
		};
		const ORDERKEY = 'order: ';
		let changed = false;
		for (const scope of Object.keys(store)) {
			// The section itself, when it NAMES the folder that went. Only
			// `order:` keys name one — the export section and the `goals:`
			// pair name none, and must never be dropped.
			if (String(scope).indexOf(ORDERKEY) === 0) {
				const folder = String(scope).slice(ORDERKEY.length);
				if (folder && folder !== '/' && hit(folder)) {
					delete store[scope];
					changed = true;
					continue;
				}
			}
			const rows = store[scope] || [];
			const keep = rows.filter((r: TAbstractFile) => !hit(r && r.path));
			if (keep.length !== rows.length) { store[scope] = keep; changed = true; }
		}
		return changed;
	},

	
	// The same, written through. Mirrors `structureRenameStore`.
	async structureForgetStore(this: WordSmith, gone: string) {
		try {
			await this.structureRead();
			if (!this.structureForgetPath(gone)) return;
			await this.structureQueue(() => this.structureLand());
			this.storeWriteOk(WS_WRITE.forget);
		} catch (e) {
			this.storeWriteFailed(WS_WRITE.forget, e,
				'The list still holds a path that has gone.');
		}
	},

	
	// ── PROPERTIES FOR FILES THAT CANNOT HOLD THEM ────────────────────
	//
	// A note keeps frontmatter in ITSELF, where Obsidian owns it and it
	// outlives this plugin; a PDF cannot, so what it carries lives here — one
	// `props: <key>` section per key. NOTES NEVER COME IN HERE: two copies of
	// one property is the fault this store must not introduce, so every door
	// below refuses a `.md` path. DELETE AND RENAME COST NOTHING:
	// `structureForgetPath` and `structureRenamePath` already walk EVERY
	// section and filter by row path, and both are wired into the vault
	// handlers.
	propStoreHolds(this: WordSmith, path: string) {
		const p = String(path || '');
		return !!p && !/\.md$/i.test(p);
	},

	propStoreSection(this: WordSmith, key: string) { return 'props: ' + String(key || '').trim(); },

	// EVERY PATH THE STORE HOLDS A PROPERTY FOR — folders, which have no
	// frontmatter to carry one. The prune consults this, so a column whose
	// key only the store holds is not pruned before the columns are read.
	propStorePaths(this: WordSmith): string[] {
		const store = this.structureCached();
		const out = new Set<string>();
		if (!store) return [];
		for (const scope of Object.keys(store)) {
			if (String(scope).indexOf('props: ') !== 0) continue;
			for (const r of (store[scope] || [])) if (r && r.path && r.note !== undefined) out.add(String(r.path));
		}
		return Array.from(out);
	},

	// ── A PROPERTY KEEPS ITS TYPE ────────────────────────────────────
	//
	// A row in `ws-structure.md` is text, and `String(value)` flattens
	// tags, lists, numbers and checkboxes (`["budget","q3"]` → `budget,q3`,
	// `true` → `"true"`); only text and dates survive that, and a date only
	// because it IS a string.
	//
	// THE TYPE CANNOT COME FROM THE VALUE'S SPELLING. This file is meant to
	// be hand-edited, so a description reading `true` must stay a
	// description and one reading `42` must not become a number. It comes
	// from `orgPropType(key)` — the SAME reader the editor asks to decide
	// which widget to draw, so there is one answer to "what kind of thing
	// is this key" rather than two that can disagree.
	//
	// AND WHERE THE REGISTRY HAS NEVER MET THE KEY, IT IS TEXT. That is the
	// stated cost: a key invented on a PDF and used nowhere else reads back
	// as a string. `tags` and `aliases` are never in that position —
	// Obsidian always knows those two by name.
	propStoreEncode(this: WordSmith, value: unknown) {
		if (Array.isArray(value)) {
			// READABLE, because the file is edited by hand. A member containing
			// a comma cannot survive this and is the reason the decoder trims
			// and drops empties rather than pretending otherwise.
			return value.map((v) => String(v)).join(', ');
		}
		if (value === true) return 'true';
		if (value === false) return 'false';
		return wsStr(value);
	},

	propStoreDecode(this: WordSmith, key: string, text: string | null | undefined) {
		const raw = String(text === undefined || text === null ? '' : text);
		let type = '';
		try { type = (this.orgPropType && this.orgPropType(key)) || ''; } catch { type = ''; }
		const t = String(type).toLowerCase();
		if (t === 'tags' || t === 'multitext' || t === 'aliases' || t === 'list') {
			return raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
		}
		if (t === 'checkbox') return raw === 'true';
		if (t === 'number') {
			const n = parseFloat(raw);
			return isFinite(n) ? n : raw;
		}
		return raw;
	},

	// ── AND A SYNCHRONOUS READ, BECAUSE A CELL CANNOT AWAIT ─────────────
	//
	// `orgColRaw` returns a value while the table is being drawn; it has no
	// await to give. The store is CACHED for the life of the window —
	// `structureRead` fills `_structStore` and the Organizer calls it when
	// the modal opens — so by the time a cell is drawn the answer is in
	// memory and this is a read of an object, not of a file.
	//
	// EMPTY IS THE HONEST ANSWER BEFORE IT LOADS, not a guess: a cell that
	// drew a stale value would be worse than one that fills in on the next
	// redraw, and the index ring already brings one.
	propStoreAllSync(this: WordSmith, path: string) {
		const out: Record<string, unknown> = {};
		if (!this.propStoreHolds(path)) return out;
		const store = this.structureCached();
		if (!store) return out;
		const want = String(path);
		try {
			for (const scope of Object.keys(store)) {
				if (String(scope).indexOf('props: ') !== 0) continue;
				const key = String(scope).slice(7).trim();
				if (!key) continue;
				for (const r of (store[scope] || [])) {
					if (r && String(r.path) === want && r.note !== undefined) {
						out[key] = this.propStoreDecode(key, r.note);
						break;
					}
				}
			}
		} catch (_) { wsCatch('propStoreAllSync: for (const scope of Object.keys(store))', _); }
		return out;
	},

	// Case-insensitive, the `propRaw` rule, so one column finds the key
	// whatever case the writer typed it in.
	propStoreGetSync(this: WordSmith, path: string, key: string) {
		const want = String(key || '');
		if (!want) return undefined;
		const all = this.propStoreAllSync(path);
		if (Object.prototype.hasOwnProperty.call(all, want)) return all[want];
		const low = want.toLowerCase();
		for (const k of Object.keys(all)) {
			if (k.toLowerCase() === low) return all[k];
		}
		return undefined;
	},

	// ── EVERY STORE-HELD VALUE OF ONE KEY UNDER A FOLDER ─────────────────
	//
	// The filter's value list and its counts walk the ORG INDEX, which is
	// built from `getMarkdownFiles`; a .pdf has no row there, so a value
	// only a .pdf carries would never be offered. The store keeps one
	// `props: <key>` section per key, so the question is one section's
	// rows, not a walk of the vault. The key is matched without regard to
	// case, like every reader here; only paths the store HOLDS (non-md)
	// answer, so a note's frontmatter is never counted twice; the folder
	// prefix carries its slash, the prefix rule every path-keyed store in
	// this plugin has had to learn.
	propStoreRowsUnder(this: WordSmith, folder: string, key: string) {
		const out: { path: string; value: string|number|boolean|string[]; }[] = [];
		const want = String(key || '').trim().toLowerCase();
		if (!want) return out;
		const store = this.structureCached();
		if (!store) return out;
		const f = String(folder || '');
		const pre = f ? f + '/' : '';
		try {
			for (const scope of Object.keys(store)) {
				if (String(scope).indexOf('props: ') !== 0) continue;
				const k = String(scope).slice(7).trim();
				if (k.toLowerCase() !== want) continue;
				for (const r of (store[scope] || [])) {
					if (!r || r.note === undefined) continue;
					const p = String(r.path || '');
					if (!p || (pre && p.indexOf(pre) !== 0) || !this.propStoreHolds(p)) continue;
					out.push({ path: p, value: this.propStoreDecode(k, r.note) });
				}
			}
		} catch (_) { wsCatch('propStoreRowsUnder: for (const scope of Object.keys(store))', _); }
		return out;
	},

	// Every property this path carries, as one object — the shape the org
	// index already uses for a note's frontmatter, so the readers downstream
	// cannot tell the two apart.
	async propStoreAll(this: WordSmith, path: string) {
		const out: Record<string, unknown> = {};
		if (!this.propStoreHolds(path)) return out;
		const want = String(path);
		try {
			const store = await this.structureRead();
			for (const scope of Object.keys(store || {})) {
				if (String(scope).indexOf('props: ') !== 0) continue;
				const key = String(scope).slice(7).trim();
				if (!key) continue;
				for (const r of (store[scope] || [])) {
					if (r && String(r.path) === want && r.note !== undefined) {
						out[key] = this.propStoreDecode(key, r.note);
						break;
					}
				}
			}
		} catch (_) { wsCatch('propStoreAll: const store = await this.structureRead();', _); }
		return out;
	},

	// CASE-INSENSITIVELY, like `propRaw`: a column labelled `pov` must find
	// the key a writer typed as `POV`, or the same file answers one question
	// in two places.
	async propStoreGet(this: WordSmith, path: string, key: string) {
		const want = String(key || '');
		if (!want || !this.propStoreHolds(path)) return undefined;
		const all = await this.propStoreAll(path);
		if (Object.prototype.hasOwnProperty.call(all, want)) return all[want];
		const low = want.toLowerCase();
		for (const k of Object.keys(all)) {
			if (k.toLowerCase() === low) return all[k];
		}
		return undefined;
	},

	// An empty value REMOVES the row rather than writing a blank one, which
	// is what `orgPropWrite` does to frontmatter — one behaviour for a
	// cleared cell, whichever kind of file it is.
	async propStoreSet(this: WordSmith, path: string, key: string, value: unknown) {
		const p = String(path || '');
		const k = String(key || '').trim();
		if (!k || !this.propStoreHolds(p)) return false;
		// REFUSED LOUDLY, NOT MANGLED. A props row is read back by splitting
		// at the first ` — `, so a PATH containing one would parse into a
		// file that does not exist. Refusing here is what lets the parser be
		// lazy and the value be free text.
		if (/[\u2014\u2013]/.test(p)) {
			// SAID OUT LOUD. This is a REFUSAL rather than a failure, which makes
			// it worse to keep quiet: nothing is broken, the write simply never
			// happens, and a writer whose file is named with an em dash would
			// watch every property they set on it disappear with no fault to
			// point at. AND IT NAMES THE FIX, because there is one and it is
			// theirs to make: the row is read back by splitting at the first
			// " — ", so a path carrying one cannot round-trip.
			return this.storeWriteFailed(WS_WRITE.stored,
				new Error('the file name contains a dash separator (\u2014)'),
				'Rename “' + p + '” without it and the property will save.');
		}
		const empty = value === undefined || value === null || wsStr(value) === '';
		try {
			const store = await this.structureRead();
			// The key the file ALREADY uses wins, so `Pov` is not joined by a
			// second `pov` section holding the other half of one property.
			let section = this.propStoreSection(k);
			const low = k.toLowerCase();
			for (const scope of Object.keys(store || {})) {
				if (String(scope).indexOf('props: ') !== 0) continue;
				if (String(scope).slice(7).trim().toLowerCase() === low) { section = scope; break; }
			}
			const rows = (store[section] || []).filter((r: TAbstractFile) => r && String(r.path) !== p);
			if (!empty) rows.push({ path: p, on: true, note: this.propStoreEncode(value) });
			// AND THE TRUTH IS PASSED ON. When the file itself could not be
			// written, `structureWrite` has ALREADY reported it — under the
			// subject that names the real cause — so this answers false
			// without saying it twice.
			if (!(await this.structureWriteSection(section, rows))) return false;
			return this.storeWriteOk(WS_WRITE.stored);
		} catch (e) {
			return this.storeWriteFailed(WS_WRITE.stored, e,
				'The cell has gone back to what the file says.');
		}
	},

	async structureRenameStore(this: WordSmith, oldPath: string, newPath: string) {
		try {
			await this.structureRead();
			if (!this.structureRenamePath(oldPath, newPath)) return;
			await this.structureQueue(() => this.structureLand());
			this.storeWriteOk(WS_WRITE.rename);
		} catch (e) {
			this.storeWriteFailed(WS_WRITE.rename, e,
				'The list still points at the old name.');
		}
	},

	// The store as it stands NOW, landed on the file it lives in — the
	// short write a rename or a forget makes, which only ever touches a
	// file that is already there (`structureWriteNow` is the full one,
	// with the migration and the create in front). Composed at the
	// TURN, not at the call, so a queued write carries the freshest
	// store rather than a snapshot from the queue.
	async structureLand(this: WordSmith) {
		// THE SWITCH HOLDS HERE TOO: a rename or a forget is a write.
		if (this.settings.organizerOn === false) return false;
		const path = this.structurePathNow();
		const text = this.structureCompose(this.structureStore());
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!f || f.children) return false;
		this._structText = text;
		await this.app.vault.process(f, (was) => this.storeHandBack(path, was, text));
		return true;
	},

	// ── THE TREE'S OWN ORDER, in the same file ──────────────────────────────
	//
	// The file explorer's order lives in `ws-export.md` beside the export
	// lists, because they are the same fact told twice: the order a writer
	// drags their chapters into IS the order the manuscript compiles in, and
	// two files would be two answers to one question.
	//
	// A SEPARATE HEADING, though, and this is not tidiness. `### Book` already
	// means "the export list for scope Book" and holds every note under it,
	// RECURSIVELY, flat, in compile order. A tree order is the opposite shape:
	// one section per folder, holding that folder's immediate children and
	// nothing below them. Writing one into the other's section would silently
	// rewrite a working export list the first time somebody dragged a row.
	//
	// `order: ` cannot collide with a real scope, which is always a folder
	// path: Obsidian forbids `:` in a file or folder name.
	//
	// WHEN THE EXPORT LEARNS TO READ THESE, its flat list becomes a depth-first
	// walk of them and the `### Book` sections retire. That is the whole reason
	// the order lives here rather than in a file of its own.
	treeOrderKey(this: WordSmith, folder: string) {
		return 'order: ' + (folder || '/');
	},

	// The order for one folder, as paths, or an empty list when it has none.
	// Reads the cache the export window fills; the store is one file and one
	// parse, whoever asked for it first.
	treeOrderFor(this: WordSmith, folder: string) {
		const store = this.structureCached();
		if (!store) return [];
		const rows = store[this.treeOrderKey(folder)];
		if (!rows || !rows.length) return [];
		return rows.map((r) => r.path);
	},

	// Read from disk if nobody has yet. Split from `treeOrderFor` because the
	// sort runs inside Obsidian's own render, which cannot wait for a file.
	async treeOrderLoad(this: WordSmith) {
		try { await this.structureRead(); } catch (_) { wsCatch('treeOrderLoad: await this.structureRead();', _); }
		return this._structStore || {};
	},

	// The store changed on disk — synced, or edited by hand. Re-read it and
	// let the tree redraw. Gated on the toggle, so a vault that has never
	// switched this on pays one path comparison per file save.
	treeOrderAdopt(this: WordSmith, file: TAbstractFile) {
		if (!file || !file.path) return;
		// The explorer patch is one reason to care; an open Manuscript window
		// is another, and it does not need the Misc switch to be on.
		if (!this.explorerSortWanted()
			&& !(this._treeOrderWatchers && this._treeOrderWatchers.size)) return;
		let mine = false;
		try { mine = file.path === this.structurePathNow() || file.path === this._structFoundAt; }
		catch { return; }
		if (!mine) return;
		// SWAPPED, NOT DROPPED. Every write to the order file fires this same
		// modify event, INCLUDING our own; setting `_structStore = null` and
		// re-reading would leave the parsed store null for a fraction of a
		// second after a drag, so the next drag would ask `treeOrderCurrent`
		// for the folder's arrangement, be handed the alphabetical fallback,
		// and move a row relative to a list the writer could not see. The old
		// text stays up until the new text has been parsed, so there is no
		// window in which this plugin believes a vault has no order.
		//
		// ── AND A MODIFY THAT CHANGES NOTHING IS NOT NEWS ────────────────
		//
		// AN OBSERVER MUST NOT WRITE WHAT IT WATCHES: a flag lives in
		// `ws-structure.md`, so the save writes the order file, the write
		// comes back as news, and redrawing on it tears the whole tree down
		// and rebuilds it (one flag click, one burst of 263 mutations 1,212ms
		// later, `ws-org-current` taken off and put back on a new element).
		// THE TEST IS THE TEXT, not who wrote it: `structureWriteNow` composes
		// from `_structStore`, so after our own write the file holds exactly
		// what we already have — and if the bytes on disk are the bytes last
		// seen, the parsed store cannot have changed and there is nothing to
		// redraw. That is equally true of somebody else writing the same
		// bytes, which is why it is asked this way round rather than as "was
		// it me": a latch on our own writes has to be armed and disarmed
		// correctly, and this needs neither. THE STORE IS STILL RE-READ —
		// skipping the read would be the other bug, a hand edit nobody
		// noticed — so only the REDRAW is conditional.
		const was = this._structText;
		void this.structureReload().then(() => {
			if (this._structText === was) return;
			this.treeOrderChanged();
		});
	},

	// Re-read the store from disk, replacing the parsed copy only once the new
	// one exists. `structureRead` cannot do this: it is a cache-filler and
	// returns early when a copy is already held, which is exactly right for
	// every other caller and useless for "the file changed".
	async structureReload(this: WordSmith) {
		let text = '';
		try {
			const found = await this.structureFind();
			const f = found ? this.app.vault.getAbstractFileByPath(found) : null;
			if (f && !f.children) text = await this.app.vault.read(f);
		} catch { return this._structStore; }
		// ── A FAILED READ IS NOT AN EMPTY STORE ───────────────────────────
		//
		// The `catch` holds the old store for a THROW; it does not hold it for
		// the quiet miss: `structureFind()` answering nothing leaves `text` as
		// the empty string, which parses perfectly well into {} — and {} would
		// then replace a full store. AND THE MISS HAS A MOMENT: mid-move, the
		// same window the duplicate-folder bug lived in; a file faithfully
		// written from a store that had been emptied and refilled by whatever
		// wrote next loses its sections and nothing says so. THE COST IS
		// ASYMMETRIC, which is what decides it: keeping a stale order for one
		// more event is invisible and self-correcting — the next successful
		// read replaces it — while wiping one is a writer's running order
		// gone. A GENUINELY EMPTY FILE still empties the store, because it
		// carries its markers — that is a read that succeeded and found
		// nothing, and it is a different fact from a read that did not happen.
		// THE TEXT THAT IS ON DISK, as far as this plugin knows. Compared by
		// `treeOrderAdopt` against what it knew a moment earlier, which is how
		// a modify event that carries nothing new is told from one that does.
		this._structText = text;
		if (!String(text || '').trim() && this._structStore
			&& Object.keys(this._structStore).length) {
			return this._structStore;
		}
		this._structStore = this.structureParse(text);
		return this._structStore;
	},

	// Write one folder's order. `paths` is that folder's immediate children,
	// notes and subfolders alike, in the order they should draw.
	async treeOrderWrite(this: WordSmith, folder: string, paths: string[]) {
		// ── THE ONE PLACE A STORE IS KEPT OUT OF THE ORDER ──────────────
		//
		// This order is stored IN `ws-structure.md`. A store path reaching the
		// persisted list is that file writing its own name into itself, and
		// `ws-goals.md` and `ws-history.md` with it. HERE AND NOT IN
		// `treeOrderCurrent`, which is what the tree and the Organizer's table
		// both READ — a refusal there makes the files invisible as well as
		// unwritten. This is the single site every persist goes through:
		// `treeOrderMove`, the folder repairs and the rename path all end at
		// this method. SEEN, NEVER WRITTEN — the tree order test holds the
		// pair: refuse in both places and the file is invisible again; refuse
		// in neither and it records itself.
		const rows = (paths || [])
			.filter((p) => !(this.isStoreFile && this.isStoreFile(p)))
			.map((p) => ({ path: p, on: true }));
		await this.structureWriteSection(this.treeOrderKey(folder), rows);
		// Everything showing this order, not just Obsidian's tree — see
		// `treeOrderChanged`. A Manuscript window standing open beside the
		// explorer used to keep drawing the order it had drawn last.
		this.treeOrderChanged();
	},
};
export type StoresMethods = typeof storesMethods;
