const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");

// Clear only the region the previous frame actually painted, instead of the
// whole viewport-sized surface. See the damage-tracking notes above draw().
// Flip to false to restore full-surface clears if you ever see ghost pixels.
const DIRTY_RECT_CLEAR = true;

// Frame interval for the energy shimmer when it is the only thing animating.
// The gradient's pulse has roughly a 1.7s period at speed 1, so 33ms gives
// ~50 samples per cycle (visually identical to 60fps). Raise this to trade
// smoothness for GPU: 66 is ~25 samples/cycle, 100 is ~17 and will start to
// show visible stepping in the travelling wave.
const ENERGY_FRAME_MS = 33;

// Thunderstrike (Pixel Trail sub-option) tuning.
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

// Frame interval for the torch's blink-sync pulse. The spotlight's radius only
// moves during the blink's two short fades - the long holds either side are a
// constant value - so this doesn't need display rate, and 33ms across a fade of
// a few hundred ms is far more steps than a slow radius change can show.
const TORCH_PULSE_FRAME_MS = 33;

// Ceiling on how far Smooth Movement's adaptive catch-up is allowed to stiffen
// the smear's leading corners. See updateSmearQuad.
const SMEAR_LEAD_BOOST_CAP = 6;

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
  overlayDarkness: 0.7,
  overlayIntensity: 0.1,
  overlayColor: "#ff963c",
  overlayFlicker: false,
  // Blink sync: the spotlight breathes with the caret's blink, contracting as
  // the caret fades out and opening back up as it returns. Off by default -
  // see the note in the torch tick, it is the one torch option that costs
  // frames while nothing else is happening.
  overlayBlinkSync: false,
  overlayBlinkDepth: 0.25,   // 0.05..0.6; how far the light closes at the darkest point
  overlaySpeed: 0.22, // lerp factor: how fast the torch chases its target

  // --- global caret properties ---
  caretWidthPx: 2,         
  popLetters: true,        
  popRainbow: false,       // cycle each popped letter through a rainbow of colors
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
  // Pixel Trail sub-option: pressing Enter calls down a bolt of pixelated
  // lightning onto the caret's new position, from a random angle above it.
  thunderstrike: false,
  thunderstrikeSize: 2,    // px per block of the bolt; the effect's chunkiness
  thunderstrikeStrength: 0.5,  // 0.1..1 overall visibility of the strike
  backspaceDisintegrate: false,  // Backspace/Delete → invert flame trail direction + colors
  lineSerifs: false,             // Line cursor: add horizontal serifs (I-beam look)
  // Underline cursor thickness in px. 0 = auto: scale with the line height,
  // which is what this style did before the slider existed, so an existing
  // setup (and a fresh install) keeps exactly the look it had.
  underlineWidthPx: 0,
  boxHollow: false,              // Box cursor: outline only, no fill
  boxHollowWidth: 2,             // Outline stroke width when boxHollow is on

  // --- Speed Demon: cursor heats up with typing speed ---
  speedDemon: false,
  speedDemonSparks: true,        // spawn small fire particles at high heat
  speedDemonSensitivity: 1,      // 0.5..2 multiplier on how fast heat builds
  speedDemonSparkQuantity: 1,    // 0..3 multiplier on how many sparks spawn per burst
  speedDemonSparkTrail: 0,       // 0..30px comet-tail trailing behind each spark; 0 = no trail

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
  "speedDemonSparkQuantity", "speedDemonSparkTrail",
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
const CURLY_QUOTE_CLOSE = { "\u201D": "\u201C", "\u2019": "\u2018" };
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
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true,
    "inkEffect": true, "inkColor": "#1a1a2e", "inkOpacity": 0.55, "inkPooling": true
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
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true,
    "inkEffect": true, "inkColor": "#1a1a2e", "inkOpacity": 0.55, "inkPooling": true
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
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true,
    "inkEffect": true, "inkColor": "#1a1a2e", "inkOpacity": 0.55, "inkPooling": true
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
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true,
    "inkEffect": true, "inkColor": "#1a1a2e", "inkOpacity": 0.55, "inkPooling": true
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
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true,
    "inkEffect": true, "inkColor": "#1a1a2e", "inkOpacity": 0.55, "inkPooling": true
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
    "catchUpSpeed": 0.6, "maxCatchUpSpeed": 0.9, "smoothAdaptive": true,
    "inkEffect": true, "inkColor": "#1a1a2e", "inkOpacity": 0.55, "inkPooling": true
  },
};

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
// Old codes (raw base64url JSON) are still accepted - codeToPreset sniffs the
// "1|" prefix and routes anything else to the legacy decoder, so nobody's saved
// codes stop working.
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

function presetToCode(name, snap) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  const look = pickLook(snap);
  const fields = [];
  for (let i = 0; i < LOOK_KEYS.length; i++) {
    const k = LOOK_KEYS[i];
    if (!(k in look)) continue;
    const v = look[k];
    // Skip anything equal to the default - the recipient fills it back in.
    // Numbers compared loosely so 0.5 and "0.5" (from an old code round-trip)
    // don't both get emitted; everything else by strict identity.
    if (v === defaults[k]) continue;
    if (typeof v === "number" && typeof defaults[k] === "number" &&
        shareNum(v) === shareNum(defaults[k])) continue;
    fields.push(i + shareEncodeValue(v));
  }
  return [SHARE_VERSION, encodeURIComponent(name || ""), fields.join("~")].join("|");
}

function codeToPreset(code) {
  const trimmed = (code || "").trim();
  // Legacy: anything that isn't the new versioned format is tried as the old
  // base64url-JSON blob, so previously shared codes keep importing.
  if (trimmed.slice(0, 2) !== SHARE_VERSION + "|") return legacyCodeToPreset(trimmed);
  try {
    const parts = trimmed.split("|");
    // parts[0] is the version, already matched. Extra "|" only appears if the
    // name field held a literal one, which encodeURIComponent prevents - so a
    // fixed 3-way split is safe.
    const name = decodeURIComponent(parts[1] || "") || "Imported preset";
    const body = parts.slice(2).join("|");
    const snap = {};
    if (body) {
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
    }
    return { name, snap };
  } catch {
    return null;
  }
}

