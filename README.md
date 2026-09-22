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
- Update profile and delivery address

### Admin
- Admin dashboard with real-time MongoDB aggregation statistics
- Manage food items (add, edit, delete)
- Manage categories (add, edit, delete with integrity check)
- View and manage all users
- View all orders with status filtering
- Update order status through the full lifecycle
- Export all orders as a CSV file (Node.js streams demo)

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Authentication | express-session, bcryptjs |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Middleware | Helmet, CORS, Morgan, express-validator |
| Session Store | connect-mongo (sessions in MongoDB) |
| Dev Tools | nodemon, dotenv |

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
    │   ├── CORS
    │   ├── Morgan (HTTP logger)
    │   ├── express.json() + urlencoded()
    │   ├── express-session (MongoDB store)
    │   ├── authMiddleware (session-based auth)
    │   ├── adminMiddleware (role-based auth)
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
        └── helpers.js (utility functions)
```

---

## Folder Structure

```
online-food-ordering/
├── server.js                   # Entry point — full middleware stack
├── seed.js                     # Database seeder
├── package.json
├── .env                        # Environment variables (not committed)
├── .env.example
├── .gitignore
│
├── config/
│   └── db.js                   # MongoDB connection
│
├── models/
│   ├── User.js                 # bcrypt, embedded address, role
│   ├── Food.js                 # Text index, category ref, ingredients array
│   ├── Category.js             # Category schema
│   ├── Cart.js                 # Embedded cart items, user reference
│   └── Order.js                # Price snapshots, embedded address, status enum
│
├── routes/
│   ├── authRoutes.js           # POST /api/auth/register|login|logout, GET /me
│   ├── foodRoutes.js           # GET /api/foods, GET|POST|PUT|DELETE /api/foods/:id
│   ├── categoryRoutes.js       # CRUD /api/categories
│   ├── cartRoutes.js           # GET|POST|PUT|DELETE /api/cart
│   ├── orderRoutes.js          # POST /api/orders, GET /api/orders, GET /api/orders/:id
│   ├── adminRoutes.js          # Admin-only routes
│   └── userRoutes.js           # GET|PUT /api/users/profile
│
├── controllers/
│   ├── authController.js       # register, login (session), logout, getMe
│   ├── foodController.js       # CRUD + search/filter/sort/pagination
│   ├── categoryController.js   # CRUD + integrity check
│   ├── cartController.js       # add/update/remove/clear
│   ├── orderController.js      # placeOrder, getMyOrders, getOrderById
│   ├── adminController.js      # dashboard, users, orders, CSV export (streams)
│   └── userController.js       # getProfile, updateProfile
│
├── middleware/
│   ├── authMiddleware.js       # isAuthenticated (session check)
│   ├── adminMiddleware.js      # isAdmin (role check)
│   ├── errorMiddleware.js      # notFound + global errorHandler
│   └── validationMiddleware.js # express-validator rule sets
│
├── services/
│   ├── orderService.js         # createOrder (server-side price validation)
│   └── analyticsService.js     # getDashboardStats (aggregation pipelines)
│
├── utils/
│   ├── logger.js               # Async fs.appendFile logger
│   ├── eventEmitter.js         # Custom EventEmitter with 5 event listeners
│   └── helpers.js              # sendSuccess, sendError, calculateTotal, etc.
│
├── logs/
│   └── application.log         # Auto-generated application log
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

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
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
| GET | /api/orders/:id | Auth | Order details |

### Admin
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/admin/dashboard | Admin | Dashboard stats (aggregation) |
| GET | /api/admin/users | Admin | All users |
| DELETE | /api/admin/users/:id | Admin | Delete user |
| GET | /api/admin/orders | Admin | All orders |
| PUT | /api/admin/orders/:id/status | Admin | Update order status |
| GET | /api/admin/export/orders | Admin | Export CSV (streams) |

### Users
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/users/profile | Auth | View profile |
| PUT | /api/users/profile | Auth | Update profile |

---

## Authentication Mechanism

1. **Registration**: User data validated → email uniqueness checked → password bcrypt hashed via Mongoose pre-save hook → user saved → 201 response
2. **Login**: Email/password received → user fetched with `select('+password')` → bcrypt.compare() → session created with `req.session.userId` and `req.session.role` → session stored in MongoDB via connect-mongo
3. **Session validation**: Every protected route passes through `isAuthenticated` middleware which checks `req.session.userId`
4. **Admin authorization**: Admin routes additionally pass through `isAdmin` middleware which checks `req.session.role === 'admin'`
5. **Logout**: `req.session.destroy()` → `res.clearCookie('foodiehub.sid')`

---

## Middleware Stack (in order)

```javascript
app.use(helmet())              // 1. Security headers
app.use(cors())                // 2. CORS
app.use(morgan('dev'))         // 3. HTTP request logging
app.use(express.json())        // 4. Parse JSON bodies
app.use(express.urlencoded())  // 5. Parse form data
app.use(session({...}))        // 6. Session management (MongoDB store)
app.use(express.static())      // 7. Serve frontend files
app.use('/api/...')            // 8. Route handlers
app.use(notFound)              // 9. 404 handler
app.use(errorHandler)          // 10. Global error handler
```

