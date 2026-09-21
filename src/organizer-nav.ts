// Word-Smith — organizer-nav: the navbar and the narrow watch — what the
// phone's chrome does to a pane.

import { Platform } from 'obsidian';
import {
	wsCatch,
	wsKeyboardRecord,
	wsNarrowDecide,
	wsNarrowState,
	wsNavbarOverlap,
	wsSoon,
} from './preamble';
import type WordSmith from './plugin';
import type { WsHost } from './settings';

// ════════════════════════════════════════════════════════════════════════
// THE NAVBAR AND THE NARROW WATCH — what the phone's chrome does to a pane
// ════════════════════════════════════════════════════════════════════════
//
// WIRING rather than functions: the navbar stamp (Obsidian's
// `mobile-navbar` overlaps a leaf that runs the full screen, so its
// overlap is measured after the first paint, on every resize, on the
// visual viewport and when the keyboard's own variable changes, and
// stamped on the root for the sheet to take as padding) and the narrow
// watch (a small window is narrow too, so a ResizeObserver over the pane
// carries the phone's class into a desktop split).
//
// IT IS CALLED FOR ITS EFFECT: the factory runs the wiring. WHAT IT
// READS, through `d`: the host and its root (`d.host`), the window's
// body (`d.body`), the limit (`d.orgNarrowLimit`) and `d.plugin`.
//
// THE TWO STOP LATCHES ARE LIVE — `stopWidth` and `stopNav`, set in here
// and called by `onClose` — so they come back as getters and setters and
// the window's teardown calls them as `orgNav.stopWidth()` /
// `orgNav.stopNav()`. A window that unregisters one of two keeps a dead
// window's listeners alive for the session.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgNavMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (2 of 5).
export interface OrgNavDeps {
	plugin: WordSmith;
	readonly body: HTMLDivElement;
	readonly host: WsHost;
	readonly narrow: boolean;
	readonly orgNarrowLimit: () => number;
}

