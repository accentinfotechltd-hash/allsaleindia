"""Mass-translate /app/frontend/src/i18n/locales/en.ts into 26 fall-back locales
using Claude Sonnet 4.5 via the Emergent LLM key.

We send the entire en.ts in one shot per locale — Claude is told to ONLY
translate string values and preserve all keys, structure, punctuation, and
ICU placeholders like {{name}}.
"""
import asyncio
import os
import re
import sys
from pathlib import Path

from emergentintegrations.llm.chat import LlmChat, UserMessage

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-a9d96A438Fb133c367")

ROOT = Path("/app/frontend/src/i18n/locales")

LANG_MAP = {
    "es": "Spanish (Castilian)",
    "ar": "Arabic (Modern Standard)",
    "zh": "Simplified Chinese (zh-CN)",
    "zh-TW": "Traditional Chinese (zh-TW)",
    "pt": "Portuguese (Brazilian)",
    "fr": "French (France)",
    "de": "German",
    "ja": "Japanese",
    "ko": "Korean",
    "bn": "Bengali (Bangla)",
    "ta": "Tamil",
    "id": "Indonesian",
    "ru": "Russian",
    "mi": "Māori (te reo Māori, New Zealand)",
    "sm": "Samoan (Gagana Samoa)",
    "to": "Tongan (Lea faka-Tonga)",
    "fj": "Fijian (Vosa Vakaviti)",
    "te": "Telugu",
    "mr": "Marathi",
    "ur": "Urdu",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi (Gurmukhi)",
    "or": "Odia (Oriya)",
    "as": "Assamese",
}

PROMPT = """You are a professional UI translator for a mobile e-commerce app called "Allsale" — an Indian marketplace serving New Zealand, Australia, US, UK, Canada, and Pacific (Fiji/Samoa/Tonga/PNG).

You will receive a TypeScript file `en.ts` whose default export is a deeply-nested object of UI string keys. Translate ALL string values to **{LANGUAGE}**.

CRITICAL RULES:
1. PRESERVE every key name exactly (e.g. `placeholder_email`, `tab_sales`).
2. PRESERVE the file structure, imports, formatting, comments, trailing commas.
3. PRESERVE all ICU/i18n-js placeholders verbatim: `{{name}}`, `{{count}}`, `{{currency}}`, etc.
4. PRESERVE inline emoji (🇮🇳, ✓, →, etc.) and special markers (●, ★, %, ₹, $).
5. PRESERVE punctuation, line breaks (`\\n`), tab indentation (2 spaces).
6. PRESERVE brand names: Allsale, Stripe, Razorpay, India, NZ, MPI, Apple, Google.
7. PRESERVE code-like identifiers in strings (e.g. `ab.exposure`, `product_id`, `https://`, `support@allsale.co.nz`).
8. Use the language's native script (e.g. Tamil → Tamil script, not transliteration).
9. For RTL languages (Arabic, Urdu) just translate — the app handles RTL direction.
10. Keep the file's last line `export default en;` as `export default LOCALE_VAR;` where `LOCALE_VAR` is `{LOCALE_VAR}`.
11. Change the very first line `const en = {{` to `const {LOCALE_VAR} = {{`.

Return ONLY the fully translated `.ts` source code. No preamble, no markdown fence, no explanation. Start directly with `const ...`.
"""


async def translate_one(locale: str, language: str, source: str) -> str:
    # locale like "zh-TW" → var name needs to be valid JS: zhTW
    var_name = locale.replace("-", "")
    prompt = PROMPT.format(LANGUAGE=language, LOCALE_VAR=var_name)
    chat = (
        LlmChat(api_key=KEY, session_id=f"tx-{locale}", system_message=prompt)
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
        .with_params(max_tokens=64000)
    )
    out = await chat.send_message(UserMessage(text=source))
    text = out.strip()
    # Strip accidental markdown fence
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n", "", text)
        text = re.sub(r"\n```\s*$", "", text)
    return text


async def main():
    requested = sys.argv[1:] or list(LANG_MAP.keys())
    src = (ROOT / "en.ts").read_text()
    print(f"Source en.ts: {len(src)} chars, translating to {len(requested)} locales")
    # Throttle to 4 concurrent so we don't trip rate limits.
    sem = asyncio.Semaphore(4)

    async def worker(locale: str) -> None:
        async with sem:
            try:
                lang = LANG_MAP[locale]
                print(f"[{locale}] starting ({lang})…", flush=True)
                out = await translate_one(locale, lang, src)
                # Sanity: must contain `export default`
                if "export default" not in out:
                    raise RuntimeError("missing export default")
                # Bracket balance
                if out.count("{") != out.count("}"):
                    print(f"[{locale}] WARN: bracket imbalance ({out.count('{')} vs {out.count('}')})", flush=True)
                dst = ROOT / f"{locale}.ts"
                dst.write_text(out)
                print(f"[{locale}] wrote {len(out)} chars", flush=True)
            except Exception as e:
                print(f"[{locale}] FAILED: {e}", flush=True)

    await asyncio.gather(*(worker(loc) for loc in requested))
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
