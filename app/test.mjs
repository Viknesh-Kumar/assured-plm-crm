// Self-check: drives the gate engine through a full lifecycle and asserts the business rules
// that are meant to be impossible to bypass. Run with `npm test`. Uses a throwaway database.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `plm-test-${process.pid}.db`);
process.env.PLM_DB = tmp;
process.env.PLM_SEED_PASSWORD = "TestPass@2026";

const db = await import("./db.mjs");
const { seedIfEmpty } = await import("./seed.mjs");
const A = await import("./api.mjs");
const { workingDays, addWorkingDays, verifyPassword, hashPassword } = await import("./lib.mjs");

seedIfEmpty();

// A clean install ships one account — the Product Head. Everything else is created through it,
// which is itself the proof that user and role administration works from that login.
const byEmail = e => A.loadUser(db.col("SELECT id FROM users WHERE email=?", e));
const ADMIN = byEmail(process.env.PLM_ADMIN_EMAIL || "producthead@assured.local");
if (!ADMIN) throw new Error("clean seed did not create the Product Head account");
const mk = (name, email, role) => {
  A.saveUser(ADMIN, null, { name, email, title: name, password: "TestPass@2026",
    role_ids: [db.col("SELECT id FROM roles WHERE name=?", role)] });
  return byEmail(email);
};
const CEO = mk("Chief Executive", "ceo@assured.local", "CEO");
const BH = mk("Business Head", "business.head@assured.local", "Business Head");
const SH = mk("Solutions Head", "solutions.head@assured.local", "Solutions Head");
const FH = mk("Finance Head", "finance.head@assured.local", "Finance Head");
const PH = mk("Projects Head", "projects.head@assured.local", "Projects Head");
const C1 = mk("Consultant One", "consultant1@assured.local", "Solutions Team");
const C2 = mk("Consultant Two", "consultant2@assured.local", "Solutions Team");

let pass = 0;
const throws = (label, rule, fn) => {
  try { fn(); assert.fail(`${label}: expected a rejection but the call succeeded`); }
  catch (e) {
    assert.ok(e instanceof A.HttpError, `${label}: expected HttpError, got ${e.message}`);
    if (rule) assert.ok((e.rule || "").includes(rule) || e.message.includes(rule),
      `${label}: expected rule ${rule}, got "${e.rule}" / "${e.message}"`);
    pass++;
  }
};
const ok = (label, fn) => { const r = fn(); pass++; return r; };

/* ---------- a clean install carries no sample data ---------- */
assert.equal(db.col("SELECT COUNT(*) FROM products"), 0, "clean install: no products");
assert.equal(db.col("SELECT COUNT(*) FROM lead"), 0, "clean install: no leads");
assert.equal(db.col("SELECT COUNT(*) FROM content"), 0, "clean install: no content");
assert.equal(db.col("SELECT COUNT(*) FROM effort_entries"), 0, "clean install: no effort");
assert.equal(db.col("SELECT COUNT(*) FROM deployments"), 0, "clean install: no deployments");
assert.equal(db.col("SELECT COUNT(*) FROM stages"), 14, "clean install: the 14-stage model is configuration, and is seeded");
assert.ok(db.col("SELECT COUNT(*) FROM exit_criteria") >= 26, "clean install: exit criteria are seeded");
assert.ok(ADMIN.permissions.includes("users.manage"), "the Product Head can administer users");
assert.ok(ADMIN.permissions.includes("stagemodel.manage"), "the Product Head can administer the stage model");
assert.ok(ADMIN.permissions.includes("settings.manage"), "the Product Head can administer settings");
assert.ok(ADMIN.permissions.includes("crm.setup.manage"), "the Product Head can administer the CRM");
pass += 10;

/* ---------- lib ---------- */
assert.equal(workingDays("2026-08-24", "2026-08-31", "6,0"), 5, "Mon→Mon is 5 working days");
assert.equal(workingDays("2026-08-28", "2026-08-31", "6,0"), 1, "Fri→Mon skips the weekend");
assert.equal(addWorkingDays("2026-08-28", 1, "6,0"), "2026-08-31");
assert.ok(verifyPassword("hunter22", hashPassword("hunter22")));
assert.ok(!verifyPassword("hunter23", hashPassword("hunter22")));
pass += 5;

