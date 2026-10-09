// Final acceptance walk-through against a REAL MongoDB and the REAL connect-mongo session store.
// One customer and one admin use the application the way a person would, start to finish:
//
//   customer: register → log in → browse → cart (add / change / remove) → checkout → order history →
//             cancel a Pending order → place a second order
//   admin:    list orders → move an order through the lifecycle (an illegal step is refused) →
//             dashboard figures (the cancelled order earns nothing) → CSV export →
//             deactivate the customer (history kept) → reactivate
//   customer: cancellation is refused once the order is no longer Pending → change password
//             (other devices signed out, old password dead) → log out
//
// The detailed edge cases live in the other integration files; this one proves the pieces fit together.
// NOT executed in the sandbox this was written in (no MongoDB reachable). Run:  npm run test:integration

const mongoose = require("mongoose");
const { MongoStore } = require("connect-mongo");
const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const { connectTestDb, clearTestDb, disconnectTestDb, DB_NAME } = require("../helpers/db");
const { createUser, createFood, createCategory, loginAgent, PASSWORD, ORDER_BODY } = require("../helpers/factories");
const { newAgent, refreshCsrf, anonymous } = require("../helpers/client");
const { parseCsv } = require("../helpers/csv");

jest.setTimeout(60000);

let app;
beforeAll(async () => {
  await connectTestDb();
  app = createApp(loadConfig({ NODE_ENV: "test", SESSION_SECRET: "integration-secret", RATE_LIMIT_DISABLED: "true" }), {
    sessionStore: new MongoStore({ client: mongoose.connection.getClient(), dbName: DB_NAME, touchAfter: 0 }),
  });
});
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

