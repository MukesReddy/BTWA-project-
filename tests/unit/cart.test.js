// P1.10 — cart hardening.
// DB-free: the Mongoose models are mocked, so these tests prove the CONTROLLER LOGIC
// (which atomic operations are issued, retry on E11000, response shape, pruning).
// They do NOT prove MongoDB's behaviour — tests/integration/cart.test.js does that.

const request = require("supertest");
const app = require("../../server");
const Cart = require("../../models/Cart");
const Food = require("../../models/Food");
const { query } = require("../helpers/chain");
const { loginAs, newId } = require("../helpers/auth");
const { MAX_CART_QUANTITY } = require("../../utils/constants");
const { buildCartResponse } = require("../../controllers/cartController");

const duplicateKey = () => Object.assign(new Error("E11000 duplicate key error"), { code: 11000, keyPattern: { user: 1 } });

const food = (over = {}) => ({ _id: newId(), name: "Veg Burger", price: 120, available: true, image: "", ...over });

const cartDoc = (userId, items) => ({
  _id: newId(),
  user: userId,
  items,
  toObject() { return { _id: this._id, user: this.user, items: this.items }; },
});

describe("POST /api/cart (add)", () => {
  let agent, userId, f;

  beforeEach(async () => {
    ({ agent, userId } = await loginAs(app));
    f = food();
    jest.spyOn(Food, "findById").mockResolvedValue({ ...f, _id: { toString: () => f._id } });
    jest.spyOn(Food, "find").mockReturnValue(query([f]));
    // what the final "read the cart back" returns
    jest.spyOn(Cart, "findOne").mockImplementation(() => query(cartDoc(userId, [{ food: { toString: () => f._id }, quantity: 3, price: 1 }])));
  });

  test("existing line: ONE atomic $inc using the positional operator and the quantity cap", async () => {
    const update = jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 });
    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 2 });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    const [filter, change] = update.mock.calls[0];
    expect(filter.items.$elemMatch.quantity).toEqual({ $lte: MAX_CART_QUANTITY - 2 });
    expect(change.$inc).toEqual({ "items.$.quantity": 2 });
  });

  test("response uses the LIVE food price, not the stale price stored in the cart", async () => {
    jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 });
    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    // stored price was 1, live price is 120, quantity 3 → 360
    expect(res.body.data.total).toBe(360);
    expect(res.body.data.items[0]).toMatchObject({ quantity: 3, price: 120 });
    expect(res.body.data.items[0].food).toMatchObject({ name: "Veg Burger" });
  });

  test("would exceed the per-item maximum → 400 and nothing is pushed", async () => {
    const update = jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 0 });
    jest.spyOn(Cart, "exists").mockResolvedValue({ _id: newId() }); // the line exists
    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 5 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(new RegExp(`at most ${MAX_CART_QUANTITY}`));
    expect(update).toHaveBeenCalledTimes(1); // only the failed $inc, no $push
  });

  test("new line: upsert-push guarded by $ne, so it can never add a duplicate line", async () => {
    const update = jest.spyOn(Cart, "updateOne")
      .mockResolvedValueOnce({ matchedCount: 0 })   // no line to increment
      .mockResolvedValueOnce({ upsertedCount: 1 }); // push/upsert
    jest.spyOn(Cart, "exists").mockResolvedValue(null);

    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    expect(res.status).toBe(200);
    const [filter, change, options] = update.mock.calls[1];
    expect(filter["items.food"]).toEqual({ $ne: expect.anything() });
    expect(change.$push.items).toMatchObject({ quantity: 1, price: 120 });
    expect(options).toMatchObject({ upsert: true });
  });

  test("duplicate cart creation (E11000 race) is retried, then succeeds", async () => {
    const update = jest.spyOn(Cart, "updateOne")
      .mockResolvedValueOnce({ matchedCount: 0 }) // attempt 1: no line
      .mockRejectedValueOnce(duplicateKey())      // attempt 1: lost the race to create the cart
      .mockResolvedValueOnce({ matchedCount: 1 }); // attempt 2: the other request's cart exists → $inc works
    jest.spyOn(Cart, "exists").mockResolvedValue(null);

    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(3);
  });

  test("E11000 that never resolves gives up with a clean 409 (not a 500)", async () => {
    jest.spyOn(Cart, "updateOne").mockImplementation(async (filter) => {
      if (filter.items) return { matchedCount: 0 };
      throw duplicateKey();
    });
    jest.spyOn(Cart, "exists").mockResolvedValue(null);

    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  test("a non-duplicate-key database error is not swallowed", async () => {
    jest.spyOn(Cart, "updateOne").mockRejectedValue(new Error("connection lost"));
    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    expect(res.status).toBe(500);
  });

  test("unknown / unavailable food never touches the cart", async () => {
    const update = jest.spyOn(Cart, "updateOne");
    Food.findById.mockResolvedValue(null);
    expect((await agent.post("/api/cart").send({ foodId: newId(), quantity: 1 })).status).toBe(404);
    Food.findById.mockResolvedValue({ _id: newId(), available: false });
    expect((await agent.post("/api/cart").send({ foodId: newId(), quantity: 1 })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("POST /api/cart — the concurrent first-add race (regression)", () => {
  // A tiny stateful stand-in for ONE cart line in MongoDB. It answers every query according to
  // what the filter actually asks, so it can reproduce the real interleaving deterministically:
  //
  //   request A: step 1 ($inc)  -> no cart yet, no match
  //   request B: creates the cart + line (lands right after A's step 1)
  //   request A: step 2 / 3     -> must NOT report a quantity limit; must retry and add
  const mongoLine = (initial = null, { raceAfterFirstMiss = false } = {}) => {
    const db = { qty: initial, raceFired: false };
    const lineExists = () => db.qty !== null;

    jest.spyOn(Cart, "updateOne").mockImplementation(async (filter, update) => {
      if (filter.items && filter.items.$elemMatch) {              // step 1: guarded $inc
        const room = filter.items.$elemMatch.quantity.$lte;
        if (lineExists() && db.qty <= room) {
          db.qty += update.$inc["items.$.quantity"];
          return { matchedCount: 1 };
        }
        if (raceAfterFirstMiss && !db.raceFired) {                // the concurrent request wins here
          db.raceFired = true;
          db.qty = 1;
        }
        return { matchedCount: 0 };
      }
      if (lineExists()) throw duplicateKey();                      // step 3: unique index on user
      db.qty = update.$push.items.quantity;
      return { upsertedCount: 1 };
    });

    jest.spyOn(Cart, "exists").mockImplementation(async (filter) => {
      const cap = filter.items && filter.items.$elemMatch && filter.items.$elemMatch.quantity.$gt;
      if (cap !== undefined) return lineExists() && db.qty > cap ? { _id: 1 } : null; // "over the cap?"
      return lineExists() ? { _id: 1 } : null;                                         // "any line?"
    });
    return db;
  };

  let agent, userId, f;
  beforeEach(async () => {
    ({ agent, userId } = await loginAs(app));
    f = food();
    jest.spyOn(Food, "findById").mockResolvedValue({ ...f, _id: { toString: () => f._id } });
    jest.spyOn(Food, "find").mockReturnValue(query([f]));
    jest.spyOn(Cart, "findOne").mockImplementation(() => query(cartDoc(userId, [{ food: { toString: () => f._id }, quantity: 1, price: 120 }])));
  });

  test("a concurrent request creating the line right after our first miss is NOT a quantity limit", async () => {
    const db = mongoLine(null, { raceAfterFirstMiss: true });

    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });

    expect(res.status).toBe(200);          // used to be 400 "You can order at most 20 of one item"
    expect(db.qty).toBe(2);                // the other request's unit + ours: nothing lost, nothing doubled
    expect(Cart.updateOne).toHaveBeenCalledTimes(3); // $inc (miss) → push (E11000) → $inc (hit)
  });

  test("a line that is really at the cap is still refused with 400", async () => {
    const db = mongoLine(MAX_CART_QUANTITY);
    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(new RegExp(`at most ${MAX_CART_QUANTITY}`));
    expect(db.qty).toBe(MAX_CART_QUANTITY);
  });

  test("a line one below the cap accepts exactly one more, then refuses", async () => {
    const db = mongoLine(MAX_CART_QUANTITY - 1);
    expect((await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 })).status).toBe(200);
    expect((await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 })).status).toBe(400);
    expect(db.qty).toBe(MAX_CART_QUANTITY);
  });

  test("the cap check asks about a line that would exceed the cap, not merely 'a line exists'", async () => {
    mongoLine(null, { raceAfterFirstMiss: true });
    await agent.post("/api/cart").send({ foodId: f._id, quantity: 3 });
    const filter = Cart.exists.mock.calls[0][0];
    expect(filter.items.$elemMatch.quantity).toEqual({ $gt: MAX_CART_QUANTITY - 3 });
  });
});

