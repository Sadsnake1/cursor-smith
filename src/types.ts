import type { EditorView, Rect as CMRect } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import type { Setting, SettingDefinitionGroup } from "obsidian";
import type CursorSmithPlugin from "./plugin";
import type { CARET_STATE_FIELDS } from "./constants";
import { DEFAULT_SETTINGS } from "./settings";

// The settings object: every key of DEFAULT_SETTINGS with its default's
// type, plus whatever a saved data.json or a migration carries on top.
export type CursorSmithSettings = typeof DEFAULT_SETTINGS & {
  // Added on first load rather than in the defaults: the user's saved
  // presets, and the Vim toggle state the plugin restores on unload.
  userPresets?: Record<string, Partial<CursorSmithSettings>>;
  vimPresets?: Record<string, Record<string, Look>>;
  vimPrevObsidianVim?: boolean;
};
// A saved settings object as it comes off disk: any version's keys.
export type LegacySettings = Partial<CursorSmithSettings> & Record<string, unknown>;

// A point, a rectangle and a bounds box in client (canvas) coordinates.
export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

// The cursor's four corners (Motion Smear's quad), and the sprung version
// updateSmearQuad integrates per frame.
export type QuadKey = "tl" | "tr" | "br" | "bl";
export type Quad = Record<QuadKey, Pt>;
export type SmearQuad = Record<QuadKey, Pt & { vx: number; vy: number }>;

// One segment of the bracket tether.
export interface TetherSeg { x1: number; y1: number; x2: number; y2: number }

// A running glitch burst.
export interface Glitch { start: number; dur: number; reach: number; seed: number }

// Hot-head's scroll compensation: where the pool was shifted to and by how much.
export interface HotShift { ox: number; oy: number; tick: number }
// The scroller Hot-head follows and its offsets when they were last read;
// `gen` is the layout generation of that read (see hotSyncScroll).
export interface HotScroll { el: Element | null; x: number; y: number; gen: number }
// Where the selection was when selectionchange last woke the loop (see
// _selectionMoved): the editor's document, anchor, head, assoc and range
// count, or a field and its selection, or the DOM selection's two ends.
// Identities, not copies.
export interface SelectionSig { a: unknown; b: unknown; n: number; h: number; o: number; k: number }
// What the tick decided for a frame (see _decideGear): the gear, whether
// the frame is static (nothing animating, so the draw may be skipped on a
// matching signature), the blink's half for that signature, how long the
// idle gear may sleep, and the first reason that held (for the report).
export interface GearDecision { gear: string; staticFrame: boolean; blinkBucket: number; idleWake: number; why: string }

// The tick's counters behind the performance report (see _freshPerf).
export interface PerfCounters {
  t0: number; ticks: number; draws: number; gears: Record<string, number>;
  tickMs: number; caretMs: number; drawMs: number; reanchors: number;
  longTasks: number; longTaskMs: number; rafGaps: Record<string, number>; rafPrev: number; keys: number;
  // Why each tick was in the gear it was in: the first reason that held.
  why: Record<string, number>;
}

// Caret measurement caches, keyed on what invalidates them.
export interface CaretGeoCache { doc: Text; pos: number; assoc?: number; gen: number; t: number; c: CMRect | null }
// What the caret measurers hand back before it becomes a record.
export interface CoordsLTB { left: number; top: number; bottom: number }
// The computed style a caret is set in, read once per line element.
export interface LineStyle {
  textColor: string; fontSize: number; fontFamily: string; fontWeight: string; fontStyle: string;
  letterSpacing: number; lineHeightStr: string;
}
// The primary caret's style cache (cmCaretCoords), keyed on the position.
export interface CaretStyleCache extends LineStyle {
  doc: Text; pos: number; assoc: number; gen: number; t: number; charWidth: number; rowLeft: number | null; rowRight: number | null;
}
// A secondary's, kept on its bundle (secondaryCaretRecord).
export interface SecondaryStyleCache extends LineStyle { doc: Text; pos: number; t: number; char: string; charWidth: number }
// coverTop / coverBottom: the client Y past which the cursor canvas may not
// paint, from the full-width bands and bars fixed over the editor
// (CARET_COVERS); 0 and Infinity with none.
export interface ChromeInsets { doc: Document; t: number; top: number; bottomInset: number; statusLeft: number; statusRight: number; coverTop: number; coverBottom: number }
export interface Box { top: number; bottom: number; left: number; right: number; width: number; height: number }
export interface PaneRectCache { view: EditorView; gen: number; t: number; rect: Box | null }
export interface MainRectCache { doc: Document; gen: number; t: number; rect: Box | null; notes: Box[] }
export interface EffCache { mode: string | null; base: CursorSmithSettings; cfg: Look | null; reduce: boolean; obj: CursorSmithSettings }

