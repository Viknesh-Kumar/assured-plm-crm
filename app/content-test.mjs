// Content Calendar — unit suite (npm run test:content).
// Runs the engine against the real application schema on a throwaway database that first carries a
// first-release content table and the v1 demo data, so the migration is proved on something shaped like
// production. House style: a rule is proved by what it refuses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const tmp = path.join(os.tmpdir(), `content-test-${process.pid}.db`);
process.env.PLM_DB = tmp;
process.env.PLM_SEED_PASSWORD = "TestPass@2026";

// The content table exactly as the first release created it — title, channel and person NOT NULL — so
// the rebuild in migrateContentV2() is exercised the way the live database will meet it.
const first = new DatabaseSync(tmp);
first.exec(`CREATE TABLE content (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL,
  type_id INTEGER NOT NULL REFERENCES content_type(id),
  channel_id INTEGER NOT NULL REFERENCES content_channel(id),
  person_id INTEGER NOT NULL REFERENCES users(id),
  offering_id INTEGER REFERENCES offering(id), industry_id INTEGER REFERENCES industry(id),
  theme TEXT, status TEXT NOT NULL DEFAULT 'Planned', url TEXT,
  engagement_metric TEXT, engagement_value INTEGER,
  created_at TEXT NOT NULL, created_by INTEGER REFERENCES users(id))`);
first.close();

const db = await import("./db.mjs");
const { seedIfEmpty } = await import("./seed.mjs");
const { seedCRMIfEmpty, migrateCRM } = await import("./crm-seed.mjs");
const log = console.log;
console.log = () => {};                              // the seeders are chatty
seedIfEmpty(); seedCRMIfEmpty(); migrateCRM();
await import("./crm-demo.mjs");                    // the v1 illustrative data: 16 leads, 22 content items
console.log = log;
const A = await import("./api.mjs");
const C = await import("./crm.mjs");
const E = await import("./content.mjs");

