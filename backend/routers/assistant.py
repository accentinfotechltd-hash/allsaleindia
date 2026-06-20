"""AI Shopping Assistant — HTTP endpoints.

Two endpoints:
  - ``POST /api/assistant/chat`` — single-turn chat. Anonymous OK.
  - ``GET  /api/assistant/sessions/{id}`` — replay a session (for refresh).
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user_optional
from services.assistant_svc import run_turn

router = APIRouter(prefix="/assistant", tags=["assistant"])


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=800)
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    products: list[dict] = Field(default_factory=list)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    current=Depends(get_current_user_optional),
):
    session_id = body.session_id or f"asst_{uuid.uuid4().hex[:14]}"
    user_id = current.get("id") if current else None

    result = await run_turn(
        session_id=session_id,
        user_id=user_id,
        user_message=body.message.strip(),
    )
    return ChatResponse(
        session_id=session_id,
        reply=result["reply"],
        products=result["products"],
    )


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    current=Depends(get_current_user_optional),
):
    sess = await db.assistant_sessions.find_one(
        {"id": session_id}, {"_id": 0}
    )
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    # Privacy: if owner is set, only the owner can view it.
    if sess.get("user_id") and current and sess["user_id"] != current.get("id"):
        raise HTTPException(status_code=403, detail="Not your session")

    # Hydrate product details for each turn so the client can re-render cards.
    pid_set: set[str] = set()
    for m in sess.get("messages", []):
        for pid in m.get("product_ids", []) or []:
            pid_set.add(pid)
    products_by_id: dict[str, dict] = {}
    if pid_set:
        async for p in db.products.find(
            {"id": {"$in": list(pid_set)}},
            {
                "_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1,
                "category": 1, "subcategory": 1, "rating": 1,
                "reviews_count": 1, "seller_name": 1,
            },
        ):
            products_by_id[p["id"]] = p

    messages = []
    for m in sess.get("messages", []):
        out = {"role": m["role"], "content": m["content"]}
        if m.get("product_ids"):
            out["products"] = [
                products_by_id[pid]
                for pid in m["product_ids"]
                if pid in products_by_id
            ]
        messages.append(out)
    return {
        "session_id": session_id,
        "messages": messages,
        "created_at": sess.get("created_at"),
        "updated_at": sess.get("updated_at"),
    }
