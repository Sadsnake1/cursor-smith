// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Hot-head: the text on fire. The inertia and burn-mark tracker, the
// feeding window, the spawn (fire along the caret's column, the spread,
// the trail it leaves), the fire's colors, and the draw.

import { hexToRgbTuple, hsvToRgb, lerpHsv, rgbToHsv, rgbTupleToHex } from "./color";
import {
  FLAME_BUOYANCY,
  FLAME_DAMPING,
  FLAME_INITIAL_VELOCITY,
  FLAME_LEVELS,
  FLAME_LIFETIME_EXP,
  FLAME_MAX_LIFETIME,
  FLAME_MAX_NUM,
  FLAME_PER_LENGTH,
  FLAME_PER_SECOND,
  FLAME_RANDOM_VELOCITY,
  FLAME_SPREAD,
  HOT_ALPHA_LEVELS,
  HOT_BLOCK_SHAPES,
  HOT_BUDGET_CARETS,
  HOT_BURN_LINGER_MS,
  HOT_BURN_MAX,
  HOT_COLOR_LEVELS,
  HOT_ENGULF_PAD_X,
  HOT_ENGULF_RATE,
  HOT_FINE_CHANCE,
  HOT_FINE_SCALE,
  HOT_FLAT_HUE_SPAN,
  HOT_FLAT_LIGHTEN,
  HOT_HEAD_JITTER_DOWN,
  HOT_HEAD_JITTER_UP,
  HOT_HEAD_LIFT,
  HOT_LIFE_FLOOR,
  HOT_SHAPE_EASE,
  HOT_HSV,
  HOT_PX_DIVISOR,
  HOT_PX_MAX,
  HOT_PX_MIN,
  HOT_SPARKS_PER_CHUNK,
  HOT_SPARK_LIFT,
  HOT_SPARK_MAX,
  HOT_SPARK_RISE,
  HOT_SPECK_SCALE,
  HOT_STAGE_PIXEL,
  HOT_START_CONE,
  HOT_STOP_POS,
  HOT_SWAY_CW,
  HOT_SWAY_GROW_MS,
  HOT_SWAY_HZ,
  HOT_TEMP_GAMMA,
  HOT_TEMP_MAX,
  HOT_TRAIL_EMIT_MAX,
  HOT_TRAIL_FADE_POW,
  HOT_TRAIL_PATH_AGE,
  HOT_TRAIL_PATH_MAX,
  HOT_TRAIL_STEP_CW,
  HOT_TURB_X,
  HOT_TURB_Y,
  hotQuant,
  hotShapeStage,
} from "./fire";
import { easeInOutSine } from "./motion";
import type CursorSmithPlugin from "./plugin";
import type { Ember } from "./types";

// A start kick of `mag`, up within HOT_START_CONE of straight up, and a sway
// of its own (see drawHotHead). Nothing of the caret's velocity: fire rises
// where it was lit instead of being thrown along a move.
function hotKick(mag: number): Pick<Ember, "vx" | "vy" | "age" | "sw" | "sf" | "sp" | "so"> {
  const ang = -Math.PI / 2 + (Math.random() * 2 - 1) * HOT_START_CONE;
  return {
    vx: mag * Math.cos(ang), vy: mag * Math.sin(ang),
    age: 0, sw: HOT_SWAY_CW * (0.6 + 0.4 * Math.random()), sf: HOT_SWAY_HZ * (0.75 + 0.5 * Math.random()),
    sp: Math.random() * Math.PI * 2, so: 0,
  };
}

