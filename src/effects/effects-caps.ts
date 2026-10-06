// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// Caps Lock and Shift (1.7.7, "a caps lock or when shift is pressed effect.
// invert color of cursor and make it a bit bigger ... desktop only"; then
// "we need to make it work for all efects"): while Caps Lock is on, or
// Shift is held on its own, the cursor and every effect it throws off flip
// to their opposite colors - the whole canvas's hue turned half the wheel
// (_capsCanvas), a white or gray cursor to the accent (capsColor, through
// getBaseColor and gradientStops) - and the cursor grows a little from its
// foot (_capsGrow, round the painters' bodies). It eases in and out
// (CAPS_EASE_MS) rather than jumping. Shift with Ctrl, Alt or Cmd is a
// shortcut, not a capital: no look then. In Vim, Caps Lock shows in every
// mode (in Normal mode it is the warning you want), Shift only in insert
// and replace (it runs commands in the others). The mouse reads Caps Lock
// too, so it is right after coming back from another app. Phones report
// neither key, and the setting is hidden there.
import { Platform } from "obsidian";
import { capsColor } from "../util/color";
import type CursorSmithPlugin from "../plugin";

// How much bigger the cursor grows, and the ease's time constant: about 80 ms
// to get there.
export const CAPS_GROW = 0.15;
export const CAPS_EASE_MS = 28;
// A white or gray cursor's stand-in when Obsidian's accent cannot be read.
const CAPS_FALLBACK = "#ffb000";

// The look's amount, eased toward `on` over `dt` ms. Pure.
export function capsEase(amt: number, on: boolean, dt: number): number {
  const target = on ? 1 : 0;
  const next = target + (amt - target) * Math.exp(-Math.max(0, dt) / CAPS_EASE_MS);
  return Math.abs(next - target) < 0.01 ? target : next;
}

// What a key event says: Caps Lock on, Shift held on its own. Pure.
export function capsKeys(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; getModifierState?: (k: string) => boolean }) {
  return {
    caps: typeof e.getModifierState === "function" && !!e.getModifierState("CapsLock"),
    shift: !!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey,
  };
}

