# Building Cursor-Smith from source

The plugin's source, as a TypeScript project.

```
src/
  main.ts             entry: exports the plugin class
  plugin.ts           the plugin class: fields, lifecycle, settings, presets, the tick
  types.ts            the settings type; Obsidian typing gaps
  constants.ts        tuning constants for the engine and its effects
  test-entry.ts       what the test suite reaches into
  engine/             the loop and the caret (part of the class, see plugin.ts)
    engine.ts           the canvas, its home and region, the frame governor
    carets.ts           the caret's moves, the smooth glide, the held letter
    measure.ts          where the caret is
    vim.ts              Vim modes: detection, the look per mode, the status bar
  effects/            the particle effects (part of the class)
    effects.ts          gathered from the six below
    effects-pops.ts     letters, Typewriter's ink and carriage, lightning, fireworks
    effects-fire.ts     Hot-head
    effects-dust.ts     the pixel trail and stardust
    effects-trail.ts    the CRT trail and Speed demon's sparks
    effects-ink.ts      Fresh ink (a part of Typewriter)
    effects-evaporate.ts  Backspace evaporation (a part of Pop effects)
    fire.ts             tuning constants for Hot-head
  paint/              painting the cursor (part of the class)
    paint.ts            gathered from the eight below
    paint-frame.ts      the frame: draw() and the layer order
    paint-shape.ts      the caret's body
    paint-color.ts      the colour, gradients, heat
    paint-blink.ts      the blink
    paint-smear.ts      the motion smear
    paint-energy.ts     the energy beam and aurora
    paint-tether.ts     the bracket tether
    paint-secondaries.ts  the other carets
  torch/
    torch.ts            the torch spotlight's overlay and loop (part of the class)
    torch-paint.ts      the torch's darkness and glow painters
  settings/
    settings-tab.ts     the settings panel
    settings.ts         defaults, migrations, look/preset helpers
    presets.ts          the presets that ship
    library.ts          loading, saving and cycling presets (part of the class)
    share.ts            share codes
    demo.ts             the preset cards' live demos
  util/               plain functions, no plugin state
    color.ts            colour maths, contrast, ramps
    motion.ts           easing, flicker, blink, reduced motion
    text.ts             bracket and quote scanning
    geometry.ts         the caret-following canvas region, the status-bar clip
test/               the test suite (`npm test`): test.js the runner, cases/ the
                    fifteen files by area, lib.js what they share, and the Obsidian stub

`test/goldens/` holds the paint goldens: what a frame draws for each shipped
preset, recorded by `test/goldens.js` and compared on every run. A paint
change fails the suite with the first differing op; when the change is
intended, `UPDATE_GOLDENS=1 npm test` rewrites the files - read their diff.
```

```
npm install
npm run check     # tsc
npm run lint      # the plugin review's rules (eslint-plugin-obsidianmd)
npm run build     # main.js
npm test          # `build:test` then the assertions, against the built bundle
```

`src/` is the source, edited by hand (until 1.5.5 it was generated from a
single JavaScript file; that file is retired). `main.js` in this folder is
the build output, committed so the plugin can be installed from the tree,
and the release workflow rebuilds it from the tag rather than trusting it.

A release is built by GitHub: publishing a release runs
`.github/workflows/release.yml`, which builds main.js from the tag with the
committed lockfile, runs the suite on it, attests the assets and attaches
them to the release. Nothing is uploaded by hand.

The tree is fully typed - no `any`, no index signature, no non-null
assertion, `tsc` clean under `strict` - and `npm run lint` (the review's
rule set) reports nothing. The types are in types.ts: the settings object, the caret
record, the particles, the engine's declared state, the settings panel's
hooks, and the two Obsidian typing gaps (Editor.cm, the CM5 vim adapter).
