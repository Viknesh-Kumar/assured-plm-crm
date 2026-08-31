// Emulates the deployed topology locally: static client from deploy/dist, /api/* rewritten to the
// backend, SPA fallback for everything else — exactly what vercel.json does in production.
// It exists so the split can be tested before anything is deployed.
//
//   node app/server.mjs                       # the backend (stands in for the Catalyst function)
//   node deploy/vercel-build.mjs              # build the client
//   node deploy/vercel-dev.mjs                # the edge, on :3000
//   PLM_URL=http://127.0.0.1:3000 npm run smoke
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "dist");
const PORT = Number(process.env.EDGE_PORT || 3000);
const API = (process.env.CATALYST_API_URL || "http://127.0.0.1:4173").replace(/\/$/, "");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin"
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // /api/* → the backend, preserving method, body, cookies and Set-Cookie.
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const upstream = await fetch(API + url.pathname + url.search, {
      method: req.method,
      headers: {
        ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] } : {}),
        ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {})
      },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      redirect: "manual"
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const headers = { ...SECURITY };
    for (const [k, v] of upstream.headers) if (!/^(content-encoding|transfer-encoding|content-length)$/i.test(k)) headers[k] = v;
    const setCookie = upstream.headers.getSetCookie?.() ?? [];
    res.writeHead(upstream.status, { ...headers, ...(setCookie.length ? { "Set-Cookie": setCookie } : {}) });
    return res.end(body);
  }

  // static, then SPA fallback
  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.join(DIST, rel);
  const serve = f => {
    const data = fs.readFileSync(f);
    res.writeHead(200, { ...SECURITY, "Content-Type": MIME[path.extname(f)] || "application/octet-stream",
      "Cache-Control": "no-cache", "Content-Length": data.length });
    res.end(data);
  };
  if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) return serve(file);
  const index = path.join(DIST, "index.html");
  if (fs.existsSync(index)) return serve(index);
  res.writeHead(404, SECURITY); res.end("not built — run node deploy/vercel-build.mjs");
}).listen(PORT, "127.0.0.1", () =>
  console.log(`\n  Edge emulator on http://127.0.0.1:${PORT}  ·  /api/* → ${API}\n`));
