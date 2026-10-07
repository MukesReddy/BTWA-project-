// tests/helpers/auth.js
// Log in through the REAL /api/auth/login route (session middleware, validation,
// controller) with the User model mocked, and return a supertest agent that keeps the cookie.

const request = require("supertest");
const mongoose = require("mongoose");
const User = require("../../models/User");
const { query } = require("./chain");

const newId = () => new mongoose.Types.ObjectId().toString();

const fakeUser = ({ id = newId(), role = "customer", name = "Test User", isActive = true } = {}) => ({
  _id: new mongoose.Types.ObjectId(id),
  name,
  email: `${role}@example.com`,
  role,
  isActive,
  comparePassword: async () => true,
  toObject() {
    return { _id: this._id, name: this.name, email: this.email, role: this.role, isActive: this.isActive };
  },
});

/**
 * @returns {Promise<{agent, userId}>}
 */
const loginAs = async (app, options = {}) => {
  const user = fakeUser(options);
  const spy = jest.spyOn(User, "findOne").mockReturnValue(query(user));
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email: user.email, password: "secret12" });
  spy.mockRestore();
  if (res.status !== 200) {
    throw new Error(`loginAs failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { agent, userId: user._id.toString() };
};

module.exports = { loginAs, fakeUser, newId };
