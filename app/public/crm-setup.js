// CRM Setup — pipelines, the stage editor, the requirement matrix, the field catalogue,
// reference data and the movement rules. Everything in §5 is changeable from here.
import {
  S, api, esc, fmtDate, can, ICON, toast, errToast, openForm, openPanel, confirmAction,
  dataTable, go, render, crmRefresh
} from "./app.js";

const crm = () => S.crm || {};
const BANDS = ["Lead", "Qualified", "CSE", "Closed"];
const after = async msg => { await crmRefresh(); await render(); if (msg) toast("ok", msg); };

const TABS = [["pipelines", "Pipelines"], ["stages", "Stage editor"], ["matrix", "Requirement matrix"],
  ["fields", "Field catalogue"], ["reference", "Reference data"], ["movement", "Movement rules"],
  ["templates", "Stage templates"]];

let currentPipeline = null;

export async function setup(tab = "pipelines") {
  if (!can("crm.setup.manage"))
    return { html: `<main><div class="card"><div class="empty">
      CRM Setup is restricted to the <b>CRM Administrator</b> role. A Sales User has everything except Setup (FR-43).
    </div></div></main>` };
  if (!TABS.some(t => t[0] === tab)) tab = "pipelines";
  const pipes = crm().pipelines || [];
  if (!currentPipeline || !pipes.some(p => p.id === currentPipeline)) currentPipeline = pipes[0]?.id ?? null;

  const body = await ({ pipelines: tPipelines, stages: tStages, matrix: tMatrix, fields: tFields,
    reference: tReference, movement: tMovement, templates: tTemplates }[tab])();

  return {
    html: `<main>
      <div class="page-head">
        <div class="icon" style="background:var(--ink-3)">${ICON.gear}</div>
        <div><div class="eyebrow">CRM</div><h1>Setup</h1>
          <div class="desc">Stage lists, mandatory fields, the field catalogue itself and every reference list are
            configuration. Anything here that needed a code change to alter would be a defect.</div></div>
      </div>
      <div class="card">
        <div class="rtabs">${TABS.map(([k, l]) =>
          `<a href="#/crm/setup/${k}" style="text-decoration:none"><button aria-selected="${tab === k}">${esc(l)}</button></a>`).join("")}</div>
        <div class="body ${body.flush ? "flush" : ""}">${body.html}</div>
      </div></main>`,
    mount: body.mount
  };
}

const pipeSelect = id => `<select class="inp" id="pipesel" style="width:auto;min-width:20rem">
  ${(crm().pipelines || []).map(p => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>
    ${esc(p.name)} — ${esc(p.industries.map(i => i.name).join(", "))}${p.active ? "" : " (inactive)"}</option>`).join("")}
