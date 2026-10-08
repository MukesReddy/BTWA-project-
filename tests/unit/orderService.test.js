// P1.9 — order integrity.
// DB-free: models are mocked → proves the service LOGIC and the order of operations.
// Real atomicity (double submit) is proven in tests/integration/orders.test.js.

const request = require("supertest");
const app = require("../../server");
const Cart = require("../../models/Cart");
const Food = require("../../models/Food");
const Order = require("../../models/Order");
const emitter = require("../../utils/eventEmitter");
const logger = require("../../utils/logger");
const { createOrder } = require("../../services/orderService");
const { query } = require("../helpers/chain");
const { loginAs, newId } = require("../helpers/auth");

const ID = (hex) => ({ toString: () => hex });
const address = { street: "12 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" };

const setup = ({ items, foods, claimed = true }) => {
  const updatedAt = new Date("2026-01-01T10:00:00Z");
  const cart = {
    _id: newId(),
    user: newId(),
    updatedAt,
    items: items.map((i) => ({ ...i, food: ID(i.food) })),
  };
  cart.items.forEach((i) => (i.food._id = i.food.toString()));
  jest.spyOn(Cart, "findOne").mockResolvedValue(cart);
  jest.spyOn(Food, "find").mockReturnValue(query(foods.map((f) => ({ ...f, _id: ID(f._id) }))));
  const prune = jest.spyOn(Cart, "updateOne").mockResolvedValue({});
  const claim = jest.spyOn(Cart, "findOneAndDelete").mockResolvedValue(
    claimed ? { ...cart, toObject: () => ({ items: cart.items.map((i) => ({ food: i.food.toString(), quantity: i.quantity, price: i.price })) }) } : null
  );
  const create = jest.spyOn(Order, "create").mockImplementation(async (doc) => ({ _id: newId(), ...doc }));
  return { cart, prune, claim, create };
};

