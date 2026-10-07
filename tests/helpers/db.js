// tests/helpers/db.js
// Real-MongoDB helpers for the INTEGRATION project.
//
//  • Default: mongodb-memory-server starts a throw-away mongod (the binary is downloaded
//    once and cached in ~/.cache/mongodb-binaries — needs access to fastdl.mongodb.org).
//  • Or set MONGO_TEST_URI=mongodb://localhost:27017 to use a server you already run.
//    The database name is forced to "foodiehub_integration_test" and is wiped between tests.

const mongoose = require("mongoose");

const DB_NAME = "foodiehub_integration_test";
let mongod = null;

const connectTestDb = async () => {
  let uri = process.env.MONGO_TEST_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  }
  await mongoose.connect(uri, { dbName: DB_NAME });

  // Build every unique index BEFORE any test runs. Without this, "duplicate cart"
  // tests could pass or fail depending on whether the index finished building.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
};

const clearTestDb = async () => {
  if (mongoose.connection.name !== DB_NAME) {
    throw new Error(`Refusing to wipe database "${mongoose.connection.name}"`);
  }
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
};

const disconnectTestDb = async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
};

module.exports = { connectTestDb, clearTestDb, disconnectTestDb };
