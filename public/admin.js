/**
 * SmartCart Admin — Frontend Logic
 */

const API = window.location.origin;
const TOKEN_KEY = 'smartcart_admin_token';
const STAFF_KEY = 'smartcart_admin_staff';

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let staffName = sessionStorage.getItem(STAFF_KEY) || '';
let currentTagsProductId = null;

// ============================================================
// Helpers
// ============================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-ZA', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

async function adminRequest(path, body = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': token,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    // Token expired or invalid
    logout();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ============================================================
// Login / Logout
// ============================================================
async function attemptLogin() {
  const pinInput = document.getElementById('login-pin');
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const pin = pinInput.value.trim();

  errEl.textContent = '';
  if (!pin || pin.length < 4) {
    errEl.textContent = 'PIN must be 4-6 digits';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Checking…';

  try {
    const res = await fetch(`${API}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed';
      return;
    }

    token = data.token;
    staffName = data.staff.name;
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(STAFF_KEY, staffName);
    enterAdmin();
  } catch (err) {
    errEl.textContent = 'Network error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
}

function logout() {
  token = '';
  staffName = '';
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(STAFF_KEY);
  document.getElementById('app-shell').classList.remove('visible');
  document.getElementById('login-gate').classList.remove('hidden');
  document.getElementById('login-pin').value = '';
}

function enterAdmin() {
  document.getElementById('login-gate').classList.add('hidden');
  document.getElementById('app-shell').classList.add('visible');
  document.getElementById('staff-badge').textContent = staffName;
  switchTab('alerts');
  loadAlerts();
}

// ============================================================
// Tabs
// ============================================================
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${name}`);
  });

  if (name === 'products' && !document.getElementById('products-container').dataset.loaded) {
    loadProducts();
  }
  if (name === 'staff' && !document.getElementById('staff-tbody').dataset.loaded) {
    loadStaff();
  }
  if (name === 'transactions' && !document.getElementById('transactions-tbody').dataset.loaded) {
    loadTransactions();
  }
}

// ============================================================
// Alerts
// ============================================================
async function loadAlerts() {
  const list = document.getElementById('alerts-list');
  const sub = document.getElementById('alerts-sub');
  list.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const data = await adminRequest('/api/admin/alerts', { includeResolved: false });
    sub.textContent = `${data.activeCount} active alert${data.activeCount === 1 ? '' : 's'}`;
    if (data.alerts.length === 0) {
      list.innerHTML = '<div class="empty">No active alerts 🎉</div>';
      return;
    }
    list.innerHTML = data.alerts.map(a => `
      <div class="card card-alert">
        <div class="card-info">
          <div class="card-title">${escapeHtml(a.type.replace('_', ' ').toUpperCase())} — Cart ${escapeHtml(a.cartId)}</div>
          <div class="card-meta">
            <span>Session ${a.sessionId ?? '—'}</span>
            <span>${escapeHtml(a.reason || '')}</span>
            <span>${formatDate(a.createdAt)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-success btn-sm" data-resolve="${a.id}">Resolve</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-resolve]').forEach(btn => {
      btn.addEventListener('click', () => resolveAlert(parseInt(btn.dataset.resolve, 10), btn));
    });
  } catch (err) {
    list.innerHTML = `<div class="empty" style="color:#f87171;">${escapeHtml(err.message)}</div>`;
  }
}

async function resolveAlert(alertId, btn) {
  btn.disabled = true;
  btn.textContent = 'Resolving…';
  try {
    await adminRequest('/api/admin/alert/resolve', { alertId });
    showToast('Alert resolved', 'success');
    loadAlerts();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Resolve';
  }
}

async function resolveAllAlerts() {
  if (!confirm('Resolve ALL active alerts?')) return;
  const btn = document.getElementById('resolve-all-btn');
  btn.disabled = true;
  btn.textContent = 'Resolving…';
  try {
    const data = await adminRequest('/api/admin/alert/resolve-all', {});
    showToast(`Resolved ${data.count} alert(s)`, 'success');
    loadAlerts();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Resolve All';
  }
}

// ============================================================
// Products
// ============================================================
async function loadProducts() {
  const container = document.getElementById('products-container');
  const sub = document.getElementById('products-sub');
  container.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const res = await fetch(`${API}/api/products/list`);
    const data = await res.json();
    if (!data.success) throw new Error('Failed to load products');
    sub.textContent = `${data.products.length} products`;

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th style="width:50px;">ID</th>
            <th>Name</th>
            <th style="width:130px;">Price (R)</th>
            <th style="width:110px;">Stock</th>
            <th style="width:90px;">Tags</th>
            <th style="width:100px;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.products.map(p => `
            <tr data-product-id="${p.id}">
              <td>${p.id}</td>
              <td><input type="text" value="${escapeHtml(p.name)}" data-field="name" /></td>
              <td><input type="number" step="0.01" min="0" value="${(p.priceCents/100).toFixed(2)}" data-field="price" class="small" /></td>
              <td><input type="number" min="0" value="${p.stockQuantity ?? 0}" data-field="stock" class="small" /></td>
              <td><button class="btn btn-ghost btn-sm" data-tags-for="${p.id}">${p.tags.length} tags</button></td>
              <td><button class="btn btn-primary btn-sm" data-save="${p.id}">Save</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    container.dataset.loaded = '1';

    container.querySelectorAll('[data-save]').forEach(btn => {
      btn.addEventListener('click', () => saveProduct(parseInt(btn.dataset.save, 10), btn));
    });
    container.querySelectorAll('[data-tags-for]').forEach(btn => {
      btn.addEventListener('click', () => openTagsModal(parseInt(btn.dataset.tagsFor, 10)));
    });
  } catch (err) {
    container.innerHTML = `<div class="empty" style="color:#f87171;">${escapeHtml(err.message)}</div>`;
  }
}

async function saveProduct(productId, btn) {
  const row = document.querySelector(`tr[data-product-id="${productId}"]`);
  if (!row) return;
  const nameInput = row.querySelector('[data-field="name"]');
  const priceInput = row.querySelector('[data-field="price"]');
  const stockInput = row.querySelector('[data-field="stock"]');

  const body = {
    productId,
    name: nameInput.value.trim(),
    priceCents: Math.round(parseFloat(priceInput.value) * 100),
    stockQuantity: parseInt(stockInput.value, 10),
  };

  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await adminRequest('/api/admin/product/update', body);
    showToast('Product saved', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ============================================================
// Tags modal
// ============================================================
async function openTagsModal(productId) {
  currentTagsProductId = productId;
  document.getElementById('tags-modal-title').textContent = `Tags for Product #${productId}`;
  document.getElementById('new-tag-input').value = '';
  document.getElementById('modal-tags').classList.add('show');
  await refreshTagsList();
}

async function refreshTagsList() {
  const container = document.getElementById('tags-list');
  container.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const data = await adminRequest('/api/admin/product/tags', {
      productId: currentTagsProductId,
    });
    if (data.tags.length === 0) {
      container.innerHTML = '<div class="empty">No tags yet</div>';
      return;
    }
    container.innerHTML = data.tags.map(t => `
      <span class="tag-chip ${t.isActive ? '' : 'inactive'}">
        ${escapeHtml(t.rfidTagId)}
        ${t.isActive ? `<button data-remove-tag="${t.id}" title="Deactivate">×</button>` : ''}
      </span>
    `).join('');
    container.querySelectorAll('[data-remove-tag]').forEach(btn => {
      btn.addEventListener('click', () => removeTag(parseInt(btn.dataset.removeTag, 10)));
    });
  } catch (err) {
    container.innerHTML = `<div class="empty" style="color:#f87171;">${escapeHtml(err.message)}</div>`;
  }
}

async function addTag() {
  const input = document.getElementById('new-tag-input');
  const btn = document.getElementById('add-tag-btn');
  const tag = input.value.trim().toUpperCase();
  if (!tag) {
    showToast('Enter a tag ID', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    await adminRequest('/api/admin/tag/add', {
      productId: currentTagsProductId,
      rfidTagId: tag,
    });
    showToast(`Tag ${tag} added`, 'success');
    input.value = '';
    await refreshTagsList();
    // Refresh product list tag counts
    document.getElementById('products-container').dataset.loaded = '';
    loadProducts();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Tag';
  }
}

async function removeTag(tagId) {
  if (!confirm('Deactivate this tag?')) return;
  try {
    await adminRequest('/api/admin/tag/remove', { tagId });
    showToast('Tag deactivated', 'success');
    await refreshTagsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================
// Staff
// ============================================================
async function loadStaff() {
  const tbody = document.getElementById('staff-tbody');
  const sub = document.getElementById('staff-sub');
  tbody.innerHTML = '<tr><td colspan="4" class="empty">Loading…</td></tr>';
  try {
    const data = await adminRequest('/api/admin/staff/list', {});
    sub.textContent = `${data.staff.length} staff member${data.staff.length === 1 ? '' : 's'}`;
    tbody.innerHTML = data.staff.map(s => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>
          <span class="badge" style="${s.isActive ? 'background:rgba(16,185,129,0.2);color:#6ee7b7;' : 'background:rgba(248,113,113,0.15);color:#f87171;'}">
            ${s.isActive ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <button class="btn btn-ghost btn-sm" data-toggle-staff="${s.id}" data-active="${s.isActive}">
            ${s.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `).join('');
    tbody.dataset.loaded = '1';

    tbody.querySelectorAll('[data-toggle-staff]').forEach(btn => {
      btn.addEventListener('click', () => toggleStaff(
        parseInt(btn.dataset.toggleStaff, 10),
        btn.dataset.active === 'true' ? false : true
      ));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty" style="color:#f87171;">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function toggleStaff(staffId, isActive) {
  try {
    await adminRequest('/api/admin/staff/toggle', { staffId, isActive });
    showToast(`Staff ${isActive ? 'activated' : 'deactivated'}`, 'success');
    loadStaff();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function addStaff() {
  const nameInput = document.getElementById('new-staff-name');
  const pinInput = document.getElementById('new-staff-pin');
  const btn = document.getElementById('confirm-add-staff');
  const name = nameInput.value.trim();
  const pin = pinInput.value.trim();

  if (!name || !pin) {
    showToast('Name and PIN required', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    await adminRequest('/api/admin/staff/add', { name, pin });
    showToast('Staff added', 'success');
    nameInput.value = '';
    pinInput.value = '';
    document.getElementById('modal-add-staff').classList.remove('show');
    loadStaff();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Staff';
  }
}

// ============================================================
// Transactions
// ============================================================
async function loadTransactions() {
  const tbody = document.getElementById('transactions-tbody');
  const sub = document.getElementById('transactions-sub');
  tbody.innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
  try {
    const data = await adminRequest('/api/admin/transactions', { limit: 100 });
    sub.textContent = `${data.transactions.length} recent transactions`;
    if (data.transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No transactions yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.transactions.map(t => `
      <tr>
        <td>${formatDate(t.createdAt)}</td>
        <td>${escapeHtml(t.customerName)}</td>
        <td>${escapeHtml(t.phoneNumber)}</td>
        <td>R ${escapeHtml(t.amountRands)}</td>
        <td>${escapeHtml(t.type)}</td>
        <td><span class="badge">${escapeHtml(t.status)}</span></td>
      </tr>
    `).join('');
    tbody.dataset.loaded = '1';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:#f87171;">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ============================================================
// Wire up
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', attemptLogin);
  document.getElementById('login-pin').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') attemptLogin();
  });
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  document.getElementById('reload-alerts-btn').addEventListener('click', loadAlerts);
  document.getElementById('resolve-all-btn').addEventListener('click', resolveAllAlerts);
  document.getElementById('reload-products-btn').addEventListener('click', () => {
    document.getElementById('products-container').dataset.loaded = '';
    loadProducts();
  });
  document.getElementById('reload-transactions-btn').addEventListener('click', () => {
    document.getElementById('transactions-tbody').dataset.loaded = '';
    loadTransactions();
  });

  document.getElementById('add-staff-btn').addEventListener('click', () => {
    document.getElementById('modal-add-staff').classList.add('show');
  });
  document.getElementById('cancel-add-staff').addEventListener('click', () => {
    document.getElementById('modal-add-staff').classList.remove('show');
  });
  document.getElementById('confirm-add-staff').addEventListener('click', addStaff);

  document.getElementById('close-tags-modal').addEventListener('click', () => {
    document.getElementById('modal-tags').classList.remove('show');
  });
  document.getElementById('add-tag-btn').addEventListener('click', addTag);

  // If we already have a token in sessionStorage, auto-enter
  if (token && staffName) {
    enterAdmin();
  }
});