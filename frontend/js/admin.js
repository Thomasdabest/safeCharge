(function () {
    const API_BASE = 'http://127.0.0.1:8000';

    // Elements
    const loginSection = document.getElementById('login-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');
    const ordersBody = document.getElementById('orders-body');
    const noOrders = document.getElementById('no-orders');
    const shipModal = document.getElementById('ship-modal');
    const shipOrderId = document.getElementById('ship-order-id');
    const trackingInput = document.getElementById('tracking-input');
    const shipConfirm = document.getElementById('ship-confirm');
    const shipCancel = document.getElementById('ship-cancel');

    // Stats
    const statTotal = document.getElementById('stat-total');
    const statPending = document.getElementById('stat-pending');
    const statShipped = document.getElementById('stat-shipped');
    const statDelivered = document.getElementById('stat-delivered');
    const statRevenue = document.getElementById('stat-revenue');

    let adminToken = sessionStorage.getItem('admin_token') || '';
    let currentShipOrderId = '';

    // ── Auth ──────────────────────────────────────────────────────────────────

    function showLogin() {
        loginSection.hidden = false;
        dashboardSection.hidden = true;
        logoutBtn.hidden = true;
    }

    function showDashboard() {
        loginSection.hidden = true;
        dashboardSection.hidden = false;
        logoutBtn.hidden = false;
        loadOrders();
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.hidden = true;

        const username = document.getElementById('admin-username').value.trim();
        const password = document.getElementById('admin-password').value;

        try {
            const res = await fetch(`${API_BASE}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                loginError.textContent = data.detail || 'Login failed.';
                loginError.hidden = false;
                return;
            }

            adminToken = data.token;
            sessionStorage.setItem('admin_token', adminToken);
            showDashboard();
        } catch (err) {
            loginError.textContent = 'Cannot reach the server. Is the backend running?';
            loginError.hidden = false;
        }
    });

    logoutBtn.addEventListener('click', () => {
        adminToken = '';
        sessionStorage.removeItem('admin_token');
        showLogin();
    });

    // ── Orders ────────────────────────────────────────────────────────────────

    async function loadOrders() {
        try {
            const res = await fetch(`${API_BASE}/api/admin/orders`, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });

            if (res.status === 401) {
                adminToken = '';
                sessionStorage.removeItem('admin_token');
                showLogin();
                return;
            }

            const data = await res.json();
            renderOrders(data.orders || []);
        } catch (err) {
            ordersBody.innerHTML = '';
            noOrders.hidden = false;
            noOrders.textContent = 'Error loading orders. Is the backend running?';
        }
    }

    function formatDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    function statusBadge(status) {
        const map = {
            pending: 'badge-pending',
            shipped: 'badge-shipped',
            delivered: 'badge-delivered',
        };
        const cls = map[status] || 'badge-pending';
        return `<span class="admin-badge-status ${cls}">${status || 'pending'}</span>`;
    }

    function itemsSummary(items) {
        if (!items || items.length === 0) return '—';
        return items.map(i => `${i.name} x${i.quantity}`).join(', ');
    }

    function renderOrders(orders) {
        ordersBody.innerHTML = '';

        if (orders.length === 0) {
            noOrders.hidden = false;
            noOrders.textContent = 'No orders yet.';
            updateStats([]);
            return;
        }

        noOrders.hidden = true;
        updateStats(orders);

        orders.forEach((order) => {
            const fulfillment = order.fulfillment_status || 'pending';
            const customer = order.customer || {};

            // Main row
            const tr = document.createElement('tr');
            tr.className = 'admin-order-row';
            tr.innerHTML = `
                <td><button class="admin-expand-btn" aria-label="Expand order details">&#9654;</button></td>
                <td class="admin-order-id">${order.id || '—'}</td>
                <td>${formatDate(order.created_at)}</td>
                <td>${customer.name || '—'}</td>
                <td class="admin-items-cell">${itemsSummary(order.items)}</td>
                <td><strong>$${(order.total || 0).toFixed(2)}</strong></td>
                <td>${order.payment_method || '—'}</td>
                <td>${statusBadge(fulfillment)}</td>
                <td class="admin-actions-cell">
                    ${fulfillment === 'pending' ? `<button class="admin-action-btn admin-ship-btn" data-id="${order.id}">Ship</button>` : ''}
                    ${fulfillment === 'shipped' ? `<button class="admin-action-btn admin-deliver-btn" data-id="${order.id}">Delivered</button>` : ''}
                    ${fulfillment === 'delivered' ? '<span class="admin-done">Done</span>' : ''}
                </td>
            `;
            ordersBody.appendChild(tr);

            // Detail row (hidden)
            const detailTr = document.createElement('tr');
            detailTr.className = 'admin-detail-row';
            detailTr.hidden = true;
            detailTr.innerHTML = `
                <td colspan="9">
                    <div class="admin-detail-grid">
                        <div class="admin-detail-section">
                            <h4>Customer</h4>
                            <p>${customer.name || '—'}</p>
                            <p>${customer.email || '—'}</p>
                            <p>${customer.phone || '—'}</p>
                        </div>
                        <div class="admin-detail-section">
                            <h4>Shipping Address</h4>
                            <p>${customer.address || '—'}</p>
                            <p>${customer.city || ''}${customer.state ? ', ' + customer.state : ''} ${customer.zip || ''}</p>
                        </div>
                        <div class="admin-detail-section">
                            <h4>Items</h4>
                            ${(order.items || []).map(i => `<p>${i.name} &times; ${i.quantity} — $${(i.line_total || i.unit_price * i.quantity).toFixed(2)}</p>`).join('')}
                            <p class="admin-detail-totals">Subtotal: $${(order.subtotal || 0).toFixed(2)} | Tax: $${(order.tax || 0).toFixed(2)} | <strong>Total: $${(order.total || 0).toFixed(2)}</strong></p>
                        </div>
                        <div class="admin-detail-section">
                            <h4>Tracking</h4>
                            <p>${order.tracking_number || 'Not yet shipped'}</p>
                            <p class="admin-detail-meta">Source ID: ${order.source_id || '—'}</p>
                        </div>
                    </div>
                </td>
            `;
            ordersBody.appendChild(detailTr);

            // Toggle expand
            const expandBtn = tr.querySelector('.admin-expand-btn');
            expandBtn.addEventListener('click', () => {
                const isOpen = !detailTr.hidden;
                detailTr.hidden = isOpen;
                expandBtn.textContent = isOpen ? '\u25B6' : '\u25BC';
                expandBtn.classList.toggle('expanded', !isOpen);
            });
        });

        // Wire up action buttons
        document.querySelectorAll('.admin-ship-btn').forEach(btn => {
            btn.addEventListener('click', () => openShipModal(btn.dataset.id));
        });
        document.querySelectorAll('.admin-deliver-btn').forEach(btn => {
            btn.addEventListener('click', () => markDelivered(btn.dataset.id));
        });
    }

    function updateStats(orders) {
        const pending = orders.filter(o => (o.fulfillment_status || 'pending') === 'pending').length;
        const shipped = orders.filter(o => o.fulfillment_status === 'shipped').length;
        const delivered = orders.filter(o => o.fulfillment_status === 'delivered').length;
        const revenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

        statTotal.textContent = orders.length;
        statPending.textContent = pending;
        statShipped.textContent = shipped;
        statDelivered.textContent = delivered;
        statRevenue.textContent = `$${revenue.toFixed(2)}`;
    }

    // ── Ship Modal ────────────────────────────────────────────────────────────

    function openShipModal(orderId) {
        currentShipOrderId = orderId;
        shipOrderId.textContent = orderId;
        trackingInput.value = '';
        shipModal.hidden = false;
        trackingInput.focus();
    }

    shipCancel.addEventListener('click', () => {
        shipModal.hidden = true;
    });

    shipConfirm.addEventListener('click', async () => {
        const tracking = trackingInput.value.trim();
        await updateFulfillment(currentShipOrderId, 'shipped', tracking);
        shipModal.hidden = true;
    });

    async function markDelivered(orderId) {
        await updateFulfillment(orderId, 'delivered');
    }

    async function updateFulfillment(orderId, status, trackingNumber) {
        try {
            const body = { fulfillment_status: status };
            if (trackingNumber) body.tracking_number = trackingNumber;

            const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                },
                body: JSON.stringify(body),
            });

            if (res.status === 401) {
                adminToken = '';
                sessionStorage.removeItem('admin_token');
                showLogin();
                return;
            }

            if (res.ok) {
                loadOrders();
            }
        } catch (err) {
            console.error('Failed to update order:', err);
        }
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    if (adminToken) {
        showDashboard();
    } else {
        showLogin();
    }
})();
