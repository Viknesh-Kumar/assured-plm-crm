// API handlers. Every business rule in BRD §11 is enforced here, not in the browser.
import { db, all, one, run, col, getSetting, setSetting, audit, notify } from "./db.mjs";
import { PERMISSIONS, ROUTE_ENTRY } from "./seed.mjs";
import { workingDays, addWorkingDays, today, iso, quarterOf, median, toCSV, hashPassword, verifyPassword, HttpError } from "./lib.mjs";
import { raiseSeedingPrompt } from "./crm.mjs";

export { HttpError };
const bad = (msg, rule) => { throw new HttpError(400, msg, rule); };
const denied = (msg, rule) => { throw new HttpError(403, msg, rule); };
const missing = msg => { throw new HttpError(404, msg); };

/* ------------------------------------------------------------------ */
/* user + permissions                                                  */
/* ------------------------------------------------------------------ */
export function loadUser(id) {
  const u = one("SELECT id,name,email,title,active,must_change FROM users WHERE id=? AND active=1", id);
  if (!u) return null;
  u.roles = all(`SELECT r.id,r.name,r.permissions FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?
                 ORDER BY r.sort, r.name`, id);
  u.roleIds = u.roles.map(r => r.id);
  u.roleNames = u.roles.map(r => r.name);
  u.permissions = [...new Set(u.roles.flatMap(r => (r.permissions || "").split(",").filter(Boolean)))];
  return u;
}
const can = (u, perm) => u.permissions.includes(perm);
const need = (u, perm) => { if (!can(u, perm)) denied(`Your roles (${u.roleNames.join(", ") || "none"}) do not carry "${perm}".`); };
const holdsRole = (u, roleId) => roleId != null && u.roleIds.includes(roleId);

const cfg = (k, d) => getSetting(k, d);
const num = (k, d) => Number(getSetting(k, d));
const WEEKEND = () => cfg("weekend_days", "6,0");

/* ------------------------------------------------------------------ */
/* product read model                                                  */
/* ------------------------------------------------------------------ */
const PRODUCT_SQL = `
SELECT p.*,
  s.name AS stage_name, s.seq AS stage_seq, s.track AS stage_track,
  s.target_days, s.ageing_days, s.purpose AS stage_purpose, s.definition AS stage_definition,
  s.entry_condition, s.exit_condition,
  s.owner_role_id, s.approver_role_id, s.escalate_role_id,
  ro.name AS stage_owner_role, ra.name AS approver_role, re.name AS escalate_role,
  uo.name AS owner_name, ua.name AS action_owner_name,
  es.seq AS entry_seq, es.name AS entry_stage_name,
  pre.code AS predecessor_code, pre.name AS predecessor_name,
  (SELECT COALESCE(SUM(days),0)    FROM effort_entries e WHERE e.product_id=p.id) AS effort,
  (SELECT COALESCE(SUM(days),0)    FROM effort_entries e WHERE e.product_id=p.id AND e.stage_id=p.stage_id) AS effort_stage,
  (SELECT COALESCE(SUM(days),0)    FROM effort_entries e WHERE e.product_id=p.id AND e.estimated=1) AS effort_estimated,
  (SELECT COUNT(*)                 FROM deployments d WHERE d.product_id=p.id) AS deployments,
  (SELECT COALESCE(SUM(revenue),0) FROM deployments d WHERE d.product_id=p.id AND d.confirmed=1) AS revenue,
  (SELECT COALESCE(SUM(revenue),0) FROM deployments d WHERE d.product_id=p.id AND d.confirmed=0) AS revenue_unconfirmed,
  (SELECT MIN(deployed_on)         FROM deployments d WHERE d.product_id=p.id) AS first_deployment,
  (SELECT COUNT(*)                 FROM date_revisions r WHERE r.product_id=p.id) AS revisions,
  (SELECT COUNT(*) FROM exit_criteria c WHERE c.stage_id=p.stage_id AND c.active=1) AS crit_total,
  (SELECT COUNT(*) FROM criterion_status cs JOIN exit_criteria c ON c.id=cs.criterion_id AND c.active=1
     WHERE cs.product_id=p.id AND cs.stage_id=p.stage_id AND cs.met=1) AS crit_met,
  (SELECT COUNT(*) FROM gate_approvals ga JOIN stages g ON g.id=ga.stage_id
     WHERE ga.product_id=p.id AND ga.decision='Approved' AND g.track='development' AND g.seq=8) AS pricing_approved,
  (SELECT COUNT(*) FROM kill_requests k WHERE k.product_id=p.id AND k.decision IS NULL) AS kill_pending
FROM products p
LEFT JOIN stages s   ON s.id = p.stage_id
LEFT JOIN stages es  ON es.id = p.entry_stage_id
LEFT JOIN roles  ro  ON ro.id = s.owner_role_id
LEFT JOIN roles  ra  ON ra.id = s.approver_role_id
LEFT JOIN roles  re  ON re.id = s.escalate_role_id
LEFT JOIN users  uo  ON uo.id = p.owner_user_id
LEFT JOIN users  ua  ON ua.id = p.action_owner_user_id
LEFT JOIN products pre ON pre.id = p.predecessor_id`;

function decorate(p) {
  if (!p) return p;
  const rate = num("day_rate", 1800);
  p.age_days = p.stage_entry_date ? workingDays(p.stage_entry_date, today(), WEEKEND()) : 0;
  p.due_date = p.revised_date || p.target_date;
  p.overdue = !!(p.due_date && p.status !== "Closed" && p.due_date < today());
  p.days_overdue = p.overdue ? workingDays(p.due_date, today(), WEEKEND()) : 0;
  p.stalled = p.track === "development" && p.status !== "Closed" && p.ageing_days != null && p.age_days > p.ageing_days;
  p.badly_stalled = p.stalled && p.age_days > p.ageing_days * 2;
  p.gate_ready = p.track === "development" && p.crit_total > 0 && p.crit_met >= p.crit_total;
  p.readiness = p.crit_total ? p.crit_met / p.crit_total : (p.track === "market" ? 1 : 0);
  p.awaiting_approval = !!p.submitted_at && p.track === "development";
  p.effort_value = Math.round(p.effort * rate);
  p.roi = p.effort_value ? p.revenue / p.effort_value : null;
  p.in_market = p.track === "market";
  p.exception = p.status !== "Closed" && (p.stalled || p.overdue || p.status === "On Hold" || p.status === "Rework");
  p.participant_roles = p.stage_id
    ? all("SELECT r.id,r.name FROM stage_participant sp JOIN roles r ON r.id=sp.role_id WHERE sp.stage_id=?", p.stage_id)
    : [];
  return p;
}

export const getProduct = id => decorate(one(`${PRODUCT_SQL} WHERE p.id=?`, id));
export const listProducts = () => all(`${PRODUCT_SQL} ORDER BY p.code`).map(decorate);
const mustProduct = id => getProduct(id) || missing("Product not found.");

const stageBySeq = (track, seq) => one("SELECT * FROM stages WHERE track=? AND seq=?", track, seq);
const stageById = id => one("SELECT * FROM stages WHERE id=?", id);
const usersInRole = roleId => all("SELECT user_id FROM user_roles WHERE role_id=?", roleId).map(r => r.user_id);

/** Everyone whose roles carry a permission. Exact membership, not a substring match on the list. */
export const usersWithPermission = perm => {
  const roleIds = all("SELECT id, permissions FROM roles")
    .filter(r => String(r.permissions || "").split(",").map(s => s.trim()).includes(perm))
    .map(r => r.id);
  return [...new Set(roleIds.flatMap(usersInRole))];
};

function openHistory(pid, stageId, track, from, actor, note) {
  run(`INSERT INTO stage_history(product_id,stage_id,track,entered_on,from_stage_id,actor_user_id,note,created_at)
       VALUES(?,?,?,?,?,?,?,datetime('now'))`, pid, stageId, track, today(), from, actor, note);
}
function closeHistory(pid, decision) {
  run(`UPDATE stage_history SET exited_on=?, decision=? WHERE id=(
         SELECT id FROM stage_history WHERE product_id=? AND exited_on IS NULL ORDER BY id DESC LIMIT 1)`,
    today(), decision, pid);
}
const touch = pid => run("UPDATE products SET updated_at=datetime('now') WHERE id=?", pid);

