// P1.11 — deleting / deactivating users against a REAL MongoDB.
// NOT executed in the sandbox this was written in (no mongod binary reachable).

const mongoose = require("mongoose");
const app = require("../../server");
const User = require("../../models/User");
const Cart = require("../../models/Cart");
const Order = require("../../models/Order");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("../helpers/db");
const { createUser, createFood, loginAgent, PASSWORD, ORDER_BODY } = require("../helpers/factories");
const { newAgent } = require("../helpers/client");

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

const placeOrder = async (user, food) => {
  const agent = await loginAgent(app, user);
  await agent.post("/api/cart").send({ foodId: food.id, quantity: 2 });
  const res = await agent.post("/api/orders").send(ORDER_BODY);
  expect(res.status).toBe(201);
  return res.body.data.order;
};

// connect-mongo (default options) stores the session as a JSON STRING in `session`
const storeFakeSession = (userId) =>
  mongoose.connection.collection("sessions").insertOne({
    _id: `sid-${userId}-${Math.random()}`,
    expires: new Date(Date.now() + 3600_000),
    session: JSON.stringify({ cookie: { httpOnly: true }, userId: String(userId), role: "customer", userName: "x" }),
  });

describe("user WITH orders", () => {
  test("is deactivated, keeps their orders, loses cart + sessions, and cannot log in", async () => {
    const admin = await createUser({ role: "admin" });
    const customer = await createUser({ name: "Priya Nair" });
    const bystander = await createUser();
    const food = await createFood();
    const order = await placeOrder(customer, food);
    await (await loginAgent(app, customer)).post("/api/cart").send({ foodId: food.id, quantity: 1 }); // new cart after the order
    await storeFakeSession(customer._id);
    await storeFakeSession(customer._id);
    await storeFakeSession(bystander._id);

    const adminAgent = await loginAgent(app, admin);
    const res = await adminAgent.delete(`/api/admin/users/${customer.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ action: "deactivated" });

    // user kept, flagged inactive
    expect((await User.findById(customer._id)).isActive).toBe(false);
    // order history intact and still resolvable
    expect(await Order.countDocuments({ user: customer._id })).toBe(1);
    const view = await adminAgent.get(`/api/orders/${order._id}`);
    expect(view.status).toBe(200);
    expect(view.body.data.user.name).toBe("Priya Nair");
    const list = await adminAgent.get("/api/admin/orders");
    expect(list.status).toBe(200);
    expect(list.body.data.orders[0].user.name).toBe("Priya Nair");
    // cart gone
    expect(await Cart.countDocuments({ user: customer._id })).toBe(0);
    // sessions: only the customer's two are gone
    const remaining = await mongoose.connection.collection("sessions").find().toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].session).toContain(bystander.id);
    // login refused with 403
    const login = await (await newAgent(app)).post("/api/auth/login").send({ email: customer.email, password: PASSWORD });
    expect(login.status).toBe(403);
    // and the admin list flags the account
    const users = await adminAgent.get("/api/admin/users");
    expect(users.body.data.find((u) => u._id === customer.id).isActive).toBe(false);
  });
});

describe("user WITHOUT orders", () => {
  test("is deleted together with their cart", async () => {
    const admin = await createUser({ role: "admin" });
    const customer = await createUser();
    const food = await createFood();
    await (await loginAgent(app, customer)).post("/api/cart").send({ foodId: food.id, quantity: 1 });

    const res = await (await loginAgent(app, admin)).delete(`/api/admin/users/${customer.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ action: "deleted" });
    expect(await User.findById(customer._id)).toBeNull();
    expect(await Cart.countDocuments({ user: customer._id })).toBe(0);
  });
});

test("an admin cannot remove themselves; unknown ids are 404; malformed ids are 400", async () => {
  const admin = await createUser({ role: "admin" });
  const agent = await loginAgent(app, admin);
  expect((await agent.delete(`/api/admin/users/${admin.id}`)).status).toBe(400);
  expect((await agent.delete("/api/admin/users/5f8d0d55b54764421b7156c3")).status).toBe(404);
  expect((await agent.delete("/api/admin/users/not-an-id")).status).toBe(400);
});

