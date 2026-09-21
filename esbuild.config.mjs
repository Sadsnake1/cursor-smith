// Two builds. `node esbuild.config.mjs` bundles src/main.ts into main.js, the
// file Obsidian loads. `node esbuild.config.mjs test` bundles src/test-entry.ts
// into ../ws-dev/main.js, the file the probes require (the class with the
// harness's helpers as statics). Both leave obsidian, electron and the
// CodeMirror packages external: Obsidian resolves them at run time.
//
// `options(test)` is exported so the harness (ws-dev/bundle_probe.js) builds
// with exactly these and not a second copy of them. Paths are relative to
// this file, whatever the working directory.
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const options = (test) => ({
	absWorkingDir: HERE,
	entryPoints: [test ? 'src/test-entry.ts' : 'src/main.ts'],
	bundle: true,
	format: 'cjs',
	platform: 'browser',
	target: 'es2020',
	outfile: test ? '../ws-dev/main.js' : 'main.js',
	external: ['obsidian', 'electron', '@electron/remote', '@codemirror/*', '@lezer/*', '@replit/codemirror-vim'],
	logLevel: 'info',
	legalComments: 'none',
	sourcemap: false,
	// The probes `require('./main.js')` and expect the class itself, with the
	// helpers as statics — not `{ default: … }`. The shipped file keeps the
	// `default` export: Obsidian's loader reads it.
	footer: test ? { js: 'module.exports = module.exports.default;' } : undefined,
});

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await esbuild.build(options(process.argv.includes('test')));
}
