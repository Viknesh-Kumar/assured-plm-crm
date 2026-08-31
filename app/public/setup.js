// Setup: users, roles and permissions, stage model, exit criteria, reference data, audit trail.
import {
  S, api, esc, fmtDT, fmtDate, can, me, ICON, toast, errToast, openForm, openPanel, openMenu,
  confirmAction, dataTable, link, initials, refresh, go, render, stageList, setting
} from "./app.js";

const TABS = [
  ["users", "Users", "users.manage"],
  ["roles", "Roles & permissions", "users.manage"],
  ["stages", "Stage model", "stagemodel.manage"],
  ["criteria", "Exit criteria", "stagemodel.manage"],
  ["settings", "Reference data & settings", "settings.manage"],
  ["audit", "Audit trail", "settings.manage"]
];

export async function setup(tab = "users") {
  const allowed = TABS.filter(t => can(t[2]));
  if (!allowed.length) return { html: `<main><div class="card"><div class="empty">
    Setup is restricted. Your roles do not carry <span class="mono">users.manage</span>,
    <span class="mono">stagemodel.manage</span> or <span class="mono">settings.manage</span>.</div></div></main>` };
  if (!allowed.some(t => t[0] === tab)) tab = allowed[0][0];

  const body = await ({ users: usersTab, roles: rolesTab, stages: stagesTab, criteria: criteriaTab,
    settings: settingsTab, audit: auditTab }[tab])();

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--ink-3)">${ICON.gear}</div>
        <div><div class="eyebrow">Administration</div><h1>Setup</h1>
          <div class="desc">The stage model, exit criteria, thresholds, day rate, roles and users are all configurable without a code
            change (NFR-14). Every change here is written to the audit trail (FR-55).</div></div>
      </div>
      <div class="card">
        <div class="rtabs">${allowed.map(([k, l]) => `<a href="#/setup/${k}" style="text-decoration:none"><button aria-selected="${tab === k}">${esc(l)}</button></a>`).join("")}</div>
        <div class="body ${body.flush ? "flush" : ""}">${body.html}</div>
      </div>
      ${body.extra || ""}
      </main>`,
    mount: body.mount
  };
}

/* =================================================================== */
/* USERS                                                                */
/* =================================================================== */
async function usersTab() {
  const users = await api("/users");
  const roles = S.boot.roles;
  const rolePill = id => { const r = roles.find(x => x.id === id); return r ? `<span class="pill">${esc(r.name)}</span>` : ""; };

  const html = `
  <div class="lvhead" style="padding-left:0;padding-right:0;border:none">
    <span class="count">${users.length} user${users.length === 1 ? "" : "s"} · ${users.filter(u => u.active).length} active</span>
    <span class="spacer"></span>
    <input class="inp" id="uq" type="search" placeholder="Search users…" style="width:16rem">
    <button class="btn brand" data-a="new-user">${ICON.plus} New User</button>
  </div>
  <div class="infobox">A user may hold any number of roles, and a role may be held by any number of users. Approval authority is not
    granted here — it is read from the stage model, so whoever holds the approver role for a gate is the only person who may decide it (BR-07).
    The separation of duties in BR-09 still applies even where one person holds both roles.</div>
  <div id="ubody">${userTable(users, rolePill)}</div>`;

  return {
    html,
    mount() {
      const redraw = q => {
        const f = users.filter(u => !q || (u.name + " " + u.email + " " + (u.title || "")).toLowerCase().includes(q));
        document.getElementById("ubody").innerHTML = userTable(f, rolePill);
        wire();
      };
      const wire = () => {
        document.querySelectorAll("[data-edituser]").forEach(b => b.onclick = () => editUser(users.find(u => u.id === +b.dataset.edituser), roles));
        document.querySelectorAll("[data-pw]").forEach(b => b.onclick = () => resetPassword(users.find(u => u.id === +b.dataset.pw)));
        document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => toggleUser(users.find(u => u.id === +b.dataset.toggle)));
      };
      document.getElementById("uq").oninput = e => redraw(e.target.value.toLowerCase());
      document.querySelector('[data-a="new-user"]').onclick = () => editUser(null, roles);
      wire();
    }
  };
}

const userTable = (users, rolePill) => dataTable({
  columns: [
    { label: "Name", cell: u => `<div style="display:flex;align-items:center;gap:.5rem">
        <span class="avatar" style="background:${u.active ? "#5867E8" : "#C9C9C9"}">${esc(initials(u.name))}</span>
        <div><b>${esc(u.name)}</b><div style="font-size:.6875rem;color:var(--ink-4)">${esc(u.title || "")}</div></div></div>` },
    { label: "Email", cell: u => `<span class="mono" style="font-size:.6875rem">${esc(u.email)}</span>` },
    { label: "Roles", cell: u => u.role_ids.length ? `<div class="pills">${u.role_ids.map(rolePill).join("")}</div>` : `<span class="badge y">No role</span>` },
    { label: "Status", cell: u => u.active ? `<span class="badge dot g">Active</span>` : `<span class="badge dot n">Inactive</span>` },
    { label: "Password", cell: u => u.must_change ? `<span class="badge y">Seeded — must change</span>` : `<span class="badge">Set by user</span>` },
    { label: "Last sign-in", cell: u => u.last_login ? fmtDT(u.last_login) : "never" },
    { label: "", align: "r", cell: u => `<div class="btngroup">
        <button class="btn sm" data-edituser="${u.id}">Edit</button>
        <button class="btn sm" data-pw="${u.id}">Reset password</button>
        <button class="btn sm ${u.active ? "danger" : ""}" data-toggle="${u.id}">${u.active ? "Deactivate" : "Activate"}</button>
      </div>` }
  ], rows: users, empty: "No users."
});

function editUser(u, roles) {
  openForm({
    title: u ? `Edit ${u.name}` : "New User", size: "",
    rule: u ? "" : `A new user is created with a temporary password and is asked to change it on first sign-in (NFR-06).`,
    fields: [
      { name: "name", label: "Full name", value: u?.name, required: true },
      { name: "email", label: "Email", type: "email", value: u?.email, required: true },
      { name: "title", label: "Job title", value: u?.title, placeholder: "e.g. Senior Consultant" },
      ...(u ? [] : [{ name: "password", label: "Temporary password", type: "password", minlength: 8, placeholder: "Assured@2026",
        help: "At least 8 characters. Leave blank to use the default." }]),
      { name: "role_ids", label: "Roles", type: "checkboxes", numeric: true, cols: "full", value: u?.role_ids || [],
        options: roles.map(r => ({ value: r.id, label: r.name, hint: r.description })),
        help: "Any role may be assigned to any user, and a user may hold several. Permissions are the union of the roles held." },
      ...(u ? [{ name: "active", label: "Active — may sign in", type: "checkbox", checked: !!u.active, cols: "full" }] : [])
    ],
    submit: u ? "Save user" : "Create user",
    onSubmit: async d => {
      await api(u ? `/users/${u.id}` : "/users", { method: u ? "PATCH" : "POST", body: d });
      S.boot = await api("/bootstrap");
      toast("ok", u ? "User updated." : "User created."); await render();
    }
  });
}

function resetPassword(u) {
  openForm({
    title: `Reset password — ${u.name}`, size: "sm",
    intro: "The user will be asked to change this password after signing in.",
    fields: [{ name: "password", label: "New temporary password", type: "password", required: true, minlength: 8, cols: "full" }],
    submit: "Reset password",
    onSubmit: async d => { await api(`/users/${u.id}/password`, { method: "POST", body: d }); toast("ok", "Password reset."); await render(); }
  });
}

function toggleUser(u) {
  confirmAction({
    title: u.active ? `Deactivate ${u.name}` : `Activate ${u.name}`,
    body: u.active
      ? "The user can no longer sign in. Their historical records, approvals and effort entries are retained (NFR-17)."
      : "The user regains access with their existing roles.",
    submit: u.active ? "Deactivate" : "Activate", danger: !!u.active,
    onConfirm: async () => {
      await api(`/users/${u.id}`, { method: "PATCH", body: { name: u.name, email: u.email, title: u.title, active: !u.active } });
      S.boot = await api("/bootstrap"); toast("ok", "User updated."); await render();
    }
  });
}

/* =================================================================== */
/* ROLES & PERMISSIONS                                                  */
/* =================================================================== */
async function rolesTab() {
  const roles = S.boot.roles, perms = S.boot.permissions, users = S.boot.users;
  const holders = r => users.filter(u => (u.roles || "").split(", ").includes(r.name));
  const stagesFor = r => S.boot.stages.filter(s => s.approver_role_id === r.id).map(s => s.seq).sort((a, b) => a - b);

  const html = `
  <div class="lvhead" style="padding-left:0;padding-right:0;border:none">
    <span class="count">${roles.length} roles · ${perms.length} permissions</span>
    <span class="spacer"></span>
    <button class="btn brand" data-a="new-role">${ICON.plus} New Role</button>
  </div>
  <div class="infobox">The six roles below are the roles named in the BRD (A-01). Extra roles may be added and assigned freely; only the
    six system roles cannot be deleted. Gate approval authority comes from the stage model, not from these permissions.</div>
  ${dataTable({
    columns: [
      { label: "Role", cell: r => `<b>${esc(r.name)}</b>${r.is_system ? ` <span class="badge b">System</span>` : ` <span class="badge v">Custom</span>`}` },
      { label: "Responsibilities", cell: r => `<span class="trunc" style="max-width:30rem">${esc(r.description || "")}</span>` },
      { label: "Approves gates", cell: r => { const g = stagesFor(r); return g.length ? g.map(n => `<span class="badge b">${n}</span>`).join(" ") : "—"; } },
      { label: "Permissions", align: "r", cell: r => (r.permissions || "").split(",").filter(Boolean).length },
      { label: "Users", align: "r", cell: r => holders(r).length },
      { label: "", align: "r", cell: r => `<div class="btngroup"><button class="btn sm" data-editrole="${r.id}">Edit</button>
        ${r.is_system ? "" : `<button class="btn sm danger" data-delrole="${r.id}">Delete</button>`}</div>` }
    ], rows: roles, empty: "No roles."
  })}

  <h3 style="margin:1.25rem 0 .5rem;font-size:.875rem">Permission matrix</h3>
  <div class="tablewrap"><table class="dt">
    <thead><tr><th>Permission</th>${roles.map(r => `<th class="c">${esc(r.name)}</th>`).join("")}</tr></thead>
    <tbody>${perms.map(([key, label]) => `<tr><td><b>${esc(label)}</b><br><span class="mono" style="font-size:.625rem;color:var(--ink-4)">${esc(key)}</span></td>
      ${roles.map(r => `<td class="c">${(r.permissions || "").split(",").includes(key)
        ? `<span style="color:var(--success)">${ICON.check}</span>` : `<span style="color:var(--line-2)">—</span>`}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>

  <h3 style="margin:1.25rem 0 .5rem;font-size:.875rem">Role holders</h3>
  <div class="grid g3">${roles.map(r => `<div class="card" style="margin:0">
    <header><h2>${esc(r.name)}</h2><span class="sub">${holders(r).length}</span></header>
    <div class="body flush">${holders(r).length ? holders(r).map(u => `<div class="rrow">
      <span class="avatar">${esc(initials(u.name))}</span>
      <div class="b"><b>${esc(u.name)}</b><div class="m">${esc(u.title || u.email)}</div></div></div>`).join("")
      : `<div class="empty" style="padding:1rem">No user holds this role. Gates it approves cannot be decided (BR-07).</div>`}</div>
  </div>`).join("")}</div>`;

  return {
    html,
    mount() {
      document.querySelectorAll("[data-editrole]").forEach(b => b.onclick = () => editRole(roles.find(r => r.id === +b.dataset.editrole), perms));
      document.querySelectorAll("[data-delrole]").forEach(b => b.onclick = () => {
        const r = roles.find(x => x.id === +b.dataset.delrole);
        confirmAction({
          title: `Delete role ${r.name}`, body: "Users holding this role lose its permissions. Roles referenced by the stage model cannot be deleted.",
          submit: "Delete role", danger: true,
          onConfirm: async () => { await api(`/roles/${r.id}`, { method: "DELETE" }); S.boot = await api("/bootstrap"); toast("ok", "Role deleted."); await render(); }
        });
      });
      document.querySelector('[data-a="new-role"]').onclick = () => editRole(null, perms);
    }
  };
}

function editRole(r, perms) {
  openForm({
    title: r ? `Edit role — ${r.name}` : "New Role", size: "",
    rule: r?.is_system ? `This is one of the six roles named in the BRD. Its name is fixed; its permissions may be changed.` : "",
    fields: [
      { name: "name", label: "Role name", value: r?.name, required: true, cols: "full",
        ...(r?.is_system ? { help: "System role — the name cannot be changed." } : {}) },
      { name: "description", label: "Responsibilities in the lifecycle", type: "textarea", rows: 2, value: r?.description, cols: "full" },
      { name: "permissions", label: "Permissions", type: "checkboxes", cols: "full",
        value: (r?.permissions || "").split(",").filter(Boolean),
        options: perms.map(([key, label]) => ({ value: key, label, hint: key })) }
    ],
    submit: r ? "Save role" : "Create role",
    onSubmit: async d => {
      await api(r ? `/roles/${r.id}` : "/roles", { method: r ? "PATCH" : "POST", body: d });
      S.boot = await api("/bootstrap"); toast("ok", r ? "Role updated." : "Role created."); await render();
    }
  });
}

/* =================================================================== */
/* STAGE MODEL                                                          */
/* =================================================================== */
async function stagesTab() {
  const dev = stageList("development"), mkt = stageList("market");
  const roleOpts = [{ value: "", label: "— none —" }, ...S.boot.roles.map(r => ({ value: r.id, label: r.name }))];

  const table = (rows, isDev) => dataTable({
    columns: [
      { label: isDev ? "Gate" : "#", align: "c", cell: s => isDev ? `<b>${s.seq}</b>` : "—" },
      { label: "Stage", cell: s => `<b>${esc(s.name)}</b><br><span style="font-size:.6875rem;color:var(--ink-4)" class="trunc">${esc(s.purpose || s.definition || "")}</span>` },
      { label: "Stage owner", cell: s => `${esc(s.owner_role || "—")}<br><span style="font-size:.625rem;color:var(--ink-4)">moves it on</span>` },
      { label: "Approver", cell: s => isDev ? esc(s.approver_role || "—") : `<span class="badge">NA</span>` },
      { label: "Participants", cell: s => s.participants.length ? s.participants.map(c => `<span class="pill">${esc(c.name)}</span>`).join(" ") : "—" },
      { label: "Target", align: "r", cell: s => isDev ? `${s.target_days} wd` : "—" },
      { label: "Ageing", align: "r", cell: s => isDev ? `${s.ageing_days} wd` : "—" },
      { label: "Escalates to", cell: s => isDev ? esc(s.escalate_role || "—") : "—" },
      { label: "Criteria", align: "r", cell: s => isDev ? s.criteria.filter(c => c.active).length : "—" },
      { label: "", align: "r", cell: s => can("stagemodel.manage") ? `<button class="btn sm" data-editstage="${s.id}">Edit</button>` : "" }
    ], rows, empty: "No stages."
  });

  return {
    flush: false,
    html: `
    <div class="infobox">Amending the stage model is approved by the CEO on the Business Head's recommendation (§13). Changing a target
      or ageing threshold takes effect immediately for time-in-stage and the exception report; it does not rewrite history.</div>
    <h3 style="margin:.5rem 0;font-size:.875rem">Development track — eight gates</h3>
    ${table(dev, true)}
    <h3 style="margin:1.25rem 0 .5rem;font-size:.875rem">Market track — six states, no approver</h3>
    ${table(mkt, false)}`,
    mount() {
      document.querySelectorAll("[data-editstage]").forEach(b => b.onclick = () => {
        const s = S.boot.stages.find(x => x.id === +b.dataset.editstage);
        const isDev = s.track === "development";
        openForm({
          title: `${isDev ? `Gate ${s.seq}` : "Market state"} — ${s.name}`, size: "",
          fields: [
            { name: "name", label: "Stage name", value: s.name, required: true, cols: "full" },
            { name: isDev ? "purpose" : "definition", label: isDev ? "Purpose" : "Definition", type: "textarea", rows: 2,
              value: isDev ? s.purpose : s.definition, cols: "full" },
            { name: "owner_role_id", label: "Stage owner — moves the stage on", type: "select", value: String(s.owner_role_id || ""), options: roleOpts },
            ...(isDev ? [
              { name: "approver_role_id", label: "Approver", type: "select", value: String(s.approver_role_id || ""), options: roleOpts,
                help: "Only a user holding this role may approve the gate (BR-07)." },
              { name: "target_days", label: "Target duration (working days)", type: "number", min: 1, value: s.target_days },
              { name: "ageing_days", label: "Ageing threshold (working days)", type: "number", min: 1, value: s.ageing_days,
                help: "§14.1 sets this at 1.5 × the target." },
              { name: "escalate_role_id", label: "Escalates to", type: "select", value: String(s.escalate_role_id || ""), options: roleOpts }
            ] : [
              { name: "entry_condition", label: "Entry condition", type: "textarea", rows: 2, value: s.entry_condition, cols: "full" },
              { name: "exit_condition", label: "Exit condition", type: "textarea", rows: 2, value: s.exit_condition, cols: "full" }
            ]),
            { name: "participant_ids", label: "Participants", type: "checkboxes", numeric: true, cols: "full",
              value: s.participants.map(c => c.id), options: S.boot.roles.map(r => ({ value: r.id, label: r.name })),
              help: "Notified when the stage is submitted and when it is decided. Participants never block an approval." }
          ],
          submit: "Save stage",
          onSubmit: async d => {
            await api(`/stages/${s.id}`, { method: "PATCH", body: d });
            S.boot = await api("/bootstrap"); toast("ok", "Stage model updated."); await render();
          }
        });
      });
    }
  };
}

/* =================================================================== */
/* EXIT CRITERIA                                                        */
/* =================================================================== */
async function criteriaTab() {
  const dev = stageList("development");
  return {
    html: `
    <div class="infobox">Exit criteria are maintained here without a code change (FR-52). A gate cannot be submitted until every active
      criterion is marked met with an evidence note (BR-06 / FR-13). Deactivating a criterion removes it from future gate checks; products
      already past that gate are untouched.</div>
    <div class="grid g2">
      ${dev.map(s => `<div class="card" style="margin:0">
        <header><div class="ci" style="background:var(--brand)">${ICON.gate}</div>
          <h2>Gate ${s.seq} — ${esc(s.name)}</h2>
          <div class="right">${can("stagemodel.manage") ? `<button class="btn sm" data-addcrit="${s.id}">${ICON.plus} Add</button>` : ""}</div></header>
        <div class="body flush">${s.criteria.length ? s.criteria.map(c => `
          <div class="crit ${c.active ? "" : ""}" style="${c.active ? "" : "opacity:.5"}">
            <div class="box" style="border-color:var(--brand);color:var(--brand)">${c.seq}</div>
            <div class="txt"><b>${esc(c.text)}</b>${c.active ? "" : `<div class="by">Inactive</div>`}</div>
            ${can("stagemodel.manage") ? `<button class="btn sm" data-editcrit="${c.id}">Edit</button>` : ""}
          </div>`).join("") : `<div class="empty">No exit criteria. A gate with no criteria cannot be submitted.</div>`}</div>
      </div>`).join("")}
    </div>`,
    mount() {
      document.querySelectorAll("[data-addcrit]").forEach(b => b.onclick = () => critForm(null, +b.dataset.addcrit));
      document.querySelectorAll("[data-editcrit]").forEach(b => b.onclick = () => {
        const c = S.boot.stages.flatMap(s => s.criteria).find(x => x.id === +b.dataset.editcrit);
        critForm(c);
      });
    }
  };
}

function critForm(c, stageId) {
  openForm({
    title: c ? "Edit exit criterion" : "Add exit criterion", size: "sm",
    fields: [
      { name: "text", label: "Criterion", type: "textarea", rows: 3, value: c?.text, required: true, cols: "full",
        help: "Written, testable, and refusable — an approver must be able to say no against it." },
      ...(c ? [{ name: "active", label: "Active", type: "checkbox", checked: !!c.active, cols: "full" }] : [])
    ],
    submit: c ? "Save" : "Add criterion",
    onSubmit: async d => {
      await api(c ? `/criteria/${c.id}` : "/criteria", { method: c ? "PATCH" : "POST", body: { ...d, stage_id: stageId } });
      S.boot = await api("/bootstrap"); toast("ok", "Exit criteria updated."); await render();
    }
  });
}

/* =================================================================== */
/* SETTINGS / REFERENCE DATA                                            */
/* =================================================================== */
async function settingsTab() {
  const meta = S.boot.settingsMeta.filter(s => s.kind !== "hidden");
  const editable = meta.filter(s => s.key !== "product_code_next" && s.kind !== "json");
  return {
    html: `
    <div class="infobox">Reference data is system-controlled: Origin, Route, Status, stage names and role names cannot be typed free-hand
      anywhere in the application (BR-34). The values below drive validation, ageing, escalation and the return calculation.</div>
    <form id="setform">
      <div class="formgrid">
        ${editable.map(s => `<div class="field">
          <label for="s_${s.key}">${esc(s.label || s.key)}</label>
          ${s.kind === "list"
            ? `<textarea class="inp" id="s_${s.key}" name="${s.key}" rows="3">${esc(s.value.split("|").join("\n"))}</textarea>
               <div class="help">One value per line. Removing a value in use will not rewrite existing records.</div>`
            : `<input class="inp" id="s_${s.key}" name="${s.key}" type="${s.kind === "number" ? "number" : "text"}"
                 value="${esc(s.value)}" ${s.kind === "number" ? 'step="any"' : ""}>
               <div class="help mono" style="font-size:.625rem">${esc(s.key)}</div>`}
        </div>`).join("")}
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.75rem">
        <button class="btn brand" type="submit">Save settings</button>
      </div>
    </form>
    <hr class="sep">
    <h3 style="margin:.5rem 0;font-size:.875rem">Derived and system values</h3>
    <div class="dgrid">
      <div class="dfield"><div class="k">Next product identifier</div><div class="v mono">P-${String(setting("product_code_next", 1)).padStart(3, "0")} — generated, never reused (BR-01)</div></div>
      <div class="dfield"><div class="k">Derived entry gates (BR-04)</div><div class="v">${Object.entries(S.boot.routeEntry).map(([r, g]) => `${r} → ${g}`).join(" · ")}</div></div>
      <div class="dfield"><div class="k">Status values (BR-28)</div><div class="v">${S.boot.statuses.join(" · ")}</div></div>
      <div class="dfield"><div class="k">Retired workbook values</div><div class="v dim">Discover / Define / Build / Validate / Productise / Commercialise / Scale &amp; Review; Replacement Product / Product Upgrade / Alternate Product; Retired</div></div>
    </div>`,
    mount() {
      document.getElementById("setform").onsubmit = async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {};
        for (const [k, v] of fd.entries()) {
          const m = meta.find(s => s.key === k);
          body[k] = m?.kind === "list" ? String(v).split("\n").map(x => x.trim()).filter(Boolean).join("|") : v;
        }
        try { await api("/settings", { method: "POST", body }); S.boot = await api("/bootstrap"); toast("ok", "Settings saved."); await render(); }
        catch (err) { errToast(err); }
      };
    }
  };
}

/* =================================================================== */
/* AUDIT                                                                */
/* =================================================================== */
async function auditTab() {
  const rows = await api("/audit");
  return {
    flush: true,
    html: dataTable({
      columns: [
        { label: "When", cell: a => fmtDT(a.created_at) },
        { label: "Entity", cell: a => `<span class="badge">${esc(a.entity)}</span>${a.entity_id ? ` <span class="mono" style="font-size:.625rem">#${a.entity_id}</span>` : ""}` },
        { label: "Action", cell: a => esc(a.action) },
        { label: "Summary", cell: a => esc(a.summary || "") },
        { label: "Field", cell: a => esc(a.field || "") },
        { label: "From", cell: a => `<span class="trunc" style="max-width:14rem">${esc(a.old_value || "")}</span>` },
        { label: "To", cell: a => `<span class="trunc" style="max-width:14rem">${esc(a.new_value || "")}</span>` },
        { label: "By", cell: a => esc(a.user_name || "system") }
      ], rows, empty: "No audit entries."
    })
  };
}
