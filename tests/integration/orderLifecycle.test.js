// Batch 3 against a REAL MongoDB: order lifecycle, atomic status changes, customer cancel, and the
// dashboard figures. The races here are real: concurrent HTTP requests hit one MongoDB document and
// the database itself must let exactly one of them through.

const mongoose = require("mongoose");
const app = require("../../server");
const Order = require("../../models/Order");
const emitter = require("../../utils/eventEmitter");
const logger = require("../../utils/logger"); // jest-mocked for every test file (tests/helpers/setupAfterEnv.js)
const { connectTestDb, clearTestDb, disconnectTestDb } = require("../helpers/db");
const { createUser, createFood, loginAgent, ADDRESS } = require("../helpers/factories");
const { newAgent, anonymous, cookieHeader } = require("../helpers/client");

const STATUSES = ["Pending", "Confirmed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"];
const LEGAL = {
  "Pending": ["Confirmed", "Cancelled"],
  "Confirmed": ["Preparing", "Cancelled"],
  "Preparing": ["Out for Delivery", "Cancelled"],
  "Out for Delivery": ["Delivered"],
  "Delivered": [],
  "Cancelled": [],
};
const PAIRS = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to, LEGAL[from].includes(to)]));

let admin, adminAgent, owner, ownerAgent, other, otherAgent;

// Users and logins are created once (bcrypt is slow); every test starts from an empty orders collection.
beforeAll(async () => {
  await connectTestDb();
  await clearTestDb();
  admin = await createUser({ role: "admin" });
  owner = await createUser();
  other = await createUser();
  adminAgent = await loginAgent(app, admin);
  ownerAgent = await loginAgent(app, owner);
  otherAgent = await loginAgent(app, other);
});
beforeEach(async () => {
  await Order.deleteMany({});
  jest.spyOn(emitter, "emit");
});
afterAll(async () => {
  await clearTestDb();
  await disconnectTestDb();
});

const makeOrder = (user, status, { items, totalAmount = 100 } = {}) =>
  Order.create({
    user: user._id,
    items: items || [{ food: new mongoose.Types.ObjectId(), foodName: "Biryani", quantity: 1, price: 100 }],
    totalAmount,
    deliveryAddress: ADDRESS,
    orderStatus: status,
  });

const statusOf = async (order) => (await Order.findById(order._id)).orderStatus;
const statusEvents = () => emitter.emit.mock.calls.filter(([name]) => name === "orderStatusUpdated").map(([, data]) => data);
const adminSet = (order, status, agent = adminAgent) => agent.put(`/api/admin/orders/${order._id}/status`).send({ status });
const customerCancel = (order, agent = ownerAgent) => agent.put(`/api/orders/${order._id}/cancel`);

describe("A — admin transitions, the full matrix, against the real database", () => {
  test.each(PAIRS)("%s → %s", async (from, to, legal) => {
    const order = await makeOrder(owner, from);
    const res = await adminSet(order, to);

    if (legal) {
      expect(res.status).toBe(200);
      expect(res.body.data.orderStatus).toBe(to);
      expect(await statusOf(order)).toBe(to);
      expect(statusEvents()).toEqual([{ orderId: expect.anything(), oldStatus: from, newStatus: to }]);
      expect(String(statusEvents()[0].orderId)).toBe(order.id);
    } else {
      expect(res.status).toBe(409);
      expect(await statusOf(order)).toBe(from); // unchanged in MongoDB
      expect(statusEvents()).toEqual([]);
    }
  });

  test("the whole happy path in order, then every further change is refused", async () => {
    const order = await makeOrder(owner, "Pending");
    for (const next of ["Confirmed", "Preparing", "Out for Delivery", "Delivered"]) {
      expect((await adminSet(order, next)).status).toBe(200);
    }
    for (const status of STATUSES) expect((await adminSet(order, status)).status).toBe(409);
    expect(await statusOf(order)).toBe("Delivered");
    expect(statusEvents().map((e) => `${e.oldStatus}>${e.newStatus}`)).toEqual([
      "Pending>Confirmed", "Confirmed>Preparing", "Preparing>Out for Delivery", "Out for Delivery>Delivered",
    ]);
  });

  test("the update changes ONLY the status (items, total, address, owner untouched)", async () => {
    const order = await makeOrder(owner, "Pending", { totalAmount: 250 });
    await adminSet(order, "Confirmed");
    const after = (await Order.findById(order._id)).toObject();
    expect(after.totalAmount).toBe(250);
    expect(String(after.user)).toBe(owner.id);
    expect(after.items).toHaveLength(1);
    expect(after.deliveryAddress).toMatchObject(ADDRESS);
  });

  test("existing logger behaviour is preserved: the listener logs 'ORDER STATUS UPDATED … old → new'", async () => {
    const order = await makeOrder(owner, "Pending");
    await adminSet(order, "Confirmed");
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`ORDER STATUS UPDATED — OrderID: ${order.id} | Pending → Confirmed`));
  });

  test("unknown order 404, malformed id 400, invalid status 400, customer 403", async () => {
    const order = await makeOrder(owner, "Pending");
    expect((await adminSet({ _id: new mongoose.Types.ObjectId() }, "Confirmed")).status).toBe(404);
    expect((await adminAgent.put("/api/admin/orders/nope/status").send({ status: "Confirmed" })).status).toBe(400);
    expect((await adminSet(order, "Teleported")).status).toBe(400);
    expect((await adminSet(order, "Confirmed", ownerAgent)).status).toBe(403);
    expect(await statusOf(order)).toBe("Pending");
  });
});

