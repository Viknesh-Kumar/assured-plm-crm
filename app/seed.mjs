// Reference data, stage model, users and the reconstructed portfolio (BRD §22).
// Runs once against an empty database; safe to re-run (it no-ops if roles exist).
import { db, all, one, run, col, setSetting, getSetting } from "./db.mjs";
import { hashPassword, iso, addWorkingDays } from "./lib.mjs";

export const PERMISSIONS = [
  ["product.create",    "Create product records"],
  ["product.edit",      "Edit product records"],
  ["criteria.mark",     "Mark gate exit criteria met"],
  ["gate.submit",       "Submit a gate for approval"],
  ["effort.log",        "Log consultant effort"],
  ["deployment.record", "Record a client deployment"],
  ["revenue.confirm",   "Confirm attributed revenue"],
  ["product.park",      "Park a product (On Hold)"],
  ["kill.recommend",    "Recommend a kill"],
  ["kill.approve",      "Approve a kill or withdrawal"],
  ["market.change",     "Change a market state"],
  ["entry.override",    "Override the derived entry gate"],
  ["owner.change",      "Change the product owner"],
  ["stagemodel.manage", "Maintain the stage model and exit criteria"],
  ["users.manage",      "Maintain users and role assignments"],
  ["settings.manage",   "Maintain system settings and reference data"],
  ["crm.lead.manage",   "CRM — create and work leads"],
  ["crm.content.manage","CRM — plan and publish content"],
  ["crm.setup.manage",  "CRM — configure pipelines, stages, requirements and reference data"]
];

const ROLES = [
  ["Product Head", "Administers the system: users, roles, the stage model, exit criteria and reference data. Approves no gate by default.",
    "product.create,product.edit,users.manage,stagemodel.manage,settings.manage,crm.setup.manage,crm.lead.manage,crm.content.manage"],
  ["CEO", "Chief Executive Officer. Approves gates 3 and 8, all kills and all withdrawals. Chairs the quarterly portfolio review.",
    "product.edit,kill.approve,effort.log,stagemodel.manage"],
  ["Business Head", "Process owner. Approves gates 1, 2 and 7. Owns all six market states.",
    "product.create,product.edit,criteria.mark,gate.submit,effort.log,deployment.record,product.park,kill.recommend,market.change,entry.override,owner.change"],
  ["Solutions Head", "System owner. Approves gates 4, 5 and 6. Accountable for the accuracy of the register.",
    "product.create,product.edit,criteria.mark,gate.submit,effort.log,deployment.record,owner.change,stagemodel.manage,users.manage,settings.manage"],
  ["Solutions Team", "Stage owner for gates 1, 4, 5 and 6. Performs the work and logs effort. Approves nothing.",
    "product.create,product.edit,criteria.mark,gate.submit,effort.log,deployment.record"],
  ["Finance Head", "Consulted at gates 3 and 8. Confirms attributed revenue for portfolio reporting.",
    "effort.log,revenue.confirm"],
  ["Projects Head", "Consulted at gates 4 and 7. Confirms delivery readiness.",
    "effort.log,deployment.record"]
];

