// Illustrative PLM portfolio — the fifteen products from plm-prototype.html, so the register can be
// shown before real data exists. NOT part of the seed: run it deliberately with `npm run demo`.
import { db, all, one, run, col, setSetting } from "./db.mjs";
import { seedIfEmpty, ROUTE_ENTRY } from "./seed.mjs";
import { hashPassword, iso } from "./lib.mjs";

seedIfEmpty();

if (col("SELECT COUNT(*) FROM products")) {
  console.log("\n  PLM demo data not loaded — the register already holds products. Run `npm run reset` first.\n");
  process.exit(0);
}

const pw = process.env.PLM_SEED_PASSWORD || "Assured@2026";
const DEMO_USERS = [
  ["Chief Executive", "ceo@assured.local", "Chief Executive Officer", "CEO"],
  ["Business Head", "business.head@assured.local", "Business Head", "Business Head"],
  ["Solutions Head", "solutions.head@assured.local", "Solutions Head", "Solutions Head"],
  ["Finance Head", "finance.head@assured.local", "Finance Head", "Finance Head"],
  ["Projects Head", "projects.head@assured.local", "Projects Head", "Projects Head"],
  ["Solutions Consultant 1", "consultant1@assured.local", "Consultant", "Solutions Team"],
  ["Solutions Consultant 2", "consultant2@assured.local", "Consultant", "Solutions Team"]
];

