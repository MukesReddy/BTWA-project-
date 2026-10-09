// Final batch — admin-food.html pages its list.
// The API returns at most 50 foods per page. The page used to request '/foods?limit=50' once, so with more
// than 50 foods the extra ones could never be edited or deleted from this screen.
// The REAL page + main.js run in jsdom with a stubbed fetch (tests/helpers/page.js).

const { startServer, stopServer, loadPage, waitFor, closePage, ok } = require("../helpers/page");

const id = (n) => String(n).padStart(24, "0");
const admin = { _id: id(900), name: "Boss", email: "boss@example.com", role: "admin" };
const HOSTILE = `Spicy <img src=x onerror="window.__pwned=1">`;

const food = (n, over = {}) => ({
  _id: id(n), name: `Food ${n}`, price: 100, rating: 4, available: true, image: "https://example.com/f.jpg",
  category: { _id: id(800), name: "Biryani" }, ...over,
});

/** A fake GET /api/foods that really pages `all` the way the API does (page, limit). */
const pagedFoods = (all, requests = []) => (_body, url) => {
  const params = new URL(url, "http://x").searchParams;
  const page = Number(params.get("page") || 1);
  const limit = Number(params.get("limit") || 12);
  requests.push({ page, limit });
  return ok({
    foods: all.slice((page - 1) * limit, page * limit),
    pagination: { total: all.length, page, limit, totalPages: Math.ceil(all.length / limit) },
  });
};

const click = (window, el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const names = (document) => [...document.querySelectorAll("tbody tr td:nth-child(2)")].map((td) => td.textContent.trim());
const pageButtons = (document) => [...document.querySelectorAll('#pagination [data-action="changePage"]')];

beforeAll(startServer);
afterAll(stopServer);

describe("admin-food.html — paging", () => {
  test("a short list (like the seed data) is ONE request and shows no pager", async () => {
    const requests = [];
    const all = Array.from({ length: 18 }, (_v, i) => food(i + 1));
    const page = await loadPage("/admin-food.html", { user: admin, routes: { "GET /api/categories": [], "GET /api/foods": pagedFoods(all, requests) } });
    await waitFor(() => names(page.document).length === 18);

    expect(requests).toEqual([{ page: 1, limit: 20 }]);
    expect(pageButtons(page.document)).toHaveLength(0);
    await closePage(page.window);
  });

  test("more foods than one page: a pager appears and EVERY food is reachable (nothing is cut off)", async () => {
    const requests = [];
    const all = Array.from({ length: 45 }, (_v, i) => food(i + 1));
    const page = await loadPage("/admin-food.html", { user: admin, routes: { "GET /api/categories": [], "GET /api/foods": pagedFoods(all, requests) } });
    await waitFor(() => names(page.document).length === 20);
    const { document, window } = page;

    expect(names(document)[0]).toBe("Food 1");
    expect(pageButtons(document).map((b) => b.textContent)).toEqual(["1", "2", "3"]);
    expect(document.querySelector("#pagination .btn-primary").textContent).toBe("1"); // current page highlighted

    click(window, pageButtons(document)[2]); // page 3 = the last 5 foods, which the old single request never showed
    await waitFor(() => names(document).length === 5);

    expect(names(document)).toEqual(["Food 41", "Food 42", "Food 43", "Food 44", "Food 45"]);
    expect(requests.at(-1)).toEqual({ page: 3, limit: 20 });
    expect(document.querySelector("#pagination .btn-primary").textContent).toBe("3");
    await closePage(window);
  });

  test("every row of a later page still has working Edit / Delete buttons", async () => {
    const all = Array.from({ length: 25 }, (_v, i) => food(i + 1));
    const page = await loadPage("/admin-food.html", { user: admin, routes: { "GET /api/categories": [], "GET /api/foods": pagedFoods(all) } });
    await waitFor(() => names(page.document).length === 20);
    click(page.window, pageButtons(page.document)[1]);
    await waitFor(() => names(page.document).length === 5);

    const ids = [...page.document.querySelectorAll('[data-action="editFood"]')].map((b) => b.dataset.id);
    expect(ids).toEqual([21, 22, 23, 24, 25].map(id));
    expect(page.document.querySelectorAll('[data-action="deleteFood"]')).toHaveLength(5);
    await closePage(page.window);
  });

  test("if the page you are on becomes empty (its last food was deleted) it steps back to the new last page", async () => {
    const requests = [];
    const all = Array.from({ length: 21 }, (_v, i) => food(i + 1)); // page 2 holds exactly one food
    const page = await loadPage("/admin-food.html", {
      user: admin,
      routes: {
        "GET /api/categories": [],
        "GET /api/foods": pagedFoods(all, requests),
        [`DELETE /api/foods/${id(21)}`]: () => { all.splice(20); return { status: 200, body: { success: true, message: "Food item deleted successfully" } }; },
      },
    });
    await waitFor(() => names(page.document).length === 20);
    click(page.window, pageButtons(page.document)[1]);
    await waitFor(() => names(page.document).length === 1);

    click(page.window, page.document.querySelector('[data-action="deleteFood"]'));
    await waitFor(() => page.calls.some((c) => c.method === "DELETE"));
    await waitFor(() => requests.length >= 4);
    await waitFor(() => names(page.document).length === 20);

    expect(requests.map((r) => r.page).slice(-2)).toEqual([2, 1]); // asked for page 2 (empty) → fell back to page 1
    expect(pageButtons(page.document)).toHaveLength(0); // 20 foods left = one page, no pager
    await closePage(page.window);
  });

  test("an API error shows the error text and no stale pager", async () => {
    const page = await loadPage("/admin-food.html", {
      user: admin,
      routes: { "GET /api/categories": [], "GET /api/foods": { status: 500, body: { success: false, message: "boom" } } },
    });
    await waitFor(() => page.document.getElementById("foodTable").textContent.includes("Error loading foods"));
    expect(page.document.getElementById("pagination").innerHTML).toBe("");
    await closePage(page.window);
  });

  test("food names stay escaped on every page (no markup injection through the table)", async () => {
    const all = [food(1, { name: HOSTILE })];
    const page = await loadPage("/admin-food.html", { user: admin, routes: { "GET /api/categories": [], "GET /api/foods": pagedFoods(all) } });
    await waitFor(() => names(page.document).length === 1);
    expect(page.document.querySelector("tbody td:nth-child(2) img")).toBeNull();
    expect(page.window.__pwned).toBeUndefined();
    await closePage(page.window);
  });
});