describe("A — real concurrency: the database lets exactly one update through", () => {
  test("10 simultaneous identical admin updates → exactly one 200 and nine 409, one event", async () => {
    const order = await makeOrder(owner, "Confirmed");
    const results = await Promise.all(Array.from({ length: 10 }, () => adminSet(order, "Preparing")));

    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(await statusOf(order)).toBe("Preparing");
    expect(statusEvents()).toEqual([{ orderId: expect.anything(), oldStatus: "Confirmed", newStatus: "Preparing" }]);
  });

  test("advance vs cancel at the same moment (repeated 8×): no lost update — the events form ONE valid chain ending at the real final status", async () => {
    // A late request may legitimately act on the winner's result (Preparing → Cancelled is legal), so
    // 1 or 2 requests can succeed. What must NEVER happen is two successes that both claim to have
    // left "Confirmed" (a lost update), or an event that disagrees with what MongoDB holds.
    for (let round = 0; round < 8; round++) {
      emitter.emit.mockClear();
      const order = await makeOrder(owner, "Confirmed");
      const targets = ["Preparing", "Cancelled", "Preparing", "Cancelled"];
      const results = await Promise.all(targets.map((t) => adminSet(order, t)));

      expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      const successes = results.filter((r) => r.status === 200).length;
      expect(successes).toBeGreaterThanOrEqual(1);

      const events = statusEvents();
      expect(events).toHaveLength(successes); // one event per success, none for failures

      const from = events.map((e) => e.oldStatus);
      expect(new Set(from).size).toBe(from.length); // no two successes left the same status
      events.forEach((e) => expect(LEGAL[e.oldStatus]).toContain(e.newStatus)); // each step legal

      const next = new Map(events.map((e) => [e.oldStatus, e.newStatus]));
      let walk = "Confirmed";
      let steps = 0;
      while (next.has(walk)) { walk = next.get(walk); steps += 1; }
      expect(steps).toBe(events.length);           // a single unbroken path from Confirmed…
      expect(await statusOf(order)).toBe(walk);    // …ending at what the database really holds
    }
  });

  test("customer cancel vs admin confirm at the same moment (repeated 8×): exactly one succeeds, never both", async () => {
    for (let round = 0; round < 8; round++) {
      emitter.emit.mockClear();
      const order = await makeOrder(owner, "Pending");
      const [cancel, confirm] = await Promise.all([customerCancel(order), adminSet(order, "Confirmed")]);

      expect([cancel.status, confirm.status].sort()).toEqual([200, 409]);
      const winner = cancel.status === 200 ? "Cancelled" : "Confirmed";
      expect(await statusOf(order)).toBe(winner);
      const events = statusEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ oldStatus: "Pending", newStatus: winner });
    }
  });

  test("customer double-click: 5 simultaneous cancels → exactly one 200, four 409, one event", async () => {
    const order = await makeOrder(owner, "Pending");
    const results = await Promise.all(Array.from({ length: 5 }, () => customerCancel(order)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await statusOf(order)).toBe("Cancelled");
    expect(statusEvents()).toHaveLength(1);
  });
});

