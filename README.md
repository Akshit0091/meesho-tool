# Meeshify — Meesho bulk upload converter

Turns a flat seller sheet into a filled-in Meesho category template, ready to
upload. Runs entirely in the browser; nothing is sent anywhere.

```bash
npm install
npm run dev        # http://localhost:5173
```

Or headless, which is the fastest way to produce a file:

```bash
node scripts/fill.mjs <template.xlsx> <input.xlsx> [out.xlsx] [settings.json]
node scripts/verify.mjs <template.xlsx> <out.xlsx>
```

Both paths share the same modules in `src/lib`, so they always agree.

## Why it patches XML instead of rewriting the workbook

Meesho's templates carry hundreds of data validations (the dropdown rules).
Every spreadsheet library drops them on write, and Meesho then rejects the
upload with **"Error reading file (5015)"**.

So the tool never rewrites the workbook. It opens the `.xlsx` as a zip, finds
the right worksheet XML through `workbook.xml` and its rels, patches individual
`<c>` cells, and re-zips. Every validation, style and structure byte of the
original file survives. `scripts/diffzip.mjs` shows that only
`sharedStrings.xml` and the one worksheet ever change.

Two details that matter:

- **Shared strings.** Text goes into `sharedStrings.xml` and is referenced by
  index (`t="s"`). Google Sheets renders inline strings as blank, so matching
  the template's own encoding is what makes the file readable everywhere.
- **Template formulas.** Some columns compute themselves — in the CBSE template
  `G` is `=IF(F5>13,F5-13,"")` and `R/S/T` are
  `=IF(K5="India","Not Required","")`. Overwriting them destroys the formula;
  leaving them alone means Meesho reads a blank, because a formula written by a
  tool carries no cached result. The tool keeps the formula **and** writes the
  computed value beside it, so Excel recalculates on open and Meesho reads the
  cached value.

## How fields are matched

Nothing is hardcoded to a column letter. At load time the tool reads the
template's own header row (row 3), fuzzy-matches each field in
`src/lib/fields.js` against it, and reads the exact dropdown options from the
range each list validation points at — so "Group ID" comes back as `Group  1`
with the two spaces Meesho actually expects, not a guess.

A field that doesn't exist in a given category template simply stays unfilled
and is reported as unmatched. That's how the same build handles both the
Olympiads and CBSE templates.

## What gets derived

The cataloger sheet leaves several columns blank, so the tool reads them out of
the title and SKU instead:

| Template field | Where it comes from |
| --- | --- |
| Grade | `Class 10th` in the title |
| Net Quantity | `Set of 4` in the SKU or title |
| Net Weight | weight-per-book × set size |
| Pages | pages-per-book × set size, snapped to a slab |
| Brand / Brand Name / Publisher | the sheet's `brand` column, else the default |
| Style ID + SKU ID | the `SKU ID` column |
| Group ID | row position, matched to the template's option text |

## Prices

The input sheet carries both the scraped Amazon figures and a computed pricing
block. In `Meesho SP.xlsx` those are:

| Column | Meaning |
| --- | --- |
| C / D | Selling Price / MRP as scraped from Amazon |
| N | discount % |
| O | `=D × (1 − N/100)` |
| P | `=O + 50 × (set size + 1)` — the Meesho price |
| Q | `=D + 500` — the MRP to declare |

**The defaults read prices from P and Q, not C and D.** Change that in the
Pricing panel (or `priceColumn` / `mrpColumn` in a settings JSON) if the
convention changes.

## Capacity

A template holds a fixed number of rows, and its dropdown validations often
stop short of the last physical row. The CBSE template holds **301 products**
(rows 5–305) even though rows run to 309. Products past that are reported, not
silently dropped — split the sheet and run it twice.

## Layout

```
src/lib/template.js   load a template: columns, dropdown options, formula cells, capacity
src/lib/input.js      parse the seller sheet, derive grade / set size
src/lib/fields.js     the field table, defaults, and per-row value rules
src/lib/fill.js       patch values into the sheet XML
src/ui/theme.js       design tokens and styles
src/App.jsx           the 4-step UI
scripts/fill.mjs      headless converter
scripts/verify.mjs    pre-upload checks: validations, formulas, dropdowns, compulsory fields
```

## Verifying before you upload

`scripts/verify.mjs` re-opens a generated file and checks it against the
template it came from:

- the archive still holds the same parts
- every data validation survived
- no template formula was overwritten, and each has a cached value
- every dropdown cell holds a value that's actually in its list
- no compulsory column is blank
- no Product Name over 200 characters
