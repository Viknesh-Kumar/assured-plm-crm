// Illustrative leads and content, carried from crm-prototype.html so the CRM can be shown before real
// data exists (§9.10). NOT part of the normal seed — run it deliberately with `npm run demo`.
// Reference data is real; the companies and people below are fictional.
import { db, all, one, run, col } from "./db.mjs";
import { seedCRMIfEmpty, PEOPLE } from "./crm-seed.mjs";
import { today, hashPassword } from "./lib.mjs";

seedCRMIfEmpty();

// The five people of §9.1. They are not seeded on a clean install — the Product Head creates users —
// so the demo creates them, then links the personal-branding channels and pipeline owners to them.
const pw = process.env.PLM_SEED_PASSWORD || "Assured@2026";
const roleId = n => col("SELECT id FROM roles WHERE name=?", n);
for (const [name, title, email, roleName] of PEOPLE) {
  if (!col("SELECT id FROM users WHERE email=?", email))
    run(`INSERT INTO users(name,email,title,password_hash,active,must_change,created_at)
         VALUES(?,?,?,?,1,1,datetime('now'))`, name, email, title, hashPassword(pw));
  run("INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)",
    col("SELECT id FROM users WHERE email=?", email), roleId(roleName));
}
for (const [name] of PEOPLE) {
  const uid = col("SELECT id FROM users WHERE name=?", name);
  run("UPDATE channel SET person_id=? WHERE name=? AND person_id IS NULL", uid, `Personal Branding — ${name}`);
}
for (const [code, , , owner] of [["LP",0,0,"Siddique"],["IBT",0,0,"Siddique"],["XLC",0,0,"Dhiraj"],
  ["XLR",0,0,"Vikram"],["PXP",0,0,"Vikram"],["CLX",0,0,"Dhiraj"],["RTX",0,0,"Darwin"],["ATX",0,0,"Darwin"],
  ["STX",0,0,"Darwin"],["XNP",0,0,"Darwin"],["QMX",0,0,"Darwin"],["FNX",0,0,"Darwin"]])
  run(`UPDATE pipeline SET owner_id=(SELECT id FROM users WHERE name=?)
       WHERE offering_id=(SELECT id FROM offering WHERE code=?) AND owner_id IS NULL`, owner, code);

const OFF = ["LP", "IBT", "XLC", "XLR", "PXP", "CLX", "RTX", "ATX", "STX", "XNP", "QMX", "FNX"];
const IND = ["Trading and distribution", "Manufacturing", "Large Corporates", "Project management",
  "UAE Real Estate", "Warehousing", "Labour supply", "All Companies"];
const SEG = ["Government Sectors", "Large Consulting Firms", "Project management companies",
  "Community customers", "Vice Presidents of Corporates", "Private Equity Firms",
  "Corporates (500+ employees)", "Mid size organization (50+ employees)",
  "Trading & Distribution / Manufacturing"];
const CHN = ["Tenders / Online", "Institutional relationships", "Existing Clients Referrals", "Research & walk-in",
  "Business Community", "Exhibitions & Expos", "Networking Events", "Referrals",
  "Personal Branding — Vikram", "Personal Branding — Darwin", "Personal Branding — Dhiraj",
  "Personal Branding — Siddique"];
const PPL = ["Vikram", "Darwin", "Siddique", "Dhiraj", "Shireen"];
const CTY = ["Long-form", "Short-form", "Video", "Podcast", "Testimonial", "Demo video", "Case story"];
const CCH = ["LinkedIn", "Instagram", "YouTube", "Podcast"];

const n = s => Number(String(s).replace(/^[a-z]+/i, "")) - 1;        // 'o7' → 6, 'ct1' → 0
const off = s => col("SELECT id FROM offering WHERE code=?", OFF[n(s)]);
const ind = s => col("SELECT id FROM industry WHERE name=?", IND[n(s)]);
const seg = s => col("SELECT id FROM customer_segment WHERE name=?", SEG[n(s)]);
const chn = s => col("SELECT id FROM channel WHERE name=?", CHN[n(s)]);
const per = s => col("SELECT id FROM users WHERE name=?", PPL[n(s)]);
const cty = s => col("SELECT id FROM content_type WHERE name=?", CTY[n(s)]);
const cch = s => col("SELECT id FROM content_channel WHERE name=?", CCH[n(s)]);

