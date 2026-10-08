// Batch 3 — the pages only OFFER legal order actions (the server still enforces them):
//   orders.html        "Cancel Order" only for Pending orders; confirm; CSRF-protected PUT; list reloads
//   admin-orders.html  the status dropdown lists only the legal next statuses; final orders are locked
//   main.js            the mirrored transition table equals utils/constants.js

const { startServer, stopServer, loadPage, waitFor, closePage, ok } = require("../helpers/page");
const constants = require("../../utils/constants");

const id = (n) => String(n).repeat(24).slice(0, 24);
const STATUSES = ["Pending", "Confirmed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"];
const customer = { _id: id(1), name: "Asha", email: "a@example.com", role: "customer" };
const admin = { _id: id(2), name: "Boss", email: "b@example.com", role: "admin" };

const order = (n, status) => ({
  _id: id(n), orderStatus: status, totalAmount: 200, paymentMethod: "Cash on Delivery",
  createdAt: "2026-10-01T10:00:00Z", items: [{ foodName: "Biryani", quantity: 2, price: 100 }],
  deliveryAddress: { street: "1 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" },
  user: { name: "Asha", email: "a@example.com" },
});

const toast = (document) => document.querySelector(".toast-container")?.textContent || "";
const cancelButtons = (document) => [...document.querySelectorAll('[data-action="cancelOrder"]')];

beforeAll(startServer);
afterAll(stopServer);

describe("main.js: mirrored lifecycle", () => {
  let page;
  beforeAll(async () => { page = await loadPage("/index.html", { routes: { "GET /api/categories": [], "GET /api/foods": { foods: [], pagination: {} } } }); });
  afterAll(() => closePage(page.window));

  test("ORDER_TRANSITIONS in the browser equals ORDER_TRANSITIONS on the server (no drift)", () => {
    const browserCopy = JSON.parse(JSON.stringify(page.window.eval("ORDER_TRANSITIONS")));
    expect(browserCopy).toEqual(JSON.parse(JSON.stringify(constants.ORDER_TRANSITIONS)));
  });

  test.each(STATUSES)("allowedNextStatuses / canCustomerCancel for %s", (status) => {
    expect(page.window.allowedNextStatuses(status)).toEqual([...constants.ORDER_TRANSITIONS[status]]);
    expect(page.window.canCustomerCancel(status)).toBe(constants.CUSTOMER_CANCEL_FROM.includes(status));
  });

  test("unknown status → no choices; the returned list is a copy (cannot corrupt the table)", () => {
    expect(page.window.allowedNextStatuses("Teleported")).toEqual([]);
    page.window.allowedNextStatuses("Pending").push("Delivered");
    expect(page.window.allowedNextStatuses("Pending")).toEqual(["Confirmed", "Cancelled"]);
  });
});

describe("orders.html — customer", () => {
  const orders = STATUSES.map((s, i) => order(i + 1, s));

  test("only the Pending order has a Cancel Order button", async () => {
    const { window, document } = await loadPage("/orders.html", { user: customer, routes: { "GET /api/orders": orders } });
    await waitFor(() => document.querySelectorAll("[data-action=showOrderDetail]").length >= 6);
    const buttons = cancelButtons(document);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].dataset.id).toBe(id(1)); // the Pending one
    await closePage(window);
  });

  test("an ADMIN account viewing orders.html is never offered Cancel Order (the route is customer-only)", async () => {
    const page = await loadPage("/orders.html", {
      user: admin,
      routes: { "GET /api/orders": orders, [`GET /api/orders/${id(1)}`]: order(1, "Pending") },
    });
    await waitFor(() => page.document.querySelectorAll("[data-action=showOrderDetail]").length >= 6);
    expect(cancelButtons(page.document)).toHaveLength(0);
    page.window.showOrderDetail(id(1));
    await waitFor(() => page.document.getElementById("modalBody").textContent.includes("Delivery Address"));
    expect(page.document.getElementById("modalBody").querySelector('[data-action="cancelOrder"]')).toBeNull();
    await closePage(page.window);
  });

  test("the detail view of a Pending order offers Cancel; of a Confirmed order it does not", async () => {
    const page = await loadPage("/orders.html", {
      user: customer,
      routes: { "GET /api/orders": orders, [`GET /api/orders/${id(1)}`]: order(1, "Pending"), [`GET /api/orders/${id(2)}`]: order(2, "Confirmed") },
    });
    await waitFor(() => page.document.querySelector("[data-action=showOrderDetail]"));
    page.window.showOrderDetail(id(2));
    await waitFor(() => page.document.getElementById("modalBody").textContent.includes("Delivery Address"));
    expect(page.document.getElementById("modalBody").querySelector('[data-action="cancelOrder"]')).toBeNull();

    page.window.showOrderDetail(id(1));
    await waitFor(() => page.document.getElementById("modalBody").querySelector('[data-action="cancelOrder"]'));
    await closePage(page.window);
  });

  test("clicking Cancel asks first; on OK sends PUT /api/orders/:id/cancel WITH the CSRF token, then reloads the list", async () => {
    let cancelled = false;
    const page = await loadPage("/orders.html", {
      user: customer,
      routes: {
        "GET /api/orders": () => ok(cancelled ? [order(1, "Cancelled")] : [order(1, "Pending")]),
        [`PUT /api/orders/${id(1)}/cancel`]: () => { cancelled = true; return ok(order(1, "Cancelled"), "Order cancelled"); },
      },
    });
    await waitFor(() => cancelButtons(page.document).length === 1);
    cancelButtons(page.document)[0].click();
    await waitFor(() => page.calls.some((c) => c.method === "PUT"));

    const put = page.calls.find((c) => c.method === "PUT");
    expect(put.pathname).toBe(`/api/orders/${id(1)}/cancel`);
    expect(put.headers["X-CSRF-Token"]).toMatch(/^token-/);
    await waitFor(() => cancelButtons(page.document).length === 0); // list reloaded: now Cancelled, no button
    expect(toast(page.document)).toContain("Order cancelled");
    expect(page.calls.filter((c) => c.method === "GET" && c.pathname === "/api/orders").length).toBeGreaterThanOrEqual(2);
    await closePage(page.window);
  });

  test("declining the confirmation sends nothing", async () => {
    const page = await loadPage("/orders.html", { user: customer, confirm: false, routes: { "GET /api/orders": [order(1, "Pending")] } });
    await waitFor(() => cancelButtons(page.document).length === 1);
    cancelButtons(page.document)[0].click();
    await new Promise((r) => setTimeout(r, 60));
    expect(page.calls.some((c) => c.method === "PUT")).toBe(false);
    await closePage(page.window);
  });

  test("a 409 (admin confirmed it first) shows the server's message and reloads the real status", async () => {
    let confirmed = false;
    const page = await loadPage("/orders.html", {
      user: customer,
      routes: {
        "GET /api/orders": () => ok(confirmed ? [order(1, "Confirmed")] : [order(1, "Pending")]),
        [`PUT /api/orders/${id(1)}/cancel`]: () => {
          confirmed = true;
          return { status: 409, body: { success: false, message: 'This order can no longer be cancelled (it is now "Confirmed"). Please reload and try again.' } };
        },
      },
    });
    await waitFor(() => cancelButtons(page.document).length === 1);
    cancelButtons(page.document)[0].click();
    await waitFor(() => toast(page.document).includes("can no longer be cancelled"));
    await waitFor(() => cancelButtons(page.document).length === 0); // refreshed: Confirmed has no cancel button
    expect(page.document.body.textContent).toContain("Confirmed");
    await closePage(page.window);
  });
});