</select>`;

/* ---------------- pipelines ---------------- */
async function tPipelines() {
  const pipes = crm().pipelines || [];
  return {
    html: `
    <div class="infobox">A pipeline is keyed on <b>Offering × Industry</b>, and at most one active pipeline exists for
      any pair (BR-05). Stages are copied from a template at creation and then owned by the pipeline — editing one
      never touches the other (§3.2).</div>
    <div class="lvhead" style="padding:0 0 .5rem;border:none">
      <span class="count">${pipes.length} pipelines over ${pipes.reduce((n, p) => n + p.industries.length, 0)} (offering, industry) pairs</span>
      <span class="spacer"></span>
      <button class="btn brand" data-a="new-pipe">${ICON.plus} New Pipeline</button>
    </div>
    ${dataTable({
      columns: [
        { label: "Pipeline", cell: p => `<b>${esc(p.name)}</b>` },
        { label: "Offering", cell: p => esc(p.offering_name || "—") },
        { label: "Industries", cell: p => p.industries.map(i => `<span class="pill">${esc(i.name)}</span>`).join(" ") },
        { label: "Template", cell: p => `${esc(p.template_name || "—")}<br><span style="font-size:.625rem;color:var(--ink-4)">${esc(p.source_ref || "")}</span>` },
        { label: "Stages", align: "r", cell: p => p.stage_count },
        { label: "Gate", cell: p => esc(p.gate_name || "—") },
        { label: "Owner", cell: p => esc(p.owner_name || "—") },
        { label: "Leads", align: "r", cell: p => p.lead_count },
        { label: "Status", cell: p => p.active ? `<span class="badge dot g">Active</span>` : `<span class="badge dot n">Inactive</span>` },
        { label: "", align: "r", cell: p => `<div class="btngroup">
            <button class="btn sm" data-edit="${p.id}">Edit</button>
            <button class="btn sm" data-stages="${p.id}">Stages</button>
            <button class="btn sm" data-toggle="${p.id}">${p.active ? "Deactivate" : "Activate"}</button></div>` }
      ], rows: pipes, empty: "No pipelines."
    })}`,
    mount() {
      document.querySelector('[data-a="new-pipe"]').onclick = () => pipeForm(null);
      document.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => pipeForm(pipes.find(p => p.id === +b.dataset.edit)));
      document.querySelectorAll("[data-stages]").forEach(b => b.onclick = () => { currentPipeline = +b.dataset.stages; go("/crm/setup/stages"); });
      document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
        const p = pipes.find(x => x.id === +b.dataset.toggle);
        try {
          await api(`/crm/pipelines/${p.id}`, { method: "PATCH", body: {
            name: p.name, offering_id: p.offering_id, owner_id: p.owner_id,
            industry_ids: p.industries.map(i => i.id), active: !p.active } });
          await after(p.active ? "Pipeline deactivated — its (offering, industry) pairs are free again." : "Pipeline activated.");
        } catch (e) { errToast(e); }
      });
    }
  };
}

function pipeForm(p) {
  openForm({
    title: p ? `Edit ${p.name}` : "New Pipeline", size: "",
    rule: `<b>BR-05.</b> At most one active pipeline per (Offering, Industry) pair. If the pair is taken, the refusal
      names the pipeline that has it.`,
    fields: [
      { name: "name", label: "Pipeline name", required: true, cols: "full", value: p?.name },
      { name: "offering_id", label: "Offering", type: "select", required: true, value: String(p?.offering_id || ""),
        options: (crm().offerings || []).map(o => ({ value: o.id, label: o.name })) },
      { name: "owner_id", label: "Owner", type: "select", value: String(p?.owner_id || ""),
        options: [{ value: "", label: "— none —" }, ...(crm().people || []).map(u => ({ value: u.id, label: u.name }))] },
      ...(p ? [] : [{ name: "template_id", label: "Start from stage template", type: "select", required: true,
        options: (crm().templates || []).map(t => ({ value: t.id, label: `${t.code} · ${t.name} (${t.stages.length} stages)` })),
        help: "The stages are copied. Editing the pipeline afterwards never edits the template." }]),
      { name: "industry_ids", label: "Industries", type: "checkboxes", numeric: true, cols: "full",
        value: p ? p.industries.map(i => i.id) : [],
        options: (crm().industries || []).map(i => ({ value: i.id, label: i.name })) }
    ],
    submit: p ? "Save" : "Create pipeline",
    onSubmit: async d => {
      await api(p ? `/crm/pipelines/${p.id}` : "/crm/pipelines", { method: p ? "PATCH" : "POST", body: d });
      await after(p ? "Pipeline updated." : "Pipeline created with its stages and default requirements.");
    }
  });
}

/* ---------------- stage editor ---------------- */
async function tStages() {
  const p = (crm().pipelines || []).find(x => x.id === currentPipeline);
  if (!p) return { html: `<div class="empty">No pipeline selected.</div>` };
  let stages = p.stages.map(s => ({ ...s }));

  const rows = () => stages.map((s, i) => `<tr data-i="${i}">
    <td class="c">${i + 1}</td>
    <td><input class="inp" data-f="name" value="${esc(s.name)}"></td>
    <td><select class="inp" data-f="band">${BANDS.map(b => `<option ${s.band === b ? "selected" : ""}>${b}</option>`).join("")}</select></td>
    <td class="c"><input type="radio" name="gate" data-f="gate" ${s.is_gate ? "checked" : ""} title="Qualification gate"></td>
    <td class="c">${s.id ? `<span class="badge ${s.lead_count ? "b" : ""}">${s.lead_count ?? 0}</span>` : `<span class="badge v">new</span>`}</td>
    <td class="r"><div class="btngroup">
      <button class="btn sm" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="btn sm" data-down="${i}" ${i === stages.length - 1 ? "disabled" : ""}>↓</button>
      <button class="btn sm danger" data-del="${i}">Remove</button></div></td>
  </tr>`).join("");

  const html = () => `
    <div class="infobox">Rename, reorder, insert and delete stages on a live pipeline. Bands cannot go backwards
      (BR-09), exactly one stage carries the qualification gate (BR-10), the last stage must be Closed (BR-11),
      and a stage holding leads cannot be deleted (BR-12). The server checks all four on save.</div>
    <div class="lvhead" style="padding:0 0 .5rem;border:none">${pipeSelect(currentPipeline)}
      <span class="count">${esc(p.template_name || "")} · ${esc(p.source_ref || "")}</span>
      <span class="spacer"></span>
      <button class="btn" data-a="add">${ICON.plus} Add stage</button>
      <button class="btn brand" data-a="save">Save stage list</button></div>
    <div class="tablewrap"><table class="dt"><thead><tr>
      <th class="c">#</th><th>Stage name</th><th>Band</th><th class="c">Gate</th><th class="c">Leads</th><th></th>
    </tr></thead><tbody id="srows">${rows()}</tbody></table></div>`;

  return {
    html: html(),
    mount() {
      const redraw = () => { document.getElementById("srows").innerHTML = rows(); wire(); };
      const readBack = () => document.querySelectorAll("#srows tr").forEach((tr, i) => {
        stages[i].name = tr.querySelector('[data-f="name"]').value;
        stages[i].band = tr.querySelector('[data-f="band"]').value;
        stages[i].is_gate = tr.querySelector('[data-f="gate"]').checked ? 1 : 0;
      });
      const wire = () => {
        document.querySelectorAll("[data-up]").forEach(b => b.onclick = () => {
          readBack(); const i = +b.dataset.up; [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; redraw();
        });
        document.querySelectorAll("[data-down]").forEach(b => b.onclick = () => {
          readBack(); const i = +b.dataset.down; [stages[i + 1], stages[i]] = [stages[i], stages[i + 1]]; redraw();
        });
        document.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
          readBack(); stages.splice(+b.dataset.del, 1); redraw();
        });
      };
      document.getElementById("pipesel").onchange = e => { currentPipeline = +e.target.value; render(); };
      document.querySelector('[data-a="add"]').onclick = () => {
        readBack(); stages.push({ id: null, name: "New stage", band: "Lead", is_gate: 0 }); redraw();
      };
      document.querySelector('[data-a="save"]').onclick = async () => {
        readBack();
        try { await api(`/crm/pipelines/${p.id}/stages`, { method: "POST", body: { stages } }); await after("Stage list saved."); }
        catch (e) { errToast(e); }
      };
      wire();
    }
  };
}

/* ---------------- requirement matrix ---------------- */
async function tMatrix() {
  if (!currentPipeline) return { html: `<div class="empty">No pipeline.</div>` };
  const m = await api(`/crm/pipelines/${currentPipeline}/matrix`);
  const cellFor = (f, s) => {
    const own = m.own[f.key]?.[s.id];
    // Inherited: required at an earlier stage, so still enforced here (BR-15).
    let inherited = 0;
    for (const st of m.stages) { if (st.seq >= s.seq) break; const v = m.own[f.key]?.[st.id]; if (v) inherited = Math.max(inherited, v === 1 ? 2 : 1); }
    const lvl = own || 0;
    const label = lvl === 1 ? "✱" : lvl === 2 ? "◐" : inherited ? "·" : "";
    const cls = lvl ? "on" : inherited ? "inh" : "";
    const title = lvl === 1 ? "Required here" : lvl === 2 ? "Required here when Lead Source is Online"
      : inherited ? "Inherited — required at an earlier stage" : "Not required";
    return `<td class="cell ${cls}" data-stage="${s.id}" data-field="${f.key}" data-level="${lvl}" title="${title}">${label}</td>`;
  };
  return {
    html: `
    <div class="infobox">Click a cell to cycle it: <b>blank</b> → <b>✱ required</b> → <b>◐ required when Lead Source is
      Online</b> → blank. Requirements are cumulative forward — a dot means the field is already required at an earlier
      stage and is still enforced here (BR-15).</div>
    <div class="lvhead" style="padding:0 0 .5rem;border:none">${pipeSelect(currentPipeline)}
      <span class="spacer"></span>
      <button class="btn" data-a="copyall">Copy this matrix to all pipelines</button></div>
    <div class="tablewrap"><table class="dt matrix">
      <thead><tr><th class="f">Field</th>
        ${m.stages.map(s => `<th class="c rot">${esc(s.name)}${s.is_gate ? " ◆" : ""}</th>`).join("")}</tr></thead>
      <tbody>${m.fields.map(f => `<tr>
        <td class="f">${esc(f.label)}${f.locked ? ` <span class="badge">locked</span>` : ""}</td>
        ${m.stages.map(s => cellFor(f, s)).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p class="note" style="margin-top:.625rem">The seeded default is everything at the qualification gate plus
      Location and Attributed Content at the first CSE stage — the answer to “a lead can be just a name, but later we
      need the rest”. <i>Later</i> means <i>at the gate</i>.</p>`,
    mount() {
      document.getElementById("pipesel").onchange = e => { currentPipeline = +e.target.value; render(); };
      document.querySelectorAll("td.cell").forEach(td => td.onclick = async () => {
        const next = (Number(td.dataset.level) + 1) % 3;
        try {
          await api("/crm/requirement", { method: "POST", body: {
            pipeline_stage_id: Number(td.dataset.stage), field_key: td.dataset.field, level: next } });
          await render();
        } catch (e) { errToast(e); }
      });
      document.querySelector('[data-a="copyall"]').onclick = () => confirmAction({
        title: "Copy this matrix to every other pipeline",
        body: "Stages are matched by band and by the qualification gate, never by stage number — a five-stage and an "
          + "eight-stage pipeline both receive the gate requirements at their own gate. Existing requirements on the "
          + "matched stages are replaced.",
        submit: "Copy to all",
        onConfirm: async () => {
          const r = await api(`/crm/pipelines/${currentPipeline}/copy-matrix`, { method: "POST" });
          await after(`Matrix copied — ${r.touched} stages matched.`);
        }
      });
    }
  };
}

