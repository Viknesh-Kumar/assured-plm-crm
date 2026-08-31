# What Catalyst's Data Store actually does

Probed against the live **Assured-CRM** project (`94960000000014048`, org `937179130`, Development)
on 30 August 2026. Every row below is an observed result, not documentation.

| Construct | Result |
|---|---|
| `INSERT`, single and multi-row | works; returns the row including its `ROWID` |
| `SELECT … WHERE col = value` | works |
| `ORDER BY`, `LIMIT` | works |
| `COUNT()`, `SUM()`, `MAX()` | works |
| `LEFT JOIN`, three tables deep | works |
| Foreign key pointing at a parent's application `id` | works — accepts `1`, not the parent's ROWID |
| **Subquery in a SELECT list** | **rejected** — `"Sub query is not supported in Select"` |
| **`LIKE` on a column without a search index** | **returns an empty set, with no error** |
| `AS` aliases | silently ignored — `SUM(sort) AS total` comes back keyed `SUM(sort)` |
| Return types | everything is a **string**, including ints — `"1"`, not `1` |
| Join result shape | namespaced per table: `{users: {...}, roles: {...}}`, not flattened |
| `varchar` length | capped at **255** regardless of what you ask for |

## What each of these costs

**No subqueries in SELECT.** This is the big one. The engine has 26 correlated subselects —
`(SELECT COALESCE(SUM(days),0) FROM effort_entries WHERE product_id = p.id)` and its siblings — which
build every derived figure on a product or lead: effort to date, deployment count, attributed revenue,
criteria met, revision count. All of it has to move out of SQL and into JavaScript.

**Silent empty `LIKE`.** The nastiest of the set, because nothing fails. Two queries in the engine used
`WHERE r.permissions LIKE '%kill.approve%'` to find who to notify. On Catalyst they would have returned
nothing, forever: the CEO would never have been told a kill was waiting, and nobody would have been
told a product had reached Seeding. **Fixed** — both now resolve permissions in code with an exact
membership test, which is also more correct on SQLite, where `LIKE '%crm.content.manage%'` would match
a permission named `crm.content.manageX`.

**Strings for everything, and ignored aliases.** The adapter needs a coercion layer driven by the
schema, and aggregate results must be read by their expression key rather than a friendly name.

**Namespaced join results.** Helpful, in fact: `users.name` and `roles.name` do not collide. The
adapter flattens with the table prefix that the engine already uses in its column aliases.

## What this means for the port

The shape of the adapter is now settled rather than guessed:

- Joins stay in SQL. That was the main risk and it is gone.
- The 26 derived figures move into a `derive()` pass in JavaScript — one aggregate query per collection
  rather than one per row, so it is fewer round trips than the SQLite version, not more.
- A thin read layer flattens namespaced rows and coerces types from the schema.
- Writes go through row APIs; composite-key tables (`user_roles`, `stage_participant`,
  `pipeline_industry`, `lead_content_touch`, `lead_field_value`, `stage_requirement`) need an
  existence check before insert, because Catalyst's only primary key is `ROWID`.

## Schema-admin findings

Two things bit during provisioning that no amount of reading would have caught.

**Catalyst ids overflow a JavaScript number.** Table and column ids are 17-digit integers sent
*unquoted* in JSON. `JSON.parse` rounds `94960000000020001` to `...20000`, which then addresses a table
that does not exist — and the API answers that with `401 OAUTH_SCOPE_MISMATCH`, not a 404, so it reads
exactly like a permissions problem. The provisioner now quotes any bare integer of 16+ digits before
parsing. **Anything else you write against this API needs the same guard.**

**Two column names are reserved.** Probed one at a time against a scratch table:

| Refused | Accepted |
|---|---|
| `key`, `date` | `value`, `text`, `type`, `status`, `source`, `track`, `band`, `seq`, `days`, `met`, `period`, `label`, `kind`, `url`, `theme`, `note`, `summary`, `action`, `entity`, `field`, `mode`, `decision` |

The error is `INVALID_OPERATION — Column name cannot contain reserved keywords`, and it fails the whole
batch without naming the offender. Three columns are affected, and the generator now renames them,
recording `source_column` so the adapter can map back:

| Engine | Catalyst |
|---|---|
| `settings.key` | `setting_key` |
| `lead_field.key` | `field_key` |
| `content.date` | `content_date` |

## The scope that is actually needed

A self-client token scoped `ZohoCatalyst.tables.READ` + `ZohoCatalyst.tables.CREATE` creates all 39
tables and then fails on every column call. Adding a column is an **update to the table resource**, so
the grant almost certainly needs:

```
ZohoCatalyst.projects.READ,ZohoCatalyst.tables.READ,ZohoCatalyst.tables.CREATE,ZohoCatalyst.tables.UPDATE
```

Two tokens without `UPDATE` both failed identically, on both `GET` and `POST` to
`/table/{id}/column`, including with a correctly-formed id — so this is a real scope gap and not the
id-rounding bug above.

## Provisioning state

**All 39 tables exist.** Columns are complete on 11 of them — `roles`, `users`, `user_roles`,
`content_type`, `content_channel`, `offering`, `industry`, `customer_segment`, `stage_template`,
`lead_field`, `settings` — with real foreign keys, verified by live inserts and a three-table join.
The other 28 are empty shells.

`deploy/catalyst-provision.mjs` is idempotent and finishes the rest in one run. It has been corrected
against the live API four times over: table scope is `GLOBAL` (`ProjectScope` is rejected, so the first
version died on its first call), one table per request, columns batched as an array, varchar clamped to
255, and ids parsed without precision loss.

Clear the probe rows before a real load:

```sql
DELETE FROM user_roles;
DELETE FROM users;
DELETE FROM roles;
```
