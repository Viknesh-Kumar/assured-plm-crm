// CRM & Content Calendar engine — AGC-BRD-CRM-001 §6. Every rule is enforced here (§3.9).
// The browser may display a refusal; it never decides one.
import { db, all, one, run, col, getSetting, setSetting, audit, notify } from "./db.mjs";
import { HttpError } from "./api.mjs";
import { copyTemplateStages, seedDefaultRequirements, GATE_REQUIREMENTS, CRM_PERMISSIONS } from "./crm-seed.mjs";
import { today, toCSV } from "./lib.mjs";
import { usersWithPermission } from "./api.mjs";

const BANDS = ["Lead", "Qualified", "CSE", "Closed"];
const bandIx = b => BANDS.indexOf(b);

/* Refusals carry a machine-readable rule code and a sentence written for a salesperson (NFR-06). */
const refuse = (rule, msg, extra) => { const e = new HttpError(400, msg, rule); Object.assign(e, extra || {}); throw e; };
const deny = (msg, rule) => { throw new HttpError(403, msg, rule); };
const gone = msg => { throw new HttpError(404, msg); };

const can = (u, p) => u.permissions.includes(p);
const need = (u, p) => { if (!can(u, p)) deny(`Your roles (${u.roleNames.join(", ") || "none"}) do not carry "${p}".`, "FR-43"); };
export const hasCRM = u => CRM_PERMISSIONS.some(([p]) => u.permissions.includes(p));

const setting = (k, d) => { const v = getSetting(k); return v === null ? d : v; };
const flag = (k, d) => String(setting(k, d)) === "1";
const reasonMin = () => Number(setting("crm_reason_min", 10));
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/* ------------------------------------------------------------------ */
/* reference data                                                      */
/* ------------------------------------------------------------------ */
export const LISTS = {
  industry: "industry", customer_segment: "customer_segment", offering: "offering",
  channel: "channel", content_type: "content_type", content_channel: "content_channel"
};

export function crmBootstrap(user) {
  return {
    industries: all("SELECT * FROM industry ORDER BY sort, name"),
    segments: all("SELECT * FROM customer_segment ORDER BY sort, name"),
    channels: all(`SELECT c.*, u.name AS person_name FROM channel c LEFT JOIN users u ON u.id=c.person_id
                   ORDER BY c.sort, c.name`),
    offerings: all("SELECT * FROM offering ORDER BY sort, name"),
    contentTypes: all("SELECT * FROM content_type ORDER BY sort, name"),
    contentChannels: all("SELECT * FROM content_channel ORDER BY sort, name"),
    fields: all("SELECT * FROM lead_field ORDER BY sort, id"),
    templates: all("SELECT * FROM stage_template ORDER BY id").map(t => ({
      ...t, stages: all("SELECT * FROM stage_template_stage WHERE template_id=? ORDER BY seq", t.id)
    })),
    pipelines: listPipelines(),
    people: all(`SELECT u.id, u.name, u.title FROM users u WHERE u.active=1 ORDER BY u.name`),
    bands: BANDS,
    movement: { allowSkip: flag("crm_allow_skip", "0"), allowBack: flag("crm_allow_back", "1"),
      backReason: flag("crm_back_reason", "1"), reasonMin: reasonMin() },
    canSetup: can(user, "crm.setup.manage"),
    canLead: can(user, "crm.lead.manage"),
    canContent: can(user, "crm.content.manage")
  };
}

export const listPipelines = () => all(`SELECT p.*, o.name AS offering_name, o.code AS offering_code,
    t.name AS template_name, t.code AS template_code, t.source_ref, u.name AS owner_name,
    (SELECT COUNT(*) FROM pipeline_stage s WHERE s.pipeline_id=p.id) AS stage_count,
    (SELECT name FROM pipeline_stage s WHERE s.pipeline_id=p.id AND s.is_gate=1 LIMIT 1) AS gate_name,
    (SELECT COUNT(*) FROM lead l WHERE l.pipeline_id=p.id) AS lead_count
  FROM pipeline p
  LEFT JOIN offering o ON o.id=p.offering_id LEFT JOIN stage_template t ON t.id=p.template_id
  LEFT JOIN users u ON u.id=p.owner_id ORDER BY o.sort, p.id`)
  .map(p => ({
    ...p,
    industries: all(`SELECT i.id, i.name FROM pipeline_industry pi JOIN industry i ON i.id=pi.industry_id
                     WHERE pi.pipeline_id=? ORDER BY i.sort`, p.id),
    stages: all(`SELECT s.*, (SELECT COUNT(*) FROM lead l WHERE l.stage_id=s.id) AS lead_count
                 FROM pipeline_stage s WHERE s.pipeline_id=? ORDER BY s.seq`, p.id)
  }));

export const pipelineStages = id => all("SELECT * FROM pipeline_stage WHERE pipeline_id=? ORDER BY seq", id);

/** BR-04 — the resolver. (Offering, Industry) → at most one active pipeline (BR-05). */
export function resolvePipeline(offeringId, industryId) {
  if (!offeringId || !industryId) return null;
  return one(`SELECT p.* FROM pipeline p JOIN pipeline_industry pi ON pi.pipeline_id=p.id
              WHERE p.offering_id=? AND pi.industry_id=? AND p.active=1 ORDER BY p.id LIMIT 1`,
    offeringId, industryId);
}

/* ------------------------------------------------------------------ */
/* the gate engine — §6 "Mandatory fields"                             */
/* ------------------------------------------------------------------ */
const activeFields = () => all("SELECT * FROM lead_field WHERE active=1 ORDER BY sort, id");
const fieldByKey = k => one("SELECT * FROM lead_field WHERE key=?", k);

/** BR-15 — the union of requirements at stages 1…seq, strongest level wins. */
export function requirementsUpTo(pipelineId, seq) {
  const out = {};
  for (const r of all(`SELECT r.field_key, r.level, s.seq FROM stage_requirement r
                       JOIN pipeline_stage s ON s.id=r.pipeline_stage_id
                       WHERE s.pipeline_id=? AND s.seq<=? ORDER BY s.seq`, pipelineId, seq)) {
    const f = fieldByKey(r.field_key);
    if (!f || !f.active) continue;                                   // BR-18
    if (!out[r.field_key] || out[r.field_key].level > r.level) out[r.field_key] = { level: r.level, seq: r.seq };
  }
  return out;
}

/** The lead's effective Lead Source: the override if set, otherwise derived from the channel (BR-25/26). */
export function effectiveSource(lead) {
  if (lead.source_override) return lead.source;
  if (!lead.channel_id) return null;
  return col("SELECT mode FROM channel WHERE id=?", lead.channel_id);
}

const CORE_KEYS = new Set(["company", "customer", "designation", "location", "contact", "email",
  "activity", "industry", "segment", "offering", "channel", "source", "content", "owner"]);

export function valueOf(lead, key) {
  switch (key) {
    case "industry": return lead.industry_id;
    case "segment": return lead.segment_id;
    case "offering": return lead.offering_id;
    case "channel": return lead.channel_id;
    case "owner": return lead.owner_id;
    case "content": return lead.primary_content_id;
    case "source": return effectiveSource(lead);
    default:
      if (CORE_KEYS.has(key)) return lead[key];
      return col("SELECT value FROM lead_field_value WHERE lead_id=? AND field_key=?", lead.id, key);
  }
}
const hasValue = (lead, key) => {
  const v = valueOf(lead, key);
  return !(v === null || v === undefined || String(v).trim() === "");
};

/**
 * BR-16 — every unmet requirement, not the first.
 * BR-17 — a level-2 requirement is live only when the effective Lead Source is Online.
 * BR-19 — the derived Lead Source is omitted while Channel, which derives it, is itself unmet.
 */
