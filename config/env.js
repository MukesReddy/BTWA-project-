// config/env.js
// Reads, validates and normalises ALL environment configuration in one place.
// BTWA Module 4: Configuration / environment variables (process.env, dotenv)
// BTWA Module 5: Custom module, module.exports
//
// Why this exists: before, a missing SESSION_SECRET silently fell back to the publicly
// known string "fallback_secret" (anyone could forge a session cookie), a typo such as
// NODE_ENV=prod silently switched off the production protections, and CORS reflected
// every Origin. Now misconfiguration is either refused at startup (production) or
// replaced by something safe plus a visible warning (development).

const crypto = require("crypto");

const NODE_ENVS = ["development", "production", "test"];
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const MIN_WEBHOOK_SECRET_LENGTH = 32;
// UPI virtual payment address: handle@psp, e.g. shop@okicici. (NPCI: letters, digits, . - _ before the @.)
const UPI_ID_PATTERN = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,48}$/;

// Values people copy from .env.example / tutorials. Never acceptable as a real secret.
const PLACEHOLDER_SECRET = /(replace_with|fallback_secret|changeme|change_me|your[_-]?secret|secret123|example)/i;

class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const isBlank = (value) => value === undefined || String(value).trim() === "";

/** "true"/"false" (case-insensitive) → boolean; anything else → undefined. */
const parseBool = (value) => {
  if (isBlank(value)) return undefined;
  const v = String(value).trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
};

/** Normalises "https://Shop.example.com/" → "https://shop.example.com"; null if not an http(s) origin. */
const normalizeOrigin = (value) => {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
};

/**
 * loadConfig
 * @param {object} env  usually process.env (a plain object in tests)
 * @returns {object} frozen configuration
 * @throws {ConfigError} listing EVERY problem at once (not just the first one)
 */
