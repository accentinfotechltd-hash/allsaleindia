// Extract /app/frontend/src/i18n/locales/en.ts as a flat JSON dict.
// Run: node extract_en_to_json.js > /tmp/en_flat.json
const fs = require("fs");
const path = require("path");
const esbuild = require("/usr/lib/node_modules/esbuild");

const SRC = "/app/frontend/src/i18n/locales/en.ts";

const ts = fs.readFileSync(SRC, "utf8");
const out = esbuild.transformSync(ts, { loader: "ts", format: "cjs" });
const m = { exports: {} };
new Function("module", "exports", out.code)(m, m.exports);
const obj = m.exports.default || m.exports;

// Flatten: nested object → { "a.b.c": "value" }
function flatten(o, prefix = "", acc = {}) {
  for (const [k, v] of Object.entries(o)) {
    const newKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, newKey, acc);
    } else {
      acc[newKey] = v;
    }
  }
  return acc;
}

const flat = flatten(obj);
process.stdout.write(JSON.stringify(flat, null, 2));
