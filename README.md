# Assured — Product Lifecycle & CRM

One application, two modules, one user directory.

| Module | Built to | What it does |
|---|---|---|
| **Product Lifecycle** | BRD **AGC-BRD-PLM-001** v1.0 + `plm-prototype.html` | Internal products from first idea to formal withdrawal, across eight approval gates and six market states |
| **CRM & Content Calendar** | BRD **AGC-BRD-CRM-001** v1.0 + `Assured CRM/crm-prototype.html` | Leads against configurable sales processes, the content calendar, and the attribution between them |

They share sign-in, the user directory, roles and permissions, the audit trail and notifications.
Switch between them from the app name in the navigation bar, or the app launcher in the header.

```bash
npm start        # http://127.0.0.1:4173
npm test         # 92 PLM assertions + 258 CRM assertions
npm run smoke    # 57 functional checks over real HTTP, against a running server
npm run validate # check the stage model against the tracker workbook
npm run demo     # optional illustrative data — never part of the seed
npm run reset    # delete the database; the next start re-seeds
```

Zero dependencies: Node's built-in `node:sqlite`, `node:http` and `node:crypto`. No `npm install`,
no build step. Requires Node 22.5+ (tested on 24.16).

## A clean install carries no sample data

First run creates `plm.db` and seeds **configuration only** — the 14-stage model with its exit
criteria, the nine roles, the CRM's reference lists and stage templates, and the settings each open
item touches. There are **no products, no leads, no content and no people**, and exactly one account:

| | |
|---|---|
| **producthead@assured.local** | password `Assured@2026` (override with `PLM_SEED_PASSWORD`) |

The reference lists — twelve offerings, eight industries, nine customer segments, twelve channels, the
eleven stage templates — are Assured's own taxonomy out of the source workbooks, not sample data. They
stay, and are editable in Setup.

`npm run demo` adds the illustrative portfolio and CRM leads if you want something to walk through;
`npm run reset` puts you back to clean.

## The Product Head configures everyone else

The **Product Head** role carries `users.manage`, `stagemodel.manage`, `settings.manage` and
`crm.setup.manage`. From that login, Setup → Users creates people and assigns any combination of roles;
Setup → Roles & permissions edits what each role may do and adds new ones. That is the only way users
come into existence on a clean install, which the test suite relies on — it bootstraps every role user
through this login before it can test anything else.

## Approvals only — who does what at a gate

| Role at the stage | What they do |
|---|---|
| **Stage owner** | Moves the product on. Marks the exit criteria met, then submits the gate. |
| **Approver** | The only person who can decide it. Approves, or returns it with a reason. |
| **Participants** | Told when the gate is submitted and told the outcome. They never block it. |

There is no consultation step: nobody has to comment before an approver can decide. The owner, approver
and participants for each of the fourteen stages come from the **"Responsibility - Stage wise"** sheet
and are checked against it by `npm run validate`.

Two rules still hold on top of that. **BR-07** — only a user holding the approver role may decide.
**BR-09** — whoever marked the final exit criterion may not also record the approval, even where one
person holds both roles.

## The two modules meet at Seeding

> *"When a product reaches Seeding, it needs to come to the content calendar as a notification."*

When a PLM product enters market state **Seeding** — which happens on its first paid deployment once
gate 8 is approved (BR-11) — the system raises a **launch-content prompt** on the CRM's content
calendar and notifies everyone holding `crm.content.manage`.

The prompt is deliberately *not* a content item. It appears as a banner on the calendar and a flag on
its due date, carrying the product code, the problem it solves and a suggested date
(`crm_seeding_lead_days`, default 10). **Plan it** opens the content form pre-filled and links the two;
**Dismiss** needs a reason. Content still requires date, title, type, channel and person before it
exists (BR-31) — the hand-off never fabricates a content item nobody owns.

## Stage responsibilities are validated against the sheet

`npm run validate` reads the **"Responsibility - Stage wise"** sheet of
`PLM_Product_Portfolio_Tracker.xlsx` and compares owner, approver and participants against the
configured stage model, stage by stage — the sheet's Participants column is the notified-only list.
It exits non-zero on any mismatch, so it belongs in the
go-live checklist and after any change to either side.

**Current result: all 14 stages match** — Conceptualization through Die, including the `NA` approver on
all six market states. The xlsx is read by `app/xlsx.mjs`, a ~70-line reader over `node:zlib`, so this
stays dependency-free.

The sheet carries no exit criteria, target durations or ageing thresholds; those come from the BRD and
the validator reports any gate left without active criteria.

## What is enforced, server-side

**PLM — the business rules of §11**, including derived entry gate from route (BR-04) with a reasoned
override (BR-05); sequential traversal (BR-03); no submission until every exit criterion is met with an
evidence note (BR-06); approver identity (BR-07); separation of duties (BR-09); only the stage owner
moves a stage on (§9.1); effort logged at the stage (BR-21); market entry only on the first paid
deployment (BR-11); Finance Head confirmation before revenue reaches reporting (BR-23); a
fifty-character closure reason (BR-25); ageing a date revision does not reset (BR-30); immutable
history (BR-33). **BR-08, consultation before approval, is deliberately not implemented** — see below.

**CRM — all 38 business rules**, including company name as the only field mandatory at creation
(BR-01); pipeline derived from Offering × Industry and never set directly (BR-04); one active pipeline
per pair (BR-05); cumulative requirements (BR-15); a refusal naming *every* missing field, not the
first (BR-16); the conditional Online requirement (BR-17); Lead Source omitted from the refusal while
the Channel that derives it is itself unmet (BR-19); loss as a status that keeps its stage (BR-28);
one primary attribution plus unlimited touches (BR-33); reference values deactivated, never deleted
(BR-35).