describe("createOrder", () => {
  test("empty / missing cart → 400", async () => {
    jest.spyOn(Cart, "findOne").mockResolvedValue(null);
    await expect(createOrder(newId(), address, "Cash on Delivery")).rejects.toMatchObject({ statusCode: 400 });
    jest.spyOn(Cart, "findOne").mockResolvedValue({ items: [] });
    await expect(createOrder(newId(), address, "Cash on Delivery")).rejects.toMatchObject({ statusCode: 400 });
  });

  test("a DELETED food no longer crashes checkout: 409, stale line pruned, no order created", async () => {
    const { prune, claim, create } = setup({
      items: [{ food: "a".repeat(24), quantity: 2, price: 50 }, { food: "b".repeat(24), quantity: 1, price: 70 }],
      foods: [{ _id: "b".repeat(24), name: "Pizza", price: 70, available: true }], // food "a…" was deleted
    });

    await expect(createOrder(newId(), address, "Cash on Delivery")).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/no longer on the menu/),
    });
    expect(prune.mock.calls[0][1].$pull.items.food.$in.map(String)).toEqual(["a".repeat(24)]);
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("an UNAVAILABLE food → 400 naming the item, cart untouched", async () => {
    const { claim, create } = setup({
      items: [{ food: "a".repeat(24), quantity: 1, price: 50 }],
      foods: [{ _id: "a".repeat(24), name: "Sold-out Biryani", price: 50, available: false }],
    });
    await expect(createOrder(newId(), address, "Cash on Delivery")).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Sold-out Biryani"),
    });
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("prices come from the live Food document, never from the cart", async () => {
    const { create } = setup({
      items: [{ food: "a".repeat(24), quantity: 3, price: 1 }], // stale / tampered cart price
      foods: [{ _id: "a".repeat(24), name: "Biryani", price: 250, available: true }],
    });
    const order = await createOrder(newId(), address, "Cash on Delivery");
    expect(create.mock.calls[0][0].items[0]).toMatchObject({ price: 250, quantity: 3, foodName: "Biryani" });
    expect(order.totalAmount).toBe(750);
  });

  test("total is rounded to paise (0.1 × 3 is 0.30000000000000004 in floating point)", async () => {
    setup({
      items: [{ food: "a".repeat(24), quantity: 3, price: 0.1 }],
      foods: [{ _id: "a".repeat(24), name: "Mint", price: 0.1, available: true }],
    });
    const order = await createOrder(newId(), address, "Cash on Delivery");
    expect(order.totalAmount).toBe(0.3);
  });

  test("the cart is claimed (deleted) BEFORE the order is created, matching _id AND updatedAt", async () => {
    const { cart, claim, create } = setup({
      items: [{ food: "a".repeat(24), quantity: 1, price: 10 }],
      foods: [{ _id: "a".repeat(24), name: "Tea", price: 10, available: true }],
    });
    await createOrder(newId(), address, "Cash on Delivery");
    expect(claim).toHaveBeenCalledWith({ _id: cart._id, updatedAt: cart.updatedAt });
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  test("double submit / cart changed: claim returns null → 409 and NO order is created", async () => {
    const { create } = setup({
      items: [{ food: "a".repeat(24), quantity: 1, price: 10 }],
      foods: [{ _id: "a".repeat(24), name: "Tea", price: 10, available: true }],
      claimed: false,
    });
    await expect(createOrder(newId(), address, "Cash on Delivery")).rejects.toMatchObject({ statusCode: 409 });
    expect(create).not.toHaveBeenCalled();
  });

  test("if Order.create fails after the claim, the cart is restored and the error propagates", async () => {
    const { create } = setup({
      items: [{ food: "a".repeat(24), quantity: 2, price: 10 }],
      foods: [{ _id: "a".repeat(24), name: "Tea", price: 10, available: true }],
    });
    create.mockRejectedValue(new Error("db down"));
    const restore = jest.spyOn(Cart, "create").mockResolvedValue({});

    await expect(createOrder(newId(), address, "Cash on Delivery")).rejects.toThrow("db down");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0][0].items).toEqual([{ food: "a".repeat(24), quantity: 2, price: 10 }]);
  });

  test("if restoring the cart ALSO fails, the original error still surfaces and it is logged", async () => {
    const { create } = setup({
      items: [{ food: "a".repeat(24), quantity: 2, price: 10 }],
      foods: [{ _id: "a".repeat(24), name: "Tea", price: 10, available: true }],
    });
    create.mockRejectedValue(new Error("db down"));
    jest.spyOn(Cart, "create").mockRejectedValue(new Error("still down"));
    await expect(createOrder(newId(), address, "Cash on Delivery")).rejects.toThrow("db down");
    expect(logger.error).toHaveBeenCalled();
  });

  test("emits orderPlaced on success only", async () => {
    const emit = jest.spyOn(emitter, "emit");
    setup({
      items: [{ food: "a".repeat(24), quantity: 1, price: 10 }],
      foods: [{ _id: "a".repeat(24), name: "Tea", price: 10, available: true }],
    });
    await createOrder(newId(), address, "Cash on Delivery");
    expect(emit).toHaveBeenCalledWith("orderPlaced", expect.objectContaining({ totalAmount: 10 }));
  });
});