/* ---------------- field catalogue ---------------- */
async function tFields() {
  const fields = crm().fields || [];
  return {
    html: `
    <div class="infobox">A field switched off leaves the lead form, the register and every requirement check; its
      recorded values are retained. Three fields are locked because the engine depends on them: Company Name is the
      entry minimum, and Offering and Industry derive the pipeline (BR-37).</div>
    <div class="lvhead" style="padding:0 0 .5rem;border:none">
      <span class="count">${fields.filter(f => f.active).length} of ${fields.length} active</span>
      <span class="spacer"></span><button class="btn brand" data-a="new-field">${ICON.plus} Add field</button></div>
    ${dataTable({
      columns: [
        { label: "Field", cell: f => `<b>${esc(f.label)}</b><br><span class="mono" style="font-size:.625rem;color:var(--ink-4)">${esc(f.key)}</span>` },
        { label: "Type", cell: f => `<span class="badge">${esc(f.type)}</span>${f.list_source ? ` <span class="badge b">${esc(f.list_source)}</span>` : ""}` },
        { label: "Origin", cell: f => f.custom ? `<span class="badge v">custom</span>` : `<span class="badge">core</span>` },
        { label: "Locked", cell: f => f.locked ? `<span class="badge b">locked</span>` : "—" },
        { label: "Help", cell: f => `<span class="trunc">${esc(f.help || "")}</span>` },
        { label: "Status", cell: f => f.active ? `<span class="badge dot g">On</span>` : `<span class="badge dot n">Off</span>` },
        { label: "", align: "r", cell: f => `<div class="btngroup">
            <button class="btn sm" data-editf="${f.id}">Edit</button>
            <button class="btn sm ${f.active ? "danger" : ""}" data-togglef="${f.id}" ${f.locked && f.active ? "disabled title='Locked — the engine depends on it'" : ""}>${f.active ? "Switch off" : "Switch on"}</button>
            ${f.custom ? `<button class="btn sm danger" data-delf="${f.id}">Remove</button>` : ""}</div>` }
      ], rows: fields, empty: "No fields."
    })}`,
    mount() {
      document.querySelector('[data-a="new-field"]').onclick = () => fieldForm(null);
      document.querySelectorAll("[data-editf]").forEach(b => b.onclick = () => fieldForm(fields.find(f => f.id === +b.dataset.editf)));
      document.querySelectorAll("[data-togglef]").forEach(b => b.onclick = async () => {
        const f = fields.find(x => x.id === +b.dataset.togglef);
        try { await api("/crm/fields", { method: "POST", body: { id: f.id, active: !f.active } });
          await after(`“${f.label}” switched ${f.active ? "off" : "on"}.`); }
        catch (e) { errToast(e); }
      });
      document.querySelectorAll("[data-delf]").forEach(b => b.onclick = () => {
        const f = fields.find(x => x.id === +b.dataset.delf);
        confirmAction({
          title: `Remove “${f.label}”`, danger: true, submit: "Remove",
          body: "Its requirements go with it. Values already recorded against it are retained.",
          onConfirm: async () => { await api(`/crm/fields/${f.id}`, { method: "DELETE" }); await after("Field removed."); }
        });
      });
    }
  };
}

