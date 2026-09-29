// Part of the plugin class (HANDOFF §1.17): assigned onto
// CursorSmithPlugin.prototype like the other method files. `this` is the
// plugin.
//
// Typewriter's Sounds (1.7.2): real typewriters as you type. Each machine is
// its own recording (samples.ts: a Hermes 3000, an Underwood, an IBM
// Selectric II, an Olivetti Lettera 22, a Sears Electric Twelve), its keys,
// capitals, space bar, Backspace, carriage return and margin bell cut from
// it, packed into one MP3 that is decoded once when the machine is chosen
// and played a slice at a time.
//
// Every edit a key makes in a note arrives here from CodeMirror as it
// happens (an update listener - the frame loop sees keystrokes a frame late
// and merges fast ones), is told apart - a letter, a capital, Space, Enter,
// Tab, Backspace, Delete; paste, undo, redo and Vim's commands stay silent -
// and played. Subtle on purpose: half volume by default, a little softer when
// typing fast and for a held key, never two takes alike, placed left or
// right with the cursor (the carriage), the return running back across as
// the carriage does, the bell well under the keys.
//
// All of it is here and in samples.ts; what else knows about it: one line in
// onload (_soundSetup), four settings (typewriterSound*), their rows under
// Typewriter, and the declarations in plugin.ts - so it comes out whole.
import { EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { SOUND_MACHINES } from "./samples";
import type { SoundMachine } from "./samples";
import type CursorSmithPlugin from "../plugin";

// What a machine's recording holds: its keys (strike), heavier keys for
// capitals, its space bar, Backspace (a lighter mechanical sound), the whole
// carriage return (feed: the lever, the line feed, the carriage run back,
// the stop), and the margin bell.
export type AtomName = "strike" | "capital" | "space" | "back" | "feed" | "bell";
export const ATOM_NAMES: AtomName[] = ["strike", "capital", "space", "back", "feed", "bell"];

// Each sound's level before the volume. The recordings are levelled when
// they are cut (the keys alike, the bell well under them - "too loud", the
// user, of the first one); this is the last word.
export const SOUND_GAIN: Record<AtomName, number> = {
  strike: 1, capital: 1, space: 1, back: 0.9, feed: 0.85, bell: 0.55,
};
// Two sounds closer than this are one keystroke (a held key's repeats go
// through, softer); Enter always plays.
const SOUND_MIN_GAP_MS = 16;
// The key just pressed, trusted for this long to name an edit CodeMirror
// did not label (Obsidian's list Enter, its Tab).
const SOUND_KEY_TRUST_MS = 150;
// Silence this long and the audio device is let go (suspended); the next
// key wakes it.
const SOUND_IDLE_MS = 20000;
// A line shorter than this rings no bell: Enter on an empty line is
// paragraph spacing, not the end of a line typed.
const BELL_MIN_COLUMN = 4;
// Enter on an empty line: the carriage has nowhere to go, so only the
// return's start (the lever and the line feed) plays, this long.
const FEED_ONLY_S = 0.24;
// Tab: the end of the carriage's run and its stop, this long.
const TAB_S = 0.4;

export const DEFAULT_SOUND_MACHINE = "hermes3000";

export type SoundEvent =
  | { kind: "key"; char: string; capital: boolean }
  | { kind: "space" }
  | { kind: "enter"; column: number }
  | { kind: "tab" }
  | { kind: "back"; count: number }
  | { kind: "del"; count: number };

export interface SoundKey { key: string; t: number; repeat: boolean }

// What CodeMirror hands the listener, as much of it as this needs (the
// tests build these).
export interface SoundTransaction {
  docChanged: boolean;
  isUserEvent(event: string): boolean;
  changes: { iterChanges(f: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void): void };
  startState: { doc: { lineAt(pos: number): { from: number } } };
}

// Where one take sits in its machine's decoded audio.
export interface SoundTake { start: number; dur: number }

export interface SoundState {
  ctx: AudioContext | null;
  master: GainNode | null;
  volume: number;
  voice: string | null;
  // The chosen machine, decoded: its audio, the decoder's delay against the
  // packed layout, and its takes by sound.
  buffer: AudioBuffer | null;
  delay: number;
  takes: Partial<Record<AtomName, SoundTake[]>>;
  ready: boolean;
  rendering: Promise<void> | null;
  lastT: number;
  lastKey: SoundKey | null;
  idleTimer: number;
  seed: number;
}

// One sound on its way out: its level and its place, to shape as it plays.
interface Playing { gain: GainNode; pan: StereoPannerNode | null }

export function soundMachine(id: string | null | undefined): SoundMachine {
  return SOUND_MACHINES.find((m) => m.id === id) || SOUND_MACHINES.find((m) => m.id === DEFAULT_SOUND_MACHINE) || SOUND_MACHINES[0];
}

// A machine's takes by sound, in the order they were packed.
export function soundTakes(m: SoundMachine): Partial<Record<AtomName, SoundTake[]>> {
  const out: Partial<Record<AtomName, SoundTake[]>> = {};
  for (const [name, start, dur] of m.sounds) {
    const n = name as AtomName;
    (out[n] || (out[n] = [])).push({ start, dur });
  }
  return out;
}

// Where the first sound starts: the first sample over a fifth of the loudest
// up to `until` s - the end of the first sound, so a louder sound after it
// is never taken for it - the rule samples.ts's `onset` was measured by
// (up to 20 ms after the sound there; here 70, a decoder's delay allowed,
// still short of the next sound 80 ms on), so the difference is the
// decoder's delay.
export function soundOnset(x: Float32Array, rate: number, until = 0.6): number {
  const n = Math.min(x.length, Math.round(until * rate));
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(x[i]));
  for (let i = 0; i < n; i++) if (Math.abs(x[i]) > m * 0.2) return i / rate;
  return 0;
}

