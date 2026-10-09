// utils/upi.js
// Helpers for "Pay by UPI QR".
//
// What a UPI QR code is: just a text link of the form  upi://pay?pa=<payee>&am=<amount>&...
// printed as a QR picture. Any UPI app (Google Pay, PhonePe, Paytm, BHIM ...) that scans it opens a
// pre-filled payment screen. The QR proves NOTHING about whether the customer paid: the app never tells
// our server. Payment is confirmed separately (signed webhook, or an admin checking the bank statement).
//
// Parameters follow the NPCI UPI linking specification:
//   pa  payee address (UPI ID)            pn  payee name
//   am  amount, decimal, at most 2 places cu  currency (INR only)
//   tn  transaction note (shown to payer)  tr  transaction reference (our paymentRef)

const crypto = require("crypto");
const QRCode = require("qrcode");

/** Rupees (e.g. 249.9) → whole paise (24990). All money maths for payments uses integers. */
const toPaise = (rupees) => {
  const value = Number(rupees);
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid amount");
  return Math.round(value * 100);
};

/** Whole paise → "249.90" (always two decimals, never exponent notation). */
const paiseToAmountString = (paise) => {
  if (!Number.isInteger(paise) || paise < 0) throw new Error("Invalid amount");
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
};

/** Our own transaction reference: "FH" + 16 random hex characters (18 chars, within UPI's 35 limit). */
const newPaymentRef = () => `FH${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

/**
 * buildUpiUri
 * @param {{upiId:string, payeeName:string, amountPaise:number, reference:string, note?:string}} p
 * @returns {string} e.g. upi://pay?pa=shop@okbank&pn=FoodieHub&am=100.00&cu=INR&tn=...&tr=FH...
 */
const buildUpiUri = ({ upiId, payeeName, amountPaise, reference, note }) => {
  if (!upiId) throw new Error("UPI ID is not configured");
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error("Amount must be greater than zero");
  const params = [
    `pa=${upiId}`, // validated at startup (letters, digits . _ - and one @), so it is URI-safe as it is
    `pn=${encodeURIComponent(payeeName || "FoodieHub")}`,
    `am=${paiseToAmountString(amountPaise)}`,
    "cu=INR",
  ];
  if (note) params.push(`tn=${encodeURIComponent(String(note).slice(0, 80))}`);
  if (reference) params.push(`tr=${encodeURIComponent(reference)}`);
  return `upi://pay?${params.join("&")}`;
};

/** The URI as a PNG picture (data: URL) that the page can put straight into an <img>. */
const qrDataUrl = (uri) =>
  QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 280 });

module.exports = { toPaise, paiseToAmountString, newPaymentRef, buildUpiUri, qrDataUrl };
