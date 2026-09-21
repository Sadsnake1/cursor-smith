// Two builds. `node esbuild.config.mjs` bundles src/main.ts into main.js,
// the file Obsidian loads. `node esbuild.config.mjs test` bundles
// src/test-entry.ts into build/test-bundle.js with obsidian replaced by the
// stub, for the test suite.
import esbuild from "esbuild";

const test = process.argv.includes("test");

await esbuild.build({
  entryPoints: [test ? "src/test-entry.ts" : "src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: test ? "node" : "browser",
  target: "es2020",
  outfile: test ? "build/test-bundle.js" : "main.js",
  external: test ? [] : ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  alias: test ? { obsidian: "./test/obsidian-stub.ts" } : {},
  logLevel: "info",
  legalComments: "none",
  sourcemap: false,
});
