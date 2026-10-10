"""Stripe REST Checkout + verified webhook events with idempotent credit fulfillment.

No direct trust in success URLs, checkout IDs or client-provided amounts.
"""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode
from uuid import uuid4
import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import settings
from app.models import Order, Subscription, StripeEvent, User, RevenueEvent, now
from app.wallet import adjust_credits

PACKS = {
    "spark": {"name": "Spark · 入门包", "price": 490, "credits": 20, "kind": "pack"},
    "creator": {"name": "Creator · 创作包", "price": 990, "credits": 50, "kind": "pack"},
    "studio": {"name": "Studio · 工作室包", "price": 1990, "credits": 110, "kind": "pack"},
    "monthly_basic": {"name": "Basic · 月订阅", "price": 990, "credits": 50, "kind": "subscription"},
    "monthly_pro": {"name": "Pro · 月订阅", "price": 1990, "credits": 120, "kind": "subscription"},
}


def verify_signature(payload: bytes, header: str, secret: str, timestamp: int | None = None) -> dict:
    # https://docs.stripe.com/webhooks/signature
    fields = [x.strip().split("=", 1) for x in header.split(",") if "=" in x]
    ts_list = [v for k, v in fields if k == "t"]
    signatures = [v for k, v in fields if k == "v1"]
    if not ts_list or not signatures:
        raise HTTPException(400, "Stripe 签名缺失")
    try:
        ts = int(ts_list[0])
    except ValueError:
        raise HTTPException(400, "Stripe 时间戳无效")
    actual_now = int(time.time()) if timestamp is None else timestamp
    if abs(actual_now - ts) > 300:
        raise HTTPException(400, "Stripe 事件已过期")
    expected = hmac.new(secret.encode(), f"{ts}.".encode()+payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, sig) for sig in signatures):
        raise HTTPException(400, "Stripe 签名不匹配")
    try:
        obj = json.loads(payload)
    except ValueError:
        raise HTTPException(400, "Stripe 请求内容无效")
    if not isinstance(obj, dict) or not obj.get("id") or not obj.get("type"):
        raise HTTPException(400, "Stripe 事件结构无效")
    return obj


def stripe_request(method: str, path: str, data: list[tuple[str, str]] | None = None) -> dict:
    if not settings.stripe_key:
        raise HTTPException(503, "请先设置 Stripe 密钥")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    with httpx.Client(timeout=20, auth=(settings.stripe_key, "")) as client:
        response = client.request(method, "https://api.stripe.com/v1/"+path,
                                  headers=headers, content=urlencode(data or []) if method == "POST" else None)
    if response.status_code >= 400:
        raise HTTPException(502, "Stripe API 调用失败（请检查后台日志或密钥权限）")
    return response.json()


def create_checkout(db: Session, user: User, product_id: str) -> str:
    item = PACKS.get(product_id)
    if not item:
        raise HTTPException(400, "无效商品")
    if not settings.stripe_enabled:
        raise HTTPException(503, "尚未启用真实支付：请配置 Stripe Secret 和 Webhook Secret")
    order = Order(id="ord_"+uuid4().hex[:24], user_id=user.id, product_id=product_id,
                  amount_cents=item["price"], credits=item["credits"], kind=item["kind"])
    db.add(order)
    db.commit()
    recurring = item["kind"] == "subscription"
    data = [
        ("mode", "subscription" if recurring else "payment"),
        ("success_url", settings.base_url + "/?payment=success"),
        ("cancel_url", settings.base_url + "/?payment=cancel"),
        ("client_reference_id", str(user.id)),
        ("line_items[0][quantity]", "1"),
        ("payment_method_types[0]", "card"),
        ("line_items[0][price_data][currency]", "usd"),
        ("line_items[0][price_data][unit_amount]", str(item["price"])),
        ("line_items[0][price_data][product_data][name]", "TrendMint " + item["name"]),
        ("metadata[order_id]", order.id),
        ("metadata[user_id]", str(user.id)),
        ("metadata[product_id]", product_id),
    ]
    data.append(("customer", user.stripe_customer_id) if user.stripe_customer_id else ("customer_email", user.email))
    if recurring:
        data.extend([("line_items[0][price_data][recurring][interval]", "month"),
                     ("subscription_data[metadata][user_id]", str(user.id)),
                     ("subscription_data[metadata][plan_id]", product_id)])
    result = stripe_request("POST", "checkout/sessions", data)
    order.checkout_id = result.get("id")
    db.commit()
    url = result.get("url")
    if not url or not url.startswith("https://checkout.stripe.com/"):
        raise HTTPException(502, "Stripe 没有返回正确的付款地址")
    return url


def _sub_id_from_invoice(obj: dict) -> str | None:
    val = obj.get("subscription")
    if isinstance(val, str) and val.startswith("sub_"):
        return val
    parent = obj.get("parent") or {}
    subs = parent.get("subscription_details") or {}
    if isinstance(subs.get("subscription"), str):
        return subs["subscription"]
    for line in (obj.get("lines") or {}).get("data", []):
        parent2 = (line.get("parent") or {}).get("subscription_item_details") or {}
        if parent2.get("subscription"):
            return parent2["subscription"]
    return None