let pass = 0, failures = 0;
const section = t => console.log(`\n  ${t}`);
const ok = (cond, msg) => { if (cond) pass++; else { failures++; console.error("  FAIL " + msg); } };
const eq = (a, b, msg) => { if (a === b || JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { failures++; console.error(`  FAIL ${msg}\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`); } };
const refused = (fn, rule, msg, contains) => {
  try { fn(); failures++; console.error(`  FAIL ${rule} — ${msg}: expected a refusal, the call succeeded`); }
  catch (e) {
    if (!(e instanceof A.HttpError)) { failures++; console.error(`  FAIL ${rule} — ${msg}: threw ${e.stack}`); return; }
    if (rule && !(String(e.rule || "").includes(rule) || e.message.includes(rule))) {
      failures++; console.error(`  FAIL ${rule} — ${msg}: refused with "${e.rule}" / "${e.message}"`); return;
    }
    for (const c of [].concat(contains || []))
      if (!e.message.includes(c)) { failures++; console.error(`  FAIL ${rule} — ${msg}: message lacks "${c}" — got "${e.message}"`); return; }
    pass++;
  }
};
const id = (sql, ...p) => db.col(sql, ...p);

/* ================================================================== */
section("§0  Migration on a database carrying v1 data");
/* ================================================================== */
const before = {
  items: id("SELECT COUNT(*) FROM content"),
  touches: id("SELECT COUNT(*) FROM lead_content_touch"),
  primaries: db.all("SELECT id, primary_content_id FROM lead WHERE primary_content_id IS NOT NULL"),
  engaged: id("SELECT COUNT(*) FROM content WHERE engagement_value IS NOT NULL"),
  shireenItems: id("SELECT COUNT(*) FROM content c JOIN users u ON u.id=c.person_id WHERE u.name='Shireen'"),
  siddiqueItems: id("SELECT COUNT(*) FROM content c JOIN users u ON u.id=c.person_id WHERE u.name='Siddique'")
};
ok(before.items > 0 && before.touches > 0, "the v1 demo data is in place before migrating");
E.setToday("2026-09-16");
const mig = E.migrateContentV2();
eq(mig.items, before.items, "migration keeps every content item");
eq(mig.platforms, before.items, "every v1 channel becomes a platform row");
eq(mig.metrics, before.engaged, "every v1 engagement figure is carried into the metric history");
eq(id("SELECT COUNT(*) FROM lead_content_touch"), before.touches, "lead attribution touches survive the table rebuild");
eq(db.all("SELECT id, primary_content_id FROM lead WHERE primary_content_id IS NOT NULL"), before.primaries,
  "every lead still points at the same primary content item");
ok(db.all("PRAGMA table_info(content)").some(c => c.name === "account_id"), "the first-release table was rebuilt into the calendar's shape");
eq(db.all("PRAGMA foreign_key_check").length, 0, "no dangling foreign key after the rebuild");
eq(id("PRAGMA foreign_keys"), 1, "foreign keys are switched back on after the rebuild");
eq(db.all("PRAGMA table_info(content)").find(c => c.name === "title").notnull, 0, "a content title may now be empty (an open slot)");
eq(E.migrateContentV2(), null, "the migration is idempotent");
eq(id("SELECT COUNT(*) FROM content_account"), 3, "three accounts are seeded: Assured, Siddique, Dhiraj");
eq(id("SELECT u.name FROM content_account a JOIN users u ON u.id=a.person_id WHERE a.name='Siddique'"), "Siddique",
  "a personal account is linked to its person when the person exists");
eq(id("SELECT COUNT(*) FROM content c JOIN content_account a ON a.id=c.account_id WHERE a.name='Siddique'"), before.siddiqueItems,
  "a v1 item by a person with a personal account moves to that account");
ok(id("SELECT COUNT(*) FROM content c JOIN content_account a ON a.id=c.account_id JOIN users u ON u.id=c.person_id WHERE a.name='Assured' AND u.name='Shireen'")
  === before.shireenItems, "a v1 item by a person without a personal account goes to the company account");
eq(id("SELECT COUNT(*) FROM content WHERE account_id IS NULL"), 0, "no v1 item is left without an account");
eq(db.all("SELECT name FROM content_metric ORDER BY sort").map(r => r.name), ["Impressions", "Profile visits", "Views", "Likes"],
  "the four metrics the sponsor named are seeded");
ok(String(id("SELECT permissions FROM roles WHERE name='Content Manager'")).includes("crm.content.manage"),
  "the Content Manager role exists and can work content");

// What the CRM still reads keeps working on the migrated table
const ct1 = id("SELECT id FROM content_type WHERE name='Long-form'");
const LI = id("SELECT id FROM content_channel WHERE name='LinkedIn'");
const IG = id("SELECT id FROM content_channel WHERE name='Instagram'");
const YT = id("SELECT id FROM content_channel WHERE name='YouTube'");
const user = e => A.loadUser(id("SELECT id FROM users WHERE email=?", e));
const ADMIN = user(process.env.PLM_ADMIN_EMAIL || "producthead@assured.local");
eq(C.listTargets("2026-08").length, 4, "the first release's publishing targets are still readable, as history");
ok(C.listTargets("2026-08").every(t => t.published >= 0), "…with what was published against each");
eq(E.adoptLegacy(), { platforms: 0, metrics: 0 }, "carrying first-release rows over is idempotent");
const LEGACY_ROW = db.run(`INSERT INTO content(date,title,type_id,channel_id,person_id,status,engagement_metric,engagement_value,created_at)
  VALUES('2026-08-28','Written the first-release way',?,?,?,'Published','Views',900,datetime('now'))`, ct1, LI, ADMIN.id).lastInsertRowid;
eq(E.adoptLegacy(), { platforms: 1, metrics: 1 }, "a row written the first-release way after the migration is carried over too");
const carried = E.getItem(LEGACY_ROW);
eq([carried.account_name, carried.platforms.map(p => p.name), carried.published_on, carried.state, carried.readiness],
  ["Assured", ["LinkedIn"], "2026-08-28", "Published", 100], "…with an account, its platform, its publish date, and 100% ready");
db.run("DELETE FROM content WHERE id=?", LEGACY_ROW);

/* ------------------------------------------------------------------ */
const mk = (name, email, roleName) => {
  A.saveUser(ADMIN, null, { name, email, title: name, password: "TestPass@2026",
    role_ids: [id("SELECT id FROM roles WHERE name=?", roleName)] });
  return user(email);
};
const CM = mk("Content Manager One", "cm@assured.local", "Content Manager");
const SALES = user("shireen@assured.local");                   // CRM Sales User from the demo
const CEO = mk("Chief Executive", "ceo@assured.local", "CEO"); // no content permission at all
const CMR = id("SELECT id FROM roles WHERE name='Content Manager'");
ok(SALES && SALES.permissions.includes("crm.content.manage") && !SALES.roleIds.includes(CMR),
  "fixture: a sales user may plan content but does not hold the Content Manager role");
ok(ADMIN.permissions.includes("content.setup.manage"), "the Product Head can configure content after migration");
ok(!C.hasCRM(CM) && C.hasCRM(SALES), "a Content Manager opens the Content Calendar, not the CRM; a sales user opens the CRM");
eq(id("SELECT value FROM settings WHERE key='content_manager_role'"), String(CMR), "the Content Manager role runs the calendar by default");

E.saveType(ADMIN, null, { name: "Long-form video" });
E.saveType(ADMIN, null, { name: "Reel" });
E.saveType(ADMIN, null, { name: "Carousel" });
const LFV = id("SELECT id FROM content_type WHERE name='Long-form video'");
const REEL = id("SELECT id FROM content_type WHERE name='Reel'");
const CAR = id("SELECT id FROM content_type WHERE name='Carousel'");
const ASSURED = id("SELECT id FROM content_account WHERE name='Assured'");
const SIDDIQUE = id("SELECT id FROM content_account WHERE name='Siddique'");
const DHIRAJ = id("SELECT id FROM content_account WHERE name='Dhiraj'");

/* ================================================================== */
section("§1  Date engine");
/* ================================================================== */
let nthBad = 0;
for (let y = 2026; y <= 2035; y++) for (let m = 1; m <= 12; m++) for (let wd = 0; wd < 7; wd++) for (let n = 1; n <= 4; n++) {
  const d = E.nthWeekday(y, m, wd, n), day = Number(d.slice(8));
  if (E.weekdayOf(d) !== wd || day < 7 * (n - 1) + 1 || day > 7 * n || d.slice(0, 7) !== `${y}-${String(m).padStart(2, "0")}`) nthBad++;
}
eq(nthBad, 0, "CC-12 the 1st–4th weekday of every month 2026–2035 is the right weekday, in the right week, inside the month (3,360 cases)");
eq([E.nthWeekday(2026, 10, 2, 1), E.nthWeekday(2026, 10, 2, 3)], ["2026-10-06", "2026-10-20"], "1st & 3rd Tuesday of Oct 2026 (1 Oct is a Thursday)");
eq([E.nthWeekday(2026, 10, 2, 2), E.nthWeekday(2026, 10, 2, 4)], ["2026-10-13", "2026-10-27"], "2nd & 4th Tuesday of Oct 2026");
eq([E.nthWeekday(2026, 12, 2, 1), E.nthWeekday(2026, 12, 2, 3)], ["2026-12-01", "2026-12-15"], "Dec 2026 has five Tuesdays; the 29th is never used");
const cx = { weekend: new Set([6, 0]), holidays: new Set() };
eq(E.dueDate("2027-03-15", 30, cx), "2027-02-12", "the sponsor's example: post Mon 15 Mar 2027, 30 days back is Sat 13 Feb, pulled to Fri 12 Feb");
eq(E.dueDate("2027-03-15", 60, cx), "2027-01-14", "topic 60 days before 15 Mar 2027 is Thu 14 Jan");
eq(E.dueDate("2026-10-10", 0, cx), "2026-10-10", "TAT 0 keeps a Saturday posting date — posts may go out at weekends");
eq(E.dueDate("2026-10-12", 1, cx), "2026-10-09", "a deadline on a Sunday moves back to the Friday, never forward");
eq(E.dueDate("2027-03-15", 30, { weekend: cx.weekend, holidays: new Set(["2027-02-12"]) }), "2027-02-11",
  "a holiday pulls a deadline earlier exactly like a weekend");
let monoBad = 0;
for (let i = 0; i < 2000; i++) {
  const post = E.addDays("2026-10-01", Math.floor(Math.random() * 500));
  const tats = Array.from({ length: 6 }, () => Math.floor(Math.random() * 90)).sort((a, b) => b - a);
  const dues = tats.map(t => E.dueDate(post, t, cx));
  if (dues.some((d, k) => k && d < dues[k - 1])) monoBad++;
  if (dues.some((d, k) => tats[k] && [6, 0].includes(E.weekdayOf(d)))) monoBad++;
}
eq(monoBad, 0, "CC-03 over 2,000 random plans a later stage is never due before an earlier one, and no deadline lands on a weekend");
eq(E.localDate(new Date("2026-09-16T21:30:00Z"), "Asia/Dubai"), "2026-09-17", "01:30 in Dubai is already the next day");
eq(E.localDate(new Date("2026-09-16T21:30:00Z"), "UTC"), "2026-09-16", "…which the v1 UTC clock would still call the previous day");
eq(E.previewDates({ per_month: 2, weeks: "1,3", weekdays: "2", start_period: "2026-10", end_period: "2027-03" }).length, 12,
  "six months at 2 a month is 12 dates");

/* ================================================================== */
section("§2  Stage lists — CC-01 to CC-07");
/* ================================================================== */
const st = (name, pct, tat, kind = "work", extra = {}) => ({ name, pct, tat_days: tat, kind, ...extra });
const LFV_STAGES = [st("Topic, theme & keyword mapped", 10, 60, "topic"), st("Script approved", 25, 40), st("Video shoot done", 50, 30),
  st("Editing done", 80, 14), st("Thumbnail & caption ready", 90, 3), st("Published", 100, 0, "publish")];
refused(() => E.saveStages(CM, LFV, LFV_STAGES), "CC-40", "a Content Manager changing the stage list", ["content.setup.manage"]);
refused(() => E.saveStages(ADMIN, LFV, [st("Published", 100, 0, "publish")]), "CC-01", "a list with one stage");
refused(() => E.saveStages(ADMIN, LFV, LFV_STAGES.slice(1)), "CC-01", "a list that does not start with the topic stage", ["first stage"]);
refused(() => E.saveStages(ADMIN, LFV, LFV_STAGES.slice(0, -1)), "CC-01", "a list that does not end with publishing", ["last stage"]);
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Second topic", 20, 50, "topic"), LFV_STAGES[5]]), "CC-01", "two topic stages");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("", 50, 10), LFV_STAGES[5]]), "CC-01", "an unnamed stage", ["stage 2"]);
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Edit", 40, 10), st("edit", 60, 5), LFV_STAGES[5]]), "CC-01", "two stages with the same name");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 50, 30), st("Edit", 45, 14), LFV_STAGES[5]]), "CC-02",
  "readiness that falls between stages", ["Edit", "45%"]);
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 50, 30), st("Published", 95, 0, "publish")]), "CC-02", "a publish stage below 100%");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 150, 30), LFV_STAGES[5]]), "CC-02", "readiness above 100");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 50, 14), st("Edit", 80, 30), LFV_STAGES[5]]), "CC-03",
  "a later stage due before an earlier one", ["Edit", "earlier"]);
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 50, 30), st("Published", 100, 2, "publish")]), "CC-03", "a publish stage with a TAT");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 50, -3), LFV_STAGES[5]]), "CC-03", "a negative TAT");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 50, 2.5), LFV_STAGES[5]]), "CC-03", "a fractional TAT");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Shoot", 50, 30, "work", { owner_role_id: 9999 }), LFV_STAGES[5]]), "CC-04",
  "an owner role that does not exist");
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Footage", 50, 30, "parent"), LFV_STAGES[5]]), "CC-05", "a 'from parent' stage naming no parent");
const lfv = E.saveStages(ADMIN, LFV, LFV_STAGES);
eq(lfv.stages.map(s => `${s.name}|${s.pct}|${s.tat_days}`), LFV_STAGES.map(s => `${s.name}|${s.pct}|${s.tat_days}`), "a valid long-form video stage list saves in order");
eq(lfv.stages.every(s => s.owner_role === "Content Manager"), true, "stages default to the Content Manager role");
const EDIT_STAGE = lfv.stages.find(s => s.name === "Editing done").id;
const TOPIC_STAGE_LFV = lfv.stages[0].id;
refused(() => E.saveStages(ADMIN, REEL, [st("Topic mapped", 10, 30, "topic"), st("Footage", 40, 21, "parent", { parent_stage_id: TOPIC_STAGE_LFV }),
  st("Published", 100, 0, "publish")]), "CC-05", "a parent stage that is a topic stage", ["production or publish"]);
