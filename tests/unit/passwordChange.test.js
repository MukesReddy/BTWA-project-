// Batch 5 — PUT /api/users/password (change your own password)
// DB-free: the User model and the session collection are mocked, so this proves WHICH operations run, in
// which order, and how every outcome is answered. tests/integration/accountSecurity.test.js proves the real
// behaviour against MongoDB and the real connect-mongo session store.

const mongoose = require("mongoose");
const app = require("../../server");
const User = require("../../models/User");
const Cart = require("../../models/Cart");
const logger = require("../../utils/logger");
const { query } = require("../helpers/chain");
const { newAgent, refreshCsrf, cookieHeader } = require("../helpers/client");
const { loginAs } = require("../helpers/auth");

const URL = "/api/users/password";
const CURRENT = "oldPass123";
const NEXT = "brandNew456";

/** The document findById(...).select("+password") resolves with. */
const accountDoc = (over = {}) => {
  const doc = {
    _id: null, // filled in by the test (must equal the logged-in user's id)
    name: "Asha Rao",
    role: "customer",
    password: "$2a$10$stored-hash-of-the-current-password",
    comparePassword: jest.fn(async (candidate) => candidate === CURRENT),
    save: jest.fn(async () => doc),
    ...over,
  };
  return doc;
};

/** Mocks: the session collection (revokeUserSessions) and findById for the account. Returns the handles. */
const arrange = ({ userId, doc = accountDoc() }) => {
  doc._id = new mongoose.Types.ObjectId(userId);
  const findById = jest.spyOn(User, "findById").mockReturnValue(query(doc));
  const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 3 });
  const collection = jest.spyOn(mongoose.connection, "collection").mockReturnValue({ deleteMany });
  return { doc, findById, deleteMany, collection };
};

const change = (agent, body = { currentPassword: CURRENT, newPassword: NEXT }) => agent.put(URL).send(body);

