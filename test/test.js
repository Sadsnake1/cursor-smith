// The suite's runner: every file under test/cases in name order, each in its
// own try/catch (a throw is one failure and the next file still runs), then
// the deferred thunks in order, then the totals. The assertions themselves
// live in the files; what they share is test/lib.js. Until 1.5.8 this was
// one 6,700-line file in one module scope.
const fs = require("fs");
const path = require("path");
const { ok, state } = require("./lib");

const dir = path.join(__dirname, "cases");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
for (const f of files) {
  try {
    require(path.join(dir, f));
  } catch (e) {
    ok(`${f} ran to the end`, false, e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : String(e));
  }
}
(async () => {
  for (const fn of state.deferred) {
    try { await fn(); } catch (e) { ok("a deferred section ran to the end", false, e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : String(e)); }
  }
  console.log(`\n${state.passes + state.fails} assertions in ${files.length} files`);
  console.log(state.fails === 0 ? "ALL PASS" : state.fails + " FAILURE(S)");
  process.exit(state.fails === 0 ? 0 : 1);
})();
