// tests/helpers/auth.js
// Log in through the REAL /api/auth/login route (CSRF check, session middleware, validation,
// controller) with the User model mocked, and return a supertest agent that keeps the cookie
// and sends the CSRF token like the real frontend.
//
// The mocked User.findOne also answers the per-request account check in isAuthenticated
// (middleware/authMiddleware.js), looked up by the logged-in user's id. A test can simulate an
// admin deactivating / demoting / deleting the account by changing the returned `user` object:
//     user.isActive = false;      user.role = "customer";      removeSessionUser(user);

const mongoose = require("mongoose");
const User = require("../../models/User");
const { query } = require("./chain");
const { newAgent, refreshCsrf } = require("./client");

const newId = () => new mongoose.Types.ObjectId().toString();

const fakeUser = ({ id = newId(), role = "customer", name = "Test User", isActive = true } = {}) => ({
  _id: new mongoose.Types.ObjectId(id),
  name,
  email: `${role}-${id}@example.com`,
  role,
  isActive,
  comparePassword: async () => true,
  toObject() {
    return { _id: this._id, name: this.name, email: this.email, role: this.role, isActive: this.isActive };
  },
});

// Users that currently exist in the "database", by id and by email (restoreMocks resets the spy per test).
const byId = new Map();
const byEmail = new Map();

const installUserLookup = () => {
  const existing = jest.isMockFunction(User.findOne) ? User.findOne : jest.spyOn(User, "findOne");
  existing.mockImplementation((filter = {}) => {
    if (filter._id !== undefined) return query(byId.get(String(filter._id)) || null); // isAuthenticated
    if (typeof filter.email === "string") return query(byEmail.get(filter.email) || null); // login
    return query(null);
  });
};

/** Simulates the account being deleted from the database. */
const removeSessionUser = (user) => {
  byId.delete(String(user._id));
  byEmail.delete(user.email);
};

/**
 * @returns {Promise<{agent, userId, user}>}
 */
const loginAs = async (app, options = {}) => {
  const user = fakeUser(options);
  byId.set(String(user._id), user);
  byEmail.set(user.email, user);
  installUserLookup();

  const agent = await newAgent(app); // already holds a CSRF token (login needs one too)
  const res = await agent.post("/api/auth/login").send({ email: user.email, password: "secret12" });
  if (res.status !== 200) {
    throw new Error(`loginAs failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  await refreshCsrf(agent); // login replaced the session, so the old token is dead
  return { agent, userId: user._id.toString(), user };
};

module.exports = { loginAs, fakeUser, newId, removeSessionUser };
