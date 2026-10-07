// P1.1 — XSS: hostile data must render as TEXT, and buttons must keep working
// when names contain quotes / apostrophes.
//
// How: the real pages run in jsdom (see tests/helpers/page.js); the API is a fixture
// stub, so hostile strings are injected exactly as if they were stored in the database
// (this bypasses the new server-side validation on purpose: old rows / direct DB writes
// must be safe too — defence in depth).
//
// What counts as an injection: the payload contains an <img data-xss …>. If any page
// still builds HTML from the raw string, an element with [data-xss] appears in the DOM.
// (jsdom does not load images, so we assert on DOM structure, not on onerror firing —
// which is also exactly what the browser parser does.)

const { startServer, stopServer, loadPage, waitFor, closePage, ok } = require("../helpers/page");

// contains " > < ' and an attribute-less <img> — breaks every unescaped context
const EVIL = `"><img/src=x/data-xss/onerror=window.__xss=1>'`;
const APOS = "O'Brien's \"Special\" Biryani";
const id = (n) => String(n).repeat(24).slice(0, 24);

const injected = (document) => document.querySelector("[data-xss]");
const textOf = (el) => el.textContent.replace(/\s+/g, " ").trim();

beforeAll(startServer);
afterAll(stopServer);

const customer = { _id: id(1), name: EVIL, email: "c@example.com", role: "customer", phone: "9876543210", address: { street: EVIL, city: EVIL, state: EVIL, pincode: "500001" } };
const admin = { ...customer, _id: id(2), role: "admin" };

const food = (n, over = {}) => ({
  _id: id(n), name: EVIL, description: EVIL, price: 100, rating: 4.5, available: true,
  image: EVIL, ingredients: [EVIL], category: { _id: id(9), name: EVIL }, ...over,
});

const toastText = (document) => document.querySelector(".toast-container")?.textContent || "";