export function missingFor(lead, pipelineId, seq) {
  const reqs = requirementsUpTo(pipelineId, seq);
  const src = effectiveSource(lead);
  const channelUnmet = !!reqs.channel && !hasValue(lead, "channel");
  const out = [];
  for (const [key, r] of Object.entries(reqs)) {
    if (r.level === 2 && src !== "Online") continue;                 // BR-17
    if (hasValue(lead, key)) continue;
    if (key === "source" && channelUnmet && !lead.source_override) continue;  // BR-19
    const f = fieldByKey(key);
    out.push({ key, label: f ? f.label : key, level: r.level, at_seq: r.seq, conditional: r.level === 2 });
  }
  return out.sort((a, b) => a.at_seq - b.at_seq || a.label.localeCompare(b.label));
}

/* ------------------------------------------------------------------ */
/* leads                                                               */
/* ------------------------------------------------------------------ */
const LEAD_SQL = `
SELECT l.*, o.name AS offering_name, i.name AS industry_name, cs.name AS segment_name,
  ch.name AS channel_name, ch.mode AS channel_mode, u.name AS owner_name, cb.name AS created_by_name,
  p.name AS pipeline_name, p.template_id, t.name AS template_name, t.source_ref,
  s.seq AS stage_seq, s.name AS stage_name, s.band AS stage_band, s.is_gate AS stage_is_gate,
  c.title AS primary_content_title,
  (SELECT COUNT(*) FROM pipeline_stage x WHERE x.pipeline_id=l.pipeline_id) AS stage_total,
  (SELECT name FROM pipeline_stage x WHERE x.pipeline_id=l.pipeline_id AND x.is_gate=1 LIMIT 1) AS gate_name,
  (SELECT COUNT(*) FROM lead_content_touch tt WHERE tt.lead_id=l.id) AS touch_count
FROM lead l
LEFT JOIN offering o ON o.id=l.offering_id
LEFT JOIN industry i ON i.id=l.industry_id
LEFT JOIN customer_segment cs ON cs.id=l.segment_id
LEFT JOIN channel ch ON ch.id=l.channel_id
LEFT JOIN users u ON u.id=l.owner_id
LEFT JOIN users cb ON cb.id=l.created_by
LEFT JOIN pipeline p ON p.id=l.pipeline_id
LEFT JOIN stage_template t ON t.id=p.template_id
LEFT JOIN pipeline_stage s ON s.id=l.stage_id
LEFT JOIN content c ON c.id=l.primary_content_id`;

function decorateLead(l) {
  if (!l) return l;
  l.effective_source = effectiveSource(l);
  l.status = l.lost ? "Lost" : (l.stage_band === "Closed" ? "Won" : "Open");
  l.days_at_stage = l.stage_entered_at
    ? Math.max(0, Math.round((Date.parse(today()) - Date.parse(l.stage_entered_at.slice(0, 10))) / 864e5)) : null;
  if (!l.pipeline_id) { l.next_move = "blocked"; l.missing = []; }
  else if (l.lost) { l.next_move = "closed"; l.missing = []; }
  else if (l.stage_seq >= l.stage_total) { l.next_move = l.stage_band === "Closed" ? "closed" : "terminal"; l.missing = []; }
  else {
    l.missing = missingFor(l, l.pipeline_id, l.stage_seq + 1);
    l.next_move = l.missing.length ? `${l.missing.length} missing` : "ready";
  }
  l.custom = Object.fromEntries(all("SELECT field_key,value FROM lead_field_value WHERE lead_id=?", l.id)
    .map(r => [r.field_key, r.value]));
  return l;
}
export const getLead = id => decorateLead(one(`${LEAD_SQL} WHERE l.id=?`, id));
export const listLeads = () => all(`${LEAD_SQL} ORDER BY l.id DESC`).map(decorateLead);
const mustLead = id => getLead(id) || gone("Lead not found.");

/** BR-01, BR-02, BR-03 */
export function createLead(user, b) {
  need(user, "crm.lead.manage");
  const company = String(b.company ?? "").trim();
  if (!company) refuse("BR-02", "A lead needs a company name. It is the only thing required to log one.");
  run(`INSERT INTO lead(company,created_at,created_by,updated_at) VALUES(?,datetime('now'),?,datetime('now'))`,
    company, user.id);
  const id = col("SELECT MAX(id) FROM lead");
  audit("lead", id, "create", `Lead "${company}" logged`, user.id);
  const rest = { ...b }; delete rest.company;
  if (Object.keys(rest).length) updateLead(user, id, rest);
  return getLead(id);
}

const SETTABLE = {
  company: "company", customer: "customer", designation: "designation", location: "location",
  contact: "contact", email: "email", activity: "activity",
  offering: "offering_id", industry: "industry_id", segment: "segment_id",
  channel: "channel_id", owner: "owner_id"
};

/** BR-04, BR-07, BR-25, BR-27 — writes, then re-derives pipeline and Lead Source. */
export function updateLead(user, id, b) {
  need(user, "crm.lead.manage");
  const before = mustLead(id);
  if (before.lost && b.__moving) refuse("BR-29", "A lost lead cannot be moved. Reopen it first.");

  if ("company" in b && !String(b.company ?? "").trim())
    refuse("BR-02", "A lead needs a company name. It is the only thing required to log one.");

  const changed = [];
  for (const [key, colName] of Object.entries(SETTABLE)) {
    if (!(key in b)) continue;
    const f = fieldByKey(key);
    if (f && !f.active) continue;                                     // switched-off fields do not write
    let v = b[key] === "" || b[key] === null ? null : b[key];
    if (colName.endsWith("_id") && v !== null) {
      v = Number(v);
      if (!Number.isFinite(v)) v = null;
      const list = { offering: "offering", industry: "industry", segment: "customer_segment", channel: "channel" }[key];
      if (v !== null && list) {
        const row = one(`SELECT * FROM ${list} WHERE id=?`, v);
        if (!row) refuse("BR-36", `That ${f?.label || key} does not exist.`);
        // BR-36 — an inactive value cannot be newly selected, but stays on records that already carry it.
        if (!row.active && before[colName] !== v)
          refuse("BR-36", `"${row.name}" is deactivated and can no longer be selected. Existing records keep it.`);
      }
    } else if (v !== null) v = String(v).trim() || null;
    if (String(before[colName] ?? "") === String(v ?? "")) continue;
    run(`UPDATE lead SET ${colName}=? WHERE id=?`, v, id);
    changed.push(key);
    audit("lead", id, "update", `${before.company}: ${f?.label || key} changed`, user.id, key, before[colName], v);
  }

  // custom fields (§5.3)
  for (const f of all("SELECT * FROM lead_field WHERE custom=1 AND active=1")) {
    if (!(f.key in b)) continue;
    const v = b[f.key] === "" || b[f.key] === null ? null : String(b[f.key]);
    run(`INSERT INTO lead_field_value(lead_id,field_key,value) VALUES(?,?,?)
         ON CONFLICT(lead_id,field_key) DO UPDATE SET value=excluded.value`, id, f.key, v);
    changed.push(f.key);
  }

  if (changed.includes("channel")) rederiveSource(user, id);          // BR-27
  if (changed.includes("offering") || changed.includes("industry")) rederivePipeline(user, id);  // BR-07
  run("UPDATE lead SET updated_at=datetime('now') WHERE id=?", id);
  return { lead: getLead(id), changed };
}

function rederiveSource(user, id) {
  const l = one("SELECT * FROM lead WHERE id=?", id);
  if (l.source_override) return;                                      // BR-26 — the override sticks
  const mode = l.channel_id ? col("SELECT mode FROM channel WHERE id=?", l.channel_id) : null;
  run("UPDATE lead SET source=? WHERE id=?", mode, id);
}

