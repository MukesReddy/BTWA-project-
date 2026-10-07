// P1.5 — CSRF protection. Every test replays what a malicious web page makes a victim's BROWSER send:
// the victim's real session cookie (the browser attaches it automatically) plus whatever headers a
// cross-origin page is able to set. Each attack must be rejected AND must have no side effect.
//
// The DB is mocked (we only assert whether the controller's write was reached). The same attacks run
// against a real MongoDB in tests/integration/security.test.js.
//
// Honest scope: these are protocol-level replays of browser behaviour (Origin header, cookie, content
// type, CORS preflight), not a real browser. The relevant browser rules are: a cross-origin
// fetch/form always carries `Origin`; a page cannot read our CSRF token (no CORS) nor set
// X-CSRF-Token without a preflight, which our CORS policy refuses.

const request = require("supertest");
const app = require("../../server");
const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const Cart = require("../../models/Cart");
const Food = require("../../models/Food");
const User = require("../../models/User");
const { query } = require("../helpers/chain");
const { loginAs, newId } = require("../helpers/auth");
const { newAgent, anonymous, cookieHeader, originFor, serverFor, refreshCsrf } = require("../helpers/client");

const EVIL = "https://evil.example";
const env = { NODE_ENV: "test", SESSION_SECRET: "csrf-test-secret", RATE_LIMIT_DISABLED: "true" };

let victim, food, cartWrite;

beforeEach(async () => {
  victim = await loginAs(app);
  food = { _id: newId(), name: "Veg Burger", price: 120, available: true, image: "" };
  jest.spyOn(Food, "findById").mockResolvedValue({ ...food, _id: { toString: () => food._id } });
  jest.spyOn(Food, "find").mockReturnValue(query([food]));
  jest.spyOn(Cart, "findOne").mockImplementation(() =>
    query({ _id: 1, user: victim.userId, items: [], toObject() { return { items: [] }; } })
  );
  cartWrite = jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 }); // "the order/cart write happened"
});

/** What the attacker's page can make the victim's browser send: victim cookie + attacker-controlled headers. */
const attack = async (method, path, { headers = {}, body, type = "application/json" } = {}) => {
  let req = (await anonymous(app))[method](path).set("Cookie", cookieHeader(victim.agent));
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  if (body !== undefined) req = req.set("Content-Type", type).send(body);
  return req;
};

const addToCart = { foodId: undefined, quantity: 1 };
const cartBody = () => JSON.stringify({ ...addToCart, foodId: food._id });

