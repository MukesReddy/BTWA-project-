// P1.2 — startup / configuration hardening (config/env.js). Pure function tests: no server, no DB.

const { loadConfig, ConfigError } = require("../../config/env");

const GOOD_SECRET = "a".repeat(8) + "Zk3!" + "b".repeat(24); // 36 chars, not a placeholder
const production = (over = {}) => ({
  NODE_ENV: "production",
  MONGO_URI: "mongodb://127.0.0.1:27017/food",
  SESSION_SECRET: GOOD_SECRET,
  ...over,
});

const problemsOf = (env) => {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error.problems;
  }
  throw new Error("expected loadConfig to throw");
};

describe("production refuses to start with unsafe configuration", () => {
  test("a valid production config loads", () => {
    const c = loadConfig(production());
    expect(c.isProduction).toBe(true);
    expect(c.cookie.secure).toBe(true);
    expect(c.sessionSecret).toBe(GOOD_SECRET);
  });

  test.each([
    ["missing", undefined],
    ["empty", "   "],
    ["the old hard-coded fallback", "fallback_secret"],
    ["the .env.example placeholder", "replace_with_a_strong_random_secret_here"],
    ["too short", "short-secret"],
  ])("SESSION_SECRET %s → refused", (_label, value) => {
    const env = production();
    if (value === undefined) delete env.SESSION_SECRET;
    else env.SESSION_SECRET = value;
    expect(problemsOf(env).join("\n")).toMatch(/SESSION_SECRET/);
  });

  test("missing MONGO_URI → refused; a non-mongodb URI → refused", () => {
    expect(problemsOf(production({ MONGO_URI: "" })).join()).toMatch(/MONGO_URI is required/);
    expect(problemsOf(production({ MONGO_URI: "http://example.com" })).join()).toMatch(/must start with/);
  });

  test("a mistyped NODE_ENV is refused instead of silently disabling production protections", () => {
    expect(problemsOf(production({ NODE_ENV: "prod" })).join()).toMatch(/NODE_ENV must be one of/);
  });

  test("every problem is reported at once", () => {
    const problems = problemsOf({ NODE_ENV: "production", PORT: "abc" });
    expect(problems.length).toBeGreaterThanOrEqual(3); // PORT, MONGO_URI, SESSION_SECRET
  });

  test.each(["0", "70000", "abc", "5000.5"])("PORT=%s is refused", (port) => {
    expect(problemsOf(production({ PORT: port })).join()).toMatch(/PORT/);
  });
});

describe("development never falls back to a publicly known secret", () => {
  test("missing secret → random per-run secret + a warning", () => {
    const a = loadConfig({ NODE_ENV: "development", MONGO_URI: "mongodb://x/y" });
    const b = loadConfig({ NODE_ENV: "development", MONGO_URI: "mongodb://x/y" });
    expect(a.sessionSecret).toHaveLength(96);
    expect(a.sessionSecret).not.toBe("fallback_secret");
    expect(a.sessionSecret).not.toBe(b.sessionSecret);
    expect(a.warnings.join()).toMatch(/SESSION_SECRET/);
  });

  test("the .env.example placeholder is treated as missing", () => {
    const c = loadConfig({ MONGO_URI: "mongodb://x/y", SESSION_SECRET: "replace_with_a_strong_random_secret_here" });
    expect(c.sessionSecret).not.toMatch(/replace_with/);
  });

  test("NODE_ENV defaults to development; a real secret is kept", () => {
    const c = loadConfig({ MONGO_URI: "mongodb://x/y", SESSION_SECRET: "my-dev-secret-value" });
    expect(c.nodeEnv).toBe("development");
    expect(c.sessionSecret).toBe("my-dev-secret-value");
    expect(c.warnings).toEqual([]);
  });

  test("MONGO_URI is still required outside tests", () => {
    expect(problemsOf({ NODE_ENV: "development" }).join()).toMatch(/MONGO_URI/);
  });

  test("tests need no MONGO_URI", () => {
    expect(() => loadConfig({ NODE_ENV: "test" })).not.toThrow();
  });
});

