// Sounds (1.7.2, Typewriter's until 1.7.7): real typewriters, recorded, and
// since 1.7.7 mechanical keyboards and other sounds (issue #46) - the
// machines in samples.ts, what an edit is heard as (classifySoundEdit), how
// it is played (a fake AudioContext records every sound started: which slice
// of the machine's audio, when, how loud, where), when nothing plays, the
// settings, the upgrade.
// One of the files test/test.js runs in order; see test/lib.js.
const { T, ok, section, later, makeEngine, renderPanel } = require("../lib");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
section("Sounds: the machines");
{
  const M = T.SOUND_MACHINES;
  const TW = M.filter((m) => m.kind === "typewriter"), KB = M.filter((m) => m.kind === "keyboard"), OTHER = M.filter((m) => m.kind === "other");
  ok("ten real typewriters, the Hermes 3000 first and the default, the rest by name",
     TW.map((m) => m.label).join() === "Hermes 3000,Erika 5 (1940),IBM Selectric II,L. C. Smith (1946),Mercedes (1934),Olivetti Lettera 35,Olympia (1956),Royal Portable (1936),Sears Electric Twelve,Smith-Corona Corsair" &&
     M[0].id === "hermes3000" && T.DEFAULT_SOUND_MACHINE === "hermes3000" && T.DEFAULT_SETTINGS.typewriterSoundVoice === "hermes3000" && new Set(M.map((m) => m.id)).size === M.length, M.map((m) => m.label));
  ok("then eleven keyboards (the list pruned 2026-10-06, the Kalimba and the horse among them) and nothing else, the kinds in order",
     KB.map((m) => m.label).join() === "Purples,Creams,Reds,Browns,Blues,Greens,Blacks,Pinks,Springs,Kalimba,Actual Horse" &&
     OTHER.length === 0 && TW.length + KB.length + OTHER.length === M.length &&
     M.map((m) => m.kind).join() === [...TW, ...KB, ...OTHER].map((m) => m.kind).join(), M.map((m) => m.kind));
  ok("...the one that plays notes is never detuned: the Kalimba", M.filter((m) => m.tonal).map((m) => m.id).join() === "kalimba");
  const common = (m) => {
    const bytes = new Uint8Array(T.soundBytes(m.mp3));
    const mp3 = (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || String.fromCharCode(bytes[0], bytes[1], bytes[2]) === "ID3";
    const inOrder = m.sounds.every(([, start, dur], i) => dur > 0 && (i === 0 || start >= m.sounds[i - 1][1] + m.sounds[i - 1][2]));
    return { bytes, mp3, inOrder };
  };
  for (const m of TW) {
    const takes = T.soundTakes(m);
    const all = T.TYPEWRITER_ATOMS.every((n) => (takes[n] || []).length > 0) && !takes.enter;
    const counts = [5, 6, 8].includes(takes.strike.length) && takes.capital.length >= 2 && takes.space.length === 2 && takes.feed.length === 1 && takes.bell.length === 1;
    const { bytes, mp3, inOrder } = common(m);
    ok(`${m.label}: every sound it needs - 5 to 8 keys, capitals, two space bars, Backspace, its return, its bell - in order`, all && counts && inOrder, Object.fromEntries(Object.entries(takes).map(([k, v]) => [k, v.length])));
    ok(`...as one MP3 under 64 KB, its first sound (where the decoder is measured from) inside the first take`, mp3 && bytes.length < 64 * 1024 && m.onset > 0 && m.onset < m.sounds[0][1] + m.sounds[0][2], [bytes.length, m.onset]);
    ok(`...a key is a key (under 0.2 s), the return and the bell longer`, takes.strike.every((t) => t.dur < 0.2) && takes.feed[0].dur > 0.35 && takes.bell[0].dur > 0.8, [takes.feed[0].dur, takes.bell[0].dur]);
  }
  for (const m of [...KB, ...OTHER]) {
    const takes = T.soundTakes(m);
    const all = T.KEYBOARD_ATOMS.every((n) => (takes[n] || []).length > 0) && !takes.capital && !takes.feed && !takes.bell;
    const counts = takes.strike.length >= 5 && takes.strike.length <= 8 && takes.space.length === 1 && takes.back.length === 1 && takes.enter.length === 1;
    const { bytes, mp3, inOrder } = common(m);
    ok(`${m.label}: its keys (5 to 8), its space bar, Backspace and Enter - no capitals, no return, no bell - in order`, all && counts && inOrder, Object.fromEntries(Object.entries(takes).map(([k, v]) => [k, v.length])));
    // Notes ring longer, so the Kalimba is bigger.
    const kb = m.tonal ? 96 : 64;
    ok(`...as one MP3 under ${kb} KB, its first sound inside the first take`, mp3 && bytes.length < kb * 1024 && m.onset > 0 && m.onset < m.sounds[0][1] + m.sounds[0][2], [bytes.length, m.onset]);
    // The horse's clops are its own, cut as heard: a little longer.
    const longest = m.tonal ? 1.3 : m.id === "horse" ? 0.45 : 0.35;
    ok(`...every sound short: ${m.tonal ? "a note rings under 1.3 s" : m.id === "horse" ? "a clop under 0.45 s" : "a key under 0.35 s"}`, m.sounds.every(([, , dur]) => dur < longest), m.sounds.map((x) => x[2]));
  }
  const total = M.reduce((n, m) => n + T.soundBytes(m.mp3).byteLength, 0);
  ok("all twenty-one under 800 KB", total < 800 * 1024, Math.round(total / 1024) + " KB");
  ok("the big recordings give 8 keys: fast typing repeats less", TW.filter((m) => T.soundTakes(m).strike.length === 8).length >= 3 && KB.filter((m) => T.soundTakes(m).strike.length === 8).length >= 4, M.map((m) => T.soundTakes(m).strike.length));
  // Credits live with each machine (no NOTICE file): who recorded it, where,
  // under which licence - the CC BY recordings require it.
  // Credits are comments above each machine in samples.ts: in the source,
  // not in the built main.js.
  const samplesSrc = fs.readFileSync(path.join(__dirname, "..", "..", "src", "sound", "samples.ts"), "utf8");
  const credits = [...samplesSrc.matchAll(/^  \/\/ (.+)\n  \{\n    id: "([^"]+)"/gm)].map((x) => ({ id: x[2], text: x[1] }));
  ok("every machine but the Selectric credits its recording in the source: who, where, the licence",
     credits.length === M.length - 1 && !credits.some((c) => c.id === "selectric2") &&
     credits.filter((c) => T.soundMachine(c.id).kind === "typewriter").every((c) => /freesound\.org\/s\/\d+|commons\.wikimedia\.org/.test(c.text) && /CC0|CC BY/.test(c.text)), credits);
  ok("...the keyboards and the other sounds: OmaVibes, kbsim or Mechvibes, MIT; the Mechvibes packs Mechvibes too",
     credits.filter((c) => T.soundMachine(c.id).kind !== "typewriter").every((c) => /OmaVibes by Mohammed Shareef \(github\.com\/mshareef-git\/omavibes\), MIT|kbsim by Thomas Lai \(github\.com\/tplai\/kbsim\), MIT|Mechvibes' pack \(github\.com\/hainguyents13\/mechvibes, MIT\)/.test(c.text)) &&
     ["buckling", "inkblack", "alpaca"].every((id) => /kbsim/.test(credits.find((c) => c.id === id).text)) &&
     ["nkcream", "mxred", "mxbrown", "mxblue"].every((id) => /github\.com\/hainguyents13\/mechvibes, MIT/.test(credits.find((c) => c.id === id).text)));
  ok("...the CC BY ones by name", credits.filter((c) => /CC BY/.test(c.text)).every((c) => /recorded by \S+/.test(c.text)) && credits.filter((c) => /CC BY/.test(c.text)).length >= 4);
  // The README credits the CC BY recordings - author, link, licence.
  const readme = fs.readFileSync(path.join(__dirname, "..", "..", "README.md"), "utf8");
  ok("the README credits every CC BY recording: its author, its link, the licence",
     ["File:WWS_Typewriter.ogg", "freesound.org/s/193603/", "freesound.org/s/185522/", "freesound.org/s/99694/", "freesound.org/s/99695/"].every((u) => readme.includes(u)) &&
     ["Konrad Gutkowski", "doxent", "Leossom", "fastson", "CC BY 4.0", "CC BY 3.0"].every((w) => readme.includes(w)));
  ok("...and OmaVibes, Mechvibes and kbsim, with their MIT notices", ["github.com/mshareef-git/omavibes", "Copyright (c) 2026 Mohammed Shareef", "github.com/hainguyents13/mechvibes", "Copyright (c) 2021 Hai Nguyen", "github.com/tplai/kbsim", "Copyright (c) Thomas Lai"].every((w) => readme.includes(w)));
  const built = fs.readFileSync(path.join(__dirname, "..", "..", "main.js"), "utf8");
  ok("...and not in the built main.js", !/recorded by|freesound\.org|Work With Sounds|omavibes|mechvibes|kbsim/i.test(built) && M.every((m) => !("credit" in m)));
  ok("an unknown machine (an older code's) is the default one", T.soundMachine("manual").id === "hermes3000" && T.soundMachine(undefined).id === "hermes3000" && T.soundMachine("lettera35").label === "Olivetti Lettera 35" && T.soundMachine("olivetti22").id === "hermes3000");
  const pairs = "th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce".split(" ");
  ok("a keyboard's keys are heard where they sit: Q left, P right, Space in the middle, Enter right, Tab left",
     T.keyPan("q") < -0.1 && T.keyPan("p") > 0.05 && T.keyPan("Q") === T.keyPan("q") && T.keyPan(" ") === 0 && T.keyPan("Enter") === 0.2 && T.keyPan("Tab") === -0.2 && T.keyPan("\u00e9") === 0 &&
     ["1", "q", "a", "z", "0", "p", "l", "m"].every((k) => Math.abs(T.keyPan(k)) <= 0.2), ["q", "p", "a", "l", "z", "m"].map((k) => T.keyPan(k)));
  for (const n of [5, 6, 8]) {
    const bars = new Set("abcdefghijklmnopqrstuvwxyz".split("").map((c) => T.typebarOf(c, n)));
    ok(`${n} keys: every letter has its typebar, the same for a and A, every key used`, T.typebarOf("a", n) === T.typebarOf("A", n) && bars.size === n, [...bars]);
    const same = pairs.filter((p) => T.typebarOf(p[0], n) === T.typebarOf(p[1], n));
    ok(`...the commonest letter pairs on different keys (all but 3)`, same.length <= 3, same);
  }
  const x = new Float32Array(48000);
  x[1300] = 0.05; x[2000] = 0.9;
  ok("a first sound is found where it rises past a fifth of the loudest", Math.abs(T.soundOnset(x, 48000) - 2000 / 48000) < 1e-9);
}

// ---------------------------------------------------------------------------
section("Sounds: what an edit is heard as");
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
      const u = new Uint8Array(ab);
      const m = T.SOUND_MACHINES.find((mm) => { const b = new Uint8Array(T.soundBytes(mm.mp3)); return b.length === u.length && b.every((v, i) => v === u[i]); });
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

section("Sounds: playing them");
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
    ok("...and hands Carriage return's streak the return's length, its head at the line's start as the carriage stops", e._returnSweep && Math.abs(e._returnSweep.ms - ((hermes.feed[0].dur - 0.09) / 0.6) * 1000) < 1e-6, e._returnSweep);
    e._returnSweep = null;
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
    e.settings.typewriterSoundVoice = "lettera35";
    started.length = 0;
    s.lastT = -1e9;
    e._soundPlay({ kind: "space" }, 0, 700, 300);
    ok("another machine chosen: nothing until it is decoded", started.length === 0 && s.voice === "lettera35" && !s.ready);
    await s.rendering;
    ok("...then its own sounds", s.ready && decodes() === 2 && play({ kind: "space" })[0].name === "space" && s.takes.feed[0].dur === T.soundTakes(T.soundMachine("lettera35")).feed[0].dur);

    // When nothing plays.
    const upd = (over = {}) => ({ docChanged: true, view: { hasFocus: true }, transactions: [{
      docChanged: true, isUserEvent: (x) => x === "input" || x === "input.type",
      changes: { iterChanges: (f) => f(5, 5, 5, 6, { toString: () => "a" }) }, startState: { doc: { lineAt: () => ({ from: 0 }) } } }], ...over });
    const count = (eng, u) => { started.length = 0; eng._sound.lastT = -1e9; eng._soundOnUpdate(u); return started.length; };
    ok("an edit typed in the focused note is heard", count(e, upd()) === 1);
    ok("...not in a note without focus (the same file in another pane)", count(e, upd({ view: { hasFocus: false } })) === 0);
    ok("...not with no change", count(e, upd({ docChanged: false })) === 0);
    for (const [what, patch] of [["Sounds off", { typewriterSound: false }], ["the plugin off", { enabled: false }]]) {
      const q = await soundEngine(patch);
      ok(`...not with ${what}`, count(q, upd()) === 0);
    }
    ok("...but with Typewriter off: Sounds are their own (1.7.7)", count(await soundEngine({ typewriter: false }), upd()) === 1);
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

    // A keyboard: its keys where they sit, its own Enter, no bell, no
    // carriage, one Backspace for a word.
    const k = await soundEngine({ typewriter: false }, "mxbrown");
    const kt = T.soundTakes(T.soundMachine("mxbrown"));
    const kplay = (ev) => { started.length = 0; k._sound.lastT = -1e9; k._soundPlay(ev, 0, 700, 300); return heard(k, started); };
    ok("a keyboard decoded, its own takes", k._sound.ready && k._sound.voice === "mxbrown" && k._sound.takes.strike.length === kt.strike.length && !k._sound.takes.bell);
    h = kplay({ kind: "key", char: "q", capital: false });
    ok("a keyboard's letter: its key, placed where Q sits (left), not where the cursor is", h.length === 1 && h[0].name === "strike" && Math.abs(h[0].pan - T.keyPan("q")) < 1e-9 && h[0].pan < 0, h[0]);
    h = kplay({ kind: "key", char: "Q", capital: true });
    ok("...a capital is its letter's key (no heavier take)", h.length === 1 && h[0].name === "strike" && h[0].take === T.typebarOf("q", kt.strike.length));
    h = kplay({ kind: "enter", column: 30 });
    ok("...Enter: its Enter key, whole - no bell, no carriage return, no streak", h.length === 1 && h[0].name === "enter" && h[0].from === 0 && Math.abs(h[0].dur - kt.enter[0].dur) < 1e-9 && !k._returnSweep, h.map((x) => x.name));
    k.settings.typewriterSoundBell = true;
    ok("...even with Bell on", !kplay({ kind: "enter", column: 30 }).some((x) => x.name === "bell"));
    h = kplay({ kind: "back", count: 7 });
    ok("...a word taken: one Backspace", h.length === 1 && h[0].name === "back", h.length);
    h = kplay({ kind: "tab" });
    ok("...Tab: a wide key, the space bar's sound, from the left", h.length === 1 && h[0].name === "space" && h[0].pan < 0, h[0]);
    k._soundClose();
    // The Kalimba: notes, never detuned - Delete too.
    const kal = await soundEngine({}, "kalimba");
    const rates = [];
    for (let i = 0; i < 12; i++) {
      started.length = 0; kal._sound.lastT = -1e9;
      kal._soundPlay({ kind: i % 3 ? "key" : "del", char: "abcdef"[i % 6], capital: false, count: 1 }, 0, 700, 300);
      rates.push(...heard(kal, started).map((x) => x.rate));
    }
    ok("the Kalimba plays its notes in tune: no pitch jitter, Delete no higher", rates.length === 12 && rates.every((r) => r === 1), rates);
    h = (() => { started.length = 0; kal._sound.lastT = -1e9; kal._soundPlay({ kind: "enter", column: 20 }, 0, 700, 300); return heard(kal, started); })();
    ok("...Enter: its chord", h.length === 1 && h[0].name === "enter" && h[0].dur > 1, h);
    kal._soundClose();
  } finally {
    globalThis.AudioContext = realCtx;
  }
});

