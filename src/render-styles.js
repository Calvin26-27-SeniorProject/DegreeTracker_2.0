// Visual customization for the catalog annotator lives here.
// Edit this file to change colors, spacing, typography, and panel layout.

export function annotatorStyles(colors) {
  return `
    .ca-badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px;
      font-weight:bold; margin-left:8px; vertical-align:middle; letter-spacing:0.3px; white-space:nowrap; }
    .ca-badge-complete { background:${colors.takenBg}; color:${colors.taken}; border:1px solid ${colors.taken}; }
    .ca-badge-incomplete { background:${colors.opportunityBg}; color:${colors.opportunity}; border:1px solid ${colors.opportunity}; }
    .ca-badge-satisfied { background:#eef4ff; color:#1f5fbf; border:1px solid #8fb2ef; }
    .ca-badge-optional { background:#f0f0f0; color:#666; border:1px solid #ccc; }
    .ca-course-taken { background:${colors.takenBg}!important; border-left:3px solid ${colors.taken}!important; padding-left:6px; }
    .ca-course-taken > a:first-of-type { color:${colors.taken}!important; font-weight:bold; }
    .ca-course-taken::after { content:attr(data-ca-note); font-size:11px; color:${colors.taken}; margin-left:8px; font-style:italic; }
    .ca-course-opportunity { border-left:3px solid ${colors.opportunity}!important; padding-left:6px; }
    .ca-course-double-count { background:${colors.doubleCountBg}!important; border-left:3px solid ${colors.doubleCount}!important; padding-left:6px; }
    .ca-course-double-count::after { content:attr(data-ca-note); font-size:11px; color:${colors.doubleCount}; margin-left:8px; font-weight:bold; }
    .ca-course-taken-multi { background:linear-gradient(90deg, ${colors.takenBg} 70%, ${colors.doubleCountBg})!important;
      border-left:3px solid ${colors.taken}!important; padding-left:6px; }
    .ca-course-taken-multi > a:first-of-type { color:${colors.taken}!important; font-weight:bold; }
    .ca-course-taken-multi::after { content:attr(data-ca-note); font-size:11px; color:${colors.taken}; margin-left:8px; font-style:italic; }
    .ca-course-planned { background:#fff7e9!important; border-left:3px solid #d97706!important; padding-left:6px; }
    .ca-course-planned > a:first-of-type { color:#9a5a00!important; font-weight:600; }
    .ca-course-planned::after { content:attr(data-ca-note); font-size:11px; color:#9a5a00; margin-left:8px; font-style:italic; }
    .ca-course-planned-multi { background:linear-gradient(90deg, #fff7e9 70%, ${colors.doubleCountBg})!important;
      border-left:3px solid #d97706!important; padding-left:6px; }
    .ca-course-planned-multi > a:first-of-type { color:#9a5a00!important; font-weight:600; }
    .ca-course-planned-multi::after { content:attr(data-ca-note); font-size:11px; color:#9a5a00; margin-left:8px; font-style:italic; }
    .ca-course-in-progress { background:${colors.inProgressBg}!important; border-left:3px solid ${colors.inProgress}!important; padding-left:6px; }
    .ca-course-in-progress > a:first-of-type { color:${colors.inProgress}!important; font-weight:bold; }
    .ca-course-in-progress::after { content:attr(data-ca-note); font-size:11px; color:${colors.inProgress}; margin-left:8px; font-style:italic; }
    .ca-course-transfer { background:${colors.transferBg}!important; border-left:3px solid ${colors.transfer}!important; padding-left:6px; }
    .ca-course-transfer > a:first-of-type { color:${colors.transfer}!important; font-weight:bold; }
    .ca-course-transfer::after { content:attr(data-ca-note); font-size:11px; color:${colors.transfer}; margin-left:8px; font-style:italic; }
    .ca-badge-in-progress { background:${colors.inProgressBg}; color:${colors.inProgress}; border:1px solid ${colors.inProgress}; }
    .ca-badge-exempt { background:#f0fdf4; color:#166534; border:1px solid #86efac; font-style:italic; }
    .ca-course-maxed { opacity:0.35; }
    .ca-plan-toggle { margin-left:8px; padding:1px 7px; border-radius:999px; border:1px solid #c67b00;
      background:#fff; color:#9a5a00; font-size:10px; font-weight:700; cursor:pointer; vertical-align:middle; }
    .ca-plan-toggle:hover { background:#fff6dd; }
    .ca-plan-toggle.ca-plan-toggle-on { background:#fff1cc; border-color:#b86d00; color:#7d4700; }
    .ca-category-complete { opacity:0.45; transition:opacity 0.2s; }
    .ca-category-complete:hover { opacity:1; }
    .ca-hours-note { font-size:11px; color:#555; margin:2px 0 6px 0; padding:3px 10px;
      background:#f8f8f0; border-radius:4px; display:block; border:1px solid #e0e0d0; line-height:1.5; }
    .ca-summary-panel { background:linear-gradient(135deg,#1a1a2e,#16213e); color:#e0e0e0;
      padding:18px 22px; border-radius:10px; margin:16px 0;
      font-family:system-ui,-apple-system,sans-serif; box-shadow:0 2px 12px rgba(0,0,0,0.15); }
    .ca-summary-panel h3 { color:#fff!important; margin:0 0 12px 0; font-size:16px; }
    .ca-summary-section-label { color:#fbbf24; font-size:11px; font-weight:bold; text-transform:uppercase;
      letter-spacing:0.5px; margin:14px 0 6px 0; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08); }
    .ca-summary-section-label:first-of-type { margin-top:8px; padding-top:0; border-top:none; }
    .ca-summary-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
    .ca-summary-grid-4 { grid-template-columns:1fr 1fr 1fr 1fr; }
    .ca-summary-item { background:rgba(255,255,255,0.08); padding:8px 12px; border-radius:6px; font-size:12px;
      cursor:pointer; transition:background 0.15s; text-decoration:none; display:block; }
    .ca-summary-item:hover { background:rgba(255,255,255,0.15); }
    .ca-summary-item .label { color:#aaa; font-size:11px; }
    .ca-summary-item .value { color:#fff; font-weight:bold; font-size:14px; }
    .ca-summary-item.complete .value { color:#4ade80; }
    .ca-summary-item.incomplete .value { color:#fbbf24; }
    .ca-summary-item.exempt .value { color:#86efac; font-style:italic; }
    .ca-summary-item.optional .value { color:#888; }
    .ca-summary-item .cap-note { color:#f87171; font-size:10px; }
    .ca-progress-bar { background:#2a2a3e; border-radius:8px; height:16px; overflow:hidden; position:relative; margin-top:4px; }
    .ca-progress-fill { height:100%; border-radius:8px; }
    .ca-progress-label { position:absolute; top:0; left:50%; transform:translateX(-50%);
      font-size:10px; font-weight:bold; line-height:16px; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.5); }
    .ca-legend { display:flex; gap:16px; flex-wrap:wrap; margin:10px 0 16px 0; font-size:12px;
      font-family:system-ui,-apple-system,sans-serif; padding:8px 12px;
      background:#fafafa; border:1px solid #e0e0e0; border-radius:6px; }
    .ca-legend-item { display:flex; align-items:center; gap:5px; }
    .ca-legend-swatch { width:14px; height:14px; border-radius:3px; border:1px solid rgba(0,0,0,0.15); }
    .ca-disclaimer { font-size:12px; color:#7a5c00; background:#fffbea; border:1px solid #e8d87a;
      border-radius:6px; padding:7px 12px; margin:10px 0 6px 0;
      font-family:system-ui,-apple-system,sans-serif; line-height:1.5; }
    .ca-ku-warning { font-size:13px; color:#7c2d12; background:#fff1e6; border:1px solid #f0a868;
      border-radius:6px; padding:8px 12px; margin:10px 0 6px 0;
      font-family:system-ui,-apple-system,sans-serif; line-height:1.5; }
    .ca-mismatch { font-size:13px; color:#7f1d1d; background:#fee2e2; border:2px solid #b91c1c; border-radius:6px; padding:10px 14px; margin:10px 0; }
    .ca-mismatch p { margin:8px 0 4px; font-weight:600; }
    .ca-mismatch textarea { width:100%; box-sizing:border-box; font:12px/1.4 monospace; }
    .ca-ku-warning ul { margin:4px 0 4px 18px; padding:0; }
    .ca-hours-note.ca-assumed-note { color:#7c2d12; background:#fff1e6; }
    .ca-transcript-section { font-family:system-ui,-apple-system,sans-serif; margin:24px 0 16px 0; }
    .ca-transcript-section h3 { font-size:14px; color:#333!important; margin:0 0 8px 0; }
    .ca-transcript-table { width:100%; border-collapse:collapse; font-size:12px; }
    .ca-transcript-table th { background:#f0f0f0; text-align:left; padding:4px 8px;
      border-bottom:2px solid #ccc; font-weight:bold; color:#333; }
    .ca-transcript-table td { padding:3px 8px; border-bottom:1px solid #eee; vertical-align:top; }
    .ca-transcript-table tr:hover td { background:#f9f9f9; }
    .ca-transcript-cats { color:#555; font-style:italic; }
    .ca-transcript-none { color:#bbb; font-style:italic; }
  `;
}

