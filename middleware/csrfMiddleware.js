// middleware/csrfMiddleware.js
// CSRF protection for a cookie-session API.
// BTWA Module 9: Custom middleware, BTWA Module 10: Sessions, cookies, security
//
// The threat: a logged-in customer visits evil.example, whose page makes the browser send
// POST /api/orders (or an admin DELETE /api/admin/users/:id) to this site WITH the victim's
// session cookie attached. The server must refuse requests that did not come from our own pages.
//
// Why `SameSite` alone is not enough: "same-site" ignores the port and the scheme, so another
// app on localhost:3000 (or evil.yourdomain.com) is "same-site" and its requests still carry
// the cookie. And JSON-only writes alone are not enough either: `fetch` can send a "simple"
// text/plain body that Express could be made to accept, and older/odd clients bypass checks.
//
// So every state-changing request (POST/PUT/PATCH/DELETE) must pass THREE independent checks:
//   1. Origin     — if the browser sent an Origin (it always does on cross-origin writes),
//                   it must be this site or a trusted origin from CORS_ORIGINS.
//   2. Content    — a request with a body must be application/json (HTML forms cannot send it).
//   3. Token      — header X-CSRF-Token must equal the secret stored in the user's session
//                   (synchroniser-token pattern). Another origin cannot read it (no CORS).
// Safe methods (GET/HEAD/OPTIONS) never change state, so they are not checked.

const crypto = require("crypto");
const { normalizeOrigin } = require("../config/env");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER = "x-csrf-token";

const csrfFailure = (res, status, message, code) =>
  res.status(status).json({ success: false, message, code });

/** Constant-time string comparison (hash first so differing lengths do not leak). */
const safeEqual = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/** The session's CSRF secret; created on first use. */
const ensureCsrfToken = (req) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
};

/** Hosts this request may legitimately be addressed to (Host header; X-Forwarded-Host only if we trust the proxy). */
const requestHosts = (req) => {
  const hosts = [];
  const host = req.get("host");
  if (host) hosts.push(host.toLowerCase());
  if (req.app.get("trust proxy")) {
    const forwarded = req.get("x-forwarded-host");
    if (forwarded) hosts.push(forwarded.split(",")[0].trim().toLowerCase());
  }
  return hosts;
};

/** Is `value` (an Origin header, or the origin part of a Referer) one of ours? */
const isTrustedOrigin = (req, value, trustedOrigins) => {
  const origin = normalizeOrigin(value);
  if (!origin) return false; // includes the literal "null" sent by sandboxed iframes / data: pages
  if (trustedOrigins.includes(origin)) return true;
  // Same-origin = same host:port. Scheme is deliberately ignored here because behind a TLS
  // proxy this app sees http while the browser sent https.
  return requestHosts(req).includes(new URL(origin).host.toLowerCase());
};

/**
 * createCsrfProtection
 * @param {{trustedOrigins?: string[]}} options
 */
const createCsrfProtection = ({ trustedOrigins = [] } = {}) => {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    // 1. Origin (falls back to Referer when a client sends no Origin)
    const origin = req.get("origin");
    const referer = req.get("referer");
    if (origin !== undefined) {
      if (!isTrustedOrigin(req, origin, trustedOrigins)) {
        return csrfFailure(res, 403, "Cross-site request blocked: untrusted Origin.", "CSRF_ORIGIN");
      }
    } else if (referer !== undefined && !isTrustedOrigin(req, referer, trustedOrigins)) {
      return csrfFailure(res, 403, "Cross-site request blocked: untrusted Referer.", "CSRF_ORIGIN");
    }

    // 2. Only JSON bodies (an HTML <form> cannot produce Content-Type: application/json)
    const hasBody = Number(req.headers["content-length"]) > 0 || req.headers["transfer-encoding"] !== undefined;
    if (hasBody && !req.is("application/json")) {
      return csrfFailure(res, 415, "Content-Type must be application/json.", "UNSUPPORTED_MEDIA_TYPE");
    }

    // 3. Synchroniser token tied to the session
    const supplied = req.get(CSRF_HEADER);
    const expected = req.session && req.session.csrfToken;
    if (!supplied || !expected || !safeEqual(supplied, expected)) {
      return csrfFailure(
        res,
        403,
        "Missing or invalid CSRF token. Please refresh the page and try again.",
        "CSRF_TOKEN"
      );
    }
    return next();
  };
};

/**
 * @route   GET /api/auth/csrf
 * @desc    Hand the page its CSRF token (readable only by same-origin scripts: no CORS)
 */
const getCsrfToken = (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({ success: true, message: "CSRF token issued", data: { csrfToken: ensureCsrfToken(req) } });
};

module.exports = { createCsrfProtection, getCsrfToken, ensureCsrfToken, safeEqual };
