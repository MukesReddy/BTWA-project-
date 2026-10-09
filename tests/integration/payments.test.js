// UPI QR payments against a REAL MongoDB: server-side pricing, unique indexes, atomic state changes, REAL concurrent
// webhooks, expiry, cart restoration, lifecycle gating and dashboard figures.
// NOT executed in the sandbox this was written in (no mongod binary reachable): run `npm run test:integration`.

const crypto = require("crypto");
const request = require("supertest");
const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const Cart = require("../../models/Cart");
const Order = require("../../models/Order");
const logger = require("../../utils/logger"); // jest-mocked for every test file (tests/helpers/setupAfterEnv.js)
const { expireStalePayments } = require("../../services/paymentService");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("../helpers/db");
const { createUser, createFood, loginAgent, ADDRESS, ORDER_BODY } = require("../helpers/factories");
const { serverFor, anonymous } = require("../helpers/client");

const SECRET = "i".repeat(10) + "Nt3!" + "g".repeat(26); // 40 chars, test only
let app, admin, owner, other, third, adminAgent, ownerAgent, otherAgent, thirdAgent;

beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  app = createApp(
    loadConfig({ NODE_ENV: "test", SESSION_SECRET: "integration-secret", RATE_LIMIT_DISABLED: "true", UPI_ID: "shop@okicici", UPI_PAYEE_NAME: "FoodieHub Test", PAYMENT_WEBHOOK_SECRET: SECRET })
  );
  admin = await createUser({ role: "admin" });
  owner = await createUser();
  other = await createUser();
  third = await createUser();
  adminAgent = await loginAgent(app, admin);
  ownerAgent = await loginAgent(app, owner);
  otherAgent = await loginAgent(app, other);
  thirdAgent = await loginAgent(app, third);
});
beforeEach(async () => {
  await Order.deleteMany({});
  await Cart.deleteMany({});
});
afterAll(disconnectTestDb);

const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
const webhook = async (body, { signature } = {}) => {
  const raw = JSON.stringify(body);
  return request(await serverFor(app)).post("/api/payments/webhook").set("Content-Type", "application/json").set("X-Payment-Signature", signature || sign(raw)).send(raw);
};
const fill = async (agent, entries) => {
  for (const [food, quantity] of entries) expect((await agent.post("/api/cart").send({ foodId: food.id, quantity })).status).toBe(200);
};
/** Cart (3 × 250 + 1 × 100.05) → POST /api/payments/upi. */
const startPayment = async (agent = ownerAgent, extraBody = {}) => {
  const a = await createFood({ price: 250 });
  const b = await createFood({ price: 100.05 });
  await fill(agent, [[a, 3], [b, 1]]);
  const res = await agent.post("/api/payments/upi").send({ deliveryAddress: ADDRESS, ...extraBody });
  expect(res.status).toBe(201);
  return { res, p: res.body.data, foods: [a, b] };
};
const reload = (id) => Order.findById(id).lean();
const TXN = (n = 1) => `UTR${String(n).padStart(12, "0")}`;

