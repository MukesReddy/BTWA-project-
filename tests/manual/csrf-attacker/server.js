// tests/manual/csrf-attacker/server.js — MANUAL browser check for CSRF (P1.5). Not part of `npm test`.
// Serves an "attacker" page on http://localhost:5001 that tries to make YOUR browser send forged,
// state-changing requests to the food app on http://localhost:5000 using YOUR login cookie.
// localhost:5001 and localhost:5000 are the same SITE (only the port differs), so SameSite=Lax would
// NOT stop these — only the Origin check, JSON-only rule and CSRF token do.
//   usage:  node tests/manual/csrf-attacker/server.js   (then see tests/manual/csrf-attacker/README.md)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.ATTACKER_PORT) || 5001;
const page = fs.readFileSync(path.join(__dirname, "index.html"));

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page);
  })
  .listen(PORT, () => console.log(`Attacker page: http://localhost:${PORT}  (target app: http://localhost:5000)`));
