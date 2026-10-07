// config/db.js
// MongoDB connection configuration using Mongoose
// BTWA Module 1: MongoDB connection, Module 3: Mongoose

const mongoose = require("mongoose");

/**
 * Connect to MongoDB database
 * Uses async/await for non-blocking connection (BTWA Module 4: Async ops)
 */
const connectDB = async (uri = process.env.MONGO_URI) => {
  try {
    const conn = await mongoose.connect(uri);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1); // Exit with failure
  }
};

module.exports = connectDB; // BTWA Module 5: module.exports
