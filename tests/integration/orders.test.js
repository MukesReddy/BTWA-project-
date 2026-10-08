// P1.9 — order integrity against a REAL MongoDB.
// NOT executed in the sandbox this was written in (no mongod binary reachable).

const app = require("../../server");
const Cart = require("../../models/Cart");
const Food = require("../../models/Food");
const Order = require("../../models/Order");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("../helpers/db");
const { createUser, createFood, loginAgent, ORDER_BODY } = require("../helpers/factories");
const { createOrder } = require("../../services/orderService");

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

const fill = async (agent, entries) => {
  for (const [food, quantity] of entries) {
    const res = await agent.post("/api/cart").send({ foodId: food.id, quantity });
    expect(res.status).toBe(200);
  }
};

test("happy path: order total comes from DB prices, rounded; cart is emptied", async () => {
  const user = await createUser();
  const [a, b] = [await createFood({ price: 0.1 }), await createFood({ price: 49.99 })];
  const agent = await loginAgent(app, user);
  await fill(agent, [[a, 3], [b, 2]]);

  const res = await agent.post("/api/orders").send(ORDER_BODY);

  expect(res.status).toBe(201);
  expect(res.body.data.order.totalAmount).toBe(100.28); // 0.3 + 99.98
  expect(await Cart.countDocuments({ user: user._id })).toBe(0);
  const order = await Order.findOne({ user: user._id });
  expect(order.items.map((i) => [i.foodName, i.quantity, i.price])).toEqual([[a.name, 3, 0.1], [b.name, 2, 49.99]]);
});

test("price changed after adding to cart → the order uses the NEW price", async () => {
  const user = await createUser();
  const food = await createFood({ price: 100 });
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 2]]);
  await Food.updateOne({ _id: food._id }, { price: 130 });

  const res = await agent.post("/api/orders").send(ORDER_BODY);

  expect(res.status).toBe(201);
  expect(res.body.data.order.totalAmount).toBe(260);
});

test("a food DELETED after it was added: 409, stale line removed, other lines kept, no order", async () => {
  const user = await createUser();
  const [keep, gone] = [await createFood(), await createFood()];
  const agent = await loginAgent(app, user);
  await fill(agent, [[keep, 1], [gone, 1]]);
  await Food.deleteOne({ _id: gone._id });

  const res = await agent.post("/api/orders").send(ORDER_BODY);

  expect(res.status).toBe(409);
  expect(res.body.message).toMatch(/no longer on the menu/);
  expect(await Order.countDocuments()).toBe(0);
  const cart = await Cart.findOne({ user: user._id });
  expect(cart.items.map((i) => i.food.toString())).toEqual([keep.id]);

  // the customer can simply try again and succeed
  const retry = await agent.post("/api/orders").send(ORDER_BODY);
  expect(retry.status).toBe(201);
});

test("a food that became UNAVAILABLE: 400 naming it, cart untouched, no order", async () => {
  const user = await createUser();
  const food = await createFood({ name: "Seasonal Special" });
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 1]]);
  await Food.updateOne({ _id: food._id }, { available: false });

  const res = await agent.post("/api/orders").send(ORDER_BODY);

  expect(res.status).toBe(400);
  expect(res.body.message).toContain("Seasonal Special");
  expect(await Order.countDocuments()).toBe(0);
  expect(await Cart.countDocuments({ user: user._id })).toBe(1);
});

// ─── DOUBLE SUBMIT ───────────────────────────────────────────────────────────────────────────────
// Two identical "Place order" requests can legitimately end two ways, depending only on TIMING:
//   • both read the cart before either claims it → the claim (findOneAndDelete) is lost → 409
//   • the second reads the cart after the winner claimed it → there is no cart → 400 "cart is empty"
//     (indistinguishable from a genuinely empty cart: the cart document is gone)
// Timing differs between a plain run and `--detectOpenHandles` (async_hooks slow everything down), so
// a test that expects one outcome from free-running requests is flaky. These tests instead
//   1. FORCE the race (hold both cart reads until both requests have started) → strict 409,
//   2. FORCE the late duplicate (second request starts after the first finished) → strict 400,
//   3. leave the timing free and assert the invariant, printing both responses if it ever breaks.
// The real atomic guarantee under test is the same in all three: exactly ONE order.

const CLAIM_LOST = /already placed/i;
const CART_EMPTY = /cart is empty/i;
const outcomes = (results) => JSON.stringify(results.map((r) => ({ status: r.status, message: r.body && r.body.message })));

