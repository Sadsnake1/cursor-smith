// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little creature - the box with a soft-lipped mouth on
// the side it eats from (left for Backspace, right for Delete) and a big
// square eye with a tiny square glint - that takes one bite per letter:
// the letter slides into the open mouth and shrinks away as the jaws shut,
// then a gulp - the front swells, then the back, as it goes down - with a
// happy squint. Letters coming faster than it chews (a held key) it chews
// at its own steady pace, about seven bites a second; a word, a line or a
// selection is one big bite - slower, a bigger gulp. Its head and its feet
// (the box's top and bottom edges, rounded as the box's are) never change;
// its sides
// bend in a V from the middle toward where it is going, on a spring - each
// bite kicks it, and it eases back when the bites stop. Smooth, not pixels.
// A box: on a Line or an Underline the cursor morphs into one first
// (effects-eaters.ts; a Line chomped like a beak for a day before that).
import type { DeletedLetters } from "../types";
import type CursorSmithPlugin from "../plugin";

// One bite (the mouth open and shut; a held key's pace, about seven a
// second), the gulp after the last (from the jaws closing), how long the
// creature eats after one bite (it stays on while its bend still settles),
// how far the gulp swells it (box widths, a side, at the middle).
export const BACKMAN_CHOMP_MS = 140;
export const BACKMAN_GULP_MS = 220;
const GULP_FROM = 0.6;
export const BACKMAN_HOLD_MS = Math.round(GULP_FROM * BACKMAN_CHOMP_MS + BACKMAN_GULP_MS);
export const BACKMAN_GROW = 0.18;
// A big bite (a word, a line, a selection) against a letter's: its chomp
// and its gulp this much slower, its swell this much bigger, its kick this
// much harder.
export const BACKMAN_BIG = { chomp: 1.5, gulp: 1.4, grow: 1.9, kick: 1.6 };
// The bend's spring: its frequency (Hz) and damping ratio (0.62: a hair
// past straight on the way back, then still - the user found 0.32's wobble
// too much), the kick a bite gives it (box widths a second) and the most
// it bends (box widths, at the middle).
export const BACKMAN_BEND_HZ = 6;
export const BACKMAN_BEND_DAMPING = 0.62;
export const BACKMAN_BEND_KICK = 26;
export const BACKMAN_BEND_MAX = 0.6;
// The most letters one deletion feeds it (a word, at Ctrl+Backspace).
const MEAL_MAX = 12;

// A letter going down: where its middle stood, its font and color, when it
// set off and when it is down (the jaws shut on it).
export interface BackManMorsel { char: string; cx: number; cy: number; font: string; color: string; t0: number; t1: number }
// c0: when this run of chewing began; t: the last key; big: a big bite.
export interface BackManState { c0: number; t: number; big: boolean; dir: number; bend: number; v: number; at: number; meal: BackManMorsel[] }
// open: the mouth; front, back: the gulp's swell of each side; squint: the
// eye's happy squint (1 shut); g: how far the gulp has gone (0 to 1 while
// it goes); meal: the letters going in, each with how far it has gone (e,
// 0 to 1).
export interface BackManPose {
  open: number; dir: number; bend: number; front: number; back: number; squint: number; g: number;
  meal?: { m: BackManMorsel; e: number }[];
}

// A bump from 0 up to 1 and back over [a, b] of `g`, 0 outside.
const hump = (g: number, a: number, b: number) => (g > a && g < b ? Math.sin((Math.PI * (g - a)) / (b - a)) : 0);

// The chewing `tn` ms into a run that began with a key, its last key `tk`
// ms in (0: one key): the mouth chomps at its own pace, one chomp after
// another while keys keep coming, and finishes the chomp the last key fell
// in (one key, one chomp; a held key, about seven a second, never a flicker
// of half bites); then the gulp's swell - the front first, then the back,
// as it goes down - and the squint that goes with it. `big`: a big bite.
// `end`: when the last chomp shuts; `done`: the gulp over. Pure, shared
// with the previews.
export function backManBite(tn: number, tk = 0, big = false) {
  const ch = BACKMAN_CHOMP_MS * (big ? BACKMAN_BIG.chomp : 1);
  const gulp = BACKMAN_GULP_MS * (big ? BACKMAN_BIG.gulp : 1);
  const grow = BACKMAN_GROW * (big ? BACKMAN_BIG.grow : 1);
  const end = Math.max(1, Math.ceil((Math.max(0, tk) + ch) / ch)) * ch;
  const open = tn >= 0 && tn < end ? Math.sin((Math.PI * (tn % ch)) / ch) : 0;
  const g = (tn - (end - ch) - GULP_FROM * ch) / gulp;
  return { open, front: grow * hump(g, 0, 0.55), back: grow * hump(g, 0.35, 1), squint: hump(g, 0.05, 0.95), g, end, done: g >= 1 };
}

