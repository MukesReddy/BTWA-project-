// tests/helpers/factories.js — create real documents + logged-in supertest agents (integration tests)

const { newAgent, refreshCsrf } = require("./client");
const User = require("../../models/User");
const Category = require("../../models/Category");
const Food = require("../../models/Food");

let counter = 0;
const PASSWORD = "secret12";

const createUser = async (overrides = {}) => {
  counter += 1;
  return User.create({
    name: `Test User ${counter}`,
    email: `user${counter}@example.com`,
    password: PASSWORD, // hashed by the model's pre-save hook
    role: "customer",
    ...overrides,
  });
};

const createCategory = (overrides = {}) => {
  counter += 1;
  return Category.create({ name: `Category ${counter}`, ...overrides });
};

const createFood = async (overrides = {}) => {
  const category = overrides.category || (await createCategory())._id;
  counter += 1;
  return Food.create({ name: `Food ${counter}`, price: 100, category, ...overrides });
};

/** Log in through the real API; returns a supertest agent holding the session cookie + CSRF token. */
const loginAgent = async (app, user) => {
  const agent = await newAgent(app);
  const res = await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  await refreshCsrf(agent); // the session id (and so the token) changed at login
  return agent;
};

const ADDRESS = { street: "12 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" };
const ORDER_BODY = { deliveryAddress: ADDRESS, paymentMethod: "Cash on Delivery" };

module.exports = { createUser, createCategory, createFood, loginAgent, PASSWORD, ADDRESS, ORDER_BODY };
