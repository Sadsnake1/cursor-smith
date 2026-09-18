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
//  • THE ENGINE READS this.look (the active Vim mode's snapshot merged over
//    the settings), never this.settings, which is only ever the persisted
//    object. Don't cache a look value across frames; use styleFor(key).
//
// TESTS: `npm test` builds the test bundle and runs test/test.js outside
// Obsidian with the Obsidian API stubbed (test/obsidian-stub.ts), plus a
// settings-panel render harness (test/panel_harness.js). 1,100-odd
// assertions covering migration, share codes, colour
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
export const DIRTY_RECT_CLEAR = true;

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
export const CANVAS_REGION_MARGIN_X = 96;    // px either side
export const CANVAS_REGION_MARGIN_Y = 1.5;   // line heights above and below
// Sizes are rounded up to this grid so a region that moves without growing
// keeps its backing store instead of reallocating one a few pixels larger.
export const CANVAS_REGION_GRID = 64;
// A region more than CANVAS_REGION_SHRINK_RATIO times the area it is showing
// is shrunk back, but only after it has been that oversized for this long, so
// a volley of fireworks or a run of Enter strikes does not thrash the
// allocation between the pane and the caret. The ratio is 2, not 4: with 4 a
// region that had grown to the pane's full width for a line wrap sat at 3.4x
// its need for as long as the caret stayed on that line, and that was most
// of the idle cost this whole mechanism exists to remove.
export const CANVAS_REGION_SHRINK_MS = 2000;
export const CANVAS_REGION_SHRINK_RATIO = 2;
// How much of last frame's painted rect to pad for the motion of whatever was
// in it: particles move a few px a frame, and anything that escapes this is
// clipped for exactly one frame before the region grows to include it.
export const CANVAS_REGION_MOTION_PAD = 32;

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
export const SPEED_RAMP_LIFTOFF = 0.12;

