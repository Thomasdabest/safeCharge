(function () {
    const API_BASE = 'http://127.0.0.1:8000';
    const STORAGE_KEY = 'safecharge_cart_v2';

    const productGrid = document.getElementById('product-grid');
    const shopStatus = document.getElementById('shop-status');

    const cartList = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');
    const cartEmpty = document.getElementById('cart-empty');
    const clearCartButton = document.getElementById('clear-cart');
    const checkoutButton = document.getElementById('checkout-button');
    const checkoutName = document.getElementById('checkout-name');
    const checkoutEmail = document.getElementById('checkout-email');
    const checkoutStatus = document.getElementById('checkout-status');

    const cartCountElements = document.querySelectorAll('[data-cart-count]');
    let productsById = {};

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

    function renderCart(cart) {
        if (!cartList || !cartTotal || !cartEmpty || !clearCartButton) {
            return;
        }

        cartList.innerHTML = '';
        const subtotal = getSubtotal(cart);
        cartTotal.textContent = formatPrice(subtotal);

        if (cart.length === 0) {
            cartEmpty.hidden = false;
            clearCartButton.disabled = true;
            if (checkoutButton) {
                checkoutButton.disabled = true;
            }
            return;
        }

        cartEmpty.hidden = true;
        clearCartButton.disabled = false;
        if (checkoutButton) {
            checkoutButton.disabled = false;
        }

        cart.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'cart-item';
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
            cartList.appendChild(li);
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

        if (!name || !email) {
            throw new Error('Enter your name and email to checkout.');
        }

        const payload = {
            customer: { name, email },
            payment_method: 'card',
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
        if (!cartList || !cartTotal || !cartEmpty || !clearCartButton || !checkoutButton || !checkoutStatus) {
            return;
        }

        let cart = readCart();
        updateCartCountBadge(cart);
        renderCart(cart);

        try {
            await fetchProducts();
            cart = applyProductInfo(cart);
            writeCart(cart);
            updateCartCountBadge(cart);
            renderCart(cart);
            setStatus(checkoutStatus, '', false);
        } catch (_error) {
            setStatus(checkoutStatus, 'Backend offline. You can still edit cart, but checkout is unavailable.', true);
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
            renderCart(cart);
        });

        clearCartButton.addEventListener('click', () => {
            cart = [];
            writeCart(cart);
            updateCartCountBadge(cart);
            renderCart(cart);
            setStatus(checkoutStatus, 'Cart cleared.', false);
        });

        checkoutButton.addEventListener('click', async () => {
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
                renderCart(cart);
                if (checkoutName) {
                    checkoutName.value = '';
                }
                if (checkoutEmail) {
                    checkoutEmail.value = '';
                }
                setStatus(checkoutStatus, `Order placed: ${data.order.id}`, false);
            } catch (error) {
                setStatus(checkoutStatus, error.message || 'Checkout failed.', true);
            } finally {
                checkoutButton.disabled = cart.length === 0;
            }
        });
    }

    initShopPage();
    initCartPage();
})();
