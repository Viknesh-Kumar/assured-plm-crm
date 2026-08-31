// CRM self-check — AGC-BRD-CRM-001 §11 test contract.
// Every BR in §6 is named in at least one assertion message, and each is proved by a refusal.
// Run with `npm run test:crm`. Uses a throwaway database.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `crm-test-${process.pid}.db`);
process.env.PLM_DB = tmp;
process.env.PLM_SEED_PASSWORD = "TestPass@2026";

const db = await import("./db.mjs");
const { seedIfEmpty } = await import("./seed.mjs");
const { seedCRMIfEmpty, GATE_REQUIREMENTS, seedDefaultRequirements } = await import("./crm-seed.mjs");
const A = await import("./api.mjs");
const C = await import("./crm.mjs");
const { today } = await import("./lib.mjs");

seedIfEmpty();
seedCRMIfEmpty();

let pass = 0, failures = 0;
const ok = (cond, msg) => { if (cond) pass++; else { failures++; console.error("  FAIL " + msg); } };
const eq = (a, b, msg) => { if (a === b || JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { failures++; console.error(`  FAIL ${msg}\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`); } };
/** The primary form: a rule is proved by what it refuses. */
const refused = (fn, rule, msg, contains) => {
  try { fn(); failures++; console.error(`  FAIL ${rule} — ${msg}: expected a refusal, the call succeeded`); }
  catch (e) {
    if (!(e instanceof A.HttpError)) { failures++; console.error(`  FAIL ${rule} — ${msg}: threw ${e.message}`); return; }
    if (rule && !(String(e.rule || "").includes(rule) || e.message.includes(rule))) {
      failures++; console.error(`  FAIL ${rule} — ${msg}: refused with "${e.rule}" / "${e.message}"`); return;
    }
    for (const c of [].concat(contains || [])) {
      if (!e.message.includes(c)) { failures++; console.error(`  FAIL ${rule} — ${msg}: message lacks "${c}" — got "${e.message}"`); return; }
    }
    pass++;
  }
};

const user = e => A.loadUser(db.col("SELECT id FROM users WHERE email=?", e));

// A clean install seeds no people — the Product Head creates them, which is what this does.
const ADMIN = user(process.env.PLM_ADMIN_EMAIL || "producthead@assured.local");
const mk = (name, email, role) => {
  A.saveUser(ADMIN, null, { name, email, title: name, password: "TestPass@2026",
    role_ids: [db.col("SELECT id FROM roles WHERE name=?", role)] });
  return user(email);
};
const VIKRAM = mk("Vikram", "vikram@assured.local", "CRM Administrator");
const DARWIN = mk("Darwin", "darwin@assured.local", "CRM Administrator");
const SIDDIQUE = mk("Siddique", "siddique@assured.local", "CRM Sales User");
const SHIREEN = mk("Shireen", "shireen@assured.local", "CRM Sales User");
const PLMONLY = mk("Chief Executive", "ceo@assured.local", "CEO");   // no CRM permission at all
const BH = mk("Business Head", "business.head@assured.local", "Business Head");
const SOLH = mk("Solutions Head", "solutions.head@assured.local", "Solutions Head");
const CEOU = PLMONLY;
const idOf = (t, n) => db.col(`SELECT id FROM ${t} WHERE name=?`, n);
const offId = code => db.col("SELECT id FROM offering WHERE code=?", code);

/* ================= Iteration 1 — reference data (≥14) ================= */
eq(db.col("SELECT COUNT(*) FROM lead"), 0, "clean install: the CRM ships with no leads");
eq(db.col("SELECT COUNT(*) FROM content"), 0, "clean install: the CRM ships with no content");
ok(!!ADMIN, "clean install: the Product Head account exists and creates every other user");
eq(db.col("SELECT COUNT(*) FROM industry"), 8, "§9.2 eight industries");
eq(db.col("SELECT COUNT(*) FROM customer_segment"), 9, "§9.3 nine customer segments");
eq(db.col("SELECT COUNT(*) FROM channel"), 12, "§9.4 twelve channels");
eq(db.col("SELECT COUNT(*) FROM offering"), 12, "§9.5 twelve offerings");
eq(db.col("SELECT COUNT(*) FROM content_type"), 7, "§9.9 seven content types");
eq(db.col("SELECT COUNT(*) FROM content_channel"), 4, "§9.9 four content channels");
eq(db.col("SELECT COUNT(*) FROM stage_template"), 11, "§9.6 eleven stage templates");
eq(db.col("SELECT COUNT(*) FROM lead_field"), 17, "§9.7 seventeen lead fields");
eq(db.col("SELECT COUNT(*) FROM lead_field WHERE active=1"), 14, "§9.7 fourteen active fields");
eq(db.col("SELECT COUNT(*) FROM lead_field WHERE active=0"), 3, "§9.7 value, btype and bsegment ship switched off");
eq(db.col("SELECT COUNT(*) FROM offering WHERE revenue_category IS NOT NULL"), 0, "Finding 4 / OI-01 revenue_category left NULL");
eq(db.col("SELECT COUNT(*) FROM channel WHERE name LIKE 'Personal Branding%' AND mode='Online'"), 4,
  "Finding 7 four Personal Branding channels ship as Online");
eq(db.col("SELECT COUNT(*) FROM channel WHERE person_id IS NOT NULL"), 0,
  "clean install: no channel is linked to a person, because no people are seeded");
C.saveReference(VIKRAM, "channel", { id: db.col("SELECT id FROM channel WHERE name='Personal Branding — Vikram'"),
  name: "Personal Branding — Vikram", mode: "Online", person_id: VIKRAM.id });
eq(db.col("SELECT person_id FROM channel WHERE name='Personal Branding — Vikram'"), VIKRAM.id,
  "Finding 7 a Personal Branding channel links to the person once the Product Head creates them");
eq(db.col("SELECT mode FROM channel WHERE name='Exhibitions & Expos'"), "Offline", "OI-04 Exhibitions seeded Offline");
for (const t of db.all("SELECT * FROM stage_template")) {
  eq(db.col("SELECT COUNT(*) FROM stage_template_stage WHERE template_id=? AND is_gate=1", t.id), 1,
    `§9.6 template ${t.code} has exactly one qualification gate`);
  eq(db.col("SELECT band FROM stage_template_stage WHERE template_id=? ORDER BY seq DESC LIMIT 1", t.id), "Closed",
    `§9.6 template ${t.code} ends in the Closed band`);
  const bands = db.all("SELECT band FROM stage_template_stage WHERE template_id=? ORDER BY seq", t.id).map(r => r.band);
  const ix = b => ["Lead", "Qualified", "CSE", "Closed"].indexOf(b);
  ok(bands.every((b, i) => !i || ix(b) >= ix(bands[i - 1])), `§9.6 template ${t.code} bands are monotonic`);
}
seedCRMIfEmpty();                                                       // idempotent
eq(db.col("SELECT COUNT(*) FROM offering"), 12, "Iteration 1 — re-running the seed creates no duplicates");

/* ================= Iteration 2 — pipelines and derivation (≥12) ================= */
eq(db.col("SELECT COUNT(*) FROM pipeline"), 12, "§9.5 twelve pipelines");
eq(db.col("SELECT COUNT(*) FROM pipeline_industry"), 15, "§9.5 fifteen (offering, industry) pairs");
for (const [code, ind] of [["LP", "Trading and distribution"], ["IBT", "Manufacturing"], ["XLC", "Large Corporates"],
  ["XLR", "Project management"], ["PXP", "Project management"], ["CLX", "UAE Real Estate"],
  ["RTX", "Warehousing"], ["RTX", "Trading and distribution"], ["ATX", "Project management"],
  ["ATX", "Labour supply"], ["STX", "Manufacturing"], ["STX", "Trading and distribution"],
  ["XNP", "Manufacturing"], ["QMX", "Manufacturing"], ["FNX", "All Companies"]])
  ok(!!C.resolvePipeline(offId(code), idOf("industry", ind)), `BR-04 resolver returns a pipeline for ${code} × ${ind}`);
eq(C.resolvePipeline(offId("LP"), idOf("industry", "Warehousing")), null, "BR-04 resolver returns null for a pair with no pipeline");
eq(C.resolvePipeline(null, idOf("industry", "Manufacturing")), null, "BR-06 no offering means no pipeline");

refused(() => C.savePipeline(VIKRAM, null, { name: "Duplicate", offering_id: offId("LP"),
  template_id: db.col("SELECT id FROM stage_template WHERE code='T5'"), industry_ids: [idOf("industry", "Trading and distribution")] }),
  "BR-05", "a second active pipeline for a taken pair", ["Launchpad", "already served"]);

for (const p of db.all("SELECT id, name FROM pipeline")) {
  const gate = db.one("SELECT * FROM pipeline_stage WHERE pipeline_id=? AND is_gate=1", p.id);
  eq(db.col("SELECT COUNT(*) FROM stage_requirement WHERE pipeline_stage_id=?", gate.id), GATE_REQUIREMENTS.length,
    `§9.8 ${p.name} carries all ten gate requirements`);
}
const cseStage = db.one("SELECT * FROM pipeline_stage WHERE pipeline_id=(SELECT id FROM pipeline LIMIT 1) AND band='CSE' ORDER BY seq LIMIT 1");
eq(db.col("SELECT level FROM stage_requirement WHERE pipeline_stage_id=? AND field_key='location'", cseStage.id), 1, "§9.8 location is level 1 at the first CSE stage");
eq(db.col("SELECT level FROM stage_requirement WHERE pipeline_stage_id=? AND field_key='content'", cseStage.id), 2, "§9.8 content is level 2 at the first CSE stage");

// Deactivating a pipeline frees its pairs; a new pipeline for a freed pair is then accepted.
const lp = db.one("SELECT * FROM pipeline WHERE offering_id=?", offId("LP"));
C.savePipeline(VIKRAM, lp.id, { name: lp.name, offering_id: lp.offering_id, industry_ids: [idOf("industry", "Trading and distribution")], active: 0 });
C.savePipeline(VIKRAM, null, { name: "Launchpad (rebuilt)", offering_id: offId("LP"),
  template_id: db.col("SELECT id FROM stage_template WHERE code='T5'"), industry_ids: [idOf("industry", "Trading and distribution")] });
ok(!!C.resolvePipeline(offId("LP"), idOf("industry", "Trading and distribution")), "BR-05 deactivating a pipeline frees its pair for a new one");

/* ================= Iteration 3 — leads and the entry minimum (≥12) ================= */
refused(() => C.createLead(VIKRAM, { company: "" }), "BR-02", "blank company", ["company name"]);
refused(() => C.createLead(VIKRAM, { company: "   " }), "BR-02", "whitespace-only company");
refused(() => C.createLead(PLMONLY, { company: "No permission" }), "FR-43", "a user with no CRM permission cannot create a lead");

const a = C.createLead(SIDDIQUE, { company: "Gulf Metals LLC" });
eq(a.company, "Gulf Metals LLC", "BR-01 a lead is created with a company name alone");
eq(a.pipeline_id, null, "BR-06 no offering or industry means no pipeline");
eq(a.stage_id, null, "BR-06 a lead with no pipeline has no stage");
eq(a.next_move, "blocked", "FR-03 a lead with no pipeline reads as blocked");
const created = { at: a.created_at, by: a.created_by };
for (let i = 0; i < 5; i++) C.updateLead(SIDDIQUE, a.id, { customer: "Contact " + i });
const a2 = C.getLead(a.id);
eq(a2.created_at, created.at, "BR-03 created_at is unchanged after five updates");
eq(a2.created_by, created.by, "BR-03 created_by is unchanged after five updates");

C.updateLead(SIDDIQUE, a.id, { offering: offId("XNP"), industry: idOf("industry", "Manufacturing") });
let L = C.getLead(a.id);
ok(!!L.pipeline_id, "BR-04 setting offering and industry derives the pipeline");
eq(L.stage_seq, 1, "BR-04 the lead is placed at stage 1");
eq(db.col("SELECT COUNT(*) FROM lead_stage_history WHERE lead_id=? AND reason='Pipeline re-derived'", a.id), 1,
  "BR-07 the derivation writes a history row reading 'Pipeline re-derived'");

C.updateLead(SIDDIQUE, a.id, { offering: "" });
eq(C.getLead(a.id).pipeline_id, null, "BR-06 clearing the offering clears the pipeline and the lead stays valid");
C.updateLead(SIDDIQUE, a.id, { offering: offId("XNP") });

// Lead Source derivation
C.updateLead(SIDDIQUE, a.id, { channel: idOf("channel", "Business Community") });
eq(C.getLead(a.id).effective_source, "Offline", "BR-25 Lead Source is derived from the channel's mode");
C.updateLead(SIDDIQUE, a.id, { channel: idOf("channel", "Tenders / Online") });
eq(C.getLead(a.id).effective_source, "Online", "BR-27 changing the channel re-derives Lead Source");
refused(() => C.overrideSource(SIDDIQUE, a.id, { source: "Offline" }), "BR-26", "an override with no reason");
refused(() => C.overrideSource(SIDDIQUE, a.id, { source: "Offline", reason: "too short" }), "BR-26", "an override with a short reason");
C.overrideSource(SIDDIQUE, a.id, { source: "Offline", reason: "Arrived through a personal introduction at the tender briefing." });
eq(C.getLead(a.id).effective_source, "Offline", "BR-26 the override holds");
C.updateLead(SIDDIQUE, a.id, { channel: idOf("channel", "Personal Branding — Vikram") });
eq(C.getLead(a.id).effective_source, "Offline", "BR-26 a later channel change no longer re-derives an overridden source");
eq(C.getLead(a.id).channel_mode, "Online", "BR-26 the derived value stays visible alongside the override");
C.overrideSource(SIDDIQUE, a.id, { clear: true });
eq(C.getLead(a.id).effective_source, "Online", "BR-27 clearing the override re-derives from the channel");

/* ================= Iteration 4 — the gate engine (≥24) ================= */
const b = C.createLead(SIDDIQUE, { company: "Northline Warehousing FZC" });
C.updateLead(SIDDIQUE, b.id, { offering: offId("RTX"), industry: idOf("industry", "Warehousing") });
let B = C.getLead(b.id);
const stages = C.pipelineStages(B.pipeline_id);
const gateSeq = stages.find(s => s.is_gate).seq;

// Walk to the stage before the gate — nothing is required before it.
for (let s = 2; s < gateSeq; s++) C.attemptMove(SIDDIQUE, b.id, { to_seq: s });
eq(C.getLead(b.id).stage_seq, gateSeq - 1, "§9.8 nothing is required before the qualification gate");

const SEVEN = ["Customer Name", "Designation", "Contact", "Email", "Customer Segment", "Channel", "Activity Name"];
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq }), "BR-16",
  "the gate with only company, offering and industry recorded", SEVEN);
