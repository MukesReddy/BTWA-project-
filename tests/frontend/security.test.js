// P1.5 / P1.6 on the FRONT END — the real public/js/main.js and public/login.html run in jsdom
// (tests/helpers/page.js) with a stubbed API.
//   • safeRedirect: the ?redirect= parameter can only lead to our own pages (no open redirect / javascript:)
//   • login page: honours a safe redirect, ignores a hostile one; demo buttons exist only when the server offers them
//   • apiCall: sends the CSRF token on writes (and only on writes), caches it, refreshes it after login/logout
//     and after a rejection, and does not retry forever

const { loadPage, waitFor, closePage, ok } = require("../helpers/page");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("safeRedirect (main.js)", () => {
  let page;
  let safeRedirect;
  beforeAll(async () => {
    page = await loadPage("/login.html");
    safeRedirect = page.window.safeRedirect;
  });
  afterAll(() => closePage(page.window));

  test.each([
    ["/menu.html", "/menu.html"],
    ["/cart.html", "/cart.html"],
    ["/checkout.html", "/checkout.html"],
    ["/orders.html", "/orders.html"],
    ["/profile.html", "/profile.html"],
    ["/admin.html", "/admin.html"],
    ["/admin-orders.html", "/admin-orders.html"],
    ["/food-details.html?id=507f1f77bcf86cd799439011", "/food-details.html?id=507f1f77bcf86cd799439011"],
    ["/", "/"],
    ["/menu.html#top", "/menu.html"], // fragment dropped
  ])("allows our own page %s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  test.each([
    ["absolute URL to another site", "https://evil.example/phish"],
    ["http absolute URL", "http://evil.example"],
    ["scheme-relative //host", "//evil.example"],
    ["triple slash", "///evil.example"],
    ["backslash trick /\\host", "/\\evil.example"],
    ["tab inside //", "/\t/evil.example"],
    ["newline", "/menu.html\n/evil"],
    ["javascript: URL", "javascript:alert(document.cookie)"],
    ["JAVASCRIPT: mixed case", "JaVaScRiPt:alert(1)"],
    ["data: URL", "data:text/html,<script>alert(1)</script>"],
    ["protocol-relative host with userinfo", "//menu.html@evil.example"],
    ["userinfo trick", "/@evil.example"],
    ["encoded double slash", "/%2f%2fevil.example"],
    ["encoded backslash", "/%5cevil.example"],
    ["path traversal out of the allow-list", "/menu.html/../secret"],
    ["a page that exists on no allow-list", "/api/auth/logout"],
    ["static asset", "/js/main.js"],
    ["relative path without leading slash", "menu.html"],
    ["empty string", ""],
    ["very long", "/menu.html?" + "a".repeat(400)],
  ])("rejects %s → falls back to /menu.html", (_label, input) => {
    expect(safeRedirect(input)).toBe("/menu.html");
  });

  test("non-strings and null fall back (a missing ?redirect= is the normal case)", () => {
    for (const v of [null, undefined, 42, {}, ["/cart.html"]]) expect(safeRedirect(v)).toBe("/menu.html");
  });

  test("a custom fallback is honoured", () => {
    expect(safeRedirect("https://evil.example", "/index.html")).toBe("/index.html");
  });
});

