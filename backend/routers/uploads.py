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


@router.post("/uploads/image", response_model=UploadImageResponse)
async def upload_image(
    body: UploadImageRequest, current=Depends(get_current_user)
):
    """Upload a single image (base64 data-URI or remote URL) to Cloudinary."""
    src = (body.data or "").strip()
    if not src:
        raise HTTPException(status_code=400, detail="Empty image data")

    if src.startswith("data:"):
        if len(src) > 8_000_000:  # ~6MB binary
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
