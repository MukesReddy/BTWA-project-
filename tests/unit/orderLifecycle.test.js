// Batch 3 — order lifecycle integrity (DB-free: Order is mocked).
//   A  admin status changes follow the lifecycle; the update is atomic (expected status in the filter)
//   B  customer self-cancel: owner only, Pending only, CSRF-protected
//   C  dashboard money figures ignore cancelled orders
// What this proves: WHICH rules the code applies and WHICH query it sends. That MongoDB really applies
// exactly one of two racing updates is proven in tests/integration/orderLifecycle.test.js.

const app = require("../../server");
const Order = require("../../models/Order");
const User = require("../../models/User");
const emitter = require("../../utils/eventEmitter");
const { isCustomer } = require("../../middleware/adminMiddleware");
const constants = require("../../utils/constants");
const { getDashboardStats } = require("../../services/analyticsService");
const { query } = require("../helpers/chain");
const { loginAs, newId } = require("../helpers/auth");
const { newAgent, anonymous, cookieHeader } = require("../helpers/client");

// The lifecycle, written out independently of the code under test.
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

const ID = (hex) => ({ toString: () => hex });

/**
 * A one-order "database". findById reads; findOneAndUpdate checks the filter and writes in ONE
 * synchronous step, which is the guarantee MongoDB gives for a single document.
 */
const installOrder = ({ status, owner = newId(), id = newId(), gate = null }) => {
  const state = { id, owner, status, deleted: false, updates: [] };
  const read = () => (state.deleted ? null : { _id: ID(id), user: owner === null ? null : ID(owner), orderStatus: state.status });
  jest.spyOn(Order, "findById").mockImplementation(() => query(gate ? gate().then(read) : read()));
  jest.spyOn(Order, "findOneAndUpdate").mockImplementation((filter, update, options) => {
    state.updates.push({ filter, update, options });
    const ownerOk = filter.user === undefined || (owner !== null && String(filter.user) === owner);
    if (state.deleted || filter.orderStatus !== state.status || !ownerOk) return query(null);
    state.status = update.$set.orderStatus;
    return query({ _id: ID(id), user: { _id: ID(owner), name: "N", email: "n@example.com" }, orderStatus: state.status });
  });
  return state;
};

const statusEvents = () => emitter.emit.mock.calls.filter(([name]) => name === "orderStatusUpdated").map(([, data]) => data);

beforeEach(() => {
  jest.spyOn(emitter, "emit"); // calls through to the real listeners (logger is mocked globally)
});

