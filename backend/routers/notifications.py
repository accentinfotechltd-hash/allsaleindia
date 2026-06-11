"""Notifications endpoints (buyer/seller in-app)."""
from __future__ import annotations

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from config import ADMIN_SECRET
from db import db
from deps import get_current_user
from models import Notification

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=List[Notification])
async def list_my_notifications(current=Depends(get_current_user)):
    cursor = (
        db.notifications.find({"user_id": current["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(100)
    )
    return [Notification(**n) async for n in cursor]


@router.get("/notifications/unread-count")
async def my_unread_count(current=Depends(get_current_user)):
    count = await db.notifications.count_documents(
        {"user_id": current["id"], "read": False}
    )
    return {"unread": int(count)}


@router.post("/notifications/{notification_id}/read", response_model=Notification)
async def mark_notification_read(
    notification_id: str, current=Depends(get_current_user)
):
    res = await db.notifications.find_one_and_update(
        {"id": notification_id, "user_id": current["id"]},
        {"$set": {"read": True}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Notification not found")
    res.pop("_id", None)
    return Notification(**res)


@router.post("/notifications/read-all")
async def mark_all_read(current=Depends(get_current_user)):
    res = await db.notifications.update_many(
        {"user_id": current["id"], "read": False}, {"$set": {"read": True}}
    )
    return {"updated": res.modified_count}


@router.get("/admin/notifications", response_model=List[Notification])
async def admin_list_notifications(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    cursor = (
        db.notifications.find({"user_id": "admin"}, {"_id": 0})
        .sort("created_at", -1)
        .limit(200)
    )
    return [Notification(**n) async for n in cursor]
