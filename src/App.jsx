import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { loadTemplate, colLetter } from "./lib/template.js";
import { parseInput } from "./lib/input.js";
import { FIELDS, DEFAULT_SETTINGS, TITLE_MAX, buildRow } from "./lib/fields.js";
import { fillTemplate } from "./lib/fill.js";
import { CSS, S, amber } from "./ui/theme.js";

// ─────────────────────────────────────────────────────────────────────────────
// Meesho Bulk Upload Converter
//
// Reads a flat seller sheet and writes it into the official Meesho "Fill this"
// template. All the real work lives in src/lib — this file is the UI, and
// scripts/fill.mjs drives the same modules from the command line.
// ─────────────────────────────────────────────────────────────────────────────

const STORE_KEY = "meeshify.settings.v2";

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [input, setInput] = useState(null); // { rows, columns }
  const [sourceName, setSourceName] = useState("");
  const [tpl, setTpl] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [overrides, setOverrides] = useState({});
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState("upload");
  const srcRef = useRef(null);
  const tplRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch {
      /* private window — settings just won't persist */
    }
  }, [settings]);

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const rows = useMemo(() => input?.rows ?? [], [input]);
  const opt = useCallback((key) => tpl?.options?.[key] ?? [], [tpl]);

  const readFile = (file, onBytes) => {
    const reader = new FileReader();
    reader.onload = (e) => onBytes(new Uint8Array(e.target.result));
    reader.readAsArrayBuffer(file);
  };

  const handleSource = (file) => {
    setError("");
    setResult(null);
    readFile(file, (bytes) => {
      try {
        setInput(parseInput(bytes));
        setSourceName(file.name);
        setOverrides({});
      } catch (err) {
        setError("Input sheet: " + err.message);
        setInput(null);
        setSourceName("");
      }
    });
  };

  const handleTemplate = (file) => {
    setError("");
    setResult(null);
    readFile(file, async (bytes) => {
      try {
        const loaded = await loadTemplate(bytes, FIELDS);
        setTpl(loaded);
        setTemplateName(file.name);
        // snap any configured dropdown value that isn't valid for this template
        setSettings((s) => {
          const next = { ...s };
          for (const f of FIELDS) {
            const list = loaded.options[f.key];
            if (!f.setting || !list?.length) continue;
            if (!list.includes(next[f.setting])) next[f.setting] = list[0];
          }
          return next;
        });
      } catch (err) {
        setError("Template: " + err.message);
        setTpl(null);
        setTemplateName("");
      }
    });
  };

  const categories = useMemo(() => {
    const c = new Set();
    rows.forEach((r) => r.category && c.add(r.category));
    Object.keys(settings.weightSlabs || {}).forEach((k) => c.add(k));
    return [...c];
  }, [rows, settings.weightSlabs]);

  const preview = useMemo(
    () => rows.map((r, i) => ({ ...buildRow(r, settings, i, tpl?.options ?? {}), ...(overrides[i] || {}) })),
    [rows, settings, tpl, overrides]
  );

  const setOverride = (rowIdx, key, value) =>
    setOverrides((o) => ({ ...o, [rowIdx]: { ...(o[rowIdx] || {}), [key]: value } }));

  const generate = async () => {
    setError("");
    if (!tpl) return setError("Upload the blank Meesho template first.");
    if (!rows.length) return setError("Upload your product input sheet first.");
    setBusy(true);
    try {
      const { bytes, stats } = await fillTemplate(tpl, rows, settings, overrides);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Meesho_Bulk_Upload_Filled.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setResult(stats);
    } catch (err) {
      setError("Generation failed: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = rows.length > 0 && !!tpl;
  const mappedCount = tpl ? Object.keys(tpl.colMap).length : 0;
  const overCapacity = tpl ? Math.max(0, rows.length - tpl.capacity) : 0;
  const priceCols = input?.columns ?? [];

  const previewCols = ["productName", "styleId", "price", "mrp", "netWeight", "grade", "netQty", "pages", "image1", "groupId"];
  const editableCols = ["netWeight", "grade", "netQty", "pages"];

  const goto = (id) => {
    setActive(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const steps = [
    { id: "upload", n: "1", label: "Upload files", done: !!tpl && rows.length > 0 },
    { id: "config", n: "2", label: "Configure", done: !!tpl },
    { id: "preview", n: "3", label: "Review rows", done: rows.length > 0 },
    { id: "export", n: "4", label: "Export", done: !!result },
  ];

  // Keep the configured letter selectable even before an input sheet is loaded,
  // otherwise the select would show a fallback it isn't actually using.
  const colOptions = (extraLabel, current) => {
    const list = priceCols.filter((c) => c.numeric).map((c) => ({ v: c.letter, l: `${c.label} · e.g. ${c.sample}` }));
    if (current && !list.some((o) => o.v === current)) list.unshift({ v: current, l: `${current} (sheet not loaded)` });
    return [{ v: "", l: extraLabel }, ...list];
  };

  // Shorthand for a dropdown whose options come from the loaded template.
  const drop = (label, settingKey, fieldKey, hint) => (
    <DropField
      label={label}
      hint={hint}
      options={opt(fieldKey)}
      value={settings[settingKey] ?? ""}
      onChange={(v) => set(settingKey, v)}
    />
  );

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
            <button
              key={s.id}
              className="navitem"
              style={{ ...S.navItem, ...(active === s.id ? S.navItemActive : {}) }}
              onClick={() => goto(s.id)}
            >
              <span style={{ ...S.navDot, ...(s.done ? S.navDotDone : {}) }}>{s.done ? "✓" : s.n}</span>
              <span style={S.navLabel}>{s.label}</span>
            </button>
          ))}
        </nav>

        <div style={S.sideStatus}>
          <div style={S.sideStatusRow}>
            <span style={S.sideStatusLabel}>Input</span>
            <span style={{ ...S.pill, ...(rows.length ? S.pillOk : S.pillIdle) }}>
              {rows.length ? `${rows.length} rows` : "none"}
            </span>
          </div>
          <div style={S.sideStatusRow}>
            <span style={S.sideStatusLabel}>Template</span>
            <span style={{ ...S.pill, ...(tpl ? S.pillOk : S.pillIdle) }}>{tpl ? "loaded" : "none"}</span>
          </div>
          <div style={S.sideStatusRow}>
            <span style={S.sideStatusLabel}>Fields mapped</span>
            <span style={{ ...S.pill, ...(mappedCount ? S.pillOk : S.pillIdle) }}>{mappedCount || "—"}</span>
          </div>
          <div style={S.sideStatusRow}>
            <span style={S.sideStatusLabel}>Capacity</span>
            <span style={{ ...S.pill, ...(tpl ? (overCapacity ? S.pillIdle : S.pillOk) : S.pillIdle) }}>
              {tpl ? `${rows.length}/${tpl.capacity}` : "—"}
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
        <div style={S.topbar}>
          <div>
            <h1 style={S.pageTitle}>Convert to Meesho upload</h1>
            <p style={S.pageSub}>
              Map a seller sheet into the official template — dropdown rules and template formulas preserved.
            </p>
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
                sub="Title · SKU · Price · MRP · Category · Images"
                fileName={sourceName}
                meta={rows.length ? `${rows.length} products parsed` : null}
                onPick={() => srcRef.current?.click()}
              />
              <input
                ref={srcRef}
                type="file"
                accept=".xlsx,.xls"
                hidden
                onChange={(e) => e.target.files[0] && handleSource(e.target.files[0])}
              />
              <UploadCard
                kind="template"
                title="Meesho template"
                sub={tpl ? `Sheet: ${tpl.sheetName}` : `Any category template with a "…Fill this" sheet`}
                fileName={templateName}
                meta={tpl ? `${mappedCount} fields mapped · holds ${tpl.capacity} products` : null}
                onPick={() => tplRef.current?.click()}
              />
              <input
                ref={tplRef}
                type="file"
                accept=".xlsx"
                hidden
                onChange={(e) => e.target.files[0] && handleTemplate(e.target.files[0])}
              />
            </div>

            <div style={S.infoStrip}>
              <span style={S.infoStripIcon}>◆</span>
              <span>
                The template's structure — every dropdown rule and validation — is kept byte-for-byte. Columns the
                template computes itself keep their formula; we only cache the result alongside it.
              </span>
            </div>

            {tpl?.skipped?.length > 0 && (
              <div style={S.infoStrip}>
                <span style={S.infoStripIcon}>ƒ</span>
                <span>
                  <b>Template formulas kept:</b> {tpl.skipped.map((s) => `${s.letter} ${s.header}`).join(", ")}.
                </span>
              </div>
            )}

            {overCapacity > 0 && (
              <div style={S.warnStrip}>
                <span style={S.warnIcon}>!</span>
                <span>
                  <b>{overCapacity} products won't fit.</b> This template holds {tpl.capacity} (rows 5–{tpl.lastUsableRow}).
                  Split the input sheet and run it twice.
                </span>
              </div>
            )}

            {tpl?.unmatched?.length > 0 && (
              <div style={S.warnStrip}>
                <span style={S.warnIcon}>!</span>
                <span>
                  <b>
                    {tpl.unmatched.length} field{tpl.unmatched.length > 1 ? "s" : ""} not in this template
                  </b>{" "}
                  and will stay blank: {tpl.unmatched.join(", ")}.
                </span>
              </div>
            )}
          </section>

          {/* ── STEP 2: CONFIGURE ── */}
          <section id="sec-config" style={S.section}>
            <SectionHead
              n="2"
              title="Defaults & rules"
              desc={tpl ? "Dropdowns are populated from your uploaded template." : "Upload a template to load its exact dropdown options."}
            />

            <Panel title="Pricing" accent badge={settings.priceColumn || settings.mrpColumn ? "by column" : "by header"}>
              <div style={S.grid3}>
                <Field label="Meesho Price from" hint="Pick a computed column, or leave blank to use the Selling Price header">
                  <Select
                    value={settings.priceColumn}
                    onChange={(v) => set("priceColumn", v)}
                    options={colOptions("— use 'Selling Price' column —", settings.priceColumn)}
                  />
                </Field>
                <Field label="MRP from" hint="Leave blank to use the MRP header">
                  <Select value={settings.mrpColumn} onChange={(v) => set("mrpColumn", v)} options={colOptions("— use 'MRP' column —", settings.mrpColumn)} />
                </Field>
                <Field label="Defective price" hint="Only used when the template doesn't compute it">
                  <div style={S.inputAffix}>
                    <span style={S.affix}>− ₹</span>
                    <input style={S.affixInput} value={settings.defectiveOffset} onChange={(e) => set("defectiveOffset", e.target.value)} />
                  </div>
                </Field>
              </div>
            </Panel>

            <Panel title="Weight & pages" accent>
              <div style={S.grid3}>
                <Field label="Weight per book" hint="Multiplied by the set size">
                  <div style={S.inputAffix}>
                    <input style={S.affixInput} value={settings.weightPerBook} onChange={(e) => set("weightPerBook", e.target.value)} />
                    <span style={S.affix}>g</span>
                  </div>
                </Field>
                <Field label="Pages" hint="Auto picks the slab for pages × set size">
                  <Select
                    value={settings.pagesMode}
                    onChange={(v) => set("pagesMode", v)}
                    options={[
                      { v: "auto", l: "Auto — from set size" },
                      { v: "fixed", l: "Fixed — same for every row" },
                    ]}
                  />
                </Field>
                {settings.pagesMode === "auto" ? (
                  <Field label="Pages per book">
                    <input style={S.input} value={settings.pagesPerBook} onChange={(e) => set("pagesPerBook", e.target.value)} />
                  </Field>
                ) : (
                  drop("Pages", "pages", "pages")
                )}
              </div>
            </Panel>

            <Panel title="Read from each product" badge="auto">
              <div style={S.grid3}>
                <Field label="Grade" hint='Auto reads "Class 10th" from the title'>
                  <Select
                    value={settings.gradeMode}
                    onChange={(v) => set("gradeMode", v)}
                    options={[
                      { v: "auto", l: "Auto — from title" },
                      { v: "fixed", l: "Fixed for every row" },
                    ]}
                  />
                </Field>
                {settings.gradeMode === "fixed" && drop("Grade value", "grade", "grade")}
                <Field label="Net Quantity" hint='Auto reads "Set of 4" from the SKU or title'>
                  <Select
                    value={settings.netQtyMode}
                    onChange={(v) => set("netQtyMode", v)}
                    options={[
                      { v: "auto", l: "Auto — from set size" },
                      { v: "fixed", l: "Fixed for every row" },
                    ]}
                  />
                </Field>
                {settings.netQtyMode === "fixed" && drop("Net Quantity value", "netQty", "netQty")}
              </div>
            </Panel>

            {categories.length > 0 && (
              <Panel title="Net weight by category" collapsible defaultOpen={false}>
                <div style={S.grid4}>
                  {categories.map((cat) => (
                    <Field key={cat} label={cat}>
                      <Select
                        value={settings.weightSlabs[cat] ?? ""}
                        onChange={(v) => set("weightSlabs", { ...settings.weightSlabs, [cat]: v })}
                        options={[
                          { v: "", l: "— per-book × set size —" },
                          ...["250", "500", "750", "1000", "1250", "1500", "2000"].map((w) => ({ v: w, l: `${w} g` })),
                        ]}
                      />
                    </Field>
                  ))}
                </div>
                <p style={S.panelNote}>A slab here overrides the per-book calculation for that category.</p>
              </Panel>
            )}

            <Panel title="Catalog attributes" badge={tpl ? "from template" : "defaults"}>
              <div style={S.grid4}>
                {drop("Board", "board", "board")}
                {drop("Format", "bookFormat", "bookFormat")}
                {drop("Generic Name", "genericName", "genericName")}
                {drop("Genre", "genre", "genre")}
                {drop("Sub Genre", "subGenre", "subGenre")}
                {drop("Language", "language", "language")}
                {drop("Publish Year", "publishYear", "publishYear")}
                {drop("Seller Type", "sellerType", "sellerType")}
                {drop("Brand", "brand", "brand")}
                <Field label="Brand Name" hint="Free text column">
                  <input style={S.input} value={settings.brandName} onChange={(e) => set("brandName", e.target.value)} />
                </Field>
                <Field label="Publisher">
                  <input style={S.input} value={settings.publisher} onChange={(e) => set("publisher", e.target.value)} />
                </Field>
                {drop("Variation", "variation", "variation")}
              </div>
              <p style={S.panelNote}>
                Brand, Brand Name and Publisher fall back to these when the input sheet has no <code>brand</code> value for a row.
              </p>
            </Panel>

            <Panel title="Book details" collapsible defaultOpen={false}>
              <div style={S.grid4}>
                <Field label="Author">
                  <input style={S.input} value={settings.author} onChange={(e) => set("author", e.target.value)} />
                </Field>
                <Field label="Edition">
                  <input style={S.input} value={settings.edition} onChange={(e) => set("edition", e.target.value)} />
                </Field>
                <Field label="ISBN">
                  <input style={S.input} value={settings.isbn} onChange={(e) => set("isbn", e.target.value)} />
                </Field>
                <Field label="EAN/UPC">
                  <input style={S.input} value={settings.ean} onChange={(e) => set("ean", e.target.value)} />
                </Field>
                <Field label="Product Description">
                  <input style={S.input} value={settings.description} onChange={(e) => set("description", e.target.value)} />
                </Field>
                {drop("Book Type", "bookType", "bookType")}
              </div>
            </Panel>

            <Panel title="Compliance" collapsible defaultOpen={false}>
              <div style={S.grid4}>
                {[
                  ["GST %", "gst"],
                  ["HSN ID", "hsn"],
                  ["Inventory", "inventory"],
                  ["Manufacturer name", "mfgName"],
                  ["Manufacturer address", "mfgAddr"],
                  ["Manufacturer pincode", "mfgPin"],
                  ["Packer name", "packName"],
                  ["Packer address", "packAddr"],
                  ["Packer pincode", "packPin"],
                  ["Importer name", "impName"],
                  ["Importer address", "impAddr"],
                  ["Importer pincode", "impPin"],
                ].map(([label, key]) => (
                  <Field key={key} label={label}>
                    <input style={S.input} value={settings[key]} onChange={(e) => set(key, e.target.value)} />
                  </Field>
                ))}
                {drop("Country", "country", "country")}
              </div>
            </Panel>
          </section>

          {/* ── STEP 3: PREVIEW ── */}
          <section id="sec-preview" style={S.section}>
            <SectionHead
              n="3"
              title="Review rows"
              desc={rows.length ? "Highlighted cells are editable per row." : "Upload a product sheet to preview the mapped rows."}
            />
            {rows.length === 0 ? (
              <div style={S.emptyState}>
                <div style={S.emptyIcon}>▦</div>
                <div style={S.emptyTitle}>No products yet</div>
                <div style={S.emptyDesc}>Upload your product sheet in step 1 and the mapped rows will appear here.</div>
              </div>
            ) : (
              <div style={S.tableCard}>
                <div style={S.tableTop}>
                  <span style={S.tableCount}>{rows.length} products</span>
                  <span style={S.tableLegend}>
                    <span style={S.legendSwatch} /> editable
                  </span>
                </div>
                <div style={S.tableWrap}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.thNum}>#</th>
                        {previewCols.map((k) => {
                          const f = FIELDS.find((x) => x.key === k);
                          const c = tpl?.colMap?.[k];
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
                            const list = opt(k);
                            const editable = editableCols.includes(k);
                            const wasClamped = k === "productName" && String(rows[i]?.title || "").length > TITLE_MAX;
                            return (
                              <td
                                key={k}
                                style={S.td}
                                title={
                                  wasClamped
                                    ? `Original was ${String(rows[i].title).length} chars — trimmed to ${TITLE_MAX}`
                                    : String(row[k] ?? "")
                                }
                              >
                                {editable && list.length ? (
                                  <select style={S.cellInput} value={row[k] ?? ""} onChange={(e) => setOverride(i, k, e.target.value)}>
                                    {list.map((o) => (
                                      <option key={o}>{o}</option>
                                    ))}
                                  </select>
                                ) : editable ? (
                                  <input style={S.cellInput} value={row[k] ?? ""} onChange={(e) => setOverride(i, k, e.target.value)} />
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
                <ChecklistItem ok={rows.length > 0} label="Product sheet loaded" detail={rows.length ? `${rows.length} rows` : "required"} />
                <ChecklistItem ok={!!tpl} label="Template loaded" detail={tpl ? tpl.sheetName : "required"} />
                <ChecklistItem ok={mappedCount > 0} label="Columns mapped" detail={mappedCount ? `${mappedCount} fields` : "—"} />
                <ChecklistItem
                  ok={!!tpl && overCapacity === 0}
                  warn={overCapacity > 0}
                  label="Fits the template"
                  detail={tpl ? (overCapacity ? `${overCapacity} over` : `${rows.length}/${tpl.capacity}`) : "—"}
                />
                <ChecklistItem
                  ok={!!tpl}
                  label="Formulas protected"
                  detail={tpl ? `${tpl.skipped.length} columns` : "—"}
                />
              </div>
              <div style={S.exportAction}>
                {error && (
                  <div style={S.errorBox}>
                    <span style={S.errIcon}>×</span>
                    {error}
                  </div>
                )}
                {result && !error && (
                  <div style={S.successBox}>
                    <span style={S.okIcon}>✓</span>
                    Wrote {result.written} products ({result.cellsWritten} cells) — validations and formulas intact.
                  </div>
                )}
                <button
                  style={{ ...S.exportBtn, ...(ready && !busy ? {} : S.exportBtnOff) }}
                  onClick={generate}
                  disabled={!ready || busy}
                >
                  {busy ? (
                    <>
                      <span className="spin" style={S.spinner} />
                      Generating…
                    </>
                  ) : (
                    <>
                      Generate filled template <span style={S.btnArrow}>↓</span>
                    </>
                  )}
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
      <div style={S.panelHead} onClick={collapsible ? () => setOpen((o) => !o) : undefined} role={collapsible ? "button" : undefined}>
        <span style={S.panelTitle}>{title}</span>
        {badge && <span style={S.panelBadge}>{badge}</span>}
        {collapsible && <span style={S.panelChev}>{open ? "−" : "+"}</span>}
      </div>
      {open && <div style={S.panelBody}>{children}</div>}
    </div>
  );
}

// A setting backed by a template dropdown — falls back to free text when no
// template is loaded yet, so the defaults stay editable.
function DropField({ label, hint, options, value, onChange }) {
  return (
    <Field label={label} hint={hint}>
      {options.length ? (
        <Select value={value} onChange={onChange} options={options.map((o) => ({ v: o, l: o }))} />
      ) : (
        <input style={S.input} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
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
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
      <span style={S.selectChev}>▾</span>
    </div>
  );
}

function ChecklistItem({ ok, warn, label, detail }) {
  const tone = ok ? "ok" : warn ? "warn" : "idle";
  return (
    <div style={S.checkItem}>
      <span
        style={{
          ...S.checkMark,
          ...(tone === "ok" ? S.checkMarkOk : tone === "warn" ? S.checkMarkWarn : S.checkMarkIdle),
        }}
      >
        {ok ? "✓" : warn ? "!" : "○"}
      </span>
      <span style={S.checkLabel}>{label}</span>
      <span style={{ ...S.checkDetail, ...(tone === "warn" ? { color: amber } : {}) }}>{detail}</span>
    </div>
  );
}
