// Part of the plugin class, by what it paints (HANDOFF §1.20): the methods
// below are gathered into paintMethods (paint.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// The energy beam: the travelling gradient inside the cursor body, and the
// aurora, a raster pattern when the ramp is on and the waviness above zero.

import { hexToRgbTuple, hexToRgba } from "./color";
import type CursorSmithPlugin from "./plugin";

export const paintEnergyMethods = {
  // Chooses how the Energy Beam paints the cursor.
  //
  // Aurora with any waviness becomes a genuine 2D field (auroraPattern); every
  // other case keeps the original linear gradient. Both return something usable
  // directly as a fillStyle/strokeStyle, so callers don't care which they got.
  energyPaint(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, baseColor: string, alpha: number) {
    const rampOn = !!this.look.gradientEnabled;
    const wav = this.look.energyAuroraWaviness ?? 1;
    if (rampOn && this.look.energyAurora && wav > 0.05) {
      const pat = this.auroraPattern(x, y, w, h, alpha, wav);
      if (pat) return pat;
      // else fall through to the gradient - auroraPattern self-disables on a
      // degenerate rect, an oversized one, or any canvas API failure.
    }
    return this.createEnergyGradient(x, y, w, h, baseColor, alpha);
  },

  // Aurora as a 2D pattern rather than a vertical gradient.
  //
  // Why this exists: createLinearGradient can only vary colour along ONE axis.
  // However hard the old code warped its sample position, every colour band was
  // still a perfectly horizontal line spanning the cursor - the bands could
  // slide up and down but could never bend, which is why Aurora read as
  // "scrolling stripes" rather than anything wavy. Getting curtains that
  // actually ripple sideways requires colour to be a function of x AND y, and
  // the only way to hand canvas an arbitrary 2D field as a fillStyle is to
  // rasterise it into an offscreen bitmap and wrap that in a pattern.
  //
  // Returns null (caller falls back to the gradient) rather than throwing on
  // anything unexpected, matching the defensive style used elsewhere here.
  auroraPattern(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, alpha: number, wav: number) {
    try {
      const ctx = this.ctx;
      if (!ctx) return null;

      // The pattern must cover the smear quad, not just the caret box: during a
      // smear the filled shape overshoots the box, and a "no-repeat" pattern
      // paints nothing outside its own bitmap - the overshooting part of the
      // cursor would come out fully transparent. Union the two and pad by a
      // pixel so the edges of the shape are inside the bitmap, never on its
      // boundary.
      let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
      const q = this.smearCorners();
      if (q) {
        for (const k of ["tl", "tr", "br", "bl"] as const) {
          const c = q[k];
          if (!c) continue;
          if (c.x < x0) x0 = c.x;
          if (c.y < y0) y0 = c.y;
          if (c.x > x1) x1 = c.x;
          if (c.y > y1) y1 = c.y;
        }
      }
      x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;

      const rw = x1 - x0, rh = y1 - y0;
      if (!(rw > 0.5) || !(rh > 0.5)) return null;

      const dpr = (this.canvas?.ownerDocument?.defaultView || window).devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(rw * dpr));
      const ph = Math.max(1, Math.round(rh * dpr));
      // Hard ceiling on rasterisation cost. A caret-sized rect is ~1-3k pixels
      // even at dpr 2; anything past this is a runaway (a smear mid-teleport
      // across a huge window) and is not worth a per-pixel loop on the hot
      // path, so it takes the cheap gradient for those frames instead.
      if (pw * ph > 60000) return null;

      // Offscreen surface + pixel buffer are reused across frames and only
      // reallocated when the size actually changes. Allocating a fresh
      // ImageData every frame would hand the GC a multi-kilobyte buffer 30
      // times a second for no reason.
      let ac = this._auroraCanvas;
      if (!ac || ac.width !== pw || ac.height !== ph) {
        // Detached scratch canvas; it is only ever drawn FROM.
        ac = this._auroraCanvas = createEl("canvas");
        ac.width = pw;
        ac.height = ph;
        this._auroraCtx = ac.getContext("2d");
        this._auroraImg = null;
      }
      const actx = this._auroraCtx;
      if (!actx) return null;
      let img = this._auroraImg;
      if (!img || img.width !== pw || img.height !== ph) {
        img = this._auroraImg = actx.createImageData(pw, ph);
      }
      const data = img.data;

      const speed = this.look.energySpeed ?? 1;
      const t = (performance.now() / 1000) * speed;

      // Quantise the ramp once per frame into a lookup table. sampleRamp
      // allocates a fresh array per call, so calling it per pixel would mean
      // thousands of short-lived arrays every frame; 96 entries is far finer
      // than the eye resolves across a caret and costs 96 calls instead.
      const LUT = 96;
      let lut = this._auroraLut;
      if (!lut || lut.length !== LUT * 3) lut = this._auroraLut = new Float32Array(LUT * 3);
      for (let i = 0; i < LUT; i++) {
        const s = this.sampleRamp(i / LUT, true);
        lut[i * 3] = s[0];
        lut[i * 3 + 1] = s[1];
        lut[i * 3 + 2] = s[2];
      }

      const a255 = Math.max(0, Math.min(255, Math.round(alpha * 255)));
      const invW = 1 / pw, invH = 1 / ph;

      for (let py = 0; py < ph; py++) {
        const v = py * invH;
        for (let px = 0; px < pw; px++) {
          const u = px * invW;

          // Domain warp. Each term mixes u and v, which is the whole point:
          // a term in v alone reproduces the old flat horizontal banding, and
          // it's the cross terms that let a band bend as it crosses the
          // cursor. Three incommensurate frequencies so the pattern never
          // settles into a visible repeat.
          const warp =
            Math.sin(v * 4.1 + t * 0.90 + u * 2.3) * 0.20 +
            Math.sin(v * 7.3 - t * 0.60 + u * 3.7) * 0.11 +
            Math.sin(u * 5.2 + t * 1.10 - v * 1.9) * 0.15;

          // Base coordinate drifts along the cursor; the warp bends it.
          let s = v - t * 0.30 + warp * wav;

          // Second, slower read from a different stretch of the ramp, cross
          // faded in. The warp only rearranges colours - without this, two
          // stops far apart on the ramp never meet and never blend.
          const mix = (0.5 + 0.5 * Math.sin(u * 2.1 + v * 2.3 + t * 0.7)) * 0.55;
          let s2 = (v * 0.45 + u * 0.25) + t * 0.17 + 0.37;

          // Index the LUT cyclically (positive modulo: s can go negative).
          let i1 = ((Math.floor(s * LUT) % LUT) + LUT) % LUT;
          let i2 = ((Math.floor(s2 * LUT) % LUT) + LUT) % LUT;
          i1 *= 3; i2 *= 3;

          let r = lut[i1] + (lut[i2] - lut[i1]) * mix;
          let g = lut[i1 + 1] + (lut[i2 + 1] - lut[i1 + 1]) * mix;
          let b = lut[i1 + 2] + (lut[i2 + 2] - lut[i1 + 2]) * mix;

          // Brightness wave, kept gentle for the same reason the gradient path
          // eases it: at full strength it repeatedly flattens the mix toward
          // white and black and the swirl stops being legible.
          const pulse = 0.5 + 0.5 * Math.sin((v - t * 0.6) * Math.PI * 2 + u * 1.4);
          if (pulse > 0.5) {
            const k = (pulse - 0.5) * 2 * 0.45;
            r += (255 - r) * k * 0.55;
            g += (255 - g) * k * 0.55;
            b += (255 - b) * k * 0.55;
          } else {
            const k = (0.5 - pulse) * 2 * 0.45;
            r -= r * k * 0.45;
            g -= g * k * 0.45;
            b -= b * k * 0.45;
          }

          const o = (py * pw + px) * 4;
          data[o] = r < 0 ? 0 : r > 255 ? 255 : r;
          data[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
          data[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
          data[o + 3] = a255;
        }
      }

      actx.putImageData(img, 0, 0);
      const pat = ctx.createPattern(ac, "no-repeat");
      if (!pat) return null;
      // Map the bitmap's pixel space onto user space: one bitmap pixel is
      // 1/dpr user units, and its origin sits at the padded rect's corner.
      // Without this the pattern would anchor at the canvas origin and the
      // cursor would show whatever slice of the field happened to be there.
      if (typeof pat.setTransform === "function" && typeof DOMMatrix === "function") {
        pat.setTransform(new DOMMatrix().translateSelf(x0, y0).scaleSelf(1 / dpr, 1 / dpr));
      } else {
        return null; // no way to position it correctly; use the gradient
      }
      return pat;
    } catch {
      // createPattern refuses a zero-sized source; the gradient is used instead.
      return null;
    }
  },

  createEnergyGradient(this: CursorSmithPlugin, x: number, y: number, w: number, h: number, baseColor: string, alpha: number) {
    const ctx = this.ctx;
    if (!ctx) return hexToRgba(baseColor, alpha);
    const speed = this.look.energySpeed ?? 1;
    const t = (performance.now() / 1000) * speed;
    const base = hexToRgbTuple(baseColor);
    const rampOn = !!this.look.gradientEnabled;
    const aurora = rampOn && !!this.look.energyAurora;

    const grad = ctx.createLinearGradient(x + w / 2, y + h, x + w / 2, y);
    // A scrolling multi-colour ramp needs more stops than a single-hue beam:
    // every stop is a linear segment, and 6 of them across a 4-colour cycle
    // renders as visible facets rather than a smooth flow. Aurora warps the
    // sample position on top of that, so it needs finer steps again or the
    // warp itself shows up as kinks.
    const stops = aurora ? 20 : rampOn ? 12 : 6;
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops;
      const pulse = 0.5 + 0.5 * Math.sin((pos - t * 0.6) * Math.PI * 2);

      // With Gradient on the beam becomes an *animated* gradient: the ramp
      // itself scrolls along the cursor (sampled cyclically, so there's no
      // seam where it wraps) and the beam's brightness wave rides on top of
      // it. With Gradient off this is unchanged - one base colour, pulse only.
      let bs;
      if (aurora) {
        // Aurora: instead of sliding the ramp rigidly, warp where each point
        // samples it using three sine waves at unrelated frequencies and
        // speeds. Because they never line up into a repeating pattern, the
        // colours stretch and compress against each other and appear to swirl
        // rather than march past.
        const warp =
          Math.sin(pos * 3.1 + t * 0.85) * 0.26 +
          Math.sin(pos * 5.7 - t * 0.55) * 0.14 +
          Math.sin(pos * 1.3 + t * 1.25) * 0.20;
        const near = this.sampleRamp(pos - t * 0.3 + warp, true);
        // A second, slower read from a different part of the ramp, cross-faded
        // into the first. This is what actually *mixes* the colours - the warp
        // alone only rearranges them, so two stops far apart on the ramp would
        // never meet.
        const far = this.sampleRamp(pos * 0.45 + t * 0.17 + 0.37, true);
        const mix = (0.5 + 0.5 * Math.sin(pos * 2.3 + t * 0.7)) * 0.6;
        bs = [
          near[0] + (far[0] - near[0]) * mix,
          near[1] + (far[1] - near[1]) * mix,
          near[2] + (far[2] - near[2]) * mix,
        ];
      } else {
        bs = rampOn ? this.sampleRamp(pos - t * 0.35, true) : base;
      }
      let r = bs[0], g = bs[1], b = bs[2];
      // Aurora is carried by its colours, so the beam's hard bright/dark pulse
      // is eased off here - at full strength it repeatedly flattens the mix to
      // near-white and near-black and the swirl stops being legible.
      const punch = aurora ? 0.45 : 1;
      if (pulse > 0.5) {
        const k = (pulse - 0.5) * 2 * punch;
        r += (255 - r) * k * 0.55;
        g += (255 - g) * k * 0.55;
        b += (255 - b) * k * 0.55;
      } else {
        const k = (0.5 - pulse) * 2 * punch;
        r -= r * k * 0.45;
        g -= g * k * 0.45;
        b -= b * k * 0.45;
      }

      // Per-channel hue drift. This is what gives the single-colour beam its
      // iridescence, but it actively fights a gradient - the user picked those
      // colours exactly, and ±14 per channel visibly muddies them - so with a
      // ramp on, the scroll above supplies the motion instead.
      if (!rampOn) {
        const shift = 14;
        r += Math.sin(t * 0.7 + pos * 6) * shift;
        g += Math.sin(t * 0.7 + pos * 6 + 2.1) * shift;
        b += Math.sin(t * 0.7 + pos * 6 + 4.2) * shift;
      }

      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));

      grad.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  },
};