export const GLOW_HEAT_GAIN = 1.6;

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
export function keystrokeHeatWeight(kind: string, repeat: boolean) {
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
export const GEOMETRY_TTL_MS = 400;

// How long the hot gear is held after the last input event, in ms. The event
// itself wakes the loop at once; this window only covers what the input
// causes a frame or two later with no event of its own - the editor's
// deferred measure and scrollIntoView, a composition landing. It was 1200
// until 1.5.8: every stray selectionchange or resize bought over a second of
// full rate, and once the springs have settled those frames measure a caret
// that has not moved and draw nothing (the static-frame test).
export const INPUT_HOT_MS = 500;

// How long the caret's computed style (font, colour, line height, the glyph
// width, the row's extent) is trusted, in ms. The cache is keyed on a style
// generation that css-change, layout-change and resize bump, so this is
// only the backstop for a font change nothing announces. It was a bare 250
// ms with no generation, which had the idle heartbeat re-reading computed
// styles and hit-testing the caret's line four times a second for a caret
// that had not moved: a third of every idle tick, measured.
export const CARET_STYLE_TTL_MS = 1000;

// The smear spring counts as settled once every corner is within half a
// pixel of its target and none is moving faster than this, in px/s: half a
// pixel per frame at 60 Hz, so the next frame could not paint a different
// half-pixel. Then the corners snap onto their targets and the loop may
// rest. The velocity floor used to be 0.1 px/s, which kept the quad
// "moving" for 200-370 ms after its last half-pixel change on every
// keystroke (the defaults, Jell-O, FairyDust; measured headless) - two
// hundred frames a minute of typing, painted for nothing visible.
export const SMEAR_SETTLE_V = 30;

// The frame loop's watchdog (engine.ts, _watchdog): checked every
// WATCHDOG_INTERVAL_MS from an interval; a loop that has not ticked for
// WATCHDOG_STALE_MS while the document is visible is restarted, and on the
// second such stall the native caret is handed back. A parked loop still
// ticks at the idle heartbeat, so 3 s of silence is a loop that died, not
// one that is resting - unless the interval itself was late by as much,
// which is the main thread blocked and no verdict on the loop.
export const WATCHDOG_INTERVAL_MS = 2000;
export const WATCHDOG_STALE_MS = 3000;


// The torch's two layers are canvases painted at this fraction of the pane's
// size and scaled up by the compositor. The darkness is a soft radial ramp
// and the glow a softer one: at a quarter of the resolution a 140px light's
// edge is still a 10px-wide fade in the bitmap, and the bilinear upscale
// blurs it by about two screen pixels, which on a gradient is nothing. What
// it buys is sixteen times less to rasterise on every frame a light moves or
// the radius pulses - and with hardware acceleration off that raster was the
// torch's cost: a pane-sized radial gradient on the CPU per frame.
export const TORCH_CANVAS_SCALE = 0.25;

export const FRAME_CAPS = {
  normal:   { hotMinMs: 14, warmMs: 33, energyMs: 50, idleMs: 200, torchPulseMs: 33, torchIdleMs: 150 },
  lowPower: { hotMinMs: 30, warmMs: 50, energyMs: 80, idleMs: 250, torchPulseMs: 50, torchIdleMs: 250 },
};

// Thunderstrike (Pop Effects sub-option) tuning.
//
// How long one strike lives, in ms. Deliberately short: lightning is an event,
// not an animation, and anything that outstays the keystroke turns pressing
// Enter into a light show.
export const THUNDER_LIFE_MS = 280;
// Widest the bolt may lean off vertical, in radians (~54 degrees). The brief is
// "from up top", so it can come in at an angle but never sideways.
export const THUNDER_MAX_ANGLE = 0.95;
// Shortest a bolt may be, in pixels. Without a floor, a strike landing on the
// first visible line - where there is barely any pane above the caret to come
// from - would be a stub a few pixels long.
export const THUNDER_MIN_REACH = 150;
// Midpoint-displacement passes. Each one doubles the segment count, so 5 gives
// 32 segments: enough to read as forked lightning, few enough to stay cheap.
export const THUNDER_PASSES = 5;
// Most strikes allowed on screen at once. Holding Enter down would otherwise
// stack a bolt per repeat and bury the editor.
export const THUNDER_MAX_LIVE = 3;
// The colours a strike can be built from. Every bolt picks two or three of
// these at random and ramps between them from the sky end down to the impact,
// so no two strikes look alike. Deliberately NOT tied to the cursor colour:
// lightning reads as its own light source, and a bolt in the same green as the
// caret it lands on just looks like the caret grew a tail.
export const THUNDER_PALETTE = [
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
export const THUNDER_BANDS = 14;

// Fireworks (Pop Effects sub-option) tuning.
//
// A shell climbs out of the caret, bursts above it, and the sparks fall. Split
// into two timings because they are two different events: the climb should be
// quick enough to still feel attached to the keystroke that launched it, while
// the fall wants long enough to actually read as falling.
export const FIREWORK_RISE_MS = 260;
export const FIREWORK_FALL_MS = 620;
// How far above the caret a shell bursts, as a multiple of the line height,
// plus the random spread around it. Measured in line heights rather than
// pixels so the effect keeps its proportions at any font size.
export const FIREWORK_RISE_LINES = 3.4;
export const FIREWORK_RISE_JITTER = 1.2;
// Sideways lean of the climb, in px. A shell that goes up perfectly straight
// every time reads as mechanical.
export const FIREWORK_DRIFT = 26;
// Downward pull on the sparks, px/s². Applied closed-form (½·g·t²) like the
// Pixel Trail's gravity, so the arcs are identical at any refresh rate.
export const FIREWORK_GRAVITY = 420;
// Grid the whole effect snaps to, in px - this is what makes it pixel art
// rather than a smooth particle spray. Small, because the fireworks sit in
// running text and a coarse grid turns them into confetti.
export const FIREWORK_CELL = 3;
// "Subtle" is the brief, so the whole effect is painted through this ceiling.
// Raising it is the single knob that makes fireworks loud.
export const FIREWORK_ALPHA = 0.55;
// Most shells allowed in flight at once, across all keystrokes. Raised from 6
// now that a launch at capacity is SKIPPED rather than allowed to evict a live
// shell (see spawnFireworks): the old cap wasn't bounding cost so much as
// deciding how early a burst got killed.
export const FIREWORK_MAX_LIVE = 10;
// Floor on the gap between launches. The live cap alone still lets key-repeat
// spawn a shell every few ms, which costs the work of a full burst to show a
// flicker.
export const FIREWORK_MIN_GAP_MS = 70;
// The real bound on GPU cost: total live sparks across every shell in flight.
// Shell count alone doesn't bound anything, because a shell's cost is its
// spark count and the quantity slider triples that.
//
// This is what holding Space now degrades against. A new shell is given
// whatever budget is left rather than a fixed count, so a held key produces
// more, smaller bursts instead of the same expensive burst repeatedly, and the
// per-frame fill stays flat no matter how hard the key is leaned on.
export const FIREWORK_SPARK_BUDGET = 260;
// Below this many sparks there's no burst worth drawing, so the launch is
// skipped entirely and the gap timer is left alone for the next attempt.
export const FIREWORK_SPARK_MIN = 5;
// Live-spark fraction past which a shell is built cheap: no trails, no
// secondary pops. The expensive extras are what a burst can most afford to
// lose, and losing them is far less visible than losing the burst.
export const FIREWORK_PRESSURE = 0.55;
// Blocks of tail behind each falling spark. Each one is another fillRect per
// spark per frame, so this is the single most expensive number here.
export const FIREWORK_TRAIL_LEN = 2;
// Fraction of the fall after which sparks start guttering in and out. Twinkle
// is free - a spark that's dark this frame simply isn't drawn - so it makes
// the back half of a burst cheaper as well as livelier.
export const FIREWORK_TWINKLE_AT = 0.42;
// How many distinct colours one shell quantises its sparks into. Sparks are
// sorted by colour at spawn so the draw sets fillStyle this many times instead
// of once per spark.
export const FIREWORK_PALETTE_MAX = 6;
// Secondary pops: a few sparks detonate again on the way down. Generated at
// spawn like everything else, never at draw time.
export const FIREWORK_SECOND_MAX = 3;
export const FIREWORK_SECOND_SPARKS = 5;
export const FIREWORK_SECOND_AT = [0.30, 0.55];   // range of fall fraction to pop at


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
export const TORCH_FLICKER_RATES = [8.7, 13.1, 21.3];
export const TORCH_FLICKER_PHASES = [0, 1.7, 4.2];
export const TORCH_FLICKER_WEIGHTS = [0.5, 0.3, 0.2];

// Ceiling on how far Smooth Movement's adaptive catch-up is allowed to stiffen
// the smear's leading corners. See updateSmearQuad.
export const SMEAR_LEAD_BOOST_CAP = 6;

// Motion Smear / Conserve area (smearConserveVolume): the narrowest the smear is ever thinned
// to, as a share of its resting width. A floor, so a very long streak thins
// into a line and not into nothing.
export const SMEAR_VOLUME_MIN_FACTOR = 0.35;

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
export const TAPER_MIN_LAG = 26;
export const TAPER_FULL_LAG = 90;

// Pixel Trail / Trail On Jump. A move counts as a "jump" (rather than ordinary
// typing/arrowing) once the caret travels more than this many pixels in one
// commit - comfortably above a few glyphs so held arrow keys don't trip it.
export const JUMP_TRAIL_MIN_DIST = 40;
// One puff of pixels is dropped every this-many pixels along the jump path.
// Tighter spacing looks denser but costs more particles; this is a balance that
// reads as continuous without flooding the pool.
export const JUMP_TRAIL_STEP = 18;
// Hard ceiling on puffs per jump, so a click from the top of a huge document to
// the bottom can't spawn thousands of particles in a single commit.
export const JUMP_TRAIL_MAX_PUFFS = 40;

// Alpha the cursor paints at while cursorTranslucent is on. Near-solid on
// purpose: with the layer in multiply/screen the see-through quality comes
// almost entirely from the BLEND, not from the alpha, and dropping the alpha
// much below this starts washing the cursor out on busy text instead of
// making it read as ink. Multiplies with cursorOpacity rather than replacing
// it, so the global slider keeps working the same way everywhere.
export const TRANSLUCENT_ALPHA = 0.95;

// How fast the adaptive catch-up boost may change, as an exponential rate
// (1/s). ~8 is a 125ms time constant: quick enough to follow a genuine burst
// of typing, slow enough to flatten the per-frame sawtooth the backlog
// measurement produces. See updateSmoothCursor.
export const CATCHUP_BOOST_RATE = 8;

// Rounded Corners. See cornerRadius(): a shape whose narrow axis is at or
// under ROUNDED_THIN_PX is treated as a bar and goes fully round (capsule
// ends), anything wider is a block and takes the gentler fraction. 6px is
// comfortably above the widest Line caret the width slider offers, so every
// Line and Underline caret capsules and every Box softens.
export const ROUNDED_THIN_PX = 6;
export const ROUNDED_BLOCK_FRACTION = 0.25;

// I-beam serifs.
//
// Thickness is the smaller of a multiple of the stem and a fraction of the
// LINE HEIGHT. The stem term alone (all this used to have) meant a 6px caret
// put two 5px slabs on a ~24px line - 42% of the caret's height was serif,
// which reads as a bracket rather than an I-beam.
export const SERIF_STEM_RATIO = 0.9;
export const SERIF_HEIGHT_RATIO = 0.08;
// Span is driven by the character under the caret, with a small ABSOLUTE
// floor rather than a stem-relative one. A stem-relative floor grew the
// serifs past the width of the glyph they were marking as the stem widened.
export const SERIF_MIN_SPAN_PX = 5;
export const SERIF_MAX_SPAN_RATIO = 1.25;

// Multi-cursor: how many non-primary carets get the primary's full pipeline -
// their own smoothing and smear springs, trail, letter pop, pixel trail,
// disintegration, glitch, and the cursor's own style, glow, gradient and
// glyph. Carets past this many are drawn as the plain 2px line they always
// were. The cap is cost, not taste: measured in a live Obsidian, 200 carets
// with glow, gradient and glyph draw in 1.7ms, so drawing is not the limit -
// the per-keystroke style read is (every caret's line is re-read after every
// edit), and the region the canvas has to cover, which for carets spread down
// a page is the whole pane. See HANDOFF.md, "Multi-cursor with full effects".
export const SECONDARY_FULL_MAX = 64;
// When the selection's shape changes (a caret added or removed, or the main
// one reassigned), every caret's saved state is re-matched to the new ranges
// by document position. A state further than this from every new head is
// dropped rather than mis-assigned, which would draw a smear from nowhere.
export const SECONDARY_MATCH_WINDOW = 32;
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
export const CARET_STATE_FIELDS = [
  "lastActive", "pending", "animActive",
  "smearQuad", "smearShape", "smearCenterPrev", "_taperBuf", "_volumeBuf", "_smearDir",
  // The two-point quad's points (1.5.6). They were missing here until 1.5.8,
  // so a secondary's spring integrated the primary's points toward its own
  // target and the two carets' smears fought over one spring.
  "_smearLead", "_smearTrail",
  "_smearMoving", "_smearDtT", "smearQuadLastMoveT",
  "trail", "glitch",
  "_smoothMoving", "_smoothLastT", "_catchUpBoost", "_typingBoostSm", "typingSpeedMod",
  "_hotPrev", "_hotEmitFrom", "_hotVel", "_hotActiveT", "_lastHotT", "hotBurns", "_hotShiftTick",
  "_hotEngulfUntil",
  "_lastStardustT", "_lastSparkT", "_lastFireworkT",
  "_tetherKey", "_tetherFrom", "_tetherTo", "_tetherSegs", "_tetherSegKey",
  "_tetherAnchorA", "_tetherAnchorB",
] as const;
// Stardust keeps this many motes alive per caret; the pool is shared, so the
// cap scales with the caret count or ten carets would starve each other.
export const STARDUST_MAX_PER_CARET = 60;
// How far each serif narrows from its outer edge to where it meets the stem.
// A real I-beam's serifs are brackets, not slabs: they thin as they approach
// the stem instead of butting into it at full weight. Kept modest - past
// about a third the shape stops reading as a serif and starts reading as an
// arrowhead.
export const SERIF_TAPER = 0.3;
