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
const path = require("path");
const fs   = require("fs");   // BTWA Module 4: Node.js filesystem
const dotenv = require("dotenv");

// Load environment variables FIRST (BTWA Module 4: Configuration)
dotenv.config();

// Import custom modules (BTWA Module 5: require/module.exports)
const connectDB = require("./config/db");
const logger = require("./utils/logger");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

// Import route modules (BTWA Module 8: REST routing)
const authRoutes = require("./routes/authRoutes");
const foodRoutes = require("./routes/foodRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");

// ─── Connect to MongoDB ───────────────────────────────────────────────────────
// BTWA Module 1: MongoDB connection
// BTWA Module 4: Async database connection
connectDB();

// ─── Initialize Express App ───────────────────────────────────────────────────
const app = express();

// ─── Middleware Stack ─────────────────────────────────────────────────────────
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
app.use(
  cors({
    origin: process.env.NODE_ENV === "production" ? false : true,
    credentials: true, // Allow cookies/sessions across origins
  })
);

// 3. HTTP Request Logger (Morgan)
// BTWA Module 9: Morgan middleware
// 'combined' format logged to file via fs.createWriteStream (BTWA Module 4: filesystem streams)
// 'dev' format logged to console for development
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, "logs", "access.log"),
  { flags: "a" }  // append mode — do not truncate on restart
);
app.use(morgan("combined", { stream: accessLogStream })); // Persistent HTTP access log
app.use(morgan("dev"));                                   // Console log for development

// 4. Body parsers — parse JSON and URL-encoded request bodies
// BTWA Module 7: Express built-in middleware
app.use(express.json());                           // Parse application/json
app.use(express.urlencoded({ extended: true }));   // Parse form data

// 5. Session Middleware
// BTWA Module 10: express-session, cookies
// Sessions stored in MongoDB via connect-mongo (demonstrates integration)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback_secret",
    resave: false,            // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    store: new MongoStore({
      mongoUrl: process.env.MONGO_URI,
      touchAfter: 24 * 3600, // Lazy session update (only update once per 24h)
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production", // HTTPS only in production
      httpOnly: true,  // Prevent client-side JS access (security)
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
    name: "foodiehub.sid", // Custom session cookie name
  })
);

// 6. Serve static files from /public
// BTWA Module 7: Express static file serving
app.use(express.static(path.join(__dirname, "public")));

// ─── API Routes ───────────────────────────────────────────────────────────────
// BTWA Module 8: REST API routing
app.use("/api/auth", authRoutes);
app.use("/api/foods", foodRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);

// ─── Health Check Route ───────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "FoodieHub API is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── Error Handling Middleware ────────────────────────────────────────────────
// MUST be registered LAST
// BTWA Module 9: Centralized error handling

app.use(notFound);      // 404 handler for undefined routes
app.use(errorHandler);  // Global error handler

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  // Log server start to file (BTWA Module 4: Filesystem operations)
  logger.info(`SERVER STARTED on port ${PORT} | Environment: ${process.env.NODE_ENV}`);
  console.log(`\n🚀 FoodieHub Server running at http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}\n`);
});

module.exports = app; // Export for testing
