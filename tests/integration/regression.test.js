// Existing functionality still works end-to-end against a REAL MongoDB
// (register → login → menu → cart → checkout → orders → profile, plus the admin dashboard).
// NOT executed in the sandbox this was written in (no mongod binary reachable).

const request = require("supertest");
const app = require("../../server");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("../helpers/db");
const { createUser, createCategory, createFood, loginAgent, ORDER_BODY } = require("../helpers/factories");
const { newAgent, refreshCsrf } = require("../helpers/client");

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

test("customer journey: register → login → browse → cart → checkout → order history → profile", async () => {
  const category = await createCategory({ name: "Biryani" });
  const food = await createFood({ name: "Hyderabadi Biryani", price: 250, category: category._id });

  const agent = await newAgent(app); // like the real page: fetches a CSRF token first
  const register = await agent.post("/api/auth/register").send({ name: "Asha Rao", email: "asha@example.com", password: "secret12", phone: "9876543210" });
  expect(register.status).toBe(201);

  expect((await agent.post("/api/auth/login").send({ email: "asha@example.com", password: "wrong-pass" })).status).toBe(401);
  const login = await agent.post("/api/auth/login").send({ email: "asha@example.com", password: "secret12" });
  expect(login.status).toBe(200);
  expect(login.body.data.user).not.toHaveProperty("password");
  await refreshCsrf(agent); // login starts a new session, so the page fetches a new token
  expect((await agent.get("/api/auth/me")).body.data.user.email).toBe("asha@example.com");

  const menu = await request(app).get(`/api/foods?category=${category.id}`);
  expect(menu.status).toBe(200);
  expect(menu.body.data.foods.map((f) => f.name)).toEqual(["Hyderabadi Biryani"]);
  expect((await request(app).get(`/api/foods/${food.id}`)).body.data.price).toBe(250);
  expect((await request(app).get("/api/categories")).body.data).toHaveLength(1);

  expect((await agent.post("/api/cart").send({ foodId: food.id, quantity: 2 })).status).toBe(200);
  const cart = await agent.get("/api/cart");
  expect(cart.body.data).toMatchObject({ total: 500 });
  expect(cart.body.data.items[0].food).toMatchObject({ name: "Hyderabadi Biryani", price: 250 });

  const order = await agent.post("/api/orders").send(ORDER_BODY);
  expect(order.status).toBe(201);
  expect(order.body).toMatchObject({ success: true, message: "Order placed successfully" });

  const history = await agent.get("/api/orders");
  expect(history.body.data).toHaveLength(1);
  expect((await agent.get(`/api/orders/${order.body.data.order._id}`)).status).toBe(200);
  expect((await agent.get("/api/cart")).body.data.items).toHaveLength(0);

  const profile = await agent.put("/api/users/profile").send({ name: "Asha R", phone: "" });
  expect(profile.status).toBe(200);
  expect(profile.body.data.name).toBe("Asha R");
  expect(profile.body.data.phone || "").toBe(""); // phone cleared

  expect((await agent.post("/api/auth/logout")).status).toBe(200);
  expect((await agent.get("/api/orders")).status).toBe(401);
});

test("duplicate registration → 409; customers cannot use admin routes", async () => {
  await createUser({ email: "dup@example.com" });
  const dup = await (await newAgent(app)).post("/api/auth/register").send({ name: "Dup", email: "dup@example.com", password: "secret12" });
  expect(dup.status).toBe(409);

  const customer = await createUser();
  const agent = await loginAgent(app, customer);
  expect((await agent.get("/api/admin/dashboard")).status).toBe(403);
  expect((await agent.post("/api/foods").send({})).status).toBe(403);
});

test("admin: dashboard aggregation, user list and food/category CRUD still work", async () => {
  const admin = await createUser({ role: "admin" });
  const customer = await createUser();
  const food = await createFood();
  const c = await loginAgent(app, customer);
  await c.post("/api/cart").send({ foodId: food.id, quantity: 1 });
  await c.post("/api/orders").send(ORDER_BODY);

  const agent = await loginAgent(app, admin);
  const dash = await agent.get("/api/admin/dashboard");
  expect(dash.status).toBe(200);
  expect(dash.body.data.summary.totalOrders).toBe(1);
  expect(dash.body.data.topSpenders).toHaveLength(1);
  expect((await agent.get("/api/admin/users")).body.data.length).toBe(2);

  const cat = await agent.post("/api/categories").send({ name: "Desserts", description: "Sweet things" });
  expect(cat.status).toBe(201);
  const created = await agent.post("/api/foods").send({ name: "Gulab Jamun", price: 60, category: cat.body.data._id, rating: 0 });
  expect(created.status).toBe(201);
  expect(created.body.data.rating).toBe(0); // 0 is kept, not turned into 4.0
  const missingCategory = await agent.post("/api/foods").send({ name: "Ghost", price: 1, category: "5f8d0d55b54764421b7156c3" });
  expect(missingCategory.status).toBe(400);
  expect((await agent.put(`/api/foods/${created.body.data._id}`).send({ name: "Gulab Jamun", price: 65, category: cat.body.data._id })).status).toBe(200);
  expect((await agent.delete(`/api/foods/${created.body.data._id}`)).status).toBe(200);
});

test("invalid ids are 400 with a real database too", async () => {
  expect((await request(app).get("/api/foods/not-an-id")).status).toBe(400);
});