describe("constants: the lifecycle table", () => {
  test("matches the specified lifecycle exactly, covers every status, and cannot be modified", () => {
    expect(constants.ORDER_TRANSITIONS).toEqual(LEGAL);
    expect(Object.keys(constants.ORDER_TRANSITIONS).sort()).toEqual([...constants.ORDER_STATUSES].sort());
    for (const targets of Object.values(constants.ORDER_TRANSITIONS)) targets.forEach((t) => expect(STATUSES).toContain(t));
    expect(Object.isFrozen(constants.ORDER_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(constants.ORDER_TRANSITIONS.Pending)).toBe(true);
    expect(constants.CUSTOMER_CANCEL_FROM).toEqual(["Pending"]);
  });
});

describe("A — PUT /api/admin/orders/:id/status: the full 6 × 6 transition matrix", () => {
  test.each(PAIRS)("%s → %s", async (from, to, legal) => {
    const { agent } = await loginAs(app, { role: "admin" });
    const order = installOrder({ status: from });

    const res = await agent.put(`/api/admin/orders/${order.id}/status`).send({ status: to });

    if (legal) {
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: `Order status updated to ${to}` });
      expect(res.body.data.orderStatus).toBe(to);
      // atomic: the status we read is part of the filter, and only the status is written
      expect(Order.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(order.updates[0].filter).toEqual({ _id: order.id, orderStatus: from });
      expect(order.updates[0].update).toEqual({ $set: { orderStatus: to } });
      expect(statusEvents()).toEqual([{ orderId: expect.anything(), oldStatus: from, newStatus: to }]);
      expect(order.status).toBe(to);
    } else {
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain(`"${from}"`);
      expect(res.body.message).toContain(`"${to}"`);
      expect(Order.findOneAndUpdate).not.toHaveBeenCalled(); // nothing written
      expect(statusEvents()).toEqual([]);                    // nothing announced
      expect(order.status).toBe(from);
    }
  });

  // The cases called out in the requirements, listed explicitly (they are also part of the matrix above).
  test.each([
    ["Out for Delivery", "Cancelled"],
    ["Delivered", "Cancelled"],
    ["Cancelled", "Pending"],
    ["Cancelled", "Confirmed"],
    ["Delivered", "Pending"],
    ["Pending", "Delivered"],
    ["Pending", "Preparing"],
  ])("%s → %s is refused with 409", async (from, to) => {
    const { agent } = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: from });
    expect((await agent.put(`/api/admin/orders/${o.id}/status`).send({ status: to })).status).toBe(409);
  });

  test.each([["Pending"], ["Confirmed"], ["Preparing"]])("%s → Cancelled is allowed", async (from) => {
    const { agent } = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: from });
    expect((await agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Cancelled" })).status).toBe(200);
  });

  test("invalid / missing / non-string status → 400, no database access", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Pending" });
    for (const body of [{}, { status: "Teleported" }, { status: ["Confirmed"] }, { status: { $ne: "x" } }, { status: "" }]) {
      expect((await agent.put(`/api/admin/orders/${o.id}/status`).send(body)).status).toBe(400);
    }
    expect(Order.findById).not.toHaveBeenCalled();
  });

  test("unknown order → 404; malformed id → 400; customer → 403", async () => {
    const admin = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Pending" });
    o.deleted = true;
    expect((await admin.agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Confirmed" })).status).toBe(404);
    expect((await admin.agent.put("/api/admin/orders/not-an-id/status").send({ status: "Confirmed" })).status).toBe(400);
    const customer = await loginAs(app, { role: "customer" });
    expect((await customer.agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Confirmed" })).status).toBe(403);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("the event is emitted only AFTER the update succeeded", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Confirmed" });
    await agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Preparing" });
    const updateOrder = Order.findOneAndUpdate.mock.invocationCallOrder[0];
    const emitOrder = emitter.emit.mock.invocationCallOrder[emitter.emit.mock.calls.findIndex(([n]) => n === "orderStatusUpdated")];
    expect(emitOrder).toBeGreaterThan(updateOrder);
  });
});

