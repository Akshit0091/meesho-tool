#!/usr/bin/env node
// Debug helper: compare the archive contents of two .xlsx files.
import JSZip from "jszip";
import fs from "node:fs";

const a = await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
const b = await JSZip.loadAsync(fs.readFileSync(process.argv[3]));
const ka = Object.keys(a.files).sort();
const kb = Object.keys(b.files).sort();
console.log("only in A:", ka.filter((k) => !kb.includes(k)));
console.log("only in B:", kb.filter((k) => !ka.includes(k)));
for (const k of ka.filter((k) => kb.includes(k))) {
  const x = await a.file(k).async("uint8array");
  const y = await b.file(k).async("uint8array");
  if (x.length !== y.length) console.log(`size differs: ${k}  ${x.length} -> ${y.length}`);
}