describe("cross-origin state-changing requests are rejected, with no side effect", () => {
  test("fetch() from another site: victim's cookie, attacker's Origin, no token → 403", async () => {
    const res = await attack("post", "/api/cart", { headers: { Origin: EVIL }, body: cartBody() });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: "CSRF_ORIGIN" });
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("…even if the attacker somehow had the correct token: the Origin check still blocks it", async () => {
    const token = (await victim.agent.get("/api/auth/csrf")).body.data.csrfToken;
    const res = await attack("post", "/api/cart", { headers: { Origin: EVIL, "X-CSRF-Token": token }, body: cartBody() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN");
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("auto-submitted HTML <form> (urlencoded) from another site → 403", async () => {
    const res = await attack("post", "/api/cart", {
      headers: { Origin: EVIL },
      body: `foodId=${food._id}&quantity=1`,
      type: "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(403);
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("the text/plain 'simple request' trick (JSON smuggled without a preflight) → 403", async () => {
    const res = await attack("post", "/api/cart", { headers: { Origin: EVIL }, body: cartBody(), type: "text/plain" });
    expect(res.status).toBe(403);
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("Origin: null (sandboxed iframe / data: page) → 403", async () => {
    const res = await attack("post", "/api/cart", { headers: { Origin: "null" }, body: cartBody() });
    expect(res.status).toBe(403);
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("a look-alike origin on our own host name is still a different origin → 403", async () => {
    const own = await originFor(app); // http://127.0.0.1:PORT
    const res = await attack("post", "/api/cart", {
      headers: { Origin: own.replace("127.0.0.1", "127.0.0.1.evil.example") },
      body: cartBody(),
    });
    expect(res.status).toBe(403);
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("no Origin but a foreign Referer → 403", async () => {
    const res = await attack("post", "/api/cart", { headers: { Referer: `${EVIL}/win-a-prize.html` }, body: cartBody() });
    expect(res.status).toBe(403);
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("every unsafe method is covered: PUT, PATCH, DELETE", async () => {
    for (const method of ["put", "patch", "delete"]) {
      const res = await attack(method, `/api/cart/${food._id}`, { headers: { Origin: EVIL }, body: JSON.stringify({ quantity: 1 }) });
      expect(res.status).toBe(403);
    }
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("an ADMIN's session cannot be used to delete a user from another site", async () => {
    const admin = await loginAs(app, { role: "admin" });
    const deleteOne = jest.spyOn(User, "deleteOne").mockResolvedValue({});
    const updateOne = jest.spyOn(User, "updateOne").mockResolvedValue({});

    const res = await (await anonymous(app))
      .delete(`/api/admin/users/${newId()}`)
      .set("Cookie", cookieHeader(admin.agent))
      .set("Origin", EVIL);

    expect(res.status).toBe(403);
    expect(deleteOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test("a forged logout from another site does not log the victim out", async () => {
    const res = await attack("post", "/api/auth/logout", { headers: { Origin: EVIL } });
    expect(res.status).toBe(403);
    expect((await victim.agent.get("/api/auth/me")).status).toBe(200); // still logged in
  });

  test("login CSRF (forcing the victim into the attacker's account) is blocked too", async () => {
    const res = await (await anonymous(app))
      .post("/api/auth/login")
      .set("Origin", EVIL)
      .send({ email: "attacker@example.com", password: "secret12" });
    expect(res.status).toBe(403);
  });
});

describe("the token is required even when the request looks same-origin", () => {
  test("same Origin, victim cookie, NO token → 403 CSRF_TOKEN", async () => {
    const own = await originFor(app);
    const res = await attack("post", "/api/cart", { headers: { Origin: own }, body: cartBody() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_TOKEN");
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("no Origin header at all (curl / very old browser), no token → 403 CSRF_TOKEN", async () => {
    const res = await attack("post", "/api/cart", { body: cartBody() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_TOKEN");
  });

  test("a wrong token → 403", async () => {
    const res = await attack("post", "/api/cart", { headers: { "X-CSRF-Token": "not-the-token" }, body: cartBody() });
    expect(res.status).toBe(403);
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("another user's valid token does not work on my session", async () => {
    const other = await newAgent(app);
    const otherToken = (await other.get("/api/auth/csrf")).body.data.csrfToken;
    const res = await attack("post", "/api/cart", { headers: { "X-CSRF-Token": otherToken }, body: cartBody() });
    expect(res.status).toBe(403);
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("an urlencoded body without Origin is refused as 415 (forms cannot send JSON or our header)", async () => {
    const res = await attack("post", "/api/cart", { body: `foodId=${food._id}&quantity=1`, type: "application/x-www-form-urlencoded" });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(cartWrite).not.toHaveBeenCalled();
  });

  test("a missing session (never visited the site) has no token to match → 403", async () => {
    const res = await (await anonymous(app))
      .post("/api/cart")
      .set("X-CSRF-Token", "anything")
      .send({ foodId: food._id, quantity: 1 });
    expect(res.status).toBe(403);
  });
});

describe("legitimate requests still work", () => {
  test("our own page: same Origin + token + JSON → 200 and the write happens", async () => {
    const own = await originFor(app);
    const res = await victim.agent.post("/api/cart").set("Origin", own).send({ foodId: food._id, quantity: 1 });
    expect(res.status).toBe(200);
    expect(cartWrite).toHaveBeenCalled();
  });

  test("no Origin header (API client) + token → 200", async () => {
    const res = await victim.agent.post("/api/cart").send({ foodId: food._id, quantity: 1 });
    expect(res.status).toBe(200);
  });

  test("a same-site Referer is accepted when Origin is absent", async () => {
    const own = await originFor(app);
    const res = await victim.agent.post("/api/cart").set("Referer", `${own}/menu.html`).send({ foodId: food._id, quantity: 1 });
    expect(res.status).toBe(200);
  });

  test("bodiless writes (logout) with a token work", async () => {
    expect((await victim.agent.post("/api/auth/logout")).status).toBe(200);
  });

  test("safe methods never need a token or pass through the origin check", async () => {
    const res = await (await anonymous(app)).get("/api/health").set("Origin", EVIL); // no token, foreign Origin
    expect(res.status).toBe(200);
    expect((await victim.agent.get("/api/cart")).status).toBe(200);
  });
});

describe("CSRF token lifecycle", () => {
  test("GET /api/auth/csrf: not cacheable, stable within a session, different across sessions", async () => {
    const a = await newAgent(app, { csrf: false });
    const first = await a.get("/api/auth/csrf");
    const second = await a.get("/api/auth/csrf");
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(second.body.data.csrfToken).toBe(first.body.data.csrfToken);

    const b = await newAgent(app, { csrf: false });
    expect((await b.get("/api/auth/csrf")).body.data.csrfToken).not.toBe(first.body.data.csrfToken);
  });

  test("logging in issues a NEW session and token; the pre-login token stops working", async () => {
    const user = victim.user;
    const agent = await newAgent(app); // anonymous session + token
    const preLoginToken = (await agent.get("/api/auth/csrf")).body.data.csrfToken;

    expect((await agent.post("/api/auth/login").send({ email: user.email, password: "secret12" })).status).toBe(200);

    // old token (bound to the destroyed anonymous session) is dead
    expect((await agent.post("/api/cart").send({ foodId: food._id, quantity: 1 })).status).toBe(403);
    // a fresh token for the new session works
    const postLoginToken = await refreshCsrf(agent);
    expect(postLoginToken).not.toBe(preLoginToken);
    expect((await agent.post("/api/cart").send({ foodId: food._id, quantity: 1 })).status).toBe(200);
  });
});

describe("CORS: other origins cannot read responses or pass a preflight", () => {
  const preflight = async (a, origin) =>
    (await anonymous(a))
      .options("/api/cart")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token");

  test("by default NO origin is allowed: preflight gets no CORS headers, so the browser blocks the real request", async () => {
    const res = await preflight(app, EVIL);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("a simple cross-origin GET is not readable by the other site (no Access-Control-Allow-Origin)", async () => {
    const res = await (await anonymous(app)).get("/api/foods").set("Origin", EVIL);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("a listed origin (CORS_ORIGINS) gets CORS + may write when it also sends a valid token", async () => {
    const trusted = createApp(loadConfig({ ...env, CORS_ORIGINS: "https://shop.example.com" }));
    expect((await preflight(trusted, "https://shop.example.com")).headers["access-control-allow-origin"]).toBe("https://shop.example.com");
    expect((await preflight(trusted, EVIL)).headers["access-control-allow-origin"]).toBeUndefined();

    const agent = await newAgent(trusted); // session + token on the trusted app
    const ok = await agent.post("/api/auth/register").set("Origin", "https://shop.example.com").send({});
    expect(ok.status).toBe(400); // passed CSRF; rejected later by validation (empty body)
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");

    const blocked = await agent.post("/api/auth/register").set("Origin", EVIL).send({});
    expect(blocked.status).toBe(403);
  });
});

describe("behind a reverse proxy", () => {
  test("X-Forwarded-Host is honoured only when TRUST_PROXY is set", async () => {
    const send = async (trustProxy) => {
      const proxied = createApp(loadConfig({ ...env, TRUST_PROXY: trustProxy }));
      const agent = await newAgent(proxied);
      return agent
        .post("/api/auth/register")
        .set("Host", "internal:5000")
        .set("X-Forwarded-Host", "shop.example.com")
        .set("Origin", "https://shop.example.com")
        .send({});
    };
    expect((await send("1")).status).toBe(400); // allowed through CSRF, then validation
    expect((await send("")).status).toBe(403);  // header ignored → Origin looks foreign
  });
});

describe("the session cookie", () => {
  test("is HttpOnly and SameSite=Lax", async () => {
    const res = await (await anonymous(app)).get("/api/auth/csrf");
    const cookie = res.headers["set-cookie"].find((c) => c.startsWith("foodiehub.sid="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  test("production cookies are Secure (set over HTTPS as seen through the trusted proxy)", async () => {
    const prod = createApp(
      loadConfig({
        NODE_ENV: "production",
        MONGO_URI: "mongodb://127.0.0.1:27017/x",
        SESSION_SECRET: "p".repeat(40),
        TRUST_PROXY: "1",
      }),
      { sessionStore: new (require("express-session").MemoryStore)() }
    );
    const res = await (await anonymous(prod)).get("/api/auth/csrf").set("X-Forwarded-Proto", "https");
    const cookie = res.headers["set-cookie"].find((c) => c.startsWith("foodiehub.sid="));
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });
});