/** BR-07 — re-derivation places the lead at the same band on the new pipeline. */
function rederivePipeline(user, id) {
  const l = one("SELECT * FROM lead WHERE id=?", id);
  const target = resolvePipeline(l.offering_id, l.industry_id);
  const oldStage = l.stage_id ? one("SELECT * FROM pipeline_stage WHERE id=?", l.stage_id) : null;

  if (!target) {                                                      // BR-06
    if (l.pipeline_id) {
      run("UPDATE lead SET pipeline_id=NULL, stage_id=NULL, stage_entered_at=NULL WHERE id=?", id);
      writeHistory(id, oldStage?.seq ?? null, null, oldStage?.name ?? null, user.id, "Pipeline re-derived");
    }
    return;
  }
  if (target.id === l.pipeline_id) return;

  const stages = pipelineStages(target.id);
  let landing = stages[0];
  if (oldStage) {
    const same = stages.find(s => s.band === oldStage.band);
    if (same) landing = same;
    else {
      const below = stages.filter(s => bandIx(s.band) < bandIx(oldStage.band));
      landing = below.length ? below[below.length - 1] : stages[0];
    }
  }
  run("UPDATE lead SET pipeline_id=?, stage_id=?, stage_entered_at=? WHERE id=?",
    target.id, landing.id, today(), id);
  writeHistory(id, oldStage?.seq ?? null, landing.seq, landing.name, user.id, "Pipeline re-derived");
  audit("lead", id, "pipeline", `${l.company} re-derived onto ${target.name} at "${landing.name}"`, user.id);
}

/** BR-26 */
export function overrideSource(user, id, b) {
  need(user, "crm.lead.manage");
  const l = mustLead(id);
  if (b.clear) {
    run("UPDATE lead SET source_override=0, source_override_reason=NULL WHERE id=?", id);
    rederiveSource(user, id);
    audit("lead", id, "source", `${l.company}: Lead Source override cleared`, user.id);
    return getLead(id);
  }
  if (!["Online", "Offline"].includes(b.source)) refuse("BR-25", "Lead Source is Online or Offline.");
  if (!b.reason || String(b.reason).trim().length < reasonMin())
    refuse("BR-26", `Overriding the derived Lead Source needs a reason of at least ${reasonMin()} characters.`);
  run("UPDATE lead SET source=?, source_override=1, source_override_reason=? WHERE id=?",
    b.source, String(b.reason).trim(), id);
  audit("lead", id, "source", `${l.company}: Lead Source overridden to ${b.source}`, user.id,
    "source", l.effective_source, b.source);
  return getLead(id);
}

/* BR-23, BR-24 — append only. There is no update or delete path for this table anywhere. */
function writeHistory(leadId, fromSeq, toSeq, snapshot, actorId, reason) {
  run(`INSERT INTO lead_stage_history(lead_id,from_seq,to_seq,stage_name_snapshot,actor_id,at,reason)
       VALUES(?,?,?,?,?,datetime('now'),?)`, leadId, fromSeq, toSeq, snapshot, actorId, reason || null);
}

/** The move engine — BR-16, BR-21, BR-22, BR-23, BR-29. */
export function attemptMove(user, id, b) {
  need(user, "crm.lead.manage");
  const l = mustLead(id);
  const toSeq = Number(b.to_seq);
  if (!l.pipeline_id) refuse("BR-06", "This lead has no pipeline. Set both Offering and Industry and the stages appear.");
  if (l.lost) refuse("BR-29", "A lost lead cannot be moved. Reopen it first.");
  const stages = pipelineStages(l.pipeline_id);
  const target = stages.find(s => s.seq === toSeq);
  if (!target) refuse("BR-08", "That stage does not exist on this pipeline.");
  if (toSeq === l.stage_seq) refuse("BR-21", `The lead is already at "${target.name}".`);

  const back = toSeq < l.stage_seq;
  if (back) {
    if (!flag("crm_allow_back", "1")) refuse("BR-22", "Backward movement is switched off in Setup → Movement rules.");
    if (flag("crm_back_reason", "1") && String(b.reason ?? "").trim().length < reasonMin())
      refuse("BR-22", `Moving a lead backwards needs a reason of at least ${reasonMin()} characters.`);
  } else {
    if (toSeq > l.stage_seq + 1 && !flag("crm_allow_skip", "0"))
      refuse("BR-21", `Stages are taken one at a time. Move to "${stages.find(s => s.seq === l.stage_seq + 1).name}" first, `
        + "or switch stage skipping on in Setup → Movement rules.");
    // BR-21 — a skip still carries every skipped stage's requirements, because requirementsUpTo is cumulative.
    const missing = missingFor(l, l.pipeline_id, toSeq);
    if (missing.length)
      refuse("BR-16", `"${target.name}" needs ${missing.length} field${missing.length === 1 ? "" : "s"} that ${l.company} does not yet carry: `
        + missing.map(m => m.label + (m.conditional ? " (required because Lead Source is Online)" : "")).join(", ") + ".",
      { missing });
  }
  run("UPDATE lead SET stage_id=?, stage_entered_at=?, updated_at=datetime('now') WHERE id=?", target.id, today(), id);
  writeHistory(id, l.stage_seq ?? null, target.seq, target.name, user.id, b.reason ? String(b.reason).trim() : null);
  audit("lead", id, "move", `${l.company}: ${l.stage_name || "—"} → ${target.name}`, user.id);
  return getLead(id);
}

/** BR-28, BR-29, BR-30 */
export function markLost(user, id, b) {
  need(user, "crm.lead.manage");
  const l = mustLead(id);
  if (l.lost) refuse("BR-28", "This lead is already marked lost.");
  if (String(b.reason ?? "").trim().length < reasonMin())
    refuse("BR-28", `Marking a lead lost needs a reason of at least ${reasonMin()} characters — it is the only record of why.`);
  run("UPDATE lead SET lost=1, lost_reason=?, lost_at=?, lost_stage_id=?, updated_at=datetime('now') WHERE id=?",
    String(b.reason).trim(), today(), l.stage_id, id);
  writeHistory(id, l.stage_seq ?? null, l.stage_seq ?? null, l.stage_name ?? null, user.id,
    `Marked lost: ${String(b.reason).trim()}`);
  audit("lead", id, "lost", `${l.company} marked lost at "${l.stage_name || "no stage"}"`, user.id);
  return getLead(id);
}

export function reopenLead(user, id, b) {
  need(user, "crm.lead.manage");
  const l = mustLead(id);
  if (!l.lost) refuse("BR-29", "This lead is not lost.");
  if (String(b.reason ?? "").trim().length < reasonMin())
    refuse("BR-29", `Reopening needs a reason of at least ${reasonMin()} characters. The loss stays in history.`);
  run("UPDATE lead SET lost=0, updated_at=datetime('now') WHERE id=?", id);
  writeHistory(id, l.stage_seq ?? null, l.stage_seq ?? null, l.stage_name ?? null, user.id,
    `Reopened: ${String(b.reason).trim()}`);
  audit("lead", id, "reopen", `${l.company} reopened at "${l.stage_name || "no stage"}"`, user.id);
  return getLead(id);
}

export function addNote(user, id, b) {
  need(user, "crm.lead.manage");
  const l = mustLead(id);
  if (!String(b.body ?? "").trim()) refuse("FR-14", "A note needs some text.");
  run("INSERT INTO lead_note(lead_id,body,author_id,at) VALUES(?,?,?,datetime('now'))",
    id, String(b.body).trim(), user.id);
  audit("lead", id, "note", `${l.company}: note added`, user.id);
  return leadDetail(user, id);
}