/* ---------- BR-04 derived entry, BR-01 identity ---------- */
const a = A.createProduct(SH, {
  name: "Test Ideate Product", problem: "A problem worth solving.", origin: "New Idea", route: "Ideate",
  client_source: "Internal", owner_user_id: C1.id, next_action: "Write the problem statement"
});
assert.equal(a.stage_seq, 1, "BR-04: Ideate enters at gate 1");
const b = A.createProduct(SH, {
  name: "Test Replicate Product", problem: "Proven asset, unproven demand.", origin: "Proven Reusable Solution",
  route: "Replicate", client_source: "Client", owner_user_id: C1.id, next_action: "Validate demand"
});
assert.equal(b.stage_seq, 4, "BR-04: Replicate enters at gate 4");
assert.notEqual(a.code, b.code, "BR-01: identifiers are unique");
assert.match(a.code, /^P-\d{3}$/, "BR-01: format P-nnn");
pass += 4;

throws("BR-34 reference data", "BR-34", () => A.createProduct(SH, {
  name: "Bad route", problem: "x", origin: "New Idea", route: "Freestyle",
  owner_user_id: C1.id, next_action: "n"
}));
throws("FR-01 mandatory fields", "FR-01", () => A.createProduct(SH, { name: "No problem", origin: "New Idea", route: "Ideate" }));

/* ---------- BR-06 / FR-13 submission needs every criterion ---------- */
throws("BR-06 criteria not met", "BR-06", () => A.submitGate(C1, a.id));

const crits = () => db.all("SELECT id FROM exit_criteria WHERE stage_id=(SELECT stage_id FROM products WHERE id=?) ORDER BY seq", a.id);
const markAll = (u, id) => db.all("SELECT id FROM exit_criteria WHERE stage_id=(SELECT stage_id FROM products WHERE id=?) ORDER BY seq", id)
  .forEach(c => A.markCriterion(u, id, { criterion_id: c.id, met: true, evidence: "Evidence recorded for the test run." }));

throws("R-02 evidence required", "evidence", () =>
  A.markCriterion(C1, a.id, { criterion_id: crits()[0].id, met: true, evidence: "" }));

markAll(C1, a.id);
assert.equal(A.getProduct(a.id).gate_ready, true, "FR-14: readiness is 3 of 3");
pass++;

/* ---------- the owner moves the stage on ---------- */
throws("gate.submit permission is still required", "gate.submit", () => A.submitGate(FH, a.id));
throws("only the stage owner may move it on", "responsibility", () => A.submitGate(SH, a.id));
A.submitGate(C1, a.id);
throws("BR-07 wrong approver", "BR-07", () => A.decideGate(SH, a.id, { decision: "Approved" }));
throws("BR-07 stage owner cannot self-approve", "BR-07", () => A.decideGate(C1, a.id, { decision: "Approved" }));

/* ---------- BR-09 separation of duties ---------- */
// Business Head approves gate 1. Have BH mark the final criterion and confirm the approval is then refused.
A.decideGate(BH, a.id, { decision: "Returned", reason: "Return so the separation of duties can be exercised." });
assert.equal(A.getProduct(a.id).status, "Rework", "BR-29: a return sets Rework");
pass++;
A.markCriterion(BH, a.id, { criterion_id: crits()[0].id, met: true, evidence: "Marked by the approver, deliberately." });
A.submitGate(C1, a.id);
throws("BR-09 separation of duties", "BR-09", () => A.decideGate(BH, a.id, { decision: "Approved" }));
throws("criteria are frozen while submitted", "submitted", () =>
  A.markCriterion(C1, a.id, { criterion_id: crits()[0].id, met: false }));
A.decideGate(BH, a.id, { decision: "Returned", reason: "Returned so the stage owner re-marks the final criterion." });
A.markCriterion(C1, a.id, { criterion_id: crits()[0].id, met: true, evidence: "Re-marked by the stage owner." });
A.submitGate(C1, a.id);
A.decideGate(BH, a.id, { decision: "Approved" });
assert.equal(A.getProduct(a.id).stage_seq, 2, "BR-03: advanced to gate 2");
assert.equal(A.getProduct(a.id).status, "Active", "status returns to Active on advancement");
pass += 2;

/* ---------- BR-21 effort at gate ---------- */
markAll(SH, a.id);
throws("BR-21 no effort at stage", "BR-21", () => A.submitGate(SH, a.id));
A.logEffort(C1, a.id, { period: "2026-08", days: 3, consultant_user_id: C1.id });
A.submitGate(SH, a.id);
A.decideGate(BH, a.id, { decision: "Approved" });
assert.equal(A.getProduct(a.id).stage_seq, 3, "advanced to gate 3 — Business Case");
pass++;

/* ---------- participants are notified, never consulted ---------- */
markAll(BH, a.id);
A.logEffort(C1, a.id, { period: "2026-08", days: 4 });
const notifBefore = db.col("SELECT COUNT(*) FROM notifications");
A.submitGate(BH, a.id);
assert.ok(db.col("SELECT COUNT(*) FROM notifications") > notifBefore,
  "participants and the approver are notified when a gate is submitted");
