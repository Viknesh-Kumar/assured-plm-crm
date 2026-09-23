// Content Calendar — the third application. Cadence-driven planning, stage readiness, back-scheduled
// tasks and per-platform figures. Every rule is enforced here with a rule code (CC-01 … CC-40) and
// proved by a refusal in content-test.mjs; the browser displays refusals and never decides one.
//
// The model in one paragraph. A CADENCE (a posting target) says "account A posts content type T on
// platforms P, N times a month, in weeks W on weekdays D, from month X to month Y". Generating it creates
// one SLOT (a content item with a date but no topic) per date. Each item carries a copy of its type's STAGE
// list — topic, work stages, publish — each with a readiness % and a turnaround time (TAT) in days before
// the posting date. A stage's due date is never stored: it is the posting date less the TAT, pulled back
// off weekends and holidays, so moving a post moves every deadline with it. Open stages are the owner
// role's tasks. Everything that shapes this — types, stages, accounts, platforms, metrics, holidays and
// the calendar rules — is configuration, changed in the app's own Setup.
import { db, all, one, run, col, getSetting, setSetting, audit, notify, CONTENT_COLUMNS } from "./db.mjs";
import { HttpError, toCSV } from "./lib.mjs";
import { PERMISSIONS } from "./seed.mjs";
import { resolvePrompt } from "./crm.mjs";

/* ------------------------------------------------------------------ */
/* refusals and access                                                 */
/* ------------------------------------------------------------------ */
const refuse = (rule, msg, extra) => { const e = new HttpError(400, msg, rule); Object.assign(e, extra || {}); throw e; };
const deny = (msg, rule = "CC-40") => { throw new HttpError(403, msg, rule); };
const gone = msg => { throw new HttpError(404, msg); };

// crm.content.manage, content.cadence.manage and content.setup.manage open the Content Calendar; their labels
// live with every other permission in seed.mjs.
const PERM_LABEL = Object.fromEntries(PERMISSIONS);
const can = (u, p) => u.permissions.includes(p);
const need = (u, p) => {
  if (!can(u, p)) deny(`You do not have access to: ${PERM_LABEL[p] || p} (${p}). Your roles are `
    + `${u.roleNames.join(", ") || "none"}. An administrator can grant it in Setup → Users.`);
};