/* ------------------------------------------------------------------ */
/* bootstrap / reference data                                          */
/* ------------------------------------------------------------------ */
export function bootstrap(user) {
  const stages = all(`SELECT s.*, ro.name owner_role, ra.name approver_role, re.name escalate_role
                      FROM stages s LEFT JOIN roles ro ON ro.id=s.owner_role_id
                      LEFT JOIN roles ra ON ra.id=s.approver_role_id
                      LEFT JOIN roles re ON re.id=s.escalate_role_id
                      ORDER BY s.track DESC, s.seq`);
  for (const s of stages) {
    s.participants = all("SELECT r.id,r.name FROM stage_participant sp JOIN roles r ON r.id=sp.role_id WHERE sp.stage_id=?", s.id);
    s.criteria = all("SELECT * FROM exit_criteria WHERE stage_id=? ORDER BY seq", s.id);
  }
  return {
    user: { ...user, permissions: user.permissions },
    stages,
    roles: all("SELECT * FROM roles ORDER BY sort, name"),
    users: all(`SELECT u.id, u.name, u.email, u.title, u.active,
                 (SELECT GROUP_CONCAT(r.name, ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id) AS roles
                FROM users u ORDER BY u.active DESC, u.name`),
    settings: Object.fromEntries(all("SELECT key,value FROM settings WHERE key<>'app_secret'").map(r => [r.key, r.value])),
    settingsMeta: all("SELECT key,value,label,kind FROM settings WHERE key<>'app_secret' ORDER BY key"),
    permissions: PERMISSIONS,
    origins: cfg("origins", "").split("|").filter(Boolean),
    routes: cfg("routes", "").split("|").filter(Boolean),
    routeEntry: JSON.parse(cfg("route_entry", JSON.stringify(ROUTE_ENTRY))),
    statuses: ["Active", "On Hold", "Rework", "Closed"],
    today: today()
  };
}

/* ------------------------------------------------------------------ */
/* product register                                                    */
/* ------------------------------------------------------------------ */
export function createProduct(user, b) {
  need(user, "product.create");
  for (const f of ["name", "problem", "origin", "route", "owner_user_id", "next_action"])
    if (!b[f] && b[f] !== 0) bad(`"${f.replace(/_/g, " ")}" is required.`, "FR-01");
  const routes = cfg("routes", "").split("|");
  if (!routes.includes(b.route)) bad("Development route is not a valid reference value.", "BR-34");
  if (!cfg("origins", "").split("|").includes(b.origin)) bad("Origin is not a valid reference value.", "BR-34");

  const entry = JSON.parse(cfg("route_entry", "{}"))[b.route] || 1;      // BR-04
  const stage = stageBySeq("development", entry);
  const n = num("product_code_next", 1);
  const code = "P-" + String(n).padStart(3, "0");                         // BR-01
  setSetting("product_code_next", n + 1);

  run(`INSERT INTO products(code,name,problem,origin,route,client_source,owner_user_id,entry_stage_id,track,stage_id,
        status,next_action,action_owner_user_id,target_date,stage_entry_date,spec_link,predecessor_id,created_at,created_by,updated_at)
       VALUES(?,?,?,?,?,?,?,?, 'development',?, 'Active',?,?,?,?,?,?,datetime('now'),?,datetime('now'))`,
    code, b.name, b.problem, b.origin, b.route, b.client_source || null, b.owner_user_id, stage.id, stage.id,
    b.next_action, b.action_owner_user_id || b.owner_user_id,
    addWorkingDays(today(), stage.target_days || 10, WEEKEND()), today(), b.spec_link || null, b.predecessor_id || null,
    user.id);
  const id = col("SELECT id FROM products WHERE code=?", code);
  openHistory(id, stage.id, "development", null, user.id, `Registered on the ${b.route} route; entry gate derived as ${entry}.`);
  audit("product", id, "create", `${code} ${b.name} created at gate ${entry} (${stage.name})`, user.id);
  return getProduct(id);
}

const EDITABLE = ["name", "problem", "origin", "client_source", "next_action", "action_owner_user_id",
  "spec_link", "effort_budget", "predecessor_id", "actual_completion_date"];

export function updateProduct(user, id, b) {
  need(user, "product.edit");
  const p = mustProduct(id);
  if (p.status === "Closed") bad("A closed product cannot be edited. Its record is retained as an institutional record (NFR-17).");
  const changes = [];
  for (const f of EDITABLE) {
    if (!(f in b)) continue;
    const nv = b[f] === "" ? null : b[f];
    if (String(p[f] ?? "") === String(nv ?? "")) continue;
    run(`UPDATE products SET ${f}=? WHERE id=?`, nv, id);
    audit("product", id, "update", `${p.code} ${f} changed`, user.id, f, p[f], nv);
    changes.push(f);
  }
  if ("target_date" in b && b.target_date && b.target_date !== p.target_date && !p.target_date) {
    run("UPDATE products SET target_date=? WHERE id=?", b.target_date, id);
    audit("product", id, "update", `${p.code} target date set`, user.id, "target_date", null, b.target_date);
    changes.push("target_date");
  }
  touch(id);
  return { product: getProduct(id), changed: changes };
}

export function overrideEntry(user, id, b) {
  need(user, "entry.override");                                            // BR-05
  const p = mustProduct(id);
  if (col("SELECT COUNT(*) FROM gate_approvals WHERE product_id=? AND decision='Approved'", id))
    bad("The entry gate can only be overridden before the first gate approval.", "BR-05");
  if (p.track !== "development") bad("Only products on the development track have an entry gate.", "BR-05");
  if (!b.reason || b.reason.trim().length < 15) bad("An override reason of at least 15 characters is required.", "BR-05");
  const stage = stageBySeq("development", Number(b.seq));
  if (!stage) bad("That gate does not exist.");
  run(`UPDATE products SET entry_stage_id=?, stage_id=?, entry_override_reason=?, stage_entry_date=?, target_date=? WHERE id=?`,
    stage.id, stage.id, b.reason.trim(), today(), addWorkingDays(today(), stage.target_days || 10, WEEKEND()), id);
  run("DELETE FROM stage_history WHERE product_id=? AND exited_on IS NULL", id);
  openHistory(id, stage.id, "development", p.stage_id, user.id, `Entry gate overridden: ${b.reason.trim()}`);
  audit("product", id, "override", `${p.code} entry gate overridden to ${stage.name}`, user.id, "entry_stage_id", p.entry_stage_name, stage.name);
  return getProduct(id);
}

export function changeOwner(user, id, b) {
  need(user, "owner.change");                                              // BR-31
  const p = mustProduct(id);
  if (!b.to_user_id) bad("A new product owner is required.");
  if (!b.reason || b.reason.trim().length < 10) bad("A reason of at least 10 characters is required.", "BR-31");
  run("INSERT INTO owner_changes(product_id,from_user_id,to_user_id,reason,user_id,created_at) VALUES(?,?,?,?,?,datetime('now'))",
    id, p.owner_user_id, b.to_user_id, b.reason.trim(), user.id);
  run("UPDATE products SET owner_user_id=? WHERE id=?", b.to_user_id, id);
  audit("product", id, "owner", `${p.code} product owner changed`, user.id, "owner_user_id", p.owner_name,
    col("SELECT name FROM users WHERE id=?", b.to_user_id));
  notify([b.to_user_id], id, "owner", `You are now the product owner of ${p.code} ${p.name}.`);
  touch(id);
  return getProduct(id);
}

/* ------------------------------------------------------------------ */
/* gate engine                                                         */
/* ------------------------------------------------------------------ */
export function productGate(user, id) {
  const p = mustProduct(id);
  const criteria = all(`SELECT c.id,c.seq,c.text,
      cs.met, cs.evidence, cs.marked_at, u.name AS marked_by_name, cs.marked_by
    FROM exit_criteria c
    LEFT JOIN criterion_status cs ON cs.criterion_id=c.id AND cs.product_id=?
    LEFT JOIN users u ON u.id=cs.marked_by
    WHERE c.stage_id=? AND c.active=1 ORDER BY c.seq`, id, p.stage_id);
  const lastMarker = one(`SELECT marked_by FROM criterion_status WHERE product_id=? AND stage_id=? AND met=1
                          ORDER BY marked_at DESC LIMIT 1`, id, p.stage_id);
  return {
    criteria,
    lastMarkedBy: lastMarker?.marked_by ?? null,
    isApprover: holdsRole(user, p.approver_role_id),
    isOwner: isStageOwner(user, p),
    participants: p.participant_roles,
    approvals: all(`SELECT ga.*, u.name AS actor_name, s.name AS stage_name FROM gate_approvals ga
        JOIN users u ON u.id=ga.actor_user_id JOIN stages s ON s.id=ga.stage_id
        WHERE ga.product_id=? ORDER BY ga.id DESC`, id)
  };
}

/** The stage owner moves the product. The product owner and the action owner may act for them. */
function isStageOwner(user, p) {
  return holdsRole(user, p.owner_role_id) || p.owner_user_id === user.id || p.action_owner_user_id === user.id;
}

