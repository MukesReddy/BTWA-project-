// P1.10 + cart part of P1.11 — against a REAL MongoDB.
// NOT executed in the sandbox this was written in (no mongod binary reachable): run
// `npm run test:integration` on a machine with internet access (or MONGO_TEST_URI).

const request = require("supertest");
const app = require("../../server");
const Cart = require("../../models/Cart");
const Food = require("../../models/Food");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("../helpers/db");
const { createUser, createFood, loginAgent } = require("../helpers/factories");
const { MAX_CART_QUANTITY } = require("../../utils/constants");

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);

const lines = async (user) => (await Cart.findOne({ user: user._id })).items;

describe("atomic add", () => {
  test("10 simultaneous adds of the same food by a brand-new user → ONE cart, quantity 10", async () => {
    const user = await createUser();
    const food = await createFood();
    const agent = await loginAgent(app, user);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => agent.post("/api/cart").send({ foodId: food.id, quantity: 1 }))
    );

    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await Cart.countDocuments({ user: user._id })).toBe(1);
    const items = await lines(user);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(10);
  });

  test("REGRESSION (first-add race): repeated 10-way races on a brand-new cart never return a false 400", async () => {
    // Every round starts with NO cart document for the user, so the 10 requests race to create it.
    // Before the fix, a request that lost the race could see the winner's line and wrongly answer
    // "You can order at most 20 of one item".
    //
    // The user is created and logged in ONCE (bcrypt is deliberately slow, ~170 ms per user+login,
    // and has nothing to do with the race); each round just deletes that user's cart.
    const ROUNDS = 15;
    const CONCURRENCY = 10;
    const food = await createFood();
    const user = await createUser();
    const agent = await loginAgent(app, user);

    const updateOne = jest.spyOn(Cart, "updateOne"); // call-through: only counts the database writes
    const roundMs = [];
    const callsPerRound = [];

    for (let round = 0; round < ROUNDS; round++) {
      await Cart.deleteMany({ user: user._id }); // brand-new cart for this round
      updateOne.mockClear();

      const started = Date.now();
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => agent.post("/api/cart").send({ foodId: food.id, quantity: 1 }))
      );
      roundMs.push(Date.now() - started);
      callsPerRound.push(updateOne.mock.calls.length);

      expect(results.map((r) => r.status)).toEqual(Array(CONCURRENCY).fill(200));
      expect(await Cart.countDocuments({ user: user._id })).toBe(1);
      const items = await lines(user);
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(CONCURRENCY);
      // a healthy round takes tens of milliseconds; a hang / retry storm would be far above this
      expect(roundMs[round]).toBeLessThan(2000);
    }

    if (process.env.DEBUG_TEST_DB) {
      // eslint-disable-next-line no-console
      console.log(
        `first-add race: round ms = [${roundMs.join(", ")}]; Cart.updateOne calls per round = [${callsPerRound.join(", ")}] ` +
          `(${CONCURRENCY} = no retries; every extra 2 = one lost race that was retried)`
      );
    }
  });

  test("REGRESSION: concurrent first adds with different quantities (5 × 2) add up to exactly 10", async () => {
    const user = await createUser();
    const food = await createFood();
    const agent = await loginAgent(app, user);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => agent.post("/api/cart").send({ foodId: food.id, quantity: 2 }))
    );

    expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
    expect(await Cart.countDocuments({ user: user._id })).toBe(1);
    expect((await lines(user))[0].quantity).toBe(10);
  });

  test("simultaneous first adds of DIFFERENT foods → one cart containing both lines", async () => {
    const user = await createUser();
    const [a, b] = [await createFood(), await createFood()];
    const agent = await loginAgent(app, user);

    const results = await Promise.all([
      agent.post("/api/cart").send({ foodId: a.id, quantity: 2 }),
      agent.post("/api/cart").send({ foodId: b.id, quantity: 3 }),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await Cart.countDocuments({ user: user._id })).toBe(1);
    const byFood = Object.fromEntries((await lines(user)).map((i) => [i.food.toString(), i.quantity]));
    expect(byFood).toEqual({ [a.id]: 2, [b.id]: 3 });
  });

  test("the unique index on Cart.user exists and rejects a second cart", async () => {
    const user = await createUser();
    await Cart.create({ user: user._id, items: [] });
    await expect(Cart.create({ user: user._id, items: [] })).rejects.toMatchObject({ code: 11000 });
  });

  test("the per-item maximum holds under concurrency: never more than MAX, never a 5xx", async () => {
    const user = await createUser();
    const food = await createFood();
    const agent = await loginAgent(app, user);
    const attempts = MAX_CART_QUANTITY + 5;

    const results = await Promise.all(
      Array.from({ length: attempts }, () => agent.post("/api/cart").send({ foodId: food.id, quantity: 1 }))
    );

    const succeeded = results.filter((r) => r.status === 200).length;
    expect(results.every((r) => r.status < 500)).toBe(true);
    const [line] = await lines(user);
    expect(line.quantity).toBeLessThanOrEqual(MAX_CART_QUANTITY);
    expect(line.quantity).toBe(succeeded); // every 200 is exactly one unit actually added
    expect(results.filter((r) => r.status === 400).length).toBe(attempts - succeeded - results.filter((r) => r.status === 409).length);
  });

  test("sequential: reaching the maximum is allowed, one more is a 400 and changes nothing", async () => {
    const user = await createUser();
    const food = await createFood();
    const agent = await loginAgent(app, user);

    expect((await agent.post("/api/cart").send({ foodId: food.id, quantity: MAX_CART_QUANTITY })).status).toBe(200);
    const over = await agent.post("/api/cart").send({ foodId: food.id, quantity: 1 });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/at most/);
    expect((await lines(user))[0].quantity).toBe(MAX_CART_QUANTITY);
  });

  test("adding an existing food refreshes the stored price snapshot and increments the quantity", async () => {
    const user = await createUser();
    const food = await createFood({ price: 100 });
    const agent = await loginAgent(app, user);
    await agent.post("/api/cart").send({ foodId: food.id, quantity: 1 });
    await Food.updateOne({ _id: food._id }, { price: 120 });
    await agent.post("/api/cart").send({ foodId: food.id, quantity: 2 });
    const [line] = await lines(user);
    expect(line).toMatchObject({ quantity: 3, price: 120 });
  });

  test("unavailable and unknown foods are refused", async () => {
    const user = await createUser();
    const food = await createFood({ available: false });
    const agent = await loginAgent(app, user);
    expect((await agent.post("/api/cart").send({ foodId: food.id, quantity: 1 })).status).toBe(400);
    expect((await agent.post("/api/cart").send({ foodId: "5f8d0d55b54764421b7156c3", quantity: 1 })).status).toBe(404);
    expect(await Cart.countDocuments()).toBe(0);
  });
});