const CONTENT = [
  ["2026-08-03", "Why your monthly close is a report, not a control", "ct1", "cc1", "p3", "Financial control vs financial reporting", "Published", "o1", "i1"],
  ["2026-08-05", "3 numbers a distribution owner should see daily", "ct2", "cc1", "p3", "Operational control", "Published", "o1", "i1"],
  ["2026-08-06", "Project sales is a relationship ladder, not a funnel", "ct1", "cc1", "p1", "Hierarchical relationship development", "Published", "o4", "i4"],
  ["2026-08-07", "Win probability: the KPI nobody scores honestly", "ct2", "cc2", "p1", "Win probability, dynamic KPIs", "Published", "o4", "i4"],
  ["2026-08-10", "Cost overrun is a visibility problem", "ct3", "cc3", "p1", "Proactive cost control", "Published", "o5", "i4"],
  ["2026-08-11", "Podcast — Building an acquirable manufacturing business", "ct4", "cc4", "p3", "Making it an acquirable business", "Published", "o2", "i2"],
  ["2026-08-12", "The accountability layer most founders skip", "ct1", "cc1", "p3", "Accountable leadership layers", "Published", "o2", "i2"],
  ["2026-08-13", "Data-based decisions need one owned number", "ct2", "cc1", "p4", "Data based decision making", "Published", "o3", "i3"],
  ["2026-08-14", "Client story — 22% fewer trips, same volume", "ct5", "cc1", "p2", "Logistics cost optimization", "Published", "o7", "i6"],
  ["2026-08-17", "Cash flow visibility for developers", "ct1", "cc1", "p4", "Cash flow control, finance visibility", "Published", "o6", "i5"],
  ["2026-08-18", "RouteX demo — loading plan in 90 seconds", "ct6", "cc3", "p2", "Vehicle utilisation, faster TAT", "Published", "o7", "i6"],
  ["2026-08-19", "What a VP actually reports upward", "ct2", "cc2", "p4", "Complex problem solving", "Published", "o3", "i3"],
  ["2026-08-20", "Case story — project profitability recovered mid-run", "ct7", "cc1", "p1", "Project profitability", "Published", "o5", "i4"],
  ["2026-08-24", "Scaling without adding overhead", "ct1", "cc1", "p3", "Scaling, foundational data and processes", "Published", "o1", "i1"],
  ["2026-08-25", "Risk register or risk theatre?", "ct2", "cc1", "p1", "Project risk management", "Published", "o5", "i4"],
  ["2026-08-26", "Testimonial — Xelence engagement, 500+ employee group", "ct5", "cc1", "p4", "Efficiency, profitability", "Published", "o3", "i3"],
  ["2026-08-27", "Delegation is a measurement problem", "ct2", "cc2", "p4", "Delegation, performance management", "Scheduled", "o3", "i3"],
  ["2026-08-31", "Podcast — Sales performance you can actually measure", "ct4", "cc4", "p1", "Measuring sales performance", "Scheduled", "o4", "i4"],
  ["2026-09-02", "AI in projects: where it pays and where it does not", "ct1", "cc1", "p1", "AI integration in projects", "Planned", "o5", "i4"],
  ["2026-09-03", "Quality cost: the invisible 4%", "ct2", "cc1", "p2", "Quality control", "Planned", "o11", "i2"],
  ["2026-09-07", "Attendance fraud on labour-supply sites", "ct3", "cc2", "p2", "Geo-fenced attendance", "Planned", "o8", "i7"],
  ["2026-09-09", "Stock that never moves is a decision, not an accident", "ct1", "cc1", "p2", "Inventory control", "Planned", "o9", "i2"]
];