refused(() => E.saveStages(ADMIN, LFV, [...LFV_STAGES.slice(0, 4).map((s, i) => ({ ...s, id: lfv.stages[i].id })),
  st("Own footage", 85, 3, "parent", { parent_stage_id: EDIT_STAGE }), { ...LFV_STAGES[5], id: lfv.stages[5].id }]), "CC-05",
  "a stage waiting on its own content type");
const REEL_STAGES = [st("Topic mapped", 10, 30, "topic"), st("Raw footage available", 40, 21, "parent", { parent_stage_id: EDIT_STAGE }),
  st("Reel edited", 75, 7), st("Caption & cover ready", 90, 2), st("Published", 100, 0, "publish")];
refused(() => E.saveStages(ADMIN, REEL, [REEL_STAGES[0], REEL_STAGES[1], { ...REEL_STAGES[1], name: "More footage", pct: 50 }, REEL_STAGES[4]]),
  "CC-05", "two parent stages in one list");
const reel = E.saveStages(ADMIN, REEL, REEL_STAGES);
eq(reel.stages[1].parent_stage_name, "Editing done", "a reel's raw footage waits on the long-form video's editing");
eq(reel.stages[1].parent_type_name, "Long-form video", "…of the long-form video type");
const REEL_TOPIC = reel.stages[0].id;
refused(() => E.saveStages(ADMIN, LFV, [LFV_STAGES[0], st("Borrowed footage", 50, 21, "parent", { parent_stage_id: reel.stages[2].id }),
  LFV_STAGES[5]]), "CC-05", "two content types that would wait on each other", ["each other"]);
refused(() => E.saveStages(ADMIN, LFV, LFV_STAGES), "CC-06", "re-saving the long-form list without ids, which would delete the stage reels wait on",
  ["Reel", "Raw footage available"]);
const CAR_STAGES = [st("Topic mapped", 10, 30, "topic"), st("Design done", 60, 7), st("Caption & approval", 90, 3), st("Published", 100, 0, "publish")];
E.saveStages(ADMIN, CAR, CAR_STAGES);
refused(() => E.saveAccount(ADMIN, null, { name: "assured" }), "CC-07", "a second account with the same name", ["already"]);
refused(() => E.saveAccount(ADMIN, null, { name: "Shireen", kind: "Team" }), "CC-07", "an account kind that is not Company or Personal");
refused(() => E.saveAccount(SALES, null, { name: "Shireen", kind: "Personal" }), "CC-40", "a sales user adding an account");
refused(() => E.saveMetric(ADMIN, null, { name: "likes" }), "CC-07", "a second metric with the same name");
const WATCH = E.saveMetric(ADMIN, null, { name: "Watch time (minutes)", platforms: [YT] });
eq(WATCH.platforms, [YT], "a metric can be limited to the platforms that report it");
refused(() => E.saveHoliday(ADMIN, { date: "2026-02-30", name: "Not a day" }), "CC-07", "a holiday on a date that does not exist");

// Content types and platforms are the calendar's own lists (CC-07, CC-09)
refused(() => E.saveType(CM, null, { name: "Podcast clip" }), "CC-40", "a Content Manager adding a content type", ["content.setup.manage"]);
refused(() => E.saveType(ADMIN, null, { name: "  " }), "CC-07", "a content type with no name");
refused(() => E.saveType(ADMIN, null, { name: "reel" }), "CC-07", "a second content type with the same name", ["already"]);
refused(() => E.savePlatform(ADMIN, null, { name: "linkedin" }), "CC-07", "a second platform with the same name");
refused(() => E.savePlatform(ADMIN, null, { name: "Threads", colour: "red;background:url(x)" }), "CC-07",
  "a platform colour that is not #RRGGBB — it is written into the page as a style", ["#RRGGBB"]);
refused(() => E.saveAccount(ADMIN, null, { name: "Assured Academy", colour: "blue" }), "CC-07", "an account colour that is not #RRGGBB");
const THREADS = E.savePlatform(ADMIN, null, { name: "Threads", colour: "#101010" });
eq([THREADS.name, THREADS.colour, THREADS.active], ["Threads", "#101010", 1], "a platform is added with its colour");
refused(() => E.deleteType(ADMIN, ct1), "CC-09", "deleting a content type that items use", ["item", "Deactivate"]);
refused(() => E.deleteType(ADMIN, CAR), "CC-09", "deleting a content type whose stage list exists", ["stage"]);
refused(() => E.deletePlatform(ADMIN, LI), "CC-09", "deleting a platform that posts went out on", ["post"]);
eq(E.deletePlatform(ADMIN, THREADS.id).ok, true, "an unused platform can be deleted outright");
const firstLongForm = id("SELECT id FROM content WHERE type_id=? ORDER BY id LIMIT 1", ct1);
E.saveType(ADMIN, ct1, { name: "Long-form", active: false });
eq([id("SELECT active FROM content_type WHERE id=?", ct1), E.getItem(firstLongForm).type_name], [0, "Long-form"],
  "CC-09 a type in use is deactivated instead, and stays on the items that carry it");
E.saveType(ADMIN, ct1, { name: "Long-form", active: true });

/* ================================================================== */
section("§3  Targets that write the calendar — CC-10 to CC-15");
/* ================================================================== */
const cad = (o = {}) => ({ account_id: ASSURED, type_id: LFV, platforms: [YT, LI], per_month: 2, weeks: "1,3", weekdays: "2",
  start_period: "2026-10", end_period: "2027-03", ...o });
refused(() => E.saveCadence(CM, { per_month: 2 }), "CC-11", "a target with no account, type or platform", ["Account", "Content type", "Platform"]);
refused(() => E.saveCadence(SALES, cad()), "CC-40", "a sales user setting a target", ["content.cadence.manage"]);
refused(() => E.saveCadence(CM, cad({ type_id: ct1 })), "CC-11", "a target for a content type with no stage list", ["no stage list"]);
refused(() => E.saveCadence(CM, cad({ weeks: "1" })), "CC-12", "2 a month on one weekday with one week chosen", ["1st & 3rd", "2nd & 4th"]);
refused(() => E.saveCadence(CM, cad({ weeks: "1,5" })), "CC-12", "a 5th week, which only some months have", ["5th"]);
refused(() => E.saveCadence(CM, cad({ weekdays: "" })), "CC-12", "no weekday");
refused(() => E.saveCadence(CM, cad({ weekdays: "7", weeks: "1,3" })), "CC-12", "a weekday that does not exist");
refused(() => E.saveCadence(CM, cad({ per_month: 0 })), "CC-12", "zero posts a month");
refused(() => E.saveCadence(CM, cad({ start_period: "Oct 2026" })), "CC-10", "a period not written YYYY-MM");
refused(() => E.saveCadence(CM, cad({ start_period: "2027-04" })), "CC-10", "a period that ends before it starts");
refused(() => E.saveCadence(CM, cad({ end_period: "2028-12" })), "CC-10", "a target longer than 24 months", ["27"]);
refused(() => E.saveCadence(CM, cad({ start_period: "2026-01", end_period: "2026-08" })), "CC-10", "a target entirely in the past");
refused(() => E.saveCadence(CM, cad({ platforms: [9999] })), "CC-11", "a platform that does not exist");

