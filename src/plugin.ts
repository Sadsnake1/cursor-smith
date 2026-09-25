import { Plugin, View, addIcon } from "obsidian";
import { CARET_STATE_FIELDS, WATCHDOG_INTERVAL_MS, keystrokeHeatWeight, DEVICE_ENABLED_KEY } from "./constants";
import { applyReducedMotion } from "./motion";
import { DEFAULT_PRESETS, DEFAULT_PRESET_NAME, DEFAULT_VIM_PRESETS, applyStarterPreset } from "./presets";
import { DEFAULT_SETTINGS, VIM_MODE_KEYS, cloneVimModes, migrateLegacyKeys, pickLook } from "./settings";
import { CursorSmithSettingTab } from "./settings-tab";
import type { EditorView } from "@codemirror/view";
import type {
  Bounds,
  BurnMark,
  CaretCoords,
  CaretGeoCache,
  CaretRecord,
  CaretState,
  CaretStyleCache,
  ChromeInsets,
  CursorSmithSettings,
  EffCache,
  Ember,
  Firework,
  FlamePixel,
  Glitch,
  HotScroll,
  SelectionSig,
  HotShift,
  LegacySettings,
  LetterParticle,
  Look,
  PaneRectCache,
  MainRectCache,
  Box,
  PerfCounters,
  Pt,
  Quad,
  Rect,
  SettingKey,
  SmearQuad,
  StardustMote,
  TetherSeg,
  Thunderbolt,
  TrailPoint,
} from "./types";

import { measureMethods } from "./measure";
import { effectsMethods } from "./effects";
import { paintMethods } from "./paint";
import { torchMethods } from "./torch";
import type { MeasureMethods } from "./measure";
import type { EffectsMethods } from "./effects";
import type { PaintMethods } from "./paint";
import type { TorchMethods } from "./torch";

