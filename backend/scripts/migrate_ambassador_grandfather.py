"""One-shot migration: grandfather all existing ambassadors into the new
approval flow.

Context — before the T&C Approval Flow, ``ambassador_profile.status`` could
only be one of ``{active, dormant, suspended, forfeited}``. New signups now
start in ``pending_approval`` and must accept the T&Cs + receive admin
approval. To avoid breaking the ~14 ambassadors who joined under the old
flow, we backfill:

  - ``terms_accepted_at = <migration_timestamp>``
  - ``terms_accepted_version = "v1"``

This is idempotent — re-running is a no-op once everyone is stamped.

Run:
    PYTHONPATH=/app/backend python /app/backend/scripts/migrate_ambassador_grandfather.py
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from db import db


async def main() -> dict:
    now = datetime.now(timezone.utc)
    # Anyone already enrolled BUT missing terms_accepted_at -> stamp them.
    # We do NOT touch users in pending_approval / rejected / permanently_banned
    # since those are post-migration statuses.
    res = await db.users.update_many(
        {
            "ambassador_profile": {"$exists": True},
            "ambassador_profile.terms_accepted_at": {"$exists": False},
            "ambassador_profile.status": {
                "$in": ["active", "dormant", "suspended", "forfeited"],
            },
        },
        {"$set": {
            "ambassador_profile.terms_accepted_at": now,
            "ambassador_profile.terms_accepted_version": "v1",
            "ambassador_profile.grandfathered_at": now,
        }},
    )
    summary = {
        "matched": res.matched_count,
        "modified": res.modified_count,
        "at": now.isoformat(),
    }
    print(f"Grandfather migration complete: {summary}")
    return summary


if __name__ == "__main__":
    asyncio.run(main())
