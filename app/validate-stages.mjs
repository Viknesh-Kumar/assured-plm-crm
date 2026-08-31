// Validates the configured stage model against the source workbook's
// "Responsibility - Stage wise" sheet — owner, approver and consulted roles, stage by stage.
// Run with `npm run validate`. Exits non-zero on any mismatch.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "./xlsx.mjs";
import { all, col } from "./db.mjs";
import { seedIfEmpty } from "./seed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = process.env.PLM_TRACKER || path.join(here, "..", "PLM_Product_Portfolio_Tracker.xlsx");
const SHEET = "Responsibility - Stage wise";

seedIfEmpty();

const norm = s => String(s ?? "").trim().replace(/\s+/g, " ");
const roleSet = s => norm(s).split(/\s*,\s*/).filter(x => x && x !== "—").sort();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const wb = readWorkbook(BOOK);
if (!wb[SHEET]) {
  console.error(`\n  Sheet "${SHEET}" not found in ${path.basename(BOOK)}.`);
  console.error(`  Sheets present: ${Object.keys(wb).join(", ")}\n`);
  process.exit(2);
}

const header = wb[SHEET][0].map(norm);
const need = ["Stage", "Owner", "Approver", "Participants"];
const colOf = {};
need.forEach(h => { colOf[h] = header.indexOf(h); });
const missingCols = need.filter(h => colOf[h] < 0);
if (missingCols.length) {
  console.error(`\n  Sheet "${SHEET}" is missing column(s): ${missingCols.join(", ")}\n`);
  process.exit(2);
}

const sheetRows = wb[SHEET].slice(1)
  .filter(r => norm(r[colOf.Stage]))
  .map(r => ({
    stage: norm(r[colOf.Stage]),
    owner: norm(r[colOf.Owner]),
    approver: norm(r[colOf.Approver]),
    consulted: roleSet(r[colOf.Participants])
  }));

const dbRows = all(`SELECT s.seq, s.track, s.name,
    (SELECT name FROM roles WHERE id = s.owner_role_id)    AS owner,
    (SELECT name FROM roles WHERE id = s.approver_role_id) AS approver
  FROM stages s ORDER BY s.track DESC, s.seq`)
  .map(s => ({
    ...s,
    owner: norm(s.owner),
    approver: s.approver ? norm(s.approver) : "NA",
    consulted: all(`SELECT r.name FROM stage_participant sp JOIN roles r ON r.id = sp.role_id
                    WHERE sp.stage_id = (SELECT id FROM stages WHERE track=? AND seq=?)`, s.track, s.seq)
      .map(r => norm(r.name)).sort()
  }));

const results = [];
let failures = 0;

for (const row of sheetRows) {
  const db = dbRows.find(d => d.name.toLowerCase() === row.stage.toLowerCase());
  if (!db) { results.push({ stage: row.stage, issues: ["stage is not configured in the system"] }); failures++; continue; }
  const issues = [];
  if (db.owner !== row.owner) issues.push(`owner: sheet "${row.owner}" · system "${db.owner}"`);
  if (db.approver !== row.approver) issues.push(`approver: sheet "${row.approver}" · system "${db.approver}"`);
  if (!same(db.consulted, row.consulted))
    issues.push(`participants: sheet "${row.consulted.join(", ") || "—"}" · system "${db.consulted.join(", ") || "—"}"`);
  if (issues.length) failures++;
  results.push({ stage: row.stage, track: db.track, seq: db.seq, issues, db, row });
}

const unlisted = dbRows.filter(d => !sheetRows.some(r => r.stage.toLowerCase() === d.name.toLowerCase()));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  Stage responsibility validation — ${path.basename(BOOK)} · sheet "${SHEET}"`);
console.log(`  ${sheetRows.length} stages in the sheet · ${dbRows.length} configured in the system`);
console.log("  Owner moves the stage on · Approver decides · Participants are notified\n");
console.log(`  ${pad("", 4)}${pad("Stage", 22)}${pad("Owner", 17)}${pad("Approver", 17)}${pad("Consulted", 45)}Result`);
console.log("  " + "-".repeat(111));
for (const r of results) {
  const ok = !r.issues.length;
  console.log("  " + pad(ok ? "OK" : "!!", 4) + pad(r.stage, 22) +
    pad(r.row.owner, 17) + pad(r.row.approver, 17) +
    pad(r.row.consulted.join(", ") || "—", 45) + (ok ? "matches" : "MISMATCH"));
  r.issues.forEach(i => console.log("       → " + i));
}
if (unlisted.length) {
  console.log(`\n  Configured but absent from the sheet: ${unlisted.map(u => u.name).join(", ")}`);
}

// The sheet carries no exit criteria, target durations or ageing thresholds; those come from the BRD.
const noCrit = all(`SELECT s.name FROM stages s WHERE s.track='development'
                    AND (SELECT COUNT(*) FROM exit_criteria c WHERE c.stage_id=s.id AND c.active=1)=0`);
if (noCrit.length) console.log(`\n  Gates with no active exit criteria: ${noCrit.map(s => s.name).join(", ")}`);

console.log(failures
  ? `\n  ${failures} stage(s) do not match the sheet. Reconcile in Setup → Stage model, or correct the sheet.\n`
  : `\n  All ${sheetRows.length} stages match the sheet: owner, approver and participants.\n`);
process.exit(failures ? 1 : 0);
