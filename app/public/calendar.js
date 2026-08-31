// Content calendar — month grid and planning table over one dataset, the content record,
// and the launch prompts raised when a PLM product enters market state Seeding.
import {
  S, api, esc, fmtDate, fmtDT, can, ICON, toast, errToast, openForm, openPanel, confirmAction,
  dataTable, go, render, crmRefresh, initials
} from "./app.js";

const crm = () => S.crm || {};
const MON = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const STATUS_CLS = { Planned: "", Drafted: "y", Scheduled: "b", Published: "g" };
const todayISO = () => new Date().toISOString().slice(0, 10);

let cal = null;                       // {y, m} — 1-based month
let mode = "calendar";                // calendar | table
let filt = { person: "", channel: "", type: "", status: "" };

const after = async msg => { await crmRefresh(); await render(); if (msg) toast("ok", msg); };
const opt = (rows, sel, blank) => [...(blank ? [{ value: "", label: blank }] : []),
  ...rows.filter(r => r.active !== 0 || String(sel) === String(r.id)).map(r => ({ value: r.id, label: r.name }))];

export async function calendar() {
  if (!cal) { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  const [items, prompts] = await Promise.all([
    api(`/crm/content?y=${cal.y}&m=${cal.m}`),
    api("/crm/prompts?status=Open")
  ]);
  const shown = items.filter(c =>
    (!filt.person || String(c.person_id) === filt.person) &&
    (!filt.channel || String(c.channel_id) === filt.channel) &&
    (!filt.type || String(c.type_id) === filt.type) &&
    (!filt.status || c.status === filt.status));

  const first = new Date(Date.UTC(cal.y, cal.m - 1, 1));
  const pad = (first.getUTCDay() + 6) % 7;                 // Monday-first
  const dim = new Date(Date.UTC(cal.y, cal.m, 0)).getUTCDate();
  const byDay = {};
  shown.forEach(c => (byDay[Number(c.date.slice(8, 10))] ||= []).push(c));
  const promptsByDay = {};
  prompts.forEach(p => {
    if (p.due_date && p.due_date.slice(0, 7) === `${cal.y}-${String(cal.m).padStart(2, "0")}`)
      (promptsByDay[Number(p.due_date.slice(8, 10))] ||= []).push(p);
  });

  const grid = `<div class="cal">
    ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<div class="dow">${d}</div>`).join("")}
    ${Array.from({ length: pad }, () => `<div class="day pad"></div>`).join("")}
    ${Array.from({ length: dim }, (_, i) => i + 1).map(d => {
      const ds = `${cal.y}-${String(cal.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return `<div class="day ${ds === todayISO() ? "today" : ""}">
        <div class="n">${d}${can("crm.content.manage") ? `<button class="add" data-new="${ds}" title="Plan content">+</button>` : ""}</div>
        ${(promptsByDay[d] || []).map(p => `<div class="cev prompt" data-prompt="${p.id}" title="${esc(p.detail || "")}">
          <b>⚑ ${esc(p.title)}</b><span class="m">from Product Lifecycle — not yet planned</span></div>`).join("")}
        ${(byDay[d] || []).map(c => `<div class="cev" style="border-left-color:${c.colour || "var(--ink-4)"}" data-content="${c.id}">
          <b>${esc(c.title)}</b><span class="m">${esc(c.type_name || "")} · ${esc(c.person_name || "")}${
            c.lead_count ? ` · <b style="color:var(--brand)">${c.lead_count} lead${c.lead_count > 1 ? "s" : ""}</b>` : ""}</span></div>`).join("")}
      </div>`;
    }).join("")}
    ${Array.from({ length: (7 - ((pad + dim) % 7)) % 7 }, () => `<div class="day pad"></div>`).join("")}
  </div>
  <div class="pills" style="margin-top:.625rem;align-items:center">
    ${(crm().contentChannels || []).map(c => `<span class="badge"><i style="display:inline-block;width:.5rem;height:.5rem;border-radius:2px;background:${c.colour}"></i> ${esc(c.name)}</span>`).join("")}
    <span style="font-size:.6875rem;color:var(--ink-4)">A bold count is the number of leads attributed to that item.</span>
  </div>`;

  const table = dataTable({
    columns: [
      { label: "Date", cell: c => fmtDate(c.date) },
      { label: "Title", cell: c => `<a href="#/crm/content/${c.id}"><b>${esc(c.title)}</b></a>` },
      { label: "Content type", cell: c => `<span class="badge">${esc(c.type_name || "—")}</span>` },
      { label: "Channel", cell: c => esc(c.channel_name || "—") },
      { label: "Person", cell: c => esc(c.person_name || "—") },
      { label: "Offering", cell: c => esc(c.offering_name || "—") },
      { label: "Theme", cell: c => `<span class="trunc">${esc(c.theme || "")}</span>` },
      { label: "Status", cell: c => `<span class="badge ${STATUS_CLS[c.status] ?? ""}">${esc(c.status)}</span>` },
      { label: "Leads", align: "r", cell: c => c.lead_count || 0 }
    ], rows: shown, onRow: c => `/crm/content/${c.id}`,
    empty: "Nothing planned this month."
  });

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--violet)">${ICON.doc}</div>
        <div><div class="eyebrow">CRM</div><h1>Content Calendar</h1>
          <div class="desc">A planning table with a calendar view over it — one dataset, two views. Content types,
            channels and people are configurable lists.</div></div>
        <div class="actions">
          <div class="btngroup">
            <button class="btn ${mode === "calendar" ? "brand" : ""}" data-mode="calendar">Calendar</button>
            <button class="btn ${mode === "table" ? "brand" : ""}" data-mode="table">Table</button>
          </div>
          <div class="btngroup">
            <button class="btn" data-nav="-1">‹</button>
            <button class="btn" data-nav="0">${MON[cal.m - 1]} ${cal.y}</button>
            <button class="btn" data-nav="1">›</button>
          </div>
          <a class="btn" href="/api/crm/reports/CRM-07?format=csv">Export plan</a>
          ${can("crm.content.manage") ? `<button class="btn brand" data-new="${cal.y}-${String(cal.m).padStart(2, "0")}-01">${ICON.plus} Plan content</button>` : ""}
        </div>
      </div>

      ${prompts.length ? `<div class="card" style="border-left:3px solid var(--warn-line)">
        <header><div class="ci" style="background:var(--warn-line)">${ICON.bell}</div>
          <h2>Launch content needed</h2>
          <span class="sub">raised automatically when a product entered market state Seeding</span>
          <div class="right"><span class="badge y">${prompts.length}</span></div></header>
        <div class="body flush">${prompts.map(p => `
          <div class="rrow">
            <div class="ic" style="background:var(--warn-line)">${ICON.product}</div>
            <div class="b"><b>${esc(p.title)}</b>
              <div class="m">${esc(p.detail || "")}</div>
              <div class="m" style="color:var(--ink-4)">Suggested by ${fmtDate(p.due_date)}${
                p.product_code ? ` · ${esc(p.product_code)}` : ""}</div></div>
            ${can("crm.content.manage") ? `<div class="r">
              <button class="btn sm brand" data-plan="${p.id}">Plan it</button>
              <button class="btn sm" data-dismiss="${p.id}">Dismiss</button></div>` : ""}
          </div>`).join("")}</div>
        <div class="foot">A prompt is not a content item — date, title, type, channel and person are still required
          before anything is planned (BR-31).</div>
      </div>` : ""}

      <div class="card">
        <div class="filterbar">
          <select class="inp" id="fperson" style="width:auto"><option value="">All people</option>
            ${(crm().people || []).map(p => `<option value="${p.id}" ${filt.person === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          <select class="inp" id="fchannel" style="width:auto"><option value="">All channels</option>
            ${(crm().contentChannels || []).map(c => `<option value="${c.id}" ${filt.channel === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <select class="inp" id="ftype" style="width:auto"><option value="">All types</option>
            ${(crm().contentTypes || []).map(t => `<option value="${t.id}" ${filt.type === String(t.id) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
          <select class="inp" id="fstatus" style="width:auto"><option value="">Any status</option>
            ${["Planned", "Drafted", "Scheduled", "Published"].map(s => `<option value="${s}" ${filt.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <span class="count">${shown.length} of ${items.length} item${items.length === 1 ? "" : "s"} in ${MON[cal.m - 1]}</span>
        </div>
        <div class="body ${mode === "table" ? "flush" : ""}">${mode === "calendar" ? grid : table}</div>
      </div></main>`,
    mount() {
      document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); });
      document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
        const n = Number(b.dataset.nav);
        if (!n) { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth() + 1 }; }
        else { cal.m += n; if (cal.m < 1) { cal.m = 12; cal.y--; } if (cal.m > 12) { cal.m = 1; cal.y++; } }
        render();
      });
      ["person", "channel", "type", "status"].forEach(k =>
        document.getElementById("f" + k).onchange = e => { filt[k] = e.target.value; render(); });
      document.querySelectorAll("[data-new]").forEach(b => b.onclick = () => contentForm(null, b.dataset.new));
      document.querySelectorAll("[data-content]").forEach(el => el.onclick = () => go(`/crm/content/${el.dataset.content}`));
      document.querySelectorAll("[data-plan]").forEach(b => b.onclick = () => {
        const p = prompts.find(x => x.id === Number(b.dataset.plan));
        contentForm(null, p.due_date, p);
      });
      document.querySelectorAll("[data-prompt]").forEach(el => el.onclick = () => {
        const p = prompts.find(x => x.id === Number(el.dataset.prompt));
        openPanel({ title: p.title, size: "sm",
          html: `<p class="note">${esc(p.detail || "")}</p>
            <p class="note" style="margin-top:.5rem;color:var(--ink-4)">Suggested by ${fmtDate(p.due_date)}.</p>`,
          footer: can("crm.content.manage")
            ? `<button class="btn" data-close>Close</button><button class="btn brand" id="planit">Plan it</button>`
            : `<button class="btn" data-close>Close</button>` });
        document.getElementById("planit")?.addEventListener("click", () => {
          document.querySelector("dialog.modal")?.remove(); contentForm(null, p.due_date, p);
        });
      });
      document.querySelectorAll("[data-dismiss]").forEach(b => b.onclick = () => {
        const p = prompts.find(x => x.id === Number(b.dataset.dismiss));
        openForm({
          title: `Dismiss “${p.title}”`, size: "sm", danger: true,
          intro: "The prompt leaves the calendar. The product stays in Seeding either way.",
          fields: [{ name: "reason", label: "Why is no launch content needed?", type: "textarea", rows: 3,
            required: true, minlength: crm().movement?.reasonMin || 10, cols: "full" }],
          submit: "Dismiss prompt",
          onSubmit: async d => { await api(`/crm/prompts/${p.id}/dismiss`, { method: "POST", body: d }); await after("Prompt dismissed."); }
        });
      });
      document.querySelectorAll("tr[data-row]").forEach(tr =>
        tr.addEventListener("click", e => { if (!e.target.closest("a,button")) go(tr.dataset.row); }));
    }
  };
}

/** BR-31, BR-32 — the server refuses; this form just collects. */
export function contentForm(existing, date, prompt) {
  const c = existing || {};
  openForm({
    title: existing ? `Edit “${c.title}”` : "Plan content", size: "lg",
    rule: `<b>BR-31.</b> Date, title, type, channel and person are all required — without them the item cannot be
      planned or attributed. <b>BR-32</b> — an item dated in the future cannot be marked Published.`,
    intro: prompt ? `Raised from Product Lifecycle: ${esc(prompt.detail || "")}` : undefined,
    fields: [
      { name: "title", label: "Title", required: true, cols: "full",
        value: c.title || (prompt ? prompt.title.replace(/^Launch content — /, "") + " — launch announcement" : "") },
      { name: "date", label: "Date", type: "date", required: true, value: c.date || date || todayISO() },
      { name: "status", label: "Status", type: "select", value: c.status || "Planned",
        options: ["Planned", "Drafted", "Scheduled", "Published"].map(s => ({ value: s, label: s })) },
      { name: "type_id", label: "Content type", type: "select", required: true, value: String(c.type_id || ""),
        options: opt(crm().contentTypes || [], c.type_id, "— choose —") },
      { name: "channel_id", label: "Channel", type: "select", required: true, value: String(c.channel_id || ""),
        options: opt(crm().contentChannels || [], c.channel_id, "— choose —") },
      { name: "person_id", label: "Person", type: "select", required: true, value: String(c.person_id || ""),
        options: opt(crm().people || [], c.person_id, "— choose —"),
        help: "The same people list that owns leads — content and leads reconcile to one human being (Finding 7)." },
      { name: "offering_id", label: "Offering", type: "select", value: String(c.offering_id || ""),
        options: opt(crm().offerings || [], c.offering_id, "— none —") },
      { name: "industry_id", label: "Industry", type: "select", value: String(c.industry_id || ""),
        options: opt(crm().industries || [], c.industry_id, "— none —") },
      { name: "theme", label: "Theme", cols: "full", value: c.theme || (prompt ? "Product launch" : "") },
      { name: "url", label: "Link", cols: "full", value: c.url || "" }
    ],
    submit: existing ? "Save" : "Plan it",
    onSubmit: async d => {
      const body = { ...d, prompt_id: prompt?.id };
      const saved = existing
        ? await api(`/crm/content/${c.id}`, { method: "PATCH", body })
        : await api("/crm/content", { method: "POST", body });
      await after(existing ? "Content updated." : `“${saved.title}” planned for ${saved.date}.`);
    }
  });
}

/* ---------------- content record ---------------- */
export async function contentRecord(id) {
  let det;
  try { det = await api("/crm/content/" + id); }
  catch (e) { return { html: `<main><div class="card"><div class="empty">${esc(e.message)}</div></div></main>` }; }
  const c = det.content;
  return {
    html: `<main>
      <div class="highlights">
        <div class="top">
          <div class="icon" style="background:${c.colour || "var(--violet)"}">${ICON.doc}</div>
          <div style="min-width:0"><div class="eyebrow">Content</div>
            <h1>${esc(c.title)} <span class="badge ${STATUS_CLS[c.status] ?? ""}">${esc(c.status)}</span></h1></div>
          <div class="acts">
            <a class="btn" href="#/crm/calendar">← Calendar</a>
            ${can("crm.content.manage") ? `<button class="btn" data-a="edit">Edit</button>
              <button class="btn danger" data-a="del">Delete</button>` : ""}
          </div>
        </div>
        <div class="hfields">
          <div class="f"><div class="k">Date</div><div class="v">${fmtDate(c.date)}</div></div>
          <div class="f"><div class="k">Type</div><div class="v">${esc(c.type_name || "—")}</div></div>
          <div class="f"><div class="k">Channel</div><div class="v">${esc(c.channel_name || "—")}</div></div>
          <div class="f"><div class="k">Person</div><div class="v">${esc(c.person_name || "—")}</div></div>
          <div class="f"><div class="k">Offering</div><div class="v">${esc(c.offering_name || "—")}</div></div>
          <div class="f"><div class="k">Leads touched</div><div class="v">${c.lead_count}</div></div>
          <div class="f"><div class="k">Primary for</div><div class="v">${c.primary_count}</div></div>
        </div>
      </div>
      ${det.prompt ? `<div class="infobox"><b>Raised from Product Lifecycle.</b> ${esc(det.prompt.detail || "")}</div>` : ""}
      <div class="split">
        <div><div class="card" style="margin:0">
          <header><h2>Leads carrying this content</h2><span class="sub">${det.leads.length}</span></header>
          <div class="body flush">${dataTable({
            columns: [
              { label: "Company", cell: l => `<a href="#/crm/lead/${l.id}"><b>${esc(l.company)}</b></a>` },
              { label: "Attribution", cell: l => l.is_primary ? `<span class="badge b">primary</span>` : `<span class="badge">touch</span>` },
              { label: "Stage", cell: l => esc(l.stage_name || "—") },
              { label: "Band", cell: l => `<span class="badge">${esc(l.band || "—")}</span>` },
              { label: "Status", cell: l => l.lost ? `<span class="badge dot r">Lost</span>` : `<span class="badge dot b">Open</span>` }
            ], rows: det.leads, onRow: l => `/crm/lead/${l.id}`,
            empty: "No lead has been attributed to this item yet."
          })}</div>
        </div></div>
        <div><div class="card" style="margin:0"><header><h2>Detail</h2></header>
          <div class="body"><dl class="kv">
            <dt>Theme</dt><dd>${esc(c.theme || "—")}</dd>
            <dt>Industry</dt><dd>${esc(c.industry_name || "—")}</dd>
            <dt>Link</dt><dd>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noreferrer noopener">open</a>` : "—"}</dd>
            <dt>Created</dt><dd>${fmtDT(c.created_at)}</dd>
          </dl></div>
        </div></div>
      </div></main>`,
    mount() {
      document.querySelector('[data-a="edit"]')?.addEventListener("click", () => contentForm(c));
      document.querySelector('[data-a="del"]')?.addEventListener("click", () => confirmAction({
        title: `Delete “${c.title}”`, danger: true, submit: "Delete",
        body: "A content item attributed to any lead cannot be deleted — it is the record of where that lead came from (BR-34).",
        onConfirm: async () => {
          await api(`/crm/content/${c.id}`, { method: "DELETE" });
          await crmRefresh(); toast("ok", "Content deleted."); go("/crm/calendar"); await render();
        }
      }));
      document.querySelectorAll("tr[data-row]").forEach(tr =>
        tr.addEventListener("click", e => { if (!e.target.closest("a,button")) go(tr.dataset.row); }));
    }
  };
}
