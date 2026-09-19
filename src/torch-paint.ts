import { TORCH_CANVAS_SCALE } from "./constants";
import type { Box, Pt } from "./types";

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
//
// `regions`, when given, confines the painting to those rectangles (the
// layer's coordinates, a clip): with the sidebars spared the darkness
// covers the note tabs of the main area and not the views beside them
// (Word-Smith's History or Organizer, a graph, an empty tab). Nothing
// outside a region is touched, so the layer stays clear there. Absent, the
// whole layer is painted, as before.
function clipToRegions(ctx: CanvasRenderingContext2D, regions: Box[] | null | undefined): boolean {
  if (!regions) return false;
  ctx.save();
  ctx.beginPath();
  for (const b of regions) ctx.rect(b.left, b.top, b.width, b.height);
  ctx.clip();
  return true;
}

export function paintTorchDarkness(ctx: CanvasRenderingContext2D, w: number, h: number, spots: Pt[], radiusPx: number, darkness: number, regions?: Box[] | null) {
  const d = Math.max(0, Math.min(1, darkness));
  const r = Math.max(1, radiusPx);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  const clipped = clipToRegions(ctx, regions);
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
  if (clipped) ctx.restore();
}

export function paintTorchGlow(ctx: CanvasRenderingContext2D, w: number, h: number, spots: Pt[], radiusPx: number, warmRgb: string, regions?: Box[] | null) {
  const r = Math.max(1, radiusPx * 0.6);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  const clipped = clipToRegions(ctx, regions);
  for (const sp of spots) {
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    g.addColorStop(0, `rgba(${warmRgb}, 0.4)`);
    g.addColorStop(0.45, `rgba(${warmRgb}, 0.12)`);
    g.addColorStop(0.75, `rgba(${warmRgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
  }
  if (clipped) ctx.restore();
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