export const effectsCapsMethods = {
  // Every keydown and keyup (plugin.ts): the keys' state, and a frame when
  // it changed (the release of Shift is a keyup, which wakes nothing else).
  _capsKey(this: CursorSmithPlugin, e: KeyboardEvent) {
    if (Platform.isMobile) return;
    const k = capsKeys(e);
    if (k.caps === this._capsOn && k.shift === this._shiftHeld) return;
    this._capsOn = k.caps;
    this._shiftHeld = k.shift;
    this._capsChanged();
  },

  // The keys changed: when (the ease starts there, not at the last frame
  // drawn - after a while idle that was a jump straight to the end, which
  // the frame governor took for nothing moving, and the frame went
  // unpainted: Shift could not be tapped), and a frame.
  _capsChanged(this: CursorSmithPlugin) {
    this._capsChangeT = performance.now();
    this._markActivity("key");
  },

  // The mouse moving or pressed (plugin.ts): Caps Lock as it is now - it
  // may have changed in another app. Not Shift: a Shift-click selects.
  _capsPointer(this: CursorSmithPlugin, e: MouseEvent) {
    if (Platform.isMobile || typeof e.getModifierState !== "function") return;
    const caps = !!e.getModifierState("CapsLock");
    if (caps === this._capsOn) return;
    this._capsOn = caps;
    this._capsChanged();
  },

  // The window losing focus: a Shift held through Alt+Tab never sends its
  // keyup here.
  _capsBlur(this: CursorSmithPlugin) {
    if (!this._shiftHeld) return;
    this._shiftHeld = false;
    this._capsChanged();
  },

  // Whether the look is wanted now: the setting on, on a desktop, and Caps
  // Lock on - or Shift held, outside a Vim mode where Shift runs commands.
  _capsWanted(this: CursorSmithPlugin): boolean {
    if (!this.look.capsLook || Platform.isMobile) return false;
    if (this._capsOn) return true;
    if (!this._shiftHeld) return false;
    const mode = this.lookVimMode();
    return !mode || mode === "insert" || mode === "replace";
  },

  // How far the look is in at `now` (0 none, 1 all), eased: toward what
  // was wanted until the keys changed, toward what is wanted since.
  capsAmount(this: CursorSmithPlugin, now: number): number {
    const s = this._caps || (this._caps = { amt: 0, at: now, on: false });
    const on = this._capsWanted();
    if (on !== s.on) {
      const t = Math.min(now, Math.max(s.at, this._capsChangeT));
      if (t > s.at) { s.amt = capsEase(s.amt, s.on, t - s.at); s.at = t; }
      s.on = on;
    }
    if (now > s.at) { s.amt = capsEase(s.amt, on, now - s.at); s.at = now; }
    return s.amt;
  },

  // Whether it is still easing (the frame governor keeps the frames coming).
  // A pure read, as the governor's must be: the amount as last drawn, against
  // what is wanted now.
  capsMoving(this: CursorSmithPlugin, _now: number): boolean {
    return (this._caps ? this._caps.amt : 0) !== (this._capsWanted() ? 1 : 0);
  },

  // The look's part of a static frame's signature (_frameSignature): wanted
  // or not, and how far in as last drawn.
  _capsSig(this: CursorSmithPlugin): string {
    return (this._capsWanted() ? "C" : "c") + Math.round((this._caps ? this._caps.amt : 0) * 100);
  },

  // A color the cursor is painted in, as far as the look is in: a white or
  // gray one toward the accent (capsColor); the canvas's turn does the rest.
  _capsFlip(this: CursorSmithPlugin, hex: string): string {
    const k = this.capsAmount(performance.now());
    return k > 0 ? capsColor(hex, k, this._capsAccent()) : hex;
  },

  // Obsidian's accent as hex (a color the canvas reads back as one), read
  // at most once a second - it changes only with the theme.
  _capsAccent(this: CursorSmithPlugin): string {
    const now = performance.now();
    const c = this._capsAccentCache;
    if (c && now - c.t < 1000) return c.hex;
    let hex = CAPS_FALLBACK;
    const ctx = this.ctx;
    const doc = this.canvas ? this.canvas.ownerDocument : document;
    const v = doc.body ? getComputedStyle(doc.body).getPropertyValue("--interactive-accent").trim() : "";
    if (v && ctx) {
      const was = ctx.fillStyle;
      ctx.fillStyle = CAPS_FALLBACK;
      ctx.fillStyle = v;
      const got = String(ctx.fillStyle);
      ctx.fillStyle = was;
      if (got[0] === "#") hex = got;
    }
    this._capsAccentCache = { hex, t: now };
    return hex;
  },

  // Every effect at once: the canvas's hue turned half the wheel as far as
  // the look is in (a CSS filter: the compositor's work, nothing redrawn).
  // Written only on change, as applyCanvasBlend's blend is.
  _capsCanvas(this: CursorSmithPlugin, now: number) {
    const el = this.canvas;
    if (!el) return;
    const k = this.capsAmount(now);
    const want = k > 0 ? `hue-rotate(${Math.round(180 * k)}deg)` : "";
    if (this._capsFilter === want) return;
    this._capsFilter = want;
    el.style.filter = want;
  },

  // Grows what is painted next from the cursor's foot (cx, foot), as far as
  // the look is in. Inside the caller's save/restore.
  _capsGrow(this: CursorSmithPlugin, ctx: CanvasRenderingContext2D, cx: number, foot: number, now: number) {
    const k = this.capsAmount(now);
    if (!(k > 0)) return;
    const s = 1 + CAPS_GROW * k;
    ctx.translate(cx, foot);
    ctx.scale(s, s);
    ctx.translate(-cx, -foot);
  },
};
