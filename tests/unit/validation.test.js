// P1.12 — complete input validation.   (DB-free: models are mocked)

const request = require("supertest");
const app = require("../../server");
const User = require("../../models/User");
const Food = require("../../models/Food");
const Category = require("../../models/Category");
const { query } = require("../helpers/chain");
const { newAgent } = require("../helpers/client");
const { loginAs, newId } = require("../helpers/auth");

const fields = (res) => (res.body.errors || []).map((e) => e.field);

describe("POST /api/auth/register", () => {
  const valid = { name: "Asha Rao", email: "asha@example.com", password: "secret12" };

  const expectRejected = async (payload, field) => {
    const res = await (await newAgent(app)).post("/api/auth/register").send(payload);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe("string"); // old consumers still read `message`
    expect(fields(res)).toContain(field);
    expect(User.create).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.spyOn(User, "findOne").mockReturnValue(query(null));
    jest.spyOn(User, "create").mockResolvedValue({ _id: newId(), email: valid.email, role: "customer" });
  });

  test("valid payload is accepted", async () => {
    const res = await (await newAgent(app)).post("/api/auth/register").send(valid);
    expect(res.status).toBe(201);
  });

  test("empty body lists every missing field", async () => {
    const res = await (await newAgent(app)).post("/api/auth/register").send({});
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(expect.arrayContaining(["name", "email", "password"]));
  });

  test("name: too short / too long / angle brackets / not a string", async () => {
    await expectRejected({ ...valid, name: "A" }, "name");
    await expectRejected({ ...valid, name: "x".repeat(61) }, "name");
    await expectRejected({ ...valid, name: "<img src=x onerror=alert(1)>" }, "name");
    await expectRejected({ ...valid, name: { $gt: "" } }, "name");
    await expectRejected({ ...valid, name: ["a", "b"] }, "name");
  });

  test("email: invalid, too long, object (operator injection)", async () => {
    await expectRejected({ ...valid, email: "not-an-email" }, "email");
    await expectRejected({ ...valid, email: `${"a".repeat(250)}@example.com` }, "email");
    await expectRejected({ ...valid, email: { $ne: "" } }, "email");
  });

  test("password: too short / longer than bcrypt's 72 bytes / not a string", async () => {
    await expectRejected({ ...valid, password: "12345" }, "password");
    await expectRejected({ ...valid, password: "p".repeat(73) }, "password");
    await expectRejected({ ...valid, password: 123456 }, "password");
  });

  test("phone and address are validated when present", async () => {
    await expectRejected({ ...valid, phone: "abc" }, "phone");
    await expectRejected({ ...valid, address: { pincode: "12" } }, "address.pincode");
    await expectRejected({ ...valid, address: "somewhere" }, "address");
    const ok = await (await newAgent(app))
      .post("/api/auth/register")
      .send({ ...valid, phone: "9876543210", address: { street: "1 Main St", city: "Hyderabad", state: "TS", pincode: "500001" } });
    expect(ok.status).toBe(201);
  });
});

describe("POST /api/auth/login", () => {
  test.each([
    [{ email: { $gt: "" }, password: "x" }, "email"],
    [{ email: "a@b.co", password: { $gt: "" } }, "password"],
    [{ email: "a@b.co" }, "password"],
    [{ password: "x" }, "email"],
  ])("%j is rejected", async (payload, field) => {
    const res = await (await newAgent(app)).post("/api/auth/login").send(payload);
    expect(res.status).toBe(400);
    expect(fields(res)).toContain(field);
  });
});

