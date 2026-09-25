// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The pop effects: letters that spring out of the cursor, the glitch on a
// long jump, fireworks on Space and Enter, the thunderbolt on Enter, and
// the rainbow that sweeps them all.

import { hexToRgbTuple, hslToRgbString, hslToRgbTuple, lighten, thunderColorAt, thunderRamp } from "./color";
import {
  FIREWORK_ALPHA,
  FIREWORK_CELL,
  FIREWORK_DRIFT,
  FIREWORK_FALL_MS,
  FIREWORK_GRAVITY,
  FIREWORK_MAX_LIVE,
  FIREWORK_MIN_GAP_MS,
  FIREWORK_PALETTE_MAX,
  FIREWORK_PRESSURE,
  FIREWORK_RISE_JITTER,
  FIREWORK_RISE_LINES,
  FIREWORK_RISE_MS,
  FIREWORK_SECOND_AT,
  FIREWORK_SECOND_MAX,
  FIREWORK_SECOND_SPARKS,
  FIREWORK_SPARK_BUDGET,
  FIREWORK_SPARK_MIN,
  FIREWORK_TRAIL_LEN,
  FIREWORK_TWINKLE_AT,
  JUMP_TRAIL_MIN_DIST,
  POP_RISE_ALPHA,
  POP_RISE_LINES,
  POP_RISE_MS,
  TW_INK_ALPHA,
  THUNDER_BANDS,
  THUNDER_LIFE_MS,
  THUNDER_MAX_ANGLE,
  THUNDER_MAX_LIVE,
  THUNDER_MIN_REACH,
  THUNDER_PASSES,
} from "./constants";
import { easeInOutSine, glitchNoise } from "./motion";
import type { CaretRecord, FireworkSpark, GlitchState, Pt, ThunderBand } from "./types";
import type CursorSmithPlugin from "./plugin";

