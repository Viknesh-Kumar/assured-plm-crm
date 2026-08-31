// Zero-dependency HTTP server: node:http + node:sqlite. Start with `npm start` or `node app/server.mjs`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { one, run, col, secret, audit, DB_PATH } from "./db.mjs";
import { seedIfEmpty } from "./seed.mjs";
import { seedCRMIfEmpty } from "./crm-seed.mjs";
import { signSession, readSession, verifyPassword } from "./lib.mjs";
import * as A from "./api.mjs";
import * as C from "./crm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 4173);
// A platform that provides PORT also expects the process to listen on every interface. Locally we
// stay on loopback (NFR-12); on Railway, RAILWAY_ENVIRONMENT_NAME is always present.
const ON_PLATFORM = !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID);
const HOST = process.env.HOST || (ON_PLATFORM ? "0.0.0.0" : "127.0.0.1");
const COOKIE = "plm_session";
const SESSION_HOURS = 12;

seedIfEmpty();
seedCRMIfEmpty();
const SECRET = secret();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2" };

const send = (res, status, body, headers = {}) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
  res.writeHead(status, { "Content-Length": buf.length, "X-Content-Type-Options": "nosniff", ...headers });
  res.end(buf);
};
const json = (res, status, obj, headers) =>
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", ...headers });

const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on("data", c => { n += c.length; if (n > 1e6) { reject(new A.HttpError(413, "Request too large.")); req.destroy(); } chunks.push(c); });
  req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new A.HttpError(400, "Malformed JSON body.")); } });
  req.on("error", reject);
});

const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";")
  .map(s => s.trim().split("=")).filter(a => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));