describe("food validation (admin)", () => {
  const catId = newId();
  const valid = { name: "Paneer Tikka", price: 199, category: catId };
  let agent;

  beforeEach(async () => {
    ({ agent } = await loginAs(app, { role: "admin" }));
    jest.spyOn(Category, "exists").mockResolvedValue({ _id: catId });
    jest.spyOn(Food, "create").mockImplementation(async (doc) => ({ ...doc, populate: async () => {} }));
  });

  const expectRejected = async (payload, field) => {
    const res = await agent.post("/api/foods").send(payload);
    expect(res.status).toBe(400);
    expect(fields(res)).toContain(field);
    expect(Food.create).not.toHaveBeenCalled();
  };

  test("valid food is created; rating 0 is kept (not replaced by the 4.0 default)", async () => {
    const res = await agent.post("/api/foods").send({ ...valid, rating: 0, available: false, ingredients: ["paneer", "spices"], image: "https://example.com/a.jpg?w=400" });
    expect(res.status).toBe(201);
    expect(Food.create.mock.calls[0][0]).toMatchObject({ rating: 0, available: false, price: 199 });
  });

  test("omitted rating defaults to 4.0", async () => {
    await agent.post("/api/foods").send(valid);
    expect(Food.create.mock.calls[0][0].rating).toBe(4);
  });

  test("price: negative, text, absurdly large", async () => {
    await expectRejected({ ...valid, price: -1 }, "price");
    await expectRejected({ ...valid, price: "abc" }, "price");
    await expectRejected({ ...valid, price: 1e9 }, "price");
  });

  test("name: missing / too long / object", async () => {
    await expectRejected({ ...valid, name: "" }, "name");
    await expectRejected({ ...valid, name: "x".repeat(101) }, "name");
    await expectRejected({ ...valid, name: { a: 1 } }, "name");
  });

  test("category: not an id, or an id that does not exist", async () => {
    await expectRejected({ ...valid, category: "burgers" }, "category");
    Category.exists.mockResolvedValue(null);
    await expectRejected({ ...valid, category: newId() }, "category");
  });

  test("image must be an http(s) URL", async () => {
    await expectRejected({ ...valid, image: "javascript:alert(1)" }, "image");
    await expectRejected({ ...valid, image: "not a url" }, "image");
  });

  test("ingredients, rating, available types", async () => {
    await expectRejected({ ...valid, ingredients: "cheese" }, "ingredients");
    await expectRejected({ ...valid, ingredients: [1, 2] }, "ingredients[0]");
    await expectRejected({ ...valid, rating: 6 }, "rating");
    await expectRejected({ ...valid, rating: "NaN" }, "rating");
    await expectRejected({ ...valid, available: "maybe" }, "available");
  });

  test("numbers/booleans cannot be smuggled in as arrays", async () => {
    await expectRejected({ ...valid, price: [5] }, "price");
    await expectRejected({ ...valid, rating: [3] }, "rating");
    await expectRejected({ ...valid, available: [true] }, "available");
  });

  test("description too long", async () => {
    await expectRejected({ ...valid, description: "d".repeat(1001) }, "description");
  });
});

describe("category validation (admin)", () => {
  test.each([
    [{}, "name"],
    [{ name: "x".repeat(51) }, "name"],
    [{ name: { $ne: 1 } }, "name"],
    [{ name: "Pizza", description: "d".repeat(301) }, "description"],
    [{ name: "Pizza", image: "ftp://x.com/a.png" }, "image"],
  ])("%j is rejected", async (payload, field) => {
    const { agent } = await loginAs(app, { role: "admin" });
    const res = await agent.post("/api/categories").send(payload);
    expect(res.status).toBe(400);
    expect(fields(res)).toContain(field);
  });
});

describe("cart quantity validation", () => {
  const foodId = newId();

  test.each([
    [0], [-3], [21], [1.5], ["abc"], [null], [[1]], [[1, 2]], [{ $gt: 0 }],
  ])("POST quantity %j is rejected", async (quantity) => {
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/cart").send({ foodId, quantity });
    expect(res.status).toBe(400);
    expect(fields(res)).toContain("quantity");
  });

  test("quantity is required", async () => {
    const { agent } = await loginAs(app);
    const res = await agent.post("/api/cart").send({ foodId });
    expect(res.status).toBe(400);
  });

  test("foodId must be a valid id and a string", async () => {
    const { agent } = await loginAs(app);
    const a = await agent.post("/api/cart").send({ foodId: "nope", quantity: 1 });
    const b = await agent.post("/api/cart").send({ foodId: { $ne: null }, quantity: 1 });
    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(fields(a)).toContain("foodId");
    expect(fields(b)).toContain("foodId");
  });

  test.each([[0], [21], [2.5], ["x"]])("PUT quantity %j is rejected", async (quantity) => {
    const { agent } = await loginAs(app);
    const res = await agent.put(`/api/cart/${foodId}`).send({ quantity });
    expect(res.status).toBe(400);
  });
});