describe("cookie, CORS, proxy, rate-limit and demo settings", () => {
  test("session cookie is HttpOnly + SameSite=Lax; Secure only in production (overridable)", () => {
    const dev = loadConfig({ NODE_ENV: "development", MONGO_URI: "mongodb://x/y", SESSION_SECRET: "s".repeat(10) });
    expect(dev.cookie).toMatchObject({ httpOnly: true, sameSite: "lax", secure: false, name: "foodiehub.sid" });
    const prod = loadConfig(production());
    expect(prod.cookie.secure).toBe(true);
    const plainHttp = loadConfig(production({ COOKIE_SECURE: "false" }));
    expect(plainHttp.cookie.secure).toBe(false);
    expect(plainHttp.warnings.join()).toMatch(/COOKIE_SECURE=false/);
    expect(problemsOf(production({ COOKIE_SECURE: "maybe" })).join()).toMatch(/COOKIE_SECURE/);
  });

  test("by default NO other origin is trusted; CORS_ORIGINS is parsed, normalised and validated", () => {
    expect(loadConfig(production()).trustedOrigins).toEqual([]);
    const c = loadConfig(production({ CORS_ORIGINS: "https://Shop.example.com/, http://localhost:3000 ,https://shop.example.com" }));
    expect(c.trustedOrigins).toEqual(["https://shop.example.com", "http://localhost:3000"]);
    expect(problemsOf(production({ CORS_ORIGINS: "*" })).join()).toMatch(/not allowed/);
    expect(problemsOf(production({ CORS_ORIGINS: "javascript:alert(1)" })).join()).toMatch(/valid http\(s\) origin/);
    expect(problemsOf(production({ CORS_ORIGINS: "shop.example.com" })).join()).toMatch(/valid http\(s\) origin/);
  });

  test("TRUST_PROXY accepts false / a hop count / true (with a warning) and rejects junk", () => {
    expect(loadConfig(production()).trustProxy).toBe(false);
    expect(loadConfig(production({ TRUST_PROXY: "1" })).trustProxy).toBe(1);
    const all = loadConfig(production({ TRUST_PROXY: "true" }));
    expect(all.trustProxy).toBe(true);
    expect(all.warnings.join()).toMatch(/spoof/);
    expect(problemsOf(production({ TRUST_PROXY: "everyone" })).join()).toMatch(/TRUST_PROXY/);
  });

  test("production with Secure cookies but no TRUST_PROXY warns", () => {
    expect(loadConfig(production()).warnings.join()).toMatch(/TRUST_PROXY/);
    expect(loadConfig(production({ TRUST_PROXY: "1" })).warnings.join()).not.toMatch(/Secure cookies/);
  });

  test("rate limiting is on unless explicitly disabled (and disabling in production warns)", () => {
    expect(loadConfig(production()).rateLimitEnabled).toBe(true);
    const off = loadConfig(production({ RATE_LIMIT_DISABLED: "true" }));
    expect(off.rateLimitEnabled).toBe(false);
    expect(off.warnings.join()).toMatch(/RATE_LIMIT_DISABLED/);
  });

  test("demo login: on in development, OFF in production unless explicitly enabled", () => {
    const base = { MONGO_URI: "mongodb://x/y", SESSION_SECRET: "s".repeat(10) };
    expect(loadConfig({ ...base, NODE_ENV: "development" }).demoLoginEnabled).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: "development", ENABLE_DEMO_LOGIN: "false" }).demoLoginEnabled).toBe(false);
    expect(loadConfig(production()).demoLoginEnabled).toBe(false);
    const on = loadConfig(production({ ENABLE_DEMO_LOGIN: "true" }));
    expect(on.demoLoginEnabled).toBe(true);
    expect(on.warnings.join()).toMatch(/ENABLE_DEMO_LOGIN/);
  });

  test("the returned config is frozen", () => {
    const c = loadConfig(production());
    expect(Object.isFrozen(c)).toBe(true);
    expect(() => { "use strict"; c.nodeEnv = "x"; }).toThrow();
  });
});

