// Batch 4 — PUT /api/admin/users/:id/reactivate (undo a deactivation)
// DB-free: the User model is mocked, so this proves WHICH query the controller issues and how every
// outcome is answered. tests/integration/integrity.test.js proves the real database behaviour.

const mongoose = require("mongoose");
const app = require("../../server");
const User = require("../../models/User");
const logger = require("../../utils/logger");
const { newAgent } = require("../helpers/client");
const { loginAs, newId } = require("../helpers/auth");

const URL = (id) => `/api/admin/users/${id}/reactivate`;

// What findOneAndUpdate resolves with: the reactivated document (with a password hash that must never leave the server)
const reactivated = (id, role = "customer") => ({
  _id: new mongoose.Types.ObjectId(id),
  name: "Meena",
  email: "meena@example.com",
  role,
  isActive: true,
  password: "$2a$10$hash-that-must-never-be-sent",
  toObject() {
    return { _id: this._id, name: this.name, email: this.email, role: this.role, isActive: this.isActive, password: this.password };
  },
});

describe("PUT /api/admin/users/:id/reactivate — success", () => {
  let admin, targetId;
  beforeEach(async () => {
    admin = await loginAs(app, { role: "admin" });
    targetId = newId();
  });

  test("a deactivated user is reactivated: 200, envelope, message, user returned WITHOUT the password", async () => {
    jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(reactivated(targetId));

    const res = await admin.agent.put(URL(targetId));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("User reactivated. They can log in again.");
    expect(res.body.data).toMatchObject({ _id: targetId, name: "Meena", isActive: true });
    expect(res.body.data.password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/hash-that-must-never/);
  });

  test("ATOMIC: only a user who is currently isActive:false matches, and the ONLY change is isActive:true", async () => {
    const update = jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(reactivated(targetId));

    await admin.agent.put(URL(targetId));

    expect(update).toHaveBeenCalledTimes(1);
    const [filter, change] = update.mock.calls[0];
    expect(filter).toEqual({ _id: targetId, isActive: false }); // never touches an active account
    expect(change).toEqual({ $set: { isActive: true } });       // nothing else can change
  });

  test("the request body is ignored: role / password / isActive in the body cannot change anything", async () => {
    const update = jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(reactivated(targetId));

    const res = await admin.agent.put(URL(targetId)).send({ role: "admin", password: "hacked1", isActive: false, name: "Evil" });

    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0]).toEqual({ _id: targetId, isActive: false });
    expect(update.mock.calls[0][1]).toEqual({ $set: { isActive: true } });
  });

  test("a reactivated ADMIN keeps the admin role (the role is never read or written)", async () => {
    jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(reactivated(targetId, "admin"));
    const res = await admin.agent.put(URL(targetId));
    expect(res.body.data.role).toBe("admin");
  });

  test("it is logged with the acting admin and the target user (audit trail)", async () => {
    jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(reactivated(targetId));
    await admin.agent.put(URL(targetId));
    expect(logger.info).toHaveBeenCalledWith(`Admin ${admin.userId} reactivated user ${targetId}`);
  });

  test("it does NOT restore sessions or the cart (nothing but the user update is issued)", async () => {
    const collection = jest.spyOn(mongoose.connection, "collection");
    jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(reactivated(targetId));
    const Cart = require("../../models/Cart");
    const cartWrites = [jest.spyOn(Cart, "updateOne"), jest.spyOn(Cart, "findOneAndUpdate"), jest.spyOn(Cart, "create")];

    await admin.agent.put(URL(targetId));

    expect(collection).not.toHaveBeenCalledWith("sessions");
    cartWrites.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe("PUT /api/admin/users/:id/reactivate — refusals", () => {
  let admin, targetId;
  beforeEach(async () => {
    admin = await loginAs(app, { role: "admin" });
    targetId = newId();
  });

  test("no such user → 404 (nothing matched and the user does not exist)", async () => {
    jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(null);
    const exists = jest.spyOn(User, "exists").mockResolvedValue(null);

    const res = await admin.agent.put(URL(targetId));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, message: "User not found" });
    expect(exists).toHaveBeenCalledWith({ _id: targetId });
  });

  test("already active (nothing matched but the user exists) → 409, and no second write", async () => {
    const update = jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(null);
    jest.spyOn(User, "exists").mockResolvedValue({ _id: targetId });
    const updateOne = jest.spyOn(User, "updateOne");

    const res = await admin.agent.put(URL(targetId));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, message: "This account is already active" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateOne).not.toHaveBeenCalled();
  });

  test("a legacy user with no isActive field counts as active → 409 (the filter is strictly isActive:false)", async () => {
    // Mongo does not match {isActive:false} against a missing field, so the controller sees "nothing matched".
    const update = jest.spyOn(User, "findOneAndUpdate").mockResolvedValue(null);
    jest.spyOn(User, "exists").mockResolvedValue({ _id: targetId });
    const res = await admin.agent.put(URL(targetId));
    expect(res.status).toBe(409);
    expect(update.mock.calls[0][0].isActive).toBe(false);
  });

  test("malformed id → 400 before any database call", async () => {
    const update = jest.spyOn(User, "findOneAndUpdate");
    const exists = jest.spyOn(User, "exists");

    const res = await admin.agent.put(URL("not-an-object-id"));

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  test("a database error goes to the central error handler: 500 in the standard envelope, no stack trace, nothing written twice", async () => {
    const update = jest.spyOn(User, "findOneAndUpdate").mockRejectedValue(new Error("connection reset"));
    const res = await admin.agent.put(URL(targetId));
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.stack).toBeUndefined(); // stacks are development-only
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("PUT /api/admin/users/:id/reactivate — protections", () => {
  test("a CUSTOMER is refused 403 and nothing is read or written", async () => {
    const { agent } = await loginAs(app, { role: "customer" });
    const update = jest.spyOn(User, "findOneAndUpdate");
    const exists = jest.spyOn(User, "exists");

    const res = await agent.put(URL(newId()));

    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  test("an anonymous visitor (valid CSRF token, no login) → 401", async () => {
    const update = jest.spyOn(User, "findOneAndUpdate");
    const agent = await newAgent(app);

    const res = await agent.put(URL(newId()));

    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  test("an admin WITHOUT a valid CSRF token → 403 and nothing is written", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const update = jest.spyOn(User, "findOneAndUpdate");

    const res = await agent.put(URL(newId())).set("X-CSRF-Token", "forged-token");

    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  test("a demoted admin (session still says admin, database says customer) is refused immediately", async () => {
    const { agent, user } = await loginAs(app, { role: "admin" });
    user.role = "customer"; // an admin demoted them after they logged in
    const update = jest.spyOn(User, "findOneAndUpdate");

    const res = await agent.put(URL(newId()));

    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  test("the route exists only as PUT (GET / POST / DELETE on it are not reactivation)", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const update = jest.spyOn(User, "findOneAndUpdate");

    const res = await agent.post(URL(newId()));

    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});