describe("order (checkout) validation", () => {
  const address = { street: "12 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" };
  const post = async (payload) => {
    const { agent } = await loginAs(app);
    return agent.post("/api/orders").send(payload);
  };

  test.each([
    [{ paymentMethod: "Cash on Delivery" }, "deliveryAddress"],
    [{ deliveryAddress: { ...address, pincode: "12345" }, paymentMethod: "Cash on Delivery" }, "deliveryAddress.pincode"],
    [{ deliveryAddress: { ...address, pincode: "50000a" }, paymentMethod: "Cash on Delivery" }, "deliveryAddress.pincode"],
    [{ deliveryAddress: { ...address, street: "ab" }, paymentMethod: "Cash on Delivery" }, "deliveryAddress.street"],
    [{ deliveryAddress: { ...address, city: "c".repeat(61) }, paymentMethod: "Cash on Delivery" }, "deliveryAddress.city"],
    [{ deliveryAddress: { ...address, state: { a: 1 } }, paymentMethod: "Cash on Delivery" }, "deliveryAddress.state"],
    [{ deliveryAddress: address, paymentMethod: "Bitcoin" }, "paymentMethod"],
    [{ deliveryAddress: address }, "paymentMethod"],
  ])("%j is rejected", async (payload, field) => {
    const res = await post(payload);
    expect(res.status).toBe(400);
    expect(fields(res)).toContain(field);
  });
});

describe("PUT /api/users/profile validation", () => {
  const bodyOf = (call) => call[1];

  test.each([
    [{ name: "<b>x</b>" }, "name"],
    [{ name: "A" }, "name"],
    [{ phone: "12" }, "phone"],
    [{ address: { pincode: "abc" } }, "address.pincode"],
    [{ address: { street: "s".repeat(201) } }, "address.street"],
  ])("%j is rejected", async (payload, field) => {
    const { agent } = await loginAs(app);
    const res = await agent.put("/api/users/profile").send(payload);
    expect(res.status).toBe(400);
    expect(fields(res)).toContain(field);
  });

  test("an empty phone is allowed and is passed through, so the phone can be cleared", async () => {
    const { agent } = await loginAs(app);
    const spy = jest.spyOn(User, "findByIdAndUpdate").mockResolvedValue({
      name: "Test User", toObject() { return { name: "Test User", phone: "" }; },
    });
    const res = await agent.put("/api/users/profile").send({ phone: "" });
    expect(res.status).toBe(200);
    expect(bodyOf(spy.mock.calls[0])).toEqual({ phone: "" });
  });

  test("only whitelisted address keys are stored", async () => {
    const { agent } = await loginAs(app);
    const spy = jest.spyOn(User, "findByIdAndUpdate").mockResolvedValue({
      name: "Test User", toObject() { return {}; },
    });
    await agent.put("/api/users/profile").send({ address: { street: "1 Main St", city: "Pune", state: "MH", pincode: "411001", role: "admin" }, role: "admin" });
    const update = bodyOf(spy.mock.calls[0]);
    expect(update).not.toHaveProperty("role");
    expect(Object.keys(update.address).sort()).toEqual(["city", "pincode", "state", "street"]);
  });

  test("the session name follows a name change", async () => {
    const { agent } = await loginAs(app);
    jest.spyOn(User, "findByIdAndUpdate").mockResolvedValue({
      name: "New Name", toObject() { return { name: "New Name" }; },
    });
    const res = await agent.put("/api/users/profile").send({ name: "New Name" });
    expect(res.status).toBe(200);
  });
});
