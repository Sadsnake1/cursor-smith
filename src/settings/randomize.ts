// The Randomizer (1.7.7): a whole cursor rolled at once - its shape, its
// colors, its blink, its glide and a handful of effects with their settings
// - from three dials and a switch:
//
//   - Chaos: how many effects and how strong. 0 is one effect, gently; 100
//     is every effect at once, turned up (the promo's "everything" look).
//   - Color: from one calm color to gradients, rainbows and colored heat.
//   - Motion: how likely gliding, the smear and the trails are, and how far
//     they move.
//   - Sounds: whether the roll picks a sound too; off, the roll is silent.
//   - A switch per effect: which ones a roll may pick (all on by default).
//
// A roll is every look key but the torch's settings. Two effects are never
// rolled (the user took their switches out): the torch, which darkens the
// whole window - no cursor of anyone's choosing - and the bracket tether, a
// line under brackets a random cursor would rarely show. Values come from the settings' own ranges, so
// a rolled cursor is one the panel could have made. Pure and seedable (the
// tests roll with a seed); the plugin applies it (library.ts, rollCursor).
import { DEFAULT_SETTINGS, LOOK_KEYS } from "./settings";
import { SOUND_MACHINES } from "../sound/samples";
import { hslToRgbTuple, rgbTupleToHex } from "../util/color";
import type { Look } from "../types";

export interface RollOptions {
  chaos: number;   // 0 - 100
  color: number;   // 0 - 100
  motion: number;  // 0 - 100
  sounds: boolean;
  // Per effect (ROLL_TOGGLES' keys): false keeps it out of the roll. A key
  // not there is allowed, but the torch's.
  allow?: Partial<Record<string, boolean>>;
}

// The effects a roll chooses among - the Effects rail's, but the torch and
// the bracket tether (never rolled) and the smear (Motion's).
export const ROLL_EFFECTS: (keyof Look)[] = [
  "popEffects", "typewriter", "flameTrail", "stardustEnabled",
  "energyEffect", "crtEffect", "speedDemon", "hotHead",
];

// The effects a roll can be told to leave out, in the Effects page's
// order: the eight and Motion smear (Motion's).
export const ROLL_TOGGLES: (keyof Look)[] = [
  "popEffects", "typewriter", "flameTrail", "stardustEnabled", "smear",
  "energyEffect", "crtEffect", "speedDemon", "hotHead",
];
export function rollAllowed(allow: Partial<Record<string, boolean>> | null | undefined, key: string): boolean {
  if (!ROLL_TOGGLES.includes(key as keyof Look)) return false;
  const v = allow ? allow[key] : undefined;
  return v === undefined ? true : !!v;
}

// The torch's keys: a roll leaves them alone (the torch itself off).
const TORCH_KEYS = new Set<string>(["torchEffect", "overlaySpareSidebars", "overlayFollowMode", "overlayRadius", "overlayDarkness",
  "overlayIntensity", "overlayColor", "overlayFlicker", "overlaySpeed", "overlayBlinkSync", "overlayBlinkDepth", "overlayFlickerAmount"]);
const SOUND_KEYS = new Set<string>(["typewriterSound", "typewriterSoundVoice", "typewriterSoundVolume", "typewriterSoundBell"]);

