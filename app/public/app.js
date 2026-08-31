// Shell: session, routing, chrome, and the shared UI primitives used by every view.
import * as V from "./views.js";
import * as SU from "./setup.js";
import * as CRM from "./crm.js";
import * as CAL from "./calendar.js";
import * as CS from "./crm-setup.js";

/* ------------------------------- state ------------------------------- */
export const S = { boot: null, products: [], dash: null, params: [], crm: null, crmDash: null, app: "plm" };

/* ------------------------------- api --------------------------------- */
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api" + path, {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !path.startsWith("/login")) { S.boot = null; renderLogin(); throw new Error("Not signed in."); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) { const e = new Error(data.error || "Request failed."); e.rule = data.rule; throw e; }
  return data;
}

/** The CRM's own reference data — loaded on first use, refreshed after any configuration change. */
export async function crmBoot(force) {
  if (force || !S.crm) S.crm = await api("/crm/bootstrap");
  return S.crm;
}
export async function crmRefresh() {
  const [crm, dash] = await Promise.all([api("/crm/bootstrap"), api("/crm/dashboard")]);
  S.crm = crm; S.crmDash = dash;
}
export const crmCan = p => !!S.boot?.user?.permissions?.includes(p);
export const hasCRM = () => ["crm.lead.manage", "crm.content.manage", "crm.setup.manage"].some(crmCan);

/* ---------------------------- formatting ----------------------------- */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtDate = d => d ? new Date(String(d).slice(0, 10) + "T00:00:00Z")
  .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
export const fmtDT = d => d ? new Date(String(d).replace(" ", "T") + "Z")
  .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const cur = () => S.boot?.settings?.currency || "AED";
export const money = n => `${cur()} ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
export const money0 = n => Math.round(Number(n) || 0).toLocaleString("en-US");
export const days = n => `${Math.round((Number(n) || 0) * 10) / 10}`;
export const initials = n => String(n || "?").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
export const can = p => !!S.boot?.user?.permissions?.includes(p);
export const hasRole = id => !!S.boot?.user?.roles?.some(r => r.id === id);
export const me = () => S.boot?.user;
export const stageList = track => S.boot.stages.filter(s => s.track === track).sort((a, b) => a.seq - b.seq);
export const stageById = id => S.boot.stages.find(s => s.id === id);
export const roleName = id => S.boot.roles.find(r => r.id === id)?.name || "—";
export const userName = id => S.boot.users.find(u => u.id === id)?.name || "—";
export const setting = (k, d) => S.boot?.settings?.[k] ?? d;

export const STATUS_CLASS = { Active: "g", "On Hold": "y", Rework: "r", Closed: "n" };
export const statusBadge = s => `<span class="badge dot ${STATUS_CLASS[s] || ""}">${esc(s)}</span>`;
export const trackBadge = t => t === "market"
  ? `<span class="badge t">Market</span>` : `<span class="badge b">Development</span>`;

export const ICON = {
  product: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>`,
  home: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>`,
  gate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 11V7a5 5 0 0110 0v4"/><rect x="4" y="11" width="16" height="10" rx="1"/></svg>`,
  chart: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  gear: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>`,
  bell: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
  waffle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.5"/><circle cx="8" cy="2.5" r="1.5"/><circle cx="13.5" cy="2.5" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13.5" cy="8" r="1.5"/><circle cx="2.5" cy="13.5" r="1.5"/><circle cx="8" cy="13.5" r="1.5"/><circle cx="13.5" cy="13.5" r="1.5"/></svg>`,
  check: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M4 12.5l5.5 5.5L20 6"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l14 14M19 5L5 19"/></svg>`,
  clock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  money: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
  users: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 5.5a3.5 3.5 0 010 7M17.5 20a6.6 6.6 0 00-2-4.5"/></svg>`,
  doc: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 13h6M9 17h4"/></svg>`,
  down: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 8l7 8 7-8"/></svg>`,
  plus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`
};

/* ------------------------------ toasts ------------------------------- */
export function toast(kind, msg, rule) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<div style="flex:1"><b>${esc(msg)}</b>${rule ? `<span class="rule">Business rule ${esc(rule)}</span>` : ""}</div>
    <button class="x" aria-label="Dismiss">${ICON.x}</button>`;
  el.querySelector(".x").onclick = () => el.remove();
  root.appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 9000 : 4500);
}
export const errToast = e => toast("err", e.message || String(e), e.rule);

