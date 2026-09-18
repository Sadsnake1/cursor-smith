// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pixels: the pixel trail thrown from where the caret was, the streak
// laid along a jump, and the stardust that drifts up or orbits while the
// caret rests.

import { hslToRgbTuple } from "./color";
import {
  JUMP_TRAIL_MAX_PUFFS,
  JUMP_TRAIL_MIN_DIST,
  JUMP_TRAIL_STEP,
  STARDUST_MAX_PER_CARET,
} from "./constants";
import type { CaretRecord, StardustMote } from "./types";
import type CursorSmithPlugin from "./plugin";

export const effectsDustMethods = {
  // The colour for one trail pixel, as an "rgb(...)" string.
  //
  // Normally every pixel in a burst is a small random nudge off the flat cursor
  // colour. When Gradient Colours is on AND a gradient is active, each pixel
  // instead samples a RANDOM point along the cursor's gradient, so a burst comes
  // out multi-hued - the same trick Stardust uses via sampleRamp - and then gets
  // the same small nudge on top for grain. `disintegrate` inverts the result so
  // the deletion burst keeps its "wrong colour" look whichever mode is on.
  //
  // `baseRGB` is the pre-computed [r,g,b] of the flat path (already inverted for
  // disintegrate by the caller), passed in so the common case doesn't re-parse
  // the hex for every pixel.
  //
  // `forceBase` makes that base authoritative and skips the gradient sample
  // entirely. It's set when Pop Effects' Rainbow is driving a deletion burst:
  // Rainbow outranks Gradient throughout Pop Effects, and without this the
  // gradient branch would quietly win for anyone running both.
  flamePixelColor(this: CursorSmithPlugin, baseRGB: number[], disintegrate: boolean, forceBase = false): string {
    let r, g, b;
    if (!forceBase && this.look.flameTrailGradientColors && this.look.gradientEnabled) {
      [r, g, b] = this.sampleRamp(Math.random());
      if (disintegrate) { r = 255 - r; g = 255 - g; b = 255 - b; }
    } else {
      [r, g, b] = baseRGB;
    }
    // A little per-pixel nuance so even same-stop pixels aren't identical.
    const varR = Math.max(0, Math.min(255, Math.round(r + (Math.random() - 0.5) * 70)));
    const varG = Math.max(0, Math.min(255, Math.round(g + (Math.random() - 0.5) * 70)));
    const varB = Math.max(0, Math.min(255, Math.round(b + (Math.random() - 0.5) * 70)));
    return `rgb(${varR}, ${varG}, ${varB})`;
  },

  spawnFlamePixels(this: CursorSmithPlugin, anchor: CaretRecord, disintegrate: boolean = false) {
    // Pixel Trail gates the AMBIENT trail only. Backspace Disintegration is a
    // Pop Effects option now, with its own gate checked by the caller, so a
    // deletion burst still fires with the trail switched off. The two share
    // this function because the burst has always been the same particle system
    // running backwards - not because one depends on the other.
    //
    // Note what a disintegration burst with the trail off inherits: pixel
    // lifetime, pixel size and gravity are all Pixel Trail settings, and their
    // sliders are hidden while the trail is off. The saved values still apply,
    // which keeps the burst identical for anyone who had both on; it does mean
    // those three dials are only reachable by switching the trail back on.
    if (!disintegrate && !this.look.flameTrail) return;

    // Density scales the whole burst. At 0 the trail emits nothing.
    // Disintegration is exempt from a 0 density: pressing Backspace is an
    // explicit request for the burst, not the ambient trail, so it still fires
    // (at the normal amount) even with the trail turned down to nothing - and
    // now, with the trail off altogether.
    const density = Math.max(0, this.look.flameTrailDensity ?? 1);
    if (density <= 0 && !disintegrate) return;

    // Disintegration bursts get a few more particles and a stronger scatter
    // so deletion feels heavier than a normal cursor move.
    const baseCount = disintegrate
      ? Math.floor(10 + Math.random() * 8)
      : Math.floor(6 + Math.random() * 6);
    // Disintegration keeps its own weight; only the ambient trail is scaled.
    const count = disintegrate ? baseCount : Math.round(baseCount * density);
    if (count <= 0) return;

    // Lifetime in seconds, read once for the whole burst. drawFlamePixels ages
    // each particle against its own stored life, so the pool can hold particles
    // of different lifetimes at once (e.g. a long trail plus short spark debris).
    const lifeSec = Math.max(0.05, (this.look.flameTrailLifeMs ?? 400) / 1000);

    let baseHex = this.getActiveColor() || "#39ff14";
    let h = baseHex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    let r = (parseInt(h, 16) >> 16) & 255;
    let g = (parseInt(h, 16) >> 8) & 255;
    let b = parseInt(h, 16) & 255;
    // Pop Effects' Rainbow reaches the deletion burst - Backspace
    // Disintegration is a pop effect now, and Rainbow governs the whole group -
    // but deliberately NOT the ambient trail, which belongs to Pixel Trail and
    // keeps the cursor's own colour. That's why this is gated on `disintegrate`
    // rather than applied to every burst this function makes.
    //
    // The hue replaces the cursor colour as the base and is then inverted like
    // any other base below, so the burst keeps its "wrong colour" reading while
    // still stepping through the sweep - one step per deletion, shared with the
    // letters, bolts and fireworks either side of it.
    const popRainbow = disintegrate
      && !!this.look.popEffects
      && !!this.look.popRainbow;
    if (popRainbow) {
      [r, g, b] = hslToRgbTuple(this.nextRainbowHue(), 0.85, 0.6);
    }
    // Colour inversion: photographic negative of the cursor colour. Gives
    // a distinct "wrong colour" flash that reads as destruction against
    // any theme, without needing a separate configurable colour.
    if (disintegrate) {
      r = 255 - r; g = 255 - g; b = 255 - b;
    }
    // The flat-path base for flamePixelColor; ignored when Gradient Colours
    // samples the ramp instead - unless Rainbow is driving, which outranks the
    // gradient everywhere else in Pop Effects and does so here too.
    const baseRGB = [r, g, b];
    // Pixel size, scaled from the setting. The 0.65 + rand·0.7 spread keeps the
    // same variation the trail always had (default base 4 → ~2.6-5.4px, the
    // original 2.5 + rand·3 range) while letting the slider grow or shrink it.
    const pxBase = Math.max(1, this.look.flameTrailPixelSize ?? 4);

    // Anchor centre - disintegration particles fly *outward from* this
    // point (with an extra outward bias on their velocity), while normal
    // flame pixels stay near where they spawn and drift sideways.
    const anchorW = anchor.w || anchor.actualCharWidth || 8;
    const cx = anchor.x + anchorW / 2;
    const cy = anchor.top + anchor.h / 2;

    for (let i = 0; i < count; i++) {
      const pX = anchor.x + Math.random() * anchorW;
      const pY = anchor.top + Math.random() * anchor.h;
      const color = this.flamePixelColor(baseRGB, disintegrate, popRainbow);

      let vx, vy;
      if (disintegrate) {
        // Radial explosion from the deleted char's centre. Normalise the
        // offset vector so particles at the edge don't fly out much
        // faster than ones near the middle, then scale up to ~2-3x the
        // normal drift so the burst reads as violent rather than gentle.
        const dx = pX - cx;
        const dy = pY - cy;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 30 + Math.random() * 25;
        vx = (dx / len) * speed;
        vy = (dy / len) * speed - 10; // slight upward bias, like debris
      } else {
        vx = (Math.random() - 0.5) * 20;
        vy = 0;
      }

      this.flamePixels.push({
        x: pX,
        y: pY,
        vx,
        vy,
        size: pxBase * (0.65 + Math.random() * 0.7),
        color,
        alpha: 1,
        start: performance.now(),
        // Per-particle lifetime (drawFlamePixels reads this instead of a
        // hardcoded constant), plus a marker so the gravity physics applies
        // ONLY to Pixel Trail particles and leaves Speed Demon sparks and
        // Thunderstrike debris - which share this pool - moving as before.
        life: lifeSec,
        trail: true,
      });
    }
  },

  spawnJumpTrail(this: CursorSmithPlugin, from: CaretRecord, to: CaretRecord) {
    if (!this.look.flameTrail || !from || !to) return;
    const density = Math.max(0, this.look.flameTrailDensity ?? 1);
    if (density <= 0) return;

    const fw = from.w || from.actualCharWidth || 8;
    const tw = to.w || to.actualCharWidth || 8;
    const x0 = from.x + fw / 2, y0 = from.top + (from.h || 16) / 2;
    const x1 = to.x + tw / 2, y1 = to.top + (to.h || 16) / 2;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < JUMP_TRAIL_MIN_DIST) return;

    // Number of intermediate puffs, spaced every JUMP_TRAIL_STEP px and capped.
    // The endpoints are skipped: the origin already got its puff from the normal
    // spawn, and the destination is where the caret now sits (no trail there).
    const puffs = Math.min(JUMP_TRAIL_MAX_PUFFS, Math.floor(dist / JUMP_TRAIL_STEP));
    if (puffs <= 0) return;

    let baseHex = this.getActiveColor() || "#39ff14";
    let h = baseHex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const int = parseInt(h, 16);
    const baseRGB = [(int >> 16) & 255, (int >> 8) & 255, int & 255];
    const lifeSec = Math.max(0.05, (this.look.flameTrailLifeMs ?? 400) / 1000);
    const now = performance.now();

    // A couple of pixels per waypoint scaled by density - enough to read as a
    // streak without turning a long jump into a firehose even before the cap.
    const perPuff = Math.max(1, Math.round(2 * Math.min(1.5, density)));
    const lineH = ((from.h || 16) + (to.h || 16)) / 2;
    // Slightly smaller than the resting trail (× 0.8), as it was before this was
    // configurable, but scaling off the same slider.
    const pxBase = Math.max(1, this.look.flameTrailPixelSize ?? 4) * 0.8;

    for (let i = 1; i <= puffs; i++) {
      const s = i / (puffs + 1);
      const px = x0 + (x1 - x0) * s;
      const py = y0 + (y1 - y0) * s;
      for (let j = 0; j < perPuff; j++) {
        // A jump trail is never a deletion burst, so disintegrate is false: it
        // samples the gradient (when on) at full, un-inverted hue.
        const color = this.flamePixelColor(baseRGB, false);
        this.flamePixels.push({
          x: px + (Math.random() - 0.5) * 6,
          y: py + (Math.random() - 0.5) * lineH * 0.7,
          // Gentle sideways drift, same as a resting trail puff - the streak
          // should sit where the caret passed, not fly off on its own.
          vx: (Math.random() - 0.5) * 14,
          vy: 0,
          size: pxBase * (0.65 + Math.random() * 0.7),
          color,
          alpha: 1,
          start: now,
          life: lifeSec,
          trail: true,
        });
      }
    }
  },

  drawFlamePixels(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    // Only Speed Demon sparks (tagged `spark: true` when spawned) ever grow a
    // trail - Pixel Trail and backspace-disintegration particles share this
    // same pool but are untouched by the setting.
    const trailAmt = Math.max(0, this.styleFor("speedDemonSparkTrail") || 0);

    // Gravity vector, resolved once for the frame. Angle is degrees clockwise
    // from straight-down, so 0 → (0, +1). Strength 0..1 maps onto a px/s² range
    // that's gentle at the low end and a real yank at the top. Applied as a
    // closed-form ½·g·t² displacement below, which keeps particle motion
    // identical at any refresh rate - the same reason the base motion is
    // elapsed-derived rather than integrated.
    const gStrength = Math.max(0, Math.min(1, this.look.flameTrailGravity ?? 0));
    let gx = 0, gy = 0;
    if (gStrength > 0) {
      const mag = gStrength * 900; // px/s² at full strength
      const rad = ((this.look.flameTrailGravityAngle ?? 0) * Math.PI) / 180;
      gx = Math.sin(rad) * mag;
      gy = Math.cos(rad) * mag;
    }

    this.flamePixels = this.flamePixels.filter(p => {
      // Per-particle lifetime: Pixel Trail pixels carry their own `life`;
      // sparks and debris that never set one fall back to the original 0.4s.
      const life = p.life || 0.4;
      const elapsed = (now - p.start) / 1000;
      if (elapsed > life) return false;

      const t = elapsed / life;
      p.alpha = 1 - Math.pow(t, 2);

      // Closed-form path: initial drift plus the gravity displacement, which
      // keeps particle motion identical at any refresh rate. Gravity is a Pixel
      // Trail sub-option, so it only pulls on trail particles - Speed Demon
      // sparks and Thunderstrike debris share this pool but must keep their
      // original ballistic motion.
      const pgx = p.trail ? gx : 0;
      const pgy = p.trail ? gy : 0;
      const curX = p.x + p.vx * elapsed + pgx * 0.5 * elapsed * elapsed;
      const curY = p.y + p.vy * elapsed + pgy * 0.5 * elapsed * elapsed;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);

      if (p.spark && trailAmt > 0) {
        // Stretch a fading tail back along the spark's direction of travel -
        // longer and more pronounced the faster it's currently moving, so a
        // freshly-launched ember gets a proper streak while a nearly-spent
        // one only trails a little.
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const dirX = p.vx / speed;
        const dirY = p.vy / speed;
        const tailLen = trailAmt * (0.5 + Math.min(1, speed / 45) * 0.5);
        const tailX = curX - dirX * tailLen;
        const tailY = curY - dirY * tailLen;
        const lw = Math.max(1, p.size * 0.85);
        this._markDirty(
          Math.min(curX, tailX) - lw, Math.min(curY, tailY) - lw,
          Math.abs(tailX - curX) + lw * 2, Math.abs(tailY - curY) + lw * 2
        );
        const grad = ctx.createLinearGradient(curX, curY, tailX, tailY);
        grad.addColorStop(0, `rgba(${p.r}, ${p.g}, ${p.b}, 0.9)`);
        grad.addColorStop(1, `rgba(${p.r}, ${p.g}, ${p.b}, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1, p.size * 0.85);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(curX, curY);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }

      ctx.fillStyle = p.color;
      ctx.fillRect(curX, curY, p.size, p.size);
      this._markDirty(curX - 1, curY - 1, (p.size || 1) + 2, (p.size || 1) + 2);
      ctx.restore();

      return true;
    });
  },

  // ---- Stardust ----------------------------------------------------------
  // Whether the effect is switched on AND currently emitting. Split out from
  // maybeSpawnStardust() because the frame governor needs the same answer: an
  // armed-but-not-yet-emitting cursor still has to be woken often enough to
  // emit on time, or the first mote would wait out a 100ms idle heartbeat.
  stardustArmed(this: CursorSmithPlugin): boolean {
    const s = this.look;
    if (!s.stardustEnabled) return false;
    if (!this.animActive) return false;
    // Always On drops the idle condition entirely, so the cursor streams
    // while you type as well. Note this keeps the render loop off the idle
    // gear for as long as a caret exists - that's inherent to the option,
    // not a leak.
    if (s.stardustAlwaysOn) return true;
    const idleFor = performance.now() - (this._lastActivityT || 0);
    return idleFor >= Math.max(0, s.stardustDelayMs ?? 2000);
  },

  // Emit a slow stream of drifting motes from the caret while it sits idle.
  //
  // Rate-limited by wall clock rather than per frame: the governor runs this
  // at ~30fps while stardust is alive but drops to ~10fps in the gaps, so a
  // per-frame probability would quietly change density with the gear.
  maybeSpawnStardust(this: CursorSmithPlugin) {
    if (!this.stardustArmed()) return;
    // Hard ceiling on live motes. Each one is a fillRect plus a dirty-rect
    // contribution, and unlike every other particle effect here this one has
    // no natural end - it emits for as long as you leave the window alone.
    // Per caret: the pool is shared with the secondaries' motes.
    if (this.stardust.length >= STARDUST_MAX_PER_CARET * (1 + (this._secondaries ? this._secondaries.length : 0))) return;

    const now = performance.now();
    const rate = Math.max(0.1, this.look.stardustRate ?? 1);
    // ~1 mote every 320ms at rate 1: a lazy drift rather than a fountain.
    if (now - (this._lastStardustT || 0) < 320 / rate) return;
    this._lastStardustT = now;

    const active = this.animActive;
    if (!active) return;
    const anchorW = active.w || active.actualCharWidth || 8;
    // Sample the ramp at a random position so a gradient cursor sheds motes in
    // every one of its colours; with Gradient off this is the flat cursor
    // colour at every position, so behaviour is unchanged.
    const [sr, sg, sb] = this.sampleRamp(Math.random());
    const vary = (c: number) => Math.max(0, Math.min(255, Math.round(c + (Math.random() - 0.5) * 50)));

    // Orbit mode is captured per mote rather than read at draw time, so
    // flipping the toggle lets the motes already in flight finish the way they
    // started instead of every one of them snapping onto a circle at once.
    const orbit = !!this.look.stardustOrbit;
    const meanRadius = Math.max(6, this.look.stardustOrbitRadius ?? 22);

    this.stardust.push({
      // Spawn across the caret's width, biased to its upper half - the motes
      // read as coming off the cursor rather than out of the line below it.
      x: active.x + Math.random() * anchorW,
      y: active.top + Math.random() * active.h * 0.6,
      vy: -8 - Math.random() * 14,          // px/sec: slow upward drift
      sway: 2 + Math.random() * 5,          // px of horizontal wander
      swaySpeed: 0.6 + Math.random() * 0.9, // rad/sec of that wander
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 2 + Math.random() * 3,
      size: 1 + Math.random() * 1.5,
      life: 2.2 + Math.random() * 2.2,      // seconds
      color: `rgb(${vary(sr)}, ${vary(sg)}, ${vary(sb)})`,
      start: now,
      // Which caret this mote belongs to: the bundle when spawned in a
      // secondary's pass, null for the primary. An orbiting mote re-anchors
      // to its own caret every frame (drawStardust).
      owner: this._caretOwner || null,

      // --- orbit mode ---
      orbit,
      // Anchor, refreshed from the live caret every frame so the swarm follows
      // the cursor. Seeded here so a mote outliving its caret keeps circling
      // the last known spot instead of jumping to the origin.
      ax: active.x + anchorW / 2,
      ay: active.top + active.h / 2,
      radius: meanRadius * (0.55 + Math.random() * 0.75),
      // Random direction, and slower the wider the orbit, so the swarm doesn't
      // look like a rigid disc rotating as one piece. Kept deliberately
      // unhurried - a fast orbit reads as agitated rather than ambient.
      angSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.32 + Math.random() * 0.55) * (22 / meanRadius),
      wobbleSpeed: 0.5 + Math.random() * 1.2,
      // Flattened orbits read as perspective rather than as flat rings, and
      // suit a caret that's taller than it is wide.
      squash: 0.45 + Math.random() * 0.4,
    });
  },

  // Age and paint the idle motes.
  //
  // All motion is derived from `elapsed` rather than integrated per frame, the
  // same way flame pixels work, which matters more here than anywhere else in
  // the file: stardust is the one effect that routinely runs at the WARM gear
  // (~30fps) and lives for seconds, so a per-frame step would visibly change
  // both drift speed and lifetime with the gear.
  drawStardust(this: CursorSmithPlugin) {
    if (!this.stardust.length) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));

    this.stardust = this.stardust.filter((p) => {
      const elapsed = (now - p.start) / 1000;
      if (elapsed > p.life) return false;

      const t = elapsed / p.life;
      // Fade in over the first fifth, then out across the rest, so motes
      // materialise out of nothing instead of popping in at the caret.
      const envelope = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      // Slow per-mote brightness wobble: what makes a drifting dot read as a
      // star rather than a speck of dust.
      const twinkle = 0.72 + 0.28 * Math.sin(elapsed * p.twinkleSpeed + p.phase);
      const alpha = Math.max(0, envelope * twinkle * opacity);
      if (alpha <= 0.01) return true;

      if (p.orbit) {
        // Track the live caret so the swarm follows the cursor around; keep
        // the last anchor when there's no caret this frame (mid-blur, or a
        // mote outliving its caret) rather than collapsing to the origin.
        // A secondary's mote follows its own caret (see owner).
        const anchor = p.owner ? p.owner.animActive : this.animActive;
        if (anchor) {
          p.ax = anchor.x + (anchor.w || anchor.actualCharWidth || 8) / 2;
          p.ay = anchor.top + anchor.h / 2;
        }
        const ang = p.phase + elapsed * p.angSpeed;
        // Breathe the radius slightly so the ring doesn't read as a rigid wheel.
        const r = p.radius * (1 + Math.sin(elapsed * p.wobbleSpeed + p.phase) * 0.15);
        return this.paintMote(p, p.ax + Math.cos(ang) * r, p.ay + Math.sin(ang) * r * p.squash, alpha);
      }

      const curX = p.x + Math.sin(elapsed * p.swaySpeed + p.phase) * p.sway;
      const curY = p.y + p.vy * elapsed;

      return this.paintMote(p, curX, curY, alpha);
    });
  },

  // Shared tail of drawStardust for both motion modes: paint one mote and
  // report the pixels it touched.
  paintMote(this: CursorSmithPlugin, p: StardustMote, x: number, y: number, alpha: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, p.size, p.size);
    ctx.restore();
    this._markDirty(x - 1, y - 1, p.size + 2, p.size + 2);
    return true;
  },
};