/** Everyone holding a participant role for this stage, plus the product and action owners. */
const stageAudience = p => [
  ...p.participant_roles.flatMap(r => usersInRole(r.id)),
  p.owner_user_id, p.action_owner_user_id
].filter(Boolean);

export function markCriterion(user, id, b) {
  need(user, "criteria.mark");
  const p = mustProduct(id);
  if (p.track !== "development") bad("Exit criteria apply to development gates only.", "BR-06");
  if (p.status === "Closed") bad("A closed product cannot be worked on.");
  if (p.submitted_at) bad("The gate is submitted for approval. Ask the approver to return it before editing criteria.");
  const c = one("SELECT * FROM exit_criteria WHERE id=? AND stage_id=? AND active=1", b.criterion_id, p.stage_id);
  if (!c) bad("That criterion does not belong to the current gate.");
  const met = b.met ? 1 : 0;
  if (met && (!b.evidence || b.evidence.trim().length < 5))
    bad("An evidence note is required before a criterion can be marked met.", "R-02");
  run(`INSERT INTO criterion_status(product_id,criterion_id,stage_id,met,evidence,marked_by,marked_at)
       VALUES(?,?,?,?,?,?,strftime('%Y-%m-%d %H:%M:%f','now'))
       ON CONFLICT(product_id,criterion_id) DO UPDATE SET
         met=excluded.met, evidence=excluded.evidence, marked_by=excluded.marked_by, marked_at=excluded.marked_at`,
    id, c.id, p.stage_id, met, met ? b.evidence.trim() : null, user.id);
  audit("product", id, "criterion", `${p.code} criterion ${c.seq} marked ${met ? "met" : "not met"}`, user.id);
  touch(id);
  return { product: getProduct(id), gate: productGate(user, id) };
}

export function submitGate(user, id) {
  need(user, "gate.submit");
  const p = mustProduct(id);
  // The owner's responsibility is to move the stage on.
  if (!isStageOwner(user, p))
    denied(`Moving ${p.code} on is the ${p.stage_owner_role}'s responsibility at this stage. `
      + `You hold: ${user.roleNames.join(", ") || "no roles"}.`, "9.1");
  if (p.track !== "development") bad("Market states are not gated and are not submitted for approval.", "BR-13");
  if (p.status === "Closed") bad("A closed product cannot be submitted.");
  if (p.status === "On Hold") bad("Resume the product before submitting the gate.", "BR-27");
  if (p.submitted_at) bad("This gate is already awaiting a decision.");
  if (!p.crit_total) bad("This gate has no exit criteria defined. Add them in Setup first.", "FR-11");
  if (p.crit_met < p.crit_total)
    bad(`${p.crit_total - p.crit_met} of ${p.crit_total} exit criteria are not yet met.`, "BR-06 / FR-13");
  if (p.stage_seq > 1 && p.effort_stage <= 0)
    bad("No effort has been logged against this stage. A gate cannot be approved without it.", "BR-21");
  run("UPDATE products SET submitted_at=datetime('now'), submitted_by=?, status='Active' WHERE id=?", user.id, id);
  audit("product", id, "submit", `${p.code} submitted for ${p.stage_name} approval`, user.id);
  notify(usersInRole(p.approver_role_id), id, "gate",
    `${p.code} ${p.name} is awaiting your decision at ${p.stage_name}.`);
  notify(stageAudience(p), id, "gate",
    `${p.code} ${p.name} has been submitted for ${p.stage_name} approval by ${user.name}.`);
  return getProduct(id);
}

export function decideGate(user, id, b) {
  const p = mustProduct(id);
  if (p.track !== "development") bad("Market states carry no approval gate.", "BR-13");
  if (!p.submitted_at) bad("This gate has not been submitted for approval.");
  if (!holdsRole(user, p.approver_role_id))
    denied(`Only the ${p.approver_role} may decide this gate. You hold: ${user.roleNames.join(", ") || "no roles"}.`, "BR-07");

  if (b.decision === "Returned") {
    if (!b.reason || b.reason.trim().length < 15) bad("A return reason of at least 15 characters is required.", "BR-10");
    run(`INSERT INTO gate_approvals(product_id,stage_id,decision,actor_user_id,role_id,reason,submitted_at,created_at)
         VALUES(?,?,'Returned',?,?,?,?,datetime('now'))`, id, p.stage_id, user.id, p.approver_role_id, b.reason.trim(), p.submitted_at);
    run("UPDATE products SET submitted_at=NULL, submitted_by=NULL, status='Rework' WHERE id=?", id);   // BR-29
    audit("product", id, "gate", `${p.code} returned at ${p.stage_name}`, user.id, "status", p.status, "Rework");
    notify([...stageAudience(p), p.submitted_by], id, "gate",
      `${p.code} was returned at ${p.stage_name} by ${user.name}: ${b.reason.trim()}`);
    return getProduct(id);
  }
  if (b.decision !== "Approved") bad("Decision must be Approved or Returned. A kill is recorded separately.");

  const g = productGate(user, id);
  // BR-09 — separation of duties.
  if (g.lastMarkedBy && g.lastMarkedBy === user.id)
    denied("You marked the final exit criterion, so you may not also record the approval.", "BR-09");
  if (p.crit_met < p.crit_total) bad("Exit criteria are no longer all met.", "BR-06");
  if (p.stage_seq > 1 && p.effort_stage <= 0) bad("No effort logged against this stage.", "BR-21");

  run(`INSERT INTO gate_approvals(product_id,stage_id,decision,actor_user_id,role_id,reason,submitted_at,created_at)
       VALUES(?,?,'Approved',?,?,?,?,datetime('now'))`, id, p.stage_id, user.id, p.approver_role_id, b.reason || null, p.submitted_at);
  closeHistory(id, "Approved");
  run("UPDATE products SET actual_completion_date=?, submitted_at=NULL, submitted_by=NULL WHERE id=?", today(), id);

  const next = stageBySeq("development", p.stage_seq + 1);                 // BR-03 sequential
  if (next) {
    run(`UPDATE products SET stage_id=?, stage_entry_date=?, target_date=?, revised_date=NULL,
           actual_completion_date=NULL, status='Active' WHERE id=?`,
      next.id, today(), addWorkingDays(today(), next.target_days || 10, WEEKEND()), id);
    openHistory(id, next.id, "development", p.stage_id, user.id, null);
    audit("product", id, "gate", `${p.code} approved at ${p.stage_name}; advanced to ${next.name}`, user.id,
      "stage", p.stage_name, next.name);
  } else {
    audit("product", id, "gate", `${p.code} approved at ${p.stage_name} — development complete`, user.id);
  }
  notify([...stageAudience(p), ...(next ? usersInRole(next.owner_role_id) : [])], id, "gate",
    `${p.code} was approved at ${p.stage_name} by ${user.name}` +
    (next ? ` and is now at ${next.name}.` : ". Development is complete; market entry follows the first paid deployment."));
  maybeEnterMarket(id, user);
  return getProduct(id);
}

// BR-11: market entry is the first paid deployment, and gate 8 must already be approved (BR-03).
function maybeEnterMarket(id, user) {
  const p = getProduct(id);
  if (p.track !== "development" || !p.pricing_approved || !p.deployments) return null;
  const seeding = stageBySeq("market", 1);
  closeHistory(id, "Entered market");
  run(`UPDATE products SET track='market', stage_id=?, stage_entry_date=?, target_date=NULL, revised_date=NULL,
         submitted_at=NULL, submitted_by=NULL, status='Active' WHERE id=?`, seeding.id, today(), id);
  openHistory(id, seeding.id, "market", p.stage_id, user.id, "First paid deployment recorded (BR-11).");
  run(`INSERT INTO market_changes(product_id,from_stage_id,to_stage_id,evidence,review_ref,user_id,created_at)
       VALUES(?,?,?,?,?,?,datetime('now'))`, id, p.stage_id, seeding.id,
    "Automatic on first paid deployment (BR-11).", null, user.id);
  audit("product", id, "market", `${p.code} entered the market track at Seeding`, user.id, "track", "development", "market");

  // BR-32 — a Replace product supersedes its predecessor on first deployment.
  if (p.predecessor_id && (p.route === "Replace" || p.route === "Upgrade")) {
    const pred = getProduct(p.predecessor_id);
    if (pred && pred.status !== "Closed") {
      const die = stageBySeq("market", 6);
      const reason = `Superseded by ${p.code} ${p.name}, which recorded its first paid deployment on ${today()}. `
        + `The product is withdrawn from the catalogue and retained as reference material only.`;
      closeHistory(pred.id, "Superseded");
      run(`UPDATE products SET track='market', stage_id=?, stage_entry_date=?, status='Closed', closure_reason=? WHERE id=?`,
        die.id, today(), reason, pred.id);
      openHistory(pred.id, die.id, "market", pred.stage_id, user.id, reason);
      audit("product", pred.id, "market", `${pred.code} superseded by ${p.code}`, user.id);
      notify([pred.owner_user_id], pred.id, "market", `${pred.code} moved to Die — superseded by ${p.code}.`);
    }
  }
  notify([p.owner_user_id], id, "market", `${p.code} has entered the market track at Seeding.`);
  // Seeding is the moment the firm starts selling: raise the launch-content prompt on the CRM's
  // content calendar and notify whoever plans content. It is a prompt, not a content item — BR-31
  // still requires a human to supply type, channel and person.
  raiseSeedingPrompt(getProduct(id), user.id);
  return getProduct(id);
}