/* ------------------------------ modals ------------------------------- */
export function closeModal() { document.querySelector("dialog.modal")?.remove(); }

/**
 * openForm({title, intro, rule, size, fields, submit, onSubmit})
 * field: {name,label,type,value,options,required,help,rows,min,step,checked,html,cols}
 */
export function openForm(cfg) {
  closeModal();
  const dlg = document.createElement("dialog");
  dlg.className = "modal " + (cfg.size || "");
  const fieldHtml = f => {
    if (f.type === "html") return `<div class="full">${f.html}</div>`;
    const id = "f_" + f.name;
    const lbl = `<label for="${id}">${f.required ? '<span class="req">*</span>' : ""}${esc(f.label)}</label>`;
    let input;
    if (f.type === "select") input = `<select class="inp" id="${id}" name="${f.name}" ${f.required ? "required" : ""}>
        ${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
    else if (f.type === "textarea") input = `<textarea class="inp" id="${id}" name="${f.name}" rows="${f.rows || 4}"
        ${f.required ? "required" : ""} ${f.minlength ? `minlength="${f.minlength}"` : ""}
        placeholder="${esc(f.placeholder || "")}">${esc(f.value ?? "")}</textarea>`;
    else if (f.type === "checkboxes") return `<div class="field ${f.cols === "full" ? "full" : ""}">${lbl}
        <div style="border:1px solid var(--line-2);border-radius:var(--r);padding:.375rem .625rem;max-height:16rem;overflow:auto">
        ${(f.options || []).map(o => `<label class="checkline">
          <input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${(f.value || []).map(String).includes(String(o.value)) ? "checked" : ""}>
          <span>${esc(o.label)}${o.hint ? `<br><span class="help">${esc(o.hint)}</span>` : ""}</span></label>`).join("")}
        </div>${f.help ? `<div class="help">${esc(f.help)}</div>` : ""}</div>`;
    else if (f.type === "checkbox") return `<div class="field ${f.cols === "full" ? "full" : ""}"><label class="checkline">
        <input type="checkbox" id="${id}" name="${f.name}" ${f.checked ? "checked" : ""}><span>${esc(f.label)}</span></label>
        ${f.help ? `<div class="help">${esc(f.help)}</div>` : ""}</div>`;
    else input = `<input class="inp" id="${id}" name="${f.name}" type="${f.type || "text"}"
        value="${esc(f.value ?? "")}" ${f.required ? "required" : ""} ${f.min !== undefined ? `min="${f.min}"` : ""}
        ${f.max !== undefined ? `max="${f.max}"` : ""} ${f.step ? `step="${f.step}"` : ""}
        ${f.minlength ? `minlength="${f.minlength}"` : ""} placeholder="${esc(f.placeholder || "")}">`;
    return `<div class="field ${f.cols === "full" ? "full" : ""}">${lbl}${input}
      ${f.help ? `<div class="help">${esc(f.help)}</div>` : ""}</div>`;
  };
  dlg.innerHTML = `
    <form method="dialog" id="mform">
      <header><h2>${esc(cfg.title)}</h2><button type="button" class="x" data-close aria-label="Close">${ICON.x}</button></header>
      <div class="mbody">
        ${cfg.rule ? `<div class="rulebox">${cfg.rule}</div>` : ""}
        ${cfg.intro ? `<p class="note" style="margin-bottom:.75rem">${cfg.intro}</p>` : ""}
        <div class="mError"></div>
        <div class="formgrid">${(cfg.fields || []).map(fieldHtml).join("")}</div>
      </div>
      <footer>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn ${cfg.danger ? "danger" : "brand"}">${esc(cfg.submit || "Save")}</button>
      </footer>
    </form>`;
  document.getElementById("modal-root").appendChild(dlg);
  dlg.querySelectorAll("[data-close]").forEach(b => b.onclick = () => dlg.remove());
  dlg.addEventListener("cancel", () => dlg.remove());
  dlg.querySelector("form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = Object.fromEntries(fd.entries());
    for (const f of cfg.fields || []) {
      if (f.type === "checkbox") data[f.name] = fd.has(f.name);
      if (f.type === "checkboxes") data[f.name] = fd.getAll(f.name).map(v => f.numeric ? Number(v) : v);
    }
    const btn = ev.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try { await cfg.onSubmit(data, dlg); dlg.remove(); }
    catch (e) {
      btn.disabled = false;
      dlg.querySelector(".mError").innerHTML = `<div class="errbox"><b>${esc(e.message)}</b>${e.rule ? ` <span class="mono">(${esc(e.rule)})</span>` : ""}</div>`;
      dlg.querySelector(".mbody").scrollTop = 0;
    }
  });
  dlg.showModal();
  setTimeout(() => dlg.querySelector(".inp:not([readonly])")?.focus(), 30);
  return dlg;
}

export function openPanel({ title, html, size, footer }) {
  closeModal();
  const dlg = document.createElement("dialog");
  dlg.className = "modal " + (size || "lg");
  dlg.innerHTML = `<header><h2>${esc(title)}</h2><button class="x" data-close>${ICON.x}</button></header>
    <div class="mbody">${html}</div>
    <footer>${footer || '<button class="btn" data-close>Close</button>'}</footer>`;
  document.getElementById("modal-root").appendChild(dlg);
  dlg.querySelectorAll("[data-close]").forEach(b => b.onclick = () => dlg.remove());
  dlg.addEventListener("cancel", () => dlg.remove());
  dlg.showModal();
  return dlg;
}

export function confirmAction({ title, body, submit, danger, onConfirm }) {
  return openForm({
    title, size: "sm", intro: body, submit: submit || "Confirm", danger, fields: [], onSubmit: onConfirm
  });
}

/* dropdown menu anchored to a button */
export function openMenu(anchor, items) {
  document.querySelectorAll(".menu").forEach(m => m.remove());
  const m = document.createElement("div");
  m.className = "menu";
  m.innerHTML = items.map(i => i === "-" ? `<div class="sep"></div>`
    : i.header ? `<div class="hd">${esc(i.header)}</div>`
      : `<button ${i.disabled ? "disabled" : ""} data-i="${items.indexOf(i)}">${esc(i.label)}</button>`).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = `${r.bottom + window.scrollY + 2}px`;
  m.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - m.offsetWidth - 12))}px`;
  m.addEventListener("click", e => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    m.remove(); items[+b.dataset.i].onClick?.();
  });
  setTimeout(() => document.addEventListener("click", function off(e) {
    if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", off); }
  }), 0);
}

