// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little creature - its body the box with its corners
// cut, a big eye, a mouth on the side it eats from (left for Backspace,
// right for Delete) - that takes one bite per letter, the mouth opening
// and shutting on each key, leaning into the bite and back as the keys
// stop. No tail: the user's sketch was a fish, "but without that square
// tail". Smooth, not pixels ("dont pixelate it"). Its eye is a hole - the
// background shows through it ("the color of the eye should be the color
// of the background"); a hollow Box is the creature's outline, no eye. A
// Box's only: a Line or an Underline has no room for a face.
import type CursorSmithPlugin from "../plugin";

// How long the creature stays after the last bite, how long one bite (the
// mouth open and shut) takes, and how far it leans (a skew, about its
// bottom edge).
export const BACKMAN_HOLD_MS = 280;
export const BACKMAN_CHOMP_MS = 140;
export const BACKMAN_LEAN = 0.2;

export interface BackManState { t: number; dir: number }
export interface BackManPose { open: number; dir: number; lean: number }

// The creature in a unit box (0..1 across, 0..1 down), facing right (dir 1)
// or left (dir -1): its outline - the box, corners cut, a V bitten into the
// front as deep as the mouth is open (shut, the jaws meet) - and its eye, a
// square up near the front. Pure, for the tests and both painters (the
// canvas's and the settings' previews).
export function backManShape(open: number, dir: number): { body: [number, number][]; eye: { x: number; y: number; w: number; h: number } } {
  const o = Math.max(0, Math.min(1, open));
  const bev = 0.16;
  const my = 0.58, jaw = 0.26 * o, depth = 0.62 * o;
  const right: [number, number][] = [
    [0, bev], [bev, 0], [1 - bev, 0], [1, bev * 0.6],
    [1, my - jaw], [1 - depth, my], [1, my + jaw],
    [1, 1 - bev * 0.6], [1 - bev, 1], [bev, 1], [0, 1 - bev],
  ];
  const eye = { x: 0.44, y: 0.2, w: 0.42, h: 0.17 };
  if (dir >= 0) return { body: right, eye };
  return { body: right.map(([x, y]) => [1 - x, y] as [number, number]), eye: { x: 1 - eye.x - eye.w, y: eye.y, w: eye.w, h: eye.h } };
}

export const effectsBackManMethods = {
  // On for the look showing: Pop effects and Back-man, a Box cursor.
  _backManOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.popEffects && this.look.backMan && this.styleFor("cursorStyle") === "Box");
  },

  // A bite: Backspace (dir -1, it eats leftward) or Delete (dir 1). Each
  // one opens and shuts the mouth once, from the key.
  _backManBite(this: CursorSmithPlugin, dir: number) {
    if (!this._backManOn()) return;
    this._backMan = { t: performance.now(), dir };
  },

  // Where the creature is at `now`: how open its mouth (one bite, open and
  // shut, from the last key), which way it faces, how far it leans (all of
  // it at a bite, none as it goes) - or null when it is a Box again.
  backManPose(this: CursorSmithPlugin, now: number): BackManPose | null {
    const s = this._backMan;
    if (!s || !this._backManOn()) return null;
    const since = now - s.t;
    if (since < 0 || since >= BACKMAN_HOLD_MS) return null;
    const open = since < BACKMAN_CHOMP_MS ? Math.sin((Math.PI * since) / BACKMAN_CHOMP_MS) : 0;
    const lean = 1 - since / BACKMAN_HOLD_MS;
    return { open, dir: s.dir, lean: lean * lean };
  },

  // Whether it is still about (the frame governor keeps the frames coming
  // for it).
  backManMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.backManPose(now);
  },

  // The creature in the caret's box (x, y, w, h), in the box's own paint,
  // leaning into the bite about its bottom edge: filled, its eye cut out of
  // it (the background shows - erased, not painted over, and the glow kept
  // out of the cut); or with `stroke` (a hollow Box's outline width) its
  // outline, no eye.
  drawBackMan(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, pose: BackManPose, stroke = 0) {
    const { body, eye } = backManShape(pose.open, pose.dir);
    ctx.save();
    // Lean toward where it eats: the top ahead of the bottom.
    const k = -pose.dir * BACKMAN_LEAN * pose.lean;
    ctx.transform(1, 0, k, 1, -k * (y + h), 0);
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
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
      ctx.fillRect(x + eye.x * w, y + eye.y * h, eye.w * w, eye.h * h);
    }
    ctx.restore();
  },
};
