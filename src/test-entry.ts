// The surface the test suite reaches into, built with obsidian replaced
// by test/obsidian-stub.ts (see esbuild.config.mjs). Same names as the
// working bundle's harness exposes.
import CursorSmithPlugin from "./plugin";
import { CursorSmithSettingTab } from "./settings/settings-tab";
import { Modal, Notice } from "obsidian";
import { setSettingClass, restoreSettingClass } from "../test/obsidian-stub";
import { DEMO_CYCLES, idleAt as demoIdleAt, heatColor as demoHeatColor, initialState as demoInitialState, shapeOf as demoShapeOf, step as demoStep, stepScript as demoStepScript, scriptFor, SCRIPT_LINES, SCRIPT_MAX, DemoStrip, glide as demoGlide, geometryOf as demoGeometryOf, blinkReal as demoBlinkReal } from "./settings/demo";
import { GLYPH_MIN_CONTRAST, contrastRatio, hslToRgbTuple, parseColorTuple, readableGlyphColor, relLuminance, thunderColorAt, thunderRamp } from "./util/color";
import { CANVAS_REGION_GRID, CANVAS_REGION_MARGIN_X, CARET_COVERS, CANVAS_REGION_MOTION_PAD, CANVAS_REGION_SHRINK_MS, CARET_STATE_FIELDS, CARET_STYLE_TTL_MS, INPUT_HOT_MS, DEVICE_ENABLED_KEY, SCROLL_LOCK_MS, FIREWORK_ALPHA, FIREWORK_CELL, FIREWORK_FALL_MS, FIREWORK_GRAVITY, FIREWORK_MAX_LIVE, FIREWORK_MIN_GAP_MS, FIREWORK_PALETTE_MAX, FIREWORK_PRESSURE, FIREWORK_RISE_MS, FIREWORK_SECOND_MAX, FIREWORK_SECOND_SPARKS, FIREWORK_SPARK_BUDGET, FIREWORK_SPARK_MIN, FIREWORK_TRAIL_LEN, FIREWORK_TWINKLE_AT, FRAME_CAPS, GEOMETRY_TTL_MS, GLIDE_LINEAR_SPAN, GLOW_HEAT_GAIN, SECONDARY_FULL_MAX, SMEAR_SETTLE_V, SPEED_RAMP_LIFTOFF, STARDUST_MAX_PER_CARET, TORCH_CANVAS_SCALE, TORCH_FLICKER_WEIGHTS } from "./constants";
import { FLAME_INITIAL_VELOCITY, FLAME_MAX_NUM, HOT_HEAD_JITTER_DOWN, HOT_HEAD_JITTER_UP, HOT_HEAD_LIFT, HOT_START_CONE, HOT_SWAY_CW, HOT_TRAIL_PATH_MAX } from "./effects/fire";
import { fitCanvasRegion, wrapperClipForStatusBar } from "./util/geometry";
import { REDUCED_MOTION_OFF_KEYS, applyReducedMotion, blinkAlphaAt, blinkSegments, easeInOutSine, torchFlickerScale, smoothCatchRate, smoothTypingRate } from "./util/motion";
import { classifySoundEdit, keyPan, soundPan, soundVolumeGain, soundMachine, soundTakes, soundOnset, soundBytes, typebarOf, SOUND_GAIN, ATOM_NAMES, TYPEWRITER_ATOMS, KEYBOARD_ATOMS, DEFAULT_SOUND_MACHINE } from "./sound/sound";
import { SOUND_MACHINES } from "./sound/samples";
import { DEFAULT_PRESETS, DEFAULT_PRESET_NAME, PRESET1_VIM_MODES, SUPERSEDED_PRESETS, applyStarterPreset, seedPresets } from "./settings/presets";
import { DEFAULT_SETTINGS, LOOK_KEYS, migrateLegacyKeys, pickLook, presetWithDefaults, soundsApart } from "./settings/settings";
import { codeToPreset, codeToVimPreset, presetToCode } from "./settings/share";
import { blockLineInfo, isBlockquoteMarker } from "./util/text";
import { paintTorchDarkness, paintTorchGlow, torchCanvasContext } from "./torch/torch-paint";
import { ROLL_EFFECTS, ROLL_TOGGLES, rollAllowed, rollLook, seededRandom } from "./settings/randomize";

