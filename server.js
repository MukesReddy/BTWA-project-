// server.js
// FoodieHub — Online Food Ordering System
// Main application entry point
//
// BTWA Module 7: Express.js server setup
// BTWA Module 9: Middleware stack
// BTWA Module 10: Sessions and cookies
// BTWA Module 6: npm, Node.js architecture

const express = require("express");      // BTWA Module 7: Express framework
const cors = require("cors");            // BTWA Module 9: CORS middleware
const morgan = require("morgan");        // BTWA Module 9: HTTP request logger
const helmet = require("helmet");        // BTWA Module 9: Security headers
const session = require("express-session"); // BTWA Module 10: Session management
const { MongoStore } = require("connect-mongo");
const mongoose = require("mongoose");
const path = require("path");
const fs   = require("fs");   // BTWA Module 4: Node.js filesystem
const dotenv = require("dotenv");

// Load environment variables FIRST (BTWA Module 4: Configuration)
dotenv.config();

// Import custom modules (BTWA Module 5: require/module.exports)
const connectDB = require("./config/db");
const { getConfig } = require("./config/env");
const logger = require("./utils/logger");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const { createRateLimiters } = require("./middleware/rateLimiters");
const { createCsrfProtection } = require("./middleware/csrfMiddleware");

// Import route modules (BTWA Module 8: REST routing)
const authRoutes = require("./routes/authRoutes");
const foodRoutes = require("./routes/foodRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");

// ─── Validate configuration (fail fast) ───────────────────────────────────────
// BTWA Module 4: Configuration. A production server with a missing/placeholder SESSION_SECRET,
// a mistyped NODE_ENV or no MONGO_URI refuses to start and says exactly what is wrong.
let config;
try {
  config = getConfig();
} catch (error) {
  if (require.main === module) {
    console.error(`\n❌ ${error.message}\n`);
    process.exit(1);
  }
  throw error; // imported (tests): let the caller see it
}

/**
 * createApp
 * Builds the Express application from a validated config object. Exported so tests can build
 * the app with different settings (trusted origins, tiny rate limits, …) without touching process.env.
 *
 * @param {object} [appConfig]  result of loadConfig() (defaults to the real process configuration)
 * @param {object} [options]
 * @param {object} [options.sessionStore]  override the session store (tests use the in-memory store)
 * @param {object} [options.rateLimits]    override individual rate limits (tests use tiny numbers)
 */
