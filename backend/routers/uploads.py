"""Image uploads (Cloudinary, with passthrough fallback)."""
from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from deps import get_current_user
from models import UploadImageRequest, UploadImageResponse
from services import cloudinary_svc

logger = logging.getLogger("allsale")
router = APIRouter(tags=["uploads"])


# ~30 sec / 20 MB cap (data URI ≈ 4/3× binary, so 27 MB string ≈ 20 MB binary).
MAX_VIDEO_DATAURI_BYTES = 27_000_000
MAX_IMAGE_DATAURI_BYTES = 8_000_000


@router.post("/uploads/image", response_model=UploadImageResponse)
async def upload_image(
    body: UploadImageRequest, current=Depends(get_current_user)
):
    """Upload a single image (base64 data-URI or remote URL) to Cloudinary."""
    src = (body.data or "").strip()
    if not src:
        raise HTTPException(status_code=400, detail="Empty image data")

    if src.startswith("data:"):
        if len(src) > MAX_IMAGE_DATAURI_BYTES:
            raise HTTPException(status_code=413, detail="Image too large (max ~6 MB)")
        try:
            _, _, b64 = src.partition(",")
            base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="Invalid base64 image payload")

    if not cloudinary_svc.is_ready():
        return UploadImageResponse(url=src, provider="passthrough", bytes=len(src))

    folder = (body.folder or "allsale/products").strip().strip("/")
    public_id_seed = f"{current['id']}/{uuid.uuid4().hex[:12]}"
    try:
        result = await asyncio.to_thread(
            cloudinary_svc.cloudinary.uploader.upload,
            src,
            folder=folder,
            public_id=public_id_seed,
            resource_type="image",
            overwrite=False,
            unique_filename=False,
            use_filename=False,
            transformation=[{"quality": "auto:good", "fetch_format": "auto"}],
        )
    except Exception as e:
        logger.warning("Cloudinary upload failed: %s", e)
        raise HTTPException(status_code=502, detail="Image upload failed. Please try again.")

    return UploadImageResponse(
        url=result.get("secure_url") or result.get("url"),
        public_id=result.get("public_id"),
        provider="cloudinary",
        bytes=int(result.get("bytes") or 0),
    )


@router.post("/uploads/video", response_model=UploadImageResponse)
async def upload_video(
    body: UploadImageRequest, current=Depends(get_current_user)
):
    """Upload a short proof video (base64 data-URI or remote URL).

    Max ~20 MB binary (≈30 seconds). Uses Cloudinary `resource_type=video`
    which transcodes / streams the result and returns a secure mp4 URL.
    """
    src = (body.data or "").strip()
    if not src:
        raise HTTPException(status_code=400, detail="Empty video data")

    if src.startswith("data:"):
        if len(src) > MAX_VIDEO_DATAURI_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Video too large. Please keep it under ~20 MB / 30 seconds.",
            )
        try:
            _, _, b64 = src.partition(",")
            base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="Invalid base64 video payload")

    if not cloudinary_svc.is_ready():
        return UploadImageResponse(url=src, provider="passthrough", bytes=len(src))

    folder = (body.folder or "allsale/returns").strip().strip("/")
    public_id_seed = f"{current['id']}/{uuid.uuid4().hex[:12]}"
    try:
        result = await asyncio.to_thread(
            cloudinary_svc.cloudinary.uploader.upload,
            src,
            folder=folder,
            public_id=public_id_seed,
            resource_type="video",
            overwrite=False,
            unique_filename=False,
            use_filename=False,
            # auto:eco keeps file size predictable; cap duration to 30s.
            eager=[{"format": "mp4", "quality": "auto:eco"}],
            chunk_size=6_000_000,
        )
    except Exception as e:
        logger.warning("Cloudinary video upload failed: %s", e)
        raise HTTPException(status_code=502, detail="Video upload failed. Please try again.")

    # Reject clips longer than 30s (Cloudinary returns duration in seconds).
    duration = float(result.get("duration") or 0)
    if duration and duration > 35.0:  # tiny grace for header parsing variance
        # Best-effort cleanup; ignore failures.
        try:
            cloudinary_svc.cloudinary.uploader.destroy(
                result.get("public_id"), resource_type="video"
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=400,
            detail=f"Video is {duration:.0f}s — please keep proof clips under 30 seconds.",
        )

    return UploadImageResponse(
        url=result.get("secure_url") or result.get("url"),
        public_id=result.get("public_id"),
        provider="cloudinary",
        bytes=int(result.get("bytes") or 0),
    )
