// Content Calendar — Setup. Content types and their stage lists (readiness %, TAT, owner role, parent stage),
// accounts, platforms, metrics, holidays and the calendar rules. Everything that shapes the calendar is
// configured here; the server checks every save (CC-01 … CC-09) and this screen quotes its refusals.
import { S, api, esc, can, ICON, toast, errToast, openForm, confirmAction, dataTable, renderInPlace, contentRefresh } from "./app.js";
import { addDays, fdw, fdy, acctTag, platTag, ruleTag } from "./content.js";

const B = () => S.content;
const setting = k => B().settings.find(s => s.key === k)?.value ?? "";
const after = async msg => { await contentRefresh(); await renderInPlace(); if (msg) toast("ok", msg); };
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TABS = [["types", "Content types & stages"], ["accounts", "Accounts"], ["platforms", "Platforms"],
  ["metrics", "Metrics"], ["rules", "Rules & holidays"]];

export async function setup(tab = "types") {
  if (!can("content.setup.manage"))
    return { html: `<main><div class="card"><div class="empty">Content Calendar Setup needs <b>Configure content types, stages,
      accounts, platforms, metrics and rules</b> (content.setup.manage). The Product Head holds it by default.</div></div></main>` };
  if (!TABS.some(t => t[0] === tab)) tab = "types";
  const body = ({ types: typesTab, accounts: accountsTab, platforms: platformsTab, metrics: metricsTab, rules: rulesTab }[tab])();
  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--ink-3)">${ICON.gear}</div>
        <div><div class="eyebrow">Content Calendar</div><h1>Setup</h1>
          <div class="desc">Content types and their stages, readiness and turnaround times, the accounts posts go out from, the
            platforms and the figures each reports, holidays, and the rules that turn a posting date into deadlines. Every
            change here is audited, and posts not yet in production pick up a changed stage list.</div></div>
      </div>
      <div class="card">
        <div class="rtabs">${TABS.map(([k, l]) =>
          `<a href="#/content/setup/${k}" style="text-decoration:none"><button aria-selected="${tab === k}">${esc(l)}</button></a>`).join("")}</div>
        <div class="body">${body.html}</div>
      </div></main>`,
    mount: body.mount
  };
}

/* ---------------------------------------------------------------- */
/* content types and their stage lists                                */
/* ---------------------------------------------------------------- */
let typeId = null, draft = null, dirty = false, example = null;

const managerRole = () => Number(setting("content_manager_role")) || null;
const starter = () => [
  { id: null, name: "Topic, theme & keyword mapped", kind: "topic", pct: 10, tat_days: Number(setting("content_topic_tat_default")) || 0,
    owner_role_id: managerRole(), parent_stage_id: null },
  { id: null, name: "Published", kind: "publish", pct: 100, tat_days: 0, owner_role_id: managerRole(), parent_stage_id: null }];

/** A preview only — the server computes every real deadline. Same rule: back off weekends and holidays, never forward. */
function dueFor(post, tat) {
  const weekend = new Set(setting("content_weekend_days").split(",").filter(Boolean).map(Number));
  const holidays = new Set(B().holidays.map(h => h.date));
  const off = d => weekend.has(new Date(d + "T00:00:00Z").getUTCDay()) || holidays.has(d);
  let d = addDays(post, -tat);
  if (!tat) return d;
  for (let guard = 0; guard < 366 && off(d); guard++) d = addDays(d, -1);
  return d;
}

function typesTab() {
  const b = B();
  if (!b.types.some(t => t.id === typeId)) { typeId = (b.types.find(t => t.active && t.stages.length) || b.types[0])?.id ?? null; draft = null; }
  const type = b.types.find(t => t.id === typeId);
  if (!draft && type) draft = type.stages.length ? type.stages.map(s => ({ id: s.id, name: s.name, kind: s.kind, pct: s.pct,
    tat_days: s.tat_days, owner_role_id: s.owner_role_id, parent_stage_id: s.parent_stage_id })) : starter();
  example ||= addDays(b.today, 120);
  const parentChoices = b.types.filter(t => t.id !== typeId)
    .flatMap(t => t.stages.filter(s => s.kind === "work" || s.kind === "publish").map(s => ({ value: s.id, label: `${t.name} → ${s.name}` })));

  const rows = () => draft.map((r, k) => {
    const fixed = r.kind === "topic" || r.kind === "publish";
    const tat = Number(r.tat_days);
    const due = Number.isInteger(tat) && tat >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(example) ? fdw(dueFor(example, tat)) : "—";
    return `<tr data-k="${k}">
      <td class="c">${k + 1}</td>
      <td><input class="inp" data-f="name" value="${esc(r.name)}" aria-label="Stage name"></td>
      <td>${fixed ? `<span class="badge ${r.kind === "topic" ? "v" : "g"}">${r.kind === "topic" ? "Topic" : "Publish"}</span>`
        : `<select class="inp" data-f="kind" aria-label="Kind"><option value="work" ${r.kind === "work" ? "selected" : ""}>Work</option>
            <option value="parent" ${r.kind === "parent" ? "selected" : ""}>From parent</option></select>`}</td>
      <td class="r"><input class="inp num n4" type="number" min="0" max="100" step="1" data-f="pct" value="${esc(r.pct)}" aria-label="Readiness percent" ${r.kind === "publish" ? "readonly" : ""}></td>
      <td class="r"><input class="inp num n4" type="number" min="0" max="366" step="1" data-f="tat_days" value="${esc(r.tat_days)}" aria-label="TAT in days" ${r.kind === "publish" ? "readonly" : ""}></td>
      <td><select class="inp" data-f="owner_role_id" aria-label="Owner role">${b.roles.map(o =>
        `<option value="${o.id}" ${o.id === Number(r.owner_role_id) ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></td>
      <td>${r.kind === "parent" ? `<select class="inp" data-f="parent_stage_id" aria-label="Waits on"><option value="">Choose…</option>
        ${parentChoices.map(c => `<option value="${c.value}" ${c.value === Number(r.parent_stage_id) ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>`
        : `<span class="help">—</span>`}</td>
      <td class="r"><div class="btngroup">${fixed ? "" : `
        <button class="btn sm" data-move="-1" ${k <= 1 ? "disabled" : ""} aria-label="Move up">↑</button>
        <button class="btn sm" data-move="1" ${k >= draft.length - 2 ? "disabled" : ""} aria-label="Move down">↓</button>
        <button class="btn sm danger" data-del aria-label="Remove stage">✕</button>`}</div></td>
      <td class="num">${due}</td></tr>`;
  }).join("");

  return {
    html: `
      <div class="infobox">Each content type has its own stages. A stage carries the readiness a post reaches when it is done, its
        turnaround time (TAT) in days before posting, the role whose task it becomes, and — for a stage like a reel's raw footage —
        the stage of another type it waits on. The topic stage comes first and publishing last, at 100% and TAT 0. Saving a list
        applies it to every post not yet in production; posts in production keep the copy they started with.</div>
      <div class="lvhead" style="padding:0 0 .5rem;border:none;flex-wrap:wrap">
        <div class="chips">${b.types.map(t => `<button class="chip" data-type="${t.id}" aria-pressed="${t.id === typeId}">${esc(t.name)}
          <span class="n">${t.stages.length || "no stages"}</span>${t.active ? "" : " · inactive"}</button>`).join("")}</div>
        <span class="spacer"></span>
        <button class="btn" data-a="newtype">${ICON.plus} Content type</button>
      </div>
      ${type ? `<div class="card" style="margin:0">
        <header><h2>${esc(type.name)}</h2><span class="sub">${type.active ? "" : "inactive · "}used by ${type.uses} record${type.uses === 1 ? "" : "s"}</span>
          <div class="right btngroup">
            <button class="btn sm" data-a="renametype">Rename</button>
            <button class="btn sm" data-a="toggletype">${type.active ? "Deactivate" : "Activate"}</button>
            <button class="btn sm danger" data-a="deltype" ${type.uses ? `disabled title="Used by ${type.uses} record(s) — deactivate it instead (CC-09)"` : ""}>Delete</button>
          </div></header>
        ${!type.stages.length ? `<div class="warnbox" style="margin:.75rem .75rem 0">${esc(type.name)} has no stage list yet, so nothing of this type can be
          planned or targeted. Start from the two stages below, add the work in between, and save.</div>` : ""}
        <div class="tablewrap"><table class="dt stg"><thead><tr><th class="c">#</th><th>Stage</th><th>Kind</th><th class="r">Readiness %</th>
          <th class="r">TAT (days before posting)</th><th>Owner role</th><th>Waits on</th><th></th>
          <th>Due for a post on <input class="inp sm" type="date" id="example" value="${esc(example)}" style="width:auto;display:inline-block"></th></tr></thead>
          <tbody id="stgrows">${rows()}</tbody></table></div>
        <div class="inline" style="padding:.625rem .75rem;border-top:1px solid var(--line)">
          <button class="btn" data-a="addstage">${ICON.plus} Add a stage</button>
          <button class="btn brand" data-a="savestages">Save stage list</button>
          <button class="btn" data-a="discard">Discard changes</button>
          <span class="note">${["CC-01", "CC-02", "CC-03", "CC-04", "CC-05", "CC-06"].map(ruleTag).join(" ")} Readiness rises at every stage;
            TAT never grows down the list; deadlines on weekends and holidays move earlier.</span>
        </div></div>`
        : `<div class="empty">No content type yet. Add one, then give it a stage list.</div>`}`,
    mount() {
      const tbody = document.getElementById("stgrows");
      const redraw = () => { tbody.innerHTML = rows(); wire(); };
      // Typed values go into the draft without a repaint, so focus stays where it is.
      tbody?.addEventListener("input", e => {
        const tr = e.target.closest("tr[data-k]"), f = e.target.dataset.f;
        if (!tr || !f || e.target.tagName === "SELECT") return;
        draft[+tr.dataset.k][f] = e.target.value; dirty = true;
        if (f === "tat_days") tr.lastElementChild.textContent = (() => { const t = Number(e.target.value);
          return Number.isInteger(t) && t >= 0 ? fdw(dueFor(example, t)) : "—"; })();
      });
      tbody?.addEventListener("change", e => {
        const tr = e.target.closest("tr[data-k]"), f = e.target.dataset.f;
        if (!tr || !f || e.target.tagName !== "SELECT") return;
        const r = draft[+tr.dataset.k];
        r[f] = e.target.value; dirty = true;
        if (f === "kind") { if (r.kind !== "parent") r.parent_stage_id = null; redraw(); }
      });
      const wire = () => {
        tbody?.querySelectorAll("[data-move]").forEach(el => el.onclick = () => {
          const k = +el.closest("tr").dataset.k, d = +el.dataset.move;
          [draft[k], draft[k + d]] = [draft[k + d], draft[k]]; dirty = true; redraw();
        });
        tbody?.querySelectorAll("[data-del]").forEach(el => el.onclick = () => {
          draft.splice(+el.closest("tr").dataset.k, 1); dirty = true; redraw();
        });
      };
      wire();
      document.getElementById("example")?.addEventListener("change", e => { example = e.target.value; redraw(); });
      const switchTo = id => { typeId = id; draft = null; dirty = false; renderInPlace(); };
      document.querySelectorAll("[data-type]").forEach(el => el.onclick = () => {
        const id = Number(el.dataset.type);
        if (id === typeId) return;
        if (!dirty) return switchTo(id);
        confirmAction({ title: "Discard unsaved stage edits?", danger: true, submit: "Discard and switch",
          body: `The changes to ${esc(type.name)} have not been saved. Switching type loses them.`, onConfirm: async () => switchTo(id) });
      });
      document.querySelector('[data-a="addstage"]')?.addEventListener("click", () => {
        const before = draft.at(-2) || draft[0];
        draft.splice(draft.length - 1, 0, { id: null, name: "New stage", kind: "work", pct: Math.min(99, Number(before.pct) + 5),
          tat_days: Math.max(1, Math.floor(Number(before.tat_days) / 2)), owner_role_id: managerRole(), parent_stage_id: null });
        dirty = true; redraw();
      });
      document.querySelector('[data-a="discard"]')?.addEventListener("click", () => { draft = null; dirty = false; renderInPlace(); });
      document.querySelector('[data-a="savestages"]')?.addEventListener("click", async () => {
        try {
          const r = await api(`/content/types/${typeId}/stages`, { method: "POST", body: { stages: draft } });
          draft = null; dirty = false;
          await after(`${type.name}: ${r.stages.length} stages saved, applied to ${r.applied} post${r.applied === 1 ? "" : "s"} not yet in production.`);
        } catch (e) { errToast(e); }
      });
      const typeForm = t => openForm({
        title: t ? `Rename “${t.name}”` : "Add a content type", size: "sm",
        intro: t ? undefined : "It needs a stage list before anything of this type can be planned or targeted.",
        fields: [{ name: "name", label: "Name", required: true, cols: "full", value: t?.name || "",
          placeholder: "e.g. Long-form video, Reel, Carousel" }],
        submit: t ? "Save" : "Add",
        onSubmit: async d => {
          const saved = await api(t ? `/content/types/${t.id}` : "/content/types", { method: t ? "PATCH" : "POST", body: d });
          if (!t) { typeId = saved.id; draft = null; dirty = false; }
          await after(t ? "Content type renamed." : `“${saved.name}” added — give it a stage list.`);
        }
      });
      document.querySelector('[data-a="newtype"]')?.addEventListener("click", () => typeForm(null));
      document.querySelector('[data-a="renametype"]')?.addEventListener("click", () => typeForm(type));
      document.querySelector('[data-a="toggletype"]')?.addEventListener("click", async () => {
        try { await api(`/content/types/${type.id}`, { method: "PATCH", body: { name: type.name, active: !type.active } });
          await after(type.active ? `“${type.name}” deactivated — it is no longer offered, and stays on what already uses it.` : `“${type.name}” activated.`); }
        catch (e) { errToast(e); }
      });
      document.querySelector('[data-a="deltype"]')?.addEventListener("click", () => confirmAction({
        title: `Delete “${type.name}”`, danger: true, submit: "Delete", body: "Nothing uses it, so it can be removed outright.",
        onConfirm: async () => { await api(`/content/types/${type.id}`, { method: "DELETE" }); typeId = null; draft = null; await after("Content type deleted."); }
      }));
    }
  };
}

/* ---------------------------------------------------------------- */
/* accounts                                                           */
/* ---------------------------------------------------------------- */
function accountsTab() {
  const b = B();
  const form = a => openForm({
    title: a ? `Edit ${a.name}` : "Add an account", size: "",
    rule: `<b>CC-07.</b> An account is where a post goes out from: the company's, or a person's own profile.`,
    fields: [
      { name: "name", label: "Name", required: true, value: a?.name || "" },
      { name: "kind", label: "Kind", type: "select", value: a?.kind || "Company",
        options: [{ value: "Company", label: "Company" }, { value: "Personal", label: "Personal" }] },
      { name: "person_id", label: "Whose profile (personal accounts)", type: "select", value: String(a?.person_id || ""),
        options: [{ value: "", label: "— none —" }, ...b.people.filter(p => p.active || p.id === a?.person_id).map(p => ({ value: p.id, label: p.name }))] },
      { name: "colour", label: "Colour on the calendar", type: "color", value: a?.colour || "#5C5C5C" },
      ...(a ? [{ name: "active", label: "Active — offered for new posts and targets", type: "checkbox", checked: !!a.active, cols: "full" }] : [])
    ],
    submit: a ? "Save" : "Add account",
    onSubmit: async d => {
      await api(a ? `/content/accounts/${a.id}` : "/content/accounts", { method: a ? "PATCH" : "POST", body: d });
      await after(a ? "Account updated." : "Account added.");
    }
  });
  return {
    html: `
      <div class="lvhead" style="padding:0 0 .5rem;border:none">
        <span class="count">Assured, Siddique and Dhiraj ship as named. An account is deactivated, never deleted — its posts keep it.</span>
        <span class="spacer"></span><button class="btn brand" data-a="new">${ICON.plus} Account</button></div>
      ${dataTable({ columns: [
        { label: "Account", cell: a => acctTag(a.id) }, { label: "Kind", cell: a => `<span class="badge">${esc(a.kind)}</span>` },
        { label: "Profile of", cell: a => esc(a.person_name || "—") }, { label: "Posts", align: "r", cell: a => a.uses },
        { label: "Status", cell: a => a.active ? `<span class="badge dot g">Active</span>` : `<span class="badge dot n">Inactive</span>` },
        { label: "", align: "r", cell: a => `<button class="btn sm" data-edit="${a.id}">Edit</button>` }
      ], rows: b.accounts, empty: "No accounts." })}`,
    mount() {
      document.querySelector('[data-a="new"]').onclick = () => form(null);
      document.querySelectorAll("[data-edit]").forEach(el => el.onclick = () => form(b.accounts.find(a => a.id === Number(el.dataset.edit))));
    }
  };
}

/* ---------------------------------------------------------------- */
/* platforms                                                          */
/* ---------------------------------------------------------------- */
function platformsTab() {
  const b = B();
  const form = p => openForm({
    title: p ? `Edit ${p.name}` : "Add a platform", size: "sm",
    fields: [
      { name: "name", label: "Name", required: true, value: p?.name || "", cols: "full" },
      { name: "colour", label: "Colour", type: "color", value: p?.colour || "#5C5C5C" },
      ...(p ? [{ name: "active", label: "Active — offered for new posts and targets", type: "checkbox", checked: !!p.active, cols: "full" }] : [])
    ],
    submit: p ? "Save" : "Add platform",
    onSubmit: async d => {
      await api(p ? `/content/platforms/${p.id}` : "/content/platforms", { method: p ? "PATCH" : "POST", body: d });
      await after(p ? "Platform updated." : "Platform added.");
    }
  });
  return {
    html: `
      <div class="lvhead" style="padding:0 0 .5rem;border:none">
        <span class="count">A post goes out on one or more platforms, each with its own link and its own figures.
          A platform anything uses is deactivated, never deleted ${ruleTag("CC-09")}.</span>
        <span class="spacer"></span><button class="btn brand" data-a="new">${ICON.plus} Platform</button></div>
      ${dataTable({ columns: [
        { label: "Platform", cell: p => platTag(p.name, p.colour) }, { label: "Used by", align: "r", cell: p => p.uses || "—" },
        { label: "Status", cell: p => p.active ? `<span class="badge dot g">Active</span>` : `<span class="badge dot n">Inactive</span>` },
        { label: "", align: "r", cell: p => `<div class="btngroup"><button class="btn sm" data-edit="${p.id}">Edit</button>
          <button class="btn sm danger" data-del="${p.id}">${p.uses ? (p.active ? "Deactivate" : "In use") : "Delete"}</button></div>` }
      ], rows: b.platforms, empty: "No platforms." })}`,
    mount() {
      const find = id => b.platforms.find(p => p.id === Number(id));
      document.querySelector('[data-a="new"]').onclick = () => form(null);
      document.querySelectorAll("[data-edit]").forEach(el => el.onclick = () => form(find(el.dataset.edit)));
      document.querySelectorAll("[data-del]").forEach(el => el.onclick = () => {
        const p = find(el.dataset.del);
        if (p.uses && !p.active) return;
        confirmAction(p.uses
          ? { title: `Deactivate ${p.name}`, submit: "Deactivate", body: `${p.uses} record(s) use it, so it cannot be deleted. Deactivated, it stops being offered and stays on them.`,
              onConfirm: async () => { await api(`/content/platforms/${p.id}`, { method: "PATCH", body: { name: p.name, active: false } }); await after(`${p.name} deactivated.`); } }
          : { title: `Delete ${p.name}`, danger: true, submit: "Delete", body: "Nothing uses it, so it can be removed outright.",
              onConfirm: async () => { await api(`/content/platforms/${p.id}`, { method: "DELETE" }); await after("Platform deleted."); } });
      });
    }
  };
}

/* ---------------------------------------------------------------- */
/* metrics                                                            */
/* ---------------------------------------------------------------- */
function metricsTab() {
  const b = B();
  const names = ids => ids.map(id => b.platforms.find(p => p.id === id)).filter(Boolean);
  const form = m => openForm({
    title: m ? `Edit ${m.name}` : "Add a metric", size: "",
    rule: `<b>CC-30.</b> Figures are recorded per post and platform, on a capture date. Only the metrics a platform reports are
      offered for it — Instagram retired Impressions in April 2025, for instance.`,
    fields: [
      { name: "name", label: "Name", required: true, value: m?.name || "" },
      { name: "help", label: "Note shown beside it", value: m?.help || "" },
      { name: "platforms", label: "Reported by — tick none for every platform", type: "checkboxes", numeric: true, cols: "full",
        value: m?.platforms || [], options: b.platforms.map(p => ({ value: p.id, label: p.name + (p.active ? "" : " (inactive)") })) },
      ...(m ? [{ name: "active", label: "Tracked — offered when figures are recorded", type: "checkbox", checked: !!m.active, cols: "full" }] : [])
    ],
    submit: m ? "Save" : "Add metric",
    onSubmit: async d => {
      await api(m ? `/content/metrics/${m.id}` : "/content/metrics", { method: m ? "PATCH" : "POST", body: d });
      await after(m ? "Metric updated." : "Metric added.");
    }
  });
  return {
    html: `
      <div class="lvhead" style="padding:0 0 .5rem;border:none">
        <span class="count">Captures are owed ${esc(setting("content_metric_capture_days").split(",").join(" and "))} days after publishing
          (Rules). A metric no longer tracked keeps its recorded figures.</span>
        <span class="spacer"></span><button class="btn brand" data-a="new">${ICON.plus} Metric</button></div>
      ${dataTable({ columns: [
        { label: "Metric", cell: m => `<b>${esc(m.name)}</b>${m.help ? `<div class="help">${esc(m.help)}</div>` : ""}` },
        { label: "Reported by", cell: m => m.platforms.length ? names(m.platforms).map(p => platTag(p.name, p.colour)).join(" ") : "Every platform" },
        { label: "Status", cell: m => m.active ? `<span class="badge dot g">Tracked</span>` : `<span class="badge dot n">Not tracked</span>` },
        { label: "", align: "r", cell: m => `<button class="btn sm" data-edit="${m.id}">Edit</button>` }
      ], rows: b.metrics, empty: "No metrics." })}`,
    mount() {
      document.querySelector('[data-a="new"]').onclick = () => form(null);
      document.querySelectorAll("[data-edit]").forEach(el => el.onclick = () => form(b.metrics.find(m => m.id === Number(el.dataset.edit))));
    }
  };
}

/* ---------------------------------------------------------------- */
/* rules and holidays                                                 */
/* ---------------------------------------------------------------- */
const ZONES = ["Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Europe/London", "UTC"];

function rulesTab() {
  const b = B();
  const field = s => {
    const id = `r_${s.key}`;
    if (s.kind === "bool") return `<div class="field full"><label class="checkline"><input type="checkbox" name="${s.key}" ${s.value === "1" ? "checked" : ""}>
      <span>${esc(s.label)}</span></label></div>`;
    if (s.kind === "weekdays") { const on = s.value.split(",").filter(Boolean).map(Number);
      return `<div class="field full"><span class="lbl">${esc(s.label)}</span><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d =>
        `<label class="checkline" style="margin-right:.75rem"><input type="checkbox" name="${s.key}" value="${d}" ${on.includes(d) ? "checked" : ""}><span>${WD[d]}</span></label>`).join("")}</div></div>`; }
    if (s.kind === "role") return `<div class="field"><label for="${id}">${esc(s.label)}</label><select class="inp" id="${id}" name="${s.key}">
      ${b.roles.map(r => `<option value="${r.id}" ${String(r.id) === s.value ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div>`;
    if (s.kind === "timezone") return `<div class="field"><label for="${id}">${esc(s.label)}</label>
      <input class="inp" id="${id}" name="${s.key}" value="${esc(s.value)}" list="zones" autocomplete="off">
      <datalist id="zones">${ZONES.map(z => `<option value="${z}">`).join("")}</datalist>
      <div class="help">Today there is ${fdy(b.today)}.</div></div>`;
    return `<div class="field"><label for="${id}">${esc(s.label)}</label>
      <input class="inp" id="${id}" name="${s.key}" value="${esc(s.value)}" ${s.kind === "number" ? `type="number" step="1" min="${s.range[0]}" max="${s.range[1]}"` : ""}>
      ${s.kind === "days" ? `<div class="help">Comma-separated, e.g. 7,30. Leave empty for no capture tasks.</div>` : ""}</div>`;
  };
  return {
    html: `
      <div class="infobox">The rules that turn a posting date into deadlines and tasks. A change applies at once — deadlines are never
        stored, so every open stage is recounted on the next look. ${ruleTag("CC-08")}</div>
      <form id="rules"><div class="formgrid">${b.settings.map(field).join("")}</div>
        <div style="display:flex;justify-content:flex-end"><button class="btn brand" type="submit">Save the rules</button></div></form>
      <hr class="sep">
      <h3 style="font-size:.875rem;margin-bottom:.5rem">Holidays</h3>
      <p class="note" style="margin-bottom:.5rem">A deadline that lands on a holiday moves to the working day before, exactly as a weekend does.
        Adding one changes deadlines on every open post around it.</p>
      ${dataTable({ columns: [
        { label: "Date", cell: h => fdy(h.date) }, { label: "Holiday", cell: h => esc(h.name) },
        { label: "", align: "r", cell: h => `<button class="btn sm danger" data-delhol="${h.date}">Remove</button>` }
      ], rows: b.holidays, empty: "No holidays yet." })}
      <form id="holiday" class="inline" style="margin-top:.625rem">
        <input class="inp" type="date" name="date" required style="width:auto" aria-label="Holiday date">
        <input class="inp" name="name" required placeholder="e.g. Eid Al Etihad" style="flex:1;min-width:12rem" aria-label="Holiday name">
        <button class="btn" type="submit">${ICON.plus} Add holiday</button>
      </form>`,
    mount() {
      document.getElementById("rules").onsubmit = async e => {
        e.preventDefault();
        const fd = new FormData(e.target), body = {};
        for (const s of b.settings)
          body[s.key] = s.kind === "bool" ? fd.has(s.key) : s.kind === "weekdays" ? fd.getAll(s.key).join(",") : fd.get(s.key);
        try { await api("/content/rules", { method: "POST", body }); await after("Rules saved — every deadline is recounted against them."); }
        catch (err) { errToast(err); }
      };
      document.getElementById("holiday").onsubmit = async e => {
        e.preventDefault();
        try { await api("/content/holidays", { method: "POST", body: Object.fromEntries(new FormData(e.target).entries()) });
          await after("Holiday added — deadlines around it have moved."); }
        catch (err) { errToast(err); }
      };
      document.querySelectorAll("[data-delhol]").forEach(el => el.onclick = () => confirmAction({
        title: `Remove the holiday on ${fdy(el.dataset.delhol)}`, submit: "Remove", danger: true,
        body: "Deadlines that had moved off it move back.",
        onConfirm: async () => { await api(`/content/holidays/${el.dataset.delhol}`, { method: "DELETE" }); await after("Holiday removed."); }
      }));
    }
  };
}