function fieldForm(f) {
  openForm({
    title: f ? `Edit “${f.label}”` : "Add a field", size: "",
    intro: f ? undefined : "It appears on the lead form and in every requirement matrix, required nowhere until you mark it so.",
    fields: f ? [
      { name: "label", label: "Label", required: true, cols: "full", value: f.label },
      { name: "help", label: "Help text", cols: "full", value: f.help || "" },
      { name: "active", label: "Active — appears on the form and in requirement checks", type: "checkbox",
        checked: !!f.active, cols: "full" }
    ] : [
      { name: "label", label: "Label", required: true, cols: "full" },
      { name: "key", label: "Key", required: true, help: "Lower case, no spaces. Used in the requirement matrix." },
      { name: "type", label: "Type", type: "select", required: true,
        options: ["text", "number", "date", "phone", "email", "list"].map(t => ({ value: t, label: t })) },
      { name: "list_source", label: "List source (type = list only)", type: "select",
        options: [{ value: "", label: "—" }, ...["industry", "customer_segment", "offering", "channel", "person"]
          .map(v => ({ value: v, label: v }))] },
      { name: "help", label: "Help text", cols: "full" }
    ],
    submit: f ? "Save" : "Add field",
    onSubmit: async d => {
      await api("/crm/fields", { method: "POST", body: f ? { ...d, id: f.id } : d });
      await after(f ? "Field updated." : "Field added — required nowhere until you mark it so.");
    }
  });
}

