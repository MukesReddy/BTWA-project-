// controllers/categoryController.js
// Category CRUD controller
// BTWA Module 2: MongoDB CRUD operations
// BTWA Module 3: Mongoose queries, validation

const Category = require("../models/Category");
const Food = require("../models/Food");
const { sendSuccess, sendError, escapeRegex } = require("../utils/helpers");

/**
 * @route   GET /api/categories
 * @desc    Get all categories
 * @access  Public
 * BTWA Module 2: find() — cursor operations
 */
const getCategories = async (req, res, next) => {
  try {
    // BTWA Module 2: find(), sort() — cursor operations
    const categories = await Category.find({}).sort({ name: 1 });
    return sendSuccess(res, 200, "Categories retrieved", categories);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/categories/:id
 * @desc    Get single category by ID
 * @access  Public
 * BTWA Module 2: findById
 */
const getCategoryById = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return sendError(res, 404, "Category not found");
    }
    return sendSuccess(res, 200, "Category retrieved", category);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/categories
 * @desc    Create a new category
 * @access  Admin
 * BTWA Module 2: Create (insertOne equivalent)
 */
const createCategory = async (req, res, next) => {
  try {
    const { name, description, image } = req.body;

    // Check for duplicate category name
    const existing = await Category.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") } });
    if (existing) {
      return sendError(res, 409, "Category with this name already exists");
    }

    const category = await Category.create({ name, description, image });
    return sendSuccess(res, 201, "Category created successfully", category);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/categories/:id
 * @desc    Update a category
 * @access  Admin
 * BTWA Module 2: Update operation (findByIdAndUpdate)
 */
const updateCategory = async (req, res, next) => {
  try {
    const { name, description, image } = req.body;

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, description, image },
      { new: true, runValidators: true } // Return updated doc, run schema validators
    );

    if (!category) {
      return sendError(res, 404, "Category not found");
    }

    return sendSuccess(res, 200, "Category updated successfully", category);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   DELETE /api/categories/:id
 * @desc    Delete a category
 * @access  Admin
 * BTWA Module 2: Delete operation
 * BTWA Project Rule: Database integrity — check if foods depend on this category
 */
const deleteCategory = async (req, res, next) => {
  try {
    // Check if any foods reference this category (Database Integrity)
    const foodCount = await Food.countDocuments({ category: req.params.id });
    if (foodCount > 0) {
      return sendError(
        res,
        400,
        `Cannot delete category: ${foodCount} food item(s) are using this category. Remove or reassign those foods first.`
      );
    }

    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return sendError(res, 404, "Category not found");
    }

    return sendSuccess(res, 200, "Category deleted successfully");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
};
