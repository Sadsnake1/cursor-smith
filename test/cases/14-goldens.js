// visual regression against the goldens.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("visual regression: what a frame paints, against the goldens");

// test/goldens.js: an engine with no DOM draws a scripted dozen frames per
// shipped preset into a context that records every 2D call; the recording
// is compared to test/goldens/<scenario>.json. Time and randomness are
// pinned, so a difference is a paint change. UPDATE_GOLDENS=1 rewrites.
{
  const { checkGoldens, runScenario } = require("../goldens");
  const results = checkGoldens(T, Plugin);
  const { EXTRA } = require("../goldens");
  ok("every shipped preset, the defaults, the effects no preset carries, and the torch have a scenario", results.length === Object.keys(T.DEFAULT_PRESETS).length + 1 + Object.keys(EXTRA).length + 1, results.length);
  ok("...Hot-head's scenario paints fire (the heaviest painter, unpinned until now)", (results.find((r) => r.name === "hot-head") || {}).ops > 1000 || !!(results.find((r) => r.name === "hot-head") || {}).wrote, results.find((r) => r.name === "hot-head"));
  for (const r of results) {
    if (r.wrote) { ok(`golden written: ${r.name}${r.changed ? " (changed)" : " (same)"}`, true); continue; }
    ok(`${r.name} paints as its golden says (${r.frames} frames, ${r.ops} ops)`, r.error === null, r.error);
  }
  // The recording is a pure function of the paint code: two runs agree.
  const a = JSON.stringify(runScenario(T, Plugin, T.DEFAULT_PRESETS["Jell-O"]));
  const b = JSON.stringify(runScenario(T, Plugin, T.DEFAULT_PRESETS["Jell-O"]));
  ok("a scenario is deterministic: two runs record the same ops", a === b);
  // And it sees a paint change: a different color paints differently.
  const c = JSON.stringify(runScenario(T, Plugin, Object.assign({}, T.DEFAULT_PRESETS["Jell-O"], { colorDark: "#ff0000" })));
  ok("...and a changed look records different ops", c !== a);
}