describe("UPI payment settings", () => {
  const dev = (over = {}) => ({ NODE_ENV: "development", MONGO_URI: "mongodb://x/y", SESSION_SECRET: "s".repeat(10), ...over });

  test("nothing set → UPI is off, the webhook is off, the window defaults to 15 minutes (Cash on Delivery needs no setup)", () => {
    expect(loadConfig(dev()).payment).toEqual({
      upiEnabled: false, upiId: "", upiPayeeName: "", windowMinutes: 15, webhookSecret: "", webhookEnabled: false,
    });
  });

  test("a valid UPI_ID turns UPI on; the payee name defaults to FoodieHub; the settings are frozen", () => {
    const c = loadConfig(dev({ UPI_ID: "shop.name@okicici" }));
    expect(c.payment).toMatchObject({ upiEnabled: true, upiId: "shop.name@okicici", upiPayeeName: "FoodieHub" });
    expect(Object.isFrozen(c.payment)).toBe(true);
    expect(loadConfig(dev({ UPI_ID: "9876543210@ybl", UPI_PAYEE_NAME: " Asha's Kitchen " })).payment.upiPayeeName).toBe("Asha's Kitchen");
  });

  test.each(["shop", "shop@", "@bank", "sh op@bank", "shop@bank@x", "shop@1bank", "<b>@bank", "a@b", `${"x".repeat(70)}@bank`])(
    "malformed UPI_ID %p is a startup problem",
    (upiId) => {
      expect(problemsOf(dev({ UPI_ID: upiId })).join()).toMatch(/UPI_ID/);
    }
  );

  test("payee name: control characters, angle brackets and over-long names are rejected", () => {
    for (const name of ["a<b", "a\nb", "x".repeat(61)]) {
      expect(problemsOf(dev({ UPI_ID: "shop@okicici", UPI_PAYEE_NAME: name })).join()).toMatch(/UPI_PAYEE_NAME/);
    }
  });

  test("payment window: whole minutes 2-120 only", () => {
    expect(loadConfig(dev({ UPI_PAYMENT_WINDOW_MINUTES: "30" })).payment.windowMinutes).toBe(30);
    for (const bad of ["1", "121", "abc", "1.5", "-5"]) {
      expect(problemsOf(dev({ UPI_PAYMENT_WINDOW_MINUTES: bad })).join()).toMatch(/UPI_PAYMENT_WINDOW_MINUTES/);
    }
  });

  test("webhook secret: 32+ characters and not a placeholder, or the server refuses to start", () => {
    const good = "q".repeat(12) + "Zk3!" + "r".repeat(20);
    const c = loadConfig(dev({ PAYMENT_WEBHOOK_SECRET: good }));
    expect(c.payment.webhookEnabled).toBe(true);
    expect(c.payment.webhookSecret).toBe(good);
    expect(problemsOf(dev({ PAYMENT_WEBHOOK_SECRET: "short-secret" })).join()).toMatch(/PAYMENT_WEBHOOK_SECRET/);
    expect(problemsOf(dev({ PAYMENT_WEBHOOK_SECRET: "replace_with_a_strong_random_secret_here" })).join()).toMatch(/PAYMENT_WEBHOOK_SECRET/);
  });

  test("production: UPI without a webhook secret is allowed (admin verification) but warns", () => {
    const c = loadConfig(production({ UPI_ID: "shop@okicici" }));
    expect(c.payment.upiEnabled).toBe(true);
    expect(c.warnings.join()).toMatch(/without PAYMENT_WEBHOOK_SECRET/);
    expect(loadConfig(production()).warnings.join()).not.toMatch(/PAYMENT_WEBHOOK_SECRET/);
  });

  test("the config never echoes a rejected UPI_ID or secret back in the error text", () => {
    const text = problemsOf(dev({ UPI_ID: "bad id@x", PAYMENT_WEBHOOK_SECRET: "tooshort-secret-value" })).join(" ");
    expect(text).not.toContain("bad id@x");
    expect(text).not.toContain("tooshort-secret-value");
  });
});