def _upsert_subscription(db: Session, sub_id: str, user_id: int, plan_id: str, status: str) -> None:
    record = db.scalar(select(Subscription).where(Subscription.stripe_id == sub_id))
    if not record:
        db.add(Subscription(stripe_id=sub_id, user_id=user_id, plan_id=plan_id, status=status))
    else:
        record.status = status
        record.plan_id = plan_id


def process_stripe_event(db: Session, event: dict) -> str:
    """Handles one event as a DB transaction. Stripe retries safely deduplicate by event id + ledger ref."""
    event_id, kind = event["id"], event["type"]
    if db.get(StripeEvent, event_id):
        return "duplicate"
    obj = (event.get("data") or {}).get("object") or {}
    if kind in {"checkout.session.completed", "checkout.session.async_payment_succeeded"} and obj.get("payment_status") == "paid":
        metadata = obj.get("metadata") or {}
        order = db.get(Order, metadata.get("order_id", ""))
        if order and order.user_id == int(metadata.get("user_id") or -1):
            customer_id = obj.get("customer")
            if isinstance(customer_id, str) and customer_id.startswith("cus_"):
                customer = db.get(User, order.user_id)
                if customer and (customer.stripe_customer_id in (None, customer_id)):
                    customer.stripe_customer_id = customer_id
            if obj.get("mode") == "payment" and order.kind == "pack" and order.status != "paid":
                adjust_credits(db, order.user_id, order.credits, "积分包付款", f"order:{order.id}")
                order.status = "paid"
                order.paid_at = now()
                db.add(RevenueEvent(user_id=order.user_id, cents=order.amount_cents, kind="pack", ref="order:"+order.id))
            elif obj.get("mode") == "subscription" and order.kind == "subscription":
                sub_id = obj.get("subscription")
                if sub_id:
                    _upsert_subscription(db, sub_id, order.user_id, order.product_id, "active")
                    order.status = "paid"
                    order.paid_at = now()
                # Credits arrive ONLY from invoice.paid, including initial invoice.
    elif kind == "invoice.paid":
        sub_id = _sub_id_from_invoice(obj)
        sub = db.scalar(select(Subscription).where(Subscription.stripe_id == sub_id)) if sub_id else None
        if sub is None and sub_id and settings.stripe_key:
            remote = stripe_request("GET", "subscriptions/"+sub_id)
            metadata = remote.get("metadata") or {}
            uid, plan = metadata.get("user_id"), metadata.get("plan_id")
            if uid and plan in PACKS and PACKS[plan]["kind"] == "subscription":
                user = db.get(User, int(uid))
                if user:
                    _upsert_subscription(db, sub_id, user.id, plan, remote.get("status", "active"))
                    db.flush()
                    sub = db.scalar(select(Subscription).where(Subscription.stripe_id == sub_id))
        invoice_ref = "invoice:" + str(obj.get("id", ""))
        # Different Stripe event IDs may refer to the SAME paid invoice.
        # Never double-grant or double-count revenue for an invoice.
        previously_settled = db.scalar(select(RevenueEvent.id).where(RevenueEvent.ref == invoice_ref))
        if (sub and obj.get("paid") is True and int(obj.get("amount_paid") or 0) > 0
                and PACKS.get(sub.plan_id, {}).get("kind") == "subscription" and not previously_settled):
            newly_granted = adjust_credits(db, sub.user_id, PACKS[sub.plan_id]["credits"], "订阅月度积分", invoice_ref)
            if newly_granted:
                sub.status = "active"
                db.add(RevenueEvent(user_id=sub.user_id, cents=int(obj["amount_paid"]), kind="subscription", ref=invoice_ref))
    elif kind in {"customer.subscription.deleted", "customer.subscription.updated"}:
        sub_id = obj.get("id", "")
        sub = db.scalar(select(Subscription).where(Subscription.stripe_id == sub_id))
        if sub:
            sub.status = obj.get("status", "canceled")
    elif kind == "invoice.payment_failed":
        sub_id = _sub_id_from_invoice(obj)
        sub = db.scalar(select(Subscription).where(Subscription.stripe_id == sub_id)) if sub_id else None
        if sub:
            sub.status = "past_due"
    db.add(StripeEvent(id=event_id, type=kind))
    db.commit()
    return "processed"


def create_portal(user: User) -> str:
    if not settings.stripe_enabled:
        raise HTTPException(503, "Stripe 未配置")
    if not user.stripe_customer_id:
        raise HTTPException(400, "当前账号还没有 Stripe 付款客户记录")
    response = stripe_request("POST", "billing_portal/sessions",
                              [("customer", user.stripe_customer_id), ("return_url", settings.base_url + "/billing")])
    url = response.get("url", "")
    if not url.startswith("https://billing.stripe.com/"):
        raise HTTPException(502, "Stripe 未返回有效的订阅管理地址")
    return url
