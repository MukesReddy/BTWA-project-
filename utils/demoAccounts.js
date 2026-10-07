// utils/demoAccounts.js
// The accounts created by `npm run seed` that the login page offers as one-click demo buttons.
// They are only ever sent to the browser when config.demoLoginEnabled is true
// (development by default; production needs ENABLE_DEMO_LOGIN=true). See GET /api/auth/demo-accounts.
// Keep in sync with seed.js.

module.exports = [
  { label: "Admin Demo", icon: "⚙️", email: "admin@foodiehub.com", password: "admin123" },
  { label: "Customer Demo", icon: "👤", email: "rahul@example.com", password: "password123" },
];
