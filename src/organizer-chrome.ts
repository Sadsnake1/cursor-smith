// Word-Smith — organizer-chrome: the window's own frame — the titlebar
// doors, the tab strip, the subject line and the foot's say-line.

import { setIcon } from 'obsidian';
import type { Modal } from 'obsidian';
import { wsOrgAgg } from './org-index';
import type { wsOrgRowsMake } from './organizer-rows';
import type { wsOrgScopeMake } from './organizer-scope';
import type { wsOrgSelMake } from './organizer-sel';
import { wsCatch, wsObsidianSvg, wsSvgInto } from './preamble';
import type { WsSession } from './preamble';
import type { WsHost } from './settings';
import type WordSmith from './plugin';

// ═══════════════════════════════════════════════════════════════════
// THE CHROME — what frames the three panes, whichever tab is up
// ═══════════════════════════════════════════════════════════════════
//
// The sheet's two titlebar doors (into a pane, into a window), the tab
// strip and the ONE way to change tabs, the subject line (the path as
// crumbs, the counts under it, the pin, the zoom tag) and the say-line in
// the foot, where a refusal is said and an Undo is offered.
//
// WHAT IT READS, through `d`: the host and the four boxes the window built
// (the body, the tab strip, the subject line's box, the foot), the tab
// table and the tab that is up, the session, and the doors the panes
// answer — the selection (its cursor is dropped on the Organizer tab), the
// scope (which note History is on, and `orgSelect`), the rows under a
// folder, the zoom tag, and the two redraws a tab switch asks for.
//
// `tab` IS THE ONE LIVE LET: `tabSet` writes it, so the window lends it
// with a setter. The say-line's element and its timer are the module's own.
export interface OrgChromeDeps {
	plugin: WordSmith;
	readonly host: WsHost;
	readonly single: boolean;
	readonly TABS: readonly { id: string; label: string; icon: string }[];
	tab: string;
	readonly ses: WsSession;
	readonly body: HTMLElement;
	readonly tabsRow: HTMLElement;
	readonly subject: HTMLElement;
	readonly foot: HTMLElement;
	readonly orgSel: Pick<ReturnType<typeof wsOrgSelMake>, 'cursor'>;
	readonly orgScope: Pick<ReturnType<typeof wsOrgScopeMake>, 'orgNote' | 'orgSelect'>;
	readonly orgFolder: string;
	readonly orgUnder: ReturnType<typeof wsOrgRowsMake>['orgUnder'];
	readonly zoomTag: () => void;
	readonly draw: () => void;
	readonly drawPanel: () => void;
}

