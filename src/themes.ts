// Word-Smith — Themes: the colour schemes: the shelf, the halves, the inks, the guard, the variables.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import type { WsCursorSmithPlugin } from './settings';
import { BAR_THEMES, colorToHsl, hslToHex, mixColors, parseColorRGB, wsCatch } from './preamble';
import type { WsBarTheme, WsThemeHalf } from './preamble';
import type WordSmith from './plugin';

export const themesMethods = {

	// ═════════════════════════════════════════════════════════════════════════
	// Themes — colour schemes for the WORKSPACE
	// ═════════════════════════════════════════════════════════════════════════
	//
	// A theme is what the whole workspace looks like — editor, sidebars,
	// panels — not a status-bar palette. Picking one writes CSS custom
	// properties INLINE ON BODY and nothing else, so a writer's own bar
	// swatches survive a theme switch untouched; the bar follows along
	// because :b1–:b4 already read the variables a theme rewrites.
	//
	// Three rules here are load-bearing, each the scar of a design that was
	// correct and did not work:
	//   INLINE, never an injected rule — `body.ws-theme-x` TIES with the
	//   `body.theme-dark` every community theme writes its variables on, and
	//   a tie is broken by source order, which Obsidian reshuffles. Inline
	//   beats every non-important rule from any source in any order.
	//   THREE VARIABLE LAYERS at once — Obsidian's named variables, its
	//   --color-base-* token ramp, and Minimal's private ladder (--bg1…,
	//   --tx1…), which maps ~200 variables and defines no --color-base-* at
	//   all. A property nobody reads costs nothing; a layer nobody set reads
	//   as "the theme half-applied".
	//   THE MENU INVOKES item.onClick — see themesPickerItems. It was `run:`
	//   once, and a theme clicked in the menu did nothing, silently.

	barThemeById(this: WordSmith, id: string) {
		for (const t of BAR_THEMES) if (t.id === id) return t;
		return null;
	},

	// Apply a shipped theme.
	//
	// THIRD DESIGN, and the first two were the same mistake made twice. A
	// theme originally wrote the seven powerline palette colours; that left
	// the shipped presets untouched, because they are written :b2|:b1 and
	// those slots read Obsidian's surface variables. The second attempt made
	// :bN read the theme's surfaces instead. Both were the BAR answering a
	// question about the APP.
	//
	// Modus, Nord and Dracula are not status-bar palettes. They are colour
	// schemes for everything you are looking at, and picking one should
	// change the editor, the sidebars and the panels — with the bar following
	// along, because the bar already reads those variables. So a theme now
	// writes CSS CUSTOM PROPERTIES and nothing else.
	//
	// Which is why it needs no settings writes at all beyond the one key
	// naming the scheme. Nothing is copied into the palette, so nothing has
	// to be copied back out; there is no hand-edited-palette state to
	// reconcile; and a writer's own swatches survive a theme switch
	// untouched. The powerline palette is the writer's. The workspace is the
	// theme's.
	// The shelf as this writer arranged it: their order first, anything new
	// the table gained appended in table order, minus what they removed.
	// Order IS priority — the same contract as Obsidian's own font list,
	// where the list you see is the list you curated. Unknown ids in either
	// setting are ignored rather than repaired, so a downgrade that never
	// heard of a theme costs a preference, not a crash.
	barThemeShelf(this: WordSmith) {
		const hidden = new Set(this.settings.barThemeHidden || []);
		const known  = new Map(BAR_THEMES.map(t => [t.id, t]));
		const out: WsBarTheme[] = [];
		for (const id of (this.settings.barThemeOrder || [])) {
			const t = known.get(id);
			if (t && !hidden.has(id)) { out.push(t); known.delete(id); }
		}
		for (const t of BAR_THEMES) {
			if (known.has(t.id) && !hidden.has(t.id)) out.push(t);
		}
		return out;
	},

	// Move a theme within the shelf. Writes the FULL visible order rather
	// than a delta, so the setting always describes the shelf as seen and
	// two moves cannot interleave into an order nobody chose.
	barThemeMove(this: WordSmith, id: string, to: number) {
		const ids = this.barThemeShelf().map((t) => t.id);
		const from = ids.indexOf(id);
		if (from === -1) return false;
		ids.splice(from, 1);
		ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
		this.settings.barThemeOrder = ids;
		return true;
	},

	// Removing a theme from the shelf never touches the LIVE scheme except
	// in one case: hiding the scheme you are wearing takes it off first.
	// A workspace dressed in a theme its own picker no longer offers is a
	// state with no way back through the UI that created it.
	barThemeHide(this: WordSmith, id: string) {
		const hidden = this.settings.barThemeHidden || [];
		if (hidden.indexOf(id) === -1) hidden.push(id);
		this.settings.barThemeHidden = hidden;
		if (this.settings.barTheme === id) this.applyBarTheme('custom');
	},

	barThemeShow(this: WordSmith, id: string) {
		this.settings.barThemeHidden =
			(this.settings.barThemeHidden || []).filter((h) => h !== id);
	},

	// One list, feeding both the settings cards and the menu row, in shelf
	// order — the single-source rule the other pickers follow.
	themesPickerItems(this: WordSmith) {
		const live = this.settings.barTheme;
		// DEFAULT sits first, always: it is the way OUT, and a menu that
		// offers nineteen ways to dress and no way to undress makes the
		// writer dig through settings to get their own theme back. It rides
		// the same list as everything else so the menu and the cards cannot
		// disagree about it, and it neither drags nor removes — there is no
		// priority to give the absence of a scheme, and no meaning to
		// removing it.
		const items = [{
			id:    'custom',
			label: 'Default',
			note:  'No scheme \u2014 the workspace is your Obsidian theme\u2019s.',
			swatches: [] as string[],
			on:    live === 'custom',
			onClick: async () => {
				// DEFAULT IS A SCHEME, NOT A SWITCH: picking Default after a theme must
				// not disable the theme system and lose the extra options with it
				// (checkbox styles, hidden workspace borders and so on).
				//
				// This USED to set `barThemeEnabled = false`, deliberately — the
				// old note called it "one control, reachable from the bar, that
				// both undresses and switches off". The trouble is what else
				// hangs off that flag: `ws-borderless` is `barThemeEnabled !==
				// false && barThemeBorderless`, and the same gate stands in front
				// of the rest. A writer reaching for "no colours" lost controls
				// that have nothing to do with colours.
				//
				// A CHOICE INSIDE A FEATURE MUST NOT SWITCH THE FEATURE OFF. The
				// scheme goes to `custom`, which is already the id meaning "not a
				// theme", and the system stays up so everything gated on it stays
				// reachable.
				//
				// WHAT THIS COSTS: the bar no longer has a one-click OFF. The
				// master lives in the settings tab, where the other masters are.
				// Said plainly rather than discovered — if the bar wants an off
				// switch again it should be its own control and not a scheme.
				this.applyBarTheme('custom');
				// Redraw first, persist after — the rule the zoom tabs follow.
				this.updateStatusBar();
				await this.saveSettings();
			}
		}];
		const half = this.isDarkTheme() ? 'dark' : 'light';
		// Every item carries `onClick` — the property THE MENU INVOKES.
		// It was `run:` once and the menu path was silently dead through
		// five designs; the full story lives on the engine header above,
		// and theme_probe pins the contract by DRIVING it.
		const one = (t: WsBarTheme) => ({
			id:    t.id,
			label: (t.names && t.names[half]) || t.name,
			note:  t.note,
			color: this.barThemeHalf(t).c1,
			swatches: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']
				.map(k => this.barThemeHalf(t)[k]),
			on:    live === t.id,
			onClick: async () => {
				// CHOOSING A SCHEME TURNS THE SYSTEM ON. Without this, a
				// writer who had switched themes off found the Theme row
				// inert: every pick applied a scheme the kill switch then
				// refused to paint, so nothing happened and nothing said
				// why. Picking a scheme IS asking for themes.
				this.settings.barThemeEnabled = true;
				this.applyBarTheme(t.id);
				this.updateStatusBar();
				await this.saveSettings();
			}
		});
		return items.concat(this.barThemeShelf().map(t => one(t)));
	},

	applyBarTheme(this: WordSmith, id: string) {
		if (id !== 'custom' && !this.barThemeById(id)) return false;
		this.settings.barTheme = id;
		this.applyThemeClass();
		this.applyThemeVars();
		// Fire-and-forget: every guard lives inside, and a scheme switch
		// should recolour the cursor without the caller knowing cursors exist.
		void this.barThemeCursorSync();
		return true;
	},

	// One body class per live theme. It no longer carries the colours — those
	// are set inline, see applyThemeVars — and is kept purely so a writer's
	// own snippet has something to target: `body.ws-theme-nord { … }` is the
	// hook for anyone who wants to push a scheme further than we do.
	applyThemeClass(this: WordSmith) {
		const body = document.body;
		if (!body || !body.classList) return;
		// ── IT WRITES ONLY WHAT CHANGED (GitHub #14) ────────────────────────
		//
		// "Plugin freezes Obsidian on enable: infinite MutationObserver loop
		// in onload()". This function used to remove and re-add the theme
		// class on EVERY call, whatever the class already was — and onload()
		// puts a MutationObserver on document.body watching `class`. So the
		// observer's callback reached here, here mutated `class`, and the
		// callback fired again: the microtask queue never drained and the app
		// hung with no error, on a fresh install, as soon as the plugin was
		// enabled. Measured in theme_probe before the fix: two IDENTICAL
		// calls produced TEN attribute records.
		//
		// A guard on the observer is the other half and is also in (see
		// `_themeObsBusy` in onload). This half is the one that matters
		// longer: a writer that does not write when nothing has changed
		// cannot sustain a loop even if the guard is ever removed — and it
		// stops the plugin spamming every OTHER observer on the page,
		// Obsidian's own included.
		//
		// `classList.toggle(name, wanted)` is NOT enough on its own: it still
		// touches the attribute in some engines when the state is unchanged.
		// Every write below is therefore asked first.
		const want = (name: string, on: boolean) => {
			const has = body.classList.contains(name);
			if (on && !has) body.classList.add(name);
			else if (!on && has) body.classList.remove(name);
		};
		const id = this.settings.barTheme;
		const wantTheme = (this.settings.barThemeEnabled !== false
			&& id && id !== 'custom') ? 'ws-theme-' + id : null;
		for (const c of Array.from(body.classList)) {
			if (c.indexOf('ws-theme-') === 0 && c !== wantTheme) {
				body.classList.remove(c);
			}
		}
		if (wantTheme) want(wantTheme, true);
		// The checkbox shape, like borderless, is a LOOK: it works under
		// Default and dies with the kill switch. One class per shape rather
		// than a data attribute, to match every other look here.
		for (const shape of ['circle', 'square', 'retro', 'markdown']) {
			want('ws-cb-' + shape,
				this.settings.barThemeEnabled !== false
				&& this.settings.barThemeCheckbox === shape);
		}
		// Borderless is a LOOK, not a scheme — like the tab experiment
		// before it, it works under Default and dies with the kill switch.
		// Unlike that experiment it is variables-first (Minimal's own
		// simplicity comes mostly from emptied dividers), with a short rule
		// block for the borders that ignore the divider variable.
		want('ws-borderless',
			this.settings.barThemeEnabled !== false && !!this.settings.barThemeBorderless);
		want('ws-marginalia', false);
		document.documentElement.style.removeProperty('--ws-marg-gutter');
		// Glass needs BOTH halves: translucent surfaces (above) and the
		// blur behind them (this class). Neither alone is the effect.
		want('ws-glass', false);
		want('ws-simpletabs', false);
	},

	// WCAG contrast between two colours parseColorRGB can read.
	// A SELECTION THE EYE CAN FIND, and text that inverts on it.
	//
	// Every scheme's `sel` is its upstream region colour, and upstream
	// chose those to sit UNDER syntax highlighting in a terminal, where
	// the surrounding chrome is dark and busy. On a quiet page they read
	// as a faint wash — the vault sent a screenshot of a light theme
	// where selected text was barely distinguishable from unselected.
	//
	// So the surface is deepened one step away from the page, and the ink
	// is whichever of the scheme's own inks now reads best on it: on a
	// light half that darkens toward the text and the ink flips pale, on
	// a dark half it deepens away from the paper. Both moves come out of
	// the scheme's OWN colours — nothing invented, and no scheme ends up
	// wearing a hue it never shipped.
	//
	// QUIET IS EXEMPT, by request and on merit: it is a monochrome scheme
	// whose whole argument is restraint, its selection already inverts,
	// and deepening a grey toward another grey is how a careful scheme
	// gets muddied.
	// WHAT SELECTED TEXT MAY BE WRITTEN IN. The scheme's own body inks
	// first, because a selection should still look like the scheme — and
	// then the two extremes, because INVERSION is the point: on a band
	// deep enough to be found, the text flips to whichever end of the
	// range reads on it. Six schemes could not be deepened at all while
	// restricted to their own two inks; allowing the flip is what lets
	// them move.
	barSelectionInks(this: WordSmith, h: { t1: string; t2: string }) {
		return [h.t1, h.t2, '#ffffff', '#000000'];
	},

	barSelectionInk(this: WordSmith, bg: string, h: WsThemeHalf) {
		const cands = this.barSelectionInks(h);
		// THE FLOOR FIRST, THE PREFERENCE SECOND. Among inks that reach
		// 4.5:1 the earliest wins — the scheme's own before the extremes,
		// so a theme ink that reads perfectly well is not passed over for
		// pure white a fraction better and every selection stops looking
		// alike. Only if NONE reaches the floor does raw contrast decide.
		//
		// Written the other way round first, as a nearness tolerance, and
		// it quietly chose a 4.27 theme ink over a 4.55 white: a
		// preference that can overrule legibility is not a preference, it
		// is a bug with a rationale.
		for (const ink of cands) {
			if (this.barContrast(ink, bg) >= 4.5) return ink;
		}
		let best = cands[0], bestC = -1;
		for (const ink of cands) {
			const c = this.barContrast(ink, bg);
			if (c > bestC) { bestC = c; best = ink; }
		}
		return best;
	},

	barDeepenSelection(this: WordSmith, hex: string, paperHex: string, inks: string[], amount?: number | null) {
		const c = parseColorRGB(hex);
		const paper = parseColorRGB(paperHex);
		if (!c || !paper) return hex;
		const hx = (v: number) => ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
		const toward = (t: number, k: number) => {
			const m = (v: number) => Math.round(v + (t - v) * k);
			return '#' + hx(m(c[0])) + hx(m(c[1])) + hx(m(c[2]));
		};
		// THE DIRECTION IS THE PAGE'S, and it is asked for rather than
		// measured: darker than upstream on a light page, lighter on a
		// dark one. Read from the PAPER, not from a lightness threshold on
		// the selection itself — which is what makes it right on Vim
		// Blue, whose LIGHT half is a navy: the writer looking at that
		// page sees a dark surface and wants the lighter band, whatever
		// the theme's slot is called.
		//
		// An earlier version measured BOTH directions and took whichever
		// kept the ink legible. That was defensible and it was not what
		// was asked for: a scheme could end up with a paler selection on a
		// pale page because its ink happened to prefer it.
		const pl = (paper[0] * 0.2126 + paper[1] * 0.7152 + paper[2] * 0.0722) / 255;
		const target = pl > 0.5 ? 0 : 255;
		// LEGIBILITY DECIDES HOW FAR, not whether. The strongest step is
		// tried first and eased back until one of the scheme's own inks
		// reads on the result at 4.5:1 — so a scheme with headroom gets
		// the full move and a scheme without gets as much as it can carry.
		// Past the gentlest step the upstream colour stands: a band nobody
		// can read on is not an improvement, however dark it is.
		const best = (bg: string) => Math.max(...(inks || []).map((i) => this.barContrast(i, bg)));
		const steps = amount != null ? [amount] : [0.26, 0.20, 0.15, 0.10, 0.06];

		for (const k of steps) {
			const cand = toward(target, k);
			if (best(cand) >= 4.5) return cand;
		}
		return hex;
	},

	barContrast(this: WordSmith, a: string, b: string) {
		const lum = (c: string) => {
			const p = parseColorRGB(c);
			if (!p) return 0;
			const f = (v: number) => {
				v /= 255;
				return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
			};
			return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);
		};
		const la = lum(a), lb = lum(b);
		return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
	},

	// Pull a colour toward the theme's own ink until it reads as TEXT.
	//
	// The c-slots are SURFACES — designed as bar-segment backgrounds, several
	// of them literally the theme's own b1/b2 — so painting a heading with
	// one straight from the table gives invisible text on half the shelf.
	// But they carry the theme's hues, which is the whole point of "colored
	// headings based off the theme". So: walk the colour toward t1 in tenths
	// and stop at the first step that clears 4.5:1 on the editor surface. A
	// colour that already reads is returned untouched; t1 itself always
	// passes (the AAA gate in theme_probe guarantees it), so the walk always
	// terminates with a usable ink that still remembers its hue.
	barThemeInkify(this: WordSmith, color: string, bg: string, ink: string) {
		for (let t = 0; t <= 10; t++) {
			const c = t === 0 ? color : mixColors(color, ink, t / 10);
			if (this.barContrast(c, bg) >= 4.5) return c;
		}
		return ink;
	},

	// The LOUD derivation: keep the slot's hue, raise the saturation, walk
	// the lightness ladder toward the readable side of the surface, and
	// return the first step that clears 4.5:1. Where a slot carries no hue
	// to keep (Quiet is s=0 everywhere, BY DESIGN — the audit that shaped
	// this function proved it), a fixedHue caller can supply one; without
	// it the honest answer is the plain inkified slot, because inventing a
	// hue for a scheme built on having none would be repainting it.
	barThemeVivify(this: WordSmith, color: string, bg: string, ink: string, fixedHue?: number) {
		const src = colorToHsl(color);
		if (!src) return this.barThemeInkify(color, bg, ink);
		let hue = src.h, sat = Math.max(src.s, 0.8);
		if (src.s < 0.15) {
			if (fixedHue == null) return this.barThemeInkify(color, bg, ink);
			hue = fixedHue; sat = 0.8;
		}
		const darkBg = this.barContrast('#ffffff', bg) > this.barContrast('#000000', bg);
		const ladder = darkBg
			? [0.72, 0.66, 0.78, 0.60, 0.84, 0.55, 0.88]
			: [0.34, 0.40, 0.30, 0.46, 0.26, 0.50, 0.22];
		for (const l of ladder) {
			const c = hslToHex(hue, sat, l);
			if (this.barContrast(c, bg) >= 4.5) return c;
		}
		return this.barThemeInkify(color, bg, ink);
	},

	// The surface for a SELECTED ROW IN A LIST — the command palette, the
	// quick switcher, any suggester — measured against the surface it sits
	// on rather than assumed to be visible on it.
	//
	// The vault sent a screenshot of the palette where the selected row
	// was all but invisible: it reads --background-modifier-hover, which
	// is one ramp step from the modal it sits on, and one step is exactly
	// what a hover should be and exactly what a selection should not.
	//
	// Candidates in preference order, first one that clears BOTH tests:
	// distinct enough from the surface behind it to be seen (1.6:1, about
	// where a band stops reading as a rendering artefact), and able to
	// carry an ink at 4.5:1. `sel` leads because a highlighted row IS a
	// selection and the scheme already says what its selections look like.
	// If nothing qualifies, the most distinct candidate wins: a legible
	// row that is hard to see is worse than a visible one, because the
	// writer is looking for WHICH row, not for what it says.
	barThemeHighlight(this: WordSmith, h: WsThemeHalf, surface: string) {
		const inkFor = (bg: string) =>
			(this.barContrast(h.t1, bg) >= this.barContrast(h.t2, bg)) ? h.t1 : h.t2;
		const ok = (bg: string) => this.barContrast(bg, surface) >= 1.6
			&& this.barContrast(inkFor(bg), bg) >= 4.5;
		let best = h.sel, bestSeen = -1;
		for (const bg of [h.sel, h.c1, h.b4, h.b3]) {
			const seen = this.barContrast(bg, surface);
			if (seen > bestSeen) { bestSeen = seen; best = bg; }
			if (ok(bg)) return { bg: bg, ink: inkFor(bg) };
		}
		// No slot in the table clears both bars on every scheme — Solarized
		// Light's surfaces sit too close together to be told apart, and
		// Kanagawa Lotus's cannot carry an ink once they are. So the
		// highlight is DERIVED instead: walk the popup surface toward the
		// body ink until the band is both visible and legible. The scheme's
		// own colours are preferred and this only runs when they cannot do
		// the job, which is the same order of preference the rest of the
		// engine uses — table first, derivation second.
		// The walk runs all the way to the ink itself. On a light scheme the
		// two tests fight in the middle — the band darkens faster than the
		// pale ink can carry it — and the window only reopens further along,
		// where the OPPOSITE ink takes over and the row becomes a proper
		// inversion. Stopping at the midpoint, as the first draft did, left
		// Catppuccin Latte and Kanagawa Lotus with a band that was visible
		// or legible but never both.
		for (let k = 0.12; k <= 1.0001; k += 0.06) {
			const bg = mixColors(surface, h.t1, k);
			if (ok(bg)) return { bg: bg, ink: inkFor(bg) };
		}
		return { bg: best, ink: inkFor(best) };
	},

	// THE CURSOR'S INK, and it is deliberately NOT barThemeVividFor.
	//
	// That function answers "the loudest hue this half owns", and its
	// red-first rule made the cursor red on nearly every dark scheme,
	// because c7 is the table's red BY CONVENTION everywhere. The vault
	// saw twenty schemes wearing one colour and said so. The cursor now
	// takes THE SAME INK AS AN H1 — the scheme's accent, t4 — which is
	// what a scheme means by "this is mine": Vim Darkblue's yellow,
	// Nord's frost blue, Everforest's green, One Dark's blue.
	//
	// Vivified only when the raw accent cannot read on the editor
	// surface, so a scheme whose accent already reads keeps its exact
	// upstream colour rather than a saturated approximation of it.
	//
	// The reversal is on the record: an earlier release made this red on
	// purpose, for Modus Tinted's "blood red" — that ask was really about
	// SELECTION, which now carries each scheme's own `sel` surface and
	// gives Modus Tinted its dark grey. The loud-red rule outlived its
	// reason, and its cost was every other scheme.
	barThemeCursorInk(this: WordSmith, h: WsThemeHalf) {
		// A scheme may NAME its cursor, and several do: the Modus family
		// publishes a `cursor` mapping that is deliberately not accent-0 —
		// Operandi Tinted's is red-intense while its accent is red-cooler,
		// Vivendi's is plain fg-main. Deriving from the accent got the
		// family's own answer wrong on six halves of eight.
		const named = h.cur || h.t4;
		if (this.barContrast(named, h.b1) >= 4.5) return named;
		return this.barThemeVivify(named, h.b1, h.t1);
	},

	// The most colourful readable ink a half can offer — the cursor's
	// colour, selection's colour, bold's colour. Every accent slot and the
	// accent proper are vivified, then judged by SATURATION with contrast
	// as the tie-break: on Modus Tinted that contest is won by c7 and the
	// answer is the blood red, not the polite blue t4 would have given. On
	// Quiet every candidate comes back grey, and grey wins — the correct
	// answer for Quiet.
	barThemeVividFor(this: WordSmith, h: WsThemeHalf) {
		// "Loudest", third definition, and this one is honest about why:
		// max-saturation TIED on the all-saturated Modus tables and the
		// tiebreak picked green; farthest-hue-from-family crowned YELLOW,
		// because yellow is blue's complement — mathematically the pop,
		// and not what any eye calls loud. Two facts settle it. RED is the
		// eye's loudest hue — it is what warning lights are — and c7 is
		// this table's red BY CONVENTION on every scheme (the Vim Replace
		// mode already leans on that). So: the scheme's own red, vivified,
		// wins when it exists; otherwise the saturated candidate farthest
		// in hue from the scheme's family; on Quiet nothing qualifies and
		// grey wins, which is the correct answer for Quiet.
		//
		// The family hue is gated on CHROMA (max-min), not HSL saturation:
		// near-white paper computes a meaningless s≈0.5 and hijacked the
		// reference until it was.
		const sred = this.barThemeVivify(h.c7, h.b1, h.t1);
		const rh = colorToHsl(sred);
		if (rh && rh.s >= 0.45 && (rh.h >= 320 || rh.h <= 25)) return sred;

		const chroma = (str: string) => {
			const p = parseColorRGB(str);
			return p ? (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2])) / 255 : 0;
		};
		const bH = colorToHsl(h.b1), aH = colorToHsl(h.t4);
		const ref = (bH && chroma(h.b1) >= 0.12) ? bH.h
			: ((aH && chroma(h.t4) >= 0.12) ? aH.h : null);
		const dist = (x: number, y: number) => {
			const d = Math.abs(x - y) % 360;
			return d > 180 ? 360 - d : d;
		};
		let best = null, bestScore = -1;
		let grey = null, greyScore = -1;
		for (const k of ['c1', 'c4', 'c5', 'c6', 'c7', 't4']) {
			const c = this.barThemeVivify(h[k], h.b1, h.t1);
			const hs = colorToHsl(c);
			const sat = hs ? hs.s : 0;
			if (hs && sat >= 0.45 && ref != null) {
				const score = dist(hs.h, ref) + sat;
				if (score > bestScore) { bestScore = score; best = c; }
			}
			const gs = sat + this.barContrast(c, h.b1) / 1000;
			if (gs > greyScore) { greyScore = gs; grey = c; }
		}
		return best || grey || h.t4;
	},

	// THE MODE-SWITCH BUG's fix. Obsidian fires 'css-change' when the
	// theme, a snippet, or the light/dark MODE changes — and none of the
	// events the refresh pass listens to fires for that last one, which is
	// how a writer could flip Appearance and keep the dark half of their
	// scheme on a light workspace. Restamp the class and the variables.
	// The cursor bridge is deliberately NOT resynced here: both halves are
	// already written into Cursor-Smith and it follows the mode by itself —
	// writing another plugin's disk on a mode flip would be sync-on-time,
	// not sync-on-intent.
	// Flip Obsidian's own light/dark mode. `changeTheme` is the app's
	// method and 'obsidian'/'moonstone' are its two mode names — dark and
	// light, in that order, which is worth writing down because neither
	// name says so. The vault config path is a fallback for a build that
	// does not expose the method: it stores the same value and then needs
	// the css-change nudge the method fires for itself.
	//
	// Nothing here touches the SCHEME. Flipping the mode makes the app
	// fire css-change, and the handler below swaps the half — one path,
	// whether the writer flips from our row or from Appearance.
	barSetColorMode(this: WordSmith, dark: boolean) {
		const name = dark ? 'obsidian' : 'moonstone';
		try {
			if (typeof this.app.changeTheme === 'function') {
				this.app.changeTheme(name);
				return true;
			}
			if (this.app.vault && this.app.vault.setConfig) {
				this.app.vault.setConfig('theme', name);
				if (this.app.workspace && this.app.workspace.trigger) {
					this.app.workspace.trigger('css-change');
				}
				return true;
			}
		} catch (_) { wsCatch('barSetColorMode: if (typeof this.app.changeTheme === \'function\')', _); }
		return false;
	},


	// HOW TRANSPARENT THIS SCHEME CAN AFFORD TO BE.
	//
	// A flat alpha cannot serve both ends of the shelf: Modus reads at 21:1
	// and could go to a third opacity without trouble, while Everforest
	// Light reads at 5.16 and loses the floor at 0.92. One number for both
	// is either unreadable on one or barely frosted on the other, and the
	// first cut of this feature picked the second and still failed the
	// worst case.
	//
	// So it is derived, per scheme, per half: walk from the most
	// transparent step upward and take the FIRST that keeps body text at
	// 4.5:1 with pure black behind the window AND with pure white — the two
	// extremes any desktop can put there. A scheme with headroom spends it
	// on the effect; a scheme without it keeps its legibility. Neither is a
	// number chosen by eye.

	// REPAY THE GLASS BORROW, once, and never borrow again. Glass is gone
	// (see DEFAULT_SETTINGS); vaults that ran it may
	// still have Obsidian's `translucency` switched on by us, with the
	// original value sitting in the stash. This gives it back on the next
	// load and spends the stash, so the debt is settled exactly once and
	// the code can be deleted the release after this one.
	barThemeGlassRepay(this: WordSmith) {
		if (this.settings.barThemeGlassStash === null
			|| this.settings.barThemeGlassStash === undefined) return false;
		try {
			const vault = this.app && this.app.vault;
			if (vault && vault.setConfig) {
				vault.setConfig('translucency', !!this.settings.barThemeGlassStash);
			}
		} catch (_) { wsCatch('barThemeGlassRepay: const vault = this.app && this.app.vault;', _); }
		this.settings.barThemeGlassStash = null;
		return true;
	},

	// THE THEME RE-ASSERTS ITSELF.
	//
	// A scheme lives as inline custom properties on body, which is what
	// makes it beat every stylesheet in the cascade — and also what makes
	// it fragile in exactly one way: anything that rewrites body's style
	// attribute, or replaces body outright, takes the whole scheme with
	// it and leaves no error behind. On desktop nothing does. On MOBILE
	// the app container is rebuilt when Obsidian resumes from the
	// background, and the vault saw the consequence precisely: the colours
	// flash on, then the workspace comes back wearing nothing.
	//
	// So the theme is watched and restored rather than written once and
	// hoped for. Cheap, because it only acts when a key it owns has
	// actually gone missing: the observer fires often and this returns
	// immediately almost every time.
	//
	// Guarded against its own writes — applying sets body.style, which
	// re-enters the observer — by a re-entrancy flag rather than by
	// disconnecting, so a strip that lands DURING a repaint is still
	// caught on the next tick.
	barThemeGuard(this: WordSmith) {
		if (this._themeGuarding) return false;
		if (!this.settings || this.settings.barThemeEnabled === false) return false;
		const id = this.settings.barTheme;
		if (!id || id === 'custom') return false;
		const keys = this._themeVarKeys || [];
		if (!keys.length) return false;
		let missing = false;
		try {
			for (const k of keys) {
				if (!document.body.style.getPropertyValue(k)) { missing = true; break; }
			}
			// The class hook is part of the dress; a snippet keyed on it
			// would go quiet without this.
			if (!missing && !document.body.classList.contains('ws-theme-' + id)) missing = true;
		} catch { return false; }
		if (!missing) return false;
		this._themeGuarding = true;
		try {
			this.applyThemeClass();
			this.applyThemeVars();
		} catch (_) { wsCatch('barThemeGuard: this.applyThemeClass();', _); }
		this._themeGuarding = false;
		return true;
	},

	// TAKE THE THEME OFF THE WORKSPACE, without forgetting it.
	//
	// The plugin's own master switch and its unload path both tear down
	// everything Word-Smith put on the page, and the theme was the one
	// thing that survived them: the chrome janitor they call is
	// DELIBERATELY exempted from theme variables — that exemption is what
	// keeps a theme alive through the refresh pass — so the sweep that
	// clears everything else steps around this on purpose. A disabled
	// plugin left the whole workspace wearing a scheme, with the settings
	// that would have removed it now unreachable.
	//
	// Settings are untouched: this is undressing, not forgetting, and
	// re-enabling repaints from applyBodyClasses as it always did.
	barThemeUndress(this: WordSmith) {
		try {
			const body = document.body.style;
			for (const k of (this._themeVarKeys || [])) body.removeProperty(k);
			// …and everything a theme COULD have set, for the same reason
			// applyThemeVars sweeps the universe on the way down: this runs
			// at unload and from the master switch, and at both of those
			// moments the remembered list may be empty while the body is
			// still wearing a scheme from a previous load.
			for (const k of this.themeVarUniverse()) body.removeProperty(k);
			this._themeVarKeys = [];
			for (const cls of Array.from(document.body.classList)) {
				if (cls.indexOf('ws-theme-') === 0) document.body.classList.remove(cls);
			}
			document.body.classList.remove('ws-borderless', 'ws-glass', 'ws-simpletabs');
			for (const shape of ['circle', 'square', 'retro', 'pill']) {
				document.body.classList.remove('ws-cb-' + shape);
			}
		} catch (_) { wsCatch('barThemeUndress: const body = document.body.style;', _); }
		// And the caret, which lives in another plugin and would otherwise
		// keep our colours after ours is gone.
		try { void this.barThemeCursorSync('undress'); } catch (_) { wsCatch('barThemeUndress: this.barThemeCursorSync(\'undress\');', _); }
	},

	barThemeOnCssChange(this: WordSmith) {
		this.applyThemeClass();
		this.applyThemeVars();
		// AND THE BAR, which is not optional and used to be missing.
		//
		// The bar's own colours are RESOLVED, not inherited: `--ws-bg` holds
		// a concrete rgb() that applyCssVariables worked out by reading the
		// theme's surfaces, and every powerline segment is painted from a
		// value read the same way (a var() would not survive an SVG fill).
		// So restamping the theme's variables above changes nothing the bar
		// is already wearing — it keeps the old half's colours until some
		// unrelated repaint happens by.
		//
		// Which is exactly what the vault saw: flipping the mode from the
		// MENU left the bar on the old colours until a click elsewhere,
		// while flipping it from the command palette looked instant — not
		// because that path was different, but because dismissing the
		// palette hands focus back to the editor and the events that follow
		// repaint the bar by accident. A fix that depends on the writer
		// clicking somewhere is not a fix.
		//
		// Twice, and deliberately: once now, and once on the next frame,
		// because Obsidian swaps its own theme class around this event and
		// a read taken too early resolves against the half that is leaving.
		const repaint = () => {
			try {
				this.applyCssVariables();
				this.updateRetroStatusBar();
			} catch (_) { wsCatch('barThemeOnCssChange / repaint: this.applyCssVariables();', _); }
		};
		repaint();
		try { window.requestAnimationFrame(repaint); } catch (_) { wsCatch('barThemeOnCssChange: window.requestAnimationFrame(repaint);', _); }
		// The panel too: it shows the same rows, and a mode flipped from
		// anywhere must read the same in both surfaces.
		this.refreshMenuPanels();
	},

	// The variables a theme sets, as a plain map, or null for none.
	//
	// THE HALF follows the app's light/dark mode, which is what makes a theme
	// a pair rather than two entries.
	barThemeVars(this: WordSmith) {
		// The kill switch: stood down means NOTHING is emitted, which through
		// applyThemeVars also strips whatever was set before — off is off.
		if (this.settings.barThemeEnabled === false) return null;
		const id = this.settings.barTheme;
		if (!id || id === 'custom') return null;
		const theme = this.barThemeById(id);
		if (!theme) return null;
		const h = this.barThemeHalf(theme);
		if (!h) return null;
		const st = this.settings;
		// One wash, or the whole ramp. SIMPLIFIED collapses every chrome
		// surface to the editor's own colour — the look this feature shipped
		// with, kept as a choice — while off (the default), each surface
		// takes its own step: editor b1, sidebars and ribbon b2, raised
		// panels b3, borders b4. The ink and accent sets are identical in
		// both; only the surfaces move.
		const simp = !!st.barThemeSimplified;
		const S2 = simp ? h.b1 : h.b2;
		const S3 = simp ? h.b2 : h.b3;
		const ink = (c: string) => this.barThemeInkify(c, h.b1, h.t1);
		// The loudest readable ink this half owns — the cursor's colour,
		// selection's colour, bold's colour. One derivation, used everywhere
		// loudness is the point.
		const viv = this.barThemeVividFor(h);
		// Pick an ink by measurement rather than by assumption.
		const inkFor = (bg: string) =>
			(this.barContrast(h.t1, bg) >= this.barContrast(h.t2, bg)) ? h.t1 : h.t2;
		const navBg = (this.barContrast(inkFor(h.c1), h.c1) >= 4.5) ? h.c1 : h.sel;
		// The selection, deepened away from the page so it is visible on a
		// quiet one — QUIET ITSELF EXEMPTED, by request and on merit: a
		// monochrome scheme whose selection already inverts gains nothing
		// from a grey pushed toward another grey.
		const selBg = (this.settings.barTheme === 'quiet')
			? h.sel
			: this.barDeepenSelection(h.sel, h.b1, this.barSelectionInks(h));
		const navInk = inkFor(navBg);
		// Measured against the popup surface, which is what a palette row
		// actually sits on.
		const darkPaper = this.barContrast('#ffffff', h.b1)
			> this.barContrast('#000000', h.b1);
		const hi = this.barThemeHighlight(h, S2);
		// THE ZEN MATCH RIDES THE SAME INLINE DECLARATION. These variables
		// are written inline on body (applyThemeVars), and an inline custom
		// property beats every stylesheet rule — including styles.css's own
		// `body.ws-titlebar-match { --titlebar-background: ... }`. So with a
		// rich palette on, zen re-pointed the titlebar through a rule that
		// could never win the cascade, and the strip kept the theme's chrome
		// step: the grey plate. The Simplified toggle only LOOKED like a fix
		// because it moves this same inline value to b1. The palette now
		// yields to zen directly: when the writer asked the titlebar to
		// match the page, the page's surface is what goes inline. Guarded,
		// because barThemeVars is also driven bare in the probes where
		// zenActive's collaborators do not exist.
		let zenTb = false;
		try { zenTb = !!(this.zenActive() && this.settings.zenTitlebarMatch); }
		catch { zenTb = false; }
		const tbBg = (simp || zenTb) ? h.b1 : h.b2;
		// THE WASH BEATS THE NAMED COLOUR. A scheme's own mode-line strip is
		// right by default and wrong under Simplified, which exists to make
		// every surface one colour — a scheme that kept its cyan bar
		// through the wash would be the one thing still arguing.
		const barBg = simp ? S2 : (h.bar || h.b3);
		// The muted ink when it reads there — a status line is quiet by
		// nature — then the scheme's own inks, then PURE black or white.
		// The pure step is not decoration: PaperColor's dark bar is a
		// saturated teal that carries none of its scheme's softened inks
		// (4.30 at best) and carries black at 5.30. Softened inks belong on
		// a scheme's own surfaces; on a saturated strip, legibility
		// outranks the softening — the same rule --text-on-accent already
		// follows, for the same reason.
		const barInk = this.barContrast(h.t3, barBg) >= 4.5
			? h.t3
			: [h.t1, h.t2, '#000000', '#ffffff'].reduce((best, c) =>
				this.barContrast(c, barBg) > this.barContrast(best, barBg) ? c : best);
		const onAccent = ['#000000', '#ffffff', h.t1, h.t2]
			.reduce((best, c) =>
				this.barContrast(c, h.t4) > this.barContrast(best, h.t4) ? c : best);

		const v: Record<string, string> = {
			// The named surfaces, which is what most of Obsidian reads.
			'--background-primary':              h.b1,
			'--background-primary-alt':          S2,
			'--background-secondary':            S2,
			'--background-secondary-alt':        S3,
			'--background-modifier-border':      h.b4,
			'--background-modifier-border-hover': h.b4,
			// (--background-modifier-hover is set once, in the interactive
			// block below. It was declared HERE too, and the two lines sat
			// 60 apart in one object literal where the last one silently
			// wins — a duplicate key is not an error, it is a trap for
			// whoever edits the first one and sees nothing change.)
			'--background-modifier-active-hover': h.b4,
			'--background-modifier-form-field':  h.b2,
			'--text-normal':                     h.t1,
			'--text-muted':                      h.t3,
			'--text-faint':                      h.t3,
			// Minimal paints the active nav row with --interactive-accent
			// and --text-on-accent, so that pair is measured too. The
			// candidates here include PURE black and white, which the
			// scheme's own inks do not cover: seven light halves carry a
			// mid-tone upstream accent (Nord's #5e81ac, Solarized's
			// #268bd2) where the softened t1/t2 both stall near 3.5:1 and
			// pure ink clears 4.9:1 at worst. Softened inks are right on a
			// scheme's own surfaces, where they belong; on a saturated
			// accent, legibility outranks the softening.
			'--text-on-accent':                  onAccent,
			'--text-accent':                     h.t4,
			'--text-accent-hover':               h.t4,
			'--interactive-accent':              h.t4,
			'--interactive-accent-hover':        h.c1,
			'--interactive-normal':              S2,
			'--interactive-hover':               S3,
			// The bar's own ink and edge — a themed surface under unthemed
			// grey text read as half a job.
			// The status line, which several schemes give a surface of its
			// own — Vim's blue pair paints it cyan, and a scheme that says
			// so should be obeyed rather than averaged into the ramp. The
			// slot is OPTIONAL: without it the bar sits on the chrome
			// surface exactly as before, which is what nineteen of the
			// twenty-five do. The ink is measured, never assumed.
			// A named mode-line colour wins; otherwise the strip takes its
			// OWN step of the ramp rather than the sidebar's, so it reads
			// as a bar instead of as the bottom of a sidebar. Under the
			// simplified wash it stays flush, because that is what that
			// toggle means.
			'--status-bar-background':           barBg,
			'--status-bar-text-color':           barInk,
			'--status-bar-border-color':         h.bar || h.b4,
			// The powerline's optional top/bottom rule lines, THROUGH the
			// fallback chain in the bar's own resolution: a writer's chosen
			// colour still wins; this only answers when nothing was chosen.
			'--ws-bar-rule-accent':              h.t4,
			// The plugin's own popups ride Obsidian's modal chrome, so the
			// modal chrome follows the scheme: elevated one step when rich,
			// flush with the editor when simplified.
			'--modal-background':                S2,
			'--prompt-background':               S2,
			// The selected row inside those popups. Its own variables,
			// because the one Obsidian uses for it (--background-modifier-
			// hover) is shared with every hover in the app, and a hover
			// loud enough to find a row in a list would be a shout
			// everywhere else.
			// The hint native controls read: scrollbars, form fields, the
			// caret in a text input. Derived from the PAPER, so a dark
			// half worn in light mode still gets dark chrome instead of a
			// white scrollbar down the side of a navy note.
			'color-scheme':                      darkPaper ? 'dark' : 'light',
			'--ws-selected-bg':                  hi.bg,
			'--ws-selected-ink':                 hi.ink,
			'--titlebar-background':             tbBg,
			'--titlebar-background-focused':     tbBg,
			'--ribbon-background':               simp ? h.b1 : h.b2,
			// RECHECKED against Minimal's own source: its flat header is
			// the titlebar and TAB CONTAINER riding the bg ladder — which
			// our Minimal-token layer covered under Minimal and nothing
			// covered under stock Obsidian, where the header row kept the
			// default theme's own colour. Set it ourselves, both modes.
			'--tab-container-background':        simp ? h.b1 : h.b2,
			// Dividers are STRUCTURE and belong to the borders toggle, not
			// to this one. Simplified painted them out for a release —
			// asked for before the two features were distinct — which made
			// one toggle silently do the other's job and left no way to
			// have a flat wash WITH borders. One control, one effect:
			// surfaces here, dividers under Hide workspace borders.
			'--divider-color':                   h.b4,
			'--scrollbar-thumb-bg':              h.b4,

			// WHERE THE EYE IS. Hover, the selected file, text selection and
			// the focus outline are the states a writer actually watches, and
			// a scheme that recolours the walls but not these reads as a
			// coat of paint over somebody else's furniture. The selected nav
			// item takes c1 — the theme's first accent SURFACE, designed to
			// carry t1 — so "which file am I in" is answered in the scheme's
			// own voice rather than Obsidian's purple.
			'--background-modifier-hover':       S3,
			'--nav-item-background-hover':       S3,
			// THE SELECTED FILE. Both halves of this pair were assumed and
			// both were wrong on real schemes: c1 is not always a surface
			// (One Dark's c1 IS its accent blue) and t1 is not always the
			// ink that reads on it (grey on that blue measures under 2:1 —
			// the vault sent a screenshot). So the surface is c1 only when
			// some ink reaches 4.5:1 on it, else the scheme's own selection
			// surface; and the ink is whichever of t1/t2 measures better.
			'--nav-item-background-active':      navBg,
			'--nav-item-color-active':           navInk,
			// SELECTION is the scheme's OWN surface now — the vault saw the
			// vivid ground on Modus Tinted and asked for the upstream dark
			// grey instead, and the generalisation holds for every scheme:
			// each table half carries `sel`, its upstream region/visual
			// colour (adapted where upstream shipped no light half). The
			// ink is not assumed but MEASURED: t1 when it reads on sel, t2
			// when it reads better — which is how the requested
			// dark-grey-on-light selection gets light text without a
			// special case anywhere.
			//
			// DEEPENED, and the ink re-measured against the result — see
			// barDeepenSelection. Quiet keeps its own, which already
			// inverts and whose whole argument is restraint.
			'--text-selection':                  selBg,
			'--ws-selection-bg':                 selBg,
			'--ws-selection-ink':
				(this.settings.barTheme === 'quiet')
					? ((this.barContrast(h.t1, selBg) >= 4.5
						|| this.barContrast(h.t1, selBg) >= this.barContrast(h.t2, selBg))
						? h.t1 : h.t2)
					: this.barSelectionInk(selBg, h),
			'--text-highlight-bg':               h.c5,
			'--background-modifier-border-focus': h.t4,
			'--list-marker-color':               h.t3,
			// THE BASE RAMP, and this is the half that was missing.
			//
			// Modern Obsidian derives the named surfaces above from a
			// numbered token ladder — --background-primary is literally
			// var(--color-base-00) — and a great deal of chrome reads the
			// TOKENS rather than the names. Setting only the names recolours
			// the editor and leaves ribbons, tabs, popovers and scrollbars on
			// whatever the underlying theme wanted, which reads as "the theme
			// half-applied" or, on a theme that reads tokens throughout, as
			// "nothing happened".
			// Every step Obsidian defines, including the ones nothing here
			// reads: a step we skip keeps the value the APP's mode gave it,
			// and on a scheme whose paper disagrees with that mode — Vim
			// Blue by day — a skipped step is a light-mode colour sitting
			// in the middle of a dark ramp, reached by whichever theme rule
			// happens to want it.
			'--color-base-00': h.b1,
			'--color-base-05': h.b1,
			'--color-base-15': S2,
			'--color-base-10': S2,
			'--color-base-20': S2,
			'--color-base-25': S3,
			'--color-base-30': h.b4,
			'--color-base-35': h.b4,
			'--color-base-40': h.b4,
			'--color-base-45': h.t3,
			'--color-base-50': h.t3,
			'--color-base-55': h.t3,
			'--color-base-60': h.t3,
			'--color-base-65': h.t1,
			'--color-base-70': h.t1,
			'--color-base-80': h.t1,
			'--color-base-90': h.t1,
			'--color-base-100': h.t1,
			'--color-accent':   h.t4,
			'--color-accent-1': h.t4,
			'--color-accent-2': h.c1,

			// MINIMAL'S TOKEN LAYER, and the reason this list has three of
			// them. Minimal defines no --color-base-* at all; it has its own
			// ladder — bg1-bg3, ui1-ui3, tx1-tx4, ax1-ax3 — and then maps
			// roughly two hundred Obsidian variables onto it
			// (`--background-primary: var(--bg1)`, `--divider-color:
			// var(--ui1)`, `--ribbon-background: var(--bg1)`, and so on).
			//
			// Setting only the named variables therefore recolours the ones
			// we happened to list and leaves the ribbon, the nav items, the
			// tables and the popovers on Minimal's own colours — which reads
			// as a theme that half-applied. Setting the TOKENS instead makes
			// all two hundred follow at once, because that is precisely the
			// seam Minimal's own colour schemes use.
			//
			// Harmless on any other theme: a custom property nobody reads
			// costs nothing. This is the cheapest possible way to support the
			// look most of these writers are actually running.
			'--bg1': h.b1,
			'--bg2': S2,
			'--bg3': S3,
			'--ui1': h.b4,
			'--ui2': h.b4,
			'--ui3': h.t3,
			'--tx1': h.t1,
			'--tx2': h.t3,
			'--tx3': h.t3,
			'--tx4': h.t4,
			'--ax1': h.c1,
			'--ax2': h.t4,
			'--ax3': h.t4,
			'--sp1': h.b1,
			'--mono0': h.b1
		};
		// ── The flags ───────────────────────────────────────────────────
		// THE SCHEME DOES NOT PAINT THEM. They are named, shaped and coloured
		// by the writer in Settings, and a colour a writer chose beats a colour
		// a theme guessed. The scheme dresses the caret, the headings and the
		// bar; not the manuscript's own states.

		// ── Headings, opt-in ────────────────────────────────────────────
		// Six inks derived from the scheme's own accents through
		// barThemeInkify — the c-slots are surfaces and would be invisible
		// used raw (see the helper). h1 gets the accent proper; h6 the muted
		// ink, because by the sixth level a heading is a whisper.
		if (st.barThemeHeadings) {
			v['--h1-color'] = h.t4;
			v['--h2-color'] = ink(h.c7);
			v['--h3-color'] = ink(h.c4);
			v['--h4-color'] = ink(h.c5);
			v['--h5-color'] = ink(h.c6);
			v['--h6-color'] = h.t3;
		}

		// ── Code, opt-in ────────────────────────────────────────────────
		// The block sits on the ramp's second step so it reads as a PANEL in
		// the page, and the syntax inks are the same inkified accents the
		// headings use — one derivation, one voice.
		if (st.barThemeCode) {
			v['--code-background']  = S2;
			v['--code-normal']      = h.t1;
			v['--code-comment']     = h.t3;
			v['--code-punctuation'] = h.t3;
			v['--code-operator']    = h.t3;
			v['--code-function']    = h.t4;
			v['--code-keyword']     = ink(h.c7);
			v['--code-tag']         = ink(h.c7);
			v['--code-important']   = ink(h.c7);
			v['--code-string']      = ink(h.c4);
			v['--code-value']       = ink(h.c5);
			v['--code-property']    = ink(h.c6);
		}

		// ── Markdown, opt-in ─────────────────────────────────────────────
		// Bold takes the vivid ink — bold IS loudness — while italic, links,
		// tags and structure take vivified accents so they carry hue without
		// shouting over the emphasis. Off means absent, same as the others.
		if (st.barThemeMarkdown) {
			v['--bold-color']             = viv;
			v['--italic-color']           = this.barThemeVivify(h.c6, h.b1, h.t1);
			v['--link-color']             = h.t4;
			v['--link-color-hover']       = viv;
			v['--link-external-color']    = this.barThemeVivify(h.c4, h.b1, h.t1);
			v['--link-unresolved-color']  = h.t3;
			v['--tag-color']              = this.barThemeVivify(h.c5, h.b1, h.t1);
			v['--tag-background']         = S3;
			v['--blockquote-border-color'] = h.t4;
			v['--hr-color']               = h.b4;
			v['--checklist-done-color']   = h.t3;
		}

		const out: Record<string, string> = {};
		// Only real colours reach the DOM — #hex from the table, or the
		// rgb() strings mixColors produces for inkified accents. A slot a
		// theme forgot must drop out rather than arrive as "undefined",
		// which is the failure that takes a whole workspace to unstyled and
		// looks like the plugin broke.
		for (const k of Object.keys(v)) {
			// Colours, the rgb() strings mixColors produces, and now WIDTHS
			// — the simplified dividers ride two px variables, and a filter
			// built for colours was silently dropping them, which is this
			// filter's whole failure mode pointed at itself.
			if (typeof v[k] === 'string'
				&& (/^#[0-9a-f]{3,8}$/i.test(v[k])
					|| /^rgb\(\d+, \d+, \d+\)$/.test(v[k])
					|| /^\d+(\.\d+)?px$/.test(v[k])
					// color-scheme is a keyword, not a colour, and the
					// filter that exists to keep `undefined` off the body
					// would have dropped it silently.
					|| v[k] === 'dark' || v[k] === 'light')) {
				out[k] = v[k];
			}
		}
		return Object.keys(out).length ? out : null;
	},

	// Set INLINE on body, not as an injected stylesheet rule.
	//
	// This is the fix for "the themes still don't work", and the mechanism is
	// the whole story. The block was being emitted correctly and the class
	// was on the body — verified — and it still lost, because
	// `body.ws-theme-nord` scores exactly the same specificity as the
	// `body.theme-dark` selector every community theme writes its variables
	// on. A tie is decided by SOURCE ORDER, and a theme's stylesheet is
	// re-injected by Obsidian whenever it changes, which puts it after ours
	// often enough to look like the feature simply does not work.
	//
	// An inline property on the element beats every stylesheet rule that is
	// not !important, from any source, in any order. It also needs no class
	// and no injected block, so there is one mechanism instead of three.
	// applyCssVariables next door has done exactly this since the beginning;
	// the injected-stylesheet route was the novel choice and it was the
	// wrong one.
	// EVERY VARIABLE ANY THEME CAN SET, computed once from a real scheme
	// with all three opt-ins forced on — the widest map this code can
	// produce. It is derived rather than listed because a list would have to
	// be edited every time a slot is added, and the day it is not is the day
	// a stand-down starts leaving one colour behind.
	themeVarUniverse(this: WordSmith) {
		if (this._themeVarUniverse) return this._themeVarUniverse;
		let keys: string[] = [];
		try {
			const shelf = this.barThemeShelf();
			const first = (shelf && shelf[0]) || this.barThemeById('nord');
			if (first) {
				const st = this.settings;
				// Borrowed for one call: the map is built from `this.settings`,
				// and the widest one needs every opt-in on and the switch off
				// its own guard.
				this.settings = Object.assign({}, st, {
					barThemeEnabled: true, barTheme: first.id,
					barThemeHeadings: true, barThemeCode: true, barThemeMarkdown: true
				});
				const v = this.barThemeVars();
				this.settings = st;
				if (v) keys = Object.keys(v);
			}
		} catch { keys = []; }
		this._themeVarUniverse = keys;
		return keys;
	},

	applyThemeVars(this: WordSmith) {
		const body = document.body;
		if (!body || !body.style) return;
		const vars = this.barThemeVars();
		// Whatever was set last time comes off first, or switching from a
		// theme that defines a slot to one that does not would leave the old
		// colour behind — a bar wearing two schemes at once.
		const prev = this._themeVarKeys || [];
		for (const k of prev) body.style.removeProperty(k);
		this._themeVarKeys = [];
		if (!vars) {
			// STANDING DOWN TAKES OFF EVERYTHING A THEME COULD HAVE PUT ON,
			// not only what THIS session put on. `_themeVarKeys` is memory,
			// and memory starts empty every time the plugin loads — so a
			// document that still carries a scheme from before the load
			// (Obsidian resuming from the background on mobile, a plugin
			// reload or update on desktop, an unload that never reached its
			// undress) was swept with an empty list and kept the colours.
			//
			// That is the vault report: switch themes off, quit, come back,
			// and the scheme is on again with the switch still off. Nothing
			// re-applied it — nothing ever took it off, and the one pass
			// that would have was asking a variable that had just been
			// initialised to nothing.
			//
			// Only on the way DOWN. Removing the universe on every apply
			// would also strip a colour another plugin had set inline under
			// the same standard name; here we are taking our own dress off,
			// and anything of ours still on the body has no other owner.
			for (const k of this.themeVarUniverse()) body.style.removeProperty(k);
			return;
		}
		for (const k of Object.keys(vars)) {
			body.style.setProperty(k, vars[k]);
			this._themeVarKeys.push(k);
		}
	},

	// A readable ink at a GIVEN hue: the vivify ladder without a source
	// colour, for the collision resolver below, which deals in hues.
	barThemeHueInk(this: WordSmith, hue: number, h: { b1: string; t1: string }) {
		const hh = ((hue % 360) + 360) % 360;
		const darkBg = this.barContrast('#ffffff', h.b1) > this.barContrast('#000000', h.b1);
		const ladder = darkBg
			? [0.72, 0.66, 0.78, 0.60, 0.84, 0.55, 0.88]
			: [0.34, 0.40, 0.30, 0.46, 0.26, 0.50, 0.22];
		for (const l of ladder) {
			const c = hslToHex(hh, 0.85, l);
			if (this.barContrast(c, h.b1) >= 4.5) return c;
		}
		return h.t1;
	},

	// The five Vim inks for one half, with two guarantees the first design
	// lacked, both vault reports:
	//
	// TELLABLE APART. Slot-derived hues COLLIDED on real schemes — the
	// audit found Solarized's visual/replace both pink-red at 32°,
	// Gruvbox's insert/command both yellow at 17°, Deuteranopia packing
	// four modes onto its two axes. Modes now claim hues in priority
	// order (Replace first — red is the safety signal), each trying its
	// slot's hue, then its fixed semantic hue, then steps away from it,
	// taking the first at least 35° from everything already placed. The
	// earlier release said a scheme's axes outrank the fixed hues; the
	// vault said two modes wearing the same red is worse. Distinctness
	// wins, and the reversal is recorded here on purpose.
	//
	// QUIET STAYS QUIET. The same earlier release forced colour onto
	// monochrome schemes as a "safety signal"; the vault overruled that
	// too — a writer who chose a monochrome scheme did not ask for a neon
	// cursor. When no accent slot carries chroma, the modes wear SHADES
	// OF GREY: distinct steps of the scheme's own ink, each still
	// readable, told apart by weight instead of hue.
	barThemeVimInks(this: WordSmith, h: WsThemeHalf) {
		const chroma = (str: string) => {
			const p = parseColorRGB(str);
			return p ? (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2])) / 255 : 0;
		};
		// Monochrome means the slots AND the accent carry no chroma. The
		// first classifier read only the slots and misfiled Everforest —
		// whose deep muted surfaces sit under the threshold while its green
		// accent and warm ink very much do not — sending a chromatic scheme
		// down the grey path, where every "shade" of its TINTED ink shared
		// one hue and the tellable-apart sweep caught all six pairs at once.
		const grey = chroma(h.t4) < 0.12
			&& ['c4', 'c5', 'c6', 'c7'].every(k => chroma(h[k]) < 0.12);
		if (grey) {
			// SPREAD, not the first four steps. Walking away from the ink in
			// small increments and stopping at four gave Quiet's light half
			// #000, #111, #222, #343 — four values, one colour to the eye,
			// which fails the only thing mode inks are for. Collect every
			// step that still reads, then take four spaced ACROSS that
			// range, so the modes differ by as much as the scheme's own
			// contrast headroom allows.
			const usable = [];
			for (let t = 0; t <= 0.85; t += 0.05) {
				const c = mixColors(h.t1, h.b1, t);
				if (this.barContrast(c, h.b1) >= 4.5) usable.push(c);
			}
			const shades = [];
			if (usable.length) {
				for (let i = 0; i < 4; i++) {
					shades.push(usable[Math.round(i * (usable.length - 1) / 3)]);
				}
			}
			while (shades.length < 4) shades.push(h.t1);
			return { normal: this.barThemeCursorInk(h),
				replace: shades[0], insert: shades[1],
				visual: shades[2], command: shades[3] };
		}
		const dist = (a: number, b: number) => {
			const d = Math.abs(a - b) % 360;
			return d > 180 ? 360 - d : d;
		};
		const placed: number[] = [];
		const place = (slot: string, fixed: number) => {
			const tries = [];
			const sv = this.barThemeVivify(h[slot], h.b1, h.t1);
			const sh = colorToHsl(sv);
			if (sh && sh.s >= 0.15) tries.push(sh.h);
			tries.push(fixed, fixed + 40, fixed - 40, fixed + 80, fixed - 80);
			for (const cand of tries) {
				const hh = ((cand % 360) + 360) % 360;
				if (placed.every(p => dist(p, hh) >= 35)) {
					placed.push(hh);
					return this.barThemeHueInk(hh, h);
				}
			}
			placed.push(fixed);
			return this.barThemeHueInk(fixed, h);
		};
		return {
			// Normal is the resting mode, so it wears the resting colour:
			// the scheme's accent, same as the cursor's flat look.
			normal:  this.barThemeCursorInk(h),
			replace: place('c7', 5),
			insert:  place('c4', 130),
			visual:  place('c6', 275),
			command: place('c5', 45)
		};
	},

	// Cursor-Smith's OWN defaults for the keys this bridge writes, copied
	// from its source (cursor-smith 1.4.4: DEFAULT_SETTINGS and
	// VIM_MODE_STARTERS).
	//
	// These are the answer to a state the stash cannot cover: a vault
	// dressed by a build that had no stash, whose cursor is themed with no
	// record of what it was. Without this, "give it back" has nothing to
	// give and the cursor stays themed forever — which is exactly what a
	// writer sees as "the toggle does nothing".
	//
	// The trade is deliberate and one-directional: falling back replaces a
	// custom colour the writer may have chosen BEFORE we ever wrote, which
	// we cannot know. It only ever runs when there is no stash at all, and
	// returning a cursor to the plugin's own defaults is closer to what
	// was asked than leaving our colours on it.
	barThemeCursorDefaults(this: WordSmith) {
		const look: Record<string, string> = {
			colorDark: '#39ff14', colorLight: '#333333',
			gradientDark1: '#39ff14', gradientDark2: '#00d4ff',
			gradientDark3: '#b14aff', gradientDark4: '#ff2e88',
			gradientLight1: '#1f8a3b', gradientLight2: '#0077b6',
			gradientLight3: '#7028c8', gradientLight4: '#c2185b'
		};
		const modes: Record<string, Record<string, string>> = {
			normal:  { colorDark: '#4aa3ff', colorLight: '#1e6fd0' },
			insert:  { colorDark: '#39ff14', colorLight: '#2a7d2e' },
			visual:  { colorDark: '#f5a623', colorLight: '#b26a00' },
			replace: { colorDark: '#ff3b3b', colorLight: '#b30000' },
			command: { colorDark: '#c792ea', colorLight: '#7d3fbf' }
		};
		return { global: look, vim: modes };
	},

	// Hand the scheme's inks to Cursor-Smith, if it is installed and asked.
	//
	// The shape this writes was read from cursor-smith 1.4.4, not guessed:
	// colorDark/colorLight are its per-app-mode flat colours, and the
	// gradient stops are SCALAR keys (gradientDark1-4 / gradientLight1-4) by
	// that plugin's own documented design — its presets copy settings with a
	// shallow assign, so arrays there would alias. Both halves are written,
	// because that is how both plugins already think: a pair, chosen by the
	// app's mode.
	//
	// All four stops are filled even when its gradientCount uses fewer, so
	// widening the gradient later stays on-theme. gradientEnabled and
	// gradientCount are deliberately NOT touched — the cursor's SHAPE is the
	// writer's; only its colours are the scheme's.
	//
	// Everything goes through cs.saveSettings(), which is that plugin's one
	// entry point and repaints everything itself. Two guards are honoured:
	// nothing is written if the plugin is absent, and nothing is written
	// while its settings are swapped for a Vim mode (_settingsSwapped) —
	// its own saveSettings aborts in that state for a documented reason, and
	// mutating the swapped object would corrupt a mode snapshot.
	// Snapshot/restore over EXACTLY the keys the bridge touches. Each
	// entry records presence as well as value, because the bridge ADDS
	// keys to bare mode snapshots — restoring those means deleting them,
	// not writing undefined into another plugin's settings.
	barThemeCursorCapture(this: WordSmith, obj: Record<string, unknown>, keys: string[]) {
		const out: Record<string, { had: boolean; v?: unknown }> = {};
		for (const k of keys) {
			out[k] = (k in obj) ? { had: true, v: obj[k] } : { had: false };
		}
		return out;
	},

	barThemeCursorRestoreInto(this: WordSmith, obj: Record<string, unknown>, snap: Record<string, { had: boolean; v?: unknown }>) {
		for (const k of Object.keys(snap)) {
			if (snap[k].had) obj[k] = snap[k].v;
			else delete obj[k];
		}
	},

	async barThemeCursorSync(this: WordSmith, force?: string) {
		const GLOBAL_KEYS = ['colorDark', 'colorLight',
			'gradientDark1', 'gradientDark2', 'gradientDark3', 'gradientDark4',
			'gradientLight1', 'gradientLight2', 'gradientLight3', 'gradientLight4'];
		const MODES = ['normal', 'insert', 'visual', 'replace', 'command'];

		// UNDRESSING comes first: whenever the dressing stops — the kill
		// switch, the cursor toggle, or Default — the stash goes back and
		// is cleared. The vault asked for this by name: choosing Default
		// returns the cursor to the writer's own colours. This retires
		// "writes-never-restores"; stashing exactly the keys we touch is a
		// smaller liberty than permanently overwriting them turned out to
		// be. If the plugin is absent or mid-swap at that instant, the
		// stash is KEPT for a later chance rather than dropped.
		const undress = async (reason: string) => {
			const stash = this.settings.barThemeCursorStash;
			let cs2: WsCursorSmithPlugin | null = null;
			try { cs2 = (this.app && this.app.plugins && this.app.plugins.plugins
				&& this.app.plugins.plugins['cursor-smith'] as WsCursorSmithPlugin | undefined) || null; } catch (_) { wsCatch('barThemeCursorSync / undress', _); }
			if (!cs2 || !cs2.settings || cs2._settingsSwapped) return reason;

			if (stash) {
				if (stash.global) this.barThemeCursorRestoreInto(cs2.settings, stash.global);
				if (stash.vim && cs2.settings.vimModes) {
					for (const mode of Object.keys(stash.vim)) {
						const m = cs2.settings.vimModes[mode];
						if (m) this.barThemeCursorRestoreInto(m, stash.vim[mode]);
					}
				}
				this.settings.barThemeCursorStash = null;
				this.settings.barThemeCursorDressed = false;
				try { if (cs2.saveSettings) await cs2.saveSettings(); } catch (_) { wsCatch('barThemeCursorSync / undress: await cs2.saveSettings();', _); }
				return reason;
			}

			// NO STASH, and the caret may still be wearing our colours — a
			// vault dressed by a build that predates the stash, which is
			// precisely the state the vault reported. Acting blindly would
			// reset the caret of a writer who never used this feature, so
			// the question is answered rather than assumed, two ways:
			//
			//   the persisted flag says we dressed it (true going forward);
			//   or the colour ON the caret right now IS one of ours — it
			//   equals some scheme's cursor ink, in one half or the other.
			//
			// The second test is what recovers a vault dressed before the
			// flag existed. Forty candidate colours make a coincidence
			// vanishingly unlikely, and the cost of being wrong is a caret
			// reset to Cursor-Smith's defaults, which is what was asked for
			// in the first place.
			const wearsOurs = () => {
				const cur = cs2.settings && cs2.settings.colorDark;
				if (!cur) return false;
				for (const t of BAR_THEMES) {
					if (this.barThemeCursorInk(t.dark) === cur) return true;
					if (this.barThemeCursorInk(t.light) === cur) return true;
				}
				return false;
			};
			if (!this.settings.barThemeCursorDressed && !wearsOurs()) return reason;
			const def = this.barThemeCursorDefaults();
			for (const k of Object.keys(def.global)) cs2.settings[k] = def.global[k];
			if (cs2.settings.vimModes) {
				for (const mode of Object.keys(def.vim)) {
					const m = cs2.settings.vimModes[mode];
					if (!m) continue;
					for (const k of Object.keys(def.vim[mode])) m[k] = def.vim[mode][k];
				}
			}
			this.settings.barThemeCursorDressed = false;
			try { if (cs2.saveSettings) await cs2.saveSettings(); } catch (_) { wsCatch('barThemeCursorSync / undress: await cs2.saveSettings();', _); }
			return reason;
		};

		// A forced undress is the teardown path: the settings still say
		// "dress", and the caret must come off anyway.
		if (force === 'undress') return undress('undressed');
		if (this.settings.barThemeEnabled === false) return undress('disabled');
		// The Vim consent is a SUBOPTION — the vault moved it under the
		// cursor toggle, so vim colouring without the cursor consent is no
		// longer a state. The setting survives a cursor-off round trip; the
		// writing is what stops.
		const wantCursor = !!this.settings.barThemeCursor;
		const wantVim    = wantCursor && !!this.settings.barThemeVim;
		if (!wantCursor) return undress('off');
		const id = this.settings.barTheme;
		if (!id || id === 'custom') return undress('custom');
		const theme = this.barThemeById(id);
		if (!theme) return undress('custom');
		let cs: WsCursorSmithPlugin | null = null;
		try { cs = (this.app && this.app.plugins && this.app.plugins.plugins
			&& this.app.plugins.plugins['cursor-smith'] as WsCursorSmithPlugin | undefined) || null; } catch (_) { wsCatch('barThemeCursorSync: await cs2.saveSettings();', _); }
		if (!cs || !cs.settings) return 'absent';
		if (cs._settingsSwapped) return 'swapped';

		// CAPTURE ONCE, before the first write and never after: a stash
		// taken while dressed would restore the dress. Mutation happens
		// synchronously, before any await, so the caller's saveSettings
		// persists it.
		if (!this.settings.barThemeCursorStash) {
			const stash: { 'global': Record<string, { had: boolean; v?: unknown }>; vim?: Record<string, Record<string, { had: boolean; v?: unknown }>> } = { global: this.barThemeCursorCapture(cs.settings, GLOBAL_KEYS) };
			if (cs.settings.vimModes && typeof cs.settings.vimModes === 'object') {
				stash.vim = {};
				for (const mode of MODES) {
					const m = cs.settings.vimModes[mode];
					if (m && typeof m === 'object') {
						stash.vim[mode] = this.barThemeCursorCapture(m, GLOBAL_KEYS);
					}
				}
			}
			this.settings.barThemeCursorStash = stash;
		}
		// A mode can be ADDED to Cursor-Smith after the stash was taken,
		// and dressing it without recording it would leave that one mode
		// themed forever with nothing to restore. Capture-once is per KEY
		// SET, not per session.
		if (this.settings.barThemeCursorStash.vim && cs.settings.vimModes) {
			for (const mode of MODES) {
				const m = cs.settings.vimModes[mode];
				if (m && typeof m === 'object' && !this.settings.barThemeCursorStash.vim[mode]) {
					this.settings.barThemeCursorStash.vim[mode] =
						this.barThemeCursorCapture(m, GLOBAL_KEYS);
				}
			}
		}
		// Persisted alongside the stash, because the fallback path above
		// needs to know a dress happened even when the stash is missing.
		this.settings.barThemeCursorDressed = true;

		// The SUBOPTION going off while the parent stays on gives back
		// just the vim part of the stash, immediately.
		if (!wantVim && this.settings.barThemeCursorStash.vim
			&& cs.settings.vimModes) {
			for (const mode of Object.keys(this.settings.barThemeCursorStash.vim)) {
				const m = cs.settings.vimModes[mode];
				if (m) this.barThemeCursorRestoreInto(m,
					this.settings.barThemeCursorStash.vim[mode]);
			}
			delete this.settings.barThemeCursorStash.vim;
		}
		const d = theme.dark, l = theme.light;
		// Vivified, not merely inkified: the audit that reshaped this bridge
		// found t4 is a polite blue on nearly every scheme, which is why a
		// "themed" cursor kept looking like the same cursor. The cursor gets
		// the LOUDEST readable ink the half owns — Modus Tinted's blood
		// red, not its blue — and the gradient stops are saturated versions
		// of the accent slots rather than the muted surfaces themselves.
		const vivD  = (c: string, hue?: undefined) => this.barThemeVivify(c, d.b1, d.t1, hue);
		const vivL  = (c: string, hue?: undefined) => this.barThemeVivify(c, l.b1, l.t1, hue);
		// The cursor wears the scheme's accent — the H1 ink — not the
		// loudest hue in the table; see barThemeCursorInk.
		const loudD = this.barThemeCursorInk(d);
		const loudL = this.barThemeCursorInk(l);
		if (wantCursor) {
			cs.settings.colorDark  = loudD;
			cs.settings.colorLight = loudL;
			cs.settings.gradientDark1  = loudD;
			cs.settings.gradientDark2  = vivD(d.c4);
			cs.settings.gradientDark3  = vivD(d.c7);
			cs.settings.gradientDark4  = vivD(d.c6);
			cs.settings.gradientLight1 = loudL;
			cs.settings.gradientLight2 = vivL(l.c4);
			cs.settings.gradientLight3 = vivL(l.c7);
			cs.settings.gradientLight4 = vivL(l.c6);
		}

		// THE VIM MODES, per cursor-smith's own shape: settings.vimModes is a
		// map of full per-mode look snapshots, each with its own colour and
		// gradient scalars. The colours follow Vim's conventional semantics
		// through the table's slot convention (c4 leans green, c5 yellow, c6
		// purple, c7 red, on every scheme): Normal wears the accent, Insert
		// green (writing), Visual purple (selecting), Replace red
		// (destroying), Command yellow (the prompt). Only modes that EXIST in
		// the map are touched — inventing one would hand the other plugin a
		// snapshot missing every look key it expects — and only colour keys
		// are written: a mode's cursor style and effects stay the writer's,
		// the same contract as the global shape.
		// Per-mode inks come from barThemeVimInks — collision-resolved hues,
		// or shades of grey on a monochrome scheme; see the resolver for both
		// stories.
		const vmD = this.barThemeVimInks(d);
		const vmL = this.barThemeVimInks(l);
		if (wantVim && cs.settings.vimModes && typeof cs.settings.vimModes === 'object') {
			for (const mode of ['normal', 'insert', 'visual', 'replace', 'command'] as const) {
				const m = cs.settings.vimModes[mode];
				if (!m || typeof m !== 'object') continue;
				const cd = vmD[mode], cl = vmL[mode];
				m.colorDark  = cd;
				m.colorLight = cl;
				// The mode's gradient leads with the mode's own colour and
				// falls back to the OTHER modes' inks — already resolved
				// apart, so the gradient stays tellable too.
				m.gradientDark1  = cd;
				m.gradientDark2  = vmD.insert;
				m.gradientDark3  = vmD.replace;
				m.gradientDark4  = vmD.visual;
				m.gradientLight1 = cl;
				m.gradientLight2 = vmL.insert;
				m.gradientLight3 = vmL.replace;
				m.gradientLight4 = vmL.visual;
			}
		}

		try { if (cs.saveSettings) await cs.saveSettings(); } catch (_) { wsCatch('barThemeCursorSync: await cs.saveSettings();', _); }
		return 'synced';
	},

	// The half a card should preview: what the writer will actually get if
	// they press it now.
	barThemeHalf(this: WordSmith, theme: WsBarTheme): WsThemeHalf {
		return this.isDarkTheme() ? theme.dark : theme.light;
	},
};
export type ThemesMethods = typeof themesMethods;