describe("update / remove", () => {
  test("PUT changes only the targeted line (positional operator)", async () => {
    const user = await createUser();
    const [a, b] = [await createFood(), await createFood()];
    const agent = await loginAgent(app, user);
    await agent.post("/api/cart").send({ foodId: a.id, quantity: 1 });
    await agent.post("/api/cart").send({ foodId: b.id, quantity: 1 });

    const res = await agent.put(`/api/cart/${b.id}`).send({ quantity: 7 });

    expect(res.status).toBe(200);
    const byFood = Object.fromEntries((await lines(user)).map((i) => [i.food.toString(), i.quantity]));
    expect(byFood).toEqual({ [a.id]: 1, [b.id]: 7 });
    expect(res.body.data.items).toHaveLength(2);
  });

  test("PUT on a food that is not in the cart → 404", async () => {
    const user = await createUser();
    const agent = await loginAgent(app, user);
    expect((await agent.put("/api/cart/5f8d0d55b54764421b7156c3").send({ quantity: 2 })).status).toBe(404);
  });

  test("DELETE removes one line and keeps the rest", async () => {
    const user = await createUser();
    const [a, b] = [await createFood(), await createFood()];
    const agent = await loginAgent(app, user);
    await agent.post("/api/cart").send({ foodId: a.id, quantity: 1 });
    await agent.post("/api/cart").send({ foodId: b.id, quantity: 1 });

    const res = await agent.delete(`/api/cart/${a.id}`);

    expect(res.status).toBe(200);
    expect((await lines(user)).map((i) => i.food.toString())).toEqual([b.id]);
  });
});

describe("cart reflects live data (P1.9/P1.11)", () => {
  test("GET /api/cart shows the CURRENT price and total after the admin changes a price", async () => {
    const user = await createUser();
    const food = await createFood({ price: 100 });
    const agent = await loginAgent(app, user);
    await agent.post("/api/cart").send({ foodId: food.id, quantity: 2 });
    await Food.updateOne({ _id: food._id }, { price: 150 });

    const res = await agent.get("/api/cart");

    expect(res.body.data.total).toBe(300);
    expect(res.body.data.items[0]).toMatchObject({ price: 150, quantity: 2 });
  });

  test("a food deleted behind the scenes disappears from GET /api/cart and from the database", async () => {
    const user = await createUser();
    const [keep, gone] = [await createFood(), await createFood()];
    const agent = await loginAgent(app, user);
    await agent.post("/api/cart").send({ foodId: keep.id, quantity: 1 });
    await agent.post("/api/cart").send({ foodId: gone.id, quantity: 1 });
    await Food.deleteOne({ _id: gone._id }); // bypasses the controller on purpose

    const res = await agent.get("/api/cart");

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i) => i.food._id)).toEqual([keep.id]);
    expect((await lines(user)).map((i) => i.food.toString())).toEqual([keep.id]);
  });

  test("admin DELETE /api/foods/:id removes the food from EVERY customer's cart", async () => {
    const admin = await createUser({ role: "admin" });
    const [u1, u2] = [await createUser(), await createUser()];
    const [doomed, other] = [await createFood(), await createFood()];
    const [a1, a2] = [await loginAgent(app, u1), await loginAgent(app, u2)];
    await a1.post("/api/cart").send({ foodId: doomed.id, quantity: 1 });
    await a1.post("/api/cart").send({ foodId: other.id, quantity: 1 });
    await a2.post("/api/cart").send({ foodId: doomed.id, quantity: 2 });

    const res = await (await loginAgent(app, admin)).delete(`/api/foods/${doomed.id}`);

    expect(res.status).toBe(200);
    expect(await Cart.countDocuments({ "items.food": doomed._id })).toBe(0);
    expect((await lines(u1)).map((i) => i.food.toString())).toEqual([other.id]);
    expect(await lines(u2)).toHaveLength(0);
  });
});
