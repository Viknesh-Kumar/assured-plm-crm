// Home, Products register, Product record, Gate reviews, Market track, Reports.
import {
  S, api, esc, fmtDate, fmtDT, money, money0, days, can, me, hasRole, stageList, stageById, roleName,
  ICON, toast, errToast, openForm, openPanel, openMenu, confirmAction, dataTable, link, productLink, bar,
  pathComponent, statusBadge, trackBadge, refresh, go, render, setting, initials, closeModal
} from "./app.js";

const pct = n => Math.round((n || 0) * 100) + "%";
const dash = () => S.dash || {};
const productById = id => S.products.find(p => p.id === id);
const userOptions = (sel, blank) => [
  ...(blank ? [{ value: "", label: blank }] : []),
  ...S.boot.users.filter(u => u.active).map(u => ({ value: u.id, label: `${u.name}${u.roles ? " — " + u.roles : ""}` }))
].map(o => ({ ...o, value: String(o.value) })).map(o => ({ ...o, selected: String(sel) === o.value }));

const thisMonth = () => new Date().toISOString().slice(0, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);

/* =================================================================== */
/* HOME                                                                 */
/* =================================================================== */
export async function home() {
  const d = dash(), k = d.kpi || {};
  const kpi = (cls, key, value, meta, href) => `<div class="kpi ${cls} ${href ? "click" : ""}" ${href ? `data-goto="${href}"` : ""}>
    <div class="k">${esc(key)}</div><div class="v">${value}</div><div class="m">${esc(meta)}</div></div>`;

  const dist = (track, rows) => `<div class="dist">
    <div class="hdr">${track === "development" ? "Development — eight gates, each approved" : "Market — six states, none approved"}</div>
    ${rows.map(s => {
      const max = Math.max(1, ...d.distribution.map(x => x.count));
      return `<div class="row ${s.track === "market" ? "mkt" : ""} ${s.seq === 6 && s.track === "market" ? "end" : ""} ${s.count ? "" : "zero"}">
        <span class="g">${s.track === "development" ? String(s.seq).padStart(2, "0") : "—"}</span>
        <span>${esc(s.name)}</span>
        <span class="bar"><i style="width:${Math.round(s.count / max * 100)}%"></i></span>
        <span class="c">${s.count}</span></div>`;
    }).join("")}</div>`;

  const exceptionsTable = dataTable({
    columns: [
      { label: "Product", cell: p => productLink(p) },
      { label: "Position", cell: p => `${esc(p.stage_name)}${p.track === "market" ? " " + trackBadge(p.track) : ""}` },
      { label: "Status", cell: p => statusBadge(p.status) },
      { label: "Why", cell: p => whyBadges(p) },
      { label: "In stage", align: "r", cell: p => `${p.age_days} wd${p.ageing_days ? ` <span style="color:var(--ink-4)">/ ${p.ageing_days}</span>` : ""}` },
      { label: "Effort", align: "r", cell: p => days(p.effort) },
      { label: "Owner", cell: p => esc(p.owner_name || "—") },
      { label: "Escalates to", cell: p => esc(p.escalate_role || "—") }
    ],
    rows: d.exceptions || [], onRow: p => `/product/${p.id}`,
    rowClass: p => p.badly_stalled ? "bad" : p.stalled ? "warn" : "",
    empty: "No product is stalled, overdue, parked or in rework. "
  });

  const queueCard = (title, list, note, render) => `<div class="card">
    <header><div class="ci" style="background:var(--brand)">${ICON.gate}</div>
      <h2>${esc(title)}</h2><span class="sub">${list.length}</span></header>
    <div class="body flush">${list.length ? list.map(render).join("") : `<div class="empty">${esc(note)}</div>`}</div></div>`;

  return {
    html: `<main>
    <div class="page-head">
      <div class="icon" style="background:var(--brand)">${ICON.home}</div>
      <div><div class="eyebrow">Portfolio</div><h1>Home</h1>
        <div class="desc">Where the firm's product capacity is sitting today, what is waiting on a decision, and what is decaying unattended.</div></div>
      <div class="actions">
        <a class="btn" href="#/reports/KPI">KPI framework</a>
        <a class="btn" href="#/reports/RPT-03">Exception report</a>
        ${can("product.create") ? `<button class="btn brand" data-act="new-product">${ICON.plus} New Product</button>` : ""}
      </div>
    </div>

    <div class="kpis">
      ${kpi("", "Unrealised effort", `${days(k.unrealised_days)}<small> days</small>`, money(k.unrealised_value) + " not yet in market", "/products?dev")}
      ${kpi("g", "Portfolio return", `${(k.portfolio_return || 0).toFixed(2)}<small>×</small>`, `${money(k.revenue)} attributed`, "/reports/RPT-04")}
      ${kpi(k.stalled ? "r" : "n", "Products stalled", k.stalled ?? 0, "past the stage ageing threshold", "/products?exception")}
      ${kpi(k.awaiting ? "y" : "n", "Awaiting a decision", k.awaiting ?? 0, `${k.gate_ready ?? 0} gate-ready, not submitted`, "/gates")}
      ${kpi("", "Deployments", k.deployments ?? 0, `${money(k.unconfirmed_revenue)} revenue unconfirmed`, "/market")}
      ${kpi("n", "Register", `${k.total ?? 0}`, `${k.in_development ?? 0} in development · ${k.in_market ?? 0} in market · ${k.closed ?? 0} closed`, "/products")}
    </div>

    <div class="split">
      <div>
        <div class="card">
          <header><div class="ci" style="background:var(--error)">${ICON.clock}</div>
            <h2>Needs a decision</h2><span class="sub">stalled, overdue, parked or in rework</span>
            <div class="right"><a class="btn sm" href="#/reports/RPT-03">Open report</a></div></header>
          <div class="body flush">${exceptionsTable}</div>
        </div>

        <div class="card">
          <header><div class="ci" style="background:var(--brand-darker)">${ICON.chart}</div>
            <h2>Two-track distribution</h2><span class="sub">live products by position</span></header>
          <div class="body">
            <div class="grid g2">
              ${dist("development", (d.distribution || []).filter(s => s.track === "development"))}
              ${dist("market", (d.distribution || []).filter(s => s.track === "market"))}
            </div>
            <p class="note" style="margin-top:.625rem">The eight gates on the left are control points: a product advances only when its
            written exit criteria are met and the named approver signs. The six states on the right carry no approver — the workbook
            already recorded <span class="mono">NA</span> for all six — and are set from deployment and revenue evidence.</p>
          </div>
        </div>

        <div class="card">
          <header><div class="ci" style="background:var(--teal)">${ICON.money}</div>
            <h2>Return on products in market</h2><span class="sub">confirmed revenue against the value of consultant time</span></header>
          <div class="body flush">${dataTable({
            columns: [
              { label: "Product", cell: p => productLink(p) },
              { label: "State", cell: p => `<span class="badge t">${esc(p.stage_name)}</span>` },
              { label: "Deployments", align: "r", cell: p => p.deployments },
              { label: "Effort", align: "r", cell: p => `${days(p.effort)} d` },
              { label: "Effort value", align: "r", cell: p => money0(p.effort_value) },
              { label: "Revenue", align: "r", cell: p => money0(p.revenue) },
              { label: "Return", align: "r", cell: p => p.roi ? `<b>${p.roi.toFixed(2)}×</b>` : "—" }
            ], rows: d.market || [], onRow: p => `/product/${p.id}`,
            empty: "No product has reached the market track yet."
          })}</div>
        </div>
      </div>

      <div>
        ${queueCard("Awaiting your approval", d.myQueue || [], "Nothing is waiting on your sign-off.", p => `
          <div class="rrow">
            <div class="ic" style="background:var(--brand-darker)">${ICON.gate}</div>
            <div class="b"><b>${productLink(p)}</b>
              <div class="m">${esc(p.stage_name)} · submitted ${fmtDT(p.submitted_at)}</div></div>
            <div class="r"><a class="btn sm brand" href="#/product/${p.id}">Review</a></div>
          </div>`)}

        ${queueCard("Yours to move on", (d.myToMove || []).slice(0, 12), "No stage is waiting on you.", p => `
          <div class="rrow">
            <div class="ic" style="background:var(--warn-line)">${ICON.gate}</div>
            <div class="b"><b>${productLink(p)}</b>
              <div class="m">${esc(p.stage_name)} — ${p.gate_ready ? "ready to submit" : `${p.crit_total - p.crit_met} criteria outstanding`}</div></div>
            <div class="r"><a class="btn sm" href="#/product/${p.id}">Open</a></div>
          </div>`)}

        ${(d.killQueue || []).length ? queueCard("Kill decisions for you", d.killQueue, "", k => `
          <div class="rrow">
            <div class="ic" style="background:var(--error)">${ICON.x}</div>
            <div class="b"><b><a href="#/product/${k.product_id}">${esc(k.code)}</a> ${esc(k.product_name)}</b>
              <div class="m">${esc(k.stage_name)} · recommended by ${esc(k.recommended_by_name)} — ${esc(k.reason)}</div></div>
            <div class="r"><a class="btn sm danger" href="#/product/${k.product_id}">Decide</a></div>
          </div>`) : ""}

        ${(d.candidates || []).length ? `<div class="card">
          <header><div class="ci" style="background:var(--teal)">${ICON.chart}</div><h2>Market state candidates</h2>
            <span class="sub">${d.candidates.length}</span></header>
          <div class="body flush">${d.candidates.map(c => `
            <div class="rrow">
              <div class="ic" style="background:${c.decline_overdue ? "var(--error)" : "var(--teal)"}">${ICON.chart}</div>
              <div class="b"><b><a href="#/product/${c.id}">${esc(c.code)}</a> ${esc(c.name)}</b>
                <div class="m">${esc(c.stage)} → <b>${esc(c.proposal || "decision overdue")}</b> · ${esc(c.test || `${c.decline_days} days in Decline (BR-19)`)}</div></div>
            </div>`).join("")}</div>
          <div class="foot">${link("/reports/RPT-08", "Market state evidence pack (RPT-08)")}</div>
        </div>` : ""}

        ${queueCard("Your products", (d.myProducts || []).slice(0, 12), "You do not own or act on any open product.", p => `
          <div class="rrow">
            <div class="ic" style="background:${p.track === "market" ? "var(--teal)" : "var(--brand)"}">${ICON.product}</div>
            <div class="b"><b>${productLink(p)}</b><div class="m">${esc(p.stage_name)} · ${esc(p.next_action || "")}</div></div>
            <div class="r">${p.age_days} wd</div>
          </div>`)}
      </div>
    </div></main>`,
    mount() {
      document.querySelectorAll("[data-goto]").forEach(el => el.onclick = () => go(el.dataset.goto.split("?")[0] + (el.dataset.goto.includes("?") ? "?" + el.dataset.goto.split("?")[1] : "")));
      document.querySelector('[data-act="new-product"]')?.addEventListener("click", newProduct);
      wireRows();
    }
  };
}

