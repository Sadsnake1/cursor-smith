// Word-Smith — organizer-cells: what a property, a target, a link and a
// tag draw in a row.

import type { WsOrgRow } from './organizer-rows';
import { Notice, setIcon } from 'obsidian';
import { wsCatch } from './preamble';
import type WordSmith from './plugin';
import type { WsModEvent } from './plugin';
import type { wsOrgPropsMake } from './organizer-props';
import type { WsOrgJournalEntry } from './organizer-journal';
import type { WordSmithSettings } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE CELLS — what a property, a target, a link and a tag draw in a row
// ════════════════════════════════════════════════════════════════════════
//
// `orgCanHoldProps` / `orgCanHoldGoal` / `orgPropRefuse` (which files may
// carry a property or a target, and what the cell says when one may
// not), `orgPropCell` (a property cell that edits where it is read),
// `orgGoalCell` (the target pill that is also the progress and the box),
// `orgOutCell` and `orgBackCell` (the link names as doors), and the tag
// cell with its pill helpers (`orgTagWrap`, `orgTagPill`, `orgTagsCell`).
// The flag cell is the flags module's and is not here.
//
// WHAT IT READS, through `d`: the settings (`d.s`) and the target store
// (`d.goalStore`, `d.targetOf`), the readings (`d.orgColRaw`, `d.nameOf`),
// the editor (`d.orgFieldEditor`, `d.orgEditDone`, `d.orgOtherEditorOpen`,
// and `d.orgProps` for the live edit guard and the open-after), the
// journal (`d.orgHistPush`, `d.orgHistOn`), the bulk selection
// (`d.orgBulkPaths`, `d.orgBulkSay`), `d.openRow`, `d.drawPanel`, the
// table's own `d.drawOrg` and `d.plugin`. Every `host` in here is a
// PARAMETER — the cell the pills go into.
//
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgCellsMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (11 of 17).
export interface OrgCellsDeps {
	plugin: WordSmith;
	readonly drawPanel: () => void;
	readonly drawOrg: () => void;
	readonly goalStore: () => 'fileGoals';
	readonly nameOf: (path: string) => string;
	readonly openRow: (it: { kind: string; path: string; }, ev?: WsModEvent) => void;
	readonly orgBulkPaths: (row: { path: string; kind?: string } | null | undefined) => string[];
	readonly orgBulkSay: (n: number, what: string) => void;
	readonly orgColRaw: (col: { id: string; key?: string; }, path: string) => unknown;
	readonly orgEditDone: () => void;
	readonly orgFieldEditor: (card: HTMLElement, path: string, key: string, isDraft: boolean) => HTMLInputElement | null;
	readonly orgHistOn: (paths: string[], what: string) => string;
	readonly orgHistPush: (entry: WsOrgJournalEntry) => void;
	readonly orgOtherEditorOpen: (td: HTMLElement) => boolean;
	readonly orgProps: ReturnType<typeof wsOrgPropsMake>;
	readonly s: WordSmithSettings;
	readonly targetOf: (path: string) => number;
}

