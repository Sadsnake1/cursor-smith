# Building Word-Smith from source

The plugin's source, as a TypeScript project.

```
src/
  main.ts                 entry: exports the plugin class
  plugin.ts               the plugin class: lifecycle, settings, the bar, the modes,
                          the menu, the Organizer's windows, export, history
  preamble.ts             helpers and constants: tokens, colors, the bar's grammar,
                          presets and share codes, the flags, the docx and zip writers
  settings.ts             the settings schema: the defaults are the type
  settings-tab.ts         the settings panel (Obsidian's declarative settings)
  editor-extensions.ts    the CodeMirror extensions: markers, paragraph numbers,
                          the letter box's masks, Hemingway
  org-index.ts            the Organizer's index of notes and folders
  obsidian-internals.ts   what the plugin reaches in Obsidian's private API,
                          checked at load
  organizer-*.ts          the Organizer's window, one file per concern
                          (cells, cols, drag, files, flags, journal, keys, lens,
                          mode, nav, props, readings, rename, rows, scope, sel,
                          shape, ticks, widths, writes, zoom, chips)
  global.d.ts             typing gaps the compiler cannot know
  obsidian-private.d.ts   the private API's shape, as used here
  test-entry.ts           what the development harness reaches into (not shipped)
test/smoke.js             the smoke test over the built file (`npm test`)
```

```
npm install
npm run check     # tsc
npm run lint      # the plugin review's rules (eslint-plugin-obsidianmd)
npm run build     # main.js
npm test          # the smoke test, against the built main.js
```

`src/` is the source, edited by hand. `main.js` is the build output:
`npm run build` writes it beside `manifest.json` and `styles.css`, and those
three files are the plugin. To install from the tree, copy the three into
`<vault>/.obsidian/plugins/word-smith/`.

A release is built by GitHub: publishing a release runs
`.github/workflows/release.yml`, which builds `main.js` from the tag with the
committed lockfile, runs the smoke test on it, attests the assets and
attaches `main.js`, `styles.css` and `manifest.json` to the release. Nothing
is uploaded by hand.

The development harness, the probes and the sabotage sweeps that hold the
plugin's behavior, live outside this tree and are not part of the upload.

`styles.css` and the bundle carry one version number
(`--ws-stylesheet-version` in the sheet, `WS_STYLESHEET_VERSION` in
`src/preamble.ts`); a stale copy of one beside a new copy of the other is the
first thing to suspect when something looks wrong after an update, and the
smoke test checks the pair.