const whyBadges = p => [
  p.badly_stalled ? `<span class="badge r">Twice ageing threshold</span>` : p.stalled ? `<span class="badge y">Stalled</span>` : "",
  p.overdue ? `<span class="badge r">Overdue ${p.days_overdue} wd</span>` : "",
  p.status === "On Hold" ? `<span class="badge y">Parked to ${fmtDate(p.hold_resume_date)}</span>` : "",
  p.status === "Rework" ? `<span class="badge r">Returned</span>` : "",
  p.awaiting_approval ? `<span class="badge b">Awaiting ${esc(p.approver_role)}</span>` : ""
].filter(Boolean).join(" ") || "—";

function wireRows() {
  document.querySelectorAll("tr[data-row]").forEach(tr => {
    tr.addEventListener("click", e => { if (!e.target.closest("a,button")) go(tr.dataset.row); });
  });
}

/* =================================================================== */
/* PRODUCTS — list view                                                 */
/* =================================================================== */
const VIEWS = {
  all: { label: "All products", f: () => true },
  dev: { label: "In development", f: p => p.track === "development" && p.status !== "Closed" },
  market: { label: "In market", f: p => p.track === "market" && p.status !== "Closed" },
  exception: { label: "Needs a decision", f: p => p.exception },
  ready: { label: "Gate-ready", f: p => p.gate_ready && !p.awaiting_approval },
  awaiting: { label: "Awaiting approval", f: p => p.awaiting_approval },
  mine: { label: "My products", f: p => p.owner_user_id === me().id || p.action_owner_user_id === me().id },
  closed: { label: "Closed", f: p => p.status === "Closed" }
};
let listState = { view: "all", q: "", sort: "code", dir: 1 };

export async function products() {
  const qs = location.hash.split("?")[1];
  if (qs && VIEWS[qs]) listState.view = qs;
  const draw = () => {
    const v = VIEWS[listState.view];
    let rows = S.products.filter(v.f);
    if (listState.q) {
      const q = listState.q.toLowerCase();
      rows = rows.filter(p => (p.code + " " + p.name + " " + (p.client_source || "") + " " + p.problem + " " +
        p.stage_name + " " + (p.owner_name || "") + " " + p.origin + " " + p.route).toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      const k = listState.sort;
      const av = a[k] ?? "", bv = b[k] ?? "";
      return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * listState.dir;
    });
    return { rows, table: dataTable({
      sortKey: listState.sort,
      columns: [
        { label: "Product ID", sort: "code", cell: p => `<a href="#/product/${p.id}"><b>${esc(p.code)}</b></a>` },
        { label: "Product / Solution", sort: "name", cell: p => `<a href="#/product/${p.id}">${esc(p.name)}</a>` },
        { label: "Track", sort: "track", cell: p => trackBadge(p.track) },
        { label: "Current stage", sort: "stage_seq", cell: p => esc(p.stage_name) },
        { label: "Status", sort: "status", cell: p => statusBadge(p.status) },
        { label: "Route", sort: "route", cell: p => esc(p.route) },
        { label: "Owner", sort: "owner_name", cell: p => esc(p.owner_name || "—") },
        { label: "In stage", sort: "age_days", align: "r", cell: p => `${p.age_days}${p.stalled ? ' <span class="badge r">!</span>' : ""}` },
        { label: "Readiness", sort: "readiness", cell: p => p.track === "market" ? "—" :
          `<div style="min-width:5rem">${bar(p.readiness)}<span style="font-size:.625rem;color:var(--ink-4)">${p.crit_met}/${p.crit_total}</span></div>` },
        { label: "Effort (d)", sort: "effort", align: "r", cell: p => days(p.effort) },
        { label: "Deploys", sort: "deployments", align: "r", cell: p => p.deployments },
        { label: "Revenue", sort: "revenue", align: "r", cell: p => p.revenue ? money0(p.revenue) : "—" },
        { label: "Due", sort: "due_date", cell: p => p.due_date ? `<span class="${p.overdue ? "" : ""}" style="${p.overdue ? "color:var(--error-ink);font-weight:600" : ""}">${fmtDate(p.due_date)}</span>` : "—" },
        { label: "Next action", cell: p => `<span class="trunc">${esc(p.next_action || "—")}</span>` }
      ],
      rows, onRow: p => `/product/${p.id}`,
      rowClass: p => p.badly_stalled ? "bad" : (p.stalled || p.overdue) ? "warn" : "",
      empty: "No product matches this view."
    }) };
  };
  const { rows, table } = draw();

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--brand)">${ICON.product}</div>
        <div><div class="eyebrow">Register</div><h1>Products</h1>
          <div class="desc">The single authoritative register — the successor to <span class="mono">PLM_Product_Portfolio_Tracker.xlsx</span>. Every row carries its position, its cost and its return.</div></div>
        <div class="actions">
          <a class="btn" href="/api/reports/RPT-01?format=csv">Export register (RPT-01)</a>
          ${can("product.create") ? `<button class="btn brand" data-act="new-product">${ICON.plus} New Product</button>` : ""}
        </div>
      </div>
      <div class="card">
        <div class="lvhead">
          <select class="inp" id="lvview" style="width:auto;min-width:12rem">
            ${Object.entries(VIEWS).map(([k, v]) => `<option value="${k}" ${listState.view === k ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
          </select>
          <span class="count" id="lvcount">${rows.length} item${rows.length === 1 ? "" : "s"} · sorted by ${esc(listState.sort)}</span>
          <span class="spacer"></span>
          <input class="inp" id="lvq" type="search" placeholder="Search this list…" value="${esc(listState.q)}" style="width:16rem">
        </div>
        <div class="filterbar">
          ${Object.entries(VIEWS).map(([k, v]) => `<button class="chip" data-view="${k}" aria-pressed="${listState.view === k}">
            ${esc(v.label)}<span class="n">${S.products.filter(v.f).length}</span></button>`).join("")}
        </div>
        <div class="body flush" id="lvbody">${table}</div>
      </div></main>`,
    mount() {
      const redraw = () => {
        const { rows, table } = draw();
        document.getElementById("lvbody").innerHTML = table;
        document.getElementById("lvcount").textContent = `${rows.length} item${rows.length === 1 ? "" : "s"} · sorted by ${listState.sort}`;
        document.querySelectorAll(".chip[data-view]").forEach(c => c.setAttribute("aria-pressed", c.dataset.view === listState.view));
        document.getElementById("lvview").value = listState.view;
        wireSort(); wireRows();
      };
      const wireSort = () => document.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => {
        listState.dir = listState.sort === th.dataset.sort ? -listState.dir : 1;
        listState.sort = th.dataset.sort; redraw();
      });
      document.getElementById("lvq").oninput = e => { listState.q = e.target.value; redraw(); };
      document.getElementById("lvview").onchange = e => { listState.view = e.target.value; redraw(); };
      document.querySelectorAll(".chip[data-view]").forEach(c => c.onclick = () => { listState.view = c.dataset.view; redraw(); });
      document.querySelector('[data-act="new-product"]')?.addEventListener("click", newProduct);
      wireSort(); wireRows();
    }
  };
}

