// P1.11 — referential integrity (deleting users / foods).
// DB-free: models are mocked → proves WHICH operations the controllers issue.
// tests/integration/integrity.test.js proves the data really ends up consistent.

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../server");
const User = require("../../models/User");
const Food = require("../../models/Food");
const Cart = require("../../models/Cart");
const Order = require("../../models/Order");
const logger = require("../../utils/logger");
const { query } = require("../helpers/chain");
const { newAgent } = require("../helpers/client");
const { loginAs, newId } = require("../helpers/auth");
const { revokeUserSessions } = require("../../utils/sessions");

describe("DELETE /api/admin/users/:id", () => {
  let admin, targetId;

  beforeEach(async () => {
    admin = await loginAs(app, { role: "admin" });
    targetId = newId();
    jest.spyOn(User, "findById").mockResolvedValue({ _id: new mongoose.Types.ObjectId(targetId) });
    jest.spyOn(Cart, "deleteOne").mockResolvedValue({});
    // revokeUserSessions talks to the "sessions" collection through mongoose.connection
    jest.spyOn(mongoose.connection, "collection").mockReturnValue({
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    });
  });

  test("user WITH orders is deactivated, never deleted (order history keeps its owner)", async () => {
    jest.spyOn(Order, "exists").mockResolvedValue({ _id: newId() });
    const updateOne = jest.spyOn(User, "updateOne").mockResolvedValue({});
    const deleteOne = jest.spyOn(User, "deleteOne").mockResolvedValue({});

    const res = await admin.agent.delete(`/api/admin/users/${targetId}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ action: "deactivated" });
    expect(updateOne.mock.calls[0][1]).toEqual({ $set: { isActive: false } });
    expect(deleteOne).not.toHaveBeenCalled();
    expect(Cart.deleteOne).toHaveBeenCalled();                    // their cart is dropped
    expect(mongoose.connection.collection).toHaveBeenCalledWith("sessions"); // and they are logged out
  });

  test("user WITHOUT orders is deleted", async () => {
    jest.spyOn(Order, "exists").mockResolvedValue(null);
    const updateOne = jest.spyOn(User, "updateOne").mockResolvedValue({});
    const deleteOne = jest.spyOn(User, "deleteOne").mockResolvedValue({});

    const res = await admin.agent.delete(`/api/admin/users/${targetId}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ action: "deleted" });
    expect(deleteOne).toHaveBeenCalledTimes(1);
    expect(updateOne).not.toHaveBeenCalled();
    expect(Cart.deleteOne).toHaveBeenCalled();
  });

  test("an admin cannot delete / deactivate themselves", async () => {
    const res = await admin.agent.delete(`/api/admin/users/${admin.userId}`);
    expect(res.status).toBe(400);
  });

  test("unknown user → 404", async () => {
    User.findById.mockResolvedValue(null);
    const res = await admin.agent.delete(`/api/admin/users/${newId()}`);
    expect(res.status).toBe(404);
  });
});

describe("revokeUserSessions", () => {
  const stubCollection = (impl) => {
    const deleteMany = jest.fn(impl);
    jest.spyOn(mongoose.connection, "collection").mockReturnValue({ deleteMany });
    return deleteMany;
  };

  test("matches the stringified userId inside the stored session", async () => {
    const id = newId();
    const deleteMany = stubCollection(async () => ({ deletedCount: 3 }));
    expect(await revokeUserSessions(id)).toBe(3);
    const { session } = deleteMany.mock.calls[0][0];
    expect(session.$regex).toBe(`"userId":"${id}"`);
    // the pattern really matches what connect-mongo stores
    const stored = JSON.stringify({ cookie: { httpOnly: true }, userId: id, role: "customer" });
    expect(new RegExp(session.$regex).test(stored)).toBe(true);
    expect(new RegExp(session.$regex).test(JSON.stringify({ userId: newId() }))).toBe(false);
  });

  test("refuses anything that is not a 24-hex ObjectId (no regex injection)", async () => {
    const deleteMany = stubCollection(async () => ({ deletedCount: 1 }));
    expect(await revokeUserSessions(".*")).toBe(0);
    expect(await revokeUserSessions('x"|.*')).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  test("never throws: a database failure is logged and swallowed", async () => {
    stubCollection(async () => { throw new Error("db down"); });
    await expect(revokeUserSessions(newId())).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("deactivated accounts cannot log in", () => {
  const login = async (user) => {
    jest.spyOn(User, "findOne").mockReturnValue(query(user));
    return (await newAgent(app)).post("/api/auth/login").send({ email: "x@example.com", password: "secret12" });
  };
  const userDoc = (over) => ({
    _id: new mongoose.Types.ObjectId(), name: "X", email: "x@example.com", role: "customer",
    comparePassword: async (p) => p === "secret12",
    toObject() { return { name: this.name }; },
    ...over,
  });

  test("isActive === false → 403 (after the password check)", async () => {
    const res = await login(userDoc({ isActive: false }));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/deactivated/i);
  });

  test("a wrong password still gives the generic 401, not the account status", async () => {
    jest.spyOn(User, "findOne").mockReturnValue(query(userDoc({ isActive: false })));
    const res = await (await newAgent(app)).post("/api/auth/login").send({ email: "x@example.com", password: "wrongpass" });
    expect(res.status).toBe(401);
  });

  test("active users and legacy users with no isActive field can log in", async () => {
    expect((await login(userDoc({ isActive: true }))).status).toBe(200);
    expect((await login(userDoc({}))).status).toBe(200);
  });
});

describe("DELETE /api/foods/:id", () => {
  test("removes the food from every cart with $pull", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const foodId = new mongoose.Types.ObjectId();
    jest.spyOn(Food, "findByIdAndDelete").mockResolvedValue({ _id: foodId });
    const updateMany = jest.spyOn(Cart, "updateMany").mockResolvedValue({ modifiedCount: 4 });

    const res = await agent.delete(`/api/foods/${foodId}`);

    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith(
      { "items.food": foodId },
      { $pull: { items: { food: foodId } } }
    );
  });

  test("deleting an unknown food does not touch carts", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    jest.spyOn(Food, "findByIdAndDelete").mockResolvedValue(null);
    const updateMany = jest.spyOn(Cart, "updateMany");
    const res = await agent.delete(`/api/foods/${newId()}`);
    expect(res.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
