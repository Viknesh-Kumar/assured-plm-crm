// Shell: session, routing, chrome, and the shared UI primitives used by every view.
import * as V from "./views.js";
import * as SU from "./setup.js";
import * as CRM from "./crm.js";
import * as CS from "./crm-setup.js";
import * as CT from "./content.js";
import * as CTS from "./content-setup.js";

/* ------------------------------- state ------------------------------- */
export const S = { boot: null, products: [], dash: null, params: [], crm: null, crmDash: null, content: null, app: "plm" };

/* ------------------------------- api --------------------------------- */
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api" + path, {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !path.startsWith("/login")) {
    S.boot = null; closeModal();
    document.querySelectorAll(".menu").forEach(m => m.remove());
    renderLogin("Your session has expired. Sign in again.");
    throw new Error("Not signed in.");
  }
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
/** The Content Calendar's configuration, permissions and tab counts — refreshed on every navigation in it. */
export async function contentRefresh() { S.content = await api("/content/bootstrap"); return S.content; }

/** Planning content opens the Content Calendar; it no longer opens the CRM. */
const CONTENT_KEYS = ["crm.content.manage", "content.cadence.manage", "content.setup.manage"];
export const hasCRM = () => !!S.boot?.user?.permissions?.some(p => p.startsWith("crm.") && p !== "crm.content.manage");
export const hasContent = () => !!S.boot?.user?.permissions?.some(p => CONTENT_KEYS.includes(p));

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
    // Pick one row from a long list: narrow by group first, then type a few letters. The group and the
    // search box are display-only; only the chosen id is submitted.
    else if (f.type === "picker") return `<div class="field full" data-picker="${f.name}">${lbl}
        <div class="pickhead">
          <select class="inp" data-pick="group" aria-label="${esc(f.groupLabel || "Group")}">
            <option value="">${esc(f.groupBlank || "All")}</option>
            ${(f.groups || []).map(g => `<option value="${esc(g.value)}" ${String(g.value) === String(f.group ?? "") ? "selected" : ""}>${esc(g.label)}</option>`).join("")}
          </select>
          <input class="inp" type="search" data-pick="q" placeholder="${esc(f.searchPlaceholder || "Type to filter…")}" autocomplete="off">
        </div>
        <select class="inp pickbox" id="${id}" name="${f.name}" size="6" data-pick="list" ${f.required ? "required" : ""}></select>
        <div class="help" data-pick="count"></div>
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
  // Closing a form the user has typed into throws their work away, so ask first.
  let dirty = false;
  dlg.addEventListener("input", () => { dirty = true; }, { once: true });
  const close = ev => {
    if (dirty && !confirm("Discard what you have typed?")) { ev?.preventDefault(); return; }
    dlg.remove();
  };
  dlg.querySelectorAll("[data-close]").forEach(b => b.onclick = () => close());
  dlg.addEventListener("cancel", close);

  for (const f of (cfg.fields || []).filter(x => x.type === "picker")) {
    const wrap = dlg.querySelector(`[data-picker="${f.name}"]`);
    const group = wrap.querySelector('[data-pick="group"]');
    const q = wrap.querySelector('[data-pick="q"]');
    const list = wrap.querySelector('[data-pick="list"]');
    const count = wrap.querySelector('[data-pick="count"]');
    // The chosen row is held here, not read back off the list, so it survives a filter that hides it.
    let chosen = String(f.value ?? "");
    const draw = () => {
      const g = group.value, needle = q.value.trim().toLowerCase();
      const hits = (f.items || []).filter(it =>
        (!g || String(it.group) === g) && (!needle || String(it.label).toLowerCase().includes(needle)));
      const picked = (f.items || []).find(it => String(it.value) === chosen);
      // Whatever is chosen stays in the list even when the current filter would hide it.
      const rows = picked && !hits.some(it => String(it.value) === chosen) ? [picked, ...hits] : hits;
      list.innerHTML = `<option value="">${esc(f.blank || "— none —")}</option>` +
        rows.map(it => `<option value="${esc(it.value)}" ${String(it.value) === chosen ? "selected" : ""}
          title="${esc(it.hint || "")}">${esc(it.label)}</option>`).join("");
      count.textContent = (f.items || []).length
        ? `${hits.length} of ${f.items.length} to choose from${g ? "" : " — pick a channel above to narrow the list"}`
          + (picked ? ` · chosen: ${picked.label}` : "")
        : (f.emptyHint || "Nothing to choose from yet.");
    };
    list.addEventListener("change", () => { chosen = list.value; draw(); });
    group.addEventListener("change", draw);
    q.addEventListener("input", draw);
    draw();
  }

  dlg.querySelector("form").addEventListener("submit", async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = Object.fromEntries(fd.entries());
    // A checkbox name used more than once in the form is a set, not a single value. This covers groups
    // rendered inside an html field, which the declared-field loop below never sees.
    const counts = {};
    ev.target.querySelectorAll('input[type="checkbox"][name]').forEach(i => { counts[i.name] = (counts[i.name] || 0) + 1; });
    for (const [name, n] of Object.entries(counts)) if (n > 1) data[name] = fd.getAll(name);
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
  const restore = () => { try { anchor.focus(); } catch { /* anchor may be gone after a re-render */ } };
  m.addEventListener("keydown", e => { if (e.key === "Escape") { m.remove(); restore(); } });
  const r = anchor.getBoundingClientRect();
  m.style.top = `${r.bottom + window.scrollY + 2}px`;
  m.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - m.offsetWidth - 12))}px`;
  m.addEventListener("click", e => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    m.remove(); items[+b.dataset.i].onClick?.();
  });
  setTimeout(() => {
    m.querySelector("button:not([disabled])")?.focus();
    document.addEventListener("click", function off(e) {
      if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", off); }
    });
  }, 0);
}

