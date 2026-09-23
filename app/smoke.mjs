// End-to-end functional smoke test over the real HTTP server: signs in, administers users through the
// Product Head login, walks a product from gate 1 to market Seeding, and checks the CRM hand-off.
// Run with `npm run smoke` while `npm start` is running (or let the script be pointed at any base URL).
const BASE = process.env.PLM_URL || "http://127.0.0.1:4173";
const PW = process.env.PLM_SEED_PASSWORD || "Assured@2026";

let pass = 0, fail = 0, skipped = 0;
/** Unique per run, so the test can be run repeatedly against the same deployment. */
const RUN = Date.now().toString(36).slice(-5);
const skip = m => { skipped++; console.log("  skip " + m); };
const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.error("  FAIL " + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}  (got ${JSON.stringify(a)})`);

/** One cookie jar per signed-in person, so role separation is exercised for real. */
class Session {
  constructor(label) { this.label = label; this.cookie = null; }
  async call(path, method = "GET", body) {
    const res = await fetch(BASE + "/api" + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) this.cookie = set.map(c => c.split(";")[0]).join("; ");
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  async login(email) {
    const r = await this.call("/login", "POST", { email, password: PW });
    if (r.status !== 200) throw new Error(`${this.label}: sign-in failed — ${JSON.stringify(r.data)}`);
    return r.data;
  }
}
const refused = async (r, m, contains) => {
  const said = `${r.data.rule || ""} ${r.data.error || ""}`;
  ok(r.status >= 400 && (!contains || said.includes(contains)),
    `${m}  — refused: ${String(r.data.error || r.status).slice(0, 110)}`);
};

console.log(`\n  Functional smoke test against ${BASE}\n`);
console.log("  — clean install and the Product Head login —");
const ph = new Session("Product Head");
await ph.login(process.env.PLM_ADMIN_EMAIL || "producthead@assured.local");
const boot = (await ph.call("/bootstrap")).data;
ok(boot.user.permissions.includes("users.manage"), "the Product Head login can administer users");
const FRESH = (await ph.call("/products")).data.length === 0 && (await ph.call("/crm/leads")).data.length === 0;
if (FRESH) {
  eq(boot.user.roles.map(r => r.name), ["Product Head"], "the only seeded account is the Product Head");
  ok(boot.users.length === 1, "clean install: exactly one user exists");
  ok(true, "clean install: the product register is empty");
  ok(true, "clean install: the lead register is empty");
} else {
  skip("clean-install checks — this deployment already holds data");
}
ok(boot.stages.length === 14, "the 14-stage model is configured");
ok(boot.roles.length >= 9, "the nine base roles are configured");

console.log("\n  — the Product Head configures users and roles —");
// The one change the access screen must never allow: leaving nobody able to open it again. Only
// testable while the Product Head is genuinely the only administrator, i.e. on a clean install.
if (FRESH) {
  await refused(await ph.call(`/users/${boot.user.id}`, "PATCH",
    { name: boot.user.name, email: boot.user.email, role_ids: [], permissions: [] }),
    "the last administrator cannot drop their own access to user management", "nobody able to manage users");
  ok((await ph.call("/users")).status === 200, "and they still have it");
} else {
  skip("last-administrator lockout guard - this deployment already has other administrators");
}

const roleId = n => boot.roles.find(r => r.name === n).id;
const people = [
  ["Chief Executive", `ceo.${RUN}@a.local`, "CEO"], ["Business Head", `bh.${RUN}@a.local`, "Business Head"],
  ["Solutions Head", `sh.${RUN}@a.local`, "Solutions Head"], ["Consultant One", `c1.${RUN}@a.local`, "Solutions Team"],
  ["Finance Head", `fh.${RUN}@a.local`, "Finance Head"], ["Projects Head", `pj.${RUN}@a.local`, "Projects Head"],
  ["Marketing Lead", `ml.${RUN}@a.local`, "CRM Sales User"]
];
for (const [name, email, role] of people)
  await ph.call("/users", "POST", { name, email, title: name, password: PW, role_ids: [roleId(role)] });
const users = (await ph.call("/users")).data;
const mine = users.filter(u => u.email.includes(`.${RUN}@`));
eq(mine.length, people.length, "every user was created through the Product Head login");
ok(mine.every(u => u.role_ids.length === 1), "each user carries the role assigned to them");

// any role to any user
const ml = users.find(u => u.email === `ml.${RUN}@a.local`);
await ph.call(`/users/${ml.id}`, "PATCH", { name: ml.name, email: ml.email,
  role_ids: [roleId("CRM Sales User"), roleId("Projects Head")] });
eq((await ph.call("/users")).data.find(u => u.id === ml.id).role_ids.length, 2,
  "any combination of roles can be assigned to any user");

// a custom role, created and assigned
const analystName = `Portfolio Analyst ${RUN}`;
await ph.call("/roles", "POST", { name: analystName, description: "Reads and logs effort.",
  permissions: ["effort.log", "product.edit"] });
const analyst = (await ph.call("/bootstrap")).data.roles.find(r => r.name === analystName);
ok(!!analyst, "the Product Head can create a new role");
await ph.call(`/users/${ml.id}`, "PATCH", { name: ml.name, email: ml.email, role_ids: [analyst.id] });
eq((await ph.call("/users")).data.find(u => u.id === ml.id).role_ids, [analyst.id],
  "the new role can be assigned to an existing user");
await ph.call(`/users/${ml.id}`, "PATCH", { name: ml.name, email: ml.email, role_ids: [roleId("CRM Sales User")] });
await ph.call(`/roles/${analyst.id}`, "DELETE");

const S = {};
for (const [, email] of people) { const s = new Session(email); await s.login(email); S[email] = s; }
const CEO = S[`ceo.${RUN}@a.local`], BH = S[`bh.${RUN}@a.local`], SH = S[`sh.${RUN}@a.local`],
      C1 = S[`c1.${RUN}@a.local`], FH = S[`fh.${RUN}@a.local`], PJ = S[`pj.${RUN}@a.local`],
      ML = S[`ml.${RUN}@a.local`];

console.log("\n  — approvals only: the owner moves, the approver decides, participants are told —");
const uid = e => users.find(u => u.email === e).id;
const p = (await ph.call("/products", "POST", {
  name: `Tender Response Assistant ${RUN}`,
  problem: "Drafts a first-pass tender response from the RFP pack and the firm's past submissions.",
  origin: "New Idea", route: "Ideate", client_source: "Internal — Bids",
  owner_user_id: uid(`c1.${RUN}@a.local`), next_action: "Write the problem statement"
})).data;
ok(/^P-\d{3,}$/.test(p.code), `an identifier is generated in the P-nnn format (${p.code})`);
if (FRESH) eq(p.code, "P-001", "a clean install issues the first identifier as P-001");
else skip("first-identifier check — this deployment already holds products");
eq(p.stage_name, "Conceptualization", "an Ideate product enters at gate 1");

const markAll = async (sess, id) => {
  const g = (await sess.call(`/products/${id}`)).data.gate;
  for (const c of g.criteria.filter(x => !x.met))
    await sess.call(`/products/${id}/criterion`, "POST",
      { criterion_id: c.id, met: true, evidence: "Evidence recorded during the smoke test." });
};
const roleOf = async id => (await ph.call(`/products/${id}`)).data.product.stage_owner_role;
const OWNER = { "Solutions Team": () => C1, "Solutions Head": () => SH, "Business Head": () => BH };
const APPROVER = { "Business Head": () => BH, "CEO": () => CEO, "Solutions Head": () => SH };

await markAll(C1, p.id);
await refused(await SH.call(`/products/${p.id}/submit`, "POST"),
  "a non-owner cannot move the stage on", "responsibility");
await refused(await FH.call(`/products/${p.id}/submit`, "POST"),
  "a role without gate.submit cannot move the stage on", "gate.submit");
const submitted = (await C1.call(`/products/${p.id}/submit`, "POST")).data;
eq(submitted.awaiting_approval, true, "the stage owner moves it on");
await refused(await SH.call(`/products/${p.id}/decide`, "POST", { decision: "Approved" }),
  "only the named approver may decide", "BR-07");
eq((await BH.call(`/products/${p.id}/decide`, "POST", { decision: "Approved" })).data.stage_name,
  "Value Proposition", "the approver approves and the product advances — no consultation step");
ok((await ph.call(`/products/${p.id}/consult`, "POST", { comment: "x" })).status === 404,
  "the consultation endpoint no longer exists");

// gate 2 → gate 3, where the sheet lists participants
await markAll(SH, p.id);
await SH.call(`/products/${p.id}/effort`, "POST", { period: "2026-08", days: 2 });
await SH.call(`/products/${p.id}/submit`, "POST");
await BH.call(`/products/${p.id}/decide`, "POST", { decision: "Approved" });
const atGate3 = (await ph.call(`/products/${p.id}`)).data.product;
eq(atGate3.stage_name, "Business Case", "the product reaches gate 3");
eq(atGate3.participant_roles.map(r => r.name).sort(), ["Finance Head", "Solutions Head"],
  "gate 3 lists Finance Head and Solutions Head as participants, exactly as the sheet says");

await markAll(BH, p.id);
await BH.call(`/products/${p.id}/effort`, "POST", { period: "2026-08", days: 3 });
await BH.call(`/products/${p.id}/submit`, "POST");
const fhNotes = (await FH.call("/dashboard")).data.notifications;
ok(fhNotes.some(n => n.text.includes("submitted for Business Case")),
  "a participant is notified when the stage is submitted — and is not asked to comment");
eq((await CEO.call(`/products/${p.id}/decide`, "POST", { decision: "Approved" })).data.stage_name,
  "Validation", "the CEO approves gate 3 with no consultation outstanding");
ok((await FH.call("/dashboard")).data.notifications.some(n => n.text.includes("approved at Business Case")),
  "a participant is notified of the decision");

console.log("\n  — the rest of the development track —");
for (let guard = 0; guard < 8; guard++) {
  const cur = (await ph.call(`/products/${p.id}`)).data.product;
  if (cur.stage_seq >= 8) break;
  const owner = (OWNER[await roleOf(p.id)] || (() => C1))();
  await markAll(owner, p.id);
  await owner.call(`/products/${p.id}/effort`, "POST", { period: "2026-08", days: 2 });
  await owner.call(`/products/${p.id}/submit`, "POST");
  const appr = (APPROVER[(await ph.call(`/products/${p.id}`)).data.product.approver_role])();
  await appr.call(`/products/${p.id}/decide`, "POST", { decision: "Approved" });
}
eq((await ph.call(`/products/${p.id}`)).data.product.stage_name, "Pricing", "the product reaches gate 8");

console.log("\n  — BR-11 and the CRM hand-off —");
await markAll(BH, p.id);
await BH.call(`/products/${p.id}/effort`, "POST", { period: "2026-08", days: 2 });
await BH.call(`/products/${p.id}/submit`, "POST");
await CEO.call(`/products/${p.id}/decide`, "POST", { decision: "Approved" });
eq((await ph.call(`/products/${p.id}`)).data.product.track, "development",
  "BR-11 gate 8 approval alone is not market entry");
ok(!(await ph.call("/content/prompts?status=Open")).data.some(x => x.product_code === p.code),
  "no launch prompt for this product before it reaches Seeding");
await BH.call(`/products/${p.id}/deployment`, "POST",
  { client_ref: "First paid client", deployed_on: new Date().toISOString().slice(0, 10), revenue: 60000 });
const inMarket = (await ph.call(`/products/${p.id}`)).data.product;
eq(inMarket.stage_name, "Seeding", "the first paid deployment moves the product into Seeding");
const prompts = (await ph.call("/content/prompts?status=Open")).data;
ok(prompts.length >= 1, "Seeding raises a Content Calendar prompt");
ok(prompts.some(x => x.product_code === p.code), `the prompt names the product (${p.code})`);
ok((await ML.call("/dashboard")).data.notifications.some(n => n.kind === "content"),
  "whoever plans content is notified");

console.log("\n  — the CRM —");
const lead = (await ML.call("/crm/leads", "POST", { company: `Northline Warehousing FZC ${RUN}` })).data;
eq(lead.next_move, "blocked", "BR-01 a lead is logged with a company name alone and has no pipeline yet");
await refused(await ML.call("/crm/leads", "POST", { company: "   " }), "BR-02 a blank company is refused", "company name");
const crm = (await ML.call("/crm/bootstrap")).data;
const off = crm.offerings.find(o => o.code === "RTX").id;
const ind = crm.industries.find(i => i.name === "Warehousing").id;
await ML.call(`/crm/leads/${lead.id}`, "PATCH", { offering: off, industry: ind });
const withPipe = (await ML.call(`/crm/leads/${lead.id}`)).data.lead;
eq(withPipe.pipeline_name, "RouteX", "BR-04 offering × industry derives the pipeline");

// The very first move asks for the estimated annual order value and nothing else.
const firstMove = await ML.call(`/crm/leads/${lead.id}/move`, "POST", { to_seq: 2 });
ok(firstMove.status === 400 && (firstMove.data.missing || []).some(m => m.key === "value"),
  "the first move asks for the estimated annual order value");
await ML.call(`/crm/leads/${lead.id}`, "PATCH", { value: 250000 });
eq((await ML.call(`/crm/leads/${lead.id}`)).data.lead.est_annual_value, 250000,
  "the estimated annual order value is stored on the lead");

const gateSeq = (await ML.call(`/crm/leads/${lead.id}`)).data.stages.find(s => s.is_gate).seq;
for (let s = 2; s < gateSeq; s++) await ML.call(`/crm/leads/${lead.id}/move`, "POST", { to_seq: s });
const refusal = await ML.call(`/crm/leads/${lead.id}/move`, "POST", { to_seq: gateSeq });
ok(refusal.status === 400 && (refusal.data.missing || []).length === 6,
  `BR-16 the gate refusal names all six outstanding fields (${(refusal.data.missing || []).map(m => m.label).join(", ")})`);
ok(!(refusal.data.missing || []).some(m => m.key === "activity"),
  "BR-17 Activity Name is not asked for while the Lead Source is unknown");

console.log("\n  — the Content Calendar —");
// A content type of this run's own keeps repeated runs against one deployment clear of each other.
const cb = (await ph.call("/content/bootstrap")).data;
ok(cb.can.setup && cb.can.cadence && cb.can.work, "the Product Head configures, targets and works the Content Calendar");
const liId = cb.platforms.find(c => c.name === "LinkedIn").id;
const assured = cb.accounts.find(a => a.name === "Assured").id;
const ctype = (await ph.call("/content/types", "POST", { name: `Smoke explainer ${RUN}` })).data;
await refused(await ph.call(`/content/types/${ctype.id}/stages`, "POST", { stages: [{ name: "Published", pct: 100, tat_days: 0, kind: "publish" }] }),
  "CC-01 a stage list without a topic stage is refused", "CC-01");
const list = (await ph.call(`/content/types/${ctype.id}/stages`, "POST", { stages: [
  { name: "Topic mapped", pct: 10, tat_days: 14, kind: "topic" }, { name: "Draft written", pct: 60, tat_days: 3 },
  { name: "Published", pct: 100, tat_days: 0, kind: "publish" }] })).data;
eq(list.stages.map(s => `${s.pct}%/${s.tat_days}d`), ["10%/14d", "60%/3d", "100%/0d"], "a content type takes its stages, readiness and TATs");
const later = n => { const d = new Date(Date.parse(cb.today) + n * 864e5); return d.toISOString().slice(0, 10); };
const nextMonth = later(40).slice(0, 7);
const tgt = { account_id: assured, type_id: ctype.id, platforms: [liId], per_month: 1, weeks: "2", weekdays: "3",
  start_period: nextMonth, end_period: nextMonth };
await refused(await ML.call("/content/targets", "POST", tgt), "CC-40 a sales user cannot set a posting target", "content.cadence.manage");
eq((await ph.call("/content/targets/preview", "POST", tgt)).data.dates.length, 1, "a target's preview lists the dates it would write");
const target = (await ph.call("/content/targets", "POST", tgt)).data;
eq(target.created, 1, "saving the target writes its slot on the calendar");
await refused(await ph.call("/content/targets", "POST", tgt), "CC-13 a second target on the same week and weekday is refused", "CC-13");
const slot = (await ph.call(`/content/calendar?month=${nextMonth}`)).data.items.find(i => i.cadence_id === target.cadence.id);
eq(slot?.state, "Open slot", "the slot waits for its topic");
const post = (await ph.call("/content/items", "POST", { date: later(10), type_id: ctype.id, account_id: assured, platforms: [liId],
  title: `Racking teardown ${RUN}`, theme: "Warehousing", keyword: "racking" })).data;
eq([post.state, post.readiness], ["In production", 10], "a post planned with topic, theme and keyword is 10% ready");
await refused(await ph.call(`/content/items/${post.id}/publish`, "POST", { urls: { [liId]: "https://www.linkedin.com/posts/x" } }),
  "CC-25 publishing with a stage still open is refused", "Draft written");
await ph.call(`/content/tasks/${post.tasks[1].id}/done`, "POST", {});
const published = (await ph.call(`/content/items/${post.id}/publish`, "POST",
  { urls: { [liId]: `https://www.linkedin.com/posts/racking-${RUN}` } })).data;
