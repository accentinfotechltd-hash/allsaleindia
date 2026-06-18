"""APScheduler-driven background jobs.

Currently scheduled jobs:
  * payouts_release_due — runs every 30 minutes; promotes held→available
    and reserve_held→available based on tier policy. Idempotent.

Lifecycle: ``init_scheduler()`` is called from ``server.on_startup``;
``shutdown_scheduler()`` from ``on_shutdown``.

The scheduler is **disabled** when the env var ``DISABLE_SCHEDULER=1`` is
set (used by the test suite to avoid background side-effects).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger("allsale.scheduler")

_scheduler: Optional[AsyncIOScheduler] = None


async def _run_payouts_release_due() -> None:
    try:
        from services.payouts import release_due_payouts

        result = await release_due_payouts()
        if (
            result.get("flipped_to_available")
            or result.get("flipped_to_reserve_held")
            or result.get("reserve_released")
        ):
            logger.info("payouts release tick: %s", result)
    except Exception:  # pragma: no cover — never let the scheduler die
        logger.exception("payouts_release_due job failed")


async def _run_ambassador_release_due() -> None:
    """Release ambassador commission past its 7-day hold (or claw back on
    cancelled/refunded orders). Idempotent."""
    try:
        from services.ambassador_attribution import release_due_ambassador_commission

        await release_due_ambassador_commission()
    except Exception:  # pragma: no cover
        logger.exception("ambassador_release_due job failed")


def init_scheduler() -> None:
    """Start the background scheduler. Safe to call multiple times."""
    global _scheduler
    if os.getenv("DISABLE_SCHEDULER") == "1":
        logger.info("Scheduler disabled via DISABLE_SCHEDULER=1")
        return
    if _scheduler and _scheduler.running:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    # Run every 30 minutes. The job itself is idempotent so the cadence is
    # mostly about how fresh sellers see "Available" balances update.
    _scheduler.add_job(
        _run_payouts_release_due,
        IntervalTrigger(minutes=30),
        id="payouts_release_due",
        next_run_time=None,  # don't run immediately at boot
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    # Ambassador commission hold-release. Once an hour is plenty — the hold
    # is measured in days, not minutes.
    _scheduler.add_job(
        _run_ambassador_release_due,
        IntervalTrigger(hours=1),
        id="ambassador_release_due",
        next_run_time=None,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info("APScheduler started — payouts_release_due every 30m, "
                "ambassador_release_due every 1h")


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
    _scheduler = None
