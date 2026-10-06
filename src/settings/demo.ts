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
// SCRIPT_LINES - one per roll (the user: "one line per randomize click"),
// never the last roll's - typed fast, a typo now and then caught and
// backspaced, then a little play with the cursor - quick jumps word to
// word, a few steps letter by letter - then cleared and typed again (new
// typos, new play), for as long as the page is open; with what a roll is most about added on top: letters
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
import { blinkAlphaAt, blinkSegments, smoothCatchRate, smoothTypingRate } from "../util/motion";
import { GLIDE_LINEAR_SPAN, GLIDE_SPRING_FREQ, GLIDE_SPRINGY_DAMPING, TW_CAPITAL_DEPTH, TW_CAPITAL_TIME, TW_SPRING_DOWN } from "../constants";
import { hexToRgbTuple, readableGlyphColor, rgbTupleToHex } from "../util/color";
import { BACKMAN_BEND_KICK, BACKMAN_BEND_MAX, BACKMAN_BIG, BACKMAN_GROW, backManBite, backManChew, backManDown, backManEye, backManOutline, backManShape, backManSpring } from "../effects/effects-backman";
import type { BackManCmd } from "../effects/effects-backman";
import { SHRED_FAN, SHRED_FALL_MS, SHRED_FEED_MS, SHRED_HOLD_MS, SHRED_RIBBONS, shredDash, shredFeed } from "../effects/effects-shredder";
import { HOLE_FALL_MS, HOLE_HOLD_MS, holeFall, holeOpen, holeSag } from "../effects/effects-rabbithole";

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

// The caret as the engine draws it (measure.ts: lineSpan, caretThickness,
// underlineThickness; paint-shape.ts: the outline), at the preview's size:
// its letters are 12px where the editor's are 16, so every px setting is
// taken at three quarters, and its line box is the editor's 1.5 line height
// (18px) inside the demo's 22px cell. A Box is the whole line box, a letter
// wide; a Line its thickness to the tenth of a pixel, Cursor height of the
// line, centered; an Underline its thickness (or 15% of the line) at the
// line's foot; a hollow Box its outline's width.
export interface Geometry { top: number; h: number; lineW: number; lineTop: number; lineH: number; ulH: number; outline: number }
export const PREVIEW_SCALE = 0.75;
export const PREVIEW_LINE = 18;
export const PREVIEW_TOP = 2;
export function geometryOf(look: Partial<Look>): Geometry {
  const k = PREVIEW_SCALE, LH = PREVIEW_LINE, TOP = PREVIEW_TOP;
  const w = Number(look.caretWidthPx);
  const lineW = (Number.isFinite(w) && w > 0 ? Math.max(0.5, Math.min(7, w)) : 2) * k;
  const pct = Math.max(20, Math.min(100, Number(look.caretHeightPct ?? 100) || 100)) / 100;
  const lineH = LH * pct;
  const u = look.underlineWidthPx || 0;
  const ulH = u > 0 ? Math.max(0.5, Math.min(u, 7)) * k : Math.max(2, Math.round((LH / k) * 0.15)) * k;
  const outline = Math.max(0.5, Math.min(6, look.boxHollowWidth || 2)) * k;
  return { top: TOP, h: LH, lineW, lineTop: TOP + (LH - lineH) / 2, lineH, ulH, outline };
}

// Milliseconds: one "keystroke", the pause at the end of the word, the
// pause after the jump back.
const TYPE_MS = 170;
const HOLD_END_MS = 650;
const HOLD_START_MS = 450;
// Particles per card, at most (the real fire needs a few dozen).
const POOL = 60;
// The preview's Hot-head: its grid square (the engine's font size over
// HOT_PX_DIVISOR, at the demo's 12px) and its block shapes, biggest first -
// fire.ts's HOT_BLOCK_SHAPES, the notched ones left out (an element is a
// rectangle) - as [width, height] in squares.
const FIRE_UNIT = 2.6;
const FIRE_SHAPES: [number, number][] = [[2, 4], [3, 3], [2, 3], [3, 2], [1, 4], [2, 2], [1, 3], [3, 1], [2, 1], [1, 2], [1, 1]];
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
  // The preview's glide, as the engine's (carets.ts): a spring's velocity
  // (Smooth, Springy), a Linear run (from, to, how far along).
  gv: number;
  run: { from: number; to: number; u: number } | null;
}

export function initialState(now: number): DemoState {
  return { target: 0, lead: 0, trail: 0, phase: "type", phaseMs: 0, lastKeyMs: now, heat: 0, ghosts: [], buffer: "", queue: [], wait: 0, events: [], gv: 0, run: null };
}

// The preview's lines: one at random for each roll, never the last
// roll's. At most SCRIPT_MAX letters, so the text keeps one size (a
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
  "Am I a Cursor or Caret?",
  "One Cursor to Rule Them ALL",
  "way too maaaaaany options",
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
  return settle(s, look, dt, now, glide(s, look, dt));
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
  return settle(s, look, dt, now, glide(s, look, dt));
}

// Smooth movement, the engine's way (carets.ts, the glide): Glide speed on
// its exponential scale (smoothCatchRate), raised to the typing rate
// (smoothTypingRate) while typing keeps up; then Glide style - Ease out
// chases, Smooth and Springy ride a spring (critically damped, or at 0.55
// for the overshoot), Linear runs straight at one speed and stops dead;
// typing that keeps up always chases (a letter should not bounce). In
// letters, not px; the arrival test likewise. Answers whether it moved the
// leading edge (Smooth movement on).
export function glide(s: DemoState, look: Partial<Look>, dt: number): boolean {
  if (!look.smoothEnabled) return false;
  const dtS = Math.min(0.1, dt / 1000);
  const typing = !!look.smoothAdaptive && s.phase === "type";
  let rate = Math.max(0.5, smoothCatchRate(look.catchUpSpeed ?? 0.55));
  if (typing) rate = Math.max(rate, smoothTypingRate(look.maxCatchUpSpeed ?? 0.85));
  const style = look.smoothStyle ?? "ease";
  if (style !== "linear" || typing) s.run = null;
  if (style === "linear" && !typing) {
    s.gv = 0;
    if (!s.run || s.run.to !== s.target) s.run = { from: s.lead, to: s.target, u: 0 };
    s.run.u = Math.min(1, s.run.u + (dtS * rate) / GLIDE_LINEAR_SPAN);
    s.lead = s.run.from + (s.run.to - s.run.from) * s.run.u;
  } else if ((style === "smooth" || style === "springy") && !typing) {
    const w = GLIDE_SPRING_FREQ * rate;
    const zeta = style === "springy" ? GLIDE_SPRINGY_DAMPING : 1;
    const steps = Math.max(1, Math.min(16, Math.ceil(dtS * 240)));
    const h = dtS / steps;
    for (let i = 0; i < steps; i++) {
      s.gv += (w * w * (s.target - s.lead) - 2 * zeta * w * s.gv) * h;
      s.lead += s.gv * h;
    }
  } else {
    s.gv = 0;
    s.lead += (s.target - s.lead) * (1 - Math.exp(-rate * dtS));
  }
  if (Math.abs(s.target - s.lead) < 0.03 && Math.abs(s.gv) < 0.8) { s.lead = s.target; s.gv = 0; }
  return true;
}

