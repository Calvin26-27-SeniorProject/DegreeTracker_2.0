// ═══════════════════════════════════════════════════════════════════
// Calvin Core ↔ Program Overlap Visualizer
// Run on any catalog.calvin.edu/preview_program.php page
// ═══════════════════════════════════════════════════════════════════
(async function coreOverlapVisualizer() {
  "use strict";

  // ── 0. Guard: must be on a program page ───────────────────────────
  if (!window.location.pathname.includes("preview_program")) {
    alert("Run this script on a program page (preview_program.php)");
    return;
  }

  // ── 1. Locate the Core Program page via sidebar link ──────────────
  const coreLinkEl = Array.from(document.querySelectorAll("a")).find(
    (a) => a.textContent.trim() === "Core Program"
  );
  if (!coreLinkEl) {
    alert('Could not find "Core Program" link in sidebar navigation.');
    return;
  }
  const coreUrl = coreLinkEl.getAttribute("href");

  // ── 2. Extract program courses from the current page ──────────────
  const programTitle =
    (document.querySelector("h1") || {}).textContent || "Program";
  const programCourses = []; // unique course codes
  const programSections = []; // [{name, courses:[{code,title}]}]
  let currentSection = { name: "General", courses: [] };

  // Find the container that holds the program's course list items
  const programContainer = (() => {
    const lis = document.querySelectorAll("li");
    for (const li of lis) {
      if (/^[A-Z]{2,4}\s\d{3}/.test(li.textContent.trim())) {
        return li.closest("table") || li.parentElement.parentElement;
      }
    }
    return document.body;
  })();

  // Walk the DOM in order to capture sections and courses
  const progWalker = document.createTreeWalker(
    programContainer,
    NodeFilter.SHOW_ELEMENT
  );
  let pNode = progWalker.nextNode();
  let foundFirst = false;

  while (pNode) {
    const tag = pNode.tagName;
    const text = pNode.textContent.trim();

    // Start collecting once we hit the program title or "Program Requirements"
    if (tag === "H1" || (tag === "H2" && text.includes("Program Require")))
      foundFirst = true;

    if (foundFirst) {
      // Section headings (H2 / H3)
      if (
        (tag === "H2" || tag === "H3") &&
        !text.match(/^Total Semester/) &&
        text.length > 2 &&
        text.length < 100
      ) {
        if (currentSection.courses.length > 0)
          programSections.push(currentSection);
        currentSection = { name: text, courses: [] };
      }
      // Course links (pattern: "DEPT 123 - Title")
      if (tag === "A") {
        const match = text.match(/^([A-Z]{2,4}\s\d{3}[A-Z]?)\s*-\s*(.+)/);
        if (match) {
          const code = match[1];
          const title = match[2];
          if (!programCourses.includes(code)) {
            programCourses.push(code);
            currentSection.courses.push({ code, title });
          }
        }
      }
    }
    pNode = progWalker.nextNode();
  }
  if (currentSection.courses.length > 0) programSections.push(currentSection);

  console.log(`[CoreViz] ${programCourses.length} program courses found`);

  // ── 3. Fetch & parse the Core Program page ────────────────────────
  const resp = await fetch(coreUrl);
  const html = await resp.text();
  const coreDoc = new DOMParser().parseFromString(html, "text/html");

  const coreParent = (() => {
    const el = coreDoc.querySelector(".acalog-core");
    return el ? el.parentElement : coreDoc.body;
  })();

  //  Structure:  H2 = major area  |  H3 = requirement  |  H4 = tag
  //              <a> with course-code text = course in that requirement
  const coreRequirements = []; // [{major, sub, tag?, courses:[code]}]
  const reqMap = {};
  let curMajor = "",
    curSub = "",
    curH4 = "";

  const key = (M, S, H) => (H ? `${M}||${S}||${H}` : `${M}||${S}`);

  const coreWalker = coreDoc.createTreeWalker(
    coreParent,
    NodeFilter.SHOW_ELEMENT
  );
  let cNode = coreWalker.nextNode();
  while (cNode) {
    const tag = cNode.tagName;
    const text = cNode.textContent.trim();
    if (tag === "H2" && text.length < 80) {
      curMajor = text;
      curH4 = "";
    } else if (
      tag === "H3" &&
      text !== "Calvin University Core Program" &&
      text.length < 80
    ) {
      curSub = text;
      curH4 = "";
    } else if (tag === "H4" && text.length < 80) {
      curH4 = text;
    } else if (tag === "A" && curMajor && curSub) {
      const m = text.match(/^([A-Z]{2,4}\s\d{3}[A-Z]?)/);
      if (m) {
        const code = m[1];
        const k = key(curMajor, curSub, curH4);
        if (!reqMap[k]) {
          const r = { major: curMajor, sub: curSub, tag: curH4 || null, courses: [] };
          reqMap[k] = r;
          coreRequirements.push(r);
        }
        if (!reqMap[k].courses.includes(code)) reqMap[k].courses.push(code);
      }
    }
    cNode = coreWalker.nextNode();
  }

  console.log(`[CoreViz] ${coreRequirements.length} core requirement sections parsed`);

  // ── 4. Compute overlaps ───────────────────────────────────────────
  const programSet = new Set(programCourses);
  const programPrefixes = new Set(programCourses.map((c) => c.split(" ")[0]));

  for (const req of coreRequirements) {
    req.overlapping = req.courses.filter((c) => programSet.has(c));
    req.prefixOverlapping = req.courses.filter((c) => {
      return programPrefixes.has(c.split(" ")[0]) && !programSet.has(c);
    });
  }

  // Reverse map: program course → core requirements it satisfies
  const courseToCore = {};
  for (const code of programCourses) {
    courseToCore[code] = coreRequirements
      .filter((r) => r.courses.includes(code))
      .map((r) => (r.tag ? `${r.sub} › ${r.tag}` : r.sub));
  }

  // ── 5. Render the panel ───────────────────────────────────────────
  const prev = document.getElementById("core-overlap-viz");
  if (prev) prev.remove();

  const panel = document.createElement("div");
  panel.id = "core-overlap-viz";
  panel.innerHTML = `
<style>
#core-overlap-viz{position:fixed;top:0;right:0;bottom:0;width:520px;z-index:99999;
  background:#fff;border-left:3px solid #8C2131;box-shadow:-4px 0 20px rgba(0,0,0,.25);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:13px;color:#1a1a1a;display:flex;flex-direction:column;overflow:hidden}
#cov-header{background:#8C2131;color:#fff;padding:14px 18px;flex-shrink:0}
#cov-header h2{margin:0 0 4px;font-size:16px;font-weight:700}
#cov-header p{margin:0;font-size:12px;opacity:.85}
#cov-tabs{display:flex;border-bottom:2px solid #eee;flex-shrink:0;background:#f8f8f8}
.cov-tab{flex:1;text-align:center;padding:10px 6px;cursor:pointer;font-weight:600;
  font-size:12px;border-bottom:3px solid transparent;transition:all .15s}
.cov-tab:hover{background:#f0e8e9}
.cov-tab.active{border-bottom-color:#8C2131;color:#8C2131}
#cov-body{flex:1;overflow-y:auto;padding:12px 16px}
.cov-major-label{font-size:11px;font-weight:700;text-transform:uppercase;
  letter-spacing:.8px;color:#8C2131;margin:16px 0 6px;padding-bottom:3px;
  border-bottom:1px solid #e0c8cb}
.cov-major-label:first-child{margin-top:4px}
.cov-req{margin:6px 0;padding:8px 10px;border-radius:6px;border-left:4px solid #ddd;background:#fafafa}
.cov-req.overlap{border-left-color:#2e7d32;background:#e8f5e9}
.cov-req.prefix{border-left-color:#f9a825;background:#fff8e1}
.cov-req.no-overlap{border-left-color:#ccc;background:#fafafa}
.cov-req-name{font-weight:600;font-size:13px;margin-bottom:3px}
.cov-tag-label{font-size:11px;color:#666;margin-bottom:3px}
.cov-match-list{font-size:11px;color:#2e7d32;margin-top:2px}
.cov-prefix-list{font-size:11px;color:#e65100;margin-top:2px}
.cov-count{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;
  margin-left:6px;font-weight:400}
.cov-count.green{background:#c8e6c9;color:#1b5e20}
.cov-count.amber{background:#fff3c4;color:#7c5e00}
.cov-count.gray{background:#eee;color:#666}
.cov-prog-section{margin:12px 0}
.cov-prog-section h4{font-size:12px;font-weight:700;color:#555;margin:0 0 6px;
  text-transform:uppercase;letter-spacing:.5px}
.cov-prog-course{padding:6px 10px;margin:4px 0;border-radius:5px;background:#f5f5f5;
  display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.cov-prog-course.satisfies{background:#e8f5e9}
.cov-prog-code{font-weight:700;font-size:12px;white-space:nowrap}
.cov-prog-cores{font-size:11px;color:#2e7d32;text-align:right;line-height:1.4}
.cov-prog-cores.none{color:#999}
.cov-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.cov-stat{background:#f5f5f5;border-radius:8px;padding:12px;text-align:center}
.cov-stat .num{font-size:28px;font-weight:800}
.cov-stat .label{font-size:11px;color:#666;margin-top:2px}
.cov-stat.green .num{color:#2e7d32}
.cov-stat.amber .num{color:#e65100}
.cov-stat.red .num{color:#8C2131}
.cov-stat.blue .num{color:#1565c0}
.cov-legend{display:flex;gap:12px;margin:10px 0;flex-wrap:wrap}
.cov-legend-item{display:flex;align-items:center;gap:4px;font-size:11px}
.cov-legend-swatch{width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.1)}
#cov-close{position:absolute;top:12px;right:14px;background:none;border:none;color:#fff;
  font-size:22px;cursor:pointer;line-height:1}
#cov-close:hover{opacity:.7}
#cov-minimize{position:absolute;top:12px;right:44px;background:none;border:none;color:#fff;
  font-size:18px;cursor:pointer;line-height:1}
#cov-minimize:hover{opacity:.7}
</style>

<div id="cov-header">
  <h2>Core ↔ ${programTitle}</h2>
  <p>Showing how program courses overlap with Calvin Core requirements</p>
  <button id="cov-close" title="Close">×</button>
  <button id="cov-minimize" title="Minimize">─</button>
</div>
<div id="cov-tabs">
  <div class="cov-tab active" data-tab="summary">Summary</div>
  <div class="cov-tab" data-tab="core">Core View</div>
  <div class="cov-tab" data-tab="program">Program View</div>
</div>
<div id="cov-body"></div>`;

  document.body.appendChild(panel);

  // ── Wiring ────────────────────────────────────────────────────────
  const tabs = panel.querySelectorAll(".cov-tab");
  const body = panel.querySelector("#cov-body");

  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      renderTab(t.dataset.tab);
    })
  );

  panel.querySelector("#cov-close").onclick = () => panel.remove();
  panel.querySelector("#cov-minimize").onclick = () => {
    const collapsed = panel.style.width === "42px";
    panel.style.width = collapsed ? "520px" : "42px";
    body.style.display = collapsed ? "" : "none";
    panel.querySelector("#cov-tabs").style.display = collapsed ? "" : "none";
  };

  // ── Tab renderers ─────────────────────────────────────────────────
  function renderTab(t) {
    ({ summary: renderSummary, core: renderCoreView, program: renderProgramView })[t]();
  }

  function renderSummary() {
    const direct = coreRequirements.filter((r) => r.overlapping.length > 0);
    const prefix = coreRequirements.filter(
      (r) => r.overlapping.length === 0 && r.prefixOverlapping.length > 0
    );
    const none = coreRequirements.filter(
      (r) => r.overlapping.length === 0 && r.prefixOverlapping.length === 0
    );
    const progWithCore = programCourses.filter(
      (c) => courseToCore[c].length > 0
    );

    body.innerHTML = `
      <div class="cov-summary-grid">
        <div class="cov-stat green">
          <div class="num">${direct.length}</div>
          <div class="label">Core areas with direct overlap</div>
        </div>
        <div class="cov-stat amber">
          <div class="num">${prefix.length}</div>
          <div class="label">Core areas with dept overlap</div>
        </div>
        <div class="cov-stat blue">
          <div class="num">${progWithCore.length} / ${programCourses.length}</div>
          <div class="label">Program courses satisfying core</div>
        </div>
        <div class="cov-stat red">
          <div class="num">${none.length}</div>
          <div class="label">Core areas with no overlap</div>
        </div>
      </div>
      <div class="cov-legend">
        <div class="cov-legend-item"><div class="cov-legend-swatch" style="background:#e8f5e9;border-left:3px solid #2e7d32"></div> Direct match</div>
        <div class="cov-legend-item"><div class="cov-legend-swatch" style="background:#fff8e1;border-left:3px solid #f9a825"></div> Same dept</div>
        <div class="cov-legend-item"><div class="cov-legend-swatch" style="background:#fafafa;border-left:3px solid #ccc"></div> No overlap</div>
      </div>
      <div class="cov-major-label">Program courses that count toward Core</div>
      ${
        progWithCore.length > 0
          ? progWithCore
              .map(
                (c) => `<div class="cov-req overlap">
                  <div class="cov-req-name">${c}</div>
                  <div class="cov-match-list">→ ${courseToCore[c].join(", ")}</div>
                </div>`
              )
              .join("")
          : '<div class="cov-req no-overlap"><div class="cov-req-name">No direct overlaps found</div></div>'
      }
      <div class="cov-major-label" style="margin-top:20px">Core areas not addressed by this program</div>
      ${none
        .map(
          (r) => `<div class="cov-req no-overlap">
            <div class="cov-req-name">${r.tag ? r.sub + " › " + r.tag : r.sub}</div>
            <div class="cov-tag-label">${r.major}</div>
          </div>`
        )
        .join("")}`;
  }

  function renderCoreView() {
    let h = "";
    let lastMajor = "";
    for (const req of coreRequirements) {
      if (req.major !== lastMajor) {
        h += `<div class="cov-major-label">${req.major}</div>`;
        lastMajor = req.major;
      }
      const cls =
        req.overlapping.length > 0
          ? "overlap"
          : req.prefixOverlapping.length > 0
          ? "prefix"
          : "no-overlap";
      const cc =
        req.overlapping.length > 0
          ? "green"
          : req.prefixOverlapping.length > 0
          ? "amber"
          : "gray";
      const label = req.tag ? `${req.sub} › ${req.tag}` : req.sub;
      h += `<div class="cov-req ${cls}">
        <div class="cov-req-name">${label}
          <span class="cov-count ${cc}">${req.overlapping.length} / ${req.courses.length}</span>
        </div>
        ${req.overlapping.length > 0 ? `<div class="cov-match-list">✓ ${req.overlapping.join(", ")}</div>` : ""}
        ${req.prefixOverlapping.length > 0 ? `<div class="cov-prefix-list">~ Same dept: ${req.prefixOverlapping.join(", ")}</div>` : ""}
      </div>`;
    }
    body.innerHTML = h;
  }

  function renderProgramView() {
    let h = "";
    for (const sec of programSections) {
      h += `<div class="cov-prog-section"><h4>${sec.name}</h4>`;
      for (const c of sec.courses) {
        const cores = courseToCore[c.code] || [];
        h += `<div class="cov-prog-course ${cores.length ? "satisfies" : ""}">
          <div>
            <div class="cov-prog-code">${c.code}</div>
            <div style="font-size:11px;color:#555">${c.title}</div>
          </div>
          <div class="cov-prog-cores ${cores.length === 0 ? "none" : ""}">
            ${cores.length > 0 ? cores.join("<br>") : "No core overlap"}
          </div>
        </div>`;
      }
      h += "</div>";
    }
    body.innerHTML = h;
  }

  renderSummary(); // initial view
  console.log(
    `[CoreViz] Loaded. ${programCourses.length} program courses, ${coreRequirements.length} core sections.`
  );
})();