// ---------------------------------------------------------------------------
section("Sounds: the settings");
{
  ok("four look keys, appended, off by default: the Hermes 3000 at half volume, the bell on",
     T.LOOK_KEYS.slice(T.LOOK_KEYS.indexOf("typewriterSound"), T.LOOK_KEYS.indexOf("typewriterSound") + 5).join() === "typewriterSound,typewriterSoundVoice,typewriterSoundVolume,typewriterSoundBell,typewriterTape" &&
     T.DEFAULT_SETTINGS.typewriterSound === false && T.DEFAULT_SETTINGS.typewriterSoundVolume === 50 && T.DEFAULT_SETTINGS.typewriterSoundBell === true);
  const row = (rows, name) => rows.find((r) => r.name === name);
  const { sectionOf } = require("../panel_harness");
  const visible = (r) => !!r && (typeof r.def.visible !== "function" || r.def.visible());
  const panel = (look) => renderPanel(look);
  const on = panel({ typewriter: false, typewriterSound: true });
  const idx = (n) => on.findIndex((r) => r.name === n);
  ok("Sounds is a page of its own after Effects, with Category, Sound, Volume and Bell - Typewriter off",
     ["Sounds", "Category", "Sound", "Volume", "Bell"].every((n) => visible(row(on, n)) && sectionOf(row(on, n)) === "Sounds") &&
     idx("Sounds") < idx("Category") && idx("Category") < idx("Sound") && idx("Sound") < idx("Volume") && idx("Volume") < idx("Bell") &&
     !visible(row(on, "Carriage advance")) && !row(on, "Machine"), on.map((r) => r.name));
  ok("...and owns their keys (its Reset puts them back)", ["typewriterSound", "typewriterSoundVoice", "typewriterSoundVolume", "typewriterSoundBell"].every((k) => on.cardKeys.Sounds.includes(k) && !on.cardKeys.Effects.includes(k)));
  const off = panel({ typewriterSound: false });
  ok("Sounds off: its rows hidden", visible(row(off, "Sounds")) && !visible(row(off, "Category")) && !visible(row(off, "Sound")) && !visible(row(off, "Volume")) && !visible(row(off, "Bell")));
  const kb = panel({ typewriterSound: true, typewriterSoundVoice: "nkcream" });
  ok("...a keyboard chosen: no Bell (a typewriter's)", visible(row(kb, "Sound")) && visible(row(kb, "Volume")) && !visible(row(kb, "Bell")));
  // The Category: the kind of the sound chosen; the Sound list that kind's.
  const cat = row(kb, "Category").dropdowns[0], snd = row(kb, "Sound").dropdowns[0];
  ok("Category: the chosen sound's kind, of the two there are sounds of", cat._value === "keyboard" && Object.keys(cat._options).join() === "typewriter,keyboard");
  ok("...and Sound lists that kind's only (no scrolling through 28)", Object.keys(snd._options).join() === T.SOUND_MACHINES.filter((m) => m.kind === "keyboard").map((m) => m.id).join() && snd._value === "nkcream", Object.keys(snd._options));
  const updates = kb.tab.updates;
  cat._change("typewriter");
  ok("...a kind picked: its first sound, and the rows rebuilt with its list", kb.settings.typewriterSoundVoice === "hermes3000" && kb.tab.updates === updates + 1);
  const tw = panel({ typewriter: true, typewriterSound: false });
  ok("Typewriter on, Sounds off: no sound rows under Typewriter", row(tw, "Carriage advance").def.visible() && !row(tw, "Sound").def.visible() && !row(tw, "Volume").def.visible() && !row(tw, "Bell").def.visible());
}

