"""Translate ONLY a small set of keys across all 26 locales.

Usage:
  python3 translate_specific_keys.py sell_banner.compact_prefix sell_banner.compact_link sell_banner.card_title sell_banner.card_subtitle

For each locale:
  1. Load /app/scripts/locales_json_snapshot/<locale>.json
  2. Send the requested keys (English values from en_flat) to Haiku
  3. Merge translations back into the snapshot
  4. Re-render the locale's .ts file
"""
from __future__ import annotations
import asyncio
import json
import os
import re
import sys
import time
import subprocess
from pathlib import Path

from emergentintegrations.llm.chat import LlmChat, UserMessage

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-a9d96A438Fb133c367")
SNAP_DIR = Path("/app/scripts/locales_json_snapshot")
ROOT = Path("/app/frontend/src/i18n/locales")
SCRIPTS = Path("/app/scripts")

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

PROMPT = """You are a professional UI translator for "Allsale" — an Indian-marketplace mobile app shipping to NZ/AU/US/UK/CA + Pacific.

You will receive a JSON object whose KEYS are dotted i18n paths and VALUES are English UI strings.

Translate ALL VALUES into **{LANGUAGE}**. Return ONLY a valid JSON object with the same keys.

RULES:
1. PRESERVE every JSON key exactly.
2. PRESERVE brand names: Allsale, India, NZ.
3. PRESERVE punctuation like trailing spaces and `?`.
4. Use the language's NATIVE SCRIPT.
5. JSON STRINGS: only `"` for delimiters; escape inner quotes with `\\"`.

Return ONLY the JSON object, nothing else.
"""


async def translate_keys(locale: str, language: str, payload: dict) -> dict:
    prompt = PROMPT.format(LANGUAGE=language)
    text_payload = json.dumps(payload, ensure_ascii=False, indent=2)
    for attempt in range(4):
        try:
            chat = (
                LlmChat(
                    api_key=KEY,
                    session_id=f"sk-{locale}-{int(time.time())}",
                    system_message=prompt,
                )
                .with_model("anthropic", "claude-haiku-4-5-20251001")
                .with_params(max_tokens=2000)
            )
            out = await chat.send_message(UserMessage(text=text_payload))
            text = out.strip()
            if text.startswith("```"):
                text = re.sub(r"^```[a-zA-Z]*\n", "", text)
                text = re.sub(r"\n```\s*$", "", text)
            start = text.find("{")
            end = text.rfind("}")
            translated = json.loads(text[start : end + 1])
            for k in payload:
                if k not in translated:
                    translated[k] = payload[k]
            return translated
        except Exception as e:
            wait = 2 ** attempt * 2
            print(f"[{locale}] attempt {attempt + 1} FAILED: {e} — retry in {wait}s", flush=True)
            await asyncio.sleep(wait)
    print(f"[{locale}] all retries failed, using English", flush=True)
    return dict(payload)


async def main() -> None:
    keys = sys.argv[1:]
    if not keys:
        print("usage: python3 translate_specific_keys.py <dotted.key.path> [...]")
        sys.exit(1)

    # Re-extract en_flat.json to pick up newly-added keys
    print("Extracting fresh en_flat.json…", flush=True)
    result = subprocess.run(
        ["node", str(SCRIPTS / "extract_en_to_json.js")],
        capture_output=True,
        text=True,
        check=True,
    )
    en_flat = json.loads(result.stdout)
    Path("/tmp/en_flat.json").write_text(json.dumps(en_flat, ensure_ascii=False, indent=2))

    # Build payload of requested keys (must exist in en_flat)
    payload = {}
    for k in keys:
        if k not in en_flat:
            print(f"WARN: key '{k}' not found in en.ts (after extraction)", flush=True)
            continue
        payload[k] = en_flat[k]
    if not payload:
        print("No valid keys to translate.")
        sys.exit(1)
    print(f"Will translate {len(payload)} keys × {len(LANG_MAP)} locales\n  {list(payload)}", flush=True)

    sem = asyncio.Semaphore(8)

    async def worker(locale: str, language: str) -> None:
        async with sem:
            t0 = time.time()
            translated = await translate_keys(locale, language, payload)
            # Merge into snapshot
            snap_path = SNAP_DIR / f"{locale}.json"
            snap = json.loads(snap_path.read_text()) if snap_path.exists() else {}
            snap.update(translated)
            # Ensure ALL en keys are present (fill missing with English)
            for k, v in en_flat.items():
                if k not in snap:
                    snap[k] = v
            snap_path.write_text(json.dumps(snap, ensure_ascii=False, indent=2))
            # Write to /tmp too for render_locale.py
            Path(f"/tmp/locales_json/{locale}.json").parent.mkdir(exist_ok=True)
            Path(f"/tmp/locales_json/{locale}.json").write_text(
                json.dumps(snap, ensure_ascii=False, indent=2)
            )
            # Render
            subprocess.run(
                ["python3", str(SCRIPTS / "render_locale.py"), locale],
                check=True,
                capture_output=True,
            )
            print(f"[{locale}] done in {time.time() - t0:.0f}s → {translated}", flush=True)

    await asyncio.gather(*(worker(loc, lang) for loc, lang in LANG_MAP.items()))
    print("\nALL DONE.")


if __name__ == "__main__":
    asyncio.run(main())
