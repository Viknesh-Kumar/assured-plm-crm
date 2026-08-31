/**
 * Catalyst Advanced I/O function — the whole API surface of the Assured app.
 *
 * It mounts the same router the local server uses, so there is one implementation of every business
 * rule and no chance of the two drifting. Catalyst hands an Advanced I/O function a Node request and
 * response, which is exactly what `handle(req, res)` expects.
 *
 * STATUS: the router is portable, the data layer is not yet. `app/db.mjs` opens SQLite, and a Catalyst
 * function has no persistent filesystem, so this function needs `PLM_STORE=catalyst` to be implemented
 * before it will serve real traffic. Until then it answers /api/health and refuses everything else
 * rather than pretending to work. See deploy/README.md.
 */
const path = require("path");

let handlePromise = null;
const router = () => (handlePromise ||= import(
  path.join(__dirname, "app", "server.mjs")
).then(m => m.handle));

const STORE = process.env.PLM_STORE || "sqlite";

module.exports = async (req, res) => {
  // Health check works regardless of the store, so the deployment itself can be verified.
  if (req.url === "/api/health" || req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    return res.end(JSON.stringify({
      ok: true,
      service: "assured-plm-api",
      store: STORE,
      env: process.env.CATALYST_ENVIRONMENT || null,
      time: new Date().toISOString()
    }));
  }

  if (STORE !== "catalyst") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(503);
    return res.end(JSON.stringify({
      error: "The Catalyst data store adapter is not wired up yet, so this function is not serving the API. "
        + "Set PLM_STORE=catalyst once app/store-catalyst.mjs is implemented.",
      store: STORE
    }));
  }

  try {
    const handle = await router();
    return handle(req, res);
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Server error: " + e.message }));
  }
};
