// Word-Smith — organizer-zoom: Ctrl+wheel, two fingers, and the way back.

import { wsCatch } from './preamble';
import type { WsSession } from './preamble';
import type WordSmith from './plugin';

// ════════════════════════════════════════════════════════════════════════
// THE ZOOM — Ctrl+wheel, two fingers, and the way back
// ════════════════════════════════════════════════════════════════════════
//
// The pane's own zoom — the body's CSS zoom from 0.6 to 2 in tenths, one
// number for the three panes, kept on the session; `zoomTag`, the small
// figure at the end of the subject line that says `120%` and puts the
// window back when clicked; `zoomApply`; and the two-finger pinch, which
// is refused while a column grip is held.
//
// WHAT IT READS, through `d`: the window's body (`d.body`, which wears the
// zoom) and the session (`d.ses`, which remembers it). It is also called
// for its effect: the wheel and touch listeners are bound here.
//
// TWO `let`s ARE LIVE — `zoomHost` (bound when the subject line is drawn)
// and `orgGripDrag` (the column grip's latch, which the widths module
// sets and the pinch reads, so that a drag on a column edge is not read
// as a pinch) — so they come back as getters and setters and the window
// reads them as `orgZoom.<name>`.
// WHAT THE WINDOW LENDS THIS MODULE: the type of the object
// `openManuscriptModal` hands `wsOrgZoomMake`, as the checker sees it at the call —
// a getter without a setter is readonly; a member that reads `any` is a
// closure local the window has not typed yet (2 of 3).
export interface OrgZoomDeps {
	plugin: WordSmith;
	readonly body: HTMLElement;
	readonly ses: WsSession;
}

export const wsOrgZoomMake = (d: OrgZoomDeps) => {
// CTRL + WHEEL ZOOMS THE PANE. The reader's frame already zooms this
// way; the pane around it follows the same gesture — the body's CSS
// zoom, 0.6 to 2 in tenths, one number for the three panes, the
// session's. The event is taken so the app's own Ctrl+wheel does not
// zoom the whole window underneath. The frame's own wheel never reaches
// here: it is another document.
//
// ── AND THE WAY BACK ─────────────────────────────────────────────
//
// One small figure at the END OF THE SUBJECT LINE — `120%` — drawn only
// while the zoom is not 100%, and a click on it puts the window back.
// The subject line and not the tab strip or the foot: a single-tab pane
// hides its strip, and the foot stands only while the say-line is
// speaking; the subject line is the one row every pane always shows.
// Nothing appears at 100%, so the window at rest looks as it did — and
// the figure also says WHY the window looks bigger today, which no
// reset button would. `zoomHost` is bound when the subject line exists;
// `drawSubject` empties that line on every folder change and calls
// this again, so the figure survives a redraw.
let zoomHost: HTMLElement | null = null;
const zoomTag = () => {
	if (!zoomHost) return;
	const z = d.ses.zoom || 1;
	let t = zoomHost.querySelector('.ws-uni-zoomtag');
	if (Math.abs(z - 1) < 0.001) { if (t) t.remove(); return; }
	if (!t) {
		t = zoomHost.createEl('button', { cls: 'ws-export-mini ws-uni-zoomtag' });
		t.title = 'Back to 100%';
		t.setAttribute('aria-label', 'Zoom back to 100%');
		t.addEventListener('click', (ev: Event) => { ev.stopPropagation(); d.ses.zoom = 1; zoomApply(); });
	}
	t.setText(Math.round(z * 100) + '%');
};
const zoomApply = () => {
	try { d.body.style.setProperty('--ws-uni-zoom', String(d.ses.zoom || 1)); } catch (_) { wsCatch('zoomApply: body.style.setProperty', _); }
	try { zoomTag(); } catch (_) { wsCatch('zoomApply: zoomTag();', _); }
};
zoomApply();
d.body.addEventListener('wheel', (ev: WheelEvent) => {
	if (!ev.ctrlKey && !ev.metaKey) return;
	ev.preventDefault();
	const step = ev.deltaY < 0 ? 0.1 : -0.1;
	d.ses.zoom = Math.min(2, Math.max(0.6, Math.round(((d.ses.zoom || 1) + step) * 10) / 10));
	zoomApply();
}, { passive: false });
// ── AND TWO FINGERS ───────────────────────────────────────────────
//
// The wheel above needs a Ctrl key and a wheel; a phone has neither,
// and Obsidian mobile pins the viewport, so the browser's own pinch
// does nothing there. Two fingers on the pane drive the SAME zoom: the
// distance between them against the distance when they landed, times
// the zoom they started from, in the same tenths and the same range.
// One finger is left alone, so scrolling is untouched; a two-finger
// move is taken (`preventDefault`, so that listener is not passive) and
// the read-out appears, which is the way back.
let pinch: { z0: number; d0: number } | null = null;
// A GRIP DRAG OWNS THE FINGERS: a second finger down mid-drag must not
// start a pinch under the resize. Set by the grips, read by the move.
let orgGripDrag = 0;
const span = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
d.body.addEventListener('touchstart', (ev: TouchEvent) => {
	pinch = ev.touches.length === 2 ? { d0: span(ev.touches) || 1, z0: d.ses.zoom || 1 } : null;
}, { passive: true });
d.body.addEventListener('touchmove', (ev: TouchEvent) => {
	if (orgGripDrag || !pinch || ev.touches.length !== 2) return;
	ev.preventDefault();
	const z = pinch.z0 * span(ev.touches) / pinch.d0;
	const next = Math.min(2, Math.max(0.6, Math.round(z * 10) / 10));
	if (next === (d.ses.zoom || 1)) return;
	d.ses.zoom = next;
	zoomApply();
}, { passive: false });
d.body.addEventListener('touchend', (ev: TouchEvent) => { if (ev.touches.length < 2) pinch = null; }, { passive: true });
d.body.addEventListener('touchcancel', () => { pinch = null; }, { passive: true });
d.plugin._orgZoom = () => d.ses.zoom || 1;
	return { zoomTag, get zoomHost() { return zoomHost; }, set zoomHost(v) { zoomHost = v; }, get orgGripDrag() { return orgGripDrag; }, set orgGripDrag(v) { orgGripDrag = v; } };
};
