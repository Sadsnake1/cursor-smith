// Word-Smith — organizer-shape: the shape and the kinds — what a writer is
// looking at, in two stores.

import type { Menu } from 'obsidian';
import { wsCatch } from './preamble';
import type WordSmith from './plugin';
import type { WordSmithSettings } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE SHAPE AND THE KINDS — what a writer is looking at, in two stores
// ════════════════════════════════════════════════════════════════════════
//
// The SHAPE (`showShape`, `setShape` — all files, notes only, folders
// only, files only) and the KINDS (`typeLabel`, `typeRows` — the one
// builder of the extension rows every menu that offers them uses). Two
// questions, not one set: `uniTypes` is about EXTENSIONS and a folder has
// none, so folding the two into one would make "Notes only" a kind on
// Tuesdays and a shape on Wednesdays.
//
// WHAT IT READS, through `d`: the settings (`d.s`, both stores), the draw
// (`d.draw`, `d.fill`, `d.drawPanel`) and `d.plugin` for the kinds present
// under the selection.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgShapeMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (0 of 5).
export interface OrgShapeDeps {
	plugin: WordSmith;
	readonly draw: () => void;
	readonly drawPanel: () => void;
	readonly fill: () => Promise<void>;
	readonly s: WordSmithSettings;
}

export const wsOrgShapeMake = (d: OrgShapeDeps) => {
// ── FOLDERS, FILES, OR BOTH — A SHAPE, NOT A KIND ───────────────────
//
// Asked for from a vault: "the notes only filter should only show the
// notes not the folders, add a folders only too", and "add a show only
// the files".
//
// IT IS A SEPARATE QUESTION FROM THE KINDS. `uniTypes` is about
// EXTENSIONS — which of Notes, Images, Canvas, PDFs exist here — and it
// has never had anything to say about folders, because a folder has no
// extension to match. Folding the two into one set would have made
// "Notes only" a kind on Tuesdays and a shape on Wednesdays.
//
// SO THEY ARE TWO STORES AND ONE MENU. The rows a writer reads are
// "All files / Notes only / Folders only / Files only", which is one
// list of four answers to "what should I be looking at"; underneath,
// each row sets whichever of the two it needs and leaves the other
// alone. `Notes only` is the one that sets both — a kind AND a shape —
// and that is exactly what was asked for.
const showShape = () => {
	const v = String(d.s.uniShow || 'all');
	return (v === 'files' || v === 'folders') ? v : 'all';
};
const setShape = async (v: string) => {
	d.s.uniShow = (v === 'files' || v === 'folders') ? v : 'all';
	await d.plugin.saveSettings(true);
	d.draw(); void d.fill();
	// AND THE PANEL, for the Organizer's own kind chip. `draw()` is the
	// tree; the chip that says a narrowing is on lives in the table's bar,
	// and a sign that only appears on the next unrelated redraw is a sign a
	// writer cannot trust. Guarded: `drawPanel` is declared further down.
	try { d.drawPanel(); } catch (_) { wsCatch('openManuscriptModal / setShape: drawPanel();', _); }
};
// ── WHICH KINDS OF FILE — NO LONGER A BUTTON OF ITS OWN ─────────────
//
// THE STATE KEEPS A VISIBLE SIGN: a chip beside the scope's, for exactly
// the reason that one exists: "half my vault vanished" is what an
// invisible filter files itself under, and a writer who has hidden
// every kind but Notes must be able to see it without opening a menu.
const typeLabel = () => {
	const on = d.plugin.uniTypeSet();
	const all = d.plugin.uniTypeGroups();
	const shape = showShape();
	// THE SHAPE WINS THE LABEL when it is the narrower statement.
	// "Folders only" and "Notes only" are what a writer will recognise
	// as the reason a tree looks short; "1 kind" is not.
	if (shape === 'folders') return 'Folders only';
	if (shape === 'files' && on.size === 1 && on.has('md')) return 'Notes only';
	if (shape === 'files') return 'Files only';
	if (on.size >= all.length) return 'All files';
	if (on.size === 1 && on.has('md')) return 'Notes';
	return on.size + ' kinds';
};
// ── THE KINDS, AS ONE BUILDER ───────────────────────────────────────
//
// Asked for from a vault: the filter menu should carry submenus "by
// type, by files, by flag". So these rows are now reachable from two
// places — this button, and the filter menu's "By type" — and they are
// written ONCE. Two copies of a menu is how one of them gains a row the
// other has not; the column menu's comment records that fault and the
// sort menu's submenus already avoid it the same way.
//
// THE BUTTON STAYS. Reaching the kinds from the filter menu does not
// mean the filter menu OWNS them: a single button reading "Everything ·
// Words" was two answers to two questions, neither readable without
// opening it. The button keeps
// its own label ("Notes" / "All files" / "N kinds"), so the state is
// still legible at a glance; the submenu is a second door, not a move.
const typeRows = (into: Menu) => {
	const groups = d.plugin.uniTypeGroups();
	const setAnd = (list: string[]) => {
		d.plugin.settings.uniTypes = list;
		void d.plugin.saveSettings(true);
			d.draw(); void d.fill();
		// …and the bar's kind chip — see the note in `setShape`.
		try { d.drawPanel(); } catch (_) { wsCatch('openManuscriptModal / setAnd: drawPanel();', _); }
	};
	const on = d.plugin.uniTypeSet();
	// ── FOUR ANSWERS TO "WHAT AM I LOOKING AT" ──────────────────
	//
	// One list, because that is how a writer reads it. Underneath,
	// each row sets whichever of the two stores it needs: the kinds
	// are extensions, the shape is folders-versus-files, and only
	// "Notes only" sets both — which is precisely what was asked for
	// ("the notes only filter should only show the notes not the
	// folders").
	//
	// CHECKED, so the list says which one is on without being opened.
	// These four are a single choice; the kinds beneath the separator
	// are a SET, and the separator is the whole of what says so.
	const shape = showShape();
	const allOn = on.size >= groups.length;
	const pick = (i: number, title: string, icon: string, isOn: boolean, fn: () => Promise<void>) => {
		into.addItem((i2) => {
			i2.setTitle(title).setIcon(icon).onClick(fn);
			try {
				if (typeof i2.setChecked === 'function') i2.setChecked(isOn);
				else if (isOn) i2.setTitle('✓ ' + title);
			} catch (_) { wsCatch('openManuscriptModal / pick: if (typeof i2.setChecked === \'function\') i2.setChecked(isOn);', _); }
		});
	};
	pick(0, 'Everything', 'files', shape === 'all' && allOn, async () => {
		setAnd(groups.map(g => g.id));
		await setShape('all');
	});
	pick(1, 'Notes only', 'file-text',
		shape === 'files' && on.size === 1 && on.has('md'), async () => {
			setAnd(['md']);
			await setShape('files');
		});
	pick(2, 'Files only', 'file', shape === 'files' && allOn, async () => {
		setAnd(groups.map(g => g.id));
		await setShape('files');
	});
	pick(3, 'Folders only', 'folder', shape === 'folders', () => setShape('folders'));
	into.addSeparator();
	for (const g of groups) {
		into.addItem((i) => {
			i.setTitle(g.label).setIcon(g.icons[0])
				.onClick(() => {
					const next = new Set(d.plugin.uniTypeSet());
					if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
					// An empty set would draw folders holding
					// nothing, which reads as broken rather than
					// strict — the last kind standing stays on.
					if (!next.size) next.add('md');
					setAnd(Array.from(next));
				});
			// `setChecked` is not on every build; where it is
			// absent the state is said in the title instead —
			// a silent toggle is a menu that has to be opened
			// twice to be read once.
			try {
				if (typeof i.setChecked === 'function') i.setChecked(on.has(g.id));
				else if (on.has(g.id)) i.setTitle('\u2713 ' + g.label);
			} catch (_) { wsCatch('openManuscriptModal / typeRows: if (typeof i.setChecked === \'function\') i.setChecked(on.has(g.id));', _); }
		});
	}
	// ── AND THE EXTENSIONS THE VAULT ACTUALLY HOLDS BEYOND THE KINDS ──
	//
	// The vault's own extensions, counted, each its own tick, nothing to
	// type or misspell. `ext:<ext>` in the set narrows Other to those;
	// ticking the first one turns Other itself off, so the narrowing is what
	// shows. Counted from the vault at each opening of the menu — a menu is
	// not a draw.
	const known = new Set();
	for (const g of groups) for (const e of (g.ext || [])) known.add(e);
	const counts = new Map();
	try {
		for (const f of (d.plugin.app.vault.getFiles ? d.plugin.app.vault.getFiles() : [])) {
			const e = String((f && f.extension) || '').toLowerCase();
			if (!e || known.has(e)) continue;
			counts.set(e, (counts.get(e) || 0) + 1);
		}
	} catch (_) { wsCatch('openManuscriptModal / typeRows: for (const f of this.app.vault.getFiles())', _); }
	const exts = Array.from(counts.keys()).sort();
	if (exts.length) into.addSeparator();
	for (const e of exts) {
		const title = e + '  ·  ' + counts.get(e);
		const isOn = on.has('other') || on.has('ext:' + e);
		into.addItem((i) => {
			i.setTitle(title).setIcon('file')
				.onClick(() => {
					const next = new Set(d.plugin.uniTypeSet());
					const id = 'ext:' + e;
					if (next.has(id)) next.delete(id);
					else { next.add(id); next.delete('other'); }
					if (!next.size) next.add('md');
					setAnd(Array.from(next));
				});
			try {
				if (typeof i.setChecked === 'function') i.setChecked(isOn);
				else if (isOn) i.setTitle('\u2713 ' + title);
			} catch (_) { wsCatch('openManuscriptModal / typeRows: i.setChecked(isOn) for an extension', _); }
		});
	}
};

	return { showShape, setShape, typeLabel, typeRows };
};