export function newProduct() {
  const routeEntry = S.boot.routeEntry;
  openForm({
    title: "New Product", size: "lg",
    rule: `<b>BR-04 — derived entry.</b> The entry gate is calculated from the development route
      (Ideate → gate 1, Replace → gate 3, Replicate → gate 4, Upgrade → gate 5) and is not typed.
      <b>BR-01</b> generates the identifier as P-nnn and never reuses it.`,
    fields: [
      { name: "name", label: "Product / Solution", required: true, cols: "full", placeholder: "e.g. Warehouse Space Planner" },
      { name: "problem", label: "Problem solved", type: "textarea", required: true, cols: "full", rows: 3,
        help: "Written in the client's terms, not the solution's. This becomes a gate 1 exit criterion." },
      { name: "origin", label: "Origin", type: "select", required: true, options: S.boot.origins.map(o => ({ value: o, label: o })),
        help: "Where the idea came from." },
      { name: "route", label: "Development route", type: "select", required: true,
        options: S.boot.routes.map(r => ({ value: r, label: `${r} — enters at gate ${routeEntry[r]}` })),
        help: "How the product will be built. Determines the entry gate." },
      { name: "client_source", label: "Client / source", placeholder: "e.g. Client — Logistics" },
      { name: "owner_user_id", label: "Product owner", type: "select", required: true,
        options: userOptions(me().id), value: String(me().id), help: "Accountable across the whole life (BR-31)." },
      { name: "action_owner_user_id", label: "Action owner", type: "select", options: userOptions("", "— defaults to the product owner —") },
      { name: "next_action", label: "Next action", required: true, cols: "full" },
      { name: "spec_link", label: "Specification or repository link", cols: "full", placeholder: "https://…" }
    ],
    submit: "Create product",
    onSubmit: async d => {
      const p = await api("/products", { method: "POST", body: d });
      await refresh(true); toast("ok", `${p.code} created at gate ${p.stage_seq} — ${p.stage_name}.`);
      go(`/product/${p.id}`); await render();
    }
  });
}

/* =================================================================== */
/* PRODUCT RECORD                                                       */
/* =================================================================== */
let recordTab = "details";

export async function product(id) {
  let det;
  try { det = await api("/products/" + id); }
  catch (e) { return { html: `<main><div class="card"><div class="empty">${esc(e.message)}</div></div></main>` }; }
  const p = det.product, g = det.gate;
  const isDev = p.track === "development";
  const tabs = [
    ["details", "Details", null],
    [isDev ? "gate" : "market", isDev ? "Gate" : "Market state", isDev ? `${p.crit_met}/${p.crit_total}` : null],
    ["commercial", "Effort & commercial", String(det.effort.length + det.deployments.length)],
    ["history", "History", String(det.history.length)],
    ["audit", "Audit trail", null]
  ];
  if (!tabs.some(t => t[0] === recordTab)) recordTab = "details";

  const body = {
    details: () => detailsTab(p, det),
    gate: () => gateTab(p, det, g),
    market: () => marketTab(p, det),
    commercial: () => commercialTab(p, det),
    history: () => historyTab(p, det),
    audit: () => auditTab(det)
  }[recordTab]();

  return {
    html: `<main>
      <div class="highlights">
        <div class="top">
          <div class="icon" style="background:${isDev ? "var(--brand)" : "var(--teal)"}">${ICON.product}</div>
          <div style="min-width:0">
            <div class="eyebrow">Product · ${esc(p.code)}</div>
            <h1>${esc(p.name)} ${statusBadge(p.status)} ${p.awaiting_approval ? `<span class="badge b">Awaiting ${esc(p.approver_role)}</span>` : ""}
              ${p.stalled ? `<span class="badge r">Stalled</span>` : ""} ${p.kill_pending ? `<span class="badge r">Kill recommended</span>` : ""}</h1>
          </div>
          <div class="acts" id="pacts"></div>
        </div>
        <div class="hfields">
          <div class="f"><div class="k">Track</div><div class="v">${trackBadge(p.track)}</div></div>
          <div class="f"><div class="k">Current position</div><div class="v">${esc(p.stage_name)}</div></div>
          <div class="f"><div class="k">Approver</div><div class="v">${esc(p.approver_role || "NA — market state")}</div></div>
          <div class="f"><div class="k">Product owner</div><div class="v">${esc(p.owner_name || "—")}</div></div>
          <div class="f"><div class="k">Time in stage</div><div class="v">${p.age_days} wd${p.ageing_days ? ` <span style="font-weight:400;color:var(--ink-4)">of ${p.ageing_days}</span>` : ""}</div></div>
          <div class="f"><div class="k">Effort to date</div><div class="v">${days(p.effort)} d · ${money(p.effort_value)}</div></div>
          <div class="f"><div class="k">Deployments</div><div class="v">${p.deployments}</div></div>
          <div class="f"><div class="k">Attributed revenue</div><div class="v">${money(p.revenue)}</div></div>
          <div class="f"><div class="k">Return</div><div class="v">${p.roi ? p.roi.toFixed(2) + "×" : "—"}</div></div>
        </div>
      </div>
      ${pathComponent(p)}
      ${p.status === "On Hold" ? `<div class="warnbox"><b>Parked.</b> ${esc(p.hold_reason || "")} Intended resumption ${fmtDate(p.hold_resume_date)}.
        Ageing continues to accrue and the product stays on the exception report (BR-27).</div>` : ""}
      ${p.status === "Rework" ? `<div class="errbox"><b>Returned by the approver.</b> ${esc(det.gate.approvals.find(a => a.decision === "Returned")?.reason || "")}</div>` : ""}
      ${p.status === "Closed" ? `<div class="card"><header><div class="ci" style="background:var(--ink-4)">${ICON.doc}</div><h2>Closure reason</h2></header>
        <div class="body"><p class="note">${esc(p.closure_reason || "— none recorded —")}</p></div></div>` : ""}
      <div class="card">
        <div class="rtabs">${tabs.map(([k, l, n]) => `<button data-tab="${k}" aria-selected="${recordTab === k}">${esc(l)}${n ? `<span class="n">${esc(n)}</span>` : ""}</button>`).join("")}</div>
        <div class="body" id="rtabbody">${body}</div>
      </div></main>`,
    mount() {
      document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { recordTab = b.dataset.tab; render(); });
      renderActions(p, det);
      wireRecord(p, det);
      wireRows();
    }
  };
}

/* ---------------- actions ---------------- */
function renderActions(p, det) {
  const el = document.getElementById("pacts");
  if (!el) return;
  const isDev = p.track === "development", open = p.status !== "Closed";
  const btns = [];
  const isApprover = det.gate.isApprover;

  if (isDev && open && p.awaiting_approval && isApprover) {
    btns.push(`<button class="btn success" data-a="approve">Approve gate</button>`);
    btns.push(`<button class="btn danger" data-a="return">Return</button>`);
  } else if (isDev && open && !p.awaiting_approval && can("gate.submit")) {
    btns.push(`<button class="btn brand" data-a="submit" ${p.gate_ready ? "" : "disabled title='All exit criteria must be met first (BR-06)'"}>Submit for approval</button>`);
  }
  if (open && can("effort.log")) btns.push(`<button class="btn" data-a="effort">Log effort</button>`);
  if (open && can("deployment.record")) btns.push(`<button class="btn" data-a="deploy">New deployment</button>`);
  btns.push(`<button class="btn icon" data-a="more" title="More actions">${ICON.down}</button>`);
  el.innerHTML = btns.join("");

  const menu = e => {
    const items = [];
    if (open && can("product.edit")) items.push({ label: "Edit details", onClick: () => editProduct(p) });
    if (open && isDev && can("product.edit")) items.push({ label: "Revise target date", onClick: () => reviseDate(p) });
    if (open && can("owner.change")) items.push({ label: "Change product owner", onClick: () => changeOwner(p) });
    if (open && isDev && can("entry.override") && !det.gate.approvals.some(a => a.decision === "Approved"))
      items.push({ label: "Override entry gate", onClick: () => overrideEntry(p) });
    items.push("-");
    if (open && can("product.park")) items.push(p.status === "On Hold"
      ? { label: "Resume from hold", onClick: () => resumeProduct(p) }
      : { label: "Park (put On Hold)", onClick: () => parkProduct(p) });
    if (open && p.track === "market" && can("market.change")) items.push({ label: "Change market state", onClick: () => changeMarket(p) });
    if (open && isDev && can("kill.recommend") && !p.kill_pending) items.push({ label: "Recommend kill", onClick: () => recommendKill(p) });
    if (open && p.kill_pending && can("kill.approve")) items.push({ label: "Decide kill recommendation", onClick: () => decideKill(p, det) });
    items.push("-", { label: "Gate review pack (RPT-02)", onClick: () => go("/reports/RPT-02") });
    openMenu(e.currentTarget, items.filter(i => i !== "-" || true));
  };
  el.querySelector('[data-a="more"]').onclick = menu;
  el.querySelector('[data-a="approve"]')?.addEventListener("click", () => decideGate(p, det, "Approved"));
  el.querySelector('[data-a="return"]')?.addEventListener("click", () => decideGate(p, det, "Returned"));
  el.querySelector('[data-a="submit"]')?.addEventListener("click", () => submitGate(p));
  el.querySelector('[data-a="effort"]')?.addEventListener("click", () => logEffort(p));
  el.querySelector('[data-a="deploy"]')?.addEventListener("click", () => newDeployment(p));
}