// The MP3's bytes from its base64.
export function soundBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// The typebar a character sits on: the same one every time, spread over the
// takes so neighbouring letters differ.
export function typebarOf(char: string, takes: number): number {
  const c = (char || "a").toLowerCase().codePointAt(0) || 97;
  // Picked so the 40 commonest English letter pairs mostly land on different
  // keys (2 or 3 of 40 share one) with 5, 6 or 8 takes alike, and every take
  // gets letters; c * 5 % 5 had put every letter on one key, * 153 left one
  // of six keys unused.
  return (Math.imul(c, 3021) >>> 7) % Math.max(1, takes);
}

// What an edit was, from the transaction and the key just pressed - or null
// for one that makes no sound (a paste, an undo, a Vim command, an edit from
// somewhere else).
export function classifySoundEdit(tr: SoundTransaction, lastKey: SoundKey | null, now: number): SoundEvent | null {
  if (!tr.docChanged) return null;
  for (const quiet of ["undo", "redo", "input.paste", "input.drop", "delete.cut", "input.complete", "move"]) {
    if (tr.isUserEvent(quiet)) return null;
  }
  let ins = "", del = 0, from = -1;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (from < 0) from = fromA;
    del += toA - fromA;
    ins += inserted.toString();
  });
  const typed = tr.isUserEvent("input"), deleting = tr.isUserEvent("delete");
  const recent = lastKey && now - lastKey.t < SOUND_KEY_TRUST_MS ? lastKey.key : "";
  if (!typed && !deleting) {
    // Obsidian's own Enter (a list continued) and Tab (an item indented)
    // leave the transaction unlabeled: the key just pressed says what it
    // was. Anything else unlabeled - Vim's normal-mode commands, a plugin's
    // edit, sync - is not a keystroke.
    const byKey =
      (recent === "Enter" && ins.includes("\n")) ||
      (recent === "Tab" && del + ins.length > 0) ||
      ((recent === "Backspace" || recent === "Delete") && del > 0 && !ins) ||
      (recent.length === 1 && ins === recent);
    if (!byKey) return null;
  }
  if (ins.includes("\n")) {
    // One Enter: a newline, perhaps a list marker or an indent after it.
    if ((ins.match(/\n/g) || []).length > 2 || ins.length > 120) return null;
    const line = tr.startState.doc.lineAt(Math.max(0, from));
    return { kind: "enter", column: Math.max(0, from - line.from) };
  }
  if (tr.isUserEvent("input.indent") || recent === "Tab") return { kind: "tab" };
  if (!ins) {
    if (del <= 0) return null;
    const forward = tr.isUserEvent("delete.forward") || (!tr.isUserEvent("delete.backward") && recent === "Delete");
    return { kind: forward ? "del" : "back", count: del };
  }
  if (ins === " " || (ins.trim() === "" && recent === " ")) return { kind: "space" };
  const ch = Array.from(ins.trimStart())[0] || ins[0];
  return { kind: "key", char: ch, capital: ch !== ch.toLowerCase() && ch === ch.toUpperCase() };
}