// No consultation is required: the CEO can decide immediately.
A.decideGate(CEO, a.id, { decision: "Approved", reason: "Capacity committed." });
assert.equal(A.getProduct(a.id).stage_seq, 4, "gate 3 is approved with no consultation step");
assert.equal(typeof A.consult, "undefined", "the consultation endpoint no longer exists");
const gate3Participants = db.all(
  "SELECT r.name FROM stage_participant sp JOIN roles r ON r.id=sp.role_id WHERE sp.stage_id=(SELECT id FROM stages WHERE track='development' AND seq=3)")
  .map(r => r.name).sort();
assert.deepEqual(gate3Participants, ["Finance Head", "Solutions Head"],
  "gate 3 lists Finance Head and Solutions Head as participants, per the sheet");
pass += 4;

/* ---------- BR-03 no gate skipping; BR-12 no return to development ---------- */
const seqBefore = A.getProduct(a.id).stage_seq;
throws("market change while in development", "BR-11", () => A.changeMarketState(BH, a.id, { seq: 3, evidence: "x".repeat(30) }));
assert.equal(A.getProduct(a.id).stage_seq, seqBefore);
pass++;

/* ---------- run product b (Replicate) to market ---------- */
const ROLE_USER = { CEO, "Business Head": BH, "Solutions Head": SH, "Solutions Team": C1,
  "Finance Head": FH, "Projects Head": PH };
/** Whoever holds the stage-owner role moves the product on. */
const ownerOf = id => ROLE_USER[A.getProduct(id).stage_owner_role] || C1;
const advance = (id, approverFor) => {
  const p = A.getProduct(id);
  markAll(approverFor.owner, id);
  if (p.stage_seq > 1) A.logEffort(C1, id, { period: "2026-08", days: 2 });
  A.submitGate(ownerOf(id), id);
  const app = A.getProduct(id).approver_role;
  const approver = { CEO, "Business Head": BH, "Solutions Head": SH }[app];
  A.decideGate(approver, id, { decision: "Approved" });
};
while (A.getProduct(b.id).stage_seq < 8) advance(b.id, { owner: C1 });
assert.equal(A.getProduct(b.id).stage_seq, 8, "product b reached gate 8");
pass++;

// BR-11 — gate 8 approval alone is not market entry.
markAll(C1, b.id); A.logEffort(C1, b.id, { period: "2026-08", days: 2 });
A.submitGate(ownerOf(b.id), b.id);
A.decideGate(CEO, b.id, { decision: "Approved" });
assert.equal(A.getProduct(b.id).track, "development", "BR-11: gate 8 approval alone does not enter the market");
pass++;
A.recordDeployment(BH, b.id, { client_ref: "Client Alpha", deployed_on: "2026-08-20", revenue: 90000 });
assert.equal(A.getProduct(b.id).track, "market", "BR-11: first paid deployment enters the market track");
assert.equal(A.getProduct(b.id).stage_name, "Seeding");
pass += 2;

/* ---------- BR-23 revenue confirmation ---------- */
assert.equal(A.getProduct(b.id).revenue, 0, "BR-23: unconfirmed revenue is excluded");
throws("BR-23 wrong role confirms", "revenue.confirm", () =>
  A.confirmRevenue(C1, b.id, db.col("SELECT id FROM deployments WHERE product_id=?", b.id)));
A.confirmRevenue(FH, b.id, db.col("SELECT id FROM deployments WHERE product_id=?", b.id));
assert.equal(A.getProduct(b.id).revenue, 90000, "BR-23: confirmed revenue counts");
pass++;

/* ---------- BR-13 market change needs evidence, no approval queue ---------- */
throws("BR-13 evidence required", "evidence", () => A.changeMarketState(BH, b.id, { seq: 2, evidence: "short" }));
throws("market.change permission", "market.change", () => A.changeMarketState(C1, b.id, { seq: 2, evidence: "y".repeat(30) }));
A.changeMarketState(BH, b.id, { seq: 2, evidence: "Price repeated without discount across three engagements.", review_ref: "Q3 2026 review" });
assert.equal(A.getProduct(b.id).stage_name, "Market Launch");
assert.equal(A.getProduct(b.id).submitted_at, null, "FR-39: market states raise no approval");
pass += 2;

