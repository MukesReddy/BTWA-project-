// middleware/validationMiddleware.js
// Input validation middleware using express-validator
// BTWA Module 9: Middleware, BTWA Module 10: Input validation
//
// Rules of thumb used throughout this file:
//  • .isString() first — express-validator would otherwise coerce arrays/objects
//    (e.g. {"name": {"$gt": ""}}) into strings or let them through.
//  • Every text field has a maximum length.
//  • Sanitizers (.trim(), .toInt() …) write the cleaned value back to req.body.

const { validationResult, body, query } = require("express-validator");
const Category = require("../models/Category");
const { sendError, isValidObjectId } = require("../utils/helpers");
const { MAX_CART_QUANTITY, ORDER_STATUSES, MAX_SEARCH_LENGTH } = require("../utils/constants");

/**
 * handleValidationErrors
 * Reads validation results from express-validator and returns a 400.
 * Response keeps the standard `message` (all messages joined, so existing
 * frontend code keeps working) and adds a per-field `errors` array.
 * Use this AFTER validation rule chains.
 */
const handleValidationErrors = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  // First error per field only (avoids "Name is required, Name must be…" noise)
  const errors = result
    .array({ onlyFirstError: true })
    .map((e) => ({ field: e.path, message: e.msg }));

  return res.status(400).json({
    success: false,
    message: errors.map((e) => e.message).join(", "),
    errors,
  });
};

/**
 * validateIdParam
 * Use with router.param("id", validateIdParam). Rejects malformed MongoDB
 * ObjectIds with 400 BEFORE the controller runs (otherwise Mongoose throws a
 * CastError, which used to surface as a 500).
 */
const validateIdParam = (req, res, next, value, name) => {
  if (!isValidObjectId(value)) {
    return sendError(res, 400, `Invalid ${name}: '${String(value).slice(0, 40)}' is not a valid ID`);
  }
  next();
};

// ─── Reusable rule builders ──────────────────────────────────────────────────

const noAngleBrackets = (value) => !/[<>]/.test(value);

// express-validator runs standard validators on EACH element of an array, so
// {"quantity": [1]} would otherwise pass isInt(). Numbers/booleans must be scalars.
const scalarOnly = (field) =>
  body(field).not().isArray().withMessage(`${field} must be a single value`).bail();

/** Required text field: string, trimmed, min..max characters. */
const requiredText = (field, label, { min = 1, max, noHtml = false } = {}) => {
  let chain = body(field)
    .isString()
    .withMessage(`${label} is required`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ min, max })
    .withMessage(`${label} must be between ${min} and ${max} characters`);
  if (noHtml) {
    chain = chain.bail().custom(noAngleBrackets).withMessage(`${label} must not contain < or >`);
  }
  return chain;
};

/** Optional text field (empty string allowed, e.g. to clear a value). */
const optionalText = (field, label, { max, noHtml = false } = {}) => {
  let chain = body(field)
    .optional()
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .isLength({ max })
    .withMessage(`${label} must be at most ${max} characters`);
  if (noHtml) {
    chain = chain.bail().custom(noAngleBrackets).withMessage(`${label} must not contain < or >`);
  }
  return chain;
};

/** Optional http(s) URL (empty string / missing = not provided). */
const optionalUrl = (field, label) =>
  body(field)
    .optional({ values: "falsy" })
    .isString()
    .withMessage(`${label} must be a URL`)
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage(`${label} must be at most 500 characters`)
    .bail()
    .isURL({ protocols: ["http", "https"], require_protocol: true })
    .withMessage(`${label} must be a valid http(s) URL`);

const nameRules = (field = "name", label = "Name") =>
  requiredText(field, label, { min: 2, max: 60, noHtml: true });

const emailRule = () =>
  body("email")
    .isString()
    .withMessage("Email is required")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .bail()
    .isLength({ max: 254 })
    .withMessage("Email must be at most 254 characters")
    .bail()
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail();

const phoneRule = () =>
  body("phone")
    .optional({ values: "falsy" }) // '' is allowed: it clears the phone number
    .isString()
    .withMessage("Please provide a valid phone number")
    .bail()
    .trim()
    .isLength({ max: 20 })
    .withMessage("Phone number must be at most 20 characters")
    .bail()
    .isMobilePhone("any")
    .withMessage("Please provide a valid phone number");

/** Optional pincode: empty is fine, otherwise exactly 6 digits. */
const pincodeRule = (field, required) => {
  const base = required
    ? body(field).isString().withMessage("Pincode is required").bail().trim().notEmpty().withMessage("Pincode is required").bail()
    : body(field).optional({ values: "falsy" }).isString().withMessage("Pincode must be a 6-digit number").bail().trim();
  return base.matches(/^\d{6}$/).withMessage("Pincode must be a 6-digit number");
};

