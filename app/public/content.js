// Content Calendar — the third application: the month calendar, topic mapping, the task list, posting
// targets, the scorecard and the item record. Every rule is the server's (content.mjs); this file shows
// what the server decided, offers only the actions it would accept, and quotes its refusals.
import {
  S, api, esc, fmtDT, me, ICON, toast, errToast, openForm, openPanel, confirmAction,
  dataTable, go, renderInPlace, contentRefresh, hasCRM
} from "./app.js";

/* ---------------------------------------------------------------- */
/* configuration and small helpers                                   */
/* ---------------------------------------------------------------- */
const B = () => S.content;
const today = () => B().today;
const setting = k => B().settings.find(s => s.key === k)?.value ?? "";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WDL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORD = ["", "1st", "2nd", "3rd", "4th"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];                               // Monday first, as the calendar is drawn

const T = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const addDays = (s, n) => new Date(T(s) + n * 864e5).toISOString().slice(0, 10);
const wdOf = s => new Date(T(s)).getUTCDay();
const diff = (a, b) => Math.round((T(b) - T(a)) / 864e5);
export const fd = s => s ? `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]}` : "—";
export const fdw = s => s ? `${WD[wdOf(s)]} ${fd(s)}` : "—";
export const fdy = s => s ? `${fdw(s)} ${s.slice(0, 4)}` : "—";
export const pmon = p => p ? `${MONL[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}` : "—";
export const monthShift = (p, n) => {
  let y = +p.slice(0, 4), m = +p.slice(5, 7) + n;
  while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
};
const PERIOD_RX = /^\d{4}-(0[1-9]|1[0-2])$/;
const rel = d => { const n = diff(today(), d); return n === 0 ? "today" : n > 0 ? `in ${n} day${n > 1 ? "s" : ""}` : `${-n} day${n < -1 ? "s" : ""} late`; };
const query = () => new URLSearchParams(location.hash.split("?")[1] || "");

export const acct = id => B().accounts.find(a => a.id === Number(id)) || { name: "—", colour: "#747474" };
export const acctTag = id => { const a = acct(id);
  return `<span class="acct"><i style="background:${esc(a.colour || "#747474")}"></i>${esc(a.name)}</span>`; };
export const platTag = (name, colour) => `<span class="plat"><i style="background:${esc(colour || "#747474")}"></i>${esc(name)}</span>`;
const platTags = list => list.map(p => platTag(p.name, p.colour)).join(" ");
export const ruleTag = code => `<span class="ruletag" title="${esc(B().rules[code] || "")}">${esc(code)}</span>`;
const holds = roleId => !!me()?.roleIds?.includes(roleId);
const optionsOf = (rows, blank) => [...(blank ? [{ value: "", label: blank }] : []),
  ...rows.map(r => ({ value: r.id, label: r.name }))];

/** Everything that may still happen to an item: nothing, once it is published or cancelled. */
const live = it => !it.published_on && !it.cancelled_at;
const suggested = it => it.tasks[0]?.kind === "topic" && !it.tasks[0].done_at && it.title && it.theme && it.keyword;
const lateStage = it => live(it) && it.tasks.some(t => t.state === "overdue");
const STATE_CLS = { "Open slot": "open", "In production": "b", "Ready": "t", "Published": "g", "Cancelled": "x", "No stage list": "y" };
export const stateBadge = s => `<span class="badge ${STATE_CLS[s] ?? ""}">${esc(s)}</span>`;
const TASK_WORD = { done: "Done", overdue: "Overdue", "due-soon": "Due soon", upcoming: "Upcoming",
  waiting: "Waiting on the parent item", blocked: "After the stage before it" };
const meter = it => `<span class="meter ${it.state === "Published" ? "g" : it.state === "Ready" ? "t" : ""}"><i style="width:${it.readiness}%"></i></span>`;

/** After a change: re-read the configuration and counts, repaint where the reader was, then say what happened. */
const after = async msg => { await contentRefresh(); await renderInPlace(); if (msg) toast("ok", msg); };
/** Runs a call, reports a refusal where the user is, and repaints on success. */
const attempt = async (fn, msg) => {
  try { const r = await fn(); await after(typeof msg === "function" ? msg(r) : msg); return r; }
  catch (e) { errToast(e); return null; }
};

const head = (eyebrow, title, desc, actions = "") => `
  <div class="page-head">
    <div class="icon" style="background:var(--violet)">${ICON.doc}</div>
    <div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><div class="desc">${desc}</div></div>
    <div class="actions">${actions}</div>
  </div>`;

/* ---------------------------------------------------------------- */
/* calendar                                                           */
/* ---------------------------------------------------------------- */
const filt = { account: "", type: "", platform: "" };