describe("PUT /api/cart/:foodId (set quantity)", () => {
  test("sets the matched line atomically with the positional operator", async () => {
    const { agent, userId } = await loginAs(app);
    const f = food();
    const update = jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 });
    jest.spyOn(Food, "find").mockReturnValue(query([f]));
    jest.spyOn(Cart, "findOne").mockReturnValue(query(cartDoc(userId, [{ food: { toString: () => f._id }, quantity: 7, price: 120 }])));

    const res = await agent.put(`/api/cart/${f._id}`).send({ quantity: 7 });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][1]).toEqual({ $set: { "items.$.quantity": 7 } });
    expect(res.body.data.total).toBe(840);
  });

  test("line not in cart → 404", async () => {
    const { agent } = await loginAs(app);
    jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 0 });
    const res = await agent.put(`/api/cart/${newId()}`).send({ quantity: 2 });
    expect(res.status).toBe(404);
  });
});

// Batch 4 — an order placed at the same moment claims the cart and DELETES it (services/orderService.js).
// If that happens between our successful write and our "read the cart back", findOne returns null.
// That used to crash buildCartResponse(null) → 500. It is a conflict the customer can resolve → 409.
describe("a cart that vanishes right after a successful write (concurrent checkout) → 409, never 500", () => {
  const CHECKED_OUT = "Your cart was just checked out. Please review your cart and try again.";
  let agent, f;

  beforeEach(async () => {
    ({ agent } = await loginAs(app));
    f = food();
    jest.spyOn(Food, "findById").mockResolvedValue({ ...f, _id: { toString: () => f._id } });
    jest.spyOn(Food, "find").mockReturnValue(query([f]));
    jest.spyOn(Cart, "findOne").mockImplementation(() => query(null)); // the order took the cart
  });

  test("POST /api/cart: the add succeeded, the cart is gone → 409 with a clear message", async () => {
    const update = jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 });

    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });

    expect(update).toHaveBeenCalledTimes(1); // the write really happened first
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: CHECKED_OUT });
    expect(Food.find).not.toHaveBeenCalled(); // no attempt to build a response from nothing
  });

  test("PUT /api/cart/:foodId: the update matched, the cart is gone → 409 with the same message", async () => {
    jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 });

    const res = await agent.put(`/api/cart/${f._id}`).send({ quantity: 3 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, message: CHECKED_OUT });
    expect(Food.find).not.toHaveBeenCalled();
  });

  test("the 409 never leaks a stack trace or internals", async () => {
    jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 });
    const res = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    expect(JSON.stringify(res.body)).not.toMatch(/TypeError|Cannot read|\.js:/);
  });

  test("UNCHANGED: GET /api/cart with no cart is still 200 and empty", async () => {
    const res = await agent.get("/api/cart");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], total: 0 });
  });

  test("UNCHANGED: DELETE /api/cart/:foodId with no cart is still 404", async () => {
    jest.spyOn(Cart, "findOneAndUpdate").mockResolvedValue(null);
    const res = await agent.delete(`/api/cart/${f._id}`);
    expect(res.status).toBe(404);
  });

  test("UNCHANGED: when the cart still exists the normal 200 response is returned", async () => {
    jest.spyOn(Cart, "updateOne").mockResolvedValue({ matchedCount: 1 });
    Cart.findOne.mockImplementation(() => query(cartDoc(newId(), [{ food: { toString: () => f._id }, quantity: 3, price: 1 }])));

    const add = await agent.post("/api/cart").send({ foodId: f._id, quantity: 1 });
    const set = await agent.put(`/api/cart/${f._id}`).send({ quantity: 3 });

    expect(add.status).toBe(200);
    expect(set.status).toBe(200);
    expect(set.body.data.total).toBe(360);
  });
});

