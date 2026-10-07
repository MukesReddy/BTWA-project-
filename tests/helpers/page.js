// tests/helpers/page.js
// Runs the REAL front-end pages (public/*.html + public/js/main.js) inside jsdom.
//  • HTML and JS are read from /public exactly as the browser would receive them.
//  • window.fetch is replaced by a stub so every /api call returns fixture data
//    and is recorded in window.__calls.
// Used to prove that hostile strings render as plain text and that buttons keep working
// when names contain quotes/apostrophes.

const fs = require("fs");
const path = require("path");
const { JSDOM, ResourceLoader, VirtualConsole } = require("jsdom");

const PUBLIC_DIR = path.join(__dirname, "../../public");
const baseUrl = "http://localhost";

// Kept so test files read naturally; pages are read straight from /public (no server needed).
const startServer = async () => baseUrl;
const stopServer = async () => {};

// Serve our own .js files from /public; skip Google Fonts, CSS, images… (no network, faster)
class LocalScriptsOnly extends ResourceLoader {
  fetch(url) {
    const { pathname } = new URL(url);
    const file = path.join(PUBLIC_DIR, pathname);
    if (pathname.endsWith(".js") && file.startsWith(PUBLIC_DIR) && fs.existsSync(file)) {
      return Promise.resolve(fs.readFileSync(file));
    }
    return Promise.resolve(Buffer.from(""));
  }
}

const ok = (data, message = "OK") => ({ status: 200, body: { success: true, message, data } });

/**
 * @param {string} path           e.g. "/menu.html?category=abc"
 * @param {object} options
 * @param {object} options.user   logged-in user returned by GET /api/auth/me (null = logged out)
 * @param {object} options.routes { "GET /api/foods": data | (body, url) => ({status, body}) }
 * @param {boolean} options.confirm value returned by window.confirm
 */
const loadPage = async (path_, { user = null, routes = {}, confirm = true } = {}) => {
  const calls = [];

  let csrfCounter = 0;
  const table = {
    "GET /api/auth/csrf": () => ok({ csrfToken: `token-${++csrfCounter}` }),
    "GET /api/auth/me": user ? ok({ user }) : { status: 401, body: { success: false, message: "Authentication required" } },
    "GET /api/cart": ok({ items: [], total: 0 }),
    ...Object.fromEntries(
      Object.entries(routes).map(([key, value]) => [
        key,
        typeof value === "function" || (value && value.status && value.body) ? value : ok(value),
      ])
    ),
  };

  const fetchStub = async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const pathname = String(url).split("?")[0];
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url: String(url), pathname, body, headers: opts.headers || {} });

    let entry = table[`${method} ${pathname}`];
    if (typeof entry === "function") entry = entry(body, String(url));
    if (!entry) entry = { status: 404, body: { success: false, message: `no stub for ${method} ${pathname}` } };
    return { ok: entry.status >= 200 && entry.status < 300, status: entry.status, json: async () => entry.body };
  };

  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => {
    if (!/Not implemented: navigation/.test(e.message)) errors.push(e.message);
  });

  const file = path_.split("?")[0].replace(/^\//, "");
  const html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8");

  const dom = new JSDOM(html, {
    url: baseUrl + path_,
    runScripts: "dangerously",
    resources: new LocalScriptsOnly(),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = fetchStub;
      window.confirm = () => confirm;
      window.alert = () => {};
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });

  // wait until all scripts ran (DOMContentLoaded handlers fire after this)
  if (dom.window.document.readyState !== "complete") {
    await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  }

  return { dom, window: dom.window, document: dom.window.document, calls, errors };
};

/** Poll until fn() is truthy (pages render asynchronously after their fetches resolve). */
const waitFor = async (fn, { timeout = 3000 } = {}) => {
  const start = Date.now();
  for (;;) {
    let value;
    try { value = fn(); } catch { value = null; }
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error("waitFor timed out: " + fn.toString());
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Let in-flight page promises (fetch → render → toast) finish, then dispose of the window. */
const closePage = async (window) => {
  await new Promise((r) => setTimeout(r, 40));
  window.close();
};

module.exports = { startServer, stopServer, loadPage, waitFor, closePage, ok };
