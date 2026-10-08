// Graceful shutdown of the REAL `node server.js` process (MongoDB connect replaced by a preload
// stub, so no database is needed). A normal shutdown means: exit code 0, not killed by a signal.
//
// Why two triggers: POSIX can deliver SIGTERM/SIGINT. Windows cannot — child.kill("SIGTERM") there
// force-terminates the process (exit code null) and no handler runs — so server.js also accepts an
// IPC "shutdown" message (the pm2 convention) for children spawned with an IPC channel.

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "../..");
jest.setTimeout(30000);

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const spawned = [];
afterEach(() => {
  // a failing test must never leave a server running (it would keep Jest alive)
  while (spawned.length) spawned.pop().kill("SIGKILL");
});

const start = async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["-r", path.join(ROOT, "tests/helpers/fakeMongoConnect.js"), "server.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      PATH: process.env.PATH, NODE_ENV: "development", MONGO_URI: "mongodb://fake/x", PORT: String(port),
      SESSION_SECRET: "s".repeat(40), CORS_ORIGINS: "", TRUST_PROXY: "", COOKIE_SECURE: "", RATE_LIMIT_DISABLED: "", ENABLE_DEMO_LOGIN: "",
    },
  });
  spawned.push(child);
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => /Server running/.test(output) && (clearInterval(timer), resolve()), 25);
    exited.then(() => (clearInterval(timer), reject(new Error(`exited before starting:\n${output}`))));
  });
  return { child, exited, port, output: () => output };
};

const get = (port, urlPath) =>
  new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, agent: false }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }).on("error", reject);
  });

const posixOnly = process.platform === "win32" ? test.skip : test;

posixOnly("SIGTERM → graceful shutdown, exit code 0 (not killed by the signal)", async () => {
  const server = await start();
  expect(await get(server.port, "/api/health")).toBe(200);
  server.child.kill("SIGTERM");
  expect(await server.exited).toEqual({ code: 0, signal: null });
  expect(server.output()).not.toMatch(/Error/);
});

posixOnly("SIGINT (Ctrl+C) → graceful shutdown, exit code 0", async () => {
  const server = await start();
  server.child.kill("SIGINT");
  expect(await server.exited).toEqual({ code: 0, signal: null });
});

test("IPC 'shutdown' message → graceful shutdown, exit code 0 (the Windows-capable path)", async () => {
  const server = await start();
  expect(await get(server.port, "/api/health")).toBe(200);
  server.child.send("shutdown");
  expect(await server.exited).toEqual({ code: 0, signal: null });
  // the port is released: nothing listens any more
  await expect(get(server.port, "/api/health")).rejects.toThrow(/ECONNREFUSED/);
});

test("an unrelated IPC message does NOT stop the server; a second shutdown request is harmless", async () => {
  const server = await start();
  server.child.send("hello");
  server.child.send({ shutdown: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await get(server.port, "/api/health")).toBe(200); // still serving
  server.child.send("shutdown");
  server.child.send("shutdown");
  expect(await server.exited).toEqual({ code: 0, signal: null });
});

test("a plain `node server.js` (no IPC channel) registers no message handler", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["-r", path.join(ROOT, "tests/helpers/fakeMongoConnect.js"), "server.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"], // no "ipc"
    env: { PATH: process.env.PATH, NODE_ENV: "development", MONGO_URI: "mongodb://fake/x", PORT: String(port), SESSION_SECRET: "s".repeat(40),
           CORS_ORIGINS: "", TRUST_PROXY: "", COOKIE_SECURE: "", RATE_LIMIT_DISABLED: "", ENABLE_DEMO_LOGIN: "" },
  });
  spawned.push(child);
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  await new Promise((resolve) => { const t = setInterval(() => /Server running/.test(output) && (clearInterval(t), resolve()), 25); });
  expect(child.connected).toBe(false);
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    expect(await exited).toEqual({ code: 0, signal: null });
  } else {
    child.kill();
    await exited;
  }
});