try { C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq }); } catch (e) {
  eq(e.missing.length, 7, "BR-16 with BR-19 the refusal names exactly the seven outstanding gate fields");
  ok(!e.message.includes("Lead Source"), "BR-19 the derived Lead Source is omitted while Channel is itself unmet");
}

// Fill six of the seven; still refused, naming the seventh.
C.updateLead(SIDDIQUE, b.id, { customer: "Reem Al Habtoor", designation: "Head of Operations",
  contact: "+971 50 000 0000", email: "reem@northline.example", segment: idOf("customer_segment", "Corporates (500+ employees)"),
  activity: "Warehouse throughput review" });
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq }), "BR-16",
  "six of the seven filled still refuses, naming the seventh", ["Channel"]);

// Overriding Lead Source while Channel is unmet reinstates it in the list (BR-19 applies only to the derived case).
C.overrideSource(SIDDIQUE, b.id, { source: "Offline", reason: "Recorded manually pending the channel being confirmed." });
try { C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq }); } catch (e) {
  ok(!e.missing.some(m => m.key === "source"), "BR-19 an overridden Lead Source is satisfied, not listed");
}
C.overrideSource(SIDDIQUE, b.id, { clear: true });

C.updateLead(SIDDIQUE, b.id, { channel: idOf("channel", "Research & walk-in") });
C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq });
eq(C.getLead(b.id).stage_seq, gateSeq, "BR-25 with BR-19 supplying Channel satisfies Lead Source by derivation and the move is allowed");
eq(db.col("SELECT stage_name_snapshot FROM lead_stage_history WHERE lead_id=? ORDER BY id DESC LIMIT 1", b.id),
  stages.find(s => s.seq === gateSeq).name, "BR-23 the history row carries the stage name as it stood at that moment");