export const wsOrgChromeMake = (d: OrgChromeDeps) => {
	const plugin = d.plugin;

	// A LUCIDE GLYPH INTO A DOOR, tried by name and CHECKED — `setIcon`
	// with a name this build's Lucide does not know DOES NOT THROW, it
	// leaves the element empty; a bare call would have no way to notice.
	// The last name is the last resort; the text is the fallback for a
	// build with none.
	const glyph = (el: HTMLElement, names: string[], fallback: string) => {
		let drew = false;
		for (const n of names) {
			el.textContent = '';
			try { if (setIcon) setIcon(el, n); } catch (_) { wsCatch('orgChrome / glyph: if (setIcon) setIcon(el, n);', _); }
			if (el.childElementCount > 0) { el.dataset.icon = n; drew = true; break; }
		}
		if (!drew) el.setText(fallback);
	};

	// ── OUT OF THE SHEET AND INTO A PANE, OR A WINDOW ─────────────────
	//
	// The sheet offers the doors: one press moves this window into a leaf,
	// where it can be a tab, docked to either side, or dragged out beside
	// the note being written; the other into its own OS window. Only in the
	// sheet — in a pane there is nowhere to go. No door opens a sheet any
	// more: the command, the menu row, the bar button and the Export/History
	// openers go through `orgOpenTab` to the pane, and `modalHost()` is
	// reached only as the fallback for a workspace with no leaf to give.
	//
	// IN THE TITLEBAR, NOT THE STRIP. These doors move the WINDOW, so they
	// sit with the window's own controls: left of Obsidian's ×, wearing the
	// costume the × wears (`modal-header-button mod-raised clickable-icon`)
	// — that is what makes them titlebar controls rather than strip buttons
	// that happen to be near one. Placement CSS is the
	// `.ws-uni-modal > .ws-uni-topane` rule.
	const doors = () => {
		const host = d.host;
		if (host.kind !== 'modal') return;
		const frame = host.rootEl || d.tabsRow;
		const pop = frame.createDiv({ cls: 'modal-header-button mod-raised clickable-icon ws-uni-topane' });
		pop.title = 'Open in a pane \u2014 keeps the writing beside it';
		pop.setAttribute('aria-label', pop.title);
		glyph(pop, ['picture-in-picture-2', 'app-window', 'external-link', 'panel-right'], '\u2750');
		// THE THIRD HOST: ITS OWN OS WINDOW. Built here rather than only as a
		// command, because a command a writer has to go looking for is not a
		// control. IT GOES FURTHER FROM THE × than the pane door, so the two
		// read in order of how far they take you: close, then into a pane,
		// then out into a window.
		const popw = frame.createDiv({ cls: 'modal-header-button mod-raised clickable-icon ws-uni-topopout' });
		popw.title = 'Open in its own window \u2014 for a second screen';
		popw.setAttribute('aria-label', popw.title);
		glyph(popw, ['picture-in-picture', 'monitor', 'app-window', 'external-link', 'maximize-2'], '\u29c9');
		// THE SHEET GOES, the same rule both doors keep: two of the same
		// window, one over the other, is a writer wondering which one their
		// clicks are reaching — and on two screens it would be worse.
		const leave = (open: () => Promise<unknown>, where: string) => { void (async () => {
			try { (host.handle() as Modal).close(); } catch (_) { wsCatch('orgChrome / doors: host.handle().close();', _); }
			try { await open(); } catch (_) { wsCatch('orgChrome / doors: await ' + where + '();', _); }
		})(); };
		popw.addEventListener('click', () => leave(() => plugin.openOutlinerPopout(), 'plugin.openOutlinerPopout'));
		pop.addEventListener('click', () => leave(() => plugin.openOutlinerPane(), 'plugin.openOutlinerPane'));
		// BEFORE THE ×, so the DOM reads as the eye does: the doors, then the
		// close. A frame without an × keeps the doors where `createEl`
		// appended them.
		const xBtn = frame.querySelector<HTMLElement>('.modal-header-button:not(.ws-uni-topane):not(.ws-uni-topopout)');
		if (!xBtn) return;
		frame.insertBefore(popw, xBtn);
		frame.insertBefore(pop, popw);
		// PLACED OFF THE × ITSELF, not off a copy of its rules. Obsidian
		// sets the ×'s inset in at least four contexts (base 6px,
		// styled-scrollbars 12px, two mobile variants) — a stylesheet rule
		// of ours re-deriving it would be a second writer that is wrong in
		// three of them, which is how the door was measured sitting ON the
		// ×. Reading the computed inset and width makes Obsidian the one
		// writer. NEAREST THE × FIRST: each door steps one button width plus
		// one gap further along, all of it measured off the ×'s own inset —
		// so a third door, or a theme that insets the × differently, needs no
		// new arithmetic here and no second copy of it anywhere.
		//
		// RE-TRIED ON A FIXED SCHEDULE, not on frames alone: this runs while
		// the modal is still being BUILT — `show()` is awaits away, and an ×
		// not yet in the layout measures 0 — and an OCCLUDED Electron window
		// throttles rAF to nothing. Timers still run there. `place` is
		// idempotent, so the late calls only re-write the same value.
		const place = () => {
			try {
				const w = xBtn.offsetWidth;
				if (!w) return;
				const both = [pop, popw];
				for (let i = 0; i < both.length; i++) {
					both[i].style.insetInlineEnd = 'calc('
						+ getComputedStyle(xBtn).insetInlineEnd
						+ ' + ' + ((i + 1) * w) + 'px'
						+ ' + ' + (i + 1) + ' * var(--size-2-2))';
				}
			} catch (_) { wsCatch('orgChrome / place: const w = xBtn.offsetWidth;', _); }
		};
		if (typeof requestAnimationFrame === 'function') window.requestAnimationFrame(place);
		for (const ms of [0, 250, 1000]) window.setTimeout(place, ms);
	};

	// ── THE TAB STRIP ────────────────────────────────────────────────
	const drawTabs = () => {
		const tabsRow = d.tabsRow;
		for (const el of Array.from<HTMLElement>(tabsRow.querySelectorAll('.ws-uni-tab'))) el.remove();
		for (const t of d.TABS) {
			const b = tabsRow.createEl('button', {
				cls: 'ws-export-mini ws-uni-tab' + (t.id === d.tab ? ' is-here' : '')
			});
			// AN ICON AND A WORD, except for the one that is only an icon.
			// The two that name a question keep their labels — an icon
			// alone would make a writer learn a glyph to answer something
			// they can read — and the icon in front of it is what the eye
			// finds on the way back to a tab it has used before.
			if (t.icon) {
				const g = b.createSpan({ cls: 'ws-uni-tabicon' });
				// NAMES IN ORDER, CHECKED. `setIcon` with a name this
				// build's Lucide does not know leaves the element EMPTY and
				// throws nothing — which is how the export glyph went
				// missing for a release. `file-output` is exactly the name
				// that happened to, so it is the one that must not be
				// trusted bare. WHICH name drew, on the element: without it
				// nothing downstream — the mirror below, or a test — can
				// tell `file-output` from the fallback that stood in for it.
				let drewName = '';
				for (const n of plugin.menuIconAlts(t.icon)) {
					g.textContent = '';
					try { if (setIcon) setIcon(g, n); } catch (_) { wsCatch('orgChrome / drawTabs: if (setIcon) setIcon(g, n);', _); }
					if (g.childElementCount > 0) { drewName = n; break; }
				}
				if (drewName) g.dataset.icon = drewName;
				// THE EXPORT ARROW POINTS AWAY FROM THE PAGE. The menu draws
				// `file-output` under `.ws-menu-icon.is-mirrored` (a horizontal flip);
				// Lucide draws this family pointing LEFT, so the tab joins the menu
				// rather than the menu giving up its flip. GATED ON THE DRAWN NAME,
				// not on the row id, which is how the menu does it: the alts chain
				// can fall through to `share` or `external-link`, and those are
				// different shapes that must not be flipped.
				if (drewName === 'file-output' && plugin.menuIconMirrored(t.id)) g.addClass('is-mirrored');
				// THE SPAN STAYS EITHER WAY. Removing it when nothing drew
				// looked tidy and deletes the slot on any build whose
				// `setIcon` is absent or stubbed.
			}
			b.createSpan({ cls: 'ws-uni-tablabel', text: t.label });
			if (t.id === d.tab) { b.disabled = true; b.title = 'You are looking at this'; continue; }
			b.addEventListener('click', () => tabSet(t.id));
		}
	};

	// ONE WAY TO CHANGE TABS. The strip's click and the tree's right-click
	// ("Export this", "History here") both come through here.
	const tabSet = (id: string) => {
		// A pane built for one tab IS that tab; the other two are panes of
		// their own, opened by `orgOpenTab`.
		if (d.single) return false;
		if (!d.TABS.some((x) => x.id === id) || id === d.tab) return false;
		d.tab = id;
		d.ses.tab = id;
		// `is-organizer` switches the stylesheet's tab-specific rules.
		d.body.toggleClass('is-organizer', id === 'organizer');
		d.body.removeClass('is-treewide');
		// THE READER'S CLASS IS EXPORT'S: it hides the tree for the whole
		// body, and a tab switch must not leave it on. Export puts it back
		// itself when its reader is still up.
		d.body.removeClass('is-reader');
		// THE CURSOR EXPORT LEFT IS DROPPED HERE. A row clicked on Export or
		// History is the cursor too, and the Organizer drew it beside its own
		// chosen row as a second highlight. The cursor stays a feature — the
		// keys step from it and paint it — but it starts empty on this tab.
		if (id === 'organizer') d.orgSel.cursor = null;
		drawTabs();
		// The ticks in Obsidian's tree come and go with the Export tab.
		try { plugin.orgTicksSchedule(); } catch (_) { wsCatch('tabSet: plugin.orgTicksSchedule();', _); }
		// AND THE SAY-LINE IS CLEARED: it reports what just happened, and what
		// just happened was on the tab you have left — a refusal from Export
		// would otherwise sit under History's chart. A message outliving the
		// thing it is about is worse than no message: it is read as being
		// about what is on screen now.
		said('');
		d.drawPanel();
		// AND THE TREE, because the tick column belongs to one tab. Leaving
		// it to the panel meant the boxes outlived the tab that owns them:
		// the Export tab redraws the tree on its way in, and nothing redrew
		// it on the way out.
		d.draw();
		return true;
	};

	// ── THE SUBJECT LINE ────────────────────────────────────────────
	//
	// One line at the top of all three tabs: the path as crumbs, each a
	// click, and the counts under it. The first crumb is the vault's own
	// name — a button, never "the whole vault". The last crumb is where you
	// are and is not a button.
	const drawSubject = () => {
		const subject = d.subject, s = plugin.settings;
		subject.textContent = '';
		const crumbs = subject.createDiv({ cls: 'ws-uni-crumbs' });
		const at = d.orgFolder;
		const parts = at ? at.split('/') : [];
		// The note History is scoped to: one more crumb, the current one, and
		// the folder before it becomes a button.
		const note = d.tab === 'history' ? d.orgScope.orgNote : '';
		const crumb = (text: string, path: string, current: boolean) => {
			const c = crumbs.createEl(current ? 'span' : 'button',
				{ cls: 'ws-uni-crumb' + (current ? ' is-current' : '') + (path === '' ? ' is-root' : ''), text });
			if (!current) {
				c.title = 'Show ' + text;
				c.addEventListener('click', () => { d.orgScope.orgNote = ''; d.orgScope.orgSelect(path); });
			}
			return c;
		};
		// THE CRYSTAL, FIRST, IN THE ACCENT: the same mark the {obsidian} token
		// draws.
		try { wsSvgInto(crumbs.createSpan({ cls: 'ws-uni-crumbmark' }), wsObsidianSvg(14)); }
		catch (_) { wsCatch('drawSubject: crumbs.createSpan({ cls: ws-uni-crumbmark })', _); }
		crumb(plugin.vaultName() || 'Vault', '', !parts.length && !note);
		let acc = '';
		parts.forEach((seg, i) => {
			crumbs.createSpan({ cls: 'ws-uni-crumbsep', text: '›' });
			acc = acc ? acc + '/' + seg : seg;
			crumb(seg, acc, i === parts.length - 1 && !note);
		});
		if (note) {
			crumbs.createSpan({ cls: 'ws-uni-crumbsep', text: '›' });
			crumbs.createSpan({ cls: 'ws-uni-crumb is-current is-note',
				text: (String(note).split('/').pop() || '').replace(/\.md$/i, '') });
		}
		// THE PIN: at the line's end, Obsidian's own icon button; on, the accent
		// and the pin standing, off, faint and the pin lying down. The one
		// writer of `organizerPinned`; a press saves and redraws the line,
		// nothing else — the folder itself is untouched either way.
		if (d.tab === 'organizer') {
			const on = !!s.organizerPinned;
			const pin = crumbs.createEl('button', { cls: 'clickable-icon ws-org-pin' + (on ? ' is-on' : ''),
				attr: { type: 'button', 'aria-pressed': on ? 'true' : 'false',
					'aria-label': on ? 'Pinned: the file explorer no longer moves the Organizer. Click to release.' : 'Pin this folder: the file explorer will no longer move the Organizer.' } });
			pin.title = pin.getAttribute('aria-label') || '';
			setIcon(pin, on ? 'pin' : 'pin-off');
			pin.addEventListener('click', () => {
				s.organizerPinned = !s.organizerPinned;
				void plugin.saveSettings();
				drawSubject();
			});
		}
		const agg = note
			? (plugin._orgIndex ? wsOrgAgg(plugin._orgIndex, [note]) : null)
			: plugin.orgAggUnder(at);
		if (agg && agg.files) {
			let line = agg.words.toLocaleString() + ' words · '
				+ agg.files.toLocaleString() + ' notes';
			// AND THE FILES THAT ARE NOT NOTES: the table lists a .pdf or a .xlsx
			// among the notes, so "24 notes" over twenty-seven rows reads as a count
			// that is wrong. The rows under the place less the notes the index knows
			// are the files.
			const others = note ? 0 : Math.max(0, d.orgUnder(at).length - agg.files);
			if (others) line += ' · ' + others.toLocaleString() + (others === 1 ? ' other file' : ' other files');
			if (agg.tasksAll) line += ' · ' + agg.tasksDone + '/' + agg.tasksAll + ' tasks';
			subject.createSpan({ cls: 'ws-org-agg', text: line });
		}
		d.zoomTag();
	};

	// ── THE FOOT ─────────────────────────────────────────────────────
	//
	// WHAT WENT WRONG, SAID HERE. Refusals used to be Notices, which appear
	// in a corner of the app the writer is not looking at, sit on top of
	// whatever is there, and take themselves away before anyone has read
	// them. A window that can refuse an act should be able to say so in the
	// window: this line sits in the foot, beside the totals, where the
	// writer's eye is already going for a figure. IT CLEARS ITSELF, but
	// slowly — long enough to read twice, and replaced rather than queued if
	// a second thing goes wrong, because a stack of complaints is a thing to
	// dismiss rather than a thing to read.
	//
	// THE OFFER RIDES ON THE LINE THAT ANNOUNCED THE ACT. A separate control
	// would have to appear somewhere, and the only honest place is beside
	// the sentence saying what happened — which is already in the foot,
	// already where the writer's eye goes, and already clearing itself. So
	// the offer lives and dies with the message: when the line goes, so does
	// the chance, and there is never an Undo on screen that no longer refers
	// to anything.
	const say = d.foot.createDiv({ cls: 'ws-uni-say' });
	let sayTimer: number | null = null;
	const said = (msg: string, bad?: boolean, offer?: { run: () => unknown; label: string }) => {
		if (sayTimer) { window.clearTimeout(sayTimer); sayTimer = null; }
		say.empty();
		say.toggleClass('is-bad', !!bad && !!msg);
		// THE FOOT STANDS ONLY WHILE SPEAKING — the resting window has no
		// bottom row. This class is what CSS keys the foot's display on, and
		// `said` is the ONE writer of it (the tab switch and the 9s timer both
		// clear through here or below).
		d.foot.toggleClass('is-speaking', !!msg);
		if (!msg) return;
		say.createSpan({ text: msg });
		if (offer && offer.run) {
			const b = say.createEl('button', {
				cls: 'ws-uni-undo', text: offer.label || 'Undo' });
			// MOUSEDOWN, like every other pressable thing in this plugin.
			// A repaint between press and release swallows `click`, and
			// this line repaints on a timer.
			b.addEventListener('mousedown', (ev: Event) => {
				ev.preventDefault();
				ev.stopPropagation();
				// Taken away the instant it is pressed: the act is async
				// and the button would otherwise sit there inviting a
				// second press, which would be a second move.
				b.remove();
				Promise.resolve(offer.run()).catch(() => {});
			});
		}
		sayTimer = window.setTimeout(() => {
			sayTimer = null; say.empty(); d.foot.removeClass('is-speaking');
		}, 9000);
	};

	return { doors, drawTabs, tabSet, drawSubject, said };
};
