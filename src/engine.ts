// Part of the plugin class, split out by responsibility (HANDOFF §1.17,
// ARCHITECTURE "Should this be split?"): the methods below are assigned
// onto CursorSmithPlugin.prototype and declared on the class, so every
// `this.x` read and every test reach them exactly as before. `this` is
// the plugin.
//
// The canvas engine: one canvas per view, the frame loop and its gears
// (enableCanvasEngine holds the tick), the region the canvas is fitted to,
// what a frame needs, the layout observers, and the performance report.

import { Notice } from "obsidian";
import {
  CANVAS_REGION_GRID,
  CANVAS_REGION_MARGIN_X,
  CANVAS_REGION_MARGIN_Y,
  CANVAS_REGION_MOTION_PAD,
  CANVAS_REGION_SHRINK_MS,
  CANVAS_REGION_SHRINK_RATIO,
  FRAME_CAPS,
  INPUT_HOT_MS,
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_STALE_MS,
  SCROLL_LOCK_MS,
} from "./constants";
import { fitCanvasRegion, wrapperClipForStatusBar } from "./geometry";
import { presetToCode } from "./share";
import type { EditorView } from "@codemirror/view";
import type {
  Bounds,
  CursorSmithSettings,
  GearDecision,
  PerfCounters,
  Rect,
  ReportApp,
  ReportNavigator,
  ReportWindow,
  SelectionSig,
  SettingKey,
  TrailPointCallback,
} from "./types";
import type CursorSmithPlugin from "./plugin";