section("Sounds: the upgrade to their own effect (1.7.7)");
{
  const preset = (o) => Object.assign({ cursorStyle: "Box" }, o);
  const st = {
    typewriter: false, typewriterSound: true,
    vimModes: { normal: preset({ typewriter: false, typewriterSound: true }), insert: preset({ typewriter: true, typewriterSound: true }) },
    userPresets: { Quiet: preset({ typewriter: false, typewriterSound: true }), Typer: preset({ typewriter: true, typewriterSound: true }), Plain: preset({}) },
    vimPresets: { Mine: { normal: preset({ typewriterSound: true }), insert: preset({ typewriter: true, typewriterSound: true }) } },
  };
  const n = T.soundsApart(st);
  ok("a look that was silent (Sounds on, Typewriter off) stays silent: Sounds off, everywhere - settings, Vim modes, presets",
     n === 4 && st.typewriterSound === false && st.vimModes.normal.typewriterSound === false && st.userPresets.Quiet.typewriterSound === false && st.vimPresets.Mine.normal.typewriterSound === false, n);
  ok("...one that was heard keeps them; a look without them is untouched",
     st.vimModes.insert.typewriterSound === true && st.userPresets.Typer.typewriterSound === true && st.vimPresets.Mine.insert.typewriterSound === true && !("typewriterSound" in st.userPresets.Plain));
  ok("...settings without presets or modes are fine", T.soundsApart({ typewriterSound: true }) === 1 && T.soundsApart({}) === 0);
}
