#!/usr/bin/env node
/**
 * Convert each /app/frontend/src/i18n/locales/*.ts file to a JSON file
 * suitable for `next-intl` (or any framework that reads JSON messages).
 *
 * Output:   /app/i18n_export/<lang>.json
 * Index:    /app/i18n_export/_INDEX.json   (list of locales + display names)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = "/app/frontend/src/i18n/locales";
const OUT = "/app/i18n_export";
fs.mkdirSync(OUT, { recursive: true });

const LANG_NAMES = {
  en: "English",
  hi: "हिन्दी (Hindi)",
  bn: "বাংলা (Bengali)",
  te: "తెలుగు (Telugu)",
  mr: "मराठी (Marathi)",
  ta: "தமிழ் (Tamil)",
  ur: "اردو (Urdu)",
  gu: "ગુજરાતી (Gujarati)",
  kn: "ಕನ್ನಡ (Kannada)",
  ml: "മലയാളം (Malayalam)",
  pa: "ਪੰਜਾਬੀ (Punjabi)",
  or: "ଓଡ଼ିଆ (Odia)",
  as: "অসমীয়া (Assamese)",
  ar: "العربية (Arabic)",
  de: "Deutsch (German)",
  es: "Español (Spanish)",
  fr: "Français (French)",
  pt: "Português (Portuguese)",
  ru: "Русский (Russian)",
  ja: "日本語 (Japanese)",
  ko: "한국어 (Korean)",
  zh: "简体中文 (Chinese Simplified)",
  "zh-TW": "繁體中文 (Chinese Traditional)",
  id: "Bahasa Indonesia",
  mi: "Te Reo Māori",
  fj: "Vosa Vakaviti (Fijian)",
  sm: "Gagana Samoa",
  to: "Lea Faka-Tonga (Tongan)",
};

const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const index = [];

for (const f of files) {
  const code = fs.readFileSync(path.join(SRC, f), "utf8");
  // Strip TypeScript "export default" — we want the object literal that follows.
  const stripped = code
    .replace(/^\s*\/\*[\s\S]*?\*\//g, "") // top comments
    .replace(/^\s*\/\/.*$/gm, "") // single-line comments
    .replace(/export\s+default\s+/, "module.exports = ")
    .replace(/^\s*export\s+const\s+/m, "exports.");

  // Run in a sandbox to get the resolved object.
  const sandbox = { module: { exports: {} }, exports: {} };
  try {
    vm.runInNewContext(stripped, sandbox, { timeout: 1000 });
  } catch (err) {
    console.error(`Skipped ${f} — TS eval error:`, err.message);
    continue;
  }
  const payload = sandbox.module.exports;
  if (!payload || typeof payload !== "object") {
    console.error(`Skipped ${f} — no default object export`);
    continue;
  }

  const lang = f.replace(/\.ts$/, "");
  const outPath = path.join(OUT, `${lang}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  index.push({
    code: lang,
    name: LANG_NAMES[lang] || lang,
    file: `${lang}.json`,
    keys: Object.keys(payload).length,
  });
  console.log(`✓ ${lang}.json (${Object.keys(payload).length} keys)`);
}

fs.writeFileSync(
  path.join(OUT, "_INDEX.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source_app: "allsale-shop (Expo mobile)",
      target_app: "allsale-web (Next.js)",
      locale_count: index.length,
      locales: index,
      usage:
        "Copy all *.json files to /app/frontend/messages/<lang>.json in the new allsale-web project. Each JSON is a flat key/value map of i18n strings. Use next-intl's getRequestConfig() to load them per locale.",
    },
    null,
    2,
  ),
);

console.log(`\nDone. ${index.length} files → ${OUT}/`);
console.log(`Index: ${OUT}/_INDEX.json`);
