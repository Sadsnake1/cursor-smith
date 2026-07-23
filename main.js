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

const DEFAULT_SETTINGS = {
  enabled: true,
  cursorStyle: "Box", // "Line" | "Box" | "Underline"
  uiMode: "cua", // "cua" | "vim" — which settings panel is shown; drives vimModeEnabled

  // --- appearance color controls ---
  colorDark: "#39ff14", 
  colorLight: "#333333",

  // --- CRT effect (trail + glow) ---
  crtEffect: false,
  glow: true, 

  // --- torch spotlight effect (can run alongside any cursor style) ---
  torchEffect: false,
  overlaySpareSidebars: true,
  overlayFollowMode: "caret", // caret | mouse | auto
  overlayRadius: 250,
  overlayDarkness: 0.7,
  overlayIntensity: 0.1,
  overlayColor: "#ff963c",
  overlayFlicker: false,
  overlaySpeed: 0.22, // lerp factor: how fast the torch chases its target

  // --- global caret properties ---
  caretWidthPx: 2,         
  popLetters: true,        
  popRainbow: false,       // cycle each popped letter through a rainbow of colors
  flameTrail: true,        
  backspaceDisintegrate: false,  // Backspace/Delete → invert flame trail direction + colors
  lineSerifs: false,             // Line cursor: add horizontal serifs (I-beam look)
  boxHollow: false,              // Box cursor: outline only, no fill
  boxHollowWidth: 2,             // Outline stroke width when boxHollow is on

  // --- Speed Demon: cursor heats up with typing speed ---
  speedDemon: false,
  speedDemonSparks: true,        // spawn small fire particles at high heat
  speedDemonSensitivity: 1,      // 0.5..2 multiplier on how fast heat builds
  speedDemonSparkQuantity: 1,    // 0..3 multiplier on how many sparks spawn per burst
  speedDemonSparkTrail: 0,       // 0..30px comet-tail trailing behind each spark; 0 = no trail
  cursorOpacity: 1,
  energyEffect: false,
  energySpeed: 1,

  // --- shared canvas engine settings ---
  trailLength: 10, 
  trailFadeMs: 450, 
  blinkingEnabled: true,
  blinkSpeed: 1.2,       
  blinkOnOffBalance: 0.5,
  blinkDelayMs: 0,       // ms of full-on hold after any move/keystroke before blinking resumes
  hideNativeCaret: true, 
  showChar: true, 
  moveDelayMs: 0,        
  smear: true,           
  smearStiffness: 0.6,
  smearTrailingStiffness: 0.4,
  smearDamping: 0.8,

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
  "crtEffect", "glow",
  "torchEffect", "overlaySpareSidebars", "overlayFollowMode", "overlayRadius",
  "overlayDarkness", "overlayIntensity", "overlayColor", "overlayFlicker", "overlaySpeed",
  "caretWidthPx", "popLetters", "popRainbow", "flameTrail", "backspaceDisintegrate",
  "lineSerifs", "boxHollow", "boxHollowWidth",
  "speedDemon", "speedDemonSparks", "speedDemonSensitivity",
  "speedDemonSparkQuantity", "speedDemonSparkTrail",
  "cursorOpacity", "energyEffect", "energySpeed",
  "trailLength", "trailFadeMs",
  "blinkingEnabled", "blinkSpeed", "blinkOnOffBalance", "blinkDelayMs",
  "showChar", "moveDelayMs",
  "smear", "smearStiffness", "smearTrailingStiffness", "smearDamping",
  "smoothEnabled", "smoothStopBlinking", "smoothness", "catchUpSpeed",
  "maxCatchUpSpeed", "smoothAdaptive",
];

