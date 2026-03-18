from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ORDERS_FILE = DATA_DIR / "orders.json"

PRODUCTS = [
    {
        "id": "original-charge",
        "name": "Original Charge",
        "description": "Crisp citrus blend with fast clean energy.",
        "price": 3.49,
        "currency": "USD",
        "in_stock": True,
    },
    {
        "id": "berry-surge",
        "name": "Berry Surge",
        "description": "Berry flavor with electrolytes and zero crash.",
        "price": 3.99,
        "currency": "USD",
        "in_stock": True,
    },
    {
        "id": "tropical-bolt",
        "name": "Tropical Bolt",
        "description": "Tropical fruit blend for all-day focus.",
        "price": 4.29,
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


class OrderIn(BaseModel):
    items: list[OrderItemIn] = Field(min_length=1)
    customer: CustomerIn
    payment_method: Literal["card", "cash", "paypal", "square"] = "card"
    source_id: str | None = Field(default=None, min_length=1)


app = FastAPI(title="SafeCharge Store API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_orders_file() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not ORDERS_FILE.exists():
        ORDERS_FILE.write_text("[]", encoding="utf-8")


def _read_orders() -> list[dict]:
    _ensure_orders_file()
    try:
        with ORDERS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError:
        _write_orders([])
        return []

    return data if isinstance(data, list) else []


def _write_orders(orders: list[dict]) -> None:
    _ensure_orders_file()
    with ORDERS_FILE.open("w", encoding="utf-8") as f:
        json.dump(orders, f, indent=2)


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
        },
        "payment_method": order.payment_method,
        "items": normalized_items,
        "subtotal": round(subtotal, 2),
        "tax": tax,
        "total": total,
        "currency": "USD",
        "status": "created",
    }

    if order.payment_method == "square":
        square_payment = _create_square_payment(order_record, order, total)
        order_record["status"] = square_payment.get("status", "COMPLETED").lower()
        order_record["square_payment_id"] = square_payment.get("id")
        order_record["receipt_url"] = square_payment.get("receipt_url")

    orders = _read_orders()
    orders.append(order_record)
    _write_orders(orders)

    return {
        "message": "Order created",
        "order": order_record,
    }


@app.get("/api/orders")
def list_orders() -> dict:
    return {"orders": _read_orders()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
