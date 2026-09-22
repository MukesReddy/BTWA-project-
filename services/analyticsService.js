// services/analyticsService.js
// MongoDB Aggregation Pipeline service for dashboard statistics
// BTWA Module 3: Aggregation framework — $group, $unwind, $sort, $lookup
// BTWA Module 16 of prompt: Real aggregation pipelines

const Order = require("../models/Order");
const User = require("../models/User");
const Food = require("../models/Food");

/**
 * getDashboardStats
 * Returns real MongoDB aggregation results for the admin dashboard
 *
 * Aggregations used:
 * - Total orders count
 * - Total revenue ($sum)
 * - Pending orders count
 * - Orders grouped by status ($group)
 * - Total users count
 * - Popular foods ($unwind, $group, $sort)
 *
 * BTWA Module 3: $group, $sum, $unwind, $sort, $limit, $lookup, $project, $match
 */
const getDashboardStats = async () => {
  // 1. Total orders and total revenue using aggregation pipeline
  // BTWA Module 3: $group with $sum
  const orderStats = await Order.aggregate([
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: "$totalAmount" },
        avgOrderValue: { $avg: "$totalAmount" },
      },
    },
  ]);

  // 2. Orders grouped by status
  // BTWA Module 3: $group by field value
  const ordersByStatus = await Order.aggregate([
    {
      $group: {
        _id: "$orderStatus",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // 3. Pending orders count
  const pendingOrders = await Order.countDocuments({ orderStatus: "Pending" });

  // 4. Total users count
  const totalUsers = await User.countDocuments({});

  // 5. Popular foods — based on order frequency
  // BTWA Module 3: $unwind, $group, $sort, $limit
  const popularFoods = await Order.aggregate([
    { $unwind: "$items" },                    // Deconstruct items array
    {
      $group: {
        _id: "$items.food",
        foodName: { $first: "$items.foodName" },
        totalOrdered: { $sum: "$items.quantity" },
        totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
      },
    },
    { $sort: { totalOrdered: -1 } },          // Sort by most ordered
    { $limit: 5 },                            // Top 5
  ]);

  // 6. Recent orders (last 5) — with user info (using Mongoose populate)
  const recentOrders = await Order.find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .populate("user", "name email");

  // 7. Top spenders — aggregation pipeline with $lookup, $unwind, and $project
  // BTWA Module 3: $lookup (left-join orders → users collection)
  //                $unwind  (flatten the joined userInfo array)
  //                $project (shape/limit output fields)
  const topSpenders = await Order.aggregate([
    // Group all orders by user, summing their spend and order count
    {
      $group: {
        _id: "$user",
        totalSpent: { $sum: "$totalAmount" },
        orderCount: { $sum: 1 },
      },
    },
    // $lookup — join with the users collection to get user details
    {
      $lookup: {
        from: "users",          // MongoDB collection name (lowercase, plural)
        localField: "_id",      // field in Orders group result (_id = user ObjectId)
        foreignField: "_id",    // matching field in users collection
        as: "userInfo",         // output array field name
      },
    },
    // $unwind — deconstruct the userInfo array (each group has exactly one user)
    { $unwind: "$userInfo" },
    // $project — shape the output: include only needed fields, exclude _id
    {
      $project: {
        _id: 0,
        name: "$userInfo.name",
        email: "$userInfo.email",
        totalSpent: 1,
        orderCount: 1,
      },
    },
    { $sort: { totalSpent: -1 } },  // Highest spenders first
    { $limit: 5 },                  // Top 5 only
  ]);

  // 8. Revenue by date (last 7 days) — BTWA Module 3: $dateToString grouping
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const revenueByDate = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: sevenDaysAgo },
        orderStatus: { $ne: "Cancelled" },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
        },
        revenue: { $sum: "$totalAmount" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    summary: {
      totalOrders: orderStats[0]?.totalOrders || 0,
      totalRevenue: orderStats[0]?.totalRevenue || 0,
      avgOrderValue: Math.round(orderStats[0]?.avgOrderValue || 0),
      pendingOrders,
      totalUsers,
    },
    ordersByStatus,
    popularFoods,
    topSpenders,
    recentOrders,
    revenueByDate,
  };
};

module.exports = { getDashboardStats };
