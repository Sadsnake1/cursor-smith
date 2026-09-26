// Part of the plugin class, split out by seam (HANDOFF §1.16, ARCHITECTURE
// "Should this be split?"): the methods below are assigned onto
// CursorSmithPlugin.prototype and declared on the class, so every `this.x`
// read and every test reach them exactly as before. `this` is the plugin.
//
// The torch spotlight: its own overlay and its own render loop, a darkness
// layer with a hole per caret and a warm glow inside it (the painters are
// in torch-paint.ts), following the caret, the mouse, or whichever moved
// last.

import { hexToRgb } from "./color";
import { torchFlickerScale } from "./motion";
import { VIM_MODE_KEYS } from "./settings";
import { paintTorchDarkness, paintTorchGlow, torchCanvasContext } from "./torch-paint";
import type { EditorView } from "@codemirror/view";
import type { Box, Pt } from "./types";
import type CursorSmithPlugin from "./plugin";

// The regions' part of a painter's dedupe key.
const regionsKey = (regions: Box[] | null | undefined) =>
  regions ? regions.map((b) => Math.round(b.left) + "," + Math.round(b.top) + "," + Math.round(b.width) + "," + Math.round(b.height)).join(";") : "";

export const torchMethods = {
  // Whether the torch overlay engine might be needed: either the global cursor
  // uses it, or Vim cursors are on and some mode uses it. The torch tick then
  // shows/hides + restyles the overlay per the effective (per-mode) settings.
  torchPossible(this: CursorSmithPlugin): boolean {
    if (this.settings.torchEffect) return true;
    if (this.settings.vimModeEnabled && this.settings.vimModes) {
      for (const m of VIM_MODE_KEYS) {
        if (this.settings.vimModes[m] && this.settings.vimModes[m].torchEffect) return true;
      }
    }
    return false;
  },

  // The torch's look - darkness, colour, radius - is painted by the torch
  // tick from the effective settings every frame it changes (see
  // _torchPaintDarkness / _torchPaintGlow), so a settings change has nothing
  // to apply to the elements themselves. Kept as the hook saveSettings and
  // the tick call, so the dedupe keys can be dropped here: the painters
  // compare against them, and a changed Darkness or Colour must repaint.
  applyOverlayStyle(this: CursorSmithPlugin) {
    this._torchDarkKey = "";
    this._torchGlowKey = "";
  },

  ensureTorchOverlayForView(this: CursorSmithPlugin, view: EditorView | null | undefined) {
    // Any look that can light it, not the global switch alone: the tick
    // calls this when the look of the moment (a Vim mode's) wants the torch,
    // and with the global torch off the old check tore the whole engine down
    // on every frame - a torch only in Insert never lit (issue #34).
    if (!this.torchPossible()) {
      this.disableTorchOverlay();
      return;
    }
    // CRASH FIX: same null-deref as ensureCanvasForView - this function
    // exists to CREATE this.overlay, so it can't rely on this.overlay
    // already existing to pick a document. With no view (refocus, no note
    // open) and no overlay yet, the old code threw and the torch rAF loop
    // died silently.
    //
    // Never activeDocument. Since Obsidian 1.13 that is the settings window
    // while it is being used, and with no note active (a non-note leaf in
    // front) and no overlay yet - the effect just switched on from a
    // preset's chip - the old chain created the overlay THERE, and with no
    // editor pane in that window to spare, it dimmed the whole settings
    // window. The torch is a reading light over the editor: the editor's
    // window, or where the overlay already is, or the main window.
    const targetDoc =
      (view && view.dom.ownerDocument) ||
      (this.overlay && this.overlay.ownerDocument) ||
      document;
    if (this.overlay && this.overlay.ownerDocument !== targetDoc) {
      this.overlay.remove();
      this.overlay = null;
      this.modalObserver?.disconnect();
      this.modalObserver = null;
    }
    if (!this.overlay) {
      targetDoc.body.classList.add("cursor-smith-torch-active");
      // Same as canvas wrapper: append inside .app-container to avoid
      // Obsidian's body.is-frameless > .app-container ~ * { no-drag } rule.
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.overlay = appContainer.createEl("canvas", { cls: "cursor-smith-torch-overlay" });
      this._torchDarkKey = "";
      // Collapsed to 0x0 at 0,0 by the .cursor-smith-torch-overlay rule until the
      // tick sizes it.
      this._lastOverlayRect = "";
      // A brand new element carries none of the old one's inline custom
      // properties, so the radius cache has to be dropped with it or the tick
      // would dedupe against a value this overlay was never given.
      this._lastTorchRadius = -1;
      this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
      this.applyOverlayStyle();
      
      // Two readings of the same watch: a modal (the desktop stand-down
      // with the sidebars spared), and anything that covers the note on a
      // phone - a modal, a menu, the bottom sheet (a menu too) - where
      // the torch stands down for all of them (the tick; drawers are read
      // off the workspace there).
      const covered = () => {
        this.modalOpen = !!targetDoc.querySelector(".modal-container");
        this._coverOpen = this.modalOpen || !!targetDoc.querySelector("body > .menu, .menu-container");
      };
      covered();
      this.modalObserver = new MutationObserver(covered);
      this.modalObserver.observe(targetDoc.body, { childList: true });
    }
  },

  // Paint the darkness layer for these lights, if anything about the picture
  // changed since the last paint: a moved light, a new radius, a new size,
  // a new setting. A parked torch does not touch the bitmap.
  // The note tabs' rectangles in the overlay's own coordinates, for the
  // painters' clip; null with the whole overlay dark.
  _torchLocalRegions(this: CursorSmithPlugin): Box[] | null {
    const notes = this._torchRegions;
    const box = this._overlayBox;
    if (!notes || !box) return null;
    return notes.map((b) => ({ left: b.left - box.left, top: b.top - box.top, width: b.width, height: b.height, right: b.right - box.left, bottom: b.bottom - box.top }));
  },

  _torchPaintDarkness(this: CursorSmithPlugin, spots: Pt[], radiusPx: number, darkness: number, w: number, h: number, regions?: Box[] | null) {
    const el = this.overlay;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + darkness + "|" +
      spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";") + "|" + regionsKey(regions);
    if (key === this._torchDarkKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchDarkKey = key;
    paintTorchDarkness(ctx, w, h, spots, radiusPx, darkness, regions);
  },

  _torchPaintGlow(this: CursorSmithPlugin, spots: Pt[], radiusPx: number, warmRgb: string, w: number, h: number, regions?: Box[] | null) {
    const el = this.glowEl;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + warmRgb + "|" +
      spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";") + "|" + regionsKey(regions);
    if (key === this._torchGlowKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchGlowKey = key;
    paintTorchGlow(ctx, w, h, spots, radiusPx, warmRgb, regions);
  },

  // Build or tear down the additive glow layer.
  //
  // Called from the torch tick, NOT from ensureTorchOverlayForView: that runs
  // before the Vim per-mode settings swap, so a mode that turns the glow up
  // while the global setting has it at 0 would silently get no layer to light.
  // Decide after the swap. (Same rule as the canvas engine's lazy layers.)
  //
  // Torn down rather than hidden when unused, because a blended layer forces a
  // re-composite of everything beneath it whether or not it paints anything.
  _ensureGlowLayer(this: CursorSmithPlugin, wanted: boolean) {
    if (!wanted) {
      if (this.glowEl) { this.glowEl.remove(); this.glowEl = null; this._torchGlowKey = ""; }
      return null;
    }
    const doc = this.overlay && this.overlay.ownerDocument;
    if (!doc) return null;
    // Follow the overlay between documents, same as everything else here.
    if (this.glowEl && this.glowEl.ownerDocument !== doc) {
      this.glowEl.remove();
      this.glowEl = null;
    }
    if (!this.glowEl) {
      const appContainer = doc.querySelector(".app-container") || doc.body;
      // Sibling of the overlay, deliberately - see the CSS note in styles.css.
      this.glowEl = appContainer.createEl("canvas", { cls: "cursor-smith-torch-glow" });
      this._torchGlowKey = "";
      this._lastGlowRect = "";
      this._lastGlowAlpha = "";
      this._torchGlowKey = "";
    }
    return this.glowEl;
  },

  disableTorchOverlay(this: CursorSmithPlugin) {
    this.torchEngineActive = false;
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
    }
    this._torchTick = null;
    this._torchRegions = null;
    this._torchDarkKey = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    if (this.torchRaf) {
      window.cancelAnimationFrame(this.torchRaf);
      this.torchRaf = 0;
    }
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("cursor-smith-torch-active");
        doc.querySelector(".cursor-smith-torch-overlay")?.remove();
        doc.querySelector(".cursor-smith-torch-glow")?.remove();
      }
    }
    this.overlay = null;
    // The glow is a sibling, so removing the overlay does not take it with it.
    this.glowEl?.remove();
    this.glowEl = null;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._torchDarkKey = "";
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.modalOpen = false;
    this._coverOpen = false;
  },

  enableTorchOverlay(this: CursorSmithPlugin) {
    this.torchEngineActive = true;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;

    const schedule = () => {
      if (!this.torchEngineActive) return;
      if (this._torchGear === "hot") {
        this.torchRaf = window.requestAnimationFrame(tick);
        return;
      }
      // Parked or hidden: a heartbeat is plenty to notice the effect being
      // re-enabled, a mode switch, or the pane moving. Blink Sync asks for a
      // middle cadence instead - fast enough to render the blink's fades
      // smoothly, slow enough not to be the hot gear. Both from FRAME_CAPS.
      const caps = this._frameCaps();
      // Parked: the heartbeat, or the blink's next fade if that is sooner
      // (the tick sets _torchIdleWakeMs from blinkWindow while Blink Sync is on).
      const idleMs = Math.min(caps.torchIdleMs, Math.max(1, Math.ceil(this._torchIdleWakeMs || caps.torchIdleMs)));
      const delay = this._torchGear === "pulse" ? caps.torchPulseMs : idleMs;
      this._torchIdleT = window.setTimeout(() => {
        this._torchIdleT = 0;
        if (this.torchEngineActive) this.torchRaf = window.requestAnimationFrame(tick);
      }, delay);
    };

    const tick = () => {
      if (!this.torchEngineActive) return;
      this._torchGear = "idle";
      this._torchIdleWakeMs = 0;
      try {
        // The spotlight's on/off state, color, size and follow speed can all
        // differ per Vim mode: every read below is this.look. Structured
        // without early returns so the frame is always rescheduled at the
        // bottom.
        {
          // The glow is a layer of its own, beside the overlay: hiding the
          // overlay leaves it lit. Every branch that puts the light out takes
          // it down too; only the lit branch below builds it again. It stayed
          // behind as a warm bloom where the caret last was - after Escape to
          // a mode without the torch, through scrolls and moves, into Reading
          // view (issue #34).
          if (this.presentationActive()) {
            // Same presentation-mode guard as the canvas engine.
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
            this._ensureGlowLayer(false);
          } else if (!this.look.torchEffect) {
            // This mode (or the global cursor) doesn't want the spotlight — just
            // hide it. Don't disable the engine: another mode may want it, and
            // switching back should be instant.
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
            this._ensureGlowLayer(false);
          } else if (
            !this.windowFocused() &&
            this.look.overlayBlinkSync && this.look.blinkingEnabled
          ) {
            // Window is not the focused OS window, so the canvas engine has
            // already parked and taken the cursor off screen (see its own tick).
            // With Blink Sync on, the light is meant to track the cursor's
            // visibility - and right now the cursor is showing nothing - so the
            // light should show nothing too, rather than sitting there fully lit
            // over an empty pane pointing at a caret that isn't drawn.
            //
            // Scoped to Blink Sync deliberately: a plain torch with no blink
            // coupling is an ambient reading light, and dousing that on every
            // alt-tab would be its own annoyance. This is the one mode whose
            // whole premise is "the light follows whether the cursor is shown".
            //
            // Closed rather than hidden: with hideOnWindowBlur off the caret
            // itself stays visible on blur, and yanking the whole overlay would
            // pop the darkness off in one frame.
            //
            // All the way shut, NOT to the pulse's floor. Mid-blink the light
            // only dips to (1 - depth) because the caret is back in a fraction
            // of a second; on blur it's gone until you return, so "the cursor
            // isn't shown, don't light up" means fully out, whatever the depth.
            //
            // Ramped shut over frames rather than written straight to the floor:
            // the overlay's only CSS transition is on opacity, not on the radius
            // (the pulse's smoothness comes entirely from the tick writing a new
            // radius each frame), so a single 1px write would SNAP the darkness
            // in. Easing it here keeps the loop in the "pulse" gear until it
            // arrives, which is the one gear that runs while nothing else does -
            // hence the ~5% cost note on Blink Sync in the first place. The 1px
            // floor (not 0) is the same degenerate-gradient guard the pulse
            // uses. On refocus the normal branch takes over and eases it open
            // the same way.
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            // The light is closing: the warm core goes with it.
            this._ensureGlowLayer(false);
            if (this.overlay) {
              this.overlay.classList.remove("cursor-smith-torch-hidden");
              const from = this._lastTorchRadius > 0 ? this._lastTorchRadius : this.look.overlayRadius;
              // Geometric approach to 1px: at ~28%/frame a 300px light closes
              // in roughly a dozen pulse-cadence frames (~0.5s), quick enough to
              // read as a response to leaving rather than a slow fade. The last
              // couple of pixels are snapped to the 1px floor rather than chased
              // geometrically - rounding has a fixed point at 2px, and without
              // the snap the loop would sit in the pulse gear forever rewriting
              // an unchanged value instead of parking at the idle heartbeat.
              const stepped = Math.round(from - (from - 1) * 0.28);
              const next = stepped <= 2 ? 1 : stepped;
              if (next !== this._lastTorchRadius) {
                this._lastTorchRadius = next;
                const box = this._overlayBox;
                if (box) {
                  this._torchPaintDarkness([{ x: this.x - box.left, y: this.y - box.top }], next,
                    this.look.overlayDarkness, box.width, box.height, this._torchLocalRegions());
                }
                // Still closing: hold the pulse cadence. Once it lands on 1px
                // the gear stays "idle" and the loop drops to the heartbeat.
                if (next > 1) this._torchGear = "pulse";
              }
            }
          } else {
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            if (view) this.registerWindowEvents(view.dom.ownerDocument);

            if (this.overlay) {
              // Re-apply overlay CSS variables only when the effective look
              // actually changed (per-mode color/size/etc.), to avoid style
              // churn every frame.
              const sig = [
                this.look.overlayRadius, this.look.overlayDarkness,
                this.look.overlayIntensity, this.look.overlayColor,
              ].join("|");
              if (sig !== this._overlaySig) {
                this._overlaySig = sig;
                this.applyOverlayStyle();
              }

              const useMouse = this.updateOverlayTarget();
              const lerp = this.look.overlaySpeed;
              this.x += (this.tx - this.x) * lerp;
              this.y += (this.ty - this.y) * lerp;

              // Still chasing the target => keep animating at full rate.
              // Settled => snap exactly onto the target (so the lerp can't
              // asymptote forever) and let the loop park; mouse movement and
              // caret activity wake it via _markActivity/_wakeTorch.
              const settled =
                Math.abs(this.tx - this.x) < 0.25 && Math.abs(this.ty - this.y) < 0.25;
              if (!settled) this._torchGear = "hot";
              else { this.x = this.tx; this.y = this.ty; }
              // The secondaries' lights, eased the same way. `useMouse` is
              // what updateOverlayTarget returned above.
              const spots = this.torchSpotlights(useMouse, lerp);

              // Sparing the sidebars means dimming the workspace's main area
              // - every note tab in every tab group, none of the docks, the
              // ribbon or the status bar (getMainAreaRect) - whichever leaf
              // has focus. It was the active editor's pane: every other tab
              // stayed lit (with a few tabs open the effect was gone), and
              // with no active editor - a click in the sidebar - it fell back
              // to the whole window, sidebars included.
              //
              // On a phone the note area is always the thing dimmed, whatever
              // the toggle says (its line reads "Desktop only"): the side
              // panes are drawers that slide OVER the note at Obsidian's
              // popover layer, the bottom sheet and the menus sit higher still,
              // and a whole-window dim covered every one of them ("it still
              // darkens the sidepanes and the bottom menu and other small
              // menus"). Dimming the note tabs only, and standing down while
              // a drawer, a menu or a modal is open (below), is what leaves
              // them lit.
              const isMobile = this.overlay.ownerDocument.body.classList.contains("is-mobile");
              const spare = isMobile || !!this.look.overlaySpareSidebars;
              const r = spare ? this.getMainAreaRect(this.overlay.ownerDocument) : null;
              const usePane = !!r;
              // Even when not sparing the sidebars, the overlay must never
              // cover the titlebar - getFullViewportRect clamps around it.
              const rect = usePane ? r : this.getFullViewportRect(this.overlay.ownerDocument);
              // Within the main area, only the NOTE tabs are darkened: the
              // views beside them (Word-Smith's History, Export and
              // Organizer, a graph, an empty tab) stay lit. Null means the
              // whole overlay is dark (the window, sidebars not spared).
              const notes = usePane ? this.getNoteTabRects(this.overlay.ownerDocument) : null;

              const top = Math.round(rect.top);
              const left = Math.round(rect.left);
              const width = Math.round(rect.width);
              const height = Math.round(rect.height);
              const key = top + "," + left + "," + width + "," + height;
              if (key !== this._lastOverlayRect) {
                this._lastOverlayRect = key;
                this.overlay.style.top = top + "px";
                this.overlay.style.left = left + "px";
                this.overlay.style.width = width + "px";
                this.overlay.style.height = height + "px";
              }

              // Resolved up here rather than at the point of use, because the
              // pulse below has to stand down while the overlay is hidden: a
              // hidden overlay has nothing to breathe, and the settings window
              // is itself a modal - so without this, opening the panel to turn
              // Blink Sync on would leave the torch pulsing away behind it for
              // as long as the panel stayed open.
              // ...and with no note in front anywhere in the main area there
              // is nothing to darken: the torch stands down.
              //
              // On a phone the torch stands down for anything that covers the
              // note: a modal (the settings are one there, in the same
              // document - not a window of their own as on desktop since
              // 1.13), a menu or the bottom sheet (_coverOpen, from the
              // observer above), and an open drawer (_drawerOpen, the
              // workspace's own flags). Desktop with the sidebars not spared
              // is unchanged: a whole-window dim covers a dialog too, and the
              // light follows the caret into it.
              const hideForModal = (spare && (this.modalOpen || (notes !== null && notes.length === 0))) || (isMobile && (this._coverOpen || this._drawerOpen()));

              // Blink Sync: the spotlight breathes with the caret, opening to
              // full size while the caret is lit and closing as it fades out.
              //
              // Driven from this tick, never from a CSS animation - see the
              // long note in styles.css about the candle flicker that used to
              // live there. blinkPhase() rather than blinkAlphaAt() on purpose:
              // it already accounts for the post-move hold, so the light holds
              // steady for exactly as long as the caret does after you type,
              // instead of breathing out of step with it - and it's the phase
              // rather than the alpha so the light still follows a caret that
              // is Breathing instead of fading.
              const pulse = !hideForModal &&
                !!this.look.overlayBlinkSync && !!this.look.blinkingEnabled;
              let radius = this.look.overlayRadius;
              if (pulse) {
                // Allowed all the way to 1, which is the setting that makes the
                // torch go out completely while the caret is blinked off: the
                // light closes to nothing rather than merely narrowing.
                const depth = Math.max(0, Math.min(1, this.look.overlayBlinkDepth ?? 0.25));
                const tNow = performance.now();
                radius *= 1 - depth * (1 - this.blinkPhase(tNow));
                // Not the hot gear: see FRAME_CAPS.torchPulseMs. Only claimed if
                // nothing above already asked for hot - a spotlight still
                // chasing the caret outranks this. And only through the blink's
                // two fades: the radius holds still for the rest of the cycle,
                // so the loop parks and is woken for the next fade on time
                // (blinkWindow), as the cursor loop is. It used to run the pulse
                // cadence through the holds too, writing nothing.
                const w = this.blinkWindow(tNow);
                if (w.fading && this._torchGear === "idle") this._torchGear = "pulse";
                this._torchIdleWakeMs = w.msToNext;
              }
              // Rounded to whole pixels and written only on a real change. This
              // is what makes the pulse affordable: the blink spends most of its
              // cycle in a hold, where the rounded radius doesn't move and no
              // style is touched at all, so only the two fades per cycle
              // actually repaint the blended overlay.
              // Floored at 1px rather than allowed to reach 0. A zero-radius
              // radial-gradient is degenerate and engines disagree about which
              // stop wins - and if the FIRST one did, "the light goes out"
              // would render as the warm colour washed across the whole pane,
              // the exact opposite of the intent. A 1px circle is well-defined
              // and, against a pane-sized dark field, invisible.
              const rKey = Math.max(1, Math.round(radius));
              this._lastTorchRadius = rKey;

              // Candle flicker. Driven from this tick so it stays under the
              // frame governor, never from a CSS animation - the reference does
              // it as a keyframe animation, which is exactly the implementation
              // this codebase deleted once already (it runs on the compositor
              // and pins the display at full refresh for as long as the torch
              // is lit, whatever gear the loops chose).
              //
              // Applied to the GLOW ONLY, not to the darkness. Flickering the
              // dark layer as well makes the whole page pulse, which is a very
              // different and much more distracting effect; the reference
              // flickers only the warm core, and it is right to.
              const hidden = hideForModal;
              const fScale = (!hidden && this.look.overlayFlicker)
                ? torchFlickerScale(performance.now(),
                    this.look.overlayFlickerAmount ?? 0.3)
                : 1;
              if (fScale !== 1 && this._torchGear === "idle") {
                // Same gear as the blink pulse. A flame is turbulence, not
                // motion: 30fps resolves it, and it must never claim hot.
                this._torchGear = "pulse";
              }

              // ---- The warm core -------------------------------------------
              // The darkness layer composites normally and can only subtract
              // light. Adding any requires a second, additive layer - this one.
              // Built only while Glow Strength is above 0, because a blended
              // layer costs a re-composite of everything beneath it whether or
              // not it paints anything.
              const baseI = this.look.overlayIntensity;
              const glow = this._ensureGlowLayer(!hidden && baseI > 0);
              // Every light, in the overlay's own coordinates. Both layers
              // are canvases (TORCH_CANVAS_SCALE) repainted only when a
              // light moved, the radius changed, or a setting did - the
              // painters dedupe on a key, so a parked light costs nothing.
              const local = spots.map((sp) => ({ x: sp.x - left, y: sp.y - top }));
              this._overlayBox = { top, left, width, height };
              this._torchRegions = notes;
              const regions = this._torchLocalRegions();
              this._torchPaintDarkness(local, rKey, this.look.overlayDarkness, width, height, regions);
              if (glow) {
                if (key !== this._lastGlowRect) {
                  this._lastGlowRect = key;
                  glow.style.top = top + "px";
                  glow.style.left = left + "px";
                  glow.style.width = width + "px";
                  glow.style.height = height + "px";
                }
                // Glow Strength and the flicker scale the whole layer's
                // opacity - a compositor-only change, so the flicker never
                // repaints the bitmap. Quantised to 2dp: the flicker's swing
                // at the default depth is 0.15, and 15 steps across it are
                // not visible, while 3dp wrote nearly every frame.
                const gAlpha = Math.max(0, Math.min(1, baseI * fScale)).toFixed(2);
                if (gAlpha !== this._lastGlowAlpha) {
                  this._lastGlowAlpha = gAlpha;
                  glow.style.setProperty("--torch-glow", gAlpha);
                }
                this._torchPaintGlow(local, rKey, hexToRgb(this.look.overlayColor), width, height, regions);
              }

              this.overlay.classList.toggle("cursor-smith-torch-hidden", !!hideForModal);
            }
          }
        }
      } catch (e) {
        this._reportOnce("torch tick (loop kept alive)", e);
      }
      schedule();
    };
    this._torchTick = tick;
    this._torchGear = "hot";
    this.torchRaf = window.requestAnimationFrame(tick);
  },

  // Sets this.tx/ty, the primary spotlight's target. Returns true when the
  // torch is following the mouse - in which case there is one light and
  // the secondaries get none (torchSpotlights).
  updateOverlayTarget(this: CursorSmithPlugin) {
    const mode = this.look.overlayFollowMode;
    // The torch lights the editor's window (ensureTorchOverlayForView). A
    // caret or a pointer in another window - the settings window's search
    // box, where the canvas follows the caret but the torch does not - is in
    // that window's coordinates and no target here: the light stays where
    // it was until the caret or the pointer is back.
    // Nor a caret or a pointer outside the lit box (the sidebar's search
    // field with "Keep sidebars lit" on): the light stays on the note.
    const here = this.overlay ? this.overlay.ownerDocument : null;
    const sameDoc = !here || !this.canvasWrapper || this.canvasWrapper.ownerDocument === here;
    // ...and, with the sidebars spared, outside the note tabs (a caret in
    // a lit view beside them: the History panel's search field).
    const box = this._overlayBox;
    const regions = this._torchRegions;
    const inBox = (b: { left: number; top: number; width: number; height: number }, x: number, y: number) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
    const inside = (x: number, y: number) => (!box || inBox(box, x, y)) && (!regions || regions.some((b) => inBox(b, x, y)));
    const measured = sameDoc ? this.caretCoords() : null;
    const caret = measured && inside(measured.x, (measured.top + measured.bottom) / 2) ? measured : null;
    const mouseHere = (!here || !this._mouseDoc || this._mouseDoc === here) && inside(this.mouseX, this.mouseY);
    if (caret) {
      if (!this.lastCaret || caret.x !== this.lastCaret.x || caret.top !== this.lastCaret.top) {
        this.lastCaretMove = performance.now();
      }
      this.lastCaret = caret;
    }

    const useMouse =
      mode === "mouse" ||
      (mode === "auto" && (performance.now() - this.lastMouseMove < 800 || !this.lastCaret));

    if (useMouse) {
      if (mouseHere) {
        this.tx = this.mouseX;
        this.ty = this.mouseY;
      }
    } else if (this.lastCaret) {
      this.tx = this.lastCaret.x;
      this.ty = (this.lastCaret.top + this.lastCaret.bottom) / 2;
    }
    return !!useMouse;
  },

  // Every spotlight this frame: the primary's (already eased to this.x/y by
  // the torch tick) and one per full-effect secondary, each chasing its own
  // caret at the same easing. Returns [{x, y}] in client coordinates, and
  // sets this._torchGear hot while any secondary is still en route. With
  // the torch on the mouse there is one light, so only the primary's.
  torchSpotlights(this: CursorSmithPlugin, useMouse: boolean, lerp: number): Pt[] {
    const spots = [{ x: this.x, y: this.y }];
    const states = this._secondaries;
    if (useMouse || !states || !states.length) return spots;
    for (const st of states) {
      const a = st.animActive;
      if (!a) { st.torchX = st.torchY = undefined; continue; }
      const tx = a.x;
      const ty = a.top + (a.h || 0) / 2;
      if (st.torchX === undefined || st.torchY === undefined) { st.torchX = tx; st.torchY = ty; }
      st.torchX += (tx - st.torchX) * lerp;
      st.torchY += (ty - st.torchY) * lerp;
      if (Math.abs(tx - st.torchX) < 0.25 && Math.abs(ty - st.torchY) < 0.25) {
        st.torchX = tx; st.torchY = ty;
      } else {
        this._torchGear = "hot";
      }
      spots.push({ x: st.torchX, y: st.torchY });
    }
    return spots;
  },

  // A side pane open OVER the note: on a phone the drawers, on desktop the
  // docks (only the phone reads it). The workspace's own flags say open -
  // WorkspaceMobileDrawer and WorkspaceSidedock both carry `collapsed` -
  // and the geometry says over: an open pane whose box overlaps the note
  // area (the root split). A tablet can PIN a sidebar, docked beside the
  // note, open for good; read as a drawer, it kept the torch hidden the
  // whole time (issue #34, an iPad: "Torch spotlight stopped working after
  // the update"). With no box to measure it counts as over, as it always did.
  _drawerOpen(this: CursorSmithPlugin): boolean {
    try {
      const ws = this.app.workspace;
      const rootEl = ws.rootSplit && (ws.rootSplit as unknown as { containerEl?: HTMLElement }).containerEl;
      const note = rootEl ? rootEl.getBoundingClientRect() : null;
      const over = (split: unknown) => {
        const s = split as { collapsed?: boolean; containerEl?: HTMLElement } | null;
        if (!s || s.collapsed) return false;
        if (!note || !s.containerEl) return true;
        const r = s.containerEl.getBoundingClientRect();
        return Math.min(r.right, note.right) - Math.max(r.left, note.left) > 8;
      };
      return over(ws.leftSplit) || over(ws.rightSplit);
    } catch { return false; /* a workspace mid-teardown */ }
  },

  // Torch-only wake: mouse movement retargets the spotlight but shouldn't
  // spin the cursor canvas up to full rate.
  _wakeTorch(this: CursorSmithPlugin) {
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
      if (this.torchEngineActive && this._torchTick) {
        this.torchRaf = window.requestAnimationFrame(this._torchTick);
      }
    }
  },
};
export type TorchMethods = typeof torchMethods;
