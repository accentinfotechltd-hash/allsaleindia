// Validate a list of TS locale files by attempting to require/import them.
// Uses esbuild's transformSync to transpile TS to JS, then evals.
const fs = require("fs");
const path = require("path");
const esbuild = require("/usr/lib/node_modules/esbuild");

const ROOT = "/app/frontend/src/i18n/locales";
const args = process.argv.slice(2);
const files = (args.length ? args.map((a) => (a.endsWith(".ts") ? a : a + ".ts")) : fs.readdirSync(ROOT).filter((f) => f.endsWith(".ts")));

let pass = 0;
let fail = 0;
for (const fname of files) {
  const p = path.join(ROOT, fname);
  const src = fs.readFileSync(p, "utf8");
  try {
    const out = esbuild.transformSync(src, { loader: "ts", format: "cjs" });
    // Eval to make sure object is well-formed
    const m = { exports: {} };
    const fn = new Function("module", "exports", out.code);
    fn(m, m.exports);
    const obj = m.exports.default || m.exports;
    if (!obj || typeof obj !== "object") throw new Error("no default export object");
    const keys = Object.keys(obj).length;
    console.log(`PASS  ${fname.padEnd(12)}  keys=${keys}`);
    pass++;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    const loc = (e && e.errors && e.errors[0] && e.errors[0].location) || null;
    const where = loc ? `line ${loc.line}:${loc.column}` : "";
    console.log(`FAIL  ${fname.padEnd(12)}  ${where}  ${msg.split("\n").slice(0,4).join(" | ").slice(0, 300)}`);
    fail++;
  }
}
console.log(`\nSummary: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