// The springs, the heat and the ghosts' fading, after the timeline moved.
function settle(s: DemoState, look: Partial<Look>, dt: number, now: number, glided = false): DemoState {
  const dtS = Math.min(0.1, dt / 1000);
  // The leading edge: the engine's glide (the preview's: glide()), or a snap.
  if (glided) {
    // Moved already.
  } else if (look.smoothEnabled) {
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

// The preview's blink, the engine's clock (paint-blink.ts): held lit after
// a move for Don't blink while typing's hold (the Blink delay, at least
// 450 ms) - none with it off - then a cycle that starts fully on, and solid
// again after Stop after cycles. With Breathing the caret keeps its
// opacity and breathes in size instead (`breath`, 0 .. 1).
export function blinkReal(s: DemoState, look: Partial<Look>, now: number): { alpha: number; breath: number } {
  if (!look.blinkingEnabled) return { alpha: 1, breath: 0 };
  const speed = Math.max(0, look.blinkSpeed ?? 1);
  if (!(speed > 0)) return { alpha: 1, breath: 0 };
  const hold = look.smoothStopBlinking ? Math.max(450, look.blinkDelayMs ?? 0) : 0;
  const elapsed = now - s.lastKeyMs - hold;
  if (!(elapsed > 0)) return { alpha: 1, breath: 0 };
  const stop = Math.max(0, look.blinkStopAfter ?? 0);
  if (stop > 0 && elapsed >= stop * blinkSegments(speed).period) return { alpha: 1, breath: 0 };
  const a = blinkAlphaAt(elapsed, speed, look.blinkOnOffBalance ?? 0.5, look.blinkFade ?? 0.15);
  return look.blinkBreathing ? { alpha: 1, breath: 1 - a } : { alpha: a, breath: 0 };
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
  // The preview's particles that move and draw as the engine's do (the
  // rest are plain fading pixels): a thrown letter, a risen one, an
  // evaporating one, an x over a deleted letter, a Hot-head chunk or spark,
  // a firework shell or spark; a letter going into Back-man, through the
  // Shredder (band: which ribbon, -1 the part not through) or into the
  // Rabbit hole.
  kind?: "letter" | "rise" | "evap" | "xout" | "fire" | "spark" | "shell" | "burst" | "meal" | "shred" | "hole";
  band?: number;
  rot?: number;
  shape0?: number;
  phase?: number;
  delay?: number;
  colors?: string[];
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
  // The preview's letters, one element each (Typewriter's ink is per
  // letter), with when each was typed; Hot-head's burning marks (where
  // letters were typed, where the caret landed); the fire's emission
  // carried over between frames; the last key's kind (the carriage
  // advance is a typed letter's, not Backspace's).
  chars: { el: HTMLElement; ch: string; t: number; wet: boolean }[];
  // The caret as the engine measures it, at the preview's size (geometryOf);
  // whether the last key was a capital (Typewriter's deeper stroke); the
  // blink's breath (Breathing).
  geo: Geometry | null;
  keyHeavy: boolean;
  breath: number;
  // Back-man (effects-backman.ts): its run of chewing (backManChew), its
  // bend's spring, its mouth's corner (x, for the letters going in), and
  // whether the caret wears it now (to put the caret back once).
  bmChew: { c0: number; t: number; big: boolean } | null;
  bmMouth: number;
  // Shredder's run of cutting and where it cuts (a Line's); Rabbit hole's
  // run of eating and where its hole is (an Underline's); which of the two
  // the caret wears now (to put it back once).
  shredRun: { t0: number; t: number } | null;
  cut: number;
  holeRun: { t0: number; t: number } | null;
  holeAt: [number, number];
  eatOn: "" | "shred" | "hole";
  bm: { bend: number; v: number; at: number };
  bmOn: boolean;
  burns: { x: number; t: number }[];
  fireAcc: number;
  keyKind: "type" | "back";
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
  // The preview's line for the last roll: the next roll's is another.
  private lastLine = "";

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
    // The preview: its line, at random but not the last roll's; also what
    // the letters are measured on.
    if (script) {
      do name = SCRIPT_LINES[Math.floor(Math.random() * SCRIPT_LINES.length)];
      while (name === this.lastLine && SCRIPT_LINES.length > 1);
      this.lastLine = name;
    }
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
    // The caret the engine measures (the cards' too, since the preview's
    // was made real: "improve the demo presets pills too", the user).
    {
      const g = geometryOf(look);
      const real = (el: HTMLElement) => {
        if (style === "line") el.setCssStyles({ top: `${g.lineTop}px`, height: `${g.lineH}px`, width: `${g.lineW}px` });
        else if (style === "underline") el.setCssStyles({ top: `${g.top + g.h - g.ulH}px`, height: `${g.ulH}px` });
        else el.setCssStyles({ top: `${g.top}px`, height: `${g.h}px` });
        if (shape.hollowWidth) el.setCssStyles({ borderWidth: `${g.outline}px` });
      };
      real(caret);
      for (const gh of ghosts) real(gh);
    }
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
      // Over the real letters: the caret's top is the line box's, not 5px.
      inner.setCssStyles({ top: `-${PREVIEW_TOP}px` });
      inner.setCssStyles({ color: readableGlyphColor(shape.fill, look.glyphColorMode ?? "contrast") });
      if (script) { innerWritten = inner.createSpan({ text: "" }); innerRest = inner.createSpan({ cls: "cursor-smith-roll-unwritten", text: name }); }
    }
    const d: Demo = {
      el: demo, shape, cycles: 0, done: false, particles: [], pool: [], spawnAcc: 0, lastTarget: 0, text, caret, inner, ghosts, look, color, heatStops, n: name.length, style, state: initialState(0), stepPx: 0,
      script, name, written, rest, innerWritten, innerRest, painted: "", line: name, chars: [], burns: [], fireAcc: 0, keyKind: "type", geo: geometryOf(look), keyHeavy: false, breath: 0, bmChew: null, bmMouth: 0, shredRun: null, cut: 0, holeRun: null, holeAt: [0, 0], eatOn: "", bm: { bend: 0, v: 0, at: 0 }, bmOn: false, poolMax: script ? 160 : POOL, scaled: !script, keyT: -1e9, hue: Math.random() * 360,
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
        // A jump lands (two letters or more, the engine's jump): Hot-head
        // flares where the caret came down.
        if (Math.abs(d.state.target - before) >= 2 && d.state.phase === "jump" && d.look.hotHead) d.burns.push({ x: d.state.target, t: now });
        for (const ev of d.state.events) {
          if (ev.do === "type") this.onType(d, ev.at, ev.ch, now);
          else if (ev.do === "back") this.onBack(d, ev.at, ev.ch, now);
          else this.onClear(d, d.painted, now);
        }
        d.state.events.length = 0;
        if (d.look.hotHead) this.burn(d, dt, now);
        this.emit(d, dt, now);
      } else if (!d.done) {
        const before = d.state.target;
        const phaseBefore = d.state.phase;
        step(d.state, d.look, d.n, dt, now);
        if (d.state.target !== before) this.onMove(d, before, now);
        if (d.state.target === before + 1 && phaseBefore === "type") this.onType(d, before, d.name.charAt(before) || " ", now);
        else if (Math.abs(d.state.target - before) >= 2 && d.look.hotHead) d.burns.push({ x: d.state.target, t: now });
        if (d.look.hotHead) this.burn(d, dt, now);
        // A pass ends as the caret reaches the end of the name; after the
        // last one the demo heads for the idle spot and rests.
        if (phaseBefore === "type" && d.state.phase === "holdEnd" && ++d.cycles >= DEMO_CYCLES) { d.done = true; d.state.target = idleAt(d.n); }
        this.emit(d, dt, now);
      } else {
        step(d.state, d.look, d.n, dt, now, true);
      }
      this.moveParticles(d, dt, now);
      const heat = d.look.speedDemon && !d.look.speedDemonNoCursorHeat ? d.state.heat : 0;
      const b = d.done && !d.script ? { alpha: 1, breath: 0 } : blinkReal(d.state, d.look, now);
      d.breath = b.breath;
      this.paint(d, b.alpha, 1 - heat);
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

  // The preview's line again, with a new script (other typos, other play):
  // the next line waits for the next roll.
  private nextLine(d: Demo): ScriptAction[] {
    return scriptFor(d.line, Math.random);
  }

  // The preview: scaled to fill its stage, left of center (once, with the
  // letters measured) - for the longest line, so every line has one size.
  private fit(d: Demo) {
    const stage = d.el.parentElement;
    const textW = d.stepPx * SCRIPT_MAX + 22;
    if (!stage || !(stage.clientWidth > 0) || !(textW > 0)) return;
    // About the editor's own size (its 16px over the demo's 12): bigger read
    // as a banner ("make the text smaller", the user); smaller on a phone.
    const k = Math.max(0.7, Math.min(1.45, (stage.clientWidth - 56) / textW));
    d.el.setCssStyles({ transform: `translateY(-50%) scale(${k.toFixed(3)})` });
    d.scaled = true;
  }

  // A particle from the pool, or none when the card has its share. With
  // `char`, a letter (a popped one) instead of a pixel, pulled down by `g`.
  private spawn(d: Demo, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, now: number, char = "", g = 0, kind?: Particle["kind"]): Particle | null {
    if (d.particles.length >= d.poolMax) return null;
    let el = d.pool.pop() ?? null;
    if (!el) el = d.el.createSpan({ cls: "cursor-smith-pcard-particle", attr: { "aria-hidden": "true" } });
    el.setText(char);
    el.toggleClass("is-letter", !!char);
    el.setCssStyles(char
      ? { width: "auto", height: "auto", backgroundColor: "transparent", color, opacity: "1", fontSize: "", filter: "", zIndex: kind === "meal" ? "0" : "" }
      : { width: `${size}px`, height: `${size}px`, backgroundColor: color, opacity: "1", fontSize: "", filter: "", zIndex: "" });
    const part: Particle = { el, x, y, vx, vy, t0: now, life, size, color, g, kind };
    d.particles.push(part);
    return part;
  }

  // --- The preview's effects, as the engine's (1.7.7) -------------------
  // The demo's letters are 12px where an editor's are about 16: the
  // engine's distances and speeds are taken at three quarters.

  // A color with Rainbow's sweep (Pop effects), or the cursor's.
  private popColor(d: Demo): string {
    if (!d.look.popRainbow) return d.color;
    d.hue = (d.hue + 37) % 360;
    return `hsl(${d.hue.toFixed(0)}, 85%, 60%)`;
  }

  // Hot-head (effects-fire.ts, fire.ts): the letters just typed burn - the
  // fire lit at the tops of the glyphs along the last few letters (Trail
  // over text) and where a jump lands, a kick up within a narrow cone,
  // buoyant, swaying a little; chunks of pixels (the engine's block
  // shapes, rectangles here) breaking down as they age; three colors from
  // the fire's ramp down to the cursor's own; a spark with each chunk.
  private burn(d: Demo, dt: number, now: number) {
    const look = d.look;
    const linger = 1100;
    const keep = 1 + Math.round((look.hotHeadTrail ?? 6) * 0.6);
    d.burns = d.burns.filter((b) => now - b.t < linger).slice(-keep - 2);
    if (!d.burns.length) return;
    const weights = d.burns.map((b) => Math.max(0, 1 - (now - b.t) / linger));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) return;
    d.fireAcc += (dt / 1000) * 125 * 0.75 * (look.hotHeadQuantity ?? 1) * Math.min(1.6, 0.45 + 0.55 * sum);
    const cw = d.stepPx || 7;
    const fade = look.hotHeadFade ?? 620;
    const heightMul = (look.hotHeadHeight ?? 0.55) / 0.55;
    const spread = (look.hotHeadSpread ?? 4) * 0.1 * cw;
    const right = ((d.script ? d.state.buffer.length : d.n) + 0.5) * cw;
    for (; d.fireAcc >= 1; d.fireAcc--) {
      let r = Math.random() * sum, bi = 0;
      while (bi < d.burns.length - 1 && (r -= weights[bi]) > 0) bi++;
      const b = d.burns[bi];
      const x = (b.x + Math.random()) * cw + (Math.random() - 0.5) * spread;
      if (x < -cw * 0.5 || x > right) continue;
      const y = 6 + (0.02 - Math.random() * 0.09) * 22;
      const mag = (12 + 30 * Math.sqrt(Math.random())) * heightMul;
      const ang = (Math.random() * 2 - 1) * 0.45;
      const life0 = fade * (0.25 + 0.75 * Math.pow(Math.random(), 2.2));
      const share = life0 / fade;
      const shape0 = Math.max(0, Math.min(FIRE_SHAPES.length - 1, Math.round((1 - share) * (FIRE_SHAPES.length - 1) + (Math.random() - 0.5) * 3)));
      const f = this.spawn(d, x, y, Math.sin(ang) * mag, -Math.cos(ang) * mag, life0, FIRE_UNIT, d.color, now, "", -40 * heightMul, "fire");
      if (f) { f.shape0 = shape0; f.phase = Math.random() * Math.PI * 2; }
      const sp = this.spawn(d, x, y, Math.sin(ang) * mag * 0.5, -Math.cos(ang) * mag * 1.9 - 4, life0 * 0.6, Math.max(1, FIRE_UNIT * 0.85), d.color, now, "", -40 * heightMul * 1.9, "spark");
      if (sp) sp.phase = Math.random() * Math.PI * 2;
    }
  }

  // Fire's color at a temperature (1 fresh .. 0 spent): three steps up the
  // engine's ramp - the cursor's own color, amber, orange - never past
  // half of it; Fire in cursor color keeps the cursor's.
  private fireColor(d: Demo, temp: number): string {
    if (d.look.hotHeadFlat) return d.color;
    const q = Math.round(Math.max(0, Math.min(1, Math.pow(temp, 0.55))) * 3) / 3;
    const pos = q * 0.5;
    const stops: [number, number[]][] = [[0, hexToRgbTuple(d.color.startsWith("#") ? d.color : "#ff8000")], [0.12, [255, 187, 0]], [0.42, [255, 128, 0]], [0.72, [255, 61, 13]]];
    let i = 0;
    while (i < stops.length - 2 && pos > stops[i + 1][0]) i++;
    const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
    const f = Math.max(0, Math.min(1, (pos - p0) / (p1 - p0)));
    return rgbTupleToHex([0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)));
  }

  // Fireworks (effects-pops.ts): a shell from the caret up above the line,
  // then a burst - sparks out and falling under gravity, twinkling out.
  private firework(d: Demo, x: number, now: number) {
    const look = d.look;
    const colors = look.popRainbow ? [this.popColor(d), this.popColor(d), this.popColor(d)] : [d.color, d.color];
    const shell = this.spawn(d, x, 2, 0, -(22 * 1.1) / 0.26, 260, 2, colors[0], now, "", 0, "shell");
    if (shell) { shell.colors = colors; shell.delay = Math.max(0.4, Math.min(3, look.fireworksQuantity ?? 1)); }
  }

  private burst(d: Demo, x: number, y: number, colors: string[], qty: number, now: number) {
    const n = Math.round(10 * qty);
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + Math.random() * 0.4;
      const v = 28 + Math.random() * 30;
      this.spawn(d, x, y, Math.cos(a) * v, Math.sin(a) * v - 12, 620 * (0.7 + Math.random() * 0.3), 2, colors[j % colors.length], now, "", 315, "burst");
    }
  }

  // The preview, a letter written: it pops out of the caret (Popping
  // letters), Space sends fireworks up, the typewriter dips.
  private onType(d: Demo, i: number, ch: string, now: number) {
    const look = d.look;
    const x = i * d.stepPx;
    d.keyT = now;
    d.keyKind = "type";
    d.keyHeavy = ch !== ch.toLowerCase() && ch === ch.toUpperCase();
    if (look.hotHead) d.burns.push({ x: i, t: now });
    // Popping letters: thrown up and spinning, falling back (0.45 s), or
    // risen straight up and faded (0.65 s).
    if (look.popEffects && look.popLetters && ch.trim()) {
      if (look.popLettersRise) {
        const pr = this.spawn(d, x, 4, 0, 0, 650, 0, this.popColor(d), now, ch, 0, "rise");
        if (pr) pr.el.setCssStyles({ fontSize: "11.4px" });
      } else {
        const pl = this.spawn(d, x, 4, (Math.random() - 0.5) * 90, -112 - Math.random() * 98, 450, 0, this.popColor(d), now, ch, 240, "letter");
        if (pl) { pl.rot = (Math.random() - 0.5) * 4; pl.el.setCssStyles({ fontSize: "10.8px" }); }
      }
    }
    if (look.popEffects && look.fireworks && ch === " ") this.firework(d, x + d.stepPx / 2, now);
  }

  // The preview, a typo backspaced: the letter evaporates or bursts apart,
  // as Backspace's effects do; the typewriter dips for the key.
  private onBack(d: Demo, at: number, ch: string, now: number) {
    // Back-man's bite: chewed at its own pace, kicking its bend leftward,
    // where it eats.
    if (d.look.popEffects && d.look.backMan && d.style === "box") {
      if (now > d.bm.at) { backManSpring(d.bm, (now - d.bm.at) / 1000); d.bm.at = now; }
      d.bm.v -= BACKMAN_BEND_KICK;
      d.bmChew = backManChew(d.bmChew, now, false);
    }
    // Shredder's blades out (a Line's), Rabbit hole open (an Underline's).
    if (d.look.popEffects && d.look.shredder && d.style === "line") d.shredRun = d.shredRun && now - d.shredRun.t < SHRED_HOLD_MS ? { t0: d.shredRun.t0, t: now } : { t0: now, t: now };
    if (d.look.popEffects && d.look.rabbitHole && d.style === "underline") d.holeRun = d.holeRun && now - d.holeRun.t < HOLE_HOLD_MS ? { t0: d.holeRun.t0, t: now } : { t0: now, t: now };
    d.keyT = now;
    d.keyKind = "back";
    d.keyHeavy = false;
    if (d.look.hotHead) d.burns.push({ x: at, t: now });
    this.deleted(d, [{ ch, at }], now, true);
  }

  // Letters deleted (a typo backspaced, or the line cleared), as the
  // engine shows them: Typewriter's X-out overtypes each with an x; Pop
  // effects' evaporation lifts each letter itself, swaying and spreading
  // as it rises and fades (1.1 s, a little after the one before);
  // disintegration bursts each apart in flipped colors.
  private deleted(d: Demo, letters: { ch: string; at: number }[], now: number, bite = false) {
    const look = d.look;
    const cw = d.stepPx || 7;
    // A Backspace with Back-man on: it eats the letter, the others stand
    // aside (a line cleared is not its bite).
    const backMan = bite && d.bmChew && !!(look.popEffects && look.backMan && d.style === "box");
    // Down when the chomp it fell in shuts.
    const down = d.bmChew ? backManDown(d.bmChew, now) - now : 0;
    // ...Shredder and Rabbit hole the same, on their own cursors.
    const shred = bite && !!d.shredRun && !!(look.popEffects && look.shredder && d.style === "line");
    const hole = bite && !!d.holeRun && !!(look.popEffects && look.rabbitHole && d.style === "underline");
    letters.forEach(({ ch, at }, k) => {
      if (!ch.trim()) return;
      const x = at * cw;
      if (backMan) {
        if (k < 12) this.spawn(d, x, 11, 0, 0, down, 0, "var(--text-normal)", now, ch, 0, "meal");
        return;
      }
      if (shred) {
        for (let b = -1; k < 12 && b < SHRED_RIBBONS; b++) {
          const part = this.spawn(d, x, 11, 0, 0, SHRED_FEED_MS + SHRED_FALL_MS, 0, "var(--text-normal)", now, ch, 0, "shred");
          if (part) part.band = b;
        }
        return;
      }
      if (hole) {
        if (k < 12) this.spawn(d, x, 11, 0, 0, HOLE_FALL_MS, 0, "var(--text-normal)", now, ch, 0, "hole");
        return;
      }
      if (look.typewriter && look.typewriterTape) {
        const ghost = this.spawn(d, x, 11, 0, 0, 500, 0, "var(--text-normal)", now, ch, 0, "xout");
        if (ghost) ghost.el.setCssStyles({ opacity: "0.45" });
        this.spawn(d, x, 11, 0, 0, 500, 0, d.color, now, "x", 0, "xout");
      }
      if (look.popEffects && look.backspaceEvaporate) {
        const color = look.popRainbow ? this.popColor(d) : "var(--text-normal)";
        const e = this.spawn(d, x, 11, 0, 0, 1100, 0, color, now, ch, 0, "evap");
        if (e) { e.delay = k * 16; e.phase = Math.random() * Math.PI * 2; }
      }
      if (look.popEffects && look.backspaceDisintegrate) {
        for (let j = 0; j < 5; j++) {
          const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 50;
          const b = this.spawn(d, x + Math.random() * cw, 6 + Math.random() * 10, Math.cos(a) * v, Math.sin(a) * v, 500, 2, "var(--text-normal)", now);
          if (b) b.el.setCssStyles({ filter: "invert(1)" });
        }
      }
    });
  }

  // The preview, the line cleared: what was deleted evaporates (rises and
  // fades) or bursts apart, as Backspace's effects do.
  private onClear(d: Demo, text: string, now: number) {
    // Nearest the caret (the end) first, as Backspace takes them.
    const letters = Array.from(text).map((ch, at) => ({ ch, at })).reverse();
    this.deleted(d, letters, now);
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
    } else if (look.speedDemon && look.speedDemonSparks && st.heat > 0.6) {
      if (d.spawnAcc >= 90) {
        d.spawnAcc = 0;
        this.spawn(d, x + Math.random() * d.stepPx, 6, (Math.random() - 0.5) * 40, -(30 + Math.random() * 30), 450, 1, heatColor(d.color, d.heatStops, 0.9), now);
      }
    }
  }

  private moveParticles(d: Demo, dt: number, now: number) {
    const dtS = dt / 1000;
    const keep: Particle[] = [];
    const born: (() => void)[] = [];
    for (const p of d.particles) {
      const elapsed = now - p.t0 - (p.delay && p.kind === "evap" ? p.delay : 0);
      const age = Math.max(0, elapsed / p.life);
      if (age >= 1) {
        p.el.setCssStyles({ opacity: "0", transform: "", width: "", height: "", clipPath: "", transformOrigin: "" });
        if (p.kind === "shell") born.push(() => this.burst(d, p.x, p.y - 22 * 1.1, p.colors ?? [p.color], p.delay ?? 1, now));
        d.pool.push(p.el);
        continue;
      }
      const t = age;
      if (p.kind === "letter") {
        // The engine's throw: a straight start, gravity, a spin.
        const e = elapsed / 1000;
        const x = p.x + p.vx * e, y = p.y + p.vy * e + 0.5 * p.g * e * e;
        p.el.setCssStyles({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${((p.rot ?? 0) * e * 5).toFixed(2)}rad)`, opacity: (1 - t).toFixed(2) });
      } else if (p.kind === "rise") {
        const y = p.y - 22 * 0.9 * (1 - Math.pow(1 - t, 3));
        p.el.setCssStyles({ transform: `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px)`, opacity: (0.7 * Math.pow(1 - t, 1.4)).toFixed(2) });
      } else if (p.kind === "evap") {
        if (elapsed < 0) { p.el.setCssStyles({ opacity: "0" }); keep.push(p); continue; }
        const y = p.y - 22 * 1.2 * (1 - Math.pow(1 - t, 2));
        const x = p.x + Math.sin((p.phase ?? 0) + t * 5) * 22 * 0.16 * t;
        p.el.setCssStyles({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 + 0.35 * t).toFixed(2)})`, opacity: (0.85 * (1 - t)).toFixed(2) });
      } else if (p.kind === "meal") {
        const e = 1 - (1 - t) * (1 - t);
        const x = p.x + (d.bmMouth - (d.stepPx || 7) / 2 - p.x) * e;
        p.el.setCssStyles({ transform: `translate(${x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${Math.max(0.05, 1 - 0.8 * e).toFixed(2)})`, opacity: "1" });
      } else if (p.kind === "shred") {
        // Through the cut (d.cut): the part not through whole, each ribbon
        // a band of the letter, sheared about the cut so they fan out,
        // falling and fading as the engine's (shredFeed).
        const cw = d.stepPx || 7;
        const f = shredFeed({ char: "", x: p.x, w: cw, top: 0, h: PREVIEW_LINE, font: "", color: "", t0: p.t0 }, d.cut, now);
        const left = p.x + f.dx, rel = d.cut - left, b = p.band ?? -1;
        if (b < 0) {
          p.el.setCssStyles({ transform: `translate(${left.toFixed(1)}px, ${p.y.toFixed(1)}px)`, clipPath: `inset(0 0 0 ${Math.max(0, rel).toFixed(1)}px)`, opacity: rel >= cw ? "0" : "1" });
        } else {
          const n = SHRED_RIBBONS, a = -(b - (n - 1) / 2) * SHRED_FAN;
          p.el.setCssStyles({
            transformOrigin: `${rel.toFixed(1)}px 50%`,
            transform: `translate(${left.toFixed(1)}px, ${(p.y + f.dy).toFixed(1)}px) skewY(${Math.atan(a).toFixed(3)}rad)`,
            clipPath: `inset(${((b / n) * 100 + 2).toFixed(1)}% ${Math.max(0, cw - rel).toFixed(1)}px ${(((n - 1 - b) / n) * 100 + 2).toFixed(1)}% 0)`,
            opacity: rel <= 0 ? "0" : f.alpha.toFixed(2),
          });
        }
      } else if (p.kind === "hole") {
        // Pulled into the hole (d.holeAt), swirling and shrinking (holeFall).
        const cw = d.stepPx || 7;
        const f = holeFall({ char: "", cx: p.x + cw / 2, cy: p.y + 6, font: "", color: "", t0: p.t0 }, d.holeAt[0], d.holeAt[1], now);
        p.el.setCssStyles({ transform: `translate(${(f.x - cw / 2).toFixed(1)}px, ${(f.y - 6).toFixed(1)}px) rotate(${f.rot.toFixed(2)}rad) scale(${f.k.toFixed(2)})`, opacity: f.done ? "0" : "1" });
      } else if (p.kind === "xout") {
        p.el.setCssStyles({ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`, opacity: (t < 0.5 ? 1 : 1 - (t - 0.5) * 2).toFixed(2) });
      } else if (p.kind === "fire" || p.kind === "spark") {
        // Buoyant (g is negative), damped, swaying more as it climbs.
        p.vy += p.g * dtS;
        p.vx *= Math.pow(0.8, dt / 17);
        p.x += p.vx * dtS;
        p.y += p.vy * dtS;
        const sway = Math.sin((p.phase ?? 0) + (elapsed / 1000) * 1.3 * Math.PI * 2) * 0.3 * (d.stepPx || 7) * Math.min(1, elapsed / 260);
        let w = p.size, h = p.size;
        if (p.kind === "fire") {
          const i0 = p.shape0 ?? 0;
          const idx = Math.min(FIRE_SHAPES.length - 1, i0 + Math.floor((FIRE_SHAPES.length - 1 - i0) * Math.pow(t, 1.6)));
          const [sw, sh] = t < 0.78 ? FIRE_SHAPES[idx] : [1, 1];
          w = sw * FIRE_UNIT; h = sh * FIRE_UNIT;
        }
        const alpha = (d.look.hotHeadOpacity ?? 1) * (0.45 + 0.55 * (Math.round((1 - t) * 3) / 3));
        p.el.setCssStyles({
          width: `${w.toFixed(1)}px`, height: `${h.toFixed(1)}px`,
          backgroundColor: this.fireColor(d, 1 - t),
          transform: `translate(${(p.x + sway).toFixed(1)}px, ${(p.y - h).toFixed(1)}px)`,
          opacity: alpha.toFixed(2),
        });
      } else if (p.kind === "shell") {
        // Up, slowing, to burst at the top.
        const y = p.y - 22 * 1.1 * (1 - Math.pow(1 - t, 2));
        p.el.setCssStyles({ transform: `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px)`, opacity: "1" });
      } else {
        p.vy += p.g * dtS;
        p.x += p.vx * dtS;
        p.y += p.vy * dtS;
        // A firework's spark twinkles out over its last part.
        const twinkle = p.kind === "burst" && t > 0.42 ? (Math.random() < 0.3 ? 0.25 : 1) : 1;
        p.el.setCssStyles({ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`, opacity: ((p.kind === "burst" ? 0.9 : 1) * (1 - t) * twinkle).toFixed(2) });
      }
      keep.push(p);
    }
    d.particles = keep;
    for (const b of born) b();
  }

  // The preview's letters: kept in step with the text (the common start
  // kept, the rest made again), then Typewriter's ink on each - the Ink
  // stamp on the letter just typed (bigger and bolder, settling), Fresh ink
  // on the ones before it (the cursor's color drying into the text's, or
  // bolder settling with Keep text color).
  private paintText(d: Demo, text: string, now: number) {
    if (!d.written) return;
    if (d.painted !== text) {
      let k = 0;
      while (k < d.chars.length && k < text.length && d.chars[k].ch === text[k]) k++;
      for (const c of d.chars.splice(k)) c.el.remove();
      for (const ch of text.slice(k)) {
        const el = d.written.createSpan({ cls: "cursor-smith-roll-char", text: ch });
        d.chars.push({ el, ch, t: now, wet: true });
      }
      d.painted = text;
      d.innerWritten?.setText(text);
      if (d.stepPx) { d.rest?.setText(""); d.innerRest?.setText(""); }
    }
    const look = d.look;
    const tw = !!look.typewriter;
    const inkMs = look.typewriterInkMs ?? 400, freshMs = look.typewriterFreshInkMs ?? 1500;
    const last = d.chars[d.chars.length - 1];
    for (const c of d.chars) {
      if (!c.wet) continue;
      const age = now - c.t;
      const st: Record<string, string> = { transform: "", fontWeight: "", color: "" };
      let wet = false;
      if (tw && look.typewriterFreshInk && age < freshMs) {
        wet = true;
        const f = 1 - age / freshMs;
        if (look.typewriterFreshInkText) st.fontWeight = f > 0.3 ? "800" : "";
        else st.color = `color-mix(in srgb, ${d.color} ${Math.round(100 * f * (look.typewriterFreshInkStrength ?? 0.8))}%, var(--text-normal))`;
      }
      if (tw && look.typewriterInk && c === last && age < inkMs) {
        wet = true;
        const k = age / inkMs;
        const size = look.typewriterInkSize ?? 1.3;
        st.transform = `scale(${(size - (size - 1) * (1 - Math.pow(1 - k, 3))).toFixed(3)})`;
        st.fontWeight = "800";
      }
      c.el.setCssStyles(st);
      c.wet = wet;
    }
  }

  // Puts the caret (and the ghosts) where the state says. `cold` is 1 - heat.
  private paint(d: Demo, alpha: number, cold: number) {
    const px = d.stepPx || 8;
    const s = d.state;
    // A Line centered on the gap between letters, as the engine's (issue #48).
    const lineShift = d.style === "line" && d.geo ? d.geo.lineW / 2 : 0;
    const from = Math.min(s.lead, s.trail) * px - lineShift;
    const to = Math.max(s.lead, s.trail) * px;
    // A stretch of at most two letters, so the caret stays inside the cell.
    const stretch = Math.min(to - from, px * 2);
    // The preview's caret is a letter wide (a Box, an Underline) or its
    // Line thickness, as the engine's; the cards' a hair under a letter.
    const base = d.style === "line" ? (d.geo ? d.geo.lineW : d.shape.thick) : d.geo ? px : Math.max(1, px - 1);
    const width = base + stretch;
    // Heat warms a flat fill; a gradient keeps its colors (as the engine's
    // custom ramp flattens a gradient, the demo leaves it be).
    const heated = cold < 1 && !d.shape.gradient;
    const color = heated ? heatColor(d.color, d.heatStops, 1 - cold) : d.shape.fill;
    // The preview's text, written so far (typos and all), a letter an
    // element; the unwritten half only ever held the first line, to measure
    // the letters by.
    if (d.script) this.paintText(d, s.buffer, this.last);
    // Typewriter's pose, the engine's (measure.ts, typewriterPose): Springy
    // strike dips on a damped spring that rises past rest (Bounce) and
    // settles, squashed at the bottom and stretched on the rebound, a
    // capital's deeper and slower; Carriage advance carries it past its spot
    // and back. Squash is about the caret's bottom edge.
    let dip = 0, advance = 0, sy = 1;
    const look = d.look;
    if (look.typewriter) {
      const dt = this.last - d.keyT;
      const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : dflt));
      if (look.typewriterSpring) {
        const ms = clamp(look.typewriterStrikeMs, 80, 1000, 240) * (d.keyHeavy ? TW_CAPITAL_TIME : 1);
        if (dt >= 0 && dt < ms) {
          const u = dt / ms;
          let sh;
          if (u < TW_SPRING_DOWN) sh = 1 - Math.pow(1 - u / TW_SPRING_DOWN, 2);
          else {
            const v = (u - TW_SPRING_DOWN) / (1 - TW_SPRING_DOWN);
            sh = Math.cos(v * Math.PI * 1.5) * Math.pow(1 - v, 1.2);
            if (sh < 0) sh *= clamp(look.typewriterBounce, 0, 3, 1);
          }
          dip = sh * (clamp(look.typewriterDepth, 0, 60, 18) / 100) * PREVIEW_LINE * (d.keyHeavy ? TW_CAPITAL_DEPTH : 1);
          const squash = clamp(look.typewriterSquash, 0, 60, 14) / 100;
          sy = sh > 0 ? 1 - squash * sh : 1 + squash * 1.8 * -sh;
        }
      }
      if (look.typewriterAdvance && d.keyKind === "type") {
        const ms = clamp(look.typewriterAdvanceMs, 40, 1000, 150);
        if (dt >= 0 && dt < ms) {
          const u = dt / ms;
          advance = (Math.sin(Math.PI * u) * (1 - u) / 0.5796) * clamp(look.typewriterAdvanceCw, 0, 3, 0.25) * px;
        }
      }
    }
    // Breathing: the blink as a change of size, about the middle.
    if (d.breath > 0) sy *= 1 - (look.blinkBreathDepth ?? 0.2) * d.breath;
    const styles: Record<string, string> = {
      transform: dip || advance ? `translate(${(from + advance).toFixed(2)}px, ${dip.toFixed(2)}px)` : `translateX(${from.toFixed(2)}px)`,
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
    // The preview's height, squashed or breathing about its bottom edge
    // (breathing about its middle).
    if (d.geo && sy !== 1) {
      const g = d.geo;
      const top = d.style === "line" ? g.lineTop : d.style === "underline" ? g.top + g.h - g.ulH : g.top;
      const h = d.style === "line" ? g.lineH : d.style === "underline" ? g.ulH : g.h;
      const hh = h * sy;
      styles.height = `${hh.toFixed(2)}px`;
      styles.top = `${(d.breath > 0 ? top + (h - hh) / 2 : top + (h - hh)).toFixed(2)}px`;
    } else if (d.geo) {
      const g = d.geo;
      styles.height = `${(d.style === "line" ? g.lineH : d.style === "underline" ? g.ulH : g.h).toFixed(2)}px`;
      styles.top = `${(d.style === "line" ? g.lineTop : d.style === "underline" ? g.top + g.h - g.ulH : g.top).toFixed(2)}px`;
    }
    // Back-man, as the engine draws it (drawBackMan): the mouth toward the
    // letters (Backspace's: left), soft-lipped, chewing at its own pace; the
    // gulp, and the bend on its spring (on past the bites while it
    // settles); its head and feet the box's (rounded as the box is), a
    // square eye with a square glint. The caret is widened on both sides
    // for it to show; filled, it is cut to the creature's outline (the eye
    // a hole); hollow, the outline and the eye are drawn instead of the
    // box's border.
    let bm: (ReturnType<typeof backManBite> & { bend: number }) | null = null;
    if (look.popEffects && look.backMan && d.style === "box" && d.geo) {
      const b = d.bm;
      if (this.last > b.at) { backManSpring(b, (this.last - b.at) / 1000); b.at = this.last; }
      const c = d.bmChew;
      const bite = c ? backManBite(Math.max(0, this.last - c.c0), c.t - c.c0, c.big) : null;
      if ((bite && !bite.done) || Math.abs(b.bend) >= 0.004 || Math.abs(b.v) >= 0.05) bm = { ...(bite && !bite.done ? bite : backManBite(1e9)), bend: b.bend };
    }
    const n = (v: number) => v.toFixed(2);
    if (bm && d.geo) {
      const body = backManShape(bm.open, -1, bm.bend, bm.front, bm.back);
      const m = Math.ceil((BACKMAN_BEND_MAX + BACKMAN_GROW * BACKMAN_BIG.grow) * width) + 1;
      const wide = width + 2 * m, high = parseFloat(styles.height) || d.geo.h;
      d.bmMouth = from + body[3][0] * width;
      Object.assign(styles, { width: `${n(wide)}px`, transform: `${styles.transform} translateX(${-m}px)`, borderRadius: "0" });
      const sw = d.shape.hollowWidth ? d.geo.outline : 0;
      const trace = (cmds: BackManCmd[], ox: number, oy: number) => cmds.map((c) =>
        c[0] === "Z" ? "Z" : c[0] === "Q" ? `Q${n(ox + c[1])} ${n(oy + c[2])} ${n(ox + c[3])} ${n(oy + c[4])}` : `${c[0]}${n(ox + c[1])} ${n(oy + c[2])}`).join(" ");
      const outline = trace(backManOutline(body, bm.open, width - sw, high - sw, d.shape.radius), m + sw / 2, sw / 2);
      const eye = backManEye(-1, bm.bend, bm.squint, width, high);
      const poly = (pts: [number, number][]) => pts.map(([x, y], k) => `${k ? "L" : "M"}${n(m + x)} ${n(y)}`).join(" ") + " Z";
      const eyePath = poly(eye.shape);
      const glintPath = eye.glint ? " " + poly(eye.glint) : "";
      if (d.shape.hollowWidth) {
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${n(wide)} ${n(high)}' preserveAspectRatio='none'><path d='${outline}' fill='none' stroke='${d.shape.fill}' stroke-width='${n(sw)}' stroke-linejoin='round'/><path d='${eyePath}' fill='${d.shape.fill}'/></svg>`;
        Object.assign(styles, {
          borderColor: "transparent", borderImage: "none", backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
          backgroundSize: "100% 100%", backgroundOrigin: "border-box", backgroundRepeat: "no-repeat",
        });
      } else {
        // Even-odd: the eye a hole, the glint inside it the body again.
        styles.clipPath = `path(evenodd, "${outline} ${eyePath}${glintPath}")`;
      }
      d.bmOn = true;
    } else if (d.bmOn) {
      Object.assign(styles, { clipPath: "", backgroundOrigin: "", backgroundRepeat: "", borderRadius: d.shape.hollowWidth && d.shape.gradient ? "0" : `${d.shape.radius}px` });
      if (d.shape.hollowWidth) Object.assign(styles, { borderColor: d.shape.fill, borderImage: d.shape.gradient ? d.shape.gradient + " 1" : "", backgroundImage: "", backgroundSize: "" });
      d.bmOn = false;
    }
    // Shredder (a Line's) and Rabbit hole (an Underline's), as the engine
    // draws them: the line as blades, buzzing; the bar sagging into a
    // shallow dip, its color and thickness (the caret heightened for it,
    // drawn in its background).
    const n2 = (v: number) => v.toFixed(2);
    let eat: "" | "shred" | "hole" = "";
    if (d.style === "line" && d.shredRun && look.popEffects && look.shredder && d.geo) {
      const r = d.shredRun, last = this.last - r.t;
      const dash = last >= SHRED_HOLD_MS ? 0 : shredDash(Math.max(0, this.last - r.t0), last);
      d.cut = s.lead * px;
      if (dash > 0.01) {
        const lh = parseFloat(styles.height) || d.geo.lineH;
        const blades = Math.max(4, Math.min(8, Math.round(lh / 4))), pitch = lh / blades, len = pitch - pitch * 0.42 * dash;
        Object.assign(styles, {
          transform: `${styles.transform} translateX(${n2(Math.sin(this.last * 0.11) * 0.5 * dash)}px)`,
          backgroundColor: "transparent", backgroundSize: "100% 100%",
          backgroundImage: `repeating-linear-gradient(to bottom, ${color} 0px, ${color} ${n2(len)}px, transparent ${n2(len)}px, transparent ${n2(pitch)}px)`,
        });
        eat = "shred";
      }
      if (last >= SHRED_HOLD_MS + SHRED_FEED_MS + SHRED_FALL_MS) d.shredRun = null;
    }
    if (d.style === "underline" && d.holeRun && look.popEffects && look.rabbitHole && d.geo) {
      const r = d.holeRun, last = this.last - r.t;
      const open = last >= HOLE_HOLD_MS ? 0 : holeOpen(Math.max(0, this.last - r.t0), last);
      const bh = parseFloat(styles.height) || d.geo.ulH, top = parseFloat(styles.top) || 0;
      const sag = holeSag(open, width);
      d.holeAt = [from + width / 2, top + bh / 2 + sag + bh];
      if (open > 0.01) {
        const H = bh + Math.ceil(sag) + 1;
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${n2(width)} ${n2(H)}'><path d='M0 ${n2(bh / 2)} Q${n2(width / 2)} ${n2(bh / 2 + 2 * sag)} ${n2(width)} ${n2(bh / 2)}' fill='none' stroke='${color}' stroke-width='${n2(bh)}'/></svg>`;
        Object.assign(styles, {
          height: `${n2(H)}px`,
          backgroundColor: "transparent", backgroundSize: "100% 100%", backgroundRepeat: "no-repeat",
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        });
        eat = "hole";
      }
      if (last >= HOLE_HOLD_MS + HOLE_FALL_MS) d.holeRun = null;
    }
    if (!eat && d.eatOn) {
      Object.assign(styles, { backgroundColor: color, backgroundImage: styles.backgroundImage ?? d.shape.gradient ?? "", backgroundSize: styles.backgroundSize ?? "", backgroundRepeat: "" });
    }
    if (d.style === "line" && (eat === "shred") !== (d.eatOn === "shred")) d.caret.toggleClass("is-shred", eat === "shred");
    d.eatOn = eat;
    d.caret.setCssStyles(styles);
    // The letter copy inside a Box stays over the real letters: it is
    // moved back by the caret's own offset; hidden while Back-man eats.
    if (d.inner) d.inner.setCssStyles({ transform: `translateX(${(-from).toFixed(2)}px)`, visibility: bm ? "hidden" : "" });
    // Ghosts: newest brightest.
    const fade = d.look.trailFadeMs ?? 300;
    const now = this.last;
    for (let i = 0; i < d.ghosts.length; i++) {
      const g = s.ghosts[s.ghosts.length - 1 - i];
      const el = d.ghosts[i];
      if (!g) { el.setCssStyles({ opacity: "0" }); continue; }
      const life = 1 - (now - g.t0) / fade;
      el.setCssStyles({ transform: `translateX(${(g.at * px - lineShift).toFixed(2)}px)`, width: `${base.toFixed(2)}px`, opacity: (Math.max(0, life) * 0.6 * d.shape.alphaScale).toFixed(3) });
    }
  }
}