// Where a sound sits left to right: the carriage's place, from the cursor's
// across the window, kept close to the middle (subtle).
export function soundPan(x: number | null | undefined, width: number): number {
  if (typeof x !== "number" || !(width > 0)) return 0;
  return Math.max(-0.3, Math.min(0.3, (x / width - 0.5) * 0.6));
}

// The Volume slider (0 - 100) as a gain: a curve, so the low end is fine
// enough for a quiet room.
export function soundVolumeGain(v: number): number {
  const u = Math.max(0, Math.min(100, Number.isFinite(v) ? v : 50)) / 100;
  return Math.pow(u, 1.6) * 0.9;
}

export const soundMethods = {
  // Once, in onload: the listener, the keys (for the edits CodeMirror does
  // not label, and to wake the audio), and the clean-up.
  _soundSetup(this: CursorSmithPlugin) {
    this._sound = {
      ctx: null, master: null, volume: -1, voice: null, buffer: null, delay: 0, takes: {}, ready: false, rendering: null,
      lastT: 0, lastKey: null, idleTimer: 0, seed: 1,
    };
    this.registerEditorExtension(EditorView.updateListener.of((u: ViewUpdate) => this._soundOnUpdate(u)));
    const onKey = (e: KeyboardEvent) => {
      if (!this._sound) return;
      this._sound.lastKey = { key: e.key, t: performance.now(), repeat: e.repeat };
      this._soundWake();
    };
    const listen = (win: Window) => {
      this.registerDomEvent(win, "keydown", onKey, { capture: true });
      this.registerDomEvent(win, "pointerdown", () => this._soundWake(), { capture: true });
    };
    listen(window);
    this.registerEvent(this.app.workspace.on("window-open", (w) => listen(w.win)));
    this.register(() => this._soundClose());
    // Decoded ahead, so the first key is heard.
    this.app.workspace.onLayoutReady(() => window.setTimeout(() => { if (this._soundOn()) void this._soundPrepare(); }, 1500));
  },

  // Whether sounds are on for the look showing now: the plugin, this
  // device, Typewriter and its Sounds.
  _soundOn(this: CursorSmithPlugin): boolean {
    const l = this.look;
    return !!(this._sound && this.settings.enabled && this._deviceEnabled !== false && l && l.typewriter && l.typewriterSound);
  },

  // The chosen machine's id (an unknown one - a code from a newer or older
  // version - is the default machine).
  _soundVoice(this: CursorSmithPlugin): string {
    return soundMachine(this.look.typewriterSoundVoice).id;
  },

  // A key or a click: the moment the browser lets audio start, so the
  // context is made or resumed here, and the machine readied.
  _soundWake(this: CursorSmithPlugin) {
    if (!this._soundOn()) return;
    const ctx = this._soundCtx();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => { /* not allowed yet */ });
    void this._soundPrepare();
  },

  // The audio context and its output: every sound through one gain (the
  // volume) and a gentle limiter, so a burst of typing never clips.
  _soundCtx(this: CursorSmithPlugin): AudioContext | null {
    const s = this._sound;
    if (!s) return null;
    if (s.ctx && s.ctx.state !== "closed") return s.ctx;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor({ latencyHint: "interactive" });
      const master = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 10;
      limiter.ratio.value = 4;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      master.connect(limiter).connect(ctx.destination);
      s.ctx = ctx;
      s.master = master;
      s.volume = -1;
      return ctx;
    } catch (e) {
      this._reportOnce("sound: audio context", e);
      return null;
    }
  },

  // The chosen machine, decoded (once per machine; a change of machine
  // starts over), and the decoder's delay found against its first sound.
  _soundPrepare(this: CursorSmithPlugin): Promise<void> {
    const s = this._sound;
    if (!s) return Promise.resolve();
    const id = this._soundVoice();
    if (s.voice === id && (s.ready || s.rendering)) return s.rendering || Promise.resolve();
    const ctx = this._soundCtx();
    if (!ctx) return Promise.resolve();
    const m = soundMachine(id);
    s.voice = id;
    s.ready = false;
    s.buffer = null;
    const job = (async () => {
      const buf = await ctx.decodeAudioData(soundBytes(m.mp3));
      if (s.voice !== id) return;
      const first = m.sounds[0];
      const delay = soundOnset(buf.getChannelData(0), buf.sampleRate, first[1] + first[2] + 0.07) - m.onset;
      s.delay = Math.max(-0.02, Math.min(0.2, delay));
      s.buffer = buf;
      s.takes = soundTakes(m);
      s.ready = true;
    })().catch((e) => { this._reportOnce("sound: decode", e); })
      .finally(() => { if (s.rendering === job) s.rendering = null; });
    s.rendering = job;
    return job;
  },

  // One take of a sound at `when` (context time): its level, where it sits,
  // a hair of pitch; `from` s into it for `dur` s (a part of the return).
  _soundAtom(this: CursorSmithPlugin, name: AtomName, take: number, when: number, gain: number, pan: number, rate = 1, from = 0, dur = -1): Playing | null {
    const s = this._sound;
    if (!s || !s.ctx || !s.master || !s.buffer || gain <= 0) return null;
    const list = s.takes[name];
    if (!list || !list.length) return null;
    const a = list[((take % list.length) + list.length) % list.length];
    const ctx = s.ctx;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
    src.connect(g);
    if (p) { p.pan.value = pan; g.connect(p).connect(s.master); } else g.connect(s.master);
    src.onended = () => { src.disconnect(); g.disconnect(); if (p) p.disconnect(); };
    const at = Math.max(0, a.start + s.delay + from);
    src.start(when, at, dur > 0 ? Math.min(dur, a.dur - from) : Math.max(0.001, a.dur - from));
    return { gain: g, pan: p };
  },

  _soundRand(this: CursorSmithPlugin): number {
    const s = this._sound;
    if (!s) return 0.5;
    s.seed = (s.seed * 1664525 + 1013904223) >>> 0;
    return s.seed / 4294967296;
  },

  // Every edit in a note: the focused editor's, sounds on, one sound.
  _soundOnUpdate(this: CursorSmithPlugin, u: ViewUpdate) {
    if (!u.docChanged || !this._soundOn() || !u.view.hasFocus) return;
    const s = this._sound;
    if (!s) return;
    const now = performance.now();
    for (const tr of u.transactions) {
      const ev = classifySoundEdit(tr, s.lastKey, now);
      if (!ev) continue;
      const a = this.lastActive;
      this._soundPlay(ev, 0, a ? a.x : null, a && typeof a.rowLeft === "number" ? a.rowLeft : null);
      break;
    }
  },

  // Play what an edit sounds like, `delay` s from now (the preview plays a
  // sentence ahead). x: where the cursor was, for the carriage's place;
  // rowLeft: where its line starts, for the return back.
  _soundPlay(this: CursorSmithPlugin, ev: SoundEvent, delay = 0, x: number | null = null, rowLeft: number | null = null) {
    const s = this._sound;
    const ctx = this._soundCtx();
    if (!s || !ctx) return;
    if (!s.ready || s.voice !== this._soundVoice()) { void this._soundPrepare(); return; }
    if (!s.master) return;
    const vol = Number(this.look.typewriterSoundVolume ?? DEFAULT_SETTINGS.typewriterSoundVolume);
    if (vol !== s.volume) { s.master.gain.value = soundVolumeGain(vol); s.volume = vol; }
    let g = 1;
    if (!delay) {
      // A keystroke: one sound each; softer when they come fast, softer
      // still for a held key's repeats.
      const now = performance.now(), gap = now - s.lastT;
      if (gap < SOUND_MIN_GAP_MS && ev.kind !== "enter") return;
      g *= 0.82 + 0.18 * Math.min(1, gap / 160);
      if (s.lastKey && s.lastKey.repeat) g *= 0.6;
      s.lastT = now;
    }
    g *= 1 + (this._soundRand() - 0.5) * 0.16;
    const t0 = ctx.currentTime + delay;
    const width = window.innerWidth || 1000;
    const pan = soundPan(x, width);
    const rate = () => 1 + (this._soundRand() - 0.5) * 0.03;
    const count = (n: AtomName) => (s.takes[n] || []).length;
    const take = (n: AtomName) => Math.floor(this._soundRand() * Math.max(1, count(n)));
    switch (ev.kind) {
      case "key":
        if (ev.capital) this._soundAtom("capital", take("capital"), t0, SOUND_GAIN.capital * g, pan, rate());
        else this._soundAtom("strike", typebarOf(ev.char, count("strike")), t0, SOUND_GAIN.strike * g, pan, rate());
        break;
      case "space":
        this._soundAtom("space", take("space"), t0, SOUND_GAIN.space * g, pan, rate());
        break;
      case "back":
      case "del": {
        // Backspace, the carriage pulled back a notch; Delete its brighter
        // twin (the same sound, a little higher). A word taken: a notch or
        // two more after it, softer.
        const r = ev.kind === "del" ? 1.07 : 1;
        this._soundAtom("back", take("back"), t0, SOUND_GAIN.back * g, pan, r * rate());
        for (let k = 1; k < Math.min(ev.count, 3); k++) {
          this._soundAtom("back", take("back"), t0 + 0.045 * k, SOUND_GAIN.back * g * (1 - 0.18 * k), pan - 0.02 * k, r * rate());
        }
        break;
      }
      case "tab": {
        // The tabulator: the carriage jumps to its stop - the end of the
        // return's run.
        const feed = (s.takes.feed || [])[0];
        if (feed) this._soundAtom("feed", 0, t0, SOUND_GAIN.feed * g * 0.8, pan, 1, Math.max(0, feed.dur - TAB_S), TAB_S);
        break;
      }
      case "enter": {
        // The margin bell if the line reached it, then the carriage return -
        // the lever, the line feed, the carriage run back (from the cursor's
        // place to the line's start, left to right in the ears), the stop.
        // On an empty line only the lever and the line feed.
        if (this.look.typewriterSoundBell && ev.column >= BELL_MIN_COLUMN) {
          this._soundAtom("bell", 0, t0, SOUND_GAIN.bell * g, pan * 0.5);
        }
        const feed = (s.takes.feed || [])[0];
        if (!feed) break;
        if (ev.column < 2) {
          const p = this._soundAtom("feed", 0, t0, SOUND_GAIN.feed * g, pan, 1, 0, FEED_ONLY_S);
          if (p) { p.gain.gain.setValueAtTime(SOUND_GAIN.feed * g, t0 + FEED_ONLY_S - 0.05); p.gain.gain.linearRampToValueAtTime(0, t0 + FEED_ONLY_S); }
          break;
        }
        const p = this._soundAtom("feed", 0, t0 + 0.03, SOUND_GAIN.feed * g, pan);
        // Carriage return's streak, timed to this return: its head reaches
        // the line's start (at 60% of its sweep) as the carriage stops, near
        // the recording's end. Not for the preview (it has no caret).
        if (!delay) this._returnSweep = { ms: Math.max(300, Math.min(4000, ((feed.dur - 0.09) / 0.6) * 1000)), t: performance.now() };
        const endX = rowLeft !== null ? rowLeft : x !== null ? x - ev.column * 8 : null;
        if (p && p.pan) { p.pan.pan.setValueAtTime(pan, t0 + 0.03); p.pan.pan.linearRampToValueAtTime(soundPan(endX, width), t0 + 0.03 + feed.dur); }
        break;
      }
    }
    // Let the device go after a while of quiet.
    if (s.idleTimer) window.clearTimeout(s.idleTimer);
    s.idleTimer = window.setTimeout(() => {
      s.idleTimer = 0;
      if (s.ctx && s.ctx.state === "running") void s.ctx.suspend().catch(() => { /* closing */ });
    }, SOUND_IDLE_MS);
  },

  // The Machine row's play button: a few words typed, a slip taken back, a
  // space, Enter - the machine as it sounds in use.
  async soundPreview(this: CursorSmithPlugin) {
    const s = this._sound;
    const ctx = this._soundCtx();
    if (!s || !ctx) return;
    try { await ctx.resume(); } catch (e) { this._reportOnce("sound: preview", e); return; }
    await this._soundPrepare();
    const w = window.innerWidth || 1000;
    let x = w * 0.3, t = 0.05;
    const step = (ev: SoundEvent, gapS: number) => {
      this._soundPlay(ev, t, x, w * 0.3);
      if (ev.kind === "key" || ev.kind === "space") x += 9;
      if (ev.kind === "back") x -= 9;
      t += gapS + this._soundRand() * 0.05;
    };
    const word = (text: string) => Array.from(text).forEach((c) => step({ kind: "key", char: c, capital: c !== c.toLowerCase() }, 0.12));
    word("Dear");
    step({ kind: "space" }, 0.16);
    word("diart");
    step({ kind: "back", count: 1 }, 0.14);
    word("y");
    step({ kind: "key", char: ",", capital: false }, 0.35);
    step({ kind: "enter", column: 12 }, 0.6);
  },

  _soundClose(this: CursorSmithPlugin) {
    const s = this._sound;
    if (!s) return;
    if (s.idleTimer) window.clearTimeout(s.idleTimer);
    s.idleTimer = 0;
    if (s.ctx) void s.ctx.close().catch(() => { /* already closed */ });
    s.ctx = null;
    s.master = null;
    s.buffer = null;
    s.ready = false;
    s.voice = null;
  },
};

export type SoundMethods = typeof soundMethods;