export const __test = {
  CANVAS_REGION_GRID, CANVAS_REGION_MARGIN_X, CARET_COVERS, CANVAS_REGION_MOTION_PAD, CANVAS_REGION_SHRINK_MS, CARET_STATE_FIELDS, CARET_STYLE_TTL_MS, INPUT_HOT_MS, DEVICE_ENABLED_KEY, SCROLL_LOCK_MS, soundsApart, keyPan, TYPEWRITER_ATOMS, KEYBOARD_ATOMS, rollLook, seededRandom, ROLL_EFFECTS, DEFAULT_PRESETS, DEFAULT_PRESET_NAME, DEFAULT_SETTINGS, SUPERSEDED_PRESETS, FIREWORK_ALPHA, FIREWORK_CELL, FIREWORK_FALL_MS, FIREWORK_GRAVITY, FIREWORK_MAX_LIVE, FIREWORK_MIN_GAP_MS, FIREWORK_PALETTE_MAX, FIREWORK_PRESSURE, FIREWORK_RISE_MS, FIREWORK_SECOND_MAX, FIREWORK_SECOND_SPARKS, FIREWORK_SPARK_BUDGET, FIREWORK_SPARK_MIN, FIREWORK_TRAIL_LEN, FIREWORK_TWINKLE_AT, FLAME_INITIAL_VELOCITY, FLAME_MAX_NUM, FRAME_CAPS, GEOMETRY_TTL_MS, GLIDE_LINEAR_SPAN, GLOW_HEAT_GAIN, GLYPH_MIN_CONTRAST, HOT_HEAD_JITTER_DOWN, HOT_HEAD_JITTER_UP, HOT_HEAD_LIFT, HOT_START_CONE, HOT_SWAY_CW, HOT_TRAIL_PATH_MAX, LOOK_KEYS, PRESET1_VIM_MODES, REDUCED_MOTION_OFF_KEYS, SECONDARY_FULL_MAX, SMEAR_SETTLE_V, SPEED_RAMP_LIFTOFF, STARDUST_MAX_PER_CARET, TORCH_CANVAS_SCALE, TORCH_FLICKER_WEIGHTS, applyReducedMotion, applyStarterPreset, seedPresets, classifySoundEdit, soundPan, soundVolumeGain, soundMachine, soundTakes, soundOnset, soundBytes, typebarOf, SOUND_GAIN, ATOM_NAMES, DEFAULT_SOUND_MACHINE, SOUND_MACHINES, blinkAlphaAt, blinkSegments, blockLineInfo, codeToPreset, codeToVimPreset, contrastRatio, easeInOutSine, fitCanvasRegion, hslToRgbTuple, isBlockquoteMarker, migrateLegacyKeys, paintTorchDarkness, paintTorchGlow, parseColorTuple, pickLook, presetToCode, presetWithDefaults, readableGlyphColor, relLuminance, thunderColorAt, thunderRamp, torchCanvasContext, torchFlickerScale, wrapperClipForStatusBar,
  Notice, Modal, setSettingClass, restoreSettingClass,
  smoothCatchRate, smoothTypingRate,
  demoStep, demoInitialState, demoHeatColor, demoShapeOf, DEMO_CYCLES, demoIdleAt, demoStepScript, scriptFor, SCRIPT_LINES, SCRIPT_MAX, DemoStrip, ROLL_TOGGLES, rollAllowed, demoGlide, demoGeometryOf, demoBlinkReal,
  EngineProto: CursorSmithPlugin.prototype,
  SettingTabPrototype: CursorSmithSettingTab.prototype,
};
export default CursorSmithPlugin;
