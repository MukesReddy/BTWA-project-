// P1.3 — session / auth hardening (DB mocked; the same scenarios run against real MongoDB with a
// real connect-mongo session store in tests/integration/security.test.js).
//
// Core rule: blocking a deactivated user's FUTURE logins is not enough. A session that already exists
// must stop working the moment the account is deactivated, deleted or demoted.

const bcrypt = require("bcryptjs");
const app = require("../../server");
const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const User = require("../../models/User");
const Food = require("../../models/Food");
const { query } = require("../helpers/chain");
const { loginAs, fakeUser, removeSessionUser } = require("../helpers/auth");
const { newAgent, anonymous, cookieHeader, refreshCsrf } = require("../helpers/client");

const sidOf = (setCookie) => {
  const line = (setCookie || []).find((c) => c.startsWith("foodiehub.sid="));
  return line ? line.split(";")[0] : null;
};

describe("an already-logged-in session stops working when the account changes", () => {
  test("baseline: an active user's session works on protected routes", async () => {
    const { agent } = await loginAs(app);
    expect((await agent.get("/api/auth/me")).status).not.toBe(401);
    expect((await agent.get("/api/cart")).status).not.toBe(401);
  });

  test("DEACTIVATED while logged in → the very next request is 401, and the session is destroyed", async () => {
    const { agent, user } = await loginAs(app);
    jest.spyOn(User, "findById").mockResolvedValue(user);
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    user.isActive = false; // an admin deactivates the account

    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no longer active/i);
    // the cookie is cleared in the browser…
    expect(res.headers["set-cookie"].join()).toMatch(/foodiehub\.sid=;.*(Expires=Thu, 01 Jan 1970|Max-Age=0)/i);
    // …and the server-side session is gone: the same cookie is now simply "not logged in"
    const again = await (await anonymous(app)).get("/api/auth/me").set("Cookie", cookieHeader(agent));
    expect(again.status).toBe(401);
    expect(again.body.message).toMatch(/authentication required/i);
  });

  test("DELETED while logged in → 401", async () => {
    const { agent, user } = await loginAs(app);
    removeSessionUser(user);
    expect((await agent.get("/api/cart")).status).toBe(401);
  });

  test("a deactivated user cannot WRITE either (cart, profile) — each write rejected with 401, nothing changed", async () => {
    const updateOne = jest.spyOn(require("../../models/Cart"), "updateOne");
    const update = jest.spyOn(User, "findByIdAndUpdate");

    const first = await loginAs(app); // one login per write: a rejected request ends that session
    first.user.isActive = false;
    expect((await first.agent.post("/api/cart").send({ foodId: "507f1f77bcf86cd799439011", quantity: 1 })).status).toBe(401);

    const second = await loginAs(app);
    second.user.isActive = false;
    expect((await second.agent.put("/api/users/profile").send({ name: "Still Here" })).status).toBe(401);

    expect(updateOne).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("a user record with no isActive field (legacy rows) is treated as active", async () => {
    const { agent, user } = await loginAs(app);
    delete user.isActive;
    expect((await agent.get("/api/cart")).status).not.toBe(401);
  });

  test("an ADMIN who is deactivated loses admin access immediately", async () => {
    const { agent, user } = await loginAs(app, { role: "admin" });
    expect((await agent.get("/api/admin/users")).status).not.toBe(403);
    user.isActive = false;
    expect((await agent.get("/api/admin/users")).status).toBe(401);
  });

  test("DEMOTED admin → 403 on the very next admin request (role is re-read, not trusted from the session)", async () => {
    const { agent, user } = await loginAs(app, { role: "admin" });
    jest.spyOn(User, "find").mockReturnValue(query([]));
    expect((await agent.get("/api/admin/users")).status).toBe(200);

    user.role = "customer";

    expect((await agent.get("/api/admin/users")).status).toBe(403);
  });

  test("PROMOTED customer gets admin access without logging in again", async () => {
    const { agent, user } = await loginAs(app, { role: "customer" });
    jest.spyOn(User, "find").mockReturnValue(query([]));
    expect((await agent.get("/api/admin/users")).status).toBe(403);
    user.role = "admin";
    expect((await agent.get("/api/admin/users")).status).toBe(200);
  });

  test("a database error while checking the account is a 500, never a free pass", async () => {
    const { agent } = await loginAs(app);
    jest.spyOn(User, "findOne").mockImplementation(() => {
      throw new Error("db down");
    });
    expect((await agent.get("/api/cart")).status).toBe(500);
  });

  test("only role and isActive are fetched (no password hash is loaded on every request)", async () => {
    const { agent } = await loginAs(app);
    const select = jest.fn(() => ({ lean: () => Promise.resolve({ role: "customer", isActive: true }) }));
    User.findOne.mockReturnValue({ select });
    await agent.get("/api/cart");
    expect(select).toHaveBeenCalledWith("role isActive");
  });
});

describe("login", () => {
  test("a new session id is issued at login (session fixation defence)", async () => {
    const user = fakeUser();
    jest.spyOn(User, "findOne").mockReturnValue(query(user));
    const anon = await newAgent(app); // already visited /api/auth/csrf → holds an anonymous session cookie
    const cookieBefore = cookieHeader(anon).split(";").find((c) => c.trim().startsWith("foodiehub.sid="));

    const res = await anon.post("/api/auth/login").send({ email: user.email, password: "secret12" });
    expect(res.status).toBe(200);
    const sidAfter = sidOf(res.headers["set-cookie"]);

    expect(sidAfter).toBeTruthy();
    expect(sidAfter).not.toBe(cookieBefore.trim()); // brand-new id
  });

  test("an attacker who planted/knows the PRE-login session id gains nothing after the victim logs in", async () => {
    const user = fakeUser();
    jest.spyOn(User, "findOne").mockReturnValue(query(user));

    const victim = await newAgent(app); // attacker made the victim's browser use this pre-login session
    const planted = cookieHeader(victim);

    await victim.post("/api/auth/login").send({ email: user.email, password: "secret12" });

    const asAttacker = await (await anonymous(app)).get("/api/auth/me").set("Cookie", planted);
    expect(asAttacker.status).toBe(401);
    expect((await victim.get("/api/auth/me")).status).not.toBe(401);
  });

  test("wrong password and unknown email give the SAME 401 message (no account enumeration)", async () => {
    const user = fakeUser();
    user.comparePassword = async () => false;
    const agent = await newAgent(app);

    jest.spyOn(User, "findOne").mockReturnValue(query(user));
    const wrong = await agent.post("/api/auth/login").send({ email: user.email, password: "wrong-pass" });
    User.findOne.mockReturnValue(query(null));
    const unknown = await agent.post("/api/auth/login").send({ email: "nobody@example.com", password: "wrong-pass" });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test("an unknown email still costs one bcrypt comparison (response time does not reveal registered emails)", async () => {
    const compare = jest.spyOn(bcrypt, "compare");
    jest.spyOn(User, "findOne").mockReturnValue(query(null));
    const agent = await newAgent(app);

    await agent.post("/api/auth/login").send({ email: "nobody@example.com", password: "wrong-pass" });

    expect(compare).toHaveBeenCalledTimes(1);
  });

  test("a deactivated account is still refused at login with 403", async () => {
    const user = fakeUser({ isActive: false });
    jest.spyOn(User, "findOne").mockReturnValue(query(user));
    const agent = await newAgent(app);
    const res = await agent.post("/api/auth/login").send({ email: user.email, password: "secret12" });
    expect(res.status).toBe(403);
    expect(sidOf(res.headers["set-cookie"] || [])).toBeNull(); // no authenticated session was created
  });
});

describe("logout", () => {
  test("destroys the session and clears the cookie with matching attributes; the old cookie is dead", async () => {
    const { agent } = await loginAs(app);
    const before = cookieHeader(agent);

    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(200);
    const cleared = res.headers["set-cookie"].find((c) => c.startsWith("foodiehub.sid="));
    expect(cleared).toMatch(/Path=\//);
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/SameSite=Lax/i);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const replay = await (await anonymous(app)).get("/api/auth/me").set("Cookie", before);
    expect(replay.status).toBe(401);
  });

  test("the CSRF token dies with the session", async () => {
    const { agent } = await loginAs(app);
    await agent.post("/api/auth/logout");
    expect((await agent.post("/api/auth/logout")).status).toBe(403); // stale token, no session
    await refreshCsrf(agent);
    expect((await agent.post("/api/auth/logout")).status).toBe(401); // fresh anonymous session: not logged in
  });
});

describe("dev-only demo accounts (P1.6)", () => {
  const prodEnv = {
    NODE_ENV: "production",
    MONGO_URI: "mongodb://127.0.0.1:27017/x",
    SESSION_SECRET: "d".repeat(40),
    TRUST_PROXY: "1",
  };
  const prodApp = (extra = {}) =>
    createApp(loadConfig({ ...prodEnv, ...extra }), { sessionStore: new (require("express-session").MemoryStore)() });

  test("in development/test the endpoint lists the demo accounts used by the login page buttons", async () => {
    const res = await (await anonymous(app)).get("/api/auth/demo-accounts");
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.email)).toEqual(["admin@foodiehub.com", "rahul@example.com"]);
    expect(res.body.data[0]).toHaveProperty("password");
  });

  test("in PRODUCTION it is a 404 and exposes nothing", async () => {
    const res = await (await anonymous(prodApp())).get("/api/auth/demo-accounts");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/admin123|password123|foodiehub\.com/);
  });

  test("production needs an explicit ENABLE_DEMO_LOGIN=true opt-in", async () => {
    expect((await (await anonymous(prodApp({ ENABLE_DEMO_LOGIN: "true" }))).get("/api/auth/demo-accounts")).status).toBe(200);
    expect((await (await anonymous(prodApp({ ENABLE_DEMO_LOGIN: "false" }))).get("/api/auth/demo-accounts")).status).toBe(404);
  });

  test("development can switch it off too", async () => {
    const dev = createApp(loadConfig({ NODE_ENV: "test", SESSION_SECRET: "s", ENABLE_DEMO_LOGIN: "false" }));
    expect((await (await anonymous(dev)).get("/api/auth/demo-accounts")).status).toBe(404);
  });

  test("the login page's HTML no longer contains any credentials", () => {
    const html = require("fs").readFileSync(require("path").join(__dirname, "../../public/login.html"), "utf8");
    expect(html).not.toMatch(/admin123|password123|admin@foodiehub|rahul@example/);
    expect(html).not.toMatch(/onclick=/);
  });
});

// keep Food referenced so an accidental real DB call in these tests would fail loudly
void Food;
