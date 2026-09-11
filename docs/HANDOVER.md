# Handover — Assured PLM & CRM

For the next AI coding agent, or the next engineer. Read this before touching anything.
Current as of **11 September 2026**.

---

## 1. What this is

Two applications over one database and one sign-in:

- **PLM** — a product register with eight approval gates and six market states (BRD `AGC-BRD-PLM-001`).
- **CRM & Content** — leads on configurable pipelines, plus a content calendar (BRD `AGC-BRD-CRM-001`).

Deployed on Railway: one container, SQLite on a persistent volume mounted at `/data`. The project,
service and URL are in the Railway dashboard — they are deliberately not written down here.

## 2. The one rule that governs the codebase

**Zero runtime dependencies.** `node:sqlite`, `node:http`, `node:crypto` and nothing else. The browser
gets vanilla ES modules with no build step. Do not add a dependency, a bundler, a framework or a
transpiler. If something needs more than a few lines, write the few lines.

Node 24 or later is required — `node:sqlite` is only unflagged from 23.4. It is pinned in
`package.json` (`engines`), `.node-version` and `nixpacks.toml`; change all three together or none.

## 3. Layout

```
app/
  db.mjs         schema + migrations + query helpers (all, one, run, col, tx, audit, notify)
  seed.mjs       PLM reference data: PERMISSIONS, ROLES, the 14-stage model, settings
  crm-seed.mjs   CRM reference data: CRM_PERMISSIONS, fields, templates, pipelines, migrateCRM()
  api.mjs        every PLM rule. loadUser, products, gates, market, effort, users, roles, reports
  crm.mjs        every CRM rule. leads, the gate engine, content, targets, reports, setup
  lib.mjs        dates, working days, scrypt, HMAC session cookie, CSV
  server.mjs     node:http, the route table, static files. Exports handle(req,res)
  public/        app.js (shell + primitives), views.js (PLM), crm.js, calendar.js, setup.js, crm-setup.js
  test.mjs       PLM unit suite      (npm run test:plm)   92 assertions
  crm-test.mjs   CRM unit suite      (npm run test:crm)  350 assertions
  smoke.mjs      HTTP functional     (npm run smoke)      79 checks, re-runnable against any deployment
  plm-demo.mjs / crm-demo.mjs   illustrative data (npm run demo)
```

`npm test` runs both unit suites. `npm run validate` checks the stage model against the
"Responsibility - Stage wise" sheet.

## 4. How to work on it

```bash
npm start                 # http://127.0.0.1:4173
npm run reset             # delete the local database
npm run demo              # 15 products, 16 leads, 22 content items, 4 targets
npm test                  # both unit suites
npm run smoke             # needs a server running; PLM_URL points it anywhere
PLM_URL=https://<your-deployment> npm run smoke
```

**The rules live on the server.** The browser may *display* a refusal; it must never *decide* one.
Every rule belongs in `api.mjs` or `crm.mjs` with a business-rule code on the error, and every rule
is proved in the suites by what it refuses, not by what it allows. If you add a rule, add a `refused(...)`
assertion for it. That is the house style and the suites are the specification.

## 5. Data model — the parts that catch people out

- **`CREATE TABLE IF NOT EXISTS` never adds a column to an existing table.** Every column added after the
  first release is also declared through `addColumn()` in `db.mjs`. Add both, always.
- **Reference-data changes need a migration too.** `seedCRMIfEmpty()` no-ops once offerings exist, so
  changes to the field catalogue or the default requirements go in `migrateCRM()`, guarded by the
  `crm_schema_rev` setting. Bump `REV` when you change it.
- `node:sqlite` rejects `undefined` and booleans. `db.mjs` normalises both in `norm()`; use the helpers.
- **Two lead columns are named differently from their field key**: field `value` → column `est_annual_value`.
  `SETTABLE`, `CORE_KEYS` and `valueOf()` in `crm.mjs` all have to agree.
- `lead_stage_history` is append-only. There is no UPDATE or DELETE path and a test asserts the source
  contains none. Keep it that way.

## 6. The two engines

**PLM gates.** Eight development stages, each with an owner role, an approver role, participants and written
exit criteria. The owner submits; the approver decides; participants are only notified. Whoever marked the
last criterion met may not approve (BR-09). Market entry needs gate 8 approved **and** a deployment,
whichever lands last. Approval authority comes from the stage model, never from a permission.