export const tocStyles = `
  #ca-toc { position:fixed; top:80px; right:0; z-index:10000; font-family:system-ui,-apple-system,sans-serif; }
  #ca-toc-toggle { position:absolute; top:0; right:0; width:36px; height:36px; border:1px solid #333; border-right:none;
    border-radius:6px 0 0 6px; background:#1a1a2e; color:#fff; font-size:18px; cursor:pointer;
    display:flex; align-items:center; justify-content:center; box-shadow:-2px 2px 8px rgba(0,0,0,0.15); z-index:2; }
  #ca-toc-toggle:hover { background:#16213e; }
  #ca-toc-panel { display:none; position:absolute; top:0; right:36px; width:240px; max-height:calc(100vh - 120px);
    overflow-y:auto; background:#1a1a2e; border-radius:8px 0 0 8px; box-shadow:-4px 4px 16px rgba(0,0,0,0.25); padding:8px 0; }
  .ca-toc-header { padding:8px 14px; font-size:13px; font-weight:bold; color:#fff;
    border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:4px; }
  .ca-toc-item { display:block; padding:4px 14px; font-size:12px; color:#ccc; text-decoration:none;
    border-left:3px solid transparent; transition:all 0.15s; line-height:1.3; cursor:pointer; }
  .ca-toc-item:hover { background:rgba(255,255,255,0.08); color:#fff; }
  .ca-toc-item.ca-toc-active { border-left-color:#fbbf24; color:#fff; background:rgba(255,255,255,0.05); font-weight:bold; }
  .ca-toc-cat { padding-left:24px; font-size:11px; }
  .ca-toc-tag { padding-left:32px; font-size:11px; font-style:italic; }
  .ca-toc-item:not(.ca-toc-cat):not(.ca-toc-tag) { font-weight:bold; font-size:11px; color:#fbbf24;
    text-transform:uppercase; letter-spacing:0.5px; margin-top:6px; padding-top:6px;
    border-top:1px solid rgba(255,255,255,0.06); }
  .ca-toc-status { font-size:9px; margin-left:4px; vertical-align:middle; }
  .ca-toc-status-done { color:#4ade80; }
  .ca-toc-status-needed { color:#fbbf24; }
  .ca-toc-status-satisfied { color:#8fb2ef; }
  .ca-toc-status-optional { color:#888; }
  #ca-toc-panel::-webkit-scrollbar { width:4px; }
  #ca-toc-panel::-webkit-scrollbar-track { background:transparent; }
  #ca-toc-panel::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.2); border-radius:2px; }
`;
