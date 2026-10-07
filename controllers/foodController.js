// controllers/foodController.js
// Food CRUD + Search + Filter + Sort + Pagination controller
// BTWA Module 2: MongoDB queries, operators, cursors
// BTWA Module 3: Mongoose, text search, indexes
// BTWA Module 8: REST API

const Food = require("../models/Food");
const Cart = require("../models/Cart");
const { sendSuccess, sendError, escapeRegex } = require("../utils/helpers");

/**
 * @route   GET /api/foods
 * @desc    Get all foods with optional search, filter, sort, pagination
 * @access  Public
 *
 * Query params:
 *   search    — text search on name/description
 *   category  — filter by category ID
 *   minPrice  — minimum price (comparison operator)
 *   maxPrice  — maximum price (comparison operator)
 *   available — filter by availability (true/false)
 *   sort      — price_asc | price_desc | rating | newest
 *   page      — page number (default 1)
 *   limit     — items per page (default 12)
 *
 * BTWA Module 2: Comparison operators ($gte, $lte), logical operators ($and),
 *                text search, cursors (find, sort, skip, limit)
 */
const getFoods = async (req, res, next) => {
  try {
    const {
      search,
      category,
      minPrice,
      maxPrice,
      available,
      sort,
      page = 1,
      limit = 12,
    } = req.query;

    // Build query object (BTWA Module 2: Query building with operators)
    const query = {};

    // Text search using $regex (BTWA Module 2: Regex queries)
    // The text is escaped so it is matched literally ("C++" works, ".*" is not a wildcard, no ReDoS).
    // `search` is already validated as a short string by validateFoodQuery.
    if (search && search.trim()) {
      const pattern = escapeRegex(search.trim());
      query.$or = [
        { name: { $regex: pattern, $options: "i" } },
        { description: { $regex: pattern, $options: "i" } },
      ];
    }

    // Category filter (BTWA Module 2: ObjectId query)
    if (category) {
      query.category = category;
    }

    // Price range filter (BTWA Module 2: Comparison operators $gte, $lte)
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Availability filter (BTWA Module 2: Boolean query)
    if (available !== undefined && available !== "") {
      query.available = available === "true";
    }

    // Sort options (BTWA Module 2: sort() cursor operation)
    let sortOption = { createdAt: -1 }; // Default: newest first
    if (sort === "price_asc")  sortOption = { price: 1 };
    if (sort === "price_desc") sortOption = { price: -1 };
    if (sort === "rating")     sortOption = { rating: -1 };
    if (sort === "newest")     sortOption = { createdAt: -1 };

    // Pagination (BTWA Module 2: skip() and limit() cursor operations)
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip     = (pageNum - 1) * limitNum;

    // Execute query with population, sort, pagination
    // BTWA Module 3: Mongoose populate (Food → Category)
    const foods = await Food.find(query)
      .populate("category", "name image") // Populate category name and image only
      .sort(sortOption)
      .skip(skip)                          // BTWA Module 2: skip cursor
      .limit(limitNum);                    // BTWA Module 2: limit cursor

    // Count total matching documents for pagination
    const total = await Food.countDocuments(query);

    return sendSuccess(res, 200, "Foods retrieved", {
      foods,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/foods/:id
 * @desc    Get a single food item by ID
 * @access  Public
 * BTWA Module 2: findById, populate
 */
const getFoodById = async (req, res, next) => {
  try {
    // BTWA Module 3: Mongoose populate — Food → Category
    const food = await Food.findById(req.params.id).populate("category", "name description image");
    if (!food) {
      return sendError(res, 404, "Food item not found");
    }
    return sendSuccess(res, 200, "Food retrieved", food);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/foods
 * @desc    Create a new food item
 * @access  Admin
 * BTWA Module 2: Create (insert) operation
 */
const createFood = async (req, res, next) => {
  try {
    const { name, description, price, category, image, ingredients, available, rating } = req.body;

    const food = await Food.create({
      name, description, price, category, image,
      ingredients: ingredients || [],
      available: available !== undefined ? available : true,
      rating: rating ?? 4.0, // ?? (not ||) so an explicit rating of 0 is kept
    });

    // Populate category for response
    await food.populate("category", "name");

    return sendSuccess(res, 201, "Food item created successfully", food);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/foods/:id
 * @desc    Update a food item
 * @access  Admin
 * BTWA Module 2: findByIdAndUpdate
 */
const updateFood = async (req, res, next) => {
  try {
    const { name, description, price, category, image, ingredients, available, rating } = req.body;

    const food = await Food.findByIdAndUpdate(
      req.params.id,
      { name, description, price, category, image, ingredients, available, rating },
      { new: true, runValidators: true }
    ).populate("category", "name");

    if (!food) {
      return sendError(res, 404, "Food item not found");
    }

    return sendSuccess(res, 200, "Food item updated successfully", food);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   DELETE /api/foods/:id
 * @desc    Delete a food item
 * @access  Admin
 * BTWA Module 2: findByIdAndDelete
 */
const deleteFood = async (req, res, next) => {
  try {
    const food = await Food.findByIdAndDelete(req.params.id);
    if (!food) {
      return sendError(res, 404, "Food item not found");
    }

    // Referential integrity: remove the deleted food from every customer's cart
    // so checkout can never meet a dangling reference. ($pull = BTWA Module 2)
    // Past orders are untouched — they keep their own foodName/price snapshot.
    await Cart.updateMany({ "items.food": food._id }, { $pull: { items: { food: food._id } } });

    return sendSuccess(res, 200, "Food item deleted successfully");
  } catch (error) {
    next(error);
  }
};

module.exports = { getFoods, getFoodById, createFood, updateFood, deleteFood };