const setting = (k, d) => { const v = getSetting(k); return v === null ? d : v; };
const reasonMin = () => Number(setting("content_reason_min", 10));
const int = v => (v === "" || v === null || v === undefined ? NaN : Number(String(v).replace(/[,\s]/g, "")));
const isWhole = n => Number.isFinite(n) && Math.floor(n) === n;
const listOf = v => [].concat(v ?? []).flatMap(x => String(x).split(",")).map(s => s.trim()).filter(s => s !== "");
const pad = n => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ */
/* the clock — Dubai, not UTC                                          */
/* ------------------------------------------------------------------ */
// The existing lib.today() is UTC, so between 00:00 and 04:00 in Dubai it still reports yesterday. For
// deadlines that matters: a task due "today" would stay not-overdue until 04:00 the next morning.
let fixedToday = null;
/** Tests only: pin "today". Pass null to return to the real clock. */
export const setToday = d => { fixedToday = d; };
export const localDate = (instant, tz) => new Intl.DateTimeFormat("en-CA",
  { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
export const today = () => fixedToday || localDate(new Date(), setting("content_timezone", "Asia/Dubai"));

/* ------------------------------------------------------------------ */
/* date arithmetic on ISO dates (UTC midnight, so no DST surprises)     */
/* ------------------------------------------------------------------ */
const DAY = 864e5;
const ISO_RX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD_RX = /^\d{4}-(0[1-9]|1[0-2])$/;
const T = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const D = t => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => D(T(s) + n * DAY);
export const weekdayOf = s => new Date(T(s)).getUTCDay();
export const daysBetween = (a, b) => Math.round((T(b) - T(a)) / DAY);
const validDate = s => ISO_RX.test(String(s)) && D(T(s)) === s;          // rejects 2026-02-30
export const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINAL = ["", "1st", "2nd", "3rd", "4th"];

/**
 * The n-th occurrence (1–4) of a weekday (0=Sun … 6=Sat) in a month. Always exists: the 4th occurrence
 * falls on day 22–28. A 5th occurrence is never used, so a cadence produces the same count every month.
 */
export function nthWeekday(y, m, weekday, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return `${y}-${pad(m)}-${pad(1 + ((weekday - first + 7) % 7) + (n - 1) * 7)}`;
}

export function monthsBetween(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
const monthsSpan = (from, to) => monthsBetween(from, to).length;

const weekendSet = () => new Set(listOf(setting("content_weekend_days", "6,0")).map(Number));
const holidaySet = () => new Set(all("SELECT date FROM content_holiday").map(r => r.date));

/**
 * When a stage must be done: the posting date less the TAT in calendar days. A deadline that lands on a
 * weekend or a holiday is pulled EARLIER to the previous working day — never later, because it is a
 * deadline. The publish stage (TAT 0) keeps the posting date itself: a post may deliberately go out on a
 * Saturday. Pulling back is monotone, so a later stage is never due before an earlier one.
 */
export function dueDate(postDate, tatDays, ctx = { weekend: weekendSet(), holidays: holidaySet() }) {
  let d = addDays(postDate, -tatDays);
  if (tatDays === 0) return d;
  for (let guard = 0; guard < 366 && (ctx.weekend.has(weekdayOf(d)) || ctx.holidays.has(d)); guard++)
    d = addDays(d, -1);
  return d;
}

/* ------------------------------------------------------------------ */
/* rule catalogue — quoted by refusals and by the feasibility note      */
/* ------------------------------------------------------------------ */
export const RULES = {
  "CC-01": "A content type's stage list starts with the topic stage and ends with the publish stage — exactly one of each.",
  "CC-02": "Readiness % rises at every stage and is 100 at the publish stage.",
  "CC-03": "TAT is whole days before posting, never increases from one stage to the next, and is 0 at the publish stage.",
  "CC-04": "Every stage has an owner role that exists.",
  "CC-05": "A 'from parent' stage names a stage of another content type; one per list; no circular parents.",
  "CC-06": "A stage that another type's 'from parent' stage points at cannot be removed.",
  "CC-07": "Content types, platforms, accounts, metrics and holidays are named and unique; an account is a Company or a Personal account; a colour is #RRGGBB.",
  "CC-08": "Calendar rules are whole numbers in range, a real time zone, weekend days that leave at least one working day, and an owner role that exists.",
  "CC-09": "A content type or platform that anything uses is deactivated, never deleted — the refusal says what uses it.",
  "CC-10": "A target covers whole months, YYYY-MM to YYYY-MM, no more than the configured maximum, and cannot end in the past.",
  "CC-11": "A target needs an account, a content type that has a stage list, and at least one platform.",
  "CC-12": "Posts per month = weeks × weekdays; weeks are the 1st–4th occurrence only.",
  "CC-13": "Two targets for the same account and content type may not claim the same week and weekday in the same month.",
  "CC-14": "Generation is repeatable and never creates a slot dated before today.",
  "CC-15": "Revising or ending a target removes only untouched future slots; touched slots stay, flagged.",
  "CC-20": "An item needs a date, a content type with a stage list, an account and at least one platform.",
  "CC-21": "The topic stage is done only when topic, theme and keyword are all recorded.",
  "CC-22": "Stages are completed in order.",
  "CC-23": "A stage is completed by a holder of its owner role (content administrators may override; audited).",
  "CC-24": "A 'from parent' stage ticks itself when the parent's stage is done; the parent must be the right type and due in time.",
  "CC-25": "Publishing needs every earlier stage done, a posting date that is not in the future, and a URL for each platform.",
  "CC-26": "Moving a date after work has started needs a reason; a published item cannot be moved; no date in the past.",
  "CC-27": "Reopening a stage reopens every later stage and every dependent child stage; published items are closed.",
  "CC-28": "Cancelling needs a reason and is not possible once published; children of a cancelled parent are flagged.",
  "CC-29": "A cadence slot is cancelled, never deleted; an item a lead points at cannot be deleted.",
  "CC-30": "Metrics are recorded on published items, per platform, for metrics that apply to it, as whole numbers ≥ 0, dated between publishing and today.",
  "CC-31": "One value per item, platform, metric and capture date; recording it again replaces it and is audited.",
  "CC-40": "Setup needs content.setup.manage; targets need content.cadence.manage; item work needs crm.content.manage."
};

/* ------------------------------------------------------------------ */
/* migration — the tables are in db.mjs; this rebuilds a first-release  */
/* content table and seeds the calendar's reference data and rules      */
/* ------------------------------------------------------------------ */
export const SCHEMA_REV = 1;
// Reference data the sponsor named: three accounts and four metrics. Everything else is configuration.
const ACCOUNTS = [["Assured", "Company", "#0176D3"], ["Siddique", "Personal", "#0B827C"], ["Dhiraj", "Personal", "#7526E3"]];
const METRICS = ["Impressions", "Profile visits", "Views", "Likes"];
const CONTENT_MANAGER = "Content Manager";

/**
 * The calendar rules, each one a setting changed in Setup → Rules (CC-08). [key, label, kind, range].
 * Defaults are written by the migration; a kind tells saveRules() how to read and check a value.
 */
export const RULE_SETTINGS = [
  ["content_timezone", "Time zone that decides what 'today' and 'overdue' mean", "timezone"],
  ["content_weekend_days", "Days a deadline never falls on — it moves to the working day before", "weekdays"],
  ["content_topic_horizon_days", "Topic look-ahead: slots this many days out must have their topic", "number", [1, 366]],
  ["content_topic_tat_default", "Topic TAT offered when a new stage list is started, in days", "number", [0, 366]],
  ["content_due_soon_days", "A task due within this many days is 'due soon'", "number", [0, 60]],
  ["content_metric_capture_days", "Days after publishing when each platform's figures are captured", "days"],
  ["content_require_url", "Publishing needs the post link for every platform", "bool"],
  ["content_reason_min", "Minimum characters in a reason to move, cancel or reopen", "number", [1, 500]],
  ["content_target_max_months", "The most months one posting target may cover", "number", [1, 60]],
  ["content_manager_role", "The role that runs the calendar: default stage owner, figure captures and notices", "role"],
  ["content_digest", "Each stage owner gets a daily in-app digest of overdue and due-soon work", "bool"]
];

/**
 * Idempotent; guarded by content_schema_rev so it costs one settings read per boot once applied.
 * Returns a summary of what it migrated, or null when nothing was due.
 */
export function migrateContentV2() {
  if (Number(setting("content_schema_rev", "0")) >= SCHEMA_REV) return null;

  const summary = {};
  db.exec("PRAGMA foreign_keys = OFF");          // must be outside the transaction to take effect
  db.exec("BEGIN");
  try {
    const before = col("SELECT COUNT(*) FROM content");
    const cols = all("PRAGMA table_info(content)").map(c => c.name);
    if (!cols.includes("account_id")) {
      // SQLite cannot drop a NOT NULL in place, so the first release's table is rebuilt. Ids are kept, so
      // lead.primary_content_id and lead_content_touch survive untouched.
      db.exec(`CREATE TABLE content_v2 (${CONTENT_COLUMNS})`);
      db.exec(`INSERT INTO content_v2(id,date,title,type_id,channel_id,person_id,offering_id,industry_id,theme,status,url,
                 engagement_metric,engagement_value,published_on,created_on,created_at,created_by)
               SELECT id,date,title,type_id,channel_id,person_id,offering_id,industry_id,theme,status,url,
                 engagement_metric,engagement_value, CASE WHEN status='Published' THEN date END,
                 substr(created_at,1,10), created_at, created_by
               FROM content`);
      db.exec("DROP TABLE content");
      db.exec("ALTER TABLE content_v2 RENAME TO content");
    }
    db.exec(`CREATE INDEX IF NOT EXISTS ix_content_date ON content(date);
             CREATE INDEX IF NOT EXISTS ix_content_cad  ON content(cadence_id, slot_date);
             CREATE INDEX IF NOT EXISTS ix_content_acct ON content(account_id, type_id, date);
             CREATE INDEX IF NOT EXISTS ix_content_par  ON content(parent_id)`);

    ACCOUNTS.forEach(([n, k, colour], i) => run(`INSERT OR IGNORE INTO content_account(name,kind,person_id,colour,sort)
      VALUES(?,?,(SELECT id FROM users WHERE name=? AND ?='Personal'),?,?)`, n, k, n, k, colour, i));
    METRICS.forEach((n, i) => run("INSERT OR IGNORE INTO content_metric(name,sort) VALUES(?,?)", n, i));

    run(`INSERT OR IGNORE INTO roles(name,description,permissions,is_system,sort) VALUES(?,?,?,1,14)`,
      CONTENT_MANAGER, "Owns the content calendar day to day: maps topics, works every stage, publishes and records metrics.",
      "crm.content.manage,content.cadence.manage");
    for (const r of all("SELECT id, name, permissions FROM roles WHERE name IN ('Product Head','CRM Administrator')")) {
      const perms = new Set(String(r.permissions || "").split(",").filter(Boolean));
      ["content.setup.manage", "content.cadence.manage"].forEach(p => perms.add(p));
      run("UPDATE roles SET permissions=? WHERE id=?", [...perms].join(","), r.id);
    }

    // The rules start where the rest of the application already stands, then are the calendar's own.
    const defaults = {
      content_timezone: "Asia/Dubai", content_weekend_days: setting("weekend_days", "6,0"),
      content_topic_horizon_days: "60", content_topic_tat_default: "60", content_due_soon_days: "7",
      content_metric_capture_days: "7,30", content_require_url: "1", content_reason_min: setting("crm_reason_min", "10"),
      content_target_max_months: "24", content_manager_role: String(col("SELECT id FROM roles WHERE name=?", CONTENT_MANAGER)),
      content_digest: "1"
    };
    for (const [k, label, kind] of RULE_SETTINGS) if (getSetting(k) === null) setSetting(k, defaults[k], label, kind);

    Object.assign(summary, adoptLegacy());
    summary.items = col("SELECT COUNT(*) FROM content");
    if (summary.items !== before) throw new Error(`content rebuild lost rows: ${before} → ${summary.items}`);
    const broken = all("PRAGMA foreign_key_check");
    if (broken.length) throw new Error(`foreign key check failed after the rebuild: ${JSON.stringify(broken.slice(0, 3))}`);

    setSetting("content_schema_rev", String(SCHEMA_REV), "Content calendar schema revision", "hidden");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  audit("content", null, "migrate", `Content calendar v2 applied: ${summary.items} items, `
    + `${summary.platforms} platform rows, ${summary.metrics} engagement figures carried over`, null);
  return summary;
}

/**
 * Carries first-release rows into the calendar: the one channel becomes a platform row, the author's
 * personal account (else the company's) becomes the account, and a recorded engagement figure becomes a
 * dated metric value. Idempotent — the migration runs it once, and the demo loader after writing rows.
 */
export function adoptLegacy() {
  const platforms = run(`INSERT OR IGNORE INTO content_platform(content_id,channel_id,url)
    SELECT c.id, c.channel_id, c.url FROM content c WHERE c.channel_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM content_platform p WHERE p.content_id=c.id)`).changes;
  run(`UPDATE content SET account_id = COALESCE(
         (SELECT a.id FROM content_account a WHERE a.person_id = content.person_id AND a.kind='Personal'),
         (SELECT a.id FROM content_account a WHERE a.kind='Company' ORDER BY a.sort, a.id LIMIT 1))
       WHERE account_id IS NULL`);
  run("UPDATE content SET published_on=date WHERE status='Published' AND published_on IS NULL");
  run("UPDATE content SET created_on=substr(created_at,1,10) WHERE created_on IS NULL");
  const metrics = run(`INSERT OR IGNORE INTO content_metric_value(content_id,channel_id,metric_id,captured_on,value,source,recorded_at)
    SELECT c.id, c.channel_id, m.id, ?, c.engagement_value, 'migrated', datetime('now')
    FROM content c JOIN content_metric m ON m.name = c.engagement_metric
    WHERE c.engagement_value IS NOT NULL AND c.channel_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM content_metric_value v WHERE v.content_id=c.id)`, today()).changes;
  return { platforms, metrics };
}

/** One transaction per public write. db.mjs's tx() is not re-entrant, so this one is. */
let depth = 0;
function atomic(fn) {
  if (depth) return fn();
  depth++;
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
  finally { depth--; }
}

/* ------------------------------------------------------------------ */
/* configuration — the calendar rules (CC-08)                           */
/* ------------------------------------------------------------------ */
/** The role that runs the calendar. A setting, so it can be any role; falls back to Content Manager. */
const managerRoleId = () => col("SELECT id FROM roles WHERE id=?", Number(setting("content_manager_role", 0)))
  ?? col("SELECT id FROM roles WHERE name=?", CONTENT_MANAGER);

export const rulesOf = () => RULE_SETTINGS.map(([key, label, kind, range]) =>
  ({ key, label, kind, range: range || null, value: getSetting(key) }));

/** CC-08 — every problem in the form is named, then nothing or everything is written. */
export function saveRules(user, b) {
  need(user, "content.setup.manage");
  const problems = [], next = {};
  for (const [key, label, kind, range] of RULE_SETTINGS) {
    if (!(key in b)) continue;
    let v = String(b[key] ?? "").trim();
    if (kind === "number") {
      const n = int(v);
      if (!isWhole(n) || n < range[0] || n > range[1]) problems.push(`"${label}" is a whole number from ${range[0]} to ${range[1]}`);
      v = String(n);
    } else if (kind === "bool") {
      v = [true, 1, "1", "true", "on"].includes(b[key]) ? "1" : "0";
    } else if (kind === "timezone") {
      try { localDate(new Date(), v); } catch { problems.push(`"${v}" is not a time zone — write it like Asia/Dubai`); }
    } else if (kind === "weekdays") {
      const d = [...new Set(listOf(v).map(Number))].sort((x, y) => x - y);
      if (d.some(x => !isWhole(x) || x < 0 || x > 6)) problems.push("weekend days are 0 (Sunday) to 6 (Saturday)");
      else if (d.length > 6) problems.push("at least one day of the week has to be a working day, or no deadline could land anywhere");
      v = d.join(",");
    } else if (kind === "days") {
      const d = [...new Set(listOf(v).map(int))].sort((x, y) => x - y);
      if (d.some(x => !isWhole(x) || x < 1 || x > 366)) problems.push("capture days are whole days from 1 to 366 after publishing");
      v = d.join(",");
    } else if (kind === "role") {
      if (!one("SELECT id FROM roles WHERE id=?", int(v))) problems.push("the role that runs the calendar has to be a role that exists");
    }
    next[key] = v;
  }
  if (problems.length) refuse("CC-08", `Nothing was saved: ${problems.join("; ")}.`);
  for (const [k, v] of Object.entries(next)) {
    const old = getSetting(k);
    if (String(old) === v) continue;
    setSetting(k, v);
    audit("setting", null, "update", `Content calendar rule ${k} changed`, user.id, k, old, v);
  }
  return rulesOf();
}

/* ------------------------------------------------------------------ */
/* configuration — content types and platforms (CC-07, CC-09)           */
/* ------------------------------------------------------------------ */
/** What depends on a content type or a platform, counted table by table so a refusal can say so. */
const USES = {
  content_type: { label: "content type", uses: [["content", "type_id", "item"], ["content_stage", "type_id", "stage"],
    ["content_cadence", "type_id", "target"], ["content_target", "type_id", "earlier target"]] },
  content_channel: { label: "platform", uses: [["content_platform", "channel_id", "post"], ["content", "channel_id", "item"],
    ["content_cadence_platform", "channel_id", "target"], ["content_metric_platform", "channel_id", "metric"],
    ["content_metric_value", "channel_id", "figure"], ["content_target", "channel_id", "earlier target"]] }
};
const usesOf = (table, id) => USES[table].uses.map(([t, c, noun]) => [col(`SELECT COUNT(*) FROM ${t} WHERE ${c}=?`, id), noun])
  .filter(([n]) => n);

/** CC-07 — a colour goes into the page as a style, so only #RRGGBB is accepted. Empty keeps the current one. */
const checkColour = c => {
  if (c && !/^#[0-9a-f]{6}$/i.test(String(c))) refuse("CC-07", `"${c}" is not a colour — write it #RRGGBB, for example #0176D3.`);
};

function saveListValue(user, table, id, b, extra) {
  need(user, "content.setup.manage");
  const what = USES[table].label;
  const name = String(b.name ?? "").trim();
  if (!name) refuse("CC-07", `A ${what} needs a name.`);
  if (extra) checkColour(b.colour);
  if (one(`SELECT id FROM ${table} WHERE lower(name)=lower(?) AND id<>?`, name, id || 0))
    refuse("CC-07", `There is already a ${what} called "${name}".`);
  if (id) {
    const ex = one(`SELECT * FROM ${table} WHERE id=?`, id) || gone(`That ${what} was not found.`);
    const active = b.active === undefined ? ex.active : (b.active ? 1 : 0);
    run(`UPDATE ${table} SET name=?, active=?${extra ? ", colour=?" : ""} WHERE id=?`,
      name, active, ...(extra ? [b.colour || ex.colour] : []), id);
    audit(table, id, "update", `${what[0].toUpperCase() + what.slice(1)} "${name}" updated`, user.id, "active", ex.active, active);
  } else {
    id = Number(run(`INSERT INTO ${table}(name, active${extra ? ", colour" : ""}, sort)
      VALUES(?, 1${extra ? ", ?" : ""}, (SELECT COALESCE(MAX(sort),0)+1 FROM ${table}))`,
      name, ...(extra ? [b.colour || "#5C5C5C"] : [])).lastInsertRowid);
    audit(table, id, "create", `${what[0].toUpperCase() + what.slice(1)} "${name}" added`, user.id);
  }
  return one(`SELECT * FROM ${table} WHERE id=?`, id);
}

function deleteListValue(user, table, id) {
  need(user, "content.setup.manage");
  const what = USES[table].label;
  const ex = one(`SELECT * FROM ${table} WHERE id=?`, id) || gone(`That ${what} was not found.`);
  const uses = usesOf(table, id);
  if (uses.length) refuse("CC-09", `"${ex.name}" is used by ${uses.map(([n, noun]) => `${n} ${noun}${n === 1 ? "" : "s"}`).join(", ")} `
    + "and cannot be deleted. Deactivate it instead — it stops being offered and stays on what already uses it.");
  run(`DELETE FROM ${table} WHERE id=?`, id);
  audit(table, id, "delete", `${what[0].toUpperCase() + what.slice(1)} "${ex.name}" deleted`, user.id);
  return { ok: true };
}

export const saveType = (user, id, b) => saveListValue(user, "content_type", id, b, false);
export const deleteType = (user, id) => deleteListValue(user, "content_type", id);
export const savePlatform = (user, id, b) => saveListValue(user, "content_channel", id, b, true);
export const deletePlatform = (user, id) => deleteListValue(user, "content_channel", id);

/* ------------------------------------------------------------------ */
/* configuration — accounts, metrics, holidays                          */
/* ------------------------------------------------------------------ */

export const listAccounts = () => all(`SELECT a.*, u.name AS person_name FROM content_account a
  LEFT JOIN users u ON u.id=a.person_id ORDER BY a.active DESC, a.sort, a.name`);

/** CC-07 */
export function saveAccount(user, id, b) {
  need(user, "content.setup.manage");
  const name = String(b.name ?? "").trim();
  if (!name) refuse("CC-07", "An account needs a name — Assured, or the person whose profile it is.");
  const kind = b.kind === "Personal" ? "Personal" : b.kind === "Company" || b.kind === undefined ? "Company" : null;
  if (!kind) refuse("CC-07", `An account is a Company or a Personal account — "${b.kind}" is neither.`);
  if (one("SELECT id FROM content_account WHERE lower(name)=lower(?) AND id<>?", name, id || 0))
    refuse("CC-07", `There is already an account called "${name}".`);
  checkColour(b.colour);
  if (id) {
    const ex = one("SELECT * FROM content_account WHERE id=?", id) || gone("Account not found.");
    run("UPDATE content_account SET name=?, kind=?, person_id=?, colour=?, active=? WHERE id=?",
      name, kind, b.person_id || null, b.colour || ex.colour, b.active === undefined ? ex.active : (b.active ? 1 : 0), id);
    audit("content_account", id, "update", `Account "${ex.name}" updated`, user.id, "name", ex.name, name);
  } else {
    id = Number(run("INSERT INTO content_account(name,kind,person_id,colour,sort) VALUES(?,?,?,?,99)",
      name, kind, b.person_id || null, b.colour || "#5C5C5C").lastInsertRowid);
    audit("content_account", id, "create", `Account "${name}" added`, user.id);
  }
  return one("SELECT * FROM content_account WHERE id=?", id);
}

export const listMetrics = () => all("SELECT * FROM content_metric ORDER BY active DESC, sort, name").map(m => ({
  ...m, platforms: all("SELECT channel_id FROM content_metric_platform WHERE metric_id=?", m.id).map(r => r.channel_id)
}));

/** CC-07 — a metric, optionally limited to the platforms that report it. */
export function saveMetric(user, id, b) {
  need(user, "content.setup.manage");
  const name = String(b.name ?? "").trim();
  if (!name) refuse("CC-07", "A metric needs a name, such as Impressions or Profile visits.");
  if (one("SELECT id FROM content_metric WHERE lower(name)=lower(?) AND id<>?", name, id || 0))
    refuse("CC-07", `There is already a metric called "${name}".`);
  const platforms = listOf(b.platforms).map(Number);
  const unknown = platforms.filter(p => !one("SELECT id FROM content_channel WHERE id=?", p));
  if (unknown.length) refuse("CC-07", `Platform ${unknown.join(", ")} does not exist.`);
  return atomic(() => {
    if (id) {
      one("SELECT id FROM content_metric WHERE id=?", id) || gone("Metric not found.");
      run("UPDATE content_metric SET name=?, help=?, active=COALESCE(?,active) WHERE id=?",
        name, b.help || null, b.active === undefined ? null : (b.active ? 1 : 0), id);
    } else {
      id = Number(run("INSERT INTO content_metric(name,help,sort) VALUES(?,?,99)", name, b.help || null).lastInsertRowid);
    }
    run("DELETE FROM content_metric_platform WHERE metric_id=?", id);
    platforms.forEach(p => run("INSERT INTO content_metric_platform(metric_id,channel_id) VALUES(?,?)", id, p));
    audit("content_metric", id, "save", `Metric "${name}" saved${platforms.length ? " for " + platforms.length + " platform(s)" : ""}`, user.id);
    return listMetrics().find(m => m.id === id);
  });
}

/** CC-07 — holidays pull deadlines earlier, exactly like weekends. */
export function saveHoliday(user, b) {
  need(user, "content.setup.manage");
  if (!validDate(b.date)) refuse("CC-07", "A holiday needs a real date, written YYYY-MM-DD.");
  if (!String(b.name ?? "").trim()) refuse("CC-07", "A holiday needs a name.");
  run("INSERT INTO content_holiday(date,name) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name",
    b.date, String(b.name).trim());
  audit("content_holiday", null, "save", `Holiday ${b.date} — ${b.name}`, user.id);
  return all("SELECT * FROM content_holiday ORDER BY date");
}

export function deleteHoliday(user, date) {
  need(user, "content.setup.manage");
  const h = one("SELECT * FROM content_holiday WHERE date=?", date) || gone("That holiday was not found.");
  run("DELETE FROM content_holiday WHERE date=?", date);
  audit("content_holiday", null, "delete", `Holiday ${h.date} — ${h.name} removed`, user.id);
  return all("SELECT * FROM content_holiday ORDER BY date");
}

/* ------------------------------------------------------------------ */
/* configuration — the stage list of a content type                     */
/* ------------------------------------------------------------------ */
export const KINDS = ["topic", "work", "parent", "publish"];
export const stagesOf = typeId => all(`SELECT s.*, r.name AS owner_role, ps.name AS parent_stage_name,
    ps.type_id AS parent_type_id, pt.name AS parent_type_name
  FROM content_stage s LEFT JOIN roles r ON r.id=s.owner_role_id
  LEFT JOIN content_stage ps ON ps.id=s.parent_stage_id LEFT JOIN content_type pt ON pt.id=ps.type_id
  WHERE s.type_id=? ORDER BY s.seq`, typeId);

/** The content type an item of this type must name as its parent, or null. */
const parentTypeOf = typeId => col(`SELECT ps.type_id FROM content_stage s JOIN content_stage ps ON ps.id=s.parent_stage_id
  WHERE s.type_id=? AND s.kind='parent'`, typeId);

/**
 * CC-01 … CC-06. Replaces a type's stage list. Stages carrying an id are updated in place so that items
 * and dependent stages keep pointing at them. Items that have not started production (nothing done beyond
 * the topic) pick up the new list; items in production keep the copy they started with.
 */
export function saveStages(user, typeId, input) {
  need(user, "content.setup.manage");
  const type = one("SELECT * FROM content_type WHERE id=?", typeId) || gone("Content type not found.");
  const stages = [].concat(input || []).map((s, i) => ({
    id: s.id ? Number(s.id) : null, seq: i + 1, name: String(s.name ?? "").trim(),
    pct: int(s.pct), tat: int(s.tat_days), kind: s.kind || "work",
    owner: s.owner_role_id ? Number(s.owner_role_id) : managerRoleId(),
    parent: s.parent_stage_id ? Number(s.parent_stage_id) : null
  }));

  // CC-01 — shape
  if (stages.length < 2) refuse("CC-01", `${type.name} needs at least a topic stage and a publish stage.`);
  const bad = stages.filter(s => !KINDS.includes(s.kind)).map(s => `"${s.name}" (${s.kind})`);
  if (bad.length) refuse("CC-01", `Stage kind must be one of ${KINDS.join(", ")}: ${bad.join(", ")}.`);
  if (stages[0].kind !== "topic") refuse("CC-01", `The first stage of ${type.name} must be the topic stage — topic, theme and keyword come before any work.`);
  if (stages.at(-1).kind !== "publish") refuse("CC-01", `The last stage of ${type.name} must be the publish stage.`);
  if (stages.filter(s => s.kind === "topic").length > 1 || stages.filter(s => s.kind === "publish").length > 1)
    refuse("CC-01", `${type.name} can have only one topic stage and one publish stage.`);
  const unnamed = stages.filter(s => !s.name).map(s => s.seq);
  if (unnamed.length) refuse("CC-01", `Every stage needs a name — stage ${unnamed.join(", ")} has none.`);
  const seen = new Set(), dup = new Set();
  stages.forEach(s => { const k = s.name.toLowerCase(); if (seen.has(k)) dup.add(s.name); seen.add(k); });
  if (dup.size) refuse("CC-01", `Stage names must be unique within ${type.name}: ${[...dup].join(", ")}.`);

  // CC-02 — readiness %
  const pctBad = stages.filter(s => !isWhole(s.pct) || s.pct < 0 || s.pct > 100);
  if (pctBad.length) refuse("CC-02", `Readiness is a whole percentage from 0 to 100: ${pctBad.map(s => s.name).join(", ")}.`);
  for (let i = 1; i < stages.length; i++)
    if (stages[i].pct <= stages[i - 1].pct)
      refuse("CC-02", `Readiness must rise at every stage: "${stages[i].name}" (${stages[i].pct}%) does not exceed `
        + `"${stages[i - 1].name}" (${stages[i - 1].pct}%).`);
  if (stages.at(-1).pct !== 100) refuse("CC-02", `The publish stage is 100% — it is set to ${stages.at(-1).pct}%.`);

  // CC-03 — TAT
  const tatBad = stages.filter(s => !isWhole(s.tat) || s.tat < 0 || s.tat > 366);
  if (tatBad.length) refuse("CC-03", `TAT is whole days before posting, 0 to 366: ${tatBad.map(s => s.name).join(", ")}.`);
  for (let i = 1; i < stages.length; i++)
    if (stages[i].tat > stages[i - 1].tat)
      refuse("CC-03", `"${stages[i].name}" is due ${stages[i].tat} days before posting, earlier than "${stages[i - 1].name}" `
        + `(${stages[i - 1].tat} days) which comes before it. TAT can only stay level or shrink along the list.`);
  if (stages.at(-1).tat !== 0) refuse("CC-03", "The publish stage is due on the posting date itself — its TAT is 0.");

  // CC-04 — owners
  const noOwner = stages.filter(s => !s.owner || !one("SELECT id FROM roles WHERE id=?", s.owner));
  if (noOwner.length) refuse("CC-04", `Every stage needs an owner role that exists: ${noOwner.map(s => s.name).join(", ")}.`);

  // CC-05 — dependency on a parent item
  const deps = stages.filter(s => s.kind === "parent");
  if (deps.length > 1) refuse("CC-05", `${type.name} can wait on one parent stage only.`);
  if (stages.some(s => s.kind !== "parent" && s.parent))
    refuse("CC-05", "Only a 'from parent' stage can point at another content type's stage.");
  for (const s of deps) {
    if (!s.parent) refuse("CC-05", `"${s.name}" waits on a parent — choose which stage of which content type.`);
    const ps = one("SELECT * FROM content_stage WHERE id=?", s.parent);
    if (!ps) refuse("CC-05", `"${s.name}" points at a stage that does not exist.`);
    if (ps.type_id === Number(typeId)) refuse("CC-05", `"${s.name}" cannot wait on its own content type.`);
    if (!["work", "publish"].includes(ps.kind))
      refuse("CC-05", `"${s.name}" must wait on a production or publish stage, not on "${ps.name}".`);
    // no circular parents: walk up from the parent type
    for (let t = ps.type_id, hops = 0; t && hops < 20; t = parentTypeOf(t), hops++)
      if (t === Number(typeId)) refuse("CC-05", `${type.name} and the type it waits on would wait on each other.`);
  }

  // CC-06 — removals that another type depends on
  const keep = new Set(stages.filter(s => s.id).map(s => s.id));
  for (const old of all("SELECT * FROM content_stage WHERE type_id=?", typeId)) {
    if (keep.has(old.id)) continue;
    const dependants = all(`SELECT s.name, t.name AS type_name FROM content_stage s JOIN content_type t ON t.id=s.type_id
      WHERE s.parent_stage_id=?`, old.id);
    if (dependants.length) refuse("CC-06", `"${old.name}" cannot be removed: ${dependants.map(d => `${d.type_name} → ${d.name}`)
      .join(", ")} waits on it. Point that stage elsewhere first.`);
  }
  const foreign = stages.filter(s => s.id && !one("SELECT id FROM content_stage WHERE id=? AND type_id=?", s.id, typeId));
  if (foreign.length) refuse("CC-01", "A stage id in the list belongs to another content type.");

  return atomic(() => {
    // park existing seqs out of the way so the UNIQUE(type_id, seq) constraint survives reordering
    run("UPDATE content_stage SET seq = seq + 1000 WHERE type_id=?", typeId);
    for (const old of all("SELECT id FROM content_stage WHERE type_id=?", typeId))
      if (!keep.has(old.id)) run("DELETE FROM content_stage WHERE id=?", old.id);
    for (const s of stages) {
      if (s.id) run(`UPDATE content_stage SET seq=?, name=?, pct=?, tat_days=?, owner_role_id=?, kind=?, parent_stage_id=?
                     WHERE id=?`, s.seq, s.name, s.pct, s.tat, s.owner, s.kind, s.parent, s.id);
      else s.id = Number(run(`INSERT INTO content_stage(type_id,seq,name,pct,tat_days,owner_role_id,kind,parent_stage_id)
                     VALUES(?,?,?,?,?,?,?,?)`, typeId, s.seq, s.name, s.pct, s.tat, s.owner, s.kind, s.parent).lastInsertRowid);
    }
    const applied = applyTemplateToUnstarted(typeId);
    audit("content_stage", Number(typeId), "save", `${type.name}: ${stages.length} stages saved — `
      + stages.map(s => `${s.name} ${s.pct}% / ${s.tat}d`).join(" · ") + `; applied to ${applied} unstarted item(s)`, user.id);
    return { stages: stagesOf(typeId), applied };
  });
}

/** Copy a type's current stage list onto an item. Keeps a topic already mapped. */
function copyStages(itemId, typeId, keepTopic) {
  run("DELETE FROM content_task WHERE content_id=?", itemId);
  for (const s of all("SELECT * FROM content_stage WHERE type_id=? ORDER BY seq", typeId))
    run(`INSERT INTO content_task(content_id,stage_id,seq,name,pct,tat_days,owner_role_id,kind,parent_stage_id,
           done_at,done_on,done_by,auto,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      itemId, s.id, s.seq, s.name, s.pct, s.tat_days, s.owner_role_id, s.kind, s.parent_stage_id,
      ...(s.kind === "topic" && keepTopic ? [keepTopic.done_at, keepTopic.done_on, keepTopic.done_by, keepTopic.auto, keepTopic.note]
        : [null, null, null, 0, null]));
}

/** v1 statuses, for items that existed before stage lists did. */
const LEGACY_DONE = { Planned: ["topic"], Drafted: ["topic"], Scheduled: ["topic", "work", "parent"], Published: KINDS };

function applyTemplateToUnstarted(typeId) {
  let n = 0;
  for (const it of all("SELECT * FROM content WHERE type_id=? AND cancelled_at IS NULL", typeId)) {
    const tasks = all("SELECT * FROM content_task WHERE content_id=? ORDER BY seq", it.id);
    if (!tasks.length) {                                    // a v1 item meeting its first stage list
      copyStages(it.id, typeId, null);
      const kinds = LEGACY_DONE[it.status] || [];
      run(`UPDATE content_task SET done_at=datetime('now'), done_on=?, auto=1, note=? WHERE content_id=? AND kind IN (${
        kinds.map(() => "?").join(",") || "''"})`, it.published_on || today(),
        `Carried from the v1 status "${it.status}" when the stage list was introduced`, it.id, ...kinds);
      n++; continue;
    }
    if (it.published_on || tasks.some(t => t.kind !== "topic" && t.done_at)) continue;   // in production: keeps its copy
    copyStages(it.id, typeId, tasks.find(t => t.kind === "topic" && t.done_at) || null);
    n++;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* the read model — due dates, states and readiness are derived        */
/* ------------------------------------------------------------------ */
const ITEM_SQL = `
SELECT c.*, ct.name AS type_name, a.name AS account_name, a.kind AS account_kind, u.name AS person_name,
  o.name AS offering_name, i.name AS industry_name, p.title AS parent_title, p.date AS parent_date,
  (SELECT COUNT(*) FROM lead_content_touch t WHERE t.content_id=c.id) AS lead_count
FROM content c
LEFT JOIN content_type ct ON ct.id=c.type_id
LEFT JOIN content_account a ON a.id=c.account_id
LEFT JOIN users u ON u.id=c.person_id
LEFT JOIN offering o ON o.id=c.offering_id
LEFT JOIN industry i ON i.id=c.industry_id
LEFT JOIN content p ON p.id=c.parent_id`;

const platformsOf = id => all(`SELECT cp.channel_id, cp.url, ch.name, ch.colour FROM content_platform cp
  JOIN content_channel ch ON ch.id=cp.channel_id WHERE cp.content_id=? ORDER BY ch.sort, ch.name`, id);
const rawTasks = id => all(`SELECT t.*, r.name AS owner_role FROM content_task t LEFT JOIN roles r ON r.id=t.owner_role_id
  WHERE t.content_id=? ORDER BY t.seq`, id);
const parentTask = (parentId, stageId) => parentId && stageId
  ? one("SELECT * FROM content_task WHERE content_id=? AND stage_id=?", parentId, stageId) : null;

function ctxNow(asOf) {
  return { asOf: asOf || today(), weekend: weekendSet(), holidays: holidaySet(),
    soon: Number(setting("content_due_soon_days", 7)) };
}

/** Everything the screens need about one item, computed at read time. */
export function decorate(item, ctx = ctxNow()) {
  if (!item) return null;
  const tasks = rawTasks(item.id);
  const parent = item.parent_id ? one("SELECT id, title, date, cancelled_at FROM content WHERE id=?", item.parent_id) : null;
  let blockedBy = null;
  const out = tasks.map(t => {
    const due = dueDate(item.date, t.tat_days, ctx);
    let state;
    if (t.done_at) state = "done";
    else if (blockedBy) state = "blocked";
    else {
      const pt = t.kind === "parent" ? parentTask(item.parent_id, t.parent_stage_id) : null;
      if (pt && !pt.done_at) state = "waiting";                    // open, and waiting on the parent item
      else if (due < ctx.asOf) state = "overdue";
      else if (daysBetween(ctx.asOf, due) <= ctx.soon) state = "due-soon";
      else state = "upcoming";
    }
    if (!t.done_at && !blockedBy) blockedBy = t.name;
    const pt = t.kind === "parent" ? parentTask(item.parent_id, t.parent_stage_id) : null;
    return { ...t, due, state, late_done: !!(t.done_on && t.done_on > due),
      born_late: !!(item.created_on && item.created_on > due),
      parent_due: pt && parent ? dueDate(parent.date, pt.tat_days, ctx) : null,
      parent_done: pt ? !!pt.done_at : null };
  });
  const done = out.filter(t => t.done_at);
  // A post that went out is ready by definition, including one published before stage lists existed.
  const readiness = item.published_on ? 100 : done.length ? Math.max(...done.map(t => t.pct)) : 0;
  const next = out.find(t => !t.done_at) || null;
  const dep = out.find(t => t.kind === "parent");
  const state = item.cancelled_at ? "Cancelled"
    : item.published_on ? "Published"
    : !out.length ? "No stage list"
    : !out[0].done_at ? "Open slot"
    : out.filter(t => t.kind !== "publish").every(t => t.done_at) ? "Ready"
    : "In production";
  const flags = [];
  if (item.orphaned) flags.push("Its target was revised after work started");
  if (out.some(t => t.state === "overdue")) flags.push("Overdue stage");
  if (dep && !dep.done_at && parent?.cancelled_at) flags.push("Parent item was cancelled");
  if (dep && !dep.done_at && !item.parent_id) flags.push("No parent item linked");
  if (dep && dep.parent_due && dep.parent_due > dep.due && !dep.done_at) flags.push("Parent stage is due after this item needs it");
  return { ...item, title: item.title ?? null, state, readiness, tasks: out, next_task: next,
    platforms: platformsOf(item.id), flags, moved: !!(item.slot_date && item.slot_date !== item.date) };
}

export const getItem = (id, ctx) => decorate(one(`${ITEM_SQL} WHERE c.id=?`, id), ctx);
const mustItem = id => one(`${ITEM_SQL} WHERE c.id=?`, id) || gone("Content item not found.");

/* ------------------------------------------------------------------ */
/* creating items                                                      */
/* ------------------------------------------------------------------ */
function assertPlatforms(ids, rule) {
  const bad = ids.filter(p => !one("SELECT id FROM content_channel WHERE id=? AND active=1", p));
  if (bad.length) refuse(rule, `Platform ${bad.join(", ")} is not an active platform.`);
}

function insertItem(user, f) {
  const id = Number(run(`INSERT INTO content(date,title,type_id,channel_id,person_id,account_id,cadence_id,slot_date,
      theme,keyword,offering_id,industry_id,status,created_on,created_at,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'Planned',?,datetime('now'),?)`,
    f.date, f.title || null, f.type_id, f.platforms[0], f.person_id || null, f.account_id, f.cadence_id || null,
    f.slot_date || null, f.theme || null, f.keyword || null, f.offering_id || null, f.industry_id || null,
    today(), user?.id ?? null).lastInsertRowid);
  f.platforms.forEach(p => run("INSERT INTO content_platform(content_id,channel_id) VALUES(?,?)", id, p));
  copyStages(id, f.type_id, null);
  return id;
}

/** CC-20 — an ad-hoc item (outside any target), optionally with its topic and parent. */
export function createItem(user, b) {
  need(user, "crm.content.manage");
  const platforms = [...new Set(listOf(b.platforms).map(Number))];
  const missing = [];
  if (!String(b.date ?? "").trim()) missing.push("Date");
  if (!b.type_id) missing.push("Content type");
  if (!b.account_id) missing.push("Account");
  if (!platforms.length) missing.push("Platform");
  if (missing.length) refuse("CC-20", `A content item needs ${missing.join(", ")}.`);
  if (!validDate(b.date)) refuse("CC-20", `"${b.date}" is not a date. Write it YYYY-MM-DD.`);
  if (b.date < today()) refuse("CC-26", `${b.date} is already past — plan content from today onwards.`);
  const type = one("SELECT * FROM content_type WHERE id=? AND active=1", b.type_id);
  if (!type) refuse("CC-20", "That content type is not active.");
  if (!col("SELECT COUNT(*) FROM content_stage WHERE type_id=?", b.type_id))
    refuse("CC-20", `${type.name} has no stage list yet. Set its stages, readiness and TATs in Setup first.`);
  const acct = one("SELECT * FROM content_account WHERE id=? AND active=1", b.account_id);
  if (!acct) refuse("CC-20", "That account is not active.");
  assertPlatforms(platforms, "CC-20");
  return atomic(() => {
    const id = insertItem(user, { ...b, platforms, person_id: b.person_id || acct.person_id });
    audit("content", id, "create", `${type.name} for ${acct.name} planned on ${b.date}`, user.id);
    if (b.title || b.theme || b.keyword) mapTopic(user, id, b);
    if (b.parent_id) linkParent(user, id, Number(b.parent_id));
    if (b.prompt_id) resolvePrompt(user, Number(b.prompt_id), id);   // a launch prompt from PLM, now planned
    return getItem(id);
  });
}

/* ------------------------------------------------------------------ */
/* cadences — targets that write the calendar                           */
/* ------------------------------------------------------------------ */
function readPattern(b) {
  const weeks = [...new Set(listOf(b.weeks).map(Number))].sort((x, y) => x - y);
  const weekdays = [...new Set(listOf(b.weekdays).map(Number))].sort((x, y) => x - y);
  const perMonth = int(b.per_month);
  if (!isWhole(perMonth) || perMonth < 1) refuse("CC-12", "Posts per month is a whole number of one or more.");
  if (!weekdays.length) refuse("CC-12", "Choose the day of the week the posts go out.");
  if (weekdays.some(d => !isWhole(d) || d < 0 || d > 6)) refuse("CC-12", "A weekday is 0 (Sunday) to 6 (Saturday).");
  if (!weeks.length) refuse("CC-12", "Choose which weeks of the month — for example 1st & 3rd, or 2nd & 4th.");
  if (weeks.some(w => !isWhole(w) || w < 1 || w > 4))
    refuse("CC-12", "Weeks are the 1st to 4th occurrence of the weekday. A 5th exists only in some months, "
      + "so it would change the monthly count.");
  if (weeks.length * weekdays.length !== perMonth) {
    const hint = weekdays.length === 1 && perMonth === 2 ? " — for example the 1st & 3rd, or the 2nd & 4th"
      : weekdays.length === 1 && perMonth === 4 ? " — all four weeks" : "";
    refuse("CC-12", `${perMonth} post${perMonth === 1 ? "" : "s"} a month on ${weekdays.length} weekday`
      + `${weekdays.length === 1 ? "" : "s"} needs ${perMonth / weekdays.length} week${perMonth / weekdays.length === 1 ? "" : "s"}`
      + `${hint}; ${weeks.length} ${weeks.length === 1 ? "is" : "are"} chosen, which gives ${weeks.length * weekdays.length}.`);
  }
  return { perMonth, weeks, weekdays };
}

function readPeriod(b) {
  const start = String(b.start_period ?? "").trim(), end = String(b.end_period ?? "").trim();
  if (!PERIOD_RX.test(start) || !PERIOD_RX.test(end))
    refuse("CC-10", "A target runs from one month to another, each written YYYY-MM.");
  if (start > end) refuse("CC-10", `The target starts in ${start}, after it ends in ${end}.`);
  const max = Number(setting("content_target_max_months", 24));
  if (monthsSpan(start, end) > max) refuse("CC-10", `A target covers at most ${max} months — ${start} to ${end} is ${monthsSpan(start, end)}.`);
  if (end < today().slice(0, 7)) refuse("CC-10", `A target ending in ${end} is entirely in the past.`);
  return { start, end };
}

const patternLabel = c => `${c.per_month}/month · ${listOf(c.weeks).map(w => ORDINAL[w]).join(" & ")} `
  + `${listOf(c.weekdays).map(d => WEEKDAY[d]).join(" & ")}`;

/** The dates a pattern produces, before anything is saved. */
export function previewDates(b) {
  const { weeks, weekdays } = readPattern(b);
  const { start, end } = readPeriod(b);
  const dates = [];
  for (const p of monthsBetween(start, end))
    for (const w of weeks) for (const d of weekdays) dates.push(nthWeekday(+p.slice(0, 4), +p.slice(5, 7), d, w));
  return dates.sort();
}

function assertNoClash(accountId, typeId, pat, per, exceptId) {
  for (const o of all(`SELECT * FROM content_cadence WHERE account_id=? AND type_id=? AND active=1 AND id<>?
      AND start_period<=? AND end_period>=?`, accountId, typeId, exceptId || 0, per.end, per.start)) {
    const w = listOf(o.weeks).map(Number).filter(x => pat.weeks.includes(x));
    const d = listOf(o.weekdays).map(Number).filter(x => pat.weekdays.includes(x));
    if (w.length && d.length)
      refuse("CC-13", `Target #${o.id} (${patternLabel(o)}, ${o.start_period} to ${o.end_period}) already claims the `
        + `${ORDINAL[w[0]]} ${WEEKDAY[d[0]]} for this account and content type. Revise that target instead of adding a second.`);
  }
}

/** Creates the slots a cadence owes and has not yet created. Repeatable. */
export function generate(cadenceId) {
  const c = one("SELECT * FROM content_cadence WHERE id=?", cadenceId) || gone("Target not found.");
  const acct = one("SELECT * FROM content_account WHERE id=?", c.account_id);
  const platforms = all("SELECT channel_id FROM content_cadence_platform WHERE cadence_id=?", c.id).map(r => r.channel_id);
  const ctx = ctxNow();
  const res = { created: 0, existing: 0, skipped_past: 0, born_late: 0, dates: [] };
  if (!c.active) return res;
  for (const p of monthsBetween(c.start_period, c.end_period))
    for (const w of listOf(c.weeks).map(Number)) for (const d of listOf(c.weekdays).map(Number)) {
      const date = nthWeekday(+p.slice(0, 4), +p.slice(5, 7), d, w);
      if (date < ctx.asOf) { res.skipped_past++; continue; }
      if (one("SELECT id FROM content WHERE cadence_id=? AND slot_date=?", c.id, date)) { res.existing++; continue; }
      const id = insertItem(null, { date, slot_date: date, type_id: c.type_id, account_id: c.account_id,
        cadence_id: c.id, platforms, person_id: acct.person_id });
      run("UPDATE content SET created_by=? WHERE id=?", c.created_by, id);
      const first = one("SELECT tat_days FROM content_task WHERE content_id=? ORDER BY seq LIMIT 1", id);
      if (first && dueDate(date, first.tat_days, ctx) < ctx.asOf) res.born_late++;
      res.created++; res.dates.push(date);
    }
  res.dates.sort();
  return res;
}

const roleHolders = roleId => all(`SELECT ur.user_id FROM user_roles ur JOIN users u ON u.id=ur.user_id
  WHERE ur.role_id=? AND u.active=1`, roleId).map(r => r.user_id);

/** CC-10 … CC-13 — everything a new target must satisfy, checked the same way for a preview and a save. */
function checkCadence(b) {
  const missing = [];
  if (!b.account_id) missing.push("Account");
  if (!b.type_id) missing.push("Content type");
  const platforms = [...new Set(listOf(b.platforms).map(Number))];
  if (!platforms.length) missing.push("Platform");
  if (missing.length) refuse("CC-11", `A target needs ${missing.join(", ")}.`);
  const acct = one("SELECT * FROM content_account WHERE id=? AND active=1", b.account_id);
  if (!acct) refuse("CC-11", "That account is not active.");
  const type = one("SELECT * FROM content_type WHERE id=? AND active=1", b.type_id);
  if (!type) refuse("CC-11", "That content type is not active.");
  if (!col("SELECT COUNT(*) FROM content_stage WHERE type_id=?", type.id))
    refuse("CC-11", `${type.name} has no stage list yet, so its slots would have no stages or deadlines. Set it up first.`);
  assertPlatforms(platforms, "CC-11");
  const pat = readPattern(b);
  const per = readPeriod(b);
  assertNoClash(acct.id, type.id, pat, per, null);
  return { acct, type, platforms, pat, per };
}

/**
 * What a target would create, before it is saved: every date, whether it is already past (skipped), and
 * whether its topic deadline has already gone (a slot born late). Refuses exactly as saving would.
 */
export function previewCadence(b) {
  const { type, pat, per } = checkCadence(b);
  const ctx = ctxNow();
  const topicTat = col("SELECT tat_days FROM content_stage WHERE type_id=? ORDER BY seq LIMIT 1", type.id);
  const dates = previewDates({ ...b, per_month: pat.perMonth }).map(date => ({ date,
    past: date < ctx.asOf, born_late: date >= ctx.asOf && dueDate(date, topicTat, ctx) < ctx.asOf }));
  return { pattern: patternLabel({ per_month: pat.perMonth, weeks: pat.weeks.join(","), weekdays: pat.weekdays.join(",") }),
    topic_tat: topicTat, dates };
}

/** CC-10 … CC-14 */
export function saveCadence(user, b) {
  need(user, "content.cadence.manage");
  const { acct, type, platforms, pat, per } = checkCadence(b);

  return atomic(() => {
    const id = Number(run(`INSERT INTO content_cadence(account_id,type_id,per_month,weeks,weekdays,start_period,end_period,
        note,active,replaced_by,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,1,NULL,datetime('now'),?)`,
      acct.id, type.id, pat.perMonth, pat.weeks.join(","), pat.weekdays.join(","), per.start, per.end,
      b.note || null, user.id).lastInsertRowid);
    platforms.forEach(p => run("INSERT INTO content_cadence_platform(cadence_id,channel_id) VALUES(?,?)", id, p));
    const res = generate(id);
    const c = one("SELECT * FROM content_cadence WHERE id=?", id);
    audit("content_cadence", id, "create", `${acct.name} · ${type.name} · ${patternLabel(c)} · ${per.start} to ${per.end}: `
      + `${res.created} slots created, ${res.skipped_past} dates already past, ${res.born_late} inside their topic lead time`, user.id);
    notify(roleHolders(managerRoleId()), null, "content",
      `${res.created} ${type.name} slots added for ${acct.name} (${per.start} to ${per.end}). `
      + (res.born_late ? `${res.born_late} of them are already past their topic deadline.` : "Map their topics before the deadlines."));
    return { cadence: listCadences().find(x => x.id === id), ...res };
  });
}

/** Untouched = nothing recorded against it: no topic, no stage done, no lead, no child. */
const untouched = id => !one(`SELECT c.id FROM content c WHERE c.id=? AND (c.title IS NOT NULL OR c.theme IS NOT NULL
   OR c.keyword IS NOT NULL OR EXISTS(SELECT 1 FROM content_task t WHERE t.content_id=c.id AND t.done_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM lead_content_touch l WHERE l.content_id=c.id)
   OR EXISTS(SELECT 1 FROM lead l WHERE l.primary_content_id=c.id)
   OR EXISTS(SELECT 1 FROM content k WHERE k.parent_id=c.id))`, id);

/** Removes the untouched slots of a cadence from a date on; flags the rest and returns them. */
function releaseSlots(cadenceId, fromDate) {
  const r = { removed: 0, kept: 0, keptIds: [] };
  for (const s of all("SELECT id FROM content WHERE cadence_id=? AND slot_date>=? AND published_on IS NULL AND cancelled_at IS NULL",
    cadenceId, fromDate)) {
    if (untouched(s.id)) { run("DELETE FROM content WHERE id=?", s.id); r.removed++; }
    else { run("UPDATE content SET orphaned=1 WHERE id=?", s.id); r.kept++; r.keptIds.push(s.id); }
  }
  return r;
}

const prevPeriod = p => { let y = +p.slice(0, 4), m = +p.slice(5, 7) - 1; if (!m) { m = 12; y--; } return `${y}-${pad(m)}`; };

/**
 * CC-15 — changes a target from a month onwards. The old target keeps the months before; untouched slots
 * from that month on are replaced; slots someone has already worked on stay, flagged for a decision.
 */
export function reviseCadence(user, id, b) {
  need(user, "content.cadence.manage");
  const old = one("SELECT * FROM content_cadence WHERE id=? AND active=1", id) || gone("Active target not found.");
  const from = String(b.from_period ?? "").trim();
  if (!PERIOD_RX.test(from)) refuse("CC-15", "Say from which month the change applies, written YYYY-MM.");
  if (from < today().slice(0, 7)) refuse("CC-15", `${from} is past. A target can be changed from the current month onwards.`);
  if (from < old.start_period || from > old.end_period)
    refuse("CC-15", `Target #${id} runs ${old.start_period} to ${old.end_period}; ${from} is outside it.`);
  const pat = readPattern({ per_month: b.per_month ?? old.per_month, weeks: b.weeks ?? old.weeks, weekdays: b.weekdays ?? old.weekdays });
  const per = readPeriod({ start_period: from, end_period: b.end_period ?? old.end_period });
  const platforms = b.platforms !== undefined ? [...new Set(listOf(b.platforms).map(Number))]
    : all("SELECT channel_id FROM content_cadence_platform WHERE cadence_id=?", id).map(r => r.channel_id);
  if (!platforms.length) refuse("CC-11", "A target needs at least one platform.");
  assertPlatforms(platforms, "CC-11");
  assertNoClash(old.account_id, old.type_id, pat, per, id);

  return atomic(() => {
    const released = releaseSlots(id, `${from}-01`);
    const newId = Number(run(`INSERT INTO content_cadence(account_id,type_id,per_month,weeks,weekdays,start_period,end_period,
        note,active,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,1,datetime('now'),?)`,
      old.account_id, old.type_id, pat.perMonth, pat.weeks.join(","), pat.weekdays.join(","), per.start, per.end,
      b.note ?? old.note, user.id).lastInsertRowid);
    platforms.forEach(p => run("INSERT INTO content_cadence_platform(cadence_id,channel_id) VALUES(?,?)", newId, p));
    if (from === old.start_period) run("UPDATE content_cadence SET active=0, replaced_by=? WHERE id=?", newId, id);
    else run("UPDATE content_cadence SET end_period=?, replaced_by=? WHERE id=?", prevPeriod(from), newId, id);
    // A worked-on slot on a date the new pattern still wants is carried over rather than duplicated — whether
    // it was flagged just now or by an earlier revision of the same account and content type.
    released.carried = 0;
    for (const date of previewDates({ ...pat, per_month: pat.perMonth, start_period: per.start, end_period: per.end })) {
      const orphan = one(`SELECT id, cadence_id FROM content WHERE orphaned=1 AND account_id=? AND type_id=? AND slot_date=?
        AND cancelled_at IS NULL AND published_on IS NULL ORDER BY id LIMIT 1`, old.account_id, old.type_id, date);
      if (!orphan) continue;
      run("UPDATE content SET cadence_id=?, orphaned=0 WHERE id=?", newId, orphan.id);
      released.carried++;
      if (released.keptIds.includes(orphan.id)) released.kept--;
    }
    delete released.keptIds;
    const res = generate(newId);
    audit("content_cadence", id, "revise", `Target #${id} revised from ${from}: ${patternLabel(old)} → `
      + `${pat.perMonth}/month; ${released.removed} untouched slots replaced, ${released.kept} kept and flagged, `
      + `${res.created} created`, user.id);
    return { old: listCadences().find(x => x.id === id), cadence: listCadences().find(x => x.id === newId), released, ...res };
  });
}

/** Ends a target after a month; untouched slots after it go. */
export function endCadence(user, id, b) {
  need(user, "content.cadence.manage");
  const c = one("SELECT * FROM content_cadence WHERE id=? AND active=1", id) || gone("Active target not found.");
  const last = String(b.last_period ?? "").trim();
  if (!PERIOD_RX.test(last)) refuse("CC-15", "Say the last month the target runs, written YYYY-MM.");
  if (last >= c.end_period) refuse("CC-15", `Target #${id} already ends in ${c.end_period}.`);
  if (last < prevPeriod(today().slice(0, 7))) refuse("CC-15", "A target cannot be ended in the past.");
  return atomic(() => {
    const released = releaseSlots(id, `${last}-32`);           // "-32" sorts after the last day of that month
    delete released.keptIds;
    if (last < c.start_period) run("UPDATE content_cadence SET active=0 WHERE id=?", id);
    else run("UPDATE content_cadence SET end_period=? WHERE id=?", last, id);
    audit("content_cadence", id, "end", `Target #${id} now ends ${last}; ${released.removed} slots removed, ${released.kept} flagged`, user.id);
    return { released };
  });
}

export const listCadences = () => all(`SELECT c.*, a.name AS account_name, t.name AS type_name,
    (SELECT group_concat(ch.name, ', ') FROM content_cadence_platform cp JOIN content_channel ch ON ch.id=cp.channel_id
      WHERE cp.cadence_id=c.id) AS platform_names,
    (SELECT group_concat(cp.channel_id) FROM content_cadence_platform cp WHERE cp.cadence_id=c.id) AS platform_ids,
    (SELECT COUNT(*) FROM content x WHERE x.cadence_id=c.id) AS slots
  FROM content_cadence c JOIN content_account a ON a.id=c.account_id JOIN content_type t ON t.id=c.type_id
  ORDER BY c.active DESC, a.sort, t.sort, c.start_period`).map(c => ({ ...c, pattern: patternLabel(c) }));

/* ------------------------------------------------------------------ */
/* working an item — topic, stages, dependency, publish                 */
/* ------------------------------------------------------------------ */
const assertLive = (it, verb) => {
  if (it.cancelled_at) refuse("CC-28", `"${it.title || "This slot"}" was cancelled on ${it.cancelled_at.slice(0, 10)} and cannot be ${verb}.`);
};
const label = it => it.title ? `"${it.title}"` : `the ${it.type_name || "content"} slot on ${it.date}`;

/** CC-21 — topic, theme and keyword. The topic stage ticks itself once all three are in. */
export function mapTopic(user, id, b) {
  need(user, "crm.content.manage");
  const it = mustItem(id);
  assertLive(it, "edited");
  if (it.published_on) refuse("CC-27", `${label(it)} is published; its topic is part of the record now.`);
  const val = k => (b[k] === undefined ? it[k] : String(b[k] ?? "").trim() || null);
  const next = { title: val("title"), theme: val("theme"), keyword: val("keyword") };
  const topicTask = one("SELECT * FROM content_task WHERE content_id=? AND kind='topic'", id);
  const gaps = [["title", "Topic"], ["theme", "Content theme"], ["keyword", "Keyword"]].filter(([k]) => !next[k]).map(([, l]) => l);
  if (topicTask?.done_at && gaps.length)
    refuse("CC-21", `The topic stage is done, so ${gaps.join(", ")} cannot be cleared. Reopen the topic stage first.`);
  const ref = k => (k in b ? Number(b[k]) || null : it[k]);             // sent empty = cleared
  return atomic(() => {
    run("UPDATE content SET title=?, theme=?, keyword=?, offering_id=?, industry_id=? WHERE id=?",
      next.title, next.theme, next.keyword, ref("offering_id"), ref("industry_id"), id);
    if (next.title !== it.title)
      run("UPDATE lead SET activity=? WHERE primary_content_id=?", next.title, id);   // v1 snapshot kept in step
    audit("content", id, "topic", `Topic mapped for ${it.type_name} on ${it.date}`, user.id, "title", it.title, next.title);
    // The three fields are the evidence, so the stage ticks itself — for its owner role or a content
    // administrator. Anyone else's mapping waits for the owner to confirm it with completeTask().
    if (topicTask && !topicTask.done_at && !gaps.length
        && (user.roleIds.includes(topicTask.owner_role_id) || can(user, "content.setup.manage"))) {
      markDone(topicTask, user, false, null);
      syncDependents(id);
    }
    return getItem(id);
  });
}

function markDone(task, user, auto, note) {
  run("UPDATE content_task SET done_at=datetime('now'), done_on=?, done_by=?, auto=?, note=? WHERE id=?",
    today(), user?.id ?? null, auto ? 1 : 0, note || null, task.id);
}

/**
 * CC-24 — a child's 'from parent' stage ticks itself once (a) every earlier stage of the child is done and
 * (b) the parent's named stage is done. Called after anything that could make both true.
 */
function syncDependents(itemId) {
  const it = one("SELECT * FROM content WHERE id=?", itemId);
  if (!it || it.cancelled_at || !it.parent_id) return 0;
  const dep = one("SELECT * FROM content_task WHERE content_id=? AND kind='parent' AND done_at IS NULL", itemId);
  if (!dep) return 0;
  if (one("SELECT id FROM content_task WHERE content_id=? AND seq<? AND done_at IS NULL", itemId, dep.seq)) return 0;
  const pt = parentTask(it.parent_id, dep.parent_stage_id);
  if (!pt?.done_at) return 0;
  const parent = one("SELECT title FROM content WHERE id=?", it.parent_id);
  markDone(dep, null, true, `Ticked automatically: "${parent.title || "parent"}" — ${pt.name} done on ${pt.done_on}`);
  const nxt = one("SELECT * FROM content_task WHERE content_id=? AND seq>? ORDER BY seq LIMIT 1", itemId, dep.seq);
  if (nxt?.owner_role_id) notify(roleHolders(nxt.owner_role_id), null, "content",
    `${dep.name} for "${it.title || it.date}" is in — "${nxt.name}" can start.`);
  audit("content_task", dep.id, "auto", `${dep.name} completed from the parent item`, null);
  return 1;
}

/** Re-checks every live child of an item after one of its stages changes. */
const syncChildren = itemId => all("SELECT id FROM content WHERE parent_id=? AND cancelled_at IS NULL", itemId)
  .reduce((n, r) => n + syncDependents(r.id), 0);

/** CC-23 — the owner role decides; a content administrator may act for it, and that is recorded. */
function ownerCheck(user, task) {
  if (user.roleIds.includes(task.owner_role_id)) return false;
  if (can(user, "content.setup.manage")) return true;
  const owner = col("SELECT name FROM roles WHERE id=?", task.owner_role_id);
  deny(`"${task.name}" belongs to the ${owner} role, which you do not hold.`, "CC-23");
}

/** CC-22, CC-23, CC-24, CC-21 */
export function completeTask(user, taskId, b = {}) {
  need(user, "crm.content.manage");
  const task = one("SELECT * FROM content_task WHERE id=?", taskId) || gone("Stage not found.");
  const it = mustItem(task.content_id);
  assertLive(it, "worked on");
  if (task.done_at) refuse("CC-22", `"${task.name}" is already done (${task.done_on}).`);
  if (task.kind === "publish") refuse("CC-25", "Publishing records the date and the post links — use Publish.");
  const override = ownerCheck(user, task);
  const open = one("SELECT name FROM content_task WHERE content_id=? AND seq<? AND done_at IS NULL ORDER BY seq LIMIT 1",
    task.content_id, task.seq);
  if (open) refuse("CC-22", `"${open.name}" comes before "${task.name}" and is still open.`);
  if (task.kind === "topic") {
    const gaps = [["title", "Topic"], ["theme", "Content theme"], ["keyword", "Keyword"]].filter(([k]) => !it[k]).map(([, l]) => l);
    if (gaps.length) refuse("CC-21", `The topic stage needs ${gaps.join(", ")} before it is done.`);
  }
  if (task.kind === "parent") {
    const pt = parentTask(it.parent_id, task.parent_stage_id);
    if (pt && !pt.done_at)
      refuse("CC-24", `"${task.name}" ticks itself when "${it.parent_title}" reaches "${pt.name}" — it cannot be ticked by hand.`);
    if (!it.parent_id && String(b.note ?? "").trim().length < reasonMin())
      refuse("CC-24", `No parent item is linked. Link the one it is cut from, or say in at least ${reasonMin()} characters `
        + "where the material came from.");
  }
  return atomic(() => {
    markDone(task, user, false, b.note || (override ? "Completed by a content administrator on behalf of the owner role" : null));
    audit("content_task", task.id, override ? "override" : "done", `${task.name} done for ${label(it)}`, user.id);
    syncDependents(it.id);
    syncChildren(it.id);
    return getItem(it.id);
  });
}

/** CC-27 — reopening cascades forward, and into children that took their stage from this one. */
export function reopenTask(user, taskId, b = {}) {
  need(user, "crm.content.manage");
  const task = one("SELECT * FROM content_task WHERE id=?", taskId) || gone("Stage not found.");
  const it = mustItem(task.content_id);
  assertLive(it, "reopened");
  if (it.published_on) refuse("CC-27", `${label(it)} is published; its stages are closed.`);
  if (!task.done_at) refuse("CC-27", `"${task.name}" is not done.`);
  if (String(b.reason ?? "").trim().length < reasonMin())
    refuse("CC-27", `Reopening "${task.name}" needs a reason of at least ${reasonMin()} characters.`);
  return atomic(() => {
    const reopened = reopenFrom(task.content_id, task.seq);
    audit("content_task", task.id, "reopen", `${task.name} reopened for ${label(it)} (${reopened} stage(s)): ${b.reason}`, user.id);
    return getItem(it.id);
  });
}

function reopenFrom(itemId, seq) {
  const affected = all("SELECT * FROM content_task WHERE content_id=? AND seq>=? AND done_at IS NOT NULL", itemId, seq);
  run("UPDATE content_task SET done_at=NULL, done_on=NULL, done_by=NULL, auto=0, note=NULL WHERE content_id=? AND seq>=?", itemId, seq);
  let n = affected.length;
  const stageIds = new Set(affected.map(t => t.stage_id).filter(Boolean));
  for (const ch of all("SELECT id FROM content WHERE parent_id=? AND published_on IS NULL AND cancelled_at IS NULL", itemId)) {
    const dep = one("SELECT * FROM content_task WHERE content_id=? AND kind='parent' AND done_at IS NOT NULL AND auto=1", ch.id);
    if (dep && stageIds.has(dep.parent_stage_id)) {
      n += reopenFrom(ch.id, dep.seq);
      const c = one("SELECT title, date FROM content WHERE id=?", ch.id);
      notify(roleHolders(dep.owner_role_id), null, "content",
        `"${c.title || c.date}" lost "${dep.name}" — its parent item's stage was reopened.`);
    }
  }
  return n;
}

/** CC-24 — which item a reel is cut from. */
export function linkParent(user, childId, parentId) {
  need(user, "crm.content.manage");
  const child = mustItem(childId);
  assertLive(child, "linked");
  const dep = one("SELECT * FROM content_task WHERE content_id=? AND kind='parent'", childId);
  if (!dep) refuse("CC-24", `${child.type_name} does not take material from a parent item.`);
  if (dep.done_at) refuse("CC-24", `"${dep.name}" is already done; reopen it before changing the parent.`);
  if (!parentId) {
    return atomic(() => {
      run("UPDATE content SET parent_id=NULL WHERE id=?", childId);
      audit("content", childId, "unlink", `Parent removed from ${label(child)}`, user.id);
      return getItem(childId);
    });
  }
  if (Number(parentId) === Number(childId)) refuse("CC-24", "An item cannot be its own parent.");
  const parent = mustItem(parentId);
  const src = one("SELECT s.*, t.name AS type_name FROM content_stage s JOIN content_type t ON t.id=s.type_id WHERE s.id=?",
    dep.parent_stage_id);
  if (!src) refuse("CC-24", `"${dep.name}" no longer points at a parent stage; fix the ${child.type_name} stage list in Setup.`);
  if (parent.type_id !== src.type_id)
    refuse("CC-24", `${child.type_name} takes its material from a ${src.type_name}; ${label(parent)} is a ${parent.type_name}.`);
  if (parent.cancelled_at) refuse("CC-28", `${label(parent)} was cancelled and cannot be a parent.`);
  const pt = parentTask(parent.id, src.id);
  if (!pt) refuse("CC-24", `${label(parent)} has no "${src.name}" stage — it was planned before that stage existed.`);
  const ctx = ctxNow();
  const needBy = dueDate(child.date, dep.tat_days, ctx), readyBy = dueDate(parent.date, pt.tat_days, ctx);
  if (!pt.done_at && readyBy > needBy)
    refuse("CC-24", `${label(child)} needs "${dep.name}" by ${needBy}, but ${label(parent)} is only due to finish `
      + `"${pt.name}" by ${readyBy}. Pick an earlier parent or move this item later.`);
  return atomic(() => {
    run("UPDATE content SET parent_id=? WHERE id=?", parent.id, childId);
    audit("content", childId, "link", `${label(child)} takes its material from ${label(parent)}`, user.id);
    syncDependents(childId);
    return getItem(childId);
  });
}

const URL_RX = /^https?:\/\/\S+\.\S+/i;

/** CC-25 */
export function publish(user, id, b = {}) {
  need(user, "crm.content.manage");
  const it = mustItem(id);
  assertLive(it, "published");
  if (it.published_on) refuse("CC-25", `${label(it)} was published on ${it.published_on}.`);
  const pubTask = one("SELECT * FROM content_task WHERE content_id=? AND kind='publish'", id);
  if (!pubTask) refuse("CC-20", `${label(it)} has no stage list, so it cannot be published through v2.`);
  const override = ownerCheck(user, pubTask);
  const open = all("SELECT name FROM content_task WHERE content_id=? AND kind<>'publish' AND done_at IS NULL ORDER BY seq", id);
  if (open.length) refuse("CC-25", `${label(it)} cannot be published while ${open.map(t => `"${t.name}"`).join(", ")} `
    + `${open.length === 1 ? "is" : "are"} open.`);
  const on = String(b.published_on || today());
  if (!validDate(on)) refuse("CC-25", `"${on}" is not a date.`);
  if (on > today()) refuse("CC-25", `${on} is in the future. Record publishing on or after the day it happens (BR-32).`);
  const urls = b.urls || {};
  const plats = platformsOf(id);
  const badUrl = Object.entries(urls).filter(([, u]) => u && !URL_RX.test(String(u).trim()));
  if (badUrl.length) refuse("CC-25", `Not a web link: ${badUrl.map(([, u]) => u).join(", ")}.`);
  const foreign = Object.keys(urls).map(Number).filter(ch => !plats.some(p => p.channel_id === ch));
  if (foreign.length) refuse("CC-25", `Platform ${foreign.join(", ")} is not one this item goes out on.`);
  if (setting("content_require_url", "1") === "1") {
    const noLink = plats.filter(p => !(urls[p.channel_id] || p.url)).map(p => p.name);
    if (noLink.length) refuse("CC-25", `Publishing needs the post link for ${noLink.join(", ")}.`);
  }
  return atomic(() => {
    for (const [ch, u] of Object.entries(urls))
      if (u) run("UPDATE content_platform SET url=? WHERE content_id=? AND channel_id=?", String(u).trim(), id, Number(ch));
    run(`UPDATE content SET published_on=?, status='Published',
           url=COALESCE((SELECT url FROM content_platform WHERE content_id=content.id AND channel_id=content.channel_id), url)
         WHERE id=?`, on, id);
    markDone(pubTask, user, false, override ? "Published by a content administrator on behalf of the owner role" : null);
    run("UPDATE content_task SET done_on=? WHERE id=?", on, pubTask.id);
    audit("content", id, "publish", `${label(it)} published on ${on}${on > it.date ? ` (planned ${it.date})` : ""}`, user.id);
    syncChildren(id);
    return getItem(id);
  });
}

/** CC-26 — due dates follow the posting date because they are derived from it. */
export function reschedule(user, id, b = {}) {
  need(user, "crm.content.manage");
  const it = mustItem(id);
  assertLive(it, "moved");
  if (it.published_on) refuse("CC-26", `${label(it)} was published on ${it.published_on}; its date is history.`);
  const date = String(b.date ?? "").trim();
  if (!validDate(date)) refuse("CC-26", "Give the new posting date, written YYYY-MM-DD.");
  if (date === it.date) refuse("CC-26", `${label(it)} is already planned for ${date}.`);
  if (date < today()) refuse("CC-26", `${date} is past. A post can only move to today or later.`);
  const started = col("SELECT COUNT(*) FROM content_task WHERE content_id=? AND done_at IS NOT NULL", id) > 0;
  if (started && String(b.reason ?? "").trim().length < reasonMin())
    refuse("CC-26", `Work has started on ${label(it)}, so moving it needs a reason of at least ${reasonMin()} characters.`);
  const ctx = ctxNow();
  const dep = one("SELECT * FROM content_task WHERE content_id=? AND kind='parent' AND done_at IS NULL", id);
  if (dep && it.parent_id) {
    const pt = parentTask(it.parent_id, dep.parent_stage_id);
    const parent = one("SELECT date, title FROM content WHERE id=?", it.parent_id);
    if (pt && !pt.done_at && dueDate(parent.date, pt.tat_days, ctx) > dueDate(date, dep.tat_days, ctx))
      refuse("CC-24", `On ${date} this item would need "${dep.name}" before "${parent.title}" is due to finish "${pt.name}". `
        + "Move it later, or link a different parent.");
  }
  return atomic(() => {
    run("UPDATE content SET date=? WHERE id=?", date, id);
    const after = getItem(id, ctx);
    const nowOverdue = after.tasks.filter(t => t.state === "overdue").map(t => t.name);
    const warnings = [];
    if (nowOverdue.length) warnings.push(`On ${date}, ${nowOverdue.join(", ")} ${nowOverdue.length === 1 ? "is" : "are"} already overdue.`);
    for (const ch of all("SELECT id FROM content WHERE parent_id=? AND cancelled_at IS NULL AND published_on IS NULL", id)) {
      const c = getItem(ch.id, ctx);
      if (c.flags.includes("Parent stage is due after this item needs it"))
        warnings.push(`${label(c)} now needs its material before this item is due to provide it.`);
    }
    audit("content", id, "reschedule", `${label(it)} moved ${it.date} → ${date}${b.reason ? ": " + b.reason : ""}`, user.id, "date", it.date, date);
    if (warnings.length) notify(roleHolders(managerRoleId()), null, "content", `${label(it)} moved to ${date}. ${warnings.join(" ")}`);
    return { ...after, warnings };
  });
}

/** CC-28 */
export function cancelItem(user, id, b = {}) {
  need(user, "crm.content.manage");
  const it = mustItem(id);
  assertLive(it, "cancelled again");
  if (it.published_on) refuse("CC-28", `${label(it)} was published on ${it.published_on} and cannot be cancelled.`);
  if (String(b.reason ?? "").trim().length < reasonMin())
    refuse("CC-28", `Cancelling needs a reason of at least ${reasonMin()} characters — a missed slot is part of the record.`);
  return atomic(() => {
    run("UPDATE content SET cancelled_at=datetime('now'), cancel_reason=? WHERE id=?", String(b.reason).trim(), id);
    const kids = all("SELECT id, title, date FROM content WHERE parent_id=? AND cancelled_at IS NULL AND published_on IS NULL", id);
    if (kids.length) notify(roleHolders(managerRoleId()), null, "content",
      `${label(it)} was cancelled. ${kids.length} item(s) cut from it need a new parent: ${kids.map(k => k.title || k.date).join(", ")}.`);
    audit("content", id, "cancel", `${label(it)} cancelled: ${b.reason}`, user.id);
    return { ...getItem(id), children_flagged: kids.length };
  });
}

/** CC-29 */
export function deleteItem(user, id) {
  need(user, "crm.content.manage");
  const it = mustItem(id);
  if (it.cadence_id) refuse("CC-29", `${label(it)} is a slot from target #${it.cadence_id}. Cancel it with a reason instead — `
    + "a missed slot has to stay visible against the target.");
  const leads = col("SELECT COUNT(*) FROM lead_content_touch WHERE content_id=?", id)
    + col("SELECT COUNT(*) FROM lead WHERE primary_content_id=? AND id NOT IN (SELECT lead_id FROM lead_content_touch WHERE content_id=?)", id, id);
  if (leads) refuse("CC-29", `${label(it)} is attributed to ${leads} lead${leads === 1 ? "" : "s"} and cannot be deleted (BR-34).`);
  const kids = col("SELECT COUNT(*) FROM content WHERE parent_id=?", id);
  if (kids) refuse("CC-29", `${kids} item(s) are cut from ${label(it)}. Re-link them first.`);
  return atomic(() => {
    // A launch prompt this item answered is open again: its launch content is no longer planned.
    const reopened = run("UPDATE content_prompt SET status='Open', content_id=NULL, resolved_by=NULL, resolved_at=NULL WHERE content_id=?", id).changes;
    run("DELETE FROM content WHERE id=?", id);
    audit("content", id, "delete", `${label(it)} deleted${reopened ? "; its launch prompt is open again" : ""}`, user.id);
    return { ok: true, prompt_reopened: reopened > 0 };
  });
}

/* ------------------------------------------------------------------ */
/* metrics — many per post, per platform, dated                        */
/* ------------------------------------------------------------------ */
/** CC-30, CC-31 — every problem in the batch is named, then nothing or everything is written. */
export function recordMetrics(user, id, b = {}) {
  need(user, "crm.content.manage");
  const it = mustItem(id);
  if (!it.published_on) refuse("CC-30", `${label(it)} is not published yet, so there is nothing to measure.`);
  const plats = platformsOf(id);
  const ch = Number(b.channel_id);
  const plat = plats.find(p => p.channel_id === ch);
  if (!plat) refuse("CC-30", `Choose one of the platforms this item went out on: ${plats.map(p => p.name).join(", ")}.`);
  const on = String(b.captured_on || today());
  if (!validDate(on)) refuse("CC-30", `"${on}" is not a date.`);
  if (on < it.published_on) refuse("CC-30", `Figures dated ${on} would be from before the post went out on ${it.published_on}.`);
  if (on > today()) refuse("CC-30", `${on} is in the future.`);
  const entries = Object.entries(b.values || {}).filter(([, v]) => !(v === "" || v === null || v === undefined));
  if (!entries.length) refuse("CC-30", "Enter at least one figure.");
  const problems = [];
  const rows = entries.map(([mid, raw]) => {
    const m = one("SELECT * FROM content_metric WHERE id=?", Number(mid));
    if (!m) { problems.push(`metric ${mid} does not exist`); return null; }
    if (!m.active) problems.push(`${m.name} is no longer tracked`);
    const scope = all("SELECT channel_id FROM content_metric_platform WHERE metric_id=?", m.id).map(r => r.channel_id);
    if (scope.length && !scope.includes(ch)) problems.push(`${m.name} is not reported by ${plat.name}`);
    const v = int(raw);
    if (!isWhole(v) || v < 0) problems.push(`${m.name} must be a whole number of zero or more ("${raw}")`);
    return { m, v };
  });
  if (problems.length) refuse("CC-30", `Nothing was saved: ${problems.join("; ")}.`);
  return atomic(() => {
    for (const { m, v } of rows) {
      const prev = one(`SELECT value FROM content_metric_value WHERE content_id=? AND channel_id=? AND metric_id=? AND captured_on=?`,
        id, ch, m.id, on);
      run(`INSERT INTO content_metric_value(content_id,channel_id,metric_id,captured_on,value,source,recorded_at,recorded_by)
           VALUES(?,?,?,?,?,'manual',datetime('now'),?)
           ON CONFLICT(content_id,channel_id,metric_id,captured_on) DO UPDATE SET value=excluded.value,
             source='manual', recorded_at=excluded.recorded_at, recorded_by=excluded.recorded_by`, id, ch, m.id, on, v, user.id);
      audit("content_metric_value", id, prev ? "replace" : "record", `${label(it)} · ${plat.name} · ${m.name} on ${on}`,
        user.id, m.name, prev ? prev.value : null, v);
    }
    return metricsOf(id);
  });
}

/** The latest figure per platform and metric, plus the full history. */
export function metricsOf(id) {
  const history = all(`SELECT v.*, m.name AS metric, ch.name AS platform FROM content_metric_value v
    JOIN content_metric m ON m.id=v.metric_id JOIN content_channel ch ON ch.id=v.channel_id
    WHERE v.content_id=? ORDER BY ch.sort, m.sort, v.captured_on`, id);
  const latest = {};
  for (const h of history) latest[`${h.channel_id}:${h.metric_id}`] = h;
  return { latest: Object.values(latest), history };
}

const captureDays = () => listOf(setting("content_metric_capture_days", "7,30")).map(Number).filter(n => isWhole(n) && n > 0);

/* ------------------------------------------------------------------ */
/* the Content Manager's work list                                     */
/* ------------------------------------------------------------------ */
const STATE_ORDER = { overdue: 0, "due-soon": 1, upcoming: 2, waiting: 3, blocked: 4 };

/**
 * Open stages of live items, plus metric captures owed on published ones. scope 'mine' keeps what the
 * user's roles own; 'all' is everything.
 */
export function taskList(user, { scope = "mine", asOf } = {}) {
  need(user, "crm.content.manage");
  const ctx = ctxNow(asOf);
  const mine = t => scope !== "mine" || user.roleIds.includes(t.owner_role_id);
  const out = [];
  for (const row of all(`${ITEM_SQL} WHERE c.cancelled_at IS NULL AND c.published_on IS NULL
      AND EXISTS(SELECT 1 FROM content_task t WHERE t.content_id=c.id AND t.done_at IS NULL) ORDER BY c.date`)) {
    const it = decorate(row, ctx);
    for (const t of it.tasks)
      if (!t.done_at && mine(t)) out.push({ kind: "stage", task_id: t.id, task_kind: t.kind, item_id: it.id, item: it.title,
        date: it.date, type: it.type_name, account_id: it.account_id, account: it.account_name, stage: t.name,
        owner_role_id: t.owner_role_id, owner_role: t.owner_role, due: t.due, state: t.state, born_late: t.born_late,
        readiness: it.readiness, flags: it.flags, has_parent: !!it.parent_id,
        blocked_by: t.state === "blocked" ? it.next_task?.name : null });
  }
  const mgr = managerRoleId(), mgrName = col("SELECT name FROM roles WHERE id=?", mgr);
  if (scope !== "mine" || user.roleIds.includes(mgr)) {
    for (const row of all(`${ITEM_SQL} WHERE c.published_on IS NOT NULL AND c.cancelled_at IS NULL`)) {
      const plats = platformsOf(row.id);
      for (const d of captureDays()) {
        const due = addDays(row.published_on, d);
        if (daysBetween(ctx.asOf, due) > ctx.soon) continue;      // not yet in view
        const missing = plats.filter(p => !one(`SELECT 1 FROM content_metric_value WHERE content_id=? AND channel_id=?
          AND captured_on>=?`, row.id, p.channel_id, due)).map(p => p.name);
        if (!missing.length) continue;
        out.push({ kind: "metrics", task_id: null, item_id: row.id, item: row.title, date: row.date, type: row.type_name,
          account_id: row.account_id, account: row.account_name, stage: `Capture day-${d} figures — ${missing.join(", ")}`,
          owner_role_id: mgr, owner_role: mgrName,
          due, state: due < ctx.asOf ? "overdue" : "due-soon", born_late: false, readiness: 100, flags: [] });
      }
    }
  }
  return out.sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || a.due.localeCompare(b.due) || a.item_id - b.item_id);
}

/** Requirement 2 — every slot inside the look-ahead needs its topic, theme and keyword. */
export function topicGaps({ asOf, horizon } = {}) {
  const ctx = ctxNow(asOf);
  const h = Number(horizon ?? setting("content_topic_horizon_days", 60));
  const until = addDays(ctx.asOf, h);
  return all(`${ITEM_SQL} WHERE c.cancelled_at IS NULL AND c.published_on IS NULL AND c.date<=?
      AND EXISTS(SELECT 1 FROM content_task t WHERE t.content_id=c.id AND t.kind='topic' AND t.done_at IS NULL)
      ORDER BY c.date`, until)
    .map(r => decorate(r, ctx))
    .map(it => ({ id: it.id, date: it.date, type: it.type_name, account_id: it.account_id, account: it.account_name,
      platforms: it.platforms.map(p => p.name), title: it.title, theme: it.theme, keyword: it.keyword,
      topic_due: it.tasks[0].due, state: it.tasks[0].state, born_late: it.tasks[0].born_late,
      topic_task_id: it.tasks[0].id, topic_owner_role_id: it.tasks[0].owner_role_id, topic_owner_role: it.tasks[0].owner_role }));
}

/** The Map topics screen: the look-ahead, and how many open slots lie beyond it. */
export function topicView() {
  const horizon = Number(setting("content_topic_horizon_days", 60)), until = addDays(today(), horizon);
  return { horizon, until, rows: topicGaps(),
    later: col(`SELECT COUNT(*) FROM content c WHERE c.cancelled_at IS NULL AND c.published_on IS NULL AND c.date>?
      AND EXISTS(SELECT 1 FROM content_task t WHERE t.content_id=c.id AND t.kind='topic' AND t.done_at IS NULL)`, until) };
}

/* ------------------------------------------------------------------ */
/* calendar, scorecard and metrics views                               */
/* ------------------------------------------------------------------ */
const monthRange = p => [`${p}-01`, `${p}-32`];

export function calendarMonth(period, f = {}, asOf) {
  if (!PERIOD_RX.test(period)) refuse("CC-10", "A month is written YYYY-MM.");
  const ctx = ctxNow(asOf);
  const [a, z] = monthRange(period);
  return all(`${ITEM_SQL} WHERE c.date>=? AND c.date<? ORDER BY c.date, a.sort, ct.sort, c.id`, a, z)
    .map(r => decorate(r, ctx))
    .filter(it => (!f.account_id || it.account_id === Number(f.account_id))
      && (!f.type_id || it.type_id === Number(f.type_id))
      && (!f.channel_id || it.platforms.some(p => p.channel_id === Number(f.channel_id)))
      && (!f.state || it.state === f.state));
}

/**
 * Target against actual for one month, per account and content type. The target is the plan (the
 * cadences covering the month), so a cancelled slot is a miss, not a smaller target.
 */
export function scorecard(period, asOf) {
  if (!PERIOD_RX.test(period)) refuse("CC-10", "A month is written YYYY-MM.");
  const ctx = ctxNow(asOf);
  const [a, z] = monthRange(period);
  const key = (acc, typ) => `${acc}:${typ}`;
  const rows = {};
  const row = (acc, typ) => (rows[key(acc, typ)] ||= {
    account_id: acc, type_id: typ, account: col("SELECT name FROM content_account WHERE id=?", acc),
    type: col("SELECT name FROM content_type WHERE id=?", typ),
    target: 0, planned: 0, topics: 0, published: 0, on_time: 0, cancelled: 0, moved: 0, readiness_sum: 0, overdue_items: 0 });
  for (const c of all(`SELECT account_id, type_id, SUM(per_month) AS n FROM content_cadence
      WHERE active=1 AND start_period<=? AND end_period>=? GROUP BY account_id, type_id`, period, period))
    row(c.account_id, c.type_id).target = c.n;
  for (const r of all(`${ITEM_SQL} WHERE (c.date>=? AND c.date<?) OR (c.published_on>=? AND c.published_on<?)`, a, z, a, z)) {
    const it = decorate(r, ctx);
    const x = row(it.account_id, it.type_id);
    const inMonth = it.date >= a && it.date < z;
    if (inMonth && it.cancelled_at) x.cancelled++;
    if (inMonth && !it.cancelled_at) {
      x.planned++; x.readiness_sum += it.readiness;
      if (it.tasks[0]?.kind === "topic" && it.tasks[0].done_at) x.topics++;
      if (it.moved) x.moved++;
      if (it.tasks.some(t => t.state === "overdue")) x.overdue_items++;
    }
    if (it.published_on && it.published_on >= a && it.published_on < z) {
      x.published++;
      if (it.published_on <= it.date) x.on_time++;
    }
  }
  return Object.values(rows).map(({ readiness_sum, ...x }) => ({
    ...x, avg_readiness: x.planned ? Math.round(readiness_sum / x.planned) : 0,
    achievement_pct: x.target ? Math.round(x.published / x.target * 100) : null,
    gap: Math.max(0, x.target - x.published)
  })).sort((p, q) => p.account.localeCompare(q.account) || p.type.localeCompare(q.type));
}

/** Latest figures of the posts published in a month, summed per account, platform and metric. */
export function metricsSummary(period) {
  const [a, z] = monthRange(period);
  return all(`WITH latest AS (
      SELECT v.content_id, v.channel_id, v.metric_id, v.value,
        ROW_NUMBER() OVER (PARTITION BY v.content_id, v.channel_id, v.metric_id ORDER BY v.captured_on DESC) AS rn
      FROM content_metric_value v)
    SELECT a.name AS account, ch.name AS platform, m.name AS metric, SUM(l.value) AS total, COUNT(DISTINCT l.content_id) AS posts
    FROM latest l JOIN content c ON c.id=l.content_id
    JOIN content_account a ON a.id=c.account_id JOIN content_channel ch ON ch.id=l.channel_id
    JOIN content_metric m ON m.id=l.metric_id
    WHERE l.rn=1 AND c.published_on>=? AND c.published_on<?
    GROUP BY a.id, ch.id, m.id ORDER BY a.sort, ch.sort, m.sort`, a, z);
}

/**
 * The lead's Activity Name picker, v2 edition: one entry per titled, live item per platform, so a post
 * that went to LinkedIn and YouTube can be found under either. Open slots have no title and are excluded.
 */
export const pickableContent = () => all(`SELECT c.id, c.title, c.date, c.published_on, cp.channel_id, ch.name AS channel_name,
    ct.name AS type_name, a.name AS account_name
  FROM content c JOIN content_platform cp ON cp.content_id=c.id JOIN content_channel ch ON ch.id=cp.channel_id
  LEFT JOIN content_type ct ON ct.id=c.type_id LEFT JOIN content_account a ON a.id=c.account_id
  WHERE c.title IS NOT NULL AND c.cancelled_at IS NULL ORDER BY c.date DESC, ch.sort`)
  .map(r => ({ value: r.id, group: r.channel_id, label: `${r.title} — ${r.date}`,
    hint: `${r.channel_name} · ${r.type_name} · ${r.account_name} · ${r.published_on ? "Published" : "Planned"}` }));

/* ------------------------------------------------------------------ */
/* what the application's screens read                                  */
/* ------------------------------------------------------------------ */
const useCount = (table, id) => usesOf(table, id).reduce((n, [k]) => n + k, 0);

/** Everything the Content Calendar draws its forms, filters and navigation from, in one read. */
export function contentBootstrap(user) {
  const work = can(user, "crm.content.manage");
  return {
    today: today(),
    types: all("SELECT * FROM content_type ORDER BY sort, name")
      .map(t => ({ ...t, stages: stagesOf(t.id), uses: useCount("content_type", t.id) })),
    platforms: all("SELECT * FROM content_channel ORDER BY sort, name")
      .map(p => ({ ...p, uses: useCount("content_channel", p.id) })),
    accounts: listAccounts().map(a => ({ ...a, uses: col("SELECT COUNT(*) FROM content WHERE account_id=?", a.id) })),
    metrics: listMetrics(),
    holidays: all("SELECT * FROM content_holiday ORDER BY date"),
    roles: all("SELECT id, name FROM roles ORDER BY sort, name"),
    people: all("SELECT id, name, active FROM users ORDER BY active DESC, name"),
    offerings: all("SELECT id, name, active FROM offering ORDER BY sort, name"),
    industries: all("SELECT id, name, active FROM industry ORDER BY sort, name"),
    settings: rulesOf(), rules: RULES, kinds: KINDS,
    can: { work, cadence: can(user, "content.cadence.manage"), setup: can(user, "content.setup.manage") },
    badges: {
      topics: topicGaps().length,
      overdue: work ? taskList(user, { scope: "mine" }).filter(t => t.state === "overdue").length : 0,
      prompts: col("SELECT COUNT(*) FROM content_prompt WHERE status='Open'")
    }
  };
}

/** One month of the calendar, and the target the active cadences set for it. Filtering is the screen's. */
export const calendarView = period => ({ period, items: calendarMonth(period),
  target: col(`SELECT COALESCE(SUM(per_month),0) FROM content_cadence WHERE active=1 AND start_period<=? AND end_period>=?`,
    period, period),
  targets: col("SELECT COUNT(*) FROM content_cadence WHERE active=1 AND start_period<=? AND end_period>=?", period, period) });

/** The item record: the item, its figures, what it is cut from or could be, what is cut from it, and its trail. */
export function itemDetail(id) {
  const ctx = ctxNow();
  const item = getItem(id, ctx) || gone("Content item not found.");
  const dep = item.tasks.find(t => t.kind === "parent");
  const src = dep?.parent_stage_id ? one("SELECT * FROM content_stage WHERE id=?", dep.parent_stage_id) : null;
  // Candidate parents carry the same test linkParent() applies, so the screen can say which would be refused.
  const parents = src ? all(`SELECT c.id, c.title, c.date, a.name AS account_name, t.done_on, t.tat_days
      FROM content c JOIN content_task t ON t.content_id=c.id AND t.stage_id=?
      LEFT JOIN content_account a ON a.id=c.account_id
      WHERE c.type_id=? AND c.cancelled_at IS NULL AND c.id<>? AND c.date BETWEEN date(?, '-365 days') AND date(?, '+90 days')
      ORDER BY c.date`, src.id, src.type_id, id, item.date, item.date)
    .map(p => { const ready = dueDate(p.date, p.tat_days, ctx);
      return { id: p.id, title: p.title, date: p.date, account_name: p.account_name, stage: src.name,
        done_on: p.done_on, ready_by: ready, fits: !!p.done_on || ready <= dep.due }; }) : [];
  return {
    item, metrics: metricsOf(id), parents, parent_type: src ? col("SELECT name FROM content_type WHERE id=?", src.type_id) : null,
    children: all(`${ITEM_SQL} WHERE c.parent_id=? ORDER BY c.date`, id).map(r => decorate(r, ctx))
      .map(c => ({ id: c.id, title: c.title, date: c.date, state: c.state, readiness: c.readiness, type_name: c.type_name })),
    cadence: item.cadence_id ? listCadences().find(c => c.id === item.cadence_id) || null : null,
    leads: all(`SELECT l.id, l.company, l.lost, t.is_primary, s.name AS stage_name, s.band
      FROM lead_content_touch t JOIN lead l ON l.id=t.lead_id LEFT JOIN pipeline_stage s ON s.id=l.stage_id
      WHERE t.content_id=? ORDER BY t.is_primary DESC, l.company`, id),
    prompt: one("SELECT * FROM content_prompt WHERE content_id=?", id),
    history: all(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
      WHERE (a.entity IN ('content','content_metric_value') AND a.entity_id=?)
         OR (a.entity='content_task' AND a.entity_id IN (SELECT id FROM content_task WHERE content_id=?))
      ORDER BY a.id DESC LIMIT 100`, id, id)
  };
}

/** The header search: topic, theme or keyword, newest first. */
export const searchItems = q => {
  const like = `%${String(q ?? "").trim()}%`;
  return all(`SELECT c.id, c.title, c.date, c.theme, c.keyword, ct.name AS type_name, a.name AS account_name,
      c.published_on, c.cancelled_at FROM content c
    LEFT JOIN content_type ct ON ct.id=c.type_id LEFT JOIN content_account a ON a.id=c.account_id
    WHERE c.title LIKE ? OR c.theme LIKE ? OR c.keyword LIKE ? ORDER BY c.date DESC LIMIT 12`, like, like, like);
};

const MONTH_COLUMNS = ["Date", "Account", "Content type", "Platforms", "Topic", "Content theme", "Keyword", "State",
  "Readiness %", "Next stage", "Next due", "Overdue stages", "Target", "Moved from", "Published on", "Post links"];
/** The month as a spreadsheet — the plan, where each post stands, and the links once it is out. */
export const monthCSV = period => toCSV(MONTH_COLUMNS.map(k => ({ key: k, label: k })), calendarMonth(period).map(it => ({
  "Date": it.date, "Account": it.account_name, "Content type": it.type_name,
  "Platforms": it.platforms.map(p => p.name).join(", "), "Topic": it.title || "", "Content theme": it.theme || "",
  "Keyword": it.keyword || "", "State": it.state, "Readiness %": it.readiness,
  "Next stage": it.published_on ? "" : it.next_task?.name || "", "Next due": it.published_on ? "" : it.next_task?.due || "",
  "Overdue stages": it.tasks.filter(t => t.state === "overdue").map(t => t.name).join(", "),
  "Target": it.cadence_id ? `#${it.cadence_id}` : "extra post", "Moved from": it.moved ? it.slot_date : "",
  "Published on": it.published_on || "", "Post links": it.platforms.filter(p => p.url).map(p => `${p.name}: ${p.url}`).join(" | ")
})));

/**
 * No scheduler exists in the app. The first request of each Dubai day calls this; it notifies each owner
 * role holder once with their overdue and due-soon counts and records the day so it never repeats.
 */
export function dailyDigest(asOf) {
  const day = asOf || today();
  if (setting("content_digest", "1") !== "1" || setting("content_digest_last", "") >= day) return { sent: 0, day, skipped: true };
  let sent = 0;
  const ctx = ctxNow(day);
  const byRole = {};
  for (const row of all(`${ITEM_SQL} WHERE c.cancelled_at IS NULL AND c.published_on IS NULL`))
    for (const t of decorate(row, ctx).tasks) {
      if (t.done_at || !["overdue", "due-soon"].includes(t.state)) continue;
      const r = (byRole[t.owner_role_id] ||= { overdue: 0, soon: 0 });
      t.state === "overdue" ? r.overdue++ : r.soon++;
    }
  const perUser = {};
  for (const [roleId, n] of Object.entries(byRole))
    for (const uid of roleHolders(Number(roleId))) {
      const u = (perUser[uid] ||= { overdue: 0, soon: 0 });
      u.overdue += n.overdue; u.soon += n.soon;
    }
  for (const [uid, n] of Object.entries(perUser)) {
    notify([Number(uid)], null, "content", `Content today: ${n.overdue} stage(s) overdue, ${n.soon} due within `
      + `${ctx.soon} days.`);
    sent++;
  }
  setSetting("content_digest_last", day, "Last day the content digest was sent", "hidden");
  return { sent, day, skipped: false };
}
