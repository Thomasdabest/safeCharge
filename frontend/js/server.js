import cors from "cors";
import express from "express";
import "dotenv/config";
import {
    ApiError,
    Client,
    Environment,
    LogLevel,
    OrdersController,
} from "@paypal/paypal-server-sdk";

const app = express();
app.use(cors());
app.use(express.json());

const {
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
    HOST = "127.0.0.1",
    PORT = 8080,
} = process.env;

const client = new Client({
    clientCredentialsAuthCredentials: {
        oAuthClientId: PAYPAL_CLIENT_ID,
        oAuthClientSecret: PAYPAL_CLIENT_SECRET,
    },
    timeout: 0,
    environment: Environment.Sandbox,
    logging: {
        logLevel: LogLevel.Info,
        logRequest: { logBody: true },
        logResponse: { logHeaders: true },
    },
});

const ordersController = new OrdersController(client);

function ensurePaypalConfigured() {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        throw new Error(
            "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before starting npm run paypal-server."
        );
    }
}

function formatApiError(error) {
    const details = error?.result?.details;
    if (Array.isArray(details) && details.length > 0) {
        const first = details[0];
        const issue = first?.issue ? `${first.issue}: ` : "";
        const description = first?.description || "PayPal request failed.";
        return `${issue}${description}`;
    }

    if (typeof error?.body === "string" && error.body.trim()) {
        try {
            const parsed = JSON.parse(error.body);
            const parsedDetails = parsed?.details;
            if (Array.isArray(parsedDetails) && parsedDetails.length > 0) {
                const first = parsedDetails[0];
                const issue = first?.issue ? `${first.issue}: ` : "";
                const description = first?.description || "PayPal request failed.";
                return `${issue}${description}`;
            }
        } catch (_parseError) {
            return error.body;
        }
    }

    if (error?.message) {
        return error.message;
    }

    return "PayPal request failed.";
}

function normalizeCart(rawCart) {
    if (!Array.isArray(rawCart)) {
        return [];
    }

    return rawCart.reduce((items, item) => {
        if (!item || typeof item !== "object") {
            return items;
        }

        const id = String(item.product_id || item.id || "").trim();
        const name = String(item.name || id).trim();
        const quantity = Number.parseInt(item.quantity, 10);
        const unitPrice = Number(item.unit_price);

        if (!id || !Number.isFinite(quantity) || quantity <= 0) {
            return items;
        }

        items.push({
            id,
            name: name || id,
            quantity: Math.min(quantity, 99),
            unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
        });

        return items;
    }, []);
}

function money(value) {
    return value.toFixed(2);
}

function buildPurchaseUnit(cart) {
    const normalizedCart = normalizeCart(cart);
    if (normalizedCart.length === 0) {
        throw new Error("Cart is empty.");
    }

    const subtotal = normalizedCart.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0
    );

    return {
        amount: {
            currencyCode: "USD",
            value: money(subtotal),
            breakdown: {
                itemTotal: {
                    currencyCode: "USD",
                    value: money(subtotal),
                },
            },
        },
        items: normalizedCart.map((item) => ({
            name: item.name,
            unitAmount: {
                currencyCode: "USD",
                value: money(item.unitPrice),
            },
            quantity: String(item.quantity),
            description: `SafeCharge item ${item.id}`,
            sku: item.id,
        })),
    };
}

async function createOrder(cart) {
    ensurePaypalConfigured();

    const collect = {
        body: {
            intent: "CAPTURE",
            purchaseUnits: [buildPurchaseUnit(cart)],
        },
        prefer: "return=minimal",
    };

    try {
        const { body, ...httpResponse } = await ordersController.createOrder(collect);
        return {
            jsonResponse: JSON.parse(body),
            httpStatusCode: httpResponse.statusCode,
        };
    } catch (error) {
        if (error instanceof ApiError) {
            throw new Error(formatApiError(error));
        }

        throw error;
    }
}

async function captureOrder(orderID) {
    ensurePaypalConfigured();

    const collect = {
        id: orderID,
        prefer: "return=minimal",
    };

    try {
        const { body, ...httpResponse } = await ordersController.captureOrder(collect);
        return {
            jsonResponse: JSON.parse(body),
            httpStatusCode: httpResponse.statusCode,
        };
    } catch (error) {
        if (error instanceof ApiError) {
            throw new Error(formatApiError(error));
        }

        throw error;
    }
}

app.get("/health", (_req, res) => {
    res.json({ ok: true });
});

app.post("/api/orders", async (req, res) => {
    try {
        const { cart } = req.body;
        const { jsonResponse, httpStatusCode } = await createOrder(cart);
        res.status(httpStatusCode).json(jsonResponse);
    } catch (error) {
        console.error("Failed to create order:", error);
        res.status(500).json({ error: error.message || "Failed to create order." });
    }
});

app.post("/api/orders/:orderID/capture", async (req, res) => {
    try {
        const { orderID } = req.params;
        const { jsonResponse, httpStatusCode } = await captureOrder(orderID);
        res.status(httpStatusCode).json(jsonResponse);
    } catch (error) {
        console.error("Failed to capture order:", error);
        res.status(500).json({ error: error.message || "Failed to capture order." });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`PayPal server listening at http://${HOST}:${PORT}/`);
});
