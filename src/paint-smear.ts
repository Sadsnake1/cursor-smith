// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The motion smear: a two-point quad (a sprung leading point, a lagging
// trailing one; HANDOFF §2), its cap, its conserved volume and its taper,
// the corners to paint through, and its term in the draw signature.

import {
  SMEAR_LEAD_BOOST_CAP,
  SMEAR_SETTLE_V,
  SMEAR_VOLUME_MIN_FACTOR,
  TAPER_FULL_LAG,
  TAPER_MIN_LAG,
} from "./constants";
import type { Pt, Quad, QuadKey, Rect, SmearQuad } from "./types";
import type CursorSmithPlugin from "./plugin";

export const paintSmearMethods = {
  updateSmearQuad(this: CursorSmithPlugin) {
    const now = performance.now();
    // Two separate clocks, deliberately. _smearDtT is the frame delta for the
    // spring integrator and must advance every single call. smearQuadLastMoveT
    // is the last time the quad was genuinely in motion, and is what the frame
    // governor ages out against. These used to be one variable, which meant
    // the governor's `now - smearQuadLastT < 1200` test was comparing now
    // against a timestamp set microseconds earlier in the same frame - always
    // true, so an enabled smear latched the hot gear on forever.
    //
    // Do not "fix" that by making the delta clock conditional: a stale delta
    // clamps to 0.05, and the spring is explicit Euler that only stays stable
    // while dt < 2/freq (~0.05 at the maximum stiffness of 40). The first
    // frame after a wake would integrate right at the stability boundary and
    // visibly jolt.
    if (!this._smearDtT) this._smearDtT = now;
    let dt = (now - this._smearDtT) / 1000;
    this._smearDtT = now;
    dt = Math.min(dt, 0.05);

    const settings = this.look;
    const rect = settings.smear ? this.getActiveRect() : null;

    if (!rect) {
      this.smearQuad = null;
      this.smearShape = null;
      this.smearCenterPrev = null;
      this._smearLead = null;
      this._smearTrail = null;
      this._smearMoving = false;
      return;
    }

    // The quad is the caret swept along its travel: a leading face and a
    // trailing face, each the caret's own rectangle, and the four corners
    // between them. It is built from TWO tracked points - where the leading
    // face's origin is and where the trailing face's is - and every corner
    // is an affine blend of the two by how much of it trails (`rear`, below).
    // A parallelogram by construction, in every frame, whatever the two
    // points are doing: four independent corner springs were eight degrees
    // of freedom for a two-degree shape, and the surplus was where the
    // warping lived (HANDOFF §2 - five patches that each tried to constrain
    // it after the fact, and this is the shape they were approximating).
    //
    // The leading point is a spring (Stiffness, Damping - it may overshoot
    // and snap back, which is the feel). The trailing point is a first-order
    // lag behind the leading one (Trailing stiffness): no state but its
    // position, so it can neither rotate nor boomerang, and it settles as
    // the leading point does. The three sliders keep their meaning.
    const target = { x: rect.x, y: rect.y };
    const offsets = { tl: { x: 0, y: 0 }, tr: { x: rect.w, y: 0 }, br: { x: rect.w, y: rect.h }, bl: { x: 0, y: rect.h } };

    if (!this.smearQuad || !this._smearLead || !this._smearTrail) {
      this._smearLead = { x: target.x, y: target.y, vx: 0, vy: 0 };
      this._smearTrail = { x: target.x, y: target.y };
      this.smearQuad = {} as SmearQuad;
      for (const key of Object.keys(offsets) as QuadKey[]) {
        this.smearQuad[key] = { x: target.x + offsets[key].x, y: target.y + offsets[key].y, vx: 0, vy: 0 };
      }
      this.smearCenterPrev = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      this.smearShape = this.smearQuad;
      this._smearMoving = false;
      return;
    }

    // Settled: the two points and every corner sit exactly on the target
    // (the snap at the bottom put them there), the painted shape is the quad
    // itself, and the target has not moved. Everything below is then the
    // identity - no force on the spring, no gap for the trailing point to
    // close, a taper and a volume pass that hand the quad straight back - so
    // it is skipped; the frame clock above still advanced. It was 0.04 ms of
    // every idle tick, measured, for a caret sitting still.
    {
      const lead = this._smearLead, trail = this._smearTrail, q = this.smearQuad;
      if (!this._smearMoving && this.smearShape === q &&
          lead.x === target.x && lead.y === target.y && lead.vx === 0 && lead.vy === 0 &&
          trail.x === target.x && trail.y === target.y &&
          q.tl.x === target.x && q.tl.y === target.y &&
          q.tr.x === target.x + rect.w && q.tr.y === target.y &&
          q.br.x === target.x + rect.w && q.br.y === target.y + rect.h &&
          q.bl.x === target.x && q.bl.y === target.y + rect.h) {
        return;
      }
    }

    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    let dirX = 0, dirY = 0;
    if (this.smearCenterPrev) {
      dirX = center.x - this.smearCenterPrev.x;
      dirY = center.y - this.smearCenterPrev.y;
    }
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen > 0.01) {
      // Held past the frame it was measured on: once the caret stops, the quad
      // spends several more frames catching up, and the tail has to keep
      // pointing back the way it came while it does.
      this._smearDir = { x: dirX / dirLen, y: dirY / dirLen };
    }
    this.smearCenterPrev = center;

    // Motion Smear sits DOWNSTREAM of Smooth Movement: this spring chases
    // getActiveRect(), which is built from animActive - itself still catching up
    // to the real caret. The two lags ADD, so with both effects on the painted
    // cursor trails further behind than the Smooth Movement sliders alone
    // suggest, and Max Catch-Up Speed looked broken: it was only ever speeding
    // up the first of the two stages, while the second stayed as slow as it had
    // always been. Carrying the same boost through fixes that.
    //
    // Only the LEADING point gets it. The smear you see is the gap between the
    // leading and trailing edges, so boosting both would fix the lag by
    // deleting the effect; boosting just the front means the cursor keeps up
    // AND smears harder, which is the right answer for both.
    //
    // Capped: the boost can reach ~13x on extreme slider combinations, and past
    // about 6x the leading edge is already arriving within a frame or two - the
    // rest buys nothing and only eats into the explicit integrator's stability
    // margin (stable while h < 2/freq, and h is held at or under 1/240 below).
    const leadBoost = settings.smoothEnabled
      ? Math.max(1, Math.min(SMEAR_LEAD_BOOST_CAP, this._catchUpBoost || 1))
      : 1;
    const freqLead = (2 + Math.max(0, Math.min(1, settings.smearStiffness)) * 38) * leadBoost;
    const freqTrail = 2 + Math.max(0, Math.min(1, settings.smearTrailingStiffness)) * 38;
    const dampingRatio = 0.15 + Math.max(0, Math.min(1, settings.smearDamping)) * 1.15;

    // Integrate on a fixed sub-step instead of the raw frame delta. This is
    // semi-implicit Euler, stable only while dt < 2/freq; freq reaches 40, so
    // the limit is dt = 0.05 - which is exactly the clamp above, and exactly
    // what the idle gear's heartbeat delivers. That made the spring's behaviour
    // depend on the gear while the gear depended on whether the spring was
    // moving: a closed feedback loop that kicked a settled quad back into
    // motion on every idle frame, flipping the gear thousands of times a
    // minute and cycling the GPU up and down on a completely idle editor.
    // A fixed sub-step makes the spring frame-rate independent, so it behaves
    // identically in every gear and at every display refresh rate.
    const MAX_STEP = 1 / 240;
    const steps = Math.max(1, Math.min(16, Math.ceil(dt / MAX_STEP)));
    const h = dt / steps;

    const lead = this._smearLead;
    const trail = this._smearTrail;
    const k = freqLead * freqLead;
    const damp = 2 * dampingRatio * freqLead;
    for (let i = 0; i < steps; i++) {
      const ax = k * (target.x - lead.x) - damp * lead.vx;
      const ay = k * (target.y - lead.y) - damp * lead.vy;
      lead.vx += ax * h;
      lead.vy += ay * h;
      lead.x += lead.vx * h;
      lead.y += lead.vy * h;
      // The trailing point: an exponential approach to the leading one,
      // unconditionally stable at any step.
      const f = 1 - Math.exp(-freqTrail * h);
      trail.x += (lead.x - trail.x) * f;
      trail.y += (lead.y - trail.y) * f;
    }
    if (!isFinite(lead.x) || !isFinite(lead.y) || !isFinite(lead.vx) || !isFinite(lead.vy) || !isFinite(trail.x) || !isFinite(trail.y)) {
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
    }
    // Max length caps how far the tail trails the head, in the state, so
    // the tail arrives sooner rather than just being drawn shorter.
    this.applySmearMaxLength(rect);

    // Which corners lead and which trail, and by how much. The rear FACE of
    // the rectangle trails, the front face leads; which face is the rear one
    // is decided by the area each face sweeps - the side faces sweep h*|dx|,
    // the top and bottom w*|dy| - and blended between the two by their share
    // (to the fourth power, so one clearly dominant axis wins outright and a
    // 3px-tall underline keeps square ends at a shallow angle), never by a
    // branch. The old rule projected each corner's offset as a unit vector
    // onto the travel, which for a stem is decided by the vertical component:
    // below atan(w/h) the caret sheared, above it the top corners trailed
    // and the bottom ones led - a rotation - and it snapped between the two.
    // The direction is the HELD one: once the caret stops, the fresh delta is
    // zero and the tail must keep pointing back the way it came while the
    // trailing point catches up.
    const dir = this._smearDir;
    const ax = dir ? Math.abs(dir.x) : 0, ay = dir ? Math.abs(dir.y) : 0;
    const hx = (rect.h * ax) ** 4, wy = (rect.w * ay) ** 4;
    const u = hx + wy > 0 ? hx / (hx + wy) : 0.5;
    const sgnX = dir ? Math.sign(dir.x) : 0, sgnY = dir ? Math.sign(dir.y) : 0;
    // The trailing point's velocity, for the corners' velocities (the taper
    // and the governor read them): the rate it closes on the leading point.
    const tvx = (lead.x - trail.x) * freqTrail, tvy = (lead.y - trail.y) * freqTrail;
    let moving = false;
    for (const key of Object.keys(offsets) as QuadKey[]) {
      const o = offsets[key];
      const sx = o.x > 0 ? 1 : -1;
      const sy = o.y > 0 ? 1 : -1;
      // +1 on the front face (the corner's offset points along the travel),
      // -1 on the rear face, between on a diagonal.
      const front = dir ? sx * sgnX * u + sy * sgnY * (1 - u) : 0;
      // 0 = at the leading point, 1 = at the trailing one.
      const f = (1 - front) / 2;
      const c = this.smearQuad[key];
      c.x = lead.x + (trail.x - lead.x) * f + o.x;
      c.y = lead.y + (trail.y - lead.y) * f + o.y;
      c.vx = lead.vx + (tvx - lead.vx) * f;
      c.vy = lead.vy + (tvy - lead.vy) * f;
      const tx = target.x + o.x, ty = target.y + o.y;
      // A corner still off its target by more than the half-pixel the draw
      // signature can see, or moving fast enough to be that far off by the
      // next frame (SMEAR_SETTLE_V), means the quad is visibly deforming
      // and the loop must keep drawing. Anything under that is snapped
      // below, so the spring cannot creep back into motion.
      if (Math.abs(c.x - tx) > 0.5 || Math.abs(c.y - ty) > 0.5 || Math.abs(c.vx) > SMEAR_SETTLE_V || Math.abs(c.vy) > SMEAR_SETTLE_V) moving = true;
    }

    this._smearMoving = moving;

    this.applySmearTaper({
      tl: { x: rect.x, y: rect.y }, tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h }, bl: { x: rect.x, y: rect.y + rect.h },
    }, center);
    this.applySmearVolume({
      tl: { x: rect.x, y: rect.y }, tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h }, bl: { x: rect.x, y: rect.y + rect.h },
    }, rect);
    if (moving) {
      this.smearQuadLastMoveT = now;
    } else {
      // Snap exactly onto the targets once settled, and kill the residual
      // velocity. Without this the quad keeps a sub-threshold offset that the
      // next long idle frame re-amplifies into visible motion. Mirrors what
      // updateSmoothCursor does for the caret itself.
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
      for (const key of Object.keys(offsets) as QuadKey[]) {
        const c = this.smearQuad[key];
        c.x = target.x + offsets[key].x;
        c.y = target.y + offsets[key].y;
        c.vx = 0;
        c.vy = 0;
      }
    }
  },

  // Cap how far the tail trails the caret. A page-down or a click across the
  // pane otherwise stretches the quad the whole way - a streak the height of
  // the pane that then takes its time contracting. With a cap, no corner may
  // lag its own target by more than the cap: a corner further out is pulled
  // in along its own line of travel until it is exactly the cap behind. The
  // caret keeps its shape - the leading corners are at their targets, the
  // trailing ones the cap behind them - and the taper does its own job on
  // what is left. This is written into the spring's STATE, deliberately:
  // the tail is meant to arrive sooner, not just to be drawn shorter.
  //
  // Not smear-cursor.nvim's version, which scales every corner toward the
  // one nearest its target: on a 9x24 box that collapses the tail to a point
  // at that corner's height, and the smear read as tapered the wrong way
  // round, narrow at the front (1.5.4, seen live).
  applySmearMaxLength(this: CursorSmithPlugin, rect: Rect) {
    const cap = this.look.smearMaxLength;
    const lead = this._smearLead, trail = this._smearTrail;
    if (!lead || !trail || !(cap > 0)) return;
    // The two tracked points, each at most `cap` from the target: the
    // corners are derived from them, so every corner's lag is capped with
    // them and the tail keeps the caret's full height.
    for (const p of [lead, trail]) {
      const dx = p.x - rect.x, dy = p.y - rect.y;
      const d = Math.hypot(dx, dy);
      if (d <= cap) continue;
      const f = cap / d;
      p.x = rect.x + dx * f;
      p.y = rect.y + dy * f;
    }
    // Velocity that was carrying the leading point further out is spent
    // against the cap; what remains is the part along the pull back in.
    // Without this the spring keeps throwing it past the cap every frame
    // and it sits there jittering instead of trailing cleanly.
    const dx = lead.x - rect.x, dy = lead.y - rect.y;
    const d = Math.hypot(dx, dy);
    if (d >= cap - 1e-9 && d > 0) {
      const away = (lead.vx * dx + lead.vy * dy) / d;
      if (away > 0) { lead.vx -= (dx / d) * away; lead.vy -= (dy / d) * away; }
    }
  },

  // Conserve the smear's area: a long streak gets thin. The quad's area is
  // compared with the caret's resting area and every corner is pulled toward
  // the centre ACROSS its own direction of travel by (rest / area) to the
  // strength, floored at SMEAR_VOLUME_MIN_FACTOR - so the stretch along the
  // move is untouched and only the width across it gives. After
  // smear-cursor.nvim's shrink_volume, with one change: the pull is weighted
  // by each corner's share of the lag, as the taper's is, so the leading
  // edge - the caret itself - keeps its full size and only the tail thins.
  // Their cursor IS the smear; ours has a caret at the front of it.
  //
  // Skipped on an axis-aligned move. A horizontal smear is a rectangle that
  // is wider than the caret, so conserving its area would thin the caret's
  // height while you type - the effect is for the diagonal streak of a
  // jump, where the parallelogram sweeps far more area than the caret has.
  //
  // Like the taper, this derives the painted corners and is never written
  // back into smearQuad: the spring integrates forward from its own state.
  applySmearVolume(this: CursorSmithPlugin, targets: Quad, rect: Rect) {
    const shape = this.smearShape;
    const strength = Math.max(0, Math.min(1, this.look.smearVolumeStrength ?? 0.3));
    if (!shape || !this.look.smearConserveVolume || strength <= 0) return;
    const cx = (shape.tl.x + shape.tr.x + shape.br.x + shape.bl.x) / 4;
    const cy = (shape.tl.y + shape.tr.y + shape.br.y + shape.bl.y) / 4;
    const tx = rect.x + rect.w / 2, ty = rect.y + rect.h / 2;
    // Axis-aligned: the centre has not moved off the target's row or column.
    if (Math.abs(tx - cx) < 1 || Math.abs(ty - cy) < 1) return;
    // Shoelace, over tl -> tr -> br -> bl.
    const pts = [shape.tl, shape.tr, shape.br, shape.bl];
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      area2 += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(area2) / 2;
    const rest = rect.w * rect.h;
    if (!(area > rest) || !(rest > 0)) return;
    const factor = Math.max(SMEAR_VOLUME_MIN_FACTOR, Math.pow(rest / area, strength / 2));
    if (factor >= 0.999) return;

    if (!this._volumeBuf) {
      this._volumeBuf = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    }
    const out = this._volumeBuf;
    let maxLag = 0;
    const lag: Record<string, number> = {};
    for (const k of Object.keys(targets) as QuadKey[]) {
      lag[k] = Math.hypot(targets[k].x - shape[k].x, targets[k].y - shape[k].y);
      if (lag[k] > maxLag) maxLag = lag[k];
    }
    if (maxLag < 0.01) return;
    for (const k of Object.keys(targets) as QuadKey[]) {
      const c = shape[k];
      // The corner's own direction of travel, and the normal to it.
      const mx = targets[k].x - c.x, my = targets[k].y - c.y;
      const ml = lag[k];
      if (ml < 0.01) { out[k].x = c.x; out[k].y = c.y; continue; }
      const nx = -my / ml, ny = mx / ml;
      // How far the corner sits from the centre across that direction.
      const proj = (c.x - cx) * nx + (c.y - cy) * ny;
      const shift = proj * (1 - factor) * (ml / maxLag);
      out[k].x = c.x - nx * shift;
      out[k].y = c.y - ny * shift;
    }
    this.smearShape = out;
  },

  // Derive the corners to PAINT from the corners the spring is holding.
  //
  // With Tapered Trail off this is just the quad itself, passed straight
  // through by reference - no copy, no work. With it on, the trailing end is
  // pulled in toward the line of travel so the smear comes to a point behind
  // the caret instead of dragging a full-width rectangle.
  //
  // The result is deliberately NOT written back into smearQuad. That object is
  // the spring's state, integrated forward from its own previous position: a
  // tapered corner stored there would become the position the next frame
  // springs from, so the corners would chase the narrowed shape and the taper
  // would eat the very lag it is drawn from. Derived fresh each frame and
  // thrown away.
  applySmearTaper(this: CursorSmithPlugin, targets: Quad, center: Pt) {
    const q = this.smearQuad;
    const amount = Math.max(0, Math.min(1, this.look.smearTaperAmount ?? 0.7));
    const dir = this._smearDir;
    if (!q || !this.look.smearTaper || amount <= 0 || !dir) {
      this.smearShape = q;
      return;
    }

    // How far each corner is lagging behind where it belongs. Corners at the
    // back of the move lag most and the ones at the front barely at all, which
    // is exactly the weighting a taper wants - the tail narrows, the leading
    // edge keeps its full width - so there's no need to work out which corner
    // is which, or to special-case diagonal movement.
    let maxLag = 0;
    const lag: Record<string, number> = {};
    for (const k of Object.keys(targets) as QuadKey[]) {
      const l = Math.hypot(q[k].x - targets[k].x, q[k].y - targets[k].y);
      lag[k] = l;
      if (l > maxLag) maxLag = l;
    }

    // Ramp the whole effect across the [MIN_LAG, FULL_LAG] band, zero below the
    // floor. The ratio between corners alone is ~1 for the laggiest corner no
    // matter how small the lag is, so without this a caret creeping one glyph
    // sideways would wear the same sharp point as one flung across the page -
    // and a resting cursor would sit there permanently misshapen. The floor is
    // what keeps the taper off during ordinary typing (see TAPER_MIN_LAG).
    const reach = Math.max(0, Math.min(1, (maxLag - TAPER_MIN_LAG) / (TAPER_FULL_LAG - TAPER_MIN_LAG)));
    if (reach <= 0.001) {
      this.smearShape = q;
      return;
    }

    // One reused buffer rather than four fresh objects per frame: this runs on
    // every frame of every move, and the corners are read and discarded within
    // the same frame.
    if (!this._taperBuf) {
      this._taperBuf = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    }
    const out = this._taperBuf;

    for (const k of Object.keys(targets) as QuadKey[]) {
      const c = q[k];
      const ox = c.x - center.x;
      const oy = c.y - center.y;
      // The part of the corner's offset that runs ACROSS the direction of
      // travel. Pulling it to zero puts the corner on the line of travel, so
      // pulling both trailing corners to zero closes that end to a point.
      const along = ox * dir.x + oy * dir.y;
      const px = ox - along * dir.x;
      const py = oy - along * dir.y;
      const w = (lag[k] / maxLag) * reach * amount;
      out[k].x = c.x - px * w;
      out[k].y = c.y - py * w;
    }
    this.smearShape = out;
  },

  // The four corners to paint the cursor through, or null when Motion Smear is
  // off and callers should use the plain caret rect instead.
  smearCorners(this: CursorSmithPlugin): Quad | null {
    if (!this.look.smear) return null;
    return this.smearShape || this.smearQuad;
  },

  // The painted quad reduced to a short string, for the draw-skip signature.
  // See the call site for why the quad has to be in that signature at all.
  _smearSig(this: CursorSmithPlugin) {
    const q = this.look.smear ? this.smearCorners() : null;
    if (!q) return "nosmear";
    let s = "";
    for (const k of ["tl", "tr", "br", "bl"] as const) {
      const c = q[k];
      if (!c) return "nosmear";
      s += Math.round(c.x * 2) + ":" + Math.round(c.y * 2) + ",";
    }
    return s;
  },
};