const c1 = E.saveCadence(CM, cad());
eq(c1.created, 12, "CC-14 Assured · Long-form video · 2 a month · 1st & 3rd Tuesday · Oct–Mar creates 12 slots");
eq(c1.dates.slice(0, 6), ["2026-10-06", "2026-10-20", "2026-11-03", "2026-11-17", "2026-12-01", "2026-12-15"], "…on the right Tuesdays");
eq(c1.born_late, 3, "CC-14 the three posts before mid-November are already past their 60-day topic deadline when created");
eq(c1.cadence.pattern, "2/month · 1st & 3rd Tuesday", "the target reads back in words");
eq(c1.cadence.platform_names, "LinkedIn, YouTube", "the target carries both platforms");
const slot = date => E.getItem(id("SELECT id FROM content WHERE type_id=? AND account_id=? AND date=? AND cancelled_at IS NULL ORDER BY id DESC",
  ...(date.length === 3 ? date : [LFV, ASSURED, date])));
const oct6 = slot("2026-10-06");
eq(oct6.state, "Open slot", "a generated slot is open for its topic");
eq(oct6.title, null, "a generated slot has no topic yet");
eq(oct6.platforms.map(p => p.name), ["LinkedIn", "YouTube"], "a slot goes out on the target's platforms");
eq(oct6.tasks.length, 6, "a slot carries its own copy of the six long-form stages");
eq(oct6.tasks[0].state, "overdue", "its topic stage is overdue on day one");
eq(oct6.tasks[0].born_late, true, "…and flagged as created after its deadline");
eq(oct6.tasks.slice(1).every(t => t.state === "blocked"), true, "every later stage waits for the one before it");
eq(E.generate(c1.cadence.id).created, 0, "CC-14 generating again creates nothing");
eq(E.generate(c1.cadence.id).existing, 12, "…and recognises all twelve");
refused(() => E.saveCadence(CM, cad({ start_period: "2026-11", end_period: "2026-12", weeks: "1", per_month: 1 })), "CC-13",
  "a second target claiming the 1st Tuesday for the same account and type", ["1st Tuesday", "Revise"]);
const c5 = E.saveCadence(CM, cad({ weeks: "2,4", start_period: "2027-01" }));
eq(c5.created, 6, "CC-13 the 2nd & 4th Tuesdays are free, so a second target may take them");
const c2 = E.saveCadence(CM, cad({ type_id: REEL, platforms: [IG, LI], per_month: 4, weeks: "1,2,3,4", weekdays: "4" }));
eq(c2.created, 24, "Assured · Reel · every week · Thursday · Oct–Mar creates 24 slots");
eq(c2.dates.filter(d => d.startsWith("2026-10")), ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"],
  "October 2026 has five Thursdays; the 29th is not used, so the count stays 4");
const c3 = E.saveCadence(CM, cad({ account_id: SIDDIQUE, type_id: CAR, platforms: [LI], weekdays: "3",
  start_period: "2026-09", end_period: "2026-12" }));
eq(c3.skipped_past, 1, "CC-14 2 September is past, so it is skipped");
eq(c3.created, 7, "…and 16 September (today) onwards is created");
eq(c3.dates[0], "2026-09-16", "a slot dated today is still created");
const E2 = E.saveCadence(CM, cad({ account_id: DHIRAJ, type_id: CAR, platforms: [LI], weekdays: "1", start_period: "2026-10", end_period: "2026-12" }));
eq(E2.created, 6, "Dhiraj · Carousel · 1st & 3rd Monday · Oct–Dec creates 6 slots");
ok(db.col("SELECT COUNT(*) FROM notifications WHERE user_id=? AND kind='content'", CM.id) >= 4,
  "the Content Manager is told each time a target adds slots");

// CC-15 revise from November: 1st & 3rd → 2nd & 4th Wednesday
const car = d => slot([CAR, SIDDIQUE, d]);
E.mapTopic(CM, car("2026-11-04").id, { title: "Five questions before you hire a CFO", theme: "Finance leadership", keyword: "fractional CFO" });
E.mapTopic(CM, car("2026-12-16").id, { title: "Year-end stock count checklist", theme: "Inventory control", keyword: "stock count" });
refused(() => E.reviseCadence(CM, c3.cadence.id, { from_period: "2026-08", weeks: "2,4" }), "CC-15", "revising a month that is past");
refused(() => E.reviseCadence(CM, c3.cadence.id, { from_period: "2027-02", weeks: "2,4" }), "CC-15", "revising outside the target's months");
refused(() => E.reviseCadence(CM, c3.cadence.id, { from_period: "2026-11", weeks: "2" }), "CC-12", "a revision whose count does not add up");
const r1 = E.reviseCadence(CM, c3.cadence.id, { from_period: "2026-11", weeks: "2,4" });
eq(r1.released, { removed: 2, kept: 2, carried: 0 }, "CC-15 two untouched slots go; the two with topics stay");
eq(r1.dates, ["2026-11-11", "2026-11-25", "2026-12-09", "2026-12-23"], "the new pattern's dates are created");
eq(r1.old.end_period, "2026-10", "the old target now ends in October");
eq(r1.old.replaced_by, r1.cadence.id, "…and names its successor");
eq(car("2026-11-04").orphaned, 1, "a worked-on slot the new pattern does not want is kept and flagged");
ok(car("2026-11-04").flags.includes("Its target was revised after work started"), "…and the flag is visible on the item");
eq(db.col("SELECT COUNT(*) FROM content WHERE account_id=? AND type_id=? AND date='2026-11-18'", SIDDIQUE, CAR), 0,
  "an untouched slot from the old pattern is gone");
E.mapTopic(CM, car("2026-12-09").id, { title: "Cash conversion cycle in one page", theme: "Working capital", keyword: "cash cycle" });
const r2 = E.reviseCadence(CM, r1.cadence.id, { from_period: "2026-12", per_month: 4, weeks: "1,2,3,4" });
eq(r2.released.carried, 2, "CC-15 worked-on slots on dates the new pattern wants are carried over, not duplicated");
eq(r2.created, 2, "…so only 2 and 23 December are new");
eq(db.col("SELECT COUNT(*) FROM content WHERE account_id=? AND type_id=? AND date LIKE '2026-12-%' AND cancelled_at IS NULL", SIDDIQUE, CAR), 4,
  "December holds exactly four Siddique carousels");
eq(car("2026-12-16").orphaned, 0, "the 16 December slot flagged by the first revision is adopted by the new target");
eq(car("2026-12-16").title, "Year-end stock count checklist", "…with its topic intact");
eq(car("2026-11-04").orphaned, 1, "the November orphan stays flagged — no target wants that date");
refused(() => E.endCadence(CM, c2.cadence.id, { last_period: "2027-03" }), "CC-15", "ending a target on the month it already ends");
const end = E.endCadence(CM, c2.cadence.id, { last_period: "2027-01" });
eq(end.released.removed, 8, "ending the reel target after January removes February's and March's eight untouched slots");
eq(db.col("SELECT end_period FROM content_cadence WHERE id=?", c2.cadence.id), "2027-01", "the reel target now ends in January");

/* ================================================================== */
section("§4  Working an item — CC-20 to CC-23, CC-26, CC-27");
/* ================================================================== */
refused(() => E.createItem(CM, {}), "CC-20", "an item with nothing", ["Date", "Content type", "Account", "Platform"]);
refused(() => E.createItem(CEO, { date: "2027-03-15", type_id: LFV, account_id: ASSURED, platforms: [YT] }), "CC-40",
  "a user without content access", ["crm.content.manage"]);
refused(() => E.createItem(CM, { date: "2027-02-30", type_id: LFV, account_id: ASSURED, platforms: [YT] }), "CC-20", "a date that does not exist");
refused(() => E.createItem(CM, { date: "2026-09-15", type_id: LFV, account_id: ASSURED, platforms: [YT] }), "CC-26", "a date in the past");
refused(() => E.createItem(CM, { date: "2027-03-15", type_id: ct1, account_id: ASSURED, platforms: [YT] }), "CC-20",
  "a content type with no stage list", ["Setup"]);
