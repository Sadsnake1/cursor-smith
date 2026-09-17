// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

import { THUNDER_PALETTE } from "./constants";

export function hexToRgba(hex: string, alpha: number) {
  let h = (hex || "#39ff14").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const int = parseInt(h, 16) || 0;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function hexToRgb(hex: string) {
  let h = (hex || "#ff963c").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const n = parseInt(h, 16) || 0;
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Lift a channel toward white by `f`. Used to keep the bolt's core brighter
// than its halo without carrying two palettes around.
export function lighten(c, f) {
  return Math.round(c + (255 - c) * f);
}

// The colour ramp for one strike: two or three palette entries, picked without
// replacement and left in the order they came out, running from the sky end of
// the bolt down to the impact. Rolled fresh per strike, so the same key gives a
// blue-into-white bolt one time and a red-purple-yellow one the next.
//
// With Pop Effects' Rainbow on, `hue` is the strike's slot in the shared sweep
// and the palette is bypassed entirely: the ramp is built from that hue and
// two neighbours instead, climbing in lightness toward the impact so the bolt
// still reads as light rather than as a coloured line. The neighbours are
// close together on purpose - a bolt spanning half the colour wheel stops
// looking like one discharge.
export function thunderRamp(hue = null) {
  if (typeof hue === "number") {
    return [
      hslToRgbTuple(hue, 0.85, 0.62),
      hslToRgbTuple(hue + 18, 0.8, 0.72),
      hslToRgbTuple(hue + 36, 0.7, 0.85),
    ];
  }
  const pool = THUNDER_PALETTE.slice();
  const n = 2 + (Math.random() < 0.55 ? 1 : 0);
  const stops = [];
  for (let i = 0; i < n; i++) {
    stops.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return stops;
}

// Sample a ramp at 0..1.
export function thunderColorAt(stops, t) {
  if (stops.length === 1) return stops[0];
  const p = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const f = p - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function hexToRgbTuple(hex: string) {
  let h = (hex || "#ffffff").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16) || 0;
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

// Converts an HSL color (h in degrees, s/l in 0..1) to an "rgb(r, g, b)"
// string, matching the format the particle system already uses for colors.
// The tuple form is the real implementation: Rainbow now feeds three separate
// effects (popped letters, Thunderstrike's colour ramp, Fireworks' sparks) and
// two of them need [r,g,b] to interpolate or nudge before anything is painted,
// so building a string first and re-parsing it would be pure waste.
export function hslToRgbTuple(h: number, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (hue < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (hue < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (hue < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (hue < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}
export function hslToRgbString(h: number, s, l) {
  const [r, g, b] = hslToRgbTuple(h, s, l);
  return `rgb(${r}, ${g}, ${b})`;
}

// --- HSV, for the Speed Demon heat ramp ---------------------------------
// The ramp is interpolated in HSV rather than RGB because a straight RGB lerp
// between two colours that sit on opposite sides of the wheel passes through
// grey: blue → yellow, for instance, has a washed-out sage midpoint. Fire is
// never desaturated, so any segment that visibly greys out breaks the effect.
// Rotating the hue instead keeps every intermediate colour fully lit, which is
// what makes the ramp read as a temperature rather than a crossfade.
export function rgbToHsv([r, g, b]: number[]) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max > 1e-6 ? d / max : 0, max];
}

export function hsvToRgb([h, s, v]: number[]) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));
  const c = val * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = val - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) { r1 = c; g1 = x; }
  else if (hue < 120) { r1 = x; g1 = c; }
  else if (hue < 180) { g1 = c; b1 = x; }
  else if (hue < 240) { g1 = x; b1 = c; }
  else if (hue < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

// Blend two HSV colours, taking the SHORT way around the hue wheel so a
// transition never doubles back through the half of the spectrum it isn't
// heading for (red → violet goes through magenta, not through green).
//
// `arc` overrides that when the short way is the wrong way round: +1 forces
// the hue to climb, -1 forces it to fall, 0 (default) takes the short way.
// Used for the ignition segment, where "shortest" is not the same as "most
// like fire" - see heatColor.
//
// A colour with no saturation has no meaningful hue - its stored hue is an
// artefact of whatever it was derived from. Interpolating toward that number
// would swing the saturated end through unrelated colours on its way to grey,
// so when one end is colourless the other end's hue is simply held and only
// saturation/value move.
export function lerpHsv(a, b, f, arc = 0) {
  let hue;
  if (a[1] < 0.03) hue = b[0];
  else if (b[1] < 0.03) hue = a[0];
  else {
    let d = ((b[0] - a[0] + 540) % 360) - 180;
    if (arc > 0 && d < 0) d += 360;
    else if (arc < 0 && d > 0) d -= 360;
    hue = a[0] + d * f;
  }
  return [hue, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function rgbTupleToHex([r, g, b]: number[]) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1)}`;
}

export function invertColor(colorStr: string) {
  const nums = (colorStr || "").match(/[\d.]+/g);
  if (!nums || nums.length < 3) return "#000000";
  const [r, g, b] = nums.map(Number);
  return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
}

// Parse either form the engine deals in - "#rgb"/"#rrggbb" from the settings,
// or "rgb(r, g, b)" from getComputedStyle and from heatColor - into [r,g,b].
//
// invertColor above only ever handled the second form (its regex finds no
// digits worth having in a hex string), which is fine for its one caller but
// makes it useless as a building block. Returns null rather than a guess when
// it can't parse, so callers can fall back deliberately.
export function parseColorTuple(colorStr: string) {
  if (!colorStr || typeof colorStr !== "string") return null;
  const s = colorStr.trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length < 6) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (!Number.isFinite(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const nums = s.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  const t = nums.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
  return t.some((v) => !Number.isFinite(v)) ? null : t;
}

// WCAG relative luminance. Note this is NOT the same as "average brightness":
// green weighs ten times what blue does, which is exactly why a naive
// mid-channel test picks the wrong glyph colour over saturated blues.
export function relLuminance(rgb) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

export function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const GLYPH_MIN_CONTRAST = 4.5;

// How the character inside a filled Box cursor is coloured.
//
//   contrast  black or white, whichever measures higher against the box.
//             Neutral and always legible. The default.
//   tinted    invert the box, then push toward a pole until it clears the
//             floor. Keeps a hue, at the cost of that hue being the box's
//             COMPLEMENT - a green cursor gives a magenta letter, which
//             passes the contrast test and still looks wrong. Named for what
//             you get rather than "auto", which implied the plugin was
//             choosing for you - that is what "contrast" does.
//   invert    raw inversion, no floor. Purest reading of "flipped colours",
//             and genuinely unusable on a mid-grey box, which inverts to
//             within one unit of itself.
export const GLYPH_COLOR_MODES = ["contrast", "tinted", "invert"];

// The colour for the character drawn inside a FILLED Box cursor.
//
// This used to be invertColor(textColor): the inverse of whatever the editor
// was painting the text under the caret. That reference is wrong twice over.
// It never looks at the box the glyph is landing on, so legibility was pure
// coincidence - a Catppuccin Latte note (text #4c4f69) on a blue box gave a
// sludge-grey glyph at 3.4:1, and the same text on the yellow Vim-visual box
// gave 1.3:1, i.e. invisible. And because the reference is the *syntax
// highlighted* colour at the caret, the glyph changed hue as you moved across
// tokens for no reason a user could see.
//
// So: invert the BOX, which is the thing the glyph actually sits on, then
// enforce a contrast floor. Plain inversion alone isn't enough - it fails flat
// on anything near mid-grey (#808080 inverts to itself) - so when the inverse
// doesn't clear the floor we slide it toward whichever pole the box isn't
// until it does. Contrast is monotonic along that slide, so a coarse scan
// finds the first passing step; stopping AT the threshold rather than jumping
// straight to black/white is the whole point, since it keeps as much of the
// inverted hue as legibility allows.
export function readableGlyphColor(boxColorStr, mode = "contrast") {
  const box = parseColorTuple(boxColorStr);
  if (!box) return "#000000";

  const inv = [255 - box[0], 255 - box[1], 255 - box[2]];
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

  // Raw inversion. No floor, no neutralising - if you pick a mid-grey cursor
  // this WILL be illegible, and that is the honest behaviour of the mode.
  if (mode === "invert") return rgb(inv);

  const white = [255, 255, 255], black = [0, 0, 0];
  // Which pole gives more contrast, MEASURED rather than guessed from a
  // luminance threshold. The usual `luminance < 0.5 ? white : black` shortcut
  // is wrong over a wide band: the contrast formula is a ratio of (L + 0.05),
  // so its crossover sits at L ~ 0.179, not 0.5. That shortcut picked white
  // for #c792ea at 2.4:1 when black was available at 9.4:1.
  const poleC = contrastRatio(white, box) >= contrastRatio(black, box) ? white : black;

  // The default. A neutral, because inverting a colour rotates its HUE to the
  // complement rather than producing something neutral - green inverts to
  // magenta, which clears the contrast floor comfortably and still reads as
  // the wrong colour entirely. Black on a green box measures 13:1 where the
  // magenta scrapes 4.85:1, so this is not a trade of legibility for
  // neutrality; it wins on both.
  if (mode !== "tinted") return rgb(poleC);

  // "tinted": keep the inverted hue when it is already legible, and slide it
  // toward the pole only as far as the floor requires. Contrast is monotonic
  // along that slide, so a coarse scan finds the first passing step; stopping
  // AT the threshold rather than jumping to the pole is the whole point, as
  // it preserves as much of the hue as legibility allows.
  if (contrastRatio(inv, box) >= GLYPH_MIN_CONTRAST) return rgb(inv);

  const pole = poleC[0];
  const STEPS = 16;
  let best = inv;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const c = [
      Math.round(inv[0] + (pole - inv[0]) * t),
      Math.round(inv[1] + (pole - inv[1]) * t),
      Math.round(inv[2] + (pole - inv[2]) * t),
    ];
    best = c;
    if (contrastRatio(c, box) >= GLYPH_MIN_CONTRAST) break;
  }
  return rgb(best);
}