// A key at `now` on a run of chewing (`c`, or none): a new run when there
// is none, when its last chomp has shut, or for a big bite; else the same
// run, the key its latest. Pure, shared with the previews.
export function backManChew(c: { c0: number; t: number; big: boolean } | null, now: number, big: boolean) {
  if (!c || big || now - c.c0 >= backManBite(0, c.t - c.c0, c.big).end) return { c0: now, t: now, big };
  return { c0: c.c0, t: now, big: c.big };
}

// When a letter that set off at `now` is down: at the end of the chomp in
// progress, or of the next when this one is nearly shut.
export function backManDown(c: { c0: number; big: boolean }, now: number) {
  const ch = BACKMAN_CHOMP_MS * (c.big ? BACKMAN_BIG.chomp : 1);
  return c.c0 + Math.ceil((now - c.c0 + 0.4 * ch) / ch) * ch;
}

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
// middle, and the front and the back swell out by `front` and `back` the
// same way. Eight points: the head's two corners, the upper lip, the
// mouth's corner, the lower lip, the feet's two corners, the back's middle.
// Pure, for the tests and both painters (the canvas's and the previews').
export function backManShape(open: number, dir: number, bend = 0, front = 0, back = front): [number, number][] {
  const o = Math.max(0, Math.min(1, open));
  const jaw = 0.36 * o, depth = 0.78 * o;
  // Facing right; the front's points marked.
  const right: [number, number, boolean][] = [
    [0, 0, false], [1, 0, true],
    [1, 0.5 - jaw, true], [1 - depth, 0.5, true], [1, 0.5 + jaw, true],
    [1, 1, true], [0, 1, false], [0, 0.5, false],
  ];
  const f = dir >= 0 ? 1 : -1;
  return right.map(([x, y, isFront]) => {
    const mid = 1 - Math.abs(2 * y - 1);
    const sx = f > 0 ? x : 1 - x;
    return [sx + (bend + (isFront ? f * front : -f * back)) * mid, y] as [number, number];
  });
}

// A path, in px from the box's top left: M, L, Q (control, end), Z.
export type BackManCmd = ["M", number, number] | ["L", number, number] | ["Q", number, number, number, number] | ["Z"];

