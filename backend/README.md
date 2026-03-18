# SafeCharge Backend (Python)

This backend powers the online store for `frontend/pages/shop.html`.

## Features
- `GET /health` health check
- `GET /api/products` product catalog
- `GET /api/payments/config` public payment configuration for checkout
- `POST /api/orders` create order from cart + customer info
- `GET /api/orders` list saved orders

Orders are saved to `backend/data/orders.json`.

## Square setup
To process real card payments with your own Square account, copy `backend/.env.example` and set:

- `SQUARE_ENVIRONMENT=sandbox` for testing or `production` for live charges
- `SQUARE_APPLICATION_ID`
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`

These values come from your Square Developer Console for the same seller account you want payments deposited into. Once those variables are set and the backend is restarted, the cart page will enable the Square card form automatically.

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