export const effectsFireMethods = {
  // Everything Hot-head holds - live particles, burn marks, the caret samples
  // it measures travel against - is stored in viewport coordinates, because
  // that's what the canvas draws in. Scrolling moves the text under those
  // coordinates without changing them, which broke the effect in two ways at
  // once: fire that was sitting on a word stayed pinned to the screen while the
  // word slid away from under it, and the caret's viewport position changed
  // without the caret having actually gone anywhere, so the emitter read the
  // scroll as travel and laid a streak of fire across the screen.
  //
  // Shifting everything by the scroll delta fixes both: the fire is attached to
  // the text, so it scrolls with the text, and the caret's apparent movement
  // cancels out to roughly zero, so no spurious trail.
  hotSyncScroll(this: CursorSmithPlugin) {
    // Nothing to keep in sync when the effect is off, and dropping the baseline
    // means re-enabling it takes a fresh one rather than applying however far
    // the document was scrolled in the meantime as one enormous delta.
    if (!this.styleFor("hotHead")) {
      this._hotScroll = null;
      return;
    }
    // The scroller the fire has to follow: the note editor's while the
    // caret is in it, otherwise the focused field's own nearest scrolling
    // ancestor (the settings pane, a modal body) - the clip chain
    // getCaretClipRect resolved for the same field, nearest first. Without
    // this the burn marks stayed at their screen positions while a settings
    // box scrolled away under them.
    const view = this.app.workspace.activeEditor?.editor?.cm;
    let el: Element | null = null;
    const chain = this._clipChainFor && this._clipChain;
    if (chain && chain.length && !(view && view.hasFocus)) {
      for (const c of chain) { if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) { el = c; break; } }
    }
    if (!el) el = (view && view.scrollDOM) || null;
    if (!el) {
      this._hotScroll = null;
      return;
    }
    const prev = this._hotScroll;
    // The primary's pass reads the scroll delta and shifts the shared ember
    // pool; it also records the delta for this tick, because a secondary's
    // pass (its bundle swapped in, see _withCaret) runs later in the same
    // frame and must shift ITS burn marks and inertia by the same amount -
    // by then the delta against `prev` is zero.
    let ox, oy;
    if (this._caretPass === "secondary") {
      const sh = this._hotShift;
      if (!sh || sh.tick !== this._tickNo) return;
      // Once per caret per tick, whatever calls hotSyncScroll on it.
      if (this._hotShiftTick === sh.tick) return;
      this._hotShiftTick = sh.tick;
      if (!sh.ox && !sh.oy) return;
      ox = sh.ox; oy = sh.oy;
    } else {
      // scrollTop is a layout read, and on a tick whose keystroke has left
      // the editor's DOM unlaid-out it flushes layout: 0.12 ms of every hot
      // tick while typing with Hot-head on, measured. A scroll always bumps
      // the layout generation (its event is dispatched before the next
      // frame's animation callbacks), so the offsets are read only on a tick
      // after one has - and on first sight of a scroller.
      const gen = this._layoutGen | 0;
      if (prev && prev.el === el && prev.gen === gen) return;
      const sx = el.scrollLeft || 0;
      const sy = el.scrollTop || 0;
      // First sight of this scroller (or a switch to a different pane): take
      // a baseline and shift nothing, or the delta against some other
      // editor's scroll position would fling everything off screen.
      if (!prev || prev.el !== el) {
        this._hotScroll = { el, x: sx, y: sy, gen };
        return;
      }
      prev.gen = gen;
      const dx = sx - prev.x;
      const dy = sy - prev.y;
      prev.x = sx;
      prev.y = sy;
      this._hotShift = { ox: -dx, oy: -dy, tick: this._tickNo };
      if (!dx && !dy) return;
      ox = -dx;
      oy = -dy;
      for (const p of this.flameEmbers) { p.x += ox; p.y += oy; }
    }
    const nEmbers = this.flameEmbers.length;
    const nBurns = this.hotBurns ? this.hotBurns.length : 0;
    if (!nEmbers && !nBurns && !this._hotPrev && !this._hotEmitFrom) return;

    for (const b of this.hotBurns) {
      b.x += ox;
      b.y += oy;
      // The row extents are viewport x too, so they have to travel with it -
      // otherwise a horizontal scroll leaves the fire clamped to where the
      // text used to be.
      if (b.rowLeft != null) b.rowLeft += ox;
      if (b.rowRight != null) b.rowRight += ox;
    }
    if (this._hotPrev) { this._hotPrev.x += ox; this._hotPrev.y += oy; }
    if (this._hotEmitFrom) { this._hotEmitFrom.x += ox; this._hotEmitFrom.y += oy; }
    // Every particle moved at once, so last frame's dirty rect doesn't cover
    // where they used to be. Without a full clear this smears. Only when there
    // were actually particles on screen, so a plain scroll with the fire out
    // doesn't cost everyone a full-canvas clear per frame.
    if (nEmbers) this._dirtyFull = true;
  },

  // Hot-head: track the caret between frames, and remember where it has been.
  //
  // The burn marks: each is a patch of text the caret has occupied, with an
  // intensity that decays over time. (The caret's smoothed velocity was
  // tracked here too, for the share of it new particles inherited; nothing
  // inherits it since 1.6.4 - the fire rises where it was lit.) Fire is emitted from ALL live
  // marks, not just the caret, so text the caret has moved off keeps burning
  // for a moment afterwards - the point being that the text was set alight,
  // rather than that a flame is following the cursor around.
  updateHotHeadInertia(this: CursorSmithPlugin) {
    this.hotSyncScroll();
    const now = performance.now();
    const active = this.animActive;
    if (!active) {
      this._hotPrev = null;
      this._hotEmitFrom = null;
      this.hotBurns = [];
      return;
    }
    const cx = active.x + (active.w || 0) / 2;
    const cy = active.top + (active.h || 0) / 2;

    if (!this._hotPrev) {
      this._hotPrev = { x: cx, y: cy, t: now };
      this._hotEmitFrom = { x: cx, y: cy };
      this.hotBurns = [];
      return;
    }

    // Genuine caret movement, which is what the idle timer runs on. Measured
    // here rather than from the plugin's global activity timestamp because that
    // one is also poked by scrolling and focus changes, and neither of those
    // should count as working on the text. The threshold ignores the last
    // sub-pixel crawl of a smooth-motion glide settling onto its target.
    if (Math.abs(cx - this._hotPrev.x) > 0.5 || Math.abs(cy - this._hotPrev.y) > 0.5) {
      this._hotActiveT = now;
    }
    const prevX = this._hotPrev.x, prevY = this._hotPrev.y;
    this._hotPrev.x = cx;
    this._hotPrev.y = cy;
    this._hotPrev.t = now;
    if (!this._hotEmitFrom) this._hotEmitFrom = { x: cx, y: cy };

    if (!this.hotBurns) this.hotBurns = [];
    // Refresh the mark under the caret, or lay a new one. Marks within half a
    // character of each other are merged, so sitting still keeps one mark
    // topped up rather than stacking a new one every frame - which would fill
    // the whole buffer with duplicates in half a second and evict the trail
    // behind the caret that is the entire point of keeping these.
    //
    // Both sides of the comparison are the line TOP. Comparing against the
    // caret's centre instead means the test is off by half a line height and
    // can never match.
    const cwHere = Math.max(4, active.actualCharWidth || active.w || 8);
    // The row the mark goes on: the committed caret's. With Smooth Movement
    // the drawn caret glides between two rows through every height between
    // them, and a mark laid there burned across the middle of a line - the
    // trail "from the middle of the cursor".
    const la = this.lastActive;
    const markY = la && Math.abs(la.top - active.top) > 0.5 ? la.top : active.top;
    const prevRow = this._hotPrev.row ?? (prevY - (active.h || 0) / 2);
    this._hotPrev.row = markY;
    const last = this.hotBurns[this.hotBurns.length - 1];
    if (last && Math.abs(last.x - cx) < cwHere * 0.5 && Math.abs(last.y - markY) < 2) {
      last.t = now;
      // Refresh the row extent too: the text either side of a stationary caret
      // changes as you type, and a mark holding the extent from when it was
      // laid would keep burning over characters that have since moved.
      last.rowLeft = active.rowLeft;
      last.rowRight = active.rowRight;
    } else {
      // The PATH burns. Marks used to be laid only where the caret IS each
      // frame, so a jump - or a fast glide - lit its two ends and left the
      // way between them dark; the recording's trail is the way itself on
      // fire, fading from the far end. So the stretch of the row from where
      // the caret was last frame to where it is now gets a mark every
      // HOT_TRAIL_STEP_CW characters, the nearest HOT_TRAIL_PATH_MAX of them
      // when it is longer than that, laid far end first and already a little
      // aged (HOT_TRAIL_PATH_AGE of the linger, more the farther back) so the
      // tail goes out before the head. Along a row only: a move to another
      // row lays its mark there and nothing between - the fire stays on the
      // tops of the text, never across the lines between (it did until 1.6.4).
      const dxp = cx - prevX;
      const dist = Math.abs(dxp);
      const step = cwHere * HOT_TRAIL_STEP_CW;
      const n = Math.abs(markY - prevRow) < 2 ? Math.min(HOT_TRAIL_PATH_MAX, Math.floor(dist / step)) : 0;
      if (n >= 1) {
        const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
        const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
        for (let i = n; i >= 1; i--) {
          const s = (i * step) / dist;
          this.hotBurns.push({
            x: cx - dxp * s, y: markY,
            t: now - s * HOT_TRAIL_PATH_AGE * linger,
            rowLeft: active.rowLeft, rowRight: active.rowRight,
            lh: active.h || 16, fs: active.fontSize || 0,
          });
        }
      }
      // Each mark remembers the row it was laid on, so a mark left behind on a
      // previous line keeps being clamped to THAT line's text rather than to
      // wherever the caret has since gone.
      this.hotBurns.push({
        x: cx, y: markY, t: now,
        rowLeft: active.rowLeft, rowRight: active.rowRight, lh: active.h || 16,
        // Needed to place the fire relative to the GLYPHS rather than to the
        // line box - see topY in maybeSpawnHotHead. Stored per mark because a
        // mark left on a previous line has to keep that line's metrics, not
        // whatever the caret has since moved onto.
        fs: active.fontSize || 0,
      });
      while (this.hotBurns.length > HOT_BURN_MAX) this.hotBurns.shift();
    }
  },

  // Whether the fire is currently being fed, i.e. the caret has moved recently
  // enough to count as working. Shared by the emitter and the frame governor:
  // the governor has to agree, or a fire that has burnt out would still pin the
  // render loop at full rate forever on the grounds that the effect is enabled.
  hotHeadFeeding(this: CursorSmithPlugin, nowT: number): boolean {
    return this._hotFeedingAt(this._hotActiveT, nowT);
  },

  // The same test for a caret whose state is not swapped in (a secondary's
  // bundle, read from _isAnimating without a swap).
  _hotFeedingAt(this: CursorSmithPlugin, activeT: number, nowT: number): boolean {
    const idleMs = Math.max(0, this.styleFor("hotHeadIdleMs") ?? 0);
    if (idleMs <= 0) return true;
    return (nowT - (activeT || 0)) <= idleMs;
  },

  // Emit fire from every patch of text that is currently alight.
  //
  // Particles are points with no size of their own - see drawHotHead, where how
  // big they look is decided by their age.
  maybeSpawnHotHead(this: CursorSmithPlugin) {
    const active = this.animActive;
    const from = this._hotEmitFrom;
    if (!active || !from) return;
    const now = performance.now();

    const cw = Math.max(4, active.actualCharWidth || active.w || 8);
    const lh = Math.max(8, active.h || 16);

    const cx = active.x + (active.w || 0) / 2;
    const cy = active.top + lh / 2;
    let dx = cx - from.x;
    let dy = cy - from.y;

    // Clamp the segment: a jump to the far side of the document shouldn't paint
    // a ribbon of fire across the whole screen, just light the arrival.
    const segLen = Math.hypot(dx, dy);
    const maxSeg = cw * 12;
    if (segLen > maxSeg) {
      const k = maxSeg / segLen;
      dx *= k;
      dy *= k;
    }

    // Advance the anchors BEFORE any early return. Leaving them stale while the
    // emitter is capped or idle means the next segment spans everything the
    // caret did in the meantime, and the fire gets flung along it.
    from.x = cx;
    from.y = cy;
    const dt = Math.max(0, Math.min(0.1, (now - (this._lastHotT || now)) / 1000));
    this._lastHotT = now;

    const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
    const fadeMs = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);
    const heightMul = Math.max(0.05, this.styleFor("hotHeadHeight") ?? 0.55);
    const perLength = FLAME_PER_LENGTH * ((this.styleFor("hotHeadTrail") ?? 0) / 10);
    const qtyEarly = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);

    // A jump (set on the committed move, see the commit path in
    // updateActivePoint) flares the fire for HOT_ENGULF_MS where the caret
    // lands: on the tops of the glyphs like the rest, across its cell and a
    // little either side, rising.
    if (qtyEarly > 0 && this._hotEngulfUntil && now < this._hotEngulfUntil) {
      const land = this.lastActive || active;
      const shapeN = HOT_BLOCK_SHAPES.length;
      const n = HOT_ENGULF_RATE * dt * qtyEarly;
      const count = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
      const w = Math.max(cw, land.w || 0);
      const x0 = land.x - cw * HOT_ENGULF_PAD_X, x1 = land.x + w + cw * HOT_ENGULF_PAD_X;
      const lfs = land.fontSize || lh * 0.62;
      const baseY = land.top + Math.max(0, (land.h || lh) - lfs) / 2 - lfs * HOT_HEAD_LIFT;
      for (let i = 0; i < count; i++) {
        const spark = Math.random() < 0.5;
        const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul * 0.8;
        const life0 = fadeMs * (spark ? 0.15 + 0.45 * Math.random() : 0.3 + 0.5 * Math.pow(Math.random(), 2));
        const kick = hotKick(mag);
        this.flameEmbers.push({
          spark, fine: spark && Math.random() < HOT_FINE_CHANCE,
          x: x0 + Math.random() * (x1 - x0),
          y: baseY + (HOT_HEAD_JITTER_DOWN - Math.random() * (HOT_HEAD_JITTER_UP + HOT_HEAD_JITTER_DOWN)) * lh,
          ...kick,
          vy: kick.vy - (spark ? HOT_SPARK_RISE * 0.6 : 1) * cw * heightMul,
          shape0: Math.min(shapeN - 1, 5 + Math.floor(Math.random() * (shapeN - 6))),
          flip: Math.random() < 0.5,
          life: life0, life0,
          maxLife: fadeMs,
          temp: 0.6 + Math.random() * 0.4,
          cw,
          lift: heightMul * (spark ? HOT_SPARK_LIFT : 1),
        });
      }
    }

    const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
    const halfSpan = spreadCw * cw * 0.5;

    // Drop burn marks that have gone out. Done BEFORE the early returns below:
    // skipping the prune whenever the emitter happens to be capped or switched
    // down leaves the list pinned at its cap holding marks that went out long
    // ago, and the moment emission resumes they all light up again at once.
    const burns = (this.hotBurns || []).filter((b) => now - b.t < linger);
    this.hotBurns = burns;
    if (!burns.length) return;

    // Idle Timeout: stop feeding the fire once the caret has been still for
    // this long. Emission simply stops - the particles already in the air run
    // out their lifetimes, so the fire burns down and goes out rather than
    // being switched off - and the next real movement starts it again.
    if (!this.hotHeadFeeding(now)) return;

    // Chunks and sparks have separate budgets; only the chunks count here.
    // Per caret (HOT_BUDGET_CARETS): the pool is shared.
    const carets = 1 + Math.min(HOT_BUDGET_CARETS - 1, (this._secondaries && this._secondaries.length) || 0);
    const chunkCap = FLAME_MAX_NUM * carets;
    this._hotSparkCap = HOT_SPARK_MAX * carets;
    let live = 0, sparks = 0;
    for (const p of this.flameEmbers) { if (p.spark) sparks++; else live++; }
    this._hotSparks = sparks;
    if (live >= chunkCap) return;
    const qty = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);
    if (qty <= 0) return;

    // Total emission is shared across the live marks by their remaining
    // intensity, so a long trail of dying marks doesn't emit more fire in total
    // than a single fresh one - it spreads the same fire more thinly, which is
    // what "burning down" should look like.
    let weightSum = 0;
    const weights = burns.map((b) => {
      const w = 1 - (now - b.t) / linger;
      const v = Math.pow(w, HOT_TRAIL_FADE_POW);
      weightSum += v;
      return v;
    });
    if (weightSum <= 0) return;

    const travelCw = Math.hypot(dx, dy) / cw;
    // Emission scales with how much text is alight, but sub-linearly - a wide
    // spread should look like more fire, not like the same fire smeared out,
    // without the particle count exploding.
    const spanScale = 1 + (halfSpan * 2) / (cw * 6);
    const n = (FLAME_PER_SECOND * dt * spanScale * Math.min(HOT_TRAIL_EMIT_MAX, 0.55 + weightSum * 0.45)
      + travelCw * perLength) * qty;
    let count = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
    count = Math.max(0, Math.min(count, chunkCap - live));
    if (count <= 0) return;

    for (let i = 0; i < count; i++) {
      // Pick which alight patch this particle comes off, weighted by how
      // strongly that patch is still burning.
      let r = Math.random() * weightSum;
      let bi = 0;
      while (bi < burns.length - 1 && (r -= weights[bi]) > 0) bi++;
      const burn = burns[bi];
      const strength = Math.max(0, 1 - (now - burn.t) / linger);

      // Fire sits JUST ABOVE the glyphs, licking up off them - not on top of
      // the letters, which reads as the text being overprinted rather than
      // burning.
      //
      // burn.y is the top of the LINE BOX, which sits above the glyphs by the
      // half-leading. The old offset was a flat 0.22 of the line height, and
      // on ordinary body text that lands almost exactly on the cap height -
      // i.e. right on the letters. Deriving it from the font size instead
      // puts the base at the true top of the glyphs and then lifts it clear
      // by a fraction of the type size, so the flames start in the gap and
      // rise from there. It also adapts to headings, where the half-leading
      // is a quite different share of the line box.
      const fs = burn.fs || lh * 0.62;
      const halfLeading = Math.max(0, (burn.lh || lh) - fs) / 2;
      const topY = burn.y + halfLeading - fs * HOT_HEAD_LIFT;

      // Evenly across the patch (it was biased toward the centre, which
      // piled the fire over the caret's own column), plus the stretch of the
      // row the caret just travelled for the freshest mark.
      const across = (Math.random() * 2 - 1) * halfSpan;
      const s = Math.random();
      const alongX = (bi === burns.length - 1) ? -dx * (1 - s) : 0;

      let px = burn.x + alongX + across + (Math.random() - 0.5) * FLAME_SPREAD * cw;
      // On one line, the tops of the glyphs: a thin band, mostly up, a hair
      // down so the flame bites into what it burns. Every mark alike - the
      // trail too, which until 1.6.4 was jittered down over the letters.
      const py = topY
        + (HOT_HEAD_JITTER_DOWN - Math.random() * (HOT_HEAD_JITTER_UP + HOT_HEAD_JITTER_DOWN)) * lh;

      // Keep the fire on the text. Without this the spread band burns happily
      // out into the empty margin past the end of a line, which looks like the
      // page is on fire rather than the writing. The extent is the caret's
      // VISUAL row, so on a wrapped line the fire stops at the wrap, not at the
      // far end of the logical line. Half a character of overhang is allowed so
      // the first and last glyphs aren't sliced down the middle.
      //
      // And the mark's own cell always burns: it is where the caret was, so
      // it is text or text just deleted. Without it Backspace and
      // Ctrl+Backspace had next to no fire - the row had already shrunk past
      // the marks they laid, and everything off them was dropped (1.6.4).
      // Nor does the fire lick down over the row below at a row's first or
      // last character any more; it rises from the one line like the rest.
      const rl = burn.rowLeft, rr = burn.rowRight;
      if (rl != null && rr != null) {
        const pad = cw * 0.5;
        const lo = Math.min(rl - pad, burn.x - cw * 0.5);
        const hi = Math.max(rr + pad, burn.x + cw * 0.5);
        if (hi - lo < cw * 2) {
          // Blank row: nothing to burn but the caret's own cell.
          px = Math.min(Math.max(px, burn.x - cw * 0.5), burn.x + cw * 0.5);
        } else if (px < lo || px > hi) {
          // Rather than clamping every stray particle onto the boundary (which
          // stacks a bright wall of fire exactly on the last character), drop
          // it. The band is simply thinner near an edge, which is what running
          // out of fuel should look like.
          continue;
        }
      }

      // A kick up, sqrt(random) for its size (hotKick).
      const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul;

      // The shape: how far down HOT_BLOCK_SHAPES this particle starts, from
      // how long it will live (life0 over the maximum), with a little jitter
      // so equally long-lived neighbours are not identical. Mirrored at random.
      // Older marks (the trail behind the caret) still get a decent floor on
      // life, so the trail keeps some proper chunks rather than only specks.
      const life0 = fadeMs * (HOT_LIFE_FLOOR + (1 - HOT_LIFE_FLOOR) * Math.pow(Math.random(), FLAME_LIFETIME_EXP)) * (0.7 + 0.3 * strength);
      const lifeShare = Math.max(0, Math.min(1, life0 / fadeMs));
      const shapeN = HOT_BLOCK_SHAPES.length;
      const shape0 = Math.max(0, Math.min(shapeN - 1,
        Math.round((1 - lifeShare) * (shapeN - 1) + (Math.random() - 0.5) * 3)));
      this.flameEmbers.push({
        x: px, y: py,
        ...hotKick(mag),
        shape0, flip: Math.random() < 0.5,
        // Upstream is a bare max*rand^n. The floor is ours: with no floor a
        // large share of particles are born with a percent or two of max life
        // and die inside a frame, spending the budget on specks nobody sees.
        // The exponent still shapes the distribution; the floor just makes
        // every particle last long enough to be drawn.
        life: life0, life0,
        maxLife: fadeMs,
        // Older patches burn cooler, so a trail of lingering fire fades down
        // the ramp as well as thinning out.
        temp: Math.min(1, (0.55 + Math.random() * 0.45) * (0.45 + 0.55 * strength)),
        cw,
        // Buoyancy is per-particle so a change to Flame Height doesn't yank
        // everything already in the air.
        lift: heightMul,
      });
      // The sparks: tiny, quick, lighter, from the same spot, rising faster.
      // And now and then a finer one with them.
      if (this._hotSparks < this._hotSparkCap) {
        const nSp = HOT_SPARKS_PER_CHUNK + (Math.random() < HOT_FINE_CHANCE ? 1 : 0);
        for (let k = 0; k < nSp; k++) {
          const fine = k >= HOT_SPARKS_PER_CHUNK;
          const kick = hotKick(FLAME_INITIAL_VELOCITY * Math.random() * cw * heightMul);
          this.flameEmbers.push({
            spark: true, fine,
            x: px + (Math.random() - 0.5) * cw * 0.6, y: py - Math.random() * lh * 0.15,
            ...kick,
            vy: kick.vy - HOT_SPARK_RISE * cw * heightMul,
            life: fadeMs * (0.15 + 0.65 * Math.random()) * (0.5 + 0.5 * strength),
            maxLife: fadeMs,
            temp: 0.5 + Math.random() * 0.5,
            cw,
            lift: heightMul * HOT_SPARK_LIFT,
          });
          this._hotSparks = (this._hotSparks | 0) + 1;
        }
      }
    }
  },

  // Hot-head's fire colour for a given temperature (0..1):
  //
  //   0.00  the cursor's own colour - the coolest fire is the colour of
  //         whatever lit it, so the effect stays in the cursor's family
  //   0.28  yellow
  //   0.55  orange
  //   0.80  red-orange
  //   1.00  white-hot
  //
  // Separate from Speed Demon's heatColor, which drives the caret's own colour
  // and has its own ramp. Interpolation is per-segment in HSV, not RGB: an RGB
  // lerp from a cool cursor colour to yellow passes through grey, and fire is
  // never desaturated. The ignition segment forces hues past 180 to climb, so a
  // blue or violet cursor reddens on its way to yellow through magenta rather
  // than flashing lime through cyan and green - shortest is not the same as
  // most like fire.
  hotFireColor(this: CursorSmithPlugin, temp: number, baseHex: string): string {
    const h = Math.max(0, Math.min(1, temp));
    const base = rgbToHsv(hexToRgbTuple(baseHex));

    let i = 0;
    while (i < HOT_STOP_POS.length - 2 && h > HOT_STOP_POS[i + 1]) i++;
    const t0 = HOT_STOP_POS[i];
    const t1 = HOT_STOP_POS[i + 1];
    const t = t1 > t0 ? (h - t0) / (t1 - t0) : 0;
    const f = t * 0.7 + easeInOutSine(t) * 0.3;

    const from = i === 0 ? base : HOT_HSV[i - 1];
    const to = HOT_HSV[i];
    const arc = i === 0 && from[0] > 180 ? 1 : 0;
    return rgbTupleToHex(hsvToRgb(lerpHsv(from, to, f, arc)));
  },

  // Hot-head's fire.
  //
  // Particles are points. They're binned into a fine square lattice, and how
  // big each one is drawn is decided by its remaining life, not by any radius
  // it carries: fresh ones cover a 2x2 patch of squares, middle-aged ones a
  // single square, old ones a small dot inside one. Then they fade through
  // discrete shade levels. Big blocks, then specks, then gone.
  //
  // The lattice is square and sized off the FONT, not off the character cell,
  // and each square decides its own size stage and colour from the particles
  // in it. Upstream bins into character cells and gives every sub-cell of a
  // cell one shared glyph and colour, because a terminal can only put one
  // character in one cell - reproducing that on a canvas made the grid far too
  // legible, a lattice of character-sized rectangles that read as a tiling
  // artefact instead of as fire.
  //
  // The lattice is anchored to absolute canvas coordinates, not to the caret.
  // Particles move continuously but can only light whole squares, so they
  // appear to step from square to square; anchor it to the caret and the whole
  // fire slides smoothly with it, which just looks like a scaled-up bitmap.
  drawHotHead(this: CursorSmithPlugin) {
    if (!this.flameEmbers.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const active = this.animActive;
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1))
      * Math.max(0, Math.min(1, this.styleFor("hotHeadOpacity") ?? 1));
    const maxLife = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);

    const dtMs = Math.max(1, Math.min(100, now - (this._hotDrawT || now - 17)));
    this._hotDrawT = now;
    const dt = dtMs / 1000;

    // Upstream applies damping per 17ms frame; correcting by the real interval
    // keeps the motion identical at 30, 60 and 144fps.
    const damp = Math.exp(Math.log(1 - FLAME_DAMPING) * (dtMs / 17));

    // Grid square, from the font rather than the character cell, so it stays
    // square and stays small enough not to draw attention to itself. Chunks
    // are placed on this lattice (pixel art aligns); nothing is shaded by it.
    const fontSize = (active && active.fontSize) || 16;
    const px = Math.max(HOT_PX_MIN, Math.min(HOT_PX_MAX, Math.round(fontSize / HOT_PX_DIVISOR)));
    // Sparks and spent dots are lattice pixels too: a speck centred in its
    // grid square, snapped to the same lattice as the chunks.
    const speck = Math.max(1, Math.round(px * HOT_SPECK_SCALE));
    const speckOff = Math.floor((px - speck) / 2);
    const fineSz = Math.max(1, Math.round(px * HOT_FINE_SCALE));
    const fineOff = Math.floor((px - fineSz) / 2);

    // ---- Colour ----------------------------------------------------------------
    // Two palettes, one per mode, each a ramp of FLAME_LEVELS+1 entries indexed
    // by temperature. Rebuilt only when its inputs change - it used to be
    // rebuilt every frame the heat moved at all, which with Speed Demon on was
    // every frame.
    const flatMode = !!this.styleFor("hotHeadFlat");
    const heatTheFire =
      flatMode && this.styleFor("hotHeadSpeedHeat") && this.look.speedDemon;
    const heatQ = heatTheFire ? Math.round(Math.max(0, Math.min(1, this.heat || 0)) * 32) : -1;
    const base = heatTheFire
      ? this.heatColor(heatQ / 32, this.getBaseColor())
      : this.getBaseColor();
    const paletteKey = base + (flatMode ? "|flat" : "");
    let palette = this._hotPalette;
    if (!palette || this._hotPaletteKey !== paletteKey) {
      this._hotPaletteKey = paletteKey;
      palette = this._hotPalette = [];
      this._hotFill = null;
      const baseHsv = rgbToHsv(hexToRgbTuple(base));
      for (let j = 0; j <= FLAME_LEVELS; j++) {
        const u = j / FLAME_LEVELS;
        if (flatMode) {
          // "Use cursor color": the cursor's own colour at u = 0, lightening
          // toward white with heat. Never darker than the cursor.
          const tinted = hsvToRgb([baseHsv[0] + u * HOT_FLAT_HUE_SPAN * 0.5, baseHsv[1], baseHsv[2]]);
          const k = u * HOT_FLAT_LIGHTEN;
          palette.push([
            Math.round(tinted[0] + (255 - tinted[0]) * k),
            Math.round(tinted[1] + (255 - tinted[1]) * k),
            Math.round(tinted[2] + (255 - tinted[2]) * k),
          ]);
        } else {
          palette.push(hexToRgbTuple(this.hotFireColor(u, base)));
        }
      }
    }

    // The fill strings, cached by (palette entry, alpha): every ember sets
    // one, and there are only a palette's worth of shades at a dozen alpha
    // levels. Same text as before, so the goldens see no change; what it
    // saves is the string built per particle per frame, and the context's
    // own same-string test then skips the parse for a run of one shade.
    const pal = palette;
    const fills = this._hotFill || (this._hotFill = new Map<number, string>());
    const fillFor = (pi: number, alpha: number) => {
      const key = pi * 100000 + Math.round(alpha * 1000);
      let s = fills.get(key);
      if (s === undefined) {
        const [r, g, b] = pal[pi];
        s = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        fills.set(key, s);
      }
      return s;
    };

    // ---- Advance and paint -----------------------------------------------------------
    // Oldest first (the array is in spawn order), so a fresh bright chunk
    // paints over the fading ones beneath it. A chunk is ONE fill: its
    // shape's squares are put into a single path and filled once with one
    // colour, so nothing inside a chunk is shaded square by square - that
    // per-square shading was the grid. Chunks of the same colour that touch
    // merge seamlessly; different shades meet at an edge, which is a chunk.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x0: number, y0: number, w: number, h: number) => {
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x0 + w > maxX) maxX = x0 + w;
      if (y0 + h > maxY) maxY = y0 + h;
    };
    const shapeN = HOT_BLOCK_SHAPES.length;
    ctx.save();
    // Never on the caret itself: its box is clipped out, the way upstream
    // never draws a particle on the cursor's own cell. The fire lit at the
    // caret shows once it has risen clear of it.
    if (active && ctx.clip) {
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      ctx.rect(active.x, active.top, Math.max(active.w || 0, active.actualCharWidth || 0), active.h || 0);
      ctx.clip("evenodd");
    }
    this.flameEmbers = this.flameEmbers.filter((p) => {
      p.life -= dtMs;
      if (p.life <= 0) return false;

      const pcw = p.cw || 8;
      const lift = p.lift || 1;
      // Buoyancy scaled by Flame Height, plus a little per-frame turbulence.
      // Damping is strong, so what matters is the terminal velocity this
      // implies.
      p.vy = (p.vy + (FLAME_BUOYANCY * lift + FLAME_RANDOM_VELOCITY * HOT_TURB_Y * (Math.random() - 0.5)) * pcw * dt) * damp;
      p.vx = p.vx * damp + FLAME_RANDOM_VELOCITY * HOT_TURB_X * (Math.random() - 0.5) * pcw * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // The sway: a slow sine, its reach growing from nothing at birth, so a
      // flame leaves its line straight and waves a little as it climbs.
      if (p.sw) {
        const age = (p.age || 0) + dtMs;
        p.age = age;
        const reach = p.sw * pcw * Math.min(1, age / HOT_SWAY_GROW_MS);
        const so = reach * Math.sin((2 * Math.PI * (p.sf || HOT_SWAY_HZ) * age) / 1000 + (p.sp || 0));
        p.x += so - (p.so || 0);
        p.so = so;
      }

      const frac = Math.max(0, Math.min(1, p.life / (p.maxLife || maxLife)));
      const temp = hotQuant((p.temp || 1) * Math.pow(frac, HOT_TEMP_GAMMA), HOT_COLOR_LEVELS) * HOT_TEMP_MAX;
      const pi = Math.round(temp * FLAME_LEVELS);

      if (p.spark) {
        // A spark: a speck at its own position, fading with its life, a
        // little paler than the chunks so the haze reads as embers.
        const q = hotQuant(frac, HOT_ALPHA_LEVELS);
        if (q <= 0) return true;
        const alpha = (p.fine ? 0.15 + 0.35 * q : 0.2 + 0.5 * q) * opacity;
        ctx.fillStyle = fillFor(pi, alpha);
        const sz = p.fine ? fineSz : speck, off = p.fine ? fineOff : speckOff;
        const sx = Math.floor(p.x / px) * px + off, sy = Math.floor(p.y / px) * px + off;
        ctx.fillRect(sx, sy, sz, sz);
        grow(sx, sy, sz, sz);
        return true;
      }

      if (frac <= HOT_STAGE_PIXEL) {
        // Spent: a dot at the particle's own position.
        const q = hotQuant(frac / HOT_STAGE_PIXEL, HOT_ALPHA_LEVELS);
        if (q <= 0) return true;
        const alpha = (0.15 + 0.25 * q) * opacity;
        ctx.fillStyle = fillFor(pi, alpha);
        const dx0 = Math.floor(p.x / px) * px + speckOff, dy0 = Math.floor(p.y / px) * px + speckOff;
        ctx.fillRect(dx0, dy0, speck, speck);
        grow(dx0, dy0, speck, speck);
        return true;
      }

      // The chunk: its shape, stepped down the table by how much of its own
      // life is gone, anchored at the particle's lattice square, growing up
      // and right, mirrored if `flip`. One path, one fill.
      const gone = Math.pow(1 - Math.max(0, Math.min(1, p.life / (p.life0 || p.maxLife || maxLife))), HOT_SHAPE_EASE);
      const shape0 = p.shape0 ?? 0;
      const idx = Math.min(shapeN - 1, shape0 + Math.floor(gone * (shapeN - shape0)));
      const rows = HOT_BLOCK_SHAPES[idx];
      const h = rows.length;
      let area = 0;
      for (const row of rows) for (let i = 0; i < row.length; i++) if (row[i] === "1") area++;
      const stage = hotShapeStage(area);
      const q = hotQuant((frac - HOT_STAGE_PIXEL) / (1 - HOT_STAGE_PIXEL), HOT_ALPHA_LEVELS);
      if (q <= 0) return true;
      // Three alphas per stage, the big shapes the most solid.
      const alpha = (stage >= 3 ? 0.70 + 0.25 * q
        : stage >= 2 ? 0.60 + 0.25 * q
        : 0.45 + 0.25 * q) * opacity;
      ctx.fillStyle = fillFor(pi, alpha);
      const gx = Math.floor(p.x / px);
      const gy = Math.floor(p.y / px);
      ctx.beginPath();
      for (let ri = 0; ri < h; ri++) {
        const row = rows[ri];
        const w = row.length;
        // Runs of squares in a row become one rect each.
        let i = 0;
        while (i < w) {
          if (row[i] !== "1") { i++; continue; }
          let j = i;
          while (j < w && row[j] === "1") j++;
          const c0 = p.flip ? (w - j) : i;
          const x0 = (gx + c0) * px;
          const y0 = (gy - (h - 1 - ri)) * px;
          ctx.rect(x0, y0, (j - i) * px, px);
          grow(x0, y0, (j - i) * px, px);
          i = j;
        }
      }
      ctx.fill();
      return true;
    });

    ctx.restore();

    if (minX <= maxX) {
      const pad = px * 2;
      this._markDirty(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2);
    }
  },
};
