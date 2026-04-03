import cors from "cors";
import express from "express";
import "dotenv/config";
import nodemailer from "nodemailer";
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

const SHIPPING_COST = 2.00;

function buildPurchaseUnit(cart) {
    const normalizedCart = normalizeCart(cart);
    if (normalizedCart.length === 0) {
        throw new Error("Cart is empty.");
    }

    const subtotal = normalizedCart.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0
    );

    const total = subtotal + SHIPPING_COST;

    return {
        amount: {
            currencyCode: "USD",
            value: money(total),
            breakdown: {
                itemTotal: {
                    currencyCode: "USD",
                    value: money(subtotal),
                },
                shipping: {
                    currencyCode: "USD",
                    value: money(SHIPPING_COST),
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

async function createOrder(cart, customer) {
    ensurePaypalConfigured();

    const purchaseUnit = buildPurchaseUnit(cart);

    // Attach shipping address if customer info is provided
    if (customer?.name && customer?.address) {
        const nameParts = customer.name.trim().split(/\s+/);
        const givenName = nameParts[0] || '';
        const surname = nameParts.slice(1).join(' ') || givenName;

        purchaseUnit.shipping = {
            name: { fullName: customer.name },
            address: {
                addressLine1: customer.address,
                adminArea2: customer.city || '',
                adminArea1: customer.state || '',
                postalCode: customer.zip || '',
                countryCode: 'US',
            },
        };
    }

    const collect = {
        body: {
            intent: "CAPTURE",
            purchaseUnits: [purchaseUnit],
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

app.get("/api/config", (_req, res) => {
    const configured = Boolean(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
    res.json({
        configured,
        clientId: configured ? PAYPAL_CLIENT_ID : null,
    });
});

app.post("/api/orders", async (req, res) => {
    try {
        const { cart, customer } = req.body;
        const { jsonResponse, httpStatusCode } = await createOrder(cart, customer);
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

// ── Email receipt ──────────────────────────────────────────────────────────────

const {
    SMTP_HOST = "",
    SMTP_PORT = "587",
    SMTP_USER = "",
    SMTP_PASS = "",
    SMTP_FROM = "",
} = process.env;

function isEmailConfigured() {
    return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function createTransporter() {
    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
        },
    });
}

function buildReceiptHtml(order, transactionId, customer) {
    const items = order?.items || [];
    const subtotal = order?.subtotal ?? 0;
    const tax = order?.tax ?? 0;
    const total = order?.total ?? 0;
    const orderId = order?.id || transactionId;
    const date = order?.created_at
        ? new Date(order.created_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
          })
        : new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
          });

    const itemRows = items
        .map(
            (item) => `
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${item.name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;text-align:center;">${item.quantity}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;text-align:right;">$${(item.unit_price * item.quantity).toFixed(2)}</td>
        </tr>`
        )
        .join("");

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:20px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
            <td style="background:linear-gradient(135deg,#1a2a3a,#2c4a6a);padding:30px 24px;text-align:center;">
                <h1 style="color:#ffffff;margin:0;font-size:24px;letter-spacing:1px;">SafeCharge</h1>
                <p style="color:#a0c4e8;margin:8px 0 0;font-size:14px;">Payment Receipt</p>
            </td>
        </tr>

        <!-- Order Info -->
        <tr>
            <td style="padding:24px;">
                <p style="margin:0 0 4px;color:#666;font-size:13px;">Order ID</p>
                <p style="margin:0 0 12px;color:#1a2a3a;font-size:16px;font-weight:bold;">${orderId}</p>
                <p style="margin:0 0 4px;color:#666;font-size:13px;">Date</p>
                <p style="margin:0 0 12px;color:#1a2a3a;font-size:16px;">${date}</p>
                <p style="margin:0 0 4px;color:#666;font-size:13px;">Transaction ID</p>
                <p style="margin:0 0 20px;color:#1a2a3a;font-size:14px;font-family:monospace;">${transactionId}</p>

                <!-- Shipping Address -->
                ${customer?.address ? `
                <div style="margin:0 0 20px;padding:14px 16px;background:#f8f9fa;border-radius:6px;border:1px solid #e0e0e0;">
                    <p style="margin:0 0 6px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Ship To</p>
                    <p style="margin:0;color:#1a2a3a;font-size:14px;line-height:1.5;">
                        ${customer.name || ""}<br>
                        ${customer.address}<br>
                        ${customer.city || ""}${customer.state ? `, ${customer.state}` : ""} ${customer.zip || ""}<br>
                        ${customer.phone ? `Phone: ${customer.phone}` : ""}
                    </p>
                </div>
                ` : ""}

                <!-- Items Table -->
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
                    <tr style="background:#f8f9fa;">
                        <th style="padding:10px 12px;text-align:left;font-size:13px;color:#555;border-bottom:2px solid #e0e0e0;">Item</th>
                        <th style="padding:10px 12px;text-align:center;font-size:13px;color:#555;border-bottom:2px solid #e0e0e0;">Qty</th>
                        <th style="padding:10px 12px;text-align:right;font-size:13px;color:#555;border-bottom:2px solid #e0e0e0;">Price</th>
                    </tr>
                    ${itemRows}
                    <tr>
                        <td colspan="2" style="padding:8px 12px;text-align:right;color:#666;">Subtotal</td>
                        <td style="padding:8px 12px;text-align:right;">$${subtotal.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="2" style="padding:8px 12px;text-align:right;color:#666;">Tax (8%)</td>
                        <td style="padding:8px 12px;text-align:right;">$${tax.toFixed(2)}</td>
                    </tr>
                    <tr style="background:#f8f9fa;">
                        <td colspan="2" style="padding:12px;text-align:right;font-weight:bold;font-size:16px;color:#1a2a3a;">Total</td>
                        <td style="padding:12px;text-align:right;font-weight:bold;font-size:16px;color:#1a2a3a;">$${total.toFixed(2)}</td>
                    </tr>
                </table>
            </td>
        </tr>

        <!-- Footer -->
        <tr>
            <td style="padding:20px 24px;background:#f8f9fa;text-align:center;border-top:1px solid #e0e0e0;">
                <p style="margin:0;color:#999;font-size:12px;">Thank you for your purchase!</p>
                <p style="margin:4px 0 0;color:#999;font-size:12px;">&copy; 2026 SafeCharge. All rights reserved.</p>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

app.post("/api/send-receipt", async (req, res) => {
    const { order, paypal_transaction_id, customer_email } = req.body;

    if (!customer_email) {
        return res.status(400).json({ error: "Missing customer email." });
    }

    if (!isEmailConfigured()) {
        console.log("SMTP not configured – skipping receipt email for:", customer_email);
        return res.json({ sent: false, reason: "SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env" });
    }

    try {
        const transporter = createTransporter();
        const customer = order?.customer || {};
        const html = buildReceiptHtml(order, paypal_transaction_id, customer);
        const orderId = order?.id || paypal_transaction_id;

        await transporter.sendMail({
            from: SMTP_FROM || SMTP_USER,
            to: customer_email,
            subject: `SafeCharge Receipt – Order ${orderId}`,
            html,
        });

        console.log(`Receipt email sent to ${customer_email} for order ${orderId}`);
        res.json({ sent: true });
    } catch (error) {
        console.error("Failed to send receipt email:", error.message);
        res.status(500).json({ error: "Failed to send receipt email." });
    }
});

// ── Orders list (proxy to backend or local) ───────────────────────────────────

app.get("/api/orders", async (_req, res) => {
    try {
        const response = await fetch("http://127.0.0.1:8000/api/orders");
        const data = await response.json();
        res.json(data);
    } catch (_error) {
        res.status(502).json({ error: "Could not reach the backend to fetch orders." });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`PayPal server listening at http://${HOST}:${PORT}/`);
    if (isEmailConfigured()) {
        console.log("📧 SMTP email configured – receipts will be sent.");
    } else {
        console.log("⚠️  SMTP not configured – receipt emails disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env");
    }
});
