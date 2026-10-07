// P1.7 — central error handler + ObjectId validation.   (DB-free: models are mocked)

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../../server");
const Food = require("../../models/Food");
const Category = require("../../models/Category");
const Order = require("../../models/Order");
const { query } = require("../helpers/chain");
const { loginAs, newId } = require("../helpers/auth");
const { errorHandler } = require("../../middleware/errorMiddleware");
const logger = require("../../utils/logger");

const BAD_IDS = ["abc", "123", "undefined", "zzzzzzzzzzzzzzzzzzzzzzzz", "5f8d0d55b54764421b7156c"]; // last one is 23 chars

describe("invalid ObjectIds return 400 (never 500)", () => {
  test.each(BAD_IDS)("GET /api/foods/%s", async (id) => {
    const res = await request(app).get(`/api/foods/${id}`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect(res.body.message).toMatch(/not a valid ID/i);
  });

  test("GET /api/categories/:id", async () => {
    const res = await request(app).get("/api/categories/not-an-id");
    expect(res.status).toBe(400);
  });

  test("a well-formed but unknown id is a 404, not a 400/500", async () => {
    jest.spyOn(Food, "findById").mockReturnValue(query(null));
    const res = await request(app).get(`/api/foods/${newId()}`);
    expect(res.status).toBe(404);
  });

  test("auth runs BEFORE id validation (unauthenticated → 401)", async () => {
    const res = await request(app).get("/api/orders/not-an-id");
    expect(res.status).toBe(401);
  });

  test("GET /api/orders/:id (customer)", async () => {
    const { agent } = await loginAs(app);
    const res = await agent.get("/api/orders/not-an-id");
    expect(res.status).toBe(400);
  });

  test("admin routes: PUT status and DELETE user", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    const a = await agent.put("/api/admin/orders/xyz/status").send({ status: "Confirmed" });
    const b = await agent.delete("/api/admin/users/xyz");
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
  });

  test("admin routes stay 403 for customers even with a bad id", async () => {
    const { agent } = await loginAs(app);
    const res = await agent.delete("/api/admin/users/xyz");
    expect(res.status).toBe(403);
  });

  test("cart routes: PUT and DELETE /api/cart/:foodId", async () => {
    const { agent } = await loginAs(app);
    const put = await agent.put("/api/cart/xyz").send({ quantity: 2 });
    const del = await agent.delete("/api/cart/xyz");
    expect(put.status).toBe(400);
    expect(del.status).toBe(400);
  });
});

describe("error handler mapping", () => {
  test("malformed JSON body → 400 JSON", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Invalid JSON in request body" });
  });

  test("unknown route → 404 JSON", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test("Mongoose CastError thrown by a controller → 400", async () => {
    jest.spyOn(Food, "find").mockImplementation(() => {
      throw new mongoose.Error.CastError("ObjectId", "abc", "category");
    });
    const res = await request(app).get("/api/foods");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category/);
  });

  test("Mongoose ValidationError → 400 with per-field errors", async () => {
    const err = new mongoose.Error.ValidationError();
    err.addError("price", new mongoose.Error.ValidatorError({ path: "price", message: "Price must be positive" }));
    jest.spyOn(Food, "find").mockImplementation(() => { throw err; });
    const res = await request(app).get("/api/foods");
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "price", message: "Price must be positive" }]);
  });

  test("duplicate key (E11000) → 409", async () => {
    const err = Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyPattern: { email: 1 } });
    jest.spyOn(Category, "find").mockImplementation(() => { throw err; });
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/email/);
  });

  test("body too large → 413", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@b.co", password: "x".repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });

  describe("unknown errors → 500", () => {
    const original = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = original; });

    test("production hides internal details and the stack", async () => {
      process.env.NODE_ENV = "production";
      jest.spyOn(Food, "find").mockImplementation(() => { throw new Error("secret db password in message"); });
      const res = await request(app).get("/api/foods");
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, message: "Internal Server Error" });
      expect(logger.error).toHaveBeenCalled();
    });

    test("non-production keeps the message to help debugging", async () => {
      jest.spyOn(Food, "find").mockImplementation(() => { throw new Error("boom"); });
      const res = await request(app).get("/api/foods");
      expect(res.status).toBe(500);
      expect(res.body.message).toBe("boom");
    });
  });

  test("4xx errors are logged as warnings, not errors", async () => {
    await request(app).get("/api/nope");
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("delegates to Express when headers were already sent", () => {
    const next = jest.fn();
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
    const err = new Error("late");
    errorHandler(err, { method: "GET", originalUrl: "/x" }, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("getOrderById with a deleted owner does not crash", () => {
  const orderWithNoUser = () => ({ _id: newId(), user: null, items: [] });

  test("customer gets 403, not 500", async () => {
    const { agent } = await loginAs(app);
    jest.spyOn(Order, "findById").mockReturnValue(query(orderWithNoUser()));
    const res = await agent.get(`/api/orders/${newId()}`);
    expect(res.status).toBe(403);
  });

  test("admin can still read it", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    jest.spyOn(Order, "findById").mockReturnValue(query(orderWithNoUser()));
    const res = await agent.get(`/api/orders/${newId()}`);
    expect(res.status).toBe(200);
  });
});