The browser never decides any of this. It shows the refusal and quotes the rule.

## Deliberate interpretations

Points where a spec was silent or two requirements pulled against each other. Each is a decision, not
an accident.

1. **One app, not two.** AGC-BRD-CRM-001 §10 describes a standalone build with its own `package.json`,
   seed and server. You asked for a CRM *module*, and the Seeding hand-off needs shared data, so the CRM
   was built into the existing application: shared schema, session, audit and user directory.
2. **Salesforce Lightning, not IBM Plex.** CRM NFR-08 asks for the prototype's teal/amber token set.
   Your standing instruction was a Salesforce-inspired UI, and one product cannot carry two visual
   languages. The CRM prototype's *information architecture and interaction model* are followed closely
   — the stage bar, the blocked/ready banner, the three-state requirement matrix, the calendar-and-table
   toggle — in the Lightning language already established by the PLM module.
3. **Approvals only (your instruction, over the BRD).** The BRD's §10 RASCI and BR-08 make several
   roles *consulted*, each of whom had to comment before an approver could decide. You asked for
   approvals only, so BR-08 is gone, the `consultations` table is dropped, and the workbook's
   Participants column now means notified-only. The stage owner moving the product on is enforced,
   which the BRD implied but never checked.
4. **Roles are the existing role table.** CRM §4.5 specifies `app_user.role ∈ Administrator · Sales User`.
   Your requirement was that any role be assignable to any user, so the CRM ships two roles —
   **CRM Administrator** and **CRM Sales User** — in the same roles table, carrying `crm.*` permissions.
   FR-43 holds: a Sales User is refused 403 on every Setup route. Approval authority in the PLM module
   still comes from the stage model, never from a permission.
5. **BR-11 vs BR-03 (PLM).** Market entry needs *both* gate 8 approved and a deployment recorded,
   whichever lands last. Deployments are facts and can be logged at any time; they just do not move the
   product until pricing is approved.
6. **Withdrawal (PLM).** §13 makes it a CEO decision but market states are the Business Head's, so
   setting Die requires `kill.approve`, not `market.change`.
7. **BR-09 in a seven-person firm (PLM).** Enforced literally, which means after a return the stage
   owner must re-mark in their own name. That is OI-09 made concrete rather than decided for you.
8. **Notifications (CRM §13).** Out of scope in the CRM spec, but you asked for the Seeding hand-off.
   It is built as in-app notification plus a calendar prompt. No email — that still needs a mail host.

## Spec observations worth a sponsor decision

- **§11 rule 3 vs Iteration 4.** §11 says to assert "all ten field labels" in the BR-16 refusal;
  Iteration 4 says the refusal names **seven**. Seven is right and the two reconcile through BR-19:
  Offering and Industry are already recorded, and Lead Source is omitted because Channel is unmet.
  The tests assert the seven.
- **OI-09 (multi-industry clients) does not bite as seeded.** RouteX and StoXmart each cover two
  industries, but each is *one* pipeline covering both, so every one of the fifteen pairs resolves to
  exactly one pipeline. It would only bite if someone split one of those pipelines in two.
- **Moving the qualification gate leaves the old gate's requirements behind**, because a requirement is
  keyed to a stage, not to the gate flag (BR-14). Correct, and worth knowing before you move a gate:
  re-point the requirements in the matrix afterwards.

## Not built

- Email delivery (PLM FR-49, FR-33/34; CRM §13). Notifications are in-app; SMTP needs a mail host.
- SSO against a directory (PLM INT-01, CRM §13). Username and password with scrypt hashing is in place.
- PLM FR-56 (CEO approval workflow for stage-model amendments) and FR-35 (timed escalation) — both
  priority S. Changes are audited; nothing fires on a timer.
- CRM §13 exclusions: mobile app, document storage, quotation and invoicing, calendar/inbox
  integration, target setting and variance reporting, renewals, multi-currency, multi-company.

Every open item in either BRD touches a value that is a setting under Setup, so closing one is
configuration, not a code change.

## Deployment

Backend and database on Zoho Catalyst, frontend on Vercel — see **[deploy/README.md](deploy/README.md)**
for the topology, what is done, what is tested, and the two things still needed from you.

## Layout

| File | Contains |
|---|---|
| `app/db.mjs` | Schema — 40 tables across both modules |
| `app/seed.mjs` · `app/api.mjs` | PLM reference data · PLM rules, gate engine, dashboard, RPT-01…09 |
| `app/crm-seed.mjs` · `app/crm.mjs` | CRM §9 reference data · CRM rules, stage engine, calendar, CRM-01…08 |
| `app/crm-demo.mjs` | Illustrative leads and content (`npm run demo`) |
| `app/server.mjs` · `app/lib.mjs` | HTTP, session, routing · working days, scrypt, signed sessions, CSV |
| `app/test.mjs` · `app/crm-test.mjs` | The two unit suites |
| `app/smoke.mjs` | Functional checks over real HTTP — re-runnable against any deployment |
| `app/xlsx.mjs` · `app/validate-stages.mjs` | Dependency-free xlsx reader · the stage-responsibility validator |
| `app/plm-demo.mjs` · `app/crm-demo.mjs` | Optional illustrative data (`npm run demo`) |
| `deploy/` | Catalyst schema, provisioner and function · Vercel build, config and edge emulator |
| `app/public/` | `app.js` shell · `views.js`, `setup.js` (PLM) · `crm.js`, `calendar.js`, `crm-setup.js` (CRM) · `app.css` |