/* ---------------- tabs ---------------- */
const f = (k, v, cls = "") => `<div class="dfield ${cls}"><div class="k">${esc(k)}</div><div class="v">${v ?? "—"}</div></div>`;

function detailsTab(p, det) {
  return `<div class="dgrid">
    ${f("Product ID", `<span class="mono"><b>${esc(p.code)}</b></span>`)}
    ${f("Product / Solution", esc(p.name))}
    ${f("Problem solved", esc(p.problem), "full")}
    ${f("Origin", esc(p.origin))}
    ${f("Development route", `${esc(p.route)} <span class="badge">enters at gate ${S.boot.routeEntry[p.route]}</span>`)}
    ${f("Entry gate", `${esc(p.entry_stage_name || "—")}${p.entry_override_reason ? ` <span class="badge y">overridden</span>` : ""}`)}
    ${p.entry_override_reason ? f("Entry override reason", esc(p.entry_override_reason), "full") : ""}
    ${f("Client / source", esc(p.client_source))}
    ${f("Product owner", esc(p.owner_name))}
    ${f("Track", trackBadge(p.track))}
    ${f("Current stage", esc(p.stage_name))}
    ${f("Status", statusBadge(p.status))}
    ${f("Next action", esc(p.next_action), "full")}
    ${f("Action owner", esc(p.action_owner_name))}
    ${f("Stage owner (from stage model)", esc(p.stage_owner_role || "—"))}
    ${f("Stage approver (from stage model)", esc(p.approver_role || "NA — market states carry no approver"))}
    ${f("Participants (notified)", p.participant_roles.length ? p.participant_roles.map(r => `<span class="pill">${esc(r.name)}</span>`).join(" ") : "—")}
    ${f("Target date", p.target_date ? fmtDate(p.target_date) : "—")}
    ${f("Revised date", p.revised_date ? `${fmtDate(p.revised_date)} <span class="badge y">${p.revisions} revision${p.revisions === 1 ? "" : "s"}</span>` : "—")}
    ${f("Stage entry date", fmtDate(p.stage_entry_date))}
    ${f("Actual completion date", p.actual_completion_date ? fmtDate(p.actual_completion_date) : "—")}
    ${f("Time in stage", `${p.age_days} working days${p.ageing_days ? ` — ageing threshold ${p.ageing_days}` : ""}`)}
    ${f("Effort budget", p.effort_budget ? `${days(p.effort_budget)} days` : "— not set at gate 3 —")}
    ${f("Effort to date", `${days(p.effort)} days · ${money(p.effort_value)}${p.effort_estimated ? ` <span class="badge y">${days(p.effort_estimated)} d estimated at migration</span>` : ""}`)}
    ${f("Predecessor product", p.predecessor_code ? `<a href="#/product/${p.predecessor_id}">${esc(p.predecessor_code)}</a> ${esc(p.predecessor_name)}` : "—")}
    ${f("Specification / repository", p.spec_link ? `<a href="${esc(p.spec_link)}" target="_blank" rel="noreferrer noopener">${esc(p.spec_link)}</a>` : "—")}
    ${f("Created", `${fmtDT(p.created_at)}`)}
    ${f("Last modified", `${fmtDT(p.updated_at)}`)}
  </div>
  <p class="note" style="margin-top:.75rem">Purpose of this stage — ${esc(p.stage_purpose || p.stage_definition || "—")}</p>`;
}

function gateTab(p, det, g) {
  const open = p.status !== "Closed";
  const canMark = open && can("criteria.mark") && !p.submitted_at;
  const criteria = g.criteria.map(c => `
    <div class="crit ${c.met ? "met" : ""}">
      <div class="box">${c.met ? ICON.check : ""}</div>
      <div class="txt">
        <b>${c.seq}. ${esc(c.text)}</b>
        ${c.evidence ? `<div class="ev">${esc(c.evidence)}</div>` : ""}
        ${c.met ? `<div class="by">Marked met by ${esc(c.marked_by_name || "—")} on ${fmtDT(c.marked_at)}</div>` : `<div class="by">Not yet met.</div>`}
      </div>
      ${canMark ? `<button class="btn sm" data-crit="${c.id}" data-met="${c.met ? 0 : 1}">${c.met ? "Unmark" : "Mark met"}</button>` : ""}
    </div>`).join("");

  return `<div class="split">
    <div>
      <div class="card" style="margin:0 0 .75rem">
        <header><div class="ci" style="background:var(--brand)">${ICON.gate}</div>
          <h2>Exit criteria — ${esc(p.stage_name)}</h2>
          <div class="right" style="min-width:9rem">${bar(p.readiness)}<span style="font-size:.6875rem;color:var(--ink-4)">${p.crit_met} of ${p.crit_total} met</span></div>
        </header>
        <div class="body flush">${criteria || `<div class="empty">No exit criteria are defined for this stage. Add them under Setup → Stage model (FR-11).</div>`}</div>
        ${p.track === "development" ? `<div class="foot">The ${esc(p.stage_owner_role)} moves this stage on. A gate may be
          submitted only when every criterion is met (BR-06 / FR-13), and only the ${esc(p.approver_role)} may approve it (BR-07).</div>` : ""}
      </div>

      <div class="card" style="margin:0">
        <header><div class="ci" style="background:var(--ink-4)">${ICON.users}</div><h2>Participants</h2>
          <span class="sub">notified on submission and on the decision — they never gate it</span></header>
        <div class="body flush">
          ${p.participant_roles.length ? p.participant_roles.map(r => `
            <div class="rrow"><div class="ic" style="background:var(--ink-4)">${ICON.bell}</div>
              <div class="b"><b>${esc(r.name)}</b>
                <div class="m">Notified when ${esc(p.stage_name)} is submitted and when it is decided.</div></div></div>`).join("")
            : `<div class="empty">No participant is listed for this stage.</div>`}
        </div>
      </div>
    </div>
    <div>
      <div class="card" style="margin:0 0 .75rem">
        <header><h2>Gate status</h2></header>
        <div class="body">
          <dl class="kv">
            <dt>Gate</dt><dd>${p.stage_seq} — ${esc(p.stage_name)}</dd>
            <dt>Stage owner</dt><dd>${esc(p.stage_owner_role || "—")} <span class="badge">moves it on</span></dd>
            <dt>Participants</dt><dd>${p.participant_roles.map(r => r.name).join(", ") || "—"}</dd>
            <dt>Approver</dt><dd>${esc(p.approver_role || "NA")}</dd>
            <dt>Target duration</dt><dd>${p.target_days ?? "—"} working days</dd>
            <dt>Ageing threshold</dt><dd>${p.ageing_days ?? "—"} working days</dd>
            <dt>Time in stage</dt><dd>${p.age_days} working days</dd>
            <dt>Effort at this stage</dt><dd>${days(p.effort_stage)} days</dd>
            <dt>Submitted</dt><dd>${p.submitted_at ? fmtDT(p.submitted_at) : "not submitted"}</dd>
          </dl>
          ${p.stage_seq > 1 && p.effort_stage <= 0 ? `<div class="warnbox" style="margin-top:.625rem">No effort is logged against this stage.
            The gate cannot be approved until it is (BR-21).</div>` : ""}
          ${det.gate.lastMarkedBy === me().id && det.gate.isApprover ? `<div class="warnbox" style="margin-top:.625rem">
            You marked the final exit criterion, so you may not also record the approval (BR-09).</div>` : ""}
        </div>
      </div>
      <div class="card" style="margin:0">
        <header><h2>Gate decisions</h2><span class="sub">${g.approvals.length}</span></header>
        <div class="body flush">${g.approvals.length ? g.approvals.map(a => `
          <div class="rrow"><div class="ic" style="background:${a.decision === "Approved" ? "var(--success)" : a.decision === "Killed" ? "var(--error)" : "var(--warn-line)"}">
            ${a.decision === "Approved" ? ICON.check : ICON.x}</div>
            <div class="b"><b>${esc(a.decision)} — ${esc(a.stage_name)}</b>
              <div class="m">${esc(a.actor_name)} · ${fmtDT(a.created_at)}${a.reason ? `<br>${esc(a.reason)}` : ""}</div></div></div>`).join("")
          : `<div class="empty">No gate decision has been recorded yet.</div>`}</div>
      </div>
    </div>
  </div>`;
}