/* ---------------- reference data ---------------- */
async function tReference() {
  const lists = await api("/crm/reference");
  return {
    html: `
    <div class="infobox">A value in use is deactivated, never deleted — the refusal states how many records depend on
      it (BR-35). A deactivated value stops appearing on new records and stays visible on existing ones (BR-36).</div>
    <div class="grid g2">${Object.entries(lists).map(([key, l]) => `
      <div class="card" style="margin:0">
        <header><h2>${esc(l.label)}</h2><span class="sub">${l.rows.length}</span>
          <div class="right"><button class="btn sm" data-newref="${key}">${ICON.plus} Add</button></div></header>
        <div class="body flush">${l.rows.map(r => `
          <div class="rrow">
            <div class="b"><b>${esc(r.name)}</b>${r.active ? "" : ` <span class="badge n">inactive</span>`}
              <div class="m">${r.mode ? `<span class="badge ${r.mode === "Online" ? "t" : ""}">${esc(r.mode)}</span> ` : ""}${
                r.colour ? `<span class="badge"><i style="display:inline-block;width:.5rem;height:.5rem;border-radius:2px;background:${esc(r.colour)}"></i> ${esc(r.colour)}</span> ` : ""}${
                r.code ? `<span class="mono" style="font-size:.625rem">${esc(r.code)}</span> ` : ""}${
                r.uses ? `used by ${r.uses} record${r.uses === 1 ? "" : "s"}` : "not yet used"}</div></div>
            <div class="r"><div class="btngroup">
              <button class="btn sm" data-editref="${key}:${r.id}">Edit</button>
              <button class="btn sm danger" data-delref="${key}:${r.id}">Delete</button></div></div>
          </div>`).join("")}</div>
      </div>`).join("")}</div>`,
    mount() {
      document.querySelectorAll("[data-newref]").forEach(b => b.onclick = () => refForm(b.dataset.newref, null, lists));
      document.querySelectorAll("[data-editref]").forEach(b => b.onclick = () => {
        const [k, id] = b.dataset.editref.split(":");
        refForm(k, lists[k].rows.find(r => r.id === +id), lists);
      });
      document.querySelectorAll("[data-delref]").forEach(b => b.onclick = async () => {
        const [k, id] = b.dataset.delref.split(":");
        const row = lists[k].rows.find(r => r.id === +id);
        confirmAction({
          title: `Delete “${row.name}”`, danger: true, submit: "Delete",
          body: row.uses ? `This value is used by ${row.uses} record(s). The server will refuse — deactivate it instead.`
            : "It is not used by any record.",
          onConfirm: async () => { await api(`/crm/reference/${k}/${id}`, { method: "DELETE" }); await after("Value deleted."); }
        });
      });
    }
  };
}