// The pre-v1 decoder: base64url of the snapshot JSON with the name under __name.
function legacyCodeToPreset(code) {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const obj = JSON.parse(json);
    const name = obj.__name || "Imported preset";
    const snap = Object.assign({}, obj);
    delete snap.__name;
    return { name, snap };
  } catch {
    return null;
  }
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
function thunderRamp() {
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
function hslToRgbString(h, s, l) {
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
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function invertColor(colorStr) {
  const nums = (colorStr || "").match(/[\d.]+/g);
  if (!nums || nums.length < 3) return "#000000";
  const [r, g, b] = nums.map(Number);
  return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
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
    const saved = migrateLegacyKeys(await this.loadData());
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

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


    // Dynamic Multi-Window Tracking Engine
    this._cleanups = [];
    this.registeredDocuments = new Set();

    // Engine Core States
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this.trail = []; 
    this.particles = []; 
    this.flamePixels = [];
    this.thunderbolts = [];
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
    this.secondaryCarets = []; // dashed 2px vertical lines for CM6 multi-cursor mode
    this.lastActive = null; 
    this.pending = null; 
    this.smearQuad = null;
    // The corners actually painted: smearQuad itself, or a tapered copy of it.
    // Kept apart from the quad because the quad is the spring's *state*, and a
    // tapered corner fed back into it would spring toward the narrowed shape -
    // the taper would fight the very lag it's drawn from.
    this.smearShape = null;
    this._taperBuf = null;
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

    // Popping Letters rainbow: a running hue that advances with each popped
    // letter (rather than picking randomly) so consecutive letters step
    // smoothly around the color wheel instead of jumping around.
    this._popRainbowHue = 0;

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
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._chromeCache = null;
    // Per-caret computed-style/metric cache for cmCaretCoords (see there).
    this._caretStyleCache = null;
    this._tickErrorLogged = false;
    this._torchErrorLogged = false;

    // -----------------------------------------------------------------------
    // Command palette — exactly two entries, registered unconditionally.
    //
    // Both work regardless of whether Cursor-Smith itself is toggled on: the
    // Vim system deliberately never reads settings.enabled or the engine
    // flags, so "Cycle preset" keeps functioning with the custom cursors off.
    //
    // The CUA/Vim mode switch is intentionally NOT a palette command anymore.
    // Toggling it from the palette meant setVimModeEnabled could fire from
    // any app state (mid-typing, palette focus in flight, no editor, etc.),
    // and its side-effect chain — flipping Obsidian's vim keybindings via
    // updateOptions(), which rebuilds every editor's extensions, plus the
    // synthetic-Escape normal-mode forcing — proved too heavy/fragile to run
    // from arbitrary contexts. The mode switch lives only in the settings
    // panel (renderModeSwitch), where it runs from a known-quiet state.
    //
    // "Cycle preset" is one command that dispatches on the current mode
    // (CUA presets in CUA mode, Vim presets in Vim mode) under a single
    // stable ID, so one hotkey works in both modes.
    // -----------------------------------------------------------------------
    this.addCommand({
      id: "cycle-preset",
      name: "Cycle preset",
      callback: () => this.cycleActivePreset(1),
    });

    this.addCommand({
      id: "toggle-cursor-smith",
      name: "Toggle Cursor-Smith on/off",
      callback: () => this.toggle(),
    });

    this.addSettingTab(new CursorSmithSettingTab(this.app, this));

    // Status bar indicator. The canvas tick calls updateVimStatusBar() the
    // instant the mode changes, so while the cursor engine runs this interval
    // is pure backstop — it only matters with the custom cursors toggled off,
    // and for noticing a theme switch. 250ms is plenty for that, and past the
    // signature check the update is a no-op, keeping the steady-state cost to
    // one memoized mode read per tick.
    this.registerInterval(window.setInterval(() => this.updateVimStatusBar(), 250));

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
    if (this._cleanups) {
      for (const cleanup of this._cleanups) cleanup();
      this._cleanups = [];
    }
  }

  injectStyles(doc) {
    const id = "cursor-smith-dynamic-styles";
    if (doc.getElementById(id)) return;
    
    const styleEl = doc.createElement("style");
    styleEl.id = id;
    styleEl.textContent = `
      /* NO -webkit-app-region declaration on any of our layers.
         Electron composes drag regions by unioning elements with
         app-region:drag, then SUBTRACTING elements with app-region:no-drag
         (alias: none). An element with NO declaration is completely neutral
         - Electron ignores it for hit-testing. Setting app-region:none on
         our layers was actively punching holes in the tab bar's drag rects
         (confirmed: wrapper computed as "no-drag", killed dragging entirely
         even though the wrapper rect was already below the tab bar). The
         correct approach is: declare nothing, keep pointer-events:none so
         clicks pass through, and rely on the physical rect not covering
         the drag surface (enforced by _chromeInsets in the tick loops). */
      .retro-box-cursor-canvas {
        pointer-events: none;
      }
      /* Hide the primary cursor by BOTH position (first child of the
         cursor layer) and class (.cm-cursor-primary), so this works whether
         Obsidian's CM6 uses per-cursor class distinctions or not. */
      .retro-box-cursor-hide-native .cm-cursorLayer > .cm-cursor:first-child,
      .retro-box-cursor-hide-native .cm-cursor-primary,
      .retro-box-cursor-hide-native .cm-fat-cursor,
      .retro-box-cursor-hide-native .cm-dropCursor {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        border-color: transparent !important;
        background-color: transparent !important;
        animation: none !important;
      }
      /* Force every subsequent cursor visible for multi-cursor editing,
         matched by both position and class name. */
      .retro-box-cursor-hide-native .cm-cursorLayer > .cm-cursor:not(:first-child),
      .retro-box-cursor-hide-native .cm-cursor-secondary {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      .torch-cursor-overlay {
        position: fixed;
        pointer-events: none;
        /* Collapsed by default: the tick loop sizes this inline every
           frame; these defaults only cover the gap between DOM insertion
           and the first frame, so the overlay can never sit over the
           drag surface during that window. */
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        z-index: 9990;
        background: radial-gradient(
          circle var(--torch-radius, 250px) at var(--torch-x, 50%) var(--torch-y, 50%),
          rgba(var(--torch-warm, 255, 150, 60), var(--torch-intensity, 0.1)) 0%,
          rgba(0, 0, 0, var(--torch-darkness, 0.7)) 100%
        );
        mix-blend-mode: multiply;
        opacity: 1;
        transition: opacity 0.2s ease;
      }
      .torch-cursor-overlay.torch-cursor-hidden {
        opacity: 0 !important;
        display: none !important;
      }
      /* The candle-flicker keyframe animation was removed deliberately. A CSS
         animation is driven by the compositor, entirely outside the rAF frame
         governor below - so it pinned the display to full refresh rate forever
         whenever the torch was on, no matter what gear the render loops chose.
         It was also the worst possible element to animate: the overlay carries
         mix-blend-mode: multiply over the whole editor pane, so every flicker
         frame forced the blended layer to be recomposited against its backdrop
         rather than being a cheap compositor-only opacity change. Do NOT
         re-add an animation property on .torch-cursor-overlay, here or in
         styles.css. If the effect is ever wanted again, drive it from the
         torch tick by writing --torch-intensity, so that it is subject to the
         frame governor and parks along with everything else. */
    `;
    doc.head.appendChild(styleEl);
  }

  registerWindowEvents(doc) {
    if (this.registeredDocuments.has(doc)) return;
    this.registeredDocuments.add(doc);
    
    const onMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.lastMouseMove = Date.now();
      // Wakes only the torch (which may be following the mouse) — moving the
      // pointer must not spin the cursor canvas up to full rate.
      this._wakeTorch();
    };
    // Any of these means the picture may be about to change: snap the render
    // loops out of idle so the very next frame reflects it.
    const onActivity = () => this._markActivity();
    // Backspace/Delete flag: set on keydown, consumed by the next
    // commitMove() so the flame-pixel burst at the *old* caret position
    // knows it was caused by deletion (and can invert direction + color).
    // Timestamped so a stale flag from ~200ms ago doesn't wrongly colour a
    // burst caused by unrelated caret movement that arrived late.
    const onKeyDown = (e) => {
      this._markActivity();
      if (e.key === "Backspace" || e.key === "Delete") {
        this._deletePending = performance.now();
      }
      // Enter flag: same shape as the delete flag above, consumed by the next
      // commitMove() so a Thunderstrike can be aimed at the caret's NEW line.
      // Keyed off the keystroke rather than off "the caret moved down a line",
      // because that also describes arrow keys, clicking, and wrapping - none
      // of which should call down lightning.
      if (e.key === "Enter") {
        this._enterPending = performance.now();
      }
      // Speed Demon: any key that plausibly represents "the user is typing"
      // bumps heat. Filter out pure modifiers, navigation, function keys,
      // and IME composition - none of those feel like writing to the user
      // and shouldn't heat the cursor. Single-character keys ("a", "1",
      // "?") plus Backspace/Enter/Space/Tab cover the real cases.
      if (this.settings.speedDemon && !e.isComposing && !e.repeat) {
        const k = e.key;
        const isTyping =
          (typeof k === "string" && k.length === 1) ||
          k === "Backspace" || k === "Enter" || k === " " ||
          k === "Spacebar" || k === "Tab";
        if (isTyping) {
          const bump = 0.09 * (this.settings.speedDemonSensitivity ?? 1);
          this.heat = Math.min(1, this.heat + bump);
        }
      }
    };
    const onResize = () => {
      // Chrome insets and the deduped wrapper/overlay rects are all stale
      // after a resize - drop them so the next frame re-measures instead
      // of waiting out the 500ms cache window.
      this._chromeCache = null;
      this._lastWrapperRect = "";
      this._lastOverlayRect = "";
      this.resizeCanvas();
      this._markActivity();
    };
    
    doc.addEventListener("mousemove", onMouseMove);
    doc.addEventListener("keydown", onKeyDown, true);
    // Wake sources beyond typing: caret moves from clicks and selection
    // changes, viewport shifts from scroll/wheel, and focus hops between
    // fields. All capture-phase (or document-level) so nothing that
    // stopPropagation()s can starve the render loops. Passive where
    // applicable so they can't add scroll latency.
    doc.addEventListener("selectionchange", onActivity);
    doc.addEventListener("mousedown", onActivity, true);
    doc.addEventListener("focusin", onActivity, true);
    doc.addEventListener("wheel", onActivity, { capture: true, passive: true });
    doc.addEventListener("scroll", onActivity, { capture: true, passive: true });
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
    
    this._cleanups.push(() => {
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("selectionchange", onActivity);
      doc.removeEventListener("mousedown", onActivity, true);
      doc.removeEventListener("focusin", onActivity, true);
      doc.removeEventListener("wheel", onActivity, { capture: true });
      doc.removeEventListener("scroll", onActivity, { capture: true });
      if (win) {
        win.removeEventListener("resize", onResize);
        win.removeEventListener("focus", onWindowFocusChange);
        win.removeEventListener("blur", onWindowFocusChange);
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

    this.loadUserPreset(nextName).then(() => {
      this._activePresetName = nextName;
      // Persist the pending name so the settings tab reflects the active preset.
      this._pendingPresetName = nextName;
      new Notice(`Cursor-Smith: ${nextName}`);
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

  toggle() {
    const wasActive = !!(this.canvasEngineActive || this.torchEngineActive);
    wasActive ? this.disable() : this.enable();
    this.settings.enabled = !!(this.canvasEngineActive || this.torchEngineActive);
    this.saveSettings();
  }

  // =========================================================================
  // Vim-aware cursors
  // =========================================================================

  // Single entry point for turning the plugin's Vim cursors on/off. Only
  // reachable from the settings panel's CUA/Vim switch (renderModeSwitch) —
  // deliberately not exposed as a palette command; see the note where the
  // commands are registered. Also:
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
      return !!(root && root.querySelector && root.querySelector(".cm-fat-cursor"));
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
  effectiveSettings(mode) {
    if (mode === undefined) mode = this.currentVimMode();
    if (!mode) return this.settings;
    const cfg = this.settings.vimModes && this.settings.vimModes[mode];
    if (!cfg) return this.settings;
    // Memoized: two render loops each merged a fresh ~60-key object EVERY
    // frame, which is pure allocation/GC churn since the inputs only change
    // on a mode switch or a settings edit. Keyed on identity of the inputs;
    // saveSettings drops the cache so in-place edits (sliders mutate the
    // mode object directly, then save) are picked up immediately.
    const c = this._effCache;
    if (c && c.mode === mode && c.base === this.settings && c.cfg === cfg) return c.obj;
    const obj = Object.assign({}, this.settings, cfg);
    this._effCache = { mode, base: this.settings, cfg, obj };
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
      // — the standard flexbox left/right split. Inline (not styles.css) so
      // it can't be lost to a stale cached stylesheet.
      this.vimStatusEl.style.order = "-9999";
      this.vimStatusEl.style.marginRight = "auto";
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

      if (!mode) { el.setText(""); el.style.color = ""; return; }

      // Vim's own showmode format: "-- INSERT --", all caps.
      el.setText(`-- ${(VIM_MODE_LABELS[mode] || mode).toUpperCase()} --`);
      if (!tint) {
        // Clear rather than assign a "default": the status bar's own color is
        // theme-provided, so inheriting it is the only way to stay correct
        // across themes.
        el.style.color = "";
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
  _markActivity() {
    this._lastActivityT = performance.now();
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
      if (this.canvasEngineActive && this._canvasTick) {
        this.canvasRaf = requestAnimationFrame(this._canvasTick);
      }
    }
    this._wakeTorch();
  }

  // Torch-only wake: mouse movement retargets the spotlight but shouldn't
  // spin the cursor canvas up to full rate.
  _wakeTorch() {
    if (this._torchIdleT) {
      window.clearTimeout(this._torchIdleT);
      this._torchIdleT = 0;
      if (this.torchEngineActive && this._torchTick) {
        this.torchRaf = requestAnimationFrame(this._torchTick);
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
      const doc =
        (this.canvas && this.canvas.ownerDocument) ||
        (typeof activeDocument !== "undefined" && activeDocument) ||
        document;
      return doc.hasFocus();
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
      new Notice("Cursor-Smith: no Vim presets saved");
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
  }

  // Returns the name it was saved under, or null if the code was invalid.
  async importVimPreset(code) {
    const result = codeToPreset(code.trim());
    if (!result) return null;
    this.getVimPresets()[result.name] = cloneVimModes(result.snap);
    this.settings.vimActivePreset = result.name;
    await this.saveSettings();
    return result.name;
  }

  getActiveColor() {
    const baseColor = this.getBaseColor();
    if (!this.settings.speedDemon) return baseColor;
    return this.heatColor(this.heat, baseColor);
  }

  // Get the base (non-heated) color. Used by Speed Demon internally so its
  // "cold" endpoint desaturates the user's chosen colour rather than
  // always starting from the same grey - a green-configured cursor cools
  // to a dim moss, an orange one cools to slate.
  //
  // This is also the single flat colour every effect that ISN'T the cursor
  // body falls back to: the CRT glow halo, Pixel Trail particles, secondary
  // carets, popping letters. With Gradient on, that colour is the ramp's first
  // stop, so those effects stay in the same family as the cursor instead of
  // going on painting themselves in a per-theme colour the cursor no longer
  // uses anywhere.
  getBaseColor() {
    if (this.settings.gradientEnabled) return this.gradientStops()[0];
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
  gradientStops() {
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
      if (s.speedDemon && this.heat > 0) hex = this.heatColor(this.heat, hex);
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
    // the first stop as a flat fill.
    if (!(span > 0)) return hexToRgba(stops[0], alpha);

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
  heatColor(heat, baseHex) {
    const h = Math.max(0, Math.min(1, heat));
    const [br, bg, bb] = hexToRgbTuple(baseHex);
    // Cold endpoint: 30% saturation-preserving desaturation toward mid-grey,
    // then dim to ~72% brightness. Uses luma (Rec. 601 coefficients) so
    // the grey we blend toward matches the perceived brightness of the
    // base colour instead of muddying dark colours.
    const luma = 0.299 * br + 0.587 * bg + 0.114 * bb;
    const desatMix = 0.7;                      // higher = greyer
    const dim = 0.72;
    const coldR = ((1 - desatMix) * br + desatMix * luma) * dim;
    const coldG = ((1 - desatMix) * bg + desatMix * luma) * dim;
    const coldB = ((1 - desatMix) * bb + desatMix * luma) * dim;

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
    if (this.stardust.length >= 60) return;

    const now = performance.now();
    const rate = Math.max(0.1, this.settings.stardustRate ?? 1);
    // ~1 mote every 320ms at rate 1: a lazy drift rather than a fountain.
    if (now - (this._lastStardustT || 0) < 320 / rate) return;
    this._lastStardustT = now;

    const active = this.animActive;
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
          "retro-box-cursor-hide-native",
          !!(engineActive && this.settings.hideNativeCaret && !presenting)
        );
      }
    }
  }

  applyOverlayStyle() {
    if (!this.overlay) return;
    const s = this.settings;
    const o = this.overlay;
    // --torch-radius is deliberately NOT written here. With Blink Sync on it
    // changes every frame, so the torch tick owns it outright and writes it on
    // its own dedupe; a second writer here would stamp the un-pulsed value back
    // over it whenever anything else about the overlay changed.
    o.style.setProperty("--torch-darkness", String(s.overlayDarkness));
    o.style.setProperty("--torch-intensity", String(s.overlayIntensity));
    o.style.setProperty("--torch-warm", hexToRgb(s.overlayColor));
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
    const targetDoc =
      (view && view.dom.ownerDocument) ||
      (this.canvasWrapper && this.canvasWrapper.ownerDocument) ||
      (typeof activeDocument !== "undefined" && activeDocument) ||
      document;
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument !== targetDoc) {
      this.canvasWrapper.remove();
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
    }
    if (!this.canvasWrapper) {
      targetDoc.body.classList.add("retro-box-cursor-active");
      
      // The wrapper creates a strict physical bounding box to unblock window
      // dragging. See _chromeInsets / getFullViewportRect for the sizing
      // logic - the wrapper is never sized to overlap the tab bar.
      this.canvasWrapper = targetDoc.createElement("div");
      this.canvasWrapper.style.position = "fixed";
      this.canvasWrapper.style.overflow = "hidden";
      this.canvasWrapper.style.pointerEvents = "none";
      this.canvasWrapper.style.zIndex = "10000";
      this.canvasWrapper.style.top = "0px";
      this.canvasWrapper.style.left = "0px";
      this.canvasWrapper.style.width = "0px";
      this.canvasWrapper.style.height = "0px";
      this._lastWrapperRect = "";
      // Append inside .app-container rather than directly on body.
      // Obsidian's app.css has: body.is-frameless > .app-container ~ * { app-region: no-drag }
      // which targets every direct-body-child sibling of .app-container —
      // exactly what we were. Inside .app-container that rule doesn't match
      // and our elements stay neutral (no app-region) as intended.
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      appContainer.appendChild(this.canvasWrapper);

      this.canvas = targetDoc.createElement("canvas");
      this.canvas.className = "retro-box-cursor-canvas";
      this.canvas.style.position = "absolute";
      // NO app-region declaration (same rationale as wrapper above).
      this.canvasWrapper.appendChild(this.canvas);
      
      this.ctx = this.canvas.getContext("2d");
      this.injectStyles(targetDoc);
      this.resizeCanvas();
    }
    if (!targetDoc.body.classList.contains("retro-box-cursor-active")) {
      targetDoc.body.classList.add("retro-box-cursor-active");
    }
    targetDoc.body.classList.toggle("retro-box-cursor-hide-native", !!this.settings.hideNativeCaret);
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
      targetDoc.body.classList.add("torch-cursor-active");
      // Same as canvas wrapper: append inside .app-container to avoid
      // Obsidian's body.is-frameless > .app-container ~ * { no-drag } rule.
      const appContainer = targetDoc.querySelector(".app-container") || targetDoc.body;
      this.overlay = appContainer.createDiv({ cls: "torch-cursor-overlay" });
      this.overlay.style.top = "0px";
      this.overlay.style.left = "0px";
      this.overlay.style.width = "0px";
      this.overlay.style.height = "0px";
      this._lastOverlayRect = "";
      // A brand new element carries none of the old one's inline custom
      // properties, so the radius cache has to be dropped with it or the tick
      // would dedupe against a value this overlay was never given.
      this._lastTorchRadius = -1;
      this.injectStyles(targetDoc);
      this.applyOverlayStyle();
      
      this.modalOpen = !!targetDoc.querySelector(".modal-container");
      this.modalObserver = new MutationObserver(() => {
        this.modalOpen = !!targetDoc.querySelector(".modal-container");
      });
      this.modalObserver.observe(targetDoc.body, { childList: true });
    }
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
        (typeof activeDocument !== "undefined" && activeDocument) ?? document;
      const slidesContainer = doc.querySelector(".slides-container");
      if (slidesContainer && this._isVisiblyRendered(slidesContainer)) return true;

      // 2. Workspace API check: the active leaf's view type becomes "slides"
      //    for the duration of the presentation.
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf?.view?.getViewType?.() === "slides") return true;
    } catch {
      // Never crash the tick loop over a failed presentation check.
    }
    return false;
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
      cancelAnimationFrame(this.canvasRaf);
      this.canvasRaf = 0;
    }
    // The governor may be dozing on a timeout rather than an rAF.
    if (this._canvasIdleT) {
      window.clearTimeout(this._canvasIdleT);
      this._canvasIdleT = 0;
    }
    this._canvasTick = null;
    this._drawSig = null;
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("retro-box-cursor-active", "retro-box-cursor-hide-native");
        const canvas = doc.querySelector(".retro-box-cursor-canvas");
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
    this.pending = null;
    this.smearQuad = null;
    this.smearShape = null;
    this._smearDir = null;
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;
    this.particles = [];
    this.flamePixels = [];
    this.thunderbolts = [];
    this.glitch = null;
    this.stardust = [];
    this.secondaryCarets = [];
    this.bracketTether = null;
    this._tetherKey = null;
    this._tetherSegs = null;
    this._tetherSegKey = null;
    this.animActive = null;
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
    this._lastTorchPos = "";
    this._lastTorchRadius = -1;
    if (this.torchRaf) {
      cancelAnimationFrame(this.torchRaf);
      this.torchRaf = 0;
    }
    const docs = [document, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("torch-cursor-active");
        doc.querySelector(".torch-cursor-overlay")?.remove();
      }
    }
    this.overlay = null;
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.modalOpen = false;
  }

  enableCanvasEngine() {
    this.canvasEngineActive = true;
    this.trail = [];
    this.particles = [];
    this.flamePixels = [];
    this.thunderbolts = [];
    this.glitch = null;
    this.stardust = [];
    this._lastStardustT = 0;
    this.secondaryCarets = [];
    this.bracketTether = null;
    this._tetherKey = null;
    this._tetherSegs = null;
    this._tetherSegKey = null;
    this.lastActive = null;
    this.pending = null;
    this.smearQuad = null;
    this.smearShape = null;
    this._smearDir = null;
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;
    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;
    this._catchUpBoost = 1;
    this._suspendCleared = false;
    // Begin from a known-clean surface: the canvas survives enable/disable
    // cycles, so assume nothing about what is currently painted on it.
    this._dirty = null;
    this._dirtyPrev = null;
    this._dirtyFull = true;

    // Schedule the next frame according to the gear the frame just decided
    // on (this._canvasGear): hot = next vsync, warm/idle = doze on a timeout
    // that _markActivity can cancel for instant wake.
    const schedule = () => {
      if (!this.canvasEngineActive) return;
      const gear = this._canvasGear || "hot";
      if (gear === "hot") {
        this.canvasRaf = requestAnimationFrame(tick);
        return;
      }
      this._canvasIdleT = window.setTimeout(() => {
        this._canvasIdleT = 0;
        if (this.canvasEngineActive) this.canvasRaf = requestAnimationFrame(tick);
      }, gear === "warm" ? 33 : gear === "energy" ? ENERGY_FRAME_MS : 100);
    };

    const tick = () => {
      if (!this.canvasEngineActive) return;
      // Hot-gear frame cap: on 120Hz ProMotion displays rAF fires every
      // ~8ms; a cursor gains nothing above ~60fps, so skip alternate
      // frames. The skipped wake-up is just a reschedule, costing ~nothing.
      if ((this._canvasGear || "hot") === "hot") {
        const n = performance.now();
        if (n - (this._lastHotFrameT || 0) < 14) {
          this.canvasRaf = requestAnimationFrame(tick);
          return;
        }
        this._lastHotFrameT = n;
      }
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
            const win = this.canvas.ownerDocument.defaultView || window;
            this.ctx.clearRect(0, 0, win.innerWidth, win.innerHeight);
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
          const { bottomInset } = this._chromeInsets(this.canvas.ownerDocument);
          if (bottomInset > 0) {
            const win = this.canvas.ownerDocument.defaultView || window;
            const maxBottom = win.innerHeight - bottomInset;
            if (top + height > maxBottom) height = Math.max(0, maxBottom - top);
          }
          const key = top + "," + left + "," + width + "," + height;
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
            // Shift the canvas backward so absolute screen coordinates draw
            // perfectly. transform: none when there's no offset avoids
            // promoting the canvas to a separate compositor layer for
            // nothing.
            this.canvas.style.transform =
              top === 0 && left === 0 ? "none" : `translate(${-left}px, ${-top}px)`;
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
          this.onVimModeChanged(_vimMode);
        }
        const _realSettings = this.settings;
        this.settings = this.effectiveSettings(_vimMode);
        this._settingsSwapped = true;
        try {
          this.updateActivePoint();
          this.updateSmoothCursor();
          // Multi-cursor: gather all non-primary carets so draw() can stamp a
          // dashed line at each. Independent of the smoothing/smearing pipeline
          // that only tracks the primary caret.
          this.secondaryCarets = this.secondaryCaretCoords(view);
          // Cheap when off, and internally cached on (caret pos, doc length)
          // so the text scan doesn't rerun every frame while the caret sits
          // still.
          this.bracketTether = this.settings.bracketTether
            ? this.bracketTetherCoords(view)
            : null;
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
          // Self-guarding (checks its own toggles and the idle window), and
          // must run before the gear decision below, which reads stardust
          // length to decide whether this frame may be skipped.
          this.maybeSpawnStardust();

          // ---- Gear decision + draw skip -------------------------------
          const nowT = performance.now();
          const eff = this.settings; // the effective (mode-merged) object
          // Anything genuinely in motion demands continuous frames.
          const animating =
            !!this._smoothMoving ||
            !!this.pending ||
            (this.trail && this.trail.length > 0) ||
            (this.particles && this.particles.length > 0) ||
            // flamePixels are aged inside draw(), so a skipped frame would
            // freeze a burst mid-flight rather than letting it expire.
            (this.flamePixels && this.flamePixels.length > 0) ||
            // Same reasoning: a bolt is aged and expired inside its draw call,
            // so a skipped frame would leave one frozen on screen.
            (this.thunderbolts && this.thunderbolts.length > 0) ||
            // A Signal Glitch burst is a ~200ms wall-clock animation, so it
            // needs continuous frames for its whole life. Tested inline rather
            // than via glitchState() because that RETIRES an expired burst as a
            // side effect, and the gear decision must stay a pure read - the
            // draw call below is what should do the retiring.
            (!!this.glitch && (nowT - this.glitch.start) < this.glitch.dur) ||
            this.heat > 0 ||
            // Precise: the spring reports whether any corner is still off its
            // target or carrying velocity. This used to be a 1200ms window
            // after the last motion, which was a workaround for a timestamp
            // that was being restamped every frame and so never expired. Now
            // that the spring snaps exactly onto its targets when it settles,
            // it cannot flap back and forth, so the grace period is dead
            // weight - it just held the hot gear for an extra 1.2s after every
            // smear finished.
            !!this._smearMoving;
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
            const sec = this.secondaryCarets && this.secondaryCarets.length
              ? this.secondaryCarets.map((c) => (c.x | 0) + ":" + (c.y | 0)).join(",")
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
              eff.underlineWidthPx, sec, bt, eff.bracketTetherStrength,
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
          if (doDraw) this.draw();
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
      schedule();
    };
    this._canvasTick = tick;
    this._canvasGear = "hot";
    this.canvasRaf = requestAnimationFrame(tick);
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    const w = win.innerWidth;
    const h = win.innerHeight;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      let c = inTable ? null : (view.coordsAtPos(pos, side) || view.coordsAtPos(pos, -side));

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

        sc = this._caretStyleCache = {
          doc: view.state.doc, pos, assoc: assocKey, t: nowMs,
          textColor: _textColor, fontSize: _fontSize, fontFamily: _fontFamily,
          fontWeight: _fontWeight, fontStyle: _fontStyleCss,
          letterSpacing: _letterSpacing, lineHeightStr: _lineHeightStr,
          charWidth: _charWidth,
        };
      }

      const {
        textColor, fontSize, fontFamily, fontWeight, fontStyle: fontStyleCss,
        letterSpacing, lineHeightStr, charWidth,
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
  // array and state.selection.mainIndex points at the "primary" one that the
  // rest of the plugin (smoothing, smearing, letter-pop, trails) already
  // draws. This function returns raw pixel coords for every *other* range's
  // caret head so we can render each as a simple dashed vertical line -
  // enough to see where the additional carets are without duplicating the
  // full effect pipeline for them. Returns [] when there's only one range
  // or the view isn't focused.
  secondaryCaretCoords(view) {
    const out = [];
    if (!view || !view.hasFocus) return out;
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
        const c = view.coordsAtPos(head, s) || view.coordsAtPos(head, -s);
        if (!c) continue;
        if (paneRect) {
          const cBottom = c.bottom ?? c.top;
          if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) continue;
        }
        out.push({ x: c.left, top: c.top, bottom: c.bottom });
      }
    } catch {
      /* fall through - a bad frame shouldn't kill the tick loop */
    }
    return out;
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
    if (sel && sel.rangeCount > 0 && active.isContentEditable) {
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
    try {
      if (offset < text.length) {
        const r = doc.createRange();
        r.setStart(node, offset);
        r.setEnd(node, offset + 1);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        if (!isDegenerate(rect)) return { left: rect.left, top: rect.top, bottom: rect.bottom };
      }
      if (offset > 0) {
        const r = doc.createRange();
        r.setStart(node, offset - 1);
        r.setEnd(node, offset);
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        // Caret sits after this character, so anchor to its right edge.
        if (!isDegenerate(rect)) return { left: rect.right, top: rect.top, bottom: rect.bottom };
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
        mirror = doc.createElement("div");
        mirror.setAttribute("aria-hidden", "true");
        mirror.style.position = "absolute";
        mirror.style.visibility = "hidden";
        mirror.style.top = "0";
        mirror.style.left = "0";
        mirror.style.zIndex = "-1";
        mirror.style.pointerEvents = "none";
        doc.body.appendChild(mirror);
        this._formMirror = mirror;
      }

      const props = [
        "boxSizing", "width", "height",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
        "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight",
        "fontFamily", "letterSpacing", "textIndent", "textTransform", "wordSpacing", "tabSize",
      ];
      for (const p of props) mirror.style[p] = style[p];
      mirror.style.whiteSpace = isTextarea ? "pre-wrap" : "pre";
      mirror.style.wordWrap = isTextarea ? "break-word" : "normal";
      mirror.style.overflow = "hidden";
      if (!isTextarea) mirror.style.height = "auto";

      mirror.textContent = "";
      mirror.appendChild(doc.createTextNode(value.substring(0, selStart)));
      const marker = doc.createElement("span");
      marker.textContent = "\u200b"; // needs a real glyph to have a box
      mirror.appendChild(marker);

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
      // Follow the canvas's document rather than hardcoding the main
      // window's - the canvas migrates to whichever window hosts the
      // active view, so this keeps interface carets working in pop-outs.
      const doc = this.canvas?.ownerDocument ?? document;
      const active = doc.activeElement;
      // See isTextCaretHost: this excludes checkboxes, radios, sliders, etc.
      // so the plugin doesn't draw a cursor on top of Obsidian's own toggle
      // controls when they gain focus (e.g. clicking a setting toggle box).
      if (!isTextCaretHost(active)) return null;

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
  // drawRetroBox building this string WITHOUT weight/style while
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
      if (!this._measureCtx) {
        const canvas = (this.canvas?.ownerDocument ?? document).createElement("canvas");
        this._measureCtx = canvas.getContext("2d");
      }
      this._measureCtx.font = this.fontString(fontSize, fontFamily, fontWeight, fontStyle);
      const w = this._measureCtx.measureText(char).width;
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
          if (this.settings.popLetters) {
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

  updateActivePoint() {
    const caret = this.caretCoords();
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

    const targetChanged = !this.pending || this.pending.caret.x !== caret.x || this.pending.caret.top !== caret.top;
    if (targetChanged) {
      this.pending = { caret, since: performance.now(), holdChar: this.resolveHoldChar(caret) };
    } else if (performance.now() - this.pending.since >= delay) {
      this.commitMove(this.pending.caret);
    }
  }

  updateSmoothCursor() {
    if (!this.lastActive) {
      this.animActive = null;
      this._smoothMoving = false;
      this._smoothLastT = 0;
      this._catchUpBoost = 1;
      return;
    }

    if (!this.settings.smoothEnabled) {
      // Pinned straight to the target every frame: never "in motion" as far
      // as the frame governor is concerned.
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
      this._catchUpBoost = 1;
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
    const arrived =
      Math.abs(this.lastActive.x - this.animActive.x) < 0.25 &&
      Math.abs(this.lastActive.top - this.animActive.top) < 0.25;
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
  }

  commitMove(caret) {
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
      const disintegrate =
        this.settings.backspaceDisintegrate &&
        this._deletePending &&
        now - this._deletePending < 250;
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
      // Same 250ms window as the delete flag. Note the bolt is aimed at
      // `caret`, the position being moved TO, not at lastActive: the strike
      // drives the cursor down to the new line, so it has to land there.
      if (this._enterPending && now - this._enterPending < 250) {
        this.spawnThunderbolt(caret);
      }
    }
    // Cleared unconditionally, outside the lastActive branch: a stale flag left
    // by a move that didn't spawn anything would fire a bolt on whatever caret
    // move happened to come next.
    this._enterPending = 0;
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
    this.applySmearTaper(targets, center);
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

    // Rainbow suboption: step a running hue forward per letter (instead of
    // the normal single cursor color) so a fast typing burst reads as a
    // smooth sweep around the color wheel rather than a flat color or a
    // jittery random one.
    let color = this.getActiveColor() || anchor.textColor;
    if (this.styleFor("popRainbow")) {
      color = hslToRgbString(this._popRainbowHue, 0.85, 0.6);
      this._popRainbowHue = (this._popRainbowHue + 33) % 360;
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
  flamePixelColor(baseRGB, disintegrate) {
    let r, g, b;
    if (this.settings.flameTrailGradientColors && this.settings.gradientEnabled) {
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
    if (!this.settings.flameTrail) return;

    // Density scales the whole burst. At 0 the trail emits nothing - the way to
    // hide the pixels while keeping Thunderstrike and Disintegration usable.
    // Disintegration is exempt from a 0 density: pressing Backspace is an
    // explicit request for the burst, not the ambient trail, so it still fires
    // (at the normal amount) even with the trail turned down to nothing.
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
    // Colour inversion: photographic negative of the cursor colour. Gives
    // a distinct "wrong colour" flash that reads as destruction against
    // any theme, without needing a separate configurable colour.
    if (disintegrate) {
      r = 255 - r; g = 255 - g; b = 255 - b;
    }
    // The flat-path base for flamePixelColor; ignored when Gradient Colours
    // samples the ramp instead.
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
      const color = this.flamePixelColor(baseRGB, disintegrate);

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
    if (!this.settings.flameTrail || !this.settings.thunderstrike) return;
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
    // down to the impact. Sorted into bands so the draw call can set a fill
    // colour once per band rather than once per block.
    const ramp = thunderRamp();
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
    if (holdMs > 0 && now - this.lastMoveTime < holdMs) return 1;
    return blinkAlphaAt(now, Math.max(0, this.settings.blinkSpeed), this.settings.blinkOnOffBalance ?? 0.5, this.settings.blinkFade ?? 0.15);
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

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const win = this.canvas.ownerDocument.defaultView || window;
    const vw = win.innerWidth;
    const vh = win.innerHeight;

    if (!DIRTY_RECT_CLEAR || this._dirtyFull) {
      ctx.clearRect(0, 0, vw, vh);
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
    // Behind the cursor, like every other effect here: the bolt lands ON the
    // caret, and the caret should be the thing you see it hit.
    this.drawThunderbolts();

    // Cursor bounds are marked once here rather than threaded through every
    // branch of drawRetroBox/drawGenericCaret. The box spans the interpolated
    // caret, the entire smear quad (which overshoots well past the caret on a
    // fast move) and any held character, padded for glow (shadowBlur maxes at
    // 10), outline width and antialiasing.
    const a = this.animActive;
    if (a) {
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
      let pad = 24 + Math.max(0, this.settings.caretWidthPx || 0);
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
        pad += 14 * st * 2.2 + 3.2 * abr + (this.animActive?.w || 0) * 0.3 + 4;
      }
      this._markDirty(x0 - pad, y0 - pad, (x1 - x0) + pad * 2, (y1 - y0) + pad * 2);
    }

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
    if (breathing) {
      const cx = a.x + Math.max(a.w || 0, a.actualCharWidth || 0) / 2;
      const cy = a.top + (a.h || 0) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breath, breath);
      ctx.translate(-cx, -cy);
    }
    switch (this.styleFor("cursorStyle")) {
      case "Line":
        this.drawGenericCaret(false);
        break;
      case "Underline":
        this.drawGenericCaret(true);
        break;
      case "Box":
        this.drawRetroBox();
        break;
    }
    if (breathing) ctx.restore();

    // Secondary carets sit on top of the main cursor's trail/particles but
    // don't participate in smear/glow - just plain dashed vertical lines.
    this.drawSecondaryCarets();

    // Freeze this frame's union for the next frame to clear, clamped to the
    // surface so an off-screen particle can't inflate the cleared region.
    const d = this._dirty;
    if (!d) {
      this._dirtyPrev = null;
      return;
    }
    const cx0 = Math.max(0, Math.floor(d.x0) - 2);
    const cy0 = Math.max(0, Math.floor(d.y0) - 2);
    const cx1 = Math.min(vw, Math.ceil(d.x1) + 2);
    const cy1 = Math.min(vh, Math.ceil(d.y1) + 2);
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
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (r.w >= 3) {
      const coreW = Math.max(1, r.w * 0.34);
      // Uses the hue trailPaint already armed as the shadow, so the white core
      // casts a coloured glow - a hot filament inside a coloured tube.
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, alpha * 1.6)})`;
      ctx.fillRect(r.x + (r.w - coreW) / 2, r.y, coreW, r.h);
    }
  }

  fillCursorShape(ctx, rx, ry, rw, rh) {
    const q = this.smearCorners();
    const corners = q || {
      tl: { x: rx, y: ry },
      tr: { x: rx + rw, y: ry },
      br: { x: rx + rw, y: ry + rh },
      bl: { x: rx, y: ry + rh },
    };

    ctx.beginPath();
    ctx.moveTo(corners.tl.x, corners.tl.y);
    ctx.lineTo(corners.tr.x, corners.tr.y);
    ctx.lineTo(corners.br.x, corners.br.y);
    ctx.lineTo(corners.bl.x, corners.bl.y);
    ctx.closePath();
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
        const docRef = this.canvas?.ownerDocument ?? document;
        ac = this._auroraCanvas = docRef.createElement("canvas");
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

  drawGenericCaret(isUnderline = false) {
    const ctx = this.ctx;
    const settings = this.settings;
    const active = this.animActive;
    const now = performance.now();
    const trailColor = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));

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
          this.drawNeonGhost(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, alpha * opacity, age, trailColor);
        } else {
          this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, alpha * opacity, age, trailColor);
        }
      } else if (isUnderline) {
        const uThickness = this.underlineThickness(p.h);
        const ty = p.y + p.h - uThickness;
        // Build the paint from the bar's own rect, not the full line box:
        // a ramp spanning the whole line height would show only the sliver
        // of itself that happens to fall across the bar.
        ctx.fillStyle = this.trailPaint(ctx, { x: p.x, y: ty, w: p.w, h: uThickness }, alpha * opacity, age, trailColor);
        ctx.fillRect(p.x, ty, p.w, uThickness);
      } else {
        ctx.fillStyle = this.trailPaint(ctx, p, alpha * opacity, age, trailColor);
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    });
    ctx.restore();

    if (!active) return;
    const blinkAlpha = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";

    ctx.save();
    if (settings.crtEffect && settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * blinkAlpha;
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
    if (gsGen) {
      this.paintGlitchRect(ctx, rx, ry, rw, rh, color, 0.9 * blinkAlpha * opacity, gsGen);
    } else {
      ctx.fillStyle = settings.energyEffect
        ? this.energyPaint(rx, ry, rw, rh, color, 0.9 * blinkAlpha * opacity)
        : this.cursorPaint(rx, ry, rw, rh, color, 0.9 * blinkAlpha * opacity);
      this.fillCursorShape(ctx, rx, ry, rw, rh);
    }

    // Line + serifs = classic I-beam. Only for the Line style (underline
    // wouldn't make visual sense with serifs). Serifs are axis-aligned
    // even when the stem smears - a smeared serif reads as a broken glyph
    // rather than a cursor cap. Serif span follows the actual char width
    // under the caret so it matches the text; falls back to a multiple of
    // the stem on empty lines.
    if (!isUnderline && settings.lineSerifs && !gsGen) {
      const stem = rw;
      const serifThickness = Math.max(1, Math.round(stem * 0.9));
      const charW = active.actualCharWidth;
      const rawSpan = charW && charW > 0 ? charW : stem * 7;
      const serifSpan = Math.max(stem * 3, Math.min(rawSpan, stem * 10));
      const serifX = active.x + stem / 2 - serifSpan / 2;
      ctx.fillRect(serifX, active.top, serifSpan, serifThickness);
      ctx.fillRect(serifX, active.top + active.h - serifThickness, serifSpan, serifThickness);
    }
    ctx.restore();
  }

  // Simple solid 2px vertical line per non-primary caret, drawn in the
  // active cursor colour. Deliberately minimal: no smear (independent
  // spring per caret would be visually noisy and expensive with many
  // cursors), no letter-inside-box, no trail. Blinks in sync with the
  // main cursor so all carets fade together.
  drawSecondaryCarets() {
    const carets = this.secondaryCarets;
    if (!carets || carets.length === 0) return;
    const ctx = this.ctx;
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, this.settings.cursorOpacity ?? 1));
    const alpha = this.blinkAlpha(performance.now()) * opacity;
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.9 * alpha);
    ctx.lineWidth = 2;
    ctx.lineCap = "butt";
    for (const c of carets) {
      // 0.5-pixel offset so a 2px stroke lands on whole pixels rather than
      // straddling a boundary and antialiasing to a blurry 3px stripe.
      const x = Math.round(c.x) + 0.5;
      this._markDirty(x - 3, c.top - 2, 6, (c.bottom - c.top) + 4);
      ctx.beginPath();
      ctx.moveTo(x, c.top);
      ctx.lineTo(x, c.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLettersParticles() {
    const ctx = this.ctx;
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
        const anchor = this.animActive;
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
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === open) depth++;
        else if (c === close) { if (--depth === 0) return at + i; }
      }
    } else {
      const start = Math.max(0, at - BRACKET_SCAN_LIMIT + 1);
      const text = doc.sliceString(start, at + 1);
      let depth = 0;
      for (let i = text.length - 1; i >= 0; i--) {
        const c = text[i];
        if (c === close) depth++;
        else if (c === open) { if (--depth === 0) return start + i; }
      }
    }
    return -1;
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
      if (BRACKET_CLOSE[c]) { depth[c]++; continue; }
      const closer = BRACKET_OPEN[c];
      if (!closer) continue;
      if (depth[closer] > 0) { depth[closer]--; continue; }
      const from = start + i;
      const to = this.matchingBracketPos(doc, from, c);
      return to >= 0 ? { from, to } : null;
    }
    return null;
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
      const m = this.matchingBracketPos(doc, at, ch);
      if (m >= 0) return { from: Math.min(at, m), to: Math.max(at, m) };
    }

    const q = this.quoteSpanAt(doc, pos);
    const b = this.enclosingBracketSpan(doc, pos);
    if (q && b) return q.from > b.from ? q : b;
    return q || b || null;
  }

  // The tether for this frame, as an array of horizontal rules ordered top to
  // bottom - one per line the pair covers - in viewport pixels (the canvas is
  // fixed at 0,0, so viewport coords ARE canvas coords, the same assumption
  // cmCaretCoords and secondaryCaretCoords make). Returns null when there's
  // nothing to draw.
  bracketTetherCoords(view) {
    if (!view || !view.hasFocus) return null;
    try {
      const state = view.state;
      const main = state.selection.main;
      // Only for a collapsed caret: over a selection the line would fight the
      // selection highlight and there's no single "the caret is here" point.
      if (!main.empty) return null;

      const doc = state.doc;
      const pos = main.head;
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

  drawRetroBox() {
    const ctx = this.ctx;
    const settings = this.settings;
    const now = performance.now();
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const hollow = this.styleFor("boxHollow");
    const strokeW = hollow ? Math.max(1, Math.min(6, settings.boxHollowWidth || 2)) : 0;

    ctx.save();
    this.forEachTrailPoint((p, alpha, age) => {
      if (settings.crtNeon) {
        // Neon draws the box's own footprint as a glowing tube - the same
        // width and height as the live box cursor, filled even when the box is
        // hollow (a hollow outline of a glowing tail just reads as noise).
        this.drawNeonGhost(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, alpha * opacity, age, color);
      } else if (hollow) {
        ctx.strokeStyle = this.trailPaint(ctx, p, alpha * opacity, age, color);
        ctx.lineWidth = strokeW;
        // Inset by half the stroke so the outline lands inside the same
        // footprint the filled trail dot would occupy (canvas strokes
        // straddle the path centerline).
        const inset = strokeW / 2;
        ctx.strokeRect(p.x + inset, p.y + inset, Math.max(0, p.w - strokeW), Math.max(0, p.h - strokeW));
      } else {
        ctx.fillStyle = this.trailPaint(ctx, p, alpha * opacity, age, color);
        ctx.fillRect(p.x, p.y, p.w, p.h);
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
        ctx.shadowBlur = 10 * blinkAlpha;
      }

      // Signal Glitch takes over the body of the cursor entirely while a burst
      // is live - it replaces the fill/stroke rather than layering on top,
      // because the whole point is that the cursor's own form comes apart. The
      // glow armed above still applies, so the break-up keeps its halo.
      // Resolved before paintStyle so a burst skips the (possibly expensive,
      // e.g. Aurora's per-pixel raster) beam paint it's about to discard.
      const gsBox = settings.crtEffect && settings.crtGlitch
        ? this.glitchState(now) : null;

      const paintStyle = gsBox ? null : (settings.energyEffect
        ? this.energyPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * opacity)
        : this.cursorPaint(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * opacity));

      if (gsBox) {
        this.paintGlitchRect(
          ctx, active.x, active.top, renderW, active.h,
          color, 0.9 * blinkAlpha * opacity, gsBox,
        );
      } else if (hollow) {
        // Stroke the smear quad so the outline deforms with movement the
        // same way a filled box would. Reuses fillCursorShape's corner
        // logic inline (we need stroke here, not fill).
        const q = this.smearCorners();
        const corners = q || {
          tl: { x: active.x, y: active.top },
          tr: { x: active.x + renderW, y: active.top },
          br: { x: active.x + renderW, y: active.top + active.h },
          bl: { x: active.x, y: active.top + active.h },
        };
        ctx.strokeStyle = paintStyle;
        ctx.lineWidth = strokeW;
        ctx.lineJoin = "miter";
        ctx.beginPath();
        ctx.moveTo(corners.tl.x, corners.tl.y);
        ctx.lineTo(corners.tr.x, corners.tr.y);
        ctx.lineTo(corners.br.x, corners.br.y);
        ctx.lineTo(corners.bl.x, corners.bl.y);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.fillStyle = paintStyle;
        this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
      }
      ctx.restore();

      // Character-inside-box only makes sense when the box is filled
      // (invert-color glyph on a solid background). On a hollow outline
      // the real character is already visible through the middle, so
      // drawing an inverted glyph on top would duplicate it. It is also
      // suppressed mid-glitch: the box it is supposed to sit inside has been
      // torn into displaced slices, so a crisp centred glyph floating over the
      // wreckage reads as a rendering bug rather than part of the effect.
      const displayChar = this.pending ? this.pending.holdChar : (active.holdChar || active.char);
      if (!hollow && !gsBox && settings.showChar && displayChar) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.3 + blinkAlpha * 0.7);
        ctx.fillStyle = invertColor(active.textColor);
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
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(displayChar, active.x + glyphAdvance / 2, baselineY);
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
        this.torchRaf = requestAnimationFrame(tick);
        return;
      }
      // Parked or hidden: a 150ms heartbeat is plenty to notice the effect
      // being re-enabled, a mode switch, or the pane moving. Blink Sync asks
      // for a middle cadence instead - fast enough to render the blink's fades
      // smoothly, slow enough not to be the hot gear.
      const delay = this._torchGear === "pulse" ? TORCH_PULSE_FRAME_MS : 150;
      this._torchIdleT = window.setTimeout(() => {
        this._torchIdleT = 0;
        if (this.torchEngineActive) this.torchRaf = requestAnimationFrame(tick);
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
            if (this.overlay) this.overlay.classList.add("torch-cursor-hidden");
          } else if (!this.settings.torchEffect) {
            // This mode (or the global cursor) doesn't want the spotlight — just
            // hide it. Don't disable the engine: another mode may want it, and
            // switching back should be instant.
            if (this.overlay) this.overlay.classList.add("torch-cursor-hidden");
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
              this.overlay.classList.remove("torch-cursor-hidden");
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
                this.overlay.style.setProperty("--torch-radius", next + "px");
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

              this.updateOverlayTarget();
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
              // long note in injectStyles about the candle flicker that used to
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
                // Not the hot gear: see TORCH_PULSE_FRAME_MS. Only claimed if
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
              if (rKey !== this._lastTorchRadius) {
                this._lastTorchRadius = rKey;
                this.overlay.style.setProperty("--torch-radius", rKey + "px");
              }

              // Dedupe the spotlight position write: setting a CSS custom
              // property forces a style recalc even when the value hasn't
              // changed, and this used to run every frame forever with a
              // parked spotlight.
              const posKey = (this.x - left).toFixed(1) + "," + (this.y - top).toFixed(1);
              if (posKey !== this._lastTorchPos) {
                this._lastTorchPos = posKey;
                this.overlay.style.setProperty("--torch-x", (this.x - left).toFixed(1) + "px");
                this.overlay.style.setProperty("--torch-y", (this.y - top).toFixed(1) + "px");
              }

              this.overlay.classList.toggle("torch-cursor-hidden", !!hideForModal);
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
    this.torchRaf = requestAnimationFrame(tick);
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
    const now = Date.now();
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
    const statusBar = doc.querySelector(".status-bar");
    if (statusBar && this._isVisiblyRendered(statusBar)) {
      const sb = statusBar.getBoundingClientRect();
      const win = doc.defaultView || window;
      // Only when it's actually parked at the window's bottom edge, so a
      // mispositioned or stale-rect bar can't pull the clip up over content.
      if (sb.height > 0 && sb.bottom >= win.innerHeight - 1) {
        bottomInset = Math.max(0, win.innerHeight - sb.top);
      }
    }

    this._chromeCache = { doc, t: now, top, bottomInset };
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
    const rootEl = view.dom.closest(".cm-editor") || view.dom.closest(".workspace-leaf");
    if (!rootEl) return null;
    const rect = rootEl.getBoundingClientRect();

    // Clipping to the pane's own rect assumes the titlebar/status bar take
    // up real space in flow, pushing the pane to stop short of them. Some
    // themes float those bars over the pane instead (fixed/absolute), so
    // the pane's rect extends underneath - and our z-index 10000 canvas
    // would paint over them, with the same drag-breaking consequence as
    // the full-viewport case for the titlebar. Clamp against the cached
    // chrome insets (cheap - no extra layout reads per frame).
    const doc = rootEl.ownerDocument;
    const win = doc.defaultView || window;
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

  updateOverlayTarget() {
    const mode = this.settings.overlayFollowMode;
    const caret = this.caretCoords();
    if (caret) {
      if (!this.lastCaret || caret.x !== this.lastCaret.x || caret.top !== this.lastCaret.top) {
        this.lastCaretMove = Date.now();
      }
      this.lastCaret = caret;
    }

    const useMouse =
      mode === "mouse" ||
      (mode === "auto" && (Date.now() - this.lastMouseMove < 800 || !this.lastCaret));

    if (useMouse) {
      this.tx = this.mouseX;
      this.ty = this.mouseY;
    } else if (this.lastCaret) {
      this.tx = this.lastCaret.x;
      this.ty = (this.lastCaret.top + this.lastCaret.bottom) / 2;
    }
  }
}

class CursorSmithSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "⚡ Cursor-Smith Settings" });

    // --- Enable Plugin: always on top ---
    new Setting(containerEl)
      .setName("Enable Plugin")
      .setDesc("Turns the custom cursor off entirely and hands you back Obsidian's own caret. Everything below is remembered while it is off.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            this.plugin.settings.enabled = value;
            value ? this.plugin.enable() : this.plugin.disable();
            await this.plugin.saveSettings();
          })
      );

    // --- CUA/Normal vs Vim mode switch ---
    this.renderModeSwitch(containerEl);

    if ((this.plugin.settings.uiMode || "cua") === "vim") {
      this.renderVimSection(containerEl);
    } else {
      this.renderNormalSection(containerEl);
    }
  }

  // -------------------------------------------------------------------------
  // Segmented CUA/Normal ↔ Vim switch. Selecting "Vim" turns Vim-aware
  // cursors on (and, per vimControlObsidian, flips Obsidian's own Vim
  // keybindings); selecting "CUA/Normal" turns them off. This one control is
  // both the panel switch and the feature's on/off switch.
  // -------------------------------------------------------------------------
  renderModeSwitch(containerEl) {
    const plugin = this.plugin;
    const current = plugin.settings.uiMode || "cua";

    const wrap = containerEl.createDiv();
    wrap.style.cssText = [
      "display:flex", "border:1px solid var(--background-modifier-border)",
      "border-radius:6px", "overflow:hidden", "margin:0.4em 0 1.4em", "max-width:340px",
    ].join(";");

    const makeBtn = (label, key) => {
      const btn = wrap.createEl("button", { text: label });
      const active = current === key;
      btn.style.cssText = [
        "flex:1", "padding:7px 10px", "border:none", "cursor:pointer",
        "font-size:var(--font-ui-small)", "font-weight:" + (active ? "600" : "400"),
        "background:" + (active ? "var(--interactive-accent)" : "var(--background-secondary)"),
        "color:" + (active ? "var(--text-on-accent)" : "var(--text-normal)"),
        "transition:background 0.1s ease",
      ].join(";");
      btn.addEventListener("click", async () => {
        if ((plugin.settings.uiMode || "cua") === key) return;
        // Deliberately NOT setting uiMode here: setVimModeEnabled writes it
        // (keeping both flags in one place), and it needs the pre-click state
        // intact to decide whether the "restore Obsidian's vim" path applies.
        // Writing uiMode first blinded that check whenever the two flags had
        // drifted apart, silently skipping the restore.
        await plugin.setVimModeEnabled(key === "vim");
        this.display();
      });
      return btn;
    };

    makeBtn("CUA / Normal", "cua");
    makeBtn("Vim", "vim");
  }

  // -------------------------------------------------------------------------
  // Collapsible section helper. Wraps a named group of settings in a native
  // <details>/<summary> so the panel's 60+ settings can be collapsed down to
  // whichever groups someone actually uses - Effects alone now covers 8
  // separate features. Sections default open: collapsibility is the point,
  // not being hidden by default.
  // -------------------------------------------------------------------------
  renderSection(containerEl, title, renderFn, { open = true } = {}) {
    const details = containerEl.createEl("details", { cls: "cursor-smith-section" });
    details.open = open;
    const summary = details.createEl("summary");
    summary.createEl("span", { cls: "cursor-smith-section-title", text: title });
    renderFn(details);
    return details;
  }

  // Container for a run of sub-options belonging to whatever setting sits
  // directly above it (a toggle, or the Cursor Style dropdown).
  //
  // This is a wrapper element rather than a class stamped on each individual
  // Setting, which is what it used to be. Two reasons:
  //
  //   1. One element means one guide line for the whole group, with a proper
  //      start and end, instead of a stack of per-row line segments that only
  //      *looked* continuous as long as no row had a margin.
  //   2. It nests. The old scheme hardcoded a class per depth
  //      (cursor-smith-indent-1 / -2) with hardcoded margins, so a third level
  //      needed a third class; here, passing one group as another's parent
  //      indents it by construction.
  //
  // Matches the sub-option styling in Word-Smith (.ws-settings-sub), so the
  // two plugins' settings panels read the same way.
  subGroup(containerEl) {
    return containerEl.createDiv({ cls: "cursor-smith-sub" });
  }

  // Small all-caps label used to split a section into sub-groups (e.g. Torch
  // Spotlight's "Spotlight" vs "Environment" controls) without opening a
  // whole new collapsible section for them.
  renderSubheading(containerEl, title) {
    containerEl.createEl("div", { cls: "cursor-smith-subsection-title", text: title });
  }

  // -------------------------------------------------------------------------
  // Shared look/effect settings renderer.
  //
  // renderNormalSection (the global cursor) and renderModeControls (one Vim
  // mode's own snapshot) render an identical set of settings - Appearance,
  // Blinking, Smooth Movement, Effects - that used to be duplicated by hand
  // across both, ~150 lines each. The only real differences between the two
  // are *where the values live* and *what happens after a save*, so those are
  // the only things a caller supplies:
  //
  //   get(key)                    - read the current value for `key`
  //   set(key)                    - returns an onChange handler: save only
  //   setAndRedraw(key)           - returns an onChange handler: save +
  //                                 re-render the settings panel (for changes
  //                                 that reveal or hide other settings)
  //   renderCursorStyleSetting(body) - builds the "Cursor Style" dropdown
  //                                 Setting. Kept as a caller-supplied hook
  //                                 (rather than generic set/setAndRedraw)
  //                                 because the global panel needs an extra
  //                                 plugin.enable() call after saving that a
  //                                 Vim mode does not.
  //   renderTorchToggleSetting(body) - builds the "Torch Spotlight" toggle
  //                                 Setting. Also a caller-supplied hook: the
  //                                 global panel must start/stop the torch
  //                                 engine immediately on toggle, which has no
  //                                 Vim-mode equivalent (see the comment at
  //                                 that call site).
  // -------------------------------------------------------------------------
  renderLookSettings(containerEl, { get, set, setAndRedraw, renderCursorStyleSetting, renderTorchToggleSetting }) {
    this.renderSection(containerEl, "Appearance", (body) => {
      renderCursorStyleSetting(body);

      // Everything that applies to exactly one cursor style lives here, in a
      // sub-group hanging directly off the dropdown that selects it, so the
      // section reads as "Cursor Style, then the options for the style you
      // picked". Box's options (Show Letter Inside Cursor, Hollow) used to sit
      // below the colour pickers instead, which put three unrelated settings
      // between a style and its own sub-options.
      const style = get("cursorStyle");

      if (style === "Line") {
        const g = this.subGroup(body);
        new Setting(g)
          .setName("Cursor Thickness")
          .setDesc("How thick the Line cursor is, in pixels.")
          .addSlider((slider) => slider.setLimits(1, 12, 1).setValue(get("caretWidthPx")).setDynamicTooltip().onChange(set("caretWidthPx")));

        new Setting(g)
          .setName("Serifs")
          .setDesc("Adds classic I-beam serifs (small horizontal caps) at the top and bottom of the line cursor.")
          .addToggle((toggle) => toggle.setValue(get("lineSerifs")).onChange(set("lineSerifs")));
      }

      if (style === "Underline") {
        const g = this.subGroup(body);
        new Setting(g)
          .setName("Underline Thickness")
          .setDesc("How thick the underline bar is, in pixels. 0 = automatic, which scales the bar with the line height so it stays in proportion at any font size.")
          .addSlider((slider) => slider.setLimits(0, 12, 1).setValue(get("underlineWidthPx") ?? 0).setDynamicTooltip().onChange(set("underlineWidthPx")));
      }

      if (style === "Box") {
        const g = this.subGroup(body);
        new Setting(g)
          .setName("Show Letter Inside Cursor")
          .setDesc(get("boxHollow")
            ? "Shows the letter under the cursor inside the block, with the colors flipped. Does nothing while Hollow is on — the real character already shows through the outline."
            : "Shows the letter under the cursor inside the block, with the colors flipped.")
          .addToggle((toggle) => toggle.setValue(get("showChar")).onChange(set("showChar")));

        new Setting(g)
          .setName("Hollow")
          .setDesc("Draws only the outline of the box instead of a filled block. Lets the underlying character show through naturally.")
          .addToggle((toggle) => toggle.setValue(get("boxHollow")).onChange(setAndRedraw("boxHollow")));

        if (get("boxHollow")) {
          // Nested one level deeper: Outline Width is conditional on Hollow,
          // which is itself a sub-option of the style.
          const g2 = this.subGroup(g);
          new Setting(g2)
            .setName("Outline Width")
            .setDesc("Thickness of the hollow box's outline, in pixels.")
            .addSlider((slider) => slider.setLimits(1, 6, 1).setValue(get("boxHollowWidth")).setDynamicTooltip().onChange(set("boxHollowWidth")));
        }
      }

      new Setting(body).setName("Gradient")
        .setDesc("Paints the cursor with a blend of several colors instead of one flat color. Replaces the per-theme cursor colors, so the same gradient is used in light and dark themes.")
        .addToggle((toggle) => toggle.setValue(!!get("gradientEnabled")).onChange(setAndRedraw("gradientEnabled")));

      if (get("gradientEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Number of Colors")
          .setDesc("How many colors the blend runs through, from 2 to 4.")
          .addDropdown((d) => d.addOptions({ 2: "2", 3: "3", 4: "4" })
            .setValue(String(get("gradientCount") ?? 2))
            // Dropdown values are strings; store a number so the engine's
            // clamping arithmetic doesn't have to care where the value came
            // from. Redraws the panel to add or remove color pickers.
            .onChange((v) => setAndRedraw("gradientCount")(Number(v))));

        // Each theme gets its own row of pickers, mirroring the flat
        // Dark/Light colour pair this replaces. All of a row's pickers hang
        // off ONE Setting, so they land side by side in that row's control
        // area (Obsidian lays it out as a flex row) rather than stacking into
        // one labelled row each.
        const count = Math.max(2, Math.min(4, Number(get("gradientCount")) || 2));
        const colorRow = (label, prefix, desc) => {
          const row = new Setting(g).setName(label).setDesc(desc);
          row.settingEl.addClass("cursor-smith-color-row");
          for (let i = 1; i <= count; i++) {
            const key = prefix + i;
            row.addColorPicker((cp) =>
              cp.setValue(get(key) || DEFAULT_SETTINGS[key]).onChange(set(key)));
          }
        };
        colorRow("Colors (Dark Theme)", "gradientDark",
          "In order from the top of the cursor to the bottom — or left to right for the Underline style.");
        colorRow("Colors (Light Theme)", "gradientLight",
          "The same ramp for light themes, where neon colors tend to wash out.");
      } else {
        new Setting(body).setName("Cursor Color (Dark Theme)")
          .setDesc("The cursor color used while a dark theme is active.")
          .addColorPicker((cp) => cp.setValue(get("colorDark")).onChange(set("colorDark")));
        new Setting(body).setName("Cursor Color (Light Theme)")
          .setDesc("The cursor color used while a light theme is active. Kept separate because neon colors that look right on a dark background wash out on a white page.")
          .addColorPicker((cp) => cp.setValue(get("colorLight")).onChange(set("colorLight")));
      }

      new Setting(body).setName("Cursor Opacity").setDesc("How see-through the cursor is.")
        .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("cursorOpacity")).setDynamicTooltip().onChange(set("cursorOpacity")));
    });

    this.renderSection(containerEl, "Blinking", (body) => {
      new Setting(body)
        .setName("Blinking")
        .setDesc("Makes the cursor blink. Turn off to keep it always fully lit.")
        .addToggle((toggle) => toggle.setValue(get("blinkingEnabled")).onChange(setAndRedraw("blinkingEnabled")));

      if (get("blinkingEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Blink Speed").setDesc("How fast the cursor blinks.")
          .addSlider((s) => s.setLimits(0.1, 3, 0.1).setValue(get("blinkSpeed")).setDynamicTooltip().onChange(set("blinkSpeed")));
        new Setting(g).setName("Blink Balance").setDesc("How the blink cycle is split between lit and dark.")
          .addSlider((s) => s.setLimits(0.1, 0.9, 0.05).setValue(get("blinkOnOffBalance")).setDynamicTooltip().onChange(set("blinkOnOffBalance")));
        new Setting(g).setName("Fade Smoothness").setDesc("How gradually the cursor fades in and out. Low is a snappy on/off; higher stretches the fade so it eases gently, up to one continuous breathing-like fade at the top of the range. 0.15 is the original feel.")
          .addSlider((s) => s.setLimits(0.05, 0.5, 0.05).setValue(get("blinkFade") ?? 0.15).setDynamicTooltip().onChange(set("blinkFade")));
        new Setting(g).setName("Don't Blink While Typing").setDesc("Keeps the cursor fully lit while you type or move it.")
          .addToggle((toggle) => toggle.setValue(get("smoothStopBlinking")).onChange(set("smoothStopBlinking")));
        new Setting(g).setName("Blink Delay").setDesc("How long (in ms) the cursor stays fully lit after any move or keystroke before blinking resumes. Works independently of Smooth Movement.")
          .addSlider((s) => s.setLimits(0, 2000, 50).setValue(get("blinkDelayMs") ?? 0).setDynamicTooltip().onChange(set("blinkDelayMs")));
        new Setting(g).setName("Breathing").setDesc("The cursor shrinks and swells on the blink cycle instead of fading out, so it never disappears.")
          .addToggle((toggle) => toggle.setValue(!!get("blinkBreathing")).onChange(setAndRedraw("blinkBreathing")));
        if (get("blinkBreathing")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Breath Depth").setDesc("How far the cursor shrinks at the bottom of the breath.")
            .addSlider((s) => s.setLimits(0.05, 0.5, 0.05).setValue(get("blinkBreathDepth") ?? 0.2).setDynamicTooltip().onChange(set("blinkBreathDepth")));
        }
      }
    });

    this.renderSection(containerEl, "Smooth Movement", (body) => {
      new Setting(body)
        .setName("Smooth Movement")
        .setDesc("Makes the cursor glide to its new spot instead of jumping there instantly.")
        .addToggle((toggle) => toggle.setValue(get("smoothEnabled")).onChange(setAndRedraw("smoothEnabled")));

      if (get("smoothEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Glide Amount")
          .setDesc("How much the cursor eases as it travels. Higher stretches the glide out; lower snaps it into place.")
          .addSlider((s) => s.setLimits(0.05, 0.30, 0.05).setValue(get("smoothness")).setDynamicTooltip().onChange(set("smoothness")));
        new Setting(g).setName("Catch-Up Speed")
          .setDesc("How quickly the cursor chases the real caret. Higher arrives sooner.")
          .addSlider((s) => s.setLimits(0.30, 0.80, 0.05).setValue(get("catchUpSpeed")).setDynamicTooltip().onChange(set("catchUpSpeed")));
        // Max Catch-Up Speed is meaningless on its own - it is only ever read
        // inside the adaptive branch - so it hangs off that toggle rather than
        // sitting beside it as a live-looking slider that does nothing.
        new Setting(g).setName("Speed Up When Typing Fast")
          .setDesc("Lets the cursor run above Catch-Up Speed during sustained typing or key repeat so it doesn't fall behind, then eases back down once you stop.")
          .addToggle((toggle) => toggle.setValue(get("smoothAdaptive")).onChange(setAndRedraw("smoothAdaptive")));
        if (get("smoothAdaptive")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Max Catch-Up Speed")
            .setDesc("The fastest the speed-up is allowed to get. Also carries through to Motion Smear, so the cursor keeps up whether or not it is smearing.")
            .addSlider((s) => s.setLimits(0.50, 1.0, 0.05).setValue(get("maxCatchUpSpeed")).setDynamicTooltip().onChange(set("maxCatchUpSpeed")));
        }
        new Setting(g).setName("Movement Delay")
          .setDesc("How long (in ms) the cursor waits before setting off after the caret. 0 follows immediately.")
          .addSlider((s) => s.setLimits(0, 500, 10).setValue(get("moveDelayMs")).setDynamicTooltip().onChange(set("moveDelayMs")));
      }
    });

    this.renderSection(containerEl, "Effects", (body) => {
      new Setting(body).setName("Popping Letters")
        .setDesc("Each character you type springs out of the cursor and tumbles away as it fades.")
        .addToggle((toggle) => toggle.setValue(get("popLetters")).onChange(setAndRedraw("popLetters")));
      if (get("popLetters")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Rainbow")
          .setDesc("Colors each popping letter a different color, sweeping around the rainbow as you type.")
          .addToggle((toggle) => toggle.setValue(get("popRainbow")).onChange(set("popRainbow")));
      }

      new Setting(body).setName("Pixel Trail")
        .setDesc("Scatters a small puff of colored pixels wherever the cursor has just been.")
        .addToggle((toggle) => toggle.setValue(get("flameTrail")).onChange(setAndRedraw("flameTrail")));
      if (get("flameTrail")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Density")
          .setDesc("How many pixels the trail sheds as you move. Slide to 0 to hide the pixels entirely while keeping Disintegration and Thunderstrike.")
          .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("flameTrailDensity") ?? 1).setDynamicTooltip().onChange(set("flameTrailDensity")));
        new Setting(g).setName("Trail On Jump")
          .setDesc("When the cursor jumps (a click or a big move) lay pixels along the whole path, so a leap leaves a streak instead of a single puff at the start.")
          .addToggle((toggle) => toggle.setValue(!!get("flameTrailOnJump")).onChange(set("flameTrailOnJump")));
        new Setting(g).setName("Pixel Lifetime")
          .setDesc("How long each pixel lasts before it fades out, in milliseconds.")
          .addSlider((s) => s.setLimits(100, 2000, 50).setValue(get("flameTrailLifeMs") ?? 400).setDynamicTooltip().onChange(set("flameTrailLifeMs")));
        new Setting(g).setName("Pixel Size")
          .setDesc("How big each pixel is. Each still varies a little around this.")
          .addSlider((s) => s.setLimits(1, 12, 0.5).setValue(get("flameTrailPixelSize") ?? 4).setDynamicTooltip().onChange(set("flameTrailPixelSize")));
        // Only meaningful with a gradient to sample - offered only when Gradient
        // is on, so it isn't a switch that visibly does nothing.
        if (get("gradientEnabled")) {
          new Setting(g).setName("Gradient Colors")
            .setDesc("Colors each pixel from a random point along the cursor's gradient, with slight variation, instead of the one cursor color. Applies to the jump trail and backspace burst too.")
            .addToggle((toggle) => toggle.setValue(!!get("flameTrailGradientColors")).onChange(set("flameTrailGradientColors")));
        }
        new Setting(g).setName("Gravity")
          .setDesc("A steady pull on the pixels. 0 leaves them drifting sideways as before; higher drags them off in the direction below.")
          .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(get("flameTrailGravity") ?? 0).setDynamicTooltip().onChange(setAndRedraw("flameTrailGravity")));
        if ((get("flameTrailGravity") ?? 0) > 0) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Gravity Direction")
            .setDesc("Which way the pull goes, in degrees. 0 is down, 90 right, 180 up, 270 left.")
            .addSlider((s) => s.setLimits(0, 359, 5).setValue(get("flameTrailGravityAngle") ?? 0).setDynamicTooltip().onChange(set("flameTrailGravityAngle")));
        }
        new Setting(g).setName("Backspace Disintegration")
          .setDesc("Deleting throws a heavier burst outward in inverted colors, so text comes apart rather than just vanishing.")
          .addToggle((toggle) => toggle.setValue(get("backspaceDisintegrate")).onChange(set("backspaceDisintegrate")));
        new Setting(g).setName("Thunderstrike")
          .setDesc("Pressing Enter calls down a bolt of pixelated lightning onto the cursor's new line, from a random angle above.")
          .addToggle((toggle) => toggle.setValue(!!get("thunderstrike")).onChange(setAndRedraw("thunderstrike")));
        if (get("thunderstrike")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Bolt Size")
            .setDesc("How fine the lightning is, in pixels per block. Lower is a thinner, more delicate strike.")
            .addSlider((s) => s.setLimits(1, 5, 1).setValue(get("thunderstrikeSize") ?? 2).setDynamicTooltip().onChange(set("thunderstrikeSize")));
          new Setting(g2).setName("Strength")
            .setDesc("How brightly the strike shows. Each bolt takes its colours at random from blue, purple, red, yellow and white.")
            .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("thunderstrikeStrength") ?? 0.5).setDynamicTooltip().onChange(set("thunderstrikeStrength")));
        }
      }

      new Setting(body).setName("Stardust")
        .setDesc("The cursor gives off a slow stream of floating pixels that drift upward and fade. Waits until you stop typing unless Always On is set.")
        .addToggle((toggle) => toggle.setValue(!!get("stardustEnabled")).onChange(setAndRedraw("stardustEnabled")));
      if (get("stardustEnabled")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Always On")
          .setDesc("Streams continuously instead of waiting for the cursor to sit still — including while you type.")
          .addToggle((toggle) => toggle.setValue(!!get("stardustAlwaysOn")).onChange(setAndRedraw("stardustAlwaysOn")));
        // The delay is what Always On overrides, so hide it rather than leave
        // a live-looking slider that no longer does anything.
        if (!get("stardustAlwaysOn")) {
          new Setting(g).setName("Idle Delay")
            .setDesc("How long (in ms) the cursor must sit still before the stardust starts.")
            .addSlider((s) => s.setLimits(500, 8000, 250).setValue(get("stardustDelayMs") ?? 2000).setDynamicTooltip().onChange(set("stardustDelayMs")));
        }
        new Setting(g).setName("Density")
          .setDesc("How thickly the stardust streams off the cursor.")
          .addSlider((s) => s.setLimits(0.2, 3, 0.1).setValue(get("stardustRate") ?? 1).setDynamicTooltip().onChange(set("stardustRate")));

        new Setting(g).setName("Orbit")
          .setDesc("Motes circle the cursor like fireflies instead of drifting upward, and follow it as it moves.")
          .addToggle((toggle) => toggle.setValue(!!get("stardustOrbit")).onChange(setAndRedraw("stardustOrbit")));
        if (get("stardustOrbit")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Orbit Radius")
            .setDesc("How wide the motes circle, in pixels. Each mote varies around this.")
            .addSlider((s) => s.setLimits(10, 60, 2).setValue(get("stardustOrbitRadius") ?? 22).setDynamicTooltip().onChange(set("stardustOrbitRadius")));
        }
      }

      new Setting(body).setName("Bracket Tether")
        .setDesc("Underlines the span between matching brackets or quotes — straight or curly — whether the cursor is next to one or somewhere inside the pair.")
        .addToggle((toggle) => toggle.setValue(!!get("bracketTether")).onChange(setAndRedraw("bracketTether")));
      if (get("bracketTether")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Strength")
          .setDesc("How visible the line is.")
          .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("bracketTetherStrength") ?? 0.35).setDynamicTooltip().onChange(set("bracketTetherStrength")));
      }

      new Setting(body).setName("Motion Smear")
        .setDesc("The cursor's corners lag behind on springs, so it stretches as it moves and snaps back once it arrives.")
        .addToggle((toggle) => toggle.setValue(get("smear")).onChange(setAndRedraw("smear")));
      if (get("smear")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Stiffness")
          .setDesc("How hard the leading edge is pulled toward the new position. Higher gets there faster and stretches less.")
          .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("smearStiffness")).setDynamicTooltip().onChange(set("smearStiffness")));
        new Setting(g).setName("Trailing Stiffness")
          .setDesc("The same for the edge left behind. Lower is what makes the smear long — it is the gap between the two that you see.")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("smearTrailingStiffness")).setDynamicTooltip().onChange(set("smearTrailingStiffness")));
        new Setting(g).setName("Damping")
          .setDesc("How much the springs resist overshooting. Low values let the cursor wobble past and settle back; high values stop it dead.")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("smearDamping")).setDynamicTooltip().onChange(set("smearDamping")));
        new Setting(g).setName("Tapered Trail")
          .setDesc("Narrows the smear to a point behind the cursor, so a fast move reads as a comet tail instead of a dragged rectangle.")
          .addToggle((toggle) => toggle.setValue(!!get("smearTaper")).onChange(setAndRedraw("smearTaper")));
        if (get("smearTaper")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Taper Amount")
            .setDesc("How sharply the tail closes. At 1 it comes to a full point; lower just narrows it.")
            .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("smearTaperAmount") ?? 0.7).setDynamicTooltip().onChange(set("smearTaperAmount")));
        }
      }

      new Setting(body).setName("Energy Beam")
        .setDesc(get("gradientEnabled")
          ? "Scrolls your gradient along the cursor, with a brightness pulse riding over it."
          : "Runs a shimmering pulse of light along the cursor.")
        .addToggle((toggle) => toggle.setValue(get("energyEffect")).onChange(setAndRedraw("energyEffect")));
      if (get("energyEffect")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Beam Speed")
          .setDesc("How fast the pulse travels along the cursor.")
          .addSlider((s) => s.setLimits(0.2, 3, 0.1).setValue(get("energySpeed")).setDynamicTooltip().onChange(set("energySpeed")));
        // Aurora has nothing to work with without a ramp - it warps and
        // cross-mixes gradient colors - so it only appears once Gradient is on.
        if (get("gradientEnabled")) {
          new Setting(g).setName("Aurora")
            .setDesc("Swirls and mixes your gradient colors inside the cursor instead of scrolling them past.")
            .addToggle((toggle) => toggle.setValue(!!get("energyAurora")).onChange(setAndRedraw("energyAurora")));
          if (get("energyAurora")) {
            const g2 = this.subGroup(g);
            new Setting(g2).setName("Waviness")
              .setDesc("How hard the bands bend. At 0 they stay flat and just slide along the cursor; turned up they curve and ripple across it.")
              .addSlider((s) => s.setLimits(0, 2, 0.05).setValue(get("energyAuroraWaviness") ?? 1).setDynamicTooltip().onChange(set("energyAuroraWaviness")));
          }
        }
      }

      new Setting(body).setName("CRT Effect")
        .setDesc("Old-monitor phosphor look: the cursor leaves fading ghosts of itself behind as it moves.")
        .addToggle((toggle) => toggle.setValue(get("crtEffect")).onChange(setAndRedraw("crtEffect")));
      if (get("crtEffect")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Trail Length")
          .setDesc("How many ghosts are kept behind the cursor. 0 leaves none.")
          .addSlider((s) => s.setLimits(0, 30, 1).setValue(get("trailLength")).setDynamicTooltip().onChange(set("trailLength")));
        new Setting(g).setName("Trail Fade Time")
          .setDesc("How long (in ms) each ghost takes to fade out.")
          .addSlider((s) => s.setLimits(50, 1500, 25).setValue(get("trailFadeMs")).setDynamicTooltip().onChange(set("trailFadeMs")));
        new Setting(g).setName("Glow")
          .setDesc("Soft halo around the cursor, in its own color.")
          .addToggle((toggle) => toggle.setValue(get("glow")).onChange(set("glow")));
        new Setting(g).setName("Neon Trail")
          .setDesc("Render the ghosts as a glowing neon tube — a hot white core inside a saturated streak — instead of plain fading boxes. The tail matches the cursor's own width and full height.")
          .addToggle((toggle) => toggle.setValue(!!get("crtNeon")).onChange(setAndRedraw("crtNeon")));
        if (get("crtNeon")) {
          const g2 = this.subGroup(g);
          if (get("gradientEnabled")) {
            new Setting(g2).setName("Gradient Trail")
              .setDesc("Run the cursor's gradient along the neon streak, from the newest ghost to the oldest, instead of the one cursor color.")
              .addToggle((toggle) => toggle.setValue(!!get("crtNeonGradient")).onChange(set("crtNeonGradient")));
          }
        }
        new Setting(g).setName("Signal Glitch")
          .setDesc("When the cursor jumps somewhere far away — a click, a search result, a Vim motion — it briefly breaks up like a mistracked video signal: torn into slipping slices with the color channels pulled apart. Only fires on jumps, never while you type.")
          .addToggle((toggle) => toggle.setValue(!!get("crtGlitch")).onChange(setAndRedraw("crtGlitch")));
        if (get("crtGlitch")) {
          const g3 = this.subGroup(g);
          new Setting(g3).setName("Break-Up")
            .setDesc("How far the slices are thrown and how much the cursor's shape warps.")
            .addSlider((s) => s.setLimits(0.2, 2.5, 0.1).setValue(get("crtGlitchStrength") ?? 1).setDynamicTooltip().onChange(set("crtGlitchStrength")));
          new Setting(g3).setName("Color Split")
            .setDesc("How far the red, green and blue channels separate. 0 keeps the cursor's own color and only tears the shape.")
            .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("crtGlitchAberration") ?? 1).setDynamicTooltip().onChange(set("crtGlitchAberration")));
          new Setting(g3).setName("Duration")
            .setDesc("How long each burst lasts, in milliseconds.")
            .addSlider((s) => s.setLimits(60, 600, 10).setValue(get("crtGlitchMs") ?? 220).setDynamicTooltip().onChange(set("crtGlitchMs")));
        }
      }

      new Setting(body).setName("Speed Demon")
        .setDesc("The cursor heats up as you type — dull and grey when idle, through your own color to orange, red and finally white-hot — then cools back down over a few seconds of quiet.")
        .addToggle((toggle) => toggle.setValue(get("speedDemon")).onChange(setAndRedraw("speedDemon")));
      if (get("speedDemon")) {
        const g = this.subGroup(body);
        new Setting(g).setName("Fire Sparks")
          .setDesc("Throws embers off the top of the cursor once it is hot enough, faster the hotter it gets.")
          .addToggle((toggle) => toggle.setValue(get("speedDemonSparks")).onChange(setAndRedraw("speedDemonSparks")));
        if (get("speedDemonSparks")) {
          const g2 = this.subGroup(g);
          new Setting(g2).setName("Spark Quantity")
            .setDesc("How many embers spawn per burst. 0 stops sparks without turning Fire Sparks off; higher throws a heavier shower.")
            .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("speedDemonSparkQuantity") ?? 1).setDynamicTooltip().onChange(set("speedDemonSparkQuantity")));
          new Setting(g2).setName("Spark Trail")
            .setDesc("Gives each spark a fading comet tail, in pixels. 0 = no trail.")
            .addSlider((s) => s.setLimits(0, 30, 1).setValue(get("speedDemonSparkTrail") ?? 0).setDynamicTooltip().onChange(set("speedDemonSparkTrail")));
        }
        new Setting(g).setName("Sensitivity")
          .setDesc("How fast typing heats the cursor up. Higher reaches white-hot in fewer keystrokes.")
          .addSlider((s) => s.setLimits(0.5, 2, 0.1).setValue(get("speedDemonSensitivity")).setDynamicTooltip().onChange(set("speedDemonSensitivity")));
      }

      renderTorchToggleSetting(body);
      if (get("torchEffect")) {
        // One group for the whole spotlight, with the two subheadings inside
        // it: Spotlight and Environment are labels within the torch's options,
        // not siblings of the torch toggle itself.
        const g = this.subGroup(body);
        this.renderSubheading(g, "Spotlight");
        new Setting(g).setName("Follow")
          .setDesc("What the light tracks. Auto follows the mouse while you are moving it and hands back to the text cursor shortly after you stop.")
          .addDropdown((d) => d.addOptions({ caret: "Text Cursor Only", mouse: "Mouse Pointer Only", auto: "Auto Intelligent Swap" })
            .setValue(get("overlayFollowMode")).onChange(set("overlayFollowMode")));
        new Setting(g).setName("Light Size")
          .setDesc("How far the lit circle reaches, in pixels.")
          .addSlider((s) => s.setLimits(100, 800, 10).setValue(get("overlayRadius")).setDynamicTooltip().onChange(set("overlayRadius")));
        // Only offered when there's a blink to sync to - with blinking off the
        // toggle would be a switch that does nothing, and the reason why would
        // be in a different section of the panel.
        if (get("blinkingEnabled")) {
          new Setting(g).setName("Sync With Blink")
            .setDesc("The light closes in as the cursor blinks out and opens back up as it returns. Keeps the spotlight redrawing while the cursor blinks, so it costs a little more than the other options here.")
            .addToggle((toggle) => toggle.setValue(!!get("overlayBlinkSync")).onChange(setAndRedraw("overlayBlinkSync")));
          if (get("overlayBlinkSync")) {
            const g2 = this.subGroup(g);
            new Setting(g2).setName("Pulse Depth")
              .setDesc("How far the light closes at the darkest point, as a share of Light Size. At 1 the torch goes out entirely while the cursor is blinked off.")
              .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("overlayBlinkDepth") ?? 0.25).setDynamicTooltip().onChange(set("overlayBlinkDepth")));
          }
        }
        new Setting(g).setName("Light Color")
          .setDesc("The color of the light at its center. Independent of the cursor color.")
          .addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor")));
        new Setting(g).setName("Follow Speed")
          .setDesc("How quickly the light catches up when the cursor moves. Lower drifts after it; higher sticks to it.")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("overlaySpeed")).setDynamicTooltip().onChange(set("overlaySpeed")));

        this.renderSubheading(g, "Environment");
        new Setting(g).setName("Darkness")
          .setDesc("How far everything outside the light is dimmed.")
          .addSlider((s) => s.setLimits(0.2, 1, 0.01).setValue(get("overlayDarkness")).setDynamicTooltip().onChange(set("overlayDarkness")));
        new Setting(g).setName("Glow Strength")
          .setDesc("How strongly the light tints what it falls on. 0 lights the area without coloring it.")
          .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(get("overlayIntensity")).setDynamicTooltip().onChange(set("overlayIntensity")));
        new Setting(g).setName("Keep Sidebars Lit")
          .setDesc("Dims only the note you are editing, leaving the sidebars, tabs and ribbon at normal brightness. Also lifts the shading while a dialog is open. Desktop only — on mobile, where the sidebars are drawers rather than side panes, the whole screen dims.")
          .addToggle((toggle) => toggle.setValue(get("overlaySpareSidebars")).onChange(set("overlaySpareSidebars")));
      }
    });
  }

  renderNormalSection(containerEl) {
    const plugin = this.plugin;
    const set = (key) => async (v) => { plugin.settings[key] = v; await plugin.saveSettings(); };
    const setAndRedraw = (key) => async (v) => { plugin.settings[key] = v; await plugin.saveSettings(); this.display(); };

    this.renderSection(containerEl, "Presets", (body) => {
      if (plugin._pendingPresetName === undefined) plugin._pendingPresetName = "";
      new Setting(body)
        .setName("Save current settings as preset")
        .setDesc("Give your cursor a name, then click Save.")
        .addText((text) => {
          text.setPlaceholder("My cursor name");
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
            this.display();
          });
        });

      let importCode = "";
      new Setting(body)
        .setName("Import preset")
        .setDesc("Paste a share code from someone else to add their preset.")
        .addText((text) => {
          text.setPlaceholder("Paste code here…");
          text.onChange((v) => { importCode = v.trim(); });
          text.inputEl.style.fontFamily = "var(--font-monospace)";
          text.inputEl.style.fontSize = "var(--font-smaller)";
          text.inputEl.style.width = "14em";
        })
        .addButton((btn) => {
          btn.setButtonText("Import").onClick(async () => {
            if (!importCode) return;
            const imported = await plugin.importPreset(importCode);
            if (imported) {
              this.display();
            } else {
              btn.setButtonText("Invalid code");
              setTimeout(() => btn.setButtonText("Import"), 2000);
            }
          });
        });

      const presets = plugin.getUserPresets();
      const names = Object.keys(presets);

      if (names.length === 0) {
        const empty = body.createEl("p", {
          text: "No saved presets yet. Configure your cursor below, then save it above.",
        });
        empty.style.cssText = "font-size:var(--font-smaller);color:var(--text-muted);margin:0.4em 0 1em";
      } else {
        for (const name of names) {
          this.renderPresetRow(body, name, presets[name], {
            onLoad: async () => { await plugin.loadUserPreset(name); plugin._pendingPresetName = name; this.display(); },
            onEdit: async () => {
              await plugin.loadUserPreset(name);
              plugin._pendingPresetName = name;
              this.display();
              containerEl.scrollTop = 0;
            },
            onDelete: async () => { await plugin.deleteUserPreset(name); this.display(); },
          });
        }
      }
    });

    this.renderSection(containerEl, "General", (body) => {
      new Setting(body)
        .setName("Hide Real Cursor")
        .setDesc("Hides the native primary cursor so only the custom one shows. Additional cursors (multi-cursor editing) remain visible in Obsidian's default style.")
        .addToggle((toggle) => toggle.setValue(plugin.settings.hideNativeCaret).onChange(set("hideNativeCaret")));

      new Setting(body)
        .setName("Hide Cursor When Unfocused")
        .setDesc("Hides the cursor while Obsidian isn't the active window, the way most writing apps do. It comes straight back when you return, in the same place.")
        .addToggle((toggle) =>
          toggle.setValue(plugin.settings.hideOnWindowBlur ?? true).onChange(set("hideOnWindowBlur")));
    });

    // Everything from "what does the cursor look like" through "what effects
    // does it use" is identical in shape whether it's this global cursor or
    // one Vim mode's own snapshot - see renderLookSettings, shared with
    // renderModeControls below.
    this.renderLookSettings(containerEl, {
      get: (key) => plugin.settings[key],
      set,
      setAndRedraw,
      renderCursorStyleSetting: (body) => {
        new Setting(body)
          .setName("Cursor Style")
          .setDesc("The shape of the cursor itself. Each style has its own options below.")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
              .setValue(plugin.settings.cursorStyle)
              .onChange(async (value) => {
                plugin.settings.cursorStyle = value;
                await plugin.saveSettings();
                plugin.enable();
                this.display();
              })
          );
      },
      // Torch Spotlight owns a whole separate engine (torchEngineActive) that
      // needs to be started/stopped immediately on toggle, rather than just
      // having its setting saved - a Vim mode doesn't need this since its
      // torch state is already picked up by the shared engine's per-frame
      // torchPossible() scan across all modes.
      renderTorchToggleSetting: (body) => {
        new Setting(body)
          .setName("Torch Spotlight")
          .setDesc("Darkens everything except a pool of light around the cursor, so only the part of the note you are working on stays lit.")
          .addToggle((toggle) =>
            toggle.setValue(plugin.settings.torchEffect).onChange(async (value) => {
              plugin.settings.torchEffect = value;
              await plugin.saveSettings();
              if (plugin.settings.enabled) {
                value ? plugin.enableTorchOverlay() : plugin.disableTorchOverlay();
              }
              this.display();
            })
          );
      },
    });
  }

  // -------------------------------------------------------------------------
  // Shared preset-row UI (name, share code pill, Copy, Load, Edit, Delete).
  // -------------------------------------------------------------------------
  renderPresetRow(containerEl, name, snap, { onLoad, onEdit, onDelete }) {
    const code = presetToCode(name, snap);
    const setting = new Setting(containerEl).setName(name);

    const codeEl = setting.controlEl.createEl("code", { text: code });
    codeEl.style.cssText = [
      "font-size:10px", "letter-spacing:0.01em",
      "color:var(--text-muted)", "background:var(--background-secondary)",
      "border:1px solid var(--background-modifier-border)",
      "border-radius:3px", "padding:1px 6px",
      "max-width:10em", "overflow:hidden",
      "text-overflow:ellipsis", "white-space:nowrap",
      "display:inline-block", "vertical-align:middle",
      "cursor:pointer", "user-select:all",
      "margin-right:4px",
    ].join(";");
    codeEl.title = code;

    const copyBtn = setting.controlEl.createEl("button", { text: "Copy" });
    copyBtn.style.cssText = [
      "font-size:10px", "padding:2px 8px", "margin-right:6px",
      "border-radius:3px", "cursor:pointer",
      "border:1px solid var(--background-modifier-border)",
      "background:var(--background-secondary)",
      "color:var(--text-muted)",
    ].join(";");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    });

    setting
      .addButton((btn) => btn.setButtonText("Load").onClick(onLoad))
      .addButton((btn) => btn.setButtonText("Edit").onClick(onEdit))
      .addButton((btn) => btn.setButtonText("Delete").setWarning().onClick(onDelete));

    return setting;
  }

  // -------------------------------------------------------------------------
  // Vim Mode settings section — shown in full when the switch is on "Vim".
  // -------------------------------------------------------------------------
  renderVimSection(containerEl) {
    const plugin = this.plugin;

    containerEl.createEl("h3", { text: "⌨ Vim Cursors" });

    new Setting(containerEl)
      .setName("Control Obsidian's Vim key bindings")
      .setDesc("When on, this plugin owns Obsidian's Vim key bindings: switching to Vim mode turns them on, switching to CUA/Normal turns them off. Turn this off if you manage Vim key bindings yourself in Settings → Editor.")
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.vimControlObsidian).onChange(async (value) => {
          plugin.settings.vimControlObsidian = value;
          // Taking ownership mid-session: immediately enforce the current
          // mode so the keybindings match what the panel shows.
          if (value) plugin.setObsidianVim(!!plugin.settings.vimModeEnabled);
          await plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Show Vim mode in status bar")
      .setDesc("Displays the live mode on the left side of Obsidian's status bar, vim-style: -- NORMAL --, -- INSERT --, and so on.")
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.vimStatusBar).onChange(async (value) => {
          plugin.settings.vimStatusBar = value;
          plugin.syncVimStatusBar();
          await plugin.saveSettings();
          this.display();
        })
      );

    if (plugin.settings.vimStatusBar) {
      new Setting(this.subGroup(containerEl))
        .setName("Color status bar text to match the cursor")
        .setDesc("Tints the mode name with that mode's cursor color — Normal shows in the Normal cursor's blue, Insert in its green, and so on. Off uses your theme's normal status bar color.")
        .addToggle((toggle) =>
          toggle.setValue(plugin.settings.vimStatusBarColor).onChange(async (value) => {
            plugin.settings.vimStatusBarColor = value;
            await plugin.saveSettings();
          })
        );
    }

    if (!plugin.isObsidianVimOn()) {
      const warn = containerEl.createEl("p", {
        text: plugin.settings.vimControlObsidian
          ? "⚠ Obsidian's Vim key bindings look off right now. They should switch on automatically — reopen the editor if the mode cursors don't appear."
          : "⚠ Obsidian's Vim key bindings are off, so mode cursors won't appear. Enable them in Settings → Editor → Vim key bindings, or turn on \"Control Obsidian's Vim key bindings\" above.",
      });
      warn.style.cssText = "font-size:var(--font-smaller);color:var(--text-warning, var(--text-muted));margin:0.2em 0 1em";
    }

    // --- Vim presets, styled exactly like the normal preset list ---
    containerEl.createEl("h3", { text: "Vim Presets" });

    if (plugin._pendingVimPresetName === undefined) plugin._pendingVimPresetName = "";
    new Setting(containerEl)
      .setName("Save current Vim setup as preset")
      .setDesc("Give this set of per-mode cursors a name, then click Save.")
      .addText((text) => {
        text.setPlaceholder("My vim theme");
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
          this.display();
        });
      });

    let importVimCode = "";
    new Setting(containerEl)
      .setName("Import Vim preset")
      .setDesc("Paste a share code from someone else to add their Vim preset.")
      .addText((text) => {
        text.setPlaceholder("Paste code here…");
        text.onChange((v) => { importVimCode = v.trim(); });
        text.inputEl.style.fontFamily = "var(--font-monospace)";
        text.inputEl.style.fontSize = "var(--font-smaller)";
        text.inputEl.style.width = "14em";
      })
      .addButton((btn) => {
        btn.setButtonText("Import").onClick(async () => {
          if (!importVimCode) return;
          const imported = await plugin.importVimPreset(importVimCode);
          if (imported) {
            this.display();
          } else {
            btn.setButtonText("Invalid code");
            setTimeout(() => btn.setButtonText("Import"), 2000);
          }
        });
      });

    const presets = plugin.getVimPresets();
    const names = Object.keys(presets);

    if (names.length === 0) {
      const empty = containerEl.createEl("p", {
        text: "No saved Vim presets yet. Configure each mode below, then save it above.",
      });
      empty.style.cssText = "font-size:var(--font-smaller);color:var(--text-muted);margin:0.4em 0 1em";
    } else {
      for (const name of names) {
        const setting = this.renderPresetRow(containerEl, name, presets[name], {
          onLoad: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.display();
          },
          onEdit: async () => {
            await plugin.loadVimPreset(name);
            plugin._pendingVimPresetName = name;
            this.display();
            containerEl.scrollTop = 0;
          },
          onDelete: async () => { await plugin.deleteVimPreset(name); this.display(); },
        });
        if (name === plugin.settings.vimActivePreset) setting.setDesc("Currently active");
      }
    }

    // --- Per-mode editor: pick one mode, then edit its FULL cursor config ---
    containerEl.createEl("h3", { text: "Per-Mode Cursors" });

    if (!VIM_MODE_KEYS.includes(plugin._vimEditMode)) plugin._vimEditMode = "normal";

    // Tab row — one tab per Vim mode, replacing the old dropdown. Same visual
    // language as the CUA/Vim segmented switch at the top of the panel. Each
    // inactive tab's label is tinted with that mode's own cursor color (for
    // the current theme), so the row doubles as a live color legend; the
    // active tab uses the accent background instead, where a tint would be
    // unreadable.
    const isDarkTheme = containerEl.ownerDocument?.body?.classList?.contains("theme-dark") ?? true;
    const tabWrap = containerEl.createDiv();
    tabWrap.style.cssText = [
      "display:flex", "border:1px solid var(--background-modifier-border)",
      "border-radius:6px", "overflow:hidden", "margin:0.4em 0 1em", "max-width:520px",
    ].join(";");
    for (const m of VIM_MODE_KEYS) {
      const active = plugin._vimEditMode === m;
      const cfg = plugin.settings.vimModes[m] || {};
      const tint = isDarkTheme ? cfg.colorDark : cfg.colorLight;
      const btn = tabWrap.createEl("button", { text: VIM_MODE_LABELS[m] });
      btn.style.cssText = [
        "flex:1", "padding:7px 4px", "border:none", "cursor:pointer",
        "font-size:var(--font-ui-small)", "font-weight:" + (active ? "600" : "400"),
        "background:" + (active ? "var(--interactive-accent)" : "var(--background-secondary)"),
        "color:" + (active ? "var(--text-on-accent)" : (tint || "var(--text-normal)")),
        "transition:background 0.1s ease",
      ].join(";");
      btn.addEventListener("click", () => {
        if (plugin._vimEditMode === m) return;
        plugin._vimEditMode = m;
        this.display();
      });
    }

    const mode = plugin._vimEditMode;
    const target = plugin.settings.vimModes[mode];
    const heading = containerEl.createEl("h4", { text: `${VIM_MODE_LABELS[mode]} mode cursor` });
    heading.style.marginTop = "0.4em";

    if (mode === "command") {
      const note = containerEl.createEl("p", {
        text:
          "Applies whenever the caret leaves the note editor: the built-in Vim command " +
          "line (the \":\" / \"/\" prompt) and the rest of the Obsidian interface — Command " +
          "Palette, Quick Switcher, search, rename boxes, Settings fields and plugin modals. " +
          "Motion effects (smear, smooth movement, CRT trail) are best left off here: these " +
          "are all single-line fields, so they read as jitter rather than movement.",
      });
      note.style.cssText =
        "font-size:var(--font-smaller);color:var(--text-muted);margin:0.2em 0 1em";
    }

    this.renderModeControls(containerEl, target, () => {
      plugin.settings.vimActivePreset = "";
    });
  }

  // Renders the FULL set of cursor look/effect controls bound to an arbitrary
  // settings-shaped `target` object (here, one Vim mode's snapshot).
  renderModeControls(containerEl, target, onEdit) {
    const plugin = this.plugin;
    const after = onEdit || (() => {});
    const set = (key) => async (v) => { target[key] = v; after(); await plugin.saveSettings(); };
    const setR = (key) => async (v) => { target[key] = v; after(); await plugin.saveSettings(); this.display(); };

    this.renderLookSettings(containerEl, {
      get: (key) => target[key],
      set,
      setAndRedraw: setR,
      renderCursorStyleSetting: (body) => {
        new Setting(body)
          .setName("Cursor Style")
          .setDesc("The shape of the cursor itself. Each style has its own options below.")
          .addDropdown((d) =>
            d.addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
              .setValue(target.cursorStyle).onChange(setR("cursorStyle"))
          );
      },
      renderTorchToggleSetting: (body) => {
        new Setting(body).setName("Torch Spotlight")
          .setDesc("Darkens everything except a pool of light around the cursor, so only the part of the note you are working on stays lit.")
          .addToggle((t) => t.setValue(target.torchEffect).onChange(setR("torchEffect")));
      },
    });
  }
}
/* nosourcemap */