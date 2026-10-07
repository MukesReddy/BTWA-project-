// utils/sessions.js
// Helpers for the express-session store (connect-mongo "sessions" collection).
// BTWA Module 10: Session management

const mongoose = require("mongoose");
const logger = require("./logger");

/**
 * revokeUserSessions
 * Deletes every stored session that belongs to a user, so a deleted or
 * deactivated account is logged out everywhere immediately.
 *
 * connect-mongo (default options) stores each session as a JSON *string* in
 * the `session` field, e.g. {"cookie":{...},"userId":"<id>","userRole":"customer"}.
 * We therefore match on the stringified `"userId":"<id>"` fragment.
 * The id is validated as a 24-hex ObjectId first, so it can never inject
 * regex metacharacters.
 *
 * Never throws: a failure to revoke is logged but must not break the admin action
 * (the account is already deactivated and login is refused for it).
 *
 * @param {string|ObjectId} userId
 * @returns {Promise<number>} number of sessions removed
 */
const revokeUserSessions = async (userId) => {
  const id = String(userId);
  if (!/^[a-fA-F0-9]{24}$/.test(id)) return 0;

  try {
    const result = await mongoose.connection
      .collection("sessions")
      .deleteMany({ session: { $regex: `"userId":"${id}"` } });
    return result.deletedCount || 0;
  } catch (error) {
    logger.error(`Failed to revoke sessions for user ${id}: ${error.message}`);
    return 0;
  }
};

module.exports = { revokeUserSessions };