describe("A — concurrency (single-document atomic update simulated; real MongoDB: integration suite)", () => {
  // Both requests read the order BEFORE either writes: the worst case for a read-then-write design.
  const bothReadFirst = () => {
    let reads = 0;
    let release;
    const opened = new Promise((resolve) => (release = resolve));
    return () => {
      if (++reads === 2) release();
      return opened;
    };
  };

  test("two admins make the SAME change at once → exactly one 200, one 409, one event", async () => {
    const one = await loginAs(app, { role: "admin" });
    const two = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Confirmed", gate: bothReadFirst() });

    const results = await Promise.all([
      one.agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Preparing" }),
      two.agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Preparing" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.message).toMatch(/changed by someone else/i);
    expect(loser.body.message).toContain('"Preparing"'); // tells the admin what it is now
    expect(o.status).toBe("Preparing");
    expect(statusEvents()).toEqual([{ orderId: expect.anything(), oldStatus: "Confirmed", newStatus: "Preparing" }]);
  });

  test("two admins make DIFFERENT changes at once (advance vs cancel) → exactly one wins", async () => {
    const one = await loginAs(app, { role: "admin" });
    const two = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Confirmed", gate: bothReadFirst() });

    const results = await Promise.all([
      one.agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Preparing" }),
      two.agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Cancelled" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const events = statusEvents();
    expect(events).toHaveLength(1);
    expect(events[0].oldStatus).toBe("Confirmed"); // the actual status transitioned from
    expect(events[0].newStatus).toBe(o.status);
  });

  test("the update loses the race → 409 naming the current status, and NO event", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Pending" });
    // someone else moves the order between our read and our update
    Order.findOneAndUpdate.mockImplementationOnce(() => {
      o.status = "Confirmed";
      return query(null);
    });
    const res = await agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Confirmed" });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('"Confirmed"');
    expect(statusEvents()).toEqual([]);
  });

  test("the order is deleted between read and update → 404, no event", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Pending" });
    Order.findOneAndUpdate.mockImplementationOnce(() => {
      o.deleted = true;
      return query(null);
    });
    expect((await agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Confirmed" })).status).toBe(404);
    expect(statusEvents()).toEqual([]);
  });

  test("an unexpected database error is a 500 (no event, nothing swallowed)", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const o = installOrder({ status: "Pending" });
    Order.findOneAndUpdate.mockImplementationOnce(() => { throw new Error("db down"); });
    expect((await agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Confirmed" })).status).toBe(500);
    expect(statusEvents()).toEqual([]);
  });
});

describe("B — PUT /api/orders/:id/cancel (customer self-cancel)", () => {
  test("owner cancels their Pending order → 200, atomic filter includes owner + Pending, event Pending → Cancelled", async () => {
    const me = await loginAs(app, { role: "customer" });
    const o = installOrder({ status: "Pending", owner: me.userId });

    const res = await me.agent.put(`/api/orders/${o.id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: "Order cancelled" });
    expect(res.body.data.orderStatus).toBe("Cancelled");
    expect(o.updates[0].filter).toEqual({ _id: o.id, user: me.userId, orderStatus: "Pending" });
    expect(o.updates[0].update).toEqual({ $set: { orderStatus: "Cancelled" } });
    expect(statusEvents()).toEqual([{ orderId: expect.anything(), oldStatus: "Pending", newStatus: "Cancelled" }]);
  });

  test.each(["Confirmed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"])(
    "own order that is %s → 409, nothing written, no event",
    async (status) => {
      const me = await loginAs(app, { role: "customer" });
      const o = installOrder({ status, owner: me.userId });
      const res = await me.agent.put(`/api/orders/${o.id}/cancel`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/only pending orders/i);
      expect(res.body.message).toContain(`"${status}"`);
      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
      expect(statusEvents()).toEqual([]);
      expect(o.status).toBe(status);
    }
  );

  test.each(["Pending", "Confirmed", "Delivered"])("SOMEONE ELSE's %s order → 403, nothing written", async (status) => {
    const me = await loginAs(app, { role: "customer" });
    const o = installOrder({ status, owner: newId() });
    const res = await me.agent.put(`/api/orders/${o.id}/cancel`);
    expect(res.status).toBe(403);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    expect(statusEvents()).toEqual([]);
    expect(o.status).toBe(status);
  });

  describe("customer-only: admin accounts are refused, even for their OWN order", () => {
    test("an admin who owns a Pending order → 403; the order is not even read, nothing is written", async () => {
      const admin = await loginAs(app, { role: "admin" });
      const o = installOrder({ status: "Pending", owner: admin.userId });
      const res = await admin.agent.put(`/api/orders/${o.id}/cancel`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/customer accounts/i);
      expect(Order.findById).not.toHaveBeenCalled();
      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
      expect(statusEvents()).toEqual([]);
      expect(o.status).toBe("Pending");
    });

    test("an admin and a customer's order (not the owner) → 403 as well", async () => {
      const admin = await loginAs(app, { role: "admin" });
      const o = installOrder({ status: "Pending", owner: newId() });
      expect((await admin.agent.put(`/api/orders/${o.id}/cancel`)).status).toBe(403);
      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test("the admin's own endpoint still works for that same admin-owned order (Pending → Cancelled)", async () => {
      const admin = await loginAs(app, { role: "admin" });
      const o = installOrder({ status: "Pending", owner: admin.userId });
      expect((await admin.agent.put(`/api/admin/orders/${o.id}/status`).send({ status: "Cancelled" })).status).toBe(200);
      expect(o.status).toBe("Cancelled");
    });

    test("role is re-read on every request: a customer promoted to admin is refused immediately", async () => {
      const me = await loginAs(app, { role: "customer" });
      const o = installOrder({ status: "Pending", owner: me.userId });
      me.user.role = "admin"; // an admin promotes the account while the session is open
      expect((await me.agent.put(`/api/orders/${o.id}/cancel`)).status).toBe(403);
      expect(o.status).toBe("Pending");
    });

    test("an admin demoted to customer may use the customer route at once", async () => {
      const me = await loginAs(app, { role: "admin" });
      const o = installOrder({ status: "Pending", owner: me.userId });
      me.user.role = "customer";
      expect((await me.agent.put(`/api/orders/${o.id}/cancel`)).status).toBe(200);
    });
  });

  test("an order whose owner no longer exists (user = null) → 403 for everyone", async () => {
    const me = await loginAs(app, { role: "customer" });
    const o = installOrder({ status: "Pending", owner: null });
    expect((await me.agent.put(`/api/orders/${o.id}/cancel`)).status).toBe(403);
  });

  test("unknown order → 404; malformed id → 400", async () => {
    const me = await loginAs(app, { role: "customer" });
    const o = installOrder({ status: "Pending", owner: me.userId });
    o.deleted = true;
    expect((await me.agent.put(`/api/orders/${o.id}/cancel`)).status).toBe(404);
    expect((await me.agent.put("/api/orders/not-an-id/cancel")).status).toBe(400);
  });

  test("not logged in → 401", async () => {
    const agent = await newAgent(app); // has a CSRF token but no login
    const o = installOrder({ status: "Pending" });
    expect((await agent.put(`/api/orders/${o.id}/cancel`)).status).toBe(401);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("an admin moves the order on first (Pending → Confirmed) while the customer cancels → 409, no event", async () => {
    const me = await loginAs(app, { role: "customer" });
    const o = installOrder({ status: "Pending", owner: me.userId });
    Order.findOneAndUpdate.mockImplementationOnce(() => {
      o.status = "Confirmed"; // the admin's change lands between our read and our update
      return query(null);
    });
    const res = await me.agent.put(`/api/orders/${o.id}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/can no longer be cancelled/i);
    expect(res.body.message).toContain('"Confirmed"');
    expect(statusEvents()).toEqual([]);
  });

  test("customer double-click: two simultaneous cancels → exactly one 200 and one 409, one event", async () => {
    const me = await loginAs(app, { role: "customer" });
    let reads = 0;
    let release;
    const opened = new Promise((r) => (release = r));
    const o = installOrder({ status: "Pending", owner: me.userId, gate: () => { if (++reads === 2) release(); return opened; } });
    const results = await Promise.all([me.agent.put(`/api/orders/${o.id}/cancel`), me.agent.put(`/api/orders/${o.id}/cancel`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(statusEvents()).toHaveLength(1);
  });

  test("CSRF: wrong token, no token and a foreign Origin are all 403 and change nothing", async () => {
    const me = await loginAs(app, { role: "customer" });
    const o = installOrder({ status: "Pending", owner: me.userId });
    const url = `/api/orders/${o.id}/cancel`;

    expect((await me.agent.put(url).set("X-CSRF-Token", "forged")).status).toBe(403);
    const cookie = cookieHeader(me.agent);
    const api = await anonymous(app);
    expect((await api.put(url).set("Cookie", cookie)).status).toBe(403); // cookie only (what a forged page can do)
    expect((await api.put(url).set("Cookie", cookie).set("Origin", "https://evil.example")).status).toBe(403);

    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    expect(o.status).toBe("Pending");
  });
});

describe("isCustomer middleware", () => {
  const run = (session) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    isCustomer({ session }, res, next);
    return { res, next };
  };

  test("customer → next()", () => {
    const { next, res } = run({ role: "customer" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each([["admin"], [undefined], [null], [""], ["Customer"], ["superuser"]])("role %j → 403, next() not called (fails closed)", (role) => {
    const { next, res } = run({ role });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("no session at all → 403", () => {
    const { next, res } = run(undefined);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("C — dashboard: cancelled orders do not count as money", () => {
  const pipelines = [];

  beforeEach(() => {
    pipelines.length = 0;
    jest.spyOn(Order, "aggregate").mockImplementation((pipeline) => {
      pipelines.push(pipeline);
      return Promise.resolve([]);
    });
    jest.spyOn(Order, "countDocuments").mockResolvedValue(0);
    jest.spyOn(Order, "find").mockReturnValue(query([]));
    jest.spyOn(User, "countDocuments").mockResolvedValue(0);
  });

  const EXCLUDE = { $match: expect.objectContaining({ orderStatus: { $ne: "Cancelled" } }) };
  const has$ = (pipeline, stage) => pipeline.some((s) => s[stage] !== undefined);
  const groupWith = (field) => pipelines.find((p) => p.some((s) => s.$group && JSON.stringify(s.$group).includes(field)));

  test("revenue / average, popular foods, top spenders and revenue-by-date start by excluding Cancelled", async () => {
    await getDashboardStats();

    const revenue = groupWith("totalRevenue\":{\"$sum\":\"$totalAmount\"");
    expect(revenue[0]).toEqual(EXCLUDE);
    expect(JSON.stringify(revenue)).toContain("avgOrderValue");

    const popular = pipelines.find((p) => p.some((s) => s.$unwind));
    expect(popular[0]).toEqual(EXCLUDE);

    const spenders = pipelines.find((p) => p.some((s) => s.$lookup));
    expect(spenders[0]).toEqual(EXCLUDE);

    const byDate = pipelines.find((p) => JSON.stringify(p).includes("$dateToString"));
    expect(byDate[0].$match).toMatchObject({ orderStatus: { $ne: "Cancelled" } });
  });

  test("order COUNTS still include every status: totalOrders and ordersByStatus have no filter", async () => {
    await getDashboardStats();
    const total = pipelines.find((p) => p.some((s) => s.$group && s.$group.totalOrders));
    expect(has$(total, "$match")).toBe(false);
    expect(JSON.stringify(total)).not.toContain("totalRevenue");
    const byStatus = pipelines.find((p) => p.some((s) => s.$group && s.$group._id === "$orderStatus"));
    expect(has$(byStatus, "$match")).toBe(false);
  });

  test("summary keeps its shape and takes revenue from the filtered pipeline", async () => {
    Order.aggregate.mockImplementation((pipeline) => {
      const text = JSON.stringify(pipeline);
      if (text.includes("totalOrders")) return Promise.resolve([{ totalOrders: 7 }]);
      if (text.includes("avgOrderValue")) return Promise.resolve([{ totalRevenue: 900, avgOrderValue: 300.4 }]);
      return Promise.resolve([]);
    });
    const stats = await getDashboardStats();
    expect(stats.summary).toEqual({ totalOrders: 7, totalRevenue: 900, avgOrderValue: 300, pendingOrders: 0, totalUsers: 0 });
    expect(Object.keys(stats).sort()).toEqual(["ordersByStatus", "popularFoods", "recentOrders", "revenueByDate", "summary", "topSpenders"]);
  });

  test("empty database → zeros, not errors", async () => {
    const stats = await getDashboardStats();
    expect(stats.summary).toMatchObject({ totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 });
  });
});