/* ---------- BR-25 closure reason; BR-26 kill approval ---------- */
throws("BR-25 short closure reason", "BR-25", () => A.changeMarketState(CEO, b.id, {
  seq: 6, evidence: "Withdrawal agreed at the quarterly review.", closure_reason: "too short"
}));
throws("BR-26 kill needs a recommendation first", "No kill recommendation", () => A.decideKill(CEO, a.id, { decision: "Approved" }));
throws("BR-26 kill.recommend permission", "kill.recommend", () => A.recommendKill(C1, a.id, { reason: "z".repeat(40) }));
A.recommendKill(BH, a.id, { reason: "Demand did not materialise beyond the original client and the cost to build has doubled." });
throws("BR-26 only the CEO approves", "kill.approve", () => A.decideKill(BH, a.id, { decision: "Approved", closure_reason: "x".repeat(60) }));
throws("BR-25 closure reason length", "BR-25", () => A.decideKill(CEO, a.id, { decision: "Approved", closure_reason: "no" }));
A.decideKill(CEO, a.id, {
  decision: "Approved",
  closure_reason: "Killed at gate 4. Three client conversations produced no willingness to pay beyond the original engagement, and the "
    + "cost to build has risen past the business case. Seven consultant days are written off."
});
const killed = A.getProduct(a.id);
assert.equal(killed.status, "Closed");
assert.ok(killed.closure_reason.length >= 50);
throws("closed products cannot be edited", "closed", () => A.updateProduct(SH, a.id, { name: "Renamed" }));
throws("BR-20 no effort on a closed product", "BR-20", () => A.logEffort(C1, a.id, { period: "2026-08", days: 1 }));
pass += 2;

/* ---------- BR-27 park, BR-24 date revision, BR-30 ageing ---------- */
const c = A.createProduct(SH, {
  name: "Park test", problem: "Needs parking.", origin: "Internal Tool", route: "Ideate",
  owner_user_id: C1.id, next_action: "n"
});
throws("BR-27 park needs a resumption date", "BR-27", () => A.park(BH, c.id, { reason: "Capacity committed elsewhere." }));
throws("product.park permission", "product.park", () => A.park(C1, c.id, { resume_date: "2026-12-01", reason: "Capacity elsewhere." }));
A.park(BH, c.id, { resume_date: "2026-12-01", reason: "Delivery capacity committed to two client programmes." });
assert.equal(A.getProduct(c.id).status, "On Hold");
throws("BR-27 cannot submit while parked", "Resume", () => A.submitGate(C1, c.id));
const ageBefore = A.getProduct(c.id).age_days;
A.reviseDate(SH, c.id, { new_date: "2027-01-15", reason: "Resumption pushed to the new year." });
assert.equal(A.getProduct(c.id).age_days, ageBefore, "BR-30: a date revision does not reset time in stage");
assert.equal(A.getProduct(c.id).revisions, 1, "BR-24: the revision count is derived from history");
A.resume(BH, c.id);
assert.equal(A.getProduct(c.id).status, "Active");
pass += 4;

/* ---------- BR-05 entry override ---------- */
const d2 = A.createProduct(SH, {
  name: "Override test", problem: "Proven asset.", origin: "Proven Reusable Solution", route: "Replicate",
  owner_user_id: C1.id, next_action: "n"
});
assert.equal(A.getProduct(d2.id).stage_seq, 4);
throws("BR-05 override permission", "entry.override", () => A.overrideEntry(SH, d2.id, { seq: 1, reason: "x".repeat(20) }));
throws("BR-05 reason required", "BR-05", () => A.overrideEntry(BH, d2.id, { seq: 1, reason: "short" }));
A.overrideEntry(BH, d2.id, { seq: 1, reason: "The concept has never been articulated for a market beyond the original client." });
assert.equal(A.getProduct(d2.id).stage_seq, 1, "BR-05: entry gate overridden to 1");
pass++;

/* ---------- BR-31 owner continuity ---------- */
throws("BR-31 reason required", "BR-31", () => A.changeOwner(SH, d2.id, { to_user_id: C2.id, reason: "x" }));
A.changeOwner(SH, d2.id, { to_user_id: C2.id, reason: "Consultant 1 has rolled off to a client programme." });
assert.equal(A.getProduct(d2.id).owner_user_id, C2.id);
assert.equal(db.col("SELECT COUNT(*) FROM owner_changes WHERE product_id=?", d2.id), 1);
pass += 2;

/* ---------- BR-33 immutable history ---------- */
const hist = db.all("SELECT * FROM stage_history WHERE product_id=? ORDER BY id", b.id);
assert.ok(hist.length >= 6, "every position is recorded in history");
assert.ok(hist.every(h => h.entered_on), "history rows carry an entry date");
pass += 2;