**CRM requirements.** A lead needs a company name and nothing else. Everything after that is the
requirement matrix: per pipeline stage, per field, level **1** (always required) or **2** (required only when
the effective Lead Source is Online). `requirementsUpTo()` is cumulative, so a field required at stage 3 is
still enforced at stage 7. `missingFor()` returns *every* unmet field, not the first.

Shipped defaults (`seedDefaultRequirements`):

| Where | What |
|---|---|
| stage 2 | Estimated Annual Order Value, level 1 |
| the qualification gate ◆ | contact details, segment, channel, source — level 1; **Activity Name level 2** |
| first CSE-band stage | Location, level 1 |
| first Closed-band stage | Odoo Invoice Number, level 1 |

**Activity Name is a content picker.** Choosing an item writes three things at once: `lead.activity`
(the title, snapshotted), `lead.primary_content_id`, and a primary row in `lead_content_touch`. The old
separate "Attributed Content" field is retired (`active = 0`) and its values are kept. Renaming a content
item re-snapshots the title onto every lead that points at it.

## 7. Access model

`user_roles` (roles held) **∪** `user_permission` (granted to this person alone) = effective permissions.
Anything a role already grants is not stored a second time, so removing the role really does remove the access.

`PERMISSIONS` in `seed.mjs` is `[key, label, module, group]` — the module and group only exist so the
access editor can show two clearly separate columns. `usersWithPermission()` reads both sources; use it
rather than querying roles directly.

`assertAdminRemains()` runs inside the transaction on every write to users and roles. It is the only thing
standing between an administrator and a permanent lockout. Do not route a new write around it.

## 8. UI conventions

- `openForm({fields})` builds every dialog. Field types: `text`, `number`, `date`, `select`, `textarea`,
  `checkbox`, `checkboxes`, `html`, and **`picker`** (group dropdown + substring filter + list; used for
  Activity Name and Attach content). A repeated checkbox `name` anywhere in the form is collected as an array.
- A form that has been typed into asks before it is discarded.
- `render()` routes on `location.hash.split("?")[0]`; views read their own query string. A view that throws
  paints an error card rather than leaving the previous screen up.
- After a mutation, call `after()` (CRM) or `rerender()` (PLM) — both preserve the scroll position.
- Refusals are shown where the user is: in the dialog they were filling, or in a panel offering the fix.
- Every action the server will refuse should be absent or disabled, with the reason visible rather than
  hidden in a `title`.

## 9. Where the work is currently parked

- **Zoho Catalyst.** All 39 tables exist; columns are complete on 11 of them. The token scope was missing
  `ZohoCatalyst.tables.UPDATE`, and Catalyst cannot take a code deploy through MCP. `deploy/catalyst-provision.mjs`
  is idempotent and finishes the rest in one run when a correctly-scoped token appears.
  `deploy/ZCQL-FINDINGS.md` records every measured behaviour — read it before resuming that port.
  Regenerate `deploy/catalyst-schema.json` with `npm run catalyst:schema:json` after any schema change.
- **Vercel.** `vercel.json` and `deploy/` are committed but unused; the user chose to host everything on
  Railway, where the persistent volume makes SQLite work unchanged.
- **A deliberate non-fix.** An audit suggested listing level-2 fields as missing while the channel is unset,
  to save the user a second round at the gate. Rejected: it would ask for the Activity Name on a lead that
  may turn out to be Offline, which is the opposite of the rule the business asked for.

## 10. Repository and deployment

Code only. The BRDs, the tracker workbook, the prototypes and the logo assets are deliberately
gitignored — do not commit them, and do not commit anything that identifies a live deployment.

Railway deploys on push to `main` and runs `node app/server.mjs`. `PLM_DB` must point at a path on the
persistent volume; deleting that volume destroys the data and needs the user's explicit instruction.
`/api/health` is unauthenticated and reports only product and user counts.

**Never write a credential, a deployment URL or a token into this repository.** The bootstrap account's
email and password come from `PLM_ADMIN_EMAIL` and `PLM_SEED_PASSWORD`; set both in the environment on
any real deployment rather than relying on the defaults in `seed.mjs`, which are public knowledge.
Two Zoho OAuth tokens were pasted into an earlier chat transcript and should be treated as compromised.
