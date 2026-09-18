// Part of the plugin class, split out by responsibility (HANDOFF §1.17,
// ARCHITECTURE "Should this be split?"): the methods below are assigned
// onto CursorSmithPlugin.prototype and declared on the class, so every
// `this.x` read and every test reach them exactly as before. `this` is
// the plugin.
//
// The carets: the per-caret state bundle and its swap for secondaries
// (_withCaret), matching secondaries across frames, the form-field caret,
// the active point, the glide (updateSmoothCursor) and the commit of a
// move.

import {
  CARET_STATE_FIELDS,
  CATCHUP_BOOST_RATE,
  JUMP_TRAIL_MIN_DIST,
  SECONDARY_FULL_MAX,
  SECONDARY_MATCH_WINDOW,
} from "./constants";
import { HOT_ENGULF_MS } from "./fire";
import type { EditorView } from "@codemirror/view";
import type { CaretRecord, CaretState, CoordsLTB, KeyFlags, LineStyle, QuadKey } from "./types";
import type CursorSmithPlugin from "./plugin";

export const caretsMethods = {
  // =========================================================================
  // Multi-cursor: full effects on secondary carets
  // =========================================================================
  // Every non-primary caret up to SECONDARY_FULL_MAX gets the primary's whole
  // pipeline rather than a 2px line. Nothing in that pipeline was rewritten to
  // take a caret argument; it reads and writes the fields in CARET_STATE_FIELDS
  // on `this`, so each secondary keeps a bundle of those fields and _withCaret
  // swaps it in, runs the primary's own code, and saves the bundle back. The
  // cost of the swap is a few dozen property writes per caret per frame.
  //
  // What is per caret: position, smoothing, the smear spring, the trail,
  // the pending (Move Delay) state, a Signal Glitch burst, and the pop
  // effects a move spawns (letter pop, pixel trail, disintegration, jump
  // trail). What stays global: the blink clock (lastMoveTime - every caret
  // blinks with the primary), Speed Demon's heat, Thunderstrike, Fireworks,
  // Hot-head and Stardust, which follow the primary only.

  // Copy the caret fields out of `this` into `into` (a bundle), and back.
  // References, not clones: the bundle IS the state while it is swapped out.
  _saveCaretState(this: CursorSmithPlugin, into: Partial<CaretState>): Partial<CaretState> {
    const dst = into as unknown as Record<string, unknown>, src = this as unknown as Record<string, unknown>;
    for (const k of CARET_STATE_FIELDS) dst[k] = src[k];
    return into;
  },

  _loadCaretState(this: CursorSmithPlugin, from: Partial<CaretState>) {
    const dst = this as unknown as Record<string, unknown>, src = from as unknown as Record<string, unknown>;
    for (const k of CARET_STATE_FIELDS) dst[k] = src[k];
  },

  // A bundle in the state a fresh engine has. Taken from _resetEngineState
  // itself, on a scratch object, so the two cannot drift.
  _freshCaretState(this: CursorSmithPlugin): CaretState {
    const scratch = Object.create(Object.getPrototypeOf(this) as object) as CursorSmithPlugin;
    scratch._resetEngineState();
    const out = {} as CaretState;
    const dst = out as unknown as Record<string, unknown>, src = scratch as unknown as Record<string, unknown>;
    for (const k of CARET_STATE_FIELDS) dst[k] = src[k];
    return out;
  },

  // Run `fn` with `state` swapped into `this`, then save whatever fn did back
  // into `state` and restore the primary. Re-entrant only in the sense that
  // the primary's fields are always what is put back, whatever fn threw.
  //
  // The primary's fields are parked in a scratch bundle from a small pool
  // indexed by nesting depth, not a fresh object: with forty fields and a
  // handful of swaps per secondary per frame, allocating one each time was
  // measurable GC churn at ten carets.
  _withCaret<T>(this: CursorSmithPlugin, state: CaretState, fn: () => T): T {
    const depth = this._swapDepth | 0;
    const pool = this._swapPool || (this._swapPool = []);
    const saved = pool[depth] || (pool[depth] = {});
    this._saveCaretState(saved);
    const pass = this._caretPass;
    const owner = this._caretOwner;
    this._swapDepth = depth + 1;
    this._loadCaretState(state);
    this._caretPass = "secondary";
    this._caretOwner = state;
    try {
      return fn();
    } finally {
      this._saveCaretState(state);
      this._loadCaretState(saved);
      this._caretPass = pass;
      this._caretOwner = owner;
      this._swapDepth = depth;
    }
  },

  // The selection changed shape: a range was added or removed, or a different
  // one is main. Index-aligned bundles are then wrong, so every bundle - the
  // primary's included, since the range it was tracking may now be a
  // secondary and vice versa - is matched to the new ranges by document
  // position. An Alt+click that makes the new caret main is the common case:
  // the old primary's state follows its range down into the secondaries and
  // the new caret starts fresh, so nothing streaks across the page. Ranges
  // cannot cross without merging, so while the shape holds, index order does.
  rematchCaretStates(this: CursorSmithPlugin, view: EditorView | null | undefined) {
    const sel = view && view.hasFocus ? view.state.selection : null;
    const count = sel ? sel.ranges.length : 1;
    const mainIndex = sel ? sel.mainIndex : 0;
    const prev = this._selShape;
    this._selShape = { count, mainIndex };
    if (!prev || (prev.count === count && prev.mainIndex === mainIndex)) return;
    if (!sel) { this._secondaries = []; return; }

    // Candidates: the primary's live state, then every secondary bundle.
    const candidates: ({ state: CaretState; pos: number | null } | null)[] = [{ state: this._saveCaretState({}) as CaretState, pos: this.lastActive ? this.lastActive.pos as number : null }];
    for (const c of this._secondaries) candidates.push({ state: c, pos: c.lastActive ? c.lastActive.pos as number : null });
    const take = (head: number) => {
      let best = -1, bestD = SECONDARY_MATCH_WINDOW + 1, bestCand = null;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        if (!cand || cand.pos == null) continue;
        const d = Math.abs(cand.pos - head);
        if (d < bestD) { bestD = d; best = i; bestCand = cand; }
      }
      if (!bestCand) return null;
      candidates[best] = null;
      return bestCand.state;
    };
    const main = take(sel.ranges[mainIndex].head) || this._freshCaretState();
    this._loadCaretState(main);
    const next: CaretState[] = [];
    for (let i = 0; i < sel.ranges.length && next.length < SECONDARY_FULL_MAX; i++) {
      if (i === mainIndex) continue;
      next.push(take(sel.ranges[i].head) || this._freshCaretState());
    }
    this._secondaries = next;
  },

  // Per frame: measure every secondary, run the primary's update pipeline on
  // the first SECONDARY_FULL_MAX of them through their bundles, and leave the
  // rest in this.secondaryCarets for the plain line. `flags` holds the
  // Backspace/Enter/Space flags as they stood before the primary consumed
  // them, so each secondary's commitMove sees the same keystroke.
  updateSecondaryCarets(this: CursorSmithPlugin, view: EditorView | null | undefined, flags: KeyFlags = {}) {
    const raw = this.secondaryCaretCoords(view, this._secondaries);
    const full = raw.slice(0, SECONDARY_FULL_MAX);
    // The plain line only ever draws what is on screen.
    this.secondaryCarets = raw.slice(SECONDARY_FULL_MAX).filter((c) => c.visible);
    const states = this._secondaries;
    // One bundle per range, index-aligned (secondaryCaretCoords keeps an
    // entry for an off-screen range so the alignment holds). More carets
    // than bundles means the shape changed while rematchCaretStates could
    // not see it (no focus that frame): the extras start fresh.
    while (states.length < full.length) states.push(this._freshCaretState());
    if (states.length > full.length) states.length = full.length;
    if (full.length === 0 || !view) return;
    const lineStyles: Map<Element, LineStyle> = new Map();
    const primaryFlags = { del: this._deletePending, enter: this._enterPending, pop: this._popKeyPending };
    try {
      for (let i = 0; i < full.length; i++) {
        // Off the pane: updateActivePoint(null) clears the caret exactly as
        // the primary is cleared when cmCaretCoords declines to place it.
        const record = full[i].visible ? this.secondaryCaretRecord(view, full[i], states[i], lineStyles) : null;
        const c = full[i];
        this._withCaret(states[i], () => {
          this._deletePending = flags.del || 0;
          this._enterPending = flags.enter || 0;
          this._popKeyPending = flags.pop || 0;
          this.updateActivePoint(record);
          this.updateSmoothCursor();
          this.updateSmearQuad();
          this.pruneTrail();
          // The same per-frame effect calls the tick makes for the primary,
          // in the same order, each on this caret's own state.
          if (this.look.speedDemon && this.look.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) this.maybeSpawnHotHead();
          this.maybeSpawnStardust();
          // The tether, through this caret's own caches; merged by the tick.
          states[i]._tetherOut = this.look.bracketTether && c.visible
            ? this.bracketTetherCoords(view, c.pos, c.empty !== false)
            : null;
        });
      }
    } finally {
      this._deletePending = primaryFlags.del;
      this._enterPending = primaryFlags.enter;
      this._popKeyPending = primaryFlags.pop;
    }
  },

  // The static-frame signature term for the full-effect secondaries: each
  // one's settled position and shape, plus its smear quad - the same things
  // the primary contributes, for the same reasons (see the tick).
  _secondariesSig(this: CursorSmithPlugin) {
    const states = this._secondaries;
    if (!states || states.length === 0) return "";
    const parts = [];
    for (const st of states) {
      const la = st.lastActive;
      parts.push(la
        ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," + Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "")
        : "none");
      parts.push(this._withCaret(st, () => this._smearSig()));
    }
    return parts.join(";");
  },

  // Measures where the caret actually sits inside an <input>/<textarea> by
  // mirroring the field's text (up to selectionStart) into an offscreen
  // element with identical font/box metrics, then reading the position of a
  // marker placed at the caret. This is the standard technique for this
  // problem since native form fields expose no coordinate API for the caret.
  formFieldCaretCoords(this: CursorSmithPlugin, el: HTMLInputElement | HTMLTextAreaElement): CoordsLTB | null {
    try {
      const doc = el.ownerDocument;
      const win = doc.defaultView || window;
      const style = win.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isTextarea = el.tagName === "TEXTAREA";
      const value = el.value != null ? String(el.value) : "";
      let selStart = value.length;
      try {
        const s = el.selectionStart, e = el.selectionEnd;
        if (typeof s === "number" && typeof e === "number") {
          // The live caret sits at whichever end of the selection is the
          // "focus" - the end that moves while dragging. For a
          // backward-dragged selection that's selectionStart; otherwise
          // (forward, or no selection at all) it's selectionEnd.
          selStart = el.selectionDirection === "backward" ? s : e;
        }
      } catch {
        /* some input types (color, number, etc.) throw - just use the end */
      }

      let mirror = this._formMirror;
      if (!mirror || mirror.ownerDocument !== doc) {
        mirror?.remove();
        mirror = doc.body.createDiv({ attr: { "aria-hidden": "true" } });
        // Inline on purpose: this is a measuring element that has to be
        // invisible and out of flow in whatever document the field is in,
        // stylesheet or no stylesheet.
        mirror.setCssStyles({
          position: "absolute", visibility: "hidden", top: "0", left: "0",
          zIndex: "-1", pointerEvents: "none",
        });
        this._formMirror = mirror;
      }

      // Anything that moves a glyph horizontally has to be on this list. The
      // marker's offset is measured from the mirror's own left edge, so a
      // property the mirror does not know about lays the text out somewhere
      // the real field does not put it, and the caret lands there.
      //
      // textAlign was the one that got away. A right-aligned number field -
      // Word-Smith's goal target cells are exactly this - lays its text flush
      // against the far edge while the mirror, defaulting to left, measured
      // from the near one. On a 160px cell that is the full width of the box
      // in error: measured at 135px, with the caret drawn at the left of a
      // number sitting at the right. direction is here for the same reason,
      // one step further out.
      //
      // unicodeBidi is one step further out again, and it is the one that
      // matters in Obsidian specifically: app.css carries a bare
      // `input { unicode-bidi: plaintext }`, so EVERY field in the app - Quick
      // Switcher, Command Palette, Search, every settings box - takes its
      // direction from its own content rather than from `direction`. Type
      // Arabic and the real field flips to RTL and lays the text flush right,
      // while the mirror, still a plain LTR paragraph, laid it flush left and
      // put the marker at the run's far end. That is issue #28: a caret near
      // the left edge of the box, hundreds of pixels from the text, tracking
      // the text's WIDTH instead of its position.
      const props = [
        "height",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight",
        "fontFamily", "letterSpacing", "textIndent", "textTransform", "wordSpacing", "tabSize",
        "textAlign", "direction", "unicodeBidi",
      ];
      const dst = mirror.style as unknown as Record<string, string>, src = style as unknown as Record<string, string>;
    for (const p of props) dst[p] = src[p];

      // The four border widths above are inert without this. `border-style`
      // defaults to `none`, which computes every width back to 0px, so the
      // mirror's content box sat one border-width inside the field's and every
      // measurement came back short by exactly that. It reads as a ~1px noise
      // floor on a 1px border and scales with whatever the theme uses.
      mirror.setCssStyles({ borderStyle: "solid" });

      // boxSizing and width used to be copied straight across, and that only
      // works while the text is left-aligned. Under border-box the copied
      // width is the field's OUTER width, so the mirror lays out over a
      // content box wider than the real one by its padding and border - which
      // shifts nothing when measuring from the left edge and shifts everything
      // once the alignment measures from the right or the centre. It also made
      // a textarea wrap at the wrong column.
      //
      // clientWidth is content + padding and excludes both the border and any
      // scrollbar, so this is the true content width in every box-sizing mode.
      const padL = parseFloat(style.paddingLeft) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      mirror.setCssStyles({
        boxSizing: "content-box",
        width: Math.max(0, (el.clientWidth || 0) - padL - padR) + "px",
        whiteSpace: isTextarea ? "pre-wrap" : "pre",
        wordWrap: isTextarea ? "break-word" : "normal",
        overflow: "hidden",
      });
      if (!isTextarea) mirror.setCssStyles({ height: "auto" });

      // The text AFTER the caret has to be in the box too, and for two
      // separate reasons.
      //
      // Under `plaintext` the paragraph direction is the first STRONG
      // character of the content, so a prefix that has none - the caret at 0,
      // or a value that opens with digits - resolves LTR while the real field,
      // reading the whole value, resolves RTL. The mirror has to see the same
      // string to reach the same answer.
      //
      // And it was wrong without any bidi at all: in a right-aligned or
      // centred field the line is placed from the full text's width, so a
      // prefix on its own sits somewhere the real one does not. Prefix-only
      // put a mid-text caret in a right-aligned field at the far edge, 30px
      // out on a 260px box.
      mirror.textContent = "";
      mirror.appendChild(doc.createTextNode(value.substring(0, selStart)));
      const marker = mirror.createSpan();
      // Zero-width inline-block, not a zero-width SPACE. U+200B is bidi class
      // BN, which UAX#9 deletes outright and leaves the engine to place: next
      // to a digit run inside an RTL paragraph it lands with the digits rather
      // than at the caret, 17px out. An atomic inline is U+FFFC to the
      // algorithm - an ordinary neutral, resolved against the paragraph level.
      //
      // verticalAlign is not decoration. An EMPTY inline-block's baseline is
      // its own bottom margin edge, so left alone it hangs at the text
      // baseline - 16px below the line on a 22px line box. That is invisible
      // to an <input>, which takes its Y from the field's own box, and most of
      // a line of drop on every <textarea>, which takes its Y from offsetY.
      // Aligning to `top` pins it to the line box top, which is also where a
      // caret of `height = lineHeight` should start - the ZWSP sat half the
      // leading below it and overshot the bottom by the same.
      marker.setCssStyles({ display: "inline-block", width: "0", verticalAlign: "top" });
      mirror.appendChild(doc.createTextNode(value.substring(selStart)));

      const markerRect = marker.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();
      const offsetX = markerRect.left - mirrorRect.left;
      const offsetY = markerRect.top - mirrorRect.top;

      const scrollLeft = el.scrollLeft || 0;
      const scrollTop = el.scrollTop || 0;
      const fontSize = parseFloat(style.fontSize) || 14;
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2 || 16;

      const left = rect.left + offsetX - scrollLeft;

      let top, height;
      if (isTextarea) {
        top = rect.top + offsetY - scrollTop;
        height = lineHeight;
      } else {
        // Single-line <input> elements vertically center their text within
        // their own box using internal UA rendering, not plain CSS line-box
        // layout - a mirror <div> doesn't reproduce that centering exactly,
        // which is what made the cursor sit off-center vertically. Anchor to
        // the input's own box center instead of the mirror's Y offset.
        height = Math.min(lineHeight, rect.height) || fontSize * 1.2;
        top = rect.top + (rect.height - height) / 2;
      }

      // Clamp to the field's own box so a caret scrolled out of view (long
      // single-line input, caret past the visible edge) doesn't draw outside it.
      const clampedLeft = Math.min(Math.max(left, rect.left), rect.right);
      const clampedTop = Math.min(Math.max(top, rect.top), rect.bottom - 1);

      return { left: clampedLeft, top: clampedTop, bottom: clampedTop + height };
    } catch (e) {
      this._reportOnce("formFieldCaretCoords", e);
      return null;
    }
  },

  // With no argument this is the primary and measures itself. A secondary
  // hands its own record in, with its state bundle swapped into `this`
  // (see _withCaret), and everything below then runs for that caret.
  updateActivePoint(this: CursorSmithPlugin, caret: CaretRecord | null = this.caretCoords()) {
    if (!caret || !caret.focused) {
      this.lastActive = null;
      this.pending = null;
      return;
    }

    if (!this.lastActive) {
      this.lastActive = caret;
      this.pending = null;
      return;
    }

    const moved =
      Math.abs(this.lastActive.x - caret.x) > 0.5 || Math.abs(this.lastActive.top - caret.top) > 0.5;

    if (!moved) {
      if (!this.pending) this.lastActive = caret;
      return;
    }

    // Same doc position AND same assoc = the caret didn't logically move, so
    // any coordinate delta is a scroll/layout shift. If assoc differs, the
    // cursor hopped across a soft-wrap boundary (end of one visual row ->
    // start of the next) at the same position - that's a genuine move and
    // must go through the normal commit path (trails, smear, smoothing).
    if (caret.pos !== null && caret.pos === this.lastActive.pos && caret.assoc === this.lastActive.assoc) {
      const dx = caret.x - this.lastActive.x;
      const dy = caret.top - this.lastActive.top;
      
      this.lastActive = caret;
      
      // If the coordinate changed but the document position didn't, it was a scroll/layout shift.
      // We instantly shift the animation and spring physics to prevent the smear wiggle.
      if (this.animActive && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
        this.animActive.x += dx;
        this.animActive.top += dy;
        this.animActive.w = caret.w;
        this.animActive.h = caret.h;
        
        if (this.smearQuad) {
          for (const key of Object.keys(this.smearQuad) as QuadKey[]) {
            this.smearQuad[key].x += dx;
            this.smearQuad[key].y += dy;
          }
          // The corners are rebuilt from these two every frame: shift them
          // too, or the smear jumps back to its pre-scroll place next frame.
          if (this._smearLead) { this._smearLead.x += dx; this._smearLead.y += dy; }
          if (this._smearTrail) { this._smearTrail.x += dx; this._smearTrail.y += dy; }
          // The tapered copy is rebuilt from the quad every frame, but a draw
          // can land between this shift and the next rebuild - so shift it too,
          // or the smear jumps back to its pre-scroll place for one frame.
          // Only when it IS a copy: untapered it's the same object, already
          // shifted by the loop above.
          if (this.smearShape && this.smearShape !== this.smearQuad) {
            for (const key of Object.keys(this.smearShape) as QuadKey[]) {
              this.smearShape[key].x += dx;
              this.smearShape[key].y += dy;
            }
          }
          if (this.smearCenterPrev) {
            this.smearCenterPrev.x += dx;
            this.smearCenterPrev.y += dy;
          }
        }

        // Carry the trail along too. It's an echo of where the caret just
        // was in the text, so it belongs to the content and should scroll
        // with it; left in place it detaches from the cursor and hangs in
        // the old spot until it fades. (Particles and flame pixels are
        // deliberately NOT shifted - those are thrown into the air and read
        // correctly as staying put.)
        if (this.trail.length) {
          for (const p of this.trail) {
            p.x += dx;
            p.y += dy;
          }
        }
      }
      return;
    }

    const delay = Math.max(0, Math.round(this.look.moveDelayMs));
    if (delay <= 0) {
      const holdChar = this.resolveHoldChar(caret);
      this.commitMove(caret);
      if (holdChar && this.lastActive) this.lastActive.holdChar = holdChar;
      return;
    }

    const pending = this.pending;
    if (!pending || pending.caret.x !== caret.x || pending.caret.top !== caret.top) {
      this.pending = { caret, since: performance.now(), holdChar: this.resolveHoldChar(caret) };
    } else if (performance.now() - pending.since >= delay) {
      this.commitMove(pending.caret);
    }
  },

  updateSmoothCursor(this: CursorSmithPlugin) {
    if (!this.lastActive) {
      this.animActive = null;
      this._smoothMoving = false;
      this._smoothLastT = 0;
      this._catchUpBoost = 1;
      this._typingBoostSm = null;
      return;
    }

    if (!this.look.smoothEnabled) {
      // Pinned straight to the target every frame: never "in motion" as far
      // as the frame governor is concerned.
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
      this._catchUpBoost = 1;
      this._typingBoostSm = null;
      return;
    }

    if (!this.animActive) {
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
    }

    const now = performance.now();

    // Frame delta in seconds, clamped so a background-tab hiccup doesn't
    // teleport the cursor. This is the core fix for "smooth does nothing":
    // the old code applied a fixed per-FRAME lerp of
    // targetSpeed * (1 - smoothness), i.e. ~0.47 per frame at defaults -
    // the cursor closed >90% of the gap within 3 frames (~50 ms at 60 Hz,
    // ~25 ms at 120 Hz), which is visually indistinguishable from off.
    let dt = (now - (this._smoothLastT || now)) / 1000;
    this._smoothLastT = now;
    dt = Math.max(0.001, Math.min(dt, 0.05));

    let targetSpeed = this.look.catchUpSpeed;
    let typingBoost = 1;

    if (this.look.smoothAdaptive) {
      const timeSinceMove = now - this.lastMoveTime;
      const maxMod = this.look.maxCatchUpSpeed / Math.max(0.01, this.look.catchUpSpeed);
      if (timeSinceMove < 150) {
        // Reach the cap after ~0.12 s of sustained input. Slower ramps feel
        // nice for a single keypress but let the cursor fall several glyphs
        // behind on key repeat before the speed-up ever kicks in.
        this.typingSpeedMod = Math.min(this.typingSpeedMod + (maxMod - 1) * 8 * dt, maxMod);
      } else {
        this.typingSpeedMod = Math.max(this.typingSpeedMod - (maxMod - 1) * 2 * dt, 1);
      }
      targetSpeed = Math.min(this.look.maxCatchUpSpeed, targetSpeed * this.typingSpeedMod);

      // Backlog drain: during sustained input (key repeat, held arrows), if
      // the animated cursor has fallen more than ~one glyph behind the real
      // one, scale the rate up with the deficit so the lag stays around a
      // character instead of accumulating. Gated on timeSinceMove so a
      // single long jump (mouse click across the note) still animates at
      // the user's configured speed.
      if (timeSinceMove < 150) {
        const cw = Math.max(4, this.lastActive.actualCharWidth || 8);
        const dist = Math.hypot(
          this.lastActive.x - this.animActive.x,
          this.lastActive.top - this.animActive.top
        );
        const backlogChars = Math.max(0, dist / cw - 1);
        typingBoost = 1 + Math.min(3, backlogChars);
      }
    }

    // Low-pass the boost before anything uses it.
    //
    // The backlog drain is measured from the INSTANTANEOUS gap between the
    // real caret and the animated one, and that gap is inherently spiky: it
    // jumps on the frame a key lands and shrinks on the frames between. Under
    // steady typing it settles into a sawtooth - measured, alternating
    // between 1.55 and 2.04 every frame, locked to the keystroke cadence.
    //
    // That was fine as long as it only nudged a lerp, but this value is also
    // published to Motion Smear, which uses it as a multiplier on its SPRING
    // STIFFNESS. A spring whose constant flickers by 25% every frame does not
    // settle smoothly; it pulses, and the pulse is exactly the stutter people
    // see when Smooth Movement and Motion Smear are both on. With either one
    // off the sawtooth is either never computed or never consumed, which is
    // why it only shows up together.
    //
    // Smoothed on a time constant rather than a fixed per-frame fraction, so
    // the damping is the same at 60, 120 and 144Hz.
    const boostK = 1 - Math.exp(-CATCHUP_BOOST_RATE * dt);
    this._typingBoostSm = this._typingBoostSm == null
      ? typingBoost
      : this._typingBoostSm + (typingBoost - this._typingBoostSm) * boostK;
    typingBoost = this._typingBoostSm;

    // Exponential approach with a time constant, so the feel is identical at
    // 60/120/144 Hz. RATE_SCALE maps the existing setting ranges
    // (catchUpSpeed 0.30-0.80, smoothness 0.05-0.30) onto visible settle
    // times of roughly 100-360 ms to 95% of the way there for single moves;
    // the adaptive typingBoost can multiply that by up to 4x under sustained
    // typing so the cursor keeps pace with key repeat.
    const RATE_SCALE = 40;
    const rate = Math.max(0.5, targetSpeed * (1 - this.look.smoothness) * RATE_SCALE * typingBoost);
    // How much faster than the configured Catch-Up Speed this frame is actually
    // running - the adaptive ramp and the backlog drain combined. Published
    // because Motion Smear's spring sits downstream of this lerp and has to be
    // told to speed up with it; see the note in updateSmearQuad.
    this._catchUpBoost = (targetSpeed / Math.max(0.01, this.look.catchUpSpeed)) * typingBoost;
    const lerpFactor = 1 - Math.exp(-rate * dt);

    this.animActive.x += (this.lastActive.x - this.animActive.x) * lerpFactor;
    this.animActive.top += (this.lastActive.top - this.animActive.top) * lerpFactor;
    this.animActive.w += (this.lastActive.w - this.animActive.w) * lerpFactor;
    this.animActive.h += (this.lastActive.h - this.animActive.h) * lerpFactor;

    // Snap when essentially arrived - avoids an endless sub-pixel tail that
    // keeps the canvas repainting and makes the blink-hold logic think the
    // cursor is still moving.
    //
    // The result is published as _smoothMoving, which is what the frame
    // governor reads. It must NOT test `!!this.animActive` instead: animActive
    // is the interpolated cursor snapshot, not an in-flight flag, and it is
    // non-null for as long as a caret exists at all. Testing its truthiness
    // pinned `animating` (and therefore the hot gear) on permanently, which
    // made the warm/idle gears and the whole draw-skip path below unreachable.
    // Size counts as arrival too, not just position.
    //
    // This tested x/top only and then SNAPPED w and h to the target. Normally
    // harmless, because all four lerp at the same rate and land together. But
    // when position barely changes while size does - the line under the caret
    // becoming a heading, an embed resizing the row - x and top arrive on the
    // first frame, `arrived` fires, and the height is snapped the whole way
    // in one go. Measured, a 24 -> 60 change popped 36px in a single frame,
    // with _smoothMoving already false so the frame governor never even
    // counted it as motion.
    const arrived =
      Math.abs(this.lastActive.x - this.animActive.x) < 0.25 &&
      Math.abs(this.lastActive.top - this.animActive.top) < 0.25 &&
      Math.abs(this.lastActive.w - this.animActive.w) < 0.25 &&
      Math.abs(this.lastActive.h - this.animActive.h) < 0.25;
    if (arrived) {
      this.animActive.x = this.lastActive.x;
      this.animActive.top = this.lastActive.top;
      this.animActive.w = this.lastActive.w;
      this.animActive.h = this.lastActive.h;
    }
    this._smoothMoving = !arrived;
    
    this.animActive.textColor = this.lastActive.textColor;
    this.animActive.char = this.lastActive.char;
    this.animActive.holdChar = this.lastActive.holdChar;
    this.animActive.actualCharWidth = this.lastActive.actualCharWidth;
    this.animActive.fontFamily = this.lastActive.fontFamily;
    this.animActive.fontSize = this.lastActive.fontSize;
    // Weight/style/letter-spacing must refresh here alongside the other look
    // fields: animActive is created once (by spread) and then reused across a
    // whole smooth glide, so without this a box gliding from regular text onto
    // a bold heading would keep drawing the glyph in the OLD weight until the
    // glide ended - the same slimmer/fatter mismatch we just fixed, only
    // intermittent and motion-triggered.
    this.animActive.fontWeight = this.lastActive.fontWeight;
    this.animActive.fontStyle = this.lastActive.fontStyle;
    this.animActive.letterSpacing = this.lastActive.letterSpacing;
    // Same reasoning again, and the reason Hot-head's fire vanished on some
    // lines: animActive is spread once and reused for the whole glide, so the
    // row extent stayed frozen at whatever line the caret happened to be on
    // when animActive was first built. Hot-head clamps fire to that extent, so
    // on any line whose text didn't overlap the stale one, every particle was
    // dropped and no fire appeared at all.
    this.animActive.rowLeft = this.lastActive.rowLeft;
    this.animActive.rowRight = this.lastActive.rowRight;
  },

  commitMove(this: CursorSmithPlugin, caret: CaretRecord) {
    // A secondary caret (see _withCaret) gets everything here - trail,
    // disintegration, jump trail, glitch, strike and volley; the tick hands
    // it the frame's Enter/Space/Backspace flags before the primary's own
    // commit zeroes them - except heat, which is one gauge for the whole
    // editor and is fed by the primary's moves alone, and except CLEARING
    // those flags, which is the primary's job.
    const secondary = this._caretPass === "secondary";
    // Speed Demon: a caret move that no heat-bumping keystroke accounts for -
    // a mouse click, a Vim motion from another plugin, a jump to a search hit -
    // still represents the user going somewhere, so it heats too. Scaled by how
    // far the caret actually travelled and capped, so a click two characters
    // over is a nudge and a leap across the file is a real bump, but neither
    // can slam the cursor to white-hot in one go. Keyboard-driven moves are
    // skipped here because onKeyDown already charged them.
    if (this.look.speedDemon && this.lastActive && caret && !secondary) {
      const keyed = this._heatKeyT && performance.now() - this._heatKeyT < 150;
      if (!keyed) {
        const dist = Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top);
        const bump = Math.min(0.12, dist / 900) * (this.look.speedDemonSensitivity ?? 1);
        this.heat = Math.min(1, this.heat + bump);
      }
    }
    // Record the position being left, and - if this move is a jump - the ghosts
    // bridging it to the destination, so the CRT/neon trail is continuous across
    // the leap the same commit it happens rather than one move later.
    this.pushTrail(this.lastActive, caret);
    if (this.lastActive) {
      // Consume a pending Backspace/Delete keystroke if it happened
      // recently enough to plausibly be the cause of this caret move.
      // 250ms covers slow input pipelines but not so long that unrelated
      // caret motion (mouse click, arrow keys) inherits the deletion look.
      const now = performance.now();
      // Both gates, like every other pop effect: the group, then the option.
      // Pixel Trail is deliberately absent - a deletion burst no longer needs
      // the ambient trail to be switched on.
      const disintegrate = !!(
        this.look.popEffects &&
        this.look.backspaceDisintegrate &&
        this._deletePending &&
        now - this._deletePending < 250);
      this.spawnFlamePixels(this.lastActive, disintegrate);
      // Trail On Jump: if this move was a genuine leap (not typing/arrowing) and
      // wasn't a deletion burst, lay puffs along the path the caret skipped so a
      // jump leaves a streak rather than a lone puff at the origin. Uses `caret`
      // (destination) and `lastActive` (origin) to span the gap.
      if (this.look.flameTrailOnJump && !disintegrate) {
        this.spawnJumpTrail(this.lastActive, caret);
      }
      this._deletePending = 0;
      // Signal Glitch fires on the same "is this a jump?" test the trail uses,
      // so the two features agree on what counts as a leap. Deliberately NOT
      // gated on `disintegrate`: a Backspace that happens to jump the caret
      // across a wrap is still a jump visually. Placed before the thunderbolt
      // so an Enter-driven strike and a glitch can coexist on the same move.
      if (this.look.crtEffect && this.look.crtGlitch) {
        this.spawnGlitch(this.lastActive, caret);
      }
      // Hot-Head, same test again: a jump puts the caret in fire for a moment
      // (the "engulfed" state maybeSpawnHotHead feeds). Decided here, on the
      // committed move, rather than from the drawn caret's travel: with
      // Smooth Movement the drawn caret eases across a jump and never covers
      // JUMP_TRAIL_MIN_DIST in one frame, and a scroll shift - which does -
      // has already been filtered out above this block.
      if (this.styleFor("hotHead")
          && Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top) >= JUMP_TRAIL_MIN_DIST) {
        this._hotEngulfUntil = now + HOT_ENGULF_MS;
        this._hotActiveT = now;
      }
      // Same 250ms window as the delete flag. Note the bolt is aimed at
      // `caret`, the position being moved TO, not at lastActive: the strike
      // drives the cursor down to the new line, so it has to land there.
      if (this._enterPending && now - this._enterPending < 250) {
        this.spawnThunderbolt(caret);
      }
      // Same 250ms window and the same choice of anchor: the shells climb out
      // of the caret you can see, which after a Space or an Enter is the
      // position being moved TO.
      if (this._popKeyPending && now - this._popKeyPending < 250) {
        this.spawnFireworks(caret);
      }
    }
    // Cleared unconditionally, outside the lastActive branch: a stale flag left
    // by a move that didn't spawn anything would fire a bolt on whatever caret
    // move happened to come next. The primary's job; a secondary never fires
    // them, so it must not clear them either.
    if (!secondary) {
      this._enterPending = 0;
      this._popKeyPending = 0;
    }
    this.lastActive = caret;
    this.pending = null;
    this.lastMoveTime = performance.now(); 
  },
};
export type CaretsMethods = typeof caretsMethods;