/* ---------------- portfolio carried from the prototype ---------------- */
const PORTFOLIO = [
  { code: "P-001", name: "Process Miner", origin: "Internal Tool", route: "Ideate", client: "Internal — Odoo practice",
    problem: "Extracts as-is process flows from live ERP transaction logs, replacing weeks of manual discovery.",
    owner: "Solutions Head", track: "development", stage: 6, status: "Active", entered: "2026-05-12",
    target: "2026-07-31", revised: "2026-09-15", revs: 2, effort: 48, deploy: 0, rev: 0,
    next: "Close the remaining Odoo connector defects and freeze v0.2 scope", actionOwner: "Solutions Team",
    crit: [1, 1, 0],
    hist: [["2026-01-20", 1], ["2026-02-14", 2], ["2026-03-03", 3], ["2026-03-28", 4], ["2026-04-19", 5], ["2026-05-12", 6]] },
  { code: "P-002", name: "Discovery Co-Pilot", origin: "Internal Tool", route: "Ideate", client: "Internal — Consulting",
    problem: "Adaptive interview tool that runs structured discovery sessions and drafts the current-state write-up.",
    owner: "Solutions Head", track: "development", stage: 7, status: "Active", entered: "2026-07-28",
    target: "2026-09-05", revised: "", revs: 1, effort: 31, deploy: 2, rev: 0,
    next: "Complete UAT round 2 with the Projects team on two live engagements", actionOwner: "Solutions Head",
    crit: [1, 1, 1],
    hist: [["2026-03-02", 1], ["2026-03-24", 2], ["2026-04-15", 3], ["2026-05-06", 4], ["2026-06-01", 5], ["2026-06-24", 6], ["2026-07-28", 7]] },
  { code: "P-003", name: "Data Analyst Agent", origin: "Client Problem", route: "Ideate", client: "Client — Manufacturing",
    problem: "Conversational analysis layer over client finance and operations extracts; delivered as a Streamlit MVP.",
    owner: "Solutions Team", track: "development", stage: 7, status: "Rework", entered: "2026-06-02",
    target: "2026-07-15", revised: "2026-08-30", revs: 3, effort: 39, deploy: 0, rev: 0,
    next: "Rebuild the chart layer after UAT failed on multi-file joins", actionOwner: "Solutions Team",
    crit: [1, 0, 0],
    hist: [["2026-01-08", 1], ["2026-01-29", 2], ["2026-02-20", 3], ["2026-03-17", 4], ["2026-04-08", 5], ["2026-04-30", 6], ["2026-06-02", 7]] },
  { code: "P-004", name: "Sales CRM for SMEs", origin: "New Idea", route: "Ideate", client: "Internal — Business",
    problem: "Lightweight pipeline and activity tracker for mid-market clients who will not carry a full CRM licence.",
    owner: "Business Head", track: "development", stage: 3, status: "Active", entered: "2026-08-04",
    target: "2026-09-12", revised: "", revs: 0, effort: 9, deploy: 0, rev: 0,
    next: "Complete the payback model with Finance Head ahead of CEO review", actionOwner: "Business Head",
    crit: [1, 1, 0, 0], hist: [["2026-06-02", 1], ["2026-07-11", 2], ["2026-08-04", 3]] },
  { code: "P-005", name: "BHOOP Diagnostic Scoring", origin: "Internal Tool", route: "Ideate", client: "Internal — Consulting",
    problem: "Relative, improvement-based scoring model used to benchmark a client's transformation readiness.",
    owner: "Business Head", track: "market", mkt: 1, status: "Active", entered: "2026-06-20",
    target: "", revised: "", revs: 0, effort: 22, deploy: 4, rev: 145000,
    next: "Convert 2 seeded clients into repeat engagements", actionOwner: "Business Head", crit: [],
    hist: [["2025-10-02", 1], ["2025-11-20", 3], ["2026-02-10", 6], ["2026-05-05", 8], ["2026-06-20", "m1"]] },
  { code: "P-006", name: "ART Model Sales Playbook", origin: "Internal Tool", route: "Ideate", client: "Internal — Business",
    problem: "Structured sales methodology and collateral set used by consultants to convert diagnostic work into mandates.",
    owner: "Business Head", track: "market", mkt: 2, status: "Active", entered: "2026-04-15",
    target: "", revised: "", revs: 0, effort: 18, deploy: 6, rev: 210000,
    next: "Publish v2 with the GCC manufacturing vertical variant", actionOwner: "Business Head", crit: [],
    hist: [["2025-08-14", 1], ["2025-10-30", 3], ["2026-01-16", 6], ["2026-03-02", 8], ["2026-03-20", "m1"], ["2026-04-15", "m2"]] },
  { code: "P-007", name: "BSS Programme", origin: "Internal Tool", route: "Ideate", client: "Internal — Consulting",
    problem: "Building Scalable Systems: a packaged operating-model programme delivered over a 12-week client cycle.",
    owner: "Business Head", track: "market", mkt: 3, status: "Active", entered: "2025-11-10",
    target: "", revised: "", revs: 0, effort: 64, deploy: 11, rev: 780000,
    next: "Add a second delivery pod to absorb Q4 demand", actionOwner: "Projects Head", crit: [],
    hist: [["2025-01-15", 1], ["2025-03-20", 3], ["2025-06-11", 6], ["2025-08-02", 8], ["2025-09-01", "m1"], ["2025-10-05", "m2"], ["2025-11-10", "m3"]] },
  { code: "P-008", name: "MSCET Qualification Framework", origin: "Internal Tool", route: "Ideate", client: "Internal — Business",
    problem: "Opportunity qualification framework applied at first contact to filter engagements before proposal effort.",
    owner: "Solutions Head", track: "market", mkt: 4, status: "Active", entered: "2025-03-01",
    target: "", revised: "", revs: 0, effort: 41, deploy: 19, rev: 460000,
    next: "Annual refresh — recalibrate thresholds against FY26 win data", actionOwner: "Business Head", crit: [],
    hist: [["2024-05-10", 1], ["2024-07-22", 3], ["2024-09-30", 6], ["2024-11-14", 8], ["2024-12-05", "m1"], ["2025-01-20", "m2"], ["2025-02-10", "m3"], ["2025-03-01", "m4"]] },
  { code: "P-009", name: "Cheque Register Extractor", origin: "Existing Client App", route: "Replicate", client: "Client — Real estate",
    problem: "Converts scanned cheque registers into a reconciled schedule; built twice for property clients already.",
    owner: "Solutions Team", track: "development", stage: 4, status: "Active", entered: "2026-08-11",
    target: "2026-09-08", revised: "", revs: 0, effort: 6, deploy: 2, rev: 0,
    next: "Test willingness to pay with 3 comparable property managers", actionOwner: "Solutions Team",
    crit: [1, 0, 0], hist: [["2026-08-11", 4]] },
  { code: "P-010", name: "Warehouse Space Planner", origin: "Client Problem", route: "Ideate", client: "Client — Logistics",
    problem: "Models rack layout and storage utilisation against an inbound profile to size warehouse space.",
    owner: "Solutions Team", track: "development", stage: 1, status: "Active", entered: "2026-08-18",
    target: "2026-09-30", revised: "", revs: 0, effort: 3, deploy: 0, rev: 0,
    next: "Write the problem statement and name 3 comparable clients", actionOwner: "Solutions Team",
    crit: [0, 0, 1], hist: [["2026-08-18", 1]] },
  { code: "P-011", name: "Shipping Line Reporting Automation", origin: "Existing Client App", route: "Replicate", client: "Client — Shipping",
    problem: "Automates the monthly operations and revenue reporting pack for shipping agencies.",
    owner: "Business Head", track: "development", stage: 8, status: "Active", entered: "2026-08-06",
    target: "2026-09-01", revised: "", revs: 1, effort: 27, deploy: 1, rev: 0,
    next: "Agree the margin floor with Finance Head before CEO sign-off", actionOwner: "Business Head",
    crit: [1, 1, 1, 1],
    hist: [["2026-04-02", 4], ["2026-05-14", 5], ["2026-06-10", 6], ["2026-07-08", 7], ["2026-08-06", 8]] },
  { code: "P-012", name: "Flight Support Coordination Suite", origin: "Client Problem", route: "Replace", client: "Client — Medical travel",
    problem: "Coordination workspace for medical transfer and flight support cases, replacing a spreadsheet-based process.",
    owner: "Solutions Team", track: "development", stage: 5, status: "On Hold", entered: "2026-03-30",
    target: "2026-06-15", revised: "2026-10-01", revs: 4, effort: 57, deploy: 0, rev: 0,
    next: "Decision required — resume, narrow scope, or kill", actionOwner: "Business Head",
    hold_resume: "2026-10-01", hold_reason: "Delivery capacity committed to two client programmes until October.",
    crit: [0, 0, 0], hist: [["2025-12-04", 3], ["2026-01-22", 4], ["2026-03-30", 5]] },
  { code: "P-013", name: "Legacy KPI Dashboard Pack", origin: "Existing Client App", route: "Upgrade", client: "Client — Multiple",
    problem: "Standard Power BI KPI pack; being displaced by clients' own native reporting layers.",
    owner: "Business Head", track: "market", mkt: 5, status: "Active", entered: "2026-02-14",
    target: "", revised: "", revs: 0, effort: 35, deploy: 8, rev: 190000,
    next: "Decide between upgrade to embedded analytics or planned withdrawal", actionOwner: "Business Head", crit: [],
    hist: [["2024-02-10", 6], ["2024-05-01", 8], ["2024-06-15", "m2"], ["2024-11-20", "m3"], ["2025-06-10", "m4"], ["2026-02-14", "m5"]] },
  { code: "P-014", name: "Manual VAT Filing Toolkit", origin: "Existing Client App", route: "Replace", client: "Client — Tax practice",
    problem: "Spreadsheet toolkit for preparing VAT returns; superseded by the regulator's own portal functionality.",
    owner: "Finance Head", track: "market", mkt: 6, status: "Closed", entered: "2026-07-01",
    target: "", revised: "", revs: 0, effort: 12, deploy: 3, rev: 42000,
    next: "Archived — retained as reference material only", actionOwner: "Finance Head", crit: [],
    closure: "Withdrawn at the June 2026 quarterly portfolio review. The regulator's own portal now performs the same calculation at no cost, so no further redeployment is possible; 12 consultant days are written off against 3 completed deployments.",
    hist: [["2025-04-08", 6], ["2025-06-02", 8], ["2025-06-25", "m2"], ["2025-12-01", "m4"], ["2026-04-18", "m5"], ["2026-07-01", "m6"]] },
  { code: "P-015", name: "Job Description Manual Builder", origin: "Proven Reusable Solution", route: "Replicate", client: "Client — Healthcare group",
    problem: "Generates a role-by-role JD manual from an org structure; proven on a 67-role build.",
    owner: "Solutions Head", track: "development", stage: 2, status: "Active", entered: "2026-08-01",
    target: "2026-09-10", revised: "", revs: 0, effort: 11, deploy: 1, rev: 0,
    next: "Draft the value proposition one-pager and name the target buyer", actionOwner: "Solutions Head",
    crit: [0, 1, 0], override: 1,
    override_reason: "The 67-role build was delivered as a bespoke manual, not as a product. The concept and the value proposition have never been articulated for a wider market, so the Business Head set entry at gate 1 rather than the derived gate 4.",
    hist: [["2026-07-14", 1], ["2026-08-01", 2]] }
];


