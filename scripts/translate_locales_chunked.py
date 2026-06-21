"""Chunked mass-translation of /app/frontend/src/i18n/locales/en.ts → 26 locales.

The 91KB single-shot translation hit 502 BadGateway from the LLM gateway.
This version splits en.ts by top-level keys, groups them into ~12KB chunks,
translates each chunk independently with retry, then reassembles.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import time
from pathlib import Path

from emergentintegrations.llm.chat import LlmChat, UserMessage

KEY = os.environ.get("EMERGENT_LLM_KEY", "sk-emergent-a9d96A438Fb133c367")
ROOT = Path("/app/frontend/src/i18n/locales")
SRC = ROOT / "en.ts"

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

CHUNK_TARGET = 11000  # ~11KB per chunk → keeps Claude well under 502 risk.

PROMPT = """You are a professional UI translator for "Allsale" — a mobile e-commerce app (Indian marketplace → NZ/AU/US/UK/CA/Pacific).

You will receive a FRAGMENT of a TypeScript locale object containing one or more top-level key blocks like:
  keyname: {{
    sub_key: "english string",
    ...
  }},

Translate ALL string VALUES into **{LANGUAGE}**.

CRITICAL RULES:
1. PRESERVE every key name exactly (e.g. `placeholder_email`, `tab_sales`).
2. PRESERVE the structure, indentation (2 spaces), trailing commas, blank lines.
3. PRESERVE ICU placeholders verbatim: `{{name}}`, `%{{email}}`, `{{count}}`, `{{currency}}`.
4. PRESERVE emoji (🇮🇳, ✓, →, ●, ★) and special markers (%, ₹, $).
5. PRESERVE escape sequences exactly (`\\n`, `\\t`).
6. PRESERVE brand names: Allsale, Stripe, Razorpay, India, NZ, MPI, Apple, Google, Shiprocket.
7. PRESERVE code-like tokens in strings (URLs, emails, identifiers like `ab.exposure`).
8. Use the language's NATIVE SCRIPT (Tamil → Tamil script, not transliteration).
9. For RTL languages (Arabic, Urdu) just translate — the app handles RTL direction.

