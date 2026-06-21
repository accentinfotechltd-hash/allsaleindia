"""Render a translated flat JSON dict back into a TS locale file matching en.ts structure.

Usage:
  python3 render_locale.py es  → reads /tmp/locales_json/es.json → writes /app/frontend/src/i18n/locales/es.ts

Approach: walk en.ts source line by line; for every line `    key: "..."`,
replace the value with the translated one from the flat dict.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

EN_TS = Path("/app/frontend/src/i18n/locales/en.ts")
JSON_DIR = Path("/tmp/locales_json")
OUT_DIR = Path("/app/frontend/src/i18n/locales")


def render(locale: str) -> None:
    var = locale.replace("-", "")
    flat = json.loads((JSON_DIR / f"{locale}.json").read_text())
    src = EN_TS.read_text()
    lines = src.splitlines(keepends=True)

    # Track current key path by indentation. Lines look like:
    #   const en = {
    #     common: {           ← depth 1 push 'common'
    #       save: "Save",     ← key at depth 2 → 'common.save'
    #     },                  ← depth 1 pop
    #     auth: {             ← depth 1 push 'auth'
    #       ...
    #     },
    #   };

    path_stack: list[str] = []
    out_lines: list[str] = []

    # Regex for an opening section line: `  <indent>keyname: {`
    open_re = re.compile(r"^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{\s*$")
    # Regex for a leaf string line: `  <indent>keyname: "...",`
    # Need to handle escaped quotes inside value.
    leaf_re = re.compile(r'^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"((?:[^"\\]|\\.)*)"(\s*,?\s*)$')
    # Regex for close: `  <indent>},` or `  <indent>}`
    close_re = re.compile(r"^\s*\},?\s*$")

    for line in lines:
        m_open = open_re.match(line)
        m_leaf = leaf_re.match(line)
        m_close = close_re.match(line)

        if m_open:
            path_stack.append(m_open.group(2))
            out_lines.append(line)
            continue
        if m_leaf:
            indent, key, value, trailing = m_leaf.groups()
            full = ".".join(path_stack + [key])
            new_val = flat.get(full, value)
            # Escape backslash and double-quote in the translated value (preserve `\n`, `\t`).
            # The translated value from JSON is already raw; we need to encode it back as a JS string.
            esc = json.dumps(new_val, ensure_ascii=False)
            out_lines.append(f"{indent}{key}: {esc}{trailing}")
            continue
        if m_close:
            if path_stack:
                path_stack.pop()
            out_lines.append(line)
            continue
        out_lines.append(line)

    result = "".join(out_lines)
    # Rewrite `const en = {` → `const <var> = {`  and  `export default en;` → `export default <var>;`
    result = result.replace("const en =", f"const {var} =", 1)
    result = result.replace("export default en;", f"export default {var};")
    dst = OUT_DIR / f"{locale}.ts"
    dst.write_text(result)
    print(f"Rendered {locale}.ts: {len(result)}B, {len(flat)} keys")


def main() -> None:
    locales = sys.argv[1:]
    if not locales:
        locales = sorted(p.stem for p in JSON_DIR.glob("*.json"))
    for loc in locales:
        try:
            render(loc)
        except Exception as e:
            print(f"FAIL {loc}: {e}")


if __name__ == "__main__":
    main()