function marketTab(p, det) {
  const changes = det.marketChanges;
  return `<div class="split">
    <div>
      <div class="card" style="margin:0 0 .75rem">
        <header><div class="ci" style="background:var(--teal)">${ICON.chart}</div><h2>${esc(p.stage_name)}</h2>
          ${can("market.change") && p.status !== "Closed" ? `<div class="right"><button class="btn sm brand" data-a="market">Change market state</button></div>` : ""}
        </header>
        <div class="body">
          <p class="note">${esc(p.stage_definition || "")}</p>
          <hr class="sep">
          <dl class="kv">
            <dt>Owner</dt><dd>Business Head</dd>
            <dt>Approver</dt><dd>NA — market states are not gated (BR-13)</dd>
            <dt>Participants</dt><dd>${p.participant_roles.map(r => r.name).join(", ") || "—"}</dd>
            <dt>Entry condition</dt><dd>${esc(p.entry_condition || "—")}</dd>
            <dt>Exit condition</dt><dd>${esc(p.exit_condition || "—")}</dd>
            <dt>In this state</dt><dd>${p.age_days} working days since ${fmtDate(p.stage_entry_date)}</dd>
          </dl>
        </div>
      </div>
      <div class="card" style="margin:0">
        <header><h2>Market state history</h2><span class="sub">${changes.length}</span></header>
        <div class="body flush">${changes.length ? changes.map(c => `
          <div class="rrow"><div class="ic" style="background:var(--teal)">${ICON.chart}</div>
            <div class="b"><b>${esc(c.from_name || "—")} → ${esc(c.to_name)}</b>
              <div class="m">${esc(c.evidence)}${c.review_ref ? `<br><i>Confirmed at: ${esc(c.review_ref)}</i>` : ""}</div></div>
            <div class="r">${fmtDT(c.created_at)}<br>${esc(c.user_name || "")}</div></div>`).join("")
          : `<div class="empty">No market state change recorded.</div>`}</div>
      </div>
    </div>
    <div>
      <div class="card" style="margin:0">
        <header><h2>Evidence</h2></header>
        <div class="body">
          <dl class="kv">
            <dt>Deployments</dt><dd>${p.deployments}</dd>
            <dt>Confirmed revenue</dt><dd>${money(p.revenue)}</dd>
            <dt>Unconfirmed</dt><dd>${money(p.revenue_unconfirmed)}</dd>
            <dt>Effort</dt><dd>${days(p.effort)} d · ${money(p.effort_value)}</dd>
            <dt>Return</dt><dd>${p.roi ? p.roi.toFixed(2) + "×" : "—"}</dd>
          </dl>
          <div class="infobox" style="margin-top:.75rem">Market states are proposed by the Business Head on evidence and confirmed at
            the quarterly portfolio review. The system flags candidates against the thresholds in BR-14 to BR-18; it does not move the
            product itself. ${link("/reports/RPT-08", "See RPT-08")}.</div>
        </div>
      </div>
    </div>
  </div>`;
}

function commercialTab(p, det) {
  const open = p.status !== "Closed";
  const effortTable = dataTable({
    columns: [
      { label: "Period", cell: e => esc(e.period) },
      { label: "Stage", cell: e => esc(e.stage_name || "—") },
      { label: "Days", align: "r", cell: e => days(e.days) },
      { label: "Value", align: "r", cell: e => money0(e.days * Number(setting("day_rate", 1800))) },
      { label: "Consultant", cell: e => esc(e.consultant_name || "—") },
      { label: "Source", cell: e => e.estimated ? `<span class="badge y">Estimated</span>` : `<span class="badge g">Logged</span>` },
      { label: "Note", cell: e => `<span class="trunc">${esc(e.note || "")}</span>` },
      { label: "", align: "r", cell: e => can("effort.log") && open ? `<button class="btn sm danger" data-deleff="${e.id}">Remove</button>` : "" }
    ], rows: det.effort, empty: "No effort has been logged. A gate cannot be approved without it (BR-21)."
  });
  const depTable = dataTable({
    columns: [
      { label: "Client reference", cell: d => esc(d.client_ref) },
      { label: "Date", cell: d => fmtDate(d.deployed_on) },
      { label: "Attributed revenue", align: "r", cell: d => money0(d.revenue) },
      { label: "Confirmed", cell: d => d.confirmed ? `<span class="badge g">${esc(d.confirmed_by_name || "confirmed")}</span>` : `<span class="badge y">Awaiting Finance Head</span>` },
      { label: "", align: "r", cell: d => !d.confirmed && can("revenue.confirm") ? `<button class="btn sm success" data-confirm="${d.id}">Confirm</button>` : "" }
    ], rows: det.deployments, empty: "No deployment recorded. Market entry follows the first paid deployment (BR-11)."
  });
  const maxStage = Math.max(1, ...det.effortByStage.map(s => s.days));

  return `<div class="split">
    <div>
      <div class="card" style="margin:0 0 .75rem">
        <header><div class="ci" style="background:var(--brand)">${ICON.clock}</div><h2>Effort</h2>
          <span class="sub">${days(p.effort)} days · ${money(p.effort_value)}</span>
          ${can("effort.log") && open ? `<div class="right"><button class="btn sm brand" data-a="effort">Log effort</button></div>` : ""}</header>
        <div class="body flush">${effortTable}</div>
      </div>
      <div class="card" style="margin:0">
        <header><div class="ci" style="background:var(--teal)">${ICON.money}</div><h2>Deployments and attributed revenue</h2>
          <span class="sub">${p.deployments} · ${money(p.revenue)} confirmed</span>
          ${can("deployment.record") && open ? `<div class="right"><button class="btn sm brand" data-a="deploy">New deployment</button></div>` : ""}</header>
        <div class="body flush">${depTable}</div>
        <div class="foot">Attributed revenue is a management figure. It enters portfolio reporting only after the Finance Head confirms it (BR-23).</div>
      </div>
    </div>
    <div>
      <div class="card" style="margin:0 0 .75rem">
        <header><h2>Effort by stage</h2></header>
        <div class="body">
          ${det.effortByStage.length ? `<div class="dist">${det.effortByStage.map(s => `
            <div class="row ${s.track === "market" ? "mkt" : ""}"><span class="g">${s.track === "development" ? String(s.seq).padStart(2, "0") : "—"}</span>
              <span>${esc(s.stage_name)}</span><span class="bar"><i style="width:${Math.round(s.days / maxStage * 100)}%"></i></span>
              <span class="c">${days(s.days)}</span></div>`).join("")}</div>` : `<div class="empty">No effort logged.</div>`}
        </div>
      </div>
      <div class="card" style="margin:0">
        <header><h2>Economics</h2></header>
        <div class="body"><dl class="kv">
          <dt>Effort to date</dt><dd>${days(p.effort)} days</dd>
          <dt>Day rate</dt><dd>${money(setting("day_rate", 1800))}</dd>
          <dt>Effort value</dt><dd>${money(p.effort_value)}</dd>
          <dt>Effort budget</dt><dd>${p.effort_budget ? days(p.effort_budget) + " days" : "not set"}</dd>
          <dt>Variance</dt><dd>${p.effort_budget ? `${(p.effort - p.effort_budget) > 0 ? "+" : ""}${days(p.effort - p.effort_budget)} days` : "—"}</dd>
          <dt>Deployments</dt><dd>${p.deployments}</dd>
          <dt>Confirmed revenue</dt><dd>${money(p.revenue)}</dd>
          <dt>Return on invested time</dt><dd>${p.roi ? `<b>${p.roi.toFixed(2)}×</b>` : "—"}</dd>
        </dl></div>
      </div>
    </div>
  </div>`;
}

function historyTab(p, det) {
  const items = det.history.map((h, i) => {
    const last = i === det.history.length - 1;
    return `<div class="item ${last ? "cur" : "done"} ${h.track === "market" ? "mkt" : ""} ${h.decision === "Killed" ? "bad" : ""}">
      <div class="h"><b>${esc(h.stage_name || "—")}</b>
        <span class="badge ${h.track === "market" ? "t" : "b"}">${h.track === "market" ? "Market" : `Gate ${h.seq}`}</span>
        <span class="d">${fmtDate(h.entered_on)}${h.exited_on ? ` → ${fmtDate(h.exited_on)}` : " → current"} · ${h.days} working days</span></div>
      ${h.note ? `<div class="m">${esc(h.note)}</div>` : ""}
      ${h.decision ? `<div class="m"><b>${esc(h.decision)}</b>${h.actor_name ? ` by ${esc(h.actor_name)}` : ""}</div>` : ""}
    </div>`;
  }).join("");

  return `<div class="split">
    <div>
      <div class="card" style="margin:0"><header><h2>Stage history</h2>
        <span class="sub">immutable — corrections are new entries (BR-33)</span></header>
        <div class="body"><div class="tl">${items || `<div class="empty">No history.</div>`}</div></div></div>
    </div>
    <div>
      <div class="card" style="margin:0 0 .75rem"><header><h2>Target date revisions</h2><span class="sub">${det.revisions.length}</span></header>
        <div class="body flush">${det.revisions.length ? det.revisions.map(r => `
          <div class="rrow"><div class="ic" style="background:var(--warn-line)">${ICON.clock}</div>
            <div class="b"><b>${fmtDate(r.old_date)} → ${fmtDate(r.new_date)}</b><div class="m">${esc(r.reason)}</div></div>
            <div class="r">${esc(r.user_name || "")}<br>${fmtDT(r.created_at)}</div></div>`).join("")
          : `<div class="empty">No date revision recorded.</div>`}</div></div>

      <div class="card" style="margin:0 0 .75rem"><header><h2>Ownership changes</h2><span class="sub">${det.ownerChanges.length}</span></header>
        <div class="body flush">${det.ownerChanges.length ? det.ownerChanges.map(o => `
          <div class="rrow"><div class="ic" style="background:var(--violet)">${ICON.users}</div>
            <div class="b"><b>${esc(o.from_name || "—")} → ${esc(o.to_name)}</b><div class="m">${esc(o.reason)}</div></div>
            <div class="r">${fmtDT(o.created_at)}</div></div>`).join("") : `<div class="empty">No ownership change.</div>`}</div></div>

      ${det.kills.length ? `<div class="card" style="margin:0"><header><h2>Kill recommendations</h2></header>
        <div class="body flush">${det.kills.map(k => `
          <div class="rrow"><div class="ic" style="background:var(--error)">${ICON.x}</div>
            <div class="b"><b>${esc(k.decision || "Awaiting CEO decision")} — ${esc(k.stage_name || "")}</b>
              <div class="m">Recommended by ${esc(k.recommended_by_name)}: ${esc(k.reason)}
              ${k.closure_reason ? `<br><b>Closure:</b> ${esc(k.closure_reason)}` : ""}</div></div>
            <div class="r">${fmtDT(k.created_at)}</div></div>`).join("")}</div></div>` : ""}
    </div>
  </div>`;
}

