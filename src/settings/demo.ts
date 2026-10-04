// The preset cards' demos: a caret in the preset's look "typing" the
// preset's name, letter by letter, pausing at the end and jumping back to
// the start. Not a stylesheet animation: the caret is driven from the
// preset's own numbers, the way the engine drives the real one -
//
//   - the glide is the engine's exponential approach
//     (rate = catchUpSpeed * (1 - smoothness) * 40, see plugin.ts) when
//     Smooth movement is on, a snap when it is off;
//   - the blink is blinkAlphaAt with the preset's speed, balance and fade,
//     held lit while "typing" when Don't blink while typing is on;
//   - Motion smear is two springs, a leading edge and a trailing one, and
//     the caret is drawn from the one to the other, so it stretches on a
//     move and snaps back when it arrives - the real smear is a quad with
//     four corners on springs; this is its silhouette;
//   - CRT effects leave a ghost at every spot the caret leaves, fading
//     over the preset's fade time, up to its trail length;
//   - Speed demon warms the color through the preset's heat stops while
//     the typing goes on and cools it during the pause;
//   - Glow is the caret's own shadow;
//   - Pixel trail, Stardust, Hot-head and Speed demon's sparks are a small
//     pool of particle spans per card: pixels thrown from the spot the
//     caret leaves, motes rising while it rests, flames climbing off the
//     caret while it types, embers when it is hot;
//   - Energy beam is a band of light sliding along the caret (a gradient
//     background scrolled each frame);
//   - the Appearance page is honored as the engine honors it: a gradient
//     runs top to bottom on a Box or a Line and left to right on an
//     Underline, a hollow Box is an outline of its width, a Line is as
//     thick as its setting (scaled to the cell) with serifs when asked, an
//     Underline as thick as its own, corners round at the engine's ratio,
//     translucency and opacity multiply the alpha, and the letter inside a
//     Box takes the color mode (contrast, tinted, inverted).
//
// The Randomizer's preview (1.7.7) is the same demo, bigger, on a script of
// its own (scriptFor, stepScript): a line picked at random from
// SCRIPT_LINES, typed fast, a typo now and then caught and backspaced, then
// a little play with the cursor - quick jumps word to word, a few steps
// letter by letter - then cleared and the next line, for as long as the
// page is open; with what a roll is most about added on top: letters
// popping out, fireworks on Space, the typewriter's dip, what is deleted
// evaporating.
//
// Only the preset in use plays (the ticked card), and only DEMO_CYCLES
// passes over its name; then it glides to the idle spot and rests. Every
// other card sits still at the idle spot: one space past the end of the
// name (the user's placement). A strip of seven carets all typing at
// once was annoying (the user's word). One requestAnimationFrame loop per strip
// (DemoStrip) drives the card that plays; it ends when the card is done
// or its element has left the document (a re-render of the strip needs
// no teardown). No loop at all under reduced motion, or where there is
// no requestAnimationFrame (the tests).
import type { Look } from "../types";
import { blinkAlphaAt, smoothCatchRate } from "../util/motion";
import { hexToRgbTuple, readableGlyphColor, rgbTupleToHex } from "../util/color";

// The engine's Appearance constants (constants.ts), for the demo's scale:
// a translucent cursor's body alpha, a rounded corner's ratio on a block
// and the width under which it is a full half-round.
const TRANSLUCENT_ALPHA = 0.95;
const ROUNDED_THIN_PX = 6;
const ROUNDED_BLOCK_FRACTION = 0.25;

