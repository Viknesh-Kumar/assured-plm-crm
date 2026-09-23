// Illustrative Content Calendar data: the sponsor's three example stage lists, the four example targets, and
// some work in progress, all built through the engine's own rules. NOT part of the seed — run it with
// `npm run demo` (after crm-demo.mjs, whose first-release posts it carries over) or `npm run demo:content`.
import { col, one } from "./db.mjs";
import { seedIfEmpty } from "./seed.mjs";
import { seedCRMIfEmpty, migrateCRM } from "./crm-seed.mjs";
import * as A from "./api.mjs";
import * as E from "./content.mjs";

seedIfEmpty(); seedCRMIfEmpty(); migrateCRM();
E.migrateContentV2();
const carried = E.adoptLegacy();             // posts crm-demo.mjs wrote the first-release way

if (col("SELECT COUNT(*) FROM content_cadence")) {
  console.log("\n  Content demo not loaded — the calendar already holds posting targets. `npm run reset` for a clean load.\n");
  process.exit(0);
}

const admin = A.loadUser(col("SELECT id FROM users WHERE email=?", process.env.PLM_ADMIN_EMAIL || "producthead@assured.local"));
const CMR = col("SELECT id FROM roles WHERE name='Content Manager'");
if (!col("SELECT id FROM users WHERE email='content.manager@assured.local'"))
  A.saveUser(admin, null, { name: "Content Manager", email: "content.manager@assured.local", title: "Content Manager",
    password: process.env.PLM_SEED_PASSWORD || "Assured@2026", role_ids: [CMR] });
const cm = A.loadUser(col("SELECT id FROM users WHERE email='content.manager@assured.local'"));

const type = name => col("SELECT id FROM content_type WHERE name=?", name) ?? E.saveType(admin, null, { name }).id;
const CH = n => col("SELECT id FROM content_channel WHERE name=?", n);
const AC = n => col("SELECT id FROM content_account WHERE name=?", n);
const s = (name, pct, tat_days, kind = "work", extra = {}) => ({ name, pct, tat_days, kind, ...extra });
const LFV = type("Long-form video"), REEL = type("Reel"), CAR = type("Carousel");
const lfv = E.saveStages(admin, LFV, [s("Topic, theme & keyword mapped", 10, 60, "topic"), s("Script approved", 25, 40),
  s("Video shoot done", 50, 30), s("Editing done", 80, 14), s("Thumbnail & caption ready", 90, 3), s("Published", 100, 0, "publish")]);
E.saveStages(admin, REEL, [s("Topic mapped", 10, 30, "topic"),
  s("Raw footage available", 40, 21, "parent", { parent_stage_id: lfv.stages.find(x => x.name === "Editing done").id }),
  s("Reel edited", 75, 7), s("Caption & cover ready", 90, 2), s("Published", 100, 0, "publish")]);
E.saveStages(admin, CAR, [s("Topic mapped", 10, 30, "topic"), s("Design done", 60, 7), s("Caption & approval", 90, 3),
  s("Published", 100, 0, "publish")]);

const now = E.today().slice(0, 7);
const month = n => { const d = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const targets = [
  { account_id: AC("Assured"), type_id: LFV, platforms: [CH("YouTube"), CH("LinkedIn")], per_month: 2, weeks: "1,3", weekdays: "2" },
  { account_id: AC("Assured"), type_id: REEL, platforms: [CH("Instagram"), CH("LinkedIn")], per_month: 4, weeks: "1,2,3,4", weekdays: "4" },
  { account_id: AC("Siddique"), type_id: CAR, platforms: [CH("LinkedIn")], per_month: 2, weeks: "1,3", weekdays: "3" },
  { account_id: AC("Dhiraj"), type_id: CAR, platforms: [CH("LinkedIn")], per_month: 2, weeks: "1,3", weekdays: "1" }
].map(t => E.saveCadence(cm, { ...t, start_period: month(0), end_period: month(5),
  note: "Illustrative target loaded with the demo data" }));

// Work in progress: topics for the first slots in the look-ahead, a stage or two done, reels cut from videos.
const TOPICS = [
  ["Why your monthly close is a report, not a control", "Financial control", "month-end close"],
  ["Three numbers a distributor should see daily", "Operational control", "distribution KPIs"],
  ["Inside a 12-day month-end close", "Financial control", "month-end close"],
  ["What a CFO dashboard should leave out", "Management reporting", "CFO dashboard"],
  ["Project cash flow on one page", "Project finance", "project cash flow"],
  ["Distributor margins, explained", "Distribution", "distributor margin"],
  ["Close checklist in 30 seconds", "Financial control", "close checklist"],
  ["Stock that never moves is a decision", "Inventory control", "dead stock"]
];
const gaps = E.topicGaps();
gaps.slice(0, TOPICS.length).forEach((g, i) => {
  const [title, theme, keyword] = TOPICS[i];
  try { E.mapTopic(cm, g.id, { title, theme, keyword }); } catch { /* a slot the rules refuse is simply left open */ }
});
const tick = (id, n) => { for (let k = 0; k < n; k++) {
  const it = E.getItem(id), next = it.tasks.find(t => !t.done_at && t.kind === "work");
  if (!next || it.next_task?.id !== next.id) return;
  try { E.completeTask(cm, next.id); } catch { return; }
} };
const mapped = gaps.slice(0, TOPICS.length).map(g => E.getItem(g.id)).filter(it => it.tasks[0]?.done_at);
mapped.slice(0, 3).forEach((it, i) => tick(it.id, i + 1));
for (const reel of mapped.filter(it => it.type_id === REEL)) {
  const video = one(`SELECT id FROM content WHERE type_id=? AND cancelled_at IS NULL AND date<? ORDER BY date DESC LIMIT 1`, LFV, reel.date);
  if (video) try { E.linkParent(cm, reel.id, video.id); } catch { /* the video's edit is due too late for this reel */ }
}

const created = targets.reduce((n, t) => n + t.created, 0);
console.log(`\n  Content demo loaded: 3 content types with stage lists, 4 posting targets writing ${created} slots, `
  + `${mapped.length} topics mapped.${carried.platforms ? ` ${carried.platforms} earlier posts carried over.` : ""}`);
console.log("  Content Manager sign-in: content.manager@assured.local, with the seeded password.\n");
