// controllers/cartController.js
// Cart management controller
// BTWA Module 2: Array operations in MongoDB, update operators ($inc, $push, $pull, positional $)
// BTWA Module 3: Mongoose populate
//
// Concurrency note: every cart change is ONE atomic MongoDB update operation
// (never "read the cart → change it in JS → save()"), so two requests arriving
// at the same time cannot overwrite each other or create two carts.

const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Food = require("../models/Food");
const { sendSuccess, sendError } = require("../utils/helpers");
const { MAX_CART_QUANTITY } = require("../utils/constants");

const MAX_ATTEMPTS = 3;

/**
 * buildCartResponse
 * Turns a Cart document into the API response shape
 *   { ...cart, items: [{ food:{_id,name,image,price,available}, quantity, price }], total }
 *
 * - Prices come from the CURRENT Food document, so the cart total always matches
 *   what checkout will charge (a stored price snapshot could be stale).
 * - Lines whose food no longer exists are dropped from the response and pruned
 *   from the database (self-healing).
 * BTWA Module 3: selective fields (select) + $in query
 */
const buildCartResponse = async (cart) => {
  const ids = cart.items.map((item) => item.food);
  const foods = await Food.find({ _id: { $in: ids } })
    .select("name image price available")
    .lean();
  const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

  const items = [];
  const staleIds = [];
  for (const item of cart.items) {
    const food = foodMap.get(item.food.toString());
    if (!food) {
      staleIds.push(item.food);
      continue;
    }
    items.push({ food, quantity: item.quantity, price: food.price });
  }

  if (staleIds.length) {
    await Cart.updateOne({ _id: cart._id }, { $pull: { items: { food: { $in: staleIds } } } });
  }

  const total =
    Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;

  const base = typeof cart.toObject === "function" ? cart.toObject() : cart;
  return { ...base, items, total };
};

/**
 * Reading the cart back after a successful write can find NO cart: an order placed at the same moment
 * (two tabs, a double click) claims the cart atomically and deletes it (services/orderService.js).
 * That is a conflict the customer can resolve by reviewing the cart, not a server fault — so 409, never a 500.
 */
const CART_CHECKED_OUT = "Your cart was just checked out. Please review your cart and try again.";

/**
 * addItemToCart
 * Atomically adds `quantity` of a food to the user's cart.
 * Returns "added" or "limit" (would exceed MAX_CART_QUANTITY for that item).
 *
 *  1. Line already in cart → $inc its quantity with the positional operator `$`.
 *     The $elemMatch in the filter enforces the per-item maximum inside MongoDB.
 *  2. Step 1 matched nothing. That means EITHER there is no line yet, OR the line is at
 *     the cap. Only report "limit" if a line that would really exceed the cap exists.
 *     (Never infer the cap from "a line exists": a concurrent request may have created
 *     the line a moment after step 1 ran — that is not a limit, just a lost race.)
 *  3. Otherwise $push the line (upsert creates the cart if the user has none).
 *     The filter `items.food: {$ne}` means it only matches when the line is absent. If
 *     a concurrent request created the cart/line first, the upsert tries to insert a
 *     second cart for the user, the unique index on `user` rejects it with E11000, and
 *     we simply retry from step 1 (where the $inc now matches).
 */
const addItemToCart = async (userId, food, quantity) => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. increment existing line (BTWA Module 2: $inc + positional $ + $elemMatch)
    const incremented = await Cart.updateOne(
      {
        user: userId,
        items: { $elemMatch: { food: food._id, quantity: { $lte: MAX_CART_QUANTITY - quantity } } },
      },
      { $inc: { "items.$.quantity": quantity }, $set: { "items.$.price": food.price } }
    );
    if (incremented.matchedCount === 1) return "added";

    // 2. is there a line that would REALLY go over the cap? (see note above)
    const wouldExceed = await Cart.exists({
      user: userId,
      items: { $elemMatch: { food: food._id, quantity: { $gt: MAX_CART_QUANTITY - quantity } } },
    });
    if (wouldExceed) return "limit";

    // 3. no line yet → push (BTWA Module 2: $push, upsert)
    try {
      await Cart.updateOne(
        { user: userId, "items.food": { $ne: food._id } },
        { $push: { items: { food: food._id, quantity, price: food.price } } },
        { upsert: true, setDefaultsOnInsert: false }
      );
      return "added";
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Lost the race to create the cart (or to add this line) → try again
    }
  }

  const err = new Error("Could not update your cart right now. Please try again.");
  err.statusCode = 409;
  throw err;
};