export const engineMethods = {
  // The element the canvas wrapper hangs from: the focused editor's
  // scroller, where the wrapper rides with the scrolled content - the
  // compositor carries it with the text between ticks; the app container,
  // fixed, while focus is not in the editor (a search field, a prompt: those
  // carets are clipped to their own boxes by the fixed wrapper), the scroller
  // belongs to another document, or it sits in a Canvas card (scaled by a
  // transform the placement does not know).
  //
  // On a phone since 1.6.2; on the desktop since 1.6.5, while no torch can
  // be on. A fixed caret trailed every wheel tick by one frame - a whole
  // scroll step, 55 px, then back: "the cursor jitters around when
  // scrolling" (a Reddit user, who blamed Smooth movement; it did the same
  // with it off). The torch keeps the fixed wrapper: inside the scroller the
  // caret would sit under its darkness and its glow, which is what the
  // phone accepts and the desktop's layering (z 10010-10012) was built
  // against. Word-Smith's bands and bar need no clip in the scroller: they
  // sit above its stacking context.
  _wrapperHome(this: CursorSmithPlugin, doc: Document, view: EditorView | null | undefined): HTMLElement {
    const app = doc.querySelector<HTMLElement>(".app-container") || doc.body;
    if (!view || !this.editorFocused(view)) return app;
    if (!doc.body.classList.contains("is-mobile") && this.torchPossible()) return app;
    const sc = view.scrollDOM;
    if (!sc || !sc.isConnected || sc.ownerDocument !== doc) return app;
    return sc.closest(".canvas-node") ? app : sc;
  },

  ensureCanvasForView(this: CursorSmithPlugin, view: EditorView | null | undefined) {
    // CRASH FIX: this used to read `this.overlay.ownerDocument` when there
    // was no view - but this.overlay belongs to the torch engine and is
    // null whenever the torch is off (and even briefly when it's on). On
    // window refocus, activeEditor is momentarily null, so view is null,
    // and the null-deref threw inside the rAF tick, killing the loop and
    // making the cursor vanish until plugin reload. Fall back to the
    // canvas's own current document (don't migrate anywhere while there's
    // no view), then to Obsidian's activeDocument, then to the main doc.
    //
    // _focusedForeignDoc outranks even the view's document, because
    // activeEditor is sticky: while you type in the 1.13 settings window,
    // the last note you touched still reports as the active editor, so
    // "there is a view" is true and yet the caret is in another window
    // entirely. It answers non-null only while that other window actually
    // holds OS focus, so during normal editing this line contributes
    // nothing and the chain below is unchanged.
    // ...except while the note's caret stays up with its window unfocused
    // ("Hide cursor when unfocused" off, editorFocused): the settings
    // window focused on a slider or a toggle, and the caret shown where the
    // note is.
    const targetDoc =
      (this.editorFocused(view) ? null : this._focusedForeignDoc(view)) ||
      (view && view.dom.ownerDocument) ||
      (this.canvasWrapper && this.canvasWrapper.ownerDocument) ||
      (typeof activeDocument !== "undefined" && activeDocument) ||
      document;
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument !== targetDoc) {
      this.canvasWrapper.remove();
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
      this._canvasRect = null;
    }
    if (!this.canvasWrapper) {
      targetDoc.body.classList.add("cursor-smith-active");
      
      // The wrapper creates a strict physical bounding box to unblock window
      // dragging. See _chromeInsets / getFullViewportRect for the sizing
      // logic - the wrapper is never sized to overlap the tab bar.
      // Its fixed/clipped/inert/collapsed defaults are the
      // .cursor-smith-wrapper rule in styles.css; the
      // tick sizes it inline from there.
      //
      // Inside .app-container rather than directly on body.
      // Obsidian's app.css has: body.is-frameless > .app-container ~ * { app-region: no-drag }
      // which targets every direct-body-child sibling of .app-container —
      // exactly what we were. Inside .app-container that rule doesn't match
      // and our elements stay neutral (no app-region) as intended.
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.canvasWrapper = appContainer.createDiv({ cls: "cursor-smith-wrapper" });
      this._lastWrapperRect = "";
      // A fresh wrapper carries no mix-blend-mode, so the value cached from
      // the old one would suppress the write that puts it back - which is
      // exactly what happens when a pop-out window moves the canvas to another
      // document while Translucent is on. See applyCanvasBlend.
      this._canvasBlend = "";

      // NO app-region declaration (same rationale as wrapper above).
      this.canvas = this.canvasWrapper.createEl("canvas", { cls: "cursor-smith-canvas" });

      this.ctx = this.canvas.getContext("2d");
      // No backing store yet: the canvas is sized to the caret's neighbourhood
      // by _fitCanvasRegion on the first frame that has something to show,
      // never to the window. See fitCanvasRegion.
      this._canvasRect = null;
      this._canvasDpr = 0;
      this._wrapperPos = null;
      this._dirtyRaw = null;
    }
    // Where the wrapper lives. Inside the focused editor's scroller as a
    // layer of the scrolled content (_wrapperHome): the compositor scrolls
    // the note a frame or more ahead of the page, and a fixed overlay placed
    // by the page trails every fling by that much - "it still floats up and
    // down on the phone" after the scroll lock (§1.26), a whole wheel step
    // for a frame on the desktop (§1.29). Inside the scroller the canvas is
    // carried with the text between ticks, like CodeMirror's own cursor
    // layer beside it; a tick only re-places the element (the tick's
    // scrolled branch). Elsewhere, and on the desktop while a torch can be
    // on, the fixed wrapper in .app-container: the torch's layers and
    // Word-Smith's covers are built around it.
    const home = this._wrapperHome(targetDoc, view);
    if (this.canvasWrapper.parentElement !== home) {
      home.appendChild(this.canvasWrapper);
      this.canvasWrapper.classList.toggle("cursor-smith-wrapper-scrolled", home.classList.contains("cm-scroller"));
      this._lastWrapperRect = "";
      this._wrapperPos = null;
      this._canvasPlaced = false;
      this._dirtyFull = true;
    }
    if (!targetDoc.body.classList.contains("cursor-smith-active")) {
      targetDoc.body.classList.add("cursor-smith-active");
    }
    // Per frame, and with Note Editor Only it has to be: the value tracks
    // focus, so the class comes off the instant the Command Palette opens and
    // goes back on the instant the editor takes focus again. classList.toggle
    // with an explicit force mutates nothing when the answer is unchanged, so
    // the steady-state cost is a comparison and no style invalidation.
    const hideNative = this.hideNativeActive();
    targetDoc.body.classList.toggle("cursor-smith-hide-native", hideNative);
    // targetDoc is the document the caret is in, so the line above is what the
    // user sees. Every OTHER document we have stamped the class into is now
    // potentially stale though, and a body class that means one thing in one
    // window and something else in the next is how a pop-out-only bug starts.
    // Deduped on the value, so this runs on transitions and not per frame.
    if (hideNative !== this._hideNativeSig) {
      this._hideNativeSig = hideNative;
      try { this.applyBodyClasses(); } catch (e) { this._reportOnce("applyBodyClasses in the tick", e); }
    }
  },

  // The canvas layers this plugin put into a document (and one more it
  // names, the wrapper's own document when that is not registered), gone.
  _removeLayers(this: CursorSmithPlugin, extra: Document | null = null) {
    const docs = new Set<Document>([document, ...Array.from(this.registeredDocuments)]);
    if (extra) docs.add(extra);
    for (const doc of docs) {
      if (!doc || !doc.body) continue;
      doc.body.classList.remove("cursor-smith-active", "cursor-smith-hide-native");
      doc.querySelectorAll(".cursor-smith-wrapper, .cursor-smith-canvas").forEach((el) => { el.remove(); });
    }
  },

  disableCanvasEngine(this: CursorSmithPlugin) {
    this.canvasEngineActive = false;
    if (this.canvasRaf) {
      window.cancelAnimationFrame(this.canvasRaf);
      this.canvasRaf = 0;
    }
    // The governor may be dozing on a timeout rather than an rAF.
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
    }
    this._canvasTick = null;
    this._drawSig = null;
    this._caretGeoCache = null;
    this._paneRectCache = null;
    this._mainRectCache = null;
    this._observeEditorLayout(null);
    // Every wrapper and canvas in every document, not the first canvas: this
    // used to remove the canvas and its wrapper only when the wrapper's
    // INLINE overflow said hidden - the stylesheet has said it since 1.5.x,
    // so the wrapper stayed behind, empty, on every enable() (each settings
    // change, preset, look). Invisible while the stylesheet was loaded; the
    // moment the plugin was switched off in Obsidian's own list the
    // stylesheet went with it and the leftovers were plain boxes the size
    // of the window: "the screen goes blank and I can't slide open the file
    // tree" (a phone, 2026-09-25). The ones left in a note's scroller also
    // held its scroll height up (see the scrolled branch). A sweep, so
    // what an older version left is cleared by the first enable() too.
    this._removeLayers(this.canvasWrapper ? this.canvasWrapper.ownerDocument : null);
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this._canvasRect = null;
    this._clipRect = null;
    this._wrapperPos = null;
    this._dirtyRaw = null;
    // Single reset site (see _resetEngineState). This used to be a hand-copied
    // list that had quietly fallen behind the other two: `trail`, `lastActive`,
    // `lastMoveTime`, `typingSpeedMod`, `_catchUpBoost` and the firework /
    // stardust rate stamps were never cleared on the way down.
    this._resetEngineState();
    this._formMirror?.remove();
    this._formMirror = null;
  },

  enableCanvasEngine(this: CursorSmithPlugin) {
    this.canvasEngineActive = true;
    // Single reset site (see _resetEngineState).
    this._resetEngineState();
    this._suspendCleared = false;
    // Begin from a known-clean surface: the canvas survives enable/disable
    // cycles, so assume nothing about what is currently painted on it. The
    // clear has to happen here and not through _dirtyFull, because a
    // region-less engine never reaches draw() - the flag would sit unread
    // while the old frame stayed on screen.
    if (this.ctx && this.canvas) this._clearCanvas();
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyRaw = null;
    this._dirtyFull = true;
    this._canvasRect = null;
    this._regionOversizedT = 0;

    // Schedule the next frame according to the gear the frame just decided
    // on (this._canvasGear): hot = next vsync, warm/idle = doze on a timeout
    // that _markActivity can cancel for instant wake.
    const schedule = () => {
      if (!this.canvasEngineActive) return;
      const gear = this._canvasGear || "hot";
      const caps = this._frameCaps();
      if (gear === "hot") {
        this.canvasRaf = window.requestAnimationFrame(tick);
        return;
      }
      // The idle gear sleeps until the heartbeat or the blink's next fade,
      // whichever is sooner: a fade caught on the heartbeat started late.
      const idleMs = Math.min(caps.idleMs, Math.max(1, Math.ceil(this._idleWakeMs || caps.idleMs)));
      this._canvasIdleT = window.setTimeout(() => {
        this._canvasIdleT = 0;
        if (this.canvasEngineActive) this.canvasRaf = window.requestAnimationFrame(tick);
      }, gear === "warm" ? caps.warmMs : gear === "energy" ? caps.energyMs : idleMs);
    };

    const tick = () => {
      if (!this.canvasEngineActive) return;
      // For the watchdog: the loop is alive.
      this._lastTickT = performance.now();
      // Hot-gear frame cap: on 120Hz ProMotion displays rAF fires every
      // ~8ms; a cursor gains nothing above ~60fps, so skip alternate
      // frames. The skipped wake-up is just a reschedule, costing ~nothing.
      // Low Power raises the cap to ~30fps (FRAME_CAPS).
      // `perf` is the performance report's counters while one is running
      // (performanceReport); null otherwise, and every touch is guarded so
      // the common case costs one null test.
      const perf = this._perf;
      if ((this._canvasGear || "hot") === "hot") {
        const n = performance.now();
        if (perf) {
          // Every raw frame in the hot gear, cap included. The MOST COMMON gap
          // is the display's refresh interval; the shortest is not - Chromium
          // delivers callbacks back to back after a stalled frame.
          if (perf.rafPrev) {
            const d = n - perf.rafPrev;
            if (d > 1 && d < 100) {
              const b = Math.round(d * 2) / 2;
              perf.rafGaps[b] = (perf.rafGaps[b] || 0) + 1;
            }
          }
          perf.rafPrev = n;
        }
        // Not while the caret moves with the text (_hotCapLifted): then
        // every frame, whatever the cap.
        if (!this._hotCapLifted(n) && n - (this._lastHotFrameT || 0) < this._frameCaps().hotMinMs) {
          this.canvasRaf = window.requestAnimationFrame(tick);
          return;
        }
        this._lastHotFrameT = n;
      } else if (perf) {
        perf.rafPrev = 0;
      }
      const tTick = perf ? performance.now() : 0;
      // The whole frame is wrapped so a single bad frame (e.g. a transient
      // null during window refocus, a detached node mid-layout) can never
      // kill the rAF loop permanently - that's exactly the "cursor
      // disappears until plugin reload" failure mode. We log the first
      // error to the console for debugging and keep ticking.
      try {
        // Two states suspend the cursor outright:
        //
        //   1. A Slides presentation. The note editor stays open underneath
        //      the presentation overlay and its CM view can still report
        //      hasFocus, so without this guard the cursor keeps blinking over
        //      the slides and keystrokes still reach the editor.
        //   2. The window isn't the focused OS window (see windowFocused()).
        //
        // Both are handled by parking rather than tearing the engine down:
        // clear the surface once, then drop to the idle heartbeat. Resuming is
        // then a single frame away, and the caret/smear state is left exactly
        // as it was so coming back doesn't replay a move or snap the spring.
        if (this.presentationActive() || !this.windowFocused()) {
          if (this.ctx && this.canvas && !this._suspendCleared) {
            this._clearCanvas();
            this._suspendCleared = true;
            // The surface is blank, so there's nothing left for the next frame
            // to clear; dropping the signature guarantees the first frame back
            // actually repaints instead of matching a stale one and skipping.
            this._dirtyPrev = null;
            this._drawSig = null;
          }
          this._canvasGear = "idle";
          this._idleWakeMs = 0;
          schedule();
          return;
        }
        this._suspendCleared = false;

        const view = this.app.workspace.activeEditor?.editor?.cm;
        this.ensureCanvasForView(view);
        if (view) this.registerWindowEvents(view.dom.ownerDocument);
        this._observeEditorLayout(view);
        // The canvas may have just migrated to a document that hosts no view
        // at all - the 1.13 settings window - which the line above therefore
        // cannot register. Without listeners there, typing in a settings box
        // neither wakes the render loop nor resets the blink, so the cursor
        // would freeze mid-fade between idle heartbeats. Set-guarded inside
        // registerWindowEvents, so per-frame this is a no-op.
        if (this.canvasWrapper) {
          this.registerWindowEvents(this.canvasWrapper.ownerDocument);
        }

        const scrolledWrapper = !!this.canvasWrapper && !!view &&
          this.canvasWrapper.classList.contains("cursor-smith-wrapper-scrolled") &&
          this.canvasWrapper.parentElement === view.scrollDOM;
        if (this.canvasWrapper && this.canvas && scrolledWrapper && view) {
          // Inside the scroller (_wrapperHome): the wrapper is the
          // content box at the content's origin, so its client position -
          // _wrapperPos, what the canvas is placed against - moves with every
          // scroll, and the canvas is re-placed on every tick that saw it
          // move; between ticks the compositor carries both with the text,
          // which is the whole point. Sized to the content, so the scroller's
          // own overflow clips it. The chrome insets, the status-bar cut and
          // the covers are the fixed wrapper's business: the bars sit above
          // the scroller's stacking context regardless.
          //
          // Sized to the CONTENT's extent (its own box, measured from the
          // origin), never to the scroller's scrollWidth x scrollHeight: those
          // include this wrapper, so the size could only ever grow - a long
          // note, then a short one in the same tab, left 13,000 px of empty
          // scroll under it, and a tap down there put the cursor at the end
          // of the note and scrolled back to it: "the cursor is not where
          // the tap is ... the page automatically scrolls there" (a phone,
          // 2026-09-25). A phone turned from landscape did the same sideways.
          const sc = view.scrollDOM;
          const sr = sc.getBoundingClientRect();
          const top = Math.round(sr.top - sc.scrollTop);
          const left = Math.round(sr.left - sc.scrollLeft);
          const cr = view.contentDOM.getBoundingClientRect();
          const width = Math.max(1, sc.clientWidth, Math.ceil(cr.right - left));
          const height = Math.max(1, sc.clientHeight, Math.ceil(cr.bottom - top));
          this._clipTop = Math.round(sr.top);
          const key = "scrolled|" + width + "," + height;
          if (key !== this._lastWrapperRect) {
            this._lastWrapperRect = key;
            this._dirtyFull = true;
            // At the content origin and unclipped: the stylesheet rule says
            // top: 0; left: 0, so the fixed mode's inline values come off.
            this.canvasWrapper.style.removeProperty("top");
            this.canvasWrapper.style.removeProperty("left");
            this.canvasWrapper.style.removeProperty("clip-path");
            this.canvasWrapper.style.width = width + "px";
            this.canvasWrapper.style.height = height + "px";
          }
          if (!this._wrapperPos || this._wrapperPos.left !== left || this._wrapperPos.top !== top) {
            this._wrapperPos = { left, top };
            this._canvasPlaced = false;
          }
          this._clipRect = { x: left, y: top, w: width, h: height };
        } else if (this.canvasWrapper && this.canvas) {
          // Only clip to the editor pane while the note editor is the thing
          // actually focused. The moment focus moves anywhere else - file
          // tree rename box, Command Palette, Settings, other modals - clip
          // to whatever scroll container that field lives in instead, and
          // only fall back to the viewport when it has none. Handing back the
          // whole viewport unconditionally is what let a caret in a Settings
          // text box paint outside the settings frame: see getCaretClipRect.
          const r = (view && this.editorFocused(view)
            ? this.getPaneRect(view)
            : this.getCaretClipRect(this.canvas.ownerDocument)) ||
            // Never 100vw/100vh here: a full-viewport layer over the
            // titlebar kills Electron's window-drag hit-testing on
            // Linux/Windows (drag regions compose in DOM order; z-index
            // and pointer-events are irrelevant to them).
            this.getFullViewportRect(this.canvas.ownerDocument);

          // Round and dedupe: writing identical style values every frame
          // still costs style-recalc work in Blink, and fractional pixel
          // sizes force continuous compositor re-uploads - both showed up
          // as stutter with the smear effect on (worst on weak GPUs, e.g.
          // ChromeOS Crostini's virtualized one).
          let top = Math.round(r.top);
          const left = Math.round(r.left);
          const width = Math.round(r.width);
          let height = Math.round(r.height);
          const ins = this._chromeInsets(this.canvas.ownerDocument);
          // The bands and bars fixed over the editor that hide its own caret
          // (CARET_COVERS: Word-Smith's letterbox masks, its status bar) hide
          // ours too: the wrapper stops at their edges. Since the torch's
          // layers moved above that chrome (§1.22) the canvas would paint
          // over them otherwise - a caret line scrolled under the bar showed
          // through it, and one under a band.
          const coverTop = Math.max(top, Math.ceil(ins.coverTop));
          const coverBottom = Math.min(top + height, Math.floor(ins.coverBottom));
          if (coverTop > top || coverBottom < top + height) {
            top = coverTop;
            height = Math.max(0, coverBottom - coverTop);
          }
          // Kept for Thunderstrike, which needs to know where the visible area
          // starts so a bolt can be launched from just above it and appear to
          // arrive from outside the pane.
          this._clipTop = top;
          // Keep the cursor canvas above the status bar. The editor pane's rect
          // can extend under a floating status bar, and while scrolling the
          // pane briefly reaches the window edge, so clamp the clip to the
          // status bar's top. No-op for an in-flow status bar (the pane already
          // stops above it) and on platforms with no status bar (inset is 0).
          let clipPath = "";
          if (ins.bottomInset > 0) {
            const win = this.canvas.ownerDocument.defaultView || window;
            const cut = wrapperClipForStatusBar(
              { top, left, width, height },
              { top: win.innerHeight - ins.bottomInset, left: ins.statusLeft, right: ins.statusRight },
            );
            height = cut.height;
            clipPath = cut.clipPath;
          }
          const key = top + "," + left + "," + width + "," + height + "|" + clipPath;
          if (key !== this._lastWrapperRect) {
            this._lastWrapperRect = key;
            // The wrapper clips the canvas (overflow:hidden). Pixels painted
            // earlier and then clipped out of view are still sitting in the
            // buffer, so a wrapper that moves or grows can reveal stale
            // content that damage tracking would never think to clear.
            this._dirtyFull = true;
            this.canvasWrapper.style.top = top + "px";
            this.canvasWrapper.style.left = left + "px";
            this.canvasWrapper.style.width = width + "px";
            this.canvasWrapper.style.height = height + "px";
            this.canvasWrapper.style.clipPath = clipPath;
            // The canvas is positioned relative to the wrapper, so it has to
            // be re-placed against the new origin (_fitCanvasRegion does it,
            // and also drops a region that no longer lies inside the clip).
            this._wrapperPos = { left, top };
            this._clipRect = { x: left, y: top, w: width, h: height };
            this._canvasPlaced = false;
          }
        }

        // Vim-aware: the active mode decides the look for the whole
        // caret/draw pipeline - every read of this.look below is the current
        // mode's full look/effect snapshot, with no per-key plumbing and
        // nothing to restore afterwards (see the look getter).
        const _vimMode = this.lookVimMode();
        if (_vimMode !== this._appliedVimMode) {
          this._appliedVimMode = _vimMode;
          this.onVimModeChanged();
        }
        {
          // Frame counter: hotSyncScroll shares one scroll delta per tick
          // between the primary and the secondaries.
          this._tickNo = (this._tickNo || 0) + 1;
          // The Backspace, Enter and Space flags are consumed by the first
          // commitMove that sees them, and that is the primary's. The
          // secondaries move on the same keystroke and get the same
          // disintegration, strike and volley, so remember the flags first.
          const flagsAtFrame = {
            del: this._deletePending, enter: this._enterPending, pop: this._popKeyPending,
          };
          // Multi-cursor: if the selection changed shape (a caret came or
          // went, or the main one moved), every saved caret state has to be
          // re-matched to the ranges BEFORE the primary measures itself -
          // including the primary's own, which may now belong to a secondary.
          this.rematchCaretStates(view);
          const tCaret = perf ? performance.now() : 0;
          this.updateActivePoint();
          if (perf) perf.caretMs += performance.now() - tCaret;
          this.updateSmoothCursor();
          // Multi-cursor: run the primary's own update pipeline on each
          // full-effect secondary's state, and gather the plain remainder for
          // draw() to stamp a line at.
          this.updateSecondaryCarets(view, flagsAtFrame);
          // Cheap when off, and internally cached on (caret pos, doc length)
          // so the text scan doesn't rerun every frame while the caret sits
          // still. The secondaries' tethers (computed in
          // updateSecondaryCarets, each through its own caches) are merged
          // in: drawBracketTether paints one list.
          this.bracketTether = this.mergeTethers(
            this.look.bracketTether ? this.bracketTetherCoords(view) : null);
          this.updateSmearQuad();
          // Must run before the gear decision below, which reads trail.length.
          this.pruneTrail();

          // Speed Demon: cool the cursor down every frame regardless of
          // whether the feature is enabled - if the user toggled it off
          // mid-heat we want the value to settle back to 0 so re-enabling
          // starts from cold. 0.985/frame at ~60fps gives a ~1s half-life:
          // dropping from full heat to cold in roughly 4 seconds of silence.
          if (this.heat > 0) {
            this.heat *= 0.985;
            if (this.heat < 0.001) this.heat = 0;
          }
          if (this.look.speedDemon && this.look.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          // Hot-head. The inertia/burn-mark tracker runs unconditionally so the
          // caret history doesn't sit stale from wherever the caret was when
          // the effect was last on and light a trail across the screen on the
          // first frame after it's re-enabled.
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) {
            this.maybeSpawnHotHead();
          }
          // Self-guarding (checks its own toggles and the idle window), and
          // must run before the gear decision below, which reads stardust
          // length to decide whether this frame may be skipped.
          this.maybeSpawnStardust();

          // ---- Gear decision + draw skip -------------------------------
          const nowT = performance.now();
          const g = this._decideGear(nowT, !!perf);
          this._canvasGear = g.gear;
          this._idleWakeMs = g.idleWake;
          if (perf) perf.why[g.why] = (perf.why[g.why] || 0) + 1;
          // Skip the clear+redraw entirely when the rendered picture would be
          // identical - the canvas simply keeps showing the last frame. This
          // is what takes true idle to ~0% GPU, and what makes the hot gear's
          // post-input window cheap: a settled cursor is not repainted against
          // an unchanged picture. Only on a static frame: the signature omits
          // trail, particle and sub-pixel spring state, so it is trustworthy
          // only while nothing is animating (see _frameSignature).
          let doDraw = true;
          if (g.staticFrame) {
            const sig = this._frameSignature(_vimMode, g.blinkBucket);
            if (sig === this._drawSig) doDraw = false;
            else this._drawSig = sig;
          } else {
            this._drawSig = null;
          }
          // A pending full clear must not be skipped. _dirtyFull is set when
          // the clip window moves, which can expose pixels painted earlier and
          // clipped out of view - and it is only consumed inside draw(), so
          // skipping the draw would strand the invalidation and leave the
          // stale content on screen indefinitely.
          if (this._dirtyFull) doDraw = true;
          // Where the canvas element sits this frame (issue #30). After the
          // update phase so every pool a spawn just filled is in the need, and
          // before the draw because the draw has to land on the new surface.
          // A re-anchored canvas is blank, so the frame must paint whatever
          // the static-frame test above thought was still on screen.
          if (this._fitCanvasRegion()) { doDraw = true; if (perf) perf.reanchors++; }
          if (doDraw && this._canvasRect) {
            const tDraw = perf ? performance.now() : 0;
            this.draw();
            if (perf) { perf.draws++; perf.drawMs += performance.now() - tDraw; }
          }
        }
      } catch (e) {
        this._reportOnce("canvas tick (loop kept alive)", e);
      }
      if (perf) {
        perf.ticks++;
        perf.tickMs += performance.now() - tTick;
        const g = this._canvasGear || "hot";
        perf.gears[g] = (perf.gears[g] || 0) + 1;
      }
      schedule();
    };
    this._canvasTick = tick;
    this._canvasGear = "hot";
    this._idleWakeMs = 0;
    this._lastTickT = performance.now();
    this.canvasRaf = window.requestAnimationFrame(tick);
  },

  // (Re)allocate the backing store for the current canvas region. This used
  // to size the canvas to the window; it now sizes it to this._canvasRect,
  // the caret's neighbourhood chosen by _fitCanvasRegion (issue #30). Drawing
  // stays in absolute client coordinates: the context transform subtracts
  // the region's origin, so nothing that paints had to change.
  resizeCanvas(this: CursorSmithPlugin) {
    if (!this.canvas || !this.ctx) return;
    const r = this._canvasRect;
    if (!r) return;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    this._canvasDpr = dpr;
    this.canvas.style.width = r.w + "px";
    this.canvas.style.height = r.h + "px";
    this.canvas.width = Math.max(1, Math.round(r.w * dpr));
    this.canvas.height = Math.max(1, Math.round(r.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, -r.x * dpr, -r.y * dpr);
    this._placeCanvas();
    // Reassigning width/height blanks the backing store, so nothing from the
    // previous frame survives and there is nothing left to clear.
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyFull = false;
    // A resize usually rides along with a zoom, DPR, or theme change, any of
    // which can move the caret's font metrics without moving pos - so drop the
    // cached style read rather than wait out its TTL.
    this._caretStyleCache = null;
  },

  // Position the canvas element inside the wrapper so that the region's
  // origin lands at its own client coordinates. transform: none when the
  // region sits at the wrapper's corner avoids promoting the canvas to a
  // separate compositor layer for nothing.
  _placeCanvas(this: CursorSmithPlugin) {
    const r = this._canvasRect;
    if (!this.canvas || !r) return;
    const wp = this._wrapperPos || { left: 0, top: 0 };
    const dx = r.x - wp.left;
    const dy = r.y - wp.top;
    this.canvas.style.transform = dx === 0 && dy === 0 ? "none" : `translate(${dx}px, ${dy}px)`;
    this._canvasPlaced = true;
  },

  // Blank the whole surface, whatever region it covers. Bypasses the region
  // transform so it needs no coordinates at all.
  _clearCanvas(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyRaw = null;
  },

  // The bounding box of everything this frame has to be able to paint, in
  // client coordinates, or null when there is nothing. Runs after the update
  // phase, so it sees every pool a spawn just filled.
  //
  // Three sources. The cursor's own damage bounds (the same helper draw()
  // marks dirty from, so the two cannot disagree), plus the smooth-movement
  // target so the region grows toward where the caret is heading rather than
  // chasing it. The secondaries and the tether, whose positions are known
  // before the draw. And last frame's UNCLAMPED painted union, padded for
  // motion: particles, embers, motes, trail ghosts and glitch slices were all
  // painted somewhere last frame and will be near there this frame. That
  // union is recorded from _markDirty whether or not the canvas actually
  // showed the pixels, which is what lets anything that outruns the pad
  // reappear one frame later instead of staying lost.
  //
  // Two effects are exempt from all that and claim the whole clip window for
  // as long as they are live: a thunderbolt starts above the pane on purpose
  // (see spawnThunderbolt) and a firework shell climbs out of any region
  // fitted round the caret. Both are rare and short.
  _frameNeed(this: CursorSmithPlugin, clip: Rect): Bounds | null {
    if ((this.thunderbolts && this.thunderbolts.length) ||
        (this.fireworks && this.fireworks.length)) {
      return { x0: clip.x, y0: clip.y, x1: clip.x + clip.w, y1: clip.y + clip.h };
    }
    let b: Bounds | null = null;
    const add = (x0: number, y0: number, x1: number, y1: number) => {
      if (!b) { b = { x0, y0, x1, y1 }; return; }
      if (x0 < b.x0) b.x0 = x0;
      if (y0 < b.y0) b.y0 = y0;
      if (x1 > b.x1) b.x1 = x1;
      if (y1 > b.y1) b.y1 = y1;
    };
    const cb = this._cursorBounds();
    if (cb) add(cb.x0, cb.y0, cb.x1, cb.y1);
    const la = this.lastActive;
    if (la && this.animActive && la !== this.animActive) {
      const pad = 24;
      add(la.x - pad, la.top - pad,
          la.x + Math.max(la.w || 0, la.actualCharWidth || 0) + pad, la.top + (la.h || 0) + pad);
    }
    if (this.secondaryCarets && this.secondaryCarets.length) {
      for (const c of this.secondaryCarets) add(c.x - 4, c.top - 4, c.x + 8, c.bottom + 4);
    }
    // The full-effect secondaries contribute what the primary does: their
    // damage bounds (smear quad included) and their smooth-movement target.
    if (this._secondaries && this._secondaries.length) {
      for (const st of this._secondaries) {
        if (!st.animActive) continue;
        const sb = this._withCaret(st, () => this._cursorBounds());
        if (sb) add(sb.x0, sb.y0, sb.x1, sb.y1);
        const sl = st.lastActive;
        if (sl && sl !== st.animActive) {
          add(sl.x - 24, sl.top - 24,
              sl.x + Math.max(sl.w || 0, sl.actualCharWidth || 0) + 24, sl.top + (sl.h || 0) + 24);
        }
      }
    }
    if (this.bracketTether && this.bracketTether.length) {
      for (const s of this.bracketTether) {
        add(Math.min(s.x1, s.x2) - 4, Math.min(s.y1, s.y2) - 4,
            Math.max(s.x1, s.x2) + 4, Math.max(s.y1, s.y2) + 4);
      }
    }
    const r = this._dirtyRaw;
    if (r) {
      const p = CANVAS_REGION_MOTION_PAD;
      add(r.x0 - p, r.y0 - p, r.x1 + p, r.y1 + p);
    }
    return b;
  },

  // Decide the canvas region for this frame and apply it. Returns true when
  // the surface was re-anchored (and is therefore blank), so the caller
  // knows the frame must be painted whatever the static-frame test said.
  //
  // Movement without growth keeps the backing store and only moves the
  // element (a transform write); growth or a DPR change reallocates it.
  // Either way the surface is blank afterwards, which is fine: draw() paints
  // every live thing from state each frame, it never relies on last frame's
  // pixels beyond knowing where to clear them.
  _fitCanvasRegion(this: CursorSmithPlugin) {
    if (!this.canvas || !this.ctx) return false;
    const clip = this._clipRect;
    if (!clip) return false;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    let cur = this._canvasRect;
    // A region fitted inside an earlier clip window is worthless once the
    // window has moved out from under it.
    if (cur && (cur.x < clip.x || cur.y < clip.y ||
                cur.x + cur.w > clip.x + clip.w || cur.y + cur.h > clip.y + clip.h)) {
      cur = null;
    }
    const need = this._frameNeed(clip);
    const lh = (this.animActive && this.animActive.h) || (this.lastActive && this.lastActive.h) || 24;
    const marginY = Math.round(CANVAS_REGION_MARGIN_Y * lh);

    // Shrink only after the region has been oversized for a while.
    const now = performance.now();
    let allowShrink = false;
    if (cur && need) {
      const nw = Math.min(clip.w, (need.x1 - need.x0) + 2 * CANVAS_REGION_MARGIN_X);
      const nh = Math.min(clip.h, (need.y1 - need.y0) + 2 * marginY);
      if (cur.w * cur.h > CANVAS_REGION_SHRINK_RATIO * Math.max(1, nw) * Math.max(1, nh)) {
        if (!this._regionOversizedT) this._regionOversizedT = now;
        else if (now - this._regionOversizedT > CANVAS_REGION_SHRINK_MS) allowShrink = true;
      } else {
        this._regionOversizedT = 0;
      }
    } else {
      this._regionOversizedT = 0;
    }

    const next = fitCanvasRegion(need, clip, cur, {
      marginX: CANVAS_REGION_MARGIN_X, marginY, grid: CANVAS_REGION_GRID, allowShrink,
    });
    if (next === cur && cur === this._canvasRect && dpr === this._canvasDpr) {
      if (!this._canvasPlaced) this._placeCanvas();
      return false;
    }
    if (!next) {
      // Nothing to show and no region worth keeping (the clip moved out from
      // under it). The store still holds the last frame, and the element
      // still sits where the OLD wrapper put it: with the wrapper now
      // somewhere else, those pixels show through displaced and frozen
      // until the next caret refits - draw() never runs without a region,
      // so nothing else would clear them. That was the caret ghost on the
      // settings sidebar's "Options" heading after a click from the search
      // box to a tab. Blank the store; the first frame with a need refits.
      if (this._canvasRect) this._clearCanvas();
      this._canvasRect = null;
      return false;
    }
    if (allowShrink && next !== cur) this._regionOversizedT = 0;
    const prev = this._canvasRect;
    this._canvasRect = next;
    if (!prev || next.w !== prev.w || next.h !== prev.h || dpr !== this._canvasDpr) {
      this.resizeCanvas();
    } else {
      this.ctx.setTransform(dpr, 0, 0, dpr, -next.x * dpr, -next.y * dpr);
      this._placeCanvas();
      this._clearCanvas();
    }
    // The surface is blank: nothing to clear, everything to paint.
    this._dirtyFull = false;
    this._dirtyPrev = null;
    return true;
  },

  // The render loops' frame intervals for the current Low Power setting.
  // Global, not a look: read off this.settings directly, which a per-Vim-mode
  // swap leaves untouched because no mode snapshot carries the key.
  // Whether the hot gear's frame cap is off for the frame at `n`. The cap
  // skips every other frame on a 120 Hz screen (every second or third in
  // Low Power) while the text moves on every one, so a caret that moves
  // with the text trails it on half the frames:
  //
  //   - a scroll (SCROLL_LOCK_MS after the scroller's own scroll or wheel
  //     event, on its own stamp - the activity kind is overwritten by every
  //     touch or pointer move between two scroll events): the wobble;
  //   - typing (1.6.4), outside Low Power: while the drawn caret glides or
  //     its smear moves, and SCROLL_LOCK_MS after a key, so the frame that
  //     shows the new text shows the caret beside it. "The whole cursor is
  //     laggy when typing fast" on a 120 Hz laptop: the plugin ran 60 ticks
  //     a second while the screen ran 120 (measured, 2026-09-24). Low Power
  //     keeps its cap there - it is the switch for trading this away.
  _hotCapLifted(this: CursorSmithPlugin, n: number): boolean {
    if (n - (this._lastScrollT || 0) < SCROLL_LOCK_MS) return true;
    if (this.settings && this.settings.lowPowerMode) return false;
    return !!(this._smoothMoving || this._smearMoving) || n - (this._realKeyT || 0) < SCROLL_LOCK_MS;
  },

  _frameCaps(this: CursorSmithPlugin) {
    return this.settings && this.settings.lowPowerMode ? FRAME_CAPS.lowPower : FRAME_CAPS.normal;
  },

  // ---- Damage tracking ---------------------------------------------------
  // The canvas spans the whole viewport at devicePixelRatio, so on a Retina
  // display it is several million pixels - while the cursor and its effects
  // touch a few thousand. Clearing the entire surface each frame was the
  // dominant GPU cost as soon as anything forced continuous repaints (typing,
  // or the energy shimmer): a full-surface clear plus a full-surface composite
  // 30-60 times a second, to change a caret-sized region.
  //
  // So each primitive reports the box it painted and the next frame clears
  // exactly the union of what the last one touched. Nothing is predicted in
  // advance, so this cannot drift out of sync with the drawing code - but a
  // primitive that paints WITHOUT calling _markDirty will leave ghost pixels
  // behind. If you add an effect, mark its bounds, generously: over-reporting
  // only costs fill rate, under-reporting corrupts the frame.
  // ---------------------------------------------------------------------------
  // "Is anything actually in motion this frame?" - the frame governor's hot-gear
  // test, and the fourth of the six touchpoints for adding an effect.
  //
  // Extracted from the canvas tick so it can be TESTED. Missing an entry here is
  // the one effect-authoring mistake that is both silent and user-visible: the
  // loop judges the frame static, drops to its idle heartbeat, and the
  // effect freezes mid-animation whenever nothing else happens to be moving. It
  // was previously guarded by a comment alone while every other effect invariant
  // in this file had coverage. See test.js, "frame governor".
  //
  // MUST STAY A PURE READ. The gear decision runs before draw(), and anything
  // that retires state here (glitchState() would - it drops an expired burst as
  // a side effect) would retire it before the frame that should have painted it.
  // ---------------------------------------------------------------------------
  _isAnimating(this: CursorSmithPlugin, nowT: number) {
    // Trail ghosts are painted only under the CRT effect (forEachTrailPoint)
    // and pushTrail records none without it; a trail recorded while it was
    // on may still be fading after it is switched off, and that must not
    // hold the hot gear for something nobody can see.
    const crt = !!this.look.crtEffect;
    return (
      !!this._smoothMoving ||
      !!this.pending ||
      (crt && this.trail && this.trail.length > 0) ||
      (this.particles && this.particles.length > 0) ||
      // flamePixels are aged inside draw(), so a skipped frame would
      // freeze a burst mid-flight rather than letting it expire.
      (this.flamePixels && this.flamePixels.length > 0) ||
      // Same again for Hot-head's fire, aged in its own draw call.
      (this.flameEmbers && this.flameEmbers.length > 0) ||
      // ...and the effect itself, not just its live particles. While
      // Hot-head is on the fire is continuously animating by definition,
      // and the particle test alone has a hole in it: the instant the
      // pool empties the loop would judge the frame static, drop to the
      // idle heartbeat, and the next spawn would arrive as one
      // lumpy burst instead of a steady flame.
      (!!this.styleFor("hotHead") && !!this.animActive && this.hotHeadFeeding(nowT)) ||
      // Same reasoning: a bolt is aged and expired inside its draw call,
      // so a skipped frame would leave one frozen on screen.
      (this.thunderbolts && this.thunderbolts.length > 0) ||
      // A carriage return is aged inside its draw call too.
      (this.typeReturns && this.typeReturns.length > 0) ||
      // A Typewriter stroke is a wall-clock animation of the caret itself.
      this.typewriterMoving(nowT) ||
      // And again for a firework. Note this covers a shell still sitting
      // out its stagger delay, which paints nothing yet but must not be
      // allowed to drop the loop into the idle heartbeat - the volley
      // would land in lumps a tenth of a second apart.
      (this.fireworks && this.fireworks.length > 0) ||
      // A Signal Glitch burst is a ~200ms wall-clock animation, so it
      // needs continuous frames for its whole life. Tested inline rather
      // than via glitchState() because that RETIRES an expired burst as a
      // side effect, and the gear decision must stay a pure read - the
      // draw call below is what should do the retiring.
      (!!this.glitch && (nowT - this.glitch.start) < this.glitch.dur) ||
      this.heat > 0 ||
      // Every full-effect secondary carries the same motion fields (see
      // CARET_STATE_FIELDS), and a settling spring or a live trail on any of
      // them needs frames exactly as the primary's does. A pure read of the
      // bundles, nothing swapped in.
      (this._secondaries && this._secondaries.some((c) =>
        !!c._smoothMoving || !!c.pending || !!c._smearMoving ||
        (crt && c.trail && c.trail.length > 0) ||
        (!!c.glitch && (nowT - c.glitch.start) < c.glitch.dur) ||
        // Hot-head feeding on a secondary, same test as the primary's above.
        (!!this.styleFor("hotHead") && !!c.animActive && this._hotFeedingAt(c._hotActiveT, nowT)))) ||
      // Precise: the spring reports whether any corner is still off its
      // target or carrying velocity. This used to be a 1200ms window
      // after the last motion, which was a workaround for a timestamp
      // that was being restamped every frame and so never expired. Now
      // that the spring snaps exactly onto its targets when it settles,
      // it cannot flap back and forth, so the grace period is dead
      // weight - it just held the hot gear for an extra 1.2s after every
      // smear finished.
      !!this._smearMoving
    );
  },

  // The gear for this frame and what decided it; the tick applies the
  // result. Pure reads. `why` is the first reason that held, for the
  // report's "awake because", built only when a report is running.
  //
  // Gears: anything genuinely in motion (_isAnimating) or an input within
  // INPUT_HOT_MS is hot; a blink fade or armed stardust is warm; the energy
  // shimmer alone is its own slow gear - it is driven by wall clock and has
  // to keep repainting, but at ~1.7 s a cycle 20 fps is fifty samples and
  // looks identical to sixty; otherwise idle. Stardust deliberately never
  // claims hot: it runs *because* nothing is happening, and a slow drift is
  // smooth at the warm gear; `armed` rather than "motes alive" keeps the
  // loop warm through the gaps between emissions, where the idle heartbeat
  // would make the spawn cadence stutter. The blink's window is phase-based
  // (blinkWindow), so the warm gear covers a fade from its first frame.
  _decideGear(this: CursorSmithPlugin, nowT: number, wantWhy: boolean): GearDecision {
    const eff = this.look;
    const animating = this._isAnimating(nowT);
    const energyShimmer = !!eff.energyEffect && !!this.lastActive;
    const recentInput = nowT - (this._lastActivityT || 0) < INPUT_HOT_MS;
    let blinkFading = false;
    let blinkBucket = 1;
    let idleWake = Infinity;
    if (eff.blinkingEnabled && this.lastActive) {
      // The phase, not the alpha: with Breathing on the alpha is pinned at 1
      // while the caret is still visibly changing size.
      const a = this.blinkPhase(nowT);
      blinkBucket = a >= 0.5 ? 1 : 0;
      const w = this.blinkWindow(nowT);
      blinkFading = w.fading;
      idleWake = w.msToNext;
    }
    const stardustLive = this.stardust.length > 0;
    const stardustActive = stardustLive || this.stardustArmed();
    const gear = animating || recentInput ? "hot"
      : blinkFading || stardustActive ? "warm"
      : energyShimmer ? "energy"
      : "idle";
    // stardustLive, not stardustActive: armed with no motes paints nothing
    // new, so those frames can still be skipped as static.
    const staticFrame = !animating && !blinkFading && !energyShimmer && !stardustLive;
    let why = "";
    if (wantWhy) {
      why = this._smoothMoving ? "glide"
        : this.pending ? "pending move"
        : eff.crtEffect && this.trail && this.trail.length > 0 ? "trail"
        : this.particles && this.particles.length > 0 ? "particles"
        : (this.flamePixels && this.flamePixels.length > 0) || (this.flameEmbers && this.flameEmbers.length > 0) ? "pixels"
        : (this.thunderbolts && this.thunderbolts.length > 0) || (this.fireworks && this.fireworks.length > 0) ? "pops"
        : this.glitch && nowT - this.glitch.start < this.glitch.dur ? "glitch"
        : this.heat > 0 ? "heat"
        : this._smearMoving ? "smear"
        : !!this.styleFor("hotHead") && !!this.animActive && this.hotHeadFeeding(nowT) ? "fire"
        : animating ? "secondaries"
        : recentInput ? "input:" + (this._lastActivityKind || "?")
        : blinkFading ? "blink"
        : stardustActive ? "stardust"
        : energyShimmer ? "energy"
        : "idle";
    }
    return { gear, staticFrame, blinkBucket, idleWake, why };
  },

  // What a static frame would paint, as a string; when it matches the last
  // frame's the draw is skipped. The look's part is ONE number, the look
  // generation (_lookGen: bumped by saveSettings, a preset, the
  // reduced-motion query flipping - every path that changes what
  // this.look answers), instead of a list of every look key that reaches a
  // pixel. That list was kept by hand, and eight of its entries were bug
  // fixes: a toggle that "did nothing until the next keystroke" because the
  // key was missing here. The rest is what changes without a setting: the
  // Vim mode (its own look), the blink's half, the theme, the caret's place,
  // shape and glyph to the half-pixel, the plain secondaries, the tether,
  // the full secondaries and the smear quad (a spring with its own state;
  // it keeps deforming after the caret has stopped, and without it here a
  // settled frame stranded a stretched ghost on screen).
  _frameSignature(this: CursorSmithPlugin, vimMode: string | null, blinkBucket: number): string {
    const la = this.lastActive;
    const isDark = this.canvas
      ? this.canvas.ownerDocument.body.classList.contains("theme-dark")
      : true;
    // The record carries `top` and `bottom`, not `y`.
    const sec = this.secondaryCarets && this.secondaryCarets.length
      ? this.secondaryCarets.map((c) => (c.x | 0) + ":" + (c.top | 0) + ":" + (c.bottom | 0)).join(",")
      : "";
    // The tether moves without the caret moving (a scroll, an edit that
    // shifts the match).
    const bt = this.bracketTether && this.bracketTether.length
      ? this.bracketTether.map((s) => (s.x1 | 0) + ":" + (s.y1 | 0) + ":" + (s.x2 | 0) + ":" + (s.y2 | 0)).join(",")
      : "";
    return [
      vimMode, this._lookGen | 0, blinkBucket, isDark,
      la ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," +
           Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "") : "none",
      sec, bt, this._secondariesSig(), this._smearSig(),
    ].join("|");
  },

  _markDirty(this: CursorSmithPlugin, x: number, y: number, w: number, h: number) {
    const d = this._dirty;
    if (!d) {
      this._dirty = { x0: x, y0: y, x1: x + w, y1: y + h };
      return;
    }
    if (x < d.x0) d.x0 = x;
    if (y < d.y0) d.y0 = y;
    if (x + w > d.x1) d.x1 = x + w;
    if (y + h > d.y1) d.y1 = y + h;
  },

  forEachTrailPoint(this: CursorSmithPlugin, cb: TrailPointCallback) {
    if (!this.look.crtEffect) return;
    const now = performance.now();
    const fade = Math.max(50, this.look.trailFadeMs);
    for (const p of this.trail) {
      const age = (now - p.t) / fade;
      const alpha = Math.max(0, 1 - age) * 0.55;
      if (alpha > 0.02) {
        // Padded for stroke width and the shadowBlur glow the CRT effect adds.
        // Neon spills a wider glow, so pad more when it's on. The neon ghost is
        // now just the caret's own footprint (see drawNeonGhost), so no extra
        // horizontal allowance is needed beyond the glow pad.
        const pad = this.look.crtNeon ? 22 : 14;
        this._markDirty(p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2);
        // `age` (0 = freshest ghost, 1 = about to vanish) is passed so the neon
        // gradient can run the ramp ALONG the trail rather than within each dot.
        cb(p, alpha, Math.max(0, Math.min(1, age)));
      }
    }
  },

  // =========================================================================
  // Frame governor — power management for the render loops
  // =========================================================================
  // Both render loops used to run requestAnimationFrame unconditionally: the
  // full DOM-read + clear + redraw pipeline executed at display refresh rate
  // (120fps on ProMotion Macs) even while the cursor sat perfectly still.
  // That measured ~20% CPU/GPU at idle on Apple Silicon. The governor gives
  // each loop three gears:
  //   hot  — continuous rAF (capped near 60fps on high-refresh displays),
  //          while input is recent or any animation is genuinely in flight
  //   warm — ~30fps, only while a blink fade is mid-transition
  //   idle — a 200 ms heartbeat (or the blink's next fade, if sooner) that
  //          re-checks state and repaints ONLY if the
  //          picture changed; with a static, non-fading cursor the canvas
  //          isn't touched at all, so idle cost approaches zero
  // Input events snap the loops back to hot instantly (the pending idle
  // timeout is cancelled and a frame is requested immediately), so the
  // scheduling can never add perceptible input latency.

  // Called from input events. Timestamps the activity and wakes any dozing
  // loop right now instead of letting it sleep out its timeout.
  // Anything that can move the caret on screen bumps this; the geometry
  // caches (cmCaretCoords, getPaneRect, the secondaries') are keyed on it.
  // Layout may have moved the caret: drop the geometry caches and have the
  // loop look now rather than on the heartbeat. Cheap when it finds nothing
  // (one tick, a signature that matches, no draw), and it is what lets a
  // sidebar animating shut, or a slider dragged in the settings window
  // (saveSettings calls this), move the caret on the next frame instead of
  // up to a heartbeat later.
  _invalidateLayout(this: CursorSmithPlugin) {
    this._layoutGen = (this._layoutGen | 0) + 1;
    this._wakeLoop();
  },

  // The caret's computed style may have changed under it - css-change, a
  // layout change, a resize (which is also how a zoom arrives). The style
  // cache in cmCaretCoords is keyed on this generation. Kept apart from the
  // layout generation, which every scroll and keystroke bumps: a scroll
  // moves the caret, it does not change the font under it, and re-reading
  // computed styles and hit-testing the line on every scroll event was the
  // alternative.
  _invalidateStyle(this: CursorSmithPlugin) {
    this._styleGen = (this._styleGen | 0) + 1;
    this._invalidateLayout();
  },

  // A dozing loop (warm, energy or idle: parked on a timeout) is put on the
  // next frame. A hot loop is already on requestAnimationFrame and needs
  // nothing, and a tick in progress has no timeout to cancel.
  _wakeLoop(this: CursorSmithPlugin) {
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
      if (this.canvasEngineActive && this._canvasTick) {
        this.canvasRaf = window.requestAnimationFrame(this._canvasTick);
      }
    }
  },

  // The frame loop's watchdog, on an interval from onload. The plugin hides
  // Obsidian's caret and draws its own, so a loop that stops - a frame that
  // threw before it rescheduled, an animation frame that never came back -
  // leaves the editor with no caret at all, the worst thing this plugin can
  // do. A parked loop still ticks at the idle heartbeat, so a visible
  // document with no tick for WATCHDOG_STALE_MS is a dead loop: it is
  // restarted (enable), the console says so, and on the second stall the
  // native caret is handed back (hideNativeActive reads _watchdogGaveUp)
  // until the plugin is next enabled by hand. Not a stall: a hidden
  // document (no animation frames by design), or an interval that was
  // itself late by as much - the main thread was blocked, and the loop
  // never had a chance. Trips are forgotten after a healthy minute.
  _watchdog(this: CursorSmithPlugin, now: number) {
    const lastRun = this._watchdogLastT || now;
    this._watchdogLastT = now;
    if (!this.canvasEngineActive) return;
    const doc = (this.canvas && this.canvas.ownerDocument) || document;
    if (doc.visibilityState === "hidden" || now - lastRun > WATCHDOG_INTERVAL_MS * 1.5) {
      this._lastTickT = now;
      return;
    }
    const silent = now - (this._lastTickT || now);
    if (silent < WATCHDOG_STALE_MS) {
      if (this._watchdogTrips && now - (this._watchdogTripT || 0) > 60000) this._watchdogTrips = 0;
      return;
    }
    this._watchdogTrips = (this._watchdogTrips | 0) + 1;
    this._watchdogTripT = now;
    this._reportOnce("watchdog, stall " + this._watchdogTrips, new Error(`no frame for ${Math.round(silent)} ms: restarting the loop`));
    try { this.enable(); } catch (e) { this._reportOnce("watchdog restart", e); }
    if (this._watchdogTrips >= 2) {
      this._watchdogGaveUp = true;
      try { this.applyBodyClasses(); } catch (e) { this._reportOnce("watchdog body classes", e); }
    }
  },

  _markActivity(this: CursorSmithPlugin, kind = "") {
    this._lastActivityT = performance.now();
    if (kind) this._lastActivityKind = kind;
    this._invalidateLayout();
    this._wakeTorch();
  },

  // A ResizeObserver on the active editor's content and scroller: an embed
  // or image finishing its load, a line wrapping differently after a font
  // loads - anything that changes the content's size moves the caret without
  // an input event, and bumps the layout generation here. Re-pointed when
  // the active editor changes; disconnected on unload.
  //
  // And a MutationObserver on the content, for what changes the line under
  // the caret without changing its size: Live Preview reveals a heading's
  // "# " a beat after a click lands in it (a second transaction on mouseup,
  // some 60 ms later - an arrow key reveals it in the same frame) and the
  // text shifts right by the markup's width. Same document, same selection,
  // so no event the plugin listens to fires, and the geometry cache in
  // cmCaretCoords kept the pre-reveal spot for its whole TTL: the caret
  // landed short of the end and hopped 400 ms later. A change in the
  // content DOM bumps the layout generation and wakes a frame, and the
  // next measurement reads the revealed line. The callback writes nothing
  // it watches (the canvas is never inside the content).
  _observeEditorLayout(this: CursorSmithPlugin, view: EditorView | null | undefined) {
    if (this._roView === view) return;
    try { this._ro?.disconnect(); this._mo?.disconnect(); } catch { /* gone */ }
    this._ro = null; this._mo = null;
    this._roView = view || null;
    if (!view) return;
    if (typeof ResizeObserver !== "undefined") {
      try {
        this._ro = new ResizeObserver(() => this._invalidateLayout());
        // border-box: a padding change on the content moves every line too,
        // and the default content-box would not report it.
        if (view.contentDOM) this._ro.observe(view.contentDOM, { box: "border-box" });
        if (view.scrollDOM) this._ro.observe(view.scrollDOM, { box: "border-box" });
      } catch { this._ro = null; /* no ResizeObserver, or a view mid-teardown: fall back to the events */ }
    }
    if (typeof MutationObserver !== "undefined" && view.contentDOM) {
      try {
        this._mo = new MutationObserver(() => this._invalidateLayout());
        this._mo.observe(view.contentDOM, { childList: true, subtree: true, characterData: true });
      } catch (e) { this._mo = null; this._reportOnce("content observer", e); }
    }
    this._invalidateLayout();
  },

  // Whether a scroll or wheel event on `target` can move the caret: the
  // document itself (a window scroll), the active editor's scroller or an
  // ancestor of it, or any element containing the focused field. Everything
  // else scrolls something the caret is not in. See registerWindowEvents.
  _scrollMovesCaret(this: CursorSmithPlugin, target: EventTarget | null, doc: Document) {
    if (!target) return true;
    if (target === doc || target === (doc && doc.documentElement) || target === (doc && doc.defaultView)) return true;
    const node = target as Node | null;
    const contains = node && typeof node.contains === "function" ? (el: Node | null) => !!el && node.contains(el) : () => false;
    let scroller = null;
    try { scroller = this.app.workspace.activeEditor?.editor?.cm?.scrollDOM || null; } catch { scroller = null; /* an editor mid-teardown has no scroller */ }
    if (scroller && (target === scroller || contains(scroller) || (typeof scroller.contains === "function" && scroller.contains(node)))) return true;
    const active = doc && doc.activeElement;
    if (active && active !== doc.body && contains(active)) return true;
    return false;
  },

  // Whether the document's selection is somewhere else than when this last
  // answered. Android's WebView, and CodeMirror re-syncing the DOM selection
  // to its own, fire selectionchange with the caret exactly where it was;
  // each used to buy INPUT_HOT_MS of the hot gear. Compared, not stamped:
  // the editor's selection (its document, anchor, head, assoc and range
  // count) while the editor has focus, a field's own selection when a field
  // does, the DOM selection's two ends otherwise. When in doubt (a probe
  // throws), the answer is yes.
  _selectionMoved(this: CursorSmithPlugin, doc: Document): boolean {
    let sig: SelectionSig;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (view && view.hasFocus && view.dom.ownerDocument === doc) {
        const sel = view.state.selection;
        const m = sel.main;
        sig = { a: view.state.doc, b: null, n: m.anchor, h: m.head, o: m.assoc || 0, k: sel.ranges.length };
      } else {
        const el = doc.activeElement as HTMLInputElement | null;
        const start = el ? el.selectionStart : null;
        if (el && typeof start === "number") {
          sig = { a: el, b: null, n: start, h: el.selectionEnd ?? start, o: 0, k: 1 };
        } else {
          const s = doc.getSelection();
          sig = s
            ? { a: s.anchorNode, b: s.focusNode, n: s.anchorOffset, h: s.focusOffset, o: 0, k: s.rangeCount }
            : { a: null, b: null, n: -1, h: -1, o: 0, k: 0 };
        }
      }
    } catch {
      // A probe threw (a document or editor mid-teardown): when in doubt, wake.
      this._selSig = null;
      return true;
    }
    const prev = this._selSig;
    this._selSig = sig;
    if (!prev) return true;
    return prev.a !== sig.a || prev.b !== sig.b || prev.n !== sig.n || prev.h !== sig.h || prev.o !== sig.o || prev.k !== sig.k;
  },

  // Count what the loop does for `seconds`, then put a report on the
  // clipboard (and in the console). The counters live on this._perf and
  // the tick adds to them only while that is set; see the tick.
  performanceReport(this: CursorSmithPlugin, seconds: number = 10) {
    if (this._perf) {
      new Notice("Cursor-Smith: a performance report is already running.");
      return;
    }
    const perf = this._perf = this._freshPerf();
    let po = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { perf.longTasks++; perf.longTaskMs += e.duration; }
      });
      po.observe({ entryTypes: ["longtask"] });
    } catch { po = null; /* no PerformanceObserver, or no longtask entries on this platform */ }
    const onKey = () => { perf.keys++; };
    const doc = (this.canvas && this.canvas.ownerDocument) || document;
    doc.addEventListener("keydown", onKey, true);
    new Notice(`Cursor-Smith: measuring for ${seconds} seconds - keep using Obsidian as you normally would.`);
    window.setTimeout(() => {
      this._perf = null;
      if (po) { try { po.disconnect(); } catch { /* gone */ } }
      doc.removeEventListener("keydown", onKey, true);
      const text = this.perfReportText(perf, seconds);
      const clip = (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"));
      clip.then(
        () => new Notice("Cursor-Smith: report copied to the clipboard."),
        () => {
          // No clipboard: the console is the fallback delivery, so this is
          // the one log the plugin makes, and only on that path.
          console.warn(text);
          new Notice("Cursor-Smith: report is in the developer console (Ctrl+Shift+I).");
        });
    }, seconds * 1000);
  },

  _freshPerf(this: CursorSmithPlugin): PerfCounters {
    return {
      t0: performance.now(), ticks: 0, draws: 0, gears: {}, tickMs: 0, caretMs: 0, drawMs: 0,
      reanchors: 0, longTasks: 0, longTaskMs: 0, rafGaps: {}, rafPrev: 0, keys: 0, why: {},
    };
  },

  // The report's text. Pure apart from reading the environment, so the
  // shape can be tested with a synthetic counter object. Everything in it is
  // either a number the tick counted or a fact about the machine and the
  // configuration; nothing that identifies the vault or its contents.
  perfReportText(this: CursorSmithPlugin, perf: PerfCounters, seconds: number): string {
    const s = this.settings || ({} as CursorSmithSettings);
    const secs = Math.max(0.001, seconds);
    const gearTotal = Object.values(perf.gears).reduce((a, b) => a + b, 0) || 1;
    const gears = Object.entries(perf.gears).sort((a, b) => b[1] - a[1])
      .map(([g, n]) => `${g} ${Math.round(100 * n / gearTotal)}%`).join(", ") || "none";
    const whyTotal = Object.values(perf.why || {}).reduce((a, b) => a + b, 0) || 1;
    const why = Object.entries(perf.why || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([w, n]) => `${w} ${Math.round(100 * n / whyTotal)}%`).join(", ") || "none";
    const on = [];
    for (const k of ["gradientEnabled", "crtEffect", "glow", "crtNeon", "crtGlitch", "cursorTranslucent", "cursorRounded",
                     "blinkingEnabled", "smear", "smoothEnabled", "energyEffect", "popEffects", "popLetters", "typewriter", "flameTrail",
                     "fireworks", "thunderstrike", "backspaceDisintegrate", "hotHead", "stardustEnabled", "speedDemon",
                     "bracketTether", "torchEffect", "vimModeEnabled"]) {
      if (s[k as SettingKey]) on.push(k);
    }
    let gpu = "unknown";
    try {
      const c = createEl("canvas");
      const gl = c.getContext("webgl");
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : (gl ? "webgl, no renderer info" : "no webgl");
    } catch { /* leave unknown */ }
    let code = "";
    try { code = presetToCode("report", s); } catch { code = "(unavailable)"; /* a settings object the codec cannot encode */ }
    const nav: ReportNavigator = typeof navigator !== "undefined" ? navigator : {};
    const win: ReportWindow = typeof window !== "undefined" ? window : {};
    const clip = this._clipRect;
    const region = this._canvasRect;
    const app = (this.app || {}) as ReportApp;
    const themeName = (app.customCss && (app.customCss.theme || app.customCss.currentTheme)) || "default";
    const snippets = app.customCss && app.customCss.enabledSnippets ? app.customCss.enabledSnippets.size : 0;
    const plugins = app.plugins && app.plugins.enabledPlugins ? app.plugins.enabledPlugins.size : 0;
    let gap = 0, gapN = 0;
    for (const [g, n] of Object.entries(perf.rafGaps || {})) { if (n > gapN) { gapN = n; gap = Number(g); } }
    const hz = gap > 0 ? Math.round(1000 / gap) : null;
    const lines = [
      `Cursor-Smith performance report (${(this.manifest && this.manifest.version) || "?"}), ${secs.toFixed(0)}s`,
      `environment: ${nav.userAgent || "?"}`,
      `platform ${nav.platform || "?"}; window ${win.innerWidth || "?"}x${win.innerHeight || "?"} @${win.devicePixelRatio || "?"}x; display ~${hz ? hz + "Hz" : "unmeasured (no hot frames)"}`,
      `gpu: ${gpu}`,
      `theme: ${themeName}; snippets on: ${snippets}; plugins on: ${plugins}`,
      `pane: ${clip ? clip.w + "x" + clip.h : "none"}; canvas region now: ${region ? region.w + "x" + region.h : "none"}`,
      `settings: style ${s.cursorStyle || "?"}; low power ${s.lowPowerMode ? "on" : "off"}; hide when unfocused ${s.hideOnWindowBlur === false ? "off" : "on"}; note editor only ${s.noteEditorOnly ? "on" : "off"}; reduced motion ${this.reducedMotion && this.reducedMotion() ? "ACTIVE" : "no"}`,
      `effects on: ${on.join(", ") || "none"}`,
      `share code: ${code}`,
      `loop: ${perf.ticks} ticks (${(perf.ticks / secs).toFixed(1)}/s), ${perf.draws} draws (${(perf.draws / secs).toFixed(1)}/s), gears ${gears}, ${perf.reanchors} canvas re-anchors, ${perf.keys} keystrokes`,
      `awake because: ${why}`,
      `cost per frame: tick ${perf.ticks ? (perf.tickMs / perf.ticks).toFixed(2) : "0"}ms (caret measure ${perf.ticks ? (perf.caretMs / perf.ticks).toFixed(2) : "0"}ms), draw ${perf.draws ? (perf.drawMs / perf.draws).toFixed(2) : "0"}ms; plugin main-thread total ${perf.tickMs.toFixed(0)}ms of ${(secs * 1000).toFixed(0)}ms (${(100 * perf.tickMs / (secs * 1000)).toFixed(1)}%)`,
      `long tasks (anything over 50ms, any source): ${perf.longTasks}, ${perf.longTaskMs.toFixed(0)}ms total`,
    ];
    return lines.join("\n");
  },
};
export type EngineMethods = typeof engineMethods;