export async function calendar() {
  const asked = query().get("month");
  const month = asked && PERIOD_RX.test(asked) ? asked : today().slice(0, 7);
  const [cal, prompts] = await Promise.all([api(`/content/calendar?month=${month}`), api("/content/prompts?status=Open")]);
  const b = B();
  const all = cal.items;
  const shown = all.filter(it => (!filt.account || it.account_id === Number(filt.account))
    && (!filt.type || it.type_id === Number(filt.type))
    && (!filt.platform || it.platforms.some(p => p.channel_id === Number(filt.platform))));
  const liveItems = all.filter(it => !it.cancelled_at);
  const mapped = liveItems.filter(it => it.tasks.length ? !!it.tasks[0].done_at : !!it.title).length;
  const late = liveItems.filter(lateStage).length;
  const avg = liveItems.length ? Math.round(liveItems.reduce((n, it) => n + it.readiness, 0) / liveItems.length) : 0;
  const published = liveItems.filter(it => it.published_on).length;

  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;   // Monday-first
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekend = new Set(setting("content_weekend_days").split(",").filter(Boolean).map(Number));
  const holiday = ds => b.holidays.find(h => h.date === ds);
  const byDay = {};
  shown.forEach(it => (byDay[+it.date.slice(8, 10)] ||= []).push(it));
  const promptsOn = {};
  prompts.forEach(p => { if (p.due_date?.slice(0, 7) === month) (promptsOn[+p.due_date.slice(8, 10)] ||= []).push(p); });

  const ev = it => {
    const a = acct(it.account_id);
    const cls = it.cancelled_at ? "cancel" : it.state === "Open slot" ? "open" : "";
    const label = it.title ? (suggested(it) ? `${it.title} — confirm` : it.title) : "Open slot — map topic";
    return `<a class="cev ${cls}" href="#/content/item/${it.id}" style="border-left-color:${esc(a.colour || "#747474")}"
      title="${esc(`${it.type_name} · ${it.account_name} · ${it.state} · ${it.readiness}%`)}">
      <b>${esc(label)}</b>
      <span class="m">${lateStage(it) ? '<span class="late" title="A stage is overdue"></span>' : ""}${esc(it.type_name)} · ${
        esc(it.account_name)} · ${it.platforms.map(p => esc(p.name)).join(" + ")}</span>${meter(it)}</a>`;
  };
  const promptChip = p => `<button type="button" class="cev prompt" data-prompt="${p.id}" title="${esc(p.detail || "")}">
    <b>⚑ ${esc(p.title)}</b><span class="m">from Product Lifecycle — not yet planned</span></button>`;
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push(`<div class="day pad"></div>`);
  for (let d = 1; d <= dim; d++) {
    const ds = `${month}-${String(d).padStart(2, "0")}`, hol = holiday(ds);
    cells.push(`<div class="day ${ds === today() ? "today" : ""} ${weekend.has(wdOf(ds)) || hol ? "off" : ""}">
      <div class="n"><span>${d}${hol ? ` <span class="hol" title="${esc(hol.name)}">${esc(hol.name)}</span>` : ""}</span>${
        b.can.work && ds >= today() ? `<button type="button" class="add" data-new="${ds}" aria-label="Plan an extra post on ${fdw(ds)}">+</button>` : ""}</div>
      ${(promptsOn[d] || []).map(promptChip).join("")}${(byDay[d] || []).map(ev).join("")}</div>`);
  }
  while (cells.length % 7) cells.push(`<div class="day pad"></div>`);
  const agendaDays = [...new Set([...Object.keys(byDay), ...Object.keys(promptsOn)].map(Number))].sort((p, q) => p - q);
  const agenda = agendaDays.map(d => { const ds = `${month}-${String(d).padStart(2, "0")}`;
    return `<div class="arow"><div class="d">${d} ${MON[m - 1]}<span>${WD[wdOf(ds)]}</span></div>
      <div class="evs">${(promptsOn[d] || []).map(promptChip).join("")}${(byDay[d] || []).map(ev).join("")}</div></div>`; }).join("")
    || `<div class="empty">Nothing planned this month.</div>`;
  const chip = (v, label) => `<button type="button" class="chip" data-facc="${v}" aria-pressed="${String(filt.account) === String(v)}">${label}</button>`;

  return {
    html: `<main>
      ${head("Content Calendar", pmon(month), `Targets write the slots; a dashed slot is waiting for its topic. The bar under
        each post is its readiness, and a red dot means a stage is overdue. Shaded days are weekends and holidays —
        deadlines never land on them, posts may.`, `
        <div class="btngroup">
          <a class="btn" href="#/content/calendar?month=${monthShift(month, -1)}" aria-label="Previous month">‹</a>
          <a class="btn" href="#/content/calendar">This month</a>
          <a class="btn" href="#/content/calendar?month=${monthShift(month, 1)}" aria-label="Next month">›</a>
        </div>
        <a class="btn" href="/api/content/export?month=${month}">Export month</a>
        ${b.can.work ? `<button class="btn brand" data-a="new">${ICON.plus} Plan an extra post</button>` : ""}`)}

      ${prompts.length ? `<div class="card" style="border-left:3px solid var(--warn-line)">
        <header><div class="ci" style="background:var(--warn-line)">${ICON.bell}</div><h2>Launch content needed</h2>
          <span class="sub">raised when a product entered market state Seeding in Product Lifecycle</span>
          <div class="right"><span class="badge y">${prompts.length}</span></div></header>
        <div class="body flush">${prompts.map(p => `<div class="rrow">
          <div class="ic" style="background:var(--warn-line)">${ICON.product}</div>
          <div class="b"><b>${esc(p.title)}</b><div class="m">${esc(p.detail || "")}</div>
            <div class="m" style="color:var(--ink-4)">Suggested by ${fdy(p.due_date)}</div></div>
          ${b.can.work ? `<div class="r"><button class="btn sm brand" data-plan="${p.id}">Plan it</button>
            <button class="btn sm" data-dismiss="${p.id}">Dismiss</button></div>` : ""}</div>`).join("")}</div>
        <div class="foot">A prompt is not a post — planning it still needs a date, a content type, an account and a platform (CC-20).</div>
      </div>` : ""}

      <div class="kpis">
        <div class="kpi"><div class="k">Target</div><div class="v">${cal.target}<small> posts</small></div>
          <div class="m">from ${cal.targets} active target${cal.targets === 1 ? "" : "s"}</div></div>
        <div class="kpi ${mapped < liveItems.length ? "y" : "g"}"><div class="k">Topics mapped</div>
          <div class="v">${mapped}<small> / ${liveItems.length}</small></div><div class="m">with topic, theme and keyword</div></div>
        <div class="kpi"><div class="k">Average readiness</div><div class="v">${avg}<small>%</small></div><div class="m">across this month's posts</div></div>
        <div class="kpi ${late ? "r" : "g"}"><div class="k">Posts with an overdue stage</div><div class="v">${late}</div>
          <div class="m">${late ? "My tasks lists them first" : "nothing late"}</div></div>
        <div class="kpi g"><div class="k">Published</div><div class="v">${published}<small> / ${cal.target}</small></div>
          <div class="m">${cal.target ? Math.round(published / cal.target * 100) : 0}% of target</div></div>
      </div>

      <div class="card">
        <div class="filterbar">
          ${chip("", "All accounts")}${b.accounts.filter(a => a.active || all.some(it => it.account_id === a.id)).map(a =>
            chip(a.id, `<i style="width:.5rem;height:.5rem;border-radius:50%;background:${esc(a.colour || "#747474")};display:inline-block"></i>${esc(a.name)}`)).join("")}
          <span class="spacer" style="flex:1"></span>
          <label class="lbl" for="ftype">Type</label>
          <select class="inp" id="ftype" style="width:auto"><option value="">All types</option>
            ${b.types.map(t => `<option value="${t.id}" ${String(filt.type) === String(t.id) ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
          <label class="lbl" for="fplat">Platform</label>
          <select class="inp" id="fplat" style="width:auto"><option value="">All platforms</option>
            ${b.platforms.map(p => `<option value="${p.id}" ${String(filt.platform) === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          <span class="count">${shown.length} of ${all.length} post${all.length === 1 ? "" : "s"}</span>
        </div>
        <div class="body">
          <div class="cal">${WEEK_ORDER.map(d => `<div class="dow">${WD[d]}</div>`).join("")}${cells.join("")}</div>
          <div class="agenda">${agenda}</div>
          <div class="legend">
            ${b.accounts.filter(a => a.active).map(a => acctTag(a.id)).join("")}
            ${["Open slot", "In production", "Ready", "Published", "Cancelled"].map(stateBadge).join("")}
          </div>
        </div>
      </div></main>`,
    mount() {
      document.querySelector('[data-a="new"]')?.addEventListener("click", () => newItemForm());
      document.querySelectorAll("[data-new]").forEach(el => el.onclick = () => newItemForm(el.dataset.new));
      document.querySelectorAll("[data-facc]").forEach(el => el.onclick = () => { filt.account = el.dataset.facc; renderInPlace(); });
      document.getElementById("ftype").onchange = e => { filt.type = e.target.value; renderInPlace(); };
      document.getElementById("fplat").onchange = e => { filt.platform = e.target.value; renderInPlace(); };
      const prompt = id => prompts.find(p => p.id === Number(id));
      document.querySelectorAll("[data-plan]").forEach(el => el.onclick = () => { const p = prompt(el.dataset.plan); newItemForm(p.due_date, p); });
      document.querySelectorAll("[data-prompt]").forEach(el => el.onclick = () => {
        const p = prompt(el.dataset.prompt);
        openPanel({ title: p.title, size: "sm", html: `<p class="note">${esc(p.detail || "")}</p>
            <p class="note" style="margin-top:.5rem;color:var(--ink-4)">Suggested by ${fdy(p.due_date)}.</p>`,
          footer: `<button class="btn" data-close>Close</button>${b.can.work ? `<button class="btn brand" id="planit">Plan it</button>` : ""}` });
        document.getElementById("planit")?.addEventListener("click", () => { document.querySelector("dialog.modal")?.remove(); newItemForm(p.due_date, p); });
      });
      document.querySelectorAll("[data-dismiss]").forEach(el => el.onclick = () => {
        const p = prompt(el.dataset.dismiss);
        openForm({
          title: `Dismiss “${p.title}”`, size: "sm", danger: true,
          intro: "The prompt leaves the calendar. The product stays in Seeding either way.",
          fields: [{ name: "reason", label: "Why is no launch content needed?", type: "textarea", rows: 3, required: true, cols: "full" }],
          submit: "Dismiss prompt",
          onSubmit: async d => { await api(`/content/prompts/${p.id}/dismiss`, { method: "POST", body: d }); await after("Prompt dismissed."); }
        });
      });
    }
  };
}

/** CC-20 — a post outside the targets, or the launch post a PLM prompt asked for. */
export function newItemForm(date, prompt) {
  const b = B();
  const types = b.types.filter(t => t.active && t.stages.length);
  if (!types.length) {
    openPanel({ title: "No content type has a stage list yet", size: "sm",
      html: `<p class="note">A post takes its stages, readiness and deadlines from its content type, so a type needs a stage
        list before anything of that type can be planned (CC-20).</p>`,
      footer: `<button class="btn" data-close>Close</button>${b.can.setup ? `<a class="btn brand" href="#/content/setup/types"
        onclick="document.querySelector('dialog.modal')?.remove()">Set up stage lists</a>` : ""}` });
    return;
  }
  openForm({
    title: prompt ? `Plan “${prompt.title}”` : "Plan an extra post", size: "lg",
    rule: `<b>CC-20.</b> A post needs a date, a content type with a stage list, an account and at least one platform. It copies
      its type's stages, every deadline is counted back from the posting date, and it counts towards its month as an extra
      post, outside any target.`,
    intro: prompt ? `Raised from Product Lifecycle: ${esc(prompt.detail || "")}` : undefined,
    fields: [
      { name: "date", label: "Posting date", type: "date", required: true, min: today(),
        value: date && date >= today() ? date : addDays(today(), 21) },
      { name: "account_id", label: "Account", type: "select", required: true,
        options: optionsOf(b.accounts.filter(a => a.active), "— choose —") },
      { name: "type_id", label: "Content type", type: "select", required: true, options: optionsOf(types, "— choose —"),
        help: "Only content types with a stage list are offered." },
      { name: "platforms", label: "Platforms — one post goes out on every one ticked", type: "checkboxes", numeric: true,
        cols: "full", options: b.platforms.filter(p => p.active).map(p => ({ value: p.id, label: p.name })), value: [] },
      { name: "title", label: "Topic (optional now — it can be mapped later)", cols: "full",
        value: prompt ? prompt.title.replace(/^Launch content — /, "") + " — launch announcement" : "" },
      { name: "theme", label: "Content theme", value: prompt ? "Product launch" : "" },
      { name: "keyword", label: "Keyword" },
      { name: "offering_id", label: "Offering (optional)", type: "select", options: optionsOf(b.offerings.filter(o => o.active), "— none —") },
      { name: "industry_id", label: "Industry (optional)", type: "select", options: optionsOf(b.industries.filter(i => i.active), "— none —") }
    ],
    submit: "Plan the post",
    onSubmit: async d => {
      const it = await api("/content/items", { method: "POST", body: { ...d, prompt_id: prompt?.id } });
      await contentRefresh();
      toast("ok", `Planned for ${fdy(it.date)} — ${it.tasks.length} stages, the first due ${fdy(it.tasks[0]?.due)}.`);
      go(`/content/item/${it.id}`);
    }
  });
}

/* ---------------------------------------------------------------- */
/* map topics                                                         */
/* ---------------------------------------------------------------- */
const topicMessage = it => {
  const t = it.tasks[0];
  if (t?.done_at) return `Topic mapped — “${t.name}” is done.`;
  const gaps = [["title", "Topic"], ["theme", "Content theme"], ["keyword", "Keyword"]].filter(([k]) => !it[k]).map(([, l]) => l);
  return gaps.length ? `Saved. Still needed: ${gaps.join(", ")}.` : `Topic saved. The ${t?.owner_role || "stage owner"} confirms it to close the topic stage.`;
};

export async function topics() {
  const v = await api("/content/topics");
  const b = B();
  const rows = v.rows;
  const lateN = rows.filter(r => r.state === "overdue").length;
  const canClose = r => b.can.setup || holds(r.topic_owner_role_id);
  return {
    html: `<main>
      ${head(`Topics at least ${v.horizon} days ahead`, `Map topics — next ${v.horizon} days`, `Every slot up to ${fdy(v.until)}
        needs its topic, theme and keyword. The topic stage has its own TAT, so each slot arrives here with a deadline and
        turns overdue if nobody maps it in time. The look-ahead is set in Setup → Rules.`)}
      <div class="kpis">
        <div class="kpi ${rows.length ? "y" : "g"}"><div class="k">Slots without a topic</div><div class="v">${rows.length}</div>
          <div class="m">inside the ${v.horizon}-day look-ahead</div></div>
        <div class="kpi ${lateN ? "r" : "g"}"><div class="k">Past the topic deadline</div><div class="v">${lateN}</div>
          <div class="m">${lateN ? "mostly slots created inside their lead time" : "none"}</div></div>
        <div class="kpi n"><div class="k">Further out</div><div class="v">${v.later}</div><div class="m">open slots after ${fd(v.until)}</div></div>
      </div>
      <div class="card">
        <header><h2>Slots to map</h2><span class="sub">${ruleTag("CC-21")} all three close the topic stage — for its owner role;
          anyone else's mapping is a suggestion the owner confirms ${ruleTag("CC-23")}</span></header>
        <div class="body flush"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Post date</th><th>Account</th><th>Type</th><th>Platforms</th><th>Topic</th><th>Content theme</th>
            <th>Keyword</th><th>Topic due</th><th></th></tr></thead>
          <tbody>${rows.map(r => {
            const sug = !!(r.title && r.theme && r.keyword);
            return `<tr class="${r.state === "overdue" ? "bad" : r.state === "due-soon" ? "warn" : ""}" data-topic="${r.id}">
              <td class="num"><a href="#/content/item/${r.id}"><b>${fdw(r.date)}</b></a></td>
              <td>${acctTag(r.account_id)}</td><td>${esc(r.type)}</td><td>${esc(r.platforms.join(", "))}</td>
              <td><input class="inp sm" data-f="title" value="${esc(r.title || "")}" placeholder="Topic" aria-label="Topic" ${b.can.work ? "" : "readonly"}></td>
              <td><input class="inp sm" data-f="theme" value="${esc(r.theme || "")}" placeholder="Theme" aria-label="Content theme" ${b.can.work ? "" : "readonly"}></td>
              <td><input class="inp sm" data-f="keyword" value="${esc(r.keyword || "")}" placeholder="Keyword" aria-label="Keyword" ${b.can.work ? "" : "readonly"}></td>
              <td class="num">${fd(r.topic_due)}<br><span class="help" style="${r.state === "overdue" ? "color:var(--error-ink)" : ""}">${rel(r.topic_due)}${r.born_late ? " · late from the start" : ""}</span></td>
              <td><div class="btngroup">${b.can.work ? `<button class="btn sm ${sug && canClose(r) ? "" : "brand"}" data-save="${r.id}">Save</button>` : ""}${
                sug && canClose(r) ? `<button class="btn sm success" data-confirm="${r.topic_task_id}">Confirm</button>` : ""}</div>
                ${sug && !canClose(r) ? `<div class="help">Suggested — the ${esc(r.topic_owner_role || "owner")} confirms it</div>` : ""}</td></tr>`;
          }).join("") || `<tr><td colspan="9"><div class="empty">Every slot in the next ${v.horizon} days has its topic.</div></td></tr>`}</tbody>
        </table></div></div>
      </div></main>`,
    mount() {
      document.querySelectorAll("[data-save]").forEach(btn => btn.onclick = () => {
        const tr = btn.closest("tr"), val = f => tr.querySelector(`[data-f="${f}"]`).value;
        attempt(() => api(`/content/items/${btn.dataset.save}/topic`, { method: "POST",
          body: { title: val("title"), theme: val("theme"), keyword: val("keyword") } }), topicMessage);
      });
      document.querySelectorAll("[data-confirm]").forEach(btn => btn.onclick = () =>
        attempt(() => api(`/content/tasks/${btn.dataset.confirm}/done`, { method: "POST", body: {} }), "Topic confirmed — the topic stage is done."));
    }
  };
}

/* ---------------------------------------------------------------- */
/* my tasks                                                           */
/* ---------------------------------------------------------------- */
let scope = "mine";
const expanded = {};

export async function tasks() {
  const b = B();
  const list = await api(`/content/tasks?scope=${scope}`);
  const soon = setting("content_due_soon_days");
  const groups = [["overdue", "Overdue"], ["due-soon", `Due within ${soon} days`], ["upcoming", "Upcoming"],
    ["waiting", "Waiting on a parent item"], ["blocked", "After an earlier stage"]];
  const actionable = x => ["overdue", "due-soon", "upcoming"].includes(x.state);
  const mayTick = x => b.can.setup || holds(x.owner_role_id);
  const action = x => {
    if (x.kind === "metrics") return `<a class="btn sm" href="#/content/item/${x.item_id}">Record figures…</a>`;
    if (!actionable(x)) return "";
    if (x.task_kind === "work") return mayTick(x)
      ? `<button class="btn sm ${x.state === "overdue" ? "brand" : ""}" data-done="${x.task_id}">Mark done</button>`
      : `<span class="help">${esc(x.owner_role || "")}'s</span>`;
    const label = { topic: "Map topic…", publish: "Publish…", parent: x.has_parent ? "Open…" : "Link parent…" }[x.task_kind] || "Open…";
    return `<a class="btn sm" href="#/content/item/${x.item_id}">${label}</a>`;
  };
  const row = x => `<div class="task">
    <span class="tdot ${x.state}" title="${esc(TASK_WORD[x.state] || "")}"></span>
    <div class="st"><b>${esc(x.stage)}</b>
      <div class="help">${esc(x.owner_role || "")}${x.born_late ? ' · <span style="color:var(--error-ink)">created after this deadline</span>' : ""}${
        x.state === "blocked" && x.blocked_by ? ` · after “${esc(x.blocked_by)}”` : x.state === "waiting" ? " · waits for the parent item's stage" : ""}</div></div>
    <div class="it"><a href="#/content/item/${x.item_id}">${esc(x.item || "Open slot")}</a>
      <div class="help">${acctTag(x.account_id)} · ${esc(x.type)} · posts ${fdw(x.date)} · ${x.readiness}%</div></div>
    <div class="due num">${fdw(x.due)}<small>${rel(x.due)}</small></div>
    <div class="act">${action(x)}</div></div>`;
  const CAP = 12;
  const body = groups.map(([k, l]) => {
    const g = list.filter(x => x.state === k);
    if (!g.length) return "";
    return `<section class="tgroup"><h3><span class="tdot ${k}"></span>${esc(l)} <span class="badge">${g.length}</span></h3>
      ${(expanded[k] ? g : g.slice(0, CAP)).map(row).join("")}
      ${g.length > CAP && !expanded[k] ? `<div style="padding:.5rem .75rem"><button class="btn sm" data-more="${k}">Show all ${g.length}</button></div>` : ""}</section>`;
  }).join("");
  return {
    html: `<main>
      ${head("Content Calendar", scope === "mine" ? "My tasks" : "Everyone's tasks", `Each stage of each post is a task, due its
        TAT before the posting date — so moving a post moves its tasks. “Mine” is every stage owned by a role you hold.
        Figure captures appear ${esc(setting("content_metric_capture_days").split(",").join(" and "))} days after a post goes out.`, `
        <button class="chip" data-scope="mine" aria-pressed="${scope === "mine"}">Mine</button>
        <button class="chip" data-scope="all" aria-pressed="${scope === "all"}">Everyone's</button>`)}
      <div class="card">${body || `<div class="empty">${scope === "mine"
        ? "Nothing is waiting on a role you hold. “Everyone's” shows the whole list." : "Nothing to do."}</div>`}</div></main>`,
    mount() {
      document.querySelectorAll("[data-scope]").forEach(el => el.onclick = () => { scope = el.dataset.scope; renderInPlace(); });
      document.querySelectorAll("[data-more]").forEach(el => el.onclick = () => { expanded[el.dataset.more] = true; renderInPlace(); });
      document.querySelectorAll("[data-done]").forEach(el => el.onclick = () =>
        attempt(() => api(`/content/tasks/${el.dataset.done}/done`, { method: "POST", body: {} }),
          it => `Done. ${it.title ? `“${it.title}”` : "The post"} is ${it.readiness}% ready.`));
    }
  };
}

/* ---------------------------------------------------------------- */
/* targets                                                            */
/* ---------------------------------------------------------------- */
let draft = null;
const typesWithStages = () => B().types.filter(t => t.active && t.stages.length);
const draftDefaults = () => {
  const m = today().slice(0, 7);
  return { account_id: B().accounts.find(a => a.active)?.id ?? "", type_id: typesWithStages()[0]?.id ?? "",
    platforms: [], per_month: 2, weeks: [1, 3], weekdays: [2], start_period: monthShift(m, 1), end_period: monthShift(m, 6), note: "" };
};

export async function targets() {
  const b = B();
  const list = await api("/content/targets");
  draft ||= draftDefaults();
  const status = c => !c.active ? `<span class="badge">Replaced by #${c.replaced_by}</span>`
    : c.replaced_by ? `<span class="badge y">Continues as #${c.replaced_by}</span>`
      : c.end_period < today().slice(0, 7) ? `<span class="badge">Ended</span>` : `<span class="badge g">Active</span>`;
  const table = dataTable({
    columns: [
      { label: "#", align: "r", cell: c => c.id },
      { label: "Account", cell: c => acctTag(c.account_id) },
      { label: "Content type", cell: c => esc(c.type_name) },
      { label: "Platforms", cell: c => esc(c.platform_names || "—") },
      { label: "Pattern", cell: c => esc(c.pattern) },
      { label: "Months", cell: c => `${pmon(c.start_period)} – ${pmon(c.end_period)}` },
      { label: "Slots", align: "r", cell: c => c.slots },
      { label: "Status", cell: status },
      { label: "", align: "r", cell: c => c.active && b.can.cadence && c.end_period >= today().slice(0, 7) ? `<div class="btngroup">
          <button class="btn sm" data-revise="${c.id}">Change from…</button>
          <button class="btn sm" data-end="${c.id}">End after…</button></div>` : "" }
    ], rows: list, empty: "No posting target yet. A target writes the calendar: set one below."
  });
  const active = list.filter(c => c.active && c.end_period >= today().slice(0, 7)).length;
  return {
    html: `<main>
      ${head("Posting targets", "Targets write the calendar", `A target says which account posts which content type, on which
        platforms, how many times a month, in which weeks and on which weekday, for a run of months. Saving it creates every
        slot in that run; a 5th week is never used, so every month gets the same count.`)}
      <div class="card"><header><h2>Targets</h2><span class="sub">${active} active</span></header>
        <div class="body flush">${table}</div></div>
      ${b.can.cadence ? `<div class="grid g2" style="align-items:start">
        <div class="card" style="margin:0"><header><h2>New target</h2>
          <span class="sub">${["CC-10", "CC-11", "CC-12", "CC-13"].map(ruleTag).join(" ")}</span></header>
          <div class="body" id="tform"></div></div>
        <div class="card" style="margin:0"><header><h2>What this target will create</h2></header>
          <div class="body" id="tpreview"><div class="help">Working it out…</div></div></div>
      </div>` : `<div class="infobox">Setting targets needs <b>Set and revise the posting targets</b> (content.cadence.manage) ${ruleTag("CC-40")}.</div>`}
    </main>`,
    mount() {
      const cad = id => list.find(c => c.id === Number(id));
      document.querySelectorAll("[data-revise]").forEach(el => el.onclick = () => reviseForm(cad(el.dataset.revise)));
      document.querySelectorAll("[data-end]").forEach(el => el.onclick = () => endForm(cad(el.dataset.end)));
      if (b.can.cadence) drawTargetForm();
    }
  };
}

function drawTargetForm() {
  const b = B(), d = draft;
  const types = typesWithStages();
  const tog = (k, v, label) => `<button type="button" class="chip" data-tog="${k}" data-v="${v}" aria-pressed="${d[k].map(Number).includes(v)}">${label}</button>`;
  const monthOpts = sel => Array.from({ length: 36 }, (_, k) => monthShift(today().slice(0, 7), k - 1))
    .map(p => `<option value="${p}" ${p === sel ? "selected" : ""}>${pmon(p)}</option>`).join("");
  document.getElementById("tform").innerHTML = !types.length
    ? `<div class="warnbox">No content type has a stage list yet, so no target can write slots (CC-11).
        ${b.can.setup ? `<a href="#/content/setup/types">Set up stage lists</a>.` : "Ask a content administrator to set them up."}</div>`
    : `<div class="formgrid">
      <div class="field"><label for="tAcc">Account</label><select class="inp" id="tAcc" data-k="account_id">
        ${b.accounts.filter(a => a.active).map(a => `<option value="${a.id}" ${Number(d.account_id) === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="tType">Content type</label><select class="inp" id="tType" data-k="type_id">
        ${types.map(t => `<option value="${t.id}" ${Number(d.type_id) === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
      <div class="field full"><span class="lbl">Platforms — one post goes out on all of them</span>
        <div class="chips">${b.platforms.filter(p => p.active).map(p => tog("platforms", p.id, esc(p.name))).join("")}</div></div>
      <div class="field"><label for="tPer">Posts per month</label>
        <input class="inp" id="tPer" type="number" min="1" max="28" step="1" data-k="per_month" value="${esc(d.per_month)}">
        <div class="help">Weeks ticked × days ticked. 2 a month is usually the 1st &amp; 3rd, or the 2nd &amp; 4th.</div></div>
      <div class="field"><span class="lbl">Weeks of the month</span>
        <div class="chips">${[1, 2, 3, 4].map(w => tog("weeks", w, ORD[w])).join("")}</div>
        <div class="help">There is no 5th — only some months have one.</div></div>
      <div class="field full"><span class="lbl">Day of the week</span>
        <div class="chips">${WEEK_ORDER.map(w => tog("weekdays", w, WD[w])).join("")}</div></div>
      <div class="field"><label for="tStart">First month</label><select class="inp" id="tStart" data-k="start_period">${monthOpts(d.start_period)}</select></div>
      <div class="field"><label for="tEnd">Last month</label><select class="inp" id="tEnd" data-k="end_period">${monthOpts(d.end_period)}</select></div>
      <div class="field full"><label for="tNote">Note</label><input class="inp" id="tNote" data-k="note" value="${esc(d.note)}"
        placeholder="Optional — why this rhythm, for whoever revises it later"></div>
    </div>
    <div class="btngroup" style="margin-top:.25rem"><button class="btn brand" id="tsave" disabled>Save and create the slots</button>
      <button class="btn" id="treset">Reset</button></div>`;
  document.querySelectorAll("#tform [data-tog]").forEach(el => el.onclick = () => {
    const k = el.dataset.tog, v = Number(el.dataset.v), cur = d[k].map(Number);
    d[k] = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
    if (k !== "platforms" && d.weeks.length && d.weekdays.length) d.per_month = d.weeks.length * d.weekdays.length;
    drawTargetForm();
  });
  document.querySelectorAll("#tform [data-k]").forEach(el => el.onchange = () => { d[el.dataset.k] = el.value; drawPreview(); });
  document.getElementById("tNote")?.addEventListener("input", e => { d.note = e.target.value; });
  document.getElementById("treset")?.addEventListener("click", () => { draft = draftDefaults(); drawTargetForm(); });
  document.getElementById("tsave")?.addEventListener("click", async () => {
    try {
      const r = await api("/content/targets", { method: "POST", body: draft });
      draft = null;
      await after(`Target #${r.cadence.id} saved: ${r.created} slot${r.created === 1 ? "" : "s"} created${
        r.skipped_past ? `, ${r.skipped_past} skipped as already past` : ""}${r.born_late ? `; ${r.born_late} already past their topic deadline` : ""}.`);
    } catch (e) { errToast(e); drawPreview(); }
  });
  drawPreview();
}

let previewSeq = 0;
async function drawPreview() {
  const box = document.getElementById("tpreview"), save = document.getElementById("tsave");
  if (!box) return;
  const mine = ++previewSeq;
  let p = null, refusal = null;
  try { p = await api("/content/targets/preview", { method: "POST", body: draft }); } catch (e) { refusal = e; }
  if (mine !== previewSeq || !document.body.contains(box)) return;         // a later change has already asked
  if (save) save.disabled = !!refusal;
  if (refusal) { box.innerHTML = `<div class="warnbox">${refusal.rule ? ruleTag(refusal.rule) + " " : ""}${esc(refusal.message)}</div>`; return; }
  const future = p.dates.filter(x => !x.past), late = p.dates.filter(x => x.born_late);
  const byMonth = {};
  p.dates.forEach(x => (byMonth[x.date.slice(0, 7)] ||= []).push(x));
  const type = B().types.find(t => t.id === Number(draft.type_id));
  box.innerHTML = `<p style="margin-bottom:.5rem"><b>${esc(acct(draft.account_id).name)} · ${esc(type?.name || "")}</b> — ${esc(p.pattern)},
      ${pmon(draft.start_period)} to ${pmon(draft.end_period)}: <b>${future.length}</b> slot${future.length === 1 ? "" : "s"}${
      p.dates.length > future.length ? `, ${p.dates.length - future.length} skipped as already past` : ""}.</p>
    ${Object.entries(byMonth).map(([mo, xs]) => `<div class="pmonth"><span class="lbl">${pmon(mo)}</span>
      <div class="datepills">${xs.map(x => `<span class="dp ${x.past ? "past" : x.born_late ? "late" : ""}"
        title="${x.past ? "Already past — not created" : x.born_late ? "Its topic deadline has already passed" : ""}">${fdw(x.date)}</span>`).join("")}</div></div>`).join("")}
    ${late.length ? `<div class="warnbox" style="margin-top:.5rem">${late.length} slot${late.length === 1 ? " is" : "s are"} already past
        ${late.length === 1 ? "its" : "their"} ${p.topic_tat}-day topic deadline. Start the target that far ahead, or accept a ramp-up month.</div>`
      : `<div class="okbox" style="margin-top:.5rem">Every slot leaves the full ${p.topic_tat}-day lead time for its topic.</div>`}`;
}

function reviseForm(c) {
  const b = B(), m = today().slice(0, 7);
  openForm({
    title: `Change target #${c.id} from a month`, size: "",
    rule: `<b>CC-15.</b> The target keeps the months before. From the month chosen, slots nobody has worked on are replaced by
      the new pattern; a slot someone has worked on stays, flagged for a decision, unless the new pattern wants the same date.`,
    intro: `Now: ${esc(c.account_name)} · ${esc(c.type_name)} · ${esc(c.pattern)} · ${pmon(c.start_period)} – ${pmon(c.end_period)}.`,
    fields: [
      { name: "from_period", label: "Change from", type: "month", required: true, value: c.start_period > m ? c.start_period : m },
      { name: "end_period", label: "Last month", type: "month", required: true, value: c.end_period },
      { name: "per_month", label: "Posts per month", type: "number", min: 1, step: "1", required: true, value: c.per_month },
      { name: "weeks", label: "Weeks of the month", type: "checkboxes", numeric: true, value: c.weeks.split(",").map(Number),
        options: [1, 2, 3, 4].map(w => ({ value: w, label: `${ORD[w]} week` })) },
      { name: "weekdays", label: "Days of the week", type: "checkboxes", numeric: true, value: c.weekdays.split(",").map(Number),
        options: WEEK_ORDER.map(w => ({ value: w, label: WDL[w] })) },
      { name: "platforms", label: "Platforms", type: "checkboxes", numeric: true, cols: "full",
        value: String(c.platform_ids || "").split(",").filter(Boolean).map(Number),
        options: b.platforms.filter(p => p.active || String(c.platform_ids || "").split(",").includes(String(p.id))).map(p => ({ value: p.id, label: p.name })) },
      { name: "note", label: "Note", cols: "full", value: c.note || "" }
    ],
    submit: "Apply the change",
    onSubmit: async d => {
      const r = await api(`/content/targets/${c.id}/revise`, { method: "POST", body: d });
      await after(`Changed from ${pmon(d.from_period)}: ${r.released.removed} untouched slot(s) replaced, ${r.released.carried} carried over, `
        + `${r.released.kept} kept and flagged, ${r.created} created.`);
    }
  });
}

function endForm(c) {
  const m = today().slice(0, 7);
  openForm({
    title: `End target #${c.id} early`, size: "sm",
    rule: `<b>CC-15.</b> Untouched slots after the last month are removed. A slot someone has already worked on stays, flagged.`,
    intro: `${esc(c.account_name)} · ${esc(c.type_name)} · ${esc(c.pattern)}, now running to ${pmon(c.end_period)}.`,
    fields: [{ name: "last_period", label: "Last month it runs", type: "month", required: true,
      value: monthShift(c.end_period, -1) < m ? m : monthShift(c.end_period, -1), cols: "full" }],
    submit: "End the target", danger: true,
    onSubmit: async d => {
      const r = await api(`/content/targets/${c.id}/end`, { method: "POST", body: d });
      await after(`Target #${c.id} now ends ${pmon(d.last_period)}: ${r.released.removed} slot(s) removed, ${r.released.kept} kept and flagged.`);
    }
  });
}

/* ---------------------------------------------------------------- */
/* scorecard                                                          */
/* ---------------------------------------------------------------- */
export async function scorecard() {
  const asked = query().get("month");
  const month = asked && PERIOD_RX.test(asked) ? asked : today().slice(0, 7);
  const sc = await api(`/content/scorecard?month=${month}`);
  const tot = sc.rows.reduce((a, r) => ({ target: a.target + r.target, pub: a.pub + r.published, on: a.on + r.on_time,
    planned: a.planned + r.planned, ready: a.ready + r.avg_readiness * r.planned }), { target: 0, pub: 0, on: 0, planned: 0, ready: 0 });
  const bar = pct => pct === null ? `<span class="help">No target — extra posts</span>`
    : `<div class="inline"><div class="tbar ${pct >= 100 ? "met" : ""}" style="flex:1"><i style="width:${Math.min(100, pct)}%"></i></div><span class="num">${pct}%</span></div>`;
  const byName = n => B().accounts.find(a => a.name === n)?.id;
  return {
    html: `<main>
      ${head("Target against actual", pmon(month), `The target is the plan, so a cancelled slot counts as a miss rather than a
        smaller target. On time means published on or before the planned date. Figures are the latest capture of each post.`, `
        <div class="btngroup">
          <a class="btn" href="#/content/scorecard?month=${monthShift(month, -1)}" aria-label="Previous month">‹</a>
          <a class="btn" href="#/content/scorecard">This month</a>
          <a class="btn" href="#/content/scorecard?month=${monthShift(month, 1)}" aria-label="Next month">›</a>
        </div>
        <a class="btn" href="/api/content/export?month=${month}">Export month</a>`)}
      <div class="kpis">
        <div class="kpi"><div class="k">Target</div><div class="v">${tot.target}</div><div class="m">posts across all accounts</div></div>
        <div class="kpi g"><div class="k">Published</div><div class="v">${tot.pub}<small> · ${tot.target ? Math.round(tot.pub / tot.target * 100) : 0}%</small></div>
          <div class="m">of target</div></div>
        <div class="kpi ${tot.pub && tot.on < tot.pub ? "y" : "g"}"><div class="k">On time</div><div class="v">${tot.on}<small> / ${tot.pub}</small></div>
          <div class="m">published on or before plan</div></div>
        <div class="kpi"><div class="k">Average readiness</div><div class="v">${tot.planned ? Math.round(tot.ready / tot.planned) : 0}<small>%</small></div>
          <div class="m">of ${tot.planned} planned posts</div></div>
      </div>
      <div class="card"><header><h2>By account and content type</h2></header><div class="body flush">${dataTable({
        columns: [
          { label: "Account", cell: r => acctTag(r.account_id) }, { label: "Content type", cell: r => esc(r.type) },
          { label: "Target", align: "r", cell: r => r.target || "—" }, { label: "Planned", align: "r", cell: r => r.planned },
          { label: "Topics mapped", align: "r", cell: r => r.topics }, { label: "Avg readiness", align: "r", cell: r => `${r.avg_readiness}%` },
          { label: "Overdue", align: "r", cell: r => r.overdue_items || "" }, { label: "Moved", align: "r", cell: r => r.moved || "" },
          { label: "Cancelled", align: "r", cell: r => r.cancelled || "" }, { label: "Published", align: "r", cell: r => r.published },
          { label: "On time", align: "r", cell: r => r.published ? r.on_time : "" }, { label: "Achievement", cell: r => bar(r.achievement_pct) }
        ], rows: sc.rows, empty: "No target and no post in this month."
      })}</div></div>
      <div class="card"><header><h2>Figures for posts published this month</h2><span class="sub">latest capture of each post, added up</span></header>
        <div class="body flush">${dataTable({
          columns: [
            { label: "Account", cell: r => byName(r.account) ? acctTag(byName(r.account)) : esc(r.account) },
            { label: "Platform", cell: r => esc(r.platform) }, { label: "Metric", cell: r => esc(r.metric) },
            { label: "Total", align: "r", cell: r => Number(r.total).toLocaleString("en-US") }, { label: "Posts", align: "r", cell: r => r.posts }
          ], rows: sc.metrics, empty: "No figures recorded for this month's posts yet."
        })}</div></div>
    </main>`
  };
}

/* ---------------------------------------------------------------- */
/* the item record                                                    */
/* ---------------------------------------------------------------- */
let figurePlatform = null;

export async function item(id) {
  const det = await api(`/content/items/${id}`);
  const b = B(), it = det.item;
  const work = b.can.work && live(it);
  const mayAct = t => b.can.setup || holds(t.owner_role_id);
  const topic = it.tasks[0];
  const started = it.tasks.some(t => t.done_at);
  const title = it.title || (it.tasks.length ? "Open slot — topic not mapped yet" : "Untitled item");

  const stageRow = t => {
    const canTick = work && t.kind === "work" && !t.done_at && ["overdue", "due-soon", "upcoming"].includes(t.state) && mayAct(t);
    const canConfirm = work && t.kind === "topic" && !t.done_at && suggested(it) && mayAct(t);
    const canSource = work && t.kind === "parent" && !t.done_at && !it.parent_id && t.state !== "blocked" && mayAct(t);
    const canReopen = work && t.done_at && !t.auto;
    return `<div class="srow">
      <span class="tdot ${t.state}" title="${esc(TASK_WORD[t.state] || "")}"></span>
      <div>
        <div class="nm">${esc(t.name)} <span class="badge">${t.pct}%</span>${t.kind === "parent" ? `<span class="badge v">From parent</span>` : ""}
          ${!t.done_at ? `<span class="badge ${t.state === "overdue" ? "r" : t.state === "due-soon" ? "y" : ""}">${esc(TASK_WORD[t.state])}</span>` : ""}</div>
        <div class="meta">Due ${fdy(t.due)} · ${t.tat_days} day${t.tat_days === 1 ? "" : "s"} before posting · ${esc(t.owner_role || "no owner role")}${
          t.born_late && !t.done_at ? ` · <span style="color:var(--error-ink)">created after this deadline</span>` : ""}${
          t.kind === "parent" && t.parent_due ? ` · the parent's stage is due ${fdw(t.parent_due)}${t.parent_done ? " (done)" : ""}` : ""}</div>
        ${t.done_at ? `<div class="dn">Done ${fdy(t.done_on)}${t.auto ? " automatically" : ""}${t.late_done ? ` — ${diff(t.due, t.done_on)} day(s) after its deadline` : ""}${
          t.note ? ` · ${esc(t.note)}` : ""}</div>` : ""}
      </div>
      <div class="acts">
        ${canTick ? `<button class="btn sm brand" data-done="${t.id}">Mark done</button>` : ""}
        ${canConfirm ? `<button class="btn sm success" data-done="${t.id}">Confirm topic</button>` : ""}
        ${canSource ? `<button class="btn sm" data-source="${t.id}">No parent — record the source</button>` : ""}
        ${canReopen ? `<button class="btn sm" data-reopen="${t.id}">Reopen</button>` : ""}
      </div></div>`;
  };

  const dep = it.tasks.find(t => t.kind === "parent");
  const parentCard = dep ? `<div class="card"><header><h2>Cut from</h2>
      <span class="sub">${ruleTag("CC-24")} “${esc(dep.name)}” ticks itself when the ${esc(det.parent_type || "parent")}'s stage is done</span></header>
      <div class="body">
        ${it.parent_id ? `<p style="margin-bottom:.5rem"><a href="#/content/item/${it.parent_id}"><b>${esc(it.parent_title || "Open slot")}</b></a>
          — posts ${fdy(it.parent_date)}</p>` : `<p class="help" style="margin-bottom:.5rem">No parent linked yet.</p>`}
        ${work && !dep.done_at ? `<div class="inline">
          <select class="inp" id="parentSel" style="flex:1;min-width:14rem"><option value="">— no parent —</option>
            ${det.parents.map(p => `<option value="${p.id}" ${p.id === it.parent_id ? "selected" : ""} ${p.fits ? "" : "disabled"}>${fd(p.date)} · ${
              esc(p.account_name || "")} · ${esc(p.title || "open slot")} — ${esc(p.stage)} ${p.done_on ? "done" : `due ${fd(p.ready_by)}`}${
              p.fits ? "" : " (too late)"}</option>`).join("")}</select>
          <button class="btn" data-a="link">Link</button></div>
          <p class="help" style="margin-top:.25rem">This item needs “${esc(dep.name)}” by ${fdy(dep.due)}. A parent whose stage is due later is
            shown but cannot be chosen.</p>` : ""}
      </div></div>` : "";

  const figures = () => {
    const plats = it.platforms;
    const pid = plats.some(p => p.channel_id === Number(figurePlatform)) ? Number(figurePlatform) : plats[0]?.channel_id;
    const applicable = b.metrics.filter(m => m.active && (!m.platforms.length || m.platforms.includes(pid)));
    const owed = setting("content_metric_capture_days").split(",").filter(Boolean).map(Number).map(d => {
      const due = addDays(it.published_on, d);
      const miss = plats.filter(p => !det.metrics.history.some(h => h.channel_id === p.channel_id && h.captured_on >= due)).map(p => p.name);
      return `Day-${d} capture ${due > today() ? "due" : "was due"} ${fdw(due)}: ${miss.length ? `still needed for ${esc(miss.join(", "))}` : "done"}`;
    });
    return `<div class="card"><header><h2>Figures</h2><span class="sub">${ruleTag("CC-30")} ${ruleTag("CC-31")} per platform, dated</span></header>
      <div class="body">
        ${dataTable({ columns: [
          { label: "Platform", cell: v => esc(v.platform) }, { label: "Metric", cell: v => esc(v.metric) },
          { label: "Latest", align: "r", cell: v => Number(v.value).toLocaleString("en-US") },
          { label: "Captured", cell: v => `${fdy(v.captured_on)} <span class="help">day ${diff(it.published_on, v.captured_on)}</span>` }
        ], rows: det.metrics.latest, empty: "No figures yet." })}
        <p class="help" style="margin:.5rem 0">${owed.join(" · ")}</p>
        ${b.can.work && !it.cancelled_at ? `<div class="formgrid">
          <div class="field"><label for="mPlat">Platform</label><select class="inp" id="mPlat">
            ${plats.map(p => `<option value="${p.channel_id}" ${p.channel_id === pid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="mOn">Captured on</label><input class="inp" type="date" id="mOn" value="${today()}" min="${it.published_on}" max="${today()}"></div>
          ${applicable.map(m => `<div class="field"><label for="mv${m.id}">${esc(m.name)}</label>
            <input class="inp num" id="mv${m.id}" data-metric="${m.id}" inputmode="numeric" placeholder="0">
            ${m.help ? `<div class="help">${esc(m.help)}</div>` : ""}</div>`).join("")}
        </div>
        <div class="inline"><button class="btn brand" data-a="figures">Save figures</button>
          <span class="help">Only the metrics ${esc(plats.find(p => p.channel_id === pid)?.name || "")} reports are offered.</span></div>` : ""}
      </div></div>`;
  };

  const publishCard = work ? `<div class="card"><header><h2>Publish</h2>
      <span class="sub">${ruleTag("CC-25")} every earlier stage done, ${setting("content_require_url") === "1" ? "a link per platform, " : ""}and a date that is not in the future</span></header>
      <div class="body"><div class="formgrid">
        ${it.platforms.map(p => `<div class="field"><label for="url${p.channel_id}">${esc(p.name)} post link</label>
          <input class="inp" id="url${p.channel_id}" data-url="${p.channel_id}" value="${esc(p.url || "")}" placeholder="https://"></div>`).join("")}
        <div class="field"><label for="pubOn">Published on</label><input class="inp" type="date" id="pubOn" value="${today()}" max="${today()}"></div>
      </div>
      <div class="inline"><button class="btn success" data-a="publish" ${it.state === "Ready" && mayAct(it.tasks.at(-1) || {}) ? "" : "disabled"}>Publish</button>
        <span class="help">${it.state !== "Ready" ? `Publishing opens once every stage before it is done${it.next_task ? ` — next is “${esc(it.next_task.name)}”` : ""}.`
          : !mayAct(it.tasks.at(-1) || {}) ? `The ${esc(it.tasks.at(-1)?.owner_role || "owner")} publishes it.` : ""}</span></div>
      </div></div>` : "";

  // A target's slot is cancelled with a reason, never deleted (CC-29), so Delete is only offered on an extra post.
  const canDelete = b.can.work && !it.cadence_id && !det.leads.length && !det.children.length;
  const deleteWhy = det.leads.length ? `Attributed to ${det.leads.length} lead(s) in the CRM (CC-29)` : det.children.length ? "Items are cut from it (CC-29)" : "";

  return {
    html: `<main>
      <div class="highlights">
        <div class="top">
          <div class="icon" style="background:${esc(acct(it.account_id).colour || "var(--violet)")}">${ICON.doc}</div>
          <div style="min-width:0"><div class="eyebrow">${esc(it.type_name)} · ${esc(it.account_name)}</div>
            <h1>${esc(title)} ${stateBadge(it.state)}</h1></div>
          <div class="acts">
            <a class="btn" href="#/content/calendar?month=${it.date.slice(0, 7)}">← ${pmon(it.date.slice(0, 7))}</a>
            ${work ? `<button class="btn" data-a="move">Move…</button><button class="btn danger" data-a="cancel">Cancel post…</button>` : ""}
            ${b.can.work && !it.cadence_id ? `<button class="btn danger" data-a="delete" ${canDelete ? "" : `disabled title="${esc(deleteWhy)}"`}>Delete</button>` : ""}
          </div>
        </div>
        <div class="hfields">
          <div class="f"><div class="k">Posting date</div><div class="v">${fdy(it.date)}</div>${it.moved ? `<div class="help">moved from ${fdw(it.slot_date)}</div>` : ""}</div>
          <div class="f"><div class="k">Account</div><div class="v">${acctTag(it.account_id)}</div></div>
          <div class="f"><div class="k">Platforms</div><div class="v">${platTags(it.platforms)}</div></div>
          <div class="f"><div class="k">From</div><div class="v">${det.cadence ? `Target #${det.cadence.id}` : "Extra post"}</div>
            <div class="help">${det.cadence ? esc(det.cadence.pattern) : "outside any target"}</div></div>
          <div class="f"><div class="k">Readiness</div><div class="v num">${it.readiness}%</div>
            <div class="bigmeter"><i style="width:${it.readiness}%;background:${it.state === "Published" ? "var(--success)" : it.state === "Ready" ? "var(--teal)" : "var(--brand)"}"></i></div></div>
          <div class="f"><div class="k">${it.published_on ? "Published" : "Next"}</div><div class="v">${it.published_on
            ? `${fdy(it.published_on)}${it.published_on > it.date ? ` <span class="help">${diff(it.date, it.published_on)} day(s) after plan</span>` : ""}`
            : it.next_task ? `${esc(it.next_task.name)}<div class="help">due ${fdw(it.next_task.due)} · ${rel(it.next_task.due)}</div>` : "—"}</div></div>
        </div>
      </div>
      ${it.flags.length ? `<div class="warnbox">${it.flags.map(esc).join("<br>")}</div>` : ""}
      ${it.cancelled_at ? `<div class="warnbox">Cancelled ${fdy(it.cancelled_at.slice(0, 10))}: ${esc(it.cancel_reason || "")} — it still counts against its target.</div>` : ""}
      ${det.prompt ? `<div class="infobox"><b>Raised from Product Lifecycle.</b> ${esc(det.prompt.detail || "")}</div>` : ""}
      ${!it.tasks.length ? `<div class="infobox">This item was planned before ${esc(it.type_name)} had a stage list. It picks one up as soon
        as a content administrator sets that type's stages in Setup.</div>` : ""}
      <div class="split">
        <div>
          ${it.tasks.length ? `<div class="card"><header><h2>Stages</h2><span class="sub">deadlines counted back from ${fdy(it.date)},
            off weekends and holidays ${ruleTag("CC-22")} ${ruleTag("CC-23")}</span></header>
            <div class="stages">${it.tasks.map(stageRow).join("")}</div></div>` : ""}
          <div class="card"><header><h2>Topic, theme and keyword</h2><span class="sub">${ruleTag("CC-21")} all three close the topic stage</span></header>
            <div class="body"><form id="topicform"><div class="formgrid">
              <div class="field full"><label for="tTitle">Topic</label><input class="inp" id="tTitle" name="title" value="${esc(it.title || "")}" ${work ? "" : "readonly"}></div>
              <div class="field"><label for="tTheme">Content theme</label><input class="inp" id="tTheme" name="theme" value="${esc(it.theme || "")}" ${work ? "" : "readonly"}></div>
              <div class="field"><label for="tKey">Keyword</label><input class="inp" id="tKey" name="keyword" value="${esc(it.keyword || "")}" ${work ? "" : "readonly"}></div>
              <div class="field"><label for="tOff">Offering</label><select class="inp" id="tOff" name="offering_id" ${work ? "" : "disabled"}>
                ${optionsOf(b.offerings.filter(o => o.active || o.id === it.offering_id), "— none —").map(o => `<option value="${o.value}" ${String(o.value) === String(it.offering_id ?? "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div>
              <div class="field"><label for="tInd">Industry</label><select class="inp" id="tInd" name="industry_id" ${work ? "" : "disabled"}>
                ${optionsOf(b.industries.filter(i => i.active || i.id === it.industry_id), "— none —").map(o => `<option value="${o.value}" ${String(o.value) === String(it.industry_id ?? "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div>
            </div>
            ${work ? `<div class="inline"><button class="btn brand" type="submit">Save topic</button>
              ${topic && !topic.done_at && !mayAct(topic) ? `<span class="help">Saved as a suggestion — the ${esc(topic.owner_role || "owner")} confirms it.</span>` : ""}</div>` : ""}
            </form></div></div>
          ${publishCard}
          ${it.published_on ? figures() : ""}
        </div>
        <div>
          ${parentCard}
          ${det.children.length ? `<div class="card"><header><h2>Cut from this</h2><span class="sub">${det.children.length}</span></header>
            <div class="body flush">${det.children.map(k => `<div class="rrow"><div class="b"><b><a href="#/content/item/${k.id}">${esc(k.title || "Open slot")}</a></b>
              <div class="m">${esc(k.type_name)} · ${fdw(k.date)} · ${k.readiness}%</div></div><div class="r">${stateBadge(k.state)}</div></div>`).join("")}</div></div>` : ""}
          <div class="card"><header><h2>Leads from this post</h2><span class="sub">${det.leads.length}</span></header>
            <div class="body flush">${det.leads.length ? det.leads.map(l => `<div class="rrow"><div class="b"><b>${hasCRM()
              ? `<a href="#/crm/lead/${l.id}">${esc(l.company)}</a>` : esc(l.company)}</b>
              <div class="m">${esc(l.stage_name || "no stage")}${l.lost ? " · lost" : ""}</div></div>
              <div class="r"><span class="badge ${l.is_primary ? "b" : ""}">${l.is_primary ? "primary" : "touch"}</span></div></div>`).join("")
              : `<div class="empty">No lead in the CRM names this post yet.</div>`}</div></div>
          <div class="card"><header><h2>History</h2></header><div class="body">${det.history.length ? `<div class="tl">${det.history.map(h => `
            <div class="item ${h.action === "cancel" ? "bad" : h.action === "publish" ? "mkt" : "done"}"><div class="h"><b>${esc(h.summary || h.action)}</b></div>
              <div class="m">${fmtDT(h.created_at)} · ${esc(h.user_name || "System")}</div></div>`).join("")}</div>`
            : `<div class="help">Created ${fdy(it.created_on)}${det.cadence ? ` by target #${det.cadence.id}` : ""}.</div>`}</div></div>
        </div>
      </div></main>`,
    mount() {
      const post = (path, body, msg) => attempt(() => api(path, { method: "POST", body }), msg);
      document.getElementById("topicform")?.addEventListener("submit", e => {
        e.preventDefault();
        post(`/content/items/${it.id}/topic`, Object.fromEntries(new FormData(e.target).entries()), topicMessage);
      });
      document.querySelectorAll("[data-done]").forEach(el => el.onclick = () =>
        post(`/content/tasks/${el.dataset.done}/done`, {}, r => `Done — ${r.readiness}% ready.`));
      document.querySelectorAll("[data-source]").forEach(el => el.onclick = () => openForm({
        title: "Where did the material come from?", size: "sm",
        rule: `<b>CC-24.</b> No parent item is linked, so the stage needs a note of where the material came from instead.`,
        fields: [{ name: "note", label: "Source", type: "textarea", rows: 3, required: true, cols: "full",
          placeholder: "e.g. shot separately at the client's warehouse" }],
        submit: "Mark it done",
        onSubmit: async d => { await api(`/content/tasks/${el.dataset.source}/done`, { method: "POST", body: d }); await after("Done — the source is recorded."); }
      }));
      document.querySelectorAll("[data-reopen]").forEach(el => el.onclick = () => openForm({
        title: "Reopen this stage", size: "sm",
        rule: `<b>CC-27.</b> Every later stage reopens with it${det.children.length ? ", and so does any item that took its material from it" : ""}.`,
        fields: [{ name: "reason", label: "Why is it being reopened?", type: "textarea", rows: 3, required: true, cols: "full" }],
        submit: "Reopen", danger: true,
        onSubmit: async d => { const r = await api(`/content/tasks/${el.dataset.reopen}/reopen`, { method: "POST", body: d });
          await after(`Reopened — ${r.readiness}% ready.`); }
      }));
      document.querySelector('[data-a="link"]')?.addEventListener("click", () =>
        post(`/content/items/${it.id}/parent`, { parent_id: document.getElementById("parentSel").value },
          r => r.parent_id ? `Linked to “${r.parent_title || "the parent"}”.` : "Parent removed."));
      document.querySelector('[data-a="publish"]')?.addEventListener("click", () => {
        const urls = {};
        document.querySelectorAll("[data-url]").forEach(el => { urls[el.dataset.url] = el.value.trim(); });
        post(`/content/items/${it.id}/publish`, { urls, published_on: document.getElementById("pubOn").value },
          r => `Published ${fdy(r.published_on)}${r.published_on > r.date ? ` — ${diff(r.date, r.published_on)} day(s) after plan` : " — on time"}.`);
      });
      document.getElementById("mPlat")?.addEventListener("change", e => { figurePlatform = e.target.value; renderInPlace(); });
      document.querySelector('[data-a="figures"]')?.addEventListener("click", () => {
        const values = {};
        document.querySelectorAll("[data-metric]").forEach(el => { values[el.dataset.metric] = el.value; });
        post(`/content/items/${it.id}/metrics`, { channel_id: Number(document.getElementById("mPlat").value),
          captured_on: document.getElementById("mOn").value, values }, "Figures saved.");
      });
      document.querySelector('[data-a="move"]')?.addEventListener("click", () => openForm({
        title: "Move this post", size: "sm",
        rule: `<b>CC-26.</b> Every deadline moves with the posting date, because none is stored.${started ? " Work has started, so the move needs a reason." : ""}`,
        fields: [
          { name: "date", label: "New posting date", type: "date", required: true, min: today(), value: it.date, cols: "full" },
          { name: "reason", label: started ? "Reason" : "Reason (optional until work starts)", type: "textarea", rows: 3, required: started, cols: "full" }
        ],
        submit: "Move the post",
        onSubmit: async d => { const r = await api(`/content/items/${it.id}/move`, { method: "POST", body: d });
          await after(`Moved to ${fdy(r.date)}.${r.warnings?.length ? " " + r.warnings.join(" ") : " Every deadline moved with it."}`); }
      }));
      document.querySelector('[data-a="cancel"]')?.addEventListener("click", () => openForm({
        title: "Cancel this post", size: "sm", danger: true,
        rule: `<b>CC-28.</b> A cancelled post stays on the record and still counts against its target — the reason is part of that record.`,
        fields: [{ name: "reason", label: "Why is it cancelled?", type: "textarea", rows: 3, required: true, cols: "full" }],
        submit: "Cancel the post",
        onSubmit: async d => { const r = await api(`/content/items/${it.id}/cancel`, { method: "POST", body: d });
          await after(`Cancelled.${r.children_flagged ? ` ${r.children_flagged} item(s) cut from it need a new parent.` : ""}${
            r.cadence_id ? " It still counts against its target." : ""}`); }
      }));
      document.querySelector('[data-a="delete"]')?.addEventListener("click", () => confirmAction({
        title: `Delete “${title}”`, danger: true, submit: "Delete",
        body: "An extra post nobody has attributed a lead to can be removed outright. A launch prompt it answered opens again.",
        onConfirm: async () => { await api(`/content/items/${it.id}`, { method: "DELETE" }); await contentRefresh();
          toast("ok", "Post deleted."); go(`/content/calendar?month=${it.date.slice(0, 7)}`); }
      }));
    }
  };
}