// Copy only the look keys out of an arbitrary settings-shaped object.
function pickLook(src) {
  const o = {};
  if (!src) return o;
  for (const k of LOOK_KEYS) if (k in src) o[k] = src[k];
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
  return Object.assign({}, pickLook(DEFAULT_SETTINGS), preset);
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
// A share code is the preset snapshot JSON encoded as base64url (no padding).
// The preset name is embedded inside the JSON so the recipient gets both the
// name and the settings in a single string.
// ---------------------------------------------------------------------------
function presetToCode(name, snap) {
  const payload = JSON.stringify(Object.assign({ __name: name }, snap));
  // btoa works on latin-1; encodeURIComponent + unescape widens to UTF-8.
  return btoa(unescape(encodeURIComponent(payload)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function codeToPreset(code) {
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

function blinkAlphaAt(nowMs, speed, onOffBalance = 0.5) {
  if (speed <= 0) return 1;
  const period = 2500 / speed; 
  const phase = (nowMs % period) / period; 
  const fade = 0.15; 
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
    const saved = await this.loadData();
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
    this.secondaryCarets = []; // dashed 2px vertical lines for CM6 multi-cursor mode
    this.lastActive = null; 
    this.pending = null; 
    this.smearQuad = null;
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;

    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;

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
    this._chromeCache = null;
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
    const win = doc.defaultView;
    if (win) win.addEventListener("resize", onResize);
    
    this._cleanups.push(() => {
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("selectionchange", onActivity);
      doc.removeEventListener("mousedown", onActivity, true);
      doc.removeEventListener("focusin", onActivity, true);
      doc.removeEventListener("wheel", onActivity, { capture: true });
      doc.removeEventListener("scroll", onActivity, { capture: true });
      if (win) win.removeEventListener("resize", onResize);
    });
  }

  async saveSettings() {
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
    const doc = this.canvas ? this.canvas.ownerDocument : document;
    const isDark = doc.body.classList.contains("theme-dark");
    // this.settings is the effective (per-mode when active) config during draw.
    const baseColor = isDark ? this.settings.colorDark : this.settings.colorLight;
    if (!this.settings.speedDemon) return baseColor;
    return this.heatColor(this.heat, baseColor);
  }

  // Get the base (non-heated) color. Used by Speed Demon internally so its
  // "cold" endpoint desaturates the user's chosen colour rather than
  // always starting from the same grey - a green-configured cursor cools
  // to a dim moss, an orange one cools to slate.
  getBaseColor() {
    const doc = this.canvas ? this.canvas.ownerDocument : document;
    const isDark = doc.body.classList.contains("theme-dark");
    return isDark ? this.settings.colorDark : this.settings.colorLight;
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
    // then dim to ~55% brightness. Uses luma (Rec. 601 coefficients) so
    // the grey we blend toward matches the perceived brightness of the
    // base colour instead of muddying dark colours.
    const luma = 0.299 * br + 0.587 * bg + 0.114 * bb;
    const desatMix = 0.7;                      // higher = greyer
    const dim = 0.55;
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
    o.style.setProperty("--torch-radius", s.overlayRadius + "px");
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
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;
    this.particles = [];
    this.flamePixels = [];
    this.secondaryCarets = [];
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
    this.secondaryCarets = [];
    this.lastActive = null;
    this.pending = null;
    this.smearQuad = null;
    this.smearCenterPrev = null;
    this._smearMoving = false;
    this._smearDtT = 0;
    this.smearQuadLastMoveT = 0;
    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;
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
        // Don't draw anything during a Slides presentation. The note editor
        // stays open underneath the presentation overlay and its CM view
        // can still report hasFocus, so without this guard the cursor keeps
        // blinking over the slides and keystrokes still reach the editor.
        if (this.presentationActive()) {
          // Clear whatever was on canvas from the previous frame and park —
          // at idle rate: nothing animates while a presentation runs.
          if (this.ctx && this.canvas && !this._presCleared) {
            const win = this.canvas.ownerDocument.defaultView || window;
            this.ctx.clearRect(0, 0, win.innerWidth, win.innerHeight);
            this._presCleared = true;
            this._dirtyPrev = null;
            this._drawSig = null;
          }
          this._canvasGear = "idle";
          schedule();
          return;
        }
        this._presCleared = false;

        const view = this.app.workspace.activeEditor?.editor?.cm;
        this.ensureCanvasForView(view);
        if (view) this.registerWindowEvents(view.dom.ownerDocument);

        if (this.canvasWrapper && this.canvas) {
          // Only clip to the editor pane while the note editor is the thing
          // actually focused. The moment focus moves anywhere else - file
          // tree rename box, Command Palette, Settings, other modals - there's
          // no reason to keep the canvas boxed inside the pane, and doing so
          // is exactly what made the cursor invisible outside the editor.
          const r = (view && view.hasFocus ? this.getPaneRect(view) : null) ||
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
          const width = Math.round(r.width);
          const height = Math.round(r.height);
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
        try {
          this.updateActivePoint();
          this.updateSmoothCursor();
          // Multi-cursor: gather all non-primary carets so draw() can stamp a
          // dashed line at each. Independent of the smoothing/smearing pipeline
          // that only tracks the primary caret.
          this.secondaryCarets = this.secondaryCaretCoords(view);
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
            const a = this.blinkAlpha(nowT);
            blinkFading = a > 0.02 && a < 0.98;
            blinkBucket = a >= 0.5 ? 1 : 0;
          }
          this._canvasGear =
            animating || recentInput ? "hot"
              : blinkFading ? "warm"
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
          const staticFrame = !animating && !blinkFading && !energyShimmer;
          let doDraw = true;
          if (staticFrame) {
            const la = this.lastActive;
            const isDark = this.canvas
              ? this.canvas.ownerDocument.body.classList.contains("theme-dark")
              : true;
            const sec = this.secondaryCarets && this.secondaryCarets.length
              ? this.secondaryCarets.map((c) => (c.x | 0) + ":" + (c.y | 0)).join(",")
              : "";
            const sig = [
              _vimMode, blinkBucket, isDark,
              la ? Math.round(la.x * 2) + "," + Math.round(la.top * 2) + "," +
                   Math.round(la.w * 2) + "," + Math.round(la.h * 2) + "," + (la.char || "") : "none",
              eff.cursorStyle, eff.colorDark, eff.colorLight, eff.caretWidthPx,
              eff.cursorOpacity, eff.glow, eff.showChar, eff.boxHollow, sec,
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
// ... existing code ...
      const textColor = charStyle.color || contentStyle.color || "#ffffff";

      // Extract exact font metrics
      const fontSize = parseFloat(charStyle.fontSize) || parseFloat(contentStyle.fontSize) || 14;
      const fontFamily = charStyle.fontFamily || contentStyle.fontFamily || "monospace";
      const fontWeight = charStyle.fontWeight || contentStyle.fontWeight || "normal";
      const fontStyleCss = charStyle.fontStyle || contentStyle.fontStyle || "normal";
      
      // Grab letter-spacing (getComputedStyle resolves this to 'px' even if set in 'em')
      const letterSpacingStr = charStyle.letterSpacing || contentStyle.letterSpacing;
      let letterSpacing = 0;
      if (letterSpacingStr && letterSpacingStr.endsWith('px')) {
        letterSpacing = parseFloat(letterSpacingStr) || 0;
      }

      // Width: canvas measurement primary (accurate for proportional fonts,
      // respects letter-spacing), coordsAtPos delta as fallback only when
      // there's no character to measure (end of text, blank line).
      // Note: coordsAtPos(pos+1) at end-of-line returns the start of the
      // NEXT line, making the delta garbage - so it must be the fallback,
      // not the primary source. The canvas measurement handles end-of-line
      // correctly because it measures the actual glyph, not a position delta.
      let charWidth = view.defaultCharacterWidth || 8;
      if (char) {
        const measuredW = this.measureCharWidth(char, fontFamily, fontSize, fontWeight, fontStyleCss);
        if (measuredW) {
          charWidth = measuredW + letterSpacing;
        } else {
          try {
            const nextCoords = view.coordsAtPos(pos + 1, -1) || view.coordsAtPos(pos + 1, 1);
            if (nextCoords) {
              const measured = nextCoords.left - c.left;
              if (measured > 0.5 && measured < charWidth * 6) charWidth = measured;
            }
          } catch {
            /* fall back to defaultCharacterWidth */
          }
        }
      }

      let finalWidth = charWidth;
      if (this.styleFor("cursorStyle") === "Line") {
        finalWidth = this.styleFor("caretWidthPx");
      }

      // Height: match the browser's native selection highlight box by
      // reading CSS line-height. contentStyle (the CM editor) is the
      // reliable source; charStyle from elementFromPoint can land on a
      // decoration or embed with an unrelated line-height, so prefer
      // contentStyle when charStyle gives something wildly different.
      let h = Math.max(4, c.bottom - c.top);
      const rawLineHeight = charStyle.lineHeight || contentStyle.lineHeight;
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
        focused: true,
        pos: null,
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
  measureCharWidth(char, fontFamily, fontSize, fontWeight, fontStyle) {
    try {
      if (!this._measureCtx) {
        const canvas = (this.canvas?.ownerDocument ?? document).createElement("canvas");
        this._measureCtx = canvas.getContext("2d");
      }
      const weight = fontWeight && fontWeight !== "normal" ? fontWeight + " " : "";
      const style = fontStyle && fontStyle !== "normal" ? fontStyle + " " : "";
      this._measureCtx.font = `${style}${weight}${fontSize}px ${fontFamily}`;
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
          if (this.smearCenterPrev) {
            this.smearCenterPrev.x += dx;
            this.smearCenterPrev.y += dy;
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
      return;
    }

    if (!this.settings.smoothEnabled) {
      // Pinned straight to the target every frame: never "in motion" as far
      // as the frame governor is concerned.
      this.animActive = { ...this.lastActive };
      this._smoothMoving = false;
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
  }

  commitMove(caret) {
    this.pushTrail(this.lastActive);
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
      this._deletePending = 0;
    }
    this.lastActive = caret;
    this.pending = null;
    this.lastMoveTime = performance.now(); 
  }

  getActiveRect() {
    const active = this.animActive;
    if (!active) return null;
    if (this.styleFor("cursorStyle") === "Underline") {
      const uThickness = Math.max(2, Math.round(active.h * 0.15));
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
    }
    this.smearCenterPrev = center;

    const freqLead = 2 + Math.max(0, Math.min(1, settings.smearStiffness)) * 38;
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

  pushTrail(point) {
    if (!point) return;
    this.trail.push({ x: point.x, y: point.top, w: point.w, h: point.h, t: performance.now() });
    const max = Math.max(0, Math.round(this.settings.trailLength));
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

  spawnFlamePixels(anchor, disintegrate = false) {
    if (!this.settings.flameTrail) return;
    
    // Disintegration bursts get a few more particles and a stronger scatter
    // so deletion feels heavier than a normal cursor move.
    const count = disintegrate
      ? Math.floor(10 + Math.random() * 8)
      : Math.floor(6 + Math.random() * 6);
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

    // Anchor centre - disintegration particles fly *outward from* this
    // point (with an extra outward bias on their velocity), while normal
    // flame pixels stay near where they spawn and drift sideways.
    const anchorW = anchor.w || anchor.actualCharWidth || 8;
    const cx = anchor.x + anchorW / 2;
    const cy = anchor.top + anchor.h / 2;

    for (let i = 0; i < count; i++) {
      const pX = anchor.x + Math.random() * anchorW;
      const pY = anchor.top + Math.random() * anchor.h;
      const varR = Math.max(0, Math.min(255, r + Math.floor((Math.random() - 0.5) * 70)));
      const varG = Math.max(0, Math.min(255, g + Math.floor((Math.random() - 0.5) * 70)));
      const varB = Math.max(0, Math.min(255, b + Math.floor((Math.random() - 0.5) * 70)));

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
        size: 2.5 + Math.random() * 3,
        color: `rgb(${varR}, ${varG}, ${varB})`,
        alpha: 1,
        start: performance.now()
      });
    }
  }

  blinkAlpha(now) {
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
    return blinkAlphaAt(now, Math.max(0, this.settings.blinkSpeed), this.settings.blinkOnOffBalance ?? 0.5);
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
    this.drawFlamePixels();

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
      const q = this.smearQuad;
      if (q) {
        for (const k in q) {
          if (q[k].x < x0) x0 = q[k].x;
          if (q[k].y < y0) y0 = q[k].y;
          if (q[k].x > x1) x1 = q[k].x;
          if (q[k].y > y1) y1 = q[k].y;
        }
      }
      const pad = 24 + Math.max(0, this.settings.caretWidthPx || 0);
      this._markDirty(x0 - pad, y0 - pad, (x1 - x0) + pad * 2, (y1 - y0) + pad * 2);
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
        this._markDirty(p.x - 14, p.y - 14, p.w + 28, p.h + 28);
        cb(p, alpha);
      }
    }
  }

  fillCursorShape(ctx, rx, ry, rw, rh) {
    const q = this.settings.smear ? this.smearQuad : null;
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

  createEnergyGradient(x, y, w, h, baseColor, alpha) {
    const ctx = this.ctx;
    const speed = this.settings.energySpeed ?? 1;
    const t = (performance.now() / 1000) * speed;
    const base = hexToRgbTuple(baseColor);

    const grad = ctx.createLinearGradient(x + w / 2, y + h, x + w / 2, y);
    const stops = 6;
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops;
      const pulse = 0.5 + 0.5 * Math.sin((pos - t * 0.6) * Math.PI * 2);

      let r = base[0], g = base[1], b = base[2];
      if (pulse > 0.5) {
        const k = (pulse - 0.5) * 2;
        r += (255 - r) * k * 0.55;
        g += (255 - g) * k * 0.55;
        b += (255 - b) * k * 0.55;
      } else {
        const k = (0.5 - pulse) * 2;
        r -= r * k * 0.45;
        g -= g * k * 0.45;
        b -= b * k * 0.45;
      }

      const shift = 14;
      r += Math.sin(t * 0.7 + pos * 6) * shift;
      g += Math.sin(t * 0.7 + pos * 6 + 2.1) * shift;
      b += Math.sin(t * 0.7 + pos * 6 + 4.2) * shift;

      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));

      grad.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  }

  drawGenericCaret(isUnderline = false) {
    const ctx = this.ctx;
    const settings = this.settings;
    const active = this.animActive;
    const now = performance.now();
    const trailColor = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));

    this.forEachTrailPoint((p, alpha) => {
      ctx.fillStyle = hexToRgba(trailColor, alpha * opacity);
      if (isUnderline) {
        const uThickness = Math.max(2, Math.round(p.h * 0.15));
        ctx.fillRect(p.x, p.y + p.h - uThickness, p.w, uThickness);
      } else {
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    });

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
      const uThickness = Math.max(2, Math.round(active.h * 0.15));
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

    ctx.fillStyle = settings.energyEffect
      ? this.createEnergyGradient(rx, ry, rw, rh, color, 0.9 * blinkAlpha * opacity)
      : hexToRgba(color, 0.9 * blinkAlpha * opacity);
    this.fillCursorShape(ctx, rx, ry, rw, rh);

    // Line + serifs = classic I-beam. Only for the Line style (underline
    // wouldn't make visual sense with serifs). Serifs are axis-aligned
    // even when the stem smears - a smeared serif reads as a broken glyph
    // rather than a cursor cap. Serif span follows the actual char width
    // under the caret so it matches the text; falls back to a multiple of
    // the stem on empty lines.
    if (!isUnderline && settings.lineSerifs) {
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

    this.flamePixels = this.flamePixels.filter(p => {
      const elapsed = (now - p.start) / 1000;
      if (elapsed > 0.4) return false;

      const t = elapsed / 0.4;
      p.alpha = 1 - Math.pow(t, 2);

      const curX = p.x + p.vx * elapsed;
      const curY = p.y + p.vy * elapsed;

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

  drawRetroBox() {
    const ctx = this.ctx;
    const settings = this.settings;
    const now = performance.now();
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));
    const hollow = this.styleFor("boxHollow");
    const strokeW = hollow ? Math.max(1, Math.min(6, settings.boxHollowWidth || 2)) : 0;

    this.forEachTrailPoint((p, alpha) => {
      if (hollow) {
        ctx.strokeStyle = hexToRgba(color, alpha * opacity);
        ctx.lineWidth = strokeW;
        // Inset by half the stroke so the outline lands inside the same
        // footprint the filled trail dot would occupy (canvas strokes
        // straddle the path centerline).
        const inset = strokeW / 2;
        ctx.strokeRect(p.x + inset, p.y + inset, Math.max(0, p.w - strokeW), Math.max(0, p.h - strokeW));
      } else {
        ctx.fillStyle = hexToRgba(color, alpha * opacity);
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    });

    const active = this.animActive;
    if (active) {
      const blinkAlpha = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);

      ctx.save();
      if (settings.crtEffect && settings.glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * blinkAlpha;
        if (!hollow) {
          // Ghost pre-fill just to seed the shadow; solid box does this
          // to get a soft halo, but a stroked outline already draws a
          // shadow around the line itself so this step is unnecessary
          // (and would add a second inner halo).
          ctx.fillStyle = hexToRgba(color, 0.01);
          this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
          ctx.shadowBlur = 0;
        }
      }

      const paintStyle = settings.energyEffect
        ? this.createEnergyGradient(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * opacity)
        : hexToRgba(color, 0.9 * blinkAlpha * opacity);

      if (hollow) {
        // Stroke the smear quad so the outline deforms with movement the
        // same way a filled box would. Reuses fillCursorShape's corner
        // logic inline (we need stroke here, not fill).
        const q = settings.smear ? this.smearQuad : null;
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
      // drawing an inverted glyph on top would duplicate it.
      const displayChar = this.pending ? this.pending.holdChar : (active.holdChar || active.char);
      if (!hollow && settings.showChar && displayChar) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.3 + blinkAlpha * 0.7);
        ctx.fillStyle = invertColor(active.textColor);
        ctx.font = `${active.fontSize}px ${active.fontFamily}`;

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

        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(displayChar, active.x + renderW / 2, baselineY);
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
      // being re-enabled, a mode switch, or the pane moving.
      this._torchIdleT = window.setTimeout(() => {
        this._torchIdleT = 0;
        if (this.torchEngineActive) this.torchRaf = requestAnimationFrame(tick);
      }, 150);
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
        try {
          if (this.presentationActive()) {
            // Same presentation-mode guard as the canvas engine.
            if (this.overlay) this.overlay.classList.add("torch-cursor-hidden");
          } else if (!this.settings.torchEffect) {
            // This mode (or the global cursor) doesn't want the spotlight — just
            // hide it. Don't disable the engine: another mode may want it, and
            // switching back should be instant.
            if (this.overlay) this.overlay.classList.add("torch-cursor-hidden");
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
              const usePane = r && this.settings.overlaySpareSidebars;
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

              const hideForModal = this.settings.overlaySpareSidebars && this.modalOpen;
              this.overlay.classList.toggle("torch-cursor-hidden", !!hideForModal);
            }
          }
        } finally {
          this.settings = _real;
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

    this._chromeCache = { doc, t: now, top, bottomInset: 0 };
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

      if (get("cursorStyle") === "Line") {
        new Setting(body).setClass("cursor-smith-indent-1")
          .setName("Cursor Thickness")
          .setDesc("How thick the Line cursor is, in pixels.")
          .addSlider((slider) => slider.setLimits(1, 12, 1).setValue(get("caretWidthPx")).setDynamicTooltip().onChange(set("caretWidthPx")));

        new Setting(body).setClass("cursor-smith-indent-1")
          .setName("Serifs")
          .setDesc("Adds classic I-beam serifs (small horizontal caps) at the top and bottom of the line cursor.")
          .addToggle((toggle) => toggle.setValue(get("lineSerifs")).onChange(set("lineSerifs")));
      }

      new Setting(body).setName("Cursor Color (Dark Theme)")
        .addColorPicker((cp) => cp.setValue(get("colorDark")).onChange(set("colorDark")));
      new Setting(body).setName("Cursor Color (Light Theme)")
        .addColorPicker((cp) => cp.setValue(get("colorLight")).onChange(set("colorLight")));
      new Setting(body).setName("Cursor Opacity").setDesc("How see-through the cursor is.")
        .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("cursorOpacity")).setDynamicTooltip().onChange(set("cursorOpacity")));

      if (get("cursorStyle") === "Box") {
        new Setting(body).setClass("cursor-smith-indent-1")
          .setName("Show Letter Inside Cursor")
          .setDesc("Shows the letter under the cursor inside the block, with the colors flipped.")
          .addToggle((toggle) => toggle.setValue(get("showChar")).onChange(set("showChar")));

        new Setting(body).setClass("cursor-smith-indent-1")
          .setName("Hollow")
          .setDesc("Draws only the outline of the box instead of a filled block. Lets the underlying character show through naturally.")
          .addToggle((toggle) => toggle.setValue(get("boxHollow")).onChange(setAndRedraw("boxHollow")));

        if (get("boxHollow")) {
          new Setting(body).setClass("cursor-smith-indent-2")
            .setName("Outline Width")
            .setDesc("Thickness of the hollow box's outline, in pixels.")
            .addSlider((slider) => slider.setLimits(1, 6, 1).setValue(get("boxHollowWidth")).setDynamicTooltip().onChange(set("boxHollowWidth")));
        }
      }
    });

    this.renderSection(containerEl, "Blinking", (body) => {
      new Setting(body)
        .setName("Blinking")
        .setDesc("Makes the cursor blink. Turn off to keep it always fully lit.")
        .addToggle((toggle) => toggle.setValue(get("blinkingEnabled")).onChange(setAndRedraw("blinkingEnabled")));

      if (get("blinkingEnabled")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Blink Speed").setDesc("How fast the cursor blinks.")
          .addSlider((s) => s.setLimits(0.1, 3, 0.1).setValue(get("blinkSpeed")).setDynamicTooltip().onChange(set("blinkSpeed")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Blink Balance").setDesc("How the blink cycle is split between lit and dark.")
          .addSlider((s) => s.setLimits(0.1, 0.9, 0.05).setValue(get("blinkOnOffBalance")).setDynamicTooltip().onChange(set("blinkOnOffBalance")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Don't Blink While Typing").setDesc("Keeps the cursor fully lit while you type or move it.")
          .addToggle((toggle) => toggle.setValue(get("smoothStopBlinking")).onChange(set("smoothStopBlinking")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Blink Delay").setDesc("How long (in ms) the cursor stays fully lit after any move or keystroke before blinking resumes. Works independently of Smooth Movement.")
          .addSlider((s) => s.setLimits(0, 2000, 50).setValue(get("blinkDelayMs") ?? 0).setDynamicTooltip().onChange(set("blinkDelayMs")));
      }
    });

    this.renderSection(containerEl, "Smooth Movement", (body) => {
      new Setting(body)
        .setName("Smooth Movement")
        .setDesc("Makes the cursor glide to its new spot instead of jumping there instantly.")
        .addToggle((toggle) => toggle.setValue(get("smoothEnabled")).onChange(setAndRedraw("smoothEnabled")));

      if (get("smoothEnabled")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Glide Amount")
          .addSlider((s) => s.setLimits(0.05, 0.30, 0.05).setValue(get("smoothness")).setDynamicTooltip().onChange(set("smoothness")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Catch-Up Speed")
          .addSlider((s) => s.setLimits(0.30, 0.80, 0.05).setValue(get("catchUpSpeed")).setDynamicTooltip().onChange(set("catchUpSpeed")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Max Catch-Up Speed")
          .addSlider((s) => s.setLimits(0.50, 1.0, 0.05).setValue(get("maxCatchUpSpeed")).setDynamicTooltip().onChange(set("maxCatchUpSpeed")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Speed Up When Typing Fast")
          .addToggle((toggle) => toggle.setValue(get("smoothAdaptive")).onChange(set("smoothAdaptive")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Movement Delay")
          .addSlider((s) => s.setLimits(0, 500, 10).setValue(get("moveDelayMs")).setDynamicTooltip().onChange(set("moveDelayMs")));
      }
    });

    this.renderSection(containerEl, "Effects", (body) => {
      new Setting(body).setName("Popping Letters")
        .addToggle((toggle) => toggle.setValue(get("popLetters")).onChange(setAndRedraw("popLetters")));
      if (get("popLetters")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Rainbow")
          .setDesc("Colors each popping letter a different color, sweeping around the rainbow as you type.")
          .addToggle((toggle) => toggle.setValue(get("popRainbow")).onChange(set("popRainbow")));
      }

      new Setting(body).setName("Pixel Trail")
        .addToggle((toggle) => toggle.setValue(get("flameTrail")).onChange(setAndRedraw("flameTrail")));
      if (get("flameTrail")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Backspace Disintegration")
          .addToggle((toggle) => toggle.setValue(get("backspaceDisintegrate")).onChange(set("backspaceDisintegrate")));
      }

      new Setting(body).setName("Motion Smear")
        .addToggle((toggle) => toggle.setValue(get("smear")).onChange(setAndRedraw("smear")));
      if (get("smear")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Stiffness")
          .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(get("smearStiffness")).setDynamicTooltip().onChange(set("smearStiffness")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Trailing Stiffness")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("smearTrailingStiffness")).setDynamicTooltip().onChange(set("smearTrailingStiffness")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Damping")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("smearDamping")).setDynamicTooltip().onChange(set("smearDamping")));
      }

      new Setting(body).setName("Energy Beam")
        .addToggle((toggle) => toggle.setValue(get("energyEffect")).onChange(setAndRedraw("energyEffect")));
      if (get("energyEffect")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Beam Speed")
          .addSlider((s) => s.setLimits(0.2, 3, 0.1).setValue(get("energySpeed")).setDynamicTooltip().onChange(set("energySpeed")));
      }

      new Setting(body).setName("CRT Effect")
        .addToggle((toggle) => toggle.setValue(get("crtEffect")).onChange(setAndRedraw("crtEffect")));
      if (get("crtEffect")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Trail Length")
          .addSlider((s) => s.setLimits(0, 30, 1).setValue(get("trailLength")).setDynamicTooltip().onChange(set("trailLength")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Trail Fade Time")
          .addSlider((s) => s.setLimits(50, 1500, 25).setValue(get("trailFadeMs")).setDynamicTooltip().onChange(set("trailFadeMs")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Glow")
          .addToggle((toggle) => toggle.setValue(get("glow")).onChange(set("glow")));
      }

      new Setting(body).setName("Speed Demon")
        .addToggle((toggle) => toggle.setValue(get("speedDemon")).onChange(setAndRedraw("speedDemon")));
      if (get("speedDemon")) {
        new Setting(body).setClass("cursor-smith-indent-1").setName("Fire Sparks")
          .addToggle((toggle) => toggle.setValue(get("speedDemonSparks")).onChange(setAndRedraw("speedDemonSparks")));
        if (get("speedDemonSparks")) {
          new Setting(body).setClass("cursor-smith-indent-2").setName("Spark Quantity")
            .setDesc("How many embers spawn per burst. 0 stops sparks without turning Fire Sparks off; higher throws a heavier shower.")
            .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(get("speedDemonSparkQuantity") ?? 1).setDynamicTooltip().onChange(set("speedDemonSparkQuantity")));
          new Setting(body).setClass("cursor-smith-indent-2").setName("Spark Trail")
            .setDesc("Gives each spark a fading comet tail, in pixels. 0 = no trail.")
            .addSlider((s) => s.setLimits(0, 30, 1).setValue(get("speedDemonSparkTrail") ?? 0).setDynamicTooltip().onChange(set("speedDemonSparkTrail")));
        }
        new Setting(body).setClass("cursor-smith-indent-1").setName("Sensitivity")
          .addSlider((s) => s.setLimits(0.5, 2, 0.1).setValue(get("speedDemonSensitivity")).setDynamicTooltip().onChange(set("speedDemonSensitivity")));
      }

      renderTorchToggleSetting(body);
      if (get("torchEffect")) {
        this.renderSubheading(body, "Spotlight");
        new Setting(body).setClass("cursor-smith-indent-1").setName("Follow")
          .addDropdown((d) => d.addOptions({ caret: "Text Cursor Only", mouse: "Mouse Pointer Only", auto: "Auto Intelligent Swap" })
            .setValue(get("overlayFollowMode")).onChange(set("overlayFollowMode")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Light Size")
          .addSlider((s) => s.setLimits(100, 800, 10).setValue(get("overlayRadius")).setDynamicTooltip().onChange(set("overlayRadius")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Light Color")
          .addColorPicker((cp) => cp.setValue(get("overlayColor")).onChange(set("overlayColor")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Follow Speed")
          .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(get("overlaySpeed")).setDynamicTooltip().onChange(set("overlaySpeed")));

        this.renderSubheading(body, "Environment");
        new Setting(body).setClass("cursor-smith-indent-1").setName("Darkness")
          .addSlider((s) => s.setLimits(0.2, 1, 0.01).setValue(get("overlayDarkness")).setDynamicTooltip().onChange(set("overlayDarkness")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Glow Strength")
          .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(get("overlayIntensity")).setDynamicTooltip().onChange(set("overlayIntensity")));
        new Setting(body).setClass("cursor-smith-indent-1").setName("Keep Sidebars Lit")
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
      new Setting(containerEl).setClass("cursor-smith-indent-1")
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
          .addDropdown((d) =>
            d.addOption("Box", "Box").addOption("Line", "Line").addOption("Underline", "Underline")
              .setValue(target.cursorStyle).onChange(setR("cursorStyle"))
          );
      },
      renderTorchToggleSetting: (body) => {
        new Setting(body).setName("Torch Spotlight")
          .addToggle((t) => t.setValue(target.torchEffect).onChange(setR("torchEffect")));
      },
    });
  }
}
/* nosourcemap */