function auditTab(det) {
  return dataTable({
    columns: [
      { label: "When", cell: a => fmtDT(a.created_at) },
      { label: "Action", cell: a => `<span class="badge">${esc(a.action)}</span>` },
      { label: "Summary", cell: a => esc(a.summary || "") },
      { label: "Field", cell: a => esc(a.field || "") },
      { label: "From", cell: a => `<span class="trunc">${esc(a.old_value || "")}</span>` },
      { label: "To", cell: a => `<span class="trunc">${esc(a.new_value || "")}</span>` },
      { label: "By", cell: a => esc(a.user_name || "system") }
    ], rows: det.audit, empty: "No audit entries."
  });
}

/* ---------------- record action wiring ---------------- */
function wireRecord(p, det) {
  const rerender = async () => { await refresh(true); await render(); };
  document.querySelectorAll("[data-crit]").forEach(b => b.onclick = async () => {
    const met = b.dataset.met === "1";
    if (!met) {
      try { await api(`/products/${p.id}/criterion`, { method: "POST", body: { criterion_id: +b.dataset.crit, met: false } }); await rerender(); }
      catch (e) { errToast(e); }
      return;
    }
    openForm({
      title: "Mark exit criterion met", size: "sm",
      rule: `<b>R-02.</b> An evidence note is required against every criterion, so that a gate cannot become a formality.
        <b>BR-09</b> then prevents whoever marks the final criterion from also recording the approval.`,
      fields: [{ name: "evidence", label: "Evidence", type: "textarea", required: true, minlength: 5, cols: "full", rows: 4,
        placeholder: "What was done, where the artefact is, who verified it." }],
      submit: "Mark met",
      onSubmit: async d => {
        await api(`/products/${p.id}/criterion`, { method: "POST", body: { criterion_id: +b.dataset.crit, met: true, evidence: d.evidence } });
        toast("ok", "Criterion marked met."); await rerender();
      }
    });
  });
  document.querySelectorAll("[data-confirm]").forEach(b => b.onclick = async () => {
    try { await api(`/products/${p.id}/deployment/${b.dataset.confirm}/confirm`, { method: "POST" });
      toast("ok", "Revenue confirmed and now included in portfolio reporting."); await rerender(); }
    catch (e) { errToast(e); }
  });
  document.querySelectorAll("[data-deleff]").forEach(b => b.onclick = () => confirmAction({
    title: "Remove effort entry", body: "This removes the entry from the product's cost side. The removal is written to the audit trail.",
    submit: "Remove", danger: true,
    onConfirm: async () => { await api(`/products/${p.id}/effort/${b.dataset.deleff}`, { method: "DELETE" }); toast("ok", "Effort entry removed."); await rerender(); }
  }));
  document.querySelector('[data-a="market"]')?.addEventListener("click", () => changeMarket(p));
  document.querySelectorAll('[data-a="effort"]').forEach(b => b.onclick = () => logEffort(p));
  document.querySelectorAll('[data-a="deploy"]').forEach(b => b.onclick = () => newDeployment(p));
}

/* ---------------- action dialogs ---------------- */
const after = async msg => { await refresh(true); await render(); if (msg) toast("ok", msg); };

export function editProduct(p) {
  openForm({
    title: `Edit ${p.code}`, size: "lg",
    fields: [
      { name: "name", label: "Product / Solution", value: p.name, required: true, cols: "full" },
      { name: "problem", label: "Problem solved", type: "textarea", value: p.problem, required: true, rows: 3, cols: "full" },
      { name: "origin", label: "Origin", type: "select", value: p.origin, options: S.boot.origins.map(o => ({ value: o, label: o })) },
      { name: "client_source", label: "Client / source", value: p.client_source },
      { name: "next_action", label: "Next action", value: p.next_action, required: true, cols: "full" },
      { name: "action_owner_user_id", label: "Action owner", type: "select", value: String(p.action_owner_user_id || ""), options: userOptions(p.action_owner_user_id, "—") },
      { name: "effort_budget", label: "Effort budget (days)", type: "number", step: "0.5", min: 0, value: p.effort_budget ?? "", help: "Approved at gate 3; variance is reported against it." },
      { name: "predecessor_id", label: "Predecessor product", type: "select", value: String(p.predecessor_id || ""),
        options: [{ value: "", label: "— none —" }, ...S.products.filter(x => x.id !== p.id).map(x => ({ value: x.id, label: `${x.code} ${x.name}` }))],
        help: "Set on the Replace and Upgrade routes. The predecessor moves to Die on this product's first deployment (BR-32)." },
      { name: "spec_link", label: "Specification / repository link", value: p.spec_link, cols: "full" }
    ],
    submit: "Save",
    onSubmit: async d => { await api(`/products/${p.id}`, { method: "PATCH", body: d }); await after("Product updated."); }
  });
}

export function reviseDate(p) {
  openForm({
    title: "Revise target date", size: "sm",
    rule: `<b>BR-24.</b> Every revision records the new date, the reason and the user; the revision count is derived from that history.
      <b>BR-30</b> — revising the date does not reset time in stage.`,
    fields: [
      { name: "current", label: "Current due date", value: p.due_date || "", type: "date", cols: "full" },
      { name: "new_date", label: "New target date", type: "date", required: true, cols: "full", value: p.due_date || todayISO() },
      { name: "reason", label: "Reason", type: "textarea", required: true, minlength: 10, rows: 3, cols: "full" }
    ],
    submit: "Record revision",
    onSubmit: async d => { await api(`/products/${p.id}/revise`, { method: "POST", body: d }); await after(`Target date revised — revision ${p.revisions + 1}.`); }
  });
}

export function logEffort(p) {
  openForm({
    title: `Log effort — ${p.code}`, size: "sm",
    rule: `<b>BR-20.</b> Effort is recorded in consultant days against a product and the stage current at the time of logging.
      <b>BR-21</b> — a gate cannot be approved with no effort logged against it (gate 1 excepted).`,
    fields: [
      { name: "period", label: "Period (month)", type: "month", value: thisMonth(), required: true },
      { name: "days", label: "Consultant days", type: "number", step: "0.5", min: "0.5", required: true, value: "1" },
      { name: "consultant_user_id", label: "Consultant", type: "select", value: String(me().id), options: userOptions(me().id) },
      { name: "estimated", label: "This is an estimate, not a logged figure", type: "checkbox",
        help: "Estimated effort is distinguished from logged effort in all reporting (§22.3)." },
      { name: "note", label: "Note", cols: "full" }
    ],
    submit: "Log effort",
    onSubmit: async d => { await api(`/products/${p.id}/effort`, { method: "POST", body: d }); await after("Effort logged."); }
  });
}

export function newDeployment(p) {
  openForm({
    title: `Record a deployment — ${p.code}`, size: "sm",
    rule: `<b>BR-22.</b> A deployment records the client reference, the date and the attributed revenue; the deployment count is derived.
      <b>BR-11</b> — once gate 8 is approved, the first paid deployment moves the product to market state Seeding.`,
    fields: [
      { name: "client_ref", label: "Client reference", required: true, cols: "full",
        help: "Use the anonymised reference if client naming is restricted (OI-14)." },
      { name: "deployed_on", label: "Deployment date", type: "date", required: true, value: todayISO() },
      { name: "revenue", label: `Attributed revenue (${setting("currency", "AED")})`, type: "number", min: 0, step: "1000", value: "0" },
      { name: "note", label: "Note", cols: "full" }
    ],
    submit: "Record deployment",
    onSubmit: async d => { await api(`/products/${p.id}/deployment`, { method: "POST", body: d }); await after("Deployment recorded; revenue awaits Finance Head confirmation."); }
  });
}

export function submitGate(p) {
  confirmAction({
    title: `Submit ${p.code} for approval`,
    body: `All ${p.crit_total} exit criteria for ${p.stage_name} are marked met. Submitting sends the gate to the ${p.approver_role}, `
      + `who has ${setting("gate_sla_days", 3)} working days to decide.`,
    submit: "Submit for approval",
    onConfirm: async () => { await api(`/products/${p.id}/submit`, { method: "POST" }); await after(`Submitted to the ${p.approver_role}.`); }
  });
}