E.saveAccount(ADMIN, DHIRAJ, { name: "Dhiraj", kind: "Personal", active: 0 });
refused(() => E.createItem(CM, { date: "2027-03-15", type_id: CAR, account_id: DHIRAJ, platforms: [LI] }), "CC-20", "an inactive account");
E.saveAccount(ADMIN, DHIRAJ, { name: "Dhiraj", kind: "Personal", active: 1 });

// the sponsor's own example: a long-form video posted on 15 March 2027
let X = E.createItem(CM, { date: "2027-03-15", type_id: LFV, account_id: ASSURED, platforms: [YT, LI] });
eq(X.tasks.map(t => t.due), ["2027-01-14", "2027-02-03", "2027-02-12", "2027-03-01", "2027-03-12", "2027-03-15"],
  "every stage's deadline is counted back from 15 March and kept off weekends");
eq(X.readiness, 0, "a new item is 0% ready");
const task = (it, name) => it.tasks.find(t => t.name === name).id;
X = E.mapTopic(SALES, X.id, { title: "Why your close takes 12 days" });
refused(() => E.completeTask(CM, task(X, "Topic, theme & keyword mapped")), "CC-21", "the topic stage with theme and keyword missing",
  ["Content theme", "Keyword"]);
X = E.mapTopic(SALES, X.id, { theme: "Financial control", keyword: "month-end close" });
eq(X.state, "Open slot", "CC-23 a topic mapped by someone outside the owner role waits for the Content Manager to confirm it");
X = E.completeTask(CM, task(X, "Topic, theme & keyword mapped"));
eq([X.state, X.readiness], ["In production", 10], "confirming the topic makes the item 10% ready");
refused(() => E.mapTopic(CM, X.id, { keyword: "" }), "CC-21", "clearing the keyword of a mapped topic", ["Reopen"]);
refused(() => E.completeTask(CM, task(X, "Editing done")), "CC-22", "editing before the script and the shoot", ["Script approved"]);
refused(() => E.completeTask(SALES, task(X, "Script approved")), "CC-23", "a stage completed by someone outside its owner role",
  ["Content Manager"]);
X = E.completeTask(ADMIN, task(X, "Script approved"));
ok(X.tasks[1].note.includes("administrator"), "CC-23 a content administrator may complete it, and the record says so");
ok(db.col("SELECT COUNT(*) FROM audit WHERE entity='content_task' AND action='override'") === 1, "CC-23 the override is audited");
X = E.completeTask(CM, task(X, "Video shoot done"));
eq(X.readiness, 50, "the shoot done makes it 50% ready");
X = E.completeTask(CM, task(X, "Editing done"));
eq(X.readiness, 80, "editing done makes it 80% ready");
refused(() => E.completeTask(CM, task(X, "Video shoot done")), "CC-22", "completing a stage twice", ["already done"]);
refused(() => E.completeTask(CM, task(X, "Published")), "CC-25", "ticking the publish stage by hand", ["Publish"]);
refused(() => E.reschedule(CM, X.id, { date: "2027-03-15", reason: "no change at all here" }), "CC-26", "moving an item to the date it already has");
refused(() => E.reschedule(CM, X.id, { date: "2026-09-01", reason: "backdating the video" }), "CC-26", "moving an item into the past");
refused(() => E.reschedule(CM, X.id, { date: "2027-03-22" }), "CC-26", "moving a started item without a reason", ["reason"]);
X = E.reschedule(CM, X.id, { date: "2027-03-22", reason: "Client case study approval slipped a week" });
eq(X.tasks.find(t => t.name === "Video shoot done").due, "2027-02-19", "CC-26 moving the post a week moves the shoot deadline with it (Sat 20 → Fri 19 Feb)");
eq(X.warnings, [], "nothing becomes overdue by that move");
refused(() => E.reopenTask(CM, task(X, "Video shoot done"), {}), "CC-27", "reopening without a reason");
refused(() => E.reopenTask(CM, task(X, "Thumbnail & caption ready"), { reason: "never done in the first place" }), "CC-27", "reopening a stage that is not done");
X = E.reopenTask(CM, task(X, "Video shoot done"), { reason: "Audio unusable, reshoot booked" });
eq([X.readiness, X.tasks.filter(t => t.done_at).length], [25, 2], "CC-27 reopening the shoot reopens editing too and readiness falls to 25%");

/* ================================================================== */
section("§5  Reels cut from a long-form video — CC-24");
/* ================================================================== */
let P = slot("2026-11-17");
const reelOn = d => slot([REEL, ASSURED, d]);
let R = reelOn("2026-11-26");
const Rbad = reelOn("2026-11-12"), Rother = reelOn("2026-11-05");
refused(() => E.linkParent(CM, P.id, X.id), "CC-24", "a long-form video given a parent", ["does not take material"]);
refused(() => E.linkParent(CM, R.id, Rother.id), "CC-24", "a reel whose parent is another reel", ["Long-form video", "is a Reel"]);
refused(() => E.linkParent(CM, R.id, R.id), "CC-24", "an item as its own parent");
refused(() => E.linkParent(CM, Rbad.id, P.id), "CC-24", "a reel that needs footage before the video's editing is due",
  ["2026-10-22", "2026-11-03"]);
R = E.linkParent(CM, R.id, P.id);
eq(R.parent_id, P.id, "a reel on 26 Nov can take its footage from the video of 17 Nov (editing due 3 Nov, footage needed 5 Nov)");
R = E.mapTopic(CM, R.id, { title: "The 12-day close in 45 seconds", theme: "Financial control", keyword: "month-end close" });
eq(R.tasks[1].state, "waiting", "the reel's footage stage is waiting on the video");
refused(() => E.completeTask(CM, task(R, "Raw footage available")), "CC-24", "ticking the reel's footage by hand while the video is being edited",
  ["ticks itself"]);
P = E.mapTopic(CM, P.id, { title: "Inside a 12-day month-end close", theme: "Financial control", keyword: "month-end close" });
["Script approved", "Video shoot done"].forEach(n => { P = E.completeTask(CM, task(P, n)); });
eq(E.getItem(R.id).tasks[1].done_at, null, "the footage is not in until the video's editing is done");
const notesBefore = db.col("SELECT COUNT(*) FROM notifications WHERE user_id=? AND text LIKE '%can start%'", CM.id);
P = E.completeTask(CM, task(P, "Editing done"));
R = E.getItem(R.id);
eq([R.tasks[1].auto, R.readiness], [1, 40], "CC-24 the video's editing done ticks the reel's footage stage — 40% ready");
ok(R.tasks[1].note.includes("Inside a 12-day month-end close"), "…and says which video it came from");
eq(db.col("SELECT COUNT(*) FROM notifications WHERE user_id=? AND text LIKE '%can start%'", CM.id), notesBefore + 1,
  "the owner of the reel's next stage is told it can start");
let R2 = E.linkParent(CM, reelOn("2026-11-19").id, P.id);
eq(R2.tasks[1].done_at, null, "a reel linked after the editing is done still waits for its own topic first");
R2 = E.mapTopic(CM, R2.id, { title: "Three signs your close is broken", theme: "Financial control", keyword: "close checklist" });
eq(R2.tasks[1].auto, 1, "CC-24 …and its footage ticks itself the moment its topic is in");
P = E.reopenTask(CM, task(P, "Editing done"), { reason: "Legal asked for a client name to be removed" });
eq([E.getItem(R.id).tasks[1].done_at, E.getItem(R2.id).tasks[1].done_at], [null, null],
  "CC-27 reopening the video's editing takes the footage back from both reels");
ok(db.col("SELECT COUNT(*) FROM notifications WHERE text LIKE '%lost \"Raw footage available\"%'") >= 2, "…and says so");
P = E.completeTask(CM, task(P, "Editing done"));
eq(E.getItem(R.id).tasks[1].auto, 1, "editing done again returns the footage");
refused(() => E.linkParent(CM, R.id, null), "CC-24", "changing the parent after the footage is in", ["reopen"]);
let S = E.mapTopic(CM, reelOn("2026-12-03").id, { title: "Stock count myths", theme: "Inventory", keyword: "stock count" });
refused(() => E.completeTask(CM, task(S, "Raw footage available")), "CC-24", "a reel with no parent ticked without saying where the footage came from",
  ["Link the one"]);
