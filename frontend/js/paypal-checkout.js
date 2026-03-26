(function () {
    const STORAGE_KEY = 'safecharge_cart_v2';
    const PAYPAL_API_BASE = 'http://127.0.0.1:8080';

    const cartList = document.getElementById('paypal-cart-items');
    const cartEmpty = document.getElementById('paypal-cart-empty');
    const cartTotal = document.getElementById('paypal-cart-total');
    const result = document.getElementById('result-message');
    const buttonContainer = document.getElementById('paypal-button-container');

    function normalizeCart(rawItems) {
        if (!Array.isArray(rawItems)) {
            return [];
        }

        return rawItems.reduce((items, item) => {
            if (!item || typeof item !== 'object') {
                return items;
            }

            const productId = String(item.product_id || item.id || '').trim();
            const quantity = Number.parseInt(item.quantity, 10);
            const unitPrice = Number(item.unit_price);
            const name = String(item.name || productId).trim();

            if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
                return items;
            }

            items.push({
                product_id: productId,
                name: name || productId,
                quantity: Math.min(quantity, 99),
                unit_price: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0
            });

            return items;
        }, []);
    }

    function readCart() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
            return [];
        }

        try {
            return normalizeCart(JSON.parse(saved));
        } catch (_error) {
            return [];
        }
    }

    function formatPrice(value) {
        return `$${Number(value).toFixed(2)}`;
    }

    function setResult(message, isError) {
        if (!result) {
            return;
        }

        result.textContent = message;
        result.dataset.error = isError ? 'true' : 'false';
    }

    function getSubtotal(cart) {
        return cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    }

    function renderCart(cart) {
        if (!cartList || !cartEmpty || !cartTotal) {
            return;
        }

        cartList.innerHTML = '';
        cartTotal.textContent = formatPrice(getSubtotal(cart));

        if (cart.length === 0) {
            cartEmpty.hidden = false;
            return;
        }

        cartEmpty.hidden = true;

        cart.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'cart-item';
            li.innerHTML = `
                <div>
                    <p class="cart-item-name">${item.name}</p>
                    <p class="cart-item-meta">${formatPrice(item.unit_price)} x ${item.quantity}</p>
                </div>
                <strong>${formatPrice(item.unit_price * item.quantity)}</strong>
            `;
            cartList.appendChild(li);
        });
    }

    async function createOrder(cart) {
        const response = await fetch(`${PAYPAL_API_BASE}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cart })
        });

        const orderData = await response.json().catch(() => ({}));
        if (response.ok && orderData.id) {
            return orderData.id;
        }

        const errorDetail = orderData?.details?.[0];
        const errorMessage = errorDetail
            ? `${errorDetail.issue} ${errorDetail.description}`
            : orderData?.error || 'Could not create the PayPal order.';
        throw new Error(errorMessage);
    }

    async function captureOrder(orderId) {
        const response = await fetch(`${PAYPAL_API_BASE}/api/orders/${orderId}/capture`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const orderData = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(orderData?.error || 'Could not capture the PayPal order.');
        }

        return orderData;
    }

    function initPaypalButtons(cart) {
        if (!buttonContainer) {
            return;
        }

        if (!window.paypal || typeof window.paypal.Buttons !== 'function') {
            setResult('The PayPal SDK did not load.', true);
            return;
        }

        if (cart.length === 0) {
            buttonContainer.hidden = true;
            setResult('Add items to your cart before using PayPal checkout.', true);
            return;
        }

        buttonContainer.hidden = false;

        window.paypal.Buttons({
            style: {
                shape: 'rect',
                layout: 'vertical',
                color: 'gold',
                label: 'paypal'
            },
            async createOrder() {
                setResult('', false);
                return createOrder(cart);
            },
            async onApprove(data, actions) {
                try {
                    const orderData = await captureOrder(data.orderID);
                    const errorDetail = orderData?.details?.[0];

                    if (errorDetail?.issue === 'INSTRUMENT_DECLINED') {
                        return actions.restart();
                    }

                    if (errorDetail) {
                        throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
                    }

                    const transaction =
                        orderData?.purchase_units?.[0]?.payments?.captures?.[0] ||
                        orderData?.purchase_units?.[0]?.payments?.authorizations?.[0];

                    if (!transaction) {
                        throw new Error('PayPal returned an incomplete capture response.');
                    }

                    localStorage.removeItem(STORAGE_KEY);
                    renderCart([]);
                    buttonContainer.hidden = true;
                    setResult(`Transaction ${transaction.status}: ${transaction.id}`, false);
                } catch (error) {
                    setResult(error.message || 'Sorry, your transaction could not be processed.', true);
                }
            },
            onError(error) {
                setResult(error.message || 'Sorry, your transaction could not be processed.', true);
            }
        }).render('#paypal-button-container');
    }

    const cart = readCart();
    renderCart(cart);
    initPaypalButtons(cart);
})();