export function decideGate(p, det, decision) {
  const approve = decision === "Approved";
  const next = approve ? stageList("development").find(s => s.seq === p.stage_seq + 1) : null;
  openForm({
    title: approve ? `Approve gate ${p.stage_seq} — ${p.stage_name}` : `Return ${p.code} to the stage owner`,
    size: "", danger: !approve,
    rule: approve
      ? `<b>BR-07</b> only the ${esc(p.approver_role)} may approve. <b>BR-09</b> you may not approve if you marked the
         final criterion. <b>BR-21</b> effort must be logged against the stage. Participants are notified of the outcome.`
      : `<b>BR-10.</b> A return requires a recorded reason and does not change the stage. <b>BR-29</b> — status becomes Rework until the owner resubmits.`,
    intro: approve
      ? (next ? `On approval the product advances to gate ${next.seq} — ${next.name}, with a new target date of ${next.target_days} working days.`
        : `This is the final development gate. On approval, development is complete; the product enters the market track on its first paid deployment (BR-11).`)
      : `The stage owner has ${setting("return_sla_days", 5)} working days to resubmit or produce a revised plan.`,
    fields: [
      { name: "html", type: "html", html: gateSummary(p, det) },
      { name: "reason", label: approve ? "Approval note (optional)" : "Reason for return", type: "textarea",
        rows: 3, cols: "full", required: !approve, minlength: approve ? undefined : 15 }
    ],
    submit: approve ? "Approve gate" : "Return to stage owner",
    onSubmit: async d => {
      await api(`/products/${p.id}/decide`, { method: "POST", body: { decision, reason: d.reason } });
      await after(approve ? `Gate approved.${next ? ` ${p.code} is now at ${next.name}.` : ""}` : "Returned to the stage owner.");
    }
  });
}

const gateSummary = (p, det) => `<div class="card" style="margin:0 0 .75rem"><div class="body">
  <dl class="kv">
    <dt>Criteria met</dt><dd>${p.crit_met} of ${p.crit_total}</dd>
    <dt>Participants notified</dt><dd>${p.participant_roles.map(r => r.name).join(", ") || "none listed"}</dd>
    <dt>Effort at stage</dt><dd>${days(p.effort_stage)} days${p.effort_budget ? ` of a ${days(p.effort_budget)} day budget` : ""}</dd>
    <dt>Time in stage</dt><dd>${p.age_days} working days (target ${p.target_days ?? "—"})</dd>
    <dt>Submitted</dt><dd>${fmtDT(p.submitted_at)}</dd>
  </dl></div></div>`;

export function parkProduct(p) {
  openForm({
    title: `Park ${p.code}`, size: "sm",
    rule: `<b>BR-27.</b> A parked product keeps accruing time in stage and stays on the exception report. An intended resumption date is required.`,
    fields: [
      { name: "resume_date", label: "Intended resumption date", type: "date", required: true, cols: "full" },
      { name: "reason", label: "Reason", type: "textarea", required: true, minlength: 10, rows: 3, cols: "full" }
    ],
    submit: "Park product",
    onSubmit: async d => { await api(`/products/${p.id}/park`, { method: "POST", body: d }); await after("Product parked."); }
  });
}
export function resumeProduct(p) {
  confirmAction({
    title: `Resume ${p.code}`, body: "Work resumes on the current stage. Time in stage continued to accrue while the product was parked.",
    submit: "Resume",
    onConfirm: async () => { await api(`/products/${p.id}/resume`, { method: "POST" }); await after("Product resumed."); }
  });
}

export function changeOwner(p) {
  openForm({
    title: `Change product owner — ${p.code}`, size: "sm",
    rule: `<b>BR-31.</b> Every product has exactly one product owner at all times; a change is recorded with its date and reason.`,
    fields: [
      { name: "to_user_id", label: "New product owner", type: "select", required: true, cols: "full", options: userOptions(p.owner_user_id) },
      { name: "reason", label: "Reason", type: "textarea", required: true, minlength: 10, rows: 3, cols: "full" }
    ],
    submit: "Change owner",
    onSubmit: async d => { await api(`/products/${p.id}/owner`, { method: "POST", body: d }); await after("Product owner changed."); }
  });
}

export function overrideEntry(p) {
  openForm({
    title: `Override the derived entry gate — ${p.code}`, size: "",
    rule: `<b>BR-05.</b> The derived entry gate for the ${esc(p.route)} route is gate ${S.boot.routeEntry[p.route]}.
      An override requires a recorded reason and is reported at the quarterly portfolio review.`,
    fields: [
      { name: "seq", label: "Entry gate", type: "select", required: true,
        options: stageList("development").map(s => ({ value: s.seq, label: `${s.seq} — ${s.name}` })), value: String(p.stage_seq) },
      { name: "reason", label: "Reason for the override", type: "textarea", required: true, minlength: 15, rows: 3, cols: "full" }
    ],
    submit: "Override entry gate",
    onSubmit: async d => { await api(`/products/${p.id}/entry`, { method: "POST", body: d }); await after("Entry gate overridden."); }
  });
}

export function recommendKill(p) {
  openForm({
    title: `Recommend killing ${p.code}`, size: "", danger: true,
    rule: `<b>BR-26.</b> A kill requires CEO approval on the recommendation of the Business Head. The ${days(p.effort)} consultant days
      logged to date (${money(p.effort_value)}) will be reported as written off.`,
    fields: [{ name: "reason", label: "Recommendation", type: "textarea", required: true, minlength: 30, rows: 4, cols: "full",
      placeholder: "Why the product will not reach market: demand absent, cost beyond the business case, or a better route exists." }],
    submit: "Send to the CEO",
    onSubmit: async d => { await api(`/products/${p.id}/kill`, { method: "POST", body: d }); await after("Kill recommendation sent to the CEO."); }
  });
}

export function decideKill(p, det) {
  const k = det.kills.find(x => !x.decision);
  openForm({
    title: `Kill decision — ${p.code}`, size: "", danger: true,
    rule: `<b>BR-25.</b> A closure reason of at least ${setting("closure_reason_min", 50)} characters is required.
      <b>BR-26</b> — effort to date is reported as written off in the kill analysis (RPT-06).`,
    intro: `Recommended by ${esc(k?.recommended_by_name || "")}: “${esc(k?.reason || "")}”. Effort to date ${days(p.effort)} days (${money(p.effort_value)}).`,
    fields: [
      { name: "decision", label: "Decision", type: "select", required: true, cols: "full",
        options: [{ value: "Approved", label: "Approve the kill — close the product" }, { value: "Rejected", label: "Reject — development continues" }] },
      { name: "closure_reason", label: "Closure reason", type: "textarea", rows: 4, cols: "full", minlength: 0,
        help: `Required when approving. Minimum ${setting("closure_reason_min", 50)} characters — it becomes the institutional record of what did not work and why.` }
    ],
    submit: "Record decision",
    onSubmit: async d => { await api(`/products/${p.id}/kill/decide`, { method: "POST", body: d }); await after("Kill decision recorded."); }
  });
}

export function changeMarket(p) {
  const min = Number(setting("closure_reason_min", 50));
  openForm({
    title: `Change market state — ${p.code}`, size: "",
    rule: `<b>BR-13.</b> Market state changes carry no approval gate. They are proposed by the Business Head on evidence and
      confirmed at the quarterly portfolio review. <b>BR-18</b> permits a return from Decline to Growth on evidence.`,
    fields: [
      { name: "seq", label: "New market state", type: "select", required: true,
        options: stageList("market").map(s => ({ value: s.seq, label: `${s.name}${s.seq === 6 ? " — withdrawal, CEO decision" : ""}` })),
        value: String(Math.min(6, (p.stage_seq || 0) + 1)) },
      { name: "review_ref", label: "Confirmed at", placeholder: "e.g. Q3 2026 portfolio review" },
      { name: "evidence", label: "Evidence", type: "textarea", required: true, minlength: 20, rows: 3, cols: "full",
        help: "Deployment and revenue evidence for the change. See RPT-08 for the threshold tests." },
      { name: "closure_reason", label: "Closure reason (required only for Die)", type: "textarea", rows: 3, cols: "full",
        help: `Minimum ${min} characters (BR-25).` }
    ],
    submit: "Change state",
    onSubmit: async d => { await api(`/products/${p.id}/market`, { method: "POST", body: d }); await after("Market state changed."); }
  });
}

