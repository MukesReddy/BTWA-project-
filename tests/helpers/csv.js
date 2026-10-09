// tests/helpers/csv.js — a small, INDEPENDENT RFC 4180 reader for the CSV tests.
// The export is checked by parsing it the way a spreadsheet would (quotes, doubled quotes, embedded
// commas and line breaks), not by comparing against the same code that wrote it.

/** "a,\"b,c\",d\n" → [["a","b,c","d"]]  (CRLF or LF row ends; a trailing newline adds no empty row) */
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // "" → one literal quote
        else inQuotes = false;                            // closing quote
      } else field += ch;                                 // commas / line breaks inside quotes are data
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (inQuotes) throw new Error("unterminated quoted field");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
};

module.exports = { parseCsv };
