// Batch 5 — profile.html: Change Password card.
// The REAL page + main.js run in jsdom with a stubbed fetch (tests/helpers/page.js). The server enforces every
// rule (current password, 6–72, sessions); the page only collects the values, blocks a typo, and handles the reply.

const { startServer, stopServer, loadPage, waitFor, closePage, ok } = require("../helpers/page");

const customer = { _id: "a".repeat(24), name: "Asha Rao", email: "asha@example.com", role: "customer", phone: "9876543210", address: {} };
const HOSTILE = `<img src=x onerror="window.__pwned=1">`;

beforeAll(startServer);
afterAll(stopServer);

const toast = (document) => document.querySelector(".toast-container")?.textContent || "";
const field = (document, id) => document.getElementById(id);
const fill = (document, { current = "oldPass123", next = "brandNew456", confirm = next } = {}) => {
  field(document, "currentPassword").value = current;
  field(document, "newPassword").value = next;
  field(document, "confirmPassword").value = confirm;
};
const submit = (document) => {
  document.getElementById("passwordForm").dispatchEvent(new document.defaultView.Event("submit", { bubbles: true, cancelable: true }));
};
const passwordCalls = (calls) => calls.filter((c) => c.pathname === "/api/users/password");

const open = async (routes = {}) => {
  const page = await loadPage("/profile.html", { user: customer, routes });
  await waitFor(() => page.document.getElementById("passwordForm"));
  return page;
};