/* ------------------------------------------------------------------ */
/* market track                                                        */
/* ------------------------------------------------------------------ */
export function changeMarketState(user, id, b) {
  const p = mustProduct(id);
  if (p.track !== "market") bad("The product is on the development track. Market entry follows the first paid deployment.", "BR-11");
  if (p.status === "Closed") bad("The product is closed.");
  const to = stageBySeq("market", Number(b.seq));
  if (!to) bad("That market state does not exist.");
  // §13 — an ordinary state change is the Business Head's; a withdrawal to Die is the CEO's decision.
  need(user, to.seq === 6 ? "kill.approve" : "market.change");             // BR-13, FR-39
  if (to.id === p.stage_id) bad("The product is already in that state.");
  if (!b.evidence || b.evidence.trim().length < 20)
    bad("Evidence of at least 20 characters is required — market states are set on evidence, not opinion.", "BR-13");
  const min = num("closure_reason_min", 50);
  if (to.seq === 6) {
    if (!b.closure_reason || b.closure_reason.trim().length < min)
      bad(`A closure reason of at least ${min} characters is required before a product may be set to Die.`, "BR-25");
  }
  closeHistory(id, "State change");
  run(`UPDATE products SET stage_id=?, stage_entry_date=?, status=?, closure_reason=COALESCE(?,closure_reason) WHERE id=?`,
    to.id, today(), to.seq === 6 ? "Closed" : p.status, to.seq === 6 ? b.closure_reason.trim() : null, id);
  openHistory(id, to.id, "market", p.stage_id, user.id, b.evidence.trim());
  run(`INSERT INTO market_changes(product_id,from_stage_id,to_stage_id,evidence,review_ref,user_id,created_at)
       VALUES(?,?,?,?,?,?,datetime('now'))`, id, p.stage_id, to.id, b.evidence.trim(), b.review_ref || null, user.id);
  audit("product", id, "market", `${p.code} market state ${p.stage_name} → ${to.name}`, user.id, "stage", p.stage_name, to.name);
  notify([p.owner_user_id], id, "market", `${p.code} moved from ${p.stage_name} to ${to.name}.`);
  return getProduct(id);
}

