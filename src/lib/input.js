import * as XLSX from "xlsx";
import { colLetter, colIndex, norm } from "./template.js";

// Parses the seller's product sheet (the cataloger export). Named columns are
// matched by header; unnamed helper columns are still exposed by letter so the
// price/MRP source can be pointed at a computed column like P or Q.

const HEADER_ALIASES = {
  title: ["title", "product name", "name"],
  sku: ["sku id", "sku", "skuid"],
  sellingPrice: ["selling price", "price", "meesho price"],
  mrp: ["mrp", "m.r.p"],
  link: ["amazon link", "amazon", "link", "url"],
  category: ["category", "cat"],
  image: ["images", "image", "image 1", "img"],
  brand: ["brand"],
  setSize: ["setsize", "set size"],
};

function findHeaderIndex(headers, aliases) {
  const n = headers.map((h) => norm(h));
  for (const a of aliases) {
    const i = n.indexOf(norm(a));
    if (i !== -1) return i;
  }
  for (let i = 0; i < n.length; i++) if (n[i] && aliases.some((a) => n[i] === norm(a))) return i;
  return -1;
}

const num = (v) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
};

// "CBSE Class 10th 15 Sample Question Papers…" → "10"
export function gradeFromText(text) {
  const m = String(text).match(/class\s*(\d{1,2})\s*(?:th|st|nd|rd)?\b/i);
  return m ? String(parseInt(m[1], 10)) : "";
}

// "… Set of 4" → 4. Defaults to 1.
export function setSizeFromText(text) {
  const m = String(text).match(/set\s*of\s*(\d{1,2})/i);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * @param {Uint8Array} bytes raw .xlsx of the seller sheet
 */
export function parseInput(bytes) {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Sheet is empty.");
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  if (!grid.length) throw new Error("Sheet is empty.");

  const header = grid[0].map((h) => String(h ?? "").trim());
  const idx = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) idx[key] = findHeaderIndex(header, aliases);
  if (idx.title === -1) throw new Error("Couldn't find a 'Title' column in the input sheet.");

  const width = grid.reduce((w, r) => Math.max(w, r.length), header.length);

  const rows = [];
  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r] || [];
    const title = String(raw[idx.title] ?? "").trim();
    if (!title) continue; // trailing rows that only carry leftover formulas

    const cells = {};
    for (let c = 0; c < width; c++) {
      const v = raw[c];
      if (v !== undefined && v !== "") cells[colLetter(c)] = v;
    }

    const sku = String(raw[idx.sku] ?? "").trim();
    const sheetSetSize = num(idx.setSize > -1 ? raw[idx.setSize] : null);

    rows.push({
      title,
      sku,
      sellingPrice: num(idx.sellingPrice > -1 ? raw[idx.sellingPrice] : null),
      mrp: num(idx.mrp > -1 ? raw[idx.mrp] : null),
      link: String(idx.link > -1 ? raw[idx.link] ?? "" : "").trim(),
      category: String(idx.category > -1 ? raw[idx.category] ?? "" : "").trim(),
      image: String(idx.image > -1 ? raw[idx.image] ?? "" : "").trim(),
      brand: String(idx.brand > -1 ? raw[idx.brand] ?? "" : "").trim(),
      cells,
      // derived — the sheet leaves these blank, but the title/SKU carry them
      grade: gradeFromText(title),
      setSize: sheetSetSize && sheetSetSize > 0 ? sheetSetSize : setSizeFromText(sku || title),
    });
  }
  if (!rows.length) throw new Error("No product rows found (every Title was empty).");

  // Every column, for the price-source pickers. Unnamed columns still get a
  // label so "P" and "Q" are choosable.
  const columns = [];
  for (let c = 0; c < width; c++) {
    const letter = colLetter(c);
    const name = header[c] || "";
    const sample = rows.find((r) => r.cells[letter] !== undefined)?.cells[letter];
    columns.push({
      letter,
      name,
      label: name ? `${letter} · ${name}` : `${letter}`,
      sample: sample === undefined ? "" : String(sample),
      numeric: rows.some((r) => num(r.cells[letter]) !== null),
    });
  }

  return { rows, columns, header };
}

// Read a value from a parsed row by column letter, falling back to a named
// field when no letter is configured.
export function valueFromColumn(row, letter, fallback) {
  if (letter) {
    const v = row.cells[letter];
    const n = num(v);
    if (n !== null) return n;
  }
  return fallback ?? null;
}

export { num as toNumber, colIndex };
