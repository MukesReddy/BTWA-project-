// What does Mongoose actually SEND to MongoDB for the cart / order operations?
// We stub the native driver collection (no database) and inspect the final, cast
// filter + update documents: ObjectId casting, automatic timestamps, upsert options.
// This catches Mongoose-level mistakes (e.g. a default conflicting with $push) that
// controller-level mocks cannot see. It does NOT replace the real-MongoDB integration tests.

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../server");
const Cart = require("../../models/Cart");
const Food = require("../../models/Food");
const { query } = require("../helpers/chain");
const { loginAs, newId } = require("../helpers/auth");

const isOid = (v) => v && v._bsontype === "ObjectId";

describe("documents sent to MongoDB", () => {
  let agent, userId, foodId, driver;

  beforeEach(async () => {
    ({ agent, userId } = await loginAs(app));
    foodId = newId();
    jest.spyOn(Food, "findById").mockResolvedValue({ _id: new mongoose.Types.ObjectId(foodId), price: 120, available: true });
    jest.spyOn(Food, "find").mockReturnValue(query([]));
    jest.spyOn(Cart, "findOne").mockReturnValue(query({ _id: newId(), items: [], toObject() { return { items: [] }; } }));
    driver = jest.spyOn(Cart.collection, "updateOne");
  });

  test("increment: ObjectIds are cast, $elemMatch cap is intact, updatedAt is bumped", async () => {
    driver.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, acknowledged: true });
    await agent.post("/api/cart").send({ foodId, quantity: 2 });

    const [filter, update] = driver.mock.calls[0];
    expect(isOid(filter.user)).toBe(true);
    expect(isOid(filter.items.$elemMatch.food)).toBe(true);
    expect(filter.items.$elemMatch.quantity).toEqual({ $lte: 18 });
    expect(update.$inc).toEqual({ "items.$.quantity": 2 });
    expect(update.$set["items.$.price"]).toBe(120);
    expect(update.$set.updatedAt).toBeInstanceOf(Date); // the order service's claim relies on this
  });

  test("upsert push: no default `items: []` that would conflict with $push; unique-user upsert", async () => {
    driver
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0, acknowledged: true })
      .mockResolvedValueOnce({ matchedCount: 0, upsertedCount: 1, acknowledged: true });
    jest.spyOn(Cart, "exists").mockResolvedValue(null);

    const res = await agent.post("/api/cart").send({ foodId, quantity: 1 });
    expect(res.status).toBe(200);

    const [filter, update, options] = driver.mock.calls[1];
    expect(isOid(filter.user)).toBe(true);
    expect(isOid(filter["items.food"].$ne)).toBe(true);
    expect(update.$push.items).toMatchObject({ quantity: 1, price: 120 });
    expect(isOid(update.$push.items.food)).toBe(true);
    expect(options.upsert).toBe(true);
    // a $setOnInsert/$set of `items` next to $push would make MongoDB reject the update
    expect(update.$setOnInsert).not.toHaveProperty("items");
    expect(update.$set || {}).not.toHaveProperty("items");
  });

  test("set quantity uses the positional operator on the cast food id", async () => {
    driver.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, acknowledged: true });
    await agent.put(`/api/cart/${foodId}`).send({ quantity: 7 });
    const [filter, update] = driver.mock.calls[0];
    expect(isOid(filter["items.food"])).toBe(true);
    expect(update.$set["items.$.quantity"]).toBe(7);
  });

  test("the order claim filter carries the exact updatedAt value read earlier", async () => {
    const claim = jest.spyOn(Cart.collection, "findOneAndDelete").mockResolvedValue(null);
    const when = new Date("2026-01-01T10:00:00.123Z");
    await Cart.findOneAndDelete({ _id: newId(), updatedAt: when });
    const [filter] = claim.mock.calls[0];
    expect(isOid(filter._id)).toBe(true);
    expect(filter.updatedAt.getTime()).toBe(when.getTime());
  });
});
