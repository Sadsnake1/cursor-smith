import { VIM_MODE_STARTERS } from "./presets";
import type { CursorSmithSettings, LegacySettings, Look, SettingKey } from "./types";

export const DEFAULT_SETTINGS = {
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
  popLettersRise: false,  // the letter floats straight up from the cursor's top and fades
  popTypewriter: false,    // the caret dips a little with each character and springs back
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
  vimModes: {} as Record<string, Look>, // filled in below with full per-mode snapshots
};

// Housekeeping keys belonging to the Vim system. A regular (CUA) cursor preset
// must never carry or clobber these — they're listed once here so saving and
// loading a preset can't drift apart as new vim keys get added.
export const VIM_STATE_KEYS: SettingKey[] = [
  "vimPresets", "vimModes", "vimModeEnabled", "vimActivePreset",
  "vimControlObsidian", "vimStatusBar", "vimStatusBarColor",
];

// The Vim modes the plugin themes, in cycle order. "command" is the ":" / "/"
// prompt that @replit/codemirror-vim (the engine Obsidian bundles) opens as a
// CodeMirror panel at the bottom of the editor — see isVimCommandLineActive().
export const VIM_MODE_KEYS = ["normal", "insert", "visual", "replace", "command"];
export const VIM_MODE_LABELS: Record<string, string> = {
  normal: "Normal", insert: "Insert", visual: "Visual",
  replace: "Replace", command: "Command",
};

// Every setting a Vim mode is allowed to override — i.e. everything that
// affects how the cursor looks or behaves. Structural/housekeeping keys
// (enabled, hideNativeCaret, presets, the vim-control keys) are intentionally
// excluded. A per-mode config is a snapshot containing exactly these keys.
export const LOOK_KEYS: (keyof Look)[] = [
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
  // The Line cursor's height (1.6.6, issue #33). Appended; the default is the
  // full line, so an older code imports as the caret it described.
  "caretHeightPct",
  // Popping letters rising straight up (1.6.7). Appended, off by default.
  "popLettersRise",
  // Typewriter, a pop effect (1.6.7). Appended, off by default.
  "popTypewriter",
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
export function migrateLegacyKeys(src: LegacySettings): LegacySettings;
export function migrateLegacyKeys(src: LegacySettings | null | undefined): LegacySettings | null | undefined;
export function migrateLegacyKeys(src: LegacySettings | null | undefined): LegacySettings | null | undefined {
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
    if (o.stardustEnabled === undefined) o.stardustEnabled = o.idleStardust as boolean;
    delete o.idleStardust;
  }
  // Translucency shipped for a moment as a Box-only toggle with three dials
  // hanging off it, then became one toggle for every style. The gate carries
  // over as-is; the dials are dropped rather than mapped, since the values
  // they held (an arbitrary alpha, a blend mode, a lens strength) no longer
  // have anywhere to go.
  if ("boxTranslucent" in o) {
    if (o.cursorTranslucent === undefined) o.cursorTranslucent = o.boxTranslucent as boolean;
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

// Copy only the look keys out of an arbitrary settings-shaped object.
export function pickLook(src: Partial<CursorSmithSettings> | null | undefined): Partial<Look> {
  const o: Partial<Look> = {};
  if (!src) return o;
  const from = migrateLegacyKeys(src);
  const dst = o as unknown as Record<string, unknown>, fromRec = from as unknown as Record<string, unknown>;
  for (const k of LOOK_KEYS) if (k in from) dst[k] = fromRec[k];
  return o;
}

// Build a complete per-mode snapshot: the global defaults for every look key,
// with the given overrides applied on top. Guarantees no key is ever missing.
export function fullVimMode(overrides: Partial<Look> | null): Look {
  return Object.assign(pickLook(DEFAULT_SETTINGS), pickLook(overrides)) as Look;
}

// Build one mode's snapshot, falling back to that mode's starter look when the
// source has nothing for it. This matters for "command", which was added after
// people had already saved Vim presets: without the fallback an older preset
// would expand to the plain global defaults for Command and every preset would
// end up with an identical, uncustomised command-line cursor.
export function vimModeSnapshot(modeKey: string, overrides: Partial<Look> | null): Look {
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
export function presetWithDefaults(preset: Partial<CursorSmithSettings> | null) {
  return Object.assign({}, pickLook(DEFAULT_SETTINGS), migrateLegacyKeys(preset));
}

// Clone a whole vimModes map (or preset) into fresh, complete snapshots so
// callers never share nested references with this.settings.
export function cloneVimModes(modes: Record<string, Partial<Look>> | null): Record<string, Look> {
  const out: Record<string, Look> = {};
  for (const k of VIM_MODE_KEYS) out[k] = vimModeSnapshot(k, modes && modes[k]);
  return out;
}
