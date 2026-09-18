// the canvas follows the caret (#30).
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("the canvas follows the caret (issue #30)");

// Issue #30: with hardware acceleration off, Chromium's software compositor
// re-composites the whole on-screen area of the canvas element every frame it
// changes - the damage rect is irrelevant to it. Measured in a live Obsidian:
// a full-window canvas took idle from 6% to 24% of a core and typing from 19%
// to 75%; the same plugin drawing into a 320x160 element round the caret took
// half of that, and sizing the backing store to the pane changed nothing. So
// the element is now a region fitted round what has to be visible, and these
// pin the two halves: the pure geometry, and the engine's use of it.
{
  const fit = T.fitCanvasRegion;
  const GRID = T.CANVAS_REGION_GRID;
  const clip = { x: 100, y: 50, w: 1000, h: 700 };
  const opts = { marginX: 160, marginY: 32, grid: GRID, allowShrink: false };

  // --- fitCanvasRegion: pure geometry -------------------------------------
  {
    const need = { x0: 400, y0: 300, x1: 410, y1: 324 };
    const r = fit(need, clip, null, opts);
    ok("a fresh fit is a region", !!r, r);
    ok("...that contains the need",
       r.x <= 400 && r.y <= 300 && r.x + r.w >= 410 && r.y + r.h >= 324, r);
    ok("...with the margins round it",
       r.x <= 400 - 160 && r.x + r.w >= 410 + 160 && r.y <= 300 - 32 && r.y + r.h >= 324 + 32, r);
    ok("...sized on the grid", r.w % GRID === 0 && r.h % GRID === 0, r);
    ok("...and far smaller than the clip", r.w * r.h < clip.w * clip.h / 4, r);
    ok("...inside the clip",
       r.x >= clip.x && r.y >= clip.y && r.x + r.w <= clip.x + clip.w && r.y + r.h <= clip.y + clip.h, r);

    // A need the region already covers is a no-op, by identity, so the caller
    // can test `=== current` and skip the blank-and-repaint.
    ok("a covered need returns the current region itself",
       fit({ x0: 405, y0: 302, x1: 420, y1: 326 }, clip, r, opts) === r);
    ok("a null need keeps the current region", fit(null, clip, r, opts) === r);
    ok("a need entirely outside the clip keeps the current region",
       fit({ x0: 5, y0: 5, x1: 20, y1: 20 }, clip, r, opts) === r);

    // Typing along a line: the need drifts right, out of the margin. The
    // region SLIDES - same allocation, new position - rather than growing.
    const far = { x0: r.x + r.w + 10, y0: 300, x1: r.x + r.w + 20, y1: 324 };
    const slid = fit(far, clip, r, opts);
    ok("a need past the margin re-anchors", slid !== r);
    ok("...keeping the allocation's size", slid.w === r.w && slid.h === r.h, { r, slid });
    ok("...and containing the new need",
       slid.x <= far.x0 && slid.x + slid.w >= far.x1, { far, slid });

    // A need bigger than the clip is the clip.
    const huge = fit({ x0: 0, y0: 0, x1: 5000, y1: 5000 }, clip, r, opts);
    ok("a need larger than the clip gives the whole clip",
       huge.x === clip.x && huge.y === clip.y && huge.w === clip.w && huge.h === clip.h, huge);

    // Shrinking waits for permission, and even then only from a region more
    // than CANVAS_REGION_SHRINK_RATIO (2x) what the need wants.
    ok("an oversized region is kept without allowShrink",
       fit(need, clip, huge, opts) === huge);
    const shrunk = fit(need, clip, huge, Object.assign({}, opts, { allowShrink: true }));
    ok("...and shrunk with it", shrunk !== huge && shrunk.w * shrunk.h < huge.w * huge.h / 4, shrunk);
    ok("a region only a little too big is not shrunk",
       fit(need, clip, Object.assign({}, r, { w: r.w + GRID }), Object.assign({}, opts, { allowShrink: true })).w === r.w + GRID);

    // Never partly outside the clip, whatever the need does.
    const edge = fit({ x0: clip.x + clip.w - 5, y0: clip.y + clip.h - 5, x1: clip.x + clip.w + 50, y1: clip.y + clip.h + 50 }, clip, null, opts);
    ok("a need at the clip's corner is pushed back inside",
       edge.x + edge.w <= clip.x + clip.w && edge.y + edge.h <= clip.y + clip.h && edge.x >= clip.x && edge.y >= clip.y, edge);
  }

  // --- the engine's use of it ---------------------------------------------
  // A stand-in for the engine with a recording canvas: enough to run
  // _fitCanvasRegion and draw() with every painter stubbed out.
  const makeRegionEngine = (settings = {}) => {
    const e = Object.create(Plugin.prototype);
    e._resetEngineState();
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, settings);
    e.styleFor = (k) => e.settings[k];
    e.canvas = {
      width: 0, height: 0, style: {},
      ownerDocument: { defaultView: { devicePixelRatio: 2 } },
    };
    const calls = [];
    e.ctx = {
      calls,
      save() {}, restore() {},
      setTransform(...m) { calls.push({ op: "setTransform", m }); e.ctx.matrix = m; },
      clearRect(x, y, w, h) { calls.push({ op: "clearRect", x, y, w, h }); },
    };
    e._clipRect = { x: 100, y: 50, w: 1000, h: 700 };
    e._wrapperPos = { left: 100, top: 50 };
    e._canvasRect = null;
    e._canvasDpr = 0;
    e._dirtyFull = true;
    // Painters: none paint, except what a test hangs on `paintExtra`.
    for (const f of ["drawLettersParticles", "drawBracketTether", "drawStardust",
                     "drawFlamePixels", "drawHotHead", "drawThunderbolts",
                     "drawFireworks", "drawGenericCaret", "drawBoxCursor",
                     "drawSecondaryCarets", "applyCanvasBlend"]) {
      e[f] = () => { if (f === "drawFlamePixels" && e.paintExtra) e._markDirty(...e.paintExtra); };
    }
    e.breathScale = () => 1;
    e.glowHeatScale = () => 1;
    e.setCaret = (x, top) => {
      e.lastActive = { x, top, w: 8, h: 24, actualCharWidth: 8 };
      e.animActive = Object.assign({}, e.lastActive);
    };
    return e;
  };
  const allocs = (e) => e.ctx.calls.filter((c) => c.op === "setTransform").length;

  {
    const e = makeRegionEngine();
    ok("no caret, nothing painted: no region and no draw", e._fitCanvasRegion() === false && e._canvasRect === null);

    e.setCaret(400, 300);
    ok("the first caret allocates a region", e._fitCanvasRegion() === true && !!e._canvasRect, e._canvasRect);
    const r0 = e._canvasRect;
    ok("...far smaller than the clip", r0.w * r0.h < e._clipRect.w * e._clipRect.h / 4, r0);
    ok("...with the backing store sized to it at the DPR",
       e.canvas.width === r0.w * 2 && e.canvas.height === r0.h * 2, { r0, w: e.canvas.width, h: e.canvas.height });
    ok("...the context translated by the region's origin",
       e.ctx.matrix.join() === [2, 0, 0, 2, -r0.x * 2, -r0.y * 2].join(), e.ctx.matrix);
    ok("...and the element placed relative to the wrapper",
       e.canvas.style.transform === `translate(${r0.x - 100}px, ${r0.y - 50}px)`, e.canvas.style.transform);

    // A fresh allocation is blank, so the full clear enableCanvasEngine
    // requested has nothing to do - and draw() must not clear the window.
    e.draw();
    ok("a fresh store needs no clear at all", e.ctx.calls.filter((c) => c.op === "clearRect").length === 0);
    ok("the caret's damage lands inside the region",
       e._dirtyPrev && e._dirtyPrev.x >= r0.x && e._dirtyPrev.x + e._dirtyPrev.w <= r0.x + r0.w, e._dirtyPrev);
    ok("...and the cursor is not in the effects-only union", e._dirtyRaw === null, e._dirtyRaw);
    // A full clear (the clip window moved, Hot-head scrolled) covers the
    // region and nothing more.
    e._dirtyFull = true;
    e.draw();
    const clears = e.ctx.calls.filter((c) => c.op === "clearRect");
    ok("a pending full clear covers the region and nothing more",
       clears.length === 1 && clears[0].x === r0.x && clears[0].y === r0.y && clears[0].w === r0.w && clears[0].h === r0.h, clears);

    // Blinking, breathing, a keystroke or two: nothing re-anchors.
    const before = allocs(e);
    e.setCaret(408, 300); e.draw();
    e.setCaret(416, 300); e.draw();
    ok("a caret moving inside the margin keeps the region", e._fitCanvasRegion() === false && e._canvasRect === r0);
    ok("...with no reallocation", allocs(e) === before);

    // Out past the margin: the region slides, keeping its allocation.
    e.setCaret(r0.x + r0.w + 40, 300);
    ok("a caret past the margin re-anchors", e._fitCanvasRegion() === true && e._canvasRect !== r0);
    const r1 = e._canvasRect;
    ok("...by sliding the same allocation", r1.w === r0.w && r1.h === r0.h && e.canvas.width === r0.w * 2, { r0, r1 });
    ok("...blanking it rather than trusting stale pixels", e._dirtyPrev === null);
    ok("...and re-placing the element", e.canvas.style.transform === `translate(${r1.x - 100}px, ${r1.y - 50}px)`);
  }

  // A painter that reaches outside the region is clipped this frame and
  // pulled in next frame - the unclamped record is what makes that work.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion(); e.draw();
    const r0 = e._canvasRect;
    e.paintExtra = [r0.x + r0.w + 200, 300, 10, 10]; // a flame pixel well outside
    e.draw();
    ok("the clear rect is clamped to the region",
       e._dirtyPrev.x + e._dirtyPrev.w <= r0.x + r0.w, { prev: e._dirtyPrev, r0 });
    ok("...but the painted union is recorded unclamped",
       e._dirtyRaw.x1 >= r0.x + r0.w + 210, e._dirtyRaw);
    ok("and the next fit grows the region to include it",
       e._fitCanvasRegion() === true && e._canvasRect.x + e._canvasRect.w >= r0.x + r0.w + 210, e._canvasRect);
  }

  // Far-reaching effects get the whole clip while live, and the region
  // shrinks back only after the cooldown.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion();
    const small = e._canvasRect;
    e.thunderbolts.push({});
    e._fitCanvasRegion();
    const c = e._clipRect;
    ok("a live thunderbolt claims the whole clip window",
       e._canvasRect.x === c.x && e._canvasRect.y === c.y && e._canvasRect.w === c.w && e._canvasRect.h === c.h, e._canvasRect);
    e.thunderbolts.length = 0;
    e.draw();
    ok("the frame after it expires keeps the big region", e._fitCanvasRegion() === false && e._canvasRect.w === c.w);
    // Age the oversized stamp past the cooldown.
    e._regionOversizedT = performance.now() - T.CANVAS_REGION_SHRINK_MS - 1;
    ok("...and shrinks once the cooldown has passed",
       e._fitCanvasRegion() === true && e._canvasRect.w * e._canvasRect.h <= small.w * small.h, e._canvasRect);

    const f = makeRegionEngine();
    f.setCaret(400, 300);
    f.fireworks.push({});
    f._fitCanvasRegion();
    ok("a live firework shell claims the whole clip window too", f._canvasRect.w === f._clipRect.w && f._canvasRect.h === f._clipRect.h);
  }

  // The need is the union of everything known before the draw.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    const clip = e._clipRect;
    const base = e._frameNeed(clip);
    ok("the need spans the cursor's own damage bounds",
       base.x0 < 400 && base.x1 > 408 && base.y0 < 300 && base.y1 > 324, base);
    e.secondaryCarets.push({ x: 900, top: 600, bottom: 624 });
    ok("...a secondary caret", e._frameNeed(clip).x1 >= 900 && e._frameNeed(clip).y1 >= 624);
    e.secondaryCarets.length = 0;
    e.bracketTether = [{ x1: 400, y1: 300, x2: 150, y2: 100 }];
    ok("...the bracket tether", e._frameNeed(clip).x0 <= 150 && e._frameNeed(clip).y0 <= 100);
    e.bracketTether = null;
    e._dirtyRaw = { x0: 700, y0: 500, x1: 720, y1: 520 };
    const n = e._frameNeed(clip);
    ok("...and last frame's painted union, padded for motion",
       n.x1 >= 720 + T.CANVAS_REGION_MOTION_PAD && n.y1 >= 520 + T.CANVAS_REGION_MOTION_PAD, n);
    // Smooth movement: the target, not just the interpolated caret, so the
    // region grows toward the destination instead of chasing it.
    e._dirtyRaw = null;
    e.animActive = { x: 400, top: 300, w: 8, h: 24, actualCharWidth: 8 };
    e.lastActive = { x: 640, top: 300, w: 8, h: 24, actualCharWidth: 8 };
    ok("...and the smooth-movement target", e._frameNeed(clip).x1 >= 648);
  }

  // A clip window that moves out from under the region invalidates it.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion();
    e._clipRect = { x: 600, y: 50, w: 500, h: 700 };
    e.setCaret(700, 300);
    ok("a region outside the new clip is refitted", e._fitCanvasRegion() === true && e._canvasRect.x >= 600, e._canvasRect);
  }

  // ...and when there is no caret left to refit it for, the store is blanked
  // rather than left holding the last frame. The element keeps the transform
  // the old wrapper gave it, so with the wrapper moved those pixels would
  // show through somewhere else - frozen, since draw() never runs without a
  // region. Seen as the caret ghost on the settings sidebar's "Options"
  // heading after clicking from the search box to a tab.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion();
    e.paintExtra = [380, 280, 40, 40];
    e.draw();
    const r0 = e._canvasRect;
    ok("something is painted", !!e._dirtyPrev);
    // Focus leaves the field: no caret, and a clip the region lies outside.
    e.lastActive = null;
    e.animActive = null;
    e.paintExtra = null;
    e._clipRect = { x: 0, y: 50, w: 250, h: 700 };
    e._wrapperPos = { left: 0, top: 50 };
    e.ctx.calls.length = 0;
    ok("the region is dropped", e._fitCanvasRegion() === false && e._canvasRect === null);
    const wipe = e.ctx.calls.find((c) => c.op === "clearRect");
    ok("...and the whole store is blanked with it",
       wipe && wipe.x === 0 && wipe.y === 0 && wipe.w === r0.w * 2 && wipe.h === r0.h * 2, e.ctx.calls);
    ok("...under the identity transform", e.ctx.calls[0].op === "setTransform" && e.ctx.calls[0].m.join() === "1,0,0,1,0,0", e.ctx.calls[0]);
    ok("...with the damage records dropped", e._dirtyPrev === null && e._dirtyRaw === null);
  }

  // A wrapper that moves while the region stays inside its clip re-places
  // the element against the new origin, so the pixels stay where they were
  // painted.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion();
    const r0 = e._canvasRect;
    e._clipRect = { x: 0, y: 40, w: 1200, h: 800 };
    e._wrapperPos = { left: 0, top: 40 };
    e._canvasPlaced = false;
    ok("a moved wrapper keeps the region", e._fitCanvasRegion() === false && e._canvasRect === r0);
    ok("...and re-places the element against it",
       e.canvas.style.transform === `translate(${r0.x}px, ${r0.y - 40}px)`, e.canvas.style.transform);
  }

  // Re-enabling the engine (a cursor-style change restarts it) blanks a
  // surviving store for the same reason: no region, no draw, no clear.
  {
    const e = makeRegionEngine();
    e.setCaret(400, 300);
    e._fitCanvasRegion();
    e.paintExtra = [380, 280, 40, 40];
    e.draw();
    e.ctx.calls.length = 0;
    e.registerWindowEvents = () => {};
    e.app = { workspace: { activeEditor: null, on: () => ({}), getLeavesOfType: () => [] } };
    e.registerEvent = () => {};
    const raf = global.requestAnimationFrame;
    global.requestAnimationFrame = () => 1;
    try { e.enableCanvasEngine(); } catch (err) { ok("enableCanvasEngine runs on the stand-in", false, err.message); }
    global.requestAnimationFrame = raf;
    ok("enabling the engine blanks a surviving store",
       e.ctx.calls.some((c) => c.op === "clearRect" && c.x === 0 && c.y === 0) && e._canvasRect === null, e.ctx.calls.slice(0, 3));
  }

  // The window-sized store is gone for good: resizeCanvas is the region's
  // allocator and does nothing without one.
  {
    const e = makeRegionEngine();
    e.resizeCanvas();
    ok("resizeCanvas without a region allocates nothing", e.canvas.width === 0 && allocs(e) === 0);
  }
}
