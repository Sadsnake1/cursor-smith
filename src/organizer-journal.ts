// Word-Smith — organizer-journal.

import { wsCatch, wsErrMsg } from './preamble';

// ════════════════════════════════════════════════════════════════════════
// THE ORGANIZER'S JOURNAL — undo and redo, out of the window
// ════════════════════════════════════════════════════════════════════════
//
// The pattern every module of the window follows: a factory at the top
// level, taking ONE object that names everything it reads from the
// window, returning the functions the window wires in. Nothing in here
// can reach the window's three hundred names by accident; what it needs
// is written on its first line.
//
// WHAT IT READS: `paint()` — the bar's Undo/Redo buttons, repainted
// whenever the journal moves; `say(msg)` — the word beside them;
// `fail(msg)` — the foot's say-line, for an undo that threw.
//
// A JOURNAL ON THE WINDOW: one entry per act — a flag, a target, a
// property, a rename, a bulk edit of any of those as ONE entry — each
// holding what it read before it wrote, so an undo is the same write with
// the old value and a redo the same write again. Fifty deep, gone when the
// window closes. The writers feed it and skip journaling while an undo or
// redo is running through them, so the act of undoing is not itself
// journaled. Obsidian's own Ctrl+Z is the editor's and knows nothing of
// these; the note's text, a delete (the trash is its undo) and a lens
// change (not a write) stay out of it.
export const WS_ORG_HIST_MAX = 50;
// one step of the journal: what undoes it, what redoes it, and its name for the notice
export interface WsOrgJournalEntry { label: string; undo: () => Promise<void> | void; redo: () => Promise<void> | void }
export interface WsOrgJournalDeps { paint: () => void; say: (text: string) => void; fail: (text: string) => void }
export const wsOrgJournalMake = ({ paint, say, fail }: WsOrgJournalDeps) => {
	const hist: { undo: WsOrgJournalEntry[]; redo: WsOrgJournalEntry[]; busy: boolean } = { undo: [], redo: [], busy: false };
	const repaint = () => { try { paint(); } catch (_) { wsCatch('journal: paint();', _); } };
	const push = (entry: WsOrgJournalEntry) => {
		if (hist.busy || !entry) return;
		hist.undo.push(entry);
		if (hist.undo.length > WS_ORG_HIST_MAX) hist.undo.shift();
		hist.redo.length = 0;
		repaint();
	};
	const run = async (dir: string) => {
		if (hist.busy) return false;
		const from = dir === 'redo' ? hist.redo : hist.undo;
		const to = dir === 'redo' ? hist.undo : hist.redo;
		const e = from.pop();
		if (!e) return false;
		hist.busy = true;
		try {
			await (dir === 'redo' ? e.redo() : e.undo());
			to.push(e);
			// BESIDE THE BUTTONS, NOT IN THE FOOT.
			say((dir === 'redo' ? 'Redone: ' : 'Undone: ') + e.label);
		} catch (err) {
			// BACK WHERE IT CAME FROM, so a rename whose old name is taken
			// again can be tried once the way is clear, rather than lost.
			from.push(e);
			wsCatch('orgHistRun: ' + dir + ' ' + e.label, err);
			fail('Could not ' + dir + ' — ' + wsErrMsg(err));
		} finally {
			hist.busy = false;
			repaint();
		}
		return true;
	};
	const api = {
		canUndo: () => hist.undo.length > 0,
		canRedo: () => hist.redo.length > 0,
		undoLabel: () => (hist.undo.length ? hist.undo[hist.undo.length - 1].label : ''),
		redoLabel: () => (hist.redo.length ? hist.redo[hist.redo.length - 1].label : ''),
		run: (dir: 'undo' | 'redo') => run(dir),
		size: () => ({ undo: hist.undo.length, redo: hist.redo.length })
	};
	const nameOf = (p: string) => (String(p || '').split('/').pop() || '').replace(/\.md$/i, '');
	// THE LABEL OF AN ACT: "Flag Draft on Chapter Two", "Target 2000 on 3 notes".
	const on = (paths: string[], what: string) => {
		const n = paths.length;
		return what + (n === 1 ? ' on ' + nameOf(paths[0]) : ' on ' + n + ' notes');
	};
	return { push, run, api, on, repaint };
};
