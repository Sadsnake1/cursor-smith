// The surface the test suite reaches into, built with obsidian replaced
// by test/obsidian-stub.ts (see esbuild.config.mjs). Same names as the
// working bundle's harness exposes.
import { AURORA_BUDGET } from "./paint/paint-energy";
import CursorSmithPlugin from "./plugin";
import { CursorSmithSettingTab } from "./settings/settings-tab";
import { Modal, Notice } from "obsidian";
import { setSettingClass, restoreSettingClass } from "../test/obsidian-stub";
import { cardScript, SCRIPT_BACK_MS, idleAt as demoIdleAt, heatColor as demoHeatColor, initialState as demoInitialState, shapeOf as demoShapeOf, step as demoStep, stepScript as demoStepScript, scriptFor, vimScriptFor, VIM_LINES, SCRIPT_LINES, SCRIPT_MAX, READ_SCALE, READ_FEW, readableChars, DemoStrip, glide as demoGlide, geometryOf as demoGeometryOf, blinkReal as demoBlinkReal } from "./settings/demo";
import { GLYPH_MIN_CONTRAST, capsColor, cssAlpha, hueTurn, contrastRatio, hslToRgbTuple, parseColorTuple, readableGlyphColor, relLuminance, thunderColorAt, thunderRamp } from "./util/color";
import { CANVAS_REGION_GRID, CANVAS_REGION_MARGIN_X, CARET_COVERS, ZEN_STRIP, CANVAS_REGION_MOTION_PAD, CANVAS_REGION_SHRINK_MS, CARET_STATE_FIELDS, CARET_STYLE_TTL_MS, INPUT_HOT_MS, DEVICE_ENABLED_KEY, SCROLL_LOCK_MS, FIREWORK_ALPHA, FIREWORK_CELL, FIREWORK_FALL_MS, FIREWORK_GRAVITY, FIREWORK_MAX_LIVE, FIREWORK_MIN_GAP_MS, FIREWORK_PALETTE_MAX, FIREWORK_PRESSURE, FIREWORK_RISE_MS, FIREWORK_SECOND_MAX, FIREWORK_SECOND_SPARKS, FIREWORK_SPARK_BUDGET, FIREWORK_SPARK_MIN, FIREWORK_TRAIL_LEN, FIREWORK_TWINKLE_AT, FRAME_CAPS, GEOMETRY_TTL_MS, GLIDE_LINEAR_SPAN, GLOW_HEAT_GAIN, SECONDARY_FULL_MAX, SMEAR_SETTLE_V, SPEED_RAMP_LIFTOFF, STARDUST_MAX_PER_CARET, TORCH_CANVAS_SCALE, TORCH_FLICKER_WEIGHTS } from "./constants";
import { FLAME_INITIAL_VELOCITY, HOT_TYPE_KICK, HOT_TYPE_TAU_MS, HOT_TYPE_FLOOR, HOT_ENGULF_RATE, HOT_ENGULF_MS, hotTypeAt, hotTypeKicked, hotTypeShare, FLAME_MAX_NUM, HOT_HEAD_JITTER_DOWN, HOT_HEAD_JITTER_UP, HOT_HEAD_LIFT, HOT_START_CONE, HOT_SWAY_CW, HOT_TRAIL_PATH_MAX } from "./effects/fire";
import { fitCanvasRegion, wrapperClipForStatusBar } from "./util/geometry";
import { REDUCED_MOTION_OFF_KEYS, applyReducedMotion, blinkAlphaAt, blinkSegments, easeInOutSine, torchFlickerScale, smoothCatchRate, smoothTypingRate } from "./util/motion";
import { classifySoundEdit, keyPan, soundPan, soundVolumeGain, soundMachine, soundTakes, soundOnset, soundBytes, typebarOf, SOUND_GAIN, ATOM_NAMES, TYPEWRITER_ATOMS, KEYBOARD_ATOMS, DEFAULT_SOUND_MACHINE } from "./sound/sound";
import { SOUND_MACHINES } from "./sound/samples";
import { DEFAULT_PRESETS, DEFAULT_PRESET_NAME, PRESET1_VIM_MODES, SUPERSEDED_PRESETS, applyStarterPreset, seedPresets } from "./settings/presets";
import { DEFAULT_SETTINGS, LOOK_KEYS, migrateLegacyKeys, pickLook, presetWithDefaults, soundsApart } from "./settings/settings";
import { codeToPreset, codeToVimPreset, presetToCode } from "./settings/share";
import { blockLineInfo, isBlockquoteMarker } from "./util/text";
import { paintTorchDarkness, paintTorchGlow, torchCanvasContext } from "./torch/torch-paint";
import { ROLL_EFFECTS, ROLL_TOGGLES, rollAllowed, rollLook, rollVimLooks, VIM_SHAPES, VIM_COLOR_KEYS, seededRandom } from "./settings/randomize";
import { EATER_IN_MS, EATER_OUT_MS, eaterForm, eaterMorph, eaterOf, EATER_TRAIL_ALPHA, EATER_TRAIL_CW, EATER_TRAIL_MS, eaterPathPoint, eaterTrailRuns, eaterPathAge, eaterTrailAlpha, lerpRect } from "./effects/effects-eaters";
import { whenAllows, dialToRoll, ROLL_CHAOS_MAX, ROLL_DIAL_MAX } from "./settings/settings";
import { EATER_KEYS, LETTER_KEYS, eaterChoiceOf, letterChoiceOf } from "./settings/settings";
import { SHRED_FEED_MS, SHRED_FALL_MS, SHRED_HOLD_MS, SHRED_RIBBONS, shredBlades, shredDash, shredFeed } from "./effects/effects-shredder";
import { HOLE_FALL_MS, HOLE_KICK, HOLE_SAG, HOLE_STRETCH, holeFall, holeOutline, holeSpring } from "./effects/effects-rabbithole";
import { CAPS_GROW, DELETE_INVERT_MS, capsEase, capsKeys, capsScale } from "./effects/effects-caps";
import { underSerifSize } from "./paint/paint-shape";
import { BACKMAN_BEND_KICK, BACKMAN_BEND_MAX, BACKMAN_CHOMP_MS, BACKMAN_GROW, BACKMAN_GULP_MS, BACKMAN_HOLD_MS, backManBite, backManChew, backManDown, backManEye, backManEyeEase, backManOutline, backManShape, backManSpring, BACKMAN_BIG } from "./effects/effects-backman";

