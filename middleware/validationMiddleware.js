// middleware/validationMiddleware.js
// Input validation middleware using express-validator
// BTWA Module 9: Middleware, BTWA Module 10: Input validation

const { validationResult, body } = require("express-validator");
const { sendError } = require("../utils/helpers");

/**
 * handleValidationErrors
 * Reads validation results from express-validator and returns errors
 * Use this AFTER validation rule chains
 *
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Next middleware
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Combine all validation messages into a single readable string
    const messages = errors.array().map((e) => e.msg).join(", ");
    return sendError(res, 400, messages);
  }
  next();
};

// ─── Validation Rule Sets ────────────────────────────────────────────────────

/**
 * Validate user registration fields
 */
const validateRegister = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters"),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),

  body("phone")
    .optional()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),

  handleValidationErrors,
];

/**
 * Validate login fields
 */
const validateLogin = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("password").notEmpty().withMessage("Password is required"),

  handleValidationErrors,
];

/**
 * Validate food item fields
 */
const validateFood = [
  body("name").trim().notEmpty().withMessage("Food name is required"),

  body("price")
    .notEmpty()
    .withMessage("Price is required")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),

  body("category").notEmpty().withMessage("Category is required"),

  handleValidationErrors,
];

/**
 * Validate category fields
 */
const validateCategory = [
  body("name").trim().notEmpty().withMessage("Category name is required"),
  handleValidationErrors,
];

/**
 * Validate add-to-cart fields
 */
const validateCartItem = [
  body("foodId").notEmpty().withMessage("Food ID is required"),
  body("quantity")
    .notEmpty()
    .withMessage("Quantity is required")
    .isInt({ min: 1 })
    .withMessage("Quantity must be at least 1"),
  handleValidationErrors,
];

/**
 * Validate order placement
 */
const validateOrder = [
  body("deliveryAddress.street")
    .trim()
    .notEmpty()
    .withMessage("Street address is required"),
  body("deliveryAddress.city").trim().notEmpty().withMessage("City is required"),
  body("deliveryAddress.state").trim().notEmpty().withMessage("State is required"),
  body("deliveryAddress.pincode")
    .trim()
    .notEmpty()
    .withMessage("Pincode is required"),
  body("paymentMethod")
    .notEmpty()
    .withMessage("Payment method is required")
    .isIn(["Cash on Delivery"])
    .withMessage("Only Cash on Delivery is supported"),
  handleValidationErrors,
];

module.exports = {
  validateRegister,
  validateLogin,
  validateFood,
  validateCategory,
  validateCartItem,
  validateOrder,
  handleValidationErrors,
};
