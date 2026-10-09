// UPI QR payments — the REAL pages (checkout.html, orders.html, admin-orders.html) + main.js run in jsdom with a stubbed API.
// The rule under test: a page shows "verified" ONLY when the server reports paymentStatus PAID. Showing a QR, a click on
// "Open UPI app", the countdown or time passing never produces a success message.

const { startServer, stopServer, loadPage, waitFor, closePage, ok } = require("../helpers/page");

const customer = { _id: "c".repeat(24), name: "Asha Rao", email: "asha@example.com", role: "customer", phone: "9876543210", address: { street: "12 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" } };
const admin = { ...customer, _id: "d".repeat(24), name: "Admin", role: "admin" };
const ORDER_ID = "e".repeat(24);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const HOSTILE = `<img src=x onerror="window.__pwned=1">`;

const cart = { items: [{ food: { name: "Biryani" }, quantity: 3, price: 250 }, { food: { name: "Lassi" }, quantity: 1, price: 100 }], total: 850 };
const pending = (extra = {}) => ({
  orderId: ORDER_ID, orderStatus: "Pending", paymentMethod: "UPI", paymentStatus: "PENDING", amount: 850, currency: "INR",
  items: [{ name: "Biryani", quantity: 3, price: 250 }, { name: "Lassi", quantity: 1, price: 100 }],
  paymentRef: "FH0123456789ABCDEF", expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), paidAt: null,
  message: "Waiting for your payment.", payee: { name: "FoodieHub", upiId: "shop@okicici" },
  upiUri: "upi://pay?pa=shop@okicici&pn=FoodieHub&am=850.00&cu=INR&tr=FH0123456789ABCDEF", qrDataUrl: PNG, ...extra,
});
const finished = (paymentStatus, message) => ({ ...pending({ paymentStatus, message }), qrDataUrl: undefined, upiUri: undefined, payee: undefined, orderStatus: paymentStatus === "PAID" ? "Pending" : "Cancelled" });

const methods = (upi = true) => ({ methods: [{ id: "Cash on Delivery", label: "Cash on Delivery", available: true }, { id: "UPI", label: "Online UPI QR Payment", available: upi }] });
const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const calls = (all, method, pathname) => all.filter((c) => c.method === method && c.pathname === pathname);

beforeAll(startServer);
afterAll(stopServer);

const openCheckout = async ({ upi = true, routes = {}, path = "/checkout.html", confirm = true } = {}) => {
  const page = await loadPage(path, { user: customer, confirm, routes: { "GET /api/cart": cart, "GET /api/payments/methods": methods(upi), ...routes } });
  await waitFor(() => page.document.getElementById("placeOrderBtn") || page.document.getElementById("upiPanel") || page.document.getElementById("paymentResult") || page.document.querySelector(".empty-state"));
  return page;
};
const chooseUpiAndPay = async (page) => {
  const radio = page.document.querySelector('input[name="payment"][value="UPI"]');
  radio.checked = true;
  radio.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  page.document.getElementById("placeOrderBtn").click();
};