S = E.completeTask(CM, task(S, "Raw footage available"), { note: "Shot separately at the client's warehouse" });
eq(S.readiness, 40, "a stand-alone reel can proceed once the source of its footage is recorded");

let P2 = E.createItem(CM, { date: "2026-12-22", type_id: LFV, account_id: ASSURED, platforms: [YT],
  title: "Year-end close without the panic", theme: "Financial control", keyword: "year-end close" });
let R3 = E.createItem(CM, { date: "2026-12-31", type_id: REEL, account_id: ASSURED, platforms: [IG],
  title: "Year-end close in 30 seconds", theme: "Financial control", keyword: "year-end close", parent_id: P2.id });
eq([P2.readiness, R3.parent_id], [10, P2.id], "an item can be created with its topic and its parent in one go");
refused(() => E.reschedule(CM, P2.id, { date: "2026-12-29" }), "CC-26", "moving an item whose topic is mapped without a reason");
P2 = E.reschedule(CM, P2.id, { date: "2026-12-29", reason: "Client asked for the week after Christmas" });
eq(P2.warnings.length, 1, "moving the video later warns that its reel now needs footage too early");
ok(E.getItem(R3.id).flags.includes("Parent stage is due after this item needs it"), "…and the reel carries the flag");
refused(() => E.reschedule(CM, R3.id, { date: "2026-12-24", reason: "Wanted it before Christmas" }), "CC-24",
  "moving a reel earlier than its video can supply footage");
refused(() => E.cancelItem(CM, P2.id, { reason: "no" }), "CC-28", "cancelling with a one-word reason");
const cancelled = E.cancelItem(CM, P2.id, { reason: "Client withdrew permission to feature them" });
eq([cancelled.state, cancelled.children_flagged], ["Cancelled", 1], "CC-28 cancelling the video flags the reel cut from it");
ok(E.getItem(R3.id).flags.includes("Parent item was cancelled"), "…and the reel says why it is stuck");
refused(() => E.completeTask(CM, task(E.getItem(P2.id), "Script approved")), "CC-28", "working on a cancelled item");
refused(() => E.linkParent(CM, Rother.id, P2.id), "CC-28", "choosing a cancelled video as a parent");
refused(() => E.cancelItem(CM, P2.id, { reason: "Cancelling it a second time" }), "CC-28", "cancelling twice");

/* ================================================================== */
section("§6  Publishing — CC-25");
/* ================================================================== */
P = E.completeTask(CM, task(P, "Thumbnail & caption ready"));
eq([P.state, P.readiness], ["Ready", 90], "every stage but publishing done: Ready, 90%");
E.setToday("2026-11-17");
refused(() => E.publish(CM, X.id, {}), "CC-25", "publishing with stages open", ["Video shoot done", "Editing done"]);
refused(() => E.publish(CM, P.id, { published_on: "2026-11-18" }), "CC-25", "publishing tomorrow", ["future"]);
refused(() => E.publish(CM, P.id, { urls: { [YT]: "https://youtu.be/abc123" } }), "CC-25", "publishing without the LinkedIn link", ["LinkedIn"]);
refused(() => E.publish(CM, P.id, { urls: { [YT]: "youtube somewhere", [LI]: "https://www.linkedin.com/posts/x" } }), "CC-25",
  "publishing with something that is not a link", ["youtube somewhere"]);
refused(() => E.publish(CM, P.id, { urls: { [IG]: "https://instagram.com/p/x" } }), "CC-25", "a link for a platform the item is not on");
refused(() => E.publish(SALES, P.id, { urls: { [YT]: "https://youtu.be/abc123", [LI]: "https://www.linkedin.com/posts/x" } }), "CC-23",
  "publishing by someone outside the publish stage's owner role");
P = E.publish(CM, P.id, { urls: { [YT]: "https://youtu.be/abc123", [LI]: "https://www.linkedin.com/posts/assured-close" } });
eq([P.state, P.readiness, P.published_on, P.status], ["Published", 100, "2026-11-17", "Published"], "published on its date: 100%");
ok(P.url && P.url.startsWith("https://"), "the v1 url column is kept in step for the v1 screens");
refused(() => E.publish(CM, P.id, {}), "CC-25", "publishing twice");
refused(() => E.reopenTask(CM, task(P, "Editing done"), { reason: "Trying to edit after going live" }), "CC-27", "reopening a published item");
refused(() => E.reschedule(CM, P.id, { date: "2026-11-30", reason: "Trying to move history" }), "CC-26", "moving a published item");
refused(() => E.cancelItem(CM, P.id, { reason: "Trying to cancel after going live" }), "CC-28", "cancelling a published item");
["Reel edited", "Caption & cover ready"].forEach(n => { R = E.completeTask(CM, task(R, n)); });
E.setToday("2026-11-28");
R = E.publish(CM, R.id, { published_on: "2026-11-27", urls: { [IG]: "https://instagram.com/reel/abc", [LI]: "https://www.linkedin.com/posts/r1" } });
eq([R.state, R.published_on, R.date], ["Published", "2026-11-27", "2026-11-26"], "a reel published a day after its date is recorded as such");

/* ================================================================== */
section("§7  Metrics — CC-30, CC-31");
/* ================================================================== */
const M = n => id("SELECT id FROM content_metric WHERE name=?", n);
refused(() => E.recordMetrics(CM, X.id, { channel_id: YT, values: { [M("Views")]: 10 } }), "CC-30", "figures for an item not yet published");
refused(() => E.recordMetrics(CM, P.id, { channel_id: IG, values: { [M("Views")]: 10 } }), "CC-30", "figures for a platform the item was not posted on",
  ["LinkedIn", "YouTube"]);
refused(() => E.recordMetrics(CM, P.id, { channel_id: LI, captured_on: "2026-11-16", values: { [M("Likes")]: 3 } }), "CC-30",
  "figures dated before the post went out");
refused(() => E.recordMetrics(CM, P.id, { channel_id: LI, captured_on: "2026-12-01", values: { [M("Likes")]: 3 } }), "CC-30", "figures dated in the future");
refused(() => E.recordMetrics(CM, P.id, { channel_id: LI, values: {} }), "CC-30", "a capture with no figures");
refused(() => E.recordMetrics(CM, P.id, { channel_id: LI, captured_on: "2026-11-24",
  values: { [M("Impressions")]: -5, [M("Likes")]: "2.5", [WATCH.id]: 10 } }), "CC-30", "a batch with three problems names all three",
  ["Impressions must be", "Likes must be", "not reported by LinkedIn"]);
eq(id("SELECT COUNT(*) FROM content_metric_value WHERE content_id=?", P.id), 0, "…and saves none of the batch");
let mv = E.recordMetrics(CM, P.id, { channel_id: LI, captured_on: "2026-11-24",
  values: { [M("Impressions")]: "4,200", [M("Likes")]: 85, [M("Profile visits")]: 31 } });
eq(mv.latest.length, 3, "several metrics are recorded for one post on one platform in one go");
eq(mv.latest.find(v => v.metric === "Impressions").value, 4200, "a figure typed with a thousands separator is stored as a number");
mv = E.recordMetrics(SALES, P.id, { channel_id: LI, captured_on: "2026-11-24", values: { [M("Likes")]: 90 } });
eq([mv.history.length, mv.latest.find(v => v.metric === "Likes").value], [3, 90], "CC-31 recording the same figure for the same day replaces it");
eq(id("SELECT COUNT(*) FROM audit WHERE entity='content_metric_value' AND action='replace'"), 1, "CC-31 …and the replacement is audited with old and new");
mv = E.recordMetrics(CM, P.id, { channel_id: YT, captured_on: "2026-11-24",
  values: { [M("Views")]: 640, [WATCH.id]: 1900, [M("Likes")]: 22 } });
