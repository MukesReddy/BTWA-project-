// Batch 2 security behaviour against a REAL MongoDB and a REAL connect-mongo session store
// (the unit tests mock both). Covers:
//   P1.3  an existing session stops working when the account is deactivated / deleted / demoted;
//         session id is regenerated at login; logout removes the stored session
//   P1.5  cross-origin state-changing requests are rejected with NO side effect in the database
//   P1.8  search / filter input is matched literally and malformed input is a 4xx

const mongoose = require("mongoose");
const { MongoStore } = require("connect-mongo");
const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const User = require("../../models/User");
const Cart = require("../../models/Cart");
const Order = require("../../models/Order");
const Category = require("../../models/Category");
const { connectTestDb, clearTestDb, disconnectTestDb, DB_NAME } = require("../helpers/db");
const { createUser, createFood, createCategory, loginAgent, PASSWORD, ORDER_BODY } = require("../helpers/factories");
const { anonymous, cookieHeader, newAgent } = require("../helpers/client");

let app; // identical to production: sessions live in MongoDB

beforeAll(async () => {
  await connectTestDb();
  const store = new MongoStore({ client: mongoose.connection.getClient(), dbName: DB_NAME, touchAfter: 0 });
  app = createApp(loadConfig({ NODE_ENV: "test", SESSION_SECRET: "integration-secret", RATE_LIMIT_DISABLED: "true" }), {
    sessionStore: store,
  });
});
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

const sessions = () => mongoose.connection.collection("sessions");
// connect-mongo stores each session as a JSON string; logged-in ones contain "userId":"<id>"
const sessionsOf = (user) => sessions().countDocuments({ session: { $regex: `"userId":"${user.id}"` } });

const EVIL = "https://evil.example";

