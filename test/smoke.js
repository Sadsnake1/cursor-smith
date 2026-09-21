'use strict';
// The smoke test over the built plugin: what the release workflow runs after
// `npm run build`, and what a reviewer can run on the assets of a release.
//
//   npm test
//
// It asks nothing of a browser. main.js is loaded with a stand-in for the
// `obsidian` package, which is how the file behaves in the app: the packages
// are asked of Obsidian at run time, never bundled.
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

let pass = 0, fail = 0;
const is = (what, got, want) => {
	if (got === want) { pass++; return; }
	fail++;
	console.log('  FAIL ' + what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
};

// ── the three files, as bytes ──────────────────────────────────────────────
for (const name of ['main.js', 'styles.css', 'manifest.json', 'versions.json']) {
	const there = fs.existsSync(path.join(ROOT, name));
	is(name + ' is there' + (name === 'main.js' && !there ? ' (run npm run build first)' : ''), there, true);
}
if (fail) { console.log(pass + ' passed, ' + fail + ' failed'); process.exit(1); }

// A control byte in a stylesheet reads as U+FFFD, and a run of those outside
// a block joins the next rule's selector, which then never matches. The sheet
// shipped that way once, unnoticed, for nine days.
const control = (buf) => { for (let k = 0; k < buf.length; k++) { const c = buf[k]; if (c < 32 && c !== 9 && c !== 10 && c !== 13) return k; } return -1; };
for (const name of ['styles.css', 'manifest.json', 'versions.json']) {
	const at = control(fs.readFileSync(path.join(ROOT, name)));
	is(name + ' holds no control byte' + (at >= 0 ? ' (one at byte ' + at + ')' : ''), at, -1);
}

// ── the manifest, the versions, the package ───────────────────────────────
const manifest = JSON.parse(read('manifest.json'));
const versions = JSON.parse(read('versions.json'));
const pkg = JSON.parse(read('package.json'));
is('the manifest names the plugin', manifest.id, 'word-smith');
is('the manifest has a version', typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version), true);
is('the package carries the same version', pkg.version, manifest.version);
is('versions.json names this version and the app it needs', versions[manifest.version], manifest.minAppVersion);
is('the plugin runs on desktop and phone alike', manifest.isDesktopOnly, false);

// ── the bundle ─────────────────────────────────────────────────────────────
const js = read('main.js');
for (const name of ['obsidian', '@codemirror/view', '@codemirror/state', '@codemirror/commands']) {
	is('main.js asks Obsidian for ' + name + ' at run time', js.indexOf('require("' + name + '")') !== -1, true);
}
is('main.js bundles no copy of a package', /^\/\/ node_modules\//m.test(js), false);
// regex lookbehind is refused by iOS below 16.4, and a refused regex is a
// SyntaxError for the whole file: the plugin would not load at all
const behind = /\(\?<[=!]/.exec(js);
is('main.js carries no regex lookbehind' + (behind ? ' (at ' + behind.index + ')' : ''), !behind, true);
// the stylesheet and the bundle move together
const inSheet = (/--ws-stylesheet-version:\s*(\d+)/.exec(read('styles.css')) || [])[1];
const inBundle = (/WS_STYLESHEET_VERSION = (\d+);/.exec(js) || [])[1];
is('the bundle and the stylesheet carry one version (' + inSheet + ')', inBundle, inSheet);

// ── it loads ───────────────────────────────────────────────────────────────
const stub = {
	Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {}, Menu: class {},
	MarkdownView: class {}, TFile: class {}, TFolder: class {}, ItemView: class {}, FuzzySuggestModal: class {},
	Notice: class {}, Component: class {}, Events: class {},
	setIcon() {}, addIcon() {}, sanitizeHTMLToDom() {}, normalizePath: (p) => p, Platform: {},
};
const load = Module._load;
Module._load = function (request) {
	if (request === 'obsidian') return stub;
	if (/^@codemirror\//.test(request)) return {};
	return load.apply(this, arguments);
};
let plugin = null, error = '';
try { plugin = require(path.join(ROOT, 'main.js')); } catch (e) { error = String(e && e.message || e); }
is('main.js loads' + (error ? ' (' + error.slice(0, 80) + ')' : ''), error, '');
const cls = plugin && plugin.default;
is('it default-exports the plugin class, which is what Obsidian loads', typeof cls === 'function' && cls.name === 'WordSmith', true);
for (const m of ['onload', 'onunload', 'loadSettings', 'saveSettings']) {
	is('the class has ' + m, !!(cls && typeof cls.prototype[m] === 'function'), true);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