// BR-13 — renaming the stage afterwards does not alter the row.
const gateStage = db.one("SELECT * FROM pipeline_stage WHERE pipeline_id=? AND seq=?", B.pipeline_id, gateSeq);
const allStages = C.pipelineStages(B.pipeline_id).map(s => ({ ...s, name: s.id === gateStage.id ? "Renamed Gate" : s.name }));
C.saveStages(VIKRAM, B.pipeline_id, { stages: allStages });
eq(db.col("SELECT stage_name_snapshot FROM lead_stage_history WHERE lead_id=? ORDER BY id DESC LIMIT 1", b.id),
  gateStage.name, "BR-13 renaming a stage does not alter history");
C.saveStages(VIKRAM, B.pipeline_id, { stages: C.pipelineStages(B.pipeline_id).map(s => ({ ...s, name: s.id === gateStage.id ? gateStage.name : s.name })) });

// BR-15 — cumulative: clear a gate field after the gate and the next move is refused.
C.updateLead(SIDDIQUE, b.id, { designation: "" });
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq + 1 }), "BR-16",
  "BR-15 a field required at the gate is still enforced at every later stage", ["Designation"]);
C.updateLead(SIDDIQUE, b.id, { designation: "Head of Operations" });

// BR-17 — level 2 only bites when the source is Online.
const cse = C.pipelineStages(B.pipeline_id).find(s => s.band === "CSE");
C.updateLead(SIDDIQUE, b.id, { location: "Jebel Ali" });
C.attemptMove(SIDDIQUE, b.id, { to_seq: cse.seq });
eq(C.getLead(b.id).stage_seq, cse.seq, "BR-17 a level-2 requirement is ignored while Lead Source is Offline");
C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq, reason: "Stepping back to prove the Online condition." });
C.updateLead(SIDDIQUE, b.id, { channel: idOf("channel", "Tenders / Online") });
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: cse.seq }), "BR-16",
  "BR-17 a level-2 requirement is enforced once Lead Source is Online", ["Attributed Content", "required because Lead Source is Online"]);
