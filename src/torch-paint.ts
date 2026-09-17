// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

import { TORCH_CANVAS_SCALE } from "./constants";
import type { Pt } from "./types";

// The torch's two layers, painted. Both used to be DOM elements carrying a
// CSS radial-gradient positioned by custom properties, which cost a
// pane-sized gradient raster on every frame a light moved or the radius
// pulsed - fine on a GPU, the torch's whole cost without one - and could not
// hold more than one light (a gradient darkens everything outside its OWN
// hole; two stacked light only their intersection). Both are now canvases at
// TORCH_CANVAS_SCALE of the pane, painted by these two pure functions.
//
// The darkness: a flat fill at the Darkness setting, then one radial
// gradient per light punched out with destination-out. That composite
// multiplies the alpha in place - alpha becomes darkness x (1 - source) - so
// a point inside any hole is clear and the stops below are the stylesheet's
// old four-stop ramp turned inside out: 0 / 0.52 / 0.91 / 1.0 of the darkness
// at 0% / 40% / 70% / 100% of the radius. Several lights multiply, which is
// what `mask-composite: intersect` did before this.
//
// The glow: one warm core per light at 0.6x the radius, transparent outside
// itself, so lights simply add. The layer's opacity carries Glow Strength
// and the flicker (a custom property, compositor-only).
//
// `w`/`h` are the layer's CSS size, `spots` in its own coordinates; the
// context is expected to carry the TORCH_CANVAS_SCALE transform
// (torchCanvasContext). Pure so the painting can be tested on a recorder.
export function paintTorchDarkness(ctx: CanvasRenderingContext2D, w: number, h: number, spots: Pt[], radiusPx: number, darkness: number) {
  const d = Math.max(0, Math.min(1, darkness));
  const r = Math.max(1, radiusPx);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = `rgba(0, 0, 0, ${d})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  for (const sp of spots) {
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    g.addColorStop(0, "rgba(0, 0, 0, 1)");
    g.addColorStop(0.4, "rgba(0, 0, 0, 0.48)");
    g.addColorStop(0.7, "rgba(0, 0, 0, 0.09)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = "source-over";
}

export function paintTorchGlow(ctx: CanvasRenderingContext2D, w: number, h: number, spots: Pt[], radiusPx: number, warmRgb: string) {
  const r = Math.max(1, radiusPx * 0.6);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  for (const sp of spots) {
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    g.addColorStop(0, `rgba(${warmRgb}, 0.4)`);
    g.addColorStop(0.45, `rgba(${warmRgb}, 0.12)`);
    g.addColorStop(0.75, `rgba(${warmRgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
  }
}

// Size a torch canvas's backing store for a layer of w x h CSS pixels and
// return its context with the scale transform set. Reassigning width/height
// blanks the store, so it is only touched when the size changed.
export function torchCanvasContext(el: HTMLCanvasElement, w: number, h: number) {
  const bw = Math.max(1, Math.ceil(w * TORCH_CANVAS_SCALE));
  const bh = Math.max(1, Math.ceil(h * TORCH_CANVAS_SCALE));
  if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(TORCH_CANVAS_SCALE, 0, 0, TORCH_CANVAS_SCALE, 0, 0);
  return ctx;
}
