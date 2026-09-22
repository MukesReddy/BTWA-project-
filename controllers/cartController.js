// controllers/cartController.js
// Cart management controller
// BTWA Module 2: Array operations in MongoDB, update operators
// BTWA Module 3: Mongoose populate

const Cart = require("../models/Cart");
const Food = require("../models/Food");
const { sendSuccess, sendError } = require("../utils/helpers");

/**
 * @route   GET /api/cart
 * @desc    Get the logged-in user's cart
 * @access  Authenticated
 * BTWA Module 3: findOne + populate
 */
const getCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.session.userId })
      .populate("items.food", "name image price available"); // BTWA Module 3: Selective populate

    if (!cart) {
      return sendSuccess(res, 200, "Cart is empty", { items: [], total: 0 });
    }

    // Calculate cart total
    const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return sendSuccess(res, 200, "Cart retrieved", { ...cart.toObject(), total });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/cart
 * @desc    Add a food item to cart (or increment quantity if already present)
 * @access  Authenticated
 * BTWA Module 2: Array operations, findOne, save
 */
const addToCart = async (req, res, next) => {
  try {
    const { foodId, quantity = 1 } = req.body;

    // Verify food exists and is available (BTWA Module 2: findById)
    const food = await Food.findById(foodId);
    if (!food) {
      return sendError(res, 404, "Food item not found");
    }
    if (!food.available) {
      return sendError(res, 400, "This food item is currently unavailable");
    }

    // Find or create cart for this user
    let cart = await Cart.findOne({ user: req.session.userId });
    if (!cart) {
      cart = new Cart({ user: req.session.userId, items: [] });
    }

    // Check if food is already in cart (BTWA Module 2: Array query)
    const existingItemIndex = cart.items.findIndex(
      (item) => item.food.toString() === foodId
    );

    if (existingItemIndex > -1) {
      // Item exists — increment quantity
      cart.items[existingItemIndex].quantity += parseInt(quantity);
    } else {
      // New item — push to items array (BTWA Module 2: Array push)
      cart.items.push({
        food: foodId,
        quantity: parseInt(quantity),
        price: food.price, // Store current price
      });
    }

    await cart.save();

    // Return populated cart
    await cart.populate("items.food", "name image price available");
    const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return sendSuccess(res, 200, "Item added to cart", { ...cart.toObject(), total });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/cart/:foodId
 * @desc    Update quantity of a cart item
 * @access  Authenticated
 */
const updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const { foodId } = req.params;

    if (!quantity || quantity < 1) {
      return sendError(res, 400, "Quantity must be at least 1");
    }

    const cart = await Cart.findOne({ user: req.session.userId });
    if (!cart) {
      return sendError(res, 404, "Cart not found");
    }

    // Find the item in cart (BTWA Module 2: Array element query)
    const itemIndex = cart.items.findIndex((item) => item.food.toString() === foodId);
    if (itemIndex === -1) {
      return sendError(res, 404, "Item not found in cart");
    }

    // Update quantity
    cart.items[itemIndex].quantity = parseInt(quantity);
    await cart.save();

    await cart.populate("items.food", "name image price available");
    const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return sendSuccess(res, 200, "Cart updated", { ...cart.toObject(), total });
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
    const mongoose = require("mongoose");

    // $pull removes the matching element from the items array atomically in MongoDB
    // BTWA Module 2: $pull update operator
    const cart = await Cart.findOneAndUpdate(
      { user: req.session.userId },
      { $pull: { items: { food: new mongoose.Types.ObjectId(foodId) } } },
      { new: true } // Return the updated document
    ).populate("items.food", "name image price available");

    if (!cart) {
      return sendError(res, 404, "Cart not found");
    }

    const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return sendSuccess(res, 200, "Item removed from cart", { ...cart.toObject(), total });
  } catch (error) {
    next(error);
  }
};


/**
 * @route   DELETE /api/cart
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

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart };
