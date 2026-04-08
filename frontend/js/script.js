(function () {
    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://127.0.0.1:8000'
        : 'https://safecharge-backend.up.railway.app';
    const STORAGE_KEY = 'safecharge_cart_v2';

    const productGrid = document.getElementById('product-grid');
    const shopStatus = document.getElementById('shop-status');

    const cartList = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');
    const cartEmpty = document.getElementById('cart-empty');
    const clearCartButton = document.getElementById('clear-cart');
    const checkoutButton = document.getElementById('checkout-button');
    const checkoutLink = document.getElementById('checkout-link');
    const checkoutName = document.getElementById('checkout-name');
    const checkoutEmail = document.getElementById('checkout-email');
    const checkoutPayment = document.getElementById('checkout-payment');
    const squarePaymentPanel = document.getElementById('square-payment-panel');
    const squareCardContainer = document.getElementById('square-card');
    const checkoutStatus = document.getElementById('checkout-status');

    const cartCountElements = document.querySelectorAll('[data-cart-count]');
    let productsById = {};
    let paymentConfig = null;
    let squareCard = null;
    let squareCardReady = false;
    let squareScriptPromise = null;
    
    function normalizeCart(rawItems) {
        if (!Array.isArray(rawItems)) {
            return [];
        }

        const deduped = new Map();

        rawItems.forEach((item) => {
            if (!item || typeof item !== 'object') {
                return;
            }

            const productId = String(item.product_id || '').trim();
            if (!productId) {
                return;
            }

            const quantity = Number.parseInt(item.quantity, 10);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                return;
            }

            const safeQuantity = Math.min(quantity, 99);
            const unitPrice = Number(item.unit_price);
            const safePrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
            const safeName = String(item.name || productId);

            if (deduped.has(productId)) {
                const existing = deduped.get(productId);
                existing.quantity = Math.min(existing.quantity + safeQuantity, 99);
                if (safePrice > 0) {
                    existing.unit_price = safePrice;
                }
                if (safeName && safeName !== productId) {
                    existing.name = safeName;
                }
                return;
            }

            deduped.set(productId, {
                product_id: productId,
                name: safeName,
                unit_price: safePrice,
                quantity: safeQuantity
            });
        });

        return Array.from(deduped.values());
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

    function writeCart(cart) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCart(cart)));
    }

    function formatPrice(value) {
        return `$${Number(value).toFixed(2)}`;
    }

    function setStatus(element, message, isError) {
        if (!element) {
            return;
        }

        element.textContent = message;
        element.dataset.error = isError ? 'true' : 'false';
    }

    function getCartCount(cart) {
        return cart.reduce((sum, item) => sum + item.quantity, 0);
    }

    function getSubtotal(cart) {
        return cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    }

    function updateCartCountBadge(cart) {
        const count = getCartCount(cart);
        cartCountElements.forEach((element) => {
            element.textContent = String(count);
        });
    }

    function applyProductInfo(cart) {
        return cart.map((item) => {
            const liveProduct = productsById[item.product_id];
            if (!liveProduct) {
                return item;
            }

            return {
                ...item,
                name: liveProduct.name,
                unit_price: Number(liveProduct.price)
            };
        });
    }

    function syncCartWithCatalog(cart) {
        const normalizedCart = normalizeCart(cart);

        if (!Object.keys(productsById).length) {
            return { cart: normalizedCart, removedCount: 0 };
        }

        const syncedCart = [];
        let removedCount = 0;

        normalizedCart.forEach((item) => {
            const liveProduct = productsById[item.product_id];
            if (!liveProduct || liveProduct.in_stock === false) {
                removedCount += item.quantity;
                return;
            }

            syncedCart.push({
                ...item,
                name: liveProduct.name,
                unit_price: Number(liveProduct.price)
            });
        });

        return { cart: syncedCart, removedCount };
    }

    async function fetchProducts() {
        const response = await fetch(`${API_BASE}/api/products`);
        if (!response.ok) {
            throw new Error('Unable to load products right now.');
        }

        const data = await response.json();
        const products = Array.isArray(data.products) ? data.products : [];

        productsById = products.reduce((acc, product) => {
            if (product && product.id) {
                acc[product.id] = product;
            }
            return acc;
        }, {});

        return products;
    }

    async function fetchPaymentConfig() {
        const response = await fetch(`${API_BASE}/api/payments/config`);
        if (!response.ok) {
            throw new Error('Unable to load payment configuration.');
        }

        const data = await response.json();
        return data.square || null;
    }

    function getSelectedPaymentMethod() {
        return checkoutPayment ? checkoutPayment.value : 'card';
    }

    function getOrderTotal(cart) {
        const subtotal = getSubtotal(cart);
        const tax = subtotal * 0.08;
        return Number((subtotal + tax).toFixed(2));
    }

    function loadSquareScript(scriptUrl) {
        if (window.Square) {
            return Promise.resolve(window.Square);
        }

        if (squareScriptPromise) {
            return squareScriptPromise;
        }

        squareScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptUrl;
            script.async = true;
            script.onload = () => resolve(window.Square);
            script.onerror = () => reject(new Error('Unable to load the Square payment form.'));
            document.head.appendChild(script);
        });

        return squareScriptPromise;
    }

    async function ensureSquareCard() {
        if (!paymentConfig || !paymentConfig.enabled) {
            throw new Error('Square is not configured yet.');
        }

        if (!squareCardContainer) {
            throw new Error('Square card container missing.');
        }

        if (squareCardReady && squareCard) {
            return squareCard;
        }

        const Square = await loadSquareScript(paymentConfig.script_url);
        if (!Square || typeof Square.payments !== 'function') {
            throw new Error('Square payment form unavailable.');
        }

        const payments = Square.payments(paymentConfig.application_id, paymentConfig.location_id);
        squareCard = await payments.card();
        await squareCard.attach('#square-card');
        squareCardReady = true;
        return squareCard;
    }

    async function updatePaymentUi() {
        if (!checkoutPayment || !squarePaymentPanel) {
            return;
        }

        const isSquare = getSelectedPaymentMethod() === 'square';
        squarePaymentPanel.hidden = !isSquare;

        if (!isSquare) {
            return;
        }

        if (!paymentConfig || !paymentConfig.enabled) {
            squarePaymentPanel.hidden = true;
            checkoutPayment.value = 'card';
            setStatus(checkoutStatus, 'Square is unavailable until the server is configured.', true);
            return;
        }

        try {
            await ensureSquareCard();
            if (checkoutStatus && checkoutStatus.textContent === 'Square is unavailable until the server is configured.') {
                setStatus(checkoutStatus, '', false);
            }
        } catch (error) {
            checkoutPayment.value = 'card';
            squarePaymentPanel.hidden = true;
            setStatus(checkoutStatus, error.message || 'Square is unavailable.', true);
        }
    }

    async function tokenizeSquareCard() {
        const card = await ensureSquareCard();
        const result = await card.tokenize();

        if (result.status !== 'OK' || !result.token) {
            throw new Error('Square could not verify your card details.');
        }

        return result.token;
    }

    function renderProductGrid(products) {
        if (!productGrid) {
            return;
        }

        productGrid.innerHTML = products.map((product) => `
            <article class="product-card">
                <h2>${product.name}</h2>
                <p>${product.description || ''}</p>
                <p class="price">${formatPrice(product.price)}</p>
                <button type="button" class="add-to-cart" data-id="${product.id}">Add to Cart</button>
            </article>
        `).join('');
    }

    function renderCart(cart, options) {
        const {
            listElement,
            totalElement,
            emptyElement,
            clearButton,
            checkoutAction,
            editable
        } = options;

        if (!listElement || !totalElement || !emptyElement) {
            return;
        }

        listElement.innerHTML = '';
        const subtotal = getSubtotal(cart);
        totalElement.textContent = formatPrice(subtotal);

        if (cart.length === 0) {
            emptyElement.hidden = false;
            if (clearButton) {
                clearButton.disabled = true;
            }
            if (checkoutAction instanceof HTMLButtonElement) {
                checkoutAction.disabled = true;
            }
            if (checkoutAction instanceof HTMLAnchorElement) {
                checkoutAction.setAttribute('aria-disabled', 'true');
                checkoutAction.classList.add('is-disabled');
            }
            return;
        }

        emptyElement.hidden = true;
        if (clearButton) {
            clearButton.disabled = false;
        }
        if (checkoutAction instanceof HTMLButtonElement) {
            checkoutAction.disabled = false;
        }
        if (checkoutAction instanceof HTMLAnchorElement) {
            checkoutAction.removeAttribute('aria-disabled');
            checkoutAction.classList.remove('is-disabled');
        }

        cart.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'cart-item';
            if (editable) {
                li.innerHTML = `
                    <div>
                        <p class="cart-item-name">${item.name}</p>
                        <p class="cart-item-meta">${formatPrice(item.unit_price)} x ${item.quantity}</p>
                    </div>
                    <div class="cart-item-actions">
                        <button type="button" class="cart-adjust" data-action="decrease" data-id="${item.product_id}" aria-label="Decrease ${item.name}">-</button>
                        <button type="button" class="cart-adjust" data-action="increase" data-id="${item.product_id}" aria-label="Increase ${item.name}">+</button>
                        <button type="button" class="cart-remove" data-id="${item.product_id}" aria-label="Remove ${item.name}">Remove</button>
                    </div>
                `;
            } else {
                li.innerHTML = `
                    <div>
                        <p class="cart-item-name">${item.name}</p>
                        <p class="cart-item-meta">${formatPrice(item.unit_price)} x ${item.quantity}</p>
                    </div>
                    <strong>${formatPrice(item.unit_price * item.quantity)}</strong>
                `;
            }
            listElement.appendChild(li);
        });
    }

    function upsertCartItem(cart, productId, delta) {
        const product = productsById[productId];
        const nextCart = normalizeCart(cart);
        const index = nextCart.findIndex((item) => item.product_id === productId);

        if (index === -1 && delta > 0) {
            if (!product) {
                return nextCart;
            }

            nextCart.push({
                product_id: product.id,
                name: product.name,
                unit_price: Number(product.price),
                quantity: Math.min(delta, 99)
            });
            return nextCart;
        }

        if (index === -1) {
            return nextCart;
        }

        const nextQuantity = nextCart[index].quantity + delta;
        if (nextQuantity <= 0) {
            return nextCart.filter((item) => item.product_id !== productId);
        }

        nextCart[index] = {
            ...nextCart[index],
            name: product ? product.name : nextCart[index].name,
            unit_price: product ? Number(product.price) : nextCart[index].unit_price,
            quantity: Math.min(nextQuantity, 99)
        };

        return nextCart;
    }

    async function initShopPage() {
        if (!productGrid) {
            return;
        }

        let cart = readCart();
        updateCartCountBadge(cart);

        try {
            const products = await fetchProducts();
            cart = applyProductInfo(cart);
            writeCart(cart);
            updateCartCountBadge(cart);
            renderProductGrid(products);
            setStatus(shopStatus, '', false);
        } catch (error) {
            setStatus(shopStatus, error.message || 'Could not load products.', true);
            return;
        }

        productGrid.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLButtonElement) || !target.classList.contains('add-to-cart')) {
                return;
            }

            cart = upsertCartItem(cart, target.dataset.id, 1);
            writeCart(cart);
            updateCartCountBadge(cart);
            setStatus(shopStatus, 'Added to cart.', false);
        });
    }

    async function checkout(cart) {
        const name = checkoutName ? checkoutName.value.trim() : '';
        const email = checkoutEmail ? checkoutEmail.value.trim() : '';
        const paymentMethod = getSelectedPaymentMethod();

        if (!name || !email) {
            throw new Error('Enter your name and email to checkout.');
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error('Enter a valid email address.');
        }

        let sourceId = null;
        if (paymentMethod === 'square') {
            sourceId = await tokenizeSquareCard();
        }

        const payload = {
            customer: { name, email },
            payment_method: paymentMethod,
            source_id: sourceId,
            items: cart.map((item) => ({
                product_id: item.product_id,
                quantity: item.quantity
            }))
        };

        const response = await fetch(`${API_BASE}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || 'Checkout failed.');
        }

        return response.json();
    }

    async function initCartPage() {
        if (!cartList || !cartTotal || !cartEmpty || !clearCartButton || !checkoutLink || !checkoutStatus) {
            return;
        }

        let cart = readCart();
        updateCartCountBadge(cart);
        renderCart(cart, {
            listElement: cartList,
            totalElement: cartTotal,
            emptyElement: cartEmpty,
            clearButton: clearCartButton,
            checkoutAction: checkoutLink,
            editable: true
        });

        try {
            await fetchProducts();
            const syncResult = syncCartWithCatalog(cart);
            cart = syncResult.cart;
            writeCart(cart);
            updateCartCountBadge(cart);
            renderCart(cart, {
                listElement: cartList,
                totalElement: cartTotal,
                emptyElement: cartEmpty,
                clearButton: clearCartButton,
                checkoutAction: checkoutLink,
                editable: true
            });
            if (syncResult.removedCount > 0) {
                setStatus(checkoutStatus, 'Unavailable items were removed from your cart.', true);
            } else {
                setStatus(checkoutStatus, '', false);
            }
        } catch (_error) {
            setStatus(checkoutStatus, 'Backend offline. You can still edit your cart.', true);
        }

        cartList.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLButtonElement)) {
                return;
            }

            const productId = target.dataset.id;
            if (!productId) {
                return;
            }

            if (target.classList.contains('cart-adjust')) {
                const isIncrease = target.dataset.action === 'increase';
                cart = upsertCartItem(cart, productId, isIncrease ? 1 : -1);
            } else if (target.classList.contains('cart-remove')) {
                cart = cart.filter((item) => item.product_id !== productId);
            } else {
                return;
            }

            writeCart(cart);
            updateCartCountBadge(cart);
            renderCart(cart, {
                listElement: cartList,
                totalElement: cartTotal,
                emptyElement: cartEmpty,
                clearButton: clearCartButton,
                checkoutAction: checkoutLink,
                editable: true
            });
        });

        clearCartButton.addEventListener('click', () => {
            cart = [];
            writeCart(cart);
            updateCartCountBadge(cart);
            renderCart(cart, {
                listElement: cartList,
                totalElement: cartTotal,
                emptyElement: cartEmpty,
                clearButton: clearCartButton,
                checkoutAction: checkoutLink,
                editable: true
            });
            setStatus(checkoutStatus, 'Cart cleared.', false);
        });
    }

    async function initCheckoutPage() {
        if (!cartList || !cartTotal || !cartEmpty || !checkoutButton || !checkoutStatus) {
            return;
        }

        let cart = readCart();
        let checkoutAvailable = false;
        updateCartCountBadge(cart);
        renderCart(cart, {
            listElement: cartList,
            totalElement: cartTotal,
            emptyElement: cartEmpty,
            checkoutAction: checkoutButton,
            editable: false
        });

        try {
            await fetchProducts();
            const syncResult = syncCartWithCatalog(cart);
            cart = syncResult.cart;
            writeCart(cart);
            updateCartCountBadge(cart);
            renderCart(cart, {
                listElement: cartList,
                totalElement: cartTotal,
                emptyElement: cartEmpty,
                checkoutAction: checkoutButton,
                editable: false
            });
            checkoutAvailable = true;
            if (syncResult.removedCount > 0) {
                setStatus(checkoutStatus, 'Unavailable items were removed from your cart before checkout.', true);
            } else {
                setStatus(checkoutStatus, '', false);
            }
        } catch (_error) {
            setStatus(checkoutStatus, 'Backend offline. Order submission is unavailable right now.', true);
            checkoutButton.disabled = true;
        }

        try {
            paymentConfig = await fetchPaymentConfig();
        } catch (_error) {
            paymentConfig = null;
        }

        if (checkoutPayment) {
            if (!paymentConfig || !paymentConfig.enabled) {
                const squareOption = checkoutPayment.querySelector('option[value="square"]');
                if (squareOption) {
                    squareOption.disabled = true;
                }
            }

            checkoutPayment.addEventListener('change', () => {
                setStatus(checkoutStatus, '', false);
                updatePaymentUi();
            });
        }

        await updatePaymentUi();

        checkoutButton.addEventListener('click', async () => {
            if (!checkoutAvailable) {
                setStatus(checkoutStatus, 'Order submission is unavailable until the backend is online.', true);
                return;
            }

            if (cart.length === 0) {
                setStatus(checkoutStatus, 'Add at least one item before checkout.', true);
                return;
            }

            checkoutButton.disabled = true;
            setStatus(checkoutStatus, '', false);

            try {
                const data = await checkout(cart);
                cart = [];
                writeCart(cart);
                updateCartCountBadge(cart);
                renderCart(cart, {
                    listElement: cartList,
                    totalElement: cartTotal,
                    emptyElement: cartEmpty,
                    checkoutAction: checkoutButton,
                    editable: false
                });
                if (checkoutName) {
                    checkoutName.value = '';
                }
                if (checkoutEmail) {
                    checkoutEmail.value = '';
                }
                if (checkoutPayment) {
                    checkoutPayment.value = 'card';
                }
                const receiptSuffix = data.order.receipt_url ? ' Receipt ready.' : '';
                setStatus(
                    checkoutStatus,
                    `Order placed: ${data.order.id} via ${data.order.payment_method} for ${formatPrice(data.order.total)}.${receiptSuffix}`,
                    false
                );
                await updatePaymentUi();
            } catch (error) {
                setStatus(checkoutStatus, error.message || 'Checkout failed.', true);
            } finally {
                checkoutButton.disabled = cart.length === 0;
            }
        });
    }

    initShopPage();
    initCartPage();
    initCheckoutPage();
})();
