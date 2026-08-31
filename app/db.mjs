// Schema. One file, plain SQL, no migration framework.
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.PLM_DB || path.join(here, "..", "plm.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT,
  permissions TEXT NOT NULL DEFAULT '', is_system INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  title TEXT, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0, last_login TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- The stage model (FR-51): 8 development gates + 6 market states, configurable.
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, track TEXT NOT NULL,       -- development | market
  name TEXT NOT NULL, purpose TEXT, definition TEXT,
  owner_role_id INTEGER REFERENCES roles(id),
  approver_role_id INTEGER REFERENCES roles(id),                            -- NULL on market states
  target_days INTEGER, ageing_days INTEGER,
  escalate_role_id INTEGER REFERENCES roles(id),
  entry_condition TEXT, exit_condition TEXT,
  UNIQUE (track, seq)
);

-- Participants are notified when a gate is submitted and when it is decided.
-- They are not consulted and never block an approval.
CREATE TABLE IF NOT EXISTS stage_participant (
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (stage_id, role_id)
);

CREATE TABLE IF NOT EXISTS exit_criteria (
  id INTEGER PRIMARY KEY, stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, text TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL, problem TEXT NOT NULL,
  origin TEXT NOT NULL, route TEXT NOT NULL, client_source TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  entry_stage_id INTEGER REFERENCES stages(id),
  entry_override_reason TEXT,
  track TEXT NOT NULL DEFAULT 'development',
  stage_id INTEGER REFERENCES stages(id),
  status TEXT NOT NULL DEFAULT 'Active',
  next_action TEXT, action_owner_user_id INTEGER REFERENCES users(id),
  target_date TEXT, revised_date TEXT, stage_entry_date TEXT,
  actual_completion_date TEXT,
  effort_budget REAL, closure_reason TEXT,
  predecessor_id INTEGER REFERENCES products(id),
  spec_link TEXT,
  hold_resume_date TEXT, hold_reason TEXT,
  submitted_at TEXT, submitted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL, created_by INTEGER, updated_at TEXT
);

