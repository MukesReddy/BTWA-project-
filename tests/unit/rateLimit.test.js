// P1.4 — rate limiting. Each test builds its OWN app (createApp) with tiny limits and a fresh
// in-memory counter store, so tests cannot affect each other and no real limits are slept through.
// The User model is mocked: this proves the limiter wiring, keys, skip rules and response shape.

const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const User = require("../../models/User");
const Order = require("../../models/Order");
const { query } = require("../helpers/chain");
const { loginAs, fakeUser } = require("../helpers/auth");
const { newAgent } = require("../helpers/client");

const baseEnv = { NODE_ENV: "test", SESSION_SECRET: "rate-limit-test-secret", RATE_LIMIT_DISABLED: "false" };
const appWith = (rateLimits, env = {}) => createApp(loadConfig({ ...baseEnv, ...env }), { rateLimits });

const login = (agent, email = "someone@example.com") =>
  agent.post("/api/auth/login").send({ email, password: "wrong-password" });

beforeEach(() => {
  jest.spyOn(User, "findOne").mockReturnValue(query(null)); // no such account → every login fails with 401
});

describe("login: failed attempts are throttled", () => {
  test("per account: the 4th wrong password for the SAME email is 429; other emails are unaffected", async () => {
    const app = appWith({ login: { limit: 3 }, loginPerIp: { limit: 100 } });
    const agent = await newAgent(app);

    for (let i = 0; i < 3; i++) expect((await login(agent)).status).toBe(401);

    const blocked = await login(agent);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, code: "RATE_LIMITED", limiter: "login" });
    expect(blocked.body.message).toMatch(/too many login attempts.*try again in \d+ minutes?/i);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.headers["ratelimit"] || blocked.headers["ratelimit-policy"]).toBeDefined();

    expect((await login(agent, "other@example.com")).status).toBe(401); // a different account is a different bucket
  });

  test("per network: guessing across MANY emails is stopped by the per-IP limit", async () => {
    const app = appWith({ login: { limit: 100 }, loginPerIp: { limit: 3 } });
    const agent = await newAgent(app);

    for (let i = 0; i < 3; i++) expect((await login(agent, `user${i}@example.com`)).status).toBe(401);
    const blocked = await login(agent, "user99@example.com");
    expect(blocked.status).toBe(429);
    expect(blocked.body.limiter).toBe("loginPerIp");
  });

  test("successful logins do NOT count toward the limit", async () => {
    const app = appWith({ login: { limit: 2 }, loginPerIp: { limit: 2 } });
    const user = fakeUser();
    User.findOne.mockReturnValue(query(user));

    for (let i = 0; i < 6; i++) {
      const agent = await newAgent(app);
      const res = await agent.post("/api/auth/login").send({ email: user.email, password: "secret12" });
      expect(res.status).toBe(200);
    }
  });

  test("requests WITHOUT a CSRF token are throttled too (limiter runs before the CSRF check)", async () => {
    const app = appWith({ login: { limit: 3 }, loginPerIp: { limit: 100 } });
    const agent = await newAgent(app, { csrf: false });

    for (let i = 0; i < 3; i++) expect((await login(agent)).status).toBe(403);
    expect((await login(agent)).status).toBe(429);
  });
});

describe("other limiters", () => {
  test("registration is limited per network", async () => {
    const app = appWith({ register: { limit: 2 } });
    jest.spyOn(User, "create").mockResolvedValue({ _id: "507f1f77bcf86cd799439011", email: "a@b.co", role: "customer" });
    const agent = await newAgent(app);
    const register = (n) => agent.post("/api/auth/register").send({ name: "Asha Rao", email: `a${n}@example.com`, password: "secret12" });

    expect((await register(1)).status).toBe(201);
    expect((await register(2)).status).toBe(201);
    const blocked = await register(3);
    expect(blocked.status).toBe(429);
    expect(blocked.body.limiter).toBe("register");
  });

  test("the whole /api is limited per network", async () => {
    const app = appWith({ api: { limit: 3 } });
    const agent = await newAgent(app, { csrf: false });
    for (let i = 0; i < 3; i++) expect((await agent.get("/api/health")).status).toBe(200);
    const blocked = await agent.get("/api/health");
    expect(blocked.status).toBe(429);
    expect(blocked.body.limiter).toBe("api");
  });

  test("order placement is limited PER USER, not shared between users", async () => {
    const app = appWith({ orders: { limit: 1 } });
    jest.spyOn(Order, "create").mockRejectedValue(new Error("never reached")); // validation fails first anyway
    const a = await loginAs(app);
    const b = await loginAs(app);

    expect((await a.agent.post("/api/orders").send({})).status).toBe(400); // counted (1/1), rejected by validation
    expect((await a.agent.post("/api/orders").send({})).status).toBe(429);
    expect((await b.agent.post("/api/orders").send({})).status).toBe(400); // other user: own bucket
  });
});

describe("configuration", () => {
  test("RATE_LIMIT_DISABLED=true switches every limiter off", async () => {
    const app = appWith({ api: { limit: 1 }, login: { limit: 1 } }, { RATE_LIMIT_DISABLED: "true" });
    const agent = await newAgent(app, { csrf: false });
    for (let i = 0; i < 15; i++) expect((await agent.get("/api/health")).status).toBe(200);
  });

  test("a spoofed X-Forwarded-For cannot dodge the limit when no proxy is trusted", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {}); // express-rate-limit's own proxy warning
    const app = appWith({ api: { limit: 3 } }); // TRUST_PROXY not set → header is ignored
    const agent = await newAgent(app, { csrf: false });

    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await agent.get("/api/health").set("X-Forwarded-For", `10.0.0.${i}`)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    consoleError.mockRestore();
  });

  test("with TRUST_PROXY=1 clients behind the proxy are counted separately (by the proxy-appended address)", async () => {
    const app = appWith({ api: { limit: 2 } }, { TRUST_PROXY: "1" });
    const agent = await newAgent(app, { csrf: false });
    const hit = (ip) => agent.get("/api/health").set("X-Forwarded-For", ip);

    expect((await hit("203.0.113.1")).status).toBe(200);
    expect((await hit("203.0.113.1")).status).toBe(200);
    expect((await hit("203.0.113.1")).status).toBe(429);
    expect((await hit("203.0.113.2")).status).toBe(200); // different client, own bucket
  });
});
