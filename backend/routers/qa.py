"""Product Q&A — Amazon-style customer questions on the PDP.

Buyers can post questions; sellers and other buyers can answer. Verified
purchasers get a "verified purchase" badge on their answers; the listing
owner gets a "Seller" badge. Questions can be upvoted (helpful → boosts
ranking when sorted by `helpful`).

Collections:
  - ``product_questions``: ``{id, product_id, user_id, user_name, text,
        created_at, upvotes, upvote_user_ids, answer_count}``
  - ``product_answers``:   ``{id, question_id, product_id, user_id,
        user_name, text, created_at, is_seller, is_verified_purchase,
        helpful_count, helpful_user_ids}``

All endpoints under this router are mounted at ``/api/...`` like the rest
of the backend. No admin-only endpoints — moderation can be added later
via the existing admin actions router.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user, get_current_user_optional
from services.notifications import create_notification
from utils import now_utc


router = APIRouter(tags=["product-qa"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class QuestionCreate(BaseModel):
    text: str = Field(..., min_length=5, max_length=500)


class AnswerCreate(BaseModel):
    text: str = Field(..., min_length=2, max_length=1000)


class VotePayload(BaseModel):
    direction: str = Field(..., description="up | clear")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _serialize_question(
    q: dict, *, current_uid: Optional[str], top_answer: Optional[dict] = None
) -> dict:
    upvote_ids = set(q.get("upvote_user_ids") or [])
    return {
        "id": q["id"],
        "product_id": q["product_id"],
        "user_name": q.get("user_name") or "Anonymous",
        "text": q["text"],
        "created_at": q["created_at"].isoformat()
        if hasattr(q.get("created_at"), "isoformat")
        else q.get("created_at"),
        "upvotes": int(q.get("upvotes") or 0),
        "answer_count": int(q.get("answer_count") or 0),
        "is_upvoted_by_me": bool(current_uid and current_uid in upvote_ids),
        "top_answer": (
            await _serialize_answer(top_answer, current_uid=current_uid)
            if top_answer
            else None
        ),
    }


async def _serialize_answer(a: dict, *, current_uid: Optional[str]) -> dict:
    helpful_ids = set(a.get("helpful_user_ids") or [])
    return {
        "id": a["id"],
        "question_id": a.get("question_id"),
        "user_name": a.get("user_name") or "Anonymous",
        "text": a["text"],
        "created_at": a["created_at"].isoformat()
        if hasattr(a.get("created_at"), "isoformat")
        else a.get("created_at"),
        "helpful_count": int(a.get("helpful_count") or 0),
        "is_helpful_to_me": bool(current_uid and current_uid in helpful_ids),
        "is_seller": bool(a.get("is_seller")),
        "is_verified_purchase": bool(a.get("is_verified_purchase")),
    }


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------
@router.get("/products/{product_id}/questions")
async def list_questions(
    product_id: str,
    sort: str = Query("helpful", description="helpful | recent"),
    limit: int = Query(10, ge=1, le=50),
    current=Depends(get_current_user_optional),
):
    """List questions for a product. Each row includes the single top
    answer (by helpful_count desc, then recency) as a preview, plus the
    total ``answer_count`` so the client can show "+N more answers"."""
    current_uid: Optional[str] = current.get("id") if current else None

    sort_spec: list[tuple[str, int]]
    if sort == "recent":
        sort_spec = [("created_at", -1)]
    else:
        sort_spec = [("upvotes", -1), ("created_at", -1)]

    questions = [
        q
        async for q in db.product_questions.find(
            {"product_id": product_id}, {"_id": 0}
        )
        .sort(sort_spec)
        .limit(limit)
    ]

    out: list[dict] = []
    for q in questions:
        # Pull the top answer for this question (max 1).
        top = await db.product_answers.find_one(
            {"question_id": q["id"]},
            {"_id": 0},
            sort=[("helpful_count", -1), ("created_at", -1)],
        )
        out.append(
            await _serialize_question(
                q, current_uid=current_uid, top_answer=top
            )
        )

    return {"product_id": product_id, "count": len(out), "items": out}


@router.post("/products/{product_id}/questions", status_code=201)
async def create_question(
    product_id: str,
    body: QuestionCreate,
    current=Depends(get_current_user),
):
    # Confirm product exists (404 — don't allow questions for ghosts).
    if not await db.products.find_one({"id": product_id}, {"_id": 0, "id": 1, "seller_id": 1, "name": 1}):
        raise HTTPException(status_code=404, detail="Product not found")

    qid = f"qst_{uuid.uuid4().hex[:12]}"
    doc = {
        "id": qid,
        "product_id": product_id,
        "user_id": current["id"],
        "user_name": current.get("full_name") or current.get("email", "").split("@")[0],
        "text": body.text.strip(),
        "created_at": now_utc(),
        "upvotes": 0,
        "upvote_user_ids": [],
        "answer_count": 0,
    }
    await db.product_questions.insert_one(doc)

    # Notify the listing's seller (silent on failure).
    try:
        product = await db.products.find_one(
            {"id": product_id}, {"_id": 0, "seller_id": 1, "name": 1}
        )
        if product and product.get("seller_id"):
            await create_notification(
                user_id=product["seller_id"],
                role="seller",
                n_type="qa_new_question",
                title="New customer question",
                body=f"Buyer asked about {product.get('name', 'your listing')}: \"{doc['text'][:80]}\"",
            )
    except Exception:  # noqa: BLE001
        pass

    return await _serialize_question(doc, current_uid=current["id"])


@router.post("/questions/{question_id}/vote")
async def vote_question(
    question_id: str,
    body: VotePayload,
    current=Depends(get_current_user),
):
    q = await db.product_questions.find_one(
        {"id": question_id}, {"_id": 0}
    )
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    upvoted = current["id"] in (q.get("upvote_user_ids") or [])
    if body.direction == "up" and not upvoted:
        await db.product_questions.update_one(
            {"id": question_id},
            {
                "$addToSet": {"upvote_user_ids": current["id"]},
                "$inc": {"upvotes": 1},
            },
        )
        q["upvotes"] = q.get("upvotes", 0) + 1
        q.setdefault("upvote_user_ids", []).append(current["id"])
    elif body.direction == "clear" and upvoted:
        await db.product_questions.update_one(
            {"id": question_id},
            {
                "$pull": {"upvote_user_ids": current["id"]},
                "$inc": {"upvotes": -1},
            },
        )
        q["upvotes"] = max(0, q.get("upvotes", 0) - 1)
        q["upvote_user_ids"] = [
            u for u in (q.get("upvote_user_ids") or []) if u != current["id"]
        ]

    return await _serialize_question(q, current_uid=current["id"])


# ---------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------
@router.get("/questions/{question_id}/answers")
async def list_answers(
    question_id: str,
    limit: int = Query(20, ge=1, le=100),
    current=Depends(get_current_user_optional),
):
    current_uid: Optional[str] = current.get("id") if current else None

    answers = [
        a
        async for a in db.product_answers.find(
            {"question_id": question_id}, {"_id": 0}
        )
        .sort([("helpful_count", -1), ("created_at", -1)])
        .limit(limit)
    ]
    return {
        "question_id": question_id,
        "count": len(answers),
        "items": [
            await _serialize_answer(a, current_uid=current_uid)
            for a in answers
        ],
    }


@router.post("/questions/{question_id}/answers", status_code=201)
async def create_answer(
    question_id: str,
    body: AnswerCreate,
    current=Depends(get_current_user),
):
    q = await db.product_questions.find_one(
        {"id": question_id}, {"_id": 0}
    )
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    product = await db.products.find_one(
        {"id": q["product_id"]}, {"_id": 0, "seller_id": 1, "name": 1}
    )
    is_seller = bool(product and product.get("seller_id") == current["id"])

    # Verified purchase = the answerer has any paid order containing this
    # product. Single query, cheap.
    is_verified = False
    if not is_seller:
        is_verified = bool(
            await db.orders.find_one(
                {
                    "user_id": current["id"],
                    "items.product_id": q["product_id"],
                    "payment_status": "paid",
                    "status": {"$nin": ["cancelled", "refunded"]},
                },
                {"_id": 0, "id": 1},
            )
        )

    aid = f"ans_{uuid.uuid4().hex[:12]}"
    doc = {
        "id": aid,
        "question_id": question_id,
        "product_id": q["product_id"],
        "user_id": current["id"],
        "user_name": current.get("full_name") or current.get("email", "").split("@")[0],
        "text": body.text.strip(),
        "created_at": now_utc(),
        "is_seller": is_seller,
        "is_verified_purchase": is_verified,
        "helpful_count": 0,
        "helpful_user_ids": [],
    }
    await db.product_answers.insert_one(doc)

    # Increment the question's answer_count.
    await db.product_questions.update_one(
        {"id": question_id}, {"$inc": {"answer_count": 1}}
    )

    # Notify the question's asker (unless they're answering themselves).
    if q.get("user_id") and q["user_id"] != current["id"]:
        try:
            await create_notification(
                user_id=q["user_id"],
                role="buyer",
                n_type="qa_new_answer",
                title="Your question was answered",
                body=(
                    f"{doc['user_name']} replied: \"{doc['text'][:80]}\""
                ),
            )
        except Exception:  # noqa: BLE001
            pass

    return await _serialize_answer(doc, current_uid=current["id"])


@router.post("/answers/{answer_id}/helpful")
async def vote_answer_helpful(
    answer_id: str,
    body: VotePayload,
    current=Depends(get_current_user),
):
    a = await db.product_answers.find_one(
        {"id": answer_id}, {"_id": 0}
    )
    if not a:
        raise HTTPException(status_code=404, detail="Answer not found")

    helpful = current["id"] in (a.get("helpful_user_ids") or [])
    if body.direction == "up" and not helpful:
        await db.product_answers.update_one(
            {"id": answer_id},
            {
                "$addToSet": {"helpful_user_ids": current["id"]},
                "$inc": {"helpful_count": 1},
            },
        )
        a["helpful_count"] = a.get("helpful_count", 0) + 1
        a.setdefault("helpful_user_ids", []).append(current["id"])
    elif body.direction == "clear" and helpful:
        await db.product_answers.update_one(
            {"id": answer_id},
            {
                "$pull": {"helpful_user_ids": current["id"]},
                "$inc": {"helpful_count": -1},
            },
        )
        a["helpful_count"] = max(0, a.get("helpful_count", 0) - 1)
        a["helpful_user_ids"] = [
            u for u in (a.get("helpful_user_ids") or []) if u != current["id"]
        ]

    return await _serialize_answer(a, current_uid=current["id"])
