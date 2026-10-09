# FoodieHub — Online Food Ordering System
### BTWA Full-Stack Project | Node.js + Express.js + MongoDB + Vanilla JS

---

## Project Description

FoodieHub is a complete, full-stack online food ordering system built as a BTWA (Backend Technology / Web Application) college project. It demonstrates every module of the BTWA syllabus through real, working code — not demonstrations or placeholders.

Customers can browse food, search and filter the menu, add items to a cart, place orders, and track order status. Administrators can manage the entire application through a dedicated admin panel.

---

## Features

### Customer
- Register and login with bcrypt-hashed passwords
- Browse food with search, filter by category/price/availability, and sort
- Add food to cart, update quantities, and remove items
- Place orders with delivery address and cash-on-delivery payment
- View order history and track order status
- Cancel their own order while it is still **Pending**
- Update profile and delivery address
- Change their own password (other devices are signed out)

### Admin
- Admin dashboard with real-time MongoDB aggregation statistics
- Manage food items (add, edit, delete)
- Manage categories (add, edit, delete with integrity check)
- View all users; delete a user, or **deactivate** one who has orders (order history is kept) and **reactivate** them later
- View all orders with status filtering
- Move orders through the lifecycle (only legal steps are accepted — see [Order Lifecycle](#order-lifecycle))
- Export all orders as a CSV file (Node.js streams demo; values are quoted and spreadsheet formulas are neutralised)

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Authentication | express-session, bcryptjs |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Middleware | Helmet, CORS, Morgan, express-validator, express-rate-limit |
| Session Store | connect-mongo (sessions in MongoDB) |
| Dev Tools | nodemon, dotenv |
| Testing | Jest, supertest, jsdom (see [Testing](#testing)) |

---

## Architecture

```
Browser (HTML/CSS/Vanilla JS)
    │   HTTP / JSON / Sessions
    ▼
Express.js Server (server.js)
    │
    ├── Middleware Stack
    │   ├── Helmet (security headers)
    │   ├── CORS (off unless CORS_ORIGINS is set)
    │   ├── Morgan (HTTP logger)
    │   ├── express.static (frontend files)
    │   ├── express.json() (JSON bodies only)
    │   ├── express-session (MongoDB store)
    │   ├── rateLimiters (API, login, register, orders)
    │   ├── csrfMiddleware (origin + JSON + X-CSRF-Token on writes)
    │   ├── authMiddleware (session auth, re-checked against the database)
    │   ├── adminMiddleware (isAdmin / isCustomer role checks)
    │   ├── validationMiddleware (express-validator)
    │   └── errorMiddleware (centralized error handling)
    │
    ├── Routes (7 route files)
    │
    ├── Controllers (7 controller files)
    │
    ├── Services
    │   ├── orderService.js (order business logic)
    │   └── analyticsService.js (MongoDB aggregation)
    │
    ├── Models (Mongoose)
    │   ├── User, Food, Category, Cart, Order
    │
    └── Utils
        ├── logger.js (Node.js fs — async file logging)
        ├── eventEmitter.js (Node.js EventEmitter)
        ├── constants.js (business rules: cart limit, order lifecycle)
        ├── sessions.js (revoke a user's stored sessions)
        └── helpers.js (utility functions)
```

---

## Folder Structure

```
online-food-ordering/
├── server.js                   # Entry point — full middleware stack
├── seed.js                     # Database seeder
├── package.json
├── jest.config.js              # Test projects: unit + integration
├── .env                        # Environment variables (not committed)
├── .env.example
├── .gitignore
│
├── config/
│   ├── db.js                   # MongoDB connection
│   └── env.js                  # Reads + validates environment variables
│
├── models/
│   ├── User.js                 # bcrypt, embedded address, role
│   ├── Food.js                 # Text index, category ref, ingredients array
│   ├── Category.js             # Category schema
│   ├── Cart.js                 # Embedded cart items, user reference
│   └── Order.js                # Price snapshots, embedded address, status enum
│
├── routes/
│   ├── authRoutes.js           # POST /api/auth/register|login|logout, GET /me|csrf|demo-accounts
│   ├── foodRoutes.js           # GET /api/foods, GET|POST|PUT|DELETE /api/foods/:id
│   ├── categoryRoutes.js       # CRUD /api/categories
│   ├── cartRoutes.js           # GET|POST|PUT|DELETE /api/cart
│   ├── orderRoutes.js          # POST /api/orders, GET /api/orders, GET /api/orders/:id, PUT /api/orders/:id/cancel
│   ├── adminRoutes.js          # Admin-only routes (users incl. reactivate, orders, dashboard, CSV)
│   └── userRoutes.js           # GET|PUT /api/users/profile, PUT /api/users/password
│
├── controllers/
│   ├── authController.js       # register, login (session), logout, getMe
│   ├── foodController.js       # CRUD + search/filter/sort/pagination
│   ├── categoryController.js   # CRUD + integrity check
│   ├── cartController.js       # add/update/remove/clear
│   ├── orderController.js      # placeOrder, getMyOrders, getOrderById, cancelOrder
│   ├── adminController.js      # dashboard, users (delete/deactivate/reactivate), orders, CSV export (streams)
│   └── userController.js       # getProfile, updateProfile, changePassword
│
├── middleware/
│   ├── authMiddleware.js       # isAuthenticated (session + live account check)
│   ├── adminMiddleware.js      # isAdmin / isCustomer (role checks)
│   ├── csrfMiddleware.js       # CSRF protection for state-changing /api requests
│   ├── rateLimiters.js         # Rate limits (API, login, register, orders, password change)
│   ├── errorMiddleware.js      # notFound + global errorHandler
│   └── validationMiddleware.js # express-validator rule sets
│
├── services/
│   ├── orderService.js         # createOrder (atomic cart claim), order lifecycle, cancel
│   └── analyticsService.js     # getDashboardStats (aggregation pipelines)
│
├── utils/
│   ├── logger.js               # Async fs.appendFile logger
│   ├── eventEmitter.js         # Custom EventEmitter with 6 event listeners
│   ├── constants.js            # Cart limit, order statuses + allowed transitions
│   ├── sessions.js             # revokeUserSessions (log a user out everywhere)
│   ├── demoAccounts.js         # One-click demo logins (development only by default)
│   └── helpers.js              # sendSuccess, sendError, calculateTotal, etc.
│
├── logs/
│   └── application.log         # Auto-generated application log
│
├── tests/
│   ├── unit/                   # No database needed (models mocked)
│   ├── frontend/               # The real pages run in jsdom
│   ├── integration/            # Real MongoDB
│   ├── helpers/                # Shared test helpers
│   └── manual/csrf-attacker/   # A "hostile website" to try the CSRF protection by hand
│
└── public/
    ├── index.html              # Home page
    ├── login.html              # Login
    ├── register.html           # Registration
    ├── menu.html               # Food menu with filters
    ├── food-details.html       # Single food detail
    ├── cart.html               # Shopping cart
    ├── checkout.html           # Checkout + address
    ├── orders.html             # Order history
    ├── profile.html            # User profile
    ├── admin.html              # Admin dashboard
    ├── admin-food.html         # Food management
    ├── admin-categories.html   # Category management
    ├── admin-orders.html       # Order management
    ├── admin-users.html        # User management
    ├── css/style.css           # Full CSS design system
    └── js/main.js              # Shared JS utilities
```

---

## Database Design

### Database Name: `online_food_ordering`

### Collections

#### users
```json
{
  "name": "String (required, min:2)",
  "email": "String (required, unique, indexed)",
  "password": "String (bcrypt hashed, select:false)",
  "phone": "String",
  "address": {
    "street": "String",
    "city": "String",
    "state": "String",
    "pincode": "String"
  },
  "role": "String (enum: customer|admin)",
  "isActive": "Boolean (default: true; false = deactivated by an admin, cannot log in)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

#### categories
```json
{
  "name": "String (required, unique)",
  "description": "String",
  "image": "String (URL)",
  "createdAt": "Date"
}
```

#### foods
```json
{
  "name": "String (required, text-indexed)",
  "description": "String",
  "price": "Number (required, min:0)",
  "category": "ObjectId (ref: Category)",
  "image": "String",
  "ingredients": ["String"],
  "available": "Boolean (default: true)",
  "rating": "Number (0–5, default: 4.0)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

#### carts
```json
{
  "user": "ObjectId (ref: User, unique)",
  "items": [
    {
      "food": "ObjectId (ref: Food)",
      "quantity": "Number (min:1)",
      "price": "Number"
    }
  ],
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

#### orders
```json
{
  "user": "ObjectId (ref: User)",
  "items": [
    {
      "food": "ObjectId (ref: Food)",
      "foodName": "String (snapshot)",
      "quantity": "Number",
      "price": "Number (snapshot)"
    }
  ],
  "totalAmount": "Number",
  "deliveryAddress": {
    "street": "String",
    "city": "String",
    "state": "String",
    "pincode": "String"
  },
  "paymentMethod": "String (enum: Cash on Delivery)",
  "orderStatus": "String (enum: Pending|Confirmed|Preparing|Out for Delivery|Delivered|Cancelled)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

---

## API Endpoints

Every response uses the same envelope: `{ "success": true|false, "message": "...", "data": ... }`.

**Writes need three things** (POST / PUT / PATCH / DELETE under `/api`; see [Security](#security)):
a JSON body with `Content-Type: application/json`, the session cookie, and the header `X-CSRF-Token`
(get it from `GET /api/auth/csrf`; fetch a new one after every login). Only reads (GET) need none of these.

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/auth/csrf | Public | CSRF token for the current session (`data.csrfToken`) |
| GET | /api/auth/demo-accounts | Public | Demo logins (404 unless `ENABLE_DEMO_LOGIN`; on in development by default) |
| POST | /api/auth/register | Public | Register user |
| POST | /api/auth/login | Public | Login + create session |
| POST | /api/auth/logout | Auth | Destroy session |
| GET | /api/auth/me | Auth | Get current user |

### Foods
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/foods | Public | List foods (search, filter, sort, paginate) |
| GET | /api/foods/:id | Public | Food details |
| POST | /api/foods | Admin | Add food |
| PUT | /api/foods/:id | Admin | Update food |
| DELETE | /api/foods/:id | Admin | Delete food |

### Categories
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/categories | Public | All categories |
| GET | /api/categories/:id | Public | Category details |
| POST | /api/categories | Admin | Add category |
| PUT | /api/categories/:id | Admin | Update category |
| DELETE | /api/categories/:id | Admin | Delete (if no foods depend) |

### Cart
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/cart | Auth | Get user's cart |
| POST | /api/cart | Auth | Add item to cart |
| PUT | /api/cart/:foodId | Auth | Update quantity |
| DELETE | /api/cart/:foodId | Auth | Remove item |
| DELETE | /api/cart/clear | Auth | Clear cart |

### Orders
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/orders | Auth | Place order |
| GET | /api/orders | Auth | Order history |
| GET | /api/orders/:id | Auth | Order details (owner or admin) |
| PUT | /api/orders/:id/cancel | Customer | Cancel your own order — owner only, **Pending** only (admins: 403, use the admin endpoint) |

### Admin
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/admin/dashboard | Admin | Dashboard stats (aggregation) |
| GET | /api/admin/users | Admin | All users |
| DELETE | /api/admin/users/:id | Admin | Delete a user with no orders; **deactivate** one who has orders (history kept) |
| PUT | /api/admin/users/:id/reactivate | Admin | Reactivate a deactivated user (404 unknown, 409 already active) |
| GET | /api/admin/orders | Admin | All orders |
| PUT | /api/admin/orders/:id/status | Admin | Change order status (legal lifecycle steps only; 409 otherwise) |
| GET | /api/admin/export/orders | Admin | Export CSV (streams); values are quoted, and spreadsheet formulas in user-typed text are neutralised |

### Users
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/users/profile | Auth | View profile |
| PUT | /api/users/profile | Auth | Update profile |
| PUT | /api/users/password | Auth | Change your password (`currentPassword`, `newPassword` 6–72 chars). Wrong current password → 400; other devices are signed out; this one stays signed in |

### Other
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/health | Public | Health check |

---

## Order Lifecycle

Defined once in `utils/constants.js` (`ORDER_TRANSITIONS`); the admin page mirrors it and a test keeps the two identical.

| From | Allowed next status |
|------|---------------------|
| Pending | Confirmed, Cancelled |
| Confirmed | Preparing, Cancelled |
| Preparing | Out for Delivery, Cancelled |
| Out for Delivery | Delivered |
| Delivered | — (final) |
| Cancelled | — (final) |

- Any other change is refused with **409**. Status changes are atomic (the expected current status is part of the update filter), so two simultaneous changes cannot both win.
- A customer can cancel only their **own Pending** order (`PUT /api/orders/:id/cancel`); admins use `PUT /api/admin/orders/:id/status`.
- Cancelled orders do not count towards revenue, average order value, popular foods, top spenders or revenue-by-date on the dashboard (they still appear in the order count and the per-status counts).
- Placing an order claims the cart atomically, so pressing "Place order" twice creates exactly one order: a request that loses the race gets 409 ("already placed"); one that arrives after the cart was consumed gets 400 ("Your cart is empty").
- If an order is placed at the very moment a cart is being changed, the cart request answers **409** ("Your cart was just checked out…").

---

## Authentication Mechanism

1. **Registration**: user data validated → email uniqueness checked → password bcrypt hashed via Mongoose pre-save hook → user saved → 201 response
2. **Login**: email/password validated → user fetched with `select('+password')` → `bcrypt.compare()` → a **deactivated** account is refused with 403 → the session id is regenerated (session-fixation defence) → `req.session.userId` / `role` stored → session kept in MongoDB via connect-mongo
3. **Session validation**: every protected route passes through `isAuthenticated`, which checks `req.session.userId` **and re-reads the user from MongoDB** (role + `isActive`). A deleted or deactivated user's session is destroyed (401); a promoted/demoted user's new role applies immediately.
4. **Authorization**: `isAdmin` for admin routes; `isCustomer` for customer-only actions (cancelling an order). Both fail closed.
5. **CSRF**: every state-changing `/api` request must pass three checks — Origin, JSON content type, and the `X-CSRF-Token` header matching the secret in the session.
6. **Logout**: `req.session.destroy()` → `res.clearCookie('foodiehub.sid')`
7. **Change password** (`PUT /api/users/password`): the current password must be right (bcrypt; wrong → 400, not 401, because 401 means "your session ended") → the new one (6–72 characters, different from the current) is hashed by the pre-save hook → **every stored session of the user is deleted** → this device gets a **new session id** and stays logged in. Failed attempts are rate-limited per user. Passwords are never logged or returned.

---

## Middleware Stack (in order)

```javascript
app.use(helmet())                       // 1. Security headers
app.use(cors({ origin: CORS_ORIGINS }))  // 2. CORS — off unless CORS_ORIGINS lists origins
app.use(morgan(...))                    // 3. HTTP request logging (not in tests)
app.use(express.static())               // 4. Serve frontend files (before the session)
app.use(express.json({ limit: '100kb' }))// 5. Parse JSON bodies (form bodies are not parsed)
app.use(session({...}))                 // 6. Session management (MongoDB store)
app.use('/api', rateLimiters...)        // 7. Rate limits: API, login, register, orders, password change
app.use('/api', csrfProtection)         // 8. CSRF: origin + JSON + token on writes
app.use('/api/...')                     // 9. Route handlers
app.use(notFound)                       // 10. 404 handler
app.use(errorHandler)                   // 11. Global error handler
```

Custom route-level middleware:
- `isAuthenticated` — session validation (with the live account check)
- `isAdmin` / `isCustomer` — role verification
- `validateRegister`, `validateLogin`, `validateFood`, `validateIdParam`, etc. — input validation

---

## MongoDB Indexing

| Collection | Field(s) | Index Type | Purpose |
|------------|----------|-----------|---------|
| users | email | Unique | Login lookup |
| users | role | Regular | Filter by role |
| users | createdAt | Descending | Sort |
| foods | name, description | Text | Full-text search |
| foods | category, available | Compound | Menu filtering |
| foods | price | Regular | Price range sort |
| foods | rating | Descending | Rating sort |
| orders | user | Regular | My orders query |
| orders | orderStatus | Regular | Status filter |
| orders | createdAt | Descending | Date sort |
| orders | user + createdAt | Compound | User order history |
| categories | createdAt | Descending | Sort |

---

## Aggregation Framework

Location: `services/analyticsService.js`

### getDashboardStats()
```javascript
// 1. Total orders (all) and revenue / average order value (Cancelled orders excluded)
Order.aggregate([{ $group: { _id: null, totalOrders: {$sum:1} } }])
Order.aggregate([{ $match: { orderStatus: { $ne: 'Cancelled' } } }, { $group: { _id: null, totalRevenue: {$sum:'$totalAmount'}, avgOrderValue: {$avg:'$totalAmount'} } }])

// 2. Orders grouped by status
Order.aggregate([{ $group: { _id: '$orderStatus', count: {$sum:1} } }, { $sort: {count:-1} }])

// 3. Popular foods (unwind items; Cancelled orders excluded)
Order.aggregate([
  { $match: { orderStatus: { $ne: 'Cancelled' } } },
  { $unwind: '$items' },
  { $group: { _id: '$items.food', foodName: {$first:'$items.foodName'}, totalOrdered: {$sum:'$items.quantity'} } },
  { $sort: { totalOrdered: -1 } },
  { $limit: 5 }
])

// 4. Revenue by date (last 7 days; Cancelled orders excluded)
Order.aggregate([
  { $match: { createdAt: { $gte: sevenDaysAgo }, orderStatus: { $ne: 'Cancelled' } } },
  { $group: { _id: { $dateToString: {format:'%Y-%m-%d', date:'$createdAt'} }, revenue: {$sum:'$totalAmount'} } }
])
```

---

## Node.js Features

### File System (BTWA Module 4)
- `utils/logger.js` uses `fs.appendFile()` (async, non-blocking) to write all events to `logs/application.log`
- Demonstrates `fs.readFile()` for reading logs
- `logs/` directory is created programmatically using `fs.mkdirSync()`

### EventEmitter (BTWA Module 5)
- `utils/eventEmitter.js` creates a custom `FoodieHubEmitter extends EventEmitter`
- **Events emitted**: `orderPlaced`, `orderStatusUpdated`, `userRegistered`, `userLoggedIn`, `userLoggedOut`, `appError`
- Each event has a corresponding listener that writes to the log file

### Streams and Pipes (BTWA Module 5)
- `controllers/adminController.js` → `exportOrdersCSV()`
- Flow: MongoDB data → **Readable stream** → **Transform stream** (CSV formatting) → **HTTP response** (Writable stream)
- Uses `pipe()` to chain streams: `readable.pipe(transform).pipe(res)`
- **The CSV is safe to open in a spreadsheet**: `csvCell()` (`utils/helpers.js`) quotes any value containing a comma, quote or line break (RFC 4180), and prefixes `'` to user-typed text that starts with `=`, `+`, `-`, `@`, tab or CR, because spreadsheets would otherwise run it as a formula (a customer chooses their own name). Numbers, ids and dates are left as they are.

### Async/Await (BTWA Module 4, 6)
- All database operations use async/await
- Non-blocking I/O for file system, database, and session operations

---

## Installation

### Prerequisites
- Node.js v18+ (tested on v24.19.0)
- MongoDB running locally on port 27017
- npm v8+

### Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd online-food-ordering

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your values

# 4. Seed the database
npm run seed

# 5. Start the development server
npm run dev
```

---

## Environment Variables

Copy `.env.example` to `.env`. The server validates everything at startup (`config/env.js`): in production it refuses to start on a problem, in development it warns.

| Variable | Required | Meaning |
|----------|----------|---------|
| `PORT` | no | Port to listen on. Default `5000` |
| `MONGO_URI` | **yes** | MongoDB connection string (`mongodb://` or `mongodb+srv://`). The server starts listening only after MongoDB is connected |
| `NODE_ENV` | no | `development` (default), `production` or `test`. Anything else is rejected, so a typo cannot silently disable production protections |
| `SESSION_SECRET` | production | Signs the session cookie; **≥ 32 random characters** in production. In development a random one is generated per run if it is missing |
| `CORS_ORIGINS` | no | Comma-separated extra origins allowed to call the API from a browser. Default: none (the pages are served by this same server). Also list your public origin if a proxy rewrites the `Host` header |
| `TRUST_PROXY` | no | Number of reverse proxies in front of the app (for client IPs and secure cookies) |
| `COOKIE_SECURE` | no | HTTPS-only session cookie. Default: on in production, off otherwise |
| `RATE_LIMIT_DISABLED` | no | `true` turns rate limiting off (local load testing only) |
| `ENABLE_DEMO_LOGIN` | no | One-click demo buttons on the login page. Default: on in development, **off in production** |
| `ALLOW_SEED_IN_PRODUCTION` | no | `npm run seed` erases the database, so it refuses to run in production unless this is `true` |

---

## Running the Project

```bash
npm run dev    # Development (nodemon, auto-restart)
npm start      # Production
npm run seed   # Seed the database
```

Server: http://localhost:5000
API Health: http://localhost:5000/api/health

---

## Testing

```bash
npm test                  # unit + frontend tests — no database needed
npm run test:integration  # integration tests against a REAL MongoDB
npm run test:all          # both
```

- **Unit / frontend** (`tests/unit`, `tests/frontend`): the database models are mocked and the real HTML pages run in jsdom. They prove which queries run and how every response looks, but **not** MongoDB's own behaviour (atomic updates, unique indexes, aggregation).
- **Integration** (`tests/integration`): the real app against a real MongoDB, in a separate database named `foodiehub_integration_test` that is wiped between tests — your own data is never touched. Point it at a server with `MONGO_TEST_URI=mongodb://127.0.0.1:27017`; if it is not set, `mongodb-memory-server` downloads a throw-away `mongod` on first use (needs internet access).
- Set `DEBUG_TEST_DB=1` to print which database the integration tests use (and per-round timings of the cart race test).
- `tests/manual/csrf-attacker/` is a small "hostile website" you can open in a browser to see the CSRF protection refuse a forged request (see the README in that folder).

---

## Seed Database

```bash
npm run seed
```

This will:
- Clear existing data (safe to run multiple times)
- Insert 7 categories
- Insert 18 food items
- Insert 1 admin + 3 customer accounts

### Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@foodiehub.com | admin123 |
| Customer | rahul@example.com | password123 |
| Customer | priya@example.com | password123 |
| Customer | arun@example.com | password123 |

> If you change a demo account's password through the app, the one-click demo login for that account stops working until you run `npm run seed` again.

---

## Postman Testing

The API uses a **session cookie** (not JWT) and **CSRF protection**, so a write request in Postman needs three things:

1. **Cookies**: leave Postman's cookie jar on, so the session cookie is sent back automatically.
2. **A CSRF token**: `GET http://localhost:5000/api/auth/csrf` → copy `data.csrfToken`. Send it on every write as the header `X-CSRF-Token: <token>`. **Fetch a new token after logging in** (login starts a new session, which has its own token).
3. **JSON**: `Content-Type: application/json` on requests with a body.

Without the token a write is refused with **403**; a form-encoded body gets **415**. GET requests need none of this.

Typical flow: `GET /api/auth/csrf` → `POST /api/auth/login` (with the token) → `GET /api/auth/csrf` again → everything else.

### Authentication
```
GET    http://localhost:5000/api/auth/csrf
POST   http://localhost:5000/api/auth/register
POST   http://localhost:5000/api/auth/login
GET    http://localhost:5000/api/auth/me
POST   http://localhost:5000/api/auth/logout
```

### Foods
```
GET    http://localhost:5000/api/foods?search=biryani&sort=rating
GET    http://localhost:5000/api/foods?category=<id>&minPrice=100&maxPrice=300
GET    http://localhost:5000/api/foods/<id>
POST   http://localhost:5000/api/foods      (Admin)
PUT    http://localhost:5000/api/foods/<id> (Admin)
DELETE http://localhost:5000/api/foods/<id> (Admin)
```

### Cart (must be logged in)
```
GET    http://localhost:5000/api/cart
POST   http://localhost:5000/api/cart       Body: {"foodId":"...","quantity":2}
PUT    http://localhost:5000/api/cart/<foodId>  Body: {"quantity":3}
DELETE http://localhost:5000/api/cart/<foodId>
DELETE http://localhost:5000/api/cart/clear
```

### Orders (must be logged in)
```
POST   http://localhost:5000/api/orders     Body: {"deliveryAddress":{...}, "paymentMethod":"Cash on Delivery"}
GET    http://localhost:5000/api/orders
GET    http://localhost:5000/api/orders/<id>
PUT    http://localhost:5000/api/orders/<id>/cancel     (customer, own Pending order; no body)
```

### Account (must be logged in)
```
PUT    http://localhost:5000/api/users/password   Body: {"currentPassword":"...","newPassword":"..."}
```
(After it succeeds your session id changes: fetch a new CSRF token with `GET /api/auth/csrf` before the next write.)

### Admin (must be logged in as admin)
```
GET    http://localhost:5000/api/admin/dashboard
GET    http://localhost:5000/api/admin/users
DELETE http://localhost:5000/api/admin/users/<id>            (delete, or deactivate if the user has orders)
PUT    http://localhost:5000/api/admin/users/<id>/reactivate (no body)
GET    http://localhost:5000/api/admin/orders?status=Pending
PUT    http://localhost:5000/api/admin/orders/<id>/status    Body: {"status":"Confirmed"}
GET    http://localhost:5000/api/admin/export/orders
```

---

## BTWA Module Mapping

| Module | Topic | Implementation in FoodieHub |
|--------|-------|---------------------------|
| **Module 1** | MongoDB, NoSQL, Documents, Collections, JSON | MongoDB database `online_food_ordering` with 5 collections. All API responses use JSON. Documents store food, users, orders. |
| **Module 2** | CRUD, Queries, Arrays, Embedded Documents, Cursors | Full CRUD on foods/categories/orders. `ingredients[]` array field. Embedded `address` in users. `.find().sort().skip().limit()` cursor chain in menu. Comparison operators `$gte`, `$lte`. Regex search. |
| **Module 3** | Indexes, Aggregation, Mongoose, Schema Design | Text index on food name, compound indexes on orders. Aggregation in `analyticsService.js` with `$group`, `$unwind`, `$sort`, `$dateToString`. Full Mongoose schemas with validation, populate, timestamps. |
| **Module 4** | Node.js Runtime, Filesystem, Async Operations | `utils/logger.js` uses `fs.appendFile()` (async, non-blocking). `fs.readFile()` demonstrated. All DB/FS operations use async/await. Logs written on every key event. |
| **Module 5** | Modules, require/exports, JSON, EventEmitter, Streams | `require()` and `module.exports` throughout. Custom EventEmitter in `utils/eventEmitter.js`. Events: `orderPlaced`, `userLoggedIn`, etc. Streams in `exportOrdersCSV()`: Readable → Transform → Writable. |
| **Module 6** | npm, Dependencies, Node Architecture, Event Loop | `package.json` with `start`, `dev`, `seed`, `test` and `test:integration` scripts. Production vs devDependencies. Non-blocking I/O throughout — no sync operations in request handlers. |
| **Module 7** | Express.js, Request/Response | Express app in `server.js`. `req.body`, `req.params`, `req.query`, `req.session`. JSON responses with status codes. Static file serving. |
| **Module 8** | REST APIs, Routing, Route Parameters, HTTP Methods | 35 REST endpoints. `router.get()`, `.post()`, `.put()`, `.delete()`. Route params `/:id`, `/:foodId`. Correct HTTP verbs and status codes (200, 201, 400, 401, 403, 404, 409, 500). |
| **Module 9** | Middleware, CORS, Morgan, Helmet, Error Handling | Helmet (security headers), CORS (cross-origin), Morgan (HTTP logs), custom auth/admin/customer/CSRF/rate-limit/validation middleware. Centralized error handler in `errorMiddleware.js`. |
| **Module 10** | Cookies, Sessions, Authentication, Flash Messages | `express-session` with MongoDB store. Session cookie `foodiehub.sid`. `req.session.userId`, `req.session.role`. bcrypt password hashing. Session-based flash messages (`req.session.flash`). Role-based authorization. |

---

## Security

- Passwords stored with bcrypt (10 salt rounds) — never plaintext; login takes the same time for unknown emails and wrong passwords
- Sessions stored in MongoDB via connect-mongo; the session id is regenerated at login (session-fixation defence)
- Session cookie: `httpOnly: true` (XSS protection), `secure: true` in production, `SameSite` set
- **CSRF protection** on every state-changing `/api` request: Origin check + JSON-only bodies + a per-session `X-CSRF-Token` (none of the three relies on the others)
- **Sessions are re-checked against the database on every request**: a deactivated or deleted account is logged out immediately, and a role change takes effect at once
- Role checks (`isAdmin`, `isCustomer`) verified on every server request; admin-only and customer-only routes fail closed
- **Rate limiting** (`express-rate-limit`): API-wide, login (per IP + email, and per IP), register, order placement, and failed password-change attempts (per user); answered with 429
- Input validation on bodies **and** query strings (400 on bad input); search text is regex-escaped
- Price calculations done server-side only; the cart total always uses the current price
- **Password change** needs the current password (a stolen session alone cannot take the account over), signs every other device out, issues a new session id for this one, and never logs or returns a password
- **CSV export** quotes every value and neutralises spreadsheet formulas in user-typed text, so a hostile name cannot run code in an admin's spreadsheet or shift the columns
- Atomic database updates for the race-prone steps: adding to a cart, claiming a cart at checkout, order status changes, and reactivating a user
- Helmet adds security headers; CORS is closed unless `CORS_ORIGINS` is set
- Environment variables for all secrets; production refuses to start with a weak or missing `SESSION_SECRET`
- Stack traces and internal error messages are never sent to the client in production

---

## CAP Theorem (Academic Note)

MongoDB falls under **CP** (Consistency + Partition Tolerance) in the CAP theorem:

- **Consistency**: MongoDB ensures strong consistency by default for single-node deployments. All reads reflect the most recent write.
- **Availability**: In a replica set, MongoDB can sacrifice availability during network partitions to maintain consistency.
- **Partition Tolerance**: MongoDB can operate during network partitions but may delay writes until majority acknowledgment.

For this project, we use a local single-node MongoDB instance which provides strong consistency. In production with replica sets, MongoDB allows configuration of read/write concerns to tune the C-A tradeoff.

---

## Future Enhancements

1. JWT-based stateless authentication
2. Real payment gateway integration (Razorpay)
3. Email notifications using Nodemailer
4. Image upload with Multer + Cloudinary
5. Real-time order tracking with Socket.io
6. Rating and review system
7. Coupon/discount system
8. Delivery partner management
9. PWA support for mobile
10. Pagination of a customer's own order history
11. Idempotency keys so a late duplicate checkout is reported as a duplicate rather than an empty cart