const LEADS = [
  { company: "Gulf Metals Trading LLC", customer: "Rashid Al Mansoori", designation: "Managing Director", location: "Dubai",
    contact: "+971 50 xxx 1180", email: "rashid@gulfmetals.ae", industry: "i1", segment: "s4", offering: "o1",
    channel: "c5", activity: "Dubai Business Council — Aug meet", owner: "p3", created: "2026-07-14", seq: 5 },
  { company: "Emirates Precision Industries", customer: "Sunil Nair", designation: "CEO", location: "Sharjah",
    contact: "+971 55 xxx 4402", email: "sunil@epi.ae", industry: "i2", segment: "s4", offering: "o2",
    channel: "c5", activity: "Community grilling session 12", owner: "p3", created: "2026-07-02", seq: 6 },
  { company: "Meridian Contracting", customer: "Fatima Haddad", designation: "Director — Projects", location: "Abu Dhabi",
    contact: "+971 52 xxx 7719", email: "f.haddad@meridian.ae", industry: "i4", segment: "s3", offering: "o4",
    channel: "c9", activity: "LinkedIn — win probability series", content: "Win probability",
    touches: ["Project sales is"], owner: "p1", created: "2026-08-06", seq: 3 },
  { company: "Northline Projects", customer: "Arun Menon", designation: "CFO", location: "Dubai",
    contact: "+971 50 xxx 2231", email: "arun@northline.ae", industry: "i4", segment: "s3", offering: "o5",
    channel: "c4", activity: "Walk-in — Business Bay", owner: "p1", created: "2026-06-22", seq: 4,
    lost: "Budget deferred to the next financial year; asked to be re-approached in Q1.", lostAt: "2026-08-20", lostBy: "p1" },
  { company: "Cavendish Real Estate Dev.", customer: "Omar Sheikh", designation: "Group CFO", location: "Dubai",
    contact: "+971 56 xxx 8890", email: "omar@cavendish.ae", industry: "i5", segment: "s7", offering: "o6",
    channel: "c11", activity: "LinkedIn — cash flow visibility", content: "Cash flow visibility",
    owner: "p4", created: "2026-08-17", seq: 2 },
  { company: "Al Fahad Logistics", customer: "Bilal Qureshi", designation: "Operations Head", location: "Jebel Ali",
    contact: "+971 54 xxx 3312", email: "bilal@alfahad.ae", industry: "i6", segment: "s9", offering: "o7",
    channel: "c10", activity: "LinkedIn — 22% fewer trips", content: "Client story — 22%",
    touches: ["RouteX demo"], owner: "p2", created: "2026-08-14", seq: 4 },
  { company: "Sterling Facilities Group", customer: "Nadia Rahman", designation: "VP Operations", location: "Dubai",
    contact: "+971 50 xxx 6654", email: "nadia@sterlingfg.ae", industry: "i3", segment: "s5", offering: "o3",
    channel: "c7", activity: "GCC Ops Leaders Forum — July", owner: "p4", created: "2026-07-09", seq: 5 },
  { company: "Hexafab Manufacturing", customer: "Kiran Deshpande", designation: "Plant Head", location: "Ajman",
    contact: "+971 55 xxx 1109", email: "kiran@hexafab.ae", industry: "i2", segment: "s4", offering: "o11",
    channel: "c5", activity: "Business Community — Ajman chapter", owner: "p2", created: "2026-08-04", seq: 3 },
  { company: "Vantage Interiors", industry: "i4", offering: "o8", created: "2026-08-26", seq: 2 },
  { company: "Zenith Steel Traders", customer: "Prakash Iyer", industry: "i1", segment: "s9", offering: "o9",
    channel: "c5", activity: "Business Community — Deira", owner: "p2", created: "2026-08-21", seq: 3 },
  { company: "Orbit Modular Systems", customer: "Hala Nasser", designation: "Head of Supply Chain",
    location: "Dubai Investment Park", contact: "+971 52 xxx 4470", email: "hala@orbitmod.ae", industry: "i2",
    segment: "s9", offering: "o10", channel: "c5", activity: "Business Community — DIP", owner: "p2",
    created: "2026-07-28", seq: 5 },
  { company: "Continental Labour Services", industry: "i7", offering: "o8", channel: "c4",
    activity: "Walk-in — Al Quoz", customer: "Imran Sethi", owner: "p2", created: "2026-08-18", seq: 2 },
  { company: "Pinnacle Advisory Partners", customer: "Sarah Whitfield", designation: "Partner", location: "DIFC",
    contact: "+971 50 xxx 9021", email: "s.whitfield@pinnacle.ae", industry: "i3", segment: "s6", offering: "o3",
    channel: "c11", activity: "LinkedIn — delegation series", content: "Delegation is a",
    owner: "p4", created: "2026-08-27", seq: 2 },
  { company: "Riyadh Growth Holdings", industry: "i3", offering: "o3", created: "2026-08-28", seq: 3 },
  { company: "Al Noor Distribution", customer: "Yousef Kamal", designation: "Owner", location: "Sharjah",
    contact: "+971 55 xxx 2278", email: "yousef@alnoordist.ae", industry: "i1", segment: "s4", offering: "o1",
    channel: "c12", activity: "LinkedIn — scaling without overhead", content: "Scaling without",
    owner: "p3", created: "2026-08-24", seq: 3 },
  { company: "Delta Fabrication WLL", customer: "Mohammed Basheer", designation: "General Manager",
    location: "Umm Al Quwain", contact: "+971 50 xxx 5540", email: "m.basheer@deltafab.ae", industry: "i2",
    segment: "s4", offering: "o2", channel: "c5", activity: "Business Community — UAQ", owner: "p3",
    created: "2026-05-19", seq: 6,
    lost: "Awarded to an incumbent advisor already embedded with the group finance team.", lostAt: "2026-08-11", lostBy: "p3" }
];