describe("PUT /api/users/password — success", () => {
  let agent, userId;
  beforeEach(async () => {
    ({ agent, userId } = await loginAs(app, { role: "customer" }));
  });

  test("200 in the standard envelope; the response carries no data and neither password", async () => {
    arrange({ userId });
    const res = await change(agent);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Password changed. Other devices have been signed out." });
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${CURRENT}|${NEXT}`));
  });

  test("the CURRENT password is verified with bcrypt (comparePassword), and only then is the new one set and saved", async () => {
    const { doc, findById } = arrange({ userId });

    await change(agent);

    expect(findById).toHaveBeenCalledWith(userId);
    expect(doc.comparePassword).toHaveBeenCalledWith(CURRENT);
    expect(doc.password).toBe(NEXT); // the pre-save hook hashes it on save()
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(doc.save).toHaveBeenCalledWith({ validateModifiedOnly: true }); // an unrelated legacy field cannot block it
  });

  test("EVERY stored session of this user is revoked, AFTER the password was saved", async () => {
    const { doc, deleteMany, collection } = arrange({ userId });
    const order = [];
    doc.save.mockImplementation(async () => { order.push("save"); return doc; });
    deleteMany.mockImplementation(async () => { order.push("revoke"); return { deletedCount: 3 }; });

    await change(agent);

    expect(collection).toHaveBeenCalledWith("sessions");
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany.mock.calls[0][0]).toEqual({ session: { $regex: `"userId":"${userId}"` } }); // only THIS user's sessions
    expect(order).toEqual(["save", "revoke"]);
  });

  test("this device gets a NEW session id and stays logged in", async () => {
    arrange({ userId });
    jest.spyOn(Cart, "findOne").mockReturnValue(query(null));
    const before = cookieHeader(agent);

    const res = await change(agent);

    expect(res.headers["set-cookie"]).toBeDefined();
    expect(cookieHeader(agent)).not.toBe(before); // a different session id
    expect((await agent.get("/api/cart")).status).toBe(200); // still authenticated with the new session
  });

  test("the old CSRF token dies with the old session (a stale token is 403), a fresh one works", async () => {
    arrange({ userId });
    await change(agent);

    const stale = await agent.put("/api/users/profile").send({ name: "Asha R" });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("CSRF_TOKEN");

    await refreshCsrf(agent);
    jest.spyOn(User, "findByIdAndUpdate").mockResolvedValue({ name: "Asha R", toObject: () => ({ name: "Asha R" }) });
    expect((await agent.put("/api/users/profile").send({ name: "Asha R" })).status).toBe(200);
  });

  test("role is kept: an admin who changes the password is still an admin on the new session", async () => {
    const admin = await loginAs(app, { role: "admin" });
    arrange({ userId: admin.userId, doc: accountDoc({ role: "admin" }) });
    jest.spyOn(User, "find").mockReturnValue(query([]));

    expect((await change(admin.agent)).status).toBe(200);

    expect((await admin.agent.get("/api/admin/users")).status).toBe(200); // isAdmin still passes
  });

  test("the boundaries of the 6–72 rule are accepted (6 and 72 characters)", async () => {
    arrange({ userId });
    expect((await change(agent, { currentPassword: CURRENT, newPassword: "abcdef" })).status).toBe(200);
    await refreshCsrf(agent);
    expect((await change(agent, { currentPassword: CURRENT, newPassword: "x".repeat(72) })).status).toBe(200);
  });

  test("logged, but never with a password in it (ids only)", async () => {
    arrange({ userId });
    await change(agent);

    expect(logger.info).toHaveBeenCalledWith(`User ${userId} changed their password`);
    const everything = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(everything).not.toContain(CURRENT);
    expect(everything).not.toContain(NEXT);
  });
});

describe("PUT /api/users/password — refusals", () => {
  let agent, userId, user;
  beforeEach(async () => {
    ({ agent, userId, user } = await loginAs(app, { role: "customer" }));
  });

  test("WRONG current password → 400 (not 401); nothing saved, nothing revoked, password not logged", async () => {
    const { doc, deleteMany } = arrange({ userId });

    const res = await change(agent, { currentPassword: "not-the-password", newPassword: NEXT });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Current password is incorrect" });
    expect(doc.save).not.toHaveBeenCalled();
    expect(doc.password).not.toBe(NEXT);
    expect(deleteMany).not.toHaveBeenCalled();
    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(logged).not.toContain("not-the-password");
    expect(logged).not.toContain(NEXT);
  });

  test("a refused attempt leaves the session alone: still logged in, same CSRF token still valid", async () => {
    arrange({ userId });
    expect((await change(agent, { currentPassword: "wrong-one", newPassword: NEXT })).status).toBe(400);
    jest.spyOn(Cart, "findOne").mockReturnValue(query(null));
    expect((await agent.get("/api/cart")).status).toBe(200);
    expect((await change(agent, { currentPassword: "wrong-two", newPassword: NEXT })).status).toBe(400); // token still accepted
  });

  test("new password equal to the current one → 400 BEFORE any database work", async () => {
    const { findById, doc } = arrange({ userId });

    const res = await change(agent, { currentPassword: CURRENT, newPassword: CURRENT });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("New password must be different from the current password");
    expect(findById).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
  });

  test.each([
    ["too short (5)", "abcde", /between 6 and 72/],
    ["too long (73)", "x".repeat(73), /between 6 and 72/],
    ["empty", "", /required/i],
  ])("new password %s → 400 and no database work", async (_label, value, message) => {
    const { findById } = arrange({ userId });
    const res = await change(agent, { currentPassword: CURRENT, newPassword: value });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
    expect(findById).not.toHaveBeenCalled();
  });

  test.each([
    ["currentPassword missing", { newPassword: NEXT }],
    ["newPassword missing", { currentPassword: CURRENT }],
    ["both missing", {}],
    ["currentPassword empty", { currentPassword: "", newPassword: NEXT }],
    ["currentPassword is a number", { currentPassword: 123456, newPassword: NEXT }],
    ["newPassword is a number", { currentPassword: CURRENT, newPassword: 12345678 }],
    ["newPassword is an array", { currentPassword: CURRENT, newPassword: [NEXT] }],
    ["currentPassword is an array", { currentPassword: [CURRENT], newPassword: NEXT }],
    ["newPassword is an object (operator injection)", { currentPassword: CURRENT, newPassword: { $ne: "x" } }],
    ["currentPassword is an object (operator injection)", { currentPassword: { $ne: "x" }, newPassword: NEXT }],
    ["currentPassword longer than any possible password", { currentPassword: "y".repeat(73), newPassword: NEXT }],
  ])("%s → 400, never coerced, no database work", async (_label, body) => {
    const { findById, doc } = arrange({ userId });
    const res = await change(agent, body);
    expect(res.status).toBe(400);
    expect(findById).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("the account vanished between authentication and the handler → 404", async () => {
    const { deleteMany } = arrange({ userId });
    User.findById.mockReturnValue(query(null));
    const res = await change(agent);
    expect(res.status).toBe(404);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  test("a failed save is a clean 500 and sessions are NOT revoked (the password did not change)", async () => {
    const { doc, deleteMany } = arrange({ userId });
    doc.save.mockRejectedValue(new Error("write failed"));

    const res = await change(agent);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.stack).toBeUndefined();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  test("a DEACTIVATED account is refused by isAuthenticated (401) before anything runs", async () => {
    const { findById } = arrange({ userId });
    user.isActive = false;
    const res = await change(agent);
    expect(res.status).toBe(401);
    expect(findById).not.toHaveBeenCalled();
  });
});

describe("PUT /api/users/password — protections", () => {
  test("anonymous (valid CSRF token, no login) → 401", async () => {
    const findById = jest.spyOn(User, "findById");
    const res = await change(await newAgent(app));
    expect(res.status).toBe(401);
    expect(findById).not.toHaveBeenCalled();
  });

  test("a logged-in user WITHOUT a valid CSRF token → 403 and nothing happens", async () => {
    const { agent, userId } = await loginAs(app);
    const { doc, deleteMany } = arrange({ userId });

    const res = await change(agent).set("X-CSRF-Token", "forged");

    expect(res.status).toBe(403);
    expect(doc.comparePassword).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  test("a form-encoded body is refused (415): the endpoint speaks JSON only", async () => {
    const { agent, userId } = await loginAs(app);
    const { doc } = arrange({ userId });

    const res = await agent.put(URL).type("form").send(`currentPassword=${CURRENT}&newPassword=${NEXT}`);

    expect(res.status).toBe(415);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("the password is never taken from the query string or URL", async () => {
    const { agent, userId } = await loginAs(app);
    const { doc } = arrange({ userId });

    const res = await agent.put(`${URL}?currentPassword=${CURRENT}&newPassword=${NEXT}`).send({});

    expect(res.status).toBe(400);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("only PUT exists: GET and POST on the path do not change anything", async () => {
    const { agent, userId } = await loginAs(app);
    const { doc } = arrange({ userId });
    expect((await agent.post(URL).send({ currentPassword: CURRENT, newPassword: NEXT })).status).toBe(404);
    expect(doc.save).not.toHaveBeenCalled();
  });
});
