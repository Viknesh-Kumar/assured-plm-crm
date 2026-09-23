// CRM reference data — AGC-BRD-CRM-001 §9, verbatim. Nothing here is invented; §9 is the only
// source of business data for the CRM (§0 rule 4). Idempotent: re-running seeds nothing twice.
import { db, all, one, run, col, setSetting, getSetting } from "./db.mjs";
import { hashPassword, today } from "./lib.mjs";

// Split three ways so an administrator can say "only a few may move a lead between stages" and
// "only select users may add a lead" without inventing a role for each combination.
export const CRM_PERMISSIONS = [
  ["crm.lead.create", "Add a new lead"],
  ["crm.lead.manage", "Edit leads, attach content, mark lost or reopen"],
  ["crm.lead.move", "Move a lead between pipeline stages"],
  ["crm.content.manage", "Plan content: map topics, work stages, publish and record figures"],
  ["crm.setup.manage", "Configure pipelines, stages, requirements and CRM reference data"]
];

/* §9.1 People — the app's users table doubles as the content-author list (Finding 7). */
export const PEOPLE = [
  ["Vikram", "Partner", "vikram@assured.local", "CRM Administrator"],
  ["Darwin", "Business Head", "darwin@assured.local", "CRM Administrator"],
  ["Siddique", "Community Lead", "siddique@assured.local", "CRM Sales User"],
  ["Dhiraj", "Corporate Lead", "dhiraj@assured.local", "CRM Sales User"],
  ["Shireen", "Marketing Lead", "shireen@assured.local", "CRM Sales User"]
];

/* §9.2 Industries — Sheet 1 "Business segment" */
const INDUSTRIES = ["Trading and distribution", "Manufacturing", "Large Corporates", "Project management",
  "UAE Real Estate", "Warehousing", "Labour supply", "All Companies"];

/* §9.3 Customer segments — Channel Assumptions column B */
const SEGMENTS = ["Government Sectors", "Large Consulting Firms", "Project management companies",
  "Community customers", "Vice Presidents of Corporates", "Private Equity Firms",
  "Corporates (500+ employees)", "Mid size organization (50+ employees)",
  "Trading & Distribution / Manufacturing"];

/* §9.4 Channels — mode derives Lead Source (BR-25). Exhibitions seeded Offline per the note (OI-04). */
const CHANNELS = [
  ["Tenders / Online", "Online", null],
  ["Institutional relationships", "Offline", null],
  ["Existing Clients Referrals", "Offline", null],
  ["Research & walk-in", "Offline", null],
  ["Business Community", "Offline", null],
  ["Exhibitions & Expos", "Offline", null],
  ["Networking Events", "Offline", null],
  ["Referrals", "Offline", null],
  ["Personal Branding — Vikram", "Online", "Vikram"],
  ["Personal Branding — Darwin", "Online", "Darwin"],
  ["Personal Branding — Dhiraj", "Online", "Dhiraj"],
  ["Personal Branding — Siddique", "Online", "Siddique"]
];

/* §9.5 Offerings — the twelve Sheet 1 products. revenue_category stays NULL (Finding 4, OI-01). */
const OFFERINGS = [
  ["LP", "Launchpad"], ["IBT", "IBT"], ["XLC", "Xelence"], ["XLR", "Xelerate"],
  ["PXP", "ProjXpulse"], ["CLX", "ColleXion"], ["RTX", "RouteX"], ["ATX", "AttendX"],
  ["STX", "StoXmart"], ["XNP", "XNOP"], ["QMX", "QMX"], ["FNX", "FinXight"]
];

/* §9.5 Pipelines — offering, industries, template, owner. Fifteen (offering, industry) pairs. */
const PIPELINES = [
  ["LP", ["Trading and distribution"], "T6", "Siddique"],
  ["IBT", ["Manufacturing"], "T6", "Siddique"],
  ["XLC", ["Large Corporates"], "T9", "Dhiraj"],
  ["XLR", ["Project management"], "T5", "Vikram"],
  ["PXP", ["Project management"], "T5", "Vikram"],
  ["CLX", ["UAE Real Estate"], "T5", "Dhiraj"],
  ["RTX", ["Warehousing", "Trading and distribution"], "T5", "Darwin"],
  ["ATX", ["Project management", "Labour supply"], "T5", "Darwin"],
  ["STX", ["Manufacturing", "Trading and distribution"], "T6", "Darwin"],
  ["XNP", ["Manufacturing"], "T6", "Darwin"],
  ["QMX", ["Manufacturing"], "T6", "Darwin"],
  ["FNX", ["All Companies"], "T6", "Darwin"]
];

