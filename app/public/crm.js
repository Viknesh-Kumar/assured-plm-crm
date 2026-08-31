// CRM — dashboard, lead register, lead record with the stage engine, pipeline board, reports.
import {
  S, api, esc, fmtDate, fmtDT, money0, can, me, ICON, toast, errToast, openForm, openPanel, openMenu,
  confirmAction, dataTable, link, bar, statusBadge, refresh, go, render, setting, initials, crmRefresh
} from "./app.js";

const crm = () => S.crm || {};
const cdash = () => S.crmDash || {};
const BANDCLASS = { Lead: "", Qualified: "y", CSE: "v", Closed: "g" };
const bandBadge = b => b ? `<span class="badge ${BANDCLASS[b] ?? ""}">${esc(b)}</span>` : `<span class="badge">—</span>`;
const statusPill = s => s === "Won" ? `<span class="badge dot g">Won</span>`
  : s === "Lost" ? `<span class="badge dot r">Lost</span>` : `<span class="badge dot b">Open</span>`;
const nextMoveBadge = l => {
  if (l.next_move === "ready") return `<span class="badge g">ready</span>`;
  if (l.next_move === "blocked") return `<span class="badge">no pipeline</span>`;
  if (l.next_move === "terminal") return `<span class="badge v">terminal</span>`;
  if (l.next_move === "closed") return `<span class="badge n">closed</span>`;
  return `<span class="badge y">${esc(l.next_move)}</span>`;
};
const sourcePill = s => s === "Online" ? `<span class="badge t">Online</span>`
  : s === "Offline" ? `<span class="badge">Offline</span>` : `<span class="badge n">—</span>`;

const listOf = key => ({
  industry: crm().industries, customer_segment: crm().segments, offering: crm().offerings,
  channel: crm().channels, person: crm().people, content_type: crm().contentTypes,
  content_channel: crm().contentChannels,
  source: [{ id: "Online", name: "Online" }, { id: "Offline", name: "Offline" }]
}[key] || []);

const opts = (key, sel, blank = "— none —") => [
  { value: "", label: blank },
  ...listOf(key).filter(x => x.active !== 0 || String(sel) === String(x.id))
    .map(x => ({ value: x.id, label: x.name + (x.active === 0 ? " (inactive)" : "") }))
];

const wireRows = () => document.querySelectorAll("tr[data-row]").forEach(tr =>
  tr.addEventListener("click", e => { if (!e.target.closest("a,button,input,select")) go(tr.dataset.row); }));

const after = async msg => { await crmRefresh(); await render(); if (msg) toast("ok", msg); };

