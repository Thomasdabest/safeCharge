from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import MongoClient, DESCENDING

ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASS", "safecharge2026")
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "sc-secret-key-change-me")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017")
MONGO_DB = os.getenv("MONGO_DB", "safecharge")

PRODUCTS = [
    {
        "id": "lemonade",
        "name": "Tropical Lemonade",
        "description": "Carbonated lemonade Mako Energy Drink.",
        "price": 3.49,
        "currency": "USD",
        "in_stock": True,
    },
]

PRODUCT_INDEX = {product["id"]: product for product in PRODUCTS}


class OrderItemIn(BaseModel):
    product_id: str = Field(min_length=1)
    quantity: int = Field(ge=1, le=99)


class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    phone: str = Field(default="", max_length=30)
    address: str = Field(default="", max_length=300)
    city: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=50)
    zip: str = Field(default="", max_length=20)


class OrderIn(BaseModel):
    items: list[OrderItemIn] = Field(min_length=1)
    customer: CustomerIn
    payment_method: Literal["card", "cash", "paypal", "square"] = "card"
    source_id: str | None = Field(default=None, min_length=1)


class AdminLoginIn(BaseModel):
    username: str
    password: str


class FulfillmentUpdateIn(BaseModel):
    fulfillment_status: Literal["pending", "shipped", "delivered"]
    tracking_number: Optional[str] = None


