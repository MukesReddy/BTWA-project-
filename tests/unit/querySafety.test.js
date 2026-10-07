// P1.8 — query safety: query-string input must never change the SHAPE of a MongoDB filter, regex
// input is matched literally, and malformed values are 400s. (Mongoose is mocked here so we can
// assert the exact filter that reaches the database; tests/integration/security.test.js runs the
// same inputs against a real MongoDB.)

const app = require("../../server");
const Food = require("../../models/Food");
const User = require("../../models/User");
const Order = require("../../models/Order");
const Category = require("../../models/Category");
const { query } = require("../helpers/chain");
const { loginAs } = require("../helpers/auth");
const { newAgent, anonymous } = require("../helpers/client");
const { escapeRegex } = require("../../utils/helpers");

const lastFilter = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0];

describe("escapeRegex", () => {
  const SPECIAL = ".*+?^${}()|[]\\/-";

  test("every regex metacharacter is escaped, so the text only matches itself", () => {
    for (const ch of SPECIAL) {
      const re = new RegExp(`^${escapeRegex(ch)}$`);
      expect(re.test(ch)).toBe(true);
      expect(re.test("a")).toBe(false);
    }
  });

  test("hostile patterns become ordinary text", () => {
    for (const text of [".*", "(", "[a-", "C++", "a|b", "(a+)+$", "^$", "\\", "x{1,}", "?"]) {
      expect(() => new RegExp(escapeRegex(text), "i")).not.toThrow();
      expect(new RegExp(`^${escapeRegex(text)}$`, "i").test(text)).toBe(true);
    }
    expect(new RegExp(escapeRegex(".*"), "i").test("Veg Burger")).toBe(false); // not a wildcard any more
  });

  test("a catastrophic-backtracking pattern cannot freeze the regex engine once escaped", () => {
    const victim = "a".repeat(40) + "!";
    const started = Date.now();
    new RegExp(escapeRegex("(a+)+$"), "i").test(victim);
    expect(Date.now() - started).toBeLessThan(100);
  });

  test("non-string input is stringified, never throws", () => {
    expect(escapeRegex(123)).toBe("123");
    expect(escapeRegex(undefined)).toBe("undefined");
  });
});

describe("GET /api/foods — menu search and filters", () => {
  let find;
  beforeEach(() => {
    find = jest.spyOn(Food, "find").mockReturnValue(query([]));
    jest.spyOn(Food, "countDocuments").mockResolvedValue(0);
  });
  const get = async (qs) => (await anonymous(app)).get(`/api/foods${qs}`);

  test("search text is escaped before it reaches $regex (names like 'C++' work)", async () => {
    const res = await get(`?search=${encodeURIComponent("C++ (a+)+$ .*")}`);
    expect(res.status).toBe(200);
    const [nameClause, descClause] = lastFilter(find).$or;
    expect(nameClause.name.$regex).toBe(escapeRegex("C++ (a+)+$ .*"));
    expect(descClause.description.$regex).toBe(escapeRegex("C++ (a+)+$ .*"));
    expect(new RegExp(nameClause.name.$regex, "i").test("Veg Burger")).toBe(false);
  });

  test("NoSQL operator injection through brackets never becomes a filter operator", async () => {
    const res = await get("?category[$ne]=x&search[$regex]=.*&minPrice[$gt]=0&available[$ne]=true");
    expect(res.status).toBe(200);
    expect(lastFilter(find)).toEqual({}); // none of those keys means anything
    expect(JSON.stringify(lastFilter(find))).not.toMatch(/\$ne|\$gt|\$regex/);
  });

  test.each([
    ["search given twice (array)", "?search=a&search=b"],
    ["search too long", `?search=${"x".repeat(101)}`],
    ["category given twice", "?category=507f1f77bcf86cd799439011&category=507f1f77bcf86cd799439012"],
    ["category is not an id", "?category=not-an-id"],
    ["minPrice not a number", "?minPrice=abc"],
    ["negative minPrice", "?minPrice=-5"],
    ["maxPrice not a number", "?maxPrice=1e999x"],
    ["unknown sort", "?sort=__proto__"],
    ["available not boolean", "?available=maybe"],
    ["page not a number", "?page=abc"],
    ["page zero", "?page=0"],
    ["page negative", "?page=-3"],
    ["page decimal", "?page=1.5"],
    ["limit not a number", "?limit=lots"],
    ["limit zero", "?limit=0"],
  ])("invalid input is a clean 400, not a 500 (%s)", async (_label, qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(find).not.toHaveBeenCalled(); // rejected before touching the database
  });

  test("valid combinations still work and keep their meaning", async () => {
    const res = await get("?search=burger&category=507f1f77bcf86cd799439011&minPrice=50&maxPrice=300&available=true&sort=price_asc&page=2&limit=5");
    expect(res.status).toBe(200);
    const filter = lastFilter(find);
    expect(filter.category).toBe("507f1f77bcf86cd799439011");
    expect(filter.price).toEqual({ $gte: 50, $lte: 300 });
    expect(filter.available).toBe(true);
    expect(res.body.data.pagination).toMatchObject({ page: 2, limit: 5 });
  });

  test("empty values (what the menu page's cleared filters send) are ignored, not errors", async () => {
    const res = await get("?search=&category=&minPrice=&maxPrice=&available=&sort=");
    expect(res.status).toBe(200);
    expect(lastFilter(find)).toEqual({});
  });

  test("a huge page size is still capped at 50", async () => {
    const res = await get("?limit=1000");
    expect(res.status).toBe(200);
    expect(res.body.data.pagination.limit).toBe(50);
  });
});

