// Emits Create_Column payloads for the Catalyst provisioning, in dependency order.
// Used when column creation has to go through the MCP connection rather than a scoped token.
//   node deploy/catalyst-payloads.mjs <table>        one table's payload
//   node deploy/catalyst-payloads.mjs --plan         what remains, in order
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(here, "catalyst-schema.json"), "utf8"));
const idsPath = path.join(here, ".catalyst-ids.json");
const ids = fs.existsSync(idsPath) ? JSON.parse(fs.readFileSync(idsPath, "utf8")) : {};

const CASCADE = /^(product_id|lead_id|pipeline_id|stage_id|template_id|criterion_id|pipeline_stage_id)$/;

const payloadFor = name => {
  const t = schema.tables.find(x => x.table_name === name);
  if (!t) throw new Error("no such table " + name);
  return t.columns.map(c => {
    if (!c.references) {
      const { references, description, ...rest } = c;
      if (rest.data_type === "varchar" && rest.max_length > 255) rest.max_length = 255;
      return rest;
    }
    const parent = ids[c.references.table];
    if (!parent?.id_column) throw new Error(`parent ${c.references.table} id column unknown — do it first`);
    return {
      column_name: c.column_name, data_type: "foreign key",
      parent_table: String(parent.table_id), parent_column: String(parent.id_column),
      constraint_type: CASCADE.test(c.column_name) ? "ON-DELETE-CASCADE" : "ON-DELETE-SET-NULL",
      is_mandatory: c.is_mandatory, search_index_enabled: "false", audit_consent: "false"
    };
  });
};

if (process.argv[2] === "--plan") {
  const done = new Set(Object.keys(ids).filter(k => ids[k].columns_done));
  let ready = [], blocked = [];
  for (const t of schema.tables) {
    if (done.has(t.table_name)) continue;
    const parents = [...new Set(t.columns.filter(c => c.references).map(c => c.references.table))];
    const missing = parents.filter(p => !ids[p]?.id_column);
    (missing.length ? blocked : ready).push(`${t.table_name}${missing.length ? ` (needs ${missing.join(", ")})` : ""}`);
  }
  console.log(`  ready now (${ready.length}): ${ready.join(", ")}`);
  console.log(`\n  blocked (${blocked.length}): ${blocked.join(", ")}`);
} else {
  console.log(JSON.stringify(payloadFor(process.argv[2])));
}