// One Vim mode's snapshot: every look key, typed by its default. Generated
// from DEFAULT_SETTINGS and LOOK_KEYS so the two cannot drift.
export interface Look {
  cursorStyle: string;
  colorDark: string;
  colorLight: string;
  gradientEnabled: boolean;
  gradientCount: number;
  gradientDark1: string;
  gradientDark2: string;
  gradientDark3: string;
  gradientDark4: string;
  gradientLight1: string;
  gradientLight2: string;
  gradientLight3: string;
  gradientLight4: string;
  crtEffect: boolean;
  glow: boolean;
  crtNeon: boolean;
  crtNeonGradient: boolean;
  torchEffect: boolean;
  overlaySpareSidebars: boolean;
  overlayFollowMode: string;
  overlayRadius: number;
  overlayDarkness: number;
  overlayIntensity: number;
  overlayColor: string;
  overlayFlicker: boolean;
  overlaySpeed: number;
  overlayBlinkSync: boolean;
  overlayBlinkDepth: number;
  caretWidthPx: number;
  caretHeightPct: number;
  popLettersRise: boolean;
  typewriter: boolean;
  typewriterSpring: boolean;
  typewriterInk: boolean;
  typewriterReturn: boolean;
  typewriterAdvance: boolean;
  typewriterDepth: number;
  typewriterBounce: number;
  typewriterSquash: number;
  typewriterStrikeMs: number;
  typewriterInkMs: number;
  typewriterInkSize: number;
  typewriterReturnMs: number;
  typewriterReturnWidth: number;
  typewriterAdvanceCw: number;
  typewriterAdvanceMs: number;
  popLetters: boolean;
  popRainbow: boolean;
  flameTrail: boolean;
  backspaceDisintegrate: boolean;
  flameTrailDensity: number;
  flameTrailLifeMs: number;
  flameTrailGravity: number;
  flameTrailGravityAngle: number;
  flameTrailOnJump: boolean;
  flameTrailGradientColors: boolean;
  flameTrailPixelSize: number;
  thunderstrike: boolean;
  thunderstrikeSize: number;
  thunderstrikeStrength: number;
  stardustEnabled: boolean;
  stardustAlwaysOn: boolean;
  stardustDelayMs: number;
  stardustRate: number;
  stardustOrbit: boolean;
  stardustOrbitRadius: number;
  bracketTether: boolean;
  bracketTetherStrength: number;
  lineSerifs: boolean;
  boxHollow: boolean;
  boxHollowWidth: number;
  underlineWidthPx: number;
  speedDemon: boolean;
  speedDemonSparks: boolean;
  speedDemonSensitivity: number;
  speedDemonSparkQuantity: number;
  speedDemonSparkTrail: number;
  speedDemonNoCursorHeat: boolean;
  hotHead: boolean;
  hotHeadQuantity: number;
  hotHeadSpread: number;
  hotHeadTrail: number;
  hotHeadFade: number;
  hotHeadHeight: number;
  hotHeadOpacity: number;
  hotHeadFlat: boolean;
  hotHeadIdleMs: number;
  cursorOpacity: number;
  energyEffect: boolean;
  energySpeed: number;
  energyAurora: boolean;
  trailLength: number;
  trailFadeMs: number;
  blinkingEnabled: boolean;
  blinkSpeed: number;
  blinkOnOffBalance: number;
  blinkDelayMs: number;
  blinkFade: number;
  blinkBreathing: boolean;
  blinkBreathDepth: number;
  showChar: boolean;
  moveDelayMs: number;
  smear: boolean;
  smearStiffness: number;
  smearTrailingStiffness: number;
  smearDamping: number;
  smearTaper: boolean;
  smearTaperAmount: number;
  smoothEnabled: boolean;
  smoothStopBlinking: boolean;
  smoothness: number;
  catchUpSpeed: number;
  maxCatchUpSpeed: number;
  smoothAdaptive: boolean;
  crtGlitch: boolean;
  crtGlitchStrength: number;
  crtGlitchAberration: number;
  crtGlitchMs: number;
  energyAuroraWaviness: number;
  cursorTranslucent: boolean;
  popEffects: boolean;
  fireworks: boolean;
  fireworksQuantity: number;
  speedDemonGradient: boolean;
  speedHeatDark1: string;
  speedHeatDark2: string;
  speedHeatDark3: string;
  speedHeatDark4: string;
  speedHeatLight1: string;
  speedHeatLight2: string;
  speedHeatLight3: string;
  speedHeatLight4: string;
  overlayFlickerAmount: number;
  hotHeadSpeedHeat: boolean;
  cursorRounded: boolean;
  glyphColorMode: string;
  blinkStopAfter: number;
  smearMaxLength: number;
  smearConserveVolume: boolean;
  smearVolumeStrength: number;
}
export type SettingKey = keyof CursorSmithSettings;

