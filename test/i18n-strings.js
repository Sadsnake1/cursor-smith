// Every English string the plugin shows, for the translation tables
// (src/i18n): what the settings panel asks t() for when it is rendered
// whole - the CUA panel with every look switched on and with everything
// off, the Vim panel in every mode, with presets on the strip - and every
// literal written into a t() or tOpts() call in src/ (the notices, the
// commands, the prompts, the hotkey card: what the panel harness does not
// open). Test 23 checks every table against it.
//
//   node test/i18n-strings.js        prints them as a JSON array (after npm run build:test)
const fs = require("fs");
const path = require("path");
const Plugin = require("./harness");
const { renderWholePanel } = require("./panel_harness");

const T = Plugin.__test;
const SRC = path.join(__dirname, "..", "src");

// The literals inside a call's first argument (t) or after a colon in it
// (tOpts: an options object's labels), read off the source text.
function staticStrings() {
  const out = new Set();
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts") && !p.includes(path.sep + "i18n" + path.sep)) files.push(p); } };
  walk(SRC);
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/(?<![\w.$])(t|tOpts)\(/g)) {
      // The first argument: up to a comma or the close at depth 0.
      let i = m.index + m[0].length, depth = 0, inStr = null;
      const start = i;
      for (; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
        if (c === "\"" || c === "'" || c === "`") { inStr = c; continue; }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
        else if (c === "," && depth === 0) break;
      }
      const arg = s.slice(start, i);
      for (const lit of arg.matchAll(/(:\s*)?"((?:[^"\\\n]|\\.)*)"/g)) {
        if (m[1] === "tOpts" && !lit[1]) continue;
        const text = JSON.parse("\"" + lit[2] + "\"");
        if (text) out.add(text);
      }
    }
  }
  return out;
}

function collect() {
  const seen = new Set();
  T.collectStrings(seen);
  try {
    const presets = { userPresets: { Mine: T.pickLook(Object.assign({}, T.DEFAULT_SETTINGS)) } };
    const allOn = { cursorStyle: "Box", gradientEnabled: true, cursorTranslucent: true, showChar: true, cursorRounded: true, blinkingEnabled: true, blinkBreathing: true,
      smoothEnabled: true, popEffects: true, typewriter: true, flameTrail: true, stardustEnabled: true, bracketTether: true, smear: true, energyEffect: true,
      crtEffect: true, speedDemon: true, hotHead: true, torchEffect: true, typewriterSound: true };
    const allOff = { gradientEnabled: false, blinkingEnabled: false, smoothEnabled: false, popEffects: false, typewriter: false, flameTrail: false, stardustEnabled: false,
      bracketTether: false, smear: false, energyEffect: false, crtEffect: false, speedDemon: false, hotHead: false, torchEffect: false, typewriterSound: false };
    renderWholePanel(Object.assign({}, allOn, presets));
    renderWholePanel(Object.assign({}, allOff, presets));
    // The Vim panel, every mode's page (Command has a note of its own).
    const proto = Plugin.prototype;
    const was = proto._vimEditMode;
    try {
      for (const mode of ["normal", "insert", "visual", "replace", "command"]) {
        proto._vimEditMode = mode;
        renderWholePanel({ uiMode: "vim", vimModeEnabled: true, vimStatusBar: true, vimPresets: { Setup: T.DEFAULT_SETTINGS.vimModes } });
      }
    } finally { proto._vimEditMode = was; }
  } finally {
    T.collectStrings(null);
  }
  for (const s of staticStrings()) seen.add(s);
  // Not strings to translate: a template already filled in ("8 effects",
  // read back through a summary), the version footer, the names of the
  // sounds and of the presets on the strip, the version on About's entry
  // ("0.0.0-test" here).
  // A slot filled in is a number here ("8 effects", "Chaos 1"); matching
  // any word dropped "Pop effects" and "Gradient colors" as filled-in
  // "{n} effects" and "{n} colors".
  const templates = [...seen].filter((s) => /\{\w+\}/.test(s)).map((s) => new RegExp("^" + s.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{\w+\\?\}/g, "[\\d.,]+") + "$"));
  const names = new Set([...T.SOUND_MACHINES.map((m) => m.label), "Mine", "Setup"]);
  return [...seen].filter((s) => (/[A-Za-z]/.test(s) || s === ", ")
    && !(/\{\w+\}/.test(s) === false && templates.some((re) => re.test(s)))
    && !/^Cursor-Smith \d/.test(s) && !/^\d+\.\d+\.\d+/.test(s) && !names.has(s)).sort();
}

module.exports = { collect, staticStrings };

if (require.main === module) process.stdout.write(JSON.stringify(collect(), null, 1) + "\n");
