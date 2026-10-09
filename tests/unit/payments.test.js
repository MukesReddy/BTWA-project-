// Online UPI QR payments: DB-free tests of the REAL routes, middleware (auth, validation, CSRF, sessions) and services.
// Only the database models are mocked. They prove WHICH rules and WHICH queries the code uses; that MongoDB really applies
// them atomically (unique indexes, simultaneous webhooks) is proven in tests/integration/payments.test.js.
//
//  1 COD still works                       6 an unverified payment can never mark paid
//  2 QR amount = server total              7 a verified payment updates the right order
//  3 a client-sent amount is ignored       8 failed / cancelled / repeated / duplicate notifications
//  4 no login → cannot start               9 empty cart, unavailable items
//  5 generating the QR does not mark paid 10 (frontend: tests/frontend/payments.test.js)

const crypto = require("crypto");
const request = require("supertest");
const QRCode = require("qrcode");
const { createApp } = require("../../server");
const { loadConfig } = require("../../config/env");
const Cart = require("../../models/Cart");
const Food = require("../../models/Food");
const Order = require("../../models/Order");
const logger = require("../../utils/logger");
const { getDashboardStats } = require("../../services/analyticsService");
const { expireStalePayments } = require("../../services/paymentService");
const { query } = require("../helpers/chain");
const { loginAs, newId } = require("../helpers/auth");
const { serverFor, newAgent } = require("../helpers/client");

const SECRET = "w".repeat(16) + "e".repeat(16) + "b".repeat(8); // 40 chars, test only
const baseEnv = { NODE_ENV: "test", SESSION_SECRET: "payments-test-secret", RATE_LIMIT_DISABLED: "true" };
const upiEnv = { ...baseEnv, UPI_ID: "shop@okicici", UPI_PAYEE_NAME: "FoodieHub Test", PAYMENT_WEBHOOK_SECRET: SECRET };
const app = createApp(loadConfig(upiEnv));
const appWithoutUpi = createApp(loadConfig(baseEnv)); // no UPI_ID, no webhook secret

const address = { street: "12 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" };
const ID = (hex) => ({ toString: () => hex });
const REF = "FH0123456789ABCDEF";
const UTR = "UTR123456789012";

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
/** A cart with a TAMPERED price (1) and the live prices in Food: 3 × 250 + 1 × 100 = 850. */
const setupCart = ({ foods, claimed = true } = {}) => {
  const A = "a".repeat(24);
  const B = "b".repeat(24);
  const cart = {
    _id: newId(),
    user: newId(),
    updatedAt: new Date("2026-01-01T10:00:00Z"),
    items: [
      { food: ID(A), quantity: 3, price: 1 },
      { food: ID(B), quantity: 1, price: 1 },
    ],
  };
  cart.items.forEach((i) => (i.food._id = i.food.toString()));
  const liveFoods = foods || [
    { _id: A, name: "Biryani", price: 250, available: true },
    { _id: B, name: "Lassi", price: 100, available: true },
  ];
  jest.spyOn(Cart, "findOne").mockResolvedValue(cart);
  jest.spyOn(Food, "find").mockReturnValue(query(liveFoods.map((f) => ({ ...f, _id: ID(f._id) }))));
  jest.spyOn(Cart, "updateOne").mockResolvedValue({});
  const claim = jest.spyOn(Cart, "findOneAndDelete").mockResolvedValue(claimed ? { ...cart, toObject: () => cart } : null);
  const create = jest.spyOn(Order, "create").mockImplementation(async (doc) => ({ _id: newId(), ...doc }));
  const restore = jest.spyOn(Cart, "create").mockResolvedValue({});
  return { cart, claim, create, restore };
};

/** A UPI order as the database would return it (lean). */
const upiOrder = (overrides = {}) => ({
  _id: newId(),
  user: newId(),
  items: [{ food: ID("a".repeat(24)), foodName: "Biryani", quantity: 2, price: 250 }],
  totalAmount: 500,
  paymentMethod: "UPI",
  paymentStatus: "PENDING",
  paymentRef: REF,
  paymentExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  orderStatus: "Pending",
  ...overrides,
});

const sign = (raw, secret = SECRET) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
const webhook = async (body, { signature, raw, target = app } = {}) => {
  const text = raw !== undefined ? raw : JSON.stringify(body);
  const req = request(await serverFor(target)).post("/api/payments/webhook").set("Content-Type", "application/json");
  const sig = signature === undefined ? sign(text) : signature;
  if (sig !== null) req.set("X-Payment-Signature", sig); // no cookie, no CSRF token, no Origin: a provider is not a browser
  return req.send(text);
};
const success = (extra = {}) => ({ paymentRef: REF, status: "SUCCESS", amount: 500, transactionId: UTR, ...extra });

