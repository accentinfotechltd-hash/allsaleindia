"""Cloudinary uploads (server-side signed)."""
from __future__ import annotations

import logging
import os

logger = logging.getLogger("allsale")

_CLOUDINARY_READY = False
cloudinary = None  # type: ignore[assignment]

try:
    import cloudinary as _cloudinary  # noqa: F401
    import cloudinary.uploader  # noqa: F401

    if (
        os.environ.get("CLOUDINARY_CLOUD_NAME")
        and os.environ.get("CLOUDINARY_API_KEY")
        and os.environ.get("CLOUDINARY_API_SECRET")
    ):
        _cloudinary.config(
            cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
            api_key=os.environ["CLOUDINARY_API_KEY"],
            api_secret=os.environ["CLOUDINARY_API_SECRET"],
            secure=True,
        )
        _CLOUDINARY_READY = True
        cloudinary = _cloudinary
        logger.info(
            "Cloudinary configured for cloud=%s", os.environ["CLOUDINARY_CLOUD_NAME"]
        )
except Exception as _e:  # pragma: no cover - import-time best effort
    logger.warning("Cloudinary import/config failed: %s", _e)


def is_ready() -> bool:
    return _CLOUDINARY_READY
