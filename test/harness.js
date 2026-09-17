// Loads the plugin outside Obsidian for the tests: the test bundle is built
// from src/test-entry.ts with `obsidian` replaced by test/obsidian-stub.ts
// (node esbuild.config.mjs test). Same shape the working bundle's harness
// has - the plugin class with the test surface hung on it as __test.
// The plugin calls window.setTimeout / window.requestAnimationFrame and
// Obsidian's global createEl; Node has neither.
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
if (typeof globalThis.createEl === "undefined") {
  globalThis.createEl = (tag) => ({ tag, getContext: () => null });
}
const bundle = require("../build/test-bundle.js");
const Plugin = bundle.default;
Plugin.__test = bundle.__test;
module.exports = Plugin;
