(function () {
    const API_BASE = 'http://127.0.0.1:8000';
    const STORAGE_KEY = 'safecharge_cart';

    const productGrid = document.getElementById('product-grid');
    const cartList = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');
    const cartEmpty = document.getElementById('cart-empty');
    const clearCartButton = document.getElementById('clear-cart');
    const checkoutButton = document.getElementById('checkout-button');
    const checkoutName = document.getElementById('checkout-name');
    const checkoutEmail = document.getElementById('checkout-email');
    const checkoutStatus = document.getElementById('checkout-status');

    if (!productGrid || !cartList || !cartTotal || !cartEmpty || !clearCartButton || !checkoutButton || !checkoutName || !checkoutEmail || !checkoutStatus) {
        return;
    }

    let productsById = {};
    let cart = loadCart();

    function loadCart() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
            return [];
        }

        try {
            const parsed = JSON.parse(saved);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_error) {
            return [];
        }
    }

    function saveCart() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    }

    function formatPrice(value) {
        return `$${Number(value).toFixed(2)}`;
    }

    function setStatus(message, isError) {
        checkoutStatus.textContent = message;
        checkoutStatus.dataset.error = isError ? 'true' : 'false';
    }

    function renderProducts(products) {
        productsById = products.reduce((acc, product) => {
            acc[product.id] = product;
            return acc;
        }, {});

        productGrid.innerHTML = products
            .map((product) => `
                <article class="product-card">
                    <h2>${product.name}</h2>
                    <p>${product.description}</p>
                    <p class="price">${formatPrice(product.price)}</p>
                    <button type="button" class="add-to-cart" data-id="${product.id}">Add to Cart</button>
                </article>
            `)
            .join('');
    }

    function addItem(productId) {
        const product = productsById[productId];
        if (!product) {
            return;
        }

        const existing = cart.find((entry) => entry.product_id === productId);
        if (existing) {
            existing.quantity += 1;
        } else {
            cart.push({
                product_id: product.id,
                name: product.name,
                unit_price: Number(product.price),
                quantity: 1
            });
        }

        saveCart();
        renderCart();
    }

    function removeOne(productId) {
        const target = cart.find((entry) => entry.product_id === productId);
        if (!target) {
            return;
        }

        target.quantity -= 1;
        if (target.quantity <= 0) {
            cart = cart.filter((entry) => entry.product_id !== productId);
        }

        saveCart();
        renderCart();
    }

    function renderCart() {
        cartList.innerHTML = '';

        if (cart.length === 0) {
            cartEmpty.hidden = false;
            cartTotal.textContent = '$0.00';
            clearCartButton.disabled = true;
            checkoutButton.disabled = true;
            return;
        }

        cartEmpty.hidden = true;
        clearCartButton.disabled = false;
        checkoutButton.disabled = false;

        let total = 0;

        cart.forEach((item) => {
            const lineTotal = item.unit_price * item.quantity;
            total += lineTotal;

            const li = document.createElement('li');
            li.className = 'cart-item';
            li.innerHTML = `
                <div>
                    <p class="cart-item-name">${item.name}</p>
                    <p class="cart-item-meta">${formatPrice(item.unit_price)} x ${item.quantity}</p>
                </div>
                <button type="button" class="cart-remove" data-id="${item.product_id}" aria-label="Remove one ${item.name}">-1</button>
            `;
            cartList.appendChild(li);
        });

        cartTotal.textContent = formatPrice(total);
    }

    async function loadProducts() {
        try {
            const response = await fetch(`${API_BASE}/api/products`);
            if (!response.ok) {
                throw new Error('Failed to load products');
            }

            const data = await response.json();
            renderProducts(data.products || []);
            renderCart();
            setStatus('', false);
        } catch (_error) {
            setStatus('Could not connect to backend. Start API at http://127.0.0.1:8000', true);
        }
    }

    async function checkout() {
        setStatus('', false);

        if (cart.length === 0) {
            setStatus('Add at least one item before checkout.', true);
            return;
        }

        const name = checkoutName.value.trim();
        const email = checkoutEmail.value.trim();

        if (!name || !email) {
            setStatus('Enter your name and email to checkout.', true);
            return;
        }

        const payload = {
            customer: { name, email },
            payment_method: 'card',
            items: cart.map((item) => ({
                product_id: item.product_id,
                quantity: item.quantity
            }))
        };

        checkoutButton.disabled = true;

        try {
            const response = await fetch(`${API_BASE}/api/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const detail = errorData.detail || 'Checkout failed';
                throw new Error(detail);
            }

            const data = await response.json();
            setStatus(`Order placed: ${data.order.id}`, false);
            cart = [];
            saveCart();
            renderCart();
            checkoutName.value = '';
            checkoutEmail.value = '';
        } catch (error) {
            setStatus(error.message || 'Checkout failed', true);
        } finally {
            checkoutButton.disabled = cart.length === 0;
        }
    }

    productGrid.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || !target.classList.contains('add-to-cart')) {
            return;
        }

        addItem(target.dataset.id);
    });

    cartList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement) || !target.classList.contains('cart-remove')) {
            return;
        }

        removeOne(target.dataset.id);
    });

    clearCartButton.addEventListener('click', () => {
        cart = [];
        saveCart();
        renderCart();
        setStatus('Cart cleared.', false);
    });

    checkoutButton.addEventListener('click', checkout);

    loadProducts();
})();
