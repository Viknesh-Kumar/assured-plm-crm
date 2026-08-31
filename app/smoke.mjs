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
const promptsBefore = (await ph.call("/crm/prompts?status=Open")).data.length;
ok(!(await ph.call("/crm/prompts?status=Open")).data.some(x => x.product_code === p.code),
  "no launch prompt for this product before it reaches Seeding");
await BH.call(`/products/${p.id}/deployment`, "POST",
  { client_ref: "First paid client", deployed_on: new Date().toISOString().slice(0, 10), revenue: 60000 });
const inMarket = (await ph.call(`/products/${p.id}`)).data.product;
eq(inMarket.stage_name, "Seeding", "the first paid deployment moves the product into Seeding");
const prompts = (await ph.call("/crm/prompts?status=Open")).data;
ok(prompts.length >= 1, "Seeding raises a content-calendar prompt");
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
const gateSeq = (await ML.call(`/crm/leads/${lead.id}`)).data.stages.find(s => s.is_gate).seq;
for (let s = 2; s < gateSeq; s++) await ML.call(`/crm/leads/${lead.id}/move`, "POST", { to_seq: s });
const refusal = await ML.call(`/crm/leads/${lead.id}/move`, "POST", { to_seq: gateSeq });
ok(refusal.status === 400 && (refusal.data.missing || []).length === 7,
  `BR-16 the gate refusal names all seven outstanding fields (${(refusal.data.missing || []).map(m => m.label).join(", ")})`);
await refused(await ML.call("/crm/pipelines", "POST", { name: "x", offering_id: off, template_id: 1, industry_ids: [ind] }),
  "FR-43 a Sales User is refused CRM Setup", "crm.setup.manage");
ok((await ph.call("/crm/pipelines")).data.length >= 12, "the Product Head can reach CRM Setup");

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
