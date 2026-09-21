// Word-Smith — Bar: the powerline bar: its rows, the fit, the rules, the tokens and buttons, the pickers, the presets.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { MarkdownView, TFile, Notice, setIcon, Platform } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type { WordSmithSettings, WsBoolKey, WsCursorSmithSettings, WsCursorSmithLook, WsStringKey, WsMenuPickItem } from './settings';
import { PL_SEP_ASPECT, PL_SOFT, PL_SOFT_SPLIT, PL_THEME_BGS, PL_THEME_INKS, WS_STYLESHEET_VERSION, barCloneValue, mixColors, readBarDirective, wsCatch, wsBag, wsErrMsg, BAR_KEYS, BAR_KEYS_LIVE, BAR_SECTION_GAP, BAR_THEME_INK_VARS, FIT_CLASS_AMBIENT, FIT_CLASS_DECORATION, FIT_CLASS_IDENTITY, FIT_CLASS_ORNAMENT, FIT_CLASS_READING, FIT_RESTORE_MARGIN, FIT_SLACK, OBSIDIAN_ICON_PATH, PL_BG_COUNT, PL_DIR, PL_DIVIDERS, READ_WPM, barCodeToPreset, barPresetWithDefaults, wsFlagSvg, wsStatusLabel, wsStatusNext, wsSvgInto, wsTaskSay, wsNodeOf } from './preamble';
import type WordSmith from './plugin';