// Key flags handed to the secondary-caret update from the keystroke path.
export interface KeyFlags { enter?: number; del?: number; pop?: number; repeat?: boolean; [k: string]: number | boolean | undefined }

// One spark of a firework, and the trail callback the caret painters share.
export interface FireworkSpark { ang: number; speed: number; size: number; ci: number; tw: number; tr: number }
export type TrailPointCallback = (p: TrailPoint, alpha: number, age: number) => void;

// The look rows' options: how deep the row is indented under its parent,
// whether writing it refreshes the panel (a gate), when it shows, and what
// it needs from another card - a row with `needs` stays visible but is
// disabled, with a hint naming the setting, while the predicate is false.
export interface Needs { when: () => boolean; hint: string }
export interface SwatchOptions { depth?: number; when?: () => boolean; needs?: Needs }
export interface RowOptions extends SwatchOptions { gate?: boolean }
export interface SliderOptions extends RowOptions { fallback?: number }
export interface DropdownOptions extends SwatchOptions { value?: string; onChange?: (value: string) => unknown }
// The look cards, carrying the set of gate keys for the tests.
export type LookCards = SettingDefinitionGroup[] & { gates?: Set<keyof Look>; cardKeys?: Record<string, (keyof Look)[]>; summaries?: Record<string, () => string>; effectsOn?: () => RailEffect[] };
// One effect on the Effects page: its master key, its entry's name,
// description and Lucide icon.
export interface RailEffect { key: keyof Look; name: string; icon: string; desc: string }

// A glitch burst resolved to this frame's drawing parameters.
export interface GlitchState { seed: number; bucket: number; env: number; amp: number; ab: number; strength: number }

// What the settings panel's shared renderer reads and writes a look through:
// a getter and a setter over one settings object (the global one, or a Vim
// mode's snapshot), typed by key.
export type SettingGet<S = CursorSmithSettings> = <K extends keyof S>(key: K) => S[K];
export type SettingSet<S = CursorSmithSettings> = <K extends keyof S>(key: K) => (value: S[K]) => Promise<void> | void;
export interface LookSettingsHooks<S extends Look = Look> {
  get: SettingGet<S>;
  set: SettingSet<S>;
  renderCursorStyleSetting: (setting: Setting, rerender: () => void) => void;
  renderTorchToggleSetting: (setting: Setting, rerender: () => void) => void;
  // After a card's reset has written its defaults: what the caller does for
  // a write of its own (restart the engine, sync the torch, mark the edit).
  afterReset?: () => void;
}

// Where a caret is, as caretCoords() measures it: the box, the row it sits
// on, the glyph under it and the font that glyph is set in. Every measurer
// (CodeMirror, generic element, form field, secondary) fills in all of it;
// only the identity fields depend on the path.
export interface CaretRecord {
  x: number;
  top: number;
  bottom: number;
  h: number;
  w: number;
  actualCharWidth: number;
  // Text extent of the caret's own visual row; null where there is no line
  // element to measure (a plain input).
  rowLeft: number | null;
  rowRight: number | null;
  char: string;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: number;
  focused?: boolean;
  // A CodeMirror document position, or a plain field's own identity key.
  pos?: number | string | null;
  assoc?: number;
  empty?: boolean;
  visible?: boolean;
  // The document's length when this was measured (a CodeMirror caret): with
  // `pos`, what tells an insertion at the caret from a click or an arrow
  // (resolveHoldChar).
  docLen?: number;
}
// A secondary caret as secondaryCaretCoords measures it: the coordinates
// and the range's identity, before the full record is built for it (or
// for the plain line, all that is ever built).
export interface CaretCoords { x: number; top: number; bottom: number; pos: number; assoc: number; empty: boolean; visible: boolean }

// One full-effects secondary caret's working state: the CARET_STATE_FIELDS
// bundle _withCaret swaps onto the plugin for that caret's turn - the
// plugin's own fields of those names, plus what secondaryCaretRecord keeps
// on the bundle for its caret.
export type CaretStateField = (typeof CARET_STATE_FIELDS)[number];
export type CaretState = Pick<CursorSmithPlugin, CaretStateField> & {
  _style?: SecondaryStyleCache | null;
  _geo?: CaretGeoCache | null;
  _tetherOut?: TetherSeg[] | null;
  torchX?: number;
  torchY?: number;
};

