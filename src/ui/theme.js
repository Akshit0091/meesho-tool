// ── design tokens (DARK MODE) ───────────────────────────────────────────────
// Token names keep their semantic role from light mode; values are remapped for
// dark. e.g. `ink` = primary text (now light), `surface` = card bg (now dark),
// `canvas` = app bg (darkest-but-one), sidebar is darker still.
export const ink = "#f1f5f9", ink2 = "#cbd5e1";        // primary / secondary text (light on dark)
export const slate = "#94a3b8", slate2 = "#64748b";     // muted / faint text
export const line = "#2a3344", line2 = "#222a38";       // borders / hairlines
export const surface = "#171c28", canvas = "#0d111a";   // card bg / app bg
export const sidebarBg = "#090c13", elevate = "#1e2433"; // sidebar / raised panels
export const accent = "#f43f7e", accentDark = "#e11d63"; // brightened pink for dark bg
export const accentSoft = "#3a1726", accentTint = "#241019"; // pink-tinted dark fills
export const ok = "#34d399", okSoft = "#10261f";        // green + dark green fill
export const amber = "#fbbf24", amberSoft = "#2a2010";  // amber + dark amber fill
export const danger = "#f87171", dangerSoft = "#2a1414"; // red + dark red fill
const mono = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const display = "'Space Grotesk', 'Inter', system-ui, sans-serif";
const body = "'Inter', system-ui, -apple-system, sans-serif";

export const CSS = `
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

export const S = {
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

  resetRow: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginBottom: 12 },
  resetNote: { fontSize: 11.5, color: slate2 },
  resetBtn: { background: "transparent", border: `1px solid ${line}`, color: ink2, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontFamily: body, fontWeight: 500, cursor: "pointer" },

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