/* §9.6 Stage templates — the eleven Process Summaries. ◆ marks the qualification gate. */
const L = "Lead", Q = "Qualified", C = "CSE", X = "Closed";
export const TEMPLATES = [
  ["T1", "Tenders / Online", "Channel Assumptions row 2", [
    ["Identify Target Entities & Tenders", L], ["Register on Portals", L], ["Identify People", L],
    ["Build Relationship", L], ["Formal Meeting / Email", Q, 1], ["CSE", C], ["Closure", X]]],
  ["T2", "Institutional Relationships — Government", "Channel Assumptions row 3", [
    ["Identify Entities / Tenders", L], ["Introduction Through Partner", L], ["Relationship Building", L],
    ["Meet Decision Maker", L], ["Formal Meeting & Email", Q, 1], ["CSE", C], ["Closure", X]]],
  ["T3", "Institutional Relationships — Consulting Firms", "Channel Assumptions row 4", [
    ["Identify Consulting Companies", L], ["Identify People", L], ["Trust Building", L],
    ["Use-Case Discussion", L], ["Formal Presentation", L], ["Partnership Agreement", Q, 1],
    ["CSE", C], ["Closure", X]]],
  ["T4", "Existing Clients Referrals", "Channel Assumptions row 5", [
    ["Source Through Referrals", L], ["Decision-Maker Introduction", L],
    ["Case Presentation / Success Stories", Q, 1], ["Custom Demo / CSE", C], ["Closure", X]]],
  ["T5", "Research & Walk-in", "Channel Assumptions row 6", [
    ["LinkedIn Outreach & Marketing", L], ["Decision-Maker Introduction", L],
    ["Case Presentation / Success Stories", Q, 1], ["Custom Demo / CSE", C], ["Closure", X]]],
  ["T6", "Business Community — Service Fit", "Channel Assumptions row 7", [
    ["Identify Leads", L], ["Ice Breaker", L], ["Build Relationship", L],
    ["Service Fit Assessment", Q, 1], ["CSE", C], ["Closure", X]]],
  ["T7", "Business Community — Case Led", "Channel Assumptions row 13", [
    ["Identify Leads", L], ["Ice Breaker", L], ["Build Relationship", L],
    ["Case Presentation / Success Stories", Q, 1], ["CSE", C], ["Closure", X]]],
  ["T8", "Exhibitions & Expos", "Channel Assumptions row 9", [
    ["Identify Relevant Event", L], ["Generate Leads", L], ["Decision-Maker Introduction", L],
    ["Office Visit — Trust Building", L], ["Case Presentation / Success Stories", Q, 1],
    ["Custom Demo / CSE", C], ["Follow Up for Closure", C], ["Closure", X]]],
  ["T9", "Networking Events", "Channel Assumptions row 15", [
    ["Connect Through Networking", L], ["Ice-Breaker Meeting", L], ["Build Relationship", L],
    ["Formal Presentation", Q, 1], ["Problem Discussion", Q],
    ["CSE & Cost-Benefit Identification", C], ["Closure", X]]],
  ["T10", "Referrals — Private Equity", "Channel Assumptions row 16", [
    ["Connect Through Referrals", L], ["Ice-Breaker Meeting", L], ["Build Relationship", L],
    ["Formal Presentation", Q, 1], ["Problem Discussion", Q],
    ["CSE & Cost-Benefit Identification", C], ["Closure", X]]],
  ["T11", "Personal Branding — Content Led", "Channel Assumptions rows 17–20", [
    ["Publish Content", L], ["Generate Leads", L], ["Exploratory Call", L],
    ["Share Relevant Case Studies", L], ["Formal Presentation", Q, 1], ["Problem Discussion", Q],
    ["CSE & Cost-Benefit Identification", C], ["Closure", X]]]
];