describe("login page", () => {
  const demo = [
    { label: "Admin Demo", icon: "⚙️", email: "admin@foodiehub.com", password: "admin123" },
    { label: "Customer Demo", icon: "👤", email: "rahul@example.com", password: "password123" },
  ];
  const loginRoute = { "POST /api/auth/login": () => ({ status: 200, body: { success: true, message: "ok", data: { user: {} } } }) };

  const submitLogin = async (page) => {
    page.document.getElementById("email").value = "asha@example.com";
    page.document.getElementById("password").value = "secret12";
    page.document.getElementById("loginForm").dispatchEvent(new page.window.Event("submit", { cancelable: true }));
    await waitFor(() => page.calls.some((c) => c.pathname === "/api/auth/login"));
  };

  const loginAndCaptureNavigation = async (search) => {
    const page = await loadPage(`/login.html${search}`, { routes: loginRoute });
    const navigations = [];
    page.window.navigateTo = (url) => navigations.push(url);
    await submitLogin(page);
    await waitFor(() => navigations.length, { timeout: 3000 });
    await closePage(page.window);
    return navigations;
  };

  test("a safe ?redirect= is followed after login", async () => {
    expect(await loginAndCaptureNavigation("?redirect=/checkout.html")).toEqual(["/checkout.html"]);
  });

  test.each([
    ["https://evil.example", "https%3A%2F%2Fevil.example"],
    ["//evil.example", "%2F%2Fevil.example"],
    ["javascript:", "javascript%3Aalert(1)"],
  ])("a hostile ?redirect= (%s) is ignored → /menu.html", async (_label, encoded) => {
    expect(await loginAndCaptureNavigation(`?redirect=${encoded}`)).toEqual(["/menu.html"]);
  });

  test("no ?redirect= → /menu.html (unchanged behaviour)", async () => {
    expect(await loginAndCaptureNavigation("")).toEqual(["/menu.html"]);
  });

  test("a failed login stays on the page, shows the message, and does not navigate", async () => {
    const page = await loadPage("/login.html?redirect=/cart.html", {
      routes: { "POST /api/auth/login": () => ({ status: 401, body: { success: false, message: "Invalid email or password" } }) },
    });
    const navigations = [];
    page.window.navigateTo = (url) => navigations.push(url);
    await submitLogin(page);
    await waitFor(() => /Invalid email or password/.test(page.document.getElementById("alertBox").textContent));
    expect(navigations).toEqual([]);
    expect(page.document.getElementById("loginBtn").disabled).toBe(false);
    await closePage(page.window);
  });

  describe("demo buttons are dev-only and server-driven", () => {
    test("production (endpoint 404) → no buttons, section stays hidden, no credentials anywhere in the DOM", async () => {
      const page = await loadPage("/login.html"); // no stub for demo-accounts → 404, like production
      await waitFor(() => page.calls.some((c) => c.pathname === "/api/auth/demo-accounts"));
      await sleep(30);
      expect(page.document.getElementById("demoSection").hidden).toBe(true);
      expect(page.document.querySelectorAll("#demoButtons button")).toHaveLength(0);
      expect(page.document.documentElement.outerHTML).not.toMatch(/admin123|password123|admin@foodiehub/);
      await closePage(page.window);
    });

    test("development (endpoint lists accounts) → one button per account, shown", async () => {
      const page = await loadPage("/login.html", { routes: { "GET /api/auth/demo-accounts": demo } });
      await waitFor(() => page.document.querySelectorAll("#demoButtons button").length === 2);
      expect(page.document.getElementById("demoSection").hidden).toBe(false);
      expect([...page.document.querySelectorAll("#demoButtons button")].map((b) => b.textContent)).toEqual([
        "⚙️ Admin Demo",
        "👤 Customer Demo",
      ]);
      await closePage(page.window);
    });

    test("clicking a demo button signs in with that account", async () => {
      const page = await loadPage("/login.html", { routes: { "GET /api/auth/demo-accounts": demo, ...loginRoute } });
      await waitFor(() => page.document.querySelectorAll("#demoButtons button").length === 2);
      page.window.navigateTo = () => {};
      page.document.querySelectorAll("#demoButtons button")[1].click();
      await waitFor(() => page.calls.some((c) => c.pathname === "/api/auth/login"));
      expect(page.calls.find((c) => c.pathname === "/api/auth/login").body).toEqual({ email: "rahul@example.com", password: "password123" });
      await closePage(page.window);
    });

    test("labels from the server are rendered as text, never parsed as HTML", async () => {
      const evil = [{ label: '<img src=x data-xss onerror="window.__x=1">', icon: "", email: "a@b.co", password: "x" }];
      const page = await loadPage("/login.html", { routes: { "GET /api/auth/demo-accounts": evil } });
      await waitFor(() => page.document.querySelectorAll("#demoButtons button").length === 1);
      expect(page.document.querySelector("[data-xss]")).toBeNull();
      expect(page.document.querySelector("#demoButtons button").textContent).toContain("<img");
      await closePage(page.window);
    });
  });
});