describe("starting a payment", () => {
  test("the order is priced from the database, stored PENDING/Pending, the cart is consumed, and the QR carries the same amount", async () => {
    const { p, foods } = await startPayment(ownerAgent, { amount: 1, totalAmount: 1 }); // a tampered amount changes nothing
    expect(p.amount).toBe(850.05);
    expect(p.upiUri).toContain("am=850.05");
    expect(p.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const order = await reload(p.orderId);
    expect(order).toMatchObject({ paymentMethod: "UPI", paymentStatus: "PENDING", orderStatus: "Pending", totalAmount: 850.05, paymentRef: p.paymentRef });
    expect(order.paidAt).toBeUndefined();
    expect(order.paymentTransactionId).toBeUndefined();
    expect(order.items.map((i) => [String(i.food), i.quantity, i.price])).toEqual([[foods[0].id, 3, 250], [foods[1].id, 1, 100.05]]);
    expect(order.paymentExpiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(await Cart.countDocuments({ user: owner._id })).toBe(0);
  });

  test("price changed after adding to the cart → the QR uses the NEW price", async () => {
    const food = await createFood({ price: 100 });
    await fill(ownerAgent, [[food, 2]]);
    await food.updateOne({ price: 130 });
    const res = await ownerAgent.post("/api/payments/upi").send({ deliveryAddress: ADDRESS });
    expect(res.body.data.amount).toBe(260);
    expect(res.body.data.upiUri).toContain("am=260.00");
  });

  test("empty cart → 400; unavailable item → 400 and the cart stays; a second click can create only one order", async () => {
    expect((await ownerAgent.post("/api/payments/upi").send({ deliveryAddress: ADDRESS })).status).toBe(400);

    const gone = await createFood({ name: "Sold-out Special" });
    await fill(ownerAgent, [[gone, 1]]);
    await gone.updateOne({ available: false });
    const blocked = await ownerAgent.post("/api/payments/upi").send({ deliveryAddress: ADDRESS });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain("Sold-out Special");
    expect(await Cart.countDocuments({ user: owner._id })).toBe(1);
    expect(await Order.countDocuments()).toBe(0);

    await Cart.deleteMany({});
    await fill(ownerAgent, [[await createFood({ price: 50 }), 1]]);
    const results = await Promise.all([1, 2, 3, 4].map(() => ownerAgent.post("/api/payments/upi").send({ deliveryAddress: ADDRESS })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Order.countDocuments()).toBe(1);
  });

  test("not logged in / no CSRF token → refused, nothing created; Cash on Delivery still works", async () => {
    await fill(ownerAgent, [[await createFood({ price: 50 }), 1]]);
    const anon = await anonymous(app);
    expect((await anon.post("/api/payments/upi").send({ deliveryAddress: ADDRESS })).status).toBe(403);
    expect(await Order.countDocuments()).toBe(0);

    const cod = await ownerAgent.post("/api/orders").send(ORDER_BODY);
    expect(cod.status).toBe(201);
    const stored = await reload(cod.body.data.order._id);
    expect(stored.paymentMethod).toBe("Cash on Delivery");
    expect(stored.paymentStatus).toBe("PENDING"); // schema default; for COD it only means "collect on delivery"
    expect(stored.paymentRef).toBeUndefined();
    expect((await ownerAgent.post("/api/orders").send({ ...ORDER_BODY, paymentMethod: "UPI" })).status).toBe(400);
  });

  test("the unique indexes for paymentRef and paymentTransactionId exist (and are partial, so COD orders are not affected)", async () => {
    const indexes = await Order.collection.indexes();
    for (const field of ["paymentRef", "paymentTransactionId"]) {
      const index = indexes.find((i) => i.key[field] === 1);
      expect(index).toMatchObject({ unique: true });
      expect(index.partialFilterExpression).toBeDefined();
    }
    const codOrder = () => ({ user: owner._id, items: [{ food: owner._id, foodName: "x", quantity: 1, price: 1 }], totalAmount: 1, deliveryAddress: ADDRESS, paymentMethod: "Cash on Delivery" });
    await Order.create([codOrder(), codOrder()]);
    expect(await Order.countDocuments()).toBe(2); // two COD orders without a paymentRef do not collide
  });
});

describe("only a verified result makes an order paid", () => {
  test("polling and viewing never change anything; the owner sees the QR, another customer is refused (403), the admin may look", async () => {
    const { p } = await startPayment();
    for (let i = 0; i < 3; i++) expect((await ownerAgent.get(`/api/payments/${p.orderId}`)).body.data.paymentStatus).toBe("PENDING");
    expect((await otherAgent.get(`/api/payments/${p.orderId}`)).status).toBe(403);
    expect((await adminAgent.get(`/api/payments/${p.orderId}`)).status).toBe(200);
    expect((await reload(p.orderId)).paymentStatus).toBe("PENDING");
  });

  test("bad signatures and tampered bodies change nothing (real DB)", async () => {
    const { p } = await startPayment();
    const body = { paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN() };
    expect((await webhook(body, { signature: "0".repeat(64) })).status).toBe(401);
    expect((await webhook({ ...body, amount: 1 }, { signature: sign(JSON.stringify(body)) })).status).toBe(401);
    expect((await reload(p.orderId)).paymentStatus).toBe("PENDING");
  });

  test("a signed SUCCESS with the right amount → PAID with paidAt, transaction id and 'webhook'; the order stays Pending", async () => {
    const { p } = await startPayment();
    const res = await webhook({ paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN() });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ orderId: p.orderId, paymentStatus: "PAID", duplicate: false });
    const order = await reload(p.orderId);
    expect(order).toMatchObject({ paymentStatus: "PAID", paymentTransactionId: TXN(), paymentVerifiedBy: "webhook", orderStatus: "Pending" });
    expect(order.paidAt).toBeInstanceOf(Date);
    expect((await ownerAgent.get(`/api/payments/${p.orderId}`)).body.data.qrDataUrl).toBeUndefined();
  });

  test.each([849.99, 850.06, 8500.5, 85])("a SUCCESS for the wrong amount (%p) is 400 and the order stays PENDING", async (amount) => {
    const { p } = await startPayment();
    const res = await webhook({ paymentRef: p.paymentRef, status: "SUCCESS", amount, transactionId: TXN() });
    expect(res.status).toBe(400);
    expect((await reload(p.orderId)).paymentStatus).toBe("PENDING");
  });

  test("admin confirmation: UTR required; PAID with a UTR works; the order's own total is the amount", async () => {
    const { p } = await startPayment();
    expect((await adminAgent.put(`/api/admin/orders/${p.orderId}/payment`).send({ status: "PAID" })).status).toBe(400);
    expect((await ownerAgent.put(`/api/admin/orders/${p.orderId}/payment`).send({ status: "PAID", transactionId: TXN() })).status).toBe(403);
    expect((await reload(p.orderId)).paymentStatus).toBe("PENDING");

    const res = await adminAgent.put(`/api/admin/orders/${p.orderId}/payment`).send({ status: "PAID", transactionId: TXN(2) });
    expect(res.status).toBe(200);
    expect(await reload(p.orderId)).toMatchObject({ paymentStatus: "PAID", paymentTransactionId: TXN(2), paymentVerifiedBy: "admin" });
  });
});

describe("repeated, duplicate and simultaneous notifications", () => {
  test("the same notification again → 200 duplicate; a different transaction for the same order → 409; data unchanged", async () => {
    const { p } = await startPayment();
    const body = { paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN() };
    expect((await webhook(body)).body.data.duplicate).toBe(false);
    const again = await webhook(body);
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    const admin2 = await adminAgent.put(`/api/admin/orders/${p.orderId}/payment`).send({ status: "PAID", transactionId: TXN() });
    expect(admin2.status).toBe(200); // the same UTR confirmed by an admin after the webhook: idempotent
    expect(admin2.body.message).toMatch(/already recorded/);

    const other_ = await webhook({ ...body, transactionId: TXN(9) });
    expect(other_.status).toBe(409);
    expect((await reload(p.orderId)).paymentTransactionId).toBe(TXN());
  });

  test("ONE transaction id cannot pay TWO orders (real unique index)", async () => {
    const first = await startPayment(ownerAgent);
    const second = await startPayment(otherAgent);
    expect((await webhook({ paymentRef: first.p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(5) })).status).toBe(200);
    const clash = await webhook({ paymentRef: second.p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(5) });
    expect(clash.status).toBe(409);
    expect(await reload(second.p.orderId)).toMatchObject({ paymentStatus: "PENDING" });
    const clashAdmin = await adminAgent.put(`/api/admin/orders/${second.p.orderId}/payment`).send({ status: "PAID", transactionId: TXN(5) });
    expect(clashAdmin.status).toBe(409);
  });

  test("6 identical webhooks at the same instant: exactly ONE applies, five are duplicates, the order is paid once", async () => {
    const { p } = await startPayment();
    const body = { paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(7) };
    const results = await Promise.all(Array.from({ length: 6 }, () => webhook(body)));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(results.filter((r) => r.body.data.duplicate === false)).toHaveLength(1);
    expect(await Order.countDocuments({ paymentStatus: "PAID" })).toBe(1);
  });

  test("SUCCESS and FAILED racing: the end state is consistent: PAID-and-not-cancelled, or FAILED-and-cancelled, never a mix", async () => {
    for (let round = 0; round < 5; round++) {
      await Order.deleteMany({});
      await Cart.deleteMany({});
      const { p } = await startPayment();
      await Promise.all([
        webhook({ paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(20 + round) }),
        webhook({ paymentRef: p.paymentRef, status: "FAILED" }),
      ]);
      const order = await reload(p.orderId);
      if (order.paymentStatus === "PAID") expect(order.orderStatus).toBe("Pending");
      else expect(order).toMatchObject({ paymentStatus: "FAILED", orderStatus: "Cancelled" });
    }
  });
});

describe("failed, cancelled and expired payments give the cart back", () => {
  test("provider FAILED → payment FAILED, order Cancelled, cart restored with the same lines; a repeat is a harmless duplicate", async () => {
    const { p, foods } = await startPayment();
    const res = await webhook({ paymentRef: p.paymentRef, status: "FAILED" });
    expect(res.body.data).toMatchObject({ paymentStatus: "FAILED", duplicate: false });
    expect(await reload(p.orderId)).toMatchObject({ paymentStatus: "FAILED", orderStatus: "Cancelled" });
    const cart = await Cart.findOne({ user: owner._id });
    expect(cart.items.map((i) => [String(i.food), i.quantity])).toEqual([[foods[0].id, 3], [foods[1].id, 1]]);

    expect((await webhook({ paymentRef: p.paymentRef, status: "FAILED" })).body.data.duplicate).toBe(true);
    expect(await Cart.countDocuments({ user: owner._id })).toBe(1);
    // and the customer can pay again straight away
    expect((await ownerAgent.post("/api/payments/upi").send({ deliveryAddress: ADDRESS })).status).toBe(201);
  });

  test("a restored cart never overwrites a cart the customer already started (unique Cart.user index)", async () => {
    const { p } = await startPayment();
    const newFood = await createFood({ price: 10 });
    await fill(ownerAgent, [[newFood, 4]]); // the customer began a new cart while the QR was open
    await webhook({ paymentRef: p.paymentRef, status: "FAILED" });
    const cart = await Cart.findOne({ user: owner._id });
    expect(cart.items.map((i) => [String(i.food), i.quantity])).toEqual([[newFood.id, 4]]);
    expect(await Cart.countDocuments({ user: owner._id })).toBe(1);
  });

  test("customer cancels an unpaid UPI order → Cancelled + payment CANCELLED + cart restored; a LATE payment is recorded but the order stays Cancelled and a refund warning is logged", async () => {
    const { p } = await startPayment();
    const cancel = await ownerAgent.put(`/api/orders/${p.orderId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(await reload(p.orderId)).toMatchObject({ paymentStatus: "CANCELLED", orderStatus: "Cancelled" });
    expect(await Cart.countDocuments({ user: owner._id })).toBe(1);

    const late = await webhook({ paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(30) });
    expect(late.status).toBe(200);
    expect(await reload(p.orderId)).toMatchObject({ paymentStatus: "PAID", orderStatus: "Cancelled" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/manual refund required/));
  });

  test("a PAID UPI order cannot be cancelled by the customer (409) and nothing changes", async () => {
    const { p } = await startPayment();
    await webhook({ paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(31) });
    const res = await ownerAgent.put(`/api/orders/${p.orderId}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/refund/i);
    expect(await reload(p.orderId)).toMatchObject({ paymentStatus: "PAID", orderStatus: "Pending" });
  });

  test("expiry: opening the page after the window closes expires it (no QR) and restores the cart; the background job does the same for every due payment and spares paid and COD orders", async () => {
    const one = await startPayment(ownerAgent);
    await Order.updateOne({ _id: one.p.orderId }, { $set: { paymentExpiresAt: new Date(Date.now() - 1000) } });
    const res = await ownerAgent.get(`/api/payments/${one.p.orderId}`);
    expect(res.body.data).toMatchObject({ paymentStatus: "EXPIRED", orderStatus: "Cancelled" });
    expect(res.body.data.qrDataUrl).toBeUndefined();
    expect(await Cart.countDocuments({ user: owner._id })).toBe(1);

    const due = await startPayment(otherAgent);
    const paid = await startPayment(thirdAgent);
    await webhook({ paymentRef: paid.p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(40) });
    const cod = await ownerAgent.post("/api/orders").send(ORDER_BODY); // the cart restored above becomes a Cash on Delivery order
    expect(cod.status).toBe(201);
    await Order.updateMany({ _id: { $in: [due.p.orderId, paid.p.orderId] } }, { $set: { paymentExpiresAt: new Date(Date.now() - 1000) } });

    expect(await expireStalePayments()).toBe(1);
    expect(await reload(due.p.orderId)).toMatchObject({ paymentStatus: "EXPIRED", orderStatus: "Cancelled" });
    expect(await reload(paid.p.orderId)).toMatchObject({ paymentStatus: "PAID", orderStatus: "Pending" });
    expect(await expireStalePayments()).toBe(0);
    expect(await reload(cod.body.data.order._id)).toMatchObject({ paymentMethod: "Cash on Delivery", orderStatus: "Pending" });
  });
});

describe("lifecycle and dashboard", () => {
  test("an unpaid UPI order cannot be Confirmed (409) but can be Cancelled; once PAID it follows the normal lifecycle", async () => {
    const { p } = await startPayment();
    const blocked = await adminAgent.put(`/api/admin/orders/${p.orderId}/status`).send({ status: "Confirmed" });
    expect(blocked.status).toBe(409);
    expect((await reload(p.orderId)).orderStatus).toBe("Pending");

    await webhook({ paymentRef: p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(50) });
    expect((await adminAgent.put(`/api/admin/orders/${p.orderId}/status`).send({ status: "Confirmed" })).status).toBe(200);
    expect((await adminAgent.put(`/api/admin/orders/${p.orderId}/status`).send({ status: "Preparing" })).status).toBe(200);
  });

  test("cancelling an unpaid UPI order as admin closes the payment and restores the cart", async () => {
    const { p } = await startPayment();
    expect((await adminAgent.put(`/api/admin/orders/${p.orderId}/status`).send({ status: "Cancelled" })).status).toBe(200);
    expect(await reload(p.orderId)).toMatchObject({ paymentStatus: "CANCELLED", orderStatus: "Cancelled" });
    expect(await Cart.countDocuments({ user: owner._id })).toBe(1);
  });

  test("an OLD order stored before payments existed (no payment fields) still works: Confirm succeeds and it counts as revenue", async () => {
    await Order.collection.insertOne({
      user: owner._id, items: [{ food: owner._id, foodName: "Legacy Thali", quantity: 1, price: 120 }], totalAmount: 120,
      deliveryAddress: ADDRESS, paymentMethod: "Cash on Delivery", orderStatus: "Pending", createdAt: new Date(), updatedAt: new Date(),
    });
    const legacy = await Order.findOne({ paymentMethod: "Cash on Delivery" });
    expect(legacy.paymentStatus).toBe("PENDING"); // schema default on read
    expect((await adminAgent.put(`/api/admin/orders/${legacy.id}/status`).send({ status: "Confirmed" })).status).toBe(200);
    const stats = await adminAgent.get("/api/admin/dashboard");
    expect(stats.body.data.summary.totalRevenue).toBe(120);
  });

  test("dashboard revenue counts COD and PAID UPI only: unpaid, failed, expired, cancelled UPI orders earn nothing", async () => {
    await Order.collection.insertOne({
      user: owner._id, items: [{ food: owner._id, foodName: "COD Thali", quantity: 1, price: 120 }], totalAmount: 120,
      deliveryAddress: ADDRESS, paymentMethod: "Cash on Delivery", orderStatus: "Pending", createdAt: new Date(), updatedAt: new Date(),
    });
    const paid = await startPayment(ownerAgent);        // 850.05, will be PAID
    const unpaid = await startPayment(otherAgent);      // stays PENDING
    const failed = await startPayment(thirdAgent);      // FAILED
    await webhook({ paymentRef: paid.p.paymentRef, status: "SUCCESS", amount: 850.05, transactionId: TXN(60) });
    await webhook({ paymentRef: failed.p.paymentRef, status: "FAILED" });

    const stats = (await adminAgent.get("/api/admin/dashboard")).body.data;
    expect(stats.summary.totalRevenue).toBeCloseTo(970.05, 2);          // 120 + 850.05
    expect(stats.summary.totalOrders).toBe(4);                          // counts include every order
    expect(stats.topSpenders.every((s) => s.totalSpent <= 970.05)).toBe(true);
    expect(unpaid.p.orderId).toBeDefined();
  });
});
