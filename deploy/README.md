# Deployment — Zoho Catalyst backend, Vercel frontend

The target topology, and how far each piece has got.

```
  browser ──► Vercel (static client)  ──rewrite /api/*──►  Catalyst Function  ──►  Catalyst Data Store
              app/public, built to                          plm_api                  39 tables
              deploy/dist                                   (Advanced I/O)
```

The `/api/*` rewrite matters: the browser only ever talks to one origin, so the session cookie stays
`SameSite=Strict`, there is no CORS, and no token is parked in browser storage. `vercel.json` holds the
rewrite; `deploy/vercel-build.mjs` points it at whatever `CATALYST_API_URL` you configure.

## Live project

**Assured-CRM** · project `94960000000014048` · org `937179130` · Development · DC `.com`
API base `https://assured-crm-937179130.development.catalystserverless.com`

**All 39 tables are provisioned.** Columns are in for `roles`, `users` and `user_roles` (33 columns,
2 foreign keys, verified with live inserts and joins); the other 36 tables are empty shells awaiting
their 279 columns. What the Data Store will and will not do is recorded in
**[ZCQL-FINDINGS.md](ZCQL-FINDINGS.md)** — measured, not assumed.

The provisioning token needs **column** scope as well as table scope. A token carrying only
`ZohoCatalyst.tables.READ` and `ZohoCatalyst.tables.CREATE` creates every table and then fails with
`OAUTH_SCOPE_MISMATCH` on the first column call. Use `ZohoCatalyst.tables.ALL`.

## Status

| Piece | State |
|---|---|
| Vercel build and rewrite config | **Done and tested** — `npm run build`, verified end to end |
| Catalyst Data Store schema | **Done** — 39 tables, 312 columns, 86 foreign keys, generated from the live schema |
| Catalyst provisioner | **Run against the live project** — 39/39 tables created; columns need a wider token scope |
| Catalyst function wrapper | **Written** — mounts the same router, answers `/api/health` |
| Catalyst data-access adapter | **Not built** — but now designed against measured behaviour, not guesswork |
| Catalyst code deploy | **Blocked** — the MCP connection cannot upload function code |

## Tested before deployment

`deploy/vercel-dev.mjs` is a local stand-in for the Vercel edge: it serves the built client and
rewrites `/api/*` to the backend, exactly as `vercel.json` does. The full functional suite passes
through it, so the split-origin topology is proven before anything is deployed.

```bash
npm start                                   # backend on :4173
npm run build && npm run edge               # client + edge on :3000
PLM_URL=http://127.0.0.1:3000 npm run smoke # 52 checks through the deployed shape
```

## Vercel

1. Import the repository into Vercel. No install step, no dependencies, no framework preset.
2. Set **`CATALYST_API_URL`** in Environment Variables to the Catalyst function base URL, e.g.
   `https://assured-plm-800000001.development.catalystserverless.com`. The build fails loudly without
   it — a frontend pointed at nothing is worse than a failed deploy.
3. Deploy. `vercel.json` handles the rewrite, the SPA fallback and the security headers.

Everything under `app/*.mjs` stays out of the Vercel bundle; only `app/public` is published.

## Catalyst

The project exists and the schema design is proven against it. Finishing the database is one command:

```bash
npm run catalyst:schema        # review the 39-table plan
npm run catalyst:schema:json   # regenerate deploy/catalyst-schema.json from the live schema
npm run catalyst:plan          # dry run, no credentials needed

CATALYST_PROJECT_ID=94960000000014048 \
CATALYST_ORG_ID=937179130 \
CATALYST_OAUTH_TOKEN=... \
  npm run catalyst:provision
```

The token is a Zoho self-client grant from the [API console](https://api-console.zoho.com). Scope
must include column administration, not just tables:

```
ZohoCatalyst.projects.READ,ZohoCatalyst.tables.ALL
```

`ZohoCatalyst.tables.CREATE` alone creates all 39 tables and then fails `OAUTH_SCOPE_MISMATCH` on the
first column — which is exactly what happened on the first run, so the tables exist and the columns do
not. Re-running with the wider scope fills them in; the script skips what is already there.

The provisioner is idempotent: re-running it after a schema change adds only what is missing.

Two things the schema generator does deliberately, because Catalyst's model differs from SQLite's:

- **Catalyst's primary key is always `ROWID`.** Our integer primary keys are kept as ordinary `int`
  columns marked mandatory and unique, and every foreign key points at the parent's `id` — not at
  `ROWID` — so seeded and exported data stays portable between the two stores.
- **Composite primary keys become application-enforced pairs.** `user_roles`, `stage_participant`,
  `pipeline_industry`, `lead_content_touch`, `lead_field_value` and `stage_requirement` have no single
  key column; the engine already writes them with `INSERT OR IGNORE` semantics, which the adapter must
  preserve.

Then the function:

```bash
cd deploy/catalyst && catalyst deploy --only functions
```

## What is left

**1. Code deploy is blocked at the connection, not at the code.** The Catalyst MCP tools cover
Datastore, ZCQL, API Gateway, function *execution* and function env vars — but there is no create-function
and no upload-code tool, and none for AppSail or Web Client Hosting either. Pushing the function needs
the CLI from a machine with a logged-in session:

```bash
npm i -g zcatalyst-cli
catalyst login                       # opens a browser — cannot run in this session
cd deploy/catalyst && catalyst deploy
```

**2. The data-access adapter.** 344 SQL statements, 26 of them correlated subqueries that ZCQL rejects
outright. This is real work, but it is no longer guesswork: [ZCQL-FINDINGS.md](ZCQL-FINDINGS.md)
settles every question that shaped it. Joins survive, so the read model stays close to what it is now;
the derived figures move into a JavaScript pass; a thin layer flattens and coerces what comes back.

The probing already paid for itself once: two `LIKE` queries in the engine would have returned empty
on Catalyst without erroring, so the CEO would never have been notified of a kill and nobody would have
been notified of a product reaching Seeding. Both are fixed, on both stores.

**What would help:** a Catalyst token scoped `ZohoCatalyst.tables.ALL`, so the provisioner fills in the
279 remaining columns in one command; and either a Vercel token or one `vercel` run from your machine.
The adapter I can build and validate against the live project with the suites that already cover the
engine — 92 PLM assertions, 258 CRM assertions and 57 functional checks.

## Local development is unaffected

SQLite remains the local store. `npm start` needs nothing but Node ≥ 22.5.
