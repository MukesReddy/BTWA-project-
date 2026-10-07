// public/js/main.js
// Shared utilities used by all pages

const API_BASE = '/api';

/* ── HTML escaping (XSS defence) ────────────────────────────
   Everything that comes from the API (names, descriptions, addresses…)
   is untrusted text. Always pass it through esc() before putting it
   inside an innerHTML template. Prefer textContent when possible.      */
function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (ch) => map[ch]);
}
const esc = escapeHtml;

/* ── Event delegation for data-action buttons ───────────────
   Replaces inline onclick="fn('${name}')" handlers. Values travel in
   data-* attributes (escaped with esc()), so a quote or <script> in a
   food name can never break out of the attribute or run as code.
   Usage:  <button data-action="addToCart" data-id="..." data-name="...">
           registerActions({ addToCart: (data) => addToCart(data.id, data.name) }); */
function registerActions(handlers) {
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const handler = handlers[el.dataset.action];
    if (typeof handler === 'function') handler(el.dataset, el, event);
  });
}

/* ── CSRF token ─────────────────────────────────────────────
   Every state-changing request (POST/PUT/PATCH/DELETE) must carry the
   per-session secret in the X-CSRF-Token header. Pages from OTHER sites
   cannot read it (no CORS), so they cannot forge our requests even though
   the browser would attach the session cookie. The token is fetched lazily
   and cached; it changes whenever the session changes (login / logout).   */
let csrfToken = null;

async function getCsrfToken() {
  if (!csrfToken) {
    const res = await fetch(API_BASE + '/auth/csrf', { credentials: 'include' });
    const json = await res.json();
    csrfToken = json && json.data ? json.data.csrfToken : null;
  }
  return csrfToken;
}

/* ── API Helper ─────────────────────────────────────────── */
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

async function apiCall(method, endpoint, body = null, alreadyRetried = false) {
  const verb = method.toUpperCase();
  const writes = !SAFE_METHODS.includes(verb);

  const headers = { 'Content-Type': 'application/json' };
  if (writes) {
    try {
      headers['X-CSRF-Token'] = await getCsrfToken();
    } catch {
      return { ok: false, status: 0, data: { success: false, message: 'Could not reach the server. Please try again.' } };
    }
  }

  const opts = {
    method: verb,
    headers,
    credentials: 'include', // Send session cookie
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(API_BASE + endpoint, opts);
  let data;
  try {
    data = await res.json();
  } catch {
    data = { success: false, message: 'Unexpected response from the server' };
  }

  // Logging in or out replaces the server session, so the old token is dead.
  if (endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/logout')) csrfToken = null;

  // Token rejected (session expired / replaced in another tab): fetch a fresh one and retry once.
  if (writes && res.status === 403 && data && data.code === 'CSRF_TOKEN' && !alreadyRetried) {
    csrfToken = null;
    return apiCall(method, endpoint, body, true);
  }

  return { ok: res.ok, status: res.status, data };
}

/* ── Safe post-login redirect ───────────────────────────────
   login.html?redirect=... is attacker-controllable (it can be put in a link),
   so a naive `window.location.href = redirect` is an open redirect / phishing
   hop (and `javascript:` URLs would run script). Only same-origin paths to
   OUR OWN pages are accepted; anything else falls back to the menu.        */
const ALLOWED_REDIRECT_PATHS = [
  '/', '/index.html', '/menu.html', '/food-details.html', '/cart.html', '/checkout.html',
  '/orders.html', '/profile.html', '/admin.html', '/admin-users.html', '/admin-food.html',
  '/admin-categories.html', '/admin-orders.html',
];

function safeRedirect(target, fallback = '/menu.html') {
  if (typeof target !== 'string' || target.length === 0 || target.length > 300) return fallback;
  if (target[0] !== '/' || target[1] === '/' || target.includes('\\')) return fallback; // "//evil.com", "/\evil.com", "https://..."
  if (/[\u0000-\u001f\u007f]/.test(target)) return fallback;                           // control characters / header tricks
  let url;
  try {
    url = new URL(target, window.location.origin);
  } catch {
    return fallback;
  }
  if (url.origin !== window.location.origin) return fallback;
  if (!ALLOWED_REDIRECT_PATHS.includes(url.pathname)) return fallback;
  return url.pathname + url.search;
}

/* Single place that changes the page (so tests can observe it). */
function navigateTo(url) {
  window.location.href = url;
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
  // textContent (never innerHTML): toast messages can contain user data such as food names
  const iconEl = document.createElement('span');
  iconEl.style.fontSize = '1.1rem';
  iconEl.textContent = icons[type] || icons.info;
  const textEl = document.createElement('span');
  textEl.textContent = message;
  toast.append(iconEl, textEl);

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
// The message is escaped by default. Pass { html: true } ONLY for trusted,
// hard-coded markup (e.g. a login link) — never for server or user text.
function showAlert(containerId, message, type = 'error', options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const content = options.html ? message : escapeHtml(message);
  el.innerHTML = `<div class="alert alert-${type}">${content}</div>`;
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
  return `<span class="badge ${map[status] || 'badge-pending'}">${esc(status)}</span>`;
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
            👤 ${esc(user.name.split(' ')[0])}
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
