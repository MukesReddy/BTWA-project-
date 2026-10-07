// utils/constants.js
// Shared business-rule constants (single source of truth for the backend).
// BTWA Module 5: Custom module, module.exports

module.exports = {
  // Maximum quantity of ONE food item allowed in a cart. Enforced by the
  // express-validator rules, the atomic cart update filter and the Cart schema.
  MAX_CART_QUANTITY: 20,
};