/* ---------- users and roles: any role to any user ---------- */
throws("users.manage permission", "users.manage", () => A.saveUser(C1, null, { name: "X", email: "x@y.z" }));
A.saveUser(SH, null, { name: "New Joiner", email: "new.joiner@assured.local", title: "Consultant", password: "Joiner@2026", role_ids: [] });
const nj = db.col("SELECT id FROM users WHERE email='new.joiner@assured.local'");
assert.equal(A.loadUser(nj).roles.length, 0, "a user may hold no role");
const allRoleIds = db.all("SELECT id FROM roles").map(r => r.id);
A.saveUser(SH, nj, { name: "New Joiner", email: "new.joiner@assured.local", role_ids: allRoleIds });
assert.equal(A.loadUser(nj).roles.length, allRoleIds.length, "any role may be assigned to any user");
A.saveUser(SH, nj, { name: "New Joiner", email: "new.joiner@assured.local", role_ids: [db.col("SELECT id FROM roles WHERE name='Finance Head'")] });
assert.deepEqual(A.loadUser(nj).roleNames, ["Finance Head"], "roles can be replaced wholesale");
assert.ok(A.loadUser(nj).permissions.includes("revenue.confirm"), "permissions follow from the role");
throws("duplicate email", "already", () => A.saveUser(SH, null, { name: "Dup", email: "new.joiner@assured.local" }));
pass += 4;

// a custom role, with permissions, assigned to a user
A.saveRole(SH, null, { name: "Portfolio Analyst", description: "Reads and logs effort.", permissions: ["effort.log", "product.edit"] });
const analyst = db.col("SELECT id FROM roles WHERE name='Portfolio Analyst'");
A.saveUser(SH, nj, { name: "New Joiner", email: "new.joiner@assured.local", role_ids: [analyst] });
assert.deepEqual(A.loadUser(nj).permissions.sort(), ["effort.log", "product.edit"]);
throws("system roles cannot be deleted", "system role", () => A.deleteRole(SH, db.col("SELECT id FROM roles WHERE name='CEO'")));
A.saveUser(SH, nj, { name: "New Joiner", email: "new.joiner@assured.local", role_ids: [] });
A.deleteRole(SH, analyst);
assert.equal(db.col("SELECT COUNT(*) FROM roles WHERE name='Portfolio Analyst'"), 0);
pass += 2;

/* ---------- stage model is configurable ---------- */
const g6 = db.one("SELECT * FROM stages WHERE track='development' AND seq=6");
A.saveStage(SH, g6.id, { target_days: 45, ageing_days: 68 });
assert.equal(db.col("SELECT ageing_days FROM stages WHERE id=?", g6.id), 68, "FR-51: thresholds are configurable");
A.saveCriterion(SH, { stage_id: g6.id, text: "Security review signed off." });
assert.equal(db.col("SELECT COUNT(*) FROM exit_criteria WHERE stage_id=? AND active=1", g6.id), 4, "FR-52: criteria maintainable");
throws("stagemodel.manage permission", "stagemodel.manage", () => A.saveStage(C1, g6.id, { target_days: 1 }));
A.saveSettings(SH, { day_rate: "2000" });
assert.equal(A.getProduct(b.id).effort_value, Math.round(A.getProduct(b.id).effort * 2000), "FR-22: day rate drives the monetary value");
pass += 3;

/* ---------- reports ---------- */
for (const key of Object.keys(A.REPORTS)) {
  const r = A.report(key);
  assert.ok(Array.isArray(r.rows), `${key} builds`);
  assert.ok(A.reportCSV(key).length > 0, `${key} exports CSV`);
}
const rpt1 = A.report("RPT-01");
assert.deepEqual(rpt1.columns.slice(0, 17).map(c => c.label), [
  "Product ID", "Product / Solution", "Origin", "Client / Source", "Problem Solved", "Product Owner", "Entry Stage",
  "Current Stage", "Status", "Next Action", "Action Owner", "Stage Approver", "Participants", "Target Date",
  "Revised Date", "No of Revisions", "Actual Completion Date"
], "FR-48: RPT-01 reproduces the original workbook column order");
pass += 2;

/* ---------- audit ---------- */
assert.ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='product'") > 20, "FR-55: product changes are audited");
assert.ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='user'") > 0, "FR-55: user changes are audited");
pass += 2;

try { db.db.close(); } catch { /* already closed */ }
for (const f of [tmp, tmp + "-wal", tmp + "-shm"]) { try { fs.rmSync(f, { force: true }); } catch { /* Windows may still hold it */ } }
console.log(`\n  ${pass} assertions passed — every business rule check above rejected as specified.\n`);