-- Immutable (BR-33). One row per position the product has occupied.
CREATE TABLE IF NOT EXISTS stage_history (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id), track TEXT NOT NULL,
  entered_on TEXT NOT NULL, exited_on TEXT, decision TEXT,
  from_stage_id INTEGER REFERENCES stages(id),
  actor_user_id INTEGER REFERENCES users(id), note TEXT,
  correction_of INTEGER REFERENCES stage_history(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gate_approvals (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  decision TEXT NOT NULL,                       -- Approved | Returned | Killed
  actor_user_id INTEGER NOT NULL REFERENCES users(id), role_id INTEGER REFERENCES roles(id),
  reason TEXT, submitted_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS criterion_status (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  criterion_id INTEGER NOT NULL REFERENCES exit_criteria(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  met INTEGER NOT NULL DEFAULT 0, evidence TEXT,
  marked_by INTEGER REFERENCES users(id), marked_at TEXT,
  UNIQUE (product_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS effort_entries (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id), period TEXT NOT NULL, days REAL NOT NULL,
  consultant_user_id INTEGER REFERENCES users(id), estimated INTEGER NOT NULL DEFAULT 0,
  note TEXT, logged_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  client_ref TEXT NOT NULL, deployed_on TEXT NOT NULL, revenue REAL NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0, confirmed_by INTEGER REFERENCES users(id), confirmed_at TEXT,
  note TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS date_revisions (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id), old_date TEXT, new_date TEXT NOT NULL,
  reason TEXT NOT NULL, user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_changes (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_stage_id INTEGER REFERENCES stages(id), to_stage_id INTEGER REFERENCES stages(id),
  evidence TEXT NOT NULL, review_ref TEXT, user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_changes (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_user_id INTEGER, to_user_id INTEGER, reason TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kill_requests (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage_id INTEGER REFERENCES stages(id), reason TEXT NOT NULL,
  recommended_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
  decision TEXT, closure_reason TEXT, decided_by INTEGER REFERENCES users(id), decided_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT, text TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
  field TEXT, old_value TEXT, new_value TEXT, summary TEXT,
  user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, label TEXT, kind TEXT);

/* ============================ CRM & Content Calendar ============================
   AGC-BRD-CRM-001 §4. The spec table person is the application's own users table (Finding 7:
   one people list serves leads, content authorship and sign-in).                 */

CREATE TABLE IF NOT EXISTS industry (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS customer_segment (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS channel (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, mode TEXT NOT NULL,        -- Online | Offline
  person_id INTEGER REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS offering (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  revenue_category TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS content_type (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS content_channel (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, colour TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS stage_template (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, source_ref TEXT);

CREATE TABLE IF NOT EXISTS stage_template_stage (
  id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES stage_template(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, name TEXT NOT NULL, band TEXT NOT NULL, is_gate INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, seq));

CREATE TABLE IF NOT EXISTS lead_field (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
  list_source TEXT, active INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0, help TEXT, custom INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS pipeline (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, offering_id INTEGER NOT NULL REFERENCES offering(id),
  template_id INTEGER REFERENCES stage_template(id), owner_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS pipeline_industry (
  pipeline_id INTEGER NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
  industry_id INTEGER NOT NULL REFERENCES industry(id),
  PRIMARY KEY (pipeline_id, industry_id));

CREATE TABLE IF NOT EXISTS pipeline_stage (
  id INTEGER PRIMARY KEY, pipeline_id INTEGER NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, name TEXT NOT NULL, band TEXT NOT NULL, is_gate INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS stage_requirement (
  pipeline_stage_id INTEGER NOT NULL REFERENCES pipeline_stage(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL, level INTEGER NOT NULL,                              -- 1 always · 2 when Online
  PRIMARY KEY (pipeline_stage_id, field_key));

CREATE TABLE IF NOT EXISTS lead (
  id INTEGER PRIMARY KEY, company TEXT NOT NULL,
  pipeline_id INTEGER REFERENCES pipeline(id), stage_id INTEGER REFERENCES pipeline_stage(id),
  stage_entered_at TEXT, owner_id INTEGER REFERENCES users(id),
  offering_id INTEGER REFERENCES offering(id), industry_id INTEGER REFERENCES industry(id),
  segment_id INTEGER REFERENCES customer_segment(id), channel_id INTEGER REFERENCES channel(id),
  source TEXT, source_override INTEGER NOT NULL DEFAULT 0, source_override_reason TEXT,
  customer TEXT, designation TEXT, location TEXT, contact TEXT, email TEXT, activity TEXT,
  primary_content_id INTEGER REFERENCES content(id),
  lost INTEGER NOT NULL DEFAULT 0, lost_reason TEXT, lost_at TEXT, lost_stage_id INTEGER,
  created_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id), updated_at TEXT);

CREATE TABLE IF NOT EXISTS lead_field_value (
  lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL, value TEXT, PRIMARY KEY (lead_id, field_key));

-- Append-only (BR-24). No API path may UPDATE or DELETE a row here.
CREATE TABLE IF NOT EXISTS lead_stage_history (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  from_seq INTEGER, to_seq INTEGER, stage_name_snapshot TEXT,
  actor_id INTEGER REFERENCES users(id), at TEXT NOT NULL, reason TEXT);

CREATE TABLE IF NOT EXISTS lead_content_touch (
  lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, added_by INTEGER REFERENCES users(id),
  PRIMARY KEY (lead_id, content_id));

CREATE TABLE IF NOT EXISTS lead_note (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  body TEXT NOT NULL, author_id INTEGER REFERENCES users(id), at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL,
  type_id INTEGER NOT NULL REFERENCES content_type(id),
  channel_id INTEGER NOT NULL REFERENCES content_channel(id),
  person_id INTEGER NOT NULL REFERENCES users(id),
  offering_id INTEGER REFERENCES offering(id), industry_id INTEGER REFERENCES industry(id),
  theme TEXT, status TEXT NOT NULL DEFAULT 'Planned', url TEXT,
  created_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id));

-- Not in AGC-BRD-CRM-001: carries the PLM hand-off. A product entering market state Seeding
-- raises a prompt on the content calendar; a human turns it into a content item (BR-31 still applies).
CREATE TABLE IF NOT EXISTS content_prompt (
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  title TEXT NOT NULL, detail TEXT, due_date TEXT, offering_id INTEGER REFERENCES offering(id),
  status TEXT NOT NULL DEFAULT 'Open',                                          -- Open | Planned | Dismissed
  content_id INTEGER REFERENCES content(id), created_at TEXT NOT NULL,
  resolved_by INTEGER REFERENCES users(id), resolved_at TEXT, resolve_note TEXT);

CREATE INDEX IF NOT EXISTS ix_lead_pipe    ON lead(pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS ix_lead_hist    ON lead_stage_history(lead_id);
CREATE INDEX IF NOT EXISTS ix_touch_lead   ON lead_content_touch(lead_id);
CREATE INDEX IF NOT EXISTS ix_touch_cont   ON lead_content_touch(content_id);
CREATE INDEX IF NOT EXISTS ix_content_date ON content(date);
CREATE INDEX IF NOT EXISTS ix_pstage_pipe  ON pipeline_stage(pipeline_id, seq);
CREATE INDEX IF NOT EXISTS ix_prompt_stat  ON content_prompt(status);

CREATE INDEX IF NOT EXISTS ix_hist_prod   ON stage_history(product_id);
CREATE INDEX IF NOT EXISTS ix_eff_prod    ON effort_entries(product_id);
CREATE INDEX IF NOT EXISTS ix_dep_prod    ON deployments(product_id);
CREATE INDEX IF NOT EXISTS ix_audit_ent   ON audit(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_notif_user  ON notifications(user_id, read);
`);

/* Rename carried over from the pre-approval-only model. Safe to run on a fresh database. */
try {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stage_consulted','stage_participant')").all().map(r => r.name);
  if (t.includes("stage_consulted") && !t.includes("stage_participant"))
    db.exec("ALTER TABLE stage_consulted RENAME TO stage_participant");
  db.exec("DROP TABLE IF EXISTS consultations");
} catch { /* nothing to migrate */ }

/* ---------- tiny query helpers ---------- */
// node:sqlite rejects undefined and booleans; normalise once here rather than at every call site.
const norm = p => p.map(v => v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
export const all = (sql, ...p) => db.prepare(sql).all(...norm(p));
export const one = (sql, ...p) => db.prepare(sql).get(...norm(p)) ?? null;
export const run = (sql, ...p) => db.prepare(sql).run(...norm(p));
export const col = (sql, ...p) => { const r = one(sql, ...p); return r ? Object.values(r)[0] : null; };

export const getSetting = (k, dflt = null) => {
  const r = one("SELECT value FROM settings WHERE key=?", k);
  return r ? r.value : dflt;
};
export const setSetting = (k, v, label, kind) =>
  run(`INSERT INTO settings(key,value,label,kind) VALUES(?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, String(v), label ?? null, kind ?? null);

export function secret() {
  let s = getSetting("app_secret");
  if (!s) { s = randomBytes(32).toString("hex"); setSetting("app_secret", s, "Session signing key", "hidden"); }
  return s;
}

export function audit(entity, entity_id, action, summary, userId, field, oldV, newV) {
  run(`INSERT INTO audit(entity,entity_id,action,field,old_value,new_value,summary,user_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,datetime('now'))`,
    entity, entity_id ?? null, action, field ?? null,
    oldV === undefined ? null : oldV === null ? null : String(oldV),
    newV === undefined ? null : newV === null ? null : String(newV),
    summary ?? null, userId ?? null);
}

export function notify(userIds, productId, kind, text) {
  const seen = new Set();
  for (const uid of [].concat(userIds).filter(Boolean)) {
    if (seen.has(uid)) continue; seen.add(uid);
    run(`INSERT INTO notifications(user_id,product_id,kind,text,read,created_at)
         VALUES(?,?,?,?,0,datetime('now'))`, uid, productId ?? null, kind, text);
  }
}