// The class is in nine files. The eight modules above hold its methods by
// responsibility - measuring, effects, painting, the torch (the first
// split), the preset library, Vim mode, the canvas engine with its frame
// loop, the carets with their motion (the second) - as functions with an
// explicit `this`, assigned onto the prototype at the end of this file and
// declared on the class below (`declare` emits nothing; it is the type),
// so `this.drawBoxCursor()` is one call and one type in every file. What
// stays in this file: the fields, the lifecycle (onload, the window and
// document registrations, enable / disable), settings and the look, the
// body classes, and the state reset.
//
// Declared one by one rather than through a class/interface merge, which
// the review's linter refuses as unsafe, or a mixin base, which TypeScript
// only types through `any[]`. The list is also the map of what is where.
// Lucide Lab's candlestick-big-lit (https://lucide.dev/icons/lab/candlestick-big-lit),
// as Obsidian's addIcon takes it.
const CANDLE_ICON = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 2S9 5.3 9 7s1.3 3 3 3 3-1.3 3-3-3-5-3-5"/>
<path d="M16 22H8v-7c0-.6.4-1 1-1h6c.6 0 1 .4 1 1Z"/>
<path d="M12 14v3"/>
<path d="M17 17s-.7-1.4-1.1-2.4"/>
</g>`;

import { libraryMethods } from "./library";
import { vimMethods } from "./vim";
import { engineMethods } from "./engine";
import { caretsMethods } from "./carets";
import type { LibraryMethods } from "./library";
import type { VimMethods } from "./vim";
import type { EngineMethods } from "./engine";
import type { CaretsMethods } from "./carets";

export default class CursorSmithPlugin extends Plugin {
  // measure.ts
  declare caretCoords: MeasureMethods["caretCoords"];
  declare cmCaretCoords: MeasureMethods["cmCaretCoords"];
  declare secondaryCaretCoords: MeasureMethods["secondaryCaretCoords"];
  declare secondaryCaretRecord: MeasureMethods["secondaryCaretRecord"];
  declare selectionFallbackCoords: MeasureMethods["selectionFallbackCoords"];
  declare adjacentCharRect: MeasureMethods["adjacentCharRect"];
  declare _nodeKey: MeasureMethods["_nodeKey"];
  declare genericCaretPos: MeasureMethods["genericCaretPos"];
  declare genericCaretCoords: MeasureMethods["genericCaretCoords"];
  declare fontString: MeasureMethods["fontString"];
  declare measureCharWidth: MeasureMethods["measureCharWidth"];
  declare genericCaretChar: MeasureMethods["genericCaretChar"];
  declare resolveHoldChar: MeasureMethods["resolveHoldChar"];
  declare isExcalidrawCaretHost: MeasureMethods["isExcalidrawCaretHost"];
  declare noteEditorFocused: MeasureMethods["noteEditorFocused"];
  declare _isVisiblyRendered: MeasureMethods["_isVisiblyRendered"];
  declare _chromeInsets: MeasureMethods["_chromeInsets"];
  declare getFullViewportRect: MeasureMethods["getFullViewportRect"];
  declare getCaretClipRect: MeasureMethods["getCaretClipRect"];
  declare _resolveClipChain: MeasureMethods["_resolveClipChain"];
  declare getPaneRect: MeasureMethods["getPaneRect"];
  declare getMainAreaRect: MeasureMethods["getMainAreaRect"];
  declare getNoteTabRects: MeasureMethods["getNoteTabRects"];
  declare _mainArea: MeasureMethods["_mainArea"];
  declare _paneRectFrom: MeasureMethods["_paneRectFrom"];
  declare getActiveRect: MeasureMethods["getActiveRect"];
  declare lineSpan: MeasureMethods["lineSpan"];
  declare caretThickness: MeasureMethods["caretThickness"];
  declare renderWidth: MeasureMethods["renderWidth"];
  declare underlineThickness: MeasureMethods["underlineThickness"];
  // effects.ts
  declare hotSyncScroll: EffectsMethods["hotSyncScroll"];
  declare updateHotHeadInertia: EffectsMethods["updateHotHeadInertia"];
  declare hotHeadFeeding: EffectsMethods["hotHeadFeeding"];
  declare _hotFeedingAt: EffectsMethods["_hotFeedingAt"];
  declare maybeSpawnHotHead: EffectsMethods["maybeSpawnHotHead"];
  declare maybeSpawnSpeedDemonSparks: EffectsMethods["maybeSpawnSpeedDemonSparks"];
  declare stardustArmed: EffectsMethods["stardustArmed"];
  declare maybeSpawnStardust: EffectsMethods["maybeSpawnStardust"];
  declare pushTrail: EffectsMethods["pushTrail"];
  declare spawnLetterParticle: EffectsMethods["spawnLetterParticle"];
  declare flamePixelColor: EffectsMethods["flamePixelColor"];
  declare spawnFlamePixels: EffectsMethods["spawnFlamePixels"];
  declare spawnGlitch: EffectsMethods["spawnGlitch"];
  declare glitchState: EffectsMethods["glitchState"];
  declare paintGlitchRect: EffectsMethods["paintGlitchRect"];
  declare spawnJumpTrail: EffectsMethods["spawnJumpTrail"];
  declare nextRainbowHue: EffectsMethods["nextRainbowHue"];
  declare fireworkSparkRGB: EffectsMethods["fireworkSparkRGB"];
  declare _liveSparkCount: EffectsMethods["_liveSparkCount"];
  declare spawnFireworks: EffectsMethods["spawnFireworks"];
  declare drawFireworks: EffectsMethods["drawFireworks"];
  declare spawnThunderbolt: EffectsMethods["spawnThunderbolt"];
  declare boltPath: EffectsMethods["boltPath"];
  declare pixelateBolt: EffectsMethods["pixelateBolt"];
  declare drawThunderbolts: EffectsMethods["drawThunderbolts"];
  declare pruneTrail: EffectsMethods["pruneTrail"];
  declare trailPaint: EffectsMethods["trailPaint"];
  declare drawNeonGhost: EffectsMethods["drawNeonGhost"];
  declare drawLettersParticles: EffectsMethods["drawLettersParticles"];
  declare drawFlamePixels: EffectsMethods["drawFlamePixels"];
  declare hotFireColor: EffectsMethods["hotFireColor"];
  declare drawHotHead: EffectsMethods["drawHotHead"];
  declare drawStardust: EffectsMethods["drawStardust"];
  declare paintMote: EffectsMethods["paintMote"];
  // paint.ts
  declare getActiveColor: PaintMethods["getActiveColor"];
  declare getBaseColor: PaintMethods["getBaseColor"];
  declare isDarkTheme: PaintMethods["isDarkTheme"];
  declare gradientStops: PaintMethods["gradientStops"];
  declare sampleRamp: PaintMethods["sampleRamp"];
  declare createCursorGradient: PaintMethods["createCursorGradient"];
  declare cursorPaint: PaintMethods["cursorPaint"];
  declare glowHeatScale: PaintMethods["glowHeatScale"];
  declare speedHeatStops: PaintMethods["speedHeatStops"];
  declare sampleHeatRamp: PaintMethods["sampleHeatRamp"];
  declare heatColor: PaintMethods["heatColor"];
  declare blinkPhase: PaintMethods["blinkPhase"];
  declare blinkWindow: PaintMethods["blinkWindow"];
  declare blinkAlpha: PaintMethods["blinkAlpha"];
  declare breathScale: PaintMethods["breathScale"];
  declare _cursorBounds: PaintMethods["_cursorBounds"];
  declare draw: PaintMethods["draw"];
  declare cornerRadius: PaintMethods["cornerRadius"];
  declare traceQuad: PaintMethods["traceQuad"];
  declare cursorCorners: PaintMethods["cursorCorners"];
  declare fillCursorShape: PaintMethods["fillCursorShape"];
  declare traceRoundedRect: PaintMethods["traceRoundedRect"];
  declare fillTrailRect: PaintMethods["fillTrailRect"];
  declare energyPaint: PaintMethods["energyPaint"];
  declare auroraPattern: PaintMethods["auroraPattern"];
  declare createEnergyGradient: PaintMethods["createEnergyGradient"];
  declare serifQuads: PaintMethods["serifQuads"];
  declare drawGenericCaret: PaintMethods["drawGenericCaret"];
  declare _paintTrail: PaintMethods["_paintTrail"];
  declare _armGlow: PaintMethods["_armGlow"];
  declare _glitchNow: PaintMethods["_glitchNow"];
  declare _bodyPaint: PaintMethods["_bodyPaint"];
  declare drawSecondaryCarets: PaintMethods["drawSecondaryCarets"];
  declare drawFullSecondaries: PaintMethods["drawFullSecondaries"];
  declare matchingBracketPos: PaintMethods["matchingBracketPos"];
  declare isQuoteMarkerAt: PaintMethods["isQuoteMarkerAt"];
  declare lineBoundsAt: PaintMethods["lineBoundsAt"];
  declare quoteSpanAt: PaintMethods["quoteSpanAt"];
  declare enclosingBracketSpan: PaintMethods["enclosingBracketSpan"];
  declare crossesBlockBoundary: PaintMethods["crossesBlockBoundary"];
  declare tetherSpan: PaintMethods["tetherSpan"];
  declare bracketTetherCoords: PaintMethods["bracketTetherCoords"];
  declare tetherSegments: PaintMethods["tetherSegments"];
  declare rangeLineRects: PaintMethods["rangeLineRects"];
  declare tetherStroke: PaintMethods["tetherStroke"];
  declare drawBracketTether: PaintMethods["drawBracketTether"];
  declare mergeTethers: PaintMethods["mergeTethers"];
  declare applyCanvasBlend: PaintMethods["applyCanvasBlend"];
  declare drawBoxCursor: PaintMethods["drawBoxCursor"];
  declare updateSmearQuad: PaintMethods["updateSmearQuad"];
  declare applySmearMaxLength: PaintMethods["applySmearMaxLength"];
  declare applySmearVolume: PaintMethods["applySmearVolume"];
  declare applySmearTaper: PaintMethods["applySmearTaper"];
  declare smearCorners: PaintMethods["smearCorners"];
  declare _smearSig: PaintMethods["_smearSig"];
  // torch.ts
  declare torchPossible: TorchMethods["torchPossible"];
  declare applyOverlayStyle: TorchMethods["applyOverlayStyle"];
  declare ensureTorchOverlayForView: TorchMethods["ensureTorchOverlayForView"];
  declare _torchLocalRegions: TorchMethods["_torchLocalRegions"];
  declare _torchPaintDarkness: TorchMethods["_torchPaintDarkness"];
  declare _torchPaintGlow: TorchMethods["_torchPaintGlow"];
  declare _ensureGlowLayer: TorchMethods["_ensureGlowLayer"];
  declare disableTorchOverlay: TorchMethods["disableTorchOverlay"];
  declare enableTorchOverlay: TorchMethods["enableTorchOverlay"];
  declare updateOverlayTarget: TorchMethods["updateOverlayTarget"];
  declare torchSpotlights: TorchMethods["torchSpotlights"];
  declare _wakeTorch: TorchMethods["_wakeTorch"];
  declare _drawerOpen: TorchMethods["_drawerOpen"];
  // --- library.ts
  declare getUserPresets: LibraryMethods["getUserPresets"];
  declare saveUserPreset: LibraryMethods["saveUserPreset"];
  declare loadUserPreset: LibraryMethods["loadUserPreset"];
  declare deleteUserPreset: LibraryMethods["deleteUserPreset"];
  declare cycleActivePreset: LibraryMethods["cycleActivePreset"];
  declare cyclePreset: LibraryMethods["cyclePreset"];
  declare importPreset: LibraryMethods["importPreset"];
  declare getVimPresets: LibraryMethods["getVimPresets"];
  declare saveVimPreset: LibraryMethods["saveVimPreset"];
  declare loadVimPreset: LibraryMethods["loadVimPreset"];
  declare deleteVimPreset: LibraryMethods["deleteVimPreset"];
  declare cycleVimPreset: LibraryMethods["cycleVimPreset"];
  declare importVimPreset: LibraryMethods["importVimPreset"];
  // --- vim.ts
  declare isVimUiMode: VimMethods["isVimUiMode"];
  declare toggleUiMode: VimMethods["toggleUiMode"];
  declare setVimModeEnabled: VimMethods["setVimModeEnabled"];
  declare forceVimNormalMode: VimMethods["forceVimNormalMode"];
  declare allEditorViews: VimMethods["allEditorViews"];
  declare setObsidianVim: VimMethods["setObsidianVim"];
  declare isObsidianVimOn: VimMethods["isObsidianVimOn"];
  declare getVimAdapter: VimMethods["getVimAdapter"];
  declare _vimBlockCursorShown: VimMethods["_vimBlockCursorShown"];
  declare detectVimMode: VimMethods["detectVimMode"];
  declare isVimCommandContext: VimMethods["isVimCommandContext"];
  declare currentVimMode: VimMethods["currentVimMode"];
  declare onVimModeChanged: VimMethods["onVimModeChanged"];
  declare statusBarVimMode: VimMethods["statusBarVimMode"];
  declare syncVimStatusBar: VimMethods["syncVimStatusBar"];
  declare updateVimStatusBar: VimMethods["updateVimStatusBar"];
  // --- engine.ts
  declare ensureCanvasForView: EngineMethods["ensureCanvasForView"];
  declare _wrapperHome: EngineMethods["_wrapperHome"];
  declare _removeLayers: EngineMethods["_removeLayers"];
  declare disableCanvasEngine: EngineMethods["disableCanvasEngine"];
  declare enableCanvasEngine: EngineMethods["enableCanvasEngine"];
  declare resizeCanvas: EngineMethods["resizeCanvas"];
  declare _placeCanvas: EngineMethods["_placeCanvas"];
  declare _clearCanvas: EngineMethods["_clearCanvas"];
  declare _frameNeed: EngineMethods["_frameNeed"];
  declare _fitCanvasRegion: EngineMethods["_fitCanvasRegion"];
  declare _frameCaps: EngineMethods["_frameCaps"];
  declare _isAnimating: EngineMethods["_isAnimating"];
  declare _markDirty: EngineMethods["_markDirty"];
  declare forEachTrailPoint: EngineMethods["forEachTrailPoint"];
  declare _invalidateLayout: EngineMethods["_invalidateLayout"];
  declare _invalidateStyle: EngineMethods["_invalidateStyle"];
  declare _markActivity: EngineMethods["_markActivity"];
  declare _hotCapLifted: EngineMethods["_hotCapLifted"];
  declare _observeEditorLayout: EngineMethods["_observeEditorLayout"];
  declare _scrollMovesCaret: EngineMethods["_scrollMovesCaret"];
  declare _selectionMoved: EngineMethods["_selectionMoved"];
  declare _wakeLoop: EngineMethods["_wakeLoop"];
  declare _watchdog: EngineMethods["_watchdog"];
  declare _decideGear: EngineMethods["_decideGear"];
  declare _frameSignature: EngineMethods["_frameSignature"];
  declare performanceReport: EngineMethods["performanceReport"];
  declare _freshPerf: EngineMethods["_freshPerf"];
  declare perfReportText: EngineMethods["perfReportText"];
  // --- carets.ts
  declare _freshCaretState: CaretsMethods["_freshCaretState"];
  declare _withCaret: CaretsMethods["_withCaret"];
  declare rematchCaretStates: CaretsMethods["rematchCaretStates"];
  declare updateSecondaryCarets: CaretsMethods["updateSecondaryCarets"];
  declare _secondariesSig: CaretsMethods["_secondariesSig"];
  declare formFieldCaretCoords: CaretsMethods["formFieldCaretCoords"];
  declare updateActivePoint: CaretsMethods["updateActivePoint"];
  declare updateSmoothCursor: CaretsMethods["updateSmoothCursor"];
  declare commitMove: CaretsMethods["commitMove"];

  // The engine keeps its working state as instance fields set where they
  // are first needed - a hundred and sixty of them, some swapped in and out
  // per caret (see CARET_STATE_FIELDS; accessors over this._caret since
  // 1.5.8, hence `declare`). The generator declares every one of
  // them from the assignments in this class and its FIELD_TYPES table. They
  // are assigned in onload() (most through _resetEngineState) rather than in
  // a constructor, which is what the definite-assignment marks say.
  // The engine's state, declared from _resetEngineState by the generator.
  _activePresetName!: string;
  _appliedVimMode!: string | null;
  _auroraCanvas!: HTMLCanvasElement | null;
  _auroraCtx!: CanvasRenderingContext2D | null;
  _auroraImg!: ImageData | null;
  _auroraLut!: Float32Array | null;
  _canvasBlend!: string;
  _canvasDpr!: number;
  _canvasGear!: string;
  _canvasIdleT!: number;
  _canvasPlaced!: boolean;
  _canvasRect!: Rect | null;
  _canvasTick!: FrameRequestCallback | null;
  // The current caret's state: the primary's object, or a secondary's
  // bundle while _withCaret has it in. Every CARET_STATE_FIELDS field is an
  // accessor over it (the end of this file).
  _caret!: CaretState;
  _caretGeoCache!: CaretGeoCache | null;
  _caretOwner!: CaretState | null;
  _caretPass!: "primary" | "secondary";
  _caretStyleCache!: CaretStyleCache | null;
  declare _catchUpBoost: number;
  _chromeCache!: ChromeInsets | null;
  _clipChain!: Element[] | null;
  _clipChainFor!: Element | null;
  _clipRect!: Rect | null;
  _clipTop!: number;
  _deletePending!: number;
  _dirty!: Bounds | null;
  _dirtyFull!: boolean;
  _dirtyPrev!: Rect | null;
  _dirtyRaw!: Bounds | null;
  _docCleanups!: Map<Document, () => void>;
  _drawSig!: string | null;
  _effCache!: EffCache | null;
  _enterPending!: number;
  _excaliHostFor!: Element | null;
  _excaliHostVal!: boolean;
  _formMirror!: HTMLDivElement | null;
  _glyphColorFor!: string | null;
  _glyphColorMode!: string | null;
  _glyphColorVal!: string;
  // The glyph's measured ascent and descent, per (font, character); drawBoxCursor.
  _glyphMetricKey!: string | null;
  _glyphMetrics!: { ascent: number; descent: number } | null;
  _heatKeyT!: number;
  _hideNativeSig!: boolean | null;
  declare _hotActiveT: number;
  _hotDrawT!: number;
  declare _hotEmitFrom: Pt | null;
  declare _hotEngulfUntil: number;
  // Hot-head's fill strings by (palette index, alpha); see drawHotHead.
  _hotFill!: Map<number, string> | null;
  _hotPalette!: number[][] | null;
  _hotPaletteKey!: string | null;
  // The drawn caret's centre last frame, and the row its mark went on.
  declare _hotPrev: (Pt & { t: number; row?: number }) | null;
  _hotScroll!: HotScroll | null;
  _hotShift!: HotShift | null;
  declare _hotShiftTick: number;
  _hotSparkCap!: number;
  _hotSparks!: number;
  // How long the idle gear may sleep before the blink next moves (schedule
  // reads it; the tick sets it from blinkWindow). 0 or Infinity: the heartbeat.
  _idleWakeMs!: number;
  _lastActivityT!: number;
  // What the last activity was (a key, the selection, a scroll...), for the
  // performance report's "awake because".
  _lastActivityKind!: string;
  // When the frame loop last ran, for the watchdog.
  _lastTickT!: number;
  // The per-device switch (DEVICE_ENABLED_KEY): false only on a device the
  // user switched off; the engines never start while it is false.
  _deviceEnabled!: boolean;
  // When the note's scroller last scrolled (a scroll or wheel event that
  // moves the caret); the frame cap is lifted this close to it.
  _lastScrollT!: number;
  declare _lastFireworkT: number;
  _lastGlowAlpha!: string;
  _lastGlowRect!: string;
  _lastHotFrameT!: number;
  declare _lastHotT: number;
  _lastOverlayRect!: string;
  declare _lastSparkT: number;
  declare _lastStardustT: number;
  _lastTorchRadius!: number;
  _lastWrapperRect!: string;
  _layoutGen!: number;
  // Bumped by every change to what `look` answers (_lookChanged); the
  // static-frame signature's one term for the whole look.
  _lookGen!: number;
  _measureCtx!: CanvasRenderingContext2D | null;
  _nodeIdSeq!: number;
  _nodeIds!: WeakMap<Node, number> | null;
  _overlayBox!: { top: number; left: number; width: number; height: number } | null;
  // The note tabs the torch darkens (client coordinates), null with the
  // whole overlay dark; the painters' clip and the light's bounds.
  _torchRegions!: Box[] | null;
  _overlaySig!: string;
  _paneRectCache!: PaneRectCache | null;
  _mainRectCache!: MainRectCache | null;
  _pendingPresetName!: string;
  _pendingVimPresetName!: string;
  _perf!: PerfCounters | null;
  _popKeyPending!: number;
  _popRainbowHue!: number;
  _presCacheT!: number;
  _presCacheV!: boolean;
  _realKeyT!: number;
  _reduceMatches!: boolean;
  _reduceMQ!: MediaQueryList | null;
  _reduceMQHandler!: ((e: MediaQueryListEvent) => void) | null;
  _regionOversizedT!: number;
  _ro!: ResizeObserver | null;
  // The content's mutation observer, re-pointed with _ro (_observeEditorLayout).
  _mo!: MutationObserver | null;
  _roView!: EditorView | null;
  _secondaries!: CaretState[];
  _selShape!: { count: number; mainIndex: number } | null;
  // Holds the last selection's document and nodes by identity until the
  // next selectionchange; one small object, released with the next event.
  _selSig!: SelectionSig | null;
  declare _smearDir: Pt | null;
  // The two points the smear quad is built from: the leading face's origin
  // (a spring) and the trailing face's (a lag behind it). See updateSmearQuad.
  declare _smearLead: (Pt & { vx: number; vy: number }) | null;
  declare _smearTrail: Pt | null;
  declare _smearDtT: number;
  declare _smearMoving: boolean;
  declare _smoothLastT: number;
  declare _smoothMoving: boolean;
  _suspendCleared!: boolean;
  _styleGen!: number;
  declare _taperBuf: Quad | null;
  declare _tetherAnchorA: Pt | null;
  declare _tetherAnchorB: Pt | null;
  declare _tetherFrom: number;
  declare _tetherKey: string | null;
  declare _tetherSegKey: string | null;
  declare _tetherSegs: TetherSeg[] | null;
  declare _tetherTo: number;
  // Sites that have reported an unexpected error this engine run (see _reportOnce).
  _reported!: Set<string>;
  _tickNo!: number;
  // The Vim status bar's 250 ms backstop, running only while there is an
  // indicator (syncVimStatusBar).
  _vimStatusTimer!: number;
  // The frame loop's watchdog (engine.ts): its last run, the stalls it
  // has seen and when, and whether it handed the native caret back.
  _watchdogGaveUp!: boolean;
  _watchdogLastT!: number;
  _watchdogTripT!: number;
  _watchdogTrips!: number;
  _torchDarkKey!: string;
  _torchGear!: string;
  _torchGlowKey!: string;
  _torchIdleT!: number;
  // The torch's own next-wake for its parked gear (see the torch tick).
  _torchIdleWakeMs!: number;
  _torchTick!: FrameRequestCallback | null;
  declare _typingBoostSm: number | null;
  _uiModeSwitching!: boolean;
  _vimEditMode!: string;
  _vimModeCache!: string | null;
  _vimModeCacheT!: number;
  _vimNormalRetryT!: number;
  _vimStatusSig!: string | null;
  declare _volumeBuf: Quad | null;
  _wrapperPos!: { left: number; top: number } | null;
  declare animActive: CaretRecord | null;
  bracketTether!: TetherSeg[] | null;
  canvas!: HTMLCanvasElement | null;
  canvasEngineActive!: boolean;
  canvasRaf!: number;
  canvasWrapper!: HTMLDivElement | null;
  ctx!: CanvasRenderingContext2D | null;
  fireworks!: Firework[];
  flameEmbers!: Ember[];
  flamePixels!: FlamePixel[];
  declare glitch: Glitch | null;
  glowEl!: HTMLCanvasElement | null;
  heat!: number;
  declare hotBurns: BurnMark[];
  declare lastActive: CaretRecord | null;
  lastCaret!: CaretRecord | null;
  lastCaretMove!: number;
  lastMouseMove!: number;
  // The document the pointer was last seen in; its coordinates are that
  // window's (updateOverlayTarget).
  _mouseDoc!: Document | null;
  lastMoveTime!: number;
  modalObserver!: MutationObserver | null;
  modalOpen!: boolean;
  // A modal, a menu or the bottom sheet over the note (the torch's
  // stand-down on a phone; the modal observer keeps it).
  _coverOpen!: boolean;
  mouseX!: number;
  mouseY!: number;
  overlay!: HTMLCanvasElement | null;
  particles!: LetterParticle[];
  declare pending: { caret: CaretRecord; since: number; holdChar: string | null } | null;
  registeredDocuments!: Set<Document>;
  secondaryCarets!: CaretCoords[];
  settingTab!: CursorSmithSettingTab | null;
  settings!: CursorSmithSettings;
  declare smearCenterPrev: Pt | null;
  declare smearQuad: SmearQuad | null;
  declare smearQuadLastMoveT: number;
  declare smearShape: Quad | null;
  stardust!: StardustMote[];
  thunderbolts!: Thunderbolt[];
  torchEngineActive!: boolean;
  torchRaf!: number;
  declare trail: TrailPoint[];
  tx!: number;
  ty!: number;
  declare typingSpeedMod: number;
  vimStatusEl!: HTMLElement | null;
  x!: number;
  y!: number;
  async onload() {
    // The torch's chip icon: Lucide Lab's candlestick-big-lit, which
    // Obsidian's Lucide does not bundle (ISC, as Lucide is). addIcon takes
    // the SVG's content in a 100x100 box; the paths are Lucide's 24x24,
    // scaled.
    addIcon("cursor-smith-candle", CANDLE_ICON);
    // This device's own switch, read before anything can start (issue
    // #31). Local storage is per device and never synced: a phone switched
    // off stays off while the desktop keeps the plugin.
    this._deviceEnabled = this.app.loadLocalStorage(DEVICE_ENABLED_KEY) !== "off";
    const rawSaved = (await this.loadData()) as LegacySettings | null;
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
      const fresh: Record<string, Look> = {};
      for (const mode of VIM_MODE_KEYS) {
        const saved: Partial<Look> & { useCustomColors?: boolean } = Object.assign({}, savedModes[mode] || {});
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

    // Per-frame write-dedupe + chrome-inset cache (see _chromeInsets)
    this._lastWrapperRect = "";
    this._canvasBlend = "";   // last mix-blend-mode written (see applyCanvasBlend)
    this._lastOverlayRect = "";
    this._lastTorchRadius = -1;
    this._lastGlowRect = "";      // glow layer dedupe stamps; see the torch tick
    this._lastGlowAlpha = "";
    this._torchGlowKey = "";
    this._chromeCache = null;
    // Per-caret computed-style/metric cache for cmCaretCoords (see there),
    // and the style generation it is keyed on (_invalidateStyle).
    this._caretStyleCache = null;
    this._styleGen = 0;
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
      name: "Toggle Vim mode",
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

    // The Vim status bar's 250 ms backstop is started by syncVimStatusBar
    // with the indicator and stopped with it (it used to run for every user,
    // four times a second, to return at once in CUA mode).

    // The frame loop's watchdog (engine.ts, _watchdog): a dead loop is the
    // one failure that leaves the editor with no caret at all.
    this._lookGen = 0;
    this._lastTickT = 0;
    this._watchdogTrips = 0;
    this._watchdogTripT = 0;
    this._watchdogLastT = 0;
    this._watchdogGaveUp = false;
    this._vimStatusTimer = 0;
    this.registerInterval(window.setInterval(() => this._watchdog(performance.now()), WATCHDOG_INTERVAL_MS));

    // Pop-out windows: drop a document's listeners and stylesheet as its window
    // closes. Without this, registeredDocuments only ever grew - every closed
    // pop-out stayed in the set with a live cleanup closure pinning its
    // `document` and `window`, and applyBodyClasses / disableCanvasEngine /
    // disableTorchOverlay went on iterating detached documents for the rest of
    // the session.
    // Layout can move without any input: a theme or snippet change, a pane
    // opening or closing, a leaf change. Each invalidates the geometry
    // caches and wakes the loop for a frame (_invalidateLayout). The first
    // three can also change the font under the caret (a theme, a snippet, a
    // zoom, a pane reflowing), so they bump the style generation too; an
    // active-leaf change only moves it.
    // The four events share one handler signature; the overload is picked by name.
    for (const ev of ["css-change", "layout-change", "active-leaf-change", "resize"]) {
      const style = ev !== "active-leaf-change";
      try {
        this.registerEvent(this.app.workspace.on(ev as "layout-change", () => (style ? this._invalidateStyle() : this._invalidateLayout())));
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
      if (this.settings.enabled && this._deviceEnabled) this.enable();
      this.syncVimStatusBar();
    });
  }

  onunload() {
    this.disable();
    // The reduced-motion query's listener (see reducedMotion).
    if (this._reduceMQ && this._reduceMQHandler && typeof this._reduceMQ.removeEventListener === "function") {
      try { this._reduceMQ.removeEventListener("change", this._reduceMQHandler); } catch { /* a window already gone */ }
    }
    this._reduceMQ = null;
    this._reduceMQHandler = null;
    if (this._vimStatusTimer) {
      window.clearInterval(this._vimStatusTimer);
      this._vimStatusTimer = 0;
    }
    // The settings tab's decorate observer lives for the tab's life, not
    // for one showing (see the tab's hide()); this is the one place it ends.
    if (this.settingTab && this.settingTab._valueObserver) {
      this.settingTab._valueObserver.disconnect();
      this.settingTab._valueObserver = null;
    }
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
  unregisterDocument(doc: Document) {
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
      // Every layer, referenced or not: with the plugin off its stylesheet
      // is gone, and a layer left behind is a plain box over the window.
      doc.querySelectorAll(".cursor-smith-wrapper, .cursor-smith-canvas, .cursor-smith-torch-overlay").forEach((el) => { el.remove(); });
      doc.body?.classList.remove(
        "cursor-smith-active", "cursor-smith-hide-native", "cursor-smith-torch-active");
    } catch { /* document already torn down with its window */ }
  }

  registerWindowEvents(doc: Document) {
    if (this.registeredDocuments.has(doc)) return;
    this.registeredDocuments.add(doc);
    
    const onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      // Which window's coordinates those are (the torch's target reads it).
      this._mouseDoc = doc;
      this.lastMouseMove = performance.now();
      // Wakes only the torch (which may be following the mouse) — moving the
      // pointer must not spin the cursor canvas up to full rate.
      this._wakeTorch();
    };
    // Any of these means the picture may be about to change: snap the render
    // loops out of idle so the very next frame reflects it.
    const onActivity = (e: Event) => this._markActivity(e && e.type ? e.type : "activity");
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
    const noteKeystroke = (kind: string, opts: { repeat?: boolean } = {}) => {
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
      if (!this.look.speedDemon) return;
      const weight = keystrokeHeatWeight(kind, !!opts.repeat);
      if (!weight) return;
      const bump = 0.09 * weight * (this.look.speedDemonSensitivity ?? 1);
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
    const onKeyDown = (e: KeyboardEvent) => {
      this._markActivity("key");
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
    const onBeforeInput = (e: InputEvent) => {
      this._markActivity("input");
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
      this._markActivity("resize");
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
    // The scroll's own stamp, for the frame cap (SCROLL_LOCK_MS): the
    // activity kind is overwritten by every touch or pointer move between
    // two scroll events, so it cannot say "scrolling" at every frame.
    const onScrollLike = (e: Event) => { if (this._scrollMovesCaret(e.target, doc)) { this._lastScrollT = performance.now(); this._markActivity(e.type); } };
    // selectionchange only when the selection went somewhere (_selectionMoved):
    // Android's WebView and CodeMirror re-syncing its own selection fire it
    // with the caret exactly where it was, and each used to buy INPUT_HOT_MS
    // of the hot gear - the likeliest reading of a phone report that sat at
    // "hot 78%" doing nothing.
    const onSelectionChange = () => { if (this._selectionMoved(doc)) this._markActivity("selectionchange"); };
    doc.addEventListener("selectionchange", onSelectionChange);
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
    const onWindowFocusChange = () => this._markActivity("window focus");
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
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("mousedown", onActivity, true);
      doc.removeEventListener("focusin", onActivity, true);
      // onScrollLike, not onActivity: until 1.5.8 these two named the wrong
      // function and so removed nothing, leaving a closed pop-out's scroll
      // and wheel listeners attached to a document nothing else held.
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
    // userPresets lives inside this.settings so it survives every saveData
    // call automatically - no separate load/merge step needed anywhere.
    await this.saveData(this.settings);
    // Sliders and pickers mutate mode objects in place, so the memoized
    // per-mode merge must be rebuilt after every save - and the loop shown
    // the result on the next frame rather than the next heartbeat, which
    // is the difference between a slider dragged in the settings window
    // moving the caret and moving it up to 200 ms later.
    this._lookChanged();
    this._wakeLoop();
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
    // The synced wish flips; the engines follow it and this device's own
    // switch. It used to read the wish back off the engines, which with the
    // device off would have turned "Enable plugin" straight off again.
    this.settings.enabled = !this.settings.enabled;
    if (this.settings.enabled) this.enable(); else this.disable();
    void this.saveSettings();
  }

  // "Enable on this device" (issue #31): saved to this device's local storage, off
  // as the string "off" - Obsidian's saveLocalStorage drops a falsy value,
  // so `false` read back as nothing - and on as nothing (so a new device
  // starts on); the engines follow at once. The synced "Enable plugin" is
  // untouched.
  setDeviceEnabled(on: boolean) {
    this._deviceEnabled = on;
    this.app.saveLocalStorage(DEVICE_ENABLED_KEY, on ? null : "off");
    if (on && this.settings.enabled) this.enable(); else this.disable();
  }

  // A defensive catch that stays silent turns a bug into a cursor that is
  // quietly wrong. Every catch in this class is one of two things: an EXPECTED
  // failure with a comment naming it (a document torn down with its window, an
  // input type that has no selectionStart, an Obsidian without the event), or
  // a guard that must not take the frame down - and those report here, once
  // per site per engine run, so the first occurrence is in the console and the
  // ten-thousandth is not. A test sweeps the source for a catch that is
  // neither.
  _reportOnce(site: string, e: unknown) {
    const seen = this._reported || (this._reported = new Set());
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
  reducedMotion(): boolean {
    if (this.settings.respectReducedMotion === false) return false;
    try {
      if (!this._reduceMQ) {
        const win = (this.canvas && this.canvas.ownerDocument.defaultView) || window;
        const mq = win.matchMedia("(prefers-reduced-motion: reduce)");
        this._reduceMQ = mq;
        this._reduceMatches = !!mq.matches;
        // Read once and kept by a change listener (removed in onunload):
        // every this.look goes through here (effectiveSettings), dozens of
        // times a frame, and MediaQueryList.matches re-evaluates the query
        // on each read - a few percent of a tick, measured.
        this._reduceMQHandler = (e: MediaQueryListEvent) => { this._reduceMatches = !!e.matches; this._lookChanged(); };
        if (typeof mq.addEventListener === "function") mq.addEventListener("change", this._reduceMQHandler);
      }
      return this._reduceMatches;
    } catch {
      // No matchMedia (the test harness): nothing asks for reduced motion.
      return false;
    }
  }

  effectiveSettings(mode: string | null): CursorSmithSettings {
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
  get look(): CursorSmithSettings {
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
  styleFor<K extends SettingKey>(key: K): CursorSmithSettings[K] {
    return this.look[key];
  }

  // isPresentationModeActive runs two querySelector-style probes; at 120fps in
  // two loops that's ~500 DOM queries a second for a state that changes maybe
  // twice per session. Cache it for 500ms — a half-second delay in noticing a
  // presentation started/ended is invisible.
  presentationActive(): boolean {
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
  windowFocused(): boolean {
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
    } catch (e) {
      // Never let a focus probe kill a frame - assume focused.
      this._reportOnce("windowFocused", e);
      return true;
    }
  }

  // Whether the native caret should currently be suppressed. Every site that
  // stamps cursor-smith-hide-native reads this rather than the setting,
  // because with Note Editor Only on the answer changes with FOCUS and not
  // only when a setting is saved.
  hideNativeActive() {
    // The watchdog handed the native caret back after two stalls of the
    // frame loop (engine.ts); cleared by the next enable().
    if (this._watchdogGaveUp) return false;
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
  _focusedForeignDoc(view: EditorView | null | undefined) {
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
    } catch (e) {
      // A focus probe must never take a frame down.
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
    } catch (e) {
      // Never crash the tick loop over a failed presentation check.
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
    // Unexpected-error sites that have reported (see _reportOnce): a fresh
    // engine run may report again.
    this._reported = new Set();
    // The primary caret's state object (see carets.ts); the per-caret fields
    // below are written into it through their accessors.
    if (!this._caret) this._caret = {} as CaretState;
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
    // Last caret sample. See updateHotHeadInertia.
    this._hotPrev = null;
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
    this._smearLead = null;
    this._smearTrail = null;
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
    // The glide's and the fire's per-caret stamps. They used to be left to
    // the code paths that set them, so a fresh caret lacked the keys and
    // the first frame told them apart from a reset one; a caret's state is
    // complete from the start now (carets.ts, _freshCaretState).
    this._smoothMoving = false;
    this._smoothLastT = 0;
    this._typingBoostSm = null;
    this._hotEmitFrom = null;
    this._hotActiveT = 0;
    this._lastHotT = 0;
    this._hotShiftTick = 0;
    this._hotEngulfUntil = 0;

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

    // Where the selection was when selectionchange last woke the loop
    // (_selectionMoved), the idle gear's next wake (the tick sets it), and
    // the two paint caches that key on what they measured.
    this._selSig = null;
    this._idleWakeMs = 0;
    this._glyphMetricKey = null;
    this._glyphMetrics = null;
    this._hotFill = null;
  }

  enable() {
    this.disable();
    // Off on this device: nothing starts, whatever the synced settings say
    // (the settings toggle, a preset load and the command all come here).
    if (this._deviceEnabled === false) return;
    this._watchdogGaveUp = false;
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

}
Object.assign(CursorSmithPlugin.prototype, measureMethods, effectsMethods, paintMethods, torchMethods, libraryMethods, vimMethods, engineMethods, caretsMethods);

// The per-caret fields (CARET_STATE_FIELDS) live on the current caret's
// state object, this._caret - the primary's, or a secondary's bundle while
// _withCaret has it in (carets.ts). Each is an accessor here, so the whole
// pipeline reads and writes them as `this.x` and a secondary is switched in
// by one pointer instead of forty fields copied in and out. The setter
// creates the object on first use, so an engine built from the prototype
// alone (the tests, the probes) works without a reset.
for (const key of CARET_STATE_FIELDS) {
  Object.defineProperty(CursorSmithPlugin.prototype, key, {
    configurable: true,
    enumerable: false,
    get(this: CursorSmithPlugin) {
      const c = this._caret as CaretState | undefined;
      return c ? (c as unknown as Record<string, unknown>)[key] : undefined;
    },
    set(this: CursorSmithPlugin, value: unknown) {
      const c = (this._caret as CaretState | undefined) || (this._caret = {} as CaretState);
      (c as unknown as Record<string, unknown>)[key] = value;
    },
  });
}
