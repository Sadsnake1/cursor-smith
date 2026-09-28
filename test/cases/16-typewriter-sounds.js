// Typewriter's Sounds (1.7.2): real typewriters, recorded - the machines in
// samples.ts, what an edit is heard as (classifySoundEdit), how it is played
// (a fake AudioContext records every sound started: which slice of the
// machine's audio, when, how loud, where), when nothing plays, the settings.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, later, makeEngine, renderPanel } = require("../lib");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
section("Typewriter's Sounds: the machines");
{
  const M = T.SOUND_MACHINES;
  ok("fourteen real typewriters, the Hermes 3000 first and the default, the rest by name",
     M.map((m) => m.label).join() === "Hermes 3000,Erika 5 (1940),Hermes Baby,IBM Selectric II,L C Smith (1946),Mercedes (1934),Olivetti Lettera 22,Olivetti Lettera 35,Olympia (1956),Royal Portable (1936),Royal Quiet De Luxe,Sears Electric Twelve,Smith-Corona Corsair,Underwood" &&
     T.DEFAULT_SOUND_MACHINE === "hermes3000" && T.DEFAULT_SETTINGS.typewriterSoundVoice === "hermes3000" && new Set(M.map((m) => m.id)).size === M.length, M.map((m) => m.label));
  for (const m of M) {
    const takes = T.soundTakes(m);
    const all = T.ATOM_NAMES.every((n) => (takes[n] || []).length > 0);
    const counts = takes.strike.length === 5 && takes.capital.length === 2 && takes.space.length === 2 && takes.feed.length === 1 && takes.bell.length === 1;
    const inOrder = m.sounds.every(([, start, dur], i) => dur > 0 && (i === 0 || start >= m.sounds[i - 1][1] + m.sounds[i - 1][2]));
    const bytes = new Uint8Array(T.soundBytes(m.mp3));
    const mp3 = (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || String.fromCharCode(bytes[0], bytes[1], bytes[2]) === "ID3";
    ok(`${m.label}: every sound it needs - five keys, two capitals, two space bars, Backspace, its return, its bell - in order`, all && counts && inOrder, Object.fromEntries(Object.entries(takes).map(([k, v]) => [k, v.length])));
    ok(`...as one MP3 under 55 KB, its first sound (where the decoder is measured from) inside the first take`, mp3 && bytes.length < 55 * 1024 && m.onset > 0 && m.onset < m.sounds[0][1] + m.sounds[0][2], [bytes.length, m.onset]);
    ok(`...a key is a key (under 0.2 s), the return and the bell longer`, takes.strike.every((t) => t.dur < 0.2) && takes.feed[0].dur > 0.5 && takes.bell[0].dur > 0.8, [takes.feed[0].dur, takes.bell[0].dur]);
  }
  const total = M.reduce((n, m) => n + T.soundBytes(m.mp3).byteLength, 0);
  ok("all fourteen under 600 KB", total < 600 * 1024, Math.round(total / 1024) + " KB");
  const notice = fs.readFileSync(path.join(__dirname, "..", "..", "NOTICE"), "utf8");
  const ids = [...new Set(M.flatMap((m) => [...m.credit.matchAll(/freesound\.org\/s\/(\d+)/g)].map((x) => x[1])))];
  ok("every recording credited in NOTICE, its licence with it", ids.length >= 16 && ids.every((id) => notice.includes(`freesound.org/s/${id}/`)) && notice.includes("File:WWS_Typewriter.ogg") && /CC BY 3\.0/.test(notice) && /CC BY 4\.0/.test(notice), ids.filter((id) => !notice.includes(`freesound.org/s/${id}/`)));
  ok("...and on each machine", M.every((m) => /freesound\.org\/s\/\d+|commons\.wikimedia\.org/.test(m.credit) && /CC0|CC BY/.test(m.credit)));
  ok("an unknown machine (an older code's) is the default one", T.soundMachine("manual").id === "hermes3000" && T.soundMachine(undefined).id === "hermes3000" && T.soundMachine("olivetti22").label === "Olivetti Lettera 22");
  const bars = new Set("abcdefghijklmnopqrstuvwxyz".split("").map((c) => T.typebarOf(c, 5)));
  ok("every letter has its typebar: the same for a and A, spread over the keys", T.typebarOf("a", 5) === T.typebarOf("A", 5) && bars.size === 5);
  const pairs = "th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce".split(" ");
  const same = pairs.filter((p) => T.typebarOf(p[0], 5) === T.typebarOf(p[1], 5));
  ok("...the commonest letter pairs on different keys (all but a couple)", same.length <= 2, same);
  const x = new Float32Array(48000);
  x[1300] = 0.05; x[2000] = 0.9;
  ok("a first sound is found where it rises past a fifth of the loudest", Math.abs(T.soundOnset(x, 48000) - 2000 / 48000) < 1e-9);
}

// ---------------------------------------------------------------------------
section("Typewriter's Sounds: what an edit is heard as");
{
  // A transaction as CodeMirror hands it: one change, its user event.
  const tr = ({ ins = "", del = 0, from = 10, events = ["input.type"], lineFrom = 0, changed = true }) => ({
    docChanged: changed,
    isUserEvent: (e) => events.some((x) => x === e || x.startsWith(e + ".")),
    changes: { iterChanges: (f) => f(from, from + del, from, from + ins.length, { toString: () => ins }) },
    startState: { doc: { lineAt: () => ({ from: lineFrom }) } },
  });
  const now = 1000;
  const key = (k, ago = 5, repeat = false) => ({ key: k, t: now - ago, repeat });
  const C = (t, k = null) => T.classifySoundEdit(t, k, now);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok("a letter", same(C(tr({ ins: "e" })), { kind: "key", char: "e", capital: false }));
  ok("a capital", same(C(tr({ ins: "E" })), { kind: "key", char: "E", capital: true }));
  ok("a digit or a mark is a letter, not a capital", same(C(tr({ ins: "7" })), { kind: "key", char: "7", capital: false }) && C(tr({ ins: "," })).kind === "key");
  ok("a bracket closed for you is still one key", same(C(tr({ ins: "()" })), { kind: "key", char: "(", capital: false }));
  ok("Space", same(C(tr({ ins: " " })), { kind: "space" }));
  ok("Enter, with how far along its line it was typed", same(C(tr({ ins: "\n", from: 42, lineFrom: 10, events: ["input"] })), { kind: "enter", column: 32 }));
  ok("...Obsidian's list Enter too, unlabeled, by the key just pressed", same(C(tr({ ins: "\n- ", from: 20, lineFrom: 0, events: [] }), key("Enter")), { kind: "enter", column: 20 }));
  ok("...but not an unlabeled newline without it (a Vim o, a plugin)", C(tr({ ins: "\n", events: [] }), key("o")) === null && C(tr({ ins: "\n", events: [] })) === null);
  ok("...nor a key pressed too long ago", C(tr({ ins: "\n- ", events: [] }), key("Enter", 400)) === null);
  ok("...nor a paste of many lines", C(tr({ ins: "a\nb\nc\nd", events: ["input"] })) === null);
  ok("Backspace, with how much it took", same(C(tr({ del: 1, events: ["delete.backward"] })), { kind: "back", count: 1 }) && C(tr({ del: 6, events: ["delete.backward"] })).count === 6);
  ok("Delete", same(C(tr({ del: 1, events: ["delete.forward"] })), { kind: "del", count: 1 }));
  ok("...unlabeled, by the key", C(tr({ del: 1, events: [] }), key("Delete")).kind === "del" && C(tr({ del: 1, events: [] }), key("Backspace")).kind === "back");
  ok("a selection deleted is Backspace", C(tr({ del: 12, events: ["delete.selection"] })).kind === "back");
  ok("Tab", C(tr({ ins: "\t", events: ["input.indent"] })).kind === "tab" && C(tr({ ins: "\t", events: [] }), key("Tab")).kind === "tab");
  for (const quiet of ["undo", "redo", "input.paste", "input.drop", "delete.cut", "input.complete"]) {
    ok(`${quiet} is silent`, C(tr({ ins: "x", del: 1, events: [quiet] }), key("x")) === null);
  }
  ok("Vim's commands are silent: x, p, dd leave no labeled edit", C(tr({ del: 1, events: [] }), key("x")) === null && C(tr({ ins: "hello", events: [] }), key("p")) === null);
  ok("...but a letter typed unlabeled is heard (Vim's insert mode)", same(C(tr({ ins: "k", events: [] }), key("k")), { kind: "key", char: "k", capital: false }));
  ok("no change, no sound", C(tr({ ins: "a", changed: false })) === null);
}

// ---------------------------------------------------------------------------
// A fake AudioContext: every source started, with its slice and what it was
// sent through. decodeAudioData gives a buffer whose first sound starts
// DELAY s later than the machine's `onset` (a decoder's delay).
const SR = 48000, DELAY = 0.027;
const param = (v) => ({ value: v, events: [], setValueAtTime(x, t) { this.events.push(["set", x, t]); }, linearRampToValueAtTime(x, t) { this.events.push(["ramp", x, t]); } });
function fakeAudio() {
  const started = [];
  let decodes = 0;
  class Ctx {
    constructor(opts) { this.opts = opts; this.currentTime = 10; this.sampleRate = SR; this.state = "running"; this.destination = { dest: true }; Ctx.made = (Ctx.made || 0) + 1; Ctx.last = this; }
    createGain() { return { gain: param(1), connect(n) { this.to = n; return n; }, disconnect() {} }; }
    createStereoPanner() { return { pan: param(0), connect(n) { this.to = n; return n; }, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0), connect(n) { this.to = n; return n; } }; }
    decodeAudioData(ab) {
      decodes++;
      const m = T.SOUND_MACHINES.find((mm) => T.soundBytes(mm.mp3).byteLength === ab.byteLength);
      const d = new Float32Array(SR);
      d[Math.round((m.onset + DELAY) * SR)] = 0.8;
      return Promise.resolve({ sampleRate: SR, length: d.length, getChannelData: () => d, machine: m.id });
    }
    createBufferSource() {
      return { buffer: null, playbackRate: param(1), connect(n) { this.to = n; return n; }, disconnect() {}, start(when, offset, duration) { started.push({ src: this, when, offset, duration }); } };
    }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  return { Ctx, started, decodes: () => decodes };
}

// An engine with sounds on and its machine decoded.
async function soundEngine(look = {}, voice = "hermes3000") {
  const e = makeEngine(Object.assign({ enabled: true, typewriter: true, typewriterSound: true, typewriterSoundVoice: voice, typewriterSoundVolume: 50, typewriterSoundBell: true, typewriterReturn: false }, look));
  e._deviceEnabled = true;
  e.registerEditorExtension = (x) => { e._ext = x; };
  e.registerDomEvent = (w, type, fn) => { (e._dom = e._dom || []).push({ type, fn }); };
  e.registerEvent = () => {};
  e.register = (fn) => { e._cleanup = fn; };
  e.app = { workspace: { on: () => ({}), onLayoutReady: () => {} } };
  e.lastActive = { x: 700, rowLeft: 300 };
  e._soundSetup();
  if (e._soundOn()) await e._soundPrepare();
  return e;
}
// Each started source as { name, take, when, offset, dur, gain, pan, rate }.
const heard = (e, started) => started.map(({ src, when, offset, duration }) => {
  const takes = e._sound.takes;
  let name = null, take = -1, from = 0;
  for (const [n, list] of Object.entries(takes)) list.forEach((t, i) => {
    const o = t.start + e._sound.delay;
    if (offset >= o - 1e-9 && offset <= o + t.dur + 1e-9 && name === null) { name = n; take = i; from = offset - o; }
  });
  const g = src.to, p = g && g.to && g.to.pan ? g.to : null;
  return { name, take, from: +from.toFixed(4), when: +(when - 10).toFixed(4), dur: duration, gain: g.gain.value, pan: p ? p.pan.value : 0, rate: src.playbackRate.value, g, p };
});

section("Typewriter's Sounds: playing them");
later(async () => {
  const { Ctx, started, decodes } = fakeAudio();
  const realCtx = globalThis.AudioContext;
  globalThis.AudioContext = Ctx;
  try {
    const e = await soundEngine();
    const s = e._sound;
    ok("set up once: an update listener on every editor, the keys and clicks, a clean-up", !!e._ext && e._dom.some((d) => d.type === "keydown") && e._dom.some((d) => d.type === "pointerdown") && typeof e._cleanup === "function");
    ok("the machine decoded once, its takes laid out, the decoder's delay found", decodes() === 1 && s.ready && s.voice === "hermes3000" && Math.abs(s.delay - DELAY) < 1e-4 && s.takes.strike.length === 5, s.delay);
    const hermes = T.soundTakes(T.soundMachine("hermes3000"));
    const play = (ev) => { started.length = 0; s.lastT = -1e9; e._soundPlay(ev, 0, 700, 300); return heard(e, started); };

    let h = play({ kind: "key", char: "e", capital: false });
    ok("a letter: its key, now, from its place in the recording (the delay allowed for), whole", h.length === 1 && h[0].name === "strike" && h[0].when === 0 && h[0].take === T.typebarOf("e", 5) && h[0].from === 0 && Math.abs(h[0].dur - hermes.strike[h[0].take].dur) < 1e-9, h[0]);
    ok("...at about its level, a little different each time", h[0].gain > T.SOUND_GAIN.strike * 0.8 && h[0].gain < T.SOUND_GAIN.strike * 1.1, h[0].gain);
    ok("...placed with the cursor: right of middle, subtly", Math.abs(h[0].pan - T.soundPan(700, 1000)) < 1e-9 && h[0].pan > 0.1 && h[0].pan <= 0.3, h[0].pan);
    ok("...the same letter, the same key", play({ kind: "key", char: "e", capital: false })[0].take === h[0].take);
    ok("a capital: a heavier key", play({ kind: "key", char: "E", capital: true })[0].name === "capital");
    ok("Space: the space bar", play({ kind: "space" })[0].name === "space");
    h = play({ kind: "back", count: 1 });
    ok("Backspace: its own, alone for one letter", h.length === 1 && h[0].name === "back" && Math.abs(h[0].rate - 1) < 0.02);
    h = play({ kind: "del", count: 1 });
    ok("Delete: the same, a little higher", h.length === 1 && h[0].name === "back" && h[0].rate > 1.05, h[0].rate);
    h = play({ kind: "back", count: 7 });
    ok("...a word taken: two notches more after it, softer each", h.length === 3 && h.every((x) => x.name === "back") && Math.abs(h[1].when - 0.045) < 1e-9 && Math.abs(h[2].when - 0.09) < 1e-9 && h[2].gain < h[1].gain, h.map((x) => [x.when, x.gain]));

    h = play({ kind: "enter", column: 30 });
    const bell = h.find((x) => x.name === "bell"), feed = h.find((x) => x.name === "feed");
    ok("Enter: the margin bell, then the machine's own carriage return, whole", bell && bell.when === 0 && feed && Math.abs(feed.when - 0.03) < 1e-9 && feed.from === 0 && Math.abs(feed.dur - hermes.feed[0].dur) < 1e-9, h.map((x) => [x.name, x.when, x.dur]));
    ok("...the bell well under the keys", bell.gain < T.SOUND_GAIN.strike * 0.7, bell.gain);
    ok("...the carriage running back across, from the cursor to the line's start", feed.p.pan.events.some((ev) => ev[0] === "ramp" && Math.abs(ev[1] - T.soundPan(300, 1000)) < 1e-9 && Math.abs(ev[2] - (10.03 + hermes.feed[0].dur)) < 1e-6));
    e.settings.typewriterSoundBell = false;
    ok("Bell off: no bell", !play({ kind: "enter", column: 30 }).some((x) => x.name === "bell"));
    e.settings.typewriterSoundBell = true;
    ok("a short line rings no bell", !play({ kind: "enter", column: 3 }).some((x) => x.name === "bell"));
    h = play({ kind: "enter", column: 0 });
    ok("Enter on an empty line: only the lever and the line feed, faded", h.length === 1 && h[0].name === "feed" && h[0].from === 0 && Math.abs(h[0].dur - 0.24) < 1e-9 && h[0].g.gain.events.some((ev) => ev[0] === "ramp" && ev[1] === 0), h.map((x) => [x.name, x.dur]));
    h = play({ kind: "tab" });
    ok("Tab: the end of the carriage's run and its stop", h.length === 1 && h[0].name === "feed" && Math.abs(h[0].from - (hermes.feed[0].dur - 0.4)) < 1e-4 && Math.abs(h[0].dur - 0.4) < 1e-9, h.map((x) => [x.name, x.from, x.dur]));

    // Fast typing and a held key.
    started.length = 0;
    s.lastT = -1e9;
    e._soundPlay({ kind: "key", char: "a", capital: false }, 0, 700, 300);
    e._soundPlay({ kind: "key", char: "b", capital: false }, 0, 700, 300);
    ok("two sounds closer than a keystroke are one", started.length === 1);
    s.lastT = performance.now() - 20;
    e._soundPlay({ kind: "enter", column: 0 }, 0, 700, 300);
    ok("...Enter always plays", started.length === 2);
    const soft = () => { started.length = 0; s.lastT = -1e9; e._soundPlay({ kind: "space" }, 0, 700, 300); return heard(e, started)[0].gain; };
    const levels = Array.from({ length: 20 }, soft);
    s.lastKey = { key: " ", t: performance.now(), repeat: true };
    const held = Array.from({ length: 20 }, soft);
    s.lastKey = null;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    ok("a held key's repeats are softer", mean(held) < mean(levels) * 0.7, [mean(held), mean(levels)]);

    // Volume.
    ok("Volume: 0 is silence, 100 the most, 50 well under half (a curve)", T.soundVolumeGain(0) === 0 && Math.abs(T.soundVolumeGain(100) - 0.9) < 1e-9 && T.soundVolumeGain(50) < 0.35 && T.soundVolumeGain(50) > 0.25);
    ok("...the output's gain follows the slider", Math.abs(s.master.gain.value - T.soundVolumeGain(50)) < 1e-9);
    ok("...through a gentle limiter, so a burst never clips", s.master.to && s.master.to.threshold && s.master.to.to === s.ctx.destination);
    ok("one audio context, for low latency", Ctx.made === 1 && Ctx.last.opts && Ctx.last.opts.latencyHint === "interactive");

    // Another machine: decoded anew; its own sounds.
    e.settings.typewriterSoundVoice = "olivetti22";
    started.length = 0;
    s.lastT = -1e9;
    e._soundPlay({ kind: "space" }, 0, 700, 300);
    ok("another machine chosen: nothing until it is decoded", started.length === 0 && s.voice === "olivetti22" && !s.ready);
    await s.rendering;
    ok("...then its own sounds", s.ready && decodes() === 2 && play({ kind: "space" })[0].name === "space" && s.takes.feed[0].dur === T.soundTakes(T.soundMachine("olivetti22")).feed[0].dur);

    // When nothing plays.
    const upd = (over = {}) => ({ docChanged: true, view: { hasFocus: true }, transactions: [{
      docChanged: true, isUserEvent: (x) => x === "input" || x === "input.type",
      changes: { iterChanges: (f) => f(5, 5, 5, 6, { toString: () => "a" }) }, startState: { doc: { lineAt: () => ({ from: 0 }) } } }], ...over });
    const count = (eng, u) => { started.length = 0; eng._sound.lastT = -1e9; eng._soundOnUpdate(u); return started.length; };
    ok("an edit typed in the focused note is heard", count(e, upd()) === 1);
    ok("...not in a note without focus (the same file in another pane)", count(e, upd({ view: { hasFocus: false } })) === 0);
    ok("...not with no change", count(e, upd({ docChanged: false })) === 0);
    for (const [what, patch] of [["Sounds off", { typewriterSound: false }], ["Typewriter off", { typewriter: false }], ["the plugin off", { enabled: false }]]) {
      const q = await soundEngine(patch);
      ok(`...not with ${what}`, count(q, upd()) === 0);
    }
    const dev = await soundEngine();
    dev._deviceEnabled = false;
    ok("...not on a device it is switched off on", count(dev, upd()) === 0);

    // The play button.
    started.length = 0;
    await e.soundPreview();
    const pv = heard(e, started), whens = pv.map((x) => x.when);
    ok("the play button: a few words, a slip taken back, a comma, Enter", pv.some((x) => x.name === "capital") && pv.filter((x) => x.name === "strike").length >= 8 && pv.some((x) => x.name === "back") && pv.some((x) => x.name === "space") && pv.some((x) => x.name === "feed"), pv.map((x) => x.name).join(" "));
    ok("...in time, ahead, over a couple of seconds", whens.every((w) => w >= 0) && Math.max(...whens) > 1 && Math.max(...whens) < 4, [Math.min(...whens), Math.max(...whens)]);

    // Quiet for a while: the device is let go; unload closes it.
    ok("after a sound, the device is let go once it has been quiet a while", s.idleTimer !== 0);
    const itsCtx = s.ctx;
    e._soundClose();
    ok("unload closes the audio and clears the timer", itsCtx.state === "closed" && s.ctx === null && s.idleTimer === 0 && !s.ready);
  } finally {
    globalThis.AudioContext = realCtx;
  }
});

// ---------------------------------------------------------------------------
section("Typewriter's Sounds: the settings");
{
  ok("four look keys, appended, off by default: the Hermes 3000 at half volume, the bell on",
     T.LOOK_KEYS.slice(-4).join() === "typewriterSound,typewriterSoundVoice,typewriterSoundVolume,typewriterSoundBell" &&
     T.DEFAULT_SETTINGS.typewriterSound === false && T.DEFAULT_SETTINGS.typewriterSoundVolume === 50 && T.DEFAULT_SETTINGS.typewriterSoundBell === true);
  const row = (rows, name) => rows.find((r) => r.name === name);
  const on = renderPanel({ typewriter: true, typewriterSound: true });
  const idx = (n) => on.findIndex((r) => r.name === n);
  ok("Sounds is a part of Typewriter, after its others, with Machine, Volume and Bell under it",
     ["Sounds", "Machine", "Volume", "Bell"].every((n) => row(on, n) && row(on, n).def.visible()) &&
     idx("Typewriter") < idx("Carriage advance") && idx("Carriage advance") < idx("Sounds") && idx("Sounds") < idx("Machine") && idx("Machine") < idx("Volume") && idx("Volume") < idx("Bell"));
  ok("...and Effects owns their keys (its Reset puts them back)", ["typewriterSound", "typewriterSoundVoice", "typewriterSoundVolume", "typewriterSoundBell"].every((k) => on.cardKeys.Effects.includes(k)));
  const off = renderPanel({ typewriter: true, typewriterSound: false });
  ok("Sounds off: its rows hidden", row(off, "Sounds").def.visible() && !row(off, "Machine").def.visible() && !row(off, "Volume").def.visible() && !row(off, "Bell").def.visible());
}