/* §9.7 Lead field catalogue — 18 fields, 15 active. */
const FIELDS = [
  ["company", "Name of the Company", "text", null, 1, 1, "The entry minimum — the only field mandatory at creation (BR-01)."],
  ["customer", "Customer Name", "text", null, 1, 0, null],
  ["designation", "Designation", "text", null, 1, 0, null],
  ["location", "Location", "text", null, 1, 0, null],
  ["contact", "Contact", "phone", null, 1, 0, null],
  ["email", "Email", "email", null, 1, 0, null],
  ["industry", "Industry", "list", "industry", 1, 1, "With Offering, derives the pipeline (BR-04)."],
  ["segment", "Customer Segment", "list", "customer_segment", 1, 0, null],
  ["offering", "Offering", "list", "offering", 1, 1, "With Industry, derives the pipeline (BR-04)."],
  ["channel", "Channel", "list", "channel", 1, 0, "How the lead was reached. Derives Lead Source (BR-25)."],
  ["source", "Lead Source", "list", "source", 1, 0, "Derived from the channel's mode; overridable with a reason (BR-26)."],
  ["value", "Estimated Annual Order Value (AED)", "number", null, 1, 0,
    "What the account is worth in a year if it closes. Asked for as soon as the lead leaves the first stage."],
  ["activity", "Activity Name", "content", "content", 1, 0,
    "The content item the lead came from — picked from the Content Calendar, which also sets the primary attribution (BR-33). Only asked for when the Lead Source is Online."],
  ["invoice_no", "Odoo Invoice Number", "text", null, 1, 0,
    "The Odoo invoice raised for the deal. Required before the lead reaches the Closed band."],
  ["owner", "Owner", "list", "person", 1, 0, null],
  ["content", "Attributed Content", "content", "content", 0, 0,
    "Retired — Activity Name is now the content picker and carries the primary attribution. Values already recorded are kept."],
  ["btype", "Business Type", "text", null, 0, 0, "Switched off — undefined in the source (Finding 2)."],
  ["bsegment", "Business Segment", "text", null, 0, 0, "Switched off — undefined in the source (Finding 2)."]
];

/* §9.9 Content types and channels */
const CONTENT_TYPES = ["Long-form", "Short-form", "Video", "Podcast", "Testimonial", "Demo video", "Case story"];
const CONTENT_CHANNELS = [["LinkedIn", "#0A66C2"], ["Instagram", "#C13584"], ["YouTube", "#CC0000"], ["Podcast", "#5B4B8A"]];

/* §9.8 Default requirement seeding. Level 1 = always; level 2 = only when the Lead Source is Online (BR-17). */
export const GATE_REQUIREMENTS = ["customer", "designation", "contact", "email", "industry",
  "segment", "offering", "channel", "source"];
/** Asked for on the very first move, so a lead never travels without a number against it. */
export const EARLY_REQUIREMENTS = [["value", 1]];
/** Activity Name is level 2: an Offline channel derives an Offline Lead Source, and the field is then not asked for. */
export const GATE_CONDITIONAL = [["activity", 2]];
export const CSE_REQUIREMENTS = [["location", 1]];
/** Nothing reaches the Closed band without the Odoo invoice against it. */
export const CLOSURE_REQUIREMENTS = [["invoice_no", 1]];

const CRM_SETTINGS = [
  ["crm_allow_skip", "0", "Allow a lead to skip stages (§5.5)", "bool"],
  ["crm_allow_back", "1", "Allow backward movement (§5.5)", "bool"],
  ["crm_back_reason", "1", "Require a reason on backward movement (§5.5)", "bool"],
  ["crm_reason_min", "10", "Minimum characters in a loss or backward-move reason", "number"],
  ["crm_seeding_lead_days", "10", "Days ahead to date the content prompt raised when a product enters Seeding", "number"]
];

/* ------------------------------------------------------------------ */