test("DOUBLE SUBMIT, race forced (both read the cart first): exactly one 201 and one 409 'already placed'; ONE order", async () => {
  const user = await createUser();
  const food = await createFood({ price: 80 });
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 2]]);

  // Test-side timing control only: the real query still runs; it just starts after BOTH requests reached it.
  const realFindOne = Cart.findOne.bind(Cart);
  let reads = 0;
  let release;
  const bothArrived = new Promise((resolve) => (release = resolve));
  jest.spyOn(Cart, "findOne").mockImplementation((...args) => {
    const q = realFindOne(...args);
    if (++reads === 2) release();
    return bothArrived.then(() => q);
  });

  const results = await Promise.all([agent.post("/api/orders").send(ORDER_BODY), agent.post("/api/orders").send(ORDER_BODY)]);

  expect({ codes: results.map((r) => r.status).sort(), detail: outcomes(results) }).toEqual({ codes: [201, 409], detail: outcomes(results) });
  expect(results.find((r) => r.status === 409).body.message).toMatch(CLAIM_LOST);
  expect(await Order.countDocuments({ user: user._id })).toBe(1);
});

test("DOUBLE SUBMIT, late duplicate (second request after the first finished): 201 then 400 'cart is empty'; ONE order", async () => {
  const user = await createUser();
  const food = await createFood({ price: 80 });
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 2]]);

  const first = await agent.post("/api/orders").send(ORDER_BODY);
  const second = await agent.post("/api/orders").send(ORDER_BODY);

  expect([first.status, second.status]).toEqual([201, 400]);
  expect(second.body.message).toMatch(CART_EMPTY);
  expect(await Order.countDocuments({ user: user._id })).toBe(1);
});

test("DOUBLE SUBMIT, free-running: exactly one 201 and ONE order; the other is 409-claim-lost or 400-cart-empty (never anything else)", async () => {
  const user = await createUser();
  const food = await createFood({ price: 80 });
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 2]]);

  const results = await Promise.all([agent.post("/api/orders").send(ORDER_BODY), agent.post("/api/orders").send(ORDER_BODY)]);

  const created = results.filter((r) => r.status === 201);
  const rejected = results.filter((r) => r.status !== 201);
  if (created.length !== 1 || rejected.length !== 1) throw new Error(`expected one 201 and one rejection, got: ${outcomes(results)}`);

  const [loser] = rejected;
  const claimLost = loser.status === 409 && CLAIM_LOST.test(loser.body.message);
  const cartAlreadyConsumed = loser.status === 400 && CART_EMPTY.test(loser.body.message);
  if (!claimLost && !cartAlreadyConsumed) throw new Error(`the rejected request is neither claim-lost (409) nor cart-empty (400): ${outcomes(results)}`);

  expect(await Order.countDocuments({ user: user._id })).toBe(1);
});

test("service level: 5 concurrent createOrder calls → exactly one succeeds", async () => {
  const user = await createUser();
  const food = await createFood();
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 1]]);

  const settled = await Promise.allSettled(
    Array.from({ length: 5 }, () => createOrder(user._id.toString(), ORDER_BODY.deliveryAddress, "Cash on Delivery"))
  );

  expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
  expect(await Order.countDocuments()).toBe(1);
});

test("a cart changed after pricing but before the claim is not ordered stale", async () => {
  // simulate the race deterministically: change the cart right after the service read it
  const user = await createUser();
  const food = await createFood();
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 1]]);

  const realFind = Food.find.bind(Food);
  const spy = jest.spyOn(Food, "find").mockImplementation((...args) => {
    const q = realFind(...args);
    const originalThen = q.then.bind(q);
    q.then = (resolve, reject) =>
      originalThen(async (docs) => {
        await Cart.updateOne({ user: user._id }, { $inc: { "items.0.quantity": 1 } }); // customer edits cart meanwhile
        return resolve(docs);
      }, reject);
    return q;
  });

  await expect(createOrder(user._id.toString(), ORDER_BODY.deliveryAddress, "Cash on Delivery")).rejects.toMatchObject({ statusCode: 409 });
  spy.mockRestore();
  expect(await Order.countDocuments()).toBe(0);
  expect(await Cart.countDocuments({ user: user._id })).toBe(1);
});

test("food names with apostrophes, quotes and HTML survive the whole flow unchanged", async () => {
  const user = await createUser();
  const name = `O'Brien's "Special" <b>Wrap</b>`;
  const food = await createFood({ name });
  const agent = await loginAgent(app, user);
  await fill(agent, [[food, 1]]);

  const cart = await agent.get("/api/cart");
  expect(cart.body.data.items[0].food.name).toBe(name);

  const res = await agent.post("/api/orders").send(ORDER_BODY);
  expect(res.status).toBe(201);
  expect(res.body.data.order.items[0].foodName).toBe(name);
});