// The particles. Each is what one effect pushes into its own array and
// draws back out, with exactly the fields its spawn literal sets.
export interface TrailPoint { x: number; y: number; w: number; h: number; t: number }
export interface LetterParticle {
  char: string; x: number; y: number; vx: number; vy: number; rotation: number; alpha: number;
  fontSize: number; fontFamily: string; color: string; start: number;
  // "Rise straight up": floats from the cursor's top, a line height (lh) up.
  rise?: boolean; lh?: number;
  // Typewriter's ink stamp: overprinted on the letter's own cell (x is its
  // left edge, y the line top), in its own font.
  stamp?: boolean; fontWeight?: string; fontStyle?: string;
}
// Typewriter's carriage return: a streak from the old line's end (x0) back
// to its start (xs) at height y, and the spark at x0.
export interface TypeReturn { x0: number; xs: number; y: number; h: number; color: string; start: number }
// Where Typewriter holds the caret at a moment: shifted by dx, dy and
// squashed to sy of its height about its bottom edge.
export interface TypewriterPose { dx: number; dy: number; sy: number }
// One pool for three effects - Pixel Trail puffs (`trail`), Speed Demon
// sparks (`spark`, with their colour channels cached) and Thunderstrike
// debris (neither) - so one loop ages and clears them all.
export interface FlamePixel {
  x: number; y: number; vx: number; vy: number; size: number; color: string; alpha: number; start: number;
  r?: number; g?: number; b?: number; spark?: boolean; life?: number; trail?: boolean;
}
export interface Ember {
  x: number; y: number; vx: number; vy: number; life: number; life0?: number; maxLife: number;
  temp: number; cw: number; lift: number; shape0?: number; flip?: boolean; spark?: boolean; fine?: boolean;
  // Hot-head's sway (drawHotHead): age in ms, reach in character widths,
  // frequency in Hz, phase, and the offset last applied.
  age?: number; sw?: number; sf?: number; sp?: number; so?: number;
}
export interface BurnMark { x: number; y: number; t: number; rowLeft: number | null; rowRight: number | null; lh: number; fs: number }
export interface ThunderCell { x: number; y: number; t: number }
export interface ThunderBand { r: number; g: number; b: number; cr: number; cg: number; cb: number; cells: ThunderCell[] }
export interface Thunderbolt {
  bands: ThunderBand[]; cell: number; tx: number; ty: number; minX: number; minY: number; maxX: number; maxY: number;
  flash: number; er: number; eg: number; eb: number; flicker: number[]; start: number;
}
export interface FireworkSecondary { ang: number; speed: number; at: number; sparks: FireworkSpark[] }
export interface Firework {
  x0: number; y0: number; bx: number; by: number; sparks: FireworkSpark[]; palette: string[];
  secondaries: FireworkSecondary[]; trail: number; riseMs: number; fallMs: number; delay: number; flash: number;
  minX: number; maxX: number; minY: number; maxY: number; start: number;
}
export interface StardustMote {
  x: number; y: number; vy: number; sway: number; swaySpeed: number; phase: number; twinkleSpeed: number;
  size: number; life: number; color: string; start: number; owner: CaretState | null;
  orbit: boolean; ax: number; ay: number; radius: number; angSpeed: number; wobbleSpeed: number; squash: number;
}

// What the performance report reads off the browser and off Obsidian's
// undocumented app fields. Every read is optional and guarded.
export interface ReportNavigator { userAgent?: string; platform?: string }
export interface ReportWindow { innerWidth?: number; innerHeight?: number; devicePixelRatio?: number }
export interface ReportApp {
  customCss?: { theme?: string; currentTheme?: string; enabledSnippets?: Set<string> };
  plugins?: { enabledPlugins?: Set<string> };
}

// The vim state @replit/codemirror-vim keeps on its CodeMirror 5 adapter -
// the flags the mode detector reads, nothing more.
export interface VimState { insertMode?: boolean; visualMode?: boolean; insertModeReplace?: boolean; replaceMode?: boolean }
export interface VimAdapter { state: { vim?: VimState; overwrite?: boolean } }

// Obsidian's Editor wraps a CodeMirror 6 EditorView as `cm`. It is not in
// the public typings, and the whole engine measures through it.
declare module "obsidian" {
  interface Editor {
    cm?: EditorView;
  }
  // The engine reaches a view's editor and content element through the base
  // View, where the typings only give them to MarkdownView / ItemView.
  interface View {
    editor?: Editor;
    contentEl?: HTMLElement;
  }
  // Obsidian's own Vim toggle. Undocumented, and guarded at every call.
  interface Vault {
    setConfig?(key: string, value: unknown): void;
    getConfig?(key: string): unknown;
  }
}

declare module "@codemirror/view" {
  interface EditorView {
    // Obsidian hangs its CodeMirror 5 compatibility adapter - what the Vim
    // mode runs on - off the CM6 view.
    cm?: VimAdapter;
    // CodeMirror types `side` as 1 | -1; the engine passes the caret's
    // assoc, a number it flips with unary minus. CodeMirror only tests the
    // sign.
    coordsAtPos(pos: number, side?: number): CMRect | null;
  }
}
