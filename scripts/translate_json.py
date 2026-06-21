"""JSON-based mass translation of UI strings.

Reads /tmp/en_flat.json (flat dict produced by extract_en_to_json.js),
chunks into batches of ~100 keys, sends each batch as JSON to Claude Haiku 4.5,
and saves translated flat JSON to /tmp/locales_json/<locale>.json.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

from emergentintegrations.llm.chat import LlmChat, UserMessage

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-a9d96A438Fb133c367")
SRC = Path("/tmp/en_flat.json")
OUT_DIR = Path("/tmp/locales_json")
OUT_DIR.mkdir(exist_ok=True)

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

BATCH_SIZE = 80  # keys per LLM call

PROMPT = """You are a professional UI translator for "Allsale" — an Indian-marketplace mobile app shipping to NZ/AU/US/UK/CA + Pacific (Fiji/Samoa/Tonga/PNG).

You will receive a JSON object whose KEYS are dotted i18n paths (e.g., "common.save") and VALUES are English UI strings.

Translate ALL VALUES into **{LANGUAGE}**. Return ONLY a valid JSON object with the same keys and translated values.

CRITICAL RULES:
1. PRESERVE every JSON key exactly. Do not rename, drop, or add keys.
2. PRESERVE ICU placeholders verbatim: `{{name}}`, `{{count}}`, `%{{email}}`, `{{currency}}`, etc.
3. PRESERVE emoji and special characters: 🇮🇳, ✓, →, ●, ★, %, ₹, $.
4. PRESERVE brand names: Allsale, Stripe, Razorpay, India, NZ, MPI, Apple, Google, Shiprocket.
5. PRESERVE URLs, emails, code identifiers inside values (e.g., support@allsale.co.nz, ab.exposure).
6. Use the language's NATIVE SCRIPT (e.g., Tamil text in Tamil script, not transliteration).
7. JSON STRINGS: only `"` quote characters are allowed for string delimiters. Inside string values, use the language's native quote marks (「」 for Chinese, « » for French, „ " for German) or escape with backslash `\\"`. NEVER place an unescaped `"` inside a value.
8. Keep punctuation natural for the target language. RTL languages (Arabic, Urdu) just translate — the app handles direction.

Return ONLY the JSON object. No preamble, no markdown fence, no explanation.
Start with `{{` and end with `}}`.
"""


def chunk_dict(d: dict, size: int) -> list[dict]:
    items = list(d.items())
    return [dict(items[i : i + size]) for i in range(0, len(items), size)]


async def translate_batch(locale: str, language: str, batch: dict, idx: int, total: int, retries: int = 4) -> dict:
    prompt = PROMPT.format(LANGUAGE=language)
    payload = json.dumps(batch, ensure_ascii=False, indent=2)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            chat = (
                LlmChat(
                    api_key=KEY,
                    session_id=f"jtx-{locale}-{idx}-{int(time.time())}",
                    system_message=prompt,
                )
                .with_model("anthropic", "claude-haiku-4-5-20251001")
                .with_params(max_tokens=8000)
            )
            out = await chat.send_message(UserMessage(text=payload))
            text = out.strip()
            if text.startswith("```"):
                text = re.sub(r"^```[a-zA-Z]*\n", "", text)
                text = re.sub(r"\n```\s*$", "", text)
            # Locate JSON object
            start = text.find("{")
            end = text.rfind("}")
            if start < 0 or end < 0:
                raise RuntimeError(f"no JSON in response (len={len(text)})")
            text = text[start : end + 1]
            translated = json.loads(text)
            if not isinstance(translated, dict):
                raise RuntimeError("response is not a dict")
            # Verify keys: must match input keys (allow missing → fill with English)
            missing = [k for k in batch if k not in translated]
            extra = [k for k in translated if k not in batch]
            if missing:
                print(f"[{locale} batch {idx + 1}/{total}] {len(missing)} missing keys: filling with English", flush=True)
                for k in missing:
                    translated[k] = batch[k]
            for k in extra:
                del translated[k]
            return translated
        except json.JSONDecodeError as e:
            last_err = e
            wait = 2 ** attempt * 2
            print(f"[{locale} batch {idx + 1}/{total}] attempt {attempt + 1} JSON parse FAILED: {e} — retry in {wait}s", flush=True)
            await asyncio.sleep(wait)
        except Exception as e:
            last_err = e
            wait = 2 ** attempt * 3
            print(f"[{locale} batch {idx + 1}/{total}] attempt {attempt + 1} FAILED: {e} — retry in {wait}s", flush=True)
            await asyncio.sleep(wait)
    # Final fallback: return English so build doesn't break
    print(f"[{locale} batch {idx + 1}/{total}] all retries failed: {last_err} — falling back to English", flush=True)
    return dict(batch)


async def translate_one(locale: str, language: str, batches: list[dict]) -> dict:
    result: dict = {}
    # batches in this locale run sequentially; locale-level parallelism handled by caller
    for i, b in enumerate(batches):
        print(f"[{locale}] batch {i + 1}/{len(batches)} ({len(b)} keys)…", flush=True)
        t = await translate_batch(locale, language, b, i, len(batches))
        result.update(t)
    return result


async def main() -> None:
    requested = sys.argv[1:] or list(LANG_MAP.keys())
    flat = json.loads(SRC.read_text())
    batches = chunk_dict(flat, BATCH_SIZE)
    print(
        f"Source: {len(flat)} keys → {len(batches)} batches of {BATCH_SIZE}\n"
        f"Locales: {len(requested)} ({requested})\n",
        flush=True,
    )

    sem = asyncio.Semaphore(4)  # 4 locales in parallel

    async def worker(locale: str) -> None:
        async with sem:
            try:
                lang = LANG_MAP[locale]
                print(f"=== [{locale}] starting ({lang}) ===", flush=True)
                t0 = time.time()
                out = await translate_one(locale, lang, batches)
                # Validate same number of keys
                if len(out) != len(flat):
                    print(f"=== [{locale}] WARN: got {len(out)} keys, expected {len(flat)} ===", flush=True)
                dst = OUT_DIR / f"{locale}.json"
                dst.write_text(json.dumps(out, ensure_ascii=False, indent=2))
                dt = time.time() - t0
                print(f"=== [{locale}] DONE in {dt:.0f}s, {len(out)} keys → {dst.name} ===", flush=True)
            except Exception as e:
                print(f"=== [{locale}] LOCALE FAILED: {e} ===", flush=True)

    await asyncio.gather(*(worker(loc) for loc in requested))
    print("\nALL DONE.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