describe("admin-orders.html — admin", () => {
  const openManage = async (status, extraRoutes = {}) => {
    const page = await loadPage("/admin-orders.html", {
      user: admin,
      routes: {
        "GET /api/admin/orders": { orders: [order(1, status)], pagination: { total: 1, page: 1, totalPages: 1 } },
        [`GET /api/orders/${id(1)}`]: order(1, status),
        ...extraRoutes,
      },
    });
    await waitFor(() => page.document.querySelector('[data-action="openOrderDetail"]'));
    page.document.querySelector('[data-action="openOrderDetail"]').click();
    await waitFor(() => page.document.getElementById("modalBody").textContent.includes("Delivery Address"));
    return page;
  };
  const options = (document) => [...document.querySelectorAll("#newStatus option")].map((o) => o.value);

  test.each(STATUSES)("order is %s → the dropdown offers exactly the legal next statuses", async (status) => {
    const page = await openManage(status);
    const next = constants.ORDER_TRANSITIONS[status];
    const select = page.document.getElementById("newStatus");
    const button = page.document.getElementById("updateStatusBtn");
    if (next.length) {
      expect(options(page.document)).toEqual([...next]);
      expect(select.disabled).toBe(false);
      expect(button.disabled).toBe(false);
    } else {
      expect(select.disabled).toBe(true); // final: nothing to choose
      expect(button.disabled).toBe(true);
      expect(page.document.getElementById("statusHint").textContent).toMatch(/can no longer be changed/i);
    }
    await closePage(page.window);
  });

  test("a Confirmed order never offers Pending, and Out for Delivery never offers Cancelled", async () => {
    let page = await openManage("Confirmed");
    expect(options(page.document)).not.toContain("Pending");
    await closePage(page.window);
    page = await openManage("Out for Delivery");
    expect(options(page.document)).not.toContain("Cancelled");
    await closePage(page.window);
  });

  test("Update sends the chosen status with the CSRF token", async () => {
    const page = await openManage("Confirmed", {
      [`PUT /api/admin/orders/${id(1)}/status`]: ok(order(1, "Preparing"), "Order status updated to Preparing"),
    });
    page.document.getElementById("newStatus").value = "Preparing";
    page.document.getElementById("updateStatusBtn").click();
    await waitFor(() => page.calls.some((c) => c.method === "PUT"));
    const put = page.calls.find((c) => c.method === "PUT");
    expect(put.body).toEqual({ status: "Preparing" });
    expect(put.headers["X-CSRF-Token"]).toMatch(/^token-/);
    await closePage(page.window);
  });

  test("a 409 shows the server's message, then re-opens the order to show its real state", async () => {
    let current = "Confirmed";
    const page = await openManage("Confirmed", {
      [`GET /api/orders/${id(1)}`]: () => ok(order(1, current)),
      [`PUT /api/admin/orders/${id(1)}/status`]: () => {
        current = "Cancelled"; // someone cancelled it first
        return { status: 409, body: { success: false, message: 'This order was changed by someone else while you were updating it (it is now "Cancelled"). Please reload and try again.' } };
      },
    });
    page.document.getElementById("updateStatusBtn").click();
    await waitFor(() => page.document.getElementById("alertBox").textContent.includes("changed by someone else"));
    await waitFor(() => page.document.getElementById("newStatus").disabled === true); // re-rendered for the final status
    await closePage(page.window);
  });
});
