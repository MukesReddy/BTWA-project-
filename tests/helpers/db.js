// tests/helpers/db.js
// Real-MongoDB helpers for the INTEGRATION project.
//
//  - If MONGO_TEST_URI is set (e.g. mongodb://127.0.0.1:27017) that server is used and
//    mongodb-memory-server is never loaded or downloaded.
//  - Otherwise mongodb-memory-server starts a throw-away mongod (binary downloaded once,
//    cached in ~/.cache/mongodb-binaries; needs access to fastdl.mongodb.org).
//  The database name is always forced to "foodiehub_integration_test" and is wiped between
//  tests, so your real data is never touched.
//
// Diagnostics: every step is checked and fails with a clear message; set DEBUG_TEST_DB=1 to
// print which server / database the tests are using.

const mongoose = require("mongoose");

const DB_NAME = "foodiehub_integration_test";
let mongod = null;

const redact = (uri) => uri.replace(/\/\/[^@/]*@/, "//***:***@");
const log = (message) => {
  if (process.env.DEBUG_TEST_DB) console.log(`[test-db] ${message}`);
};

const connectTestDb = async () => {
  // Guard against the exact mistake that once broke this suite: a leftover bufferCommands=false
  // (unit-test setting) makes Model.init() run before the connection exists and crash.
  if (mongoose.get("bufferCommands") === false) {
    throw new Error(
      "mongoose bufferCommands is false in the integration project. " +
        "It must only be set by tests/helpers/setupUnit.js (unit project)."
    );
  }

  let uri = process.env.MONGO_TEST_URI;
  if (uri) {
    log(`using MONGO_TEST_URI=${redact(uri)}`);
  } else {
    log("MONGO_TEST_URI not set -> starting mongodb-memory-server (will download mongod on first run)");
    const { MongoMemoryServer } = require("mongodb-memory-server");
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  }

  try {
    await mongoose.connect(uri, { dbName: DB_NAME, serverSelectionTimeoutMS: 10000 });
  } catch (error) {
    throw new Error(`Could not connect to MongoDB at ${redact(uri)}: ${error.message}`);
  }
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error(`Mongoose is not connected after connect() (readyState=${mongoose.connection.readyState})`);
  }
  log(`connected: db="${mongoose.connection.name}" models=[${Object.keys(mongoose.models).join(", ")}]`);

  // Build every collection + unique index BEFORE any test runs. Without this, "duplicate cart"
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
