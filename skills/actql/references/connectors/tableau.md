<!-- Generated from actql/actql@84d4ef5bff33 docs/connectors/tableau.md; do not edit. The published page is https://actql.com/docs/actql/connectors/tableau -->
# Tableau

The Tableau Connector reads the catalog of a Tableau site — workbooks, data
sources, views and flows — and the data behind a view; it renames, moves and
deletes catalog items, publishes rows as a data source, and starts extract
refreshes and flow runs. It is useful in two directions: a Program can read
what a dashboard shows and act on it, and a Program can push fresh data into
Tableau after it has written elsewhere.

## Sources

- `tableau.workbooks` — workbooks on the site: `id`, `name`, `project_id`,
  `project`, `owner`, `created_at`, `updated_at`, `tags`. Key `id`.
- `tableau.datasources` — published data sources: `id`, `name`, `project_id`,
  `project`, `type`, `has_extract`, `last_refreshed_at`, `updated_at`, `tags`.
  Key `id`.
- `tableau.views` — views (sheets and dashboards): `id`, `name`,
  `workbook_id`, `url`, `view_count`, `last_viewed_at`. Key `id`.
- `tableau.flows` — Prep flows: `id`, `name`, `project_id`, `last_run_at`.
  Key `id`.
- `tableau.view_data` — the rows behind a view, as the view's columns. Filter
  by `view_id`; the Connector downloads the view's data and types the columns
  from Tableau's metadata. The key is the view's own key columns when its
  metadata declares them; otherwise the source has no key and cannot be the
  target of an `INFER` without `ITEM KEY`.

A connection is scoped to one site. Use a second connection for another site.

## Types

| Tableau | ActQL | Notes |
| --- | --- | --- |
| `string`, `tags` | `string`, `array<string>` | |
| `integer`, `real` (view data) | `int64`, `float64` | View-data columns typed from the view's metadata; `real` admits finite values only. |
| `boolean` | `bool` | |
| `date`, `datetime` | `date`, `timestamp` | REST timestamps are UTC. |
| `LUID` (`id`, `project_id`, `workbook_id`) | `string` | Stable identifiers; names are not. |
| `updatedAt` | `timestamp` | Also used as the apply-time condition for updates. |

Writes convert in the other direction with the same rules; a value that does
not fit fails `check` when known statically and the item otherwise.

## Effects and operations

Record Effects write by key:

- **update** — `EFFECT UPDATE tableau.workbooks ID id SET (name = …, project_id = …, tags = …)`
  and the same on `tableau.datasources`: rename, move between projects, retag.
- **delete** — `EFFECT DELETE tableau.workbooks ID id` and
  `EFFECT DELETE tableau.datasources ID id`.

`id` is Tableau's LUID and identifies exactly one item; a name is never
accepted as a key.

Tables and content:

- **publish** — `EFFECT STORE tableau.datasources SET (name = …, project_id = …)`
  publishes the current rows as a new published data source, or replaces the
  one with that name in that project. The rows themselves are published, not
  a file.

Operations:

- **refresh** — `EFFECT COMMAND tableau.refresh TARGET datasource_id ID key`
  starts an extract refresh of the targeted data source.
- **run_flow** — `EFFECT COMMAND tableau.run_flow TARGET flow_id ID key`
  starts a Prep flow run.

Both are accepted by Tableau and run as background jobs: the item ends
`accepted` with the job id, and the Run can finish before the job completes.
The job's own result is separate work, read later from the jobs list.

## Setup

```json
"tableau": {
  "connector": "tableau",
  "server": "https://tableau.acme.com",
  "site": "analytics",
  "credentials": {
    "token_name": "actql",
    "token_secret": {"env": "TABLEAU_PAT_SECRET"}
  }
}
```

Create a personal access token for a user whose site role allows viewing the
workbooks, data sources and flows a Program reads, publishing to the projects
it writes to, and running extract refreshes and flows. Tableau Cloud and
Tableau Server are configured the same way. On ActQL Cloud the same fields
apply, with the token secret kept in the Cloud's secret store.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always for the catalog sources; `view_data` is downloaded with all of the view's columns and projected on the Host. |
| `WHERE` | On catalog sources, for `name`, `project_id`, `owner`, `tags` and the time columns with `=`, `IN`, `<`, `>` — the REST API's filter expressions. Every predicate on `view_data` runs on the Host. |
| `ORDER BY`, `LIMIT` | On catalog sources, by `name` and the time columns; paging is 100 items a page. |
| `AGGREGATE`, `JOIN` | Never; both run on the Host. |

`explain` shows catalog reads with Site `connector:tableau` and Engine
`Tableau REST`; `view_data` is read whole and everything on it runs on the
Host.

## Preview and reconciliation

**Preview.** Updates and deletes are `full_diff`: the Connector reads the item
by LUID, records its current name, project and tags, and the Preview shows
current and new values. The request it sends carries the `updatedAt` it saw;
an item changed in between makes the item `failed` with `conflict`, and the
Run produces a new Preview if asked to continue. Publishing previews the data
source name, project and the row count being published, and whether an
existing data source would be replaced (`targeted`). A refresh or flow run
previews the target and says a job would be started (`targeted`).

**Reconciliation.** Every refresh and flow run is a job; the Connector
records the job id as soon as Tableau returns it, and a lost reply is
reconciled by finding **that job** in the jobs list — a recent job on the same
data source that the Connector did not start is not evidence. Publishes carry
the request's marker in the data source description; a lost reply is
reconciled by looking the data source up by name and checking the marker, and
a data source with the right name but no marker leaves the item `unknown`.
Updates and deletes carry no marker Tableau stores and the REST API records
no request id, so a lost reply to an update or delete leaves the item
`unknown`; the item holding the approved values, or an `updatedAt` in the
request window, is not evidence. Nothing is resent on a guess.

## Limits and cost

- The REST API pages 100 items at a time and rate-limits per site; the
  Connector paces within the limit and stops with an error, never a partial
  result, when the Program's row limit is reached.
- View data downloads are bounded by the Program's byte limit; a very large
  view should be read from its underlying warehouse table instead.
- A refresh or flow run consumes the site's background job capacity and, on
  Tableau Cloud, counts against the site's job limits; the Run records the job
  id so the cost can be traced.
- Publishing replaces a data source as a whole; a replaced extract is
  rebuilt by Tableau afterwards.

## Example

Views nobody has opened in 90 days:

```sql
FROM tableau.views AS v
JOIN tableau.workbooks AS w ON v.workbook_id = w.id
|> WHERE v.last_viewed_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
|> SELECT w.project, w.name AS workbook, v.name AS view
|> ORDER BY w.project, w.name;
```

Refresh the churn dashboard's data source after writing new scores:

```sql
FROM tableau.datasources
|> WHERE name = 'Churn Risk Scores'
|> EFFECT COMMAND tableau.refresh TARGET id ID id;
```

Publish a model's judgement as a data source the dashboards can use:

```sql
SELECT a.id AS account_id, a.name, risk.value.level AS level, risk.value.reason AS reason
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.description, active_users = u.active_users, trend = u.trend) AS risk
|> WHERE risk.outcome = 'ok'
|> EFFECT STORE tableau.datasources SET (name = 'Churn Risk Scores', project_id = @project);
```
