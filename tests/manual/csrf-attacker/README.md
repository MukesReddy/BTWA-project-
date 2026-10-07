# Manual cross-origin (CSRF) browser check

`npm test` replays what a malicious page makes a browser send (cookie + foreign `Origin`, form posts,
`text/plain` tricks, preflights). This folder lets you watch **a real browser** do it.

1. Start the app: `npm run dev` (http://localhost:5000), log in as a customer, add nothing to the cart.
2. Start the attacker: `node tests/manual/csrf-attacker/server.js` → open http://localhost:5001
   (`localhost:5001` and `localhost:5000` are the same *site*, so `SameSite=Lax` alone would not stop it).
3. Copy a food id (`/api/foods`) into the page and press each attack button.
4. Expected: nothing succeeds (preflight blocked / 403 / 415), the terminal shows no `200` for these
   requests, and your cart, orders and login are unchanged.