/* ------------------------------ tables ------------------------------- */
export function dataTable({ columns, rows, onRow, empty, rowClass, sortKey }) {
  if (!rows.length) return `<div class="empty">${esc(empty || "Nothing to show.")}</div>`;
  return `<div class="tablewrap"><table class="dt">
    <thead><tr>${columns.map(c => `<th class="${c.align || ""} ${c.sort ? "sortable" : ""}" ${c.sort ? `data-sort="${c.sort}"` : ""}>
      ${esc(c.label)}${sortKey === c.sort ? ' <span class="arr">▼</span>' : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${onRow ? "click" : ""} ${rowClass ? rowClass(r) : ""}" ${onRow ? `data-row="${onRow(r)}"` : ""}>
      ${columns.map(c => `<td class="${c.align || ""}">${c.cell(r)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

export const link = (href, label, cls = "") => `<a href="#${href}" class="${cls}">${esc(label)}</a>`;
export const productLink = p => `<a href="#/product/${p.id}"><b>${esc(p.code)}</b></a> ${esc(p.name)}`;
export const bar = (pct, cls = "") => `<div class="progress ${pct >= 1 ? "full" : ""} ${cls}"><i style="width:${Math.round(pct * 100)}%"></i></div>`;

/* --------------------------- path component -------------------------- */
export function pathComponent(p) {
  const dev = stageList("development"), mkt = stageList("market");
  const entrySeq = p.entry_seq || 1;
  const step = (s, cls, sub) => `<div class="step ${cls}" title="${esc(s.name + (s.approver_role ? " — approver: " + s.approver_role : " — no approver (market state)"))}">
      <span class="n">${sub}</span> ${esc(s.name)}</div>`;
  const devHtml = dev.map(s => {
    let cls = "";
    if (p.track === "development" && p.stage_id === s.id) cls = "cur";
    else if (s.seq < entrySeq) cls = "skip";
    else if (p.track === "market" || (p.track === "development" && s.seq < p.stage_seq)) cls = "done";
    return step(s, cls, String(s.seq).padStart(2, "0"));
  }).join("");
  const mktHtml = mkt.map(s => {
    let cls = "mkt";
    if (p.track === "market" && p.stage_id === s.id) cls += " cur" + (s.seq === 6 ? " end" : "");
    else if (p.track === "market" && s.seq < p.stage_seq) cls += " done";
    return step(s, cls, "—");
  }).join("");
  return `<div class="pathwrap">
    <div class="pathsplit">
      <div>
        <div class="pathlbl"><span class="t">Development · gated</span>
          <span class="d">advances only on the named approver's sign-off against written exit criteria</span></div>
        <div class="path">${devHtml}</div>
      </div>
      <div class="sep">FIRST PAID DEPLOYMENT</div>
      <div>
        <div class="pathlbl"><span class="t">Market · state</span>
          <span class="d">no approver — set on deployment and revenue evidence</span></div>
        <div class="path">${mktHtml}</div>
      </div>
    </div>
  </div>`;
}

/* ------------------------------ routing ------------------------------ */
const ROUTES = [
  [/^\/?$/, () => V.home()],
  [/^\/home$/, () => V.home()],
  [/^\/products$/, () => V.products()],
  [/^\/product\/(\d+)$/, id => V.product(Number(id))],
  [/^\/gates$/, () => V.gates()],
  [/^\/market$/, () => V.market()],
  [/^\/reports$/, () => V.reports()],
  [/^\/reports\/([A-Za-z0-9-]+)$/, key => V.reportView(key)],
  [/^\/setup$/, () => SU.setup("users")],
  [/^\/setup\/(\w+)$/, tab => SU.setup(tab)],
  [/^\/crm\/?$/, () => CRM.dashboard()],
  [/^\/crm\/home$/, () => CRM.dashboard()],
  [/^\/crm\/leads$/, () => CRM.leads()],
  [/^\/crm\/lead\/(\d+)$/, id => CRM.lead(Number(id))],
  [/^\/crm\/board$/, () => CRM.board()],
  [/^\/crm\/calendar$/, () => CAL.calendar()],
  [/^\/crm\/content\/(\d+)$/, id => CAL.contentRecord(Number(id))],
  [/^\/crm\/reports$/, () => CRM.reports()],
  [/^\/crm\/reports\/([A-Za-z0-9-]+)$/, key => CRM.reportView(key)],
  [/^\/crm\/setup$/, () => CS.setup("pipelines")],
  [/^\/crm\/setup\/(\w+)$/, tab => CS.setup(tab)]
];

export const go = hash => { location.hash = hash; };

let mountFn = null;
export async function render() {
  if (!S.boot) return renderLogin();
  const raw = location.hash.replace(/^#/, "") || "/home";
  S.app = raw.startsWith("/crm") ? "crm" : "plm";
  const app = document.getElementById("app");
  if (S.app === "crm") {
    if (!hasCRM()) {
      app.className = "";
      app.innerHTML = chrome("/home") + `<main><div class="card"><div class="empty">
        The CRM is restricted. Your roles do not carry any <span class="mono">crm.*</span> permission —
        ask an administrator to assign you <b>CRM Sales User</b> or <b>CRM Administrator</b> in Setup → Users.</div></div></main>`;
      wireChrome(); return;
    }
    if (!S.crm) await crmRefresh();
  }
  let view = null;
  for (const [rx, fn] of ROUTES) {
    const m = raw.match(rx);
    if (m) { view = await fn(...m.slice(1)); break; }
  }
  if (!view) view = { html: `<main><div class="card"><div class="empty">Page not found. ${link("/home", "Back to Home")}</div></div></main>` };
  app.className = "";
  app.innerHTML = chrome(raw) + view.html;
  wireChrome();
  mountFn = view.mount || null;
  mountFn?.();
  window.scrollTo(0, 0);
}

export async function refresh(silent) {
  const [products, dash] = await Promise.all([api("/products"), api("/dashboard")]);
  S.products = products; S.dash = dash;
  if (!silent) await render();
}

/* ------------------------------- chrome ------------------------------ */
export const APPS = {
  plm: {
    name: "Product Lifecycle", sub: "Idea to withdrawal, gated",
    tabs: [["/home", "Home"], ["/products", "Products"], ["/gates", "Gate Reviews"],
      ["/market", "Market Track"], ["/reports", "Reports"], ["/setup/users", "Setup", "setup"]]
  },
  crm: {
    name: "CRM & Content", sub: "Leads, pipelines and the content calendar",
    tabs: [["/crm/home", "Home"], ["/crm/leads", "Leads"], ["/crm/board", "Pipeline Board"],
      ["/crm/calendar", "Content Calendar"], ["/crm/reports", "Reports"], ["/crm/setup", "Setup", "crmsetup"]]
  }
};
const TABS = APPS.plm.tabs;

function chrome(raw) {
  const u = me();
  const d = S.dash;
  const queue = (d?.myQueue?.length || 0) + (d?.myConsults?.length || 0) + (d?.killQueue?.length || 0);
  const unread = (d?.notifications || []).filter(n => !n.read).length;
  const prompts = S.crmDash?.kpi?.prompts || 0;
  const setupAllowed = can("users.manage") || can("stagemodel.manage") || can("settings.manage");
  const crmSetupAllowed = can("crm.setup.manage");
  const app = APPS[S.app] || APPS.plm;
  const allowTab = t => t[2] === "setup" ? setupAllowed : t[2] === "crmsetup" ? crmSetupAllowed : true;
  return `
  <header class="gheader">
    <button class="waffle" title="App launcher" data-act="launcher">${ICON.waffle}</button>
    <div class="brandmark">${ICON.product}<span>Assured</span></div>
    <div class="gsearch">
      ${ICON.search}
      <input type="search" id="gsearch" placeholder="${S.app === "crm" ? "Search leads…" : "Search products…"}"
        autocomplete="off" aria-label="${S.app === "crm" ? "Search leads" : "Search products"}">
      <div class="results" id="gresults" hidden></div>
    </div>
    <div class="gright">
      <button class="iconbtn" title="Notifications" data-act="bell">${ICON.bell}${unread ? `<span class="dot">${unread}</span>` : ""}</button>
      ${(S.app === "crm" ? crmSetupAllowed : setupAllowed)
        ? `<a class="iconbtn" href="#${S.app === "crm" ? "/crm/setup" : "/setup/users"}" title="Setup">${ICON.gear}</a>` : ""}
      <button class="avatar" title="${esc(u.name)}" data-act="profile">${esc(initials(u.name))}</button>
    </div>
  </header>
  <nav class="navbar">
    <button class="appname" data-act="launcher" title="Switch app">
      <b>${esc(app.name)}</b><span>${esc(setting("org_name", "Assured Grow Consultancy"))}</span></button>
    <div class="tabs">
      ${app.tabs.filter(allowTab).map(([href, label]) => {
        const active = raw === href || raw.startsWith(href + "/") ||
          (href === "/products" && raw.startsWith("/product/")) ||
          (href === "/reports" && raw.startsWith("/reports")) ||
          (href === "/setup/users" && raw.startsWith("/setup")) ||
          (href === "/crm/leads" && raw.startsWith("/crm/lead/")) ||
          (href === "/crm/calendar" && raw.startsWith("/crm/content/")) ||
          (href === "/crm/reports" && raw.startsWith("/crm/reports")) ||
          (href === "/crm/setup" && raw.startsWith("/crm/setup"));
        const cnt = href === "/gates" && queue ? `<span class="cnt">${queue}</span>`
          : href === "/crm/calendar" && prompts ? `<span class="cnt">${prompts}</span>` : "";
        return `<a href="#${href}" ${active ? 'aria-current="page"' : ""}>${esc(label)}${cnt}</a>`;
      }).join("")}
    </div>
  </nav>`;
}

function wireChrome() {
  const search = document.getElementById("gsearch");
  const results = document.getElementById("gresults");
  let leadCache = null;
  const runSearch = async () => {
    const q = search.value.trim().toLowerCase();
    if (q.length < 2) { results.hidden = true; return; }
    if (S.app === "crm") {
      if (!leadCache) leadCache = await api("/crm/leads");
      const hits = leadCache.filter(l => (l.company + " " + (l.customer || "") + " " + (l.email || "") + " " +
        (l.offering_name || "")).toLowerCase().includes(q)).slice(0, 12);
      results.innerHTML = hits.length
        ? hits.map(l => `<button data-href="/crm/lead/${l.id}"><div><b>${esc(l.company)}</b></div>
            <div class="code">${esc(l.customer || "no contact")} · ${esc(l.stage_name || "unassigned")} · ${esc(l.status)}</div></button>`).join("")
        : `<div class="empty" style="padding:1rem">No lead matches “${esc(q)}”.</div>`;
    } else {
      const hits = S.products.filter(p => (p.code + " " + p.name + " " + (p.client_source || "") + " " + p.problem)
        .toLowerCase().includes(q)).slice(0, 12);
      results.innerHTML = hits.length
        ? hits.map(p => `<button data-href="/product/${p.id}"><div><b>${esc(p.name)}</b></div>
            <div class="code">${esc(p.code)} · ${esc(p.stage_name)} · ${esc(p.status)}</div></button>`).join("")
        : `<div class="empty" style="padding:1rem">No product matches “${esc(q)}”.</div>`;
    }
    results.hidden = false;
  };
  search?.addEventListener("input", runSearch);
  search?.addEventListener("focus", runSearch);
  results?.addEventListener("click", e => {
    const b = e.target.closest("button[data-href]"); if (!b) return;
    results.hidden = true; search.value = ""; go(b.dataset.href);
  });
  document.addEventListener("click", e => {
    if (!results?.contains(e.target) && e.target !== search) results && (results.hidden = true);
  }, { once: true });

  document.querySelector('[data-act="profile"]')?.addEventListener("click", e => {
    const u = me();
    openMenu(e.currentTarget, [
      { header: `${u.name} — ${u.email}` },
      { header: `Roles: ${u.roles.map(r => r.name).join(", ") || "none"}` },
      "-",
      { label: "Change my password", onClick: changePassword },
      { label: "My products", onClick: () => go("/products?mine") },
      "-",
      { label: "Sign out", onClick: async () => { await api("/logout", { method: "POST" }); S.boot = null; renderLogin(); } }
    ]);
  });

  document.querySelector('[data-act="bell"]')?.addEventListener("click", async e => {
    const list = S.dash?.notifications || [];
    openPanel({
      title: "Notifications", size: "",
      html: list.length ? `<div class="card" style="margin:0"><div class="body flush">${list.map(n => `
        <div class="rrow">
          <div class="ic" style="background:${n.read ? "#C9C9C9" : "#0176D3"}">${ICON.bell}</div>
          <div class="b"><b>${esc(n.text)}</b><div class="m">${fmtDT(n.created_at)}</div></div>
          ${n.product_id ? `<div class="r"><a href="#/product/${n.product_id}" onclick="document.querySelector('dialog.modal')?.remove()">Open</a></div>` : ""}
        </div>`).join("")}</div></div>` : `<div class="empty">No notifications.</div>`
    });
    await api("/notifications/read", { method: "POST" });
    await refresh(true);
    document.querySelector('[data-act="bell"] .dot')?.remove();
  });

  document.querySelectorAll('[data-act="launcher"]').forEach(el => el.addEventListener("click", e => {
    const items = [{ header: "Apps" },
      { label: "Product Lifecycle — PLM", onClick: () => go("/home") }];
    if (hasCRM()) items.push({ label: "CRM & Content Calendar", onClick: () => go("/crm/home") });
    items.push("-", { header: (APPS[S.app] || APPS.plm).name });
    for (const t of (APPS[S.app] || APPS.plm).tabs) {
      if (t[2] === "setup" && !can("users.manage") && !can("stagemodel.manage") && !can("settings.manage")) continue;
      if (t[2] === "crmsetup" && !can("crm.setup.manage")) continue;
      items.push({ label: t[1], onClick: () => go(t[0]) });
    }
    openMenu(e.currentTarget, items);
  }));
}

function changePassword() {
  openForm({
    title: "Change my password", size: "sm",
    fields: [
      { name: "current", label: "Current password", type: "password", required: true, cols: "full" },
      { name: "password", label: "New password", type: "password", required: true, minlength: 8, cols: "full", help: "At least 8 characters (NFR-06)." }
    ],
    submit: "Change password",
    onSubmit: async d => { await api("/password", { method: "POST", body: d }); toast("ok", "Password changed."); }
  });
}

/* ------------------------------- login ------------------------------- */
export function renderLogin(msg) {
  const app = document.getElementById("app");
  app.className = "";
  app.innerHTML = `<div class="login-wrap"><form class="login" id="loginform">
    <div class="logo"><div class="tile">${ICON.product}</div>
      <div><h1>Assured PLM</h1><div class="sub">Product Lifecycle Management Tracking System</div></div></div>
    ${msg ? `<div class="errbox">${esc(msg)}</div>` : ""}
    <div id="loginerr"></div>
    <div class="field"><label for="email">Email</label>
      <input class="inp" id="email" name="email" type="email" required autocomplete="username" autofocus></div>
    <div class="field"><label for="password">Password</label>
      <input class="inp" id="password" name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn brand" style="width:100%;height:2.25rem" type="submit">Sign in</button>
    <div class="hint"><b>Seeded accounts</b> — solutions.head@assured.local · business.head@assured.local ·
      ceo@assured.local · finance.head@assured.local · projects.head@assured.local · consultant1@assured.local.
      Default password <span class="mono">Assured@2026</span>. Change it under Setup at go-live.</div>
  </form></div>`;
  document.getElementById("loginform").addEventListener("submit", async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const r = await api("/login", { method: "POST", body: d });
      await boot();
      if (r.must_change) toast("info", "This account still uses its seeded password. Change it from the avatar menu.");
    } catch (err) {
      btn.disabled = false;
      document.getElementById("loginerr").innerHTML = `<div class="errbox">${esc(err.message)}</div>`;
    }
  });
}

/* -------------------------------- boot ------------------------------- */
export async function boot() {
  S.boot = await api("/bootstrap");
  await refresh(true);
  await render();
}

window.addEventListener("hashchange", () => render());
document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".menu").forEach(m => m.remove()); });

(async function start() {
  try { await boot(); }
  catch { renderLogin(); }
})();
