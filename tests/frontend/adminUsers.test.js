// Batch 4 — admin-users.html: Reactivate button for deactivated accounts.
// The REAL page + main.js run in jsdom with a stubbed fetch (tests/helpers/page.js).
// The server enforces everything (admin only, CSRF, 404/409); the page only offers the right action.

const { startServer, stopServer, loadPage, waitFor, closePage, ok } = require("../helpers/page");

const id = (n) => String(n).repeat(24).slice(0, 24);
const admin = { _id: id(1), name: "Boss", email: "boss@example.com", role: "admin" };
const HOSTILE = `O'Brien <img src=x onerror="window.__pwned=1">`;
const when = "2026-10-01T10:00:00Z";

const user = (n, over = {}) => ({ _id: id(n), name: `User ${n}`, email: `u${n}@example.com`, role: "customer", createdAt: when, ...over });

const toast = (document) => document.querySelector(".toast-container")?.textContent || "";
const row = (document, uid) => [...document.querySelectorAll("tbody tr")].find((tr) => tr.querySelector(`[data-id="${uid}"]`));
const actions = (document, name) => [...document.querySelectorAll(`[data-action="${name}"]`)];

beforeAll(startServer);
afterAll(stopServer);

describe("admin-users.html — which button each row offers", () => {
  test("active user → delete only; deactivated user → Reactivate only; your own row → neither", async () => {
    const page = await loadPage("/admin-users.html", {
      user: admin,
      routes: {
        "GET /api/admin/users": [
          { ...admin, createdAt: when },
          user(2),
          user(3, { isActive: false }),
          user(4, { isActive: true }),
        ],
      },
    });
    await waitFor(() => page.document.querySelectorAll("tbody tr").length === 4);
    const { document } = page;

    expect(actions(document, "deleteUser").map((b) => b.dataset.id).sort()).toEqual([id(2), id(4)]);
    expect(actions(document, "reactivateUser").map((b) => b.dataset.id)).toEqual([id(3)]);

    // the deactivated row has no delete button, the active rows have no Reactivate button
    expect(row(document, id(3)).querySelector('[data-action="deleteUser"]')).toBeNull();
    expect(row(document, id(2)).querySelector('[data-action="reactivateUser"]')).toBeNull();

    // the admin's own row offers nothing (an admin cannot delete / deactivate themselves)
    const own = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Boss"));
    expect(own.querySelector("button")).toBeNull();
    expect(own.textContent).toContain("You");
    await closePage(page.window);
  });

  test("a legacy user with no isActive field is treated as active (delete, not Reactivate)", async () => {
    const page = await loadPage("/admin-users.html", { user: admin, routes: { "GET /api/admin/users": [{ ...admin, createdAt: when }, user(2)] } });
    await waitFor(() => page.document.querySelectorAll("tbody tr").length === 2);
    expect(actions(page.document, "reactivateUser")).toHaveLength(0);
    expect(actions(page.document, "deleteUser")).toHaveLength(1);
    await closePage(page.window);
  });
});

