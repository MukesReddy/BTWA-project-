// middleware/rateLimiters.js
// Request rate limiting (brute-force / abuse protection).
// BTWA Module 9: Third-party middleware, BTWA Module 10: Authentication security
//
// Counters live in this process's memory (express-rate-limit's MemoryStore). That is correct for the
// single Node process this project runs as; a multi-server deployment would need a shared store.
// Behind a reverse proxy, set TRUST_PROXY (see config/env.js) so `req.ip` is the real client, not the proxy.

const { rateLimit, ipKeyGenerator, MINUTE, HOUR } = require("express-rate-limit");

/** Default limits. Every one is per client IP unless the comment says otherwise. */
const DEFAULT_LIMITS = Object.freeze({
  api: { windowMs: 15 * MINUTE, limit: 500 },        // everything under /api
  login: { windowMs: 15 * MINUTE, limit: 10 },       // per IP + email: stops guessing one account's password
  loginPerIp: { windowMs: 15 * MINUTE, limit: 30 },  // per IP: stops trying many accounts (credential stuffing)
  register: { windowMs: HOUR, limit: 10 },           // account-creation spam
  orders: { windowMs: 15 * MINUTE, limit: 20 },      // per logged-in user (IP if somehow anonymous)
});

const passthrough = (req, res, next) => next();

const waitText = (req) => {
  const ms = req.rateLimit && req.rateLimit.resetTime ? req.rateLimit.resetTime - Date.now() : 0;
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
};

const build = (name, { windowMs, limit }, message, extra = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7", // RateLimit + Retry-After headers
    legacyHeaders: false,
    // Same {success, message} shape as every other API error.
    handler: (req, res) =>
      res.status(429).json({
        success: false,
        message: `${message} Please try again in ${waitText(req)}.`,
        code: "RATE_LIMITED",
        limiter: name,
      }),
    ...extra,
  });

const emailOf = (req) =>
  req.body && typeof req.body.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";

/**
 * createRateLimiters
 * @param {{enabled?: boolean, limits?: object}} options
 *        limits: partial overrides of DEFAULT_LIMITS (used by tests to use tiny numbers)
 * @returns {{api, login, loginPerIp, register, orders}} Express middleware
 */
const createRateLimiters = ({ enabled = true, limits = {} } = {}) => {
  if (!enabled) {
    return { api: passthrough, login: passthrough, loginPerIp: passthrough, register: passthrough, orders: passthrough };
  }
  const l = (key) => ({ ...DEFAULT_LIMITS[key], ...(limits[key] || {}) });

  return {
    api: build("api", l("api"), "Too many requests."),
    login: build("login", l("login"), "Too many login attempts for this account.", {
      skipSuccessfulRequests: true, // only failed logins count
      keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${emailOf(req)}`,
    }),
    loginPerIp: build("loginPerIp", l("loginPerIp"), "Too many failed login attempts from this network.", {
      skipSuccessfulRequests: true,
    }),
    register: build("register", l("register"), "Too many accounts created from this network."),
    orders: build("orders", l("orders"), "You are placing orders too quickly.", {
      keyGenerator: (req) => (req.session && req.session.userId ? `user:${req.session.userId}` : ipKeyGenerator(req.ip)),
    }),
  };
};

module.exports = { createRateLimiters, DEFAULT_LIMITS };