export const wsOrgNavMake = (d: OrgNavDeps) => {
let stopWidth = () => {};
let stopNav = () => {};
// ── THE NAVBAR ─────────────────────────────────────────────────
//
// `mobile-navbar mod-raised` is 80px over a leaf that runs the full
// screen, so the last row of every pane sits under it. Measured after
// the first paint and on every resize (the bar is raised or plain, the
// keyboard comes and goes), stamped on the root, taken as padding by
// the sheet.
if (d.host.kind === 'leaf' && typeof Platform !== 'undefined' && Platform && Platform.isMobile) {
	const navStamp = () => {
		try {
			// A KEYBOARD COVERS THE BAR: Obsidian sets --keyboard-height on the
			// body and moves the bar; whichever it does, padding for a bar nobody
			// can see is room taken from a pane that has none.
			const kbh = parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height')) || 0;
			const px = kbh > 0 ? 0 : wsNavbarOverlap(d.body);
			if (px > 0) d.host.rootEl.style.setProperty('--ws-under-navbar', px + 'px');
			else d.host.rootEl.style.removeProperty('--ws-under-navbar');
			// AND FROM THE ROOT, for what is anchored to its bottom (the
			// Properties sheet): the root runs the full screen, so this is
			// the bar's whole height when it is over the root at all.
			const rootPx = wsNavbarOverlap(d.host.rootEl);
			if (rootPx > 0) d.host.rootEl.style.setProperty('--ws-mobilebar-h', rootPx + 'px');
			else d.host.rootEl.style.removeProperty('--ws-mobilebar-h');
		} catch (_) { wsCatch('openManuscriptModal / navStamp: const px = wsNavbarOverlap(body);', _); }
	};
	wsSoon(navStamp);
	window.addEventListener('resize', navStamp);
	// AND THE VISUAL VIEWPORT, AND A FOCUS: a keyboard does not resize the
	// window on Android — the visual viewport shrinks and Obsidian sets
	// --keyboard-height — so the stamp follows both, and a focus in the
	// pane re-measures a moment later and records what "Copy diagnostics"
	// prints as `last keyboard`.
	if (window.visualViewport) window.visualViewport.addEventListener('resize', navStamp);
	let kbTimer = 0;
	const onFocusIn = () => {
		window.setTimeout(navStamp, 500);
		window.clearTimeout(kbTimer);
		kbTimer = window.setTimeout(() => wsKeyboardRecord(d.host.rootEl), 700);
	};
	d.host.rootEl.addEventListener('focusin', onFocusIn);
	// AND THE VARIABLE ITSELF. On some phones neither the window nor the
	// visual viewport resizes for the keyboard, and nothing at all fires
	// when it GOES — a back-button dismissal even leaves the focus in the
	// field, so a focusout would not do. Obsidian sets --keyboard-height
	// on the document element; that style changing is the one event the
	// keyboard's going has. Stamped at once and again when the bar has
	// moved back. The stamp writes the ROOT's style, never these two, so
	// the observer cannot feed itself.
	let kbObs = null;
	try {
		kbObs = new MutationObserver(() => { navStamp(); window.setTimeout(navStamp, 300); });
		kbObs.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
		kbObs.observe(document.body, { attributes: true, attributeFilter: ['style'] });
	} catch (_) { kbObs = null; wsCatch('openManuscriptModal / navStamp: kbObs.observe(document.documentElement)', _); }
	stopNav = () => { try { window.removeEventListener('resize', navStamp); if (window.visualViewport) window.visualViewport.removeEventListener('resize', navStamp); d.host.rootEl.removeEventListener('focusin', onFocusIn); window.clearTimeout(kbTimer); if (kbObs) kbObs.disconnect(); } catch (_) { wsCatch('openManuscriptModal / stopNav: window.removeEventListener(resize, navStamp);', _); } };
}
// ── AND A SMALL WINDOW IS NARROW TOO ─────────────────────────
//
// Narrow is not a PLATFORM fact: a desktop window dragged small must
// not stay two-column and put the panel off the edge. AND THE HOST
// GUARD IS LOAD-BEARING: `.is-narrow` sets `width: 100vw` — but only
// `:not(.ws-uni-pane)`. So for a MODAL an observer on `rootEl` would be
// writing the very property it watches, which is the self-triggering
// observer that hung this app once already; for a PANE the class
// changes no width and the observer is safe. SO EACH HOST ASKS THE
// QUESTION IT CAN ASK SAFELY. A modal cannot be wider than the
// viewport, and toggling the class changes the modal's width and never
// the viewport's — so `matchMedia` closes the loop by construction
// rather than by a guard somebody has to remember. A pane keeps the
// observer, because its width is the leaf's and no query can see it.
if (!d.narrow && d.host.kind === 'modal'
	&& typeof window.matchMedia === 'function') {
	try {
		const mq = window.matchMedia(
			'(max-width: ' + d.orgNarrowLimit() + 'px)');
		const apply = () => {
			d.host.rootEl.toggleClass('is-narrow', !!mq.matches);
		};
		apply();
		// A window that does not answer simply does not follow a resize.
		if (typeof mq.addEventListener === 'function') {
			mq.addEventListener('change', apply);
			stopWidth = () => {
				try { mq.removeEventListener('change', apply); } catch (_) { wsCatch('openManuscriptModal: mq.removeEventListener(\'change\', apply);', _); }
			};
		}
	} catch (_) { wsCatch('openManuscriptModal: const mq = window.matchMedia(', _); }
} else if (!d.narrow && typeof ResizeObserver !== 'undefined') {
	try {
		// ── AN OBSERVER MUST NOT WRITE WHAT IT WATCHES ────────────────
		//
		// This observer watches `host.rootEl` and writes a class on
		// `host.rootEl`, and `is-narrow` changes that element's own layout —
		// one pane instead of two, the name column capped. Measure → write →
		// re-measure is a loop whenever the write moves the width back across
		// the threshold, which is a question about scrollbars, fonts and
		// device pixels rather than about this code — so it settles on one
		// machine and spins on another. THE THREE GUARDS ARE `wsNarrowDecide`,
		// in preamble.ts, where a test can drive them with a hostile width
		// sequence; they are independent on purpose, because a cause nobody
		// has watched fail deserves more than one.
		const flips = wsNarrowState();
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) {
				const pick = wsNarrowDecide(flips,
					e.contentRect && e.contentRect.width,
					d.orgNarrowLimit(), Date.now());
				if (pick.act === 'skip') continue;
				if (pick.act === 'stop') {
					// A HANG BECOMES A WRONG WIDTH. Disconnecting is
					// the point: the layout is left as it is rather
					// than redrawn again, and the console says which
					// width and which limit could not agree.
					try { ro.disconnect(); } catch (_) { wsCatch('openManuscriptModal: ro.disconnect();', _); }
					try {
						console.error('Word-Smith: the narrow-window '
							+ 'measurement did not settle (width ' + Math.round(pick.width)
							+ ', limit ' + pick.limit + '). The layout is left as it '
							+ 'is rather than redrawn again.');
					} catch (_) { wsCatch('openManuscriptModal: console.error(\'Word-Smith: the narrow-window \'', _); }
					return;
				}
				d.host.rootEl.toggleClass('is-narrow', pick.want);
			}
		});
		ro.observe(d.host.rootEl);
		stopWidth = () => { try { ro.disconnect(); } catch (_) { wsCatch('openManuscriptModal: ro.disconnect();', _); } };
	} catch (_) { wsCatch('openManuscriptModal: const flips = wsNarrowState();', _); }
}
	return { get stopWidth() { return stopWidth; }, set stopWidth(v) { stopWidth = v; }, get stopNav() { return stopNav; }, set stopNav(v) { stopNav = v; } };
};