describe("buildCartResponse", () => {
  test("drops lines whose food was deleted, prunes them from the DB, and totals the rest", async () => {
    const alive = food({ price: 10.1 });
    const goneId = newId();
    const update = jest.spyOn(Cart, "updateOne").mockResolvedValue({});
    jest.spyOn(Food, "find").mockReturnValue(query([alive]));

    const cart = cartDoc(newId(), [
      { food: { toString: () => goneId }, quantity: 2, price: 5 },
      { food: { toString: () => alive._id }, quantity: 3, price: 5 },
    ]);
    const result = await buildCartResponse(cart);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].food._id).toBe(alive._id);
    expect(result.total).toBe(30.3); // 10.1 × 3 rounded to paise (naive float maths gives 30.299999…)
    expect(update.mock.calls[0][1].$pull.items.food.$in).toHaveLength(1);
  });

  test("a cart whose foods all still exist is not written to", async () => {
    const f = food();
    const update = jest.spyOn(Cart, "updateOne");
    jest.spyOn(Food, "find").mockReturnValue(query([f]));
    await buildCartResponse(cartDoc(newId(), [{ food: { toString: () => f._id }, quantity: 1, price: 1 }]));
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Cart schema", () => {
  test("rejects fractional quantities and quantities above the maximum", () => {
    const base = { food: newId(), price: 10 };
    const bad = (quantity) => new Cart({ user: newId(), items: [{ ...base, quantity }] }).validateSync();
    expect(bad(1.5)).toBeDefined();
    expect(bad(MAX_CART_QUANTITY + 1)).toBeDefined();
    expect(bad(0)).toBeDefined();
    expect(bad(MAX_CART_QUANTITY)).toBeUndefined();
    expect(bad(1)).toBeUndefined();
  });
});
