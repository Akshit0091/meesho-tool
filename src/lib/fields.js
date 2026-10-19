import { norm } from "./template.js";

export const TITLE_MAX = 200; // Meesho caps Product Name at 200 characters

// Trim a title at a word boundary so it never ends mid-word.
export const clampTitle = (s, max = TITLE_MAX) => {
  const str = String(s ?? "").trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
};

// Dropdown values must match the template's option text byte for byte — Meesho's
// Group ID list, for instance, is "Group  1" with two spaces. Snap a configured
// value onto the real option whenever we can recognise it.
export function snapToOption(value, options) {
  const v = String(value ?? "").trim();
  if (!options || !options.length || !v) return v;
  if (options.includes(v)) return v;
  const hit = options.find((o) => norm(o) === norm(v));
  return hit ?? v;
}

// Pick the "Group N" option that carries this number, whatever its spacing.
export function groupOption(n, options) {
  if (!options || !options.length) return `Group ${n}`;
  const hit = options.find((o) => {
    const m = String(o).match(/(\d+)/);
    return m && +m[1] === n;
  });
  return hit ?? `Group ${n}`;
}

// Choose the page-range option that contains `pages`, e.g. 1000 → "901-1000 Pages".
export function pagesOption(pages, options) {
  if (!options || !options.length) return "";
  let fallback = options[options.length - 1];
  for (const o of options) {
    const m = String(o).match(/(\d+)\s*-\s*(\d+)/);
    if (m && pages >= +m[1] && pages <= +m[2]) return o;
    if (/more than/i.test(o)) fallback = o;
  }
  return fallback;
}

// Canonical fields across Meesho's book templates. Columns are matched by the
// template's own header row, so a field simply stays unfilled when a given
// category template doesn't have it.
export const FIELDS = [
  { key: "productName", header: "Product Name" },
  { key: "variation", header: "Variation", dropdown: true, setting: "variation" },
  { key: "price", header: "Meesho Price", numeric: true },
  { key: "defective", header: "Wrong/Defective Returns Price", numeric: true },
  { key: "mrp", header: "MRP", numeric: true, exactOnly: true },
  { key: "gst", header: "GST %", setting: "gst" },
  { key: "hsn", header: "HSN ID", setting: "hsn" },
  { key: "netWeight", header: "Net Weight (gms)", numeric: true },
  { key: "inventory", header: "Inventory", numeric: true, setting: "inventory" },
  { key: "country", header: "Country of Origin", dropdown: true, setting: "country" },
  { key: "mfgName", header: "Manufacturer Name", setting: "mfgName" },
  { key: "mfgAddr", header: "Manufacturer Address", setting: "mfgAddr" },
  { key: "mfgPin", header: "Manufacturer Pincode", setting: "mfgPin" },
  { key: "packName", header: "Packer Name", setting: "packName" },
  { key: "packAddr", header: "Packer Address", setting: "packAddr" },
  { key: "packPin", header: "Packer Pincode", setting: "packPin" },
  { key: "impName", header: "Importer Name", setting: "impName" },
  { key: "impAddr", header: "Importer Address", setting: "impAddr" },
  { key: "impPin", header: "Importer Pincode", setting: "impPin" },
  { key: "board", header: "Board", dropdown: true, setting: "board", exactOnly: true },
  { key: "bookFormat", header: "Book Format", dropdown: true, setting: "bookFormat" },
  { key: "bookTitle", header: "Book Title" },
  { key: "bookType", header: "Book Type", dropdown: true, setting: "bookType" },
  { key: "genericName", header: "Generic Name", dropdown: true, setting: "genericName" },
  { key: "genre", header: "Genre", dropdown: true, setting: "genre", exactOnly: true },
  { key: "grade", header: "Grade", dropdown: true },
  { key: "language", header: "Language", dropdown: true, setting: "language" },
  { key: "netQty", header: "Net Quantity", aliases: ["Net Quantity (N)"], dropdown: true },
  { key: "pages", header: "Pages", dropdown: true, exactOnly: true },
  { key: "publishYear", header: "Publish Year", dropdown: true, setting: "publishYear" },
  { key: "publisher", header: "Publisher", setting: "publisher", exactOnly: true },
  { key: "sellerType", header: "Seller Type", dropdown: true, setting: "sellerType" },
  { key: "subGenre", header: "Sub Genre", dropdown: true, setting: "subGenre" },
  { key: "image1", header: "Image 1 (Front)" },
  { key: "image2", header: "Image 2", exactOnly: true },
  { key: "image3", header: "Image 3", exactOnly: true },
  { key: "image4", header: "Image 4", exactOnly: true },
  { key: "styleId", header: "Product ID / Style ID" },
  { key: "skuId", header: "SKU ID", exactOnly: true },
  { key: "brandName", header: "Brand Name", setting: "brandName", exactOnly: true },
  { key: "groupId", header: "Group ID" },
  { key: "description", header: "Product Description", setting: "description" },
  { key: "ean", header: "EAN/UPC", setting: "ean", exactOnly: true },
  { key: "author", header: "Author", setting: "author", exactOnly: true },
  { key: "brand", header: "Brand", dropdown: true, setting: "brand", exactOnly: true },
  { key: "edition", header: "Edition", setting: "edition", exactOnly: true },
  { key: "isbn", header: "ISBN", setting: "isbn", exactOnly: true },
];