const updates = () => Order.findOneAndUpdate.mock.calls.map(([filter, update]) => ({ filter, set: update.$set }));
const markedPaid = () => updates().some((u) => u.set && u.set.paymentStatus === "PAID");

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "info").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe("1 · Cash on Delivery is unchanged", () => {
  test("POST /api/orders with Cash on Delivery still creates an order with NO payment fields", async () => {
    const { create } = setupCart();
    const { agent } = await loginAs(app);

    const res = await agent.post("/api/orders").send({ deliveryAddress: address, paymentMethod: "Cash on Delivery" });

    expect(res.status).toBe(201);
    const doc = create.mock.calls[0][0];
    expect(doc).toMatchObject({ paymentMethod: "Cash on Delivery", orderStatus: "Pending", totalAmount: 850 });
    for (const field of ["paymentStatus", "paymentRef", "paymentExpiresAt", "paidAt", "paymentTransactionId"]) {
      expect(doc[field]).toBeUndefined();
    }
  });

  test("the normal order route cannot be used to skip payment: paymentMethod UPI there is 400, nothing is created", async () => {
    const { create } = setupCart();
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/orders").send({ deliveryAddress: address, paymentMethod: "UPI" });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  test("methods: COD is always available; UPI only when UPI_ID is configured", async () => {
    const withUpi = (await (await loginAs(app)).agent.get("/api/payments/methods")).body.data.methods;
    expect(withUpi).toEqual([
      { id: "Cash on Delivery", label: "Cash on Delivery", available: true },
      { id: "UPI", label: "Online UPI QR Payment", available: true },
    ]);
    const without = (await (await loginAs(appWithoutUpi)).agent.get("/api/payments/methods")).body.data.methods;
    expect(without.find((m) => m.id === "UPI").available).toBe(false);
    expect(without.find((m) => m.id === "Cash on Delivery").available).toBe(true);
  });
});

describe("2 · the QR amount equals the server-calculated total", () => {
  test("live prices are used (3×250 + 1×100), the link and the QR carry 850.00, the order stores 850", async () => {
    const { create } = setupCart();
    const toDataUrl = jest.spyOn(QRCode, "toDataURL");
    const { agent } = await loginAs(app);

    const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address });

    expect(res.status).toBe(201);
    const p = res.body.data;
    expect(p.amount).toBe(850);
    expect(p.upiUri).toMatch(/^upi:\/\/pay\?pa=shop@okicici&pn=FoodieHub%20Test&am=850\.00&cu=INR&/);
    expect(p.upiUri).toContain(`tr=${p.paymentRef}`);
    expect(p.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(toDataUrl.mock.calls[0][0]).toBe(p.upiUri); // the picture encodes exactly this link
    expect(p.payee).toEqual({ name: "FoodieHub Test", upiId: "shop@okicici" });

    const doc = create.mock.calls[0][0];
    expect(doc).toMatchObject({ paymentMethod: "UPI", paymentStatus: "PENDING", orderStatus: "Pending", totalAmount: 850 });
    expect(doc.paymentRef).toMatch(/^FH[0-9A-F]{16}$/);
    expect(doc.paymentRef).toBe(p.paymentRef);
    const minutes = (doc.paymentExpiresAt.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14.5);
    expect(minutes).toBeLessThanOrEqual(15);
    expect(p.items).toEqual([
      { name: "Biryani", quantity: 3, price: 250 },
      { name: "Lassi", quantity: 1, price: 100 },
    ]);
  });
});

describe("3 · an amount sent by the browser is ignored", () => {
  test.each([[{ amount: 1 }], [{ totalAmount: 1 }], [{ amount: -5, total: 0, price: 0.01, paymentStatus: "PAID", paymentRef: "FHFFFFFFFFFFFFFFFF" }]])(
    "extra body fields %p change nothing",
    async (tamper) => {
      const { create } = setupCart();
      const { agent } = await loginAs(app);

      const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address, paymentMethod: "Cash on Delivery", ...tamper });

      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe(850);
      expect(res.body.data.upiUri).toContain("am=850.00");
      const doc = create.mock.calls[0][0];
      expect(doc).toMatchObject({ paymentMethod: "UPI", paymentStatus: "PENDING", totalAmount: 850 });
      expect(doc.paymentRef).not.toBe("FHFFFFFFFFFFFFFFFF"); // a client cannot pick its own reference or status
    }
  );
});

