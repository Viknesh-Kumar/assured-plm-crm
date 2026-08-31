// Derives the Catalyst Data Store schema from the live SQLite schema, so the two can never drift.
// `node deploy/catalyst-schema.mjs`         prints the plan
// `node deploy/catalyst-schema.mjs --json`  emits deploy/catalyst-schema.json for the provisioner
//
// Catalyst gives every table an implicit ROWID (bigint, primary key, auto). Our integer primary keys
// therefore become plain int columns carrying the application id, and every foreign key points at the
// parent's application id column rather than at ROWID — which keeps the seeded data portable.
import { db, all } from "../app/db.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** SQLite affinity → Catalyst data type. */
function catalystType(name, sqlType, table) {
  const t = (sqlType || "").toUpperCase();
  if (name === "password_hash") return { data_type: "encrypted text" };
  if (/^(INTEGER|INT)$/.test(t)) return { data_type: "int" };
  if (/REAL|DOUBLE|FLOAT|NUMERIC/.test(t)) return { data_type: "double", decimal_digits: 2 };
  // Dates and timestamps are stored as ISO strings throughout the engine; keep them as text so the
  // round-trip is lossless and no timezone conversion is applied on the way in or out.
  if (/^(TEXT)$/.test(t)) return LONG_TEXT.has(`${table}.${name}`)
    ? { data_type: "text" }
    : { data_type: "varchar", max_length: varcharLength(table, name) };
  return { data_type: "varchar", max_length: 255 };
}

/** Columns that can exceed a varchar and must be Catalyst `text`. */
const LONG_TEXT = new Set([
  "products.problem", "products.closure_reason", "products.next_action", "products.entry_override_reason",
  "products.hold_reason", "stages.purpose", "stages.definition", "stages.entry_condition",
  "stages.exit_condition", "exit_criteria.text", "criterion_status.evidence", "gate_approvals.reason",
  "stage_history.note", "date_revisions.reason", "market_changes.evidence", "owner_changes.reason",
  "kill_requests.reason", "kill_requests.closure_reason", "effort_entries.note", "deployments.note",
  "notifications.text", "audit.old_value", "audit.new_value", "audit.summary", "settings.value",
  "roles.description", "roles.permissions", "lead.lost_reason", "lead.source_override_reason",
  "lead_note.body", "content.theme", "content_prompt.detail", "content_prompt.resolve_note",
  "lead_field_value.value", "lead_field.help", "stage_template.source_ref", "consultations.comment"
]);

const varcharLength = (table, name) => {
  if (/email|url|link|spec_link/.test(name)) return 320;
  if (/name|title|company|client|customer|designation|location|activity|label|theme|ref/.test(name)) return 255;
  if (/_at$|_on$|_date$|date/.test(name)) return 32;
  return 255;
};

/** Tables Catalyst manages itself, or that carry no rows worth migrating. */
const SKIP = new Set(["sqlite_sequence"]);

/**
 * Catalyst refuses a column named with one of its reserved keywords. Probed against the live project:
 * `key` and `date` are refused; `value`, `text`, `type`, `status`, `source`, `track`, `band`, `seq`,
 * `days`, `met`, `period`, `label`, `kind`, `url`, `theme`, `note`, `summary`, `action`, `entity`,
 * `field`, `mode` and `decision` are all accepted.
 *
 * The engine keeps its own names; the adapter translates on the way in and out.
 */
const RESERVED = { key: true, date: true };
const rename = (table, name) => RESERVED[name.toLowerCase()]
  ? ({ settings: "setting_", lead_field: "field_", content: "content_" }[table] || `${table}_`) + name
  : name;

const tables = all(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
                    ORDER BY name`).filter(t => !SKIP.has(t.name));

const plan = [];
for (const t of tables) {
  const cols = all(`PRAGMA table_info(${t.name})`);
  const fks = all(`PRAGMA foreign_key_list(${t.name})`);
  const idx = all(`PRAGMA index_list(${t.name})`);
  const uniques = new Set();
  for (const i of idx.filter(x => x.unique)) {
    const parts = all(`PRAGMA index_info(${i.name})`);
    if (parts.length === 1) uniques.add(parts[0].name);
  }
  plan.push({
    table_name: t.name,
    // A composite primary key in SQLite becomes a unique pair enforced in code on Catalyst,
    // because Catalyst's own ROWID is always the primary key.
    composite_key: cols.filter(c => c.pk).length > 1 ? cols.filter(c => c.pk).map(c => c.name) : null,
    columns: cols.map(c => {
      const fk = fks.find(f => f.from === c.name);
      const type = catalystType(c.name, c.type, t.name);
      const catalystName = rename(t.name, c.name);
      return {
        column_name: catalystName,
        // Present only where Catalyst forced a different name; the adapter maps between the two.
        ...(catalystName !== c.name ? { source_column: c.name } : {}),
        ...type,
        // A single-column SQLite primary key becomes a mandatory, unique application id.
        is_mandatory: String((!!c.notnull && c.dflt_value === null) || (!!c.pk && cols.filter(x => x.pk).length === 1)),
        ...(type.data_type === "text" || type.data_type === "encrypted text"
          ? {} : {
            is_unique: String(uniques.has(c.name) || (!!c.pk && cols.filter(x => x.pk).length === 1)),
            search_index_enabled: "false"
          }),
        audit_consent: "false",
        ...(c.dflt_value !== null && !/CURRENT|datetime|\(/i.test(String(c.dflt_value))
          ? { default_value: String(c.dflt_value).replace(/^'|'$/g, "") } : {}),
        ...(fk ? { references: { table: fk.table, column: fk.to || "id" } } : {}),
        description: c.pk ? "Application identifier (Catalyst ROWID remains the primary key)" : undefined
      };
    })
  });
}

// Parent tables first, so foreign keys can be created in one pass.
const order = [];
const byName = Object.fromEntries(plan.map(t => [t.table_name, t]));
const visit = (name, seen = new Set()) => {
  if (order.includes(name) || seen.has(name)) return;
  seen.add(name);
  for (const c of byName[name]?.columns || [])
    if (c.references && c.references.table !== name) visit(c.references.table, seen);
  if (!order.includes(name)) order.push(name);
};
plan.forEach(t => visit(t.table_name));
const ordered = order.map(n => byName[n]).filter(Boolean);

if (process.argv.includes("--json")) {
  const out = path.join(here, "catalyst-schema.json");
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), tables: ordered }, null, 2));
  console.log(`\n  Wrote ${out}\n  ${ordered.length} tables, ` +
    `${ordered.reduce((n, t) => n + t.columns.length, 0)} columns, ` +
    `${ordered.reduce((n, t) => n + t.columns.filter(c => c.references).length, 0)} foreign keys.\n`);
} else {
  console.log(`\n  Catalyst Data Store plan — ${ordered.length} tables, created in dependency order\n`);
  for (const t of ordered) {
    const fks = t.columns.filter(c => c.references).length;
    console.log(`  ${t.table_name.padEnd(24)} ${String(t.columns.length).padStart(2)} columns` +
      (fks ? `, ${fks} FK` : "") + (t.composite_key ? `, unique on (${t.composite_key.join(", ")})` : ""));
  }
  const types = {};
  ordered.flatMap(t => t.columns).forEach(c => { types[c.data_type] = (types[c.data_type] || 0) + 1; });
  console.log("\n  Column types: " + Object.entries(types).map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log("\n  Run with --json to emit deploy/catalyst-schema.json for the provisioner.\n");
}