/* ------------------------------ tables ------------------------------- */
export function dataTable({ columns, rows, onRow, empty, rowClass, sortKey, sortDir = 1 }) {
  if (!rows.length) return `<div class="empty">${esc(empty || "Nothing to show.")}</div>`;
  return `<div class="tablewrap"><table class="dt">
    <thead><tr>${columns.map(c => `<th class="${c.align || ""} ${c.sort ? "sortable" : ""}" ${c.sort ? `data-sort="${c.sort}"` : ""}
      ${c.sort && sortKey === c.sort ? `aria-sort="${sortDir < 0 ? "descending" : "ascending"}"` : ""}>
      ${esc(c.label)}${c.sort && sortKey === c.sort ? ` <span class="arr">${sortDir < 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead>
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
  [/^\/crm\/reports$/, () => CRM.reports()],
  [/^\/crm\/reports\/([A-Za-z0-9-]+)$/, key => CRM.reportView(key)],
  [/^\/crm\/setup$/, () => CS.setup("pipelines")],
  [/^\/crm\/setup\/(\w+)$/, tab => CS.setup(tab)],
  [/^\/content\/?$/, () => CT.calendar()],
  [/^\/content\/calendar$/, () => CT.calendar()],
  [/^\/content\/topics$/, () => CT.topics()],
  [/^\/content\/tasks$/, () => CT.tasks()],
  [/^\/content\/targets$/, () => CT.targets()],
  [/^\/content\/scorecard$/, () => CT.scorecard()],
  [/^\/content\/item\/(\d+)$/, id => CT.item(Number(id))],
  [/^\/content\/setup$/, () => CTS.setup("types")],
  [/^\/content\/setup\/(\w+)$/, tab => CTS.setup(tab)]
];

/** Where the calendar lived inside the CRM, for bookmarks made before it became its own application. */
const MOVED = [[/^\/crm\/calendar$/, () => "/content/calendar"], [/^\/crm\/content\/(\d+)$/, id => `/content/item/${id}`]];

export const go = hash => { location.hash = hash; };

/** The page shown in place of an application the signed-in person's roles do not open. */
const restricted = (what, how) => chrome("/home") + `<main><div class="card"><div class="empty">
  ${what} is restricted. ${how}
  <div style="margin-top:.75rem">${link("/home", "Go to Product Lifecycle", "btn brand")}</div></div></div></main>`;

let mountFn = null;
export async function render() {
  if (!S.boot) return renderLogin();
  const raw = location.hash.replace(/^#/, "") || "/home";
  // A view may carry a query ("#/products?mine"); it reads that itself. Routing is on the path alone.
  const path = raw.split("?")[0];
  for (const [rx, to] of MOVED) { const m = path.match(rx); if (m) return location.replace("#" + to(...m.slice(1))); }
  S.app = path.startsWith("/crm") ? "crm" : path.startsWith("/content") ? "content" : "plm";
  const app = document.getElementById("app");
  if ((S.app === "crm" && !hasCRM()) || (S.app === "content" && !hasContent())) {
    const which = S.app;
    S.app = "plm";                                    // show the PLM nav, not a nav that loops back here
    app.className = "";
    app.innerHTML = which === "crm"
      ? restricted("The CRM", `Your roles do not carry a lead or CRM Setup permission — ask an administrator to assign
          you <b>CRM Sales User</b> or <b>CRM Administrator</b> in Setup → Users.`)
      : restricted("The Content Calendar", `Your roles do not carry a content permission — ask an administrator to
          assign you <b>Content Manager</b>, or to grant the Content Calendar permissions, in Setup → Users.`);
    wireChrome(); return;
  }
  if (S.app === "crm" && !S.crm) await crmRefresh();
  if (S.app === "content" && !S.content) await contentRefresh();

  let view = null;
  try {
    for (const [rx, fn] of ROUTES) {
      const m = path.match(rx);
      if (m) { view = await fn(...m.slice(1)); break; }
    }
    if (!view) view = { html: `<main><div class="card"><div class="empty">Page not found. ${link("/home", "Back to Home")}</div></div></main>` };
  } catch (e) {
    // A view that throws used to leave the previous screen on a new URL, saying nothing.
    errToast(e);
    view = { html: `<main><div class="card"><div class="empty"><b>This page could not be loaded.</b>
      <div style="margin:.5rem 0">${esc(e.message)}</div>
      <button class="btn" data-a="reload">Try again</button> ${link("/home", "Back to Home", "btn")}</div></div></main>` };
  }
  app.className = "";
  app.innerHTML = chrome(path) + view.html;
  wireChrome();
  document.querySelector('[data-a="reload"]')?.addEventListener("click", () => render());
  mountFn = view.mount || null;
  try { mountFn?.(); } catch (e) { errToast(e); }
  if (!keepScroll) window.scrollTo(0, 0);
  keepScroll = false;
}

/** Set by callers that re-render in place after a mutation, so the reader keeps their position. */
let keepScroll = false;
export const renderInPlace = async () => { keepScroll = true; await render(); };

/** Re-read the bootstrap after an administration change, then repaint. */
export async function reboot(msg) {
  S.boot = await api("/bootstrap");
  if (S.crm) await crmRefresh();
  if (S.content) await contentRefresh();
  if (msg) toast("ok", msg);
  await render();
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
    name: "CRM", sub: "Leads and pipelines",
    tabs: [["/crm/home", "Home"], ["/crm/leads", "Leads"], ["/crm/board", "Pipeline Board"],
      ["/crm/reports", "Reports"], ["/crm/setup", "Setup", "crmsetup"]]
  },
  content: {
    name: "Content Calendar", sub: "Targets, topics, stages and results",
    tabs: [["/content/calendar", "Calendar"], ["/content/topics", "Map topics"], ["/content/tasks", "My tasks", "contentwork"],
      ["/content/targets", "Targets"], ["/content/scorecard", "Scorecard"], ["/content/setup", "Setup", "contentsetup"]]
  }
};
const TABS = APPS.plm.tabs;
/** Whether a tab flagged in APPS is open to the signed-in person. */
const tabAllowed = t => t[2] === "setup" ? can("users.manage") || can("stagemodel.manage") || can("settings.manage")
  : t[2] === "crmsetup" ? can("crm.setup.manage") : t[2] === "contentsetup" ? can("content.setup.manage")
    : t[2] === "contentwork" ? can("crm.content.manage") : true;
const SETUP_HREF = { plm: "/setup/users", crm: "/crm/setup", content: "/content/setup" };
const SETUP_FLAG = { plm: "setup", crm: "crmsetup", content: "contentsetup" };
const SEARCH_LABEL = { plm: "Search products", crm: "Search leads", content: "Search posts by topic, theme or keyword" };

function chrome(raw) {
  const u = me();
  const d = S.dash;
  const queue = (d?.myQueue?.length || 0) + (d?.myConsults?.length || 0) + (d?.killQueue?.length || 0);
  const unread = (d?.notifications || []).filter(n => !n.read).length;
  const badges = S.content?.badges || {};
  const app = APPS[S.app] || APPS.plm;
  return `
  <header class="gheader">
    <button class="waffle" title="App launcher" data-act="launcher">${ICON.waffle}</button>
    <div class="brandmark">${ICON.product}<span>Assured</span></div>
    <div class="gsearch">
      ${ICON.search}
      <input type="search" id="gsearch" placeholder="${SEARCH_LABEL[S.app] || SEARCH_LABEL.plm}…"
        autocomplete="off" aria-label="${SEARCH_LABEL[S.app] || SEARCH_LABEL.plm}">
      <div class="results" id="gresults" hidden></div>
    </div>
    <div class="gright">
      <button class="iconbtn" title="Notifications" data-act="bell">${ICON.bell}${unread ? `<span class="dot">${unread}</span>` : ""}</button>
      ${tabAllowed([null, null, SETUP_FLAG[S.app] || "setup"])
        ? `<a class="iconbtn" href="#${SETUP_HREF[S.app] || SETUP_HREF.plm}" title="Setup">${ICON.gear}</a>` : ""}
      <button class="avatar" title="${esc(u.name)}" data-act="profile">${esc(initials(u.name))}</button>
    </div>
  </header>
  <nav class="navbar">
    <button class="appname" data-act="launcher" title="Switch app">
      <b>${esc(app.name)}</b><span>${esc(setting("org_name", "Assured Grow Consultancy"))}</span></button>
    <div class="tabs">
      ${app.tabs.filter(tabAllowed).map(([href, label]) => {
        const active = raw === href || raw.startsWith(href + "/") ||
          (href === "/products" && raw.startsWith("/product/")) ||
          (href === "/reports" && raw.startsWith("/reports")) ||
          (href === "/setup/users" && raw.startsWith("/setup")) ||
          (href === "/crm/leads" && raw.startsWith("/crm/lead/")) ||
          (href === "/crm/reports" && raw.startsWith("/crm/reports")) ||
          (href === "/crm/setup" && raw.startsWith("/crm/setup")) ||
          (href === "/content/calendar" && (raw === "/content" || raw.startsWith("/content/item/")));
        const n = href === "/gates" ? queue : href === "/content/calendar" ? badges.prompts
          : href === "/content/topics" ? badges.topics : href === "/content/tasks" ? badges.overdue : 0;
        const title = { "/content/calendar": "launch prompts from Product Lifecycle", "/content/topics": "slots in the look-ahead without a topic",
          "/content/tasks": "of your stages are overdue" }[href];
        const cnt = n ? `<span class="cnt ${href === "/content/tasks" ? "r" : ""}" ${title ? `title="${n} ${title}"` : ""}>${n}</span>` : "";
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
    if (S.app === "content") {
      const hits = await api("/content/search?q=" + encodeURIComponent(q));
      if (search.value.trim().toLowerCase() !== q) return;            // a later keystroke has already searched
      results.innerHTML = hits.length
        ? hits.map(c => `<button data-href="/content/item/${c.id}"><div><b>${esc(c.title || "Open slot")}</b></div>
            <div class="code">${esc(fmtDate(c.date))} · ${esc(c.account_name || "")} · ${esc(c.type_name || "")}${
              c.cancelled_at ? " · cancelled" : c.published_on ? " · published" : ""}</div></button>`).join("")
        : `<div class="empty" style="padding:1rem">No post matches “${esc(q)}”.</div>`;
    } else if (S.app === "crm") {
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
  // blur closes it; the 150ms lets the results click handler above run first
  search?.addEventListener("blur", () => setTimeout(() => { if (results) results.hidden = true; }, 150));
  search?.addEventListener("keydown", e => { if (e.key === "Escape" && results) { results.hidden = true; search.blur(); } });

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
    if (hasCRM()) items.push({ label: "CRM — leads and pipelines", onClick: () => go("/crm/home") });
    if (hasContent()) items.push({ label: "Content Calendar", onClick: () => go("/content/calendar") });
    items.push("-", { header: (APPS[S.app] || APPS.plm).name });
    for (const t of (APPS[S.app] || APPS.plm).tabs.filter(tabAllowed)) items.push({ label: t[1], onClick: () => go(t[0]) });
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
    <div class="hint"><b>First sign-in</b> — a clean install carries one account,
      <span class="mono">producthead@assured.local</span>, password <span class="mono">Assured@2026</span>.
      Everyone else is created from that login under Setup → Users. Change the password there before go-live.</div>
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

window.addEventListener("hashchange", async () => {
  // Views read cached state, so refresh before painting: navigating is the natural moment to catch up
  // with what other people have changed. Silent, and a failure must never block the navigation.
  try { await (S.app === "crm" ? crmRefresh() : S.app === "content" ? contentRefresh() : refresh(true)); }
  catch { /* offline or signed out */ }
  render();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".menu").forEach(m => m.remove()); });

(async function start() {
  try { await boot(); }
  catch { renderLogin(); }
})();