function currentUser(req) {
  const s = readSession(cookies(req)[COOKIE], SECRET);
  return s ? A.loadUser(s.uid) : null;
}
const setSession = (res, uid) => {
  const token = signSession({ uid, exp: Date.now() + SESSION_HOURS * 3600e3 }, SECRET);
  res.setHeader("Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
};

/* ------------------------------- routes ------------------------------ */
// [method, pattern, handler(ctx), needsAuth]
const routes = [
  ["POST", "/api/login", async ({ body, res }) => {
    const email = String(body.email || "").trim().toLowerCase();
    const u = one("SELECT * FROM users WHERE lower(email)=?", email);
    if (!u || !u.active || !verifyPassword(String(body.password || ""), u.password_hash)) {
      audit("auth", u?.id ?? null, "login-failed", `Failed sign-in for ${email}`, null);
      throw new A.HttpError(401, "Email or password not recognised.");
    }
    run("UPDATE users SET last_login=datetime('now') WHERE id=?", u.id);
    audit("auth", u.id, "login", `${u.name} signed in`, u.id);
    setSession(res, u.id);
    return { ok: true, must_change: !!u.must_change };
  }, false],

  ["GET", "/api/health", async () => ({
    ok: true,
    service: "assured-plm",
    products: col("SELECT COUNT(*) FROM products"),
    users: col("SELECT COUNT(*) FROM users"),
    time: new Date().toISOString()
  }), false],

  ["POST", "/api/logout", async ({ res }) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  }, false],

  ["GET",  "/api/bootstrap",              ({ user })            => A.bootstrap(user)],
  ["POST", "/api/password",               ({ user, body })      => A.changeOwnPassword(user, body)],

  ["GET",  "/api/products",               ()                    => A.listProducts()],
  ["POST", "/api/products",               ({ user, body })      => A.createProduct(user, body)],
  ["GET",  "/api/products/:id",           ({ user, id })        => ({ ...A.productRelated(user, id), gate: A.productGate(user, id) })],
  ["PATCH", "/api/products/:id",          ({ user, id, body })  => A.updateProduct(user, id, body)],
  ["POST", "/api/products/:id/criterion", ({ user, id, body })  => A.markCriterion(user, id, body)],
  ["POST", "/api/products/:id/submit",    ({ user, id })        => A.submitGate(user, id)],
  ["POST", "/api/products/:id/decide",    ({ user, id, body })  => A.decideGate(user, id, body)],
  ["POST", "/api/products/:id/effort",    ({ user, id, body })  => A.logEffort(user, id, body)],
  ["DELETE", "/api/products/:id/effort/:sub", ({ user, id, sub }) => A.deleteEffort(user, id, sub)],
  ["POST", "/api/products/:id/deployment", ({ user, id, body }) => A.recordDeployment(user, id, body)],
  ["POST", "/api/products/:id/deployment/:sub/confirm", ({ user, id, sub }) => A.confirmRevenue(user, id, sub)],
  ["POST", "/api/products/:id/revise",    ({ user, id, body })  => A.reviseDate(user, id, body)],
  ["POST", "/api/products/:id/market",    ({ user, id, body })  => A.changeMarketState(user, id, body)],
  ["POST", "/api/products/:id/park",      ({ user, id, body })  => A.park(user, id, body)],
  ["POST", "/api/products/:id/resume",    ({ user, id })        => A.resume(user, id)],
  ["POST", "/api/products/:id/kill",      ({ user, id, body })  => A.recommendKill(user, id, body)],
  ["POST", "/api/products/:id/kill/decide", ({ user, id, body }) => A.decideKill(user, id, body)],
  ["POST", "/api/products/:id/owner",     ({ user, id, body })  => A.changeOwner(user, id, body)],
  ["POST", "/api/products/:id/entry",     ({ user, id, body })  => A.overrideEntry(user, id, body)],

  ["GET",  "/api/dashboard",              ({ user })            => A.dashboard(user)],
  ["GET",  "/api/candidates",             ()                    => A.marketCandidates()],
  ["POST", "/api/notifications/read",     ({ user })            => A.markNotificationsRead(user)],

  ["GET",  "/api/reports",                ()                    => Object.entries(A.REPORTS).map(([k, r]) => ({ key: k, title: r.title, note: r.note }))],
  ["GET",  "/api/reports/:key",           ({ params, url, res }) => {
    if (url.searchParams.get("format") === "csv") {
      const csv = A.reportCSV(params.key);
      send(res, 200, "﻿" + csv, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${params.key}-${new Date().toISOString().slice(0, 10)}.csv"`
      });
      return undefined;
    }
    return A.report(params.key);
  }],

  ["GET",  "/api/users",                  ({ user })            => A.listUsers(user)],
  ["POST", "/api/users",                  ({ user, body })      => A.saveUser(user, null, body)],
  ["PATCH", "/api/users/:id",             ({ user, id, body })  => A.saveUser(user, id, body)],
  ["POST", "/api/users/:id/password",     ({ user, id, body })  => A.resetPassword(user, id, body)],
  ["POST", "/api/roles",                  ({ user, body })      => A.saveRole(user, null, body)],
  ["PATCH", "/api/roles/:id",             ({ user, id, body })  => A.saveRole(user, id, body)],
  ["DELETE", "/api/roles/:id",            ({ user, id })        => A.deleteRole(user, id)],
  ["PATCH", "/api/stages/:id",            ({ user, id, body })  => A.saveStage(user, id, body)],
  ["POST", "/api/criteria",               ({ user, body })      => A.saveCriterion(user, body)],
  ["PATCH", "/api/criteria/:id",          ({ user, id, body })  => A.saveCriterion(user, { ...body, id })],
  ["POST", "/api/settings",               ({ user, body })      => A.saveSettings(user, body)],
  ["GET",  "/api/audit",                  ({ user, url })       => A.auditLog(user, { entity: url.searchParams.get("entity") })],

  /* ------------------------------- CRM ------------------------------- */
  ["GET",  "/api/crm/bootstrap",          ({ user })            => C.crmBootstrap(user)],
  ["GET",  "/api/crm/dashboard",          ({ user })            => C.crmDashboard(user)],

  ["GET",  "/api/crm/leads",              ()                    => C.listLeads()],
  ["POST", "/api/crm/leads",              ({ user, body })      => C.createLead(user, body)],
  ["GET",  "/api/crm/leads/:id",          ({ user, id })        => C.leadDetail(user, id)],
  ["PATCH", "/api/crm/leads/:id",         ({ user, id, body })  => C.updateLead(user, id, body)],
  ["POST", "/api/crm/leads/:id/move",     ({ user, id, body })  => C.attemptMove(user, id, body)],
  ["POST", "/api/crm/leads/:id/lost",     ({ user, id, body })  => C.markLost(user, id, body)],
  ["POST", "/api/crm/leads/:id/reopen",   ({ user, id, body })  => C.reopenLead(user, id, body)],
  ["POST", "/api/crm/leads/:id/source",   ({ user, id, body })  => C.overrideSource(user, id, body)],
  ["POST", "/api/crm/leads/:id/note",     ({ user, id, body })  => C.addNote(user, id, body)],
  ["POST", "/api/crm/leads/:id/attach",   ({ user, id, body })  => C.attachContent(user, id, body)],
  ["DELETE", "/api/crm/leads/:id/attach/:sub", ({ user, id, sub }) => C.detachContent(user, id, sub)],

  ["GET",  "/api/crm/content",            ({ url })             => {
    const y = Number(url.searchParams.get("y")), m = Number(url.searchParams.get("m"));
    return y && m ? C.contentForMonth(y, m) : C.listContent();
  }],
  ["POST", "/api/crm/content",            ({ user, body })      => C.saveContent(user, null, body)],
  ["GET",  "/api/crm/content/:id",        ({ user, id })        => C.contentDetail(user, id)],
  ["PATCH", "/api/crm/content/:id",       ({ user, id, body })  => C.saveContent(user, id, body)],
  ["DELETE", "/api/crm/content/:id",      ({ user, id })        => C.deleteContent(user, id)],

  ["GET",  "/api/crm/prompts",            ({ url })             => C.listPrompts(url.searchParams.get("status") || null)],
  ["POST", "/api/crm/prompts/:id/dismiss", ({ user, id, body }) => C.dismissPrompt(user, id, body)],

  ["GET",  "/api/crm/reports",            ()                    => Object.entries(C.CRM_REPORTS).map(([k, r]) => ({ key: k, title: r.title, note: r.note }))],
  ["GET",  "/api/crm/reports/:key",       ({ params, url, res }) => {
    if (url.searchParams.get("format") === "csv") {
      send(res, 200, "﻿" + C.crmReportCSV(params.key), {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${params.key}-${new Date().toISOString().slice(0, 10)}.csv"`
      });
      return undefined;
    }
    return C.crmReport(params.key);
  }],

  ["GET",  "/api/crm/pipelines",          ()                    => C.listPipelines()],
  ["POST", "/api/crm/pipelines",          ({ user, body })      => C.savePipeline(user, null, body)],
  ["PATCH", "/api/crm/pipelines/:id",     ({ user, id, body })  => C.savePipeline(user, id, body)],
  ["POST", "/api/crm/pipelines/:id/stages", ({ user, id, body }) => C.saveStages(user, id, body)],
  ["GET",  "/api/crm/pipelines/:id/matrix", ({ user, id })      => C.requirementMatrix(user, id)],
  ["POST", "/api/crm/pipelines/:id/copy-matrix", ({ user, id }) => C.copyMatrix(user, id)],
  ["POST", "/api/crm/requirement",        ({ user, body })      => C.setRequirement(user, body)],
  ["POST", "/api/crm/fields",             ({ user, body })      => C.saveField(user, body)],
  ["DELETE", "/api/crm/fields/:id",       ({ user, id })        => C.deleteField(user, id)],
  ["GET",  "/api/crm/reference",          ()                    => C.referenceLists()],
  ["POST", "/api/crm/reference/:key",     ({ user, params, body }) => C.saveReference(user, params.key, body)],
  ["DELETE", "/api/crm/reference/:key/:id", ({ user, params, id }) => C.deleteReference(user, params.key, id)],
  ["POST", "/api/crm/movement",           ({ user, body })      => C.saveMovementRules(user, body)]
];