C.updateLead(SIDDIQUE, b.id, { channel: idOf("channel", "Research & walk-in") });
C.attemptMove(SIDDIQUE, b.id, { to_seq: cse.seq });

// BR-14 — the triple, and two pipelines sharing a template hold independent requirement sets.
const rtx = db.one("SELECT * FROM pipeline WHERE offering_id=?", offId("RTX"));
const atx = db.one("SELECT * FROM pipeline WHERE offering_id=?", offId("ATX"));
eq(db.col("SELECT template_id FROM pipeline WHERE id=?", rtx.id), db.col("SELECT template_id FROM pipeline WHERE id=?", atx.id),
  "§3.2 RouteX and AttendX share the T5 template");
const rtxGate = db.one("SELECT * FROM pipeline_stage WHERE pipeline_id=? AND is_gate=1", rtx.id);
const atxGate = db.one("SELECT * FROM pipeline_stage WHERE pipeline_id=? AND is_gate=1", atx.id);
C.setRequirement(VIKRAM, { pipeline_stage_id: rtxGate.id, field_key: "location", level: 1 });
eq(db.col("SELECT level FROM stage_requirement WHERE pipeline_stage_id=? AND field_key='location'", atxGate.id), null,
  "BR-14 two pipelines sharing a template hold independent requirement sets");
C.setRequirement(VIKRAM, { pipeline_stage_id: rtxGate.id, field_key: "location", level: 0 });
refused(() => C.setRequirement(VIKRAM, { pipeline_stage_id: rtxGate.id, field_key: "location", level: 3 }),
  "BR-14", "a requirement level outside 0, 1 and 2");

// BR-21 — skipping.
const c = C.createLead(SIDDIQUE, { company: "Skiptest Trading" });
C.updateLead(SIDDIQUE, c.id, { offering: offId("CLX"), industry: idOf("industry", "UAE Real Estate") });
refused(() => C.attemptMove(SIDDIQUE, c.id, { to_seq: 3 }), "BR-21", "skipping two stages while allowSkip is off", ["one at a time"]);
C.saveMovementRules(VIKRAM, { allowSkip: true, allowBack: true, backReason: true });
refused(() => C.attemptMove(SIDDIQUE, c.id, { to_seq: 3 }), "BR-16",
  "BR-21 with skipping on, the skipped stages' requirements still apply");
C.saveMovementRules(VIKRAM, { allowSkip: false, allowBack: true, backReason: true });

// BR-22 — backward movement.
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq }), "BR-22", "a backward move with no reason");
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq, reason: "123456789" }), "BR-22", "a backward move with a nine-character reason");
C.attemptMove(SIDDIQUE, b.id, { to_seq: gateSeq, reason: "1234567890" });
eq(C.getLead(b.id).stage_seq, gateSeq, "BR-22 a ten-character reason is accepted");
C.saveMovementRules(VIKRAM, { allowSkip: false, allowBack: false, backReason: true });
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: 1, reason: "Backward movement is switched off." }),
  "BR-22", "a backward move while backward movement is off");
C.saveMovementRules(VIKRAM, { allowSkip: false, allowBack: true, backReason: true });

// BR-18 — deactivating a field removes it from enforcement immediately.
const d = C.createLead(SIDDIQUE, { company: "Fieldtest Manufacturing" });
C.updateLead(SIDDIQUE, d.id, { offering: offId("QMX"), industry: idOf("industry", "Manufacturing") });
const dGate = C.pipelineStages(C.getLead(d.id).pipeline_id).find(s => s.is_gate).seq;
for (let s = 2; s < dGate; s++) C.attemptMove(SIDDIQUE, d.id, { to_seq: s });
const beforeCount = (() => { try { C.attemptMove(SIDDIQUE, d.id, { to_seq: dGate }); return 0; } catch (e) { return e.missing.length; } })();
const actField = db.one("SELECT * FROM lead_field WHERE key='activity'");
C.saveField(VIKRAM, { id: actField.id, active: false });
const afterCount = (() => { try { C.attemptMove(SIDDIQUE, d.id, { to_seq: dGate }); return 0; } catch (e) { return e.missing.length; } })();
eq(afterCount, beforeCount - 1, "BR-18 deactivating a field removes it from enforcement immediately");
C.saveField(VIKRAM, { id: actField.id, active: true });

// BR-20 — a requirement added to a stage a lead has already passed does not move or invalidate it.
const bStageBefore = C.getLead(b.id).stage_seq;
C.setRequirement(VIKRAM, { pipeline_stage_id: db.col("SELECT id FROM pipeline_stage WHERE pipeline_id=? AND seq=1", C.getLead(b.id).pipeline_id), field_key: "location", level: 1 });
eq(C.getLead(b.id).stage_seq, bStageBefore, "BR-20 adding a requirement does not move a lead already past that stage");
ok(C.getLead(b.id).lost === 0, "BR-20 adding a requirement does not invalidate the lead");
C.setRequirement(VIKRAM, { pipeline_stage_id: db.col("SELECT id FROM pipeline_stage WHERE pipeline_id=? AND seq=1", C.getLead(b.id).pipeline_id), field_key: "location", level: 0 });

