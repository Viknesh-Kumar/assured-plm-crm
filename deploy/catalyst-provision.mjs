// Creates the Data Store schema in a Catalyst project from deploy/catalyst-schema.json.
// Idempotent: existing tables and columns are left alone, so it is safe to re-run after a schema change,
// and safe to run against the partially provisioned Assured-CRM project.
//
// Verified against the live project: table scope is GLOBAL, one table per call, columns batch as an
// array, varchar caps at 255, and a foreign key points at the parent's application `id` column (not
// its ROWID), which is what keeps ids stable across SQLite and Catalyst.
//
//   CATALYST_PROJECT_ID=...  CATALYST_ORG_ID=...  CATALYST_OAUTH_TOKEN=...  \
//   CATALYST_ENV=Development  CATALYST_DC=com  node deploy/catalyst-provision.mjs
//
// The OAuth token is a Zoho self-client grant for scope
//   ZohoCatalyst.projects.READ,ZohoCatalyst.tables.CREATE,ZohoCatalyst.tables.READ,ZohoCatalyst.columns.CREATE
// Pass --dry-run to print what it would create without touching the project.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry-run");
const { CATALYST_PROJECT_ID: PROJECT, CATALYST_ORG_ID: ORG, CATALYST_OAUTH_TOKEN: TOKEN } = process.env;
const ENV = process.env.CATALYST_ENV || "Development";
const DC = process.env.CATALYST_DC || "com";                 // com | eu | in | com.au | jp
const API = `https://api.catalyst.zoho.${DC}/baas/v1/project/${PROJECT}`;

const schema = JSON.parse(fs.readFileSync(path.join(here, "catalyst-schema.json"), "utf8"));

if (!DRY && (!PROJECT || !ORG || !TOKEN)) {
  console.error(`
  Missing configuration. Set:
    CATALYST_PROJECT_ID   the project id from the Catalyst console URL
    CATALYST_ORG_ID       your Catalyst organisation id
    CATALYST_OAUTH_TOKEN  a Zoho OAuth access token for this project
  Optional: CATALYST_ENV (default Development), CATALYST_DC (default com).

  Run with --dry-run to see the ${schema.tables.length}-table plan without credentials.
`);
  process.exit(2);
}

const headers = {
  Authorization: `Zoho-oauthtoken ${TOKEN}`,
  "Catalyst-org": ORG,
  Environment: ENV,
  "Content-Type": "application/json"
};

// Catalyst ids are 17-digit integers — larger than Number.MAX_SAFE_INTEGER, and the API sends them
// unquoted. A plain JSON.parse silently rounds 94960000000020001 to ...20000, which then addresses a
// table that does not exist. Quote every long bare integer before parsing so ids stay strings.
const parseBigIds = text => {
  try { return JSON.parse(text.replace(/:\s*(\d{16,})(?=\s*[,}\]])/g, ': "$1"')); }
  catch { try { return JSON.parse(text); } catch { return text; } }
};

async function call(method, url, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = parseBigIds(text);
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

const log = (...a) => console.log("  " + a.join(" "));

/* ------------------------------------------------------------------ */
let created = { tables: 0, columns: 0, skipped: 0 };

if (DRY) {
  log(`Dry run — ${schema.tables.length} tables, ` +
      `${schema.tables.reduce((n, t) => n + t.columns.length, 0)} columns, ` +
      `${schema.tables.reduce((n, t) => n + t.columns.filter(c => c.references).length, 0)} foreign keys.`);
  for (const t of schema.tables) log(`  CREATE TABLE ${t.table_name} (${t.columns.map(c => c.column_name).join(", ")})`);
  console.log("");
  process.exit(0);
}

console.log(`\n  Provisioning ${schema.tables.length} tables into Catalyst project ${PROJECT} (${ENV}, .${DC})\n`);

// 1. Existing tables, so the run is idempotent.
const existing = {};
for (const t of (await call("GET", `${API}/table`)).data || []) existing[t.table_name] = t;
log(`${Object.keys(existing).length} table(s) already present.`);

// 2. Tables, in dependency order.
for (const t of schema.tables) {
  if (existing[t.table_name]) { created.skipped++; continue; }
  // Scope is GLOBAL / ORG / USER — "ProjectScope" is rejected. The response is a single object,
  // not an array, and one table is created per call.
  const r = await call("POST", `${API}/table`, { table_name: t.table_name, table_scope: "GLOBAL" });
  existing[t.table_name] = r.data;
  created.tables++;
  log(`created table ${t.table_name}`);
}

// 3. Columns. Foreign keys resolve against the parent table's application id column.
const columnsOf = async tableId =>
  Object.fromEntries(((await call("GET", `${API}/table/${tableId}/column`)).data || [])
    .map(c => [c.column_name, c]));

const colCache = {};
const idColumnOf = async tableName => {
  const tbl = existing[tableName];
  if (!tbl) throw new Error(`parent table ${tableName} was not created`);
  colCache[tableName] ||= await columnsOf(tbl.table_id);
  const parentKey = schema.tables.find(x => x.table_name === tableName)?.columns.find(c => c.column_name === "id")
    ? "id" : Object.keys(colCache[tableName])[0];
  const col = colCache[tableName][parentKey];
  if (!col) throw new Error(`parent table ${tableName} has no ${parentKey} column yet`);
  return { table_id: String(tbl.table_id), column_id: String(col.column_id) };
};

for (const t of schema.tables) {
  const tbl = existing[t.table_name];
  colCache[t.table_name] ||= await columnsOf(tbl.table_id);
  // Plain columns first, so a foreign key can always find the parent's id.
  for (const pass of [0, 1]) {
    const batch = [];
    for (const c of t.columns) {
      const isFk = !!c.references;
      if ((pass === 0) === isFk) continue;
      if (colCache[t.table_name][c.column_name]) { created.skipped++; continue; }
      const { references, description, ...rest } = c;
      // Catalyst caps varchar at 255; anything longer must be `text`.
      if (rest.data_type === "varchar" && rest.max_length > 255) rest.max_length = 255;
      let body = { ...rest, ...(description ? { description } : {}) };
      if (isFk) {
        const parent = await idColumnOf(references.table);
        body = {
          column_name: c.column_name, data_type: "foreign key",
          parent_table: parent.table_id, parent_column: parent.column_id,
          constraint_type: c.column_name.endsWith("_id") && /product_id|lead_id|pipeline_id|stage_id|template_id/.test(c.column_name)
            ? "ON-DELETE-CASCADE" : "ON-DELETE-SET-NULL",
          is_mandatory: c.is_mandatory, search_index_enabled: "false", audit_consent: "false"
        };
      }
      batch.push(body);
      colCache[t.table_name][c.column_name] = { column_name: c.column_name };
      created.columns++;
    }
    // Columns are created in one call per pass — the endpoint takes an array.
    if (batch.length) await call("POST", `${API}/table/${tbl.table_id}/column`, batch);
  }
  log(`${t.table_name.padEnd(24)} ${Object.keys(colCache[t.table_name]).length} columns`);
}

console.log(`\n  Done. ${created.tables} tables and ${created.columns} columns created, ` +
  `${created.skipped} already present.\n`);
console.log("  Composite uniqueness (user_roles, stage_participant, pipeline_industry, lead_content_touch,");
console.log("  lead_field_value, stage_requirement) is enforced in the engine — Catalyst's primary key is ROWID.\n");
