// public/js/main.js
// Shared utilities used by all pages

const API_BASE = '/api';

/* ── API Helper ─────────────────────────────────────────── */
async function apiCall(method, endpoint, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // Send session cookie
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(API_BASE + endpoint, opts);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

/* ── Toast Notification ─────────────────────────────────── */
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.className = 'toast-container';
  container.style.cssText = `
    position: fixed; bottom: 2rem; right: 2rem; z-index: 9999;
    display: flex; flex-direction: column; gap: 0.5rem;
  `;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const colors = {
    success: 'rgba(34,197,94,0.12)', error: 'rgba(239,68,68,0.12)',
    warning: 'rgba(245,158,11,0.12)', info: 'rgba(59,130,246,0.12)'
  };
  const borders = {
    success: 'rgba(34,197,94,0.3)', error: 'rgba(239,68,68,0.3)',
    warning: 'rgba(245,158,11,0.3)', info: 'rgba(59,130,246,0.3)'
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: var(--bg-card); border: 1px solid ${borders[type]};
    border-radius: 12px; padding: 0.9rem 1.25rem;
    display: flex; align-items: center; gap: 0.75rem;
    font-family: var(--font); font-size: 0.9rem; color: var(--text-primary);
    box-shadow: 0 8px 30px rgba(0,0,0,0.4); max-width: 340px;
    animation: slideInRight 0.3s ease;
  `;
  toast.innerHTML = `
    <span style="font-size:1.1rem">${icons[type]}</span>
    <span>${message}</span>
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
    @keyframes slideOutRight { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(20px); } }
  `;
  document.head.appendChild(style);

  container.appendChild(toast);
  document.body.appendChild(container);

  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease forwards';
    setTimeout(() => container.remove(), 300);
  }, 3500);
}

/* ── Alert in container ─────────────────────────────────── */
function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

/* ── Auth State ─────────────────────────────────────────── */
let currentUser = null;

async function fetchCurrentUser() {
  try {
    const { ok, data } = await apiCall('GET', '/auth/me');
    if (ok) {
      currentUser = data.data.user;
      return currentUser;
    }
  } catch {}
  currentUser = null;
  return null;
}

/* ── Status Badge ───────────────────────────────────────── */
function statusBadge(status) {
  const map = {
    'Pending':         'badge-pending',
    'Confirmed':       'badge-confirmed',
    'Preparing':       'badge-preparing',
    'Out for Delivery':'badge-outfordelivery',
    'Delivered':       'badge-delivered',
    'Cancelled':       'badge-cancelled',
  };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status}</span>`;
}

/* ── Format Currency ────────────────────────────────────── */
function formatPrice(amount) {
  return `₹${Number(amount).toFixed(2)}`;
}

/* ── Format Date ────────────────────────────────────────── */
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/* ── Navbar render ──────────────────────────────────────── */
async function renderNavbar() {
  const user = await fetchCurrentUser();
  const nav = document.getElementById('navbar');
  if (!nav) return;

  const isAdmin = user?.role === 'admin';

  nav.innerHTML = `
    <a href="/index.html" class="nav-brand">
      <span class="logo-icon">🍔</span>
      <span>Foodie<span>Hub</span></span>
    </a>

    <ul class="nav-links" id="navLinks">
      <li><a href="/index.html">Home</a></li>
      <li><a href="/menu.html">Menu</a></li>
      ${user ? `<li><a href="/orders.html">My Orders</a></li>` : ''}
      ${isAdmin ? `<li><a href="/admin.html">Admin</a></li>` : ''}
    </ul>

    <div class="nav-actions">
      ${user ? `
        <a href="/cart.html" class="cart-badge" id="cartBadgeLink">
          🛒 <span id="cartCount">0</span>
        </a>
        <div style="position:relative">
          <button class="btn btn-ghost btn-sm" id="userMenuBtn" style="gap:.4rem">
            👤 ${user.name.split(' ')[0]}
          </button>
          <div id="userDropdown" class="hidden" style="
            position:absolute;right:0;top:calc(100% + 8px);
            background:var(--bg-card);border:1px solid var(--border);
            border-radius:12px;padding:.5rem;min-width:160px;z-index:200;
            box-shadow:0 8px 30px rgba(0,0,0,.4)
          ">
            <a href="/profile.html" style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:8px;color:var(--text-secondary);font-size:.9rem;font-weight:500;transition:.2s">👤 Profile</a>
            <a href="/orders.html" style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:8px;color:var(--text-secondary);font-size:.9rem;font-weight:500;transition:.2s">📋 My Orders</a>
            ${isAdmin ? `<a href="/admin.html" style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:8px;color:var(--primary);font-size:.9rem;font-weight:500;transition:.2s">⚙️ Admin Panel</a>` : ''}
            <hr style="border:none;border-top:1px solid var(--border);margin:.4rem 0">
            <button id="logoutBtn" style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:8px;color:#ef4444;font-size:.9rem;font-weight:500;background:none;border:none;width:100%;cursor:pointer;transition:.2s">🚪 Logout</button>
          </div>
        </div>
      ` : `
        <a href="/login.html" class="btn btn-ghost btn-sm">Login</a>
        <a href="/register.html" class="btn btn-primary btn-sm">Sign Up</a>
      `}
      <button class="hamburger" id="hamburger" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;

  // Highlight active link
  const links = nav.querySelectorAll('.nav-links a');
  links.forEach(link => {
    if (link.href === window.location.href) link.classList.add('active');
  });

  // Hamburger
  document.getElementById('hamburger')?.addEventListener('click', () => {
    document.getElementById('navLinks').style.display =
      document.getElementById('navLinks').style.display === 'flex' ? 'none' : 'flex';
  });

  // User dropdown
  const userBtn = document.getElementById('userMenuBtn');
  const dropdown = document.getElementById('userDropdown');
  userBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', () => dropdown?.classList.add('hidden'));

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await apiCall('POST', '/auth/logout');
    showToast('Logged out successfully', 'success');
    setTimeout(() => window.location.href = '/login.html', 800);
  });

  // Scroll effect
  window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 20);
  });

  // Load cart count
  if (user) loadCartCount();
}

/* ── Cart Count ─────────────────────────────────────────── */
async function loadCartCount() {
  try {
    const { ok, data } = await apiCall('GET', '/cart');
    if (ok) {
      const count = data.data?.items?.length || 0;
      const el = document.getElementById('cartCount');
      if (el) el.textContent = count;
    }
  } catch {}
}

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderNavbar();
});