export const barMethods = {

	barGeometry(this: WordSmith) {
		const L = [];
		const n = (v: number) => Math.round(v * 100) / 100;
		try {
			const bar = this.retroStatusBarEl;
			if (!bar) return 'Word-Smith: the powerline bar is not up.';
			L.push('Word-Smith ' + (this.manifest ? this.manifest.version : '?') + ' bar geometry');
			const ss = getComputedStyle(document.body)
				.getPropertyValue('--ws-stylesheet-version').trim();
			L.push('styles.css: v' + (ss || '(absent)') + ' — script expects v'
				+ WS_STYLESHEET_VERSION
				+ (String(WS_STYLESHEET_VERSION) === ss ? '  OK' : '  <-- STALE, fix this first'));
			const bs = getComputedStyle(bar);
			L.push('bar: ' + n(bar.getBoundingClientRect().width) + 'px wide, bg ' + bs.backgroundColor);
			L.push('rows: ' + this.getStatusRows().map(r => JSON.stringify(r.left)).join(' | '));

			for (const section of Array.from(bar.querySelectorAll('.ws-status-section'))) {
				const kids = Array.from(section.children);
				if (!kids.length) continue;
				L.push('');
				L.push(section.className.replace('ws-status-section ', '') + ':');
				const sr = section.getBoundingClientRect();
				let prevRight = null;
				for (const el of kids) {
					const r  = el.getBoundingClientRect();
					const cs = getComputedStyle(el);
					const shape = el.getAttribute && el.getAttribute('data-shape');
					const cap   = el.getAttribute && el.getAttribute('data-cap');
					// For an SVG the paint is in its rects, not its own style.
					const fills = Array.from(el.nodeType === 1 ? el.querySelectorAll('rect,path') : [])
						.map(c => c.getAttribute('fill') + '@' + c.getAttribute('x'));
					L.push('  ' + (shape ? 'SEP ' + shape + (cap ? '/' + cap : '') : 'SEG')
						+ '  x ' + n(r.left - sr.left) + ' → ' + n(r.right - sr.left)
						+ '  w ' + n(r.width));
					L.push('      margin ' + cs.marginLeft + ' / ' + cs.marginRight
						+ '   z ' + cs.zIndex + '   pos ' + cs.position
						+ (shape ? '' : '   bg ' + cs.backgroundColor));
					if (fills.length) L.push('      fills ' + fills.join('  '));
					// The joint itself: where this box starts against where
					// the last one ended. A gap means bar showing through; an
					// overlap means one of them is covering the other, and
					// WHICH one is covering is the whole question.
					if (prevRight != null) {
						const d = n(r.left - prevRight);
						L.push('      joint: ' + (d === 0 ? 'flush'
							: d > 0 ? 'GAP of ' + d + 'px' : 'overlap of ' + (-d) + 'px')
							+ (Number.isInteger(d) ? '' : '   <-- fractional'));
					}
					prevRight = r.right;
				}
			}
		} catch (e) {
			L.push('threw: ' + wsErrMsg(e));
		}
		const out = L.join('\n');
		// A developer's diagnostic, at the level the console hides by default.
		try { console.debug(out); } catch (_) { wsCatch('barGeometry: console.debug(out);', _); }
		return out;
	},

	// ── Peeking at a hidden bar ───────────────────────────────────────────
	// Bring the bar back while the pointer is near the strip it hides in, and
	// let it linger a moment after the pointer leaves.
	//
	// Driven by pointer COORDINATES, not by an element. The comment on the
	// slide-away rule in styles.css records three attempts at a screen-edge
	// hover strip, all of which ended up fighting Obsidian's own chrome: an
	// invisible full-width element at the window edge is a bad neighbour to
	// the status bar, the window controls and anything else living there,
	// however carefully it is layered. A comparison against clientY has no
	// neighbours at all.
	//
	// The handler is on document mousemove, which this codebase has removed
	// once before on cost grounds — so everything expensive is hoisted out of
	// it. The common case (peeking not armed) is one boolean read, and the
	// zone's top edge is cached rather than measured per frame.
	barPeekArmed(this: WordSmith) {
		return !!(this._peekArmed);
	},

	// Recomputed wherever the bar's height or hidden state can change, so the
	// move handler never measures anything.
	syncBarPeekState(this: WordSmith) {
		const armed = !!(this.settings.pluginEnabled
			&& this.retroStatusBarEl
			&& this.barIsHidden()
			&& (Number(this.settings.barPeekMs) || 0) > 0);
		this._peekArmed = armed;
		if (!armed) this.endBarPeek(true);
		// The strip the bar occupies when it is out, plus a little reach so
		// the pointer does not have to land exactly on a 28px band.
		const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
		const box = (this._barBoxHeight || 0) + this.vimGutterHeight();
		this._peekZoneTop = Math.max(0, vh - box - 26);
	},

	onPointerForBarPeek(this: WordSmith, clientY: number) {
		if (!this._peekArmed) return;
		if (clientY >= this._peekZoneTop) this.beginBarPeek();
		else if (this._barPeek) this.scheduleBarPeekEnd();
	},

	beginBarPeek(this: WordSmith) {
		if (this._barPeekTimer) { window.clearTimeout(this._barPeekTimer); this._barPeekTimer = null; }
		if (this._barPeek) return;
		this._barPeek = true;
		this.setBarPeekClass(true);
	},

	// Leaving the zone starts the linger rather than ending it: the bar is
	// most useful in the second after you have glanced away from it, and a
	// bar that vanishes the instant the pointer moves is one you cannot read.
	scheduleBarPeekEnd(this: WordSmith) {
		if (!this._barPeek || this._barPeekTimer) return;
		const ms = Math.max(0, Number(this.settings.barPeekMs) || 0);
		this._barPeekTimer = window.setTimeout(() => {
			this._barPeekTimer = null;
			this.endBarPeek();
		}, ms);
	},

	endBarPeek(this: WordSmith, immediate?: boolean) {
		if (this._barPeekTimer) { window.clearTimeout(this._barPeekTimer); this._barPeekTimer = null; }
		if (!this._barPeek) return;
		this._barPeek = false;
		this.setBarPeekClass(false, immediate);
	},

	// The slide is the same one the hide command uses, so it borrows the same
	// transition class — which exists only while something is moving, because
	// a permanent `transition: transform` promotes the bar to its own layer
	// and its text loses subpixel antialiasing (see styles.css).
	setBarPeekClass(this: WordSmith, on: boolean, skipAnim?: boolean) {
		const body = document.body;
		if (!skipAnim) {
			body.classList.add('ws-bar-anim');
			window.clearTimeout(this._barAnimT);
			this._barAnimT = window.setTimeout(
				() => document.body.classList.remove('ws-bar-anim'), 350);
		}
		body.classList.toggle('ws-bar-peek', !!on);
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Bar preset CRUD
	// ─────────────────────────────────────────────────────────────────────────
	// The library lives on this.settings, so saveSettings persists it with
	// everything else and there is no second store to keep in step.

	getBarPresets(this: WordSmith) {
		if (!this.settings.barPresets || typeof this.settings.barPresets !== 'object') {
			this.settings.barPresets = {};
		}
		return this.settings.barPresets;
	},

	// Saves under `name`, overwriting silently if it exists — that is what
	// makes Edit work: load, adjust, save under the same name.
	async saveBarPreset(this: WordSmith, name: string) {
		const snap: Record<string, unknown> = {};
		// LIVE keys only. A preset asserting a key nothing reads is stating
		// an opinion with no effect, and the shipped ones had to be stripped
		// of them by hand every time they were re-baked.
		for (const k of BAR_KEYS_LIVE) {
			// Deep-copied. statusRows is an array of objects, and storing the
			// live reference would make every later edit in the panel rewrite
			// the preset it was saved from.
			snap[k] = barCloneValue(wsBag(this.settings)[k]);
		}
		this.getBarPresets()[name] = snap;
		await this.saveSettings(true);
	},

	async loadBarPreset(this: WordSmith, name: string) {
		const preset = this.getBarPresets()[name];
		if (!preset) return false;
		this.applyBarSnapshot(preset);
		await this.saveSettings(true);
		this._activeBarPreset = name;
		return true;
	},

	// Writes a snapshot over the live settings. Only BAR_KEYS are touched, so
	// nothing outside the Retro Bar tab can be reached by a preset — including
	// one that arrived as a share code from a stranger, which is the case
	// worth being strict for.
	applyBarSnapshot(this: WordSmith, preset: Record<string, unknown>) {
		const full = barPresetWithDefaults(preset);
		for (const k of BAR_KEYS) wsBag(this.settings)[k] = full[k];
		// A snapshot can carry a border style the dropdown no longer offers
		// — an old saved preset, or a share code from someone still on a
		// build that had Groove and Ridge. loadSettings sweeps the stored
		// value and the stored presets, but neither runs on a code applied
		// mid-session, and a dropdown asked to select a value it has no
		// option for lands on its first one ("None") and silently drops
		// both edges.
		if (this.settings.statusBarBorderStyle === 'groove'
			|| this.settings.statusBarBorderStyle === 'ridge') {
			this.settings.statusBarBorderStyle = 'solid';
		}
		// getStatusRows() and the panel both assume three row objects exist
		// whatever statusBarRows says, so a code carrying a short (or absent)
		// array must not leave the panel reading row 2 of undefined.
		if (!Array.isArray(this.settings.statusRows)) this.settings.statusRows = [];
		while (this.settings.statusRows.length < 3) {
			this.settings.statusRows.push({ left: '', center: '', right: '' });
		}
		for (const row of this.settings.statusRows) {
			for (const slot of ['left', 'center', 'right'] as const) {
				if (typeof row[slot] !== 'string') row[slot] = '';
			}
		}
	},

	// Step through the preset library from whichever one was loaded last.
	//
	// Names it out loud. A bar preset can change one colour or the whole
	// layout, and stepping past a subtle one with no feedback reads as the
	// command having done nothing — so the Notice is the confirmation, not a
	// courtesy.
	//
	// `_activeBarPreset` is set by loadBarPreset and is deliberately NOT
	// persisted: after a restart the first press starts from the top of the
	// list, which is honest, rather than resuming from a preset the settings
	// may no longer match because the writer edited the bar by hand since.
	async cycleBarPreset(this: WordSmith, direction: number) {
		const presets = this.getBarPresets();
		const names = Object.keys(presets);
		if (!names.length) {
			new Notice('Word-Smith: no bar presets saved yet.');
			return;
		}
		if (!this.settings.enableRetroStatus) {
			new Notice('Word-Smith: the Powerline bar is off.');
			return;
		}
		// indexOf returns -1 for an unknown or absent name, which is exactly
		// what makes the first forward step land on index 0.
		const at = names.indexOf(this._activeBarPreset);
		const next = names[(at + direction + names.length) % names.length];
		await this.loadBarPreset(next);
		new Notice('Bar preset: ' + next);
	},

	async deleteBarPreset(this: WordSmith, name: string) {
		delete this.getBarPresets()[name];
		await this.saveSettings(true);
	},

	// Adds an imported code to the library without loading it — the writer
	// decides when to switch. Returns the name it was filed under, or null if
	// the code was not one of ours.
	async importBarPreset(this: WordSmith, code: string) {
		const parsed = barCodeToPreset(code);
		if (!parsed) return null;
		const presets = this.getBarPresets();
		// Never silently overwrite something the writer built. A colliding
		// name gets a suffix instead, and the row that appears carries it, so
		// the collision is visible rather than a preset quietly changing.
		let name = parsed.name;
		if (name in presets) {
			let n = 2;
			while ((parsed.name + ' ' + n) in presets) n++;
			name = parsed.name + ' ' + n;
		}
		presets[name] = parsed.snap;
		await this.saveSettings(true);
		return name;
	},

	// Drops tokens that no longer fit, lowest priority first, so the bar
	// degrades instead of clipping or spilling.
	//
	// Measured PER SECTION, not per row. Each of the three sections is
	// `flex: 1 1 0; min-width: 0; overflow: hidden`, so a section clips its
	// own content and the row's scrollWidth NEVER exceeds its clientWidth —
	// measuring the row (the first version of this) could not detect
	// overflow at all, which is why nothing was ever dropped. It also means
	// the sections are independent: a crowded centre must not cost the left
	// section its file name.
	//
	// Buttons are never dropped. They are the only parts of the bar that DO
	// something — syntax, prose checks, markers, font, report — and a
	// control that vanishes when the window narrows is worse than a reading
	// that does: the reading is still in the note, the control is not.
	// Everything else goes in reverse document order, so a section sheds
	// from its far end and keeps its leading readings longest.
	//
	// Powerline segments take their separator with them. A hidden segment
	// whose arrow stayed behind reads as a colour glitch, and the emptiness
	// collapse that normally handles that runs at BUILD time, before any of
	// this is measurable.
	fitSections(this: WordSmith, rowEl: HTMLElement) {
		const secs = rowEl
			? Array.from(rowEl.querySelectorAll('.ws-status-section'))
			: [];
		return secs.length ? secs : [rowEl];
	},

	clearFitHidden(this: WordSmith, rowEl: HTMLElement) {
		if (!rowEl) return;
		for (const el of Array.from<HTMLElement>(rowEl.querySelectorAll('.ws-fit-hidden'))) {
			el.classList.remove('ws-fit-hidden');
		}
	},

	// Everything a row may drop, ordered worst-first: from the two window
	// margins inward, alternating sides, with the centre last.
	//
	// The order is what makes "buttons have priority" actually hold. Dropping
	// per section could not deliver it: sections are laid out as equal
	// thirds, so a right section holding three buttons gets a third of the
	// row however empty the left section is — and having nothing droppable of
	// its own, it clipped them. Judging the whole row at once means a
	// crowded left section sheds text so the buttons on the right keep
	// their room.
	// What a segment is WORTH, as a number, so the fit pass sheds by value
	// rather than by where a thing happens to sit.
	//
	// Position was the whole rule before this: readings dropped from the
	// margins inward, so a word count at the edge of the row died before a
	// decorative rule in the middle of it. Position is still the tie-break
	// WITHIN a class, which is what keeps the shedding predictable — it is
	// no longer the first question.
	//
	// Read from what the segment CONTAINS, once, at measure time. There is
	// deliberately no way to declare a priority in the format string: the
	// classes below are right nearly always, the grammar is rich enough
	// already, and a wrong default can be fixed in one place where a knob
	// has to be learned by everyone.
	fitClassOf(this: WordSmith, el: HTMLElement) {
		if (!el || !el.classList) return FIT_CLASS_READING;
		// 3 — identity and controls. The things that say where you are and
		// let you act. Buttons are filtered out before this and never shed
		// at all; this covers the rest.
		if (el.classList.contains('ws-fit-identity')
			|| el.querySelector('.ws-fit-identity')) {
			return FIT_CLASS_IDENTITY;
		}
		const text = (el.textContent || '').trim();
		// 0 — decoration. A segment carrying no text at all is a rule, a
		// spacer run or a sliver: it was asked for, and it says nothing.
		// Fades and caps are shed wholesale before this stage ever runs.
		if (!text) return FIT_CLASS_DECORATION;
		// 1 — ornament with meaning. A drawn glyph and nothing else: the
		// Obsidian crystal, a lone mode dot. Says something, but nothing a
		// writer would miss for a minute.
		if (el.querySelector('svg') && text.length <= 2) {
			return FIT_CLASS_ORNAMENT;
		}
		// 1.5 — ambient. The clock and the time: readings by shape, but the
		// time is also on the system clock and the wall, so it is the first
		// reading a narrow row should give up.
		if (el.classList.contains('ws-fit-ambient')
			|| el.querySelector('.ws-fit-ambient')) {
			return FIT_CLASS_AMBIENT;
		}
		// 2 — readings. Everything else: counts, positions, headings.
		return FIT_CLASS_READING;
	},

	fitCandidates(this: WordSmith, rowEl: HTMLElement) {
		const secs = this.fitSections(rowEl);
		const pick = (sec: HTMLElement) => Array.from(sec
			? sec.querySelectorAll('.ws-pl-seg, .ws-fit-item') : [])
			.filter(el => !el.querySelector('.ws-barbtn')
				&& !el.classList.contains('ws-barbtn'))
			// In a powerline row the SEGMENT is the unit — it is the thing
			// with a colour, a shape at each end and a boundary the writer
			// chose. Its items are the readings inside it, and hiding one of
			// those on its own would leave a coloured box with a hole in it.
			// Plain rows have no segments, so every item is a candidate.
			.filter(el => el.classList.contains('ws-pl-seg')
				|| !(el.closest && el.closest('.ws-pl-seg')))
			// Whitespace between two buttons is an item like any other now
			// that runs are split per token. Dropping it saves four pixels
			// and jams two glyphs together, which is a worse row than the
			// one that did not fit.
			.filter(el => el.classList.contains('ws-pl-seg')
				|| (el.textContent || '').trim() !== '');
		const byClass = (c: string) => secs.filter(s => s.classList && s.classList.contains(c));
		const left  = byClass('ws-status-left').flatMap(pick);
		const right = byClass('ws-status-right').flatMap(pick).reverse();
		const mid   = byClass('ws-status-center').flatMap(pick).reverse();
		// Sections with none of the three classes (the no-section fallback
		// used in tests, and any future layout) behave like the centre.
		const other = secs.filter(s => !s.classList
			|| !(s.classList.contains('ws-status-left')
				|| s.classList.contains('ws-status-right')
				|| s.classList.contains('ws-status-center'))).flatMap(pick);

		// Alternate margins so the bar contracts evenly instead of eating
		// one end to the middle before touching the other.
		const edges = [];
		for (let i = 0; i < Math.max(left.length, right.length); i++) {
			if (left[i])  edges.push(left[i]);
			if (right[i]) edges.push(right[i]);
		}
		// Position order, which is now the TIE-BREAK rather than the rule.
		const positional = edges.concat(other, mid);

		// Sorted by value class, stably, so within a class the order above
		// is exactly what it always was: margins first, alternating, then
		// the centre. What changes is that a decorative rule anywhere on the
		// row now goes before a word count at the edge of it.
		//
		// A stable sort is load-bearing here. Array.prototype.sort has been
		// stable since ES2019, and the whole point is that equal classes
		// keep their positional order — an unstable sort would scramble the
		// edges-inward behaviour into something arbitrary.
		return positional
			.map((el, i) => ({ el, i, cls: this.fitClassOf(el) }))
			.sort((a, b) => (a.cls - b.cls) || (a.i - b.i))
			.map(x => x.el);
	},

	// Everything belonging to a FADE — the gradient segments and the shapes
	// that only exist to stand against them.
	//
	// A fade is a run of {g} bands with no text in it at all: a colour
	// stepping into its neighbour, or out into the bar at a group's end. It
	// is the one thing on a row that carries no reading, no label and no
	// boundary — a `|` between two segments at least says where one ends,
	// and a fade does not even do that, because its whole job is to make
	// the join invisible. So when a row runs out of width it is the first
	// thing that should go, and it goes before the caps rather than after:
	// a default row spends ~130px on fades and ~40px on caps.
	//
	// The SEPARATORS ON BOTH SIDES go with it, which is the one place this
	// differs from the ordinary shed loop below (which takes one). A
	// separator is built to blend the colour on its left into the colour on
	// its right, and a fade's edge colours are its outermost bands — so a
	// separator left behind is a shape drawn in a colour no remaining box
	// is wearing, which reads as exactly the glitch the blend exists to
	// avoid. Two real segments left directly adjacent is a state the bar
	// already handles: the segment bleed covers it (see
	// renderPowerlineSection), because an empty segment collapsing at build
	// time produces the same thing.
	//
	// A {g} with an explicit :N is NOT a fade and is not collected here. It
	// is a solid sliver — edge shading the writer chose a colour for — and
	// renderPowerlineSection is careful to keep that meaning separate.
	fadeCandidates(this: WordSmith, rowEl: HTMLElement) {
		const out = [];
		const fades = rowEl
			? Array.from(rowEl.querySelectorAll('.ws-pl-fade')) : [];
		for (const fade of fades) {
			out.push(fade);
			for (const sib of [fade.previousElementSibling, fade.nextElementSibling]) {
				if (sib && sib.classList && sib.classList.contains('ws-pl-sep')
					&& out.indexOf(sib) === -1) {
					out.push(sib);
				}
			}
		}
		return out;
	},

	// How wide a section's contents actually are — summed from the
	// CHILDREN, never from the section's own scrollWidth: scrollWidth is
	// never smaller than clientWidth, and the centre section stretches to
	// fill the leftover room, so its scrollWidth reported the whole gap
	// between its neighbours however little text it held. Summing sections
	// that way put the row over its width at EVERY size, and the margins
	// were shed immediately at full width.
	//
	// getBoundingClientRect, NOT offsetWidth. `offsetWidth` is a property of
	// HTMLElement; SVGElement does not implement it, so every separator
	// measured as `undefined || 0` — ZERO — and the fit pass was blind to
	// them. Measured in the field: a row whose children summed to 948px in
	// an 890px bar, with nothing dropped, because 174px of that was
	// separators the count could not see. The overflow went where overflow
	// goes when `.ws-status-section` is `overflow: hidden`: the outermost
	// shapes were clipped, which is a group's lead and tail caps.
	//
	// It also explains why the artefact moved when a divider character
	// changed and not when the window did. Swapping `|` (2px) for `<` (a
	// full arrow) moves the total by 13px per divider, so it changes what
	// gets cut; a zoom step scales the overflow and the clip together, so
	// the cut looks the same.
	//
	// Fractional widths are kept rather than rounded: three sections each
	// losing up to half a pixel is most of FIT_SLACK.
	sectionContentWidth(this: WordSmith, sec: HTMLElement) {
		if (!sec || !sec.children) return 0;
		let w = 0;
		for (const child of Array.from(sec.children) as HTMLElement[]) {
			if (child.classList && child.classList.contains('ws-fit-hidden')) continue;
			if (child.getBoundingClientRect) {
				w += child.getBoundingClientRect().width || 0;
			} else {
				w += (child.offsetWidth || 0);
			}
		}
		return w;
	},

	// True when the row's content fits — which is the same question as
	// "do the sections still clear one another". Nothing degrades until
	// they actually touch: a centre with air either side of it, or a left
	// and a right with a gap between them when there is no centre, is a bar
	// that has room and must be left alone.
	//
	// The row itself can never overflow (its sections clip), so the section
	// widths are summed. The GAPS count too: `.ws-status-row` sets
	// `gap: 12px`, and ignoring it declared a fit while the sections were
	// already shoulder to shoulder. Only occupied sections take part —
	// an empty centre neither occupies width nor separates anything, so a
	// left and a right meet across one gap, not two.
	rowContentFits(this: WordSmith, rowEl: HTMLElement) {
		const secs = this.fitSections(rowEl);
		let total = 0, occupied = 0;
		for (const sec of secs) {
			const w = this.sectionContentWidth(sec);
			total += w;
			if (w > 0) occupied++;
		}
		const gaps = Math.max(0, occupied - 1) * BAR_SECTION_GAP;
		// FIT_SLACK, not a bare comparison. A row sitting exactly on the
		// boundary would drop a token, which frees width, which lets the
		// next measure restore it, which overflows again — a loop that
		// shows as tokens blinking. A few pixels of slack means the state
		// that follows a drop is comfortably a fit, so it settles.
		return total + gaps <= (rowEl.clientWidth || 0) - FIT_SLACK;
	},

	fitStatusRow(this: WordSmith, rowEl: HTMLElement, measure?: (el: HTMLElement) => boolean) {
		if (!rowEl) return;
		const fits = measure || ((el) => this.rowContentFits(el));
		// Nothing is measurable until layout has happened. clientWidth is 0
		// while the bar is hidden or mid-teardown, and the row would look
		// hopelessly overfull against a zero width and strip itself bare.
		if (!rowEl.clientWidth) return;
		this.clearFitHidden(rowEl);

		// Rule one, before any token is hidden: collapse a full path to the
		// file name. The name identifies the note; the folders are context
		// the pane already gives you, and dropping them is far cheaper than
		// dropping a reading.
		//
		// Both directions are latched against the width that triggered them,
		// not against the current fit. Without that the bar oscillates: a
		// shortened row fits, so the name is restored, so it overflows, so
		// it shortens — once per frame. It only lengthens again once the
		// window is meaningfully wider than it was when it gave up.
		// Defensive: this runs from stampMaskPositions among others, and can
		// be reached before settings are loaded. A throw here would take
		// mask placement down with it.
		const canShorten = (this.settings || {}).fileTokenFormat !== 'name';
		if (canShorten && !fits(rowEl) && !this._fitShortenFile) {
			this._fitShortenFile = true;
			this._fitShortenWidth = rowEl.clientWidth;
			this.requestBarRebuild();
			return;
		}
		if (this._fitShortenFile && fits(rowEl)
			&& rowEl.clientWidth > (this._fitShortenWidth || 0) + FIT_RESTORE_MARGIN) {
			this._fitShortenFile = false;
			this.requestBarRebuild();
			return;
		}

		// Rule one and a half: drop a leading crumb from {#>}.
		//
		// After the file path and before anything is hidden, one crumb at a
		// time so a row that only needs a little does not lose the lot. The
		// deepest heading is the one that says where you are, so the
		// chapter above it goes first.
		const headCrumbs = this.headingCrumbCount();
		if (headCrumbs > 1 && !fits(rowEl)
			&& (this._fitShortenHead || 0) < headCrumbs - 1) {
			this._fitShortenHead = (this._fitShortenHead || 0) + 1;
			this._fitShortenHeadWidth = rowEl.clientWidth;
			this.requestBarRebuild();
			return;
		}
		if ((this._fitShortenHead || 0) > 0 && fits(rowEl)
			&& rowEl.clientWidth > (this._fitShortenHeadWidth || 0) + FIT_RESTORE_MARGIN) {
			this._fitShortenHead = 0;
			this.requestBarRebuild();
			return;
		}

		if (fits(rowEl)) return;

		// Rule two: shed the fades before anything else on the row.
		//
		// ALL of them, in one step, rather than one at a time from the
		// margins in like the readings below. A fade is one graded object —
		// its bands' colours are computed across the whole run, each strictly
		// between the two ends — so dropping half a run leaves a gradient
		// with a step in the middle of it, which is worse to look at than
		// either the full fade or none. The unit here is the decoration, not
		// the band.
		//
		// The cost of being wholesale is that a row five pixels over loses
		// every band it has. That is the right trade for this particular
		// thing and not for anything else on the bar: a fade carries no
		// information, so the row loses nothing but its shading, and it all
		// comes back in the same frame the window widens (clearFitHidden at
		// the top of every pass unhides everything before remeasuring).
		const fades = this.fadeCandidates(rowEl);
		if (fades.length) {
			for (const el of fades) el.classList.add('ws-fit-hidden');
			if (fits(rowEl)) return;
		}

		// Rule three: shed the caps before any token goes.
		//
		// A cap is the shape where a group meets the bar — the point at the
		// very start or end of a run. It carries nothing: no reading, no
		// label, not even a boundary between two segments, since the thing
		// on its far side is the bar itself. At the current default it is
		// about 0.78 of a row height EACH, so a three-group row gets six
		// caps back, which is frequently the whole overflow.
		//
		// Before tokens, therefore, and not after: dropping a word count to
		// keep a decoration would be the wrong way round. They come back on
		// their own, because clearFitHidden above unhides everything at the
		// start of every pass — so a widened window restores the points in
		// the same frame it restores the tokens.
		const caps = rowEl.querySelectorAll('.ws-pl-cap');
		if (caps.length) {
			for (const cap of Array.from<HTMLElement>(caps)) cap.classList.add('ws-fit-hidden');
			if (fits(rowEl)) return;
		}

		for (const el of this.fitCandidates(rowEl)) {
			// A fade already went with rule two, and its separators with it.
			// Re-hiding it would cost a measure and free nothing.
			if (el.classList.contains('ws-fit-hidden')) continue;
			el.classList.add('ws-fit-hidden');
			// The separator facing the rest of the row goes with it: left
			// behind, the shape hangs off nothing and reads as a glitch.
			const sib = el.previousElementSibling || el.nextElementSibling;
			if (sib && sib.classList && sib.classList.contains('ws-pl-sep')) {
				sib.classList.add('ws-fit-hidden');
			}
			if (fits(rowEl)) return;
		}
	},

	fitStatusBar(this: WordSmith, measure?: (el: HTMLElement) => boolean) {
		for (const rowEl of (this._statusRowEls || [])) this.fitStatusRow(rowEl, measure);
	},

	// The border style as it is actually allowed to render.
	//
	// Normalised at the point of USE as well as migrated on load, because
	// the value can arrive by a route that never passes through loadSettings
	// — an applied share code, a preset saved by an older install, a
	// hand-edited data.json. The migration keeps the dropdown honest; this
	// keeps the paint honest, and neither is redundant.
	barBorderStyle(this: WordSmith) {
		const st = this.settings.statusBarBorderStyle || 'solid';
		// 'hairline' was briefly a style; it is weight 0 now
		return (st === 'groove' || st === 'ridge' || st === 'hairline') ? 'solid' : st;
	},

	// THE HAIRLINE IS WEIGHT 0: the style, the edges and the colours stay as
	// chosen.
	barRuleIsHair(this: WordSmith) {
		const w = this.settings.statusBarBorderWidth;
		return this.barBorderStyle() !== 'none' && w != null && Number(w) === 0;
	},

	// WHETHER THE BOTTOM RULE DRAWS: the switch, and for a hairline the gap
	// too. A bar sitting on the window's edge already has the frame's own
	// hairline as its bottom edge, and a second one drawn under it moves the
	// tokens up a pixel for nothing; a bar lifted off the edge has no frame
	// under it and gets its own. A weighted rule draws wherever the switch
	// says.
	barBottomRuleOn(this: WordSmith) {
		const s = this.settings;
		if (this.barBorderStyle() === 'none' || s.statusBarBorderBottom === false) return false;
		return !this.barRuleIsHair() || this.barBottomGapPx() > 0;
	},

	// How much vertical room the bar's rules occupy. Zero unless powerline
	// is on AND that edge is enabled AND the style draws something — the
	// overlay only paints under those conditions, so reserving space in any
	// other case would leave a bare strip.
	//
	// Two numbers per edge now, and the difference is the fix for a zoom
	// hairline. `top`/`bottom` are what the rule DRAWS and what the bar's
	// height carries; `bandTop`/`bandBottom` are what the padding RESERVES,
	// and for a solid rule that is one pixel LESS. The segments therefore
	// run one pixel under the rule, and the rule — the ::after overlay at
	// z-index 3 — paints over the overlap. Reserving the full width made
	// the rule's inner edge and the row's outer edge meet EXACTLY, and two
	// edges that meet exactly are two edges that round to device pixels
	// independently: at any fractional page zoom (Ctrl+= app zoom, OS
	// display scaling) a one-device-pixel line of bare bar opened between
	// them — top or bottom, wandering with the zoom and the bar's own
	// fractional position. Measured, not reasoned: a 45-case grid in a
	// real Chromium was flush at zoom 1.0 and broke in 39/45 cases at 0.9.
	// Same invariant as the separator rect's overdraw and the segment
	// bleed: overlaps are whole pixels, and the later painter wins.
	//
	// Solid only. Dashed, dotted and double rules have see-through gaps,
	// and what shows through them must be the BAR, not the top sliver of
	// every segment — those styles keep the full band and, with it, the
	// theoretical hairline, which inside a broken line pattern has nothing
	// to read as.
	barRuleWidths(this: WordSmith) {
		const s = this.settings;
		const style = this.barBorderStyle();
		if (style === 'none') return { top: 0, bottom: 0, bandTop: 0, bandBottom: 0 };
		// a hairline (weight 0) is one device pixel: it reserves a pixel and no band
		const hair = this.barRuleIsHair();
		const w = hair ? 1 : Math.max(1, Math.min(8, s.statusBarBorderWidth || 1));
		const band = (style === 'solid' || hair) ? Math.max(0, w - 1) : w;
		// the bottom edge reads the gap too (`barBottomRuleOn`): a hairline on
		// the window's edge reserves nothing for one
		const top = s.statusBarBorderTop !== false, bot = this.barBottomRuleOn();
		return {
			top:        top ? w : 0,
			bottom:     bot ? w : 0,
			bandTop:    top ? band : 0,
			bandBottom: bot ? band : 0,
		};
	},

	// The four variables the sheet's overlay reads (.ws-powerline::after):
	// each edge's width, the style and the alpha. The hairline is half a CSS
	// pixel wide: one device pixel on a hi-DPI screen, where a 1px rule is
	// two, and still one on a plain screen, since nothing thinner than a
	// device pixel is drawn.
	barRuleVars(this: WordSmith) {
		const s = this.settings;
		const st = this.barBorderStyle();
		const hair = this.barRuleIsHair();
		const w = hair ? '0.5px' : Math.max(1, Math.min(8, s.statusBarBorderWidth || 2)) + 'px';
		// each edge can be turned off on its own; the style's None turns both off at once
		const onTop = st !== 'none' && s.statusBarBorderTop !== false;
		const onBot = this.barBottomRuleOn();
		// AT OBSIDIAN'S OWN WEIGHT OF COLOUR: Chromium snaps a border to whole
		// device pixels, so on a 1.25× screen 0.5px and 1px are the same one
		// device pixel — the hairline is told apart by its weight of colour, as
		// a hairline on paper is. Obsidian's borders are the text at about a
		// tenth over the ground; 15% of the rule's own colour reads as one of
		// them.
		return { top: onTop ? w : '0px', bottom: onBot ? w : '0px', style: (onTop || onBot) ? st : 'none', alpha: hair ? '15%' : '100%' };
	},

	// The bar's vertical padding, clamped once so the stamping, the height
	// and the separator geometry cannot disagree about it.
	barPadding(this: WordSmith) {
		const c = (v: number) => Math.max(0, Math.min(24, v != null ? v : 5));
		return {
			top: c(this.settings.statusBarPadTop),
			bottom: c(this.settings.statusBarPadBottom)
		};
	},

	// Row height with the pixel-parity snap applied — shared between the
	// variable stamping and the geometry that has to agree with it.
	snappedRowHeight(this: WordSmith) {
		let rowH = this.settings.statusBarHeight;
		if ((rowH - (this.settings.statusBarFontSize || 13)) % 2 !== 0) rowH += 1;
		// The parity snap adds a pixel, which at the bottom of the range
		// would let a 12px row round up and never actually reach 12. Snap
		// DOWN instead once that would happen, so both ends of the slider
		// are reachable and the parity still holds.
		if (rowH > 30) rowH -= 2;
		return Math.max(12, rowH);
	},

	// ── THE GAP IS THE WRITER'S, AND `:` BORROWS IT ─────────────────
	//
	// The resting gap under the bar is a number the writer picks (a slider,
	// 0–30), and `saveSettings` refreshes on the drag. Vim is asked only
	// about the panel that is actually OPEN — a flag the codemirror hook
	// sets on both transitions — so there is no stale answer to have;
	// gating this on the vim setting would follow a toggle only when
	// something else happened to refresh. `vimGutterHeight` and
	// `--ws-vim-gutter` are recomputed every refresh and never persisted,
	// so nothing stale can survive under them.
	barBottomGapPx(this: WordSmith) {
		const n = Number(this.settings.barBottomGap);
		if (!isFinite(n)) return 23;
		return Math.max(0, Math.min(30, Math.round(n)));
	},

	// …AND WHAT THE `:` LINE NEEDS, which is a measurement and not a
	// choice: this vault's own panel height — the theme's input metrics,
	// not a guess at a row — persisted (vimPanelHeight) so the reservation
	// is right on the next launch rather than settling after the first `:`,
	// floored at a row so a bad read cannot hide the line, and clamped so
	// one cannot push the bar up the screen.
	vimPanelReserve(this: WordSmith) {
		const rowH = this.snappedRowHeight();
		const measured = this.settings.vimPanelHeight || 0;
		if (!(measured > 0)) return rowH;
		return Math.max(rowH, Math.min(measured, 120));
	},

	// WHAT IS UNDER THE BAR RIGHT NOW: the writer's gap, lifted to fit the
	// `:` line while it is open and only while it is open. TO THE MEASURED
	// HEIGHT — the real panel this vault has, not a fixed number — so the
	// line fits exactly whatever the theme and font make it. AND `max`,
	// NOT A SWAP: a writer who chose 30 keeps 30 while `:` is open. The
	// lift is for a gap too SMALL to hold the line; it is not permission
	// to shrink one they chose.
	//
	// THE GUARD BELONGS HERE, not in the readers: six of them read this
	// answer (`applyCssVariables`, the peek zone, two in the letterbox, the
	// codemirror panel and `chromeFloorY`), and gating each is five more
	// chances to forget the seventh. THE MEASUREMENT IS KEPT, NOT CLEARED:
	// `vimPanelHeight` stays in settings, so a writer who turns vim ON gets
	// the right reservation immediately. Every rule reads
	// `var(--ws-vim-gutter, 0px)`, so zero is the shape they were written
	// for.
	vimGutterHeight(this: WordSmith) {
		const gap = this.barBottomGapPx();
		if (!this._vimPanelOpen) return gap;
		return Math.max(gap, this.vimPanelReserve());
	},

	// The theme surface a :bN slot asks for, as a colour that will actually
	// paint — or '' if none of its chain will.
	//
	// This exists because a var() fallback is not the guard it looks like. It
	// fires only when a variable is UNDEFINED. A theme that defines one and
	// gets the value wrong — `--background-secondary-alt: #grey`, where the
	// author meant the colour NAME `grey` and the `#` makes it nothing —
	// resolves perfectly well to garbage, no fallback triggers, and
	// `background-color: var(--ws-bg)` is invalid at computed-value time. An
	// invalid colour does not fall back to the previous declaration; it falls
	// back to the property's INITIAL value, and for background-color that is
	// `transparent`. So one typo in a theme took the whole bar away, and then
	// the end caps with it — barColor reads back as transparent, and a cap's
	// SHAPE is drawn in barColor, so it painted invisibly over its own
	// backing rect and the group appeared to start with a straight edge.
	//
	// themeSurfaceColor answers the only question that matters — what does
	// this actually compute to — and returns '' for undefined, transparent
	// and invalid alike, because a browser renders all three the same way.
	barSurfaceColor(this: WordSmith, slot: string) {
		const names = PL_THEME_BGS[slot];
		if (!names) return '';
		for (const name of names) {
			const c = this.themeSurfaceColor(name);
			if (c) return c;
		}
		return '';
	},

	resolveBarDirective(this: WordSmith, dir: ReturnType<typeof readBarDirective>) {
		let bg = dir.bg, text = dir.text;
		// A theme slot is RESOLVED rather than passed through as a var()
		// chain, so an unpaintable value falls through to the next name and
		// finally to the page colour, instead of blanking the bar. The
		// segment path has always worked this way (powerlineSegColor walks
		// the same list); only the bar directive trusted CSS to sort it out.
		if (dir.bgTheme) {
			const c = this.barSurfaceColor(dir.bgTheme);
			bg = c || 'var(--background-primary)';
		}
		// A theme slot (:b1…:b4, ;t1…;t3) is RESOLVED here rather than left
		// as the var() chain the parser produced.
		//
		// Left as a chain it was stamped straight into --ws-bg, and the bar
		// paints with `background-color: var(--ws-bg)`. If that resolved to
		// `transparent` the bar vanished — and then barColor, read back off
		// the element, saw rgba(0,0,0,0) and stayed 'transparent' too, so
		// every group's end cap drew its SHAPE in nothing over a rectangle
		// of the segment colour and the group appeared to begin with a
		// straight edge. Reported as two faults in light mode with :b3 or
		// :b4 (":b1 and :b2 are fine, and dark mode is fine"), one cause,
		// and one that only shows on a theme that defines those two
		// surfaces as transparent — which is why the theme and the slot both
		// had to be right for anyone to see it.
		//
		// Falling back to the chain when nothing resolves keeps the old
		// behaviour for the case this cannot improve on: a theme where even
		// --background-primary is unpaintable.
		if (dir.bgTheme && PL_THEME_BGS[dir.bgTheme]) {
			const c = this.firstPaintable(PL_THEME_BGS[dir.bgTheme]);
			if (c) bg = c;
		}
		if (dir.textTheme && BAR_THEME_INK_VARS[dir.textTheme]) {
			const c = this.firstPaintable(BAR_THEME_INK_VARS[dir.textTheme]);
			if (c) text = c;
		}
		// :bs with no ink written pairs with the STRIP'S OWN measured ink,
		// not --text-normal. A worn scheme's status surface can be a
		// saturated colour none of its body inks read on (PaperColor's
		// teal carries black at 5.30 and its softened inks at 4.30 at
		// best) — and --status-bar-text-color is exactly the ink
		// applyThemeVars measured against that surface. With no scheme
		// worn the variable is Obsidian's own status-bar ink, and the
		// chain still ends at --text-normal for a theme that defines
		// neither. Written text (;N, ;tN, ;vim) wins as ever — this fires
		// only when both halves of the ink decision were left blank.
		if (dir.bgTheme === 'bs' && text === null && dir.textSlot == null) {
			text = 'var(--status-bar-text-color, var(--text-normal))';
		}
		if (dir.bgSlot != null) {
			let c = null;
			if (dir.bgSlot === 'vim') {
				c = this.vimModeColor();
			} else if (dir.bgSlot === 'f') {
				// The flag of the note in hand, or nothing when it has none:
				// null leaves the background as it stands, which is the same
				// contract `:bc` keeps for a caret with no colour. A segment
				// that painted itself grey on an unflagged note would be a
				// segment that says "no flag" louder than a flag says
				// anything.
				c = this.flagColor();
			} else if (dir.bgSlot === 'bc') {
				// The caret's live colour. Null leaves bg as it stands,
				// and the caller's floor names the page — the same
				// contract a wholly unpaintable chain keeps.
				c = this.cursorColor();
			} else {
				// Same 1-based wrap as a segment's :N — a saved :9 folds
				// into the palette rather than failing.
				const list = this.powerlineColors();
				const n1 = Number(dir.bgSlot) || 1;
				c = list[(((n1 - 1) % list.length) + list.length) % list.length];
			}
			if (c) {
				bg = c;
				if (text === null && dir.textSlot == null) text = this.powerlineInk(c);
			}
		}
		if (dir.textSlot != null) {
			text = dir.textSlot === 'vim'
				? (this.vimModeColor() || text)
				: dir.textSlot === 'bc'
				? (this.cursorColor() || text)
				: dir.textSlot === 'f'
				? (this.flagColor() || text)
				: this.powerlineTextColor(Number(dir.textSlot) || 1);
		}
		return { bg, text, bgSlot: dir.bgSlot, textSlot: dir.textSlot, rest: dir.rest };
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Retro status bar
	// ─────────────────────────────────────────────────────────────────────────

	// The retro bar is one fixed element shared by every pane, so it follows
	// the active file's scope rather than any single editor's.
	// Slid out of view by command. The element stays in the DOM so the move
	// can animate; nothing else should treat it as occupying space.
	barIsHidden(this: WordSmith) {
		if (!this.retroBarActive()) return false;
		// Two independent reasons, either sufficient: the slide-away command,
		// and zen's own "hide the bar too" sub-option. Both route through
		// here rather than through separate paths, so everything that reads
		// "is the bar occupying the bottom of the window" — the gutter
		// reservation, the caret floor, the mask geometry — gets the same
		// answer without knowing why.
		if (this.settings.retroBarHidden) return true;
		return !!(this.settings.zenHideBar && this.zenActive());
	},

	retroBarActive(this: WordSmith) {
		if (!this.settings.enableRetroStatus) return false;
		// OFF BY DEFAULT ON A PHONE: the master switch stays what it is — it
		// syncs with the desktop's data.json — and a phone adds its own opt-in
		// beneath it.
		if (typeof Platform !== 'undefined' && Platform && Platform.isPhone
			&& !this.settings.retroBarOnPhone) return false;
		// ── AND NOT IN THE PLUGIN'S OWN PANES ────────────────────────────
		//
		// A pane of ours means no bar, and Obsidian's own status bar shows
		// there as it does under any other view. The scope check below is the
		// note's, as it always was.
		if (this.wsOwnViewActive()) return false;
		return this.isActiveFileInScope();
	},

	updateStatusBar(this: WordSmith) {
		const wantBar = this.retroBarActive();
		// THE NATIVE BAR IS DECIDED HERE TOO. `applyBodyClasses` sets it on a
		// refresh and on a layout change; switching to one of our panes is an
		// active-leaf-change, which reaches THIS through
		// `updateWorkspaceAesthetics` and not that — so the answer is applied
		// wherever the question is asked, or the native bar would stay up
		// until the layout next moved.
		try {
			const hideNative = this.shouldHideNativeStatusBar();
			document.body.classList.toggle('zenmode-hide-status-bar', hideNative);
		} catch (_) { wsCatch('updateStatusBar: const hideNative = this.shouldHideNativeStatusBar();', _); }
		if (wantBar && !this.retroStatusBarEl) {
			this.retroStatusBarEl = document.body.createDiv({ cls: 'ws-status-bar' });
			// The gutter plinth is its OWN element, not a shadow and not a
			// pseudo. A pseudo-element is clipped by the bar's overflow
			// (needed for text ellipsis), and a box-shadow cannot be
			// confined: covering the gutter under a short bar needs spread,
			// and spread grows sideways too — once the bar stopped being
			// full-width that poked past both of its ends, over the sidebar
			// and the pane divider. A sibling has exact geometry and no
			// bleed in any direction.
			this.retroPlinthEl = document.body.createDiv({ cls: 'ws-bar-plinth' });
			this.startClockTick();
		} else if (!wantBar && this.retroStatusBarEl) {
			this.retroStatusBarEl.remove();
			this.retroStatusBarEl = null;
			if (this.retroPlinthEl) { this.retroPlinthEl.remove(); this.retroPlinthEl = null; }
			this.stopClockTick();
		}
		if (this.retroStatusBarEl) {
			// Powerline segments are the bar's surface, so the bar never
			// draws rules of its own: a 2px line in the text colour along
			// the top and bottom is exactly the strip the segment colour
			// was stopping short of. The segments carry their own edges —
			// that is what the shapes are for. The bar's own borders are
			// therefore stamped to zero unconditionally below, rather than
			// only while a toggle was on.
			const rule = this.barRuleVars();
			// In powerline the rules are drawn by an ::after OVERLAY rather
			// than borders. A border is part of the box, so it took its
			// width out of the row and the segment colour stopped short of
			// the bar's edge. The first replacement — inset box-shadows —
			// never showed at all: even an inset shadow paints BELOW the
			// element's children, and the segments fill the whole bar box,
			// so the rules were drawn and then covered every frame. The
			// pseudo-element sits above the segments (see styles.css,
			// .ws-powerline::after), takes the width and style the settings
			// ask for through the variables stamped here, and the segment
			// colour still runs to the edge underneath it. Borders on an
			// overlay also honour dashed/dotted, which a shadow never could.
			const S = this.retroStatusBarEl.style;
			S.setProperty('--ws-bar-rule-top-width',    rule.top);
			S.setProperty('--ws-bar-rule-bottom-width', rule.bottom);
			S.setProperty('--ws-bar-rule-style',        rule.style);
			S.setProperty('--ws-bar-rule-alpha',        rule.alpha);
			// The rules' COLOURS are not stamped here. They are
			// theme-dependent, and this method runs on a bar rebuild, not on
			// a theme change — see applyCssVariables, which the theme
			// observer does call. Width and style are theme-independent and
			// stay on the element.
			// The rules change the bar's height, and the bottom mask ends at the
			// bar's top edge — so the mask has to be restamped after they land,
			// not before. The ResizeObserver catches this too; this is the cheap
			// direct path for the common case.
			this.scheduleMaskPosition();
			// A bar rebuilt after the observer was created is a new element
			// and is not being watched yet.
			if (this.maskResizeObserver) {
				try { this.maskResizeObserver.observe(this.retroStatusBarEl); } catch (_) { wsCatch('updateStatusBar: this.maskResizeObserver.observe(this.retroStatusBarEl);', _); }
			}
		}
		// Body class lets CSS lift bottom editor panels (vim ":" command
		// line etc.) above the bar — see styles.css.
		document.body.classList.toggle('ws-retrobar-active', !!this.retroStatusBarEl);
		this.applyCssVariables();
	},

	startClockTick(this: WordSmith) {
		if (this.clockInterval) return;
		// registerInterval → Obsidian clears it automatically on unload
		this.clockInterval = this.registerInterval(window.setInterval(() => {
			// THE BATTERY RIDES THE CLOCK. See `refreshBattery`: the reading
			// used to change only when the browser dispatched an event, and
			// on a machine where it never does the figure was stuck at the
			// value it was born with. No new timer — this one was already
			// running at fifteen seconds for the time.
			this.refreshBattery();
			this.updateRetroStatusBar();
		}, 15000));
	},

	stopClockTick(this: WordSmith) {
		if (this.clockInterval) { window.clearInterval(this.clockInterval); this.clockInterval = null; }
	},

	// ── THE BATTERY, ASKED AGAIN RATHER THAN WAITED ON ──────────────────────
	//
	// Issue #9: `{battery}` sat at 100% for ever on a Surface Pro 6 running
	// CachyOS with the Surface kernel.
	//
	// THE READING WAS EVENT-DRIVEN AND NOTHING ELSE. `setupBattery` read the
	// level once and then trusted `levelchange` to say when it moved. On
	// Chromium the Battery Status API is fed by UPower over D-Bus, and where
	// UPower does not expose the device — a non-standard kernel is the usual
	// way to meet that — the manager reports its DEFAULT of level 1.0 and
	// charging true, and never fires an event again. A reading that only
	// changes when told is stuck for ever at the value it was born with.
	//
	// ONE SOURCE, RE-READ. The browser’s manager is asked again on the
	// clock tick that was already running at 15 seconds for the time
	// display — no new timer, no work during load, and `formatBattery`
	// still only reads the cache. On an implementation that updates its
	// properties without dispatching, this is what notices.
	//
	// No sysfs read through Node's `fs` on Linux (it would skip a failing
	// UPower layer): the community plugin review flags any `fs` use, so a
	// Linux machine whose UPower does not see its battery reads the browser's
	// default. `ws-dev/battery_probe.js` holds the build to no `fs` at all.
	refreshBattery(this: WordSmith) {
		// On a manager that is genuinely stuck, this is the same value
		// again and costs a property read.
		const bm = this._batteryManager;
		if (!bm) return;
		try {
			if (typeof bm.level === 'number') this.batteryLevel = Math.round(bm.level * 100);
			this.batteryCharging = !!bm.charging;
		} catch (_) { wsCatch('refreshBattery: if (typeof bm.level === \'number\') this.batteryLevel = …', _); }
	},

	async setupBattery(this: WordSmith) {
		// A machine where `navigator.getBattery` is missing shows `?%`.
		if (!navigator.getBattery) return;
		try {
			const bm = await navigator.getBattery();
			const update = () => {
				// STILL THROUGH `refreshBattery`, so an event and a tick
				// answer the same way and there is one reader of `bm`.
				this.refreshBattery();
				this.updateRetroStatusBar();
			};
			this._batteryManager = bm;
			this._batteryHandler = update;
			bm.addEventListener('levelchange', update);
			bm.addEventListener('chargingchange', update);
			update();
		} catch (_) { wsCatch('setupBattery: const bm = await navigator.getBattery();', _); }
	},

	formatBattery(this: WordSmith) {
		if (this.batteryLevel === null) return '?%';
		return (this.batteryCharging ? '⚡︎' : '') + this.batteryLevel + '%';
	},

	// Converts a #rrggbb / #rgb hex color plus an alpha (0–1) into an
	// rgba() string, so a single color-picker + slider pair can produce a
	// translucent highlight without needing CSS color-mix() support.
	hexToRgba(this: WordSmith, hex: string, alpha: number) {
		if (!hex) return 'transparent';
		let h = hex.replace('#', '');
		if (h.length === 3) h = h.split('').map((c) => c + c).join('');
		const r = parseInt(h.substring(0, 2), 16) || 0;
		const g = parseInt(h.substring(2, 4), 16) || 0;
		const b = parseInt(h.substring(4, 6), 16) || 0;
		const a = Math.max(0, Math.min(1, alpha != null ? alpha : 1));
		return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
	},

	// Date parts, not a formatted string. {dd} {mm} {yyyy} {yy} compose in
	// the row format itself, so any separator or order works — dd/mm, mm-dd,
	// yyyy.mm.dd — without a format-string setting to parse, validate and
	// preview. The row format was already the place users arrange things.
	// THE PARTS, NOT A FORMAT — and the only place this plugin pads a local
	// date or time: `hh`/`mi` joined the four date parts when the
	// Organizer's columns went to a fixed dd/mm/yyyy hh:mm, rather than a
	// second padding implementation for the same fact.
	//
	// LOCAL GETTERS ON PURPOSE. Never arithmetic on epoch ms (`ms %
	// 86400000` ignores DST) and never `toISOString()`, which is UTC and
	// hands back yesterday for half the planet every evening.
	//
	// Callers own their own FORMAT. The bar arranges these into whatever
	// row the writer typed; `orgStamp` joins them one fixed way. That
	// separation is the point: a change to the bar's clock must not
	// silently re-format a table column.
	dateParts(this: WordSmith, now: Date) {
		const yyyy = String(now.getFullYear());
		return {
			dd:   String(now.getDate()).padStart(2, '0'),
			mm:   String(now.getMonth() + 1).padStart(2, '0'),
			yyyy: yyyy,
			yy:   yyyy.slice(-2),
			hh:   String(now.getHours()).padStart(2, '0'),
			mi:   String(now.getMinutes()).padStart(2, '0')
		};
	},

	// An analogue clock face: a circle and two hands, nothing else. No
	// numerals, no tick marks, no second hand — at bar sizes those become
	// noise, and a second hand would also force a per-second repaint of the
	// whole bar for a reading nobody takes from a 12px dial.
	//
	// SVG rather than a glyph, for the same reason the separators are: no
	// patched font to depend on, and it scales with the bar's font size.
	// currentColor throughout, so it inherits whatever the segment or the
	// bar is using and needs no colour setting of its own.
	// {obsidian} — the OFFICIAL crystal, at last.
	//
	// Fourth form, and the lesson of the first three is why it is this
	// one. A hand-drawn stone silhouette was a featureless spot; redrawn
	// as strokes it smeared into a scribble at 13px; rebuilt as a fill
	// with hand-cut facet grooves it was legible but still not THE icon.
	// The actual mark solves all three at once, because its designers
	// solved them first: the crystal's four facets are separate SUBPATHS,
	// so the facet lines are built-in gaps in the fill — the knockout
	// structure, drawn by the people who drew the logo, proven at favicon
	// size in every browser tab the app has ever sat in. One path, fill
	// currentColor, nothing else.
	//
	// Path data via the simple-icons library (CC0). The mark itself is
	// Obsidian's trademark, used here to depict Obsidian inside a
	// personal-use plugin, which their brand guidelines expressly allow.
	buildObsidianIcon(this: WordSmith) {
		const svg = createSvg('svg');
		svg.setAttribute('class', 'ws-obsidian-icon');
		svg.setAttribute('viewBox', '0 0 24 24');
		const p = createSvg('path');
		p.setAttribute('d', OBSIDIAN_ICON_PATH);
		p.setAttribute('fill', 'currentColor');
		svg.appendChild(p);

		// Wrapped, exactly as the dial is, and for the same reason: this
		// carried a `vertical-align` for years that has done nothing since
		// the bar became a flex row. See buildClockFace for the full
		// argument and for the two conditions that keep it honest.
		//
		// The crystal's own numbers differ from the clock's because its path
		// fills its viewBox corner to corner while the dial leaves two units
		// of margin all round for its stroke — so at one size the crystal
		// draws the larger of the two, and matching them means giving each
		// its own.
		const box = createSpan();
		box.className = 'ws-obsidian-box';
		box.appendChild(svg);
		return box;
	},

	buildClockFace(this: WordSmith, now?: Date) {
		const t = now || new Date();
		const svg = createSvg('svg');
		svg.setAttribute('class', 'ws-clock');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		// Non-scaling stroke would keep the ring hairline-thin while the
		// hands stayed heavy; a plain width scales with the box instead.
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');

		const ring = createSvg('circle');
		ring.setAttribute('cx', '12');
		ring.setAttribute('cy', '12');
		ring.setAttribute('r', '9');
		svg.appendChild(ring);

		// Hours advance with the minutes — a hand that jumps between whole
		// hours reads as broken twice an hour, at :59 and :00.
		const mins  = t.getMinutes();
		const hours = t.getHours() % 12 + mins / 60;
		const hand = (angleDeg: number, length: number) => {
			// -90 so that 0 points up; SVG angles start at three o'clock.
			const a = (angleDeg - 90) * Math.PI / 180;
			const l = createSvg('line');
			l.setAttribute('x1', '12');
			l.setAttribute('y1', '12');
			l.setAttribute('x2', (12 + Math.cos(a) * length).toFixed(2));
			l.setAttribute('y2', (12 + Math.sin(a) * length).toFixed(2));
			svg.appendChild(l);
		};
		hand(hours * 30, 4);   // 30 degrees an hour, short hand
		hand(mins * 6,  6.5);  // 6 degrees a minute, long hand
		// THE TIME IS SAID ON THE BOX BELOW, NOT ON THE SVG. Obsidian's tooltip
		// asks the hovered element `isShown()`, which enhance.js puts on
		// HTMLElement.prototype — an SVG has none, and every hover over the
		// dial would throw "e.isShown is not a function" and show nothing.

		// WRAPPED, and the wrapper is the whole point of it.
		//
		// The dial has to sit on the text's baseline to look level with the
		// time beside it, and `vertical-align` is the only thing in CSS that
		// positions against a baseline. It does nothing on a flex item — and
		// a drawn token appended straight into `.ws-pl-inner` (inline-flex,
		// align-items: center) is exactly that, which is why the dial has
		// been centred on a BOX rather than a baseline ever since powerline
		// became the only way the bar draws.
		//
		// So: the wrapper becomes the flex item and gets centred, and the
		// SVG is inline INSIDE it, where vertical-align works again. That
		// lands the alignment on real font metrics instead of a fudge
		// factor, which is the fix — the fudge factor had to point in
		// opposite directions in two different fonts.
		//
		// It only works because the wrapper's line box comes out the same
		// height as a text item's. Two things make that true and both are
		// worth knowing before changing either: the bar leaves line-height
		// at `normal`, so the strut is comfortably taller than the dial and
		// the dial does not stretch the line box; and the wrapper holds no
		// text of its own, so its baseline is the strut's, in the same place
		// as every neighbouring reading's. A line-height of 1 on the bar
		// would make the dial the tallest thing in its line box and shift
		// its baseline by a fraction of a pixel — survivable, but it is the
		// thing that would start the drift.
		const box = createSpan();
		box.className = 'ws-clock-box';
		box.setAttribute('aria-label', this.formatTime(t));
		box.appendChild(svg);
		return box;
	},

	// The bar's clock, 24-hour. Composed from `dateParts` rather than
	// padding again — same output as the two inline padStarts it replaces.
	formatTime(this: WordSmith, now: Date) {
		const p = this.dateParts(now);
		return p.hh + ':' + p.mi;
	},

	// ════════════════════════════════════════════════════════════════════════
	// RETRO BAR: rows, modes, pickers
	// ════════════════════════════════════════════════════════════════════════

	// Normalised row list: left/center/right strings, regardless of what
	// data.json holds.
	//
	// ONE row, deliberately, and `statusBarRows` is vestigial — the bar's
	// height reserves for one too (see barRows in applyCssVariables), so the
	// two agree and nothing is half-drawn. What was left behind is the
	// setting itself, which is still in DEFAULT_SETTINGS and still carried
	// by share codes at index 0, and this comment, which used to claim it
	// was honoured.
	//
	// Restoring multi-row means changing both counts together; changing one
	// gives either rows with no space to draw in or a bar with an empty
	// strip at the bottom.
	getStatusRows(this: WordSmith) {
		const n   = 1;
		const src = Array.isArray(this.settings.statusRows) ? this.settings.statusRows : [];
		const out = [];
		for (let i = 0; i < n; i++) {
			out.push(Object.assign({ left: '', center: '', right: '' }, src[i] || {}));
		}
		return out;
	},

	// The three modes that change how the editor behaves. Typewriter and
	// Hemingway are scope-gated because they genuinely stop applying on an
	// out-of-scope note; zen is not, because its chrome is workspace-wide.
	// An empty result is a real answer here — no modes on — not a failure.
	// All three, each with its live state. The bar shows every one of them so
	// the badges can double as switches — a mode you cannot see is a mode you
	// cannot turn back on from here.
	getAllModes(this: WordSmith) {
		const scoped = this.isActiveFileInScope();
		return [
			{ key: 'tw',  letter: 'T', label: 'Typewriter mode', setting: 'enableTypewriter',
			  on: !!this.opt('enableTypewriter') && scoped },
			{ key: 'hem', letter: 'H', label: 'Hemingway mode',  setting: 'hemingwayEnabled',
			  on: !!this.opt('hemingwayEnabled') && scoped },
			// Reports whether zen is actually on, not merely permitted. The
			// master alone is not zen: with focus mode off it lights the
			// letterbox and nothing else.
			{ key: 'zen', letter: 'Z', label: 'Zen',             setting: 'zenEnabled',
			  action: () => this.toggleZenFromBar(), on: this.zenActive() }
		];
	},

	getActiveModes(this: WordSmith) {
		return this.getAllModes().filter(m => m.on);
	},

	getModeLabel(this: WordSmith) {
		return this.getActiveModes().map(m => m.letter).join('');
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Bar pickers
	//
	// Obsidian's Menu cannot show a colour swatch beside a label or fade a row
	// that is switched off, and both are the whole point here — the syntax
	// picker has to be a legend as well as a control. So this is a small
	// popup of our own: rows of { dot, label }, anchored above the bar.
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// BAR PICKERS: the shared popup
	// ════════════════════════════════════════════════════════════════════════

	// items: [{ label, on, color?, icon?, onClick }]
	// mode 'toggle' keeps the popup open so several classes can be flipped in
	// one visit; 'choose' closes on the first pick, which is what a
	// three-way view switch wants.
	openBarPicker(this: WordSmith, anchorEl: HTMLElement, items: WsMenuPickItem[], mode: string) {
		this.closeBarPicker();
		const pop = createDiv();
		pop.className = 'ws-picker';

		for (const item of items) {
			const row = createDiv();
			// Sub-options indent under the master switch at the foot of the
			// list, so the popup reads as a group rather than a flat pile.
			// `on` is a live function on most pickers; testing it as a value
			// made every row read as on, which is why toggled-off modes
			// never faded until now.
			const isOn = typeof item.on === 'function' ? item.on() : !!item.on;
			row.className = 'ws-picker-row' + (isOn ? '' : ' is-off') + (item.sub ? ' is-sub' : '');

			// Only colour-bearing rows get a swatch. A hollow ring beside
			// "Spaces" said nothing except that a circle could have gone
			// there; without one the whole popup collapses to labels.
			if (item.color) {
				const dot = createSpan();
				dot.className = 'ws-picker-dot';
				// 'currentColor' means "whatever this row is drawn in",
				// which is already the stylesheet's default for the dot —
				// so it is a request for a ball, not for a colour, and
				// writing it inline would be a second copy of that default.
				// It also keeps fading with the row when the check is off,
				// which a fixed value does not.
				if (item.color !== 'currentColor') dot.style.backgroundColor = item.color;
				row.appendChild(dot);
			}

			if (item.icon) {
				const ic = item.icon();
				ic.classList.add('ws-picker-icon');
				row.appendChild(ic);
			}

			const label = createSpan();
			label.className = 'ws-picker-label';
			label.textContent = item.label;
			// A font list that does not show the fonts is a list of words.
			if (item.font) label.style.fontFamily = item.font;
			row.appendChild(label);

			// mousedown, not click. The bar rebuilds itself on edits, on the
			// clock tick and on scroll; if a rebuild lands between mousedown
			// and mouseup, the browser fires `click` on the nearest common
			// ancestor instead of the element, and the handler never runs.
			// That is why these buttons felt dead — the listener was correct
			// and simply never reached.
			row.addEventListener('mousedown', (e) => { void (async () => {
				e.preventDefault();
				e.stopPropagation();
				if (item.onClick) await item.onClick();
				if (mode === 'choose') this.closeBarPicker();
				else this.refreshBarPicker(pop);
			})(); });
			pop.appendChild(row);
		}

		// Live handles for refreshBarPicker — never wired before, so click
		// toggles repainted nothing.
		pop._live = items;

		document.body.appendChild(pop);
		this._barPicker = pop;

		// Anchored to the token, flipped up, and nudged back inside the
		// viewport if the token sits near an edge.
		const a = anchorEl.getBoundingClientRect();
		const r = pop.getBoundingClientRect();
		let left = a.left + (a.width / 2) - (r.width / 2);
		left = Math.max(6, Math.min(left, window.innerWidth - r.width - 6));
		pop.style.left   = left + 'px';
		pop.style.bottom = (window.innerHeight - a.top + 6) + 'px';

		// Dismissal tests containment rather than relying on stopPropagation,
		// so a stray listener elsewhere cannot leave the popup stuck open.
		const dismiss = (e: Event) => {
			if (pop.contains && e && pop.contains(wsNodeOf(e.target))) return;
			this.closeBarPicker();
		};
		this._barPickerDismiss = dismiss;
		window.setTimeout(() => {
			document.addEventListener('mousedown', dismiss, true);
			if (this._barPickerKey) document.addEventListener('keydown', this._barPickerKey);
		}, 0);
	},

	// Rebuild the rows in place. Re-opening the popup instead would move it
	// out from under the pointer between two clicks.
	refreshBarPicker(this: WordSmith, pop: HTMLDivElement) {
		const live = pop._live;
		if (!live) return;
		const rows = pop.children;
		for (let i = 0; i < live.length && i < rows.length; i++) {
			const fn = live[i].on;
			rows[i].classList.toggle('is-off', !(typeof fn === 'function' ? fn() : fn));
		}
	},

	closeBarPicker(this: WordSmith) {
		if (this._barPickerDismiss) {
			document.removeEventListener('mousedown', this._barPickerDismiss, true);
			if (this._barPickerKey) document.removeEventListener('keydown', this._barPickerKey);
			this._barPickerDismiss = null;
		}
		if (this._barPicker) { this._barPicker.remove(); this._barPicker = null; }
	},

	// ── THE WIDTH OF ONE {s} OR ONE {g} ─────────────────────────────────────
	//
	// A WHOLE NUMBER OF PIXELS, computed once from the bar's own font size.
	//
	// It was `0.25em`, which is right in principle — a spacer should be a
	// quarter of a space, in whatever the bar is set in — and wrong in every
	// detail that shows. `em` resolves against inherited size, so the same
	// three bands came out one width in one segment and another elsewhere;
	// and 0.25em of 13px is 3.25px, so three bands drawn separately round to
	// 3/3/4 or 3/4/3 depending on where the run lands in the subpixel grid.
	// That is the reported fault exactly: `{g}{g}{g}` was not the same width
	// as `{ggg}`, and the steps inside a run came out uneven.
	//
	// Rounded, and never below 2: a band that rounds to one pixel is a hair,
	// and a fade made of hairs is a smudge.
	plUnit(this: WordSmith) {
		const size = Number((this.settings || {}).statusBarFontSize) || 13;
		return Math.max(2, Math.round(size * 0.25));
	},

	// ── THE WORD OR THE ICON ───────────────────────────────────────────
	//
	// ONE PAINTER FOR THE TEN. The icon is the one the menu row wears — read
	// through `menuIconFor`, with the same alternatives `menuDrawIcon` tries,
	// so the bar and the menu cannot disagree about what a feature looks
	// like. THREE SHAPES, ONE ANSWER: 'icon', 'word' or 'both'. Font and
	// Markers keep their own two keys (`fontTokenFormat`,
	// `markersTokenFormat`: presets and share codes carry them, and 'glyph'
	// is the icon there); the rest live in one map, `barTokenIcons`, absent
	// meaning the word. An icon that will not draw (no `setIcon` under a
	// test) falls back to the word, so nothing on the bar is ever blank.
	barTokenFormat(this: WordSmith, id: string) {
		const s: Partial<WordSmithSettings> = this.settings || {};
		const own = (v: string) => (v === 'word' ? 'word' : v === 'both' ? 'both' : 'icon');
		if (id === 'font') return own(s.fontTokenFormat || 'glyph');
		if (id === 'markers') return own(s.markersTokenFormat || 'glyph');
		const m = s.barTokenIcons;
		const v = m && typeof m === 'object' ? m[id] : '';
		// THE TWO COUNTS DEFAULT TO THE ICON: the number with the pane's small
		// icon after it is that number saying what it counts; the word is a
		// choice.
		if (id === 'properties' || id === 'backlinks') return v === 'word' ? 'word' : v === 'both' ? 'both' : 'icon';
		return v === 'icon' ? 'icon' : v === 'both' ? 'both' : 'word';
	},

	barTokenIconOn(this: WordSmith, id: string) {
		return this.barTokenFormat(id) !== 'word';
	},

	// THE ICON A TOKEN WEARS: its menu row's, or — for the two readings that
	// have no menu row — the icon of the pane the click opens, read from
	// obsidian.asar: the Properties view is `lucide-info`, Backlinks
	// `links-coming-in`.
	barTokenIconName(this: WordSmith, id: string) {
		if (id === 'properties') return 'info';
		if (id === 'backlinks') return 'links-coming-in';
		// the menu has no row for itself: its settings page's icon
		if (id === 'powermenu') return 'layout-grid';
		try { return this.menuIconFor(id) || ''; } catch { return ''; }
	},

	barTokenPaint(this: WordSmith, node: HTMLElement, id: string, word: string) {
		node.textContent = '';
		node.classList.remove('is-icon', 'is-both');
		// (a suite's stand-in node has no removeAttribute)
		if (typeof node.removeAttribute === 'function') node.removeAttribute('aria-label');
		const fmt = this.barTokenFormat(id);
		if (fmt !== 'word') {
			const glyph = this.barTokenIconName(id);
			const alts = glyph ? (this.menuIconAlts ? this.menuIconAlts(glyph) : [glyph]) : [];
			for (const n of alts) {
				node.textContent = '';
				try { if (typeof setIcon === 'function') setIcon(node, n); } catch (_) { wsCatch('barTokenPaint: setIcon(node, n);', _); }
				if (node.childElementCount > 0) {
					node.classList.add('is-icon');
					// MIRRORED WHERE THE MENU MIRRORS IT: the same `is-mirrored` the menu
					// row wears, so the arrow points the same way on both.
					try { if (this.menuIconMirrored && this.menuIconMirrored(id)) node.classList.add('is-mirrored'); } catch (_) { wsCatch('barTokenPaint: menuIconMirrored(id)', _); }
					if (fmt === 'both') {
						// ICON + NAME: the word after the icon, and no label — the word is on
						// the bar.
						node.classList.add('is-both');
						const w = createSpan();
						w.className = 'ws-bartok-word';
						w.textContent = word;
						node.appendChild(w);
					} else {
						node.setAttribute('aria-label', word);
					}
					return;
				}
			}
			node.textContent = '';
		}
		node.textContent = word;
	},

	// A button in the bar: label or icon, click opens a picker.
	buildBarButton(this: WordSmith, cls: string, render: (node: HTMLElement) => void, title: string, onClick: (anchor: HTMLElement) => unknown) {
		const el = createSpan();
		el.className = 'ws-barbtn is-clickable ' + cls;
		render(el);
		el.title = title;
		// mousedown for the same reason as the picker rows: a bar repaint
		// between press and release swallows `click` entirely.
		el.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick(el);
		});
		return el;
	},

	// Straight to the History tab rather than to the report's first tab: a
	// writer who put {history} on the bar asked for the history, and making
	// them click through the note counts first would make the token pointless.
	buildHistoryIndicator(this: WordSmith) {
		return this.buildBarButton('ws-barbtn-history',
			(node: HTMLElement) => this.barTokenPaint(node, 'history', 'History'),
			'Your writing history \u2014 click to open it',
			() => this.openHistoryModal());
	},

	buildExportIndicator(this: WordSmith) {
		return this.buildBarButton('ws-barbtn-export',
			(node: HTMLElement) => this.barTokenPaint(node, 'export', 'Export'),
			'Compile a manuscript \u2014 click to open the export window',
			() => this.openExportModal());
	},

	// THE MENU FROM THE BAR: the door the ribbon and the command open, the
	// Powermenu floating over the note.
	buildPowermenuIndicator(this: WordSmith) {
		return this.buildBarButton('ws-barbtn-powermenu',
			(node: HTMLElement) => this.barTokenPaint(node, 'powermenu', 'Menu'),
			'The Powermenu \u2014 click to open it',
			() => this.openBarMenu());
	},

	// THE ORGANIZER'S BUTTON on the bar. The METHOD and the sentinel keep
	// the old `outliner` spelling on purpose: they are internal names,
	// nothing a writer can type or see. What the writer named is the TOKEN
	// and the LABEL, and both of those changed.
	buildOutlinerIndicator(this: WordSmith) {
		return this.buildBarButton('ws-barbtn-outliner',
			(node: HTMLElement) => this.barTokenPaint(node, 'organizer', 'Organizer'),
			'Arrange the manuscript \u2014 click to open the Organizer',
			// NO TAB: a caller that exists to open a PARTICULAR tab is asking; a
			// caller that exists to open THE WINDOW is not, even when it names one
			// — this one's own tooltip says which it is. A session that remembers
			// nothing falls back to `organizer` anyway.
			() => this.orgOpenTab('organizer'));
	},

	// ── {flag} ──────────────────────────────────────────────────────────────
	//
	// WHERE THIS NOTE IS UP TO, on the bar, and one click to change it.
	//
	// A flag set on the board is invisible while a writer is in the note it
	// describes — which is where they are when they decide a chapter has
	// stopped being a draft. This is the same three states and the same
	// store; the board is for reading the whole manuscript, and this is for
	// the one chapter in front of you.
	//
	// Absent rather than empty on an unflagged note: a bar token that says
	// "\u2014" on every note in the vault is a token earning nothing. It appears
	// when there is something to say, and the command sets the first one.
	// THE FLAG COLOUR OF THE NOTE IN HAND, as a paintable value.
	//
	// Read off the document rather than kept in a table here: the three
	// variables are what the board, the file explorer and the token all use,
	// and a scheme moves them. A fourth copy in JavaScript would be the one
	// that fell behind.
	//
	// Null on an unflagged note, deliberately. `:f` then leaves the segment
	// as it was, the same way `:bc` does for a caret with no colour of its
	// own — a bar that paints "no flag" is louder about nothing than the
	// flags are about something.
	flagColor(this: WordSmith) {
		const file = this.activeNoteFile();
		const id = file && ((this.settings.fileStatus || {})[file.path] || '');
		if (!id) return null;
		try {
			const v = getComputedStyle(document.body)
				.getPropertyValue('--ws-flag-' + id).trim();
			if (v) return v;
		} catch (_) { wsCatch('flagColor: const v = getComputedStyle(document.body)', _); }
		return { draft: '#6f95c9', revise: '#cf5b52', done: '#5aa96c' }[id] || null;
	},

	// ONE TOKEN, and a setting decides its shape.
	//
	buildFlagIndicator(this: WordSmith) {
		const file = this.activeNoteFile();
		const path = file && file.path;
		const now  = path ? (this.settings.fileStatus || {})[path] || '' : '';
		const shape = this.settings.flagTokenFormat || 'icon';
		const wantIcon = shape !== 'name';
		const wantWord = shape !== 'icon';
		return this.buildBarButton('ws-barbtn-flag',
			(node: { textContent: string; appendChild: (arg0: HTMLSpanElement) => void; classList: { toggle: (arg0: string,arg1: boolean) => void; }; }) => {
				node.textContent = '';
				// An unflagged note gets the word "flag" whatever the shape:
				// an icon-only token would otherwise be an empty space that
				// cannot be clicked, and the click is how a flag is set.
				if (!now) { node.textContent = wantWord ? 'flag' : '\u2691'; }
				else {
					if (wantIcon) {
						const wrap = createSpan();
						wrap.className = 'ws-barflag';
						wsSvgInto(wrap, wsFlagSvg(now, 11));
						node.appendChild(wrap);
					}
					if (wantWord) {
						const w = createSpan();
						// Capitalised, like everywhere else the word appears:
						// the board's chip says Done and the bar said done,
						// which reads as two different vocabularies for one
						// state.
						w.textContent = wsStatusLabel(now);
						node.appendChild(w);
					}
				}
				node.classList.toggle('is-set', !!now);
				node.classList.toggle('is-' + (now || 'unset'), true);
			},
			now ? 'This note is ' + wsStatusLabel(now).toLowerCase()
					+ ' \u2014 click for the next flag'
				: 'Flag where this note is up to \u2014 draft, revise, done',
			async () => {
				const f = this.activeNoteFile();
				if (!f) return;
				if (!this.settings.fileStatus) this.settings.fileStatus = {};
				const next = wsStatusNext((this.settings.fileStatus || {})[f.path] || '');
				if (next) this.settings.fileStatus[f.path] = next;
				else delete this.settings.fileStatus[f.path];
				// REDRAW FIRST, PERSIST AFTER — the rule every other button on
				// this row follows, and `saveSettings()` without the flag.
				// `saveSettings(true)` forces a full refresh: body classes,
				// the stylesheet, the workspace aesthetics, the lot. That is
				// right when a SETTING changes and absurd for a flag — it
				// rebuilt the plugin's whole surface to repaint eleven
				// pixels, and it made the token the most expensive control
				// on the bar.
				this.updateStatusBar();
				// …and the file explorer, which is drawing the same flag
				// beside the same note and would otherwise keep the old one
				// until something else happened to repaint the tree. ONE
				// ROW: the note being flagged is the only one whose flag can
				// have changed, and a full pass to redraw it is four hundred
				// reads for eleven pixels.
				this.repaintExplorerFlag(f.path);
				await this.saveSettings();
			});
	},

	// THE NOTE'S PROPERTIES, COUNTED, AND THE PANE THAT SHOWS THEM. The
	// count is the frontmatter's keys, as Obsidian's own status bar counts
	// them; the click runs the core Properties view's command, and failing
	// that opens the view in the right sidebar.
	propsCountOf(this: WordSmith, file: TFile | null) {
		try {
			const c = file && this.app.metadataCache.getFileCache(file);
			const fm = c && c.frontmatter;
			if (!fm) return 0;
			return Object.keys(fm).filter((k) => k !== 'position').length;
		} catch (_) { wsCatch('propsCountOf: this.app.metadataCache.getFileCache(file)', _); return 0; }
	},

	openPropertiesView(this: WordSmith) {
		try {
			const cmds = this.app.commands;
			if (cmds && typeof cmds.executeCommandById === 'function' && cmds.executeCommandById('file-properties:open')) return true;
		} catch (_) { wsCatch('openPropertiesView: executeCommandById(file-properties:open)', _); }
		try {
			const ws = this.app.workspace;
			let leaf: WorkspaceLeaf | null = (ws.getLeavesOfType ? ws.getLeavesOfType('file-properties') : [])[0] || null;
			if (!leaf && ws.getRightLeaf) leaf = ws.getRightLeaf(false);
			if (!leaf) return false;
			void Promise.resolve(leaf.setViewState({ type: 'file-properties', active: true })).then(() => { try { void ws.revealLeaf(leaf); } catch (_) { wsCatch('openPropertiesView: ws.revealLeaf(leaf)', _); } });
			return true;
		} catch (_) { wsCatch('openPropertiesView: ws.getRightLeaf(false)', _); return false; }
	},

	buildPropsIndicator(this: WordSmith) {
		const file = this.activeNoteFile();
		const n = this.propsCountOf(file);
		// THE NUMBER ALONE; the word is on the hover. AND THREE SHAPES: the
		// number first, then the Properties pane's icon (Icon, the default),
		// the word (Name), or both (Icon + Name).
		return this.buildBarButton('ws-barbtn-props',
			(node: HTMLElement) => this.barCountPaint(node, 'properties', n, n === 1 ? 'property' : 'properties'),
			n + (n === 1 ? ' property' : ' properties') + ' \u2014 click to open the Properties pane',
			() => this.openPropertiesView());
	},

	// A COUNT, THEN WHAT IT COUNTS: the number is the reading and comes
	// first; after it the pane's icon (Icon), the word (Name), or the icon
	// and the word (Icon + Name).
	barCountPaint(this: WordSmith, node: HTMLElement, id: string, n: number | string, word: string) {
		node.textContent = '';
		node.classList.remove('is-icon', 'is-both');
		const fmt = this.barTokenFormat(id);
		const num = createSpan();
		num.className = 'ws-bartok-n';
		num.textContent = String(n);
		node.appendChild(num);
		if (fmt !== 'word') {
			const ic = createSpan();
			ic.className = 'ws-bartok-ic';
			try { if (typeof setIcon === 'function') setIcon(ic, this.barTokenIconName(id)); } catch (_) { wsCatch('barCountPaint: setIcon(ic, …)', _); }
			if (ic.childElementCount > 0) { node.appendChild(ic); node.classList.add('is-icon'); }
		}
		if (fmt !== 'icon') {
			if (fmt === 'both') node.classList.add('is-both');
			const w = createSpan();
			w.className = 'ws-bartok-word';
			w.textContent = word;
			node.appendChild(w);
		}
	},

	// {backlinks} AS A BUTTON: drawn, not written, once it wears an icon —
	// the text path keeps the plain number and its pressable run.
	buildBacklinksIndicator(this: WordSmith) {
		const view = this.activeMarkdownView ? this.activeMarkdownView() : null;
		const text = this.getBacklinkCount(view);
		const n = text === '' ? '' : Number(text) || 0;
		return this.buildBarButton('ws-barbtn-backlinks',
			(node: HTMLElement) => { if (text === '') { node.textContent = ''; return; } this.barCountPaint(node, 'backlinks', n, n === 1 ? 'backlink' : 'backlinks'); },
			'Show the notes that link to this one',
			() => this.openSidebarPanel('backlink'));
	},

	buildReportIndicator(this: WordSmith) {
		return this.buildBarButton('ws-barbtn-report',
			(node: HTMLElement) => this.barTokenPaint(node, 'report', 'Report'),
			'Word counts and more \u2014 click for the full report',
			() => this.openReportModal());
	},

	// `onPick(path, kind)` is called with '' for the whole vault. `current`
	// is the path being looked at now; `foldersOnly` is for the pickers that
	// cannot mean a note (where an export lands, for one).
	// `onPick(path, kind)` is called with '' for the whole vault. `current`
	// is the path being looked at now; `foldersOnly` is for the pickers that
	// cannot mean a note (where an export lands, for one).
	barScope(this: WordSmith, into: HTMLDivElement, opts: { noSearch?: boolean; current?: string; placeholder?: string; foldersOnly?: boolean; onPick?: (path: string, kind: string) => void }) {
		const o = opts || {};
		const wrap = into.createDiv({ cls: 'ws-scopebar' });
		const crumbs = wrap.createDiv({ cls: 'ws-scopecrumbs' });
		// ── `noSearch`: THE PATH WITHOUT THE FINDER ─────────────────────────
		//
		// This control is a path that becomes a search box when you type in
		// it, which is right where a writer is CHOOSING what to look at — the
		// export window and the Outliner are both places you go to pick.
		//
		// The report is not. It answers for the note in hand, or for a folder
		// above it, or for whatever row was right-clicked — three ways in, all
		// of them from somewhere else. A search box in it was a fourth way to
		// arrive at a window you have already arrived at, and it sat at the
		// top of a page of figures inviting a question the page does not
		// answer. The crumbs stay: climbing from a scene to its chapter to the
		// book is the report's own gesture and the whole reason the path is
		// there.
		const quiet = !!o.noSearch;
		const input = quiet ? null
			: wrap.createEl('input', { cls: 'ws-export-text ws-scopeinput' });
		if (input) {
			input.type = 'text';
			input.placeholder = o.placeholder || 'Search for a folder or a note\u2026';
		}
		const hits = quiet ? null
			: wrap.createDiv({ cls: 'ws-export-hits ws-scopehits' });
		if (quiet) wrap.addClass('is-quiet');
		// '/' AND '' ARE THE SAME PLACE. The report says '/' for the vault
		// and the export window says '', and the path built one crumb per
		// segment from whichever it was handed — so the report drew "Vault \u203a
		// Vault", the root twice, which is what the first screenshot showed.
		const norm = (p2: string) => (!p2 || p2 === '/' ? '' : String(p2).replace(/^\/+|\/+$/g, ''));
		let at = norm(o.current || '');
		let searching = false;

		const take = (path: string, kind: string) => {
			at = norm(path);
			searching = false;
			if (input) input.value = '';
			if (hits) hits.textContent = '';
			paint();
			if (o.onPick) o.onPick(at, kind || 'folder');
		};

		const paintHits = () => {
			// Nothing to paint into and nothing to read from: the path-only
			// mode has no input and no results list. Returning here rather
			// than guarding each caller keeps the one check in the one place
			// that cannot work without them.
			if (!input || !hits) return;
			hits.textContent = '';
			const found = this.scopeFinderMatches(input.value, 10, o.foldersOnly);
			if (!found.length) {
				hits.createDiv({ cls: 'ws-export-nohit', text: 'Nothing by that name.' });
				return;
			}
			for (const h of found) {
				const r = hits.createDiv({ cls: 'ws-export-hit' });
				r.createSpan({ cls: 'ws-export-hitkind',
					text: h.vault ? 'vault' : (h.kind === 'folder' ? 'folder' : 'note') });
				r.createSpan({ cls: 'ws-export-hitpath',
					text: h.vault ? this.vaultWhole() : h.path });
				const n = this.scopeNoteCount(h.path, h.kind);
				if (h.kind === 'folder') {
					r.createSpan({ cls: 'ws-scopecount',
						text: n + (n === 1 ? ' note' : ' notes') });
				}
				r.addEventListener('mousedown', (ev: Event) => {
					ev.preventDefault();
					take(h.path, h.kind);
				});
			}
		};

		// The sideways move is the SEARCH, opened with the parent already
		// typed: hits are that folder's children, filtered as you type, with
		// their note counts beside them. Four siblings or four hundred, the
		// same control, and the same one a writer uses for everything else.
		const openSearch = (seed: string) => {
			searching = true;
			paint();
			if (!input) return;
			input.value = seed || '';
			input.focus();
			paintHits();
		};

		// A NAME and a SEARCH: the name says what is being described (a report
		// has no tree to say it for them), the search is how you go somewhere
		// else. Everything else was chrome.
		const paint = () => {
			wrap.toggleClass('is-searching', searching);
			crumbs.textContent = '';
			const label = crumbs.createSpan({ cls: 'ws-scopename' });
			// A NOTE'S NAME, THE WAY OBSIDIAN SPELLS IT — without the `.md`
			// the vault never shows anywhere else. Display only: `at` stays
			// the real path, because onPick and the finder round-trip it.
			label.setText(at ? at.replace(/\.md$/i, '') : this.vaultWhole());
			label.title = at || this.vaultWhole();
			// …AND NO MAGNIFIER WHERE THERE IS NOTHING TO OPEN. A button that
			// starts a search the control cannot perform is the emptiest kind
			// of dead control: it looks like the one everywhere else.
			if (quiet) return;
			const find = crumbs.createEl('button', { cls: 'ws-crumb ws-crumb-find' });
			find.title = 'Search for a folder or a note';
			try { if (setIcon) setIcon(find, 'search'); } catch { find.setText('\u2315'); }
			find.addEventListener('click', () => openSearch(''));
		};

		if (input) {
		input.addEventListener('input', paintHits);
		input.addEventListener('focus', () => { searching = true; wrap.addClass('is-searching'); paintHits(); });
		input.addEventListener('keydown', (ev: { key: string; }) => {
			if (ev.key === 'Escape') { searching = false; input.value = ''; if (hits) hits.textContent = ''; paint(); }
		});
		input.addEventListener('blur', () => {
			window.setTimeout(() => {
				if (hits) hits.textContent = '';
				if (!input.value.trim()) { searching = false; paint(); }
			}, 140);
		});
		}

		// The magnifier and the crumb you are standing on are the two ways into
		// the search, and both are visible (typing on the bar is not one: the bar
		// would need focus and would swallow a first letter).
		paint();
		return { el: wrap, set: (p2: string) => { at = norm(p2); paint(); }, at: () => at };
	},

	// The {theme} button: which scheme is on, and a click to change it.
	//
	// It names the scheme rather than showing a glyph, because a colour
	// scheme has no specimen the way a font has "Aa" — the workspace IS the
	// specimen, and a swatch beside it would be one of fifteen colours
	// chosen arbitrarily. The name is the half's name, so this button says
	// Vivendi by night and Operandi by day, matching the picker it opens.
	//
	// With themes switched off it reads "Theme" and dims, like every other
	// button whose subject is unset, and clicking it still opens the picker
	// — where choosing a scheme switches the system back on.
	buildThemeIndicator(this: WordSmith) {
		const on = this.settings.barThemeEnabled !== false;
		const id = this.settings.barTheme;
		const theme = (on && id && id !== 'custom') ? this.barThemeById(id) : null;
		const half = this.isDarkTheme() ? 'dark' : 'light';
		const name = theme
			? ((theme.names && theme.names[half]) || theme.name)
			: null;
		// THE BUTTON SAYS "Theme", always. It named the worn scheme for a
		// release, which made it the one button on the bar whose WIDTH
		// changed with its setting — "GitHub" and "Modus Vivendi
		// Deuteranopia" are not the same object — so choosing a scheme
		// could reflow the row and shed a reading at the far end. Every
		// other button on this bar names its subject, not its value; the
		// value belongs in the tooltip and in the popup, where a name has
		// room to be a name.
		const el = this.buildBarButton(
			'ws-barbtn-theme' + (theme ? '' : ' is-off'),
			(node: HTMLElement) => this.barTokenPaint(node, 'theme', 'Theme'),
			name ? 'Theme: ' + name + ' \u2014 click to change'
				: 'Theme \u2014 click to choose',
			(anchor2: HTMLElement) => this.openThemePicker(anchor2)
		);
		return el;
	},

	buildFontIndicator(this: WordSmith) {
		const current = String(this.opt('editorFont') || '');
		const el = this.buildBarButton(
			'ws-barbtn-font' + (current ? '' : ' is-off'),
			(node: HTMLElement) => {
				// The button renders in the chosen face, so it SHOWS the font instead
				// of naming it; `glyph` is the menu's font icon, and a writer can ask
				// for the word instead (Token formats). The chosen face is applied
				// either way.
				this.barTokenPaint(node, 'font', 'Fonts');
				if (current && !node.classList.contains('is-icon')) node.style.fontFamily = current;
			},
			current ? 'Font: ' + current + ' \u2014 click to change' : 'Font \u2014 click to choose',
			(anchor: HTMLElement) => this.openFontPicker(anchor)
		);
		return el;
	},

	fontPickerItems(this: WordSmith) {
		const fonts   = this.getConfiguredFonts();
		const current = () => this.opt('editorFont') || '';
		const items: WsMenuPickItem[] = [{
			label: 'Theme default',
			on: () => !current(),
			onClick: async () => {
				this.settings.editorFont = '';
				await this.saveSettings(true);
				this.applyEditorFont();
			}
		}];
		for (const name of fonts) {
			items.push({
				label: name,
				font: name,
				on: () => current() === name,
				onClick: async () => {
					this.settings.editorFont = name;
					await this.saveSettings(true);
					this.applyEditorFont();
				}
			});
		}
		if (fonts.length === 0) {
			items.push({
				label: 'No fonts added yet',
				on: () => false,
				onClick: async () => {}
			});
		}
		return items;
	},

	openFontPicker(this: WordSmith, anchor: HTMLElement) {
		this.openPickerLive(anchor, this.fontPickerItems(), 'choose');
	},

	// The same list the menu row and the settings cards read, so the bar
	// button cannot offer a different shelf from the other two surfaces.
	openThemePicker(this: WordSmith, anchor: HTMLElement) {
		this.openPickerLive(anchor, this.themesPickerItems(), 'choose');
	},

	// The five syntax-highlight classes, in the order they appear everywhere
	// else. The settings keys keep their pos* names: renaming them would force
	// a migration on every existing vault, and nobody reads data.json.
	getSyntaxCategories(this: WordSmith): { key: WsBoolKey; color: WsStringKey; label: string }[] {
		return [
			{ key: 'posNoun',        color: 'posNounColor',        label: 'Nouns'        },
			{ key: 'posVerb',        color: 'posVerbColor',        label: 'Verbs'        },
			{ key: 'posAdverb',      color: 'posAdverbColor',      label: 'Adverbs'      },
			{ key: 'posAdjective',   color: 'posAdjectiveColor',   label: 'Adjectives'   },
			{ key: 'posConjunction', color: 'posConjunctionColor', label: 'Conjunctions' }
		];
	},

	// Reads "Syntax" in the bar; the colours live in the picker, where each
	// class sits beside its own swatch and fades when it is off.
	buildSyntaxIndicator(this: WordSmith) {
		const s = this.settings;
		const active = s.posEnabled ? this.getSyntaxCategories().filter((c) => s[c.key]) : [];
		const title = active.length
			? 'Syntax highlight: ' + active.map((c) => c.label.toLowerCase()).join(', ')
			: 'Syntax highlight is off';
		const el = this.buildBarButton(
			'ws-barbtn-syntax' + (active.length ? '' : ' is-off'),
			(node: HTMLElement) => this.barTokenPaint(node, 'syntax', 'Syntax'),
			title,
			(anchor: HTMLElement) => this.openSyntaxPicker(anchor)
		);
		return el;
	},

	syntaxPickerItems(this: WordSmith) {
		const s = this.settings;
		const items = this.getSyntaxCategories().map((c) => ({
			label: c.label,
			color: s[c.color],
			on: () => !!(s.posEnabled && s[c.key]),
			onClick: async () => {
				s[c.key] = !s[c.key];
				// Ticking a class from the bar plainly means "show me this",
				// so it switches the feature on rather than changing a setting
				// with no visible effect.
				if (s[c.key]) s.posEnabled = true;
				// Turning the last one off turns the feature off with it,
				// rather than leaving it running over nothing.
				else if (!this.getSyntaxCategories().some((x) => s[x.key])) s.posEnabled = false;
				await this.saveSettings(true);
			}
		}));
		// NO MASTER ROW. It used to sit at the end of this list, and it was
		// a second way of saying what the rows above already say: every
		// class here switches the feature on when it is ticked and off
		// when the last one is unticked, so the master could only ever
		// agree with them or contradict them. Contradicting is what it
		// actually did — turning it off left five classes looking ticked
		// while nothing was highlighted, and turning it on silently ticked
		// a class the writer had not asked for. The list is the switch:
		// tick what you want to see, untick everything to see none of it.
		// The setting itself stays, and the Syntax tab still has its own
		// master; this is about what belongs in a picker.
		return items;
	},

	openSyntaxPicker(this: WordSmith, anchor: HTMLElement) {
		this.openPickerLive(anchor, this.syntaxPickerItems(), 'toggle');
	},

	// Both lock indicators are the key legend on two lines, unboxed. The
	// drawn key caps read as buttons you could press, which they are not —
	// plain stacked text says "this is on" without implying an action.
	buildKeyGlyph(this: WordSmith, top: string, bottom: string, title: string) {
		const wrap = createSpan();
		wrap.className = 'ws-keycap';
		wrap.title = title;
		for (const text of [top, bottom]) {
			const row = createSpan();
			row.className = 'ws-keycap-row';
			row.textContent = text;
			wrap.appendChild(row);
		}
		return wrap;
	},

	buildCapsIndicator(this: WordSmith) {
		return this.buildKeyGlyph('Caps', 'Lock', 'Caps Lock is on');
	},

	buildNumIndicator(this: WordSmith) {
		return this.buildKeyGlyph('Num', 'Lock', 'Num Lock is on');
	},

	// The writing checks get their own token, so the syntax picker can stay
	// one line about them rather than seven.
	getWriteChecks(this: WordSmith): { key: WsBoolKey; color: WsStringKey; label: string; swatch?: string }[] {
		// Order here drives the picker, the bar tooltip and the settings
		// tab, so there is one sequence to remember rather than three.
		// The master switch stays at the foot of the picker; everything
		// above is in reading order.
		return [
			{ key: 'checkFiller',     color: 'checkFillerColor',     label: 'Filler words'      },
			{ key: 'checkPassive',    color: 'checkPassiveColor',    label: 'Passive voice'     },
			{ key: 'checkPronoun',    color: 'checkPronounColor',    label: 'Loose pronouns'    },
			{ key: 'checkRepetition', color: 'checkRepetitionColor', label: 'Repetition radar'  },
			{ key: 'checkMisused',    color: 'checkMisusedColor',    label: 'Commonly misused'  },
			{ key: 'checkIllusion',   color: 'checkIllusionColor',   label: 'Lexical illusions' },
			// Above Sentence rhythm, as in the settings tab: this list
			// drives the picker, the bar tooltip AND that tab, so one
			// sequence is the whole ordering and the three cannot
			// disagree about it.
			{ key: 'checkDialogue',   color: 'checkDialogueColor',   label: 'Dialogue Focus'    },
			// No colour of its own in the picker. Sentence rhythm paints in
			// TWO (hard and very hard, and it is a background tint rather
			// than a mark), so a single swatch picked one of them and told
			// the writer something untrue about the other. `swatch: 'text'`
			// keeps the ball — the rows still line up — and takes the row's
			// own colour, so it reads as the toggle it is.
			{ key: 'checkRhythm',     color: 'checkRhythmHardColor', label: 'Sentence rhythm',
			  swatch: 'text' }
		];
	},

	buildWriteChecksIndicator(this: WordSmith) {
		const s = this.settings;
		const active = s.checksEnabled ? this.getWriteChecks().filter((c) => s[c.key]) : [];
		return this.buildBarButton(
			'ws-barbtn-writechecks' + (active.length ? '' : ' is-off'),
			(node: HTMLElement) => this.barTokenPaint(node, 'prose', 'Prose'),
			active.length ? 'Prose checks: ' + active.map(c => c.label.toLowerCase()).join(', ')
				: 'Prose checks are off',
			(anchor: HTMLElement) => this.openWriteChecksPicker(anchor)
		);
	},

	checksPickerItems(this: WordSmith) {
		const s = this.settings;
		const items = this.getWriteChecks().map((c) => ({
			label: c.label,
			// currentColor rather than a fixed value, so the ball fades with
			// the row when the check is off exactly as the label does.
			color: c.swatch === 'text' ? 'currentColor' : s[c.color],
			on:    () => !!(s.checksEnabled && s[c.key]),
			onClick: async () => {
				s[c.key] = !s[c.key];
				if (s[c.key]) s.checksEnabled = true;
				else if (!this.getWriteChecks().some((x) => s[x.key])) s.checksEnabled = false;
				await this.saveSettings(true);
			}
		}));
		// NO MASTER ROW — see the note in syntaxPickerItems. The checks
		// above already carry the feature: ticking one turns it on, and
		// unticking the last turns it off, so a row that could disagree
		// with them was only ever a way to make the list lie.
		return items;
	},

	openWriteChecksPicker(this: WordSmith, anchor: HTMLElement) {
		this.openPickerLive(anchor, this.checksPickerItems(), 'toggle');
	},

	// ¶ in the bar — or the word "Markers", per the Token formats setting;
	// the picker toggles which invisibles are drawn either way.
	buildMarkersIndicator(this: WordSmith) {
		const s = this.settings;
		const any = this.markerOpt('showHiddenMarkers', false) &&
			(s.markSpaces || s.markTabs || s.markParagraphs || s.markEndOfLines || s.markBlankLines);
		return this.buildBarButton(
			'ws-barbtn-markers' + (any ? '' : ' is-off'),
			// THE MENU'S PILCROW ICON, or the word.
			(node: HTMLElement) => this.barTokenPaint(node, 'markers', 'Markers'),
			any ? 'Hidden markers \u2014 click to change' : 'Hidden markers are off',
			(anchor: HTMLElement) => this.openMarkersPicker(anchor)
		);
	},

	markersPickerItems(this: WordSmith) {
		const s = this.settings;
		// Glyph first, then the word. With the symbol trailing, each row
		// began at a different place and ended at a different one, so the
		// list had no edge to read down — the marks are what the writer is
		// scanning for and they now line up in a column.
		const defs: { key: WsBoolKey; label: string }[] = [
			{ key: 'markTabs',       label: '\u2192 Tabs'          },
			{ key: 'markSpaces',     label: '\u00b7 Spaces'        },
			{ key: 'markEndOfLines', label: '\u21b5 Line ends'     },
			{ key: 'markParagraphs', label: '\u00b6 Paragraphs'    },
			{ key: 'markBlankLines', label: '~ End of buffer'  }
		];
		const items = defs.map(d => ({
			label: d.label,
			sub:   true,
			on: () => !!(this.markerOpt('showHiddenMarkers', false) && s[d.key]),
			onClick: async () => {
				s[d.key] = !s[d.key];
				if (s[d.key]) {
					s.showHiddenMarkers = true;
					// Turning a marker on from the bar has to turn the tab that
					// owns it on too, or the click sets a flag and nothing
					// appears. It is the MARKERS tab now, not Misc — the old
					// line switched on everything Text Options owns, including
					// the line-length cap, which is how clicking "Tabs" came to
					// narrow a writer's column irreversibly.
					s.markersEnabled = true;
				}
				else if (!defs.some(x => s[x.key])) s.showHiddenMarkers = false;
				await this.saveSettings(true);
			}
		}));
		return items;
	},

	openMarkersPicker(this: WordSmith, anchor: HTMLElement) {
		this.openPickerLive(anchor, this.markersPickerItems(), 'toggle');
	},

	// Small wrapper so pickers can pass live getters rather than a snapshot.
	openPickerLive(this: WordSmith, anchor: HTMLElement, items: WsMenuPickItem[], mode: string) {
		// Copy the whole item and overwrite only `on`, rather than listing the
		// fields by hand — the hand-written version silently dropped `font`
		// the moment a picker started using it.
		//
		// `on` may be a FUNCTION or a plain boolean, and this line assumed
		// the first: every picker that predates the theme shelf computes it
		// lazily, the theme items carry a value, and calling a boolean
		// threw before the popup could open — so the {theme} button did
		// nothing at all, silently, which is this project's oldest failure
		// mode wearing a new hat. openBarPicker below already reads both
		// shapes; so does the menu. This is the third surface, and now it
		// agrees with the other two.
		const snapshot = items.map((i): WsMenuPickItem => Object.assign({}, i,
			{ on: (typeof i.on === 'function' ? i.on() : !!i.on) }));
		this.openBarPicker(anchor, snapshot, mode);
		if (this._barPicker) this._barPicker._live = items;
	},

	// Drawn rather than set in type. Centring a capital with flexbox centres
	// its line box, not the letter: capitals sit on the baseline with
	// descender space beneath, so they read high, and the nudge that used to
	// correct it was a guess that also pushed the T off-centre between its
	// rules.
	//
	// One 24x24 viewBox for all three puts every letter at exactly (12,12)
	// and every shape on the same centre, so they cannot drift apart.
	// All bar iconography is drawn, not typeset: an SVG letter set in the
	// bar's font inherits that font's quirks, and a serif face made the H
	// look bent and the pilcrow lopsided. Strokes in a 24-unit box are the
	// same in every font, and take the bar's colour through currentColor.
	buildModeGlyph(this: WordSmith, kind: string) {
		const svg = createSvg('svg');
		svg.setAttribute('class', 'ws-mode-glyph is-' + kind);
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');

		const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | undefined>) => {
			const n = createSvg(tag);
			for (const k in attrs) n.setAttribute(k, String(attrs[k]));
			svg.appendChild(n);
			return n;
		};
		const stroke = (d: string) => el('path', { class: 'ws-mode-stroke', d });
		const fill   = (d: string) => el('path', { class: 'ws-mode-fill',   d });

		if (kind === 'zen') {
			// Circle with a drawn Z.
			el('circle', { class: 'ws-mode-shape', cx: 12, cy: 12, r: 10.4 });
			stroke('M8.6 8.2 H15.4 L8.6 15.8 H15.4');
		} else if (kind === 'hem') {
			// Rounded card with a sans-serif H.
			el('rect', { class: 'ws-mode-shape', x: 1.6, y: 1.6,
				width: 20.8, height: 20.8, rx: 3.4 });
			stroke('M8.4 7 V17 M15.6 7 V17 M8.4 12 H15.6');
		} else if (kind === 'lb') {
			// Letterbox: two close rules, arrows pressing in from above and
			// below — the masks, in miniature.
			stroke('M3.5 10 H20.5 M3.5 14 H20.5');
			fill('M12 2.6 L15 6.6 H9 Z');
			fill('M12 21.4 L9 17.4 H15 Z');
		} else {
			// Typewriter: rules above and below, a serifed T between them.
			el('line', { class: 'ws-mode-shape', x1: 1.2, y1: 2.6, x2: 22.8, y2: 2.6 });
			el('line', { class: 'ws-mode-shape', x1: 1.2, y1: 21.4, x2: 22.8, y2: 21.4 });
			stroke('M6.6 7.4 H17.4 M6.6 7.4 V9 M17.4 7.4 V9 M12 7.4 V16.6 M9.9 16.6 H14.1');
		}
		return svg;
	},

	buildModeIndicator(this: WordSmith) {
		const anyOn = this.getActiveModes().length > 0 || this.letterboxActive();
		return this.buildBarButton(
			'ws-barbtn-modes' + (anyOn ? '' : ' is-off'),
			(node: HTMLElement) => this.barTokenPaint(node, 'modes', 'Modes'),
			anyOn ? 'Writing modes \u2014 click to change' : 'Writing modes are off',
			(anchor: HTMLElement) => this.openModesPicker(anchor)
		);
	},

	modesPickerItems(this: WordSmith) {
		const defs = [
			{ key: 'lb',  label: 'Letter Box',
			  on: () => this.letterboxActive(),
			  onClick: async () => { await this.toggleSetting('enableLetterbox'); } },
			{ key: 'tw',  label: 'Typewriter',
			  on: () => !!this.opt('enableTypewriter') && this.isActiveFileInScope(),
			  onClick: async () => { await this.toggleSetting('enableTypewriter'); } },
			{ key: 'hem', label: 'Hemingway',
			  on: () => !!this.opt('hemingwayEnabled') && this.isActiveFileInScope(),
			  onClick: async () => { await this.toggleSetting('hemingwayEnabled'); } },
			{ key: 'zen', label: 'Zen',
			  on: () => this.zenActive(),
			  onClick: async () => { await this.toggleZenFromBar(); } }
		];
		const items = defs.map(d => ({
			label: d.label,
			icon:  () => this.buildModeGlyph(d.key),
			on:    d.on,
			onClick: d.onClick
		}));
		return items;
	},

	openModesPicker(this: WordSmith, anchor: HTMLElement) {
		this.openBarPicker(anchor, this.modesPickerItems(), 'toggle');
	},

	// ════════════════════════════════════════════════════════════════════════
	// BAR RENDERING: tokens to DOM
	// ════════════════════════════════════════════════════════════════════════

	// Caret position as line:column, both counted from 1 — what every other
	// editor's status line shows, and what a :N jump in vim expects. The
	// editor's own coordinates are 0-based on both axes.
	//
	// Column is counted in characters, not bytes and not display columns: a
	// tab reads as one column, which matches how the caret moves through it
	// with the arrow keys. Reading mode has no editor, so this is blank
	// there rather than stale or zero.
	getLineColumn(this: WordSmith, view: MarkdownView | null) {
		try {
			if (!view || !view.editor || !view.editor.getCursor) return '';
			const c = view.editor.getCursor();
			if (!c) return '';
			return (c.line + 1) + ':' + (c.ch + 1);
		} catch { return ''; }
	},

	// Where the caret is in the note's OUTLINE, one slot per heading level.
	//
	// Obsidian's metadata cache already holds every heading with its level and
	// line, so this costs a walk over a short array rather than a parse — and
	// it is the same list the outline pane draws, so the bar can never disagree
	// with it.
	//
	// The rule that makes it a trail rather than a list: a heading CLOSES every
	// level deeper than itself. Walking down the file, an H2 clears whatever H3
	// and H4 were set under the previous H2, so the six slots always describe
	// one path from the top of the document rather than the last heading seen
	// at each level anywhere in it.
	headingTrail(this: WordSmith, view: MarkdownView | null) {
		const out = ['', '', '', '', '', ''];
		try {
			if (!view || !view.file || !view.editor || !view.editor.getCursor) return out;
			const cache = this.app.metadataCache && this.app.metadataCache.getFileCache
				? this.app.metadataCache.getFileCache(view.file) : null;
			const heads = cache && cache.headings;
			if (!heads || !heads.length) return out;
			const line = view.editor.getCursor().line;
			for (const h of heads) {
				const at = h && h.position && h.position.start ? h.position.start.line : -1;
				if (at < 0) continue;
				// The cache is in document order, so the first heading past the
				// caret ends the walk.
				if (at > line) break;
				const lv = Math.max(1, Math.min(6, h.level || 1));
				out[lv - 1] = String(h.heading == null ? '' : h.heading);
				for (let d = lv; d < 6; d++) out[d] = '';
			}
		} catch { /* no cache yet for a note just created */ }
		return out;
	},

	// How many OTHER notes link here. Distinct notes, not link instances: a
	// note that mentions this one four times is one note that points at you,
	// which is what the backlinks pane counts and what the reading means.
	//
	// resolvedLinks is a map of the whole vault, so this is a walk over every
	// note — cheap enough once, ruinous at the bar's update rate. Cached
	// against the path and a generation the metadata cache bumps, so it is
	// recomputed when the links actually change and not on every keystroke.
	getBacklinkCount(this: WordSmith, view: MarkdownView | null) {
		try {
			// THE FILE, NOT THE VIEW — and this is the whole of the
			// "backlinks shows nothing" report.
			//
			// `updateRetroStatusBar` hands every token the active MARKDOWN
			// VIEW, and there is no such view the moment the writer clicks
			// into a sidebar, a canvas or the graph. Every other reading on
			// the row survives that: {file} says `no file`, {words} says a
			// figure, the clock ticks on. This one alone returned a blank
			// string, so the count DISAPPEARED — and it disappeared exactly
			// when the token is now most likely to be used, because clicking
			// it opens the backlinks pane and moves focus into it.
			//
			// `activeNoteFile()` is the plugin's own answer to "which note is
			// this panel about", fallback and all; it is what the report uses
			// for the same reason. Zero backlinks was always '0' and still is:
			// what was blank was zero NOTES to count, not zero links.
			let f = view && view.file ? view.file : null;
			if (!f) { try { f = this.activeNoteFile(); } catch { f = null; } }
			// No note open anywhere is still a blank, not a nought: '0' would
			// claim nothing links to a note that does not exist.
			if (!f || !f.path) return '';
			const gen = this._linkGen || 0;
			const hit = this._backlinkCache;
			if (hit && hit.path === f.path && hit.gen === gen) return hit.text;
			const resolved = (this.app.metadataCache && this.app.metadataCache.resolvedLinks) || {};
			let n = 0;
			for (const src of Object.keys(resolved)) {
				// A note linking to itself is not a backlink to itself.
				if (src === f.path) continue;
				const targets = resolved[src];
				if (targets && targets[f.path]) n++;
			}
			const text = String(n);
			this._backlinkCache = { path: f.path, gen, text };
			return text;
		} catch { return ''; }
	},

	// Integers shown to the reader get thousands separators. Centralised so
	// the bar, the sidebar counts and the report cannot drift apart on it,
	// and locale-driven rather than comma-hardcoded. Guarded: a NaN slipping
	// into the bar as "NaN" is worse than showing the raw number.
	formatCount(this: WordSmith, n: number) {
		const v = Number(n);
		if (!isFinite(v)) return String(n == null ? 0 : n);
		try { return v.toLocaleString(); } catch { return String(v); }
	},

	formatReadTime(this: WordSmith, words: number) {
		// READ_WPM, fixed. A number nobody has a calibrated opinion about is a
		// decision the writer should not have to make.
		const wpm = READ_WPM;
		if (!words) return '0 min';
		const mins = words / wpm;
		if (mins < 1) return '<1 min';
		const m = Math.round(mins);
		if (m < 60) return m + ' min';
		return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
	},

	// The vim mode as a stable key, independent of the label the writer chose
	// for it. Powerline colours the mode segment off this: matching on the
	// rendered label would break the moment someone shortens "-- INSERT --"
	// to "I", which is a normal thing to want and would silently fall back
	// to the normal-mode colour forever.
	//
	// Mirrors getVimModeLabel's precedence exactly, including command state
	// winning over insert.
	getVimModeKey(this: WordSmith) {
		try {
			const vault = this.app.vault;
			if (!vault.config || vault.config.vimMode !== true) return '';
			if (this._vimPanelOpen || !this.editorHasFocus()) return 'command';
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const cm6  = view && view.editor && view.editor.cm;
			const cm5  = cm6 && cm6.cm;
			const vim  = cm5 && cm5.state && cm5.state.vim;
			if (!vim) return '';
			if (vim.insertMode) return ((cm5.state && cm5.state.overwrite) || vim.replaceMode) ? 'replace' : 'insert';
			if (vim.replaceMode) return 'replace';
			if (vim.visualMode)  return 'visual';
			switch (vim.mode) {
				case 'insert':  return 'insert';
				case 'replace': return 'replace';
				case 'visual':  return 'visual';
			}
			if (document.querySelector('.cm-panels-bottom, .cm-vim-panel, .CodeMirror-dialog')) return 'command';
			return 'normal';
		} catch { return ''; }
	},

	getVimModeLabel(this: WordSmith) {
		// Each mode's text is the writer's to set (Settings \u2192 Vim).
		const L = (k: string, d: string) => {
			const v = wsBag(this.settings)['vimLabel' + k];
			return (typeof v === 'string' && v.trim() !== '') ? v : d;
		};
		try {
			const vault = this.app.vault;
			if (!vault.config || vault.config.vimMode !== true) return '';

			// Anywhere the next keystroke drives a command interface rather
			// than the text: vim's own ":" line, the command palette, search,
			// the quick switcher, a settings dialog. Vim's mode says nothing
			// about any of those — it still reads normal or insert — but from
			// the writer's side they are one state, and reporting the mode
			// you left behind is worse than naming the one you are in.
			//
			// Checked before the vim state, so it wins over insert: with the
			// palette open, typing does not insert anything.
			if (this._vimPanelOpen || !this.editorHasFocus()) return L('Command', '-- COMMAND --');

			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const cm6  = view && view.editor && view.editor.cm;
			const cm5  = cm6 && cm6.cm;
			const vim  = cm5 && cm5.state && cm5.state.vim;
			if (!vim) return '';

			// Replace mode (R) is represented as insert mode with the CM5
			// facade's overwrite flag set — vim.replaceMode alone is not
			// reliable across versions, which is why REPLACE never showed.
			//
			// Every branch goes through L(): these flag checks are the path
			// that actually fires at runtime (the vim.mode switch below is
			// a rarely-taken fallback), and hardcoded strings here were why
			// custom labels only ever showed for NORMAL and COMMAND.
			if (vim.insertMode) {
				return ((cm5.state && cm5.state.overwrite) || vim.replaceMode)
					? L('Replace', '-- REPLACE --') : L('Insert', '-- INSERT --');
			}
			if (vim.replaceMode) return L('Replace', '-- REPLACE --');
			if (vim.visualMode) {
				// The block/line variants have no label field of their own:
				// a custom Visual label covers all three, and only the
				// defaults distinguish the sub-modes.
				if (vim.visualBlock) return L('Visual', '-- VISUAL BLOCK --');
				if (vim.visualLine)  return L('Visual', '-- VISUAL LINE --');
				return L('Visual', '-- VISUAL --');
			}
			switch (vim.mode) {
				case 'insert':  return L('Insert',  '-- INSERT --');
				case 'replace': return L('Replace', '-- REPLACE --');
				case 'visual':  return L('Visual',  '-- VISUAL --');
			}
			// Fallback for the instant before the panel watcher has run.
			if (document.querySelector('.cm-panels-bottom, .cm-vim-panel, .CodeMirror-dialog')) {
				return L('Command', '-- COMMAND --');
			}
			return L('Normal', '-- NORMAL --');
		} catch {
			return '';
		}
	},

	updateRetroStatusBar(this: WordSmith) {
		if (!this.retroStatusBarEl) return;
		this._goalStates = [];
		// One repaint, one read of each theme surface. Dropped here rather
		// than invalidated on theme change: the bar repaints every second for
		// the clock anyway, so a per-pass cache is both cheaper and incapable
		// of going stale across a theme switch.
		this._themeSurfaceCache = null;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const now  = new Date();
		let stats = null, totalWC = 0, charCount = 0, displayWC = 0, displayCC = 0;

		if (view) {
			stats     = this.getDocStats(view);
			totalWC   = stats.totalWC;
			charCount = stats.charCount;
			const editor = view.editor;
			const sel = editor ? editor.getSelection() : '';
			if (sel && sel.trim().length > 0) {
				const selProse = this.countProse(sel);
				displayWC = selProse.words;
				// The same figure the whole-document path shows, or
				// selecting text would silently switch {chars} from the
				// with-spaces count to the visible-only one.
				displayCC = selProse.charsWithSpaces;
			} else {
				displayWC = totalWC;
				displayCC = charCount;
			}
		}

		const dp = this.dateParts(now);
		const hTrail = this.headingTrail(view);
		const subs: Record<string, string> = {
			'{file}':      this.getFilePath(view),
			// Grouped, so a five-figure manuscript reads as 12,480 rather
			// than as a serial number. toLocaleString picks the separator
			// the reader's own locale uses — a dot or a space in much of
			// Europe — instead of hard-coding a comma.
			'{words}':     this.formatCount(displayWC),
			'{chars}':     this.formatCount(displayCC),
			'{time}':      this.formatTime(now),
			// A DRAWN token, so it goes through the sentinel path like the
			// buttons rather than substituting to text.
			'{clock}':     '\x00CLOCK\x00',
			// Another drawn token: the app's own crystal, in whatever ink
			// the segment or bar is using.
			'{obsidian}':  '\x00OBSIDIAN\x00',
			'{dd}':        dp.dd,
			'{mm}':        dp.mm,
			'{yyyy}':      dp.yyyy,
			'{yy}':        dp.yy,
			'{battery}':   this.formatBattery(),
			'{paragraph}': this.getParagraphInfo(view, stats),
			// {s}, {ss}, {sss}… — a spacer as wide as the number of s's.
			// Built below rather than listed here, because the token's name
			// carries its own argument and there is no fixed set of them.
			'{ln:col}':    this.getLineColumn(view),
			// WRITTEN, OR DRAWN: the number in the text with its pressable run
			// while the shape is Name; a button with the pane's icon otherwise.
			'{backlinks}': this.barTokenFormat('backlinks') === 'word' ? this.getBacklinkCount(view) : '\x00BACKL\x00',
			// {#} through {######}: the heading the caret sits under at each
			// level, and {#>} for the whole trail. Listed rather than built,
			// because six is a fixed set — markdown has no seventh level.
			//
			// The six per-level tokens are OFF THE SURFACE — the token help, the
			// pickers and the README do not mention them — and still resolve
			// here, forever.
			// Deleting them would not make them vanish: an unmatched token
			// keeps its literal text (see the note at the substitution site),
			// so every format string, saved preset and posted share code
			// holding a {##} would start PRINTING "{##}" in the bar. Same
			// reasoning, same treatment, as {writechecks} below.
			//
			// Not migrated to {#>} either: that changes the meaning (one
			// level becomes the whole trail) and could never reach a code
			// already posted, so it would be lossy AND incomplete.
			'{#}':         hTrail[0],
			'{##}':        hTrail[1],
			'{###}':       hTrail[2],
			'{####}':      hTrail[3],
			'{#####}':     hTrail[4],
			'{######}':    hTrail[5],
			// The trail, LEADING CRUMBS FIRST TO GO when the row is tight.
			//
			// Same idea as {file} collapsing a path to the note's name, and
			// the same reasoning: the deepest heading is the one that says
			// where you are, and the chapter above it is context the note
			// itself already gives you. So `Chapter 3 > The Ferry > Beat 2`
			// becomes `The Ferry > Beat 2`, then `Beat 2` — never a
			// truncated `Chapter 3 > The Fer...`, which keeps the least
			// useful part and cuts the most.
			//
			// _fitShortenHead is set by the fit pass exactly as
			// _fitShortenFile is, and latched the same way against the width
			// that triggered it, so the row cannot oscillate between two
			// lengths once per frame.
			'{#>}':        this.headingTrailText(hTrail),
			'{caps}':      this._capsLockOn ? '\x00CAPS\x00' : '',
			'{num}':       this._numLockOn  ? '\x00NUM\x00'  : '',
			'{vim}':       this.getVimModeLabel(),
			'{mode}':      '\x00MODE\x00',
			'{syntax}':    '\x00SYNTAX\x00',
			'{markers}':   '\x00MARKERS\x00',
			'{prose}':     '\x00WRITECHECKS\x00',
			// Called {writechecks} until 1.10 and still accepted: a share
			// code or a preset written before the rename carries the old
			// spelling, and the migration below only reaches rows in THIS
			// vault. Both map to the same button.
			'{writechecks}': '\x00WRITECHECKS\x00',
			'{font}':      '\x00FONT\x00',
			'{theme}':     '\x00THEME\x00',
			'{report}':    '\x00REPORT\x00',
			'{history}':   '\x00HISTORY\x00',
			'{export}':    '\x00EXPORT\x00',
			// THE MENU ITSELF: the Powermenu, floating, from the bar.
			'{powermenu}': '\x00POWERMENU\x00',
			// THE WINDOW, FROM THE ROW A WRITER ALREADY WATCHES. The other
			// three tokens open one tab of it each; this one opens the tab the
			// window is FOR, which is the arranging.
			'{organizer}': '\x00OUTLINER\x00',
			// Called {outliner} until now, and still accepted — the same two halves
			// {writechecks} needed, and for the same reasons. This alias catches a
			// preset or a share code; the migration in loadSettings rewrites the
			// rows in THIS vault.
			'{outliner}':  '\x00OUTLINER\x00',
			'{flag}':      '\x00FLAG\x00',
			'{readtime}':  this.formatReadTime(totalWC),
			// {tasks}: the Organizer's own formatter, `wsTaskSay`, so `[3/7]` here
			// is `[3/7]` there — and a note with no tasks says nothing, as its cell
			// does.
			'{tasks}':     stats && stats.tasks ? wsTaskSay(stats.tasks.done, stats.tasks.all) : '',
			'{properties}': '\x00PROPS\x00'
		};

		const rows = this.getStatusRows();

		// A palette or :vim bar directive is restamped on EVERY repaint —
		// :vim follows the live mode, and the numeric slots follow a theme
		// flip that may land between applyCssVariables runs. It has to
		// happen before barColor is read back below, or the caps would
		// blend the separators into the colour of the previous mode.
		const dir0 = readBarDirective((rows[0] || {}).left);
		if (dir0.bgSlot != null || dir0.textSlot === 'vim' || dir0.textSlot === 'bc') {
			const r = this.resolveBarDirective(dir0);
			if (r.bg)   document.body.style.setProperty('--ws-bg',   r.bg);
			if (r.text) document.body.style.setProperty('--ws-text', r.text);
		}

		// Goal clicks live on the gauge elements themselves; the bar itself
		// stays inert so a stray click near the bottom edge does nothing.
		this.retroStatusBarEl.style.removeProperty('cursor');
		this.retroStatusBarEl.title        = '';

		this._wsLastTotalWordCount = totalWC;
		this.registerGoalStates();

		this.retroStatusBarEl.empty();
		this._statusRowEls = [];
		// Powerline segments own the whole bar box including its padding, so
		// a row is that much taller and the separators have to be drawn at
		// the same height — an SVG built for the unpadded row and stretched
		// by CSS comes out distorted.
		const pad  = this.barPadding();
		const rowH = this.snappedRowHeight() + pad.top + pad.bottom;
		// Unconditional now that powerline is the only way the bar draws.
		// Still a CLASS rather than nothing: the whole stylesheet hangs off
		// it — .ws-powerline::after is the bar's rules, and the segment
		// padding, inner layout and fade rules are all scoped to it. The
		// `:not(.ws-powerline)` counterparts were swept in 1.2.3; there are
		// none left, so this class is now a hook rather than a switch.
		this.retroStatusBarEl.classList.add('ws-powerline');
		// The colour a separator transitions OUT of at the end of a group is
		// the bar's own, read back rather than assumed: the bar may be on the
		// theme colours or on the retro custom pair, and a hardcoded guess
		// would leave a visible step at every cap.
		let barColor = 'transparent';
		try {
			const c = getComputedStyle(this.retroStatusBarEl).backgroundColor;
			if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') barColor = c;
		} catch (_) { wsCatch('updateRetroStatusBar: const c = getComputedStyle(this.retroStatusBarEl).backgroundColor;', _); }
		// Spacer tokens. Every distinct {s+} written anywhere in the bar gets
		// an entry, so the existing substitution machinery does the work and
		// they behave like any other token — including taking a :N colour,
		// which is the whole point: a coloured spacer is a design element.
		//
		// An ELEMENT with a CSS width, not a run of space characters. Figure
		// spaces (U+2007) were used first and were both too wide and not
		// actually fixed: a monospace or duospace face maps every space
		// codepoint to one full cell, so the "narrow" spaces are all the
		// same width as a digit and there is no way to ask for less. A span
		// sized in em is the same width in every font and scales with the
		// bar's font size.
		for (const row of rows) {
			for (const slot of ['left', 'center', 'right'] as const) {
				const fmt = row && row[slot];
				if (!fmt) continue;
				const found = String(fmt).match(/\{s+\}/gi);
				if (found) for (const tok of found) {
					if (subs[tok] != null) continue;
					subs[tok] = '\x00SP:' + Math.min(40, tok.length - 2) + '\x00';
				}
				// {g}, {gg}… — a gradient BAND, one unit of width per g,
				// exactly the spacer grammar. Its own token rather than a
				// mode of {s}: a spacer is empty space and a band is paint,
				// and one token meaning either depending on its neighbours
				// made every {s} a potential surprise.
				const grads = String(fmt).match(/\{g+\}/gi);
				if (grads) for (const tok of grads) {
					if (subs[tok] != null) continue;
					subs[tok] = '\x00GR:' + Math.min(40, tok.length - 2) + '\x00';
				}
			}
		}
		// renderStatusSection is not dead: renderPowerlineSection calls it for
		// the CONTENTS of each segment. It is no longer a top-level renderer,
		// which is the only thing that changed here.
		const section = (fmt: string, side: string) =>
			this.renderPowerlineSection(fmt, subs, side, rowH, barColor);
		for (let ri = 0; ri < rows.length; ri++) {
			const row = rows[ri];
			const rowEl = this.retroStatusBarEl.createDiv({ cls: 'ws-status-row' });
			// Row 1's left slot may open with a bar directive. It is stripped
			// here rather than in the section renderer so that exactly one
			// row can carry it: the bar has one background, and a second row
			// quietly setting a third colour would be a rule nobody could
			// see the effect of.
			const left = ri === 0 ? readBarDirective(row.left).rest : row.left;
			rowEl.createSpan({ cls: 'ws-status-section ws-status-left' })
				.appendChild(section(left, 'left'));
			rowEl.createSpan({ cls: 'ws-status-section ws-status-center' })
				.appendChild(section(row.center, 'center'));
			rowEl.createSpan({ cls: 'ws-status-section ws-status-right' })
				.appendChild(section(row.right, 'right'));
			this._statusRowEls.push(rowEl);
		}
		this.retroStatusBarEl.classList.toggle('ws-status-multirow', rows.length > 1);

		// Flash the bar when any registered goal is met (if enabled).
		const anyGoalMet = (this._goalStates || []).some((gl) => gl.met);
		this.retroStatusBarEl.classList.toggle('ws-goal-met', anyGoalMet);
		this._goalWasMet = anyGoalMet;


		// Shrink font size if the content overflows the bar's current width
		// (e.g. when a sidebar is open and the note pane narrows).
		// The mask pass is not the only trigger: it is gated on masks being
		// active, and the bar has to stay inside the panes regardless.
		this.stampBarBounds();
		this.scheduleFit();
	},

	powerlineColors(this: WordSmith) {
		const s = this.settings;
		const dark = this.isDarkSurface();
		const out = [];
		for (let n = 1; n <= PL_BG_COUNT; n++) {
			const c = wsBag(s)[dark ? 'powerlineColor' + n : 'powerlineColorLight' + n];
			// The fallback follows the theme too: a slate default on a pale
			// bar is the same mistake the light palette exists to avoid.
			out.push((typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c))
				? c : (dark ? '#3f4550' : '#d9dce1'));
		}
		return out;
	},

	// ;N — text in palette colour N. THE SAME palette :N reads.
	//
	// There used to be a second, separate set of four text swatches. It was
	// dropped: keeping two palettes in step, in two theme variants, is work
	// the writer does for no gain, and the question ;N actually answers is
	// "which of the colours already in this bar" — which wants the colours
	// already in the bar. It also means a swatch retinted in the palette
	// retints everywhere it is used at once, foreground and background.
	//
	// ":2;2" is now same-colour-on-itself, i.e. invisible text. That is a
	// legible thing to have written and to undo, unlike the old trap of two
	// palettes whose numbering did not line up. Out-of-range still wraps.
	powerlineTextColor(this: WordSmith, n1: number) {
		const list = this.powerlineColors();
		return list[(((n1 - 1) % list.length) + list.length) % list.length];
	},

	// Text colour for a segment, derived rather than picked.
	//
	// Six background pickers means twelve controls if the foreground is also
	// chosen, and eleven of those decisions are the same decision: is this
	// fill dark or light. Relative luminance answers it correctly for every
	// hue, including the ones where eyeballing it goes wrong — saturated
	// yellow and cyan look "dark" in a picker and need black text.
	powerlineInk(this: WordSmith, bg: string) {
		try {
			let h = String(bg).trim().replace('#', '');
			if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
			if (h.length < 6) return '#f5f5f5';
			const ch = [0, 2, 4].map(i => {
				const v = parseInt(h.slice(i, i + 2), 16) / 255;
				return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
			});
			const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
			// Contrast against near-black vs near-white, and take the winner.
			const dark = (L + 0.05) / 0.06, light = 1.05 / (L + 0.05);
			return dark >= light ? '#16181d' : '#f7f7f5';
		} catch { return '#f5f5f5'; }
	},

	// Split one row slot into segments and the shaped boundaries between them.
	//
	// Returns { segs: [{text, slot}], seps: [shape] } with seps[i] describing
	// the boundary between segs[i] and segs[i+1].
	//
	// Done by hand rather than with a split/regex because the escape and the
	// divider set overlap: a backslash is itself a divider (the \ angle cut),
	// so \| has to mean "literal pipe" while a lone \ still divides. The rule
	// is positional — a backslash directly before another divider escapes it —
	// and that is not expressible as a lookbehind.
	parsePowerlineSegments(this: WordSmith, formatStr: string) {
		// one segment of a powerline row: its text, the slot it is painted from, the ink it asked for
		type WsPlSeg = { text: string; slot: string | number | null; ink: string | number | null };
		const texts = [], seps = [], dirs = [];
		let buf = '';
		// A divider character INSIDE a token is part of that token's name,
		// not a boundary between segments. `{#>}` — the whole heading trail —
		// is the only shipped token that contains one, and it was being cut
		// in half at the `>`: the row got a segment ending `{#` , an arrow,
		// and a segment starting `}`, neither of which substitutes, so the
		// trail printed as literal braces and vanished the moment powerline
		// was switched on. It worked in a plain row because a plain row has
		// no dividers to be confused by.
		//
		// A brace run with no nested braces, so an unmatched `{` typed into a
		// row cannot swallow the rest of the dividers: it simply never opens
		// a span.
		const inTok = new Array(formatStr.length).fill(false);
		{
			const tokRe = /\{[^{}]*\}/g;
			let tm;
			while ((tm = tokRe.exec(formatStr))) {
				for (let k = tm.index; k < tm.index + tm[0].length; k++) inTok[k] = true;
			}
		}
		for (let i = 0; i < formatStr.length; i++) {
			const c = formatStr[i];
			if (inTok[i]) { buf += c; continue; }
			if (c === '\\' && i + 1 < formatStr.length && PL_DIVIDERS[formatStr[i + 1]]) {
				buf += formatStr[i + 1]; i++; continue;
			}
			// A doubled shape character is a SOFT mark, handled later inside
			// the segment. It has to survive tokenising as ordinary text:
			// this loop splits on single characters, so without the skip a
			// doubled one becomes two hard dividers with an empty segment
			// wedged between them. Backslash is not in the set — \\ already
			// means a literal backslash.
			if (formatStr[i + 1] === c && PL_SOFT[c + c]) {
				buf += c + c; i++; continue;
			}
			if (PL_DIVIDERS[c]) {
				texts.push(buf);
				seps.push(PL_DIVIDERS[c]);
				dirs.push(PL_DIR[c] || null);
				buf = '';
				continue;
			}
			buf += c;
		}
		texts.push(buf);

		// A divider written BEFORE the first segment or AFTER the last one has
		// no segment on one side, so it is not a join — it is the shape of
		// that end of the group. That is the only way to put a ) or a \ on
		// the first and last blocks, which otherwise always took the default.
		let lead = null, tail = null, leadDir = null, tailDir = null;
		const segs: WsPlSeg[] = [], keptSeps: string[] = [];
		for (let i = 0; i < texts.length; i++) {
			let slot: string | number | null = null;
			// {token}:N, or {token} :N — the space is allowed because it reads
			// better in a row and someone will type it either way.
			// {token}:2 picks background 2; {token}:2;3 also picks text
			// colour 3. {token}:vim follows the live vim mode instead of a
			// fixed background, and :vim;3 pins the text while the
			// background moves. {token}:b1 through :b4 take the theme's own
			// surfaces (PL_THEME_BGS), :bs its status-line surface, and
			// ;t1 through ;t3 its text colours. A token with NO colour at
			// all lies flush with the bar (powerlineSegColor) — writing
			// :bs explicitly says the same thing a bare token now says.
			// The space in {token} :2 is allowed because it reads better in a
			// row and someone will type it either way.
			//
			// The b and t classes are BOUNDED, not b<any>/t<any>. An
			// unrecognised one is left in the text where the writer can see
			// it, which is how they find out it is not a thing — silently
			// swallowing :b9 would make it look like a colour that happens to
			// render as the auto pick.
			let ink: string | number | null = null;
			// Both suffixes are OPTIONAL and independent now: {file};vim is
			// legal (the ink follows the live mode while the background
			// keeps its auto colour), and so is a bare ;N. A token with
			// neither matches with both groups empty and is put back
			// untouched, which is what makes the optionality safe.
			// `[^{}]+`, not `[a-z:]+`. The old class knew about letters and
			// the colon in `{ln:col}` and nothing else, so `{#}` and its five
			// deeper siblings — and `{#>}` — matched nothing, and their
			// suffix was left in the text: `{#}:b1` painted the heading in
			// the auto colour and then printed ":b1" beside it. `{file}:b1`
			// worked, which is what made it look like a colour bug rather
			// than a token-name bug.
			// `f` IS IN BOTH CLASSES. This grammar and the ROW directive's
			// are two different parsers — the row's learnt `:f` and this one
			// did not — so `:f {flag}` coloured the whole BAR (which in
			// powerline mode is the strip behind the segments, i.e. nothing
			// visible) and `{flag}:f` left ":f" printed beside the flag. Both
			// looked like the colour was broken; neither was about colour.
			// Any slot this parser does not know must be added HERE as well
			// as there, and to powerlineSegColor and powerlineSegInk below.
			const text = texts[i].replace(/(\{[^{}]+\})(?:\s*:(\d+|vim|b[1-4]|bs|bc|f))?(?:\s*;\s*(\d+|vim|bc|t[1-3]|f))?/gi, (m: string, tok: string, n: string, t: string) => {
				if (n != null && slot === null) {
					slot = /^(?:vim|bc|f)$/i.test(n) ? n.toLowerCase()
						: /^(?:b[1-4]|bs)$/i.test(n) ? n.toLowerCase()
						: parseInt(n, 10);
				}
				// The ink channel mirrors the background one, value for
				// value: ;vim follows the live mode as :vim does, and
				// ;t1/;t2 are the theme's normal and muted text as :b1/:b2
				// are its surfaces. Anything else (;t3, ;x) is LEFT VISIBLE,
				// the segment convention for a suffix that means nothing —
				// which is exactly how ;t1 was found missing here: it
				// worked as a bar directive and printed as a suffix.
				if (t != null && ink === null) {
					ink = /^(?:vim|bc|f)$/i.test(t) ? t.toLowerCase()
						: /^t[1-3]$/i.test(t) ? t.toLowerCase()
						: parseInt(t, 10);
				}
				return tok;
			}).trim();
			if (!text.length) {
				// Empty because it is the space before a leading divider or
				// after a trailing one: remember the shape, drop the segment.
				if (!segs.length && seps[i] && lead === null) {
					lead = seps[i]; leadDir = dirs[i];
				} else if (seps[i - 1] && segs.length) {
					tail = seps[i - 1]; tailDir = dirs[i - 1];
				}
				continue;
			}
			if (segs.length) keptSeps.push(seps[i - 1] || 'arrow');
			segs.push({ text, slot, ink });
		}
		return { segs, seps: keptSeps, lead, tail, leadDir, tailDir };
	},

	// Which colour a segment gets: an explicit :N wins, then the live vim
	// mode, then THE BAR'S OWN SURFACE. Numbering is 1-based because that
	// is how it is written in a row; out-of-range wraps rather than
	// failing.
	//
	powerlineSegColor(this: WordSmith, seg: { text: string; slot: string | number | null; ink?: string | number | null }, index: number, colors: string[], hasVim: boolean, barColor: string) {
		const pick = (n1: number) => colors[(((n1 - 1) % colors.length) + colors.length) % colors.length];
		// An uncoloured token lies FLUSH with the bar, the way an unhighlighted
		// region of a vim statusline sits on StatusLine's own background: colour
		// is something a row asks for, per segment, and silence means the strip.
		// An explicit :N picks from the palette with a 1-based wrap.
		if (seg.slot === 'vim') return this.vimModeColor();
		// :bc is the caret's live colour — Cursor-Smith's per-mode caret in
		// vim, its flat caret outside, the theme's own with neither — and a
		// null answer FALLS THROUGH to the flush ending below, exactly as
		// an unpaintable theme slot does. Checked here, not left to the
		// PL_THEME_BGS branch its name would also match: that branch knows
		// variables, and the caret's first owner is a plugin, not a
		// variable.
		if (seg.slot === 'bc') {
			const c = this.cursorColor();
			if (c) return c;
		}
		// The flag of the note in hand. Null on an unflagged note FALLS
		// THROUGH to the flush ending, exactly as an unpaintable theme slot
		// does — a segment that painted itself grey to mean "no flag" would
		// say nothing louder than a flag says something.
		if (seg.slot === 'f') {
			const c = this.flagColor();
			if (c) return c;
		}
		// Checked before the numeric branch: pick() does arithmetic, and 'b1'
		// through it is NaN, which is a segment painted nothing at all.
		if (typeof seg.slot === 'string' && seg.slot !== 'bc' && PL_THEME_BGS[seg.slot]) {
			// Each slot is a LIST of variable names, tried in order: b4 asks
			// for --background-tertiary, which core Obsidian does not define,
			// and falls back to --background-primary-alt on a theme without
			// it. An empty read means none of them resolved (or the style is
			// not available yet). Fall through to the FLUSH answer below
			// rather than returning '' — an empty fill paints black, which is
			// a worse answer than the bar's own colour the segment degrades
			// to, exactly as a segment that asked for nothing gets.
			for (const name of PL_THEME_BGS[seg.slot]) {
				const c = this.themeSurfaceColor(name);
				if (c) return c;
			}
		} else if (seg.slot != null && seg.slot !== 'bc') {
			return pick(Number(seg.slot));
		}
		// A segment holding {vim} follows the mode without being asked to:
		// that is what the block is for. Suffixing it :vim is the same
		// thing said explicitly, and :N still overrides both.
		if (hasVim && /\{vim\}/.test(seg.text) && this.settings.powerlineModeColors) {
			return this.vimModeColor();
		}
		// No colour asked for: the bar's own, read back off the element by
		// the caller. When that read failed — the bar itself computed to
		// transparent — the :bs chain is resolved directly, and a segment
		// that still cannot name a paint stays 'transparent', which on a
		// transparent bar is the same flush it would have been.
		if (barColor && barColor !== 'transparent') return barColor;
		for (const name of PL_THEME_BGS.bs) {
			const c = this.themeSurfaceColor(name);
			if (c) return c;
		}
		return 'transparent';
	},

	// The ink for a segment with no explicit ;N.
	//
	// On a theme surface the theme's own text colour is right by
	// construction, and deriving one from luminance would be second-guessing
	// the theme with a worse answer — `--text-normal` is what every other
	// piece of text on that background already uses. Everywhere else the
	// background is a colour the writer picked, and the readable foreground
	// is derived (see powerlineInk).
	//
	// This one CAN be a var(): it is set as the `color` property, not as an
	// SVG attribute.
	powerlineSegInk(this: WordSmith, seg: { text?: string; slot: string | number | null; ink?: string | number | null }, bg: string, barColor: string) {
		// :bs pairs with the strip's own measured ink — a worn scheme's
		// status surface can be saturated (PaperColor's teal) and carries
		// an ink the scheme measured for it; --text-normal is only right
		// on the surfaces body text actually sits on.
		if (seg.slot === 'bs') return 'var(--status-bar-text-color, var(--text-normal))';
		// :bc is a live colour — possibly a saturated caret — so its ink is
		// MEASURED like a palette pick's, never assumed like a surface's.
		if (seg.slot === 'bc') return this.powerlineInk(bg);
		// :f is a live colour too, and a saturated one — the ink is measured
		// against the flag that is actually up, never assumed.
		if (seg.slot === 'f') return this.powerlineInk(bg);
		if (typeof seg.slot === 'string' && PL_THEME_BGS[seg.slot]) return 'var(--text-normal)';
		// A FLUSH segment — no colour asked for, painted in the bar's own
		// read-back colour — takes the bar's own ink, by not setting one:
		// '' removes the inline colour and --ws-text inherits. Deriving
		// black-or-white here would out-shout the row it sits in.
		if (seg.slot == null && bg === barColor) return '';
		return this.powerlineInk(bg);
	},

	// The {#>} trail at its current shortening level.
	headingTrailText(this: WordSmith, hTrail: string[]) {
		const crumbs = hTrail.filter(Boolean);
		if (!crumbs.length) return '';
		const drop = Math.min(this._fitShortenHead || 0, crumbs.length - 1);
		return crumbs.slice(drop).join(' \u203a ');
	},

	// The key holding a colour for the current theme. The DARK key is the
	// original name and the light one is that name with a suffix — a rename
	// to a matched pair would have been tidier and would have reinterpreted
	// every share code ever posted, since BAR_KEYS stores fields by index.
	themedKey<T>(this: WordSmith, darkKey: T, lightKey: T) {
		return this.isDarkSurface() ? darkKey : lightKey;
	},

	// A soft chevron, sized and weighted to sit beside the hairline.
	//
	// It used to run the segment's FULL height at a 1.5px stroke, which made
	// it the loudest thing in a row that was not a colour — taller than the
	// text it divided and heavier than the :: it is meant to be a variant
	// of. The three marks are one family: a short faint line, and the same
	// line bent to point somewhere. So the chevron now takes the hairline's
	// height (55% of the row, via the stylesheet) and a 1px stroke, which is
	// the hairline's own width exactly.
	//
	// An SVG stroke rather than a border triangle: borders can only make a
	// filled wedge, and a wedge of any size is a hard separator in the wrong
	// colour. Stretched by preserveAspectRatio="none" like the hard shapes,
	// with vector-effect="non-scaling-stroke" so the line stays 1px however
	// tall the row paints — a scaled stroke fattens with the bar and reads
	// as a smear at large row heights. That is what keeps "thin" true at
	// every row height rather than only at the default one.
	//
	// Same aspect as the hard arrows (--ws-pl-sep-aspect, via the
	// stylesheet), so a soft chevron and a hard arrow in one row carry the
	// same angle and read as two weights of one mark, not two marks. Shrinking
	// the mark does not touch the angle: the aspect is a ratio.
	buildSoftChevron(this: WordSmith, dir: string) {
		const svg = createSvg('svg');
		svg.setAttribute('class', 'ws-pl-soft '
			+ (dir === 'right' ? 'ws-pl-chev-r' : 'ws-pl-chev-l'));
		// Nominal only — the stylesheet stretches it. Kept as the fallback
		// geometry for a stale stylesheet, exactly like the hard shapes, and
		// sized small for the same reason the CSS is: if it is ever the
		// geometry anyone sees, a small mark is the right guess.
		const w = 8, h = 16;
		svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
		svg.setAttribute('width', String(w));
		svg.setAttribute('height', String(h));
		svg.setAttribute('preserveAspectRatio', 'none');
		const path = createSvg('path');
		// Inset a unit from the vertical edges so the stroke's own width is
		// not halved by the viewport clip at the point.
		path.setAttribute('d', dir === 'right'
			? 'M1,0 L' + (w - 1) + ',' + (h / 2) + ' L1,' + h
			: 'M' + (w - 1) + ',0 L1,' + (h / 2) + ' L' + (w - 1) + ',' + h);
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', 'currentColor');
		// 1, not 1.5: the hairline is 1px, and two marks in one family
		// cannot be drawn at two weights.
		path.setAttribute('stroke-width', '1');
		path.setAttribute('vector-effect', 'non-scaling-stroke');
		path.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(path);
		return svg;
	},

	// One soft mark, from the characters that were typed. Both renderers go
	// through here rather than each carrying its own if-chain: the powerline
	// one and the plain one have to agree about what `::` IS, and they only
	// stayed in step while there were two marks and one renderer that knew
	// about them. Returns null for anything not in the table, so a caller can
	// treat "is this a mark" and "build it" as one question.
	buildSoftMark(this: WordSmith, mark: string) {
		const cls = PL_SOFT[mark];
		if (!cls) return null;
		// The chevrons are drawn geometry; the hairline is a 1px element the
		// stylesheet does everything to, so it needs no builder.
		if (mark === '>>' || mark === '<<') {
			return this.buildSoftChevron(mark === '>>' ? 'right' : 'left');
		}
		const i = createEl('i');
		i.className = cls;
		return i;
	},

	// One separator, drawn as SVG rather than set as a Nerd Font glyph.
	//
	// Drawn, because the shapes have to meet the segments they sit between
	// exactly: a font glyph is sized by its own metrics and leaves a sliver
	// of bar showing at some font sizes, which is the same class of hairline
	// the letterbox mask cost three rounds. It also means the bar does not
	// require a patched font to look right.
	//
	// `dir` is which way an arrow or curve points; the two angle cuts carry
	// their own direction because the writer picked / or \ to say so.
	buildPowerlineSep(this: WordSmith, fromColor: string, toColor: string, dir: string, h: number, shape: string) {
		const style = shape || 'arrow';
		// An SVG fill attribute that is empty, undefined or unparseable does
		// not paint nothing — it paints BLACK, the SVG default. Every colour
		// reaching this method has been through a theme lookup or a fade mix,
		// both of which have an honest '' for "could not work it out", so the
		// last step before it becomes an attribute is where that has to be
		// caught. transparent is the right answer: it shows the bar, which is
		// what a shape with no colour to be was always trying to say.
		const paint = (c: string) => (typeof c === 'string' && c.trim()) ? c.trim() : 'transparent';
		fromColor = paint(fromColor);
		toColor   = paint(toColor);
		// The width IS the apex angle: 2·atan(0.5/aspect), so a WIDE
		// separator is a POINTY one. See PL_SEP_ASPECT for the session
		// that got this backwards twice.
		// EACH SHAPE ITS OWN WIDTH. One constant used to size all of them,
		// and it was tuned for the arrow — where wide means POINTY, because
		// the nose is 2·atan(0.5/aspect). The other two want the opposite:
		//
		//   \ and /  A diagonal's width IS its slope. At the arrow's 1.05
		//            the cut runs at about 44 degrees across a box wider
		//            than the row is tall, so the segment before it tapers
		//            away over 23px and ends in a long thin point — which
		//            is what a spacer with `\` on one side looked like. A
		//            slant wants to be STEEP: 0.42 puts it near 67 degrees,
		//            a clean bevelled end rather than a ramp.
		//   ~        A wave's width is the reach of its bows. At 1.05 they
		//            swing a full row-height either way and the boundary
		//            reads as a hook. 0.62 keeps a ripple that still has
		//            room for the amplitude floor below it.
		//
		// The arrow keeps the constant, because the constant is the arrow's.
		const pct = style === 'angleF' || style === 'angleB' ? 0.42
			: style === 'wave' ? 0.62
			: PL_SEP_ASPECT;
		const w = style === 'straight' ? 2
			// Amplitude is w/2 to each side of the centre line, so a wave
			// needs more width than a shape that only reaches one way.
			: style === 'wave' ? Math.max(10, Math.round(h * Math.max(pct, 0.6)))
			: Math.max(6, Math.round(h * pct));
		const svg = createSvg('svg');
		svg.setAttribute('class', 'ws-pl-sep');
		// The rendered aspect, not the viewBox's, is what sets the apex
		// angle: the element is height:100% with preserveAspectRatio="none",
		// so the shape is stretched to whatever the row actually paints at
		// and `h` here is only a guess at that. The stylesheet gives shaped
		// separators `width: auto; aspect-ratio`, which pins the angle to the
		// painted height directly and makes the guess irrelevant. The width
		// attribute stays as the fallback for that rule not applying.
		svg.setAttribute('data-shape', style);
		svg.setAttribute('width', String(w));
		svg.setAttribute('height', String(h));
		svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
		svg.setAttribute('preserveAspectRatio', 'none');
		// The viewBox is the clip: without this the overdrawn rect below
		// would paint outside the element and cover its neighbours.
		svg.setAttribute('overflow', 'hidden');
		// A straight divider PAINTS NOTHING, and that is the fix rather than
		// a shortcut.
		//
		// It drew a 2px rect and sat on top of two segments that already
		// overlap each other by a pixel on each side. Whatever it painted
		// had to line up with a boundary underneath that it does not control
		// and cannot see — so any disagreement showed as a 1px stripe of the
		// wrong colour just inside the join. One colour across the whole 2px
		// put the stripe on one side; splitting it in half moved the stripe
		// rather than removing it, because the split is at the ELEMENT's
		// midpoint and the segments meet wherever the flex layout put them.
		//
		// The seam it was meant to close is already closed without it: the
		// two segments overlap, and the later one paints over the earlier,
		// which is a boundary with no third party to misalign. Zero width
		// and zero margin, so it takes no space and pulls nothing together —
		// `|` means "these two blocks touch", and touching is the absence of
		// a shape, not a 2px drawing of one.
		if (style === 'straight') {
			svg.setAttribute('width', '0');
			svg.setAttribute('viewBox', '0 0 0 ' + h);
			return svg;
		}

		const rect = createSvg('rect');
		// Overdrawn by a pixel on every side. The rect is the separator's
		// backing colour, and drawn exactly to the viewBox its edges land on
		// the box boundary — where the browser antialiases against whatever
		// is behind, which is the bar. At fractional device pixels (any
		// zoom, any HiDPI scale) that shows as a pale hairline down the edge
		// of a segment. The SVG clips to its viewport, so bleeding past it
		// costs nothing and leaves no edge to soften.
		rect.setAttribute('x', '-1');
		rect.setAttribute('y', '-1');
		rect.setAttribute('width', String(w + 2));
		rect.setAttribute('height', String(h + 2));
		rect.setAttribute('fill', dir === 'right' ? toColor : fromColor);
		svg.appendChild(rect);

		// The shape's FLAT side must start outside the viewBox.
		//
		// The rect behind the path is the other segment's colour — for a cap
		// it is the bar itself, white in a light theme. Drawing the path's
		// flat edge exactly on the boundary means the browser antialiases it
		// against that rect INSIDE this raster, so the outermost column is a
		// blend and reads as a pale hairline against the segment it meets.
		// Nothing outside the SVG can cover that: it is not a gap between
		// elements, it is a soft edge within one image. Pushing the flat
		// side a unit past the edge moves the blend off-canvas, where the
		// viewport clip discards it and the boundary column is solid.
		//
		// Only the FLAT side moves. The point, apex or arc is the shape and
		// must stay exactly where it was.
		const L = -1;        // just outside the left edge
		const R = w + 1;     // just outside the right edge
		const mid = h / 2;
		// …and the POINT sits just inside it.
		//
		// The apex used to be exactly on the boundary, where the SVG's own
		// viewport clip cuts it: the last fraction of the tip is lost and
		// what remains is a short vertical edge. On a cap the same thing
		// happens a second time and much more visibly, because
		// `margin-inline: -1px` pulls that edge outside `.ws-status-section`,
		// which is `overflow: hidden` — the first arrow of a left group lost
		// a clear 1px of its nose and read as chopped off.
		//
		// Pulling the apex in by a third of a unit keeps the whole point
		// inside the raster. Nothing is lost visually: the sliver beyond it
		// is the rect, and the rect is by definition the colour of the
		// segment the point is reaching into.
		const TIP = 0.34;
		const tipR = w - TIP;   // a right-facing point
		const tipL = TIP;       // a left-facing one
		let d = '', fill = dir === 'right' ? fromColor : toColor;
		// The HORIZONTAL flat edges move off-canvas too — to y = -1 and
		// y = h+1 — for exactly the reason the vertical ones did. The angle
		// cuts and the wave are the only shapes with flat runs along the
		// top or bottom boundary (an arrow's extremes are vertices), and a
		// run sitting exactly on y=0 or y=h antialiases against the rect
		// inside the raster once the element is stretched to a fractional
		// painted height — which it always is, because height:100% follows
		// the row. Measured in the field as a segment-coloured hairline
		// along the bottom of every \ cut. Only the flats move: the
		// hypotenuse and the wave's cubics stay exactly where they were.
		const T = -1, B = h + 1;
		if (style === 'angleF') {
			// "/" — the cut runs bottom-left to top-right, whichever side it
			// sits on, because the writer chose the character for its shape.
			d = 'M' + w + ',0 L' + L + ',' + h + ' L' + L + ',' + T + ' L' + w + ',' + T + ' Z';
			fill = fromColor; rect.setAttribute('fill', toColor);
		} else if (style === 'angleB') {
			d = 'M' + L + ',0 L' + w + ',' + h + ' L' + w + ',' + B + ' L' + L + ',' + B + ' Z';
			fill = fromColor; rect.setAttribute('fill', toColor);
		} else if (style === 'wave') {
			// A full sine period: the boundary leaves the top edge at the
			// halfway line, bulges out to one side, crosses BACK through
			// that same halfway line at the vertical midpoint, bulges the
			// other way, and returns to it at the bottom. The crossing is
			// the inflection, and putting it exactly at (w/2, h/2) is what
			// makes the shape read as a wave rather than as a bulge with a
			// dent in it.
			//
			// Two cubics rather than the previous quadratics: a quadratic
			// has one control point and cannot hold its tangent vertical on
			// both sides of the crossing, so the halves met at an angle and
			// the join showed as a kink. Cubic control points at 0.12h and
			// 0.38h either side keep the tangent vertical THROUGH the
			// midpoint, so the two bows flow into one another.
			const c = w / 2;
			// THE BOWS STOP SHORT OF THE EDGES, and this is the fix for a
			// wave that read as a hook with a point on it.
			//
			// The control points used to sit at x = 0 and x = w. A cubic
			// reaches about three quarters of the way to its controls, so
			// each bow came within a couple of pixels of the far edge —
			// which means the fill on THAT side pinched to a couple of
			// pixels too. A shape that narrows to almost nothing and then
			// opens out again does not read as a wave; it reads as a lobe
			// with a spike hanging off it, and at a cap, where the other
			// side is the bar rather than a segment, that spike is the
			// only thing you see.
			//
			// Held to 82% of the half-width, both bows keep roughly a
			// fifth of the width on their far side, so neither side of the
			// boundary ever closes and the wave stays a wave from either
			// colour's point of view.
			const bow = w * 0.82, bowL = w * 0.18;
			// Rounded: h * 0.12 lands on values like 3.5999999999999996,
			// and a path attribute full of float noise is unreadable in
			// devtools for no benefit at these sizes.
			const y = (f: number) => Math.round(h * f * 100) / 100;
			// The flat runs between the edge and the curve's endpoints ride
			// at y = -1 and y = h+1; the short verticals at x = c that
			// connect them to the cubics are off-canvas except for their
			// endpoint, which IS the curve's own start.
			const bx = (v: number) => Math.round(v * 100) / 100;
			d = dir === 'right'
				? 'M' + L + ',' + T + ' L' + c + ',' + T + ' L' + c + ',0'
					+ ' C' + bx(bow) + ',' + y(0.12) + ' ' + bx(bow) + ',' + y(0.38) + ' ' + c + ',' + mid
					+ ' C' + bx(bowL) + ',' + y(0.62) + ' ' + bx(bowL) + ',' + y(0.88) + ' ' + c + ',' + h
					+ ' L' + c + ',' + B + ' L' + L + ',' + B + ' Z'
				: 'M' + R + ',' + T + ' L' + c + ',' + T + ' L' + c + ',0'
					+ ' C' + bx(bowL) + ',' + y(0.12) + ' ' + bx(bowL) + ',' + y(0.38) + ' ' + c + ',' + mid
					+ ' C' + bx(bow) + ',' + y(0.62) + ' ' + bx(bow) + ',' + y(0.88) + ' ' + c + ',' + h
					+ ' L' + c + ',' + B + ' L' + R + ',' + B + ' Z';
		} else if (dir === 'right') {
			d = style === 'arrow'
				? 'M' + L + ',0 L' + tipR + ',' + mid + ' L' + L + ',' + h + ' Z'
				: 'M' + L + ',0 L0,0 A' + w + ',' + mid + ' 0 0 1 0,' + h
					+ ' L' + L + ',' + h + ' Z';
		} else {
			d = style === 'arrow'
				? 'M' + R + ',0 L' + tipL + ',' + mid + ' L' + R + ',' + h + ' Z'
				: 'M' + R + ',0 L' + w + ',0 A' + w + ',' + mid + ' 0 0 0 ' + w + ',' + h
					+ ' L' + R + ',' + h + ' Z';
		}
		const path = createSvg('path');
		path.setAttribute('d', d);
		path.setAttribute('fill', fill);
		svg.appendChild(path);
		return svg;
	},

	// A theme variable's resolved value. Read from the computed style, which
	// substitutes any var() the theme wrote inside it, and returned in
	// whatever colour syntax it was declared in — hex, rgb(), hsl() — all of
	// which are valid everywhere this is used.
	//
	// Cached per repaint. The bar rebuilds every second for the clock, and
	// this would otherwise be a style read per segment per tick.
	themeSurfaceColor(this: WordSmith, varName: string) {
		if (this._themeSurfaceCache && varName in this._themeSurfaceCache) {
			return this._themeSurfaceCache[varName];
		}
		let val = '';
		try {
			// Read through a PROBE rather than off the custom property.
			//
			// getPropertyValue('--background-secondary-alt') hands back the
			// token stream the theme wrote, in the syntax the theme wrote it
			// in: hsl(), color-mix(), oklch(), a bare colour name, or a
			// var() chain. That value is fine as a `background-color` and
			// useless everywhere else this colour goes, and it goes two
			// places that cannot take it:
			//
			//   • mixColors/parseColorRGB, which reads #hex and rgb() only.
			//     Anything else parses as null, and a fade whose endpoint is
			//     null renders every band the SAME colour — a gradient that
			//     does not gradate.
			//   • an SVG `fill` ATTRIBUTE on the separators. An unparseable
			//     fill is not ignored, it falls back to the SVG default,
			//     which is BLACK. That is the reported symptom, and it is
			//     why :b3/:b4 looked broken while :b1/:b2 did not — nothing
			//     about the slots differed except which syntax the theme
			//     happened to declare them in.
			//
			// Assigning `var(--name)` to a real element's background-color
			// and reading the computed value back makes the engine do the
			// whole job: nested vars, color-mix, any colour space, all
			// normalised to rgb()/rgba(). One syntax reaches everything
			// downstream, so neither consumer has to widen its parser.
			const probe = this.colorProbeEl();
			probe.style.removeProperty('background-color');
			probe.style.backgroundColor = 'var(' + varName + ')';
			const out = (getComputedStyle(probe).backgroundColor || '').trim();
			// An undefined variable is invalid at computed-value time, so
			// background-color falls to its initial value — fully
			// transparent. Indistinguishable from a theme that really did
			// declare the surface transparent, which is the price of not
			// having to special-case every colour syntax; a transparent
			// surface would paint nothing anyway, and '' is what the caller
			// already knows how to fall through on.
			val = (!out || out === 'rgba(0, 0, 0, 0)' || out === 'transparent') ? '' : out;
		} catch { val = ''; }
		if (!this._themeSurfaceCache) this._themeSurfaceCache = {};
		this._themeSurfaceCache[varName] = val;
		return val;
	},

	// A hidden element that exists only to be asked what a colour resolves
	// to. Kept and reused rather than created per read: it is touched once
	// per surface per repaint, and the bar repaints on a timer.
	//
	// On body, because that is where Obsidian defines the theme variables
	// (body.theme-dark / body.theme-light) — a probe parked anywhere that
	// does not inherit from it would resolve every var to nothing.
	colorProbeEl(this: WordSmith) {
		if (!this._colorProbeEl || !this._colorProbeEl.isConnected) {
			// Not display:none — a probe has to be a real box for the computed
			// style to be worth reading. Off-canvas and zero-sized costs nothing
			// and cannot be clicked; the box is the sheet's (`.ws-color-probe`),
			// not an inline cssText — the review's no-static-styles rule.
			const el = document.body.createSpan({ cls: 'ws-color-probe' });
			this._colorProbeEl = el;
		}
		return this._colorProbeEl;
	},

	// ── Cursor-Smith bridge ───────────────────────────────────────────────
	//
	// Cursor-Smith themes the caret per vim mode; this plugin colours the bar
	// per vim mode. Two sources of truth for "what colour is insert mode"
	// is one too many, so when Cursor-Smith is present and driving the caret,
	// its colours win and the bar follows the cursor.
	//
	// Found by SHAPE rather than by plugin id. The id is not something this
	// plugin can know reliably — it is whatever the manifest says, and has
	// no relationship to the CSS class prefixes — so instead we look for a
	// loaded plugin whose settings carry a vimModes map and a colorDark, a
	// combination nothing else has. Ids mentioning "cursor" are preferred so
	// the search is stable if something else ever matches.
	cursorSmithSettings(this: WordSmith): WsCursorSmithSettings | null {
		try {
			const reg = this.app.plugins && this.app.plugins.plugins;
			if (!reg) return null;
			let fallback: WsCursorSmithSettings | null = null;
			for (const id of Object.keys(reg)) {
				const st = (reg[id] && reg[id].settings) as WsCursorSmithSettings | null | undefined;
				if (!st || typeof st !== 'object') continue;
				if (!st.vimModes || typeof st.vimModes !== 'object') continue;
				if (typeof st.colorDark !== 'string') continue;
				if (/cursor/i.test(id)) return st;
				if (!fallback) fallback = st;
			}
			return fallback;
		} catch { return null; }
	},

	// The caret colour Cursor-Smith is using for a given mode, or null if it
	// is not installed, not driving vim, or has nothing set for that mode.
	// Null rather than a guess: the caller falls back to this plugin's own
	// pickers, which is the right answer when there is nothing to defer to.
	cursorSmithVimColor(this: WordSmith, modeKey: string) {
		const st = this.cursorSmithSettings();
		if (!st || !st.vimModeEnabled) return null;
		const dark = document.body.classList.contains('theme-dark');
		const snap = st.vimModes && st.vimModes[modeKey];
		const pick = (o: WsCursorSmithLook) => {
			if (!o) return null;
			const c = dark ? o.colorDark : o.colorLight;
			return (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) ? c : null;
		};
		// The mode's own snapshot first, then Cursor-Smith's global caret
		// colour — a mode that has never been customised still has a colour
		// on screen, and matching it is the point.
		return (snap ? pick(snap) : '') || pick(st);
	},

	// The colour for the mode vim is in right now. Falls back to normal:
	// outside vim mode getVimModeKey() returns empty, and a segment marked
	// :vim should still have a colour rather than disappearing.
	vimModeColor(this: WordSmith) {
		const key = this.getVimModeKey() || 'normal';
		if (this.settings.vimFollowCursorSmith !== false) {
			const cs = this.cursorSmithVimColor(key);
			if (cs) return cs;
		}
		const name = 'vimColor' + key.charAt(0).toUpperCase() + key.slice(1);
		const dark = this.isDarkSurface();
		const c = wsBag(this.settings)[dark ? name : name + 'Light'];
		return (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c))
			? c : (dark ? '#4f9dde' : '#2d6da4');
	},

	// The colour the CARET is wearing right now — what :bc and ;bc resolve
	// to. Distinct from vimModeColor on purpose: that is the bar's own vim
	// palette, gated by the Follow Cursor-Smith toggle; this is a report
	// about the caret itself, and the caret follows Cursor-Smith whenever
	// Cursor-Smith is installed, whatever the bar's toggle says. In vim
	// mode with Cursor-Smith driving per-mode carets, the answer moves
	// with the mode — which is why :bc is resolved per repaint like :vim,
	// never stamped once like :bs.
	//
	// Null when nothing answers, never a guess: a :bc segment then
	// degrades to flush exactly as an unpaintable theme slot does, and a
	// ;bc ink inherits the bar's.
	cursorColor(this: WordSmith) {
		const st = this.cursorSmithSettings();
		if (st) {
			// The live vim mode's caret first — cursorSmithVimColor
			// already prefers the mode's own snapshot and falls to the
			// global caret, and answers null when vim theming is off.
			const key = this.getVimModeKey();
			if (key) {
				const c = this.cursorSmithVimColor(key);
				if (c) return c;
			}
			// Outside vim (or with vim theming off): the flat caret pair.
			const dark = document.body.classList.contains('theme-dark');
			const flat = dark ? st.colorDark : st.colorLight;
			if (typeof flat === 'string' && /^#[0-9a-f]{3,8}$/i.test(flat)) return flat;
		}
		// No Cursor-Smith: the theme's own caret, resolved to paint the
		// same way every surface slot is.
		for (const name of PL_THEME_BGS.bc) {
			const c = this.themeSurfaceColor(name);
			if (c) return c;
		}
		return null;
	},

	// Build one slot of one row as powerline segments.
	//
	// `side` decides which way arrows and curves point: left-hand groups run
	// rightwards into the bar, right-hand groups run leftwards, and the
	// centre group radiates outward from its own middle — the first half
	// points left, the second half points right — because a centred group
	// has no single direction that reads as correct.
	renderPowerlineSection(this: WordSmith, formatStr: string, subs: Record<string, string>, side: string, rowH: number, barColor: string) {
		const frag = createFragment();
		if (!formatStr) return frag;
		const colors = this.powerlineColors();
		const parsed = this.parsePowerlineSegments(formatStr);
		if (!parsed.segs.length) return frag;
		const hasVim = /\{vim\}/.test(formatStr);
		// The end cap follows the row's own dividers instead of a setting.
		// Once the divider CHARACTER became the shape, a separate "end
		// shape" dropdown could disagree with the row it capped — you write
		// {a} ) {b} and get round joins with an arrow foot. The outer edge
		// now takes the nearest divider's shape, so a row is self-consistent
		// by construction and there is nothing to keep in sync.
		const cap    = parsed.seps.find(Boolean) || 'arrow';

		// Content first, colour second: a segment whose tokens all resolve to
		// nothing must vanish along with its separators. {vim} is empty
		// outside vim mode and {caps} is empty most of the time, so without
		// this the bar grows and sheds coloured stubs as you type.
		const built: { inner: HTMLSpanElement; seg: { text: string; slot: string | number | null; ink: string | number | null }; _bands: HTMLElement[]; fadeEdges: [string, string] | null }[] = [], sepsFor: string[] = [];
		for (let i = 0; i < parsed.segs.length; i++) {
			const inner = createSpan();
			inner.className = 'ws-pl-inner';
			// Soft dividers live INSIDE a segment, drawn in its own
			// foreground rather than as a colour boundary: they group
			// related readings within one block instead of setting them
			// against each other. Three of them:
			//   ::  hairline
			//   >>  small chevron pointing right
			//   <<  small chevron pointing left
			// Doubled characters, because the single forms are the arrow
			// dividers and a soft marker has to be distinguishable from a
			// hard one at a glance in the format string. Split on all three
			// at once, keeping the delimiter so the renderer knows which
			// mark to draw.
			//
			// The pieces BETWEEN the marks go to renderStatusSection, which
			// now runs this same split itself — harmlessly, because the
			// split is exhaustive: a piece that came out of it can never
			// contain another mark.
			const parts = parsed.segs[i].text.split(PL_SOFT_SPLIT);
			for (let p = 0; p < parts.length; p++) {
				const piece = parts[p];
				const mark  = this.buildSoftMark(piece);
				if (mark) { inner.appendChild(mark); continue; }
				inner.appendChild(this.renderStatusSection(piece.trim(), subs));
			}
			// A segment is empty when it holds no text and no elements. The
			// element half of that test is load-bearing for spacers: when
			// {s} substituted to figure spaces it was TEXT, and trim() eats
			// U+2007 (Unicode Zs), so a spacer-only segment measured empty
			// and was dropped along with its separators — which is why
			// spacers vanished under powerline while working in the plain
			// bar, which has no collapse step. As an element it counts.
			const hasContent = !!inner.textContent.trim()
				|| !!inner.querySelector('*:not(.ws-pl-soft)');
			if (!hasContent) continue;
			if (built.length) sepsFor.push(parsed.seps[i - 1] || cap);
			built.push({ inner, seg: parsed.segs[i], _bands: [], fadeEdges: null });
		}
		if (!built.length) return frag;

		// A segment holding ONLY {g} gradient tokens and NO explicit :N is a
		// FADE — the p10k stepped degradé. Each {g}/{gg}… element becomes one
		// band, and the bands step from the colour on one side to the colour
		// on the other: the nearest real segment, or the bar itself at a
		// group's end. One band per token, so {g}{g}{g} is three narrow steps
		// and {ggg} one wide one — the writer picks the grain. {g} with an
		// explicit :N degrades to what {s}:N is — a solid sliver — and {s}
		// itself is only ever empty space.
		const isFade = built.map(b => b.seg.slot == null
			&& /^(?:\{g+\}|\s)+$/i.test(b.seg.text));

		// Real segments first, fades second: a fade's colours are DERIVED
		// from its neighbours', so they have to exist. Indexing for the
		// auto walk stays positional, exactly as before.
		const segColors = built.map((b, i) =>
			isFade[i] ? '' : this.powerlineSegColor(b.seg, i, colors, hasVim, barColor));

		// CONSECUTIVE fades are one gradient RUN. The writer reaches this by
		// putting dividers between {g} tokens — {g}>{g}>{g} parses as three
		// fade segments with arrows between them — and the run steps its
		// colours a→b across ALL its bands, so the shapes cut through a
		// single continuous gradient rather than each little fade privately
		// fading into the bar. Divider-less runs ({g}{g}{g}) are simply a
		// run of one segment; nothing here is a special case of the other.
		for (let r0 = 0; r0 < built.length; r0++) {
			if (!isFade[r0]) continue;
			let r1 = r0;
			while (r1 + 1 < built.length && isFade[r1 + 1]) r1++;
			const a = r0 > 0 ? segColors[r0 - 1] : barColor;
			const b = r1 < built.length - 1 ? segColors[r1 + 1] : barColor;
			const bands = [];
			for (let j = r0; j <= r1; j++) {
				// Whitespace the writer typed between gradient tokens would
				// show the bar through as gaps between bands. A fade is one
				// graded block; the gaps go.
				for (const t of Array.from<HTMLElement>(built[j].inner.querySelectorAll('.ws-fit-item'))) {
					if (!t.textContent.trim()) t.remove();
				}
				built[j]._bands = Array.from<HTMLElement>(built[j].inner.querySelectorAll('.ws-pl-grad'));
				bands.push(...built[j]._bands);
			}
			const n = bands.length;
			for (let k = 0; k < n; k++) {
				// Strictly BETWEEN the two ends — (k+1)/(n+1) — so no band
				// duplicates a neighbour's own colour. A band equal to the
				// segment beside it is a step that reads as none.
				const c = mixColors(a, b, (k + 1) / (n + 1));
				bands[k].style.backgroundColor = c;
				// The same whole-pixel bleed the segments use (invariant:
				// overlaps are whole pixels, seams are closed in the
				// meeting colour). Band widths are em-fractions, so each
				// edge rounds independently and the sliver between two
				// bands shows the bar through. ±1px in the band's own
				// colour closes it; real neighbours paint over the bleed
				// wherever they actually meet.
				bands[k].style.boxShadow = '-1px 0 0 0 ' + c + ', 1px 0 0 0 ' + c;
			}
			// Per-segment edge colours — what a separator or cap standing
			// against this segment blends with — and a mid-run representative
			// for anything that still wants "the fade's colour".
			for (let j = r0; j <= r1; j++) {
				const own = built[j]._bands;
				built[j].fadeEdges = own.length
					? [own[0].style.backgroundColor, own[own.length - 1].style.backgroundColor]
					: [a, b];
				segColors[j] = own.length
					? own[Math.floor(own.length / 2)].style.backgroundColor
					: mixColors(a, b, 0.5);
			}
			r0 = r1;
		}
		// The colour a shape actually stands against, per side. For a fade
		// that is its outermost band, not the mid-run representative — an
		// arrow drawn against the middle of a gradient would carry a colour
		// no box beside it wears.
		const edgeL = (i: number) => { const fe = built[i].fadeEdges; return fe ? fe[0] : segColors[i]; };
		const edgeR = (i: number) => { const fe = built[i].fadeEdges; return fe ? fe[1] : segColors[i]; };
		const pivot = Math.ceil(built.length / 2);
		// The outermost shapes — where the group meets the bar rather than
		// another segment. Marked at build time rather than found later by
		// position: once the fit pass has hidden things, "first child" is no
		// longer the same element as "the cap", and a run of hidden tokens
		// would make an inner separator look like one.
		const markCap = (sep: SVGSVGElement, which: string) => {
			sep.classList.add('ws-pl-cap');
			// Which END it is, not which way it points: the outward side of a
			// lead cap is always the start of the row, whichever direction
			// the shape faces, and that is the side with no neighbour to
			// overlap and a clipping section edge instead.
			sep.setAttribute('data-cap', which);
			return sep;
		};

		for (let i = 0; i < built.length; i++) {
			// Leading cap: only where the group meets the bar rather than the
			// window edge. A left group starts flush at the edge. Its shape
			// follows the group's first divider, so a bar written entirely
			// with ) does not sprout one arrow at the end.
			// A left group is flush at the window edge unless a divider was
			// written before it, which is a request for a shaped opening.
			if (i === 0 && (side !== 'left' || parsed.lead)) {
				// < and > at the very start choose which way the opening
				// points; anything else keeps the default inward shape.
				// Against a fade the cap blends with the OUTERMOST band —
				// which sits close to the bar's own colour, so a cap on a
				// fade-out is as quiet as the fade it stands on.
				frag.appendChild(markCap(this.buildPowerlineSep(barColor, edgeL(0),
					parsed.leadDir || 'left', rowH,
					parsed.lead || sepsFor[0] || cap), 'lead'));
			}
			const el = createSpan();
			// A segment holding nothing but spacers is a rule, not a label:
			// it drops the 9px of side padding every other segment carries,
			// which otherwise set an 18px floor on how narrow a coloured
			// sliver could be. This is what makes {s}:N usable as an edge
			// shading against the segment beside it.
			el.className = 'ws-pl-seg'
				+ (/^(?:\{[sg]+\}|\s)+$/i.test(built[i].seg.text) ? ' ws-pl-blank' : '')
				+ (isFade[i] ? ' ws-pl-fade' : '');
			if (isFade[i]) {
				// The BANDS paint the box; the segment stays transparent so
				// no single colour peeks around them, and its edge bleed is
				// per-side — the outermost band's own colour on each.
				// `.ws-pl-seg.ws-pl-fade` is transparent in styles.css; no inline colour here.
				el.style.removeProperty('background-color');
				el.style.boxShadow = '-1px 0 0 0 ' + edgeL(i) + ', 1px 0 0 0 ' + edgeR(i);
			} else {
			el.style.backgroundColor = segColors[i];
			// A FLAG ON ITS OWN COLOUR HAS TO BE A CUTOUT. `:f` paints the
			// segment the flag's colour, and the flag inside it is drawn in
			// that same colour — a solid shape on a solid ground of one
			// colour is a shape nobody can see. Marked here, and the
			// stylesheet hands the silhouette the segment's INK instead, so
			// it reads as a hole punched in the paint rather than a flag
			// that failed to draw.
			if (built[i].seg.slot === 'f') el.classList.add('ws-pl-flagbg');
			// Bleed the segment's own colour one pixel left and right.
			//
			// Segment widths depend on their TEXT, so they are fractional —
			// which is why the hairline came and went as a line number
			// gained a digit. Each box's paint edges round independently, and
			// the sliver between two of them shows the BAR through, which in
			// a light theme is white. An outer box-shadow paints behind the
			// element but above the bar, so it fills any such gap in the
			// right colour while the real neighbours paint over it wherever
			// they actually meet. Horizontal only: a vertical bleed would
			// reach into the rules the bar draws along its edges.
			//
			// This covers the case the separator's own overlap cannot — two
			// segments left adjacent after an empty one collapsed, with no
			// separator between them to do the overlapping.
			el.style.boxShadow = '-1px 0 0 0 ' + segColors[i]
				+ ', 1px 0 0 0 ' + segColors[i];
			// An explicit ;N or ;vim wins; otherwise the readable one is
			// derived. ;vim reads the live mode at paint time, exactly as
			// :vim does for the background — the bar repaints on the same
			// events either way.
			const segInk = built[i].seg.ink;
			el.style.color = segInk === 'vim' ? this.vimModeColor()
				// ;bc: the caret's live colour as ink. Null inherits the
				// bar's own text ('' removes the inline colour), the same
				// quiet degradation a flush segment already makes.
				: segInk === 'bc' ? (this.cursorColor() || '')
				// ;f: the flag of the note in hand as ink. Null inherits the
				// bar's own text, the same quiet degradation a flush segment
				// makes — an unflagged note is not a colour.
				: segInk === 'f' ? (this.flagColor() || '')
				: (typeof segInk === 'string' && PL_THEME_INKS[segInk]) ? PL_THEME_INKS[segInk]
				: segInk != null ? this.powerlineTextColor(Number(segInk))
				: this.powerlineSegInk(built[i].seg, segColors[i], barColor);
			}
			el.appendChild(built[i].inner);
			frag.appendChild(el);
			if (i < built.length - 1) {
				const dir = side === 'left' ? 'right'
					: side === 'right' ? 'left'
					: ((i + 1) < pivot ? 'left' : 'right');
				// The WRITTEN shape, fades included: an arrow beside (or
				// inside) a gradient run blends with the outermost band on
				// each side, which is a colour a real box is wearing. A |
				// stays invisible, so a flat fade is written with pipes and
				// a sawtooth one with arrows — the divider says which.
				frag.appendChild(this.buildPowerlineSep(edgeR(i), edgeL(i + 1), dir, rowH, sepsFor[i]));
			}
		}
		if (side !== 'right' || parsed.tail) {
			frag.appendChild(markCap(this.buildPowerlineSep(edgeR(built.length - 1), barColor,
				parsed.tailDir || 'right', rowH,
				parsed.tail || sepsFor[sepsFor.length - 1] || cap), 'tail'));
		}
		return frag;
	},

	renderStatusSection(this: WordSmith, formatStr: string, subs: Record<string, string>) {
		const frag = createFragment();
		if (!formatStr) return frag;

		// Walked token by token, rather than substituted with a chain of
		// whole-string replaces, because the fit pass drops ELEMENTS and can
		// only drop what the render gave it.
		//
		// The old version flattened the slot into one string and then wrapped
		// each run of text BETWEEN drawn tokens in a single `.ws-fit-item`.
		// In a powerline row that was invisible, because there the segment is
		// the unit and a row is cut segment by segment. In a plain row it was
		// the whole bug: a slot with no drawn tokens in it — `{file}`, or
		// `{words} words {chars} chars` — produced exactly ONE item, so the
		// first thing the fit pass could shed was the entire left slot. The
		// bar did not shorten, it amputated.
		//
		// A second thing falls out of the walk: a token's VALUE is never
		// rescanned, so a note named `{words}.md` is no longer substituted
		// into a word count by a later pass over the same string.
		const keys = Object.keys(subs).filter(k => k.charAt(0) === '{')
			// Longest first, so no key can be stolen by a shorter one that
			// happens to be its prefix.
			.sort((a, b) => b.length - a.length);
		const tokenRe = keys.length
			? new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
			: null;

		// nodes: { text, tok } for a run of text, { el } for a drawn token.
		//
		// A run keeps collecting until it already holds a token AND another
		// token arrives. So `Words: {words}` and `{words} words` each come
		// out as one item carrying its own label, while `{words} {chars}` is
		// two — dropping a reading never leaves an orphaned label behind it,
		// which is the failure mode that makes token-level shedding look
		// broken even when it works.
		// a piece of the section: a run of text with its parts, a token's element, or a mark
		type WsSecNode = { text?: string; parts?: { text: string; act: string | null }[]; tok?: string | boolean; el?: string; mark?: string; identity?: boolean; ambient?: boolean };
		const nodes: WsSecNode[] = [];
		let cur: WsSecNode | null = null;
		// `name` is the token this text came from, when it came from one.
		// Carried so the fit pass can tell a note's name from a word count
		// without guessing from the rendered text — see fitClassOf. Only
		// the identity tokens are recorded; everything else is a reading and
		// needs no mark.
		const IDENTITY_TOKENS: Record<string, number> = { '{file}': 1, '{vim}': 1 };
		// The clock goes EARLY. It is a reading by shape — it renders a
		// number that changes — but not by use: the time is on the system
		// clock, the phone and the wall, and a writer glancing at the bar to
		// find it is glancing at their fourth-nearest clock. So it sits
		// between ornament and the readings that are actually about the
		// work, and sheds before any of them.
		const AMBIENT_TOKENS: Record<string, number> = { '{time}': 1, '{clock}': 1 };
		// ── TOKENS THAT DO SOMETHING WHEN THEY ARE CLICKED ────────────────
		//
		// A reading that names a pane the app already has is half a control:
		// the row says two notes link here, and finding out WHICH meant going
		// to the ribbon or the palette. These two now open the pane they are
		// a summary of — the same relationship {report} and {flag} already
		// have with their windows, except that these are written as text
		// rather than drawn, so they cannot be buttons and have to carry the
		// click themselves.
		//
		// ONLY TOKENS WITH A PANE BEHIND THEM. {words} has nowhere to go and
		// {time} is a clock; a row where some readings are pressable and the
		// rest merely look it is worse than one where none are.
		const TOKEN_ACTS: Record<string, { panel?: string; tip: string; [extra: string]: unknown }> = {
			'{file}':      { panel: 'file-explorer',
				tip: 'Show this note in the file explorer' },
			'{backlinks}': { panel: 'backlink',
				tip: 'Show the notes that link to this one' }
		};
		const addText = (s: string, isTok: boolean, name?: string) => {
			if (!s) return;
			if (!cur || (isTok && cur.tok)) { cur = { text: '', parts: [], tok: false }; nodes.push(cur); }
			cur.text += s;
			// KEPT IN PIECES as well as whole. A run is a token plus whatever
			// literal text rides with it — `Links: {backlinks} in` is one item
			// — and the press belongs to the TOKEN, not to its label: a click
			// anywhere in the item would mean pressing the word "in" opened a
			// sidebar. `text` stays the flat string every other reader of a
			// node uses; `parts` is only consulted when something in the run
			// is pressable.
			if (cur.parts) cur.parts.push({ text: s, act: (isTok && name && TOKEN_ACTS[name]) ? name : null });
			if (isTok) cur.tok = true;
			if (name && IDENTITY_TOKENS[name]) cur.identity = true;
			if (name && AMBIENT_TOKENS[name]) cur.ambient = true;
		};
		// `tok` is the token that produced this element, so a drawn token can
		// be classified the same way a written one is. {clock} is the reason:
		// it renders as a dial rather than as text, so the text path above
		// never sees it.
		const addEl = (name: string, tok: string) => { nodes.push({ el: name, tok }); cur = null; };

		// Soft marks (:: >> <<) first, so the token walk below never sees
		// them. They used to be split out by the POWERLINE renderer only,
		// which is why a plain row printed `::` as two colons — the marks
		// were not powerline features, they were just parsed in the
		// powerline path. Splitting here gives every row the same grammar,
		// and costs the powerline path nothing: it hands this function
		// pieces it has already split, and a piece that came out of an
		// exhaustive split cannot contain another mark.
		//
		// A mark also ENDS the current run (cur = null via addMark), which is
		// what the fit pass wants: `{words} :: {chars}` is two shedable
		// items with a mark between them, not one item that can only be
		// dropped whole.
		const addMark = (mark: string) => { nodes.push({ mark }); cur = null; };

		for (const chunk of String(formatStr).split(PL_SOFT_SPLIT)) {
			if (!chunk) continue;
			if (PL_SOFT[chunk]) { addMark(chunk); continue; }
			let last = 0;
			if (tokenRe) {
				// exec is stateful and the regex is reused across chunks, so
				// lastIndex has to be cleared or the second chunk starts
				// scanning from wherever the first one stopped.
				tokenRe.lastIndex = 0;
				let m;
				while ((m = tokenRe.exec(chunk))) {
					addText(chunk.slice(last, m.index), false);
					const v = String(subs[m[0]]);
					// Tokens that render as elements substitute to a lone
					// sentinel; everything else is text. \x00 cannot appear
					// in a format string or a note name, so the test is
					// unambiguous.
					if (v.charCodeAt(0) === 0) addEl(v.slice(1, -1), m[0]);
					else addText(v, true, m[0]);
					last = m.index + m[0].length;
				}
			}
			// Whatever is left, including an unknown `{token}` nobody
			// substituted, which stays visible as text exactly as before.
			addText(chunk.slice(last), false);
		}

		// Tokens that render as elements rather than text are substituted as
		// sentinels above and spliced back in as real nodes here. They are
		// appended to the fragment DIRECTLY, never wrapped in a fit item: a
		// {g} band carries no text, and the fade pass drops text-less items.
		const builders: Record<string, () => HTMLElement | null> = {
			MODE:     () => this.buildModeIndicator(),
			SYNTAX:   () => this.buildSyntaxIndicator(),
			MARKERS:  () => this.buildMarkersIndicator(),
			WRITECHECKS: () => this.buildWriteChecksIndicator(),
			FONT:     () => this.buildFontIndicator(),
			THEME:    () => this.buildThemeIndicator(),
			REPORT:   () => this.buildReportIndicator(),
			HISTORY:  () => this.buildHistoryIndicator(),
			EXPORT:   () => this.buildExportIndicator(),
			POWERMENU: () => this.buildPowermenuIndicator(),
			OUTLINER: () => this.buildOutlinerIndicator(),
			FLAG:     () => this.buildFlagIndicator(),
			PROPS:    () => this.buildPropsIndicator(),
			BACKL:    () => this.buildBacklinksIndicator(),
			CAPS:     () => this.buildCapsIndicator(),
			NUM:      () => this.buildNumIndicator(),
			CLOCK:    () => this.buildClockFace(),
			OBSIDIAN: () => this.buildObsidianIcon()
		};
		for (const n of nodes) {
			// Appended straight to the fragment, never wrapped in a
			// `.ws-fit-item`: a mark carries no text, and the fit pass sheds
			// items by text. A row that shortened by dropping its dividers
			// and keeping the readings would be shedding the cheapest thing
			// on the row and the one holding it together.
			if (n.mark !== undefined) {
				const el = this.buildSoftMark(n.mark);
				if (el) frag.appendChild(el);
				continue;
			}
			if (n.el !== undefined) {
				// {s}, {ss}… — one unit of width per s. An element rather
				// than characters, so the width is the same in every font.
				if (n.el.startsWith('SP:')) {
					const sp = createEl('i');
					sp.className = 'ws-pl-space';
					sp.style.width = (Number(n.el.slice(3)) * this.plUnit()) + 'px';
					frag.appendChild(sp);
				// {g} — a gradient band. Same sizing as a spacer, its own
				// class: the fade pass paints .ws-pl-grad and must never
				// touch a spacer, which is empty space by contract.
				} else if (n.el.startsWith('GR:')) {
					const gr = createEl('i');
					gr.className = 'ws-pl-grad';
					gr.style.width = (Number(n.el.slice(3)) * this.plUnit()) + 'px';
					frag.appendChild(gr);
				} else if (builders[n.el]) {
					const drawn = builders[n.el]();
					if (drawn && drawn.classList && typeof n.tok === 'string' && AMBIENT_TOKENS[n.tok]) {
						drawn.classList.add('ws-fit-ambient');
					}
					if (drawn) frag.appendChild(drawn);
				}
				continue;
			}
			if (!n.text) continue;
			// Wrapped rather than appended as a bare text node: the fit pass
			// drops elements, and a text node cannot be hidden or selected.
			const t = createSpan();
			t.className = 'ws-fit-item'
				+ (n.identity ? ' ws-fit-identity' : '')
				+ (n.ambient ? ' ws-fit-ambient' : '');
			// The item's TEXT is unchanged either way — same characters, same
			// order, so the fit pass measures and sheds exactly what it did
			// before and nothing that reads `.ws-fit-item` textContent can
			// tell the two apart. What changes is that the pressable token is
			// its own node inside it.
			//
			// NOT `.ws-barbtn`. That class is what `fitCandidates` filters on
			// to keep buttons from ever being shed, and a file path that
			// refused to shorten because it had become a button would be a
			// row that stops fitting.
			const acts = (n.parts || []).filter((p2) => p2.act);
			if (!acts.length) {
				t.textContent = n.text;
			} else {
				for (const p2 of n.parts || []) {
					if (!p2.act) { t.appendChild(document.createTextNode(p2.text)); continue; }
					const spec = TOKEN_ACTS[p2.act];
					const a = createSpan();
					a.className = 'ws-tokact';
					a.textContent = p2.text;
					a.setAttribute('title', spec.tip);
					// MOUSEDOWN, NOT CLICK, and the bar had this written down
					// before I ignored it: `buildBarButton` says "a bar
					// repaint between press and release swallows `click`
					// entirely". This row rebuilds on the clock tick, and
					// again the moment a press moves focus out of the editor
					// — so the mouseup lands on a span that did not exist
					// when the mousedown happened, and no click event is ever
					// produced. The token looked pressable and did nothing.
					//
					// Every other pressable thing on this bar already binds
					// mousedown. A rule the bar states about itself is a rule
					// anything drawn INTO the bar has to follow.
					a.addEventListener('mousedown', (ev) => {
						ev.preventDefault();
						ev.stopPropagation();
						if (spec.panel) void this.openSidebarPanel(spec.panel);
					});
					t.appendChild(a);
				}
			}
			frag.appendChild(t);
		}
		return frag;
	},

	// How many crumbs the caret's trail has, for the fit pass to know
	// whether there is anything left to drop.
	headingCrumbCount(this: WordSmith) {
		try {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return 0;
			return this.headingTrail(view).filter(Boolean).length;
		} catch { return 0; }
	},

	// A reduction that changes the TEXT has to be re-rendered, not patched
	// in place. Guarded: the rebuild schedules another fit, and without the
	// flag a mistake in the latch above would spin.
	requestBarRebuild(this: WordSmith) {
		if (this._barRebuilding) return;
		this._barRebuilding = true;
		const run = () => {
			this._barRebuilding = false;
			if (this.retroStatusBarEl) this.updateRetroStatusBar();
		};
		if (typeof window !== 'undefined' && window.requestAnimationFrame) {
			window.requestAnimationFrame(run);
		} else {
			window.setTimeout(run, 0);
		}
	},

	// A MICROTASK, not an animation frame — and that one word is the whole
	// fix for the bar flickering on every keystroke.
	//
	// updateRetroStatusBar rebuilds the row synchronously: every token back,
	// every cap back, the file path back to its full length. The fit pass then
	// takes the width away again. Scheduling that pass with requestAnimationFrame
	// put a PAINT between the two, so on any window narrow enough for the fit
	// to actually cut something — sidebars open, a small window — every
	// keystroke painted one frame of the over-full bar before the fitted one.
	// That is the flash, and it looked like the bar trying to wrap itself
	// because that is very nearly what it was doing: the row overflowing its
	// sections for exactly one frame.
	//
	// A microtask runs after the current task and BEFORE the frame is painted,
	// so the rebuild and the fit land in the same paint and the over-full state
	// is never on screen. Measurement is available immediately either way:
	// getBoundingClientRect forces layout on demand, and never needed a frame
	// to become accurate — the frame only ever delayed it.
	//
	// The rAF path stays for the case it was really protecting: a bar with no
	// layout box yet (first build, mid-teardown, hidden pane), where
	// clientWidth is 0 and fitStatusRow would bail out anyway. There it costs
	// nothing to wait, and waiting is what makes the first paint correct.
	// Deferred to the next frame, never run inline. The bar rebuilds its DOM
	// on every tick (the clock alone guarantees one a second), and measuring
	// immediately after inserting nodes reads the layout from BEFORE they
	// were placed — so the same bar measured as fitting on one tick and
	// overflowing on the next, and tokens flickered in and out. One pending
	// frame at a time; a burst of updates collapses into a single measure.
	scheduleFit(this: WordSmith) {
		if (this._fitPending) return;
		this._fitPending = true;
		const run = () => {
			if (!this._fitPending) return;
			this._fitPending = false;
			this.fitStatusBarText();
		};
		// Guarded: this is called from stampMaskPositions among others, and
		// an exception here would take mask placement down with it.
		const el = this.retroStatusBarEl;
		if (el && el.clientWidth && typeof Promise !== 'undefined') {
			Promise.resolve().then(run).catch(() => { this._fitPending = false; });
			return;
		}
		if (typeof window !== 'undefined' && window.requestAnimationFrame) {
			window.requestAnimationFrame(run);
		} else {
			window.setTimeout(run, 0);
		}
	},

	fitStatusBarText(this: WordSmith) {
		const el = this.retroStatusBarEl;
		if (!el) return;
		// The type NEVER shrinks: a bar that answers a narrow window by
		// becoming unreadable rather than shorter is 7px prose present without
		// being legible, and the drop pass would never run because the font
		// search always finds some size that fits. The size the writer chose —
		// or, following the note, whatever the editor is at right now,
		// Ctrl+scroll included — is the size the bar uses; if the content will
		// not fit at that size, content goes.
		el.style.fontSize = this.settings.statusBarFontFollowNote
			? 'var(--font-text-size, 16px)'
			: (this.settings.statusBarFontSize || 13) + 'px';
		this.fitStatusBar();
	},

	// ── The pane reservation ──────────────────────────────────────────────
	// Nothing in the workspace is resized for the bar — it is a fixed
	// overlay — so without this the last lines of a note scroll underneath
	// it, and the caret goes with them: you keep typing into a line you
	// cannot see. Reserving the strip as PANE padding (see styles.css,
	// .ws-bar-overlap) shrinks the editor's box, so CodeMirror's own
	// scroll-into-view keeps the caret above the bar because there is
	// nowhere else for it to be. Scroller padding cannot do this — it only
	// lets the last line be scrolled clear, while every line still passes
	// under the bar on the way.
	//
	// Two things are stamped here, both measured rather than rebuilt from
	// settings (invariant 8):
	//
	// - `--ws-bar-reserve`, the depth of the strip, taken from the bar's
	//   own top edge down to the bottom of the editor area. The settings
	//   arithmetic in the stylesheet's fallback is short by the plain
	//   bar's border widths, which are stamped inline and are NOT in
	//   --ws-status-bar-height. Divided by the zoom factor before it is
	//   written: the measurement is in zoomed coordinates and a px value
	//   is read unzoomed (invariant 2).
	//
	// - `.ws-bar-overlap`, on the panes the bar actually covers. The bar
	//   spans the whole root split, so a left/right split has the strip in
	//   both panes — but in a top/bottom split the upper pane never
	//   reaches the bar, and padding it would open a dead band across the
	//   middle of the window.
	//
	// No feedback loop: pane padding is inside `.workspace-leaf`, so
	// nothing measured here moves when it is applied. The bar's own rect
	// is where the strip comes from, and that is laid out from the
	// window's bottom edge.
	//
	// Fails toward RESERVING. A leaf whose rect cannot be read keeps the
	// strip: a needless gap at the bottom of a pane is visible and
	// harmless, while a missing one hides the caret, which is the bug.
	stampBarReserve(this: WordSmith, barTop: number) {
		const root   = document.documentElement.style;
		const leaves = document.querySelectorAll('.workspace-split.mod-root .workspace-leaf');
		// No bar, or slid away by the toggle: give the space back. The
		// stylesheet drops the padding on `.ws-bar-hidden` as well, so this
		// is belt and braces for the case where the bar is gone entirely.
		if (!(barTop > 0)) {
			if (this._barReserve !== 0) {
				this._barReserve = 0;
				root.removeProperty('--ws-bar-reserve');
			}
			leaves.forEach(l => l.classList.remove('ws-bar-overlap'));
			return;
		}
		// Down to the bottom of the editor area, not the viewport: they are
		// the same while the native status bar is hidden (which the retro
		// bar always does), and this stays right if it ever is not.
		let bottom = 0;
		try {
			const rootEl = document.querySelector('.workspace-split.mod-root');
			const rr = rootEl && rootEl.getBoundingClientRect();
			if (rr && rr.height) bottom = rr.bottom;
		} catch (_) { wsCatch('stampBarReserve: const rootEl = document.querySelector(\'.workspace-split.mod-root\');', _); }
		if (!(bottom > barTop)) {
			bottom = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
		}
		const z = this.zoomFactor();
		// Rounded in the space it will be PAINTED in, like stampBarBounds:
		// round the measurement, then divide.
		const reserve = Math.max(0, Math.round((Math.round(bottom - barTop) / z) * 1000) / 1000);
		if (this._barReserve !== reserve) {
			this._barReserve = reserve;
			root.setProperty('--ws-bar-reserve', reserve + 'px');
		}
		leaves.forEach(leaf => {
			let over = true;
			try {
				const r = leaf.getBoundingClientRect();
				// A pane is covered when its bottom edge is past the bar's
				// top. The 1px slack keeps a pane that ends exactly on that
				// line from flickering between the two answers as
				// fractional geometry rounds one way and then the other.
				if (r && r.height) over = r.bottom > barTop + 1;
			} catch (_) { wsCatch('stampBarReserve: const r = leaf.getBoundingClientRect();', _); }
			leaf.classList.toggle('ws-bar-overlap', over);
		});
	},

	// Hands the bar back to the stylesheet — `.ws-status-bar` is
	// `left: 0; width: 100%` until something says otherwise, and that is the
	// correct answer whenever the measurement is unavailable or untrustworthy.
	//
	// Idempotent, and it has to be: this is reached from the mask pass, which
	// runs on scroll. It also drops the bounds cache, which the old inline
	// version of this did not — so a root split that comes back at exactly
	// the geometry it left at is stamped again instead of being mistaken for
	// "no change" and left full width forever.
	clearBarBounds(this: WordSmith) {
		const el = this.retroStatusBarEl;
		if (!el || !el.style || typeof el.style.removeProperty !== 'function') return;
		if (this._barBoundsCleared) return;
		this._barBoundsCleared = true;
		this._barBoundsL = this._barBoundsW = null;
		// The element these bounds were written to is no longer carrying
		// them, so it must not be remembered as though it were.
		this._barBoundsEl = null;
		el.style.removeProperty('left');
		el.style.removeProperty('width');
		el.style.removeProperty('right');
		const pl = this.retroPlinthEl;
		if (pl && pl.style && typeof pl.style.removeProperty === 'function') {
			pl.style.removeProperty('left');
			pl.style.removeProperty('width');
		}
		this.scheduleFit();
	},

	// Confines the bar to the editor area instead of the whole window.
	//
	// The bar is `position: fixed; left: 0; width: 100%`, which is right in
	// zen mode — the side panes are hidden there and the bar is the full
	// instrument line. With the panes open it painted straight across them,
	// covering the file tree's footer and the right pane's bottom edge.
	//
	// The root split is the editor area by definition, so the bar simply
	// takes its horizontal bounds. In zen that rect IS the window, so the
	// same code covers both cases with no mode check. Written inline, since
	// this is measured geometry rather than a setting: nothing in the
	// stylesheet knows where the panes happen to be.
	stampBarBounds(this: WordSmith) {
		const el = this.retroStatusBarEl;
		// Guarded on the style object as well as the element: this runs from
		// stampMaskPositions, and a throw here would take mask placement
		// down with it — the bar being a pixel wide is a blemish, the
		// letterbox failing is the feature gone.
		if (!el || !el.style || typeof el.style.removeProperty !== 'function') return;

		// A phone has no side-by-side panes. The root split IS the window, so
		// everything below can only agree with the stylesheet or be wrong —
		// and on Android in portrait it was wrong: the bar was stamped most
		// of a screen-width to the right, with `!important` on it, so nothing
		// downstream could argue it back. Landscape looked fine because the
		// offset there was small enough to read as a margin.
		//
		// Measuring nothing is the fix, not measuring better. There is no
		// geometry on a phone that the stylesheet does not already have.
		if (this.isMobileApp()) { this.clearBarBounds(); return; }

		const root = document.querySelector('.workspace-split.mod-root');
		const r = root && root.getBoundingClientRect();
		if (!r || !r.width) {
			// No root split (or not laid out): fall back to the stylesheet's
			// full width rather than pinning the bar to a stale rectangle.
			this.clearBarBounds();
			return;
		}
		// NOT divided by the zoom factor.
		//
		// Invariant 2 says measured geometry is divided before it is written
		// as px, and that is right for anything written INTO the zoomed
		// subtree — --ws-bar-reserve becomes a margin on .cm-scroller, and
		// still divides. It is wrong here. The bar is a fixed child of
		// <body>, overlaying the editor from outside it, and a rect measured
		// off the pane is already in the coordinate space it paints in.
		//
		// The masks are the proof, and they were sitting beside this the
		// whole time: same kind of element, same job, same rects — stamped
		// raw, and correct at every zoom level. Dividing here made the bar
		// too narrow zoomed in (right end walking left) and too wide zoomed
		// out (running off the right of the window), by exactly the zoom
		// ratio in each direction.
		const z = this.zoomFactor();
		// The zoom factor is still read, but only to know WHEN the layout
		// changed, never to scale anything here.
		//
		// --zoom-factor moves the instant Ctrl+/- is pressed; the reflow it
		// causes has not happened yet. A pass landing in that frame measures
		// the pane at its OLD size and caches it — and the cache below then
		// holds the bar at the old geometry, because the pass after that
		// sees no change and writes nothing.
		//
		// So a pass that arrives mid-transition measures nothing. It drops
		// the cache and comes back two frames later, when the two agree.
		// The guard lives here rather than at the call sites because every
		// caller has the same problem and only this one knows the factor.
		if (this._stampZoom !== undefined && this._stampZoom !== z) {
			this._stampZoom = z;
			this._barBoundsL = this._barBoundsW = null;
			this.afterReflow(() => this.stampBarBounds());
			return;
		}
		this._stampZoom = z;
		const left  = Math.round(r.left);
		const width = Math.round(r.width);

		// A rectangle that does not fit in the window is not a pane, it is a
		// bad measurement, and stamping it `!important` is how a bar ends up
		// somewhere its own stylesheet can no longer reach it. The window is
		// the one bound this is always allowed to assume: the root split is a
		// child of it and cannot honestly be wider or start outside it.
		//
		// innerWidth rather than visualViewport.width on purpose — a fixed
		// element at `width: 100%` is sized by the LAYOUT viewport, so that is
		// the width this is really being compared against. visualViewport
		// shrinks under pinch-zoom and would reject a perfectly good pane.
		// 2px of slack for fractional geometry rounded twice.
		const vw = Math.round(window.innerWidth || 0);
		if (vw && (width <= 0 || left < -2 || left + width > vw + 2)) {
			this.clearBarBounds();
			return;
		}
		this._barBoundsCleared = false;

		// Only touched when it actually changes: writing left/width on every
		// mask pass would invalidate layout continuously, and the mask pass
		// runs on scroll.
		//
		// …AND THE CACHE IS KEYED TO THE ELEMENT, not only to the numbers.
		// The bar is DESTROYED when the active note leaves scope and a NEW
		// element is built when the next one is in it — so after a switch
		// between two notes in the same layout, `left` and `width` are
		// unchanged, this comparison found nothing to do, and the brand new
		// element was left with no inline geometry at all. Its stylesheet
		// says `left: 0; width: 100%`, so the bar ran the full width of the
		// window and covered the bottom of the sidebar — the vault name and
		// the settings cog with it.
		//
		// Reported as "it is right when I enable the plugin and wrong when I
		// click to another note", and as "closing and reopening the sidebar
		// fixes it": both are this. The first element was stamped because
		// the cache was empty; reopening the sidebar CHANGES the geometry,
		// which is the one thing that made the numbers differ and let the
		// write through.
		//
		// An identity check rather than dropping the cache on teardown: the
		// element can be replaced by paths that never touch clearBarBounds,
		// and the question this cache is really asking is "does the box on
		// screen already carry these bounds", which only the box can answer.
		if (this._barBoundsL !== left || this._barBoundsW !== width
			|| this._barBoundsEl !== el) {
			this._barBoundsEl = el;
			this._barBoundsL = left;
			this._barBoundsW = width;
			// setProperty with priority, not `style.left = …`. Plain inline
			// styles already beat any stylesheet, so in principle the simple
			// form is enough — but this is the SECOND feature whose inline
			// left/width had no visible effect in the field (the removed
			// side inset was the first), and the two share nothing else.
			// Whatever wins that contest, an important inline declaration
			// is above it. `right` is cleared with them: the stylesheet does
			// not set it, but the removed side inset did, and a stale value
			// would fight the width.
			// Also published as variables, so anything else that wants to
			// trace the note's column can. The Hemingway screen flash is
			// the first: it draws a ring around the note rather than
			// washing the whole window, and the window is the wrong shape
			// for that — the note is a column inside it.
			// Named --ws-col-*, not --ws-note-*: `ws-note` is a retired prefix,
			// and removal_test forbids it in the stylesheet by name.
			//
			// Guarded like everything else in this method: it runs from
			// stampMaskPositions, and a throw here takes mask placement down
			// with it.
			try {
				const b = document.body && document.body.style;
				if (b && b.setProperty) {
					b.setProperty('--ws-col-left',  left + 'px');
					b.setProperty('--ws-col-width', width + 'px');
				}
			} catch (_) { wsCatch('stampBarBounds: const b = document.body && document.body.style;', _); }
			el.style.setProperty('left',  left + 'px',  'important');
			el.style.setProperty('width', width + 'px', 'important');
			el.style.removeProperty('right');
			// The plinth sits directly beneath the bar, so it takes the same
			// horizontal bounds — otherwise it is the thing hanging over the
			// panes instead.
			const pl = this.retroPlinthEl;
			if (pl && pl.style && typeof pl.style.setProperty === 'function') {
				pl.style.setProperty('left',  left + 'px',  'important');
				pl.style.setProperty('width', width + 'px', 'important');
			}
			// The usable width just changed, so what fits changed with it.
			this.scheduleFit();
		}
	},
};
export type BarMethods = typeof barMethods;