// Batch 4 — PUT /api/admin/users/:id/reactivate against a REAL MongoDB (not runnable in the sandbox).
describe("reactivating a deactivated user", () => {
  const login = async (user) => (await newAgent(app)).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
  const customerSessions = (user) => mongoose.connection.collection("sessions").countDocuments({ session: { $regex: `"userId":"${user.id}"` } });

  test("deactivate → login refused → reactivate → login works; history kept; cart/sessions NOT restored; nothing else changed", async () => {
    const admin = await createUser({ role: "admin" });
    const customer = await createUser({ name: "Priya Nair", phone: "9876543210", address: { street: "1 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" } });
    const food = await createFood();
    await placeOrder(customer, food);
    await (await loginAgent(app, customer)).post("/api/cart").send({ foodId: food.id, quantity: 1 });
    const before = (await User.findById(customer._id).select("+password")).toObject();

    const adminAgent = await loginAgent(app, admin);
    await storeFakeSession(customer._id); // a stored session that deactivation must remove (and reactivation must not bring back)
    const deactivated = await adminAgent.delete(`/api/admin/users/${customer.id}`);
    expect(deactivated.body.data).toEqual({ action: "deactivated" });
    expect(await customerSessions(customer)).toBe(0);
    expect((await User.findById(customer._id)).isActive).toBe(false);
    expect((await login(customer)).status).toBe(403);

    const res = await adminAgent.put(`/api/admin/users/${customer.id}/reactivate`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("User reactivated. They can log in again.");
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.password).toBeUndefined();

    // exactly the isActive flag changed; the password hash, role and profile are byte-for-byte what they were
    const after = (await User.findById(customer._id).select("+password")).toObject();
    expect(after.isActive).toBe(true);
    expect({ ...after, isActive: undefined, updatedAt: undefined }).toEqual({ ...before, isActive: undefined, updatedAt: undefined });

    // history kept; the cart and old sessions stay gone (deactivation removed them on purpose)
    expect(await Order.countDocuments({ user: customer._id })).toBe(1);
    expect(await Cart.countDocuments({ user: customer._id })).toBe(0);
    expect(await customerSessions(customer)).toBe(0);

    // and the user can log in again with their own, unchanged password
    const back = await login(customer);
    expect(back.status).toBe(200);
    expect((await adminAgent.get("/api/admin/users")).body.data.find((u) => u._id === customer.id).isActive).toBe(true);
  });

  test("a deactivated ADMIN regains admin access (role untouched)", async () => {
    const boss = await createUser({ role: "admin" });
    const other = await createUser({ role: "admin", isActive: false });
    const agent = await loginAgent(app, boss);

    expect((await agent.put(`/api/admin/users/${other.id}/reactivate`)).status).toBe(200);

    const otherAgent = await loginAgent(app, other); // login would be 403 if still deactivated
    expect((await otherAgent.get("/api/admin/dashboard")).status).toBe(200);
    expect((await User.findById(other._id)).role).toBe("admin");
  });

  test("an already-active user → 409 and the document is not touched", async () => {
    const admin = await createUser({ role: "admin" });
    const active = await createUser();
    const before = (await User.findById(active._id)).updatedAt.getTime();

    const res = await (await loginAgent(app, admin)).put(`/api/admin/users/${active.id}/reactivate`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This account is already active");
    expect((await User.findById(active._id)).updatedAt.getTime()).toBe(before);
  });

  test("a legacy user with NO isActive field counts as active → 409 and the field stays unset", async () => {
    const admin = await createUser({ role: "admin" });
    const legacy = await createUser();
    await User.collection.updateOne({ _id: legacy._id }, { $unset: { isActive: "" } });

    const res = await (await loginAgent(app, admin)).put(`/api/admin/users/${legacy.id}/reactivate`);

    expect(res.status).toBe(409);
    expect(await User.collection.findOne({ _id: legacy._id, isActive: { $exists: false } })).not.toBeNull();
  });

  test("unknown user → 404; malformed id → 400", async () => {
    const admin = await createUser({ role: "admin" });
    const agent = await loginAgent(app, admin);
    expect((await agent.put(`/api/admin/users/${new mongoose.Types.ObjectId()}/reactivate`)).status).toBe(404);
    expect((await agent.put("/api/admin/users/not-an-id/reactivate")).status).toBe(400);
  });

  test("a customer cannot reactivate anyone (403) and the user stays deactivated; anonymous → 401", async () => {
    const customer = await createUser();
    const dormant = await createUser({ isActive: false });

    const res = await (await loginAgent(app, customer)).put(`/api/admin/users/${dormant.id}/reactivate`);
    expect(res.status).toBe(403);
    expect((await (await newAgent(app)).put(`/api/admin/users/${dormant.id}/reactivate`)).status).toBe(401);
    expect((await User.findById(dormant._id)).isActive).toBe(false);
  });

  test("without a valid CSRF token the admin's request is refused (403) and nothing changes", async () => {
    const admin = await createUser({ role: "admin" });
    const dormant = await createUser({ isActive: false });
    const agent = await loginAgent(app, admin);

    const res = await agent.put(`/api/admin/users/${dormant.id}/reactivate`).set("X-CSRF-Token", "forged");

    expect(res.status).toBe(403);
    expect((await User.findById(dormant._id)).isActive).toBe(false);
  });

  test("two admins reactivate the SAME user at once → exactly one 200 and one 409 (atomic)", async () => {
    const [a1, a2] = [await createUser({ role: "admin" }), await createUser({ role: "admin" })];
    const dormant = await createUser({ isActive: false });
    const [g1, g2] = [await loginAgent(app, a1), await loginAgent(app, a2)];

    const results = await Promise.all([g1.put(`/api/admin/users/${dormant.id}/reactivate`), g2.put(`/api/admin/users/${dormant.id}/reactivate`)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await User.findById(dormant._id)).isActive).toBe(true);
  });
});
