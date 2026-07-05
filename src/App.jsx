import React, { useState, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import JSZip from "jszip";

// ─────────────────────────────────────────────────────────────────────────────
// Meesho Bulk Upload Converter
//
// Reads a flat seller sheet (Title · SKU · Selling Price · MRP · Amazon Link ·
// Category · Images) and writes it into the official Meesho "Fill this" template.
//
// CRITICAL: the template's dropdown rules (data validations) must survive, or
// Meesho rejects the upload with "Error reading file (5015)". Spreadsheet
// libraries strip those rules on write, so we DON'T rewrite the workbook —
// we patch only the cell values directly in the sheet XML with JSZip, leaving
// every validation, style and structure byte of the original file untouched.
//
// Columns are matched by the template's own header row, so the tool adapts to
// any category template regardless of column order. Runs fully in-browser.
// ─────────────────────────────────────────────────────────────────────────────

const FILL_SHEET_MATCH = "fill this";
const HEADER_ROW = 3;       // row holding field names (1-indexed)
const DATA_START_ROW = 5;   // first data row (1-indexed)
const TITLE_MAX = 200;      // Meesho caps Product Name at 200 characters

// Canonical fields → how each is filled, plus the header text to match in the
// template. kind: input | default | rule | auto. Matching is fuzzy (lowercased,
// punctuation-insensitive) so small template wording differences still line up.
const FIELDS = [
  { key: "productName", header: "Product Name",                 kind: "input"   },
  { key: "variation",   header: "Variation",                    kind: "default" },
  { key: "price",       header: "Meesho Price",                 kind: "input"   },
  { key: "defective",   header: "Wrong/Defective Returns Price",kind: "rule"    },
  { key: "mrp",         header: "MRP",                          kind: "input"   },
  { key: "gst",         header: "GST %",                        kind: "default" },
  { key: "hsn",         header: "HSN ID",                       kind: "default" },
  { key: "netWeight",   header: "Net Weight (gms)",             kind: "rule"    },
  { key: "inventory",   header: "Inventory",                    kind: "default" },
  { key: "country",     header: "Country of Origin",            kind: "default" },
  { key: "mfgName",     header: "Manufacturer Name",            kind: "default" },
  { key: "mfgAddr",     header: "Manufacturer Address",         kind: "default" },
  { key: "mfgPin",      header: "Manufacturer Pincode",         kind: "default" },
  { key: "packName",    header: "Packer Name",                  kind: "default" },
  { key: "packAddr",    header: "Packer Address",               kind: "default" },
  { key: "packPin",     header: "Packer Pincode",               kind: "default" },
  { key: "impName",     header: "Importer Name",                kind: "default" },
  { key: "impAddr",     header: "Importer Address",             kind: "default" },
  { key: "impPin",      header: "Importer Pincode",             kind: "default" },
  { key: "boardField",  header: "Board",                        kind: "default", dropdown: true },
  { key: "bookFormat",  header: "Book Format",                  kind: "default", dropdown: true },
  { key: "bookTitle",   header: "Book Title",                   kind: "input"   },
  { key: "bookType",    header: "Book Type",                    kind: "default", dropdown: true },
  { key: "genericName", header: "Generic Name",                 kind: "default", dropdown: true },
  { key: "genreField",  header: "Genre",                        kind: "default", dropdown: true },
  { key: "gradeField",  header: "Grade",                        kind: "default", dropdown: true },
  { key: "langField",   header: "Language",                     kind: "default", dropdown: true },
  { key: "netQty",      header: "Net Quantity",                 kind: "default", dropdown: true },
  { key: "pagesField",  header: "Pages",                        kind: "rule",    dropdown: true },
  { key: "publishYear", header: "Publish Year",                 kind: "default" },
  { key: "subGenre",    header: "Sub Genre",                    kind: "default", dropdown: true },
  { key: "image1",      header: "Image 1 (Front)",              kind: "input"   },
  { key: "styleId",     header: "Product ID / Style ID",        kind: "input"   },
  { key: "groupId",     header: "Group ID",                     kind: "auto"    },
];

const DEFAULT_SETTINGS = {
  variation: "Free Size", gst: "0", hsn: "490110", inventory: "100", country: "India",
  mfgName: "CHIRAG BOOK CENTER", mfgAddr: "CHIRAG BOOK CENTER", mfgPin: "282007",
  packName: "CHIRAG BOOK CENTER", packAddr: "CHIRAG BOOK CENTER", packPin: "282007",
  impName: "Not Required", impAddr: "Not Required", impPin: "Not Required",
  boardField: "Olympiads & Scholarship Exams", bookFormat: "Paperback",
  bookType: "Pre-owned", genericName: "Olympiads & Scholarship Exams Textbooks",
  genreField: "Exam Preparation", gradeField: "1", langField: "English", netQty: "1",
  pagesField: "51-100 Pages", publishYear: "2025", subGenre: "Textbook Bundles Textbooks",
  defectiveOffset: "1",
  weightDefault: "500",   // fallback grams when a category has no slab set
  weightSlabs: {},   // category → grams
};

// Built-in fallback options (Olympiads) used only until a template is loaded.
const FALLBACK_OPTS = {
  pagesField: ["0-10 Pages","11-50 Pages","51-100 Pages","101-200 Pages","201-300 Pages","301-400 Pages","401-500 Pages","501-600 Pages","601-700 Pages","701-800 Pages","801-900 Pages","901-1000 Pages","More than 1000 Pages"],
  boardField: ["Olympiads & Scholarship Exams"],
  bookFormat: ["Paperback","Hardcover","Board Book","Bundle"],
  genreField: ["Exam Preparation"],
  gradeField: ["1","2","3","4","5","6","7","8","9","10","11","12"],
  langField: ["English","Hindi"],
  subGenre: ["Textbook Bundles Textbooks","Workbook Bundles Textbooks"],
  bookType: ["Pre-owned"],
  genericName: ["Book","Coloring Book","Drawing Book","Others"],
  netQty: ["1","2","3","4","5","6","8","10","12"],
};

const HEADER_ALIASES = {
  title: ["title","product name","name"],
  sku: ["sku id","sku"],
  sellingPrice: ["selling price","price","meesho price"],
  mrp: ["mrp","m.r.p"],
  amazonLink: ["amazon link","amazon","link","url"],
  category: ["category","cat"],
  images: ["images","image","image 1","img"],
};

// ── helpers ──────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
// Trim a title to at most `max` chars, cutting at a word boundary so it never
// ends mid-word. Meesho rejects Product Names longer than 200 characters.
const clampTitle = (s, max = TITLE_MAX) => {
  const str = String(s ?? "").trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
};
const fieldName = (cellVal) => {
  // header cells are multi-line: "\n\nProduct Name\n\nPlease enter…" → "Product Name"
  const parts = String(cellVal ?? "").split("\n").map((p) => p.trim()).filter(Boolean);
  return parts[0] || "";
};
function colLetter(n) { let s = ""; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function escapeXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
// A Validation Sheet cell is a REAL dropdown option only if it's short and not
// an instruction sentence or a "Select … from the list" placeholder. Meesho's
// validation columns mix the actual options with helper text, so we filter hard.
const isRealOption = (s) => {
  const v = String(s).trim();
  if (!v) return false;
  if (v.length > 60) return false;                 // instructions are long
  if (/^select .* from the list$/i.test(v)) return false;
  if (/^(please |enter |click |this is|this book|depending|means |number of)/i.test(v)) return false;
  if (/^product (gst|name)/i.test(v)) return false;
  if ((v.match(/\./g) || []).length >= 2) return false;  // multi-sentence
  return true;
};

function findHeaderIndex(headers, aliases) {
  const n = headers.map((h) => norm(h));
  for (const a of aliases) { const i = n.indexOf(norm(a)); if (i !== -1) return i; }
  for (let i = 0; i < n.length; i++) if (aliases.some((a) => n[i].includes(norm(a)))) return i;
  return -1;
}

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [sourceRows, setSourceRows] = useState([]);
  const [sourceName, setSourceName] = useState("");
  const [templateBuf, setTemplateBuf] = useState(null);  // raw ArrayBuffer of the template
  const [templateName, setTemplateName] = useState("");
  const [fillSheet, setFillSheet] = useState("");
  const [colMap, setColMap] = useState(null);            // fieldKey → 0-based column index, from template header
  const [tplOptions, setTplOptions] = useState(null);    // fieldKey → [options] from Validation Sheet
  const [overrides, setOverrides] = useState({});
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(true);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const srcRef = useRef(null);
  const tplRef = useRef(null);

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const opt = (key) => (tplOptions && tplOptions[key]) || FALLBACK_OPTS[key] || [];
  const fromTemplate = !!tplOptions;

  const categories = useMemo(() => {
    const c = new Set();
    sourceRows.forEach((r) => r.category && c.add(r.category));
    Object.keys(settings.weightSlabs).forEach((k) => c.add(k));
    return [...c];
  }, [sourceRows, settings.weightSlabs]);

  // ── parse seller input sheet ───────────────────────────────────────────────
  const handleSource = (file) => {
    setError(""); setDone(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        if (!rows.length) throw new Error("Sheet is empty.");
        const h = rows[0];
        const idx = {
          title: findHeaderIndex(h, HEADER_ALIASES.title),
          sku: findHeaderIndex(h, HEADER_ALIASES.sku),
          price: findHeaderIndex(h, HEADER_ALIASES.sellingPrice),
          mrp: findHeaderIndex(h, HEADER_ALIASES.mrp),
          link: findHeaderIndex(h, HEADER_ALIASES.amazonLink),
          cat: findHeaderIndex(h, HEADER_ALIASES.category),
          img: findHeaderIndex(h, HEADER_ALIASES.images),
        };
        if (idx.title === -1) throw new Error("Couldn't find a 'Title' column in the input sheet.");
        const parsed = [];
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          const title = row[idx.title];
          if (title == null || String(title).trim() === "") continue;
          parsed.push({
            title: String(title).trim(),
            sku: idx.sku > -1 ? row[idx.sku] : "",
            price: idx.price > -1 ? row[idx.price] : "",
            mrp: idx.mrp > -1 ? row[idx.mrp] : "",
            link: idx.link > -1 ? row[idx.link] : "",
            category: idx.cat > -1 ? String(row[idx.cat] || "").trim() : "",
            image: idx.img > -1 ? String(row[idx.img] || "").trim() : "",
          });
        }
        if (!parsed.length) throw new Error("No product rows found (every Title was empty).");
        setSourceRows(parsed); setSourceName(file.name); setOverrides({});
      } catch (err) {
        setError("Input sheet: " + err.message); setSourceRows([]); setSourceName("");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── load template: detect fill sheet, map columns by header, read options ───
  const handleTemplate = (file) => {
    setError(""); setDone(false);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target.result;
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.SheetNames.find((n) => n.toLowerCase().includes(FILL_SHEET_MATCH));
        if (!sheet) throw new Error(`No "Fill this" sheet found in this file.`);
        const ws = wb.Sheets[sheet];

        // build header-name → column index from the header row
        const ref = XLSX.utils.decode_range(ws["!ref"]);
        const headerByCol = {};
        for (let c = ref.s.c; c <= ref.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r: HEADER_ROW - 1, c })];
          const name = cell ? fieldName(cell.v) : "";
          if (name) headerByCol[c] = name;
        }
        const cmap = {};
        for (const f of FIELDS) {
          const target = norm(f.header);
          let found = -1;
          for (const [c, name] of Object.entries(headerByCol)) {
            const nn = norm(name);
            if (nn === target) { found = +c; break; }
          }
          if (found === -1) {                    // loose contains match
            for (const [c, name] of Object.entries(headerByCol)) {
              const nn = norm(name);
              if (nn.includes(target) || target.includes(nn)) { found = +c; break; }
            }
          }
          if (found !== -1) cmap[f.key] = found;
        }
        if (cmap.productName === undefined)
          throw new Error("Couldn't locate the Product Name column in this template.");

        // read dropdown options from Validation Sheet (same column index as fill sheet)
        const vs = wb.Sheets["Validation Sheet"];
        let opts = null;
        if (vs) {
          const grid = XLSX.utils.sheet_to_json(vs, { header: 1, blankrows: false });
          opts = {};
          for (const f of FIELDS) {
            if (!f.dropdown || cmap[f.key] === undefined) continue;
            const col = cmap[f.key];
            const vals = [];
            for (let r = 1; r < grid.length; r++) {
              const cell = grid[r]?.[col];
              if (cell == null || String(cell).trim() === "") continue;
              const v = String(cell).trim();
              if (!isRealOption(v)) continue;
              if (!vals.includes(v)) vals.push(v);
            }
            if (vals.length) opts[f.key] = vals;
          }
        }

        setTemplateBuf(buf);
        setFillSheet(sheet);
        setColMap(cmap);
        setTplOptions(opts);
        setTemplateName(file.name);

        // snap any dropdown default not valid for this template to its first option
        if (opts) {
          setSettings((s) => {
            const next = { ...s };
            for (const [key, list] of Object.entries(opts))
              if (list.length && !list.includes(next[key])) next[key] = list[0];
            return next;
          });
        }
      } catch (err) {
        setError("Template: " + err.message);
        setTemplateBuf(null); setTemplateName(""); setFillSheet(""); setColMap(null); setTplOptions(null);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── per-product field value ────────────────────────────────────────────────
  const computeValue = useCallback((src, key, rowIdx) => {
    const ov = overrides[rowIdx]?.[key];
    if (ov !== undefined && ov !== "") return ov;
    switch (key) {
      case "productName": return clampTitle(src.title);
      case "bookTitle":  return src.title;
      case "styleId":    return src.sku && String(src.sku).trim() !== "" ? src.sku : src.title;
      case "price":      return src.price;
      case "mrp":        return src.mrp;
      case "defective": {
        const p = parseFloat(src.price), off = parseFloat(settings.defectiveOffset) || 0;
        return isNaN(p) ? "" : p - off;
      }
      case "netWeight": {
        const slab = settings.weightSlabs[src.category];
        if (slab !== undefined && slab !== "") return slab;
        return settings.weightDefault || "";   // fallback so weight is never empty
      }
      case "pagesField": return settings.pagesField;
      case "image1":     return src.image;            // verbatim from input sheet
      case "groupId":    return `Group ${rowIdx + 1}`;
      default:           return settings[key] ?? "";
    }
  }, [overrides, settings]);

  const preview = useMemo(() =>
    sourceRows.map((src, i) => {
      const row = {};
      FIELDS.forEach((f) => { row[f.key] = computeValue(src, f.key, i); });
      return row;
    }), [sourceRows, computeValue]);

  const setOverride = (rowIdx, key, value) =>
    setOverrides((o) => ({ ...o, [rowIdx]: { ...(o[rowIdx] || {}), [key]: value } }));

  // ── generate: patch values into the template XML, preserving validations ────
  const generate = async () => {
    setError("");
    if (!templateBuf) { setError("Upload the blank Meesho template first."); return; }
    if (!sourceRows.length) { setError("Upload your product input sheet first."); return; }
    if (!colMap) { setError("Template columns not mapped — re-upload the template."); return; }
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(templateBuf);

      // resolve which worksheet XML file is the fill sheet, via workbook.xml + rels
      const wbXml = await zip.file("xl/workbook.xml").async("string");
      const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
      const sheetTag = [...wbXml.matchAll(/<sheet[^>]*\/?>/g)]
        .map((m) => m[0])
        .find((t) => {
          const nm = (t.match(/name="([^"]*)"/) || [])[1] || "";
          return nm === fillSheet;
        });
      if (!sheetTag) throw new Error("Couldn't locate the fill sheet inside the workbook.");
      const rid = (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
      const relTag = [...relsXml.matchAll(/<Relationship[^>]*\/>/g)]
        .map((m) => m[0])
        .find((t) => (t.match(/Id="([^"]+)"/) || [])[1] === rid);
      const target = (relTag.match(/Target="([^"]+)"/) || [])[1];
      const sheetPath = "xl/" + target.replace(/^\//, "");

      let xml = await zip.file(sheetPath).async("string");

      // ── shared strings ──
      // Meesho templates store text via the shared-string table (t="s"), and
      // Google Sheets only renders that form (it shows inline strings as blank).
      // So we append our text values to sharedStrings.xml and reference them by
      // index, matching the template's own encoding.
      const ssFile = zip.file("xl/sharedStrings.xml");
      let ssXml = ssFile ? await ssFile.async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>`;
      let siCount = (ssXml.match(/<si>/g) || []).length;
      const internCache = new Map();
      const appended = [];
      const intern = (str) => {
        if (internCache.has(str)) return internCache.get(str);
        const idx = siCount + appended.length;
        internCache.set(str, idx);
        appended.push(str);
        return idx;
      };

      const makeCell = (ref, value) => {
        if (typeof value === "number" && !isNaN(value)) return `<c r="${ref}"><v>${value}</v></c>`;
        const si = intern(String(value));
        return `<c r="${ref}" t="s"><v>${si}</v></c>`;
      };

      preview.forEach((row, i) => {
        const rownum = DATA_START_ROW + i;
        const rowRe = new RegExp(`<row r="${rownum}"[^>]*>([\\s\\S]*?)</row>`);
        const m = xml.match(rowRe);
        if (!m) return;
        let rowxml = m[0], inner = m[1];
        FIELDS.forEach((f) => {
          if (colMap[f.key] === undefined) return;
          let v = row[f.key];
          if (v === "" || v == null) return;
          const numeric = ["price", "mrp", "defective", "netWeight"].includes(f.key);
          if (numeric && !isNaN(parseFloat(v))) v = parseFloat(v); else v = String(v);
          const ref = colLetter(colMap[f.key]) + rownum;
          const cell = makeCell(ref, v);
          const cellRe = new RegExp(`<c r="${ref}"(?:[^>]*?/>|[^>]*?>[\\s\\S]*?</c>)`);
          if (cellRe.test(inner)) inner = inner.replace(cellRe, cell);
          else inner = inner + cell;
        });
        const newrow = rowxml.slice(0, rowxml.indexOf(">") + 1) + inner + "</row>";
        xml = xml.replace(rowxml, newrow);
      });

      // write appended strings back into sharedStrings.xml and fix the counts
      if (appended.length) {
        const newSi = appended.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join("");
        ssXml = ssXml.replace("</sst>", newSi + "</sst>");
        const oldCount = parseInt((ssXml.match(/\bcount="(\d+)"/) || [0, "0"])[1], 10);
        const oldUnique = parseInt((ssXml.match(/uniqueCount="(\d+)"/) || [0, "0"])[1], 10);
        ssXml = ssXml.replace(/\bcount="\d+"/, `count="${oldCount + appended.length}"`);
        if (/uniqueCount="\d+"/.test(ssXml))
          ssXml = ssXml.replace(/uniqueCount="\d+"/, `uniqueCount="${oldUnique + appended.length}"`);
        zip.file("xl/sharedStrings.xml", ssXml);
      }

      zip.file(sheetPath, xml);
      const out = await zip.generateAsync({ type: "blob", compression: "DEFLATE",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url; a.download = "Meesho_Bulk_Upload_Filled.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (err) {
      setError("Generation failed: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = sourceRows.length > 0 && templateBuf && colMap;
  const previewCols = ["productName","styleId","bookTitle","price","defective","mrp","netWeight","pagesField","image1","groupId"];
  const mappedCount = colMap ? Object.keys(colMap).length : 0;
  const unmatched = colMap ? FIELDS.filter((f) => colMap[f.key] === undefined).map((f) => f.header) : [];

  // active section for sidebar highlight + smooth scroll
  const [active, setActive] = useState("upload");
  const goto = (id) => {
    setActive(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const steps = [
    { id: "upload",   n: "1", label: "Upload files",   done: !!templateBuf && sourceRows.length > 0 },
    { id: "config",   n: "2", label: "Configure",      done: !!templateBuf },
    { id: "preview",  n: "3", label: "Review rows",    done: sourceRows.length > 0 },
    { id: "export",   n: "4", label: "Export",         done: done },
  ];

  return (
    <div style={S.app}>
      <style>{CSS}</style>

      {/* ░░ SIDEBAR ░░ */}
      <aside style={S.sidebar}>
        <div style={S.brand}>
          <div style={S.brandMark}>M</div>
          <div>
            <div style={S.brandName}>Meeshify</div>
            <div style={S.brandTag}>Bulk listing studio</div>
          </div>
        </div>

        <nav style={S.nav}>
          {steps.map((s) => (
            <button key={s.id} className="navitem"
              style={{ ...S.navItem, ...(active === s.id ? S.navItemActive : {}) }}
              onClick={() => goto(s.id)}>
              <span style={{ ...S.navDot, ...(s.done ? S.navDotDone : {}) }}>
                {s.done ? "✓" : s.n}
              </span>
              <span style={S.navLabel}>{s.label}</span>
            </button>
          ))}
        </nav>

        <div style={S.sideStatus}>
          <div style={S.sideStatusRow}>
            <span style={S.sideStatusLabel}>Input</span>
            <span style={{ ...S.pill, ...(sourceRows.length ? S.pillOk : S.pillIdle) }}>
              {sourceRows.length ? `${sourceRows.length} rows` : "none"}
            </span>
          </div>
          <div style={S.sideStatusRow}>
            <span style={S.sideStatusLabel}>Template</span>
            <span style={{ ...S.pill, ...(templateBuf ? S.pillOk : S.pillIdle) }}>
              {templateBuf ? "loaded" : "none"}
            </span>
          </div>
          <div style={S.sideStatusRow}>
            <span style={S.sideStatusLabel}>Fields mapped</span>
            <span style={{ ...S.pill, ...(mappedCount ? S.pillOk : S.pillIdle) }}>
              {mappedCount || "—"}
            </span>
          </div>
        </div>

        <div style={S.sideFoot}>
          <span style={S.shieldIcon}>🔒</span>
          <span>Runs in your browser. No data is uploaded.</span>
        </div>
      </aside>

      {/* ░░ MAIN ░░ */}
      <main style={S.main}>
        {/* sticky top bar */}
        <div style={S.topbar}>
          <div>
            <h1 style={S.pageTitle}>Convert to Meesho upload</h1>
            <p style={S.pageSub}>Map a seller sheet into the official template — dropdown rules preserved, ready to upload.</p>
          </div>
          <div style={S.topActions}>
            <div style={{ ...S.readyChip, ...(ready ? S.readyChipOn : {}) }}>
              <span style={{ ...S.readyDotBig, ...(ready ? S.readyDotBigOn : {}) }} />
              {ready ? "Ready to export" : "Awaiting files"}
            </div>
          </div>
        </div>

        <div style={S.scroll}>
          {/* ── STEP 1: UPLOAD ── */}
          <section id="sec-upload" style={S.section}>
            <SectionHead n="1" title="Upload your files" desc="Your product sheet and the blank Meesho category template." />
            <div style={S.uploadGrid}>
              <UploadCard
                kind="input"
                title="Product sheet"
                sub="Title · SKU · Price · MRP · Amazon link · Category · Images"
                fileName={sourceName}
                meta={sourceRows.length ? `${sourceRows.length} products parsed` : null}
                onPick={() => srcRef.current?.click()}
              />
              <input ref={srcRef} type="file" accept=".xlsx,.xls" hidden
                onChange={(e) => e.target.files[0] && handleSource(e.target.files[0])} />
              <UploadCard
                kind="template"
                title="Meesho template"
                sub={fillSheet ? `Sheet: ${fillSheet}` : `Any category template with a "…Fill this" sheet`}
                fileName={templateName}
                meta={templateBuf ? `${mappedCount} fields mapped${fromTemplate ? " · dropdowns detected" : ""}` : null}
                onPick={() => tplRef.current?.click()}
              />
              <input ref={tplRef} type="file" accept=".xlsx" hidden
                onChange={(e) => e.target.files[0] && handleTemplate(e.target.files[0])} />
            </div>

            <div style={S.infoStrip}>
              <span style={S.infoStripIcon}>◆</span>
              <span>The template's structure — every dropdown rule and validation — is kept byte-for-byte. Only the product cells get written, so Meesho reads the file cleanly.</span>
            </div>

            {unmatched.length > 0 && (
              <div style={S.warnStrip}>
                <span style={S.warnIcon}>!</span>
                <span><b>{unmatched.length} field{unmatched.length > 1 ? "s" : ""} not matched</b> in this template and will stay blank: {unmatched.join(", ")}.</span>
              </div>
            )}
          </section>

          {/* ── STEP 2: CONFIGURE ── */}
          <section id="sec-config" style={S.section}>
            <SectionHead n="2" title="Defaults & rules"
              desc={fromTemplate ? "Dropdowns are populated from your uploaded template." : "Upload a template to load its exact dropdown options."} />

            <Panel title="Pricing & weight" accent>
              <div style={S.grid3}>
                <Field label="Defective price" hint="Meesho price minus this amount">
                  <div style={S.inputAffix}>
                    <span style={S.affix}>− ₹</span>
                    <input style={S.affixInput} value={settings.defectiveOffset}
                      onChange={(e) => set("defectiveOffset", e.target.value)} />
                  </div>
                </Field>
                <Field label="Default weight" hint="Used when a category has no slab">
                  <Select value={settings.weightDefault} onChange={(v) => set("weightDefault", v)}
                    options={["250","500","750","1000","1250","1500","2000"].map((w) => ({ v: w, l: `${w} g` }))} />
                </Field>
                <Field label="Pages" hint="Applied to every row">
                  <Select value={settings.pagesField} onChange={(v) => set("pagesField", v)}
                    options={opt("pagesField").map((o) => ({ v: o, l: o }))} />
                </Field>
              </div>
            </Panel>

            {categories.length > 0 && (
              <Panel title="Net weight by category">
                <div style={S.grid4}>
                  {categories.map((cat) => (
                    <Field key={cat} label={cat}>
                      <Select value={settings.weightSlabs[cat] ?? ""}
                        onChange={(v) => set("weightSlabs", { ...settings.weightSlabs, [cat]: v })}
                        options={[{ v: "", l: "— use default —" }, ...["250","500","750","1000","1250","1500","2000"].map((w) => ({ v: w, l: `${w} g` }))]} />
                    </Field>
                  ))}
                </div>
                <p style={S.panelNote}>Amazon weight can't be fetched from a static page, so weight comes from these slabs (default fills any gap, so it's never empty). Override per-row in review.</p>
              </Panel>
            )}

            <Panel title="Catalog attributes"
              badge={fromTemplate ? "from template" : "defaults"}>
              <div style={S.grid4}>
                <Field label="Board"><Select value={settings.boardField} onChange={(v) => set("boardField", v)} options={opt("boardField").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Format"><Select value={settings.bookFormat} onChange={(v) => set("bookFormat", v)} options={opt("bookFormat").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Genre"><Select value={settings.genreField} onChange={(v) => set("genreField", v)} options={opt("genreField").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Grade"><Select value={settings.gradeField} onChange={(v) => set("gradeField", v)} options={opt("gradeField").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Language"><Select value={settings.langField} onChange={(v) => set("langField", v)} options={opt("langField").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Sub Genre"><Select value={settings.subGenre} onChange={(v) => set("subGenre", v)} options={opt("subGenre").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Book Type"><Select value={settings.bookType} onChange={(v) => set("bookType", v)} options={opt("bookType").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Generic Name"><Select value={settings.genericName} onChange={(v) => set("genericName", v)} options={opt("genericName").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Net Quantity"><Select value={settings.netQty} onChange={(v) => set("netQty", v)} options={opt("netQty").map((o) => ({ v: o, l: o }))} /></Field>
                <Field label="Publish Year"><input style={S.input} value={settings.publishYear} onChange={(e) => set("publishYear", e.target.value)} /></Field>
                <Field label="Variation"><input style={S.input} value={settings.variation} onChange={(e) => set("variation", e.target.value)} /></Field>
              </div>
            </Panel>

            <Panel title="Compliance" collapsible defaultOpen={false}>
              <div style={S.grid4}>
                <Field label="GST %"><input style={S.input} value={settings.gst} onChange={(e) => set("gst", e.target.value)} /></Field>
                <Field label="HSN ID"><input style={S.input} value={settings.hsn} onChange={(e) => set("hsn", e.target.value)} /></Field>
                <Field label="Inventory"><input style={S.input} value={settings.inventory} onChange={(e) => set("inventory", e.target.value)} /></Field>
                <Field label="Country"><input style={S.input} value={settings.country} onChange={(e) => set("country", e.target.value)} /></Field>
                <Field label="Manufacturer name"><input style={S.input} value={settings.mfgName} onChange={(e) => set("mfgName", e.target.value)} /></Field>
                <Field label="Manufacturer address"><input style={S.input} value={settings.mfgAddr} onChange={(e) => set("mfgAddr", e.target.value)} /></Field>
                <Field label="Manufacturer pincode"><input style={S.input} value={settings.mfgPin} onChange={(e) => set("mfgPin", e.target.value)} /></Field>
                <Field label="Packer name"><input style={S.input} value={settings.packName} onChange={(e) => set("packName", e.target.value)} /></Field>
                <Field label="Packer address"><input style={S.input} value={settings.packAddr} onChange={(e) => set("packAddr", e.target.value)} /></Field>
                <Field label="Packer pincode"><input style={S.input} value={settings.packPin} onChange={(e) => set("packPin", e.target.value)} /></Field>
                <Field label="Importer name"><input style={S.input} value={settings.impName} onChange={(e) => set("impName", e.target.value)} /></Field>
                <Field label="Importer address"><input style={S.input} value={settings.impAddr} onChange={(e) => set("impAddr", e.target.value)} /></Field>
                <Field label="Importer pincode"><input style={S.input} value={settings.impPin} onChange={(e) => set("impPin", e.target.value)} /></Field>
              </div>
            </Panel>
          </section>

          {/* ── STEP 3: PREVIEW ── */}
          <section id="sec-preview" style={S.section}>
            <SectionHead n="3" title="Review rows"
              desc={sourceRows.length ? "Highlighted cells are editable per row. Image is copied verbatim from your sheet." : "Upload a product sheet to preview the mapped rows."} />
            {sourceRows.length === 0 ? (
              <div style={S.emptyState}>
                <div style={S.emptyIcon}>▦</div>
                <div style={S.emptyTitle}>No products yet</div>
                <div style={S.emptyDesc}>Upload your product sheet in step 1 and the mapped rows will appear here.</div>
              </div>
            ) : (
              <div style={S.tableCard}>
                <div style={S.tableTop}>
                  <span style={S.tableCount}>{sourceRows.length} products</span>
                  <span style={S.tableLegend}><span style={S.legendSwatch} /> editable</span>
                </div>
                <div style={S.tableWrap}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.thNum}>#</th>
                        {previewCols.map((k) => {
                          const f = FIELDS.find((x) => x.key === k);
                          const c = colMap?.[k];
                          const label = k === "styleId" ? "SKU / Style ID" : f.header;
                          return (
                            <th key={k} style={S.th}>
                              <span style={S.thLabel}>{label}</span>
                              {c !== undefined && <span style={S.colTag}>{colLetter(c)}</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr key={i} className="datarow">
                          <td style={S.tdNum}>{i + 1}</td>
                          {previewCols.map((k) => {
                            const editable = ["defective","netWeight","pagesField"].includes(k);
                            const isPages = k === "pagesField";
                            const wasClamped = k === "productName" && String(sourceRows[i]?.title || "").length > TITLE_MAX;
                            return (
                              <td key={k} style={S.td} title={wasClamped ? `Original was ${String(sourceRows[i].title).length} chars — trimmed to ${TITLE_MAX}` : String(row[k] ?? "")}>
                                {editable ? (
                                  isPages ? (
                                    <select style={S.cellInput} value={row[k] ?? ""} onChange={(e) => setOverride(i, k, e.target.value)}>
                                      {opt("pagesField").map((o) => <option key={o}>{o}</option>)}
                                    </select>
                                  ) : (
                                    <input style={S.cellInput} value={row[k] ?? ""} onChange={(e) => setOverride(i, k, e.target.value)} />
                                  )
                                ) : (
                                  <span style={S.cellText}>
                                    {String(row[k] ?? "")}
                                    {wasClamped && <span style={S.clampTag}>trimmed to {TITLE_MAX}</span>}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── STEP 4: EXPORT ── */}
          <section id="sec-export" style={S.section}>
            <SectionHead n="4" title="Export" desc="Generate the filled template, ready to upload to Meesho." />
            <div style={S.exportCard}>
              <div style={S.exportChecklist}>
                <ChecklistItem ok={sourceRows.length > 0} label="Product sheet loaded" detail={sourceRows.length ? `${sourceRows.length} rows` : "required"} />
                <ChecklistItem ok={!!templateBuf} label="Template loaded" detail={templateBuf ? fillSheet : "required"} />
                <ChecklistItem ok={mappedCount > 0} label="Columns mapped" detail={mappedCount ? `${mappedCount} fields` : "—"} />
                <ChecklistItem ok={unmatched.length === 0} warn={unmatched.length > 0} label="All fields matched" detail={unmatched.length ? `${unmatched.length} blank` : "complete"} />
              </div>
              <div style={S.exportAction}>
                {error && <div style={S.errorBox}><span style={S.errIcon}>×</span>{error}</div>}
                {done && !error && <div style={S.successBox}><span style={S.okIcon}>✓</span>Downloaded as <b style={{ marginLeft: 4 }}>Meesho_Bulk_Upload_Filled.xlsx</b> — dropdown rules intact.</div>}
                <button style={{ ...S.exportBtn, ...(ready && !busy ? {} : S.exportBtnOff) }} onClick={generate} disabled={!ready || busy}>
                  {busy ? (<><span className="spin" style={S.spinner} />Generating…</>) : (<>Generate filled template <span style={S.btnArrow}>↓</span></>)}
                </button>
                {!ready && <span style={S.exportHint}>Upload both files to enable export.</span>}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

// ── components ───────────────────────────────────────────────────────────────
function SectionHead({ n, title, desc }) {
  return (
    <div style={S.secHead}>
      <span style={S.secNum}>{n}</span>
      <div>
        <h2 style={S.secTitle}>{title}</h2>
        <p style={S.secDesc}>{desc}</p>
      </div>
    </div>
  );
}

function UploadCard({ kind, title, sub, fileName, meta, onPick }) {
  const loaded = !!fileName;
  return (
    <button className="uploadcard" style={{ ...S.upCard, ...(loaded ? S.upCardLoaded : {}) }} onClick={onPick}>
      <div style={S.upIconWrap}>
        <span style={{ ...S.upIcon, ...(loaded ? S.upIconOn : {}) }}>{kind === "input" ? "▤" : "▦"}</span>
      </div>
      <div style={S.upBody}>
        <div style={S.upTitle}>{title}</div>
        <div style={S.upSub}>{sub}</div>
        {loaded ? (
          <div style={S.upFile}>
            <span style={S.upCheck}>✓</span>
            <span style={S.upFileName}>{fileName}</span>
          </div>
        ) : (
          <div style={S.upCta}>Click to choose · .xlsx</div>
        )}
        {meta && <div style={S.upMeta}>{meta}</div>}
      </div>
    </button>
  );
}

function Panel({ title, children, accent, badge, collapsible, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ ...S.panel, ...(accent ? S.panelAccent : {}) }}>
      <div style={S.panelHead} onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        role={collapsible ? "button" : undefined}>
        <span style={S.panelTitle}>{title}</span>
        {badge && <span style={S.panelBadge}>{badge}</span>}
        {collapsible && <span style={S.panelChev}>{open ? "−" : "+"}</span>}
      </div>
      {open && <div style={S.panelBody}>{children}</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
      {hint && <span style={S.fieldHint}>{hint}</span>}
    </label>
  );
}

function Select({ value, onChange, options }) {
  return (
    <div style={S.selectWrap}>
      <select style={S.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <span style={S.selectChev}>▾</span>
    </div>
  );
}

function ChecklistItem({ ok, warn, label, detail }) {
  const tone = ok ? "ok" : warn ? "warn" : "idle";
  return (
    <div style={S.checkItem}>
      <span style={{ ...S.checkMark, ...(tone === "ok" ? S.checkMarkOk : tone === "warn" ? S.checkMarkWarn : S.checkMarkIdle) }}>
        {ok ? "✓" : warn ? "!" : "○"}
      </span>
      <span style={S.checkLabel}>{label}</span>
      <span style={{ ...S.checkDetail, ...(tone === "warn" ? { color: amber } : {}) }}>{detail}</span>
    </div>
  );
}

// ── design tokens (DARK MODE) ───────────────────────────────────────────────
// Token names keep their semantic role from light mode; values are remapped for
// dark. e.g. `ink` = primary text (now light), `surface` = card bg (now dark),
// `canvas` = app bg (darkest-but-one), sidebar is darker still.
const ink = "#f1f5f9", ink2 = "#cbd5e1";        // primary / secondary text (light on dark)
const slate = "#94a3b8", slate2 = "#64748b";     // muted / faint text
const line = "#2a3344", line2 = "#222a38";       // borders / hairlines
const surface = "#171c28", canvas = "#0d111a";   // card bg / app bg
const sidebarBg = "#090c13", elevate = "#1e2433"; // sidebar / raised panels
const accent = "#f43f7e", accentDark = "#e11d63"; // brightened pink for dark bg
const accentSoft = "#3a1726", accentTint = "#241019"; // pink-tinted dark fills
const ok = "#34d399", okSoft = "#10261f";        // green + dark green fill
const amber = "#fbbf24", amberSoft = "#2a2010";  // amber + dark amber fill
const danger = "#f87171", dangerSoft = "#2a1414"; // red + dark red fill
const mono = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const display = "'Space Grotesk', 'Inter', system-ui, sans-serif";
const body = "'Inter', system-ui, -apple-system, sans-serif";

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;450;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: ${canvas}; color-scheme: dark; }
  ::selection { background: ${accent}; color: #fff; }
  .navitem:hover { background: ${elevate} !important; }
  .uploadcard:hover { border-color: ${accent} !important; transform: translateY(-1px); box-shadow: 0 8px 28px rgba(244,63,126,.18); }
  .datarow:nth-child(even) { background: ${canvas}; }
  .datarow:hover { background: ${accentTint}; }
  input:focus, select:focus { outline: none; border-color: ${accent} !important; box-shadow: 0 0 0 3px ${accentSoft}; }
  button:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; }
  input::placeholder { color: ${slate2}; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin .7s linear infinite; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: ${line}; border-radius: 6px; border: 2px solid ${canvas}; }
  ::-webkit-scrollbar-thumb:hover { background: ${slate2}; }
  @media (max-width: 920px) {
    .appshell { grid-template-columns: 1fr !important; }
    .sidebar-el { display: none !important; }
  }
`;

const S = {
  app: { display: "grid", gridTemplateColumns: "248px 1fr", minHeight: "100vh", fontFamily: body, color: ink, background: canvas },

  // sidebar
  sidebar: { background: sidebarBg, color: ink, display: "flex", flexDirection: "column", padding: "22px 16px", position: "sticky", top: 0, height: "100vh", borderRight: `1px solid ${line2}` },
  brand: { display: "flex", alignItems: "center", gap: 11, padding: "0 8px 22px" },
  brandMark: { width: 38, height: 38, borderRadius: 10, background: accent, color: "#fff", display: "grid", placeItems: "center", fontFamily: display, fontWeight: 700, fontSize: 20, boxShadow: "0 4px 14px rgba(244,63,126,.45)" },
  brandName: { fontFamily: display, fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" },
  brandTag: { fontSize: 11, color: slate2, marginTop: 1 },
  nav: { display: "flex", flexDirection: "column", gap: 2 },
  navItem: { display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", borderRadius: 9, background: "transparent", border: "none", color: slate, fontSize: 13.5, fontFamily: body, fontWeight: 500, cursor: "pointer", textAlign: "left", transition: "background .12s, color .12s", width: "100%" },
  navItemActive: { background: elevate, color: ink },
  navDot: { width: 22, height: 22, borderRadius: 7, background: elevate, color: slate, display: "grid", placeItems: "center", fontSize: 11, fontFamily: mono, fontWeight: 600, flexShrink: 0 },
  navDotDone: { background: accent, color: "#fff" },
  navLabel: { flex: 1 },
  sideStatus: { marginTop: "auto", background: "rgba(255,255,255,.03)", border: `1px solid ${line2}`, borderRadius: 12, padding: "12px 13px", display: "flex", flexDirection: "column", gap: 9 },
  sideStatusRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  sideStatusLabel: { fontSize: 12, color: slate },
  pill: { fontSize: 11, fontFamily: mono, fontWeight: 600, padding: "2px 8px", borderRadius: 20 },
  pillOk: { background: okSoft, color: ok },
  pillIdle: { background: elevate, color: slate2 },
  sideFoot: { marginTop: 14, fontSize: 11, color: slate2, lineHeight: 1.5, display: "flex", gap: 7, alignItems: "flex-start", padding: "0 4px" },
  shieldIcon: { fontSize: 12, flexShrink: 0 },

  // main
  main: { display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 32px", borderBottom: `1px solid ${line}`, background: "rgba(13,17,26,.82)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 10 },
  pageTitle: { margin: 0, fontFamily: display, fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em" },
  pageSub: { margin: "3px 0 0", fontSize: 13, color: slate },
  topActions: { display: "flex", alignItems: "center", gap: 12 },
  readyChip: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: slate, background: surface, border: `1px solid ${line}`, padding: "8px 14px", borderRadius: 30 },
  readyChipOn: { color: ok, borderColor: ok, background: okSoft },
  readyDotBig: { width: 8, height: 8, borderRadius: 99, background: slate2 },
  readyDotBigOn: { background: ok, boxShadow: `0 0 0 3px ${okSoft}` },

  scroll: { overflowY: "auto", padding: "8px 32px 80px", flex: 1 },
  section: { maxWidth: 940, margin: "0 auto", padding: "28px 0", borderBottom: `1px solid ${line2}` },
  secHead: { display: "flex", gap: 13, alignItems: "flex-start", marginBottom: 20 },
  secNum: { width: 28, height: 28, borderRadius: 8, background: accent, color: "#fff", fontFamily: mono, fontWeight: 600, fontSize: 13, display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1, boxShadow: "0 2px 8px rgba(244,63,126,.35)" },
  secTitle: { margin: 0, fontFamily: display, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" },
  secDesc: { margin: "3px 0 0", fontSize: 13, color: slate, lineHeight: 1.5 },

  // upload
  uploadGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  upCard: { display: "flex", gap: 15, alignItems: "flex-start", textAlign: "left", padding: "20px", borderRadius: 14, border: `1.5px solid ${line}`, background: surface, cursor: "pointer", transition: "all .15s", fontFamily: body },
  upCardLoaded: { borderColor: ok, background: okSoft },
  upIconWrap: { flexShrink: 0 },
  upIcon: { width: 44, height: 44, borderRadius: 11, background: canvas, color: slate, display: "grid", placeItems: "center", fontSize: 20, border: `1px solid ${line}` },
  upIconOn: { background: ok, color: "#06281d", borderColor: ok },
  upBody: { minWidth: 0, flex: 1 },
  upTitle: { fontFamily: display, fontSize: 15.5, fontWeight: 600 },
  upSub: { fontSize: 12, color: slate, marginTop: 3, lineHeight: 1.45 },
  upCta: { marginTop: 11, fontSize: 12.5, fontWeight: 600, color: accent },
  upFile: { marginTop: 11, display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
  upCheck: { width: 16, height: 16, borderRadius: 5, background: ok, color: "#06281d", fontSize: 10, display: "grid", placeItems: "center", flexShrink: 0 },
  upFileName: { fontSize: 12.5, fontWeight: 500, color: ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  upMeta: { marginTop: 6, fontSize: 11.5, fontFamily: mono, color: ok, fontWeight: 600 },

  infoStrip: { display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, padding: "12px 14px", borderRadius: 11, background: accentTint, border: `1px solid ${accentSoft}`, fontSize: 12.5, color: ink2, lineHeight: 1.5 },
  infoStripIcon: { color: accent, fontSize: 11, marginTop: 2, flexShrink: 0 },
  warnStrip: { display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, padding: "12px 14px", borderRadius: 11, background: amberSoft, border: `1px solid ${amber}44`, fontSize: 12.5, color: amber, lineHeight: 1.5 },
  warnIcon: { width: 18, height: 18, borderRadius: 5, background: amber, color: "#1a1208", fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center", flexShrink: 0 },

  // panels
  panel: { border: `1px solid ${line}`, borderRadius: 14, background: surface, marginBottom: 14, overflow: "hidden" },
  panelAccent: { borderColor: accentSoft, boxShadow: `0 1px 0 ${accentSoft}` },
  panelHead: { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${line2}`, background: canvas },
  panelTitle: { fontFamily: display, fontSize: 13.5, fontWeight: 600, color: ink, flex: 1, letterSpacing: "0.01em" },
  panelBadge: { fontSize: 10.5, fontFamily: mono, fontWeight: 600, color: accent, background: accentSoft, padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.04em" },
  panelChev: { fontSize: 18, color: slate2, fontWeight: 400, lineHeight: 1, cursor: "pointer" },
  panelBody: { padding: "18px" },
  panelNote: { fontSize: 11.5, color: slate, marginTop: 14, lineHeight: 1.55, marginBottom: 0 },

  grid3: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 },

  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: ink2 },
  fieldHint: { fontSize: 11, color: slate2, lineHeight: 1.4 },
  input: { border: `1px solid ${line}`, borderRadius: 9, padding: "9px 11px", fontSize: 13, fontFamily: body, background: surface, color: ink, width: "100%", transition: "border-color .12s, box-shadow .12s" },

  inputAffix: { display: "flex", alignItems: "stretch", border: `1px solid ${line}`, borderRadius: 9, overflow: "hidden", background: surface },
  affix: { display: "grid", placeItems: "center", padding: "0 11px", background: canvas, color: slate, fontSize: 13, fontFamily: mono, fontWeight: 600, borderRight: `1px solid ${line}` },
  affixInput: { border: "none", padding: "9px 11px", fontSize: 13, fontFamily: body, width: "100%", outline: "none", background: "transparent", color: ink },

  selectWrap: { position: "relative" },
  select: { appearance: "none", WebkitAppearance: "none", border: `1px solid ${line}`, borderRadius: 9, padding: "9px 30px 9px 11px", fontSize: 13, fontFamily: body, background: surface, color: ink, width: "100%", cursor: "pointer", transition: "border-color .12s, box-shadow .12s" },
  selectChev: { position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: slate2, pointerEvents: "none" },

  // empty
  emptyState: { textAlign: "center", padding: "48px 20px", borderRadius: 14, border: `1.5px dashed ${line}`, background: surface },
  emptyIcon: { fontSize: 32, color: slate2, marginBottom: 12 },
  emptyTitle: { fontFamily: display, fontSize: 15, fontWeight: 600, color: ink2 },
  emptyDesc: { fontSize: 13, color: slate, marginTop: 5 },

  // table
  tableCard: { border: `1px solid ${line}`, borderRadius: 14, background: surface, overflow: "hidden" },
  tableTop: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${line2}`, background: canvas },
  tableCount: { fontFamily: mono, fontSize: 12, fontWeight: 600, color: ink2 },
  tableLegend: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: slate },
  legendSwatch: { width: 14, height: 14, borderRadius: 4, background: accentTint, border: `1px solid ${accentSoft}`, display: "inline-block" },
  tableWrap: { overflowX: "auto" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 920 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: `1px solid ${line}`, whiteSpace: "nowrap", position: "sticky", top: 0, background: surface },
  thLabel: { fontSize: 11, fontWeight: 600, color: ink2, textTransform: "uppercase", letterSpacing: "0.03em" },
  thNum: { textAlign: "center", padding: "10px 8px", borderBottom: `1px solid ${line}`, width: 40, fontSize: 11, color: slate2, fontFamily: mono, position: "sticky", top: 0, background: surface },
  colTag: { fontSize: 9.5, fontFamily: mono, color: accent, marginLeft: 7, fontWeight: 600, background: accentSoft, padding: "1px 5px", borderRadius: 4 },
  td: { padding: "6px 9px", borderBottom: `1px solid ${line2}`, maxWidth: 230, verticalAlign: "middle" },
  tdNum: { textAlign: "center", padding: "6px 8px", borderBottom: `1px solid ${line2}`, color: slate2, fontFamily: mono, fontSize: 11.5 },
  cellText: { display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220, color: ink2 },
  clampTag: { display: "inline-block", marginLeft: 6, fontSize: 9.5, fontFamily: mono, fontWeight: 600, color: amber, background: amberSoft, padding: "1px 5px", borderRadius: 4, verticalAlign: "middle" },
  cellInput: { border: `1px solid ${accentSoft}`, background: accentTint, borderRadius: 7, padding: "5px 8px", fontSize: 12.5, fontFamily: body, width: "100%", color: ink, minWidth: 90, transition: "border-color .12s, box-shadow .12s" },

  // export
  exportCard: { display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 0, border: `1px solid ${line}`, borderRadius: 16, overflow: "hidden", background: surface },
  exportChecklist: { padding: "22px", background: canvas, borderRight: `1px solid ${line}`, display: "flex", flexDirection: "column", gap: 13 },
  checkItem: { display: "flex", alignItems: "center", gap: 11 },
  checkMark: { width: 20, height: 20, borderRadius: 6, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  checkMarkOk: { background: ok, color: "#06281d" },
  checkMarkWarn: { background: amber, color: "#1a1208" },
  checkMarkIdle: { background: elevate, color: slate2 },
  checkLabel: { fontSize: 13, fontWeight: 500, color: ink2, flex: 1 },
  checkDetail: { fontSize: 11.5, fontFamily: mono, color: slate, fontWeight: 500 },
  exportAction: { padding: "22px", display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" },
  exportBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: accent, color: "#fff", border: "none", borderRadius: 12, padding: "15px 24px", fontSize: 15, fontFamily: display, fontWeight: 600, cursor: "pointer", boxShadow: "0 6px 22px rgba(244,63,126,.40)", transition: "transform .12s, box-shadow .12s, background .12s" },
  exportBtnOff: { background: elevate, color: slate2, boxShadow: "none", cursor: "not-allowed" },
  btnArrow: { fontSize: 16 },
  spinner: { width: 15, height: 15, borderRadius: 99, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", display: "inline-block" },
  exportHint: { fontSize: 12, color: slate2, textAlign: "center" },
  errorBox: { display: "flex", alignItems: "center", gap: 9, background: dangerSoft, color: danger, border: `1px solid ${danger}44`, borderRadius: 10, padding: "11px 14px", fontSize: 13, fontWeight: 500 },
  errIcon: { width: 18, height: 18, borderRadius: 5, background: danger, color: "#2a1414", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  successBox: { display: "flex", alignItems: "center", gap: 9, background: okSoft, color: ok, border: `1px solid ${ok}44`, borderRadius: 10, padding: "11px 14px", fontSize: 13 },
  okIcon: { width: 18, height: 18, borderRadius: 5, background: ok, color: "#06281d", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
};
