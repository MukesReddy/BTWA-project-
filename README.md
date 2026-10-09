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
- Place orders with a delivery address and pay by **Cash on Delivery** or **online UPI QR** (see [UPI QR payments](#upi-qr-payments))
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
- Confirm or reject an online UPI payment after checking the bank statement (bank reference required)
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
| Payments | `qrcode` (draws the UPI QR); payment confirmation is signed-webhook or admin-verified, see [UPI QR payments](#upi-qr-payments) |
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
    │   ├── rateLimiters (API, login, register, orders, password change)
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
BTWA-project-/
├── server.js                   # Entry point — full middleware stack
├── seed.js                     # Database seeder
├── package.json
├── jest.config.js              # Test projects: unit + integration
├── .env                        # Environment variables (not committed)
├── .env.example                # placeholders only (including UPI_* and PAYMENT_WEBHOOK_SECRET)
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
│   ├── paymentRoutes.js        # /api/payments (methods, upi, status; the webhook is registered in server.js)
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
│   ├── paymentController.js    # payment methods, start UPI payment, status, webhook
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
│   ├── paymentService.js       # UPI QR payments: start, status, expiry, verified result (webhook/admin)
│   └── analyticsService.js     # getDashboardStats (aggregation pipelines)
│
├── utils/
│   ├── logger.js               # Async fs.appendFile logger
│   ├── eventEmitter.js         # Custom EventEmitter with 6 event listeners
│   ├── constants.js            # Cart limit, order statuses + allowed transitions
│   ├── upi.js                  # UPI link + QR picture, paise maths, payment reference
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
  "paymentMethod": "String (enum: Cash on Delivery|UPI)",
  "paymentStatus": "String (enum: PENDING|PAID|FAILED|EXPIRED|CANCELLED, default PENDING; for Cash on Delivery it stays PENDING)",
  "paymentRef": "String (UPI only; printed in the QR; unique)",
  "paymentExpiresAt": "Date (UPI only)",
  "paidAt": "Date (UPI, when verified)",
  "paymentTransactionId": "String (bank/provider reference of the verified payment; unique)",
  "paymentVerifiedBy": "String (enum: webhook|admin)",
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
| PUT | /api/orders/:id/cancel | Customer | Cancel your own order — owner only, **Pending** only (admins: 403, use the admin endpoint). An unpaid UPI order is cancelled and its cart restored; a **paid** UPI order answers 409 (refund needed) |

### Payments (UPI QR)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/payments/methods | Auth | Methods checkout may offer; UPI is `available` only when `UPI_ID` is set |
| POST | /api/payments/upi | Auth | Turn the cart into a **Pending** UPI order and return the QR. Body: `{ deliveryAddress }`. An `amount` sent by the client is ignored: the server prices the cart |
| GET | /api/payments/:orderId | Owner/Admin | Payment status; the QR is included only while it is pending and in time |
| POST | /api/payments/webhook | Signature | Payment result from a provider. `X-Payment-Signature` = hex HMAC-SHA256 of the raw body. 503 unless `PAYMENT_WEBHOOK_SECRET` is set. **The only write outside CSRF** |

### Admin
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/admin/dashboard | Admin | Dashboard stats (aggregation) |
| GET | /api/admin/users | Admin | All users |
| DELETE | /api/admin/users/:id | Admin | Delete a user with no orders; **deactivate** one who has orders (history kept) |
| PUT | /api/admin/users/:id/reactivate | Admin | Reactivate a deactivated user (404 unknown, 409 already active) |
| GET | /api/admin/orders | Admin | All orders |
| PUT | /api/admin/orders/:id/status | Admin | Change order status (legal lifecycle steps only; 409 otherwise; an unpaid UPI order can only be cancelled) |
| PUT | /api/admin/orders/:id/payment | Admin | Confirm/reject a UPI payment: `{ status: "PAID"\|"FAILED", transactionId }` (bank reference required for PAID) |
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
- A **UPI order is created Pending and unpaid**; it can move forward (Confirmed …) only after its payment is verified (see [UPI QR payments](#upi-qr-payments)). Until then it can only be cancelled.
- Cancelled orders, and UPI orders whose payment is not **PAID**, do not count towards revenue, average order value, popular foods, top spenders or revenue-by-date on the dashboard (they still appear in the order count and the per-status counts).
- Placing an order claims the cart atomically, so pressing "Place order" twice creates exactly one order: a request that loses the race gets 409 ("already placed"); one that arrives after the cart was consumed gets 400 ("Your cart is empty").
- If an order is placed at the very moment a cart is being changed, the cart request answers **409** ("Your cart was just checked out…").

---

## UPI QR payments

Checkout offers **Cash on Delivery** (unchanged) and **Online UPI QR Payment**.

### Workflow
1. Checkout → choose *UPI* → **Pay with UPI QR**. The browser sends only the delivery address to `POST /api/payments/upi`.
2. The server runs the **same checkout as Cash on Delivery** (prices from the database, availability checks, atomic cart claim), creates a **Pending** order with `paymentMethod: "UPI"`, `paymentStatus: "PENDING"`, a unique `paymentRef` (`FH` + 16 hex) and an expiry, and answers with the QR picture, the exact amount and the payment link. There is no tax or delivery fee in this project, so the amount is the sum of price × quantity. **An amount sent by the browser is ignored.**
3. The page shows the order summary, *Amount to Pay: ₹X*, the QR, a countdown and a *waiting* indicator, and polls `GET /api/payments/:orderId` every 5 seconds. Scanning the QR or opening a UPI app changes nothing on the server.
4. The payment becomes **PAID** only when the server receives a **verified** result, in one of two ways:
   - **Signed webhook** `POST /api/payments/webhook` (needs `PAYMENT_WEBHOOK_SECRET`). The caller sends the JSON body and `X-Payment-Signature: <hex HMAC-SHA256 of the exact body bytes>`. Body: `{ "paymentRef": "FH…", "status": "SUCCESS" | "FAILED", "amount": 249.9, "transactionId": "…" }` (`amount` in rupees, required for SUCCESS).
   - **Admin confirmation** `PUT /api/admin/orders/:id/payment` (Admin → Orders → open the order). The admin checks the bank statement, and types the bank reference (UTR). The amount is not typed: it is the order's own total.
5. The page then shows **"Payment verified"** (or *failed / expired / cancelled*). The order stays **Pending** until an admin *Confirms* it as usual: the kitchen cannot start an unpaid UPI order (409).

### Rules the server enforces
- Webhook: no secret configured → 503; missing/wrong signature → 401 (constant-time compare); payload validated; unknown `paymentRef` → 404; **paid amount ≠ order total → 400 and the order is not marked paid**.
- Repeated notification (same transaction) → 200 *already processed*, nothing changes. A different transaction for an already-paid order → 409. One transaction id cannot pay two orders (unique index).
- `FAILED` from the provider, customer *Cancel*, or running out of time (`UPI_PAYMENT_WINDOW_MINUTES`) → the order is **Cancelled**, the payment is FAILED / CANCELLED / EXPIRED, and the **cart is restored** (unless the customer already started a new one). A background job (every 60 s) and the status endpoint both close expired payments.
- A **paid** UPI order cannot be cancelled by the customer (409, contact the restaurant); a payment that arrives **after** the order was cancelled/expired is recorded but the order stays Cancelled and a *manual refund required* warning is logged.
- Every state change is one atomic update whose filter names the expected state, so two simultaneous notifications cannot both win.
- Dashboard revenue, popular foods, top spenders and revenue-by-date count a UPI order only when it is **PAID**.

### Setup
1. Put your merchant UPI ID in `.env`: `UPI_ID=yourshop@yourbank`, `UPI_PAYEE_NAME=Your Shop`. Without `UPI_ID`, UPI is simply not offered.
2. Optional automatic verification: set `PAYMENT_WEBHOOK_SECRET` (≥ 32 chars) and make your provider (or your own script) call the webhook. A signing example:
   ```bash
   BODY='{"paymentRef":"FH0123456789ABCDEF","status":"SUCCESS","amount":249.9,"transactionId":"UTR123456789012"}'
   SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" | awk '{print $NF}')
   curl -X POST http://localhost:5000/api/payments/webhook -H "Content-Type: application/json" -H "X-Payment-Signature: $SIG" -d "$BODY"
   ```
3. Without a webhook, an admin verifies payments by hand (bank statement → *Mark as PAID* with the UTR).

### Limitations (please read)
- **No payment provider (Razorpay, Cashfree, PhonePe PG …) is integrated or tested.** The QR is a *static merchant UPI link with a dynamic amount*: a plain UPI ID never calls our server, so the app cannot know by itself that money arrived. Automatic confirmation needs a provider account, and a small adapter that translates the provider's webhook (its own field names and signature scheme) into the body above. The generic signed webhook and the admin confirmation are real and tested, but nothing in this repository has been run against a live bank or provider.
- The order reference (`tr=`) in the QR is honoured only by merchant accounts; personal UPI IDs may ignore it, so match payments by amount, time and UTR.
- **No refunds**: refunding a paid-then-cancelled order, a late payment, or an amount mismatch is manual.
- The QR/UPI link shows a *fixed amount that a user could edit in their UPI app*; that is why the server compares the verified amount with the order total and refuses a mismatch.
- A paid UPI order still needs the admin's normal *Confirm* step.
- The unit/frontend tests mock the database; `tests/integration/payments.test.js` covers the real-database behaviour and needs `npm run test:integration` on a real MongoDB.

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
app.post('/api/payments/webhook')        // 7b. Payment webhook: before CSRF, authenticated by HMAC signature instead
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
// 1. Total orders (all) and revenue / average order value (Cancelled orders and unpaid UPI orders excluded)
Order.aggregate([{ $group: { _id: null, totalOrders: {$sum:1} } }])
Order.aggregate([{ $match: { orderStatus: { $ne: 'Cancelled' } } }, { $group: { _id: null, totalRevenue: {$sum:'$totalAmount'}, avgOrderValue: {$avg:'$totalAmount'} } }])

// 2. Orders grouped by status
Order.aggregate([{ $group: { _id: '$orderStatus', count: {$sum:1} } }, { $sort: {count:-1} }])

// 3. Popular foods (unwind items; Cancelled and unpaid UPI orders excluded)
Order.aggregate([
  { $match: { orderStatus: { $ne: 'Cancelled' } } },
  { $unwind: '$items' },
  { $group: { _id: '$items.food', foodName: {$first:'$items.foodName'}, totalOrdered: {$sum:'$items.quantity'} } },
  { $sort: { totalOrdered: -1 } },
  { $limit: 5 }
])

// 4. Revenue by date (last 7 days; Cancelled and unpaid UPI orders excluded)
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
- **Node.js v20.19 or newer** (v22 and v24 are fine; the session store `connect-mongo@6` needs 20.8+ and the test database helper needs 20.19+)
- **MongoDB** (Community Server, a current version) reachable from your machine, by default `mongodb://127.0.0.1:27017`
- npm v9+ (installed with Node)

### MongoDB setup
Any one of these works; the app only needs the connection string in `MONGO_URI`:
- **Local server**: install MongoDB Community Server and make sure the service is running (on Windows it starts automatically as the "MongoDB" service; on Linux/macOS `mongod` or `brew services start mongodb-community`). Use `MONGO_URI=mongodb://127.0.0.1:27017/online_food_ordering`.
- **MongoDB Atlas** (free tier): create a cluster, add your IP address to the access list, create a database user and copy the `mongodb+srv://…` string into `MONGO_URI`.

The database and its collections are created automatically on first use; `npm run seed` fills them with sample data.

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/MukesReddy/BTWA-project-.git
cd BTWA-project-

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env        # Windows (cmd): copy .env.example .env
# Edit .env: at least check MONGO_URI. SESSION_SECRET may stay as it is in development
# (a random one is used for each run and a warning is printed).

# 4. Seed the database (ERASES the existing data in that database, then inserts the sample data)
npm run seed

# 5. Start the development server
npm run dev                 # or: npm start
```

Then open **http://localhost:5000**. Log in with the demo buttons on the login page (development only) or with the [credentials below](#default-credentials).

### Quick tour (what to try)
1. **Customer**: log in as `rahul@example.com` → Menu → add items → Cart → Checkout (Cash on Delivery) → *My Orders* → open the order, or **Cancel Order** while it is Pending. *Profile* lets you update your details and **change your password**.
2. **Admin**: log in as `admin@foodiehub.com` → Dashboard (aggregation statistics) → *Orders*: move the order through Confirmed → Preparing → Out for Delivery → Delivered, or **Export CSV** → *Users*: deactivate / reactivate an account → *Foods* and *Categories*: add, edit, delete.

### Troubleshooting
| Symptom | Cause / fix |
|---------|-------------|
| `MongoDB Connection Error … ECONNREFUSED` and the process exits | MongoDB is not running, or `MONGO_URI` points to the wrong host/port. Start MongoDB and retry |
| `Invalid configuration: - MONGO_URI is required` | `.env` is missing: run `cp .env.example .env` |
| `Could not start the server: listen EADDRINUSE` | Port 5000 is taken. Set `PORT=5001` in `.env` |
| Logged out every time the server restarts | `SESSION_SECRET` is not set, so a random one is generated per run. Set a real one in `.env` |
| `429 Too many …` | A rate limit was hit (e.g. repeated wrong passwords). Wait for the time shown, or set `RATE_LIMIT_DISABLED=true` for local testing only |
| Food images are broken | The sample images are hot-linked from Unsplash and need an internet connection |

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
| `UPI_ID` | no | Your merchant UPI ID (`name@bank`). Empty = the UPI option is hidden/disabled and only Cash on Delivery is offered. Printed in the QR, so it is public, not a secret |
| `UPI_PAYEE_NAME` | no | Name shown by the customer's UPI app. Default `FoodieHub` |
| `UPI_PAYMENT_WINDOW_MINUTES` | no | Minutes to pay before the order is cancelled and the cart restored. 2–120, default `15` |
| `PAYMENT_WEBHOOK_SECRET` | no | Shared secret for `POST /api/payments/webhook` (**≥ 32 characters**). The webhook answers 503 while it is empty |

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
- **Integration** (`tests/integration`): the real app against a real MongoDB, in a separate database named `foodiehub_integration_test` that is wiped between tests — your own data is never touched. Point it at a server with `MONGO_TEST_URI=mongodb://127.0.0.1:27017`; if it is not set, `mongodb-memory-server` downloads a throw-away `mongod` on first use (needs internet access and Node 20.19+).
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
| **Module 8** | REST APIs, Routing, Route Parameters, HTTP Methods | 36 REST endpoints. `router.get()`, `.post()`, `.put()`, `.delete()`. Route params `/:id`, `/:foodId`. Correct HTTP verbs and status codes (200, 201, 400, 401, 403, 404, 409, 500). |
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

## Known Limitations

These are deliberate scope limits of a college project, not hidden bugs:

- **Payments**: Cash on Delivery, plus UPI QR (see its own limitations in [UPI QR payments](#upi-qr-payments): no payment gateway is integrated, no refunds). There is no tax, delivery fee or stock count (availability is a manual on/off switch per food).
- **No e-mail / SMS and no "forgot password"**: a user who forgets their password cannot reset it themselves (a logged-in user can change it from *Profile*).
- **Cancelling**: a customer can cancel only while the order is **Pending**; after that only an admin can cancel (up to *Preparing*).
- **Not paginated**: a customer's own order history and the admin user list (the menu, admin food list and admin order list are paginated).
- **Rate-limit counters live in the memory of one Node process**: they reset on restart and are not shared between several servers.
- **Last admin**: an admin cannot delete themselves, but two admins who deactivate each other at the same instant would both be locked out; fix it by setting `isActive: true` on one of them in MongoDB (or re-run `npm run seed`, which erases all data).
- **A late duplicate checkout** (a second "Place order" after the first finished) is answered with "Your cart is empty", not "already placed".
- **Concurrent password changes** by the same user on two devices at the same instant: the last one wins.
- **Tests**: the unit/frontend tests mock the database, so MongoDB's own behaviour (atomic updates, unique indexes, aggregation, the session store) is covered only by `npm run test:integration`, which needs a real MongoDB.
- **Demo accounts** (login-page buttons, README credentials) exist for demonstration; the buttons are off in production unless `ENABLE_DEMO_LOGIN=true`.

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
