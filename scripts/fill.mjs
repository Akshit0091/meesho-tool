#!/usr/bin/env node
// Headless version of the web app — same modules, same output.
//
//   node scripts/fill.mjs <template.xlsx> <input.xlsx> [out.xlsx] [settings.json]

import fs from "node:fs";
import path from "node:path";
import { loadTemplate, colLetter } from "../src/lib/template.js";
import { parseInput } from "../src/lib/input.js";
import { FIELDS, DEFAULT_SETTINGS, buildRow, withTemplate } from "../src/lib/fields.js";
import { fillTemplate } from "../src/lib/fill.js";

const [templatePath, inputPath, outPath = "Meesho_Bulk_Upload_Filled.xlsx", settingsPath] = process.argv.slice(2);

if (!templatePath || !inputPath) {
  console.error("usage: node scripts/fill.mjs <template.xlsx> <input.xlsx> [out.xlsx] [settings.json]");
  process.exit(1);
}

const read = (p) => new Uint8Array(fs.readFileSync(p));

const settings = {
  ...DEFAULT_SETTINGS,
  ...(settingsPath ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {}),
};

const tpl = await loadTemplate(read(templatePath), FIELDS);
const { rows } = parseInput(read(inputPath));

console.log(`template : ${path.basename(templatePath)}`);
console.log(`sheet    : ${tpl.sheetName}`);
console.log(`capacity : ${tpl.capacity} products (rows 5–${tpl.lastUsableRow})`);
console.log(`mapped   : ${Object.keys(tpl.colMap).length}/${FIELDS.length} fields`);
if (tpl.skipped.length)
  console.log(`formulas : kept → ${tpl.skipped.map((s) => `${s.letter} ${s.header}`).join(", ")}`);
if (tpl.unmatched.length) console.log(`unmatched: ${tpl.unmatched.join(", ")}`);
console.log(`input    : ${path.basename(inputPath)} → ${rows.length} products\n`);

// Show what the first product resolves to, so mistakes are visible before upload.
// withTemplate folds in anything the template dictates, so this preview
// matches what actually gets written.
const sample = buildRow(rows[0], withTemplate(settings, tpl), 0, tpl.options);
console.log("first product:");
for (const f of FIELDS) {
  const ci = tpl.colMap[f.key];
  if (ci === undefined) continue;
  const letter = colLetter(ci);
  const v = sample[f.key];
  if (v === "" || v == null) continue;
  const mark = tpl.formulaCols.has(letter) ? "   ← template formula kept, value cached" : "";
  console.log(`  ${letter.padEnd(3)} ${f.header.padEnd(32)} ${String(v).slice(0, 60)}${mark}`);
}

const { bytes, stats } = await fillTemplate(tpl, rows, settings, {});
fs.writeFileSync(outPath, Buffer.from(bytes));

console.log(
  `\nwrote ${stats.written} products, ${stats.cellsWritten} cells ` +
    `(${stats.formulaCellsKept} formula cells kept with cached values) → ${outPath}`
);
if (stats.overflow) console.error(`WARNING: ${stats.overflow} products did not fit and were dropped.`);
if (stats.missingRows.length) console.error(`WARNING: template has no row for ${stats.missingRows.join(", ")}`);