/** Fail with the NAME of the step (a bare "expected 200, got 409" is useless in a 40-step story). */
const expectStatus = (label, res, status) => {
  if (res.status !== status) {
    throw new Error(`Step "${label}": expected HTTP ${status} but got ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
};

const EMAIL = "asha.walkthrough@example.com";

test("the whole product works end to end for a customer and an admin", async () => {
  const category = await createCategory({ name: "Walkthrough Biryani" });
  const biryani = await createFood({ name: "Walkthrough Biryani", price: 120, category: category._id });
  const lassi = await createFood({ name: "Walkthrough Lassi", price: 80, category: category._id });
  const admin = await createUser({ role: "admin", name: "Boss", email: "boss.walkthrough@example.com" });

  // ── 1. Anonymous visitor: the menu is public, the cart is not ─────────────────────────────
  const anon = await anonymous(app);
  const menu = expectStatus("public menu", await anon.get(`/api/foods?category=${category.id}`), 200);
  expect(menu.body.data.foods.map((f) => f.name).sort()).toEqual(["Walkthrough Biryani", "Walkthrough Lassi"]);
  expectStatus("cart needs login", await (await anonymous(app)).get("/api/cart"), 401);

  // ── 2. Register, refuse a duplicate, log in (wrong password first) ────────────────────────
  const visitor = await newAgent(app);
  expectStatus("register", await visitor.post("/api/auth/register").send({ name: "Asha Rao", email: EMAIL, password: PASSWORD }), 201);
  expectStatus("duplicate email", await visitor.post("/api/auth/register").send({ name: "Asha Again", email: EMAIL, password: PASSWORD }), 409);
  expectStatus("wrong password", await visitor.post("/api/auth/login").send({ email: EMAIL, password: "not-the-password" }), 401);

  const customer = await loginAgent(app, { email: EMAIL });
  const me = expectStatus("who am I", await customer.get("/api/auth/me"), 200);
  expect(me.body.data.user).toMatchObject({ email: EMAIL, name: "Asha Rao", role: "customer" });
  expect(me.body.data.user.password).toBeUndefined();
  const customerId = me.body.data.user._id;

  // ── 3. Cart: add, change quantity, add another, remove it ─────────────────────────────────
  expect(expectStatus("empty cart", await customer.get("/api/cart"), 200).body.data.total).toBe(0);
  expect(expectStatus("add biryani", await customer.post("/api/cart").send({ foodId: biryani.id, quantity: 2 }), 200).body.data.total).toBe(240);
  expect(expectStatus("change quantity", await customer.put(`/api/cart/${biryani.id}`).send({ quantity: 3 }), 200).body.data.total).toBe(360);
  const twoItems = expectStatus("add lassi", await customer.post("/api/cart").send({ foodId: lassi.id, quantity: 1 }), 200);
  expect(twoItems.body.data.items).toHaveLength(2);
  expect(expectStatus("remove lassi", await customer.delete(`/api/cart/${lassi.id}`), 200).body.data.items).toHaveLength(1);
  expectStatus("over the per-item limit", await customer.post("/api/cart").send({ foodId: biryani.id, quantity: 20 }), 400);

  // ── 4. Checkout: price comes from the database, the cart is emptied ───────────────────────
  const first = expectStatus("place order 1", await customer.post("/api/orders").send(ORDER_BODY), 201).body.data.order;
  expect(first).toMatchObject({ totalAmount: 360, orderStatus: "Pending", paymentMethod: "Cash on Delivery" });
  expect(expectStatus("cart emptied", await customer.get("/api/cart"), 200).body.data.items).toHaveLength(0);
  expectStatus("empty cart cannot be ordered", await customer.post("/api/orders").send(ORDER_BODY), 400);

  // ── 5. Order history and details ───────────────────────────────────────────────────────────
  expect(expectStatus("my orders", await customer.get("/api/orders"), 200).body.data).toHaveLength(1);
  expect(expectStatus("order details", await customer.get(`/api/orders/${first._id}`), 200).body.data.items[0].foodName).toBe("Walkthrough Biryani");

  // ── 6. Cancel a Pending order (once) ───────────────────────────────────────────────────────
  const cancelled = expectStatus("cancel pending", await customer.put(`/api/orders/${first._id}/cancel`), 200);
  expect(cancelled.body.data.orderStatus).toBe("Cancelled");
  expectStatus("cancel twice", await customer.put(`/api/orders/${first._id}/cancel`), 409);

  // ── 7. A second order (1 biryani + 1 lassi = 200) ──────────────────────────────────────────
  expectStatus("add biryani again", await customer.post("/api/cart").send({ foodId: biryani.id, quantity: 1 }), 200);
  expectStatus("add lassi again", await customer.post("/api/cart").send({ foodId: lassi.id, quantity: 1 }), 200);
  const second = expectStatus("place order 2", await customer.post("/api/orders").send(ORDER_BODY), 201).body.data.order;
  expect(second.totalAmount).toBe(200);

  // ── 8. Admin: sees both orders and walks order 2 through the lifecycle ────────────────────
  const boss = await loginAgent(app, admin);
  const all = expectStatus("admin lists orders", await boss.get("/api/admin/orders"), 200);
  expect(all.body.data.pagination.total).toBe(2);
  expectStatus("a customer is not an admin", await customer.get("/api/admin/orders"), 403);

  const move = (status) => boss.put(`/api/admin/orders/${second._id}/status`).send({ status });
  expectStatus("Pending → Confirmed", await move("Confirmed"), 200);
  expectStatus("Confirmed → Delivered is not allowed", await move("Delivered"), 409);
  expectStatus("Confirmed → Preparing", await move("Preparing"), 200);

  // ── 9. The customer can no longer cancel it (only Pending orders can be) ───────────────────
  const tooLate = expectStatus("cancel after Preparing", await customer.put(`/api/orders/${second._id}/cancel`), 409);
  expect(tooLate.body.message).toMatch(/Only Pending orders can be cancelled/);

  expectStatus("Preparing → Out for Delivery", await move("Out for Delivery"), 200);
  expectStatus("Out for Delivery → Delivered", await move("Delivered"), 200);
  expectStatus("Delivered is final", await move("Cancelled"), 409);

  // ── 10. Dashboard: the cancelled order counts as an order but earns nothing ───────────────
  const dash = expectStatus("dashboard", await boss.get("/api/admin/dashboard"), 200).body.data;
  expect(dash.summary).toMatchObject({ totalOrders: 2, totalRevenue: 200, pendingOrders: 0, totalUsers: 2 });
  const byStatus = Object.fromEntries(dash.ordersByStatus.map((s) => [s._id, s.count]));
  expect(byStatus).toEqual({ Delivered: 1, Cancelled: 1 });
  expect(dash.popularFoods.map((f) => f.foodName).sort()).toEqual(["Walkthrough Biryani", "Walkthrough Lassi"]);
  expect(dash.popularFoods.find((f) => f.foodName === "Walkthrough Biryani").totalOrdered).toBe(1); // the cancelled 3 do not count

  // ── 11. CSV export: header + one row per order, correct statuses ──────────────────────────
  const csv = expectStatus("export CSV", await boss.get("/api/admin/export/orders"), 200);
  expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
  const rows = parseCsv(csv.text);
  expect(rows[0]).toEqual(["Order ID", "User Name", "User Email", "Total Amount", "Status", "Payment Method", "Date"]);
  expect(rows).toHaveLength(3);
  rows.forEach((row) => expect(row).toHaveLength(7));
  const byId = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
  expect(byId[first._id].slice(1, 6)).toEqual(["Asha Rao", EMAIL, "360", "Cancelled", "Cash on Delivery"]);
  expect(byId[second._id].slice(1, 6)).toEqual(["Asha Rao", EMAIL, "200", "Delivered", "Cash on Delivery"]);

  // ── 12. User management: deactivate (has orders → history kept), blocked, reactivate ──────
  expectStatus("an admin cannot delete themselves", await boss.delete(`/api/admin/users/${admin.id}`), 400);
  const deactivated = expectStatus("deactivate customer", await boss.delete(`/api/admin/users/${customerId}`), 200);
  expect(deactivated.body.data.action).toBe("deactivated");
  expectStatus("existing session stops working", await customer.get("/api/orders"), 401);
  const blocked = expectStatus("deactivated cannot log in", await (await newAgent(app)).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD }), 403);
  expect(blocked.body.message).toMatch(/deactivated/i);
  expect(expectStatus("history kept", await boss.get("/api/admin/orders"), 200).body.data.pagination.total).toBe(2);

  expectStatus("reactivate", await boss.put(`/api/admin/users/${customerId}/reactivate`), 200);
  expectStatus("reactivate twice", await boss.put(`/api/admin/users/${customerId}/reactivate`), 409);

  // ── 13. Back again: the order history is still theirs; change the password ────────────────
  const phone = await loginAgent(app, { email: EMAIL });
  const laptop = await loginAgent(app, { email: EMAIL });
  expect(expectStatus("history after reactivation", await phone.get("/api/orders"), 200).body.data).toHaveLength(2);

  expectStatus("wrong current password", await phone.put("/api/users/password").send({ currentPassword: "nope-nope", newPassword: "freshPass789" }), 400);
  expectStatus("change password", await phone.put("/api/users/password").send({ currentPassword: PASSWORD, newPassword: "freshPass789" }), 200);
  expectStatus("other device signed out", await laptop.get("/api/auth/me"), 401);
  expectStatus("this device still signed in", await phone.get("/api/auth/me"), 200);
  expectStatus("old password is dead", await (await newAgent(app)).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD }), 401);
  expectStatus("new password works", await (await newAgent(app)).post("/api/auth/login").send({ email: EMAIL, password: "freshPass789" }), 200);

  // ── 14. Log out ────────────────────────────────────────────────────────────────────────────
  await refreshCsrf(phone); // the password change gave this device a new session (and so a new CSRF token)
  expectStatus("logout", await phone.post("/api/auth/logout"), 200);
  expectStatus("logged out", await phone.get("/api/auth/me"), 401);
});