export const wsOrgCellsMake = (d: OrgCellsDeps) => {
// ── A PROPERTY CELL, EDITED WHERE IT IS READ ──────────────────────
//
// The same shape as the target cell below it: a click swaps the reading
// for an editor, the edit-guard engages on focus, blur is the one
// committer, Escape restores. ONE EDITOR, NOT A SECOND ONE:
// `orgFieldEditor` already knows what a date is, what a number is, what
// the registry says and what to do when the value at hand disagrees
// with it — a table-only copy is how two surfaces start writing
// different things for the same keystrokes. It takes a container; a
// `<td>` is a container. A COMPLEX VALUE DRAWS ITS OWN REFUSAL:
// `orgFieldEditor` returns null after writing "complex value — edit in
// note" into the container, which is the honest answer in a cell too —
// so nothing is put back over it, and the next redraw restores the
// reading.
//
// ── A FILE THAT CANNOT KEEP A PROPERTY DOES NOT OFFER AN EDITOR ─────
//
// Every property edit goes through `orgPropWrite` to
// `app.fileManager.processFrontMatter`, and a file with no frontmatter
// to process throws there: the value would vanish on blur. ONE
// PREDICATE, ASKED AT EVERY DOOR. The editor is born in `orgFieldEditor`,
// which is where a refusal belongs — except that BOTH callers empty the
// cell before calling it, so refusing in there would leave a blank cell
// where a reading had been. The question is asked before the cell is
// cleared, which is two places; the ANSWER has one writer, so the two
// cannot drift apart. AND `orgPropWrite` KEEPS ITS OWN GUARD: a door
// that refuses is not a write that refuses — the drafts, the menus and
// anything added later all reach the writer without passing a cell.
//
// A FILE, NOT A PATH THAT LOOKS LIKE ONE. `!f.children` is the test
// `orgPropWrite` already uses to tell a file from a folder, and it asks
// the vault rather than the spelling — a folder called `Chapter 1.md`
// would pass a regex and must not get an editor.
const orgCanHoldProps = (path: string) => {
	const p = String(path || '');
	if (!p) return false;
	try {
		const f = d.plugin.app.vault.getAbstractFileByPath(p);
		return !!f && !f.children;
	} catch { return false; }
};
// ── BUT THE TARGET DOES NOT RIDE ALONG ─────────────────
//
// Two predicates, because the answers differ: nothing counts words in a
// PDF, so a target set on one could never be measured against anything
// — it would show a bar at nought for ever.
const orgCanHoldGoal = (path: string) => /\.md$/i.test(String(path || ''));
// IT SAYS WHY. A cell that silently does nothing is the same fault in
// a quieter coat — the writer clicked it because it looked editable,
// and the answer they need is where properties live, not that they
// mis-clicked. The affordance goes too: no `is-prop`, so the cell has
// no pointer cursor and no hover box inviting the click.
const orgPropRefuse = (path: string) => {
	const ext = String(path || '').split('.').pop();
	try {
		new Notice('A .' + ext + ' cannot hold properties — they live in a note\u2019s frontmatter.');
	} catch (_) { wsCatch('openManuscriptModal / orgPropRefuse: new Notice(\'A .\' + ext + \' cannot hold properties — they live in a …', _); }
};
const orgPropCell = (td: HTMLElement, row: WsOrgRow, col: { id: string; key?: string }, text: string) => {
	const key = col.key || '';
	td.setText(text);
	if (text) td.title = text;
	const canEdit = orgCanHoldProps(row.path);
	if (canEdit) td.addClass('is-prop');
	td.addEventListener('click', (ev: Event) => {
		ev.stopPropagation();
		if (!canEdit) { orgPropRefuse(row.path); return; }
		// ── THE WHOLE CELL IS THE TARGET ────────────────────────────
		//
		// A DATE AND A CHECKBOX ARE ALREADY BUILT AT REST. Every other kind
		// draws a reading and becomes an editor on the click this handler
		// serves — but these two put their control in the cell when the table
		// is drawn, and a handler that finds one and returns leaves the only
		// live target the control itself: an em dash for an unwritten day, a
		// box at the left edge for a checkbox. SO THE CLICK IS HANDED ON RATHER
		// THAN SWALLOWED, and only when it landed on the CELL: a click on the
		// control itself is already where it needs to be, and forwarding that
		// one would toggle a checkbox twice.
		{
			// THE RESTING DISPLAY FIRST, NOT WHICHEVER COMES FIRST IN THE
				// DOM. A date cell holds BOTH: the input, hidden at 0x0
				// under `is-editing-off`, and the span that carries the
				// open handler. A comma selector returns the input, and
				// clicking a hidden input does nothing at all — measured:
				// the box stayed 0x0 and the dash was still the only way in.
				const held = td.querySelector('.ws-org-shown')
					|| td.querySelector('.ws-org-editor');
			if (held) {
				if (ev.target === td) {
					try {
						held.click();
						if (held.focus) held.focus();
					} catch (_) { wsCatch('openManuscriptModal / orgPropCell: held.click();', _); }
				}
				return;
			}
		}
		// ANOTHER CELL FIRST — see `orgOtherEditorOpen`.
		if (d.orgOtherEditorOpen(td)) {
			d.orgProps.orgOpenAfter = { path: row.path, id: col.id, key };
			d.drawOrg();
			return;
		}
		td.textContent = '';
		d.orgFieldEditor(td, row.path, key, false);
	});
};

// ── THE TARGET, EDITED WHERE IT IS READ ──────────────────────────
//
// A click on the goal cell swaps in a number input: the edit-guard
// engages on focus, blur is the one committer, Enter blurs, Escape
// restores. Empty or invalid DELETES the target — a target of nothing
// is no target, not a zero.
//
// ── A TARGET IS A COUNT OF WORDS, SO IT IS A NOTE'S ──────────────
//
// The index is a reading of a note's CONTENTS and holds nothing for a
// .pdf, so a target set on one could never be measured against
// anything. REFUSED AT THE DOOR, and the affordance goes with it: no
// `is-goal`, so no pointer cursor and no title inviting a click that
// will be turned away.
// ── A BAND AS LONG AS THE PROGRESS ─────────────────────────────
//
// The number is stamped here and the sheet draws it: a faint band from
// the cell's left edge, its length the percentage, so a column of
// targets reads at a glance without reading a figure. THE ONE WRITER of
// the band: a note's cell and a folder's aggregate (its notes' words over
// their targets) both come through here, so the column reads the same
// on every row. FOUR COLOURS, NOT A RAMP: a hue ramp puts 68% and 94% in
// the same pale green. A step each: under half, half to four-fifths,
// four-fifths to done, done. The sheet maps them to the theme's own four.
const orgGoalBand = (td: HTMLElement, words: number, target: number) => {
	if (target > 0) {
		const pct = Math.max(0, Math.min(100, Math.round(words / target * 100)));
		td.style.setProperty('--ws-goal-pct', String(pct));
		td.addClass('has-band');
		const step = pct >= 100 ? 'done' : pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
		for (const k of ['low', 'mid', 'high', 'done']) td.toggleClass('is-band-' + k, k === step);
	} else {
		td.style.removeProperty('--ws-goal-pct');
		td.removeClass('has-band');
		for (const k of ['low', 'mid', 'high', 'done']) td.removeClass('is-band-' + k);
	}
};
const orgGoalCell = (td: HTMLElement, row: WsOrgRow, text: string) => {
	td.setText(text);
	try {
		orgGoalBand(td, Number(d.orgColRaw({ id: 'words' }, row.path)) || 0, Number(d.orgColRaw({ id: 'goal' }, row.path)) || 0);
	} catch (_) { wsCatch('openManuscriptModal / orgGoalCell: orgGoalBand(td, words, target)', _); }
	const canGoal = orgCanHoldGoal(row.path);
	if (canGoal) td.addClass('is-goal');
	if (canGoal) {
		td.title = text ? 'Click to change the target' : 'Click to set a target';
	}
	td.addEventListener('click', (ev: Event) => {
		ev.stopPropagation();
		if (!canGoal) {
			const ext = String(row.path || '').split('.').pop();
			try {
				new Notice('A .' + ext + ' has no word count, so a target has nothing to measure.');
			} catch (_) { wsCatch('openManuscriptModal / orgGoalCell: new Notice(\'A .\' + ext + \' has no word count, so a target has nothing …', _); }
			return;
		}
		if (td.querySelector('input')) return;
		const was = d.targetOf(row.path);
		td.textContent = '';
		const inp = td.createEl('input', { cls: 'ws-org-editor ws-org-goaledit' });
		inp.type = 'number';
		inp.min = '0';
		inp.value = was > 0 ? String(was) : '';
		let settled = false;
		inp.addEventListener('focus', () => {
			d.orgProps.orgEditGuard = { path: row.path, key: 'goal' };
			d.orgProps.orgFieldEscape = () => { settled = true; inp.blur(); };
		});
		inp.addEventListener('keydown', (ev2: KeyboardEvent) => {
			if (ev2.key === 'Enter') { ev2.preventDefault(); inp.blur(); }
			ev2.stopPropagation();
		});
		inp.addEventListener('blur', () => { void (async () => {
			const commit = !settled;
			settled = true;
			if (commit) {
				const n = parseFloat(inp.value);
				const want = (isFinite(n) && n > 0) ? Math.round(n) : 0;
				if (want !== was) {
					// ON EVERY NOTE THE SELECTION HOLDS.
					const paths = d.orgBulkPaths(row).filter(p => orgCanHoldGoal(p));
					const before: [string, number][] = paths.map((p) => [p, d.s[d.goalStore()][p] || 0]);
					const after: [string, number][] = paths.map((p) => [p, want]);
					const apply = async (pairs: [string, number][]) => {
						for (const [p, v] of pairs) {
							if (v > 0) d.s[d.goalStore()][p] = v;
							else delete d.s[d.goalStore()][p];
						}
						await d.plugin.saveSettings(true);
					};
					await apply(after);
					d.orgBulkSay(paths.length, want > 0 ? 'Target set' : 'Target cleared');
					d.orgHistPush({
						label: d.orgHistOn(paths, want > 0 ? 'Target ' + want : 'Target cleared'),
						undo: async () => { await apply(before); d.drawPanel(); },
						redo: async () => { await apply(after); d.drawPanel(); }
					});
				}
			}
			d.orgProps.orgRedrawPending = true;
			d.orgEditDone();
		})(); });
		window.setTimeout(() => { try { inp.focus(); inp.select(); } catch (_) { wsCatch('openManuscriptModal / orgGoalCell: inp.focus();', _); } }, 0);
	});
};

// ── AND THE NAMES ARE DOORS ────────────────────────────────────
//
// A cell of text would answer "who points here"; a way to GO there
// means one pressable element per name rather than one string with
// commas in it. `openRow`'S OWN DOOR, not a second call to
// `openLinkText`: the window has one writer for "open this note", and a
// link that took a different route would be the row-click and the
// name-click disagreeing the day either changes. `stopPropagation`,
// BECAUSE THE ROW IS ALSO A CONTROL: without it a press opens the
// linking note AND moves the pane to the row that was clicked — two
// answers to one gesture, and the wrong one lands second.
const orgOutCell = (td: HTMLElement, row: WsOrgRow) => {
	const raw = d.orgColRaw({ id: 'outlinks' }, row.path);
	const list = Array.isArray(raw) ? (raw as { path?: string; text?: string }[]) : [];
	if (!list.length) return;
	td.title = list.map((x) => (x.path ? d.nameOf(x.path) : String(x.text))).join(String.fromCharCode(10));
	for (let i = 0; i < list.length; i++) {
		const x = list[i];
		if (i) td.createSpan({ cls: 'ws-org-backsep', text: ', ' });
		if (!x.path) { td.createSpan({ cls: 'ws-org-outlink is-unresolved', text: String(x.text) }); continue; }
		const target = x.path;
		const a = td.createSpan({ cls: 'ws-org-backlink ws-org-outlink', text: d.nameOf(x.path) });
		a.setAttribute('role', 'link');
		a.title = x.path;
		a.addEventListener('click', (ev: Event) => {
			ev.stopPropagation();
			try { void d.plugin.app.workspace.openLinkText(target, '', false); } catch (_) { wsCatch('orgOutCell: openLinkText(x.path)', _); }
		});
	}
};
const orgBackCell = (td: HTMLElement, row: WsOrgRow) => {
	const raw = d.orgColRaw({ id: 'backlinks' }, row.path);
	const list = Array.isArray(raw) ? raw.map(String) : [];
	if (!list.length) return;
	// THE WHOLE LIST ON THE HOVER, because the cell ellipsises and a
	// note with nine backlinks would otherwise show two and a half.
	td.title = list.map(d.nameOf).join(String.fromCharCode(10));
	for (let i = 0; i < list.length; i++) {
		const p = list[i];
		if (i) td.createSpan({ cls: 'ws-org-backsep', text: ', ' });
		const a = td.createSpan(
			{ cls: 'ws-org-backlink', text: d.nameOf(p) });
		a.setAttribute('role', 'link');
		a.setAttribute('tabindex', '0');
		a.title = 'Open ' + d.nameOf(p);
		const go = (ev: Event | KeyboardEvent) => {
			ev.stopPropagation();
			ev.preventDefault();
			d.openRow({ kind: 'file', path: p }, ev);
		};
		a.addEventListener('click', go);
		// REACHABLE BY KEYBOARD, on the same terms as the tag chip's ×:
		// a control that exists only under a pointer is not a control
		// on a machine being driven by Tab.
		a.addEventListener('keydown', (ev: KeyboardEvent) => {
			if (ev.key === 'Enter' || ev.key === ' ') go(ev);
		});
	}
};
// ONE PILL, OBSIDIAN'S: the markup its properties view draws —
// `multi-select-pill` with a content span and, where the pill can be
// removed, its remove button — under a `metadata-property-value`
// wrapper that names the property's type, so Obsidian's own rule maps
// the tag colours onto it and a vault's tag-colour snippet reaches it.
// `orgTagWrap` makes the wrapper once per host.
const orgTagWrap = (host: HTMLElement, type: string) => {
	let w = host.querySelector(':scope > .ws-org-tagcell');
	if (!w) {
		w = host.createSpan({ cls: 'metadata-property-value ws-org-tagcell' });
		w.setAttribute('data-property-type', type || 'multitext');
	}
	return w;
};
const orgTagPill = (host: HTMLElement, text: string, o: { intext?: boolean; remove?: (() => void) | null }) => {
	const opt = o || {};
	const pill = host.createSpan({ cls: 'multi-select-pill ws-org-tagchip' + (opt.intext ? ' is-intext' : '') + (opt.remove ? ' has-x' : '') });
	pill.setAttribute('data-property-pill-value', String(text));
	pill.createSpan({ cls: 'multi-select-pill-content', text: String(text) });
	if (opt.intext) pill.createSpan({ cls: 'ws-org-intext', text: 'in text' });
	if (opt.remove) {
		const remove = opt.remove;
		const x = pill.createEl('button', { cls: 'multi-select-pill-remove-button ws-org-chipx' });
		try { if (setIcon) setIcon(x, 'x'); } catch (_) { wsCatch('orgTagPill: setIcon(x, x)', _); }
		if (!x.childElementCount) x.setText('\u00d7');
		x.title = 'Remove ' + String(text);
		x.setAttribute('aria-label', x.title);
		x.addEventListener('click', (ev: Event) => { ev.stopPropagation(); remove(); });
	}
	return pill;
};
// ── ONE TAGS CELL, SAYING WHERE EACH TAG LIVES ─────────────────────
//
// This built-in column MERGES inline and frontmatter tags; a property
// column for `tags` would read frontmatter only — a silent subset — and
// is refused at its source (`orgKnownProps`). THE SOURCE IS DRAWN, not
// hidden, and it is not decoration: a frontmatter tag can be edited
// from this plugin and one written mid-sentence cannot, because
// removing it means editing the sentence. `.ws-org-tagchip.is-intext`
// is the one class for that, so no two places can come to look
// different.
//
// ── AND IT IS EDITED WHERE IT IS READ ─────────────────────────────
//
// `tags` is the one reading that is also a real key, so the panel gives
// it to THIS built-in column and refuses the frontmatter `tags`
// property — one name, one row — which means this cell has to carry the
// editing the property column would have. SO IT BORROWS `orgPropCell`'S
// DOOR, not a second editor: `orgFieldEditor`'s chip branch was written
// for exactly this pair — frontmatter tags removable, body tags drawn
// dimmed and marked "in text". AND THE EMPTY CELL KEEPS ITS DOOR: a note
// with no tags must have something to click, or the first tag is the
// one that can never be typed. The listener is bound before the chips
// are drawn.
const orgTagsCell = (td: HTMLElement, row: WsOrgRow) => {
	const list = d.plugin.tagsWithSource(row.path);
	// TAGS ARE FRONTMATTER TOO, so this door refuses on the same rule.
	// It is a separate cell builder but not a separate question.
	const canEdit = orgCanHoldProps(row.path);
	if (canEdit) td.addClass('is-prop');
	td.addEventListener('click', (ev: Event) => {
		ev.stopPropagation();
		if (!canEdit) { orgPropRefuse(row.path); return; }
		if (td.querySelector('.ws-org-editor')) return;
		// ANOTHER CELL FIRST — see `orgOtherEditorOpen`.
		if (d.orgOtherEditorOpen(td)) {
			d.orgProps.orgOpenAfter = { path: row.path, id: 'tags', key: 'tags' };
			d.drawOrg();
			return;
		}
		td.textContent = '';
		d.orgFieldEditor(td, row.path, 'tags', false);
	});
	const wrap = orgTagWrap(td, 'tags');
	for (const t of list) {
		const chip = orgTagPill(wrap, t.tag, { intext: t.inText });
		chip.title = t.inText
			? '#' + t.tag + ' — written in the note’s text, so it is '
				+ 'edited there, not here'
			: '#' + t.tag + ' — a frontmatter tag';
	}
};
	return { orgCanHoldProps, orgPropRefuse, orgPropCell, orgGoalBand, orgGoalCell, orgOutCell, orgBackCell, orgTagWrap, orgTagPill, orgTagsCell };
};
