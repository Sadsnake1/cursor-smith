import {
  CANVAS_REGION_GRID,
  CANVAS_REGION_MARGIN_X,
  CANVAS_REGION_SHRINK_RATIO,
} from "./constants";
import type { Bounds, Rect } from "./types";

// ---------------------------------------------------------------------------
// Canvas region fitting (issue #30)
//
// Pure: decides where the canvas element sits this frame. `need` is the
// bounding box {x0,y0,x1,y1} of everything that must be visible, or null when
// nothing is; `clip` {x,y,w,h} is the wrapper's clip window, which is the hard
// limit; `current` is the region in force, or null. Returns `current` itself
// (identity) when it already covers the need and is not oversized, so the
// caller can test `=== current` for "nothing to do".
//
// Grow: the need expanded by the margins, clamped to the clip, size rounded up
// to the grid. When the grown rect fits inside the current allocation the
// current SIZE is kept and only the position moves, so a caret walking along a
// line slides one backing store rather than allocating a new one per step.
//
// Shrink: only when `allowShrink` (the caller times it) and the current region
// is more than CANVAS_REGION_SHRINK_RATIO times the area the need wants -
// otherwise a region that grew for an effect would snap back the frame the
// effect ended.
// ---------------------------------------------------------------------------
export function fitCanvasRegion(need: Bounds | null, clip: Rect | null, current: Rect | null, opts: { marginX?: number; marginY?: number; grid?: number; allowShrink?: boolean } = {}): Rect | null {
  const marginX = opts.marginX ?? CANVAS_REGION_MARGIN_X;
  const marginY = opts.marginY ?? 32;
  const grid = opts.grid ?? CANVAS_REGION_GRID;
  if (!need || !clip || clip.w <= 0 || clip.h <= 0) return current;
  // The need, clamped to the clip: whatever lies outside the wrapper is
  // clipped by it anyway, so it must not drag the region's size along.
  const cx1 = clip.x + clip.w, cy1 = clip.y + clip.h;
  const nx0 = Math.max(clip.x, Math.floor(need.x0));
  const ny0 = Math.max(clip.y, Math.floor(need.y0));
  const nx1 = Math.min(cx1, Math.ceil(need.x1));
  const ny1 = Math.min(cy1, Math.ceil(need.y1));
  if (nx1 <= nx0 || ny1 <= ny0) return current;

  const contains = current &&
    nx0 >= current.x && ny0 >= current.y &&
    nx1 <= current.x + current.w && ny1 <= current.y + current.h;

  // The rect the need would get if fitted fresh.
  let w = Math.min(clip.w, Math.ceil((nx1 - nx0 + 2 * marginX) / grid) * grid);
  let h = Math.min(clip.h, Math.ceil((ny1 - ny0 + 2 * marginY) / grid) * grid);
  if (contains) {
    if (!opts.allowShrink) return current;
    if (current.w * current.h <= CANVAS_REGION_SHRINK_RATIO * w * h) return current;
  } else if (current && w <= current.w && h <= current.h) {
    // Slide the existing allocation rather than replacing it.
    w = current.w; h = current.h;
  }
  // Centre on the need, then push back inside the clip.
  let x = Math.round((nx0 + nx1) / 2 - w / 2);
  let y = Math.round((ny0 + ny1) / 2 - h / 2);
  if (x + w > cx1) x = cx1 - w;
  if (y + h > cy1) y = cy1 - h;
  if (x < clip.x) x = clip.x;
  if (y < clip.y) y = clip.y;
  if (current && x === current.x && y === current.y && w === current.w && h === current.h) return current;
  return { x, y, w, h };
}

// ---------------------------------------------------------------------------
// Keeping the cursor canvas off the status bar.
//
// The wrapper clips the canvas to the editor pane, and the pane's rect can
// extend under the status bar (a floating one, or while scrolling, when the
// pane briefly reaches the window edge). The clamp used to shorten the
// wrapper to the bar's top across the FULL WIDTH - right for an in-flow bar
// that spans the window, wrong for the floating pill most themes put at the
// bottom right: every caret on the bottom line was cut to a sliver, even
// ones nowhere near the bar (reported with a screenshot, 2026-09-17).
//
// So: a bar that spans the pane still shortens the wrapper; a bar that does
// not keeps the wrapper's height and cuts out only its own rectangle, with
// an L-shaped clip-path (a compositor clip, no paint cost). Pure; `wrapper`
// and `bar` in client coordinates, the bar's `top` being where the cut
// begins. Heights are floored, since a fractional wrapper height forces
// compositor re-uploads (see the clip block in the canvas tick).
// ---------------------------------------------------------------------------
export function wrapperClipForStatusBar(wrapper: { top: number; left: number; width: number; height: number }, bar: { top: number; left: number; right: number }): { height: number; clipPath: string } {
  const { top, left, width } = wrapper;
  const height = wrapper.height;
  const maxBottom = bar.top;
  if (top + height <= maxBottom) return { height, clipPath: "" };
  const spansPane = bar.left <= left + 2 && bar.right >= left + width - 2;
  if (spansPane || !(bar.right > bar.left)) {
    return { height: Math.max(0, Math.floor(maxBottom - top)), clipPath: "" };
  }
  const ny = Math.max(0, Math.floor(maxBottom - top));
  const nx0 = Math.max(0, Math.floor(bar.left - left));
  const nx1 = Math.min(width, Math.ceil(bar.right - left));
  if (nx1 <= nx0) return { height, clipPath: "" };
  // The wrapper minus the notch [nx0, nx1] x [ny, height], as a polygon.
  const W = width, H = height;
  const clipPath = `polygon(0 0, ${W}px 0, ${W}px ${H}px, ${nx1}px ${H}px, ${nx1}px ${ny}px, ${nx0}px ${ny}px, ${nx0}px ${H}px, 0 ${H}px)`;
  return { height, clipPath };
}

// ---------------------------------------------------------------------------
// User-preset helpers
// Presets are stored as { [name]: settingsSnapshot } in plugin data under the
// key "userPresets". They are a full snapshot of settings at save time so
// loading one is always a complete restore, not a partial merge.
// ---------------------------------------------------------------------------
