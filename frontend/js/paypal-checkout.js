(function () {
    const STORAGE_KEY = 'safecharge_cart_v2';
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const PAYPAL_API_BASE = isLocal ? 'http://127.0.0.1:8080' : 'https://safecharge-paypal.up.railway.app';
    const BACKEND_API_BASE = isLocal ? 'http://127.0.0.1:8000' : 'https://safecharge-backend.up.railway.app';
    const SHIPPING_COST = 2.00;

    const cartList = document.getElementById('paypal-cart-items');
    const cartEmpty = document.getElementById('paypal-cart-empty');
    const cartTotal = document.getElementById('paypal-cart-total');
    const result = document.getElementById('result-message');
    const buttonContainer = document.getElementById('paypal-button-container');
    const cardForm = document.getElementById('card-form');
    const cardSubmit = document.getElementById('card-submit');
    const customerInfoForm = document.getElementById('customer-info-form');
    const orderConfirmation = document.getElementById('order-confirmation');
    const confirmationMessage = document.getElementById('confirmation-message');
    const confirmationDetails = document.getElementById('confirmation-details');
    const confirmationEmail = document.getElementById('confirmation-email');
    const summaryOrderTotal = document.getElementById('summary-order-total');
    const cardNameInput = document.getElementById('card-name-input');

    // Progress step helpers
    function setProgressStep(step) {
        document.querySelectorAll('.progress-step').forEach((el) => {
            const s = Number(el.dataset.step);
            el.classList.toggle('active', s <= step);
        });
        document.querySelectorAll('.progress-connector').forEach((el, i) => {
            el.classList.toggle('active', i < step - 1);
        });
    }

    // Customer input elements
    const customerNameInput = document.getElementById('customer-name');
    const customerEmailInput = document.getElementById('customer-email');
    const customerPhoneInput = document.getElementById('customer-phone');
    const customerAddressInput = document.getElementById('customer-address');
    const customerCityInput = document.getElementById('customer-city');
    const customerStateInput = document.getElementById('customer-state');
    const customerZipInput = document.getElementById('customer-zip');

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

        result.hidden = false;
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
        const subtotal = getSubtotal(cart);
        cartTotal.textContent = formatPrice(subtotal);
        if (summaryOrderTotal) {
            const orderTotal = cart.length > 0 ? subtotal + SHIPPING_COST : 0;
            summaryOrderTotal.textContent = formatPrice(orderTotal);
        }

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

    function getCustomerInfo() {
        return {
            name: (customerNameInput?.value || '').trim(),
            email: (customerEmailInput?.value || '').trim(),
            phone: (customerPhoneInput?.value || '').trim(),
            address: (customerAddressInput?.value || '').trim(),
            city: (customerCityInput?.value || '').trim(),
            state: (customerStateInput?.value || '').trim(),
            zip: (customerZipInput?.value || '').trim(),
        };
    }

    function validateCustomerInfo() {
        const info = getCustomerInfo();

        if (!info.name) {
            setResult('Please enter your full name.', true);
            customerNameInput?.focus();
            return false;
        }

        if (!info.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) {
            setResult('Please enter a valid email address.', true);
            customerEmailInput?.focus();
            return false;
        }

        if (!info.phone || info.phone.replace(/\D/g, '').length < 7) {
            setResult('Please enter a valid phone number.', true);
            customerPhoneInput?.focus();
            return false;
        }

        if (!info.address) {
            setResult('Please enter your street address.', true);
            customerAddressInput?.focus();
            return false;
        }

        if (!info.city) {
            setResult('Please enter your city.', true);
            customerCityInput?.focus();
            return false;
        }

        if (!info.state) {
            setResult('Please select your state.', true);
            customerStateInput?.focus();
            return false;
        }

        if (!info.zip || !/^\d{5}(-\d{4})?$/.test(info.zip)) {
            setResult('Please enter a valid ZIP code.', true);
            customerZipInput?.focus();
            return false;
        }

        return true;
    }

    async function fetchConfig() {
        const response = await fetch(`${PAYPAL_API_BASE}/api/config`);
        if (!response.ok) {
            throw new Error('Could not reach the PayPal server.');
        }
        return response.json();
    }

    function loadPaypalSdk(clientId) {
        return new Promise((resolve, reject) => {
            if (window.paypal) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&buyer-country=US&currency=USD&components=buttons,card-fields&enable-funding=venmo,card`;
            script.dataset.sdkIntegrationSource = 'developer-studio';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load the PayPal SDK.'));
            document.head.appendChild(script);
        });
    }

    async function createOrder(cart) {
        const customer = getCustomerInfo();
        const response = await fetch(`${PAYPAL_API_BASE}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cart, customer })
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
            headers: { 'Content-Type': 'application/json' }
        });

        const orderData = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(orderData?.error || 'Could not capture the PayPal order.');
        }

        return orderData;
    }

    async function saveOrderToBackend(cart, paypalTransactionId) {
        const info = getCustomerInfo();

        try {
            const response = await fetch(`${BACKEND_API_BASE}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: cart.map((item) => ({
                        product_id: item.product_id,
                        quantity: item.quantity
                    })),
                    customer: {
                        name: info.name || 'PayPal Customer',
                        email: info.email || 'no-email@checkout.local',
                        phone: info.phone || '',
                        address: info.address || '',
                        city: info.city || '',
                        state: info.state || '',
                        zip: info.zip || ''
                    },
                    payment_method: 'paypal',
                    source_id: paypalTransactionId
                })
            });

            const data = await response.json().catch(() => ({}));
            return data?.order || null;
        } catch (_error) {
            return null;
        }
    }

    async function sendReceiptEmail(orderRecord, paypalTransactionId) {
        const info = getCustomerInfo();
        if (!info.email) return;

        try {
            await fetch(`${PAYPAL_API_BASE}/api/send-receipt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    order: orderRecord,
                    paypal_transaction_id: paypalTransactionId,
                    customer_email: info.email
                })
            });
        } catch (_error) {
            // Receipt email is best-effort
        }
    }

    function showOrderConfirmation(cart, orderRecord, paypalTransactionId) {
        const info = getCustomerInfo();

        // Advance progress to step 3
        setProgressStep(3);

        // Hide payment forms and shipping section
        if (buttonContainer) buttonContainer.hidden = true;
        if (cardForm) cardForm.hidden = true;
        if (customerInfoForm) customerInfoForm.hidden = true;
        const divider = document.querySelector('.payment-divider');
        if (divider) divider.hidden = true;

        // Hide checkout sections
        const sectionShipping = document.getElementById('section-shipping');
        const sectionPayment = document.getElementById('section-payment');
        if (sectionShipping) sectionShipping.hidden = true;
        if (sectionPayment) sectionPayment.hidden = true;

        // Hide the status message
        if (result) result.hidden = true;

        // Show confirmation
        if (orderConfirmation) {
            orderConfirmation.hidden = false;
        }

        if (confirmationMessage) {
            const orderId = orderRecord?.id || paypalTransactionId;
            confirmationMessage.textContent = `Order #${orderId} has been placed successfully.`;
        }

        if (confirmationDetails && cart.length > 0) {
            const subtotal = getSubtotal(cart);
            const shipping = SHIPPING_COST;
            const tax = subtotal * 0.08;
            const total = subtotal + shipping + tax;

            let html = '<table class="confirmation-table">';
            html += '<tr><th>Item</th><th>Qty</th><th>Price</th></tr>';
            cart.forEach(item => {
                html += `<tr><td>${item.name}</td><td>${item.quantity}</td><td>${formatPrice(item.unit_price * item.quantity)}</td></tr>`;
            });
            html += `<tr class="confirmation-subtotal"><td colspan="2">Subtotal</td><td>${formatPrice(subtotal)}</td></tr>`;
            html += `<tr><td colspan="2">Shipping</td><td>${formatPrice(shipping)}</td></tr>`;
            html += `<tr><td colspan="2">Tax (8%)</td><td>${formatPrice(tax)}</td></tr>`;
            html += `<tr class="confirmation-total"><td colspan="2">Total</td><td>${formatPrice(total)}</td></tr>`;
            html += '</table>';

            // Shipping address
            html += '<div class="confirmation-shipping">';
            html += '<h3>Shipping To</h3>';
            html += `<p>${info.name}</p>`;
            html += `<p>${info.address}</p>`;
            html += `<p>${info.city}, ${info.state} ${info.zip}</p>`;
            html += `<p>${info.phone}</p>`;
            html += '</div>';

            confirmationDetails.innerHTML = html;
        }

        if (confirmationEmail) {
            confirmationEmail.textContent = info.email;
        }
    }

    async function handlePaymentSuccess(cart, orderData) {
        const transaction =
            orderData?.purchase_units?.[0]?.payments?.captures?.[0] ||
            orderData?.purchase_units?.[0]?.payments?.authorizations?.[0];

        if (!transaction) {
            throw new Error('PayPal returned an incomplete capture response.');
        }

        // Save to backend and get order record
        const orderRecord = await saveOrderToBackend(cart, transaction.id);

        // Send receipt email (best-effort, don't block)
        sendReceiptEmail(orderRecord, transaction.id);

        // Clear cart
        localStorage.removeItem(STORAGE_KEY);

        // Show confirmation page
        showOrderConfirmation(cart, orderRecord, transaction.id);
    }

    function initPaypalButtons(cart) {
        if (!buttonContainer || !window.paypal || typeof window.paypal.Buttons !== 'function') {
            return;
        }

        if (cart.length === 0) {
            buttonContainer.hidden = true;
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
                if (!validateCustomerInfo()) {
                    throw new Error('Please fill in your information above.');
                }
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

                    await handlePaymentSuccess(cart, orderData);
                } catch (error) {
                    setResult(error.message || 'Sorry, your transaction could not be processed.', true);
                }
            },
            onError(error) {
                setResult(error.message || 'Sorry, your transaction could not be processed.', true);
            }
        }).render('#paypal-button-container');
    }

    function initCardFields(cart) {
        if (!cardForm || !cardSubmit || !window.paypal || typeof window.paypal.CardFields !== 'function') {
            if (cardForm) {
                cardForm.hidden = true;
            }
            return;
        }

        if (cart.length === 0) {
            cardForm.hidden = true;
            return;
        }

        const cardFields = window.paypal.CardFields({
            createOrder() {
                if (!validateCustomerInfo()) {
                    throw new Error('Please fill in your information above.');
                }
                setResult('', false);
                return createOrder(cart);
            },
            async onApprove(data) {
                try {
                    const orderData = await captureOrder(data.orderID);
                    const errorDetail = orderData?.details?.[0];

                    if (errorDetail) {
                        throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
                    }

                    await handlePaymentSuccess(cart, orderData);
                } catch (error) {
                    setResult(error.message || 'Sorry, your transaction could not be processed.', true);
                    cardSubmit.disabled = false;
                }
            },
            onError(error) {
                setResult(error.message || 'Sorry, your transaction could not be processed.', true);
                cardSubmit.disabled = false;
            },
            style: {
                input: {
                    'font-size': '16px',
                    'font-family': "'Barlow Condensed', sans-serif",
                    color: '#f4f8ff',
                    'padding': '0'
                },
                '.invalid': {
                    color: '#ffe6f0'
                }
            }
        });

        if (!cardFields.isEligible()) {
            cardForm.hidden = true;
            return;
        }

        cardFields.NumberField().render('#card-number-field');
        cardFields.ExpiryField().render('#card-expiry-field');
        cardFields.CVVField().render('#card-cvv-field');

        cardSubmit.disabled = false;

        cardSubmit.addEventListener('click', async () => {
            if (!validateCustomerInfo()) {
                return;
            }

            const cardholderName = (cardNameInput?.value || '').trim();
            if (!cardholderName) {
                setResult('Please enter the cardholder name.', true);
                cardNameInput?.focus();
                return;
            }

            cardSubmit.disabled = true;
            cardSubmit.textContent = 'Processing...';
            setResult('', false);

            try {
                await cardFields.submit({
                    cardholderName: cardholderName
                });
            } catch (error) {
                setResult(error.message || 'Card payment failed. Please check your details.', true);
                cardSubmit.disabled = false;
                cardSubmit.innerHTML = '<svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 116 0v3H9z" fill="currentColor"/></svg> Pay Securely Now';
            }
        });
    }

    async function init() {
        const cart = readCart();
        renderCart(cart);

        if (cart.length === 0) {
            if (cardForm) cardForm.hidden = true;
            if (buttonContainer) buttonContainer.hidden = true;
            if (customerInfoForm) customerInfoForm.hidden = true;
            const divider = document.querySelector('.payment-divider');
            if (divider) divider.hidden = true;
            setResult('Add items to your cart before checkout.', true);
            return;
        }

        // Advance to step 2 when user interacts with payment section
        const paymentSection = document.getElementById('section-payment');
        if (paymentSection) {
            paymentSection.addEventListener('focusin', () => setProgressStep(2), { once: true });
        }

        try {
            const config = await fetchConfig();
            if (!config.configured) {
                setResult('PayPal is not configured on the server. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in the .env file and restart the server.', true);
                return;
            }

            await loadPaypalSdk(config.clientId);
            initCardFields(cart);
            initPaypalButtons(cart);
        } catch (error) {
            setResult(
                error.message === 'Failed to fetch'
                    ? 'Cannot reach the PayPal server at ' + PAYPAL_API_BASE + '. Make sure to run: npm run paypal-server'
                    : error.message || 'PayPal checkout is unavailable.',
                true
            );
        }
    }

    init();
})();