describe("POST /api/orders (HTTP)", () => {
  const body = { deliveryAddress: address, paymentMethod: "Cash on Delivery" };

  test("stale cart → clean 409 JSON with a helpful message", async () => {
    const { agent } = await loginAs(app);
    setup({
      items: [{ food: "a".repeat(24), quantity: 1, price: 10 }],
      foods: [],
    });
    const res = await agent.post("/api/orders").send(body);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, message: expect.stringMatching(/review your cart/) });
  });

  test("success → 201 { success, message, data.order }", async () => {
    const { agent } = await loginAs(app);
    setup({
      items: [{ food: "a".repeat(24), quantity: 2, price: 10 }],
      foods: [{ _id: "a".repeat(24), name: "O'Brien's \"Special\" <b>Wrap</b>", price: 99.5, available: true }],
    });
    const res = await agent.post("/api/orders").send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.order.totalAmount).toBe(199);
    expect(res.body.data.order.items[0].foodName).toBe("O'Brien's \"Special\" <b>Wrap</b>");
  });

  test("an unexpected failure is a 500 JSON, never a hung request", async () => {
    const { agent } = await loginAs(app);
    jest.spyOn(Cart, "findOne").mockRejectedValue(new Error("db down"));
    const res = await agent.post("/api/orders").send(body);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── Double submit: the TWO legitimate outcomes for the second request ────────────────────────────
// An in-memory cart whose claim (findOneAndDelete) is atomic, like MongoDB's. Which of the two
// outcomes a real race produces depends only on TIMING (and --detectOpenHandles shifts the timing):
//   • both requests read the cart before either claims it   → the claim is lost  → 409
//   • the second request reads the cart after the claim     → no cart any more   → 400 "cart is empty"
// Exactly one order is created either way. The integration test forces each case deterministically.
describe("POST /api/orders double submit — outcomes of the second request", () => {
  const ADDRESS = { street: "12 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" };
  const BODY = { deliveryAddress: ADDRESS, paymentMethod: "Cash on Delivery" };
  const FOOD = { _id: ID("f".repeat(24)), name: "Biryani", price: 80, available: true };

  const install = ({ gate = null } = {}) => {
    const updatedAt = new Date("2026-01-01T10:00:00Z");
    const state = {
      cart: { _id: newId(), user: newId(), updatedAt, items: [{ food: ID("f".repeat(24)), quantity: 2 }] },
      orders: [],
    };
    jest.spyOn(Cart, "findOne").mockImplementation(() => {
      const snapshot = state.cart; // what the database holds at the moment of the read
      return query(gate ? gate().then(() => snapshot) : snapshot);
    });
    jest.spyOn(Food, "find").mockReturnValue(query([FOOD]));
    jest.spyOn(Cart, "updateOne").mockResolvedValue({});
    jest.spyOn(Cart, "findOneAndDelete").mockImplementation(async (filter) => {
      // atomic claim: matches only if the cart still exists and is unchanged
      if (!state.cart || String(state.cart._id) !== String(filter._id) || state.cart.updatedAt !== filter.updatedAt) return null;
      const claimed = state.cart;
      state.cart = null;
      return { ...claimed, toObject: () => ({ items: [] }) };
    });
    jest.spyOn(Order, "create").mockImplementation(async (doc) => {
      state.orders.push(doc);
      return { _id: newId(), ...doc };
    });
    return state;
  };

  test("both read the cart first (forced) → one 201, the other 409 'already placed'; one order", async () => {
    const { agent } = await loginAs(app, { role: "customer" });
    let reads = 0;
    let release;
    const opened = new Promise((resolve) => (release = resolve));
    const state = install({ gate: () => { if (++reads === 2) release(); return opened; } });

    const results = await Promise.all([agent.post("/api/orders").send(BODY), agent.post("/api/orders").send(BODY)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409).body.message).toMatch(/already placed/i);
    expect(state.orders).toHaveLength(1);
  });

  test("the second request arrives AFTER the claim → 201 then 400 'Your cart is empty' (the [201, 400] seen under --detectOpenHandles); one order", async () => {
    const { agent } = await loginAs(app, { role: "customer" });
    const state = install();

    const first = await agent.post("/api/orders").send(BODY);
    const second = await agent.post("/api/orders").send(BODY);

    expect([first.status, second.status]).toEqual([201, 400]);
    expect(second.body.message).toBe("Your cart is empty. Add items before placing an order.");
    expect(state.orders).toHaveLength(1);
  });

  test("whatever the timing, the invariant is: exactly one 201, exactly one order, the loser is 409-claim-lost or 400-cart-empty", async () => {
    for (const gate of [true, false]) {
      jest.restoreAllMocks();
      const { agent } = await loginAs(app, { role: "customer" });
      let reads = 0;
      let release;
      const opened = new Promise((resolve) => (release = resolve));
      const state = install({ gate: gate ? () => { if (++reads === 2) release(); return opened; } : null });

      const results = await Promise.all([agent.post("/api/orders").send(BODY), agent.post("/api/orders").send(BODY)]);

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(state.orders).toHaveLength(1);
      const loser = results.find((r) => r.status !== 201);
      expect([409, 400]).toContain(loser.status);
      expect(loser.body.message).toMatch(loser.status === 409 ? /already placed/i : /cart is empty/i);
    }
  });
});
