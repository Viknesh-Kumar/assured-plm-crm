// Vercel build: copies the client into deploy/dist and points /api at the Catalyst backend.
//
// The client calls a same-origin /api/*, which vercel.json rewrites to the Catalyst function. That
// keeps the session cookie same-origin — no CORS, no cross-site cookie, no token in browser storage.
// Set CATALYST_API_URL in the Vercel project settings; the build fails loudly without it, because a
// silently mis-pointed frontend is worse than a failed deploy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const src = path.join(root, "app", "public");
const out = path.join(here, "dist");

const API = process.env.CATALYST_API_URL;
if (!API && process.env.VERCEL) {
  console.error("\n  CATALYST_API_URL is not set.\n" +
    "  Set it in the Vercel project's Environment Variables to the Catalyst function base URL,\n" +
    "  for example https://assured-plm-800000001.development.catalystserverless.com\n");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(out, f));

// Rewrite vercel.json's placeholder with the configured backend, so one config serves every environment.
if (API) {
  const cfgPath = path.join(root, "vercel.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.rewrites[0].destination = `${API.replace(/\/$/, "")}/api/:path*`;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`  /api/* → ${API}`);
}

// A build stamp the running app can show, so it is obvious which build is live.
fs.writeFileSync(path.join(out, "build.json"), JSON.stringify({
  built: new Date().toISOString(),
  commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
  api: API || "same-origin"
}, null, 2));

console.log(`  Copied ${fs.readdirSync(out).length} files into deploy/dist`);
