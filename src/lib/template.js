import * as XLSX from "xlsx";
import JSZip from "jszip";

// Reads a blank Meesho category template and works out everything needed to
// fill it: which sheet to write to, which column holds which field, the exact
// dropdown options, and — critically — which columns the template computes for
// itself and we must therefore never touch.

export const FILL_SHEET_MATCH = "fill this";
export const HEADER_ROW = 3; // row holding field names (1-indexed)
export const DATA_START_ROW = 5; // first data row (1-indexed)

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function colLetter(n) {
  let s = "";
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(letter) {
  let n = 0;
  for (const ch of String(letter).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Header cells are multi-line: "Product Name\nPlease enter…" → "Product Name".
const headerText = (cellVal) => {
  const parts = String(cellVal ?? "").split("\n").map((p) => p.trim()).filter(Boolean);
  return parts[0] || "";
};

// Meesho's Validation Sheet mixes real dropdown options with instruction text.
// Used only as a fallback when a column has no list validation pointing us at
// the exact range.
const looksLikeOption = (s) => {
  const v = String(s).trim();
  if (!v || v.length > 60) return false;
  if (/^select .* from the list$/i.test(v)) return false;
  if (/^(please |enter |click |this is|this book|depending|means |number of)/i.test(v)) return false;
  if ((v.match(/\./g) || []).length >= 2) return false;
  return true;
};

// Resolve "'Validation Sheet'!$U$3:$U$31" → { sheet, col, from, to }
function parseRangeRef(formula) {
  const m = String(formula).match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  return { sheet: m[1], col: m[2], from: +m[3], to: +m[5] };
}

// Pull every <dataValidation> out of the sheet XML, keyed by column letter.
function readValidations(xml) {
  const byCol = {};
  const re = /<dataValidation\s([^>]*?)(?:\/>|>([\s\S]*?)<\/dataValidation>)/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const sqref = (attrs.match(/sqref="([^"]*)"/) || [])[1] || "";
    const type = (attrs.match(/type="([^"]*)"/) || [])[1] || "";
    const formula1 = (inner.match(/<formula1>([\s\S]*?)<\/formula1>/) || [])[1] || "";
    for (const part of sqref.split(/\s+/)) {
      if (!part) continue;
      const [start, end] = part.split(":");
      const col = start.replace(/\d+/g, "");
      const lastRow = parseInt((end || start).replace(/\D+/g, ""), 10) || 0;
      const prev = byCol[col];
      byCol[col] = {
        type: type || prev?.type || "",
        list: type === "list" ? formula1 : prev?.list || "",
        lastRow: Math.max(prev?.lastRow || 0, lastRow),
        listLastRow: type === "list" ? Math.max(prev?.listLastRow || 0, lastRow) : prev?.listLastRow || 0,
      };
    }
  }
  return byCol;
}

// Columns the template fills with its own formulas (defective price, importer
// fields, …). Writing a value there silently destroys the formula, so we scan
// every data row and treat any column holding a formula as off-limits.
function readFormulaColumns(xml) {
  const cols = new Set();
  const formulas = {}; // column letter → formula text from the first data row
  for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*>([\s\S]*?)<\/c>/g)) {
    if (+m[2] < DATA_START_ROW) continue;
    if (!m[3].includes("<f")) continue;
    cols.add(m[1]);
    if (formulas[m[1]] === undefined) {
      const f = (m[3].match(/<f[^>]*>([\s\S]*?)<\/f>/) || [])[1];
      if (f) formulas[m[1]] = f.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    }
  }
  return { cols, formulas };
}

function existingRows(xml) {
  const rows = new Set();
  for (const m of xml.matchAll(/<row r="(\d+)"/g)) rows.add(+m[1]);
  return rows;
}