export function seedCRMIfEmpty() {
  if (col("SELECT COUNT(*) FROM offering")) return false;
  const pw = process.env.PLM_SEED_PASSWORD || "Assured@2026";

  db.exec("BEGIN");
  try {
    run(`INSERT OR IGNORE INTO roles(name,description,permissions,is_system,sort) VALUES
      ('CRM Administrator','Full access to the CRM including Setup — pipelines, stages, requirement matrices and reference data.',
       'crm.lead.create,crm.lead.manage,crm.lead.move,crm.content.manage,crm.setup.manage',1,10),
      ('CRM Sales User','Adds and works leads, moves them through the pipeline, and plans content. No access to CRM Setup (FR-43).',
       'crm.lead.create,crm.lead.manage,crm.lead.move,crm.content.manage',1,11),
      ('CRM Contributor','Works the leads already assigned to them but may neither add one nor move it between stages.',
       'crm.lead.manage',1,12),
      ('Content Planner','Plans and publishes content and sets publishing targets. No access to leads.',
       'crm.content.manage',1,13)`);
    const roleId = n => col("SELECT id FROM roles WHERE name=?", n);

    // No people are seeded. The Product Head creates users and assigns CRM roles in Setup.

    INDUSTRIES.forEach((n, i) => run("INSERT OR IGNORE INTO industry(name,sort) VALUES(?,?)", n, i));
    SEGMENTS.forEach((n, i) => run("INSERT OR IGNORE INTO customer_segment(name,sort) VALUES(?,?)", n, i));
    CHANNELS.forEach(([n, mode, person], i) =>
      run("INSERT OR IGNORE INTO channel(name,mode,person_id,sort) VALUES(?,?,?,?)",
        n, mode, person ? col("SELECT id FROM users WHERE name=?", person) : null, i));  // person linked once created
    OFFERINGS.forEach(([code, name], i) =>
      run("INSERT OR IGNORE INTO offering(code,name,revenue_category,sort) VALUES(?,?,NULL,?)", code, name, i));
    CONTENT_TYPES.forEach((n, i) => run("INSERT OR IGNORE INTO content_type(name,sort) VALUES(?,?)", n, i));
    CONTENT_CHANNELS.forEach(([n, c], i) => run("INSERT OR IGNORE INTO content_channel(name,colour,sort) VALUES(?,?,?)", n, c, i));
    FIELDS.forEach(([key, label, type, list, active, locked, help], i) =>
      run(`INSERT OR IGNORE INTO lead_field(key,label,type,list_source,active,locked,sort,help,custom)
           VALUES(?,?,?,?,?,?,?,?,0)`, key, label, type, list, active, locked, i, help));

    for (const [code, name, src, stages] of TEMPLATES) {
      run("INSERT OR IGNORE INTO stage_template(code,name,source_ref) VALUES(?,?,?)", code, name, src);
      const tid = col("SELECT id FROM stage_template WHERE code=?", code);
      stages.forEach(([sname, band, gate], i) =>
        run(`INSERT OR IGNORE INTO stage_template_stage(template_id,seq,name,band,is_gate) VALUES(?,?,?,?,?)`,
          tid, i + 1, sname, band, gate ? 1 : 0));
    }

    CRM_SETTINGS.forEach(([k, v, l, t]) => { if (getSetting(k) === null) setSetting(k, v, l, t); });
    setSetting("crm_schema_rev", "2", "CRM reference-data revision applied to this database", "hidden");

    for (const [offCode, industries, tplCode, owner] of PIPELINES) {
      const off = one("SELECT * FROM offering WHERE code=?", offCode);
      const tpl = one("SELECT * FROM stage_template WHERE code=?", tplCode);
      run(`INSERT INTO pipeline(name,offering_id,template_id,owner_id,active,created_at)
           VALUES(?,?,?,?,1,datetime('now'))`,
        off.name, off.id, tpl.id, col("SELECT id FROM users WHERE name=?", owner));   // NULL until that person exists
      const pid = col("SELECT MAX(id) FROM pipeline");
      industries.forEach(n =>
        run("INSERT OR IGNORE INTO pipeline_industry(pipeline_id,industry_id) VALUES(?,?)",
          pid, col("SELECT id FROM industry WHERE name=?", n)));
      copyTemplateStages(pid, tpl.id);
      seedDefaultRequirements(pid);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }

  console.log(`  CRM seeded: ${OFFERINGS.length} offerings, ${PIPELINES.length} pipelines over ` +
    `${col("SELECT COUNT(*) FROM pipeline_industry")} (offering, industry) pairs, ` +
    `${TEMPLATES.length} stage templates, ${col("SELECT COUNT(*) FROM lead_field")} lead fields. No people, no leads, no content.`);
  return true;
}

/** Copy a template's stages onto a pipeline. After this the pipeline owns them (§3.2). */
export function copyTemplateStages(pipelineId, templateId) {
  run("DELETE FROM pipeline_stage WHERE pipeline_id=?", pipelineId);
  for (const s of all("SELECT * FROM stage_template_stage WHERE template_id=? ORDER BY seq", templateId))
    run("INSERT INTO pipeline_stage(pipeline_id,seq,name,band,is_gate) VALUES(?,?,?,?,?)",
      pipelineId, s.seq, s.name, s.band, s.is_gate);
}

/** §9.8 — requirements at the second stage, the qualification gate, the first CSE stage and the Closed band. */
export function seedDefaultRequirements(pipelineId, replace = false) {
  const put = (stageId, key, level) => run(
    `INSERT INTO stage_requirement(pipeline_stage_id,field_key,level) VALUES(?,?,?)
     ON CONFLICT(pipeline_stage_id,field_key) DO UPDATE SET level=${replace ? "excluded.level" : "level"}`,
    stageId, key, level);
  const stageAt = sql => one(`SELECT * FROM pipeline_stage WHERE pipeline_id=? ${sql}`, pipelineId);

  const second = stageAt("AND seq=2");
  if (second) EARLY_REQUIREMENTS.forEach(([k, l]) => put(second.id, k, l));
  const gate = stageAt("AND is_gate=1 ORDER BY seq LIMIT 1");
  if (gate) {
    GATE_REQUIREMENTS.forEach(k => put(gate.id, k, 1));
    GATE_CONDITIONAL.forEach(([k, l]) => put(gate.id, k, l));
  }
  const cse = stageAt("AND band='CSE' ORDER BY seq LIMIT 1");
  if (cse) CSE_REQUIREMENTS.forEach(([k, l]) => put(cse.id, k, l));
  const closed = stageAt("AND band='Closed' ORDER BY seq LIMIT 1");
  if (closed) CLOSURE_REQUIREMENTS.forEach(([k, l]) => put(closed.id, k, l));
}

/**
 * Brings a database seeded by an earlier release up to the current field catalogue and default
 * requirements. Idempotent and guarded by a revision number, so it costs one settings read per boot.
 */
export function migrateCRM() {
  const REV = 2;
  if (Number(getSetting("crm_schema_rev", "1")) >= REV) return false;

  db.exec("BEGIN");
  try {
    // The field catalogue is authoritative: re-assert label, type, list source and active flag.
    FIELDS.forEach(([key, label, type, list, active, locked, help], i) => {
      if (col("SELECT id FROM lead_field WHERE key=?", key))
        run("UPDATE lead_field SET label=?, type=?, list_source=?, active=?, sort=?, help=? WHERE key=?",
          label, type, list, active, i, help, key);
      else
        run(`INSERT INTO lead_field(key,label,type,list_source,active,locked,sort,help,custom)
             VALUES(?,?,?,?,?,?,?,?,0)`, key, label, type, list, active, locked, i, help);
    });
    // Attributed Content is retired into Activity Name; its requirements go with it.
    run("DELETE FROM stage_requirement WHERE field_key='content'");
    // Re-assert the defaults on every pipeline, overwriting levels this release has changed.
    all("SELECT id FROM pipeline").forEach(p => seedDefaultRequirements(p.id, true));
    // crm.lead.manage used to mean all three; keep every existing role's users working exactly as before.
    for (const r of all("SELECT id, permissions FROM roles")) {
      const perms = String(r.permissions || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!perms.includes("crm.lead.manage")) continue;
      const add = ["crm.lead.create", "crm.lead.move"].filter(p => !perms.includes(p));
      if (add.length) run("UPDATE roles SET permissions=? WHERE id=?", [...perms, ...add].join(","), r.id);
    }
    setSetting("crm_schema_rev", String(REV), "CRM reference-data revision applied to this database", "hidden");
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  console.log("  CRM reference data migrated to revision " + REV + ".");
  return true;
}