/** Address block. required=true → every field mandatory (checkout). */
const addressRules = (prefix, required) =>
  required
    ? [
        body(prefix).isObject().withMessage("Delivery address is required"),
        requiredText(`${prefix}.street`, "Street address", { min: 3, max: 200 }),
        requiredText(`${prefix}.city`, "City", { min: 2, max: 60 }),
        requiredText(`${prefix}.state`, "State", { min: 2, max: 60 }),
        pincodeRule(`${prefix}.pincode`, true),
      ]
    : [
        body(prefix).optional().isObject().withMessage("Address must be an object"),
        optionalText(`${prefix}.street`, "Street address", { max: 200 }),
        optionalText(`${prefix}.city`, "City", { max: 60 }),
        optionalText(`${prefix}.state`, "State", { max: 60 }),
        pincodeRule(`${prefix}.pincode`, false),
      ];

// ─── Validation Rule Sets ────────────────────────────────────────────────────

/**
 * Validate user registration fields
 */
const validateRegister = [
  nameRules(),
  emailRule(),
  body("password")
    .isString()
    .withMessage("Password is required")
    .bail()
    .notEmpty()
    .withMessage("Password is required")
    .bail()
    .isLength({ min: 6, max: 72 }) // bcrypt only uses the first 72 bytes
    .withMessage("Password must be between 6 and 72 characters"),
  phoneRule(),
  ...addressRules("address", false),
  handleValidationErrors,
];

/**
 * Validate a password change.
 * - currentPassword: only checked for being present text here; the real check is bcrypt in the controller.
 * - newPassword: the SAME 6–72 rule as registration, and it must differ from the current one.
 * Both must be plain strings (an array / object is rejected, never coerced).
 */
const validatePasswordChange = [
  body("currentPassword")
    .isString()
    .withMessage("Current password is required")
    .bail()
    .notEmpty()
    .withMessage("Current password is required")
    .bail()
    .isLength({ max: 72 }) // bcrypt only uses the first 72 bytes; no account can have a longer one
    .withMessage("Current password is incorrect"),
  body("newPassword")
    .isString()
    .withMessage("New password is required")
    .bail()
    .notEmpty()
    .withMessage("New password is required")
    .bail()
    .isLength({ min: 6, max: 72 })
    .withMessage("New password must be between 6 and 72 characters")
    .bail()
    .custom((value, { req }) => value !== req.body.currentPassword)
    .withMessage("New password must be different from the current password"),
  handleValidationErrors,
];

/**
 * Validate login fields
 */
const validateLogin = [
  emailRule(),
  body("password")
    .isString()
    .withMessage("Password is required")
    .bail()
    .notEmpty()
    .withMessage("Password is required")
    .bail()
    .isLength({ max: 128 })
    .withMessage("Password is too long"),
  handleValidationErrors,
];

/**
 * Validate food item fields (admin create / update)
 */
const validateFood = [
  requiredText("name", "Food name", { min: 1, max: 100 }),
  optionalText("description", "Description", { max: 1000 }),
  scalarOnly("price")
    .notEmpty()
    .withMessage("Price is required")
    .bail()
    .isFloat({ min: 0, max: 100000 })
    .withMessage("Price must be a number between 0 and 100000")
    .toFloat(),
  body("category")
    .isString()
    .withMessage("Category is required")
    .bail()
    .isMongoId()
    .withMessage("Category must be a valid ID")
    .bail()
    .custom(async (value) => {
      // Referential integrity: the category must actually exist
      if (!(await Category.exists({ _id: value }))) {
        throw new Error("Category does not exist");
      }
      return true;
    }),
  optionalUrl("image", "Image"),
  body("ingredients")
    .optional()
    .isArray({ max: 30 })
    .withMessage("Ingredients must be a list of at most 30 items"),
  body("ingredients.*")
    .isString()
    .withMessage("Each ingredient must be text")
    .bail()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Each ingredient must be 1-50 characters"),
  body("rating")
    .optional()
    .not()
    .isArray()
    .withMessage("Rating must be a single value")
    .bail()
    .isFloat({ min: 0, max: 5 })
    .withMessage("Rating must be a number between 0 and 5")
    .toFloat(),
  body("available")
    .optional()
    .not()
    .isArray()
    .withMessage("Available must be true or false")
    .bail()
    .isBoolean()
    .withMessage("Available must be true or false")
    .toBoolean(),
  handleValidationErrors,
];

/**
 * Validate category fields
 */
const validateCategory = [
  requiredText("name", "Category name", { min: 1, max: 50 }),
  optionalText("description", "Description", { max: 300 }),
  optionalUrl("image", "Image"),
  handleValidationErrors,
];

/**
 * Validate add-to-cart fields
 */
const quantityRule = () =>
  scalarOnly("quantity")
    .notEmpty()
    .withMessage("Quantity is required")
    .bail()
    .isInt({ min: 1, max: MAX_CART_QUANTITY })
    .withMessage(`Quantity must be a whole number between 1 and ${MAX_CART_QUANTITY}`)
    .toInt();

const validateCartItem = [
  body("foodId")
    .isString()
    .withMessage("Food ID is required")
    .bail()
    .isMongoId()
    .withMessage("Food ID must be a valid ID"),
  quantityRule(),
  handleValidationErrors,
];

/**
 * Validate cart quantity update (PUT /api/cart/:foodId)
 */
const validateCartUpdate = [quantityRule(), handleValidationErrors];

/**
 * Validate order placement
 */