describe("profile.html — Change Password card", () => {
  test("renders three password fields with the right autocomplete hints, next to the existing forms", async () => {
    const { document, window } = await open();

    expect(["currentPassword", "newPassword", "confirmPassword"].map((id) => field(document, id).type)).toEqual(["password", "password", "password"]);
    expect(field(document, "currentPassword").autocomplete).toBe("current-password");
    expect(field(document, "newPassword").autocomplete).toBe("new-password");
    expect(field(document, "newPassword").minLength).toBe(6);
    expect(field(document, "newPassword").maxLength).toBe(72);
    expect(document.getElementById("profileForm")).not.toBeNull(); // existing cards untouched
    expect(document.getElementById("addressForm")).not.toBeNull();
    expect(document.getElementById("savePasswordBtn").textContent).toMatch(/change password/i);
    await closePage(window);
  });

  test("a confirmation that does not match is blocked in the browser: no request is sent", async () => {
    const { document, window, calls } = await open();
    fill(document, { next: "brandNew456", confirm: "brandNew457" });

    submit(document);
    await waitFor(() => document.getElementById("alertBox").textContent.includes("do not match"));

    expect(passwordCalls(calls)).toHaveLength(0);
    expect(field(document, "currentPassword").value).toBe("oldPass123"); // nothing was cleared, the user can fix the typo
    await closePage(window);
  });

  test("success: ONE PUT with only the two passwords in the JSON body, CSRF header, nothing in the URL", async () => {
    const { document, window, calls } = await open({
      "PUT /api/users/password": { status: 200, body: { success: true, message: "Password changed. Other devices have been signed out." } },
    });
    fill(document);

    submit(document);
    await waitFor(() => toast(document).includes("Password changed"));

    const sent = passwordCalls(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("PUT");
    expect(sent[0].url).toBe("/api/users/password"); // no query string
    expect(sent[0].body).toEqual({ currentPassword: "oldPass123", newPassword: "brandNew456" }); // no confirmPassword
    expect(sent[0].headers["X-CSRF-Token"]).toBe("token-1");
    expect(toast(document)).toContain("Other devices have been signed out");
    await closePage(window);
  });

  test("success clears all three fields (no password left sitting in the form) and re-enables the button", async () => {
    const { document, window } = await open({ "PUT /api/users/password": { status: 200, body: { success: true, message: "Password changed." } } });
    fill(document);

    submit(document);
    await waitFor(() => toast(document).includes("Password changed"));

    expect(["currentPassword", "newPassword", "confirmPassword"].map((id) => field(document, id).value)).toEqual(["", "", ""]);
    expect(document.getElementById("savePasswordBtn").disabled).toBe(false);
    expect(document.getElementById("savePasswordBtn").textContent).toMatch(/change password/i);
    await closePage(window);
  });

  test("success drops an earlier error alert", async () => {
    let first = true;
    const { document, window } = await open({
      "PUT /api/users/password": () => {
        if (first) { first = false; return { status: 400, body: { success: false, message: "Current password is incorrect" } }; }
        return { status: 200, body: { success: true, message: "Password changed." } };
      },
    });
    fill(document);
    submit(document);
    await waitFor(() => document.getElementById("alertBox").textContent.includes("incorrect"));

    submit(document);
    await waitFor(() => toast(document).includes("Password changed"));

    expect(document.getElementById("alertBox").textContent).toBe("");
    await closePage(window);
  });

  test("a wrong current password (400) shows the server's message and keeps what was typed", async () => {
    const { document, window } = await open({
      "PUT /api/users/password": { status: 400, body: { success: false, message: "Current password is incorrect" } },
    });
    fill(document);

    submit(document);
    await waitFor(() => document.getElementById("alertBox").textContent.includes("Current password is incorrect"));

    expect(toast(document)).not.toMatch(/Password changed/);
    expect(field(document, "newPassword").value).toBe("brandNew456"); // not wiped on failure
    expect(document.getElementById("savePasswordBtn").disabled).toBe(false); // can retry
    await closePage(window);
  });

  test("a 429 (too many failed attempts) is shown as an error, not as success", async () => {
    const message = "Too many failed password change attempts. Please try again in 14 minutes.";
    const { document, window } = await open({ "PUT /api/users/password": { status: 429, body: { success: false, message, code: "RATE_LIMITED" } } });
    fill(document);

    submit(document);
    await waitFor(() => document.getElementById("alertBox").textContent.includes("Too many failed"));

    expect(document.querySelector("#alertBox .alert-error")).not.toBeNull();
    expect(toast(document)).not.toMatch(/changed/i);
    await closePage(window);
  });

  test("server text is escaped: an HTML message cannot inject markup", async () => {
    const { document, window } = await open({ "PUT /api/users/password": { status: 400, body: { success: false, message: HOSTILE } } });
    fill(document);

    submit(document);
    await waitFor(() => document.getElementById("alertBox").textContent.includes("onerror"));

    expect(document.querySelector("#alertBox img")).toBeNull();
    expect(window.__pwned).toBeUndefined();
    await closePage(window);
  });

  test("the CSRF token is dropped after a change (the session id changed), so the NEXT write fetches a fresh one", async () => {
    const { document, window, calls } = await open({
      "PUT /api/users/password": { status: 200, body: { success: true, message: "Password changed." } },
      "PUT /api/users/profile": ok({ user: customer }),
    });
    fill(document);
    submit(document);
    await waitFor(() => toast(document).includes("Password changed"));
    expect(calls.filter((c) => c.pathname === "/api/auth/csrf")).toHaveLength(1);

    document.getElementById("profileForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => calls.some((c) => c.pathname === "/api/users/profile" && c.method === "PUT"));

    expect(calls.filter((c) => c.pathname === "/api/auth/csrf")).toHaveLength(2); // a second token was requested
    const profile = calls.find((c) => c.pathname === "/api/users/profile" && c.method === "PUT");
    expect(profile.headers["X-CSRF-Token"]).toBe("token-2"); // NOT the dead token-1
    await closePage(window);
  });

  test("the page does not log passwords or crash (no jsdom errors)", async () => {
    const page = await open({ "PUT /api/users/password": { status: 200, body: { success: true, message: "Password changed." } } });
    const spy = jest.spyOn(page.window.console, "log").mockImplementation(() => {});
    fill(page.document);
    submit(page.document);
    await waitFor(() => toast(page.document).includes("Password changed"));

    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/oldPass123|brandNew456/);
    expect(page.errors).toEqual([]);
    await closePage(page.window);
  });
});