export const effectsPopsMethods = {
  spawnLetterParticle(this: CursorSmithPlugin, char: string, anchor: CaretRecord) {
    if (!char.trim()) return;

    // Rainbow suboption: step the group's running hue forward per letter
    // (instead of the normal single cursor color) so a fast typing burst reads
    // as a smooth sweep around the color wheel rather than a flat color or a
    // jittery random one. The hue is shared with Thunderstrike and Fireworks,
    // so a bolt or a burst landing mid-word continues the same sweep.
    let color = this.getActiveColor() || anchor.textColor;
    if (this.styleFor("popRainbow")) {
      color = hslToRgbString(this.nextRainbowHue(), 0.85, 0.6);
    }

    // "Rise straight up": from the top of the cursor, where the letter was
    // typed, straight up and fading - no throw, no spin, no fall.
    if (this.styleFor("popLettersRise")) {
      this.particles.push({
        char, rise: true,
        x: anchor.x + (anchor.actualCharWidth || anchor.w || 8) / 2,
        y: anchor.top,
        vx: 0, vy: 0, rotation: 0, alpha: POP_RISE_ALPHA,
        lh: anchor.h || 20,
        fontSize: anchor.fontSize,
        fontFamily: anchor.fontFamily,
        color,
        start: performance.now(),
      });
      return;
    }

    this.particles.push({
      char: char,
      x: anchor.x + (anchor.w || anchor.actualCharWidth) / 2,
      y: anchor.top,
      vx: (Math.random() - 0.5) * 120,    
      vy: -150 - Math.random() * 130,     
      rotation: (Math.random() - 0.5) * 4,
      alpha: 1,
      fontSize: anchor.fontSize,
      fontFamily: anchor.fontFamily,
      color,
      start: performance.now()
    });
  },

  // Typewriter's ink stamp: the letter just typed, overprinted on its own
  // cell (anchor: the caret it was typed at) bigger and bolder, shrinking
  // onto the real one and fading.
  spawnInkStamp(this: CursorSmithPlugin, char: string, anchor: CaretRecord) {
    if (!char.trim()) return;
    this.particles.push({
      char, stamp: true,
      x: anchor.x, y: anchor.top,
      vx: 0, vy: 0, rotation: 0, alpha: TW_INK_ALPHA,
      lh: anchor.h || 20,
      fontSize: anchor.fontSize, fontFamily: anchor.fontFamily,
      fontWeight: anchor.fontWeight, fontStyle: anchor.fontStyle,
      color: anchor.textColor || this.getActiveColor() || "#888888",
      start: performance.now(),
    });
  },

  // Typewriter's carriage return, on Enter: from the caret the old line ended
  // at (from) back to the start of that line - its visual row, or where the
  // caret now is.
  spawnCarriageReturn(this: CursorSmithPlugin, from: CaretRecord, to: CaretRecord) {
    if (!from || !to) return;
    const xs = typeof from.rowLeft === "number" ? from.rowLeft : Math.min(from.x, to.x);
    const x0 = from.x;
    if (!(x0 - xs > 2)) return;
    this.typeReturns.push({
      x0, xs,
      y: from.top + (from.h || 20) / 2 + (from.fontSize || 16) * 0.3,
      h: from.h || 20,
      color: this.getActiveColor() || from.textColor || "#888888",
      start: performance.now(),
    });
  },

  // The streak sweeps from the line's end to its start, easing out, its
  // tail following a beat behind; the spark at the end is four short strokes
  // growing out and fading. Crisp lines, no glow.
  drawCarriageReturns(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx || !this.typeReturns.length) return;
    const now = performance.now();
    this.typeReturns = this.typeReturns.filter((r) => {
      const u = (now - r.start) / this.twOpt("typewriterReturnMs", 80, 2000);
      if (u >= 1) return false;
      const ease = (v: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 3);
      const head = r.x0 - (r.x0 - r.xs) * ease(u / 0.6);
      const tail = r.x0 - (r.x0 - r.xs) * ease((u - 0.25) / 0.75);
      const alpha = 0.75 * (1 - easeInOutSine(u));
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = r.color;
      ctx.lineCap = "round";
      ctx.lineWidth = this.twOpt("typewriterReturnWidth", 0.25, 8);
      ctx.beginPath();
      ctx.moveTo(tail, r.y);
      ctx.lineTo(head, r.y);
      ctx.stroke();
      // The ding: four ticks around the old line's end, above the streak.
      const sparkU = Math.min(1, u / 0.8);
      const inner = r.h * (0.12 + 0.1 * sparkU), outer = r.h * (0.22 + 0.2 * sparkU);
      const cx = r.x0, cy = r.y - r.h * 0.45;
      ctx.globalAlpha = Math.max(0, 0.8 * (1 - sparkU));
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(cx + ux * inner, cy + uy * inner);
        ctx.lineTo(cx + ux * outer, cy + uy * outer);
      }
      ctx.stroke();
      ctx.restore();
      const pad = r.h * 0.5;
      this._markDirty(r.xs - pad, cy - outer - 2, (r.x0 - r.xs) + outer + pad * 2, (r.y - cy) + outer + pad);
      return true;
    });
  },

  drawLettersParticles(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    
    this.particles = this.particles.filter(p => {
      if (p.stamp) {
        // Overprinted on its cell, on the real glyph's baseline (the Box's
        // own metrics), bigger and bolder at first and shrinking onto it.
        const t = (now - p.start) / this.twOpt("typewriterInkMs", 80, 3000);
        const inkScale = this.twOpt("typewriterInkSize", 1, 3);
        if (t >= 1) return false;
        const size = p.fontSize || 16;
        const lh = p.lh || size * 1.4;
        ctx.save();
        ctx.font = this.fontString(size, p.fontFamily, "bold", p.fontStyle || "normal");
        const m = ctx.measureText(p.char);
        const ascent = m.fontBoundingBoxAscent ?? size * 0.8, descent = m.fontBoundingBoxDescent ?? size * 0.2;
        const baseline = p.y + ascent + (lh - ascent - descent) / 2;
        const cx = p.x + m.width / 2, cy = baseline - (ascent - descent) / 2;
        const grow = 1 + (inkScale - 1) * Math.pow(1 - Math.min(1, t / 0.45), 2);
        p.alpha = TW_INK_ALPHA * (1 - easeInOutSine(t));
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.translate(cx, cy);
        ctx.scale(grow, grow);
        ctx.translate(-cx, -cy);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.char, p.x, baseline);
        ctx.restore();
        const ext = Math.max(m.width, size) * inkScale;
        this._markDirty(cx - ext, p.y - lh * 0.3, ext * 2, lh * 1.6);
        return true;
      }
      if (p.rise) {
        // Straight up from the cursor's top, easing out, fading as it goes.
        const t = (now - p.start) / POP_RISE_MS;
        if (t >= 1) return false;
        const lh = p.lh || p.fontSize * 1.4;
        const y = p.y - lh * POP_RISE_LINES * (1 - Math.pow(1 - t, 3));
        const size = p.fontSize || 16;
        p.alpha = POP_RISE_ALPHA * Math.pow(1 - t, 1.4);
        this._markDirty(p.x - size * 1.2, y - size * 1.4, size * 2.4, size * 1.6);
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.font = `${size * 0.95}px ${p.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(p.char, p.x, y);
        ctx.restore();
        return true;
      }
      const elapsed = (now - p.start) / 1000; 
      if (elapsed > 0.45) return false;       
      
      const t = elapsed / 0.45;
      p.alpha = 1 - t; 
      
      const curX = p.x + p.vx * elapsed;
      const curY = p.y + p.vy * elapsed + 0.5 * 320 * elapsed * elapsed; 
      const curRot = p.rotation * elapsed * 5;

      // Rotated glyph drawn about its centre: fontSize in every direction
      // bounds it comfortably, plus slack for the rotation and descenders.
      const ext = (p.fontSize || 16) * 1.4;
      this._markDirty(curX - ext, curY - ext, ext * 2, ext * 2);

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.fontSize * 0.9}px ${p.fontFamily}`;
      ctx.translate(curX, curY);
      ctx.rotate(curRot);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.char, 0, 0);
      ctx.restore();
      
      return true;
    });
  },

  // Lay a line of small pixel puffs along the path between two caret positions,
  // for Trail On Jump. `from`/`to` are caret snapshots (the old and new
  // positions). Does nothing for a short move - that's just typing, which the
  // per-commit puff in spawnFlamePixels already handles.
  // Arm a Signal Glitch burst, if this move was far enough to count as a jump.
  //
  // Jump-only is a deliberate design constraint, not a limitation: a glitch on
  // every keystroke would strobe the caret continuously while typing, which is
  // unreadable and a genuine photosensitivity concern. A jump (click, search
  // result, Vim motion, fold toggle) is rare enough that a ~200ms break-up
  // reads as punctuation on the movement instead of ambient noise.
  spawnGlitch(this: CursorSmithPlugin, from: CaretRecord, to: CaretRecord) {
    if (!from || !to) return;
    const dist = Math.hypot(to.x - from.x, to.top - from.top);
    // Same threshold the jump trail uses, so "what is a jump" has one answer.
    if (dist < JUMP_TRAIL_MIN_DIST) return;

    const dur = Math.max(60, Math.min(600, this.look.crtGlitchMs ?? 220));
    // Longer leaps break up harder, but with a ceiling: without the clamp a
    // click from the top to the bottom of a long note produced slices thrown
    // most of a pane's width away, which stops reading as a cursor at all.
    const reach = Math.min(2.2, 0.7 + dist / 420);

    // A second jump mid-burst REPLACES the current one rather than stacking or
    // being ignored: rapid clicking should re-break the cursor each time, and
    // a fresh seed makes each burst a visibly different arrangement.
    this.glitch = {
      start: performance.now(),
      dur,
      reach,
      seed: (Math.random() * 0x7fffffff) | 0,
    };
  },

  // Resolve the live glitch into per-frame drawing parameters, or null when no
  // burst is running. Also retires an expired burst, which is what lets the
  // frame governor drop back out of the hot gear.
  glitchState(this: CursorSmithPlugin, now: number): GlitchState | null {
    const g = this.glitch;
    if (!g) return null;
    const p = (now - g.start) / g.dur;
    if (p >= 1 || p < 0) {
      this.glitch = null;
      return null;
    }

    // Envelope: hard on at the start, decaying to nothing. Squared so most of
    // the violence happens in the first third and the tail settles quickly -
    // a linear decay reads as the cursor slowly reassembling, which looks
    // like a transition rather than a fault.
    const env = (1 - p) * (1 - p);

    // Re-roll on a ~45ms bucket rather than per frame. A glitch that changes
    // every frame at 60fps averages out into a blur; stepping through ~5
    // discrete states across a 220ms burst is what reads as a broken signal.
    const bucket = Math.floor((now - g.start) / 45);

    const strength = Math.max(0, Math.min(2.5, this.look.crtGlitchStrength ?? 1));
    const aberr = Math.max(0, Math.min(3, this.look.crtGlitchAberration ?? 1));

    return {
      seed: g.seed,
      bucket,
      env,
      // Peak sideways throw of a slice, in px.
      amp: 14 * strength * g.reach * env,
      // RGB channel separation, in px. Kept smaller than amp: past a few px
      // the fringes stop reading as chromatic aberration and start reading as
      // three separate coloured cursors.
      ab: 3.2 * aberr * env,
      strength,
    };
  },

  // Paint one axis-aligned cursor rect as a broken-up signal.
  //
  // Three things combine here, which is what keeps it from looking like a
  // simple shake:
  //   1. The rect is cut into horizontal slices that slip sideways by
  //      different amounts, so the FORM tears rather than translating.
  //   2. Each slice is independently squashed/stretched horizontally, so
  //      edges stop lining up and the outline warps.
  //   3. Each slice is drawn three times - once per RGB channel, offset - and
  //      composited additively, so overlapping areas sum back to the original
  //      colour while the edges fringe hard red and cyan.
  //
  // The smear quad is intentionally ignored while glitching: a spring-deformed
  // quad sliced and channel-split at the same time is visual mud, and the
  // glitch is brief enough that dropping the smear for its duration reads as
  // part of the effect.
  paintGlitchRect(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, baseColor: string, alpha: number, gs: GlitchState) {
    const rgb = hexToRgbTuple(baseColor) || [255, 255, 255];
    const R = Math.round(rgb[0]), G = Math.round(rgb[1]), B = Math.round(rgb[2]);

    // Slice count scales with height so a tall line doesn't get chunky bands
    // and a short one doesn't get sub-pixel ones.
    const slices = Math.max(3, Math.min(12, Math.round(h / 3)));
    const sh = h / slices;

    ctx.save();
    // Additive so the three channel passes reconstruct the base colour where
    // they overlap instead of the last one painted winning.
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < slices; i++) {
      const n1 = glitchNoise(gs.seed, i, gs.bucket);
      const n2 = glitchNoise(gs.seed + 101, i, gs.bucket);
      const n3 = glitchNoise(gs.seed + 977, i, gs.bucket);

      // Dropout: some slices vanish entirely. This is the single strongest
      // "broken signal" cue - without it the cursor stays a solid object that
      // is merely wobbling.
      if (n3 < 0.13 * gs.env) continue;

      // Sideways throw. Cubed around zero so most slices barely move and the
      // occasional one is flung far, which is what makes it read as a tear
      // instead of a uniform vibration.
      const d = (n1 - 0.5) * 2;
      const dx = d * d * d * gs.amp;

      // Horizontal squash/stretch per slice: warps the outline.
      const wScale = 1 + (n2 - 0.5) * 0.55 * gs.strength * gs.env;
      const sw = Math.max(1, w * wScale);
      const sx = x + dx - (sw - w) / 2;
      const sy = y + i * sh;
      // Overdraw each slice by a hair vertically so rounding between slices
      // can't leave a transparent seam across the cursor.
      const drawH = sh + 0.5;

      if (gs.ab > 0.05) {
        ctx.fillStyle = `rgba(${R}, 0, 0, ${alpha})`;
        ctx.fillRect(sx - gs.ab, sy, sw, drawH);
        ctx.fillStyle = `rgba(0, ${G}, 0, ${alpha})`;
        ctx.fillRect(sx, sy, sw, drawH);
        ctx.fillStyle = `rgba(0, 0, ${B}, ${alpha})`;
        ctx.fillRect(sx + gs.ab, sy, sw, drawH);
      } else {
        // Aberration dialled to zero: one pass, so the slices keep the exact
        // cursor colour rather than an additively-reconstructed approximation.
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(${R}, ${G}, ${B}, ${alpha})`;
        ctx.fillRect(sx, sy, sw, drawH);
        ctx.globalCompositeOperation = "lighter";
      }
    }

    // A hot white scanline across the break, on some buckets only. Cheap, and
    // it sells the "signal" reading more than any amount of extra displacement.
    if (glitchNoise(gs.seed + 5501, 0, gs.bucket) < 0.55) {
      const ly = y + glitchNoise(gs.seed + 31, 1, gs.bucket) * h;
      const lw = w * (1.2 + glitchNoise(gs.seed + 77, 2, gs.bucket) * 1.6);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.55 * gs.env})`;
      ctx.fillRect(x - (lw - w) / 2, ly, lw, Math.max(1, h * 0.06));
    }

    ctx.restore();
  },

  // ---- Pop Effects: shared colour --------------------------------------
  // Hand out the next hue in the group's rainbow sweep and advance it.
  //
  // Every pop effect draws from this ONE counter, which is the whole point of
  // Rainbow being a group-level option rather than a per-effect one: letters,
  // bolts and fireworks fired in the same burst of typing come out as
  // consecutive steps of a single sweep instead of three sweeps at unrelated
  // phases that happen to share a palette.
  //
  // 33° is coprime-ish with 360 (they share only 3), so the sweep takes ~120
  // pops to repeat a hue rather than cycling visibly every handful of keys.
  nextRainbowHue(this: CursorSmithPlugin, step = 33): number {
    const hue = this._popRainbowHue;
    this._popRainbowHue = (hue + step) % 360;
    return hue;
  },

  // One firework spark's colour, as an [r,g,b] tuple.
  //
  // Precedence is Rainbow, then Gradient, then the flat cursor colour, and it
  // is resolved by the CALLER passing (or not passing) a base: `base` is
  // non-null only when Rainbow is on, in which case every spark in the burst
  // varies around that one hue. With Rainbow off this samples a random point
  // along the gradient per spark, which is what gives a burst the cursor's own
  // colours - and sampleRamp already collapses to the flat cursor colour when
  // no gradient is set, so the no-gradient case needs no branch of its own.
  //
  // The nudge afterwards is what "slight variations" means: enough that no two
  // sparks in a burst are the same pixel colour, small enough that the burst
  // still reads as the gradient (or the hue) it came from.
  fireworkSparkRGB(this: CursorSmithPlugin, base: number[] | null): number[] {
    const [r, g, b] = base || this.sampleRamp(Math.random());
    return [
      Math.max(0, Math.min(255, Math.round(r + (Math.random() - 0.5) * 76))),
      Math.max(0, Math.min(255, Math.round(g + (Math.random() - 0.5) * 76))),
      Math.max(0, Math.min(255, Math.round(b + (Math.random() - 0.5) * 76))),
    ];
  },

  // ---- Fireworks ---------------------------------------------------------
  // Space or Enter sends one or more pixelated shells climbing out of the
  // caret; each bursts above it and the sparks arc back down under gravity.
  //
  // Like the thunderbolt, a whole firework is generated ONCE here - launch
  // point, apex, every spark's angle, speed, size and colour - and the draw
  // call only advances it along a closed-form path. Rolling any of that per
  // frame would make the spray boil instead of fly, and would tie the shape of
  // the effect to the frame rate the governor happened to pick.
  // Total sparks in flight, which is what actually costs anything to draw.
  // Walked rather than kept as a running total: shells are removed by a filter
  // inside drawFireworks, so a counter would need decrementing from the draw
  // path and would drift the first time that changed.
  _liveSparkCount(this: CursorSmithPlugin) {
    let n = 0;
    for (const fw of this.fireworks) n += fw.sparks.length;
    return n;
  },

  spawnFireworks(this: CursorSmithPlugin, target: CaretRecord) {
    if (!this.look.popEffects || !this.look.fireworks) return;
    if (!target) return;

    // Key repeat can deliver Space far faster than a burst can be seen. The
    // live cap below would still bound the work, but only by throwing away
    // shells a frame or two after launching them - so the gap is enforced
    // first, before any of the generation cost is paid.
    const now = performance.now();
    if (now - this._lastFireworkT < FIREWORK_MIN_GAP_MS) return;

    // One slider, two jobs: how many shells go up, and how much each throws.
    // Kept deliberately blunt at the low end - the shell count rounds to 1 for
    // anything up to 1.5 - so the bottom of the range is a single modest pop
    // rather than a thin volley.
    const q = Math.max(0.2, Math.min(3, this.look.fireworksQuantity ?? 1));
    const shells = Math.max(1, Math.min(3, Math.round(q)));
    const wanted = Math.max(4, Math.round(12 * q));

    // What's already in the air decides what this launch can afford.
    //
    // The old rule was `while (live >= MAX) shift()` - evict the OLDEST shell
    // to make room. That is backwards, and it is the whole reason holding
    // Space looked like the effect had died: the oldest shell is the one
    // mid-burst, so a held key killed every shell at ~48% of its arc, just
    // after it detonated. You saw shells climb, flash, and vanish.
    //
    // A launch that never happens is invisible. A shell that dies mid-burst is
    // a visible glitch. So nothing in flight is ever evicted now; instead the
    // budget decides how big THIS burst gets, and a launch with nothing left
    // to spend is simply skipped.
    const liveSparks = this._liveSparkCount();
    const roomTotal = FIREWORK_SPARK_BUDGET - liveSparks;
    if (roomTotal < FIREWORK_SPARK_MIN) return;
    // Don't re-stamp the gap on a skipped launch, so the next keystroke can
    // try again immediately rather than serving out a gap it never used.
    this._lastFireworkT = now;
    const pressure = liveSparks / FIREWORK_SPARK_BUDGET;
    const rich = pressure < FIREWORK_PRESSURE;

    const lh = target.h || 16;
    const w = target.w || target.actualCharWidth || 8;
    const x0 = target.x + w / 2;
    const y0 = target.top;
    const clipTop = this._clipTop ?? 0;
    const fallSec = FIREWORK_FALL_MS / 1000;

    // Resolved once per keystroke, not per shell: a volley from one Space is
    // one event and should share a hue, rather than stepping the sweep three
    // times in a single keypress and coming out as a rainbow in miniature.
    const base = this.styleFor("popRainbow")
      ? hslToRgbTuple(this.nextRainbowHue(), 0.85, 0.62)
      : null;

    for (let i = 0; i < shells; i++) {
      // Hard shell cap as well as the spark budget: a great many tiny bursts
      // still costs a damage box and a filter pass each.
      if (this.fireworks.length >= FIREWORK_MAX_LIVE) break;
      // Split what's left across the shells still to launch, so shell 0 of a
      // three-shell volley doesn't spend the whole budget.
      const share = Math.floor((FIREWORK_SPARK_BUDGET - this._liveSparkCount()) / (shells - i));
      if (share < FIREWORK_SPARK_MIN) break;
      const sparkCount = Math.max(FIREWORK_SPARK_MIN, Math.min(wanted, share));

      const rise = lh * (FIREWORK_RISE_LINES + (Math.random() - 0.5) * 2 * FIREWORK_RISE_JITTER);
      // Two clamps, in this order:
      //   • pull the apex down to just inside the top of the pane, so a burst
      //     isn't spent entirely behind the clip on a caret near the top;
      //   • then force it back above the caret regardless, because the first
      //     clamp can otherwise push the apex BELOW the launch point on the
      //     first visible line and the shell would sink instead of climb.
      // On that first line the burst does end up partly clipped. That's the
      // graceful failure: a low pop at the top of the pane, not an upside-down
      // one or nothing at all.
      const bx = x0 + (Math.random() - 0.5) * 2 * FIREWORK_DRIFT;
      const by = Math.min(
        y0 - lh * 0.9,
        Math.max(y0 - rise, clipTop + lh * 0.5),
      );

      // Colours are quantised into a small palette and each spark stores an
      // INDEX into it, rather than its own r/g/b. Two reasons, both about the
      // draw call: the rgba() string for each entry is built once here instead
      // of once per spark per frame (which was thousands of throwaway strings
      // a second), and sorting the sparks by index lets the draw set fillStyle
      // a handful of times per shell instead of once per spark.
      const palN = Math.max(2, Math.min(FIREWORK_PALETTE_MAX, Math.ceil(sparkCount / 3)));
      const palette = [];
      for (let c = 0; c < palN; c++) {
        const [r, g, b] = this.fireworkSparkRGB(base);
        palette.push(`rgb(${r}, ${g}, ${b})`);
      }

      const sparks = [];
      let maxReach = 0;
      for (let s = 0; s < sparkCount; s++) {
        // Full circle rather than a dome: the sparks are what fall, and a
        // burst that only ever throws upward reads as a fountain.
        const ang = Math.random() * Math.PI * 2;
        // Speed scales with the line height so the burst keeps its proportions
        // relative to the text at any font size, rather than being a fixed
        // pixel radius that swamps small type and vanishes in large.
        const speed = lh * (3.4 + Math.random() * 6.2);
        // A few sparks at double size carry the burst; the rest are single
        // grid cells. All of it stays on the grid - that is what keeps this
        // pixel art rather than a particle spray.
        const size = FIREWORK_CELL * (Math.random() < 0.22 ? 2 : 1);
        sparks.push({
          ang, speed, size,
          ci: (Math.random() * palN) | 0,
          // Twinkle phase and rate, rolled once. Rolling per frame would be
          // noise rather than a flicker, for the same reason the thunderbolt
          // generates its jitter once.
          tw: Math.random() * Math.PI * 2,
          tr: 9 + Math.random() * 14,
        });
        if (speed > maxReach) maxReach = speed;
      }
      // Sorted so the draw can walk colour-major. Done once, here.
      sparks.sort((a, b) => a.ci - b.ci);

      // Secondary pops: a handful of sparks detonate again on the way down.
      // Pre-generated like everything else - the parent's position at the pop
      // instant is closed-form, so the children can be advanced from it
      // without the draw ever having to remember where anything was.
      const secondaries = [];
      if (rich && sparkCount >= 8) {
        const nSec = Math.min(FIREWORK_SECOND_MAX, Math.max(1, Math.round(sparkCount / 10)));
        for (let n = 0; n < nSec; n++) {
          const parent = sparks[(Math.random() * sparks.length) | 0];
          const at = FIREWORK_SECOND_AT[0] +
            Math.random() * (FIREWORK_SECOND_AT[1] - FIREWORK_SECOND_AT[0]);
          const kids = [];
          for (let s = 0; s < FIREWORK_SECOND_SPARKS; s++) {
            kids.push({
              ang: Math.random() * Math.PI * 2,
              speed: lh * (1.1 + Math.random() * 2.0),
              size: FIREWORK_CELL,
              ci: (Math.random() * palN) | 0,
              tw: Math.random() * Math.PI * 2,
              tr: 12 + Math.random() * 16,
            });
          }
          kids.sort((a, b) => a.ci - b.ci);
          secondaries.push({ ang: parent.ang, speed: parent.speed, at, sparks: kids });
        }
      }

      // Bounds for the damage box, worked out once for the firework's whole
      // life rather than by walking the sparks every frame. Covers the climb,
      // the widest the spray can get, and the full gravity drop.
      const spread = maxReach * fallSec;
      const drop = 0.5 * FIREWORK_GRAVITY * fallSec * fallSec;
      // Secondaries pop away from a parent that has already travelled, so they
      // reach further than the primary spray and the box has to cover them or
      // they leave streaks behind. Worst case: the fastest parent, plus a full
      // child throw from wherever it got to.
      const secReach = secondaries.length
        ? maxReach * fallSec + lh * 3.1 * fallSec
        : 0;
      const reach = Math.max(spread, secReach);

      this.fireworks.push({
        x0, y0, bx, by,
        sparks, palette, secondaries,
        // Trails are the first thing dropped when the air is already full.
        trail: rich ? FIREWORK_TRAIL_LEN : 0,
        riseMs: FIREWORK_RISE_MS * (0.85 + Math.random() * 0.3),
        fallMs: FIREWORK_FALL_MS,
        // Stagger, so a volley goes up as a volley instead of as one lump.
        // Shell 0 is always immediate: the first pop has to land on the
        // keystroke that caused it or the whole effect feels laggy.
        delay: i === 0 ? 0 : i * (70 + Math.random() * 60),
        flash: Math.max(FIREWORK_CELL * 2, lh * 0.32),
        minX: Math.min(x0, bx - reach),
        maxX: Math.max(x0, bx + reach),
        minY: by - reach,
        maxY: Math.max(y0, by + reach + drop),
        start: now,
      });
    }
  },

  drawFireworks(this: CursorSmithPlugin) {
    if (!this.fireworks.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const cell = FIREWORK_CELL;
    // Snap to the grid the effect is built on. Done at paint time rather than
    // at spawn because the positions themselves are continuous - it's the
    // painted blocks that must line up, and quantising the maths instead would
    // make the arcs step sideways as well as visually.
    const snap = (v: number) => Math.round(v / cell) * cell;
    const fallSec = FIREWORK_FALL_MS / 1000;

    this.fireworks = this.fireworks.filter((fw) => {
      const age = now - fw.start;
      // Still on the pad: staggered shells in a volley haven't launched yet.
      if (age < fw.delay) return true;
      const t = age - fw.delay;
      if (t >= fw.riseMs + fw.fallMs) return false;

      ctx.save();

      if (t < fw.riseMs) {
        // ---- Climb. Eased so the shell decelerates into its apex, which is
        // what sells it as something thrown rather than something sliding.
        const p = t / fw.riseMs;
        const e = 1 - (1 - p) * (1 - p);
        const cx = snap(fw.x0 + (fw.bx - fw.x0) * e);
        const cy = snap(fw.y0 + (fw.by - fw.y0) * e);
        // Fades in over the first fifth of the climb so the shell doesn't
        // appear as a hard block sitting on the caret the instant a key lands.
        const a = FIREWORK_ALPHA * opacity * Math.min(1, p * 5);
        // A short tail of two blocks behind it, dimming with distance. Drawn
        // back along the actual line of travel, so a leaning shell trails at
        // its own angle rather than straight down.
        const dx = (fw.bx - fw.x0) / (fw.riseMs || 1);
        const dy = (fw.by - fw.y0) / (fw.riseMs || 1);
        const len = Math.hypot(dx, dy) || 1;
        for (let k = 2; k >= 1; k--) {
          ctx.fillStyle = `rgba(255, 255, 255, ${a * (0.18 / k)})`;
          ctx.fillRect(
            snap(cx - (dx / len) * cell * 2 * k),
            snap(cy - (dy / len) * cell * 2 * k),
            cell, cell,
          );
        }
        ctx.fillStyle = `rgba(255, 245, 220, ${a})`;
        ctx.fillRect(cx, cy, cell, cell);
      } else {
        // ---- Burst. Closed-form ballistics per spark, so the arcs are
        // identical whichever gear the frame governor is running in.
        const u = (t - fw.riseMs) / fw.fallMs;
        const el = u * fallSec;
        // Squared-ish falloff: bright for the first moment of the burst, then
        // away quickly. A linear fade leaves the sparks hanging in the text
        // long enough to be read as debris.
        const a = FIREWORK_ALPHA * opacity * Math.max(0, 1 - u * u);
        if (a > 0.01) {
          // Alpha rides globalAlpha and colour comes from the shell's small
          // pre-built palette, so the inner loop does no string work at all -
          // it used to build one rgba() per spark per frame. Sparks arrive
          // pre-sorted by palette index, so fillStyle changes a handful of
          // times per shell rather than once per spark.
          //
          // Twinkle gates on a per-spark sine rolled at spawn. It's the one
          // piece of physics here that makes the effect CHEAPER: a guttering
          // spark simply isn't drawn.
          const tw = u > FIREWORK_TWINKLE_AT;
          const drawSet = (list: FireworkSpark[], ox: number, oy: number, sc: number, alpha: number) => {
            let ci = -1;
            for (const s of list) {
              if (tw && Math.sin(s.tw + u * s.tr) < -0.35) continue;
              if (s.ci !== ci) { ci = s.ci; ctx.fillStyle = fw.palette[ci]; }
              const vx = Math.cos(s.ang) * s.speed;
              const vy = Math.sin(s.ang) * s.speed;
              // Tail blocks sit back along the path actually travelled, so a
              // spark trails behind its own arc rather than straight down.
              //
              // Only the double-size carrier sparks get one. Trailing every
              // spark triples the fill cost of the whole burst to produce a
              // smear - it's the few bright ones streaking past the rest that
              // read as depth, and the small ones are a grid cell wide, so
              // their "tail" was three cells of mush. Cheaper AND better.
              const tail = s.size > FIREWORK_CELL ? fw.trail : 0;
              for (let k = tail; k >= 1; k--) {
                const bt = Math.max(0, sc - k * 0.035);
                ctx.globalAlpha = alpha * (0.30 / k);
                ctx.fillRect(
                  snap(ox + vx * bt),
                  snap(oy + vy * bt + 0.5 * FIREWORK_GRAVITY * bt * bt),
                  FIREWORK_CELL, FIREWORK_CELL,
                );
              }
              ctx.globalAlpha = alpha;
              ctx.fillRect(
                snap(ox + vx * sc),
                snap(oy + vy * sc + 0.5 * FIREWORK_GRAVITY * sc * sc),
                s.size, s.size,
              );
            }
          };
          drawSet(fw.sparks, fw.bx, fw.by, el, a);

          // Secondaries. The parent's position at its pop instant is the same
          // closed-form expression as any other spark, so nothing had to be
          // remembered between frames to place them.
          for (const sec of fw.secondaries) {
            if (u <= sec.at) continue;
            const pt = sec.at * fallSec;
            const px = fw.bx + Math.cos(sec.ang) * sec.speed * pt;
            const py = fw.by + Math.sin(sec.ang) * sec.speed * pt +
                       0.5 * FIREWORK_GRAVITY * pt * pt;
            const ct = el - pt;
            // Children fade on their own clock, from their own pop, so a
            // secondary doesn't inherit a parent that's already nearly gone.
            const cu = (u - sec.at) / Math.max(0.001, 1 - sec.at);
            const ca = a * Math.max(0, 1 - cu);
            if (ca > 0.01) drawSet(sec.sparks, px, py, ct, ca);
          }
          ctx.globalAlpha = 1;
        }
        // The detonation itself: a block flaring at the apex for the first
        // moment, so the burst reads as an event rather than as sparks that
        // were always there and merely became visible.
        const flash = 1 - Math.min(1, u / 0.18);
        if (flash > 0) {
          const size = fw.flash * (0.4 + flash);
          ctx.fillStyle = `rgba(255, 252, 240, ${FIREWORK_ALPHA * opacity * flash * 0.5})`;
          ctx.fillRect(snap(fw.bx - size / 2), snap(fw.by - size / 2), size, size);
        }
      }

      ctx.restore();

      // One box for the whole firework, like the thunderbolt: the sparks are
      // scattered points, and marking each one would mean dozens of damage
      // rects per frame to clear a region a single box already covers.
      const pad = cell * 3 + fw.flash;
      this._markDirty(
        fw.minX - pad, fw.minY - pad,
        (fw.maxX - fw.minX) + pad * 2,
        (fw.maxY - fw.minY) + pad * 2,
      );
      return true;
    });
  },

  // ---- Thunderstrike -----------------------------------------------------
  // A bolt of pixelated lightning that drops out of the top of the pane onto
  // the caret's new position when Enter is pressed.
  //
  // The whole bolt - its path, its forks, the grid cells it occupies and its
  // flicker pattern - is generated ONCE here and then only faded by the
  // draw call. Regenerating the jitter per frame is the obvious way to write
  // this and it looks wrong: the channel boils rather than holds, and at 60fps
  // the noise aliases into a shimmer instead of reading as one discharge.
  spawnThunderbolt(this: CursorSmithPlugin, target: CaretRecord) {
    // Gated on the Pop Effects group, not on Pixel Trail. The bolt shares the
    // trail's particle pool for its impact sparks, but nothing about it needs
    // the trail to be switched on - and it never did; the old dependency was
    // an accident of where the toggle happened to sit in the panel.
    if (!this.look.popEffects || !this.look.thunderstrike) return;
    if (!target) return;

    // Oldest first, so holding Enter down rolls the strikes forward rather
    // than refusing new ones once the cap is hit.
    while (this.thunderbolts.length >= THUNDER_MAX_LIVE) this.thunderbolts.shift();

    const w = target.w || target.actualCharWidth || 8;
    const tx = target.x + w / 2;
    const ty = target.top;

    // Where it comes from: straight up, leaned over by a random angle. The
    // reach is measured against the top of the visible pane plus a margin, so
    // the bolt always starts above the clip window and appears to arrive from
    // outside it instead of switching on in mid-air partway down the page.
    const angle = (Math.random() - 0.5) * 2 * THUNDER_MAX_ANGLE;
    const clipTop = this._clipTop ?? 0;
    // Note the division by cos: `rise` is how far the bolt must climb to clear
    // the top of the pane, and a leaning bolt has to be LONGER to climb the
    // same height. Without it, the further a strike leaned the lower it
    // started, and steep ones switched on in mid-air halfway down the page.
    const rise = Math.max(THUNDER_MIN_REACH, (ty - clipTop) + 80);
    const reach = rise / Math.max(0.35, Math.cos(angle));
    const ox = tx + Math.sin(angle) * reach;
    const oy = ty - Math.cos(angle) * reach;

    const cell = Math.max(1, Math.round(this.look.thunderstrikeSize ?? 2));
    // Jitter scaled to the bolt's own length: a short strike near the top of
    // the pane and a long one from the bottom should have the same character,
    // not the same absolute wobble.
    const jitter = reach * 0.09;

    const seen: Set<string> = new Set();
    const main = this.boltPath(ox, oy, tx, ty, jitter);
    // Each block carries how far along the strike it sits, 0 at the sky end and
    // 1 at the caret. That's what the colour ramp is sampled against below.
    let cells = this.pixelateBolt(main, cell, seen, 0, 1);

    // Forks. Taken from a point in the upper half of the channel and thrown
    // outward and down, dying in mid-air - a fork that also lands would read
    // as a second strike on nothing.
    const forks = (Math.random() < 0.75 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
    for (let f = 0; f < forks; f++) {
      const ft = 0.15 + Math.random() * 0.4;
      const at = main[Math.floor(main.length * ft)];
      if (!at) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      // Clamped hard against vertical. Unclamped, a fork thrown off an already
      // steeply-leaning bolt could end up past horizontal and crawl back UP the
      // page - which stops reading as lightning immediately.
      const spread = Math.max(-1.1, Math.min(1.1, angle + side * (0.45 + Math.random() * 0.55)));
      const len = reach * (0.15 + Math.random() * 0.18);
      const fx = at.x + Math.sin(spread) * len;
      const fy = at.y + Math.cos(spread) * len;
      // The fork picks the ramp up where it branched off and carries on through
      // it, so it reads as part of the same discharge rather than as a second
      // bolt that happens to start in the same colour.
      cells = cells.concat(this.pixelateBolt(
        this.boltPath(at.x, at.y, fx, fy, len * 0.16), cell, seen, ft, Math.min(1, ft + 0.3)));
    }

    // Everything above the pane is painted into a wrapper that clips it away, so
    // those blocks cost fill calls and damage area for pixels nobody can see -
    // and on a long lean that is most of the bolt. Dropped here instead, which
    // also keeps the damage box below tight around the part that shows.
    cells = cells.filter((c) => c.y >= clipTop - cell);
    if (!cells.length) return;

    // Two or three palette colours in a random order, ramped from the sky end
    // down to the impact - or, with Rainbow on, the strike's slot in the sweep
    // the whole Pop Effects group shares. Sorted into bands so the draw call
    // can set a fill colour once per band rather than once per block.
    //
    // The hue is taken at spawn and baked into the bands, like everything else
    // about the bolt: reading it in the draw call would re-roll the colour on
    // every frame of the strike's life.
    const ramp = thunderRamp(this.styleFor("popRainbow") ? this.nextRainbowHue() : null);
    const bands: ThunderBand[] = [];
    for (let i = 0; i < THUNDER_BANDS; i++) {
      const [br, bg, bb] = thunderColorAt(ramp, i / (THUNDER_BANDS - 1));
      // Core and halo are the same hue at different lightnesses: the channel
      // itself is drawn lifted toward white so it reads as light rather than as
      // a coloured line, with the halo carrying the colour proper. Both are
      // worked out here, once, instead of per frame.
      bands.push({
        r: br, g: bg, b: bb,
        cr: lighten(br, 0.45), cg: lighten(bg, 0.45), cb: lighten(bb, 0.45),
        cells: [],
      });
    }
    for (const c of cells) {
      const i = Math.max(0, Math.min(THUNDER_BANDS - 1, Math.round(c.t * (THUNDER_BANDS - 1))));
      bands[i].cells.push(c);
    }
    // A short bolt or a narrow ramp leaves most bands empty; skipping them
    // spares the draw loop a pile of no-op fillStyle writes.
    const usedBands = bands.filter((x) => x.cells.length > 0);
    const [er, eg, eb] = thunderColorAt(ramp, 1);

    // Bounds are fixed for the bolt's whole life, so the damage box is worked
    // out once here rather than by walking every cell on every frame.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }

    this.thunderbolts.push({
      bands: usedBands, cell, tx, ty,
      minX, minY, maxX, maxY,
      // The impact flash is sized off the caret, not off the block size: at the
      // finest setting a flash a few blocks wide would be invisible, and the
      // strike has to be seen to land.
      flash: Math.max(cell * 2, (target.h || 16) * 0.4),
      er, eg, eb,
      // Real lightning is several discharges down the same channel, so the
      // bolt steps between discrete brightness levels instead of fading
      // smoothly. Rolled at spawn, because a per-frame random would beat
      // against the frame rate and turn a strobe into mush. The first step is
      // forced to full: the moment of the strike is the brightest. The floor is
      // high (0.6 rather than near-zero) so the strobe reads as a shimmer down
      // the channel rather than as the bolt switching on and off.
      flicker: Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0.6 + Math.random() * 0.4)),
      start: performance.now(),
    });

    // A few sparks off the impact, thrown into the existing pixel pool so they
    // age, fade and get cleaned up by the same code as every other particle.
    // Kept sparse on purpose - the bolt is the effect, and a fountain of debris
    // underneath it is what tipped the whole thing from a strike into a firework.
    const sparks = 3 + Math.floor(Math.random() * 3);
    const sparkColor = `rgb(${lighten(er, 0.45)}, ${lighten(eg, 0.45)}, ${lighten(eb, 0.45)})`;
    for (let i = 0; i < sparks; i++) {
      const dir = (Math.random() - 0.5) * Math.PI;
      const speed = 30 + Math.random() * 45;
      this.flamePixels.push({
        x: tx + (Math.random() - 0.5) * w,
        y: ty + Math.random() * (target.h || 16) * 0.4,
        vx: Math.sin(dir) * speed,
        vy: -Math.abs(Math.cos(dir)) * speed * 0.8,
        size: Math.max(1, cell * (0.5 + Math.random() * 0.5)),
        color: sparkColor,
        alpha: 1,
        start: performance.now(),
      });
    }
  },

  // Fractal midpoint displacement: start with the straight line from the sky to
  // the caret, then repeatedly split every segment and shove the new midpoint
  // sideways by a shrinking random amount. Displacement is across the segment
  // rather than in a fixed axis, so the jaggedness looks the same whatever
  // angle the bolt comes in at.
  boltPath(this: CursorSmithPlugin, x0: number, y0: number, x1: number, y1: number, jitter: number) {
    let pts = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
    let amp = jitter;
    for (let pass = 0; pass < THUNDER_PASSES; pass++) {
      const next = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = (Math.random() - 0.5) * 2 * amp;
        next.push({ x: (a.x + b.x) / 2 + (-dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off });
        next.push(b);
      }
      pts = next;
      // Halve-ish per pass: finer splits get finer wobble, which is what makes
      // the result read as one crooked channel rather than as noise.
      amp *= 0.55;
    }
    return pts;
  },

  // Stamp a polyline onto a fixed grid so the bolt is built from aligned blocks
  // instead of a smooth stroke - the same chunky look as the rest of the
  // plugin's pixel work, and the reason this is a Pixel Trail sub-option.
  //
  // Deduped, and that matters: a near-horizontal run lands in the same cell
  // dozens of times, and every restamp of a semi-transparent block compounds
  // into a bright blob exactly where the bolt should be at its thinnest.
  //
  // `seen` is passed in by the caller and shared between the trunk and its
  // forks: a fork that crosses back over the channel it came from would
  // otherwise restamp those cells, and every overlapping block compounds in the
  // halo pass into a bright knot right where the two should simply meet.
  // Each block also records `t`, its position along the ramp: t0 at the start of
  // this path and t1 at the end. The trunk spans the whole ramp; a fork spans
  // only the part of it from where the fork branched off.
  pixelateBolt(this: CursorSmithPlugin, pts: Pt[], cell: number, seen: Set<string>, t0: number, t1: number) {
    const out = [];
    const segs = pts.length - 1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      // Sub-cell stepping: at exactly one step per cell width a diagonal run
      // skips cells and the channel comes out dotted.
      const steps = Math.max(1, Math.ceil(dist / (cell * 0.7)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const gx = Math.round((a.x + (b.x - a.x) * t) / cell) * cell;
        const gy = Math.round((a.y + (b.y - a.y) * t) / cell) * cell;
        const key = gx + "," + gy;
        if (seen.has(key)) continue;
        seen.add(key);
        // Position along the path by segment index, not by distance: the
        // segments are near enough equal length after midpoint displacement,
        // and measuring true arc length would mean a second pass over the
        // whole path for a difference nobody can see in a 14-band ramp.
        out.push({ x: gx, y: gy, t: t0 + ((i - 1 + t) / segs) * (t1 - t0) });
      }
    }
    return out;
  },

  drawThunderbolts(this: CursorSmithPlugin) {
    if (!this.thunderbolts.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const strength = Math.max(0.1, Math.min(1, this.look.thunderstrikeStrength ?? 0.5));
    const halo = !!this.look.glow;

    this.thunderbolts = this.thunderbolts.filter((b) => {
      const t = (now - b.start) / THUNDER_LIFE_MS;
      if (t >= 1) return false;

      // Full brightness through the strike itself, then a decay - times the
      // strobe rolled at spawn, and the user's Strength.
      const fade = t < 0.12 ? 1 : 1 - (t - 0.12) / 0.88;
      const step = Math.min(b.flicker.length - 1, Math.floor(t * b.flicker.length));
      const alpha = Math.max(0, fade * b.flicker[step] * opacity * strength);
      // Still alive, just in a dark phase of the strobe - keep it in the list.
      if (alpha <= 0.02) return true;

      const cell = b.cell;
      ctx.save();

      // Two passes over the bands rather than one pass doing halo-then-core per
      // band: the halo of a band further down the bolt would otherwise wash
      // over the core of the band above it, and the ramp would come out muddy
      // exactly where two colours meet.
      //
      // The halo is oversized dim blocks rather than shadowBlur: a real blur on
      // several hundred rects is the single most expensive thing this file
      // could do per frame, and at this size it isn't distinguishable from the
      // cheap version.
      if (halo) {
        const pad = Math.max(1, cell * 0.75);
        for (const band of b.bands) {
          ctx.fillStyle = `rgba(${band.r}, ${band.g}, ${band.b}, ${alpha * 0.16})`;
          for (const c of band.cells) ctx.fillRect(c.x - pad, c.y - pad, cell + pad * 2, cell + pad * 2);
        }
      }
      for (const band of b.bands) {
        ctx.fillStyle = `rgba(${band.cr}, ${band.cg}, ${band.cb}, ${alpha})`;
        for (const c of band.cells) ctx.fillRect(c.x, c.y, cell, cell);
      }

      // The hit: a block flaring at the caret and shrinking away over the first
      // part of the strike, so the bolt visibly lands instead of just stopping.
      const flash = 1 - Math.min(1, t / 0.4);
      if (flash > 0) {
        const size = b.flash * (0.5 + flash);
        ctx.fillStyle = `rgba(${lighten(b.er, 0.45)}, ${lighten(b.eg, 0.45)}, ${lighten(b.eb, 0.45)}, ${alpha * flash * 0.4})`;
        ctx.fillRect(b.tx - size / 2, b.ty - size / 2, size, size);
      }
      ctx.restore();

      // One box for the whole bolt: the cells are a thin diagonal thread, but
      // marking each one separately would mean hundreds of damage rects per
      // frame to clear a region the cursor's own box already nearly covers.
      const pad = Math.max(8, cell * 3) + b.flash;
      this._markDirty(
        b.minX - pad, b.minY - pad,
        (b.maxX - b.minX) + cell + pad * 2,
        (b.maxY - b.minY) + cell + pad * 2,
      );
      return true;
    });
  },
};
