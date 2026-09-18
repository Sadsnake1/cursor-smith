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
// Only the preset in use plays (the ticked card), and only DEMO_CYCLES
// passes over its name; then it glides to the idle spot and rests. Every
// other card sits still at the idle spot: one space past the end of the
// name (the user's placement). A strip of seven carets all typing at
// once was annoying (the user's word). One requestAnimationFrame loop per strip
// (DemoStrip) drives the card that plays; it ends when the card is done
// or its element has left the document (a re-render of the strip needs
// no teardown). No loop at all under reduced motion, or where there is
// no requestAnimationFrame (the tests).
import type { Look } from "./types";
import { blinkAlphaAt } from "./motion";
import { hexToRgbTuple, readableGlyphColor, rgbTupleToHex } from "./color";

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
  // The timeline: which phase, and how long it has run.
  phase: "type" | "holdEnd" | "holdStart";
  phaseMs: number;
  // The moment of the last keystroke, for Don't blink while typing.
  lastKeyMs: number;
  // Speed demon's heat, 0 cold .. 1 white-hot.
  heat: number;
  // CRT ghosts: where each was left (letters) and when.
  ghosts: { at: number; t0: number }[];
}

export function initialState(now: number): DemoState {
  return { target: 0, lead: 0, trail: 0, phase: "type", phaseMs: 0, lastKeyMs: now, heat: 0, ghosts: [] };
}

// Where a caret rests: one space past the end of the name.
export const idleAt = (n: number) => n + 1;

// One frame of the timeline and the springs. Pure: the state in, the state
// out, so the tests can run it without a DOM. `n` is the name's length.
// With `frozen` the timeline stands still and only the springs run - a
// demo that has played its passes gliding to the idle spot.
export function step(s: DemoState, look: Partial<Look>, n: number, dt: number, now: number, frozen = false): DemoState {
  const dtS = Math.min(0.1, dt / 1000);
  s.phaseMs += dt;
  const move = (to: number) => {
    if (look.crtEffect && (look.trailLength ?? 0) > 0) {
      s.ghosts.push({ at: s.lead, t0: now });
      if (s.ghosts.length > (look.trailLength ?? 0)) s.ghosts.shift();
    }
    s.target = to;
    s.lastKeyMs = now;
  };
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

  // The leading edge: the engine's glide, or a snap.
  if (look.smoothEnabled) {
    const rate = Math.max(0.5, (look.catchUpSpeed ?? 0.5) * (1 - (look.smoothness ?? 0.15)) * 40);
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
}

// Every card's demo in one strip, on one frame loop.
export class DemoStrip {
  private demos: Demo[] = [];
  private raf = 0;
  private last = 0;
  private win: Window | null = null;

  // Builds the demo into `host` and starts it. `color` is the preset's
  // color for the current theme; `heatStops` its four heat stops for it.
  add(host: HTMLElement, name: string, look: Partial<Look>, color: string, heatStops: string[], gradientStops: string[], reduced: boolean, play: boolean) {
    const demo = host.createSpan({ cls: "cursor-smith-pcard-demo" });
    const text = demo.createSpan({ cls: "cursor-smith-pcard-text cursor-smith-pcard-name", text: name });
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
    if (style === "box" && look.showChar !== false && !shape.hollowWidth && !look.cursorTranslucent) {
      inner = caret.createSpan({ cls: "cursor-smith-pcard-caret-text", text: name });
      inner.setCssStyles({ color: readableGlyphColor(shape.fill, look.glyphColorMode ?? "contrast") });
    }
    const d: Demo = { el: demo, shape, cycles: 0, done: false, particles: [], pool: [], spawnAcc: 0, lastTarget: 0, text, caret, inner, ghosts, look, color, heatStops, n: name.length, style, state: initialState(0), stepPx: 0 };
    const win = host.ownerDocument?.defaultView ?? null;
    if (!play || reduced) {
      // Still, at the idle spot - painted now with a guessed letter width,
      // and once more from the loop with the measured one (a still demo
      // is a done one, dropped after that frame).
      d.state.target = d.state.lead = d.state.trail = idleAt(d.n);
      d.done = true;
    }
    // Painted once here (a guessed letter width), then from the loop.
    this.paint(d, 1, 1);
    if (!win || typeof win.requestAnimationFrame !== "function") return;
    this.demos.push(d);
    this.win = win;
    if (!this.raf) this.raf = win.requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    // A demo whose element left the document (the strip re-rendered) is
    // done; the loop ends with the last of them.
    // A demo that is done stays in the loop until it has settled at the
    // idle spot and its particles are gone.
    this.demos = this.demos.filter((d) => d.el.isConnected && !(d.done && d.stepPx > 0 && d.particles.length === 0 && d.state.lead === d.state.target && d.state.trail === d.state.lead));
    for (const d of this.demos) {
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
      if (!d.done) {
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
    this.raf = this.demos.length && this.win ? this.win.requestAnimationFrame(this.tick) : 0;
  };

  // A particle from the pool, or none when the card has its share.
  private spawn(d: Demo, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, now: number) {
    if (d.particles.length >= POOL) return;
    let el = d.pool.pop() ?? null;
    if (!el) el = d.el.createSpan({ cls: "cursor-smith-pcard-particle", attr: { "aria-hidden": "true" } });
    el.setCssStyles({ width: `${size}px`, height: `${size}px`, backgroundColor: color, opacity: "1" });
    d.particles.push({ el, x, y, vx, vy, t0: now, life, size, color });
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
    const styles: Record<string, string> = {
      transform: `translateX(${from.toFixed(2)}px)`,
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