describe("GET /api/admin/users and /api/admin/orders", () => {
  let admin;
  beforeEach(async () => {
    admin = await loginAs(app, { role: "admin" });
  });

  test("user search is escaped: '.' is a dot, not 'any character'", async () => {
    const find = jest.spyOn(User, "find").mockReturnValue(query([]));
    const res = await admin.agent.get(`/api/admin/users?search=${encodeURIComponent("a.b(")}`);
    expect(res.status).toBe(200);
    const [byName, byEmail] = lastFilter(find).$or;
    expect(byName.name.$regex).toBe("a\\.b\\(");
    expect(byEmail.email.$regex).toBe("a\\.b\\(");
  });

  test.each([
    ["role not allowed", "?role=superuser"],
    ["role twice", "?role=admin&role=customer"],
    ["search twice", "?search=a&search=b"],
    ["search too long", `?search=${"x".repeat(101)}`],
  ])("users: %s → 400", async (_label, qs) => {
    const find = jest.spyOn(User, "find").mockReturnValue(query([]));
    const res = await admin.agent.get(`/api/admin/users${qs}`);
    expect(res.status).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  test("users: valid role filter is applied; operator injection is ignored", async () => {
    const find = jest.spyOn(User, "find").mockReturnValue(query([]));
    expect((await admin.agent.get("/api/admin/users?role=customer")).status).toBe(200);
    expect(lastFilter(find)).toEqual({ role: "customer" });
    expect((await admin.agent.get("/api/admin/users?role[$ne]=admin")).status).toBe(200);
    expect(lastFilter(find)).toEqual({});
  });

  const ordersFind = () => {
    const chain = { sort: jest.fn(() => chain), skip: jest.fn(() => chain), limit: jest.fn(() => chain), populate: jest.fn(() => Promise.resolve([])) };
    const find = jest.spyOn(Order, "find").mockReturnValue(chain);
    jest.spyOn(Order, "countDocuments").mockResolvedValue(0);
    return { find, chain };
  };

  test.each([
    ["unknown status", "?status=Hacked"],
    ["operator-looking status", "?status=%24ne"],
    ["status twice", "?status=Pending&status=Delivered"],
    ["page abc", "?page=abc"],
    ["page 0", "?page=0"],
    ["limit -1", "?limit=-1"],
  ])("orders: %s → 400", async (_label, qs) => {
    const { find } = ordersFind();
    const res = await admin.agent.get(`/api/admin/orders${qs}`);
    expect(res.status).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  test("orders: valid status filter + pagination; page size capped at 100", async () => {
    const { find, chain } = ordersFind();
    const res = await admin.agent.get("/api/admin/orders?status=Out%20for%20Delivery&page=3&limit=1000");
    expect(res.status).toBe(200);
    expect(lastFilter(find)).toEqual({ orderStatus: "Out for Delivery" });
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(chain.skip).toHaveBeenCalledWith(200); // (3-1) * 100
  });

  test("orders: defaults (no params) are page 1, 20 per page", async () => {
    const { chain } = ordersFind();
    const res = await admin.agent.get("/api/admin/orders");
    expect(res.status).toBe(200);
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(res.body.data.pagination).toMatchObject({ page: 1 });
  });

  test("these endpoints are still admin-only", async () => {
    const customer = await loginAs(app, { role: "customer" });
    expect((await customer.agent.get("/api/admin/users?search=a")).status).toBe(403);
    expect((await customer.agent.get("/api/admin/orders")).status).toBe(403);
  });
});

describe("POST /api/categories — duplicate-name check", () => {
  test("the name is escaped: '(' no longer builds an invalid regex (was a 500) and '.*' no longer matches everything", async () => {
    const admin = await loginAs(app, { role: "admin" });
    const findOne = jest.spyOn(Category, "findOne").mockResolvedValue(null);
    jest.spyOn(Category, "create").mockImplementation(async (doc) => ({ ...doc, _id: "c1" }));

    for (const name of ["(", ".*", "Rolls (Veg)", "C++"]) {
      const res = await admin.agent.post("/api/categories").send({ name });
      expect(res.status).toBe(201);
      const { $regex } = findOne.mock.calls[findOne.mock.calls.length - 1][0].name;
      expect($regex.source).toBe(`^${escapeRegex(name)}$`);
      expect($regex.test(name)).toBe(true);
      expect($regex.test("Pizza")).toBe(false);
    }
  });
});

void newAgent;