describe("P1.3 — an existing session stops working when the account changes", () => {
  test("DEACTIVATED directly in the database (nothing purges sessions): the next request is 401 and the stored session is removed", async () => {
    const customer = await createUser();
    const agent = await loginAgent(app, customer);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    expect(await sessionsOf(customer)).toBe(1);

    await User.updateOne({ _id: customer._id }, { $set: { isActive: false } });

    const res = await agent.get("/api/cart");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/no longer active/i);
    expect(await sessionsOf(customer)).toBe(0);
    expect((await agent.get("/api/cart")).status).toBe(401);
  });

  test("a deactivated user cannot write with the old session either (no cart / profile change)", async () => {
    const customer = await createUser();
    const food = await createFood();
    const a = await loginAgent(app, customer);
    const b = await loginAgent(app, customer);
    await User.updateOne({ _id: customer._id }, { $set: { isActive: false } });

    expect((await a.post("/api/cart").send({ foodId: food.id, quantity: 1 })).status).toBe(401);
    expect((await b.put("/api/users/profile").send({ name: "Renamed" })).status).toBe(401);
    expect(await Cart.countDocuments({ user: customer._id })).toBe(0);
    expect((await User.findById(customer._id)).name).toBe(customer.name);
  });

  test("admin deletes a customer who is logged in on two devices: BOTH real sessions are purged, a bystander is untouched", async () => {
    const admin = await createUser({ role: "admin" });
    const customer = await createUser();
    const bystander = await createUser();
    const phone = await loginAgent(app, customer);
    const laptop = await loginAgent(app, customer);
    const other = await loginAgent(app, bystander);
    const adminAgent = await loginAgent(app, admin);
    expect(await sessionsOf(customer)).toBe(2);

    const res = await adminAgent.delete(`/api/admin/users/${customer.id}`);
    expect(res.status).toBe(200);

    expect(await sessionsOf(customer)).toBe(0); // purge matched the real stored format
    expect(await sessionsOf(bystander)).toBe(1);
    expect((await phone.get("/api/auth/me")).status).toBe(401);
    expect((await laptop.get("/api/cart")).status).toBe(401);
    expect((await other.get("/api/auth/me")).status).toBe(200);
  });

  test("HARD-DELETED while logged in → 401", async () => {
    const customer = await createUser();
    const agent = await loginAgent(app, customer);
    await User.deleteOne({ _id: customer._id });
    expect((await agent.get("/api/cart")).status).toBe(401);
  });

  test("a customer with orders is deactivated by the admin: the live session dies AND the order history stays", async () => {
    const admin = await createUser({ role: "admin" });
    const customer = await createUser();
    const food = await createFood();
    const agent = await loginAgent(app, customer);
    await agent.post("/api/cart").send({ foodId: food.id, quantity: 1 });
    expect((await agent.post("/api/orders").send(ORDER_BODY)).status).toBe(201);

    const res = await (await loginAgent(app, admin)).delete(`/api/admin/users/${customer.id}`);
    expect(res.body.data).toEqual({ action: "deactivated" });

    expect((await agent.get("/api/orders")).status).toBe(401);
    expect(await Order.countDocuments({ user: customer._id })).toBe(1);
  });

  test("DEMOTED admin → 403 on the next admin request; PROMOTED customer → admin access, without logging in again", async () => {
    const boss = await createUser({ role: "admin" });
    const staff = await createUser({ role: "customer" });
    const bossAgent = await loginAgent(app, boss);
    const staffAgent = await loginAgent(app, staff);
    expect((await bossAgent.get("/api/admin/users")).status).toBe(200);
    expect((await staffAgent.get("/api/admin/users")).status).toBe(403);

    await User.updateOne({ _id: boss._id }, { $set: { role: "customer" } });
    await User.updateOne({ _id: staff._id }, { $set: { role: "admin" } });

    expect((await bossAgent.get("/api/admin/users")).status).toBe(403);
    expect((await staffAgent.get("/api/admin/users")).status).toBe(200);
  });

  test("an active user's session keeps working across many requests", async () => {
    const customer = await createUser();
    const agent = await loginAgent(app, customer);
    for (let i = 0; i < 5; i++) expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  test("session fixation: the pre-login session is destroyed in the store and its cookie is useless", async () => {
    const user = await createUser();
    const anon = await newAgent(app); // creates an anonymous session row (it holds the CSRF token)
    const planted = cookieHeader(anon);
    expect(await sessions().countDocuments()).toBe(1);

    const login = await anon.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);

    expect((await (await anonymous(app)).get("/api/auth/me").set("Cookie", planted)).status).toBe(401);
    expect(await sessions().countDocuments()).toBe(1); // old row gone, only the new one
    expect(await sessionsOf(user)).toBe(1);
  });

  test("logout removes the stored session", async () => {
    const user = await createUser();
    const agent = await loginAgent(app, user);
    expect(await sessionsOf(user)).toBe(1);
    expect((await agent.post("/api/auth/logout")).status).toBe(200);
    expect(await sessionsOf(user)).toBe(0);
  });

  test("a deactivated user still cannot log in (403)", async () => {
    const user = await createUser({ isActive: false });
    const anon = await newAgent(app);
    expect((await anon.post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(403);
  });
});

describe("P1.5 — cross-origin state-changing requests change nothing in the database", () => {
  test("forged order placement (JSON, form, text/plain, no token) is rejected; the real page's request succeeds", async () => {
    const customer = await createUser();
    const food = await createFood();
    const agent = await loginAgent(app, customer);
    await agent.post("/api/cart").send({ foodId: food.id, quantity: 2 });
    const cookie = cookieHeader(agent); // what the victim's browser attaches to ANY request to our site

    const api = await anonymous(app); // no cookies of its own: we add the victim's by hand, like a browser would
    const forge = () => api.post("/api/orders").set("Cookie", cookie); // NOT async: it must stay un-sent until we finish chaining

    expect((await forge().set("Origin", EVIL).send(ORDER_BODY)).status).toBe(403);
    expect((await forge().set("Origin", EVIL).type("form").send({ paymentMethod: "Cash on Delivery" })).status).toBe(403);
    expect((await forge().set("Origin", EVIL).type("text/plain").send(JSON.stringify(ORDER_BODY))).status).toBe(403);
    expect((await forge().set("Origin", "null").send(ORDER_BODY)).status).toBe(403);
    expect((await forge().send(ORDER_BODY)).status).toBe(403); // same cookie, no token, no Origin

    expect(await Order.countDocuments()).toBe(0);
    expect(await Cart.countDocuments({ user: customer._id })).toBe(1); // cart untouched

    const legit = await agent.post("/api/orders").send(ORDER_BODY);
    expect(legit.status).toBe(201);
    expect(await Order.countDocuments()).toBe(1);
  });

  test("forged admin actions (delete user, change order status, create category) change nothing", async () => {
    const admin = await createUser({ role: "admin" });
    const victim = await createUser();
    const adminAgent = await loginAgent(app, admin);
    const cookie = cookieHeader(adminAgent);
    const api = await anonymous(app);
    const forged = (method, path, body) => {
      const req = api[method](path).set("Cookie", cookie).set("Origin", EVIL);
      return body ? req.send(body) : req;
    };

    expect((await forged("delete", `/api/admin/users/${victim.id}`)).status).toBe(403);
    expect((await forged("post", "/api/categories", { name: "Forged" })).status).toBe(403);
    expect((await forged("put", `/api/admin/orders/${new mongoose.Types.ObjectId()}/status`, { status: "Delivered" })).status).toBe(403);

    expect(await User.countDocuments({ _id: victim._id })).toBe(1);
    expect((await User.findById(victim._id)).isActive).toBe(true);
    expect(await Category.countDocuments({ name: "Forged" })).toBe(0);
  });

  test("a forged logout does not end the victim's session", async () => {
    const user = await createUser();
    const agent = await loginAgent(app, user);
    const res = await (await anonymous(app)).post("/api/auth/logout").set("Cookie", cookieHeader(agent)).set("Origin", EVIL);
    expect(res.status).toBe(403);
    expect(await sessionsOf(user)).toBe(1);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  test("a token from the pre-login session is useless after login (token is bound to the session)", async () => {
    const user = await createUser();
    const agent = await newAgent(app); // holds the anonymous session's token
    expect((await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(200);
    expect((await agent.post("/api/auth/logout")).status).toBe(403); // stale token
  });
});

describe("P1.8 — query safety against real MongoDB", () => {
  const foodNames = (res) => res.body.data.foods.map((f) => f.name).sort();
  const search = async (text) => (await anonymous(app)).get("/api/foods").query({ search: text });

  beforeEach(async () => {
    const category = await createCategory({ name: "Mains" });
    for (const name of ["C++ Wrap", "Veg Burger", "Paneer (Special)", "Dot.Com Dosa", "DotXCom Dosa", "Half-Plate Biryani", "Mix/Match Thali", "Back\\Slash Bowl", "Cost $5 Combo"]) {
      await createFood({ name, category: category._id });
    }
  });

  test.each([
    ["C++", ["C++ Wrap"]],
    ["(", ["Paneer (Special)"]],
    ["Dot.Com", ["Dot.Com Dosa"]], // '.' is a dot, so DotXCom must NOT match
    ["Half-Plate", ["Half-Plate Biryani"]],
    ["Mix/Match", ["Mix/Match Thali"]],
    ["Back\\Slash", ["Back\\Slash Bowl"]],
    ["$5", ["Cost $5 Combo"]],
    ["burger", ["Veg Burger"]], // still case-insensitive
  ])("search %j matches literally", async (text, expected) => {
    const res = await search(text);
    expect(res.status).toBe(200);
    expect(foodNames(res)).toEqual(expected);
  });

  test.each([".*", "^", "|", "[a-z]+", "(?i)veg", "["])("regex syntax %j is plain text: no match, no error", async (text) => {
    const res = await search(text);
    expect(res.status).toBe(200);
    expect(res.body.data.foods).toEqual([]);
  });

  test("a catastrophic-backtracking pattern is harmless (and fast)", async () => {
    const started = Date.now();
    const res = await search("(a+)+$");
    expect(res.status).toBe(200);
    expect(res.body.data.foods).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("operator injection through the query string is ignored; malformed values are 400", async () => {
    const all = await (await anonymous(app)).get("/api/foods?category[$ne]=x&available[$ne]=true&minPrice[$gt]=0");
    expect(all.status).toBe(200);
    expect(all.body.data.foods).toHaveLength(9); // none of those keys filtered anything

    for (const qs of ["?category=nope", "?page=abc", "?limit=0", "?sort=evil", "?search=a&search=b", "?minPrice=x"]) {
      expect((await (await anonymous(app)).get(`/api/foods${qs}`)).status).toBe(400);
    }
  });

  test("admin user search is literal, role filter works, bad input is 400", async () => {
    const admin = await createUser({ role: "admin" });
    await createUser({ name: "Dotty", email: "a.b@example.com" });
    await createUser({ name: "Plain", email: "axb@example.com" });
    const agent = await loginAgent(app, admin);
    const names = (res) => res.body.data.map((u) => u.name).sort();

    expect(names(await agent.get("/api/admin/users").query({ search: "a.b" }))).toEqual(["Dotty"]); // not "Plain"
    const bracket = await agent.get("/api/admin/users").query({ search: "[" });
    expect(bracket.status).toBe(200);
    expect(bracket.body.data).toEqual([]);
    expect((await agent.get("/api/admin/users").query({ role: "admin" })).body.data.map((u) => u._id)).toEqual([admin.id]);
    expect((await agent.get("/api/admin/users?role=root")).status).toBe(400);
    expect((await agent.get("/api/admin/users?role[$ne]=admin")).body.data.length).toBe(3); // ignored, not applied
  });

  test("admin order list: status filter + pagination validated and working", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAgent(app, admin);
    const ok = await agent.get("/api/admin/orders?status=Pending&page=1&limit=1000");
    expect(ok.status).toBe(200);
    expect(ok.body.data.orders).toEqual([]);
    for (const qs of ["?status=Hacked", "?page=abc", "?limit=-1", "?status=Pending&status=Delivered"]) {
      expect((await agent.get(`/api/admin/orders${qs}`)).status).toBe(400);
    }
  });

  test("category duplicate check: literal, case-insensitive, no 500 for '('", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAgent(app, admin);
    const create = (name) => agent.post("/api/categories").send({ name });

    expect((await create("Rolls (Veg)")).status).toBe(201);
    expect((await create("Rolls (Veg)")).status).toBe(409);
    expect((await create("rolls (veg)")).status).toBe(409); // case-insensitive
    expect((await create("(")).status).toBe(201);           // used to be an invalid regex → 500
    expect((await create("Pizza")).status).toBe(201);
    expect((await create(".*")).status).toBe(201);          // used to match "Pizza" → false 409
    expect(await Category.countDocuments({ name: { $in: ["Rolls (Veg)", "(", "Pizza", ".*"] } })).toBe(4);
  });
});
