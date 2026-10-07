// tests/helpers/client.js — supertest clients that behave like our real frontend.
//
// 1. ONE listening server per app (not one per request / per agent).
//    supertest, when given an Express app, creates an http.Server and only starts listening on the
//    first request. If 10 requests are fired at once before it is listening, every one of them
//    queues its own once('listening'/'error'/'close') listeners on that single server, which is
//    what produced "MaxListenersExceededWarning: 11 listening listeners added to [Server]".
//    Handing supertest a server that is ALREADY listening avoids the queueing completely.
//
// 2. CSRF token handling, exactly like public/js/main.js: fetch GET /api/auth/csrf, then send the
//    token as X-CSRF-Token on writes. The token belongs to the session, so it is refreshed after
//    login (the session id is regenerated).

const http = require("http");
const request = require("supertest");

const servers = new Map(); // app -> Promise<http.Server>

const serverFor = (app) => {
  if (!servers.has(app)) {
    servers.set(
      app,
      new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject); // only meant for startup failures; do not leave it attached
          resolve(server);
        });
      })
    );
  }
  return servers.get(app);
};

/** Closes every server started by serverFor (registered as afterAll in setupAfterEnv.js). */
const closeServers = async () => {
  const pending = [...servers.values()];
  servers.clear();
  for (const promise of pending) {
    const server = await promise;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
};

/** Fetches a fresh CSRF token for this agent's current session and sends it on every later request. */
const refreshCsrf = async (agent) => {
  const res = await agent.get("/api/auth/csrf");
  if (res.status !== 200) throw new Error(`could not get a CSRF token: ${res.status} ${JSON.stringify(res.body)}`);
  agent.set("X-CSRF-Token", res.body.data.csrfToken);
  return res.body.data.csrfToken;
};

/** A cookie-keeping agent on the shared server. By default it already holds a CSRF token. */
const newAgent = async (app, { csrf = true } = {}) => {
  const agent = request.agent(await serverFor(app));
  if (csrf) await refreshCsrf(agent);
  return agent;
};

/** One-off request without cookies (e.g. public GETs). */
const anonymous = async (app) => request(await serverFor(app));

/** "Cookie: ..." header value an agent would send (the victim's session, for attack simulations). */
const cookieHeader = (agent) => {
  const { CookieAccessInfo } = require("cookiejar");
  return agent.jar.getCookies(new CookieAccessInfo("127.0.0.1", "/")).toValueString();
};

/** The origin a browser on our own pages would send, e.g. "http://127.0.0.1:41233". */
const originFor = async (app) => `http://127.0.0.1:${(await serverFor(app)).address().port}`;

module.exports = { serverFor, closeServers, refreshCsrf, newAgent, anonymous, cookieHeader, originFor };