eq(mv.latest.filter(v => v.platform === "YouTube").length, 3, "YouTube carries its own figures, including a YouTube-only metric");
mv = E.recordMetrics(CM, P.id, { channel_id: LI, captured_on: "2026-11-28", values: { [M("Impressions")]: 5100 } });
eq([mv.latest.find(v => v.metric === "Impressions" && v.platform === "LinkedIn").value,
  mv.history.filter(v => v.metric === "Impressions").length], [5100, 2], "a later capture becomes the latest; the earlier one stays in the history");
const sum = E.metricsSummary("2026-11");
eq(sum.find(s => s.account === "Assured" && s.platform === "LinkedIn" && s.metric === "Impressions").total, 5100,
  "the month's summary adds up the latest figure of each post");
let tl = E.taskList(CM, { asOf: "2026-11-28" }).filter(t => t.kind === "metrics");
eq(tl.find(t => t.item_id === R.id)?.stage, "Capture day-7 figures — LinkedIn, Instagram", "a day-7 capture comes due for the reel on both platforms");
E.setToday("2026-12-04");
E.recordMetrics(CM, R.id, { channel_id: IG, captured_on: "2026-12-04", values: { [M("Views")]: 2300, [M("Likes")]: 140 } });
tl = E.taskList(CM, { asOf: "2026-12-04" }).filter(t => t.kind === "metrics" && t.item_id === R.id);
eq(tl.map(t => t.stage), ["Capture day-7 figures — LinkedIn"], "once Instagram is in, only LinkedIn is still owed");
E.recordMetrics(CM, R.id, { channel_id: LI, captured_on: "2026-12-04", values: { [M("Impressions")]: 1800 } });
eq(E.taskList(CM, { asOf: "2026-12-04" }).filter(t => t.kind === "metrics" && t.item_id === R.id && t.stage.includes("day-7")).length, 0,
  "the day-7 capture clears when every platform has its figures");
eq(E.taskList(CM, { asOf: "2026-12-12" }).filter(t => t.kind === "metrics" && t.item_id === P.id).map(t => t.stage),
  ["Capture day-30 figures — LinkedIn, YouTube"], "the video's day-30 capture comes into view a week before it is due");

/* ================================================================== */
section("§8  The Content Manager's work list and the topic look-ahead");
/* ================================================================== */
E.setToday("2026-09-16");
tl = E.taskList(CM, { asOf: "2026-09-16" });
ok(tl.length > 50, "the Content Manager has a work list across every live item");
eq(tl[0].state, "overdue", "overdue work comes first");
const order = { overdue: 0, "due-soon": 1, upcoming: 2, waiting: 3, blocked: 4 };
ok(tl.every((t, i) => !i || order[tl[i - 1].state] <= order[t.state]), "the list runs overdue → due soon → upcoming → waiting → blocked");
ok(tl.every(t => t.owner_role === "Content Manager"), "'mine' holds only stages the user's roles own");
ok(!tl.some(t => t.item_id === P2.id), "a cancelled item has no work");
ok(!tl.some(t => t.item_id === P.id && t.kind === "stage"), "a published item has no stage work");
ok(tl.some(t => t.date === "2026-10-06" && t.born_late && t.stage.startsWith("Topic")), "the 6 October topic is listed as late from the start");
eq(E.taskList(SALES, { scope: "mine" }).filter(t => t.kind === "stage").length, 0, "a sales user owns none of the content stages");
ok(E.taskList(SALES, { scope: "all" }).length > 0, "…but can see the whole list");
refused(() => E.taskList(CEO), "CC-40", "a user without content access asking for the list");
const gaps = E.topicGaps({ asOf: "2026-09-16", horizon: 60 });
ok(gaps.length > 0 && gaps.every(g => g.date <= "2026-11-15"), "the look-ahead lists open topics for the next 60 days only");
ok(gaps.some(g => g.date === "2026-10-06" && g.state === "overdue" && g.born_late), "…including the ones already late");
ok(!gaps.some(g => g.id === P.id || g.id === R.id), "…and none that are already mapped");
eq(gaps.filter(g => g.account === "Dhiraj").map(g => g.date), ["2026-10-05", "2026-10-19", "2026-11-02"],
  "Dhiraj's three carousels inside the window are on it");
const d1 = E.dailyDigest("2026-09-17");
ok(d1.sent >= 1 && !d1.skipped, "the first request of the day sends the digest");
eq(E.dailyDigest("2026-09-17").skipped, true, "…and only once that day");
eq(E.dailyDigest("2026-09-18").skipped, false, "…and again the next day");
ok(String(db.col("SELECT text FROM notifications WHERE user_id=? AND text LIKE 'Content today:%' ORDER BY id DESC", CM.id)).includes("overdue"),
  "the Content Manager's digest counts the overdue stages");
E.setToday(null);
eq(E.today(), E.localDate(new Date(), "Asia/Dubai"), "unpinned, 'today' is the Dubai date");
E.setToday("2026-11-28");

/* ================================================================== */
section("§9  Target against actual");
/* ================================================================== */
let sc = E.scorecard("2026-11");
const row = (a, t, s = sc) => s.find(x => x.account === a && x.type === t);
eq([row("Assured", "Long-form video").target, row("Assured", "Long-form video").planned, row("Assured", "Long-form video").published,
  row("Assured", "Long-form video").on_time, row("Assured", "Long-form video").achievement_pct], [2, 2, 1, 1, 50],
  "Assured long-form, November: 2 targeted, 2 planned, 1 published on time — 50%");
eq([row("Assured", "Reel").target, row("Assured", "Reel").published, row("Assured", "Reel").on_time], [4, 1, 0],
  "Assured reels, November: the one published a day late is not on time");
eq([row("Siddique", "Carousel").target, row("Siddique", "Carousel").planned], [2, 3],
  "Siddique carousels, November: target 2 from the revised pattern; the flagged orphan still shows as planned");
eq(row("Dhiraj", "Carousel").target, 2, "Dhiraj carousels, November: target 2");
E.cancelItem(CM, slot("2026-11-03").id, { reason: "Speaker unavailable, slot dropped" });
sc = E.scorecard("2026-11");
eq([row("Assured", "Long-form video").target, row("Assured", "Long-form video").planned, row("Assured", "Long-form video").cancelled],
  [2, 1, 1], "a cancelled slot is a miss: the target stays 2");
const moved = E.reschedule(CM, slot("2026-12-15").id, { date: "2026-12-16" });
eq(moved.moved, true, "a slot moved off its cadence date is marked as moved");
eq(row("Assured", "Long-form video", E.scorecard("2026-12")).moved, 1, "…and the month counts it");
eq(row("Assured", "Long-form video", E.scorecard("2027-01")).target, 4, "January carries both long-form targets: 4");
E.createItem(CM, { date: "2026-12-10", type_id: LFV, account_id: SIDDIQUE, platforms: [LI] });
const adhoc = row("Siddique", "Long-form video", E.scorecard("2026-12"));
eq([adhoc.target, adhoc.planned, adhoc.achievement_pct], [0, 1, null], "an ad-hoc item with no target shows up with no achievement %");

/* ================================================================== */
section("§10  Deleting, and the lead picker — CC-29");
/* ================================================================== */
refused(() => E.deleteItem(CM, slot("2027-01-05").id), "CC-29", "deleting a cadence slot", ["Cancel"]);
const Y = E.createItem(CM, { date: "2026-12-10", type_id: CAR, account_id: DHIRAJ, platforms: [LI],
  title: "Ramadan stock planning", theme: "Inventory", keyword: "stock planning" });
const leadId = id("SELECT id FROM lead ORDER BY id LIMIT 1");
C.attachContent(ADMIN, leadId, { content_id: Y.id });
refused(() => E.deleteItem(CM, Y.id), "CC-29", "deleting an item a lead is attributed to", ["1 lead", "BR-34"]);
C.detachContent(ADMIN, leadId, Y.id);
eq(E.deleteItem(CM, Y.id).ok, true, "an ad-hoc item with no lead can be deleted");
const P4 = E.createItem(CM, { date: "2027-02-16", type_id: LFV, account_id: DHIRAJ, platforms: [YT] });
E.createItem(CM, { date: "2027-03-04", type_id: REEL, account_id: DHIRAJ, platforms: [IG], parent_id: P4.id });
refused(() => E.deleteItem(CM, P4.id), "CC-29", "deleting a video reels are cut from", ["Re-link"]);
const pick = E.pickableContent();
eq(pick.filter(p => p.value === X.id).map(p => p.group).sort(), [LI, YT].sort(), "the lead picker lists a two-platform item under both platforms");
ok(!pick.some(p => p.value === oct6.id), "…never an open slot without a topic");
ok(!pick.some(p => p.value === P2.id), "…never a cancelled item");
ok(pick.some(p => p.label.startsWith("Why your monthly close")), "…and still every v1 item");