export function leadDetail(user, id) {
  const lead = mustLead(id);
  const stages = lead.pipeline_id ? pipelineStages(lead.pipeline_id) : [];
  const reqs = lead.pipeline_id ? requirementsUpTo(lead.pipeline_id, lead.stage_seq || 0) : {};
  return {
    lead, stages, requirements: reqs,
    fields: activeFields(),
    history: all(`SELECT h.*, u.name AS actor_name FROM lead_stage_history h
                  LEFT JOIN users u ON u.id=h.actor_id WHERE h.lead_id=? ORDER BY h.id DESC`, id),
    touches: all(`SELECT t.*, c.title, c.date, c.status, ct.name AS type_name, cc.name AS channel_name,
                    cc.colour, p.name AS person_name
                  FROM lead_content_touch t JOIN content c ON c.id=t.content_id
                  LEFT JOIN content_type ct ON ct.id=c.type_id
                  LEFT JOIN content_channel cc ON cc.id=c.channel_id
                  LEFT JOIN users p ON p.id=c.person_id
                  WHERE t.lead_id=? ORDER BY c.date DESC`, id),
    notes: all(`SELECT n.*, u.name AS author_name FROM lead_note n LEFT JOIN users u ON u.id=n.author_id
                WHERE n.lead_id=? ORDER BY n.id DESC`, id),
    audit: all(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
                WHERE a.entity='lead' AND a.entity_id=? ORDER BY a.id DESC LIMIT 100`, id)
  };
}

/* ------------------------------------------------------------------ */
/* content                                                             */
/* ------------------------------------------------------------------ */
const CONTENT_SQL = `
SELECT c.*, ct.name AS type_name, cc.name AS channel_name, cc.colour, p.name AS person_name,
  o.name AS offering_name, i.name AS industry_name,
  (SELECT COUNT(*) FROM lead_content_touch t WHERE t.content_id=c.id) AS lead_count,
  (SELECT COUNT(*) FROM lead_content_touch t WHERE t.content_id=c.id AND t.is_primary=1) AS primary_count
FROM content c
LEFT JOIN content_type ct ON ct.id=c.type_id
LEFT JOIN content_channel cc ON cc.id=c.channel_id
LEFT JOIN users p ON p.id=c.person_id
LEFT JOIN offering o ON o.id=c.offering_id
LEFT JOIN industry i ON i.id=c.industry_id`;

export const getContent = id => one(`${CONTENT_SQL} WHERE c.id=?`, id);
export const listContent = () => all(`${CONTENT_SQL} ORDER BY c.date DESC`);
export const contentForMonth = (y, m) => all(
  `${CONTENT_SQL} WHERE c.date >= ? AND c.date < ? ORDER BY c.date, c.id`,
  `${y}-${String(m).padStart(2, "0")}-01`,
  m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`);

const STATUSES = ["Planned", "Drafted", "Scheduled", "Published"];

/** BR-31, BR-32 */
export function saveContent(user, id, b) {
  need(user, "crm.content.manage");
  const missing = [];
  if (!String(b.date ?? "").trim()) missing.push("Date");
  if (!String(b.title ?? "").trim()) missing.push("Title");
  if (!b.type_id) missing.push("Content type");
  if (!b.channel_id) missing.push("Channel");
  if (!b.person_id) missing.push("Person");
  if (missing.length)
    refuse("BR-31", `A content item needs ${missing.join(", ")}. Without them it cannot be planned or attributed.`);
  const status = STATUSES.includes(b.status) ? b.status : "Planned";
  if (status === "Published" && String(b.date) > today())
    refuse("BR-32", `"${b.title}" is dated ${b.date}, which is in the future. It cannot be marked Published yet.`);

  if (id) {
    const ex = getContent(id) || gone("Content not found.");
    run(`UPDATE content SET date=?,title=?,type_id=?,channel_id=?,person_id=?,offering_id=?,industry_id=?,
           theme=?,status=?,url=? WHERE id=?`,
      b.date, String(b.title).trim(), b.type_id, b.channel_id, b.person_id,
      b.offering_id || null, b.industry_id || null, b.theme || null, status, b.url || null, id);
    audit("content", id, "update", `Content "${b.title}" updated`, user.id, "status", ex.status, status);
  } else {
    run(`INSERT INTO content(date,title,type_id,channel_id,person_id,offering_id,industry_id,theme,status,url,
           created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),?)`,
      b.date, String(b.title).trim(), b.type_id, b.channel_id, b.person_id,
      b.offering_id || null, b.industry_id || null, b.theme || null, status, b.url || null, user.id);
    id = col("SELECT MAX(id) FROM content");
    audit("content", id, "create", `Content "${b.title}" planned for ${b.date}`, user.id);
    if (b.prompt_id) resolvePrompt(user, Number(b.prompt_id), id);
  }
  return getContent(id);
}

/** BR-34 */
export function deleteContent(user, id) {
  need(user, "crm.content.manage");
  const c = getContent(id) || gone("Content not found.");
  const n = col("SELECT COUNT(*) FROM lead_content_touch WHERE content_id=?", id);
  if (n) refuse("BR-34", `"${c.title}" is attributed to ${n} lead${n === 1 ? "" : "s"} and cannot be deleted. `
    + "Detach it from those leads first, or leave it in place as the record of where they came from.");
  run("DELETE FROM content WHERE id=?", id);
  audit("content", id, "delete", `Content "${c.title}" deleted`, user.id);
  return { ok: true };
}

/** BR-33 — one primary, unlimited touches; the primary is always also a touch. */
export function attachContent(user, leadId, b) {
  need(user, "crm.lead.manage");
  const l = mustLead(leadId);
  const c = getContent(Number(b.content_id)) || gone("Content not found.");
  run(`INSERT INTO lead_content_touch(lead_id,content_id,is_primary,added_at,added_by)
       VALUES(?,?,0,datetime('now'),?) ON CONFLICT(lead_id,content_id) DO NOTHING`, leadId, c.id, user.id);
  if (b.primary) {
    run("UPDATE lead_content_touch SET is_primary=0 WHERE lead_id=?", leadId);
    run("UPDATE lead_content_touch SET is_primary=1 WHERE lead_id=? AND content_id=?", leadId, c.id);
    run("UPDATE lead SET primary_content_id=? WHERE id=?", c.id, leadId);
  }
  audit("lead", leadId, "content", `${l.company}: "${c.title}" attached${b.primary ? " as primary" : ""}`, user.id);
  return leadDetail(user, leadId);
}

export function detachContent(user, leadId, contentId) {
  need(user, "crm.lead.manage");
  const l = mustLead(leadId);
  run("DELETE FROM lead_content_touch WHERE lead_id=? AND content_id=?", leadId, contentId);
  if (l.primary_content_id === contentId) run("UPDATE lead SET primary_content_id=NULL WHERE id=?", leadId);
  audit("lead", leadId, "content", `${l.company}: content detached`, user.id);
  return leadDetail(user, leadId);
}

export const contentDetail = (user, id) => ({
  content: getContent(id) || gone("Content not found."),
  leads: all(`SELECT l.id, l.company, l.lost, t.is_primary, s.name AS stage_name, s.band
              FROM lead_content_touch t JOIN lead l ON l.id=t.lead_id
              LEFT JOIN pipeline_stage s ON s.id=l.stage_id
              WHERE t.content_id=? ORDER BY t.is_primary DESC, l.company`, id),
  prompt: one("SELECT * FROM content_prompt WHERE content_id=?", id)
});

/* ------------------------------------------------------------------ */
/* content prompts — the PLM hand-off                                  */
/* ------------------------------------------------------------------ */
export const listPrompts = (status) => all(
  `SELECT cp.*, p.code AS product_code, p.name AS product_name, o.name AS offering_name,
     c.title AS content_title, u.name AS resolved_by_name
   FROM content_prompt cp
   LEFT JOIN products p ON p.id=cp.product_id
   LEFT JOIN offering o ON o.id=cp.offering_id
   LEFT JOIN content c ON c.id=cp.content_id
   LEFT JOIN users u ON u.id=cp.resolved_by
   ${status ? "WHERE cp.status=?" : ""} ORDER BY cp.due_date, cp.id`, ...(status ? [status] : []));

export function resolvePrompt(user, promptId, contentId) {
  const p = one("SELECT * FROM content_prompt WHERE id=?", promptId);
  if (!p || p.status !== "Open") return null;
  run(`UPDATE content_prompt SET status='Planned', content_id=?, resolved_by=?, resolved_at=datetime('now')
       WHERE id=?`, contentId, user.id, promptId);
  audit("content_prompt", promptId, "planned", `Prompt "${p.title}" turned into a content item`, user.id);
  return true;
}

export function dismissPrompt(user, promptId, b) {
  need(user, "crm.content.manage");
  const p = one("SELECT * FROM content_prompt WHERE id=?", promptId) || gone("Prompt not found.");
  if (p.status !== "Open") refuse("FR-18", "That prompt has already been dealt with.");
  if (String(b.reason ?? "").trim().length < reasonMin())
    refuse("FR-18", `Dismissing a launch prompt needs a reason of at least ${reasonMin()} characters.`);
  run(`UPDATE content_prompt SET status='Dismissed', resolve_note=?, resolved_by=?, resolved_at=datetime('now')
       WHERE id=?`, String(b.reason).trim(), user.id, promptId);
  audit("content_prompt", promptId, "dismissed", `Prompt "${p.title}" dismissed`, user.id);
  return listPrompts();
}

/**
 * Raised from the PLM module when a product enters market state Seeding.
 * It is a prompt, not a content item: BR-31 still requires a human to supply type, channel and person.
 */
export function raiseSeedingPrompt(product, actorId) {
  if (one("SELECT id FROM content_prompt WHERE product_id=? AND source='plm-seeding'", product.id)) return null;
  const lead = Number(getSetting("crm_seeding_lead_days", "10"));
  const due = new Date(Date.parse(today()) + lead * 864e5).toISOString().slice(0, 10);
  const title = `Launch content — ${product.name}`;
  const detail = `${product.code} entered market state Seeding on ${today()}. First paid deployments are being made and `
    + `pricing is still being tested, so the launch content should go out now. Problem it solves: ${product.problem}`;
  run(`INSERT INTO content_prompt(source,product_id,title,detail,due_date,status,created_at)
       VALUES('plm-seeding',?,?,?,?, 'Open', datetime('now'))`, product.id, title, detail, due);
  const id = col("SELECT MAX(id) FROM content_prompt");
  const planners = usersWithPermission("crm.content.manage");
  notify(planners, product.id, "content",
    `${product.code} ${product.name} has entered Seeding — plan its launch content by ${due}.`);
  audit("content_prompt", id, "raised", `${product.code} entered Seeding; content prompt raised`, actorId);
  return id;
}

/* ------------------------------------------------------------------ */
/* dashboard and reports                                               */
/* ------------------------------------------------------------------ */
export function crmDashboard(user) {
  const leads = listLeads();
  const open = leads.filter(l => !l.lost);                            // BR-30
  const lost = leads.filter(l => l.lost);
  const bandCounts = BANDS.map(b => ({ band: b, n: open.filter(l => l.stage_band === b).length }));
  const byChannel = {};
  open.forEach(l => {
    const k = l.channel_name || "Not set";
    (byChannel[k] ||= { name: k, mode: l.channel_mode || "—", n: 0 }).n++;
  });
  const blocked = open.filter(l => Array.isArray(l.missing) && l.missing.length);
  const prompts = listPrompts("Open");
  return {
    kpi: {
      open: open.length, total: leads.length, lost: lost.length,
      past_qualification: open.filter(l => l.stage_band && l.stage_band !== "Lead").length,
      attributed: leads.filter(l => l.primary_content_id).length,
      published: col("SELECT COUNT(*) FROM content WHERE status='Published'"),
      blocked: blocked.length,
      unassigned: leads.filter(l => !l.pipeline_id).length,
      content: col("SELECT COUNT(*) FROM content"),
      prompts: prompts.length
    },
    bands: bandCounts, lostCount: lost.length,
    channels: Object.values(byChannel).sort((a, b) => b.n - a.n),
    blocked: blocked.slice(0, 20),
    attributedLeads: leads.filter(l => l.primary_content_id).slice(0, 20),
    prompts,
    recent: all(`SELECT h.*, l.company, u.name AS actor_name FROM lead_stage_history h
                 JOIN lead l ON l.id=h.lead_id LEFT JOIN users u ON u.id=h.actor_id
                 ORDER BY h.id DESC LIMIT 12`)
  };
}

const cols = (rows, fallback) => (rows.length ? Object.keys(rows[0]) : (fallback || []))
  .map(k => ({ key: k, label: k }));

export const CRM_REPORTS = {
  "CRM-01": {
    title: "Funnel by band", note: "Counts and percentages across the four fixed bands. Lost leads are shown separately and excluded from the funnel (BR-30).",
    build: () => {
      const leads = listLeads(), open = leads.filter(l => !l.lost);
      const rows = BANDS.map(b => {
        const n = open.filter(l => l.stage_band === b).length;
        return { Band: b, Leads: n, "% of open": open.length ? Math.round(n / open.length * 100) + "%" : "0%" };
      });
      rows.push({ Band: "No pipeline", Leads: open.filter(l => !l.pipeline_id).length, "% of open": "" });
      rows.push({ Band: "Lost (excluded)", Leads: leads.length - open.length, "% of open": "" });
      return { columns: cols(rows, ["Band", "Leads", "% of open"]), rows };
    }
  },
  "CRM-02": {
    title: "Leads by channel", note: "Volume per channel, split Online and Offline. Lead Source is derived from the channel's mode (BR-25).",
    build: () => {
      const open = listLeads().filter(l => !l.lost);
      const by = {};
      open.forEach(l => {
        const k = l.channel_name || "Not set";
        (by[k] ||= { Channel: k, "Lead Source": l.channel_mode || "—", Leads: 0, Qualified: 0, Won: 0 });
        by[k].Leads++;
        if (l.stage_band && l.stage_band !== "Lead") by[k].Qualified++;
        if (l.status === "Won") by[k].Won++;
      });
      const rows = Object.values(by).sort((a, b) => b.Leads - a.Leads);
      return { columns: cols(rows, ["Channel", "Lead Source", "Leads", "Qualified", "Won"]), rows };
    }
  },
  "CRM-03": {
    title: "Content attribution", note: "Per content item: leads produced and how far they got. Primary attribution and contributing touches are counted separately (Finding 6).",
    build: () => {
      const rows = all(`SELECT c.id, c.date, c.title, ct.name AS type, cc.name AS channel, p.name AS person
                        FROM content c LEFT JOIN content_type ct ON ct.id=c.type_id
                        LEFT JOIN content_channel cc ON cc.id=c.channel_id
                        LEFT JOIN users p ON p.id=c.person_id ORDER BY c.date DESC`)
        .map(c => {
          const touches = all(`SELECT t.is_primary, s.band FROM lead_content_touch t
                               JOIN lead l ON l.id=t.lead_id LEFT JOIN pipeline_stage s ON s.id=l.stage_id
                               WHERE t.content_id=?`, c.id);
          return {
            Date: c.date, Content: c.title, Type: c.type, Channel: c.channel, Person: c.person,
            "Leads (primary)": touches.filter(t => t.is_primary).length,
            "Leads (touched)": touches.length,
            "Past qualification": touches.filter(t => t.band && t.band !== "Lead").length,
            Won: touches.filter(t => t.band === "Closed").length
          };
        }).filter(r => r["Leads (touched)"] > 0 || true);
      return { columns: cols(rows, ["Date", "Content", "Type", "Channel", "Person", "Leads (primary)",
        "Leads (touched)", "Past qualification", "Won"]), rows };
    }
  },
  "CRM-04": {
    title: "Stage ageing", note: "Open leads by days at their current stage, oldest first.",
    build: () => {
      const rows = listLeads().filter(l => !l.lost && l.pipeline_id)
        .sort((a, b) => (b.days_at_stage || 0) - (a.days_at_stage || 0))
        .map(l => ({
          Company: l.company, Pipeline: l.pipeline_name, Stage: l.stage_name, Band: l.stage_band,
          "Days at stage": l.days_at_stage ?? "", Band_age: "",
          Owner: l.owner_name || "", "Next move": l.next_move
        }))
        .map(r => ({ ...r, Band_age: r["Days at stage"] === "" ? "" :
          r["Days at stage"] > 90 ? "90+ days" : r["Days at stage"] > 30 ? "31–90 days" :
            r["Days at stage"] > 7 ? "8–30 days" : "0–7 days" }))
        .map(({ Band_age, ...r }) => ({ ...r, Ageing: Band_age }));
      return { columns: cols(rows, ["Company", "Pipeline", "Stage", "Band", "Days at stage", "Owner", "Next move", "Ageing"]), rows };
    }
  },
  "CRM-05": {
    title: "Band conversion", note: "Observed movement between bands, taken from stage history. Descriptive only — the CRM holds no plan (§3.4).",
    build: () => {
      const reached = Object.fromEntries(BANDS.map(b => [b, new Set()]));
      for (const h of all(`SELECT h.lead_id, h.to_seq, l.pipeline_id FROM lead_stage_history h
                           JOIN lead l ON l.id=h.lead_id WHERE h.to_seq IS NOT NULL`)) {
        const band = col("SELECT band FROM pipeline_stage WHERE pipeline_id=? AND seq=?", h.pipeline_id, h.to_seq);
        if (band) reached[band].add(h.lead_id);
      }
      for (const l of listLeads()) if (l.stage_band) reached[l.stage_band].add(l.id);
      const rows = BANDS.map((b, i) => {
        const n = reached[b].size, prev = i ? reached[BANDS[i - 1]].size : n;
        return { Band: b, "Leads that reached it": n,
          "Conversion from previous": i ? (prev ? Math.round(n / prev * 100) + "%" : "—") : "—" };
      });
      return { columns: cols(rows, ["Band", "Leads that reached it", "Conversion from previous"]), rows };
    }
  },
  "CRM-06": {
    title: "Blocked leads by field", note: "How many open leads cannot advance, grouped by the field blocking them. It says whether a mandatory field is protecting the process or obstructing it.",
    build: () => {
      const by = {};
      for (const l of listLeads().filter(x => !x.lost && x.pipeline_id)) {
        for (const m of l.missing || []) {
          (by[m.key] ||= { Field: m.label, "Leads blocked": 0, "Required at": new Set(), Conditional: m.conditional ? "Yes" : "No" });
          by[m.key]["Leads blocked"]++;
          by[m.key]["Required at"].add(col("SELECT name FROM pipeline_stage WHERE pipeline_id=? AND seq=?", l.pipeline_id, m.at_seq));
        }
      }
      const rows = Object.values(by)
        .map(r => ({ ...r, "Required at": [...r["Required at"]].filter(Boolean).join(", ") }))
        .sort((a, b) => b["Leads blocked"] - a["Leads blocked"]);
      return { columns: cols(rows, ["Field", "Leads blocked", "Required at", "Conditional"]), rows };
    }
  },
  "CRM-07": {
    title: "Content plan", note: "Planned against published by person, channel and type, per month.",
    build: () => {
      const by = {};
      for (const c of all(`SELECT c.date, c.status, p.name AS person, cc.name AS channel, ct.name AS type
                           FROM content c LEFT JOIN users p ON p.id=c.person_id
                           LEFT JOIN content_channel cc ON cc.id=c.channel_id
                           LEFT JOIN content_type ct ON ct.id=c.type_id ORDER BY c.date`)) {
        const k = `${c.date.slice(0, 7)}|${c.person}|${c.channel}|${c.type}`;
        (by[k] ||= { Month: c.date.slice(0, 7), Person: c.person, Channel: c.channel, Type: c.type,
          Planned: 0, Drafted: 0, Scheduled: 0, Published: 0 });
        by[k][c.status] = (by[k][c.status] || 0) + 1;
      }
      const rows = Object.values(by);
      return { columns: cols(rows, ["Month", "Person", "Channel", "Type", "Planned", "Drafted", "Scheduled", "Published"]), rows };
    }
  },
  "CRM-08": {
    title: "Stage history export", note: "The full immutable movement trail (BR-24).",
    build: () => {
      const rows = all(`SELECT h.at AS "When", l.company AS Company, h.from_seq AS "From stage",
          h.to_seq AS "To stage", h.stage_name_snapshot AS "Stage name at the time",
          u.name AS By, COALESCE(h.reason,'') AS Reason
        FROM lead_stage_history h JOIN lead l ON l.id=h.lead_id
        LEFT JOIN users u ON u.id=h.actor_id ORDER BY h.id DESC`);
      return { columns: cols(rows, ["When", "Company", "From stage", "To stage",
        "Stage name at the time", "By", "Reason"]), rows };
    }
  }
};

export function crmReport(key) {
  const r = CRM_REPORTS[key] || gone("Report not found.");
  return { key, title: r.title, note: r.note, ...r.build() };
}
export const crmReportCSV = key => { const r = crmReport(key); return toCSV(r.columns, r.rows); };

/* ------------------------------------------------------------------ */
/* configuration — §5                                                  */
/* ------------------------------------------------------------------ */

/** BR-05 — the (offering, industry) uniqueness spans two tables, so it is checked in code. */
function assertPairsFree(offeringId, industryIds, exceptPipelineId) {
  for (const iid of industryIds) {
    const clash = one(`SELECT p.id, p.name FROM pipeline p JOIN pipeline_industry pi ON pi.pipeline_id=p.id
                       WHERE p.offering_id=? AND pi.industry_id=? AND p.active=1 AND p.id<>?`,
      offeringId, iid, exceptPipelineId || 0);
    if (clash) {
      const off = col("SELECT name FROM offering WHERE id=?", offeringId);
      const ind = col("SELECT name FROM industry WHERE id=?", iid);
      refuse("BR-05", `"${off} × ${ind}" is already served by the active pipeline "${clash.name}". `
        + "Deactivate that pipeline first, or choose a different industry.");
    }
  }
}

export function savePipeline(user, id, b) {
  need(user, "crm.setup.manage");
  const industryIds = (b.industry_ids || []).map(Number).filter(Boolean);
  if (!b.offering_id) refuse("BR-04", "A pipeline needs an offering.");
  if (!industryIds.length) refuse("BR-04", "A pipeline needs at least one industry — the pair is what derives it.");
  const active = b.active === undefined ? 1 : (b.active ? 1 : 0);
  if (active) assertPairsFree(Number(b.offering_id), industryIds, id);

  db.exec("BEGIN");
  try {
    if (id) {
      const ex = one("SELECT * FROM pipeline WHERE id=?", id) || gone("Pipeline not found.");
      run("UPDATE pipeline SET name=?, offering_id=?, owner_id=?, active=? WHERE id=?",
        b.name || ex.name, b.offering_id, b.owner_id || null, active, id);
      run("DELETE FROM pipeline_industry WHERE pipeline_id=?", id);
      audit("pipeline", id, "update", `Pipeline "${b.name || ex.name}" updated`, user.id, "active", ex.active, active);
    } else {
      if (!b.template_id) refuse("BR-08", "Choose a stage template to start the pipeline from.");
      run(`INSERT INTO pipeline(name,offering_id,template_id,owner_id,active,created_at)
           VALUES(?,?,?,?,?,datetime('now'))`,
        b.name || col("SELECT name FROM offering WHERE id=?", b.offering_id),
        b.offering_id, b.template_id, b.owner_id || null, active);
      id = col("SELECT MAX(id) FROM pipeline");
      copyTemplateStages(id, Number(b.template_id));                  // §3.2 — copied, then owned
      seedDefaultRequirements(id);
      audit("pipeline", id, "create", `Pipeline "${b.name}" created from template`, user.id);
    }
    industryIds.forEach(iid =>
      run("INSERT OR IGNORE INTO pipeline_industry(pipeline_id,industry_id) VALUES(?,?)", id, iid));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return listPipelines();
}

/** BR-08 to BR-13 — the stage editor saves a whole stage list at once and validates it as a set. */
export function saveStages(user, pipelineId, b) {
  need(user, "crm.setup.manage");
  const pipe = one("SELECT * FROM pipeline WHERE id=?", pipelineId) || gone("Pipeline not found.");
  const stages = (b.stages || []).map((s, i) => ({
    id: s.id ? Number(s.id) : null, seq: i + 1,
    name: String(s.name || "").trim(), band: s.band, is_gate: s.is_gate ? 1 : 0
  }));
  if (stages.length < 2) refuse("BR-08", "A pipeline needs at least two stages.");
  if (stages.some(s => !s.name)) refuse("BR-08", "Every stage needs a name.");
  if (stages.some(s => !BANDS.includes(s.band)))
    refuse("BR-09", `A stage's band must be one of ${BANDS.join(", ")}.`);
  for (let i = 1; i < stages.length; i++)
    if (bandIx(stages[i].band) < bandIx(stages[i - 1].band))
      refuse("BR-09", `Bands cannot go backwards: "${stages[i].name}" is ${stages[i].band} but follows `
        + `"${stages[i - 1].name}" which is ${stages[i - 1].band}. The order is ${BANDS.join(" → ")}.`);
  if (stages.filter(s => s.is_gate).length !== 1)
    refuse("BR-10", "Exactly one stage carries the qualification gate.");
  if (stages[stages.length - 1].band !== "Closed")
    refuse("BR-11", `The final stage must be in the Closed band. "${stages[stages.length - 1].name}" is ${stages[stages.length - 1].band}.`);

  const existing = pipelineStages(pipelineId);
  const kept = new Set(stages.map(s => s.id).filter(Boolean));
  for (const ex of existing) {
    if (kept.has(ex.id)) continue;
    const n = col("SELECT COUNT(*) FROM lead WHERE stage_id=?", ex.id);
    if (n) refuse("BR-12", `"${ex.name}" holds ${n} lead${n === 1 ? "" : "s"} and cannot be deleted. `
      + "Move them to another stage first.");
  }

  db.exec("BEGIN");
  try {
    // Two passes so the unique-ish (pipeline, seq) ordering never collides mid-update.
    run("UPDATE pipeline_stage SET seq = -seq WHERE pipeline_id=?", pipelineId);
    for (const ex of existing) if (!kept.has(ex.id)) run("DELETE FROM pipeline_stage WHERE id=?", ex.id);
    for (const s of stages) {
      if (s.id) run("UPDATE pipeline_stage SET seq=?, name=?, band=?, is_gate=? WHERE id=? AND pipeline_id=?",
        s.seq, s.name, s.band, s.is_gate, s.id, pipelineId);
      else run("INSERT INTO pipeline_stage(pipeline_id,seq,name,band,is_gate) VALUES(?,?,?,?,?)",
        pipelineId, s.seq, s.name, s.band, s.is_gate);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  audit("pipeline", pipelineId, "stages", `Stage list for "${pipe.name}" saved (${stages.length} stages)`, user.id);
  return { pipeline: listPipelines().find(p => p.id === pipelineId), stages: pipelineStages(pipelineId) };
}

/** BR-14 — the requirement triple. Cell cycles 0 → 1 → 2 → 0. */
export function setRequirement(user, b) {
  need(user, "crm.setup.manage");
  const stage = one("SELECT * FROM pipeline_stage WHERE id=?", b.pipeline_stage_id) || gone("Stage not found.");
  const f = fieldByKey(b.field_key) || gone("Field not found.");
  const level = Number(b.level);
  if (![0, 1, 2].includes(level)) refuse("BR-14", "A requirement is 0 (not required), 1 (required) or 2 (required when Online).");
  if (level === 0) run("DELETE FROM stage_requirement WHERE pipeline_stage_id=? AND field_key=?", stage.id, f.key);
  else run(`INSERT INTO stage_requirement(pipeline_stage_id,field_key,level) VALUES(?,?,?)
            ON CONFLICT(pipeline_stage_id,field_key) DO UPDATE SET level=excluded.level`, stage.id, f.key, level);
  audit("pipeline", stage.pipeline_id, "requirement",
    `"${f.label}" at "${stage.name}" set to ${["not required", "required", "required when Online"][level]}`, user.id);
  return requirementMatrix(user, stage.pipeline_id);
}

export function requirementMatrix(user, pipelineId) {
  const stages = pipelineStages(pipelineId);
  const fields = all("SELECT * FROM lead_field WHERE active=1 ORDER BY sort, id");
  const own = {};
  for (const r of all(`SELECT r.*, s.seq FROM stage_requirement r JOIN pipeline_stage s ON s.id=r.pipeline_stage_id
                       WHERE s.pipeline_id=?`, pipelineId))
    (own[r.field_key] ||= {})[r.pipeline_stage_id] = r.level;
  return { stages, fields, own, pipeline: listPipelines().find(p => p.id === pipelineId) };
}

/** FR-37 — copy by band and gate, never by stage number (§5.2). */
export function copyMatrix(user, sourcePipelineId) {
  need(user, "crm.setup.manage");
  const src = pipelineStages(sourcePipelineId);
  const srcReqs = {};
  for (const s of src)
    srcReqs[s.is_gate ? "gate" : `${s.band}#${src.filter(x => x.band === s.band && x.seq <= s.seq).length}`] =
      all("SELECT field_key, level FROM stage_requirement WHERE pipeline_stage_id=?", s.id);
  let touched = 0;
  db.exec("BEGIN");
  try {
    for (const p of all("SELECT id FROM pipeline WHERE id<>?", sourcePipelineId)) {
      const target = pipelineStages(p.id);
      for (const s of target) {
        const key = s.is_gate ? "gate" : `${s.band}#${target.filter(x => x.band === s.band && x.seq <= s.seq).length}`;
        const reqs = srcReqs[key];
        if (!reqs) continue;
        run("DELETE FROM stage_requirement WHERE pipeline_stage_id=?", s.id);
        reqs.forEach(r => run("INSERT INTO stage_requirement(pipeline_stage_id,field_key,level) VALUES(?,?,?)",
          s.id, r.field_key, r.level));
        touched++;
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  audit("pipeline", sourcePipelineId, "matrix", `Requirement matrix copied to every other pipeline (${touched} stages matched by band and gate)`, user.id);
  return { touched };
}

/** §5.3 — the field catalogue. BR-37 protects the locked fields. */
export function saveField(user, b) {
  need(user, "crm.setup.manage");
  if (b.id) {
    const f = one("SELECT * FROM lead_field WHERE id=?", b.id) || gone("Field not found.");
    if (f.locked && b.active === false) refuse("BR-37", `"${f.label}" is locked — the engine depends on it. `
      + "Company Name is the entry minimum; Offering and Industry derive the pipeline.");
    const active = b.active === undefined ? f.active : (b.active ? 1 : 0);
    run("UPDATE lead_field SET label=?, active=?, help=? WHERE id=?", b.label || f.label, active, b.help ?? f.help, b.id);
    audit("lead_field", b.id, "update", `Field "${f.label}" ${active ? "switched on" : "switched off"}`, user.id,
      "active", f.active, active);
  } else {
    const key = String(b.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!key) refuse("FR-38", "A field needs a key.");
    if (col("SELECT id FROM lead_field WHERE key=?", key)) refuse("FR-38", `A field with the key "${key}" already exists.`);
    if (!["text", "number", "date", "phone", "email", "list"].includes(b.type))
      refuse("FR-38", "A field is text, number, date, phone, email, or a list drawn from a reference table.");
    run(`INSERT INTO lead_field(key,label,type,list_source,active,locked,sort,help,custom)
         VALUES(?,?,?,?,1,0,(SELECT COALESCE(MAX(sort),0)+1 FROM lead_field),?,1)`,
      key, b.label || key, b.type, b.type === "list" ? (b.list_source || null) : null, b.help || null);
    audit("lead_field", col("SELECT MAX(id) FROM lead_field"), "create", `Field "${b.label}" added`, user.id);
  }
  return all("SELECT * FROM lead_field ORDER BY sort, id");
}

export function deleteField(user, id) {
  need(user, "crm.setup.manage");
  const f = one("SELECT * FROM lead_field WHERE id=?", id) || gone("Field not found.");
  if (f.locked) refuse("BR-37", `"${f.label}" is locked — the engine depends on it.`);
  if (!f.custom) refuse("BR-37", `"${f.label}" is a core field. Switch it off instead; its values are retained.`);
  run("DELETE FROM stage_requirement WHERE field_key=?", f.key);      // requirements go
  run("DELETE FROM lead_field WHERE id=?", id);                        // values in lead_field_value stay
  audit("lead_field", id, "delete", `Field "${f.label}" removed; recorded values retained`, user.id);
  return all("SELECT * FROM lead_field ORDER BY sort, id");
}

const REF_TABLES = {
  industry: { table: "industry", label: "Industry", uses: [["lead", "industry_id"], ["pipeline_industry", "industry_id"], ["content", "industry_id"]] },
  customer_segment: { table: "customer_segment", label: "Customer segment", uses: [["lead", "segment_id"]] },
  offering: { table: "offering", label: "Offering", uses: [["lead", "offering_id"], ["pipeline", "offering_id"], ["content", "offering_id"]] },
  channel: { table: "channel", label: "Channel", uses: [["lead", "channel_id"]] },
  content_type: { table: "content_type", label: "Content type", uses: [["content", "type_id"]] },
  content_channel: { table: "content_channel", label: "Content channel", uses: [["content", "channel_id"]] }
};

export const refUsage = (kind, id) => (REF_TABLES[kind]?.uses || [])
  .reduce((n, [t, c]) => n + col(`SELECT COUNT(*) FROM ${t} WHERE ${c}=?`, id), 0);

export function saveReference(user, kind, b) {
  need(user, "crm.setup.manage");
  const def = REF_TABLES[kind] || gone("Unknown reference list.");
  const name = String(b.name || "").trim();
  if (!name) refuse("FR-39", `A ${def.label.toLowerCase()} needs a name.`);
  if (b.id) {
    const ex = one(`SELECT * FROM ${def.table} WHERE id=?`, b.id) || gone("Value not found.");
    const active = b.active === undefined ? ex.active : (b.active ? 1 : 0);
    const extra = kind === "channel" ? ", mode=?, person_id=?" : kind === "content_channel" ? ", colour=?" :
      kind === "offering" ? ", revenue_category=?" : "";
    const args = kind === "channel" ? [b.mode || ex.mode, b.person_id || null]
      : kind === "content_channel" ? [b.colour || ex.colour]
        : kind === "offering" ? [b.revenue_category ?? ex.revenue_category] : [];
    run(`UPDATE ${def.table} SET name=?, active=?${extra} WHERE id=?`, name, active, ...args, b.id);
    audit(kind, b.id, "update", `${def.label} "${name}" updated`, user.id, "active", ex.active, active);
    if (kind === "channel" && b.mode && b.mode !== ex.mode) {
      // BR-27 — a mode change re-derives Lead Source on every lead that has not overridden it.
      run("UPDATE lead SET source=? WHERE channel_id=? AND source_override=0", b.mode, b.id);
    }
  } else {
    const codeCol = kind === "offering" ? ", code" : "";
    const codeVal = kind === "offering" ? [String(b.code || name.slice(0, 3)).toUpperCase()] : [];
    const extraCol = kind === "channel" ? ", mode, person_id" : kind === "content_channel" ? ", colour" : "";
    const extraVal = kind === "channel" ? [b.mode || "Offline", b.person_id || null]
      : kind === "content_channel" ? [b.colour || "#5C5C5C"] : [];
    run(`INSERT INTO ${def.table}(name, active${codeCol}${extraCol}, sort)
         VALUES(?,1${codeVal.length ? ",?" : ""}${extraVal.map(() => ",?").join("")},
                (SELECT COALESCE(MAX(sort),0)+1 FROM ${def.table}))`, name, ...codeVal, ...extraVal);
    audit(kind, col(`SELECT MAX(id) FROM ${def.table}`), "create", `${def.label} "${name}" added`, user.id);
  }
  return all(`SELECT * FROM ${def.table} ORDER BY sort, name`);
}

/** BR-35 — a value in use is deactivated, never deleted; the refusal states the dependent count. */
export function deleteReference(user, kind, id) {
  need(user, "crm.setup.manage");
  const def = REF_TABLES[kind] || gone("Unknown reference list.");
  const ex = one(`SELECT * FROM ${def.table} WHERE id=?`, id) || gone("Value not found.");
  const n = refUsage(kind, id);
  if (n) refuse("BR-35", `"${ex.name}" is used by ${n} record${n === 1 ? "" : "s"} and cannot be deleted. `
    + "Deactivate it instead — it will stop appearing on new records and stay visible on existing ones.");
  run(`DELETE FROM ${def.table} WHERE id=?`, id);
  audit(kind, id, "delete", `${def.label} "${ex.name}" deleted`, user.id);
  return all(`SELECT * FROM ${def.table} ORDER BY sort, name`);
}

export function saveMovementRules(user, b) {
  need(user, "crm.setup.manage");
  for (const [k, v] of Object.entries({
    crm_allow_skip: b.allowSkip ? "1" : "0",
    crm_allow_back: b.allowBack ? "1" : "0",
    crm_back_reason: b.backReason ? "1" : "0"
  })) {
    const old = getSetting(k);
    if (String(old) === v) continue;
    setSetting(k, v);
    audit("setting", null, "update", `Movement rule ${k} changed`, user.id, k, old, v);
  }
  return crmBootstrap(user).movement;
}

export const referenceLists = () => Object.fromEntries(Object.entries(REF_TABLES).map(([k, d]) => [k, {
  label: d.label,
  rows: all(`SELECT * FROM ${d.table} ORDER BY sort, name`).map(r => ({ ...r, uses: refUsage(k, r.id) }))
}]));
