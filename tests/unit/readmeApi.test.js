// Batch 4 — the README's API tables must match the real router (both directions), so the
// documentation cannot silently drift again (it once described an API that no longer existed).
// Compares "METHOD /path" pairs; route parameter names are ignored (/:id and /:foodId are the same shape).

const fs = require("fs");
const path = require("path");
const app = require("../../server");

const normalize = (p) => p.replace(/:[A-Za-z]+/g, ":param").replace(/\/+$/, "") || "/";

/** "^\/api\/cart\/?(?=\/|$)" → "/api/cart" (Express 4 keeps a mounted router's prefix only as a RegExp). */
const mountPath = (layer) => {
  const source = layer.regexp.source
    .replace("^\\/?(?=\\/|$)", "") // mounted at "/"
    .replace("\\/?(?=\\/|$)", "")
    .replace(/^\^/, "")
    .replace(/\\\//g, "/");
  return source;
};

const realRoutes = () => {
  const found = new Set();
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          found.add(`${method.toUpperCase()} ${normalize(prefix + layer.route.path)}`);
        }
      } else if (layer.name === "router" && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk(app._router.stack, "");
  return [...found].filter((route) => route.split(" ")[1].startsWith("/api"));
};

const documentedRoutes = () => {
  const readme = fs.readFileSync(path.join(__dirname, "../../README.md"), "utf8");
  const section = readme.slice(readme.indexOf("## API Endpoints"), readme.indexOf("## Order Lifecycle"));
  const found = new Set();
  for (const line of section.split("\n")) {
    const match = line.match(/^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*(\/api\S*)\s*\|/);
    if (match) found.add(`${match[1]} ${normalize(match[2])}`);
  }
  return [...found];
};

describe("README API tables vs the real router", () => {
  const real = realRoutes();
  const documented = documentedRoutes();

  test("the router walk really found the API (guards against this test silently comparing nothing)", () => {
    expect(real.length).toBeGreaterThanOrEqual(30);
    expect(real).toEqual(expect.arrayContaining(["POST /api/orders", "PUT /api/orders/:param/cancel", "PUT /api/admin/users/:param/reactivate"]));
    expect(documented.length).toBeGreaterThanOrEqual(30);
  });

  test("every endpoint in the README exists", () => {
    expect(documented.filter((route) => !real.includes(route))).toEqual([]);
  });

  test("every real /api endpoint is documented in the README", () => {
    expect(real.filter((route) => !documented.includes(route))).toEqual([]);
  });
});