// BR-24 — history is append-only. No exported function updates or deletes it.
const src = fs.readFileSync(new URL("./crm.mjs", import.meta.url), "utf8");
ok(!/UPDATE\s+lead_stage_history/i.test(src), "BR-24 no code path updates lead_stage_history");
ok(!/DELETE\s+FROM\s+lead_stage_history/i.test(src), "BR-24 no code path deletes from lead_stage_history");
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: 99 }), "BR-08", "a move to a stage that does not exist");
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: C.getLead(b.id).stage_seq }), "BR-21", "a move to the stage the lead is already at");
const noPipe = C.createLead(SIDDIQUE, { company: "Unassigned Holdings" });
refused(() => C.attemptMove(SIDDIQUE, noPipe.id, { to_seq: 2 }), "BR-06", "a move on a lead with no pipeline");

/* ================= Iteration 5 — loss (≥8) ================= */
refused(() => C.markLost(SIDDIQUE, b.id, { reason: "123456789" }), "BR-28", "marking lost with a nine-character reason");
const stageAtLoss = C.getLead(b.id).stage_seq;
C.markLost(SIDDIQUE, b.id, { reason: "Client selected an incumbent supplier." });
eq(C.getLead(b.id).lost, 1, "BR-28 a ten-character reason is accepted");
eq(C.getLead(b.id).stage_seq, stageAtLoss, "BR-28 a lost lead keeps the stage it reached");
eq(C.getLead(b.id).status, "Lost", "BR-28 status reads Lost");
refused(() => C.attemptMove(SIDDIQUE, b.id, { to_seq: stageAtLoss + 1 }), "BR-29", "moving a lost lead");
refused(() => C.markLost(SIDDIQUE, b.id, { reason: "Already lost, this should refuse." }), "BR-28", "marking an already-lost lead lost");
refused(() => C.reopenLead(SIDDIQUE, b.id, { reason: "short" }), "BR-29", "reopening with a short reason");
const lostRows = db.col("SELECT COUNT(*) FROM lead_stage_history WHERE lead_id=? AND reason LIKE 'Marked lost%'", b.id);
C.reopenLead(SIDDIQUE, b.id, { reason: "Incumbent supplier contract fell through; the buyer is back." });
eq(C.getLead(b.id).lost, 0, "BR-29 reopening with a reason is accepted");
eq(db.col("SELECT COUNT(*) FROM lead_stage_history WHERE lead_id=? AND reason LIKE 'Marked lost%'", b.id), lostRows,
  "BR-29 the loss stays in history after reopening");
C.markLost(SIDDIQUE, b.id, { reason: "Client selected an incumbent supplier after all." });
const dashAfterLoss = C.crmDashboard(VIKRAM);
ok(!dashAfterLoss.bands.some(x => x.n && dashAfterLoss.kpi.open === 0), "BR-30 lost leads are excluded from the funnel band counts");
ok(!dashAfterLoss.blocked.some(l => l.id === b.id), "BR-30 lost leads are excluded from the blocked count");

/* ================= Iteration 6 — content and attribution (≥10) ================= */
const ct = db.col("SELECT id FROM content_type WHERE name='Long-form'");
const cc = db.col("SELECT id FROM content_channel WHERE name='LinkedIn'");
refused(() => C.saveContent(SHIREEN, null, { title: "No date", type_id: ct, channel_id: cc, person_id: SHIREEN.id }),
  "BR-31", "content with no date", ["Date"]);
refused(() => C.saveContent(SHIREEN, null, { date: today(), type_id: ct, channel_id: cc, person_id: SHIREEN.id }),
  "BR-31", "content with no title", ["Title"]);
refused(() => C.saveContent(SHIREEN, null, { date: today(), title: "X", channel_id: cc, person_id: SHIREEN.id }),
  "BR-31", "content with no type", ["Content type"]);
refused(() => C.saveContent(SHIREEN, null, { date: today(), title: "X", type_id: ct, person_id: SHIREEN.id }),
  "BR-31", "content with no channel", ["Channel"]);
refused(() => C.saveContent(SHIREEN, null, { date: today(), title: "X", type_id: ct, channel_id: cc }),
  "BR-31", "content with no person", ["Person"]);
const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
refused(() => C.saveContent(SHIREEN, null, { date: future, title: "Future post", type_id: ct, channel_id: cc,
  person_id: SHIREEN.id, status: "Published" }), "BR-32", "publishing an item dated in the future", ["future"]);

const c1 = C.saveContent(SHIREEN, null, { date: "2026-08-03", title: "Warehouse throughput teardown", type_id: ct, channel_id: cc, person_id: SHIREEN.id });
const c2 = C.saveContent(SHIREEN, null, { date: "2026-08-17", title: "Three signs your racking is wrong", type_id: ct, channel_id: cc, person_id: SHIREEN.id });
C.attachContent(SIDDIQUE, b.id, { content_id: c1.id, primary: true });
eq(C.getLead(b.id).primary_content_id, c1.id, "BR-33 a primary attribution is recorded");
eq(db.col("SELECT COUNT(*) FROM lead_content_touch WHERE lead_id=? AND content_id=?", b.id, c1.id), 1,
  "BR-33 setting a primary also records it as a touch");
C.attachContent(SIDDIQUE, b.id, { content_id: c2.id, primary: true });
eq(C.getLead(b.id).primary_content_id, c2.id, "BR-33 a second primary replaces the first");
eq(db.col("SELECT COUNT(*) FROM lead_content_touch WHERE lead_id=?", b.id), 2, "BR-33 both remain touches");
eq(db.col("SELECT COUNT(*) FROM lead_content_touch WHERE lead_id=? AND is_primary=1", b.id), 1, "BR-33 exactly one touch is primary");
refused(() => C.deleteContent(SHIREEN, c1.id), "BR-34", "deleting content attributed to a lead", ["1 lead"]);
const c3 = C.saveContent(SHIREEN, null, { date: "2026-08-20", title: "Unattached", type_id: ct, channel_id: cc, person_id: SHIREEN.id });
C.deleteContent(SHIREEN, c3.id);
eq(db.col("SELECT COUNT(*) FROM content WHERE id=?", c3.id), 0, "BR-34 unattributed content can be deleted");
const aug = C.contentForMonth(2026, 8);
eq(aug.length, 2, "FR-19 the month grid and the planning table return the same item set");
eq(C.contentForMonth(2027, 3).length, 0, "FR-18 a month with no content renders without error");