// FR-40 / BR-14..BR-18 — quarterly deployment trend, and which state the evidence points to.
export function marketCandidates() {
  const out = [];
  for (const p of listProducts().filter(x => x.track === "market" && x.status !== "Closed")) {
    const qs = all(`SELECT deployed_on FROM deployments WHERE product_id=? ORDER BY deployed_on`, p.id)
      .reduce((m, r) => (m[quarterOf(r.deployed_on)] = (m[quarterOf(r.deployed_on)] || 0) + 1, m), {});
    const keys = Object.keys(qs).sort();
    const series = keys.map(k => ({ q: k, n: qs[k] }));
    const last = series.slice(-3).map(s => s.n);
    let proposal = null, test = null;
    const rising = last.length >= 3 && last[2] > last[1] && last[1] > last[0];
    const flat = last.length >= 3 && last[2] === last[1] && last[1] === last[0];
    const falling = last.length >= 3 && last[2] < last[1] && last[1] < last[0];
    if (p.stage_seq === 1 && p.deployments >= num("thr_seed_launch", 3)) {
      proposal = "Market Launch"; test = `${p.deployments} deployments completed (BR-14 threshold ${num("thr_seed_launch", 3)}).`;
    } else if (p.stage_seq === 2 && rising) { proposal = "Growth"; test = `Deployments rising across ${last.join(" → ")} (BR-15).`; }
    else if (p.stage_seq === 3 && flat) { proposal = "Mature"; test = `Deployments flat at ${last[2]} for two quarters (BR-16).`; }
    else if (p.stage_seq === 4 && falling) { proposal = "Decline"; test = `Deployments falling ${last.join(" → ")} (BR-17).`; }
    else if (p.stage_seq === 5 && rising) { proposal = "Growth"; test = `Recovery — deployments rising ${last.join(" → ")} (BR-18).`; }
    const declineDays = p.stage_seq === 5 ? Math.round((Date.parse(today()) - Date.parse(p.stage_entry_date)) / 864e5) : 0;
    out.push({
      id: p.id, code: p.code, name: p.name, stage: p.stage_name, seq: p.stage_seq,
      deployments: p.deployments, revenue: p.revenue, series, proposal, test,
      decline_overdue: p.stage_seq === 5 && declineDays > num("decline_window_days", 90), decline_days: declineDays
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* effort, deployments, revenue, dates                                 */
/* ------------------------------------------------------------------ */
export function logEffort(user, id, b) {
  need(user, "effort.log");
  const p = mustProduct(id);
  if (p.status === "Closed") bad("Effort may not be logged against a closed product.", "BR-20");
  const days = Number(b.days);
  if (!(days > 0)) bad("Effort must be a positive number of consultant days.", "BR-20");
  if (!/^\d{4}-\d{2}$/.test(b.period || "")) bad("Period must be a month in the form YYYY-MM.");
  run(`INSERT INTO effort_entries(product_id,stage_id,period,days,consultant_user_id,estimated,note,logged_by,created_at)
       VALUES(?,?,?,?,?,?,?,?,datetime('now'))`,
    id, p.stage_id, b.period, days, b.consultant_user_id || user.id, b.estimated ? 1 : 0, b.note || null, user.id);
  audit("product", id, "effort", `${p.code} ${days} day(s) logged for ${b.period} at ${p.stage_name}`, user.id);
  touch(id);
  return getProduct(id);
}
export const deleteEffort = (user, id, eid) => {
  need(user, "effort.log");
  const e = one("SELECT * FROM effort_entries WHERE id=? AND product_id=?", eid, id) || missing("Effort entry not found.");
  if (e.logged_by !== user.id && !can(user, "settings.manage")) denied("You may only remove effort you logged.");
  run("DELETE FROM effort_entries WHERE id=?", eid);
  audit("product", id, "effort", `Effort entry of ${e.days} day(s) removed`, user.id);
  return getProduct(id);
};

export function recordDeployment(user, id, b) {
  need(user, "deployment.record");
  const p = mustProduct(id);
  if (!b.client_ref) bad("A client reference is required.", "BR-22");
  if (!b.deployed_on) bad("A deployment date is required.", "BR-22");
  run(`INSERT INTO deployments(product_id,client_ref,deployed_on,revenue,confirmed,note,created_by,created_at)
       VALUES(?,?,?,?,0,?,?,datetime('now'))`,
    id, b.client_ref, b.deployed_on, Number(b.revenue) || 0, b.note || null, user.id);
  audit("product", id, "deployment", `${p.code} deployment recorded for ${b.client_ref}`, user.id);
  notify(usersInRole(col("SELECT id FROM roles WHERE name='Finance Head'")), id, "revenue",
    `${p.code}: attributed revenue awaiting your confirmation.`);                      // BR-23
  maybeEnterMarket(id, user);
  return getProduct(id);
}
export function confirmRevenue(user, id, did) {
  need(user, "revenue.confirm");                                            // BR-23
  const d = one("SELECT * FROM deployments WHERE id=? AND product_id=?", did, id) || missing("Deployment not found.");
  run("UPDATE deployments SET confirmed=1, confirmed_by=?, confirmed_at=datetime('now') WHERE id=?", user.id, did);
  audit("product", id, "revenue", `Attributed revenue of ${d.revenue} confirmed for ${d.client_ref}`, user.id);
  return getProduct(id);
}

export function reviseDate(user, id, b) {
  need(user, "product.edit");                                               // BR-24
  const p = mustProduct(id);
  if (p.track !== "development") bad("Market states carry no target dates.", "6.1");
  if (!b.new_date) bad("A new target date is required.");
  if (!b.reason || b.reason.trim().length < 10) bad("A reason of at least 10 characters is required.", "BR-24");
  run(`INSERT INTO date_revisions(product_id,stage_id,old_date,new_date,reason,user_id,created_at)
       VALUES(?,?,?,?,?,?,datetime('now'))`, id, p.stage_id, p.due_date || null, b.new_date, b.reason.trim(), user.id);
  run("UPDATE products SET revised_date=? WHERE id=?", b.new_date, id);      // BR-30: ageing unaffected
  audit("product", id, "date", `${p.code} target date revised to ${b.new_date}`, user.id, "revised_date", p.due_date, b.new_date);
  return getProduct(id);
}

/* ------------------------------------------------------------------ */
/* status: park, resume, kill, withdraw                                */
/* ------------------------------------------------------------------ */
export function park(user, id, b) {
  need(user, "product.park");                                               // BR-27
  const p = mustProduct(id);
  if (p.status === "Closed") bad("The product is closed.");
  if (p.status === "On Hold") bad("The product is already On Hold.");
  if (!b.resume_date) bad("An intended resumption date is required.", "BR-27");
  if (!b.reason || b.reason.trim().length < 10) bad("A reason of at least 10 characters is required.", "BR-27");
  run("UPDATE products SET status='On Hold', hold_resume_date=?, hold_reason=?, submitted_at=NULL, submitted_by=NULL WHERE id=?",
    b.resume_date, b.reason.trim(), id);
  audit("product", id, "status", `${p.code} parked until ${b.resume_date}`, user.id, "status", p.status, "On Hold");
  notify([p.owner_user_id, p.action_owner_user_id], id, "status", `${p.code} was parked until ${b.resume_date}.`);
  return getProduct(id);
}
export function resume(user, id) {
  need(user, "product.park");
  const p = mustProduct(id);
  if (p.status !== "On Hold") bad("The product is not On Hold.");
  run("UPDATE products SET status='Active', hold_resume_date=NULL, hold_reason=NULL WHERE id=?", id);
  audit("product", id, "status", `${p.code} resumed`, user.id, "status", "On Hold", "Active");
  return getProduct(id);
}

export function recommendKill(user, id, b) {
  need(user, "kill.recommend");                                             // BR-26
  const p = mustProduct(id);
  if (p.track !== "development") bad("A product in market is withdrawn, not killed. Set the market state to Die.", "6.5");
  if (p.status === "Closed") bad("The product is already closed.");
  if (p.kill_pending) bad("A kill recommendation is already awaiting the CEO's decision.");
  if (!b.reason || b.reason.trim().length < 30) bad("A recommendation of at least 30 characters is required.", "BR-26");
  run("INSERT INTO kill_requests(product_id,stage_id,reason,recommended_by,created_at) VALUES(?,?,?,?,datetime('now'))",
    id, p.stage_id, b.reason.trim(), user.id);
  audit("product", id, "kill", `${p.code} kill recommended at ${p.stage_name}`, user.id);
  notify(usersWithPermission("kill.approve"), id, "kill",
    `${p.code} ${p.name}: a kill decision is awaiting your approval.`);
  return getProduct(id);
}

export function decideKill(user, id, b) {
  need(user, "kill.approve");                                               // BR-26
  const p = mustProduct(id);
  const k = one("SELECT * FROM kill_requests WHERE product_id=? AND decision IS NULL ORDER BY id DESC", id)
    || missing("No kill recommendation is outstanding.");
  const min = num("closure_reason_min", 50);
  if (b.decision === "Rejected") {
    run("UPDATE kill_requests SET decision='Rejected', decided_by=?, decided_at=datetime('now'), closure_reason=? WHERE id=?",
      user.id, b.closure_reason || null, k.id);
    audit("product", id, "kill", `${p.code} kill recommendation rejected`, user.id);
    notify([k.recommended_by], id, "kill", `The kill recommendation for ${p.code} was rejected.`);
    return getProduct(id);
  }
  if (!b.closure_reason || b.closure_reason.trim().length < min)
    bad(`A closure reason of at least ${min} characters is required.`, "BR-25");
  run("UPDATE kill_requests SET decision='Approved', decided_by=?, decided_at=datetime('now'), closure_reason=? WHERE id=?",
    user.id, b.closure_reason.trim(), k.id);
  run(`INSERT INTO gate_approvals(product_id,stage_id,decision,actor_user_id,role_id,reason,created_at)
       VALUES(?,?,'Killed',?,NULL,?,datetime('now'))`, id, p.stage_id, user.id, b.closure_reason.trim());
  closeHistory(id, "Killed");
  run("UPDATE products SET status='Closed', closure_reason=?, submitted_at=NULL, submitted_by=NULL WHERE id=?",
    b.closure_reason.trim(), id);
  audit("product", id, "kill", `${p.code} killed at ${p.stage_name}; ${p.effort} day(s) written off`, user.id,
    "status", p.status, "Closed");
  notify([p.owner_user_id, k.recommended_by], id, "kill", `${p.code} was killed at ${p.stage_name}.`);
  return getProduct(id);
}

/* ------------------------------------------------------------------ */
/* related lists                                                       */
/* ------------------------------------------------------------------ */
export const productRelated = (user, id) => {
  const p = mustProduct(id);
  return {
    history: all(`SELECT h.*, s.name AS stage_name, s.seq, u.name AS actor_name FROM stage_history h
        LEFT JOIN stages s ON s.id=h.stage_id LEFT JOIN users u ON u.id=h.actor_user_id
        WHERE h.product_id=? ORDER BY h.entered_on, h.id`, id)
      .map(h => ({ ...h, days: workingDays(h.entered_on, h.exited_on || today(), WEEKEND()) })),
    effort: all(`SELECT e.*, s.name AS stage_name, u.name AS consultant_name, l.name AS logged_by_name
        FROM effort_entries e LEFT JOIN stages s ON s.id=e.stage_id
        LEFT JOIN users u ON u.id=e.consultant_user_id LEFT JOIN users l ON l.id=e.logged_by
        WHERE e.product_id=? ORDER BY e.period DESC, e.id DESC`, id),
    deployments: all(`SELECT d.*, u.name AS confirmed_by_name FROM deployments d
        LEFT JOIN users u ON u.id=d.confirmed_by WHERE d.product_id=? ORDER BY d.deployed_on DESC`, id),
    revisions: all(`SELECT r.*, u.name AS user_name, s.name AS stage_name FROM date_revisions r
        LEFT JOIN users u ON u.id=r.user_id LEFT JOIN stages s ON s.id=r.stage_id
        WHERE r.product_id=? ORDER BY r.id DESC`, id),
    marketChanges: all(`SELECT m.*, f.name AS from_name, t.name AS to_name, u.name AS user_name FROM market_changes m
        LEFT JOIN stages f ON f.id=m.from_stage_id LEFT JOIN stages t ON t.id=m.to_stage_id
        LEFT JOIN users u ON u.id=m.user_id WHERE m.product_id=? ORDER BY m.id DESC`, id),
    ownerChanges: all(`SELECT o.*, f.name AS from_name, t.name AS to_name, u.name AS user_name FROM owner_changes o
        LEFT JOIN users f ON f.id=o.from_user_id LEFT JOIN users t ON t.id=o.to_user_id
        LEFT JOIN users u ON u.id=o.user_id WHERE o.product_id=? ORDER BY o.id DESC`, id),
    kills: all(`SELECT k.*, r.name AS recommended_by_name, d.name AS decided_by_name, s.name AS stage_name
        FROM kill_requests k LEFT JOIN users r ON r.id=k.recommended_by LEFT JOIN users d ON d.id=k.decided_by
        LEFT JOIN stages s ON s.id=k.stage_id WHERE k.product_id=? ORDER BY k.id DESC`, id),
    audit: all(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.entity='product' AND a.entity_id=? ORDER BY a.id DESC LIMIT 200`, id),
    effortByStage: all(`SELECT s.name AS stage_name, s.seq, s.track, SUM(e.days) AS days
        FROM effort_entries e JOIN stages s ON s.id=e.stage_id WHERE e.product_id=?
        GROUP BY s.id ORDER BY s.track DESC, s.seq`, id),
    product: p
  };
};

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */
export function dashboard(user) {
  const ps = listProducts();
  const live = ps.filter(p => p.status !== "Closed");
  const rate = num("day_rate", 1800);
  const dev = ps.filter(p => p.track === "development" && p.status !== "Closed");
  const mkt = ps.filter(p => p.track === "market");
  const unrealised = dev.reduce((a, p) => a + p.effort, 0);
  const revenue = ps.reduce((a, p) => a + p.revenue, 0);
  const effortAll = ps.reduce((a, p) => a + p.effort, 0);

  const stages = all("SELECT id,seq,track,name,approver_role_id FROM stages ORDER BY track DESC, seq");
  const distribution = stages.map(s => ({
    ...s, count: live.filter(p => p.stage_id === s.id).length,
    effort: Math.round(live.filter(p => p.stage_id === s.id).reduce((a, p) => a + p.effort, 0) * 10) / 10
  }));

  const myQueue = ps.filter(p => p.awaiting_approval && holdsRole(user, p.approver_role_id));
  // Gates this user is expected to move on, because the stage is theirs to own.
  const myToMove = ps.filter(p => p.track === "development" && p.status !== "Closed" && !p.awaiting_approval
    && (holdsRole(user, p.owner_role_id) || p.owner_user_id === user.id || p.action_owner_user_id === user.id));
  const myProducts = ps.filter(p => p.status !== "Closed" && (p.owner_user_id === user.id || p.action_owner_user_id === user.id));

  return {
    kpi: {
      unrealised_days: Math.round(unrealised * 10) / 10,
      unrealised_value: Math.round(unrealised * rate),
      revenue, portfolio_return: effortAll ? revenue / (effortAll * rate) : 0,
      stalled: live.filter(p => p.stalled).length,
      overdue: live.filter(p => p.overdue).length,
      gate_ready: live.filter(p => p.gate_ready && !p.awaiting_approval).length,
      awaiting: live.filter(p => p.awaiting_approval).length,
      revisions: ps.reduce((a, p) => a + p.revisions, 0),
      in_development: dev.length, in_market: mkt.filter(p => p.status !== "Closed").length,
      closed: ps.filter(p => p.status === "Closed").length,
      deployments: ps.reduce((a, p) => a + p.deployments, 0),
      unconfirmed_revenue: ps.reduce((a, p) => a + p.revenue_unconfirmed, 0),
      total: ps.length
    },
    distribution,
    exceptions: live.filter(p => p.exception)
      .sort((a, b) => (b.badly_stalled - a.badly_stalled) || (b.age_days - a.age_days)),
    myQueue, myToMove, myProducts,
    market: mkt.filter(p => p.status !== "Closed")
      .map(p => ({ ...p, roi: p.effort_value ? p.revenue / p.effort_value : 0 }))
      .sort((a, b) => b.revenue - a.revenue),
    candidates: marketCandidates().filter(c => c.proposal || c.decline_overdue),
    killQueue: can(user, "kill.approve")
      ? all(`SELECT k.*, p.code, p.name AS product_name, s.name AS stage_name, u.name AS recommended_by_name
             FROM kill_requests k JOIN products p ON p.id=k.product_id LEFT JOIN stages s ON s.id=k.stage_id
             LEFT JOIN users u ON u.id=k.recommended_by WHERE k.decision IS NULL ORDER BY k.id`) : [],
    notifications: all("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30", user.id)
  };
}

/* ------------------------------------------------------------------ */
/* reports RPT-01 … RPT-09                                             */
/* ------------------------------------------------------------------ */
const money = n => Math.round(n || 0);

export const REPORTS = {
  "RPT-01": {
    title: "Portfolio register export",
    note: "The seventeen columns of the source workbook, in their original order, followed by the fields the workbook did not hold.",
    build: () => {
      const rows = listProducts().map(p => ({
        "Product ID": p.code, "Product / Solution": p.name, "Origin": p.origin, "Client / Source": p.client_source,
        "Problem Solved": p.problem, "Product Owner": p.owner_name, "Entry Stage": p.entry_stage_name,
        "Current Stage": p.stage_name, "Status": p.status, "Next Action": p.next_action,
        "Action Owner": p.action_owner_name, "Stage Approver": p.approver_role || "NA",
        "Participants": p.participant_roles.map(r => r.name).join(", "), "Target Date": p.target_date,
        "Revised Date": p.revised_date, "No of Revisions": p.revisions, "Actual Completion Date": p.actual_completion_date,
        "Track": p.track === "market" ? "Market" : "Development", "Development Route": p.route,
        "Time in Stage (wd)": p.age_days, "Effort (days)": p.effort, "Effort (AED)": money(p.effort_value),
        "Deployments": p.deployments, "Attributed Revenue": money(p.revenue),
        "Return on Invested Time": p.roi == null ? "" : p.roi.toFixed(2),
        "Gate Readiness": p.crit_total ? `${p.crit_met}/${p.crit_total}` : "",
        "Closure Reason": p.closure_reason || ""
      }));
      return { columns: cols(rows, ["Product ID", "Product / Solution", "Origin", "Client / Source", "Problem Solved",
        "Product Owner", "Entry Stage", "Current Stage", "Status", "Next Action", "Action Owner", "Stage Approver",
        "Participants", "Target Date", "Revised Date", "No of Revisions", "Actual Completion Date",
        "Track", "Development Route", "Time in Stage (wd)", "Effort (days)", "Effort (AED)", "Deployments",
        "Attributed Revenue", "Return on Invested Time", "Gate Readiness", "Closure Reason"]), rows };
    }
  },
  "RPT-02": {
    title: "Gate review pack", note: "Everything the approver needs for a gate decision: criteria evidence, effort against budget and history.",
    build: () => {
      const rows = listProducts().filter(p => p.awaiting_approval).map(p => ({
        Product: `${p.code} ${p.name}`, Gate: p.stage_name, Approver: p.approver_role,
        Submitted: p.submitted_at, "Days in stage": p.age_days,
        Criteria: `${p.crit_met}/${p.crit_total}`, "Effort (days)": p.effort,
        "Effort at stage": p.effort_stage, "Budget": p.effort_budget ?? "",
        Participants: p.participant_roles.map(r => r.name).join(", ") || "—"
      }));
      return { columns: cols(rows, ["Product", "Gate", "Approver", "Submitted", "Days in stage", "Criteria",
        "Effort (days)", "Effort at stage", "Budget", "Participants"]), rows };
    }
  },
  "RPT-03": {
    title: "Exception report", note: "Products past the ageing threshold, On Hold, in Rework, or past a revised date (§17.2).",
    build: () => {
      const rows = listProducts().filter(p => p.exception).map(p => ({
        Product: `${p.code} ${p.name}`, Track: p.track, Stage: p.stage_name, Status: p.status,
        "Time in stage (wd)": p.age_days, "Ageing threshold": p.ageing_days ?? "",
        Overdue: p.overdue ? `${p.days_overdue} wd` : "", "Effort (days)": p.effort,
        Owner: p.owner_name, "Escalates to": p.escalate_role || "", "Next action": p.next_action
      }));
      return { columns: cols(rows, ["Product", "Track", "Stage", "Status", "Time in stage (wd)", "Ageing threshold",
        "Overdue", "Effort (days)", "Owner", "Escalates to", "Next action"]), rows };
    }
  },
  "RPT-04": {
    title: "Portfolio return report", note: "Effort, deployments, attributed revenue and return by product. Unconfirmed revenue is excluded (BR-23).",
    build: () => {
      const rate = num("day_rate", 1800);
      const rows = listProducts().map(p => ({
        Product: `${p.code} ${p.name}`, Track: p.track, Stage: p.stage_name,
        "Effort (days)": p.effort, "Effort (AED)": money(p.effort * rate),
        Deployments: p.deployments, "Revenue (AED)": money(p.revenue),
        "Unconfirmed (AED)": money(p.revenue_unconfirmed),
        "Return": p.effort_value ? (p.revenue / p.effort_value).toFixed(2) : ""
      }));
      return { columns: cols(rows, ["Product", "Track", "Stage", "Effort (days)", "Effort (AED)", "Deployments",
        "Revenue (AED)", "Unconfirmed (AED)", "Return"]), rows };
    }
  },
  "RPT-05": {
    title: "Stage cycle time analysis", note: "Median working days per gate against the target in the stage model (KPI-04).",
    build: () => {
      const rows = all("SELECT * FROM stages WHERE track='development' ORDER BY seq").map(s => {
        const spans = all(`SELECT entered_on, exited_on FROM stage_history WHERE stage_id=? AND exited_on IS NOT NULL`, s.id)
          .map(h => workingDays(h.entered_on, h.exited_on, WEEKEND()));
        const m = median(spans);
        return {
          Gate: s.seq, Stage: s.name, "Target (wd)": s.target_days, "Ageing (wd)": s.ageing_days,
          Completed: spans.length, "Median (wd)": m ?? "", "Longest (wd)": spans.length ? Math.max(...spans) : "",
          Variance: m == null ? "" : `${m - s.target_days > 0 ? "+" : ""}${m - s.target_days}`
        };
      });
      return { columns: cols(rows, ["Gate", "Stage", "Target (wd)", "Ageing (wd)", "Completed", "Median (wd)",
        "Longest (wd)", "Variance"]), rows };
    }
  },
  "RPT-06": {
    title: "Kill analysis", note: "Products closed, the gate at closure, effort written off and the recorded reason (KPI-06, KPI-07).",
    build: () => {
      const rows = listProducts().filter(p => p.status === "Closed").map(p => ({
        Product: `${p.code} ${p.name}`, "Closed at": p.stage_name, Track: p.track,
        "Effort written off (days)": p.effort, "Effort (AED)": money(p.effort_value),
        Deployments: p.deployments, "Revenue (AED)": money(p.revenue),
        "Closure reason": p.closure_reason || "— not recorded —"
      }));
      return { columns: cols(rows, ["Product", "Closed at", "Track", "Effort written off (days)", "Effort (AED)",
        "Deployments", "Revenue (AED)", "Closure reason"]), rows };
    }
  },
  "RPT-07": {
    title: "Effort compliance report", note: "Products in development with no effort logged in the current or previous month (SC-03).",
    build: () => {
      const nowM = today().slice(0, 7);
      const prev = (() => { const d = new Date(today() + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return iso(d).slice(0, 7); })();
      const rows = listProducts().filter(p => p.track === "development" && p.status !== "Closed").map(p => {
        const recent = col("SELECT COALESCE(SUM(days),0) FROM effort_entries WHERE product_id=? AND period IN (?,?)", p.id, nowM, prev);
        return {
          Product: `${p.code} ${p.name}`, Stage: p.stage_name, Owner: p.owner_name,
          "Days logged (2 months)": recent, "Total effort": p.effort,
          Compliant: recent > 0 ? "Yes" : "No"
        };
      });
      return { columns: cols(rows, ["Product", "Stage", "Owner", "Days logged (2 months)", "Total effort", "Compliant"]), rows };
    }
  },
  "RPT-08": {
    title: "Market state evidence pack", note: "Deployment trend by quarter with the threshold test and the proposed state (FR-40).",
    build: () => {
      const rows = marketCandidates().map(c => ({
        Product: `${c.code} ${c.name}`, "Current state": c.stage, Deployments: c.deployments,
        "Revenue (AED)": money(c.revenue),
        "Quarterly trend": c.series.slice(-6).map(s => `${s.q}:${s.n}`).join("  "),
        "Proposed state": c.proposal || "No change indicated", "Threshold test": c.test || "",
        "Decision overdue": c.decline_overdue ? `Yes — ${c.decline_days} days in Decline` : ""
      }));
      return { columns: cols(rows, ["Product", "Current state", "Deployments", "Revenue (AED)", "Quarterly trend",
        "Proposed state", "Threshold test", "Decision overdue"]), rows };
    }
  },
  "RPT-09": {
    title: "Approval responsiveness", note: "Gate decisions against the three working-day service level, by approver (KPI-12).",
    build: () => {
      const sla = num("gate_sla_days", 3);
      const by = {};
      for (const a of all(`SELECT ga.*, u.name AS actor_name, s.name AS stage_name FROM gate_approvals ga
                           JOIN users u ON u.id=ga.actor_user_id JOIN stages s ON s.id=ga.stage_id
                           WHERE ga.submitted_at IS NOT NULL`)) {
        const d = workingDays(a.submitted_at.slice(0, 10), a.created_at.slice(0, 10), WEEKEND());
        (by[a.actor_name] ||= { n: 0, within: 0, days: [] });
        by[a.actor_name].n++; by[a.actor_name].days.push(d); if (d <= sla) by[a.actor_name].within++;
      }
      const rows = Object.entries(by).map(([name, v]) => ({
        Approver: name, Decisions: v.n, "Within SLA": v.within,
        "Within SLA %": v.n ? Math.round(v.within / v.n * 100) + "%" : "",
        "Median days": median(v.days) ?? "", "Slowest": v.days.length ? Math.max(...v.days) : ""
      }));
      return { columns: cols(rows, ["Approver", "Decisions", "Within SLA", "Within SLA %", "Median days", "Slowest"]), rows };
    }
  },
  "KPI": {
    title: "KPI framework (KPI-01 … KPI-12)", note: "The portfolio measures defined in BRD §15.1.",
    build: () => {
      const ps = listProducts(), rate = num("day_rate", 1800);
      const live = ps.filter(p => p.status !== "Closed");
      const dev = ps.filter(p => p.track === "development" && p.status !== "Closed");
      const mkt = ps.filter(p => p.track === "market");
      const effortAll = ps.reduce((a, p) => a + p.effort, 0);
      const rev = ps.reduce((a, p) => a + p.revenue, 0);
      const cycles = all("SELECT s.seq, h.entered_on, h.exited_on FROM stage_history h JOIN stages s ON s.id=h.stage_id WHERE s.track='development' AND h.exited_on IS NOT NULL")
        .map(h => workingDays(h.entered_on, h.exited_on, WEEKEND()));
      const firstDep = ps.filter(p => p.first_deployment).map(p => {
        const start = col("SELECT MIN(entered_on) FROM stage_history WHERE product_id=?", p.id);
        return workingDays(start, p.first_deployment, WEEKEND());
      });
      const killed = ps.filter(p => p.status === "Closed" && p.track === "development");
      const decay = mkt.filter(p => p.stage_seq >= 5).reduce((a, p) => a + p.revenue, 0);
      const rows = [
        ["KPI-01", "Unrealised effort", `${Math.round(dev.reduce((a, p) => a + p.effort, 0) * 10) / 10} days · AED ${money(dev.reduce((a, p) => a + p.effort, 0) * rate).toLocaleString()}`, "Monthly", "Solutions Head"],
        ["KPI-02", "Portfolio return", effortAll ? (rev / (effortAll * rate)).toFixed(2) + "×" : "—", "Quarterly", "Finance Head"],
        ["KPI-03", "Products stalled", String(live.filter(p => p.stalled).length), "Monthly", "Business Head"],
        ["KPI-04", "Gate cycle time (median)", cycles.length ? `${median(cycles)} working days` : "—", "Quarterly", "Solutions Head"],
        ["KPI-05", "Idea to first deployment (median)", firstDep.length ? `${median(firstDep)} working days` : "—", "Quarterly", "Business Head"],
        ["KPI-06", "Kill rate", ps.length ? `${Math.round(killed.length / ps.length * 100)}%` : "—", "Quarterly", "CEO"],
        ["KPI-07", "Kill point (median gate)", killed.length ? String(median(killed.map(p => p.stage_seq))) : "—", "Quarterly", "CEO"],
        ["KPI-08", "Redeployment ratio", mkt.length ? (ps.reduce((a, p) => a + p.deployments, 0) / mkt.length).toFixed(1) : "—", "Quarterly", "Business Head"],
        ["KPI-09", "Portfolio balance", `${dev.length} in development · ${mkt.filter(p => p.status !== "Closed").length} in market`, "Quarterly", "Business Head"],
        ["KPI-10", "Decay exposure", rev ? `${Math.round(decay / rev * 100)}%` : "—", "Quarterly", "Finance Head"],
        ["KPI-11", "Date revision index", dev.length ? (ps.reduce((a, p) => a + p.revisions, 0) / dev.length).toFixed(2) : "—", "Monthly", "Business Head"],
        ["KPI-12", "Approval responsiveness", (() => {
          const r = REPORTS["RPT-09"].build().rows;
          const n = r.reduce((a, x) => a + x.Decisions, 0), w = r.reduce((a, x) => a + x["Within SLA"], 0);
          return n ? `${Math.round(w / n * 100)}% within ${num("gate_sla_days", 3)} days` : "—";
        })(), "Monthly", "Business Head"]
      ].map(([ref, measure, value, freq, owner]) => ({ Ref: ref, Measure: measure, Value: value, Frequency: freq, Owner: owner }));
      return { columns: cols(rows, ["Ref", "Measure", "Value", "Frequency", "Owner"]), rows };
    }
  }
};
// An empty report must still export its headings, so each report names its columns.
const cols = (rows, fallback) => (rows.length ? Object.keys(rows[0]) : (fallback || []))
  .map(k => ({ key: k, label: k }));

export function report(key) {
  const r = REPORTS[key] || missing("Report not found.");
  const built = r.build();
  return { key, title: r.title, note: r.note, ...built };
}
export const reportCSV = key => { const r = report(key); return toCSV(r.columns, r.rows); };

/* ------------------------------------------------------------------ */
/* setup: users, roles, stage model, settings                          */
/* ------------------------------------------------------------------ */
export function listUsers(user) {
  need(user, "users.manage");
  return all(`SELECT u.*, (SELECT GROUP_CONCAT(role_id) FROM user_roles WHERE user_id=u.id) role_ids
              FROM users u ORDER BY u.active DESC, u.name`)
    .map(u => ({ ...u, password_hash: undefined, role_ids: (u.role_ids || "").split(",").filter(Boolean).map(Number) }));
}

export function saveUser(user, id, b) {
  need(user, "users.manage");
  const email = String(b.email || "").trim().toLowerCase();
  if (!b.name || !email) bad("Name and email are required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad("That is not a valid email address.");
  if (id) {
    const ex = one("SELECT * FROM users WHERE id=?", id) || missing("User not found.");
    if (col("SELECT id FROM users WHERE email=? AND id<>?", email, id)) bad("Another user already has that email.");
    const active = b.active === undefined ? ex.active : (b.active ? 1 : 0);
    if (!active && ex.id === user.id) bad("You cannot deactivate your own account.");
    run("UPDATE users SET name=?, email=?, title=?, active=? WHERE id=?", b.name.trim(), email, b.title || null, active, id);
    audit("user", id, "update", `User ${b.name} updated`, user.id);
  } else {
    if (col("SELECT id FROM users WHERE email=?", email)) bad("A user with that email already exists.");
    const pw = b.password || "Assured@2026";
    if (String(pw).length < 8) bad("A password of at least 8 characters is required.", "NFR-06");
    run(`INSERT INTO users(name,email,title,password_hash,active,must_change,created_at)
         VALUES(?,?,?,?,1,1,datetime('now'))`, b.name.trim(), email, b.title || null, hashPassword(String(pw)));
    id = col("SELECT id FROM users WHERE email=?", email);
    audit("user", id, "create", `User ${b.name} created`, user.id);
  }
  if (Array.isArray(b.role_ids)) {
    const before = all("SELECT role_id FROM user_roles WHERE user_id=?", id).map(r => r.role_id);
    run("DELETE FROM user_roles WHERE user_id=?", id);
    for (const rid of b.role_ids) {
      if (!col("SELECT id FROM roles WHERE id=?", rid)) continue;
      run("INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)", id, rid);
    }
    const after = b.role_ids;
    if (String(before.sort()) !== String([...after].sort()))
      audit("user", id, "roles", `Roles set to ${all("SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?", id).map(r => r.name).join(", ") || "none"}`,
        user.id, "roles", before.join(","), after.join(","));
  }
  return listUsers(user);
}

export function resetPassword(user, id, b) {
  need(user, "users.manage");
  if (!b.password || String(b.password).length < 8) bad("A password of at least 8 characters is required.", "NFR-06");
  run("UPDATE users SET password_hash=?, must_change=1 WHERE id=?", hashPassword(String(b.password)), id);
  audit("user", id, "password", "Password reset by an administrator", user.id);
  return { ok: true };
}

export function changeOwnPassword(user, b) {
  const u = one("SELECT * FROM users WHERE id=?", user.id);
  if (!verifyPassword(String(b.current || ""), u.password_hash)) bad("The current password is not correct.");
  if (!b.password || String(b.password).length < 8) bad("The new password must be at least 8 characters.", "NFR-06");
  run("UPDATE users SET password_hash=?, must_change=0 WHERE id=?", hashPassword(String(b.password)), user.id);
  audit("user", user.id, "password", "Password changed", user.id);
  return { ok: true };
}

export function saveRole(user, id, b) {
  need(user, "users.manage");
  const perms = (Array.isArray(b.permissions) ? b.permissions : String(b.permissions || "").split(","))
    .map(s => String(s).trim()).filter(p => PERMISSIONS.some(([k]) => k === p));
  if (!b.name) bad("A role name is required.");
  if (id) {
    const ex = one("SELECT * FROM roles WHERE id=?", id) || missing("Role not found.");
    run("UPDATE roles SET name=?, description=?, permissions=? WHERE id=?",
      ex.is_system ? ex.name : b.name.trim(), b.description || null, perms.join(","), id);
    audit("role", id, "update", `Role ${ex.name} updated`, user.id, "permissions", ex.permissions, perms.join(","));
  } else {
    if (col("SELECT id FROM roles WHERE name=?", b.name.trim())) bad("A role with that name already exists.");
    run("INSERT INTO roles(name,description,permissions,is_system,sort) VALUES(?,?,?,0,(SELECT COALESCE(MAX(sort),0)+1 FROM roles))",
      b.name.trim(), b.description || null, perms.join(","));
    audit("role", col("SELECT id FROM roles WHERE name=?", b.name.trim()), "create", `Role ${b.name} created`, user.id);
  }
  return all("SELECT * FROM roles ORDER BY sort, name");
}

export function deleteRole(user, id) {
  need(user, "users.manage");
  const r = one("SELECT * FROM roles WHERE id=?", id) || missing("Role not found.");
  if (r.is_system) bad("The six roles named in the BRD are system roles and cannot be deleted. Edit their permissions instead.");
  const used = col("SELECT COUNT(*) FROM stages WHERE owner_role_id=? OR approver_role_id=? OR escalate_role_id=?", id, id, id);
  if (used) bad("This role is referenced by the stage model. Reassign those stages first.");
  run("DELETE FROM roles WHERE id=?", id);
  audit("role", id, "delete", `Role ${r.name} deleted`, user.id);
  return all("SELECT * FROM roles ORDER BY sort, name");
}

export function saveStage(user, id, b) {
  need(user, "stagemodel.manage");
  const s = one("SELECT * FROM stages WHERE id=?", id) || missing("Stage not found.");
  run(`UPDATE stages SET name=?, purpose=?, definition=?, owner_role_id=?, approver_role_id=?, escalate_role_id=?,
        target_days=?, ageing_days=?, entry_condition=?, exit_condition=? WHERE id=?`,
    b.name || s.name, b.purpose ?? s.purpose, b.definition ?? s.definition,
    b.owner_role_id ?? s.owner_role_id,
    s.track === "market" ? null : (b.approver_role_id ?? s.approver_role_id),
    b.escalate_role_id ?? s.escalate_role_id,
    s.track === "market" ? null : (b.target_days ?? s.target_days),
    s.track === "market" ? null : (b.ageing_days ?? s.ageing_days),
    b.entry_condition ?? s.entry_condition, b.exit_condition ?? s.exit_condition, id);
  if (Array.isArray(b.participant_ids)) {
    run("DELETE FROM stage_participant WHERE stage_id=?", id);
    b.participant_ids.forEach(rid => run("INSERT OR IGNORE INTO stage_participant(stage_id,role_id) VALUES(?,?)", id, rid));
  }
  audit("stage", id, "update", `Stage ${s.name} updated`, user.id);
  return bootstrap(user).stages;
}

export function saveCriterion(user, b) {
  need(user, "stagemodel.manage");
  if (b.id) {
    const c = one("SELECT * FROM exit_criteria WHERE id=?", b.id) || missing("Criterion not found.");
    run("UPDATE exit_criteria SET text=?, active=? WHERE id=?", b.text || c.text, b.active === undefined ? c.active : (b.active ? 1 : 0), b.id);
    audit("criterion", b.id, "update", `Exit criterion updated`, user.id, "text", c.text, b.text);
  } else {
    if (!b.stage_id || !b.text) bad("A stage and criterion text are required.");
    const seq = (col("SELECT MAX(seq) FROM exit_criteria WHERE stage_id=?", b.stage_id) || 0) + 1;
    run("INSERT INTO exit_criteria(stage_id,seq,text,active) VALUES(?,?,?,1)", b.stage_id, seq, b.text);
    audit("criterion", col("SELECT MAX(id) FROM exit_criteria"), "create", `Exit criterion added`, user.id);
  }
  return bootstrap(user).stages;
}

export function saveSettings(user, b) {
  need(user, "settings.manage");
  for (const [k, v] of Object.entries(b)) {
    if (k === "app_secret") continue;
    const old = getSetting(k);
    if (old === null || String(old) === String(v)) continue;
    setSetting(k, v);
    audit("setting", null, "update", `Setting ${k} changed`, user.id, k, old, v);
  }
  return Object.fromEntries(all("SELECT key,value FROM settings WHERE key<>'app_secret'").map(r => [r.key, r.value]));
}

export const auditLog = (user, q = {}) => {
  need(user, "settings.manage");
  return all(`SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
              ${q.entity ? "WHERE a.entity=?" : ""} ORDER BY a.id DESC LIMIT 400`, ...(q.entity ? [q.entity] : []));
};

export const markNotificationsRead = user => {
  run("UPDATE notifications SET read=1 WHERE user_id=?", user.id);
  return { ok: true };
};