Return ONLY the translated fragment. No preamble, no markdown fence, no explanation.
Start directly with the first key name. End with the closing `}},` of the last key block.
"""


def parse_chunks(src: str) -> tuple[str, list[str], str]:
    """Split en.ts into (header, list_of_chunks, footer).

    Each chunk is a contiguous block of top-level `keyname: { ... },` sections
    summing to ~CHUNK_TARGET bytes. Header = lines before first top-level key
    (i.e., `const en = {`). Footer = `};\nexport default en;` (we'll rewrite var name).
    """
    lines = src.splitlines(keepends=True)
    # find header end: first line matching `^  [a-z_]+: {`
    header_end = 0
    for i, l in enumerate(lines):
        if re.match(r"^  [a-z_]+:\s*\{", l):
            header_end = i
            break
    header = "".join(lines[:header_end])

    # find footer start: last line that is `};` or `}` at column 0
    footer_start = len(lines)
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].rstrip() in ("};", "}"):
            footer_start = i
            break
    body = "".join(lines[header_end:footer_start])
    footer = "".join(lines[footer_start:])

    # split body by top-level sections — they all start with 2-space indent + key + `: {`
    section_pattern = re.compile(r"(?m)^  [a-z_]+:\s*\{")
    starts = [m.start() for m in section_pattern.finditer(body)]
    starts.append(len(body))
    sections = [body[starts[i] : starts[i + 1]] for i in range(len(starts) - 1)]

    # group into chunks of ~CHUNK_TARGET bytes
    chunks: list[str] = []
    cur: list[str] = []
    cur_size = 0
    for s in sections:
        if cur_size + len(s) > CHUNK_TARGET and cur:
            chunks.append("".join(cur))
            cur = [s]
            cur_size = len(s)
        else:
            cur.append(s)
            cur_size += len(s)
    if cur:
        chunks.append("".join(cur))
    return header, chunks, footer


async def translate_chunk(locale: str, language: str, chunk: str, idx: int, total: int, retries: int = 3) -> str:
    prompt = PROMPT.format(LANGUAGE=language)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            chat = (
                LlmChat(
                    api_key=KEY,
                    session_id=f"tx-{locale}-{idx}-{int(time.time())}",
                    system_message=prompt,
                )
                .with_model("anthropic", "claude-sonnet-4-5-20250929")
                .with_params(max_tokens=16000)
            )
            out = await chat.send_message(UserMessage(text=chunk))
            text = out.strip()
            if text.startswith("```"):
                text = re.sub(r"^```[a-zA-Z]*\n", "", text)
                text = re.sub(r"\n```\s*$", "", text)
            # sanity: must contain at least one `: {`
            if ": {" not in text:
                raise RuntimeError(f"missing object structure in output (len={len(text)})")
            return text
        except Exception as e:
            last_err = e
            wait = 2 ** attempt * 3
            print(f"[{locale} chunk {idx + 1}/{total}] attempt {attempt + 1} FAILED: {e} — retry in {wait}s", flush=True)
            await asyncio.sleep(wait)
    raise RuntimeError(f"[{locale} chunk {idx + 1}/{total}] all retries failed: {last_err}")


async def translate_one(locale: str, language: str, header: str, chunks: list[str], footer: str) -> str:
    var_name = locale.replace("-", "")
    # translate chunks sequentially per locale (locale-level concurrency handled by caller)
    translated: list[str] = []
    for i, c in enumerate(chunks):
        print(f"[{locale}] chunk {i + 1}/{len(chunks)} ({len(c)}B)…", flush=True)
        t = await translate_chunk(locale, language, c, i, len(chunks))
        translated.append(t)
    # rewrite header: `const en = {` → `const <var> = {`
    new_header = header.replace("const en =", f"const {var_name} =", 1)
    body = "\n".join(translated)
    # ensure no double-newlines or accidental fence text remained
    new_footer = footer.replace("export default en;", f"export default {var_name};")
    # if footer doesn't contain export default (might be only `};`), append it
    if "export default" not in new_footer:
        new_footer = new_footer.rstrip() + f"\nexport default {var_name};\n"
    return new_header + body + new_footer


async def main() -> None:
    requested = sys.argv[1:] or list(LANG_MAP.keys())
    src = SRC.read_text()
    header, chunks, footer = parse_chunks(src)
    print(
        f"Source: {len(src)}B → header {len(header)}B + {len(chunks)} chunks + footer {len(footer)}B\n"
        f"Chunk sizes: {[len(c) for c in chunks]}\n"
        f"Translating to {len(requested)} locales: {requested}\n",
        flush=True,
    )

    # Concurrency: 3 locales in parallel (each does its chunks sequentially → ~3 chunks in flight)
    sem = asyncio.Semaphore(3)
    failures: list[str] = []

    async def worker(locale: str) -> None:
        async with sem:
            try:
                lang = LANG_MAP[locale]
                print(f"=== [{locale}] starting ({lang}) ===", flush=True)
                t0 = time.time()
                out = await translate_one(locale, lang, header, chunks, footer)
                if out.count("{") != out.count("}"):
                    print(
                        f"[{locale}] WARN: bracket imbalance ({out.count('{')} vs {out.count('}')})",
                        flush=True,
                    )
                dst = ROOT / f"{locale}.ts"
                dst.write_text(out)
                dt = time.time() - t0
                print(f"=== [{locale}] DONE in {dt:.0f}s, wrote {len(out)}B → {dst.name} ===", flush=True)
            except Exception as e:
                print(f"=== [{locale}] LOCALE FAILED: {e} ===", flush=True)
                failures.append(locale)

    await asyncio.gather(*(worker(loc) for loc in requested))
    print(f"\nALL DONE. Failures: {failures or 'NONE'}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