const compiled = routes.map(([method, pattern, handler, auth = true]) => {
  const keys = [];
  const rx = new RegExp("^" + pattern.replace(/:([a-z]+)/gi, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  return { method, rx, keys, handler, auth };
});

/* ------------------------------- static ------------------------------ */
function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) {                                             // SPA fallback
      return fs.readFile(path.join(PUBLIC, "index.html"), (e2, html) =>
        e2 ? send(res, 404, "Not found") : send(res, 200, html, { "Content-Type": MIME[".html"] }));
    }
    send(res, 200, data, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache" });
  });
}

/* ------------------------------- server ------------------------------ */
/** The whole HTTP surface, as a plain (req, res) handler so any host can serve it. */
export async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);

  try {
    const route = compiled.find(r => r.method === req.method && r.rx.test(pathname));
    if (!route) throw new A.HttpError(404, "No such endpoint.");
    const user = currentUser(req);
    if (route.auth !== false && !user) throw new A.HttpError(401, "Not signed in.");

    const m = pathname.match(route.rx);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
    const body = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? await readBody(req) : {};
    const out = await route.handler({
      req, res, user, body, url, params,
      id: params.id ? Number(params.id) : undefined,
      sub: params.sub ? Number(params.sub) : undefined
    });
    if (out !== undefined) json(res, 200, out);
  } catch (e) {
    if (e instanceof A.HttpError)
      return json(res, e.status, { error: e.message, rule: e.rule || null, ...(e.missing ? { missing: e.missing } : {}) });
    console.error(e);
    json(res, 500, { error: "Server error: " + e.message });
  }
}

/** Started directly (`node app/server.mjs`); a host that imports this module serves `handle` itself. */
const startedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (startedDirectly || process.env.PLM_LISTEN === "1") {
  http.createServer(handle).listen(PORT, HOST, () => {
    console.log(`\n  Assured PLM — http://${HOST}:${PORT}` +
    (ON_PLATFORM ? `  ·  ${process.env.RAILWAY_ENVIRONMENT_NAME || "platform"}  ·  db ${DB_PATH}` : "") + "\n");
  });
}

export { PORT, HOST };