app = FastAPI(title="SafeCharge Store API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Admin auth helpers ─────────────────────────────────────────────────────────

def _create_admin_token(username: str) -> str:
    ts = str(int(time.time()))
    payload = f"{username}.{ts}"
    sig = hmac.new(ADMIN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _verify_admin_token(token: str) -> bool:
    parts = token.split(".")
    if len(parts) != 3:
        return False
    username, ts, sig = parts
    try:
        token_time = int(ts)
    except ValueError:
        return False
    if time.time() - token_time > 86400:
        return False
    expected_payload = f"{username}.{ts}"
    expected_sig = hmac.new(ADMIN_SECRET.encode(), expected_payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected_sig)


def _require_admin(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required.")
    token = authorization[7:]
    if not _verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired admin token.")


# ── MongoDB helpers ───────────────────────────────────────────────────────────

mongo_client: MongoClient = None
db = None


def _get_db():
    return db


def _clean_doc(doc: dict) -> dict:
    """Remove MongoDB's internal _id field before returning."""
    doc.pop("_id", None)
    return doc


# ── Square helpers ─────────────────────────────────────────────────────────────

def _square_config() -> dict:
    environment = os.getenv("SQUARE_ENVIRONMENT", "sandbox").strip().lower() or "sandbox"
    application_id = os.getenv("SQUARE_APPLICATION_ID", "").strip()
    access_token = os.getenv("SQUARE_ACCESS_TOKEN", "").strip()
    location_id = os.getenv("SQUARE_LOCATION_ID", "").strip()
    enabled = bool(application_id and access_token and location_id)

    return {
        "enabled": enabled,
        "environment": environment,
        "application_id": application_id,
        "access_token": access_token,
        "location_id": location_id,
    }


def _square_base_url(environment: str) -> str:
    if environment == "production":
        return "https://connect.squareup.com"
    return "https://connect.squareupsandbox.com"


def _square_script_url(environment: str) -> str:
    if environment == "production":
        return "https://web.squarecdn.com/v1/square.js"
    return "https://sandbox.web.squarecdn.com/v1/square.js"


def _square_money_amount(amount: float) -> int:
    return int(round(amount * 100))


def _create_square_payment(order_record: dict, order: OrderIn, total: float) -> dict:
    config = _square_config()
    if not config["enabled"]:
        raise HTTPException(status_code=503, detail="Square is not configured on the server.")

    if not order.source_id:
        raise HTTPException(status_code=400, detail="Square payment token missing.")

    payload = {
        "idempotency_key": str(uuid4()),
        "source_id": order.source_id,
        "location_id": config["location_id"],
        "amount_money": {
            "amount": _square_money_amount(total),
            "currency": "USD",
        },
        "autocomplete": True,
        "reference_id": order_record["id"],
        "note": f"SafeCharge order {order_record['id']}",
    }

    request = urllib.request.Request(
        url=f"{_square_base_url(config['environment'])}/v2/payments",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {config['access_token']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Square-Version": "2026-01-22",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            error_data = json.loads(raw)
        except json.JSONDecodeError:
            error_data = {}

        errors = error_data.get("errors") or []
        if errors:
            detail = errors[0].get("detail") or errors[0].get("code") or "Square payment failed."
        else:
            detail = "Square payment failed."

        raise HTTPException(status_code=400, detail=detail) from error
    except urllib.error.URLError as error:
        raise HTTPException(status_code=502, detail="Unable to reach Square.") from error

    payment = data.get("payment")
    if not isinstance(payment, dict) or not payment.get("id"):
        raise HTTPException(status_code=502, detail="Square returned an invalid payment response.")

    return payment


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    global mongo_client, db
    mongo_client = MongoClient(MONGO_URI)
    db = mongo_client[MONGO_DB]
    # Create index on created_at for efficient sorting
    db.orders.create_index([("created_at", DESCENDING)])
    print(f"Connected to MongoDB database '{MONGO_DB}' at {MONGO_URI}")


@app.on_event("shutdown")
def on_shutdown():
    global mongo_client
    if mongo_client:
        mongo_client.close()


# ── Public endpoints ───────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/products")
def list_products() -> dict:
    return {"products": PRODUCTS}


@app.get("/api/payments/config")
def payment_config() -> dict:
    config = _square_config()
    return {
        "square": {
            "enabled": config["enabled"],
            "application_id": config["application_id"] if config["enabled"] else "",
            "location_id": config["location_id"] if config["enabled"] else "",
            "environment": config["environment"],
            "script_url": _square_script_url(config["environment"]),
        }
    }


@app.post("/api/orders")
def create_order(order: OrderIn) -> dict:
    normalized_items = []
    subtotal = 0.0

    for item in order.items:
        product = PRODUCT_INDEX.get(item.product_id)
        if product is None:
            raise HTTPException(status_code=400, detail=f"Unknown product_id: {item.product_id}")

        line_total = product["price"] * item.quantity
        subtotal += line_total
        normalized_items.append(
            {
                "product_id": product["id"],
                "name": product["name"],
                "unit_price": product["price"],
                "quantity": item.quantity,
                "line_total": round(line_total, 2),
            }
        )

    tax = round(subtotal * 0.08, 2)
    total = round(subtotal + tax, 2)

    order_record = {
        "id": f"ord_{uuid4().hex[:10]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "customer": {
            "name": order.customer.name,
            "email": order.customer.email,
            "phone": order.customer.phone,
            "address": order.customer.address,
            "city": order.customer.city,
            "state": order.customer.state,
            "zip": order.customer.zip,
        },
        "payment_method": order.payment_method,
        "source_id": order.source_id,
        "items": normalized_items,
        "subtotal": round(subtotal, 2),
        "tax": tax,
        "total": total,
        "currency": "USD",
        "status": "created",
        "fulfillment_status": "pending",
        "tracking_number": "",
    }

    if order.payment_method == "square":
        square_payment = _create_square_payment(order_record, order, total)
        order_record["status"] = square_payment.get("status", "COMPLETED").lower()
        order_record["square_payment_id"] = square_payment.get("id")
        order_record["receipt_url"] = square_payment.get("receipt_url")

    _get_db().orders.insert_one(order_record)

    # Remove _id before returning (MongoDB adds it on insert)
    order_record.pop("_id", None)

    return {
        "message": "Order created",
        "order": order_record,
    }


# ── Admin endpoints ────────────────────────────────────────────────────────────

@app.post("/api/admin/login")
def admin_login(body: AdminLoginIn) -> dict:
    if body.username != ADMIN_USER or body.password != ADMIN_PASS:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = _create_admin_token(body.username)
    return {"token": token, "message": "Login successful."}


@app.get("/api/admin/orders")
def admin_list_orders(authorization: str | None = Header(default=None)) -> dict:
    _require_admin(authorization)
    orders = list(_get_db().orders.find({}, {"_id": 0}).sort("created_at", DESCENDING))
    return {"orders": orders}


@app.patch("/api/admin/orders/{order_id}")
def admin_update_order(
    order_id: str,
    body: FulfillmentUpdateIn,
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin(authorization)

    update_fields = {"fulfillment_status": body.fulfillment_status}
    if body.tracking_number is not None:
        update_fields["tracking_number"] = body.tracking_number

    result = _get_db().orders.find_one_and_update(
        {"id": order_id},
        {"$set": update_fields},
        return_document=True,
    )

    if result is None:
        raise HTTPException(status_code=404, detail=f"Order not found: {order_id}")

    return {"message": "Order updated", "order": _clean_doc(result)}


@app.get("/api/orders")
def list_orders() -> dict:
    orders = list(_get_db().orders.find({}, {"_id": 0}).sort("created_at", DESCENDING))
    return {"orders": orders}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
