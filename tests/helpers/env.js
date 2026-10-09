// Runs before every test file (jest "setupFiles").
// Pin every setting that config/env.js reads, so a developer's own .env file (dotenv never overrides
// variables that are already set, even to "") can never change what the tests see.
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.RATE_LIMIT_DISABLED = "true"; // rate-limit tests build their own app with explicit limits
process.env.CORS_ORIGINS = "";
process.env.TRUST_PROXY = "";
process.env.COOKIE_SECURE = "";
process.env.ENABLE_DEMO_LOGIN = "";
process.env.PORT = "";
// UPI payments are OFF unless a test builds its own app with these set (a developer's .env must not switch them on).
process.env.UPI_ID = "";
process.env.UPI_PAYEE_NAME = "";
process.env.UPI_PAYMENT_WINDOW_MINUTES = "";
process.env.PAYMENT_WEBHOOK_SECRET = "";