describe("checkout.html — choosing the payment method", () => {
  test("offers Cash on Delivery (selected by default) and Online UPI QR Payment; button text follows the choice", async () => {
    const { document, window } = await openCheckout();
    const radios = [...document.querySelectorAll('input[name="payment"]')];
    expect(radios.map((r) => r.value)).toEqual(["Cash on Delivery", "UPI"]);
    expect(radios[0].checked).toBe(true);
    expect(radios[1].disabled).toBe(false);
    expect(text(document.getElementById("placeOrderBtn"))).toMatch(/Place Order/);

    radios[1].checked = true;
    radios[1].dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(text(document.getElementById("placeOrderBtn"))).toMatch(/Pay with UPI QR/);
    await closePage(window);
  });

  test("UPI not configured on the server: the option is disabled and says so; COD works", async () => {
    const { document, window } = await openCheckout({ upi: false });
    const upi = document.querySelector('input[name="payment"][value="UPI"]');
    expect(upi.disabled).toBe(true);
    expect(text(document.getElementById("upiOption"))).toMatch(/Not available/);
    await closePage(window);
  });

  test("the payment-methods call failing hides UPI instead of breaking checkout", async () => {
    const { document, window } = await openCheckout({ routes: { "GET /api/payments/methods": { status: 500, body: { success: false, message: "boom" } } } });
    expect(document.querySelector('input[name="payment"][value="UPI"]').disabled).toBe(true);
    expect(document.getElementById("placeOrderBtn")).not.toBeNull();
    await closePage(window);
  });

  test("Cash on Delivery is EXACTLY as before: POST /api/orders with Cash on Delivery, no payment call, redirect to My Orders", async () => {
    const { document, window, calls: all } = await openCheckout({ routes: { "POST /api/orders": { status: 201, body: { success: true, message: "ok", data: { order: { _id: ORDER_ID } } } } } });
    document.getElementById("placeOrderBtn").click();
    await waitFor(() => calls(all, "POST", "/api/orders").length === 1);
    expect(calls(all, "POST", "/api/orders")[0].body).toEqual({ deliveryAddress: { street: "12 MG Road", city: "Hyderabad", state: "Telangana", pincode: "500001" }, paymentMethod: "Cash on Delivery" });
    expect(calls(all, "POST", "/api/payments/upi")).toHaveLength(0);
    await closePage(window);
  });
});

