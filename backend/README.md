# SafeCharge Backend (Python)

This backend powers the online store for `frontend/pages/shop.html`.

## Features
- `GET /health` health check
- `GET /api/products` product catalog
- `POST /api/orders` create order from cart + customer info
- `GET /api/orders` list saved orders

Orders are saved to `backend/data/orders.json`.

## Run
1. Create and activate a virtual environment.
2. Install dependencies.
3. Start the API server.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

You can also run it directly:

```bash
cd backend
python3 main.py
```

Then open the frontend and use the Shop page. The frontend calls:
- `http://127.0.0.1:8000/api/products`
- `http://127.0.0.1:8000/api/orders`
