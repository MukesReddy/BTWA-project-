// Runs before every UNIT test file only (see jest.config.js). Never loaded by the integration project.
//
// Unit tests have no database. Any query that is NOT explicitly mocked must fail immediately
// instead of hanging for 10s waiting for a connection that will never exist.
//
// IMPORTANT: bufferCommands:false must not leak into the integration project. Mongoose auto-runs
// Model.init()/createCollection() when a model is first required (i.e. BEFORE the test connects);
// with buffering off it does not wait for the connection and crashes with
// "Cannot read properties of undefined (reading 'createCollection')".
// For the same reason we also switch off the automatic collection/index creation here.
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);
mongoose.set("autoCreate", false);
mongoose.set("autoIndex", false);
