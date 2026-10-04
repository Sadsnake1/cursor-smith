// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Pop effects' Back-man (1.7.7): while Backspace or Delete eats the text,
// the Box cursor is a little pixel creature - a blocky body, one eye, a
// mouth on the side it eats from (left for Backspace, right for Delete)
// chomping open and shut - leaning into the bite and back as the keys
// stop. No tail: the user's sketch was a fish, "but without that square
// tail". A Box's only: a Line or an Underline has no room for a face.
import { readableGlyphColor } from "../util/color";
import type CursorSmithPlugin from "../plugin";

// How long the creature stays after the last bite, one chomp (open and
// shut) and how far it leans (a skew, about its bottom edge).
export const BACKMAN_HOLD_MS = 280;
export const BACKMAN_CHOMP_MS = 170;
export const BACKMAN_LEAN = 0.2;

export interface BackManState { t: number; start: number; dir: number }
export interface BackManPose { open: number; dir: number; lean: number }

// The creature's pixels in a cols x rows grid, facing right (dir 1) or left
// (dir -1): the body (the box with its four corners off, the mouth's wedge
// cut from the front, as deep as it is open - shut, a one-pixel notch) and
// the eye (a pixel up near the front). Pure, for the tests.
export function backManCells(cols: number, rows: number, open: number, dir: number): { body: [number, number][]; eye: [number, number] } {
  const C = Math.max(3, Math.round(cols)), R = Math.max(5, Math.round(rows));
  const o = Math.max(0, Math.min(1, open));
  const mid = Math.round(R * 0.55);
  const half = Math.round(o * R * 0.2);
  const eye: [number, number] = [C - 2, Math.max(1, Math.round(R * 0.25))];
  const body: [number, number][] = [];
  for (let r = 0; r < R; r++) {
    // The mouth: rows mid - half .. mid + half, cut deepest in the middle.
    const off = Math.abs(r - mid);
    const cut = off <= half ? Math.min(C - 1, half - off + 1) : 0;
    for (let c = 0; c < C - cut; c++) {
      const corner = (r === 0 || r === R - 1) && (c === 0 || c === C - 1);
      if (corner) continue;
      if (c === eye[0] && r === eye[1]) continue;
      body.push([c, r]);
    }
  }
  if (dir < 0) {
    for (const cell of body) cell[0] = C - 1 - cell[0];
    eye[0] = C - 1 - eye[0];
  }
  return { body, eye };
}

export const effectsBackManMethods = {
  // On for the look showing: Pop effects and Back-man, a Box cursor.
  _backManOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.popEffects && this.look.backMan && this.styleFor("cursorStyle") === "Box");
  },

  // A bite: Backspace (dir -1, it eats leftward) or Delete (dir 1). A run of
  // bites is one chomping spell, the chomp's phase from its first.
  _backManBite(this: CursorSmithPlugin, dir: number) {
    if (!this._backManOn()) return;
    const now = performance.now();
    const s = this._backMan;
    if (s && now - s.t < BACKMAN_HOLD_MS && s.dir === dir) s.t = now;
    else this._backMan = { t: now, start: now, dir };
  },

  // Where the creature is at `now`: how open its mouth, which way it
  // faces, how far it leans (all of it at a bite, none as it goes) - or
  // null when it is a Box again.
  backManPose(this: CursorSmithPlugin, now: number): BackManPose | null {
    const s = this._backMan;
    if (!s || !this._backManOn()) return null;
    const since = now - s.t;
    if (since < 0 || since >= BACKMAN_HOLD_MS) return null;
    const open = Math.abs(Math.sin((Math.PI * (now - s.start)) / BACKMAN_CHOMP_MS));
    const lean = 1 - since / BACKMAN_HOLD_MS;
    return { open, dir: s.dir, lean: lean * lean };
  },

  // Whether it is still chomping (the frame governor keeps the frames
  // coming for it).
  backManMoving(this: CursorSmithPlugin, now: number): boolean {
    return !!this.backManPose(now);
  },

  // The creature in the caret's box (x, y, w, h), in the box's own paint:
  // pixels about two px wide, as many rows as keep them near square; the
  // eye in the color a letter inside the box would take; leaning into the
  // bite, about its bottom edge.
  drawBackMan(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, paint: string | CanvasGradient | CanvasPattern, color: string, pose: BackManPose) {
    const cols = Math.max(3, Math.min(6, Math.round(w / 2.2)));
    const cw = w / cols;
    const rows = Math.max(5, Math.min(14, Math.round(h / cw)));
    const ch = h / rows;
    const { body, eye } = backManCells(cols, rows, pose.open, pose.dir);
    ctx.save();
    // Lean toward where it eats: the top ahead of the bottom.
    const k = -pose.dir * BACKMAN_LEAN * pose.lean;
    ctx.transform(1, 0, k, 1, -k * (y + h), 0);
    ctx.fillStyle = paint;
    ctx.beginPath();
    // A hair over each pixel, so no seam shows between neighbours.
    for (const [c, r] of body) ctx.rect(x + c * cw, y + r * ch, cw + 0.4, ch + 0.4);
    ctx.fill();
    ctx.fillStyle = readableGlyphColor(color, "contrast");
    ctx.fillRect(x + eye[0] * cw, y + eye[1] * ch, cw, ch);
    ctx.restore();
  },
};
