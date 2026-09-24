// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The caret's body: rounded corners, the quad tracer the solid and hollow
// styles share, the rects, the I-beam's serifs, and the two painters (Line
// and Underline through drawGenericCaret, Box through drawBoxCursor).

import { readableGlyphColor } from "./color";
import {
  ROUNDED_BLOCK_FRACTION,
  ROUNDED_THIN_PX,
  SERIF_HEIGHT_RATIO,
  SERIF_MAX_SPAN_RATIO,
  SERIF_MIN_SPAN_PX,
  SERIF_STEM_RATIO,
  SERIF_TAPER,
  TRANSLUCENT_ALPHA,
} from "./constants";
import type { CaretRecord, Pt, Quad } from "./types";
import type CursorSmithPlugin from "./plugin";

export const paintShapeMethods = {
  // The corner radius for a shape whose narrow axis is `minor` px.
  //
  // Rounding is a toggle, not a dial, so this decides the radius - and it is
  // deliberately NOT one constant. "Rounded" means different things for a
  // 3px Line stem and a 8x24 Box: a quarter of the minor axis is a pleasant
  // soft corner on a block and invisible on a bar, while a full capsule is
  // right for a bar and turns a block into a stadium. So thin shapes (the
  // Line stem, the Underline bar, serifs) go fully round and blocks get the
  // softer quarter.
  //
  // ROUNDED_THIN_PX is the width below which a shape reads as a bar rather
  // than a block. Anything at or under it is basically all edge, so there is
  // no flat middle for a partial radius to preserve.
  cornerRadius(this: CursorSmithPlugin, minor: number): number {
    if (!this.styleFor("cursorRounded")) return 0;
    const m = Math.max(0, minor);
    if (m <= 0) return 0;
    const r = m <= ROUNDED_THIN_PX ? m / 2 : m * ROUNDED_BLOCK_FRACTION;
    // Never more than half the narrow axis: beyond that the two corners on
    // one side overlap and arcTo starts producing self-intersecting garbage.
    return Math.min(r, m / 2);
  },

  // Trace a quad - optionally with rounded corners - WITHOUT filling it.
  //
  // Split out from fillCursorShape so the hollow outline can stroke exactly
  // the shape the solid style fills. Those two used to be separate bodies of
  // code with a comment admitting the duplication, which is precisely why
  // rounding had to touch both or neither.
  //
  // arcTo does the rounding rather than roundRect, for two reasons. The
  // shape is NOT always an axis-aligned rect: with Motion Smear on it is an
  // arbitrary quad from the smear spring, which roundRect cannot express at
  // all. And roundRect needs Chromium 99 / iOS 16.4, while this plugin ships
  // with isDesktopOnly false - arcTo has been universal for a decade.
  traceQuad(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, corners: Quad, radius: number = 0) {
    const pts = [corners.tl, corners.tr, corners.br, corners.bl];

    if (!(radius > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }

    // Clamp against the quad's OWN geometry - both its edge lengths AND its
    // corner angles.
    //
    // Edge length alone is not enough, and that omission is what produced
    // stray artifacts with Rounded Corners on. arcTo does not draw an arc of
    // radius r centred on the corner: it insets the arc's tangent points
    // along both edges by r / tan(theta/2), which for an ACUTE corner is far
    // larger than r. A Motion Smear shears the quad into exactly that shape -
    // measured on a 3x24 stem sheared 60px, the corner angle falls to 22
    // degrees and a 1.5px radius reaches 7.8px along a 3px edge. The tangent
    // point lands beyond the next corner, the traced path leaves the quad
    // entirely, and whatever it paints out there is outside the damage rect
    // and never cleared.
    //
    // Inverting that relation gives the real ceiling per corner:
    //   r <= (shorter adjacent edge / 2) * tan(theta / 2)
    // which for a right angle reduces to half the edge - the old rule - and
    // tightens smoothly as the corner sharpens.
    let r = radius;
    for (let i = 0; i < 4; i++) {
      const prev = pts[(i + 3) % 4], cur = pts[i], next = pts[(i + 1) % 4];
      const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
      const v2x = next.x - cur.x, v2y = next.y - cur.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (!(l1 > 1e-6) || !(l2 > 1e-6)) { r = 0; break; }
      const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
      const theta = Math.acos(cos);
      // A straight-through corner (theta ~ pi) needs no limit from the angle;
      // a folded-back one (theta ~ 0) can take no radius at all.
      const lim = Math.min(l1, l2) / 2 * Math.tan(theta / 2);
      if (lim < r) r = lim;
    }
    if (!(r > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }

    // Start at the midpoint of the last edge - any point strictly inside an
    // edge works as a seed, and a midpoint is guaranteed to be outside both
    // of that edge's corner arcs after the clamp above.
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const seed = mid(pts[3], pts[0]);
    ctx.moveTo(seed.x, seed.y);
    for (let i = 0; i < 4; i++) {
      const corner = pts[i];
      const next = pts[(i + 1) % 4];
      ctx.arcTo(corner.x, corner.y, next.x, next.y, r);
    }
    ctx.closePath();
  },

  // The caret's body as a set of corner points: the smear quad while Motion
  // Smear is deforming it, otherwise the plain rect.
  cursorCorners(this: CursorSmithPlugin, rx: number, ry: number, rw: number, rh: number): Quad {
    return this.smearCorners() || {
      tl: { x: rx, y: ry },
      tr: { x: rx + rw, y: ry },
      br: { x: rx + rw, y: ry + rh },
      bl: { x: rx, y: ry + rh },
    };
  },

  fillCursorShape(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number) {
    const corners = this.cursorCorners(rx, ry, rw, rh);
    ctx.beginPath();
    this.traceQuad(ctx, corners, this.cornerRadius(Math.min(rw, rh)));
    ctx.fill();
  },

  // An axis-aligned rect as a rounded subpath, for the trail ghosts and the
  // neon tube. These never smear (a trail ghost is a snapshot of where the
  // caret WAS, so it has no spring state of its own), so they don't need the
  // quad machinery - but they do need to match the live caret's rounding, or
  // a rounded cursor drags a tail of little sharp boxes behind it.
  traceRoundedRect(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
    const r = Math.min(Math.max(0, radius), Math.min(w, h) / 2);
    if (!(r > 0.01)) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  fillTrailRect(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    const r = this.cornerRadius(Math.min(w, h));
    if (!(r > 0.01)) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    this.traceRoundedRect(ctx, x, y, w, h, r);
    ctx.fill();
  },

  // The two serif brackets of an I-beam caret, as corner quads ready to add
  // to the stem's path.
  //
  // Two things this fixes over the pair of fillRects it replaces.
  //
  // ANCHORING. fillCursorShape ignores the rect it is handed whenever Motion
  // Smear is on and fills the spring's quad instead - but the serifs were
  // positioned from `active`, the RESTING geometry. So the moment the caret
  // moved, the stem leaned and stretched away while the serifs stayed nailed
  // to where it had been, leaving two horizontal bars floating next to a
  // detached stem. With smear on by default that was the common case, not an
  // edge case. Here they take their centres from the smeared quad's own top
  // and bottom edges, so they travel with the stem.
  //
  // They stay AXIS-ALIGNED while doing it. Shearing a serif with the quad
  // makes it read as a broken glyph, which is what the original comment was
  // rightly worried about - but the answer to that is to keep them level,
  // not to leave them behind.
  //
  // SHAPE. A real I-beam's serifs are brackets: they thin as they approach
  // the stem rather than butting into it at full weight. Each one is a
  // trapezoid, widest at its outer edge, narrowing by SERIF_TAPER where it
  // meets the stem. Returns the union bounds too, so the caller can size a
  // gradient or pattern over the whole glyph rather than the stem alone.
  serifQuads(this: CursorSmithPlugin, active: CaretRecord, rx: number, rw: number) {
    const stem = rw;
    const lineH = active.h;

    // Clamped against BOTH the stem and the line height - see the constants.
    const thickness = Math.max(
      1,
      Math.round(Math.min(stem * SERIF_STEM_RATIO, lineH * SERIF_HEIGHT_RATIO)),
    );

    const charW = active.actualCharWidth;
    const raw = charW && charW > 0 ? charW : stem * 7;
    const span = Math.max(SERIF_MIN_SPAN_PX, Math.min(raw, lineH * SERIF_MAX_SPAN_RATIO));

    // Follow the smeared body's top and bottom edges - but ride the LEADING
    // end of each, not its midpoint.
    //
    // Midpoints were the first fix, and they are right for a vertical move:
    // there the smear stretches the long side edges and leaves the top and
    // bottom edges the caret's own width, so a midpoint IS the stem's end.
    // On a horizontal move it is the top and bottom edges themselves that
    // stretch, and their midpoint is then the middle of the streak while the
    // caret is at its front. Measured on a 300px move with Smooth Movement
    // on: the stem spanned 189 -> 348 and both brackets sat at 268, eighty
    // pixels behind the caret. Reported as the serifs travelling at a
    // different speed from the cursor, which is exactly what it looks like.
    //
    // So: find which corner of each edge leads (project the edge onto the
    // held travel direction), then walk back along the edge by half the
    // caret's OWN width. That lands the bracket centred on the caret's real
    // footprint at the head of the smear. When the edge is only as long as
    // the caret is wide - no smear, or a purely vertical one - half its width
    // back from either corner is the midpoint, so this reduces exactly to the
    // old behaviour everywhere it was already correct.
    const c = this.cursorCorners(rx, active.top, rw, lineH);
    const dir = this._smearDir;
    const anchor = (a: Pt, b: Pt) => {
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (!(len > 0.001)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // `a` leads only if the edge runs against the direction of travel.
      const aLeads = !!dir && (ex * dir.x + ey * dir.y) < 0;
      const lead = aLeads ? a : b;
      const sign = aLeads ? -1 : 1;
      const back = Math.min(len, stem) / 2;
      return {
        x: lead.x - sign * (ex / len) * back,
        y: lead.y - sign * (ey / len) * back,
      };
    };
    const top = anchor(c.tl, c.tr), bot = anchor(c.bl, c.br);
    const topCx = top.x, topCy = top.y;
    const botCx = bot.x, botCy = bot.y;

    const half = span / 2;
    const inset = half * SERIF_TAPER;

    // Top bracket: full span along its outer (upper) edge, narrowed where it
    // meets the stem. Bottom is the same shape mirrored.
    const quads = [
      {
        tl: { x: topCx - half, y: topCy },
        tr: { x: topCx + half, y: topCy },
        br: { x: topCx + half - inset, y: topCy + thickness },
        bl: { x: topCx - half + inset, y: topCy + thickness },
      },
      {
        tl: { x: botCx - half + inset, y: botCy - thickness },
        tr: { x: botCx + half - inset, y: botCy - thickness },
        br: { x: botCx + half, y: botCy },
        bl: { x: botCx - half, y: botCy },
      },
    ];

    return {
      quads,
      left: Math.min(topCx, botCx) - half,
      right: Math.max(topCx, botCx) + half,
      // A serif is a thin bar, so it rounds on its own thickness rather than
      // on the stem's width - otherwise a rounded Box-sized radius would eat
      // the whole bracket.
      radius: this.cornerRadius(thickness),
    };
  },

  // The steps the two caret painters share (drawGenericCaret for Line and
  // Underline, drawBoxCursor for Box): the trail pass, arming the CRT glow,
  // the glitch state, the body's paint. They were two parallel copies of the
  // same structure, which is how the two could drift apart at all. The
  // goldens hold the two painters' ops identical to before the extraction.
  //
  // The trail: one save/restore round the ghosts, and only with a trail to
  // paint - the pair exists to undo the shadow the neon ghosts arm, and
  // with CRT off (or every ghost faded) it undid nothing. A neon ghost is
  // the caret's own footprint as a glowing tube (the bar for Underline, the
  // char box for Box, filled even when the box is hollow - a hollow outline
  // of a glowing tail reads as noise); a plain ghost is the flat trail
  // paint, built from the bar's own rect for Underline (a ramp spanning the
  // whole line height would show only the sliver that falls across the
  // bar), stroked as an inset outline for a hollow Box (canvas strokes
  // straddle the path, so the outline lands inside the footprint the filled
  // dot would occupy), filled otherwise.
  _paintTrail(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, style: "Line" | "Underline" | "Box", color: string, bodyOpacity: number, strokeW: number) {
    const settings = this.look;
    if (!settings.crtEffect || !this.trail.length) return;
    ctx.save();
    this.forEachTrailPoint((p, alpha, age) => {
      const a = alpha * bodyOpacity;
      if (settings.crtNeon) {
        if (style === "Underline") {
          const uThickness = this.underlineThickness(p.h);
          const ty = p.y + p.h - uThickness;
          this.drawNeonGhost(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, a, age, color);
        } else {
          this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, a, age, color);
        }
      } else if (style === "Underline") {
        const uThickness = this.underlineThickness(p.h);
        const ty = p.y + p.h - uThickness;
        ctx.fillStyle = this.trailPaint(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, a, age, color);
        this.fillTrailRect(ctx, p.x, ty, p.w, uThickness);
      } else if (style === "Box" && strokeW > 0) {
        ctx.strokeStyle = this.trailPaint(ctx, p, a, age, color);
        ctx.lineWidth = strokeW;
        const inset = strokeW / 2;
        const iw = Math.max(0, p.w - strokeW), ih = Math.max(0, p.h - strokeW);
        const rr = this.cornerRadius(Math.min(iw, ih));
        if (rr > 0.01) {
          ctx.beginPath();
          this.traceRoundedRect(ctx, p.x + inset, p.y + inset, iw, ih, rr);
          ctx.stroke();
        } else {
          ctx.strokeRect(p.x + inset, p.y + inset, iw, ih);
        }
      } else {
        ctx.fillStyle = this.trailPaint(ctx, p, a, age, color);
        this.fillTrailRect(ctx, p.x, p.y, p.w, p.h);
      }
    });
    ctx.restore();
  },

  // The CRT glow: a shadow in the caret's colour, its blur scaled by the
  // blink (it fades with the caret) and by Speed demon's heat. `blur` is
  // the style's base blur times the blink alpha.
  _armGlow(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, color: string, blur: number) {
    const settings = this.look;
    if (settings.crtEffect && settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * this.glowHeatScale();
    }
  },

  // A live Signal Glitch burst, or null. Resolved before the body's paint is
  // built, so a burst skips the (possibly expensive) beam paint it would
  // discard.
  _glitchNow(this: CursorSmithPlugin, now: number) {
    const settings = this.look;
    return settings.crtEffect && settings.crtGlitch ? this.glitchState(now) : null;
  },

  // The paint for the caret's body over the rect it will actually cover: the
  // energy beam when it is on, otherwise the flat colour or the gradient.
  _bodyPaint(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, color: string, alpha: number) {
    return this.look.energyEffect
      ? this.energyPaint(x, y, w, h, color, alpha)
      : this.cursorPaint(x, y, w, h, color, alpha);
  },

  drawGenericCaret(this: CursorSmithPlugin, isUnderline = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const active = this.animActive;
    const now = performance.now();
    const trailColor = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    // Same single alpha term the Box style uses (see drawBoxCursor): the blend
    // that does the visible work is layer-level, in applyCanvasBlend, and this
    // just takes the paint fractionally off full so the caret sits in the text
    // rather than on it. Applied to the trail as well as the live caret, so
    // the two never drift apart.
    const bodyOpacity = this.styleFor("cursorTranslucent")
      ? opacity * TRANSLUCENT_ALPHA
      : opacity;

    this._paintTrail(ctx, isUnderline ? "Underline" : "Line", trailColor, bodyOpacity, 0);

    if (!active) return;
    const blinkAlpha = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";

    ctx.save();
    this._armGlow(ctx, color, 8 * blinkAlpha);

    let rx, ry, rw, rh;
    if (isUnderline) {
      const uThickness = this.underlineThickness(active.h);
      rx = active.x;
      ry = active.top + active.h - uThickness;
      rw = active.actualCharWidth;
      rh = uThickness;
    } else {
      rx = active.x;
      ry = active.top;
      rw = this.renderWidth(active);
      rh = active.h;
    }

    // Signal Glitch replaces the caret body for the length of a burst. For a
    // Line caret the slices are only a couple of px wide, so the channel split
    // does most of the visible work here; for Underline the bar is wide and it
    // is the slicing that dominates. Both go through the same routine as the
    // Box style so the effect is recognisably the same feature everywhere.
    const gsGen = this._glitchNow(now);

    // Line + serifs = classic I-beam. Only for the Line style: an underline
    // is already a horizontal bar, so capping it with two more reads as a
    // stack of lines rather than a glyph.
    const wantSerifs = !isUnderline && settings.lineSerifs && !gsGen;
    const serifs = wantSerifs ? this.serifQuads(active, rx, rw) : null;

    if (gsGen) {
      this.paintGlitchRect(ctx, rx, ry, rw, rh, color, 0.9 * blinkAlpha * bodyOpacity, gsGen);
    } else {
      // The paint is built over the union of stem and serifs, not the stem
      // alone. With Energy Beam + Aurora the fill is a NO-REPEAT pattern
      // sized to the rect it is handed, and a serif reaches several times the
      // stem's width to either side - so a stem-sized pattern left most of
      // each serif outside the bitmap, painting it fully transparent. The
      // serifs simply did not exist in that mode.
      let px = rx, pw = rw;
      if (serifs) {
        px = Math.min(rx, serifs.left);
        pw = Math.max(rx + rw, serifs.right) - px;
      }
      ctx.fillStyle = this._bodyPaint(px, ry, pw, rh, color, 0.9 * blinkAlpha * bodyOpacity);

      // Stem and serifs go into ONE path and take ONE fill.
      //
      // They used to be three separate fills sharing a fillStyle whose alpha
      // is 0.9 - so every serif was painted at 90% over a stem already at
      // 90%, compositing the overlaps to 99% and making the two crossings
      // visibly denser than the rest of the caret. The armed glow made it
      // worse: canvas casts a shadow per fill, so the intersections got a
      // doubled halo too, and under Translucent the layer blend amplified
      // the double-paint rather than hiding it.
      //
      // Non-zero winding fills overlapping subpaths as their union, so one
      // fill gives uniform alpha across the whole I-beam and a single shadow
      // cast from its combined outline.
      ctx.beginPath();
      this.traceQuad(
        ctx,
        this.cursorCorners(rx, ry, rw, rh),
        this.cornerRadius(Math.min(rw, rh)),
      );
      if (serifs) {
        for (const q of serifs.quads) this.traceQuad(ctx, q, serifs.radius);
      }
      ctx.fill();
    }
    ctx.restore();
  },

  drawBoxCursor(this: CursorSmithPlugin) {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const now = performance.now();
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const hollow = this.styleFor("boxHollow");
    const strokeW = hollow ? Math.max(1, Math.min(6, settings.boxHollowWidth || 2)) : 0;

    // Translucency is a flat multiplier on the alpha, applied everywhere this
    // style builds one - body, hollow outline, neon ghost and trail alike - so
    // the caret can't come apart from the tail it's dragging. The blend that
    // does the real work is layer-level; see applyCanvasBlend.
    const translucent = !!this.styleFor("cursorTranslucent");
    const bodyOpacity = translucent ? opacity * TRANSLUCENT_ALPHA : opacity;

    this._paintTrail(ctx, "Box", color, bodyOpacity, strokeW);

    const active = this.animActive;
    if (active) {
      const blinkAlpha = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);

      ctx.save();
      // Canvas draws a shape's shadow BEHIND that shape, so the halo of a
      // solid box lands exactly where you want it - visible around the
      // outside, hidden under the fill. Just arm it and paint the box (a
      // "seed" pre-fill at alpha 0.01 used to be here and gave the box no
      // glow at all: a shadow inherits the alpha of the shape casting it -
      // don't reintroduce one).
      this._armGlow(ctx, color, 10 * blinkAlpha);

      // Signal Glitch takes over the body of the cursor entirely while a burst
      // is live - it replaces the fill/stroke rather than layering on top,
      // because the whole point is that the cursor's own form comes apart. The
      // glow armed above still applies, so the break-up keeps its halo.
      // Resolved before paintStyle so a burst skips the (possibly expensive,
      // e.g. Aurora's per-pixel raster) beam paint it's about to discard.
      const gsBox = this._glitchNow(now);

      if (gsBox) {
        this.paintGlitchRect(
          ctx, active.x, active.top, renderW, active.h,
          color, 0.9 * blinkAlpha * bodyOpacity, gsBox,
        );
      } else {
      const paintStyle = this._bodyPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * bodyOpacity);
      if (hollow) {
        // Stroke exactly the path the solid style fills, so the outline
        // deforms with a smear and rounds with Rounded Corners rather than
        // staying a sharp rectangle while the filled version curves. This
        // used to duplicate the corner logic inline, which is why the two
        // could drift apart at all.
        ctx.strokeStyle = paintStyle;
        ctx.lineWidth = strokeW;
        ctx.lineJoin = "miter";
        ctx.beginPath();
        this.traceQuad(
          ctx,
          this.cursorCorners(active.x, active.top, renderW, active.h),
          this.cornerRadius(Math.min(renderW, active.h)),
        );
        ctx.stroke();
      } else {
        ctx.fillStyle = paintStyle;
        this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
      }
      }
      ctx.restore();

      // Character-inside-box only makes sense when the box is filled
      // (invert-color glyph on a solid background). On a hollow outline
      // the real character is already visible through the middle, so
      // drawing an inverted glyph on top would duplicate it. It is also
      // suppressed mid-glitch: the box it is supposed to sit inside has been
      // torn into displaced slices, so a crisp centred glyph floating over the
      // wreckage reads as a rendering bug rather than part of the effect.
      //
      // Translucency suppresses it for the same reason hollow does, plus a
      // colour one. The real character shows through a translucent box, so an
      // inverted copy on top is a doubling artifact - and worse, the
      // inversion is calibrated against a SOLID fill: with the layer in
      // multiply/screen the inverted glyph is exactly the wrong polarity for
      // the blend (a dark glyph screened over a dark theme, a light one
      // multiplied over a light theme), so it would mostly disappear anyway.
      const displayChar = this.pending ? this.pending.holdChar : active.char;

      // The glyph fades WITH the box, at the same rate.
      //
      // Two wrong answers preceded this one. It was originally
      // `0.3 + blinkAlpha * 0.7`, which floors at 0.3 and never reaches zero,
      // so a blinked-off box still had an inverted ghost of the letter lying
      // on top of the real character. Cubing it fixed that but overshot
      // badly in the other direction: the letter was down to 0.13 while the
      // box was still at 0.46, so for most of every fade the cursor was a
      // solid block with nothing in it. That is only easy to miss when
      // Smooth Movement is on, because its 450ms stop-blink hold keeps the
      // caret lit right after a keystroke - which is exactly why the letter
      // looked like it only existed with smooth movement enabled.
      //
      // Tracking the box linearly is right because the box and the letter
      // are ONE object. They fade together, and the real character emerges
      // underneath as they go. There is no double image to avoid: the
      // inverted glyph and the real one occupy the same pixels in the same
      // shape, so a partial blend reads as the letter changing colour, not
      // as two letters. And it still reaches zero, which was the whole point
      // of the first fix.
      const glyphAlpha = Math.min(1, bodyOpacity * blinkAlpha);
      if (!hollow && !translucent && !gsBox && settings.showChar && displayChar
          && glyphAlpha >= 0.01) {
        ctx.save();
        ctx.globalAlpha = glyphAlpha;
        // `color` is the box's own fill (getActiveColor, so heat- and
        // gradient-resolved). With Gradient on this is the ramp's FIRST stop
        // rather than the exact shade under the glyph - the fill varies across
        // the box, so no single reference is exact - but it's in the right
        // family, which is all the contrast floor needs to work from.
        //
        // Cached on the colour string: this runs every frame, the input
        // changes only when the cursor colour or heat does, and the scan
        // inside is a handful of pow() calls per step.
        const glyphMode = this.styleFor("glyphColorMode") || "contrast";
        if (this._glyphColorFor !== color || this._glyphColorMode !== glyphMode) {
          this._glyphColorFor = color;
          this._glyphColorMode = glyphMode;
          this._glyphColorVal = readableGlyphColor(color, glyphMode);
        }
        ctx.fillStyle = this._glyphColorVal;
        // Route through the same builder measureCharWidth uses, so the glyph
        // is drawn in the SAME weight/style the box was sized for. Building
        // this string without weight/style here (while the width was measured
        // WITH them) is exactly what made the character sit slimmer/fatter and
        // off-baseline over bold, italic, and heading text.
        ctx.font = this.fontString(active.fontSize, active.fontFamily, active.fontWeight, active.fontStyle);

        // Canvas's "middle" baseline centers a glyph within its own font
        // em-box (roughly ascent/descent of the font itself), but active.h
        // is the rendered *line height*, which is usually taller than that
        // em-box (CSS line-height adds extra leading above/below the
        // glyph). Centering purely on font metrics ignores that leading and
        // makes the drawn character sit noticeably higher than the real
        // text, which is vertically centered within the full line box.
        // Measuring real ascent/descent and centering the glyph's em-box
        // inside active.h (the same way the browser centers line content)
        // lines it up with where the actual character renders.
        // Measured once per (font, character): this runs on every frame the
        // box is drawn, and the answer only changes with the font under it.
        const metricKey = ctx.font + "|" + displayChar;
        let gm = this._glyphMetrics;
        if (!gm || this._glyphMetricKey !== metricKey) {
          const metrics = ctx.measureText(displayChar);
          gm = this._glyphMetrics = {
            ascent: metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? active.fontSize * 0.8,
            descent: metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? active.fontSize * 0.2,
          };
          this._glyphMetricKey = metricKey;
        }
        const { ascent, descent } = gm;
        const glyphBoxHeight = ascent + descent;
        const leading = active.h - glyphBoxHeight;
        const baselineY = active.top + ascent + leading / 2;

        // Center on the glyph's own advance, not renderW: for a Box cursor
        // renderW is charWidth, which INCLUDES letter-spacing, so centering on
        // it would shift the glyph right by half the spacing (the browser puts
        // spacing after the glyph, not around it). Subtracting letterSpacing
        // back out lines our glyph up with where the real one renders. Zero
        // letter-spacing (the common case) makes this identical to before.
        const glyphAdvance = Math.max(1, (active.actualCharWidth ?? renderW) - (active.letterSpacing || 0));
        // On whole device pixels. The caret's coordinates are fractional
        // (coordsAtPos), and canvas text laid down at a fractional baseline
        // is resampled across two rows of pixels - the letter looked soft
        // next to the real one, which the browser snaps. The canvas is
        // scaled by the device pixel ratio and offset by the region's
        // origin (resizeCanvas), so a device pixel is 1/dpr CSS pixels from
        // that origin, not from zero.
        const dpr = this._canvasDpr || 1;
        const region = this._canvasRect;
        const ox = region ? region.x : 0, oy = region ? region.y : 0;
        const snapX = (v: number) => Math.round((v - ox) * dpr) / dpr + ox;
        const snapY = (v: number) => Math.round((v - oy) * dpr) / dpr + oy;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(displayChar, snapX(active.x + glyphAdvance / 2), snapY(baselineY));
        ctx.restore();
      }
    }
  },
};