const validateOrder = [
  ...addressRules("deliveryAddress", true),
  body("paymentMethod")
    .notEmpty()
    .withMessage("Payment method is required")
    .bail()
    .isIn(["Cash on Delivery"])
    .withMessage("Only Cash on Delivery is supported"),
  handleValidationErrors,
];

/**
 * Start an online (UPI) payment: POST /api/payments/upi.
 * Only the delivery address is read. The amount is NEVER taken from the request: the server prices the cart.
 * (An "amount" / "totalAmount" field in the body is simply ignored: see paymentController.)
 */
const validateUpiPayment = [...addressRules("deliveryAddress", true), handleValidationErrors];

/**
 * Admin confirms or rejects an online payment after checking the bank statement:
 * PUT /api/admin/orders/:id/payment  { status: "PAID"|"FAILED", transactionId }
 * The bank reference (UTR) is mandatory for PAID: it is what makes a payment traceable and a duplicate detectable.
 */
const TRANSACTION_ID_RULE = /^[A-Za-z0-9_-]{6,64}$/;
const validateAdminPayment = [
  body("status").isIn(["PAID", "FAILED"]).withMessage('status must be "PAID" or "FAILED"'),
  body("transactionId").custom((value, { req }) => {
    if (value === undefined || value === null || value === "") {
      if (req.body.status === "PAID") throw new Error("The bank transaction id (UTR) is required to mark a payment as paid");
      return true;
    }
    if (typeof value !== "string" || !TRANSACTION_ID_RULE.test(value.trim())) {
      throw new Error("Transaction id must be 6-64 letters, digits, - or _");
    }
    return true;
  }),
  handleValidationErrors,
];

// ─── Query-string validation (P1.8) ──────────────────────────────────────────
// Query parameters end up inside MongoDB filters, so each one must be a plain string of the
// expected shape. (The app also uses Express's "simple" query parser, so ?a[$ne]=x is never
// turned into a nested object; repeated keys like ?search=a&search=b still arrive as arrays,
// which is why every rule starts with .isString().)

const textQuery = (field) =>
  query(field)
    .optional()
    .isString()
    .withMessage(`${field} must be a single text value`)
    .bail()
    .trim()
    .isLength({ max: MAX_SEARCH_LENGTH })
    .withMessage(`${field} must be at most ${MAX_SEARCH_LENGTH} characters`);

const enumQuery = (field, allowed) =>
  query(field)
    .optional()
    .isString()
    .withMessage(`${field} must be a single value`)
    .bail()
    .isIn(["", ...allowed])
    .withMessage(`${field} must be one of: ${allowed.join(", ")}`);

const intQuery = (field, { max }) =>
  query(field)
    .optional()
    .isString()
    .withMessage(`${field} must be a whole number`)
    .bail()
    .isInt({ min: 1, max })
    .withMessage(`${field} must be a whole number between 1 and ${max}`);

const priceQuery = (field) =>
  query(field)
    .optional({ values: "falsy" })
    .isString()
    .withMessage(`${field} must be a number`)
    .bail()
    .isFloat({ min: 0, max: 10000000 })
    .withMessage(`${field} must be a number between 0 and 10000000`);

/** GET /api/foods */
const validateFoodQuery = [
  textQuery("search"),
  query("category")
    .optional({ values: "falsy" })
    .isString()
    .withMessage("category must be a single ID")
    .bail()
    .isMongoId()
    .withMessage("category must be a valid ID"),
  priceQuery("minPrice"),
  priceQuery("maxPrice"),
  enumQuery("available", ["true", "false"]),
  enumQuery("sort", ["price_asc", "price_desc", "rating", "newest"]),
  intQuery("page", { max: 100000 }),
  intQuery("limit", { max: 1000 }), // the controller still caps the page size
  handleValidationErrors,
];

/** GET /api/admin/users */
const validateUserQuery = [textQuery("search"), enumQuery("role", ["customer", "admin"]), handleValidationErrors];

/** GET /api/admin/orders */
const validateOrderQuery = [
  enumQuery("status", ORDER_STATUSES),
  intQuery("page", { max: 100000 }),
  intQuery("limit", { max: 1000 }),
  handleValidationErrors,
];

/**
 * Validate profile update (PUT /api/users/profile). Every field is optional,
 * but anything that IS sent must be valid.
 */
const validateProfile = [
  body("name")
    .optional()
    .isString()
    .withMessage("Name must be text")
    .bail()
    .trim()
    .isLength({ min: 2, max: 60 })
    .withMessage("Name must be between 2 and 60 characters")
    .bail()
    .custom(noAngleBrackets)
    .withMessage("Name must not contain < or >"),
  phoneRule(),
  ...addressRules("address", false),
  handleValidationErrors,
];

module.exports = {
  validateRegister,
  validateLogin,
  validateFood,
  validateCategory,
  validateCartItem,
  validateCartUpdate,
  validateOrder,
  validateUpiPayment,
  validateAdminPayment,
  validateProfile,
  validatePasswordChange,
  validateFoodQuery,
  validateUserQuery,
  validateOrderQuery,
  validateIdParam,
  handleValidationErrors,
};
