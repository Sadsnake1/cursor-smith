import { DEFAULT_SETTINGS, cloneVimModes, presetWithDefaults } from "./settings";
import type { CursorSmithSettings, Look } from "./types";

// Starter per-mode looks seeded into new installs. Each lists only what it
// changes from the global defaults; fullVimMode() fills in the rest. They
// double as a showcase — every mode looks distinctly different.
export const VIM_MODE_STARTERS: Record<string, Partial<Look>> = {
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
export const PRESET1_VIM_MODES = {
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
export const DEFAULT_PRESETS = {
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
  }
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
export const DEFAULT_PRESET_NAME = "Jell-O";

// Point a fresh install's live settings at the starter preset, in place.
// Returns whether it found one to apply.
//
// Reads out of settings.userPresets rather than DEFAULT_PRESETS directly, so
// the live look and the preset entry are guaranteed to be the same snapshot -
// the same reasoning that sets vimActivePreset to "Preset1" in onload(). Call
// it AFTER the preset-seeding loop.
export function applyStarterPreset(settings: CursorSmithSettings) {
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
export const DEFAULT_VIM_PRESETS = {
  "Preset1": PRESET1_VIM_MODES,
};