const createApp = (appConfig = config, options = {}) => {
  // Tests set NODE_ENV=test: no log files / console noise, and an in-memory session store
  // instead of connect-mongo (which would open its own MongoDB connection on import).
  const isTest = appConfig.isTest;

  // ─── Initialize Express App ─────────────────────────────────────────────────
  const app = express();

  // Handlers read their settings from the app that is serving them (req.app.locals.config),
  // so every createApp(config) instance is self-contained.
  app.locals.config = appConfig;

  // Behind nginx / a PaaS router, req.ip is the proxy unless told otherwise (matters for rate limits).
  app.set("trust proxy", appConfig.trustProxy);

  // "simple" query parser: ?role[$ne]=x stays a plain key, never a nested {$ne: "x"} object that
  // could be spliced into a MongoDB filter (NoSQL operator injection). The app never needs nested queries.
  app.set("query parser", "simple");

  // ─── Middleware Stack ───────────────────────────────────────────────────────
  // Order matters! Middleware executes top-to-bottom
  // BTWA Module 9: Middleware ordering and usage

  // 1. Security headers (Helmet)
  // BTWA Module 9: Helmet security middleware
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disabled to allow inline scripts in HTML
    })
  );

  // 2. CORS — Cross-Origin Resource Sharing
  // BTWA Module 9: CORS configuration
  // The pages are served by THIS server, so same-origin requests need no CORS at all. Cross-origin
  // access is therefore OFF unless origins are listed in CORS_ORIGINS. (It used to reflect every
  // origin with credentials in development, i.e. any website could read a logged-in user's data.)
  app.use(
    cors({
      origin: appConfig.trustedOrigins.length ? [...appConfig.trustedOrigins] : false,
      credentials: true, // Allow cookies/sessions from the trusted origins only
    })
  );

  // 3. HTTP Request Logger (Morgan)
  // BTWA Module 9: Morgan middleware
  // 'combined' format logged to file via fs.createWriteStream (BTWA Module 4: filesystem streams)
  // 'dev' format logged to console for development
  if (!isTest) {
    const logsDir = path.join(__dirname, "logs");
    fs.mkdirSync(logsDir, { recursive: true }); // the stream below fails if the folder is missing
    const accessLogStream = fs.createWriteStream(
      path.join(logsDir, "access.log"),
      { flags: "a" }  // append mode — do not truncate on restart
    );
    app.use(morgan("combined", { stream: accessLogStream })); // Persistent HTTP access log
    app.use(morgan("dev"));                                   // Console log for development
  }

  // 4. Serve static files from /public (before the session, so css/js/images never touch the session store)
  // BTWA Module 7: Express static file serving
  app.use(express.static(path.join(__dirname, "public")));

  // 5. Body parser — the API only speaks JSON (BTWA Module 7: Express built-in middleware).
  // 100 kB is far above any legitimate request here. Form-encoded bodies are NOT parsed any more:
  // a plain HTML <form> on another site cannot send application/json, which is one of the CSRF layers.
  app.use(express.json({ limit: "100kb" }));

  // 6. Session Middleware
  // BTWA Module 10: express-session, cookies
  // Sessions stored in MongoDB via connect-mongo (demonstrates integration)
  app.use(
    session({
      secret: appConfig.sessionSecret,
      resave: false,            // Don't save session if unmodified
      saveUninitialized: false, // Don't create session until something stored
      store:
        options.sessionStore ||
        (isTest
          ? undefined // express-session's default MemoryStore (tests only)
          : new MongoStore({
              // Reuse Mongoose's connection (one pool, one set of connection errors) instead of letting
              // connect-mongo open a second one at import time. Resolves once startServer() has connected.
              clientPromise: new Promise((resolve) =>
                mongoose.connection.once("connected", () => resolve(mongoose.connection.getClient()))
              ),
              touchAfter: 24 * 3600, // Lazy session update (only update once per 24h)
            })),
      cookie: {
        secure: appConfig.cookie.secure,       // HTTPS only (production)
        httpOnly: appConfig.cookie.httpOnly,   // Prevent client-side JS access (security)
        sameSite: appConfig.cookie.sameSite,   // Not attached to cross-site POST/PUT/DELETE
        maxAge: appConfig.cookie.maxAge,       // 7 days
      },
      name: appConfig.cookie.name, // Custom session cookie name
    })
  );

  // 7. Rate limiting (BTWA Module 9 / 10: brute-force protection)
  // Runs before CSRF so that floods and password guessing are throttled even when they carry no valid token.
  const limiters = createRateLimiters({ enabled: appConfig.rateLimitEnabled, limits: options.rateLimits });
  app.use("/api", limiters.api);
  app.post("/api/auth/login", limiters.login, limiters.loginPerIp);
  app.post("/api/auth/register", limiters.register);
  app.post("/api/orders", limiters.orders);

  // 8. CSRF protection for every state-changing /api request (origin + JSON-only + session token).
  // See middleware/csrfMiddleware.js for why SameSite and JSON-only are not enough on their own.
  app.use("/api", createCsrfProtection({ trustedOrigins: appConfig.trustedOrigins }));

  // ─── API Routes ─────────────────────────────────────────────────────────────
  // BTWA Module 8: REST API routing
  app.use("/api/auth", authRoutes);
  app.use("/api/foods", foodRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/users", userRoutes);

  // ─── Health Check Route ─────────────────────────────────────────────────────
  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      message: "FoodieHub API is running",
      timestamp: new Date().toISOString(),
      ...(appConfig.isProduction ? {} : { environment: appConfig.nodeEnv }),
    });
  });

  // ─── Error Handling Middleware ──────────────────────────────────────────────
  // MUST be registered LAST
  // BTWA Module 9: Centralized error handling

  app.use(notFound);      // 404 handler for undefined routes
  app.use(errorHandler);  // Global error handler

  return app;
};

// The application used by `node server.js` and by the tests (`require("../../server")`).
const app = createApp(config);

// ─── Start Server ─────────────────────────────────────────────────────────────
// BTWA Module 1: MongoDB connection, BTWA Module 4: Async database connection
// Only when run directly (node server.js). Tests import the app without a DB connection
// and attach their own (see tests/helpers).
// The server only starts listening AFTER MongoDB is connected, so it never accepts requests it cannot serve.
const startServer = async () => {
  config.warnings.forEach((warning) => {
    console.warn(`⚠️  ${warning}`);
    logger.warn(`CONFIG: ${warning}`);
  });

  await connectDB(config.mongoUri); // exits the process with a clear message if it cannot connect

  const server = app.listen(config.port, () => {
    // Log server start to file (BTWA Module 4: Filesystem operations)
    logger.info(`SERVER STARTED on port ${config.port} | Environment: ${config.nodeEnv}`);
    console.log(`\n🚀 FoodieHub Server running at http://localhost:${config.port}`);
    console.log(`📋 Health check: http://localhost:${config.port}/api/health`);
    console.log(`🌍 Environment: ${config.nodeEnv}\n`);
  });

  server.on("error", (error) => {
    console.error(`❌ Could not start the server: ${error.message}`);
    process.exit(1);
  });

  // Graceful shutdown: stop accepting connections, then close MongoDB, then exit 0.
  let shuttingDown = false;
  const shutdown = (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${reason}: shutting down`);
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
    server.closeIdleConnections(); // keep-alive sockets would otherwise delay the shutdown
    setTimeout(() => process.exit(1), 10000).unref(); // never hang forever
  };
  process.once("SIGTERM", () => shutdown("SIGTERM received"));
  process.once("SIGINT", () => shutdown("SIGINT received"));

  // Windows has no POSIX signals: child.kill("SIGTERM") there terminates the process abruptly (exit
  // code null, no handler runs). Process managers (pm2, tests) instead send an IPC "shutdown"
  // message to a child started with an IPC channel; handle it with the same graceful path.
  // process.send only exists when this process was spawned with an IPC channel, so a normal
  // `node server.js` is unaffected.
  if (typeof process.send === "function") {
    process.on("message", (message) => {
      if (message === "shutdown") shutdown("IPC shutdown message received");
    });
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app; // Export for testing
module.exports.createApp = createApp;