if (col("SELECT COUNT(*) FROM lead")) {
  console.log("\n  Demo data not loaded — the CRM already holds leads. Run `npm run reset` first if you want a clean load.\n");
  process.exit(0);
}

db.exec("BEGIN");
try {
  const shireen = per("p5");
  for (const [date, title, type, chan, person, theme, status, o, i] of CONTENT)
    run(`INSERT INTO content(date,title,type_id,channel_id,person_id,offering_id,industry_id,theme,status,url,created_at,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),?)`,
      date, title, cty(type), cch(chan), per(person), off(o), ind(i), theme, status,
      status === "Published" ? "https://example.invalid/post" : null, shireen);

  const contentId = prefix => col("SELECT id FROM content WHERE title LIKE ?", prefix + "%");

  for (const L of LEADS) {
    const pipe = L.offering && L.industry
      ? one(`SELECT p.* FROM pipeline p JOIN pipeline_industry pi ON pi.pipeline_id=p.id
             WHERE p.offering_id=? AND pi.industry_id=? AND p.active=1 LIMIT 1`, off(L.offering), ind(L.industry))
      : null;
    const stage = pipe ? one("SELECT * FROM pipeline_stage WHERE pipeline_id=? AND seq=?", pipe.id, L.seq || 1) : null;
    const source = L.channel ? col("SELECT mode FROM channel WHERE id=?", chn(L.channel)) : null;
    const owner = L.owner ? per(L.owner) : null;
    run(`INSERT INTO lead(company,pipeline_id,stage_id,stage_entered_at,owner_id,offering_id,industry_id,segment_id,
           channel_id,source,customer,designation,location,contact,email,activity,
           lost,lost_reason,lost_at,lost_stage_id,created_at,created_by,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      L.company, pipe?.id ?? null, stage?.id ?? null, L.created, owner,
      L.offering ? off(L.offering) : null, L.industry ? ind(L.industry) : null,
      L.segment ? seg(L.segment) : null, L.channel ? chn(L.channel) : null, source,
      L.customer ?? null, L.designation ?? null, L.location ?? null, L.contact ?? null, L.email ?? null,
      L.activity ?? null, L.lost ? 1 : 0, L.lost ?? null, L.lostAt ?? null, L.lost ? stage?.id ?? null : null,
      L.created, owner);
    const id = col("SELECT MAX(id) FROM lead");

    run(`INSERT INTO lead_stage_history(lead_id,from_seq,to_seq,stage_name_snapshot,actor_id,at,reason)
         VALUES(?,NULL,?,?,?,?, 'Opening balance at migration')`,
      id, stage?.seq ?? null, stage?.name ?? null, owner, L.created);
    if (L.lost)
      run(`INSERT INTO lead_stage_history(lead_id,from_seq,to_seq,stage_name_snapshot,actor_id,at,reason)
           VALUES(?,?,?,?,?,?,?)`, id, stage?.seq ?? null, stage?.seq ?? null, stage?.name ?? null,
        per(L.lostBy), L.lostAt, "Marked lost: " + L.lost);

    for (const t of [...(L.content ? [L.content] : []), ...(L.touches || [])]) {
      const cid = contentId(t);
      if (!cid) continue;
      run(`INSERT OR IGNORE INTO lead_content_touch(lead_id,content_id,is_primary,added_at,added_by)
           VALUES(?,?,?,?,?)`, id, cid, t === L.content ? 1 : 0, L.created, owner);
      if (t === L.content) run("UPDATE lead SET primary_content_id=? WHERE id=?", cid, id);
    }
  }
  db.exec("COMMIT");
} catch (e) { db.exec("ROLLBACK"); throw e; }

console.log(`\n  Demo data loaded: ${col("SELECT COUNT(*) FROM lead")} leads (` +
  `${col("SELECT COUNT(*) FROM lead WHERE lost=1")} lost), ${col("SELECT COUNT(*) FROM content")} content items, ` +
  `${col("SELECT COUNT(*) FROM lead_content_touch")} attribution touches.`);
console.log("  Companies and contacts are fictional; the reference data behind them is real.\n");