/**
 * @route   GET /api/cart
 * @desc    Get the logged-in user's cart
 * @access  Authenticated
 * BTWA Module 3: findOne + populate
 */
const getCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.session.userId });

    if (!cart) {
      return sendSuccess(res, 200, "Cart is empty", { items: [], total: 0 });
    }

    return sendSuccess(res, 200, "Cart retrieved", await buildCartResponse(cart));
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/cart
 * @desc    Add a food item to cart (or increment quantity if already present)
 * @access  Authenticated
 * BTWA Module 2: Array operations, atomic update operators
 */
const addToCart = async (req, res, next) => {
  try {
    // foodId and quantity were validated (and quantity converted to an integer)
    // by validateCartItem before reaching this point.
    const { foodId } = req.body;
    const quantity = Number(req.body.quantity);

    // Verify food exists and is available (BTWA Module 2: findById)
    const food = await Food.findById(foodId);
    if (!food) {
      return sendError(res, 404, "Food item not found");
    }
    if (!food.available) {
      return sendError(res, 400, "This food item is currently unavailable");
    }

    const result = await addItemToCart(req.session.userId, food, quantity);
    if (result === "limit") {
      return sendError(
        res,
        400,
        `You can order at most ${MAX_CART_QUANTITY} of one item`
      );
    }

    const cart = await Cart.findOne({ user: req.session.userId });
    if (!cart) {
      return sendError(res, 409, CART_CHECKED_OUT);
    }
    return sendSuccess(res, 200, "Item added to cart", await buildCartResponse(cart));
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/cart/:foodId
 * @desc    Update quantity of a cart item
 * @access  Authenticated
 * BTWA Module 2: positional $ operator
 */
const updateCartItem = async (req, res, next) => {
  try {
    const quantity = Number(req.body.quantity); // validated: integer 1..MAX_CART_QUANTITY
    const { foodId } = req.params;

    // Atomic: matches the user's cart AND the line, then sets that line only.
    const result = await Cart.updateOne(
      { user: req.session.userId, "items.food": foodId },
      { $set: { "items.$.quantity": quantity } }
    );
    if (result.matchedCount === 0) {
      return sendError(res, 404, "Item not found in cart");
    }

    const cart = await Cart.findOne({ user: req.session.userId });
    if (!cart) {
      return sendError(res, 409, CART_CHECKED_OUT);
    }
    return sendSuccess(res, 200, "Cart updated", await buildCartResponse(cart));
  } catch (error) {
    next(error);
  }
};

/**
 * @route   DELETE /api/cart/:foodId
 * @desc    Remove a specific item from cart
 * @access  Authenticated
 * BTWA Module 2: $pull update operator — removes matching array element directly in MongoDB
 * Using findOneAndUpdate + $pull is more efficient than fetch → filter → save
 */
const removeCartItem = async (req, res, next) => {
  try {
    const { foodId } = req.params;

    // $pull removes the matching element from the items array atomically in MongoDB
    // BTWA Module 2: $pull update operator
    const cart = await Cart.findOneAndUpdate(
      { user: req.session.userId },
      { $pull: { items: { food: new mongoose.Types.ObjectId(foodId) } } },
      { new: true } // Return the updated document
    );

    if (!cart) {
      return sendError(res, 404, "Cart not found");
    }

    return sendSuccess(res, 200, "Item removed from cart", await buildCartResponse(cart));
  } catch (error) {
    next(error);
  }
};


/**
 * @route   DELETE /api/cart/clear
 * @desc    Clear the entire cart
 * @access  Authenticated
 */
const clearCart = async (req, res, next) => {
  try {
    await Cart.findOneAndDelete({ user: req.session.userId });
    return sendSuccess(res, 200, "Cart cleared");
  } catch (error) {
    next(error);
  }
};

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart, buildCartResponse };