const DEV_STAGES = [
  { seq: 1, name: "Conceptualization", owner: "Solutions Team", approver: "Business Head", participants: [], target: 10, ageing: 15, escalate: "Business Head",
    purpose: "Capture the idea in a form that can be judged, and establish that it is a problem worth the firm's attention.",
    crit: ["Problem statement written and signed by the product owner", "At least three comparable clients named", "Product owner formally assigned"] },
  { seq: 2, name: "Value Proposition", owner: "Solutions Head", approver: "Business Head", participants: [], target: 10, ageing: 15, escalate: "Business Head",
    purpose: "State what the product is worth to a client, and why a client would choose it over continuing as they are.",
    crit: ["Value proposition one-pager complete", "Differentiation against the client's status quo stated", "Target buyer role identified"] },
  { seq: 3, name: "Business Case", owner: "Business Head", approver: "CEO", participants: ["Solutions Head", "Finance Head"], target: 15, ageing: 23, escalate: "CEO",
    purpose: "Decide whether the firm commits consultant capacity to building the product.",
    crit: ["Cost to build estimated in consultant days", "Revenue model defined", "Payback within eighteen months demonstrated", "Finance Head has reviewed and recorded comment"] },
  { seq: 4, name: "Validation", owner: "Solutions Team", approver: "Solutions Head", participants: ["Projects Head"], target: 20, ageing: 30, escalate: "Solutions Head",
    purpose: "Test demand with real clients before build effort is committed.",
    crit: ["Three client conversations logged against the product record", "Willingness-to-pay evidence captured", "Scope frozen for the build"] },
  { seq: 5, name: "Prototyping", owner: "Solutions Team", approver: "Solutions Head", participants: [], target: 25, ageing: 38, escalate: "Solutions Head",
    purpose: "Prove the product can be built as scoped, and re-estimate the remaining effort on evidence.",
    crit: ["Working prototype demonstrable end to end", "Internal demonstration passed", "Effort to complete re-estimated and variance against budget reported"] },
  { seq: 6, name: "Development", owner: "Solutions Team", approver: "Solutions Head", participants: [], target: 40, ageing: 60, escalate: "Solutions Head",
    purpose: "Build the product to the frozen scope and to a standard another consultant can deliver from.",
    crit: ["Build complete against the frozen scope", "Configuration and user documentation written", "Handover pack prepared for Projects"] },
  { seq: 7, name: "Testing", owner: "Solutions Head", approver: "Business Head", participants: ["Projects Head"], target: 15, ageing: 23, escalate: "Business Head",
    purpose: "Establish that the product can be delivered to a client by someone who did not build it.",
    crit: ["UAT script executed and passed", "All severity-one and severity-two defects closed", "Projects Head confirms delivery readiness"] },
  { seq: 8, name: "Pricing", owner: "Business Head", approver: "CEO", participants: ["Finance Head", "Solutions Head"], target: 10, ageing: 15, escalate: "CEO",
    purpose: "Set the commercial terms on which the product will be sold, before it is offered to any client.",
    crit: ["Price card approved", "Margin floor set with Finance", "Consultant commission model agreed", "CEO sign-off recorded"] }
];

const MKT_STAGES = [
  { seq: 1, name: "Seeding", participants: ["Solutions Head", "Finance Head", "Projects Head"],
    definition: "First paid deployments are being made. Pricing is still being tested and the delivery method is still being refined.",
    entry: "First signed client engagement in which the product is deployed.",
    exit: "Three deployments completed and a price repeated without material discount." },
  { seq: 2, name: "Market Launch", participants: ["Solutions Head", "Finance Head", "Projects Head"],
    definition: "The product is formally in the offering catalogue and in the standard sales approach. Pricing is stable.",
    entry: "Pricing has held across three deployments and the delivery method is documented.",
    exit: "Deployment count rises in two consecutive quarters." },
  { seq: 3, name: "Growth", participants: ["Solutions Head", "Finance Head", "Projects Head"],
    definition: "Deployment count is rising quarter on quarter. Delivery capacity, not demand, is the constraint.",
    entry: "Deployment count rising in two consecutive quarters.",
    exit: "Deployment count flat across two consecutive quarters." },
  { seq: 4, name: "Mature", participants: ["Finance Head", "Projects Head"],
    definition: "Deployment count is stable. Effort is maintenance only. The product is a dependable contributor.",
    entry: "Deployment count stable across two consecutive quarters and effort reduced to maintenance.",
    exit: "Deployment count falls in two consecutive quarters." },
  { seq: 5, name: "Decline", participants: ["Finance Head", "Projects Head"],
    definition: "Deployment count is falling across consecutive quarters. A decision on upgrade or withdrawal is required.",
    entry: "Deployment count falls in two consecutive quarters.",
    exit: "Either an Upgrade successor is registered, or withdrawal is approved." },
  { seq: 6, name: "Die", participants: ["Finance Head", "Projects Head"],
    definition: "The product is withdrawn. It is no longer offered and is retained only as reference material.",
    entry: "Withdrawal approved by the CEO at the quarterly portfolio review.",
    exit: "Terminal. No exit." }
];

export const ROUTE_ENTRY = { Ideate: 1, Replace: 3, Replicate: 4, Upgrade: 5 };

