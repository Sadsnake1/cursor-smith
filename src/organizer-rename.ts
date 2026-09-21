// Word-Smith — organizer-rename: a row's name edited in place, and the menu
// a row answers to.

import type { TAbstractFile } from 'obsidian';
import { wsCatch } from './preamble';
import type WordSmith from './plugin';
import type { wsOrgPropsMake } from './organizer-props';
import type { WsOrgJournalEntry } from './organizer-journal';

// ════════════════════════════════════════════════════════════════════════
// THE RENAME — a row's name edited in place, and the menu a row answers to
// ════════════════════════════════════════════════════════════════════════
//
// `orgRenameRow` (the name cell made editable, Enter to commit through
// the plugin's one renamer — which rewrites the links — Escape to put the
// old name back, a name already taken refused with a word in the foot)
// and `orgMenuCtx` (what a row's right-click menu is handed).
//
// WHAT IT READS, through `d`: the edit guard and its escape (`d.orgProps`,
// `d.orgEditDone`), the journal (`d.orgHistPush`), the panel and its
// windows (`d.panel`, `d.ownerDoc`, `d.ownerWin`), the foot (`d.said`) and
// `d.plugin`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgRenameMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (6 of 8).
export interface OrgRenameDeps {
	plugin: WordSmith;
	readonly orgEditDone: () => void;
	readonly orgHistPush: (entry: WsOrgJournalEntry) => void;
	readonly orgProps: ReturnType<typeof wsOrgPropsMake>;
	readonly ownerDoc: () => Document;
	readonly ownerWin: () => typeof window;
	readonly panel: HTMLDivElement;
	readonly said: (msg: string, bad?: boolean, offer?: { run: () => unknown; label: string }) => void;
}

export const wsOrgRenameMake = (d: OrgRenameDeps) => {
const orgRenameRow = (item: { path: string; kind?: string }) => {
	if (!item || !item.path) return;
	const rowEl = d.panel.querySelector('tr[data-path="'
		+ String(item.path).replace(/"/g, '\\"') + '"]');
	const nameEl = rowEl && rowEl.querySelector('.ws-org-namelabel');
	if (!nameEl) { d.said('That row is no longer on screen.', true); return; }
	const parts = d.plugin.outlinerRenameParts(item.path, false);
	// A contenteditable, not an <input> (which carries a form field's
	// box), and
	// the same ONE writer underneath — `outlinerRenameTo` keeps the
	// folder and the extension, refuses collisions, and renames via
	// fileManager so links follow.
	rowEl.addClass('is-being-renamed');
	nameEl.addClass('ws-uni-renaming');
	nameEl.setAttribute('contenteditable', 'plaintext-only');
	nameEl.setAttribute('spellcheck', 'false');
	nameEl.textContent = parts.base;
	// The edit-guard holds the pane still while the caret is here —
	// an index event mid-rename would rebuild the cell under it.
	d.orgProps.orgEditGuard = { path: item.path, key: 'rename' };
	let settled = false;
	const finish = async (commit: boolean) => {
		if (settled) return;
		settled = true;
		const typed = (nameEl.textContent || '');
		try {
			nameEl.removeAttribute('contenteditable');
			// AND THE EDITING LOOK COMES OFF WITH IT: left on until the next redraw
			// rebuilt the cell, the name would still wear the caret's box between a
			// cancel and that redraw, and "is a rename running?" could not be
			// answered by looking.
			nameEl.removeClass('ws-uni-renaming');
			rowEl.removeClass('is-being-renamed');
		} catch (_) { wsCatch('openManuscriptModal / finish: nameEl.removeAttribute(\'contenteditable\');', _); }
		d.orgProps.orgRedrawPending = true;
		d.orgEditDone();
		if (!commit) return;
		const r = await d.plugin.outlinerRenameTo(item.path, false, typed);
		if (r && !r.ok && r.said) d.said(r.said, true);
		if (r && r.ok && r.path) {
			const oldPath = item.path, newPath = r.path, oldBase = parts.base;
			d.orgHistPush({
				label: 'Rename ' + oldBase + ' \u2192 ' + String(typed).trim(),
				undo: async () => { const u = await d.plugin.outlinerRenameTo(newPath, false, oldBase); if (u && !u.ok) throw new Error(u.said || 'the rename could not be undone'); },
				redo: async () => { const u = await d.plugin.outlinerRenameTo(oldPath, false, typed); if (u && !u.ok) throw new Error(u.said || 'the rename could not be redone'); }
			});
		}
	};
	d.orgProps.orgFieldEscape = () => { void finish(false); };
	nameEl.addEventListener('keydown', (ev: KeyboardEvent) => {
		if (ev.key === 'Enter') { ev.preventDefault(); void finish(true); }
		else if (ev.key === 'Escape') { ev.preventDefault(); void finish(false); }
		// The pane's own keys stand down while the caret is here.
		ev.stopPropagation();
	});
	nameEl.addEventListener('blur', () => { void finish(true); });
	nameEl.addEventListener('click', (ev: Event) => ev.stopPropagation());
	nameEl.addEventListener('mousedown', (ev: Event) => ev.stopPropagation());
	try {
		nameEl.focus();
		const range = d.ownerDoc().createRange();
		range.selectNodeContents(nameEl);
		const picksel = d.ownerWin().getSelection();
		if (picksel) { picksel.removeAllRanges(); picksel.addRange(range); }
	} catch (_) { wsCatch('openManuscriptModal / orgRenameRow: nameEl.focus();', _); }
};
const orgMenuCtx = {
	said: (msg: string, bad: boolean) => { if (msg) d.said(msg, bad); },
	// (`reveal` was the tree’s unfold; the table shows every row of the
	// chosen folder, so a new note is on screen without being revealed.)
	reveal: () => {},
	report: (item: TAbstractFile) => { try { d.plugin.openReportModal(item && item.path); } catch (_) { wsCatch('openManuscriptModal: this.openReportModal(item && item.path);', _); } },
	// A NEW NOTE STAYS HERE: not opened — the order write that joins it
	// redraws this window on the spot, so the rename that follows finds its
	// row, and the rename's edit guard holds the vault's own redraw off
	// while the name is typed.
	opens: false,
	rename: (item: { path: string; kind: string }) => orgRenameRow(item)
};

	return { orgMenuCtx };
};
