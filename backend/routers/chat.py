"""Buyer ↔ Seller live chat — polling-based MVP.

One conversation per (buyer_id, seller_id, product_id). Messages are
sender-attributed and stored in a separate collection for query speed.
Unread counter is per-side (`buyer_unread`/`seller_unread`).
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from models import (
    ChatConversation,
    ChatMessage,
    ChatMessageCreate,
    ChatStartRequest,
    ChatThread,
    UnreadCount,
)
from utils import now_utc

router = APIRouter(prefix="/chat", tags=["chat"])


def _role_for(conv: dict, user_id: str) -> Optional[str]:
    if conv.get("buyer_id") == user_id:
        return "buyer"
    if conv.get("seller_id") == user_id:
        return "seller"
    return None


def _other_unread_field(role: str) -> str:
    return "seller_unread" if role == "buyer" else "buyer_unread"


def _self_unread_field(role: str) -> str:
    return "buyer_unread" if role == "buyer" else "seller_unread"


def _public_conv(conv: dict, role: str) -> ChatConversation:
    return ChatConversation(
        id=conv["id"],
        buyer_id=conv["buyer_id"],
        buyer_name=conv.get("buyer_name"),
        seller_id=conv["seller_id"],
        seller_name=conv.get("seller_name"),
        product_id=conv.get("product_id"),
        product_name=conv.get("product_name"),
        product_image=conv.get("product_image"),
        order_id=conv.get("order_id"),
        last_message_preview=conv.get("last_message_preview"),
        last_message_at=conv.get("last_message_at"),
        unread_count=int(conv.get(_self_unread_field(role), 0) or 0),
        created_at=conv["created_at"],
    )


# ---------------------------------------------------------------------------
# Start / get-or-create
# ---------------------------------------------------------------------------
@router.post("/conversations", response_model=ChatConversation, status_code=201)
async def start_conversation(body: ChatStartRequest, current=Depends(get_current_user)):
    if body.seller_id == current["id"]:
        raise HTTPException(status_code=400, detail="You can't chat with yourself")
    seller = await db.users.find_one(
        {"id": body.seller_id, "is_seller": True},
        {"_id": 0, "id": 1, "full_name": 1},
    )
    if not seller:
        raise HTTPException(status_code=404, detail="Seller not found")

    seller_profile = await db.sellers.find_one(
        {"user_id": body.seller_id}, {"_id": 0, "company_name": 1}
    )
    seller_name = (seller_profile or {}).get("company_name") or seller.get("full_name")

    product_name = None
    product_image = None
    if body.product_id:
        prod = await db.products.find_one(
            {"id": body.product_id}, {"_id": 0, "name": 1, "image": 1}
        )
        if prod:
            product_name = prod.get("name")
            product_image = prod.get("image")

    # One conversation per (buyer, seller, product)
    query = {
        "buyer_id": current["id"],
        "seller_id": body.seller_id,
        "product_id": body.product_id,
    }
    existing = await db.chat_conversations.find_one(query, {"_id": 0})
    if existing:
        conv = existing
    else:
        conv = {
            "id": f"conv_{uuid.uuid4().hex[:14]}",
            "buyer_id": current["id"],
            "buyer_name": current.get("full_name") or current.get("email", "Buyer"),
            "seller_id": body.seller_id,
            "seller_name": seller_name,
            "product_id": body.product_id,
            "product_name": product_name,
            "product_image": product_image,
            "order_id": body.order_id,
            "last_message_preview": None,
            "last_message_at": None,
            "buyer_unread": 0,
            "seller_unread": 0,
            "created_at": now_utc(),
        }
        await db.chat_conversations.insert_one(conv)

    # Optional first message
    if body.body and body.body.strip():
        await _insert_message(
            conv=conv, sender_id=current["id"], sender_role="buyer",
            sender_name=conv["buyer_name"], body=body.body.strip(),
        )
        conv = await db.chat_conversations.find_one({"id": conv["id"]}, {"_id": 0})

    return _public_conv(conv, "buyer")


# ---------------------------------------------------------------------------
# List my conversations
# ---------------------------------------------------------------------------
@router.get("/conversations", response_model=List[ChatConversation])
async def list_conversations(current=Depends(get_current_user)):
    out: list[ChatConversation] = []
    q = {"$or": [{"buyer_id": current["id"]}, {"seller_id": current["id"]}]}
    async for c in db.chat_conversations.find(q, {"_id": 0}).sort(
        "last_message_at", -1
    ):
        role = _role_for(c, current["id"])
        if not role:
            continue
        out.append(_public_conv(c, role))
    return out


# ---------------------------------------------------------------------------
# Thread (messages of a conversation)
# ---------------------------------------------------------------------------
@router.get("/conversations/{conv_id}", response_model=ChatThread)
async def get_thread(
    conv_id: str, since: Optional[str] = None, current=Depends(get_current_user)
):
    """`since` (ISO datetime) lets the client poll for only new messages."""
    conv = await db.chat_conversations.find_one({"id": conv_id}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    role = _role_for(conv, current["id"])
    if not role:
        raise HTTPException(status_code=403, detail="Not a participant")

    q: dict = {"conversation_id": conv_id}
    if since:
        try:
            from datetime import datetime as _dt
            q["created_at"] = {"$gt": _dt.fromisoformat(since.replace("Z", "+00:00"))}
        except Exception:
            pass

    messages: list[ChatMessage] = []
    async for m in db.chat_messages.find(q, {"_id": 0}).sort("created_at", 1):
        messages.append(ChatMessage(**{k: m.get(k) for k in ChatMessage.model_fields.keys()}))

    # Mark current side's unread as 0 (the user opened the thread)
    self_field = _self_unread_field(role)
    if int(conv.get(self_field, 0) or 0) > 0:
        await db.chat_conversations.update_one(
            {"id": conv_id}, {"$set": {self_field: 0}}
        )
        conv[self_field] = 0

    return ChatThread(conversation=_public_conv(conv, role), messages=messages)


# ---------------------------------------------------------------------------
# Send message
# ---------------------------------------------------------------------------
async def _insert_message(
    *, conv: dict, sender_id: str, sender_role: str, sender_name: str | None,
    body: str,
):
    msg = {
        "id": f"msg_{uuid.uuid4().hex[:14]}",
        "conversation_id": conv["id"],
        "sender_id": sender_id,
        "sender_role": sender_role,
        "sender_name": sender_name,
        "body": body,
        "created_at": now_utc(),
    }
    await db.chat_messages.insert_one(msg)
    # Bump the other side's unread + persist preview
    other_field = _other_unread_field(sender_role)
    await db.chat_conversations.update_one(
        {"id": conv["id"]},
        {
            "$set": {
                "last_message_preview": body[:120],
                "last_message_at": msg["created_at"],
            },
            "$inc": {other_field: 1},
        },
    )
    return msg


@router.post("/conversations/{conv_id}/messages", response_model=ChatMessage, status_code=201)
async def send_message(
    conv_id: str, body: ChatMessageCreate, current=Depends(get_current_user)
):
    conv = await db.chat_conversations.find_one({"id": conv_id}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    role = _role_for(conv, current["id"])
    if not role:
        raise HTTPException(status_code=403, detail="Not a participant")
    sender_name = current.get("full_name") or current.get("email")
    if role == "seller":
        sp = await db.sellers.find_one(
            {"user_id": current["id"]}, {"_id": 0, "company_name": 1}
        )
        sender_name = (sp or {}).get("company_name") or sender_name

    msg = await _insert_message(
        conv=conv, sender_id=current["id"], sender_role=role,
        sender_name=sender_name, body=body.body.strip(),
    )
    return ChatMessage(**{k: msg.get(k) for k in ChatMessage.model_fields.keys()})


# ---------------------------------------------------------------------------
# Unread count badge
# ---------------------------------------------------------------------------
@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(current=Depends(get_current_user)):
    total = 0
    by_conv: dict = {}
    q = {"$or": [{"buyer_id": current["id"]}, {"seller_id": current["id"]}]}
    async for c in db.chat_conversations.find(
        q, {"_id": 0, "id": 1, "buyer_id": 1, "buyer_unread": 1, "seller_unread": 1}
    ):
        role = "buyer" if c["buyer_id"] == current["id"] else "seller"
        n = int(c.get(_self_unread_field(role), 0) or 0)
        if n:
            by_conv[c["id"]] = n
            total += n
    return UnreadCount(total=total, by_conversation=by_conv)
