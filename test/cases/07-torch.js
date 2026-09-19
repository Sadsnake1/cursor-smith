// the torch's flicker, glow and tuning.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("torch: candle flicker");

// Restored as a per-frame write from the torch tick, never as the CSS keyframe
// animation it used to be - that ran on the compositor outside the frame
// governor and pinned the display at full refresh for as long as the torch was
// lit. These tests cover the pure waveform; the tick's ownership of
// --torch-intensity is documented at both writers.
{
  const F = T.torchFlickerScale;
  ok("amount 0 is exactly no-op", F(0, 0) === 1 && F(123456, 0) === 1);
  ok("a negative amount is clamped to no-op", F(500, -1) === 1);

  // Closed-form, not re-rolled: the same instant must give the same value, or
  // the flame would change shape with the frame rate the governor picked.
  ok("deterministic in time", F(4242.5, 0.5) === F(4242.5, 0.5));
  ok("it actually varies over time", F(1000, 0.5) !== F(1050, 0.5));

  // The three sine weights sum to 1, so the signal spans exactly -1..1 and the
  // amount maps straight onto "share of base intensity".
  ok("weights sum to 1", Math.abs(T.TORCH_FLICKER_WEIGHTS.reduce((a, b) => a + b, 0) - 1) < 1e-12);

  // A candle gutters DOWN from steady and comes back; it never flares above its
  // own level. The reference's keyframes run brightness 1.0 to 0.75 and back,
  // never above 1, and this has to hold or the torch reads as a throbbing lamp
  // rather than a flame.
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let t = 0; t < 120000; t += 3) { const v = F(t, 0.35); lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; n++; }
  ok("never brightens past the set level", hi <= 1 + 1e-9, hi);
  ok("never dips below 1 - amount", lo >= 1 - 0.35 - 1e-9, lo);
  ok("uses most of the range it has", (hi - lo) > 0.3, hi - lo);
  ok("sits a little under the set level on average",
     Math.abs(sum / n - (1 - 0.35 / 2)) < 0.02, sum / n);

  // At full depth it gutters right out and back, which is what Flicker Depth
  // promises at 1.
  let lo1 = Infinity, hi1 = -Infinity;
  for (let t = 0; t < 120000; t += 3) { const v = F(t, 1); lo1 = Math.min(lo1, v); hi1 = Math.max(hi1, v); }
  ok("full depth gutters out and back", lo1 < 0.02 && hi1 > 0.98 && hi1 <= 1 + 1e-9, [lo1, hi1]);
}

// ---------------------------------------------------------------------------
section("torch: glow layer and tuning");

{
  const D = T.DEFAULT_SETTINGS;
  // Tuned against 0xatrilla/obsidian-torch-cursor, which ships 0.97 darkness
  // and 1.0 intensity. A near-black room with a strong warm core is what makes
  // it read as a torch; the old 0.7/0.1 pair was a vignette.
  ok("the room is genuinely dark by default", D.overlayDarkness >= 0.85, D.overlayDarkness);
  ok("the glow is strong enough to see", D.overlayIntensity >= 0.35, D.overlayIntensity);
  ok("flicker is on by default, as in the reference", D.overlayFlicker === true);

  // The glow layer must be built and destroyed on demand: a blended layer costs
  // a re-composite of everything beneath it whether or not it paints anything.
  const e = Object.create(Plugin.prototype);
  e.settings = Object.assign({}, D);
  e.glowEl = { removed: false, remove() { this.removed = true; } };
  const stale = e.glowEl;
  ok("asking for no glow returns nothing", e._ensureGlowLayer(false) === null);
  ok("...and tears the layer down rather than hiding it", stale.removed === true && e.glowEl === null);

  // With no overlay there is no document to attach to, and it must say so
  // rather than throwing inside the torch tick.
  e.overlay = null;
  ok("no overlay, no glow layer", e._ensureGlowLayer(true) === null);
}

// ---------------------------------------------------------------------------
section("torch: the settings window and the sidebar");

