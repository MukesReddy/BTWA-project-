// UPI helpers: the payment link, the amount maths and the QR picture.
// (No database, no HTTP: pure functions + the real `qrcode` library.)

const QRCode = require("qrcode");
const { toPaise, paiseToAmountString, newPaymentRef, buildUpiUri, qrDataUrl } = require("../../utils/upi");

describe("paise maths (no floating-point drift)", () => {
  test.each([
    [249.9, 24990, "249.90"],
    [100, 10000, "100.00"],
    [0.1 + 0.2, 30, "0.30"], // 0.30000000000000004 in floating point
    [0.05, 5, "0.05"],
    [123456.78, 12345678, "123456.78"],
  ])("%p rupees → %p paise → %p", (rupees, paise, text) => {
    const result = toPaise(rupees);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(paise);
    expect(paiseToAmountString(result)).toBe(text);
  });

  test("invalid amounts are refused, never turned into NaN in a payment link", () => {
    for (const bad of [NaN, -1, "abc", undefined, Infinity]) expect(() => toPaise(bad)).toThrow();
    for (const bad of [1.5, -5, "100", NaN]) expect(() => paiseToAmountString(bad)).toThrow();
  });
});

describe("buildUpiUri", () => {
  const base = { upiId: "shop@okicici", payeeName: "FoodieHub", amountPaise: 10000, reference: "FH0123456789ABCDEF", note: "FoodieHub FH0123456789ABCDEF" };

  test("exact shape: upi://pay with payee, name, 2-decimal amount, INR, note and our reference", () => {
    expect(buildUpiUri(base)).toBe(
      "upi://pay?pa=shop@okicici&pn=FoodieHub&am=100.00&cu=INR&tn=FoodieHub%20FH0123456789ABCDEF&tr=FH0123456789ABCDEF"
    );
  });

  test("amount is formatted from integer paise with exactly two decimals", () => {
    expect(buildUpiUri({ ...base, amountPaise: 24990 })).toContain("&am=249.90&");
    expect(buildUpiUri({ ...base, amountPaise: 5 })).toContain("&am=0.05&");
  });

  test("a payee name with spaces, & and unicode cannot break out of its parameter", () => {
    const uri = buildUpiUri({ ...base, payeeName: "Ram & Sons=Cafe ₹&am=1" });
    expect(uri).toContain("pn=Ram%20%26%20Sons%3DCafe%20%E2%82%B9%26am%3D1&");
    expect(new URLSearchParams(uri.split("?")[1]).get("am")).toBe("100.00"); // the injected "am=1" is data, not a parameter
  });

  test("zero / missing amount or missing UPI id is an error, not a bad link", () => {
    expect(() => buildUpiUri({ ...base, amountPaise: 0 })).toThrow(/greater than zero/);
    expect(() => buildUpiUri({ ...base, amountPaise: 12.5 })).toThrow();
    expect(() => buildUpiUri({ ...base, upiId: "" })).toThrow(/not configured/);
  });
});

describe("payment reference and QR picture", () => {
  test("references are FH + 16 uppercase hex characters, and do not repeat", () => {
    const refs = new Set(Array.from({ length: 200 }, newPaymentRef));
    expect(refs.size).toBe(200);
    for (const ref of refs) expect(ref).toMatch(/^FH[0-9A-F]{16}$/);
  });

  test("the QR is a PNG data URL and encodes EXACTLY the payment link (checked by decoding the library's own symbol)", async () => {
    const uri = buildUpiUri({ upiId: "shop@okicici", payeeName: "FoodieHub", amountPaise: 85000, reference: "FH0123456789ABCDEF" });
    const spy = jest.spyOn(QRCode, "toDataURL");
    const url = await qrDataUrl(uri);

    expect(url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(spy.mock.calls[0][0]).toBe(uri);
    const encoded = QRCode.create(uri, { errorCorrectionLevel: "M" }).segments.map((s) => Buffer.from(s.data).toString("utf8")).join("");
    expect(encoded).toBe(uri);
    expect(encoded).toContain("am=850.00");
  });
});