Custom route-level middleware:
- `isAuthenticated` — session validation
- `isAdmin` — role verification
- `validateRegister`, `validateLogin`, `validateFood`, etc. — input validation

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
// 1. Total orders and revenue
Order.aggregate([{ $group: { _id: null, totalOrders: {$sum:1}, totalRevenue: {$sum:'$totalAmount'} } }])

// 2. Orders grouped by status
Order.aggregate([{ $group: { _id: '$orderStatus', count: {$sum:1} } }, { $sort: {count:-1} }])

// 3. Popular foods (unwind items)
Order.aggregate([
  { $unwind: '$items' },
  { $group: { _id: '$items.food', foodName: {$first:'$items.foodName'}, totalOrdered: {$sum:'$items.quantity'} } },
  { $sort: { totalOrdered: -1 } },
  { $limit: 5 }
])

// 4. Revenue by date (last 7 days)
Order.aggregate([
  { $match: { createdAt: { $gte: sevenDaysAgo } } },
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

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/online_food_ordering
SESSION_SECRET=replace_with_a_strong_random_secret
NODE_ENV=development
```

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

---

## Postman Testing

Import the following requests into Postman:

### Authentication
```
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
POST   http://localhost:5000/api/orders     Body: {deliveryAddress:{...}, paymentMethod:"Cash on Delivery"}
GET    http://localhost:5000/api/orders
GET    http://localhost:5000/api/orders/<id>
```

### Admin (must be logged in as admin)
```
GET    http://localhost:5000/api/admin/dashboard
GET    http://localhost:5000/api/admin/users
GET    http://localhost:5000/api/admin/orders?status=Pending
PUT    http://localhost:5000/api/admin/orders/<id>/status  Body: {"status":"Confirmed"}
GET    http://localhost:5000/api/admin/export/orders
```

> **Tip**: In Postman, enable "Automatically follow redirects" and set cookie handling to "Send cookies". The server uses session cookies (not JWT).

---

## BTWA Module Mapping

| Module | Topic | Implementation in FoodieHub |
|--------|-------|---------------------------|
| **Module 1** | MongoDB, NoSQL, Documents, Collections, JSON | MongoDB database `online_food_ordering` with 5 collections. All API responses use JSON. Documents store food, users, orders. |
| **Module 2** | CRUD, Queries, Arrays, Embedded Documents, Cursors | Full CRUD on foods/categories/orders. `ingredients[]` array field. Embedded `address` in users. `.find().sort().skip().limit()` cursor chain in menu. Comparison operators `$gte`, `$lte`. Regex search. |
| **Module 3** | Indexes, Aggregation, Mongoose, Schema Design | Text index on food name, compound indexes on orders. Aggregation in `analyticsService.js` with `$group`, `$unwind`, `$sort`, `$dateToString`. Full Mongoose schemas with validation, populate, timestamps. |
| **Module 4** | Node.js Runtime, Filesystem, Async Operations | `utils/logger.js` uses `fs.appendFile()` (async, non-blocking). `fs.readFile()` demonstrated. All DB/FS operations use async/await. Logs written on every key event. |
| **Module 5** | Modules, require/exports, JSON, EventEmitter, Streams | `require()` and `module.exports` throughout. Custom EventEmitter in `utils/eventEmitter.js`. Events: `orderPlaced`, `userLoggedIn`, etc. Streams in `exportOrdersCSV()`: Readable → Transform → Writable. |
| **Module 6** | npm, Dependencies, Node Architecture, Event Loop | `package.json` with `start`, `dev`, `seed` scripts. Production vs devDependencies. Non-blocking I/O throughout — no sync operations in request handlers. |
| **Module 7** | Express.js, Request/Response | Express app in `server.js`. `req.body`, `req.params`, `req.query`, `req.session`. JSON responses with status codes. Static file serving. |
| **Module 8** | REST APIs, Routing, Route Parameters, HTTP Methods | 40+ REST endpoints. `router.get()`, `.post()`, `.put()`, `.delete()`. Route params `/:id`, `/:foodId`. Correct HTTP verbs and status codes (200, 201, 400, 401, 403, 404, 409, 500). |
| **Module 9** | Middleware, CORS, Morgan, Helmet, Error Handling | Helmet (security headers), CORS (cross-origin), Morgan (HTTP logs), custom auth/admin/validation middleware. Centralized error handler in `errorMiddleware.js`. |
| **Module 10** | Cookies, Sessions, Authentication, Flash Messages | `express-session` with MongoDB store. Session cookie `foodiehub.sid`. `req.session.userId`, `req.session.role`. bcrypt password hashing. Session-based flash messages (`req.session.flash`). Role-based authorization. |

---

## Security

- Passwords stored with bcrypt (10 salt rounds) — never plaintext
- Sessions stored in MongoDB via connect-mongo
- Session cookie: `httpOnly: true` (XSS protection), `secure: true` in production
- Helmet adds 11 security headers
- CORS configured with `credentials: true`
- Admin authorization verified on every server request
- Price calculations done server-side only
- Environment variables for all secrets
- Stack traces never exposed to client in production

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
10. Unit tests with Jest and Supertest
