(()=>{(async function(){"use strict";if(!window.location.pathname.includes("preview_program")){alert("Run this script on a program page (preview_program.php)");return}let y=Array.from(document.querySelectorAll("a")).find(e=>e.textContent.trim()==="Core Program");if(!y){alert('Could not find "Core Program" link in sidebar navigation.');return}let j=y.getAttribute("href"),E=(document.querySelector("h1")||{}).textContent||"Program",a=[],h=[],s={name:"General",courses:[]},N=(()=>{let e=document.querySelectorAll("li");for(let o of e)if(/^[A-Z]{2,4}\s\d{3}/.test(o.textContent.trim()))return o.closest("table")||o.parentElement.parentElement;return document.body})(),w=document.createTreeWalker(N,NodeFilter.SHOW_ELEMENT),d=w.nextNode(),$=!1;for(;d;){let e=d.tagName,o=d.textContent.trim();if((e==="H1"||e==="H2"&&o.includes("Program Require"))&&($=!0),$&&((e==="H2"||e==="H3")&&!o.match(/^Total Semester/)&&o.length>2&&o.length<100&&(s.courses.length>0&&h.push(s),s={name:o,courses:[]}),e==="A")){let r=o.match(/^([A-Z]{2,4}\s\d{3}[A-Z]?)\s*-\s*(.+)/);if(r){let i=r[1],t=r[2];a.includes(i)||(a.push(i),s.courses.push({code:i,title:t}))}}d=w.nextNode()}s.courses.length>0&&h.push(s),console.log(`[CoreViz] ${a.length} program courses found`);let H=await(await fetch(j)).text(),b=new DOMParser().parseFromString(H,"text/html"),A=(()=>{let e=b.querySelector(".acalog-core");return e?e.parentElement:b.body})(),n=[],p={},v="",g="",l="",P=(e,o,r)=>r?`${e}||${o}||${r}`:`${e}||${o}`,C=b.createTreeWalker(A,NodeFilter.SHOW_ELEMENT),f=C.nextNode();for(;f;){let e=f.tagName,o=f.textContent.trim();if(e==="H2"&&o.length<80)v=o,l="";else if(e==="H3"&&o!=="Calvin University Core Program"&&o.length<80)g=o,l="";else if(e==="H4"&&o.length<80)l=o;else if(e==="A"&&v&&g){let r=o.match(/^([A-Z]{2,4}\s\d{3}[A-Z]?)/);if(r){let i=r[1],t=P(v,g,l);if(!p[t]){let x={major:v,sub:g,tag:l||null,courses:[]};p[t]=x,n.push(x)}p[t].courses.includes(i)||p[t].courses.push(i)}}f=C.nextNode()}console.log(`[CoreViz] ${n.length} core requirement sections parsed`);let k=new Set(a),T=new Set(a.map(e=>e.split(" ")[0]));for(let e of n)e.overlapping=e.courses.filter(o=>k.has(o)),e.prefixOverlapping=e.courses.filter(o=>T.has(o.split(" ")[0])&&!k.has(o));let m={};for(let e of a)m[e]=n.filter(o=>o.courses.includes(e)).map(o=>o.tag?`${o.sub} \u203A ${o.tag}`:o.sub);let z=document.getElementById("core-overlap-viz");z&&z.remove();let c=document.createElement("div");c.id="core-overlap-viz",c.innerHTML=`
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
  <h2>Core \u2194 ${E}</h2>
  <p>Showing how program courses overlap with Calvin Core requirements</p>
  <button id="cov-close" title="Close">\xD7</button>
  <button id="cov-minimize" title="Minimize">\u2500</button>
</div>
<div id="cov-tabs">
  <div class="cov-tab active" data-tab="summary">Summary</div>
  <div class="cov-tab" data-tab="core">Core View</div>
  <div class="cov-tab" data-tab="program">Program View</div>
</div>
<div id="cov-body"></div>`,document.body.appendChild(c);let q=c.querySelectorAll(".cov-tab"),u=c.querySelector("#cov-body");q.forEach(e=>e.addEventListener("click",()=>{q.forEach(o=>o.classList.remove("active")),e.classList.add("active"),L(e.dataset.tab)})),c.querySelector("#cov-close").onclick=()=>c.remove(),c.querySelector("#cov-minimize").onclick=()=>{let e=c.style.width==="42px";c.style.width=e?"520px":"42px",u.style.display=e?"":"none",c.querySelector("#cov-tabs").style.display=e?"":"none"};function L(e){({summary:S,core:M,program:O})[e]()}function S(){let e=n.filter(t=>t.overlapping.length>0),o=n.filter(t=>t.overlapping.length===0&&t.prefixOverlapping.length>0),r=n.filter(t=>t.overlapping.length===0&&t.prefixOverlapping.length===0),i=a.filter(t=>m[t].length>0);u.innerHTML=`
      <div class="cov-summary-grid">
        <div class="cov-stat green">
          <div class="num">${e.length}</div>
          <div class="label">Core areas with direct overlap</div>
        </div>
        <div class="cov-stat amber">
          <div class="num">${o.length}</div>
          <div class="label">Core areas with dept overlap</div>
        </div>
        <div class="cov-stat blue">
          <div class="num">${i.length} / ${a.length}</div>
          <div class="label">Program courses satisfying core</div>
        </div>
        <div class="cov-stat red">
          <div class="num">${r.length}</div>
          <div class="label">Core areas with no overlap</div>
        </div>
      </div>
      <div class="cov-legend">
        <div class="cov-legend-item"><div class="cov-legend-swatch" style="background:#e8f5e9;border-left:3px solid #2e7d32"></div> Direct match</div>
        <div class="cov-legend-item"><div class="cov-legend-swatch" style="background:#fff8e1;border-left:3px solid #f9a825"></div> Same dept</div>
        <div class="cov-legend-item"><div class="cov-legend-swatch" style="background:#fafafa;border-left:3px solid #ccc"></div> No overlap</div>
      </div>
      <div class="cov-major-label">Program courses that count toward Core</div>
      ${i.length>0?i.map(t=>`<div class="cov-req overlap">
                  <div class="cov-req-name">${t}</div>
                  <div class="cov-match-list">\u2192 ${m[t].join(", ")}</div>
                </div>`).join(""):'<div class="cov-req no-overlap"><div class="cov-req-name">No direct overlaps found</div></div>'}
      <div class="cov-major-label" style="margin-top:20px">Core areas not addressed by this program</div>
      ${r.map(t=>`<div class="cov-req no-overlap">
            <div class="cov-req-name">${t.tag?t.sub+" \u203A "+t.tag:t.sub}</div>
            <div class="cov-tag-label">${t.major}</div>
          </div>`).join("")}`}function M(){let e="",o="";for(let r of n){r.major!==o&&(e+=`<div class="cov-major-label">${r.major}</div>`,o=r.major);let i=r.overlapping.length>0?"overlap":r.prefixOverlapping.length>0?"prefix":"no-overlap",t=r.overlapping.length>0?"green":r.prefixOverlapping.length>0?"amber":"gray",x=r.tag?`${r.sub} \u203A ${r.tag}`:r.sub;e+=`<div class="cov-req ${i}">
        <div class="cov-req-name">${x}
          <span class="cov-count ${t}">${r.overlapping.length} / ${r.courses.length}</span>
        </div>
        ${r.overlapping.length>0?`<div class="cov-match-list">\u2713 ${r.overlapping.join(", ")}</div>`:""}
        ${r.prefixOverlapping.length>0?`<div class="cov-prefix-list">~ Same dept: ${r.prefixOverlapping.join(", ")}</div>`:""}
      </div>`}u.innerHTML=e}function O(){let e="";for(let o of h){e+=`<div class="cov-prog-section"><h4>${o.name}</h4>`;for(let r of o.courses){let i=m[r.code]||[];e+=`<div class="cov-prog-course ${i.length?"satisfies":""}">
          <div>
            <div class="cov-prog-code">${r.code}</div>
            <div style="font-size:11px;color:#555">${r.title}</div>
          </div>
          <div class="cov-prog-cores ${i.length===0?"none":""}">
            ${i.length>0?i.join("<br>"):"No core overlap"}
          </div>
        </div>`}e+="</div>"}u.innerHTML=e}S(),console.log(`[CoreViz] Loaded. ${a.length} program courses, ${n.length} core sections.`)})();})();