describe("shared helpers in main.js", () => {
  let page;
  beforeAll(async () => { page = await loadPage("/index.html", { routes: { "GET /api/categories": [], "GET /api/foods": { foods: [], pagination: {} } } }); });
  afterAll(() => closePage(page.window));

  test("escapeHtml escapes & < > \" '", () => {
    expect(page.window.escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    expect(page.window.escapeHtml(null)).toBe("");
    expect(page.window.escapeHtml(0)).toBe("0");
  });

  test("showToast renders the message as text", () => {
    page.window.showToast(EVIL, "info");
    const toast = page.document.querySelector(".toast-container");
    expect(toast.textContent).toContain(EVIL);
    expect(injected(page.document)).toBeNull();
  });

  test("showAlert escapes by default; { html: true } is an explicit opt-in for trusted markup", () => {
    const box = page.document.createElement("div");
    box.id = "tmpAlert";
    page.document.body.appendChild(box);

    page.window.showAlert("tmpAlert", EVIL, "error");
    expect(box.textContent).toContain(EVIL);
    expect(injected(page.document)).toBeNull();

    page.window.showAlert("tmpAlert", 'Please <a href="/login.html">log in</a>', "error", { html: true });
    expect(box.querySelector("a[href='/login.html']")).not.toBeNull();
  });

  test("statusBadge escapes unknown statuses", () => {
    expect(page.window.statusBadge(EVIL)).not.toContain("<img");
  });
});

describe("navbar", () => {
  test("a hostile user name is shown as text", async () => {
    const { document, window } = await loadPage("/index.html", { user: { ...customer, name: EVIL }, routes: { "GET /api/categories": [], "GET /api/foods": { foods: [] } } });
    await waitFor(() => document.getElementById("userMenuBtn"));
    expect(textOf(document.getElementById("userMenuBtn"))).toBe(`👤 ${EVIL}`);
    expect(injected(document)).toBeNull();
    await closePage(window);
  });
});

describe("home page (index.html)", () => {
  test("categories and featured foods render hostile data as text; apostrophe names can be added to the cart", async () => {
    const { document, window, calls, errors } = await loadPage("/index.html", {
      user: customer,
      routes: {
        "GET /api/categories": [{ _id: id(9), name: EVIL, image: EVIL }],
        "GET /api/foods": { foods: [food(3), food(4, { name: APOS })], pagination: { total: 2 } },
        "POST /api/cart": ok({ items: [], total: 0 }),
      },
    });
    await waitFor(() => document.querySelectorAll(".food-card").length === 2);

    expect(textOf(document.querySelector(".cat-card-name"))).toBe(EVIL);
    expect(textOf(document.querySelectorAll(".food-card-name")[0])).toBe(EVIL);
    expect(textOf(document.querySelectorAll(".food-card-desc")[0])).toBe(EVIL);
    expect(injected(document)).toBeNull();

    // the apostrophe / double-quote food (used to produce a JavaScript syntax error in onclick)
    const buttons = document.querySelectorAll("[data-action='addToCart']");
    buttons[1].click();
    await waitFor(() => calls.some((c) => c.method === "POST" && c.pathname === "/api/cart"));
    expect(calls.find((c) => c.method === "POST").body).toEqual({ foodId: id(4), quantity: 1 });
    await waitFor(() => toastText(document).includes(APOS));
    expect(toastText(document)).toContain(`${APOS} added to cart!`);
    expect(errors).toEqual([]);
    await closePage(window);
  });
});

describe("menu page (menu.html)", () => {
  test("renders hostile food data as text and add-to-cart works for apostrophe names", async () => {
    const { document, window, calls } = await loadPage("/menu.html", {
      user: customer,
      routes: {
        "GET /api/categories": [{ _id: id(9), name: EVIL }],
        "GET /api/foods": { foods: [food(3), food(4, { name: APOS })], pagination: { total: 2, page: 1, totalPages: 1 } },
        "POST /api/cart": ok({ items: [], total: 0 }),
      },
    });
    await waitFor(() => document.querySelectorAll(".food-card").length === 2);
    expect(textOf(document.querySelectorAll(".food-card-name")[0])).toBe(EVIL);
    expect(textOf(document.querySelector(".category-pill:last-child"))).toBe(EVIL);
    expect(injected(document)).toBeNull();

    document.querySelectorAll("[data-action='addToCart']")[1].click();
    await waitFor(() => calls.some((c) => c.method === "POST"));
    expect(calls.find((c) => c.method === "POST").body.foodId).toBe(id(4));
    await waitFor(() => toastText(document).includes(APOS));
    await closePage(window);
  });
});

describe("food details (food-details.html)", () => {
  test("hostile food is text; add-to-cart works; login prompt keeps its link", async () => {
    const { document, window, calls } = await loadPage(`/food-details.html?id=${id(3)}`, {
      user: customer,
      routes: { [`GET /api/foods/${id(3)}`]: food(3, { name: APOS }), "POST /api/cart": ok({ items: [], total: 0 }) },
    });
    await waitFor(() => document.getElementById("addCartBtn"));
    expect(textOf(document.querySelector("h1"))).toBe(APOS);
    expect(injected(document)).toBeNull();
    document.getElementById("addCartBtn").click();
    await waitFor(() => calls.some((c) => c.method === "POST"));
    expect(calls.find((c) => c.method === "POST").body).toEqual({ foodId: id(3), quantity: 1 });
    await closePage(window);
  });

  test("a 401 shows the trusted 'log in' link (html opt-in still works)", async () => {
    const { document, window } = await loadPage(`/food-details.html?id=${id(3)}`, {
      user: customer,
      routes: { [`GET /api/foods/${id(3)}`]: food(3), "POST /api/cart": { status: 401, body: { success: false, message: "x" } } },
    });
    await waitFor(() => document.getElementById("addCartBtn"));
    document.getElementById("addCartBtn").click();
    await waitFor(() => document.querySelector("#alertBox a[href='/login.html']"));
    await closePage(window);
  });
});

describe("cart page", () => {
  const cart = (name) => ({ items: [{ food: { _id: id(3), name, image: EVIL, available: true, price: 10 }, quantity: 2, price: 10 }], total: 20 });

  test("hostile names are text; Remove works for apostrophe names", async () => {
    const { document, window, calls } = await loadPage("/cart.html", {
      user: customer,
      routes: {
        "GET /api/cart": cart(APOS),
        [`DELETE /api/cart/${id(3)}`]: ok({ items: [], total: 0 }),
        [`PUT /api/cart/${id(3)}`]: ok(cart(APOS)),
      },
    });
    await waitFor(() => document.querySelector(".cart-item"));
    expect(textOf(document.querySelector(".cart-item-name"))).toBe(APOS);

    document.querySelector("[data-action='removeItem']").click();
    await waitFor(() => calls.some((c) => c.method === "DELETE"));
    await waitFor(() => toastText(document).includes(`${APOS} removed from cart`));

    document.querySelectorAll("[data-action='updateQty']")[1].click(); // the "+" button
    await waitFor(() => calls.some((c) => c.method === "PUT"));
    expect(calls.find((c) => c.method === "PUT").body).toEqual({ quantity: 3 });
    await closePage(window);
  });

  test("hostile name is not interpreted as HTML", async () => {
    const { document, window } = await loadPage("/cart.html", { user: customer, routes: { "GET /api/cart": cart(EVIL) } });
    await waitFor(() => document.querySelector(".cart-item"));
    expect(textOf(document.querySelector(".cart-item-name"))).toBe(EVIL);
    expect(injected(document)).toBeNull();
    await closePage(window);
  });
});

describe("checkout page", () => {
  test("saved address is placed in inputs safely; item names are text", async () => {
    const { document, window } = await loadPage("/checkout.html", {
      user: customer,
      routes: { "GET /api/cart": { items: [{ food: { _id: id(3), name: EVIL }, quantity: 1, price: 10 }], total: 10 } },
    });
    await waitFor(() => document.getElementById("street"));
    for (const field of ["street", "city", "state"]) {
      expect(document.getElementById(field).value).toBe(EVIL); // exact round-trip, no attribute breakout
    }
    expect(injected(document)).toBeNull();
    await closePage(window);
  });

  test("a failed order shows the server message as text", async () => {
    const { document, window } = await loadPage("/checkout.html", {
      user: { ...customer, name: "Asha", address: { street: "12 MG Road", city: "Hyderabad", state: "TS", pincode: "500001" } },
      routes: {
        "GET /api/cart": { items: [{ food: { _id: id(3), name: "Tea" }, quantity: 1, price: 10 }], total: 10 },
        "POST /api/orders": { status: 409, body: { success: false, message: `Gone: ${EVIL}` } },
      },
    });
    await waitFor(() => document.getElementById("placeOrderBtn"));
    document.getElementById("placeOrderBtn").click();
    await waitFor(() => document.querySelector("#alertBox .alert"));
    expect(document.querySelector("#alertBox .alert").textContent).toContain(EVIL);
    expect(injected(document)).toBeNull();
    await closePage(window);
  });
});

describe("orders page", () => {
  const order = { _id: id(5), createdAt: new Date().toISOString(), totalAmount: 20, orderStatus: "Pending", paymentMethod: EVIL, items: [{ foodName: EVIL, quantity: 2, price: 10 }], deliveryAddress: { street: EVIL, city: EVIL, state: EVIL, pincode: EVIL } };

  test("list and detail modal render hostile order data as text", async () => {
    const { document, window, calls } = await loadPage("/orders.html", {
      user: customer,
      routes: { "GET /api/orders": [order], [`GET /api/orders/${id(5)}`]: order },
    });
    await waitFor(() => document.querySelector(".card[data-action='showOrderDetail']"));
    expect(injected(document)).toBeNull();

    document.querySelector(".card[data-action='showOrderDetail']").click();
    await waitFor(() => calls.some((c) => c.pathname === `/api/orders/${id(5)}`));
    await waitFor(() => document.getElementById("modalBody").textContent.includes("Delivery Address"));
    expect(document.getElementById("modalBody").textContent).toContain(EVIL);
    expect(injected(document)).toBeNull();
    await closePage(window);
  });
});

describe("profile page", () => {
  test("form fields round-trip hostile values exactly; clearing the phone sends an empty string", async () => {
    const { document, window, calls } = await loadPage("/profile.html", {
      user: customer,
      routes: { "PUT /api/users/profile": ok({}) },
    });
    await waitFor(() => document.getElementById("profileForm"));
    expect(document.getElementById("name").value).toBe(EVIL);
    expect(document.getElementById("street").value).toBe(EVIL);
    expect(injected(document)).toBeNull();

    document.getElementById("phone").value = "";
    document.getElementById("profileForm").dispatchEvent(new window.Event("submit", { cancelable: true }));
    await waitFor(() => calls.some((c) => c.method === "PUT"));
    expect(calls.find((c) => c.method === "PUT").body).toEqual({ name: EVIL, phone: "" });
    await closePage(window);
  });
});

describe("admin dashboard", () => {
  test("every table / list renders hostile names as text", async () => {
    const { document, window } = await loadPage("/admin.html", {
      user: admin,
      routes: {
        "GET /api/admin/dashboard": {
          summary: { totalOrders: 1, totalRevenue: 20, totalUsers: 2, pendingOrders: 1 },
          ordersByStatus: [{ _id: EVIL, count: 1 }],
          popularFoods: [{ foodName: EVIL, totalOrdered: 2, totalRevenue: 20 }],
          topSpenders: [{ name: EVIL, email: EVIL, totalSpent: 20, orderCount: 1 }],
          recentOrders: [{ _id: id(5), user: { name: EVIL }, totalAmount: 20, orderStatus: "Pending", createdAt: new Date().toISOString() }],
        },
      },
    });
    await waitFor(() => document.querySelector("#recentOrders table") && document.querySelector("#topSpenders div"));
    expect(document.getElementById("topSpenders").textContent).toContain(EVIL);
    expect(document.getElementById("recentOrders").textContent).toContain(EVIL);
    expect(document.getElementById("popularFoods").textContent).toContain(EVIL);
    expect(injected(document)).toBeNull();
    await closePage(window);
  });
});

describe("admin users page", () => {
  const users = [
    { _id: id(2), name: "Me", email: "a@x.co", role: "admin", createdAt: new Date().toISOString() },
    { _id: id(7), name: APOS, email: EVIL, phone: EVIL, role: "customer", address: { city: EVIL, state: EVIL }, createdAt: new Date().toISOString() },
    { _id: id(8), name: "Gone User", email: "g@x.co", role: "customer", isActive: false, createdAt: new Date().toISOString() },
  ];

  test("hostile data is text, deactivated badge shown, delete works for apostrophe names and shows the server message", async () => {
    const { document, window, calls } = await loadPage("/admin-users.html", {
      user: admin,
      routes: {
        "GET /api/admin/users": users,
        [`DELETE /api/admin/users/${id(7)}`]: { status: 200, body: { success: true, message: "User deactivated. Their order history has been kept.", data: { action: "deactivated" } } },
      },
    });
    await waitFor(() => document.querySelectorAll("tbody tr").length === 3);
    expect(document.querySelector("tbody").textContent).toContain(EVIL);
    expect(injected(document)).toBeNull();
    expect(document.querySelectorAll(".badge-cancelled").length).toBe(1); // only the deactivated user

    document.querySelector("[data-action='deleteUser']").click();
    await waitFor(() => calls.some((c) => c.method === "DELETE"));
    await waitFor(() => toastText(document).includes("User deactivated"));
    await closePage(window);
  });
});

describe("admin orders page", () => {
  const order = { _id: id(5), createdAt: new Date().toISOString(), totalAmount: 20, orderStatus: "Pending", paymentMethod: EVIL, user: { name: EVIL, email: EVIL }, items: [{ foodName: EVIL, quantity: 2, price: 10 }], deliveryAddress: { street: EVIL, city: EVIL, state: EVIL, pincode: EVIL } };

  test("list and detail modal render hostile data as text", async () => {
    const { document, window, calls } = await loadPage("/admin-orders.html", {
      user: admin,
      routes: { "GET /api/admin/orders": { orders: [order], pagination: { page: 1, totalPages: 1 } }, [`GET /api/orders/${id(5)}`]: order },
    });
    await waitFor(() => document.querySelector("[data-action='openOrderDetail']"));
    expect(injected(document)).toBeNull();
    document.querySelector("[data-action='openOrderDetail']").click();
    await waitFor(() => calls.some((c) => c.pathname === `/api/orders/${id(5)}`));
    await waitFor(() => document.getElementById("modalBody").textContent.includes("Delivery Address"));
    expect(injected(document)).toBeNull();
    await closePage(window);
  });
});

describe("admin food page", () => {
  const routes = (extra = {}) => ({
    "GET /api/categories": [{ _id: id(9), name: EVIL }],
    "GET /api/foods": { foods: [food(3), food(4, { name: APOS })], pagination: {} },
    [`GET /api/foods/${id(3)}`]: food(3, { rating: 0 }),
    [`DELETE /api/foods/${id(4)}`]: ok(null),
    [`PUT /api/foods/${id(3)}`]: ok({}),
    ...extra,
  });

  test("table and category select render hostile data as text; delete works for apostrophe names", async () => {
    const { document, window, calls } = await loadPage("/admin-food.html", { user: admin, routes: routes() });
    await waitFor(() => document.querySelectorAll("tbody tr").length === 2);
    expect(injected(document)).toBeNull();

    document.querySelectorAll("[data-action='deleteFood']")[1].click();
    await waitFor(() => calls.some((c) => c.method === "DELETE"));
    await waitFor(() => toastText(document).includes(`${APOS} deleted`));
    await closePage(window);
  });

  test("edit form round-trips values exactly; a rating of 0 is sent as 0 (not 4.0); a blank rating is omitted", async () => {
    const { document, window, calls } = await loadPage("/admin-food.html", { user: admin, routes: routes() });
    await waitFor(() => document.querySelectorAll("[data-action='editFood']").length === 2);

    document.querySelector("[data-action='editFood']").click();
    await waitFor(() => document.getElementById("fName").value === EVIL);
    expect(document.getElementById("fRating").value).toBe("0");
    expect(document.getElementById("fCategory").selectedOptions[0].textContent).toBe(EVIL);

    window.saveFood();
    await waitFor(() => calls.some((c) => c.method === "PUT"));
    expect(calls.find((c) => c.method === "PUT").body.rating).toBe(0);

    document.getElementById("fRating").value = "";
    calls.length = 0;
    window.saveFood();
    await waitFor(() => calls.some((c) => c.method === "PUT"));
    expect(calls.find((c) => c.method === "PUT").body).not.toHaveProperty("rating");
    await closePage(window);
  });

  test("a server error message in the modal is escaped", async () => {
    const { document, window } = await loadPage("/admin-food.html", {
      user: admin,
      routes: routes({ [`PUT /api/foods/${id(3)}`]: { status: 400, body: { success: false, message: EVIL } } }),
    });
    await waitFor(() => document.querySelector("[data-action='editFood']"));
    document.querySelector("[data-action='editFood']").click();
    await waitFor(() => document.getElementById("fName").value === EVIL);
    window.saveFood();
    await waitFor(() => document.querySelector("#modalAlert .alert"));
    expect(document.querySelector("#modalAlert .alert").textContent).toBe(EVIL);
    expect(injected(document)).toBeNull();
    await closePage(window);
  });
});

describe("admin categories page", () => {
  const cat = { _id: id(9), name: APOS, description: `He said "hi" & left\nnew line ${EVIL}`, image: EVIL, createdAt: new Date().toISOString() };

  test("Edit puts the exact stored values into the form (no truncation at an apostrophe)", async () => {
    const { document, window } = await loadPage("/admin-categories.html", { user: admin, routes: { "GET /api/categories": [cat] } });
    await waitFor(() => document.querySelector("[data-action='editCat']"));
    expect(injected(document)).toBeNull();

    document.querySelector("[data-action='editCat']").click();
    expect(document.getElementById("cName").value).toBe(APOS);
    expect(document.getElementById("cDesc").value).toBe(cat.description);
    expect(document.getElementById("cImage").value).toBe(EVIL);
    await closePage(window);
  });

  test("Delete works for apostrophe names", async () => {
    const { document, window, calls } = await loadPage("/admin-categories.html", {
      user: admin,
      routes: { "GET /api/categories": [cat], [`DELETE /api/categories/${id(9)}`]: ok(null) },
    });
    await waitFor(() => document.querySelector("[data-action='deleteCat']"));
    document.querySelector("[data-action='deleteCat']").click();
    await waitFor(() => calls.some((c) => c.method === "DELETE"));
    await waitFor(() => toastText(document).includes(`${APOS} deleted`));
    await closePage(window);
  });
});

describe("no inline handlers built from data remain in the pages", () => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "../../public");

  test.each(fs.readdirSync(dir).filter((f) => f.endsWith(".html")))("%s", (file) => {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    // onclick="fn('${…}')" style handlers are the pattern that broke on apostrophes and allowed injection
    expect(html).not.toMatch(/onclick="[^"]*\$\{/);
    expect(html).not.toMatch(/onclick="[a-zA-Z]+\('\$\{/);
  });
});
