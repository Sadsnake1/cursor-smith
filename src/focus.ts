// Word-Smith — Focus: the writing modes and the workspace: zen, the masks, the quick panels, the sidebars, the fonts.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { MarkdownView, Notice, Platform } from 'obsidian';
import type { WorkspaceSidedock, WorkspaceMobileDrawer, WorkspaceLeaf } from 'obsidian';
import { ARROW_STYLES, MASK_MEASURE_RETRIES, WS_ARROWS_MIN_PX, WS_ARROWS_MIN_W, WS_MASK_MAX_FRAC, WS_MASK_MIN_PX, wsCatch, WS_FONT_CANDIDATES, WS_SAFE_FONTS, wsFontMatches, wsProbeInstalledFonts, wsUniqueFonts } from './preamble';
import type WordSmith from './plugin';

export const focusMethods = {

	// Where the chrome starts: the top of whatever opaque thing occupies the
	// bottom of the window, or the window's own edge if nothing does.
	//
	// The lowest point on screen the caret may occupy: whichever of the retro
	// bar's top edge and the bottom letterbox mask's top edge is higher,
	// lifted further by zen's own bottom inset so the caret stops above the
	// padding rather than inside it.
	//
	// Measured from the elements themselves rather than rebuilt from
	// settings, for the same reason as --ws-bar-reserve: the plain bar's
	// borders are stamped inline and are not in --ws-status-bar-height, and
	// the mask's height is clamped against the pane at paint time. With
	// nothing down there (bar off or slid away, letterbox off) the floor is
	// the window's own bottom edge, so zen padding alone still holds the
	// caret up.
	//
	// visualViewport rather than innerHeight: on mobile the on-screen
	// keyboard takes the bottom of the window and innerHeight does not know.
	chromeFloorY(this: WordSmith) {
		let limit = 0;
		try {
			limit = (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
		} catch { return 0; }
		const bottom = limit;
		if (!this.barIsHidden() && this.settings.enableRetroStatus && this.retroStatusBarEl) {
			try {
				const r = this.retroStatusBarEl.getBoundingClientRect();
				if (r.height > 0 && r.top > 0 && r.top < limit) limit = r.top;
			} catch { /* not laid out yet — the window edge will do */ }
		}
		// The vim ":" line opens into the gutter at the very bottom of the
		// window, INDEPENDENTLY of the bar: it is fixed to bottom: 0 and the
		// bar sits above it. So the gutter has to come off even when the bar
		// does not — with the bar hidden (by command or by zen's option) the
		// floor was the window edge, and the caret went straight under the
		// command line. A no-op while the bar is showing, since the bar's own
		// top edge is already a gutter's height further up.
		if (this.isVimKeysOn()) {
			const gutter = this.vimGutterHeight();
			if (gutter > 0 && bottom - gutter < limit) limit = bottom - gutter;
		}
		// The letterbox band is opaque, so a caret under it is as hidden as
		// one under the bar — and worse, because the mask is the feature that
		// is meant to be framing the writing rather than covering it.
		const mask = this.maskEdge(this.maskBottomEl, 'top');
		if (mask != null && mask < limit) limit = mask;
		return limit;
	},

	// Breathing room, clamped. The caret sitting exactly on the chrome's edge
	// is legible but reads as crowded, and at the bottom of a note the last
	// line ends up flush against the bar.
	caretMargin(this: WordSmith) {
		const n = Number(this.settings.caretMarginPx);
		if (!isFinite(n) || n <= 0) return 0;
		return Math.min(200, n);
	},

	caretFloorY(this: WordSmith) {
		return this.chromeFloorY() - this.caretMargin();
	},

	// The same line at the top of the window: the top letterbox mask's lower
	// edge, plus the same breathing room. With no letterbox there is nothing
	// up there, so this is the margin alone — which is still worth having,
	// because in zen the editor runs to the top of the window.
	caretCeilingY(this: WordSmith) {
		const mask = this.maskEdge(this.maskTopEl, 'bottom');
		return (mask != null && mask > 0 ? mask : 0) + this.caretMargin();
	},

	// One edge of a mask, or null when it is absent, off or unmeasured.
	// Guarded rather than trusted: the masks are torn down and rebuilt on
	// layout changes, so this can be called against an element that has just
	// been detached.
	maskEdge(this: WordSmith, el: HTMLDivElement | null, edge: string) {
		if (!el || !this.letterboxActive()) return null;
		try {
			if (el.isConnected === false) return null;
			const r = el.getBoundingClientRect();
			if (!(r.height > 0)) return null;
			return (r as unknown as Record<string, number>)[edge];
		} catch { return null; }
	},

	// Marks the MAIN window's title bar so the strip rules in styles.css can
	// target it and only it. Body classes are mirrored into pop-out windows
	// (the 1.13 settings window included), so a bare `.titlebar` selector
	// gated on those classes reached the settings window's title bar and
	// broke its dragging. An element class in this document cannot leak.
	// Called from applyBodyClasses, which runs on every refresh — including
	// the layout-change and theme-observer paths — so a recreated title bar
	// is re-stamped without its own observer.
	tagMainTitlebar(this: WordSmith) {
		const tb = document.querySelector('.titlebar');
		if (tb && !tb.classList.contains('ws-main-titlebar')) {
			tb.classList.add('ws-main-titlebar');
		}
	},

	// Hides/restores the native status bar via an inline
	// display:none!important. The class-based CSS rule alone proved
	// unreliable: themes and snippets commonly style .status-bar with
	// higher-specificity or !important rules that outrank a descendant
	// selector, which let the native bar show through the retro bar's
	// goal-met flash (whose strobe dips the retro bar's opacity). An inline
	// important declaration cannot be beaten by any stylesheet rule.
	// Whether Obsidian's own status bar should be hidden right now.
	//
	// One predicate, because there were two and they did not agree. The body
	// class was decided by zenActive() — which respects the zenEnabled
	// switch AND a per-note ws-zen override — while the inline style was
	// decided by the raw settings.zenMode flag. Both run during a refresh,
	// the inline one second, so whichever disagreed last won: toggling zen
	// could leave the class saying "show" and the inline style saying
	// "hide", or the reverse, with no way to talk either of them round.
	// The scroll bar goes when zen is told to hide it — and ALWAYS while the
	// letterbox is up, whatever the zen toggle says.
	//
	// It is the one piece of chrome the letterbox cannot cover. The masks are
	// bands across the top and bottom of the pane; the scroll bar runs the
	// full height beside them, straight past both, so it sits there as a lit
	// strip down the edge of a frame whose whole purpose is to close the page
	// off. And it moves while you write, which is precisely what the mode is
	// for getting rid of.
	//
	// Not folded into the zen toggle's own setting: that setting still means
	// what it says for zen, and a writer who has it off does not want it
	// silently flipped on by turning the letterbox on. Two reasons, one
	// answer, which is why this is a predicate rather than a longer condition
	// at the call site.
	shouldHideScrollBar(this: WordSmith) {
		if (this.zenActive() && this.settings.hideScrollBar) return true;
		return !!(this.letterboxActive() && this.isActiveFileInScope());
	},

	shouldHideNativeStatusBar(this: WordSmith) {
		// AND IN THE PLUGIN'S OWN PANES: neither bar shows there. The word
		// count under a table of word counts was the whole of its use.
		return !!(this.retroBarActive() || (this.zenActive() && this.settings.hideStatusBar)
			|| this.wsOwnViewActive());
	},

	// The arrow and separator-line colours, or null for "follow the theme".
	//
	// Its own method rather than four ternaries inside applyCssVariables:
	// null is a real answer here and it means REMOVE the properties, which
	// is easy to lose in a stamping pass that otherwise only ever writes.
	letterboxColors(this: WordSmith, isDark: boolean) {
		if (!this.settings.letterboxCustomColors) return null;
		return {
			arrow: isDark ? this.settings.arrowDarkColor : this.settings.arrowLightColor,
			line:  isDark ? this.settings.lineDarkColor  : this.settings.lineLightColor,
		};
	},

	// Zen, on and off. ONE implementation, because there were two and they
	// disagreed about what zen is.
	//
	// `zenEnabled` is the master and `zenMode` is the state, and
	// `zenActive()` needs BOTH. The Z badge moved the pair; the older
	// toggleZenMode() moved only `zenMode`, so from a vault with the master
	// off — which is the shipped default — the palette command and the
	// Escape key flipped a flag nothing reads and appeared to do nothing at
	// all. Two ways to leave zen also left the two flags in different states
	// depending on which one you used.
	//
	// So: enter sets both, leave drops the master and leaves `zenMode` where
	// it was, so the next entry restores what was set up. Everything that
	// toggles zen comes through here.
	async toggleZen(this: WordSmith) {
		if (this._isTogglingZen) return;
		this._isTogglingZen = true;
		try {
			// If the plugin is off, turn it on first — zen depends on the
			// body classes, masks and observers that refresh() sets up, none
			// of which run while pluginEnabled is false. Flipping the flag
			// here and letting saveSettings() → refresh() do the wiring means
			// this works from either state.
			if (!this.settings.pluginEnabled) this.settings.pluginEnabled = true;
			// Read from zenActive(), not from either flag: it is the question
			// the rest of the plugin asks, and answering a different one here
			// is exactly how the two implementations drifted.
			const entering = !this.zenActive();

			if (entering) {
				this.settings.zenEnabled = true;
				this.settings.zenMode    = true;
				if (this.settings.focusedFileMode) await this.revealPinnedTabIfExists();
				if (this.settings.fullscreen && document.documentElement.requestFullscreen) {
					try {
						await document.documentElement.requestFullscreen();
						await new Promise(r => window.requestAnimationFrame(r));
					} catch (_) { wsCatch('toggleZen: await document.documentElement.requestFullscreen();', _); }
				}
			} else {
				if (document.fullscreenElement && document.exitFullscreen) {
					try {
						await document.exitFullscreen();
						await new Promise(r => window.requestAnimationFrame(r));
					} catch (_) { wsCatch('toggleZen: await document.exitFullscreen();', _); }
				}
				// The master goes down, taking the letterbox with it. zenMode
				// is left alone so the next entry restores what was set up.
				this.settings.zenEnabled = false;
			}
			await this.saveSettings(true);
		} finally {
			this._isTogglingZen = false;
		}
	},

	// Kept as names, not as second implementations: the Z badge and the
	// commands read better calling something that says where it came from,
	// and there is exactly one behaviour behind them.
	toggleZenFromBar(this: WordSmith) { return this.toggleZen(); },

	toggleZenMode(this: WordSmith)    { return this.toggleZen(); },

	async toggleFullPlugin(this: WordSmith) {
		const next = !this.settings.pluginEnabled;
		if (!next && this.zenActive()) {
			// Leave zen cleanly (fullscreen, sidebars, saved state) while the
			// plugin is still enabled — toggleZen() turns it back ON once
			// pluginEnabled is false, which is the opposite of what is wanted
			// here.
			//
			// Guarded on zenActive() rather than on settings.zenMode: the two
			// disagree whenever the master is off, and toggleZen() reads the
			// former, so guarding on the latter could call a toggle that then
			// decided it was ENTERING zen on the way to disabling the plugin.
			await this.toggleZen();
		}
		this.settings.pluginEnabled = next;
		await this.saveSettings(true); // refresh() tears everything down or re-applies it
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Sidebar management (from new zen plugin)
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// ZEN CHROME: sidebars, tabs, focused-file mode
	// ════════════════════════════════════════════════════════════════════════

	// Zen as a switch, without asking what kind of pane is in front. The
	// surface gate is a separate question and syncSurfaceSidebars owns it.
	zenOn(this: WordSmith) {
		return !!(this.settings.zenEnabled && this.settings.zenMode);
	},

	// ── Quick panels ─────────────────────────────────────────────────────────
	//
	// One keystroke for what is otherwise three: open the sidebar, click
	// through to the file explorer (or the outline), and close the sidebar
	// again once you have picked something. Obsidian ships all the parts —
	// this only puts them in a sequence and hangs a one-shot listener off
	// the end of it.
	//
	// Which SIDE is never assumed. The outline is a right-sidebar view by
	// default and the explorer a left one, but either can be dragged across,
	// and a command that hardcoded the side would silently stop working for
	// anyone who had. The leaf is asked what root it is under instead.

	// The split a leaf lives in, or null if it is in the main area.
	quickPanelSplit(this: WordSmith, leaf: WorkspaceLeaf) {
		const ws = this.app.workspace;
		const root = (leaf && leaf.getRoot) ? leaf.getRoot() : null;
		if (root === ws.leftSplit)  return ws.leftSplit;
		if (root === ws.rightSplit) return ws.rightSplit;
		// Identity first, CONTAINMENT second. getRoot() returning the split
		// object itself is Obsidian's internal shape, not a promise — and
		// every caller here treats "no split" as "this leaf is in the main
		// area", which is a wrong answer rather than a missing one. A leaf's
		// element being inside the sidebar's element is the same question
		// asked in a way the DOM answers, and it cannot drift.
		const host = leaf && leaf.containerEl;
		if (host) {
			for (const split of [ws.leftSplit, ws.rightSplit]) {
				if (split && split.containerEl && split.containerEl.contains(host)) return split;
			}
		}
		return null;
	},

	// ── Quick cycle ──────────────────────────────────────────────────────────
	//
	// Directional focus across everything on screen, including the sidebars.
	// Obsidian ships `editor:focus-left` and friends, and they only move
	// between MAIN-AREA tab groups — there is no built-in way to get from a
	// note into the file explorer and back without the mouse.
	//
	// GEOMETRIC, not a fixed cycle. The panes are measured and the nearest
	// one whose centre lies in the requested direction wins. A hardcoded
	// order (left sidebar → main → right sidebar) breaks the moment the
	// layout is not that: two sidebars docked the same side, a vertical
	// editor split, a stacked group. Rects cannot be wrong about where
	// things are.
	//
	// Three behaviours chosen deliberately, all reversible if they annoy:
	//   • a COLLAPSED sidebar is OPENED and stepped into, once nothing
	//     visible lies that way. This was the other way round first, on the
	//     grounds that expanding would fight the quick panels — Alt+Left
	//     reopening the sidebar Quick file explorer had just closed. It does
	//     fight them, and it is still the right behaviour: a direction key
	//     that does nothing at the edge of a workspace teaches you not to
	//     press it, and quick cycle already disarms the panel's auto-close,
	//     so walking back in leaves you there rather than half in.
	//   • NO WRAP at the edges, so a direction key means a position rather
	//     than a rotation, and holding one cannot loop.
	//   • UP/DOWN inside a sidebar steps through its TABS (explorer, search,
	//     tags) rather than looking for a pane above or below, because in a
	//     sidebar there usually is not one and the tabs are what a writer
	//     means by "the next one".

	// The leaf that actually holds focus — including a sidebar's, which
	// getMostRecentLeaf() will not report because it only tracks the main
	// area. Asked of the DOM first: whatever contains document.activeElement
	// is the focused leaf, whatever the workspace thinks.
	quickCycleCurrentLeaf(this: WordSmith) {
		const ws = this.app.workspace;
		const active = document.activeElement;
		let found: WorkspaceLeaf | null = null;
		if (active) {
			try {
				ws.iterateAllLeaves(leaf => {
					if (found || !leaf.containerEl) return;
					if (leaf.containerEl.contains(active)) found = leaf;
				});
			} catch (_) { wsCatch('quickCycleCurrentLeaf: ws.iterateAllLeaves(leaf =>', _); }
		}
		if (found) return found;
		// Focus is nowhere in a leaf — on <body>, or in a modal, or lost
		// after a panel closed. This is what "it gets stuck" looks like:
		// activeLeaf can be a pane the writer left long ago, so every press
		// recomputes from the same wrong origin and lands in the same wrong
		// place, or nowhere. The last pane this feature actually put them in
		// is a better answer than the workspace's memory of an unrelated
		// click, and it is state we own.
		if (this._quickCycleHere && this._quickCycleHere.containerEl
			&& this._quickCycleHere.containerEl.ownerDocument === document) {
			const r = this._quickCycleHere.containerEl.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) return this._quickCycleHere;
		}
		// getMostRecentLeaf, not the deprecated activeLeaf — the API's own
		// answer, and the one the comment above already preferred.
		return ws.getMostRecentLeaf() || null;
	},

	// Every pane a writer can currently SEE, with its rectangle.
	//
	// Visibility is measured rather than reasoned about, and that one choice
	// does most of the work here: a collapsed sidebar has no width, and a
	// background tab has no box, so both drop out without either being
	// special-cased. Leaves in pop-out windows are excluded by document —
	// they are a different screen, and "left" does not mean anything across
	// two of them.
	quickCycleVisibleLeaves(this: WordSmith) {
		const out: { leaf: WorkspaceLeaf; r: DOMRect; cx: number; cy: number; }[] = [];
		try {
			this.app.workspace.iterateAllLeaves(leaf => {
				const el = leaf && leaf.containerEl;
				if (!el || el.ownerDocument !== document) return;
				const r = el.getBoundingClientRect();
				if (r.width < 1 || r.height < 1) return;
				out.push({ leaf, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
			});
		} catch (_) { wsCatch('quickCycleVisibleLeaves: this.app.workspace.iterateAllLeaves(leaf =>', _); }
		return out;
	},

	// The nearest visible pane in one direction, or null at the edge.
	quickCycleTarget(this: WordSmith, dir: string) {
		const cur = this.quickCycleCurrentLeaf();
		const host = cur && cur.containerEl;
		if (!host) return null;
		const from = host.getBoundingClientRect();
		const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
		const horizontal = (dir === 'left' || dir === 'right');

		// OVERLAP first, distance second.
		//
		// This was centre-distance with off-axis drift weighted double, and
		// that rule cannot express the common case. A full-height pane is
		// never vertically aligned with stacked neighbours — its centre sits
		// between theirs — so an adjacent stacked pane always scored worse
		// than a distant full-height one, and Alt+Right from the middle
		// column jumped over the column beside it and landed in the outline.
		// The same rule, seen from the other side, is why a sidebar with
		// stacked tabs seemed unreachable.
		//
		// So: a candidate whose cross-axis SPAN intersects the current pane's
		// is a neighbour, whatever their centres do, and the nearest
		// neighbour wins. Only when nothing overlaps — a genuinely diagonal
		// move — does centre distance decide, and the old weighting is kept
		// there because that is the case it was right for.
		const lo = horizontal ? from.top : from.left;
		const hi = horizontal ? from.bottom : from.right;

		let best = null, bestScore = Infinity, bestOverlaps = false;
		for (const c of this.quickCycleVisibleLeaves()) {
			if (c.leaf === cur) continue;
			const dx = c.cx - fx, dy = c.cy - fy;
			const along  = dir === 'left' ? -dx : dir === 'right' ? dx
				: dir === 'up' ? -dy : dy;
			// A few pixels of tolerance: two panes can share a centre on the
			// cross axis and still be side by side.
			if (along <= 4) continue;

			const cLo = horizontal ? c.r.top : c.r.left;
			const cHi = horizontal ? c.r.bottom : c.r.right;
			// A shared edge is not an overlap — two panes stacked one above
			// the other meet exactly, and counting that would make every
			// pane in a column a neighbour of every other.
			const overlaps = Math.min(hi, cHi) - Math.max(lo, cLo) > 4;

			const across = horizontal ? Math.abs(dy) : Math.abs(dx);
			const score  = overlaps ? along : along + across * 2;

			// Any overlapping candidate beats every non-overlapping one,
			// however far away it is: "one pane over" is a relationship, not
			// a distance.
			if (overlaps && !bestOverlaps) { bestOverlaps = true; bestScore = score; best = c.leaf; continue; }
			if (!overlaps && bestOverlaps) continue;
			if (score < bestScore) { bestScore = score; best = c.leaf; }
		}
		return best;
	},

	// The leaves stacked in one sidebar, in the order their tabs sit in.
	quickCycleSidebarLeaves(this: WordSmith, split: WorkspaceSidedock | WorkspaceMobileDrawer) {
		const out: WorkspaceLeaf[] = [];
		if (!split || !split.containerEl) return out;
		try {
			this.app.workspace.iterateAllLeaves(leaf => {
				if (leaf.containerEl && split.containerEl.contains(leaf.containerEl)) out.push(leaf);
			});
		} catch (_) { wsCatch('quickCycleSidebarLeaves: this.app.workspace.iterateAllLeaves(leaf =>', _); }
		return out;
	},

	// Open a shut sidebar and step into it. Returns false if there is no
	// sidebar that way, or it is already open, or it holds nothing.
	async quickCycleEnterSidebar(this: WordSmith, side: string) {
		const ws = this.app.workspace;
		const split = side === 'left' ? ws.leftSplit : ws.rightSplit;
		if (!split || !split.collapsed) return false;
		const leaves = this.quickCycleSidebarLeaves(split);
		if (!leaves.length) return false;

		// WHICH tab to land on. Every leaf in a shut sidebar measures zero,
		// so the usual "the visible one" test cannot answer it — and picking
		// the first would drop a writer on the file explorer every time,
		// however they left the sidebar. So the last tab focused in this
		// split is remembered and preferred; the first is only a fallback
		// for a sidebar not visited yet this session.
		const remembered = this._quickCycleLast && this._quickCycleLast.get(split);
		let target: WorkspaceLeaf | null = (remembered && leaves.indexOf(remembered) !== -1) ? remembered : null;

		// Nothing remembered — a fresh Obsidian, or a sidebar not visited yet
		// this session. leaves[0] is simply iteration order, which is why a
		// fresh start would open the sidebar on SEARCH rather than the file
		// tree: the writer's actual tab is the one Obsidian would show if they
		// clicked the ribbon, not the first one built. The sidebar knows which
		// that is. `children[n].currentTab` is internal, so it is read
		// defensively and only used when it names a leaf that is really in this
		// split — a wrong answer here would put the writer somewhere they never
		// chose.
		if (!target) {
			try {
				for (const group of (split.children || [])) {
					const kids = group && group.children;
					if (!kids || !kids.length) continue;
					const at = typeof group.currentTab === 'number' ? group.currentTab : 0;
					const cand = kids[at] || kids[0];
					if (cand && leaves.indexOf(cand as WorkspaceLeaf) !== -1) { target = cand as WorkspaceLeaf; break; }
				}
			} catch (_) { wsCatch('quickCycleEnterSidebar: for (const group of (split.children || []))', _); }
		}
		if (!target) target = leaves[0];
		// revealLeaf expands the split as well as raising the tab, so there
		// is no separate expand() call to keep in step with it.
		await this.quickCycleFocus(target);
		return true;
	},

	// Put the caret in a leaf without stealing the workspace's idea of what
	// the ACTIVE file is.
	//
	// setActiveLeaf on a sidebar leaf is what a main-area leaf wants and what
	// a sidebar one must not have. The outline, backlinks and their kind
	// follow the active file; make the outline itself the active leaf and
	// there is no file to follow, so it empties to "No file" — the pane you
	// just walked into blanks as you arrive. Clicking it with a mouse does
	// not do this, because Obsidian moves DOM focus and leaves the active
	// leaf where it was.
	//
	// So: the same thing the mouse does. A tabindex is added only if the view
	// has no focusable element of its own, and an existing one is preferred
	// so the view's own arrow-key handling keeps working.
	focusLeafDom(this: WordSmith, leaf: { view?: { containerEl?: HTMLElement; contentEl?: HTMLElement } | null; containerEl?: HTMLElement } | null) {
		const view = leaf && leaf.view;
		const root = (view && view.containerEl) || (leaf && leaf.containerEl);
		if (!root) return false;
		const doc = root.ownerDocument || document;

		// TRY, then CHECK. The first version took the first `[tabindex]` in
		// the view and called focus() on it, and reported success because
		// focus() had not thrown. focus() does not throw on an element that
		// cannot take focus — it does nothing at all — and the first
		// [tabindex] in a sidebar is quite often a hidden one, a collapsed
		// search box in the explorer's header being the case that bit.
		//
		// So focus stayed on <body>. Everything downstream then failed
		// quietly and for reasons that looked unrelated: the Enter meant to
		// arm the hold never landed inside the leaf, so nothing armed, so
		// the sidebar never held focus, so picking a file jumped to the
		// note. Three sessions of fixing the hold could not have worked,
		// because focus had never arrived.
		const took = (el: HTMLElement) => {
			if (!el || typeof el.focus !== 'function') return false;
			// A zero-sized element cannot take focus, and asking is cheaper
			// than discovering it afterwards.
			const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
			if (r && (r.width < 1 || r.height < 1)) return false;
			const FOCUSABLE = /^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/;
			if (!el.hasAttribute('tabindex') && !FOCUSABLE.test(el.tagName || '')) {
				el.setAttribute('tabindex', '-1');
			}
			try { el.focus({ preventScroll: true }); } catch {
				try { el.focus(); } catch (_) { wsCatch('focusLeafDom / took: el.focus();', _); }
			}
			// The only test that means anything: did it land?
			return doc.activeElement === el || root.contains(doc.activeElement);
		};

		// The view's own focusable elements first — those are what its
		// keyboard handling listens on, so landing there is what makes the
		// arrow keys work and what draws the selection a writer can see.
		// The containers are fallbacks for a view that offers none.
		const attempt = () => {
			let list: HTMLElement[] = [];
			try { list = Array.from(root.querySelectorAll<HTMLElement>('[tabindex]')); } catch (_) { wsCatch('focusLeafDom / attempt: list = Array.from(root.querySelectorAll(\'[tabindex]\'));', _); }
			for (const el of list) if (took(el)) return list.length;
			return list.length;
		};

		if (attempt() > 0) return true;

		// NONE yet. revealLeaf resolves before the view has laid itself out,
		// so a sidebar opened from collapsed reports zero focusable elements
		// at this instant and gains them a frame later. Landing on the
		// wrapper is not good enough: focus is technically inside the leaf,
		// the hold works, and the writer sees nothing — no selection in the
		// tree, and arrow keys doing nothing, because the view's own handler
		// is listening on an element that does not have focus.
		//
		// So take the wrapper now, to keep focus out of the editor, and
		// re-aim once the view exists. Two retries: a frame for the common
		// case, and a longer one for a view that builds its list from disk.
		const parked = (view && view.contentEl && took(view.contentEl)) || took(root);
		const reaim = () => {
			// Only if focus is still ours to move — the writer may have
			// clicked away in the meantime, and yanking it back then would
			// be the trap this feature is careful to avoid everywhere else.
			if (!root.contains(doc.activeElement)) return;
			attempt();
		};
		try { window.requestAnimationFrame(reaim); } catch (_) { wsCatch('focusLeafDom: window.requestAnimationFrame(reaim);', _); }
		window.setTimeout(reaim, 60);
		return parked;
	},

	// Reveal a leaf and focus it, by whichever route suits where it lives.
	async revealAndFocusLeaf(this: WordSmith, leaf: WorkspaceLeaf) {
		const ws = this.app.workspace;
		try { await ws.revealLeaf(leaf); } catch (_) { wsCatch('revealAndFocusLeaf: await ws.revealLeaf(leaf);', _); }
		// Obsidian's OWN focus first, for a sidebar as well as a main pane.
		//
		// This was DOM focus only for sidebars, to stop the outline being
		// made the active leaf and losing the file it was outlining. Four
		// attempts to make hand-rolled focus behave followed, and the
		// measurement that ended them showed why none could: at the moment
		// revealLeaf resolves the view has no focusable elements at all, so
		// focus landed on a wrapper — inside the leaf, but not on the tree
		// the view listens to. No amount of choosing a better element helps
		// when the elements do not exist yet.
		//
		// setActiveLeaf asks the VIEW to focus itself, which is what happens
		// when the sidebar is clicked, and a click has always worked. The
		// "No file" that made this look unsafe is better explained by what
		// else was happening then — toggleQuickPanel creating a fresh
		// outline leaf when it found none, and a new outline has no file
		// until one opens. If it returns, that is the place to look.
		let landed = false;
		try {
			ws.setActiveLeaf(leaf, { focus: true });
			const host = leaf.containerEl;
			landed = !!(host && host.ownerDocument
				&& host.contains(host.ownerDocument.activeElement));
		} catch (_) { wsCatch('revealAndFocusLeaf: ws.setActiveLeaf(leaf, focus: true );', _); }
		if (landed) return;
		// It did not land. Keep focus out of the editor by hand — the
		// wrapper now, re-aimed onto the view's own target once that
		// exists.
		if (this.focusLeafDom(leaf)) return;
	},

	// hjkl in the sidebars, when Vim keys are on.
	//
	// Obsidian's tree views navigate with the arrow keys and nothing else,
	// so a writer who moves by hjkl everywhere has to change hands to walk a
	// file list. The keys are free there — a tree has no text entry and no
	// type-ahead — so this translates rather than competing with anything.
	//
	// A TRANSLATION, deliberately, not a reimplementation. Obsidian's arrow
	// handling already knows about folders, collapsing, multi-select and
	// whatever it gains next; a synthetic ArrowDown inherits all of it,
	// where a hand-written "move to the next item" would inherit none and
	// would need revisiting every time the tree changed.
	quickCycleVimKey(this: WordSmith, e: KeyboardEvent) {
		if (!this.settings.quickCycle || !this.isVimKeysOn()) return;
		// Alt is the cycle's own binding — Alt+H moves BETWEEN panes, not
		// one row left inside one. Ctrl and Meta belong to whatever else
		// claims them.
		if (e.altKey || e.ctrlKey || e.metaKey) return;
		const MAP: Record<string, string> = { h: 'ArrowLeft', j: 'ArrowDown', k: 'ArrowUp', l: 'ArrowRight' };
		const arrow = MAP[e.key];
		if (!arrow) return;

		const target = e.target as HTMLElement | null;
		if (!target) return;
		// Never while typing. A sidebar holds a search box, a rename field
		// and a tag filter, and a writer typing "join" into any of them
		// means the letters.
		const tag = target.tagName || '';
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if (target.isContentEditable) return;

		// Which pane this key belongs to.
		//
		// Asking the target alone worked exactly once. Obsidian's tree
		// handling moves the selection and focus falls off the wrapper this
		// feature focused, onto <body> — so the first press translated and
		// every one after it reported `leaf: NONE` and bailed. Arrows went
		// on working throughout, because Obsidian routes THOSE through its
		// own scope and does not care what holds focus. The guard was
		// stricter than the behaviour it was imitating.
		//
		// So: the target when it is inside a leaf, and otherwise the pane
		// this feature last moved to — state we own, rather than a focus
		// position the tree view is entitled to drop.
		let leaf: WorkspaceLeaf | null = null;
		try {
			this.app.workspace.iterateAllLeaves(l => {
				if (leaf || !l.containerEl) return;
				if (l.containerEl.contains(target)) leaf = l;
			});
		} catch (_) { wsCatch('quickCycleVimKey: this.app.workspace.iterateAllLeaves(l =>', _); }
		if (!leaf) {
			// Only if focus is genuinely nowhere. A target inside the editor
			// resolves to a leaf above and is left alone there; this branch
			// must not reach past a real answer.
			const here = this._quickCycleHere;
			const host = here && here.containerEl;
			if (!host || !this.quickPanelSplit(here)) return;
			const r = host.getBoundingClientRect();
			if (r.width < 1 || r.height < 1) return;
			leaf = here;
		}
		if (!this.quickPanelSplit(leaf)) return;

		e.preventDefault();
		e.stopPropagation();
		// The constructor comes from the TARGET'S OWN window, not from the
		// bare global. In a pop-out window the global is the wrong realm and
		// the event would be rejected; and a bare `new KeyboardEvent` throws
		// a ReferenceError anywhere the global does not exist, which a
		// try/catch then swallows — leaving a key that quietly does nothing
		// and a probe that cannot see why.
		const win = (target.ownerDocument && target.ownerDocument.defaultView) || window;
		if (!win || typeof win.KeyboardEvent !== 'function') return;
		target.dispatchEvent(new win.KeyboardEvent('keydown', {
			key: arrow, code: arrow, bubbles: true, cancelable: true
		}));
	},

	// Point a sidebar view at where the writer actually is. Landing in the
	// file tree with the tree scrolled somewhere else is a half-arrival:
	// you are in the panel but have to find yourself in it. Obsidian ships
	// a command that reveals and selects the active file, so that is used
	// rather than walking its DOM — it already knows how to expand the
	// folders on the way. Only the file tree: the outline's cursor is not
	// DOM focus, and there is no selection API to reach it from outside.
	revealInSidebarView(this: WordSmith, leaf: WorkspaceLeaf) {
		const type = leaf && leaf.view && leaf.view.getViewType && leaf.view.getViewType();
		if (type !== 'file-explorer') return;
		if (!this.app.workspace.getActiveFile()) return;
		try { this.app.commands.executeCommandById('file-explorer:reveal-active-file'); } catch (_) { wsCatch('revealInSidebarView: this.app.commands.executeCommandById(\'file-explorer:reveal-active-file …', _); }
	},

	async quickCycleFocus(this: WordSmith, leaf: WorkspaceLeaf) {
		const ws = this.app.workspace;
		// Remember where a writer was in each sidebar, so re-entering it
		// returns them rather than resetting them.
		const split = this.quickPanelSplit(leaf);
		if (split) {
			if (!this._quickCycleLast) this._quickCycleLast = new Map();
			this._quickCycleLast.set(split, leaf);
		}
		await this.revealAndFocusLeaf(leaf);
		this.revealInSidebarView(leaf);
		// Remembered as the origin for the next press, so a move still
		// works from a pane whose view has dropped focus.
		this._quickCycleHere = leaf;
		void ws;
	},

	// Shut the sidebar a move has just LEFT, when the writer asked for that.
	//
	// Leaving is the only trigger. Picking a file or a heading does not close
	// anything — that behaviour existed, was removed, and this is not it
	// coming back: it fires on a direction key, which is a deliberate "I am
	// done here", and never on a selection, which is not.
	//
	// Stepping between TABS of the same sidebar is not leaving it, so the
	// destination's split is compared rather than just checking that the
	// origin was a sidebar.
	quickCycleCloseBehind(this: WordSmith, fromSplit: WorkspaceSidedock | WorkspaceMobileDrawer | null, target: WorkspaceLeaf | null) {
		if (!fromSplit || !this.settings.quickCycleCloseOnLeave) return;
		if (target && this.quickPanelSplit(target) === fromSplit) return;
		// After the focus has moved, never before: collapsing a split while
		// the caret is still inside it drops focus on the floor, and the
		// next keystroke goes nowhere.
		try { if (!fromSplit.collapsed) fromSplit.collapse(); } catch (_) { wsCatch('quickCycleCloseBehind: if (!fromSplit.collapsed) fromSplit.collapse();', _); }
	},

	async quickCycleMove(this: WordSmith, dir: string) {
		const ws = this.app.workspace;
		const cur = this.quickCycleCurrentLeaf();
		// Captured BEFORE anything moves — afterwards the current leaf is
		// the destination and the origin is unrecoverable.
		const fromSplit = cur ? this.quickPanelSplit(cur) : null;

		// Vertical inside a sidebar means the next TAB, not the next pane.
		if ((dir === 'up' || dir === 'down') && cur) {
			const split = this.quickPanelSplit(cur);
			if (split) {
				const leaves = this.quickCycleSidebarLeaves(split);
				const at = leaves.indexOf(cur);
				const next = leaves[at + (dir === 'down' ? 1 : -1)];
				// No wrap: at the last tab, stop. Falling through to the
				// geometric search instead would jump out of the sidebar
				// sideways, which is not what a down-arrow asked for.
				if (at !== -1) { if (next) await this.quickCycleFocus(next); return; }
			}
		}

		const target = this.quickCycleTarget(dir);
		if (target) {
			await this.quickCycleFocus(target);
			this.quickCycleCloseBehind(fromSplit, target);
			return;
		}

		// Nothing visible that way. A shut sidebar on that side is still
		// somewhere to go — and it is only reachable here, AFTER the
		// geometric search has failed, which is what keeps it from stealing
		// a move that had a real destination.
		if (dir === 'left' || dir === 'right') {
			const entered = await this.quickCycleEnterSidebar(dir);
			// Crossing from one sidebar to the other still closes the first.
			if (entered) this.quickCycleCloseBehind(fromSplit, this.quickCycleCurrentLeaf());
		}
		void ws;
	},

	// WHICH SIDE A PANEL BELONGS ON. One table, asked by both ways in, so a
	// new panel cannot be right in one place and wrong in the other:
	// backlinks is a right-hand pane in every stock Obsidian layout, and
	// creating it on the left would put it where the writer's file tree
	// lives. It decides where a panel is CREATED, not where it is found: a
	// writer who has dragged their backlinks to the left keeps it there,
	// because an existing leaf is always used before a new one is made.
	sidebarSideFor(this: WordSmith, viewType: string) {
		return (viewType === 'outline' || viewType === 'backlink') ? 'right' : 'left';
	},

	// Open the pane a bar token is a summary of, and put it away again.
	//
	// The gesture is the ribbon's: press to show, press again to hide. That
	// is what a writer already does to these two panes, and a token that only
	// ever opened would leave them reaching for a different control to close
	// what the first one opened.
	//
	// IT DOES NOT TAKE THE CARET. `toggleQuickPanel` focuses the panel it
	// opens, because it is a keyboard command and being put in the thing you
	// summoned is the whole point of one. This is a mouse click on a status
	// bar, usually mid-sentence: revealing the pane answers the question, and
	// stealing focus from the editor to do it would make a glance cost a
	// click back. The explorer still SELECTS the note — that is the reading
	// being expanded, not a change of where the writer is typing.
	async openSidebarPanel(this: WordSmith, viewType: string) {
		const ws = this.app && this.app.workspace;
		if (!ws || !ws.getLeavesOfType) return;
		let leaf = null;
		try { leaf = ws.getLeavesOfType(viewType)[0] || null; } catch { return; }

		// Showing already? Then this press is the second one. Measured the
		// way toggleQuickPanel measures it — a leaf in a collapsed split is
		// still a leaf, and only its height says whether anyone can see it.
		if (leaf) {
			const split = this.quickPanelSplit(leaf);
			const host  = leaf.containerEl || (leaf.view && leaf.view.containerEl);
			if (split && !split.collapsed && host && host.offsetHeight > 0) {
				split.collapse();
				return;
			}
		}

		// No leaf of this type anywhere — the writer closed it, or a stripped
		// layout never had one. Make it, rather than doing nothing: a control
		// that silently fails is indistinguishable from a broken one.
		if (!leaf) {
			const right = this.sidebarSideFor(viewType) === 'right';
			const side = right ? ws.getRightLeaf(false) : ws.getLeftLeaf(false);
			if (!side) return;
			leaf = side;
			try { await leaf.setViewState({ type: viewType, active: true }); } catch { return; }
		}

		// revealLeaf expands whichever split it is in and brings its tab to
		// the front, so there is no separate expand() to keep in step.
		try { await ws.revealLeaf(leaf); } catch (_) { wsCatch('openSidebarPanel: await ws.revealLeaf(leaf);', _); }
		// …and the explorer scrolls to the note the token was naming. Without
		// it, pressing {file} on a scene four folders down opens a tree
		// scrolled wherever it was last left, which answers a different
		// question from the one that was asked.
		this.revealInSidebarView(leaf);
	},

	// Open the sidebar on a panel and focus it; run it again to close. A
	// true toggle over Obsidian's own API, and not one that closes itself
	// the moment you pick a file — that needs capture-phase listeners on a
	// leaf Obsidian owns and a dependency on its row classes, and
	// `file-open` is not a hook to build it on: it does not fire when the
	// file picked is the one already open.
	async toggleQuickPanel(this: WordSmith, viewType: string) {
		const ws = this.app.workspace;
		let leaf = ws.getLeavesOfType(viewType)[0] || null;

		// Already showing? Then this is the close half of the toggle, and it
		// closes whether or not this command is what opened it. Running the
		// command again is now the ONLY way it closes — see below.
		if (leaf) {
			const split = this.quickPanelSplit(leaf);
			const host  = leaf.containerEl || (leaf.view && leaf.view.containerEl);
			const shown = split && !split.collapsed && host && host.offsetHeight > 0;
			if (shown) {
				split.collapse();
				return;
			}
		}

		// No leaf of this type anywhere — the writer closed it, or never had
		// it. Make one rather than doing nothing: a command that silently
		// fails is indistinguishable from a broken hotkey.
		if (!leaf) {
			// One table, shared with openSidebarPanel — see sidebarSideFor.
			const side = this.sidebarSideFor(viewType) === 'right'
				? ws.getRightLeaf(false) : ws.getLeftLeaf(false);
			if (!side) return;
			leaf = side;
			try { await leaf.setViewState({ type: viewType, active: true }); } catch { return; }
		}

		// revealLeaf expands whichever split it is in and brings its tab to
		// the front; revealAndFocusLeaf then puts the caret in it, by DOM
		// focus rather than setActiveLeaf because this is always a sidebar
		// and an outline made ACTIVE has no file left to outline.
		await this.revealAndFocusLeaf(leaf);
	},

	setSidebarVisibility(this: WordSmith) {
		// zenOn(), not settings.zenMode. Leaving zen drops the MASTER and
		// leaves zenMode where it was, so that raw flag does not change on
		// the way out — this compared it against its own last value, saw no
		// change, and returned. The sidebars stayed collapsed after leaving
		// zen, and never collapsed again on the way back in, because by then
		// zenMode had been true the whole time.
		const on = this.zenOn();
		if (on === this._wasZenMode) return;
		const ws = this.app.workspace;
		if (!ws.leftSplit || !ws.rightSplit) return;
		if (!on) {
			if (!this.settings.leftSidebar)  ws.leftSplit.expand();
			if (!this.settings.rightSidebar) ws.rightSplit.expand();
		} else {
			this.settings.rightSidebar = ws.rightSplit.collapsed;
			this.settings.leftSidebar  = ws.leftSplit.collapsed;
			if (!ws.leftSplit.collapsed)  ws.leftSplit.collapse();
			if (!ws.rightSplit.collapsed) ws.rightSplit.collapse();
		}
		this._wasZenMode = on;
	},

	// The other half of the surface gate. Zen's body classes come off on a
	// canvas by themselves (zenActive() is false there), but the collapsed
	// sidebars are workspace state, not CSS — nothing lifts them, and a
	// canvas with no sidebars and no way to tell why is exactly the "the
	// plugin is still here" complaint the gate exists to answer.
	//
	// Keeps its own record rather than touching leftSidebar/rightSidebar.
	// Those two belong to the zen TOGGLE — they are what the sidebars go
	// back to when zen is turned off — and overwriting them on a tab change
	// would make "leave zen" restore whatever happened to be true the last
	// time a canvas was open.
	//
	// Transition-guarded: it acts when the answer changes, never on every
	// leaf change, so a sidebar the writer opens by hand on a canvas is not
	// fought with.
	syncSurfaceSidebars(this: WordSmith) {
		const ws = this.app.workspace;
		if (!ws || !ws.leftSplit || !ws.rightSplit) return;
		const suspend = !!(this.settings.pluginEnabled
			&& this.zenOn()
			&& !this.isNoteSurfaceActive());
		if (suspend === !!this._sidebarsSuspended) return;
		this._sidebarsSuspended = suspend;
		try {
			if (suspend) {
				this._suspendedLeft  = !!ws.leftSplit.collapsed;
				this._suspendedRight = !!ws.rightSplit.collapsed;
				if (ws.leftSplit.collapsed)  ws.leftSplit.expand();
				if (ws.rightSplit.collapsed) ws.rightSplit.expand();
			} else {
				if (this._suspendedLeft)  ws.leftSplit.collapse();
				if (this._suspendedRight) ws.rightSplit.collapse();
			}
		} catch (_) { wsCatch('syncSurfaceSidebars: if (suspend)', _); }
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Focused file mode (from new zen plugin)
	// ─────────────────────────────────────────────────────────────────────────

	getTabContainerFromLeaf(this: WordSmith, leaf: WorkspaceLeaf) {
		if (!leaf) return null;
		const el = leaf.containerEl || null;
		if (!el) return null;
		const tc = el.closest('.workspace-tabs');
		return tc && tc.instanceOf(HTMLElement) ? tc : null;
	},

	async revealPinnedTabIfExists(this: WordSmith) {
		try {
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves) {
				let pinned = leaf.pinned === true;
				if (!pinned && leaf.view && leaf.view.getState) {
					const s = leaf.view.getState();
					if (s.pinned === true) pinned = true;
				}
				if (!pinned && leaf.containerEl) {
					const th = leaf.containerEl.querySelector('.workspace-tab-header');
					if (th && (th.classList.contains('is-pinned') || th.hasAttribute('data-pinned'))) pinned = true;
				}
				if (pinned) {
					await this.app.workspace.revealLeaf(leaf);
					await new Promise(r => window.requestAnimationFrame(() => window.requestAnimationFrame(r)));
					return;
				}
			}
		} catch (_) { wsCatch('revealPinnedTabIfExists: const leaves = this.app.workspace.getLeavesOfType(\'markdown\');', _); }
	},

	// Focused-file mode writes inline display/width/flex onto tab
	// containers. Putting those back is NOT the same as blanking them:
	// `.workspace-tabs` is EVERY tab container in the workspace, including
	// the ones stacked inside the left and right sidedocks — and Obsidian
	// stores the size of stacked leaves as inline `flex-grow` on exactly
	// those elements, so a blanket clear wipes the sizes Obsidian wrote and
	// two differently-sized panes in a sidebar come back the same height.
	// So: remember an element's inline values the first time we touch it,
	// put exactly those back, and touch nothing we did not write to.
	//
	// THE LONGHANDS, NOT THE SHORTHAND (GitHub #13). The shorthand of an
	// element carrying only `flex-grow` reads as "" in Chromium, because a
	// shorthand only serialises when every longhand it covers is set — and
	// Obsidian writes exactly that, `flex-grow: 2.6;` and nothing else. So
	// "put back what was there" through the shorthand writes "", which
	// clears all three longhands, and the size Obsidian had stored is gone.
	// A bare DOM's CSSOM answers "2.6" for the shorthand, so the zen test
	// models Chromium's rule itself.
	_focusTabRemember(this: WordSmith, el: HTMLElement) {
		if (!this._focusTabPrev) this._focusTabPrev = new Map();
		if (this._focusTabPrev.has(el)) return;
		const s = el.style;
		this._focusTabPrev.set(el, {
			display:    s.display,
			width:      s.width,
			flexGrow:   s.flexGrow,
			flexShrink: s.flexShrink,
			flexBasis:  s.flexBasis
		});
	},

	_focusTabRestore(this: WordSmith) {
		if (!this._focusTabPrev || !this._focusTabPrev.size) return;
		for (const [el, prev] of this._focusTabPrev) {
			el.classList.remove('zenmode-tab-hidden', 'zenmode-tab-active');
			el.style.display    = prev.display;
			el.style.width      = prev.width;
			el.style.flexGrow   = prev.flexGrow;
			el.style.flexShrink = prev.flexShrink;
			el.style.flexBasis  = prev.flexBasis;
		}
		this._focusTabPrev.clear();
	},

	findActiveTabContainerFromDOM(this: WordSmith) {
		const active = document.querySelector('.workspace-tab-header.is-active');
		if (active) {
			const tc = active.closest('.workspace-tabs');
			// Obsidian's instanceOf, not instanceof: a pop-out's elements are
			// another window's HTMLElement.
			if (tc && tc.instanceOf(HTMLElement)) return tc;
		}
		for (const c of Array.from(document.querySelectorAll('.workspace-tabs'))) {
			const el = c;
			if (el.offsetParent !== null && !el.classList.contains('zenmode-tab-hidden')) return el;
		}
		return null;
	},

	async updateFocusedFileMode(this: WordSmith) {
		// zenActive() rather than settings.zenMode: on a canvas or a base
		// zen is suspended, and hiding every tab container but one there
		// would leave the writer no way back to their note.
		if (!this.zenActive() || !this.settings.focusedFileMode) {
			this._focusTabRestore();
			return;
		}
		await this.revealPinnedTabIfExists();
		if (!this._tabContainersCache) {
			this._tabContainersCache = Array.from(document.querySelectorAll('.workspace-tabs'));
		}
		const all = this._tabContainersCache;
		let active = null;
		for (const c of all) {
			const pinned = c.querySelectorAll('.workspace-tab-header.is-pinned, .workspace-tab-header[data-pinned="true"]');
			if (pinned.length > 0) { active = c; break; }
		}
		if (!active) {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) active = this.getTabContainerFromLeaf(leaf);
		}
		if (!active) active = this.findActiveTabContainerFromDOM();
		if (!active) return;
		all.forEach(c => {
			this._focusTabRemember(c);
			if (c === active) {
				// INLINE ON PURPOSE: Obsidian sizes these containers with an inline
				// flex-grow of its own, and no class beats an inline value. The
				// remembered values go back in _focusTabRestore.
				c.classList.remove('zenmode-tab-hidden');
				c.style.removeProperty('display');
				c.setCssStyles({ width: '100%', flex: '1 1 100%' });
			} else {
				c.classList.add('zenmode-tab-hidden');
				c.setCssStyles({ display: 'none' });
			}
		});
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Workspace aesthetics (letterbox + retro bar)
	// ─────────────────────────────────────────────────────────────────────────

	updateWorkspaceAesthetics(this: WordSmith) {
		// Event handlers (active-leaf-change etc.) call this unconditionally;
		// without this guard, opening a note rebuilds the retro bar and masks
		// even while the plugin is toggled off.
		if (!this.settings.pluginEnabled) return;
		// Retro status bar: independent of zen mode
		this.updateStatusBar();
		this.updateRetroStatusBar();

		// (Focus dimming and hidden markers are CM6 decorations registered
		// once via registerEditorExtension — they follow every editor
		// automatically and need no per-leaf re-binding here.)

		// Letterbox masks + typewriter: driven by enableTypewriter, not zenMode,
		// and only where the plugin is scoped to apply.
		const scoped = this.isActiveFileInScope();
		// Masks follow letterbox, not typewriter. They are separate features
		// and toggling one should never silently take the other with it.
		if (this.letterboxActive() && scoped) {
			this.buildMaskElements();
		} else {
			this.removeMaskElements();
		}

		// Positioning (masks AND/OR retro bar width) needs the scroll/resize
		// wiring whenever either feature is visible.
		if (((this.settings.enableTypewriter || this.letterboxActive()) && scoped) || this.retroBarActive()) {
			this.attachScrollHandler();
			this.attachResizeHandler();
			this.scheduleMaskPosition();
		} else {
			this.detachScrollHandler();
			this.detachResizeHandler();
		}
	},

	// Remove only mask/arrow elements (not the retro bar)
	removeMaskElements(this: WordSmith) {
		for (const el of [this.maskTopEl, this.maskBottomEl, this.arrowsTopEl, this.arrowsBottomEl,
			this.maskGuardLeftEl, this.maskGuardRightEl]) {
			if (el) el.remove();
		}
		this.maskTopEl = this.maskBottomEl = this.arrowsTopEl = this.arrowsBottomEl = null;
		this.maskGuardLeftEl = this.maskGuardRightEl = null;
		document.documentElement.setCssProps({ '--ws-scroller-pad-top': '0px', '--ws-scroller-pad-bottom': '0px' });
		if (this.maskResizeObserver) { this.maskResizeObserver.disconnect(); this.maskResizeObserver = null; }
	},

	// Focus mode and letterbox are the two halves of Zen. Letterbox used to be
	// gated on typewriter instead, which is why turning typewriter off took
	// the masks with it — two unrelated features sharing one flag.
	zenActive(this: WordSmith) {
		// Zen's chrome hiding is the one part of the plugin that is
		// deliberately NOT scoped to the path list (see the Scope section in
		// ARCHITECTURE.md) — but it is still scoped to notes. Hiding the
		// ribbon, the properties row and the status bar around a canvas
		// removes controls that canvas actually needs and hides nothing
		// distracting, since none of it is text.
		//
		// zenMode stays true underneath: this suspends the effect, it does
		// not turn the mode off, so tabbing back to the note restores it
		// without the writer having to re-enter zen.
		if (!this.isNoteSurfaceActive()) return false;
		return !!(this.opt('zenEnabled') && this.opt('zenMode'));
	},

	letterboxActive(this: WordSmith) {
		// A mode of its own since it joined the Modes popup. Gating it on
		// zenEnabled meant leaving Focus killed the letterbox and made the
		// popup's Letterbox toggle a dead switch whenever zen was off.
		if (!this.settings.enableLetterbox) return false;
		// Not in reading view. The masks exist to hide the strip above and
		// below the LINE YOU ARE WRITING — they are the frame around a moving
		// caret, and reading has no caret. In preview they are two bands
		// covering the top and bottom of something you are trying to read,
		// with arrows pointing at nothing.
		return !this.isReadingView();
	},

	// Reading mode, asked of the view rather than the DOM. Obsidian keeps both
	// containers alive and toggles which is shown (see stampMaskPositions), so
	// "is there a .markdown-preview-view" is not the question — getMode() is.
	isReadingView(this: WordSmith) {
		try {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return false;
			const mode = view.getMode ? view.getMode() : null;
			return mode === 'preview';
		} catch { return false; }
	},

	getConfiguredFonts(this: WordSmith) {
		let raw = '';
		try {
			if (this.app.vault.getConfig) {
				const cfg = this.app.vault.getConfig('textFontFamily');
				raw = Array.isArray(cfg) ? cfg.join(',') : (typeof cfg === 'string' ? cfg : '');
			}
		} catch { raw = ''; }
		if (!raw) {
			try { raw = getComputedStyle(document.body).getPropertyValue('--font-text') || ''; }
			catch { raw = ''; }
		}
		// Everything Obsidian appends as a fallback, plus the CSS generics.
		const GENERIC = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif',
			'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
			'ui-monospace', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
			'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
			'Helvetica', 'Arial', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol']);
		const seen = new Set();
		const out  = [];
		for (const part of String(raw).split(',')) {
			const name = part.trim().replace(/^["']|["']$/g, '');
			if (!name || GENERIC.has(name) || seen.has(name)) continue;
			seen.add(name);
			out.push(name);
		}
		return out;
	},

	// Every font family this machine has, for the export window's font box.
	// SYNCHRONOUS ON PURPOSE: a painting list cannot await, so this returns
	// the best answer available right now — the seven, until
	// ensureSystemFonts has come back, and everything after that. The box
	// repaints when the promise lands.
	systemFontNames(this: WordSmith) {
		const parts = [];
		// THE FONT IN USE IS FIRST. Opening the list on the face the
		// manuscript is already set in is the difference between a list you
		// read and a list you check.
		try {
			const cur = this.settings && this.settings.exportOpts && this.settings.exportOpts.font;
			if (cur) parts.push(cur);
		} catch (_) { wsCatch('systemFontNames: const cur = this.settings && this.settings.exportOpts && …', _); }
		// Then the vault's own faces — a writer who added a font under
		// Appearance has already said it is one they use.
		try { for (const n of this.getConfiguredFonts()) parts.push(n); } catch (_) { wsCatch('systemFontNames: for (const n of this.getConfiguredFonts()) parts.push(n);', _); }
		// Then the machine's, alphabetical: four hundred families in
		// whatever order the OS enumerated them is not a list.
		const found = (this._sysFonts && this._sysFonts.length)
			? this._sysFonts.slice() : WS_SAFE_FONTS.slice();
		found.sort((a, b) => String(a).localeCompare(String(b)));
		for (const n of found) parts.push(n);
		for (const n of WS_SAFE_FONTS) parts.push(n);
		return wsUniqueFonts(parts);
	},

	// Is this name one of the faces we found? A typed name that is not is
	// still ACCEPTED — the box is not a gate — it simply says so, because
	// silent substitution in the reader's word processor is the failure the
	// old fixed list existed to prevent. An empty name is "installed": there
	// is nothing to warn about, and the export falls back to Times.
	fontIsInstalled(this: WordSmith, name: string) {
		const key = String(name == null ? '' : name).trim().toLowerCase();
		if (!key) return true;
		const list = (this._sysFonts && this._sysFonts.length) ? this._sysFonts : WS_SAFE_FONTS;
		for (const n of list) if (String(n).toLowerCase() === key) return true;
		try {
			for (const n of this.getConfiguredFonts()) if (String(n).toLowerCase() === key) return true;
		} catch (_) { wsCatch('fontIsInstalled: for (const n of this.getConfiguredFonts()) if (String(n).toLowerCase() …', _); }
		return false;
	},

	fontFinderMatches(this: WordSmith, q: string, limit: number) {
		return wsFontMatches(q, this.systemFontNames(), limit);
	},

	// Ask the machine what it has, once — and once MORE if the first answer
	// came from the sieve rather than from the API. queryLocalFonts wants a
	// transient activation behind it: called without one it rejects, and a
	// single failed attempt would otherwise cost the writer the real list
	// for the whole session. Asking again the next time they touch the box
	// costs nothing and usually succeeds, because touching the box IS the
	// gesture. Never rejects: a font list is not worth a broken window.
	ensureSystemFonts(this: WordSmith) {
		if (this._sysFontsFrom === 'local') return Promise.resolve(this._sysFonts || []);
		if (this._sysFontsQ != null) return this._sysFontsQ;
		const done = (names: string[], from: string) => {
			const list = wsUniqueFonts(names);
			if (list.length) { this._sysFonts = list; this._sysFontsFrom = from; }
			this._sysFontsQ = null;
			return this._sysFonts || [];
		};
		this._sysFontsQ = (async () => {
			try {
				if (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function') {
					const data = await window.queryLocalFonts();
					const fams = [];
					// `family` is the name a stylesheet and a .docx both want;
					// fullName carries the weight and style with it ("Garamond
					// Bold Italic"), which is not a family and is not what
					// either file should be given.
					for (const f of (data || [])) if (f && f.family) fams.push(f.family);
					if (fams.length) return done(fams, 'local');
				}
			} catch {
				// Refused, unsupported, or asked without a gesture. The sieve
				// is the answer for all three.
			}
			return done(wsProbeInstalledFonts(WS_FONT_CANDIDATES), 'probe');
		})().catch(() => { this._sysFontsQ = null; return this._sysFonts || []; });
		return this._sysFontsQ;
	},

	// Stamped separately from the rest of applyCssVariables because the value
	// can change per note, and so has to be re-applied on every file switch
	// rather than only on a settings change.
	applyEditorFont(this: WordSmith) {
		const font = this.settings.pluginEnabled && this.isActiveFileInScope()
			? String(this.opt('editorFont') || '')
			: '';
		if (font) document.body.style.setProperty('--ws-font', font);
		else      document.body.style.removeProperty('--ws-font');
		document.body.classList.toggle('ws-font-active', !!font);
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Typewriter scroll
	// ─────────────────────────────────────────────────────────────────────────

	typewriterScroll(this: WordSmith) {
		if (!this.settings.pluginEnabled || !this.settings.enableTypewriter) return;
		if (!this.isActiveFileInScope()) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const scroller = view.contentEl.querySelector('.cm-scroller');
		if (!scroller) return;
		let lineTop, lineHeight;
		const activeLine = view.contentEl.querySelector('.cm-active-line');
		if (activeLine) {
			const sr = scroller.getBoundingClientRect();
			const lr = activeLine.getBoundingClientRect();
			lineTop = lr.top - sr.top + scroller.scrollTop;
			lineHeight = lr.height;
		} else {
			const cm = view.editor && view.editor.cm;
			if (!cm) return;
			try {
				const coords = cm.coordsAtPos(cm.state.selection.main.head);
				if (!coords) return;
				const sr = scroller.getBoundingClientRect();
				lineTop = coords.top - sr.top + scroller.scrollTop;
				lineHeight = coords.bottom - coords.top;
			} catch { return; }
		}
		// WHERE THE CARET RESTS: a percentage of the editor's height, clamped
		// and read through one accessor so the scroll, the padding and the
		// settings slider can never disagree about it.
		const ratioAbove = this.typewriterAnchorRatio();
		const target = lineTop + lineHeight / 2 - scroller.clientHeight * ratioAbove;
		if (Math.abs(scroller.scrollTop - target) < 1) return;
		scroller.scrollTop = target;
	},

	// 0..1. The single source of truth for the caret's resting height —
	// typewriterScroll scrolls to it and the scroller padding is derived
	// from it, so the caret can actually REACH it at the top and bottom of
	// a document. Clamped here rather than at every call site.
	typewriterAnchorRatio(this: WordSmith) {
		const raw = this.settings.typewriterAnchor;
		const pct = (raw == null || isNaN(Number(raw))) ? 50 : Number(raw);
		return Math.max(0, Math.min(100, pct)) / 100;
	},

	// HEMINGWAY SAYS WHY. The flash says no; it does not say what, or where
	// to turn it off. So the first blocked gesture after the lock is
	// switched on gets one line, naming the gesture and the tab — and then
	// the flash alone, as before. Once per switch-on, not per key:
	// `_hemSaid` is cleared where the toggle is, so a writer who turns the
	// lock on again is told again.
	hemingwaySay(this: WordSmith, what: string) {
		if (this._hemSaid) return false;
		this._hemSaid = true;
		try {
			new Notice('Word-Smith: Hemingway mode is on — ' + (what || 'that key')
				+ ' is blocked while it is. Settings → Hemingway to change what it blocks.', 8000);
		} catch (_) { wsCatch('hemingwaySay: new Notice(\'Word-Smith: Hemingway mode is on — \' + (what || \'that …', _); }
		return true;
	},

	// ════════════════════════════════════════════════════════════════════════
	// GOAL INDICATOR
	// ════════════════════════════════════════════════════════════════════════






	// ─────────────────────────────────────────────────────────────────────────
	// Letterbox mask system
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// LETTERBOX MASKS + TYPEWRITER SCROLL
	// ════════════════════════════════════════════════════════════════════════

	buildMaskElements(this: WordSmith) {
		for (const el of [this.maskTopEl, this.maskBottomEl, this.arrowsTopEl, this.arrowsBottomEl,
			this.maskGuardLeftEl, this.maskGuardRightEl]) {
			if (el) el.remove();
		}
		this.maskTopEl = this.maskBottomEl = this.arrowsTopEl = this.arrowsBottomEl = null;
		this.maskGuardLeftEl = this.maskGuardRightEl = null;
		if (this.maskResizeObserver) { this.maskResizeObserver.disconnect(); this.maskResizeObserver = null; }

		if (!this.letterboxActive()) return;
		if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return;

		// Arrays, not space-separated strings (invariant 11). The modifier
		// class is now load-bearing — the drag-region rule in styles.css
		// targets the TOP mask only — so it must not depend on how createEl
		// happens to parse a string this release.
		this.maskTopEl    = document.body.createDiv({ cls: ['ws-mask', 'ws-mask-top'] });

		this.maskBottomEl = document.body.createDiv({ cls: ['ws-mask', 'ws-mask-bottom'] });

		const chars = this.getArrowChars();
		this.arrowsTopEl    = this.buildArrowLayer('top',    chars.top);
		// Window-control guards. The mask grants `drag` over the whole
		// band, and it is appended AFTER Obsidian's title bar — so by DOM
		// order its grant RE-UNIONED the minimize/maximize/close corner
		// that the buttons had subtracted, and the buttons stopped being
		// clickable. Regions cannot be defended by whoever comes first;
		// the corner has to be subtracted by something LATER. These are
		// that something: two no-drag rectangles sized from the same
		// notch numbers as the visual carve-out, appended after the arrow
		// layers so nothing in the mask stack follows them. Invariant 12
		// in its plainest form — last element wins the overlap.
		this.maskGuardLeftEl  = document.body.createDiv({ cls: ['ws-mask-guard'] });
		this.maskGuardRightEl = document.body.createDiv({ cls: ['ws-mask-guard'] });
		// Taken out of flow AT CREATION, not at the first positioning pass:
		// between the two they would be ordinary block children of <body>,
		// and an element in the flow is a layout shift however briefly it
		// lasts. They are revealed by stampMaskPositions once they have
		// real geometry.
		// (`.ws-mask-guard` is fixed, inert and hidden until placed —
		// styles.css; stampMaskPositions gives it a box and the `is-placed` class.)
		this.arrowsBottomEl = this.buildArrowLayer('bottom', chars.bottom);

		const scroller = this.getActiveScroller();
		if ('ResizeObserver' in window) {
			this.maskResizeObserver = new ResizeObserver(() => this.scheduleMaskPosition());
			if (scroller) this.maskResizeObserver.observe(scroller);
			// The BAR is watched too. The mask stops at the bar's measured
			// top edge, and that edge moves for reasons this code does not
			// otherwise hear about: the border width is stamped inline
			// (up to 8px on each edge, and NOT included in
			// --ws-status-bar-height), the vertical padding is a setting,
			// the row height is a setting, and the font size changes the
			// row. Any of those repainting after the mask was last stamped
			// left the hairline of bare editor between the two. Observing
			// the element means the mask re-stamps whenever its box
			// actually changes, whatever caused it.
			if (this.retroStatusBarEl) this.maskResizeObserver.observe(this.retroStatusBarEl);
		}
		this.updateMaskVisibility();
	},

	// How much of the top of the window belongs to the frame rather than to
	// the note.
	//
	// Not used to push the mask down — that was the first attempt at Obsidian
	// 1.13 hiding the window controls, and it left a bare strip above the
	// letterbox the height of the title bar. The mask covers the top edge as
	// it always did; the controls are lifted above it in CSS instead. This is
	// kept because knowing where the frame ends is genuinely useful and the
	// probe is the awkward part.
	//
	// The overlay API is asked first because it is exact and version-proof:
	// getTitlebarAreaRect() returns the strip the page may use, and its height
	// is the band the frame reserves. The element lookup is a fallback for
	// builds without it, and tries more than one class — the one Obsidian uses
	// has changed before.
	titlebarAreaHeight(this: WordSmith) {
		try {
			const o = navigator.windowControlsOverlay;
			if (o && o.visible && o.getTitlebarAreaRect) {
				const r = o.getTitlebarAreaRect();
				if (r && r.height) return Math.round(r.height);
			}
		} catch { /* not an Electron build with the overlay */ }
		try {
			for (const sel of ['.titlebar', '.workspace-drag-region', '.titlebar-button-container']) {
				const el = document.querySelector(sel);
				if (!el) continue;
				const r = el.getBoundingClientRect();
				if (r && r.height && r.top <= 0) return Math.round(r.height);
			}
		} catch (_) { wsCatch('titlebarAreaHeight: for (const sel of [\'.titlebar\', \'.workspace-drag-region\', …', _); }
		return 0;
	},

	// Everything the bar caches is measured in CSS pixels, and a zoom step
	// changes what a CSS pixel is worth. Three of those caches then hold
	// values that were right at the old scale and are wrong at the new one:
	//
	//   _barBoundsL/W   the stamped left and width, skipped as "unchanged"
	//                   because the numbers match even though the pane moved
	//   _barReserve     the same, for the strip under the bar
	//   _fitShortenFile the path-shortening latch, which only lets go once
	//                   the row is FIT_RESTORE_MARGIN wider than the width
	//                   that triggered it — a width in the old scale's px,
	//                   so zooming out could leave it latched forever
	//
	// Hence a full reset rather than a re-measure: the caches are not stale
	// by a little, they are answers to a question that has changed. Called
	// from the mask pass, which the ResizeObserver now drives on zoom.
	checkZoomChange(this: WordSmith) {
		const z = this.zoomFactor();
		if (this._lastZoom === z) return;
		const first = this._lastZoom === undefined;
		this._lastZoom = z;
		if (first) return;   // startup, not a change
		this._barBoundsL = this._barBoundsW = null;
		this._barReserve = null;
		this._fitShortenFile = false;
		this._fitShortenWidth = 0;
		// The re-measure is stampBarBounds's own business — it guards the
		// mid-transition frame itself, because every caller has that problem
		// and only it knows the factor. This just gets the bar rebuilt at
		// the new scale once the layout has settled.
		this.afterReflow(() => {
			this.scheduleMaskPosition();
			this.requestBarRebuild();
		});
	},

	// Run once the browser has laid out whatever just changed. Two frames,
	// not one: the first is where the pending style change is applied, the
	// second is the first that can measure the result of it.
	afterReflow(this: WordSmith, fn: () => void) {
		const go = () => { try { fn(); } catch (_) { wsCatch('afterReflow: fn();', _); } };
		if (typeof window === 'undefined' || !window.requestAnimationFrame) {
			window.setTimeout(go, 32);
			return;
		}
		window.requestAnimationFrame(() => window.requestAnimationFrame(go));
	},

	// Obsidian's zoom level, as a factor. Everything measured with
	// getBoundingClientRect comes back in ZOOMED coordinates, while an
	// inline px value is interpreted before the zoom is applied — so a
	// measurement written straight back is off by exactly this factor.
	//
	// This is the bug behind two separate "inline geometry does nothing"
	// reports: at 120% a measured 1118.4px editor was written as 1118.4px
	// and painted 1342px, spilling the bar across the side panes, and a
	// 40px side inset became 48 painted px. Divide before writing.
	zoomFactor(this: WordSmith) {
		try {
			const raw = getComputedStyle(document.body).getPropertyValue('--zoom-factor');
			const z = parseFloat(raw);
			if (z && isFinite(z) && z > 0) return z;
		} catch { /* no computed style yet */ }
		return 1;
	},

	// Phone or tablet. `Platform` is the app's own answer and is preferred;
	// the body class is the fallback for an API old enough not to export it,
	// and for a test, where neither exists and the answer is false.
	isMobileApp(this: WordSmith) {
		try {
			if (Platform && typeof Platform.isMobile === 'boolean') return Platform.isMobile;
		} catch (_) { wsCatch('isMobileApp: if (Platform && typeof Platform.isMobile === \'boolean\') return …', _); }
		try { return !!(document.body && document.body.classList.contains('is-mobile')); }
		catch { return false; }
	},

	// A clip path for the top mask that carves out the window-control corner,
	// or '' when there is nothing to avoid.
	//
	// getTitlebarAreaRect() reports the strip the *page* may use; the controls
	// occupy whatever is left of the title bar band, on the right under
	// Windows and Linux and on the left under macOS. Cutting exactly that
	// corner keeps the letterbox at the top of the window — pushing the whole
	// mask down cleared the buttons but left a bare strip the width of the
	// title bar, and raising the buttons in CSS only works if you know what
	// Obsidian calls their container this release.
	maskTopClip(this: WordSmith, maskLeft: number, maskTop: number, maskWidth: number, maskHeight: number) {
		// The notch geometry is exported for the CONTROL GUARDS (see
		// stampMaskPositions): cleared here, set only on the success path,
		// so the guards and the visual carve-out can never disagree.
		this._maskNotches = null;
		try {
			const W = window.innerWidth;
			// Everything below is computed in VIEWPORT coordinates first and
			// translated into the mask's own box at the end — clip-path
			// coordinates are element-local, and the mask spans the note
			// pane (left: sLeft, width: sWidth), not the window. The first
			// version of this carve-out skipped the translation, which was
			// harmless only because it almost never ran.
			const mL = maskLeft   || 0;
			const mT = maskTop    || 0;
			const mW = maskWidth  || W;
			const mH = maskHeight || 0;
			let h = 0, leftEdge = 0, rightEdge = W; // controls occupy [0..leftEdge] and [rightEdge..W]

			// Window Controls Overlay, when the frame actually uses it.
			// `o.visible` is false under Obsidian's own HTML frame — the
			// common case — which is why this can never be the only source:
			// relying on it alone left the carve-out empty on 1.13 and the
			// mask painted straight over minimize/close.
			const o = navigator.windowControlsOverlay;
			if (o && o.visible && o.getTitlebarAreaRect) {
				const r = o.getTitlebarAreaRect();
				if (r && r.height) {
					h         = Math.ceil(r.height);
					leftEdge  = Math.max(leftEdge, Math.round(r.x));
					rightEdge = Math.min(rightEdge, Math.round(r.x + r.width));
				}
			}

			// DOM fallback (and cross-check): measure the control buttons
			// themselves. This survives Obsidian renaming or restacking its
			// frame, because it never needs to out-z-index anything — the
			// mask simply does not cover the measured rectangles. Both
			// sources are merged, so whichever reports the larger corner
			// wins and a half-covered button cannot happen because one
			// probe under-measured. Sided containers are measured together
			// (controls can sit on either side, or both); the generic names
			// are only consulted if neither sided container exists.
			const groups = [
				['.titlebar-button-container.mod-right', '.titlebar-button-container.mod-left'],
				['.titlebar-button-container', '.titlebar .window-controls', '.titlebar-button']
			];
			for (const group of groups) {
				let found = false;
				for (const sel of group) {
					for (const el of document.querySelectorAll(sel)) {
						const r = el.getBoundingClientRect();
						// Only things actually sitting in the top band count
						// — getBoundingClientRect on a hidden element is all
						// zeroes, and a stray match lower in the page must
						// not carve the mask.
						if (!r || !r.width || !r.height || r.top > 48) continue;
						found = true;
						h = Math.max(h, Math.ceil(r.bottom));
						if (r.left + r.width / 2 > W / 2) {
							rightEdge = Math.min(rightEdge, Math.floor(r.left));
						} else {
							leftEdge = Math.max(leftEdge, Math.ceil(r.right));
						}
					}
				}
				if (found) break;
			}

			const leftW  = leftEdge;
			const rightW = W - rightEdge;
			if (!h || (leftW <= 0 && rightW <= 0)) return '';

			// Into the mask's local space, with breathing room so a
			// hairline of mask never clips an icon edge after rounding.
			let nh = h - mT + 1;
			let nl = leftW  > 0 ? (leftEdge + 2) - mL            : 0; // local x of the left notch's inner edge
			let nr = rightW > 0 ? (mL + mW) - (rightEdge - 2)    : 0; // width of the right notch inside the mask
			nl = Math.max(0, Math.min(nl, mW));
			nr = Math.max(0, Math.min(nr, mW));

			// Hard sanity clamps: window controls occupy a shallow corner of
			// a title bar. Anything bigger means a probe measured the wrong
			// element, and a mask sitting over the buttons is strictly
			// better than a letterbox that has been clipped away — so skip
			// the carve-out rather than trust the numbers.
			if (nh <= 0 || nh > Math.min(64, mH || 64)) return '';
			if (nl > mW * 0.45 || nr > mW * 0.45) return '';
			if (nl <= 0 && nr <= 0) return '';

			this._maskNotches = { nl: Math.max(0, nl), nr: Math.max(0, nr), nh };
			const xr = mW - nr; // local x where the right notch starts
			if (nl > 0 && nr > 0) {
				return 'polygon(' + nl + 'px 0, ' + xr + 'px 0, ' + xr + 'px ' + nh +
					'px, 100% ' + nh + 'px, 100% 100%, 0 100%, 0 ' + nh + 'px, ' + nl + 'px ' + nh + 'px)';
			}
			if (nr > 0) {
				return 'polygon(0 0, ' + xr + 'px 0, ' + xr + 'px ' + nh +
					'px, 100% ' + nh + 'px, 100% 100%, 0 100%)';
			}
			return 'polygon(' + nl + 'px 0, 100% 0, 100% 100%, 0 100%, 0 ' + nh +
				'px, ' + nl + 'px ' + nh + 'px)';
		} catch { return ''; }
	},

	stampMaskPositions(this: WordSmith) {
		// The bar's horizontal bounds follow the editor area, and this is
		// the pass that already runs whenever that geometry can change.
		this.stampBarBounds();
		// THE REMEMBERED NOTE, not the focused one. This bailed whenever
		// `getActiveViewOfType` came back empty — which is exactly what it
		// does while focus sits in the docked panel. So toggling the
		// letterbox from Word-Smith's own pane set the class (the text got
		// its padding) and then returned before a single mask was placed:
		// the writer saw the page shift and nothing else, until they
		// clicked into the note and a later pass found a view.
		const view = this.activeMarkdownView();
		if (!view) { this._maskRaf = null; return; }

		// The VISIBLE container, not the first one that matches.
		//
		// Issue #1: the masks jam to the left edge of the window after
		// switching to reading mode, and stay there until something else
		// re-stamps them. The cause is that Obsidian keeps BOTH the source
		// view and the reading view in the DOM and toggles which is shown —
		// so in reading mode `.cm-scroller` is still found by this query, and
		// still answers getBoundingClientRect, with every value zero. Zero
		// left, zero width: the masks were stamped exactly where they were
		// told to go.
		//
		// Existence was never the question. Each candidate is measured and
		// skipped unless it has a box, so the fallback chain falls through a
		// hidden editor to the reading view behind it.
		const pick = (sel: string) => {
			const el = view.contentEl.querySelector(sel);
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return (r.width > 0 && r.height > 0) ? el : null;
		};
		const scroller = pick('.cm-scroller')
			|| pick('.markdown-preview-view')
			|| pick('.markdown-reading-view')
			|| view.contentEl;
		const sr = scroller.getBoundingClientRect();

		// And if NOTHING has a box yet — mid-swap, a pane still opening, a
		// leaf in a collapsed sidebar — do not stamp a degenerate rectangle
		// and leave it there. Keep whatever is on screen and try again on the
		// next frame. Bounded, because a leaf that never gets a box (a
		// background tab) must not spin a repaint loop forever.
		if (!(sr.width > 0 && sr.height > 0)) {
			this._maskRaf = null;
			this._maskRetries = (this._maskRetries || 0) + 1;
			if (this._maskRetries <= MASK_MEASURE_RETRIES) this.scheduleMaskPosition();
			return;
		}
		this._maskRetries = 0;

		let statusH = 0;
		let nativeBar = null;
		// An auto-hidden bar occupies no space: the mask has to reach the
		// window frame, not stop short at a bar that is not there. It rises
		// over the mask on hover, which is the right way round.
		if (this.barIsHidden()) {
			statusH = 0;
		} else if (this.settings.enableRetroStatus && this.retroStatusBarEl) {
			// Height plus the vim gutter beneath the raised bar: everything
			// above must stop at the bar's top edge, not reach down behind
			// it. getBoundingClientRect includes the inline borders and the
			// padding; the settings-derived fallback beside it does not, so
			// the borders are added back there — --ws-status-bar-height is
			// only the row plus its vertical padding.
			// The bar's edge rules add NOTHING to the fallback height now
			// that powerline is baked in: they are drawn by the
			// .ws-powerline::after overlay, which takes no space in the
			// box at all. The border-width arithmetic that used to sit
			// here was the plain bar's, and the plain bar is gone.
			//
			// The fallback uses the SNAPPED height, not the raw setting: the
			// parity snap can add a pixel, and a mask placed one pixel short
			// of the bar leaves a hairline of editor showing. One row,
			// always (see applyCssVariables). Only reached when the rect
			// measures zero — bar hidden or not yet laid out — but that is
			// exactly when a wrong number persists unnoticed.
			statusH = (this.retroStatusBarEl.getBoundingClientRect().height
				|| this.snappedRowHeight())
				+ this.vimGutterHeight();
		} else {
			// OBSIDIAN'S STATUS BAR IS A PILL NOW, NOT A BAR: on 1.13.7
			// `.status-bar` is position: fixed at the bottom RIGHT, 420px wide, and
			// the editor's scroller runs to the window's foot underneath it. Taking
			// the bar's height off the foot, as the full-width bar of old wanted,
			// would leave a strip of editor showing beside the pill. So the pill
			// costs no height — the band runs to the scroller's foot — and the pill
			// DRAWS OVER the band: the stylesheet gives `.status-bar` the retro
			// bar's layer while the masks are up. A bar that still spans the mask's
			// whole width is the old shape and is handled as before.
			const nb = document.querySelector('.status-bar');
			if (nb && getComputedStyle(nb).display !== 'none') {
				const r = nb.getBoundingClientRect();
				if (r.height > 0 && r.width > 0) nativeBar = r;
			}
		}

		// Use the scroller's actual top — it already sits below whatever chrome is visible.
		// Do NOT clamp to an arbitrary drag-bar height; that was pushing the mask down.
		const sTop    = Math.max(0, sr.top);
		const sLeft   = Math.max(0, sr.left);
		const sWidth  = sr.width;
		// visualViewport.height is the honest bottom edge on mobile when the
		// on-screen keyboard is open; innerHeight ignores it.
		const vpH     = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
		let   sBottom = vpH - statusH;
		// Prefer the bar's MEASURED top edge over that arithmetic. Both
		// should agree, but they are reached by different routes: the bar
		// is laid out from the window's bottom edge by CSS, while this
		// reconstructs the same line from a viewport height, a measured
		// height and a gutter. Fractional values round differently for a
		// bottom-anchored box than for a top-anchored one, and that
		// disagreement is the hairline still showing under the mask.
		// Measuring both edges in one coordinate space removes it.
		let barMeasured = false;
		if (!this.barIsHidden() && this.settings.enableRetroStatus && this.retroStatusBarEl) {
			try {
				const br = this.retroStatusBarEl.getBoundingClientRect();
				if (br.height > 0 && br.top > 0 && br.top < vpH) { sBottom = br.top; barMeasured = true; }
			} catch (_) { wsCatch('stampMaskPositions: const br = this.retroStatusBarEl.getBoundingClientRect();', _); }
		}
		// ── AND THE PANE'S OWN FOOT, WHEN IT IS NOT THE WINDOW'S ───────────
		//
		// EVERY LINE ABOVE MEASURES THE WINDOW. `sTop` comes from the SCROLLER,
		// so the top band lands on the right pane; `sBottom` comes from the
		// viewport height, or from the retro bar's top edge — both window-level
		// facts. With one full-height pane the two agree; split the workspace
		// and the bottom band lands squarely over the note underneath. So the
		// foot is clamped to the scroller's own. `Math.min` and not a
		// replacement: the window-level number is still the right answer when
		// the pane runs to the bottom, and it is the one that accounts for the
		// bar and the status bar.
		//
		// THE BAR'S EDGE IS KEPT BEFORE THE CLAMP MOVES sBottom. The clamp is
		// the masks' business only; the pane reservation below needs the bar's
		// top. Handed the clamped value, a top pane's foot reserves every pane
		// beneath it to the depth of the bottom pane — and the margin that
		// reservation writes SHRINKS the scroller, so the next pass measures
		// the shrunk foot and reserves deeper still, converging on a blank note
		// (GitHub #16). The invariant stampBarReserve states — nothing measured
		// there moves when it is applied — only holds while this edge does not
		// come from the scroller.
		const barTopEdge = sBottom;
		let paneFoot = false;
		if (sr.bottom > sTop && sr.bottom < sBottom) { sBottom = sr.bottom; paneFoot = true; }
		// The old full-width bar, fixed over the foot: it spans the scroller,
		// so it costs its height as it always did. A pill does not.
		if (nativeBar && nativeBar.top < sBottom
			&& nativeBar.left <= sr.left + 2 && nativeBar.right >= sr.right - 2) {
			sBottom = Math.max(sTop, nativeBar.top);
			nativeBar = null;
		}
		const sHeight = Math.max(0, sBottom - sTop);

		// The bar's top edge is exactly what the pane reservation needs, and
		// it was established above in this coordinate space — measured where
		// possible, reconstructed from the viewport height and the gutter where
		// not — BEFORE the pane-foot clamp, which is for the masks and must
		// never reach here. Zero unless the RETRO bar is what occupies the
		// strip: with it off, the edge is Obsidian's own status bar, and
		// reserving pane space for that is not this feature's business.
		this.stampBarReserve(
			(!this.barIsHidden() && this.settings.enableRetroStatus && this.retroStatusBarEl)
				? barTopEdge : 0);
		this.checkZoomChange();

		let maskH = this.settings.letterboxPx != null ? this.settings.letterboxPx : (this.settings.letterboxLines || 8) * 26;
		maskH = Math.min(maskH, this._maskMaxPx(sHeight));
		// THE FLOOR IS THE ARROW ROW'S OWN HEIGHT, not a round number.
		// Below it the arrows had nowhere to sit: they were laid out in a
		// band shorter than themselves, spilled sideways and drifted right
		// as the band shrank — which is what a writer sliding the mask to
		// nothing actually saw. 34 was the old floor and was itself a
		// guess; the row needs its glyph height plus the overhang the mask
		// draws past it.
		maskH = Math.max(maskH, WS_MASK_MIN_PX);

		// THE INSET IS NIL WHILE THE MASKS FOLLOW THE TEXT. Matching the
		// column already decides where the masks start and stop; an inset
		// on top of it is a second answer to the same question, and the
		// two fought — nudge the arrows in and the band no longer lined up
		// with the writing it was cut to. Locked rather than hidden, so
		// the writer's own value is kept and comes back the moment they
		// stop matching.
		let padH        = this.settings.maskMatchText
			? 0
			: (this.settings.maskPaddingH || 0);
		// The arrows centre on the text, so they measure the content box.
		// sr.width is the border box and includes the vertical scrollbar,
		// which the text column does not — centring on it put the arrow row
		// half a scrollbar to the right of the text. The masks themselves
		// stay on the border box: they are a backdrop and should cover the
		// scrollbar too.
		const innerW    = scroller.clientWidth || sWidth;
		// THE TEXT COLUMN, when the writer asked the masks to match it.
		// Measured from the editor's own content element rather than from
		// the readable-line setting, because a theme, a snippet or a
		// per-note width can all move it — what is on screen is the only
		// honest answer. `sizer` is the element the column's width lives
		// on; padded, we take its offset box, unpadded its content box.
		let matchLeft = null, matchW = null;
		if (this.settings.maskMatchText) {
			try {
				const sizer = scroller.querySelector('.cm-contentContainer .cm-content')
					|| scroller.querySelector('.cm-sizer')
					|| scroller.querySelector('.markdown-preview-sizer');
				if (sizer) {
					const r = sizer.getBoundingClientRect();
					if (r && r.width > 0) {
						matchLeft = r.left;
						matchW    = r.width;
						if (!this.settings.maskMatchTextPadded) {
							const cs = window.getComputedStyle(sizer);
							const pl = parseFloat(cs.paddingLeft)  || 0;
							const pr = parseFloat(cs.paddingRight) || 0;
							matchLeft += pl;
							matchW    -= (pl + pr);
						}
					}
				}
			} catch { matchLeft = matchW = null; }
		}
		// The horizontal inset is the writer's own nudge and still applies;
		// matching the text replaces where the mask STARTS, not their say
		// over it.
		const baseLeft  = matchLeft != null ? matchLeft : sLeft;
		const baseWidth = matchW    != null ? matchW    : sWidth;
		// CLAMPED HERE TOO, not only where it is set: a value saved before
		// this cap existed, or typed into data.json, must still draw a row
		// the arrows fit in. The layout is the last word on what is
		// possible; the setting only says what was asked for.
		const padMax = Math.max(0, Math.floor((baseWidth - WS_ARROWS_MIN_W) / 2));
		padH = Math.min(padH, padMax);
		const arrowLeft = (matchLeft != null ? matchLeft : sLeft) + padH;
		const arrowW    = Math.max(0, (matchW != null ? matchW : innerW) - padH * 2);
		const arrowH    = maskH;
		const overhang  = this.settings.maskOverhang != null ? this.settings.maskOverhang : 4;

		const S = (el: HTMLDivElement | null, styles: { left: string; width: string; top: string; height: string; bottom: string; }) => { if (el) Object.assign(el.style, styles); };
		S(this.maskTopEl,    { left: baseLeft+'px', width: baseWidth+'px', top: sTop+'px', height: (arrowH+overhang)+'px', bottom:'' });
		// Only the top mask can reach the window controls. Guarded twice
		// over: null when the positioner runs for the retro bar alone, and
		// isolated so nothing thrown in here can abort the bottom mask,
		// arrow and retro-bar positioning below — half-positioned chrome is
		// the plugin visibly "not displaying".
		if (this.maskTopEl) {
			try {
				// Always ask for the carve-out; maskTopClip decides.
				//
				// This used to be gated on sTop <= 2, i.e. "only bother when
				// the mask starts at the very top of the window". That held
				// only while zen's top padding did nothing. Now that the
				// padding works, the scroller starts ~17px down, the gate
				// stopped firing, and the mask went on covering the LOWER
				// part of a ~30px title bar with no notches cut — which is
				// a full-width element over the drag region, so the window
				// could no longer be dragged or its controls clicked.
				//
				// The gate was never load-bearing: maskTopClip computes
				// `h - maskTop` and returns '' when that is negative, so a
				// mask sitting below the controls already declined to carve.
				this.maskTopEl.style.clipPath =
					this.maskTopClip(sLeft, sTop, sWidth, arrowH + overhang);
			} catch { try { this.maskTopEl.style.removeProperty('clip-path'); } catch (__) { wsCatch('stampMaskPositions: this.maskTopEl.style.removeProperty(clip-path);', __); } }
			// The guards follow the same notches. Viewport coordinates:
			// they are fixed children of body, not of the mask, precisely
			// so the mask's clip-path cannot trim them away.
			try {
				const n = this._maskNotches;
				const gl = this.maskGuardLeftEl, gr = this.maskGuardRightEl;
				const box = (el: HTMLDivElement | null, left: number, width: number, height: number) => {
					if (!el) return;
					const placed = width > 0 && height > 0;
					el.classList.toggle('is-placed', placed);
					if (placed) el.setCssStyles({ left: left + 'px', width: width + 'px', height: height + 'px' });
				};
				if (n) {
					// nl/nr are mask-local; the mask starts at sLeft.
					box(gl, sLeft, n.nl, n.nh);
					box(gr, sLeft + sWidth - n.nr, n.nr, n.nh);
				} else {
					box(gl, 0, 0, 0); box(gr, 0, 0, 0);
				}
			} catch (_) { wsCatch('stampMaskPositions: const n = this._maskNotches;', _); }
		}
		// THE ARROWS STAND DOWN IN A THIN MASK. Below WS_ARROWS_MIN_PX
		// there is no band for them to sit in: they were laid out in a
		// space shorter than themselves, spilled past it and floated on
		// the page with nothing behind them. A mask can be thinner than
		// its ornament; it just cannot carry it, and a hairline of shroud
		// is a legitimate thing to want.
		const arrowsFit = maskH >= WS_ARROWS_MIN_PX;
		// NOT ON A PHONE: the arrows are never made there.
		if (this.arrowsTopEl && this.arrowsBottomEl) try {
			this.arrowsTopEl.classList.toggle('is-hidden', !arrowsFit);
			this.arrowsBottomEl.classList.toggle('is-hidden', !arrowsFit);
		} catch (_) { wsCatch('stampMaskPositions: this.arrowsTopEl.classList.toggle(\'is-hidden\', !arrowsFit);', _); }
		S(this.arrowsTopEl,  { left: arrowLeft+'px', width: arrowW+'px', top: sTop+'px', height: arrowH+'px', bottom:'' });
		// The bottom mask is pinned to the WINDOW EDGE, not sized to stop at
		// the bar. Chasing the bar's top edge kept leaving a hairline
		// however carefully it was measured and however much overlap was
		// added, because two independently-rounded fixed elements meeting
		// on a fractional device pixel is a boundary that can always show
		// a seam. So the boundary is removed: top is set, bottom is set,
		// and the compositor stretches the element between them — its
		// bottom edge is not a number this code computes at all.
		//
		// Nothing is lost by covering the strip behind the bar. The bar
		// (z-index 22, or 10006 elevated) and the vim panel (24) both sit
		// above the masks (20 / 10003), so they paint over it exactly as
		// before, and the editor text under there was never meant to show.
		//
		// Only when the retro bar is what occupies that strip. With the
		// bar off, Obsidian's own status bar is down there and covering it
		// would be a regression, so that case keeps an exact height.
		//
		// EXCEPT while the vim ":" panel is open. The panel lives inside a
		// workspace leaf, which establishes its own stacking context, so
		// its z-index (10008) cannot lift it above a mask that is a fixed
		// child of body (10003) — raising it does nothing, which is why
		// the command line was invisible in zen mode rather than merely
		// dim. The stylesheet comment promised the mask "stands down"
		// here; nothing implemented it. So the mask's bottom edge is
		// pulled up to the top of the gutter while the panel is up,
		// leaving the strip the panel occupies uncovered.
		//
		// This reintroduces a computed bottom edge, which invariant 7
		// warns about — but harmlessly: that edge lands at the bar's own
		// bottom edge, underneath an opaque bar that paints above the
		// mask, so a rounding sliver has nowhere to show. When the panel
		// closes it goes back to bottom: 0, where there is no edge at all.
		const bottomMaskTop = Math.floor(sBottom - arrowH - overhang);
		// `bottom: 0` reaches the WINDOW's foot, which is only the right edge
		// when the pane runs that far. Where the pane ends first, the band is
		// given an explicit height and stops with it — otherwise it covers the
		// note underneath, which is what moving the top alone did.
		if (barMeasured && !paneFoot) {
			S(this.maskBottomEl, { left: baseLeft+'px', width: baseWidth+'px',
				top: bottomMaskTop+'px',
				bottom: (this._vimPanelOpen ? this.vimGutterHeight() : 0) + 'px',
				height: '' });
		} else {
			S(this.maskBottomEl, { left: baseLeft+'px', width: baseWidth+'px',
				top: bottomMaskTop+'px',
				height: Math.ceil(sBottom - bottomMaskTop)+'px', bottom:'' });
		}
		S(this.arrowsBottomEl, { left: arrowLeft+'px', width: arrowW+'px', top: (sBottom-arrowH)+'px', height: arrowH+'px', bottom:'' });

		// The bar is NOT stamped here. Its horizontal bounds have exactly
		// one owner — stampBarBounds(), called at the top of this pass —
		// and this line used to be a second one: `sLeft`/`sWidth` are the
		// ACTIVE SCROLLER's rect, so with two notes side by side the bar
		// shrank to whichever pane had focus, while the plinth beneath it
		// (stamped only from stampBarBounds) stayed the full editor width.
		//
		// Both implementations were reaching for the same thing — keep the
		// bar clear of the sidebars — and their comments said so in almost
		// the same words. One pane is not the editor area the moment a
		// pane is split; the root split is, always. Running later, this one
		// won, and it also dropped the `important` flag that stampBarBounds
		// sets (assigning through style.left clears the priority), so the
		// bounds cache then believed the correct value was still in place
		// and never corrected it.
		this.scheduleFit();

		// Outside zen mode there's no big 50vh scroller padding to push the
		// first/last lines clear of the masks, so a brand-new or short note
		// starts hidden behind the top mask. Give the scroller just enough
		// top/bottom breathing room to clear the mask height, independent of
		// zen mode — zen mode's own 50vh padding (see styles.css) already
		// covers this and is left untouched.
		const scrollPad = this.letterboxActive() ? Math.round(arrowH + overhang + 24) : 0;
		document.documentElement.style.setProperty('--ws-scroller-pad-top',    scrollPad + 'px');
		document.documentElement.style.setProperty('--ws-scroller-pad-bottom', scrollPad + 'px');

		this._maskRaf = null;
	},

	scheduleMaskPosition(this: WordSmith) {
		if (this._maskRaf) return;
		this._maskRaf = window.requestAnimationFrame(() => this.stampMaskPositions());
	},

	buildArrowLayer(this: WordSmith, position: string, char: string) {
		const wrap   = document.body.createDiv({ cls: 'ws-arrows-wrap ws-arrows-wrap-' + position + ' is-visible' });
		const line   = wrap.createDiv({ cls: 'ws-arrow-line' });
		const arrows = wrap.createDiv({ cls: 'ws-arrows' });
		// End caps are the first and last members of the arrow row, not
		// separate elements on the line. Two earlier attempts put them there —
		// the border drew straight through them, and once that was fixed they
		// still sat on a different baseline at a different line-height. As
		// siblings of the other arrows they inherit every one of those things
		// and cannot fall out of line.
		const caps = !!this.settings.arrowLineEnds;
		if (caps) {
			arrows.classList.add('has-caps');
			arrows.createSpan({ cls: 'ws-arrow-cap', text: char });
		}
		for (let i = 0; i < this.settings.arrowCount; i++) arrows.createSpan({ text: char });
		if (caps) arrows.createSpan({ cls: 'ws-arrow-cap', text: char });
		if (position === 'top') wrap.insertBefore(arrows, line);

		// Pointer events (with capture) instead of mouse events: identical on
		// desktop, and tablet/mobile dragging works for free. The cursors and
		// the pointer-events are the sheet's (`.ws-arrow-line`,
		// `.ws-arrows`).
		line.addEventListener('pointerdown', e => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			e.preventDefault(); e.stopPropagation();
			this._startVerticalDrag(e, position, line);
		});

		arrows.addEventListener('pointerdown', e => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			e.preventDefault(); e.stopPropagation();
			this._startHorizontalDrag(e, arrows);
		});
		return wrap;
	},

	// Shared pointer-drag plumbing. setPointerCapture routes all move/up
	// events to the grabbed element, so no document-level listeners are
	// needed — and _activeDragCleanup lets onunload abort a drag that's
	// still in flight instead of leaking its listeners.
	_startPointerDrag(this: WordSmith, e: PointerEvent, el: HTMLDivElement, cursor: string, onMove: (me: PointerEvent) => void) {
		if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (_) { wsCatch('_startPointerDrag: el.setPointerCapture(e.pointerId);', _); } }
		document.body.style.cursor = cursor; document.body.addClass('ws-dragging');
		const finish = (save: boolean) => {
			el.removeEventListener('pointermove',   onMove);
			el.removeEventListener('pointerup',     onUp);
			el.removeEventListener('pointercancel', onCancel);
			if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
				try { el.releasePointerCapture(e.pointerId); } catch (_) { wsCatch('_startPointerDrag / finish: el.releasePointerCapture(e.pointerId);', _); }
			}
			document.body.style.removeProperty('cursor'); document.body.removeClass('ws-dragging');
			this._activeDragCleanup = null;
			if (save) void this.saveSettings();
		};
		const onUp     = () => finish(true);
		const onCancel = () => finish(false);
		el.addEventListener('pointermove',   onMove);
		el.addEventListener('pointerup',     onUp);
		el.addEventListener('pointercancel', onCancel);
		this._activeDragCleanup = () => finish(false);
	},

	// ── HOW TALL A MASK MAY BE, ANSWERED ONCE ───────────────────────────────
	//
	// The layout capped what it DREW at a fraction of the window and the
	// drag capped nothing, so `letterboxPx` could be dragged to any number
	// while the screen stopped changing at 45%. The writer then dragged it
	// back and nothing happened — because the stored number had to be
	// walked all the way down before it re-entered the drawable range.
	// Reported as "I hide the menu and can't bring them back", and the
	// second half of that sentence is this.
	//
	// Takes the height to measure against so the layout can pass the pane's
	// own; falls back to the window for callers that have no measurement in
	// hand (the drag).
	_maskMaxPx(this: WordSmith, h?: number) {
		const base = Number(h) > 0 ? Number(h) : (window.innerHeight || 0);
		return Math.max(WS_MASK_MIN_PX, Math.floor(base * WS_MASK_MAX_FRAC));
	},

	_startVerticalDrag(this: WordSmith, e: PointerEvent, position: string, el: HTMLDivElement) {
		const startY = e.clientY;
		const startH = (this.maskTopEl ? parseFloat(this.maskTopEl.style.height) : null)
			|| (this.settings.letterboxPx != null ? this.settings.letterboxPx : (this.settings.letterboxLines || 8) * 26);
		this._startPointerDrag(e, el, 'ns-resize', (me: MouseEvent) => {
			const dy = me.clientY - startY;
			// HELD BETWEEN BOTH WALLS, so the stored number and the drawn
			// mask can never disagree — which is what made dragging back
			// feel dead.
			this.settings.letterboxPx = Math.min(this._maskMaxPx(), Math.max(WS_MASK_MIN_PX,
				startH + dy * (position === 'top' ? 1 : -1)));
			this.scheduleMaskPosition();
		});
	},

	_startHorizontalDrag(this: WordSmith, e: PointerEvent, el: HTMLDivElement) {
		// UNDRAGGABLE WHILE THE MASKS MATCH THE TEXT. The drag writes the
		// inset, and the inset is ignored in that mode — so the handle
		// would move under the pointer and nothing on screen would answer,
		// which reads as the plugin having stopped working.
		if (this.settings.maskMatchText) return;
		const startX   = e.clientX;
		const startPad = this.settings.maskPaddingH || 0;
		const cx       = window.innerWidth / 2;
		this._startPointerDrag(e, el, 'ew-resize', (me: MouseEvent) => {
			const dx = me.clientX - startX;
			// The same wall the layout enforces, so the handle stops where
			// the drawing does rather than sliding on against a row that
			// has already stopped narrowing.
			const wide = (this.maskTopEl && this.maskTopEl.offsetWidth) || window.innerWidth;
			const cap  = Math.max(0, Math.floor((wide - WS_ARROWS_MIN_W) / 2));
			this.settings.maskPaddingH = Math.max(0,
				Math.min(cap, Math.round(startPad + dx * (startX < cx ? 1 : -1))));
			this.scheduleMaskPosition();
		});
	},

	getArrowChars(this: WordSmith) {
		if (this.settings.arrowStyle === 'custom') {
			return { top: this.settings.customArrowTop || '^', bottom: this.settings.customArrowBottom || 'v' };
		}
		return ARROW_STYLES[this.settings.arrowStyle] || ARROW_STYLES['solid-triangle'];
	},

	removeCustomElements(this: WordSmith) {
		// Tear down retro bar
		if (this.retroStatusBarEl) { this.retroStatusBarEl.remove(); this.retroStatusBarEl = null; }
		if (this.retroPlinthEl) { this.retroPlinthEl.remove(); this.retroPlinthEl = null; }
		this._statusRowEls = [];
		// The colour probe is appended to body and would otherwise outlive
		// the plugin — invisible and harmless, but it is ours and it is a
		// node in someone's document. The cache goes with it: a stale entry
		// read after a reload would be answering about a theme that may have
		// changed in between.
		if (this._colorProbeEl) { this._colorProbeEl.remove(); this._colorProbeEl = null; }
		this._themeSurfaceCache = null;
		document.body.classList.remove('ws-retrobar-active');
		this.stopClockTick();
		// Tear down masks
		this.removeMaskElements();
	},

	getActiveScroller(this: WordSmith) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		return view.contentEl.querySelector('.cm-scroller') || view.contentEl.querySelector('.markdown-preview-view') || null;
	},

	attachScrollHandler(this: WordSmith) {
		this.detachScrollHandler();
		const scroller = this.getActiveScroller();
		if (!scroller) return;
		this.currentScroller = scroller;
		this.scrollHandler   = () => this.updateMaskVisibility();
		scroller.addEventListener('scroll', this.scrollHandler, { passive: true });
		window.requestAnimationFrame(() => this.updateMaskVisibility());
	},

	detachScrollHandler(this: WordSmith) {
		if (this.currentScroller && this.scrollHandler) {
			this.currentScroller.removeEventListener('scroll', this.scrollHandler);
		}
		this.currentScroller = this.scrollHandler = null;
	},

	updateMaskVisibility(this: WordSmith) {
		const s = this.currentScroller || this.getActiveScroller();
		if (!s) return;
		const { scrollTop, scrollHeight, clientHeight } = s;
		if (this.arrowsTopEl)    this.arrowsTopEl.classList.toggle('is-visible',    scrollTop > 2);
		if (this.arrowsBottomEl) this.arrowsBottomEl.classList.toggle('is-visible', scrollTop + clientHeight < scrollHeight - 2);
	},

	attachResizeHandler(this: WordSmith) {
		if (this.windowResizeHandler) return;
		this.windowResizeHandler = () => this.scheduleMaskPosition();
		window.addEventListener('resize', this.windowResizeHandler);

		// …and a ResizeObserver on the body, because `resize` does not cover
		// zoom. Obsidian's Ctrl+/- restyles the app rather than changing the
		// window, so the event never fires: the bar kept the left/width it
		// had stamped at the old scale and sat visibly off its pane, and the
		// fit pass kept a verdict measured against a width that no longer
		// meant the same thing. An observer answers the question the bar
		// actually has — "has my box changed size" — and catches window
		// resizes, zoom steps and sidebar toggles with one hook.
		try {
			if (typeof ResizeObserver === 'function') {
				this._bodyResizeObs = new ResizeObserver(() => this.scheduleMaskPosition());
				this._bodyResizeObs.observe(document.body);
			}
		} catch { /* the resize listener above still covers the common case */ }
	},

	detachResizeHandler(this: WordSmith) {
		if (this._bodyResizeObs) {
			try { this._bodyResizeObs.disconnect(); } catch (_) { wsCatch('detachResizeHandler: this._bodyResizeObs.disconnect();', _); }
			this._bodyResizeObs = null;
		}
		if (!this.windowResizeHandler) return;
		window.removeEventListener('resize', this.windowResizeHandler);
		this.windowResizeHandler = null;
	},
};
export type FocusMethods = typeof focusMethods;