// Locate the worksheet XML path for a sheet name, via workbook.xml + its rels.
export async function resolveSheetPath(zip, sheetName) {
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const sheetTag = [...wbXml.matchAll(/<sheet[^>]*\/?>/g)]
    .map((m) => m[0])
    .find((t) => ((t.match(/name="([^"]*)"/) || [])[1] || "") === sheetName);
  if (!sheetTag) throw new Error("Couldn't locate the fill sheet inside the workbook.");
  const rid = (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
  const relTag = [...relsXml.matchAll(/<Relationship[^>]*\/>/g)]
    .map((m) => m[0])
    .find((t) => (t.match(/Id="([^"]+)"/) || [])[1] === rid);
  const target = (relTag.match(/Target="([^"]+)"/) || [])[1];
  return "xl/" + target.replace(/^\//, "");
}

/**
 * @param {Uint8Array} bytes raw .xlsx
 * @param {Array} fields FIELDS table (see fields.js) — drives column matching
 */
export async function loadTemplate(bytes, fields) {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes(FILL_SHEET_MATCH));
  if (!sheetName) throw new Error('No "Fill this" sheet found in this file.');
  const ws = wb.Sheets[sheetName];

  // header name → column index
  const ref = XLSX.utils.decode_range(ws["!ref"]);
  const headerByCol = {};
  for (let c = ref.s.c; c <= ref.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: HEADER_ROW - 1, c })];
    const name = cell ? headerText(cell.v) : "";
    if (name) headerByCol[c] = name;
  }

  const colMap = {};
  for (const f of fields) {
    const targets = [f.header, ...(f.aliases || [])].map(norm);
    let found = -1;
    exact: for (const t of targets) {
      for (const [c, name] of Object.entries(headerByCol)) {
        if (norm(name) === t) {
          found = +c;
          break exact;
        }
      }
    }
    if (found === -1 && !f.exactOnly) {
      loose: for (const t of targets) {
        for (const [c, name] of Object.entries(headerByCol)) {
          const nn = norm(name);
          if (nn && (nn.includes(t) || t.includes(nn))) {
            found = +c;
            break loose;
          }
        }
      }
    }
    if (found !== -1 && !Object.values(colMap).includes(found)) colMap[f.key] = found;
  }
  if (colMap.productName === undefined)
    throw new Error("Couldn't locate the Product Name column in this template.");

  const zip = await JSZip.loadAsync(bytes);
  const sheetPath = await resolveSheetPath(zip, sheetName);
  const xml = await zip.file(sheetPath).async("string");

  const validations = readValidations(xml);
  const { cols: formulaCols, formulas } = readFormulaColumns(xml);
  const rows = existingRows(xml);

  // Exact dropdown options, read from the range each list validation points at.
  const options = {};
  for (const f of fields) {
    const ci = colMap[f.key];
    if (ci === undefined) continue;
    const v = validations[colLetter(ci)];
    let vals = null;
    if (v?.list) {
      const r = parseRangeRef(v.list);
      const vsheet = r && wb.Sheets[r.sheet];
      if (vsheet) {
        vals = [];
        for (let row = r.from; row <= r.to; row++) {
          const cell = vsheet[`${r.col}${row}`];
          const s = cell == null ? "" : String(cell.v ?? "").trim();
          if (s && !vals.includes(s)) vals.push(s);
        }
      }
    }
    if (!vals && f.dropdown) {
      const vsheet = wb.Sheets["Validation Sheet"];
      if (vsheet) {
        const grid = XLSX.utils.sheet_to_json(vsheet, { header: 1, blankrows: false });
        vals = [];
        for (let r = 1; r < grid.length; r++) {
          const s = String(grid[r]?.[ci] ?? "").trim();
          if (s && looksLikeOption(s) && !vals.includes(s)) vals.push(s);
        }
      }
    }
    if (vals && vals.length) options[f.key] = vals;
  }

  // How many products this template can actually hold. Dropdown validations
  // often stop short of the last physical row — past that point Meesho sees
  // values outside the allowed list.
  let lastPhysicalRow = DATA_START_ROW - 1;
  for (const r of rows) if (r > lastPhysicalRow) lastPhysicalRow = r;
  let lastDropdownRow = Infinity;
  for (const f of fields) {
    const ci = colMap[f.key];
    if (ci === undefined) continue;
    const v = validations[colLetter(ci)];
    if (v?.listLastRow) lastDropdownRow = Math.min(lastDropdownRow, v.listLastRow);
  }
  const lastUsableRow = Math.min(lastPhysicalRow, lastDropdownRow === Infinity ? lastPhysicalRow : lastDropdownRow);

  const skipped = [...formulaCols]
    .map((letter) => {
      const ci = colIndex(letter);
      const key = Object.keys(colMap).find((k) => colMap[k] === ci);
      return { letter, key, header: headerByCol[ci] || "" };
    })
    .filter((s) => s.header);

  return {
    bytes,
    sheetName,
    sheetPath,
    headerByCol,
    colMap,
    options,
    formulaCols,
    formulas,
    validations,
    lastPhysicalRow,
    lastUsableRow,
    capacity: Math.max(0, lastUsableRow - DATA_START_ROW + 1),
    skipped,
    unmatched: fields.filter((f) => colMap[f.key] === undefined).map((f) => f.header),
  };
}