eq([published.state, published.readiness], ["Published", 100], "with every stage done it publishes, 100% ready");
const impressions = cb.metrics.find(m => m.name === "Impressions").id;
eq((await ph.call(`/content/items/${post.id}/metrics`, "POST", { channel_id: liId, values: { [impressions]: "12,400" } })).data.latest[0].value,
  12400, "CC-30 figures are recorded per platform as whole numbers");

ok((await ph.call("/content/pickable")).data.some(x => x.value === post.id), "the post appears in the CRM's Activity Name picker");
await refused(await ML.call(`/crm/leads/${lead.id}/attach`, "POST", { content_id: slot.id }),
  "BR-33 an open slot cannot be attributed to a lead", "no topic");
await ML.call(`/crm/leads/${lead.id}`, "PATCH", { activity: post.id });
const withAct = (await ML.call(`/crm/leads/${lead.id}`)).data.lead;
eq(withAct.activity, post.title, "the Activity Name is the post's topic, chosen from the Content Calendar");
eq(withAct.primary_content_id, post.id, "BR-33 the Activity Name carries the primary attribution");
eq(withAct.activity_channel_name, "LinkedIn", "the social channel comes with the chosen post");
ok((await ph.call(`/content/scorecard?month=${later(10).slice(0, 7)}`)).data.rows.some(r => r.type === ctype.name),
  "the scorecard measures the month the post went into");
