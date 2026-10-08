// utils/constants.js
// Shared business-rule constants (single source of truth for the backend).
// BTWA Module 5: Custom module, module.exports

module.exports = {
  // Maximum quantity of ONE food item allowed in a cart. Enforced by the
  // express-validator rules, the atomic cart update filter and the Cart schema.
  MAX_CART_QUANTITY: 20,

  // Allowed values of Order.orderStatus (same list as the schema enum in models/Order.js).
  ORDER_STATUSES: ["Pending", "Confirmed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"],

  // Order lifecycle (single source of truth; public/js/main.js mirrors it and a test keeps them equal).
  //   Pending → Confirmed → Preparing → Out for Delivery → Delivered      (one step at a time)
  //   Cancelled is reachable only from Pending, Confirmed or Preparing.
  //   Delivered and Cancelled are final. Anything not listed is rejected with 409.
  ORDER_TRANSITIONS: Object.freeze({
    "Pending": Object.freeze(["Confirmed", "Cancelled"]),
    "Confirmed": Object.freeze(["Preparing", "Cancelled"]),
    "Preparing": Object.freeze(["Out for Delivery", "Cancelled"]),
    "Out for Delivery": Object.freeze(["Delivered"]),
    "Delivered": Object.freeze([]),
    "Cancelled": Object.freeze([]),
  }),

  // A customer may cancel their own order only while it is in one of these statuses.
  CUSTOMER_CANCEL_FROM: Object.freeze(["Pending"]),

  // Longest search text accepted by the menu / admin user search.
  MAX_SEARCH_LENGTH: 100,
};
