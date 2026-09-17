const { Plugin, PluginSettingTab, Setting, Notice, View } = require("obsidian");

// ===========================================================================
// Cursor-Smith — READ THIS BEFORE EDITING
//
// ~9.8k lines in one file because Obsidian loads a single main.js and there
// is no build step. It is navigated by grep, not by scrolling. See
// ARCHITECTURE.md for the full tour; this header is the short version plus
// the rules that are expensive to rediscover.
//
// LAYOUT, in order:
//   1. Tuning constants        (DIRTY_RECT_CLEAR … FIREWORK_*, THUNDER_*)
//   2. DEFAULT_SETTINGS        — 116 keys, the single source of truth
//   3. LOOK_KEYS / VIM_STATE_KEYS
//   4. migrateLegacyKeys       — renamed/regrouped keys, runs on ALL loads
//   5. Built-in presets        (PRESET1_VIM_MODES, DEFAULT_PRESETS, …)
//   6. Share-code codec        (presetToCode / codeToPreset, "1|…" and "2|…")
//   7. Pure helpers            (colour maths, easing, geometry)
//   8. class CursorSmithPlugin — lifecycle, input, engine, every effect
//   9. class CursorSmithSettingTab — the panel
//
// FINDING THINGS: grep the symbol. Effects follow a strict naming convention,
// so `grep -n "Fireworks\|Thunderbolt" main.js` finds every touchpoint of one
// effect: spawnX / drawX, a gate in commitMove, a pool reset in three places,
// an entry in the frame governor's `animating` check, and a settings block.
//
// INVARIANTS — breaking these fails silently, not loudly:
//
//  • LOOK_KEYS IS APPEND-ONLY. Share codes encode a field as its INDEX in
//    this array. Reordering or removing an entry silently reinterprets every
//    code ever shared. Add to the end; never insert.
//
//  • ADDING AN EFFECT MEANS FIVE EDITS, not two. spawn + draw are the obvious
//    ones. Also: reset the pool in _resetEngineState (ONE place now - it used
//    to be three hand-copied lists, and they had already drifted apart), add
//    it to _isAnimating or it will freeze mid-animation, call its draw from
//    draw(), and _markDirty its region or it leaves ghosts.
//
//  • GENERATE AT SPAWN, ADVANCE CLOSED-FORM AT DRAW. Every effect bakes its
//    randomness once and animates as a pure function of elapsed time. Rolling
//    per frame makes the effect boil, and ties its shape to whichever gear
//    the frame governor picked.
//
//  • NO CSS ANIMATIONS on cursor layers, in styles.css. They
//    run on the compositor, outside the frame governor, and hold the display
//    at full refresh regardless of what the governor decided. Anything that
//    must pulse is written as a custom property from a tick instead - the
//    torch's blink pulse and its candle flicker are both done that way.
//
//  • ANYTHING PUT INTO A DOCUMENT MUST COME BACK OUT in unregisterDocument -
//    listeners and body classes. Obsidian updates a plugin by unloading and
//    reloading it WITHOUT a window reload, so anything left behind outlives
//    the version that created it.
//
//  • A BLEND INSIDE THE CURSOR WRAPPER composites against the wrapper, not the
//    editor - the wrapper is a stacking context. Anything that must blend with
//    the editor needs its own sibling layer under .app-container. See
//    ARCHITECTURE.md, "Blending against the editor".
//
//  • ALL CSS IS styles.css. Obsidian clones every stylesheet in the main
//    window's head into each pop-out and into the 1.13 settings window, so
//    the one file reaches every document the canvas migrates into; the
//    review forbids a plugin creating <style> elements, and the injected
//    copy this used to keep is gone. Whatever a tick drives per frame is a
//    custom property on the element (the torch's --torch-glow), never a
//    rule. mix-blend-mode on the canvas wrapper is set from applyCanvasBlend.
//
//  • THE CANVAS IS CLIPPED, NOT Z-INDEXED, to the editor pane (editorClip).
//    A full-viewport layer over the titlebar breaks Electron window dragging
//    even when invisible.
//
//  • SETTINGS READS GO THROUGH this.settings, which is SWAPPED per Vim mode
//    during the tick. Don't cache values across frames; use styleFor(key).
//
// TESTS: `node test.js` runs the whole file outside Obsidian with the Obsidian
// API stubbed (harness.js), plus a settings-panel render harness
// (panel_harness.js). 228 assertions covering migration, share codes, colour
// precedence, effect physics, the frame governor's gear decision, the engine
// state reset, and which rows the panel actually builds.
//
//  • A settings row that throws while being built removes ITSELF AND EVERY ROW
//    AFTER IT from the panel, silently. renderLookSettings has no `plugin`
//    binding - only `this.plugin` - and reads settings through `get`, never
//    this.plugin.settings, because it also renders the per-Vim-mode panels.
//    Add a panel assertion for any new row.
// ===========================================================================

// Clear only the region the previous frame actually painted, instead of the
// whole viewport-sized surface. See the damage-tracking notes above draw().
// Flip to false to restore full-surface clears if you ever see ghost pixels.
const DIRTY_RECT_CLEAR = true;

// The canvas element follows the caret rather than covering the window - see
// fitCanvasRegion() and _fitCanvasRegion(). Issue #30: with hardware
// acceleration off, Chromium's software compositor re-composites the whole
// ON-SCREEN AREA of the canvas element every frame it changes, whatever the
// damage rect says; measured, a full-window canvas took an idle editor from 6%
// to 24% of a core and typing from 19% to 75%, and a 320x160 canvas around the
// caret halved both. The backing-store size made no difference - only the
// element's footprint does.
//
// How far past what must be visible the region extends, so an ordinary
// keystroke or a caret moving down a line does not re-anchor the canvas every
// frame. Re-anchoring is a blank-and-repaint of the (small) surface, and it is
// cheap: measured, 96px of horizontal margin re-anchored three times in ten
// seconds of typing. Every pixel of margin is composited every frame, so the
// margins are kept as small as that allows.
const CANVAS_REGION_MARGIN_X = 96;    // px either side
const CANVAS_REGION_MARGIN_Y = 1.5;   // line heights above and below
// Sizes are rounded up to this grid so a region that moves without growing
// keeps its backing store instead of reallocating one a few pixels larger.
const CANVAS_REGION_GRID = 64;
// A region more than CANVAS_REGION_SHRINK_RATIO times the area it is showing
// is shrunk back, but only after it has been that oversized for this long, so
// a volley of fireworks or a run of Enter strikes does not thrash the
// allocation between the pane and the caret. The ratio is 2, not 4: with 4 a
// region that had grown to the pane's full width for a line wrap sat at 3.4x
// its need for as long as the caret stayed on that line, and that was most
// of the idle cost this whole mechanism exists to remove.
const CANVAS_REGION_SHRINK_MS = 2000;
const CANVAS_REGION_SHRINK_RATIO = 2;
// How much of last frame's painted rect to pad for the motion of whatever was
// in it: particles move a few px a frame, and anything that escapes this is
// clipped for exactly one frame before the region grows to include it.
const CANVAS_REGION_MOTION_PAD = 32;

// How much Speed Demon's heat inflates the CRT glow, as a multiplier on top of
// the base blur: 1 + GLOW_HEAT_GAIN at full heat. Only applies when Speed Demon
// and the CRT glow are BOTH on - see glowHeatScale. Raising this past ~2 starts
// to bloom far enough that the damage pad in the caret's dirty rect (which is
// widened by the same factor, see drawCursor) dominates the frame's clear cost.
// Fraction of the heat range the custom ramp spends easing out of the cursor's
// own colour and into stage 1.
//
// Without it, stage 1 IS the resting colour, so a custom ramp replaced the
// cursor's colour whenever you stopped typing - heat decays to zero after a few
// seconds of silence, so most of the time you saw stage 1 and not the colour you
// picked. Reported as "it paints the cursor with the first of the four colours",
// and it is the same complaint as the cold-end damping in the built-in curve:
// Speed Demon is supposed to add heat on top of your cursor, not take the colour
// away and hand it back as a reward for typing.
//
// A hard `heat === 0 ? base : ramp` would snap on the first keystroke, so the
// bottom slice of the range is spent blending instead. All four stops stay
// reachable - stage 1 lands exactly at this value rather than at zero.
const SPEED_RAMP_LIFTOFF = 0.12;

const GLOW_HEAT_GAIN = 1.6;

// Speed Demon's answer to "how much heat is this keystroke worth" - including
// zero, which means "ignore it entirely". Pulled out to module level so the
// repeat rules are testable as data; noteKeystroke (in registerWindowEvents)
// supplies the sensitivity multiplier and the 0.09 base bump on top.
//
// The repeat column is the part with history. Autorepeat used to be allowed
// for navigation ONLY - the reasoning being that holding an arrow key IS the
// fast way to move, while leaning on "a" is not typing. Correct for character
// keys, but "delete" fell into the character bucket, and holding Backspace IS
// the fast way to delete: every repeat removes a real character, exactly the
// argument that got navigation its exemption. Dropping those repeats produced
// a platform split that shipped as a bug report: on desktop a held Backspace
// autorepeats through keydown with e.repeat set, so only the first press ever
// counted and the heat colour drained away mid-deletion - while on mobile
// there is no keydown autorepeat at all (each deletion is its own beforeinput
// event, no repeat flag), so the same gesture heated up fine. The platform
// where the guard was written is the one where it misfired.
//
// Weights: a held delete is real editing arriving at machine rate rather than
// finger rate, so it takes the same kind of discount navigation's autorepeat
// does (0.45/0.7 of the hand-pressed rate) off its full press weight of 1.
// Held character keys stay at 0 - that part of the old rule was right.
function keystrokeHeatWeight(kind, repeat) {
  if (kind === "nav") return repeat ? 0.45 : 0.7;
  if (kind === "delete") return repeat ? 0.7 : 1;
  return repeat ? 0 : 1;
}

// Frame intervals for the render loops' gears, normal and Low Power. One
// table, read through _frameCaps(), so the setting is one comparison.
//
//   hotMinMs      the hot gear's cap: frames closer than this are skipped.
//                 14 caps a 120Hz display near 60fps; 30 is ~30fps.
//   warmMs        blink fades. 33 covers a ~300ms ease smoothly.
//   energyMs      the energy shimmer when it is the only thing animating. The
//                 gradient's pulse has roughly a 1.7s period at speed 1, so
//                 50ms is ~33 samples per cycle - looked at next to 33ms
//                 (~50 samples) and told apart by nobody; 100 is ~17 and
//                 starts to show stepping in the travelling wave.
//   idleMs        the idle heartbeat: re-check state and repaint only if the
//                 picture changed. 200, up from 100: every wake source
//                 (input, scroll, focus, resize) snaps the loop to hot
//                 instantly, so the heartbeat only ever catches what has no
//                 event - a theme toggle, a layout shift - and 200ms is fine
//                 for those. Halves the idle tick count.
//   torchPulseMs  the torch's blink-sync pulse and candle flicker: the radius
//                 only moves during the blink's two short fades, and a flame
//                 is turbulence, not motion.
//   torchIdleMs   the torch's parked heartbeat.
//
// Low Power halves the hot gear and slows the rest, for a laptop on battery
// or a machine where Obsidian feels slower with the plugin on. Measured with
// hardware acceleration off (issue #30), typing draws ~62 frames a second at
// the normal caps because every keystroke's particles outlive the gap to the
// next; the hot cap is the lever that halves that, and it is the one visible
// change here - the smear and particles step more coarsely.
// How long a cached caret geometry (coordsAtPos) or pane rect is trusted
// without any invalidation event, in ms. The caches are keyed on a layout
// generation that every wake source bumps (input, scroll, focus, resize,
// css-change, layout-change, a ResizeObserver on the editor content), so
// this only backstops what has no event at all - an image finishing its
// load inside a line, say - and bounds how stale the caret can briefly be.
const GEOMETRY_TTL_MS = 400;

// The torch's two layers are canvases painted at this fraction of the pane's
// size and scaled up by the compositor. The darkness is a soft radial ramp
// and the glow a softer one: at a quarter of the resolution a 140px light's
// edge is still a 10px-wide fade in the bitmap, and the bilinear upscale
// blurs it by about two screen pixels, which on a gradient is nothing. What
// it buys is sixteen times less to rasterise on every frame a light moves or
// the radius pulses - and with hardware acceleration off that raster was the
// torch's cost: a pane-sized radial gradient on the CPU per frame.
const TORCH_CANVAS_SCALE = 0.25;

const FRAME_CAPS = {
  normal:   { hotMinMs: 14, warmMs: 33, energyMs: 50, idleMs: 200, torchPulseMs: 33, torchIdleMs: 150 },
  lowPower: { hotMinMs: 30, warmMs: 50, energyMs: 80, idleMs: 250, torchPulseMs: 50, torchIdleMs: 250 },
};

// Thunderstrike (Pop Effects sub-option) tuning.
//
// How long one strike lives, in ms. Deliberately short: lightning is an event,
// not an animation, and anything that outstays the keystroke turns pressing
// Enter into a light show.
const THUNDER_LIFE_MS = 280;
// Widest the bolt may lean off vertical, in radians (~54 degrees). The brief is
// "from up top", so it can come in at an angle but never sideways.
const THUNDER_MAX_ANGLE = 0.95;
// Shortest a bolt may be, in pixels. Without a floor, a strike landing on the
// first visible line - where there is barely any pane above the caret to come
// from - would be a stub a few pixels long.
const THUNDER_MIN_REACH = 150;
// Midpoint-displacement passes. Each one doubles the segment count, so 5 gives
// 32 segments: enough to read as forked lightning, few enough to stay cheap.
const THUNDER_PASSES = 5;
// Most strikes allowed on screen at once. Holding Enter down would otherwise
// stack a bolt per repeat and bury the editor.
const THUNDER_MAX_LIVE = 3;
// The colours a strike can be built from. Every bolt picks two or three of
// these at random and ramps between them from the sky end down to the impact,
// so no two strikes look alike. Deliberately NOT tied to the cursor colour:
// lightning reads as its own light source, and a bolt in the same green as the
// caret it lands on just looks like the caret grew a tail.
const THUNDER_PALETTE = [
  [110, 165, 255],  // blue
  [175, 120, 255],  // purple
  [255, 95, 115],   // red
  [255, 216, 120],  // yellow
  [255, 255, 255],  // white
];
// Colour steps along the bolt. The ramp is quantised into this many bands so a
// frame costs a dozen fillStyle changes instead of one per block - at the finest
// bolt size a strike is several hundred blocks, and re-deriving a colour string
// for every one of them on every frame is most of the effect's cost for no
// visible gain over a banded ramp.
const THUNDER_BANDS = 14;

// Fireworks (Pop Effects sub-option) tuning.
//
// A shell climbs out of the caret, bursts above it, and the sparks fall. Split
// into two timings because they are two different events: the climb should be
// quick enough to still feel attached to the keystroke that launched it, while
// the fall wants long enough to actually read as falling.
const FIREWORK_RISE_MS = 260;
const FIREWORK_FALL_MS = 620;
// How far above the caret a shell bursts, as a multiple of the line height,
// plus the random spread around it. Measured in line heights rather than
// pixels so the effect keeps its proportions at any font size.
const FIREWORK_RISE_LINES = 3.4;
const FIREWORK_RISE_JITTER = 1.2;
// Sideways lean of the climb, in px. A shell that goes up perfectly straight
// every time reads as mechanical.
const FIREWORK_DRIFT = 26;
// Downward pull on the sparks, px/s². Applied closed-form (½·g·t²) like the
// Pixel Trail's gravity, so the arcs are identical at any refresh rate.
const FIREWORK_GRAVITY = 420;
// Grid the whole effect snaps to, in px - this is what makes it pixel art
// rather than a smooth particle spray. Small, because the fireworks sit in
// running text and a coarse grid turns them into confetti.
const FIREWORK_CELL = 3;
// "Subtle" is the brief, so the whole effect is painted through this ceiling.
// Raising it is the single knob that makes fireworks loud.
const FIREWORK_ALPHA = 0.55;
// Most shells allowed in flight at once, across all keystrokes. Raised from 6
// now that a launch at capacity is SKIPPED rather than allowed to evict a live
// shell (see spawnFireworks): the old cap wasn't bounding cost so much as
// deciding how early a burst got killed.
const FIREWORK_MAX_LIVE = 10;
// Floor on the gap between launches. The live cap alone still lets key-repeat
// spawn a shell every few ms, which costs the work of a full burst to show a
// flicker.
const FIREWORK_MIN_GAP_MS = 70;
// The real bound on GPU cost: total live sparks across every shell in flight.
// Shell count alone doesn't bound anything, because a shell's cost is its
// spark count and the quantity slider triples that.
//
// This is what holding Space now degrades against. A new shell is given
// whatever budget is left rather than a fixed count, so a held key produces
// more, smaller bursts instead of the same expensive burst repeatedly, and the
// per-frame fill stays flat no matter how hard the key is leaned on.
const FIREWORK_SPARK_BUDGET = 260;
// Below this many sparks there's no burst worth drawing, so the launch is
// skipped entirely and the gap timer is left alone for the next attempt.
const FIREWORK_SPARK_MIN = 5;
// Live-spark fraction past which a shell is built cheap: no trails, no
// secondary pops. The expensive extras are what a burst can most afford to
// lose, and losing them is far less visible than losing the burst.
const FIREWORK_PRESSURE = 0.55;
// Blocks of tail behind each falling spark. Each one is another fillRect per
// spark per frame, so this is the single most expensive number here.
const FIREWORK_TRAIL_LEN = 2;
// Fraction of the fall after which sparks start guttering in and out. Twinkle
// is free - a spark that's dark this frame simply isn't drawn - so it makes
// the back half of a burst cheaper as well as livelier.
const FIREWORK_TWINKLE_AT = 0.42;
// How many distinct colours one shell quantises its sparks into. Sparks are
// sorted by colour at spawn so the draw sets fillStyle this many times instead
// of once per spark.
const FIREWORK_PALETTE_MAX = 6;
// Secondary pops: a few sparks detonate again on the way down. Generated at
// spawn like everything else, never at draw time.
const FIREWORK_SECOND_MAX = 3;
const FIREWORK_SECOND_SPARKS = 5;
const FIREWORK_SECOND_AT = [0.30, 0.55];   // range of fall fraction to pop at


// Candle flicker. Three sine terms at deliberately incommensurate rates (in
// rad/s) so the sum never repeats on any period a reader could notice; their
// weights sum to 1, so the combined signal spans -1..1 exactly and the amount
// slider maps straight onto "share of base intensity".
//
// A closed-form function of wall-clock time rather than per-frame randomness,
// for the same reason every effect in this file bakes its randomness at spawn:
// a value re-rolled each frame changes shape with the frame rate, and this runs
// under a governor that deliberately varies it. Sampling this at 30fps and at
// 60fps gives the same flame, just resolved more finely.
const TORCH_FLICKER_RATES = [8.7, 13.1, 21.3];
const TORCH_FLICKER_PHASES = [0, 1.7, 4.2];
const TORCH_FLICKER_WEIGHTS = [0.5, 0.3, 0.2];

// Ceiling on how far Smooth Movement's adaptive catch-up is allowed to stiffen
// the smear's leading corners. See updateSmearQuad.
const SMEAR_LEAD_BOOST_CAP = 6;

// Motion Smear / Conserve volume: the narrowest the smear is ever thinned
// to, as a share of its resting width. A floor, so a very long streak thins
// into a line and not into nothing.
const SMEAR_VOLUME_MIN_FACTOR = 0.35;

// Motion Smear / Tapered Trail: the band of smear-quad stretch, in pixels, over
// which the taper ramps from off to full.
//
// Below TAPER_MIN_LAG the taper is exactly zero, above TAPER_FULL_LAG it's at
// full configured strength, and it ramps linearly between. The floor is the
// important part: ordinary typing keeps the quad stretched by only a handful of
// pixels (roughly one glyph width, sustained), and a pointed comet-tail on
// every keystroke makes text jittery to read. Tapered Trail is really wanted
// for JUMPS - clicking across a line, paging, big arrow motions - which stretch
// the quad far more, so the floor sits above the typing range and the effect
// only shows up once the caret actually leaps. Raise the floor to require an
// even bigger jump; drop it toward zero to go back to tapering everything.
const TAPER_MIN_LAG = 26;
const TAPER_FULL_LAG = 90;

// Pixel Trail / Trail On Jump. A move counts as a "jump" (rather than ordinary
// typing/arrowing) once the caret travels more than this many pixels in one
// commit - comfortably above a few glyphs so held arrow keys don't trip it.
const JUMP_TRAIL_MIN_DIST = 40;
// One puff of pixels is dropped every this-many pixels along the jump path.
// Tighter spacing looks denser but costs more particles; this is a balance that
// reads as continuous without flooding the pool.
const JUMP_TRAIL_STEP = 18;
// Hard ceiling on puffs per jump, so a click from the top of a huge document to
// the bottom can't spawn thousands of particles in a single commit.
const JUMP_TRAIL_MAX_PUFFS = 40;

// Alpha the cursor paints at while cursorTranslucent is on. Near-solid on
// purpose: with the layer in multiply/screen the see-through quality comes
// almost entirely from the BLEND, not from the alpha, and dropping the alpha
// much below this starts washing the cursor out on busy text instead of
// making it read as ink. Multiplies with cursorOpacity rather than replacing
// it, so the global slider keeps working the same way everywhere.
const TRANSLUCENT_ALPHA = 0.95;

// How fast the adaptive catch-up boost may change, as an exponential rate
// (1/s). ~8 is a 125ms time constant: quick enough to follow a genuine burst
// of typing, slow enough to flatten the per-frame sawtooth the backlog
// measurement produces. See updateSmoothCursor.
const CATCHUP_BOOST_RATE = 8;

// Rounded Corners. See cornerRadius(): a shape whose narrow axis is at or
// under ROUNDED_THIN_PX is treated as a bar and goes fully round (capsule
// ends), anything wider is a block and takes the gentler fraction. 6px is
// comfortably above the widest Line caret the width slider offers, so every
// Line and Underline caret capsules and every Box softens.
const ROUNDED_THIN_PX = 6;
const ROUNDED_BLOCK_FRACTION = 0.25;

// I-beam serifs.
//
// Thickness is the smaller of a multiple of the stem and a fraction of the
// LINE HEIGHT. The stem term alone (all this used to have) meant a 6px caret
// put two 5px slabs on a ~24px line - 42% of the caret's height was serif,
// which reads as a bracket rather than an I-beam.
const SERIF_STEM_RATIO = 0.9;
const SERIF_HEIGHT_RATIO = 0.08;
// Span is driven by the character under the caret, with a small ABSOLUTE
// floor rather than a stem-relative one. A stem-relative floor grew the
// serifs past the width of the glyph they were marking as the stem widened.
const SERIF_MIN_SPAN_PX = 5;
const SERIF_MAX_SPAN_RATIO = 1.25;

// Multi-cursor: how many non-primary carets get the primary's full pipeline -
// their own smoothing and smear springs, trail, letter pop, pixel trail,
// disintegration, glitch, and the cursor's own style, glow, gradient and
// glyph. Carets past this many are drawn as the plain 2px line they always
// were. The cap is cost, not taste: measured in a live Obsidian, 200 carets
// with glow, gradient and glyph draw in 1.7ms, so drawing is not the limit -
// the per-keystroke style read is (every caret's line is re-read after every
// edit), and the region the canvas has to cover, which for carets spread down
// a page is the whole pane. See HANDOFF.md, "Multi-cursor with full effects".
const SECONDARY_FULL_MAX = 64;
// When the selection's shape changes (a caret added or removed, or the main
// one reassigned), every caret's saved state is re-matched to the new ranges
// by document position. A state further than this from every new head is
// dropped rather than mis-assigned, which would draw a smear from nowhere.
const SECONDARY_MATCH_WINDOW = 32;
// The engine fields that make up one caret's animation state. The primary's
// live in `this`; each full-effect secondary keeps a bundle of them and the
// tick swaps a bundle in to run the primary's own update and draw code on it
// (_withCaret). Same trick as the per-Vim-mode settings swap.
//
// Every effect that has per-caret state is here: the caret itself, the
// smooth and smear springs, the trail, a glitch burst, the hot-head's
// inertia and burn marks, and the rate stamps that pace stardust, sparks and
// fireworks per caret (a global stamp would let one caret's volley block
// the rest). The tether's caches too, so each caret's scan is its own.
//
// Two things are deliberately NOT here. lastMoveTime: the blink reads it,
// and every caret blinks on the primary's clock so the gear decision stays
// right for all of them. heat: Speed Demon is one gauge for the editor -
// every caret shows it, only the primary's moves feed it.
const CARET_STATE_FIELDS = [
  "lastActive", "pending", "animActive",
  "smearQuad", "smearShape", "smearCenterPrev", "_taperBuf", "_smearDir",
  "_smearMoving", "_smearDtT", "smearQuadLastMoveT",
  "trail", "glitch",
  "_smoothMoving", "_smoothLastT", "_catchUpBoost", "_typingBoostSm", "typingSpeedMod",
  "_hotPrev", "_hotEmitFrom", "_hotVel", "_hotActiveT", "_lastHotT", "hotBurns", "_hotShiftTick",
  "_hotEngulfUntil",
  "_lastStardustT", "_lastSparkT", "_lastFireworkT",
  "_tetherKey", "_tetherFrom", "_tetherTo", "_tetherSegs", "_tetherSegKey",
  "_tetherAnchorA", "_tetherAnchorB",
];
// Stardust keeps this many motes alive per caret; the pool is shared, so the
// cap scales with the caret count or ten carets would starve each other.
const STARDUST_MAX_PER_CARET = 60;
// How far each serif narrows from its outer edge to where it meets the stem.
// A real I-beam's serifs are brackets, not slabs: they thin as they approach
// the stem instead of butting into it at full weight. Kept modest - past
// about a third the shape stops reading as a serif and starts reading as an
// arrowhead.
const SERIF_TAPER = 0.3;

const DEFAULT_SETTINGS = {
  enabled: true,
  cursorStyle: "Box", // "Line" | "Box" | "Underline"
  uiMode: "cua", // "cua" | "vim" — which settings panel is shown; drives vimModeEnabled

  // --- appearance color controls ---
  colorDark: "#39ff14", 
  colorLight: "#333333",

  // --- gradient cursor color ---
  // When on, the cursor body is painted with a 2-4 stop ramp instead of the
  // flat per-theme colour above. Like colorDark/colorLight there is one ramp
  // per theme, since a ramp that reads well on a dark background is usually
  // washed out on a light one; gradientCount applies to both, so the two
  // ramps always have the same number of stops.
  //
  // The stop colours are separate scalar keys rather than arrays on purpose:
  // presets, Vim-mode snapshots and share codes all copy settings with a
  // shallow Object.assign, so an array would be copied BY REFERENCE and
  // editing one mode's gradient would silently rewrite every other mode's and
  // every saved preset's. Every other key in this file is a scalar for the
  // same reason - keep it that way.
  //
  // gradientCount picks how many of the four are actually used, so dropping
  // from 4 to 2 and back doesn't lose the colours you had.
  gradientEnabled: false,
  gradientCount: 2,
  gradientDark1: "#39ff14",
  gradientDark2: "#00d4ff",
  gradientDark3: "#b14aff",
  gradientDark4: "#ff2e88",
  // Light-theme defaults are deeper and less neon: the same job colorLight
  // does for the flat colour, i.e. stay legible against a white page.
  gradientLight1: "#1f8a3b",
  gradientLight2: "#0077b6",
  gradientLight3: "#7028c8",
  gradientLight4: "#c2185b",

  // --- CRT effect (trail + glow) ---
  crtEffect: false,
  glow: true, 
  // Neon Trail: render the CRT ghosts as a glowing neon TUBE - a hot white core
  // inside a saturated streak (drawNeonGhost) - instead of plain fading boxes.
  // The ghost is the caret's own footprint, so the tail matches the cursor's
  // width and full height rather than ballooning into a wide ribbon. Sub-option
  // crtNeonGradient colours the streak from the cursor's gradient (head→tail)
  // rather than the flat cursor colour.
  crtNeon: false,
  crtNeonGradient: false,
  // Signal Glitch: on a JUMP (a click or a motion command that lands far from
  // where the caret was - not ordinary typing or arrowing), the cursor briefly
  // breaks up like a mistracked video signal: the box tears into horizontal
  // slices that slip sideways, the corners warp, and the RGB channels separate.
  // Deliberately jump-only. Firing on every keystroke would strobe the whole
  // editor while typing, which is both unreadable and an accessibility problem;
  // a jump is rare enough that a ~200ms burst reads as punctuation.
  crtGlitch: false,
  crtGlitchStrength: 1,     // 0.2..2.5; slice displacement + corner warp scale
  crtGlitchAberration: 1,   // 0..3; RGB channel-split distance scale
  crtGlitchMs: 220,         // 60..600; how long one burst lasts

  // --- torch spotlight effect (can run alongside any cursor style) ---
  torchEffect: false,
  overlaySpareSidebars: true,
  overlayFollowMode: "caret", // caret | mouse | auto
  overlayRadius: 250,
  // Tuned against 0xatrilla/obsidian-torch-cursor, which reads as a genuine
  // torch rather than a dimmer: a nearly-black room (it ships 0.97) with a
  // strong warm core (it ships 1.0). The old 0.7/0.1 pair was a gentle vignette
  // with a barely-there tint - and the tint could only ever darken, since it
  // was the multiply layer doing it. Existing installs keep their saved values;
  // this only moves new ones.
  overlayDarkness: 0.92,
  overlayIntensity: 0.5,
  overlayColor: "#ff963c",
  // Candle flicker. The KEY never went away when the effect was removed - it
  // is still at its original index in LOOK_KEYS - so every share code and saved
  // preset in the wild already carries a value for it and lands on the restored
  // feature with no migration at all. The amount dial is new, and is appended.
  overlayFlicker: true,
  overlayFlickerAmount: 0.3, // 0.05..1; share of base intensity the flame swings
  // Blink sync: the spotlight breathes with the caret's blink, contracting as
  // the caret fades out and opening back up as it returns. Off by default -
  // see the note in the torch tick, it is the one torch option that costs
  // frames while nothing else is happening.
  overlayBlinkSync: false,
  overlayBlinkDepth: 0.25,   // 0.05..0.6; how far the light closes at the darkest point
  overlaySpeed: 0.22, // lerp factor: how fast the torch chases its target

  // Honour the OS "reduce motion" preference by switching the moving effects
  // off. Global rather than a LOOK key on purpose: it is an accessibility
  // preference about this machine, not part of a look, so it must not travel
  // in a share code or get overridden per Vim mode.
  respectReducedMotion: true,

  // --- global caret properties ---
  caretWidthPx: 2,         
  // --- Pop Effects ---------------------------------------------------------
  // One group for everything the caret throws off in response to a keystroke.
  // popEffects is the master gate; the three effects under it are independent
  // of each other and all share popRainbow's colour sweep.
  //
  // popLetters used to BE the top-level toggle (and Thunderstrike used to hang
  // off Pixel Trail), so anything saved before this grouping existed has no
  // popEffects key at all - see migrateLegacyKeys for how the gate is
  // synthesised from the old shape.
  popEffects: true,
  popLetters: true,        
  // Rainbow drives all three pop effects, not just the letters: one running
  // hue is advanced by whichever of them fires, so a burst of typing sweeps
  // the whole group around the wheel together instead of each effect keeping
  // its own private phase.
  popRainbow: false,
  // Pixelated shells that climb out of the caret on Space and Enter and burst
  // above it. Quantity scales the burst in both directions at once - how many
  // shells go up per keystroke AND how many sparks each one throws - so one
  // slider covers "a lone spark" through to "a proper volley".
  fireworks: false,
  fireworksQuantity: 1,    // 0.2..3
  flameTrail: true,        
  // Pixel Trail sub-options.
  // Density multiplies how many pixels each move sheds; at 0 the trail emits
  // nothing, which is how you turn the pixels off while keeping the other
  // sub-effects (thunderstrike, disintegration) available.
  flameTrailDensity: 1,       // 0..3 multiplier on the per-move particle count
  flameTrailLifeMs: 400,      // 100..2000 how long each pixel lives before it's gone
  // Gravity: a steady pull on every trail pixel, angle in degrees clockwise
  // from "down" (0 = straight down, 90 = right, 180 = up, 270 = left) and a
  // strength in px/s². 0 strength leaves the original sideways drift untouched.
  flameTrailGravity: 0,       // 0..1 strength (scaled to a px/s² range on use)
  flameTrailGravityAngle: 0,  // degrees; 0 = down
  // On a jump (click, page, big arrow move) the caret leaps in one step, so the
  // trail - which normally builds up from a puff per keystroke - would leave
  // just a single puff at the origin and nothing along the way. With this on, a
  // jump lays a line of puffs down the path it skipped, so a leap leaves a
  // proper streak instead of a lone smudge.
  flameTrailOnJump: false,
  // When the cursor's Gradient is on, colour each trail pixel from a random
  // point along that gradient (with a little per-pixel nuance) instead of all
  // pixels sharing the flat cursor colour. Applies to the jump trail and the
  // backspace-disintegration burst too. No effect when Gradient is off.
  flameTrailGradientColors: false,
  // Base size of each trail pixel in px. Each pixel still varies a little around
  // this, so it's a scale on the whole burst rather than a fixed dimension. The
  // default matches the size the trail used before this was configurable.
  flameTrailPixelSize: 4,
  // Hot-head: a standalone effect that sets the text you're working on alight.
  // Particles are points binned into a pixel grid and drawn big and solid while
  // fresh, shrinking to specks as they age - see drawHotHead.
  hotHead: false,
  hotHeadQuantity: 1,      // 0..3 multiplier on how much fire is emitted
  hotHeadSpread: 4,        // 0..14 characters of surrounding text set alight, and
                           // how long a patch of text keeps burning after the
                           // caret has moved off it
  hotHeadTrail: 6,         // 0..30 extra fire laid along the path just travelled
  hotHeadFade: 620,        // 200..1600ms lifetime of a single fire particle
  hotHeadHeight: 0.55,     // 0.15..1.5 how high the flames climb
  hotHeadOpacity: 1,       // 0.1..1 overall opacity of the fire
  hotHeadIdleMs: 1500,     // 0..6000ms of stillness before the fire stops being
                           // fed and burns out; 0 = burns forever
  hotHeadFlat: false,      // true = fire in the cursor's own color, no heat gradient
  hotHeadSpeedHeat: false, // true = Speed Demon's heat also tints the fire

  // Pop Effects sub-option: pressing Enter calls down a bolt of pixelated
  // lightning onto the caret's new position, from a random angle above it.
  // This used to hang off Pixel Trail and was gated on it; it is now
  // independent, so a bolt can strike with the trail switched off. Its impact
  // sparks are still thrown into the trail's particle pool, which is only a
  // shared pool and carries no dependency on the trail being enabled.
  thunderstrike: false,
  thunderstrikeSize: 2,    // px per block of the bolt; the effect's chunkiness
  thunderstrikeStrength: 0.5,  // 0.1..1 overall visibility of the strike
  // Pop Effects sub-option: Backspace/Delete throws the trail's particle burst
  // outward instead of trailing it, in inverted colours. Like Thunderstrike,
  // this used to hang off Pixel Trail and be gated on it; it now fires on its
  // own, so text can come apart with the ambient trail switched off. It still
  // borrows the trail's particle pool and physics dials (lifetime, pixel size,
  // gravity) - see the note in spawnFlamePixels.
  backspaceDisintegrate: false,
  lineSerifs: false,             // Line cursor: add horizontal serifs (I-beam look)
  // Underline cursor thickness in px. 0 = auto: scale with the line height,
  // which is what this style did before the slider existed, so an existing
  // setup (and a fresh install) keeps exactly the look it had.
  underlineWidthPx: 0,
  boxHollow: false,              // Box cursor: outline only, no fill
  boxHollowWidth: 2,             // Outline stroke width when boxHollow is on

  // --- Translucency --------------------------------------------------------
  // One toggle, no dials. The cursor stops covering the text it sits on and
  // starts reading as ink laid over it: the canvas layer is blended into the
  // page (multiply on light themes, screen on dark ones - see
  // applyCanvasBlend) and painted at TRANSLUCENT_ALPHA instead of full.
  //
  // Applies to every style, and is a LOOK key, so a Vim mode can turn it on
  // for one mode and off for another.
  //
  // Note the blend is a property of the whole canvas layer, not of the caret
  // shape, so it necessarily takes the trail and every canvas effect
  // (flames, stardust, sparks, the bracket tether) with it. That is the
  // intended reading - the entire cursor becomes ink on the page rather than
  // a sticker over it - but it does mean this toggle changes more than the
  // caret body alone.
  cursorTranslucent: false,

  // Rounds the caret's corners. A toggle rather than a slider: the radius
  // that looks right depends on which style you're using, so cornerRadius()
  // derives it from the shape's own narrow axis instead of asking. Applies
  // to every style - Line and Underline capsule, Box softens - and to the
  // trail, the neon tube and the secondary carets, so nothing drags a tail
  // of sharp boxes behind a rounded head.
  cursorRounded: false,

  // See GLYPH_COLOR_MODES. Defaults to the neutral flip: RGB inversion
  // produces a complementary hue rather than a neutral, so "invert" and
  // "tinted" both tint the letter with a colour most people did not ask for.
  glyphColorMode: "contrast",

  // --- Speed Demon: cursor heats up with typing speed ---
  speedDemon: false,
  speedDemonSparks: true,        // spawn small fire particles at high heat
  speedDemonSensitivity: 1,      // 0.5..2 multiplier on how fast heat builds
  speedDemonSparkQuantity: 1,    // 0..3 multiplier on how many sparks spawn per burst
  speedDemonSparkTrail: 0,       // 0..30px comet-tail trailing behind each spark; 0 = no trail
  speedDemonNoCursorHeat: false, // true = cursor keeps its own color as it heats up
  // Custom heat ramp: replace the built-in blackbody curve (cold desaturated →
  // your colour → orange → white-hot, see heatColor) with four colours of your
  // own, sampled by heat from stage 1 at rest to stage 4 flat out.
  //
  // One ramp per theme, matching the Gradient feature's convention and for the
  // same reason: a ramp tuned against a dark background washes out on a light
  // one. Unlike the built-in curve, these stops do NOT derive from the cursor
  // colour - they ARE the cursor colour while Speed Demon is on, which is what
  // "custom" means here. See heatColor for what that overrides.
  speedDemonGradient: false,
  speedHeatDark1: "#2b4a8f",   // cold — deep blue
  speedHeatDark2: "#17b8c4",   // cooling — cyan
  speedHeatDark3: "#ff9a2e",   // warm — orange
  speedHeatDark4: "#fff3d0",   // white-hot
  speedHeatLight1: "#1d3a75",
  speedHeatLight2: "#0e8a94",
  speedHeatLight3: "#d96b00",
  speedHeatLight4: "#e8a33c",

  // --- Stardust: the cursor gives off a slow stream of drifting, fading
  // pixels. A standalone effect (it used to hang off Pixel Trail), with its
  // OWN particle pool - see this.stardust in the engine state and the gear
  // notes in the canvas tick for why it must not share flamePixels.
  //
  // By default it emits only once the cursor has sat still for
  // stardustDelayMs; stardustAlwaysOn drops that condition so it streams
  // continuously, typing included.
  stardustEnabled: false,
  stardustAlwaysOn: false,
  stardustDelayMs: 2000,   // how long the cursor must sit still before emitting
  stardustRate: 1,         // 0.2..3 multiplier on how thickly it streams
  // Orbit mode: motes circle the caret like fireflies instead of drifting
  // upward, and they track the caret as it moves rather than being left behind.
  stardustOrbit: false,
  stardustOrbitRadius: 22, // px; the mean orbit, which each mote varies around

  cursorOpacity: 1,
  energyEffect: false,
  energySpeed: 1,
  // Aurora: only meaningful with a gradient, where it warps and cross-mixes
  // the ramp instead of scrolling it rigidly. See createEnergyGradient.
  energyAurora: false,
  // How hard Aurora bends. Above ~0.05 the beam stops being a vertical
  // gradient and is painted as a true 2D field (see auroraPattern), which is
  // what lets the bands actually curve across the cursor instead of only
  // sliding up and down it. 0 keeps the old strictly-vertical look.
  energyAuroraWaviness: 1,  // 0..2

  // --- Bracket Tether: a faint line from the caret to its matching bracket ---
  bracketTether: false,
  bracketTetherStrength: 0.35,  // 0.1..1 opacity of the line

  // --- shared canvas engine settings ---
  trailLength: 10, 
  trailFadeMs: 450, 
  blinkingEnabled: true,
  blinkSpeed: 1.2,       
  blinkOnOffBalance: 0.5,
  blinkDelayMs: 0,
  // How much of each blink cycle is spent fading, per side, as a fraction of
  // the period. Low values snap on and off (the old "mechanical" feel); high
  // values stretch the fade so the caret eases gently in and out. At the top of
  // the range the holds vanish entirely and the blink becomes one continuous,
  // breathing-like fade. 0.15 is the original look.
  blinkFade: 0.15,       // 0.05..0.5
  // Blink-to-solid: how many full blinks to run after the caret settles
  // before it stays lit. 0 is off, and off is the default - this changes
  // long-standing behaviour, so nobody gets it without asking. The count
  // restarts on every caret move, so it reads as "blink a few times to show
  // me where you are, then get out of the way".
  blinkStopAfter: 0,     // 0..20, 0 = blink forever
  // Breathing: instead of fading out, the caret shrinks and swells on the blink
  // cycle and never disappears. Same clock, same speed/balance/delay controls -
  // only what the cycle drives is different.
  blinkBreathing: false,
  blinkBreathDepth: 0.2,   // 0.05..0.5; how far it shrinks at the bottom of the breath       // ms of full-on hold after any move/keystroke before blinking resumes
  hideNativeCaret: true, 
  // Drop the cursor entirely while Obsidian isn't the active OS window, the
  // way virtually every other writing app does. Structural (like
  // hideNativeCaret), so deliberately NOT a per-Vim-mode look key.
  hideOnWindowBlur: true,
  // Halves the render loops' frame rates (FRAME_CAPS). A device preference,
  // not a look: not in LOOK_KEYS, so never in a preset or a share code.
  lowPowerMode: false,
  // Confine the plugin to the note editor: the custom caret is drawn only
  // while CodeMirror has focus, and the native one is left alone everywhere
  // else - Command Palette, Quick Switcher, Search, Settings, the tab-title
  // rename box, other plugins' modals. Off by default, because drawing
  // everywhere is what every release so far has done. Structural (like
  // hideNativeCaret), so deliberately NOT a per-Vim-mode look key.
  noteEditorOnly: false,
  showChar: true, 
  moveDelayMs: 0,        
  smear: true,           
  smearStiffness: 0.6,
  smearTrailingStiffness: 0.4,
  smearDamping: 0.8,
  // Motion Smear sub-option. The smear is a quad whose corners lag behind the
  // caret on a spring, which means a fast move drags a full-width rectangle
  // along behind it. Taper narrows the *trailing* end of that quad toward the
  // line of travel, so the smear reads as a comet tail with a point at the
  // back instead. Purely a shape adjustment applied on top of the spring - the
  // physics are untouched, so Stiffness/Trailing Stiffness/Damping all still do
  // exactly what they did.
  smearTaper: false,
  smearTaperAmount: 0.7,   // 0..1; at 1 the tail closes to a point
  // Motion Smear sub-options, after smear-cursor.nvim. A cap on how far the
  // tail can trail the head, in pixels (0 = no cap): a page-down otherwise
  // drags a streak the height of the pane. And conserving the smear's area,
  // so a long diagonal streak gets thinner as it stretches instead of
  // sweeping a full-width parallelogram; the strength is the exponent on the
  // area ratio (0 = no thinning, 1 = the area held exactly).
  smearMaxLength: 0,
  smearConserveVolume: false,
  smearVolumeStrength: 0.3,

  // --- smooth cursor global category ---
  smoothEnabled: false,
  smoothStopBlinking: true, 
  smoothness: 0.15,          // 5-30% range (0.05 - 0.30)
  catchUpSpeed: 0.55,        // 30-80% range (0.30 - 0.80)
  maxCatchUpSpeed: 0.85,     // 50-100% range (0.50 - 1.00)
  smoothAdaptive: true,      // Adaptive speed toggle

  // --- Vim-aware cursors ---------------------------------------------------
  // When vimModeEnabled is on AND Obsidian's own Vim keybindings are active,
  // the ENTIRE cursor look/effect config swaps per Vim mode. Each entry in
  // vimModes is a full snapshot of every look/effect setting (see LOOK_KEYS),
  // so a mode can differ from the global cursor in any way at all — style,
  // colors, blinking, CRT trail, speed demon, smear, torch, etc.
  // vimControlObsidian: when on, the plugin owns Obsidian's own Vim
  // keybindings — Vim mode forces them on, CUA mode forces them off.
  vimModeEnabled: false,
  vimControlObsidian: true,
  vimActivePreset: "",        // name of the vim preset last applied (for the UI)
  vimStatusBar: true,         // show the live Vim mode in Obsidian's status bar
  vimStatusBarColor: true,    // ...tinted with that mode's cursor color
  vimModes: {},               // filled in below with full per-mode snapshots
};

// Housekeeping keys belonging to the Vim system. A regular (CUA) cursor preset
// must never carry or clobber these — they're listed once here so saving and
// loading a preset can't drift apart as new vim keys get added.
const VIM_STATE_KEYS = [
  "vimPresets", "vimModes", "vimModeEnabled", "vimActivePreset",
  "vimControlObsidian", "vimStatusBar", "vimStatusBarColor",
];

// The Vim modes the plugin themes, in cycle order. "command" is the ":" / "/"
// prompt that @replit/codemirror-vim (the engine Obsidian bundles) opens as a
// CodeMirror panel at the bottom of the editor — see isVimCommandLineActive().
const VIM_MODE_KEYS = ["normal", "insert", "visual", "replace", "command"];
const VIM_MODE_LABELS = {
  normal: "Normal", insert: "Insert", visual: "Visual",
  replace: "Replace", command: "Command",
};

// Every setting a Vim mode is allowed to override — i.e. everything that
// affects how the cursor looks or behaves. Structural/housekeeping keys
// (enabled, hideNativeCaret, presets, the vim-control keys) are intentionally
// excluded. A per-mode config is a snapshot containing exactly these keys.
const LOOK_KEYS = [
  "cursorStyle", "colorDark", "colorLight",
  "gradientEnabled", "gradientCount",
  "gradientDark1", "gradientDark2", "gradientDark3", "gradientDark4",
  "gradientLight1", "gradientLight2", "gradientLight3", "gradientLight4",
  "crtEffect", "glow", "crtNeon", "crtNeonGradient",
  "torchEffect", "overlaySpareSidebars", "overlayFollowMode", "overlayRadius",
  "overlayDarkness", "overlayIntensity", "overlayColor", "overlayFlicker", "overlaySpeed",
  "overlayBlinkSync", "overlayBlinkDepth",
  "caretWidthPx", "popLetters", "popRainbow", "flameTrail", "backspaceDisintegrate",
  "flameTrailDensity", "flameTrailLifeMs",
  "flameTrailGravity", "flameTrailGravityAngle",
  "flameTrailOnJump",
  "flameTrailGradientColors", "flameTrailPixelSize",
  "thunderstrike", "thunderstrikeSize", "thunderstrikeStrength",
  "stardustEnabled", "stardustAlwaysOn", "stardustDelayMs", "stardustRate",
  "stardustOrbit", "stardustOrbitRadius",
  "bracketTether", "bracketTetherStrength",
  "lineSerifs", "boxHollow", "boxHollowWidth", "underlineWidthPx",
  "speedDemon", "speedDemonSparks", "speedDemonSensitivity",
  "speedDemonSparkQuantity", "speedDemonSparkTrail", "speedDemonNoCursorHeat",
  "hotHead", "hotHeadQuantity", "hotHeadSpread", "hotHeadTrail",
  "hotHeadFade", "hotHeadHeight", "hotHeadOpacity", "hotHeadFlat",
  "hotHeadIdleMs",
  "cursorOpacity", "energyEffect", "energySpeed", "energyAurora",
  "trailLength", "trailFadeMs",
  "blinkingEnabled", "blinkSpeed", "blinkOnOffBalance", "blinkDelayMs", "blinkFade",
  "blinkBreathing", "blinkBreathDepth",
  "showChar", "moveDelayMs",
  "smear", "smearStiffness", "smearTrailingStiffness", "smearDamping",
  "smearTaper", "smearTaperAmount",
  "smoothEnabled", "smoothStopBlinking", "smoothness", "catchUpSpeed",
  "maxCatchUpSpeed", "smoothAdaptive",
  // APPEND-ONLY BELOW THIS LINE. A share code stores each field as its INDEX
  // into this array, so inserting or reordering anything above silently
  // reinterprets every code already in the wild. Appending is safe: older
  // codes just don't mention these indices and fall back to defaults, and
  // codeToPreset already skips indices it doesn't recognise.
  "crtGlitch", "crtGlitchStrength", "crtGlitchAberration", "crtGlitchMs",
  "energyAuroraWaviness",
  // Reuses the index the (never-released) boxTranslucent gate held: same
  // boolean, same meaning, wider scope. The three dials that sat after it -
  // boxTranslucency, boxTranslucentMode, boxLens - are gone, and dropping
  // them shifts nothing, since they were the last entries in the array.
  // codeToPreset already skips indices it doesn't recognise, so a code
  // written while they existed still imports; it just ignores those fields.
  "cursorTranslucent",
  // Pop Effects. popLetters and popRainbow keep their original indices above -
  // regrouping them in the panel is a UI change and must not move them here,
  // or every share code in the wild would reinterpret those two slots. The new
  // group gate and the Fireworks pair are appended instead, so an older code
  // simply doesn't mention them and migrateLegacyKeys synthesises popEffects
  // from the popLetters value the code does carry.
  "popEffects", "fireworks", "fireworksQuantity",
  // Speed Demon's custom heat ramp, and the CRT inverted trail. Appended, like
  // everything else here.
  "speedDemonGradient",
  "speedHeatDark1", "speedHeatDark2", "speedHeatDark3", "speedHeatDark4",
  "speedHeatLight1", "speedHeatLight2", "speedHeatLight3", "speedHeatLight4",
  // Torch candle flicker's depth dial. `overlayFlicker` itself is NOT here: it
  // is still sitting at its original index above, where it stayed as a
  // tombstone while the effect was gone. Reusing it rather than appending a new
  // gate is what lets an old share code turn the restored effect straight back
  // on instead of silently dropping the field.
  "overlayFlickerAmount",
  // Speed Demon tinting Hot-head's fire. Appended, like everything else here.
  "hotHeadSpeedHeat",
  // Rounded Corners. Appended, like everything else here - inserting anywhere
  // above would reindex every share code in the wild. Defaults to false, so a
  // code written before this existed imports as sharp, which is exactly what
  // it looked like when it was written.
  "cursorRounded",
  // Glyph colour mode. Appended, like everything else here.
  "glyphColorMode",
  // Blink-to-solid's count. Appended, like everything else here. Defaults to
  // 0, so a code written before this existed imports as "blink forever",
  // which is what it meant when it was written.
  "blinkStopAfter",
  // Motion Smear's cap and volume conservation (1.5.4). Appended; the defaults
  // are "off", so an older code imports as the smear it described.
  "smearMaxLength", "smearConserveVolume", "smearVolumeStrength",
];

// ---------------------------------------------------------------------------
// Legacy key migration.
//
// 1.3.0 shipped a single theme-independent gradient (gradientColor1..4) and
// called the stardust effect idleStardust. Both were renamed: the gradient
// gained a per-theme pair, and stardust became a standalone effect with an
// always-on option. Neither old name is in LOOK_KEYS any more, so anything
// still carrying them - saved settings, a Vim-mode snapshot, a saved preset,
// an imported share code - would have those values silently dropped by
// pickLook() and snap back to the defaults.
//
// Returns a shallow copy with the old names folded into the new ones and
// deleted. Safe to run on anything settings-shaped, including {}: it only
// touches keys that are actually present, and never clobbers a new-style key
// that already holds a value.
// ---------------------------------------------------------------------------
function migrateLegacyKeys(src) {
  if (!src || typeof src !== "object") return src;
  const o = Object.assign({}, src);
  // The old single ramp becomes the dark-theme ramp; the light-theme one is
  // left to backfill from the defaults. That's the closest a per-theme pair
  // can get to the old behaviour of showing one ramp in both themes.
  for (let i = 1; i <= 4; i++) {
    const oldKey = "gradientColor" + i;
    const newKey = "gradientDark" + i;
    if (oldKey in o) {
      if (o[newKey] === undefined) o[newKey] = o[oldKey];
      delete o[oldKey];
    }
  }
  if ("idleStardust" in o) {
    if (o.stardustEnabled === undefined) o.stardustEnabled = o.idleStardust;
    delete o.idleStardust;
  }
  // Translucency shipped for a moment as a Box-only toggle with three dials
  // hanging off it, then became one toggle for every style. The gate carries
  // over as-is; the dials are dropped rather than mapped, since the values
  // they held (an arbitrary alpha, a blend mode, a lens strength) no longer
  // have anywhere to go.
  if ("boxTranslucent" in o) {
    if (o.cursorTranslucent === undefined) o.cursorTranslucent = o.boxTranslucent;
    delete o.boxTranslucent;
  }
  delete o.boxTranslucency;
  delete o.boxTranslucentMode;
  delete o.boxLens;
  // Text Crawl, removed outright. Its keys are deleted rather than left in
  // place so a config saved while it existed doesn't carry five dead settings
  // forever - same treatment as the box-translucency keys above.
  delete o.textCrawl;
  delete o.textCrawlSpeed;
  delete o.textCrawlGlow;
  delete o.textCrawlFlip;
  delete o.textCrawlRainbow;
  // CRT Inverted Trail, also removed outright. Same treatment: it never
  // shipped, so there is nothing to preserve, and leaving the keys in saved
  // configs would just carry two dead settings forever.
  delete o.crtInvert;
  delete o.crtInvertStrength;
  // Matrix Rain, likewise. Same reasoning as the two above.
  delete o.matrixRain;
  delete o.matrixRainDensity;
  // Ink, likewise - except these got further than the other three did: they
  // were left sitting in all six shipped presets long after the effect that
  // read them was gone, so applying ANY preset wrote four orphans into the
  // user's data file. Removed from the presets and deleted here, so an
  // existing config sheds them on the next load.
  delete o.inkEffect;
  delete o.inkColor;
  delete o.inkOpacity;
  delete o.inkPooling;
  // Pop Effects. "Popping Letters" was itself the top-level toggle, and both
  // Thunderstrike and Backspace Disintegration were sub-options of Pixel
  // Trail; all three are now sub-options of a Pop Effects group with its own
  // gate. Nothing saved before that grouping carries the gate, so it has to be
  // inferred - without this, every returning user's popping letters, lightning
  // and deletion bursts silently switch off on upgrade.
  //
  // Guarded on one of the old keys actually being present, NOT just on the
  // gate being absent: this function also runs over sparse objects (an empty
  // Vim-mode entry, a partial preset) that are meant to inherit everything
  // they don't mention, and unconditionally writing popEffects into those
  // would override the defaults they're supposed to fall through to.
  const OLD_POP_KEYS = ["popLetters", "thunderstrike", "backspaceDisintegrate"];
  if (!("popEffects" in o) && OLD_POP_KEYS.some((k) => k in o)) {
    // Both relocated options were unreachable with Pixel Trail off - their
    // toggles were hidden, and neither effect would fire - so a stale `true`
    // sitting behind a disabled trail was inert and the user never saw it.
    // Decoupling them would bring both to life on upgrade for someone who
    // never asked for either, so that combination is settled here instead:
    // it doesn't count toward the gate, and the stale flags are cleared.
    //
    // This clearing MUST stay inside the "no popEffects key" guard. In the new
    // world, Thunderstrike or Disintegration with Pixel Trail off is a
    // perfectly legal configuration, and running the clear unconditionally
    // would wipe it out every time settings were loaded.
    //
    // `flameTrail !== false` rather than a truthiness test because absent
    // means "inherits the default", and that default is on.
    const trailWasOn = o.flameTrail !== false;
    if (!trailWasOn) {
      if (o.thunderstrike) o.thunderstrike = false;
      if (o.backspaceDisintegrate) o.backspaceDisintegrate = false;
    }
    o.popEffects = !!o.popLetters || !!o.thunderstrike || !!o.backspaceDisintegrate;
  }
  return o;
}

// Bracket Tether: the pairs it will follow, and how far it will scan for a
// match. The cap keeps a runaway scan (an unmatched brace in a large note)
// bounded; 20k characters is far past anything a tether is readable across.
// Angle brackets are included so HTML tags, autolinks <https://…> and literal
// <> pair up too. They are depth-matched like the others, so a `<` used as a
// less-than sign (or a `>` blockquote marker) can occasionally pair with a
// stray partner; that's an accepted cost of a decorative guide.
const BRACKET_OPEN = { "(": ")", "[": "]", "{": "}", "<": ">" };
const BRACKET_CLOSE = { ")": "(", "]": "[", "}": "{", ">": "<" };
const BRACKET_SCAN_LIMIT = 20000;

// A structural block cuts the tether: a pair with one end inside a code block,
// blockquote or callout and the other outside it isn't a pair, it's two
// unrelated characters that happen to match. A `<` in a ```` ```html ```` block
// and a stray `>` in the prose below it was the case that started this.
//
// The two kinds of block are marked completely differently, and the difference
// decides how each is detected:
//
//   • A CODE FENCE is a delimiter LINE. You cross it. So the question is
//     "is there a fence line between the two ends", answered by scanning the
//     span. Asking instead "is this offset inside a code block" would need
//     fence PARITY counted from the top of the document - an O(document) scan
//     on every keystroke, since the tether's cache key includes doc length.
//
//   • A BLOCKQUOTE (and therefore a CALLOUT, which is just a blockquote whose
//     first line carries a [!type] marker) has no delimiter lines at all. It
//     is a per-line PREFIX: every line carries ">", and the block ends at the
//     first line that doesn't. So membership is a purely LOCAL property of a
//     line, needing no scan beyond the line itself - and the question is
//     "do both ends sit at the same quote depth, unbroken".
//
// Both come out of one walk over the lines the span touches: cut on any fence
// line beginning inside the span, or on any line whose quote depth differs
// from the depth of the line the span starts on. A blank line between two
// quoted passages reads as depth 0 and correctly separates them.
const CODE_FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
// Longest prefix CODE_FENCE_RE can need: 3 spaces of indent + 3 fence chars.
// Used to read a few characters past the end of a span so a fence opening the
// span's final line is still matchable when the span stops mid-fence.
const CODE_FENCE_PREFIX = 8;
// How far back a ">" will look for the start of its line before giving up on
// deciding whether it's a blockquote marker. A real prefix is "> " per level;
// this is many levels deeper than anything legible.
const BLOCK_PREFIX_MAX = 64;
// Enough of a line to read its quote depth and then test it for a fence.
const BLOCK_HEAD_MAX = BLOCK_PREFIX_MAX + CODE_FENCE_PREFIX;
// How far back to reach for the start of the line a span BEGINS on, whose
// depth is the baseline every later line is compared against. Overrunning a
// longer line than this misreads that baseline as depth 0, which can only
// produce a spurious cut, never a spurious tether.
const BLOCK_LINE_LOOKBACK = 1024;

// The blockquote depth of one line, and whether what remains after stripping
// that prefix opens a code fence. Callouts need no special case: "> [!note]"
// is a blockquote line like any other, and its body lines carry the same ">".
function blockLineInfo(line) {
  let i = 0;
  let depth = 0;
  for (;;) {
    // Up to 3 spaces of indent are allowed before each ">" marker; a 4th would
    // make the line an indented code block instead.
    let j = i;
    let spaces = 0;
    while (j < line.length && (line[j] === " " || line[j] === "\t") && spaces < 3) { j++; spaces++; }
    if (line[j] !== ">") break;
    depth++;
    i = j + 1;
    if (line[i] === " ") i++; // the single optional space after a marker
  }
  return { depth, fence: CODE_FENCE_RE.test(line.slice(i, i + CODE_FENCE_PREFIX)) };
}

// Is text[i] a blockquote marker rather than a closing angle bracket? True
// when nothing but prefix characters sit between it and the start of its line.
//
// This is what stops the tether joining a "<" in one line to the ">" that
// merely OPENS the next one - by far the most visible way a decorative guide
// gets Markdown wrong, since in a callout every single line starts with one.
//
// `textStart` is the document offset of text[0], so a slice that begins
// mid-document isn't mistaken for the start of a line.
function isBlockquoteMarker(text, i, textStart) {
  const floor = Math.max(0, i - BLOCK_PREFIX_MAX);
  for (let j = i - 1; j >= floor; j--) {
    const c = text[j];
    if (c === "\n") return true;
    if (c !== ">" && c !== " " && c !== "\t") return false;
  }
  // Ran out of look-back without finding a line start: only genuinely one if
  // we reached the top of the document.
  return floor === 0 && textStart === 0;
}

// Quote-ish delimiters the tether will also pair up. Backtick is in here
// because inline code spans are everywhere in Markdown and behave exactly like
// a quoted run; drop it from this list if that's not wanted.
const QUOTE_CHARS = ['"', "'", "`"];
// Quotes, unlike brackets, aren't directional - the same character opens and
// closes - so they're paired left-to-right across a single line rather than by
// depth counting. That's also why they're line-scoped: pairing across lines
// would join a stray apostrophe to one three paragraphs away.
//
// Curly (typographic) quotes are the exception: “ ‘ open and ” ’ close, like
// brackets do, so they are matched directionally instead of by left-to-right
// pairing (see quoteSpanAt). They still get the apostrophe guard, because ’ is
// also the correct character for a typographic apostrophe - "don’t" - and must
// not be read as a closing quote when it sits between two letters.
const CURLY_QUOTE_OPEN = { "\u201C": "\u201D", "\u2018": "\u2019" };  // “ → ”, ‘ → ’
const QUOTE_LINE_SCAN = 4000;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
// A quote wedged between two word characters is an apostrophe, not a
// delimiter - "don't", "it's", "rock'n'roll", "don’t". Skipping those is what
// stops the tether pairing the apostrophe in "don't" with the one in "it's" and
// drawing a line across the sentence between them.
function isQuoteDelimiter(text, i) {
  return !(WORD_CHAR.test(text[i - 1] || "") && WORD_CHAR.test(text[i + 1] || ""));
}

// Copy only the look keys out of an arbitrary settings-shaped object.
function pickLook(src) {
  const o = {};
  if (!src) return o;
  const from = migrateLegacyKeys(src);
  for (const k of LOOK_KEYS) if (k in from) o[k] = from[k];
  return o;
}

// Build a complete per-mode snapshot: the global defaults for every look key,
// with the given overrides applied on top. Guarantees no key is ever missing.
function fullVimMode(overrides) {
  return Object.assign(pickLook(DEFAULT_SETTINGS), pickLook(overrides));
}

// Build one mode's snapshot, falling back to that mode's starter look when the
// source has nothing for it. This matters for "command", which was added after
// people had already saved Vim presets: without the fallback an older preset
// would expand to the plain global defaults for Command and every preset would
// end up with an identical, uncustomised command-line cursor.
function vimModeSnapshot(modeKey, overrides) {
  return fullVimMode(overrides || VIM_MODE_STARTERS[modeKey]);
}

// Regular (non-Vim) equivalent of fullVimMode(): backfills any look/effect
// key the preset is missing (i.e. an option added after the preset was
// created) with the current global default, without disturbing any key -
// look or otherwise (uiMode, etc.) - the preset *does* carry. Unlike
// fullVimMode, this does NOT pickLook() the preset itself, since a regular
// preset snapshot legitimately carries a few non-LOOK_KEYS fields and those
// must pass through untouched. Without this, loading an older or built-in
// preset silently left newly-added settings at whatever value happened to
// be set before the preset was loaded, rather than the preset's own look.
function presetWithDefaults(preset) {
  return Object.assign({}, pickLook(DEFAULT_SETTINGS), migrateLegacyKeys(preset));
}

// Clone a whole vimModes map (or preset) into fresh, complete snapshots so
// callers never share nested references with this.settings.
function cloneVimModes(modes) {
  const out = {};
  for (const k of VIM_MODE_KEYS) out[k] = vimModeSnapshot(k, modes && modes[k]);
  return out;
}

// Starter per-mode looks seeded into new installs. Each lists only what it
// changes from the global defaults; fullVimMode() fills in the rest. They
// double as a showcase — every mode looks distinctly different.
const VIM_MODE_STARTERS = {
  normal:  { cursorStyle: "Box", colorDark: "#4aa3ff", colorLight: "#1e6fd0",
             blinkingEnabled: true, speedDemon: false, crtEffect: false },       // blue blinking box
  insert:  { cursorStyle: "Line", colorDark: "#39ff14", colorLight: "#2a7d2e",
             blinkingEnabled: false, caretWidthPx: 2 },                          // thin steady line
  visual:  { cursorStyle: "Box", colorDark: "#f5a623", colorLight: "#b26a00",
             boxHollow: true, blinkingEnabled: false },                          // hollow amber box
  replace: { cursorStyle: "Underline", colorDark: "#ff3b3b", colorLight: "#b30000",
             caretWidthPx: 3, blinkingEnabled: true },                          // red underline
  // Command (":" / "/" prompt) lives in a one-line <input>, not the note
  // editor, so the motion effects are deliberately off: smear and smooth
  // catch-up both look like jitter in a field that's ~20px tall.
  command: { cursorStyle: "Line", colorDark: "#c792ea", colorLight: "#7d3fbf",
             caretWidthPx: 2, blinkingEnabled: true, blinkSpeed: 1,
             smear: false, smoothEnabled: false, crtEffect: false,
             speedDemon: false, torchEffect: false },                            // violet line
};

// ---------------------------------------------------------------------------
// "Preset1" — the baked-in Vim starting point every new install gets.
//
// Written out as COMPLETE per-mode snapshots rather than sparse overrides on
// purpose. Sparse entries inherit anything they don't list from
// DEFAULT_SETTINGS, and several of those globals (popLetters, flameTrail,
// backspaceDisintegrate) default to values this preset does not want, so an
// abbreviated version would not actually reproduce the intended look.
// ---------------------------------------------------------------------------
const PRESET1_VIM_MODES = {
  normal: {
    "cursorStyle": "Box", "colorDark": "#499bf3", "colorLight": "#3c6ebe",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 2, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": false, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1.2, "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0, "showChar": true, "moveDelayMs": 0,
    "smear": true, "smearStiffness": 0.8, "smearTrailingStiffness": 0.55,
    "smearDamping": 0.35, "smoothEnabled": true, "smoothStopBlinking": true,
    "smoothness": 0.15, "catchUpSpeed": 0.55, "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  insert: {
    "cursorStyle": "Line", "colorDark": "#4fe87d", "colorLight": "#29bc3a",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 2, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": false, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": true, "blinkSpeed": 0.9, "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 1200, "showChar": true, "moveDelayMs": 0,
    "smear": false, "smearStiffness": 0.6, "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8, "smoothEnabled": true, "smoothStopBlinking": true,
    "smoothness": 0.15, "catchUpSpeed": 0.55, "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  visual: {
    "cursorStyle": "Box", "colorDark": "#e3cb31", "colorLight": "#e8bd21",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 2, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": false, "lineSerifs": false, "boxHollow": true,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1.2, "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0, "showChar": true, "moveDelayMs": 0,
    "smear": false, "smearStiffness": 0.6, "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8, "smoothEnabled": false, "smoothStopBlinking": true,
    "smoothness": 0.15, "catchUpSpeed": 0.55, "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  replace: {
    "cursorStyle": "Underline", "colorDark": "#f54747", "colorLight": "#ff1a1a",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": false, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1.2, "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0, "showChar": true, "moveDelayMs": 0,
    "smear": true, "smearStiffness": 0.6, "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8, "smoothEnabled": false, "smoothStopBlinking": true,
    "smoothness": 0.15, "catchUpSpeed": 0.55, "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  // Violet line for the ":" prompt — distinct from the other four modes at a
  // glance, with the motion effects off (see VIM_MODE_STARTERS.command).
  command: {
    "cursorStyle": "Line", "colorDark": "#c792ea", "colorLight": "#7d3fbf",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 2, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": false, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": true, "blinkSpeed": 1, "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0, "showChar": true, "moveDelayMs": 0,
    "smear": false, "smearStiffness": 0.6, "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8, "smoothEnabled": false, "smoothStopBlinking": true,
    "smoothness": 0.15, "catchUpSpeed": 0.55, "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
};

// Populate the default vimModes now that the helpers exist. A fresh install
// therefore opens on exactly the Preset1 look rather than on a set of
// per-mode defaults that don't correspond to any saved preset.
DEFAULT_SETTINGS.vimModes = cloneVimModes(PRESET1_VIM_MODES);

// ---------------------------------------------------------------------------
// Default starter presets — seeded into new installs (or any install that
// does not yet have a userPresets key in its data file). Existing user
// presets are never touched; only missing keys are added.
//
// Four of these (Jell-O, Torch-Crt, mr.Blue, old_Joe) look self-contradictory
// at a glance: they set "backspaceDisintegrate": true alongside "flameTrail":
// false. That combination could never fire under the old rules - disintegration
// was gated on Pixel Trail - so the flag has always been dead weight in these
// snapshots, and none of the four has ever shown a deletion burst.
//
// It is left as written rather than corrected to false here, because
// migrateLegacyKeys already resolves exactly this case for user data and runs
// over these presets too (via presetWithDefaults). Fixing it in both places
// would put the same decision in two spots, and anyone who later decides these
// presets SHOULD get the burst now that the gate is gone would have to
// remember to change both. One knob, in the migration.
// ---------------------------------------------------------------------------
const DEFAULT_PRESETS = {
  "Jell-O": {
    "cursorStyle": "Box", "colorDark": "#31edae", "colorLight": "#147133",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": true, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1.4, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1.5, "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200, "hideNativeCaret": true, "showChar": true,
    "moveDelayMs": 0, "smear": true, "smearStiffness": 0.65,
    "smearTrailingStiffness": 0.15, "smearDamping": 0.4,
    "smoothEnabled": true, "smoothStopBlinking": true, "smoothness": 0.15,
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true
  },
  "Torch-Crt": {
    "cursorStyle": "Line", "colorDark": "#f3c258", "colorLight": "#147133",
    "crtEffect": true, "glow": true, "torchEffect": true,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": true, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1.4, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1.5, "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200, "hideNativeCaret": true, "showChar": true,
    "moveDelayMs": 0, "smear": false, "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4, "smearDamping": 0.5,
    "smoothEnabled": true, "smoothStopBlinking": true, "smoothness": 0.15,
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true
  },
  "mr.Blue": {
    "cursorStyle": "Line", "colorDark": "#3182ed", "colorLight": "#0077aa",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": true, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1.4, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": true, "blinkSpeed": 1, "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200, "hideNativeCaret": true, "showChar": true,
    "moveDelayMs": 0, "smear": false, "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4, "smearDamping": 0.8,
    "smoothEnabled": true, "smoothStopBlinking": true, "smoothness": 0.15,
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true
  },
  "FairyDust": {
    "cursorStyle": "Underline", "colorDark": "#fff6bd", "colorLight": "#e9cb35",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": true,
    "backspaceDisintegrate": true, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": true,
    "energySpeed": 1.4, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1, "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200, "hideNativeCaret": true, "showChar": true,
    "moveDelayMs": 0, "smear": true, "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4, "smearDamping": 0.8,
    "smoothEnabled": true, "smoothStopBlinking": true, "smoothness": 0.15,
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true
  },
  "DarkMatter": {
    "cursorStyle": "Box", "colorDark": "#3ba2e3", "colorLight": "#e15ff2",
    "crtEffect": true, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": true,
    "backspaceDisintegrate": true, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": true, "speedDemonSparks": true,
    "speedDemonSensitivity": 0.5, "cursorOpacity": 1, "energyEffect": true,
    "energySpeed": 1.4, "trailLength": 3, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1, "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200, "hideNativeCaret": true, "showChar": true,
    "moveDelayMs": 0, "smear": false, "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4, "smearDamping": 0.8,
    "smoothEnabled": true, "smoothStopBlinking": true, "smoothness": 0.15,
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true
  },
  "old_Joe": {
    "cursorStyle": "Box", "colorDark": "#c2c2c2", "colorLight": "#454545",
    "crtEffect": false, "glow": true, "torchEffect": false,
    "overlaySpareSidebars": true, "overlayFollowMode": "caret",
    "overlayRadius": 250, "overlayDarkness": 0.7, "overlayIntensity": 0.1,
    "overlayColor": "#ff963c", "overlayFlicker": false, "overlaySpeed": 0.22,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": false,
    "backspaceDisintegrate": true, "lineSerifs": false, "boxHollow": false,
    "boxHollowWidth": 2, "speedDemon": false, "speedDemonSparks": true,
    "speedDemonSensitivity": 1, "cursorOpacity": 1, "energyEffect": false,
    "energySpeed": 1.4, "trailLength": 10, "trailFadeMs": 450,
    "blinkingEnabled": false, "blinkSpeed": 1.5, "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200, "hideNativeCaret": true, "showChar": true,
    "moveDelayMs": 0, "smear": false, "smearStiffness": 0.65,
    "smearTrailingStiffness": 0.15, "smearDamping": 0.4,
    "smoothEnabled": false, "smoothStopBlinking": true, "smoothness": 0.15,
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true
  },
  // Added 2026-09-17 from a share code the user posted, decoded with
  // codeToPreset and written out as the sparse delta the code carries: every
  // key it omits inherits from DEFAULT_SETTINGS through presetWithDefaults,
  // which is how a share code is meant to be read. A box caret in the
  // cursor's colour, Hot-head in that colour and heated by Speed Demon, a
  // tapered smear, smooth movement, no blink.
  "FireBox": {
    "colorDark": "#f7e259", "colorLight": "#f3a65e",
    "gradientDark1": "#d9e4d8", "gradientDark2": "#ffbb00",
    "gradientLight1": "#f4c066", "gradientLight2": "#eb402d",
    "overlayDarkness": 0.7, "overlayIntensity": 0.1, "overlayFlicker": false,
    "caretWidthPx": 3, "popLetters": false, "flameTrail": false,
    "lineSerifs": true, "speedDemon": true,
    "hotHead": true, "hotHeadQuantity": 1.6, "hotHeadSpread": 3,
    "hotHeadTrail": 19, "hotHeadFade": 1180, "hotHeadFlat": true,
    "hotHeadIdleMs": 500, "hotHeadSpeedHeat": true,
    "energySpeed": 1.4,
    "blinkingEnabled": false, "blinkSpeed": 1.5, "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200,
    "smearStiffness": 0.85, "smearTrailingStiffness": 0.15, "smearTaper": true,
    "smoothEnabled": true, "smoothness": 0.05, "catchUpSpeed": 0.6,
    "maxCatchUpSpeed": 0.9, "popEffects": false
  },
};

// Which of the above a brand-new install opens on.
//
// It is applied once, on first load, rather than being folded into
// DEFAULT_SETTINGS - and that is not a stylistic choice. DEFAULT_SETTINGS is
// the share-code baseline: shareFields() emits only the keys that DIFFER from
// it, and the recipient fills the rest back in from their own copy. Move a
// default and every share code ever posted silently decodes to a different
// look, which is the same class of break as reordering LOOK_KEYS. The defaults
// are a wire format; the starter look is a product decision. Keep them apart.
const DEFAULT_PRESET_NAME = "Jell-O";

// Point a fresh install's live settings at the starter preset, in place.
// Returns whether it found one to apply.
//
// Reads out of settings.userPresets rather than DEFAULT_PRESETS directly, so
// the live look and the preset entry are guaranteed to be the same snapshot -
// the same reasoning that sets vimActivePreset to "Preset1" in onload(). Call
// it AFTER the preset-seeding loop.
function applyStarterPreset(settings) {
  const starter = settings && settings.userPresets && settings.userPresets[DEFAULT_PRESET_NAME];
  if (!starter) return false;
  // presetWithDefaults, not a bare Object.assign: a starter written before
  // some setting existed must land on that setting's default rather than on
  // whatever happened to be in the object already (see loadUserPreset).
  Object.assign(settings, presetWithDefaults(starter));
  return true;
}

// ---------------------------------------------------------------------------
// Default Vim presets — seeded into any install that doesn't already have a
// vimPresets key. Existing user vim presets are never overwritten, and a name
// that already exists is left alone.
//
// There is exactly one: "Preset1", the baked-in starting point defined above.
// Shipping a single, complete preset (rather than a showcase library) means a
// brand-new install's saved preset and its live per-mode config are the same
// thing, so the Vim panel opens on a preset that is genuinely "Currently
// active" instead of an unsaved config that merely resembles one.
// ---------------------------------------------------------------------------
const DEFAULT_VIM_PRESETS = {
  "Preset1": PRESET1_VIM_MODES,
};

// ---------------------------------------------------------------------------
// Preset share-code codec
//
// The recipient already has LOOK_KEYS, in the same order, and DEFAULT_SETTINGS.
// So a share code doesn't need to carry key NAMES or unchanged VALUES at all -
// only the name, plus the fields that actually differ from the defaults, each
// as a position in LOOK_KEYS. That is the whole reason these codes shrank from
// ~2.3k characters to a line or two: the old format spelled out all 77 keys and
// their values as JSON, then base64'd the lot.
//
// Format (version "1"):
//   1|<name>|<i><type><value>~<i><type><value>~...
//   • name is percent-encoded so a "|" or "~" in it can't split the code.
//   • each field is an index into LOOK_KEYS, a one-char type tag, then the value:
//       b0 / b1   boolean            (bracketTether at index 40 off/on)
//       n<num>    number             ("n0.35", "n180")
//       c<hex>    colour, # dropped  ("c39ff14")
//       s<enc>    string, %-encoded  (cursorStyle, overlayFollowMode)
//   • only fields differing from DEFAULT_SETTINGS are emitted; on decode,
//     everything else falls back to the default via presetWithDefaults.
//
// This is the only accepted format. A pre-v1 decoder (raw base64url JSON) used
// to run as a fallback for anything without the "1|" prefix; it has been
// removed. Note this is unrelated to migrateLegacyKeys, which maps renamed
// SETTING KEYS and is still very much load-bearing - a v1 code written before
// a key was renamed still decodes into the old key names and needs it.
// ---------------------------------------------------------------------------
const SHARE_VERSION = "1";

function shareEncodeValue(v) {
  if (typeof v === "boolean") return "b" + (v ? "1" : "0");
  if (typeof v === "number") return "n" + shareNum(v);
  if (typeof v === "string") {
    // A colour is "#" followed by 3/6 hex digits; store it tag-free without the
    // "#" since that's the common case and by far the bulkiest.
    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) return "c" + v.slice(1);
    return "s" + encodeURIComponent(v);
  }
  // Anything exotic (shouldn't occur for look keys) round-trips as JSON.
  return "j" + encodeURIComponent(JSON.stringify(v));
}

// Trim a number to its shortest exact decimal string: integers lose the ".0",
// and float noise like 0.35000000000000003 is rounded to a sane precision
// before being stringified so it doesn't bloat the code.
function shareNum(n) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

function shareDecodeValue(tag, raw) {
  switch (tag) {
    case "b": return raw === "1";
    case "n": return Number(raw);
    case "c": return "#" + raw;
    case "s": return decodeURIComponent(raw);
    case "j": try { return JSON.parse(decodeURIComponent(raw)); } catch { return undefined; }
    default:  return undefined;
  }
}

// One look snapshot's worth of fields: every LOOK_KEY that differs from the
// defaults, as "<index><tag><value>", joined by "~". Split out of
// presetToCode so the Vim format below can reuse it per mode rather than
// reimplementing the delta rules and drifting from them.
function shareFields(look, defaults) {
  const fields = [];
  for (let i = 0; i < LOOK_KEYS.length; i++) {
    const k = LOOK_KEYS[i];
    if (!(k in look)) continue;
    const v = look[k];
    if (v === undefined) continue;
    // Skip anything equal to the default - the recipient fills it back in.
    // Numbers compared loosely so 0.5 and "0.5" (from an old code round-trip)
    // don't both get emitted; everything else by strict identity.
    if (v === defaults[k]) continue;
    if (typeof v === "number" && typeof defaults[k] === "number" &&
        shareNum(v) === shareNum(defaults[k])) continue;
    fields.push(i + shareEncodeValue(v));
  }
  return fields.join("~");
}

// Inverse of shareFields. Always returns an object, never null: an empty body
// legitimately means "identical to the defaults", which is not the same thing
// as a body being absent (see codeToVimPreset).
function shareParseFields(body) {
  const snap = {};
  if (!body) return snap;
  for (const field of body.split("~")) {
    if (!field) continue;
    // Leading digits are the LOOK_KEYS index; the next char is the type tag.
    const m = /^(\d+)(.)([\s\S]*)$/.exec(field);
    if (!m) continue;
    const key = LOOK_KEYS[Number(m[1])];
    if (!key) continue; // index from a newer version we don't know: skip it
    const val = shareDecodeValue(m[2], m[3]);
    if (val !== undefined) snap[key] = val;
  }
  return snap;
}

function presetToCode(name, snap) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  const body = shareFields(pickLook(snap), defaults);
  return [SHARE_VERSION, encodeURIComponent(name || ""), body].join("|");
}

function codeToPreset(code) {
  const trimmed = (code || "").trim();
  // Anything that isn't the versioned format is rejected outright. That
  // includes a Vim code ("2|..."), which is five look snapshots and has no
  // meaning as a single cursor look - the import button reads the prefix
  // itself and says so, rather than leaving the user with a flat "invalid".
  if (trimmed.slice(0, 2) !== SHARE_VERSION + "|") return null;
  try {
    const parts = trimmed.split("|");
    // parts[0] is the version, already matched. Extra "|" only appears if the
    // name field held a literal one, which encodeURIComponent prevents - so a
    // fixed 3-way split is safe.
    const name = decodeURIComponent(parts[1] || "") || "Imported preset";
    return { name, snap: shareParseFields(parts.slice(2).join("|")) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vim share codes.
//
// A Vim preset is FIVE look snapshots, one per mode, so it cannot go through
// presetToCode: that encodes the LOOK_KEYS found at the top level of the
// object it's handed, and the top level of a Vim preset holds mode names, not
// look keys. Handing one over produced a code with an empty body - every Vim
// preset encoded to "1|<name>|", carrying nothing but its name, and importing
// one silently rebuilt the built-in starter looks (cloneVimModes falls back to
// VIM_MODE_STARTERS for any mode the snapshot doesn't describe, and it didn't
// describe any of them). That's what this format exists to fix.
//
// Layout: version "2", the name, then one field-body per mode in
// VIM_MODE_KEYS order, all "|"-separated:
//
//   2|<name>|<normal>|<insert>|<visual>|<replace>|<command>
//
// Each body is exactly what shareFields emits for a regular preset, so a mode
// costs nothing for every key it leaves at the default. "|" is safe as the
// separator because the name is %-encoded and a field body only ever contains
// digits, a tag char, "~", and %-encoded values.
//
// An EMPTY body and a MISSING one mean different things, deliberately: empty
// says "this mode is exactly the defaults", missing (a shorter code, e.g. one
// written before a mode existed) leaves that mode to fall back to its starter
// look. Conflating the two is how a mode that was deliberately left at the
// defaults would come back wearing the starter's colours.
// ---------------------------------------------------------------------------
const SHARE_VERSION_VIM = "2";

function vimPresetToCode(name, modes) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  // Expand through vimModeSnapshot first so a partial or hand-edited preset
  // encodes what it would actually LOAD as, rather than emitting a mode's
  // absence and leaving the recipient to resolve it differently.
  const bodies = VIM_MODE_KEYS.map((m) =>
    shareFields(pickLook(vimModeSnapshot(m, modes && modes[m])), defaults));
  return [SHARE_VERSION_VIM, encodeURIComponent(name || ""), ...bodies].join("|");
}

// Returns { name, modes } - modes being a sparse map of mode key to look
// overrides, ready for cloneVimModes - or null if this isn't a Vim code.
function codeToVimPreset(code) {
  const trimmed = (code || "").trim();
  if (trimmed.slice(0, 2) !== SHARE_VERSION_VIM + "|") return null;
  try {
    const parts = trimmed.split("|");
    const name = decodeURIComponent(parts[1] || "") || "Imported Vim preset";
    const modes = {};
    VIM_MODE_KEYS.forEach((m, i) => {
      const body = parts[2 + i];
      if (body === undefined) return; // absent: let the starter fill it in
      modes[m] = migrateLegacyKeys(shareParseFields(body));
    });
    return { name, modes };
  } catch {
    return null;
  }
}

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
function fitCanvasRegion(need, clip, current, opts = {}) {
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
function wrapperClipForStatusBar(wrapper, bar) {
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

function hexToRgba(hex, alpha) {
  let h = (hex || "#39ff14").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const int = parseInt(h, 16) || 0;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex) {
  let h = (hex || "#ff963c").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const n = parseInt(h, 16) || 0;
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Lift a channel toward white by `f`. Used to keep the bolt's core brighter
// than its halo without carrying two palettes around.
function lighten(c, f) {
  return Math.round(c + (255 - c) * f);
}

// The colour ramp for one strike: two or three palette entries, picked without
// replacement and left in the order they came out, running from the sky end of
// the bolt down to the impact. Rolled fresh per strike, so the same key gives a
// blue-into-white bolt one time and a red-purple-yellow one the next.
//
// With Pop Effects' Rainbow on, `hue` is the strike's slot in the shared sweep
// and the palette is bypassed entirely: the ramp is built from that hue and
// two neighbours instead, climbing in lightness toward the impact so the bolt
// still reads as light rather than as a coloured line. The neighbours are
// close together on purpose - a bolt spanning half the colour wheel stops
// looking like one discharge.
function thunderRamp(hue = null) {
  if (typeof hue === "number") {
    return [
      hslToRgbTuple(hue, 0.85, 0.62),
      hslToRgbTuple(hue + 18, 0.8, 0.72),
      hslToRgbTuple(hue + 36, 0.7, 0.85),
    ];
  }
  const pool = THUNDER_PALETTE.slice();
  const n = 2 + (Math.random() < 0.55 ? 1 : 0);
  const stops = [];
  for (let i = 0; i < n; i++) {
    stops.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return stops;
}

// Sample a ramp at 0..1.
function thunderColorAt(stops, t) {
  if (stops.length === 1) return stops[0];
  const p = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const f = p - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function hexToRgbTuple(hex) {
  let h = (hex || "#ffffff").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16) || 0;
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

// Converts an HSL color (h in degrees, s/l in 0..1) to an "rgb(r, g, b)"
// string, matching the format the particle system already uses for colors.
// The tuple form is the real implementation: Rainbow now feeds three separate
// effects (popped letters, Thunderstrike's colour ramp, Fireworks' sparks) and
// two of them need [r,g,b] to interpolate or nudge before anything is painted,
// so building a string first and re-parsing it would be pure waste.
function hslToRgbTuple(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (hue < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (hue < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (hue < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (hue < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}
function hslToRgbString(h, s, l) {
  const [r, g, b] = hslToRgbTuple(h, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}

// --- HSV, for the Speed Demon heat ramp ---------------------------------
// The ramp is interpolated in HSV rather than RGB because a straight RGB lerp
// between two colours that sit on opposite sides of the wheel passes through
// grey: blue → yellow, for instance, has a washed-out sage midpoint. Fire is
// never desaturated, so any segment that visibly greys out breaks the effect.
// Rotating the hue instead keeps every intermediate colour fully lit, which is
// what makes the ramp read as a temperature rather than a crossfade.
function rgbToHsv([r, g, b]) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max > 1e-6 ? d / max : 0, max];
}

function hsvToRgb([h, s, v]) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));
  const c = val * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = val - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) { r1 = c; g1 = x; }
  else if (hue < 120) { r1 = x; g1 = c; }
  else if (hue < 180) { g1 = c; b1 = x; }
  else if (hue < 240) { g1 = x; b1 = c; }
  else if (hue < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

// Blend two HSV colours, taking the SHORT way around the hue wheel so a
// transition never doubles back through the half of the spectrum it isn't
// heading for (red → violet goes through magenta, not through green).
//
// `arc` overrides that when the short way is the wrong way round: +1 forces
// the hue to climb, -1 forces it to fall, 0 (default) takes the short way.
// Used for the ignition segment, where "shortest" is not the same as "most
// like fire" - see heatColor.
//
// A colour with no saturation has no meaningful hue - its stored hue is an
// artefact of whatever it was derived from. Interpolating toward that number
// would swing the saturated end through unrelated colours on its way to grey,
// so when one end is colourless the other end's hue is simply held and only
// saturation/value move.
function lerpHsv(a, b, f, arc = 0) {
  let hue;
  if (a[1] < 0.03) hue = b[0];
  else if (b[1] < 0.03) hue = a[0];
  else {
    let d = ((b[0] - a[0] + 540) % 360) - 180;
    if (arc > 0 && d < 0) d += 360;
    else if (arc < 0 && d > 0) d -= 360;
    hue = a[0] + d * f;
  }
  return [hue, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function rgbTupleToHex([r, g, b]) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`;
}

// --- Hot-head: the fire's colour ramp -------------------------------------
// Waypoint positions. The first is a placeholder filled in per-call with the
// cursor's own colour (see hotFireColor), so the coolest fire is the colour of
// the cursor that lit it and everything above that is a warm climb.
// Separate from Speed Demon's heatColor, which has its own ramp for the caret.
// The cursor's own colour is deliberately given only a sliver at the very
// bottom. It used to hold the bottom 28%, which - combined with the fact that
// most particles spend most of their life at a low temperature - meant the bulk
// of the fire was drawn in the cursor's colour rather than in fire colours. With
// the default green cursor the whole effect came out green. It's a waypoint so
// the fire still resolves to the cursor's colour at its coolest edge, but it
// shouldn't be most of what you see.
const HOT_STOP_POS = [0, 0.12, 0.42, 0.72, 1];

// The fixed hot end, as HSV: a warm blackbody climb, yellow up through
// red-orange to white-hot. No violet/blue - this is deliberately the classic
// "fire" ramp rather than a full-spectrum one, so the whole effect reads as
// something burning rather than as a colour cycle. Value is pinned at 1 so the
// cursor emits light rather than reflecting it; only hue and saturation carry
// the temperature. The white end keeps a faint warm tint instead of being pure
// #ffffff, so the hottest core still looks like flame.
const HOT_HSV = [
  [ 44, 1.00, 1.00],  // amber-yellow (a touch warmer than a pure 48 gold,
                      // which reads green-ish next to orange)
  [ 30, 1.00, 1.00],  // orange
  [ 12, 0.95, 1.00],  // red-orange
  [ 26, 0.20, 1.00],  // white-hot, faintly warm
];

// Temperature is lifted by this exponent before the ramp is sampled. A particle
// cools linearly with its remaining life, but lifetimes are skewed short, so a
// linear mapping parks most of the fire at the very bottom of the ramp - the
// cursor's own colour - and almost nothing in the oranges. Raising temp to a
// power below 1 pushes the bulk of the distribution up into the fire colours
// while leaving the extremes where they are.
const HOT_TEMP_GAMMA = 0.55;

// --- Hot-head: pixel fire, after smear-cursor.nvim's particle renderer -----
// (sphamba/smear-cursor.nvim, lua/smear_cursor/draw.lua :: draw_particles)
//
// Upstream's insight, which this keeps: particles are dimensionless POINTS
// binned into a grid, and how big one LOOKS is decided by its age, not by any
// per-particle radius. Fresh particles are drawn as solid blocks, aged ones
// shrink to specks, then they fade. That progression is the whole effect.
//
// Upstream's grid, which this does NOT keep: it bins into character cells
// subdivided 4 rows x 2 cols, and gives all eight sub-cells of a cell one
// shared colour and glyph, because a terminal can only put one character in
// one cell. On a canvas that constraint doesn't exist, and honouring it anyway
// made the grid far too legible - the fire came out as a lattice of
// character-sized rectangles that read as a tiling artefact rather than as
// fire. So the grid here is a fine SQUARE lattice, sized off the font rather
// than off the character cell, and every grid square decides its own size and
// colour from the particles in it. Same big-to-small-to-gone progression, none
// of the character-cell banding.
//
// 2026-09-17: this renderer was replaced twice in one day - by a renderer of
// individual squares, then by upstream's own cell lattice - and brought back
// on the user's instruction, "as it was", with one change asked for by name:
// MORE BLOCK TYPES. Every fresh particle used to be the same 2x2 patch, so
// the mass was a checkerboard of one shape. Upstream's octant glyphs give a
// cell any of 256 shapes, and that variety is what reads as fire rather than
// as tiling. So a particle now carries a SHAPE from the table below, chosen
// at spawn - the longer it will live, the bigger the shape, and the recording's
// 2-wide 4-tall column is the biggest - mirrored at random, and stepping down
// the table as the particle ages, until the pixel and the dot the original
// had. Everything else - the lattice, the rates, the physics, the shading,
// the cell union - is the original.
//
// Size stages, in grid squares:
// 4.5 (from 5.6) and a cap of 5: a 5px square at body size. Chunks are drawn
// in these squares, so the whole fire scales with this number. Settled by
// eye on 2026-09-17: 5.6 (4px) left a speck no size between the full square
// and one pixel less, 3.8 (6px) was too big a fire, 4.5 is where the user
// stopped.
const HOT_PX_DIVISOR = 4.5;   // font size / this = grid square, in px
const HOT_PX_MIN = 2;
const HOT_PX_MAX = 5;
// Below this fraction of its life a particle is a small dot inside one grid
// square whatever its shape; above it, its shape (shrinking with age).
const HOT_STAGE_PIXEL = 0.22;
// The block shapes, biggest first, as rows of grid squares top to bottom;
// the bottom-left square is the particle's own and the shape grows up and
// right (fire rises), mirrored left-right at random per particle. A particle
// spawns partway down this list by how long it will live - a long-lived one
// at the top, a short-lived one near the single square - and walks the rest
// of the way down as it ages, so every chunk shrinks through several shapes
// before it is a dot. Areas: 8, 6, 5, 5, 6, 4, 3, 3, 3, 2, 2, 1.
const HOT_BLOCK_SHAPES = [
  ["11", "11", "11", "11"],   // 2x4 column, the recording's chunk
  ["011", "111", "111"],      // 3x3 notched, the widest
  ["110", "111", "111"],
  ["11", "11", "11"],         // 2x3
  ["01", "11", "11"],         // 2x3 notched at the top
  ["10", "11", "11"],
  ["111", "111"],             // 3x2 wide
  ["1", "1", "1", "1"],       // 1x4 thin column
  ["11", "11"],               // 2x2, the original's fresh block
  ["1", "1", "1"],            // 1x3 tall
  ["01", "11"],               // small L
  ["10", "11"],
  ["111"],                    // 3x1
  ["11"],                     // 2x1 wide
  ["1", "1"],                 // 1x2 tall
  ["1"],                      // 1x1, the original's pixel
];
// How the shade stage is read off a shape's area, for the per-stage alpha
// below: the biggest chunks are the most solid.
const hotShapeStage = (area) => (area >= 6 ? 3 : area >= 4 ? 2 : area >= 2 ? 1.5 : 1);
// The palette, kept small on purpose ("less gradients"): a chunk's colour is
// one of HOT_COLOR_LEVELS steps along the ramp, and the ramp is only used up
// to HOT_TEMP_MAX of its length - from the base colour into the first warm
// stops, never on to white-hot. Alpha likewise steps through
// HOT_ALPHA_LEVELS. Three colours, three alphas: pixel art, not a gradient.
const HOT_COLOR_LEVELS = 3;
const HOT_TEMP_MAX = 0.5;
const HOT_ALPHA_LEVELS = 3;
const hotQuant = (v, levels) => Math.round(Math.max(0, Math.min(1, v)) * levels) / levels;
// Sparks: the tiny particles. Every chunk spawns this many alongside it -
// short-lived specks that rise faster and higher than the chunks, drawn at
// their own positions off the lattice. They are the haze above the flame.
// Their own budget, so they never starve the chunks.
const HOT_SPARKS_PER_CHUNK = 1;
const HOT_SPARK_MAX = 60;
// Both caps are PER CARET. The ember pool is shared by every caret and the
// primary spawns first each frame, so with its fire sitting at the cap a
// secondary could never light at all - which is what "hot-head has no
// multi-cursor effect" was (2026-09-17). Each full-effects caret adds a
// cap's worth, up to this many carets, the way stardust already does.
const HOT_BUDGET_CARETS = 8;
// A speck - a spark, or a spent chunk's dot - is a square this fraction of a
// grid square, still snapped to the lattice (centred in its square, whole
// pixels). 1.0 was a full square, 0.6 rounded to half of one at body size
// and was "way too small"; 0.85 is where the user stopped. A speck is whole
// pixels: on the 5px square at body size 0.85 rounds to 4px, one under the
// full square; on a 4px square (smaller fonts) to 3px; on 3px to 3px.
const HOT_SPECK_SCALE = 0.85;
// A third, finer population: half-size specks (HOT_FINE_SCALE of a square),
// dimmer, spawned with a chunk only HOT_FINE_CHANCE of the time so they
// stay a hint - "not too much, so the effect is subtle". They rise like
// sparks and count against the sparks' cap.
const HOT_FINE_SCALE = 0.5;
const HOT_FINE_CHANCE = 0.4;
// A jump - a committed caret move of JUMP_TRAIL_MIN_DIST or more, the same
// test the jump trail and the glitch use - puts the caret in fire for
// HOT_ENGULF_MS: while it lands and settles, chunks and sparks spawn all
// around its box, below and beside it as well as above, the way the steady
// fire already does at the edge of a line. A first cut threw a burst outward
// from a ring around the drawn caret instead; it never showed, because with
// Smooth Movement the drawn caret eases across a jump and never travels far
// in one frame.
const HOT_ENGULF_MS = 260;
const HOT_ENGULF_RATE = 320;           // particles per second around the caret, at Quantity 1
const HOT_ENGULF_PAD_X = 1.1;          // how far beside the caret, in character widths
const HOT_ENGULF_ABOVE = 0.35;         // above the caret's top, in line heights
const HOT_ENGULF_BELOW = 0.25;         // below its bottom
const HOT_SPARK_LIFT = 1.9;     // times the chunk's buoyancy
const HOT_SPARK_RISE = 5;       // cw/s of extra upward start
// Discrete shade steps (upstream color_levels). Quantising keeps edges crunchy.
const FLAME_LEVELS = 16;

// Particle budget and physics. Units marked "cw" are character widths (or
// character widths per second) exactly as upstream expresses them, multiplied
// by the measured character width at spawn - so the fire scales with font size
// instead of being tuned for one zoom level.
// 110, up from 50: the trail behind a moving caret needs its own budget (see
// HOT_TRAIL_* below), or it only ever gets what the head leaves over.
const FLAME_MAX_NUM = 110;
const FLAME_MAX_LIFETIME = 620;         // ms, default fade time
// Upstream particle_lifetime_distribution_exponent. lifetime = max * rand^n
// skews toward zero, so most particles are short-lived specks and a minority
// are long-lived blocks. That ratio is what gives the fire a few solid chunks
// in a haze of sparks.
const FLAME_LIFETIME_EXP = 3.4;
// A quarter of what the original emitted (1350, 1.4, capped at 260 alive).
// With every particle a different shape the mass has to break into chunks
// to show them, and the original filled its cap and packed 180 particles
// into two characters' width - a wall, and a wall has no shapes. At this
// rate a few dozen are alive: distinct chunks, a column above the caret,
// specks at the top. Quantity scales it back up for anyone who wants the
// wall.
const FLAME_PER_SECOND = 190;           // steady emission while burning
const FLAME_PER_LENGTH = 0.8;           // extra particles per cw of caret travel
const FLAME_SPREAD = 0.5;               // cw, lateral scatter at the emit point
const FLAME_INITIAL_VELOCITY = 6;       // cw/s, upstream particle_max_initial_velocity
const FLAME_VELOCITY_FROM_CURSOR = 0.2; // share of caret velocity inherited
const FLAME_RANDOM_VELOCITY = 62;       // cw/s, per-frame turbulence
const FLAME_DAMPING = 0.2;              // per 17ms, upstream particle_damping
// Upstream's particle_gravity is +20 (downward: it's a smear, debris falls).
// Negated here, because this is fire. Damping is strong, so what matters is the
// terminal velocity it implies - roughly accel * 0.085 - and the Flame Height
// setting scales this directly.
const FLAME_BUOYANCY = -120;            // cw/s^2

// How long a patch of text keeps burning after the caret has moved off it, at
// Fire Spread = 1. Scaled by the setting. This is what makes the fire linger
// over what you just wrote instead of tracking the caret like a spotlight.
// "Use cursor color" variance. The ramp STARTS at exactly the cursor's colour
// and only lightens with heat - a mix toward white, with a small hue swing -
// so the fire is never darker than the cursor. It used to run the colour's
// value from 0.45x up to 1.15x, which with the temperature range capped at
// half the ramp (HOT_TEMP_MAX) left every chunk below the cursor's
// brightness: on a light theme, whose cursor is dark, that was a black fire.
const HOT_FLAT_HUE_SPAN = 26;    // degrees, total swing across the ramp
const HOT_FLAT_LIGHTEN = 0.55;   // how far toward white the hottest end goes

// Where the base of the fire sits relative to the top of the glyphs, as a
// fraction of the font size. NEGATIVE means below that line, i.e. overlapping
// the letters slightly.
//
// Zero would put the base exactly on the glyph tops, which still reads as a
// gap once the particles shrink with age - a flame has to bite into what it
// is burning to look attached to it. A small overlap is what makes the fire
// touch the text instead of hovering over it.
const HOT_HEAD_LIFT = -0.06;

// Vertical jitter around that base, as a fraction of the line height.
// Asymmetric on purpose: mostly upward, since flames rise, but with a little
// downward room so some particles sit right on the letters rather than every
// one of them starting above.
const HOT_HEAD_JITTER_UP = 0.16;
const HOT_HEAD_JITTER_DOWN = 0.05;

const HOT_BURN_LINGER_MS = 240;
const HOT_BURN_MAX = 64;                // most burn marks kept alive at once (path marks included)
// The trail. In the recording the cursor's PATH burns: fire is left on the
// text it passed over and goes on burning there for a moment, fading. Three
// things make that here. The marks behind the caret share the emission by
// their remaining strength to the power HOT_TRAIL_FADE_POW - 1 is linear,
// the 2 it used to be starved a mark of fire as soon as it was a little old
// and the trail was gone before it read as one. The total emission scales
// with how much is alight up to HOT_TRAIL_EMIT_MAX times the single-mark
// rate (was 1.6), so a trail does not just thin the head out. And fire off
// a mark behind the caret is jittered DOWN over the glyphs by up to
// HOT_TRAIL_DOWN of the line height - on the text, where the recording has
// it - while the head itself stays licking up off the letters.
const HOT_TRAIL_FADE_POW = 1;
// The path marks (see updateHotHeadInertia): one every this many characters
// along the way the caret came, at most this many per frame, the far end
// aged by this share of the linger.
const HOT_TRAIL_STEP_CW = 1.0;
const HOT_TRAIL_PATH_MAX = 24;
const HOT_TRAIL_PATH_AGE = 0.35;
const HOT_TRAIL_EMIT_MAX = 3.6;
const HOT_TRAIL_DOWN = 0.55;

function invertColor(colorStr) {
  const nums = (colorStr || "").match(/[\d.]+/g);
  if (!nums || nums.length < 3) return "#000000";
  const [r, g, b] = nums.map(Number);
  return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
}

// Parse either form the engine deals in - "#rgb"/"#rrggbb" from the settings,
// or "rgb(r, g, b)" from getComputedStyle and from heatColor - into [r,g,b].
//
// invertColor above only ever handled the second form (its regex finds no
// digits worth having in a hex string), which is fine for its one caller but
// makes it useless as a building block. Returns null rather than a guess when
// it can't parse, so callers can fall back deliberately.
function parseColorTuple(colorStr) {
  if (!colorStr || typeof colorStr !== "string") return null;
  const s = colorStr.trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length < 6) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const nums = s.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  const t = nums.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
  return t.some((v) => !Number.isFinite(v)) ? null : t;
}

// WCAG relative luminance. Note this is NOT the same as "average brightness":
// green weighs ten times what blue does, which is exactly why a naive
// mid-channel test picks the wrong glyph colour over saturated blues.
function relLuminance(rgb) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const GLYPH_MIN_CONTRAST = 4.5;

// How the character inside a filled Box cursor is coloured.
//
//   contrast  black or white, whichever measures higher against the box.
//             Neutral and always legible. The default.
//   tinted    invert the box, then push toward a pole until it clears the
//             floor. Keeps a hue, at the cost of that hue being the box's
//             COMPLEMENT - a green cursor gives a magenta letter, which
//             passes the contrast test and still looks wrong. Named for what
//             you get rather than "auto", which implied the plugin was
//             choosing for you - that is what "contrast" does.
//   invert    raw inversion, no floor. Purest reading of "flipped colours",
//             and genuinely unusable on a mid-grey box, which inverts to
//             within one unit of itself.
const GLYPH_COLOR_MODES = ["contrast", "tinted", "invert"];

// The colour for the character drawn inside a FILLED Box cursor.
//
// This used to be invertColor(textColor): the inverse of whatever the editor
// was painting the text under the caret. That reference is wrong twice over.
// It never looks at the box the glyph is landing on, so legibility was pure
// coincidence - a Catppuccin Latte note (text #4c4f69) on a blue box gave a
// sludge-grey glyph at 3.4:1, and the same text on the yellow Vim-visual box
// gave 1.3:1, i.e. invisible. And because the reference is the *syntax
// highlighted* colour at the caret, the glyph changed hue as you moved across
// tokens for no reason a user could see.
//
// So: invert the BOX, which is the thing the glyph actually sits on, then
// enforce a contrast floor. Plain inversion alone isn't enough - it fails flat
// on anything near mid-grey (#808080 inverts to itself) - so when the inverse
// doesn't clear the floor we slide it toward whichever pole the box isn't
// until it does. Contrast is monotonic along that slide, so a coarse scan
// finds the first passing step; stopping AT the threshold rather than jumping
// straight to black/white is the whole point, since it keeps as much of the
// inverted hue as legibility allows.
function readableGlyphColor(boxColorStr, mode = "contrast") {
  const box = parseColorTuple(boxColorStr);
  if (!box) return "#000000";

  const inv = [255 - box[0], 255 - box[1], 255 - box[2]];
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

  // Raw inversion. No floor, no neutralising - if you pick a mid-grey cursor
  // this WILL be illegible, and that is the honest behaviour of the mode.
  if (mode === "invert") return rgb(inv);

  const white = [255, 255, 255], black = [0, 0, 0];
  // Which pole gives more contrast, MEASURED rather than guessed from a
  // luminance threshold. The usual `luminance < 0.5 ? white : black` shortcut
  // is wrong over a wide band: the contrast formula is a ratio of (L + 0.05),
  // so its crossover sits at L ~ 0.179, not 0.5. That shortcut picked white
  // for #c792ea at 2.4:1 when black was available at 9.4:1.
  const poleC = contrastRatio(white, box) >= contrastRatio(black, box) ? white : black;

  // The default. A neutral, because inverting a colour rotates its HUE to the
  // complement rather than producing something neutral - green inverts to
  // magenta, which clears the contrast floor comfortably and still reads as
  // the wrong colour entirely. Black on a green box measures 13:1 where the
  // magenta scrapes 4.85:1, so this is not a trade of legibility for
  // neutrality; it wins on both.
  if (mode !== "tinted") return rgb(poleC);

  // "tinted": keep the inverted hue when it is already legible, and slide it
  // toward the pole only as far as the floor requires. Contrast is monotonic
  // along that slide, so a coarse scan finds the first passing step; stopping
  // AT the threshold rather than jumping to the pole is the whole point, as
  // it preserves as much of the hue as legibility allows.
  if (contrastRatio(inv, box) >= GLYPH_MIN_CONTRAST) return rgb(inv);

  const pole = poleC[0];
  const STEPS = 16;
  let best = inv;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const c = [
      Math.round(inv[0] + (pole - inv[0]) * t),
      Math.round(inv[1] + (pole - inv[1]) * t),
      Math.round(inv[2] + (pole - inv[2]) * t),
    ];
    best = c;
    if (contrastRatio(c, box) >= GLYPH_MIN_CONTRAST) break;
  }
  return rgb(best);
}

// Candle flicker, as a multiplier on the torch's base glow strength.
//
// Returns 1 with amount 0, and swings within 1 ± amount otherwise - so at the
// maximum the flame drops to nothing and doubles, and at the default 0.35 it
// breathes gently either side of the level the Glow Strength slider set.
//
// Pure, closed-form, and driven by wall clock: it is sampled from the torch
// tick under the frame governor, NOT from a CSS animation. The previous
// implementation was a keyframe animation, which runs on the compositor
// entirely outside the governor and therefore pinned the display at full
// refresh rate for as long as the torch was lit, in whichever gear the loops
// had otherwise chosen. See the notes in styles.css.
function torchFlickerScale(nowMs, amount) {
  const a = Math.max(0, Math.min(1, amount));
  if (a === 0) return 1;
  const t = nowMs / 1000;
  let n = 0;
  for (let i = 0; i < TORCH_FLICKER_RATES.length; i++) {
    n += Math.sin(t * TORCH_FLICKER_RATES[i] + TORCH_FLICKER_PHASES[i]) * TORCH_FLICKER_WEIGHTS[i];
  }
  // Dips only, never brightens: a candle gutters down from steady and comes
  // back, it does not flare above its own level. (The reference's keyframes run
  // brightness 1.0 down to 0.75 and back, never above 1.) Mapping the -1..1 sum
  // onto 1-a..1 rather than 1-a..1+a is the difference between a flame and a
  // throbbing lamp.
  return 1 - a * (1 - n) / 2;
}

// prefers-reduced-motion, applied as ONE gate over the effective settings
// rather than as a check inside each effect. Every read in both render loops
// goes through effectiveSettings, so suppressing keys here reaches the spawn
// sites, the draw calls, the frame governor's animating test and the settings
// the panel describes, all at once - and an effect added later is covered by
// whichever of these keys gates it, with no new plumbing.
//
// Mutates in place: it only ever runs on the freshly-merged copy inside
// effectiveSettings, never on this.settings, so nothing here is persisted and
// the panel keeps showing what the user actually chose.
//
// The line drawn is movement and emission, not the cursor's existence. A caret
// that is a different colour or shape is not motion, and blinking is left alone
// - it is the platform-standard behaviour of every text caret, it is well under
// the flash thresholds, and someone who wants it gone has a switch for it.
const REDUCED_MOTION_OFF_KEYS = [
  "smoothEnabled",       // the cursor gliding to its destination
  "smear",               // corner springs
  "popEffects",          // letters, disintegration, thunderstrike, fireworks
  "flameTrail",          // pixel trail, including the jump streak
  "stardustEnabled",     // ambient drift
  "hotHead",             // continuous fire
  "speedDemonSparks",    // emission; the heat colour itself is not motion
  "crtGlitch",           // whole-cursor displacement bursts
  "energyEffect",        // wall-clock shimmer inside the cursor body
  "blinkBreathing",      // size oscillation
  "overlayBlinkSync",    // torch radius pulse
  "overlayFlicker",      // torch candle flicker
];

function applyReducedMotion(obj) {
  for (const k of REDUCED_MOTION_OFF_KEYS) obj[k] = false;
  return obj;
}

function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

// Deterministic 0..1 hash of three small integers, used to drive the Signal
// Glitch. Math.random() is deliberately NOT used: the glitch re-rolls its
// slice offsets on a time bucket rather than per frame, so the SAME roll has
// to be reproducible for every frame inside one bucket. With Math.random()
// each frame would draw a different arrangement and the effect would smear
// into noise instead of stepping between a few distinct broken states, which
// is what actually reads as a mistracked signal.
function glitchNoise(a, b, c) {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Returns true only for elements that actually host a blinking text caret.
// contentEditable and <textarea> always qualify. For <input> we filter by
// type: text/search/url/tel/email/password/number are text fields; checkbox,
// radio, range, color, button, etc. don't have a caret and must be excluded
// so clicking an Obsidian settings toggle (which is <input type="checkbox">)
// doesn't cause the plugin to draw a cursor on top of it.
function isTextCaretHost(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return (
      type === "text" || type === "search" || type === "url" || type === "tel" ||
      type === "email" || type === "password" || type === "number"
    );
  }
  return false;
}

function blinkAlphaAt(nowMs, speed, onOffBalance = 0.5, fade = 0.15) {
  if (speed <= 0) return 1;
  const period = 2500 / speed; 
  const phase = (nowMs % period) / period; 
  // Fraction of the period spent fading, per side. Clamped below 0.5 so the two
  // fades never overrun the cycle; at exactly 0.5 the holds are gone and the
  // blink is one continuous ease down-and-up (a gentle "breathing" fade).
  fade = Math.max(0.02, Math.min(0.5, fade ?? 0.15));
  const balance = Math.max(0.1, Math.min(0.9, onOffBalance));
  const hold = 1 - fade * 2; 
  const onHold = hold * balance;
  const offHold = hold * (1 - balance);
  const p1 = onHold;
  const p2 = p1 + fade;
  const p3 = p2 + offHold;
  let a;
  if (phase < p1) a = 1;
  else if (phase < p2) a = 1 - easeInOutSine((phase - p1) / fade);
  else if (phase < p3) a = 0;
  else a = easeInOutSine((phase - p3) / fade);
  return a;
}

module.exports = class CursorSmithPlugin extends Plugin {
  async onload() {
    const rawSaved = await this.loadData();
    const saved = migrateLegacyKeys(rawSaved);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    // A genuinely fresh install: no data file at all. Distinct from "a data
    // file missing some key", which every backfill below handles instead, and
    // the difference matters - the starter look must be applied exactly once,
    // on the very first load, and never again over settings a user has since
    // touched.
    const freshInstall = !rawSaved || typeof rawSaved !== "object";

    // Migrate: existing installs that already had Vim cursors on should land
    // on the Vim panel by default instead of silently reverting to CUA.
    if (saved && saved.uiMode === undefined) {
      this.settings.uiMode = this.settings.vimModeEnabled ? "vim" : "cua";
    }

    // Retired key: the "restore Obsidian's previous vim state" machinery is
    // gone (see setVimModeEnabled), and a stale saved value used to poison
    // the CUA switch into re-enabling vim forever. Drop it from settings so
    // it also disappears from data.json on the next save.
    delete this.settings.vimPrevObsidianVim;

    // Seed default presets for first-time users (or any install missing them).
    // Only adds keys that don't already exist — never overwrites user presets.
    if (!this.settings.userPresets) this.settings.userPresets = {};
    for (const [name, snap] of Object.entries(DEFAULT_PRESETS)) {
      if (!(name in this.settings.userPresets)) {
        this.settings.userPresets[name] = snap;
      }
    }

    // A new install opens on a look somebody actually designed, rather than on
    // the raw DEFAULT_SETTINGS - which are a neon-green blinking box matching
    // no preset in the list, so the first thing a new user saw was the one
    // look they could not get back to. See DEFAULT_PRESET_NAME for why this
    // happens here instead of in the defaults themselves.
    if (freshInstall && applyStarterPreset(this.settings)) {
      // So the palette's next/previous-preset command steps on from here
      // instead of restarting at the top of the list.
      this._activePresetName = DEFAULT_PRESET_NAME;
    }

    // Vim: rebuild every mode as a COMPLETE look snapshot. This backfills any
    // missing key (including all the effect keys added when per-mode support
    // went full-featured) and migrates the old v1 shape, which only stored a
    // few keys plus a "useCustomColors" gate: when that gate was off the mode
    // used to inherit the global colors, so bake those in now.
    {
      const savedModes =
        this.settings.vimModes && typeof this.settings.vimModes === "object"
          ? this.settings.vimModes
          : {};
      const fresh = {};
      for (const mode of VIM_MODE_KEYS) {
        const saved = Object.assign({}, savedModes[mode] || {});
        if (saved.useCustomColors === false) {
          saved.colorDark = this.settings.colorDark;
          saved.colorLight = this.settings.colorLight;
        }
        delete saved.useCustomColors;
        // Start from this mode's starter defaults, then apply the saved values
        // so a returning user keeps their choices while gaining the new keys.
        fresh[mode] = Object.assign({}, DEFAULT_SETTINGS.vimModes[mode], pickLook(saved));
      }
      this.settings.vimModes = fresh;
    }

    // Seed default vim presets (only names that don't already exist).
    const hadVimPresets = !!this.settings.vimPresets;
    if (!this.settings.vimPresets) this.settings.vimPresets = {};
    for (const [name, snap] of Object.entries(DEFAULT_VIM_PRESETS)) {
      if (!(name in this.settings.vimPresets)) {
        this.settings.vimPresets[name] = cloneVimModes(snap);
      }
    }

    // On a genuinely fresh install the live per-mode config IS Preset1 (see
    // DEFAULT_SETTINGS.vimModes), so name it as the active preset — otherwise
    // the Vim panel would show a saved preset that nothing is marked as using.
    // Guarded on hadVimPresets so an existing user who deliberately cleared
    // vimActivePreset (by hand-editing a mode) doesn't get it re-asserted.
    if (!hadVimPresets && !this.settings.vimActivePreset) {
      this.settings.vimActivePreset = "Preset1";
    }

    // Commit the first-run config now that every block above has had its say.
    // Without this there is no data file until the user changes something, so
    // the freshInstall test would answer "yes" again on the next load and the
    // starter look would be re-applied over whatever they had. That is only
    // harmless while nothing else keys off first-run state, which is a
    // guarantee for today rather than for the next person to edit this.
    //
    // saveData rather than saveSettings: the latter also re-applies body
    // classes, the overlay style and the Vim status bar, none of which exist
    // yet this early in onload. They'd each fail into their own try/catch and
    // log, and the setup below builds all three properly a moment later.
    if (freshInstall) {
      try {
        await this.saveData(this.settings);
      } catch (e) {
        // A vault that can't be written to is the user's problem to fix, not
        // a reason to abort loading the plugin: everything above is already
        // correct in memory, so this run works and only persistence is lost.
        console.error("[cursor-smith] could not write initial settings:", e);
      }
    }


    // Dynamic Multi-Window Tracking Engine. Cleanups are keyed by the document
    // they belong to so a closed pop-out window can be unregistered
    // individually - see registerWindowEvents / unregisterDocument.
    this._docCleanups = new Map();
    this.registeredDocuments = new Set();

    // Engine Core States
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;

    // Every pool, cache and derived caret/smear value the engine builds up as
    // it runs. ONE function, called from here, enableCanvasEngine() and
    // disableCanvasEngine(), because keeping three hand-written lists in sync
    // is an invariant that fails silently and had already drifted: `trail`,
    // `lastActive` and the firework/stardust rate stamps were reset in two of
    // the three places, and `_hotPrev`, `_taperBuf`, `heat` and the tether
    // anchors in only one. Adding an effect now touches one reset site, not
    // three.
    this._resetEngineState();

    this.overlay = null;
    this.modalObserver = null;
    this.modalOpen = false;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;
    this.lastCaret = null;
    this.lastCaretMove = 0;
    this.mouseX = this.x;
    this.mouseY = this.y;
    this.lastMouseMove = 0;
    
    this.canvasEngineActive = false;
    this.torchEngineActive = false;
    this.canvasRaf = 0;
    this.torchRaf = 0;

    // Per-frame write-dedupe + chrome-inset cache (see _chromeInsets)
    this._lastWrapperRect = "";
    this._canvasBlend = "";   // last mix-blend-mode written (see applyCanvasBlend)
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._chromeCache = null;
    // Per-caret computed-style/metric cache for cmCaretCoords (see there).
    this._caretStyleCache = null;
    this._tickErrorLogged = false;
    this._torchErrorLogged = false;
    // Single-flight latch for the palette's mode toggle; see toggleUiMode.
    this._uiModeSwitching = false;

    // -----------------------------------------------------------------------
    // Command palette — three entries, registered unconditionally.
    //
    // All three work regardless of whether Cursor-Smith itself is toggled on:
    // the Vim system deliberately never reads settings.enabled or the engine
    // flags, so "Cycle preset" keeps functioning with the custom cursors off.
    //
    // "Cycle preset" is one command that dispatches on the current mode
    // (CUA presets in CUA mode, Vim presets in Vim mode) under a single
    // stable ID, so one hotkey works in both modes.
    //
    // "Toggle CUA/Vim mode" was removed from the palette once, and is back.
    // Worth knowing why it left, because the reasons were real and none of
    // them was "we changed our minds": firing setVimModeEnabled from an
    // arbitrary app state ran a side-effect chain — flipping Obsidian's vim
    // keybindings via updateOptions(), which rebuilds every editor's
    // extensions, plus the synthetic-Escape normal-mode forcing — with no
    // idea whether there was an editor to run it against, and a failure
    // anywhere in it could lose the mode change itself.
    //
    // What changed is that every step of that chain now defends itself, and
    // none of that hardening was done for this command's sake:
    //
    //   • setVimModeEnabled PERSISTS the mode before any side effect runs, so
    //     nothing downstream can lose the switch.
    //   • Obsidian's vim keybindings are driven level-triggered and
    //     symmetrically, so there is no captured "previous state" left to be
    //     poisoned by a crash mid-switch.
    //   • forceVimNormalMode is single-flight, retries only until the vim
    //     adapter shows up (~1s) rather than spinning, bails outright if the
    //     mode flipped back underneath it, and is cancelled on unload.
    //
    // The one hazard the palette adds that the settings panel does not is
    // REPEAT: a held hotkey re-fires as fast as the OS repeats it, where a
    // segmented button cannot be clicked again mid-flight. toggleUiMode() is
    // single-flighted for exactly that, and is the only thing here that
    // exists because of the palette.
    // -----------------------------------------------------------------------
    this.addCommand({
      id: "cycle-preset",
      name: "Cycle preset",
      callback: () => this.cycleActivePreset(1),
    });

    // "toggle", not "toggle-cursor-smith": Obsidian prefixes every command
    // id with the plugin id, and the review rejects repeating it. Renamed
    // in 1.5.4, so a hotkey bound to the old id has to be bound again.
    this.addCommand({
      id: "toggle",
      name: "Toggle on/off",
      callback: () => this.toggle(),
    });

    this.addCommand({
      id: "toggle-cua-vim-mode",
      name: "Toggle CUA / Vim mode",
      callback: () => this.toggleUiMode(),
    });

    // Issue #30's reporter had a fast machine and a slow Obsidian, and the
    // only way to see why was a profile from THEIR machine. This is the
    // one-click version: ten seconds of counting what the loop does, the
    // environment it does it in, and a report on the clipboard to paste
    // into an issue.
    this.addCommand({
      id: "performance-report",
      name: "Performance report (10 seconds, copied to the clipboard)",
      callback: () => this.performanceReport(10),
    });

    // Held so toggleUiMode can refresh the panel when the mode is switched
    // from the palette while Settings happens to be open (refreshSettingTab).
    this.settingTab = new CursorSmithSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Status bar indicator. The canvas tick calls updateVimStatusBar() the
    // instant the mode changes, so while the cursor engine runs this interval
    // is pure backstop — it only matters with the custom cursors toggled off,
    // and for noticing a theme switch. 250ms is plenty for that, and past the
    // signature check the update is a no-op, keeping the steady-state cost to
    // one memoized mode read per tick.
    this.registerInterval(window.setInterval(() => this.updateVimStatusBar(), 250));

    // Pop-out windows: drop a document's listeners and stylesheet as its window
    // closes. Without this, registeredDocuments only ever grew - every closed
    // pop-out stayed in the set with a live cleanup closure pinning its
    // `document` and `window`, and applyBodyClasses / disableCanvasEngine /
    // disableTorchOverlay went on iterating detached documents for the rest of
    // the session.
    // Layout can move without any input: a theme or snippet change, a pane
    // opening or closing, a leaf change. Each invalidates the geometry
    // caches; none needs a frame on its own (the heartbeat repaints).
    for (const ev of ["css-change", "layout-change", "active-leaf-change", "resize"]) {
      try {
        this.registerEvent(this.app.workspace.on(ev, () => this._invalidateLayout()));
      } catch { /* an event this Obsidian does not have */ }
    }

    this.registerEvent(
      this.app.workspace.on("window-close", (_leaf, win) => {
        const doc = (win && win.document) || (_leaf && _leaf.doc) || null;
        if (doc) this.unregisterDocument(doc);
      })
    );

    this.app.workspace.onLayoutReady(() => {
      // Honor the auto-control setting on startup: if Vim cursors are on and
      // we're meant to drive Obsidian's Vim keybindings, make sure they're on.
      if (this.settings.vimModeEnabled && this.settings.vimControlObsidian) {
        this.setObsidianVim(true);
      }
      if (this.settings.enabled) this.enable();
      this.syncVimStatusBar();
    });
  }

  onunload() {
    this.disable();
    // Cancel any pending Normal-mode retry so it can't fire after unload.
    if (this._vimNormalRetryT) {
      window.clearTimeout(this._vimNormalRetryT);
      this._vimNormalRetryT = 0;
    }
    // Obsidian removes status bar items registered through addStatusBarItem
    // on unload anyway, but doing it explicitly keeps hot-reload (e.g. via the
    // BRAT / hot-reload dev plugins) from briefly showing a stale label.
    if (this.vimStatusEl) {
      this.vimStatusEl.remove();
      this.vimStatusEl = null;
    }
    // Unregister every document we ever attached to. Iterating a copy because
    // unregisterDocument mutates the map.
    for (const doc of Array.from(this._docCleanups.keys())) {
      this.unregisterDocument(doc);
    }
  }

  // Detach everything this plugin put into one document: its listeners, its
  // body classes, its layers. Called per pop-out window as it closes, and for
  // every registered document on unload.
  //
  // Thorough on purpose. Obsidian updates a plugin by unloading and reloading
  // it WITHOUT reloading the window, so anything left behind survives into
  // the new version - which is how the stylesheet versions before 1.5.4
  // injected once outlived the release that wrote it, and why this still
  // removes one.
  unregisterDocument(doc) {
    const cleanup = this._docCleanups.get(doc);
    if (cleanup) {
      try { cleanup(); } catch (e) { console.error("[cursor-smith] document cleanup failed:", e); }
      this._docCleanups.delete(doc);
    }
    this.registeredDocuments.delete(doc);
    // If the canvas currently lives in this document - which is now routine:
    // it migrates into the 1.13 settings window while you type there, and
    // that window can simply be closed - drop our references along with it.
    // The next tick's ensureCanvasForView sees no wrapper and rebuilds in
    // the right document immediately; holding on instead would pin the
    // closed window's detached DOM tree until the ownerDocument-mismatch
    // check happened to notice.
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument === doc) {
      try { this.canvasWrapper.remove(); } catch { /* already torn down */ }
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
      this._canvasRect = null;
    }
    try {
      // Versions before 1.5.4 injected a stylesheet; an update in place
      // unloads one of them into this same window.
      doc.getElementById("cursor-smith-dynamic-styles")?.remove();
      doc.querySelector(".cursor-smith-torch-glow")?.remove();
      doc.body?.classList.remove(
        "cursor-smith-active", "cursor-smith-hide-native", "cursor-smith-torch-active");
    } catch { /* document already torn down with its window */ }
  }

  registerWindowEvents(doc) {
    if (this.registeredDocuments.has(doc)) return;
    this.registeredDocuments.add(doc);
    
    const onMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.lastMouseMove = performance.now();
      // Wakes only the torch (which may be following the mouse) — moving the
      // pointer must not spin the cursor canvas up to full rate.
      this._wakeTorch();
    };
    // Any of these means the picture may be about to change: snap the render
    // loops out of idle so the very next frame reflects it.
    const onActivity = () => this._markActivity();
    // Everything below used to hang off `keydown` alone, and that is exactly
    // why none of it worked on a phone.
    //
    // A software keyboard (Gboard especially, and iOS to a lesser degree) does
    // not report character keys through keydown. It fires keydown with
    // `key: "Unidentified"` and `keyCode: 229` - the "the IME is handling
    // this" sentinel - and the real text turns up in beforeinput/input
    // instead. Backspace is one of the few keys that DOES still send a genuine
    // keydown, which is why the bug report was "Speed Demon only reacts to
    // backspace": it was the only key the listener could see. Space never set
    // the firework flag either, so fireworks simply never fired on mobile.
    //
    // So the logical keystroke is recorded here, and both keydown (desktop,
    // and mobile's real keys) and beforeinput (mobile's character input) call
    // it. `kind` is what the keystroke MEANS, not which key produced it.
    const noteKeystroke = (kind, opts = {}) => {
      const now = performance.now();
      if (kind === "delete") this._deletePending = now;
      if (kind === "enter") this._enterPending = now;
      // Fireworks fire on Space as well as Enter. Kept as its own flag rather
      // than widening _enterPending, because the two effects want different
      // keys and folding them together would call down lightning on every
      // space bar press.
      if (kind === "enter" || kind === "space") this._popKeyPending = now;

      // Speed Demon: any key that plausibly represents "the user is working"
      // bumps heat. Two classes, because they don't deserve the same weight:
      //
      //   typing     characters plus Backspace/Enter/Space/Tab
      //   navigating arrows, Home/End, PageUp/Down - moving the caret without
      //              writing anything
      //
      // Navigation used to be filtered out entirely, which made the whole
      // effect invisible to anyone reading or moving around a file. It counts
      // now, at a lower rate than typing, so scrubbing through a document
      // warms the caret without pretending it's the same thing as writing.
      //
      // Autorepeat rules live in keystrokeHeatWeight, per kind, because they
      // are NOT uniform: holding an arrow key or Backspace is the fast way to
      // do that thing and must keep heating (at a discount), while a held
      // character key is ignored - leaning on "a" is not typing. See the
      // helper for the desktop/mobile split that made "delete" earn its
      // repeat exemption the hard way.
      if (!this.settings.speedDemon) return;
      const weight = keystrokeHeatWeight(kind, !!opts.repeat);
      if (!weight) return;
      const bump = 0.09 * weight * (this.settings.speedDemonSensitivity ?? 1);
      this.heat = Math.min(1, this.heat + bump);
      // Tells commitMove this move already paid for its heat, so a
      // keyboard-driven caret move isn't charged twice.
      this._heatKeyT = performance.now();
    };

    // Backspace/Delete flag: set on keydown, consumed by the next
    // commitMove() so the flame-pixel burst at the *old* caret position
    // knows it was caused by deletion (and can invert direction + color).
    // Timestamped so a stale flag from ~200ms ago doesn't wrongly colour a
    // burst caused by unrelated caret movement that arrived late.
    const onKeyDown = (e) => {
      this._markActivity();
      const k = e.key;
      // The IME sentinel. Nothing useful here - beforeinput will carry the
      // actual edit - and acting on it would charge every mobile keystroke as
      // an unknown character.
      if (k === "Unidentified" || k === "Process" || e.isComposing) return;

      // A real key came through, so this platform reports keydown properly.
      // beforeinput uses this to stay out of the way rather than double-count
      // (see there).
      this._realKeyT = performance.now();

      if (k === "Backspace" || k === "Delete") noteKeystroke("delete", e);
      // Enter flag: consumed by the next commitMove() so a Thunderstrike can
      // be aimed at the caret's NEW line. Keyed off the keystroke rather than
      // off "the caret moved down a line", because that also describes arrow
      // keys, clicking, and wrapping - none of which should call down
      // lightning.
      //
      // "Spacebar" is the legacy key name older Electron/IME paths still
      // report; both are accepted for the same reason beforeinput is listened
      // to at all.
      else if (k === "Enter") noteKeystroke("enter", e);
      else if (k === " " || k === "Spacebar") noteKeystroke("space", e);
      else if (k === "Tab" || (typeof k === "string" && k.length === 1)) {
        noteKeystroke("type", e);
      } else if (
        k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" ||
        k === "Home" || k === "End" || k === "PageUp" || k === "PageDown"
      ) {
        noteKeystroke("nav", e);
      }
    };

    // The mobile half. beforeinput describes the EDIT rather than the key, so
    // it says the same things in a different vocabulary - and it is the only
    // vocabulary a software keyboard speaks.
    //
    // Skipped whenever a real keydown just fired, because on desktop both
    // events arrive for the same keystroke and counting it twice would double
    // every heat bump. 60ms is comfortably longer than the keydown ->
    // beforeinput gap and far shorter than any plausible second keystroke.
    const onBeforeInput = (e) => {
      this._markActivity();
      if (performance.now() - (this._realKeyT || 0) < 60) return;
      const t = e.inputType || "";
      if (t.startsWith("delete")) noteKeystroke("delete");
      else if (t === "insertLineBreak" || t === "insertParagraph") noteKeystroke("enter");
      else if (t === "insertText" || t === "insertCompositionText" ||
               t === "insertReplacementText" || t === "insertFromPaste") {
        // Swipe typing and autocorrect deliver a whole word as one event. It
        // is still one gesture and gets one bump - charging it per character
        // would let a single swipe redline the heat.
        const data = typeof e.data === "string" ? e.data : "";
        noteKeystroke(data.endsWith(" ") ? "space" : "type");
      }
    };

    const onResize = () => {
      // Chrome insets and the deduped wrapper/overlay rects are all stale
      // after a resize - drop them so the next frame re-measures instead
      // of waiting out the 500ms cache window.
      this._chromeCache = null;
      this._lastWrapperRect = "";
      this._lastOverlayRect = "";
      // The region was fitted for the old viewport (and possibly the old
      // DPR): drop it and let the next frame's _fitCanvasRegion reallocate.
      // A resize usually rides along with a zoom, DPR, or theme change, any
      // of which can move the caret's font metrics without moving pos - so
      // drop the cached style read too rather than wait out its TTL.
      this._canvasRect = null;
      this._caretStyleCache = null;
      this._markActivity();
    };
    
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("keydown", onKeyDown, true);
    // Capture phase, like keydown: CodeMirror handles beforeinput itself and
    // may stop it, and an effect that vanishes inside the editor but works in
    // a search box would be worse than one that never worked at all.
    doc.addEventListener("beforeinput", onBeforeInput, true);
    // Wake sources beyond typing: caret moves from clicks and selection
    // changes, viewport shifts from scroll/wheel, and focus hops between
    // fields. All capture-phase (or document-level) so nothing that
    // stopPropagation()s can starve the render loops. Passive where
    // applicable so they can't add scroll latency.
    //
    // Scroll and wheel are filtered: a scroll only moves the caret when it
    // is the editor's own scroller (or an ancestor of it), or the container
    // of whatever field has focus. The file explorer scrolling, a hover
    // preview, another plugin's panel - none of those move the caret, and
    // each used to buy 1.2s of the hot gear. A plugin that scrolls something
    // continuously used to pin it forever.
    const onScrollLike = (e) => { if (this._scrollMovesCaret(e.target, doc)) this._markActivity(); };
    doc.addEventListener("selectionchange", onActivity);
    doc.addEventListener("mousedown", onActivity, true);
    doc.addEventListener("focusin", onActivity, true);
    doc.addEventListener("wheel", onScrollLike, { capture: true, passive: true });
    doc.addEventListener("scroll", onScrollLike, { capture: true, passive: true });
    // Window-level focus changes: with hideOnWindowBlur on, the picture
    // changes the instant the window goes to or comes back from the
    // background, so wake the loop instead of waiting out the idle heartbeat
    // (which would leave the cursor on screen for up to 100ms after you
    // alt-tab away, and missing for up to 100ms after you come back).
    // Registered on the window, not the document: that's where Chromium fires
    // an OS-level focus change. These only wake - windowFocused() re-reads the
    // real state each frame, so a missed event can't desync anything.
    const onWindowFocusChange = () => this._markActivity();
    const win = doc.defaultView;
    if (win) {
      win.addEventListener("resize", onResize);
      win.addEventListener("focus", onWindowFocusChange);
      win.addEventListener("blur", onWindowFocusChange);
    }

    // The workspace's window-close event (wired in onload) only fires for
    // pop-out WORKSPACE windows. The 1.13 settings window is an Obsidian
    // window with no workspace in it, so it closes without that event - and
    // a registered document with no close notification is precisely the leak
    // unregisterDocument exists to prevent: a dead document pinned in
    // registeredDocuments with a live cleanup closure holding its window.
    // pagehide is the closing document's own last word, so it covers every
    // non-workspace window without needing to know what kind it is; for
    // workspace pop-outs it simply races window-close, and
    // unregisterDocument is idempotent so whichever fires second is a no-op.
    // Never registered on the main document - it only "pagehides" when the
    // whole app is going down, and onunload already walks every document.
    let onPageHide = null;
    if (win && doc !== document) {
      onPageHide = () => this.unregisterDocument(doc);
      win.addEventListener("pagehide", onPageHide);
    }

    this._docCleanups.set(doc, () => {
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("beforeinput", onBeforeInput, true);
      doc.removeEventListener("selectionchange", onActivity);
      doc.removeEventListener("mousedown", onActivity, true);
      doc.removeEventListener("focusin", onActivity, true);
      doc.removeEventListener("wheel", onActivity, { capture: true });
      doc.removeEventListener("scroll", onActivity, { capture: true });
      if (win) {
        win.removeEventListener("resize", onResize);
        win.removeEventListener("focus", onWindowFocusChange);
        win.removeEventListener("blur", onWindowFocusChange);
        if (onPageHide) win.removeEventListener("pagehide", onPageHide);
      }
    });
  }

  async saveSettings() {
    // Guard against persisting a transient Vim-mode snapshot. The render loops
    // temporarily reassign this.settings to the effective (mode-merged) config
    // for the duration of a frame and restore it in a finally. That span is
    // fully synchronous today, so this can't fire mid-swap - but it's a
    // latent footgun: the day anything synchronous inside that span reaches
    // saveSettings (a dispatched DOM event handler, a future await), it would
    // write the mode snapshot to disk AS the global config, silently
    // corrupting settings in a way that's near-impossible to reproduce. Fail
    // loud and abort instead of persisting the wrong object.
    if (this._settingsSwapped) {
      console.error("[cursor-smith] saveSettings() called while settings were swapped for a Vim mode - aborting to avoid persisting a mode snapshot as global config.");
      return;
    }
    // userPresets lives inside this.settings so it survives every saveData
    // call automatically - no separate load/merge step needed anywhere.
    await this.saveData(this.settings);
    // Sliders and pickers mutate mode objects in place, so the memoized
    // per-mode merge must be rebuilt after every save.
    this._effCache = null;
    // Everything below is cosmetic. Each step is isolated so a failure in one
    // (or in an engine that's currently torn down) can neither block the
    // others nor bubble up and abort whichever command called saveSettings.
    try { this.applyBodyClasses(); } catch (e) { console.error("[cursor-smith] applyBodyClasses failed:", e); }
    try { this.applyOverlayStyle(); } catch (e) { console.error("[cursor-smith] applyOverlayStyle failed:", e); }
    // A per-mode color may have just been edited. The status bar dedupes on
    // (mode, theme, tint) — none of which changed — so drop the signature to
    // force it to re-read the color it should now be showing.
    try {
      this._vimStatusSig = null;
      this.updateVimStatusBar();
    } catch (e) { console.error("[cursor-smith] status bar refresh failed:", e); }
    // A per-mode torch setting (or the global one) may have just changed which
    // means the torch engine might now be needed, or no longer needed. Keep it
    // in sync so a mode that uses the spotlight lights up even when the global
    // torch is off. The torch tick handles per-frame show/hide + restyle.
    if (this.canvasEngineActive) {
      if (this.torchPossible() && !this.torchEngineActive) this.enableTorchOverlay();
      else if (!this.torchPossible() && this.torchEngineActive) this.disableTorchOverlay();
    }
  }

  // ---- User preset CRUD ----

  getUserPresets() {
    // Keep userPresets directly on this.settings so saveSettings() persists
    // them automatically. Initialise lazily on first use.
    if (!this.settings.userPresets) this.settings.userPresets = {};
    return this.settings.userPresets;
  }

  async saveUserPreset(name) {
    // Snapshot cursor settings only - exclude housekeeping keys that must
    // not be restored when the preset is loaded later.
    const snap = Object.assign({}, this.settings);
    delete snap.enabled;
    delete snap.userPresets;
    // Vim theming is its own independent system with its own presets — a
    // regular cursor preset must not carry (or later clobber) it.
    for (const k of VIM_STATE_KEYS) delete snap[k];
    this.getUserPresets()[name] = snap;
    await this.saveSettings();
  }

  async loadUserPreset(name) {
    const preset = this.getUserPresets()[name];
    if (!preset) return;
    const wasEnabled = this.settings.enabled;
    const presets = this.getUserPresets();   // hold ref before overwrite
    // Snapshot the independent vim state so an old/imported preset can't wipe
    // it (normal snapshots exclude these, but share codes are untrusted).
    const vimState = {};
    for (const k of VIM_STATE_KEYS) vimState[k] = this.settings[k];
    // Backfill first: an older/built-in preset saved before some setting
    // existed should land on that setting's default, not on whatever this
    // vault happened to have set beforehand (see presetWithDefaults).
    Object.assign(this.settings, presetWithDefaults(preset));
    this.settings.enabled = wasEnabled;
    this.settings.userPresets = presets;    // restore presets dict
    Object.assign(this.settings, vimState);
    await this.saveSettings();
    if (this.settings.enabled) this.enable();
    // Track which preset is active so cyclePreset() knows where to start.
    this._activePresetName = name;
  }

  async deleteUserPreset(name) {
    delete this.getUserPresets()[name];
    await this.saveSettings();
  }

  // Whether the plugin is currently "in Vim mode" for command purposes.
  // uiMode is the user-facing switch and vimModeEnabled is the feature flag;
  // renderModeSwitch and setVimModeEnabled keep them in step, but an install that
  // predates uiMode can have only the latter, so treat either as Vim.
  isVimUiMode() {
    return (this.settings.uiMode || "cua") === "vim" || !!this.settings.vimModeEnabled;
  }

  // The single palette command routes here: cycle whichever preset library
  // belongs to the mode the user is actually in.
  cycleActivePreset(direction) {
    if (this.isVimUiMode()) return this.cycleVimPreset(direction);
    return this.cyclePreset(direction);
  }

  cyclePreset(direction) {
    const presets = this.getUserPresets();
    const names = Object.keys(presets);
    if (names.length === 0) return;

    // Find index of the currently active preset (last loaded), or start at -1
    // so the first forward step lands on index 0.
    const current = this._activePresetName ?? null;
    const currentIdx = names.indexOf(current);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];

    void this.loadUserPreset(nextName).then(() => {
      this._activePresetName = nextName;
      // Persist the pending name so the settings tab reflects the active preset.
      this._pendingPresetName = nextName;
      new Notice(`Cursor-Smith: ${nextName}`);
      // The panel shows the loaded values and the pending name: hand it
      // new definitions (see refreshSettingTab).
      this.refreshSettingTab();
    });
  }

  // Returns the name it was saved under, or null if the code was invalid.
  async importPreset(code) {
    const result = codeToPreset(code.trim());
    if (!result) return null;
    this.getUserPresets()[result.name] = result.snap;
    await this.saveSettings();
    return result.name;
  }

  // The palette's CUA/Vim switch. Deliberately a wrapper around
  // setVimModeEnabled rather than a second way of doing the same thing: the
  // panel's segmented control and this command have to stay on one path, or
  // the two drift the moment either grows a step.
  //
  // Single-flight, and that guard exists FOR the palette. A segmented button
  // cannot be clicked again mid-flight; a hotkey held down re-fires as fast as
  // the OS repeats it, and setVimModeEnabled awaits a disk write in the middle
  // of a chain that rebuilds every editor's extensions. Without this, a held
  // key stacks overlapping switches whose saveSettings() calls race.
  //
  // Reads through isVimUiMode() rather than settings.uiMode directly, so an
  // install predating uiMode (vimModeEnabled only) toggles the right way on
  // the first press instead of appearing to do nothing.
  async toggleUiMode() {
    if (this._uiModeSwitching) return;
    this._uiModeSwitching = true;
    try {
      const next = !this.isVimUiMode();
      await this.setVimModeEnabled(next);
      // The status bar indicator only exists in Vim mode, so switching TO CUA
      // would otherwise be a silent no-feedback command - it removes the one
      // thing that was showing the mode. Say which mode you landed in.
      new Notice(`Cursor-Smith: ${next ? "Vim" : "CUA / Normal"} mode`);
      this.refreshSettingTab();
    } finally {
      // In a finally, not after the await: setVimModeEnabled swallows its own
      // side-effect failures but saveSettings() is not guarded, and a flag
      // left stuck true would kill the command for the rest of the session.
      this._uiModeSwitching = false;
    }
  }

  // Rebuild the settings panel's definitions after something outside the
  // panel changed what it shows.
  //
  // The panel is declarative (getSettingDefinitions): Obsidian renders the
  // LAST set of definitions it was handed and does not ask again when the
  // tab is opened, so a command that switches the mode or cycles a preset
  // has to hand it a new set or the panel opens showing the state you just
  // left. update() re-renders in place if the panel is on screen and just
  // stores the definitions otherwise. Fails closed - a stale panel is much
  // cheaper than a command that throws.
  refreshSettingTab() {
    try {
      const tab = this.settingTab;
      if (!tab || typeof tab.update !== "function") return;
      tab.update();
    } catch (e) {
      console.error("[cursor-smith] could not refresh the settings panel:", e);
    }
  }

  toggle() {
    const wasActive = !!(this.canvasEngineActive || this.torchEngineActive);
    wasActive ? this.disable() : this.enable();
    this.settings.enabled = !!(this.canvasEngineActive || this.torchEngineActive);
    void this.saveSettings();
  }

  // =========================================================================
  // Vim-aware cursors
  // =========================================================================

  // Single entry point for turning the plugin's Vim cursors on/off. Two
  // callers, and they must stay the only two: the settings panel's CUA/Vim
  // switch (renderModeSwitch) and the palette command (toggleUiMode, which
  // wraps this rather than repeating it). Also:
  //  • drives Obsidian's own Vim keybindings when vimControlObsidian is set
  //    (remembering the prior state so turning the feature off restores it),
  //  • creates/removes the status bar mode indicator.
  async setVimModeEnabled(value) {
    value = !!value;

    // 1. Flip and PERSIST the core state before any side effect runs, so the
    //    mode change is on disk no matter what the steps below do.
    this.settings.vimModeEnabled = value;
    this.settings.uiMode = value ? "vim" : "cua";
    await this.saveSettings();

    // 2. Drive Obsidian's own Vim keybindings — symmetric and level-triggered:
    //    Vim mode means ON, CUA mode means OFF, every time, no edge detection
    //    and no memory. This used to "restore whatever Obsidian's vim was
    //    before we forced it on", which is cleverer but proved fragile in
    //    practice: any bug or crash that captured OUR OWN forced-on state as
    //    the "previous" value poisoned the restore permanently — switching to
    //    CUA would then dutifully restore vim to on, forever, and the toggle
    //    looked dead. With vimControlObsidian the user has said the plugin
    //    owns this setting, so own it plainly in both directions. (Someone who
    //    manages Obsidian's vim by hand should keep vimControlObsidian off,
    //    which skips this entirely.)
    if (this.settings.vimControlObsidian) {
      try {
        if (value) {
          this.setObsidianVim(true);
          // Switching the vim engine on mid-session leaves the editor in
          // insert mode: the vim extension is added to an editor that was
          // already accepting free-form typing, and nothing tells it to enter
          // normal. Vim itself would land you in normal, so force it.
          this.forceVimNormalMode();
        } else {
          this.setObsidianVim(false);
        }
      } catch (e) {
        console.error("[cursor-smith] driving Obsidian vim keybindings failed:", e);
      }
    }

    // 3. Create or tear down the status bar item to match the new mode.
    try {
      this.syncVimStatusBar();
    } catch (e) {
      console.error("[cursor-smith] vim status bar update failed:", e);
    }
  }

  // Drop every open editor into Normal mode.
  //
  // Sending a synthetic Escape rather than poking cm.state.vim.insertMode
  // directly is deliberate: exiting insert is not just a flag flip. The vim
  // engine also has to close the change/undo group it opened on entry, run any
  // pending repeat (so a half-finished "3i" doesn't fire later), and move the
  // caret back one column the way real vim does. Clearing the flag by hand
  // skips all of that and leaves the engine inconsistent — Escape runs the
  // engine's own exit path, which is the only thing that gets it all right.
  //
  // updateOptions() rebuilds the editor's extensions asynchronously, so the
  // vim extension usually isn't installed yet on the first attempt; retry on a
  // short timer until the adapter shows up, then give up rather than spin.
  forceVimNormalMode(attempt = 0) {
    // Single-flight: a fresh call (or a mode flip back to CUA) supersedes any
    // pending retry, so rapid toggling of the settings switch can never stack
    // parallel retry chains, each dispatching its own Escapes.
    if (this._vimNormalRetryT) {
      window.clearTimeout(this._vimNormalRetryT);
      this._vimNormalRetryT = 0;
    }
    // The feature was switched off while a retry was pending — stop.
    if (!this.settings.vimModeEnabled) return;
    let anyEditor = false;
    try {
      for (const view of this.allEditorViews()) {
        anyEditor = true;
        const cm = this.getVimAdapter(view);
        // No adapter yet => the vim extension hasn't loaded into this editor.
        if (!cm) { anyEditor = false; break; }
        const v = cm.state.vim || {};
        if (!v.insertMode && !v.visualMode) continue; // already normal
        const target = view.contentDOM;
        if (!target) continue;
        const win = target.ownerDocument.defaultView || window;
        target.dispatchEvent(new win.KeyboardEvent("keydown", {
          key: "Escape", code: "Escape", keyCode: 27, which: 27,
          bubbles: true, cancelable: true,
        }));
      }
    } catch {
      /* best effort — never let this break the mode switch itself */
    }
    if (!anyEditor && attempt < 20) {
      this._vimNormalRetryT = window.setTimeout(() => {
        this._vimNormalRetryT = 0;
        this.forceVimNormalMode(attempt + 1);
      }, 50);
    }
  }

  // Every live CodeMirror view across all open markdown leaves (including
  // pop-out windows), not just the focused one — switching modes should settle
  // every editor, otherwise a background tab stays in insert until you visit
  // it and press Escape yourself.
  allEditorViews() {
    const views = [];
    const push = (v) => { if (v && !views.includes(v)) views.push(v); };
    try {
      push(this.app.workspace.activeEditor?.editor?.cm);
      this.app.workspace.iterateAllLeaves?.((leaf) => {
        push(leaf?.view?.editor?.cm);
      });
    } catch {
      /* iterateAllLeaves is stable API, but stay defensive */
    }
    return views;
  }

  // Turn Obsidian's built-in Vim keybindings on/off. setConfig is semi-internal
  // (guarded); updateOptions asks the workspace to re-derive editor extensions
  // so the change can take effect without a reload where that's supported.
  setObsidianVim(on) {
    try {
      if (this.app.vault.setConfig) this.app.vault.setConfig("vimMode", !!on);
      this.app.workspace.updateOptions?.();
    } catch {
      /* best-effort; otherwise applies on the next editor reload */
    }
  }

  // Whether Obsidian's own Vim keybindings are turned on (Settings → Editor →
  // Vim key bindings). getConfig is a semi-internal API, so it's fully guarded.
  isObsidianVimOn() {
    try {
      return !!(this.app.vault.getConfig && this.app.vault.getConfig("vimMode"));
    } catch {
      return false;
    }
  }

  // @replit/codemirror-vim (the vim engine Obsidian bundles) stashes a CM5-
  // compatible adapter on the EditorView; its own getCM(view) helper just
  // returns view.cm. We read it directly rather than importing the vim module,
  // since that module isn't guaranteed to be requireable from a plugin. The
  // adapter exposes the live vim state at cm.state.vim, which is what we need.
  getVimAdapter(view) {
    try {
      const cm = view && view.cm;
      if (cm && cm.state && cm.state.vim) return cm;
    } catch {
      /* fall through to DOM detection */
    }
    return null;
  }

  // Is a block ("fat") cursor currently shown? @replit/codemirror-vim toggles
  // the .cm-fat-cursor class on the content element for block-cursor modes
  // (normal/visual/replace). Insert mode uses a thin caret. This is the
  // fallback signal when the adapter isn't reachable.
  _vimBlockCursorShown(view) {
    try {
      const content = view.contentDOM;
      if (content && content.classList && content.classList.contains("cm-fat-cursor")) return true;
      const root = view.dom;
      return !!(root && "querySelector" in root && root.querySelector(".cm-fat-cursor"));
    } catch {
      return false;
    }
  }

  // Resolve the current Vim mode to one of VIM_MODE_KEYS, or null when it
  // can't be determined. Prefers the adapter's authoritative state (the only
  // way to reliably see "replace"); falls back to selection + block-cursor
  // heuristics, which cover normal/insert/visual but report replace as normal.
  detectVimMode(view) {
    const cm = this.getVimAdapter(view);
    if (cm) {
      const v = cm.state.vim || {};
      if (v.visualMode) return "visual";
      if (v.insertMode) {
        // Overwrite/replace ("R") is an insert-family state; the adapter marks
        // it via state.overwrite (and, in some builds, a vim flag). Either one
        // means replace.
        const replace = cm.state.overwrite || v.insertModeReplace || v.replaceMode;
        return replace ? "replace" : "insert";
      }
      return "normal";
    }
    // Adapter unavailable — infer from the editor.
    try {
      if (!view.state.selection.main.empty) return "visual";
      return this._vimBlockCursorShown(view) ? "normal" : "insert";
    } catch {
      return null;
    }
  }

  // Is the caret currently somewhere in Obsidian's interface rather than in a
  // note? That covers both halves of what "Command" means here:
  //
  //   • the built-in Vim command line — the ":" / "/" prompt, which the vim
  //     engine mounts as a CodeMirror panel with its own <input>, and
  //   • every other interface text field: Command Palette, Quick Switcher,
  //     search, file-tree rename, Settings inputs, other plugins' modals.
  //
  // The test is "a text field has focus and it isn't the note editor", which
  // is exactly the condition under which caretCoords() falls through to
  // genericCaretCoords() — so Command mode themes precisely the carets the
  // editor-aware path doesn't handle, with no gap and no overlap.
  //
  // isTextCaretHost keeps this off elements that have no caret at all
  // (checkboxes, sliders, buttons); without it, clicking a toggle in Obsidian's
  // own settings would count as entering Command mode.
  isVimCommandContext() {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      // The note editor has focus, so a real editing mode applies instead.
      if (view && view.hasFocus) return false;
      // Follow the active editor's window, then the canvas's, so this keeps
      // working in pop-out windows (same convention as the caret helpers).
      const doc =
        (view && view.dom && view.dom.ownerDocument) ||
        this.canvas?.ownerDocument ||
        document;
      return isTextCaretHost(doc.activeElement);
    } catch {
      return false;
    }
  }

  // The Vim mode that should currently drive the cursor's look, or null when
  // vim theming shouldn't apply (feature off, Obsidian vim off, or no caret
  // anywhere). Memoized for a frame so the several styleFor()/color reads per
  // draw don't each re-run detection.
  currentVimMode() {
    if (!this.settings.vimModeEnabled) return null;
    const now = performance.now();
    if (this._vimModeCacheT && now - this._vimModeCacheT < 15) return this._vimModeCache;

    let mode = null;
    try {
      if (this.isObsidianVimOn()) {
        // Interface/command line first. Whenever one of those fields has focus
        // the editor does not, so view.hasFocus is false and the branch below
        // would report null (no vim theming at all) — this check has to happen
        // before that gate, not inside it.
        if (this.isVimCommandContext()) {
          mode = "command";
        } else {
          const view = this.app.workspace.activeEditor?.editor?.cm;
          if (view && view.hasFocus) mode = this.detectVimMode(view);
        }
      }
    } catch {
      mode = null;
    }
    this._vimModeCache = mode;
    this._vimModeCacheT = now;
    return mode;
  }

  // The look/effect settings in force right now. When a Vim mode is active its
  // full snapshot is layered over the global settings; otherwise the global
  // settings are returned unchanged. The per-frame tick swaps this.settings to
  // this object for the duration of the draw, so every existing read of
  // this.settings in the engine automatically honors the active mode — no
  // per-key plumbing needed.
  // True when the OS asks for reduced motion and the user has not opted out.
  //
  // Read live off the MediaQueryList rather than cached in a field: `.matches`
  // is a plain property read, and a cached copy would need its own change
  // listener and would be one more thing that can desync. Guarded because
  // matchMedia is absent from the test harness's stubbed environment.
  reducedMotion() {
    if (this.settings.respectReducedMotion === false) return false;
    try {
      if (!this._reduceMQ) {
        const win = (this.canvas && this.canvas.ownerDocument.defaultView) || window;
        this._reduceMQ = win.matchMedia("(prefers-reduced-motion: reduce)");
      }
      return !!this._reduceMQ.matches;
    } catch {
      return false;
    }
  }

  effectiveSettings(mode) {
    if (mode === undefined) mode = this.currentVimMode();
    const cfg = (mode && this.settings.vimModes && this.settings.vimModes[mode]) || null;
    const reduce = this.reducedMotion();
    // The common case, and the only one that can hand back this.settings
    // untouched: no Vim mode to merge and nothing to suppress.
    if (!cfg && !reduce) return this.settings;
    // Memoized: two render loops each merged a fresh ~60-key object EVERY
    // frame, which is pure allocation/GC churn since the inputs only change
    // on a mode switch or a settings edit. Keyed on identity of the inputs;
    // saveSettings drops the cache so in-place edits (sliders mutate the
    // mode object directly, then save) are picked up immediately.
    const c = this._effCache;
    if (c && c.mode === mode && c.base === this.settings && c.cfg === cfg && c.reduce === reduce) {
      return c.obj;
    }
    const obj = Object.assign({}, this.settings, cfg);
    if (reduce) applyReducedMotion(obj);
    this._effCache = { mode, base: this.settings, cfg, reduce, obj };
    return obj;
  }

  // Thin passthrough kept so existing draw-path reads keep working. Because the
  // tick swaps this.settings to the effective (mode-merged) object, reading
  // this.settings[key] here already yields the active mode's value.
  styleFor(key) {
    return this.settings[key];
  }

  // Whether the torch overlay engine might be needed: either the global cursor
  // uses it, or Vim cursors are on and some mode uses it. The torch tick then
  // shows/hides + restyles the overlay per the effective (per-mode) settings.
  torchPossible() {
    if (this.settings.torchEffect) return true;
    if (this.settings.vimModeEnabled && this.settings.vimModes) {
      for (const m of VIM_MODE_KEYS) {
        if (this.settings.vimModes[m] && this.settings.vimModes[m].torchEffect) return true;
      }
    }
    return false;
  }

  // Called from the canvas tick the frame the active Vim mode changes. The
  // torch tick already reacts per-frame to the effective settings, but clearing
  // its cached style/rect signatures here makes the spotlight update on the
  // very next frame instead of waiting for the dedupe key to differ.
  onVimModeChanged() {
    this._overlaySig = "";
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    // Repaint the status bar label on the same frame as the cursor, so the two
    // never disagree about which mode you're in.
    this.updateVimStatusBar();
  }

  // =========================================================================
  // Vim mode indicator in Obsidian's status bar
  // =========================================================================

  // The mode the status bar should name. Falls back to reading the editor
  // directly when currentVimMode() returns null (focus is on a button, the
  // ribbon, empty space...): the editor is still in whatever mode it was, and
  // blanking the item every time focus touches a non-text element would make
  // it flicker constantly.
  statusBarVimMode() {
    if (!this.settings.vimModeEnabled || !this.isObsidianVimOn()) return null;
    const live = this.currentVimMode();
    if (live) return live;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (view) return this.detectVimMode(view);
    } catch {
      /* no editor open */
    }
    return null;
  }

  // Create the status bar element on demand, remove it when it shouldn't be
  // there. Kept as add/remove rather than a permanently-present hidden element
  // so the status bar doesn't carry an empty slot (and its separator padding)
  // for everyone who has the indicator switched off.
  syncVimStatusBar() {
    // addStatusBarItem is a desktop-only Obsidian API (mobile has no status
    // bar). Guarded so the whole mode toggle can't die over an indicator.
    if (typeof this.addStatusBarItem !== "function") return;
    const wanted = !!(this.settings.vimStatusBar && this.settings.vimModeEnabled);
    if (wanted && !this.vimStatusEl) {
      this.vimStatusEl = this.addStatusBarItem();
      this.vimStatusEl.addClass?.("cursor-smith-vim-status");
      // Pin to the LEFT edge of the status bar. Obsidian lays status items
      // out in one flex row packed toward the right; there's no official
      // "left side" API. flex `order` puts this item first in the row, and
      // `margin-right: auto` then absorbs all the free space after it, which
      // shoves every other item to the right and leaves this one flush left
      // — the standard flexbox left/right split. The class is styles.css's
      // (.cursor-smith-vim-status); it used to be inline out of a worry about
      // a stale cached stylesheet, and the plugin review rules static inline
      // styles out (obsidianmd/no-static-styles-assignment).
      this.vimStatusEl.addClass("cursor-smith-vim-status");
      this._vimStatusSig = null;
    } else if (!wanted && this.vimStatusEl) {
      this.vimStatusEl.remove();
      this.vimStatusEl = null;
      this._vimStatusSig = null;
    }
    this.updateVimStatusBar();
  }

  updateVimStatusBar() {
    const el = this.vimStatusEl;
    if (!el) return;
    try {
      const mode = this.statusBarVimMode();

      // Theme is part of the signature because the per-mode colors are
      // theme-dependent: switching dark→light has to re-tint the text even
      // though the mode itself never changed.
      const doc = el.ownerDocument || document;
      const isDark = doc.body.classList.contains("theme-dark");
      const tint = !!this.settings.vimStatusBarColor;
      const sig = `${mode}|${isDark}|${tint}`;
      if (sig === this._vimStatusSig) return;
      this._vimStatusSig = sig;

      if (!mode) { el.setText(""); el.setCssStyles({ color: "" }); return; }

      // Vim's own showmode format: "-- INSERT --", all caps.
      el.setText(`-- ${(VIM_MODE_LABELS[mode] || mode).toUpperCase()} --`);
      if (!tint) {
        // Clear rather than assign a "default": the status bar's own color is
        // theme-provided, so inheriting it is the only way to stay correct
        // across themes.
        el.setCssStyles({ color: "" });
        return;
      }
      // Read the mode's stored config, NOT this.settings — the canvas tick
      // swaps this.settings to the merged per-mode object for the duration of
      // a frame, and this runs on its own timer.
      const cfg = (this.settings.vimModes && this.settings.vimModes[mode]) || null;
      el.style.color = cfg ? (isDark ? cfg.colorDark : cfg.colorLight) : "";
    } catch {
      /* a bad frame must not kill the interval */
    }
  }

  // =========================================================================
  // Frame governor — power management for the render loops
  // =========================================================================
  // Both render loops used to run requestAnimationFrame unconditionally: the
  // full DOM-read + clear + redraw pipeline executed at display refresh rate
  // (120fps on ProMotion Macs) even while the cursor sat perfectly still.
  // That measured ~20% CPU/GPU at idle on Apple Silicon. The governor gives
  // each loop three gears:
  //   hot  — continuous rAF (capped near 60fps on high-refresh displays),
  //          while input is recent or any animation is genuinely in flight
  //   warm — ~30fps, only while a blink fade is mid-transition
  //   idle — ~10fps heartbeat that re-checks state and repaints ONLY if the
  //          picture changed; with a static, non-fading cursor the canvas
  //          isn't touched at all, so idle cost approaches zero
  // Input events snap the loops back to hot instantly (the pending idle
  // timeout is cancelled and a frame is requested immediately), so the
  // scheduling can never add perceptible input latency.

  // Called from input events. Timestamps the activity and wakes any dozing
  // loop right now instead of letting it sleep out its timeout.
  // Anything that can move the caret on screen bumps this; the geometry
  // caches (cmCaretCoords, getPaneRect, the secondaries') are keyed on it.
  _invalidateLayout() {
    this._layoutGen = (this._layoutGen | 0) + 1;
  }

  _markActivity() {
    this._lastActivityT = performance.now();
    this._invalidateLayout();
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
      if (this.canvasEngineActive && this._canvasTick) {
        this.canvasRaf = window.requestAnimationFrame(this._canvasTick);
      }
    }
    this._wakeTorch();
  }

  // A ResizeObserver on the active editor's content and scroller: an embed
  // or image finishing its load, a line wrapping differently after a font
  // loads - anything that changes the content's size moves the caret without
  // an input event, and bumps the layout generation here. Re-pointed when
  // the active editor changes; disconnected on unload.
  _observeEditorLayout(view) {
    if (this._roView === view) return;
    if (this._ro) { try { this._ro.disconnect(); } catch { /* gone */ } this._ro = null; }
    this._roView = view || null;
    if (!view || typeof ResizeObserver === "undefined") return;
    try {
      this._ro = new ResizeObserver(() => this._invalidateLayout());
      // border-box: a padding change on the content moves every line too,
      // and the default content-box would not report it.
      if (view.contentDOM) this._ro.observe(view.contentDOM, { box: "border-box" });
      if (view.scrollDOM) this._ro.observe(view.scrollDOM, { box: "border-box" });
    } catch { this._ro = null; }
    this._invalidateLayout();
  }

  // Whether a scroll or wheel event on `target` can move the caret: the
  // document itself (a window scroll), the active editor's scroller or an
  // ancestor of it, or any element containing the focused field. Everything
  // else scrolls something the caret is not in. See registerWindowEvents.
  _scrollMovesCaret(target, doc) {
    if (!target) return true;
    if (target === doc || target === (doc && doc.documentElement) || target === (doc && doc.defaultView)) return true;
    const contains = typeof target.contains === "function" ? (el) => !!el && target.contains(el) : () => false;
    let scroller = null;
    try { scroller = this.app.workspace.activeEditor?.editor?.cm?.scrollDOM || null; } catch { scroller = null; }
    if (scroller && (target === scroller || contains(scroller) || (typeof scroller.contains === "function" && scroller.contains(target)))) return true;
    const active = doc && doc.activeElement;
    if (active && active !== doc.body && contains(active)) return true;
    return false;
  }

  // Torch-only wake: mouse movement retargets the spotlight but shouldn't
  // spin the cursor canvas up to full rate.
  _wakeTorch() {
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
      if (this.torchEngineActive && this._torchTick) {
        this.torchRaf = window.requestAnimationFrame(this._torchTick);
      }
    }
  }

  // isPresentationModeActive runs two querySelector-style probes; at 120fps in
  // two loops that's ~500 DOM queries a second for a state that changes maybe
  // twice per session. Cache it for 500ms — a half-second delay in noticing a
  // presentation started/ended is invisible.
  presentationActive() {
    const now = performance.now();
    if (now - (this._presCacheT || 0) < 500) return !!this._presCacheV;
    this._presCacheT = now;
    this._presCacheV = this.isPresentationModeActive();
    return this._presCacheV;
  }

  // Count what the loop does for `seconds`, then put a report on the
  // clipboard (and in the console). The counters live on this._perf and
  // the tick adds to them only while that is set; see the tick.
  performanceReport(seconds = 10) {
    if (this._perf) {
      new Notice("Cursor-Smith: a performance report is already running.");
      return;
    }
    const perf = this._perf = this._freshPerf();
    let po = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { perf.longTasks++; perf.longTaskMs += e.duration; }
      });
      po.observe({ entryTypes: ["longtask"] });
    } catch { po = null; }
    const onKey = () => { perf.keys++; };
    const doc = (this.canvas && this.canvas.ownerDocument) || document;
    doc.addEventListener("keydown", onKey, true);
    new Notice(`Cursor-Smith: measuring for ${seconds} seconds - keep using Obsidian as you normally would.`);
    window.setTimeout(() => {
      this._perf = null;
      if (po) { try { po.disconnect(); } catch { /* gone */ } }
      doc.removeEventListener("keydown", onKey, true);
      const text = this.perfReportText(perf, seconds);
      const clip = (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"));
      clip.then(
        () => new Notice("Cursor-Smith: report copied to the clipboard."),
        () => {
          // No clipboard: the console is the fallback delivery, so this is
          // the one log the plugin makes, and only on that path.
          console.warn(text);
          new Notice("Cursor-Smith: report is in the developer console (Ctrl+Shift+I).");
        });
    }, seconds * 1000);
  }

  _freshPerf() {
    return {
      t0: performance.now(), ticks: 0, draws: 0, gears: {}, tickMs: 0, caretMs: 0, drawMs: 0,
      reanchors: 0, longTasks: 0, longTaskMs: 0, rafGaps: {}, rafPrev: 0, keys: 0,
    };
  }

  // The report's text. Pure apart from reading the environment, so the
  // shape can be tested with a synthetic counter object. Everything in it is
  // either a number the tick counted or a fact about the machine and the
  // configuration; nothing that identifies the vault or its contents.
  perfReportText(perf, seconds) {
    const s = this.settings || {};
    const secs = Math.max(0.001, seconds);
    const gearTotal = Object.values(perf.gears).reduce((a, b) => a + b, 0) || 1;
    const gears = Object.entries(perf.gears).sort((a, b) => b[1] - a[1])
      .map(([g, n]) => `${g} ${Math.round(100 * n / gearTotal)}%`).join(", ") || "none";
    const on = [];
    for (const k of ["gradientEnabled", "crtEffect", "glow", "crtNeon", "crtGlitch", "cursorTranslucent", "cursorRounded",
                     "blinkingEnabled", "smear", "smoothEnabled", "energyEffect", "popEffects", "popLetters", "flameTrail",
                     "fireworks", "thunderstrike", "backspaceDisintegrate", "hotHead", "stardustEnabled", "speedDemon",
                     "bracketTether", "torchEffect", "vimModeEnabled"]) {
      if (s[k]) on.push(k);
    }
    let gpu = "unknown";
    try {
      const c = createEl("canvas");
      const gl = c.getContext("webgl");
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : (gl ? "webgl, no renderer info" : "no webgl");
    } catch { /* leave unknown */ }
    let code = "";
    try { code = presetToCode("report", s); } catch { code = "(unavailable)"; }
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const win = typeof window !== "undefined" ? window : {};
    const clip = this._clipRect;
    const region = this._canvasRect;
    const app = this.app || {};
    const themeName = (app.customCss && (app.customCss.theme || app.customCss.currentTheme)) || "default";
    const snippets = app.customCss && app.customCss.enabledSnippets ? app.customCss.enabledSnippets.size : 0;
    const plugins = app.plugins && app.plugins.enabledPlugins ? app.plugins.enabledPlugins.size : 0;
    let gap = 0, gapN = 0;
    for (const [g, n] of Object.entries(perf.rafGaps || {})) { if (n > gapN) { gapN = n; gap = Number(g); } }
    const hz = gap > 0 ? Math.round(1000 / gap) : null;
    const lines = [
      `Cursor-Smith performance report (${(this.manifest && this.manifest.version) || "?"}), ${secs.toFixed(0)}s`,
      `environment: ${nav.userAgent || "?"}`,
      `platform ${nav.platform || "?"}; window ${win.innerWidth || "?"}x${win.innerHeight || "?"} @${win.devicePixelRatio || "?"}x; display ~${hz ? hz + "Hz" : "unmeasured (no hot frames)"}`,
      `gpu: ${gpu}`,
      `theme: ${themeName}; snippets on: ${snippets}; plugins on: ${plugins}`,
      `pane: ${clip ? clip.w + "x" + clip.h : "none"}; canvas region now: ${region ? region.w + "x" + region.h : "none"}`,
      `settings: style ${s.cursorStyle || "?"}; low power ${s.lowPowerMode ? "on" : "off"}; hide when unfocused ${s.hideOnWindowBlur === false ? "off" : "on"}; note editor only ${s.noteEditorOnly ? "on" : "off"}; reduced motion ${this.reducedMotion && this.reducedMotion() ? "ACTIVE" : "no"}`,
      `effects on: ${on.join(", ") || "none"}`,
      `share code: ${code}`,
      `loop: ${perf.ticks} ticks (${(perf.ticks / secs).toFixed(1)}/s), ${perf.draws} draws (${(perf.draws / secs).toFixed(1)}/s), gears ${gears}, ${perf.reanchors} canvas re-anchors, ${perf.keys} keystrokes`,
      `cost per frame: tick ${perf.ticks ? (perf.tickMs / perf.ticks).toFixed(2) : "0"}ms (caret measure ${perf.ticks ? (perf.caretMs / perf.ticks).toFixed(2) : "0"}ms), draw ${perf.draws ? (perf.drawMs / perf.draws).toFixed(2) : "0"}ms; plugin main-thread total ${perf.tickMs.toFixed(0)}ms of ${(secs * 1000).toFixed(0)}ms (${(100 * perf.tickMs / (secs * 1000)).toFixed(1)}%)`,
      `long tasks (anything over 50ms, any source): ${perf.longTasks}, ${perf.longTaskMs.toFixed(0)}ms total`,
    ];
    return lines.join("\n");
  }

  // The render loops' frame intervals for the current Low Power setting.
  // Global, not a look: read off this.settings directly, which a per-Vim-mode
  // swap leaves untouched because no mode snapshot carries the key.
  _frameCaps() {
    return this.settings && this.settings.lowPowerMode ? FRAME_CAPS.lowPower : FRAME_CAPS.normal;
  }

  // True when the OS-level window that owns our canvas is the focused one.
  //
  // Every other writing app drops the caret the moment its window goes to the
  // background, and so does Obsidian's own editor: CodeMirror removes
  // .cm-focused on window blur and stops painting its cursor. Ours is drawn on
  // an independent canvas that knows nothing about any of that, so without
  // this check it sits there blinking away over a background window.
  //
  // Document.hasFocus() is the probe rather than a cached flag set from a blur
  // listener, for two reasons: it answers per-document, so in a multi-window
  // vault the popout you're actually typing in keeps its cursor while the
  // others drop theirs; and it can't get stuck out of sync if a focus event is
  // ever missed (a window opened/closed mid-transition, OS-level focus
  // stealing). The focus/blur listeners in registerWindowEvents don't set
  // state - they only wake the render loop so the change is picked up on the
  // very next frame instead of up to 100ms later at the idle heartbeat.
  //
  // It's cheap: hasFocus() reads a flag on the frame, forcing no layout, so
  // polling it once per frame costs nothing measurable.
  windowFocused() {
    if (!this.settings.hideOnWindowBlur) return true;
    try {
      // Not just the canvas's own document. Since Obsidian 1.13 the Settings
      // panel is a WINDOW of its own rather than a modal in the main
      // document, so "the user is typing in a Settings search box" now looks,
      // from the canvas's document, exactly like "the app is in the
      // background" - and checking only the canvas doc parked the engine here
      // BEFORE ensureCanvasForView ever got the chance to migrate the canvas
      // to the window the caret is actually in. Chicken and egg: the canvas
      // can't follow focus into a window if losing focus to that window
      // stops the tick.
      //
      // So the question this answers is "is any window of OURS focused", and
      // ensureCanvasForView (which runs right after this, same frame) then
      // decides WHICH focused document to draw in. hasFocus() still answers
      // per-document, so a genuinely backgrounded app - no Obsidian window
      // focused at all - still parks exactly as before.
      const canvasDoc = this.canvas && this.canvas.ownerDocument;
      if (canvasDoc && canvasDoc.hasFocus()) return true;
      if (typeof activeDocument !== "undefined" && activeDocument &&
          activeDocument.hasFocus()) return true;
      for (const d of this.registeredDocuments) {
        // A registered document whose window already closed throws or answers
        // false here; either way it must not decide anything.
        try { if (d && d.hasFocus()) return true; } catch { /* dead doc */ }
      }
      // Nothing above matched and there was nothing to consult beyond the
      // main document: fall back to it, preserving the pre-multi-window
      // behaviour exactly.
      if (canvasDoc || (typeof activeDocument !== "undefined" && activeDocument) ||
          this.registeredDocuments.size) {
        return false;
      }
      return document.hasFocus();
    } catch {
      // Never let a focus probe kill a frame - assume focused.
      return true;
    }
  }

  // ---- Vim preset CRUD (independent of the regular cursor presets) ----

  getVimPresets() {
    if (!this.settings.vimPresets) this.settings.vimPresets = {};
    return this.settings.vimPresets;
  }

  async saveVimPreset(name) {
    this.getVimPresets()[name] = cloneVimModes(this.settings.vimModes);
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  }

  async loadVimPreset(name) {
    const preset = this.getVimPresets()[name];
    if (!preset) return;
    // Expand each mode to a complete snapshot so a preset saved before some key
    // existed still lands on a fully-defined config. A mode the preset has no
    // entry for at all (e.g. "command" in a preset saved before it existed)
    // falls back to that mode's starter look — see vimModeSnapshot.
    for (const mode of VIM_MODE_KEYS) {
      this.settings.vimModes[mode] = vimModeSnapshot(mode, preset[mode]);
    }
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  }

  async deleteVimPreset(name) {
    delete this.getVimPresets()[name];
    if (this.settings.vimActivePreset === name) this.settings.vimActivePreset = "";
    await this.saveSettings();
  }

  async cycleVimPreset(direction) {
    const names = Object.keys(this.getVimPresets());
    if (names.length === 0) {
      new Notice("Cursor-Smith: no Vim presets are saved");
      return;
    }
    const currentIdx = names.indexOf(this.settings.vimActivePreset);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];
    // Applying a preset while the feature is off makes no sense — turn it on
    // (which also flips Obsidian's vim bindings when auto-control is set).
    if (!this.settings.vimModeEnabled) await this.setVimModeEnabled(true);
    await this.loadVimPreset(nextName);
    new Notice(`Cursor-Smith: Vim preset — ${nextName}`);
    this.refreshSettingTab();
  }

  // Returns the name it was saved under, or null if the code was invalid.
  //
  // Only accepts Vim codes ("2|..."). A regular preset code describes one
  // cursor, not five, so there's no honest way to expand it into a Vim preset -
  // better to report it as the wrong kind of code than to silently paint all
  // five modes the same and let someone wonder why their Insert cursor looks
  // like their Normal one.
  async importVimPreset(code) {
    const result = codeToVimPreset(code.trim());
    if (!result) return null;
    this.getVimPresets()[result.name] = cloneVimModes(result.modes);
    this.settings.vimActivePreset = result.name;
    await this.saveSettings();
    return result.name;
  }

  getActiveColor() {
    const baseColor = this.getBaseColor();
    if (!this.settings.speedDemon) return baseColor;
    // "Keep cursor color": the caret stays exactly the colour it's configured
    // to be, so you get Speed Demon's sparks without the cursor itself
    // changing colour underneath you as you speed up.
    if (this.styleFor("speedDemonNoCursorHeat")) return baseColor;
    return this.heatColor(this.heat, baseColor);
  }

  // Get the base (non-heated) color. Used by Speed Demon internally so its
  // damped resting colour and its ramp both start from the user's chosen
  // colour rather than always from the same grey - a green-configured cursor
  // rests as a dim moss, an orange one as slate.
  //
  // This is also the single flat colour every effect that ISN'T the cursor
  // body falls back to: the CRT glow halo, Pixel Trail particles, popping
  // letters. With Gradient on, that colour is the ramp's first stop, so those
  // effects stay in the same family as the cursor instead of going on painting
  // themselves in a per-theme colour the cursor no longer uses anywhere.
  //
  // Secondary (multi-cursor) carets used to be in that list and no longer are:
  // they are cursor bodies too, so they take the whole ramp rather than a flat
  // slice of it. See drawSecondaryCarets.
  //
  // Deliberately UNHEATED in both branches. It used to hand back
  // gradientStops()[0], which has already been through heatColor, so every
  // caller that then applied heat itself - getActiveColor, and the ember
  // colour in spawnSparks - was heating a gradient cursor twice and landing
  // way up the ramp for the actual heat level. Callers that want the heated
  // colour go through getActiveColor.
  getBaseColor() {
    if (this.settings.gradientEnabled) return this.gradientStops(false)[0];
    return this.isDarkTheme() ? this.settings.colorDark : this.settings.colorLight;
  }

  // Which theme the cursor is being drawn against. Read off the document that
  // actually owns the canvas, not the main one, so a popped-out window with a
  // different theme still picks the right colours.
  isDarkTheme() {
    const doc = this.canvas ? this.canvas.ownerDocument : document;
    return doc.body.classList.contains("theme-dark");
  }

  // ---- Gradient cursor colour --------------------------------------------
  // The active theme's gradient stops, in order, as hex strings. Always at
  // least two entries, so callers can index [i] and [i+1] without guarding.
  // `applyHeat` exists for the callers that need the stops as the user
  // configured them - anything that is about to run them through heatColor
  // itself, and would otherwise apply the ramp twice.
  gradientStops(applyHeat = true) {
    const s = this.settings;
    const n = Math.max(2, Math.min(4, Math.round(s.gradientCount || 2)));
    // One ramp per theme, same as colorDark/colorLight: a ramp tuned for a
    // dark background usually washes out on a light one. gradientCount is
    // shared, so both ramps always have the same number of stops.
    const prefix = this.isDarkTheme() ? "gradientDark" : "gradientLight";
    const out = [];
    for (let i = 1; i <= n; i++) {
      const key = prefix + i;
      let hex = s[key] || DEFAULT_SETTINGS[key];
      // Speed Demon drives the whole cursor along a cold → white-hot ramp as
      // you type. Running every stop through it keeps a gradient cursor
      // heating up like a flat one does, instead of sitting frozen at its
      // configured colours while the rest of the effect reacts.
      //
      // The `heat > 0` shortcut is a free optimisation: at rest, BOTH curves
      // now hand back the stop they were given - the built-in one because its
      // cold end is the base colour, the custom one because of
      // SPEED_RAMP_LIFTOFF. It used to have to be skipped for the custom ramp,
      // which returned stage 1 at rest and would otherwise have snapped to it
      // on the first keystroke; that special case is gone with the cause.
      if (applyHeat && s.speedDemon && this.heat > 0
          && !this.styleFor("speedDemonNoCursorHeat")) {
        hex = this.heatColor(this.heat, hex);
      }
      out.push(hex);
    }
    return out;
  }

  // Colour at a position along the ramp (0 = first stop, 1 = last), as an
  // [r, g, b] tuple. With Gradient off this is just the flat active colour at
  // every position, so callers don't need to branch: Energy Beam samples this
  // per gradient stop, and Stardust samples it at a random position so a
  // gradient cursor sheds multi-coloured motes.
  //
  // `cyclic` treats the ramp as a loop (…→ last → first → last →…) instead of
  // a line with two ends. That's what makes a *scrolling* ramp possible: slide
  // a linear ramp along and the wrap from last stop back to first lands as a
  // hard seam travelling through the cursor, where a cyclic one has no seam to
  // show. Note it costs one segment: a cyclic 2-stop ramp is A→B→A, so the
  // colour returned for a given pos differs between the two modes by design.
  sampleRamp(pos, cyclic = false) {
    if (!this.settings.gradientEnabled) {
      return hexToRgbTuple(this.getActiveColor() || "#39ff14");
    }
    const stops = this.gradientStops();
    const lerp = (a, b, f) => [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ];

    if (cyclic) {
      const wrapped = ((pos % 1) + 1) % 1;
      const p = wrapped * stops.length;
      const i = Math.floor(p) % stops.length;
      const j = (i + 1) % stops.length;
      return lerp(hexToRgbTuple(stops[i]), hexToRgbTuple(stops[j]), p - Math.floor(p));
    }

    const p = Math.max(0, Math.min(1, pos)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(p));
    return lerp(hexToRgbTuple(stops[i]), hexToRgbTuple(stops[i + 1]), p - i);
  }

  // A CanvasGradient spanning the given rect, running along the cursor's
  // LONGER axis: top→bottom for a Line or Box, left→right for an Underline
  // bar. A fixed axis would be wrong for half the styles - a vertical ramp
  // squeezed into a 3px-tall underline is just a muddy average, and a
  // horizontal one across a 2px-wide line cursor is the same in reverse.
  createCursorGradient(x, y, w, h, alpha) {
    const ctx = this.ctx;
    const stops = this.gradientStops();
    const horizontal = w > h;
    const span = horizontal ? w : h;
    // A zero-length gradient line paints nothing at all (per the canvas spec),
    // which would silently blank the cursor rather than degrade. Fall back to
    // the first stop as a flat fill. Same answer with no canvas to draw on.
    if (!ctx || !(span > 0)) return hexToRgba(stops[0], alpha);

    const grad = horizontal
      ? ctx.createLinearGradient(x, y, x + w, y)
      : ctx.createLinearGradient(x, y, x, y + h);
    for (let i = 0; i < stops.length; i++) {
      const [r, g, b] = hexToRgbTuple(stops[i]);
      grad.addColorStop(i / (stops.length - 1), `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  }

  // The paint for one cursor-shaped fill or stroke: the gradient when Gradient
  // is on, otherwise the flat rgba string the engine has always used. Callers
  // pass the rect they are ACTUALLY about to paint (e.g. the underline bar,
  // not the whole line box) so the ramp spans the visible shape.
  //
  // Note this deliberately knows nothing about Energy Beam: the body-fill call
  // sites still pick createEnergyGradient over this one when the beam is on,
  // which keeps the beam's existing behaviour of not painting CRT trail dots.
  // The cursor body is a single flat heat colour (getActiveColor already ran
  // the ramp), or the user's gradient when that's enabled. The bottom-to-top
  // "flame column" that briefly lived here was replaced by the fire that now
  // rises off the top of the whole text line (see maybeSpawnSpeedDemonSparks) -
  // the caret just glows its heat colour, the line above it is what burns.
  cursorPaint(x, y, w, h, color, alpha) {
    if (!this.settings.gradientEnabled) return hexToRgba(color, alpha);
    return this.createCursorGradient(x, y, w, h, alpha);
  }

  // Map heat (0..1) to an rgb() string along a cold → hot ramp:
  //   0.00  desaturated + dimmed version of the user's cursor colour
  //   0.50  mid: user's colour blended toward warm orange
  //   0.85  vivid orange-red
  //   1.00  near-white, "white-hot"
  // Piecewise-linear in RGB is crude but reads well because each segment
  // is short and the eye interprets the sequence as temperature, not as
  // three separate interpolations.
  // Multiplier on the CRT glow's blur radius, driven by Speed Demon's heat.
  //
  // Returns 1 (no change) unless Speed Demon is actually on, so the glow keeps
  // its existing look for everyone not using the two together. Deliberately not
  // behind its own toggle: the CRT glow already only exists when you've asked
  // for the CRT effect, and heat only exists when you've asked for Speed Demon,
  // so wanting both and NOT wanting them to interact is the odd case. If that
  // turns out to be wrong, this is the one place to gate.
  //
  // Reads `speedDemonNoCursorHeat` too: someone who has explicitly said the
  // cursor should keep its own colour as it heats up has said they don't want
  // the caret reacting to speed, and a pulsing halo is exactly that.
  glowHeatScale() {
    if (!this.settings.speedDemon) return 1;
    if (this.styleFor("speedDemonNoCursorHeat")) return 1;
    const h = Math.max(0, Math.min(1, this.heat || 0));
    return 1 + GLOW_HEAT_GAIN * h;
  }

  // The active theme's four custom heat stops, cold → hot, as hex strings.
  speedHeatStops() {
    const prefix = this.isDarkTheme() ? "speedHeatDark" : "speedHeatLight";
    const out = [];
    for (let i = 1; i <= 4; i++) {
      out.push(this.settings[prefix + i] || DEFAULT_SETTINGS[prefix + i]);
    }
    return out;
  }

  // Sample the custom ramp at `h` (0 = stage 1 at rest, 1 = stage 4 flat out).
  // Three equal linear segments rather than an eased curve: these are stops the
  // user picked deliberately, and easing would mean each chosen colour is only
  // hit exactly at one instant while the time is spent in between. Linear makes
  // each quarter of the speed range read as "that stage".
  sampleHeatRamp(h) {
    const stops = this.speedHeatStops();
    const t = Math.max(0, Math.min(1, h)) * 3;
    const i = Math.min(2, Math.floor(t));
    const f = t - i;
    const [r1, g1, b1] = hexToRgbTuple(stops[i]);
    const [r2, g2, b2] = hexToRgbTuple(stops[i + 1]);
    const r = Math.round(r1 + (r2 - r1) * f);
    const g = Math.round(g1 + (g2 - g1) * f);
    const b = Math.round(b1 + (b2 - b1) * f);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  heatColor(heat, baseHex) {
    const h = Math.max(0, Math.min(1, heat));
    // Custom ramp: ignores baseHex entirely and hands back the sampled stop.
    //
    // That "ignores baseHex" is the whole behaviour, and it has one consequence
    // worth stating plainly: gradientStops() runs every stop of a Gradient
    // cursor through here, so with a custom ramp on, all of them come back the
    // same colour and the spatial gradient flattens. That's intended - two
    // features both claiming the cursor's colour can't both win - and the
    // settings panel says so where you turn it on.
    if (this.styleFor("speedDemonGradient")) {
      if (h >= SPEED_RAMP_LIFTOFF) {
        // Stops are compressed into what's left of the range, so stage 1 is hit
        // at liftoff and stage 4 still lands at full heat.
        return this.sampleHeatRamp((h - SPEED_RAMP_LIFTOFF) / (1 - SPEED_RAMP_LIFTOFF));
      }
      // Easing out of the colour this stop was actually given. Note that is
      // per-stop, not from one shared colour: gradientStops() sends every stop
      // of a Gradient cursor through here, so at rest each one returns itself
      // and the spatial gradient survives, then collapses into the heat ramp as
      // the cursor warms up.
      const [sr, sg, sb] = hexToRgbTuple(this.speedHeatStops()[0]);
      const [r0, g0, b0] = hexToRgbTuple(baseHex);
      const f = h / SPEED_RAMP_LIFTOFF;
      const rr = Math.round(r0 + (sr - r0) * f);
      const gg = Math.round(g0 + (sg - g0) * f);
      const bb = Math.round(b0 + (sb - b0) * f);
      return `#${((1 << 24) | (rr << 16) | (gg << 8) | bb).toString(16).slice(1)}`;
    }
    const [br, bg, bb] = hexToRgbTuple(baseHex);
    // Cold endpoint: the user's colour, exactly.
    //
    // It used to be a desaturated (70% toward luma grey) and dimmed (72%)
    // version of it, on the theory that "cold" should read as dulled. In
    // practice that meant switching Speed Demon on changed how the cursor
    // looked when you WEREN'T typing, which is most of the time - you picked a
    // colour and got a washed-out version of it until you started moving. The
    // effect is supposed to add heat on top of your cursor, not take the
    // colour away and hand some of it back as a reward.
    //
    // Now heat 0 is the configured colour and the ramp only ever adds: base ->
    // warm -> red-orange -> white-hot. The `nudge` below is left in place; it
    // still keeps the base colour present through the middle of the ramp,
    // which is a different job from the resting colour.
    const coldR = br;
    const coldG = bg;
    const coldB = bb;

    // Warm waypoints (classic blackbody-ish ramp).
    const warm  = [255, 140,  40];             // orange
    const hot   = [255,  70,  30];             // red-orange
    const white = [255, 240, 200];             // white-hot

    let r, g, b;
    if (h < 0.5) {
      // cold → user's colour (fully saturated again) → warm
      const t = h / 0.5;
      // First half of the interpolation blends cold → base, second half
      // blends base → warm, but doing that as two segments makes 0.5 look
      // like a kink. Smoother: use base as a midpoint of a single curve
      // via easeInOutSine.
      const e = easeInOutSine(t);
      r = coldR + (warm[0] - coldR) * e;
      g = coldG + (warm[1] - coldG) * e;
      b = coldB + (warm[2] - coldB) * e;
      // Nudge back toward the user's colour in the mid-range so it doesn't
      // feel like the base colour disappears entirely.
      const nudge = 1 - Math.abs(t - 0.5) * 2; // 0 at ends, 1 at t=0.5
      r = r * (1 - 0.25 * nudge) + br * 0.25 * nudge;
      g = g * (1 - 0.25 * nudge) + bg * 0.25 * nudge;
      b = b * (1 - 0.25 * nudge) + bb * 0.25 * nudge;
    } else if (h < 0.85) {
      const t = (h - 0.5) / 0.35;
      r = warm[0] + (hot[0] - warm[0]) * t;
      g = warm[1] + (hot[1] - warm[1]) * t;
      b = warm[2] + (hot[2] - warm[2]) * t;
    } else {
      const t = (h - 0.85) / 0.15;
      r = hot[0] + (white[0] - hot[0]) * t;
      g = hot[1] + (white[1] - hot[1]) * t;
      b = hot[2] + (white[2] - hot[2]) * t;
    }
    return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b))
      .toString(16).slice(1)}`;
  }

  // Everything Hot-head holds - live particles, burn marks, the caret samples
  // it measures travel against - is stored in viewport coordinates, because
  // that's what the canvas draws in. Scrolling moves the text under those
  // coordinates without changing them, which broke the effect in two ways at
  // once: fire that was sitting on a word stayed pinned to the screen while the
  // word slid away from under it, and the caret's viewport position changed
  // without the caret having actually gone anywhere, so the emitter read the
  // scroll as travel and laid a streak of fire across the screen.
  //
  // Shifting everything by the scroll delta fixes both: the fire is attached to
  // the text, so it scrolls with the text, and the caret's apparent movement
  // cancels out to roughly zero, so no spurious trail.
  hotSyncScroll() {
    // Nothing to keep in sync when the effect is off, and dropping the baseline
    // means re-enabling it takes a fresh one rather than applying however far
    // the document was scrolled in the meantime as one enormous delta.
    if (!this.styleFor("hotHead")) {
      this._hotScroll = null;
      return;
    }
    const view = this.app.workspace.activeEditor?.editor?.cm;
    const el = view && view.scrollDOM;
    if (!el) {
      this._hotScroll = null;
      return;
    }
    const sx = el.scrollLeft || 0;
    const sy = el.scrollTop || 0;
    const prev = this._hotScroll;
    // First sight of this scroller (or a switch to a different pane): take a
    // baseline and shift nothing, or the delta against some other editor's
    // scroll position would fling everything off screen.
    if (!prev || prev.el !== el) {
      this._hotScroll = { el, x: sx, y: sy };
      return;
    }
    // The primary's pass reads the scroll delta and shifts the shared ember
    // pool; it also records the delta for this tick, because a secondary's
    // pass (its bundle swapped in, see _withCaret) runs later in the same
    // frame and must shift ITS burn marks and inertia by the same amount -
    // by then the delta against `prev` is zero.
    let ox, oy;
    if (this._caretPass === "secondary") {
      const sh = this._hotShift;
      if (!sh || sh.tick !== this._tickNo) return;
      // Once per caret per tick, whatever calls hotSyncScroll on it.
      if (this._hotShiftTick === sh.tick) return;
      this._hotShiftTick = sh.tick;
      if (!sh.ox && !sh.oy) return;
      ox = sh.ox; oy = sh.oy;
    } else {
      const dx = sx - prev.x;
      const dy = sy - prev.y;
      prev.x = sx;
      prev.y = sy;
      this._hotShift = { ox: -dx, oy: -dy, tick: this._tickNo };
      if (!dx && !dy) return;
      ox = -dx;
      oy = -dy;
      for (const p of this.flameEmbers) { p.x += ox; p.y += oy; }
    }
    const nEmbers = this.flameEmbers.length;
    const nBurns = this.hotBurns ? this.hotBurns.length : 0;
    if (!nEmbers && !nBurns && !this._hotPrev && !this._hotEmitFrom) return;

    for (const b of this.hotBurns) {
      b.x += ox;
      b.y += oy;
      // The row extents are viewport x too, so they have to travel with it -
      // otherwise a horizontal scroll leaves the fire clamped to where the
      // text used to be.
      if (b.rowLeft != null) b.rowLeft += ox;
      if (b.rowRight != null) b.rowRight += ox;
    }
    if (this._hotPrev) { this._hotPrev.x += ox; this._hotPrev.y += oy; }
    if (this._hotEmitFrom) { this._hotEmitFrom.x += ox; this._hotEmitFrom.y += oy; }
    // Every particle moved at once, so last frame's dirty rect doesn't cover
    // where they used to be. Without a full clear this smears. Only when there
    // were actually particles on screen, so a plain scroll with the fire out
    // doesn't cost everyone a full-canvas clear per frame.
    if (nEmbers) this._dirtyFull = true;
  }

  // Hot-head: track the caret between frames, and remember where it has been.
  //
  // Velocity feeds the share of caret motion new particles inherit. The burn
  // marks are the other half: each is a patch of text the caret has occupied,
  // with an intensity that decays over time. Fire is emitted from ALL live
  // marks, not just the caret, so text the caret has moved off keeps burning
  // for a moment afterwards - the point being that the text was set alight,
  // rather than that a flame is following the cursor around.
  updateHotHeadInertia() {
    this.hotSyncScroll();
    const now = performance.now();
    const active = this.animActive;
    if (!active) {
      this._hotPrev = null;
      this._hotEmitFrom = null;
      this._hotVel = { x: 0, y: 0 };
      this.hotBurns = [];
      return;
    }
    const cx = active.x + (active.w || 0) / 2;
    const cy = active.top + (active.h || 0) / 2;

    if (!this._hotPrev) {
      this._hotPrev = { x: cx, y: cy, t: now };
      this._hotEmitFrom = { x: cx, y: cy };
      this._hotVel = { x: 0, y: 0 };
      this.hotBurns = [];
      return;
    }

    const dt = Math.max(0.001, Math.min(0.1, (now - this._hotPrev.t) / 1000));
    // Genuine caret movement, which is what the idle timer runs on. Measured
    // here rather than from the plugin's global activity timestamp because that
    // one is also poked by scrolling and focus changes, and neither of those
    // should count as working on the text. The threshold ignores the last
    // sub-pixel crawl of a smooth-motion glide settling onto its target.
    if (Math.abs(cx - this._hotPrev.x) > 0.5 || Math.abs(cy - this._hotPrev.y) > 0.5) {
      this._hotActiveT = now;
    }
    this._hotVel.x += ((cx - this._hotPrev.x) / dt - this._hotVel.x) * 0.25;
    this._hotVel.y += ((cy - this._hotPrev.y) / dt - this._hotVel.y) * 0.25;
    const prevX = this._hotPrev.x, prevY = this._hotPrev.y;
    this._hotPrev.x = cx;
    this._hotPrev.y = cy;
    this._hotPrev.t = now;
    if (!this._hotEmitFrom) this._hotEmitFrom = { x: cx, y: cy };

    if (!this.hotBurns) this.hotBurns = [];
    // Refresh the mark under the caret, or lay a new one. Marks within half a
    // character of each other are merged, so sitting still keeps one mark
    // topped up rather than stacking a new one every frame - which would fill
    // the whole buffer with duplicates in half a second and evict the trail
    // behind the caret that is the entire point of keeping these.
    //
    // Both sides of the comparison are the line TOP. Comparing against the
    // caret's centre instead means the test is off by half a line height and
    // can never match.
    const cwHere = Math.max(4, active.actualCharWidth || active.w || 8);
    const markY = active.top;
    const last = this.hotBurns[this.hotBurns.length - 1];
    if (last && Math.abs(last.x - cx) < cwHere * 0.5 && Math.abs(last.y - markY) < 2) {
      last.t = now;
      // Refresh the row extent too: the text either side of a stationary caret
      // changes as you type, and a mark holding the extent from when it was
      // laid would keep burning over characters that have since moved.
      last.rowLeft = active.rowLeft;
      last.rowRight = active.rowRight;
    } else {
      // The PATH burns. Marks used to be laid only where the caret IS each
      // frame, so a jump - or a fast glide - lit its two ends and left the
      // way between them dark; the recording's trail is the way itself on
      // fire, fading from the far end. So the segment from where the caret
      // was last frame to where it is now gets a mark every
      // HOT_TRAIL_STEP_CW characters, the nearest HOT_TRAIL_PATH_MAX of them
      // when it is longer than that, laid far end first and already a little
      // aged (HOT_TRAIL_PATH_AGE of the linger, more the farther back) so the
      // tail goes out before the head. A mark on the way between two lines
      // carries no row extents: there is no row to clamp it to.
      const dxp = cx - prevX;
      const prevTop = prevY - (active.h || 0) / 2;
      const dyp = markY - prevTop;
      const dist = Math.hypot(dxp, dyp);
      const step = cwHere * HOT_TRAIL_STEP_CW;
      const n = Math.min(HOT_TRAIL_PATH_MAX, Math.floor(dist / step));
      if (n >= 1) {
        const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
        const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
        const sameRow = Math.abs(dyp) < 2;
        for (let i = n; i >= 1; i--) {
          const s = (i * step) / dist;
          this.hotBurns.push({
            x: cx - dxp * s, y: markY - dyp * s,
            t: now - s * HOT_TRAIL_PATH_AGE * linger,
            rowLeft: sameRow ? active.rowLeft : null, rowRight: sameRow ? active.rowRight : null,
            lh: active.h || 16, fs: active.fontSize || 0,
          });
        }
      }
      // Each mark remembers the row it was laid on, so a mark left behind on a
      // previous line keeps being clamped to THAT line's text rather than to
      // wherever the caret has since gone.
      this.hotBurns.push({
        x: cx, y: markY, t: now,
        rowLeft: active.rowLeft, rowRight: active.rowRight, lh: active.h || 16,
        // Needed to place the fire relative to the GLYPHS rather than to the
        // line box - see topY in maybeSpawnHotHead. Stored per mark because a
        // mark left on a previous line has to keep that line's metrics, not
        // whatever the caret has since moved onto.
        fs: active.fontSize || 0,
      });
      while (this.hotBurns.length > HOT_BURN_MAX) this.hotBurns.shift();
    }
  }

  // Whether the fire is currently being fed, i.e. the caret has moved recently
  // enough to count as working. Shared by the emitter and the frame governor:
  // the governor has to agree, or a fire that has burnt out would still pin the
  // render loop at full rate forever on the grounds that the effect is enabled.
  hotHeadFeeding(nowT) {
    return this._hotFeedingAt(this._hotActiveT, nowT);
  }

  // The same test for a caret whose state is not swapped in (a secondary's
  // bundle, read from _isAnimating without a swap).
  _hotFeedingAt(activeT, nowT) {
    const idleMs = Math.max(0, this.styleFor("hotHeadIdleMs") ?? 0);
    if (idleMs <= 0) return true;
    return (nowT - (activeT || 0)) <= idleMs;
  }

  // Emit fire from every patch of text that is currently alight.
  //
  // Particles are points with no size of their own - see drawHotHead, where how
  // big they look is decided by their age.
  maybeSpawnHotHead() {
    const active = this.animActive;
    const from = this._hotEmitFrom;
    if (!active || !from) return;
    const now = performance.now();

    const cw = Math.max(4, active.actualCharWidth || active.w || 8);
    const lh = Math.max(8, active.h || 16);

    const cx = active.x + (active.w || 0) / 2;
    const cy = active.top + lh / 2;
    let dx = cx - from.x;
    let dy = cy - from.y;

    // Clamp the segment: a jump to the far side of the document shouldn't paint
    // a ribbon of fire across the whole screen, just light the arrival.
    const segLen = Math.hypot(dx, dy);
    const maxSeg = cw * 12;
    if (segLen > maxSeg) {
      const k = maxSeg / segLen;
      dx *= k;
      dy *= k;
    }

    // Advance the anchors BEFORE any early return. Leaving them stale while the
    // emitter is capped or idle means the next segment spans everything the
    // caret did in the meantime, and the fire gets flung along it.
    from.x = cx;
    from.y = cy;
    const dt = Math.max(0, Math.min(0.1, (now - (this._lastHotT || now)) / 1000));
    this._lastHotT = now;

    const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
    const fadeMs = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);
    const heightMul = Math.max(0.05, this.styleFor("hotHeadHeight") ?? 0.55);
    const perLength = FLAME_PER_LENGTH * ((this.styleFor("hotHeadTrail") ?? 0) / 10);
    const qtyEarly = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);

    // Engulfed: the caret jumped (set on the committed move, see the commit
    // path in updateActivePoint), so for HOT_ENGULF_MS the fire spawns all
    // around the drawn caret's box while it lands and settles.
    if (qtyEarly > 0 && this._hotEngulfUntil && now < this._hotEngulfUntil) {
      const vel = this._hotVel || { x: 0, y: 0 };
      const shapeN = HOT_BLOCK_SHAPES.length;
      const n = HOT_ENGULF_RATE * dt * qtyEarly;
      const count = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
      const w = Math.max(cw, active.w || 0);
      const x0 = active.x - cw * HOT_ENGULF_PAD_X, x1 = active.x + w + cw * HOT_ENGULF_PAD_X;
      const y0 = active.top - lh * HOT_ENGULF_ABOVE, y1 = active.top + lh * (1 + HOT_ENGULF_BELOW);
      for (let i = 0; i < count; i++) {
        const spark = Math.random() < 0.5;
        const ang = Math.random() * Math.PI * 2;
        const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul * 0.8;
        const life0 = fadeMs * (spark ? 0.15 + 0.45 * Math.random() : 0.2 + 0.5 * Math.pow(Math.random(), 2));
        this.flameEmbers.push({
          spark, fine: spark && Math.random() < HOT_FINE_CHANCE,
          x: x0 + Math.random() * (x1 - x0), y: y0 + Math.random() * (y1 - y0),
          vx: mag * Math.cos(ang) + FLAME_VELOCITY_FROM_CURSOR * vel.x,
          vy: mag * Math.sin(ang) - (spark ? HOT_SPARK_RISE * 0.6 : 1) * cw * heightMul + FLAME_VELOCITY_FROM_CURSOR * vel.y,
          shape0: Math.min(shapeN - 1, 5 + Math.floor(Math.random() * (shapeN - 6))),
          flip: Math.random() < 0.5,
          life: life0, life0,
          maxLife: fadeMs,
          temp: 0.6 + Math.random() * 0.4,
          cw,
          lift: heightMul * (spark ? HOT_SPARK_LIFT : 1),
        });
      }
    }

    const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
    const halfSpan = spreadCw * cw * 0.5;

    // Drop burn marks that have gone out. Done BEFORE the early returns below:
    // skipping the prune whenever the emitter happens to be capped or switched
    // down leaves the list pinned at its cap holding marks that went out long
    // ago, and the moment emission resumes they all light up again at once.
    const burns = (this.hotBurns || []).filter((b) => now - b.t < linger);
    this.hotBurns = burns;
    if (!burns.length) return;

    // Idle Timeout: stop feeding the fire once the caret has been still for
    // this long. Emission simply stops - the particles already in the air run
    // out their lifetimes, so the fire burns down and goes out rather than
    // being switched off - and the next real movement starts it again.
    if (!this.hotHeadFeeding(now)) return;

    // Chunks and sparks have separate budgets; only the chunks count here.
    // Per caret (HOT_BUDGET_CARETS): the pool is shared.
    const carets = 1 + Math.min(HOT_BUDGET_CARETS - 1, (this._secondaries && this._secondaries.length) || 0);
    const chunkCap = FLAME_MAX_NUM * carets;
    this._hotSparkCap = HOT_SPARK_MAX * carets;
    let live = 0, sparks = 0;
    for (const p of this.flameEmbers) { if (p.spark) sparks++; else live++; }
    this._hotSparks = sparks;
    if (live >= chunkCap) return;
    const qty = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);
    if (qty <= 0) return;

    // Total emission is shared across the live marks by their remaining
    // intensity, so a long trail of dying marks doesn't emit more fire in total
    // than a single fresh one - it spreads the same fire more thinly, which is
    // what "burning down" should look like.
    let weightSum = 0;
    const weights = burns.map((b) => {
      const w = 1 - (now - b.t) / linger;
      const v = Math.pow(w, HOT_TRAIL_FADE_POW);
      weightSum += v;
      return v;
    });
    if (weightSum <= 0) return;

    const travelCw = Math.hypot(dx, dy) / cw;
    // Emission scales with how much text is alight, but sub-linearly - a wide
    // spread should look like more fire, not like the same fire smeared out,
    // without the particle count exploding.
    const spanScale = 1 + (halfSpan * 2) / (cw * 6);
    const n = (FLAME_PER_SECOND * dt * spanScale * Math.min(HOT_TRAIL_EMIT_MAX, 0.55 + weightSum * 0.45)
      + travelCw * perLength) * qty;
    let count = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
    count = Math.max(0, Math.min(count, chunkCap - live));
    if (count <= 0) return;

    const vel = this._hotVel || { x: 0, y: 0 };

    for (let i = 0; i < count; i++) {
      // Pick which alight patch this particle comes off, weighted by how
      // strongly that patch is still burning.
      let r = Math.random() * weightSum;
      let bi = 0;
      while (bi < burns.length - 1 && (r -= weights[bi]) > 0) bi++;
      const burn = burns[bi];
      const strength = Math.max(0, 1 - (now - burn.t) / linger);

      // Fire sits JUST ABOVE the glyphs, licking up off them - not on top of
      // the letters, which reads as the text being overprinted rather than
      // burning.
      //
      // burn.y is the top of the LINE BOX, which sits above the glyphs by the
      // half-leading. The old offset was a flat 0.22 of the line height, and
      // on ordinary body text that lands almost exactly on the cap height -
      // i.e. right on the letters. Deriving it from the font size instead
      // puts the base at the true top of the glyphs and then lifts it clear
      // by a fraction of the type size, so the flames start in the gap and
      // rise from there. It also adapts to headings, where the half-leading
      // is a quite different share of the line box.
      const fs = burn.fs || lh * 0.62;
      const halfLeading = Math.max(0, (burn.lh || lh) - fs) / 2;
      const topY = burn.y + halfLeading - fs * HOT_HEAD_LIFT;

      // Across the patch, biased toward its centre, plus the segment the caret
      // just travelled for the freshest mark.
      const across = (Math.random() + Math.random() - 1) * halfSpan;
      const s = Math.random();
      const alongX = (bi === burns.length - 1) ? -dx * (1 - s) : 0;
      const alongY = (bi === burns.length - 1) ? -dy * (1 - s) : 0;

      let px = burn.x + alongX + across + (Math.random() - 0.5) * FLAME_SPREAD * cw;
      // Mostly up, a little down. Fully symmetric jitter put half of every
      // batch well below the anchor and over the letters; upward-only left
      // the whole flame floating clear of them. Weighted the way a flame
      // actually behaves - rising, but rooted in what it is burning.
      let py = topY + alongY
        + (HOT_HEAD_JITTER_DOWN - Math.random() * (HOT_HEAD_JITTER_UP + HOT_HEAD_JITTER_DOWN)) * lh;
      // Off a mark the caret has left behind: down over the glyphs, the trail
      // burning ON the text it passed (HOT_TRAIL_DOWN).
      if (bi < burns.length - 1) py += Math.random() * HOT_TRAIL_DOWN * (burn.lh || lh);

      // Keep the fire on the text. Without this the spread band burns happily
      // out into the empty margin past the end of a line, which looks like the
      // page is on fire rather than the writing. The extent is the caret's
      // VISUAL row, so on a wrapped line the fire stops at the wrap, not at the
      // far end of the logical line. Half a character of overhang is allowed so
      // the first and last glyphs aren't sliced down the middle.
      const rl = burn.rowLeft, rr = burn.rowRight;
      const haveRow = rl != null && rr != null;
      let atEdge = false;
      if (haveRow) {
        const pad = cw * 0.5;
        const lo = rl - pad;
        const hi = rr + pad;
        if (hi - lo < cw) {
          // Blank row: nothing to burn but the caret's own cell.
          px = Math.min(Math.max(px, burn.x - cw * 0.5), burn.x + cw * 0.5);
        } else if (px < lo || px > hi) {
          // Rather than clamping every stray particle onto the boundary (which
          // stacks a bright wall of fire exactly on the last character), drop
          // it. The band is simply thinner near an edge, which is what running
          // out of fuel should look like.
          continue;
        }
        // Is the caret itself sitting at the very start or end of the row?
        atEdge = (burn.x <= rl + cw) || (burn.x >= rr - cw);
      }

      // At a row's first or last character there's no text to the side to carry
      // the fire, so instead of stopping dead it licks DOWN over the row below -
      // the way a flame at the edge of a burning sheet curls around it. Only a
      // minority of particles do this, and only ones already near the edge, so
      // it reads as a lick rather than as the next line also being alight.
      if (atEdge && Math.random() < 0.28 && Math.abs(px - burn.x) < cw * 1.5) {
        py += (burn.lh || lh) * (0.55 + Math.random() * 0.5);
      }

      // Uniform disc: sqrt(random) for magnitude, free angle. Plus a share of
      // the caret's own velocity, so fire is dragged along a fast move.
      const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul;
      const ang = Math.random() * Math.PI * 2;

      // The shape: how far down HOT_BLOCK_SHAPES this particle starts, from
      // how long it will live (life0 over the maximum), with a little jitter
      // so equally long-lived neighbours are not identical. Mirrored at random.
      // Older marks (the trail behind the caret) still get a decent floor on
      // life, so the trail keeps some proper chunks rather than only specks.
      const life0 = fadeMs * (0.1 + 0.9 * Math.pow(Math.random(), FLAME_LIFETIME_EXP)) * (0.7 + 0.3 * strength);
      const lifeShare = Math.max(0, Math.min(1, life0 / fadeMs));
      const shapeN = HOT_BLOCK_SHAPES.length;
      const shape0 = Math.max(0, Math.min(shapeN - 1,
        Math.round((1 - lifeShare) * (shapeN - 1) + (Math.random() - 0.5) * 3)));
      this.flameEmbers.push({
        x: px, y: py,
        vx: mag * Math.cos(ang) + FLAME_VELOCITY_FROM_CURSOR * vel.x,
        vy: mag * Math.sin(ang) + FLAME_VELOCITY_FROM_CURSOR * vel.y,
        shape0, flip: Math.random() < 0.5,
        // Upstream is a bare max*rand^n. The floor is ours: with no floor a
        // large share of particles are born with a percent or two of max life
        // and die inside a frame, spending the budget on specks nobody sees.
        // The exponent still shapes the distribution; the floor just makes
        // every particle last long enough to be drawn.
        life: life0, life0,
        maxLife: fadeMs,
        // Older patches burn cooler, so a trail of lingering fire fades down
        // the ramp as well as thinning out.
        temp: Math.min(1, (0.55 + Math.random() * 0.45) * (0.45 + 0.55 * strength)),
        cw,
        // Buoyancy is per-particle so a change to Flame Height doesn't yank
        // everything already in the air.
        lift: heightMul,
      });
      // The sparks: tiny, quick, lighter, from the same spot, rising faster.
      // And now and then a finer one with them.
      if (this._hotSparks < this._hotSparkCap) {
        const nSp = HOT_SPARKS_PER_CHUNK + (Math.random() < HOT_FINE_CHANCE ? 1 : 0);
        for (let k = 0; k < nSp; k++) {
          const fine = k >= HOT_SPARKS_PER_CHUNK;
          const sang = Math.random() * Math.PI * 2;
          const smag = FLAME_INITIAL_VELOCITY * Math.random() * cw * heightMul;
          this.flameEmbers.push({
            spark: true, fine,
            x: px + (Math.random() - 0.5) * cw * 0.6, y: py - Math.random() * lh * 0.15,
            vx: smag * Math.cos(sang) + FLAME_VELOCITY_FROM_CURSOR * vel.x,
            vy: smag * Math.sin(sang) - HOT_SPARK_RISE * cw * heightMul + FLAME_VELOCITY_FROM_CURSOR * vel.y,
            life: fadeMs * (0.15 + 0.65 * Math.random()) * (0.5 + 0.5 * strength),
            maxLife: fadeMs,
            temp: 0.5 + Math.random() * 0.5,
            cw,
            lift: heightMul * HOT_SPARK_LIFT,
          });
          this._hotSparks = (this._hotSparks | 0) + 1;
        }
      }
    }
  }

  // Emit small upward-rising fire embers when heat is high enough.
  // Rate scales with heat so mid-heat is a lazy simmer and full heat is
  // a proper flame. Cap total live sparks to keep the canvas fill-rate
  // sane even when the user is chugging (each spark is a small fillRect,
  // so it's not free).
  maybeSpawnSpeedDemonSparks() {
    if (this.heat < 0.4) return;
    if (this.flamePixels.length > 120) return;
    const now = performance.now();
    // Time-gated spawn: emit at most once per (frame budget) ms, scaled by
    // heat. At heat=0.4 that's ~60ms between bursts; at heat=1 it's ~14ms.
    const gap = 70 - 55 * this.heat;
    if (now - this._lastSparkT < gap) return;
    this._lastSparkT = now;

    const active = this.animActive;
    if (!active) return;
    const anchorW = active.w || active.actualCharWidth || 8;
    const baseCount = 1 + Math.floor(this.heat * 3); // 1..4 sparks per burst
    // Spark Quantity: 0..3 multiplier on the base burst size, so 1 is the
    // original feel, 0 effectively stops sparks without touching the Fire
    // Sparks toggle, and >1 throws a heavier shower at the same heat level.
    const qty = Math.max(0, this.styleFor("speedDemonSparkQuantity") ?? 1);
    const count = Math.round(baseCount * qty);
    const heatCol = this.heatColor(Math.min(1, this.heat + 0.1), this.getBaseColor());
    const [hr, hg, hb] = hexToRgbTuple(heatCol);
    for (let i = 0; i < count; i++) {
      // Spawn along the top edge of the cursor - embers rising off a
      // white-hot surface. A little jitter on x/y keeps them from looking
      // like a straight line of pixels.
      const pX = active.x + Math.random() * anchorW;
      const pY = active.top + Math.random() * (active.h * 0.4);
      const varR = Math.max(0, Math.min(255, hr + Math.floor((Math.random() - 0.5) * 40)));
      const varG = Math.max(0, Math.min(255, hg + Math.floor((Math.random() - 0.5) * 30)));
      const varB = Math.max(0, Math.min(255, hb + Math.floor((Math.random() - 0.5) * 20)));

      this.flamePixels.push({
        x: pX,
        y: pY,
        // Upward drift + light horizontal jitter. Speed scales with heat
        // so hotter cursor throws embers further before they fade.
        vx: (Math.random() - 0.5) * 12,
        vy: -20 - Math.random() * 30 - this.heat * 20,
        size: 1.5 + Math.random() * 2, // smaller than backspace/normal pixels
        color: `rgb(${varR}, ${varG}, ${varB})`,
        // Cached numeric channels alongside `color`: the trail gradient in
        // drawFlamePixels needs r/g/b at custom alphas every frame, and
        // re-deriving them from the formatted string via regex each time
        // (for every live spark, every frame) is needless work when we
        // already have the numbers right here at spawn time.
        r: varR, g: varG, b: varB,
        alpha: 1,
        start: now,
        // Marks this particle as a Speed Demon spark (as opposed to a Pixel
        // Trail / backspace-disintegration particle sharing the same pool)
        // so drawFlamePixels only trails the ones that should have one.
        spark: true
      });
    }
  }

  // ---- Stardust ----------------------------------------------------------
  // Whether the effect is switched on AND currently emitting. Split out from
  // maybeSpawnStardust() because the frame governor needs the same answer: an
  // armed-but-not-yet-emitting cursor still has to be woken often enough to
  // emit on time, or the first mote would wait out a 100ms idle heartbeat.
  stardustArmed() {
    const s = this.settings;
    if (!s.stardustEnabled) return false;
    if (!this.animActive) return false;
    // Always On drops the idle condition entirely, so the cursor streams
    // while you type as well. Note this keeps the render loop off the idle
    // gear for as long as a caret exists - that's inherent to the option,
    // not a leak.
    if (s.stardustAlwaysOn) return true;
    const idleFor = performance.now() - (this._lastActivityT || 0);
    return idleFor >= Math.max(0, s.stardustDelayMs ?? 2000);
  }

  // Emit a slow stream of drifting motes from the caret while it sits idle.
  //
  // Rate-limited by wall clock rather than per frame: the governor runs this
  // at ~30fps while stardust is alive but drops to ~10fps in the gaps, so a
  // per-frame probability would quietly change density with the gear.
  maybeSpawnStardust() {
    if (!this.stardustArmed()) return;
    // Hard ceiling on live motes. Each one is a fillRect plus a dirty-rect
    // contribution, and unlike every other particle effect here this one has
    // no natural end - it emits for as long as you leave the window alone.
    // Per caret: the pool is shared with the secondaries' motes.
    if (this.stardust.length >= STARDUST_MAX_PER_CARET * (1 + (this._secondaries ? this._secondaries.length : 0))) return;

    const now = performance.now();
    const rate = Math.max(0.1, this.settings.stardustRate ?? 1);
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
    const vary = (c) => Math.max(0, Math.min(255, Math.round(c + (Math.random() - 0.5) * 50)));

    // Orbit mode is captured per mote rather than read at draw time, so
    // flipping the toggle lets the motes already in flight finish the way they
    // started instead of every one of them snapping onto a circle at once.
    const orbit = !!this.settings.stardustOrbit;
    const meanRadius = Math.max(6, this.settings.stardustOrbitRadius ?? 22);

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
  }

  // Is the caret in the note editor itself, rather than somewhere else in the
  // app? This is the same question caretCoords() asks to choose between its
  // CodeMirror path and the generic interface one, asked of the same object -
  // and deliberately not a DOM or selector test.
  //
  // "Note Editor Only" has to stop drawing a caret and stop hiding the native
  // one in EXACTLY the same places, and the only way to guarantee two halves
  // agree is to derive both from one predicate. A selector-based version is
  // how issue #26 happened: we declined to draw in a field whose native caret
  // we were still hiding, and it had a caret from neither source.
  noteEditorFocused() {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      return !!(view && view.hasFocus);
    } catch {
      // Unreachable in practice, but this feeds the hide-native class, so the
      // answer matters: "no" leaves the user with Obsidian's own caret, which
      // is the safe way to be wrong.
      return false;
    }
  }

  // Whether the native caret should currently be suppressed. Every site that
  // stamps cursor-smith-hide-native reads this rather than the setting,
  // because with Note Editor Only on the answer changes with FOCUS and not
  // only when a setting is saved.
  hideNativeActive() {
    if (!this.settings.hideNativeCaret) return false;
    if (!this.settings.noteEditorOnly) return true;
    return this.noteEditorFocused();
  }

  applyBodyClasses() {
    const engineActive = !!(this.canvasEngineActive || this.torchEngineActive);
    // During a presentation the canvas clears itself and the torch hides, so
    // there's no custom cursor visible - don't suppress the native caret then
    // either (it stays hidden behind the Slides overlay anyway, but removing
    // our class avoids any edge-case where the native cursor is needed and
    // was globally suppressed by us).
    const presenting = this.isPresentationModeActive();
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.toggle(
          "cursor-smith-hide-native",
          !!(engineActive && this.hideNativeActive() && !presenting)
        );
      }
    }
  }

  // The torch's look - darkness, colour, radius - is painted by the torch
  // tick from the effective settings every frame it changes (see
  // _torchPaintDarkness / _torchPaintGlow), so a settings change has nothing
  // to apply to the elements themselves. Kept as the hook saveSettings and
  // the tick call, so the dedupe keys can be dropped here: the painters
  // compare against them, and a changed Darkness or Colour must repaint.
  applyOverlayStyle() {
    this._torchDarkKey = "";
    this._torchGlowKey = "";
  }

  // The focused document that ISN'T the active view's - or null when the
  // view's own window is the focused one (or nothing of ours is focused).
  //
  // This is the Obsidian 1.13 settings window, made a first-class citizen.
  // Before 1.13, Settings was a modal INSIDE the main document, so the
  // interface-caret machinery (genericCaretCoords / formFieldCaretCoords /
  // getCaretClipRect - all of which were built for exactly those text boxes)
  // found its inputs for free: same document as the canvas. 1.13 moved
  // Settings into its own window, and every document this engine knew how to
  // reach came from `view.dom.ownerDocument` - a document that, by
  // construction, hosts a workspace view. The settings window hosts none, so
  // the canvas never migrated there, its activeElement was never consulted,
  // and the cursor simply didn't exist in any of its boxes.
  //
  // The rule: the view's document keeps the canvas for as long as it has OS
  // focus. Only when it doesn't - and some OTHER document of ours does - is
  // that other document offered as the migration target. Candidates are
  // Obsidian's activeDocument global (which tracks the focused Obsidian
  // window) plus every document we've registered, which includes the
  // settings window itself via the settings tab (registerPanelDocument). A fully
  // backgrounded app matches nothing here and returns null, so the old
  // fallback chain - and windowFocused()'s parking - behave exactly as
  // before.
  _focusedForeignDoc(view) {
    try {
      const viewDoc = view && view.dom.ownerDocument;
      if (viewDoc && viewDoc.hasFocus()) return null;
      const candidates = [];
      if (typeof activeDocument !== "undefined" && activeDocument) {
        candidates.push(activeDocument);
      }
      for (const d of this.registeredDocuments) candidates.push(d);
      for (const d of candidates) {
        if (!d || d === viewDoc) continue;
        // body can be gone on a document whose window is mid-teardown; such a
        // document must never be chosen (ensureCanvasForView appends to it).
        try { if (d.body && d.hasFocus()) return d; } catch { /* dead doc */ }
      }
    } catch { /* a focus probe must never take a frame down */ }
    return null;
  }

  ensureCanvasForView(view) {
    // CRASH FIX: this used to read `this.overlay.ownerDocument` when there
    // was no view - but this.overlay belongs to the torch engine and is
    // null whenever the torch is off (and even briefly when it's on). On
    // window refocus, activeEditor is momentarily null, so view is null,
    // and the null-deref threw inside the rAF tick, killing the loop and
    // making the cursor vanish until plugin reload. Fall back to the
    // canvas's own current document (don't migrate anywhere while there's
    // no view), then to Obsidian's activeDocument, then to the main doc.
    //
    // _focusedForeignDoc outranks even the view's document, because
    // activeEditor is sticky: while you type in the 1.13 settings window,
    // the last note you touched still reports as the active editor, so
    // "there is a view" is true and yet the caret is in another window
    // entirely. It answers non-null only while that other window actually
    // holds OS focus, so during normal editing this line contributes
    // nothing and the chain below is unchanged.
    const targetDoc =
      this._focusedForeignDoc(view) ||
      (view && view.dom.ownerDocument) ||
      (this.canvasWrapper && this.canvasWrapper.ownerDocument) ||
      (typeof activeDocument !== "undefined" && activeDocument) ||
      document;
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument !== targetDoc) {
      this.canvasWrapper.remove();
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
      this._canvasRect = null;
    }
    if (!this.canvasWrapper) {
      targetDoc.body.classList.add("cursor-smith-active");
      
      // The wrapper creates a strict physical bounding box to unblock window
      // dragging. See _chromeInsets / getFullViewportRect for the sizing
      // logic - the wrapper is never sized to overlap the tab bar.
      // Its fixed/clipped/inert/collapsed defaults are the
      // .cursor-smith-wrapper rule in styles.css; the
      // tick sizes it inline from there.
      //
      // Inside .app-container rather than directly on body.
      // Obsidian's app.css has: body.is-frameless > .app-container ~ * { app-region: no-drag }
      // which targets every direct-body-child sibling of .app-container —
      // exactly what we were. Inside .app-container that rule doesn't match
      // and our elements stay neutral (no app-region) as intended.
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.canvasWrapper = appContainer.createDiv({ cls: "cursor-smith-wrapper" });
      this._lastWrapperRect = "";
      // A fresh wrapper carries no mix-blend-mode, so the value cached from
      // the old one would suppress the write that puts it back - which is
      // exactly what happens when a pop-out window moves the canvas to another
      // document while Translucent is on. See applyCanvasBlend.
      this._canvasBlend = "";

      // NO app-region declaration (same rationale as wrapper above).
      this.canvas = this.canvasWrapper.createEl("canvas", { cls: "cursor-smith-canvas" });

      this.ctx = this.canvas.getContext("2d");
      // No backing store yet: the canvas is sized to the caret's neighbourhood
      // by _fitCanvasRegion on the first frame that has something to show,
      // never to the window. See fitCanvasRegion.
      this._canvasRect = null;
      this._canvasDpr = 0;
      this._wrapperPos = null;
      this._dirtyRaw = null;
    }
    if (!targetDoc.body.classList.contains("cursor-smith-active")) {
      targetDoc.body.classList.add("cursor-smith-active");
    }
    // Per frame, and with Note Editor Only it has to be: the value tracks
    // focus, so the class comes off the instant the Command Palette opens and
    // goes back on the instant the editor takes focus again. classList.toggle
    // with an explicit force mutates nothing when the answer is unchanged, so
    // the steady-state cost is a comparison and no style invalidation.
    const hideNative = this.hideNativeActive();
    targetDoc.body.classList.toggle("cursor-smith-hide-native", hideNative);
    // targetDoc is the document the caret is in, so the line above is what the
    // user sees. Every OTHER document we have stamped the class into is now
    // potentially stale though, and a body class that means one thing in one
    // window and something else in the next is how a pop-out-only bug starts.
    // Deduped on the value, so this runs on transitions and not per frame.
    if (hideNative !== this._hideNativeSig) {
      this._hideNativeSig = hideNative;
      try { this.applyBodyClasses(); } catch { /* never take the frame down */ }
    }
  }

  ensureTorchOverlayForView(view) {
    if (!this.settings.torchEffect) {
      this.disableTorchOverlay();
      return;
    }
    // CRASH FIX: same null-deref as ensureCanvasForView - this function
    // exists to CREATE this.overlay, so it can't rely on this.overlay
    // already existing to pick a document. With no view (refocus, no note
    // open) and no overlay yet, the old code threw and the torch rAF loop
    // died silently.
    const targetDoc =
      (view && view.dom.ownerDocument) ||
      (this.overlay && this.overlay.ownerDocument) ||
      (typeof activeDocument !== "undefined" && activeDocument) ||
      document;
    if (this.overlay && this.overlay.ownerDocument !== targetDoc) {
      this.overlay.remove();
      this.overlay = null;
      this.modalObserver?.disconnect();
      this.modalObserver = null;
    }
    if (!this.overlay) {
      targetDoc.body.classList.add("cursor-smith-torch-active");
      // Same as canvas wrapper: append inside .app-container to avoid
      // Obsidian's body.is-frameless > .app-container ~ * { no-drag } rule.
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.overlay = appContainer.createEl("canvas", { cls: "cursor-smith-torch-overlay" });
      this._torchDarkKey = "";
      // Collapsed to 0x0 at 0,0 by the .cursor-smith-torch-overlay rule until the
      // tick sizes it.
      this._lastOverlayRect = "";
      // A brand new element carries none of the old one's inline custom
      // properties, so the radius cache has to be dropped with it or the tick
      // would dedupe against a value this overlay was never given.
      this._lastTorchRadius = -1;
      this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
      this.applyOverlayStyle();
      
      this.modalOpen = !!targetDoc.querySelector(".modal-container");
      this.modalObserver = new MutationObserver(() => {
        this.modalOpen = !!targetDoc.querySelector(".modal-container");
      });
      this.modalObserver.observe(targetDoc.body, { childList: true });
    }
  }

  // Paint the darkness layer for these lights, if anything about the picture
  // changed since the last paint: a moved light, a new radius, a new size,
  // a new setting. A parked torch does not touch the bitmap.
  _torchPaintDarkness(spots, radiusPx, darkness, w, h) {
    const el = this.overlay;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + darkness + "|" +
      spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";");
    if (key === this._torchDarkKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchDarkKey = key;
    paintTorchDarkness(ctx, w, h, spots, radiusPx, darkness);
  }

  _torchPaintGlow(spots, radiusPx, warmRgb, w, h) {
    const el = this.glowEl;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + warmRgb + "|" +
      spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";");
    if (key === this._torchGlowKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchGlowKey = key;
    paintTorchGlow(ctx, w, h, spots, radiusPx, warmRgb);
  }

  // Build or tear down the additive glow layer.
  //
  // Called from the torch tick, NOT from ensureTorchOverlayForView: that runs
  // before the Vim per-mode settings swap, so a mode that turns the glow up
  // while the global setting has it at 0 would silently get no layer to light.
  // Decide after the swap. (Same rule as the canvas engine's lazy layers.)
  //
  // Torn down rather than hidden when unused, because a blended layer forces a
  // re-composite of everything beneath it whether or not it paints anything.
  _ensureGlowLayer(wanted) {
    if (!wanted) {
      if (this.glowEl) { this.glowEl.remove(); this.glowEl = null; this._torchGlowKey = ""; }
      return null;
    }
    const doc = this.overlay && this.overlay.ownerDocument;
    if (!doc) return null;
    // Follow the overlay between documents, same as everything else here.
    if (this.glowEl && this.glowEl.ownerDocument !== doc) {
      this.glowEl.remove();
      this.glowEl = null;
    }
    if (!this.glowEl) {
      const appContainer = doc.querySelector(".app-container") || doc.body;
      // Sibling of the overlay, deliberately - see the CSS note in styles.css.
      this.glowEl = appContainer.createEl("canvas", { cls: "cursor-smith-torch-glow" });
      this._torchGlowKey = "";
      this._lastGlowRect = "";
      this._lastGlowAlpha = "";
      this._torchGlowKey = "";
    }
    return this.glowEl;
  }

  // Returns true when Obsidian's Slides plugin is showing a presentation
  // overlay. In that state the note editor is still technically "active" and
  // hasFocus can still return true, so without this guard the canvas engine
  // keeps drawing a blinking cursor over the slides - and keystrokes still
  // reach the underlying CM editor, causing live edits during a presentation.
  //
  // Detection strategy (most-to-least specific):
  //   1. A .slides-container element is present and visible (Slides plugin
  //      presentation overlay - the most direct signal).
  //   2. The active leaf's view type is "slides" (covers the same case via
  //      Obsidian's own workspace API, without relying on DOM class names).
  //   3. body.is-fullscreen alone is NOT used: other things (e.g. Obsidian's
  //      native full-screen mode) also set it and would cause a false positive.
  isPresentationModeActive() {
    try {
      // 1. DOM-level check: Slides plugin injects a .slides-container element
      //    into the active leaf while presenting. It's removed when the
      //    presentation ends, so presence + visibility = presenting now.
      const doc = (this.canvas?.ownerDocument) ??
        (typeof activeDocument !== "undefined" ? activeDocument : null) ?? document;
      const slidesContainer = doc.querySelector(".slides-container");
      if (slidesContainer && this._isVisiblyRendered(slidesContainer)) return true;

      // 2. Workspace API check: the active leaf's view type becomes "slides"
      //    for the duration of the presentation.
      const activeView = this.app.workspace.getActiveViewOfType(View);
      if (activeView?.getViewType?.() === "slides") return true;
    } catch {
      // Never crash the tick loop over a failed presentation check.
    }
    return false;
  }

  // True when `el` is Excalidraw's own text editor.
  //
  // Excalidraw edits text through a <textarea> absolutely positioned over its
  // canvas and CSS-transformed to match the shape - scaled with the zoom, and
  // rotated with the element. isTextCaretHost says yes to any <textarea>, so
  // that editor fell straight through to genericCaretCoords and we drew on it.
  //
  // Which cannot work, because formFieldCaretCoords measures the caret offset
  // in an offscreen mirror div that carries none of those transforms, then
  // adds getBoundingClientRect() as the origin. Untransformed offsets on a
  // transformed origin: near-enough on the first character, drifting further
  // with every one after it, and meaningless the moment the shape is rotated.
  //
  // Excalidraw draws its own caret anyway, so there is nothing here for us to
  // replace - we just get out of the way. See also the caret-color carve-out
  // in styles.css: suppressing our drawing is only half the
  // job, because our global hide-native rule would otherwise leave the
  // textarea with no visible caret at all.
  //
  // The DOM check is the load-bearing one, NOT the view-type check below it:
  // Excalidraw also renders through a markdown post-processor, so a drawing
  // embedded in a note lives inside a leaf whose view type is "markdown", and
  // a view-type test alone would miss every embed.
  isExcalidrawCaretHost(el) {
    if (!el) return false;
    try {
      // Cached against the focused element rather than on a timer: focus is
      // the only thing that can change the answer, which makes this exact and
      // free on every repeat frame. Same convention as _clipChainFor.
      if (this._excaliHostFor !== el) {
        this._excaliHostFor = el;
        this._excaliHostVal = !!(
          el.closest?.(".excalidraw, .excalidraw-wrapper, .excalidraw-view") ||
          el.classList?.contains("excalidraw-wysiwyg")
        );
      }
      if (this._excaliHostVal) return true;

      // Cheap belt-and-braces for a full Excalidraw leaf, in case a future
      // release renames the container classes out from under the selector.
      //
      // SCOPED TO THAT LEAF'S OWN CONTENT, and that scoping is the whole
      // point. This used to be a bare view-type test that never looked at
      // `el` at all, so while a drawing was the active tab EVERY text field
      // in the app answered yes: the rename dialog, the settings search, any
      // modal. Those are siblings of the workspace rather than part of the
      // drawing, so we declined to draw a caret in them AND the hide-native
      // rule still applied to them (the caret-color carve-out only reaches
      // Excalidraw's own textarea) - leaving them with no caret from either
      // source. Issues #26 and #27.
      //
      // contentEl and NOT containerEl, which is the follow-up on #26. A view's
      // containerEl is `.view-header` + `.view-content`, so a container-wide
      // test also claims the tab title bar - and `.view-header-title` is
      // permanently contentEditable on desktop, because clicking it is how you
      // rename the file from there. That is ordinary Obsidian chrome with an
      // ordinary caret, not the drawing, and the container scope swallowed it
      // exactly the way the bare view-type test swallowed the modals.
      //
      // Nothing is lost by narrowing: Excalidraw puts `.excalidraw-view` on
      // contentEl itself, so everything the container test would add below the
      // header is already caught by the DOM branch above.
      const view = this.app.workspace.getActiveViewOfType(View);
      if (view?.getViewType?.() !== "excalidraw") return false;
      if (view.contentEl) return view.contentEl.contains(el);
      // No contentEl - not an ItemView, so we cannot name the content box.
      // Fall back to the container minus the header, that being the only
      // caret-bearing chrome the container adds.
      return !!(
        view.containerEl &&
        view.containerEl.contains(el) &&
        !el.closest?.(".view-header")
      );
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // THE pool/state reset. Called from three places - onload, enableCanvasEngine
  // and disableCanvasEngine - which is exactly why it is a function: those
  // three used to be three hand-maintained lists, and ARCHITECTURE.md's warning
  // that missing one lets state survive a plugin toggle had already come true
  // in both directions (see the comment at the call site in onload).
  //
  // ADDING AN EFFECT: reset its pool HERE and nowhere else. This is the second
  // of the six touchpoints in the header, and now the only one that is a single
  // edit rather than three.
  //
  // Nothing here may touch the DOM, the canvas, the rAF handles or the engine's
  // active flags: those are genuinely per-site (a disable tears the canvas down,
  // an enable builds it) and stay at their call sites.
  // ---------------------------------------------------------------------------
  _resetEngineState() {
    this.trail = [];
    this.particles = [];
    this.flamePixels = [];
    // Hot-head's fire. Deliberately NOT flamePixels: those are sprites with a
    // per-particle colour and size, while these are points binned into a shared
    // pixel lattice (see drawHotHead), so they have to be rasterised as a set
    // rather than mixed in with particles that paint themselves.
    this.flameEmbers = [];
    // Patches of text currently alight, each decaying from the moment the caret
    // leaves it - this is what keeps text burning after the caret has moved on.
    this.hotBurns = [];
    // Last caret sample and smoothed velocity, so particles can inherit caret
    // motion as drag. See updateHotHeadInertia.
    this._hotPrev = null;
    this._hotVel = { x: 0, y: 0 };
    this.thunderbolts = [];
    // Fireworks. Its own pool rather than flamePixels, for the same reason
    // thunderbolts have one: a shell is a two-phase animation (climb, then
    // burst) whose sparks don't exist yet when it launches, so it can't be
    // expressed as a bag of independent particles that each paint themselves.
    this.fireworks = [];
    // Zeroed with the pool: a stamp left over from before the engine was last
    // torn down would swallow the first launch after it comes back.
    this._lastFireworkT = 0;
    // Signal Glitch: at most ONE burst is ever live (a second jump during a
    // burst restarts it rather than stacking), so this is a single nullable
    // record instead of a pool.
    this.glitch = null;
    // Stardust lives in its own pool rather than joining flamePixels,
    // because the frame governor treats a non-empty flamePixels as "something
    // is in motion" and latches the HOT (60fps) gear. Stardust is emitted
    // precisely when the user is idle and can stay alive indefinitely, so
    // sharing that pool would pin the display at full refresh rate for as long
    // as the effect is switched on - the exact failure this file's power work
    // exists to avoid. See the gear decision in the canvas tick: stardust asks
    // for the WARM (30fps) gear instead, which is plenty for a slow drift.
    this.stardust = [];
    this._lastStardustT = 0;
    // Bracket Tether: the rules to paint this frame (one per covered line),
    // plus the cache key that lets the text scan behind them skip most frames.
    this.bracketTether = null;
    this._tetherKey = null;
    this._tetherFrom = -1;
    this._tetherTo = -1;
    // Second cache, for the line-box measurement rather than the text scan:
    // the rules themselves, the span they were measured for, and the two
    // endpoint coordinates they were measured against (see tetherSegments).
    this._tetherSegs = null;
    this._tetherSegKey = null;
    this._tetherAnchorA = null;
    this._tetherAnchorB = null;
    this.secondaryCarets = []; // plain 2px lines: carets past SECONDARY_FULL_MAX
    this._secondaries = [];    // full-effect secondaries: one CARET_STATE_FIELDS bundle each
    this._selShape = null;     // (count, mainIndex) of the selection last frame
    this.lastActive = null;
    this.pending = null;
    this.smearQuad = null;
    // The corners actually painted: smearQuad itself, or a tapered copy of it.
    // Kept apart from the quad because the quad is the spring's *state*, and a
    // tapered corner fed back into it would spring toward the narrowed shape -
    // the taper would fight the very lag it's drawn from.
    this.smearShape = null;
    this._taperBuf = null;
    this._volumeBuf = null;
    // Unit vector of the last real caret movement, held between frames so the
    // tail keeps pointing the right way while the quad catches up after a stop.
    this._smearDir = null;
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;

    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;
    this._catchUpBoost = 1;

    // Speed Demon heat: 0..1, ramps on keystrokes, decays per frame in the
    // canvas tick. Kept separate from typingSpeedMod (which drives smooth-
    // movement catch-up) because the two ease with very different curves
    // and share no math beyond "user is typing".
    this.heat = 0;
    this._lastSparkT = 0;

    // Pop Effects rainbow: a running hue that advances each time any of the
    // three effects fires (rather than picking randomly) so consecutive pops
    // step smoothly around the color wheel instead of jumping around.
    //
    // Deliberately ONE hue shared by letters, bolts and fireworks rather than
    // three counters: pressing Space mid-word should continue the sweep the
    // letters either side of it are on, not start a second, unrelated one that
    // happens to be running at the same time.
    this._popRainbowHue = 0;

    // Dedupe for the hide-native body class (see ensureCanvasForView). null
    // rather than a boolean so the first frame after a reset always differs
    // and re-syncs every document, instead of trusting a stamp left over from
    // before the engine was torn down.
    this._hideNativeSig = null;
  }

  enable() {
    this.disable(); 
    this.enableCanvasEngine();
    // torchPossible() covers both the global torch and any per-mode torch, so
    // the engine is up whenever a spotlight could appear; the torch tick then
    // shows/hides it per the effective (per-mode) settings each frame.
    if (this.torchPossible()) this.enableTorchOverlay();
  }

  disable() {
    this.disableCanvasEngine();
    this.disableTorchOverlay();
  }

  disableCanvasEngine() {
    this.canvasEngineActive = false;
    if (this.canvasRaf) {
      window.cancelAnimationFrame(this.canvasRaf);
      this.canvasRaf = 0;
    }
    // The governor may be dozing on a timeout rather than an rAF.
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
    }
    this._canvasTick = null;
    this._drawSig = null;
    this._caretGeoCache = null;
    this._paneRectCache = null;
    this._observeEditorLayout(null);
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("cursor-smith-active", "cursor-smith-hide-native");
        const canvas = doc.querySelector(".cursor-smith-canvas");
        if (canvas) {
          if (canvas.parentElement && canvas.parentElement.style.overflow === "hidden") {
            canvas.parentElement.remove();
          } else {
            canvas.remove();
          }
        }
      }
    }
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this._canvasRect = null;
    this._clipRect = null;
    this._wrapperPos = null;
    this._dirtyRaw = null;
    // Single reset site (see _resetEngineState). This used to be a hand-copied
    // list that had quietly fallen behind the other two: `trail`, `lastActive`,
    // `lastMoveTime`, `typingSpeedMod`, `_catchUpBoost` and the firework /
    // stardust rate stamps were never cleared on the way down.
    this._resetEngineState();
    this._formMirror?.remove();
    this._formMirror = null;
  }

  disableTorchOverlay() {
    this.torchEngineActive = false;
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
    }
    this._torchTick = null;
    this._torchDarkKey = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    if (this.torchRaf) {
      window.cancelAnimationFrame(this.torchRaf);
      this.torchRaf = 0;
    }
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("cursor-smith-torch-active");
        doc.querySelector(".cursor-smith-torch-overlay")?.remove();
        doc.querySelector(".cursor-smith-torch-glow")?.remove();
      }
    }
    this.overlay = null;
    // The glow is a sibling, so removing the overlay does not take it with it.
    this.glowEl?.remove();
    this.glowEl = null;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._torchDarkKey = "";
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.modalOpen = false;
  }

  enableCanvasEngine() {
    this.canvasEngineActive = true;
    // Single reset site (see _resetEngineState).
    this._resetEngineState();
    this._suspendCleared = false;
    // Begin from a known-clean surface: the canvas survives enable/disable
    // cycles, so assume nothing about what is currently painted on it.
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyRaw = null;
    this._dirtyFull = true;
    this._canvasRect = null;
    this._regionOversizedT = 0;

    // Schedule the next frame according to the gear the frame just decided
    // on (this._canvasGear): hot = next vsync, warm/idle = doze on a timeout
    // that _markActivity can cancel for instant wake.
    const schedule = () => {
      if (!this.canvasEngineActive) return;
      const gear = this._canvasGear || "hot";
      const caps = this._frameCaps();
      if (gear === "hot") {
        this.canvasRaf = window.requestAnimationFrame(tick);
        return;
      }
      this._canvasIdleT = window.setTimeout(() => {
        this._canvasIdleT = 0;
        if (this.canvasEngineActive) this.canvasRaf = window.requestAnimationFrame(tick);
      }, gear === "warm" ? caps.warmMs : gear === "energy" ? caps.energyMs : caps.idleMs);
    };

    const tick = () => {
      if (!this.canvasEngineActive) return;
      // Hot-gear frame cap: on 120Hz ProMotion displays rAF fires every
      // ~8ms; a cursor gains nothing above ~60fps, so skip alternate
      // frames. The skipped wake-up is just a reschedule, costing ~nothing.
      // Low Power raises the cap to ~30fps (FRAME_CAPS).
      // `perf` is the performance report's counters while one is running
      // (performanceReport); null otherwise, and every touch is guarded so
      // the common case costs one null test.
      const perf = this._perf;
      if ((this._canvasGear || "hot") === "hot") {
        const n = performance.now();
        if (perf) {
          // Every raw frame in the hot gear, cap included. The MOST COMMON gap
          // is the display's refresh interval; the shortest is not - Chromium
          // delivers callbacks back to back after a stalled frame.
          if (perf.rafPrev) {
            const d = n - perf.rafPrev;
            if (d > 1 && d < 100) {
              const b = Math.round(d * 2) / 2;
              perf.rafGaps[b] = (perf.rafGaps[b] || 0) + 1;
            }
          }
          perf.rafPrev = n;
        }
        if (n - (this._lastHotFrameT || 0) < this._frameCaps().hotMinMs) {
          this.canvasRaf = window.requestAnimationFrame(tick);
          return;
        }
        this._lastHotFrameT = n;
      } else if (perf) {
        perf.rafPrev = 0;
      }
      const tTick = perf ? performance.now() : 0;
      // The whole frame is wrapped so a single bad frame (e.g. a transient
      // null during window refocus, a detached node mid-layout) can never
      // kill the rAF loop permanently - that's exactly the "cursor
      // disappears until plugin reload" failure mode. We log the first
      // error to the console for debugging and keep ticking.
      try {
        // Two states suspend the cursor outright:
        //
        //   1. A Slides presentation. The note editor stays open underneath
        //      the presentation overlay and its CM view can still report
        //      hasFocus, so without this guard the cursor keeps blinking over
        //      the slides and keystrokes still reach the editor.
        //   2. The window isn't the focused OS window (see windowFocused()).
        //
        // Both are handled by parking rather than tearing the engine down:
        // clear the surface once, then drop to the idle heartbeat. Resuming is
        // then a single frame away, and the caret/smear state is left exactly
        // as it was so coming back doesn't replay a move or snap the spring.
        if (this.presentationActive() || !this.windowFocused()) {
          if (this.ctx && this.canvas && !this._suspendCleared) {
            this._clearCanvas();
            this._suspendCleared = true;
            // The surface is blank, so there's nothing left for the next frame
            // to clear; dropping the signature guarantees the first frame back
            // actually repaints instead of matching a stale one and skipping.
            this._dirtyPrev = null;
            this._drawSig = null;
          }
          this._canvasGear = "idle";
          schedule();
          return;
        }
        this._suspendCleared = false;

        const view = this.app.workspace.activeEditor?.editor?.cm;
        this.ensureCanvasForView(view);
        if (view) this.registerWindowEvents(view.dom.ownerDocument);
        this._observeEditorLayout(view);
        // The canvas may have just migrated to a document that hosts no view
        // at all - the 1.13 settings window - which the line above therefore
        // cannot register. Without listeners there, typing in a settings box
        // neither wakes the render loop nor resets the blink, so the cursor
        // would freeze mid-fade between idle heartbeats. Set-guarded inside
        // registerWindowEvents, so per-frame this is a no-op.
        if (this.canvasWrapper) {
          this.registerWindowEvents(this.canvasWrapper.ownerDocument);
        }

        if (this.canvasWrapper && this.canvas) {
          // Only clip to the editor pane while the note editor is the thing
          // actually focused. The moment focus moves anywhere else - file
          // tree rename box, Command Palette, Settings, other modals - clip
          // to whatever scroll container that field lives in instead, and
          // only fall back to the viewport when it has none. Handing back the
          // whole viewport unconditionally is what let a caret in a Settings
          // text box paint outside the settings frame: see getCaretClipRect.
          const r = (view && view.hasFocus
            ? this.getPaneRect(view)
            : this.getCaretClipRect(this.canvas.ownerDocument)) ||
            // Never 100vw/100vh here: a full-viewport layer over the
            // titlebar kills Electron's window-drag hit-testing on
            // Linux/Windows (drag regions compose in DOM order; z-index
            // and pointer-events are irrelevant to them).
            this.getFullViewportRect(this.canvas.ownerDocument);

          // Round and dedupe: writing identical style values every frame
          // still costs style-recalc work in Blink, and fractional pixel
          // sizes force continuous compositor re-uploads - both showed up
          // as stutter with the smear effect on (worst on weak GPUs, e.g.
          // ChromeOS Crostini's virtualized one).
          const top = Math.round(r.top);
          const left = Math.round(r.left);
          // Kept for Thunderstrike, which needs to know where the visible area
          // starts so a bolt can be launched from just above it and appear to
          // arrive from outside the pane.
          this._clipTop = top;
          const width = Math.round(r.width);
          let height = Math.round(r.height);
          // Keep the cursor canvas above the status bar. The editor pane's rect
          // can extend under a floating status bar, and while scrolling the
          // pane briefly reaches the window edge, so clamp the clip to the
          // status bar's top. No-op for an in-flow status bar (the pane already
          // stops above it) and on platforms with no status bar (inset is 0).
          const ins = this._chromeInsets(this.canvas.ownerDocument);
          let clipPath = "";
          if (ins.bottomInset > 0) {
            const win = this.canvas.ownerDocument.defaultView || window;
            const cut = wrapperClipForStatusBar(
              { top, left, width, height },
              { top: win.innerHeight - ins.bottomInset, left: ins.statusLeft, right: ins.statusRight },
            );
            height = cut.height;
            clipPath = cut.clipPath;
          }
          const key = top + "," + left + "," + width + "," + height + "|" + clipPath;
          if (key !== this._lastWrapperRect) {
            this._lastWrapperRect = key;
            // The wrapper clips the canvas (overflow:hidden). Pixels painted
            // earlier and then clipped out of view are still sitting in the
            // buffer, so a wrapper that moves or grows can reveal stale
            // content that damage tracking would never think to clear.
            this._dirtyFull = true;
            this.canvasWrapper.style.top = top + "px";
            this.canvasWrapper.style.left = left + "px";
            this.canvasWrapper.style.width = width + "px";
            this.canvasWrapper.style.height = height + "px";
            this.canvasWrapper.style.clipPath = clipPath;
            // The canvas is positioned relative to the wrapper, so it has to
            // be re-placed against the new origin (_fitCanvasRegion does it,
            // and also drops a region that no longer lies inside the clip).
            this._wrapperPos = { left, top };
            this._clipRect = { x: left, y: top, w: width, h: height };
            this._canvasPlaced = false;
          }
        }

        // Vim-aware: figure out the active mode once, then swap this.settings
        // to the effective (mode-merged) config for the entire caret/draw
        // pipeline. Every read of this.settings below therefore reflects the
        // current Vim mode's full look/effect snapshot with zero per-key
        // plumbing, and is restored in the finally so persisted settings and
        // everything outside the frame stay untouched.
        const _vimMode = this.currentVimMode();
        if (_vimMode !== this._appliedVimMode) {
          this._appliedVimMode = _vimMode;
          this.onVimModeChanged();
        }
        const _realSettings = this.settings;
        this.settings = this.effectiveSettings(_vimMode);
        this._settingsSwapped = true;
        try {
          // Frame counter: hotSyncScroll shares one scroll delta per tick
          // between the primary and the secondaries.
          this._tickNo = (this._tickNo || 0) + 1;
          // The Backspace, Enter and Space flags are consumed by the first
          // commitMove that sees them, and that is the primary's. The
          // secondaries move on the same keystroke and get the same
          // disintegration, strike and volley, so remember the flags first.
          const flagsAtFrame = {
            del: this._deletePending, enter: this._enterPending, pop: this._popKeyPending,
          };
          // Multi-cursor: if the selection changed shape (a caret came or
          // went, or the main one moved), every saved caret state has to be
          // re-matched to the ranges BEFORE the primary measures itself -
          // including the primary's own, which may now belong to a secondary.
          this.rematchCaretStates(view);
          const tCaret = perf ? performance.now() : 0;
          this.updateActivePoint();
          if (perf) perf.caretMs += performance.now() - tCaret;
          this.updateSmoothCursor();
          // Multi-cursor: run the primary's own update pipeline on each
          // full-effect secondary's state, and gather the plain remainder for
          // draw() to stamp a line at.
          this.updateSecondaryCarets(view, flagsAtFrame);
          // Cheap when off, and internally cached on (caret pos, doc length)
          // so the text scan doesn't rerun every frame while the caret sits
          // still. The secondaries' tethers (computed in
          // updateSecondaryCarets, each through its own caches) are merged
          // in: drawBracketTether paints one list.
          this.bracketTether = this.mergeTethers(
            this.settings.bracketTether ? this.bracketTetherCoords(view) : null);
          this.updateSmearQuad();
          // Must run before the gear decision below, which reads trail.length.
          this.pruneTrail();

          // Speed Demon: cool the cursor down every frame regardless of
          // whether the feature is enabled - if the user toggled it off
          // mid-heat we want the value to settle back to 0 so re-enabling
          // starts from cold. 0.985/frame at ~60fps gives a ~1s half-life:
          // dropping from full heat to cold in roughly 4 seconds of silence.
          if (this.heat > 0) {
            this.heat *= 0.985;
            if (this.heat < 0.001) this.heat = 0;
          }
          if (this.settings.speedDemon && this.settings.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          // Hot-head. The inertia/burn-mark tracker runs unconditionally so the
          // caret history doesn't sit stale from wherever the caret was when
          // the effect was last on and light a trail across the screen on the
          // first frame after it's re-enabled.
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) {
            this.maybeSpawnHotHead();
          }
          // Self-guarding (checks its own toggles and the idle window), and
          // must run before the gear decision below, which reads stardust
          // length to decide whether this frame may be skipped.
          this.maybeSpawnStardust();

          // ---- Gear decision + draw skip -------------------------------
          const nowT = performance.now();
          const eff = this.settings; // the effective (mode-merged) object
          // Anything genuinely in motion demands continuous frames.
          const animating = this._isAnimating(nowT);
          // The energy gradient is driven by wall clock, so it does have to
          // keep repainting - but it is a slow shimmer (roughly a 1.7s period
          // at speed 1), not motion. Repainting it at display rate is pure
          // waste; ~30fps is 50 samples per cycle and looks identical. It
          // therefore gets the warm gear rather than counting as `animating`,
          // which would pin the loop at 60fps for as long as it's switched on.
          const energyShimmer = !!eff.energyEffect && !!this.lastActive;
          const recentInput = nowT - (this._lastActivityT || 0) < 1200;
          // Blink: the long hold phases need no frames at all; only the two
          // short fades per cycle animate. Warm gear (30fps) covers a fade's
          // ~300ms ease smoothly.
          let blinkFading = false;
          let blinkBucket = 1;
          if (eff.blinkingEnabled && this.lastActive) {
            // The phase, not the alpha: with Breathing on the alpha is pinned
            // at 1 while the caret is still visibly changing size, so keying
            // the gear off alpha would park the loop mid-breath.
            const a = this.blinkPhase(nowT);
            blinkFading = a > 0.02 && a < 0.98;
            blinkBucket = a >= 0.5 ? 1 : 0;
          }
          // Stardust deliberately does NOT count as `animating`. In its
          // default mode it runs *because* nothing is happening, so treating
          // live motes as motion would pin the hot gear (60fps) for as long as
          // the user leaves the window alone - the exact opposite of what
          // idling should cost. A slow upward drift is perfectly smooth at the
          // warm gear's 30fps, so it asks for that instead. (With Always On
          // the effect never stands down, so the loop simply never reaches the
          // idle gear while a caret exists; that is the option's stated cost,
          // and it still must not escalate to hot.)
          //
          // `armed` rather than just "motes alive" keeps the loop warm through
          // the gaps between emissions too; at the 100ms idle heartbeat the
          // spawn cadence would visibly stutter.
          const stardustLive = this.stardust.length > 0;
          const stardustActive = stardustLive || this.stardustArmed();
          this._canvasGear =
            animating || recentInput ? "hot"
              : blinkFading || stardustActive ? "warm"
              : energyShimmer ? "energy"
              : "idle";

          // Skip the clear+redraw entirely when the rendered picture would be
          // identical — the canvas simply keeps showing the last frame. This is
          // what takes true idle to ~0% GPU.
          //
          // Gated on the static test rather than on the idle gear, because
          // recentInput holds the HOT gear for 1200ms after every keystroke:
          // without this, a settled cursor was still fully repainted ~72 times
          // per keypress against an unchanged picture. The signature
          // deliberately omits trail/particle/sub-pixel state, so it is only
          // trustworthy while nothing is animating; blinkFading is excluded too
          // since the two-state blinkBucket can't represent a mid-fade alpha.
          // stardustLive (not stardustActive): armed-with-no-motes paints
          // nothing new, so those frames can still be skipped as static.
          const staticFrame = !animating && !blinkFading && !energyShimmer && !stardustLive;
          let doDraw = true;
          if (staticFrame) {
            const la = this.lastActive;
            const isDark = this.canvas
              ? this.canvas.ownerDocument.body.classList.contains("theme-dark")
              : true;
            // The record carries `top` and `bottom`, not `y`: a `c.y` here
            // used to read undefined, so a secondary moving vertically never
            // changed the signature and a settled frame could keep showing it
            // in its old place.
            const sec = this.secondaryCarets && this.secondaryCarets.length
              ? this.secondaryCarets
                  .map((c) => (c.x | 0) + ":" + (c.top | 0) + ":" + (c.bottom | 0))
                  .join(",")
              : "";
            // The tether moves without the caret moving (scrolling, or an edit
            // that shifts the match), so it needs its own term here or a
            // settled frame would keep showing a stale line.
            const bt = this.bracketTether && this.bracketTether.length
              ? this.bracketTether
                  .map((s) => (s.x1 | 0) + ":" + (s.y1 | 0) + ":" + (s.x2 | 0) + ":" + (s.y2 | 0))
                  .join(",")
              : "";
            const sig = [
              _vimMode, blinkBucket, isDark,
              la ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," +
                   Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "") : "none",
              eff.cursorStyle, eff.colorDark, eff.colorLight, eff.caretWidthPx,
              // crtEffect gates glow, and boxHollowWidth/lineSerifs change the
              // painted shape - all three were missing here, so toggling them
              // on a settled cursor matched the previous signature and the
              // frame was skipped: the change appeared to do nothing until the
              // next keystroke woke the loop.
              eff.cursorOpacity, eff.crtEffect, eff.glow, eff.showChar,
              eff.crtNeon, eff.crtNeonGradient,
              eff.boxHollow, eff.boxHollowWidth, eff.lineSerifs,
              // Same reason again: it changes the painted pixels of a settled
              // cursor, so without it here the frame is skipped and the toggle
              // does nothing visible until the next keystroke wakes the loop.
              eff.cursorTranslucent,
              eff.underlineWidthPx, sec, bt, eff.bracketTetherStrength,
              // The full-effect secondaries: position, shape and smear quad
              // each, for the same reasons `la` and _smearSig() are here.
              this._secondariesSig(),
              // Breathing changes the painted size during a hold, where
              // blinkBucket alone can't tell the two states apart: switching it
              // on while the caret sat in the dark half of the cycle matched
              // the previous signature exactly, so the frame was skipped and
              // the option appeared to do nothing until the next fade.
              eff.blinkBreathing, eff.blinkBreathDepth,
              // Same reasoning as the line above: every one of these changes
              // the painted pixels, so leaving them out would make editing a
              // gradient on a settled cursor appear to do nothing until the
              // next keystroke woke the loop.
              eff.gradientEnabled, eff.gradientCount,
              eff.gradientDark1, eff.gradientDark2,
              eff.gradientDark3, eff.gradientDark4,
              eff.gradientLight1, eff.gradientLight2,
              eff.gradientLight3, eff.gradientLight4,
              // The smear quad's own corners. Everything else here is a
              // property of the caret or of the settings; the quad is neither.
              // It is a spring with its own state, and it keeps deforming for
              // as long as it takes to settle AFTER the caret has stopped -
              // during which `la` is frozen and every other term is unchanged,
              // so the signature matched, the frame was skipped, and whatever
              // the last drawn frame painted stayed on screen as a stale
              // stretched ghost. On a slow trailing stiffness that is ~45
              // skipped frames with the quad up to 50px off its target.
              //
              // This was always latent. It only became visible once the
              // trailing corners started keeping their trailing stiffness
              // through the settle: before that they snapped in at LEADING
              // stiffness the instant the caret stopped, so the quad was back
              // on target within a frame or two and there was nothing left to
              // strand.
              //
              // Uses smearCorners() rather than smearQuad, because the taper
              // is what actually gets painted. Rounded to half-pixels, the
              // same quantisation `la` uses - the point is to notice movement
              // that changes painted pixels, not to wake for float noise.
              this._smearSig(),
            ].join("|");
            if (sig === this._drawSig) doDraw = false;
            else this._drawSig = sig;
          } else {
            this._drawSig = null;
          }
          // A pending full clear must not be skipped. _dirtyFull is set when
          // the clip window moves, which can expose pixels painted earlier and
          // clipped out of view - and it is only consumed inside draw(), so
          // skipping the draw would strand the invalidation and leave the
          // stale content on screen indefinitely.
          if (this._dirtyFull) doDraw = true;
          // Where the canvas element sits this frame (issue #30). After the
          // update phase so every pool a spawn just filled is in the need, and
          // before the draw because the draw has to land on the new surface.
          // A re-anchored canvas is blank, so the frame must paint whatever
          // the static-frame test above thought was still on screen.
          if (this._fitCanvasRegion()) { doDraw = true; if (perf) perf.reanchors++; }
          if (doDraw && this._canvasRect) {
            const tDraw = perf ? performance.now() : 0;
            this.draw();
            if (perf) { perf.draws++; perf.drawMs += performance.now() - tDraw; }
          }
        } finally {
          this.settings = _realSettings;
          this._settingsSwapped = false;
        }
      } catch (e) {
        if (!this._tickErrorLogged) {
          this._tickErrorLogged = true;
          console.error("[cursor-smith] canvas tick error (loop kept alive):", e);
        }
      }
      if (perf) {
        perf.ticks++;
        perf.tickMs += performance.now() - tTick;
        const g = this._canvasGear || "hot";
        perf.gears[g] = (perf.gears[g] || 0) + 1;
      }
      schedule();
    };
    this._canvasTick = tick;
    this._canvasGear = "hot";
    this.canvasRaf = window.requestAnimationFrame(tick);
  }

  // (Re)allocate the backing store for the current canvas region. This used
  // to size the canvas to the window; it now sizes it to this._canvasRect,
  // the caret's neighbourhood chosen by _fitCanvasRegion (issue #30). Drawing
  // stays in absolute client coordinates: the context transform subtracts
  // the region's origin, so nothing that paints had to change.
  resizeCanvas() {
    if (!this.canvas || !this.ctx) return;
    const r = this._canvasRect;
    if (!r) return;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    this._canvasDpr = dpr;
    this.canvas.style.width = r.w + "px";
    this.canvas.style.height = r.h + "px";
    this.canvas.width = Math.max(1, Math.round(r.w * dpr));
    this.canvas.height = Math.max(1, Math.round(r.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, -r.x * dpr, -r.y * dpr);
    this._placeCanvas();
    // Reassigning width/height blanks the backing store, so nothing from the
    // previous frame survives and there is nothing left to clear.
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyFull = false;
    // A resize usually rides along with a zoom, DPR, or theme change, any of
    // which can move the caret's font metrics without moving pos - so drop the
    // cached style read rather than wait out its TTL.
    this._caretStyleCache = null;
  }

  // Position the canvas element inside the wrapper so that the region's
  // origin lands at its own client coordinates. transform: none when the
  // region sits at the wrapper's corner avoids promoting the canvas to a
  // separate compositor layer for nothing.
  _placeCanvas() {
    const r = this._canvasRect;
    if (!this.canvas || !r) return;
    const wp = this._wrapperPos || { left: 0, top: 0 };
    const dx = r.x - wp.left;
    const dy = r.y - wp.top;
    this.canvas.style.transform = dx === 0 && dy === 0 ? "none" : `translate(${dx}px, ${dy}px)`;
    this._canvasPlaced = true;
  }

  // Blank the whole surface, whatever region it covers. Bypasses the region
  // transform so it needs no coordinates at all.
  _clearCanvas() {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyRaw = null;
  }

  // The bounding box of everything this frame has to be able to paint, in
  // client coordinates, or null when there is nothing. Runs after the update
  // phase, so it sees every pool a spawn just filled.
  //
  // Three sources. The cursor's own damage bounds (the same helper draw()
  // marks dirty from, so the two cannot disagree), plus the smooth-movement
  // target so the region grows toward where the caret is heading rather than
  // chasing it. The secondaries and the tether, whose positions are known
  // before the draw. And last frame's UNCLAMPED painted union, padded for
  // motion: particles, embers, motes, trail ghosts and glitch slices were all
  // painted somewhere last frame and will be near there this frame. That
  // union is recorded from _markDirty whether or not the canvas actually
  // showed the pixels, which is what lets anything that outruns the pad
  // reappear one frame later instead of staying lost.
  //
  // Two effects are exempt from all that and claim the whole clip window for
  // as long as they are live: a thunderbolt starts above the pane on purpose
  // (see spawnThunderbolt) and a firework shell climbs out of any region
  // fitted round the caret. Both are rare and short.
  _frameNeed(clip) {
    if ((this.thunderbolts && this.thunderbolts.length) ||
        (this.fireworks && this.fireworks.length)) {
      return { x0: clip.x, y0: clip.y, x1: clip.x + clip.w, y1: clip.y + clip.h };
    }
    let b = null;
    const add = (x0, y0, x1, y1) => {
      if (!b) { b = { x0, y0, x1, y1 }; return; }
      if (x0 < b.x0) b.x0 = x0;
      if (y0 < b.y0) b.y0 = y0;
      if (x1 > b.x1) b.x1 = x1;
      if (y1 > b.y1) b.y1 = y1;
    };
    const cb = this._cursorBounds();
    if (cb) add(cb.x0, cb.y0, cb.x1, cb.y1);
    const la = this.lastActive;
    if (la && this.animActive && la !== this.animActive) {
      const pad = 24;
      add(la.x - pad, la.top - pad,
          la.x + Math.max(la.w || 0, la.actualCharWidth || 0) + pad, la.top + (la.h || 0) + pad);
    }
    if (this.secondaryCarets && this.secondaryCarets.length) {
      for (const c of this.secondaryCarets) add(c.x - 4, c.top - 4, c.x + 8, c.bottom + 4);
    }
    // The full-effect secondaries contribute what the primary does: their
    // damage bounds (smear quad included) and their smooth-movement target.
    if (this._secondaries && this._secondaries.length) {
      for (const st of this._secondaries) {
        if (!st.animActive) continue;
        const sb = this._withCaret(st, () => this._cursorBounds());
        if (sb) add(sb.x0, sb.y0, sb.x1, sb.y1);
        const sl = st.lastActive;
        if (sl && sl !== st.animActive) {
          add(sl.x - 24, sl.top - 24,
              sl.x + Math.max(sl.w || 0, sl.actualCharWidth || 0) + 24, sl.top + (sl.h || 0) + 24);
        }
      }
    }
    if (this.bracketTether && this.bracketTether.length) {
      for (const s of this.bracketTether) {
        add(Math.min(s.x1, s.x2) - 4, Math.min(s.y1, s.y2) - 4,
            Math.max(s.x1, s.x2) + 4, Math.max(s.y1, s.y2) + 4);
      }
    }
    const r = this._dirtyRaw;
    if (r) {
      const p = CANVAS_REGION_MOTION_PAD;
      add(r.x0 - p, r.y0 - p, r.x1 + p, r.y1 + p);
    }
    return b;
  }

  // Decide the canvas region for this frame and apply it. Returns true when
  // the surface was re-anchored (and is therefore blank), so the caller
  // knows the frame must be painted whatever the static-frame test said.
  //
  // Movement without growth keeps the backing store and only moves the
  // element (a transform write); growth or a DPR change reallocates it.
  // Either way the surface is blank afterwards, which is fine: draw() paints
  // every live thing from state each frame, it never relies on last frame's
  // pixels beyond knowing where to clear them.
  _fitCanvasRegion() {
    if (!this.canvas || !this.ctx) return false;
    const clip = this._clipRect;
    if (!clip) return false;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    let cur = this._canvasRect;
    // A region fitted inside an earlier clip window is worthless once the
    // window has moved out from under it.
    if (cur && (cur.x < clip.x || cur.y < clip.y ||
                cur.x + cur.w > clip.x + clip.w || cur.y + cur.h > clip.y + clip.h)) {
      cur = null;
    }
    const need = this._frameNeed(clip);
    const lh = (this.animActive && this.animActive.h) || (this.lastActive && this.lastActive.h) || 24;
    const marginY = Math.round(CANVAS_REGION_MARGIN_Y * lh);

    // Shrink only after the region has been oversized for a while.
    const now = performance.now();
    let allowShrink = false;
    if (cur && need) {
      const nw = Math.min(clip.w, (need.x1 - need.x0) + 2 * CANVAS_REGION_MARGIN_X);
      const nh = Math.min(clip.h, (need.y1 - need.y0) + 2 * marginY);
      if (cur.w * cur.h > CANVAS_REGION_SHRINK_RATIO * Math.max(1, nw) * Math.max(1, nh)) {
        if (!this._regionOversizedT) this._regionOversizedT = now;
        else if (now - this._regionOversizedT > CANVAS_REGION_SHRINK_MS) allowShrink = true;
      } else {
        this._regionOversizedT = 0;
      }
    } else {
      this._regionOversizedT = 0;
    }

    const next = fitCanvasRegion(need, clip, cur, {
      marginX: CANVAS_REGION_MARGIN_X, marginY, grid: CANVAS_REGION_GRID, allowShrink,
    });
    if (next === cur && cur === this._canvasRect && dpr === this._canvasDpr) {
      if (!this._canvasPlaced) this._placeCanvas();
      return false;
    }
    if (!next) {
      // Nothing to show and no region worth keeping (the clip moved out from
      // under it). Leave the old store; the first frame with a need refits.
      this._canvasRect = null;
      return false;
    }
    if (allowShrink && next !== cur) this._regionOversizedT = 0;
    const prev = this._canvasRect;
    this._canvasRect = next;
    if (!prev || next.w !== prev.w || next.h !== prev.h || dpr !== this._canvasDpr) {
      this.resizeCanvas();
    } else {
      this.ctx.setTransform(dpr, 0, 0, dpr, -next.x * dpr, -next.y * dpr);
      this._placeCanvas();
      this._clearCanvas();
    }
    // The surface is blank: nothing to clear, everything to paint.
    this._dirtyFull = false;
    this._dirtyPrev = null;
    return true;
  }

  caretCoords() {
    const view = this.app.workspace.activeEditor?.editor?.cm;

    // The note editor (CodeMirror) itself has focus - use the precise,
    // CodeMirror-aware caret info (real glyph metrics, table handling, etc).
    if (view && view.hasFocus) {
      return this.cmCaretCoords(view);
    }

    // Focus is somewhere else in the app that isn't CodeMirror at all - the
    // file-tree rename box, the Command Palette / Quick Switcher input,
    // Settings text fields, other plugins' modals, and so on. These never
    // had a caret to draw before, which is why the custom cursor (and the
    // native one, hidden globally by our CSS) both went missing there.
    // Fall back to a generic caret built from the browser's own selection/
    // element rect so the cursor still shows up on any editable surface.
    return this.genericCaretCoords();
  }

  cmCaretCoords(view) {
    try {
      const main = view.state.selection.main;
      const pos = main.head;
      const doc = view.dom.ownerDocument;
      const active = doc.activeElement;
      const activeIsEditable = isTextCaretHost(active);
      const inTable = !!active?.closest?.("table");

      // At a soft-wrap boundary the same document position has TWO valid
      // visual locations: end of the previous visual row (side -1) or start
      // of the next visual row (side 1). CodeMirror records which one the
      // cursor logically sits at in selection.main.assoc (this is exactly
      // what its own drawSelection plugin uses: coordsAtPos(head, assoc || 1)),
      // so honor it instead of hardcoding -1. Note: CodeMirror's rightward
      // char motion always produces assoc -1, so arrowing right across a
      // wrap renders end-of-row then before-the-second-char, never stopping
      // at the start of the new row - that matches CodeMirror's own native
      // cursor and is left as-is deliberately.
      const side = main.assoc || 1;
      // Geometry cache. coordsAtPos is a layout read (and, in Obsidian, a
      // getComputedStyle for the line's text direction) and it used to run
      // every frame the caret merely sat there. Keyed on (doc identity, pos,
      // assoc) like the style cache below, plus the layout generation every
      // wake source bumps, plus a short TTL as the backstop for what has no
      // event. Tables go through selectionFallbackCoords and are not cached.
      const geoNow = performance.now();
      let gc = this._caretGeoCache;
      let c;
      if (!inTable && gc && gc.doc === view.state.doc && gc.pos === pos && gc.assoc === (main.assoc || 0) &&
          gc.gen === (this._layoutGen | 0) && (geoNow - gc.t) < GEOMETRY_TTL_MS) {
        c = gc.c;
      } else {
        c = inTable ? null : (view.coordsAtPos(pos, side) || view.coordsAtPos(pos, -side));
        if (c && !inTable) {
          this._caretGeoCache = { doc: view.state.doc, pos, assoc: main.assoc || 0, gen: this._layoutGen | 0, t: geoNow, c };
        }
      }

      if (!c) {
        c = this.selectionFallbackCoords(view);
        if (!c) return null;
      }

      // When the caret's document position is scrolled outside the visible
      // editor pane (e.g. mouse-wheel scrolling without moving the text
      // cursor), CodeMirror can still return a coordinate for it - typically
      // clamped near the top or bottom edge of the rendered content, which
      // lands right on the titlebar or just above the status bar. Treat an
      // out-of-view caret the same as "not focused" rather than drawing a
      // ghost cursor there; this also stops the smear spring from reacting
      // to that spurious jump (which is what caused the wiggle on fast
      // scrolling).
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1; // avoid flicker right at the pane edge
        const cBottom = c.bottom ?? c.top;
        if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) {
          return null;
        }
      }

      const rawChar = view.state.doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";

      const win = doc.defaultView || window;

      // --- Cached style + metric reads -----------------------------------
      // getComputedStyle (up to 3x) and elementFromPoint (which forces a
      // layout + hit-test) are the most expensive things in this per-frame
      // function, and the canvas measureText for the glyph width is next.
      // Their inputs only change when the caret moves to a different document
      // position, the document is edited, or the theme/font changes - none of
      // which happen on the frames where a caret merely sits and blinks.
      //
      // Cache the RESOLVED scalars, NOT the live CSSStyleDeclaration (reading
      // a property off that re-flushes style, defeating the point). Key on
      // (doc identity, pos, assoc): in CM6 a pure selection move reuses the
      // same Text object, so the key holds across scrolling and blinking,
      // while any edit swaps the Text object and busts it. A short TTL
      // backstops theme / font-size changes that touch none of those keys.
      const assocKey = main.assoc || 0;
      const nowMs = performance.now();
      let sc = this._caretStyleCache;
      if (!(sc && sc.doc === view.state.doc && sc.pos === pos &&
            sc.assoc === assocKey && (nowMs - sc.t) < 250)) {
        const contentStyle = win.getComputedStyle(view.contentDOM);

        // Find the actual DOM element rendering the character at the caret
        // (not just "the first .cm-line in the document"), so headings,
        // inline code, and any other differently-sized text report their own
        // real font metrics instead of the editor's base font-size/family.
        const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
        const sampleY = (c.top + c.bottom) / 2;
        const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
        const lineEl = (elAtCaret && elAtCaret.closest && elAtCaret.closest(".cm-line")) ||
          view.contentDOM.querySelector(".cm-line");
        const charStyle = elAtCaret && lineEl && lineEl.contains(elAtCaret)
          ? win.getComputedStyle(elAtCaret)
          : (lineEl ? win.getComputedStyle(lineEl) : contentStyle);

        const _textColor = charStyle.color || contentStyle.color || "#ffffff";

        // Extract exact font metrics
        const _fontSize = parseFloat(charStyle.fontSize) || parseFloat(contentStyle.fontSize) || 14;
        const _fontFamily = charStyle.fontFamily || contentStyle.fontFamily || "monospace";
        const _fontWeight = charStyle.fontWeight || contentStyle.fontWeight || "normal";
        const _fontStyleCss = charStyle.fontStyle || contentStyle.fontStyle || "normal";

        // getComputedStyle resolves letter-spacing to 'px' even if set in 'em'.
        const letterSpacingStr = charStyle.letterSpacing || contentStyle.letterSpacing;
        let _letterSpacing = 0;
        if (letterSpacingStr && letterSpacingStr.endsWith("px")) {
          _letterSpacing = parseFloat(letterSpacingStr) || 0;
        }

        const _lineHeightStr = charStyle.lineHeight || contentStyle.lineHeight || "";

        // Width: canvas measurement primary (accurate for proportional fonts,
        // respects letter-spacing), coordsAtPos delta as fallback only when
        // there's no character to measure (end of text, blank line).
        // Note: coordsAtPos(pos+1) at end-of-line returns the start of the
        // NEXT line, making the delta garbage - so it must be the fallback,
        // not the primary source. The canvas measurement handles end-of-line
        // correctly because it measures the actual glyph, not a position delta.
        let _charWidth = view.defaultCharacterWidth || 8;
        if (char) {
          const measuredW = this.measureCharWidth(char, _fontFamily, _fontSize, _fontWeight, _fontStyleCss);
          if (measuredW) {
            _charWidth = measuredW + _letterSpacing;
          } else {
            try {
              const nextCoords = view.coordsAtPos(pos + 1, -1) || view.coordsAtPos(pos + 1, 1);
              if (nextCoords) {
                const measured = nextCoords.left - c.left;
                if (measured > 0.5 && measured < _charWidth * 6) _charWidth = measured;
              }
            } catch {
              /* fall back to defaultCharacterWidth */
            }
          }
        }

        // Horizontal extent of the rendered text on the caret's own VISUAL row.
        //
        // Hot-head needs this for two things: to keep fire off the empty part
        // of a line, and to know when the caret is at a row's first or last
        // character. The .cm-line element is the whole LOGICAL line, so its
        // bounding box is useless once soft wrapping is on - it spans every
        // wrapped row at once and is as wide as the editor. getClientRects()
        // on the line's contents returns one rect per visual row instead, so
        // picking the rect that vertically contains the caret gives the row the
        // caret is actually sitting on, wrapped or not.
        let _rowLeft = null, _rowRight = null;
        if (lineEl) {
          try {
            const rng = doc.createRange();
            rng.selectNodeContents(lineEl);
            const rects = rng.getClientRects();
            // Overlap against the caret's whole vertical span, not just whether
            // the caret's midpoint falls inside a rect. Inline spans with a
            // smaller font (inline code, sub/superscript, a smaller heading
            // fragment) produce rects shorter than the caret, and a strict
            // midpoint test misses them entirely - which is what left whole
            // stretches of text with no fire on them.
            let best = null;
            let nearest = null, nearestD = Infinity;
            for (let ri = 0; ri < rects.length; ri++) {
              const r = rects[ri];
              if (r.width <= 0 && r.height <= 0) continue;
              const overlap = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
              if (overlap > 0) {
                // Several rects share a row (one per styled span), so grow the
                // extent across all of them rather than taking the first.
                if (!best) best = { left: r.left, right: r.right };
                else { best.left = Math.min(best.left, r.left); best.right = Math.max(best.right, r.right); }
              } else {
                const d = Math.abs((r.top + r.bottom) / 2 - (c.top + c.bottom) / 2);
                if (d < nearestD) { nearestD = d; nearest = r; }
              }
            }
            if (!best && nearest && nearestD < (c.bottom - c.top)) {
              // Nothing overlapped, but a row sits within a line-height of the
              // caret - close enough to be the caret's own row on a display
              // where the rects and the caret box don't quite line up.
              best = { left: nearest.left, right: nearest.right };
            }
            if (best && best.right - best.left > 0.5) {
              _rowLeft = best.left; _rowRight = best.right;
            } else if (!(lineEl.textContent || "").trim()) {
              // Genuinely blank line: a zero-width row is correct, and keeps the
              // fire from spreading out into the empty margin.
              _rowLeft = c.left; _rowRight = c.left;
            } else {
              // There IS text here but we couldn't resolve which row - leave the
              // extent unknown so the fire simply isn't clamped. Falling back to
              // a zero-width row instead (as this used to) squeezes the fire
              // down to a single column and reads as the effect being broken on
              // those lines.
              _rowLeft = null; _rowRight = null;
            }
          } catch {
            _rowLeft = null; _rowRight = null;
          }
        }

        sc = this._caretStyleCache = {
          doc: view.state.doc, pos, assoc: assocKey, t: nowMs,
          textColor: _textColor, fontSize: _fontSize, fontFamily: _fontFamily,
          fontWeight: _fontWeight, fontStyle: _fontStyleCss,
          letterSpacing: _letterSpacing, lineHeightStr: _lineHeightStr,
          charWidth: _charWidth, rowLeft: _rowLeft, rowRight: _rowRight,
        };
      }

      const {
        textColor, fontSize, fontFamily, fontWeight, fontStyle: fontStyleCss,
        letterSpacing, lineHeightStr, charWidth, rowLeft, rowRight,
      } = sc;

      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.styleFor("caretWidthPx");
      }

      // Height: match the browser's native selection highlight box by
      // reading CSS line-height (resolved once, from the cache above). The
      // char element's line-height is preferred, falling back to the CM
      // editor's; when neither is a usable value we keep the coordsAtPos
      // span (c.bottom - c.top) as the floor.
      let h = Math.max(4, c.bottom - c.top);
      const rawLineHeight = lineHeightStr;
      if (rawLineHeight && rawLineHeight.endsWith('px')) {
        h = parseFloat(rawLineHeight);
      } else if (rawLineHeight && !isNaN(parseFloat(rawLineHeight)) && rawLineHeight !== "normal") {
        h = fontSize * parseFloat(rawLineHeight);
      }

      // Center the box vertically around the CodeMirror line coordinate
      const centerY = (c.top + c.bottom) / 2;
      const top = centerY - (h / 2);
      const bottom = centerY + (h / 2);

      return {
        x: c.left,
        top: top,
        bottom: bottom,
        h: h,
        w: finalWidth,
        actualCharWidth: charWidth,
        // Text extent of the caret's own visual row, in canvas coords (the
        // canvas is position:fixed at 0,0 so client coords map straight over).
        // Hot-head uses it to keep fire on the text and to spot row edges.
        rowLeft, rowRight,
        char,
        textColor,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle: fontStyleCss,
        // Carried so the glyph drawn inside a Box cursor can be centered on
        // the true glyph advance (charWidth minus this) rather than on the
        // letter-spacing-padded cell, which would push it right by half the
        // spacing on any theme that sets letter-spacing.
        letterSpacing,
        focused: view.hasFocus || (inTable && activeIsEditable),
        pos,
        // Needed by updateActivePoint: an assoc flip at a wrap boundary is a
        // real cursor move (row1-end -> row2-start) even though pos is equal,
        // and must NOT be swallowed by the scroll-compensation branch.
        assoc: main.assoc,
      };
    } catch {
      return null; 
    }
  }

  // CodeMirror 6 supports multiple cursors: state.selection.ranges is an
  // array and state.selection.mainIndex points at the "primary" one that
  // this.* tracks. This returns one entry per OTHER range, in range order,
  // with the caret head's raw pixel coords - or `visible: false` for a range
  // that has scrolled out of the pane, which keeps the array aligned with
  // the per-caret state bundles in this._secondaries (see
  // updateSecondaryCarets; an off-screen entry there clears its caret the
  // way the primary clears when it scrolls out). Returns [] when there is
  // only one range or the view isn't focused.
  secondaryCaretCoords(view, states) {
    const out = [];
    if (!view || !view.hasFocus) return out;
    const gen = this._layoutGen | 0;
    const now = performance.now();
    const doc = view.state.doc;
    try {
      const sel = view.state.selection;
      const ranges = sel.ranges;
      if (!ranges || ranges.length <= 1) return out;
      const mainIndex = sel.mainIndex;

      // Same out-of-view clamp as cmCaretCoords: CodeMirror can hand back a
      // coordinate for a caret that's scrolled off, and drawing it would
      // stamp a stray dashed line at the pane edge.
      const paneRect = this.getPaneRect(view);
      const margin = 1;

      for (let i = 0; i < ranges.length; i++) {
        if (i === mainIndex) continue;
        const head = ranges[i].head;
        // Same soft-wrap disambiguation as the primary caret in cmCaretCoords.
        const s = ranges[i].assoc || 1;
        // Same geometry cache as the primary's, kept on the bundle when there
        // is one (index-aligned with the entries, see updateSecondaryCarets).
        const st = states && states[out.length];
        let c = null;
        const g = st && st._geo;
        if (g && g.doc === doc && g.pos === head && g.gen === gen && (now - g.t) < GEOMETRY_TTL_MS) {
          c = g.c;
        } else {
          c = view.coordsAtPos(head, s) || view.coordsAtPos(head, -s);
          if (st && c) st._geo = { doc, pos: head, gen, t: now, c };
        }
        let visible = !!c;
        if (c && paneRect) {
          const cBottom = c.bottom ?? c.top;
          if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) visible = false;
        }
        // pos/assoc are for the full-effect path; the plain line ignores them.
        const empty = !!ranges[i].empty;
        out.push(visible && c
          ? { x: c.left, top: c.top, bottom: c.bottom, pos: head, assoc: ranges[i].assoc || 0, empty, visible: true }
          : { x: 0, top: 0, bottom: 0, pos: head, assoc: ranges[i].assoc || 0, empty, visible: false });
      }
    } catch {
      /* fall through - a bad frame shouldn't kill the tick loop */
    }
    return out;
  }

  // =========================================================================
  // Multi-cursor: full effects on secondary carets
  // =========================================================================
  // Every non-primary caret up to SECONDARY_FULL_MAX gets the primary's whole
  // pipeline rather than a 2px line. Nothing in that pipeline was rewritten to
  // take a caret argument; it reads and writes the fields in CARET_STATE_FIELDS
  // on `this`, so each secondary keeps a bundle of those fields and _withCaret
  // swaps it in, runs the primary's own code, and saves the bundle back. The
  // cost of the swap is a few dozen property writes per caret per frame.
  //
  // What is per caret: position, smoothing, the smear spring, the trail,
  // the pending (Move Delay) state, a Signal Glitch burst, and the pop
  // effects a move spawns (letter pop, pixel trail, disintegration, jump
  // trail). What stays global: the blink clock (lastMoveTime - every caret
  // blinks with the primary), Speed Demon's heat, Thunderstrike, Fireworks,
  // Hot-head and Stardust, which follow the primary only.

  // Copy the caret fields out of `this` into `into` (a bundle), and back.
  // References, not clones: the bundle IS the state while it is swapped out.
  _saveCaretState(into) {
    for (const k of CARET_STATE_FIELDS) into[k] = this[k];
    return into;
  }

  _loadCaretState(from) {
    for (const k of CARET_STATE_FIELDS) this[k] = from[k];
  }

  // A bundle in the state a fresh engine has. Taken from _resetEngineState
  // itself, on a scratch object, so the two cannot drift.
  _freshCaretState() {
    const scratch = Object.create(Object.getPrototypeOf(this));
    scratch._resetEngineState();
    const out = {};
    for (const k of CARET_STATE_FIELDS) out[k] = scratch[k];
    return out;
  }

  // Run `fn` with `state` swapped into `this`, then save whatever fn did back
  // into `state` and restore the primary. Re-entrant only in the sense that
  // the primary's fields are always what is put back, whatever fn threw.
  //
  // The primary's fields are parked in a scratch bundle from a small pool
  // indexed by nesting depth, not a fresh object: with forty fields and a
  // handful of swaps per secondary per frame, allocating one each time was
  // measurable GC churn at ten carets.
  _withCaret(state, fn) {
    const depth = this._swapDepth | 0;
    const pool = this._swapPool || (this._swapPool = []);
    const saved = pool[depth] || (pool[depth] = {});
    this._saveCaretState(saved);
    const pass = this._caretPass;
    const owner = this._caretOwner;
    this._swapDepth = depth + 1;
    this._loadCaretState(state);
    this._caretPass = "secondary";
    this._caretOwner = state;
    try {
      return fn();
    } finally {
      this._saveCaretState(state);
      this._loadCaretState(saved);
      this._caretPass = pass;
      this._caretOwner = owner;
      this._swapDepth = depth;
    }
  }

  // The selection changed shape: a range was added or removed, or a different
  // one is main. Index-aligned bundles are then wrong, so every bundle - the
  // primary's included, since the range it was tracking may now be a
  // secondary and vice versa - is matched to the new ranges by document
  // position. An Alt+click that makes the new caret main is the common case:
  // the old primary's state follows its range down into the secondaries and
  // the new caret starts fresh, so nothing streaks across the page. Ranges
  // cannot cross without merging, so while the shape holds, index order does.
  rematchCaretStates(view) {
    const sel = view && view.hasFocus ? view.state.selection : null;
    const count = sel ? sel.ranges.length : 1;
    const mainIndex = sel ? sel.mainIndex : 0;
    const prev = this._selShape;
    this._selShape = { count, mainIndex };
    if (!prev || (prev.count === count && prev.mainIndex === mainIndex)) return;
    if (!sel) { this._secondaries = []; return; }

    // Candidates: the primary's live state, then every secondary bundle.
    const candidates = [{ state: this._saveCaretState({}), pos: this.lastActive ? this.lastActive.pos : null }];
    for (const c of this._secondaries) candidates.push({ state: c, pos: c.lastActive ? c.lastActive.pos : null });
    const take = (head) => {
      let best = -1, bestD = SECONDARY_MATCH_WINDOW + 1, bestCand = null;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        if (!cand || cand.pos == null) continue;
        const d = Math.abs(cand.pos - head);
        if (d < bestD) { bestD = d; best = i; bestCand = cand; }
      }
      if (!bestCand) return null;
      candidates[best] = null;
      return bestCand.state;
    };
    const main = take(sel.ranges[mainIndex].head) || this._freshCaretState();
    this._loadCaretState(main);
    const next = [];
    for (let i = 0; i < sel.ranges.length && next.length < SECONDARY_FULL_MAX; i++) {
      if (i === mainIndex) continue;
      next.push(take(sel.ranges[i].head) || this._freshCaretState());
    }
    this._secondaries = next;
  }

  // The full caret record for one secondary - what cmCaretCoords builds for
  // the primary - from its coordsAtPos geometry plus the style of the line it
  // sits on. No elementFromPoint: that is a layout hit-test per caret per
  // edit, and a column edit re-measures every caret on every keystroke. The
  // line element from domAtPos is cheap and right for everything but a
  // caret inside an inline span with its own font, which draws with the
  // line's metrics instead. Cached on the bundle the way the primary's
  // style is (doc identity + pos + a short TTL), and shared per line within
  // a frame through `lineStyles`.
  secondaryCaretRecord(view, c, state, lineStyles) {
    const doc = view.state.doc;
    const pos = c.pos;
    const now = performance.now();
    let st = state._style;
    if (!(st && st.doc === doc && st.pos === pos && (now - st.t) < 250)) {
      const win = view.dom.ownerDocument.defaultView || window;
      let lineEl = null;
      try {
        const d = view.domAtPos(pos);
        const n = d && d.node && d.node.nodeType === 3 ? d.node.parentElement : d && d.node;
        lineEl = n && n.closest ? n.closest(".cm-line") : null;
      } catch { /* fall back to the editor's own style */ }
      const key = lineEl || view.contentDOM;
      let ls = lineStyles.get(key);
      if (!ls) {
        const cs = win.getComputedStyle(key);
        const letterSpacingStr = cs.letterSpacing;
        ls = {
          textColor: cs.color || "#ffffff",
          fontSize: parseFloat(cs.fontSize) || 14,
          fontFamily: cs.fontFamily || "monospace",
          fontWeight: cs.fontWeight || "normal",
          fontStyle: cs.fontStyle || "normal",
          letterSpacing: letterSpacingStr && letterSpacingStr.endsWith("px") ? (parseFloat(letterSpacingStr) || 0) : 0,
          lineHeightStr: cs.lineHeight || "",
        };
        lineStyles.set(key, ls);
      }
      const rawChar = doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";
      let charWidth = view.defaultCharacterWidth || 8;
      if (char) {
        const m = this.measureCharWidth(char, ls.fontFamily, ls.fontSize, ls.fontWeight, ls.fontStyle);
        if (m) charWidth = m + ls.letterSpacing;
      }
      st = state._style = Object.assign({ doc, pos, t: now, char, charWidth }, ls);
    }
    let h = Math.max(4, c.bottom - c.top);
    const lh = st.lineHeightStr;
    if (lh && lh.endsWith("px")) h = parseFloat(lh);
    else if (lh && !isNaN(parseFloat(lh)) && lh !== "normal") h = st.fontSize * parseFloat(lh);
    const centerY = (c.top + c.bottom) / 2;
    const w = this.styleFor("cursorStyle") === "Line" ? this.styleFor("caretWidthPx") : st.charWidth;
    return {
      x: c.x, top: centerY - h / 2, bottom: centerY + h / 2, h, w,
      actualCharWidth: st.charWidth,
      rowLeft: null, rowRight: null,
      char: st.char, textColor: st.textColor,
      fontSize: st.fontSize, fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontStyle: st.fontStyle,
      letterSpacing: st.letterSpacing,
      focused: true, pos, assoc: c.assoc,
    };
  }

  // Per frame: measure every secondary, run the primary's update pipeline on
  // the first SECONDARY_FULL_MAX of them through their bundles, and leave the
  // rest in this.secondaryCarets for the plain line. `flags` holds the
  // Backspace/Enter/Space flags as they stood before the primary consumed
  // them, so each secondary's commitMove sees the same keystroke.
  updateSecondaryCarets(view, flags = {}) {
    const raw = this.secondaryCaretCoords(view, this._secondaries);
    const full = raw.slice(0, SECONDARY_FULL_MAX);
    // The plain line only ever draws what is on screen.
    this.secondaryCarets = raw.slice(SECONDARY_FULL_MAX).filter((c) => c.visible);
    const states = this._secondaries;
    // One bundle per range, index-aligned (secondaryCaretCoords keeps an
    // entry for an off-screen range so the alignment holds). More carets
    // than bundles means the shape changed while rematchCaretStates could
    // not see it (no focus that frame): the extras start fresh.
    while (states.length < full.length) states.push(this._freshCaretState());
    if (states.length > full.length) states.length = full.length;
    if (full.length === 0 || !view) return;
    const lineStyles = new Map();
    const primaryFlags = { del: this._deletePending, enter: this._enterPending, pop: this._popKeyPending };
    try {
      for (let i = 0; i < full.length; i++) {
        // Off the pane: updateActivePoint(null) clears the caret exactly as
        // the primary is cleared when cmCaretCoords declines to place it.
        const record = full[i].visible ? this.secondaryCaretRecord(view, full[i], states[i], lineStyles) : null;
        const c = full[i];
        this._withCaret(states[i], () => {
          this._deletePending = flags.del || 0;
          this._enterPending = flags.enter || 0;
          this._popKeyPending = flags.pop || 0;
          this.updateActivePoint(record);
          this.updateSmoothCursor();
          this.updateSmearQuad();
          this.pruneTrail();
          // The same per-frame effect calls the tick makes for the primary,
          // in the same order, each on this caret's own state.
          if (this.settings.speedDemon && this.settings.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) this.maybeSpawnHotHead();
          this.maybeSpawnStardust();
          // The tether, through this caret's own caches; merged by the tick.
          states[i]._tetherOut = this.settings.bracketTether && c.visible
            ? this.bracketTetherCoords(view, c.pos, c.empty !== false)
            : null;
        });
      }
    } finally {
      this._deletePending = primaryFlags.del;
      this._enterPending = primaryFlags.enter;
      this._popKeyPending = primaryFlags.pop;
    }
  }

  // The primary's tether segments plus every secondary's, as one list for
  // drawBracketTether; null when nobody has one.
  mergeTethers(primary) {
    let out = primary && primary.length ? primary : null;
    const states = this._secondaries;
    if (states && states.length) {
      for (const st of states) {
        const t = st._tetherOut;
        if (t && t.length) out = out ? out.concat(t) : t.slice();
      }
    }
    return out;
  }

  // The static-frame signature term for the full-effect secondaries: each
  // one's settled position and shape, plus its smear quad - the same things
  // the primary contributes, for the same reasons (see the tick).
  _secondariesSig() {
    const states = this._secondaries;
    if (!states || states.length === 0) return "";
    const parts = [];
    for (const st of states) {
      const la = st.lastActive;
      parts.push(la
        ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," + Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "")
        : "none");
      parts.push(this._withCaret(st, () => this._smearSig()));
    }
    return parts.join(";");
  }

  // Draw every full-effect secondary with the primary's own painters, and
  // return each one's damage bounds for draw() to mark after its snapshot
  // (see the note on _dirtyRaw there: a cursor's own bounds must not be in
  // the effects-only union).
  drawFullSecondaries() {
    const states = this._secondaries;
    const bounds = [];
    if (!states || states.length === 0) return bounds;
    const ctx = this.ctx;
    if (!ctx) return bounds;
    const style = this.styleFor("cursorStyle");
    for (const st of states) {
      if (!st.animActive) continue;
      this._withCaret(st, () => {
        const a = this.animActive;
        if (!a) return;
        const cb = this._cursorBounds();
        if (cb) bounds.push(cb);
        // Breathing, as in draw(): a transform round the whole caret draw.
        const breath = this.breathScale(performance.now());
        const breathing = breath < 0.999;
        if (breathing) {
          const cx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
          const cy = a.top + (a.h || 0) / 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(breath, breath);
          ctx.translate(-cx, -cy);
        }
        switch (style) {
          case "Line": this.drawGenericCaret(false); break;
          case "Underline": this.drawGenericCaret(true); break;
          case "Box": this.drawBoxCursor(); break;
        }
        if (breathing) ctx.restore();
      });
    }
    return bounds;
  }

  selectionFallbackCoords(view) {
    const doc = view ? view.dom.ownerDocument : this.canvas?.ownerDocument ?? document;
    const active = doc.activeElement;
    if (!active) return null;
    // Only text-caret input types count as editable here. Toggles, radios,
    // range sliders, colour pickers, etc. are all <input> but have no caret -
    // treating them as editable made the plugin draw a cursor on top of them
    // (visible when clicking the toggle boxes in the plugin's own settings).
    if (!isTextCaretHost(active)) return null;
    const isFormField = active.tagName === "TEXTAREA" || active.tagName === "INPUT";

    // <input>/<textarea> don't participate in window.getSelection() at all -
    // the caret lives at el.selectionStart, not in the DOM Selection API, so
    // this used to fall straight through to getBoundingClientRect() below
    // and report the same left-edge coordinate no matter where the caret
    // actually was (which is why it "stuck to the left side" in the Command
    // Palette and other search boxes). Measure the real position instead.
    if (isFormField) {
      const fieldRect = this.formFieldCaretCoords(active);
      if (fieldRect) return fieldRect;
    }

    const win = doc.defaultView || window;
    const sel = win.getSelection();
    if (sel && sel.rangeCount > 0 && sel.focusNode && active.isContentEditable) {
      const isDegenerate = (r) => !r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0);

      // Prefer measuring an actual adjacent character over a collapsed
      // point. A *collapsed* range's client rect is inconsistent across
      // browsers and often reports only the glyph's own tight font metrics
      // rather than the full rendered line-box - which is exactly what made
      // the cursor's height mismatch the browser's own (line-box-based)
      // selection highlight, and, downstream, made the character drawn
      // inside the box sit higher than the real text. A *non-collapsed*
      // one-character range renders the same way real text/selections do,
      // so its rect uses the real line-height metrics.
      const spanRect = this.adjacentCharRect(doc, sel.focusNode, sel.focusOffset);
      if (spanRect) return spanRect;

      // sel.getRangeAt(0) is always normalized to document order (start
      // before end), which isn't necessarily where the live caret is - drag
      // a selection right-to-left and the blinking caret sits at the range's
      // start, not its end. sel.focusNode/focusOffset is the actual, live,
      // direction-aware caret position.
      let range;
      try {
        range = doc.createRange();
        range.setStart(sel.focusNode, sel.focusOffset);
        range.collapse(true);
      } catch {
        range = sel.getRangeAt(0).cloneRange();
        range.collapse(true);
      }
      let rect = range.getClientRects()[0] || (range.getBoundingClientRect?.() ?? null);

      if (isDegenerate(rect)) {
        // Blank lines often have no text node for the range to measure -
        // there's simply nothing there to produce a client rect. Rather than
        // mutating the document to force one (risky in a third-party editor
        // we don't own, e.g. it could confuse its own input handling), climb
        // from the range's container to its nearest element - i.e. that
        // line's own wrapper - and use its rect instead. This keeps the
        // caret at the correct line and left edge without touching the DOM.
        let node = range.startContainer;
        let lineEl = node.nodeType === 1 ? node : node.parentElement;
        // Skip past the direct wrapper if it's the entire editable surface
        // itself (e.g. a fully empty editor) - that's handled by the
        // size-clamped fallback further down instead.
        if (lineEl && lineEl !== active) {
          const lineRect = lineEl.getBoundingClientRect();
          if (!isDegenerate(lineRect)) rect = lineRect;
        }
      }

      if (!isDegenerate(rect)) {
        return { left: rect.left, top: rect.top, bottom: rect.bottom || rect.top + rect.height };
      }
    }

    // No usable in-place caret rect. Only fall back to the focused element's
    // own bounding box when it's small enough to plausibly BE a single-line
    // caret host (e.g. a compact rename/edit box) - never for a large
    // multi-line surface like a full code editor, where that produces a
    // cursor that's as tall as the entire view.
    const rect = active.getBoundingClientRect();
    if (!rect) return null;
    const style = win.getComputedStyle(active);
    const approxLineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
    if (rect.height > approxLineHeight * 3) return null;
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  }

  // Measures a real, rendered one-character span next to the caret (rather
  // than a collapsed point) so the resulting rect uses the browser's actual
  // line-box metrics - the same metrics it uses to paint text and selection
  // highlights - instead of a font's tight glyph metrics.
  adjacentCharRect(doc, node, offset) {
    if (!node || node.nodeType !== 3) return null;
    const text = node.data || "";
    const isDegenerate = (r) => !r || (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0);

    // The horizontal comes from a COLLAPSED range at the caret itself, and
    // only the vertical from the character next to it.
    //
    // "The caret sits after this character, so anchor to its right edge" is
    // true in LTR and exactly backwards in RTL, where after means to the
    // left - and in bidi text neither is decidable from the offset alone,
    // because which side of a glyph an offset falls on is a property of the
    // run's resolved level. The same issue as #28 and the same shape: a
    // position inferred from a direction we assumed rather than measured.
    // Measured at a character's full width of error on every RTL offset in a
    // contentEditable - the tab-title rename box is one of these.
    //
    // A collapsed range is the engine's own answer and needs no assumption.
    // It is only its HEIGHT that could not be trusted, which is what this
    // function exists to fix and what the one-character rect still supplies.
    let caretX = null;
    try {
      const c = doc.createRange();
      c.setStart(node, offset);
      c.collapse(true);
      const cr = c.getClientRects()[0] || c.getBoundingClientRect();
      if (!isDegenerate(cr)) caretX = cr.left;
    } catch {
      /* no collapsed rect here - fall back to the character edges below */
    }

    try {
      if (offset < text.length) {
        const r = doc.createRange();
        r.setStart(node, offset);
        r.setEnd(node, offset + 1);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX ?? rect.left, top: rect.top, bottom: rect.bottom };
      }
      if (offset > 0) {
        const r = doc.createRange();
        r.setStart(node, offset - 1);
        r.setEnd(node, offset);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX ?? rect.right, top: rect.top, bottom: rect.bottom };
      }
    } catch {
      /* fall through to the collapsed-range approach */
    }
    return null;
  }

  // Measures where the caret actually sits inside an <input>/<textarea> by
  // mirroring the field's text (up to selectionStart) into an offscreen
  // element with identical font/box metrics, then reading the position of a
  // marker placed at the caret. This is the standard technique for this
  // problem since native form fields expose no coordinate API for the caret.
  formFieldCaretCoords(el) {
    try {
      const doc = el.ownerDocument;
      const win = doc.defaultView || window;
      const style = win.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isTextarea = el.tagName === "TEXTAREA";
      const value = el.value != null ? String(el.value) : "";
      let selStart = value.length;
      try {
        const s = el.selectionStart, e = el.selectionEnd;
        if (typeof s === "number" && typeof e === "number") {
          // The live caret sits at whichever end of the selection is the
          // "focus" - the end that moves while dragging. For a
          // backward-dragged selection that's selectionStart; otherwise
          // (forward, or no selection at all) it's selectionEnd.
          selStart = el.selectionDirection === "backward" ? s : e;
        }
      } catch {
        /* some input types (color, number, etc.) throw - just use the end */
      }

      let mirror = this._formMirror;
      if (!mirror || mirror.ownerDocument !== doc) {
        mirror?.remove();
        mirror = doc.body.createDiv({ attr: { "aria-hidden": "true" } });
        // Inline on purpose: this is a measuring element that has to be
        // invisible and out of flow in whatever document the field is in,
        // stylesheet or no stylesheet.
        mirror.setCssStyles({
          position: "absolute", visibility: "hidden", top: "0", left: "0",
          zIndex: "-1", pointerEvents: "none",
        });
        this._formMirror = mirror;
      }

      // Anything that moves a glyph horizontally has to be on this list. The
      // marker's offset is measured from the mirror's own left edge, so a
      // property the mirror does not know about lays the text out somewhere
      // the real field does not put it, and the caret lands there.
      //
      // textAlign was the one that got away. A right-aligned number field -
      // Word-Smith's goal target cells are exactly this - lays its text flush
      // against the far edge while the mirror, defaulting to left, measured
      // from the near one. On a 160px cell that is the full width of the box
      // in error: measured at 135px, with the caret drawn at the left of a
      // number sitting at the right. direction is here for the same reason,
      // one step further out.
      //
      // unicodeBidi is one step further out again, and it is the one that
      // matters in Obsidian specifically: app.css carries a bare
      // `input { unicode-bidi: plaintext }`, so EVERY field in the app - Quick
      // Switcher, Command Palette, Search, every settings box - takes its
      // direction from its own content rather than from `direction`. Type
      // Arabic and the real field flips to RTL and lays the text flush right,
      // while the mirror, still a plain LTR paragraph, laid it flush left and
      // put the marker at the run's far end. That is issue #28: a caret near
      // the left edge of the box, hundreds of pixels from the text, tracking
      // the text's WIDTH instead of its position.
      const props = [
        "height",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight",
        "fontFamily", "letterSpacing", "textIndent", "textTransform", "wordSpacing", "tabSize",
        "textAlign", "direction", "unicodeBidi",
      ];
      for (const p of props) mirror.style[p] = style[p];

      // The four border widths above are inert without this. `border-style`
      // defaults to `none`, which computes every width back to 0px, so the
      // mirror's content box sat one border-width inside the field's and every
      // measurement came back short by exactly that. It reads as a ~1px noise
      // floor on a 1px border and scales with whatever the theme uses.
      mirror.setCssStyles({ borderStyle: "solid" });

      // boxSizing and width used to be copied straight across, and that only
      // works while the text is left-aligned. Under border-box the copied
      // width is the field's OUTER width, so the mirror lays out over a
      // content box wider than the real one by its padding and border - which
      // shifts nothing when measuring from the left edge and shifts everything
      // once the alignment measures from the right or the centre. It also made
      // a textarea wrap at the wrong column.
      //
      // clientWidth is content + padding and excludes both the border and any
      // scrollbar, so this is the true content width in every box-sizing mode.
      const padL = parseFloat(style.paddingLeft) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      mirror.setCssStyles({
        boxSizing: "content-box",
        width: Math.max(0, (el.clientWidth || 0) - padL - padR) + "px",
        whiteSpace: isTextarea ? "pre-wrap" : "pre",
        wordWrap: isTextarea ? "break-word" : "normal",
        overflow: "hidden",
      });
      if (!isTextarea) mirror.setCssStyles({ height: "auto" });

      // The text AFTER the caret has to be in the box too, and for two
      // separate reasons.
      //
      // Under `plaintext` the paragraph direction is the first STRONG
      // character of the content, so a prefix that has none - the caret at 0,
      // or a value that opens with digits - resolves LTR while the real field,
      // reading the whole value, resolves RTL. The mirror has to see the same
      // string to reach the same answer.
      //
      // And it was wrong without any bidi at all: in a right-aligned or
      // centred field the line is placed from the full text's width, so a
      // prefix on its own sits somewhere the real one does not. Prefix-only
      // put a mid-text caret in a right-aligned field at the far edge, 30px
      // out on a 260px box.
      mirror.textContent = "";
      mirror.appendChild(doc.createTextNode(value.substring(0, selStart)));
      const marker = mirror.createSpan();
      // Zero-width inline-block, not a zero-width SPACE. U+200B is bidi class
      // BN, which UAX#9 deletes outright and leaves the engine to place: next
      // to a digit run inside an RTL paragraph it lands with the digits rather
      // than at the caret, 17px out. An atomic inline is U+FFFC to the
      // algorithm - an ordinary neutral, resolved against the paragraph level.
      //
      // verticalAlign is not decoration. An EMPTY inline-block's baseline is
      // its own bottom margin edge, so left alone it hangs at the text
      // baseline - 16px below the line on a 22px line box. That is invisible
      // to an <input>, which takes its Y from the field's own box, and most of
      // a line of drop on every <textarea>, which takes its Y from offsetY.
      // Aligning to `top` pins it to the line box top, which is also where a
      // caret of `height = lineHeight` should start - the ZWSP sat half the
      // leading below it and overshot the bottom by the same.
      marker.setCssStyles({ display: "inline-block", width: "0", verticalAlign: "top" });
      mirror.appendChild(doc.createTextNode(value.substring(selStart)));

      const markerRect = marker.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();
      const offsetX = markerRect.left - mirrorRect.left;
      const offsetY = markerRect.top - mirrorRect.top;

      const scrollLeft = el.scrollLeft || 0;
      const scrollTop = el.scrollTop || 0;
      const fontSize = parseFloat(style.fontSize) || 14;
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2 || 16;

      const left = rect.left + offsetX - scrollLeft;

      let top, height;
      if (isTextarea) {
        top = rect.top + offsetY - scrollTop;
        height = lineHeight;
      } else {
        // Single-line <input> elements vertically center their text within
        // their own box using internal UA rendering, not plain CSS line-box
        // layout - a mirror <div> doesn't reproduce that centering exactly,
        // which is what made the cursor sit off-center vertically. Anchor to
        // the input's own box center instead of the mirror's Y offset.
        height = Math.min(lineHeight, rect.height) || fontSize * 1.2;
        top = rect.top + (rect.height - height) / 2;
      }

      // Clamp to the field's own box so a caret scrolled out of view (long
      // single-line input, caret past the visible edge) doesn't draw outside it.
      const clampedLeft = Math.min(Math.max(left, rect.left), rect.right);
      const clampedTop = Math.min(Math.max(top, rect.top), rect.bottom - 1);

      return { left: clampedLeft, top: clampedTop, bottom: clampedTop + height };
    } catch {
      return null;
    }
  }

  // Caret info for editable elements outside the note editor entirely -
  // file-tree rename input, Command Palette / Quick Switcher, Settings text
  // fields, other plugins' modals, etc. There's no CodeMirror here, so we
  // don't have real glyph metrics; approximate them from the focused
  // element's own computed style instead.
  // Stable opaque id for a DOM node, so a caret's location can be compared
  // across frames without holding a reference that would keep a detached node
  // alive (WeakMap - entries vanish with the node).
  _nodeKey(node) {
    if (!node) return "0";
    if (!this._nodeIds) {
      this._nodeIds = new WeakMap();
      this._nodeIdSeq = 0;
    }
    let id = this._nodeIds.get(node);
    if (id === undefined) {
      id = ++this._nodeIdSeq;
      this._nodeIds.set(node, id);
    }
    return String(id);
  }

  // "Where is the caret", for a field that has no CodeMirror document. Two
  // frames reporting the same value mean the caret did not logically move, so
  // any change in its screen coordinates was a scroll or a layout shift.
  //
  // Deliberately built from the caret's position WITHIN its field, never from
  // its coordinates - coordinates are the very thing being tested against.
  genericCaretPos(active, doc) {
    try {
      const el = this._nodeKey(active);
      if (active.tagName === "TEXTAREA" || active.tagName === "INPUT") {
        // Form fields keep their caret in selectionStart, outside the DOM
        // Selection API entirely.
        return el + ":" + (active.selectionStart ?? 0) + ":" + (active.selectionEnd ?? 0);
      }
      const win = (doc && doc.defaultView) || window;
      const sel = win.getSelection();
      if (sel && sel.focusNode) {
        return el + ":" + this._nodeKey(sel.focusNode) + ":" + sel.focusOffset;
      }
      return el + ":0";
    } catch {
      // null keeps the old behaviour (every shift treated as a move) rather
      // than risking a wrong match that would swallow a real caret move.
      return null;
    }
  }

  genericCaretCoords() {
    try {
      // Note Editor Only. This function IS the interface caret: every surface
      // it serves - Command Palette, Quick Switcher, Search, Settings, modals,
      // the tab-title rename box - is by construction not the note editor,
      // because caretCoords() only reaches here when CodeMirror does not have
      // focus. So the whole option is one early return, and its other half -
      // leaving the native caret alone in those same places - falls out of
      // hideNativeActive() instead of being a second list to keep in step.
      if (this.settings.noteEditorOnly) return null;

      // Follow the canvas's document rather than hardcoding the main
      // window's - the canvas migrates to whichever window hosts the
      // active view, so this keeps interface carets working in pop-outs.
      const doc = this.canvas?.ownerDocument ?? document;
      const active = doc.activeElement;
      // See isTextCaretHost: this excludes checkboxes, radios, sliders, etc.
      // so the plugin doesn't draw a cursor on top of Obsidian's own toggle
      // controls when they gain focus (e.g. clicking a setting toggle box).
      if (!isTextCaretHost(active)) return null;

      // Plugins that draw their own caret onto a transformed surface. See
      // isExcalidrawCaretHost for why measuring one is not merely redundant
      // but actively wrong. Returning null here (rather than gating further
      // down) keeps the whole thing off the CodeMirror path, which never
      // reaches this function at all.
      if (this.isExcalidrawCaretHost(active)) return null;

      const c = this.selectionFallbackCoords(null);
      if (!c) return null;

      const win = doc.defaultView || window;

      // Sample the actual element under the caret rather than just the
      // editable container's own style, so syntax-highlighted text (e.g. in
      // other CodeMirror-based plugins like a CSS editor) reports its own
      // real color instead of one flat container color.
      const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
      const sampleY = (c.top + c.bottom) / 2;
      const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
      const styleSource = elAtCaret && active.contains?.(elAtCaret) ? elAtCaret : active;
      const style = win.getComputedStyle(styleSource);

      const fontSize = parseFloat(style.fontSize) || 14;
      const fontFamily = style.fontFamily || "inherit";
      const char = this.genericCaretChar(active);

      // Generic inputs aren't fixed-width like the note editor, so there's
      // no single "character width" to assume - measure the actual glyph
      // under the caret with a canvas (accurate for proportional fonts,
      // unlike a flat fontSize-based guess). Falls back to an estimate only
      // when there's no character to measure (end of text, blank line).
      const measured = char
        ? this.measureCharWidth(char, fontFamily, fontSize, style.fontWeight, style.fontStyle)
        : null;
      const charWidth = measured || Math.max(4, fontSize * 0.55);
      const height = Math.max(4, (c.bottom - c.top) || fontSize * 1.2);

      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.styleFor("caretWidthPx");
      }

      return {
        x: c.left,
        top: c.top,
        bottom: c.top + height,
        h: height,
        w: finalWidth,
        actualCharWidth: charWidth,
        // No line-element geometry on this path (plain textarea /
        // contenteditable); null means "unknown", and Hot-head falls back to
        // burning around the caret without clamping.
        rowLeft: null, rowRight: null,
        char,
        textColor: style.color || "#ffffff",
        fontSize,
        fontFamily,
        fontWeight: style.fontWeight || "normal",
        fontStyle: style.fontStyle || "normal",
        // Generic inputs don't fold letter-spacing into the box width, so the
        // glyph is centered on its own advance directly.
        letterSpacing: 0,
        focused: true,
        // Logical identity of this caret, standing in for the document
        // position CodeMirror provides and a plain input doesn't.
        //
        // This used to be hardcoded null, which failed the `caret.pos !== null`
        // test in updateActivePoint and so disqualified every interface caret
        // from the scroll-shift path. Scrolling a Settings pane moves the
        // field on screen without moving the caret within it, but with no
        // identity to compare, each scrolled pixel looked like a genuine caret
        // move and went through commitMove() - pushing a trail point at every
        // step, which is why scrolling smeared a trail up and down the panel.
        // With a real identity, a pure scroll is recognised as one and the
        // cursor is translated instantly instead (no trail, no smear wiggle).
        pos: this.genericCaretPos(active, doc),
      };
    } catch {
      return null;
    }
  }

  // Measures the real rendered width of a single character in a given font,
  // used to size the Box/Underline cursor accurately for proportional
  // (non-monospace) fonts - a flat fontSize-based guess consistently under-
  // or over-shoots for anything but a true monospace font. Weight and style
  // matter: a bold glyph is meaningfully wider than its regular counterpart,
  // and measuring without them left the box visibly too narrow on bold or
  // italic text.
  // Build a canvas ctx.font string from resolved CSS font values. This lives
  // in ONE place on purpose: the character-in-box drift bug came from
  // drawBoxCursor building this string WITHOUT weight/style while
  // measureCharWidth built it WITH them - so the box was sized for a
  // bold/italic glyph and a regular upright one was drawn inside it. Every
  // site that measures OR draws a glyph must route through here so the two can
  // never diverge again.
  fontString(fontSize, fontFamily, fontWeight, fontStyle) {
    const w = fontWeight && fontWeight !== "normal" ? fontWeight + " " : "";
    const s = fontStyle && fontStyle !== "normal" ? fontStyle + " " : "";
    return `${s}${w}${fontSize}px ${fontFamily}`;
  }

  measureCharWidth(char, fontFamily, fontSize, fontWeight, fontStyle) {
    try {
      // Detached, and in no particular window: a measuring context only
      // needs the fonts, which every window of the process shares.
      const ctx = this._measureCtx || (this._measureCtx = createEl("canvas").getContext("2d"));
      if (!ctx) return null;
      ctx.font = this.fontString(fontSize, fontFamily, fontWeight, fontStyle);
      const w = ctx.measureText(char).width;
      return w > 0 ? w : null;
    } catch {
      return null;
    }
  }

  // The character sitting immediately after the caret, for elements outside
  // the note editor - mirrors what cmCaretCoords does for CodeMirror. Used
  // to draw the "letter inside the cursor" effect in non-editor fields too.
  genericCaretChar(active) {
    try {
      if (active.tagName === "INPUT" || active.tagName === "TEXTAREA") {
        const value = active.value != null ? String(active.value) : "";
        let selStart = value.length;
        try {
          const s = active.selectionStart, e = active.selectionEnd;
          if (typeof s === "number" && typeof e === "number") {
            selStart = active.selectionDirection === "backward" ? s : e;
          }
        } catch {
          /* input types without selectionStart support */
        }
        const ch = value.charAt(selStart);
        return ch && ch !== "\n" ? ch : "";
      }

      if (active.isContentEditable) {
        const doc = active.ownerDocument;
        const win = doc.defaultView || window;
        const sel = win.getSelection();
        if (sel && sel.focusNode && sel.focusNode.nodeType === 3) {
          const text = sel.focusNode.data || "";
          const ch = text.charAt(sel.focusOffset);
          return ch && ch !== "\n" ? ch : "";
        }
      }
    } catch {
      /* fall through */
    }
    return "";
  }

  resolveHoldChar(newCaret) {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (
        view &&
        typeof newCaret.pos === "number" &&
        typeof this.lastActive?.pos === "number" &&
        newCaret.pos > this.lastActive.pos
      ) {
        const justTyped = view.state.doc.sliceString(newCaret.pos - 1, newCaret.pos);
        if (justTyped && justTyped !== "\n") {
          // Both gates, in the same shape Thunderstrike and Fireworks use:
          // the group's master toggle, then the effect's own.
          if (this.settings.popEffects && this.settings.popLetters) {
            this.spawnLetterParticle(justTyped, this.lastActive);
          }
          return justTyped;
        }
      }
    } catch {
      /* fall through */
    }
    return this.lastActive ? this.lastActive.char : "";
  }

  // With no argument this is the primary and measures itself. A secondary
  // hands its own record in, with its state bundle swapped into `this`
  // (see _withCaret), and everything below then runs for that caret.
  updateActivePoint(caret = this.caretCoords()) {
    if (!caret || !caret.focused) {
      this.lastActive = null;
      this.pending = null;
      return;
    }

    if (!this.lastActive) {
      this.lastActive = caret;
      this.pending = null;
      return;
    }

    const moved =
      Math.abs(this.lastActive.x - caret.x) > 0.5 || Math.abs(this.lastActive.top - caret.top) > 0.5;

    if (!moved) {
      if (!this.pending) this.lastActive = caret;
      return;
    }

    // Same doc position AND same assoc = the caret didn't logically move, so
    // any coordinate delta is a scroll/layout shift. If assoc differs, the
    // cursor hopped across a soft-wrap boundary (end of one visual row ->
    // start of the next) at the same position - that's a genuine move and
    // must go through the normal commit path (trails, smear, smoothing).
    if (caret.pos !== null && caret.pos === this.lastActive.pos && caret.assoc === this.lastActive.assoc) {
      const dx = caret.x - this.lastActive.x;
      const dy = caret.top - this.lastActive.top;
      
      this.lastActive = caret;
      
      // If the coordinate changed but the document position didn't, it was a scroll/layout shift.
      // We instantly shift the animation and spring physics to prevent the smear wiggle.
      if (this.animActive && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
        this.animActive.x += dx;
        this.animActive.top += dy;
        this.animActive.w = caret.w;
        this.animActive.h = caret.h;
        
        if (this.smearQuad) {
          for (const key in this.smearQuad) {
            this.smearQuad[key].x += dx;
            this.smearQuad[key].y += dy;
          }
          // The tapered copy is rebuilt from the quad every frame, but a draw
          // can land between this shift and the next rebuild - so shift it too,
          // or the smear jumps back to its pre-scroll place for one frame.
          // Only when it IS a copy: untapered it's the same object, already
          // shifted by the loop above.
          if (this.smearShape && this.smearShape !== this.smearQuad) {
            for (const key in this.smearShape) {
              this.smearShape[key].x += dx;
              this.smearShape[key].y += dy;
            }
          }
          if (this.smearCenterPrev) {
            this.smearCenterPrev.x += dx;
            this.smearCenterPrev.y += dy;
          }
        }

        // Carry the trail along too. It's an echo of where the caret just
        // was in the text, so it belongs to the content and should scroll
        // with it; left in place it detaches from the cursor and hangs in
        // the old spot until it fades. (Particles and flame pixels are
        // deliberately NOT shifted - those are thrown into the air and read
        // correctly as staying put.)
        if (this.trail.length) {
          for (const p of this.trail) {
            p.x += dx;
            p.y += dy;
          }
        }
      }
      return;
    }

    const delay = Math.max(0, Math.round(this.settings.moveDelayMs));
    if (delay <= 0) {
      const holdChar = this.resolveHoldChar(caret);
      this.commitMove(caret);
      if (holdChar && this.lastActive) this.lastActive.holdChar = holdChar;
      return;
    }

    const pending = this.pending;
    if (!pending || pending.caret.x !== caret.x || pending.caret.top !== caret.top) {
      this.pending = { caret, since: performance.now(), holdChar: this.resolveHoldChar(caret) };
    } else if (performance.now() - pending.since >= delay) {
      this.commitMove(pending.caret);
    }
  }

  updateSmoothCursor() {
    if (!this.lastActive) {
      this.animActive = null;
      this._smoothMoving = false;
      this._smoothLastT = 0;
      this._catchUpBoost = 1;
      this._typingBoostSm = null;
      return;
    }

    if (!this.settings.smoothEnabled) {
      // Pinned straight to the target every frame: never "in motion" as far
      // as the frame governor is concerned.
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
      this._catchUpBoost = 1;
      this._typingBoostSm = null;
      return;
    }

    if (!this.animActive) {
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
    }

    const now = performance.now();

    // Frame delta in seconds, clamped so a background-tab hiccup doesn't
    // teleport the cursor. This is the core fix for "smooth does nothing":
    // the old code applied a fixed per-FRAME lerp of
    // targetSpeed * (1 - smoothness), i.e. ~0.47 per frame at defaults -
    // the cursor closed >90% of the gap within 3 frames (~50 ms at 60 Hz,
    // ~25 ms at 120 Hz), which is visually indistinguishable from off.
    let dt = (now - (this._smoothLastT || now)) / 1000;
    this._smoothLastT = now;
    dt = Math.max(0.001, Math.min(dt, 0.05));

    let targetSpeed = this.settings.catchUpSpeed;
    let typingBoost = 1;

    if (this.settings.smoothAdaptive) {
      const timeSinceMove = now - this.lastMoveTime;
      const maxMod = this.settings.maxCatchUpSpeed / Math.max(0.01, this.settings.catchUpSpeed);
      if (timeSinceMove < 150) {
        // Reach the cap after ~0.12 s of sustained input. Slower ramps feel
        // nice for a single keypress but let the cursor fall several glyphs
        // behind on key repeat before the speed-up ever kicks in.
        this.typingSpeedMod = Math.min(this.typingSpeedMod + (maxMod - 1) * 8 * dt, maxMod);
      } else {
        this.typingSpeedMod = Math.max(this.typingSpeedMod - (maxMod - 1) * 2 * dt, 1);
      }
      targetSpeed = Math.min(this.settings.maxCatchUpSpeed, targetSpeed * this.typingSpeedMod);

      // Backlog drain: during sustained input (key repeat, held arrows), if
      // the animated cursor has fallen more than ~one glyph behind the real
      // one, scale the rate up with the deficit so the lag stays around a
      // character instead of accumulating. Gated on timeSinceMove so a
      // single long jump (mouse click across the note) still animates at
      // the user's configured speed.
      if (timeSinceMove < 150) {
        const cw = Math.max(4, this.lastActive.actualCharWidth || 8);
        const dist = Math.hypot(
          this.lastActive.x - this.animActive.x,
          this.lastActive.top - this.animActive.top
        );
        const backlogChars = Math.max(0, dist / cw - 1);
        typingBoost = 1 + Math.min(3, backlogChars);
      }
    }

    // Low-pass the boost before anything uses it.
    //
    // The backlog drain is measured from the INSTANTANEOUS gap between the
    // real caret and the animated one, and that gap is inherently spiky: it
    // jumps on the frame a key lands and shrinks on the frames between. Under
    // steady typing it settles into a sawtooth - measured, alternating
    // between 1.55 and 2.04 every frame, locked to the keystroke cadence.
    //
    // That was fine as long as it only nudged a lerp, but this value is also
    // published to Motion Smear, which uses it as a multiplier on its SPRING
    // STIFFNESS. A spring whose constant flickers by 25% every frame does not
    // settle smoothly; it pulses, and the pulse is exactly the stutter people
    // see when Smooth Movement and Motion Smear are both on. With either one
    // off the sawtooth is either never computed or never consumed, which is
    // why it only shows up together.
    //
    // Smoothed on a time constant rather than a fixed per-frame fraction, so
    // the damping is the same at 60, 120 and 144Hz.
    const boostK = 1 - Math.exp(-CATCHUP_BOOST_RATE * dt);
    this._typingBoostSm = this._typingBoostSm == null
      ? typingBoost
      : this._typingBoostSm + (typingBoost - this._typingBoostSm) * boostK;
    typingBoost = this._typingBoostSm;

    // Exponential approach with a time constant, so the feel is identical at
    // 60/120/144 Hz. RATE_SCALE maps the existing setting ranges
    // (catchUpSpeed 0.30-0.80, smoothness 0.05-0.30) onto visible settle
    // times of roughly 100-360 ms to 95% of the way there for single moves;
    // the adaptive typingBoost can multiply that by up to 4x under sustained
    // typing so the cursor keeps pace with key repeat.
    const RATE_SCALE = 40;
    const rate = Math.max(0.5, targetSpeed * (1 - this.settings.smoothness) * RATE_SCALE * typingBoost);
    // How much faster than the configured Catch-Up Speed this frame is actually
    // running - the adaptive ramp and the backlog drain combined. Published
    // because Motion Smear's spring sits downstream of this lerp and has to be
    // told to speed up with it; see the note in updateSmearQuad.
    this._catchUpBoost = (targetSpeed / Math.max(0.01, this.settings.catchUpSpeed)) * typingBoost;
    const lerpFactor = 1 - Math.exp(-rate * dt);

    this.animActive.x += (this.lastActive.x - this.animActive.x) * lerpFactor;
    this.animActive.top += (this.lastActive.top - this.animActive.top) * lerpFactor;
    this.animActive.w += (this.lastActive.w - this.animActive.w) * lerpFactor;
    this.animActive.h += (this.lastActive.h - this.animActive.h) * lerpFactor;

    // Snap when essentially arrived - avoids an endless sub-pixel tail that
    // keeps the canvas repainting and makes the blink-hold logic think the
    // cursor is still moving.
    //
    // The result is published as _smoothMoving, which is what the frame
    // governor reads. It must NOT test `!!this.animActive` instead: animActive
    // is the interpolated cursor snapshot, not an in-flight flag, and it is
    // non-null for as long as a caret exists at all. Testing its truthiness
    // pinned `animating` (and therefore the hot gear) on permanently, which
    // made the warm/idle gears and the whole draw-skip path below unreachable.
    // Size counts as arrival too, not just position.
    //
    // This tested x/top only and then SNAPPED w and h to the target. Normally
    // harmless, because all four lerp at the same rate and land together. But
    // when position barely changes while size does - the line under the caret
    // becoming a heading, an embed resizing the row - x and top arrive on the
    // first frame, `arrived` fires, and the height is snapped the whole way
    // in one go. Measured, a 24 -> 60 change popped 36px in a single frame,
    // with _smoothMoving already false so the frame governor never even
    // counted it as motion.
    const arrived =
      Math.abs(this.lastActive.x - this.animActive.x) < 0.25 &&
      Math.abs(this.lastActive.top - this.animActive.top) < 0.25 &&
      Math.abs(this.lastActive.w - this.animActive.w) < 0.25 &&
      Math.abs(this.lastActive.h - this.animActive.h) < 0.25;
    if (arrived) {
      this.animActive.x = this.lastActive.x;
      this.animActive.top = this.lastActive.top;
      this.animActive.w = this.lastActive.w;
      this.animActive.h = this.lastActive.h;
    }
    this._smoothMoving = !arrived;
    
    this.animActive.textColor = this.lastActive.textColor;
    this.animActive.char = this.lastActive.char;
    this.animActive.holdChar = this.lastActive.holdChar;
    this.animActive.actualCharWidth = this.lastActive.actualCharWidth;
    this.animActive.fontFamily = this.lastActive.fontFamily;
    this.animActive.fontSize = this.lastActive.fontSize;
    // Weight/style/letter-spacing must refresh here alongside the other look
    // fields: animActive is created once (by spread) and then reused across a
    // whole smooth glide, so without this a box gliding from regular text onto
    // a bold heading would keep drawing the glyph in the OLD weight until the
    // glide ended - the same slimmer/fatter mismatch we just fixed, only
    // intermittent and motion-triggered.
    this.animActive.fontWeight = this.lastActive.fontWeight;
    this.animActive.fontStyle = this.lastActive.fontStyle;
    this.animActive.letterSpacing = this.lastActive.letterSpacing;
    // Same reasoning again, and the reason Hot-head's fire vanished on some
    // lines: animActive is spread once and reused for the whole glide, so the
    // row extent stayed frozen at whatever line the caret happened to be on
    // when animActive was first built. Hot-head clamps fire to that extent, so
    // on any line whose text didn't overlap the stale one, every particle was
    // dropped and no fire appeared at all.
    this.animActive.rowLeft = this.lastActive.rowLeft;
    this.animActive.rowRight = this.lastActive.rowRight;
  }

  commitMove(caret) {
    // A secondary caret (see _withCaret) gets everything here - trail,
    // disintegration, jump trail, glitch, strike and volley; the tick hands
    // it the frame's Enter/Space/Backspace flags before the primary's own
    // commit zeroes them - except heat, which is one gauge for the whole
    // editor and is fed by the primary's moves alone, and except CLEARING
    // those flags, which is the primary's job.
    const secondary = this._caretPass === "secondary";
    // Speed Demon: a caret move that no heat-bumping keystroke accounts for -
    // a mouse click, a Vim motion from another plugin, a jump to a search hit -
    // still represents the user going somewhere, so it heats too. Scaled by how
    // far the caret actually travelled and capped, so a click two characters
    // over is a nudge and a leap across the file is a real bump, but neither
    // can slam the cursor to white-hot in one go. Keyboard-driven moves are
    // skipped here because onKeyDown already charged them.
    if (this.settings.speedDemon && this.lastActive && caret && !secondary) {
      const keyed = this._heatKeyT && performance.now() - this._heatKeyT < 150;
      if (!keyed) {
        const dist = Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top);
        const bump = Math.min(0.12, dist / 900) * (this.settings.speedDemonSensitivity ?? 1);
        this.heat = Math.min(1, this.heat + bump);
      }
    }
    // Record the position being left, and - if this move is a jump - the ghosts
    // bridging it to the destination, so the CRT/neon trail is continuous across
    // the leap the same commit it happens rather than one move later.
    this.pushTrail(this.lastActive, caret);
    if (this.lastActive) {
      // Consume a pending Backspace/Delete keystroke if it happened
      // recently enough to plausibly be the cause of this caret move.
      // 250ms covers slow input pipelines but not so long that unrelated
      // caret motion (mouse click, arrow keys) inherits the deletion look.
      const now = performance.now();
      // Both gates, like every other pop effect: the group, then the option.
      // Pixel Trail is deliberately absent - a deletion burst no longer needs
      // the ambient trail to be switched on.
      const disintegrate = !!(
        this.settings.popEffects &&
        this.settings.backspaceDisintegrate &&
        this._deletePending &&
        now - this._deletePending < 250);
      this.spawnFlamePixels(this.lastActive, disintegrate);
      // Trail On Jump: if this move was a genuine leap (not typing/arrowing) and
      // wasn't a deletion burst, lay puffs along the path the caret skipped so a
      // jump leaves a streak rather than a lone puff at the origin. Uses `caret`
      // (destination) and `lastActive` (origin) to span the gap.
      if (this.settings.flameTrailOnJump && !disintegrate) {
        this.spawnJumpTrail(this.lastActive, caret);
      }
      this._deletePending = 0;
      // Signal Glitch fires on the same "is this a jump?" test the trail uses,
      // so the two features agree on what counts as a leap. Deliberately NOT
      // gated on `disintegrate`: a Backspace that happens to jump the caret
      // across a wrap is still a jump visually. Placed before the thunderbolt
      // so an Enter-driven strike and a glitch can coexist on the same move.
      if (this.settings.crtEffect && this.settings.crtGlitch) {
        this.spawnGlitch(this.lastActive, caret);
      }
      // Hot-Head, same test again: a jump puts the caret in fire for a moment
      // (the "engulfed" state maybeSpawnHotHead feeds). Decided here, on the
      // committed move, rather than from the drawn caret's travel: with
      // Smooth Movement the drawn caret eases across a jump and never covers
      // JUMP_TRAIL_MIN_DIST in one frame, and a scroll shift - which does -
      // has already been filtered out above this block.
      if (this.styleFor("hotHead")
          && Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top) >= JUMP_TRAIL_MIN_DIST) {
        this._hotEngulfUntil = now + HOT_ENGULF_MS;
        this._hotActiveT = now;
      }
      // Same 250ms window as the delete flag. Note the bolt is aimed at
      // `caret`, the position being moved TO, not at lastActive: the strike
      // drives the cursor down to the new line, so it has to land there.
      if (this._enterPending && now - this._enterPending < 250) {
        this.spawnThunderbolt(caret);
      }
      // Same 250ms window and the same choice of anchor: the shells climb out
      // of the caret you can see, which after a Space or an Enter is the
      // position being moved TO.
      if (this._popKeyPending && now - this._popKeyPending < 250) {
        this.spawnFireworks(caret);
      }
    }
    // Cleared unconditionally, outside the lastActive branch: a stale flag left
    // by a move that didn't spawn anything would fire a bolt on whatever caret
    // move happened to come next. The primary's job; a secondary never fires
    // them, so it must not clear them either.
    if (!secondary) {
      this._enterPending = 0;
      this._popKeyPending = 0;
    }
    this.lastActive = caret;
    this.pending = null;
    this.lastMoveTime = performance.now(); 
  }

  getActiveRect() {
    const active = this.animActive;
    if (!active) return null;
    if (this.styleFor("cursorStyle") === "Underline") {
      // Must use the same thickness the painter does. This is the rect the
      // smear spring chases, and fillCursorShape draws the smear quad INSTEAD
      // of the rect it's handed whenever smear is on - so a thickness computed
      // independently here doesn't just desync the spring, it silently becomes
      // the thickness that actually gets painted, and the slider stops doing
      // anything at all with Motion Smear enabled.
      const uThickness = this.underlineThickness(active.h);
      return { x: active.x, y: active.top + active.h - uThickness, w: active.actualCharWidth, h: uThickness };
    }
    return { x: active.x, y: active.top, w: this.renderWidth(active), h: active.h };
  }

  updateSmearQuad() {
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

    const settings = this.settings;
    const rect = settings.smear ? this.getActiveRect() : null;

    if (!rect) {
      this.smearQuad = null;
      this.smearShape = null;
      this.smearCenterPrev = null;
      this._smearMoving = false;
      return;
    }

    const targets = {
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
      bl: { x: rect.x, y: rect.y + rect.h },
    };

    if (!this.smearQuad) {
      this.smearQuad = {};
      for (const key in targets) {
        this.smearQuad[key] = { x: targets[key].x, y: targets[key].y, vx: 0, vy: 0 };
      }
      this.smearCenterPrev = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      this.smearShape = this.smearQuad;
      this._smearMoving = false;
      return;
    }

    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    let dirX = 0, dirY = 0;
    if (this.smearCenterPrev) {
      dirX = center.x - this.smearCenterPrev.x;
      dirY = center.y - this.smearCenterPrev.y;
    }
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen > 0.01) {
      dirX /= dirLen;
      dirY /= dirLen;
      // Held past the frame it was measured on: once the caret stops, the quad
      // spends several more frames catching up, and the tail has to keep
      // pointing back the way it came while it does.
      this._smearDir = { x: dirX, y: dirY };
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
    // Only the LEADING corners get it. The smear you see is the gap between the
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
    // what the 100ms idle gear delivers. That made the spring's behaviour
    // depend on the gear while the gear depended on whether the spring was
    // moving: a closed feedback loop that kicked a settled quad back into
    // motion on every idle frame, flipping the gear thousands of times a
    // minute and cycling the GPU up and down on a completely idle editor.
    // A fixed sub-step makes the spring frame-rate independent, so it behaves
    // identically in every gear and at every display refresh rate.
    const MAX_STEP = 1 / 240;
    const steps = Math.max(1, Math.min(16, Math.ceil(dt / MAX_STEP)));
    const h = dt / steps;

    let moving = false;
    for (const key in targets) {
      const c = this.smearQuad[key];
      const t = targets[key];

      // Lead or trail by the direction of travel. A fifth way of deciding this
      // was tried in 1.5.4, after smear-cursor.nvim: every corner's stiffness
      // from its distance to the target's centre, the nearest at lead, the
      // farthest at trail, the two between on a curve. Continuous, and it
      // sweeps beautifully on a fat terminal cell drawn in block characters -
      // and on a 3x24 Line stem at 5 degrees it had three corners rushing
      // and one trailing (probes/smear-angle-sweep.js: edgeSkew 60, paraErr
      // 25px, from 0 and 0), a triangular sliver rather than a lean. The
      // known twist at atan(w/h) stays (HANDOFF.md, "Motion smear"); the
      // cure is the two-rect hull described there, not a per-corner curve.
      const offX = t.x - center.x;
      const offY = t.y - center.y;
      const offLen = Math.hypot(offX, offY) || 1;
      const align = dirLen > 0.01 ? (offX / offLen) * dirX + (offY / offLen) * dirY : 0;
      const freq = align >= 0 ? freqLead : freqTrail;

      const k = freq * freq;
      const damp = 2 * dampingRatio * freq;
      for (let s = 0; s < steps; s++) {
        const ax = k * (t.x - c.x) - damp * c.vx;
        const ay = k * (t.y - c.y) - damp * c.vy;
        c.vx += ax * h;
        c.vy += ay * h;
        c.x += c.vx * h;
        c.y += c.vy * h;
      }

      if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.vx) || !isFinite(c.vy)) {
        c.x = t.x;
        c.y = t.y;
        c.vx = 0;
        c.vy = 0;
      }

      // A corner still off its target, or still carrying velocity, means the
      // quad is visibly deforming and the loop must keep drawing.
      if (
        Math.abs(c.x - t.x) > 0.5 || Math.abs(c.y - t.y) > 0.5 ||
        Math.abs(c.vx) > 0.1 || Math.abs(c.vy) > 0.1
      ) {
        moving = true;
      }
    }

    this._smearMoving = moving;

    this.applySmearMaxLength(rect);
    this.applySmearTaper(targets, center);
    this.applySmearVolume(targets, rect);
    if (moving) {
      this.smearQuadLastMoveT = now;
    } else {      // Snap exactly onto the targets once settled, and kill the residual
      // velocity. Without this the quad keeps a sub-threshold offset that the
      // next long idle frame re-amplifies into visible motion - the other half
      // of the oscillation described above. Mirrors what updateSmoothCursor
      // does for the caret itself.
      for (const key in targets) {
        const c = this.smearQuad[key];
        c.x = targets[key].x;
        c.y = targets[key].y;
        c.vx = 0;
        c.vy = 0;
      }
    }
  }

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
  applySmearMaxLength(rect) {
    const cap = this.settings.smearMaxLength;
    const q = this.smearQuad;
    if (!q || !(cap > 0)) return;
    const targets = {
      tl: { x: rect.x, y: rect.y }, tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h }, bl: { x: rect.x, y: rect.y + rect.h },
    };
    for (const k in q) {
      const c = q[k], t = targets[k];
      const dx = c.x - t.x, dy = c.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d <= cap) continue;
      const f = cap / d;
      c.x = t.x + dx * f;
      c.y = t.y + dy * f;
      // Velocity that was carrying the corner further out is spent against
      // the cap; what remains is the part along the pull back in. Without
      // this the spring keeps throwing the corner past the cap every frame
      // and it sits there jittering instead of trailing cleanly.
      const away = (c.vx * dx + c.vy * dy) / d;
      if (away > 0) { c.vx -= (dx / d) * away; c.vy -= (dy / d) * away; }
    }
  }

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
  applySmearVolume(targets, rect) {
    const shape = this.smearShape;
    const strength = Math.max(0, Math.min(1, this.settings.smearVolumeStrength ?? 0.3));
    if (!shape || !this.settings.smearConserveVolume || strength <= 0) return;
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
    const lag = {};
    for (const k in targets) {
      lag[k] = Math.hypot(targets[k].x - shape[k].x, targets[k].y - shape[k].y);
      if (lag[k] > maxLag) maxLag = lag[k];
    }
    if (maxLag < 0.01) return;
    for (const k in targets) {
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
  }

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
  applySmearTaper(targets, center) {
    const q = this.smearQuad;
    const amount = Math.max(0, Math.min(1, this.settings.smearTaperAmount ?? 0.7));
    const dir = this._smearDir;
    if (!q || !this.settings.smearTaper || amount <= 0 || !dir) {
      this.smearShape = q;
      return;
    }

    // How far each corner is lagging behind where it belongs. Corners at the
    // back of the move lag most and the ones at the front barely at all, which
    // is exactly the weighting a taper wants - the tail narrows, the leading
    // edge keeps its full width - so there's no need to work out which corner
    // is which, or to special-case diagonal movement.
    let maxLag = 0;
    const lag = {};
    for (const k in targets) {
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

    for (const k in targets) {
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
  }

  // The four corners to paint the cursor through, or null when Motion Smear is
  // off and callers should use the plain caret rect instead.
  smearCorners() {
    if (!this.settings.smear) return null;
    return this.smearShape || this.smearQuad;
  }

  // The painted quad reduced to a short string, for the draw-skip signature.
  // See the call site for why the quad has to be in that signature at all.
  _smearSig() {
    const q = this.settings.smear ? this.smearCorners() : null;
    if (!q) return "nosmear";
    let s = "";
    for (const k of ["tl", "tr", "br", "bl"]) {
      const c = q[k];
      if (!c) return "nosmear";
      s += Math.round(c.x * 2) + ":" + Math.round(c.y * 2) + ",";
    }
    return s;
  }

  // Record `point` (the position being left) as a CRT trail ghost. If `dest` is
  // given and the move from point→dest is a jump, also lay intermediate ghosts
  // along that path so the trail is a continuous streak across the leap instead
  // of two dots with a gap. `dest` itself is NOT recorded here - it becomes the
  // live caret and gets its own ghost on the next move - only the bridge between
  // them is filled.
  pushTrail(point, dest = null) {
    if (!point) return;
    const now = performance.now();
    const max = Math.max(0, Math.round(this.settings.trailLength));

    this.trail.push({ x: point.x, y: point.top, w: point.w, h: point.h, t: now });

    // Bridge a jump with a streak of intermediate ghosts. Neon only: the neon
    // tail is meant to read as the cursor zipping across the gap, but on the
    // plain CRT effect that same bridge just smears a line of ghost boxes from
    // the old spot to the click, which isn't wanted. Plain CRT still leaves its
    // normal fading ghost at the origin (pushed above) - only the across-the-gap
    // streak is dropped. Also gated on room in the trail.
    if (dest && this.settings.crtEffect && this.settings.crtNeon && max > 1) {
      const dx = dest.x - point.x;
      const dy = dest.top - point.top;
      const dist = Math.hypot(dx, dy);
      if (dist >= JUMP_TRAIL_MIN_DIST) {
        // One ghost every JUMP_TRAIL_STEP px, capped so a top-to-bottom click in
        // a huge document can't flood the trail, and never more than the trail
        // can hold so the bridge doesn't instantly evict itself.
        const steps = Math.min(
          JUMP_TRAIL_MAX_PUFFS, max, Math.floor(dist / JUMP_TRAIL_STEP)
        );
        for (let i = 1; i <= steps; i++) {
          const s = i / (steps + 1);
          // Timestamps fan slightly forward from `now` toward the destination so
          // ghosts nearer the landing read as freshest - the streak fades from
          // the origin (oldest) to where the caret now sits (newest), giving it
          // a direction rather than a uniform smear.
          this.trail.push({
            x: point.x + dx * s,
            y: point.top + dy * s,
            w: dest.w, h: dest.h,
            t: now + s * 10,
          });
        }
      }
    }

    while (this.trail.length > max) this.trail.shift();
  }

  spawnLetterParticle(char, anchor) {
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
  }

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
  flamePixelColor(baseRGB, disintegrate, forceBase = false) {
    let r, g, b;
    if (!forceBase && this.settings.flameTrailGradientColors && this.settings.gradientEnabled) {
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
  }

  spawnFlamePixels(anchor, disintegrate = false) {
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
    if (!disintegrate && !this.settings.flameTrail) return;

    // Density scales the whole burst. At 0 the trail emits nothing.
    // Disintegration is exempt from a 0 density: pressing Backspace is an
    // explicit request for the burst, not the ambient trail, so it still fires
    // (at the normal amount) even with the trail turned down to nothing - and
    // now, with the trail off altogether.
    const density = Math.max(0, this.settings.flameTrailDensity ?? 1);
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
    const lifeSec = Math.max(0.05, (this.settings.flameTrailLifeMs ?? 400) / 1000);

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
      && !!this.settings.popEffects
      && !!this.settings.popRainbow;
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
    const pxBase = Math.max(1, this.settings.flameTrailPixelSize ?? 4);

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
  }

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
  spawnGlitch(from, to) {
    if (!from || !to) return;
    const dist = Math.hypot(to.x - from.x, to.top - from.top);
    // Same threshold the jump trail uses, so "what is a jump" has one answer.
    if (dist < JUMP_TRAIL_MIN_DIST) return;

    const dur = Math.max(60, Math.min(600, this.settings.crtGlitchMs ?? 220));
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
  }

  // Resolve the live glitch into per-frame drawing parameters, or null when no
  // burst is running. Also retires an expired burst, which is what lets the
  // frame governor drop back out of the hot gear.
  glitchState(now) {
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

    const strength = Math.max(0, Math.min(2.5, this.settings.crtGlitchStrength ?? 1));
    const aberr = Math.max(0, Math.min(3, this.settings.crtGlitchAberration ?? 1));

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
  }

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
  paintGlitchRect(ctx, x, y, w, h, baseColor, alpha, gs) {
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
  }

  spawnJumpTrail(from, to) {
    if (!this.settings.flameTrail || !from || !to) return;
    const density = Math.max(0, this.settings.flameTrailDensity ?? 1);
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
    const lifeSec = Math.max(0.05, (this.settings.flameTrailLifeMs ?? 400) / 1000);
    const now = performance.now();

    // A couple of pixels per waypoint scaled by density - enough to read as a
    // streak without turning a long jump into a firehose even before the cap.
    const perPuff = Math.max(1, Math.round(2 * Math.min(1.5, density)));
    const lineH = ((from.h || 16) + (to.h || 16)) / 2;
    // Slightly smaller than the resting trail (× 0.8), as it was before this was
    // configurable, but scaling off the same slider.
    const pxBase = Math.max(1, this.settings.flameTrailPixelSize ?? 4) * 0.8;

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
  }

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
  nextRainbowHue(step = 33) {
    const hue = this._popRainbowHue;
    this._popRainbowHue = (hue + step) % 360;
    return hue;
  }

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
  fireworkSparkRGB(base) {
    const [r, g, b] = base || this.sampleRamp(Math.random());
    return [
      Math.max(0, Math.min(255, Math.round(r + (Math.random() - 0.5) * 76))),
      Math.max(0, Math.min(255, Math.round(g + (Math.random() - 0.5) * 76))),
      Math.max(0, Math.min(255, Math.round(b + (Math.random() - 0.5) * 76))),
    ];
  }

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
  _liveSparkCount() {
    let n = 0;
    for (const fw of this.fireworks) n += fw.sparks.length;
    return n;
  }

  spawnFireworks(target) {
    if (!this.settings.popEffects || !this.settings.fireworks) return;
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
    const q = Math.max(0.2, Math.min(3, this.settings.fireworksQuantity ?? 1));
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
  }

  drawFireworks() {
    if (!this.fireworks.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.settings.cursorOpacity ?? 1));
    const cell = FIREWORK_CELL;
    // Snap to the grid the effect is built on. Done at paint time rather than
    // at spawn because the positions themselves are continuous - it's the
    // painted blocks that must line up, and quantising the maths instead would
    // make the arcs step sideways as well as visually.
    const snap = (v) => Math.round(v / cell) * cell;
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
          const drawSet = (list, ox, oy, sc, alpha) => {
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
  }

  // ---- Thunderstrike -----------------------------------------------------
  // A bolt of pixelated lightning that drops out of the top of the pane onto
  // the caret's new position when Enter is pressed.
  //
  // The whole bolt - its path, its forks, the grid cells it occupies and its
  // flicker pattern - is generated ONCE here and then only faded by the
  // draw call. Regenerating the jitter per frame is the obvious way to write
  // this and it looks wrong: the channel boils rather than holds, and at 60fps
  // the noise aliases into a shimmer instead of reading as one discharge.
  spawnThunderbolt(target) {
    // Gated on the Pop Effects group, not on Pixel Trail. The bolt shares the
    // trail's particle pool for its impact sparks, but nothing about it needs
    // the trail to be switched on - and it never did; the old dependency was
    // an accident of where the toggle happened to sit in the panel.
    if (!this.settings.popEffects || !this.settings.thunderstrike) return;
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

    const cell = Math.max(1, Math.round(this.settings.thunderstrikeSize ?? 2));
    // Jitter scaled to the bolt's own length: a short strike near the top of
    // the pane and a long one from the bottom should have the same character,
    // not the same absolute wobble.
    const jitter = reach * 0.09;

    const seen = new Set();
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
    const bands = [];
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
  }

  // Fractal midpoint displacement: start with the straight line from the sky to
  // the caret, then repeatedly split every segment and shove the new midpoint
  // sideways by a shrinking random amount. Displacement is across the segment
  // rather than in a fixed axis, so the jaggedness looks the same whatever
  // angle the bolt comes in at.
  boltPath(x0, y0, x1, y1, jitter) {
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
  }

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
  pixelateBolt(pts, cell, seen, t0, t1) {
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
  }

  drawThunderbolts() {
    if (!this.thunderbolts.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.settings.cursorOpacity ?? 1));
    const strength = Math.max(0.1, Math.min(1, this.settings.thunderstrikeStrength ?? 0.5));
    const halo = !!this.settings.glow;

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
  }

  // The raw blink cycle: 1 while the caret is "on", 0 while it's "off", eased
  // through the two transitions, and pinned at 1 during the post-move hold.
  //
  // This is the SHAPE of the blink, separate from what is done with it. Plain
  // blinking fades opacity by it; Breathing scales the caret by it and leaves
  // opacity alone; the torch's Blink Sync follows it whichever of those is on.
  // Splitting the two apart is what lets Breathing stop the caret vanishing
  // without also stopping everything else that keys off the blink.
  blinkPhase(now) {
    if (!this.settings.blinkingEnabled) return 1;
    // Build the effective hold window from two independent sources:
    //   • smoothStopBlinking (existing): 450 ms hold, only active when smooth
    //     movement is on (behaviour unchanged for existing users).
    //   • blinkDelayMs (new): explicit user-controlled delay that works
    //     regardless of whether smooth movement is enabled.
    // We take the larger of the two so neither setting silently overrides the other.
    let holdMs = 0;
    if (this.settings.smoothEnabled && this.settings.smoothStopBlinking) holdMs = 450;
    const delayMs = Math.max(0, this.settings.blinkDelayMs ?? 0);
    if (delayMs > holdMs) holdMs = delayMs;
    // Phase is measured from the END of the hold window, not from the wall
    // clock.
    //
    // blinkAlphaAt used to take `now` directly and do `now % period`, so the
    // cycle was anchored to nothing at all. The hold pins alpha at 1 and then
    // handed straight back to whatever phase absolute time happened to be at
    // - which, sweeping stop-times across one cycle, snapped 1.00 -> 0.00 in a
    // single frame about half the time. You stop typing, the caret sits solid
    // for the delay, then vanishes with no fade at all, precisely when your
    // eye goes looking for it. The blinkFade easing never applied at that
    // boundary because it only exists inside the cycle.
    //
    // Anchoring here means the cycle always STARTS fully on and eases down on
    // schedule, which is also what every other editor does: move the caret and
    // the blink restarts from solid rather than resuming mid-cycle.
    const elapsed = now - (this.lastMoveTime + holdMs);
    if (!(elapsed > 0)) return 1;

    const speed = Math.max(0, this.settings.blinkSpeed);

    // Blink-to-solid. After N full cycles the caret stops blinking and stays
    // lit until it next moves, which resets lastMoveTime and starts the count
    // again.
    //
    // Counted in whole PERIODS, and that is what makes the hand-off free: a
    // cycle starts fully on (see the anchoring note above), so at elapsed =
    // N * period the blink is already at alpha 1 and holding there is
    // continuous. Testing an alpha threshold instead, or counting fades,
    // would stop somewhere inside a cycle and snap - the same class of jump
    // the phase anchor exists to remove.
    //
    // It also pays for itself in frames. The gear decision reads blinkPhase()
    // directly, so a caret that has gone solid reports neither a fade nor a
    // changing draw signature: the loop drops to the idle heartbeat and stops
    // repainting entirely, instead of running two fades a second forever.
    const stopAfter = Math.max(0, Math.round(this.settings.blinkStopAfter ?? 0));
    if (stopAfter > 0 && speed > 0 && elapsed >= stopAfter * (2500 / speed)) return 1;

    return blinkAlphaAt(elapsed, speed, this.settings.blinkOnOffBalance ?? 0.5, this.settings.blinkFade ?? 0.15);
  }

  // What the blink does to opacity. Breathing swaps the fade out for a size
  // change, so the caret keeps full opacity throughout - never disappearing is
  // the entire point of that option.
  blinkAlpha(now) {
    if (this.settings.blinkBreathing) return 1;
    return this.blinkPhase(now);
  }

  // What the blink does to size: 1 at the top of the cycle, shrinking to
  // (1 - depth) at the bottom. Never exceeds 1, deliberately - the damage box
  // in draw() is measured from the caret's true rect, so a caret that breathed
  // OUT past its own bounds would leave uncleared pixels behind its widest
  // frame. Shrinking from the true size is also what keeps it from shouldering
  // into the glyphs on either side.
  breathScale(now) {
    if (!this.settings.blinkingEnabled || !this.settings.blinkBreathing) return 1;
    const depth = Math.max(0, Math.min(0.9, this.settings.blinkBreathDepth ?? 0.2));
    return 1 - depth * (1 - this.blinkPhase(now));
  }

  // ---- Damage tracking ---------------------------------------------------
  // The canvas spans the whole viewport at devicePixelRatio, so on a Retina
  // display it is several million pixels - while the cursor and its effects
  // touch a few thousand. Clearing the entire surface each frame was the
  // dominant GPU cost as soon as anything forced continuous repaints (typing,
  // or the energy shimmer): a full-surface clear plus a full-surface composite
  // 30-60 times a second, to change a caret-sized region.
  //
  // So each primitive reports the box it painted and the next frame clears
  // exactly the union of what the last one touched. Nothing is predicted in
  // advance, so this cannot drift out of sync with the drawing code - but a
  // primitive that paints WITHOUT calling _markDirty will leave ghost pixels
  // behind. If you add an effect, mark its bounds, generously: over-reporting
  // only costs fill rate, under-reporting corrupts the frame.
  // ---------------------------------------------------------------------------
  // "Is anything actually in motion this frame?" - the frame governor's hot-gear
  // test, and the fourth of the six touchpoints for adding an effect.
  //
  // Extracted from the canvas tick so it can be TESTED. Missing an entry here is
  // the one effect-authoring mistake that is both silent and user-visible: the
  // loop judges the frame static, drops to its 100ms idle heartbeat, and the
  // effect freezes mid-animation whenever nothing else happens to be moving. It
  // was previously guarded by a comment alone while every other effect invariant
  // in this file had coverage. See test.js, "frame governor".
  //
  // MUST STAY A PURE READ. The gear decision runs before draw(), and anything
  // that retires state here (glitchState() would - it drops an expired burst as
  // a side effect) would retire it before the frame that should have painted it.
  // ---------------------------------------------------------------------------
  _isAnimating(nowT) {
    return (
      !!this._smoothMoving ||
      !!this.pending ||
      (this.trail && this.trail.length > 0) ||
      (this.particles && this.particles.length > 0) ||
      // flamePixels are aged inside draw(), so a skipped frame would
      // freeze a burst mid-flight rather than letting it expire.
      (this.flamePixels && this.flamePixels.length > 0) ||
      // Same again for Hot-head's fire, aged in its own draw call.
      (this.flameEmbers && this.flameEmbers.length > 0) ||
      // ...and the effect itself, not just its live particles. While
      // Hot-head is on the fire is continuously animating by definition,
      // and the particle test alone has a hole in it: the instant the
      // pool empties the loop would judge the frame static, drop to the
      // 100ms idle heartbeat, and the next spawn would arrive as one
      // lumpy burst instead of a steady flame.
      (!!this.styleFor("hotHead") && !!this.animActive && this.hotHeadFeeding(nowT)) ||
      // Same reasoning: a bolt is aged and expired inside its draw call,
      // so a skipped frame would leave one frozen on screen.
      (this.thunderbolts && this.thunderbolts.length > 0) ||
      // And again for a firework. Note this covers a shell still sitting
      // out its stagger delay, which paints nothing yet but must not be
      // allowed to drop the loop into the idle heartbeat - the volley
      // would land in lumps a tenth of a second apart.
      (this.fireworks && this.fireworks.length > 0) ||
      // A Signal Glitch burst is a ~200ms wall-clock animation, so it
      // needs continuous frames for its whole life. Tested inline rather
      // than via glitchState() because that RETIRES an expired burst as a
      // side effect, and the gear decision must stay a pure read - the
      // draw call below is what should do the retiring.
      (!!this.glitch && (nowT - this.glitch.start) < this.glitch.dur) ||
      this.heat > 0 ||
      // Every full-effect secondary carries the same motion fields (see
      // CARET_STATE_FIELDS), and a settling spring or a live trail on any of
      // them needs frames exactly as the primary's does. A pure read of the
      // bundles, nothing swapped in.
      (this._secondaries && this._secondaries.some((c) =>
        !!c._smoothMoving || !!c.pending || !!c._smearMoving ||
        (c.trail && c.trail.length > 0) ||
        (!!c.glitch && (nowT - c.glitch.start) < c.glitch.dur) ||
        // Hot-head feeding on a secondary, same test as the primary's above.
        (!!this.styleFor("hotHead") && !!c.animActive && this._hotFeedingAt(c._hotActiveT, nowT)))) ||
      // Precise: the spring reports whether any corner is still off its
      // target or carrying velocity. This used to be a 1200ms window
      // after the last motion, which was a workaround for a timestamp
      // that was being restamped every frame and so never expired. Now
      // that the spring snaps exactly onto its targets when it settles,
      // it cannot flap back and forth, so the grace period is dead
      // weight - it just held the hot gear for an extra 1.2s after every
      // smear finished.
      !!this._smearMoving
    );
  }

  _markDirty(x, y, w, h) {
    const d = this._dirty;
    if (!d) {
      this._dirty = { x0: x, y0: y, x1: x + w, y1: y + h };
      return;
    }
    if (x < d.x0) d.x0 = x;
    if (y < d.y0) d.y0 = y;
    if (x + w > d.x1) d.x1 = x + w;
    if (y + h > d.y1) d.y1 = y + h;
  }

  // The cursor's own damage bounds, in client coordinates: the interpolated
  // caret, the entire smear quad (which overshoots well past the caret on a
  // fast move), any held character and the serifs, padded for glow
  // (shadowBlur maxes at 10), outline width, antialiasing and a Signal Glitch
  // throw. Marked dirty once from draw() rather than threaded through every
  // branch of drawBoxCursor/drawGenericCaret - and read by _frameNeed to place
  // the canvas, so the region and the damage rect cannot disagree.
  // Null when there is no caret.
  _cursorBounds() {
    const a = this.animActive;
    if (!a) return null;
    let x0 = a.x, y0 = a.top;
    let x1 = a.x + Math.max(a.w || 0, a.actualCharWidth || 0);
    let y1 = a.top + (a.h || 0);
    // Bound BOTH the raw spring quad and the tapered shape actually painted.
    // The taper usually pulls corners inward, but it works by preserving each
    // corner's distance ALONG the travel line while pulling it toward that
    // line - and on a fast diagonal jump that can nudge a corner slightly
    // PAST the raw quad's axis-aligned bounds (shrinking one axis grows the
    // other). Marking only the raw quad then under-reports by a sliver, which
    // never gets cleared: the tapered-tail artifact. smearShape is usually
    // the same object as smearQuad (taper off or below threshold), so the
    // second pass is a cheap no-op then.
    for (const src of [this.smearQuad, this.smearShape]) {
      if (!src) continue;
      for (const k in src) {
        if (src[k].x < x0) x0 = src[k].x;
        if (src[k].y < y0) y0 = src[k].y;
        if (src[k].x > x1) x1 = src[k].x;
        if (src[k].y > y1) y1 = src[k].y;
      }
    }
    // Serifs reach out to either side of the stem, and the left one reaches
    // OUTSIDE the caret's own x. The base pad below covers that at ordinary
    // font sizes, but the span follows the character width, so a large
    // heading can push the outer edge past it - and anything painted
    // outside the damage rect is never cleared. Widen explicitly instead of
    // relying on the pad happening to be enough.
    if (this.styleFor("cursorStyle") === "Line" && this.settings.lineSerifs) {
      const halfSpan = Math.max(
        SERIF_MIN_SPAN_PX,
        Math.min(a.actualCharWidth || 0, (a.h || 0) * SERIF_MAX_SPAN_RATIO),
      ) / 2;
      const cx = a.x + (a.w || 0) / 2;
      if (cx - halfSpan < x0) x0 = cx - halfSpan;
      if (cx + halfSpan > x1) x1 = cx + halfSpan;
    }
    let pad = 24 + Math.max(0, this.settings.caretWidthPx || 0);
    // The CRT glow's blur grows with Speed Demon's heat (glowHeatScale), and
    // a shadow spreads roughly its blur radius. 24 comfortably covers the
    // base blur of 8-10; at full heat that becomes ~26 and would paint
    // outside the rect this frame clears, leaving a halo smeared across the
    // pane. Scale the pad by the same factor rather than picking a fixed
    // worst case, so an idle cursor still clears the small rect.
    if (this.settings.crtEffect && this.settings.glow) {
      pad += 10 * (this.glowHeatScale() - 1);
    }
    // A Signal Glitch throws slices far outside the caret box, and anything
    // painted outside the damage rect is never cleared - it would leave
    // permanent debris on the canvas. Widen the rect to cover the worst-case
    // throw for the current settings rather than the average one: the
    // envelope decays, so a rect sized for "typical" would under-report on
    // exactly the first and most violent frames.
    if (this.glitch) {
      const st = Math.max(0, Math.min(2.5, this.settings.crtGlitchStrength ?? 1));
      const abr = Math.max(0, Math.min(3, this.settings.crtGlitchAberration ?? 1));
      // 14 * strength * reach(<=2.2) is the slice throw; the width stretch
      // adds up to ~28% of the caret width per side; then the channel split.
      pad += 14 * st * 2.2 + 3.2 * abr + (a.w || 0) * 0.3 + 4;
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    // The surface is the region, not the window (issue #30): clears and the
    // clamp on the damage rect are both against it.
    const r = this._canvasRect;
    if (!r) return;
    const rx0 = r.x, ry0 = r.y, rx1 = r.x + r.w, ry1 = r.y + r.h;

    if (!DIRTY_RECT_CLEAR || this._dirtyFull) {
      ctx.clearRect(rx0, ry0, r.w, r.h);
      this._dirtyFull = false;
    } else if (this._dirtyPrev) {
      const p = this._dirtyPrev;
      ctx.clearRect(p.x, p.y, p.w, p.h);
    }
    // A null _dirtyPrev means last frame painted nothing, so the surface is
    // already clean and needs no clear at all.
    this._dirty = null;

    this.drawLettersParticles();
    // Underneath everything else: it's a background guide, and the cursor and
    // its motes should read as sitting on top of it.
    this.drawBracketTether();
    // Behind the flame pixels and the cursor: motes are ambient background,
    // and a mote crossing the caret shouldn't paint over it.
    this.drawStardust();
    this.drawFlamePixels();
    // The fire sits behind the caret so the caret reads as the thing that is
    // burning rather than a shape floating in front of a fire.
    this.drawHotHead();
    // Behind the cursor, like every other effect here: the bolt lands ON the
    // caret, and the caret should be the thing you see it hit.
    this.drawThunderbolts();
    // Behind the cursor for the same reason, and after the bolt: a shell
    // launched by the same Enter that called down lightning should climb out
    // in front of it rather than being swallowed by the strike.
    this.drawFireworks();

    // Cursor bounds are marked once, at the END of the frame rather than
    // here, so the effects-only union can be snapshotted first - see the
    // note on _dirtyRaw below. Computed here, before anything cursor-shaped
    // paints, exactly as it always was.
    const a = this.animActive;
    const cb = this._cursorBounds();

    // Breathing is applied as a transform around the whole cursor draw rather
    // than by shrinking the rect each painter is handed. Two reasons: with
    // Motion Smear on, fillCursorShape ignores that rect entirely and draws the
    // spring's quad instead, so a shrunken rect would silently do nothing; and
    // scaling here catches the glow, the outline and the held character in one
    // go, so the caret breathes as one object instead of coming apart.
    //
    // Note it does NOT touch getActiveRect(), which is what the smear spring
    // chases. Breathing the spring's target would mean the spring never
    // settles, and `_smearMoving` would hold the hot gear for as long as the
    // caret blinked.
    const breath = a ? this.breathScale(performance.now()) : 1;
    const breathing = breath < 0.999;
    if (breathing && a) {
      const cx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
      const cy = a.top + (a.h || 0) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breath, breath);
      ctx.translate(-cx, -cy);
    }
    // Before the dispatch, not inside the Box branch: this both sets the
    // blend for a highlighter-translucent box AND clears it for every other
    // style, and the other styles don't call drawBoxCursor.
    this.applyCanvasBlend();
    switch (this.styleFor("cursorStyle")) {
      case "Line":
        this.drawGenericCaret(false);
        break;
      case "Underline":
        this.drawGenericCaret(true);
        break;
      case "Box":
        this.drawBoxCursor();
        break;
    }
    if (breathing) ctx.restore();

    // Multi-cursor. The full-effect secondaries are painted with the very
    // same painters as the primary, each with its own state swapped in; the
    // carets past SECONDARY_FULL_MAX are the plain 2px line. Both sit on top
    // of the primary's trail and particles.
    const secBounds = this.drawFullSecondaries();
    this.drawSecondaryCarets();

    // The UNCLAMPED union of everything EXCEPT the cursor, kept for
    // _frameNeed to place the canvas next frame: particles, embers, motes,
    // trail ghosts, secondaries - whatever was painted somewhere this frame
    // will be painted near there next frame, and a painter that reached past
    // the region is exactly what the region has to grow to include. The
    // cursor is left out on purpose. Its NEXT position is known before the
    // draw (_cursorBounds), and its last one needs no coverage: a re-anchor
    // blanks the surface, and inside the region _dirtyPrev clears it. With
    // the cursor in here a caret jump dragged its old position into the
    // need, and the region grew to span the jump instead of sliding.
    const e = this._dirty;
    this._dirtyRaw = e ? { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 } : null;
    // Now the cursor, for the clear: see _cursorBounds for what it spans.
    // The full-effect secondaries are cursors too, and out of _dirtyRaw for
    // the same reason.
    if (cb) this._markDirty(cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0);
    for (const b of secBounds) this._markDirty(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);

    // Freeze this frame's union for the next frame to clear, clamped to the
    // surface so an off-screen particle can't inflate the cleared region.
    const d = this._dirty;
    if (!d) {
      this._dirtyPrev = null;
      return;
    }
    const cx0 = Math.max(rx0, Math.floor(d.x0) - 2);
    const cy0 = Math.max(ry0, Math.floor(d.y0) - 2);
    const cx1 = Math.min(rx1, Math.ceil(d.x1) + 2);
    const cy1 = Math.min(ry1, Math.ceil(d.y1) + 2);
    this._dirtyPrev =
      cx1 > cx0 && cy1 > cy0 ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null;
  }

  renderWidth(active) {
    return active.w;
  }

  // Age out expired trail points.
  //
  // This deliberately lives in the update phase, NOT inside draw(), and is
  // deliberately NOT gated on crtEffect. It used to be the first two lines of
  // forEachTrailPoint(), which is wrong twice over:
  //
  //   1. forEachTrailPoint() early-returns when crtEffect is off, but
  //      pushTrail() runs from commitMove() on every caret move regardless of
  //      that setting. With the trail effect disabled - the default - the
  //      array filled to trailLength and was never pruned by age at all,
  //      only evicted by newer entries. trail.length stayed pinned at 10
  //      forever after the first ten keystrokes.
  //   2. Even with crtEffect on, pruning inside draw() breaks the moment the
  //      frame governor legitimately skips a draw.
  //
  // Either way the result was the same: `trail.length > 0` held `animating`
  // true permanently, which latched the hot gear and defeated every other
  // power fix in this file. Measured at a flat 60 draws/sec on a completely
  // idle editor.
  pruneTrail() {
    if (!this.trail.length) return;
    const now = performance.now();
    const fade = Math.max(50, this.settings.trailFadeMs);
    this.trail = this.trail.filter((p) => now - p.t < fade);
  }

  forEachTrailPoint(cb) {
    if (!this.settings.crtEffect) return;
    const now = performance.now();
    const fade = Math.max(50, this.settings.trailFadeMs);
    for (const p of this.trail) {
      const age = (now - p.t) / fade;
      const alpha = Math.max(0, 1 - age) * 0.55;
      if (alpha > 0.02) {
        // Padded for stroke width and the shadowBlur glow the CRT effect adds.
        // Neon spills a wider glow, so pad more when it's on. The neon ghost is
        // now just the caret's own footprint (see drawNeonGhost), so no extra
        // horizontal allowance is needed beyond the glow pad.
        const pad = this.settings.crtNeon ? 22 : 14;
        this._markDirty(p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2);
        // `age` (0 = freshest ghost, 1 = about to vanish) is passed so the neon
        // gradient can run the ramp ALONG the trail rather than within each dot.
        cb(p, alpha, Math.max(0, Math.min(1, age)));
      }
    }
  }

  // The fill/stroke style and glow for one CRT trail ghost. Pulled out so the
  // Line/Underline and Box renderers paint the trail identically.
  //
  // Plain CRT: the flat (or per-dot gradient) cursor colour at the ghost's fade
  // alpha, no extra glow beyond the cursor's own. Neon: the colour is pushed
  // toward full saturation and a bright core, a real shadowBlur halo is armed on
  // the context, and - when crtNeonGradient is on with a gradient active - the
  // hue is sampled from the ramp by the ghost's position along the trail, so the
  // streak runs through the whole gradient from head to tail.
  //
  // Returns the style string; arming the glow is a side effect on ctx, so the
  // caller must ctx.save()/restore() around a run of trail points.
  trailPaint(ctx, p, alpha, age, flatColor) {
    if (!this.settings.crtNeon) {
      ctx.shadowBlur = 0;
      return this.cursorPaint(p.x, p.y, p.w, p.h, flatColor, alpha);
    }

    // Neon colour. When the gradient sub-option is on, sample the ramp by
    // trail position (freshest ghost near the head of the ramp); otherwise lift
    // the flat colour toward its own saturated, bright version.
    let r, g, b;
    if (this.settings.crtNeonGradient && this.settings.gradientEnabled) {
      [r, g, b] = this.sampleRamp(1 - age);
    } else {
      [r, g, b] = hexToRgbTuple(flatColor || "#39ff14");
    }
    // Push toward a neon look: pull each channel a little toward white for a hot
    // core while keeping the hue, so it reads as luminous tube-glow rather than
    // a flat swatch.
    const nr = Math.round(r + (255 - r) * 0.35);
    const ng = Math.round(g + (255 - g) * 0.35);
    const nb = Math.round(b + (255 - b) * 0.35);
    // The halo carries the pure hue (not the whitened core) so the glow around
    // each ghost is saturated colour, the way real neon spills.
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha * 2)})`;
    ctx.shadowBlur = 12;
    // Slightly boosted alpha so the streak holds up under the glow.
    return `rgba(${nr}, ${ng}, ${nb}, ${Math.min(1, alpha * 1.3)})`;
  }

  // Paint one neon trail ghost as a lit tube rather than a flat coloured bar:
  // the saturated fill + halo from trailPaint, then a thin near-white core
  // stripe down its centre so it reads as a glowing filament with coloured
  // spill - the thing that actually makes it look like neon. The core is
  // skipped once the ghost is too narrow to have an inside (e.g. a Line cursor,
  // which is basically all core already).
  drawNeonGhost(ctx, r, alpha, age, color) {
    ctx.fillStyle = this.trailPaint(ctx, r, alpha, age, color);
    this.fillTrailRect(ctx, r.x, r.y, r.w, r.h);
    if (r.w >= 3) {
      const coreW = Math.max(1, r.w * 0.34);
      // Uses the hue trailPaint already armed as the shadow, so the white core
      // casts a coloured glow - a hot filament inside a coloured tube.
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.6)})`;
      // The core is a thin bar inside the tube, so it capsules on its own
      // narrow axis whenever the tube is rounded - a sharp-ended filament
      // poking out of a rounded tube is the one artifact worth avoiding here.
      this.fillTrailRect(ctx, r.x + (r.w - coreW) / 2, r.y, coreW, r.h);
    }
  }

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
  cornerRadius(minor) {
    if (!this.styleFor("cursorRounded")) return 0;
    const m = Math.max(0, minor);
    if (m <= 0) return 0;
    const r = m <= ROUNDED_THIN_PX ? m / 2 : m * ROUNDED_BLOCK_FRACTION;
    // Never more than half the narrow axis: beyond that the two corners on
    // one side overlap and arcTo starts producing self-intersecting garbage.
    return Math.min(r, m / 2);
  }

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
  traceQuad(ctx, corners, radius = 0) {
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
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const seed = mid(pts[3], pts[0]);
    ctx.moveTo(seed.x, seed.y);
    for (let i = 0; i < 4; i++) {
      const corner = pts[i];
      const next = pts[(i + 1) % 4];
      ctx.arcTo(corner.x, corner.y, next.x, next.y, r);
    }
    ctx.closePath();
  }

  // The caret's body as a set of corner points: the smear quad while Motion
  // Smear is deforming it, otherwise the plain rect.
  cursorCorners(rx, ry, rw, rh) {
    return this.smearCorners() || {
      tl: { x: rx, y: ry },
      tr: { x: rx + rw, y: ry },
      br: { x: rx + rw, y: ry + rh },
      bl: { x: rx, y: ry + rh },
    };
  }

  fillCursorShape(ctx, rx, ry, rw, rh) {
    const corners = this.cursorCorners(rx, ry, rw, rh);
    ctx.beginPath();
    this.traceQuad(ctx, corners, this.cornerRadius(Math.min(rw, rh)));
    ctx.fill();
  }

  // An axis-aligned rect as a rounded subpath, for the trail ghosts and the
  // neon tube. These never smear (a trail ghost is a snapshot of where the
  // caret WAS, so it has no spring state of its own), so they don't need the
  // quad machinery - but they do need to match the live caret's rounding, or
  // a rounded cursor drags a tail of little sharp boxes behind it.
  traceRoundedRect(ctx, x, y, w, h, radius) {
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
  }

  fillTrailRect(ctx, x, y, w, h) {
    const r = this.cornerRadius(Math.min(w, h));
    if (!(r > 0.01)) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    this.traceRoundedRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  // Chooses how the Energy Beam paints the cursor.
  //
  // Aurora with any waviness becomes a genuine 2D field (auroraPattern); every
  // other case keeps the original linear gradient. Both return something usable
  // directly as a fillStyle/strokeStyle, so callers don't care which they got.
  energyPaint(x, y, w, h, baseColor, alpha) {
    const rampOn = !!this.settings.gradientEnabled;
    const wav = this.settings.energyAuroraWaviness ?? 1;
    if (rampOn && this.settings.energyAurora && wav > 0.05) {
      const pat = this.auroraPattern(x, y, w, h, alpha, wav);
      if (pat) return pat;
      // else fall through to the gradient - auroraPattern self-disables on a
      // degenerate rect, an oversized one, or any canvas API failure.
    }
    return this.createEnergyGradient(x, y, w, h, baseColor, alpha);
  }

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
  auroraPattern(x, y, w, h, alpha, wav) {
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
        for (const k of ["tl", "tr", "br", "bl"]) {
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

      const speed = this.settings.energySpeed ?? 1;
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
      return null;
    }
  }

  createEnergyGradient(x, y, w, h, baseColor, alpha) {
    const ctx = this.ctx;
    if (!ctx) return hexToRgba(baseColor, alpha);
    const speed = this.settings.energySpeed ?? 1;
    const t = (performance.now() / 1000) * speed;
    const base = hexToRgbTuple(baseColor);
    const rampOn = !!this.settings.gradientEnabled;
    const aurora = rampOn && !!this.settings.energyAurora;

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
  }

  // Thickness of the Underline cursor's bar, in px.
  //
  // 0 (the default) means "auto": 15% of the line height, which is exactly
  // what this style did before the setting existed - so an existing setup, and
  // any Vim mode that never overrode the key, keeps the look it already had.
  // Anything else is a literal pixel thickness, clamped to the line height so
  // a large value on a small font degrades to a filled block rather than
  // painting outside the line.
  underlineThickness(lineHeight) {
    const h = Math.max(1, Math.round(lineHeight || 0));
    const px = this.settings.underlineWidthPx || 0;
    if (px > 0) return Math.max(1, Math.min(Math.round(px), h));
    return Math.max(2, Math.round(h * 0.15));
  }

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
  serifQuads(active, rx, rw) {
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
    const anchor = (a, b) => {
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
  }

  drawGenericCaret(isUnderline = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.settings;
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

    ctx.save();
    this.forEachTrailPoint((p, alpha, age) => {
      if (settings.crtNeon) {
        // Neon draws the caret's OWN footprint as a glowing tube: the same
        // width as the live cursor (a thin stem for Line, the bar for
        // Underline, the char box for Box) and the full caret height. No
        // reshaping - the tail matches the cursor instead of ballooning into a
        // height-wide ribbon.
        if (isUnderline) {
          const uThickness = this.underlineThickness(p.h);
          const ty = p.y + p.h - uThickness;
          this.drawNeonGhost(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, alpha * bodyOpacity, age, trailColor);
        } else {
          this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, alpha * bodyOpacity, age, trailColor);
        }
      } else if (isUnderline) {
        const uThickness = this.underlineThickness(p.h);
        const ty = p.y + p.h - uThickness;
        // Build the paint from the bar's own rect, not the full line box:
        // a ramp spanning the whole line height would show only the sliver
        // of itself that happens to fall across the bar.
        ctx.fillStyle = this.trailPaint(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, alpha * bodyOpacity, age, trailColor);
        this.fillTrailRect(ctx, p.x, ty, p.w, uThickness);
      } else {
        ctx.fillStyle = this.trailPaint(ctx, p, alpha * bodyOpacity, age, trailColor);
        this.fillTrailRect(ctx, p.x, p.y, p.w, p.h);
      }
    });
    ctx.restore();

    if (!active) return;
    const blinkAlpha = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";

    ctx.save();
    if (settings.crtEffect && settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * blinkAlpha * this.glowHeatScale();
    }

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
    const gsGen = settings.crtEffect && settings.crtGlitch
      ? this.glitchState(now) : null;

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
      ctx.fillStyle = settings.energyEffect
        ? this.energyPaint(px, ry, pw, rh, color, 0.9 * blinkAlpha * bodyOpacity)
        : this.cursorPaint(px, ry, pw, rh, color, 0.9 * blinkAlpha * bodyOpacity);

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
  }

  // The plain fallback: a solid 2px vertical line for every non-primary caret
  // PAST SECONDARY_FULL_MAX. The first SECONDARY_FULL_MAX get the primary's
  // whole pipeline instead (drawFullSecondaries); this is what the rest
  // are, and what every secondary was before that. Blinks in sync with the
  // main cursor so all carets fade together.
  //
  // Colour follows the primary cursor, including its Gradient: with Gradient
  // on, each secondary caret gets the whole ramp down its own height, the same
  // way cursorPaint() paints the primary one. It used to take getActiveColor()
  // in every case, which for a gradient cursor is the ramp's FIRST STOP - so a
  // multi-cursor edit put one caret in full colour and the rest in a flat slice
  // of it, which reads as the extra carets being a different, wrong colour.
  //
  // The ramp is resolved ONCE per frame, not once per caret. A CanvasGradient
  // is tied to absolute canvas coordinates, so each caret does need its own
  // object - but the expensive part (walking the stops, applying Speed Demon's
  // heat, building an rgba() string per stop) does not depend on position, and
  // multi-cursor edits are exactly where the caret count can run into the
  // hundreds. Same reasoning as the firework sparks' baked palette.
  drawSecondaryCarets() {
    const carets = this.secondaryCarets;
    if (!carets || carets.length === 0) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const opacity = Math.max(0, Math.min(1, this.settings.cursorOpacity ?? 1));
    const alpha = this.blinkAlpha(performance.now()) * opacity;
    if (alpha <= 0.01) return;
    const strokeAlpha = 0.9 * alpha;

    // Exactly one of these is used, decided once for the whole frame.
    let ramp = null;
    if (this.settings.gradientEnabled) {
      ramp = this.gradientStops().map((hex) => {
        const [r, g, b] = hexToRgbTuple(hex);
        return `rgba(${r}, ${g}, ${b}, ${strokeAlpha})`;
      });
    }

    ctx.save();
    ctx.lineWidth = 2;
    // A secondary caret is a stroked segment rather than a filled shape, so
    // its "corners" are line caps. A round cap extends the stroke by half the
    // line width past each endpoint; at lineWidth 2 that is 1px each way,
    // inside the 2px padding _markDirty already allows below.
    ctx.lineCap = this.styleFor("cursorRounded") ? "round" : "butt";
    if (!ramp) ctx.strokeStyle = hexToRgba(this.getActiveColor(), strokeAlpha);
    for (const c of carets) {
      // 0.5-pixel offset so a 2px stroke lands on whole pixels rather than
      // straddling a boundary and antialiasing to a blurry 3px stripe.
      const x = Math.round(c.x) + 0.5;
      const h = c.bottom - c.top;
      if (ramp) {
        // A zero-length gradient line paints nothing at all (canvas spec), so
        // a caret with no measured height falls back to a flat first stop
        // rather than silently vanishing.
        if (h > 0) {
          const grad = ctx.createLinearGradient(x, c.top, x, c.bottom);
          for (let i = 0; i < ramp.length; i++) {
            grad.addColorStop(i / (ramp.length - 1), ramp[i]);
          }
          ctx.strokeStyle = grad;
        } else {
          ctx.strokeStyle = ramp[0];
        }
      }
      this._markDirty(x - 3, c.top - 2, 6, h + 4);
      ctx.beginPath();
      ctx.moveTo(x, c.top);
      ctx.lineTo(x, c.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLettersParticles() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    
    this.particles = this.particles.filter(p => {
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
  }

  drawFlamePixels() {
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
    const gStrength = Math.max(0, Math.min(1, this.settings.flameTrailGravity ?? 0));
    let gx = 0, gy = 0;
    if (gStrength > 0) {
      const mag = gStrength * 900; // px/s² at full strength
      const rad = ((this.settings.flameTrailGravityAngle ?? 0) * Math.PI) / 180;
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
  }

  // Hot-head's fire colour for a given temperature (0..1):
  //
  //   0.00  the cursor's own colour - the coolest fire is the colour of
  //         whatever lit it, so the effect stays in the cursor's family
  //   0.28  yellow
  //   0.55  orange
  //   0.80  red-orange
  //   1.00  white-hot
  //
  // Separate from Speed Demon's heatColor, which drives the caret's own colour
  // and has its own ramp. Interpolation is per-segment in HSV, not RGB: an RGB
  // lerp from a cool cursor colour to yellow passes through grey, and fire is
  // never desaturated. The ignition segment forces hues past 180 to climb, so a
  // blue or violet cursor reddens on its way to yellow through magenta rather
  // than flashing lime through cyan and green - shortest is not the same as
  // most like fire.
  hotFireColor(temp, baseHex) {
    const h = Math.max(0, Math.min(1, temp));
    const base = rgbToHsv(hexToRgbTuple(baseHex));

    let i = 0;
    while (i < HOT_STOP_POS.length - 2 && h > HOT_STOP_POS[i + 1]) i++;
    const t0 = HOT_STOP_POS[i];
    const t1 = HOT_STOP_POS[i + 1];
    const t = t1 > t0 ? (h - t0) / (t1 - t0) : 0;
    const f = t * 0.7 + easeInOutSine(t) * 0.3;

    const from = i === 0 ? base : HOT_HSV[i - 1];
    const to = HOT_HSV[i];
    const arc = i === 0 && from[0] > 180 ? 1 : 0;
    return rgbTupleToHex(hsvToRgb(lerpHsv(from, to, f, arc)));
  }

  // Hot-head's fire.
  //
  // Particles are points. They're binned into a fine square lattice, and how
  // big each one is drawn is decided by its remaining life, not by any radius
  // it carries: fresh ones cover a 2x2 patch of squares, middle-aged ones a
  // single square, old ones a small dot inside one. Then they fade through
  // discrete shade levels. Big blocks, then specks, then gone.
  //
  // The lattice is square and sized off the FONT, not off the character cell,
  // and each square decides its own size stage and colour from the particles
  // in it. Upstream bins into character cells and gives every sub-cell of a
  // cell one shared glyph and colour, because a terminal can only put one
  // character in one cell - reproducing that on a canvas made the grid far too
  // legible, a lattice of character-sized rectangles that read as a tiling
  // artefact instead of as fire.
  //
  // The lattice is anchored to absolute canvas coordinates, not to the caret.
  // Particles move continuously but can only light whole squares, so they
  // appear to step from square to square; anchor it to the caret and the whole
  // fire slides smoothly with it, which just looks like a scaled-up bitmap.
  drawHotHead() {
    if (!this.flameEmbers.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const active = this.animActive;
    const opacity = Math.max(0, Math.min(1, this.settings.cursorOpacity ?? 1))
      * Math.max(0, Math.min(1, this.styleFor("hotHeadOpacity") ?? 1));
    const maxLife = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);

    const dtMs = Math.max(1, Math.min(100, now - (this._hotDrawT || now - 17)));
    this._hotDrawT = now;
    const dt = dtMs / 1000;

    // Upstream applies damping per 17ms frame; correcting by the real interval
    // keeps the motion identical at 30, 60 and 144fps.
    const damp = Math.exp(Math.log(1 - FLAME_DAMPING) * (dtMs / 17));

    // Grid square, from the font rather than the character cell, so it stays
    // square and stays small enough not to draw attention to itself. Chunks
    // are placed on this lattice (pixel art aligns); nothing is shaded by it.
    const fontSize = (active && active.fontSize) || 16;
    const px = Math.max(HOT_PX_MIN, Math.min(HOT_PX_MAX, Math.round(fontSize / HOT_PX_DIVISOR)));
    // Sparks and spent dots are lattice pixels too: a speck centred in its
    // grid square, snapped to the same lattice as the chunks.
    const speck = Math.max(1, Math.round(px * HOT_SPECK_SCALE));
    const speckOff = Math.floor((px - speck) / 2);
    const fineSz = Math.max(1, Math.round(px * HOT_FINE_SCALE));
    const fineOff = Math.floor((px - fineSz) / 2);

    // ---- Colour ----------------------------------------------------------------
    // Two palettes, one per mode, each a ramp of FLAME_LEVELS+1 entries indexed
    // by temperature. Rebuilt only when its inputs change - it used to be
    // rebuilt every frame the heat moved at all, which with Speed Demon on was
    // every frame.
    const flatMode = !!this.styleFor("hotHeadFlat");
    const heatTheFire =
      flatMode && this.styleFor("hotHeadSpeedHeat") && this.settings.speedDemon;
    const heatQ = heatTheFire ? Math.round(Math.max(0, Math.min(1, this.heat || 0)) * 32) : -1;
    const base = heatTheFire
      ? this.heatColor(heatQ / 32, this.getBaseColor())
      : this.getBaseColor();
    const paletteKey = base + (flatMode ? "|flat" : "");
    let palette = this._hotPalette;
    if (!palette || this._hotPaletteKey !== paletteKey) {
      this._hotPaletteKey = paletteKey;
      palette = this._hotPalette = [];
      const baseHsv = rgbToHsv(hexToRgbTuple(base));
      for (let j = 0; j <= FLAME_LEVELS; j++) {
        const u = j / FLAME_LEVELS;
        if (flatMode) {
          // "Use cursor color": the cursor's own colour at u = 0, lightening
          // toward white with heat. Never darker than the cursor.
          const tinted = hsvToRgb([baseHsv[0] + u * HOT_FLAT_HUE_SPAN * 0.5, baseHsv[1], baseHsv[2]]);
          const k = u * HOT_FLAT_LIGHTEN;
          palette.push([
            Math.round(tinted[0] + (255 - tinted[0]) * k),
            Math.round(tinted[1] + (255 - tinted[1]) * k),
            Math.round(tinted[2] + (255 - tinted[2]) * k),
          ]);
        } else {
          palette.push(hexToRgbTuple(this.hotFireColor(u, base)));
        }
      }
    }

    // ---- Advance and paint -----------------------------------------------------------
    // Oldest first (the array is in spawn order), so a fresh bright chunk
    // paints over the fading ones beneath it. A chunk is ONE fill: its
    // shape's squares are put into a single path and filled once with one
    // colour, so nothing inside a chunk is shaded square by square - that
    // per-square shading was the grid. Chunks of the same colour that touch
    // merge seamlessly; different shades meet at an edge, which is a chunk.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x0, y0, w, h) => {
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x0 + w > maxX) maxX = x0 + w;
      if (y0 + h > maxY) maxY = y0 + h;
    };
    const shapeN = HOT_BLOCK_SHAPES.length;
    ctx.save();
    this.flameEmbers = this.flameEmbers.filter((p) => {
      p.life -= dtMs;
      if (p.life <= 0) return false;

      const pcw = p.cw || 8;
      const lift = p.lift || 1;
      // Buoyancy scaled by Flame Height, plus per-frame turbulence. Damping
      // is strong, so what matters is the terminal velocity this implies.
      p.vy = (p.vy + (FLAME_BUOYANCY * lift + FLAME_RANDOM_VELOCITY * (Math.random() - 0.5)) * pcw * dt) * damp;
      p.vx = p.vx * damp + FLAME_RANDOM_VELOCITY * (Math.random() - 0.5) * pcw * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const frac = Math.max(0, Math.min(1, p.life / (p.maxLife || maxLife)));
      const temp = hotQuant((p.temp || 1) * Math.pow(frac, HOT_TEMP_GAMMA), HOT_COLOR_LEVELS) * HOT_TEMP_MAX;
      const [r, g, b] = palette[Math.round(temp * FLAME_LEVELS)];

      if (p.spark) {
        // A spark: a speck at its own position, fading with its life, a
        // little paler than the chunks so the haze reads as embers.
        const q = hotQuant(frac, HOT_ALPHA_LEVELS);
        if (q <= 0) return true;
        const alpha = (p.fine ? 0.15 + 0.35 * q : 0.2 + 0.5 * q) * opacity;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        const sz = p.fine ? fineSz : speck, off = p.fine ? fineOff : speckOff;
        const sx = Math.floor(p.x / px) * px + off, sy = Math.floor(p.y / px) * px + off;
        ctx.fillRect(sx, sy, sz, sz);
        grow(sx, sy, sz, sz);
        return true;
      }

      if (frac <= HOT_STAGE_PIXEL) {
        // Spent: a dot at the particle's own position.
        const q = hotQuant(frac / HOT_STAGE_PIXEL, HOT_ALPHA_LEVELS);
        if (q <= 0) return true;
        const alpha = (0.15 + 0.25 * q) * opacity;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        const dx0 = Math.floor(p.x / px) * px + speckOff, dy0 = Math.floor(p.y / px) * px + speckOff;
        ctx.fillRect(dx0, dy0, speck, speck);
        grow(dx0, dy0, speck, speck);
        return true;
      }

      // The chunk: its shape, stepped down the table by how much of its own
      // life is gone, anchored at the particle's lattice square, growing up
      // and right, mirrored if `flip`. One path, one fill.
      const gone = 1 - Math.max(0, Math.min(1, p.life / (p.life0 || p.maxLife || maxLife)));
      const shape0 = p.shape0 ?? 0;
      const idx = Math.min(shapeN - 1, shape0 + Math.floor(gone * (shapeN - shape0)));
      const rows = HOT_BLOCK_SHAPES[idx];
      const h = rows.length;
      let area = 0;
      for (const row of rows) for (let i = 0; i < row.length; i++) if (row[i] === "1") area++;
      const stage = hotShapeStage(area);
      const q = hotQuant((frac - HOT_STAGE_PIXEL) / (1 - HOT_STAGE_PIXEL), HOT_ALPHA_LEVELS);
      if (q <= 0) return true;
      // Three alphas per stage, the big shapes the most solid.
      const alpha = (stage >= 3 ? 0.70 + 0.25 * q
        : stage >= 2 ? 0.60 + 0.25 * q
        : 0.45 + 0.25 * q) * opacity;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      const gx = Math.floor(p.x / px);
      const gy = Math.floor(p.y / px);
      ctx.beginPath();
      for (let ri = 0; ri < h; ri++) {
        const row = rows[ri];
        const w = row.length;
        // Runs of squares in a row become one rect each.
        let i = 0;
        while (i < w) {
          if (row[i] !== "1") { i++; continue; }
          let j = i;
          while (j < w && row[j] === "1") j++;
          const c0 = p.flip ? (w - j) : i;
          const x0 = (gx + c0) * px;
          const y0 = (gy - (h - 1 - ri)) * px;
          ctx.rect(x0, y0, (j - i) * px, px);
          grow(x0, y0, (j - i) * px, px);
          i = j;
        }
      }
      ctx.fill();
      return true;
    });
    ctx.restore();

    if (minX <= maxX) {
      const pad = px * 2;
      this._markDirty(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2);
    }
  }





  // Age and paint the idle motes.
  //
  // All motion is derived from `elapsed` rather than integrated per frame, the
  // same way flame pixels work, which matters more here than anywhere else in
  // the file: stardust is the one effect that routinely runs at the WARM gear
  // (~30fps) and lives for seconds, so a per-frame step would visibly change
  // both drift speed and lifetime with the gear.
  drawStardust() {
    if (!this.stardust.length) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.settings.cursorOpacity ?? 1));

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
  }

  // Shared tail of drawStardust for both motion modes: paint one mote and
  // report the pixels it touched.
  paintMote(p, x, y, alpha) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, p.size, p.size);
    ctx.restore();
    this._markDirty(x - 1, y - 1, p.size + 2, p.size + 2);
    return true;
  }

  // ---- Bracket Tether ----------------------------------------------------
  // Find the position of the bracket matching the one at `at`, or -1.
  //
  // This is a plain depth count over the raw text, not a syntax-aware match:
  // CodeMirror's own bracket matching lives in @codemirror/language, which
  // isn't reachable from a plugin without bundling it. The practical
  // difference is that a bracket inside a string or comment still counts, so
  // the tether can occasionally point somewhere a compiler wouldn't. For a
  // decorative guide in a Markdown editor that's an acceptable trade; it is
  // NOT a good enough basis for anything that edits text.
  //
  // The one Markdown fact it does know is that a ">" opening a line is a
  // blockquote marker, not an angle bracket. Without that, every line of a
  // callout offers a fresh false partner to any "<" above it, which is the
  // most visible way this goes wrong in a real vault - and no boundary check
  // catches it, because the marker sits at the same quote depth as the "<".
  matchingBracketPos(doc, at, ch) {
    const open = BRACKET_OPEN[ch] ? ch : BRACKET_CLOSE[ch];
    if (!open) return -1;
    const close = BRACKET_OPEN[open];
    const forward = ch === open;
    const len = doc.length;

    // Read one slice and index into it rather than calling sliceString per
    // character - the same scan done a character at a time is thousands of
    // rope walks per frame.
    if (forward) {
      const end = Math.min(len, at + BRACKET_SCAN_LIMIT);
      const text = doc.sliceString(at, end);
      let depth = 0;
      // Whether we're still inside a line's blockquote prefix. False to begin
      // with because `at` is itself a bracket, so nothing before the first
      // newline can be a marker. Tracked inline rather than by calling
      // isBlockquoteMarker per ">": going forwards the prefix state is simply
      // carried along, at no cost.
      let inPrefix = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\n") { inPrefix = true; continue; }
        if (inPrefix) {
          if (c === " " || c === "\t" || c === ">") continue; // still the prefix
          inPrefix = false;
        }
        if (c === open) depth++;
        else if (c === close) { if (--depth === 0) return at + i; }
      }
    } else {
      const start = Math.max(0, at - BRACKET_SCAN_LIMIT + 1);
      const text = doc.sliceString(start, at + 1);
      // Only angle brackets can collide with a marker, so the look-back is
      // skipped entirely for every other pair.
      const angles = close === ">";
      let depth = 0;
      for (let i = text.length - 1; i >= 0; i--) {
        const c = text[i];
        if (angles && c === ">" && isBlockquoteMarker(text, i, start)) continue;
        if (c === close) depth++;
        else if (c === open) { if (--depth === 0) return start + i; }
      }
    }
    return -1;
  }

  // Whether the character at `at` is a blockquote marker. Used to stop the
  // caret tethering FROM one - parking next to the ">" that opens a callout
  // line should do nothing, not hunt backwards for a "<".
  isQuoteMarkerAt(doc, at) {
    if (doc.sliceString(at, at + 1) !== ">") return false;
    const back = Math.max(0, at - BLOCK_PREFIX_MAX);
    return isBlockquoteMarker(doc.sliceString(back, at + 1), at - back, back);
  }

  // The text of the line containing `pos`, plus that line's start offset.
  // Capped rather than using doc.lineAt so this works on any doc-like object
  // exposing length/sliceString, and so a pathological single-line file can't
  // turn one frame into a megabyte read.
  lineBoundsAt(doc, pos) {
    const from = Math.max(0, pos - QUOTE_LINE_SCAN);
    const to = Math.min(doc.length, pos + QUOTE_LINE_SCAN);
    const chunk = doc.sliceString(from, to);
    const rel = pos - from;
    const s = rel <= 0 ? 0 : chunk.lastIndexOf("\n", rel - 1) + 1;
    let e = chunk.indexOf("\n", rel);
    if (e < 0) e = chunk.length;
    return { start: from + s, text: chunk.slice(s, e) };
  }

  // The innermost quoted run on this line that contains (or touches) the
  // caret. Straight quotes are taken left to right - 1st with 2nd, 3rd with
  // 4th - among the quotes that qualify as delimiters. Curly quotes are
  // directional, so an opener is matched to its own nearest closer instead.
  quoteSpanAt(doc, pos) {
    const { start, text } = this.lineBoundsAt(doc, pos);
    const rel = pos - start;
    let best = null;
    const consider = (a, b) => {
      // Inclusive of both edges: the caret counts as "in" the run whether it's
      // inside it or parked just outside either quote.
      if (rel < a || rel > b + 1) return;
      if (!best || a > best.from) best = { from: start + a, to: start + b };
    };

    // Straight quotes: symmetric, paired left-to-right.
    for (const q of QUOTE_CHARS) {
      const marks = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === q && isQuoteDelimiter(text, i)) marks.push(i);
      }
      for (let i = 0; i + 1 < marks.length; i += 2) consider(marks[i], marks[i + 1]);
    }

    // Curly quotes: directional, so scan for an opener and take the nearest
    // matching closer after it. Nesting of the same pair (“ … “ … ” … ”) is
    // rare enough in prose that a simple depth count per opener type is plenty.
    for (const openCh in CURLY_QUOTE_OPEN) {
      const closeCh = CURLY_QUOTE_OPEN[openCh];
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== openCh) continue;
        let depth = 1;
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] === openCh) depth++;
          else if (text[j] === closeCh && isQuoteDelimiter(text, j)) {
            if (--depth === 0) { consider(i, j); break; }
          }
        }
      }
    }
    return best;
  }

  // The innermost bracket pair the caret sits *inside*, for when it isn't
  // touching a bracket at all. Walks back looking for an opener that hasn't
  // already been closed, tracking each bracket type separately so an unrelated
  // `]` in the middle of a `(...)` doesn't derail the count.
  enclosingBracketSpan(doc, pos) {
    const start = Math.max(0, pos - BRACKET_SCAN_LIMIT);
    const text = doc.sliceString(start, pos);
    // One counter per closer, built from the pair table so every bracket type
    // (including angle brackets) is tracked without hardcoding the list here.
    const depth = {};
    for (const closer in BRACKET_CLOSE) depth[closer] = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      const c = text[i];
      if (BRACKET_CLOSE[c]) {
        // A ">" opening a line is a blockquote marker, not a closer - counting
        // it would leave depth[">"] permanently ahead inside any callout and
        // hide every real angle pair in it.
        if (c === ">" && isBlockquoteMarker(text, i, start)) continue;
        depth[c]++;
        continue;
      }
      const closer = BRACKET_OPEN[c];
      if (!closer) continue;
      if (depth[closer] > 0) { depth[closer]--; continue; }
      const from = start + i;
      const to = this.matchingBracketPos(doc, from, c);
      return to >= 0 ? { from, to } : null;
    }
    return null;
  }

  // True when a structural block boundary falls between two offsets - i.e. the
  // pair runs into, out of, or clean across a code block, blockquote or
  // callout. See blockLineInfo for why fences and quotes are detected
  // differently but resolved in one walk.
  //
  // The line the span BEGINS on sets the baseline depth and is exempt from the
  // fence test: a bracket sitting on a fence line must not cut its own tether,
  // and only lines that actually begin inside the span can introduce a fence.
  crossesBlockBoundary(doc, from, to) {
    if (!(to > from)) return false;
    // Reach back for the start of `from`'s line, and slightly past `to` so a
    // fence opening the final line is still matchable when the span stops
    // mid-fence.
    const back = Math.max(0, from - BLOCK_LINE_LOOKBACK);
    const text = doc.sliceString(back, Math.min(doc.length, to + CODE_FENCE_PREFIX));
    const rel = from - back;
    const relTo = to - back;

    let ls = rel <= 0 ? 0 : text.lastIndexOf("\n", rel - 1) + 1;
    let base = -1;
    while (ls <= relTo) {
      let le = text.indexOf("\n", ls);
      if (le < 0) le = text.length;
      // Cap the read: only the head of a line decides its depth and fence, and
      // a span can legitimately cover very long lines.
      const info = blockLineInfo(text.slice(ls, Math.min(le, ls + BLOCK_HEAD_MAX)));
      if (base < 0) {
        base = info.depth;
      } else {
        if (info.fence) return true;          // a code fence opens inside the span
        if (info.depth !== base) return true; // moved into, out of, or between quotes
      }
      if (le >= text.length) break;
      ls = le + 1;
    }
    return false;
  }

  // What the tether should join, as { from, to } document offsets with
  // from <= to, or null.
  //
  // Order matters: a bracket the caret is actually touching wins over anything
  // it merely sits inside, because that's the one you just typed or arrowed
  // onto. Failing that, the innermost enclosing run wins - whichever of the
  // quote or bracket candidates opens closest to the caret.
  tetherSpan(doc, pos) {
    const len = doc.length;
    const adjacent = [];
    if (pos > 0) adjacent.push(pos - 1);
    if (pos < len) adjacent.push(pos);
    for (const at of adjacent) {
      const ch = doc.sliceString(at, at + 1);
      if (!BRACKET_OPEN[ch] && !BRACKET_CLOSE[ch]) continue;
      // Parking beside the ">" that opens a quoted or callout line must do
      // nothing - it's punctuation belonging to the block, not a bracket.
      if (ch === ">" && this.isQuoteMarkerAt(doc, at)) continue;
      const m = this.matchingBracketPos(doc, at, ch);
      if (m < 0) continue;
      const from = Math.min(at, m), to = Math.max(at, m);
      // A match across a block boundary isn't a match. `continue` rather than
      // `return null` so the caret still gets whatever run it's sitting in -
      // the touched bracket losing its partner says nothing about the pair
      // enclosing it.
      if (this.crossesBlockBoundary(doc, from, to)) continue;
      return { from, to };
    }

    const q = this.quoteSpanAt(doc, pos);
    // Not filtered: quoteSpanAt is scoped to a single line (see the note on
    // QUOTE_CHARS), and both a fence and a quote-depth change are properties
    // of a whole line, so a quote span cannot cross either.
    let b = this.enclosingBracketSpan(doc, pos);
    if (b && this.crossesBlockBoundary(doc, b.from, b.to)) b = null;
    if (q && b) return q.from > b.from ? q : b;
    return q || b || null;
  }

  // The tether for this frame, as an array of horizontal rules ordered top to
  // bottom - one per line the pair covers - in viewport pixels (the canvas is
  // fixed at 0,0, so viewport coords ARE canvas coords, the same assumption
  // cmCaretCoords and secondaryCaretCoords make). Returns null when there's
  // nothing to draw.
  // With no head this is the primary's tether, at the main selection. A
  // secondary passes its own head (and whether its range is empty), with its
  // bundle swapped in so the caches below are its own.
  bracketTetherCoords(view, head, empty) {
    if (!view || !view.hasFocus) return null;
    try {
      const state = view.state;
      const main = state.selection.main;
      if (head === undefined) { head = main.head; empty = main.empty; }
      // Only for a collapsed caret: over a selection the line would fight the
      // selection highlight and there's no single "the caret is here" point.
      if (!empty) return null;

      const doc = state.doc;
      const pos = head;
      const len = doc.length;

      // The scan is the expensive part and depends only on where the caret is
      // in what text, so cache it across frames. Coordinates still resolve
      // every frame, since scrolling moves them without moving the caret.
      const key = pos + ":" + len;
      let from, to;
      if (this._tetherKey === key) {
        from = this._tetherFrom;
        to = this._tetherTo;
      } else {
        const span = this.tetherSpan(doc, pos);
        from = span ? span.from : -1;
        to = span ? span.to : -1;
        this._tetherKey = key;
        this._tetherFrom = from;
        this._tetherTo = to;
      }
      if (from < 0 || to < 0) return null;

      const a = view.coordsAtPos(from, 1) || view.coordsAtPos(from, -1);
      const b = view.coordsAtPos(to, 1) || view.coordsAtPos(to, -1);
      if (!a || !b) return null;

      // Same out-of-view guard the other caret readers use: CodeMirror will
      // happily return a clamped coordinate for a position scrolled off the
      // pane, which would stake the tether to the pane edge instead of to the
      // bracket. Drop the tether rather than draw a line to a lie.
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1;
        for (const c of [a, b]) {
          const cBottom = c.bottom ?? c.top;
          if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) return null;
        }
      }

      const segs = this.tetherSegments(view, from, to, a, b);
      return segs && segs.length ? segs : null;
    } catch {
      // A bad frame shouldn't kill the tick loop.
      return null;
    }
  }

  // The tether as one or more horizontal rules, ordered top to bottom, each
  // { x1, y1, x2, y2 } in viewport pixels.
  //
  // A pair that fits on one line is a single rule from the opener to the
  // closer. A pair that does NOT - because the text is long enough to soft-wrap
  // or because it genuinely spans several lines - used to be that same single
  // rule, which meant one long diagonal drawn from the opening bracket down and
  // across to the closing one: it sloped through the middle of everything in
  // between, struck out text it had nothing to say about, and gave no sense of
  // what the pair actually contained. So a multi-line span is now measured
  // per line instead, and each covered line gets its own level rule beneath
  // just the part of that line the pair spans - the whole span underlined,
  // rather than a chord cut across it.
  //
  // `a` and `b` are the already-resolved coordinates of the two brackets.
  tetherSegments(view, from, to, a, b) {
    // The rules run *under* the text rather than through it, so each sits just
    // below its line box. The closing end gets a glyph width added so the span
    // covers that character instead of stopping at its left edge.
    const drop = 1.5;
    const glyph = Math.max(3, (b.bottom - b.top) * 0.42);
    const flat = [{
      x1: a.left,
      y1: a.bottom + drop,
      x2: b.left + glyph,
      y2: b.bottom + drop,
    }];
    // Both brackets on the same line box: the two endpoints already describe
    // the whole rule, and none of the measuring below is needed.
    if (Math.abs(a.bottom - b.bottom) < 1) return flat;

    // Measuring line boxes means walking the DOM, which is far too expensive to
    // repeat on every frame for a span that hasn't moved. Scrolling translates
    // the whole span by a single delta, so a previous measurement can just be
    // shifted - and the two endpoints, which are resolved every frame anyway,
    // are the check that one translation really does explain the new layout.
    // If they disagree, something reflowed underneath us (a wrap point moved, a
    // fold opened, the pane resized) and the span is measured again.
    const key = from + ":" + to + ":" + view.state.doc.length;
    const cached = this._tetherSegs;
    if (cached && this._tetherSegKey === key && this._tetherAnchorA && this._tetherAnchorB) {
      const dx = a.left - this._tetherAnchorA.x;
      const dy = a.bottom - this._tetherAnchorA.y;
      if (Math.abs((b.left - this._tetherAnchorB.x) - dx) < 0.5 &&
          Math.abs((b.bottom - this._tetherAnchorB.y) - dy) < 0.5) {
        if (dx === 0 && dy === 0) return cached;
        return cached.map((s) => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }));
      }
    }

    // `to + 1` so the closing bracket's own glyph is inside the measured range,
    // which is what the `glyph` fudge above stands in for on the single-line
    // path.
    const rects = this.rangeLineRects(view, from, Math.min(view.state.doc.length, to + 1));
    const segs = rects.length >= 2
      ? rects.map((r) => ({ x1: r.left, y1: r.bottom + drop, x2: r.right, y2: r.bottom + drop }))
      : flat;

    this._tetherSegKey = key;
    this._tetherSegs = segs;
    this._tetherAnchorA = { x: a.left, y: a.bottom };
    this._tetherAnchorB = { x: b.left, y: b.bottom };
    return segs;
  }

  // The line boxes a document range occupies, as { left, right, bottom } in
  // viewport pixels, one entry per line, top to bottom.
  //
  // Measured through a DOM Range rather than through coordsAtPos because only
  // the DOM knows where a soft-wrapped line actually breaks: getClientRects
  // hands back one rect per line box, so a span that wraps comes back already
  // split at its wrap points, with proportional glyph widths and bidi runs
  // accounted for. CodeMirror can only answer "where is offset N", which would
  // find the hard line breaks and miss every soft one - i.e. exactly the case
  // this is here for.
  //
  // One Range per logical line, rather than one Range for the whole span, on
  // purpose: a Range that FULLY contains a .cm-line element also reports that
  // element's own border box, which is the full width of the editor, so every
  // middle line would measure as a full-width rule running way past the end of
  // its text. Keeping each Range strictly inside one line means only the text
  // within it is ever measured.
  rangeLineRects(view, from, to) {
    const doc = view.state.doc;
    const out = [];
    if (to <= from) return out;
    const first = doc.lineAt(from);
    const last = doc.lineAt(to);
    // A pair spanning more than a screenful can't be usefully underlined and
    // isn't worth the measuring; the caller falls back to the single rule.
    if (last.number - first.number > 300) return out;
    const ownerDoc = view.dom.ownerDocument;

    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n);
      const s = Math.max(from, line.from);
      const e = Math.min(to, line.to);
      // Blank line, or a line the span only touches at a break: nothing under
      // which to draw anything.
      if (e <= s) continue;

      let rects;
      try {
        const ds = view.domAtPos(s);
        const de = view.domAtPos(e);
        if (!ds || !de || !ds.node || !de.node) continue;
        const range = ownerDoc.createRange();
        range.setStart(ds.node, ds.offset);
        range.setEnd(de.node, de.offset);
        rects = range.getClientRects();
      } catch {
        // A line scrolled out of the rendered viewport, or hidden behind a fold
        // or a widget, has no DOM to measure. Skipping it beats abandoning the
        // whole tether.
        continue;
      }

      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r || r.width < 0.5 || r.height < 0.5) continue;
        // Styled runs inside one line box - a bold stretch, a link, a search
        // highlight - each report their own rect. Fold everything sharing a
        // baseline into a single span so the line gets one continuous rule
        // instead of a dashed row of fragments.
        let merged = false;
        for (const o of out) {
          if (Math.abs(o.bottom - r.bottom) < 1.5) {
            o.left = Math.min(o.left, r.left);
            o.right = Math.max(o.right, r.right);
            merged = true;
            break;
          }
        }
        if (!merged) out.push({ left: r.left, right: r.right, bottom: r.bottom });
      }
    }

    out.sort((p, q) => p.bottom - q.bottom || p.left - q.left);
    return out;
  }

  // Stroke for one rule of the tether, where that rule covers t0..t1 (as
  // fractions) of the whole run.
  //
  // With the gradient on, the ramp is spread across the entire span rather than
  // restarted on each line: the canvas gradient is anchored at the virtual
  // points where fractions 0 and 1 would land on this rule's own axis, so
  // consecutive lines pick up consecutive slices of one ramp and the tether
  // still reads as a single object, the way it does with the cursor.
  tetherStroke(ctx, s, t0, t1, alpha) {
    if (!this.settings.gradientEnabled) return hexToRgba(this.getActiveColor(), alpha);
    const span = Math.max(1e-4, t1 - t0);
    const ux = (s.x2 - s.x1) / span;
    const uy = (s.y2 - s.y1) / span;
    const g = ctx.createLinearGradient(
      s.x1 - ux * t0, s.y1 - uy * t0,
      s.x1 + ux * (1 - t0), s.y1 + uy * (1 - t0),
    );
    const stops = this.gradientStops();
    for (let i = 0; i < stops.length; i++) {
      const [r, gg, b] = hexToRgbTuple(stops[i]);
      g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, `rgba(${r}, ${gg}, ${b}, ${alpha})`);
    }
    return g;
  }

  drawBracketTether() {
    const segs = this.bracketTether;
    if (!segs || !segs.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const opacity = Math.max(0, Math.min(1, this.settings.cursorOpacity ?? 1));
    const strength = Math.max(0, Math.min(1, this.settings.bracketTetherStrength ?? 0.35));
    const alpha = strength * opacity;
    if (alpha <= 0.01) return;

    // Total length of the run, so the gradient can be spread across every rule
    // as one ramp (see tetherStroke) instead of restarting on each line.
    const lens = [];
    let total = 0;
    for (const s of segs) {
      const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      lens.push(l);
      total += l;
    }
    // Caret sitting right on its own match (an empty pair): nothing to underline.
    if (total < 2) return;

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";

    // Short ticks turning up toward the text, at the opening bracket and at the
    // closing one only - NOT at the end of every rule. They mark where the pair
    // begins and ends, so putting them on each line's edge would claim a
    // boundary at every wrap point, which is precisely the thing the reader
    // should be able to ignore.
    const tick = 4;
    const last = segs.length - 1;
    let run = 0;

    for (let i = 0; i <= last; i++) {
      const s = segs[i];
      const len = lens[i];
      if (len < 0.5) continue;
      ctx.strokeStyle = this.tetherStroke(ctx, s, run / total, (run + len) / total, alpha);
      run += len;

      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      if (i === 0) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x1, s.y1 - tick);
      }
      if (i === last) {
        ctx.moveTo(s.x2, s.y2);
        ctx.lineTo(s.x2, s.y2 - tick);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Damage covers every rule plus the ticks standing above them. One box over
    // the lot rather than one per line: the rules are stacked a line apart, so
    // per-line boxes would cover nearly the same area for more bookkeeping.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of segs) {
      minX = Math.min(minX, s.x1, s.x2);
      maxX = Math.max(maxX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2);
      maxY = Math.max(maxY, s.y1, s.y2);
    }
    const pad = tick + 4;
    this._markDirty(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2);
  }

  // Puts the canvas layer into (or back out of) a blend mode, which is what
  // cursorTranslucent actually is.
  //
  // This CANNOT be done with ctx.globalCompositeOperation. The cursor canvas
  // is its own layer stacked over the editor, so a canvas-level "multiply"
  // blends against what this canvas has already painted this frame - nothing,
  // it was just cleared - not against the text underneath. Real backdrop
  // blending has to come from CSS.
  //
  // And it has to go on the WRAPPER, not the canvas. The wrapper is
  // position:fixed with a z-index, which makes it a stacking context, and a
  // stacking context confines its descendants' blending to itself: a
  // mix-blend-mode on the canvas inside would blend against the wrapper's own
  // empty background and produce no visible change at all. On the wrapper the
  // blend applies to the whole group against its parent's content - i.e. the
  // editor. (Which also means an `isolation: isolate` anywhere between the
  // wrapper and .app-container would silently turn this feature off. Don't
  // add one, in either file.)
  //
  // Multiply darkens and screen lightens, so which of the two reads as ink on
  // the page depends on what's behind it: multiply on a light theme, screen
  // on a dark one. Picking by theme keeps the cursor legible in both instead
  // of sinking into the background in one of them.
  //
  // Called from the draw dispatch, before the per-style branch, so it runs on
  // every frame regardless of style - including the frames that have to CLEAR
  // it. Writes only on change: a blend-mode style write forces the compositor
  // to re-evaluate the layer, so doing it per frame would cost real work to
  // set the value it already had.
  applyCanvasBlend() {
    const el = this.canvasWrapper;
    if (!el) return;
    const want = this.styleFor("cursorTranslucent")
      ? (this.isDarkTheme() ? "screen" : "multiply")
      : "normal";
    if (this._canvasBlend === want) return;
    this._canvasBlend = want;
    el.style.mixBlendMode = want;
  }

  drawBoxCursor() {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.settings;
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

    ctx.save();
    this.forEachTrailPoint((p, alpha, age) => {
      if (settings.crtNeon) {
        // Neon draws the box's own footprint as a glowing tube - the same
        // width and height as the live box cursor, filled even when the box is
        // hollow (a hollow outline of a glowing tail just reads as noise).
        this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, alpha * bodyOpacity, age, color);
      } else if (hollow) {
        ctx.strokeStyle = this.trailPaint(ctx, p, alpha * bodyOpacity, age, color);
        ctx.lineWidth = strokeW;
        // Inset by half the stroke so the outline lands inside the same
        // footprint the filled trail dot would occupy (canvas strokes
        // straddle the path centerline).
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
        ctx.fillStyle = this.trailPaint(ctx, p, alpha * bodyOpacity, age, color);
        this.fillTrailRect(ctx, p.x, p.y, p.w, p.h);
      }
    });
    ctx.restore();

    const active = this.animActive;
    if (active) {
      const blinkAlpha = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);

      ctx.save();
      if (settings.crtEffect && settings.glow) {
        // Canvas draws a shape's shadow BEHIND that shape, so the halo of a
        // solid box lands exactly where you want it - visible around the
        // outside, hidden under the fill. Nothing extra is needed: just arm
        // the shadow and paint the box normally, the same as the Line and
        // Underline styles do.
        //
        // This used to "seed" the shadow with a ghost pre-fill at alpha 0.01
        // and then set shadowBlur back to 0 before the real paint, which meant
        // the box got no glow at all: a canvas shadow inherits the alpha of
        // the shape casting it, so a 0.01-alpha ghost casts a 0.01-alpha
        // shadow (invisible), and zeroing the blur afterwards disarmed the
        // only paint that could have produced a visible one. Hollow boxes
        // looked fine purely because they skipped that branch. Don't
        // reintroduce a pre-fill pass here.
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * blinkAlpha * this.glowHeatScale();
      }

      // Signal Glitch takes over the body of the cursor entirely while a burst
      // is live - it replaces the fill/stroke rather than layering on top,
      // because the whole point is that the cursor's own form comes apart. The
      // glow armed above still applies, so the break-up keeps its halo.
      // Resolved before paintStyle so a burst skips the (possibly expensive,
      // e.g. Aurora's per-pixel raster) beam paint it's about to discard.
      const gsBox = settings.crtEffect && settings.crtGlitch
        ? this.glitchState(now) : null;

      if (gsBox) {
        this.paintGlitchRect(
          ctx, active.x, active.top, renderW, active.h,
          color, 0.9 * blinkAlpha * bodyOpacity, gsBox,
        );
      } else {
      const paintStyle = settings.energyEffect
        ? this.energyPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * bodyOpacity)
        : this.cursorPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * bodyOpacity);
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
      const displayChar = this.pending ? this.pending.holdChar : (active.holdChar || active.char);

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
        const metrics = ctx.measureText(displayChar);
        const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? active.fontSize * 0.8;
        const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? active.fontSize * 0.2;
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
        const snapX = (v) => Math.round((v - ox) * dpr) / dpr + ox;
        const snapY = (v) => Math.round((v - oy) * dpr) / dpr + oy;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(displayChar, snapX(active.x + glyphAdvance / 2), snapY(baselineY));
        ctx.restore();
      }
    }
  }

  enableTorchOverlay() {
    this.torchEngineActive = true;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;

    const schedule = () => {
      if (!this.torchEngineActive) return;
      if (this._torchGear === "hot") {
        this.torchRaf = window.requestAnimationFrame(tick);
        return;
      }
      // Parked or hidden: a heartbeat is plenty to notice the effect being
      // re-enabled, a mode switch, or the pane moving. Blink Sync asks for a
      // middle cadence instead - fast enough to render the blink's fades
      // smoothly, slow enough not to be the hot gear. Both from FRAME_CAPS.
      const caps = this._frameCaps();
      const delay = this._torchGear === "pulse" ? caps.torchPulseMs : caps.torchIdleMs;
      this._torchIdleT = window.setTimeout(() => {
        this._torchIdleT = 0;
        if (this.torchEngineActive) this.torchRaf = window.requestAnimationFrame(tick);
      }, delay);
    };

    const tick = () => {
      if (!this.torchEngineActive) return;
      this._torchGear = "idle";
      try {
        // Swap in the effective (per-mode when active) settings for the whole
        // frame so the spotlight's on/off state, color, size and follow speed
        // can all differ per Vim mode. Structured without early returns so the
        // frame is always rescheduled at the bottom.
        const _mode = this.currentVimMode();
        const _real = this.settings;
        this.settings = this.effectiveSettings(_mode);
        this._settingsSwapped = true;
        try {
          if (this.presentationActive()) {
            // Same presentation-mode guard as the canvas engine.
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
          } else if (!this.settings.torchEffect) {
            // This mode (or the global cursor) doesn't want the spotlight — just
            // hide it. Don't disable the engine: another mode may want it, and
            // switching back should be instant.
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
          } else if (
            !this.windowFocused() &&
            this.settings.overlayBlinkSync && this.settings.blinkingEnabled
          ) {
            // Window is not the focused OS window, so the canvas engine has
            // already parked and taken the cursor off screen (see its own tick).
            // With Blink Sync on, the light is meant to track the cursor's
            // visibility - and right now the cursor is showing nothing - so the
            // light should show nothing too, rather than sitting there fully lit
            // over an empty pane pointing at a caret that isn't drawn.
            //
            // Scoped to Blink Sync deliberately: a plain torch with no blink
            // coupling is an ambient reading light, and dousing that on every
            // alt-tab would be its own annoyance. This is the one mode whose
            // whole premise is "the light follows whether the cursor is shown".
            //
            // Closed rather than hidden: with hideOnWindowBlur off the caret
            // itself stays visible on blur, and yanking the whole overlay would
            // pop the darkness off in one frame.
            //
            // All the way shut, NOT to the pulse's floor. Mid-blink the light
            // only dips to (1 - depth) because the caret is back in a fraction
            // of a second; on blur it's gone until you return, so "the cursor
            // isn't shown, don't light up" means fully out, whatever the depth.
            //
            // Ramped shut over frames rather than written straight to the floor:
            // the overlay's only CSS transition is on opacity, not on the radius
            // (the pulse's smoothness comes entirely from the tick writing a new
            // radius each frame), so a single 1px write would SNAP the darkness
            // in. Easing it here keeps the loop in the "pulse" gear until it
            // arrives, which is the one gear that runs while nothing else does -
            // hence the ~5% cost note on Blink Sync in the first place. The 1px
            // floor (not 0) is the same degenerate-gradient guard the pulse
            // uses. On refocus the normal branch takes over and eases it open
            // the same way.
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            if (this.overlay) {
              this.overlay.classList.remove("cursor-smith-torch-hidden");
              const from = this._lastTorchRadius > 0 ? this._lastTorchRadius : this.settings.overlayRadius;
              // Geometric approach to 1px: at ~28%/frame a 300px light closes
              // in roughly a dozen pulse-cadence frames (~0.5s), quick enough to
              // read as a response to leaving rather than a slow fade. The last
              // couple of pixels are snapped to the 1px floor rather than chased
              // geometrically - rounding has a fixed point at 2px, and without
              // the snap the loop would sit in the pulse gear forever rewriting
              // an unchanged value instead of parking at the idle heartbeat.
              const stepped = Math.round(from - (from - 1) * 0.28);
              const next = stepped <= 2 ? 1 : stepped;
              if (next !== this._lastTorchRadius) {
                this._lastTorchRadius = next;
                const box = this._overlayBox;
                if (box) {
                  this._torchPaintDarkness([{ x: this.x - box.left, y: this.y - box.top }], next,
                    this.settings.overlayDarkness, box.width, box.height);
                }
                // Still closing: hold the pulse cadence. Once it lands on 1px
                // the gear stays "idle" and the loop drops to the heartbeat.
                if (next > 1) this._torchGear = "pulse";
              }
            }
          } else {
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            if (view) this.registerWindowEvents(view.dom.ownerDocument);

            if (this.overlay) {
              // Re-apply overlay CSS variables only when the effective look
              // actually changed (per-mode color/size/etc.), to avoid style
              // churn every frame.
              const sig = [
                this.settings.overlayRadius, this.settings.overlayDarkness,
                this.settings.overlayIntensity, this.settings.overlayColor,
              ].join("|");
              if (sig !== this._overlaySig) {
                this._overlaySig = sig;
                this.applyOverlayStyle();
              }

              const useMouse = this.updateOverlayTarget();
              const lerp = this.settings.overlaySpeed;
              this.x += (this.tx - this.x) * lerp;
              this.y += (this.ty - this.y) * lerp;

              // Still chasing the target => keep animating at full rate.
              // Settled => snap exactly onto the target (so the lerp can't
              // asymptote forever) and let the loop park; mouse movement and
              // caret activity wake it via _markActivity/_wakeTorch.
              const settled =
                Math.abs(this.tx - this.x) < 0.25 && Math.abs(this.ty - this.y) < 0.25;
              if (!settled) this._torchGear = "hot";
              else { this.x = this.tx; this.y = this.ty; }
              // The secondaries' lights, eased the same way. `useMouse` is
              // what updateOverlayTarget returned above.
              const spots = this.torchSpotlights(useMouse, lerp);

              const r = this.getPaneRect(view);
              // Sparing the sidebars means dimming only the editor pane, which
              // only makes sense when the sidebars are side-by-side panes. On
              // mobile they're sliding drawers over the content, so clipping to
              // the pane just leaves the shading inconsistent - fall back to the
              // full-viewport dim there regardless of the toggle.
              const isMobile = this.overlay.ownerDocument.body.classList.contains("is-mobile");
              const usePane = r && this.settings.overlaySpareSidebars && !isMobile;
              // Even when not sparing the sidebars, the overlay must never
              // cover the titlebar - getFullViewportRect clamps around it.
              const rect = usePane ? r : this.getFullViewportRect(this.overlay.ownerDocument);

              const top = Math.round(rect.top);
              const left = Math.round(rect.left);
              const width = Math.round(rect.width);
              const height = Math.round(rect.height);
              const key = top + "," + left + "," + width + "," + height;
              if (key !== this._lastOverlayRect) {
                this._lastOverlayRect = key;
                this.overlay.style.top = top + "px";
                this.overlay.style.left = left + "px";
                this.overlay.style.width = width + "px";
                this.overlay.style.height = height + "px";
              }

              // Resolved up here rather than at the point of use, because the
              // pulse below has to stand down while the overlay is hidden: a
              // hidden overlay has nothing to breathe, and the settings window
              // is itself a modal - so without this, opening the panel to turn
              // Blink Sync on would leave the torch pulsing away behind it for
              // as long as the panel stayed open.
              const hideForModal = this.settings.overlaySpareSidebars && this.modalOpen;

              // Blink Sync: the spotlight breathes with the caret, opening to
              // full size while the caret is lit and closing as it fades out.
              //
              // Driven from this tick, never from a CSS animation - see the
              // long note in styles.css about the candle flicker that used to
              // live there. blinkPhase() rather than blinkAlphaAt() on purpose:
              // it already accounts for the post-move hold, so the light holds
              // steady for exactly as long as the caret does after you type,
              // instead of breathing out of step with it - and it's the phase
              // rather than the alpha so the light still follows a caret that
              // is Breathing instead of fading.
              const pulse = !hideForModal &&
                !!this.settings.overlayBlinkSync && !!this.settings.blinkingEnabled;
              let radius = this.settings.overlayRadius;
              if (pulse) {
                // Allowed all the way to 1, which is the setting that makes the
                // torch go out completely while the caret is blinked off: the
                // light closes to nothing rather than merely narrowing.
                const depth = Math.max(0, Math.min(1, this.settings.overlayBlinkDepth ?? 0.25));
                radius *= 1 - depth * (1 - this.blinkPhase(performance.now()));
                // Not the hot gear: see FRAME_CAPS.torchPulseMs. Only claimed if
                // nothing above already asked for hot - a spotlight still
                // chasing the caret outranks this.
                if (this._torchGear === "idle") this._torchGear = "pulse";
              }
              // Rounded to whole pixels and written only on a real change. This
              // is what makes the pulse affordable: the blink spends most of its
              // cycle in a hold, where the rounded radius doesn't move and no
              // style is touched at all, so only the two fades per cycle
              // actually repaint the blended overlay.
              // Floored at 1px rather than allowed to reach 0. A zero-radius
              // radial-gradient is degenerate and engines disagree about which
              // stop wins - and if the FIRST one did, "the light goes out"
              // would render as the warm colour washed across the whole pane,
              // the exact opposite of the intent. A 1px circle is well-defined
              // and, against a pane-sized dark field, invisible.
              const rKey = Math.max(1, Math.round(radius));
              this._lastTorchRadius = rKey;

              // Candle flicker. Driven from this tick so it stays under the
              // frame governor, never from a CSS animation - the reference does
              // it as a keyframe animation, which is exactly the implementation
              // this codebase deleted once already (it runs on the compositor
              // and pins the display at full refresh for as long as the torch
              // is lit, whatever gear the loops chose).
              //
              // Applied to the GLOW ONLY, not to the darkness. Flickering the
              // dark layer as well makes the whole page pulse, which is a very
              // different and much more distracting effect; the reference
              // flickers only the warm core, and it is right to.
              const hidden = hideForModal;
              const fScale = (!hidden && this.settings.overlayFlicker)
                ? torchFlickerScale(performance.now(),
                    this.settings.overlayFlickerAmount ?? 0.3)
                : 1;
              if (fScale !== 1 && this._torchGear === "idle") {
                // Same gear as the blink pulse. A flame is turbulence, not
                // motion: 30fps resolves it, and it must never claim hot.
                this._torchGear = "pulse";
              }

              // ---- The warm core -------------------------------------------
              // The darkness layer composites normally and can only subtract
              // light. Adding any requires a second, additive layer - this one.
              // Built only while Glow Strength is above 0, because a blended
              // layer costs a re-composite of everything beneath it whether or
              // not it paints anything.
              const baseI = this.settings.overlayIntensity;
              const glow = this._ensureGlowLayer(!hidden && baseI > 0);
              // Every light, in the overlay's own coordinates. Both layers
              // are canvases (TORCH_CANVAS_SCALE) repainted only when a
              // light moved, the radius changed, or a setting did - the
              // painters dedupe on a key, so a parked light costs nothing.
              const local = spots.map((sp) => ({ x: sp.x - left, y: sp.y - top }));
              this._overlayBox = { top, left, width, height };
              this._torchPaintDarkness(local, rKey, this.settings.overlayDarkness, width, height);
              if (glow) {
                if (key !== this._lastGlowRect) {
                  this._lastGlowRect = key;
                  glow.style.top = top + "px";
                  glow.style.left = left + "px";
                  glow.style.width = width + "px";
                  glow.style.height = height + "px";
                }
                // Glow Strength and the flicker scale the whole layer's
                // opacity - a compositor-only change, so the flicker never
                // repaints the bitmap. Quantised to 2dp: the flicker's swing
                // at the default depth is 0.15, and 15 steps across it are
                // not visible, while 3dp wrote nearly every frame.
                const gAlpha = Math.max(0, Math.min(1, baseI * fScale)).toFixed(2);
                if (gAlpha !== this._lastGlowAlpha) {
                  this._lastGlowAlpha = gAlpha;
                  glow.style.setProperty("--torch-glow", gAlpha);
                }
                this._torchPaintGlow(local, rKey, hexToRgb(this.settings.overlayColor), width, height);
              }

              this.overlay.classList.toggle("cursor-smith-torch-hidden", !!hideForModal);
            }
          }
        } finally {
          this.settings = _real;
          this._settingsSwapped = false;
        }
      } catch (e) {
        if (!this._torchErrorLogged) {
          this._torchErrorLogged = true;
          console.error("[cursor-smith] torch tick error (loop kept alive):", e);
        }
      }
      schedule();
    };
    this._torchTick = tick;
    this._torchGear = "hot";
    this.torchRaf = window.requestAnimationFrame(tick);
  }

  // True when the element is actually painted (not display:none, hidden,
  // or fully transparent). Used by _chromeInsets to decide whether the
  // STATUS BAR should clamp the overlay: an invisible-but-in-flow status
  // bar (zen-mode themes hide it via opacity so it can reveal on hover)
  // shouldn't leave a dead unshaded strip. Deliberately NOT used for the
  // titlebar - see _chromeInsets for why the titlebar clamps regardless
  // of visibility.
  _isVisiblyRendered(el) {
    if (!el) return false;
    const win = el.ownerDocument.defaultView || window;
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) <= 0.01) return false;
    return true;
  }

  // Cached top/bottom insets around Obsidian's window chrome, refreshed at
  // most every 500ms (or on window resize via _bumpChromeInsets). Both tick
  // loops need these every frame; uncached, that's 2 querySelectors + 2
  // getBoundingClientRects + 2 getComputedStyles per frame per loop, which
  // is measurable jank on weak GPUs (ChromeOS Crostini) - and Chromium has
  // a known slow path where layout reads get more expensive whenever any
  // app-region: drag element exists in the document, which is always true
  // in frameless Obsidian.
  //
  // Titlebar: clamps whenever it occupies layout space, VISIBLE OR NOT.
  // Drag hit-testing doesn't care about visibility - an opacity-0 titlebar
  // (zen-mode themes) still owns the window's drag region, and covering it
  // breaks dragging just the same. Drag correctness beats the cosmetic
  // cost of a few undarkened pixels.
  //
  // Status bar: clamps only when visibly rendered. It has no drag role, so
  // for an invisible-but-in-flow status bar the clamp would just leave a
  // dead unshaded strip for no benefit (the concern _isVisiblyRendered was
  // originally written for).
  _chromeInsets(doc) {
    // performance.now() like every other timestamp in this file. Both this and
    // its cache stamp were Date.now(), which was self-consistent but is a wall
    // clock: an NTP correction or a DST jump can move it backwards, and this
    // cache would then hold a stale inset for as long as the clock was behind.
    const now = performance.now();
    const c = this._chromeCache;
    if (c && c.doc === doc && now - c.t < 500) return c;

    let top = 0;
    const titleBar = doc.querySelector(".titlebar");
    // is-hidden-frameless: titlebar element exists but contains no visible
    // content (window controls hidden). The tab bar spacers are the drag
    // surface but they're visually transparent - we can paint over them
    // since our overlay has no app-region declaration and doesn't affect
    // Electron's drag hit-testing. Start from t:0 in this mode.
    // is-frameless (without is-hidden-frameless): custom titlebar IS visible,
    // clamp below it so we don't cover the window controls.
    const isHiddenFrameless = doc.body.classList.contains("is-hidden-frameless");
    if (titleBar && !isHiddenFrameless) {
      const tb = titleBar.getBoundingClientRect();
      if (tb.height > 0 && tb.top <= tb.height) top = Math.max(top, tb.bottom);
    }
    // When there's no titlebar at all (native frame style or non-Electron),
    // tab bars at t:0 are still the drag surface but again our overlay
    // doesn't affect app-region so no clamp needed there either.
    // Only clamp against tab bars when a VISIBLE titlebar pushes them down
    // and we need to cover the gap between titlebar bottom and tab bar bottom.

    // No bottom clamp for the status bar. It sits above our overlay via its
    // own stacking context (the overlay is z-index:9990 and the status bar
    // renders on top naturally). Clamping to sb.top was incorrectly cutting
    // the torch overlay short before the status bar, leaving the bottom of
    // the note unilluminated. The original file had no bottom clamp here.

    // Bottom inset: the height a visibly-rendered status bar occupies at the
    // window's bottom edge. This is deliberately NOT applied to the torch
    // overlay (z-9990) - that renders beneath the status bar and is meant to
    // reach the window bottom, which is the illumination regression the note
    // above is about. It is applied only to the cursor CANVAS (z-9999), which
    // would otherwise paint over the status bar (worst while scrolling, when
    // the pane's own bottom briefly reaches the window edge). An
    // invisible-but-in-flow status bar is skipped, same as the top clamp.
    let bottomInset = 0;
    let statusLeft = 0, statusRight = 0;
    const statusBar = doc.querySelector(".status-bar");
    if (statusBar && this._isVisiblyRendered(statusBar)) {
      const sb = statusBar.getBoundingClientRect();
      const win = doc.defaultView || window;
      // Only when it's actually parked at the window's bottom edge, so a
      // mispositioned or stale-rect bar can't pull the clip up over content.
      if (sb.height > 0 && sb.bottom >= win.innerHeight - 1) {
        bottomInset = Math.max(0, win.innerHeight - sb.top);
        // Its horizontal extent too: a floating status bar is usually a
        // pill at the bottom right, and the clip has to spare only THAT,
        // not the whole bottom band (see wrapperClipForStatusBar).
        statusLeft = sb.left;
        statusRight = sb.right;
      }
    }

    this._chromeCache = { doc, t: now, top, bottomInset, statusLeft, statusRight };
    return this._chromeCache;
  }

  // Full-window rect minus the window chrome. Never returns a rect that
  // overlaps the titlebar: a full-viewport fixed-position layer sitting
  // over the titlebar - even one with pointer-events: none - breaks
  // Electron's native window-drag hit-testing on frameless/custom-titlebar
  // windows (Electron composes drag regions in DOM order; z-index and
  // pointer-events don't participate). Seen in the wild on Linux X11 (KDE)
  // and ChromeOS Crostini: window resizes fine, refuses to move.
  // Note: when Obsidian runs with the NATIVE frame there's no .titlebar in
  // the DOM at all - and none is needed, because the OS titlebar lives
  // outside the web contents where nothing we render can cover it. The
  // zero inset we compute in that case is correct, not a missed clamp.
  getFullViewportRect(doc) {
    const win = doc.defaultView || window;
    const { top } = this._chromeInsets(doc);
    const bottom = win.innerHeight; // no bottom clamp - status bar stacks above us
    if (bottom <= top) {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    }
    return {
      top,
      bottom,
      left: 0,
      right: win.innerWidth,
      width: win.innerWidth,
      height: bottom - top,
    };
  }

  // Clip rect for a caret that isn't in the note editor: the Settings tab's
  // scroll frame, a modal body, the file tree, and so on. Returns the
  // intersection of every clipping ancestor of the focused field, or null when
  // it has none (then the caller falls back to the viewport, as before).
  //
  // The editor path clips the canvas to the pane so the cursor physically
  // cannot paint outside it; this path had no equivalent and handed back the
  // whole viewport, so a caret in a Settings text box was free to paint
  // anywhere. It only showed up while scrolling, because getBoundingClientRect
  // keeps reporting a position for an input that has scrolled out of its own
  // scroll container - the DOM clips the element, the geometry doesn't - so
  // the cursor was still drawn at that position: outside the settings frame,
  // over the main window, and over the titlebar.
  getCaretClipRect(doc) {
    const active = doc && doc.activeElement;
    if (!active || active === doc.body) return null;

    // Resolving the chain costs a getComputedStyle per ancestor, so it's
    // cached against the focused element - the chain only changes when focus
    // does, but the RECTS have to be re-read every frame because scrolling is
    // exactly what moves them.
    if (this._clipChainFor !== active) {
      this._clipChainFor = active;
      this._clipChain = this._resolveClipChain(active);
    }
    const chain = this._clipChain;
    if (!chain || !chain.length) return null;

    const win = doc.defaultView || window;
    const { top: chromeTop } = this._chromeInsets(doc);
    let top = chromeTop, left = 0;
    let bottom = win.innerHeight, right = win.innerWidth;

    for (const el of chain) {
      // Focus moved on and the old chain is stale (settings closed, modal
      // torn down). Drop the cache and let the viewport fallback apply until
      // the next frame resolves a fresh chain.
      if (!el.isConnected) {
        this._clipChainFor = null;
        return null;
      }
      const b = el.getBoundingClientRect();
      if (b.top > top) top = b.top;
      if (b.left > left) left = b.left;
      if (b.bottom < bottom) bottom = b.bottom;
      if (b.right < right) right = b.right;
    }

    if (bottom <= top || right <= left) return null;
    return { top, bottom, left, right, width: right - left, height: bottom - top };
  }

  // Every ancestor of `el` that actually clips it, nearest first. Walking
  // stops short of <body>/<html>: those are covered by the viewport clamp in
  // getCaretClipRect, and their rects can legitimately exceed the viewport.
  //
  // "Actually clips" is not the same as "has overflow" - CSS positioning lets
  // an element escape its ancestors' overflow, and getting that wrong here
  // means clipping a cursor away to nothing, which is a worse bug than the one
  // this whole path exists to fix. So: a fixed-positioned element is clipped
  // by nothing above it, and an absolutely-positioned one is only clipped by
  // ancestors that are themselves positioned (its containing block and up).
  // Popovers, suggestion dropdowns and tooltips all rely on exactly this.
  _resolveClipChain(el) {
    const chain = [];
    try {
      const doc = el.ownerDocument;
      const win = doc.defaultView || window;
      let curPos = win.getComputedStyle(el).position;
      if (curPos === "fixed") return chain;

      let node = el.parentElement;
      let guard = 0;
      while (node && node !== doc.body && node !== doc.documentElement && guard++ < 24) {
        const st = win.getComputedStyle(node);
        const positioned = st.position !== "static";
        const clips = st.overflowX !== "visible" || st.overflowY !== "visible";
        // An absolute box ignores clipping by anything that isn't at least
        // its containing block.
        if (clips && (curPos !== "absolute" || positioned)) chain.push(node);
        if (positioned) {
          if (st.position === "fixed") break;
          curPos = st.position;
        }
        node = node.parentElement;
      }
    } catch {
      return [];
    }
    return chain;
  }

  getPaneRect(view) {
    if (!view) return null;
    // Called twice a frame (the clip window and the caret's out-of-view
    // test); a getBoundingClientRect each time. Cached on the layout
    // generation and a short TTL, like the caret geometry: the pane does not
    // move on an inner scroll, and everything that does move it bumps the
    // generation.
    const now = performance.now();
    const pc = this._paneRectCache;
    if (pc && pc.view === view && pc.gen === (this._layoutGen | 0) && (now - pc.t) < GEOMETRY_TTL_MS) return pc.rect;
    const rootEl = view.dom.closest(".cm-editor") || view.dom.closest(".workspace-leaf");
    if (!rootEl) return null;
    const rect = rootEl.getBoundingClientRect();
    const out = this._paneRectFrom(rect, rootEl);
    this._paneRectCache = { view, gen: this._layoutGen | 0, t: now, rect: out };
    return out;
  }

  _paneRectFrom(rect, rootEl) {

    // Clipping to the pane's own rect assumes the titlebar/status bar take
    // up real space in flow, pushing the pane to stop short of them. Some
    // themes float those bars over the pane instead (fixed/absolute), so
    // the pane's rect extends underneath - and our z-index 10000 canvas
    // would paint over them, with the same drag-breaking consequence as
    // the full-viewport case for the titlebar. Clamp against the cached
    // chrome insets (cheap - no extra layout reads per frame).
    const doc = rootEl.ownerDocument;
    const { top: chromeTop } = this._chromeInsets(doc);
    const top = Math.max(rect.top, chromeTop);
    const bottom = rect.bottom; // no bottom clamp - status bar stacks above us

    if (bottom <= top) return rect;

    return {
      top,
      bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: bottom - top,
    };
  }

  // Sets this.tx/ty, the primary spotlight's target. Returns true when the
  // torch is following the mouse - in which case there is one light and
  // the secondaries get none (torchSpotlights).
  updateOverlayTarget() {
    const mode = this.settings.overlayFollowMode;
    const caret = this.caretCoords();
    if (caret) {
      if (!this.lastCaret || caret.x !== this.lastCaret.x || caret.top !== this.lastCaret.top) {
        this.lastCaretMove = performance.now();
      }
      this.lastCaret = caret;
    }

    const useMouse =
      mode === "mouse" ||
      (mode === "auto" && (performance.now() - this.lastMouseMove < 800 || !this.lastCaret));

    if (useMouse) {
      this.tx = this.mouseX;
      this.ty = this.mouseY;
    } else if (this.lastCaret) {
      this.tx = this.lastCaret.x;
      this.ty = (this.lastCaret.top + this.lastCaret.bottom) / 2;
    }
    return !!useMouse;
  }

  // Every spotlight this frame: the primary's (already eased to this.x/y by
  // the torch tick) and one per full-effect secondary, each chasing its own
  // caret at the same easing. Returns [{x, y}] in client coordinates, and
  // sets this._torchGear hot while any secondary is still en route. With
  // the torch on the mouse there is one light, so only the primary's.
  torchSpotlights(useMouse, lerp) {
    const spots = [{ x: this.x, y: this.y }];
    const states = this._secondaries;
    if (useMouse || !states || !states.length) return spots;
    for (const st of states) {
      const a = st.animActive;
      if (!a) { st.torchX = st.torchY = undefined; continue; }
      const tx = a.x;
      const ty = a.top + (a.h || 0) / 2;
      if (st.torchX === undefined || st.torchY === undefined) { st.torchX = tx; st.torchY = ty; }
      st.torchX += (tx - st.torchX) * lerp;
      st.torchY += (ty - st.torchY) * lerp;
      if (Math.abs(tx - st.torchX) < 0.25 && Math.abs(ty - st.torchY) < 0.25) {
        st.torchX = tx; st.torchY = ty;
      } else {
        this._torchGear = "hot";
      }
      spots.push({ x: st.torchX, y: st.torchY });
    }
    return spots;
  }
}

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
function paintTorchDarkness(ctx, w, h, spots, radiusPx, darkness) {
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

function paintTorchGlow(ctx, w, h, spots, radiusPx, warmRgb) {
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
function torchCanvasContext(el, w, h) {
  const bw = Math.max(1, Math.ceil(w * TORCH_CANVAS_SCALE));
  const bh = Math.max(1, Math.ceil(h * TORCH_CANVAS_SCALE));
  if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(TORCH_CANVAS_SCALE, 0, 0, TORCH_CANVAS_SCALE, 0, 0);
  return ctx;
}

class CursorSmithSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // -------------------------------------------------------------------------
  // The panel is declarative, the Obsidian 1.13 way: getSettingDefinitions()
  // returns the tree of groups and rows, Obsidian renders it, indexes every
  // row for settings search, and re-renders it IN PLACE - reconciling rows
  // by name, so the scroll position and every untouched row survive -
  // whenever update() is called. update() is what display() and the
  // per-section re-render used to be: every control that adds or removes
  // rows, and every preset load, calls it.
  //
  // Rows are `render` definitions: the name and description live on the
  // definition (that is what search sees), and the control is built in the
  // render callback with the same Setting API as before. The six global
  // toggles are `control` definitions, read and written through
  // getControlValue / setControlValue below. Nothing is built at definition
  // time except the tree itself, so this is cheap to call.
  //
  // The tree depends on the mode switch, the preset lists and which Vim mode
  // is being edited, and Obsidian renders the LAST definitions it was given
  // (it does not ask again on open) - so anything that changes those from
  // outside the panel goes through plugin.refreshSettingTab(), which calls
  // update().
  // -------------------------------------------------------------------------
  getSettingDefinitions() {
    const items = [this.globalGroup()];
    if ((this.plugin.settings.uiMode || "cua") === "vim") items.push(...this.vimDefinitions());
    else items.push(...this.normalDefinitions());
    return items;
  }

  // Obsidian re-renders the panel on update() and then puts keyboard focus
  // on the FIRST control of whichever row had it: the CUA half of the mode
  // switch after a click on Vim, the name box of the preset row after Save.
  // A focus the user did not put there reads as a stray cursor - this
  // plugin draws one wherever a text box has focus - so it is dropped, which
  // is what the old full rebuild did by emptying the panel.
  update() {
    super.update();
    try {
      const doc = this.containerEl.ownerDocument;
      const el = doc && doc.activeElement;
      if (el && el !== doc.body && this.containerEl.contains(el)) el.blur();
    } catch { /* not on screen; nothing has focus in it */ }
  }

  // The `control` rows read and write plugin.settings directly. Enable Plugin
  // is the one with a side effect: the engine starts or stops with it.
  getControlValue(key) {
    return this.plugin.settings[key];
  }

  async setControlValue(key, value) {
    this.plugin.settings[key] = value;
    if (key === "enabled") value ? this.plugin.enable() : this.plugin.disable();
    await this.plugin.saveSettings();
  }

  // -------------------------------------------------------------------------
  // Row and group builders. A group is a card with a heading; a row is one
  // Setting inside it. `depth` indents a row under the toggle (or the style
  // dropdown) it belongs to, so conditional sub-options read as a hierarchy
  // rather than a flat list.
  // -------------------------------------------------------------------------
  row(name, desc, build, depth = 0) {
    return {
      name,
      desc,
      render: (setting) => {
        this.resetRow(setting);
        if (depth) setting.settingEl.addClass("cursor-smith-sub", "cursor-smith-sub-" + Math.min(depth, 3));
        build(setting);
      },
    };
  }

  // Obsidian keeps a row's element across update() when its name matches
  // and empties its controls - but not its classes, so a row that changed
  // kind or depth between two renders would keep the old ones (a known
  // 1.13 issue). Every row builder starts from a clean slate.
  resetRow(setting) {
    setting.settingEl.removeClass(
      "cursor-smith-sub", "cursor-smith-sub-1", "cursor-smith-sub-2", "cursor-smith-sub-3",
      "cursor-smith-note-row", "cursor-smith-note-warning", "cursor-smith-subsection-row",
      "cursor-smith-color-row", "cursor-smith-reduced-notice");
  }

  // A muted note under a group's rows (no presets yet, what Command mode
  // covers), or the warning variant (Vim key bindings off).
  noteRow(text, { warning = false, visible } = {}) {
    const def = {
      name: "",
      desc: text,
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-note-row");
        if (warning) setting.settingEl.addClass("cursor-smith-note-warning");
      },
    };
    if (visible) def.visible = visible;
    return def;
  }

  // Small all-caps label splitting a run of rows into sub-groups (the torch's
  // "Spotlight" vs "Environment") without a card of its own.
  subheadingRow(title, depth = 0) {
    return {
      name: title,
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-subsection-row");
        if (depth) setting.settingEl.addClass("cursor-smith-sub", "cursor-smith-sub-" + Math.min(depth, 3));
      },
    };
  }

  // -------------------------------------------------------------------------
  // Collapsible cards. Obsidian's groups are not collapsible, so the card's
  // heading gets a chevron and the heading (or the chevron) toggles a class
  // that hides the card's rows. Which cards the user collapsed is remembered
  // for the session, keyed by title so adding a card does not shuffle it -
  // and in memory rather than in settings: it is panel state, not
  // configuration, and must not travel in a share code or a preset.
  // -------------------------------------------------------------------------
  section(title, items, { open = true } = {}) {
    return {
      type: "group",
      heading: title,
      cls: "cursor-smith-section",
      extraButtons: [this.collapseButton(title, open)],
      items,
    };
  }

  collapseButton(title, defaultOpen) {
    return (btn) => {
      const remembered = this._sectionOpen || (this._sectionOpen = {});
      const isOpen = () => remembered[title] ?? defaultOpen;
      // The button is already in the card's heading when this runs, so the
      // card is reachable from it - which is how the remembered state is
      // applied to a freshly built card without any private API.
      const groupEl = btn.extraSettingsEl.closest(".setting-group");
      const paint = () => {
        btn.setIcon(isOpen() ? "chevron-down" : "chevron-right");
        if (groupEl) groupEl.toggleClass("is-collapsed", !isOpen());
      };
      const toggle = () => {
        remembered[title] = !isOpen();
        paint();
      };
      btn.setTooltip("Collapse or expand").onClick(toggle);
      const header = btn.extraSettingsEl.closest(".setting-item-heading");
      // The heading toggles too, the way the old <summary> did; the chevron's
      // own click bubbles up here and must not count twice.
      header?.addEventListener("click", (ev) => {
        if (!btn.extraSettingsEl.contains(ev.target)) toggle();
      });
      paint();
    };
  }

  // The element that actually scrolls the settings pane. Obsidian's own
  // containerEl is usually it, but that is an implementation detail of the
  // settings modal rather than a promise, so walk up until something is
  // genuinely overflowing rather than assuming.
  _scrollHost() {
    let el = this.containerEl;
    for (let i = 0; el && i < 6; i++) {
      if (el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return this.containerEl;
  }

  // -------------------------------------------------------------------------
  // The first card: the plugin's name and version as its heading, the notice
  // for when the OS is suppressing motion, the six global switches, and the
  // CUA / Vim mode switch.
  //
  // The switches are structural rather than looks: none is in LOOK_KEYS, so
  // none is part of a preset or of a per-Vim-mode snapshot - they apply to
  // whatever cursor is on screen, in both modes.
  // -------------------------------------------------------------------------
  globalGroup() {
    const plugin = this.plugin;
    return {
      type: "group",
      // Read off the manifest rather than hardcoded, so a release is a
      // one-line edit in manifest.json.
      heading: `Cursor-Smith ${plugin.manifest?.version ?? ""}`.trim(),
      cls: "cursor-smith-global",
      items: [
        this.reducedMotionNotice(),
        {
          name: "Enable plugin",
          desc: "Hands you back Obsidian's own caret.",
          control: { type: "toggle", key: "enabled" },
        },
        {
          name: "Note editor only",
          desc: "Draws the cursor in notes only. Search, palettes, settings and modals keep Obsidian's caret.",
          control: { type: "toggle", key: "noteEditorOnly", defaultValue: false },
        },
        {
          name: "Hide real cursor",
          desc: "Hides the native primary cursor so only the custom one shows.",
          control: { type: "toggle", key: "hideNativeCaret" },
        },
        {
          name: "Hide cursor when unfocused",
          desc: "Hides the cursor while Obsidian isn't the active window.",
          control: { type: "toggle", key: "hideOnWindowBlur", defaultValue: true },
        },
        {
          name: "Low power mode",
          desc: "Halves every effect's frame rate. For battery, or if Obsidian feels slower with the plugin on.",
          control: { type: "toggle", key: "lowPowerMode", defaultValue: false },
        },
        {
          name: "Respect reduced motion",
          desc: "Switches off the moving effects when your system asks for reduced motion. The cursor's own look is untouched.",
          control: { type: "toggle", key: "respectReducedMotion", defaultValue: true },
        },
        {
          name: "Mode",
          desc: "One cursor for everything, or a cursor of its own for each Vim mode.",
          render: (setting) => this.renderModeSwitch(setting.controlEl),
        },
      ],
    };
  }

  // --- "Why is nothing moving?" ------------------------------------------
  // Reduced motion is deliberately invisible to the rest of the panel: the
  // suppression runs on the merged copy inside effectiveSettings(), never on
  // this.settings, so every toggle below keeps showing what the USER chose
  // (see applyReducedMotion). That is the right call for the data - a saved
  // preset must not be rewritten by an OS preference - but on its own it
  // produces the worst possible symptom: Motion smear and Smooth movement read
  // as ON and do nothing, with nothing anywhere saying why.
  //
  // This is the missing half. It says so, in the one place someone goes to
  // find out, and only while the OS is actually asking - the row is always
  // built and shown or hidden by its `visible` predicate, which Obsidian
  // re-evaluates after every control change.
  //
  // Windows is where this bites hardest, which is why it arrived as a bug
  // report from there. Turning off Settings > Accessibility > Visual effects >
  // Animation effects - or choosing "Adjust for best performance" in the old
  // Performance Options dialog, which does the same thing - sets
  // prefers-reduced-motion for every Chromium app on the machine. People do
  // that for speed, years earlier, with no idea it is an accessibility signal
  // that anything will later read.
  //
  // Deliberately NOT fixed by flipping the respectReducedMotion default: the
  // preference is real and honouring it by default is correct. The defect was
  // only ever that it was silent.
  reducedMotionNotice() {
    return {
      name: "Motion effects are off",
      desc: "Your system is set to reduce motion, so Smooth movement, Motion " +
            "smear and the other moving effects are suppressed - the toggles " +
            "below still show your own settings. Turn off \"Respect reduced " +
            "motion\" to override this.",
      searchable: false,
      visible: () => this.reducedMotionActive(),
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-reduced-notice");
        // This row is first in the panel, so it is where the panel's own
        // document gets registered - see registerPanelDocument.
        this.registerPanelDocument(setting.settingEl);
      },
    };
  }

  // Fail closed. reducedMotion() already swallows a missing matchMedia, but
  // it reads this.settings before its own try, and an explanatory banner is
  // never worth the risk of a broken panel.
  reducedMotionActive() {
    try {
      return !!this.plugin.reducedMotion();
    } catch (e) {
      console.error("[cursor-smith] reduced-motion check failed:", e);
      return false;
    }
  }

  // Since Obsidian 1.13 this panel renders in a window of its own, in a
  // document the engine has no other way to discover: documents are
  // otherwise learned from `view.dom.ownerDocument`, and the settings window
  // hosts no view. Registering it here is what lets _focusedForeignDoc offer
  // it as a canvas target, so the cursor can follow the caret into the
  // panel's own text boxes (preset names, share codes) the way it always
  // could when Settings was a modal in the main document. Set-guarded and a
  // no-op when the panel is in the main document. Fail closed: a nicety here
  // must never take the panel down.
  registerPanelDocument(el) {
    try {
      const panelDoc = el && el.ownerDocument;
      if (panelDoc && typeof document !== "undefined" && panelDoc !== document) {
        this.plugin.registerWindowEvents(panelDoc);
      }
    } catch (e) {
      console.error("[cursor-smith] could not register settings window:", e);
    }
  }

  // -------------------------------------------------------------------------
  // Segmented CUA/Normal <-> Vim switch. Selecting "Vim" turns Vim-aware
  // cursors on (and, per vimControlObsidian, flips Obsidian's own Vim
  // keybindings); selecting "CUA/Normal" turns them off. This one control is
  // both the panel switch and the feature's on/off switch.
  // -------------------------------------------------------------------------
  renderModeSwitch(containerEl) {
    const plugin = this.plugin;
    const current = plugin.settings.uiMode || "cua";

    // A segmented control; the look is styles.css's (.cursor-smith-segmented
    // / .cursor-smith-segment, is-active for the chosen one).
    const wrap = containerEl.createDiv({ cls: "cursor-smith-segmented" });

    const makeBtn = (label, key) => {
      const active = current === key;
      const btn = wrap.createEl("button", {
        text: label, cls: active ? "cursor-smith-segment is-active" : "cursor-smith-segment",
      });
      const switchMode = async () => {
        if ((plugin.settings.uiMode || "cua") === key) return;
        // Deliberately NOT setting uiMode here: setVimModeEnabled writes it
        // (keeping both flags in one place), and it needs the pre-click state
        // intact to decide whether the "restore Obsidian's vim" path applies.
        // Writing uiMode first blinded that check whenever the two flags had
        // drifted apart, silently skipping the restore.
        await plugin.setVimModeEnabled(key === "vim");
        this.update();
      };
      btn.addEventListener("click", () => { void switchMode(); });
      return btn;
    };

    makeBtn("CUA / Normal", "cua");
    makeBtn("Vim", "vim");
  }

  // -------------------------------------------------------------------------
  // The CUA / Normal panel: the preset library, then the look cards for the
  // global cursor.
  // -------------------------------------------------------------------------
  normalDefinitions() {
    const plugin = this.plugin;
    const set = (key) => async (v) => { plugin.settings[key] = v; await plugin.saveSettings(); };

    // Everything from "what does the cursor look like" through "what effects
    // does it use" is identical in shape whether it's this global cursor or
    // one Vim mode's own snapshot - see lookDefinitions, shared with
    // modeDefinitions below.
    return [
      this.presetsGroup(),
      ...this.lookDefinitions({
        get: (key) => plugin.settings[key],
        set,
        renderCursorStyleSetting: (setting, rerender) => {
          setting.addDropdown((dropdown) =>
            dropdown
              .addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
              .setValue(plugin.settings.cursorStyle)
              // Re-render as soon as the value is in memory, not after the
              // save lands - the rows read memory, and enable() does too.
              .onChange(async (value) => {
                plugin.settings.cursorStyle = value;
                const saved = plugin.saveSettings();
                plugin.enable();
                rerender();
                await saved;
              })
          );
        },
        // Torch Spotlight owns a whole separate engine (torchEngineActive) that
        // needs to be started/stopped immediately on toggle, rather than just
        // having its setting saved - a Vim mode doesn't need this since its
        // torch state is already picked up by the shared engine's per-frame
        // torchPossible() scan across all modes.
        renderTorchToggleSetting: (setting, rerender) => {
          setting.addToggle((toggle) =>
            toggle.setValue(plugin.settings.torchEffect).onChange(async (value) => {
              plugin.settings.torchEffect = value;
              const saved = plugin.saveSettings();
              if (plugin.settings.enabled) {
                value ? plugin.enableTorchOverlay() : plugin.disableTorchOverlay();
              }
              rerender();
              await saved;
            })
          );
        },
      }),
    ];
  }

  presetsGroup() {
    const plugin = this.plugin;
    const items = [];

    if (plugin._pendingPresetName === undefined) plugin._pendingPresetName = "";
    items.push(this.row("Save current settings as preset", "Give your cursor a name, then click Save.", (setting) => {
      setting
        .addText((text) => {
          text.setPlaceholder("Preset name");
          text.setValue(plugin._pendingPresetName);
          text.onChange((v) => { plugin._pendingPresetName = v; });
        })
        .addButton((btn) => {
          btn.setButtonText("Save").setCta();
          btn.onClick(async () => {
            const name = plugin._pendingPresetName.trim();
            if (!name) return;
            await plugin.saveUserPreset(name);
            plugin._pendingPresetName = "";
            this.update();
          });
        });
    }));

    items.push(this.row("Import preset", "Paste a share code from someone else to add their preset.", (setting) => {
      let importCode = "";
      setting
        .addText((text) => {
          text.setPlaceholder("Paste code here…");
          text.onChange((v) => { importCode = v.trim(); });
          text.inputEl.addClass("cursor-smith-code-input");
        })
        .addButton((btn) => {
          btn.setButtonText("Import").onClick(async () => {
            if (!importCode) return;
            const imported = await plugin.importPreset(importCode);
            if (imported) {
              this.update();
            } else {
              // The two code kinds are one character apart at a glance, so say
              // which mistake was made rather than a flat "invalid".
              btn.setButtonText(importCode.startsWith(SHARE_VERSION_VIM + "|")
                ? "That's a Vim code" : "Invalid code");
              window.setTimeout(() => { btn.setButtonText("Import"); }, 2000);
            }
          });
        });
    }));

    const presets = plugin.getUserPresets();
    const names = Object.keys(presets);
    if (names.length === 0) {
      items.push(this.noteRow("No saved presets yet. Configure your cursor below, then save it above."));
    } else {
      for (const name of names) {
        items.push(this.presetRow(name, presets[name], {
          onLoad: async () => { await plugin.loadUserPreset(name); plugin._pendingPresetName = name; this.update(); },
          onEdit: async () => {
            await plugin.loadUserPreset(name);
            plugin._pendingPresetName = name;
            this.update();
            this._scrollHost().scrollTop = 0;
          },
          onDelete: async () => { await plugin.deleteUserPreset(name); this.update(); },
        }));
      }
    }

    return this.section("Presets", items);
  }

  // -------------------------------------------------------------------------
  // Shared preset row (name, share code pill, Copy, Load, Edit, Delete).
  //
  // `code` is a caller option because the two preset kinds serialise
  // differently: a regular preset is one look (presetToCode), a Vim preset is
  // five (vimPresetToCode). This row used to build the code itself with
  // presetToCode, which is correct for one caller and silently produced an
  // empty, contentless code for the other.
  // -------------------------------------------------------------------------
  presetRow(name, snap, { onLoad, onEdit, onDelete, code, active = false }) {
    if (code === undefined) code = presetToCode(name, snap);
    return {
      name,
      desc: active ? "Currently active" : "",
      render: (setting) => {
        const codeEl = setting.controlEl.createEl("code", { text: code, cls: "cursor-smith-share-code" });
        codeEl.title = code;

        const copyBtn = setting.controlEl.createEl("button", { text: "Copy", cls: "cursor-smith-copy-button" });
        copyBtn.addEventListener("click", () => {
          void navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = "Copied!";
            window.setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
          });
        });

        setting
          .addButton((btn) => btn.setButtonText("Load").onClick(onLoad))
          .addButton((btn) => btn.setButtonText("Edit").onClick(onEdit))
          .addButton((btn) => btn.setButtonText("Delete").setDestructive().onClick(onDelete));
      },
    };
  }

  // -------------------------------------------------------------------------
  // The Vim panel: the two Vim-only switches, the Vim preset library, the
  // mode tabs, and the look cards for whichever mode is being edited.
  // -------------------------------------------------------------------------
  vimDefinitions() {
    const plugin = this.plugin;

    if (!VIM_MODE_KEYS.includes(plugin._vimEditMode)) plugin._vimEditMode = "normal";
    const mode = plugin._vimEditMode;
    const target = plugin.settings.vimModes[mode];

    return [
      this.vimCursorsGroup(),
      this.vimPresetsGroup(),
      this.vimModeGroup(mode),
      ...this.modeDefinitions(target, () => {
        plugin.settings.vimActivePreset = "";
      }),
    ];
  }

  vimCursorsGroup() {
    const plugin = this.plugin;
    const items = [];

    items.push(this.row("Control Obsidian's Vim key bindings",
      "Lets this plugin turn Obsidian's Vim key bindings on and off with the mode.", (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimControlObsidian).onChange(async (value) => {
            plugin.settings.vimControlObsidian = value;
            // Taking ownership mid-session: immediately enforce the current
            // mode so the keybindings match what the panel shows.
            if (value) plugin.setObsidianVim(!!plugin.settings.vimModeEnabled);
            await plugin.saveSettings();
            this.update();
          }));
      }));

    items.push(this.row("Show Vim mode in status bar",
      "Shows the live mode in the status bar, vim-style: -- NORMAL --.", (setting) => {
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimStatusBar).onChange(async (value) => {
            plugin.settings.vimStatusBar = value;
            plugin.syncVimStatusBar();
            await plugin.saveSettings();
            this.update();
          }));
      }));

    if (plugin.settings.vimStatusBar) {
      items.push(this.row("Color status bar text to match the cursor",
        "Tints the mode name with that mode's cursor color.", (setting) => {
          setting.addToggle((toggle) =>
            toggle.setValue(plugin.settings.vimStatusBarColor).onChange(async (value) => {
              plugin.settings.vimStatusBarColor = value;
              await plugin.saveSettings();
            }));
        }, 1));
    }

    // Shown only while Obsidian's own Vim key bindings are off, re-checked
    // by Obsidian after every control change.
    items.push(this.noteRow(plugin.settings.vimControlObsidian
      ? "⚠ Obsidian's Vim key bindings look off right now. They should switch on automatically — reopen the editor if the mode cursors don't appear."
      : "⚠ Obsidian's Vim key bindings are off, so mode cursors won't appear. Enable them in Settings → Editor → Vim key bindings, or turn on \"Control Obsidian's Vim key bindings\" above.",
      { warning: true, visible: () => !plugin.isObsidianVimOn() }));

    return this.section("Vim cursors", items);
  }

  vimPresetsGroup() {
    const plugin = this.plugin;
    const items = [];

    if (plugin._pendingVimPresetName === undefined) plugin._pendingVimPresetName = "";
    items.push(this.row("Save current Vim setup as preset",
      "Give this set of per-mode cursors a name, then click Save.", (setting) => {
        setting
          .addText((text) => {
            text.setPlaceholder("Vim preset name");
            text.setValue(plugin._pendingVimPresetName);
            text.onChange((v) => { plugin._pendingVimPresetName = v; });
          })
          .addButton((btn) => {
            btn.setButtonText("Save").setCta();
            btn.onClick(async () => {
              const name = (plugin._pendingVimPresetName || "").trim();
              if (!name) return;
              await plugin.saveVimPreset(name);
              plugin._pendingVimPresetName = "";
              this.update();
            });
          });
      }));

    items.push(this.row("Import Vim preset",
      "Paste a Vim share code to add all five mode cursors at once.", (setting) => {
        let importVimCode = "";
        setting
          .addText((text) => {
            text.setPlaceholder("Paste code here…");
            text.onChange((v) => { importVimCode = v.trim(); });
            text.inputEl.addClass("cursor-smith-code-input");
          })
          .addButton((btn) => {
            btn.setButtonText("Import").onClick(async () => {
              if (!importVimCode) return;
              const imported = await plugin.importVimPreset(importVimCode);
              if (imported) {
                this.update();
              } else {
                btn.setButtonText(importVimCode.startsWith(SHARE_VERSION + "|")
                  ? "That's a regular code" : "Invalid code");
                window.setTimeout(() => { btn.setButtonText("Import"); }, 2000);
              }
            });
          });
      }));

    const presets = plugin.getVimPresets();
    const names = Object.keys(presets);
    if (names.length === 0) {
      items.push(this.noteRow("No saved Vim presets yet. Configure each mode below, then save it above."));
    } else {
      for (const name of names) {
        items.push(this.presetRow(name, presets[name], {
          code: vimPresetToCode(name, presets[name]),
          active: name === plugin.settings.vimActivePreset,
          onLoad: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.update();
          },
          onEdit: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.update();
            this._scrollHost().scrollTop = 0;
          },
          onDelete: async () => { await plugin.deleteVimPreset(name); this.update(); },
        }));
      }
    }

    return this.section("Vim presets", items);
  }

  // Per-mode editor: pick one mode, then edit its FULL cursor config in the
  // look cards that follow this one.
  vimModeGroup(mode) {
    const items = [];

    items.push(this.row("Vim mode", `The cards below are the ${VIM_MODE_LABELS[mode]} mode's cursor. Each mode has a full set of its own.`,
      (setting) => this.renderModeTabs(setting.controlEl)));

    if (mode === "command") {
      items.push(this.noteRow(
        "Applies whenever the caret leaves the note editor: the built-in Vim command " +
        "line (the \":\" / \"/\" prompt) and the rest of the Obsidian interface — Command " +
        "Palette, Quick Switcher, search, rename boxes, Settings fields and plugin modals. " +
        "Motion effects (smear, smooth movement, CRT trail) are best left off here: these " +
        "are all single-line fields, so they read as jitter rather than movement."));
    }

    return this.section("Per-mode cursors", items);
  }

  // Tab row — one tab per Vim mode. Same visual language as the CUA/Vim
  // segmented switch at the top of the panel. Each inactive tab's label is
  // tinted with that mode's own cursor color (for the current theme), so the
  // row doubles as a live color legend; the active tab uses the accent
  // background instead, where a tint would be unreadable.
  renderModeTabs(containerEl) {
    const plugin = this.plugin;
    const isDarkTheme = containerEl.ownerDocument?.body?.classList?.contains("theme-dark") ?? true;
    const tabWrap = containerEl.createDiv({ cls: "cursor-smith-segmented cursor-smith-segmented-modes" });
    for (const m of VIM_MODE_KEYS) {
      const active = plugin._vimEditMode === m;
      const cfg = plugin.settings.vimModes[m] || {};
      const tint = isDarkTheme ? cfg.colorDark : cfg.colorLight;
      const btn = tabWrap.createEl("button", {
        text: VIM_MODE_LABELS[m],
        cls: active ? "cursor-smith-segment is-active" : "cursor-smith-segment",
      });
      // The one thing that is per mode and per theme: the tab takes the
      // mode's cursor colour (the active tab is on the accent, where a tint
      // would be unreadable).
      if (!active && tint) btn.setCssStyles({ color: tint });
      btn.addEventListener("click", () => {
        if (plugin._vimEditMode === m) return;
        plugin._vimEditMode = m;
        this.update();
      });
    }
  }

  // The FULL set of cursor look/effect cards bound to an arbitrary
  // settings-shaped `target` object (here, one Vim mode's snapshot).
  modeDefinitions(target, onEdit) {
    const plugin = this.plugin;
    const after = onEdit || (() => {});
    const set = (key) => async (v) => { target[key] = v; after(); await plugin.saveSettings(); };
    // Write, then re-render - the same shape lookDefinitions gives its own
    // gated toggles.
    const setR = (key, rerender) => async (v) => { const saved = set(key)(v); rerender(); await saved; };

    return this.lookDefinitions({
      get: (key) => target[key],
      set,
      renderCursorStyleSetting: (setting, rerender) => {
        setting.addDropdown((d) =>
          d.addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
            .setValue(target.cursorStyle).onChange(setR("cursorStyle", rerender)));
      },
      renderTorchToggleSetting: (setting, rerender) => {
        setting.addToggle((t) => t.setValue(target.torchEffect).onChange(setR("torchEffect", rerender)));
      },
    });
  }

  // -------------------------------------------------------------------------
  // Shared look/effect cards.
  //
  // normalDefinitions (the global cursor) and modeDefinitions (one Vim mode's
  // own snapshot) build an identical set of cards - Appearance, Blinking,
  // Smooth movement, Effects. The only real differences between the two are
  // *where the values live* and *what happens after a save*, so those are
  // the only things a caller supplies:
  //
  //   get(key)                    - read the current value for `key`
  //   set(key)                    - returns an onChange handler: write the
  //                                 value where it lives and save. Must put
  //                                 the value in memory synchronously, before
  //                                 its first await - the re-render reads it
  //                                 back straight away.
  //   renderCursorStyleSetting(setting, rerender)
  //                               - fills in the "Cursor style" row's
  //                                 dropdown. Kept as a caller-supplied hook
  //                                 (rather than a generic set) because the
  //                                 global panel needs an extra
  //                                 plugin.enable() call after saving that a
  //                                 Vim mode does not. Call `rerender()`
  //                                 after the write.
  //   renderTorchToggleSetting(setting, rerender)
  //                               - fills in the "Torch spotlight" row's
  //                                 toggle. Also a caller-supplied hook: the
  //                                 global panel must start/stop the torch
  //                                 engine immediately on toggle, which has no
  //                                 Vim-mode equivalent (see the comment at
  //                                 that call site). Same `rerender` rule.
  //
  // A toggle that reveals or hides other rows goes through `redraw(key)`,
  // which writes and then calls update(): Obsidian rebuilds the panel from
  // the definitions and reconciles the rows in place, so only the rows that
  // changed are touched and the panel does not move. The rows a gate
  // controls are simply built or not built, from the value in memory.
  //
  // Returns the cards; `lookDefinitions.gates` on the result is the set of
  // keys whose change rebuilds the panel, for the tests.
  // -------------------------------------------------------------------------
  lookDefinitions({ get, set, renderCursorStyleSetting, renderTorchToggleSetting }) {
    const gates = new Set();
    const rerender = () => this.update();

    // An onChange handler for a gated control: write through `set`, then
    // re-render. The re-render runs as soon as the value is in memory rather
    // than after the save lands on disk - the rows read memory, and the
    // panel responding a disk write later is what the old full rebuild felt
    // like. The save's promise is still returned so a failure surfaces.
    const redraw = (key) => {
      gates.add(key);
      return async (v) => {
        const saved = set(key)(v);
        rerender();
        await saved;
      };
    };
    // For the two caller-built controls: the re-render they call after their
    // own write.
    const afterWrite = (key) => {
      gates.add(key);
      return rerender;
    };

    const row = (name, desc, build, depth) => this.row(name, desc, build, depth);
    const toggle = (name, desc, key, { depth = 0, gate = false } = {}) =>
      row(name, desc, (s) => { s.addToggle((t) => t.setValue(!!get(key)).onChange(gate ? redraw(key) : set(key))); }, depth);
    const dropdown = (name, desc, key, options, { depth = 0, value, onChange } = {}) =>
      row(name, desc, (s) => {
        s.addDropdown((d) => d.addOptions(options)
          .setValue(value !== undefined ? value : get(key))
          .onChange(onChange || set(key)));
      }, depth);

    // --- Every slider, with "restore default" ------------------------------
    // A small icon button sitting to the right of a slider, putting that one
    // dial back to its DEFAULT_SETTINGS value. Every slider in this panel gets
    // one, from this one helper - so there is no per-row copy of "what is this
    // slider's default" to drift out of date, and a new slider that forgets
    // the button is visibly the odd one out.
    //
    // The write goes through redraw even for the sliders whose own onChange
    // is the cheaper `set`. A slider's handle position is DOM state that
    // nothing else in the panel updates, so without a re-render the value
    // would change underneath a handle still sitting where the user left it -
    // i.e. the button would look broken while working perfectly. The
    // re-render also re-runs the gates, which is what the dials that reveal
    // other rows need (flameTrailGravity's angle, say).
    //
    // The default is read from DEFAULT_SETTINGS rather than from the
    // `fallback` a row shows: those fallbacks are what a *sparse* Vim-mode
    // snapshot displays for a key it has never been given, and the two are
    // not obliged to agree (overlayFlickerAmount's don't). What the button
    // promises is the default, so it reads the defaults.
    //
    // No dynamic tooltip on the slider: since 1.13 it always shows its value.
    const resetSlider = (key) => (btn) => {
      const reset = redraw(key);
      return btn
        .setIcon("rotate-ccw")
        .setTooltip(`Restore default (${DEFAULT_SETTINGS[key]})`)
        .onClick(() => reset(DEFAULT_SETTINGS[key]));
    };
    const slider = (name, desc, key, [min, max, step], { depth = 0, fallback, gate = false } = {}) =>
      row(name, desc, (s) => {
        s.addSlider((sl) => sl.setLimits(min, max, step).setValue(get(key) ?? fallback).onChange(gate ? redraw(key) : set(key)))
          .addExtraButton(resetSlider(key));
      }, depth);

    // Several colour pickers on ONE row, so they lay out side by side in that
    // row's control area (Obsidian's .setting-item-control is already a flex
    // row; .cursor-smith-color-row only adds the gap between swatches)
    // instead of each claiming its own full-width labelled row.
    //
    // Order carries the meaning here - there is nowhere to hang a per-swatch
    // label - so every caller's description has to state what the order is.
    const swatchRow = (name, keys, desc, depth = 0) =>
      row(name, desc, (s) => {
        s.settingEl.addClass("cursor-smith-color-row");
        for (const key of keys) {
          s.addColorPicker((cp) =>
            cp.setValue(get(key) || DEFAULT_SETTINGS[key]).onChange(set(key)));
        }
      }, depth);

    // --- Appearance ----------------------------------------------------------
    const appearance = [];
    appearance.push(row("Cursor style", "The shape of the cursor itself.",
      (s) => renderCursorStyleSetting(s, afterWrite("cursorStyle"))));

    // Everything that applies to exactly one cursor style lives here, in a
    // sub-group hanging directly off the dropdown that selects it, so the
    // card reads as "Cursor style, then the options for the style you
    // picked".
    const style = get("cursorStyle");
    if (style === "Line") {
      appearance.push(slider("Cursor thickness", "How thick the Line cursor is, in pixels.", "caretWidthPx", [1, 12, 1], { depth: 1 }));
      appearance.push(toggle("Serifs", "Adds I-beam serifs at the top and bottom of the line.", "lineSerifs", { depth: 1 }));
    }
    if (style === "Underline") {
      appearance.push(slider("Underline thickness", "Thickness of the underline, in pixels. 0 = automatic, scaled to the line height.",
        "underlineWidthPx", [0, 12, 1], { depth: 1, fallback: 0 }));
    }
    if (style === "Box") {
      appearance.push(toggle("Show letter inside cursor", get("boxHollow") || get("cursorTranslucent")
        ? `Shows the letter inside the block, colors flipped. Does nothing while ${get("boxHollow") ? "Hollow" : "Translucent"} is on.`
        : "Shows the letter inside the block, with the colors flipped.",
        "showChar", { depth: 1, gate: true }));
      if (get("showChar")) {
        appearance.push(dropdown("Letter color",
          "Contrast: neutral black or white. Tinted: the flipped colour, kept legible. Inverted: raw flip.",
          "glyphColorMode", { contrast: "Contrast", tinted: "Tinted", invert: "Inverted" },
          { depth: 2, value: get("glyphColorMode") || "contrast" }));
      }
      appearance.push(toggle("Hollow", "Draws only the outline of the box instead of a filled block.", "boxHollow", { depth: 1, gate: true }));
      if (get("boxHollow")) {
        // Nested one level deeper: Outline width is conditional on Hollow,
        // which is itself a sub-option of the style.
        appearance.push(slider("Outline width", "Thickness of the hollow box's outline, in pixels.", "boxHollowWidth", [1, 6, 1], { depth: 2 }));
      }
    }

    appearance.push(toggle("Gradient", "Blends several colors instead of one flat color.", "gradientEnabled", { gate: true }));
    if (get("gradientEnabled")) {
      // Dropdown values are strings; store a number so the engine's
      // clamping arithmetic doesn't have to care where the value came
      // from. Rebuilds the panel to add or remove color pickers.
      const writeCount = redraw("gradientCount");
      appearance.push(dropdown("Number of colors", "How many colors the blend runs through, from 2 to 4.",
        "gradientCount", { 2: "2", 3: "3", 4: "4" }, {
          depth: 1,
          value: String(get("gradientCount") ?? 2),
          onChange: (v) => writeCount(Number(v)),
        }));
      const count = Math.max(2, Math.min(4, Number(get("gradientCount")) || 2));
      const keys = (prefix) => Array.from({ length: count }, (_, i) => prefix + (i + 1));
      appearance.push(swatchRow("Colors (dark theme)", keys("gradientDark"),
        "In order from the top of the cursor to the bottom — or left to right for the Underline style.", 1));
      appearance.push(swatchRow("Colors (light theme)", keys("gradientLight"),
        "The same ramp for light themes, where neon colors tend to wash out.", 1));
    } else {
      // One row, two swatches - dark theme then light - rather than two
      // full-width labelled rows. Same helper, same layout as the gradient
      // rows above: "several pickers that belong to one idea".
      appearance.push(swatchRow("Cursor color", ["colorDark", "colorLight"],
        "Dark theme first, then light. Neon colors that look right on a dark background wash out on a white page."));
    }

    appearance.push(slider("Cursor opacity", "How see-through the cursor is.", "cursorOpacity", [0.1, 1, 0.05]));
    appearance.push(toggle("Translucent", "Blends the cursor into the page instead of painting over it. Overrides Show letter inside cursor.",
      "cursorTranslucent", { gate: true }));
    appearance.push(toggle("Rounded corners", "Softens the cursor's corners. Line and Underline become fully rounded bars; Box gets a gentler curve.",
      "cursorRounded"));

    // --- Blinking ------------------------------------------------------------
    const blinking = [];
    blinking.push(toggle("Blinking", "Makes the cursor blink.", "blinkingEnabled", { gate: true }));
    if (get("blinkingEnabled")) {
      blinking.push(slider("Blink speed", "How fast the cursor blinks.", "blinkSpeed", [0.1, 3, 0.1], { depth: 1 }));
      blinking.push(slider("Blink balance", "How the blink cycle is split between lit and dark.", "blinkOnOffBalance", [0.1, 0.9, 0.05], { depth: 1 }));
      blinking.push(slider("Fade smoothness", "How gradually the cursor fades in and out. 0.15 is the original feel.", "blinkFade", [0.05, 0.5, 0.05], { depth: 1, fallback: 0.15 }));
      blinking.push(toggle("Don't blink while typing", "Keeps the cursor fully lit while you type or move it.", "smoothStopBlinking", { depth: 1 }));
      blinking.push(slider("Blink delay", "How long the cursor stays lit after a keystroke, in ms.", "blinkDelayMs", [0, 2000, 50], { depth: 1, fallback: 0 }));
      blinking.push(slider("Stop after", "Blink this many times after each move, then stay lit. 0 blinks forever.", "blinkStopAfter", [0, 20, 1], { depth: 1, fallback: 0 }));
      blinking.push(toggle("Breathing", "The cursor swells and shrinks instead of fading out.", "blinkBreathing", { depth: 1, gate: true }));
      if (get("blinkBreathing")) {
        blinking.push(slider("Breath depth", "How far the cursor shrinks at the bottom of the breath.", "blinkBreathDepth", [0.05, 0.5, 0.05], { depth: 2, fallback: 0.2 }));
      }
    }

    // --- Smooth movement -----------------------------------------------------
    const smooth = [];
    smooth.push(toggle("Smooth movement", "Makes the cursor glide to its new spot instead of jumping there instantly.", "smoothEnabled", { gate: true }));
    if (get("smoothEnabled")) {
      smooth.push(slider("Glide amount", "How much the cursor eases as it travels.", "smoothness", [0.05, 0.30, 0.05], { depth: 1 }));
      smooth.push(slider("Catch-up speed", "How quickly the cursor chases the real caret.", "catchUpSpeed", [0.30, 0.80, 0.05], { depth: 1 }));
      // Max catch-up speed is meaningless on its own - it is only ever read
      // inside the adaptive branch - so it hangs off that toggle rather than
      // sitting beside it as a live-looking slider that does nothing.
      smooth.push(toggle("Speed up when typing fast", "Lets the cursor exceed Catch-up speed while you type, so it can't fall behind.", "smoothAdaptive", { depth: 1, gate: true }));
      if (get("smoothAdaptive")) {
        smooth.push(slider("Max catch-up speed", "The fastest the speed-up is allowed to get.", "maxCatchUpSpeed", [0.50, 1.0, 0.05], { depth: 2 }));
      }
      smooth.push(slider("Movement delay", "Delay before the cursor sets off, in ms. 0 follows immediately.", "moveDelayMs", [0, 500, 10], { depth: 1 }));
    }

    // --- Effects -------------------------------------------------------------
    // One card for every effect, each a toggle with its options under it.
    // Two rows here read gates that live in other cards - Gradient decides
    // whether Pixel trail's Gradient colors, Energy beam's Aurora and Neon's
    // Gradient trail are offered, and Blinking decides whether the torch's
    // Sync with blink is - which is fine: every gate rebuilds the whole
    // panel from memory.
    const effects = [];

    // Pop effects: one group for everything the cursor throws off in
    // response to a keystroke. Rainbow is a modifier across all four, so it
    // sits at the BOTTOM of the group rather than nested under any one of
    // them - and only once at least one of them is actually on, since with
    // the whole group idle it is a switch that recolours nothing.
    effects.push(toggle("Pop effects", "Things the cursor throws off as you type — letters, lightning and fireworks.", "popEffects", { gate: true }));
    if (get("popEffects")) {
      effects.push(toggle("Popping letters", "Each character you type springs out of the cursor and tumbles away as it fades.", "popLetters", { depth: 1, gate: true }));
      // Sits next to Popping letters on purpose: they're the pair that fires
      // per character, one for adding and one for removing. The two below
      // are the bigger, rarer events.
      effects.push(toggle("Backspace disintegration", get("popRainbow")
        ? "Deleting throws a burst outward. Rainbow takes the next color in the sweep, inverted."
        : "Deleting throws a burst outward in inverted colors.",
        // A gate, not a plain set: Rainbow at the bottom of this group
        // appears as soon as any one of the four effects is on, so this row
        // controls another row's visibility.
        "backspaceDisintegrate", { depth: 1, gate: true }));
      effects.push(toggle("Thunderstrike", "Enter calls down a bolt of pixelated lightning onto the new line.", "thunderstrike", { depth: 1, gate: true }));
      if (get("thunderstrike")) {
        effects.push(slider("Bolt size", "How fine the lightning is, in pixels per block.", "thunderstrikeSize", [1, 5, 1], { depth: 2, fallback: 2 }));
        effects.push(slider("Bolt strength", get("popRainbow")
          ? "How brightly the strike shows. Rainbow colors each bolt."
          : "How brightly the strike shows.",
          "thunderstrikeStrength", [0.1, 1, 0.05], { depth: 2, fallback: 0.5 }));
      }
      effects.push(toggle("Fireworks", "Space and Enter send shells climbing out of the cursor to burst above it.", "fireworks", { depth: 1, gate: true }));
      if (get("fireworks")) {
        // The colour source isn't configurable - it follows Rainbow, then
        // Gradient, then the cursor colour - so it's described rather than
        // offered.
        effects.push(slider("Quantity", "How many shells go up per keypress, and how much each throws.", "fireworksQuantity", [0.2, 3, 0.1], { depth: 2, fallback: 1 }));
      }
      // Rainbow last, and only when there is something for it to recolour.
      // The four effects above are independent of each other; this is the one
      // control in the group that reaches all of them, so it reads as a
      // summary of the group rather than as another sibling effect.
      //
      // Note the gate is on the four effects, NOT on popEffects: the group
      // can be on with every effect inside it off, and that is exactly the
      // state where a Rainbow toggle is a switch that visibly does nothing.
      // Same rule as Sync with blink under the torch, and Gradient colors
      // under Pixel trail.
      const anyPop = !!get("popLetters") || !!get("backspaceDisintegrate") ||
                     !!get("thunderstrike") || !!get("fireworks");
      if (anyPop) {
        // A gate rather than a plain set: this toggle changes what the
        // Backspace disintegration and Thunderstrike rows above say about
        // where their colors come from, and those descriptions are built
        // at definition time.
        effects.push(toggle("Rainbow", "Sweeps every pop effect around the color wheel as you type.", "popRainbow", { depth: 1, gate: true }));
      }
    }

    effects.push(toggle("Pixel trail", "Scatters a small puff of colored pixels wherever the cursor has just been.", "flameTrail", { gate: true }));
    if (get("flameTrail")) {
      effects.push(slider("Pixel density", "How many pixels the trail sheds. 0 hides them entirely.", "flameTrailDensity", [0, 3, 0.1], { depth: 1, fallback: 1 }));
      effects.push(toggle("Trail on jump", "Lays pixels along the whole path of a jump, not just at the start.", "flameTrailOnJump", { depth: 1 }));
      effects.push(slider("Pixel lifetime", "How long each pixel lasts before it fades out, in milliseconds.", "flameTrailLifeMs", [100, 2000, 50], { depth: 1, fallback: 400 }));
      effects.push(slider("Pixel size", "How big each pixel is.", "flameTrailPixelSize", [1, 12, 0.5], { depth: 1, fallback: 4 }));
      // Only meaningful with a gradient to sample - offered only when Gradient
      // is on, so it isn't a switch that visibly does nothing.
      if (get("gradientEnabled")) {
        effects.push(toggle("Gradient colors", "Colors each pixel from the cursor's gradient instead of one flat color.", "flameTrailGradientColors", { depth: 1 }));
      }
      effects.push(slider("Gravity", "A steady pull on the pixels. 0 leaves them drifting sideways.", "flameTrailGravity", [0, 1, 0.05], { depth: 1, fallback: 0, gate: true }));
      if ((get("flameTrailGravity") ?? 0) > 0) {
        effects.push(slider("Gravity direction", "Which way the pull goes, in degrees. 0 is down, 90 right, 180 up, 270 left.", "flameTrailGravityAngle", [0, 359, 5], { depth: 2, fallback: 0 }));
      }
    }

    effects.push(toggle("Stardust", "A slow stream of floating pixels that drift up and fade.", "stardustEnabled", { gate: true }));
    if (get("stardustEnabled")) {
      effects.push(toggle("Always on", "Streams continuously instead of waiting for the cursor to settle.", "stardustAlwaysOn", { depth: 1, gate: true }));
      // The delay is what Always on overrides, so hide it rather than leave
      // a live-looking slider that no longer does anything.
      if (!get("stardustAlwaysOn")) {
        effects.push(slider("Idle delay", "How long (in ms) the cursor must sit still before the stardust starts.", "stardustDelayMs", [500, 8000, 250], { depth: 1, fallback: 2000 }));
      }
      effects.push(slider("Stardust density", "How thickly the stardust streams off the cursor.", "stardustRate", [0.2, 3, 0.1], { depth: 1, fallback: 1 }));
      effects.push(toggle("Orbit", "Motes circle the cursor like fireflies instead of drifting up.", "stardustOrbit", { depth: 1, gate: true }));
      if (get("stardustOrbit")) {
        effects.push(slider("Orbit radius", "How wide the motes circle, in pixels.", "stardustOrbitRadius", [10, 60, 2], { depth: 2, fallback: 22 }));
      }
    }

    effects.push(toggle("Bracket tether", "Underlines the span between matching brackets or quotes.", "bracketTether", { gate: true }));
    if (get("bracketTether")) {
      effects.push(slider("Tether strength", "How visible the line is.", "bracketTetherStrength", [0.1, 1, 0.05], { depth: 1, fallback: 0.35 }));
    }

    effects.push(toggle("Motion smear", "The cursor stretches as it moves and snaps back when it arrives.", "smear", { gate: true }));
    if (get("smear")) {
      effects.push(slider("Stiffness", "How hard the leading edge is pulled toward the new position.", "smearStiffness", [0.1, 1, 0.05], { depth: 1 }));
      effects.push(slider("Trailing stiffness", "The same for the edge left behind.", "smearTrailingStiffness", [0.05, 1, 0.05], { depth: 1 }));
      effects.push(slider("Damping", "How much the springs resist overshooting.", "smearDamping", [0.05, 1, 0.05], { depth: 1 }));
      effects.push(toggle("Tapered trail", "Narrows the smear to a point behind the cursor, like a comet tail.", "smearTaper", { depth: 1, gate: true }));
      if (get("smearTaper")) {
        effects.push(slider("Taper amount", "How sharply the tail closes. At 1 it comes to a full point.", "smearTaperAmount", [0.1, 1, 0.05], { depth: 2, fallback: 0.7 }));
      }
      effects.push(slider("Max length", "How far the tail may trail the cursor, in pixels. Lower keeps the smear short; 0 = no limit.", "smearMaxLength", [0, 400, 10], { depth: 1, fallback: 0 }));
      effects.push(toggle("Conserve volume", "A jump to another line thins as it stretches, keeping its area. Straight moves: use Tapered trail.", "smearConserveVolume", { depth: 1, gate: true }));
      if (get("smearConserveVolume")) {
        effects.push(slider("Thinning", "How strongly the area is held. At 1 a streak twice as long is half as wide.", "smearVolumeStrength", [0.1, 1, 0.05], { depth: 2, fallback: 0.3 }));
      }
    }

    effects.push(toggle("Energy beam", get("gradientEnabled")
      ? "Scrolls your gradient along the cursor, with a brightness pulse riding over it."
      : "Runs a shimmering pulse of light along the cursor.",
      "energyEffect", { gate: true }));
    if (get("energyEffect")) {
      effects.push(slider("Beam speed", "How fast the pulse travels along the cursor.", "energySpeed", [0.2, 3, 0.1], { depth: 1 }));
      // Aurora has nothing to work with without a ramp - it warps and
      // cross-mixes gradient colors - so it only appears once Gradient is on.
      if (get("gradientEnabled")) {
        effects.push(toggle("Aurora", "Swirls your gradient colors instead of scrolling them past.", "energyAurora", { depth: 1, gate: true }));
        if (get("energyAurora")) {
          effects.push(slider("Waviness", "How hard the bands bend. 0 keeps them flat.", "energyAuroraWaviness", [0, 2, 0.05], { depth: 2, fallback: 1 }));
        }
      }
    }

    effects.push(toggle("CRT effect", "Old-monitor phosphor look: the cursor leaves fading ghosts behind it.", "crtEffect", { gate: true }));
    if (get("crtEffect")) {
      effects.push(slider("Trail length", "How many ghosts are kept behind the cursor. 0 leaves none.", "trailLength", [0, 30, 1], { depth: 1 }));
      effects.push(slider("Trail fade time", "How long (in ms) each ghost takes to fade out.", "trailFadeMs", [50, 1500, 25], { depth: 1 }));
      effects.push(toggle("Glow", get("speedDemon") && !get("speedDemonNoCursorHeat")
        ? "Soft halo around the cursor, in its own color. With Speed demon on it swells as the cursor heats up."
        : "Soft halo around the cursor, in its own color.",
        "glow", { depth: 1, gate: true }));
      effects.push(toggle("Neon trail", "Renders the ghosts as a glowing neon tube instead of fading boxes.", "crtNeon", { depth: 1, gate: true }));
      if (get("crtNeon") && get("gradientEnabled")) {
        effects.push(toggle("Gradient trail", "Runs the cursor's gradient along the streak, newest ghost to oldest.", "crtNeonGradient", { depth: 2 }));
      }
      effects.push(toggle("Signal glitch", "Long jumps break up like a mistracked video signal.", "crtGlitch", { depth: 1, gate: true }));
      if (get("crtGlitch")) {
        effects.push(slider("Break-up", "How far the slices are thrown and how much the cursor's shape warps.", "crtGlitchStrength", [0.2, 2.5, 0.1], { depth: 2, fallback: 1 }));
        effects.push(slider("Color split", "How far the color channels separate. 0 only tears the shape.", "crtGlitchAberration", [0, 3, 0.1], { depth: 2, fallback: 1 }));
        effects.push(slider("Duration", "How long each burst lasts, in milliseconds.", "crtGlitchMs", [60, 600, 10], { depth: 2, fallback: 220 }));
      }
    }

    effects.push(toggle("Speed demon", "The cursor heats from grey to white-hot as you type, then cools when you stop.", "speedDemon", { gate: true }));
    if (get("speedDemon")) {
      effects.push(toggle("Fire sparks", "Throws embers off the cursor once it is hot enough.", "speedDemonSparks", { depth: 1, gate: true }));
      if (get("speedDemonSparks")) {
        effects.push(slider("Spark quantity", "How many embers spawn per burst. 0 stops them without switching the effect off.", "speedDemonSparkQuantity", [0, 3, 0.1], { depth: 2, fallback: 1 }));
        effects.push(slider("Spark trail", "Gives each spark a fading comet tail, in pixels. 0 = no trail.", "speedDemonSparkTrail", [0, 30, 1], { depth: 2, fallback: 0 }));
      }
      effects.push(toggle("Keep cursor color", "The cursor keeps your color; only the sparks react to speed.", "speedDemonNoCursorHeat", { depth: 1, gate: true }));
      effects.push(slider("Sensitivity", "How fast typing and caret movement heat the cursor up.", "speedDemonSensitivity", [0.5, 2, 0.1], { depth: 1 }));
      // Hidden while Keep cursor color is on: that option says the cursor
      // shouldn't change colour with speed at all, which makes a custom
      // colour ramp for exactly that a contradiction rather than a choice.
      if (!get("speedDemonNoCursorHeat")) {
        effects.push(toggle("Custom gradient", "Replaces the built-in heat curve with four colors of your own.", "speedDemonGradient", { depth: 1, gate: true }));
        if (get("speedDemonGradient")) {
          // Same one-row-of-pickers layout the Gradient rows use.
          const heat = (prefix) => [1, 2, 3, 4].map((i) => prefix + i);
          effects.push(swatchRow("Stages (dark theme)", heat("speedHeatDark"),
            "Warming to flat out, left to right. At rest the cursor keeps its own color.", 2));
          effects.push(swatchRow("Stages (light theme)", heat("speedHeatLight"),
            "The same four stages for light themes, where a white-hot final stage disappears into the page.", 2));
        }
      }
    }

    effects.push(toggle("Hot-head", "Sets the text you're working on alight.", "hotHead", { gate: true }));
    if (get("hotHead")) {
      effects.push(slider("Fire quantity", "How much fire is emitted. 0 puts it out without switching Hot-head off.", "hotHeadQuantity", [0, 3, 0.1], { depth: 1, fallback: 1 }));
      effects.push(slider("Fire spread", "How much surrounding text catches, in characters. 0 burns only the cursor's own column.", "hotHeadSpread", [0, 14, 1], { depth: 1, fallback: 4 }));
      effects.push(slider("Trail over text", "Fire laid along the path travelled. 0 keeps it where the cursor stops.", "hotHeadTrail", [0, 30, 1], { depth: 1, fallback: 6 }));
      effects.push(slider("Flame height", "How high the flames climb before they burn out.", "hotHeadHeight", [0.15, 1.5, 0.05], { depth: 1, fallback: 0.55 }));
      effects.push(slider("Fade time", "How long a single fire particle lasts, in milliseconds.", "hotHeadFade", [200, 1600, 20], { depth: 1, fallback: 620 }));
      effects.push(slider("Idle timeout", "Idle time before the fire burns out. 0 keeps it burning forever.", "hotHeadIdleMs", [0, 6000, 100], { depth: 1, fallback: 1500 }));
      effects.push(slider("Fire opacity", "How solid the fire is, independent of the cursor's own opacity.", "hotHeadOpacity", [0.1, 1, 0.05], { depth: 1, fallback: 1 }));
      effects.push(toggle("Use cursor color", "Paints the fire in the cursor's color instead of the heat gradient.", "hotHeadFlat", { depth: 1, gate: true }));
      // Nested under Use cursor color, and hidden without it, because that
      // is the only mode it can actually do anything in - see
      // hotHeadSpeedHeat's gate in drawHotHead. Also hidden without Speed
      // demon itself, since there would be no heat to follow.
      if (get("hotHeadFlat") && get("speedDemon")) {
        effects.push(toggle("Heat with speed demon", "The fire warms up as you type, following Speed demon's heat.", "hotHeadSpeedHeat", { depth: 2, gate: true }));
      }
    }

    effects.push(row("Torch spotlight", "Darkens everything except a pool of light around the cursor.",
      (s) => renderTorchToggleSetting(s, afterWrite("torchEffect"))));
    if (get("torchEffect")) {
      // The two subheadings are labels within the torch's options, not
      // siblings of the torch toggle itself.
      effects.push(this.subheadingRow("Spotlight", 1));
      effects.push(dropdown("Follow", "What the light tracks.", "overlayFollowMode",
        { caret: "Text cursor only", mouse: "Mouse pointer only", auto: "Auto intelligent swap" }, { depth: 1 }));
      effects.push(slider("Light size", "How far the lit circle reaches, in pixels.", "overlayRadius", [100, 800, 10], { depth: 1 }));
      // Only offered when there's a blink to sync to - with blinking off the
      // toggle would be a switch that does nothing, and the reason why would
      // be in a different card.
      if (get("blinkingEnabled")) {
        effects.push(toggle("Sync with blink", "The light closes in as the cursor blinks out and opens back up as it returns.", "overlayBlinkSync", { depth: 1, gate: true }));
        if (get("overlayBlinkSync")) {
          effects.push(slider("Pulse depth", "How far the light closes at its darkest, as a share of Light size. At 1 it goes out.", "overlayBlinkDepth", [0.05, 1, 0.05], { depth: 2, fallback: 0.25 }));
        }
      }
      effects.push(row("Light color", "The color of the light at its center.",
        (s) => { s.addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor"))); }, 1));
      effects.push(slider("Follow speed", "How quickly the light catches up when the cursor moves.", "overlaySpeed", [0.05, 1, 0.05], { depth: 1 }));

      effects.push(this.subheadingRow("Environment", 1));
      effects.push(slider("Darkness", "How far everything outside the light is dimmed.", "overlayDarkness", [0.2, 1, 0.01], { depth: 1 }));
      // A gate: Flicker's description below says whether there is anything
      // to flicker, and that depends on this value.
      effects.push(slider("Glow strength", "Strength of the warm glow. 0 gives a pure spotlight.", "overlayIntensity", [0, 1, 0.05], { depth: 1, gate: true }));
      // Sits under Glow strength because that is the value it modulates: the
      // flame swings either side of whatever that slider is set to, so at 0
      // there is nothing to flicker and this says so rather than appearing to
      // be broken.
      effects.push(toggle("Flicker", get("overlayIntensity") > 0
        ? "The light gutters like a candle instead of burning steady."
        : "The light gutters like a candle. Does nothing while Glow strength is 0.",
        "overlayFlicker", { depth: 1, gate: true }));
      if (get("overlayFlicker")) {
        effects.push(slider("Flicker depth", "How far the flame swings either side of Glow strength. At 1 it gutters right out.", "overlayFlickerAmount", [0.05, 1, 0.05], { depth: 2, fallback: 0.35 }));
      }
      effects.push(toggle("Keep sidebars lit", "Dims only the editor, leaving sidebars and ribbon lit. Desktop only.", "overlaySpareSidebars", { depth: 1 }));
    }

    const cards = [
      this.section("Appearance", appearance),
      this.section("Blinking", blinking),
      this.section("Smooth movement", smooth),
      this.section("Effects", effects),
    ];
    cards.gates = gates;
    return cards;
  }
}
/* nosourcemap */
/* nosourcemap */