"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => main_default
});
module.exports = __toCommonJS(main_exports);

// src/plugin.ts
var import_obsidian6 = require("obsidian");

// src/constants.ts
var DIRTY_RECT_CLEAR = true;
var CANVAS_REGION_MARGIN_X = 96;
var CANVAS_REGION_MARGIN_Y = 1.5;
var CANVAS_REGION_GRID = 64;
var CANVAS_REGION_SHRINK_MS = 2e3;
var CANVAS_REGION_SHRINK_RATIO = 2;
var CANVAS_REGION_MOTION_PAD = 32;
var SPEED_RAMP_LIFTOFF = 0.12;
var GLOW_HEAT_GAIN = 1.6;
function keystrokeHeatWeight(kind, repeat) {
  if (kind === "nav") return repeat ? 0.45 : 0.7;
  if (kind === "delete") return repeat ? 0.7 : 1;
  return repeat ? 0 : 1;
}
var CARET_COVERS = ".ws-mask, .ws-status-bar";
var GEOMETRY_TTL_MS = 400;
var DEVICE_ENABLED_KEY = "cursor-smith-enabled-on-this-device";
var INPUT_HOT_MS = 500;
var SCROLL_LOCK_MS = 120;
var CARET_THICKNESS_MAX = 7;
var CARET_STYLE_TTL_MS = 1e3;
var SMEAR_SETTLE_V = 30;
var WATCHDOG_INTERVAL_MS = 2e3;
var WATCHDOG_STALE_MS = 3e3;
var TORCH_CANVAS_SCALE = 0.25;
var FRAME_CAPS = {
  normal: { hotMinMs: 14, warmMs: 33, energyMs: 50, idleMs: 200, torchPulseMs: 33, torchIdleMs: 150 },
  lowPower: { hotMinMs: 30, warmMs: 50, energyMs: 80, idleMs: 250, torchPulseMs: 50, torchIdleMs: 250 }
};
var THUNDER_LIFE_MS = 280;
var THUNDER_MAX_ANGLE = 0.95;
var THUNDER_MIN_REACH = 150;
var THUNDER_PASSES = 5;
var THUNDER_MAX_LIVE = 3;
var THUNDER_PALETTE = [
  [110, 165, 255],
  // blue
  [175, 120, 255],
  // purple
  [255, 95, 115],
  // red
  [255, 216, 120],
  // yellow
  [255, 255, 255]
  // white
];
var THUNDER_BANDS = 14;
var FIREWORK_RISE_MS = 260;
var FIREWORK_FALL_MS = 620;
var FIREWORK_RISE_LINES = 3.4;
var FIREWORK_RISE_JITTER = 1.2;
var FIREWORK_DRIFT = 26;
var FIREWORK_GRAVITY = 420;
var FIREWORK_CELL = 3;
var FIREWORK_ALPHA = 0.55;
var FIREWORK_MAX_LIVE = 10;
var FIREWORK_MIN_GAP_MS = 70;
var FIREWORK_SPARK_BUDGET = 260;
var FIREWORK_SPARK_MIN = 5;
var FIREWORK_PRESSURE = 0.55;
var FIREWORK_TRAIL_LEN = 2;
var FIREWORK_TWINKLE_AT = 0.42;
var FIREWORK_PALETTE_MAX = 6;
var FIREWORK_SECOND_MAX = 3;
var FIREWORK_SECOND_SPARKS = 5;
var FIREWORK_SECOND_AT = [0.3, 0.55];
var TORCH_FLICKER_RATES = [8.7, 13.1, 21.3];
var TORCH_FLICKER_PHASES = [0, 1.7, 4.2];
var TORCH_FLICKER_WEIGHTS = [0.5, 0.3, 0.2];
var SMEAR_LEAD_BOOST_CAP = 6;
var SMEAR_VOLUME_MIN_FACTOR = 0.35;
var TAPER_MIN_LAG = 26;
var TAPER_FULL_LAG = 90;
var JUMP_TRAIL_MIN_DIST = 40;
var JUMP_TRAIL_STEP = 18;
var JUMP_TRAIL_MAX_PUFFS = 40;
var TRANSLUCENT_ALPHA = 0.95;
var CATCHUP_BOOST_RATE = 8;
var ROUNDED_THIN_PX = 6;
var ROUNDED_BLOCK_FRACTION = 0.25;
var SERIF_STEM_RATIO = 0.9;
var SERIF_HEIGHT_RATIO = 0.08;
var SERIF_MIN_SPAN_PX = 5;
var SERIF_MAX_SPAN_RATIO = 1.25;
var SECONDARY_FULL_MAX = 64;
var SECONDARY_MATCH_WINDOW = 32;
var CARET_STATE_FIELDS = [
  "lastActive",
  "pending",
  "animActive",
  "smearQuad",
  "smearShape",
  "smearCenterPrev",
  "_taperBuf",
  "_volumeBuf",
  "_smearDir",
  // The two-point quad's points (1.5.6). They were missing here until 1.5.8,
  // so a secondary's spring integrated the primary's points toward its own
  // target and the two carets' smears fought over one spring.
  "_smearLead",
  "_smearTrail",
  "_smearMoving",
  "_smearDtT",
  "smearQuadLastMoveT",
  "trail",
  "glitch",
  "_smoothMoving",
  "_smoothLastT",
  "_catchUpBoost",
  "_typingBoostSm",
  "typingSpeedMod",
  "_hotPrev",
  "_hotEmitFrom",
  "_hotActiveT",
  "_lastHotT",
  "hotBurns",
  "_hotShiftTick",
  "_hotEngulfUntil",
  "_lastStardustT",
  "_lastSparkT",
  "_lastFireworkT",
  "_tetherKey",
  "_tetherFrom",
  "_tetherTo",
  "_tetherSegs",
  "_tetherSegKey",
  "_tetherAnchorA",
  "_tetherAnchorB"
];
var STARDUST_MAX_PER_CARET = 60;
var SERIF_TAPER = 0.3;

// src/motion.ts
function torchFlickerScale(nowMs, amount) {
  const a = Math.max(0, Math.min(1, amount));
  if (a === 0) return 1;
  const t = nowMs / 1e3;
  let n = 0;
  for (let i = 0; i < TORCH_FLICKER_RATES.length; i++) {
    n += Math.sin(t * TORCH_FLICKER_RATES[i] + TORCH_FLICKER_PHASES[i]) * TORCH_FLICKER_WEIGHTS[i];
  }
  return 1 - a * (1 - n) / 2;
}
var REDUCED_MOTION_OFF_KEYS = [
  "smoothEnabled",
  // the cursor gliding to its destination
  "smear",
  // corner springs
  "popEffects",
  // letters, disintegration, thunderstrike, fireworks
  "flameTrail",
  // pixel trail, including the jump streak
  "stardustEnabled",
  // ambient drift
  "hotHead",
  // continuous fire
  "speedDemonSparks",
  // emission; the heat colour itself is not motion
  "crtGlitch",
  // whole-cursor displacement bursts
  "energyEffect",
  // wall-clock shimmer inside the cursor body
  "blinkBreathing",
  // size oscillation
  "overlayBlinkSync",
  // torch radius pulse
  "overlayFlicker"
  // torch candle flicker
];
function applyReducedMotion(obj) {
  for (const k of REDUCED_MOTION_OFF_KEYS) obj[k] = false;
  return obj;
}
function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}
function glitchNoise(a, b, c) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519) >>> 0;
  n = Math.imul(n ^ n >>> 13, 1274126177) >>> 0;
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function isTextCaretHost(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return type === "text" || type === "search" || type === "url" || type === "tel" || type === "email" || type === "password" || type === "number";
  }
  return false;
}
function blinkSegments(speed, onOffBalance = 0.5, fade = 0.15) {
  const period = 2500 / speed;
  fade = Math.max(0.02, Math.min(0.5, fade ?? 0.15));
  const balance = Math.max(0.1, Math.min(0.9, onOffBalance));
  const hold = 1 - fade * 2;
  const p1 = hold * balance;
  const p2 = p1 + fade;
  const p3 = p2 + hold * (1 - balance);
  return { period, p1, p2, p3, fade };
}
function blinkAlphaAt(nowMs, speed, onOffBalance = 0.5, fade = 0.15) {
  if (speed <= 0) return 1;
  const s = blinkSegments(speed, onOffBalance, fade);
  const phase = nowMs % s.period / s.period;
  if (phase < s.p1) return 1;
  if (phase < s.p2) return 1 - easeInOutSine((phase - s.p1) / s.fade);
  if (phase < s.p3) return 0;
  return easeInOutSine((phase - s.p3) / s.fade);
}

// src/settings.ts
var DEFAULT_SETTINGS = {
  enabled: true,
  cursorStyle: "Box",
  // "Line" | "Box" | "Underline"
  uiMode: "cua",
  // "cua" | "vim" — which settings panel is shown; drives vimModeEnabled
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
  crtGlitchStrength: 1,
  // 0.2..2.5; slice displacement + corner warp scale
  crtGlitchAberration: 1,
  // 0..3; RGB channel-split distance scale
  crtGlitchMs: 220,
  // 60..600; how long one burst lasts
  // --- torch spotlight effect (can run alongside any cursor style) ---
  torchEffect: false,
  overlaySpareSidebars: true,
  overlayFollowMode: "caret",
  // caret | mouse | auto
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
  overlayFlickerAmount: 0.3,
  // 0.05..1; share of base intensity the flame swings
  // Blink sync: the spotlight breathes with the caret's blink, contracting as
  // the caret fades out and opening back up as it returns. Off by default -
  // see the note in the torch tick, it is the one torch option that costs
  // frames while nothing else is happening.
  overlayBlinkSync: false,
  overlayBlinkDepth: 0.25,
  // 0.05..0.6; how far the light closes at the darkest point
  overlaySpeed: 0.22,
  // lerp factor: how fast the torch chases its target
  // Honour the OS "reduce motion" preference by switching the moving effects
  // off. Global rather than a LOOK key on purpose: it is an accessibility
  // preference about this machine, not part of a look, so it must not travel
  // in a share code or get overridden per Vim mode.
  respectReducedMotion: true,
  // --- global caret properties ---
  caretWidthPx: 2,
  // The Line cursor's height as a share of the line, centred (issue #33).
  caretHeightPct: 100,
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
  fireworksQuantity: 1,
  // 0.2..3
  flameTrail: true,
  // Pixel Trail sub-options.
  // Density multiplies how many pixels each move sheds; at 0 the trail emits
  // nothing, which is how you turn the pixels off while keeping the other
  // sub-effects (thunderstrike, disintegration) available.
  flameTrailDensity: 1,
  // 0..3 multiplier on the per-move particle count
  flameTrailLifeMs: 400,
  // 100..2000 how long each pixel lives before it's gone
  // Gravity: a steady pull on every trail pixel, angle in degrees clockwise
  // from "down" (0 = straight down, 90 = right, 180 = up, 270 = left) and a
  // strength in px/s². 0 strength leaves the original sideways drift untouched.
  flameTrailGravity: 0,
  // 0..1 strength (scaled to a px/s² range on use)
  flameTrailGravityAngle: 0,
  // degrees; 0 = down
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
  hotHeadQuantity: 1,
  // 0..3 multiplier on how much fire is emitted
  hotHeadSpread: 4,
  // 0..14 characters of surrounding text set alight, and
  // how long a patch of text keeps burning after the
  // caret has moved off it
  hotHeadTrail: 6,
  // 0..30 extra fire laid along the path just travelled
  hotHeadFade: 620,
  // 200..1600ms lifetime of a single fire particle
  hotHeadHeight: 0.55,
  // 0.15..1.5 how high the flames climb
  hotHeadOpacity: 1,
  // 0.1..1 overall opacity of the fire
  hotHeadIdleMs: 1500,
  // 0..6000ms of stillness before the fire stops being
  // fed and burns out; 0 = burns forever
  hotHeadFlat: false,
  // true = fire in the cursor's own color, no heat gradient
  hotHeadSpeedHeat: false,
  // true = Speed Demon's heat also tints the fire
  // Pop Effects sub-option: pressing Enter calls down a bolt of pixelated
  // lightning onto the caret's new position, from a random angle above it.
  // This used to hang off Pixel Trail and was gated on it; it is now
  // independent, so a bolt can strike with the trail switched off. Its impact
  // sparks are still thrown into the trail's particle pool, which is only a
  // shared pool and carries no dependency on the trail being enabled.
  thunderstrike: false,
  thunderstrikeSize: 2,
  // px per block of the bolt; the effect's chunkiness
  thunderstrikeStrength: 0.5,
  // 0.1..1 overall visibility of the strike
  // Pop Effects sub-option: Backspace/Delete throws the trail's particle burst
  // outward instead of trailing it, in inverted colours. Like Thunderstrike,
  // this used to hang off Pixel Trail and be gated on it; it now fires on its
  // own, so text can come apart with the ambient trail switched off. It still
  // borrows the trail's particle pool and physics dials (lifetime, pixel size,
  // gravity) - see the note in spawnFlamePixels.
  backspaceDisintegrate: false,
  lineSerifs: false,
  // Line cursor: add horizontal serifs (I-beam look)
  // Underline cursor thickness in px. 0 = auto: scale with the line height,
  // which is what this style did before the slider existed, so an existing
  // setup (and a fresh install) keeps exactly the look it had.
  underlineWidthPx: 0,
  boxHollow: false,
  // Box cursor: outline only, no fill
  boxHollowWidth: 2,
  // Outline stroke width when boxHollow is on
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
  speedDemonSparks: true,
  // spawn small fire particles at high heat
  speedDemonSensitivity: 1,
  // 0.5..2 multiplier on how fast heat builds
  speedDemonSparkQuantity: 1,
  // 0..3 multiplier on how many sparks spawn per burst
  speedDemonSparkTrail: 0,
  // 0..30px comet-tail trailing behind each spark; 0 = no trail
  speedDemonNoCursorHeat: false,
  // true = cursor keeps its own color as it heats up
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
  speedHeatDark1: "#2b4a8f",
  // cold — deep blue
  speedHeatDark2: "#17b8c4",
  // cooling — cyan
  speedHeatDark3: "#ff9a2e",
  // warm — orange
  speedHeatDark4: "#fff3d0",
  // white-hot
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
  stardustDelayMs: 2e3,
  // how long the cursor must sit still before emitting
  stardustRate: 1,
  // 0.2..3 multiplier on how thickly it streams
  // Orbit mode: motes circle the caret like fireflies instead of drifting
  // upward, and they track the caret as it moves rather than being left behind.
  stardustOrbit: false,
  stardustOrbitRadius: 22,
  // px; the mean orbit, which each mote varies around
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
  energyAuroraWaviness: 1,
  // 0..2
  // --- Bracket Tether: a faint line from the caret to its matching bracket ---
  bracketTether: false,
  bracketTetherStrength: 0.35,
  // 0.1..1 opacity of the line
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
  blinkFade: 0.15,
  // 0.05..0.5
  // Blink-to-solid: how many full blinks to run after the caret settles
  // before it stays lit. 0 is off, and off is the default - this changes
  // long-standing behaviour, so nobody gets it without asking. The count
  // restarts on every caret move, so it reads as "blink a few times to show
  // me where you are, then get out of the way".
  blinkStopAfter: 0,
  // 0..20, 0 = blink forever
  // Breathing: instead of fading out, the caret shrinks and swells on the blink
  // cycle and never disappears. Same clock, same speed/balance/delay controls -
  // only what the cycle drives is different.
  blinkBreathing: false,
  blinkBreathDepth: 0.2,
  // 0.05..0.5; how far it shrinks at the bottom of the breath       // ms of full-on hold after any move/keystroke before blinking resumes
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
  smearTaperAmount: 0.7,
  // 0..1; at 1 the tail closes to a point
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
  smoothness: 0.15,
  // 5-30% range (0.05 - 0.30)
  catchUpSpeed: 0.55,
  // 30-80% range (0.30 - 0.80)
  maxCatchUpSpeed: 0.85,
  // 50-100% range (0.50 - 1.00)
  smoothAdaptive: true,
  // Adaptive speed toggle
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
  vimActivePreset: "",
  // name of the vim preset last applied (for the UI)
  vimStatusBar: true,
  // show the live Vim mode in Obsidian's status bar
  vimStatusBarColor: true,
  // ...tinted with that mode's cursor color
  vimModes: {}
  // filled in below with full per-mode snapshots
};
var VIM_STATE_KEYS = [
  "vimPresets",
  "vimModes",
  "vimModeEnabled",
  "vimActivePreset",
  "vimControlObsidian",
  "vimStatusBar",
  "vimStatusBarColor"
];
var VIM_MODE_KEYS = ["normal", "insert", "visual", "replace", "command"];
var VIM_MODE_LABELS = {
  normal: "Normal",
  insert: "Insert",
  visual: "Visual",
  replace: "Replace",
  command: "Command"
};
var LOOK_KEYS = [
  "cursorStyle",
  "colorDark",
  "colorLight",
  "gradientEnabled",
  "gradientCount",
  "gradientDark1",
  "gradientDark2",
  "gradientDark3",
  "gradientDark4",
  "gradientLight1",
  "gradientLight2",
  "gradientLight3",
  "gradientLight4",
  "crtEffect",
  "glow",
  "crtNeon",
  "crtNeonGradient",
  "torchEffect",
  "overlaySpareSidebars",
  "overlayFollowMode",
  "overlayRadius",
  "overlayDarkness",
  "overlayIntensity",
  "overlayColor",
  "overlayFlicker",
  "overlaySpeed",
  "overlayBlinkSync",
  "overlayBlinkDepth",
  "caretWidthPx",
  "popLetters",
  "popRainbow",
  "flameTrail",
  "backspaceDisintegrate",
  "flameTrailDensity",
  "flameTrailLifeMs",
  "flameTrailGravity",
  "flameTrailGravityAngle",
  "flameTrailOnJump",
  "flameTrailGradientColors",
  "flameTrailPixelSize",
  "thunderstrike",
  "thunderstrikeSize",
  "thunderstrikeStrength",
  "stardustEnabled",
  "stardustAlwaysOn",
  "stardustDelayMs",
  "stardustRate",
  "stardustOrbit",
  "stardustOrbitRadius",
  "bracketTether",
  "bracketTetherStrength",
  "lineSerifs",
  "boxHollow",
  "boxHollowWidth",
  "underlineWidthPx",
  "speedDemon",
  "speedDemonSparks",
  "speedDemonSensitivity",
  "speedDemonSparkQuantity",
  "speedDemonSparkTrail",
  "speedDemonNoCursorHeat",
  "hotHead",
  "hotHeadQuantity",
  "hotHeadSpread",
  "hotHeadTrail",
  "hotHeadFade",
  "hotHeadHeight",
  "hotHeadOpacity",
  "hotHeadFlat",
  "hotHeadIdleMs",
  "cursorOpacity",
  "energyEffect",
  "energySpeed",
  "energyAurora",
  "trailLength",
  "trailFadeMs",
  "blinkingEnabled",
  "blinkSpeed",
  "blinkOnOffBalance",
  "blinkDelayMs",
  "blinkFade",
  "blinkBreathing",
  "blinkBreathDepth",
  "showChar",
  "moveDelayMs",
  "smear",
  "smearStiffness",
  "smearTrailingStiffness",
  "smearDamping",
  "smearTaper",
  "smearTaperAmount",
  "smoothEnabled",
  "smoothStopBlinking",
  "smoothness",
  "catchUpSpeed",
  "maxCatchUpSpeed",
  "smoothAdaptive",
  // APPEND-ONLY BELOW THIS LINE. A share code stores each field as its INDEX
  // into this array, so inserting or reordering anything above silently
  // reinterprets every code already in the wild. Appending is safe: older
  // codes just don't mention these indices and fall back to defaults, and
  // codeToPreset already skips indices it doesn't recognise.
  "crtGlitch",
  "crtGlitchStrength",
  "crtGlitchAberration",
  "crtGlitchMs",
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
  "popEffects",
  "fireworks",
  "fireworksQuantity",
  // Speed Demon's custom heat ramp, and the CRT inverted trail. Appended, like
  // everything else here.
  "speedDemonGradient",
  "speedHeatDark1",
  "speedHeatDark2",
  "speedHeatDark3",
  "speedHeatDark4",
  "speedHeatLight1",
  "speedHeatLight2",
  "speedHeatLight3",
  "speedHeatLight4",
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
  "smearMaxLength",
  "smearConserveVolume",
  "smearVolumeStrength",
  // The Line cursor's height (1.6.6, issue #33). Appended; the default is the
  // full line, so an older code imports as the caret it described.
  "caretHeightPct"
];
function migrateLegacyKeys(src) {
  if (!src || typeof src !== "object") return src;
  const o = Object.assign({}, src);
  for (let i = 1; i <= 4; i++) {
    const oldKey = "gradientColor" + i;
    const newKey = "gradientDark" + i;
    if (oldKey in o) {
      if (o[newKey] === void 0) o[newKey] = o[oldKey];
      delete o[oldKey];
    }
  }
  if ("idleStardust" in o) {
    if (o.stardustEnabled === void 0) o.stardustEnabled = o.idleStardust;
    delete o.idleStardust;
  }
  if ("boxTranslucent" in o) {
    if (o.cursorTranslucent === void 0) o.cursorTranslucent = o.boxTranslucent;
    delete o.boxTranslucent;
  }
  delete o.boxTranslucency;
  delete o.boxTranslucentMode;
  delete o.boxLens;
  delete o.textCrawl;
  delete o.textCrawlSpeed;
  delete o.textCrawlGlow;
  delete o.textCrawlFlip;
  delete o.textCrawlRainbow;
  delete o.crtInvert;
  delete o.crtInvertStrength;
  delete o.matrixRain;
  delete o.matrixRainDensity;
  delete o.inkEffect;
  delete o.inkColor;
  delete o.inkOpacity;
  delete o.inkPooling;
  const OLD_POP_KEYS = ["popLetters", "thunderstrike", "backspaceDisintegrate"];
  if (!("popEffects" in o) && OLD_POP_KEYS.some((k) => k in o)) {
    const trailWasOn = o.flameTrail !== false;
    if (!trailWasOn) {
      if (o.thunderstrike) o.thunderstrike = false;
      if (o.backspaceDisintegrate) o.backspaceDisintegrate = false;
    }
    o.popEffects = !!o.popLetters || !!o.thunderstrike || !!o.backspaceDisintegrate;
  }
  return o;
}
function pickLook(src) {
  const o = {};
  if (!src) return o;
  const from = migrateLegacyKeys(src);
  const dst = o, fromRec = from;
  for (const k of LOOK_KEYS) if (k in from) dst[k] = fromRec[k];
  return o;
}
function fullVimMode(overrides) {
  return Object.assign(pickLook(DEFAULT_SETTINGS), pickLook(overrides));
}
function vimModeSnapshot(modeKey, overrides) {
  return fullVimMode(overrides || VIM_MODE_STARTERS[modeKey]);
}
function presetWithDefaults(preset) {
  return Object.assign({}, pickLook(DEFAULT_SETTINGS), migrateLegacyKeys(preset));
}
function cloneVimModes(modes) {
  const out = {};
  for (const k of VIM_MODE_KEYS) out[k] = vimModeSnapshot(k, modes && modes[k]);
  return out;
}

// src/presets.ts
var VIM_MODE_STARTERS = {
  normal: {
    cursorStyle: "Box",
    colorDark: "#4aa3ff",
    colorLight: "#1e6fd0",
    blinkingEnabled: true,
    speedDemon: false,
    crtEffect: false
  },
  // blue blinking box
  insert: {
    cursorStyle: "Line",
    colorDark: "#39ff14",
    colorLight: "#2a7d2e",
    blinkingEnabled: false,
    caretWidthPx: 2
  },
  // thin steady line
  visual: {
    cursorStyle: "Box",
    colorDark: "#f5a623",
    colorLight: "#b26a00",
    boxHollow: true,
    blinkingEnabled: false
  },
  // hollow amber box
  replace: {
    cursorStyle: "Underline",
    colorDark: "#ff3b3b",
    colorLight: "#b30000",
    caretWidthPx: 3,
    blinkingEnabled: true
  },
  // red underline
  // Command (":" / "/" prompt) lives in a one-line <input>, not the note
  // editor, so the motion effects are deliberately off: smear and smooth
  // catch-up both look like jitter in a field that's ~20px tall.
  command: {
    cursorStyle: "Line",
    colorDark: "#c792ea",
    colorLight: "#7d3fbf",
    caretWidthPx: 2,
    blinkingEnabled: true,
    blinkSpeed: 1,
    smear: false,
    smoothEnabled: false,
    crtEffect: false,
    speedDemon: false,
    torchEffect: false
  }
  // violet line
};
var PRESET1_VIM_MODES = {
  normal: {
    "cursorStyle": "Box",
    "colorDark": "#499bf3",
    "colorLight": "#3c6ebe",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 2,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": false,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1.2,
    "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": true,
    "smearStiffness": 0.8,
    "smearTrailingStiffness": 0.55,
    "smearDamping": 0.35,
    "smoothEnabled": true,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.55,
    "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  insert: {
    "cursorStyle": "Line",
    "colorDark": "#4fe87d",
    "colorLight": "#29bc3a",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 2,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": false,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": true,
    "blinkSpeed": 0.9,
    "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 1200,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": false,
    "smearStiffness": 0.6,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8,
    "smoothEnabled": true,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.55,
    "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  visual: {
    "cursorStyle": "Box",
    "colorDark": "#e3cb31",
    "colorLight": "#e8bd21",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 2,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": false,
    "lineSerifs": false,
    "boxHollow": true,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1.2,
    "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": false,
    "smearStiffness": 0.6,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8,
    "smoothEnabled": false,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.55,
    "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  replace: {
    "cursorStyle": "Underline",
    "colorDark": "#f54747",
    "colorLight": "#ff1a1a",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 3,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": false,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1.2,
    "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": true,
    "smearStiffness": 0.6,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8,
    "smoothEnabled": false,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.55,
    "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  },
  // Violet line for the ":" prompt — distinct from the other four modes at a
  // glance, with the motion effects off (see VIM_MODE_STARTERS.command).
  command: {
    "cursorStyle": "Line",
    "colorDark": "#c792ea",
    "colorLight": "#7d3fbf",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 2,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": false,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": true,
    "blinkSpeed": 1,
    "blinkOnOffBalance": 0.5,
    "blinkDelayMs": 0,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": false,
    "smearStiffness": 0.6,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8,
    "smoothEnabled": false,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.55,
    "maxCatchUpSpeed": 0.85,
    "smoothAdaptive": true
  }
};
DEFAULT_SETTINGS.vimModes = cloneVimModes(PRESET1_VIM_MODES);
var DEFAULT_PRESETS = {
  "Jell-O": {
    "cursorStyle": "Box",
    "colorDark": "#31edae",
    "colorLight": "#147133",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 3,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": true,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1.4,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1.5,
    "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200,
    "hideNativeCaret": true,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": true,
    "smearStiffness": 0.65,
    "smearTrailingStiffness": 0.15,
    "smearDamping": 0.4,
    "smoothEnabled": true,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.6,
    "maxCatchUpSpeed": 0.9,
    "smoothAdaptive": true
  },
  "Torch-Crt": {
    "cursorStyle": "Line",
    "colorDark": "#f3c258",
    "colorLight": "#147133",
    "crtEffect": true,
    "glow": true,
    "torchEffect": true,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 3,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": true,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1.4,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1.5,
    "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200,
    "hideNativeCaret": true,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": false,
    "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.5,
    "smoothEnabled": true,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.6,
    "maxCatchUpSpeed": 0.9,
    "smoothAdaptive": true
  },
  "mr.Blue": {
    "cursorStyle": "Line",
    "colorDark": "#3182ed",
    "colorLight": "#0077aa",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 3,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": true,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1.4,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": true,
    "blinkSpeed": 1,
    "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200,
    "hideNativeCaret": true,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": false,
    "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8,
    "smoothEnabled": true,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.6,
    "maxCatchUpSpeed": 0.9,
    "smoothAdaptive": true
  },
  "FairyDust": {
    "cursorStyle": "Underline",
    "colorDark": "#fff6bd",
    "colorLight": "#e9cb35",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 3,
    "popLetters": false,
    "flameTrail": true,
    "backspaceDisintegrate": true,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": true,
    "energySpeed": 1.4,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1,
    "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200,
    "hideNativeCaret": true,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": true,
    "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8,
    "smoothEnabled": true,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.6,
    "maxCatchUpSpeed": 0.9,
    "smoothAdaptive": true
  },
  "DarkMatter": {
    "cursorStyle": "Box",
    "colorDark": "#3ba2e3",
    "colorLight": "#e15ff2",
    "crtEffect": true,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 3,
    "popLetters": false,
    "flameTrail": true,
    "backspaceDisintegrate": true,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": true,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 0.5,
    "cursorOpacity": 1,
    "energyEffect": true,
    "energySpeed": 1.4,
    "trailLength": 3,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1,
    "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200,
    "hideNativeCaret": true,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": false,
    "smearStiffness": 0.7,
    "smearTrailingStiffness": 0.4,
    "smearDamping": 0.8,
    "smoothEnabled": true,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.6,
    "maxCatchUpSpeed": 0.9,
    "smoothAdaptive": true
  },
  "old_Joe": {
    "cursorStyle": "Box",
    "colorDark": "#c2c2c2",
    "colorLight": "#454545",
    "crtEffect": false,
    "glow": true,
    "torchEffect": false,
    "overlaySpareSidebars": true,
    "overlayFollowMode": "caret",
    "overlayRadius": 250,
    "overlayDarkness": 0.7,
    "overlayIntensity": 0.1,
    "overlayColor": "#ff963c",
    "overlayFlicker": false,
    "overlaySpeed": 0.22,
    "caretWidthPx": 3,
    "popLetters": false,
    "flameTrail": false,
    "backspaceDisintegrate": true,
    "lineSerifs": false,
    "boxHollow": false,
    "boxHollowWidth": 2,
    "speedDemon": false,
    "speedDemonSparks": true,
    "speedDemonSensitivity": 1,
    "cursorOpacity": 1,
    "energyEffect": false,
    "energySpeed": 1.4,
    "trailLength": 10,
    "trailFadeMs": 450,
    "blinkingEnabled": false,
    "blinkSpeed": 1.5,
    "blinkOnOffBalance": 0.55,
    "blinkDelayMs": 1200,
    "hideNativeCaret": true,
    "showChar": true,
    "moveDelayMs": 0,
    "smear": false,
    "smearStiffness": 0.65,
    "smearTrailingStiffness": 0.15,
    "smearDamping": 0.4,
    "smoothEnabled": false,
    "smoothStopBlinking": true,
    "smoothness": 0.15,
    "catchUpSpeed": 0.6,
    "maxCatchUpSpeed": 0.9,
    "smoothAdaptive": true
  }
};
var DEFAULT_PRESET_NAME = "Jell-O";
function applyStarterPreset(settings) {
  const starter = settings && settings.userPresets && settings.userPresets[DEFAULT_PRESET_NAME];
  if (!starter) return false;
  Object.assign(settings, presetWithDefaults(starter));
  return true;
}
var DEFAULT_VIM_PRESETS = {
  "Preset1": PRESET1_VIM_MODES
};

// src/settings-tab.ts
var import_obsidian = require("obsidian");

// src/share.ts
var SHARE_VERSION = "1";
function shareEncodeValue(v) {
  if (typeof v === "boolean") return "b" + (v ? "1" : "0");
  if (typeof v === "number") return "n" + shareNum(v);
  if (typeof v === "string") {
    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) return "c" + v.slice(1);
    return "s" + encodeURIComponent(v);
  }
  return "j" + encodeURIComponent(JSON.stringify(v));
}
function shareNum(n) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}
function shareDecodeValue(tag, raw) {
  switch (tag) {
    case "b":
      return raw === "1";
    case "n":
      return Number(raw);
    case "c":
      return "#" + raw;
    case "s":
      return decodeURIComponent(raw);
    case "j":
      try {
        return JSON.parse(decodeURIComponent(raw));
      } catch {
        return void 0;
      }
    default:
      return void 0;
  }
}
function shareFields(look, defaults) {
  const fields = [];
  for (let i = 0; i < LOOK_KEYS.length; i++) {
    const k = LOOK_KEYS[i];
    if (!(k in look)) continue;
    const v = look[k];
    if (v === void 0) continue;
    if (v === defaults[k]) continue;
    if (typeof v === "number" && typeof defaults[k] === "number" && shareNum(v) === shareNum(defaults[k])) continue;
    fields.push(i + shareEncodeValue(v));
  }
  return fields.join("~");
}
function shareParseFields(body) {
  const snap = {};
  if (!body) return snap;
  for (const field of body.split("~")) {
    if (!field) continue;
    const m = /^(\d+)(.)([\s\S]*)$/.exec(field);
    if (!m) continue;
    const key = LOOK_KEYS[Number(m[1])];
    if (!key) continue;
    const val = shareDecodeValue(m[2], m[3]);
    if (val !== void 0) snap[key] = val;
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
  if (trimmed.slice(0, 2) !== SHARE_VERSION + "|") return null;
  try {
    const parts = trimmed.split("|");
    const name = decodeURIComponent(parts[1] || "") || "Imported preset";
    return { name, snap: shareParseFields(parts.slice(2).join("|")) };
  } catch {
    return null;
  }
}
var SHARE_VERSION_VIM = "2";
function vimPresetToCode(name, modes) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  const bodies = VIM_MODE_KEYS.map((m) => shareFields(pickLook(vimModeSnapshot(m, modes && modes[m])), defaults));
  return [SHARE_VERSION_VIM, encodeURIComponent(name || ""), ...bodies].join("|");
}
function codeToVimPreset(code) {
  const trimmed = (code || "").trim();
  if (trimmed.slice(0, 2) !== SHARE_VERSION_VIM + "|") return null;
  try {
    const parts = trimmed.split("|");
    const name = decodeURIComponent(parts[1] || "") || "Imported Vim preset";
    const modes = {};
    VIM_MODE_KEYS.forEach((m, i) => {
      const body = parts[2 + i];
      if (body === void 0) return;
      modes[m] = migrateLegacyKeys(shareParseFields(body));
    });
    return { name, modes };
  } catch {
    return null;
  }
}

// src/color.ts
function hexToRgba(hex, alpha) {
  let h = (hex || "#39ff14").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const int = parseInt(h, 16) || 0;
  const r = int >> 16 & 255;
  const g = int >> 8 & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function hexToRgb(hex) {
  let h = (hex || "#ff963c").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const n = parseInt(h, 16) || 0;
  return `${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}`;
}
function lighten(c, f) {
  return Math.round(c + (255 - c) * f);
}
function thunderRamp(hue = null) {
  if (typeof hue === "number") {
    return [
      hslToRgbTuple(hue, 0.85, 0.62),
      hslToRgbTuple(hue + 18, 0.8, 0.72),
      hslToRgbTuple(hue + 36, 0.7, 0.85)
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
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
}
function hexToRgbTuple(hex) {
  let h = (hex || "#ffffff").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16) || 0;
  return [int >> 16 & 255, int >> 8 & 255, int & 255];
}
function hslToRgbTuple(h, s, l) {
  const hue = (h % 360 + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(hue / 60 % 2 - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (hue < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}
function hslToRgbString(h, s, l) {
  const [r, g, b] = hslToRgbTuple(h, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}
function rgbToHsv([r, g, b]) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rr) h = 60 * ((gg - bb) / d % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max > 1e-6 ? d / max : 0, max];
}
function hsvToRgb([h, s, v]) {
  const hue = (h % 360 + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(hue / 60 % 2 - 1));
  const m = val - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
}
function lerpHsv(a, b, f, arc = 0) {
  let hue;
  if (a[1] < 0.03) hue = b[0];
  else if (b[1] < 0.03) hue = a[0];
  else {
    let d = (b[0] - a[0] + 540) % 360 - 180;
    if (arc > 0 && d < 0) d += 360;
    else if (arc < 0 && d > 0) d -= 360;
    hue = a[0] + d * f;
  }
  return [hue, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
function rgbTupleToHex([r, g, b]) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${(1 << 24 | c(r) << 16 | c(g) << 8 | c(b)).toString(16).slice(1)}`;
}
function parseColorTuple(colorStr) {
  if (!colorStr || typeof colorStr !== "string") return null;
  const s = colorStr.trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length < 6) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(n)) return null;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const nums = s.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  const t = nums.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
  return t.some((v) => !Number.isFinite(v)) ? null : t;
}
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
var GLYPH_MIN_CONTRAST = 4.5;
function readableGlyphColor(boxColorStr, mode = "contrast") {
  const box = parseColorTuple(boxColorStr);
  if (!box) return "#000000";
  const inv = [255 - box[0], 255 - box[1], 255 - box[2]];
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  if (mode === "invert") return rgb(inv);
  const white = [255, 255, 255], black = [0, 0, 0];
  const poleC = contrastRatio(white, box) >= contrastRatio(black, box) ? white : black;
  if (mode !== "tinted") return rgb(poleC);
  if (contrastRatio(inv, box) >= GLYPH_MIN_CONTRAST) return rgb(inv);
  const pole = poleC[0];
  const STEPS = 16;
  let best = inv;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const c = [
      Math.round(inv[0] + (pole - inv[0]) * t),
      Math.round(inv[1] + (pole - inv[1]) * t),
      Math.round(inv[2] + (pole - inv[2]) * t)
    ];
    best = c;
    if (contrastRatio(c, box) >= GLYPH_MIN_CONTRAST) break;
  }
  return rgb(best);
}

// src/demo.ts
var TRANSLUCENT_ALPHA2 = 0.95;
var ROUNDED_THIN_PX2 = 6;
var ROUNDED_BLOCK_FRACTION2 = 0.25;
function shapeOf(look, color, stops, px) {
  const style = String(look.cursorStyle || "Box").toLowerCase();
  const gradientOn = !!look.gradientEnabled && stops.length >= 2;
  const angle = style === "underline" ? 90 : 180;
  const gradient = gradientOn ? `linear-gradient(${angle}deg, ${stops.map((c, i) => `${c} ${Math.round(i / (stops.length - 1) * 100)}%`).join(", ")})` : null;
  const thick = style === "line" ? Math.max(1, Math.min(5, Math.round((look.caretWidthPx ?? 2) * 0.75))) : style === "underline" ? (look.underlineWidthPx ?? 0) > 0 ? Math.max(1, Math.min(4, Math.round((look.underlineWidthPx ?? 0) * 0.75))) : 2 : Math.max(1, px - 1);
  const hollowWidth = style === "box" && look.boxHollow ? Math.max(1, Math.min(3, Math.round((look.boxHollowWidth ?? 2) * 0.75))) : 0;
  let radius = 0;
  if (look.cursorRounded) {
    const minor = style === "box" ? Math.min(px - 1, 12) : thick;
    radius = minor <= ROUNDED_THIN_PX2 ? minor / 2 : Math.min(minor * ROUNDED_BLOCK_FRACTION2, minor / 2);
  }
  return {
    fill: gradientOn ? stops[0] : color,
    gradient,
    thick,
    hollowWidth,
    radius,
    serifs: style === "line" && !!look.lineSerifs,
    alphaScale: (look.cursorOpacity ?? 1) * (look.cursorTranslucent ? TRANSLUCENT_ALPHA2 : 1)
  };
}
var TYPE_MS = 170;
var HOLD_END_MS = 650;
var HOLD_START_MS = 450;
var POOL = 18;
var DEMO_CYCLES = 2;
function initialState(now) {
  return { target: 0, lead: 0, trail: 0, phase: "type", phaseMs: 0, lastKeyMs: now, heat: 0, ghosts: [] };
}
var idleAt = (n) => n + 1;
function step(s, look, n, dt, now, frozen = false) {
  const dtS = Math.min(0.1, dt / 1e3);
  s.phaseMs += dt;
  const move = (to) => {
    if (look.crtEffect && (look.trailLength ?? 0) > 0) {
      s.ghosts.push({ at: s.lead, t0: now });
      if (s.ghosts.length > (look.trailLength ?? 0)) s.ghosts.shift();
    }
    s.target = to;
    s.lastKeyMs = now;
  };
  if (frozen) {
  } else if (s.phase === "type") {
    if (s.phaseMs >= TYPE_MS) {
      s.phaseMs = 0;
      if (s.target < n) move(s.target + 1);
      else s.phase = "holdEnd";
    }
  } else if (s.phase === "holdEnd") {
    if (s.phaseMs >= HOLD_END_MS) {
      s.phaseMs = 0;
      move(0);
      s.phase = "holdStart";
    }
  } else if (s.phaseMs >= HOLD_START_MS) {
    s.phaseMs = 0;
    s.phase = "type";
  }
  if (look.smoothEnabled) {
    const rate = Math.max(0.5, (look.catchUpSpeed ?? 0.5) * (1 - (look.smoothness ?? 0.15)) * 40);
    s.lead += (s.target - s.lead) * (1 - Math.exp(-rate * dtS));
  } else if (look.smear) {
    const rate = 14 + (look.smearStiffness ?? 0.6) * 40;
    s.lead += (s.target - s.lead) * (1 - Math.exp(-rate * dtS));
  } else {
    s.lead = s.target;
  }
  if (Math.abs(s.target - s.lead) < 0.01) s.lead = s.target;
  if (look.smear) {
    const rate = 9 + (look.smearTrailingStiffness ?? 0.4) * 40;
    s.trail += (s.lead - s.trail) * (1 - Math.exp(-rate * dtS));
    if (Math.abs(s.lead - s.trail) < 0.01) s.trail = s.lead;
  } else {
    s.trail = s.lead;
  }
  if (look.speedDemon) {
    s.heat = s.phase === "type" ? Math.min(1, s.heat + dtS * 0.45) : Math.max(0, s.heat - dtS * 0.6);
  }
  const fade = look.trailFadeMs ?? 300;
  s.ghosts = s.ghosts.filter((g) => now - g.t0 < fade);
  return s;
}
function blinkAlpha(s, look, now) {
  if (!look.blinkingEnabled) return 1;
  if (look.smoothStopBlinking && now - s.lastKeyMs < (look.blinkDelayMs ?? 0) + TYPE_MS * 1.5) return 1;
  return blinkAlphaAt(now, look.blinkSpeed ?? 1, look.blinkOnOffBalance ?? 0.5, look.blinkFade ?? 0.15);
}
function heatColor(base, stops, heat) {
  if (heat <= 0 || stops.length < 3) return base;
  const seq = [base, ...stops];
  const pos = heat * (seq.length - 1);
  const i = Math.min(seq.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgbTuple(seq[i]);
  const b = hexToRgbTuple(seq[i + 1]);
  return rgbTupleToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f].map(Math.round));
}
var DemoStrip = class {
  constructor() {
    this.demos = [];
    this.raf = 0;
    this.last = 0;
    this.win = null;
    this.tick = (now) => {
      const dt = this.last ? Math.min(100, now - this.last) : 16;
      this.last = now;
      this.demos = this.demos.filter((d) => d.el.isConnected && !(d.done && d.stepPx > 0 && d.particles.length === 0 && d.state.lead === d.state.target && d.state.trail === d.state.lead));
      for (const d of this.demos) {
        if (!d.stepPx) {
          const doc = d.text.ownerDocument;
          const range = doc.createRange();
          range.selectNodeContents(d.text);
          const w = range.getBoundingClientRect().width;
          if (w > 0 && d.n > 0) d.stepPx = w / d.n;
          else continue;
        }
        if (!d.done) {
          const before = d.state.target;
          const phaseBefore = d.state.phase;
          step(d.state, d.look, d.n, dt, now);
          if (d.state.target !== before) this.onMove(d, before, now);
          if (phaseBefore === "type" && d.state.phase === "holdEnd" && ++d.cycles >= DEMO_CYCLES) {
            d.done = true;
            d.state.target = idleAt(d.n);
          }
          this.emit(d, dt, now);
        } else {
          step(d.state, d.look, d.n, dt, now, true);
        }
        this.moveParticles(d, dt, now);
        const heat = d.look.speedDemon && !d.look.speedDemonNoCursorHeat ? d.state.heat : 0;
        this.paint(d, blinkAlpha(d.state, d.look, now), 1 - heat);
      }
      this.raf = this.demos.length && this.win ? this.win.requestAnimationFrame(this.tick) : 0;
    };
  }
  // Builds the demo into `host` and starts it. `color` is the preset's
  // color for the current theme; `heatStops` its four heat stops for it.
  add(host, name, look, color, heatStops, gradientStops, reduced, play) {
    const demo = host.createSpan({ cls: "cursor-smith-pcard-demo" });
    const text = demo.createSpan({ cls: "cursor-smith-pcard-text cursor-smith-pcard-name", text: name });
    const style = String(look.cursorStyle || "Box").toLowerCase();
    const shape = shapeOf(look, color, gradientStops, 8);
    const dress = (el, alpha) => {
      const st = { opacity: alpha, borderRadius: `${shape.radius}px` };
      if (shape.hollowWidth) {
        st.backgroundColor = "transparent";
        st.backgroundImage = "";
        st.border = `${shape.hollowWidth}px solid ${shape.fill}`;
        if (shape.gradient) {
          st.borderImage = `${shape.gradient} 1`;
          st.borderRadius = "0";
        }
      } else {
        st.backgroundColor = shape.fill;
        st.backgroundImage = shape.gradient ?? "";
      }
      if (style === "line") st.width = `${shape.thick}px`;
      if (style === "underline") {
        st.height = `${shape.thick}px`;
        st.top = `${18 - shape.thick}px`;
      }
      el.setCssStyles(st);
    };
    const ghosts = [];
    if (look.crtEffect && (look.trailLength ?? 0) > 0) {
      for (let i = 0; i < Math.min(30, look.trailLength ?? 0); i++) {
        const g = demo.createSpan({ cls: `cursor-smith-pcard-ghost cursor-smith-pcard-caret-${style}`, attr: { "aria-hidden": "true" } });
        dress(g, "0");
        ghosts.push(g);
      }
    }
    const caret = demo.createSpan({ cls: `cursor-smith-pcard-caret cursor-smith-pcard-caret-${style}` + (shape.serifs ? " is-serif" : ""), attr: { "aria-hidden": "true" } });
    dress(caret, String(shape.alphaScale));
    if (look.crtEffect && look.glow) caret.setCssStyles({ boxShadow: `0 0 6px ${shape.fill}` });
    let inner = null;
    if (style === "box" && look.showChar !== false && !shape.hollowWidth && !look.cursorTranslucent) {
      inner = caret.createSpan({ cls: "cursor-smith-pcard-caret-text", text: name });
      inner.setCssStyles({ color: readableGlyphColor(shape.fill, look.glyphColorMode ?? "contrast") });
    }
    const d = { el: demo, shape, cycles: 0, done: false, particles: [], pool: [], spawnAcc: 0, lastTarget: 0, text, caret, inner, ghosts, look, color, heatStops, n: name.length, style, state: initialState(0), stepPx: 0 };
    const win = host.ownerDocument?.defaultView ?? null;
    if (!play || reduced) {
      d.state.target = d.state.lead = d.state.trail = idleAt(d.n);
      d.done = true;
    }
    this.paint(d, 1, 1);
    if (!win || typeof win.requestAnimationFrame !== "function") return;
    this.demos.push(d);
    this.win = win;
    if (!this.raf) this.raf = win.requestAnimationFrame(this.tick);
  }
  // A particle from the pool, or none when the card has its share.
  spawn(d, x, y, vx, vy, life, size, color, now) {
    if (d.particles.length >= POOL) return;
    let el = d.pool.pop() ?? null;
    if (!el) el = d.el.createSpan({ cls: "cursor-smith-pcard-particle", attr: { "aria-hidden": "true" } });
    el.setCssStyles({ width: `${size}px`, height: `${size}px`, backgroundColor: color, opacity: "1" });
    d.particles.push({ el, x, y, vx, vy, t0: now, life, size, color });
  }
  // On a keystroke (or the jump back): Pixel trail throws pixels from the
  // spot the caret leaves; Hot-head lays a little fire along the way.
  onMove(d, from, now) {
    const px = d.stepPx;
    const look = d.look;
    const x0 = from * px;
    if (look.flameTrail) {
      const count = Math.round(3 * (look.flameTrailDensity ?? 1));
      const size = Math.max(2, Math.min(3, Math.round((look.flameTrailPixelSize ?? 4) / 2)));
      const g = (look.flameTrailGravity ?? 0) * 60;
      const ang = (look.flameTrailGravityAngle ?? 0) * Math.PI / 180;
      for (let i = 0; i < count; i++) {
        this.spawn(d, x0 + Math.random() * px, 6 + Math.random() * 10, (Math.random() - 0.5) * 30 + Math.sin(ang) * g * 0.3, (Math.random() - 0.5) * 30 + Math.cos(ang) * g * 0.3, Math.min(700, look.flameTrailLifeMs ?? 400), size, d.color, now);
      }
    }
    if (look.hotHead) {
      const count = Math.round(2 * (look.hotHeadQuantity ?? 1));
      for (let i = 0; i < count; i++) this.spawnFlame(d, x0 + Math.random() * px, now);
    }
  }
  // Over time: Stardust while the caret rests, flames while it types (and
  // embers while it is hot), each at its preset's rate.
  emit(d, dt, now) {
    const look = d.look;
    const st = d.state;
    const x = st.lead * d.stepPx;
    d.spawnAcc += dt;
    const resting = st.phase !== "type";
    if (look.stardustEnabled && (resting || look.stardustAlwaysOn)) {
      const every = 220 / (look.stardustRate ?? 1);
      if (d.spawnAcc >= every) {
        d.spawnAcc = 0;
        this.spawn(d, x + (Math.random() - 0.5) * 12, 12 + Math.random() * 6, (Math.random() - 0.5) * 8, -(10 + Math.random() * 12), 900, 1, d.color, now);
      }
    } else if (look.hotHead && !resting) {
      const every = 70 / (look.hotHeadQuantity ?? 1);
      if (d.spawnAcc >= every) {
        d.spawnAcc = 0;
        this.spawnFlame(d, x + Math.random() * Math.max(2, d.stepPx - 2), now);
      }
    } else if (look.speedDemon && look.speedDemonSparks && st.heat > 0.6) {
      if (d.spawnAcc >= 90) {
        d.spawnAcc = 0;
        this.spawn(d, x + Math.random() * d.stepPx, 6, (Math.random() - 0.5) * 40, -(30 + Math.random() * 30), 450, 1, heatColor(d.color, d.heatStops, 0.9), now);
      }
    }
  }
  // One flame: a pixel that climbs and fades, in the fire's colors (or
  // the cursor's, with Fire in cursor color on).
  spawnFlame(d, x, now) {
    const look = d.look;
    const rise = 24 * (look.hotHeadHeight ?? 0.55);
    const color = look.hotHeadFlat ? d.color : ["#ff6a1a", "#ffa62b", "#ffd166", "#fff1b8"][Math.floor(Math.random() * 4)];
    this.spawn(d, x, 4 + Math.random() * 4, (Math.random() - 0.5) * 6, -(rise + Math.random() * rise * 0.5) * 2, Math.min(600, look.hotHeadFade ?? 620) * 0.6, 2, color, now);
  }
  moveParticles(d, dt, now) {
    const dtS = dt / 1e3;
    const keep = [];
    for (const p of d.particles) {
      const age = (now - p.t0) / p.life;
      if (age >= 1) {
        p.el.setCssStyles({ opacity: "0" });
        d.pool.push(p.el);
        continue;
      }
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.el.setCssStyles({ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`, opacity: (1 - age).toFixed(2) });
      keep.push(p);
    }
    d.particles = keep;
  }
  // Puts the caret (and the ghosts) where the state says. `cold` is 1 - heat.
  paint(d, alpha, cold) {
    const px = d.stepPx || 8;
    const s = d.state;
    const from = Math.min(s.lead, s.trail) * px;
    const to = Math.max(s.lead, s.trail) * px;
    const stretch = Math.min(to - from, px * 2);
    const base = d.style === "line" ? d.shape.thick : Math.max(1, px - 1);
    const width = base + stretch;
    const heated = cold < 1 && !d.shape.gradient;
    const color = heated ? heatColor(d.color, d.heatStops, 1 - cold) : d.shape.fill;
    const styles = {
      transform: `translateX(${from.toFixed(2)}px)`,
      width: `${width.toFixed(2)}px`,
      opacity: String(d.shape.alphaScale * alpha)
    };
    if (d.shape.hollowWidth) styles.borderColor = color;
    else if (heated) styles.backgroundColor = color;
    if (d.look.crtEffect && d.look.glow) styles.boxShadow = `0 0 6px ${color}`;
    if (d.look.energyEffect) {
      const t = this.last * 6e-4 * (d.look.energySpeed ?? 1) % 1 * 300 - 100;
      styles.backgroundImage = `linear-gradient(180deg, ${color} 0%, #ffffff 50%, ${color} 100%)`;
      styles.backgroundSize = "100% 300%";
      styles.backgroundPosition = `0 ${t.toFixed(1)}%`;
    }
    d.caret.setCssStyles(styles);
    if (d.inner) d.inner.setCssStyles({ transform: `translateX(${(-from).toFixed(2)}px)` });
    const fade = d.look.trailFadeMs ?? 300;
    const now = this.last;
    for (let i = 0; i < d.ghosts.length; i++) {
      const g = s.ghosts[s.ghosts.length - 1 - i];
      const el = d.ghosts[i];
      if (!g) {
        el.setCssStyles({ opacity: "0" });
        continue;
      }
      const life = 1 - (now - g.t0) / fade;
      el.setCssStyles({ transform: `translateX(${(g.at * px).toFixed(2)}px)`, width: `${base.toFixed(2)}px`, opacity: (Math.max(0, life) * 0.6 * d.shape.alphaScale).toFixed(3) });
    }
  }
};

// src/settings-tab.ts
var RAIL_EFFECTS = [
  { key: "popEffects", name: "Pop effects", icon: "party-popper", desc: "Letters, lightning and fireworks thrown off as you type." },
  { key: "flameTrail", name: "Pixel trail", icon: "wind", desc: "A puff of colored pixels wherever the cursor has just been." },
  { key: "stardustEnabled", name: "Stardust", icon: "sparkles", desc: "Floating motes that drift up, or orbit the cursor." },
  { key: "bracketTether", name: "Bracket tether", icon: "brackets", desc: "A line under the span between matching brackets or quotes." },
  { key: "smear", name: "Motion smear", icon: "paintbrush", desc: "The cursor stretches as it moves and snaps back when it arrives." },
  { key: "energyEffect", name: "Energy beam", icon: "zap", desc: "A pulse of light along the cursor; an aurora with a gradient." },
  { key: "crtEffect", name: "CRT effects", icon: "circuit-board", desc: "Phosphor ghosts behind the cursor, neon and glitch options." },
  { key: "speedDemon", name: "Speed demon", icon: "gauge", desc: "Heats from gray to white-hot as you type, throwing sparks." },
  { key: "hotHead", name: "Hot-head", icon: "flame", desc: "Sets the text you are working on alight." },
  { key: "torchEffect", name: "Torch spotlight", icon: "cursor-smith-candle", desc: "Darkens everything except a pool of light around the cursor." }
];
var DELETE_ARM_MS = 3e3;
var PresetPrompt = class extends import_obsidian.Modal {
  constructor(app, title, placeholder, submit) {
    super(app);
    this.setTitle(title);
    const field = this.contentEl.createEl("input", { type: "text", attr: { placeholder, spellcheck: "false" } });
    field.addClass("cursor-smith-prompt-field");
    const note = this.contentEl.createDiv({ cls: "cursor-smith-prompt-note" });
    const go = async () => {
      const value = field.value.trim();
      const result = await submit(value);
      if (result === false) return;
      if (typeof result === "string") {
        note.setText(result);
        field.focus();
        return;
      }
      this.close();
    };
    field.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void go();
      }
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const ok = buttons.createEl("button", { cls: "mod-cta", text: "OK", attr: { type: "button" } });
    ok.addEventListener("click", () => {
      void go();
    });
    const cancel = buttons.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    this.field = field;
  }
  onOpen() {
    this.field.focus();
  }
};
var CursorSmithSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    // What a refresh repaints beyond Obsidian's own `visible` pass: the rail's
    // chips, the cards' summaries, the rows disabled by a setting elsewhere.
    // Rows register these while they render; the list is emptied whenever the
    // tree is built again, because the rows are then rendered again.
    this._refreshers = [];
    // Which effect the Effects page's rail shows, by its master key, or "all";
    // null until the user picks one (then the first effect that is on). Panel
    // state for the session, never in the settings.
    this._effectsPick = null;
    // The effects that are on in the look the pages show (set with the
    // pages), for the Effects entry's icons; and the observer that puts
    // them there.
    this._effectsOn = null;
    this._valueObserver = null;
    // The element that holds the pages (see _decorateRoot).
    this._pagesRoot = null;
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
    this._refreshers = [];
    const vim = (this.plugin.settings.uiMode || "cua") === "vim";
    const items = [
      this.headerGroup(),
      this.page("Behavior", "sliders-horizontal", "Where it draws, power saving, reduced motion.", [this.generalGroup()])
    ];
    if (vim) items.push(...this.vimDefinitions());
    else items.push(...this.normalDefinitions());
    items.push(this.footerRow());
    return items;
  }
  // The version, a muted line under the pages. Not a heading: Obsidian's
  // guidelines ask plugins not to head their settings with their own name,
  // and Community plugins lists the version anyway. Read off the manifest,
  // so a release is a one-line edit in manifest.json.
  footerRow() {
    const plugin = this.plugin;
    return {
      name: "",
      desc: `Cursor-Smith ${plugin.manifest?.version ?? ""}`.trim(),
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-footer");
      }
    };
  }
  // -------------------------------------------------------------------------
  // The categories are Obsidian's own sub-pages: an entry in the list that
  // slides its page in when clicked, with a back button - the "Ribbon menu
  // configuration" kind - on desktop and on a phone alike. An entry shows
  // its icon and one line of description, and `displayValue` says what the
  // page is set to (Box · translucent; On · 1.2x; 3 on) so the whole
  // cursor reads at a glance without opening anything. Obsidian evaluates
  // displayValue when it renders the entry, which it does again when the
  // page is left.
  // -------------------------------------------------------------------------
  page(name, icon, desc, items, displayValue, status) {
    return {
      type: "page",
      name,
      desc: this.iconDesc(icon, desc),
      items,
      displayValue,
      status
    };
  }
  // A description with a Lucide icon in front of it, for a page's entry
  // (and the rows that wear one). Obsidian renders the entry itself - the
  // name, then the description - and the description is the one slot that
  // takes markup, so the icon is written here; once the entry is in the
  // DOM, decorateIcons moves it out of the description to the front of
  // the entry's info block, which styles.css lays out as a grid with the
  // icon in the first column (.cursor-smith-iconed). It used to be done
  // in CSS alone with :has() and display: contents; the plugin review
  // warns on both, and this is the same picture without them.
  iconDesc(icon, text) {
    return createFragment((f) => {
      (0, import_obsidian.setIcon)(f.createSpan({ cls: "cursor-smith-page-icon" }), icon);
      f.appendText(text);
    });
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
    } catch {
    }
  }
  // Obsidian's refresh re-asks every row's `visible`; ours also repaints
  // what the rows registered (see _refreshers). A gate's write calls this.
  refreshDomState() {
    super.refreshDomState();
    this.runRefreshers();
    this.decoratePanel();
  }
  hide() {
    super.hide();
  }
  // Two things Obsidian's own rendering cannot be told to do go in after
  // it renders: the Effects entry's value becomes the icons of the effects
  // that are on (displayValue takes a string only), and every leading icon
  // written into a description moves to the front of its entry. An
  // observer on the tab's own element - the settings window is its own
  // document, so not on `document` - runs the pass whenever an entry is
  // rendered or its text refreshed; refreshDomState runs it too.
  watchEffectsValue() {
    if (this._valueObserver) return;
    const win = this.containerEl?.ownerDocument?.defaultView;
    if (!win || typeof win.MutationObserver !== "function") return;
    this._valueObserver = new win.MutationObserver(() => {
      this.decoratePanel();
    });
    this._observe();
    this.decoratePanel();
  }
  // Where the pass looks and the observer listens: the element that holds
  // the pages, not the tab's container. Obsidian 1.13 shows a sub-page
  // (Behavior, Effects and the rest) by DETACHING the tab's container and
  // rendering the page (div.setting-page) into the same
  // .vertical-tab-content-container, so a pass over the container decorated
  // the root list and never a page - the effect headings on the Effects
  // page kept their icons in the descriptions - and while a page shows the
  // container has no parent to climb to. So the holder is remembered while
  // the container is attached (the root list showing) and used while it is
  // still in the document. The container is the tab's for life; the holder
  // can be a new element when the settings window is opened again, and the
  // container itself is watched as well, which is what wakes the pass when
  // the root list is rendered into it again, so the new holder is taken.
  _decorateRoot() {
    const c = this.containerEl;
    if (!c) return null;
    const parent = c.parentElement;
    if (parent) this._pagesRoot = parent;
    const root = this._pagesRoot;
    return root && root.isConnected !== false ? root : c;
  }
  _observe() {
    const o = this._valueObserver;
    const root = this._decorateRoot();
    if (!o || !root) return;
    const opts = { childList: true, subtree: true, characterData: true };
    o.observe(root, opts);
    if (root !== this.containerEl) o.observe(this.containerEl, opts);
  }
  // The pass. It writes to the DOM the observer watches, so the observer
  // is paused while it writes, and each job leaves nothing for itself to
  // do on the next call (a rewrite on every call re-fired the observer
  // forever once, and hung Obsidian).
  decoratePanel() {
    const observer = this._valueObserver;
    if (observer) observer.disconnect();
    try {
      this.decorateIcons();
      this.decorateEffectsValue();
    } finally {
      this._observe();
    }
  }
  // A leading icon still inside its description moves to the front of
  // the entry's info block, which takes the grid class. Nothing to do
  // once it has moved (its parent is the info block, not a description).
  //
  // Obsidian keeps an entry's element across update() and writes its
  // description again - with a fresh icon in it - so the icon moved last
  // time goes first: every preset picked added one more to every page entry
  // until 1.6.5 ("repeating icons whenever I click on a different preset",
  // a tablet user on Reddit; nine after eight clicks on the desktop too).
  // The rule in ARCHITECTURE: what a render adds outside controlEl cleans
  // up after itself.
  decorateIcons() {
    const root = this._decorateRoot();
    if (!root) return;
    for (const icon of Array.from(root.querySelectorAll(".cursor-smith-page-icon"))) {
      const desc = icon.parentElement;
      if (!desc || !desc.hasClass("setting-item-description")) continue;
      const info = desc.parentElement;
      if (!info || !info.hasClass("setting-item-info")) continue;
      for (const old of Array.from(info.children)) {
        if (old !== icon && old.hasClass("cursor-smith-page-icon")) old.remove();
      }
      info.addClass("cursor-smith-iconed");
      info.prepend(icon);
    }
  }
  decorateEffectsValue() {
    const on = this._effectsOn ? this._effectsOn() : null;
    const root = this.containerEl;
    if (!on || !root) return;
    const sig = on.map((e) => e.key).join(",");
    const wanted = (value) => value.getAttribute("data-cs-effects") === sig && (on.length ? !!value.querySelector(".cursor-smith-value-icon") : value.getText() === "Off");
    const rows = Array.from(root.querySelectorAll(".setting-item")).filter((row) => {
      const name = row.querySelector(".setting-item-name");
      return !!name && name.getText().trim() === "Effects" && !!row.querySelector(".setting-item-value") && !wanted(row.querySelector(".setting-item-value"));
    });
    for (const row of rows) {
      const value = row.querySelector(".setting-item-value");
      value.empty();
      value.setAttribute("data-cs-effects", sig);
      if (!on.length) {
        value.setText("Off");
        continue;
      }
      value.setAttribute("title", on.map((e) => e.name).join(", "));
      for (const e of on) (0, import_obsidian.setIcon)(value.createSpan({ cls: "cursor-smith-value-icon", attr: { "aria-label": e.name } }), e.icon);
    }
  }
  onRefresh(f) {
    (this._refreshers || (this._refreshers = [])).push(f);
  }
  runRefreshers() {
    for (const f of this._refreshers || []) {
      try {
        f();
      } catch (e) {
        this.plugin._reportOnce("settings panel refresher", e);
      }
    }
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
      }
    };
  }
  // Obsidian keeps a row's element across update() when its name matches
  // and empties its controls - but not its classes, so a row that changed
  // kind or depth between two renders would keep the old ones (a known
  // 1.13 issue). Every row builder starts from a clean slate.
  resetRow(setting) {
    setting.settingEl.removeClass(
      "cursor-smith-sub",
      "cursor-smith-sub-1",
      "cursor-smith-sub-2",
      "cursor-smith-sub-3",
      "cursor-smith-note-row",
      "cursor-smith-note-warning",
      "cursor-smith-subsection-row",
      "cursor-smith-color-row",
      "cursor-smith-reduced-notice"
    );
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
      }
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
      }
    };
  }
  // -------------------------------------------------------------------------
  // A page's rows, as one of Obsidian's setting groups - a row is a Setting
  // inside it, indexed for settings search. The group's own heading is not
  // shown (the page's title is it) and the card's box is opted out of
  // (styles.css), keeping the flat look.
  // -------------------------------------------------------------------------
  section(title, items) {
    return { type: "group", heading: title, cls: "cursor-smith-section cursor-smith-in-page", items };
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
  // for when the OS is suppressing motion, and the two switches that decide
  // what the rest of the panel IS - the plugin on or off, and one cursor or
  // one per Vim mode. Everything else is a page.
  // -------------------------------------------------------------------------
  headerGroup() {
    const plugin = this.plugin;
    const vim = (plugin.settings.uiMode || "cua") === "vim";
    const items = [
      {
        name: "Enable plugin",
        control: { type: "toggle", key: "enabled" }
      },
      this.reducedMotionNotice(),
      {
        name: "Vim mode",
        render: (setting) => this.renderVimToggle(setting)
      }
    ];
    if (vim) items.push(...this.vimAlertRows());
    items.push(this.presetStripRow(vim));
    if (vim) {
      if (!VIM_MODE_KEYS.includes(plugin._vimEditMode)) plugin._vimEditMode = "normal";
      items.push(...this.vimModeRows(plugin._vimEditMode));
    }
    return {
      type: "group",
      cls: "cursor-smith-global",
      items
    };
  }
  // --- The preset strip ------------------------------------------------------------
  // One thin card per saved preset: a little text with a caret crawling it
  // in that preset's look (pure CSS - the shape, the colour, the glow, the
  // blink; it crawls three letters and jumps back, or sits still under
  // reduced motion), the name, a tick on the one in use, and its buttons
  // beside it: update it with the current look, copy its share code,
  // delete it. Tap the card to use it. Two more cards save the current
  // look under a name and import a share code, each through a small
  // prompt. The Vim library while Vim is on, with the Normal mode's look
  // on the card.
  presetStripRow(vim) {
    const plugin = this.plugin;
    const library = vim ? plugin.getVimPresets() : plugin.getUserPresets();
    const names = Object.keys(library);
    return {
      name: "Presets",
      // No description (the user: "presets don't need one"); the cards say
      // it, and Save and Import are their own words.
      desc: this.iconDesc("bookmark", ""),
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-presets-row");
        const strip = setting.controlEl.createDiv({ cls: "cursor-smith-presets" });
        const active = vim ? plugin.settings.vimActivePreset : this.presetInUse();
        const demos = new DemoStrip();
        const dark = plugin.isDarkTheme();
        const reduced = plugin.reducedMotion();
        for (const name of names) {
          const entry = library[name];
          const look = presetWithDefaults(vim ? entry.normal : entry);
          const isActive = name === active;
          const card = strip.createDiv({ cls: "cursor-smith-pcard" + (isActive ? " is-active" : "") });
          const use = card.createEl("button", { cls: "cursor-smith-pcard-use", attr: { type: "button", "aria-label": `Use preset ${name}`, "aria-pressed": isActive ? "true" : "false" } });
          if (isActive) (0, import_obsidian.setIcon)(use.createSpan({ cls: "cursor-smith-tick" }), "check");
          const ramp = !look.speedDemonGradient ? ["#ff8c28", "#ff461e", "#fff0c8"] : dark ? [look.speedHeatDark1, look.speedHeatDark2, look.speedHeatDark3, look.speedHeatDark4].map((c) => c ?? "") : [look.speedHeatLight1, look.speedHeatLight2, look.speedHeatLight3, look.speedHeatLight4].map((c) => c ?? "");
          const count = Math.max(2, Math.min(4, look.gradientCount ?? 2));
          const gradient = (dark ? [look.gradientDark1, look.gradientDark2, look.gradientDark3, look.gradientDark4] : [look.gradientLight1, look.gradientLight2, look.gradientLight3, look.gradientLight4]).slice(0, count).map((c) => c ?? "");
          demos.add(use, name, look, (dark ? look.colorDark : look.colorLight) ?? "", ramp, gradient, reduced, isActive);
          use.addEventListener("click", () => {
            void (vim ? plugin.loadVimPreset(name) : plugin.loadUserPreset(name)).then(() => this.update());
          });
          const actions = card.createSpan({ cls: "cursor-smith-pcard-actions" });
          const action = (icon, label, run) => {
            const b = actions.createEl("button", { cls: "cursor-smith-pcard-action clickable-icon", attr: { type: "button", "aria-label": label, title: label } });
            (0, import_obsidian.setIcon)(b, icon);
            b.addEventListener("click", run);
            return b;
          };
          const copy = action("copy", "Copy its share code", () => {
            const code = vim ? vimPresetToCode(name, entry) : presetToCode(name, entry);
            void navigator.clipboard.writeText(code).then(() => {
              (0, import_obsidian.setIcon)(copy, "check");
              window.setTimeout(() => {
                (0, import_obsidian.setIcon)(copy, "copy");
              }, 1500);
            });
          });
          let armed = 0;
          const trash = action("trash", "Delete this preset", () => {
            if (trash.hasClass("is-armed")) {
              window.clearTimeout(armed);
              void (vim ? plugin.deleteVimPreset(name) : plugin.deleteUserPreset(name)).then(() => this.update());
              return;
            }
            trash.addClass("is-armed");
            trash.setText("Delete?");
            trash.setAttribute("aria-label", "Tap again to delete");
            armed = window.setTimeout(() => {
              trash.removeClass("is-armed");
              trash.empty();
              (0, import_obsidian.setIcon)(trash, "trash");
              trash.setAttribute("aria-label", "Delete this preset");
            }, DELETE_ARM_MS);
          });
        }
        const more = (icon, label, run) => {
          const b = strip.createEl("button", { cls: "cursor-smith-pcard cursor-smith-pcard-more", attr: { type: "button" } });
          (0, import_obsidian.setIcon)(b.createSpan({ cls: "cursor-smith-pcard-more-icon" }), icon);
          b.createSpan({ cls: "cursor-smith-pcard-name", text: label });
          b.addEventListener("click", run);
        };
        strip.createDiv({ cls: "cursor-smith-pcard-break" });
        more("save", "Save", () => {
          let warned = "";
          new PresetPrompt(this.app, vim ? "Save these five mode cursors as" : "Save this look as", vim ? "Vim preset name" : "Preset name", async (name) => {
            if (!name) return false;
            if (name in library && warned !== name) {
              warned = name;
              return `A preset named ${name} exists. OK again to replace it.`;
            }
            if (vim) await plugin.saveVimPreset(name);
            else await plugin.saveUserPreset(name);
            this.update();
            return true;
          }).open();
        });
        more("download", "Import", () => {
          new PresetPrompt(this.app, vim ? "Import a Vim share code" : "Import a share code", "Paste the code here", async (code) => {
            if (!code) return false;
            const ok = vim ? await plugin.importVimPreset(code) : await plugin.importPreset(code);
            if (ok) {
              this.update();
              return true;
            }
            const other = vim ? SHARE_VERSION + "|" : SHARE_VERSION_VIM + "|";
            return code.startsWith(other) ? vim ? "That's a regular code, not a Vim one" : "That's a Vim code, not a regular one" : "Invalid code";
          }).open();
        });
      }
    };
  }
  // Which saved preset the look in use IS: the one whose every look key
  // equals the settings'. Read off the look rather than off a name
  // remembered at load time, which is gone after a reload and would stay
  // after an edit. Empty when the look is nothing that was saved.
  presetInUse() {
    const plugin = this.plugin;
    const presets = plugin.getUserPresets();
    const look = plugin.settings;
    for (const name of Object.keys(presets)) {
      const p = presetWithDefaults(presets[name]);
      if (LOOK_KEYS.every((k) => p[k] === look[k])) return name;
    }
    return "";
  }
  // A tiny alert under the Vim mode toggle while it is on, for the new
  // user who flipped it out of curiosity: what just happened to the
  // editor, and the way back (the toggle right above it - no button of
  // its own). Three wordings by state, all predicates so a flip of
  // "Control Obsidian's Vim key bindings" is a visibility refresh: the
  // plugin drives Obsidian's bindings and they are on (the editor takes
  // Vim keys now); it drives them but they look off (transient - reopen
  // the editor); it does not drive them and they are off (nothing shows
  // until they are on). A Vim user driving nothing, with them on, sees
  // none. The one place this is said: the Vim page has no note of its
  // own.
  vimAlertRows() {
    const plugin = this.plugin;
    const alert = (text, visible) => ({
      name: "",
      desc: text,
      searchable: false,
      visible,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-alert");
        setting.settingEl.querySelectorAll(".cursor-smith-alert-icon").forEach((old) => {
          old.remove();
        });
        const icon = setting.settingEl.createSpan({ cls: "cursor-smith-alert-icon" });
        (0, import_obsidian.setIcon)(icon, "triangle-alert");
        setting.settingEl.prepend(icon);
      }
    });
    const drives = () => !!plugin.settings.vimControlObsidian;
    const on = () => plugin.isObsidianVimOn();
    return [
      alert(
        "Your editor now uses Vim key bindings. Not a Vim user? Turn Vim mode off.",
        () => drives() && on()
      ),
      alert(
        "Vim key bindings look off. Reopen the editor if the mode cursors don't show.",
        () => drives() && !on()
      ),
      alert(
        "This needs Vim key bindings on in Settings \u2192 Editor. Not a Vim user? Turn Vim mode off.",
        () => !drives() && !on()
      )
    ];
  }
  // The Behavior page: the five global switches. They are structural rather
  // than looks - none is in LOOK_KEYS, so none is part of a preset or of a
  // per-Vim-mode snapshot - they apply to whatever cursor is on screen, in
  // both modes.
  generalGroup() {
    const items = [
      // Per device, not a settings key: Obsidian's local storage, which does
      // not sync (issue #31, "disable the extension on a specific device").
      // Named like "Enable plugin" since 1.6.5: as "On this device", with
      // "Not synced" in its line, a tablet user on Reddit read it as a sync
      // option, turned it off, and the cursor stopped - which is what off does.
      this.row("Enable on this device", "Off brings back Obsidian's own cursor on this device only. Your other devices keep their setting.", (s) => {
        s.addToggle((tg) => tg.setValue(this.plugin._deviceEnabled !== false).onChange((v) => {
          this.plugin.setDeviceEnabled(v);
        }));
      }),
      {
        name: "Note editor only",
        desc: "Notes only; search, settings and dialogs keep Obsidian's caret.",
        control: { type: "toggle", key: "noteEditorOnly", defaultValue: false }
      },
      {
        name: "Hide real cursor",
        desc: "Hides Obsidian's own caret so only this one shows.",
        control: { type: "toggle", key: "hideNativeCaret" }
      },
      {
        name: "Hide cursor when unfocused",
        desc: "Hides the cursor while Obsidian isn't the active window.",
        control: { type: "toggle", key: "hideOnWindowBlur", defaultValue: true }
      },
      {
        name: "Low power mode",
        desc: "Halves every effect's frame rate, for battery or a slow machine.",
        control: { type: "toggle", key: "lowPowerMode", defaultValue: false }
      },
      {
        name: "Respect reduced motion",
        desc: "Pauses the moving effects when your system asks for reduced motion.",
        control: { type: "toggle", key: "respectReducedMotion", defaultValue: true }
      }
    ];
    return this.section("Behavior", items);
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
      desc: 'Your system asks for reduced motion, so Smooth movement, Motion smear and the other moving effects are paused - the toggles below still show your own settings. Turn off "Respect reduced motion" to override.',
      searchable: false,
      visible: () => this.reducedMotionActive(),
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-reduced-notice");
        this.registerPanelDocument(setting.settingEl);
      }
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
  // The Vim mode toggle. On turns Vim-aware cursors on (and, per
  // vimControlObsidian, flips Obsidian's own Vim key bindings); off turns
  // them off. This one control is both the panel switch and the feature's
  // on/off switch. (It was a CUA / Vim segmented switch until the eighth
  // UI pass; the user: "make Vim a toggle instead, drop the CUA thing".)
  // -------------------------------------------------------------------------
  renderVimToggle(setting) {
    const plugin = this.plugin;
    const isVim = () => (plugin.settings.uiMode || "cua") === "vim";
    setting.addToggle((t) => t.setValue(isVim()).onChange(async (on) => {
      if (isVim() === on) return;
      await plugin.setVimModeEnabled(on);
      this.update();
    }));
  }
  // -------------------------------------------------------------------------
  // The CUA / Normal panel: the preset library, then the look cards for the
  // global cursor.
  // -------------------------------------------------------------------------
  normalDefinitions() {
    const plugin = this.plugin;
    const look = plugin.settings;
    const set = (key) => async (v) => {
      look[key] = v;
      await plugin.saveSettings();
    };
    const cards = this.lookDefinitions({
      get: (key) => plugin.settings[key],
      set,
      renderCursorStyleSetting: (setting, rerender) => {
        setting.addDropdown(
          (dropdown) => dropdown.addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline").setValue(plugin.settings.cursorStyle).onChange(async (value) => {
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
        setting.addToggle(
          (toggle) => toggle.setValue(plugin.settings.torchEffect).onChange(async (value) => {
            plugin.settings.torchEffect = value;
            const saved = plugin.saveSettings();
            if (plugin.settings.enabled) {
              value ? plugin.enableTorchOverlay() : plugin.disableTorchOverlay();
            }
            rerender();
            await saved;
          })
        );
      }
    });
    return this.lookPages(cards);
  }
  // The four look cards as pages, each entry saying what it is set to.
  lookPages(cards) {
    const s = cards.summaries || {};
    this._effectsOn = cards.effectsOn ?? null;
    this.watchEffectsValue();
    const meta = [
      ["Appearance", "palette", "Shape, color, opacity."],
      ["Blinking", "eye-closed", "If it blinks, how, and how fast."],
      ["Smooth movement", "spline", "Gliding to the new spot instead of jumping."],
      ["Effects", "wand", "Trails, sparks, fire, lightning, a torch."]
    ];
    return cards.map((group, i) => this.page(meta[i][0], meta[i][1], meta[i][2], [group], s[meta[i][0]]));
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
    const cards = this.modeDefinitions(target, () => {
      plugin.settings.vimActivePreset = "";
    });
    return [
      this.page(
        "Vim",
        "terminal",
        "Obsidian's Vim key bindings, and the mode in the status bar.",
        [this.vimCursorsGroup()],
        void 0,
        () => plugin.isObsidianVimOn() ? null : "warning"
      ),
      ...this.lookPages(cards)
    ];
  }
  vimCursorsGroup() {
    const plugin = this.plugin;
    const items = [];
    items.push(this.row(
      "Control Obsidian's Vim key bindings",
      "Turns Obsidian's Vim key bindings on and off with the mode above.",
      (setting) => {
        setting.addToggle((toggle) => toggle.setValue(plugin.settings.vimControlObsidian).onChange(async (value) => {
          plugin.settings.vimControlObsidian = value;
          if (value) plugin.setObsidianVim(!!plugin.settings.vimModeEnabled);
          await plugin.saveSettings();
          this.refreshDomState();
        }));
      }
    ));
    items.push(this.row(
      "Show Vim mode in status bar",
      "Shows the mode in the status bar: -- NORMAL --.",
      (setting) => {
        setting.addToggle((toggle) => toggle.setValue(plugin.settings.vimStatusBar).onChange(async (value) => {
          plugin.settings.vimStatusBar = value;
          plugin.syncVimStatusBar();
          await plugin.saveSettings();
          this.refreshDomState();
        }));
      }
    ));
    const colorRow = this.row(
      "Color status bar text to match the cursor",
      "Tints the mode name with that mode's cursor color.",
      (setting) => {
        setting.addToggle((toggle) => toggle.setValue(plugin.settings.vimStatusBarColor).onChange(async (value) => {
          plugin.settings.vimStatusBarColor = value;
          await plugin.saveSettings();
        }));
      },
      1
    );
    colorRow.visible = () => !!plugin.settings.vimStatusBar;
    items.push(colorRow);
    return this.section("Vim", items);
  }
  // Per-mode editor: pick one mode, then edit its FULL cursor config in the
  // look cards that follow this one.
  vimModeRows(mode) {
    const items = [];
    items.push(this.row(
      "Mode",
      this.iconDesc("layers", ""),
      (setting) => this.renderModeTabs(setting.controlEl)
    ));
    if (mode === "command") {
      items.push(this.noteRow(
        'Applies whenever the caret leaves the note editor: the built-in Vim command line (the ":" / "/" prompt) and the rest of the Obsidian interface \u2014 Command Palette, Quick Switcher, search, rename boxes, Settings fields and plugin modals. Motion effects (smear, smooth movement, CRT trail) are best left off here: these are all single-line fields, so they read as jitter rather than movement.'
      ));
    }
    return items;
  }
  // Tab row — one tab per Vim mode. Same visual language as the CUA/Vim
  // segmented switch at the top of the panel. Each inactive tab's label is
  // tinted with that mode's own cursor color (for the current theme), so the
  // row doubles as a live color legend; the active tab uses the accent
  // background instead, where a tint would be unreadable.
  renderModeTabs(containerEl) {
    const plugin = this.plugin;
    const isDarkTheme = containerEl.ownerDocument?.body?.classList?.contains("theme-dark") ?? true;
    const tabWrap = containerEl.createDiv({ cls: "cursor-smith-mode-tabs" });
    const tabs = [];
    for (const m of VIM_MODE_KEYS) {
      const active = plugin._vimEditMode === m;
      const cfg = plugin.settings.vimModes[m] || {};
      const tint = isDarkTheme ? cfg.colorDark : cfg.colorLight;
      const btn = tabWrap.createEl("button", {
        text: VIM_MODE_LABELS[m],
        cls: "cursor-smith-chip cursor-smith-mode-tab" + (active ? " is-picked" : ""),
        attr: { type: "button", "aria-pressed": active ? "true" : "false" }
      });
      if (tint) btn.setCssStyles(active ? { backgroundColor: tint, borderColor: tint, color: readableGlyphColor(tint, "contrast") } : { color: tint });
      btn.addEventListener("click", () => {
        if (plugin._vimEditMode === m) return;
        plugin._vimEditMode = m;
        this.update();
      });
      tabs.push(btn);
    }
    this.rovingRow(tabWrap, tabs).picked(Math.max(0, VIM_MODE_KEYS.indexOf(plugin._vimEditMode)));
  }
  // The FULL set of cursor look/effect cards bound to an arbitrary
  // settings-shaped `target` object (here, one Vim mode's snapshot).
  modeDefinitions(target, onEdit) {
    const plugin = this.plugin;
    const after = onEdit || (() => {
    });
    const set = (key) => async (v) => {
      target[key] = v;
      after();
      await plugin.saveSettings();
    };
    const setR = (key, rerender) => async (v) => {
      const saved = set(key)(v);
      rerender();
      await saved;
    };
    return this.lookDefinitions({
      get: (key) => target[key],
      set,
      renderCursorStyleSetting: (setting, rerender) => {
        setting.addDropdown((d) => d.addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline").setValue(target.cursorStyle).onChange(setR("cursorStyle", rerender)));
      },
      renderTorchToggleSetting: (setting, rerender) => {
        setting.addToggle((t) => t.setValue(target.torchEffect).onChange(setR("torchEffect", rerender)));
      }
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
  lookDefinitions({ get, set, renderCursorStyleSetting, renderTorchToggleSetting, afterReset }) {
    const gates = /* @__PURE__ */ new Set();
    const cardKeys = { Appearance: [], Blinking: [], "Smooth movement": [], Effects: [] };
    let card = "Appearance";
    const owns = (key) => {
      if (!cardKeys[card].includes(key)) cardKeys[card].push(key);
    };
    const refresh = () => this.refreshDomState();
    const redraw = (key) => {
      gates.add(key);
      return async (v) => {
        const saved = set(key)(v);
        refresh();
        await saved;
      };
    };
    const rebuild = (key) => {
      gates.add(key);
      return async (v) => {
        const saved = set(key)(v);
        this.update();
        await saved;
      };
    };
    const afterWrite = (key) => {
      gates.add(key);
      owns(key);
      return refresh;
    };
    const resetCard = (title) => () => {
      const writes = cardKeys[title].map((key) => Promise.resolve(set(key)(DEFAULT_SETTINGS[key])));
      void Promise.all(writes).then(() => {
        if (afterReset) afterReset();
        this.update();
      });
    };
    const on = (key) => () => !!get(key);
    const off = (key) => () => !get(key);
    const all = (...ps) => () => ps.every((p) => p());
    const isStyle = (s) => () => get("cursorStyle") === s;
    const row = (name, desc, build, { depth = 0, when, needs } = {}) => {
      const effect = depth === 0 ? RAIL_EFFECTS.find((e) => e.name === name) : void 0;
      const def = this.row(name, effect ? this.iconDesc(effect.icon, desc) : desc, (s) => {
        build(s);
        if (needs) this.needsHint(s, needs);
      }, depth);
      if (when) def.visible = when;
      return def;
    };
    const toggle = (name, desc, key, { depth = 0, gate = false, when, needs } = {}) => {
      owns(key);
      return row(name, desc, (s) => {
        s.addToggle((t) => t.setValue(!!get(key)).onChange(gate ? redraw(key) : set(key)));
      }, { depth, when, needs });
    };
    const dropdown = (name, desc, key, options, { depth = 0, value, onChange, when } = {}) => {
      owns(key);
      return row(name, desc, (s) => {
        s.addDropdown((d) => d.addOptions(options).setValue(value !== void 0 ? value : get(key)).onChange(onChange || set(key)));
      }, { depth, when });
    };
    const slider = (name, desc, key, [min, max, step2], { depth = 0, fallback, gate = false, when, needs } = {}) => {
      owns(key);
      return row(name, desc, (s) => {
        const write = gate ? redraw(key) : set(key);
        let handle = null;
        s.addSlider((sl) => {
          handle = sl;
          sl.setLimits(min, max, step2).setValue(get(key) ?? fallback).onChange(write);
        }).addExtraButton((btn) => btn.setIcon("rotate-ccw").setTooltip(`Restore default (${DEFAULT_SETTINGS[key]})`).onClick(() => {
          const v = DEFAULT_SETTINGS[key];
          if (handle) handle.setValue(v);
          void write(v);
        }));
      }, { depth, when, needs });
    };
    const swatchRow = (name, keys2, labels, desc, { depth = 0, when } = {}) => {
      keys2.forEach(owns);
      return row(name, desc, (s) => {
        s.settingEl.addClass("cursor-smith-color-row");
        keys2.forEach((key, i) => {
          const cell = s.controlEl.createDiv({ cls: "cursor-smith-swatch-cell" });
          s.addColorPicker((cp) => cp.setValue(get(key) || DEFAULT_SETTINGS[key]).onChange(set(key)));
          const input = s.controlEl.lastElementChild;
          if (input && input !== cell) cell.appendChild(input);
          cell.createSpan({ cls: "cursor-smith-swatch-label", text: labels[i] ?? "" });
        });
      }, { depth, when });
    };
    const subheading = (title, depth, when) => {
      const def = this.subheadingRow(title, depth);
      def.visible = when;
      return def;
    };
    const appearance = [];
    appearance.push(row(
      "Cursor style",
      "The shape of the cursor itself.",
      (s) => renderCursorStyleSetting(s, afterWrite("cursorStyle"))
    ));
    const line = isStyle("Line"), underline = isStyle("Underline"), box = isStyle("Box");
    appearance.push(slider("Cursor thickness", "How thick the Line cursor is, in pixels.", "caretWidthPx", [0.5, 7, 0.1], { depth: 1, when: line }));
    appearance.push(slider("Cursor height", "How tall the Line cursor is, as a percentage of the line.", "caretHeightPct", [20, 100, 5], { depth: 1, fallback: 100, when: line }));
    appearance.push(toggle("Serifs", "Adds I-beam serifs at the top and bottom of the line.", "lineSerifs", { depth: 1, when: line }));
    appearance.push(slider(
      "Underline thickness",
      "Underline thickness in pixels. 0 fits the line height.",
      "underlineWidthPx",
      [0, 7, 0.1],
      { depth: 1, fallback: 0, when: underline }
    ));
    appearance.push(toggle(
      "Show letter inside cursor",
      "Shows the letter inside the block, colors flipped.",
      "showChar",
      { depth: 1, gate: true, when: box }
    ));
    appearance.push(dropdown(
      "Letter color",
      "Contrast: black or white. Tinted: the flipped color, kept legible. Inverted: a raw flip.",
      "glyphColorMode",
      { contrast: "Contrast", tinted: "Tinted", invert: "Inverted" },
      { depth: 2, value: get("glyphColorMode") || "contrast", when: all(box, on("showChar")) }
    ));
    appearance.push(toggle("Hollow", "Draws only the outline of the box instead of a filled block.", "boxHollow", { depth: 1, gate: true, when: box }));
    appearance.push(slider(
      "Outline width",
      "Thickness of the hollow box's outline, in pixels.",
      "boxHollowWidth",
      [1, 6, 1],
      { depth: 2, when: all(box, on("boxHollow")) }
    ));
    appearance.push(toggle("Gradient", "Blends several colors instead of one flat color.", "gradientEnabled", { gate: true }));
    const gradient = on("gradientEnabled");
    const writeCount = rebuild("gradientCount");
    appearance.push(dropdown(
      "Number of colors",
      "How many colors the blend runs through, from 2 to 4.",
      "gradientCount",
      { 2: "2", 3: "3", 4: "4" },
      {
        depth: 1,
        when: gradient,
        value: String(get("gradientCount") ?? 2),
        onChange: (v) => writeCount(Number(v))
      }
    ));
    const count = Math.max(2, Math.min(4, Number(get("gradientCount")) || 2));
    const keys = (prefix) => Array.from({ length: count }, (_, i) => prefix + (i + 1));
    for (let i = 1; i <= 4; i++) {
      owns("gradientDark" + i);
      owns("gradientLight" + i);
    }
    const stops = Array.from({ length: count }, (_, i) => String(i + 1));
    appearance.push(swatchRow(
      "Colors (dark theme)",
      keys("gradientDark"),
      stops,
      "From the top of the cursor to the bottom \u2014 or left to right for the Underline style.",
      { depth: 1, when: gradient }
    ));
    appearance.push(swatchRow(
      "Colors (light theme)",
      keys("gradientLight"),
      stops,
      "The same ramp for light themes, where neon colors tend to wash out.",
      { depth: 1, when: gradient }
    ));
    appearance.push(swatchRow(
      "Cursor color",
      ["colorDark", "colorLight"],
      ["Dark", "Light"],
      "One for each theme. Neon colors that look right on a dark background wash out on a white page.",
      { when: off("gradientEnabled") }
    ));
    appearance.push(slider("Cursor opacity", "How see-through the cursor is.", "cursorOpacity", [0.1, 1, 0.05]));
    appearance.push(toggle(
      "Translucent",
      "Blends the cursor into the page instead of painting over it.",
      "cursorTranslucent"
    ));
    appearance.push(toggle(
      "Rounded corners",
      "Softens the corners: rounded bars for Line and Underline, a gentle curve for Box.",
      "cursorRounded"
    ));
    card = "Blinking";
    const blinking = [];
    blinking.push(toggle("Blinking", "Makes the cursor blink.", "blinkingEnabled", { gate: true }));
    const blink = on("blinkingEnabled");
    blinking.push(slider("Blink speed", "How fast the cursor blinks.", "blinkSpeed", [0.1, 3, 0.1], { depth: 1, when: blink }));
    blinking.push(slider("Blink balance", "How the blink cycle is split between lit and dark.", "blinkOnOffBalance", [0.1, 0.9, 0.05], { depth: 1, when: blink }));
    blinking.push(slider("Fade smoothness", "How gradually the cursor fades in and out.", "blinkFade", [0.05, 0.5, 0.05], { depth: 1, fallback: 0.15, when: blink }));
    blinking.push(toggle("Don't blink while typing", "Keeps the cursor fully lit while you type or move it.", "smoothStopBlinking", { depth: 1, when: blink }));
    blinking.push(slider("Blink delay", "How long the cursor stays lit after a keystroke, in ms.", "blinkDelayMs", [0, 2e3, 50], { depth: 1, fallback: 0, when: blink }));
    blinking.push(slider("Stop after", "Blink this many times after each move, then stay lit. 0 blinks forever.", "blinkStopAfter", [0, 20, 1], { depth: 1, fallback: 0, when: blink }));
    blinking.push(toggle("Breathing", "The cursor swells and shrinks instead of fading out.", "blinkBreathing", { depth: 1, gate: true, when: blink }));
    blinking.push(slider(
      "Breath depth",
      "How far the cursor shrinks at the bottom of the breath.",
      "blinkBreathDepth",
      [0.05, 0.5, 0.05],
      { depth: 2, fallback: 0.2, when: all(blink, on("blinkBreathing")) }
    ));
    card = "Smooth movement";
    const smooth = [];
    smooth.push(toggle("Smooth movement", "The cursor glides to its new spot instead of jumping.", "smoothEnabled", { gate: true }));
    const gliding = on("smoothEnabled");
    smooth.push(slider("Glide amount", "How much the cursor eases as it travels.", "smoothness", [0.05, 0.3, 0.05], { depth: 1, when: gliding }));
    smooth.push(slider("Catch-up speed", "How quickly the cursor chases the real caret.", "catchUpSpeed", [0.3, 0.8, 0.05], { depth: 1, when: gliding }));
    smooth.push(toggle("Speed up when typing fast", "Goes past Catch-up speed while you type, so it never falls behind.", "smoothAdaptive", { depth: 1, gate: true, when: gliding }));
    smooth.push(slider(
      "Max catch-up speed",
      "The fastest the speed-up is allowed to get.",
      "maxCatchUpSpeed",
      [0.5, 1, 0.05],
      { depth: 2, when: all(gliding, on("smoothAdaptive")) }
    ));
    smooth.push(slider("Movement delay", "Delay before the cursor sets off, in ms. 0 follows immediately.", "moveDelayMs", [0, 500, 10], { depth: 1, when: gliding }));
    card = "Effects";
    const effects = [];
    const pick = () => {
      if (this._effectsPick) return this._effectsPick;
      const first = RAIL_EFFECTS.find((e) => !!get(e.key));
      return first ? first.key : RAIL_EFFECTS[0].key;
    };
    const shown = (key) => () => {
      const p = pick();
      return p === "all" || p === key;
    };
    effects.push(this.railRow(get, pick, (key) => {
      this._effectsPick = key;
      refresh();
    }));
    const needsGradient = { when: gradient, hint: "Needs Gradient, in Appearance." };
    const needsBlink = { when: on("blinkingEnabled"), hint: "Needs Blinking." };
    const showPop = shown("popEffects");
    effects.push(toggle("Pop effects", "Letters, lightning and fireworks thrown off as you type.", "popEffects", { gate: true, when: showPop }));
    const pop = all(showPop, on("popEffects"));
    effects.push(toggle("Popping letters", "Each letter you type springs out of the cursor and tumbles away.", "popLetters", { depth: 1, gate: true, when: pop }));
    effects.push(toggle(
      "Backspace disintegration",
      "Deleting throws a burst outward in flipped colors.",
      "backspaceDisintegrate",
      { depth: 1, gate: true, when: pop }
    ));
    effects.push(toggle("Thunderstrike", "Enter calls down a bolt of pixelated lightning onto the new line.", "thunderstrike", { depth: 1, gate: true, when: pop }));
    effects.push(slider("Bolt size", "How fine the lightning is, in pixels per block.", "thunderstrikeSize", [1, 5, 1], { depth: 2, fallback: 2, when: all(pop, on("thunderstrike")) }));
    effects.push(slider(
      "Bolt strength",
      "How bright the strike is.",
      "thunderstrikeStrength",
      [0.1, 1, 0.05],
      { depth: 2, fallback: 0.5, when: all(pop, on("thunderstrike")) }
    ));
    effects.push(toggle("Fireworks", "Space and Enter send shells up from the cursor to burst above it.", "fireworks", { depth: 1, gate: true, when: pop }));
    effects.push(slider("Quantity", "How many shells go up per keypress, and how much each throws.", "fireworksQuantity", [0.2, 3, 0.1], { depth: 2, fallback: 1, when: all(pop, on("fireworks")) }));
    const anyPop = () => pop() && (!!get("popLetters") || !!get("backspaceDisintegrate") || !!get("thunderstrike") || !!get("fireworks"));
    effects.push(toggle("Rainbow", "Sweeps every pop effect around the color wheel as you type.", "popRainbow", { depth: 1, when: anyPop }));
    const showTrail = shown("flameTrail");
    effects.push(toggle("Pixel trail", "A puff of colored pixels wherever the cursor has just been.", "flameTrail", { gate: true, when: showTrail }));
    const trail = all(showTrail, on("flameTrail"));
    effects.push(slider("Pixel density", "How many pixels the trail sheds. 0 hides them entirely.", "flameTrailDensity", [0, 3, 0.1], { depth: 1, fallback: 1, when: trail }));
    effects.push(toggle("Trail on jump", "Lays pixels along the whole path of a jump, not just at the start.", "flameTrailOnJump", { depth: 1, when: trail }));
    effects.push(slider("Pixel lifetime", "How long each pixel lasts before it fades out, in milliseconds.", "flameTrailLifeMs", [100, 2e3, 50], { depth: 1, fallback: 400, when: trail }));
    effects.push(slider("Pixel size", "How big each pixel is.", "flameTrailPixelSize", [1, 12, 0.5], { depth: 1, fallback: 4, when: trail }));
    effects.push(toggle("Gradient colors", "Colors the pixels from the cursor's gradient.", "flameTrailGradientColors", { depth: 1, when: trail, needs: needsGradient }));
    effects.push(slider("Gravity", "A steady pull on the pixels. 0 leaves them drifting sideways.", "flameTrailGravity", [0, 1, 0.05], { depth: 1, fallback: 0, gate: true, when: trail }));
    effects.push(slider(
      "Gravity direction",
      "Where the pull goes, in degrees: 0 down, 90 right, 180 up, 270 left.",
      "flameTrailGravityAngle",
      [0, 359, 5],
      { depth: 2, fallback: 0, when: () => trail() && (get("flameTrailGravity") ?? 0) > 0 }
    ));
    const showStardust = shown("stardustEnabled");
    effects.push(toggle("Stardust", "A slow stream of floating pixels that drift up and fade.", "stardustEnabled", { gate: true, when: showStardust }));
    const stardust = all(showStardust, on("stardustEnabled"));
    effects.push(toggle("Always on", "Streams continuously instead of waiting for the cursor to settle.", "stardustAlwaysOn", { depth: 1, gate: true, when: stardust }));
    effects.push(slider(
      "Idle delay",
      "How long the cursor sits still before the stardust starts, in ms.",
      "stardustDelayMs",
      [500, 8e3, 250],
      { depth: 1, fallback: 2e3, when: all(stardust, off("stardustAlwaysOn")) }
    ));
    effects.push(slider("Stardust density", "How thickly the stardust streams off the cursor.", "stardustRate", [0.2, 3, 0.1], { depth: 1, fallback: 1, when: stardust }));
    effects.push(toggle("Orbit", "Motes circle the cursor like fireflies instead of drifting up.", "stardustOrbit", { depth: 1, gate: true, when: stardust }));
    effects.push(slider("Orbit radius", "How wide the motes circle, in pixels.", "stardustOrbitRadius", [10, 60, 2], { depth: 2, fallback: 22, when: all(stardust, on("stardustOrbit")) }));
    const showTether = shown("bracketTether");
    effects.push(toggle("Bracket tether", "Underlines the span between matching brackets or quotes.", "bracketTether", { gate: true, when: showTether }));
    effects.push(slider("Tether strength", "How visible the line is.", "bracketTetherStrength", [0.1, 1, 0.05], { depth: 1, fallback: 0.35, when: all(showTether, on("bracketTether")) }));
    const showSmear = shown("smear");
    effects.push(toggle("Motion smear", "The cursor stretches as it moves and snaps back when it arrives.", "smear", { gate: true, when: showSmear }));
    const smear = all(showSmear, on("smear"));
    effects.push(slider("Stiffness", "How hard the leading edge is pulled toward the new position.", "smearStiffness", [0.1, 1, 0.05], { depth: 1, when: smear }));
    effects.push(slider("Trailing stiffness", "The same for the edge left behind.", "smearTrailingStiffness", [0.05, 1, 0.05], { depth: 1, when: smear }));
    effects.push(slider("Damping", "How much the leading edge resists overshooting.", "smearDamping", [0.05, 1, 0.05], { depth: 1, when: smear }));
    effects.push(toggle("Tapered trail", "Narrows the smear to a point behind the cursor, like a comet tail.", "smearTaper", { depth: 1, gate: true, when: smear }));
    effects.push(slider("Taper amount", "How sharply the tail closes. At 1 it comes to a full point.", "smearTaperAmount", [0.1, 1, 0.05], { depth: 2, fallback: 0.7, when: all(smear, on("smearTaper")) }));
    effects.push(slider("Max length", "How far the tail may trail, in pixels. 0 is no limit.", "smearMaxLength", [0, 400, 10], { depth: 1, fallback: 0, when: smear }));
    effects.push(toggle("Conserve area", "A jump to another line thins as it stretches, keeping its area.", "smearConserveVolume", { depth: 1, gate: true, when: smear }));
    effects.push(slider("Thinning", "How strongly the area is held. At 1, twice as long is half as wide.", "smearVolumeStrength", [0.1, 1, 0.05], { depth: 2, fallback: 0.3, when: all(smear, on("smearConserveVolume")) }));
    const showEnergy = shown("energyEffect");
    effects.push(toggle("Energy beam", "A pulse of light along the cursor; with Gradient on, it scrolls your colors.", "energyEffect", { gate: true, when: showEnergy }));
    const energy = all(showEnergy, on("energyEffect"));
    effects.push(slider("Beam speed", "How fast the pulse travels along the cursor.", "energySpeed", [0.2, 3, 0.1], { depth: 1, when: energy }));
    effects.push(toggle("Aurora", "Swirls your gradient colors instead of scrolling them past.", "energyAurora", { depth: 1, gate: true, when: energy, needs: needsGradient }));
    effects.push(slider("Waviness", "How hard the bands bend. 0 keeps them flat.", "energyAuroraWaviness", [0, 2, 0.05], { depth: 2, fallback: 1, when: all(energy, on("energyAurora")), needs: needsGradient }));
    const showCrt = shown("crtEffect");
    effects.push(toggle("CRT effects", "Old-monitor phosphor look: the cursor leaves fading ghosts behind it.", "crtEffect", { gate: true, when: showCrt }));
    const crt = all(showCrt, on("crtEffect"));
    effects.push(slider("Trail length", "How many ghosts are kept behind the cursor. 0 leaves none.", "trailLength", [0, 30, 1], { depth: 1, when: crt }));
    effects.push(slider("Trail fade time", "How long (in ms) each ghost takes to fade out.", "trailFadeMs", [50, 1500, 25], { depth: 1, when: crt }));
    effects.push(toggle("Glow", "A soft halo around the cursor in its own color.", "glow", { depth: 1, when: crt }));
    effects.push(toggle("Neon trail", "Renders the ghosts as a glowing neon tube instead of fading boxes.", "crtNeon", { depth: 1, gate: true, when: crt }));
    effects.push(toggle("Gradient trail", "Runs the cursor's gradient along the streak, newest ghost to oldest.", "crtNeonGradient", { depth: 2, when: all(crt, on("crtNeon")), needs: needsGradient }));
    effects.push(toggle("Signal glitch", "Long jumps break up like a mistracked video signal.", "crtGlitch", { depth: 1, gate: true, when: crt }));
    const glitch = all(crt, on("crtGlitch"));
    effects.push(slider("Break-up", "How far the slices are thrown and how much the cursor's shape warps.", "crtGlitchStrength", [0.2, 2.5, 0.1], { depth: 2, fallback: 1, when: glitch }));
    effects.push(slider("Color split", "How far the color channels separate. 0 only tears the shape.", "crtGlitchAberration", [0, 3, 0.1], { depth: 2, fallback: 1, when: glitch }));
    effects.push(slider("Duration", "How long each burst lasts, in milliseconds.", "crtGlitchMs", [60, 600, 10], { depth: 2, fallback: 220, when: glitch }));
    const showDemon = shown("speedDemon");
    effects.push(toggle("Speed demon", "Heats from gray to white-hot as you type, cools when you stop.", "speedDemon", { gate: true, when: showDemon }));
    const demon = all(showDemon, on("speedDemon"));
    effects.push(toggle("Fire sparks", "Throws embers off the cursor once it is hot enough.", "speedDemonSparks", { depth: 1, gate: true, when: demon }));
    const sparks = all(demon, on("speedDemonSparks"));
    effects.push(slider("Spark quantity", "How many embers per burst. 0 stops them.", "speedDemonSparkQuantity", [0, 3, 0.1], { depth: 2, fallback: 1, when: sparks }));
    effects.push(slider("Spark trail", "Gives each spark a fading comet tail, in pixels. 0 = no trail.", "speedDemonSparkTrail", [0, 30, 1], { depth: 2, fallback: 0, when: sparks }));
    effects.push(toggle("Keep cursor color", "The cursor keeps your color; only the sparks react to speed.", "speedDemonNoCursorHeat", { depth: 1, gate: true, when: demon }));
    effects.push(slider("Sensitivity", "How fast typing and caret movement heat the cursor up.", "speedDemonSensitivity", [0.5, 2, 0.1], { depth: 1, when: demon }));
    const heatRamp = all(demon, off("speedDemonNoCursorHeat"));
    effects.push(toggle("Custom gradient", "Replaces the built-in heat curve with four colors of your own.", "speedDemonGradient", { depth: 1, gate: true, when: heatRamp }));
    const stages = all(heatRamp, on("speedDemonGradient"));
    const heat = (prefix) => [1, 2, 3, 4].map((i) => prefix + i);
    const stageLabels = ["Warm", "Hot", "Hotter", "Flat out"];
    effects.push(swatchRow(
      "Stages (dark theme)",
      heat("speedHeatDark"),
      stageLabels,
      "Warming to flat out. At rest the cursor keeps its own color.",
      { depth: 2, when: stages }
    ));
    effects.push(swatchRow(
      "Stages (light theme)",
      heat("speedHeatLight"),
      stageLabels,
      "The same four stages for light themes, where a white-hot final stage disappears into the page.",
      { depth: 2, when: stages }
    ));
    const showHot = shown("hotHead");
    effects.push(toggle("Hot-head", "Sets the text you're working on alight.", "hotHead", { gate: true, when: showHot }));
    const hot = all(showHot, on("hotHead"));
    effects.push(slider("Fire quantity", "How much fire. 0 puts it out.", "hotHeadQuantity", [0, 3, 0.1], { depth: 1, fallback: 1, when: hot }));
    effects.push(slider("Fire spread", "How many characters around the cursor catch. 0 burns only its own column.", "hotHeadSpread", [0, 14, 1], { depth: 1, fallback: 4, when: hot }));
    effects.push(slider("Trail over text", "Fire left along the path. 0 keeps it where the cursor stops.", "hotHeadTrail", [0, 30, 1], { depth: 1, fallback: 6, when: hot }));
    effects.push(slider("Flame height", "How high the flames climb before they burn out.", "hotHeadHeight", [0.15, 1.5, 0.05], { depth: 1, fallback: 0.55, when: hot }));
    effects.push(slider("Fade time", "How long a single fire particle lasts, in milliseconds.", "hotHeadFade", [200, 1600, 20], { depth: 1, fallback: 620, when: hot }));
    effects.push(slider("Idle timeout", "Idle time before the fire burns out. 0 keeps it burning forever.", "hotHeadIdleMs", [0, 6e3, 100], { depth: 1, fallback: 1500, when: hot }));
    effects.push(slider("Fire opacity", "How solid the fire is, independent of the cursor's own opacity.", "hotHeadOpacity", [0.1, 1, 0.05], { depth: 1, fallback: 1, when: hot }));
    effects.push(toggle("Use cursor color", "Paints the fire in the cursor's color instead of the heat gradient.", "hotHeadFlat", { depth: 1, gate: true, when: hot }));
    effects.push(toggle(
      "Heat with speed demon",
      "The fire warms up as you type, following Speed demon's heat.",
      "hotHeadSpeedHeat",
      { depth: 2, when: all(hot, on("hotHeadFlat")), needs: { when: on("speedDemon"), hint: "Needs Speed demon." } }
    ));
    const showTorch = shown("torchEffect");
    effects.push(row(
      "Torch spotlight",
      "Darkens everything except a pool of light around the cursor.",
      (s) => renderTorchToggleSetting(s, afterWrite("torchEffect")),
      { when: showTorch }
    ));
    const torch = all(showTorch, on("torchEffect"));
    effects.push(subheading("Spotlight", 1, torch));
    effects.push(dropdown(
      "Follow",
      "What the light tracks.",
      "overlayFollowMode",
      { caret: "Text cursor only", mouse: "Mouse pointer only", auto: "Auto intelligent swap" },
      { depth: 1, when: torch }
    ));
    effects.push(slider("Light size", "How far the lit circle reaches, in pixels.", "overlayRadius", [100, 800, 10], { depth: 1, when: torch }));
    effects.push(toggle("Sync with blink", "The light closes as the cursor blinks out and opens as it returns.", "overlayBlinkSync", { depth: 1, gate: true, when: torch, needs: needsBlink }));
    effects.push(slider(
      "Pulse depth",
      "How far the light closes at its darkest. At 1 it goes out.",
      "overlayBlinkDepth",
      [0.05, 1, 0.05],
      { depth: 2, fallback: 0.25, when: all(torch, on("overlayBlinkSync")), needs: needsBlink }
    ));
    owns("overlayColor");
    effects.push(row(
      "Light color",
      "The color of the light at its center.",
      (s) => {
        s.addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor")));
      },
      { depth: 1, when: torch }
    ));
    effects.push(slider("Follow speed", "How quickly the light catches up when the cursor moves.", "overlaySpeed", [0.05, 1, 0.05], { depth: 1, when: torch }));
    effects.push(subheading("Environment", 1, torch));
    effects.push(slider("Darkness", "How far everything outside the light is dimmed.", "overlayDarkness", [0.2, 1, 0.01], { depth: 1, when: torch }));
    effects.push(slider("Glow strength", "Strength of the warm glow. 0 gives a pure spotlight.", "overlayIntensity", [0, 1, 0.05], { depth: 1, when: torch }));
    effects.push(toggle("Flicker", "The light gutters like a candle.", "overlayFlicker", { depth: 1, gate: true, when: torch }));
    effects.push(slider(
      "Flicker depth",
      "How far the flame swings. At 1 it gutters right out.",
      "overlayFlickerAmount",
      [0.05, 1, 0.05],
      { depth: 2, fallback: 0.35, when: all(torch, on("overlayFlicker")) }
    ));
    effects.push(toggle("Keep sidebars lit", "Darkens every note tab; sidebars, ribbon and other views stay lit. Desktop only.", "overlaySpareSidebars", { depth: 1, when: torch }));
    appearance.push(this.resetLinkRow("Appearance", resetCard("Appearance")));
    blinking.push(this.resetLinkRow("Blinking", resetCard("Blinking")));
    smooth.push(this.resetLinkRow("Smooth movement", resetCard("Smooth movement")));
    effects.push(this.resetLinkRow("Effects", resetCard("Effects")));
    const summaries = {
      Appearance: () => {
        const parts = [String(get("cursorStyle") || "Box")];
        if (get("gradientEnabled")) parts.push("gradient");
        if (get("cursorTranslucent")) parts.push("translucent");
        if (get("cursorStyle") === "Box" && get("showChar")) parts.push("letter inside");
        if (get("cursorRounded")) parts.push("rounded");
        return parts.join(" \xB7 ");
      },
      Blinking: () => get("blinkingEnabled") ? `On \xB7 ${Number(get("blinkSpeed") ?? 1).toFixed(1)}\xD7` + (get("blinkBreathing") ? " \xB7 breathing" : "") : "Off",
      "Smooth movement": () => get("smoothEnabled") ? "On" : "Off",
      // Every effect that is on, by name; Obsidian ellipsizes a long one.
      Effects: () => {
        const on2 = RAIL_EFFECTS.filter((e) => !!get(e.key));
        return on2.length ? on2.map((e) => e.name).join(" \xB7 ") : "Off";
      }
    };
    const cards = [
      this.section("Appearance", appearance),
      this.section("Blinking", blinking),
      this.section("Smooth movement", smooth),
      this.section("Effects", effects)
    ];
    cards.gates = gates;
    cards.cardKeys = cardKeys;
    cards.summaries = summaries;
    cards.effectsOn = () => RAIL_EFFECTS.filter((e) => !!get(e.key));
    return cards;
  }
  // The last row of a look tab: a small link that puts the tab's settings
  // back to their defaults.
  resetLinkRow(title, reset) {
    return {
      name: "",
      searchable: false,
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-reset-row");
        const btn = setting.controlEl.createEl("button", { cls: "cursor-smith-reset-link", attr: { type: "button" } });
        (0, import_obsidian.setIcon)(btn, "rotate-ccw");
        btn.createSpan({ text: `Reset ${title} to defaults` });
        btn.addEventListener("click", reset);
      }
    };
  }
  // --- The Effects rail ------------------------------------------------------
  // One row of chips, one per effect plus "All": a tick while the effect
  // is on, the effect's icon, its name; the picked chip filled with the
  // accent. Repainted on every
  // refresh - an effect's toggle row changes its dot - and a click on one
  // sets the pick and refreshes, which shows its rows and hides the others.
  // In the control area, which Obsidian empties on a re-render.
  railRow(get, pick, choose) {
    return {
      name: "Effects",
      desc: "Pick an effect. A tick marks the ones that are on.",
      render: (setting) => {
        this.resetRow(setting);
        setting.settingEl.addClass("cursor-smith-rail-row");
        const rail = setting.controlEl.createDiv({ cls: "cursor-smith-rail" });
        const chips = [];
        const chip = (key, name, icon) => {
          const el = rail.createEl("button", { cls: "cursor-smith-chip", attr: { type: "button" } });
          if (icon) (0, import_obsidian.setIcon)(el.createSpan({ cls: "cursor-smith-tick" }), "check");
          if (icon) (0, import_obsidian.setIcon)(el.createSpan({ cls: "cursor-smith-chip-icon" }), icon);
          el.createSpan({ text: name });
          el.addEventListener("click", () => choose(key));
          chips.push({ key, el });
        };
        for (const e of RAIL_EFFECTS) chip(e.key, e.name, e.icon);
        chip("all", "All", null);
        const roving = this.rovingRow(rail, chips.map((c) => c.el));
        const paint = () => {
          const p = pick();
          for (const c of chips) {
            c.el.toggleClass("is-picked", c.key === p);
            c.el.toggleClass("is-on", c.key !== "all" && !!get(c.key));
            c.el.setAttribute("aria-pressed", c.key === p ? "true" : "false");
          }
          roving.picked(Math.max(0, chips.findIndex((c) => c.key === p)));
        };
        paint();
        this.onRefresh(paint);
      }
    };
  }
  // Arrow keys across a row of pills (the Effects rail, the Vim mode tabs).
  // One pill is in the Tab order - the picked one - and Left/Right/Home/End
  // move focus (and the Tab stop) along the row, so a keyboard user does
  // not Tab through ten chips to reach the rows under them. Enter and
  // Space press the focused pill, as on any button. `picked` re-seats the
  // Tab stop when the pick changes without a rebuild (the rail's refresh).
  rovingRow(row, pills) {
    const seat = (i) => pills.forEach((p, k) => p.setAttribute("tabindex", k === i ? "0" : "-1"));
    row.addEventListener("keydown", (ev) => {
      const i = pills.indexOf(ev.target);
      if (i < 0) return;
      let j = -1;
      if (ev.key === "ArrowRight") j = (i + 1) % pills.length;
      else if (ev.key === "ArrowLeft") j = (i - 1 + pills.length) % pills.length;
      else if (ev.key === "Home") j = 0;
      else if (ev.key === "End") j = pills.length - 1;
      if (j < 0) return;
      ev.preventDefault();
      seat(j);
      pills[j].focus();
    });
    return { picked: seat };
  }
  // A row that needs a setting from another card: disabled, dimmed, with the
  // hint in its description, while that setting is off. Repainted on every
  // refresh (see _refreshers).
  needsHint(setting, needs) {
    const hint = setting.descEl.createSpan({ cls: "cursor-smith-needs-hint", text: " " + needs.hint });
    const paint = () => {
      const ok = needs.when();
      setting.settingEl.toggleClass("cursor-smith-needs", !ok);
      hint.toggleClass("is-shown", !ok);
      for (const c of setting.components) c.setDisabled(!ok);
    };
    paint();
    this.onRefresh(paint);
  }
};

// src/measure.ts
var import_obsidian2 = require("obsidian");
var measureMethods = {
  caretCoords() {
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (view && this.editorFocused(view)) {
      return this.cmCaretCoords(view);
    }
    return this.genericCaretCoords();
  },
  cmCaretCoords(view) {
    try {
      const main = view.state.selection.main;
      const pos = main.head;
      const doc = view.dom.ownerDocument;
      const active = doc.activeElement;
      const activeIsEditable = isTextCaretHost(active);
      const inTable = !!active?.closest?.("table");
      const side = main.assoc || 1;
      const geoNow = performance.now();
      let gc = this._caretGeoCache;
      let c;
      if (!inTable && gc && gc.doc === view.state.doc && gc.pos === pos && gc.assoc === (main.assoc || 0) && gc.gen === (this._layoutGen | 0) && geoNow - gc.t < GEOMETRY_TTL_MS) {
        c = gc.c;
      } else {
        c = inTable ? null : view.coordsAtPos(pos, side) || view.coordsAtPos(pos, -side);
        if (c && !inTable) {
          this._caretGeoCache = { doc: view.state.doc, pos, assoc: main.assoc || 0, gen: this._layoutGen | 0, t: geoNow, c };
        }
      }
      if (!c) {
        c = this.selectionFallbackCoords(view);
        if (!c) return null;
      }
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1;
        const cBottom = c.bottom ?? c.top;
        if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) {
          return null;
        }
      }
      const rawChar = view.state.doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";
      const win = doc.defaultView || window;
      const assocKey = main.assoc || 0;
      const nowMs = performance.now();
      const styleGen = this._styleGen | 0;
      let sc = this._caretStyleCache;
      if (!(sc && sc.doc === view.state.doc && sc.pos === pos && sc.assoc === assocKey && sc.gen === styleGen && nowMs - sc.t < CARET_STYLE_TTL_MS)) {
        const contentStyle = win.getComputedStyle(view.contentDOM);
        const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
        const sampleY = (c.top + c.bottom) / 2;
        const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
        const lineEl = elAtCaret && elAtCaret.closest && elAtCaret.closest(".cm-line") || view.contentDOM.querySelector(".cm-line");
        const charStyle = elAtCaret && lineEl && lineEl.contains(elAtCaret) ? win.getComputedStyle(elAtCaret) : lineEl ? win.getComputedStyle(lineEl) : contentStyle;
        const _textColor = charStyle.color || contentStyle.color || "#ffffff";
        const _fontSize = parseFloat(charStyle.fontSize) || parseFloat(contentStyle.fontSize) || 14;
        const _fontFamily = charStyle.fontFamily || contentStyle.fontFamily || "monospace";
        const _fontWeight = charStyle.fontWeight || contentStyle.fontWeight || "normal";
        const _fontStyleCss = charStyle.fontStyle || contentStyle.fontStyle || "normal";
        const letterSpacingStr = charStyle.letterSpacing || contentStyle.letterSpacing;
        let _letterSpacing = 0;
        if (letterSpacingStr && letterSpacingStr.endsWith("px")) {
          _letterSpacing = parseFloat(letterSpacingStr) || 0;
        }
        const _lineHeightStr = charStyle.lineHeight || contentStyle.lineHeight || "";
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
            }
          }
        }
        let _rowLeft = null, _rowRight = null;
        if (lineEl) {
          try {
            const rng = doc.createRange();
            rng.selectNodeContents(lineEl);
            const rects = rng.getClientRects();
            let best = null;
            let nearest = null, nearestD = Infinity;
            for (let ri = 0; ri < rects.length; ri++) {
              const r = rects[ri];
              if (r.width <= 0 && r.height <= 0) continue;
              const overlap = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
              if (overlap > 0) {
                if (!best) best = { left: r.left, right: r.right };
                else {
                  best.left = Math.min(best.left, r.left);
                  best.right = Math.max(best.right, r.right);
                }
              } else {
                const d = Math.abs((r.top + r.bottom) / 2 - (c.top + c.bottom) / 2);
                if (d < nearestD) {
                  nearestD = d;
                  nearest = r;
                }
              }
            }
            if (!best && nearest && nearestD < c.bottom - c.top) {
              best = { left: nearest.left, right: nearest.right };
            }
            if (best && best.right - best.left > 0.5) {
              _rowLeft = best.left;
              _rowRight = best.right;
            } else if (!(lineEl.textContent || "").trim()) {
              _rowLeft = c.left;
              _rowRight = c.left;
            } else {
              _rowLeft = null;
              _rowRight = null;
            }
          } catch {
            _rowLeft = null;
            _rowRight = null;
          }
        }
        sc = this._caretStyleCache = {
          doc: view.state.doc,
          pos,
          assoc: assocKey,
          gen: styleGen,
          t: nowMs,
          textColor: _textColor,
          fontSize: _fontSize,
          fontFamily: _fontFamily,
          fontWeight: _fontWeight,
          fontStyle: _fontStyleCss,
          letterSpacing: _letterSpacing,
          lineHeightStr: _lineHeightStr,
          charWidth: _charWidth,
          rowLeft: _rowLeft,
          rowRight: _rowRight
        };
      }
      const {
        textColor,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle: fontStyleCss,
        letterSpacing,
        lineHeightStr,
        charWidth,
        rowLeft,
        rowRight
      } = sc;
      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.caretThickness();
      }
      let h = Math.max(4, c.bottom - c.top);
      const rawLineHeight = lineHeightStr;
      if (rawLineHeight && rawLineHeight.endsWith("px")) {
        h = parseFloat(rawLineHeight);
      } else if (rawLineHeight && !isNaN(parseFloat(rawLineHeight)) && rawLineHeight !== "normal") {
        h = fontSize * parseFloat(rawLineHeight);
      }
      const centerY = (c.top + c.bottom) / 2;
      const top = centerY - h / 2;
      const bottom = centerY + h / 2;
      return {
        x: c.left,
        top,
        bottom,
        h,
        w: finalWidth,
        actualCharWidth: charWidth,
        // Text extent of the caret's own visual row, in canvas coords (the
        // canvas is position:fixed at 0,0 so client coords map straight over).
        // Hot-head uses it to keep fire on the text and to spot row edges.
        rowLeft,
        rowRight,
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
        focused: this.editorFocused(view) || inTable && activeIsEditable,
        pos,
        // The document length, for resolveHoldChar: with pos, an insertion
        // at the caret (typing) is told from a click or an arrow.
        docLen: view.state.doc.length,
        // Needed by updateActivePoint: an assoc flip at a wrap boundary is a
        // real cursor move (row1-end -> row2-start) even though pos is equal,
        // and must NOT be swallowed by the scroll-compensation branch.
        assoc: main.assoc
      };
    } catch (e) {
      this._reportOnce("cmCaretCoords", e);
      return null;
    }
  },
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
    if (!view || !this.editorFocused(view)) return out;
    const gen = this._layoutGen | 0;
    const now = performance.now();
    const doc = view.state.doc;
    try {
      const sel = view.state.selection;
      const ranges = sel.ranges;
      if (!ranges || ranges.length <= 1) return out;
      const mainIndex = sel.mainIndex;
      const paneRect = this.getPaneRect(view);
      const margin = 1;
      for (let i = 0; i < ranges.length; i++) {
        if (i === mainIndex) continue;
        const head = ranges[i].head;
        const s = ranges[i].assoc || 1;
        const st = states && states[out.length];
        let c = null;
        const g = st && st._geo;
        if (g && g.doc === doc && g.pos === head && g.gen === gen && now - g.t < GEOMETRY_TTL_MS) {
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
        const empty = !!ranges[i].empty;
        out.push(visible && c ? { x: c.left, top: c.top, bottom: c.bottom, pos: head, assoc: ranges[i].assoc || 0, empty, visible: true } : { x: 0, top: 0, bottom: 0, pos: head, assoc: ranges[i].assoc || 0, empty, visible: false });
      }
    } catch (e) {
      this._reportOnce("secondaryCaretCoords", e);
    }
    return out;
  },
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
    if (!(st && st.doc === doc && st.pos === pos && now - st.t < 250)) {
      const win = view.dom.ownerDocument.defaultView || window;
      let lineEl = null;
      try {
        const d = view.domAtPos(pos);
        const n = d && d.node && d.node.nodeType === 3 ? d.node.parentElement : d && d.node;
        lineEl = n && n.closest ? n.closest(".cm-line") : null;
      } catch {
      }
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
          letterSpacing: letterSpacingStr && letterSpacingStr.endsWith("px") ? parseFloat(letterSpacingStr) || 0 : 0,
          lineHeightStr: cs.lineHeight || ""
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
    const w = this.styleFor("cursorStyle") === "Line" ? this.caretThickness() : st.charWidth;
    return {
      x: c.x,
      top: centerY - h / 2,
      bottom: centerY + h / 2,
      h,
      w,
      actualCharWidth: st.charWidth,
      rowLeft: null,
      rowRight: null,
      char: st.char,
      textColor: st.textColor,
      fontSize: st.fontSize,
      fontFamily: st.fontFamily,
      fontWeight: st.fontWeight,
      fontStyle: st.fontStyle,
      letterSpacing: st.letterSpacing,
      focused: true,
      pos,
      assoc: c.assoc,
      docLen: view.state.doc.length
    };
  },
  selectionFallbackCoords(view) {
    const doc = view ? view.dom.ownerDocument : this.canvas?.ownerDocument ?? document;
    const active = doc.activeElement;
    if (!active) return null;
    if (!isTextCaretHost(active)) return null;
    const isFormField = active.tagName === "TEXTAREA" || active.tagName === "INPUT";
    if (isFormField) {
      const fieldRect = this.formFieldCaretCoords(active);
      if (fieldRect) return fieldRect;
    }
    const win = doc.defaultView || window;
    const sel = win.getSelection();
    if (sel && sel.rangeCount > 0 && sel.focusNode && active.isContentEditable) {
      const isDegenerate = (r) => !r || r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0;
      const spanRect = this.adjacentCharRect(doc, sel.focusNode, sel.focusOffset);
      if (spanRect) return spanRect;
      let range;
      try {
        range = doc.createRange();
        range.setStart(sel.focusNode, sel.focusOffset);
        range.collapse(true);
      } catch {
        range = sel.getRangeAt(0).cloneRange();
        range.collapse(true);
      }
      let rect2 = range.getClientRects()[0] || (range.getBoundingClientRect?.() ?? null);
      if (isDegenerate(rect2)) {
        let node = range.startContainer;
        let lineEl = node.nodeType === 1 ? node : node.parentElement;
        if (lineEl && lineEl !== active) {
          const lineRect = lineEl.getBoundingClientRect();
          if (!isDegenerate(lineRect)) rect2 = lineRect;
        }
      }
      if (!isDegenerate(rect2)) {
        return { left: rect2.left, top: rect2.top, bottom: rect2.bottom || rect2.top + rect2.height };
      }
    }
    const rect = active.getBoundingClientRect();
    if (!rect) return null;
    const style = win.getComputedStyle(active);
    const approxLineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
    if (rect.height > approxLineHeight * 3) return null;
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  },
  // Measures a real, rendered one-character span next to the caret (rather
  // than a collapsed point) so the resulting rect uses the browser's actual
  // line-box metrics - the same metrics it uses to paint text and selection
  // highlights - instead of a font's tight glyph metrics.
  adjacentCharRect(doc, node, offset) {
    if (!node || node.nodeType !== 3) return null;
    const text = node.data || "";
    const isDegenerate = (r) => !r || r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0;
    let caretX = null, caretTop = 0, caretBottom = 0;
    try {
      const c = doc.createRange();
      c.setStart(node, offset);
      c.collapse(true);
      const cr = c.getClientRects()[0] || c.getBoundingClientRect();
      if (!isDegenerate(cr)) {
        caretX = cr.left;
        caretTop = cr.top;
        caretBottom = Math.max(cr.bottom, cr.top + (cr.height || 0));
      }
    } catch {
    }
    const onLine = (rect) => caretX === null || caretTop < rect.bottom && caretBottom > rect.top;
    try {
      if (offset < text.length) {
        const r = doc.createRange();
        r.setStart(node, offset);
        r.setEnd(node, offset + 1);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX !== null && onLine(rect) ? caretX : rect.left, top: rect.top, bottom: rect.bottom };
      }
      if (offset > 0) {
        const r = doc.createRange();
        r.setStart(node, offset - 1);
        r.setEnd(node, offset);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: caretX !== null && onLine(rect) ? caretX : rect.right, top: rect.top, bottom: rect.bottom };
      }
    } catch {
    }
    return null;
  },
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
      this._nodeIds = /* @__PURE__ */ new WeakMap();
      this._nodeIdSeq = 0;
    }
    let id = this._nodeIds.get(node);
    if (id === void 0) {
      id = ++this._nodeIdSeq;
      this._nodeIds.set(node, id);
    }
    return String(id);
  },
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
        const field = active;
        return el + ":" + (field.selectionStart ?? 0) + ":" + (field.selectionEnd ?? 0);
      }
      const win = doc && doc.defaultView || window;
      const sel = win.getSelection();
      if (sel && sel.focusNode) {
        return el + ":" + this._nodeKey(sel.focusNode) + ":" + sel.focusOffset;
      }
      return el + ":0";
    } catch (e) {
      this._reportOnce("genericCaretPos", e);
      return null;
    }
  },
  genericCaretCoords() {
    try {
      if (this.settings.noteEditorOnly) return null;
      const doc = this.canvas?.ownerDocument ?? document;
      const active = doc.activeElement;
      if (!isTextCaretHost(active)) return null;
      if (this.isExcalidrawCaretHost(active)) return null;
      const c = this.selectionFallbackCoords(null);
      if (!c) return null;
      const win = doc.defaultView || window;
      const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
      const sampleY = (c.top + c.bottom) / 2;
      const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
      const styleSource = elAtCaret && active.contains?.(elAtCaret) ? elAtCaret : active;
      const style = win.getComputedStyle(styleSource);
      const fontSize = parseFloat(style.fontSize) || 14;
      const fontFamily = style.fontFamily || "inherit";
      const char = this.genericCaretChar(active);
      const measured = char ? this.measureCharWidth(char, fontFamily, fontSize, style.fontWeight, style.fontStyle) : null;
      const charWidth = measured || Math.max(4, fontSize * 0.55);
      const height = Math.max(4, c.bottom - c.top || fontSize * 1.2);
      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.caretThickness();
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
        rowLeft: null,
        rowRight: null,
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
        pos: this.genericCaretPos(active, doc)
      };
    } catch (e) {
      this._reportOnce("genericCaretCoords", e);
      return null;
    }
  },
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
  },
  measureCharWidth(char, fontFamily, fontSize, fontWeight, fontStyle) {
    try {
      const ctx = this._measureCtx || (this._measureCtx = createEl("canvas").getContext("2d"));
      if (!ctx) return null;
      ctx.font = this.fontString(fontSize, fontFamily, fontWeight, fontStyle);
      const w = ctx.measureText(char).width;
      return w > 0 ? w : null;
    } catch {
      return null;
    }
  },
  // The character sitting immediately after the caret, for elements outside
  // the note editor - mirrors what cmCaretCoords does for CodeMirror. Used
  // to draw the "letter inside the cursor" effect in non-editor fields too.
  genericCaretChar(active) {
    try {
      if (active.tagName === "INPUT" || active.tagName === "TEXTAREA") {
        const field = active;
        const value = field.value != null ? String(field.value) : "";
        let selStart = value.length;
        try {
          const s = field.selectionStart, e = field.selectionEnd;
          if (typeof s === "number" && typeof e === "number") {
            selStart = field.selectionDirection === "backward" ? s : e;
          }
        } catch {
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
    }
    return "";
  },
  // The letter just typed, for the letter pop and for the box that WAITS at
  // the old spot through a Move delay - the spot the letter now occupies.
  // Once the box moves it sits past the letter and shows the character
  // under the caret (nothing at the end of a line), so nothing holds it
  // there. Only for an insertion at the caret - the document grew by
  // exactly the distance the caret moved: a keystroke, a paste - and null
  // for every other move. A click or an arrow, forward or back, shows the
  // character under the caret, or nothing on an empty line.
  //
  // It used to hold the character before ANY forward move (a click ahead
  // held whatever preceded the click, a space at a word's start included,
  // and popped a letter particle for it) and, for every other move, the
  // previous position's character - so a click from a word onto an empty
  // line showed the word's letter in the empty box.
  resolveHoldChar(newCaret) {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      const last = this.lastActive;
      if (view && last && typeof newCaret.pos === "number" && typeof last.pos === "number" && typeof newCaret.docLen === "number" && typeof last.docLen === "number" && newCaret.pos > last.pos && newCaret.docLen - last.docLen === newCaret.pos - last.pos) {
        const justTyped = view.state.doc.sliceString(newCaret.pos - 1, newCaret.pos);
        if (justTyped && justTyped !== "\n") {
          if (this.look.popEffects && this.look.popLetters) {
            this.spawnLetterParticle(justTyped, last);
          }
          return justTyped;
        }
      }
    } catch {
    }
    return null;
  },
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
      if (this._excaliHostFor !== el) {
        this._excaliHostFor = el;
        this._excaliHostVal = !!(el.closest?.(".excalidraw, .excalidraw-wrapper, .excalidraw-view") || el.classList?.contains("excalidraw-wysiwyg"));
      }
      if (this._excaliHostVal) return true;
      const view = this.app.workspace.getActiveViewOfType(import_obsidian2.View);
      if (view?.getViewType?.() !== "excalidraw") return false;
      if (view.contentEl) return view.contentEl.contains(el);
      return !!(view.containerEl && view.containerEl.contains(el) && !el.closest?.(".view-header"));
    } catch (e) {
      this._reportOnce("isExcalidrawCaretHost", e);
      return false;
    }
  },
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
      return !!(view && this.editorFocused(view));
    } catch (e) {
      this._reportOnce("noteEditorFocused", e);
      return false;
    }
  },
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
  },
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
    const now = performance.now();
    const c = this._chromeCache;
    if (c && c.doc === doc && now - c.t < 500) return c;
    let top = 0;
    const titleBar = doc.querySelector(".titlebar");
    const isHiddenFrameless = doc.body.classList.contains("is-hidden-frameless");
    if (titleBar && !isHiddenFrameless) {
      const tb = titleBar.getBoundingClientRect();
      if (tb.height > 0 && tb.top <= tb.height) top = Math.max(top, tb.bottom);
    }
    let bottomInset = 0;
    let statusLeft = 0, statusRight = 0;
    const statusBar = doc.querySelector(".status-bar");
    if (statusBar && this._isVisiblyRendered(statusBar)) {
      const sb = statusBar.getBoundingClientRect();
      const win = doc.defaultView || window;
      if (sb.height > 0 && sb.bottom >= win.innerHeight - 1) {
        bottomInset = Math.max(0, win.innerHeight - sb.top);
        statusLeft = sb.left;
        statusRight = sb.right;
      }
    }
    let coverTop = 0;
    let coverBottom = Number.POSITIVE_INFINITY;
    const win2 = doc.defaultView || window;
    for (const el of Array.from(doc.querySelectorAll(CARET_COVERS))) {
      if (!this._isVisiblyRendered(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width < win2.innerWidth * 0.4) continue;
      if (r.top + r.height / 2 < win2.innerHeight / 2) coverTop = Math.max(coverTop, r.bottom);
      else coverBottom = Math.min(coverBottom, r.top);
    }
    this._chromeCache = { doc, t: now, top, bottomInset, statusLeft, statusRight, coverTop, coverBottom };
    return this._chromeCache;
  },
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
    const bottom = win.innerHeight;
    if (bottom <= top) {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    }
    return {
      top,
      bottom,
      left: 0,
      right: win.innerWidth,
      width: win.innerWidth,
      height: bottom - top
    };
  },
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
  },
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
        if (clips && (curPos !== "absolute" || positioned)) chain.push(node);
        if (positioned) {
          if (st.position === "fixed") break;
          curPos = st.position;
        }
        node = node.parentElement;
      }
    } catch (e) {
      this._reportOnce("_resolveClipChain", e);
      return [];
    }
    return chain;
  },
  getPaneRect(view) {
    if (!view) return null;
    const now = performance.now();
    const pc = this._paneRectCache;
    if (pc && pc.view === view && pc.gen === (this._layoutGen | 0) && now - pc.t < GEOMETRY_TTL_MS) return pc.rect;
    const rootEl = view.dom.closest(".cm-editor") || view.dom.closest(".workspace-leaf");
    if (!rootEl) return null;
    const rect = rootEl.getBoundingClientRect();
    const out = this._paneRectFrom(rect, rootEl);
    this._paneRectCache = { view, gen: this._layoutGen | 0, t: now, rect: out };
    return out;
  },
  // The workspace's main area: the root split, which is every tab group
  // and nothing of the docks, the ribbon or the status bar - the torch
  // overlay's box with "Keep sidebars lit" on - and, within it, the NOTE
  // TABS: the rectangle of each tab group whose front tab is a note (a
  // markdown view; Obsidian hides the group's other tabs with an inline
  // display: none). Those are what the torch darkens: not the active
  // editor's pane (one lit tab beside a dark one undid the effect, and the
  // pane changed with focus), and not the views beside the notes either
  // (Word-Smith's History, Export and Organizer, a graph, an empty tab -
  // "not ok" dark). Both clamped below a visible titlebar like the pane.
  // The rect is null where there is no root split and no workspace (the
  // torch then dims the window). Cached like the pane, on the layout
  // generation and the geometry TTL.
  _mainArea(doc) {
    const now = performance.now();
    const mc = this._mainRectCache;
    if (mc && mc.doc === doc && mc.gen === (this._layoutGen | 0) && now - mc.t < GEOMETRY_TTL_MS) return mc;
    const rootEl = doc.querySelector(".workspace-split.mod-root") || doc.querySelector(".workspace");
    const box = rootEl ? this._paneRectFrom(rootEl.getBoundingClientRect(), rootEl) : null;
    const rect = box && box.width > 0 && box.height > 0 ? box : null;
    const notes = [];
    if (rootEl) {
      for (const group of Array.from(rootEl.querySelectorAll(".workspace-tabs"))) {
        let front = null;
        for (const leaf of Array.from(group.querySelectorAll(":scope > .workspace-tab-container > .workspace-leaf"))) {
          if (leaf.style.display !== "none") {
            front = leaf;
            break;
          }
        }
        const content = front && front.querySelector(":scope > .workspace-leaf-content");
        if (!content || content.getAttribute("data-type") !== "markdown") continue;
        const b = this._paneRectFrom(group.getBoundingClientRect(), group);
        if (b && b.width > 0 && b.height > 0) notes.push(b);
      }
    }
    this._mainRectCache = { doc, gen: this._layoutGen | 0, t: now, rect, notes };
    return this._mainRectCache;
  },
  getMainAreaRect(doc) {
    return this._mainArea(doc).rect;
  },
  // The note tabs' rectangles (client coordinates); empty when no note is
  // in front anywhere in the main area.
  getNoteTabRects(doc) {
    return this._mainArea(doc).notes;
  },
  _paneRectFrom(rect, rootEl) {
    const doc = rootEl.ownerDocument;
    const { top: chromeTop } = this._chromeInsets(doc);
    const top = Math.max(rect.top, chromeTop);
    const bottom = rect.bottom;
    if (bottom <= top) return rect;
    return {
      top,
      bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: bottom - top
    };
  },
  getActiveRect() {
    const active = this.animActive;
    if (!active) return null;
    if (this.styleFor("cursorStyle") === "Underline") {
      const uThickness = this.underlineThickness(active.h);
      return { x: active.x, y: active.top + active.h - uThickness, w: active.actualCharWidth, h: uThickness };
    }
    if (this.styleFor("cursorStyle") === "Line") {
      const span = this.lineSpan(active.top, active.h);
      return { x: active.x, y: span.top, w: this.renderWidth(active), h: span.h };
    }
    return { x: active.x, y: active.top, w: this.renderWidth(active), h: active.h };
  },
  // The Line cursor's vertical extent in a line box (top, h): Cursor height
  // (caretHeightPct) of it, centred on the line - "the cursor height, which
  // matches the height of the line itself exactly, is a bit too large for
  // me" (issue #33, as VS Code allows). 100 is the whole line, as always.
  // One helper for the painter, the serifs, the smear's rect and the trail
  // ghosts, so the parts of the caret agree.
  lineSpan(top, h) {
    const pct = Math.max(20, Math.min(100, Number(this.styleFor("caretHeightPct") ?? 100) || 100)) / 100;
    if (pct >= 1) return { top, h };
    const hh = h * pct;
    return { top: top + (h - hh) / 2, h: hh };
  },
  renderWidth(active) {
    return active.w;
  },
  // The Line cursor's thickness, in px: the setting, in 0.1 px steps since
  // 1.6.6 (issue #32), held between 0.5 and CARET_THICKNESS_MAX - a value
  // saved before the cap came down from 12 draws at the cap.
  caretThickness() {
    const v = Number(this.styleFor("caretWidthPx"));
    return Number.isFinite(v) && v > 0 ? Math.max(0.5, Math.min(CARET_THICKNESS_MAX, v)) : 2;
  },
  // Thickness of the Underline cursor's bar, in px.
  //
  // 0 (the default) means "auto": 15% of the line height, which is exactly
  // what this style did before the setting existed - so an existing setup, and
  // any Vim mode that never overrode the key, keeps the look it already had.
  // Anything else is a literal pixel thickness, clamped to the line height so
  // a large value on a small font degrades to a filled block rather than
  // painting outside the line. Fractional since 1.6.6, like the Line's (the
  // slider steps by 0.1 px; it was rounded to whole pixels here), and never
  // above CARET_THICKNESS_MAX.
  underlineThickness(lineHeight) {
    const h = Math.max(1, Math.round(lineHeight || 0));
    const px = this.look.underlineWidthPx || 0;
    if (px > 0) return Math.max(0.5, Math.min(px, CARET_THICKNESS_MAX, h));
    return Math.max(2, Math.round(h * 0.15));
  }
};

// src/fire.ts
var HOT_STOP_POS = [0, 0.12, 0.42, 0.72, 1];
var HOT_HSV = [
  [44, 1, 1],
  // amber-yellow (a touch warmer than a pure 48 gold,
  // which reads green-ish next to orange)
  [30, 1, 1],
  // orange
  [12, 0.95, 1],
  // red-orange
  [26, 0.2, 1]
  // white-hot, faintly warm
];
var HOT_TEMP_GAMMA = 0.55;
var HOT_PX_DIVISOR = 4.5;
var HOT_PX_MIN = 2;
var HOT_PX_MAX = 5;
var HOT_STAGE_PIXEL = 0.22;
var HOT_BLOCK_SHAPES = [
  ["11", "11", "11", "11"],
  // 2x4 column, the recording's chunk
  ["011", "111", "111"],
  // 3x3 notched, the widest
  ["110", "111", "111"],
  ["11", "11", "11"],
  // 2x3
  ["01", "11", "11"],
  // 2x3 notched at the top
  ["10", "11", "11"],
  ["111", "111"],
  // 3x2 wide
  ["1", "1", "1", "1"],
  // 1x4 thin column
  ["11", "11"],
  // 2x2, the original's fresh block
  ["1", "1", "1"],
  // 1x3 tall
  ["01", "11"],
  // small L
  ["10", "11"],
  ["111"],
  // 3x1
  ["11"],
  // 2x1 wide
  ["1", "1"],
  // 1x2 tall
  ["1"]
  // 1x1, the original's pixel
];
var hotShapeStage = (area) => area >= 6 ? 3 : area >= 4 ? 2 : area >= 2 ? 1.5 : 1;
var HOT_COLOR_LEVELS = 3;
var HOT_TEMP_MAX = 0.5;
var HOT_ALPHA_LEVELS = 3;
var hotQuant = (v, levels) => Math.round(Math.max(0, Math.min(1, v)) * levels) / levels;
var HOT_SPARKS_PER_CHUNK = 1;
var HOT_SPARK_MAX = 60;
var HOT_BUDGET_CARETS = 8;
var HOT_SPECK_SCALE = 0.85;
var HOT_FINE_SCALE = 0.5;
var HOT_FINE_CHANCE = 0.4;
var HOT_ENGULF_MS = 260;
var HOT_ENGULF_RATE = 200;
var HOT_ENGULF_PAD_X = 1.1;
var HOT_SPARK_LIFT = 1.9;
var HOT_SPARK_RISE = 5;
var FLAME_LEVELS = 16;
var FLAME_MAX_NUM = 110;
var FLAME_MAX_LIFETIME = 620;
var FLAME_LIFETIME_EXP = 2.2;
var HOT_LIFE_FLOOR = 0.25;
var HOT_SHAPE_EASE = 1.6;
var FLAME_PER_SECOND = 125;
var FLAME_PER_LENGTH = 0.8;
var FLAME_SPREAD = 0.5;
var FLAME_INITIAL_VELOCITY = 6;
var HOT_START_CONE = 0.45;
var FLAME_RANDOM_VELOCITY = 62;
var HOT_TURB_X = 0.15;
var HOT_TURB_Y = 0.5;
var HOT_SWAY_CW = 0.3;
var HOT_SWAY_HZ = 1.3;
var HOT_SWAY_GROW_MS = 260;
var FLAME_DAMPING = 0.2;
var FLAME_BUOYANCY = -85;
var HOT_FLAT_HUE_SPAN = 26;
var HOT_FLAT_LIGHTEN = 0.55;
var HOT_HEAD_LIFT = -0.06;
var HOT_HEAD_JITTER_UP = 0.07;
var HOT_HEAD_JITTER_DOWN = 0.02;
var HOT_BURN_LINGER_MS = 240;
var HOT_BURN_MAX = 64;
var HOT_TRAIL_FADE_POW = 1;
var HOT_TRAIL_STEP_CW = 1;
var HOT_TRAIL_PATH_MAX = 24;
var HOT_TRAIL_PATH_AGE = 0.35;
var HOT_TRAIL_EMIT_MAX = 2.4;

// src/effects-fire.ts
function hotKick(mag) {
  const ang = -Math.PI / 2 + (Math.random() * 2 - 1) * HOT_START_CONE;
  return {
    vx: mag * Math.cos(ang),
    vy: mag * Math.sin(ang),
    age: 0,
    sw: HOT_SWAY_CW * (0.6 + 0.4 * Math.random()),
    sf: HOT_SWAY_HZ * (0.75 + 0.5 * Math.random()),
    sp: Math.random() * Math.PI * 2,
    so: 0
  };
}
var effectsFireMethods = {
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
    if (!this.styleFor("hotHead")) {
      this._hotScroll = null;
      return;
    }
    const view = this.app.workspace.activeEditor?.editor?.cm;
    let el = null;
    const chain = this._clipChainFor && this._clipChain;
    if (chain && chain.length && !(view && this.editorFocused(view))) {
      for (const c of chain) {
        if (c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) {
          el = c;
          break;
        }
      }
    }
    if (!el) el = view && view.scrollDOM || null;
    if (!el) {
      this._hotScroll = null;
      return;
    }
    const prev = this._hotScroll;
    let ox, oy;
    if (this._caretPass === "secondary") {
      const sh = this._hotShift;
      if (!sh || sh.tick !== this._tickNo) return;
      if (this._hotShiftTick === sh.tick) return;
      this._hotShiftTick = sh.tick;
      if (!sh.ox && !sh.oy) return;
      ox = sh.ox;
      oy = sh.oy;
    } else {
      const gen = this._layoutGen | 0;
      if (prev && prev.el === el && prev.gen === gen) return;
      const sx = el.scrollLeft || 0;
      const sy = el.scrollTop || 0;
      if (!prev || prev.el !== el) {
        this._hotScroll = { el, x: sx, y: sy, gen };
        return;
      }
      prev.gen = gen;
      const dx = sx - prev.x;
      const dy = sy - prev.y;
      prev.x = sx;
      prev.y = sy;
      this._hotShift = { ox: -dx, oy: -dy, tick: this._tickNo };
      if (!dx && !dy) return;
      ox = -dx;
      oy = -dy;
      for (const p of this.flameEmbers) {
        p.x += ox;
        p.y += oy;
      }
    }
    const nEmbers = this.flameEmbers.length;
    const nBurns = this.hotBurns ? this.hotBurns.length : 0;
    if (!nEmbers && !nBurns && !this._hotPrev && !this._hotEmitFrom) return;
    for (const b of this.hotBurns) {
      b.x += ox;
      b.y += oy;
      if (b.rowLeft != null) b.rowLeft += ox;
      if (b.rowRight != null) b.rowRight += ox;
    }
    if (this._hotPrev) {
      this._hotPrev.x += ox;
      this._hotPrev.y += oy;
    }
    if (this._hotEmitFrom) {
      this._hotEmitFrom.x += ox;
      this._hotEmitFrom.y += oy;
    }
    if (nEmbers) this._dirtyFull = true;
  },
  // Hot-head: track the caret between frames, and remember where it has been.
  //
  // The burn marks: each is a patch of text the caret has occupied, with an
  // intensity that decays over time. (The caret's smoothed velocity was
  // tracked here too, for the share of it new particles inherited; nothing
  // inherits it since 1.6.4 - the fire rises where it was lit.) Fire is emitted from ALL live
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
      this.hotBurns = [];
      return;
    }
    const cx = active.x + (active.w || 0) / 2;
    const cy = active.top + (active.h || 0) / 2;
    if (!this._hotPrev) {
      this._hotPrev = { x: cx, y: cy, t: now };
      this._hotEmitFrom = { x: cx, y: cy };
      this.hotBurns = [];
      return;
    }
    if (Math.abs(cx - this._hotPrev.x) > 0.5 || Math.abs(cy - this._hotPrev.y) > 0.5) {
      this._hotActiveT = now;
    }
    const prevX = this._hotPrev.x, prevY = this._hotPrev.y;
    this._hotPrev.x = cx;
    this._hotPrev.y = cy;
    this._hotPrev.t = now;
    if (!this._hotEmitFrom) this._hotEmitFrom = { x: cx, y: cy };
    if (!this.hotBurns) this.hotBurns = [];
    const cwHere = Math.max(4, active.actualCharWidth || active.w || 8);
    const la = this.lastActive;
    const markY = la && Math.abs(la.top - active.top) > 0.5 ? la.top : active.top;
    const prevRow = this._hotPrev.row ?? prevY - (active.h || 0) / 2;
    this._hotPrev.row = markY;
    const last = this.hotBurns[this.hotBurns.length - 1];
    if (last && Math.abs(last.x - cx) < cwHere * 0.5 && Math.abs(last.y - markY) < 2) {
      last.t = now;
      last.rowLeft = active.rowLeft;
      last.rowRight = active.rowRight;
    } else {
      const dxp = cx - prevX;
      const dist = Math.abs(dxp);
      const step2 = cwHere * HOT_TRAIL_STEP_CW;
      const n = Math.abs(markY - prevRow) < 2 ? Math.min(HOT_TRAIL_PATH_MAX, Math.floor(dist / step2)) : 0;
      if (n >= 1) {
        const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
        const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
        for (let i = n; i >= 1; i--) {
          const s = i * step2 / dist;
          this.hotBurns.push({
            x: cx - dxp * s,
            y: markY,
            t: now - s * HOT_TRAIL_PATH_AGE * linger,
            rowLeft: active.rowLeft,
            rowRight: active.rowRight,
            lh: active.h || 16,
            fs: active.fontSize || 0
          });
        }
      }
      this.hotBurns.push({
        x: cx,
        y: markY,
        t: now,
        rowLeft: active.rowLeft,
        rowRight: active.rowRight,
        lh: active.h || 16,
        // Needed to place the fire relative to the GLYPHS rather than to the
        // line box - see topY in maybeSpawnHotHead. Stored per mark because a
        // mark left on a previous line has to keep that line's metrics, not
        // whatever the caret has since moved onto.
        fs: active.fontSize || 0
      });
      while (this.hotBurns.length > HOT_BURN_MAX) this.hotBurns.shift();
    }
  },
  // Whether the fire is currently being fed, i.e. the caret has moved recently
  // enough to count as working. Shared by the emitter and the frame governor:
  // the governor has to agree, or a fire that has burnt out would still pin the
  // render loop at full rate forever on the grounds that the effect is enabled.
  hotHeadFeeding(nowT) {
    return this._hotFeedingAt(this._hotActiveT, nowT);
  },
  // The same test for a caret whose state is not swapped in (a secondary's
  // bundle, read from _isAnimating without a swap).
  _hotFeedingAt(activeT, nowT) {
    const idleMs = Math.max(0, this.styleFor("hotHeadIdleMs") ?? 0);
    if (idleMs <= 0) return true;
    return nowT - (activeT || 0) <= idleMs;
  },
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
    const segLen = Math.hypot(dx, dy);
    const maxSeg = cw * 12;
    if (segLen > maxSeg) {
      const k = maxSeg / segLen;
      dx *= k;
      dy *= k;
    }
    from.x = cx;
    from.y = cy;
    const dt = Math.max(0, Math.min(0.1, (now - (this._lastHotT || now)) / 1e3));
    this._lastHotT = now;
    const spreadCw = Math.max(0, this.styleFor("hotHeadSpread") ?? 4);
    const fadeMs = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);
    const heightMul = Math.max(0.05, this.styleFor("hotHeadHeight") ?? 0.55);
    const perLength = FLAME_PER_LENGTH * ((this.styleFor("hotHeadTrail") ?? 0) / 10);
    const qtyEarly = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);
    if (qtyEarly > 0 && this._hotEngulfUntil && now < this._hotEngulfUntil) {
      const land = this.lastActive || active;
      const shapeN = HOT_BLOCK_SHAPES.length;
      const n2 = HOT_ENGULF_RATE * dt * qtyEarly;
      const count2 = Math.floor(n2) + (Math.random() < n2 % 1 ? 1 : 0);
      const w = Math.max(cw, land.w || 0);
      const x0 = land.x - cw * HOT_ENGULF_PAD_X, x1 = land.x + w + cw * HOT_ENGULF_PAD_X;
      const lfs = land.fontSize || lh * 0.62;
      const baseY = land.top + Math.max(0, (land.h || lh) - lfs) / 2 - lfs * HOT_HEAD_LIFT;
      for (let i = 0; i < count2; i++) {
        const spark = Math.random() < 0.5;
        const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul * 0.8;
        const life0 = fadeMs * (spark ? 0.15 + 0.45 * Math.random() : 0.3 + 0.5 * Math.pow(Math.random(), 2));
        const kick = hotKick(mag);
        this.flameEmbers.push({
          spark,
          fine: spark && Math.random() < HOT_FINE_CHANCE,
          x: x0 + Math.random() * (x1 - x0),
          y: baseY + (HOT_HEAD_JITTER_DOWN - Math.random() * (HOT_HEAD_JITTER_UP + HOT_HEAD_JITTER_DOWN)) * lh,
          ...kick,
          vy: kick.vy - (spark ? HOT_SPARK_RISE * 0.6 : 1) * cw * heightMul,
          shape0: Math.min(shapeN - 1, 5 + Math.floor(Math.random() * (shapeN - 6))),
          flip: Math.random() < 0.5,
          life: life0,
          life0,
          maxLife: fadeMs,
          temp: 0.6 + Math.random() * 0.4,
          cw,
          lift: heightMul * (spark ? HOT_SPARK_LIFT : 1)
        });
      }
    }
    const linger = HOT_BURN_LINGER_MS * (1 + spreadCw);
    const halfSpan = spreadCw * cw * 0.5;
    const burns = (this.hotBurns || []).filter((b) => now - b.t < linger);
    this.hotBurns = burns;
    if (!burns.length) return;
    if (!this.hotHeadFeeding(now)) return;
    const carets = 1 + Math.min(HOT_BUDGET_CARETS - 1, this._secondaries && this._secondaries.length || 0);
    const chunkCap = FLAME_MAX_NUM * carets;
    this._hotSparkCap = HOT_SPARK_MAX * carets;
    let live = 0, sparks = 0;
    for (const p of this.flameEmbers) {
      if (p.spark) sparks++;
      else live++;
    }
    this._hotSparks = sparks;
    if (live >= chunkCap) return;
    const qty = Math.max(0, this.styleFor("hotHeadQuantity") ?? 1);
    if (qty <= 0) return;
    let weightSum = 0;
    const weights = burns.map((b) => {
      const w = 1 - (now - b.t) / linger;
      const v = Math.pow(w, HOT_TRAIL_FADE_POW);
      weightSum += v;
      return v;
    });
    if (weightSum <= 0) return;
    const travelCw = Math.hypot(dx, dy) / cw;
    const spanScale = 1 + halfSpan * 2 / (cw * 6);
    const n = (FLAME_PER_SECOND * dt * spanScale * Math.min(HOT_TRAIL_EMIT_MAX, 0.55 + weightSum * 0.45) + travelCw * perLength) * qty;
    let count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    count = Math.max(0, Math.min(count, chunkCap - live));
    if (count <= 0) return;
    for (let i = 0; i < count; i++) {
      let r = Math.random() * weightSum;
      let bi = 0;
      while (bi < burns.length - 1 && (r -= weights[bi]) > 0) bi++;
      const burn = burns[bi];
      const strength = Math.max(0, 1 - (now - burn.t) / linger);
      const fs = burn.fs || lh * 0.62;
      const halfLeading = Math.max(0, (burn.lh || lh) - fs) / 2;
      const topY = burn.y + halfLeading - fs * HOT_HEAD_LIFT;
      const across = (Math.random() * 2 - 1) * halfSpan;
      const s = Math.random();
      const alongX = bi === burns.length - 1 ? -dx * (1 - s) : 0;
      let px = burn.x + alongX + across + (Math.random() - 0.5) * FLAME_SPREAD * cw;
      const py = topY + (HOT_HEAD_JITTER_DOWN - Math.random() * (HOT_HEAD_JITTER_UP + HOT_HEAD_JITTER_DOWN)) * lh;
      const rl = burn.rowLeft, rr = burn.rowRight;
      if (rl != null && rr != null) {
        const pad = cw * 0.5;
        const lo = Math.min(rl - pad, burn.x - cw * 0.5);
        const hi = Math.max(rr + pad, burn.x + cw * 0.5);
        if (hi - lo < cw * 2) {
          px = Math.min(Math.max(px, burn.x - cw * 0.5), burn.x + cw * 0.5);
        } else if (px < lo || px > hi) {
          continue;
        }
      }
      const mag = FLAME_INITIAL_VELOCITY * Math.sqrt(Math.random()) * cw * heightMul;
      const life0 = fadeMs * (HOT_LIFE_FLOOR + (1 - HOT_LIFE_FLOOR) * Math.pow(Math.random(), FLAME_LIFETIME_EXP)) * (0.7 + 0.3 * strength);
      const lifeShare = Math.max(0, Math.min(1, life0 / fadeMs));
      const shapeN = HOT_BLOCK_SHAPES.length;
      const shape0 = Math.max(0, Math.min(
        shapeN - 1,
        Math.round((1 - lifeShare) * (shapeN - 1) + (Math.random() - 0.5) * 3)
      ));
      this.flameEmbers.push({
        x: px,
        y: py,
        ...hotKick(mag),
        shape0,
        flip: Math.random() < 0.5,
        // Upstream is a bare max*rand^n. The floor is ours: with no floor a
        // large share of particles are born with a percent or two of max life
        // and die inside a frame, spending the budget on specks nobody sees.
        // The exponent still shapes the distribution; the floor just makes
        // every particle last long enough to be drawn.
        life: life0,
        life0,
        maxLife: fadeMs,
        // Older patches burn cooler, so a trail of lingering fire fades down
        // the ramp as well as thinning out.
        temp: Math.min(1, (0.55 + Math.random() * 0.45) * (0.45 + 0.55 * strength)),
        cw,
        // Buoyancy is per-particle so a change to Flame Height doesn't yank
        // everything already in the air.
        lift: heightMul
      });
      if (this._hotSparks < this._hotSparkCap) {
        const nSp = HOT_SPARKS_PER_CHUNK + (Math.random() < HOT_FINE_CHANCE ? 1 : 0);
        for (let k = 0; k < nSp; k++) {
          const fine = k >= HOT_SPARKS_PER_CHUNK;
          const kick = hotKick(FLAME_INITIAL_VELOCITY * Math.random() * cw * heightMul);
          this.flameEmbers.push({
            spark: true,
            fine,
            x: px + (Math.random() - 0.5) * cw * 0.6,
            y: py - Math.random() * lh * 0.15,
            ...kick,
            vy: kick.vy - HOT_SPARK_RISE * cw * heightMul,
            life: fadeMs * (0.15 + 0.65 * Math.random()) * (0.5 + 0.5 * strength),
            maxLife: fadeMs,
            temp: 0.5 + Math.random() * 0.5,
            cw,
            lift: heightMul * HOT_SPARK_LIFT
          });
          this._hotSparks = (this._hotSparks | 0) + 1;
        }
      }
    }
  },
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
  },
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
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1)) * Math.max(0, Math.min(1, this.styleFor("hotHeadOpacity") ?? 1));
    const maxLife = Math.max(120, this.styleFor("hotHeadFade") ?? FLAME_MAX_LIFETIME);
    const dtMs = Math.max(1, Math.min(100, now - (this._hotDrawT || now - 17)));
    this._hotDrawT = now;
    const dt = dtMs / 1e3;
    const damp = Math.exp(Math.log(1 - FLAME_DAMPING) * (dtMs / 17));
    const fontSize = active && active.fontSize || 16;
    const px = Math.max(HOT_PX_MIN, Math.min(HOT_PX_MAX, Math.round(fontSize / HOT_PX_DIVISOR)));
    const speck = Math.max(1, Math.round(px * HOT_SPECK_SCALE));
    const speckOff = Math.floor((px - speck) / 2);
    const fineSz = Math.max(1, Math.round(px * HOT_FINE_SCALE));
    const fineOff = Math.floor((px - fineSz) / 2);
    const flatMode = !!this.styleFor("hotHeadFlat");
    const heatTheFire = flatMode && this.styleFor("hotHeadSpeedHeat") && this.look.speedDemon;
    const heatQ = heatTheFire ? Math.round(Math.max(0, Math.min(1, this.heat || 0)) * 32) : -1;
    const base = heatTheFire ? this.heatColor(heatQ / 32, this.getBaseColor()) : this.getBaseColor();
    const paletteKey = base + (flatMode ? "|flat" : "");
    let palette = this._hotPalette;
    if (!palette || this._hotPaletteKey !== paletteKey) {
      this._hotPaletteKey = paletteKey;
      palette = this._hotPalette = [];
      this._hotFill = null;
      const baseHsv = rgbToHsv(hexToRgbTuple(base));
      for (let j = 0; j <= FLAME_LEVELS; j++) {
        const u = j / FLAME_LEVELS;
        if (flatMode) {
          const tinted = hsvToRgb([baseHsv[0] + u * HOT_FLAT_HUE_SPAN * 0.5, baseHsv[1], baseHsv[2]]);
          const k = u * HOT_FLAT_LIGHTEN;
          palette.push([
            Math.round(tinted[0] + (255 - tinted[0]) * k),
            Math.round(tinted[1] + (255 - tinted[1]) * k),
            Math.round(tinted[2] + (255 - tinted[2]) * k)
          ]);
        } else {
          palette.push(hexToRgbTuple(this.hotFireColor(u, base)));
        }
      }
    }
    const pal = palette;
    const fills = this._hotFill || (this._hotFill = /* @__PURE__ */ new Map());
    const fillFor = (pi, alpha) => {
      const key = pi * 1e5 + Math.round(alpha * 1e3);
      let s = fills.get(key);
      if (s === void 0) {
        const [r, g, b] = pal[pi];
        s = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        fills.set(key, s);
      }
      return s;
    };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x0, y0, w, h) => {
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x0 + w > maxX) maxX = x0 + w;
      if (y0 + h > maxY) maxY = y0 + h;
    };
    const shapeN = HOT_BLOCK_SHAPES.length;
    ctx.save();
    if (active && ctx.clip) {
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      ctx.rect(active.x, active.top, Math.max(active.w || 0, active.actualCharWidth || 0), active.h || 0);
      ctx.clip("evenodd");
    }
    this.flameEmbers = this.flameEmbers.filter((p) => {
      p.life -= dtMs;
      if (p.life <= 0) return false;
      const pcw = p.cw || 8;
      const lift = p.lift || 1;
      p.vy = (p.vy + (FLAME_BUOYANCY * lift + FLAME_RANDOM_VELOCITY * HOT_TURB_Y * (Math.random() - 0.5)) * pcw * dt) * damp;
      p.vx = p.vx * damp + FLAME_RANDOM_VELOCITY * HOT_TURB_X * (Math.random() - 0.5) * pcw * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.sw) {
        const age = (p.age || 0) + dtMs;
        p.age = age;
        const reach = p.sw * pcw * Math.min(1, age / HOT_SWAY_GROW_MS);
        const so = reach * Math.sin(2 * Math.PI * (p.sf || HOT_SWAY_HZ) * age / 1e3 + (p.sp || 0));
        p.x += so - (p.so || 0);
        p.so = so;
      }
      const frac = Math.max(0, Math.min(1, p.life / (p.maxLife || maxLife)));
      const temp = hotQuant((p.temp || 1) * Math.pow(frac, HOT_TEMP_GAMMA), HOT_COLOR_LEVELS) * HOT_TEMP_MAX;
      const pi = Math.round(temp * FLAME_LEVELS);
      if (p.spark) {
        const q2 = hotQuant(frac, HOT_ALPHA_LEVELS);
        if (q2 <= 0) return true;
        const alpha2 = (p.fine ? 0.15 + 0.35 * q2 : 0.2 + 0.5 * q2) * opacity;
        ctx.fillStyle = fillFor(pi, alpha2);
        const sz = p.fine ? fineSz : speck, off = p.fine ? fineOff : speckOff;
        const sx = Math.floor(p.x / px) * px + off, sy = Math.floor(p.y / px) * px + off;
        ctx.fillRect(sx, sy, sz, sz);
        grow(sx, sy, sz, sz);
        return true;
      }
      if (frac <= HOT_STAGE_PIXEL) {
        const q2 = hotQuant(frac / HOT_STAGE_PIXEL, HOT_ALPHA_LEVELS);
        if (q2 <= 0) return true;
        const alpha2 = (0.15 + 0.25 * q2) * opacity;
        ctx.fillStyle = fillFor(pi, alpha2);
        const dx0 = Math.floor(p.x / px) * px + speckOff, dy0 = Math.floor(p.y / px) * px + speckOff;
        ctx.fillRect(dx0, dy0, speck, speck);
        grow(dx0, dy0, speck, speck);
        return true;
      }
      const gone = Math.pow(1 - Math.max(0, Math.min(1, p.life / (p.life0 || p.maxLife || maxLife))), HOT_SHAPE_EASE);
      const shape0 = p.shape0 ?? 0;
      const idx = Math.min(shapeN - 1, shape0 + Math.floor(gone * (shapeN - shape0)));
      const rows = HOT_BLOCK_SHAPES[idx];
      const h = rows.length;
      let area = 0;
      for (const row of rows) for (let i = 0; i < row.length; i++) if (row[i] === "1") area++;
      const stage = hotShapeStage(area);
      const q = hotQuant((frac - HOT_STAGE_PIXEL) / (1 - HOT_STAGE_PIXEL), HOT_ALPHA_LEVELS);
      if (q <= 0) return true;
      const alpha = (stage >= 3 ? 0.7 + 0.25 * q : stage >= 2 ? 0.6 + 0.25 * q : 0.45 + 0.25 * q) * opacity;
      ctx.fillStyle = fillFor(pi, alpha);
      const gx = Math.floor(p.x / px);
      const gy = Math.floor(p.y / px);
      ctx.beginPath();
      for (let ri = 0; ri < h; ri++) {
        const row = rows[ri];
        const w = row.length;
        let i = 0;
        while (i < w) {
          if (row[i] !== "1") {
            i++;
            continue;
          }
          let j = i;
          while (j < w && row[j] === "1") j++;
          const c0 = p.flip ? w - j : i;
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
      this._markDirty(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
    }
  }
};

// src/effects-pops.ts
var effectsPopsMethods = {
  spawnLetterParticle(char, anchor) {
    if (!char.trim()) return;
    let color = this.getActiveColor() || anchor.textColor;
    if (this.styleFor("popRainbow")) {
      color = hslToRgbString(this.nextRainbowHue(), 0.85, 0.6);
    }
    this.particles.push({
      char,
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
  },
  drawLettersParticles() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    this.particles = this.particles.filter((p) => {
      const elapsed = (now - p.start) / 1e3;
      if (elapsed > 0.45) return false;
      const t = elapsed / 0.45;
      p.alpha = 1 - t;
      const curX = p.x + p.vx * elapsed;
      const curY = p.y + p.vy * elapsed + 0.5 * 320 * elapsed * elapsed;
      const curRot = p.rotation * elapsed * 5;
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
  },
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
    if (dist < JUMP_TRAIL_MIN_DIST) return;
    const dur = Math.max(60, Math.min(600, this.look.crtGlitchMs ?? 220));
    const reach = Math.min(2.2, 0.7 + dist / 420);
    this.glitch = {
      start: performance.now(),
      dur,
      reach,
      seed: Math.random() * 2147483647 | 0
    };
  },
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
    const env = (1 - p) * (1 - p);
    const bucket = Math.floor((now - g.start) / 45);
    const strength = Math.max(0, Math.min(2.5, this.look.crtGlitchStrength ?? 1));
    const aberr = Math.max(0, Math.min(3, this.look.crtGlitchAberration ?? 1));
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
      strength
    };
  },
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
    const slices = Math.max(3, Math.min(12, Math.round(h / 3)));
    const sh = h / slices;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < slices; i++) {
      const n1 = glitchNoise(gs.seed, i, gs.bucket);
      const n2 = glitchNoise(gs.seed + 101, i, gs.bucket);
      const n3 = glitchNoise(gs.seed + 977, i, gs.bucket);
      if (n3 < 0.13 * gs.env) continue;
      const d = (n1 - 0.5) * 2;
      const dx = d * d * d * gs.amp;
      const wScale = 1 + (n2 - 0.5) * 0.55 * gs.strength * gs.env;
      const sw = Math.max(1, w * wScale);
      const sx = x + dx - (sw - w) / 2;
      const sy = y + i * sh;
      const drawH = sh + 0.5;
      if (gs.ab > 0.05) {
        ctx.fillStyle = `rgba(${R}, 0, 0, ${alpha})`;
        ctx.fillRect(sx - gs.ab, sy, sw, drawH);
        ctx.fillStyle = `rgba(0, ${G}, 0, ${alpha})`;
        ctx.fillRect(sx, sy, sw, drawH);
        ctx.fillStyle = `rgba(0, 0, ${B}, ${alpha})`;
        ctx.fillRect(sx + gs.ab, sy, sw, drawH);
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = `rgba(${R}, ${G}, ${B}, ${alpha})`;
        ctx.fillRect(sx, sy, sw, drawH);
        ctx.globalCompositeOperation = "lighter";
      }
    }
    if (glitchNoise(gs.seed + 5501, 0, gs.bucket) < 0.55) {
      const ly = y + glitchNoise(gs.seed + 31, 1, gs.bucket) * h;
      const lw = w * (1.2 + glitchNoise(gs.seed + 77, 2, gs.bucket) * 1.6);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.55 * gs.env})`;
      ctx.fillRect(x - (lw - w) / 2, ly, lw, Math.max(1, h * 0.06));
    }
    ctx.restore();
  },
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
  nextRainbowHue(step2 = 33) {
    const hue = this._popRainbowHue;
    this._popRainbowHue = (hue + step2) % 360;
    return hue;
  },
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
      Math.max(0, Math.min(255, Math.round(b + (Math.random() - 0.5) * 76)))
    ];
  },
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
  },
  spawnFireworks(target) {
    if (!this.look.popEffects || !this.look.fireworks) return;
    if (!target) return;
    const now = performance.now();
    if (now - this._lastFireworkT < FIREWORK_MIN_GAP_MS) return;
    const q = Math.max(0.2, Math.min(3, this.look.fireworksQuantity ?? 1));
    const shells = Math.max(1, Math.min(3, Math.round(q)));
    const wanted = Math.max(4, Math.round(12 * q));
    const liveSparks = this._liveSparkCount();
    const roomTotal = FIREWORK_SPARK_BUDGET - liveSparks;
    if (roomTotal < FIREWORK_SPARK_MIN) return;
    this._lastFireworkT = now;
    const pressure = liveSparks / FIREWORK_SPARK_BUDGET;
    const rich = pressure < FIREWORK_PRESSURE;
    const lh = target.h || 16;
    const w = target.w || target.actualCharWidth || 8;
    const x0 = target.x + w / 2;
    const y0 = target.top;
    const clipTop = this._clipTop ?? 0;
    const fallSec = FIREWORK_FALL_MS / 1e3;
    const base = this.styleFor("popRainbow") ? hslToRgbTuple(this.nextRainbowHue(), 0.85, 0.62) : null;
    for (let i = 0; i < shells; i++) {
      if (this.fireworks.length >= FIREWORK_MAX_LIVE) break;
      const share = Math.floor((FIREWORK_SPARK_BUDGET - this._liveSparkCount()) / (shells - i));
      if (share < FIREWORK_SPARK_MIN) break;
      const sparkCount = Math.max(FIREWORK_SPARK_MIN, Math.min(wanted, share));
      const rise = lh * (FIREWORK_RISE_LINES + (Math.random() - 0.5) * 2 * FIREWORK_RISE_JITTER);
      const bx = x0 + (Math.random() - 0.5) * 2 * FIREWORK_DRIFT;
      const by = Math.min(
        y0 - lh * 0.9,
        Math.max(y0 - rise, clipTop + lh * 0.5)
      );
      const palN = Math.max(2, Math.min(FIREWORK_PALETTE_MAX, Math.ceil(sparkCount / 3)));
      const palette = [];
      for (let c = 0; c < palN; c++) {
        const [r, g, b] = this.fireworkSparkRGB(base);
        palette.push(`rgb(${r}, ${g}, ${b})`);
      }
      const sparks = [];
      let maxReach = 0;
      for (let s = 0; s < sparkCount; s++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = lh * (3.4 + Math.random() * 6.2);
        const size = FIREWORK_CELL * (Math.random() < 0.22 ? 2 : 1);
        sparks.push({
          ang,
          speed,
          size,
          ci: Math.random() * palN | 0,
          // Twinkle phase and rate, rolled once. Rolling per frame would be
          // noise rather than a flicker, for the same reason the thunderbolt
          // generates its jitter once.
          tw: Math.random() * Math.PI * 2,
          tr: 9 + Math.random() * 14
        });
        if (speed > maxReach) maxReach = speed;
      }
      sparks.sort((a, b) => a.ci - b.ci);
      const secondaries = [];
      if (rich && sparkCount >= 8) {
        const nSec = Math.min(FIREWORK_SECOND_MAX, Math.max(1, Math.round(sparkCount / 10)));
        for (let n = 0; n < nSec; n++) {
          const parent = sparks[Math.random() * sparks.length | 0];
          const at = FIREWORK_SECOND_AT[0] + Math.random() * (FIREWORK_SECOND_AT[1] - FIREWORK_SECOND_AT[0]);
          const kids = [];
          for (let s = 0; s < FIREWORK_SECOND_SPARKS; s++) {
            kids.push({
              ang: Math.random() * Math.PI * 2,
              speed: lh * (1.1 + Math.random() * 2),
              size: FIREWORK_CELL,
              ci: Math.random() * palN | 0,
              tw: Math.random() * Math.PI * 2,
              tr: 12 + Math.random() * 16
            });
          }
          kids.sort((a, b) => a.ci - b.ci);
          secondaries.push({ ang: parent.ang, speed: parent.speed, at, sparks: kids });
        }
      }
      const spread = maxReach * fallSec;
      const drop = 0.5 * FIREWORK_GRAVITY * fallSec * fallSec;
      const secReach = secondaries.length ? maxReach * fallSec + lh * 3.1 * fallSec : 0;
      const reach = Math.max(spread, secReach);
      this.fireworks.push({
        x0,
        y0,
        bx,
        by,
        sparks,
        palette,
        secondaries,
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
        start: now
      });
    }
  },
  drawFireworks() {
    if (!this.fireworks.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const cell = FIREWORK_CELL;
    const snap = (v) => Math.round(v / cell) * cell;
    const fallSec = FIREWORK_FALL_MS / 1e3;
    this.fireworks = this.fireworks.filter((fw) => {
      const age = now - fw.start;
      if (age < fw.delay) return true;
      const t = age - fw.delay;
      if (t >= fw.riseMs + fw.fallMs) return false;
      ctx.save();
      if (t < fw.riseMs) {
        const p = t / fw.riseMs;
        const e = 1 - (1 - p) * (1 - p);
        const cx = snap(fw.x0 + (fw.bx - fw.x0) * e);
        const cy = snap(fw.y0 + (fw.by - fw.y0) * e);
        const a = FIREWORK_ALPHA * opacity * Math.min(1, p * 5);
        const dx = (fw.bx - fw.x0) / (fw.riseMs || 1);
        const dy = (fw.by - fw.y0) / (fw.riseMs || 1);
        const len = Math.hypot(dx, dy) || 1;
        for (let k = 2; k >= 1; k--) {
          ctx.fillStyle = `rgba(255, 255, 255, ${a * (0.18 / k)})`;
          ctx.fillRect(
            snap(cx - dx / len * cell * 2 * k),
            snap(cy - dy / len * cell * 2 * k),
            cell,
            cell
          );
        }
        ctx.fillStyle = `rgba(255, 245, 220, ${a})`;
        ctx.fillRect(cx, cy, cell, cell);
      } else {
        const u = (t - fw.riseMs) / fw.fallMs;
        const el = u * fallSec;
        const a = FIREWORK_ALPHA * opacity * Math.max(0, 1 - u * u);
        if (a > 0.01) {
          const tw = u > FIREWORK_TWINKLE_AT;
          const drawSet = (list, ox, oy, sc, alpha) => {
            let ci = -1;
            for (const s of list) {
              if (tw && Math.sin(s.tw + u * s.tr) < -0.35) continue;
              if (s.ci !== ci) {
                ci = s.ci;
                ctx.fillStyle = fw.palette[ci];
              }
              const vx = Math.cos(s.ang) * s.speed;
              const vy = Math.sin(s.ang) * s.speed;
              const tail = s.size > FIREWORK_CELL ? fw.trail : 0;
              for (let k = tail; k >= 1; k--) {
                const bt = Math.max(0, sc - k * 0.035);
                ctx.globalAlpha = alpha * (0.3 / k);
                ctx.fillRect(
                  snap(ox + vx * bt),
                  snap(oy + vy * bt + 0.5 * FIREWORK_GRAVITY * bt * bt),
                  FIREWORK_CELL,
                  FIREWORK_CELL
                );
              }
              ctx.globalAlpha = alpha;
              ctx.fillRect(
                snap(ox + vx * sc),
                snap(oy + vy * sc + 0.5 * FIREWORK_GRAVITY * sc * sc),
                s.size,
                s.size
              );
            }
          };
          drawSet(fw.sparks, fw.bx, fw.by, el, a);
          for (const sec of fw.secondaries) {
            if (u <= sec.at) continue;
            const pt = sec.at * fallSec;
            const px = fw.bx + Math.cos(sec.ang) * sec.speed * pt;
            const py = fw.by + Math.sin(sec.ang) * sec.speed * pt + 0.5 * FIREWORK_GRAVITY * pt * pt;
            const ct = el - pt;
            const cu = (u - sec.at) / Math.max(1e-3, 1 - sec.at);
            const ca = a * Math.max(0, 1 - cu);
            if (ca > 0.01) drawSet(sec.sparks, px, py, ct, ca);
          }
          ctx.globalAlpha = 1;
        }
        const flash = 1 - Math.min(1, u / 0.18);
        if (flash > 0) {
          const size = fw.flash * (0.4 + flash);
          ctx.fillStyle = `rgba(255, 252, 240, ${FIREWORK_ALPHA * opacity * flash * 0.5})`;
          ctx.fillRect(snap(fw.bx - size / 2), snap(fw.by - size / 2), size, size);
        }
      }
      ctx.restore();
      const pad = cell * 3 + fw.flash;
      this._markDirty(
        fw.minX - pad,
        fw.minY - pad,
        fw.maxX - fw.minX + pad * 2,
        fw.maxY - fw.minY + pad * 2
      );
      return true;
    });
  },
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
    if (!this.look.popEffects || !this.look.thunderstrike) return;
    if (!target) return;
    while (this.thunderbolts.length >= THUNDER_MAX_LIVE) this.thunderbolts.shift();
    const w = target.w || target.actualCharWidth || 8;
    const tx = target.x + w / 2;
    const ty = target.top;
    const angle = (Math.random() - 0.5) * 2 * THUNDER_MAX_ANGLE;
    const clipTop = this._clipTop ?? 0;
    const rise = Math.max(THUNDER_MIN_REACH, ty - clipTop + 80);
    const reach = rise / Math.max(0.35, Math.cos(angle));
    const ox = tx + Math.sin(angle) * reach;
    const oy = ty - Math.cos(angle) * reach;
    const cell = Math.max(1, Math.round(this.look.thunderstrikeSize ?? 2));
    const jitter = reach * 0.09;
    const seen = /* @__PURE__ */ new Set();
    const main = this.boltPath(ox, oy, tx, ty, jitter);
    let cells = this.pixelateBolt(main, cell, seen, 0, 1);
    const forks = (Math.random() < 0.75 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
    for (let f = 0; f < forks; f++) {
      const ft = 0.15 + Math.random() * 0.4;
      const at = main[Math.floor(main.length * ft)];
      if (!at) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      const spread = Math.max(-1.1, Math.min(1.1, angle + side * (0.45 + Math.random() * 0.55)));
      const len = reach * (0.15 + Math.random() * 0.18);
      const fx = at.x + Math.sin(spread) * len;
      const fy = at.y + Math.cos(spread) * len;
      cells = cells.concat(this.pixelateBolt(
        this.boltPath(at.x, at.y, fx, fy, len * 0.16),
        cell,
        seen,
        ft,
        Math.min(1, ft + 0.3)
      ));
    }
    cells = cells.filter((c) => c.y >= clipTop - cell);
    if (!cells.length) return;
    const ramp = thunderRamp(this.styleFor("popRainbow") ? this.nextRainbowHue() : null);
    const bands = [];
    for (let i = 0; i < THUNDER_BANDS; i++) {
      const [br, bg, bb] = thunderColorAt(ramp, i / (THUNDER_BANDS - 1));
      bands.push({
        r: br,
        g: bg,
        b: bb,
        cr: lighten(br, 0.45),
        cg: lighten(bg, 0.45),
        cb: lighten(bb, 0.45),
        cells: []
      });
    }
    for (const c of cells) {
      const i = Math.max(0, Math.min(THUNDER_BANDS - 1, Math.round(c.t * (THUNDER_BANDS - 1))));
      bands[i].cells.push(c);
    }
    const usedBands = bands.filter((x) => x.cells.length > 0);
    const [er, eg, eb] = thunderColorAt(ramp, 1);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    this.thunderbolts.push({
      bands: usedBands,
      cell,
      tx,
      ty,
      minX,
      minY,
      maxX,
      maxY,
      // The impact flash is sized off the caret, not off the block size: at the
      // finest setting a flash a few blocks wide would be invisible, and the
      // strike has to be seen to land.
      flash: Math.max(cell * 2, (target.h || 16) * 0.4),
      er,
      eg,
      eb,
      // Real lightning is several discharges down the same channel, so the
      // bolt steps between discrete brightness levels instead of fading
      // smoothly. Rolled at spawn, because a per-frame random would beat
      // against the frame rate and turn a strobe into mush. The first step is
      // forced to full: the moment of the strike is the brightest. The floor is
      // high (0.6 rather than near-zero) so the strobe reads as a shimmer down
      // the channel rather than as the bolt switching on and off.
      flicker: Array.from({ length: 8 }, (_, i) => i === 0 ? 1 : 0.6 + Math.random() * 0.4),
      start: performance.now()
    });
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
        start: performance.now()
      });
    }
  },
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
        next.push({ x: (a.x + b.x) / 2 + -dy / len * off, y: (a.y + b.y) / 2 + dx / len * off });
        next.push(b);
      }
      pts = next;
      amp *= 0.55;
    }
    return pts;
  },
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
      const steps = Math.max(1, Math.ceil(dist / (cell * 0.7)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const gx = Math.round((a.x + (b.x - a.x) * t) / cell) * cell;
        const gy = Math.round((a.y + (b.y - a.y) * t) / cell) * cell;
        const key = gx + "," + gy;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: gx, y: gy, t: t0 + (i - 1 + t) / segs * (t1 - t0) });
      }
    }
    return out;
  },
  drawThunderbolts() {
    if (!this.thunderbolts.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const strength = Math.max(0.1, Math.min(1, this.look.thunderstrikeStrength ?? 0.5));
    const halo = !!this.look.glow;
    this.thunderbolts = this.thunderbolts.filter((b) => {
      const t = (now - b.start) / THUNDER_LIFE_MS;
      if (t >= 1) return false;
      const fade = t < 0.12 ? 1 : 1 - (t - 0.12) / 0.88;
      const step2 = Math.min(b.flicker.length - 1, Math.floor(t * b.flicker.length));
      const alpha = Math.max(0, fade * b.flicker[step2] * opacity * strength);
      if (alpha <= 0.02) return true;
      const cell = b.cell;
      ctx.save();
      if (halo) {
        const pad2 = Math.max(1, cell * 0.75);
        for (const band of b.bands) {
          ctx.fillStyle = `rgba(${band.r}, ${band.g}, ${band.b}, ${alpha * 0.16})`;
          for (const c of band.cells) ctx.fillRect(c.x - pad2, c.y - pad2, cell + pad2 * 2, cell + pad2 * 2);
        }
      }
      for (const band of b.bands) {
        ctx.fillStyle = `rgba(${band.cr}, ${band.cg}, ${band.cb}, ${alpha})`;
        for (const c of band.cells) ctx.fillRect(c.x, c.y, cell, cell);
      }
      const flash = 1 - Math.min(1, t / 0.4);
      if (flash > 0) {
        const size = b.flash * (0.5 + flash);
        ctx.fillStyle = `rgba(${lighten(b.er, 0.45)}, ${lighten(b.eg, 0.45)}, ${lighten(b.eb, 0.45)}, ${alpha * flash * 0.4})`;
        ctx.fillRect(b.tx - size / 2, b.ty - size / 2, size, size);
      }
      ctx.restore();
      const pad = Math.max(8, cell * 3) + b.flash;
      this._markDirty(
        b.minX - pad,
        b.minY - pad,
        b.maxX - b.minX + cell + pad * 2,
        b.maxY - b.minY + cell + pad * 2
      );
      return true;
    });
  }
};

// src/effects-dust.ts
var effectsDustMethods = {
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
    if (!forceBase && this.look.flameTrailGradientColors && this.look.gradientEnabled) {
      [r, g, b] = this.sampleRamp(Math.random());
      if (disintegrate) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }
    } else {
      [r, g, b] = baseRGB;
    }
    const varR = Math.max(0, Math.min(255, Math.round(r + (Math.random() - 0.5) * 70)));
    const varG = Math.max(0, Math.min(255, Math.round(g + (Math.random() - 0.5) * 70)));
    const varB = Math.max(0, Math.min(255, Math.round(b + (Math.random() - 0.5) * 70)));
    return `rgb(${varR}, ${varG}, ${varB})`;
  },
  spawnFlamePixels(anchor, disintegrate = false) {
    if (!disintegrate && !this.look.flameTrail) return;
    const density = Math.max(0, this.look.flameTrailDensity ?? 1);
    if (density <= 0 && !disintegrate) return;
    const baseCount = disintegrate ? Math.floor(10 + Math.random() * 8) : Math.floor(6 + Math.random() * 6);
    const count = disintegrate ? baseCount : Math.round(baseCount * density);
    if (count <= 0) return;
    const lifeSec = Math.max(0.05, (this.look.flameTrailLifeMs ?? 400) / 1e3);
    let baseHex = this.getActiveColor() || "#39ff14";
    let h = baseHex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    let r = parseInt(h, 16) >> 16 & 255;
    let g = parseInt(h, 16) >> 8 & 255;
    let b = parseInt(h, 16) & 255;
    const popRainbow = disintegrate && !!this.look.popEffects && !!this.look.popRainbow;
    if (popRainbow) {
      [r, g, b] = hslToRgbTuple(this.nextRainbowHue(), 0.85, 0.6);
    }
    if (disintegrate) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    const baseRGB = [r, g, b];
    const pxBase = Math.max(1, this.look.flameTrailPixelSize ?? 4);
    const anchorW = anchor.w || anchor.actualCharWidth || 8;
    const cx = anchor.x + anchorW / 2;
    const cy = anchor.top + anchor.h / 2;
    for (let i = 0; i < count; i++) {
      const pX = anchor.x + Math.random() * anchorW;
      const pY = anchor.top + Math.random() * anchor.h;
      const color = this.flamePixelColor(baseRGB, disintegrate, popRainbow);
      let vx, vy;
      if (disintegrate) {
        const dx = pX - cx;
        const dy = pY - cy;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 30 + Math.random() * 25;
        vx = dx / len * speed;
        vy = dy / len * speed - 10;
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
        trail: true
      });
    }
  },
  spawnJumpTrail(from, to) {
    if (!this.look.flameTrail || !from || !to) return;
    const density = Math.max(0, this.look.flameTrailDensity ?? 1);
    if (density <= 0) return;
    const fw = from.w || from.actualCharWidth || 8;
    const tw = to.w || to.actualCharWidth || 8;
    const x0 = from.x + fw / 2, y0 = from.top + (from.h || 16) / 2;
    const x1 = to.x + tw / 2, y1 = to.top + (to.h || 16) / 2;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < JUMP_TRAIL_MIN_DIST) return;
    const puffs = Math.min(JUMP_TRAIL_MAX_PUFFS, Math.floor(dist / JUMP_TRAIL_STEP));
    if (puffs <= 0) return;
    let baseHex = this.getActiveColor() || "#39ff14";
    let h = baseHex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const int = parseInt(h, 16);
    const baseRGB = [int >> 16 & 255, int >> 8 & 255, int & 255];
    const lifeSec = Math.max(0.05, (this.look.flameTrailLifeMs ?? 400) / 1e3);
    const now = performance.now();
    const perPuff = Math.max(1, Math.round(2 * Math.min(1.5, density)));
    const lineH = ((from.h || 16) + (to.h || 16)) / 2;
    const pxBase = Math.max(1, this.look.flameTrailPixelSize ?? 4) * 0.8;
    for (let i = 1; i <= puffs; i++) {
      const s = i / (puffs + 1);
      const px = x0 + (x1 - x0) * s;
      const py = y0 + (y1 - y0) * s;
      for (let j = 0; j < perPuff; j++) {
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
          trail: true
        });
      }
    }
  },
  drawFlamePixels() {
    if (!this.flamePixels.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const trailAmt = Math.max(0, this.styleFor("speedDemonSparkTrail") || 0);
    const gStrength = Math.max(0, Math.min(1, this.look.flameTrailGravity ?? 0));
    let gx = 0, gy = 0;
    if (gStrength > 0) {
      const mag = gStrength * 900;
      const rad = (this.look.flameTrailGravityAngle ?? 0) * Math.PI / 180;
      gx = Math.sin(rad) * mag;
      gy = Math.cos(rad) * mag;
    }
    ctx.save();
    this.flamePixels = this.flamePixels.filter((p) => {
      const life = p.life || 0.4;
      const elapsed = (now - p.start) / 1e3;
      if (elapsed > life) return false;
      const t = elapsed / life;
      p.alpha = 1 - Math.pow(t, 2);
      const pgx = p.trail ? gx : 0;
      const pgy = p.trail ? gy : 0;
      const curX = p.x + p.vx * elapsed + pgx * 0.5 * elapsed * elapsed;
      const curY = p.y + p.vy * elapsed + pgy * 0.5 * elapsed * elapsed;
      ctx.globalAlpha = Math.max(0, p.alpha);
      if (p.spark && trailAmt > 0) {
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const dirX = p.vx / speed;
        const dirY = p.vy / speed;
        const tailLen = trailAmt * (0.5 + Math.min(1, speed / 45) * 0.5);
        const tailX = curX - dirX * tailLen;
        const tailY = curY - dirY * tailLen;
        const lw = Math.max(1, p.size * 0.85);
        this._markDirty(
          Math.min(curX, tailX) - lw,
          Math.min(curY, tailY) - lw,
          Math.abs(tailX - curX) + lw * 2,
          Math.abs(tailY - curY) + lw * 2
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
      return true;
    });
    ctx.restore();
  },
  // ---- Stardust ----------------------------------------------------------
  // Whether the effect is switched on AND currently emitting. Split out from
  // maybeSpawnStardust() because the frame governor needs the same answer: an
  // armed-but-not-yet-emitting cursor still has to be woken often enough to
  // emit on time, or the first mote would wait out an idle heartbeat.
  stardustArmed() {
    const s = this.look;
    if (!s.stardustEnabled) return false;
    if (!this.animActive) return false;
    if (s.stardustAlwaysOn) return true;
    const idleFor = performance.now() - (this._lastActivityT || 0);
    return idleFor >= Math.max(0, s.stardustDelayMs ?? 2e3);
  },
  // Emit a slow stream of drifting motes from the caret while it sits idle.
  //
  // Rate-limited by wall clock rather than per frame: the governor runs this
  // at ~30fps while stardust is alive but drops to ~5fps in the gaps, so a
  // per-frame probability would quietly change density with the gear.
  maybeSpawnStardust() {
    if (!this.stardustArmed()) return;
    if (this.stardust.length >= STARDUST_MAX_PER_CARET * (1 + (this._secondaries ? this._secondaries.length : 0))) return;
    const now = performance.now();
    const rate = Math.max(0.1, this.look.stardustRate ?? 1);
    if (now - (this._lastStardustT || 0) < 320 / rate) return;
    this._lastStardustT = now;
    const active = this.animActive;
    if (!active) return;
    const anchorW = active.w || active.actualCharWidth || 8;
    const [sr, sg, sb] = this.sampleRamp(Math.random());
    const vary = (c) => Math.max(0, Math.min(255, Math.round(c + (Math.random() - 0.5) * 50)));
    const orbit = !!this.look.stardustOrbit;
    const meanRadius = Math.max(6, this.look.stardustOrbitRadius ?? 22);
    this.stardust.push({
      // Spawn across the caret's width, biased to its upper half - the motes
      // read as coming off the cursor rather than out of the line below it.
      x: active.x + Math.random() * anchorW,
      y: active.top + Math.random() * active.h * 0.6,
      vy: -8 - Math.random() * 14,
      // px/sec: slow upward drift
      sway: 2 + Math.random() * 5,
      // px of horizontal wander
      swaySpeed: 0.6 + Math.random() * 0.9,
      // rad/sec of that wander
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 2 + Math.random() * 3,
      size: 1 + Math.random() * 1.5,
      life: 2.2 + Math.random() * 2.2,
      // seconds
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
      squash: 0.45 + Math.random() * 0.4
    });
  },
  // Age and paint the idle motes.
  //
  // All motion is derived from `elapsed` rather than integrated per frame, the
  // same way flame pixels work, which matters more here than anywhere else in
  // the file: stardust is the one effect that routinely runs at the WARM gear
  // (~30fps) and lives for seconds, so a per-frame step would visibly change
  // both drift speed and lifetime with the gear.
  drawStardust() {
    if (!this.stardust.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    ctx.save();
    this.stardust = this.stardust.filter((p) => {
      const elapsed = (now - p.start) / 1e3;
      if (elapsed > p.life) return false;
      const t = elapsed / p.life;
      const envelope = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      const twinkle = 0.72 + 0.28 * Math.sin(elapsed * p.twinkleSpeed + p.phase);
      const alpha = Math.max(0, envelope * twinkle * opacity);
      if (alpha <= 0.01) return true;
      if (p.orbit) {
        const anchor = p.owner ? p.owner.animActive : this.animActive;
        if (anchor) {
          p.ax = anchor.x + (anchor.w || anchor.actualCharWidth || 8) / 2;
          p.ay = anchor.top + anchor.h / 2;
        }
        const ang = p.phase + elapsed * p.angSpeed;
        const r = p.radius * (1 + Math.sin(elapsed * p.wobbleSpeed + p.phase) * 0.15);
        return this.paintMote(p, p.ax + Math.cos(ang) * r, p.ay + Math.sin(ang) * r * p.squash, alpha);
      }
      const curX = p.x + Math.sin(elapsed * p.swaySpeed + p.phase) * p.sway;
      const curY = p.y + p.vy * elapsed;
      return this.paintMote(p, curX, curY, alpha);
    });
    ctx.restore();
  },
  // Shared tail of drawStardust for both motion modes: paint one mote and
  // report the pixels it touched.
  paintMote(p, x, y, alpha) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, p.size, p.size);
    this._markDirty(x - 1, y - 1, p.size + 2, p.size + 2);
    return true;
  }
};

// src/effects-trail.ts
var effectsTrailMethods = {
  // Record `point` (the position being left) as a CRT trail ghost. If `dest` is
  // given and the move from point→dest is a jump, also lay intermediate ghosts
  // along that path so the trail is a continuous streak across the leap instead
  // of two dots with a gap. `dest` itself is NOT recorded here - it becomes the
  // live caret and gets its own ghost on the next move - only the bridge between
  // them is filled.
  pushTrail(point, dest = null) {
    if (!point || !this.look.crtEffect) return;
    const now = performance.now();
    const max = Math.max(0, Math.round(this.look.trailLength));
    this.trail.push({ x: point.x, y: point.top, w: point.w, h: point.h, t: now });
    if (dest && this.look.crtEffect && this.look.crtNeon && max > 1) {
      const dx = dest.x - point.x;
      const dy = dest.top - point.top;
      const dist = Math.hypot(dx, dy);
      if (dist >= JUMP_TRAIL_MIN_DIST) {
        const steps = Math.min(
          JUMP_TRAIL_MAX_PUFFS,
          max,
          Math.floor(dist / JUMP_TRAIL_STEP)
        );
        for (let i = 1; i <= steps; i++) {
          const s = i / (steps + 1);
          this.trail.push({
            x: point.x + dx * s,
            y: point.top + dy * s,
            w: dest.w,
            h: dest.h,
            t: now + s * 10
          });
        }
      }
    }
    while (this.trail.length > max) this.trail.shift();
  },
  // Age out expired trail points.
  //
  // This deliberately lives in the update phase, NOT inside draw(), and is
  // deliberately NOT gated on crtEffect. It used to be the first two lines of
  // forEachTrailPoint(), which is wrong twice over:
  //
  //   1. forEachTrailPoint() early-returns when crtEffect is off, and until
  //      1.5.8 pushTrail() ran from commitMove() on every caret move
  //      regardless of that setting (it is gated on it now). With the trail
  //      effect disabled - the default - the array filled to trailLength and
  //      was never pruned by age at all, only evicted by newer entries.
  //      trail.length stayed pinned at 10 forever after the first ten
  //      keystrokes.
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
    const fade = Math.max(50, this.look.trailFadeMs);
    this.trail = this.trail.filter((p) => now - p.t < fade);
  },
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
    if (!this.look.crtNeon) {
      ctx.shadowBlur = 0;
      return this.cursorPaint(p.x, p.y, p.w, p.h, flatColor, alpha);
    }
    let r, g, b;
    if (this.look.crtNeonGradient && this.look.gradientEnabled) {
      [r, g, b] = this.sampleRamp(1 - age);
    } else {
      [r, g, b] = hexToRgbTuple(flatColor || "#39ff14");
    }
    const nr = Math.round(r + (255 - r) * 0.35);
    const ng = Math.round(g + (255 - g) * 0.35);
    const nb = Math.round(b + (255 - b) * 0.35);
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha * 2)})`;
    ctx.shadowBlur = 12;
    return `rgba(${nr}, ${ng}, ${nb}, ${Math.min(1, alpha * 1.3)})`;
  },
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
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.6)})`;
      this.fillTrailRect(ctx, r.x + (r.w - coreW) / 2, r.y, coreW, r.h);
    }
  },
  // Emit small upward-rising fire embers when heat is high enough.
  // Rate scales with heat so mid-heat is a lazy simmer and full heat is
  // a proper flame. Cap total live sparks to keep the canvas fill-rate
  // sane even when the user is chugging (each spark is a small fillRect,
  // so it's not free).
  maybeSpawnSpeedDemonSparks() {
    if (this.heat < 0.4) return;
    if (this.flamePixels.length > 120) return;
    const now = performance.now();
    const gap = 70 - 55 * this.heat;
    if (now - this._lastSparkT < gap) return;
    this._lastSparkT = now;
    const active = this.animActive;
    if (!active) return;
    const anchorW = active.w || active.actualCharWidth || 8;
    const baseCount = 1 + Math.floor(this.heat * 3);
    const qty = Math.max(0, this.styleFor("speedDemonSparkQuantity") ?? 1);
    const count = Math.round(baseCount * qty);
    const heatCol = this.heatColor(Math.min(1, this.heat + 0.1), this.getBaseColor());
    const [hr, hg, hb] = hexToRgbTuple(heatCol);
    for (let i = 0; i < count; i++) {
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
        size: 1.5 + Math.random() * 2,
        // smaller than backspace/normal pixels
        color: `rgb(${varR}, ${varG}, ${varB})`,
        // Cached numeric channels alongside `color`: the trail gradient in
        // drawFlamePixels needs r/g/b at custom alphas every frame, and
        // re-deriving them from the formatted string via regex each time
        // (for every live spark, every frame) is needless work when we
        // already have the numbers right here at spawn time.
        r: varR,
        g: varG,
        b: varB,
        alpha: 1,
        start: now,
        // Marks this particle as a Speed Demon spark (as opposed to a Pixel
        // Trail / backspace-disintegration particle sharing the same pool)
        // so drawFlamePixels only trails the ones that should have one.
        spark: true
      });
    }
  }
};

// src/effects.ts
var effectsMethods = {
  ...effectsFireMethods,
  ...effectsPopsMethods,
  ...effectsDustMethods,
  ...effectsTrailMethods
};

// src/paint-color.ts
var paintColorMethods = {
  getActiveColor() {
    const baseColor = this.getBaseColor();
    if (!this.look.speedDemon) return baseColor;
    if (this.styleFor("speedDemonNoCursorHeat")) return baseColor;
    return this.heatColor(this.heat, baseColor);
  },
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
    if (this.look.gradientEnabled) return this.gradientStops(false)[0];
    return this.isDarkTheme() ? this.look.colorDark : this.look.colorLight;
  },
  // Which theme the cursor is being drawn against. Read off the document that
  // actually owns the canvas, not the main one, so a popped-out window with a
  // different theme still picks the right colours.
  isDarkTheme() {
    const doc = this.canvas ? this.canvas.ownerDocument : document;
    return doc.body.classList.contains("theme-dark");
  },
  // ---- Gradient cursor colour --------------------------------------------
  // The active theme's gradient stops, in order, as hex strings. Always at
  // least two entries, so callers can index [i] and [i+1] without guarding.
  // `applyHeat` exists for the callers that need the stops as the user
  // configured them - anything that is about to run them through heatColor
  // itself, and would otherwise apply the ramp twice.
  gradientStops(applyHeat = true) {
    const s = this.look;
    const n = Math.max(2, Math.min(4, Math.round(s.gradientCount || 2)));
    const prefix = this.isDarkTheme() ? "gradientDark" : "gradientLight";
    const out = [];
    for (let i = 1; i <= n; i++) {
      const key = prefix + i;
      let hex = s[key] || DEFAULT_SETTINGS[key];
      if (applyHeat && s.speedDemon && this.heat > 0 && !this.styleFor("speedDemonNoCursorHeat")) {
        hex = this.heatColor(this.heat, hex);
      }
      out.push(hex);
    }
    return out;
  },
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
    if (!this.look.gradientEnabled) {
      return hexToRgbTuple(this.getActiveColor() || "#39ff14");
    }
    const stops = this.gradientStops();
    const lerp = (a, b, f) => [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f
    ];
    if (cyclic) {
      const wrapped = (pos % 1 + 1) % 1;
      const p2 = wrapped * stops.length;
      const i2 = Math.floor(p2) % stops.length;
      const j = (i2 + 1) % stops.length;
      return lerp(hexToRgbTuple(stops[i2]), hexToRgbTuple(stops[j]), p2 - Math.floor(p2));
    }
    const p = Math.max(0, Math.min(1, pos)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(p));
    return lerp(hexToRgbTuple(stops[i]), hexToRgbTuple(stops[i + 1]), p - i);
  },
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
    if (!ctx || !(span > 0)) return hexToRgba(stops[0], alpha);
    const grad = horizontal ? ctx.createLinearGradient(x, y, x + w, y) : ctx.createLinearGradient(x, y, x, y + h);
    for (let i = 0; i < stops.length; i++) {
      const [r, g, b] = hexToRgbTuple(stops[i]);
      grad.addColorStop(i / (stops.length - 1), `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  },
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
    if (!this.look.gradientEnabled) return hexToRgba(color, alpha);
    return this.createCursorGradient(x, y, w, h, alpha);
  },
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
    if (!this.look.speedDemon) return 1;
    if (this.styleFor("speedDemonNoCursorHeat")) return 1;
    const h = Math.max(0, Math.min(1, this.heat || 0));
    return 1 + GLOW_HEAT_GAIN * h;
  },
  // The active theme's four custom heat stops, cold → hot, as hex strings.
  speedHeatStops() {
    const prefix = this.isDarkTheme() ? "speedHeatDark" : "speedHeatLight";
    const out = [];
    for (let i = 1; i <= 4; i++) {
      out.push(this.look[prefix + i] || DEFAULT_SETTINGS[prefix + i]);
    }
    return out;
  },
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
    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
  },
  heatColor(heat, baseHex) {
    const h = Math.max(0, Math.min(1, heat));
    if (this.styleFor("speedDemonGradient")) {
      if (h >= SPEED_RAMP_LIFTOFF) {
        return this.sampleHeatRamp((h - SPEED_RAMP_LIFTOFF) / (1 - SPEED_RAMP_LIFTOFF));
      }
      const [sr, sg, sb] = hexToRgbTuple(this.speedHeatStops()[0]);
      const [r0, g0, b0] = hexToRgbTuple(baseHex);
      const f = h / SPEED_RAMP_LIFTOFF;
      const rr = Math.round(r0 + (sr - r0) * f);
      const gg = Math.round(g0 + (sg - g0) * f);
      const bb2 = Math.round(b0 + (sb - b0) * f);
      return `#${(1 << 24 | rr << 16 | gg << 8 | bb2).toString(16).slice(1)}`;
    }
    const [br, bg, bb] = hexToRgbTuple(baseHex);
    const coldR = br;
    const coldG = bg;
    const coldB = bb;
    const warm = [255, 140, 40];
    const hot = [255, 70, 30];
    const white = [255, 240, 200];
    let r, g, b;
    if (h < 0.5) {
      const t = h / 0.5;
      const e = easeInOutSine(t);
      r = coldR + (warm[0] - coldR) * e;
      g = coldG + (warm[1] - coldG) * e;
      b = coldB + (warm[2] - coldB) * e;
      const nudge = 1 - Math.abs(t - 0.5) * 2;
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
    return `#${(1 << 24 | Math.round(r) << 16 | Math.round(g) << 8 | Math.round(b)).toString(16).slice(1)}`;
  }
};

// src/paint-blink.ts
var paintBlinkMethods = {
  // The raw blink cycle: 1 while the caret is "on", 0 while it's "off", eased
  // through the two transitions, and pinned at 1 during the post-move hold.
  //
  // This is the SHAPE of the blink, separate from what is done with it. Plain
  // blinking fades opacity by it; Breathing scales the caret by it and leaves
  // opacity alone; the torch's Blink Sync follows it whichever of those is on.
  // Splitting the two apart is what lets Breathing stop the caret vanishing
  // without also stopping everything else that keys off the blink.
  blinkPhase(now) {
    if (!this.look.blinkingEnabled) return 1;
    let holdMs = 0;
    if (this.look.smoothEnabled && this.look.smoothStopBlinking) holdMs = 450;
    const delayMs = Math.max(0, this.look.blinkDelayMs ?? 0);
    if (delayMs > holdMs) holdMs = delayMs;
    const elapsed = now - (this.lastMoveTime + holdMs);
    if (!(elapsed > 0)) return 1;
    const speed = Math.max(0, this.look.blinkSpeed);
    const stopAfter = Math.max(0, Math.round(this.look.blinkStopAfter ?? 0));
    if (stopAfter > 0 && speed > 0 && elapsed >= stopAfter * blinkSegments(speed).period) return 1;
    return blinkAlphaAt(elapsed, speed, this.look.blinkOnOffBalance ?? 0.5, this.look.blinkFade ?? 0.15);
  },
  // What the blink does to opacity. Breathing swaps the fade out for a size
  // change, so the caret keeps full opacity throughout - never disappearing is
  // the entire point of that option.
  // When the blink next changes, for the frame governor: whether `now` is
  // inside one of the two fades (the loop must be awake, warm gear), and how
  // many ms until the phase next crosses into or out of a fade. Infinity
  // when the caret does not blink: off, speed 0, or gone solid (blink-to-
  // solid). During the post-move hold it is the hold's remainder plus the
  // lit segment of the first cycle. The clock and the segments are exactly
  // blinkPhase's, so what this schedules is what that will paint; a test
  // sweeps the two against each other. The idle gear used to sleep its
  // heartbeat through a fade's start and catch it up to 200 ms in, so the
  // caret popped where it should have eased.
  blinkWindow(now) {
    const none = { fading: false, msToNext: Infinity };
    if (!this.look.blinkingEnabled) return none;
    let holdMs = 0;
    if (this.look.smoothEnabled && this.look.smoothStopBlinking) holdMs = 450;
    const delayMs = Math.max(0, this.look.blinkDelayMs ?? 0);
    if (delayMs > holdMs) holdMs = delayMs;
    const speed = Math.max(0, this.look.blinkSpeed);
    if (speed <= 0) return none;
    const seg = blinkSegments(speed, this.look.blinkOnOffBalance ?? 0.5, this.look.blinkFade ?? 0.15);
    const elapsed = now - (this.lastMoveTime + holdMs);
    const stopAfter = Math.max(0, Math.round(this.look.blinkStopAfter ?? 0));
    if (stopAfter > 0 && elapsed >= stopAfter * seg.period) return none;
    if (!(elapsed > 0)) return { fading: false, msToNext: -elapsed + seg.p1 * seg.period };
    const phase = elapsed % seg.period / seg.period;
    if (phase < seg.p1) return { fading: false, msToNext: (seg.p1 - phase) * seg.period };
    if (phase < seg.p2) return { fading: true, msToNext: (seg.p2 - phase) * seg.period };
    if (phase < seg.p3) return { fading: false, msToNext: (seg.p3 - phase) * seg.period };
    return { fading: true, msToNext: (1 - phase) * seg.period };
  },
  blinkAlpha(now) {
    if (this.look.blinkBreathing) return 1;
    return this.blinkPhase(now);
  },
  // What the blink does to size: 1 at the top of the cycle, shrinking to
  // (1 - depth) at the bottom. Never exceeds 1, deliberately - the damage box
  // in draw() is measured from the caret's true rect, so a caret that breathed
  // OUT past its own bounds would leave uncleared pixels behind its widest
  // frame. Shrinking from the true size is also what keeps it from shouldering
  // into the glyphs on either side.
  breathScale(now) {
    if (!this.look.blinkingEnabled || !this.look.blinkBreathing) return 1;
    const depth = Math.max(0, Math.min(0.9, this.look.blinkBreathDepth ?? 0.2));
    return 1 - depth * (1 - this.blinkPhase(now));
  }
};

// src/paint-shape.ts
var paintShapeMethods = {
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
  traceQuad(ctx, corners, radius = 0) {
    const pts = [corners.tl, corners.tr, corners.br, corners.bl];
    if (!(radius > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }
    let r = radius;
    for (let i = 0; i < 4; i++) {
      const prev = pts[(i + 3) % 4], cur = pts[i], next = pts[(i + 1) % 4];
      const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
      const v2x = next.x - cur.x, v2y = next.y - cur.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (!(l1 > 1e-6) || !(l2 > 1e-6)) {
        r = 0;
        break;
      }
      const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
      const theta = Math.acos(cos);
      const lim = Math.min(l1, l2) / 2 * Math.tan(theta / 2);
      if (lim < r) r = lim;
    }
    if (!(r > 0.01)) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      return;
    }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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
  cursorCorners(rx, ry, rw, rh) {
    return this.smearCorners() || {
      tl: { x: rx, y: ry },
      tr: { x: rx + rw, y: ry },
      br: { x: rx + rw, y: ry + rh },
      bl: { x: rx, y: ry + rh }
    };
  },
  fillCursorShape(ctx, rx, ry, rw, rh) {
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
  },
  fillTrailRect(ctx, x, y, w, h) {
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
  serifQuads(active, rx, rw, ry = active.top, rh = active.h) {
    const stem = rw;
    const lineH = rh;
    const thickness = Math.max(
      1,
      Math.round(Math.min(stem * SERIF_STEM_RATIO, lineH * SERIF_HEIGHT_RATIO))
    );
    const charW = active.actualCharWidth;
    const raw = charW && charW > 0 ? charW : stem * 7;
    const span = Math.max(SERIF_MIN_SPAN_PX, Math.min(raw, lineH * SERIF_MAX_SPAN_RATIO));
    const c = this.cursorCorners(rx, ry, rw, lineH);
    const dir = this._smearDir;
    const anchor = (a, b) => {
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (!(len > 1e-3)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const aLeads = !!dir && ex * dir.x + ey * dir.y < 0;
      const lead = aLeads ? a : b;
      const sign = aLeads ? -1 : 1;
      const back = Math.min(len, stem) / 2;
      return {
        x: lead.x - sign * (ex / len) * back,
        y: lead.y - sign * (ey / len) * back
      };
    };
    const top = anchor(c.tl, c.tr), bot = anchor(c.bl, c.br);
    const topCx = top.x, topCy = top.y;
    const botCx = bot.x, botCy = bot.y;
    const half = span / 2;
    const inset = half * SERIF_TAPER;
    const quads = [
      {
        tl: { x: topCx - half, y: topCy },
        tr: { x: topCx + half, y: topCy },
        br: { x: topCx + half - inset, y: topCy + thickness },
        bl: { x: topCx - half + inset, y: topCy + thickness }
      },
      {
        tl: { x: botCx - half + inset, y: botCy - thickness },
        tr: { x: botCx + half - inset, y: botCy - thickness },
        br: { x: botCx + half, y: botCy },
        bl: { x: botCx - half, y: botCy }
      }
    ];
    return {
      quads,
      left: Math.min(topCx, botCx) - half,
      right: Math.max(topCx, botCx) + half,
      // A serif is a thin bar, so it rounds on its own thickness rather than
      // on the stem's width - otherwise a rounded Box-sized radius would eat
      // the whole bracket.
      radius: this.cornerRadius(thickness)
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
  _paintTrail(ctx, style, color, bodyOpacity, strokeW) {
    const settings = this.look;
    if (!settings.crtEffect || !this.trail.length) return;
    ctx.save();
    this.forEachTrailPoint((p0, alpha, age) => {
      const a = alpha * bodyOpacity;
      let p = p0;
      if (style === "Line") {
        const span = this.lineSpan(p0.y, p0.h);
        p = { ...p0, y: span.top, h: span.h };
      }
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
  _armGlow(ctx, color, blur) {
    const settings = this.look;
    if (settings.crtEffect && settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * this.glowHeatScale();
    }
  },
  // A live Signal Glitch burst, or null. Resolved before the body's paint is
  // built, so a burst skips the (possibly expensive) beam paint it would
  // discard.
  _glitchNow(now) {
    const settings = this.look;
    return settings.crtEffect && settings.crtGlitch ? this.glitchState(now) : null;
  },
  // The paint for the caret's body over the rect it will actually cover: the
  // energy beam when it is on, otherwise the flat colour or the gradient.
  _bodyPaint(x, y, w, h, color, alpha) {
    return this.look.energyEffect ? this.energyPaint(x, y, w, h, color, alpha) : this.cursorPaint(x, y, w, h, color, alpha);
  },
  drawGenericCaret(isUnderline = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const active = this.animActive;
    const now = performance.now();
    const trailColor = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const bodyOpacity = this.styleFor("cursorTranslucent") ? opacity * TRANSLUCENT_ALPHA : opacity;
    this._paintTrail(ctx, isUnderline ? "Underline" : "Line", trailColor, bodyOpacity, 0);
    if (!active) return;
    const blinkAlpha2 = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";
    ctx.save();
    this._armGlow(ctx, color, 8 * blinkAlpha2);
    let rx, ry, rw, rh;
    if (isUnderline) {
      const uThickness = this.underlineThickness(active.h);
      rx = active.x;
      ry = active.top + active.h - uThickness;
      rw = active.actualCharWidth;
      rh = uThickness;
    } else {
      const span = this.lineSpan(active.top, active.h);
      rx = active.x;
      ry = span.top;
      rw = this.renderWidth(active);
      rh = span.h;
    }
    const gsGen = this._glitchNow(now);
    const wantSerifs = !isUnderline && settings.lineSerifs && !gsGen;
    const serifs = wantSerifs ? this.serifQuads(active, rx, rw, ry, rh) : null;
    if (gsGen) {
      this.paintGlitchRect(ctx, rx, ry, rw, rh, color, 0.9 * blinkAlpha2 * bodyOpacity, gsGen);
    } else {
      let px = rx, pw = rw;
      if (serifs) {
        px = Math.min(rx, serifs.left);
        pw = Math.max(rx + rw, serifs.right) - px;
      }
      ctx.fillStyle = this._bodyPaint(px, ry, pw, rh, color, 0.9 * blinkAlpha2 * bodyOpacity);
      ctx.beginPath();
      this.traceQuad(
        ctx,
        this.cursorCorners(rx, ry, rw, rh),
        this.cornerRadius(Math.min(rw, rh))
      );
      if (serifs) {
        for (const q of serifs.quads) this.traceQuad(ctx, q, serifs.radius);
      }
      ctx.fill();
    }
    ctx.restore();
  },
  drawBoxCursor() {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = this.look;
    const now = performance.now();
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const hollow = this.styleFor("boxHollow");
    const strokeW = hollow ? Math.max(1, Math.min(6, settings.boxHollowWidth || 2)) : 0;
    const translucent = !!this.styleFor("cursorTranslucent");
    const bodyOpacity = translucent ? opacity * TRANSLUCENT_ALPHA : opacity;
    this._paintTrail(ctx, "Box", color, bodyOpacity, strokeW);
    const active = this.animActive;
    if (active) {
      const blinkAlpha2 = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);
      ctx.save();
      this._armGlow(ctx, color, 10 * blinkAlpha2);
      const gsBox = this._glitchNow(now);
      if (gsBox) {
        this.paintGlitchRect(
          ctx,
          active.x,
          active.top,
          renderW,
          active.h,
          color,
          0.9 * blinkAlpha2 * bodyOpacity,
          gsBox
        );
      } else {
        const paintStyle = this._bodyPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha2 * bodyOpacity);
        if (hollow) {
          ctx.strokeStyle = paintStyle;
          ctx.lineWidth = strokeW;
          ctx.lineJoin = "miter";
          ctx.beginPath();
          this.traceQuad(
            ctx,
            this.cursorCorners(active.x, active.top, renderW, active.h),
            this.cornerRadius(Math.min(renderW, active.h))
          );
          ctx.stroke();
        } else {
          ctx.fillStyle = paintStyle;
          this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
        }
      }
      ctx.restore();
      const displayChar = this.pending ? this.pending.holdChar : active.char;
      const glyphAlpha = Math.min(1, bodyOpacity * blinkAlpha2);
      if (!hollow && !translucent && !gsBox && settings.showChar && displayChar && glyphAlpha >= 0.01) {
        ctx.save();
        ctx.globalAlpha = glyphAlpha;
        const glyphMode = this.styleFor("glyphColorMode") || "contrast";
        if (this._glyphColorFor !== color || this._glyphColorMode !== glyphMode) {
          this._glyphColorFor = color;
          this._glyphColorMode = glyphMode;
          this._glyphColorVal = readableGlyphColor(color, glyphMode);
        }
        ctx.fillStyle = this._glyphColorVal;
        ctx.font = this.fontString(active.fontSize, active.fontFamily, active.fontWeight, active.fontStyle);
        const metricKey = ctx.font + "|" + displayChar;
        let gm = this._glyphMetrics;
        if (!gm || this._glyphMetricKey !== metricKey) {
          const metrics = ctx.measureText(displayChar);
          gm = this._glyphMetrics = {
            ascent: metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? active.fontSize * 0.8,
            descent: metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? active.fontSize * 0.2
          };
          this._glyphMetricKey = metricKey;
        }
        const { ascent, descent } = gm;
        const glyphBoxHeight = ascent + descent;
        const leading = active.h - glyphBoxHeight;
        const baselineY = active.top + ascent + leading / 2;
        const glyphAdvance = Math.max(1, (active.actualCharWidth ?? renderW) - (active.letterSpacing || 0));
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
};

// src/paint-energy.ts
var paintEnergyMethods = {
  // Chooses how the Energy Beam paints the cursor.
  //
  // Aurora with any waviness becomes a genuine 2D field (auroraPattern); every
  // other case keeps the original linear gradient. Both return something usable
  // directly as a fillStyle/strokeStyle, so callers don't care which they got.
  energyPaint(x, y, w, h, baseColor, alpha) {
    const rampOn = !!this.look.gradientEnabled;
    const wav = this.look.energyAuroraWaviness ?? 1;
    if (rampOn && this.look.energyAurora && wav > 0.05) {
      const pat = this.auroraPattern(x, y, w, h, alpha, wav);
      if (pat) return pat;
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
  auroraPattern(x, y, w, h, alpha, wav) {
    try {
      const ctx = this.ctx;
      if (!ctx) return null;
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
      x0 -= 1;
      y0 -= 1;
      x1 += 1;
      y1 += 1;
      const rw = x1 - x0, rh = y1 - y0;
      if (!(rw > 0.5) || !(rh > 0.5)) return null;
      const dpr = (this.canvas?.ownerDocument?.defaultView || window).devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(rw * dpr));
      const ph = Math.max(1, Math.round(rh * dpr));
      if (pw * ph > 6e4) return null;
      let ac = this._auroraCanvas;
      if (!ac || ac.width !== pw || ac.height !== ph) {
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
      const t = performance.now() / 1e3 * speed;
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
          const warp = Math.sin(v * 4.1 + t * 0.9 + u * 2.3) * 0.2 + Math.sin(v * 7.3 - t * 0.6 + u * 3.7) * 0.11 + Math.sin(u * 5.2 + t * 1.1 - v * 1.9) * 0.15;
          let s = v - t * 0.3 + warp * wav;
          const mix = (0.5 + 0.5 * Math.sin(u * 2.1 + v * 2.3 + t * 0.7)) * 0.55;
          let s2 = v * 0.45 + u * 0.25 + t * 0.17 + 0.37;
          let i1 = (Math.floor(s * LUT) % LUT + LUT) % LUT;
          let i2 = (Math.floor(s2 * LUT) % LUT + LUT) % LUT;
          i1 *= 3;
          i2 *= 3;
          let r = lut[i1] + (lut[i2] - lut[i1]) * mix;
          let g = lut[i1 + 1] + (lut[i2 + 1] - lut[i1 + 1]) * mix;
          let b = lut[i1 + 2] + (lut[i2 + 2] - lut[i1 + 2]) * mix;
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
      if (typeof pat.setTransform === "function" && typeof DOMMatrix === "function") {
        pat.setTransform(new DOMMatrix().translateSelf(x0, y0).scaleSelf(1 / dpr, 1 / dpr));
      } else {
        return null;
      }
      return pat;
    } catch {
      return null;
    }
  },
  createEnergyGradient(x, y, w, h, baseColor, alpha) {
    const ctx = this.ctx;
    if (!ctx) return hexToRgba(baseColor, alpha);
    const speed = this.look.energySpeed ?? 1;
    const t = performance.now() / 1e3 * speed;
    const base = hexToRgbTuple(baseColor);
    const rampOn = !!this.look.gradientEnabled;
    const aurora = rampOn && !!this.look.energyAurora;
    const grad = ctx.createLinearGradient(x + w / 2, y + h, x + w / 2, y);
    const stops = aurora ? 20 : rampOn ? 12 : 6;
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops;
      const pulse = 0.5 + 0.5 * Math.sin((pos - t * 0.6) * Math.PI * 2);
      let bs;
      if (aurora) {
        const warp = Math.sin(pos * 3.1 + t * 0.85) * 0.26 + Math.sin(pos * 5.7 - t * 0.55) * 0.14 + Math.sin(pos * 1.3 + t * 1.25) * 0.2;
        const near = this.sampleRamp(pos - t * 0.3 + warp, true);
        const far = this.sampleRamp(pos * 0.45 + t * 0.17 + 0.37, true);
        const mix = (0.5 + 0.5 * Math.sin(pos * 2.3 + t * 0.7)) * 0.6;
        bs = [
          near[0] + (far[0] - near[0]) * mix,
          near[1] + (far[1] - near[1]) * mix,
          near[2] + (far[2] - near[2]) * mix
        ];
      } else {
        bs = rampOn ? this.sampleRamp(pos - t * 0.35, true) : base;
      }
      let r = bs[0], g = bs[1], b = bs[2];
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
};

// src/text.ts
var BRACKET_OPEN = { "(": ")", "[": "]", "{": "}", "<": ">" };
var BRACKET_CLOSE = { ")": "(", "]": "[", "}": "{", ">": "<" };
var BRACKET_SCAN_LIMIT = 2e4;
var CODE_FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
var CODE_FENCE_PREFIX = 8;
var BLOCK_PREFIX_MAX = 64;
var BLOCK_HEAD_MAX = BLOCK_PREFIX_MAX + CODE_FENCE_PREFIX;
var BLOCK_LINE_LOOKBACK = 1024;
function blockLineInfo(line) {
  let i = 0;
  let depth = 0;
  for (; ; ) {
    let j = i;
    let spaces = 0;
    while (j < line.length && (line[j] === " " || line[j] === "	") && spaces < 3) {
      j++;
      spaces++;
    }
    if (line[j] !== ">") break;
    depth++;
    i = j + 1;
    if (line[i] === " ") i++;
  }
  return { depth, fence: CODE_FENCE_RE.test(line.slice(i, i + CODE_FENCE_PREFIX)) };
}
function isBlockquoteMarker(text, i, textStart) {
  const floor = Math.max(0, i - BLOCK_PREFIX_MAX);
  for (let j = i - 1; j >= floor; j--) {
    const c = text[j];
    if (c === "\n") return true;
    if (c !== ">" && c !== " " && c !== "	") return false;
  }
  return floor === 0 && textStart === 0;
}
var QUOTE_CHARS = ['"', "'", "`"];
var CURLY_QUOTE_OPEN = { "\u201C": "\u201D", "\u2018": "\u2019" };
var QUOTE_LINE_SCAN = 4e3;
var WORD_CHAR = /[\p{L}\p{N}_]/u;
function isQuoteDelimiter(text, i) {
  return !(WORD_CHAR.test(text[i - 1] || "") && WORD_CHAR.test(text[i + 1] || ""));
}

// src/paint-tether.ts
var paintTetherMethods = {
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
    if (forward) {
      const end = Math.min(len, at + BRACKET_SCAN_LIMIT);
      const text = doc.sliceString(at, end);
      let depth = 0;
      let inPrefix = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\n") {
          inPrefix = true;
          continue;
        }
        if (inPrefix) {
          if (c === " " || c === "	" || c === ">") continue;
          inPrefix = false;
        }
        if (c === open) depth++;
        else if (c === close) {
          if (--depth === 0) return at + i;
        }
      }
    } else {
      const start = Math.max(0, at - BRACKET_SCAN_LIMIT + 1);
      const text = doc.sliceString(start, at + 1);
      const angles = close === ">";
      let depth = 0;
      for (let i = text.length - 1; i >= 0; i--) {
        const c = text[i];
        if (angles && c === ">" && isBlockquoteMarker(text, i, start)) continue;
        if (c === close) depth++;
        else if (c === open) {
          if (--depth === 0) return start + i;
        }
      }
    }
    return -1;
  },
  // Whether the character at `at` is a blockquote marker. Used to stop the
  // caret tethering FROM one - parking next to the ">" that opens a callout
  // line should do nothing, not hunt backwards for a "<".
  isQuoteMarkerAt(doc, at) {
    if (doc.sliceString(at, at + 1) !== ">") return false;
    const back = Math.max(0, at - BLOCK_PREFIX_MAX);
    return isBlockquoteMarker(doc.sliceString(back, at + 1), at - back, back);
  },
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
  },
  // The innermost quoted run on this line that contains (or touches) the
  // caret. Straight quotes are taken left to right - 1st with 2nd, 3rd with
  // 4th - among the quotes that qualify as delimiters. Curly quotes are
  // directional, so an opener is matched to its own nearest closer instead.
  quoteSpanAt(doc, pos) {
    const { start, text } = this.lineBoundsAt(doc, pos);
    const rel = pos - start;
    let best = null;
    const consider = (a, b) => {
      if (rel < a || rel > b + 1) return;
      if (!best || a > best.from) best = { from: start + a, to: start + b };
    };
    for (const q of QUOTE_CHARS) {
      const marks = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === q && isQuoteDelimiter(text, i)) marks.push(i);
      }
      for (let i = 0; i + 1 < marks.length; i += 2) consider(marks[i], marks[i + 1]);
    }
    for (const openCh in CURLY_QUOTE_OPEN) {
      const closeCh = CURLY_QUOTE_OPEN[openCh];
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== openCh) continue;
        let depth = 1;
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] === openCh) depth++;
          else if (text[j] === closeCh && isQuoteDelimiter(text, j)) {
            if (--depth === 0) {
              consider(i, j);
              break;
            }
          }
        }
      }
    }
    return best;
  },
  // The innermost bracket pair the caret sits *inside*, for when it isn't
  // touching a bracket at all. Walks back looking for an opener that hasn't
  // already been closed, tracking each bracket type separately so an unrelated
  // `]` in the middle of a `(...)` doesn't derail the count.
  enclosingBracketSpan(doc, pos) {
    const start = Math.max(0, pos - BRACKET_SCAN_LIMIT);
    const text = doc.sliceString(start, pos);
    const depth = {};
    for (const closer in BRACKET_CLOSE) depth[closer] = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      const c = text[i];
      if (BRACKET_CLOSE[c]) {
        if (c === ">" && isBlockquoteMarker(text, i, start)) continue;
        depth[c]++;
        continue;
      }
      const closer = BRACKET_OPEN[c];
      if (!closer) continue;
      if (depth[closer] > 0) {
        depth[closer]--;
        continue;
      }
      const from = start + i;
      const to = this.matchingBracketPos(doc, from, c);
      return to >= 0 ? { from, to } : null;
    }
    return null;
  },
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
    const back = Math.max(0, from - BLOCK_LINE_LOOKBACK);
    const text = doc.sliceString(back, Math.min(doc.length, to + CODE_FENCE_PREFIX));
    const rel = from - back;
    const relTo = to - back;
    let ls = rel <= 0 ? 0 : text.lastIndexOf("\n", rel - 1) + 1;
    let base = -1;
    while (ls <= relTo) {
      let le = text.indexOf("\n", ls);
      if (le < 0) le = text.length;
      const info = blockLineInfo(text.slice(ls, Math.min(le, ls + BLOCK_HEAD_MAX)));
      if (base < 0) {
        base = info.depth;
      } else {
        if (info.fence) return true;
        if (info.depth !== base) return true;
      }
      if (le >= text.length) break;
      ls = le + 1;
    }
    return false;
  },
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
      if (ch === ">" && this.isQuoteMarkerAt(doc, at)) continue;
      const m = this.matchingBracketPos(doc, at, ch);
      if (m < 0) continue;
      const from = Math.min(at, m), to = Math.max(at, m);
      if (this.crossesBlockBoundary(doc, from, to)) continue;
      return { from, to };
    }
    const q = this.quoteSpanAt(doc, pos);
    let b = this.enclosingBracketSpan(doc, pos);
    if (b && this.crossesBlockBoundary(doc, b.from, b.to)) b = null;
    if (q && b) return q.from > b.from ? q : b;
    return q || b || null;
  },
  // The tether for this frame, as an array of horizontal rules ordered top to
  // bottom - one per line the pair covers - in viewport pixels (the canvas is
  // fixed at 0,0, so viewport coords ARE canvas coords, the same assumption
  // cmCaretCoords and secondaryCaretCoords make). Returns null when there's
  // nothing to draw.
  // With no head this is the primary's tether, at the main selection. A
  // secondary passes its own head (and whether its range is empty), with its
  // bundle swapped in so the caches below are its own.
  bracketTetherCoords(view, head, empty) {
    if (!view || !this.editorFocused(view)) return null;
    try {
      const state = view.state;
      const main = state.selection.main;
      if (head === void 0) {
        head = main.head;
        empty = main.empty;
      }
      if (!empty) return null;
      const doc = state.doc;
      const pos = head;
      const len = doc.length;
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
    } catch (e) {
      this._reportOnce("bracketTetherCoords", e);
      return null;
    }
  },
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
    const drop = 1.5;
    const glyph = Math.max(3, (b.bottom - b.top) * 0.42);
    const flat = [{
      x1: a.left,
      y1: a.bottom + drop,
      x2: b.left + glyph,
      y2: b.bottom + drop
    }];
    if (Math.abs(a.bottom - b.bottom) < 1) return flat;
    const key = from + ":" + to + ":" + view.state.doc.length;
    const cached = this._tetherSegs;
    if (cached && this._tetherSegKey === key && this._tetherAnchorA && this._tetherAnchorB) {
      const dx = a.left - this._tetherAnchorA.x;
      const dy = a.bottom - this._tetherAnchorA.y;
      if (Math.abs(b.left - this._tetherAnchorB.x - dx) < 0.5 && Math.abs(b.bottom - this._tetherAnchorB.y - dy) < 0.5) {
        if (dx === 0 && dy === 0) return cached;
        return cached.map((s) => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }));
      }
    }
    const rects = this.rangeLineRects(view, from, Math.min(view.state.doc.length, to + 1));
    const segs = rects.length >= 2 ? rects.map((r) => ({ x1: r.left, y1: r.bottom + drop, x2: r.right, y2: r.bottom + drop })) : flat;
    this._tetherSegKey = key;
    this._tetherSegs = segs;
    this._tetherAnchorA = { x: a.left, y: a.bottom };
    this._tetherAnchorB = { x: b.left, y: b.bottom };
    return segs;
  },
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
    if (last.number - first.number > 300) return out;
    const ownerDoc = view.dom.ownerDocument;
    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n);
      const s = Math.max(from, line.from);
      const e = Math.min(to, line.to);
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
        continue;
      }
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r || r.width < 0.5 || r.height < 0.5) continue;
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
  },
  // Stroke for one rule of the tether, where that rule covers t0..t1 (as
  // fractions) of the whole run.
  //
  // With the gradient on, the ramp is spread across the entire span rather than
  // restarted on each line: the canvas gradient is anchored at the virtual
  // points where fractions 0 and 1 would land on this rule's own axis, so
  // consecutive lines pick up consecutive slices of one ramp and the tether
  // still reads as a single object, the way it does with the cursor.
  tetherStroke(ctx, s, t0, t1, alpha) {
    if (!this.look.gradientEnabled) return hexToRgba(this.getActiveColor(), alpha);
    const span = Math.max(1e-4, t1 - t0);
    const ux = (s.x2 - s.x1) / span;
    const uy = (s.y2 - s.y1) / span;
    const g = ctx.createLinearGradient(
      s.x1 - ux * t0,
      s.y1 - uy * t0,
      s.x1 + ux * (1 - t0),
      s.y1 + uy * (1 - t0)
    );
    const stops = this.gradientStops();
    for (let i = 0; i < stops.length; i++) {
      const [r, gg, b] = hexToRgbTuple(stops[i]);
      g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, `rgba(${r}, ${gg}, ${b}, ${alpha})`);
    }
    return g;
  },
  drawBracketTether() {
    const segs = this.bracketTether;
    if (!segs || !segs.length) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const strength = Math.max(0, Math.min(1, this.look.bracketTetherStrength ?? 0.35));
    const alpha = strength * opacity;
    if (alpha <= 0.01) return;
    const lens = [];
    let total = 0;
    for (const s of segs) {
      const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      lens.push(l);
      total += l;
    }
    if (total < 2) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
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
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of segs) {
      minX = Math.min(minX, s.x1, s.x2);
      maxX = Math.max(maxX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2);
      maxY = Math.max(maxY, s.y1, s.y2);
    }
    const pad = tick + 4;
    this._markDirty(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  },
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
};

// src/paint-secondaries.ts
var paintSecondariesMethods = {
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
    const opacity = Math.max(0, Math.min(1, this.look.cursorOpacity ?? 1));
    const alpha = this.blinkAlpha(performance.now()) * opacity;
    if (alpha <= 0.01) return;
    const strokeAlpha = 0.9 * alpha;
    let ramp = null;
    if (this.look.gradientEnabled) {
      ramp = this.gradientStops().map((hex) => {
        const [r, g, b] = hexToRgbTuple(hex);
        return `rgba(${r}, ${g}, ${b}, ${strokeAlpha})`;
      });
    }
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = this.styleFor("cursorRounded") ? "round" : "butt";
    if (!ramp) ctx.strokeStyle = hexToRgba(this.getActiveColor(), strokeAlpha);
    for (const c of carets) {
      const x = Math.round(c.x) + 0.5;
      const h = c.bottom - c.top;
      if (ramp) {
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
  },
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
      });
    }
    return bounds;
  }
};

// src/paint-smear.ts
var paintSmearMethods = {
  updateSmearQuad() {
    const now = performance.now();
    if (!this._smearDtT) this._smearDtT = now;
    let dt = (now - this._smearDtT) / 1e3;
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
    const target = { x: rect.x, y: rect.y };
    const offsets = { tl: { x: 0, y: 0 }, tr: { x: rect.w, y: 0 }, br: { x: rect.w, y: rect.h }, bl: { x: 0, y: rect.h } };
    if (!this.smearQuad || !this._smearLead || !this._smearTrail) {
      this._smearLead = { x: target.x, y: target.y, vx: 0, vy: 0 };
      this._smearTrail = { x: target.x, y: target.y };
      this.smearQuad = {};
      for (const key of Object.keys(offsets)) {
        this.smearQuad[key] = { x: target.x + offsets[key].x, y: target.y + offsets[key].y, vx: 0, vy: 0 };
      }
      this.smearCenterPrev = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      this.smearShape = this.smearQuad;
      this._smearMoving = false;
      return;
    }
    {
      const lead2 = this._smearLead, trail2 = this._smearTrail, q = this.smearQuad;
      if (!this._smearMoving && this.smearShape === q && lead2.x === target.x && lead2.y === target.y && lead2.vx === 0 && lead2.vy === 0 && trail2.x === target.x && trail2.y === target.y && q.tl.x === target.x && q.tl.y === target.y && q.tr.x === target.x + rect.w && q.tr.y === target.y && q.br.x === target.x + rect.w && q.br.y === target.y + rect.h && q.bl.x === target.x && q.bl.y === target.y + rect.h) {
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
      this._smearDir = { x: dirX / dirLen, y: dirY / dirLen };
    }
    this.smearCenterPrev = center;
    const leadBoost = settings.smoothEnabled ? Math.max(1, Math.min(SMEAR_LEAD_BOOST_CAP, this._catchUpBoost || 1)) : 1;
    const freqLead = (2 + Math.max(0, Math.min(1, settings.smearStiffness)) * 38) * leadBoost;
    const freqTrail = 2 + Math.max(0, Math.min(1, settings.smearTrailingStiffness)) * 38;
    const dampingRatio = 0.15 + Math.max(0, Math.min(1, settings.smearDamping)) * 1.15;
    const MAX_STEP = 1 / 240;
    const steps = Math.max(1, Math.min(16, Math.ceil(dt / MAX_STEP)));
    const h = dt / steps;
    const lead = this._smearLead;
    const trail = this._smearTrail;
    const k = freqLead * freqLead;
    const damp = 2 * dampingRatio * freqLead;
    for (let i = 0; i < steps; i++) {
      const ax2 = k * (target.x - lead.x) - damp * lead.vx;
      const ay2 = k * (target.y - lead.y) - damp * lead.vy;
      lead.vx += ax2 * h;
      lead.vy += ay2 * h;
      lead.x += lead.vx * h;
      lead.y += lead.vy * h;
      const f = 1 - Math.exp(-freqTrail * h);
      trail.x += (lead.x - trail.x) * f;
      trail.y += (lead.y - trail.y) * f;
    }
    if (!isFinite(lead.x) || !isFinite(lead.y) || !isFinite(lead.vx) || !isFinite(lead.vy) || !isFinite(trail.x) || !isFinite(trail.y)) {
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
    }
    this.applySmearMaxLength(rect);
    const dir = this._smearDir;
    const ax = dir ? Math.abs(dir.x) : 0, ay = dir ? Math.abs(dir.y) : 0;
    const hx = (rect.h * ax) ** 4, wy = (rect.w * ay) ** 4;
    const u = hx + wy > 0 ? hx / (hx + wy) : 0.5;
    const sgnX = dir ? Math.sign(dir.x) : 0, sgnY = dir ? Math.sign(dir.y) : 0;
    const tvx = (lead.x - trail.x) * freqTrail, tvy = (lead.y - trail.y) * freqTrail;
    let moving = false;
    for (const key of Object.keys(offsets)) {
      const o = offsets[key];
      const sx = o.x > 0 ? 1 : -1;
      const sy = o.y > 0 ? 1 : -1;
      const front = dir ? sx * sgnX * u + sy * sgnY * (1 - u) : 0;
      const f = (1 - front) / 2;
      const c = this.smearQuad[key];
      c.x = lead.x + (trail.x - lead.x) * f + o.x;
      c.y = lead.y + (trail.y - lead.y) * f + o.y;
      c.vx = lead.vx + (tvx - lead.vx) * f;
      c.vy = lead.vy + (tvy - lead.vy) * f;
      const tx = target.x + o.x, ty = target.y + o.y;
      if (Math.abs(c.x - tx) > 0.5 || Math.abs(c.y - ty) > 0.5 || Math.abs(c.vx) > SMEAR_SETTLE_V || Math.abs(c.vy) > SMEAR_SETTLE_V) moving = true;
    }
    this._smearMoving = moving;
    this.applySmearTaper({
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
      bl: { x: rect.x, y: rect.y + rect.h }
    }, center);
    this.applySmearVolume({
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
      bl: { x: rect.x, y: rect.y + rect.h }
    }, rect);
    if (moving) {
      this.smearQuadLastMoveT = now;
    } else {
      lead.x = trail.x = target.x;
      lead.y = trail.y = target.y;
      lead.vx = lead.vy = 0;
      for (const key of Object.keys(offsets)) {
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
  applySmearMaxLength(rect) {
    const cap = this.look.smearMaxLength;
    const lead = this._smearLead, trail = this._smearTrail;
    if (!lead || !trail || !(cap > 0)) return;
    for (const p of [lead, trail]) {
      const dx2 = p.x - rect.x, dy2 = p.y - rect.y;
      const d2 = Math.hypot(dx2, dy2);
      if (d2 <= cap) continue;
      const f = cap / d2;
      p.x = rect.x + dx2 * f;
      p.y = rect.y + dy2 * f;
    }
    const dx = lead.x - rect.x, dy = lead.y - rect.y;
    const d = Math.hypot(dx, dy);
    if (d >= cap - 1e-9 && d > 0) {
      const away = (lead.vx * dx + lead.vy * dy) / d;
      if (away > 0) {
        lead.vx -= dx / d * away;
        lead.vy -= dy / d * away;
      }
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
  applySmearVolume(targets, rect) {
    const shape = this.smearShape;
    const strength = Math.max(0, Math.min(1, this.look.smearVolumeStrength ?? 0.3));
    if (!shape || !this.look.smearConserveVolume || strength <= 0) return;
    const cx = (shape.tl.x + shape.tr.x + shape.br.x + shape.bl.x) / 4;
    const cy = (shape.tl.y + shape.tr.y + shape.br.y + shape.bl.y) / 4;
    const tx = rect.x + rect.w / 2, ty = rect.y + rect.h / 2;
    if (Math.abs(tx - cx) < 1 || Math.abs(ty - cy) < 1) return;
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
    for (const k of Object.keys(targets)) {
      lag[k] = Math.hypot(targets[k].x - shape[k].x, targets[k].y - shape[k].y);
      if (lag[k] > maxLag) maxLag = lag[k];
    }
    if (maxLag < 0.01) return;
    for (const k of Object.keys(targets)) {
      const c = shape[k];
      const mx = targets[k].x - c.x, my = targets[k].y - c.y;
      const ml = lag[k];
      if (ml < 0.01) {
        out[k].x = c.x;
        out[k].y = c.y;
        continue;
      }
      const nx = -my / ml, ny = mx / ml;
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
  applySmearTaper(targets, center) {
    const q = this.smearQuad;
    const amount = Math.max(0, Math.min(1, this.look.smearTaperAmount ?? 0.7));
    const dir = this._smearDir;
    if (!q || !this.look.smearTaper || amount <= 0 || !dir) {
      this.smearShape = q;
      return;
    }
    let maxLag = 0;
    const lag = {};
    for (const k of Object.keys(targets)) {
      const l = Math.hypot(q[k].x - targets[k].x, q[k].y - targets[k].y);
      lag[k] = l;
      if (l > maxLag) maxLag = l;
    }
    const reach = Math.max(0, Math.min(1, (maxLag - TAPER_MIN_LAG) / (TAPER_FULL_LAG - TAPER_MIN_LAG)));
    if (reach <= 1e-3) {
      this.smearShape = q;
      return;
    }
    if (!this._taperBuf) {
      this._taperBuf = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
    }
    const out = this._taperBuf;
    for (const k of Object.keys(targets)) {
      const c = q[k];
      const ox = c.x - center.x;
      const oy = c.y - center.y;
      const along = ox * dir.x + oy * dir.y;
      const px = ox - along * dir.x;
      const py = oy - along * dir.y;
      const w = lag[k] / maxLag * reach * amount;
      out[k].x = c.x - px * w;
      out[k].y = c.y - py * w;
    }
    this.smearShape = out;
  },
  // The four corners to paint the cursor through, or null when Motion Smear is
  // off and callers should use the plain caret rect instead.
  smearCorners() {
    if (!this.look.smear) return null;
    return this.smearShape || this.smearQuad;
  },
  // The painted quad reduced to a short string, for the draw-skip signature.
  // See the call site for why the quad has to be in that signature at all.
  _smearSig() {
    const q = this.look.smear ? this.smearCorners() : null;
    if (!q) return "nosmear";
    let s = "";
    for (const k of ["tl", "tr", "br", "bl"]) {
      const c = q[k];
      if (!c) return "nosmear";
      s += Math.round(c.x * 2) + ":" + Math.round(c.y * 2) + ",";
    }
    return s;
  }
};

// src/paint-frame.ts
var paintFrameMethods = {
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
    for (const src of [this.smearQuad, this.smearShape]) {
      if (!src) continue;
      for (const k of Object.keys(src)) {
        if (src[k].x < x0) x0 = src[k].x;
        if (src[k].y < y0) y0 = src[k].y;
        if (src[k].x > x1) x1 = src[k].x;
        if (src[k].y > y1) y1 = src[k].y;
      }
    }
    if (this.styleFor("cursorStyle") === "Line" && this.look.lineSerifs) {
      const halfSpan = Math.max(
        SERIF_MIN_SPAN_PX,
        Math.min(a.actualCharWidth || 0, (a.h || 0) * SERIF_MAX_SPAN_RATIO)
      ) / 2;
      const cx = a.x + (a.w || 0) / 2;
      if (cx - halfSpan < x0) x0 = cx - halfSpan;
      if (cx + halfSpan > x1) x1 = cx + halfSpan;
    }
    let pad = 24 + Math.max(0, this.look.caretWidthPx || 0);
    if (this.look.crtEffect && this.look.glow) {
      pad += 10 * (this.glowHeatScale() - 1);
    }
    if (this.glitch) {
      const st = Math.max(0, Math.min(2.5, this.look.crtGlitchStrength ?? 1));
      const abr = Math.max(0, Math.min(3, this.look.crtGlitchAberration ?? 1));
      pad += 14 * st * 2.2 + 3.2 * abr + (a.w || 0) * 0.3 + 4;
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  },
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
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
    this._dirty = null;
    this.drawLettersParticles();
    this.drawBracketTether();
    this.drawStardust();
    this.drawFlamePixels();
    this.drawHotHead();
    this.drawThunderbolts();
    this.drawFireworks();
    const a = this.animActive;
    const cb = this._cursorBounds();
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
    const secBounds = this.drawFullSecondaries();
    this.drawSecondaryCarets();
    const e = this._dirty;
    this._dirtyRaw = e ? { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 } : null;
    if (cb) this._markDirty(cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0);
    for (const b of secBounds) this._markDirty(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    const d = this._dirty;
    if (!d) {
      this._dirtyPrev = null;
      return;
    }
    const cx0 = Math.max(rx0, Math.floor(d.x0) - 2);
    const cy0 = Math.max(ry0, Math.floor(d.y0) - 2);
    const cx1 = Math.min(rx1, Math.ceil(d.x1) + 2);
    const cy1 = Math.min(ry1, Math.ceil(d.y1) + 2);
    this._dirtyPrev = cx1 > cx0 && cy1 > cy0 ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null;
  },
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
    const want = this.styleFor("cursorTranslucent") ? this.isDarkTheme() ? "screen" : "multiply" : "normal";
    if (this._canvasBlend === want) return;
    this._canvasBlend = want;
    el.style.mixBlendMode = want;
  }
};

// src/paint.ts
var paintMethods = {
  ...paintColorMethods,
  ...paintBlinkMethods,
  ...paintShapeMethods,
  ...paintEnergyMethods,
  ...paintTetherMethods,
  ...paintSecondariesMethods,
  ...paintSmearMethods,
  ...paintFrameMethods
};

// src/torch-paint.ts
function clipToRegions(ctx, regions) {
  if (!regions) return false;
  ctx.save();
  ctx.beginPath();
  for (const b of regions) ctx.rect(b.left, b.top, b.width, b.height);
  ctx.clip();
  return true;
}
function paintTorchDarkness(ctx, w, h, spots, radiusPx, darkness, regions) {
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
function paintTorchGlow(ctx, w, h, spots, radiusPx, warmRgb, regions) {
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
function torchCanvasContext(el, w, h) {
  const bw = Math.max(1, Math.ceil(w * TORCH_CANVAS_SCALE));
  const bh = Math.max(1, Math.ceil(h * TORCH_CANVAS_SCALE));
  if (el.width !== bw || el.height !== bh) {
    el.width = bw;
    el.height = bh;
  }
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(TORCH_CANVAS_SCALE, 0, 0, TORCH_CANVAS_SCALE, 0, 0);
  return ctx;
}

// src/torch.ts
var regionsKey = (regions) => regions ? regions.map((b) => Math.round(b.left) + "," + Math.round(b.top) + "," + Math.round(b.width) + "," + Math.round(b.height)).join(";") : "";
var torchMethods = {
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
  },
  // The torch's look - darkness, colour, radius - is painted by the torch
  // tick from the effective settings every frame it changes (see
  // _torchPaintDarkness / _torchPaintGlow), so a settings change has nothing
  // to apply to the elements themselves. Kept as the hook saveSettings and
  // the tick call, so the dedupe keys can be dropped here: the painters
  // compare against them, and a changed Darkness or Colour must repaint.
  applyOverlayStyle() {
    this._torchDarkKey = "";
    this._torchGlowKey = "";
  },
  ensureTorchOverlayForView(view) {
    if (!this.settings.torchEffect) {
      this.disableTorchOverlay();
      return;
    }
    const targetDoc = view && view.dom.ownerDocument || this.overlay && this.overlay.ownerDocument || document;
    if (this.overlay && this.overlay.ownerDocument !== targetDoc) {
      this.overlay.remove();
      this.overlay = null;
      this.modalObserver?.disconnect();
      this.modalObserver = null;
    }
    if (!this.overlay) {
      targetDoc.body.classList.add("cursor-smith-torch-active");
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.overlay = appContainer.createEl("canvas", { cls: "cursor-smith-torch-overlay" });
      this._torchDarkKey = "";
      this._lastOverlayRect = "";
      this._lastTorchRadius = -1;
      this._lastGlowRect = "";
      this._lastGlowAlpha = "";
      this._torchGlowKey = "";
      this.applyOverlayStyle();
      const covered = () => {
        this.modalOpen = !!targetDoc.querySelector(".modal-container");
        this._coverOpen = this.modalOpen || !!targetDoc.querySelector("body > .menu, .menu-container");
      };
      covered();
      this.modalObserver = new MutationObserver(covered);
      this.modalObserver.observe(targetDoc.body, { childList: true });
    }
  },
  // Paint the darkness layer for these lights, if anything about the picture
  // changed since the last paint: a moved light, a new radius, a new size,
  // a new setting. A parked torch does not touch the bitmap.
  // The note tabs' rectangles in the overlay's own coordinates, for the
  // painters' clip; null with the whole overlay dark.
  _torchLocalRegions() {
    const notes = this._torchRegions;
    const box = this._overlayBox;
    if (!notes || !box) return null;
    return notes.map((b) => ({ left: b.left - box.left, top: b.top - box.top, width: b.width, height: b.height, right: b.right - box.left, bottom: b.bottom - box.top }));
  },
  _torchPaintDarkness(spots, radiusPx, darkness, w, h, regions) {
    const el = this.overlay;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + darkness + "|" + spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";") + "|" + regionsKey(regions);
    if (key === this._torchDarkKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchDarkKey = key;
    paintTorchDarkness(ctx, w, h, spots, radiusPx, darkness, regions);
  },
  _torchPaintGlow(spots, radiusPx, warmRgb, w, h, regions) {
    const el = this.glowEl;
    if (!el || typeof el.getContext !== "function") return;
    const key = w + "x" + h + "|" + radiusPx + "|" + warmRgb + "|" + spots.map((sp) => sp.x.toFixed(1) + "," + sp.y.toFixed(1)).join(";") + "|" + regionsKey(regions);
    if (key === this._torchGlowKey) return;
    const ctx = torchCanvasContext(el, w, h);
    if (!ctx) return;
    this._torchGlowKey = key;
    paintTorchGlow(ctx, w, h, spots, radiusPx, warmRgb, regions);
  },
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
      if (this.glowEl) {
        this.glowEl.remove();
        this.glowEl = null;
        this._torchGlowKey = "";
      }
      return null;
    }
    const doc = this.overlay && this.overlay.ownerDocument;
    if (!doc) return null;
    if (this.glowEl && this.glowEl.ownerDocument !== doc) {
      this.glowEl.remove();
      this.glowEl = null;
    }
    if (!this.glowEl) {
      const appContainer = doc.querySelector(".app-container") || doc.body;
      this.glowEl = appContainer.createEl("canvas", { cls: "cursor-smith-torch-glow" });
      this._torchGlowKey = "";
      this._lastGlowRect = "";
      this._lastGlowAlpha = "";
      this._torchGlowKey = "";
    }
    return this.glowEl;
  },
  disableTorchOverlay() {
    this.torchEngineActive = false;
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
    }
    this._torchTick = null;
    this._torchRegions = null;
    this._torchDarkKey = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";
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
    this.glowEl?.remove();
    this.glowEl = null;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._torchDarkKey = "";
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.modalOpen = false;
    this._coverOpen = false;
  },
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
      const caps = this._frameCaps();
      const idleMs = Math.min(caps.torchIdleMs, Math.max(1, Math.ceil(this._torchIdleWakeMs || caps.torchIdleMs)));
      const delay = this._torchGear === "pulse" ? caps.torchPulseMs : idleMs;
      this._torchIdleT = window.setTimeout(() => {
        this._torchIdleT = 0;
        if (this.torchEngineActive) this.torchRaf = window.requestAnimationFrame(tick);
      }, delay);
    };
    const tick = () => {
      if (!this.torchEngineActive) return;
      this._torchGear = "idle";
      this._torchIdleWakeMs = 0;
      try {
        {
          if (this.presentationActive()) {
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
          } else if (!this.look.torchEffect) {
            if (this.overlay) this.overlay.classList.add("cursor-smith-torch-hidden");
          } else if (!this.windowFocused() && this.look.overlayBlinkSync && this.look.blinkingEnabled) {
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            if (this.overlay) {
              this.overlay.classList.remove("cursor-smith-torch-hidden");
              const from = this._lastTorchRadius > 0 ? this._lastTorchRadius : this.look.overlayRadius;
              const stepped = Math.round(from - (from - 1) * 0.28);
              const next = stepped <= 2 ? 1 : stepped;
              if (next !== this._lastTorchRadius) {
                this._lastTorchRadius = next;
                const box = this._overlayBox;
                if (box) {
                  this._torchPaintDarkness(
                    [{ x: this.x - box.left, y: this.y - box.top }],
                    next,
                    this.look.overlayDarkness,
                    box.width,
                    box.height,
                    this._torchLocalRegions()
                  );
                }
                if (next > 1) this._torchGear = "pulse";
              }
            }
          } else {
            const view = this.app.workspace.activeEditor?.editor?.cm;
            this.ensureTorchOverlayForView(view);
            if (view) this.registerWindowEvents(view.dom.ownerDocument);
            if (this.overlay) {
              const sig = [
                this.look.overlayRadius,
                this.look.overlayDarkness,
                this.look.overlayIntensity,
                this.look.overlayColor
              ].join("|");
              if (sig !== this._overlaySig) {
                this._overlaySig = sig;
                this.applyOverlayStyle();
              }
              const useMouse = this.updateOverlayTarget();
              const lerp = this.look.overlaySpeed;
              this.x += (this.tx - this.x) * lerp;
              this.y += (this.ty - this.y) * lerp;
              const settled = Math.abs(this.tx - this.x) < 0.25 && Math.abs(this.ty - this.y) < 0.25;
              if (!settled) this._torchGear = "hot";
              else {
                this.x = this.tx;
                this.y = this.ty;
              }
              const spots = this.torchSpotlights(useMouse, lerp);
              const isMobile = this.overlay.ownerDocument.body.classList.contains("is-mobile");
              const spare = isMobile || !!this.look.overlaySpareSidebars;
              const r = spare ? this.getMainAreaRect(this.overlay.ownerDocument) : null;
              const usePane = !!r;
              const rect = usePane ? r : this.getFullViewportRect(this.overlay.ownerDocument);
              const notes = usePane ? this.getNoteTabRects(this.overlay.ownerDocument) : null;
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
              const hideForModal = spare && (this.modalOpen || notes !== null && notes.length === 0) || isMobile && (this._coverOpen || this._drawerOpen());
              const pulse = !hideForModal && !!this.look.overlayBlinkSync && !!this.look.blinkingEnabled;
              let radius = this.look.overlayRadius;
              if (pulse) {
                const depth = Math.max(0, Math.min(1, this.look.overlayBlinkDepth ?? 0.25));
                const tNow = performance.now();
                radius *= 1 - depth * (1 - this.blinkPhase(tNow));
                const w = this.blinkWindow(tNow);
                if (w.fading && this._torchGear === "idle") this._torchGear = "pulse";
                this._torchIdleWakeMs = w.msToNext;
              }
              const rKey = Math.max(1, Math.round(radius));
              this._lastTorchRadius = rKey;
              const hidden = hideForModal;
              const fScale = !hidden && this.look.overlayFlicker ? torchFlickerScale(
                performance.now(),
                this.look.overlayFlickerAmount ?? 0.3
              ) : 1;
              if (fScale !== 1 && this._torchGear === "idle") {
                this._torchGear = "pulse";
              }
              const baseI = this.look.overlayIntensity;
              const glow = this._ensureGlowLayer(!hidden && baseI > 0);
              const local = spots.map((sp) => ({ x: sp.x - left, y: sp.y - top }));
              this._overlayBox = { top, left, width, height };
              this._torchRegions = notes;
              const regions = this._torchLocalRegions();
              this._torchPaintDarkness(local, rKey, this.look.overlayDarkness, width, height, regions);
              if (glow) {
                if (key !== this._lastGlowRect) {
                  this._lastGlowRect = key;
                  glow.style.top = top + "px";
                  glow.style.left = left + "px";
                  glow.style.width = width + "px";
                  glow.style.height = height + "px";
                }
                const gAlpha = Math.max(0, Math.min(1, baseI * fScale)).toFixed(2);
                if (gAlpha !== this._lastGlowAlpha) {
                  this._lastGlowAlpha = gAlpha;
                  glow.style.setProperty("--torch-glow", gAlpha);
                }
                this._torchPaintGlow(local, rKey, hexToRgb(this.look.overlayColor), width, height, regions);
              }
              this.overlay.classList.toggle("cursor-smith-torch-hidden", !!hideForModal);
            }
          }
        }
      } catch (e) {
        this._reportOnce("torch tick (loop kept alive)", e);
      }
      schedule();
    };
    this._torchTick = tick;
    this._torchGear = "hot";
    this.torchRaf = window.requestAnimationFrame(tick);
  },
  // Sets this.tx/ty, the primary spotlight's target. Returns true when the
  // torch is following the mouse - in which case there is one light and
  // the secondaries get none (torchSpotlights).
  updateOverlayTarget() {
    const mode = this.look.overlayFollowMode;
    const here = this.overlay ? this.overlay.ownerDocument : null;
    const sameDoc = !here || !this.canvasWrapper || this.canvasWrapper.ownerDocument === here;
    const box = this._overlayBox;
    const regions = this._torchRegions;
    const inBox = (b, x, y) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
    const inside = (x, y) => (!box || inBox(box, x, y)) && (!regions || regions.some((b) => inBox(b, x, y)));
    const measured = sameDoc ? this.caretCoords() : null;
    const caret = measured && inside(measured.x, (measured.top + measured.bottom) / 2) ? measured : null;
    const mouseHere = (!here || !this._mouseDoc || this._mouseDoc === here) && inside(this.mouseX, this.mouseY);
    if (caret) {
      if (!this.lastCaret || caret.x !== this.lastCaret.x || caret.top !== this.lastCaret.top) {
        this.lastCaretMove = performance.now();
      }
      this.lastCaret = caret;
    }
    const useMouse = mode === "mouse" || mode === "auto" && (performance.now() - this.lastMouseMove < 800 || !this.lastCaret);
    if (useMouse) {
      if (mouseHere) {
        this.tx = this.mouseX;
        this.ty = this.mouseY;
      }
    } else if (this.lastCaret) {
      this.tx = this.lastCaret.x;
      this.ty = (this.lastCaret.top + this.lastCaret.bottom) / 2;
    }
    return !!useMouse;
  },
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
      if (!a) {
        st.torchX = st.torchY = void 0;
        continue;
      }
      const tx = a.x;
      const ty = a.top + (a.h || 0) / 2;
      if (st.torchX === void 0 || st.torchY === void 0) {
        st.torchX = tx;
        st.torchY = ty;
      }
      st.torchX += (tx - st.torchX) * lerp;
      st.torchY += (ty - st.torchY) * lerp;
      if (Math.abs(tx - st.torchX) < 0.25 && Math.abs(ty - st.torchY) < 0.25) {
        st.torchX = tx;
        st.torchY = ty;
      } else {
        this._torchGear = "hot";
      }
      spots.push({ x: st.torchX, y: st.torchY });
    }
    return spots;
  },
  // A side pane open over the note: on a phone the drawers, on desktop the
  // docks (only the phone reads it). The workspace's own flags, not the
  // DOM: WorkspaceMobileDrawer and WorkspaceSidedock both carry
  // `collapsed`.
  _drawerOpen() {
    try {
      const ws = this.app.workspace;
      const l = ws.leftSplit, r = ws.rightSplit;
      return !!(l && !l.collapsed || r && !r.collapsed);
    } catch {
      return false;
    }
  },
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
};

// src/library.ts
var import_obsidian3 = require("obsidian");
var libraryMethods = {
  // ---- User preset CRUD ----
  getUserPresets() {
    if (!this.settings.userPresets) this.settings.userPresets = {};
    return this.settings.userPresets;
  },
  async saveUserPreset(name) {
    const snap = Object.assign({}, this.settings);
    delete snap.enabled;
    delete snap.userPresets;
    for (const k of VIM_STATE_KEYS) delete snap[k];
    this.getUserPresets()[name] = snap;
    await this.saveSettings();
  },
  async loadUserPreset(name) {
    const preset = this.getUserPresets()[name];
    if (!preset) return;
    const wasEnabled = this.settings.enabled;
    const presets = this.getUserPresets();
    const vimState = {};
    const dst = vimState, src = this.settings;
    for (const k of VIM_STATE_KEYS) dst[k] = src[k];
    Object.assign(this.settings, presetWithDefaults(preset));
    this.settings.enabled = wasEnabled;
    this.settings.userPresets = presets;
    Object.assign(this.settings, vimState);
    await this.saveSettings();
    if (this.settings.enabled) this.enable();
    this._activePresetName = name;
  },
  async deleteUserPreset(name) {
    delete this.getUserPresets()[name];
    await this.saveSettings();
  },
  // The single palette command routes here: cycle whichever preset library
  // belongs to the mode the user is actually in.
  cycleActivePreset(direction) {
    if (this.isVimUiMode()) return this.cycleVimPreset(direction);
    return this.cyclePreset(direction);
  },
  cyclePreset(direction) {
    const presets = this.getUserPresets();
    const names = Object.keys(presets);
    if (names.length === 0) return;
    const current = this._activePresetName ?? null;
    const currentIdx = names.indexOf(current);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];
    void this.loadUserPreset(nextName).then(() => {
      this._activePresetName = nextName;
      this._pendingPresetName = nextName;
      new import_obsidian3.Notice(`Cursor-Smith: ${nextName}`);
      this.refreshSettingTab();
    });
  },
  // Returns the name it was saved under, or null if the code was invalid.
  async importPreset(code) {
    const result = codeToPreset(code.trim());
    if (!result) return null;
    this.getUserPresets()[result.name] = result.snap;
    await this.saveSettings();
    return result.name;
  },
  // ---- Vim preset CRUD (independent of the regular cursor presets) ----
  getVimPresets() {
    if (!this.settings.vimPresets) this.settings.vimPresets = {};
    return this.settings.vimPresets;
  },
  async saveVimPreset(name) {
    this.getVimPresets()[name] = cloneVimModes(this.settings.vimModes);
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  },
  async loadVimPreset(name) {
    const preset = this.getVimPresets()[name];
    if (!preset) return;
    for (const mode of VIM_MODE_KEYS) {
      this.settings.vimModes[mode] = vimModeSnapshot(mode, preset[mode]);
    }
    this.settings.vimActivePreset = name;
    await this.saveSettings();
  },
  async deleteVimPreset(name) {
    delete this.getVimPresets()[name];
    if (this.settings.vimActivePreset === name) this.settings.vimActivePreset = "";
    await this.saveSettings();
  },
  async cycleVimPreset(direction) {
    const names = Object.keys(this.getVimPresets());
    if (names.length === 0) {
      new import_obsidian3.Notice("Cursor-Smith: no Vim presets are saved");
      return;
    }
    const currentIdx = names.indexOf(this.settings.vimActivePreset);
    const nextIdx = (currentIdx + direction + names.length) % names.length;
    const nextName = names[nextIdx];
    if (!this.settings.vimModeEnabled) await this.setVimModeEnabled(true);
    await this.loadVimPreset(nextName);
    new import_obsidian3.Notice(`Cursor-Smith: Vim preset \u2014 ${nextName}`);
    this.refreshSettingTab();
  },
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
};

// src/vim.ts
var import_obsidian4 = require("obsidian");
var vimMethods = {
  // Whether the plugin is currently "in Vim mode" for command purposes.
  // uiMode is the user-facing switch and vimModeEnabled is the feature flag;
  // renderModeSwitch and setVimModeEnabled keep them in step, but an install that
  // predates uiMode can have only the latter, so treat either as Vim.
  isVimUiMode() {
    return (this.settings.uiMode || "cua") === "vim" || !!this.settings.vimModeEnabled;
  },
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
      new import_obsidian4.Notice(`Cursor-Smith: ${next ? "Vim" : "CUA / Normal"} mode`);
      this.refreshSettingTab();
    } finally {
      this._uiModeSwitching = false;
    }
  },
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
    this.settings.vimModeEnabled = value;
    this.settings.uiMode = value ? "vim" : "cua";
    await this.saveSettings();
    if (this.settings.vimControlObsidian) {
      try {
        if (value) {
          this.setObsidianVim(true);
          this.forceVimNormalMode();
        } else {
          this.setObsidianVim(false);
        }
      } catch (e) {
        console.error("[cursor-smith] driving Obsidian vim keybindings failed:", e);
      }
    }
    try {
      this.syncVimStatusBar();
    } catch (e) {
      console.error("[cursor-smith] vim status bar update failed:", e);
    }
  },
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
    if (this._vimNormalRetryT) {
      window.clearTimeout(this._vimNormalRetryT);
      this._vimNormalRetryT = 0;
    }
    if (!this.settings.vimModeEnabled) return;
    let anyEditor = false;
    try {
      for (const view of this.allEditorViews()) {
        anyEditor = true;
        const cm = this.getVimAdapter(view);
        if (!cm) {
          anyEditor = false;
          break;
        }
        const v = cm.state.vim || {};
        if (!v.insertMode && !v.visualMode) continue;
        const target = view.contentDOM;
        if (!target) continue;
        const win = target.ownerDocument.defaultView || window;
        target.dispatchEvent(new win.KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true
        }));
      }
    } catch (e) {
      this._reportOnce("forceVimNormalMode", e);
    }
    if (!anyEditor && attempt < 20) {
      this._vimNormalRetryT = window.setTimeout(() => {
        this._vimNormalRetryT = 0;
        this.forceVimNormalMode(attempt + 1);
      }, 50);
    }
  },
  // Every live CodeMirror view across all open markdown leaves (including
  // pop-out windows), not just the focused one — switching modes should settle
  // every editor, otherwise a background tab stays in insert until you visit
  // it and press Escape yourself.
  allEditorViews() {
    const views = [];
    const push = (v) => {
      if (v && !views.includes(v)) views.push(v);
    };
    try {
      push(this.app.workspace.activeEditor?.editor?.cm);
      this.app.workspace.iterateAllLeaves?.((leaf) => {
        push(leaf?.view?.editor?.cm);
      });
    } catch (e) {
      this._reportOnce("allEditorViews", e);
    }
    return views;
  },
  // Turn Obsidian's built-in Vim keybindings on/off. setConfig is semi-internal
  // (guarded); updateOptions asks the workspace to re-derive editor extensions
  // so the change can take effect without a reload where that's supported.
  setObsidianVim(on) {
    try {
      if (this.app.vault.setConfig) this.app.vault.setConfig("vimMode", !!on);
      this.app.workspace.updateOptions?.();
    } catch (e) {
      this._reportOnce("setObsidianVim", e);
    }
  },
  // Whether Obsidian's own Vim keybindings are turned on (Settings → Editor →
  // Vim key bindings). getConfig is a semi-internal API, so it's fully guarded.
  isObsidianVimOn() {
    try {
      return !!(this.app.vault.getConfig && this.app.vault.getConfig("vimMode"));
    } catch (e) {
      this._reportOnce("isObsidianVimOn", e);
      return false;
    }
  },
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
    }
    return null;
  },
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
    } catch (e) {
      this._reportOnce("_vimBlockCursorShown", e);
      return false;
    }
  },
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
        const replace = cm.state.overwrite || v.insertModeReplace || v.replaceMode;
        return replace ? "replace" : "insert";
      }
      return "normal";
    }
    try {
      if (!view.state.selection.main.empty) return "visual";
      return this._vimBlockCursorShown(view) ? "normal" : "insert";
    } catch (e) {
      this._reportOnce("detectVimMode", e);
      return null;
    }
  },
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
      if (view && view.hasFocus) return false;
      const doc = view && view.dom && view.dom.ownerDocument || this.canvas?.ownerDocument || document;
      return isTextCaretHost(doc.activeElement);
    } catch (e) {
      this._reportOnce("isVimCommandContext", e);
      return false;
    }
  },
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
        if (this.isVimCommandContext()) {
          mode = "command";
        } else {
          const view = this.app.workspace.activeEditor?.editor?.cm;
          if (view && view.hasFocus) mode = this.detectVimMode(view);
        }
      }
    } catch (e) {
      this._reportOnce("currentVimMode", e);
      mode = null;
    }
    this._vimModeCache = mode;
    this._vimModeCacheT = now;
    return mode;
  },
  // Called from the canvas tick the frame the active Vim mode changes. The
  // torch tick already reacts per-frame to the effective settings, but clearing
  // its cached style/rect signatures here makes the spotlight update on the
  // very next frame instead of waiting for the dedupe key to differ.
  onVimModeChanged() {
    this._overlaySig = "";
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this.updateVimStatusBar();
  },
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
    }
    return null;
  },
  // Create the status bar element on demand, remove it when it shouldn't be
  // there. Kept as add/remove rather than a permanently-present hidden element
  // so the status bar doesn't carry an empty slot (and its separator padding)
  // for everyone who has the indicator switched off.
  syncVimStatusBar() {
    if (typeof this.addStatusBarItem !== "function") return;
    const wanted = !!(this.settings.vimStatusBar && this.settings.vimModeEnabled);
    if (wanted && !this.vimStatusEl) {
      this.vimStatusEl = this.addStatusBarItem();
      this.vimStatusEl.addClass?.("cursor-smith-vim-status");
      this.vimStatusEl.addClass("cursor-smith-vim-status");
      this._vimStatusSig = null;
      if (!this._vimStatusTimer) this._vimStatusTimer = window.setInterval(() => this.updateVimStatusBar(), 250);
    } else if (!wanted && this.vimStatusEl) {
      this.vimStatusEl.remove();
      this.vimStatusEl = null;
      this._vimStatusSig = null;
      if (this._vimStatusTimer) {
        window.clearInterval(this._vimStatusTimer);
        this._vimStatusTimer = 0;
      }
    }
    this.updateVimStatusBar();
  },
  updateVimStatusBar() {
    const el = this.vimStatusEl;
    if (!el) return;
    try {
      const mode = this.statusBarVimMode();
      const doc = el.ownerDocument || document;
      const isDark = doc.body.classList.contains("theme-dark");
      const tint = !!this.settings.vimStatusBarColor;
      const sig = `${mode}|${isDark}|${tint}`;
      if (sig === this._vimStatusSig) return;
      this._vimStatusSig = sig;
      if (!mode) {
        el.setText("");
        el.setCssStyles({ color: "" });
        return;
      }
      el.setText(`-- ${(VIM_MODE_LABELS[mode] || mode).toUpperCase()} --`);
      if (!tint) {
        el.setCssStyles({ color: "" });
        return;
      }
      const cfg = this.settings.vimModes && this.settings.vimModes[mode] || null;
      el.style.color = cfg ? isDark ? cfg.colorDark : cfg.colorLight : "";
    } catch (e) {
      this._reportOnce("updateVimStatusBar", e);
    }
  }
};

// src/engine.ts
var import_obsidian5 = require("obsidian");

// src/geometry.ts
function fitCanvasRegion(need, clip, current, opts = {}) {
  const marginX = opts.marginX ?? CANVAS_REGION_MARGIN_X;
  const marginY = opts.marginY ?? 32;
  const grid = opts.grid ?? CANVAS_REGION_GRID;
  if (!need || !clip || clip.w <= 0 || clip.h <= 0) return current;
  const cx1 = clip.x + clip.w, cy1 = clip.y + clip.h;
  const nx0 = Math.max(clip.x, Math.floor(need.x0));
  const ny0 = Math.max(clip.y, Math.floor(need.y0));
  const nx1 = Math.min(cx1, Math.ceil(need.x1));
  const ny1 = Math.min(cy1, Math.ceil(need.y1));
  if (nx1 <= nx0 || ny1 <= ny0) return current;
  const contains = current && nx0 >= current.x && ny0 >= current.y && nx1 <= current.x + current.w && ny1 <= current.y + current.h;
  let w = Math.min(clip.w, Math.ceil((nx1 - nx0 + 2 * marginX) / grid) * grid);
  let h = Math.min(clip.h, Math.ceil((ny1 - ny0 + 2 * marginY) / grid) * grid);
  if (contains) {
    if (!opts.allowShrink) return current;
    if (current.w * current.h <= CANVAS_REGION_SHRINK_RATIO * w * h) return current;
  } else if (current && w <= current.w && h <= current.h) {
    w = current.w;
    h = current.h;
  }
  let x = Math.round((nx0 + nx1) / 2 - w / 2);
  let y = Math.round((ny0 + ny1) / 2 - h / 2);
  if (x + w > cx1) x = cx1 - w;
  if (y + h > cy1) y = cy1 - h;
  if (x < clip.x) x = clip.x;
  if (y < clip.y) y = clip.y;
  if (current && x === current.x && y === current.y && w === current.w && h === current.h) return current;
  return { x, y, w, h };
}
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
  const W = width, H = height;
  const clipPath = `polygon(0 0, ${W}px 0, ${W}px ${H}px, ${nx1}px ${H}px, ${nx1}px ${ny}px, ${nx0}px ${ny}px, ${nx0}px ${H}px, 0 ${H}px)`;
  return { height, clipPath };
}

// src/engine.ts
var engineMethods = {
  // The element the canvas wrapper hangs from: the focused editor's
  // scroller, where the wrapper rides with the scrolled content - the
  // compositor carries it with the text between ticks; the app container,
  // fixed, while focus is not in the editor (a search field, a prompt: those
  // carets are clipped to their own boxes by the fixed wrapper), the scroller
  // belongs to another document, or it sits in a Canvas card (scaled by a
  // transform the placement does not know).
  //
  // On a phone since 1.6.2; on the desktop since 1.6.5, while no torch can
  // be on. A fixed caret trailed every wheel tick by one frame - a whole
  // scroll step, 55 px, then back: "the cursor jitters around when
  // scrolling" (a Reddit user, who blamed Smooth movement; it did the same
  // with it off). The torch keeps the fixed wrapper: inside the scroller the
  // caret would sit under its darkness and its glow, which is what the
  // phone accepts and the desktop's layering (z 10010-10012) was built
  // against. Word-Smith's bands and bar need no clip in the scroller: they
  // sit above its stacking context.
  _wrapperHome(doc, view) {
    const app = doc.querySelector(".app-container") || doc.body;
    if (!view || !this.editorFocused(view)) return app;
    if (!doc.body.classList.contains("is-mobile") && this.torchPossible()) return app;
    const sc = view.scrollDOM;
    if (!sc || !sc.isConnected || sc.ownerDocument !== doc) return app;
    return sc.closest(".canvas-node") ? app : sc;
  },
  ensureCanvasForView(view) {
    const targetDoc = (this.editorFocused(view) ? null : this._focusedForeignDoc(view)) || view && view.dom.ownerDocument || this.canvasWrapper && this.canvasWrapper.ownerDocument || typeof activeDocument !== "undefined" && activeDocument || document;
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument !== targetDoc) {
      this.canvasWrapper.remove();
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
      this._canvasRect = null;
    }
    if (!this.canvasWrapper) {
      targetDoc.body.classList.add("cursor-smith-active");
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.canvasWrapper = appContainer.createDiv({ cls: "cursor-smith-wrapper" });
      this._lastWrapperRect = "";
      this._canvasBlend = "";
      this.canvas = this.canvasWrapper.createEl("canvas", { cls: "cursor-smith-canvas" });
      this.ctx = this.canvas.getContext("2d");
      this._canvasRect = null;
      this._canvasDpr = 0;
      this._wrapperPos = null;
      this._dirtyRaw = null;
    }
    const home = this._wrapperHome(targetDoc, view);
    if (this.canvasWrapper.parentElement !== home) {
      home.appendChild(this.canvasWrapper);
      this.canvasWrapper.classList.toggle("cursor-smith-wrapper-scrolled", home.classList.contains("cm-scroller"));
      this._lastWrapperRect = "";
      this._wrapperPos = null;
      this._canvasPlaced = false;
      this._dirtyFull = true;
    }
    if (!targetDoc.body.classList.contains("cursor-smith-active")) {
      targetDoc.body.classList.add("cursor-smith-active");
    }
    const hideNative = this.hideNativeActive();
    targetDoc.body.classList.toggle("cursor-smith-hide-native", hideNative);
    if (hideNative !== this._hideNativeSig) {
      this._hideNativeSig = hideNative;
      try {
        this.applyBodyClasses();
      } catch (e) {
        this._reportOnce("applyBodyClasses in the tick", e);
      }
    }
  },
  // The canvas layers this plugin put into a document (and one more it
  // names, the wrapper's own document when that is not registered), gone.
  _removeLayers(extra = null) {
    const docs = /* @__PURE__ */ new Set([document, ...Array.from(this.registeredDocuments)]);
    if (extra) docs.add(extra);
    for (const doc of docs) {
      if (!doc || !doc.body) continue;
      doc.body.classList.remove("cursor-smith-active", "cursor-smith-hide-native");
      doc.querySelectorAll(".cursor-smith-wrapper, .cursor-smith-canvas").forEach((el) => {
        el.remove();
      });
    }
  },
  disableCanvasEngine() {
    this.canvasEngineActive = false;
    if (this.canvasRaf) {
      window.cancelAnimationFrame(this.canvasRaf);
      this.canvasRaf = 0;
    }
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
    }
    this._canvasTick = null;
    this._drawSig = null;
    this._caretGeoCache = null;
    this._paneRectCache = null;
    this._mainRectCache = null;
    this._observeEditorLayout(null);
    this._removeLayers(this.canvasWrapper ? this.canvasWrapper.ownerDocument : null);
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this._canvasRect = null;
    this._clipRect = null;
    this._wrapperPos = null;
    this._dirtyRaw = null;
    this._resetEngineState();
    this._formMirror?.remove();
    this._formMirror = null;
  },
  enableCanvasEngine() {
    this.canvasEngineActive = true;
    this._resetEngineState();
    this._suspendCleared = false;
    if (this.ctx && this.canvas) this._clearCanvas();
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyRaw = null;
    this._dirtyFull = true;
    this._canvasRect = null;
    this._regionOversizedT = 0;
    const schedule = () => {
      if (!this.canvasEngineActive) return;
      const gear = this._canvasGear || "hot";
      const caps = this._frameCaps();
      if (gear === "hot") {
        this.canvasRaf = window.requestAnimationFrame(tick);
        return;
      }
      const idleMs = Math.min(caps.idleMs, Math.max(1, Math.ceil(this._idleWakeMs || caps.idleMs)));
      this._canvasIdleT = window.setTimeout(() => {
        this._canvasIdleT = 0;
        if (this.canvasEngineActive) this.canvasRaf = window.requestAnimationFrame(tick);
      }, gear === "warm" ? caps.warmMs : gear === "energy" ? caps.energyMs : idleMs);
    };
    const tick = () => {
      if (!this.canvasEngineActive) return;
      this._lastTickT = performance.now();
      const perf = this._perf;
      if ((this._canvasGear || "hot") === "hot") {
        const n = performance.now();
        if (perf) {
          if (perf.rafPrev) {
            const d = n - perf.rafPrev;
            if (d > 1 && d < 100) {
              const b = Math.round(d * 2) / 2;
              perf.rafGaps[b] = (perf.rafGaps[b] || 0) + 1;
            }
          }
          perf.rafPrev = n;
        }
        if (!this._hotCapLifted(n) && n - (this._lastHotFrameT || 0) < this._frameCaps().hotMinMs) {
          this.canvasRaf = window.requestAnimationFrame(tick);
          return;
        }
        this._lastHotFrameT = n;
      } else if (perf) {
        perf.rafPrev = 0;
      }
      const tTick = perf ? performance.now() : 0;
      try {
        if (this.presentationActive() || !this.windowFocused()) {
          if (this.ctx && this.canvas && !this._suspendCleared) {
            this._clearCanvas();
            this._suspendCleared = true;
            this._dirtyPrev = null;
            this._drawSig = null;
          }
          this._canvasGear = "idle";
          this._idleWakeMs = 0;
          schedule();
          return;
        }
        this._suspendCleared = false;
        const view = this.app.workspace.activeEditor?.editor?.cm;
        this.ensureCanvasForView(view);
        if (view) this.registerWindowEvents(view.dom.ownerDocument);
        this._observeEditorLayout(view);
        if (this.canvasWrapper) {
          this.registerWindowEvents(this.canvasWrapper.ownerDocument);
        }
        const scrolledWrapper = !!this.canvasWrapper && !!view && this.canvasWrapper.classList.contains("cursor-smith-wrapper-scrolled") && this.canvasWrapper.parentElement === view.scrollDOM;
        if (this.canvasWrapper && this.canvas && scrolledWrapper && view) {
          const sc = view.scrollDOM;
          const sr = sc.getBoundingClientRect();
          const top = Math.round(sr.top - sc.scrollTop);
          const left = Math.round(sr.left - sc.scrollLeft);
          const cr = view.contentDOM.getBoundingClientRect();
          const width = Math.max(1, sc.clientWidth, Math.ceil(cr.right - left));
          const height = Math.max(1, sc.clientHeight, Math.ceil(cr.bottom - top));
          this._clipTop = Math.round(sr.top);
          const key = "scrolled|" + width + "," + height;
          if (key !== this._lastWrapperRect) {
            this._lastWrapperRect = key;
            this._dirtyFull = true;
            this.canvasWrapper.style.removeProperty("top");
            this.canvasWrapper.style.removeProperty("left");
            this.canvasWrapper.style.removeProperty("clip-path");
            this.canvasWrapper.style.width = width + "px";
            this.canvasWrapper.style.height = height + "px";
          }
          if (!this._wrapperPos || this._wrapperPos.left !== left || this._wrapperPos.top !== top) {
            this._wrapperPos = { left, top };
            this._canvasPlaced = false;
          }
          this._clipRect = { x: left, y: top, w: width, h: height };
        } else if (this.canvasWrapper && this.canvas) {
          const r = (view && this.editorFocused(view) ? this.getPaneRect(view) : this.getCaretClipRect(this.canvas.ownerDocument)) || // Never 100vw/100vh here: a full-viewport layer over the
          // titlebar kills Electron's window-drag hit-testing on
          // Linux/Windows (drag regions compose in DOM order; z-index
          // and pointer-events are irrelevant to them).
          this.getFullViewportRect(this.canvas.ownerDocument);
          let top = Math.round(r.top);
          const left = Math.round(r.left);
          const width = Math.round(r.width);
          let height = Math.round(r.height);
          const ins = this._chromeInsets(this.canvas.ownerDocument);
          const coverTop = Math.max(top, Math.ceil(ins.coverTop));
          const coverBottom = Math.min(top + height, Math.floor(ins.coverBottom));
          if (coverTop > top || coverBottom < top + height) {
            top = coverTop;
            height = Math.max(0, coverBottom - coverTop);
          }
          this._clipTop = top;
          let clipPath = "";
          if (ins.bottomInset > 0) {
            const win = this.canvas.ownerDocument.defaultView || window;
            const cut = wrapperClipForStatusBar(
              { top, left, width, height },
              { top: win.innerHeight - ins.bottomInset, left: ins.statusLeft, right: ins.statusRight }
            );
            height = cut.height;
            clipPath = cut.clipPath;
          }
          const key = top + "," + left + "," + width + "," + height + "|" + clipPath;
          if (key !== this._lastWrapperRect) {
            this._lastWrapperRect = key;
            this._dirtyFull = true;
            this.canvasWrapper.style.top = top + "px";
            this.canvasWrapper.style.left = left + "px";
            this.canvasWrapper.style.width = width + "px";
            this.canvasWrapper.style.height = height + "px";
            this.canvasWrapper.style.clipPath = clipPath;
            this._wrapperPos = { left, top };
            this._clipRect = { x: left, y: top, w: width, h: height };
            this._canvasPlaced = false;
          }
        }
        const _vimMode = this.currentVimMode();
        if (_vimMode !== this._appliedVimMode) {
          this._appliedVimMode = _vimMode;
          this.onVimModeChanged();
        }
        {
          this._tickNo = (this._tickNo || 0) + 1;
          const flagsAtFrame = {
            del: this._deletePending,
            enter: this._enterPending,
            pop: this._popKeyPending
          };
          this.rematchCaretStates(view);
          const tCaret = perf ? performance.now() : 0;
          this.updateActivePoint();
          if (perf) perf.caretMs += performance.now() - tCaret;
          this.updateSmoothCursor();
          this.updateSecondaryCarets(view, flagsAtFrame);
          this.bracketTether = this.mergeTethers(
            this.look.bracketTether ? this.bracketTetherCoords(view) : null
          );
          this.updateSmearQuad();
          this.pruneTrail();
          if (this.heat > 0) {
            this.heat *= 0.985;
            if (this.heat < 1e-3) this.heat = 0;
          }
          if (this.look.speedDemon && this.look.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) {
            this.maybeSpawnHotHead();
          }
          this.maybeSpawnStardust();
          const nowT = performance.now();
          const g = this._decideGear(nowT, !!perf);
          this._canvasGear = g.gear;
          this._idleWakeMs = g.idleWake;
          if (perf) perf.why[g.why] = (perf.why[g.why] || 0) + 1;
          let doDraw = true;
          if (g.staticFrame) {
            const sig = this._frameSignature(_vimMode, g.blinkBucket);
            if (sig === this._drawSig) doDraw = false;
            else this._drawSig = sig;
          } else {
            this._drawSig = null;
          }
          if (this._dirtyFull) doDraw = true;
          if (this._fitCanvasRegion()) {
            doDraw = true;
            if (perf) perf.reanchors++;
          }
          if (doDraw && this._canvasRect) {
            const tDraw = perf ? performance.now() : 0;
            this.draw();
            if (perf) {
              perf.draws++;
              perf.drawMs += performance.now() - tDraw;
            }
          }
        }
      } catch (e) {
        this._reportOnce("canvas tick (loop kept alive)", e);
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
    this._idleWakeMs = 0;
    this._lastTickT = performance.now();
    this.canvasRaf = window.requestAnimationFrame(tick);
  },
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
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyFull = false;
    this._caretStyleCache = null;
  },
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
  },
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
  },
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
    if (this.thunderbolts && this.thunderbolts.length || this.fireworks && this.fireworks.length) {
      return { x0: clip.x, y0: clip.y, x1: clip.x + clip.w, y1: clip.y + clip.h };
    }
    let b = null;
    const add = (x0, y0, x1, y1) => {
      if (!b) {
        b = { x0, y0, x1, y1 };
        return;
      }
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
      add(
        la.x - pad,
        la.top - pad,
        la.x + Math.max(la.w || 0, la.actualCharWidth || 0) + pad,
        la.top + (la.h || 0) + pad
      );
    }
    if (this.secondaryCarets && this.secondaryCarets.length) {
      for (const c of this.secondaryCarets) add(c.x - 4, c.top - 4, c.x + 8, c.bottom + 4);
    }
    if (this._secondaries && this._secondaries.length) {
      for (const st of this._secondaries) {
        if (!st.animActive) continue;
        const sb = this._withCaret(st, () => this._cursorBounds());
        if (sb) add(sb.x0, sb.y0, sb.x1, sb.y1);
        const sl = st.lastActive;
        if (sl && sl !== st.animActive) {
          add(
            sl.x - 24,
            sl.top - 24,
            sl.x + Math.max(sl.w || 0, sl.actualCharWidth || 0) + 24,
            sl.top + (sl.h || 0) + 24
          );
        }
      }
    }
    if (this.bracketTether && this.bracketTether.length) {
      for (const s of this.bracketTether) {
        add(
          Math.min(s.x1, s.x2) - 4,
          Math.min(s.y1, s.y2) - 4,
          Math.max(s.x1, s.x2) + 4,
          Math.max(s.y1, s.y2) + 4
        );
      }
    }
    const r = this._dirtyRaw;
    if (r) {
      const p = CANVAS_REGION_MOTION_PAD;
      add(r.x0 - p, r.y0 - p, r.x1 + p, r.y1 + p);
    }
    return b;
  },
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
    if (cur && (cur.x < clip.x || cur.y < clip.y || cur.x + cur.w > clip.x + clip.w || cur.y + cur.h > clip.y + clip.h)) {
      cur = null;
    }
    const need = this._frameNeed(clip);
    const lh = this.animActive && this.animActive.h || this.lastActive && this.lastActive.h || 24;
    const marginY = Math.round(CANVAS_REGION_MARGIN_Y * lh);
    const now = performance.now();
    let allowShrink = false;
    if (cur && need) {
      const nw = Math.min(clip.w, need.x1 - need.x0 + 2 * CANVAS_REGION_MARGIN_X);
      const nh = Math.min(clip.h, need.y1 - need.y0 + 2 * marginY);
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
      marginX: CANVAS_REGION_MARGIN_X,
      marginY,
      grid: CANVAS_REGION_GRID,
      allowShrink
    });
    if (next === cur && cur === this._canvasRect && dpr === this._canvasDpr) {
      if (!this._canvasPlaced) this._placeCanvas();
      return false;
    }
    if (!next) {
      if (this._canvasRect) this._clearCanvas();
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
    this._dirtyFull = false;
    this._dirtyPrev = null;
    return true;
  },
  // The render loops' frame intervals for the current Low Power setting.
  // Global, not a look: read off this.settings directly, which a per-Vim-mode
  // swap leaves untouched because no mode snapshot carries the key.
  // Whether the hot gear's frame cap is off for the frame at `n`. The cap
  // skips every other frame on a 120 Hz screen (every second or third in
  // Low Power) while the text moves on every one, so a caret that moves
  // with the text trails it on half the frames:
  //
  //   - a scroll (SCROLL_LOCK_MS after the scroller's own scroll or wheel
  //     event, on its own stamp - the activity kind is overwritten by every
  //     touch or pointer move between two scroll events): the wobble;
  //   - typing (1.6.4), outside Low Power: while the drawn caret glides or
  //     its smear moves, and SCROLL_LOCK_MS after a key, so the frame that
  //     shows the new text shows the caret beside it. "The whole cursor is
  //     laggy when typing fast" on a 120 Hz laptop: the plugin ran 60 ticks
  //     a second while the screen ran 120 (measured, 2026-09-24). Low Power
  //     keeps its cap there - it is the switch for trading this away.
  _hotCapLifted(n) {
    if (n - (this._lastScrollT || 0) < SCROLL_LOCK_MS) return true;
    if (this.settings && this.settings.lowPowerMode) return false;
    return !!(this._smoothMoving || this._smearMoving) || n - (this._realKeyT || 0) < SCROLL_LOCK_MS;
  },
  _frameCaps() {
    return this.settings && this.settings.lowPowerMode ? FRAME_CAPS.lowPower : FRAME_CAPS.normal;
  },
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
  // loop judges the frame static, drops to its idle heartbeat, and the
  // effect freezes mid-animation whenever nothing else happens to be moving. It
  // was previously guarded by a comment alone while every other effect invariant
  // in this file had coverage. See test.js, "frame governor".
  //
  // MUST STAY A PURE READ. The gear decision runs before draw(), and anything
  // that retires state here (glitchState() would - it drops an expired burst as
  // a side effect) would retire it before the frame that should have painted it.
  // ---------------------------------------------------------------------------
  _isAnimating(nowT) {
    const crt = !!this.look.crtEffect;
    return !!this._smoothMoving || !!this.pending || crt && this.trail && this.trail.length > 0 || this.particles && this.particles.length > 0 || // flamePixels are aged inside draw(), so a skipped frame would
    // freeze a burst mid-flight rather than letting it expire.
    this.flamePixels && this.flamePixels.length > 0 || // Same again for Hot-head's fire, aged in its own draw call.
    this.flameEmbers && this.flameEmbers.length > 0 || // ...and the effect itself, not just its live particles. While
    // Hot-head is on the fire is continuously animating by definition,
    // and the particle test alone has a hole in it: the instant the
    // pool empties the loop would judge the frame static, drop to the
    // idle heartbeat, and the next spawn would arrive as one
    // lumpy burst instead of a steady flame.
    !!this.styleFor("hotHead") && !!this.animActive && this.hotHeadFeeding(nowT) || // Same reasoning: a bolt is aged and expired inside its draw call,
    // so a skipped frame would leave one frozen on screen.
    this.thunderbolts && this.thunderbolts.length > 0 || // And again for a firework. Note this covers a shell still sitting
    // out its stagger delay, which paints nothing yet but must not be
    // allowed to drop the loop into the idle heartbeat - the volley
    // would land in lumps a tenth of a second apart.
    this.fireworks && this.fireworks.length > 0 || // A Signal Glitch burst is a ~200ms wall-clock animation, so it
    // needs continuous frames for its whole life. Tested inline rather
    // than via glitchState() because that RETIRES an expired burst as a
    // side effect, and the gear decision must stay a pure read - the
    // draw call below is what should do the retiring.
    !!this.glitch && nowT - this.glitch.start < this.glitch.dur || this.heat > 0 || // Every full-effect secondary carries the same motion fields (see
    // CARET_STATE_FIELDS), and a settling spring or a live trail on any of
    // them needs frames exactly as the primary's does. A pure read of the
    // bundles, nothing swapped in.
    this._secondaries && this._secondaries.some((c) => !!c._smoothMoving || !!c.pending || !!c._smearMoving || crt && c.trail && c.trail.length > 0 || !!c.glitch && nowT - c.glitch.start < c.glitch.dur || // Hot-head feeding on a secondary, same test as the primary's above.
    !!this.styleFor("hotHead") && !!c.animActive && this._hotFeedingAt(c._hotActiveT, nowT)) || // Precise: the spring reports whether any corner is still off its
    // target or carrying velocity. This used to be a 1200ms window
    // after the last motion, which was a workaround for a timestamp
    // that was being restamped every frame and so never expired. Now
    // that the spring snaps exactly onto its targets when it settles,
    // it cannot flap back and forth, so the grace period is dead
    // weight - it just held the hot gear for an extra 1.2s after every
    // smear finished.
    !!this._smearMoving;
  },
  // The gear for this frame and what decided it; the tick applies the
  // result. Pure reads. `why` is the first reason that held, for the
  // report's "awake because", built only when a report is running.
  //
  // Gears: anything genuinely in motion (_isAnimating) or an input within
  // INPUT_HOT_MS is hot; a blink fade or armed stardust is warm; the energy
  // shimmer alone is its own slow gear - it is driven by wall clock and has
  // to keep repainting, but at ~1.7 s a cycle 20 fps is fifty samples and
  // looks identical to sixty; otherwise idle. Stardust deliberately never
  // claims hot: it runs *because* nothing is happening, and a slow drift is
  // smooth at the warm gear; `armed` rather than "motes alive" keeps the
  // loop warm through the gaps between emissions, where the idle heartbeat
  // would make the spawn cadence stutter. The blink's window is phase-based
  // (blinkWindow), so the warm gear covers a fade from its first frame.
  _decideGear(nowT, wantWhy) {
    const eff = this.look;
    const animating = this._isAnimating(nowT);
    const energyShimmer = !!eff.energyEffect && !!this.lastActive;
    const recentInput = nowT - (this._lastActivityT || 0) < INPUT_HOT_MS;
    let blinkFading = false;
    let blinkBucket = 1;
    let idleWake = Infinity;
    if (eff.blinkingEnabled && this.lastActive) {
      const a = this.blinkPhase(nowT);
      blinkBucket = a >= 0.5 ? 1 : 0;
      const w = this.blinkWindow(nowT);
      blinkFading = w.fading;
      idleWake = w.msToNext;
    }
    const stardustLive = this.stardust.length > 0;
    const stardustActive = stardustLive || this.stardustArmed();
    const gear = animating || recentInput ? "hot" : blinkFading || stardustActive ? "warm" : energyShimmer ? "energy" : "idle";
    const staticFrame = !animating && !blinkFading && !energyShimmer && !stardustLive;
    let why = "";
    if (wantWhy) {
      why = this._smoothMoving ? "glide" : this.pending ? "pending move" : eff.crtEffect && this.trail && this.trail.length > 0 ? "trail" : this.particles && this.particles.length > 0 ? "particles" : this.flamePixels && this.flamePixels.length > 0 || this.flameEmbers && this.flameEmbers.length > 0 ? "pixels" : this.thunderbolts && this.thunderbolts.length > 0 || this.fireworks && this.fireworks.length > 0 ? "pops" : this.glitch && nowT - this.glitch.start < this.glitch.dur ? "glitch" : this.heat > 0 ? "heat" : this._smearMoving ? "smear" : !!this.styleFor("hotHead") && !!this.animActive && this.hotHeadFeeding(nowT) ? "fire" : animating ? "secondaries" : recentInput ? "input:" + (this._lastActivityKind || "?") : blinkFading ? "blink" : stardustActive ? "stardust" : energyShimmer ? "energy" : "idle";
    }
    return { gear, staticFrame, blinkBucket, idleWake, why };
  },
  // What a static frame would paint, as a string; when it matches the last
  // frame's the draw is skipped. The look's part is ONE number, the look
  // generation (_lookGen: bumped by saveSettings, a preset, the
  // reduced-motion query flipping - every path that changes what
  // this.look answers), instead of a list of every look key that reaches a
  // pixel. That list was kept by hand, and eight of its entries were bug
  // fixes: a toggle that "did nothing until the next keystroke" because the
  // key was missing here. The rest is what changes without a setting: the
  // Vim mode (its own look), the blink's half, the theme, the caret's place,
  // shape and glyph to the half-pixel, the plain secondaries, the tether,
  // the full secondaries and the smear quad (a spring with its own state;
  // it keeps deforming after the caret has stopped, and without it here a
  // settled frame stranded a stretched ghost on screen).
  _frameSignature(vimMode, blinkBucket) {
    const la = this.lastActive;
    const isDark = this.canvas ? this.canvas.ownerDocument.body.classList.contains("theme-dark") : true;
    const sec = this.secondaryCarets && this.secondaryCarets.length ? this.secondaryCarets.map((c) => (c.x | 0) + ":" + (c.top | 0) + ":" + (c.bottom | 0)).join(",") : "";
    const bt = this.bracketTether && this.bracketTether.length ? this.bracketTether.map((s) => (s.x1 | 0) + ":" + (s.y1 | 0) + ":" + (s.x2 | 0) + ":" + (s.y2 | 0)).join(",") : "";
    return [
      vimMode,
      this._lookGen | 0,
      blinkBucket,
      isDark,
      la ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," + Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "") : "none",
      sec,
      bt,
      this._secondariesSig(),
      this._smearSig()
    ].join("|");
  },
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
  },
  forEachTrailPoint(cb) {
    if (!this.look.crtEffect) return;
    const now = performance.now();
    const fade = Math.max(50, this.look.trailFadeMs);
    for (const p of this.trail) {
      const age = (now - p.t) / fade;
      const alpha = Math.max(0, 1 - age) * 0.55;
      if (alpha > 0.02) {
        const pad = this.look.crtNeon ? 22 : 14;
        this._markDirty(p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2);
        cb(p, alpha, Math.max(0, Math.min(1, age)));
      }
    }
  },
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
  //   idle — a 200 ms heartbeat (or the blink's next fade, if sooner) that
  //          re-checks state and repaints ONLY if the
  //          picture changed; with a static, non-fading cursor the canvas
  //          isn't touched at all, so idle cost approaches zero
  // Input events snap the loops back to hot instantly (the pending idle
  // timeout is cancelled and a frame is requested immediately), so the
  // scheduling can never add perceptible input latency.
  // Called from input events. Timestamps the activity and wakes any dozing
  // loop right now instead of letting it sleep out its timeout.
  // Anything that can move the caret on screen bumps this; the geometry
  // caches (cmCaretCoords, getPaneRect, the secondaries') are keyed on it.
  // Layout may have moved the caret: drop the geometry caches and have the
  // loop look now rather than on the heartbeat. Cheap when it finds nothing
  // (one tick, a signature that matches, no draw), and it is what lets a
  // sidebar animating shut, or a slider dragged in the settings window
  // (saveSettings calls this), move the caret on the next frame instead of
  // up to a heartbeat later.
  _invalidateLayout() {
    this._layoutGen = (this._layoutGen | 0) + 1;
    this._wakeLoop();
  },
  // The caret's computed style may have changed under it - css-change, a
  // layout change, a resize (which is also how a zoom arrives). The style
  // cache in cmCaretCoords is keyed on this generation. Kept apart from the
  // layout generation, which every scroll and keystroke bumps: a scroll
  // moves the caret, it does not change the font under it, and re-reading
  // computed styles and hit-testing the line on every scroll event was the
  // alternative.
  _invalidateStyle() {
    this._styleGen = (this._styleGen | 0) + 1;
    this._invalidateLayout();
  },
  // A dozing loop (warm, energy or idle: parked on a timeout) is put on the
  // next frame. A hot loop is already on requestAnimationFrame and needs
  // nothing, and a tick in progress has no timeout to cancel.
  _wakeLoop() {
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
      if (this.canvasEngineActive && this._canvasTick) {
        this.canvasRaf = window.requestAnimationFrame(this._canvasTick);
      }
    }
  },
  // The frame loop's watchdog, on an interval from onload. The plugin hides
  // Obsidian's caret and draws its own, so a loop that stops - a frame that
  // threw before it rescheduled, an animation frame that never came back -
  // leaves the editor with no caret at all, the worst thing this plugin can
  // do. A parked loop still ticks at the idle heartbeat, so a visible
  // document with no tick for WATCHDOG_STALE_MS is a dead loop: it is
  // restarted (enable), the console says so, and on the second stall the
  // native caret is handed back (hideNativeActive reads _watchdogGaveUp)
  // until the plugin is next enabled by hand. Not a stall: a hidden
  // document (no animation frames by design), or an interval that was
  // itself late by as much - the main thread was blocked, and the loop
  // never had a chance. Trips are forgotten after a healthy minute.
  _watchdog(now) {
    const lastRun = this._watchdogLastT || now;
    this._watchdogLastT = now;
    if (!this.canvasEngineActive) return;
    const doc = this.canvas && this.canvas.ownerDocument || document;
    if (doc.visibilityState === "hidden" || now - lastRun > WATCHDOG_INTERVAL_MS * 1.5) {
      this._lastTickT = now;
      return;
    }
    const silent = now - (this._lastTickT || now);
    if (silent < WATCHDOG_STALE_MS) {
      if (this._watchdogTrips && now - (this._watchdogTripT || 0) > 6e4) this._watchdogTrips = 0;
      return;
    }
    this._watchdogTrips = (this._watchdogTrips | 0) + 1;
    this._watchdogTripT = now;
    this._reportOnce("watchdog, stall " + this._watchdogTrips, new Error(`no frame for ${Math.round(silent)} ms: restarting the loop`));
    try {
      this.enable();
    } catch (e) {
      this._reportOnce("watchdog restart", e);
    }
    if (this._watchdogTrips >= 2) {
      this._watchdogGaveUp = true;
      try {
        this.applyBodyClasses();
      } catch (e) {
        this._reportOnce("watchdog body classes", e);
      }
    }
  },
  _markActivity(kind = "") {
    this._lastActivityT = performance.now();
    if (kind) this._lastActivityKind = kind;
    this._invalidateLayout();
    this._wakeTorch();
  },
  // A ResizeObserver on the active editor's content and scroller: an embed
  // or image finishing its load, a line wrapping differently after a font
  // loads - anything that changes the content's size moves the caret without
  // an input event, and bumps the layout generation here. Re-pointed when
  // the active editor changes; disconnected on unload.
  //
  // And a MutationObserver on the content, for what changes the line under
  // the caret without changing its size: Live Preview reveals a heading's
  // "# " a beat after a click lands in it (a second transaction on mouseup,
  // some 60 ms later - an arrow key reveals it in the same frame) and the
  // text shifts right by the markup's width. Same document, same selection,
  // so no event the plugin listens to fires, and the geometry cache in
  // cmCaretCoords kept the pre-reveal spot for its whole TTL: the caret
  // landed short of the end and hopped 400 ms later. A change in the
  // content DOM bumps the layout generation and wakes a frame, and the
  // next measurement reads the revealed line. The callback writes nothing
  // it watches (the canvas is never inside the content).
  _observeEditorLayout(view) {
    if (this._roView === view) return;
    try {
      this._ro?.disconnect();
      this._mo?.disconnect();
    } catch {
    }
    this._ro = null;
    this._mo = null;
    this._roView = view || null;
    if (!view) return;
    if (typeof ResizeObserver !== "undefined") {
      try {
        this._ro = new ResizeObserver(() => this._invalidateLayout());
        if (view.contentDOM) this._ro.observe(view.contentDOM, { box: "border-box" });
        if (view.scrollDOM) this._ro.observe(view.scrollDOM, { box: "border-box" });
      } catch {
        this._ro = null;
      }
    }
    if (typeof MutationObserver !== "undefined" && view.contentDOM) {
      try {
        this._mo = new MutationObserver(() => this._invalidateLayout());
        this._mo.observe(view.contentDOM, { childList: true, subtree: true, characterData: true });
      } catch (e) {
        this._mo = null;
        this._reportOnce("content observer", e);
      }
    }
    this._invalidateLayout();
  },
  // Whether a scroll or wheel event on `target` can move the caret: the
  // document itself (a window scroll), the active editor's scroller or an
  // ancestor of it, or any element containing the focused field. Everything
  // else scrolls something the caret is not in. See registerWindowEvents.
  _scrollMovesCaret(target, doc) {
    if (!target) return true;
    if (target === doc || target === (doc && doc.documentElement) || target === (doc && doc.defaultView)) return true;
    const node = target;
    const contains = node && typeof node.contains === "function" ? (el) => !!el && node.contains(el) : () => false;
    let scroller = null;
    try {
      scroller = this.app.workspace.activeEditor?.editor?.cm?.scrollDOM || null;
    } catch {
      scroller = null;
    }
    if (scroller && (target === scroller || contains(scroller) || typeof scroller.contains === "function" && scroller.contains(node))) return true;
    const active = doc && doc.activeElement;
    if (active && active !== doc.body && contains(active)) return true;
    return false;
  },
  // Whether the document's selection is somewhere else than when this last
  // answered. Android's WebView, and CodeMirror re-syncing the DOM selection
  // to its own, fire selectionchange with the caret exactly where it was;
  // each used to buy INPUT_HOT_MS of the hot gear. Compared, not stamped:
  // the editor's selection (its document, anchor, head, assoc and range
  // count) while the editor has focus, a field's own selection when a field
  // does, the DOM selection's two ends otherwise. When in doubt (a probe
  // throws), the answer is yes.
  _selectionMoved(doc) {
    let sig;
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (view && view.hasFocus && view.dom.ownerDocument === doc) {
        const sel = view.state.selection;
        const m = sel.main;
        sig = { a: view.state.doc, b: null, n: m.anchor, h: m.head, o: m.assoc || 0, k: sel.ranges.length };
      } else {
        const el = doc.activeElement;
        const start = el ? el.selectionStart : null;
        if (el && typeof start === "number") {
          sig = { a: el, b: null, n: start, h: el.selectionEnd ?? start, o: 0, k: 1 };
        } else {
          const s = doc.getSelection();
          sig = s ? { a: s.anchorNode, b: s.focusNode, n: s.anchorOffset, h: s.focusOffset, o: 0, k: s.rangeCount } : { a: null, b: null, n: -1, h: -1, o: 0, k: 0 };
        }
      }
    } catch {
      this._selSig = null;
      return true;
    }
    const prev = this._selSig;
    this._selSig = sig;
    if (!prev) return true;
    return prev.a !== sig.a || prev.b !== sig.b || prev.n !== sig.n || prev.h !== sig.h || prev.o !== sig.o || prev.k !== sig.k;
  },
  // Count what the loop does for `seconds`, then put a report on the
  // clipboard (and in the console). The counters live on this._perf and
  // the tick adds to them only while that is set; see the tick.
  performanceReport(seconds = 10) {
    if (this._perf) {
      new import_obsidian5.Notice("Cursor-Smith: a performance report is already running.");
      return;
    }
    const perf = this._perf = this._freshPerf();
    let po = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          perf.longTasks++;
          perf.longTaskMs += e.duration;
        }
      });
      po.observe({ entryTypes: ["longtask"] });
    } catch {
      po = null;
    }
    const onKey = () => {
      perf.keys++;
    };
    const doc = this.canvas && this.canvas.ownerDocument || document;
    doc.addEventListener("keydown", onKey, true);
    new import_obsidian5.Notice(`Cursor-Smith: measuring for ${seconds} seconds - keep using Obsidian as you normally would.`);
    window.setTimeout(() => {
      this._perf = null;
      if (po) {
        try {
          po.disconnect();
        } catch {
        }
      }
      doc.removeEventListener("keydown", onKey, true);
      const text = this.perfReportText(perf, seconds);
      const clip = typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"));
      clip.then(
        () => new import_obsidian5.Notice("Cursor-Smith: report copied to the clipboard."),
        () => {
          console.warn(text);
          new import_obsidian5.Notice("Cursor-Smith: report is in the developer console (Ctrl+Shift+I).");
        }
      );
    }, seconds * 1e3);
  },
  _freshPerf() {
    return {
      t0: performance.now(),
      ticks: 0,
      draws: 0,
      gears: {},
      tickMs: 0,
      caretMs: 0,
      drawMs: 0,
      reanchors: 0,
      longTasks: 0,
      longTaskMs: 0,
      rafGaps: {},
      rafPrev: 0,
      keys: 0,
      why: {}
    };
  },
  // The report's text. Pure apart from reading the environment, so the
  // shape can be tested with a synthetic counter object. Everything in it is
  // either a number the tick counted or a fact about the machine and the
  // configuration; nothing that identifies the vault or its contents.
  perfReportText(perf, seconds) {
    const s = this.settings || {};
    const secs = Math.max(1e-3, seconds);
    const gearTotal = Object.values(perf.gears).reduce((a, b) => a + b, 0) || 1;
    const gears = Object.entries(perf.gears).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${Math.round(100 * n / gearTotal)}%`).join(", ") || "none";
    const whyTotal = Object.values(perf.why || {}).reduce((a, b) => a + b, 0) || 1;
    const why = Object.entries(perf.why || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, n]) => `${w} ${Math.round(100 * n / whyTotal)}%`).join(", ") || "none";
    const on = [];
    for (const k of [
      "gradientEnabled",
      "crtEffect",
      "glow",
      "crtNeon",
      "crtGlitch",
      "cursorTranslucent",
      "cursorRounded",
      "blinkingEnabled",
      "smear",
      "smoothEnabled",
      "energyEffect",
      "popEffects",
      "popLetters",
      "flameTrail",
      "fireworks",
      "thunderstrike",
      "backspaceDisintegrate",
      "hotHead",
      "stardustEnabled",
      "speedDemon",
      "bracketTether",
      "torchEffect",
      "vimModeEnabled"
    ]) {
      if (s[k]) on.push(k);
    }
    let gpu = "unknown";
    try {
      const c = createEl("canvas");
      const gl = c.getContext("webgl");
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : gl ? "webgl, no renderer info" : "no webgl";
    } catch {
    }
    let code = "";
    try {
      code = presetToCode("report", s);
    } catch {
      code = "(unavailable)";
    }
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const win = typeof window !== "undefined" ? window : {};
    const clip = this._clipRect;
    const region = this._canvasRect;
    const app = this.app || {};
    const themeName = app.customCss && (app.customCss.theme || app.customCss.currentTheme) || "default";
    const snippets = app.customCss && app.customCss.enabledSnippets ? app.customCss.enabledSnippets.size : 0;
    const plugins = app.plugins && app.plugins.enabledPlugins ? app.plugins.enabledPlugins.size : 0;
    let gap = 0, gapN = 0;
    for (const [g, n] of Object.entries(perf.rafGaps || {})) {
      if (n > gapN) {
        gapN = n;
        gap = Number(g);
      }
    }
    const hz = gap > 0 ? Math.round(1e3 / gap) : null;
    const lines = [
      `Cursor-Smith performance report (${this.manifest && this.manifest.version || "?"}), ${secs.toFixed(0)}s`,
      `environment: ${nav.userAgent || "?"}`,
      `platform ${nav.platform || "?"}; window ${win.innerWidth || "?"}x${win.innerHeight || "?"} @${win.devicePixelRatio || "?"}x; display ~${hz ? hz + "Hz" : "unmeasured (no hot frames)"}`,
      `gpu: ${gpu}`,
      `theme: ${themeName}; snippets on: ${snippets}; plugins on: ${plugins}`,
      `pane: ${clip ? clip.w + "x" + clip.h : "none"}; canvas region now: ${region ? region.w + "x" + region.h : "none"}`,
      `settings: style ${s.cursorStyle || "?"}; low power ${s.lowPowerMode ? "on" : "off"}; hide when unfocused ${s.hideOnWindowBlur === false ? "off" : "on"}; note editor only ${s.noteEditorOnly ? "on" : "off"}; reduced motion ${this.reducedMotion && this.reducedMotion() ? "ACTIVE" : "no"}`,
      `effects on: ${on.join(", ") || "none"}`,
      `share code: ${code}`,
      `loop: ${perf.ticks} ticks (${(perf.ticks / secs).toFixed(1)}/s), ${perf.draws} draws (${(perf.draws / secs).toFixed(1)}/s), gears ${gears}, ${perf.reanchors} canvas re-anchors, ${perf.keys} keystrokes`,
      `awake because: ${why}`,
      `cost per frame: tick ${perf.ticks ? (perf.tickMs / perf.ticks).toFixed(2) : "0"}ms (caret measure ${perf.ticks ? (perf.caretMs / perf.ticks).toFixed(2) : "0"}ms), draw ${perf.draws ? (perf.drawMs / perf.draws).toFixed(2) : "0"}ms; plugin main-thread total ${perf.tickMs.toFixed(0)}ms of ${(secs * 1e3).toFixed(0)}ms (${(100 * perf.tickMs / (secs * 1e3)).toFixed(1)}%)`,
      `long tasks (anything over 50ms, any source): ${perf.longTasks}, ${perf.longTaskMs.toFixed(0)}ms total`
    ];
    return lines.join("\n");
  }
};

// src/carets.ts
var caretsMethods = {
  // =========================================================================
  // Multi-cursor: full effects on secondary carets
  // =========================================================================
  // Every non-primary caret up to SECONDARY_FULL_MAX gets the primary's whole
  // pipeline rather than a 2px line. Nothing in that pipeline takes a caret
  // argument; it reads and writes the fields in CARET_STATE_FIELDS on
  // `this`, and those are accessors over the current caret's state object
  // (this._caret), so _withCaret makes a secondary's bundle current with one
  // pointer, runs the primary's own code, and points back.
  //
  // What is per caret: position, smoothing, the smear spring, the trail,
  // the pending (Move Delay) state, a Signal Glitch burst, and the pop
  // effects a move spawns (letter pop, pixel trail, disintegration, jump
  // trail). What stays global: the blink clock (lastMoveTime - every caret
  // blinks with the primary), Speed Demon's heat, Thunderstrike, Fireworks,
  // Hot-head and Stardust, which follow the primary only.
  // A caret's state is an object (CaretState): the primary's is this._caret,
  // a full-effect secondary's is its bundle in this._secondaries. Every
  // per-caret field (CARET_STATE_FIELDS) is an accessor on the class that
  // forwards to this._caret (the end of plugin.ts), so the pipeline
  // addresses whichever caret is current as `this.x`, and switching carets
  // is one pointer. Until 1.5.8 _withCaret copied the forty fields into a
  // scratch bundle and the secondary's in, ran the code, and copied both
  // back - twice per secondary per frame - and three of the smear's fields
  // were missing from the list, so every secondary's spring integrated the
  // primary's points toward its own target.
  // A bundle in the state a fresh engine has: the reset, run by a scratch
  // engine whose caret is the new object, so the two cannot drift.
  _freshCaretState() {
    const fresh = {};
    const scratch = Object.create(Object.getPrototypeOf(this));
    scratch._caret = fresh;
    scratch._resetEngineState();
    return fresh;
  },
  // Run `fn` with `state` as the current caret, then put the primary back.
  // Nothing is copied: the state object is the caret before, during and
  // after. Re-entrant - a nested swap restores the outer one - and the
  // primary is always what is put back, whatever fn threw.
  _withCaret(state, fn) {
    const prev = this._caret;
    const pass = this._caretPass;
    const owner = this._caretOwner;
    this._caret = state;
    this._caretPass = "secondary";
    this._caretOwner = state;
    try {
      return fn();
    } finally {
      this._caret = prev;
      this._caretPass = pass;
      this._caretOwner = owner;
    }
  },
  // The selection changed shape: a range was added or removed, or a different
  // one is main. Index-aligned bundles are then wrong, so every bundle - the
  // primary's included, since the range it was tracking may now be a
  // secondary and vice versa - is matched to the new ranges by document
  // position. An Alt+click that makes the new caret main is the common case:
  // the old primary's state follows its range down into the secondaries and
  // the new caret starts fresh, so nothing streaks across the page. Ranges
  // cannot cross without merging, so while the shape holds, index order does.
  rematchCaretStates(view) {
    const sel = view && this.editorFocused(view) ? view.state.selection : null;
    const count = sel ? sel.ranges.length : 1;
    const mainIndex = sel ? sel.mainIndex : 0;
    const prev = this._selShape;
    this._selShape = { count, mainIndex };
    if (!prev || prev.count === count && prev.mainIndex === mainIndex) return;
    if (!sel) {
      this._secondaries = [];
      return;
    }
    const candidates = [{ state: this._caret, pos: this.lastActive ? this.lastActive.pos : null }];
    for (const c of this._secondaries) candidates.push({ state: c, pos: c.lastActive ? c.lastActive.pos : null });
    const take = (head) => {
      let best = -1, bestD = SECONDARY_MATCH_WINDOW + 1, bestCand = null;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        if (!cand || cand.pos == null) continue;
        const d = Math.abs(cand.pos - head);
        if (d < bestD) {
          bestD = d;
          best = i;
          bestCand = cand;
        }
      }
      if (!bestCand) return null;
      candidates[best] = null;
      return bestCand.state;
    };
    const main = take(sel.ranges[mainIndex].head) || this._freshCaretState();
    this._caret = main;
    const next = [];
    for (let i = 0; i < sel.ranges.length && next.length < SECONDARY_FULL_MAX; i++) {
      if (i === mainIndex) continue;
      next.push(take(sel.ranges[i].head) || this._freshCaretState());
    }
    this._secondaries = next;
  },
  // Per frame: measure every secondary, run the primary's update pipeline on
  // the first SECONDARY_FULL_MAX of them through their bundles, and leave the
  // rest in this.secondaryCarets for the plain line. `flags` holds the
  // Backspace/Enter/Space flags as they stood before the primary consumed
  // them, so each secondary's commitMove sees the same keystroke.
  updateSecondaryCarets(view, flags = {}) {
    const raw = this.secondaryCaretCoords(view, this._secondaries);
    const full = raw.slice(0, SECONDARY_FULL_MAX);
    this.secondaryCarets = raw.slice(SECONDARY_FULL_MAX).filter((c) => c.visible);
    const states = this._secondaries;
    while (states.length < full.length) states.push(this._freshCaretState());
    if (states.length > full.length) states.length = full.length;
    if (full.length === 0 || !view) return;
    const lineStyles = /* @__PURE__ */ new Map();
    const primaryFlags = { del: this._deletePending, enter: this._enterPending, pop: this._popKeyPending };
    try {
      for (let i = 0; i < full.length; i++) {
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
          if (this.look.speedDemon && this.look.speedDemonSparks && this.animActive) {
            this.maybeSpawnSpeedDemonSparks();
          }
          this.updateHotHeadInertia();
          if (this.styleFor("hotHead") && this.animActive) this.maybeSpawnHotHead();
          this.maybeSpawnStardust();
          states[i]._tetherOut = this.look.bracketTether && c.visible ? this.bracketTetherCoords(view, c.pos, c.empty !== false) : null;
        });
      }
    } finally {
      this._deletePending = primaryFlags.del;
      this._enterPending = primaryFlags.enter;
      this._popKeyPending = primaryFlags.pop;
    }
  },
  // The static-frame signature term for the full-effect secondaries: each
  // one's settled position and shape, plus its smear quad - the same things
  // the primary contributes, for the same reasons (see the tick).
  _secondariesSig() {
    const states = this._secondaries;
    if (!states || states.length === 0) return "";
    const parts = [];
    for (const st of states) {
      const la = st.lastActive;
      parts.push(la ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," + Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "") : "none");
      parts.push(this._withCaret(st, () => this._smearSig()));
    }
    return parts.join(";");
  },
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
          selStart = el.selectionDirection === "backward" ? s : e;
        }
      } catch {
      }
      let mirror = this._formMirror;
      if (!mirror || mirror.ownerDocument !== doc) {
        mirror?.remove();
        mirror = doc.body.createDiv({ attr: { "aria-hidden": "true" } });
        mirror.setCssStyles({
          position: "absolute",
          visibility: "hidden",
          top: "0",
          left: "0",
          zIndex: "-1",
          pointerEvents: "none"
        });
        this._formMirror = mirror;
      }
      const props = [
        "height",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "fontStyle",
        "fontVariant",
        "fontWeight",
        "fontStretch",
        "fontSize",
        "lineHeight",
        "fontFamily",
        "letterSpacing",
        "textIndent",
        "textTransform",
        "wordSpacing",
        "tabSize",
        "textAlign",
        "direction",
        "unicodeBidi"
      ];
      const dst = mirror.style, src = style;
      for (const p of props) dst[p] = src[p];
      mirror.setCssStyles({ borderStyle: "solid" });
      const padL = parseFloat(style.paddingLeft) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      mirror.setCssStyles({
        boxSizing: "content-box",
        width: Math.max(0, (el.clientWidth || 0) - padL - padR) + "px",
        whiteSpace: isTextarea ? "pre-wrap" : "pre",
        wordWrap: isTextarea ? "break-word" : "normal",
        overflow: "hidden"
      });
      if (!isTextarea) mirror.setCssStyles({ height: "auto" });
      mirror.textContent = "";
      mirror.appendChild(doc.createTextNode(value.substring(0, selStart)));
      const marker = mirror.createSpan();
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
        height = Math.min(lineHeight, rect.height) || fontSize * 1.2;
        top = rect.top + (rect.height - height) / 2;
      }
      const clampedLeft = Math.min(Math.max(left, rect.left), rect.right);
      const clampedTop = Math.min(Math.max(top, rect.top), rect.bottom - 1);
      return { left: clampedLeft, top: clampedTop, bottom: clampedTop + height };
    } catch (e) {
      this._reportOnce("formFieldCaretCoords", e);
      return null;
    }
  },
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
    const moved = Math.abs(this.lastActive.x - caret.x) > 0.5 || Math.abs(this.lastActive.top - caret.top) > 0.5;
    if (!moved) {
      if (!this.pending) this.lastActive = caret;
      return;
    }
    if (caret.pos !== null && caret.pos === this.lastActive.pos && caret.assoc === this.lastActive.assoc) {
      const dx = caret.x - this.lastActive.x;
      const dy = caret.top - this.lastActive.top;
      this.lastActive = caret;
      if (this.animActive && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
        this.animActive.x += dx;
        this.animActive.top += dy;
        this.animActive.w = caret.w;
        this.animActive.h = caret.h;
        if (this.smearQuad) {
          for (const key of Object.keys(this.smearQuad)) {
            this.smearQuad[key].x += dx;
            this.smearQuad[key].y += dy;
          }
          if (this._smearLead) {
            this._smearLead.x += dx;
            this._smearLead.y += dy;
          }
          if (this._smearTrail) {
            this._smearTrail.x += dx;
            this._smearTrail.y += dy;
          }
          if (this.smearShape && this.smearShape !== this.smearQuad) {
            for (const key of Object.keys(this.smearShape)) {
              this.smearShape[key].x += dx;
              this.smearShape[key].y += dy;
            }
          }
          if (this.smearCenterPrev) {
            this.smearCenterPrev.x += dx;
            this.smearCenterPrev.y += dy;
          }
        }
        if (this.trail.length) {
          for (const p of this.trail) {
            p.x += dx;
            p.y += dy;
          }
        }
      }
      return;
    }
    const delay = Math.max(0, Math.round(this.look.moveDelayMs));
    if (delay <= 0) {
      this.resolveHoldChar(caret);
      this.commitMove(caret);
      return;
    }
    const pending = this.pending;
    if (!pending || pending.caret.x !== caret.x || pending.caret.top !== caret.top) {
      this.pending = { caret, since: performance.now(), holdChar: this.resolveHoldChar(caret) ?? (this.lastActive ? this.lastActive.char : "") };
    } else if (performance.now() - pending.since >= delay) {
      this.commitMove(pending.caret);
    }
  },
  updateSmoothCursor() {
    if (!this.lastActive) {
      this.animActive = null;
      this._smoothMoving = false;
      this._smoothLastT = 0;
      this._catchUpBoost = 1;
      this._typingBoostSm = null;
      return;
    }
    if (!this.look.smoothEnabled) {
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
    let dt = (now - (this._smoothLastT || now)) / 1e3;
    this._smoothLastT = now;
    dt = Math.max(1e-3, Math.min(dt, 0.05));
    let targetSpeed = this.look.catchUpSpeed;
    let typingBoost = 1;
    if (this.look.smoothAdaptive) {
      const timeSinceMove = now - this.lastMoveTime;
      const maxMod = this.look.maxCatchUpSpeed / Math.max(0.01, this.look.catchUpSpeed);
      if (timeSinceMove < 150) {
        this.typingSpeedMod = Math.min(this.typingSpeedMod + (maxMod - 1) * 8 * dt, maxMod);
      } else {
        this.typingSpeedMod = Math.max(this.typingSpeedMod - (maxMod - 1) * 2 * dt, 1);
      }
      targetSpeed = Math.min(this.look.maxCatchUpSpeed, targetSpeed * this.typingSpeedMod);
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
    const boostK = 1 - Math.exp(-CATCHUP_BOOST_RATE * dt);
    this._typingBoostSm = this._typingBoostSm == null ? typingBoost : this._typingBoostSm + (typingBoost - this._typingBoostSm) * boostK;
    typingBoost = this._typingBoostSm;
    const RATE_SCALE = 40;
    const rate = Math.max(0.5, targetSpeed * (1 - this.look.smoothness) * RATE_SCALE * typingBoost);
    this._catchUpBoost = targetSpeed / Math.max(0.01, this.look.catchUpSpeed) * typingBoost;
    const lerpFactor = 1 - Math.exp(-rate * dt);
    this.animActive.x += (this.lastActive.x - this.animActive.x) * lerpFactor;
    this.animActive.top += (this.lastActive.top - this.animActive.top) * lerpFactor;
    this.animActive.w += (this.lastActive.w - this.animActive.w) * lerpFactor;
    this.animActive.h += (this.lastActive.h - this.animActive.h) * lerpFactor;
    const arrived = Math.abs(this.lastActive.x - this.animActive.x) < 0.25 && Math.abs(this.lastActive.top - this.animActive.top) < 0.25 && Math.abs(this.lastActive.w - this.animActive.w) < 0.25 && Math.abs(this.lastActive.h - this.animActive.h) < 0.25;
    if (arrived) {
      this.animActive.x = this.lastActive.x;
      this.animActive.top = this.lastActive.top;
      this.animActive.w = this.lastActive.w;
      this.animActive.h = this.lastActive.h;
    }
    this._smoothMoving = !arrived;
    this.animActive.textColor = this.lastActive.textColor;
    this.animActive.char = this.lastActive.char;
    this.animActive.actualCharWidth = this.lastActive.actualCharWidth;
    this.animActive.fontFamily = this.lastActive.fontFamily;
    this.animActive.fontSize = this.lastActive.fontSize;
    this.animActive.fontWeight = this.lastActive.fontWeight;
    this.animActive.fontStyle = this.lastActive.fontStyle;
    this.animActive.letterSpacing = this.lastActive.letterSpacing;
    this.animActive.rowLeft = this.lastActive.rowLeft;
    this.animActive.rowRight = this.lastActive.rowRight;
  },
  commitMove(caret) {
    const secondary = this._caretPass === "secondary";
    if (this.look.speedDemon && this.lastActive && caret && !secondary) {
      const keyed = this._heatKeyT && performance.now() - this._heatKeyT < 150;
      if (!keyed) {
        const dist = Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top);
        const bump = Math.min(0.12, dist / 900) * (this.look.speedDemonSensitivity ?? 1);
        this.heat = Math.min(1, this.heat + bump);
      }
    }
    this.pushTrail(this.lastActive, caret);
    if (this.lastActive) {
      const now = performance.now();
      const disintegrate = !!(this.look.popEffects && this.look.backspaceDisintegrate && this._deletePending && now - this._deletePending < 250);
      this.spawnFlamePixels(this.lastActive, disintegrate);
      if (this.look.flameTrailOnJump && !disintegrate) {
        this.spawnJumpTrail(this.lastActive, caret);
      }
      this._deletePending = 0;
      if (this.look.crtEffect && this.look.crtGlitch) {
        this.spawnGlitch(this.lastActive, caret);
      }
      if (this.styleFor("hotHead") && Math.hypot(caret.x - this.lastActive.x, caret.top - this.lastActive.top) >= JUMP_TRAIL_MIN_DIST) {
        this._hotEngulfUntil = now + HOT_ENGULF_MS;
        this._hotActiveT = now;
      }
      if (this._enterPending && now - this._enterPending < 250) {
        this.spawnThunderbolt(caret);
      }
      if (this._popKeyPending && now - this._popKeyPending < 250) {
        this.spawnFireworks(caret);
      }
    }
    if (!secondary) {
      this._enterPending = 0;
      this._popKeyPending = 0;
    }
    this.lastActive = caret;
    this.pending = null;
    this.lastMoveTime = performance.now();
  }
};

// src/plugin.ts
var CANDLE_ICON = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 2S9 5.3 9 7s1.3 3 3 3 3-1.3 3-3-3-5-3-5"/>
<path d="M16 22H8v-7c0-.6.4-1 1-1h6c.6 0 1 .4 1 1Z"/>
<path d="M12 14v3"/>
<path d="M17 17s-.7-1.4-1.1-2.4"/>
</g>`;
var CursorSmithPlugin = class extends import_obsidian6.Plugin {
  async onload() {
    (0, import_obsidian6.addIcon)("cursor-smith-candle", CANDLE_ICON);
    this._deviceEnabled = this.app.loadLocalStorage(DEVICE_ENABLED_KEY) !== "off";
    const rawSaved = await this.loadData();
    const saved = migrateLegacyKeys(rawSaved);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    const freshInstall = !rawSaved || typeof rawSaved !== "object";
    if (saved && saved.uiMode === void 0) {
      this.settings.uiMode = this.settings.vimModeEnabled ? "vim" : "cua";
    }
    delete this.settings.vimPrevObsidianVim;
    if (!this.settings.userPresets) this.settings.userPresets = {};
    for (const [name, snap] of Object.entries(DEFAULT_PRESETS)) {
      if (!(name in this.settings.userPresets)) {
        this.settings.userPresets[name] = snap;
      }
    }
    if (freshInstall && applyStarterPreset(this.settings)) {
      this._activePresetName = DEFAULT_PRESET_NAME;
    }
    {
      const savedModes = this.settings.vimModes && typeof this.settings.vimModes === "object" ? this.settings.vimModes : {};
      const fresh = {};
      for (const mode of VIM_MODE_KEYS) {
        const saved2 = Object.assign({}, savedModes[mode] || {});
        if (saved2.useCustomColors === false) {
          saved2.colorDark = this.settings.colorDark;
          saved2.colorLight = this.settings.colorLight;
        }
        delete saved2.useCustomColors;
        fresh[mode] = Object.assign({}, DEFAULT_SETTINGS.vimModes[mode], pickLook(saved2));
      }
      this.settings.vimModes = fresh;
    }
    const hadVimPresets = !!this.settings.vimPresets;
    if (!this.settings.vimPresets) this.settings.vimPresets = {};
    for (const [name, snap] of Object.entries(DEFAULT_VIM_PRESETS)) {
      if (!(name in this.settings.vimPresets)) {
        this.settings.vimPresets[name] = cloneVimModes(snap);
      }
    }
    if (!hadVimPresets && !this.settings.vimActivePreset) {
      this.settings.vimActivePreset = "Preset1";
    }
    if (freshInstall) {
      try {
        await this.saveData(this.settings);
      } catch (e) {
        console.error("[cursor-smith] could not write initial settings:", e);
      }
    }
    this._docCleanups = /* @__PURE__ */ new Map();
    this.registeredDocuments = /* @__PURE__ */ new Set();
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this._resetEngineState();
    this.overlay = null;
    this.modalObserver = null;
    this.modalOpen = false;
    this._coverOpen = false;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;
    this.lastCaret = null;
    this.lastCaretMove = 0;
    this.mouseX = this.x;
    this.mouseY = this.y;
    this.lastMouseMove = 0;
    this._lastScrollT = 0;
    this._mouseDoc = null;
    this.canvasEngineActive = false;
    this.torchEngineActive = false;
    this.canvasRaf = 0;
    this.torchRaf = 0;
    this._lastWrapperRect = "";
    this._canvasBlend = "";
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._chromeCache = null;
    this._caretStyleCache = null;
    this._styleGen = 0;
    this._uiModeSwitching = false;
    this.addCommand({
      id: "cycle-preset",
      name: "Cycle preset",
      callback: () => this.cycleActivePreset(1)
    });
    this.addCommand({
      id: "toggle",
      name: "Toggle on/off",
      callback: () => this.toggle()
    });
    this.addCommand({
      id: "toggle-cua-vim-mode",
      name: "Toggle Vim mode",
      callback: () => this.toggleUiMode()
    });
    this.addCommand({
      id: "performance-report",
      name: "Performance report (10 seconds, copied to the clipboard)",
      callback: () => this.performanceReport(10)
    });
    this.settingTab = new CursorSmithSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this._lookGen = 0;
    this._lastTickT = 0;
    this._watchdogTrips = 0;
    this._watchdogTripT = 0;
    this._watchdogLastT = 0;
    this._watchdogGaveUp = false;
    this._vimStatusTimer = 0;
    this.registerInterval(window.setInterval(() => this._watchdog(performance.now()), WATCHDOG_INTERVAL_MS));
    for (const ev of ["css-change", "layout-change", "active-leaf-change", "resize"]) {
      const style = ev !== "active-leaf-change";
      try {
        this.registerEvent(this.app.workspace.on(ev, () => style ? this._invalidateStyle() : this._invalidateLayout()));
      } catch {
      }
    }
    this.registerEvent(
      this.app.workspace.on("window-close", (_leaf, win) => {
        const doc = win && win.document || _leaf && _leaf.doc || null;
        if (doc) this.unregisterDocument(doc);
      })
    );
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.vimModeEnabled && this.settings.vimControlObsidian) {
        this.setObsidianVim(true);
      }
      if (this.settings.enabled && this._deviceEnabled) this.enable();
      this.syncVimStatusBar();
    });
  }
  onunload() {
    this.disable();
    if (this._reduceMQ && this._reduceMQHandler && typeof this._reduceMQ.removeEventListener === "function") {
      try {
        this._reduceMQ.removeEventListener("change", this._reduceMQHandler);
      } catch {
      }
    }
    this._reduceMQ = null;
    this._reduceMQHandler = null;
    if (this._vimStatusTimer) {
      window.clearInterval(this._vimStatusTimer);
      this._vimStatusTimer = 0;
    }
    if (this.settingTab && this.settingTab._valueObserver) {
      this.settingTab._valueObserver.disconnect();
      this.settingTab._valueObserver = null;
    }
    if (this._vimNormalRetryT) {
      window.clearTimeout(this._vimNormalRetryT);
      this._vimNormalRetryT = 0;
    }
    if (this.vimStatusEl) {
      this.vimStatusEl.remove();
      this.vimStatusEl = null;
    }
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
      try {
        cleanup();
      } catch (e) {
        console.error("[cursor-smith] document cleanup failed:", e);
      }
      this._docCleanups.delete(doc);
    }
    this.registeredDocuments.delete(doc);
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument === doc) {
      try {
        this.canvasWrapper.remove();
      } catch {
      }
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
      this._canvasRect = null;
    }
    try {
      doc.getElementById("cursor-smith-dynamic-styles")?.remove();
      doc.querySelector(".cursor-smith-torch-glow")?.remove();
      doc.querySelectorAll(".cursor-smith-wrapper, .cursor-smith-canvas, .cursor-smith-torch-overlay").forEach((el) => {
        el.remove();
      });
      doc.body?.classList.remove(
        "cursor-smith-active",
        "cursor-smith-hide-native",
        "cursor-smith-torch-active"
      );
    } catch {
    }
  }
  registerWindowEvents(doc) {
    if (this.registeredDocuments.has(doc)) return;
    this.registeredDocuments.add(doc);
    const onMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this._mouseDoc = doc;
      this.lastMouseMove = performance.now();
      this._wakeTorch();
    };
    const onActivity = (e) => this._markActivity(e && e.type ? e.type : "activity");
    const noteKeystroke = (kind, opts = {}) => {
      const now = performance.now();
      if (kind === "delete") this._deletePending = now;
      if (kind === "enter") this._enterPending = now;
      if (kind === "enter" || kind === "space") this._popKeyPending = now;
      if (!this.look.speedDemon) return;
      const weight = keystrokeHeatWeight(kind, !!opts.repeat);
      if (!weight) return;
      const bump = 0.09 * weight * (this.look.speedDemonSensitivity ?? 1);
      this.heat = Math.min(1, this.heat + bump);
      this._heatKeyT = performance.now();
    };
    const onKeyDown = (e) => {
      this._markActivity("key");
      const k = e.key;
      if (k === "Unidentified" || k === "Process" || e.isComposing) return;
      this._realKeyT = performance.now();
      if (k === "Backspace" || k === "Delete") noteKeystroke("delete", e);
      else if (k === "Enter") noteKeystroke("enter", e);
      else if (k === " " || k === "Spacebar") noteKeystroke("space", e);
      else if (k === "Tab" || typeof k === "string" && k.length === 1) {
        noteKeystroke("type", e);
      } else if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" || k === "Home" || k === "End" || k === "PageUp" || k === "PageDown") {
        noteKeystroke("nav", e);
      }
    };
    const onBeforeInput = (e) => {
      this._markActivity("input");
      if (performance.now() - (this._realKeyT || 0) < 60) return;
      const t = e.inputType || "";
      if (t.startsWith("delete")) noteKeystroke("delete");
      else if (t === "insertLineBreak" || t === "insertParagraph") noteKeystroke("enter");
      else if (t === "insertText" || t === "insertCompositionText" || t === "insertReplacementText" || t === "insertFromPaste") {
        const data = typeof e.data === "string" ? e.data : "";
        noteKeystroke(data.endsWith(" ") ? "space" : "type");
      }
    };
    const onResize = () => {
      this._chromeCache = null;
      this._lastWrapperRect = "";
      this._lastOverlayRect = "";
      this._canvasRect = null;
      this._caretStyleCache = null;
      this._markActivity("resize");
    };
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("beforeinput", onBeforeInput, true);
    const onScrollLike = (e) => {
      if (this._scrollMovesCaret(e.target, doc)) {
        this._lastScrollT = performance.now();
        this._markActivity(e.type);
      }
    };
    const onSelectionChange = () => {
      if (this._selectionMoved(doc)) this._markActivity("selectionchange");
    };
    doc.addEventListener("selectionchange", onSelectionChange);
    doc.addEventListener("mousedown", onActivity, true);
    doc.addEventListener("focusin", onActivity, true);
    doc.addEventListener("wheel", onScrollLike, { capture: true, passive: true });
    doc.addEventListener("scroll", onScrollLike, { capture: true, passive: true });
    const onWindowFocusChange = () => this._markActivity("window focus");
    const win = doc.defaultView;
    if (win) {
      win.addEventListener("resize", onResize);
      win.addEventListener("focus", onWindowFocusChange);
      win.addEventListener("blur", onWindowFocusChange);
    }
    let onPageHide = null;
    if (win && doc !== document) {
      onPageHide = () => this.unregisterDocument(doc);
      win.addEventListener("pagehide", onPageHide);
    }
    this._docCleanups.set(doc, () => {
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("beforeinput", onBeforeInput, true);
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("mousedown", onActivity, true);
      doc.removeEventListener("focusin", onActivity, true);
      doc.removeEventListener("wheel", onScrollLike, { capture: true });
      doc.removeEventListener("scroll", onScrollLike, { capture: true });
      if (win) {
        win.removeEventListener("resize", onResize);
        win.removeEventListener("focus", onWindowFocusChange);
        win.removeEventListener("blur", onWindowFocusChange);
        if (onPageHide) win.removeEventListener("pagehide", onPageHide);
      }
    });
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this._lookChanged();
    this._wakeLoop();
    try {
      this.applyBodyClasses();
    } catch (e) {
      console.error("[cursor-smith] applyBodyClasses failed:", e);
    }
    try {
      this.applyOverlayStyle();
    } catch (e) {
      console.error("[cursor-smith] applyOverlayStyle failed:", e);
    }
    try {
      this._vimStatusSig = null;
      this.updateVimStatusBar();
    } catch (e) {
      console.error("[cursor-smith] status bar refresh failed:", e);
    }
    if (this.canvasEngineActive) {
      if (this.torchPossible() && !this.torchEngineActive) this.enableTorchOverlay();
      else if (!this.torchPossible() && this.torchEngineActive) this.disableTorchOverlay();
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
    this.settings.enabled = !this.settings.enabled;
    if (this.settings.enabled) this.enable();
    else this.disable();
    void this.saveSettings();
  }
  // "Enable on this device" (issue #31): saved to this device's local storage, off
  // as the string "off" - Obsidian's saveLocalStorage drops a falsy value,
  // so `false` read back as nothing - and on as nothing (so a new device
  // starts on); the engines follow at once. The synced "Enable plugin" is
  // untouched.
  setDeviceEnabled(on) {
    this._deviceEnabled = on;
    this.app.saveLocalStorage(DEVICE_ENABLED_KEY, on ? null : "off");
    if (on && this.settings.enabled) this.enable();
    else this.disable();
  }
  // A defensive catch that stays silent turns a bug into a cursor that is
  // quietly wrong. Every catch in this class is one of two things: an EXPECTED
  // failure with a comment naming it (a document torn down with its window, an
  // input type that has no selectionStart, an Obsidian without the event), or
  // a guard that must not take the frame down - and those report here, once
  // per site per engine run, so the first occurrence is in the console and the
  // ten-thousandth is not. A test sweeps the source for a catch that is
  // neither.
  _reportOnce(site, e) {
    const seen = this._reported || (this._reported = /* @__PURE__ */ new Set());
    if (seen.has(site)) return;
    seen.add(site);
    console.error("[cursor-smith] " + site + " (reported once):", e);
  }
  // The look/effect settings in force right now. When a Vim mode is active its
  // full snapshot is layered over the global settings; otherwise the global
  // settings are returned unchanged. The engine reads it as this.look (the
  // getter below), so every read in the engine honors the active mode with
  // no per-key plumbing - and this.settings is never touched.
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
        const win = this.canvas && this.canvas.ownerDocument.defaultView || window;
        const mq = win.matchMedia("(prefers-reduced-motion: reduce)");
        this._reduceMQ = mq;
        this._reduceMatches = !!mq.matches;
        this._reduceMQHandler = (e) => {
          this._reduceMatches = !!e.matches;
          this._lookChanged();
        };
        if (typeof mq.addEventListener === "function") mq.addEventListener("change", this._reduceMQHandler);
      }
      return this._reduceMatches;
    } catch {
      return false;
    }
  }
  effectiveSettings(mode) {
    if (mode === void 0) mode = this.currentVimMode();
    const cfg = mode && this.settings.vimModes && this.settings.vimModes[mode] || null;
    const reduce = this.reducedMotion();
    if (!cfg && !reduce) return this.settings;
    const c = this._effCache;
    if (c && c.mode === mode && c.base === this.settings && c.cfg === cfg && c.reduce === reduce) {
      return c.obj;
    }
    const obj = Object.assign({}, this.settings, cfg);
    if (reduce) applyReducedMotion(obj);
    this._effCache = { mode, base: this.settings, cfg, reduce, obj };
    return obj;
  }
  // The look the engine draws with: this.settings with the active Vim mode's
  // snapshot merged over it and reduced motion applied. Everything that
  // measures, spawns or paints reads THIS; everything that persists, and the
  // panel, reads this.settings - which is never replaced. It is a getter
  // over the memo in effectiveSettings (currentVimMode is memoized for a
  // frame too), so a read is a handful of comparisons and always agrees with
  // the settings object of the moment.
  //
  // Until 1.5.5 the two ticks swapped this.settings for the merged object
  // for the length of a frame and put it back in a finally, with a guard in
  // saveSettings against persisting the wrong one. That was correct while
  // every read in the frame was synchronous and nothing inside it saved -
  // and it was the kind of trick that stays correct until someone reads a
  // setting from a callback that fires mid-frame. Now there is nothing to
  // put back.
  get look() {
    return this.effectiveSettings(this.currentVimMode());
  }
  // Something changed what `look` answers: a save, a preset, the
  // reduced-motion query. Drops the memo and bumps the look generation the
  // static-frame signature carries (_frameSignature), so the next frame is
  // painted whatever else matched.
  _lookChanged() {
    this._effCache = null;
    this._lookGen = (this._lookGen | 0) + 1;
  }
  // Thin passthrough kept for the draw-path reads that take a key by name.
  styleFor(key) {
    return this.look[key];
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
    return this._anyDocFocused();
  }
  // Whether any window of ours has OS focus - windowFocused's question
  // without the setting, which editorFocused asks too.
  _anyDocFocused() {
    try {
      const canvasDoc = this.canvas && this.canvas.ownerDocument;
      if (canvasDoc && canvasDoc.hasFocus()) return true;
      if (typeof activeDocument !== "undefined" && activeDocument && activeDocument.hasFocus()) return true;
      for (const d of this.registeredDocuments) {
        try {
          if (d && d.hasFocus()) return true;
        } catch {
        }
      }
      if (canvasDoc || typeof activeDocument !== "undefined" && activeDocument || this.registeredDocuments.size) {
        return false;
      }
      return document.hasFocus();
    } catch (e) {
      this._reportOnce("windowFocused", e);
      return true;
    }
  }
  // Whether the note editor is the focused thing, for everything that draws.
  // CodeMirror's hasFocus is false the moment its window loses OS focus (it
  // asks document.hasFocus()) - to another app, or to Obsidian's own
  // settings window, which is a window of its own since 1.13 - so with "Hide
  // cursor when unfocused" OFF the loop kept running and the caret vanished
  // anyway: there was no focused editor to measure. "It still hides it if
  // off ... if I click in settings the cursor is not displaying"
  // (2026-09-25), exactly when a look is being tuned. With the setting off,
  // an editor that still holds its page's focus (activeElement outlives a
  // window blur) counts - unless a text field in another window of ours has
  // the focus: typing there is that field's caret (_focusedForeignDoc
  // moves the canvas to it), not the note's.
  editorFocused(view) {
    if (!view) return false;
    if (view.hasFocus) return true;
    if (this.settings.hideOnWindowBlur) return false;
    try {
      const doc = view.dom.ownerDocument;
      if (doc.hasFocus()) return false;
      const a = doc.activeElement;
      if (!a || !(a === view.contentDOM || view.contentDOM.contains(a))) return false;
      const other = this._focusedForeignDoc(view);
      return !(other && isTextCaretHost(other.activeElement));
    } catch (e) {
      this._reportOnce("editorFocused", e);
      return false;
    }
  }
  // Whether the native caret should currently be suppressed. Every site that
  // stamps cursor-smith-hide-native reads this rather than the setting,
  // because with Note Editor Only on the answer changes with FOCUS and not
  // only when a setting is saved.
  hideNativeActive() {
    if (this._watchdogGaveUp) return false;
    if (!this.settings.hideNativeCaret) return false;
    if (!this.settings.noteEditorOnly) return true;
    return this.noteEditorFocused();
  }
  applyBodyClasses() {
    const engineActive = !!(this.canvasEngineActive || this.torchEngineActive);
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
        try {
          if (d.body && d.hasFocus()) return d;
        } catch {
        }
      }
    } catch (e) {
      this._reportOnce("_focusedForeignDoc", e);
    }
    return null;
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
      const doc = this.canvas?.ownerDocument ?? (typeof activeDocument !== "undefined" ? activeDocument : null) ?? document;
      const slidesContainer = doc.querySelector(".slides-container");
      if (slidesContainer && this._isVisiblyRendered(slidesContainer)) return true;
      const activeView = this.app.workspace.getActiveViewOfType(import_obsidian6.View);
      if (activeView?.getViewType?.() === "slides") return true;
    } catch (e) {
      this._reportOnce("isPresentationModeActive", e);
    }
    return false;
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
    this._reported = /* @__PURE__ */ new Set();
    if (!this._caret) this._caret = {};
    this.trail = [];
    this.particles = [];
    this.flamePixels = [];
    this.flameEmbers = [];
    this.hotBurns = [];
    this._hotPrev = null;
    this.thunderbolts = [];
    this.fireworks = [];
    this._lastFireworkT = 0;
    this.glitch = null;
    this.stardust = [];
    this._lastStardustT = 0;
    this.bracketTether = null;
    this._tetherKey = null;
    this._tetherFrom = -1;
    this._tetherTo = -1;
    this._tetherSegs = null;
    this._tetherSegKey = null;
    this._tetherAnchorA = null;
    this._tetherAnchorB = null;
    this.secondaryCarets = [];
    this._secondaries = [];
    this._selShape = null;
    this.lastActive = null;
    this.pending = null;
    this.smearQuad = null;
    this._smearLead = null;
    this._smearTrail = null;
    this.smearShape = null;
    this._taperBuf = null;
    this._volumeBuf = null;
    this._smearDir = null;
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;
    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;
    this._catchUpBoost = 1;
    this._smoothMoving = false;
    this._smoothLastT = 0;
    this._typingBoostSm = null;
    this._hotEmitFrom = null;
    this._hotActiveT = 0;
    this._lastHotT = 0;
    this._hotShiftTick = 0;
    this._hotEngulfUntil = 0;
    this.heat = 0;
    this._lastSparkT = 0;
    this._popRainbowHue = 0;
    this._hideNativeSig = null;
    this._selSig = null;
    this._idleWakeMs = 0;
    this._glyphMetricKey = null;
    this._glyphMetrics = null;
    this._hotFill = null;
  }
  enable() {
    this.disable();
    if (this._deviceEnabled === false) return;
    this._watchdogGaveUp = false;
    this.enableCanvasEngine();
    if (this.torchPossible()) this.enableTorchOverlay();
  }
  disable() {
    this.disableCanvasEngine();
    this.disableTorchOverlay();
  }
};
Object.assign(CursorSmithPlugin.prototype, measureMethods, effectsMethods, paintMethods, torchMethods, libraryMethods, vimMethods, engineMethods, caretsMethods);
for (const key of CARET_STATE_FIELDS) {
  Object.defineProperty(CursorSmithPlugin.prototype, key, {
    configurable: true,
    enumerable: false,
    get() {
      const c = this._caret;
      return c ? c[key] : void 0;
    },
    set(value) {
      const c = this._caret || (this._caret = {});
      c[key] = value;
    }
  });
}

// src/main.ts
var main_default = CursorSmithPlugin;