describe("checkout.html — the UPI payment screen", () => {
  const start = async (routes = {}, options = {}) => {
    const page = await openCheckout({ routes: { "POST /api/payments/upi": { status: 201, body: { success: true, message: "Payment started", data: pending() } }, ...routes }, ...options });
    await chooseUpiAndPay(page);
    await waitFor(() => page.document.getElementById("upiPanel"));
    return page;
  };

  test("sends ONLY the address (never an amount) and shows order summary, exact amount, QR, payee, instructions, pending indicator, cancel", async () => {
    const { document, window, calls: all } = await start();

    const [call] = calls(all, "POST", "/api/payments/upi");
    expect(Object.keys(call.body)).toEqual(["deliveryAddress"]);
    expect(call.headers["X-CSRF-Token"]).toBeTruthy();

    expect(text(document.getElementById("payAmount"))).toBe("Amount to Pay: ₹850.00");
    expect(document.getElementById("upiQr").getAttribute("src")).toBe(PNG);
    expect(text(document.getElementById("upiPanel"))).toMatch(/FoodieHub/);
    expect(text(document.getElementById("upiPanel"))).toMatch(/shop@okicici/);
    expect(document.getElementById("openUpiApp").getAttribute("href")).toMatch(/^upi:\/\/pay\?pa=shop@okicici&.*am=850\.00/);
    expect(text(document.getElementById("payStatusText"))).toMatch(/Waiting for payment confirmation/);
    expect(document.querySelector("#payStatusLine .spinner")).not.toBeNull();
    expect(document.getElementById("payCountdown").textContent).toMatch(/time left 1[45]:\d\d/);
    expect(document.getElementById("cancelPaymentBtn")).not.toBeNull();
    expect(text(document.getElementById("checkoutContent"))).toMatch(/Biryani × 3/);
    expect(text(document.getElementById("checkoutContent"))).toMatch(/Lassi × 1/);
    expect(window.location.search).toBe(`?pay=${ORDER_ID}`); // a refresh resumes this payment
    await closePage(window);
  });

  test("while PENDING nothing says verified/success, there is no 'I have paid' button, and clicking 'Open UPI app' changes nothing", async () => {
    const { document, window, calls: all } = await start();
    const page = text(document.getElementById("checkoutContent"));
    expect(page).not.toMatch(/Payment verified|payment successful|✅/i);
    expect([...document.querySelectorAll("button, a")].map(text).join("|")).not.toMatch(/I have paid|I've paid|paid already/i);
    expect(document.querySelector(".toast-container")?.textContent || "").not.toMatch(/success|verified|paid/i);

    document.getElementById("openUpiApp").addEventListener("click", (e) => e.preventDefault());
    document.getElementById("openUpiApp").click();
    await new Promise((r) => setTimeout(r, 30));
    expect(document.getElementById("upiPanel")).not.toBeNull(); // still waiting
    expect(calls(all, "PUT", `/api/orders/${ORDER_ID}/cancel`)).toHaveLength(0);
    await closePage(window);
  });

  test("polls the SERVER; still pending → still waiting; then PAID → 'Payment verified' and the QR is gone", async () => {
    let status = "PENDING";
    const { document, window, calls: all } = await start({ [`GET /api/payments/${ORDER_ID}`]: () => ok(status === "PAID" ? finished("PAID", "Payment received and verified.") : pending()) });
    window.eval("POLL_MS = 15");
    // restart the timer with the short interval by re-rendering the (still pending) payment
    window.eval("renderPayment(currentPayment)");

    await waitFor(() => calls(all, "GET", `/api/payments/${ORDER_ID}`).length >= 3);
    expect(document.getElementById("upiPanel")).not.toBeNull();
    expect(text(document.getElementById("checkoutContent"))).not.toMatch(/Payment verified/);

    status = "PAID"; // the server (webhook / admin) has verified the payment
    await waitFor(() => document.getElementById("paymentResult"));
    expect(document.getElementById("paymentResult").dataset.paymentStatus).toBe("PAID");
    expect(text(document.getElementById("paymentResultTitle"))).toBe("Payment verified");
    expect(document.getElementById("upiQr")).toBeNull();
    expect(text(document.getElementById("checkoutContent"))).toMatch(/restaurant will now confirm/);
    expect(document.querySelector('a[href="/orders.html"]')).not.toBeNull();

    const polled = calls(all, "GET", `/api/payments/${ORDER_ID}`).length;
    await new Promise((r) => setTimeout(r, 80));
    expect(calls(all, "GET", `/api/payments/${ORDER_ID}`).length).toBe(polled); // polling stopped
    await closePage(window);
  });

  test.each([
    ["FAILED", "Payment failed", /Back to Cart/],
    ["EXPIRED", "Payment expired", /Back to Cart/],
    ["CANCELLED", "Payment cancelled", /Back to Cart/],
  ])("server says %s → '%s' (no success wording, no QR, a way back to the cart)", async (paymentStatus, title, back) => {
    const { document, window } = await start({ [`GET /api/payments/${ORDER_ID}`]: finished(paymentStatus, `Server says ${paymentStatus}`) });
    window.eval("POLL_MS = 15");
    window.eval("renderPayment(currentPayment)");
    await waitFor(() => document.getElementById("paymentResult"));
    expect(text(document.getElementById("paymentResultTitle"))).toBe(title);
    expect(text(document.getElementById("paymentResultText"))).toBe(`Server says ${paymentStatus}`);
    expect(text(document.getElementById("paymentResult"))).toMatch(back);
    expect(text(document.getElementById("paymentResult"))).not.toMatch(/verified/i);
    expect(document.getElementById("upiQr")).toBeNull();
    await closePage(window);
  });

  test("a polling error does not claim anything: the page keeps waiting and says it is retrying", async () => {
    const { document, window } = await start({ [`GET /api/payments/${ORDER_ID}`]: { status: 500, body: { success: false, message: "down" } } });
    window.eval("POLL_MS = 15");
    window.eval("renderPayment(currentPayment)");
    await waitFor(() => /Retrying/.test(text(document.getElementById("payStatusText"))));
    expect(document.getElementById("upiPanel")).not.toBeNull();
    await closePage(window);
  });

  test("Cancel payment: asks first; 'No' sends nothing; 'Yes' → PUT /orders/:id/cancel and the page shows what the server then reports", async () => {
    let cancelled = false;
    const routes = {
      [`PUT /api/orders/${ORDER_ID}/cancel`]: () => { cancelled = true; return ok({ _id: ORDER_ID }); },
      [`GET /api/payments/${ORDER_ID}`]: () => ok(cancelled ? finished("CANCELLED", "This payment was cancelled.") : pending()),
    };
    const declined = await start(routes, { confirm: false });
    declined.document.getElementById("cancelPaymentBtn").click();
    await new Promise((r) => setTimeout(r, 40));
    expect(calls(declined.calls, "PUT", `/api/orders/${ORDER_ID}/cancel`)).toHaveLength(0);
    expect(declined.document.getElementById("upiPanel")).not.toBeNull();
    await closePage(declined.window);

    const accepted = await start(routes, { confirm: true });
    accepted.document.getElementById("cancelPaymentBtn").click();
    await waitFor(() => accepted.document.getElementById("paymentResult"));
    expect(calls(accepted.calls, "PUT", `/api/orders/${ORDER_ID}/cancel`)).toHaveLength(1);
    expect(text(accepted.document.getElementById("paymentResultTitle"))).toBe("Payment cancelled");
    await closePage(accepted.window);
  });

  test("Cancel refused because the payment was verified in the meantime (409): shows the server's message, then the real state: PAID", async () => {
    let paid = false;
    const routes = {
      [`PUT /api/orders/${ORDER_ID}/cancel`]: () => { paid = true; return { status: 409, body: { success: false, message: "This order was already paid online, so it cannot be cancelled here." } }; },
      [`GET /api/payments/${ORDER_ID}`]: () => ok(paid ? finished("PAID", "Payment received and verified.") : pending()),
    };
    const { document, window } = await start(routes);
    document.getElementById("cancelPaymentBtn").click();
    await waitFor(() => document.getElementById("paymentResult"));
    expect(text(document.getElementById("paymentResultTitle"))).toBe("Payment verified");
    expect(text(document.getElementById("alertBox"))).toMatch(/already paid online/);
    await closePage(window);
  });

  test("a failed start (empty cart / unavailable item / UPI off) shows the server's message and re-enables the button; no QR", async () => {
    const page = await openCheckout({ routes: { "POST /api/payments/upi": { status: 400, body: { success: false, message: "\"Sold-out Biryani\" is currently unavailable." } } } });
    await chooseUpiAndPay(page);
    await waitFor(() => /unavailable/.test(text(page.document.getElementById("alertBox"))));
    expect(page.document.getElementById("upiQr")).toBeNull();
    expect(page.document.getElementById("placeOrderBtn").disabled).toBe(false);
    expect(text(page.document.getElementById("placeOrderBtn"))).toMatch(/Pay with UPI QR/);
    await closePage(page.window);
  });

  test("an address with a blank field is stopped in the browser before any request (UPI too)", async () => {
    const page = await openCheckout();
    page.document.getElementById("city").value = "";
    await chooseUpiAndPay(page);
    await waitFor(() => /fill in all/i.test(text(page.document.getElementById("alertBox"))));
    expect(calls(page.calls, "POST", "/api/payments/upi")).toHaveLength(0);
    await closePage(page.window);
  });

  test("?pay=<orderId> resumes the payment instead of the checkout form; an unknown payment shows an error", async () => {
    const resumed = await openCheckout({ path: `/checkout.html?pay=${ORDER_ID}`, routes: { [`GET /api/payments/${ORDER_ID}`]: pending() } });
    await waitFor(() => resumed.document.getElementById("upiPanel"));
    expect(text(resumed.document.getElementById("payAmount"))).toBe("Amount to Pay: ₹850.00");
    expect(resumed.document.getElementById("street")).toBeNull();                       // no address form, no "Place Order"
    expect(resumed.document.getElementById("placeOrderBtn")).toBeNull();
    expect(calls(resumed.calls, "GET", "/api/payments/methods")).toHaveLength(0);       // (the navbar's own cart-badge call is not checkout's)
    await closePage(resumed.window);

    const missing = await openCheckout({ path: `/checkout.html?pay=${ORDER_ID}`, routes: { [`GET /api/payments/${ORDER_ID}`]: { status: 403, body: { success: false, message: "You are not authorized to view this payment" } } } });
    await waitFor(() => /not authorized/.test(text(missing.document.getElementById("checkoutContent"))));
    await closePage(missing.window);

    const junk = await openCheckout({ path: "/checkout.html?pay=<script>1</script>" });
    expect(junk.document.getElementById("street")).not.toBeNull(); // not an id → ignored, normal checkout form
    await closePage(junk.window);
  });

  test("server text is rendered as text: hostile payee / item names and a hostile QR / link are not injected", async () => {
    const { document, window } = await start({
      "POST /api/payments/upi": { status: 201, body: { success: true, message: "ok", data: pending({
        payee: { name: HOSTILE, upiId: HOSTILE }, items: [{ name: HOSTILE, quantity: 1, price: 850 }],
        qrDataUrl: 'x" onerror="window.__pwned=1', upiUri: "javascript:window.__pwned=1",
      }) } },
    });
    expect(window.__pwned).toBeUndefined();
    expect(document.querySelector("#checkoutContent img[onerror]")).toBeNull();
    expect(document.getElementById("upiQr")).toBeNull();        // not a PNG data URL → no image at all
    expect(document.getElementById("openUpiApp")).toBeNull();   // not a upi://pay link → no link at all
    expect(text(document.getElementById("upiPanel"))).toContain("<img src=x");
    await closePage(window);
  });
});

describe("orders.html — customer's order list", () => {
  const order = (id, extra) => ({ _id: id.repeat(24), createdAt: new Date().toISOString(), items: [{ foodName: "Biryani", quantity: 1, price: 500 }], totalAmount: 500, orderStatus: "Pending", paymentMethod: "Cash on Delivery", ...extra });

  test("UPI orders show a payment badge; only an unpaid pending one offers 'Complete payment'; a PAID one has no Cancel button; COD shows no badge", async () => {
    const orders = [
      order("1", { paymentMethod: "UPI", paymentStatus: "PENDING" }),
      order("2", { paymentMethod: "UPI", paymentStatus: "PAID" }),
      order("3", { paymentMethod: "UPI", paymentStatus: "EXPIRED", orderStatus: "Cancelled" }),
      order("4"),
    ];
    const { document, window } = await loadPage("/orders.html", { user: customer, routes: { "GET /api/orders": orders } });
    await waitFor(() => document.querySelector('[data-action="showOrderDetail"]'));
    const card = (n) => document.querySelector(`.card[data-id="${n.repeat(24)}"]`);

    expect(text(card("1"))).toMatch(/Awaiting payment/);
    expect(card("1").querySelector('[data-action="payOrder"]')).not.toBeNull();
    expect(card("1").querySelector('[data-action="cancelOrder"]')).not.toBeNull();

    expect(text(card("2"))).toMatch(/\bPaid\b/);
    expect(card("2").querySelector('[data-action="payOrder"]')).toBeNull();
    expect(card("2").querySelector('[data-action="cancelOrder"]')).toBeNull(); // a paid online order needs a refund, not a cancel click

    expect(text(card("3"))).toMatch(/Payment expired/);
    expect(card("3").querySelector('[data-action="payOrder"]')).toBeNull();

    expect(card("4").querySelector(".badge-delivered, .badge-pending + div .badge")).toBeNull();
    expect(text(card("4"))).not.toMatch(/Awaiting payment|Paid|Payment/);
    expect(card("4").querySelector('[data-action="cancelOrder"]')).not.toBeNull(); // COD cancel unchanged
    await closePage(window);
  });

  test("'Complete payment' goes to checkout.html?pay=<id>", async () => {
    const { document, window } = await loadPage("/orders.html", { user: customer, routes: { "GET /api/orders": [order("1", { paymentMethod: "UPI", paymentStatus: "PENDING" })] } });
    await waitFor(() => document.querySelector('[data-action="payOrder"]'));
    const visited = [];
    window.navigateTo = (url) => visited.push(url);
    document.querySelector('[data-action="payOrder"]').click();
    expect(visited).toEqual([`/checkout.html?pay=${"1".repeat(24)}`]);
    await closePage(window);
  });
});

describe("admin-orders.html — confirming a UPI payment", () => {
  const upi = (extra = {}) => ({
    _id: ORDER_ID, createdAt: new Date().toISOString(), items: [{ foodName: "Biryani", quantity: 2, price: 250 }], totalAmount: 500,
    user: { name: "Asha Rao", email: "asha@example.com" }, deliveryAddress: customer.address,
    paymentMethod: "UPI", paymentStatus: "PENDING", paymentRef: "FH0123456789ABCDEF", orderStatus: "Pending", ...extra,
  });
  const openOrder = async (order, routes = {}) => {
    const page = await loadPage("/admin-orders.html", {
      user: admin, confirm: true,
      routes: { "GET /api/admin/orders": { orders: [order], pagination: { page: 1, totalPages: 1 } }, [`GET /api/orders/${ORDER_ID}`]: order, ...routes },
    });
    await waitFor(() => page.document.querySelector('[data-action="openOrderDetail"]'));
    page.document.querySelector('[data-action="openOrderDetail"]').click();
    await waitFor(() => page.document.getElementById("modalBody").textContent.includes("Delivery Address"));
    return page;
  };

  test("unpaid UPI order: payment section with UTR box; the status menu offers only Cancelled with the reason", async () => {
    const { document, window } = await openOrder(upi());
    expect(text(document.getElementById("paymentSection"))).toMatch(/FH0123456789ABCDEF/);
    expect(text(document.getElementById("paymentSection"))).toMatch(/₹500\.00/);
    expect(document.getElementById("paymentUtr")).not.toBeNull();
    expect([...document.getElementById("newStatus").options].map((o) => o.value)).toEqual(["Cancelled"]);
    expect(text(document.getElementById("statusHint"))).toMatch(/not verified yet/);
    await closePage(window);
  });

  test("Mark as PAID needs a UTR (nothing is sent without one) and then sends exactly { status, transactionId }", async () => {
    const { document, window, calls: all } = await openOrder(upi(), { [`PUT /api/admin/orders/${ORDER_ID}/payment`]: { status: 200, body: { success: true, message: "Payment marked as PAID", data: {} } } });

    document.querySelector('[data-action="markPayment"][data-result="PAID"]').click();
    await waitFor(() => /bank reference/i.test(text(document.getElementById("alertBox"))));
    expect(calls(all, "PUT", `/api/admin/orders/${ORDER_ID}/payment`)).toHaveLength(0);

    document.getElementById("paymentUtr").value = "  UTR123456789012 ";
    document.querySelector('[data-action="markPayment"][data-result="PAID"]').click();
    await waitFor(() => calls(all, "PUT", `/api/admin/orders/${ORDER_ID}/payment`).length === 1);
    expect(calls(all, "PUT", `/api/admin/orders/${ORDER_ID}/payment`)[0].body).toEqual({ status: "PAID", transactionId: "UTR123456789012" });
    await closePage(window);
  });

  test("Mark as FAILED sends only the status; a server refusal (409) is shown to the admin", async () => {
    const { document, window, calls: all } = await openOrder(upi(), { [`PUT /api/admin/orders/${ORDER_ID}/payment`]: { status: 409, body: { success: false, message: "This order is already paid, so it cannot be marked as failed" } } });
    document.querySelector('[data-action="markPayment"][data-result="FAILED"]').click();
    await waitFor(() => /already paid/.test(text(document.getElementById("alertBox"))));
    expect(calls(all, "PUT", `/api/admin/orders/${ORDER_ID}/payment`)[0].body).toEqual({ status: "FAILED" });
    await closePage(window);
  });

  test("PAID order: shows the UTR and who verified it, has no payment controls, and the normal status steps are offered", async () => {
    const { document, window } = await openOrder(upi({ paymentStatus: "PAID", paymentTransactionId: "UTR123456789012", paymentVerifiedBy: "admin", paidAt: new Date().toISOString() }));
    expect(text(document.getElementById("paymentSection"))).toMatch(/UTR123456789012/);
    expect(text(document.getElementById("paymentSection"))).toMatch(/Verified by\s*admin/);
    expect(document.getElementById("paymentUtr")).toBeNull();
    expect([...document.getElementById("newStatus").options].map((o) => o.value)).toEqual(["Confirmed", "Cancelled"]);
    await closePage(window);
  });

  test("a Cash on Delivery order has no payment section and the lifecycle menu is unchanged", async () => {
    const { document, window } = await openOrder(upi({ paymentMethod: "Cash on Delivery", paymentStatus: undefined, paymentRef: undefined }));
    expect(document.getElementById("paymentSection")).toBeNull();
    expect([...document.getElementById("newStatus").options].map((o) => o.value)).toEqual(["Confirmed", "Cancelled"]);
    await closePage(window);
  });

  test("a payment that closed (expired) before money arrived warns that the order is not reopened", async () => {
    const { document, window } = await openOrder(upi({ paymentStatus: "EXPIRED", orderStatus: "Cancelled" }));
    expect(text(document.getElementById("paymentSection"))).toMatch(/already closed \(expired\).*refund/);
    await closePage(window);
  });
});