describe("B — PUT /api/orders/:id/cancel against the real database", () => {
  test("owner cancels their Pending order: 200, status Cancelled in MongoDB, order kept intact, event + log", async () => {
    const order = await makeOrder(owner, "Pending", { totalAmount: 320 });
    const res = await customerCancel(order);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Order cancelled" });
    expect(res.body.data.orderStatus).toBe("Cancelled");
    const after = (await Order.findById(order._id)).toObject();
    expect(after.orderStatus).toBe("Cancelled");
    expect(after.totalAmount).toBe(320); // history kept, not deleted or zeroed
    expect(after.items).toHaveLength(1);
    expect(statusEvents()).toEqual([{ orderId: expect.anything(), oldStatus: "Pending", newStatus: "Cancelled" }]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`ORDER STATUS UPDATED — OrderID: ${order.id} | Pending → Cancelled`));
  });

  test.each(["Confirmed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"])("own %s order → 409, unchanged", async (status) => {
    const order = await makeOrder(owner, status);
    expect((await customerCancel(order)).status).toBe(409);
    expect(await statusOf(order)).toBe(status);
    expect(statusEvents()).toEqual([]);
  });

  test.each(["Pending", "Confirmed", "Delivered"])("another customer's %s order → 403, unchanged", async (status) => {
    const order = await makeOrder(owner, status);
    expect((await customerCancel(order, otherAgent)).status).toBe(403);
    expect(await statusOf(order)).toBe(status);
  });

  test("an admin cannot cancel a customer's order through the customer route (403)", async () => {
    const order = await makeOrder(owner, "Pending");
    expect((await customerCancel(order, adminAgent)).status).toBe(403);
    expect(await statusOf(order)).toBe("Pending");
  });

  test("unknown order 404, malformed id 400, not logged in 401", async () => {
    expect((await ownerAgent.put(`/api/orders/${new mongoose.Types.ObjectId()}/cancel`)).status).toBe(404);
    expect((await ownerAgent.put("/api/orders/nope/cancel")).status).toBe(400);
    const order = await makeOrder(owner, "Pending");
    expect((await (await newAgent(app)).put(`/api/orders/${order._id}/cancel`)).status).toBe(401);
    expect(await statusOf(order)).toBe("Pending");
  });

  test("CSRF: a forged cancel (wrong token / no token / foreign Origin) changes nothing", async () => {
    const order = await makeOrder(owner, "Pending");
    const url = `/api/orders/${order._id}/cancel`;
    const cookie = cookieHeader(ownerAgent);
    const api = await anonymous(app);

    expect((await ownerAgent.put(url).set("X-CSRF-Token", "forged")).status).toBe(403);
    expect((await api.put(url).set("Cookie", cookie)).status).toBe(403);
    expect((await api.put(url).set("Cookie", cookie).set("Origin", "https://evil.example")).status).toBe(403);
    expect(await statusOf(order)).toBe("Pending");
    expect(statusEvents()).toEqual([]);
  });

  test("a cancelled order can no longer be moved by an admin (Cancelled is final)", async () => {
    const order = await makeOrder(owner, "Pending");
    expect((await customerCancel(order)).status).toBe(200);
    for (const status of STATUSES) expect((await adminSet(order, status)).status).toBe(409);
    expect(await statusOf(order)).toBe("Cancelled");
  });

  test("the customer sees the cancelled order in their history", async () => {
    const order = await makeOrder(owner, "Pending");
    await customerCancel(order);
    const history = await ownerAgent.get("/api/orders");
    expect(history.body.data.find((o) => o._id === order.id).orderStatus).toBe("Cancelled");
  });
});

describe("C — dashboard figures ignore cancelled orders (real aggregation)", () => {
  const dashboard = async () => (await adminAgent.get("/api/admin/dashboard")).body.data;

  test("revenue, average, popular foods, top spenders and revenue-by-date exclude Cancelled; counts include them", async () => {
    const popular = await createFood({ name: "Popular Dosa" });
    const cancelledOnly = await createFood({ name: "Never Delivered Pizza" });
    const line = (food, quantity, price) => ({ food: food._id, foodName: food.name, quantity, price });

    await makeOrder(owner, "Delivered", { items: [line(popular, 5, 100)], totalAmount: 500 });
    await makeOrder(owner, "Pending", { items: [line(popular, 3, 100)], totalAmount: 300 });
    await makeOrder(owner, "Cancelled", { items: [line(cancelledOnly, 10, 100)], totalAmount: 1000 });
    await makeOrder(other, "Cancelled", { items: [line(cancelledOnly, 7, 100)], totalAmount: 700 }); // spends nothing in total

    const stats = await dashboard();

    expect(stats.summary.totalOrders).toBe(4); // every order is still counted
    expect(stats.summary.totalRevenue).toBe(800); // 500 + 300, not 2500
    expect(stats.summary.avgOrderValue).toBe(400);
    expect(stats.summary.pendingOrders).toBe(1);

    const byStatus = Object.fromEntries(stats.ordersByStatus.map((s) => [s._id, s.count]));
    expect(byStatus).toEqual({ Delivered: 1, Pending: 1, Cancelled: 2 });

    expect(stats.popularFoods.map((f) => f.foodName)).toEqual(["Popular Dosa"]); // pizza was never cooked
    expect(stats.popularFoods[0]).toMatchObject({ totalOrdered: 8, totalRevenue: 800 });

    expect(stats.topSpenders).toHaveLength(1); // `other` only has a cancelled order
    expect(stats.topSpenders[0]).toMatchObject({ email: owner.email, totalSpent: 800, orderCount: 2 });

    expect(stats.revenueByDate.reduce((sum, d) => sum + d.revenue, 0)).toBe(800);
  });

  test("end to end: cancelling a Pending order immediately lowers revenue; an illegal change does not", async () => {
    const pending = await makeOrder(owner, "Pending", { totalAmount: 300 });
    const delivered = await makeOrder(owner, "Delivered", { totalAmount: 500 });
    expect((await dashboard()).summary.totalRevenue).toBe(800);

    expect((await adminSet(delivered, "Cancelled")).status).toBe(409); // refused → nothing changes
    expect((await dashboard()).summary.totalRevenue).toBe(800);

    expect((await customerCancel(pending)).status).toBe(200);
    const after = await dashboard();
    expect(after.summary.totalRevenue).toBe(500);
    expect(after.summary.totalOrders).toBe(2);
  });

  test("no orders at all → zeros", async () => {
    const stats = await dashboard();
    expect(stats.summary).toMatchObject({ totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 });
    expect(stats.topSpenders).toEqual([]);
  });
});
