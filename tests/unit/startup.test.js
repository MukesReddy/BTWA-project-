// P1.2 — the REAL `node server.js` process: refuses unsafe configuration, and does not listen
// until MongoDB is connected. (Spawns child processes; no database needed.)

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

// dotenv never overrides a variable that is already present — even as "" — so a developer's own
// .env cannot leak into these runs as long as every setting is pinned here.
const run = (env) =>
  spawnSync(process.execPath, ["server.js"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20000,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "",
      MONGO_URI: "",
      SESSION_SECRET: "",
      PORT: "",
      CORS_ORIGINS: "",
      TRUST_PROXY: "",
      COOKIE_SECURE: "",
      RATE_LIMIT_DISABLED: "",
      ENABLE_DEMO_LOGIN: "",
      ...env,
    },
  });

jest.setTimeout(30000);

test("production without SESSION_SECRET / MONGO_URI exits 1 with a clear list of problems", () => {
  const r = run({ NODE_ENV: "production" });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/Invalid configuration/);
  expect(r.stderr).toMatch(/SESSION_SECRET is required in production/);
  expect(r.stderr).toMatch(/MONGO_URI is required/);
  expect(r.stdout).not.toMatch(/Server running/);
});

test("production with the old fallback secret is refused", () => {
  const r = run({ NODE_ENV: "production", MONGO_URI: "mongodb://127.0.0.1:1/x", SESSION_SECRET: "fallback_secret" });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/SESSION_SECRET/);
});

test("a mistyped NODE_ENV is refused", () => {
  const r = run({ NODE_ENV: "prod", MONGO_URI: "mongodb://127.0.0.1:1/x", SESSION_SECRET: "s".repeat(40) });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/NODE_ENV must be one of/);
});

test("an invalid PORT is refused", () => {
  const r = run({ NODE_ENV: "development", MONGO_URI: "mongodb://127.0.0.1:1/x", SESSION_SECRET: "s".repeat(20), PORT: "99999" });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/PORT must be an integer/);
});

test("when MongoDB is unreachable the server exits non-zero and never starts listening", () => {
  const r = run({
    NODE_ENV: "development",
    MONGO_URI: "mongodb://127.0.0.1:1/x?serverSelectionTimeoutMS=1500",
    SESSION_SECRET: "s".repeat(20),
    PORT: "45871",
  });
  expect(r.status).not.toBe(0);
  expect(r.stdout + r.stderr).toMatch(/MongoDB Connection Error/);
  expect(r.stdout).not.toMatch(/Server running/); // it used to listen first and connect afterwards
});