describe("admin-users.html — reactivating", () => {
  const load = async (routes, confirmAnswer = true) => {
    const page = await loadPage("/admin-users.html", { user: admin, routes: { "GET /api/admin/users": [{ ...admin, createdAt: when }, user(3, { isActive: false })], ...routes } });
    page.confirm = jest.fn(() => confirmAnswer);
    page.window.confirm = page.confirm;
    await waitFor(() => actions(page.document, "reactivateUser").length === 1);
    return page;
  };

  test("asks first; on OK sends PUT /api/admin/users/:id/reactivate WITH the CSRF token and NO body, then reloads the list", async () => {
    let reactivated = false;
    const page = await load({
      "GET /api/admin/users": () => ok([{ ...admin, createdAt: when }, user(3, { isActive: reactivated ? true : false })]),
      [`PUT /api/admin/users/${id(3)}/reactivate`]: () => {
        reactivated = true;
        return ok(user(3, { isActive: true }), "User reactivated. They can log in again.");
      },
    });

    actions(page.document, "reactivateUser")[0].click();
    await waitFor(() => page.calls.some((c) => c.method === "PUT"));

    expect(page.confirm).toHaveBeenCalledTimes(1);
    const put = page.calls.find((c) => c.method === "PUT");
    expect(put.pathname).toBe(`/api/admin/users/${id(3)}/reactivate`);
    expect(put.headers["X-CSRF-Token"]).toMatch(/^token-/);
    expect(put.body).toBeUndefined(); // nothing for the server to misuse

    await waitFor(() => toast(page.document).includes("User reactivated"));
    await waitFor(() => actions(page.document, "reactivateUser").length === 0); // list reloaded: now active
    expect(actions(page.document, "deleteUser")).toHaveLength(1);
    expect(page.calls.filter((c) => c.method === "GET" && c.pathname === "/api/admin/users").length).toBeGreaterThanOrEqual(2);
    await closePage(page.window);
  });

  test("declining the confirm sends nothing", async () => {
    const page = await load({}, false);
    actions(page.document, "reactivateUser")[0].click();
    await new Promise((r) => setTimeout(r, 60));
    expect(page.confirm).toHaveBeenCalledTimes(1);
    expect(page.calls.some((c) => c.method === "PUT")).toBe(false);
    await closePage(page.window);
  });

  test("the confirm text says old cart/sessions are not restored; reactivating an ADMIN adds an explicit warning", async () => {
    const page = await loadPage("/admin-users.html", {
      user: admin,
      routes: { "GET /api/admin/users": [{ ...admin, createdAt: when }, user(3, { isActive: false }), user(5, { isActive: false, role: "admin", name: "Old Admin" })] },
    });
    page.window.confirm = jest.fn(() => false);
    await waitFor(() => actions(page.document, "reactivateUser").length === 2);

    const [customerButton, adminButton] = actions(page.document, "reactivateUser").sort((a, b) => a.dataset.id.localeCompare(b.dataset.id));
    customerButton.click();
    adminButton.click();
    const [customerText, adminText] = page.window.confirm.mock.calls.map((c) => c[0]);

    expect(customerText).toContain("User 3");
    expect(customerText).toMatch(/cart and sessions are not restored/i);
    expect(customerText).not.toMatch(/ADMIN account/);
    expect(adminText).toContain("Old Admin");
    expect(adminText).toMatch(/ADMIN account.*admin access again/s);
    await closePage(page.window);
  });

  test("a refusal from the server (409 already active) is shown, nothing crashes, no success toast", async () => {
    const page = await load({
      [`PUT /api/admin/users/${id(3)}/reactivate`]: { status: 409, body: { success: false, message: "This account is already active" } },
    });
    actions(page.document, "reactivateUser")[0].click();
    await waitFor(() => page.document.getElementById("alertBox").textContent.includes("This account is already active"));
    expect(toast(page.document)).not.toContain("reactivated");
    expect(page.errors).toEqual([]);
    await closePage(page.window);
  });

  test("hostile names (quotes, HTML) are text everywhere: attribute, row and confirm — nothing executes", async () => {
    const page = await loadPage("/admin-users.html", {
      user: admin,
      routes: {
        "GET /api/admin/users": [{ ...admin, createdAt: when }, user(3, { isActive: false, name: HOSTILE })],
        [`PUT /api/admin/users/${id(3)}/reactivate`]: ok(user(3), "User reactivated. They can log in again."),
      },
    });
    page.window.confirm = jest.fn(() => true);
    await waitFor(() => actions(page.document, "reactivateUser").length === 1);

    expect(page.document.querySelector("tbody img")).toBeNull();           // the <img> never became an element
    expect(page.document.querySelector("tbody").textContent).toContain(HOSTILE);
    expect(actions(page.document, "reactivateUser")[0].dataset.name).toBe(HOSTILE); // the attribute survived intact

    actions(page.document, "reactivateUser")[0].click();
    await waitFor(() => page.calls.some((c) => c.method === "PUT"));
    expect(page.window.confirm.mock.calls[0][0]).toContain(HOSTILE);       // confirm() shows text, not markup
    expect(page.window.__pwned).toBeUndefined();
    await closePage(page.window);
  });
});