export const __test = {
  AURORA_BUDGET, CANVAS_REGION_GRID, CANVAS_REGION_MARGIN_X, CARET_COVERS, ZEN_STRIP, CANVAS_REGION_MOTION_PAD, CANVAS_REGION_SHRINK_MS, CARET_STATE_FIELDS, CARET_STYLE_TTL_MS, INPUT_HOT_MS, DEVICE_ENABLED_KEY, SCROLL_LOCK_MS, backManShape, backManSpring, BACKMAN_BIG, EATER_IN_MS, EATER_OUT_MS, eaterForm, eaterMorph, eaterOf, EATER_TRAIL_ALPHA, EATER_TRAIL_CW, EATER_TRAIL_MS, eaterPathPoint, eaterTrailRuns, eaterPathAge, eaterTrailAlpha, lerpRect, EATER_KEYS, LETTER_KEYS, eaterChoiceOf, letterChoiceOf, SHRED_FEED_MS, SHRED_FALL_MS, SHRED_HOLD_MS, SHRED_RIBBONS, shredBlades, shredDash, shredFeed, HOLE_FALL_MS, HOLE_KICK, HOLE_SAG, HOLE_STRETCH, holeFall, holeSpring, holeOutline, cssAlpha, whenAllows, dialToRoll, ROLL_CHAOS_MAX, ROLL_DIAL_MAX, CAPS_GROW, DELETE_INVERT_MS, capsEase, capsKeys, capsScale, capsColor, hueTurn, underSerifSize, backManChew, backManDown, backManBite, backManEye, backManEyeEase, backManOutline, BACKMAN_GULP_MS, BACKMAN_BEND_KICK, BACKMAN_BEND_MAX, BACKMAN_GROW, BACKMAN_HOLD_MS, BACKMAN_CHOMP_MS, soundsApart, keyPan, TYPEWRITER_ATOMS, KEYBOARD_ATOMS, rollLook, rollVimLooks, VIM_SHAPES, VIM_COLOR_KEYS, seededRandom, ROLL_EFFECTS, DEFAULT_PRESETS, DEFAULT_PRESET_NAME, DEFAULT_SETTINGS, SUPERSEDED_PRESETS, FIREWORK_ALPHA, FIREWORK_CELL, FIREWORK_FALL_MS, FIREWORK_GRAVITY, FIREWORK_MAX_LIVE, FIREWORK_MIN_GAP_MS, FIREWORK_PALETTE_MAX, FIREWORK_PRESSURE, FIREWORK_RISE_MS, FIREWORK_SECOND_MAX, FIREWORK_SECOND_SPARKS, FIREWORK_SPARK_BUDGET, FIREWORK_SPARK_MIN, FIREWORK_TRAIL_LEN, FIREWORK_TWINKLE_AT, FLAME_INITIAL_VELOCITY, HOT_TYPE_KICK, HOT_TYPE_TAU_MS, HOT_TYPE_FLOOR, HOT_ENGULF_RATE, HOT_ENGULF_MS, hotTypeAt, hotTypeKicked, hotTypeShare, FLAME_MAX_NUM, FRAME_CAPS, GEOMETRY_TTL_MS, GLIDE_LINEAR_SPAN, GLOW_HEAT_GAIN, GLYPH_MIN_CONTRAST, HOT_HEAD_JITTER_DOWN, HOT_HEAD_JITTER_UP, HOT_HEAD_LIFT, HOT_START_CONE, HOT_SWAY_CW, HOT_TRAIL_PATH_MAX, LOOK_KEYS, PRESET1_VIM_MODES, REDUCED_MOTION_OFF_KEYS, SECONDARY_FULL_MAX, SMEAR_SETTLE_V, SPEED_RAMP_LIFTOFF, STARDUST_MAX_PER_CARET, TORCH_CANVAS_SCALE, TORCH_FLICKER_WEIGHTS, applyReducedMotion, applyStarterPreset, seedPresets, classifySoundEdit, soundPan, soundVolumeGain, soundMachine, soundTakes, soundOnset, soundBytes, typebarOf, SOUND_GAIN, ATOM_NAMES, DEFAULT_SOUND_MACHINE, SOUND_MACHINES, blinkAlphaAt, blinkSegments, blockLineInfo, codeToPreset, codeToVimPreset, contrastRatio, easeInOutSine, fitCanvasRegion, hslToRgbTuple, isBlockquoteMarker, migrateLegacyKeys, paintTorchDarkness, paintTorchGlow, parseColorTuple, pickLook, presetToCode, presetWithDefaults, readableGlyphColor, relLuminance, thunderColorAt, thunderRamp, torchCanvasContext, torchFlickerScale, wrapperClipForStatusBar,
  Notice, Modal, setSettingClass, restoreSettingClass,
  smoothCatchRate, smoothTypingRate,
  demoStep, demoInitialState, demoHeatColor, demoShapeOf, cardScript, SCRIPT_BACK_MS, demoIdleAt, demoStepScript, scriptFor, vimScriptFor, VIM_LINES, SCRIPT_LINES, SCRIPT_MAX, READ_SCALE, READ_FEW, readableChars, DemoStrip, ROLL_TOGGLES, rollAllowed, demoGlide, demoGeometryOf, demoBlinkReal,
  EngineProto: CursorSmithPlugin.prototype,
  SettingTabPrototype: CursorSmithSettingTab.prototype,
};
export default CursorSmithPlugin;