// A seeded generator (mulberry32), for the tests; the plugin rolls with
// Math.random.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollLook(opts: RollOptions, rand: () => number = Math.random): Partial<Look> {
  const unit = (v: number) => Math.max(0, Math.min(1, (Number.isFinite(v) ? v : 0) / 100));
  const chaos = unit(opts.chaos), color = unit(opts.color), motion = unit(opts.motion);
  const full = chaos >= 0.999;
  const allowed = (key: string) => rollAllowed(opts.allow, key);
  const chance = (p: number) => full || rand() < p;
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length) % list.length];
  // A value in a setting's range, on its step.
  const snap = (v: number, min: number, max: number, step: number) => +Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(4);
  const any = (min: number, max: number, step: number) => snap(min + rand() * (max - min), min, max, step);
  // Turned up with Chaos: the upper part of the range opens as it rises.
  const level = (min: number, max: number, step: number) => snap(min + rand() * (max - min) * (0.35 + 0.65 * chaos), min, max, step);

  // Every look key back to its default first, so nothing of the last look
  // leaks into the new one; the torch's and (Sounds off: the sound is
  // switched off) are kept out.
  const out: Record<string, unknown> = {};
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  for (const k of LOOK_KEYS) if (!TORCH_KEYS.has(k) && !SOUND_KEYS.has(k)) out[k] = defaults[k];
  out.torchEffect = false;
  for (const k of [...ROLL_EFFECTS, "smear", "popLetters", "glow", "bracketTether"]) out[k] = false;
  const look = out as Partial<Look>;

  // Shape.
  const style = rand() < 0.45 ? "Box" : rand() < 0.65 ? "Line" : "Underline";
  look.cursorStyle = style;
  if (style === "Line") { look.caretWidthPx = any(1.5, 3 + 3 * chaos, 0.1); look.lineSerifs = chance(0.1 + 0.25 * chaos); }
  if (style === "Underline") look.underlineWidthPx = any(1.5, 3 + 2 * chaos, 0.1);
  if (style === "Box") { look.boxHollow = !full && rand() < 0.15; look.boxHollowWidth = any(1.5, 3, 0.1); look.showChar = true; }
  look.cursorRounded = rand() < 0.35;
  look.cursorTranslucent = !full && rand() < 0.12;
  look.glow = chance(0.4 + 0.5 * chaos);

  // Color: a hue, then as many stops around the wheel as Color asks for.
  // Dark themes get light, saturated colors; light themes deep ones.
  const hue = rand() * 360;
  const dark = (h: number) => rgbTupleToHex(hslToRgbTuple(h, 0.75 + 0.25 * rand(), 0.58 + 0.1 * rand()));
  const light = (h: number) => rgbTupleToHex(hslToRgbTuple(h, 0.65 + 0.25 * rand(), 0.32 + 0.08 * rand()));
  const gradient = full || rand() < 0.15 + 0.8 * color;
  const count = full ? 4 : !gradient ? 2 : color < 0.45 ? 2 : color < 0.8 ? 3 : 4;
  const spread = 25 + color * 290 + rand() * 40;
  const hues = Array.from({ length: 4 }, (_, i) => hue + (i * spread) / Math.max(1, count - 1));
  look.colorDark = dark(hue);
  look.colorLight = light(hue);
  look.gradientEnabled = gradient;
  look.gradientCount = count;
  look.gradientDark1 = dark(hues[0]); look.gradientDark2 = dark(hues[1]); look.gradientDark3 = dark(hues[2]); look.gradientDark4 = dark(hues[3]);
  look.gradientLight1 = light(hues[0]); look.gradientLight2 = light(hues[1]); look.gradientLight3 = light(hues[2]); look.gradientLight4 = light(hues[3]);

  // Blink.
  look.blinkingEnabled = !full && rand() < 0.6;
  look.blinkSpeed = any(0.8, 1.8, 0.1);
  look.blinkFade = any(0.1, 0.3, 0.05);
  look.blinkBreathing = rand() < 0.25;
  look.smoothStopBlinking = true;

  // Motion: the glide, the smear.
  look.smoothEnabled = chance(0.2 + 0.75 * motion);
  look.smoothStyle = pick(["ease", "smooth", "springy", "linear"]);
  look.catchUpSpeed = any(0.35 + 0.3 * (1 - motion), 0.8, 0.05);
  look.smoothAdaptive = true;
  look.smear = allowed("smear") && chance(0.1 + 0.7 * motion);
  look.smearStiffness = any(0.3, 0.8, 0.05);
  look.smearTrailingStiffness = snap(0.5 - 0.4 * motion + rand() * 0.15, 0.05, 1, 0.05);
  look.smearTaper = rand() < 0.4;

  // Effects: of the ones let in, one at Chaos 0, all of them at 100 (none
  // let in: none).
  const pool: (keyof Look)[] = ROLL_EFFECTS.filter((k) => allowed(k));
  const max = pool.length;
  const n = !max ? 0 : full ? max : Math.max(1, Math.min(max, Math.round(1 + chaos * (max - 1) + (rand() - 0.5) * 1.6 * Math.min(1, chaos * 4))));
  const order = pool.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const on = new Set(order.slice(0, n));
  // Motion leans on the moving ones: CRT's trail and the pixel trail.
  if (!full && motion > 0.7 && allowed("crtEffect") && !on.has("crtEffect") && rand() < motion - 0.5) on.add("crtEffect");
  for (const k of on) out[k] = true;

  if (on.has("popEffects")) {
    look.popLetters = chance(0.75);
    look.popLettersRise = !full && rand() < 0.3;
    look.backspaceDisintegrate = chance(0.3 + 0.5 * chaos);
    look.backspaceEvaporate = !look.backspaceDisintegrate && rand() < 0.5;
    // The cursor's own way of eating: Back-man a Box's, Shredder a Line's,
    // Rabbit hole an Underline's.
    look.backMan = style === "Box" && chance(0.35);
    look.shredder = style === "Line" && chance(0.35);
    look.rabbitHole = style === "Underline" && chance(0.35);
    look.thunderstrike = chance(0.2 + 0.6 * chaos);
    look.thunderstrikeSize = any(1, 5, 1);
    look.thunderstrikeStrength = level(0.3, 1, 0.05);
    look.fireworks = chance(0.2 + 0.6 * chaos);
    look.fireworksQuantity = level(0.6, 3, 0.1);
    if (!look.popLetters && !look.backspaceDisintegrate && !look.backspaceEvaporate && !look.thunderstrike && !look.fireworks) look.popLetters = true;
    look.popRainbow = chance(color * 0.8);
  }
  if (on.has("typewriter")) {
    look.typewriterSpring = chance(0.7);
    look.typewriterDepth = level(10, 40, 1);
    look.typewriterBounce = any(0.5, 1.5, 0.1);
    look.typewriterSquash = any(5, 30, 1);
    look.typewriterStrikeMs = any(180, 360, 10);
    look.typewriterInk = chance(0.45);
    look.typewriterInkSize = level(1.1, 2, 0.05);
    look.typewriterFreshInk = chance(0.4);
    look.typewriterReturn = chance(0.5);
    look.typewriterAdvance = chance(0.35);
    look.typewriterTape = chance(0.35);
    if (!look.typewriterSpring && !look.typewriterInk && !look.typewriterFreshInk && !look.typewriterReturn && !look.typewriterAdvance && !look.typewriterTape) look.typewriterSpring = true;
  }
  if (on.has("flameTrail")) {
    look.flameTrailDensity = level(0.5, 3, 0.1);
    look.flameTrailLifeMs = level(250, 1500, 50);
    look.flameTrailPixelSize = any(2, 8, 0.5);
    look.flameTrailOnJump = rand() < 0.5;
    look.flameTrailGravity = rand() < 0.3 ? any(0.2, 0.8, 0.05) : 0;
    look.flameTrailGravityAngle = pick([0, 0, 180, 90, 270]);
    look.flameTrailGradientColors = gradient && chance(color);
  }
  if (on.has("stardustEnabled")) {
    look.stardustAlwaysOn = rand() < 0.3;
    look.stardustOrbit = rand() < 0.4;
    look.stardustOrbitRadius = any(14, 40, 2);
    look.stardustRate = level(0.6, 3, 0.1);
    look.stardustDelayMs = any(750, 3000, 250);
  }
  if (on.has("energyEffect")) {
    look.energySpeed = any(0.6, 2.5, 0.1);
    look.energyAurora = gradient && chance(0.6);
    look.energyAuroraWaviness = any(0.5, 1.5, 0.05);
  }
  if (on.has("crtEffect")) {
    look.trailLength = Math.round(level(4, 30, 1) * (0.5 + 0.5 * motion)) || 4;
    look.trailFadeMs = level(200, 1000, 25);
    look.crtNeon = chance(0.35 + 0.4 * chaos);
    look.crtNeonGradient = gradient && chance(color);
    look.crtGlitch = chance(0.15 + 0.5 * chaos);
    look.crtGlitchStrength = level(0.4, 2.5, 0.1);
    look.crtGlitchAberration = level(0.3, 3, 0.1);
  }
  if (on.has("speedDemon")) {
    look.speedDemonSparks = chance(0.8);
    look.speedDemonSensitivity = any(0.8, 1.6, 0.1);
    look.speedDemonSparkQuantity = level(0.5, 3, 0.1);
    look.speedDemonSparkTrail = Math.round(any(0, 20, 1));
    look.speedDemonGradient = gradient && chance(color * 0.6);
    if (look.speedDemonGradient) {
      look.speedHeatDark1 = look.gradientDark1; look.speedHeatDark2 = look.gradientDark2; look.speedHeatDark3 = look.gradientDark3; look.speedHeatDark4 = "#fff3d0";
      look.speedHeatLight1 = look.gradientLight1; look.speedHeatLight2 = look.gradientLight2; look.speedHeatLight3 = look.gradientLight3; look.speedHeatLight4 = "#e8a33c";
    }
  }
  if (on.has("hotHead")) {
    look.hotHeadQuantity = level(0.5, 2.5, 0.1);
    look.hotHeadSpread = Math.round(any(2, 10, 1));
    look.hotHeadTrail = Math.round(any(0, 20, 1));
    look.hotHeadHeight = level(0.4, 1.2, 0.05);
    look.hotHeadSpeedHeat = rand() < 0.3;
  }

  // Sounds: one of all of them, near the default level.
  if (opts.sounds) {
    look.typewriterSound = true;
    look.typewriterSoundVoice = pick(SOUND_MACHINES).id;
    look.typewriterSoundVolume = any(40, 60, 5);
    look.typewriterSoundBell = true;
  } else {
    look.typewriterSound = false;
  }
  return look;
}

// The effects a look has on, by key (for the notice after a roll).
export function rolledEffects(look: Partial<Look>): string[] {
  return ROLL_EFFECTS.filter((k) => !!look[k]);
}