// The outline as a path in a w x h box, its lips soft: each lip and the
// mouth's corner rounded (a curve through the corner), more the wider the
// mouth; the head's and feet's corners as the box's - square, or rounded
// by `corner` px (Rounded corners). Pure.
export function backManOutline(body: [number, number][], open: number, w: number, h: number, corner = 0): BackManCmd[] {
  const jaw = 0.36 * Math.max(0, Math.min(1, open)) * h;
  const c = Math.max(0, corner);
  const radius = [c, c, Math.min(0.24 * w, 0.5 * jaw), Math.min(0.14 * w, 0.3 * jaw), Math.min(0.24 * w, 0.5 * jaw), c, c, 0];
  const pts = body.map(([x, y]) => [x * w, y * h]);
  const n = pts.length;
  // From halfway along the head, so its first corner can be rounded too.
  const out: BackManCmd[] = [["M", (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]];
  for (let k = 1; k <= n; k++) {
    const i = k % n;
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const d = Math.min(radius[i], la / 2, lb / 2);
    if (d < 0.05) { out.push(["L", p[0], p[1]]); continue; }
    out.push(["L", p[0] + ((a[0] - p[0]) / la) * d, p[1] + ((a[1] - p[1]) / la) * d]);
    out.push(["Q", p[0], p[1], p[0] + ((b[0] - p[0]) / lb) * d, p[1] + ((b[1] - p[1]) / lb) * d]);
  }
  out.push(["Z"]);
  return out;
}

// Its eye in a w x h box, px from the top left, as polygons: a big square
// ("make the eye square ... and make the eye bigger"), up at the top, its
// front edge seven tenths of the way to the front - just clear of the upper
// lip with the mouth wide open - moved with the bend; a tiny square glint
// in its upper front corner. As it squints (the gulp) it narrows from top
// and bottom, and past halfway it is a happy "^" (`closed`) with no glint.
// `size`: the square's side. Pure.
export function backManEye(dir: number, bend: number, squint: number, w: number, h: number) {
  const f = dir >= 0 ? 1 : -1;
  const size = Math.min(0.6 * w, 0.24 * h);
  const top = 0.05 * h;
  const cy = top + size / 2;
  const front = 0.7 * w;
  const cx = (f > 0 ? front - size / 2 : w - front + size / 2) + bend * w * (1 - Math.abs(2 * (cy / h) - 1));
  const s = Math.max(0, Math.min(1, squint));
  const closed = s >= 0.55;
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let shape: [number, number][];
  if (closed) {
    // A "^" band across the eye's width.
    const R = size / 2, a = 0.3 * size, t = Math.max(1, 0.22 * size);
    shape = [[cx - R, cy + a], [cx, cy - a], [cx + R, cy + a], [cx + R, cy + a + t], [cx, cy - a + t], [cx - R, cy + a + t]];
  } else {
    const hh = (size * (1 - (0.75 * s) / 0.55)) / 2;
    shape = rect(cx - size / 2, cy - hh, cx + size / 2, cy + hh);
  }
  const g = Math.max(1, 0.28 * size), inset = 0.16 * size;
  const gx = f > 0 ? cx + size / 2 - inset - g : cx - size / 2 + inset;
  return { cx, cy, size, closed, shape, glint: s < 0.25 ? rect(gx, cy - size / 2 + inset, gx + g, cy - size / 2 + inset + g) : null };
}

// A polygon onto the canvas, moved by (x, y), as one subpath.
function tracePoly(ctx: CanvasRenderingContext2D, pts: [number, number][], x: number, y: number) {
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
  ctx.closePath();
}

export const effectsBackManMethods = {
  // On for the look showing: Pop effects and Back-man the "When you delete"
  // choice - on any cursor (effects-eaters.ts morphs it into a box).
  _backManOn(this: CursorSmithPlugin): boolean {
    return this._eaterOn() === "backman";
  },

  // A bite: Backspace (dir -1, it eats leftward) or Delete (dir 1); `big`
  // for a word, a line or a selection. Chewed at its own pace
  // (backManChew), each kicking the bend toward where it eats.
  _backManBite(this: CursorSmithPlugin, dir: number, big = false) {
    if (!this._backManOn()) return;
    const now = performance.now();
    const kick = dir * BACKMAN_BEND_KICK * (big ? BACKMAN_BIG.kick : 1);
    const s = this._backMan;
    if (s) {
      if (now > s.at) backManSpring(s, (now - s.at) / 1000);
      Object.assign(s, backManChew(s, now, big));
      s.dir = dir; s.at = Math.max(s.at, now);
      s.v += kick;
    } else {
      this._backMan = { c0: now, t: now, big, dir, bend: 0, v: kick, at: now, meal: [] };
    }
  },

  // Whether the note has a selection (deleting it is a big bite).
  _backManSelected(this: CursorSmithPlugin): boolean {
    return !!this.app.workspace.activeEditor?.editor?.somethingSelected();
  },

  // What the bite took (effects-delete.ts): the letters, nearest first,
  // each to slide into the mouth from where it stood.
  spawnBackManMeal(this: CursorSmithPlugin, deleted: DeletedLetters) {
    const s = this._backMan;
    if (!s) return;
    const old = deleted.old;
    const h = old.h || 20;
    const font = this.fontString(old.fontSize, old.fontFamily, old.fontWeight, old.fontStyle);
    const color = old.textColor || this.getActiveColor() || "#888888";
    const now = performance.now();
    const t1 = backManDown(s, now);
    for (const l of deleted.letters.slice(0, MEAL_MAX)) {
      if (!l.char.trim()) continue;
      s.meal.push({ char: l.char, cx: l.x + l.w / 2, cy: old.top + h / 2, font, color, t0: now, t1 });
    }
  },

  // Where the creature is at `now`: its chewing (the mouth, the gulp, the
  // squint), which way it faces, how far it bends (the spring, run up to
  // now), the letters going in - or null when it is itself again (the gulp
  // over and the bend settled).
  backManPose(this: CursorSmithPlugin, now: number): BackManPose | null {
    const s = this._backMan;
    if (!s || !this._backManOn()) return null;
    // A frame stamped a hair before the key still shows the bite's start.
    const b = backManBite(Math.max(0, now - s.c0), s.t - s.c0, s.big);
    if (now > s.at) { backManSpring(s, (now - s.at) / 1000); s.at = now; }
    const settled = Math.abs(s.bend) < 0.004 && Math.abs(s.v) < 0.05;
    if (b.done && settled) { this._backMan = null; return null; }
    s.meal = s.meal.filter((m) => now < m.t1);
    const meal = s.meal.map((m) => {
      const u = Math.max(0, Math.min(1, (now - m.t0) / Math.max(1, m.t1 - m.t0)));
      return { m, e: 1 - (1 - u) * (1 - u) };
    });
    return { open: b.open, front: b.front, back: b.back, squint: b.squint, g: b.g, dir: s.dir, bend: s.bend, meal };
  },

  // Whether it is still about (the frame governor keeps the frames coming
  // for it).
  backManMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.backManPose(now);
  },

  // The creature in the caret's box (x, y, w, h), in the box's own paint:
  // the letters going in first, under it (they show in the mouth and go
  // out of sight behind the jaws); then the body, filled - its eye cut out
  // of it, the background showing, a white glint in it - or with `stroke`
  // (a hollow Box's outline width) its outline, the eye a square of its
  // paint with the glint cut out. `corner`: the box's corner radius.
  drawBackMan(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: BackManPose, stroke = 0, corner = 0) {
    const body = backManShape(pose.open, pose.dir, pose.bend, pose.front, pose.back);
    // The letters going in, to the mouth's corner.
    this._drawBackManMeal(ctx, pose, x + body[3][0] * w, y + body[3][1] * h, h);
    ctx.beginPath();
    for (const c of backManOutline(body, pose.open, w, h, corner)) {
      if (c[0] === "M") ctx.moveTo(x + c[1], y + c[2]);
      else if (c[0] === "L") ctx.lineTo(x + c[1], y + c[2]);
      else if (c[0] === "Q") ctx.quadraticCurveTo(x + c[1], y + c[2], x + c[3], y + c[4]);
      else ctx.closePath();
    }
    if (stroke > 0) {
      ctx.strokeStyle = paint;
      ctx.lineWidth = stroke;
      ctx.lineJoin = "round";
      ctx.stroke();
    } else {
      ctx.fillStyle = paint;
      ctx.fill();
    }
    // The eye: a hole in a filled body (the background shows), a dot of
    // paint in a hollow one; the glint the other way round. The glow kept
    // out of both.
    const eye = backManEye(pose.dir, pose.bend, pose.squint, w, h);
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    tracePoly(ctx, eye.shape, x, y);
    ctx.globalCompositeOperation = stroke > 0 ? "source-over" : "destination-out";
    ctx.fillStyle = stroke > 0 ? paint : "#000";
    ctx.fill();
    if (eye.glint) {
      ctx.beginPath();
      tracePoly(ctx, eye.glint, x, y);
      ctx.globalCompositeOperation = stroke > 0 ? "destination-out" : "source-over";
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    ctx.restore();
  },

  // The letters going in (under what eats them): each from where it stood
  // to (mx, my), shrinking, in the text's color; `h` the line's height,
  // the room a letter takes.
  _drawBackManMeal(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, pose: BackManPose, mx: number, my: number, h: number) {
    if (!pose.meal || !pose.meal.length) return;
    for (const { m, e } of pose.meal) {
      const cx = m.cx + (mx - m.cx) * e, cy = m.cy + (my - m.cy) * e, k = Math.max(0.05, 1 - 0.8 * e);
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.font = m.font;
      ctx.fillStyle = m.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.fillText(m.char, 0, 0);
      ctx.restore();
      this._markDirty(Math.min(m.cx, cx) - h, Math.min(m.cy, cy) - h, Math.abs(m.cx - cx) + 2 * h, Math.abs(m.cy - cy) + 2 * h);
    }
  },
};