const SETTINGS = [
  ["day_rate", "1800", "Internal consultant day rate (AED)", "number"],
  ["currency", "AED", "Reporting currency", "text"],
  ["weekend_days", "6,0", "Weekend days for working-day counts (0=Sun … 6=Sat)", "text"],
  ["closure_reason_min", "50", "Minimum characters in a closure reason (BR-25)", "number"],
  ["gate_sla_days", "3", "Gate decision service level, working days", "number"],
  ["consult_sla_days", "2", "Consultation comment service level, working days", "number"],
  ["return_sla_days", "5", "Resubmission after return, working days", "number"],
  ["payback_months", "18", "Gate 3 payback hurdle, months", "number"],
  ["thr_seed_launch", "3", "BR-14 Seeding → Market Launch: deployments completed", "number"],
  ["thr_launch_growth", "2", "BR-15 Market Launch → Growth: consecutive quarters rising", "number"],
  ["thr_growth_mature", "2", "BR-16 Growth → Mature: consecutive quarters flat", "number"],
  ["thr_mature_decline", "2", "BR-17 Mature → Decline: consecutive quarters falling", "number"],
  ["decline_window_days", "90", "BR-19 Decline decision window, calendar days", "number"],
  ["org_name", "Assured Grow Consultancy LLC", "Organisation name", "text"],
  ["product_code_next", "1", "Next product number for P-nnn (never reused, BR-01)", "number"]
];

const ORIGINS = ["New Idea", "Client Problem", "Existing Client App", "Proven Reusable Solution", "Internal Tool"];

/* ---------------------------------------------------------------- */

export function seedIfEmpty() {
  if (col("SELECT COUNT(*) FROM roles")) return false;
  const pw = process.env.PLM_SEED_PASSWORD || "Assured@2026";

  db.exec("BEGIN");
  try {
    ROLES.forEach(([name, desc, perms], i) =>
      run("INSERT INTO roles(name,description,permissions,is_system,sort) VALUES(?,?,?,1,?)", name, desc, perms, i));
    const roleId = n => col("SELECT id FROM roles WHERE name=?", n);

    for (const s of DEV_STAGES) {
      run(`INSERT INTO stages(seq,track,name,purpose,owner_role_id,approver_role_id,target_days,ageing_days,escalate_role_id)
           VALUES(?,'development',?,?,?,?,?,?,?)`,
        s.seq, s.name, s.purpose, roleId(s.owner), roleId(s.approver), s.target, s.ageing, roleId(s.escalate));
      const sid = col("SELECT id FROM stages WHERE track='development' AND seq=?", s.seq);
      s.participants.forEach(r => run("INSERT INTO stage_participant(stage_id,role_id) VALUES(?,?)", sid, roleId(r)));
      s.crit.forEach((t, i) => run("INSERT INTO exit_criteria(stage_id,seq,text) VALUES(?,?,?)", sid, i + 1, t));
    }
    for (const s of MKT_STAGES) {
      run(`INSERT INTO stages(seq,track,name,definition,owner_role_id,approver_role_id,entry_condition,exit_condition)
           VALUES(?,'market',?,?,?,NULL,?,?)`,
        s.seq, s.name, s.definition, roleId("Business Head"), s.entry, s.exit);
      const sid = col("SELECT id FROM stages WHERE track='market' AND seq=?", s.seq);
      s.participants.forEach(r => run("INSERT INTO stage_participant(stage_id,role_id) VALUES(?,?)", sid, roleId(r)));
    }

    SETTINGS.forEach(([k, v, l, t]) => setSetting(k, v, l, t));
    setSetting("origins", ORIGINS.join("|"), "Origin picklist (BR-34)", "list");
    setSetting("routes", Object.keys(ROUTE_ENTRY).join("|"), "Development route picklist (BR-34)", "list");
    setSetting("route_entry", JSON.stringify(ROUTE_ENTRY), "Derived entry gate by route (BR-04)", "json");

    // A clean install ships exactly one account: the Product Head, who configures everyone else.
    const email = process.env.PLM_ADMIN_EMAIL || "producthead@assured.local";
    run(`INSERT INTO users(name,email,title,password_hash,active,must_change,created_at)
         VALUES(?,?,?,?,1,1,datetime('now'))`,
      "Product Head", email, "Product Head", hashPassword(pw));
    run("INSERT INTO user_roles(user_id,role_id) VALUES((SELECT id FROM users WHERE email=?),?)",
      email, roleId("Product Head"));

    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }

  console.log(`  Seeded ${ROLES.length} roles, the 14-stage model with its exit criteria, and one administrator.`);
  console.log(`  Sign in as ${process.env.PLM_ADMIN_EMAIL || "producthead@assured.local"} — password "${pw}".`);
  console.log("  No sample data. `npm run demo` loads an illustrative portfolio if you want one.");
  return true;
}