// Tuned for CHIRAG BOOK CENTER's CBSE question-paper catalog.
export const DEFAULT_SETTINGS = {
  // where prices come from in the input sheet — column letters beat header names
  priceColumn: "P",
  mrpColumn: "Q",
  defectiveOffset: "13", // only used if the template doesn't compute it itself

  // weight
  weightPerBook: "400",
  weightSlabs: {}, // category → grams, overrides the per-book calculation

  // pages
  pagesMode: "auto", // auto = pagesPerBook × set size, snapped to a slab
  pagesPerBook: "250",
  pages: "201-300 Pages",

  // per-product attributes that can be derived from the title/SKU
  gradeMode: "auto",
  grade: "10",
  netQtyMode: "auto",
  netQty: "1",

  // catalog attributes
  variation: "Free Size",
  board: "CBSE",
  bookFormat: "Paperback",
  bookType: "Pre-owned",
  genericName: "CBSE Question Papers",
  genre: "Exam Preparation",
  subGenre: "Cbse Reference Textbooks",
  language: "English",
  publishYear: "2025",
  publisher: "MTG",
  sellerType: "Authorized Distributor",
  brand: "MTG",
  brandName: "MTG",
  author: "",
  edition: "",
  isbn: "",
  ean: "",
  description: "",

  // compliance
  gst: "0",
  hsn: "490110",
  inventory: "100",
  country: "India",
  mfgName: "CHIRAG BOOK CENTER",
  mfgAddr: "CHIRAG BOOK CENTER",
  mfgPin: "282007",
  packName: "CHIRAG BOOK CENTER",
  packAddr: "CHIRAG BOOK CENTER",
  packPin: "282007",
  impName: "Not Required",
  impAddr: "Not Required",
  impPin: "Not Required",
};

const pick = (row, letter, fallback) => {
  if (letter && row.cells[letter] !== undefined) {
    const n = parseFloat(String(row.cells[letter]).replace(/[^0-9.-]/g, ""));
    if (!isNaN(n)) return n;
  }
  return fallback;
};

/**
 * Build every template value for one product row.
 * @param {object} row      parsed input row
 * @param {object} settings
 * @param {number} index    0-based position, drives Group ID
 * @param {object} options  fieldKey → exact dropdown options from the template
 */
export function buildRow(row, settings, index, options = {}) {
  const out = {};
  const opt = (k) => options[k];

  const price = pick(row, settings.priceColumn, row.sellingPrice);
  const mrp = pick(row, settings.mrpColumn, row.mrp);
  const setSize = Math.max(1, row.setSize || 1);

  for (const f of FIELDS) {
    let v;
    switch (f.key) {
      case "productName":
      case "bookTitle":
        v = clampTitle(row.title);
        break;
      case "price":
        v = price ?? "";
        break;
      case "mrp":
        v = mrp ?? "";
        break;
      case "defective": {
        const off = parseFloat(settings.defectiveOffset) || 0;
        v = price == null ? "" : Math.max(0, price - off);
        break;
      }
      case "netWeight": {
        const slab = settings.weightSlabs?.[row.category];
        v = slab !== undefined && slab !== ""
          ? slab
          : (parseFloat(settings.weightPerBook) || 0) * setSize;
        break;
      }
      case "grade":
        v = settings.gradeMode === "auto" ? row.grade || settings.grade : settings.grade;
        break;
      case "netQty":
        v = settings.netQtyMode === "auto" ? String(setSize) : settings.netQty;
        break;
      case "pages":
        v = settings.pagesMode === "auto"
          ? pagesOption((parseFloat(settings.pagesPerBook) || 0) * setSize, opt("pages")) || settings.pages
          : settings.pages;
        break;
      case "image1":
        v = row.image;
        break;
      case "styleId":
      case "skuId":
        v = row.sku || row.title;
        break;
      case "brand":
      case "brandName":
      case "publisher":
        v = row.brand || settings[f.setting] || "";
        break;
      case "groupId":
        v = groupOption(index + 1, opt("groupId"));
        break;
      default:
        v = f.setting ? settings[f.setting] ?? "" : "";
    }
    if (f.dropdown && typeof v === "string") v = snapToOption(v, opt(f.key));
    out[f.key] = v;
  }
  return out;
}
