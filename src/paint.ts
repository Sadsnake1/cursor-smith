// Word-Smith — Paint: what the plugin paints on the body: the classes, the variables, the chrome, the torch.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import type { WsCursorSmithPlugin, WsElectronWindow } from './settings';
import { BAR_DIRECTIVE_BG, DEFAULT_SETTINGS, PL_SEP_ASPECT, STYLE_CLASSES, STYLE_KINDS, STYLE_PROPS, readBarDirective, wsCatch } from './preamble';
import type WordSmith from './plugin';

export const paintMethods = {

	// ── The window controls, which are not DOM ───────────────────────────────
	//
	// On Windows and Linux the minimise/maximise/close buttons are drawn by
	// ELECTRON, not by Obsidian: a native overlay painted over the top-right
	// of the frame. That is why the stylesheet could not touch them — the
	// rules landed on nothing and the grey plate stayed exactly where it
	// was, which is a good demonstration of a fix that "applies cleanly"
	// and does nothing at all.
	//
	// Electron will repaint it on request. Reached defensively: `remote` is
	// absent on macOS (where the buttons are the system's), absent on
	// mobile, and may be gone in a future version — in every one of those
	// cases this must be a no-op rather than a thrown error at load.
	setWindowControlColours(this: WordSmith, on: boolean) {
		// FOUR WAYS IN, because there is no one way. Obsidian has shipped
		// `electron.remote` (older), `@electron/remote` (newer, a separate
		// module), and builds where neither is exposed to a plugin at all.
		// The first attempt tried one of them and quietly failed on a vault
		// that had another — which looked exactly like the CSS failing,
		// and cost a round to tell apart.
		// a window that can take the overlay: the method is optional on the
		// type, and the route that answered is kept only when it has one
		const hasOverlay = (w: WsElectronWindow | null): w is WsElectronWindow & { setTitleBarOverlay(overlay: Record<string, unknown>): void } =>
			!!w && typeof w.setTitleBarOverlay === 'function';
		let win: (WsElectronWindow & { setTitleBarOverlay(overlay: Record<string, unknown>): void }) | null = null;
		const tries = [
			() => window.require ? window.require('@electron/remote').getCurrentWindow() : null,
			() => { const r = window.require && window.require('electron').remote; return r ? r.getCurrentWindow() : null; },
			() => { const m = window.require && window.require('electron'); return m && m.getCurrentWindow ? m.getCurrentWindow() : null; }
			// A fourth route, `require('@electron/remote')` through the plugin's
			// own require, went with the port: on the desktop build it is
			// the first route by another name, and a bare require is not a module.
		];
		for (const t of tries) {
			try {
				const w2 = t();
				if (hasOverlay(w2)) { win = w2; break; }
			} catch { /* next */ }
		}
		if (!win) return false;
		try {
			if (!on) {
				// Back to what Obsidian asked for. Remembered at the first
				// change rather than guessed, so a theme that had already
				// customised it is not overwritten with our idea of default.
				if (this._wcoWas) win.setTitleBarOverlay(this._wcoWas);
				return true;
			}
			const cs = getComputedStyle(document.body);
			const pick = (name: string, fallback: string) => {
				const v = (cs.getPropertyValue(name) || '').trim();
				return v || fallback;
			};
			if (!this._wcoWas) {
				this._wcoWas = { color: pick('--titlebar-background', '#1e1e1e'),
					symbolColor: pick('--text-muted', '#888888') };
			}
			win.setTitleBarOverlay({
				color:       pick('--background-primary', '#1e1e1e'),
				symbolColor: pick('--text-muted', '#888888')
			});
			return true;
		} catch { return false; }
	},

	// Tear down everything without unloading the plugin
	// Everything the plugin puts on <body> or :root, in one place. onunload
	// used to keep its own shorter list, which had drifted seven classes and
	// every custom property behind this one — so disabling from Obsidian's
	// plugin page left the font override applied.
	clearAllBodyState(this: WordSmith) {
		document.body.classList.remove(
			'zenmode-active', 'zenmode-hide-properties', 'zenmode-hide-status-bar',
			'zenmode-hide-scroll-bar', 'zenmode-hide-title-bar', 'zenmode-hide-ribbon',
			'zenmode-hide-linked-mentions', 'ws-text-pad', 'ws-para-indent', 'ws-justify', 'ws-typewriter', 'ws-margin-nums',
			'ws-masks-active', 'ws-retrobar-active', 'ws-pos-dim', 'ws-ck-dim', 'ws-hemingway-active',
			'ws-line-limit', 'ws-editor-focused', 'ws-font-active', 'ws-rtl', 'ws-vim-panel-open',
				'ws-bar-hidden', 'ws-bar-anim', 'ws-bar-peek', 'ws-titlebar-match', 'ws-drag-ok'
		);
		document.body.removeAttribute('data-zen-hide-inline-title');
		document.body.removeAttribute('data-zen-focused-file');
		// The titlebar marker lives on the element, not on body, so the
		// class list above does not reach it.
		const mainTb = document.querySelector('.titlebar.ws-main-titlebar');
		if (mainTb) mainTb.classList.remove('ws-main-titlebar');
		// Custom properties are set on body and :root, not by class, so the
		// list above does not reach them.
		for (const prop of ['--ws-bg', '--ws-text', '--ws-font',
			// Left behind by the removed note mini-theme: inline custom
			// properties on body survive a plugin upgrade, so a vault that
			// once had the palette on would keep a recoloured mask and
			// title bar forever without this sweep.
			'--ws-note-bg', '--ws-note-text', '--ws-note-bg-alt']) {
			document.body.style.removeProperty(prop);
		}
		// The pane reservation is a :root property plus a class on each
		// covered leaf — neither reachable from the body list above. Left
		// behind, the class is inert (its rule is gated on
		// ws-retrobar-active) but the padding would survive a disable in
		// any vault whose snippet happens to match on it.
		document.documentElement.style.removeProperty('--ws-bar-reserve');
		// Same species: an inline custom property on documentElement outlives
		// the stylesheet that read it, so a disabled plugin would otherwise
		// leave a vault's editor padded for a typewriter that is no longer on.
		document.documentElement.style.removeProperty('--ws-tw-pad-top');
		document.documentElement.style.removeProperty('--ws-tw-pad-bottom');
		// …AND EVERY OTHER `--ws-` PROPERTY, by prefix rather than by name.
		//
		// The three above were each added the day somebody noticed one of
		// them surviving a disable. Sixteen more were still being left on
		// :root — the bar's height and padding, the vim gutter, the mask
		// overhang, the separator weight and style, the arrow scale, the
		// scroller pads, the rule bands — plus two on body. They are inert
		// today, because every rule that reads them is gated on a class this
		// method removes; "inert today" is not the promise this method makes,
		// and the next ungated rule turns one of them into the same bug
		// three times over.
		//
		// A prefix sweep cannot go stale the way a list does: a variable
		// added next year is cleaned by the code written this year. Anything
		// NOT ours is untouched, which is the whole reason the plugin stamps
		// its own under one prefix.
		for (const el of [document.documentElement, document.body]) {
			if (!el || !el.style) continue;
			const mine = [];
			for (let i = 0; i < el.style.length; i++) {
				const k = el.style[i];
				if (k && k.indexOf('--ws-') === 0) mine.push(k);
			}
			for (const k of mine) el.style.removeProperty(k);
		}
		this._barReserve = null;
		document.querySelectorAll('.ws-bar-overlap')
			.forEach(el => el.classList.remove('ws-bar-overlap'));
	},

	// ── THE TORCH'S DARKNESS ON OUR OWN CHROME (the contract with Cursor-Smith) ──
	// Cursor-Smith's torch is a black wash at its Darkness setting with a hole
	// at the caret. Its layers sit UNDER this plugin's raised chrome now, so
	// the caret hides under the bands and the bar as the editor's own would —
	// and the chrome, lit above the darkness, paints itself dark: the sheet
	// washes it under `body.cursor-smith-torch-active` at the same alpha,
	// read here from Cursor-Smith's resolved look (`look.overlayDarkness`;
	// 0.92 is its default) and stamped on body. `ws-torch-whole` says the
	// torch covers the whole window (its sidebars are not spared), which is
	// when the titlebar and the docks' headers go dark too. Run from the
	// body-class observer, so the torch's own class flip lands it, and from
	// every refresh.
	applyTorchVars(this: WordSmith) {
		const body = document.body;
		const on = body.classList.contains('cursor-smith-torch-active');
		let dark = 0.92, spare = true;
		if (on) {
			try {
				const cs = (this.app.plugins && this.app.plugins.plugins
					&& this.app.plugins.plugins['cursor-smith'] as WsCursorSmithPlugin | undefined) || null;
				const look = cs ? (cs.look || cs.settings) : null;
				if (look && typeof look.overlayDarkness === 'number') dark = Math.max(0, Math.min(1, look.overlayDarkness));
				if (look && typeof look.overlaySpareSidebars === 'boolean') spare = look.overlaySpareSidebars;
			} catch (_) { wsCatch('applyTorchVars: cursor-smith look', _); }
		}
		const want = on ? String(Math.round(dark * 1000) / 1000) : '';
		if (body.style.getPropertyValue('--ws-torch-dark') !== want) {
			if (want) body.style.setProperty('--ws-torch-dark', want);
			else body.style.removeProperty('--ws-torch-dark');
		}
		body.classList.toggle('ws-torch-whole', on && !spare);
	},

	applyBodyClasses(this: WordSmith) {
		this.applyTorchVars();
		// The live colour scheme, refreshed on every pass so a theme picked in
		// one window is on the body in all of them, and a reload restores it
		// without the picker having been touched.
		this.applyThemeClass();
		this.applyThemeVars();
		const body = document.body;
		const zen  = this.zenActive();
		// Zen's own chrome is intentionally not scoped (see the Scope section
		// above); everything below it that touches the text is.
		const scoped = this.isActiveFileInScope();
		// The retro bar visually replaces the native status bar, so it always
		// hides it while active — independent of the separate "hide native
		// status bar in zen mode" toggle below. These used to share a single
		// setting, which meant flipping either one could silently flip the
		// other's effect (e.g. turning the retro bar on/off would overwrite
		// the zen-mode toggle's value, or vice versa).
		const hideNativeStatusBar = this.shouldHideNativeStatusBar();
		body.classList.toggle('zenmode-active',             zen);
		body.classList.toggle('zenmode-hide-properties',    zen && this.settings.hideProperties);
		body.classList.toggle('zenmode-hide-status-bar',    hideNativeStatusBar);
		body.classList.toggle('zenmode-hide-scroll-bar',    this.shouldHideScrollBar());
		body.classList.toggle('zenmode-hide-linked-mentions', zen && this.settings.hideLinkedMentions);
		body.classList.toggle('zenmode-hide-ribbon',        zen && this.settings.hideRibbon);
		// The horizontal padding is applied by an otherwise unscoped rule, so
		// this class is what makes both kill switches able to reach it — the
		// plugin's own, and Text Options'.
		body.classList.toggle('ws-text-pad',                scoped && !!this.settings.miscEnabled);
		body.classList.toggle('ws-para-indent',             scoped && this.textOpt('enableParagraphIndent', false));
		// One class for either kind of margin number: the CSS reserves the
		// room once, so turning both on does not indent the text twice.
		body.classList.toggle('ws-margin-nums', scoped && !!this.settings.paragraphNumbers);
		// THE BAR IN THE INTERFACE FONT: the sheet's rule on this class beats
		// the font the token chose. Not scoped: the bar is one bar in every note.
		body.classList.toggle('ws-bar-ui-font', !!this.settings.statusBarUiFont);
		body.classList.toggle('ws-justify',                 scoped && this.textOpt('justifyText', false));
		// TYPEWRITER OWNS ITS OWN SCROLL PADDING. The 50vh top/bottom inset
		// used to hang off `.zenmode-active`, which had it exactly backwards
		// on both sides: in typewriter WITHOUT zen there was no padding, so
		// scrollTop clamped at 0 and the caret could not reach its anchor
		// until a dozen lines into the document — the setting was inert
		// precisely where writing starts. And in zen WITHOUT typewriter the
		// padding was pure cost: a note opening half a screen down for a
		// feature that was not on. Same rule, wrong owner, two complaints.
		//
		// Derived from the anchor rather than fixed at 50/50, which is what
		// makes the setting real: at 30% the first line can sit 30% down and
		// the last line can rise to 30%, both impossible before.
		const twOn = scoped && !!this.opt('enableTypewriter');
		body.classList.toggle('ws-typewriter', twOn);
		if (twOn) {
			const pct = this.typewriterAnchorRatio() * 100;
			document.documentElement.style.setProperty('--ws-tw-pad-top',    pct + 'vh');
			document.documentElement.style.setProperty('--ws-tw-pad-bottom', (100 - pct) + 'vh');
		} else {
			document.documentElement.style.removeProperty('--ws-tw-pad-top');
			document.documentElement.style.removeProperty('--ws-tw-pad-bottom');
		}
		body.classList.toggle('ws-line-limit',              scoped && this.textOpt('limitLineLength', false));
		body.classList.toggle('ws-rtl',                     this.isRightToLeft());
		// The slide transition only exists while the bar is actually
		// moving. Left on permanently, `transition: transform` promotes
		// the bar to its own compositing layer and its text loses subpixel
		// antialiasing — the "slightly fuzzy bar" effect.
		const hideBar = this.barIsHidden();
		if (body.classList.contains('ws-bar-hidden') !== hideBar) {
			body.classList.add('ws-bar-anim');
			window.clearTimeout(this._barAnimT);
			this._barAnimT = window.setTimeout(() => document.body.classList.remove('ws-bar-anim'), 350);
		}
		body.classList.toggle('ws-bar-hidden', hideBar);
		// Whether the bar can be peeked at, and where the strip is. Here
		// because this is the one place that decides the bar is hidden.
		this.syncBarPeekState();
		const matchBar = zen && this.settings.zenTitlebarMatch;
		body.classList.toggle('ws-titlebar-match', matchBar);
		// The DOM half of this is the stylesheet's; the window controls are
		// Electron's and have to be asked. Called on every pass rather than
		// only on the transition, because a theme change repaints the page
		// underneath them and leaves the overlay on the old colour.
		this.setWindowControlColours(matchBar);
		body.classList.toggle('ws-masks-active',            scoped && this.letterboxActive());
		body.classList.toggle('ws-pos-dim',                 scoped && this.settings.posEnabled && this.settings.posDimOthers);
		body.classList.toggle('ws-ck-dim',                  scoped && this.settings.checksEnabled && this.settings.checkDimOthers);
		body.classList.toggle('ws-hemingway-active',        scoped && this.settings.hemingwayEnabled);
		if (zen) {
			body.setAttribute('data-zen-hide-inline-title', String(this.settings.hideInlineTitle));
			body.setAttribute('data-zen-focused-file',      String(this.settings.focusedFileMode));
		} else {
			body.removeAttribute('data-zen-hide-inline-title');
			body.removeAttribute('data-zen-focused-file');
		}
		this.tagMainTitlebar();
	},

	// ════════════════════════════════════════════════════════════════════════
	// CHROME CLEANUP
	// ════════════════════════════════════════════════════════════════════════
	// Two removed features left inline properties behind: the unified-colours
	// feature (one background/text pair painted across the editor and the
	// chrome) and, later, the note mini-theme. What stays is the ability to
	// take it back OFF: the old versions wrote these properties inline onto
	// body.style, where they outlive both the plugin's stylesheet and its
	// settings — a vault upgraded mid-session would keep the override until
	// something removed it by hand. clearChromeColors() runs on every apply
	// pass and on disable, so any leftover from an older install is wiped
	// the first time this version paints.
	chromeProps(this: WordSmith) {
		return ['--background-primary', '--background-primary-alt',
			'--background-secondary', '--background-secondary-alt',
			'--titlebar-background', '--titlebar-background-focused',
			'--tab-container-background', '--ribbon-background',
			'--text-normal', '--text-muted', '--text-faint',
			'--background-modifier-hover', '--background-modifier-active-hover',
			'--background-modifier-border', '--background-modifier-border-hover',
			'--background-modifier-border-focus', '--background-modifier-form-field',
			'--nav-item-background-active', '--nav-item-background-hover',
			'--interactive-normal', '--interactive-hover',
			'--tab-background-active', '--modal-background',
			// Same story, second removal: the note mini-theme stamped these
			// three inline on body. Identical failure mode, identical fix —
			// swept on every apply pass so an upgraded vault loses the
			// leftover the first time this version paints, rather than
			// keeping a recoloured mask and title bar with no setting left
			// to turn them off.
			'--ws-note-bg', '--ws-note-text', '--ws-note-bg-alt'];
	},

	clearChromeColors(this: WordSmith) {
		// EXEMPTED BY OWNERSHIP, and the exemption is load-bearing. This
		// janitor sweeps inline properties off body on every apply pass —
		// installed for an older feature's leftovers — and the theme engine
		// (applyThemeVars) writes ITS variables inline on body in the same
		// pass, one call earlier. --background-primary is on both lists. An
		// unexempted sweep removes the theme milliseconds after it is set,
		// on every refresh, forever: correct in any simulation that calls
		// the setter without running the pass that follows it, and dead in a
		// vault. A set difference rather than a reordering, so whoever edits
		// the refresh pass next cannot silently re-lose the fight; anything
		// the theme does NOT own is still swept, so the upgrade-leftover
		// problem this exists for stays solved.
		const body = document.body.style;
		const owned = new Set(this._themeVarKeys || []);
		for (const p of this.chromeProps()) {
			if (!owned.has(p)) body.removeProperty(p);
		}
	},

	applyCssVariables(this: WordSmith) {
		// Not applied any more, only ever cleared — see CHROME CLEANUP above.
		this.clearChromeColors();
		const root = document.documentElement.style;
		// Same story, and swept on every pass rather than only on disable:
		// an upgraded vault would otherwise keep the removed zen padding's
		// inline values on :root with no setting left to change them.
		root.removeProperty('--zen-mode-top-padding');
		root.removeProperty('--zen-mode-bottom-padding');
		// DEFAULT_SETTINGS' own value when the tab is off, not zero: zero would
		// jam the text against the window edge, which is not "no text options",
		// it is a different text option.
		root.setProperty('--ws-editor-padding-h',
			this.textOpt('editorPaddingH', DEFAULT_SETTINGS.editorPaddingH) + 'px');
		// (z-index vars intentionally not stamped here — the stylesheet
		// defaults already provide them, and inline values on :root would
		// still lose to the elevated body.ws-masks-active values anyway.)

		// Arrow size is a fixed-px calc() in styles.css so it holds its size
		// resizes with zero JS; only the user's scale multiplier is stamped.
		root.setProperty('--ws-arrow-scale',          String(this.settings.arrowScale || 1));
		root.setProperty('--ws-separator-style',      this.settings.separatorStyle);
		root.setProperty('--ws-separator-weight',     this.settings.separatorWeight + 'px');
		// When the bar follows the note, the stamped value is a var()
		// REFERENCE, not a resolved number: --font-text-size is what
		// Ctrl+scroll zoom moves, and the reference re-resolves at the bar
		// on every zoom step with no plugin involvement. It resolves there
		// rather than here because a custom property stores its tokens
		// unsubstituted — the inner var() is looked up against the BAR's
		// own inherited scope when font-size finally uses it, and the bar
		// lives inside <body>, where Obsidian defines the variable.
		root.setProperty('--ws-status-bar-font-size',
			this.settings.statusBarFontFollowNote
				? 'var(--font-text-size, 16px)'
				: this.settings.statusBarFontSize + 'px');
		// Row height is what the user sets; the bar's own height is the
		// product, so mask positioning and the cm-panels-bottom offset keep
		// working unchanged against --ws-status-bar-height.
		// One row, always: the bar reads as an instrument line, and the row
		// beneath it now belongs to the vim command gutter.
		// One, matching getStatusRows. The pair has to move together —
		// reserving height for rows that do not render leaves a bare strip.
		const barRows = 1;
		// Centring a font in a row leaves (row - font) / 2 above and below;
		// when that difference is odd the text sits on a half pixel and
		// renders soft. One extra pixel of row buys whole-pixel baselines.
		const rowH = this.snappedRowHeight();
		root.setProperty('--ws-status-row-height',    rowH + 'px');
		// The bar sits one row above the window edge; the vim command line
		// gets that row, and the bar's own plinth masks it while closed.
		// The row is as tall as a real command line (see vimGutterHeight),
		// so the panel fits without the bar having to move for it.
		root.setProperty('--ws-vim-gutter',           this.vimGutterHeight() + 'px');
		// Padding is added to the bar's own height rather than eating into it,
		// so the rows keep the height they were given and everything that
		// measures the bar — mask placement, the cm-panels offset — still gets
		// the true total.
		const { top: padTop, bottom: padBottom } = this.barPadding();
		root.setProperty('--ws-status-bar-pad-top',    padTop + 'px');
		root.setProperty('--ws-status-bar-pad-bottom', padBottom + 'px');
		// Padding is part of the bar's height in BOTH modes now. It used to
		// be dropped under powerline because the CSS zeroed the padding
		// there; leaving it in the height then made the bar taller than its
		// rows and left a strip of bare bar at the bottom. Powerline keeps
		// its vertical padding now, so the height must carry it again or
		// the rows would be squeezed by exactly padTop+padBottom and the
		// segments would stop short of the rules (invariant 9: the padding,
		// the height and the rows all have to agree).
		// The rules need a BAND OF THEIR OWN under powerline. The overlay
		// that draws them is `inset: 0` at z-index 3, so its border paints
		// over whatever is beneath. The band is now one pixel NARROWER than
		// a solid rule (see barRuleWidths): the segments deliberately run
		// that pixel under the rule and the rule overdraws them, because
		// stopping them exactly at the rule's edge left the joint to
		// device-pixel rounding, which any fractional zoom broke into a
		// hairline. The HEIGHT still carries the full rule widths — the
		// overlap trades a pixel of hidden segment, never a pixel of bar
		// geometry, so masks and the editor reserve see nothing change.
		const rules = this.barRuleWidths();
		root.setProperty('--ws-bar-rule-band-top',    rules.bandTop + 'px');
		root.setProperty('--ws-bar-rule-band-bottom', rules.bandBottom + 'px');
		// Cached as well as stamped: the peek zone needs the bar's height on
		// every pointer move, and measuring it there would be a style read
		// per frame.
		root.setProperty('--ws-pl-sep-aspect', String(PL_SEP_ASPECT));
		this._barBoxHeight = rowH * barRows + padTop + padBottom + rules.top + rules.bottom;
		root.setProperty('--ws-status-bar-height', this._barBoxHeight + 'px');
		root.setProperty('--ws-para-indent',          (this.settings.paragraphIndentEm || 2) + 'em');
		root.setProperty('--ws-mask-overhang',        (this.settings.maskOverhang || 4) + 'px');

		const isDark = document.body.classList.contains('theme-dark');
		// These two go on <body>, not <html>. Obsidian defines
		// --background-primary on body.theme-dark / body.theme-light, so
		// `var(--background-primary)` written at :root has nothing to resolve
		// against: the variable computes to invalid and the bar renders
		// transparent. On body the reference resolves normally.
		const barRoot = document.body.style;
		// The row's directive outranks the colour pickers, per slot: writing
		// :b2 is a deliberate, visible instruction sitting at the front of
		// the format, and a picker two tabs away should not silently win
		// against it. Each half is independent — :b2 alone keeps the custom
		// TEXT, which is the combination that makes the directive worth
		// having on a bar that is otherwise hand-coloured.
		const parsedDir = readBarDirective((this.getStatusRows()[0] || {}).left);
		// A row that declares NOTHING defaults to :bs — the status line's
		// own surface — rather than the page. Synthesised HERE, not in the
		// parser: readBarDirective answers "what was written", every caller
		// depends on null meaning "nothing was", and the default is a
		// choice about painting, which is this method's job. Going through
		// bgTheme means the default gets the same paintability walk an
		// explicit :bs gets, instead of trusting a var() chain a theme can
		// define straight into transparency.
		if (parsedDir.bg === null && parsedDir.bgSlot === null) {
			parsedDir.bg = BAR_DIRECTIVE_BG.bs;
			parsedDir.bgTheme = 'bs';
		}
		const dir = this.resolveBarDirective(parsedDir);
		// No picker branch any more: the bar takes the theme's surface and
		// text unless the ROW says otherwise. The directive is the only way
		// to colour the bar itself now, which is the right place for it —
		// it is visible, it sits at the front of the format it applies to,
		// and it is per row rather than global.
		barRoot.setProperty('--ws-bg',   dir.bg   || 'var(--background-primary)');
		barRoot.setProperty('--ws-text', dir.text || 'var(--text-normal)');
		// The bar's top and bottom rules, each its own colour per theme.
		//
		// HERE, with the other theme-dependent colours, and not in
		// updateStatusBar beside the width and style they share a border
		// shorthand with. The split is deliberate and cost one bug to find:
		// updateStatusBar runs when the bar is built or its settings change,
		// while a theme switch reaches only the observer, which calls this
		// method and applyStyleProps. Stamped there, the rules kept the
		// OUTGOING theme's pair — and not briefly: the clock tick calls
		// updateRetroStatusBar, which is a different method, so nothing on a
		// timer would have corrected it. Width and style are theme-
		// independent, so they stay where they are.
		//
		// On body, like --ws-bg and --ws-text above and for the same reason:
		// custom properties inherit, the ::after resolves them from here,
		// and the fallback it uses if they are missing — var(--ws-text) — is
		// itself declared on body. A stale styles.css therefore renders what
		// the rules looked like before they were choosable, rather than an
		// invalid border.
		// The fallback is a CHAIN now: an explicitly chosen colour wins as
		// ever; with none chosen, --ws-bar-rule-accent answers — a token
		// the bar does not interpret and only the workspace theme sets
		// (inline, with everything else in applyThemeVars) — and with no
		// theme worn it ends at --ws-text, exactly as before. The bar still
		// knows nothing about themes; it reads one more variable that may
		// or may not exist, which is the same contract as :b1.
		barRoot.setProperty('--ws-bar-rule-top-color',
			this.settings[isDark ? 'barRuleDarkTopColor' : 'barRuleLightTopColor']
			|| 'var(--ws-bar-rule-accent, var(--ws-text))');
		barRoot.setProperty('--ws-bar-rule-bottom-color',
			this.settings[isDark ? 'barRuleDarkBottomColor' : 'barRuleLightBottomColor']
			|| 'var(--ws-bar-rule-accent, var(--ws-text))');
		// The note surface. Written on body for the same reason as the bar's
		// pair above, and cleared rather than left at a stale value when the
		// toggle goes off — an inline custom property outlives the
		// stylesheet, so "off" has to actively remove it.
		const lb = this.letterboxColors(isDark);
		if (lb) {
			root.setProperty('--ws-arrow-color', lb.arrow);
			root.setProperty('--ws-line-color',  lb.line);
		} else {
			// REMOVED, not set to var(--text-normal): the stylesheet already
			// declares that as the fallback on both properties, so taking the
			// override away is the whole of "follow the theme" — and one
			// place says what the default is rather than two.
			root.removeProperty('--ws-arrow-color');
			root.removeProperty('--ws-line-color');
		}
	},

	// The bar directive's two halves, resolved to paintable values.
	//
	// :b1/:b2 stay as var() — they must follow the theme live, and they only
	// ever land in CSS properties, where a var() resolves. :N and :vim
	// resolve to a real colour here instead, for two reasons: the derived
	// ink (powerlineInk) needs actual channels to measure, and vimModeColor
	// is a per-call read of live state that no variable can express.
	//
	// The ink is DERIVED when a palette or vim background is set and no ;N
	// was written. The custom text pickers are a choice made against the
	// custom BACKGROUND pickers; a directive background the writer typed
	// separately has no reason to be readable under that choice, and an
	// unreadable bar is a worse answer than an overridden picker. ;N (or
	// ;t1/;t2) still wins — written text is written text.
	// The first name in a chain that resolves to something PAINTABLE.
	//
	// themeSurfaceColor answers '' both for a variable the theme never
	// defined and for one it defined as fully transparent, which is exactly
	// the distinction that matters here and exactly the one a var() fallback
	// cannot make: `var(--x, --y)` falls through when --x is UNDEFINED and
	// not when --x is `transparent`. A theme that sets a surface transparent
	// is doing something reasonable; a bar that takes it literally is not.
	firstPaintable(this: WordSmith, names: string[]) {
		for (const n of names || []) {
			const c = this.themeSurfaceColor(n);
			if (c) return c;
		}
		return null;
	},

	// ───────────────────────────────────────────────────────�
	// Style properties — what the settings feed the stylesheet
	// ───────────────────────────────────────────────────────�

	// THE SHEET HAS ONE WRITER. Obsidian's plugin review forbids a plugin-made
	// <style> (obsidianmd/no-forbidden-elements), and Obsidian clones every
	// <style> of the main window into pop-outs and the settings window, so
	// styles.css reaches every window a plugin can draw in. Every rule is in
	// styles.css ("FORMERLY INJECTED", at the end, where an injected sheet
	// would stand in the cascade),
	// and what the settings decide is carried to it as a CLASS on body (the
	// indent mode, the spacing on/off, the tint on/off, the dim on/off, the
	// painters' style) or a CUSTOM PROPERTY on body (the measure, the
	// spacing, the tint colour, the dim opacity, one colour and one tint per
	// mark class). The rules read them by name; a feature that is off has no
	// class, so its rules match nothing, and no property, so a rule that did
	// match would resolve to nothing.
	//
	// EVERY NAME HERE IS A NAME IN styles.css. STYLE_CLASSES and STYLE_PROPS
	// are the complete lists, so switching a feature off removes exactly what
	// switching it on wrote — and selfcarry_probe holds the sheet to reading
	// each of them.
	applyStyleProps(this: WordSmith) {
		const body = document.body;
		if (!this.settings.pluginEnabled) { this.clearStyleProps(); return; }
		const s = this.settings;
		const cls: Record<string, boolean> = {};
		const props: Record<string, string> = {};
		// The indent's MODE. The class that switches the feature on
		// (ws-para-indent) is applyBodyClasses'; this one says which lines
		// the indent lands on. The amount is --ws-para-indent, from
		// applyCssVariables.
		cls['ws-para-single'] = this.textOpt('enableParagraphIndent', false) && s.paragraphIndentMode === 'single';
		if (this.textOpt('limitLineLength', false)) {
			// ch is the width of a "0", which is the conventional stand-in for
			// a character in a proportional face. The horizontal padding is
			// added back on top so the measure is the *text* column rather
			// than the box, whatever the padding is set to.
			props['--ws-line-measure'] = 'calc(' + Math.max(20, Math.min(200, s.maxLineChars || 64))
				+ 'ch + (var(--ws-editor-padding-h) * 2))';
		}
		// 1.5 is the theme's own line-height: at the default the rule stays
		// off and the theme decides, exactly as before.
		const ls = this.textOpt('lineSpacing', 1.5);
		cls['ws-line-spacing'] = !!(ls && ls !== 1.5);
		if (cls['ws-line-spacing']) props['--ws-line-spacing'] = String(ls);
		cls['ws-line-hl'] = !!s.highlightCurrentLine;
		if (cls['ws-line-hl']) {
			const isDark = body.classList.contains('theme-dark');
			const hex     = isDark ? s.lineHighlightDarkColor : s.lineHighlightLightColor;
			const opacity = s.lineHighlightOpacity != null ? s.lineHighlightOpacity : 0.35;
			props['--ws-line-hl-color'] = this.hexToRgba(hex, opacity);
		}
		cls['ws-dim-active'] = !!s.dimUnfocusedEnabled;
		if (cls['ws-dim-active']) props['--ws-dim-opacity'] = String(s.dimOpacity != null ? s.dimOpacity : 0.35);
		// ── Syntax highlight + writing checks ─────────────────────────────
		// One style per group — text, highlight or line — as a
		// class on body, and per mark a colour and a tint (the highlight's
		// 22% wash) as properties. Only the marks that are ON get their
		// colour, as only they got a rule before; the decorations emit a mark
		// only for a check that is on, so a mark with no colour is a mark
		// that does not exist.
		const posStyle = s.syntaxStyle || 'text';
		const ckStyle = s.checkStyle || 'line';
		for (const st of STYLE_KINDS) {
			cls['ws-pos-' + st] = !!s.posEnabled && posStyle === st;
			cls['ws-ck-' + st] = !!(s.posEnabled || s.checksEnabled) && ckStyle === st;
		}
		const paint = (cls: string, color: string | boolean) => {
			props['--' + cls + '-color'] = String(color);
			props['--' + cls + '-bg'] = this.hexToRgba(String(color), 0.22);
		};
		if (s.posEnabled) {
			for (const [k, on, color] of [
				['noun', s.posNoun,        s.posNounColor],
				['verb', s.posVerb,        s.posVerbColor],
				['adj',  s.posAdjective,   s.posAdjectiveColor],
				['adv',  s.posAdverb,      s.posAdverbColor],
				['conj', s.posConjunction, s.posConjunctionColor]
			]) if (on) paint('ws-pos-' + k, color);
		}
		if (s.checksEnabled) {
			for (const [k, on, color] of [
				['filler',   s.checkFiller,   s.checkFillerColor],
				['passive',  s.checkPassive,  s.checkPassiveColor],
				['illusion', s.checkIllusion, s.checkIllusionColor],
				['misused',  s.checkMisused,  s.checkMisusedColor],
				['pronoun',  s.checkPronoun,  s.checkPronounColor],
				['dialogue', s.checkDialogue, s.checkDialogueColor]
			]) if (on) paint('ws-ck-' + k, color);
			// Rhythm is a background tint whatever checkStyle says: a
			// line under a thirty-word sentence is noise, and the point
			// of this one is seeing a wall of a single colour at a glance.
			if (s.checkRhythm) {
				props['--ws-ck-hard-bg']     = this.hexToRgba(s.checkRhythmHardColor, 0.22);
				props['--ws-ck-veryhard-bg'] = this.hexToRgba(s.checkRhythmVeryHardColor, 0.22);
			}
		}
		// Repetition rode outside the checks guard in the old sheet, and
		// keeps that: its colour is set whenever it is on.
		if (s.checkRepetition) paint('ws-ck-repeat', s.checkRepetitionColor);
		for (const c of STYLE_CLASSES) body.classList.toggle(c, !!cls[c]);
		for (const p of STYLE_PROPS) if (!(p in props)) body.style.removeProperty(p);
		body.setCssProps(props);
	},

	// Off, or unloading: every class and property applyStyleProps can
	// write, taken back. Also a <style id="ws-injected"> left by a
	// build before 1.5.4, if a crash left one attached.
	clearStyleProps(this: WordSmith) {
		const body = document.body;
		for (const c of STYLE_CLASSES) body.classList.remove(c);
		for (const p of STYLE_PROPS) body.style.removeProperty(p);
		const old = document.getElementById('zengrinder-injected');
		if (old) old.remove();
	},

	// Turns one of the three format strings (left/center/right) into a DOM
	// fragment, substituting tokens and swapping in the live goal-bar element
	// where a gauge token appeared (rather than plain text, when the bar
	// style is chosen).
	// ════════════════════════════════════════════════════════════════════════
	// POWERLINE
	// ════════════════════════════════════════════════════════════════════════

	// The six segment colours, in the order they are written in a row.
	// Every colour in the bar comes in a dark and a light variant, and this
	// is the one place that decides which is in play. Read live rather than
	// cached: Obsidian swaps the class on the body, and the bar repaints
	// every second anyway.
	isDarkTheme(this: WordSmith) {
		try { return document.body.classList.contains('theme-dark'); }
		catch { return true; }
	},

	// WHICH SURFACE THE PLUGIN IS PAINTING ON, which is not always the
	// app's mode. A worn scheme replaces the workspace's paper, and one
	// scheme's light half is deliberately dark (Vim Blue by day IS
	// blue.vim, navy and white). Everything Word-Smith colours for itself
	// — the bar palette, the syntax classes, the letterbox, the rules, the
	// Vim mode inks — has a dark variant and a light one, and every one of
	// them was choosing by the app's mode: on that scheme they all picked
	// their LIGHT variants, which are dark inks, and painted them onto
	// navy. That is the black-on-blue a vault screenshot caught.
	//
	// The half a theme SHOWS still follows the app's mode — that is what
	// makes a theme a pair. Only the plugin's own colours follow the paper.
	isDarkSurface(this: WordSmith) {
		try {
			if (this.settings && this.settings.barThemeEnabled !== false) {
				const id = this.settings.barTheme;
				if (id && id !== 'custom') {
					const t = this.barThemeById(id);
					const h = t && this.barThemeHalf(t);
					if (h && h.b1) {
						return this.barContrast('#ffffff', h.b1)
							> this.barContrast('#000000', h.b1);
					}
				}
			}
		} catch (_) { wsCatch('isDarkSurface: if (this.settings && this.settings.barThemeEnabled !== false)', _); }
		return this.isDarkTheme();
	},
};
export type PaintMethods = typeof paintMethods;
