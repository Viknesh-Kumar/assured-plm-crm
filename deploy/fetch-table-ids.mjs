// Merges live table ids into deploy/.catalyst-ids.json, preserving Catalyst's 17-digit ids as strings.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(here, ".catalyst-ids.json");
const ids = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
const res = await fetch(`https://api.catalyst.zoho.com/baas/v1/project/${process.env.CATALYST_PROJECT_ID}/table`, {
  headers: { Authorization: `Zoho-oauthtoken ${process.env.CATALYST_OAUTH_TOKEN}`,
    "Catalyst-org": process.env.CATALYST_ORG_ID, Environment: process.env.CATALYST_ENV || "Development" }
});
const text = await res.text();
const data = JSON.parse(text.replace(/:\s*(\d{16,})(?=\s*[,}\]])/g, ': "$1"'));
for (const t of data.data || []) ids[t.table_name] = { ...(ids[t.table_name] || {}), table_id: String(t.table_id) };
fs.writeFileSync(p, JSON.stringify(ids, null, 2));
console.log(`  merged ${(data.data || []).length} table ids`);
