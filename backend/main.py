from __future__ import annotations

import json
import os
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
    payment_method: Literal["card", "cash", "paypal"] = "card"


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


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/products")
def list_products() -> dict:
    return {"products": PRODUCTS}


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
        "payment_method": order.payment_method,
        "items": normalized_items,
        "subtotal": round(subtotal, 2),
        "tax": tax,
        "total": total,
        "currency": "USD",
        "status": "created",
    }

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
