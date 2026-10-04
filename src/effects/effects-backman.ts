// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little creature - the box with a mouth on the side it
// eats from (left for Backspace, right for Delete) - that takes one bite per
// letter, the mouth opening and shutting on each key. Its head and its feet
// (the box's top and bottom edges) never change; its sides bend in a V from
// the middle toward where it is going, on a spring - each bite kicks it,
// and when the bites stop it swings back past straight and settles - and it
// swells a little at the middle while it eats. No tail, no eye (a fish's
// tail was in the first sketch; a pixel eye, then a hole of one, were
// tried). Smooth, not pixels. A Box's only: a Line or an Underline has no
// room for a mouth.
import type CursorSmithPlugin from "../plugin";

// How long the creature eats after the last bite (it stays on while its
// bend still settles), how long one bite (the mouth open and shut) takes,
// how far it swells at a bite (box widths, each side, at the middle).
export const BACKMAN_HOLD_MS = 280;
export const BACKMAN_CHOMP_MS = 140;
export const BACKMAN_GROW = 0.18;
// The bend's spring: its frequency (Hz) and damping ratio (under 1: it
// swings past straight), the kick a bite gives it (box widths a second)
// and the most it bends (box widths, at the middle).
export const BACKMAN_BEND_HZ = 4.2;
export const BACKMAN_BEND_DAMPING = 0.32;
export const BACKMAN_BEND_KICK = 16;
export const BACKMAN_BEND_MAX = 0.6;

export interface BackManState { t: number; dir: number; bend: number; v: number; at: number }
export interface BackManPose { open: number; dir: number; bend: number; grow: number }

// The bend's spring from `s` over dt seconds (up to two: a longer gap -
// a window in the background - is long settled anyway), in small steps so
// any frame rate gives the same swing; held at BACKMAN_BEND_MAX. Pure.
export function backManSpring(s: { bend: number; v: number }, dt: number) {
  const w = 2 * Math.PI * BACKMAN_BEND_HZ;
  dt = Math.max(0, Math.min(2, dt));
  const steps = Math.max(1, Math.ceil(dt * 480));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (-w * w * s.bend - 2 * BACKMAN_BEND_DAMPING * w * s.v) * h;
    s.bend += s.v * h;
    if (Math.abs(s.bend) > BACKMAN_BEND_MAX) {
      s.bend = Math.sign(s.bend) * BACKMAN_BEND_MAX;
      if (s.v * s.bend > 0) s.v = 0;
    }
  }
}

// The creature's outline in a unit box (0..1 across, 0..1 down), facing
// right (dir 1) or left (dir -1): the box with a V bitten into the front at
// its middle, as deep as the mouth is open (shut, the jaws meet). The four
// corners stay where the box's are - its head and feet never change; the
// sides bend: every other point is pushed `bend` box widths sideways (+:
// right) times how near the middle it is, so each side is a V from its
// middle, and both sides swell out by `grow` the same way. Pure, for the
// tests and both painters (the canvas's and the settings' previews).
export function backManShape(open: number, dir: number, bend = 0, grow = 0): [number, number][] {
  const o = Math.max(0, Math.min(1, open));
  const jaw = 0.26 * o, depth = 0.62 * o;
  // Facing right; the front's points marked (they swell forward, the back's
  // backward).
  const right: [number, number, boolean][] = [
    [0, 0, false], [1, 0, true],
    [1, 0.5 - jaw, true], [1 - depth, 0.5, true], [1, 0.5 + jaw, true],
    [1, 1, true], [0, 1, false], [0, 0.5, false],
  ];
  const f = dir >= 0 ? 1 : -1;
  return right.map(([x, y, front]) => {
    const mid = 1 - Math.abs(2 * y - 1);
    const sx = f > 0 ? x : 1 - x;
    return [sx + (bend + (front ? f : -f) * grow) * mid, y] as [number, number];
  });
}

export const effectsBackManMethods = {
  // On for the look showing: Pop effects and Back-man, a Box cursor.
  _backManOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.popEffects && this.look.backMan && this.styleFor("cursorStyle") === "Box");
  },

  // A bite: Backspace (dir -1, it eats leftward) or Delete (dir 1). Each
  // one opens and shuts the mouth once, from the key, and kicks the bend
  // toward where it eats.
  _backManBite(this: CursorSmithPlugin, dir: number) {
    if (!this._backManOn()) return;
    const now = performance.now();
    const s = this._backMan;
    if (s) {
      if (now > s.at) backManSpring(s, (now - s.at) / 1000);
      s.t = now; s.dir = dir; s.at = Math.max(s.at, now);
      s.v += dir * BACKMAN_BEND_KICK;
    } else {
      this._backMan = { t: now, dir, bend: 0, v: dir * BACKMAN_BEND_KICK, at: now };
    }
  },

  // Where the creature is at `now`: how open its mouth (one bite, open and
  // shut, from the last key), which way it faces, how far it bends (the
  // spring, run up to now) and how far it swells - or null when it is a Box
  // again (the bites over and the bend settled).
  backManPose(this: CursorSmithPlugin, now: number): BackManPose | null {
    const s = this._backMan;
    if (!s || !this._backManOn()) return null;
    // A frame stamped a hair before the key still shows the bite's start.
    const since = Math.max(0, now - s.t);
    if (now > s.at) { backManSpring(s, (now - s.at) / 1000); s.at = now; }
    const settled = Math.abs(s.bend) < 0.004 && Math.abs(s.v) < 0.05;
    if (since >= BACKMAN_HOLD_MS && settled) { this._backMan = null; return null; }
    const open = since < BACKMAN_CHOMP_MS ? Math.sin((Math.PI * since) / BACKMAN_CHOMP_MS) : 0;
    const eating = since < BACKMAN_HOLD_MS ? 1 - since / BACKMAN_HOLD_MS : 0;
    return { open, dir: s.dir, bend: s.bend, grow: BACKMAN_GROW * Math.sqrt(eating) };
  },

  // Whether it is still about (the frame governor keeps the frames coming
  // for it).
  backManMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.backManPose(now);
  },

  // The creature in the caret's box (x, y, w, h), in the box's own paint:
  // filled, or with `stroke` (a hollow Box's outline width) its outline.
  drawBackMan(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: BackManPose, stroke = 0) {
    const body = backManShape(pose.open, pose.dir, pose.bend, pose.grow);
    ctx.beginPath();
    body.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h)));
    ctx.closePath();
    if (stroke > 0) {
      ctx.strokeStyle = paint;
      ctx.lineWidth = stroke;
      ctx.lineJoin = "miter";
      ctx.stroke();
    } else {
      ctx.fillStyle = paint;
      ctx.fill();
    }
  },
};
