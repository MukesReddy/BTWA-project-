// MaxListenersExceededWarning — regression test for the TEST-INFRASTRUCTURE cause.
//
// Cause (found with node --trace-warnings): a supertest agent given an Express *function* creates ONE
// http.Server and starts it lazily. When N requests are fired at once before it is listening, each
// request queues its own once('listening'), once('error') and once('close') listener on that single
// server, so N >= 10 produces "11 listening listeners added to [Server]". Nothing in the application
// leaks listeners; it is purely how the tests addressed the server.
// Fix: tests talk to ONE already-listening server per app (tests/helpers/client.js), so nothing is queued.

const app = require("../../server");
const { newAgent, serverFor } = require("../helpers/client");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("one listening server is shared per app and has no listener backlog", async () => {
  const a = await serverFor(app);
  const b = await serverFor(app);
  expect(a).toBe(b);
  expect(a.listening).toBe(true);
  expect(a.listenerCount("error")).toBe(0); // our own startup listener is removed once listening
});

test("a burst of 40 simultaneous requests emits no MaxListenersExceededWarning", async () => {
  const warnings = [];
  let before;
  const onWarning = (w) => warnings.push(w);
  process.on("warning", onWarning);
  try {
    const agent = await newAgent(app);
    const server = await serverFor(app);
    before = { listening: server.listenerCount("listening"), error: server.listenerCount("error"), close: server.listenerCount("close") };
    const results = await Promise.all(Array.from({ length: 40 }, () => agent.get("/api/health")));
    expect(results.every((r) => r.status === 200)).toBe(true);
    await sleep(50); // process warnings are emitted on the next tick
  } finally {
    process.off("warning", onWarning);
  }
  expect(warnings.filter((w) => w.name === "MaxListenersExceededWarning").map((w) => w.message)).toEqual([]);
  // Node keeps ONE internal 'listening' listener on every http.Server; the point is that it does not GROW.
  const server = await serverFor(app);
  expect({ listening: server.listenerCount("listening"), error: server.listenerCount("error"), close: server.listenerCount("close") }).toEqual(before);
});