/* ================= Iteration 7 — configuration (≥16) ================= */
const pipe = db.one("SELECT * FROM pipeline WHERE offering_id=?", offId("XLC"));
const ps = () => C.pipelineStages(pipe.id);
refused(() => C.saveStages(VIKRAM, pipe.id, { stages: [ps()[0]] }), "BR-08", "a pipeline with fewer than two stages");
refused(() => C.saveStages(VIKRAM, pipe.id, { stages: ps().map(s => ({ ...s, band: s.seq === 1 ? "Closed" : s.band })) }),
  "BR-09", "a band order that goes backwards", ["cannot go backwards"]);
refused(() => C.saveStages(VIKRAM, pipe.id, { stages: ps().map(s => ({ ...s, is_gate: 0 })) }),
  "BR-10", "a pipeline with no qualification gate");
refused(() => C.saveStages(VIKRAM, pipe.id, { stages: ps().map(s => ({ ...s, is_gate: 1 })) }),
  "BR-10", "a pipeline with more than one qualification gate");
refused(() => C.saveStages(VIKRAM, pipe.id, { stages: ps().slice(0, -1) }), "BR-11", "deleting the final Closed stage");
refused(() => C.saveStages(VIKRAM, pipe.id, { stages: ps().map(s => ({ ...s, name: s.seq === 2 ? "" : s.name })) }),
  "BR-08", "a stage with no name");