// Leave the deployment's calendar as it was found: the target ends before its month, its slot goes, the type retires.
await ph.call(`/content/targets/${target.cadence.id}/end`, "POST", { last_period: cb.today.slice(0, 7) });
await ph.call(`/content/types/${ctype.id}`, "PATCH", { name: ctype.name, active: false });
await refused(await ML.call("/crm/pipelines", "POST", { name: "x", offering_id: off, template_id: 1, industry_ids: [ind] }),
  "FR-43 a Sales User is refused CRM Setup", "crm.setup.manage");
ok((await ph.call("/crm/pipelines")).data.length >= 12, "the Product Head can reach CRM Setup");

console.log("\n  — users and access —");
// A user with no role at all, given exactly two permissions directly.
const gr = (await ph.call("/users", "POST", { name: `Granted ${RUN}`, email: `granted.${RUN}@assured.local`,
  password: PW, role_ids: [], permissions: ["crm.lead.create", "crm.lead.manage"] })).data;
const granted = gr.find(u => u.email === `granted.${RUN}@assured.local`);
eq(granted.role_ids.length, 0, "a user may hold no role at all");
eq(granted.direct.sort().join(","), "crm.lead.create,crm.lead.manage",
  "access granted directly to one person is recorded as such");
const GR = new Session("granted"); await GR.login(granted.email);
const grLead = (await GR.call("/crm/leads", "POST", { company: `Granted Holdings ${RUN}` })).data;
ok(grLead.id > 0, "a directly-granted user can add a lead");
await refused(await GR.call(`/crm/leads/${grLead.id}/move`, "POST", { to_seq: 2 }),
  "FR-43 the same user cannot move a lead between stages", "Move a lead between pipeline stages");
await ph.call(`/users/${granted.id}`, "PATCH", { name: granted.name, email: granted.email,
  role_ids: [], permissions: ["crm.lead.create", "crm.lead.manage", "crm.lead.move"] });
const GR2 = new Session("granted"); await GR2.login(granted.email);
await GR2.call(`/crm/leads/${grLead.id}`, "PATCH", { offering: off, industry: ind, value: 75000 });
eq((await GR2.call(`/crm/leads/${grLead.id}/move`, "POST", { to_seq: 2 })).status, 200,
  "granting the move permission directly lets the same user move the lead");


console.log("\n  — reports —");
for (const r of (await ph.call("/reports")).data) {
  const rep = (await ph.call(`/reports/${r.key}`)).data;
  ok(Array.isArray(rep.rows) && rep.columns.length > 0, `${r.key} builds with headings`);
}
for (const r of (await ph.call("/crm/reports")).data) {
  const rep = (await ph.call(`/crm/reports/${r.key}`)).data;
  ok(Array.isArray(rep.rows) && rep.columns.length > 0, `${r.key} builds with headings`);
}

console.log(`\n  ${pass} checks passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}.\n`);
process.exit(fail ? 1 : 0);
