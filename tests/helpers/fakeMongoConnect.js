// tests/helpers/fakeMongoConnect.js — preloaded with `node -r` into a spawned `server.js` by
// tests/unit/shutdown.test.js ONLY. It replaces mongoose.connect with an instant "connected" so the
// real startup / shutdown code in server.js can be exercised without a database. Not used by the app.
const mongoose = require("mongoose");

const collection = { createIndex: async () => {}, findOne: async () => null, updateOne: async () => ({}), deleteOne: async () => ({}) };
const client = { db: () => ({ collection: () => collection }) };

mongoose.connect = async () => {
  mongoose.connection.getClient = () => client;
  setImmediate(() => mongoose.connection.emit("connected"));
  return { connection: { host: "fake-host" } };
};
mongoose.disconnect = async () => {}; // nothing real to close
