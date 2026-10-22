import JSZip from "jszip";
import { DATA_START_ROW, colLetter, colIndex } from "./template.js";
import { FIELDS, buildRow, withTemplate } from "./fields.js";

// Writes product values into the template WITHOUT rewriting the workbook.
//
// Spreadsheet libraries drop data validations on write, and Meesho then rejects
// the upload with "Error reading file (5015)". So we patch cell values straight
// into the sheet XML with JSZip and leave every validation, style and structure
// byte of the original file untouched.

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {object} tpl   result of loadTemplate()
 * @param {Array}  rows  parsed input rows
 * @param {object} settings
 * @param {object} overrides  rowIndex → { fieldKey: value }
 * @returns {{bytes: Uint8Array, stats: object}}
 */
export async function fillTemplate(tpl, rows, settings, overrides = {}) {
  const effective = withTemplate(settings, tpl);
  const zip = await JSZip.loadAsync(tpl.bytes);
  let xml = await zip.file(tpl.sheetPath).async("string");

  // Meesho templates store text in the shared-string table (t="s"), and Google
  // Sheets only renders that form — it shows inline strings as blank. So append
  // our text there and reference it by index, matching the template's encoding.
  const ssFile = zip.file("xl/sharedStrings.xml");
  let ssXml = ssFile
    ? await ssFile.async("string")
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>';
  const siCount = (ssXml.match(/<si>/g) || []).length;
  const internCache = new Map();
  const appended = [];
  const intern = (str) => {
    if (internCache.has(str)) return internCache.get(str);
    const idx = siCount + appended.length;
    internCache.set(str, idx);
    appended.push(str);
    return idx;
  };

  // Keep the cell's style attribute — rebuilding the cell from scratch would
  // strip the template's number/date formatting.
  const makeCell = (ref, value, prevCellXml) => {
    const style = prevCellXml ? (prevCellXml.match(/\ss="\d+"/) || [""])[0] : "";
    if (typeof value === "number" && !isNaN(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
    return `<c r="${ref}"${style} t="s"><v>${intern(String(value))}</v></c>`;
  };

  // The template computes some columns itself (defective price, importer
  // fields). Overwriting them destroys the formula; leaving them alone means
  // Meesho reads a blank, because a formula written by a tool carries no
  // cached result. So keep the formula AND cache our value next to it —
  // Excel recalculates on open, Meesho reads the cached value.
  const makeFormulaCell = (ref, value, prevCellXml) => {
    const style = (prevCellXml.match(/\ss="\d+"/) || [""])[0];
    const formula = (prevCellXml.match(/<f[\s>][\s\S]*?<\/f>|<f[^>]*\/>/) || [""])[0];
    if (!formula) return null;
    if (typeof value === "number" && !isNaN(value))
      return `<c r="${ref}"${style}>${formula}<v>${value}</v></c>`;
    return `<c r="${ref}"${style} t="str">${formula}<v>${escapeXml(String(value))}</v></c>`;
  };

  const capacity = tpl.capacity;
  const used = Math.min(rows.length, capacity);
  const overflow = rows.length - used;
  const skippedCols = new Set();
  const missingRows = [];
  let cellsWritten = 0;
  let formulaCellsKept = 0;

  for (let i = 0; i < used; i++) {
    const rownum = DATA_START_ROW + i;
    const values = { ...buildRow(rows[i], effective, i, tpl.options), ...(overrides[i] || {}) };

    const rowRe = new RegExp(`<row r="${rownum}"[^>]*>([\\s\\S]*?)</row>|<row r="${rownum}"[^>]*/>`);
    const m = xml.match(rowRe);
    if (!m) {
      missingRows.push(rownum);
      continue;
    }
    const rowXml = m[0];
    const selfClosing = rowXml.endsWith("/>");
    let inner = selfClosing ? "" : m[1];

    for (const f of FIELDS) {
      const ci = tpl.colMap[f.key];
      if (ci === undefined) continue;
      const letter = colLetter(ci);

      let v = values[f.key];
      if (v === "" || v == null) continue;
      if (f.numeric) {
        const n = parseFloat(v);
        v = isNaN(n) ? String(v) : n;
      } else {
        v = String(v);
      }

      const ref = letter + rownum;
      const cellRe = new RegExp(`<c r="${ref}"(?:[^>]*?/>|[^>]*?>[\\s\\S]*?</c>)`);
      const prev = inner.match(cellRe);
      const prevXml = prev ? prev[0] : "";

      let cell;
      if (prevXml.includes("<f")) {
        cell = makeFormulaCell(ref, v, prevXml);
        if (cell) {
          skippedCols.add(letter); // reported as "formula kept"
          formulaCellsKept++;
        } else {
          cell = makeCell(ref, v, prevXml);
        }
      } else {
        cell = makeCell(ref, v, prevXml);
      }

      inner = prev ? inner.replace(cellRe, () => cell) : inner + cell;
      cellsWritten++;
    }

    const openTag = selfClosing
      ? rowXml.slice(0, -2).replace(/\s*$/, "") + ">"
      : rowXml.slice(0, rowXml.indexOf(">") + 1);
    const newRow = openTag + inner + "</row>";
    xml = xml.replace(rowXml, () => newRow);
  }

  if (appended.length) {
    const newSi = appended.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join("");
    ssXml = ssXml.replace("</sst>", newSi + "</sst>");
    const oldCount = parseInt((ssXml.match(/\bcount="(\d+)"/) || [0, "0"])[1], 10);
    const oldUnique = parseInt((ssXml.match(/uniqueCount="(\d+)"/) || [0, "0"])[1], 10);
    ssXml = ssXml.replace(/\bcount="\d+"/, `count="${oldCount + appended.length}"`);
    if (/uniqueCount="\d+"/.test(ssXml))
      ssXml = ssXml.replace(/uniqueCount="\d+"/, `uniqueCount="${oldUnique + appended.length}"`);
    zip.file("xl/sharedStrings.xml", ssXml, { createFolders: false });
  }

  // createFolders would add bare "xl/" entries the original archive doesn't have.
  zip.file(tpl.sheetPath, xml, { createFolders: false });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  return {
    bytes,
    stats: {
      written: used,
      overflow,
      capacity,
      cellsWritten,
      formulaCellsKept,
      missingRows,
      formulaCols: [...skippedCols].map((letter) => ({
        letter,
        header: tpl.headerByCol[colIndex(letter)] || "",
      })),
    },
  };
}
