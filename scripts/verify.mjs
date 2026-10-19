#!/usr/bin/env node
// Checks a filled file against the template it came from, before you upload it.
//
//   node scripts/verify.mjs <template.xlsx> <filled.xlsx>
//
// Catches the failures that make Meesho reject an upload: stripped data
// validations, overwritten template formulas, dropdown values that aren't in
// the allowed list, and blank compulsory fields.

import fs from "node:fs";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { loadTemplate, colLetter, colIndex, HEADER_ROW, DATA_START_ROW } from "../src/lib/template.js";
import { FIELDS } from "../src/lib/fields.js";

const [templatePath, filledPath] = process.argv.slice(2);
if (!templatePath || !filledPath) {
  console.error("usage: node scripts/verify.mjs <template.xlsx> <filled.xlsx>");
  process.exit(1);
}

const read = (p) => new Uint8Array(fs.readFileSync(p));
const tplBytes = read(templatePath);
const outBytes = read(filledPath);

const tpl = await loadTemplate(tplBytes, FIELDS);
const tplZip = await JSZip.loadAsync(tplBytes);
const outZip = await JSZip.loadAsync(outBytes);

const problems = [];
const notes = [];
const ok = [];

// 1. same files in the archive
const tplEntries = Object.keys(tplZip.files).sort();
const outEntries = Object.keys(outZip.files).sort();
if (tplEntries.join("|") !== outEntries.join("|")) problems.push("archive contents differ from the template");
else ok.push(`archive intact (${outEntries.length} parts)`);

// 2. data validations survived
const tplXml = await tplZip.file(tpl.sheetPath).async("string");
const outXml = await outZip.file(tpl.sheetPath).async("string");
const count = (s) => (s.match(/<dataValidation[ >]/g) || []).length;
if (count(tplXml) !== count(outXml))
  problems.push(`data validations: template has ${count(tplXml)}, output has ${count(outXml)}`);
else ok.push(`${count(outXml)} data validations preserved`);

// 3. template formulas survived, and carry a cached result Meesho can read
let cached = 0;
for (const letter of tpl.formulaCols) {
  const re = new RegExp(`<c r="${letter}${DATA_START_ROW}"[^>]*>([\\s\\S]*?)</c>`);
  const m = outXml.match(re);
  const header = tpl.headerByCol[colIndex(letter)] || "?";
  if (!m || !m[1].includes("<f")) problems.push(`formula overwritten at ${letter}${DATA_START_ROW} (${header})`);
  else if (!m[1].includes("<v")) notes.push(`${letter} ${header}: formula kept but no cached value — Meesho may read it as blank`);
  else cached++;
}
if (!problems.some((p) => p.startsWith("formula")))
  ok.push(`${tpl.formulaCols.size} formula columns intact (${cached} with cached values)`);

// 4. cell values obey the template's dropdowns, and compulsory fields are filled
const outWb = XLSX.read(outBytes, { type: "array" });
const ws = outWb.Sheets[tpl.sheetName];
const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: "" });

// Row 2 marks each column "* Compulsory Field" / "Optional Field".
const requiredRow = grid[HEADER_ROW - 2] || [];
const headerRow = grid[HEADER_ROW - 1] || [];
const headerOf = (c) => String(headerRow[c] ?? "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || colLetter(c);

let filled = 0;
for (let r = DATA_START_ROW - 1; r < grid.length; r++) {
  const row = grid[r] || [];
  const name = String(row[tpl.colMap.productName] ?? "").trim();
  if (!name) continue;
  filled++;
  const rownum = r + 1;

  for (const f of FIELDS) {
    const c = tpl.colMap[f.key];
    if (c === undefined) continue;
    const letter = colLetter(c);
    if (tpl.formulaCols.has(letter)) continue;
    const value = String(row[c] ?? "").trim();

    const options = tpl.options[f.key];
    if (value && options && options.length && !options.includes(value))
      problems.push(`row ${rownum} ${letter} ${f.header}: "${value}" is not in the dropdown list`);

    const required = /compulsory/i.test(String(requiredRow[c] ?? ""));
    if (required && !value) problems.push(`row ${rownum} ${letter} ${headerOf(c)}: compulsory field is empty`);
  }

  const title = String(row[tpl.colMap.productName] ?? "");
  if (title.length > 200) problems.push(`row ${rownum}: Product Name is ${title.length} chars (max 200)`);
}
ok.push(`${filled} product rows checked`);

// Compulsory columns the template has but we never map
for (let c = 0; c < requiredRow.length; c++) {
  if (!/compulsory/i.test(String(requiredRow[c] ?? ""))) continue;
  const letter = colLetter(c);
  if (tpl.formulaCols.has(letter)) continue;
  const mapped = Object.values(tpl.colMap).includes(c);
  if (!mapped) notes.push(`${letter} ${headerOf(c)} is compulsory but no field maps to it`);
}

console.log("PASS");
for (const o of ok) console.log(`  ✓ ${o}`);
if (notes.length) {
  console.log("\nNOTES");
  for (const n of notes) console.log(`  · ${n}`);
}
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length})`);
  const shown = problems.slice(0, 40);
  for (const p of shown) console.log(`  ✗ ${p}`);
  if (problems.length > shown.length) console.log(`  … and ${problems.length - shown.length} more`);
  process.exit(1);
}
console.log("\nNo problems found.");