// The caret's look from the Appearance settings, sized to the demo's cell
// (the cell's letters are 12px; the editor's are bigger, so a Line's width
// and an Underline's height are scaled down a little).
export function shapeOf(look: Partial<Look>, color: string, stops: string[], px: number): Shape {
  const style = String(look.cursorStyle || "Box").toLowerCase();
  const gradientOn = !!look.gradientEnabled && stops.length >= 2;
  const angle = style === "underline" ? 90 : 180;
  const gradient = gradientOn ? `linear-gradient(${angle}deg, ${stops.map((c, i) => `${c} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(", ")})` : null;
  const thick = style === "line"
    ? Math.max(1, Math.min(5, Math.round((look.caretWidthPx ?? 2) * 0.75)))
    : style === "underline"
      ? ((look.underlineWidthPx ?? 0) > 0 ? Math.max(1, Math.min(4, Math.round((look.underlineWidthPx ?? 0) * 0.75))) : 2)
      : Math.max(1, px - 1);
  const hollowWidth = style === "box" && look.boxHollow ? Math.max(1, Math.min(3, Math.round((look.boxHollowWidth ?? 2) * 0.75))) : 0;
  let radius = 0;
  if (look.cursorRounded) {
    const minor = style === "box" ? Math.min(px - 1, 12) : thick;
    radius = minor <= ROUNDED_THIN_PX ? minor / 2 : Math.min(minor * ROUNDED_BLOCK_FRACTION, minor / 2);
  }
  return {
    fill: gradientOn ? stops[0] : color,
    gradient,
    thick,
    hollowWidth,
    radius,
    serifs: style === "line" && !!look.lineSerifs,
    alphaScale: (look.cursorOpacity ?? 1) * (look.cursorTranslucent ? TRANSLUCENT_ALPHA : 1),
  };
}

// Milliseconds: one "keystroke", the pause at the end of the word, the
// pause after the jump back.
const TYPE_MS = 170;
const HOLD_END_MS = 650;
const HOLD_START_MS = 450;
// Particles per card, at most.
const POOL = 18;
// How many passes over the name the card in use plays before it rests.
export const DEMO_CYCLES = 2;

export interface DemoState {
  // Where the caret is asked to be: the letter index, 0 .. n.
  target: number;
  // The leading edge and, with Motion smear, the trailing edge, in letters.
  lead: number;
  trail: number;
  // The timeline: which phase, and how long it has run. The pill's script
  // adds "jump" (word to word) and "clear".
  phase: "type" | "holdEnd" | "holdStart" | "jump" | "clear";
  phaseMs: number;
  // The moment of the last keystroke, for Don't blink while typing.
  lastKeyMs: number;
  // Speed demon's heat, 0 cold .. 1 white-hot.
  heat: number;
  // CRT ghosts: where each was left (letters) and when.
  ghosts: { at: number; t0: number }[];
  // The preview's script: the text written so far (typos and all), the
  // actions still to play and the wait before the next one, and what the
  // last frame's actions did, for the effects (the strip reads and empties
  // it).
  buffer: string;
  queue: ScriptAction[];
  wait: number;
  events: ScriptEvent[];
}

export function initialState(now: number): DemoState {
  return { target: 0, lead: 0, trail: 0, phase: "type", phaseMs: 0, lastKeyMs: now, heat: 0, ghosts: [], buffer: "", queue: [], wait: 0, events: [] };
}

// The preview's lines: one at random each time round, never the same twice
// running. At most SCRIPT_MAX letters, so the text keeps one size (a
// 50-letter countdown made all of it smaller; the user had it shortened).
export const SCRIPT_LINES = [
  "The quick brown fox... you know the rest.",
  "Kepano made me do it.",
  "Cursor-Smith is not even real.",
  "Hello, Mr. Anderson...",
  "I came here to write. Now look at me.",
  "Just one more cursor tweak, then I write.",
  "It's not procrastination. It's research.",
  "This cursor has more plot than my novel.",
  "Backspacing is my cardio.",
  "Typing so fast my cursor caught fire.",
  "Follow the white cursor.",
  "Chapter one: in which I pick a cursor.",
  "Writer's block? I'll blink through it.",
  "Your vault called. It wants words.",
  "Plot twist: the cursor was the hero.",
  "Note to self: write notes, not cursors.",
  "Dear diary, today I typed a lot.",
  "Ten minutes of writing, two hours of cursor.",
  "The cursor blinked first.",
  "34j0934)@#$#U*$FH0hr082h34",
  "Can you even vibecode such a thing?",
  "Deleting Vault in 3...2...1...0.4999999",
  "You can never have too many cursors...",
  "The cake is a lie.",
  "CURSOR GOES BRRRRRRRRRRRR",
  "Wingardium leviosaaaaaaaaaah",
  "Don't forget to back up your Vault!",
  "Earth is amazing!",
  "Will you marry me? <3",
  "I think old_Joe tried to say something",
  "See you, Space Cowboy.",
  "The cursor is mightier than the sword.",
  "Blink twice if you need help.",
  "Loading creativity... 3%",
  "404: Words not found.",
  "Get me outta hereeee",
  "Your cursor is in another castle",
  "Is Word-Smith my brother?",
];
export const SCRIPT_MAX = 44;

// One step of the script, and the wait after it (ms). A move is a jump
// (word to word) or a step (one letter, an arrow key's).
export type ScriptAction =
  | { do: "type"; ch: string; ms: number }
  | { do: "back"; ms: number }
  | { do: "move"; to: number; ms: number }
  | { do: "hold"; ms: number }
  | { do: "clear"; ms: number };
export interface ScriptEvent { do: "type" | "back" | "clear"; ch: string; at: number }

// The keys next to each letter (QWERTY): where a typo lands.
const NEAR: Record<string, string> = {
  q: "wa", w: "qes", e: "wrd", r: "etf", t: "ryg", y: "tuh", u: "yij", i: "uok", o: "ipl", p: "ol",
  a: "qsz", s: "awdz", d: "sefx", f: "drgc", g: "fthv", h: "gyjb", j: "hukn", k: "jilm", l: "kop",
  z: "asx", x: "zsdc", c: "xdfv", v: "cfgb", b: "vghn", n: "bhjm", m: "njk",
};

// A line's script: typed at a typist's pace; now and then (two at most, not
// in the first letters) a neighboring key hit instead, a letter or two
// more before it is noticed, then backspaced and put right; a hold; a play
// with the cursor - quick jumps to word edges, runs of single steps; back
// to the end, a hold, cleared, a short rest.
export function scriptFor(line: string, rand: () => number): ScriptAction[] {
  const out: ScriptAction[] = [];
  const typeMs = () => Math.round(38 + rand() * 34);
  let typos = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const near = NEAR[ch.toLowerCase()];
    if (near && i > 2 && typos < 2 && rand() < 0.07) {
      typos++;
      const wrong = near[Math.floor(rand() * near.length) % near.length];
      out.push({ do: "type", ch: ch === ch.toLowerCase() ? wrong : wrong.toUpperCase(), ms: typeMs() });
      const more = Math.min(Math.floor(rand() * 3), line.length - i - 1);
      for (let k = 1; k <= more; k++) out.push({ do: "type", ch: line[i + k], ms: typeMs() });
      out.push({ do: "hold", ms: Math.round(170 + rand() * 130) });
      for (let k = 0; k <= more; k++) out.push({ do: "back", ms: 55 });
    }
    out.push({ do: "type", ch, ms: typeMs() });
  }
  out.push({ do: "hold", ms: 420 });
  const n = line.length;
  const edges = Array.from(new Set([0, n, ...Array.from(line.matchAll(/\S+/g), (m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]).flat()])).sort((a, b) => a - b);
  let at = n;
  const plays = 5 + Math.floor(rand() * 3);
  for (let p = 0; p < plays; p++) {
    if (rand() < 0.35) {
      const dir = rand() < 0.5 ? -1 : 1;
      const k = 2 + Math.floor(rand() * 3);
      for (let j = 0; j < k; j++) { at = Math.max(0, Math.min(n, at + dir)); out.push({ do: "move", to: at, ms: 75 }); }
    } else {
      let to = edges[Math.floor(rand() * edges.length) % edges.length];
      if (to === at) to = edges[(edges.indexOf(to) + 1) % edges.length];
      at = to;
      out.push({ do: "move", to: at, ms: Math.round(230 + rand() * 110) });
    }
  }
  out.push({ do: "move", to: n, ms: 620 });
  out.push({ do: "clear", ms: 380 });
  return out;
}

// The caret asked to a new spot: a CRT ghost left where it was, and the
// moment kept (Don't blink while typing).
function moveTo(s: DemoState, look: Partial<Look>, to: number, now: number) {
  if (look.crtEffect && (look.trailLength ?? 0) > 0) {
    s.ghosts.push({ at: s.lead, t0: now });
    if (s.ghosts.length > (look.trailLength ?? 0)) s.ghosts.shift();
  }
  s.target = to;
  s.lastKeyMs = now;
}

// Where a caret rests: one space past the end of the name.
export const idleAt = (n: number) => n + 1;

// One frame of the timeline and the springs. Pure: the state in, the state
// out, so the tests can run it without a DOM. `n` is the name's length.
// With `frozen` the timeline stands still and only the springs run - a
// demo that has played its passes gliding to the idle spot.
export function step(s: DemoState, look: Partial<Look>, n: number, dt: number, now: number, frozen = false): DemoState {
  s.phaseMs += dt;
  const move = (to: number) => moveTo(s, look, to, now);
  if (frozen) {
    // No keystroke, no jump: the springs settle on the target below.
  } else if (s.phase === "type") {
    if (s.phaseMs >= TYPE_MS) {
      s.phaseMs = 0;
      if (s.target < n) move(s.target + 1);
      else s.phase = "holdEnd";
    }
  } else if (s.phase === "holdEnd") {
    if (s.phaseMs >= HOLD_END_MS) { s.phaseMs = 0; move(0); s.phase = "holdStart"; }
  } else if (s.phaseMs >= HOLD_START_MS) {
    s.phaseMs = 0;
    s.phase = "type";
  }
  return settle(s, look, dt, now);
}

// The preview's script, one frame: every action whose wait is over, played
// in order (a long frame plays several), `next` asked for the next line's
// actions when the queue runs out; what each did goes into `events`.
// Typing and Backspace act at the end of the text (the caret is there while
// typing); a move only moves. Pure, like step().
export function stepScript(s: DemoState, look: Partial<Look>, dt: number, now: number, next: () => ScriptAction[]): DemoState {
  s.phaseMs += dt;
  s.wait -= dt;
  for (let guard = 0; s.wait <= 0 && guard < 64; guard++) {
    if (!s.queue.length) s.queue = next();
    const a = s.queue.shift();
    if (!a) break;
    if (a.do === "type") {
      s.buffer += a.ch;
      moveTo(s, look, s.buffer.length, now);
      s.phase = "type";
      s.events.push({ do: "type", ch: a.ch, at: s.buffer.length - 1 });
    } else if (a.do === "back") {
      const ch = s.buffer.slice(-1);
      s.buffer = s.buffer.slice(0, -1);
      moveTo(s, look, s.buffer.length, now);
      s.phase = "type";
      s.events.push({ do: "back", ch, at: s.buffer.length });
    } else if (a.do === "move") {
      moveTo(s, look, Math.max(0, Math.min(s.buffer.length, a.to)), now);
      s.phase = "jump";
    } else if (a.do === "clear") {
      s.events.push({ do: "clear", ch: "", at: s.buffer.length });
      s.buffer = "";
      moveTo(s, look, 0, now);
      s.phase = "clear";
    } else {
      s.phase = "holdEnd";
    }
    s.phaseMs = 0;
    s.wait += a.ms;
  }
  return settle(s, look, dt, now);
}

// The springs, the heat and the ghosts' fading, after the timeline moved.
function settle(s: DemoState, look: Partial<Look>, dt: number, now: number): DemoState {
  const dtS = Math.min(0.1, dt / 1000);
  // The leading edge: the engine's glide, or a snap.
  if (look.smoothEnabled) {
    const rate = Math.max(0.5, smoothCatchRate(look.catchUpSpeed ?? 0.55));
    s.lead += (s.target - s.lead) * (1 - Math.exp(-rate * dtS));
  } else if (look.smear) {
    // The smear's own leading spring, so a stretch shows even on a snap.
    const rate = 14 + (look.smearStiffness ?? 0.6) * 40;
    s.lead += (s.target - s.lead) * (1 - Math.exp(-rate * dtS));
  } else {
    s.lead = s.target;
  }
  if (Math.abs(s.target - s.lead) < 0.01) s.lead = s.target;

  // The trailing edge follows the leading one, slower, with Motion smear;
  // without, it is the leading edge.
  if (look.smear) {
    // Stiff enough to recover between keystrokes: the real smear snaps
    // back well inside a key repeat, it does not stay stretched.
    const rate = 9 + (look.smearTrailingStiffness ?? 0.4) * 40;
    s.trail += (s.lead - s.trail) * (1 - Math.exp(-rate * dtS));
    if (Math.abs(s.lead - s.trail) < 0.01) s.trail = s.lead;
  } else {
    s.trail = s.lead;
  }

  // Heat: up while typing, down while paused.
  if (look.speedDemon) {
    s.heat = s.phase === "type" ? Math.min(1, s.heat + dtS * 0.45) : Math.max(0, s.heat - dtS * 0.6);
  }

  // Ghosts die after the fade time.
  const fade = look.trailFadeMs ?? 300;
  s.ghosts = s.ghosts.filter((g) => now - g.t0 < fade);
  return s;
}

// The blink's alpha at this moment, 1 while a keystroke is fresh when the
// preset holds the caret lit while typing.
export function blinkAlpha(s: DemoState, look: Partial<Look>, now: number): number {
  if (!look.blinkingEnabled) return 1;
  if (look.smoothStopBlinking && now - s.lastKeyMs < (look.blinkDelayMs ?? 0) + TYPE_MS * 1.5) return 1;
  return blinkAlphaAt(now, look.blinkSpeed ?? 1, look.blinkOnOffBalance ?? 0.5, look.blinkFade ?? 0.15);
}

// The caret's color at this heat: the preset's own color when cold,
// warming through the heat stops - the engine's own ramp (orange,
// red-orange, white-hot) or, with Custom gradient on, the preset's four
// stops for the theme (see paint.ts, heatColorFor).
export function heatColor(base: string, stops: string[], heat: number): string {
  if (heat <= 0 || stops.length < 3) return base;
  const seq = [base, ...stops];
  const pos = heat * (seq.length - 1);
  const i = Math.min(seq.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgbTuple(seq[i]);
  const b = hexToRgbTuple(seq[i + 1]);
  return rgbTupleToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f].map(Math.round));
}

interface Particle {
  el: HTMLElement;
  x: number; y: number; vx: number; vy: number;
  t0: number; life: number;
  size: number;
  color: string;
  // A pull down, px/s² (a popped letter tumbling); 0 for the rest.
  g: number;
}

// The caret's fixed look, from the Appearance settings, computed once.
interface Shape {
  // The fill: a flat color, or a gradient (CSS) when Gradient is on.
  fill: string;
  gradient: string | null;
  // The narrow dimension, in px: a Line's width or an Underline's height.
  thick: number;
  hollowWidth: number;
  radius: number;
  serifs: boolean;
  alphaScale: number;
}

interface Demo {
  el: HTMLElement;
  shape: Shape;
  // Passes completed, and whether the demo has come to rest.
  cycles: number;
  done: boolean;
  particles: Particle[];
  pool: HTMLElement[];
  spawnAcc: number;
  lastTarget: number;
  text: HTMLElement;
  caret: HTMLElement;
  inner: HTMLElement | null;
  ghosts: HTMLElement[];
  look: Partial<Look>;
  color: string;
  heatStops: string[];
  n: number;
  style: string;
  state: DemoState;
  stepPx: number;
  // The pill (1.7.7): on the script, its written and unwritten halves (and
  // the Box's letter copy's), the jumps, the particles it may have, its
  // scale, and the last keystroke for the typewriter's dip.
  script: boolean;
  name: string;
  written: HTMLElement | null;
  rest: HTMLElement | null;
  innerWritten: HTMLElement | null;
  innerRest: HTMLElement | null;
  painted: string;
  // The line being played, for the next one to differ.
  line: string;
  poolMax: number;
  scaled: boolean;
  keyT: number;
  hue: number;
}

// Every card's demo in one strip, on one frame loop.
export class DemoStrip {
  private demos: Demo[] = [];
  private raf = 0;
  private last = 0;
  private win: Window | null = null;
  // The pill's wait for its page to come back (a slow poll, not a frame
  // loop spinning for nothing).
  private poll = 0;

  // Every demo let go, the loop stopped (the pill's, before its next one).
  reset() {
    if (this.win) {
      if (this.raf) this.win.cancelAnimationFrame(this.raf);
      if (this.poll) this.win.clearTimeout(this.poll);
    }
    this.raf = 0;
    this.poll = 0;
    this.last = 0;
    this.demos = [];
  }

  // Builds the demo into `host` and starts it. `color` is the preset's
  // color for the current theme; `heatStops` its four heat stops for it.
  add(host: HTMLElement, name: string, look: Partial<Look>, color: string, heatStops: string[], gradientStops: string[], reduced: boolean, play: boolean, script = false) {
    // The preview: its first line, at random (the rest are picked as it
    // plays); the line is also what the letters are measured on.
    if (script) name = SCRIPT_LINES[Math.floor(Math.random() * SCRIPT_LINES.length)];
    const demo = host.createSpan({ cls: "cursor-smith-pcard-demo" + (script ? " cursor-smith-roll-demo" : "") });
    const text = demo.createSpan({ cls: "cursor-smith-pcard-text cursor-smith-pcard-name", text: script ? "" : name });
    // The pill's sentence in two halves, the unwritten one invisible: the
    // letters keep their places (and the measure its width) as they appear.
    const written = script ? text.createSpan({ text: "" }) : null;
    const rest = script ? text.createSpan({ cls: "cursor-smith-roll-unwritten", text: name }) : null;
    const style = String(look.cursorStyle || "Box").toLowerCase();
    // The letter width is measured on the first frame; 8px is the shape's
    // first guess until then.
    const shape = shapeOf(look, color, gradientStops, 8);
    const dress = (el: HTMLElement, alpha: string) => {
      const st: Record<string, string> = { opacity: alpha, borderRadius: `${shape.radius}px` };
      if (shape.hollowWidth) {
        st.backgroundColor = "transparent";
        st.backgroundImage = "";
        st.border = `${shape.hollowWidth}px solid ${shape.fill}`;
        if (shape.gradient) { st.borderImage = `${shape.gradient} 1`; st.borderRadius = "0"; }
      } else {
        st.backgroundColor = shape.fill;
        st.backgroundImage = shape.gradient ?? "";
      }
      if (style === "line") st.width = `${shape.thick}px`;
      if (style === "underline") { st.height = `${shape.thick}px`; st.top = `${18 - shape.thick}px`; }
      el.setCssStyles(st);
    };
    const ghosts: HTMLElement[] = [];
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
    // A Box shows the letter it sits on, as "letter inside" does: the name
    // again inside the caret, clipped to it, in the color mode's color
    // (contrast, tinted or inverted, off the fill), moved the opposite way
    // so it lies over the real letters. Not on a hollow or translucent box,
    // where the real letter shows through.
    let inner: HTMLElement | null = null;
    let innerWritten: HTMLElement | null = null, innerRest: HTMLElement | null = null;
    if (style === "box" && look.showChar !== false && !shape.hollowWidth && !look.cursorTranslucent) {
      inner = caret.createSpan({ cls: "cursor-smith-pcard-caret-text", text: script ? "" : name });
      inner.setCssStyles({ color: readableGlyphColor(shape.fill, look.glyphColorMode ?? "contrast") });
      if (script) { innerWritten = inner.createSpan({ text: "" }); innerRest = inner.createSpan({ cls: "cursor-smith-roll-unwritten", text: name }); }
    }
    const d: Demo = {
      el: demo, shape, cycles: 0, done: false, particles: [], pool: [], spawnAcc: 0, lastTarget: 0, text, caret, inner, ghosts, look, color, heatStops, n: name.length, style, state: initialState(0), stepPx: 0,
      script, name, written, rest, innerWritten, innerRest, painted: "", line: name, poolMax: script ? 64 : POOL, scaled: !script, keyT: -1e9, hue: Math.random() * 360,
    };
    const win = host.ownerDocument?.defaultView ?? null;
    if (!play || reduced) {
      // Still, at the idle spot - painted now with a guessed letter width,
      // and once more from the loop with the measured one (a still demo
      // is a done one, dropped after that frame).
      d.state.target = d.state.lead = d.state.trail = idleAt(d.n);
      // The preview still: its line written, the caret after it.
      if (script) { d.state.target = d.state.lead = d.state.trail = d.n; d.state.buffer = name; }
      d.done = true;
    }
    // Painted once here (a guessed letter width), then from the loop.
    this.paint(d, 1, 1);
    if (!win || typeof win.requestAnimationFrame !== "function") return;
    // Another window (the settings window closed and opened again): the
    // old one's loop is gone with it.
    if (win !== this.win) { this.raf = 0; this.poll = 0; }
    this.demos.push(d);
    this.win = win;
    if (!this.raf && !this.poll) this.raf = win.requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    // A demo whose element left the document (the strip re-rendered) is
    // done; the loop ends with the last of them.
    // A demo that is done stays in the loop until it has settled at the
    // idle spot and its particles are gone.
    // The pill's demo is not let go when its element leaves the document:
    // Obsidian's settings take a page's rows out and put them back (another
    // page opened, a re-render), and a demo dropped then came back frozen -
    // mid-blink, with no cursor (the user: "sometimes the pill stops
    // displaying the cursor"). It waits instead; reset() lets it go.
    this.demos = this.demos.filter((d) => (d.script || d.el.isConnected) && !(d.done && d.stepPx > 0 && d.particles.length === 0 && d.state.lead === d.state.target && d.state.trail === d.state.lead));
    const live = this.demos.filter((d) => d.el.isConnected);
    for (const d of live) {
      if (!d.stepPx) {
        // The letters' own width, without the span's padding: a Range
        // over the text node measures the glyphs alone.
        const doc = d.text.ownerDocument;
        const range = doc.createRange();
        range.selectNodeContents(d.text);
        const w = range.getBoundingClientRect().width;
        if (w > 0 && d.n > 0) d.stepPx = w / d.n;
        else continue;
      }
      if (!d.scaled) this.fit(d);
      if (!d.done && d.script) {
        const before = d.state.target;
        stepScript(d.state, d.look, dt, now, () => this.nextLine(d));
        if (d.state.target !== before) this.onMove(d, before, now);
        for (const ev of d.state.events) {
          if (ev.do === "type") this.onType(d, ev.at, ev.ch, now);
          else if (ev.do === "back") this.onBack(d, ev.at, now);
          else this.onClear(d, ev.at, now);
        }
        d.state.events.length = 0;
        this.emit(d, dt, now);
      } else if (!d.done) {
        const before = d.state.target;
        const phaseBefore = d.state.phase;
        step(d.state, d.look, d.n, dt, now);
        if (d.state.target !== before) this.onMove(d, before, now);
        // A pass ends as the caret reaches the end of the name; after the
        // last one the demo heads for the idle spot and rests.
        if (phaseBefore === "type" && d.state.phase === "holdEnd" && ++d.cycles >= DEMO_CYCLES) { d.done = true; d.state.target = idleAt(d.n); }
        this.emit(d, dt, now);
      } else {
        step(d.state, d.look, d.n, dt, now, true);
      }
      this.moveParticles(d, dt, now);
      const heat = d.look.speedDemon && !d.look.speedDemonNoCursorHeat ? d.state.heat : 0;
      this.paint(d, blinkAlpha(d.state, d.look, now), 1 - heat);
    }
    this.raf = 0;
    if (!this.win) return;
    if (live.length) this.raf = this.win.requestAnimationFrame(this.tick);
    else if (this.demos.length) {
      // All away: look again in a while, and pick up from a fresh frame.
      this.last = 0;
      const win = this.win;
      this.poll = win.setTimeout(() => {
        this.poll = 0;
        if (!this.raf && this.win === win) this.raf = win.requestAnimationFrame(this.tick);
      }, 400);
    }
  };

  // The preview's next line: any but the one just played, and its script.
  private nextLine(d: Demo): ScriptAction[] {
    let line = d.line;
    for (let i = 0; i < 8 && line === d.line; i++) line = SCRIPT_LINES[Math.floor(Math.random() * SCRIPT_LINES.length)];
    d.line = line;
    return scriptFor(line, Math.random);
  }

  // The preview: scaled to fill its stage, left of center (once, with the
  // letters measured) - for the longest line, so every line has one size.
  private fit(d: Demo) {
    const stage = d.el.parentElement;
    const textW = d.stepPx * SCRIPT_MAX + 22;
    if (!stage || !(stage.clientWidth > 0) || !(textW > 0)) return;
    const k = Math.max(1, Math.min(2.6, (stage.clientWidth - 56) / textW));
    d.el.setCssStyles({ transform: `translateY(-50%) scale(${k.toFixed(3)})` });
    d.scaled = true;
  }

  // A particle from the pool, or none when the card has its share. With
  // `char`, a letter (a popped one) instead of a pixel, pulled down by `g`.
  private spawn(d: Demo, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, now: number, char = "", g = 0) {
    if (d.particles.length >= d.poolMax) return;
    let el = d.pool.pop() ?? null;
    if (!el) el = d.el.createSpan({ cls: "cursor-smith-pcard-particle", attr: { "aria-hidden": "true" } });
    el.setText(char);
    el.toggleClass("is-letter", !!char);
    el.setCssStyles(char
      ? { width: "auto", height: "auto", backgroundColor: "transparent", color, opacity: "1" }
      : { width: `${size}px`, height: `${size}px`, backgroundColor: color, opacity: "1" });
    d.particles.push({ el, x, y, vx, vy, t0: now, life, size, color, g });
  }

  // The preview, a letter written: it pops out of the caret (Popping
  // letters), Space sends fireworks up, the typewriter dips.
  private onType(d: Demo, i: number, ch: string, now: number) {
    const look = d.look;
    const x = i * d.stepPx;
    d.keyT = now;
    const color = () => {
      if (!look.popRainbow) return d.color;
      d.hue = (d.hue + 37) % 360;
      return `hsl(${d.hue.toFixed(0)}, 90%, 62%)`;
    };
    if (look.popEffects && look.popLetters && ch !== " ") {
      if (look.popLettersRise) this.spawn(d, x, -2, 0, -26, 700, 0, color(), now, ch);
      else this.spawn(d, x, -2, (Math.random() - 0.5) * 60, -(40 + Math.random() * 30), 800, 0, color(), now, ch, 160);
    }
    if (look.popEffects && look.fireworks && ch === " ") {
      const k = Math.round(8 * Math.min(2, look.fireworksQuantity ?? 1));
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2;
        const v = 30 + Math.random() * 20;
        this.spawn(d, x, -6, Math.cos(a) * v, Math.sin(a) * v - 10, 600, 2, color(), now);
      }
    }
  }

  // The preview, a typo backspaced: the letter evaporates or bursts apart,
  // as Backspace's effects do; the typewriter dips for the key.
  private onBack(d: Demo, at: number, now: number) {
    const look = d.look;
    d.keyT = now;
    if (!look.popEffects || !(look.backspaceEvaporate || look.backspaceDisintegrate)) return;
    for (let j = 0; j < 4; j++) {
      const x = (at + Math.random()) * d.stepPx;
      if (look.backspaceDisintegrate) this.spawn(d, x, 8, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, 450, 2, d.color, now);
      else this.spawn(d, x, 8, (Math.random() - 0.5) * 8, -(14 + Math.random() * 14), 700, 2, d.color, now);
    }
  }

  // The preview, the line cleared: what was deleted evaporates (rises and
  // fades) or bursts apart, as Backspace's effects do.
  private onClear(d: Demo, was: number, now: number) {
    const look = d.look;
    if (!look.popEffects || !(look.backspaceEvaporate || look.backspaceDisintegrate)) return;
    const k = Math.min(28, was);
    for (let j = 0; j < k; j++) {
      const x = (j / Math.max(1, k - 1)) * was * d.stepPx;
      if (look.backspaceDisintegrate) this.spawn(d, x, 8, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 550, 2, d.color, now);
      else this.spawn(d, x, 8, (Math.random() - 0.5) * 8, -(14 + Math.random() * 14), 900, 2, d.color, now);
    }
  }

  // On a keystroke (or the jump back): Pixel trail throws pixels from the
  // spot the caret leaves; Hot-head lays a little fire along the way.
  private onMove(d: Demo, from: number, now: number) {
    const px = d.stepPx;
    const look = d.look;
    const x0 = from * px;
    if (look.flameTrail) {
      const count = Math.round(3 * (look.flameTrailDensity ?? 1));
      const size = Math.max(2, Math.min(3, Math.round((look.flameTrailPixelSize ?? 4) / 2)));
      const g = (look.flameTrailGravity ?? 0) * 60;
      const ang = ((look.flameTrailGravityAngle ?? 0) * Math.PI) / 180;
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
  private emit(d: Demo, dt: number, now: number) {
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
      if (d.spawnAcc >= every) { d.spawnAcc = 0; this.spawnFlame(d, x + Math.random() * Math.max(2, d.stepPx - 2), now); }
    } else if (look.speedDemon && look.speedDemonSparks && st.heat > 0.6) {
      if (d.spawnAcc >= 90) {
        d.spawnAcc = 0;
        this.spawn(d, x + Math.random() * d.stepPx, 6, (Math.random() - 0.5) * 40, -(30 + Math.random() * 30), 450, 1, heatColor(d.color, d.heatStops, 0.9), now);
      }
    }
  }

  // One flame: a pixel that climbs and fades, in the fire's colors (or
  // the cursor's, with Fire in cursor color on).
  private spawnFlame(d: Demo, x: number, now: number) {
    const look = d.look;
    const rise = 24 * (look.hotHeadHeight ?? 0.55);
    const color = look.hotHeadFlat ? d.color : ["#ff6a1a", "#ffa62b", "#ffd166", "#fff1b8"][Math.floor(Math.random() * 4)];
    this.spawn(d, x, 4 + Math.random() * 4, (Math.random() - 0.5) * 6, -(rise + Math.random() * rise * 0.5) * 2, Math.min(600, look.hotHeadFade ?? 620) * 0.6, 2, color, now);
  }

  private moveParticles(d: Demo, dt: number, now: number) {
    const dtS = dt / 1000;
    const keep: Particle[] = [];
    for (const p of d.particles) {
      const age = (now - p.t0) / p.life;
      if (age >= 1) { p.el.setCssStyles({ opacity: "0" }); d.pool.push(p.el); continue; }
      p.vy += p.g * dtS;
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.el.setCssStyles({ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`, opacity: (1 - age).toFixed(2) });
      keep.push(p);
    }
    d.particles = keep;
  }

  // Puts the caret (and the ghosts) where the state says. `cold` is 1 - heat.
  private paint(d: Demo, alpha: number, cold: number) {
    const px = d.stepPx || 8;
    const s = d.state;
    const from = Math.min(s.lead, s.trail) * px;
    const to = Math.max(s.lead, s.trail) * px;
    // A stretch of at most two letters, so the caret stays inside the cell.
    const stretch = Math.min(to - from, px * 2);
    const base = d.style === "line" ? d.shape.thick : Math.max(1, px - 1);
    const width = base + stretch;
    // Heat warms a flat fill; a gradient keeps its colors (as the engine's
    // custom ramp flattens a gradient, the demo leaves it be).
    const heated = cold < 1 && !d.shape.gradient;
    const color = heated ? heatColor(d.color, d.heatStops, 1 - cold) : d.shape.fill;
    // The preview's text, written so far (typos and all). The unwritten
    // half only ever held the first line, to measure the letters by.
    if (d.script && d.painted !== s.buffer) {
      d.painted = s.buffer;
      d.written?.setText(s.buffer);
      d.innerWritten?.setText(s.buffer);
      if (d.stepPx) { d.rest?.setText(""); d.innerRest?.setText(""); }
    }
    // The typewriter's dip: down and back over the strike's length, after
    // each letter written.
    let dip = 0;
    if (d.script && d.look.typewriter && d.look.typewriterSpring) {
      const k = (this.last - d.keyT) / Math.max(60, d.look.typewriterStrikeMs ?? 240);
      if (k >= 0 && k < 1) dip = Math.sin(Math.PI * k) * ((d.look.typewriterDepth ?? 18) / 100) * 12;
    }
    const styles: Record<string, string> = {
      transform: dip ? `translate(${from.toFixed(2)}px, ${dip.toFixed(2)}px)` : `translateX(${from.toFixed(2)}px)`,
      width: `${width.toFixed(2)}px`,
      opacity: String(d.shape.alphaScale * alpha),
    };
    if (d.shape.hollowWidth) styles.borderColor = color;
    else if (heated) styles.backgroundColor = color;
    if (d.look.crtEffect && d.look.glow) styles.boxShadow = `0 0 6px ${color}`;
    if (d.look.energyEffect) {
      // A band of light sliding along the caret, top to bottom, at the
      // preset's speed.
      const t = ((this.last * 0.0006 * (d.look.energySpeed ?? 1)) % 1) * 300 - 100;
      styles.backgroundImage = `linear-gradient(180deg, ${color} 0%, #ffffff 50%, ${color} 100%)`;
      styles.backgroundSize = "100% 300%";
      styles.backgroundPosition = `0 ${t.toFixed(1)}%`;
    }
    d.caret.setCssStyles(styles);
    // The letter copy inside a Box stays over the real letters: it is
    // moved back by the caret's own offset.
    if (d.inner) d.inner.setCssStyles({ transform: `translateX(${(-from).toFixed(2)}px)` });
    // Ghosts: newest brightest.
    const fade = d.look.trailFadeMs ?? 300;
    const now = this.last;
    for (let i = 0; i < d.ghosts.length; i++) {
      const g = s.ghosts[s.ghosts.length - 1 - i];
      const el = d.ghosts[i];
      if (!g) { el.setCssStyles({ opacity: "0" }); continue; }
      const life = 1 - (now - g.t0) / fade;
      el.setCssStyles({ transform: `translateX(${(g.at * px).toFixed(2)}px)`, width: `${base.toFixed(2)}px`, opacity: (Math.max(0, life) * 0.6 * d.shape.alphaScale).toFixed(3) });
    }
  }
}