const loadConfig = (env = process.env) => {
  const problems = [];
  const warnings = [];

  // ── NODE_ENV ────────────────────────────────────────────────────────────
  const nodeEnv = isBlank(env.NODE_ENV) ? "development" : String(env.NODE_ENV).trim();
  if (!NODE_ENVS.includes(nodeEnv)) {
    problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(", ")} (got "${nodeEnv}"). A typo here would silently disable production protections.`);
  }
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";

  // ── PORT ────────────────────────────────────────────────────────────────
  let port = 5000;
  if (!isBlank(env.PORT)) {
    port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`PORT must be an integer between 1 and 65535 (got "${env.PORT}")`);
    }
  }

  // ── MONGO_URI ───────────────────────────────────────────────────────────
  const mongoUri = isBlank(env.MONGO_URI) ? "" : String(env.MONGO_URI).trim();
  if (!isTest) {
    if (!mongoUri) {
      problems.push("MONGO_URI is required (e.g. mongodb://127.0.0.1:27017/online_food_ordering)");
    } else if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
      problems.push('MONGO_URI must start with "mongodb://" or "mongodb+srv://"');
    }
  }

  // ── SESSION_SECRET ──────────────────────────────────────────────────────
  let sessionSecret = isBlank(env.SESSION_SECRET) ? "" : String(env.SESSION_SECRET);
  const secretIsPlaceholder = PLACEHOLDER_SECRET.test(sessionSecret);
  if (isProduction) {
    if (!sessionSecret) {
      problems.push("SESSION_SECRET is required in production");
    } else if (secretIsPlaceholder) {
      problems.push("SESSION_SECRET is still a placeholder value — generate a real one (node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\")");
    } else if (sessionSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      problems.push(`SESSION_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production (got ${sessionSecret.length})`);
    }
  } else if (!sessionSecret || secretIsPlaceholder) {
    // Development: never fall back to a publicly known string.
    sessionSecret = crypto.randomBytes(48).toString("hex");
    if (!isTest) {
      warnings.push("SESSION_SECRET is missing or a placeholder: using a random one for this run. Everyone is logged out whenever the server restarts. Set a real SESSION_SECRET in .env.");
    }
  }

  // ── Trusted origins (CORS + CSRF allow-list) ───────────────────────────
  // The frontend is served by this same Express app, so by default NO other origin is trusted.
  const trustedOrigins = [];
  if (!isBlank(env.CORS_ORIGINS)) {
    for (const raw of String(env.CORS_ORIGINS).split(",")) {
      const entry = raw.trim();
      if (!entry) continue;
      const origin = normalizeOrigin(entry);
      if (!origin || entry === "*") {
        problems.push(`CORS_ORIGINS entry "${entry}" is not a valid http(s) origin such as https://shop.example.com ("*" is not allowed because cookies are used)`);
      } else if (!trustedOrigins.includes(origin)) {
        trustedOrigins.push(origin);
      }
    }
  }

  // ── Reverse proxy ───────────────────────────────────────────────────────
  // Needed for req.ip (rate limiting) and secure cookies when behind nginx/Heroku/Render…
  let trustProxy = false;
  if (!isBlank(env.TRUST_PROXY)) {
    const v = String(env.TRUST_PROXY).trim().toLowerCase();
    if (v === "true") trustProxy = true;
    else if (v === "false") trustProxy = false;
    else if (/^\d+$/.test(v)) trustProxy = Number(v);
    else problems.push(`TRUST_PROXY must be true, false, or a number of proxy hops (got "${env.TRUST_PROXY}")`);
  }
  if (trustProxy === true) {
    warnings.push("TRUST_PROXY=true trusts every X-Forwarded-For hop, so clients can spoof their IP and dodge rate limits. Prefer the exact number of proxies (e.g. TRUST_PROXY=1).");
  }

  // ── Session cookie ──────────────────────────────────────────────────────
  let cookieSecure = isProduction;
  if (!isBlank(env.COOKIE_SECURE)) {
    const parsed = parseBool(env.COOKIE_SECURE);
    if (parsed === undefined) problems.push(`COOKIE_SECURE must be true or false (got "${env.COOKIE_SECURE}")`);
    else cookieSecure = parsed;
  }
  if (isProduction && !cookieSecure) {
    warnings.push("COOKIE_SECURE=false in production: the session cookie will be sent over plain HTTP.");
  }
  if (isProduction && cookieSecure && !trustProxy) {
    warnings.push("Secure cookies are on but TRUST_PROXY is not set. If a TLS-terminating proxy sits in front of this app, logins will not stick; set TRUST_PROXY=1.");
  }

  // ── Rate limiting ───────────────────────────────────────────────────────
  const rateLimitEnabled = parseBool(env.RATE_LIMIT_DISABLED) !== true;
  if (!rateLimitEnabled && isProduction) {
    warnings.push("RATE_LIMIT_DISABLED=true in production: login and API brute-force protection is OFF.");
  }

  // ── Demo-login helper (login page buttons) ──────────────────────────────
  // On by default outside production; production needs an explicit opt-in.
  const demoOverride = parseBool(env.ENABLE_DEMO_LOGIN);
  if (!isBlank(env.ENABLE_DEMO_LOGIN) && demoOverride === undefined) {
    problems.push(`ENABLE_DEMO_LOGIN must be true or false (got "${env.ENABLE_DEMO_LOGIN}")`);
  }
  const demoLoginEnabled = isProduction ? demoOverride === true : demoOverride !== false;
  if (isProduction && demoLoginEnabled) {
    warnings.push("ENABLE_DEMO_LOGIN=true in production: demo credentials are exposed on the login page.");
  }

  // ── UPI QR payments (optional) ──────────────────────────────────────────
  // Without UPI_ID the "Online UPI QR" option is simply unavailable (Cash on Delivery keeps working).
  // These values are PUBLIC by nature (they are printed inside the QR code); the secret is only the webhook key.
  const upiId = isBlank(env.UPI_ID) ? "" : String(env.UPI_ID).trim();
  if (upiId && !UPI_ID_PATTERN.test(upiId)) {
    problems.push(`UPI_ID must look like name@bank (letters, digits, . _ - before the @), e.g. shop@okbank (got a value of ${upiId.length} characters)`);
  }
  let upiPayeeName = isBlank(env.UPI_PAYEE_NAME) ? "" : String(env.UPI_PAYEE_NAME).trim();
  if (upiId && !upiPayeeName) upiPayeeName = "FoodieHub";
  if (upiPayeeName && (upiPayeeName.length > 60 || /[\u0000-\u001f<>]/.test(upiPayeeName))) {
    problems.push("UPI_PAYEE_NAME must be at most 60 characters and must not contain control characters or < >");
  }
  let upiWindowMinutes = 15;
  if (!isBlank(env.UPI_PAYMENT_WINDOW_MINUTES)) {
    upiWindowMinutes = Number(env.UPI_PAYMENT_WINDOW_MINUTES);
    if (!Number.isInteger(upiWindowMinutes) || upiWindowMinutes < 2 || upiWindowMinutes > 120) {
      problems.push(`UPI_PAYMENT_WINDOW_MINUTES must be a whole number between 2 and 120 (got "${env.UPI_PAYMENT_WINDOW_MINUTES}")`);
    }
  }
  const webhookSecret = isBlank(env.PAYMENT_WEBHOOK_SECRET) ? "" : String(env.PAYMENT_WEBHOOK_SECRET);
  if (webhookSecret && (webhookSecret.length < MIN_WEBHOOK_SECRET_LENGTH || PLACEHOLDER_SECRET.test(webhookSecret))) {
    problems.push(`PAYMENT_WEBHOOK_SECRET must be a real secret of at least ${MIN_WEBHOOK_SECRET_LENGTH} characters (not a placeholder)`);
  }
  if (upiId && !webhookSecret && isProduction) {
    warnings.push("UPI payments are enabled without PAYMENT_WEBHOOK_SECRET: payments can only be confirmed by an admin after checking the bank statement (no automatic verification).");
  }

  if (problems.length) throw new ConfigError(problems);

  return Object.freeze({
    nodeEnv,
    isProduction,
    isTest,
    port,
    mongoUri,
    sessionSecret,
    trustedOrigins: Object.freeze(trustedOrigins),
    trustProxy,
    cookie: Object.freeze({
      name: "foodiehub.sid",
      secure: cookieSecure,
      httpOnly: true,         // JavaScript cannot read the session cookie
      sameSite: "lax",        // not sent on cross-site POST/PUT/DELETE (defence in depth; CSRF tokens are the real control)
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    }),
    rateLimitEnabled,
    demoLoginEnabled,
    payment: Object.freeze({
      upiEnabled: Boolean(upiId),
      upiId,
      upiPayeeName,
      windowMinutes: upiWindowMinutes,
      webhookSecret,                       // empty = webhook endpoint answers 503
      webhookEnabled: Boolean(webhookSecret),
    }),
    warnings: Object.freeze(warnings),
  });
};

let cached;
/** The configuration for the running process (computed once from process.env). */
const getConfig = () => {
  if (!cached) cached = loadConfig(process.env);
  return cached;
};

module.exports = { loadConfig, getConfig, ConfigError, normalizeOrigin };