describe("3b · the payee can never be chosen by the browser", () => {
  test("upiId / pa / payee / payeeName in the request body are ignored: the QR always pays the configured merchant", async () => {
    setupCart();
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/payments/upi").send({
      deliveryAddress: address, upiId: "attacker@bank", pa: "attacker@bank", payee: { upiId: "attacker@bank", name: "Evil" }, payeeName: "Evil", pn: "Evil", tr: "FHFFFFFFFFFFFFFFFF",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.upiUri).toContain("pa=shop@okicici&pn=FoodieHub%20Test&");
    expect(res.body.data.upiUri).not.toMatch(/attacker|Evil|FHFFFF/);
    expect(res.body.data.payee).toEqual({ name: "FoodieHub Test", upiId: "shop@okicici" });
  });
});

describe("4 · authentication and validation", () => {
  test("without a login: 401 for every payment route, and no order or cart is touched", async () => {
    const { claim, create } = setupCart();
    const anon = request(await serverFor(app));
    expect((await anon.get("/api/payments/methods")).status).toBe(401);
    expect((await anon.get(`/api/payments/${newId()}`)).status).toBe(401);
    const visitor = await newAgent(app); // has a valid CSRF token, but is not logged in
    expect((await visitor.post("/api/payments/upi").send({ deliveryAddress: address })).status).toBe(401);
    expect((await anon.post("/api/payments/upi").send({ deliveryAddress: address })).status).toBe(403); // no cookie / token at all: stopped by CSRF first
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("POST /api/payments/upi needs the CSRF token like every other write", async () => {
    const { create } = setupCart();
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/payments/upi").set("X-CSRF-Token", "wrong").send({ deliveryAddress: address });
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  test("a missing / invalid delivery address is 400", async () => {
    const { create } = setupCart();
    const { agent } = await loginAs(app);
    expect((await agent.post("/api/payments/upi").send({})).status).toBe(400);
    expect((await agent.post("/api/payments/upi").send({ deliveryAddress: { ...address, pincode: "12" } })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  test("a malformed order id is 400 before anything runs", async () => {
    const { agent } = await loginAs(app);
    expect((await agent.get("/api/payments/not-an-id")).status).toBe(400);
  });

  test("UPI not configured → 503 and the cart is not touched (customers are told to use Cash on Delivery)", async () => {
    const { claim, create } = setupCart();
    const { agent } = await loginAs(appWithoutUpi);
    const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/Cash on Delivery/);
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("5 · generating a QR never marks anything paid", () => {
  test("a new UPI order is PENDING with no paidAt / transaction id, and nothing is updated to PAID", async () => {
    const { create } = setupCart();
    const update = jest.spyOn(Order, "findOneAndUpdate");
    const { agent } = await loginAs(app);

    const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address });

    expect(res.body.data.paymentStatus).toBe("PENDING");
    const doc = create.mock.calls[0][0];
    expect(doc.paidAt).toBeUndefined();
    expect(doc.paymentTransactionId).toBeUndefined();
    expect(doc.paymentVerifiedBy).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  test("polling the status (what the page does every 5 s) never changes a pending payment", async () => {
    const order = upiOrder();
    jest.spyOn(Order, "findById").mockReturnValue(query(order));
    const update = jest.spyOn(Order, "findOneAndUpdate");
    const { agent } = await loginAs(app, { id: String(order.user) });

    for (let i = 0; i < 3; i++) {
      const res = await agent.get(`/api/payments/${order._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatus).toBe("PENDING");
    }
    expect(update).not.toHaveBeenCalled();
  });
});

describe("6 · an unverified payment can never mark an order paid", () => {
  const spies = () => {
    jest.spyOn(Order, "findOne").mockReturnValue(query(upiOrder()));
    return jest.spyOn(Order, "findOneAndUpdate");
  };

  test("webhook: no signature, wrong signature, signature of another body, wrong secret → 401, nothing changes", async () => {
    const update = spies();
    const body = success();
    const raw = JSON.stringify(body);

    expect((await webhook(body, { signature: null })).status).toBe(401);
    expect((await webhook(body, { signature: "deadbeef" })).status).toBe(401);
    expect((await webhook(body, { signature: sign(JSON.stringify(success({ amount: 1 }))) })).status).toBe(401); // signed a different amount
    expect((await webhook(body, { signature: sign(raw, "another-secret-another-secret-123456") })).status).toBe(401);
    expect((await webhook(body, { signature: sign(raw).slice(0, -2) })).status).toBe(401); // truncated
    expect(update).not.toHaveBeenCalled();
  });

  test("webhook: a body edited after signing (amount lowered) is rejected", async () => {
    const update = spies();
    const signed = JSON.stringify(success({ amount: 500 }));
    const res = await webhook(null, { raw: signed.replace("500", "400"), signature: sign(signed) });
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  test("webhook: a non-JSON body is never trusted (no raw body → no valid signature)", async () => {
    const update = spies();
    const text = "paymentRef=" + REF + "&status=SUCCESS";
    const req = request(await serverFor(app)).post("/api/payments/webhook").set("Content-Type", "application/x-www-form-urlencoded").set("X-Payment-Signature", sign(text));
    expect((await req.send(text)).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  test("webhook: when PAYMENT_WEBHOOK_SECRET is not set the endpoint is OFF (503), even for a 'correct' signature of the empty secret", async () => {
    const update = spies();
    const raw = JSON.stringify(success());
    expect((await webhook(null, { raw, signature: sign(raw, ""), target: appWithoutUpi })).status).toBe(503);
    expect(update).not.toHaveBeenCalled();
  });

  test("a logged-in customer cannot confirm payments (admin only), and cannot fake it by hitting the payment routes", async () => {
    const update = spies();
    const { agent } = await loginAs(app);
    const id = newId();
    expect((await agent.put(`/api/admin/orders/${id}/payment`).send({ status: "PAID", transactionId: UTR })).status).toBe(403);
    expect((await agent.put(`/api/payments/${id}`).send({ status: "PAID" })).status).toBe(404); // there is no such write route
    expect((await agent.post(`/api/payments/${id}`).send({ paymentStatus: "PAID" })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  test("a customer cannot read someone else's payment (403)", async () => {
    const order = upiOrder();
    jest.spyOn(Order, "findById").mockReturnValue(query(order));
    const { agent } = await loginAs(app);
    const res = await agent.get(`/api/payments/${order._id}`);
    expect(res.status).toBe(403);
    expect(res.body.data).toBeFalsy();
  });
});

describe("7 · a verified payment updates exactly the right order", () => {
  test("signed webhook SUCCESS: atomic update for THAT order id, only from a payable state, with the transaction id; no CSRF token needed", async () => {
    const order = upiOrder();
    jest.spyOn(Order, "findOne").mockReturnValue(query(order));
    const update = jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, paymentStatus: "PAID", paymentTransactionId: UTR }));

    const res = await webhook(success());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ orderId: String(order._id), paymentStatus: "PAID", duplicate: false });
    expect(Order.findOne).toHaveBeenCalledWith({ paymentRef: REF });
    const [{ filter, set }] = updates();
    expect(filter).toEqual({ _id: order._id, paymentMethod: "UPI", paymentStatus: { $in: ["PENDING", "EXPIRED", "CANCELLED"] } });
    expect(set).toMatchObject({ paymentStatus: "PAID", paymentTransactionId: UTR, paymentVerifiedBy: "webhook" });
    expect(set.paidAt).toBeInstanceOf(Date);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("the paid amount must equal the order total in paise: 499.99, 500.01, 5000 and 50 are all refused (400) and nothing is saved", async () => {
    jest.spyOn(Order, "findOne").mockReturnValue(query(upiOrder()));
    const update = jest.spyOn(Order, "findOneAndUpdate");
    for (const amount of [499.99, 500.01, 5000, 50]) {
      const res = await webhook(success({ amount }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/does not match/);
    }
    expect(update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("malformed notifications are 400: bad reference, bad status, missing / bad amount, bad transaction id", async () => {
    jest.spyOn(Order, "findOne").mockReturnValue(query(upiOrder()));
    const update = jest.spyOn(Order, "findOneAndUpdate");
    const bad = [
      success({ paymentRef: "nope" }),
      success({ paymentRef: undefined }),
      success({ status: "PENDING" }),
      success({ status: "success" }),
      success({ amount: undefined }),
      success({ amount: "500" }),
      success({ amount: -500 }),
      success({ amount: 500.001 }),
      success({ transactionId: undefined }),
      success({ transactionId: "a b" }),
    ];
    for (const body of bad) expect((await webhook(body)).status).toBe(400);
    expect((await webhook(null, { raw: JSON.stringify([success()]) })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  test("an unknown reference is 404 and nothing is created", async () => {
    jest.spyOn(Order, "findOne").mockReturnValue(query(null));
    const update = jest.spyOn(Order, "findOneAndUpdate");
    expect((await webhook(success())).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  test("a Cash on Delivery order can never be 'paid online' (409)", async () => {
    jest.spyOn(Order, "findOne").mockReturnValue(query(upiOrder({ paymentMethod: "Cash on Delivery", paymentRef: undefined })));
    const update = jest.spyOn(Order, "findOneAndUpdate");
    expect((await webhook(success())).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  describe("admin confirmation (no webhook): PUT /api/admin/orders/:id/payment", () => {
    test("PAID with the bank reference → atomic update, verified by 'admin'", async () => {
      const order = upiOrder();
      jest.spyOn(Order, "findOne").mockReturnValue(query(order));
      jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, paymentStatus: "PAID" }));
      const { agent } = await loginAs(app, { role: "admin" });

      const res = await agent.put(`/api/admin/orders/${order._id}/payment`).send({ status: "PAID", transactionId: ` ${UTR} ` });

      expect(res.status).toBe(200);
      expect(Order.findOne).toHaveBeenCalledWith({ _id: String(order._id) });
      const [{ filter, set }] = updates();
      expect(filter._id).toBe(order._id);
      expect(set).toMatchObject({ paymentStatus: "PAID", paymentTransactionId: UTR, paymentVerifiedBy: "admin" });
    });

    test("PAID without a bank reference, a bad status, or a bad reference → 400, nothing changes", async () => {
      const update = jest.spyOn(Order, "findOneAndUpdate");
      const { agent } = await loginAs(app, { role: "admin" });
      const url = `/api/admin/orders/${newId()}/payment`;
      expect((await agent.put(url).send({ status: "PAID" })).status).toBe(400);
      expect((await agent.put(url).send({ status: "PAID", transactionId: "" })).status).toBe(400);
      expect((await agent.put(url).send({ status: "PAID", transactionId: "x y" })).status).toBe(400);
      expect((await agent.put(url).send({ status: "PAID", transactionId: ["a".repeat(8)] })).status).toBe(400);
      expect((await agent.put(url).send({ status: "REFUNDED", transactionId: UTR })).status).toBe(400);
      expect(update).not.toHaveBeenCalled();
    });

    test("an admin cannot type an amount: any 'amount' in the body is not used (the order's own total is)", async () => {
      const order = upiOrder();
      jest.spyOn(Order, "findOne").mockReturnValue(query(order));
      jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, paymentStatus: "PAID" }));
      const { agent } = await loginAs(app, { role: "admin" });
      const res = await agent.put(`/api/admin/orders/${order._id}/payment`).send({ status: "PAID", transactionId: UTR, amount: 1 });
      expect(res.status).toBe(200);
      expect(updates()[0].set.paymentStatus).toBe("PAID");
    });

    test("a payment that arrives AFTER the order was cancelled/expired is recorded, but the order stays Cancelled and a refund warning is logged", async () => {
      const order = upiOrder({ paymentStatus: "EXPIRED", orderStatus: "Cancelled" });
      jest.spyOn(Order, "findOne").mockReturnValue(query(order));
      jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, paymentStatus: "PAID" }));
      const { agent } = await loginAs(app, { role: "admin" });

      const res = await agent.put(`/api/admin/orders/${order._id}/payment`).send({ status: "PAID", transactionId: UTR });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/refund/i);
      expect(res.body.data.orderStatus).toBe("Cancelled");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/manual refund required/));
    });
  });
});

describe("8 · failed, cancelled, repeated and duplicate notifications are safe", () => {
  test("provider says FAILED: payment FAILED + order Cancelled in ONE atomic update (only if still unpaid & Pending), cart restored", async () => {
    const order = upiOrder();
    const { restore } = setupCart();
    jest.spyOn(Order, "findOne").mockReturnValue(query(order));
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, paymentStatus: "FAILED", orderStatus: "Cancelled" }));

    const res = await webhook({ paymentRef: REF, status: "FAILED" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ paymentStatus: "FAILED", duplicate: false });
    const [{ filter, set }] = updates();
    expect(filter).toEqual({ _id: order._id, paymentMethod: "UPI", paymentStatus: "PENDING", orderStatus: "Pending" });
    expect(set).toEqual({ paymentStatus: "FAILED", orderStatus: "Cancelled" });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0][0]).toMatchObject({ user: order.user, items: [{ quantity: 2, price: 250 }] });
  });

  test("FAILED for an order that is already PAID is refused (409): money that arrived is never undone by a notice", async () => {
    const order = upiOrder();
    const paid = { ...order, paymentStatus: "PAID", paymentTransactionId: UTR };
    jest.spyOn(Order, "findOne").mockReturnValue(query(order));
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query(null)); // the filter no longer matches
    jest.spyOn(Order, "findById").mockReturnValue(query(paid));
    const res = await webhook({ paymentRef: REF, status: "FAILED" });
    expect(res.status).toBe(409);
    expect(updates().every((u) => u.set.paymentStatus !== "PAID")).toBe(true);
  });

  test("the same FAILED notice twice: the second is 200 duplicate, nothing else happens (no second cart restore)", async () => {
    const order = upiOrder({ paymentStatus: "FAILED", orderStatus: "Cancelled" });
    const { restore } = setupCart();
    jest.spyOn(Order, "findOne").mockReturnValue(query(order));
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query(null));
    jest.spyOn(Order, "findById").mockReturnValue(query(order));
    const res = await webhook({ paymentRef: REF, status: "FAILED" });
    expect(res.status).toBe(200);
    expect(res.body.data.duplicate).toBe(true);
    expect(restore).not.toHaveBeenCalled();
  });

  test("the same SUCCESS notice twice: first applies, the repeat is 200 duplicate:true (idempotent, provider retries are harmless)", async () => {
    const order = upiOrder();
    const paid = { ...order, paymentStatus: "PAID", paymentTransactionId: UTR };
    jest.spyOn(Order, "findOne").mockReturnValue(query(order));
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValueOnce(query(paid)).mockReturnValueOnce(query(null));
    jest.spyOn(Order, "findById").mockReturnValue(query(paid));

    const first = await webhook(success());
    const second = await webhook(success());

    expect(first.body.data.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ orderId: String(order._id), paymentStatus: "PAID", duplicate: true });
  });

  test("a DIFFERENT transaction id for an already-paid order is 409 and nothing is overwritten", async () => {
    const order = upiOrder();
    const paid = { ...order, paymentStatus: "PAID", paymentTransactionId: UTR };
    jest.spyOn(Order, "findOne").mockReturnValue(query(order));
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query(null));
    jest.spyOn(Order, "findById").mockReturnValue(query(paid));
    const res = await webhook(success({ transactionId: "UTR999999999999" }));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/different transaction/);
  });

  test("one transaction id cannot pay a second order: a unique-index violation (11000) is 409", async () => {
    jest.spyOn(Order, "findOne").mockReturnValue(query(upiOrder()));
    jest.spyOn(Order, "findOneAndUpdate").mockImplementation(() => {
      throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    });
    const res = await webhook(success());
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already used/);
  });

  test("SUCCESS for a payment already closed as FAILED is 409 (it cannot be reopened silently)", async () => {
    const order = upiOrder({ paymentStatus: "FAILED", orderStatus: "Cancelled" });
    jest.spyOn(Order, "findOne").mockReturnValue(query(order));
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query(null));
    jest.spyOn(Order, "findById").mockReturnValue(query(order));
    expect((await webhook(success())).status).toBe(409);
  });

  describe("customer cancels", () => {
    test("an UNPAID UPI order: cancelled with payment CANCELLED (expected state in the filter) and the cart restored", async () => {
      const order = upiOrder();
      const { restore } = setupCart();
      const { agent, userId } = await loginAs(app, { id: String(order.user) });
      jest.spyOn(Order, "findById").mockReturnValue(query(order));
      jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, paymentStatus: "CANCELLED", orderStatus: "Cancelled" }));

      const res = await agent.put(`/api/orders/${order._id}/cancel`);

      expect(userId).toBe(String(order.user));
      expect(res.status).toBe(200);
      const [{ filter, set }] = updates();
      expect(filter).toEqual({ _id: String(order._id), user: String(order.user), orderStatus: "Pending", paymentStatus: "PENDING" });
      expect(set).toEqual({ orderStatus: "Cancelled", paymentStatus: "CANCELLED" });
      expect(restore).toHaveBeenCalledTimes(1);
    });

    test("a PAID UPI order cannot be cancelled by the customer: 409 with a refund message, nothing changes", async () => {
      const order = upiOrder({ paymentStatus: "PAID", paymentTransactionId: UTR });
      const { restore } = setupCart();
      const { agent } = await loginAs(app, { id: String(order.user) });
      jest.spyOn(Order, "findById").mockReturnValue(query(order));
      const update = jest.spyOn(Order, "findOneAndUpdate");

      const res = await agent.put(`/api/orders/${order._id}/cancel`);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already paid online.*refund/i);
      expect(update).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
    });

    test("Cash on Delivery cancel is exactly as before (no payment fields in the filter or update, no cart restore)", async () => {
      const order = upiOrder({ paymentMethod: "Cash on Delivery", paymentStatus: undefined, paymentRef: undefined });
      const { restore } = setupCart();
      const { agent } = await loginAs(app, { id: String(order.user) });
      jest.spyOn(Order, "findById").mockReturnValue(query(order));
      jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, orderStatus: "Cancelled" }));
      const res = await agent.put(`/api/orders/${order._id}/cancel`);
      expect(res.status).toBe(200);
      expect(updates()[0].filter).toEqual({ _id: String(order._id), user: String(order.user), orderStatus: "Pending" });
      expect(updates()[0].set).toEqual({ orderStatus: "Cancelled" });
      expect(restore).not.toHaveBeenCalled();
    });
  });

  describe("expiry", () => {
    test("opening the payment after its window closed expires it atomically, restores the cart and returns NO qr code", async () => {
      const order = upiOrder({ paymentExpiresAt: new Date(Date.now() - 1000) });
      const { restore } = setupCart();
      jest.spyOn(Order, "findById").mockReturnValue(query(order));
      jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, paymentStatus: "EXPIRED", orderStatus: "Cancelled" }));
      const { agent } = await loginAs(app, { id: String(order.user) });

      const res = await agent.get(`/api/payments/${order._id}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ paymentStatus: "EXPIRED", orderStatus: "Cancelled" });
      expect(res.body.data.qrDataUrl).toBeUndefined();
      expect(res.body.data.upiUri).toBeUndefined();
      const [{ filter, set }] = updates();
      expect(filter).toMatchObject({ _id: order._id, paymentStatus: "PENDING", orderStatus: "Pending" });
      expect(filter.paymentExpiresAt.$lte).toBeInstanceOf(Date);
      expect(set).toEqual({ paymentStatus: "EXPIRED", orderStatus: "Cancelled" });
      expect(restore).toHaveBeenCalledTimes(1);
    });

    test("a still-valid pending payment keeps its QR; a PAID one shows no QR", async () => {
      const pending = upiOrder();
      const paid = upiOrder({ paymentStatus: "PAID" });
      const { agent } = await loginAs(app, { id: String(pending.user) });
      jest.spyOn(Order, "findById").mockReturnValueOnce(query(pending));
      const first = await agent.get(`/api/payments/${pending._id}`);
      expect(first.body.data.qrDataUrl).toMatch(/^data:image\/png/);
      expect(first.body.data.upiUri).toContain("am=500.00");

      jest.spyOn(Order, "findById").mockReturnValueOnce(query({ ...paid, user: pending.user }));
      const second = await agent.get(`/api/payments/${paid._id}`);
      expect(second.body.data.paymentStatus).toBe("PAID");
      expect(second.body.data.qrDataUrl).toBeUndefined();
    });

    test("the background job closes every due payment (and only those whose time is up)", async () => {
      const a = upiOrder();
      const b = upiOrder();
      setupCart();
      jest.spyOn(Order, "find").mockReturnValue(query([{ _id: a._id }, { _id: b._id }]));
      jest.spyOn(Order, "findOneAndUpdate").mockReturnValueOnce(query({ ...a, paymentStatus: "EXPIRED" })).mockReturnValueOnce(query(null)); // b was paid a moment ago

      expect(await expireStalePayments()).toBe(1);
      const finder = Order.find.mock.calls[0][0];
      expect(finder).toMatchObject({ paymentMethod: "UPI", paymentStatus: "PENDING" });
      expect(finder.paymentExpiresAt.$lte).toBeInstanceOf(Date);
    });
  });
});

describe("9 · empty cart and unavailable items", () => {
  test("empty cart → 400, no order, no QR", async () => {
    jest.spyOn(Cart, "findOne").mockResolvedValue({ _id: newId(), items: [] });
    const create = jest.spyOn(Order, "create");
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/empty/i);
    expect(res.body.data?.qrDataUrl).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  test("no cart at all → 400", async () => {
    jest.spyOn(Cart, "findOne").mockResolvedValue(null);
    const create = jest.spyOn(Order, "create");
    const { agent } = await loginAs(app);
    expect((await agent.post("/api/payments/upi").send({ deliveryAddress: address })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  test("an unavailable item → 400 naming it; the cart is not claimed and no order exists", async () => {
    const { claim, create } = setupCart({
      foods: [
        { _id: "a".repeat(24), name: "Sold-out Biryani", price: 250, available: false },
        { _id: "b".repeat(24), name: "Lassi", price: 100, available: true },
      ],
    });
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Sold-out Biryani");
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("a deleted food → 409, no order", async () => {
    const { create } = setupCart({ foods: [{ _id: "b".repeat(24), name: "Lassi", price: 100, available: true }] });
    const { agent } = await loginAs(app);
    expect((await agent.post("/api/payments/upi").send({ deliveryAddress: address })).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  test("a second 'Pay' click that loses the cart race gets 409: only one order and one QR can exist", async () => {
    const { create } = setupCart({ claimed: false });
    const { agent } = await loginAs(app);
    expect((await agent.post("/api/payments/upi").send({ deliveryAddress: address })).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  test("a ₹0 order cannot be paid by UPI: it is undone, the cart restored, and the customer is told to use COD", async () => {
    const { restore } = setupCart({
      foods: [
        { _id: "a".repeat(24), name: "Free sample", price: 0, available: true },
        { _id: "b".repeat(24), name: "Free water", price: 0, available: true },
      ],
    });
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ _id: newId(), user: newId(), items: [{ food: ID("a".repeat(24)), quantity: 1, price: 0 }] }));
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cash on Delivery/);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});

describe("order lifecycle and dashboard respect payments", () => {
  test("admin cannot Confirm / Prepare / Deliver an UNPAID UPI order (409); Cancel is allowed and closes the payment", async () => {
    const order = upiOrder();
    const { restore } = setupCart();
    jest.spyOn(Order, "findById").mockReturnValue(query(order));
    const update = jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, orderStatus: "Cancelled", paymentStatus: "CANCELLED" }));
    const { agent } = await loginAs(app, { role: "admin" });

    const blocked = await agent.put(`/api/admin/orders/${order._id}/status`).send({ status: "Confirmed" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/payment is not verified/);
    expect(update).not.toHaveBeenCalled();

    const cancelled = await agent.put(`/api/admin/orders/${order._id}/status`).send({ status: "Cancelled" });
    expect(cancelled.status).toBe(200);
    expect(updates()[0].filter).toMatchObject({ orderStatus: "Pending", paymentStatus: "PENDING" });
    expect(updates()[0].set).toEqual({ orderStatus: "Cancelled", paymentStatus: "CANCELLED" });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  test("a PAID UPI order can be Confirmed, and the update itself requires paymentStatus PAID", async () => {
    const order = upiOrder({ paymentStatus: "PAID" });
    jest.spyOn(Order, "findById").mockReturnValue(query(order));
    jest.spyOn(Order, "findOneAndUpdate").mockReturnValue(query({ ...order, orderStatus: "Confirmed" }));
    const { agent } = await loginAs(app, { role: "admin" });
    const res = await agent.put(`/api/admin/orders/${order._id}/status`).send({ status: "Confirmed" });
    expect(res.status).toBe(200);
    expect(updates()[0].filter).toEqual({ _id: String(order._id), orderStatus: "Pending", paymentStatus: "PAID" });
  });

  test("dashboard money figures count a UPI order only when PAID (Cash on Delivery and old orders count as before)", async () => {
    const pipelines = [];
    jest.spyOn(Order, "aggregate").mockImplementation((pipeline) => {
      pipelines.push(pipeline);
      return Promise.resolve([]);
    });
    jest.spyOn(Order, "countDocuments").mockResolvedValue(0);
    jest.spyOn(Order, "find").mockReturnValue(query([]));
    jest.spyOn(require("../../models/User"), "countDocuments").mockResolvedValue(0);

    await getDashboardStats();

    const money = pipelines.filter((p) => p[0] && p[0].$match && p[0].$match.orderStatus);
    expect(money.length).toBe(4); // revenue, popular foods, top spenders, revenue by date
    for (const pipeline of money) {
      expect(pipeline[0].$match).toMatchObject({
        orderStatus: { $ne: "Cancelled" },
        $or: [{ paymentMethod: { $ne: "UPI" } }, { paymentStatus: "PAID" }],
      });
    }
    const counts = pipelines.find((p) => p.some((s) => s.$group && s.$group.totalOrders));
    expect(counts.some((s) => s.$match)).toBe(false); // order COUNTS still include every order
  });
});

describe("nothing leaks", () => {
  test("the webhook secret and the signature never appear in a response or a log line", async () => {
    jest.spyOn(Order, "findOne").mockReturnValue(query(upiOrder()));
    const bad = await webhook(success(), { signature: "0".repeat(64) });
    expect(JSON.stringify(bad.body)).not.toContain(SECRET);
    const logged = [...logger.warn.mock.calls, ...logger.info.mock.calls, ...logger.error.mock.calls].flat().join(" ");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("0".repeat(64));
  });

  test("the QR payload never contains an order id, a user id or the webhook secret (only payee, amount, reference)", async () => {
    setupCart();
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/payments/upi").send({ deliveryAddress: address });
    const params = [...new URLSearchParams(res.body.data.upiUri.split("?")[1]).keys()];
    expect(params).toEqual(["pa", "pn", "am", "cu", "tn", "tr"]);
    expect(res.body.data.upiUri).not.toContain(SECRET);
    expect(res.body.data.upiUri).not.toContain(res.body.data.orderId);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });
});