/* ================================================================== */
section("§11  Changing a stage list mid-flight");
/* ================================================================== */
const jan19 = E.mapTopic(CM, slot("2027-01-19").id, { title: "Budget season lessons", theme: "Planning", keyword: "budgeting" });
const cur = E.stagesOf(LFV);
const withStoryboard = [...cur.slice(0, 2), { name: "Storyboard signed off", pct: 35, tat_days: 35, kind: "work" }, ...cur.slice(2)]
  .map(s => ({ id: s.id, name: s.name, pct: s.pct, tat_days: s.tat_days, kind: s.kind, owner_role_id: s.owner_role_id, parent_stage_id: s.parent_stage_id }));
const applied = E.saveStages(ADMIN, LFV, withStoryboard);
ok(applied.applied > 0, "a new stage is applied to items that have not started production");
eq(E.getItem(P.id).tasks.length, 6, "a published video keeps the six stages it was made with");
eq(E.getItem(X.id).tasks.length, 6, "a video in production keeps its copy");
eq(E.getItem(slot("2027-01-05").id).tasks.length, 7, "an untouched slot picks up the storyboard stage");
const j = E.getItem(jan19.id);
eq([j.tasks.length, j.tasks[0].done_at !== null, j.readiness], [7, true, 10], "a slot with only its topic done keeps the topic and gains the stage");
eq(E.stagesOf(REEL)[1].parent_stage_name, "Editing done", "the reel still waits on the same editing stage");

/* ================================================================== */
section("§12  v1 items meeting their first stage list");
/* ================================================================== */
const legacy = db.all("SELECT id, status FROM content WHERE type_id=? AND cancelled_at IS NULL", ct1);
const lg = E.saveStages(ADMIN, ct1, [st("Topic mapped", 10, 30, "topic"), st("Draft written", 60, 7), st("Published", 100, 0, "publish")]);
eq(lg.applied, legacy.length, "every live v1 long-form item receives the new stage list");
const pub = legacy.find(l => l.status === "Published");
eq([E.getItem(pub.id).readiness, E.getItem(pub.id).state], [100, "Published"], "a v1 item recorded as Published is 100% ready");
const planned = legacy.find(l => l.status === "Planned" || l.status === "Drafted");
if (planned) eq(E.getItem(planned.id).readiness, 10, "a v1 item still being planned keeps its topic and nothing more");
else ok(true, "no v1 long-form item is still being planned");

/* ================================================================== */
section("§12b  The calendar rules are configuration — CC-08");
/* ================================================================== */
refused(() => E.saveRules(CM, { content_due_soon_days: 5 }), "CC-40", "a Content Manager changing the calendar rules", ["content.setup.manage"]);
refused(() => E.saveRules(ADMIN, { content_timezone: "Mars/Olympus" }), "CC-08", "a time zone that does not exist", ["time zone"]);
refused(() => E.saveRules(ADMIN, { content_weekend_days: "0,1,2,3,4,5,6", content_topic_horizon_days: 0,
  content_metric_capture_days: "0,400", content_manager_role: 99999 }), "CC-08", "a form with four problems names all four",
  ["working day", "Topic look-ahead", "capture days", "role"]);
eq(id("SELECT value FROM settings WHERE key='content_topic_horizon_days'"), "60", "…and saves none of them");
eq(E.dueDate("2027-03-15", 30), "2027-02-12", "fixture: a Saturday deadline moves back to Friday with a Saturday–Sunday weekend");
E.saveRules(ADMIN, { content_weekend_days: "5,6" });
eq(E.dueDate("2027-03-15", 30), "2027-02-11", "with a Friday–Saturday weekend the same deadline moves back to Thursday");
E.saveRules(ADMIN, { content_weekend_days: "6,0" });
E.saveHoliday(ADMIN, { date: "2027-02-12", name: "Office closed" });
eq(E.dueDate("2027-03-15", 30), "2027-02-11", "a holiday added in Setup moves the deadline off it");
E.deleteHoliday(ADMIN, "2027-02-12");
eq(E.dueDate("2027-03-15", 30), "2027-02-12", "…and removing the holiday moves it back");
E.saveRules(ADMIN, { content_target_max_months: 3 });
refused(() => E.saveCadence(CM, cad({ account_id: DHIRAJ, start_period: "2027-01", end_period: "2027-06" })), "CC-10",
  "a target longer than the configured maximum", ["at most 3 months"]);
E.saveRules(ADMIN, { content_target_max_months: 24, content_reason_min: 30 });
refused(() => E.cancelItem(CM, slot("2027-01-05").id, { reason: "Twenty-odd characters" }), "CC-28",
  "a cancel reason shorter than the configured minimum", ["30 characters"]);
E.saveRules(ADMIN, { content_reason_min: 10 });
ok(E.taskList(CM, { asOf: "2026-12-12" }).some(t => t.kind === "metrics"), "fixture: the Content Manager owes a figure capture on 12 December");
E.saveRules(ADMIN, { content_manager_role: id("SELECT id FROM roles WHERE name='CRM Sales User'") });
ok(!E.taskList(CM, { asOf: "2026-12-12" }).some(t => t.kind === "metrics"), "the role that captures figures is a setting: moved to another role, it leaves the Content Manager's list");
ok(E.taskList(SALES, { asOf: "2026-12-12" }).some(t => t.kind === "metrics"), "…and arrives on that role's list");
E.saveRules(ADMIN, { content_manager_role: CMR, content_digest: false });
eq(E.dailyDigest("2026-12-31").skipped, true, "the daily digest can be switched off");
E.saveRules(ADMIN, { content_digest: true });
eq(E.rulesOf().find(r => r.key === "content_digest").value, "1", "…and on again");
A.saveSettings(ADMIN, { content_due_soon_days: "999" });
eq(id("SELECT value FROM settings WHERE key='content_due_soon_days'"), "7", "the PLM settings screen cannot write the calendar's rules");
ok(id("SELECT COUNT(*) FROM audit WHERE entity='setting' AND summary LIKE 'Content calendar rule%'") >= 8, "every rule change is audited");

/* ================================================================== */
section("§13  Audit and coverage");
/* ================================================================== */
for (const [entity, action] of [["content_cadence", "create"], ["content_cadence", "revise"], ["content_cadence", "end"],
  ["content", "reschedule"], ["content", "cancel"], ["content", "publish"], ["content_stage", "save"], ["content", "migrate"]])
  ok(id("SELECT COUNT(*) FROM audit WHERE entity=? AND action=?", entity, action) > 0, `every ${entity} ${action} is audited`);
const src = fs.readFileSync(new URL(import.meta.url), "utf8");
const uncovered = Object.keys(E.RULES).filter(k => !src.split("const uncovered")[0].includes(k));
eq(uncovered, [], "every rule in the catalogue is proved by at least one assertion in this file");
const engine = fs.readFileSync(new URL("./content.mjs", import.meta.url), "utf8");
ok(!/UPDATE\s+lead_stage_history|DELETE\s+FROM\s+lead_stage_history/i.test(engine), "the engine never writes to the append-only stage history");
ok(!/from\s+["'][^.][^"']*["']/.test(engine.split("\n").filter(l => l.startsWith("import")).join("\n")), "zero dependencies: only relative and node: imports");

/* ------------------------------------------------------------------ */
for (const f of [tmp, tmp + "-wal", tmp + "-shm"]) try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
console.log(`\n  ${pass} assertions, ${failures} failure${failures === 1 ? "" : "s"}.\n`);
process.exit(failures ? 1 : 0);