// Three reports against the packed 1.5.8, all in the torch's choice of
// window and box. The overlay was created in the settings window (no note
// active, activeDocument the settings window since Obsidian 1.13) and
// dimmed it whole; the light chased the settings window's search caret;
// and with "Keep sidebars lit" on, the torch dimmed the active editor's
// pane only - every other tab lit - and fell back to dimming the whole
// window, sidebars included, the moment the note lost focus (a click in
// the sidebar: activeEditor null). The spared-sidebars area is now the
// workspace's main area, every note tab, whichever leaf has focus.
{
  const src = (f) => require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", f), "utf8");
  const torch = src("torch.ts");
  const chain = /ensureTorchOverlayForView\(this[^]*?const targetDoc =([^;]*);/.exec(torch);
  ok("the overlay's document is the editor's, the overlay's own, or the main window's - never activeDocument", !!chain && /view[^]*overlay[^]*document/.test(chain[1]) && !/activeDocument/.test(chain[1]), chain && chain[1]);
  ok("with the sidebars spared the torch dims the main area - every note tab - not the active editor's pane", /const r = spare \? this\.getMainAreaRect\(this\.overlay\.ownerDocument\) : null/.test(torch));
  ok("...whichever leaf has focus: the tick reads no editor for its area", !/getPaneRect\(/.test(torch));
  ok("on a phone the note area is always what is dimmed, whatever the toggle says", /const spare = isMobile \|\| !!this\.look\.overlaySpareSidebars;/.test(torch));
  ok("...and the torch stands down for anything over the note there: a modal or a menu (the observer), an open drawer (the workspace's flags)", /\(isMobile && \(this\._coverOpen \|\| this\._drawerOpen\(\)\)\)/.test(torch) && /querySelector\("body > \.menu, \.menu-container"\)/.test(torch));
  // The drawers, read off the workspace's own flags.
  {
    const d = Object.create(Plugin.prototype);
    d.app = { workspace: { leftSplit: { collapsed: true }, rightSplit: { collapsed: true } } };
    ok("both drawers collapsed: none open", d._drawerOpen() === false);
    d.app.workspace.rightSplit.collapsed = false;
    ok("...one expanded: open", d._drawerOpen() === true);
    d.app = { workspace: { leftSplit: null, rightSplit: null } };
    ok("...no splits at all: none open", d._drawerOpen() === false);
    d.app = { get workspace() { throw new Error("gone"); } };
    ok("...and a throw reads as none open", d._drawerOpen() === false);
  }
  ok("...and darkens only the note tabs of it, standing down with none in front: the views beside them stay lit", /const notes = usePane \? this\.getNoteTabRects\(/.test(torch) && /hideForModal = \(spare && \(this\.modalOpen \|\| \(notes !== null && notes\.length === 0\)\)\)/.test(torch) && /_torchPaintDarkness\(local, rKey, this\.look\.overlayDarkness, width, height, regions\)/.test(torch));
  ok("the pointer's window is recorded where the pointer is read", /this\._mouseDoc = doc;/.test(src("plugin.ts")));
}

// The main area: the root split - every tab group, none of the docks -
// clamped below a visible titlebar like the pane, cached on the layout
// generation; nothing where a document has no root split and no workspace.
// And its note tabs: each tab group whose front tab (the one not hidden
// with display: none) is a markdown view; the groups showing another view
// - Word-Smith's History, an empty tab - are none of the torch's business.
{
  const m = Object.create(Plugin.prototype);
  let measured = 0;
  const leaf = (type, hidden) => ({ style: { display: hidden ? "none" : "" }, querySelector: () => ({ getAttribute: (n) => (n === "data-type" ? type : null) }) });
  const group = (leaves, rect) => ({ ownerDocument: null, querySelectorAll: () => leaves, getBoundingClientRect: () => rect });
  const groups = [
    group([leaf("markdown", false), leaf("word-smith-history", true)], { top: 0, bottom: 700, left: 300, right: 800, width: 500, height: 700 }),
    group([leaf("word-smith-history", false), leaf("markdown", true)], { top: 0, bottom: 700, left: 800, right: 1100, width: 300, height: 700 }),
    group([leaf("markdown", true), leaf("markdown", false)], { top: 0, bottom: 350, left: 1100, right: 1300, width: 200, height: 350 }),
    group([leaf("empty", false)], { top: 350, bottom: 700, left: 1100, right: 1300, width: 200, height: 350 }),
  ];
  const root = { ownerDocument: null, getBoundingClientRect: () => { measured++; return { top: 0, bottom: 700, left: 300, right: 1300, width: 1000, height: 700 }; }, querySelectorAll: (sel) => (sel === ".workspace-tabs" ? groups : []) };
  const titlebar = { getBoundingClientRect: () => ({ top: 0, bottom: 40, height: 40 }) };
  let hasRoot = true;
  // The chrome insets read the covers off the document too (querySelectorAll, the window size).
  const doc = { body: { classList: { contains: () => false } }, defaultView: { innerWidth: 1330, innerHeight: 702 }, querySelectorAll: () => [], querySelector: (sel) => sel === ".workspace-split.mod-root" ? (hasRoot ? root : null) : sel === ".titlebar" ? titlebar : null };
  root.ownerDocument = doc;
  for (const g of groups) g.ownerDocument = doc;
  const r = m.getMainAreaRect(doc);
  ok("the main area is the root split, below the titlebar", !!r && r.left === 300 && r.right === 1300 && r.top === 40 && r.bottom === 700 && r.width === 1000 && r.height === 660, r);
  const notes = m.getNoteTabRects(doc);
  ok("the note tabs are the groups with a note in front, the titlebar clamp applied", notes.length === 2 && notes[0].left === 300 && notes[0].top === 40 && notes[0].width === 500 && notes[1].left === 1100 && notes[1].top === 40 && notes[1].height === 310, notes);
  ok("...a group with a note behind another view is not one, nor an empty tab", !notes.some((b) => b.left === 800 || b.top === 350));
  ok("...cached with the area: a second call measures nothing", m.getMainAreaRect(doc) === r && m.getNoteTabRects(doc) === notes && measured === 1, measured);
  m._layoutGen = 1;
  ok("...and a layout change measures again", m.getMainAreaRect(doc) !== r && measured === 2, measured);
  hasRoot = false; m._layoutGen = 2;
  ok("no root split and no workspace, no area: the torch dims the window instead", m.getMainAreaRect(doc) === null && m.getNoteTabRects(doc).length === 0);
}

// The target: a caret or a pointer in another window, or outside the lit
// box, leaves the light where it is.
{
  const mainDoc = { name: "main" }, otherDoc = { name: "settings" };
  const e = Object.create(Plugin.prototype);
  // look is a getter on the prototype (derived from the settings); the fake gets its own.
  Object.defineProperty(e, "look", { value: { overlayFollowMode: "caret" }, writable: true });
  e.overlay = { ownerDocument: mainDoc };
  e.canvasWrapper = { ownerDocument: otherDoc };
  e._overlayBox = null;
  e.lastCaret = { x: 100, top: 200, bottom: 220 };
  e.lastCaretMove = 0; e.lastMouseMove = 0; e.mouseX = 0; e.mouseY = 0; e._mouseDoc = null;
  e.tx = 100; e.ty = 210;
  let measured = { x: 10, top: 20, bottom: 40 };
  e.caretCoords = () => measured;
  ok("a caret in another window is not a target: the light stays", e.updateOverlayTarget() === false && e.lastCaret.x === 100 && e.tx === 100 && e.ty === 210, [e.tx, e.ty]);
  e.canvasWrapper.ownerDocument = mainDoc;
  e.updateOverlayTarget();
  ok("...a caret in the torch's window is", e.lastCaret === measured && e.tx === 10 && e.ty === 30, [e.tx, e.ty]);
  e._overlayBox = { top: 0, left: 0, width: 50, height: 50 };
  measured = { x: 200, top: 20, bottom: 40 };
  e.updateOverlayTarget();
  ok("a caret outside the lit box (the sidebar's search field, sidebars spared) is not", e.lastCaret.x === 10 && e.tx === 10, [e.tx, e.ty]);
  measured = { x: 25, top: 20, bottom: 40 };
  e.updateOverlayTarget();
  ok("...one inside it is", e.lastCaret.x === 25 && e.tx === 25, [e.tx, e.ty]);
  // Inside the box but outside every note tab - a caret in a lit view
  // beside the notes, the History panel's search field - is not one either.
  e._torchRegions = [{ left: 0, top: 0, width: 30, height: 50, right: 30, bottom: 50 }];
  measured = { x: 40, top: 20, bottom: 40 };
  e.updateOverlayTarget();
  ok("a caret inside the area but outside the note tabs is not a target", e.lastCaret.x === 25 && e.tx === 25, [e.tx, e.ty]);
  measured = { x: 20, top: 20, bottom: 40 };
  e.updateOverlayTarget();
  ok("...one in a note tab is", e.lastCaret.x === 20 && e.tx === 20, [e.tx, e.ty]);
  e._torchRegions = null;
  measured = { x: 25, top: 20, bottom: 40 };
  e.updateOverlayTarget();
  // The pointer, likewise.
  e.look.overlayFollowMode = "mouse";
  e.mouseX = 30; e.mouseY = 30; e._mouseDoc = otherDoc;
  ok("a pointer last seen in another window is not a target", e.updateOverlayTarget() === true && e.tx === 25, [e.tx, e.ty]);
  e._mouseDoc = mainDoc;
  e.updateOverlayTarget();
  ok("...one in the torch's window is", e.tx === 30 && e.ty === 30, [e.tx, e.ty]);
  e.mouseX = 500;
  e.updateOverlayTarget();
  ok("...unless it is outside the lit box", e.tx === 30 && e.ty === 30, [e.tx, e.ty]);
  e.mouseX = 40; e._mouseDoc = null;
  e.updateOverlayTarget();
  ok("a pointer never seen in any window yet counts as here", e.tx === 40, [e.tx, e.ty]);
  e.overlay = null; e.mouseX = 45; e._mouseDoc = otherDoc; e._overlayBox = null;
  e.updateOverlayTarget();
  ok("with no overlay there is no window to be outside of", e.tx === 45, [e.tx, e.ty]);
}