// Reorder: sequences stay contiguous from 1 and leads keep their stage.
const e = C.createLead(SIDDIQUE, { company: "Reorder Corp" });
C.updateLead(SIDDIQUE, e.id, { offering: offId("XLC"), industry: idOf("industry", "Large Corporates") });
const eStageId = C.getLead(e.id).stage_id;
const reordered = ps(); [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
C.saveStages(VIKRAM, pipe.id, { stages: reordered });
eq(ps().map(s => s.seq).join(","), ps().map((_, i) => i + 1).join(","), "BR-08 sequences stay contiguous from 1 after a reorder");
eq(C.getLead(e.id).stage_id, eStageId, "BR-08 a lead keeps its stage across a reorder");
refused(() => C.saveStages(VIKRAM, pipe.id, { stages: ps().filter(s => s.id !== eStageId) }),
  "BR-12", "deleting a stage that holds leads", ["1 lead"]);

// Move the gate — exactly one remains.
const moved = ps().map(s => ({ ...s, is_gate: s.seq === 5 ? 1 : 0 }));
C.saveStages(VIKRAM, pipe.id, { stages: moved });
eq(ps().filter(s => s.is_gate).length, 1, "BR-10 moving the gate leaves exactly one");
eq(ps().find(s => s.is_gate).seq, 5, "BR-10 the gate is where it was moved to");

// Matrix cycling and copy-to-all by band and gate.
const xg = ps().find(s => s.is_gate);
C.setRequirement(VIKRAM, { pipeline_stage_id: xg.id, field_key: "location", level: 1 });
eq(db.col("SELECT level FROM stage_requirement WHERE pipeline_stage_id=? AND field_key='location'", xg.id), 1, "BR-14 a matrix cell cycles 0 → 1");
C.setRequirement(VIKRAM, { pipeline_stage_id: xg.id, field_key: "location", level: 2 });
eq(db.col("SELECT level FROM stage_requirement WHERE pipeline_stage_id=? AND field_key='location'", xg.id), 2, "BR-14 a matrix cell cycles 1 → 2");
C.setRequirement(VIKRAM, { pipeline_stage_id: xg.id, field_key: "location", level: 0 });
eq(db.col("SELECT level FROM stage_requirement WHERE pipeline_stage_id=? AND field_key='location'", xg.id), null, "BR-14 a matrix cell cycles 2 → 0");
C.setRequirement(VIKRAM, { pipeline_stage_id: xg.id, field_key: "location", level: 1 });
C.copyMatrix(VIKRAM, pipe.id);
const five = db.one("SELECT * FROM pipeline WHERE id=(SELECT pipeline_id FROM pipeline_stage GROUP BY pipeline_id HAVING COUNT(*)=5 LIMIT 1)");
const fiveGate = db.one("SELECT * FROM pipeline_stage WHERE pipeline_id=? AND is_gate=1", five.id);
eq(db.col("SELECT level FROM stage_requirement WHERE pipeline_stage_id=? AND field_key='location'", fiveGate.id), 1,
  "FR-37 copy-to-all matches by gate, not by stage number — a five-stage pipeline receives it at its own gate");

// Field catalogue.
refused(() => C.saveField(VIKRAM, { id: db.col("SELECT id FROM lead_field WHERE key='company'"), active: false }),
  "BR-37", "switching off a locked field", ["locked"]);
refused(() => C.saveField(VIKRAM, { id: db.col("SELECT id FROM lead_field WHERE key='offering'"), active: false }),
  "BR-37", "switching off Offering, which derives the pipeline");
refused(() => C.deleteField(VIKRAM, db.col("SELECT id FROM lead_field WHERE key='industry'")), "BR-37", "deleting a locked field");
refused(() => C.deleteField(VIKRAM, db.col("SELECT id FROM lead_field WHERE key='customer'")), "BR-37", "deleting a core field");
C.saveField(VIKRAM, { key: "budget_band", label: "Budget band", type: "text" });
const bf = db.one("SELECT * FROM lead_field WHERE key='budget_band'");
ok(!!bf && bf.custom === 1 && bf.active === 1, "§5.3 a custom field is added, active, required nowhere");
eq(db.col("SELECT COUNT(*) FROM stage_requirement WHERE field_key='budget_band'"), 0, "§5.3 a new field is required nowhere until marked");
C.setRequirement(VIKRAM, { pipeline_stage_id: xg.id, field_key: "budget_band", level: 1 });
C.updateLead(SIDDIQUE, e.id, { budget_band: "AED 100k–250k" });
eq(db.col("SELECT value FROM lead_field_value WHERE lead_id=? AND field_key='budget_band'", e.id), "AED 100k–250k", "§5.3 a custom field stores its value");
C.deleteField(VIKRAM, bf.id);
eq(db.col("SELECT COUNT(*) FROM stage_requirement WHERE field_key='budget_band'"), 0, "§5.3 removing a field removes its requirements");
eq(db.col("SELECT value FROM lead_field_value WHERE lead_id=? AND field_key='budget_band'", e.id), "AED 100k–250k", "§5.3 removing a field retains recorded values");

// Reference data.
const usedInd = idOf("industry", "Manufacturing");
refused(() => C.deleteReference(VIKRAM, "industry", usedInd), "BR-35", "deleting a reference value in use", ["cannot be deleted"]);
C.saveReference(VIKRAM, "industry", { id: usedInd, name: "Manufacturing", active: false });
eq(db.col("SELECT active FROM industry WHERE id=?", usedInd), 0, "BR-35 an in-use value is deactivated instead");
eq(C.getLead(d.id).industry_name, "Manufacturing", "BR-36 a deactivated value stays visible on existing records");
refused(() => C.updateLead(SIDDIQUE, noPipe.id, { industry: usedInd }), "BR-36",
  "selecting a deactivated value on a record that does not already carry it", ["deactivated"]);
C.saveReference(VIKRAM, "industry", { id: usedInd, name: "Manufacturing", active: true });
const newSeg = C.saveReference(VIKRAM, "customer_segment", { name: "Family offices" });
ok(newSeg.some(s => s.name === "Family offices"), "FR-39 a reference value can be added");
C.deleteReference(VIKRAM, "customer_segment", db.col("SELECT id FROM customer_segment WHERE name='Family offices'"));
eq(db.col("SELECT COUNT(*) FROM customer_segment WHERE name='Family offices'"), 0, "BR-35 an unused reference value can be deleted");

// BR-38 — every configuration change is audited.
ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='pipeline' AND action='stages'") > 0, "BR-38 stage edits are audited");
ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='pipeline' AND action='requirement'") > 0, "BR-38 requirement changes are audited");
ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='lead_field'") > 0, "BR-38 field catalogue changes are audited");
ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='industry'") > 0, "BR-38 reference data changes are audited");
ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='setting' AND summary LIKE '%Movement rule%'") > 0, "BR-38 movement rule changes are audited");

/* ================= Iteration 8 — access, reports, PLM hand-off (≥16) ================= */
refused(() => C.savePipeline(SIDDIQUE, null, { name: "X", offering_id: offId("LP"), template_id: 1, industry_ids: [1] }),
  "FR-43", "a Sales User creating a pipeline", ["crm.setup.manage"]);
refused(() => C.saveStages(SIDDIQUE, pipe.id, { stages: ps() }), "FR-43", "a Sales User editing stages");
refused(() => C.setRequirement(SIDDIQUE, { pipeline_stage_id: xg.id, field_key: "location", level: 1 }), "FR-43", "a Sales User editing the requirement matrix");
refused(() => C.saveField(SIDDIQUE, { key: "x", label: "X", type: "text" }), "FR-43", "a Sales User editing the field catalogue");
refused(() => C.saveReference(SIDDIQUE, "industry", { name: "X" }), "FR-43", "a Sales User editing reference data");
refused(() => C.saveMovementRules(SIDDIQUE, { allowSkip: true }), "FR-43", "a Sales User editing movement rules");
ok(C.crmBootstrap(SIDDIQUE).canLead, "FR-43 a Sales User can work leads");
ok(!C.crmBootstrap(SIDDIQUE).canSetup, "FR-43 a Sales User cannot reach Setup");
ok(C.crmBootstrap(VIKRAM).canSetup, "FR-43 an Administrator can reach Setup");
refused(() => C.createLead(PLMONLY, { company: "X" }), "FR-43", "a user with no CRM role at all");
ok(!C.hasCRM(PLMONLY), "FR-43 a PLM-only user has no CRM access");
ok(C.hasCRM(SIDDIQUE), "FR-43 a CRM Sales User has CRM access");

for (const key of Object.keys(C.CRM_REPORTS)) {
  const r = C.crmReport(key);
  ok(Array.isArray(r.rows) && r.columns.length > 0, `${key} builds with columns even when empty`);
  ok(C.crmReportCSV(key).length > 0, `${key} exports CSV with its headings`);
}
const dash = C.crmDashboard(VIKRAM);
const rpt6 = C.crmReport("CRM-06");
eq(rpt6.rows.reduce((n, r) => n + r["Leads blocked"], 0) > 0 ? dash.kpi.blocked > 0 : dash.kpi.blocked === 0, true,
  "FR-30 RPT-06 and the dashboard's blocked count agree");
const distinctBlocked = new Set();
for (const l of C.listLeads().filter(x => !x.lost && x.pipeline_id && (x.missing || []).length)) distinctBlocked.add(l.id);
eq(dash.kpi.blocked, distinctBlocked.size, "FR-24 the blocked tile counts distinct leads, computed independently");

// The PLM hand-off: a product entering Seeding raises a prompt on the content calendar.
const prod = A.createProduct(SOLH, {
  name: "Handoff Test Product", problem: "Proves the Seeding hand-off.", origin: "Internal Tool",
  route: "Ideate", owner_user_id: BH.id, next_action: "n"
});
db.run("UPDATE products SET track='development', stage_id=(SELECT id FROM stages WHERE track='development' AND seq=8) WHERE id=?", prod.id);
db.run(`INSERT INTO gate_approvals(product_id,stage_id,decision,actor_user_id,created_at)
        VALUES(?,(SELECT id FROM stages WHERE track='development' AND seq=8),'Approved',?,datetime('now'))`, prod.id, CEOU.id);
eq(C.listPrompts("Open").length, 0, "no launch prompt exists before the product reaches Seeding");
A.recordDeployment(BH, prod.id, { client_ref: "First paid client", deployed_on: today(), revenue: 50000 });
eq(A.getProduct(prod.id).stage_name, "Seeding", "BR-11 the first paid deployment moves the product into Seeding");
const openPrompts = C.listPrompts("Open");
eq(openPrompts.length, 1, "a product entering Seeding raises exactly one content-calendar prompt");
eq(openPrompts[0].product_code, prod.code, "the prompt names the product that entered Seeding");
ok(openPrompts[0].title.includes("Handoff Test Product"), "the prompt is titled for the product");
ok(!!openPrompts[0].due_date, "the prompt carries a due date on the calendar");
ok(db.col(`SELECT COUNT(*) FROM notifications n JOIN user_roles ur ON ur.user_id=n.user_id
           JOIN roles r ON r.id=ur.role_id WHERE n.kind='content' AND r.permissions LIKE '%crm.content.manage%'`) > 0,
  "everyone who plans content is notified when a product enters Seeding");
ok(db.col("SELECT COUNT(*) FROM notifications WHERE kind='content' AND user_id=?", SHIREEN.id) > 0,
  "the marketing lead is among those notified");
A.recordDeployment(BH, prod.id, { client_ref: "Second client", deployed_on: today(), revenue: 20000 });
eq(C.listPrompts("Open").length, 1, "a second deployment does not raise a duplicate prompt");

// Turning the prompt into a content item resolves it (BR-31 still applies).
refused(() => C.saveContent(SHIREEN, null, { date: today(), title: "Launch", channel_id: cc, person_id: SHIREEN.id, prompt_id: openPrompts[0].id }),
  "BR-31", "planning from a prompt still requires a content type");
const launch = C.saveContent(SHIREEN, null, { date: today(), title: "Handoff Test Product is live",
  type_id: ct, channel_id: cc, person_id: SHIREEN.id, prompt_id: openPrompts[0].id });
eq(C.listPrompts("Open").length, 0, "planning the content closes the prompt");
eq(db.col("SELECT content_id FROM content_prompt WHERE id=?", openPrompts[0].id), launch.id, "the prompt links to the content item it became");
refused(() => C.dismissPrompt(SHIREEN, openPrompts[0].id, { reason: "Already planned, so this must refuse." }),
  "FR-18", "dismissing a prompt that has already been dealt with");

/* ================= end-to-end (§11 rule 4) ================= */
// copyMatrix above deliberately replaced every pipeline's matched stages, which is what FR-37 does.
// Put the §9.8 defaults back so the walk below exercises the shipped configuration.
for (const p of db.all("SELECT id FROM pipeline")) seedDefaultRequirements(p.id);
const stxGateKeys = db.all(`SELECT r.field_key FROM stage_requirement r JOIN pipeline_stage s ON s.id=r.pipeline_stage_id
  WHERE s.is_gate=1 AND s.pipeline_id=(SELECT id FROM pipeline WHERE offering_id=? LIMIT 1)`, offId("STX"))
  .map(r => r.field_key);
ok(GATE_REQUIREMENTS.every(k => stxGateKeys.includes(k)),
  "§9.8 defaults restored on the gate before the end-to-end walk (the copied Location requirement stays, as FR-37 intends)");

const z = C.createLead(SIDDIQUE, { company: "Endtoend Trading LLC" });
C.updateLead(SIDDIQUE, z.id, { offering: offId("STX"), industry: idOf("industry", "Trading and distribution") });
const zStages = C.pipelineStages(C.getLead(z.id).pipeline_id);
const zGate = zStages.find(s => s.is_gate).seq;
for (let s = 2; s < zGate; s++) C.attemptMove(SIDDIQUE, z.id, { to_seq: s });
refused(() => C.attemptMove(SIDDIQUE, z.id, { to_seq: zGate }), "BR-16", "end-to-end: refused at the gate");
const fills = [["customer", "Aisha Noor"], ["designation", "Director"], ["contact", "+971 4 000 0000"],
  ["email", "aisha@endtoend.example"], ["segment", idOf("customer_segment", "Trading & Distribution / Manufacturing")],
  ["activity", "Stock accuracy review"], ["location", "Dubai"]];
for (const [k, v] of fills) {
  C.updateLead(SIDDIQUE, z.id, { [k]: v });
  refused(() => C.attemptMove(SIDDIQUE, z.id, { to_seq: zGate }), "BR-16", `end-to-end: still refused after filling ${k}`);
}
C.updateLead(SIDDIQUE, z.id, { channel: idOf("channel", "Business Community") });
C.attemptMove(SIDDIQUE, z.id, { to_seq: zGate });
eq(C.getLead(z.id).stage_seq, zGate, "end-to-end: the gate is passed once the last field is recorded");
refused(() => C.attemptMove(SIDDIQUE, z.id, { to_seq: zGate + 2 }), "BR-21", "end-to-end: a skip is refused");
refused(() => C.attemptMove(SIDDIQUE, z.id, { to_seq: zGate - 1 }), "BR-22", "end-to-end: a backward move with no reason is refused");
C.markLost(SIDDIQUE, z.id, { reason: "Budget deferred to the next financial year." });
eq(C.getLead(z.id).status, "Lost", "end-to-end: the lead is marked lost");
C.reopenLead(SIDDIQUE, z.id, { reason: "Budget released earlier than expected." });
for (let s = zGate + 1; s <= zStages.length; s++) C.attemptMove(SIDDIQUE, z.id, { to_seq: s });
eq(C.getLead(z.id).stage_band, "Closed", "end-to-end: the lead reaches the Closed band");
eq(C.getLead(z.id).status, "Won", "end-to-end: a lead at a Closed-band stage reports Won");
const zHist = db.all("SELECT * FROM lead_stage_history WHERE lead_id=? ORDER BY id", z.id);
eq(zHist.length, 1 + (zGate - 2) + 1 + 1 + 1 + (zStages.length - zGate),
  "end-to-end: every derivation, move, loss and reopen wrote exactly one history row");
ok(zHist.every((h, i) => !i || h.id > zHist[i - 1].id), "BR-24 end-to-end: history rows are in append order");

/* ================= done ================= */
try { db.db.close(); } catch { /* already closed */ }
for (const f of [tmp, tmp + "-wal", tmp + "-shm"]) { try { fs.rmSync(f, { force: true }); } catch { /* Windows may hold it */ } }
console.log(`\n  ${pass} assertions, ${failures} failures.\n`);
process.exit(failures ? 1 : 0);