db.exec("BEGIN");
try {
  const roleId = n => col("SELECT id FROM roles WHERE name=?", n);
  for (const [name, email, title, role] of DEMO_USERS) {
    if (!col("SELECT id FROM users WHERE email=?", email))
      run(`INSERT INTO users(name,email,title,password_hash,active,must_change,created_at)
           VALUES(?,?,?,?,1,1,datetime('now'))`, name, email, title, hashPassword(pw));
    run("INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)",
      col("SELECT id FROM users WHERE email=?", email), roleId(role));
  }
  seedPortfolio(roleId);
  // The demo occupies P-001…P-015, so the next real product is P-016 (BR-01 never reuses an identifier).
  setSetting("product_code_next", PORTFOLIO.length + 1);
  db.exec("COMMIT");
} catch (e) { db.exec("ROLLBACK"); throw e; }

console.log(`\n  PLM demo data loaded: ${DEMO_USERS.length} role users and ` +
  `${col("SELECT COUNT(*) FROM products")} products carrying ` +
  `${col("SELECT ROUND(SUM(days),0) FROM effort_entries")} consultant days.`);
console.log(`  Every demo account uses the password "${pw}" and is flagged must-change.\n`);

function seedPortfolio(roleId) {
  const userForRole = r => col(
    "SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE ur.role_id=? ORDER BY u.id LIMIT 1", roleId(r));
  const devStage = n => col("SELECT id FROM stages WHERE track='development' AND seq=?", n);
  const mktStage = n => col("SELECT id FROM stages WHERE track='market' AND seq=?", n);
  const stageOf = key => (typeof key === "string" && key[0] === "m") ? mktStage(+key.slice(1)) : devStage(key);
  const approverUser = sid => {
    const rid = col("SELECT approver_role_id FROM stages WHERE id=?", sid);
    return rid ? col("SELECT user_id FROM user_roles WHERE role_id=? LIMIT 1", rid) : null;
  };

  for (const p of PORTFOLIO) {
    const stageId = p.track === "development" ? devStage(p.stage) : mktStage(p.mkt);
    const ownerId = userForRole(p.owner), actionId = userForRole(p.actionOwner);
    run(`INSERT INTO products(code,name,problem,origin,route,client_source,owner_user_id,entry_stage_id,
          track,stage_id,status,next_action,action_owner_user_id,target_date,revised_date,stage_entry_date,
          closure_reason,hold_resume_date,hold_reason,entry_override_reason,created_at,created_by,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,datetime('now'))`,
      p.code, p.name, p.problem, p.origin, p.route, p.client, ownerId, devStage(p.override || ROUTE_ENTRY[p.route]),
      p.track, stageId, p.status, p.next, actionId, p.target || null, p.revised || null, p.entered,
      p.closure || null, p.hold_resume || null, p.hold_reason || null, p.override_reason || null, ownerId);
    const pid = col("SELECT id FROM products WHERE code=?", p.code);

    // Stage history + a gate approval for every completed development gate.
    p.hist.forEach(([date, key], i) => {
      const sid = stageOf(key), next = p.hist[i + 1];
      const track = (typeof key === "string" && key[0] === "m") ? "market" : "development";
      run(`INSERT INTO stage_history(product_id,stage_id,track,entered_on,exited_on,decision,from_stage_id,actor_user_id,note,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,datetime('now'))`,
        pid, sid, track, date, next ? next[0] : null, next ? "Advanced" : null,
        i ? stageOf(p.hist[i - 1][1]) : null, ownerId, i ? null : "Entered the register", );
      if (track === "development" && next) {
        const au = approverUser(sid);
        if (au) run(`INSERT INTO gate_approvals(product_id,stage_id,decision,actor_user_id,role_id,reason,submitted_at,created_at)
                     VALUES(?,?, 'Approved', ?, (SELECT approver_role_id FROM stages WHERE id=?), 'Migrated from the tracker workbook.', ?, ?)`,
          pid, sid, au, sid, next[0], next[0] + " 09:00:00");
      }
    });

    // Exit criteria for the current gate.
    if (p.track === "development" && p.crit?.length) {
      const crits = all("SELECT id FROM exit_criteria WHERE stage_id=? ORDER BY seq", stageId);
      crits.forEach((c, i) => {
        const met = p.crit[i] ? 1 : 0;
        run(`INSERT INTO criterion_status(product_id,criterion_id,stage_id,met,evidence,marked_by,marked_at)
             VALUES(?,?,?,?,?,?,?)`, pid, c.id, stageId, met,
          met ? "Evidence reconstructed at migration." : null, met ? ownerId : null, met ? p.entered + " 10:00:00" : null);
      });
    }

    // Effort spread across the months the product has been running (flagged as estimated — migration rule §22.3).
    if (p.effort > 0) {
      const start = p.hist[0][0].slice(0, 7), months = monthsBetween(start, p.entered.slice(0, 7));
      const per = Math.round((p.effort / months.length) * 10) / 10;
      let left = p.effort;
      months.forEach((m, i) => {
        const d = i === months.length - 1 ? Math.round(left * 10) / 10 : per;
        left -= d;
        if (d > 0) run(`INSERT INTO effort_entries(product_id,stage_id,period,days,consultant_user_id,estimated,note,logged_by,created_at)
                        VALUES(?,?,?,?,?,1,'Reconstructed at migration (§22.3).',?,datetime('now'))`,
          pid, stageOf(stageKeyAt(p, m)), m, d, actionId, ownerId);
      });
    }

    // Deployments, revenue split evenly and confirmed where the product carries revenue.
    if (p.deploy > 0) {
      const each = p.rev ? Math.round(p.rev / p.deploy) : 0;
      const remainder = p.rev ? p.rev - each * p.deploy : 0;   // give the crumbs to the first deployment
      const fin = userForRole("Finance Head"), bh = userForRole("Business Head");
      const first = p.track === "market" ? p.hist.find(h => String(h[1])[0] === "m")?.[0] || p.entered : p.entered;
      for (let i = 0; i < p.deploy; i++) {
        const on = minDate(shiftMonths(first, i * 2), "2026-08-26");
        run(`INSERT INTO deployments(product_id,client_ref,deployed_on,revenue,confirmed,confirmed_by,confirmed_at,created_by,created_at)
             VALUES(?,?,?,?,?,?,?,?,datetime('now'))`,
          pid, `${p.client.split("—").pop().trim()} ${i + 1}`, on, each + (i === 0 ? remainder : 0),
          each ? 1 : 0, each ? fin : null, each ? on : null, bh);
      }
    }

    // Date revisions (BR-24) — count carried from the workbook, reasons reconstructed.
    for (let i = 0; i < (p.revs || 0); i++)
      run(`INSERT INTO date_revisions(product_id,stage_id,old_date,new_date,reason,user_id,created_at)
           VALUES(?,?,?,?,?,?,datetime('now'))`,
        pid, stageId, p.target || null, p.revised || p.target || null,
        "Revision carried from the tracker workbook; original reason not recorded.", ownerId);
  }

  // Rework products have an outstanding return on the current gate.
  for (const p of PORTFOLIO.filter(x => x.status === "Rework")) {
    const pid = col("SELECT id FROM products WHERE code=?", p.code);
    const sid = col("SELECT stage_id FROM products WHERE id=?", pid);
    const rid = col("SELECT approver_role_id FROM stages WHERE id=?", sid);
    run(`INSERT INTO gate_approvals(product_id,stage_id,decision,actor_user_id,role_id,reason,created_at)
         VALUES(?,?, 'Returned', (SELECT user_id FROM user_roles WHERE role_id=? LIMIT 1), ?, ?, datetime('now'))`,
      pid, sid, rid, rid, "UAT failed on multi-file joins. Rebuild the chart layer and resubmit with a fresh UAT record.");
  }
}

const monthsBetween = (a, b) => {
  const out = []; let [y, m] = a.split("-").map(Number); const [by, bm] = b.split("-").map(Number);
  while (y < by || (y === by && m <= bm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return out.length ? out : [a];
};
const stageKeyAt = (p, ym) => {
  let key = p.hist[0][1];
  for (const [d, k] of p.hist) if (d.slice(0, 7) <= ym) key = k;
  return key;
};
const minDate = (a, b) => (a < b ? a : b);
const shiftMonths = (isoDate, n) => {
  const d = new Date(isoDate + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
};
