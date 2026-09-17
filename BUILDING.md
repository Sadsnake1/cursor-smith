# Building Cursor-Smith from source

The plugin's source, as a TypeScript project.

```
src/
  main.ts           entry: exports the plugin class
  plugin.ts         the plugin - engine, effects, per-caret state
  settings-tab.ts   the settings panel
  settings.ts       defaults, migrations, look/preset helpers
  presets.ts        the presets that ship
  share.ts          share codes
  constants.ts      tuning constants for the engine and its effects
  fire.ts           tuning constants for Hot-head
  geometry.ts       the caret-following canvas region, the status-bar clip
  color.ts          colour maths, contrast, ramps
  motion.ts         easing, flicker, blink, reduced motion
  text.ts           bracket and quote scanning
  torch-paint.ts    the torch's darkness and glow painters
  types.ts          the settings type; Obsidian typing gaps
  test-entry.ts     what the test suite reaches into
test/               the test suite (`npm test`) and its Obsidian stub
```

```
npm install
npm run check     # tsc
npm run build     # main.js
npm test          # `build:test` then the assertions, against the built bundle
```

Types are being tightened incrementally: the settings object and the pure
helpers are typed, the engine's per-caret working state is not yet.