describe("apiCall + CSRF token (main.js)", () => {
  const csrfCalls = (page) => page.calls.filter((c) => c.pathname === "/api/auth/csrf");
  const tokenOf = (call) => call.headers["X-CSRF-Token"];

  test("GET requests carry no token and do not fetch one", async () => {
    const page = await loadPage("/login.html", { routes: { "GET /api/foods": { foods: [] } } });
    page.calls.length = 0;
    await page.window.apiCall("GET", "/foods");
    expect(csrfCalls(page)).toHaveLength(0);
    expect(page.calls[0].headers["X-CSRF-Token"]).toBeUndefined();
    await closePage(page.window);
  });

  test("a write fetches the token first, sends it, and caches it for later writes", async () => {
    const page = await loadPage("/login.html", { routes: { "POST /api/cart": ok({}), "PUT /api/cart/x": ok({}), "DELETE /api/cart/x": ok({}) } });
    page.calls.length = 0;
    await page.window.apiCall("POST", "/cart", { foodId: "x" });
    await page.window.apiCall("PUT", "/cart/x", { quantity: 2 });
    await page.window.apiCall("DELETE", "/cart/x");

    expect(csrfCalls(page)).toHaveLength(1); // fetched once, reused
    const writes = page.calls.filter((c) => c.method !== "GET");
    expect(writes.map(tokenOf)).toEqual(["token-1", "token-1", "token-1"]);
    expect(csrfCalls(page)[0].headers["X-CSRF-Token"]).toBeUndefined();
    await closePage(page.window);
  });

  test("logging in or out invalidates the cached token (the session changed)", async () => {
    const page = await loadPage("/login.html", {
      routes: { "POST /api/auth/login": ok({ user: {} }), "POST /api/auth/logout": ok(null), "POST /api/cart": ok({}) },
    });
    page.calls.length = 0;
    await page.window.apiCall("POST", "/auth/login", { email: "a@b.co", password: "secret12" });
    await page.window.apiCall("POST", "/cart", {});
    await page.window.apiCall("POST", "/auth/logout");
    await page.window.apiCall("POST", "/cart", {});

    const sent = page.calls.filter((c) => c.method === "POST").map(tokenOf);
    expect(sent).toEqual(["token-1", "token-2", "token-2", "token-3"]); // new token after login AND after logout
    await closePage(page.window);
  });

  test("a CSRF rejection triggers ONE retry with a fresh token", async () => {
    let attempts = 0;
    const page = await loadPage("/login.html", {
      routes: {
        "POST /api/cart": (body, url) => {
          attempts += 1;
          return attempts === 1
            ? { status: 403, body: { success: false, message: "bad token", code: "CSRF_TOKEN" } }
            : { status: 200, body: { success: true, message: "ok", data: {} } };
        },
      },
    });
    page.calls.length = 0;
    const result = await page.window.apiCall("POST", "/cart", { foodId: "x" });

    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(page.calls.filter((c) => c.method === "POST").map(tokenOf)).toEqual(["token-1", "token-2"]);
    await closePage(page.window);
  });

  test("…but never loops: a second rejection is returned to the caller", async () => {
    let attempts = 0;
    const page = await loadPage("/login.html", {
      routes: { "POST /api/cart": () => { attempts += 1; return { status: 403, body: { success: false, message: "bad token", code: "CSRF_TOKEN" } }; } },
    });
    const result = await page.window.apiCall("POST", "/cart", {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(attempts).toBe(2);
    await closePage(page.window);
  });

  test("other 403s (e.g. admin-only) are NOT retried", async () => {
    let attempts = 0;
    const page = await loadPage("/login.html", {
      routes: { "POST /api/cart": () => { attempts += 1; return { status: 403, body: { success: false, message: "Access denied" } }; } },
    });
    await page.window.apiCall("POST", "/cart", {});
    expect(attempts).toBe(1);
    await closePage(page.window);
  });

  test("if the token cannot be fetched, the caller gets a clean error object (no exception)", async () => {
    const page = await loadPage("/login.html");
    page.window.fetch = async () => { throw new Error("offline"); };
    const result = await page.window.apiCall("POST", "/cart", {});
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(result.data.message).toMatch(/could not reach the server/i);
    await closePage(page.window);
  });
});