/* =================================================================== */
/* GATE REVIEWS                                                         */
/* =================================================================== */
export async function gates() {
  const d = dash();
  const all = S.products.filter(p => p.awaiting_approval);
  const ready = S.products.filter(p => p.gate_ready && !p.awaiting_approval && p.status !== "Closed");
  const card = (title, sub, colour, rows, cols, empty) => `<div class="card">
    <header><div class="ci" style="background:${colour}">${ICON.gate}</div><h2>${esc(title)}</h2>
      <span class="sub">${esc(sub)}</span><div class="right"><span class="badge">${rows.length}</span></div></header>
    <div class="body flush">${dataTable({ columns: cols, rows, onRow: p => `/product/${p.id || p.product_id}`, empty })}</div></div>`;

  const baseCols = [
    { label: "Product", cell: p => productLink(p) },
    { label: "Gate", cell: p => `${p.stage_seq} — ${esc(p.stage_name)}` },
    { label: "Owner moves", cell: p => esc(p.stage_owner_role || "—") },
    { label: "Approver", cell: p => esc(p.approver_role) },
    { label: "Criteria", cell: p => `<div style="min-width:5rem">${bar(p.readiness)}<span style="font-size:.625rem;color:var(--ink-4)">${p.crit_met}/${p.crit_total}</span></div>` },
    { label: "Effort at stage", align: "r", cell: p => days(p.effort_stage) },
    { label: "In stage", align: "r", cell: p => `${p.age_days} wd` },
    { label: "Submitted", cell: p => p.submitted_at ? fmtDT(p.submitted_at) : "—" },
    { label: "Owner", cell: p => esc(p.owner_name || "—") }
  ];

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--brand-darker)">${ICON.gate}</div>
        <div><div class="eyebrow">Governance</div><h1>Gate Reviews</h1>
          <div class="desc">The stage owner moves a product on, the named approver decides, and the participants are told.
            Only the eight development stages are gated — market states carry no approver, so there is no queue for them here.</div></div>
        <div class="actions"><a class="btn" href="#/reports/RPT-02">Gate review pack</a><a class="btn" href="#/reports/RPT-09">Responsiveness</a></div>
      </div>
      ${card("Awaiting your decision", `you hold: ${me().roles.map(r => r.name).join(", ") || "no roles"}`, "var(--brand)",
        d.myQueue || [], [...baseCols, { label: "", align: "r", cell: p => `<a class="btn sm brand" href="#/product/${p.id}">Review</a>` }],
        "Nothing is waiting on your sign-off.")}
      ${card("Yours to move on", "stages you own — submit them once the criteria are met", "var(--warn-line)",
        d.myToMove || [], baseCols, "No stage is waiting on you.")}
      ${(d.killQueue || []).length ? `<div class="card">
        <header><div class="ci" style="background:var(--error)">${ICON.x}</div><h2>Kill decisions</h2>
          <span class="sub">CEO approval on the Business Head's recommendation (BR-26)</span></header>
        <div class="body flush">${dataTable({
          columns: [
            { label: "Product", cell: k => `<a href="#/product/${k.product_id}"><b>${esc(k.code)}</b></a> ${esc(k.product_name)}` },
            { label: "Gate", cell: k => esc(k.stage_name) },
            { label: "Recommended by", cell: k => esc(k.recommended_by_name) },
            { label: "Recommendation", cell: k => `<span class="trunc">${esc(k.reason)}</span>` },
            { label: "When", cell: k => fmtDT(k.created_at) },
            { label: "", align: "r", cell: k => `<a class="btn sm danger" href="#/product/${k.product_id}">Decide</a>` }
          ], rows: d.killQueue, empty: ""
        })}</div></div>` : ""}
      ${card("Gate-ready, not yet submitted", "every exit criterion met — the stage owner has not submitted", "var(--success)",
        ready, baseCols, "No product is sitting gate-ready.")}
      ${card("All gates in flight", "every submission across the portfolio", "var(--ink-4)",
        all, baseCols, "No gate is currently submitted for approval.")}
      </main>`,
    mount: wireRows
  };
}

/* =================================================================== */
/* MARKET TRACK                                                         */
/* =================================================================== */
export async function market() {
  const cands = await api("/candidates");
  const mkt = S.products.filter(p => p.track === "market");
  const spark = s => `<span class="trend">${s.slice(-8).map(x => `<i style="height:${Math.max(2, Math.min(20, x.n * 4))}px" title="${esc(x.q)}: ${x.n}"></i>`).join("")}</span>`;
  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--teal)">${ICON.chart}</div>
        <div><div class="eyebrow">Market track</div><h1>Market Track</h1>
          <div class="desc">Six states, none of them approved. The system tests the thresholds in BR-14 to BR-18 against the deployment
            record and flags candidates; the Business Head proposes the change and the quarterly review confirms it.</div></div>
        <div class="actions"><a class="btn" href="/api/reports/RPT-08?format=csv">Export evidence pack</a></div>
      </div>
      <div class="card">
        <header><div class="ci" style="background:var(--teal)">${ICON.chart}</div><h2>Threshold tests and candidates</h2></header>
        <div class="body flush">${dataTable({
          columns: [
            { label: "Product", cell: c => `<a href="#/product/${c.id}"><b>${esc(c.code)}</b></a> ${esc(c.name)}` },
            { label: "Current state", cell: c => `<span class="badge t">${esc(c.stage)}</span>` },
            { label: "Deployments", align: "r", cell: c => c.deployments },
            { label: "Revenue", align: "r", cell: c => money0(c.revenue) },
            { label: "Quarterly trend", cell: c => c.series.length ? `${spark(c.series)} <span style="font-size:.6875rem;color:var(--ink-4)">${c.series.slice(-4).map(s => s.n).join(" · ")}</span>` : "—" },
            { label: "Proposed", cell: c => c.proposal ? `<span class="badge b">${esc(c.proposal)}</span>` : `<span style="color:var(--ink-4)">no change indicated</span>` },
            { label: "Threshold test", cell: c => `<span class="trunc">${esc(c.test || "")}</span>` },
            { label: "Decision window", cell: c => c.decline_overdue ? `<span class="badge r">Overdue — ${c.decline_days} days in Decline</span>` : "—" }
          ], rows: cands, onRow: c => `/product/${c.id}`, empty: "No product is on the market track yet."
        })}</div>
      </div>
      <div class="card">
        <header><div class="ci" style="background:var(--brand-darker)">${ICON.money}</div><h2>Products in market</h2></header>
        <div class="body flush">${dataTable({
          columns: [
            { label: "Product", cell: p => productLink(p) },
            { label: "State", cell: p => `<span class="badge t">${esc(p.stage_name)}</span>` },
            { label: "Status", cell: p => statusBadge(p.status) },
            { label: "In state", align: "r", cell: p => `${p.age_days} wd` },
            { label: "Deployments", align: "r", cell: p => p.deployments },
            { label: "Effort", align: "r", cell: p => days(p.effort) },
            { label: "Revenue", align: "r", cell: p => money0(p.revenue) },
            { label: "Return", align: "r", cell: p => p.roi ? `<b>${p.roi.toFixed(2)}×</b>` : "—" },
            { label: "Next action", cell: p => `<span class="trunc">${esc(p.next_action || "")}</span>` }
          ], rows: mkt, onRow: p => `/product/${p.id}`, empty: "No product has reached the market track."
        })}</div>
      </div></main>`,
    mount: wireRows
  };
}

/* =================================================================== */
/* REPORTS                                                              */
/* =================================================================== */
export async function reports() {
  const list = await api("/reports");
  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--violet)">${ICON.doc}</div>
        <div><div class="eyebrow">Reporting</div><h1>Reports</h1>
          <div class="desc">The nine standard reports in BRD §17.2, plus the KPI framework. Every report exports to spreadsheet with its
            column headings; RPT-01 reproduces the original workbook column order as its first seventeen columns.</div></div>
      </div>
      <div class="grid g3">
        ${list.map(r => `<div class="card" style="margin:0">
          <header><div class="ci" style="background:var(--violet)">${ICON.doc}</div><h2>${esc(r.key)}</h2></header>
          <div class="body"><b style="font-size:.875rem">${esc(r.title)}</b>
            <p class="note" style="margin-top:.25rem">${esc(r.note)}</p></div>
          <div class="foot" style="display:flex;gap:.5rem;justify-content:center">
            <a class="btn sm brand" href="#/reports/${r.key}">Open</a>
            <a class="btn sm" href="/api/reports/${r.key}?format=csv">Export CSV</a></div>
        </div>`).join("")}
      </div></main>`
  };
}

export async function reportView(key) {
  let r;
  try { r = await api("/reports/" + key); }
  catch (e) { return { html: `<main><div class="card"><div class="empty">${esc(e.message)}</div></div></main>` }; }
  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--violet)">${ICON.doc}</div>
        <div><div class="eyebrow">${esc(r.key)}</div><h1>${esc(r.title)}</h1><div class="desc">${esc(r.note)}</div></div>
        <div class="actions"><a class="btn" href="#/reports">All reports</a>
          <a class="btn brand" href="/api/reports/${r.key}?format=csv">Export CSV</a></div>
      </div>
      <div class="card"><div class="body flush">
        ${r.rows.length ? `<div class="tablewrap"><table class="dt">
          <thead><tr>${r.columns.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
          <tbody>${r.rows.map(row => `<tr>${r.columns.map(c => `<td>${esc(row[c.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>` : `<div class="empty">This report has no rows for the current portfolio.</div>`}
      </div>
      <div class="foot">${r.rows.length} row${r.rows.length === 1 ? "" : "s"} · generated ${fmtDT(new Date().toISOString().replace("T", " ").slice(0, 19))}</div>
      </div></main>`
  };
}