function refForm(kind, row, lists) {
  const extra = [];
  if (kind === "channel") {
    extra.push({ name: "mode", label: "Lead Source", type: "select", value: row?.mode || "Offline",
      options: [{ value: "Offline", label: "Offline" }, { value: "Online", label: "Online" }],
      help: "Derives Lead Source on every lead using this channel (BR-25)." });
    extra.push({ name: "person_id", label: "Person (personal-branding channels)", type: "select",
      value: String(row?.person_id || ""),
      options: [{ value: "", label: "— none —" }, ...(crm().people || []).map(p => ({ value: p.id, label: p.name }))] });
  }
  if (kind === "content_channel") extra.push({ name: "colour", label: "Colour", value: row?.colour || "#5C5C5C" });
  if (kind === "offering") {
    extra.push({ name: "code", label: "Code", value: row?.code || "" });
    extra.push({ name: "revenue_category", label: "Revenue category", value: row?.revenue_category || "",
      help: "Deliberately empty — the source never reconciles the twelve products to the revenue model's seven (OI-01)." });
  }
  openForm({
    title: row ? `Edit “${row.name}”` : `Add ${lists[kind].label.toLowerCase()}`, size: "",
    fields: [
      { name: "name", label: "Name", required: true, cols: "full", value: row?.name },
      ...extra,
      ...(row ? [{ name: "active", label: "Active — selectable on new records", type: "checkbox",
        checked: !!row.active, cols: "full" }] : [])
    ],
    submit: row ? "Save" : "Add",
    onSubmit: async d => {
      await api(`/crm/reference/${kind}`, { method: "POST", body: row ? { ...d, id: row.id } : d });
      await after("Reference data updated.");
    }
  });
}

/* ---------------- movement rules ---------------- */
async function tMovement() {
  const m = crm().movement || {};
  return {
    html: `
    <div class="infobox">Three settings applying to every pipeline. They are the only movement rules — everything else
      about what a lead needs in order to move is the requirement matrix.</div>
    <form id="mform"><div class="formgrid">
      <div class="field full"><label class="checkline"><input type="checkbox" name="allowSkip" ${m.allowSkip ? "checked" : ""}>
        <span><b>Allow stage skipping</b><br><span class="help">Off by default. When on, the cumulative requirements of
        every skipped stage still apply (BR-21).</span></span></label></div>
      <div class="field full"><label class="checkline"><input type="checkbox" name="allowBack" ${m.allowBack ? "checked" : ""}>
        <span><b>Allow backward movement</b><br><span class="help">On by default.</span></span></label></div>
      <div class="field full"><label class="checkline"><input type="checkbox" name="backReason" ${m.backReason ? "checked" : ""}>
        <span><b>Require a reason on backward movement</b><br><span class="help">On by default. Minimum
        ${m.reasonMin} characters (BR-22).</span></span></label></div>
    </div>
    <div style="display:flex;justify-content:flex-end"><button class="btn brand" type="submit">Save movement rules</button></div>
    </form>`,
    mount() {
      document.getElementById("mform").onsubmit = async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api("/crm/movement", { method: "POST", body: {
            allowSkip: fd.has("allowSkip"), allowBack: fd.has("allowBack"), backReason: fd.has("backReason") } });
          await after("Movement rules saved.");
        } catch (err) { errToast(err); }
      };
    }
  };
}

/* ---------------- stage templates (read-only) ---------------- */
async function tTemplates() {
  const ts = crm().templates || [];
  return {
    html: `
    <div class="infobox">The eleven processes read out of the source workbook's <b>Process Summary</b> column, with the
      row each came from. Templates are read-only: a pipeline copies one at creation and owns its stages from then on
      (§3.2). ◆ marks the qualification gate, taken from the workbook's Lead Qualification column.</div>
    <div class="grid g2">${ts.map(t => `<div class="card" style="margin:0">
      <header><div class="ci" style="background:var(--brand)">${ICON.gate}</div>
        <h2>${esc(t.code)} · ${esc(t.name)}</h2></header>
      <div class="body">
        <div class="path" style="flex-wrap:wrap">${t.stages.map(s => `
          <div class="step ${s.is_gate ? "cur" : ""}" title="${esc(s.band)}">
            <span class="n">${s.is_gate ? "◆" : String(s.seq).padStart(2, "0")}</span> ${esc(s.name)}</div>`).join("")}</div>
        <p class="note" style="margin-top:.5rem;color:var(--ink-4)">${esc(t.source_ref || "")} ·
          ${t.stages.length} stages · gate at “${esc((t.stages.find(s => s.is_gate) || {}).name || "—")}”</p>
      </div></div>`).join("")}</div>`
  };
}
