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
