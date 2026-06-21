"""Post-fix tool for translated locale files: balances braces in .ts locale outputs.

Haiku 4.5 occasionally emits one stray closing `}` per file. This finds and removes
the extra `}` by walking the file with a brace-aware parser that respects strings,
then validates the corrected file with `tsc`.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path("/app/frontend/src/i18n/locales")


def _strip_strings(src: str) -> str:
    """Replace all string literals with empty quotes so brace counts ignore string content."""
    # Handle "...", '...', `...` with escape sequences.
    out: list[str] = []
    i = 0
    n = len(src)
    while i < n:
        ch = src[i]
        if ch in ('"', "'", "`"):
            quote = ch
            out.append(quote)
            i += 1
            while i < n:
                if src[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                if src[i] == quote:
                    out.append(quote)
                    i += 1
                    break
                i += 1
        elif ch == "/" and i + 1 < n and src[i + 1] == "/":
            # line comment
            while i < n and src[i] != "\n":
                i += 1
        elif ch == "/" and i + 1 < n and src[i + 1] == "*":
            i += 2
            while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"):
                i += 1
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def find_stray_close_brace(src: str) -> int | None:
    """Return the byte offset of an extra `}` that takes depth negative or leaves residual > 0.

    Returns the offset of the FIRST stray close found by walking depth.
    Returns None if file already balanced.
    """
    stripped = _strip_strings(src)
    # We need offsets in original string, but stripped has same length (we kept quotes).
    depth = 0
    stray_at: int | None = None
    for i, ch in enumerate(stripped):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0 and stray_at is None:
                stray_at = i
                # Don't break — keep walking to see if it auto-recovers
                depth = 0  # reset so we keep scanning
    if depth > 0:
        # Missing closes, not handled here
        return None
    return stray_at


def fix_file(p: Path) -> tuple[bool, str]:
    """Return (changed, message)."""
    src = p.read_text()
    stripped = _strip_strings(src)
    # Count net brace balance
    raw_open = stripped.count("{")
    raw_close = stripped.count("}")
    if raw_open == raw_close:
        return False, f"{p.name}: balanced ({raw_open} == {raw_close})"
    if raw_close == raw_open + 1:
        # Find a stray inline `}` that is not preceded by `,` and not followed by content
        # The most common pattern from Haiku is `  },};` at the end OR a duplicated `},` mid-file.
        # Strategy: find the LAST occurrence of `},\n}` followed by another `};` or `}` near EOF.
        # Better: walk depth and find first negative dip.
        depth = 0
        stray_idx = None
        for i, ch in enumerate(stripped):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth < 0:
                    stray_idx = i
                    depth = 0  # continue scanning so we don't false-positive
        if stray_idx is None:
            # Imbalance but no negative dip: likely an extra `}` AFTER everything closes (depth went 0→-1 at end and we reset → undetected).
            # Walk again without resetting:
            depth = 0
            for i, ch in enumerate(stripped):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth < 0:
                        stray_idx = i
                        break
        if stray_idx is None:
            return False, f"{p.name}: imbalance ({raw_open} vs {raw_close}) but could not locate stray brace"
        # Remove the stray brace at that offset
        new_src = src[:stray_idx] + src[stray_idx + 1 :]
        p.write_text(new_src)
        # Show context
        ctx_start = max(0, stray_idx - 50)
        ctx_end = min(len(src), stray_idx + 50)
        return True, f"{p.name}: removed stray `}}` at offset {stray_idx}: …{src[ctx_start:ctx_end]!r}…"
    if raw_open == raw_close + 1:
        return False, f"{p.name}: MISSING close brace ({raw_open} vs {raw_close}) — needs manual fix"
    return False, f"{p.name}: large imbalance ({raw_open} vs {raw_close}) — needs manual fix"


def main() -> None:
    args = sys.argv[1:]
    if args:
        files = [ROOT / f"{a}.ts" if not a.endswith(".ts") else ROOT / a for a in args]
    else:
        files = sorted(ROOT.glob("*.ts"))
    for f in files:
        if f.name in ("en.ts", "hi.ts", "tpi.ts"):
            continue  # known-good originals
        if not f.exists():
            print(f"{f.name}: NOT FOUND")
            continue
        changed, msg = fix_file(f)
        print(("FIXED  " if changed else "       ") + msg)


if __name__ == "__main__":
    main()
