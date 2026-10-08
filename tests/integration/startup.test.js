// P1.2 / P1.3 / P1.4 / P1.5 against the REAL server process: `node server.js` with a real MongoDB,
// the real connect-mongo session store (sharing Mongoose's connection), real sockets and real cookies.
// (Everything else drives the Express app in-process; this proves the wiring in server.js itself.)

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const mongoose = require("mongoose");
const request = require("supertest");
const { connectTestDb, clearTestDb, disconnectTestDb, getTestMongoUri } = require("../helpers/db");
const { createUser, PASSWORD } = require("../helpers/factories");

const ROOT = path.join(__dirname, "../..");

beforeAll(connectTestDb);
beforeEach(clearTestDb);
afterAll(disconnectTestDb);
jest.setTimeout(40000);

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** Starts the real server; resolves once it prints its "running" line (i.e. AFTER it connected to MongoDB). */
const startServer = async (extraEnv = {}) => {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe", "ipc"], // IPC channel: the only way to ask a child to shut down gracefully on Windows
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "development",
      MONGO_URI: getTestMongoUri(),
      SESSION_SECRET: "e2e-" + "s".repeat(30),
      PORT: String(port),
      CORS_ORIGINS: "",
      TRUST_PROXY: "",
      COOKIE_SECURE: "",
      RATE_LIMIT_DISABLED: "",
      ENABLE_DEMO_LOGIN: "",
      ...extraEnv,
    },
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start in time. Output:\n${output}`)), 20000);
    const check = setInterval(() => {
      if (/Server running/.test(output)) { clearTimeout(timer); clearInterval(check); resolve(); }
    }, 50);
    exited.then(({ code }) => { clearTimeout(timer); clearInterval(check); reject(new Error(`server exited early (code ${code}). Output:\n${output}`)); });
  });
  return { base: `http://127.0.0.1:${port}`, child, exited, output: () => output };
};

/**
 * Asks the server to shut down gracefully and asserts it exited normally (code 0, not killed).
 *   POSIX:   a real SIGTERM, which exercises the process.once("SIGTERM") handler.
 *   Windows: child.kill("SIGTERM") does NOT deliver a signal there, it force-terminates the process
 *            (exit code null) so no handler can ever run. Windows therefore uses the IPC "shutdown"
 *            message that server.js handles with the same shutdown() function.
 */
const stop = async (server) => {
  if (process.platform === "win32") server.child.send("shutdown");
  else server.child.kill("SIGTERM");

  const result = await Promise.race([
    server.exited,
    new Promise((resolve) => setTimeout(() => resolve({ code: "TIMEOUT", signal: null }), 15000)),
  ]);
  if (result.code === "TIMEOUT") server.child.kill("SIGKILL"); // do not leak the process
  const detail = `platform=${process.platform} exit code=${result.code} signal=${result.signal}\n--- server output ---\n${server.output()}`;
  if (result.code !== 0) throw new Error(`server did not shut down gracefully: ${detail}`);
  return result;
};

/** Runs fn against a started server, always stops it gracefully, and reports the FIRST failure. */
const withServer = async (env, fn) => {
  const server = await startServer(env);
  let failure;
  try {
    await fn(server);
  } catch (error) {
    failure = error;
  }
  try {
    await stop(server);
  } catch (error) {
    failure = failure || error;
  }
  if (failure) throw failure;
};

test("real server: connects first, serves the app, issues CSRF tokens, logs in with a real session store, and shuts down cleanly", async () => {
  await withServer({}, async (server) => {
    const health = await request(server.base).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.headers["x-powered-by"]).toBeUndefined();
    expect(health.headers["x-content-type-options"]).toBe("nosniff"); // helmet

    const user = await createUser();
    const agent = request.agent(server.base);
    const token = (await agent.get("/api/auth/csrf")).body.data.csrfToken;
    agent.set("X-CSRF-Token", token);

    // a write without Origin/with token but the WRONG content type is refused
    expect((await agent.post("/api/auth/login").type("form").send({ email: user.email, password: PASSWORD })).status).toBe(415);

    const login = await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"].find((c) => c.startsWith("foodiehub.sid="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/;\s*Secure/i); // development: plain http

    // the session really is in MongoDB (shared connection, same database)
    expect(await mongoose.connection.collection("sessions").countDocuments({ session: { $regex: `"userId":"${user.id}"` } })).toBe(1);

    // cross-origin write from the victim's browser is refused by the REAL process too
    const forged = await request(server.base).post("/api/auth/logout").set("Cookie", cookie.split(";")[0]).set("Origin", "https://evil.example");
    expect(forged.status).toBe(403);
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    // development default: demo accounts are offered
    expect((await request(server.base).get("/api/auth/demo-accounts")).status).toBe(200);
  });
});

test("real server: brute-force protection is ON by default (11th wrong password for one account → 429)", async () => {
  await withServer({}, async (server) => {
    const user = await createUser();
    const agent = request.agent(server.base);
    agent.set("X-CSRF-Token", (await agent.get("/api/auth/csrf")).body.data.csrfToken);

    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await agent.post("/api/auth/login").send({ email: user.email, password: "wrong-password" })).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);

    // …and even the right password is refused while the window is exhausted (that is the point)
    expect((await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(429);
  });
});

test("real server in production mode: demo accounts are hidden, cookie is Secure behind the proxy, and no environment leaks", async () => {
  await withServer({ NODE_ENV: "production", SESSION_SECRET: "prod-" + "s".repeat(40), TRUST_PROXY: "1" }, async (server) => {
    expect((await request(server.base).get("/api/auth/demo-accounts")).status).toBe(404);

    const csrf = await request(server.base).get("/api/auth/csrf").set("X-Forwarded-Proto", "https");
    const cookie = csrf.headers["set-cookie"].find((c) => c.startsWith("foodiehub.sid="));
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);

    const health = await request(server.base).get("/api/health");
    expect(health.body).not.toHaveProperty("environment");

    const notFound = await request(server.base).get("/api/definitely-not-a-route");
    expect(notFound.status).toBe(404);
    expect(JSON.stringify(notFound.body)).not.toMatch(/node_modules|at .*\.js:/);
  });
});