/* =================================================================== */
/* DASHBOARD                                                            */
/* =================================================================== */
export async function dashboard() {
  const d = cdash(), k = d.kpi || {};
  const maxBand = Math.max(1, ...(d.bands || []).map(b => b.n));
  const maxChan = Math.max(1, ...(d.channels || []).map(c => c.n));
  const kpi = (cls, key, value, meta, href) => `<div class="kpi ${cls} ${href ? "click" : ""}" ${href ? `data-goto="${href}"` : ""}>
    <div class="k">${esc(key)}</div><div class="v">${value}</div><div class="m">${esc(meta)}</div></div>`;

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--brand)">${ICON.chart}</div>
        <div><div class="eyebrow">CRM</div><h1>Home</h1>
          <div class="desc">Where the leads are, where they came from, and what is blocking the next move.
            The CRM records fact; the revenue projection workbook stays the planning instrument.</div></div>
        <div class="actions">
          <a class="btn" href="#/crm/reports/CRM-06">Blocked by field</a>
          ${can("crm.lead.manage") ? `<button class="btn brand" data-a="new-lead">${ICON.plus} New Lead</button>` : ""}
        </div>
      </div>

      ${(d.prompts || []).length ? `<div class="card" style="border-left:3px solid var(--warn-line)">
        <header><div class="ci" style="background:var(--warn-line)">${ICON.bell}</div>
          <h2>From Product Lifecycle — launch content needed</h2>
          <span class="sub">${d.prompts.length} product${d.prompts.length === 1 ? "" : "s"} entered Seeding</span>
          <div class="right"><a class="btn sm" href="#/crm/calendar">Open the calendar</a></div></header>
        <div class="body flush">${d.prompts.map(p => `
          <div class="rrow">
            <div class="ic" style="background:var(--warn-line)">${ICON.product}</div>
            <div class="b"><b>${esc(p.title)}</b><div class="m">${esc(p.detail || "")}</div></div>
            <div class="r">due ${fmtDate(p.due_date)}</div>
          </div>`).join("")}</div>
      </div>` : ""}

      <div class="kpis">
        ${kpi("", "Open leads", k.open ?? 0, `${k.total ?? 0} on file · ${k.lost ?? 0} lost`, "/crm/leads")}
        ${kpi("g", "Past qualification", k.past_qualification ?? 0, "Qualified, CSE and Closed", "/crm/reports/CRM-01")}
        ${kpi("", "Content attributed", k.attributed ?? 0, `${k.published ?? 0} items published`, "/crm/reports/CRM-03")}
        ${kpi(k.blocked ? "r" : "n", "Blocked from next stage", k.blocked ?? 0, "missing a required field", "/crm/reports/CRM-06")}
        ${kpi(k.unassigned ? "y" : "n", "No pipeline yet", k.unassigned ?? 0, "Offering and Industry both needed", "/crm/leads")}
        ${kpi("n", "Content items", k.content ?? 0, `${k.prompts ?? 0} launch prompt${k.prompts === 1 ? "" : "s"} open`, "/crm/calendar")}
      </div>

      <div class="split">
        <div>
          <div class="card">
            <header><div class="ci" style="background:var(--brand-darker)">${ICON.chart}</div><h2>Funnel by band</h2>
              <span class="sub">bands are fixed; stage names are configured per pipeline</span></header>
            <div class="body">
              <div class="dist">${(d.bands || []).map(b => `
                <div class="row"><span class="g"></span><span>${esc(b.band)}</span>
                  <span class="bar"><i style="width:${Math.round(b.n / maxBand * 100)}%;background:${
                    { Lead: "var(--ink-4)", Qualified: "var(--warn-line)", CSE: "var(--violet)", Closed: "var(--success)" }[b.band]
                  }"></i></span><span class="c">${b.n}</span></div>`).join("")}
                <div class="row" style="border-top:1px solid var(--line);padding-top:.375rem;margin-top:.25rem">
                  <span class="g"></span><span>Lost</span>
                  <span class="bar"><i style="width:${Math.round((d.lostCount || 0) / maxBand * 100)}%;background:var(--error)"></i></span>
                  <span class="c">${d.lostCount || 0}</span></div>
              </div>
              <p class="note" style="margin-top:.625rem">Loss is a status, not a stage — no process in the source workbook has a
                loss path. A lost lead keeps the stage it reached and leaves the funnel, which is what makes
                “we lose most of them at the CSE stage” answerable.</p>
            </div>
          </div>

          <div class="card">
            <header><div class="ci" style="background:var(--teal)">${ICON.chart}</div><h2>Leads by channel</h2>
              <span class="sub">Lead Source is derived from the channel</span>
              <div class="right"><a class="btn sm" href="#/crm/reports/CRM-02">Report</a></div></header>
            <div class="body"><div class="dist">${(d.channels || []).map(c => `
              <div class="row"><span class="g"></span><span>${esc(c.name)}</span>
                <span class="bar"><i style="width:${Math.round(c.n / maxChan * 100)}%;background:${
                  c.mode === "Online" ? "var(--teal)" : "var(--ink-4)"}"></i></span>
                <span class="c">${c.n}</span></div>`).join("") || `<div class="empty">No leads yet.</div>`}</div>
              <div class="pills" style="margin-top:.5rem">
                <span class="badge t">Online</span><span class="badge">Offline</span></div>
            </div>
          </div>

          <div class="card">
            <header><div class="ci" style="background:var(--error)">${ICON.clock}</div><h2>Blocked from the next stage</h2>
              <span class="sub">a mandatory field is not recorded</span></header>
            <div class="body flush">${dataTable({
              columns: [
                { label: "Company", cell: l => `<a href="#/crm/lead/${l.id}"><b>${esc(l.company)}</b></a>` },
                { label: "Stage", cell: l => esc(l.stage_name || "—") },
                { label: "Band", cell: l => bandBadge(l.stage_band) },
                { label: "Missing", cell: l => (l.missing || []).map(m => `<span class="badge y">${esc(m.label)}</span>`).join(" ") },
                { label: "Owner", cell: l => esc(l.owner_name || "—") }
              ], rows: d.blocked || [], onRow: l => `/crm/lead/${l.id}`,
              empty: "Nothing is blocked. Every open lead has what it needs for its next stage."
            })}</div>
          </div>
        </div>

        <div>
          <div class="card">
            <header><div class="ci" style="background:var(--violet)">${ICON.doc}</div><h2>Content that produced leads</h2></header>
            <div class="body flush">${(d.attributedLeads || []).length ? (d.attributedLeads).map(l => `
              <div class="rrow"><div class="ic" style="background:var(--violet)">${ICON.doc}</div>
                <div class="b"><b><a href="#/crm/lead/${l.id}">${esc(l.company)}</a></b>
                  <div class="m">${esc(l.primary_content_title || "—")}</div></div>
                <div class="r">${bandBadge(l.stage_band)}</div></div>`).join("")
              : `<div class="empty">No lead has been attributed to a content item yet.</div>`}</div>
          </div>

          <div class="card">
            <header><h2>Recent movement</h2><span class="sub">immutable history</span></header>
            <div class="body flush">${(d.recent || []).length ? d.recent.map(h => `
              <div class="rrow"><div class="ic" style="background:var(--brand)">${ICON.gate}</div>
                <div class="b"><b>${esc(h.company)}</b>
                  <div class="m">→ ${esc(h.stage_name_snapshot || "—")}${h.reason ? ` · ${esc(h.reason)}` : ""}</div></div>
                <div class="r">${fmtDT(h.at)}<br>${esc(h.actor_name || "")}</div></div>`).join("")
              : `<div class="empty">No movement recorded.</div>`}</div>
          </div>
        </div>
      </div></main>`,
    mount() {
      document.querySelectorAll("[data-goto]").forEach(el => el.onclick = () => go(el.dataset.goto));
      document.querySelector('[data-a="new-lead"]')?.addEventListener("click", newLead);
      wireRows();
    }
  };
}

/* =================================================================== */
/* LEAD REGISTER                                                        */
/* =================================================================== */
let leadFilter = { status: "open", band: "", offering: "", channel: "", owner: "", q: "" };

export async function leads() {
  const rows = await api("/crm/leads");
  const draw = () => {
    let r = rows.slice();
    const f = leadFilter;
    if (f.status === "open") r = r.filter(l => l.status === "Open");
    else if (f.status === "won") r = r.filter(l => l.status === "Won");
    else if (f.status === "lost") r = r.filter(l => l.status === "Lost");
    else if (f.status === "blocked") r = r.filter(l => !l.lost && (l.missing || []).length);
    else if (f.status === "nopipe") r = r.filter(l => !l.pipeline_id);
    if (f.band) r = r.filter(l => l.stage_band === f.band);
    if (f.offering) r = r.filter(l => String(l.offering_id) === f.offering);
    if (f.channel) r = r.filter(l => String(l.channel_id) === f.channel);
    if (f.owner) r = r.filter(l => String(l.owner_id) === f.owner);
    if (f.q) {
      const q = f.q.toLowerCase();
      r = r.filter(l => (l.company + " " + (l.customer || "") + " " + (l.email || "") + " " + (l.contact || ""))
        .toLowerCase().includes(q));
    }
    return r;
  };
  const table = list => dataTable({
    columns: [
      { label: "Company", cell: l => `<a href="#/crm/lead/${l.id}"><b>${esc(l.company)}</b></a>` },
      { label: "Contact", cell: l => l.customer ? `${esc(l.customer)}${l.designation ? `<br><span style="font-size:.6875rem;color:var(--ink-4)">${esc(l.designation)}</span>` : ""}` : "—" },
      { label: "Offering", cell: l => esc(l.offering_name || "—") },
      { label: "Industry", cell: l => esc(l.industry_name || "—") },
      { label: "Stage", cell: l => l.stage_name ? esc(l.stage_name) : `<span style="color:var(--ink-4)">unassigned</span>` },
      { label: "Band", cell: l => bandBadge(l.stage_band) },
      { label: "Status", cell: l => statusPill(l.status) },
      { label: "Channel", cell: l => esc(l.channel_name || "—") },
      { label: "Lead Source", cell: l => sourcePill(l.effective_source) },
      { label: "Owner", cell: l => esc(l.owner_name || "—") },
      { label: "Next move", cell: l => nextMoveBadge(l) }
    ], rows: list, onRow: l => `/crm/lead/${l.id}`,
    rowClass: l => l.lost ? "" : (l.missing || []).length ? "warn" : "",
    empty: "No lead matches this view."
  });
  const shown = draw();

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--brand)">${ICON.users}</div>
        <div><div class="eyebrow">CRM</div><h1>Leads</h1>
          <div class="desc">A lead can be logged with nothing but a company name. What it needs in order to move on
            is configuration, not code — see Setup → Requirement matrix.</div></div>
        <div class="actions">
          <a class="btn" href="/api/crm/reports/CRM-08?format=csv">Export history</a>
          ${can("crm.lead.manage") ? `<button class="btn brand" data-a="new-lead">${ICON.plus} New Lead</button>` : ""}
        </div>
      </div>
      <div class="card">
        <div class="lvhead">
          <select class="inp" id="fstatus" style="width:auto">
            ${[["open", "Open leads"], ["all", "All leads"], ["blocked", "Blocked"], ["nopipe", "No pipeline"],
               ["won", "Won"], ["lost", "Lost"]].map(([v, l]) =>
              `<option value="${v}" ${leadFilter.status === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
          <span class="count" id="lcount">${shown.length} lead${shown.length === 1 ? "" : "s"}</span>
          <span class="spacer"></span>
          <input class="inp" id="fq" type="search" placeholder="Search company or contact…" value="${esc(leadFilter.q)}" style="width:15rem">
        </div>
        <div class="filterbar">
          <select class="inp" id="fband" style="width:auto"><option value="">All bands</option>
            ${(crm().bands || []).map(b => `<option value="${b}" ${leadFilter.band === b ? "selected" : ""}>${b}</option>`).join("")}</select>
          <select class="inp" id="foffering" style="width:auto"><option value="">All offerings</option>
            ${(crm().offerings || []).map(o => `<option value="${o.id}" ${leadFilter.offering === String(o.id) ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>
          <select class="inp" id="fchannel" style="width:auto"><option value="">All channels</option>
            ${(crm().channels || []).map(c => `<option value="${c.id}" ${leadFilter.channel === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <select class="inp" id="fowner" style="width:auto"><option value="">All owners</option>
            ${(crm().people || []).map(p => `<option value="${p.id}" ${leadFilter.owner === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          <button class="chip" id="fclear">Clear filters</button>
          <span class="spacer"></span>
          <button class="btn sm" id="fexport">Export this list (CSV)</button>
        </div>
        <div class="body flush" id="lbody">${table(shown)}</div>
      </div></main>`,
    mount() {
      const redraw = () => {
        const list = draw();
        document.getElementById("lbody").innerHTML = table(list);
        document.getElementById("lcount").textContent = `${list.length} lead${list.length === 1 ? "" : "s"}`;
        wireRows();
      };
      const bind = (id, key) => document.getElementById(id).onchange = e => { leadFilter[key] = e.target.value; redraw(); };
      bind("fstatus", "status"); bind("fband", "band"); bind("foffering", "offering");
      bind("fchannel", "channel"); bind("fowner", "owner");
      document.getElementById("fq").oninput = e => { leadFilter.q = e.target.value; redraw(); };
      document.getElementById("fclear").onclick = () => {
        leadFilter = { status: "open", band: "", offering: "", channel: "", owner: "", q: "" }; render();
      };
      document.getElementById("fexport").onclick = () => exportLeads(draw());
      document.querySelector('[data-a="new-lead"]')?.addEventListener("click", newLead);
      wireRows();
    }
  };
}

function exportLeads(list) {
  const cols = ["Company", "Contact", "Designation", "Email", "Phone", "Offering", "Industry", "Customer Segment",
    "Stage", "Band", "Status", "Channel", "Lead Source", "Owner", "Next move", "Days at stage"];
  const cell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = list.map(l => [l.company, l.customer, l.designation, l.email, l.contact, l.offering_name,
    l.industry_name, l.segment_name, l.stage_name, l.stage_band, l.status, l.channel_name,
    l.effective_source, l.owner_name, l.next_move, l.days_at_stage]);
  const csv = "﻿" + [cols.join(","), ...rows.map(r => r.map(cell).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/** FR-01 — one action, company name alone. */
export function newLead() {
  openForm({
    title: "New Lead", size: "sm",
    rule: `<b>BR-01.</b> Company Name is the only field mandatory at creation. Everything else becomes mandatory
      at the stage your configuration says it does — not before.`,
    fields: [{ name: "company", label: "Name of the Company", required: true, cols: "full" }],
    submit: "Log lead",
    onSubmit: async d => {
      const l = await api("/crm/leads", { method: "POST", body: d });
      await crmRefresh(); toast("ok", `${l.company} logged.`); go(`/crm/lead/${l.id}`); await render();
    }
  });
}

/* =================================================================== */
/* LEAD RECORD                                                          */
/* =================================================================== */
let leadTab = "detail";

export async function lead(id) {
  let det;
  try { det = await api("/crm/leads/" + id); }
  catch (e) { return { html: `<main><div class="card"><div class="empty">${esc(e.message)}</div></div></main>` }; }
  const l = det.lead, stages = det.stages, req = det.requirements;
  const nextStage = stages.find(s => s.seq === (l.stage_seq || 0) + 1);
  const tabs = [["detail", "Details", null], ["content", "Content attribution", String(det.touches.length)],
    ["history", "History", String(det.history.length)], ["notes", "Notes", String(det.notes.length)]];
  if (!tabs.some(t => t[0] === leadTab)) leadTab = "detail";

  const path = stages.length ? `<div class="pathwrap">
    <div class="pathlbl"><span class="t">${esc(l.pipeline_name || "")}</span>
      <span class="d">${esc(l.template_name || "")} · ${esc(l.source_ref || "")} · gate at “${esc(l.gate_name || "—")}”</span></div>
    <div class="path">${stages.map(s => {
      const cls = l.stage_seq === s.seq ? "cur" : (l.stage_seq && s.seq < l.stage_seq) ? "done" : "";
      return `<button class="step ${cls} ${s.band === "Closed" && cls === "cur" ? "end" : ""}"
        data-move="${s.seq}" title="${esc(s.band)}${s.is_gate ? " · qualification gate" : ""}">
        <span class="n">${s.is_gate ? "◆" : String(s.seq).padStart(2, "0")}</span> ${esc(s.name)}</button>`;
    }).join("")}</div></div>`
    : `<div class="warnbox"><b>No pipeline.</b> A pipeline is derived from Offering × Industry (BR-04).
        Set both and the stages appear. Until then the lead is valid but cannot be moved.</div>`;

  const banner = l.lost
    ? `<div class="errbox"><b>Lost at “${esc(l.stage_name || "—")}” on ${fmtDate(l.lost_at)}.</b> ${esc(l.lost_reason || "")}</div>`
    : (l.missing || []).length
      ? `<div class="errbox"><b>Blocked from “${esc(nextStage?.name || "the next stage")}”.</b>
          These fields are configured as mandatory at or before that stage and are not recorded:
          <ul style="margin:.375rem 0 0 1rem">${l.missing.map(m =>
            `<li>${esc(m.label)}${m.conditional ? " <i>(required because Lead Source is Online)</i>" : ""}</li>`).join("")}</ul></div>`
      : nextStage
        ? `<div class="okbox"><b>Ready to move.</b> Every field mandatory at “${esc(nextStage.name)}” is recorded.</div>`
        : stages.length ? `<div class="infobox"><b>At the final stage.</b> There is nowhere further to move.</div>` : "";

  const body = { detail: () => detailTab(l, det), content: () => contentTab(l, det),
    history: () => historyTab(det), notes: () => notesTab(det) }[leadTab]();

  return {
    html: `<main>
      <div class="highlights">
        <div class="top">
          <div class="icon" style="background:${l.lost ? "var(--ink-4)" : "var(--brand)"}">${ICON.users}</div>
          <div style="min-width:0">
            <div class="eyebrow">Lead</div>
            <h1>${esc(l.company)} ${statusPill(l.status)} ${bandBadge(l.stage_band)}
              ${l.stage_is_gate ? `<span class="badge v">at the qualification gate</span>` : ""}</h1>
          </div>
          <div class="acts" id="lacts"></div>
        </div>
        <div class="hfields">
          <div class="f"><div class="k">Stage</div><div class="v">${esc(l.stage_name || "—")}</div></div>
          <div class="f"><div class="k">Days at stage</div><div class="v">${l.days_at_stage ?? "—"}</div></div>
          <div class="f"><div class="k">Offering</div><div class="v">${esc(l.offering_name || "—")}</div></div>
          <div class="f"><div class="k">Industry</div><div class="v">${esc(l.industry_name || "—")}</div></div>
          <div class="f"><div class="k">Channel</div><div class="v">${esc(l.channel_name || "—")}</div></div>
          <div class="f"><div class="k">Lead Source</div><div class="v">${sourcePill(l.effective_source)}
            ${l.source_override ? `<span class="badge y">overridden</span>` : ""}</div></div>
          <div class="f"><div class="k">Owner</div><div class="v">${esc(l.owner_name || "—")}</div></div>
          <div class="f"><div class="k">Next move</div><div class="v">${nextMoveBadge(l)}</div></div>
          <div class="f"><div class="k">Logged</div><div class="v">${fmtDate(l.created_at)}</div></div>
        </div>
      </div>
      ${path}
      ${banner}
      <div class="card">
        <div class="rtabs">${tabs.map(([k, t, n]) => `<button data-tab="${k}" aria-selected="${leadTab === k}">${esc(t)}${n ? `<span class="n">${esc(n)}</span>` : ""}</button>`).join("")}</div>
        <div class="body" id="ltabbody">${body}</div>
      </div></main>`,
    mount() {
      document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { leadTab = b.dataset.tab; render(); });
      leadActions(l, det, nextStage);
      document.querySelectorAll("[data-move]").forEach(b => b.onclick = () => attemptMove(l, Number(b.dataset.move), stages));
      wireLeadTab(l, det);
      wireRows();
    }
  };
}

function leadActions(l, det, nextStage) {
  const el = document.getElementById("lacts");
  const editable = can("crm.lead.manage");
  const btns = [];
  if (editable && !l.lost && nextStage)
    btns.push(`<button class="btn brand" data-a="next">Move to “${esc(nextStage.name)}” →</button>`);
  if (editable) btns.push(`<button class="btn" data-a="edit">Edit</button>`);
  if (editable) btns.push(l.lost
    ? `<button class="btn" data-a="reopen">Reopen</button>`
    : `<button class="btn danger" data-a="lost">Mark lost</button>`);
  btns.push(`<button class="btn icon" data-a="more">${ICON.down}</button>`);
  el.innerHTML = btns.join("");
  el.querySelector('[data-a="next"]')?.addEventListener("click", () => attemptMove(l, l.stage_seq + 1, det.stages));
  el.querySelector('[data-a="edit"]')?.addEventListener("click", () => editLead(l, det));
  el.querySelector('[data-a="lost"]')?.addEventListener("click", () => markLost(l));
  el.querySelector('[data-a="reopen"]')?.addEventListener("click", () => reopenLead(l));
  el.querySelector('[data-a="more"]').onclick = e => {
    const items = [];
    if (editable) items.push({ label: "Override Lead Source", onClick: () => overrideSource(l) });
    if (editable) items.push({ label: "Attach content", onClick: () => attachContent(l) });
    if (editable) items.push({ label: "Add a note", onClick: () => addNote(l) });
    items.push("-", { label: "Blocked-by-field report", onClick: () => go("/crm/reports/CRM-06") });
    openMenu(e.currentTarget, items);
  };
}

const dfield = (label, value, required, missing) => `<div class="dfield">
  <div class="k">${esc(label)}${required ? ` <span title="Mandatory at or before the current stage" style="color:var(--error)">✱</span>` : ""}</div>
  <div class="v ${value ? "" : "dim"}">${value || (missing
    ? `<span class="badge r">required — not recorded</span>` : "—")}</div></div>`;

function detailTab(l, det) {
  const req = det.requirements;
  const val = f => {
    switch (f.key) {
      case "company": return esc(l.company);
      case "industry": return esc(l.industry_name || "");
      case "segment": return esc(l.segment_name || "");
      case "offering": return esc(l.offering_name || "");
      case "channel": return esc(l.channel_name || "");
      case "owner": return esc(l.owner_name || "");
      case "source": return l.effective_source
        ? sourcePill(l.effective_source) + (l.source_override
          ? ` <span class="badge y">overridden</span>` : ` <span style="font-size:.6875rem;color:var(--ink-4)">derived from the channel</span>`) : "";
      case "content": return l.primary_content_id
        ? `<a href="#/crm/content/${l.primary_content_id}">${esc(l.primary_content_title || "content")}</a>` : "";
      case "email": return l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : "";
      default: return esc(l[f.key] ?? l.custom?.[f.key] ?? "");
    }
  };
  return `<div class="split">
    <div>
      <div class="card" style="margin:0"><header><h2>Lead detail</h2>
        <span class="sub">✱ marks a field mandatory at or before the current stage</span>
        ${can("crm.lead.manage") ? `<div class="right"><button class="btn sm" data-a="edit2">Edit</button></div>` : ""}</header>
        <div class="body"><div class="dgrid">${det.fields.map(f => {
          const r = req[f.key];
          const live = r && (r.level === 1 || l.effective_source === "Online");
          const v = val(f);
          return dfield(f.label, v, live, live && !v);
        }).join("")}</div></div>
      </div>
    </div>
    <div>
      <div class="card" style="margin:0 0 .75rem"><header><h2>Pipeline</h2></header>
        <div class="body">${l.pipeline_id ? `<dl class="kv">
          <dt>Pipeline</dt><dd>${esc(l.pipeline_name)}</dd>
          <dt>Stage template</dt><dd>${esc(l.template_name || "—")}</dd>
          <dt>Workbook source</dt><dd style="font-weight:400;color:var(--ink-4)">${esc(l.source_ref || "—")}</dd>
          <dt>Qualification gate</dt><dd>${esc(l.gate_name || "—")}</dd>
          <dt>Stage entered</dt><dd>${fmtDate(l.stage_entered_at)}</dd>
          <dt>Days at stage</dt><dd>${l.days_at_stage ?? "—"}</dd>
          <dt>Stage</dt><dd>${l.stage_seq} of ${l.stage_total}</dd>
        </dl>` : `<div class="empty">Set Offering and Industry to derive a pipeline (BR-04).</div>`}</div>
      </div>
      ${l.source_override ? `<div class="card" style="margin:0"><header><h2>Lead Source override</h2></header>
        <div class="body"><p class="note">${esc(l.source_override_reason || "")}</p>
        <p class="note" style="margin-top:.375rem;color:var(--ink-4)">Derived value from the channel:
          <b>${esc(l.channel_mode || "—")}</b>.</p>
        ${can("crm.lead.manage") ? `<button class="btn sm" data-a="clearoverride" style="margin-top:.5rem">Clear the override</button>` : ""}</div>
      </div>` : ""}
    </div>
  </div>`;
}

function contentTab(l, det) {
  return `<div class="card" style="margin:0">
    <header><div class="ci" style="background:var(--violet)">${ICON.doc}</div><h2>Content attribution</h2>
      <span class="sub">one primary; any number of contributing touches</span>
      ${can("crm.lead.manage") ? `<div class="right"><button class="btn sm brand" data-a="attach">Attach content</button></div>` : ""}</header>
    <div class="body flush">${det.touches.length ? det.touches.map(t => `
      <div class="rrow">
        <div class="ic" style="background:${t.colour || "var(--ink-4)"}">${ICON.doc}</div>
        <div class="b"><b><a href="#/crm/content/${t.content_id}">${esc(t.title)}</a></b>
          ${t.is_primary ? ` <span class="badge b">primary</span>` : ` <span class="badge">touch</span>`}
          <div class="m">${fmtDate(t.date)} · ${esc(t.type_name || "")} · ${esc(t.channel_name || "")} · ${esc(t.person_name || "")}
            · <span class="badge ${t.status === "Published" ? "g" : ""}">${esc(t.status)}</span></div></div>
        ${can("crm.lead.manage") ? `<div class="r">
          ${t.is_primary ? "" : `<button class="btn sm" data-primary="${t.content_id}">Make primary</button> `}
          <button class="btn sm danger" data-detach="${t.content_id}">Detach</button></div>` : ""}
      </div>`).join("") : `<div class="empty">No content attributed. A lead that surfaced after a year of posting
        did not come from one post — record the primary source and every contributing touch.</div>`}</div>
  </div>`;
}

const historyTab = det => `<div class="card" style="margin:0">
  <header><h2>Stage history</h2><span class="sub">append-only — a correction is a new row, never an edit (BR-24)</span></header>
  <div class="body"><div class="tl">${det.history.length ? det.history.map((h, i) => `
    <div class="item ${i === 0 ? "cur" : "done"} ${/lost/i.test(h.reason || "") ? "bad" : ""}">
      <div class="h"><b>${esc(h.stage_name_snapshot || "—")}</b>
        <span class="d">${fmtDT(h.at)} · ${esc(h.actor_name || "")}</span></div>
      <div class="m">${h.from_seq == null ? "Entered the pipeline" : `stage ${h.from_seq} → ${h.to_seq ?? "—"}`}${
        h.reason ? ` · ${esc(h.reason)}` : ""}</div>
    </div>`).join("") : `<div class="empty">No movement recorded.</div>`}</div></div>
</div>`;

const notesTab = det => `<div class="card" style="margin:0">
  <header><h2>Notes</h2><span class="sub">appended, attributed, never edited</span>
    ${can("crm.lead.manage") ? `<div class="right"><button class="btn sm brand" data-a="note">Add a note</button></div>` : ""}</header>
  <div class="body flush">${det.notes.length ? det.notes.map(n => `
    <div class="rrow"><span class="avatar">${esc(initials(n.author_name))}</span>
      <div class="b"><b>${esc(n.author_name || "—")}</b><div class="m">${esc(n.body)}</div></div>
      <div class="r">${fmtDT(n.at)}</div></div>`).join("") : `<div class="empty">No notes.</div>`}</div>
</div>`;

function wireLeadTab(l, det) {
  document.querySelector('[data-a="edit2"]')?.addEventListener("click", () => editLead(l, det));
  document.querySelector('[data-a="attach"]')?.addEventListener("click", () => attachContent(l));
  document.querySelector('[data-a="note"]')?.addEventListener("click", () => addNote(l));
  document.querySelector('[data-a="clearoverride"]')?.addEventListener("click", async () => {
    try { await api(`/crm/leads/${l.id}/source`, { method: "POST", body: { clear: true } }); await after("Override cleared."); }
    catch (e) { errToast(e); }
  });
  document.querySelectorAll("[data-detach]").forEach(b => b.onclick = async () => {
    try { await api(`/crm/leads/${l.id}/attach/${b.dataset.detach}`, { method: "DELETE" }); await after("Content detached."); }
    catch (e) { errToast(e); }
  });
  document.querySelectorAll("[data-primary]").forEach(b => b.onclick = async () => {
    try {
      await api(`/crm/leads/${l.id}/attach`, { method: "POST", body: { content_id: +b.dataset.primary, primary: true } });
      await after("Primary attribution set.");
    } catch (e) { errToast(e); }
  });
}

/* ---------------- lead actions ---------------- */
async function attemptMove(l, toSeq, stages) {
  const target = stages.find(s => s.seq === toSeq);
  if (!target) return;
  const back = l.stage_seq && toSeq < l.stage_seq;
  if (back || (crm().movement?.allowSkip && toSeq > l.stage_seq + 1)) {
    openForm({
      title: back ? `Move ${l.company} back to “${target.name}”` : `Move ${l.company} to “${target.name}”`,
      size: "sm", danger: back,
      rule: back ? `<b>BR-22.</b> Backward movement is recorded with a reason of at least
        ${crm().movement.reasonMin} characters. The move is written to history like any other.` : "",
      fields: [{ name: "reason", label: "Reason", type: "textarea", rows: 3, cols: "full",
        required: back && crm().movement.backReason, minlength: crm().movement.reasonMin }],
      submit: "Move",
      onSubmit: async d => {
        await api(`/crm/leads/${l.id}/move`, { method: "POST", body: { to_seq: toSeq, reason: d.reason } });
        await after(`Moved to “${target.name}”.`);
      }
    });
    return;
  }
  try {
    await api(`/crm/leads/${l.id}/move`, { method: "POST", body: { to_seq: toSeq } });
    await after(`Moved to “${target.name}”.`);
  } catch (e) {
    // FR-07 — the server decides; the record shows the refusal verbatim.
    openPanel({
      title: "The move was refused", size: "sm",
      html: `<div class="errbox" style="margin:0"><b>${esc(e.message)}</b></div>
        ${e.rule ? `<p class="note" style="margin-top:.625rem">Business rule <span class="mono">${esc(e.rule)}</span>.
          Which fields are mandatory at which stage is configuration — Setup → Requirement matrix.</p>` : ""}`
    });
    await after();
  }
}

function editLead(l, det) {
  const fields = det.fields.filter(f => !["source", "content"].includes(f.key)).map(f => {
    const base = { name: f.key, label: f.label, help: f.help || undefined };
    if (f.type === "list") return { ...base, type: "select", options: opts(f.list_source, l[f.key + "_id"] ?? l[f.key]),
      value: String(l[({ industry: "industry_id", segment: "segment_id", offering: "offering_id",
        channel: "channel_id", owner: "owner_id" }[f.key]) || f.key] ?? "") };
    if (f.key === "company") return { ...base, required: true, value: l.company, cols: "full" };
    const type = { number: "number", date: "date", phone: "tel", email: "email" }[f.type] || "text";
    return { ...base, type, value: l[f.key] ?? l.custom?.[f.key] ?? "" };
  });
  openForm({
    title: `Edit ${l.company}`, size: "lg",
    rule: `<b>BR-04.</b> Setting Offering and Industry derives the pipeline. Changing either re-derives it and places
      the lead at the same band on the new pipeline (BR-07). <b>BR-25</b> — the channel derives Lead Source.`,
    fields, submit: "Save",
    onSubmit: async d => {
      const r = await api(`/crm/leads/${l.id}`, { method: "PATCH", body: d });
      await after(r.lead.pipeline_id && !l.pipeline_id
        ? `Pipeline derived: ${r.lead.pipeline_name} at “${r.lead.stage_name}”.` : "Lead updated.");
    }
  });
}

const markLost = l => openForm({
  title: `Mark ${l.company} lost`, size: "sm", danger: true,
  rule: `<b>BR-28.</b> A lost lead keeps the stage it reached — that is what makes “we lose most of them at the
    CSE stage” a question the system can answer. It leaves the funnel and carries a mandatory reason.`,
  fields: [{ name: "reason", label: "Why was it lost?", type: "textarea", rows: 3, required: true,
    minlength: crm().movement?.reasonMin || 10, cols: "full" }],
  submit: "Mark lost",
  onSubmit: async d => { await api(`/crm/leads/${l.id}/lost`, { method: "POST", body: d }); await after("Lead marked lost."); }
});

const reopenLead = l => openForm({
  title: `Reopen ${l.company}`, size: "sm",
  rule: `<b>BR-29.</b> Reopening needs a reason. The loss stays in history — it is not erased.`,
  fields: [{ name: "reason", label: "Reason", type: "textarea", rows: 3, required: true,
    minlength: crm().movement?.reasonMin || 10, cols: "full" }],
  submit: "Reopen",
  onSubmit: async d => { await api(`/crm/leads/${l.id}/reopen`, { method: "POST", body: d }); await after("Lead reopened."); }
});

const overrideSource = l => openForm({
  title: "Override Lead Source", size: "sm",
  rule: `<b>BR-26.</b> The derived value stays visible alongside the override, and a later change of channel
    no longer re-derives it.`,
  intro: `Derived from the channel: <b>${esc(l.channel_mode || "not set")}</b>.`,
  fields: [
    { name: "source", label: "Lead Source", type: "select", required: true, cols: "full",
      options: [{ value: "Online", label: "Online" }, { value: "Offline", label: "Offline" }],
      value: l.effective_source || "" },
    { name: "reason", label: "Reason for the override", type: "textarea", rows: 3, required: true,
      minlength: crm().movement?.reasonMin || 10, cols: "full" }
  ],
  submit: "Override",
  onSubmit: async d => { await api(`/crm/leads/${l.id}/source`, { method: "POST", body: d }); await after("Lead Source overridden."); }
});

const addNote = l => openForm({
  title: "Add a note", size: "sm",
  fields: [{ name: "body", label: "Note", type: "textarea", rows: 4, required: true, cols: "full" }],
  submit: "Add note",
  onSubmit: async d => { await api(`/crm/leads/${l.id}/note`, { method: "POST", body: d }); await after("Note added."); }
});

async function attachContent(l) {
  const items = await api("/crm/content");
  openForm({
    title: `Attach content to ${l.company}`, size: "",
    rule: `<b>BR-33.</b> One primary attribution answers “where did this come from”. Every other item is a
      contributing touch. The primary is always also a touch.`,
    fields: [
      { name: "content_id", label: "Content item", type: "select", required: true, cols: "full",
        options: items.map(c => ({ value: c.id, label: `${c.date} — ${c.title} (${c.channel_name || "—"}, ${c.person_name || "—"})` })) },
      { name: "primary", label: "This is the primary attribution", type: "checkbox", cols: "full",
        checked: !l.primary_content_id }
    ],
    submit: "Attach",
    onSubmit: async d => { await api(`/crm/leads/${l.id}/attach`, { method: "POST", body: d }); await after("Content attached."); }
  });
}

/* =================================================================== */
/* PIPELINE BOARD                                                       */
/* =================================================================== */
let boardPipeline = null;

export async function board() {
  const pipes = crm().pipelines || [];
  if (!pipes.length) return { html: `<main><div class="card"><div class="empty">No pipeline is configured.</div></div></main>` };
  const p = pipes.find(x => x.id === boardPipeline) || pipes[0];
  boardPipeline = p.id;
  const all = await api("/crm/leads");
  const rows = all.filter(l => l.pipeline_id === p.id && !l.lost);

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--brand)">${ICON.gate}</div>
        <div><div class="eyebrow">CRM</div><h1>Pipeline Board</h1>
          <div class="desc">${esc(p.template_name || "")} · ${esc(p.source_ref || "")} · owner ${esc(p.owner_name || "—")}
            · gate at “${esc(p.gate_name || "—")}”. Dragging a card runs the same engine as the record page — a refused
            drag returns the card and shows why.</div></div>
        <div class="actions">
          <select class="inp" id="bpipe" style="width:auto">
            ${pipes.map(x => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)} — ${esc(x.industries.map(i => i.name).join(", "))}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="boardwrap"><div class="board">
        ${p.stages.map(s => {
          const cards = rows.filter(l => l.stage_seq === s.seq);
          return `<div class="bcol" data-seq="${s.seq}">
            <div class="bhead"><b>${esc(s.name)}</b>${s.is_gate ? `<span class="badge v">gate</span>` : ""}
              <span class="badge ${BANDCLASS[s.band] ?? ""}">${esc(s.band)}</span>
              <span class="n">${cards.length}</span></div>
            <div class="bbody" data-drop="${s.seq}">
              ${cards.map(l => `<div class="bcard ${(l.missing || []).length ? "warn" : ""}" draggable="true" data-lead="${l.id}">
                <b>${esc(l.company)}</b>
                <div class="m">${esc(l.customer || "—")}${l.designation ? ` · ${esc(l.designation)}` : ""}</div>
                <div class="m">${esc(l.channel_name || "no channel")} ${sourcePill(l.effective_source)}</div>
                ${l.primary_content_title ? `<div class="m">◆ ${esc(l.primary_content_title)}</div>` : ""}
                <div class="bfoot">${nextMoveBadge(l)}<span>${l.days_at_stage ?? 0}d</span></div>
              </div>`).join("") || `<div class="bempty">—</div>`}
            </div></div>`;
        }).join("")}
      </div></div></main>`,
    mount() {
      document.getElementById("bpipe").onchange = e => { boardPipeline = Number(e.target.value); render(); };
      document.querySelectorAll(".bcard").forEach(c => {
        c.addEventListener("click", e => { if (!e.target.closest("button")) go(`/crm/lead/${c.dataset.lead}`); });
        c.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", c.dataset.lead); c.classList.add("dragging"); });
        c.addEventListener("dragend", () => c.classList.remove("dragging"));
      });
      document.querySelectorAll("[data-drop]").forEach(z => {
        z.addEventListener("dragover", e => { e.preventDefault(); z.classList.add("over"); });
        z.addEventListener("dragleave", () => z.classList.remove("over"));
        z.addEventListener("drop", async e => {
          e.preventDefault(); z.classList.remove("over");
          const id = Number(e.dataTransfer.getData("text/plain"));
          const l = rows.find(x => x.id === id);
          if (!l) return;
          await attemptMove(l, Number(z.dataset.drop), p.stages);
        });
      });
    }
  };
}

/* =================================================================== */
/* REPORTS                                                              */
/* =================================================================== */
export async function reports() {
  const list = await api("/crm/reports");
  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--violet)">${ICON.doc}</div>
        <div><div class="eyebrow">CRM</div><h1>Reports</h1>
          <div class="desc">Descriptive only. The CRM holds no plan targets and produces no variance reporting —
            the revenue projection workbook stays the planning instrument.</div></div>
      </div>
      <div class="grid g3">${list.map(r => `<div class="card" style="margin:0">
        <header><div class="ci" style="background:var(--violet)">${ICON.doc}</div><h2>${esc(r.key)}</h2></header>
        <div class="body"><b style="font-size:.875rem">${esc(r.title)}</b>
          <p class="note" style="margin-top:.25rem">${esc(r.note)}</p></div>
        <div class="foot" style="display:flex;gap:.5rem;justify-content:center">
          <a class="btn sm brand" href="#/crm/reports/${r.key}">Open</a>
          <a class="btn sm" href="/api/crm/reports/${r.key}?format=csv">Export CSV</a></div>
      </div>`).join("")}</div></main>`
  };
}

export async function reportView(key) {
  let r;
  try { r = await api("/crm/reports/" + key); }
  catch (e) { return { html: `<main><div class="card"><div class="empty">${esc(e.message)}</div></div></main>` }; }
  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--violet)">${ICON.doc}</div>
        <div><div class="eyebrow">${esc(r.key)}</div><h1>${esc(r.title)}</h1><div class="desc">${esc(r.note)}</div></div>
        <div class="actions"><a class="btn" href="#/crm/reports">All reports</a>
          <a class="btn brand" href="/api/crm/reports/${r.key}?format=csv">Export CSV</a></div>
      </div>
      <div class="card"><div class="body flush">
        ${r.rows.length ? `<div class="tablewrap"><table class="dt">
          <thead><tr>${r.columns.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
          <tbody>${r.rows.map(row => `<tr>${r.columns.map(c => `<td>${esc(row[c.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>` : `<div class="empty">No rows yet.</div>`}
      </div><div class="foot">${r.rows.length} row${r.rows.length === 1 ? "" : "s"}</div></div></main>`
  };
}
