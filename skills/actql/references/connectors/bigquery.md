<!-- Generated from actql/actql@84d4ef5bff33 docs/connectors/bigquery.md; do not edit. The published page is https://actql.com/docs/actql/connectors/bigquery -->
# BigQuery

The BigQuery Connector reads tables and views from a BigQuery dataset, writes
rows and tables back, loads content from Google Cloud Storage, and runs
procedures and query jobs. It is the warehouse to reach for when product
events, sessions or billing data already live in Google Cloud; filtering and
aggregation stay in BigQuery and only the result reaches the engine.

## Sources

Every table and view in the configured dataset is a source:
`bigquery.sessions`, `bigquery.orders`, `bigquery.customers`. Columns and
types come from the dataset's metadata. Nested and repeated fields are read
as objects and arrays. Partitioned and clustered tables are read like any
other, and a filter on the partition column is pushed down so BigQuery scans
only the partitions it needs.

A table's key is the `PRIMARY KEY` it declares. BigQuery does not enforce
primary keys, so the Connector treats the declaration as a claim to verify
before a write, not as a fact (see [Effects](#effects-and-operations)). A
table without a declared key can still be updated when the connection
declares the key columns for it.

To read another dataset, configure a second connection — `bigquery_raw`, say
— rather than qualifying names inside the Program.

## Types

| BigQuery | ActQL | Notes |
| --- | --- | --- |
| `INT64` | `int64` | |
| `NUMERIC` | `decimal(38, 9)` | Precision and scale are kept; a parameterized `NUMERIC(p, s)` keeps its own. |
| `BIGNUMERIC` | `decimal(76, 38)` | Kept exactly; values beyond ActQL's decimal law fail the read with a named reason rather than rounding. |
| `FLOAT64` | `float64` | Only finite values; `NaN` and infinities fail the read. |
| `BOOL` | `bool` | |
| `STRING` | `string` | |
| `BYTES` | `bytes` | |
| `DATE` | `date` | |
| `TIME` | `time` | Microsecond precision is kept. |
| `DATETIME` | `datetime` | A civil date-time with no zone; never reinterpreted. |
| `TIMESTAMP` | `timestamp` | A UTC instant with microsecond precision. |
| `STRUCT` | `object` | Field names and types are kept. |
| `ARRAY` | `array` | Element type is kept; BigQuery arrays cannot hold `NULL` elements, and neither will ActQL write one. |
| `JSON` | `json` | Typed JSON; SQL `NULL` and JSON `null` stay distinct. |
| `GEOGRAPHY` | `string` (WKT) | Read only. |
| `INTERVAL`, `RANGE` | `string` | Read only. |

Writes convert in the other direction with the same rules; a value that does
not fit the target column fails `check` when it is known statically and the
item otherwise, never silently truncates.

## Effects and operations

Record Effects write by key:

- **insert** — `EFFECT INSERT bigquery.account_scores (col, …)`. The
  Connector chooses streaming inserts for small Effects and a batch load for
  larger ones; which one it chose appears in the Run record.
- **update** — `EFFECT UPDATE bigquery.account_scores ID account_id SET (…)`.
- **upsert** — `EFFECT UPSERT bigquery.account_scores ID account_id SET (…)`,
  applied as `MERGE`.
- **delete** — `EFFECT DELETE bigquery.account_scores ID account_id`.

The key named by `ID` must identify exactly one row. Because BigQuery does not
enforce uniqueness, the Connector verifies it when it builds the Preview, and
a key that matches several rows makes that item `failed` — it is never
applied as a single-row change. An update whose source rows carry two
different values for the same key is refused at `check`. Rows written by a
streaming insert cannot be updated or deleted for a short period (the
streaming buffer); an item that targets one ends `failed` with
`conflict` and can be retried in a later Run.

Tables and content:

- **create table** — `|> CREATE [OR REPLACE] TABLE bigquery.events_30d`
  writes the rows as a whole table in the dataset.
- **store** — `EFFECT STORE bigquery.loads SET (table = 'raw_events', uri = 'gs://acme-landing/events/*.jsonl', source_format = 'JSONL')`
  starts a load job from objects already in Google Cloud Storage into a
  table. Use the [GCS Connector](gcs.md) to put content there first.

Operations:

- **call** — `EFFECT COMMAND bigquery.call ID key INPUT (procedure = 'product.rebuild_scores', args = [...])`
  calls a stored procedure.
- **run_query_job** — `EFFECT COMMAND bigquery.run_query_job ID key INPUT (sql = @statement, destination = 'product.snapshot')`
  runs a query job whose result is written to a destination table. The SQL
  is a parameter the Host checks against the account's permissions; the
  Program cannot assemble it from row values.

Logical items and physical statements are different things. The Connector may
apply a thousand `UPSERT` items as one `MERGE`, but every item keeps its own
identity, Preview entry and outcome.

## Setup

```json
"bigquery": {
  "connector": "bigquery",
  "project": "acme-analytics",
  "dataset": "product",
  "location": "EU",
  "credentials": {"service_account": {"env": "BIGQUERY_SERVICE_ACCOUNT_JSON"}}
}
```

The service account needs `bigquery.tables.getData` and `bigquery.jobs.create`
in the project to read, `bigquery.tables.updateData` to write rows,
`bigquery.tables.create` for `CREATE TABLE` and load jobs, and
`bigquery.routines.get` to call procedures. `roles/bigquery.dataViewer` plus
`roles/bigquery.jobUser` cover reads; `roles/bigquery.dataEditor` covers
writes. A read-only connection and a writing connection can use two service
accounts under two connection names.

On ActQL Cloud the same fields apply; the service account key is stored in the
Cloud's secret store, or the Cloud's own Google identity is granted the roles
instead of a key.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; only the referenced columns are selected, with their declared types. Nested fields are selected by path. |
| `WHERE` | The predicate uses columns of this source and operators whose BigQuery semantics equal ActQL's (comparisons, `IN`, `LIKE`, `IS NULL`, date arithmetic). A filter on the partition or clustering column limits the bytes scanned. A predicate that mixes sources stays in the engine or is split, with the residual evaluated by the Host. |
| `GROUP BY` with `COUNT`, `COUNT(DISTINCT)`, `MIN`, `MAX` | Always; `COUNT(DISTINCT)` is exact, never `APPROX_COUNT_DISTINCT`. |
| `SUM`, `AVG` | When the column is `NUMERIC`/`BIGNUMERIC` (exact) or the Program declares `float64` arithmetic. |
| `ORDER BY`, `LIMIT` | When the sort uses BigQuery's binary string order and the limit is a constant or parameter. |
| Window functions | When the window specification is one BigQuery and ActQL share. |
| `JOIN` | When both inputs are sources of the same connection, or when the Host permits loading the other input into a temporary table in the dataset — the Site then reads `connector:bigquery`. Otherwise the join runs on the Host. |

`explain` shows each pushed-down step with Site `connector:bigquery` and
Engine `BigQuery SQL`, together with the bytes the job would scan when the
dry run can estimate them.

## Preview and reconciliation

**Preview.** Updates, upserts and deletes are previewed as `full_diff`: the
Connector reads the target rows by key, records the current values, and the
Preview shows current and new values per row. BigQuery has no row version, so
the Connector records a hash of each target row's current values and
conditions the `MERGE` or `UPDATE` on it; a row changed between Preview and
apply is not updated — the item ends `failed` with `conflict`, and the Run
produces a new Preview if asked to continue. Inserts, table creations and
load jobs are previewed as `targeted`: what would be written and where, and
for `CREATE OR REPLACE` the row count being replaced. A procedure call or
query job previews its name, arguments and destination.

**Reconciliation.** Every write, load and query is a BigQuery job. The
Connector generates the job id itself before sending and records it against
the Effect item, so a lost reply is reconciled by fetching that job: done
with no error means the statement committed, done with an error means
`failed`, still running means the item stays in flight. A job found in the
project's history that does not carry the Effect's job id is not evidence,
and neither is the target row holding the expected value. A streaming insert
has no job and BigQuery offers no lookup by `insertId`, so a lost reply to a
streaming insert leaves the item `unknown`; nothing is resent. A Program that
needs reconcilable inserts uses the batch load path, which is a job.
Operations end `accepted` when the job was created, `applied` when it
reached `DONE` without error, and `unknown` when neither can be established.

## Limits and cost

- A pushed-down query is a BigQuery job and is billed by bytes scanned (or
  by slot time on a reservation). `explain` shows the dry-run estimate when
  it is available; the Program's byte limit caps what a single read may
  scan.
- Results are fetched in pages of the API's size; the Connector stops with an
  error, not a partial result, when a limit is reached.
- Streaming inserts are visible immediately but cannot be modified for up to
  90 minutes; batch loads are free but take longer to appear. The Connector
  reports which it used.
- Load jobs and table creation count against the project's daily load and
  DML quotas; a Program that would exceed them fails before sending.

## Example

Daily active users for the last week:

```sql
FROM bigquery.sessions
|> WHERE session_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
|> AGGREGATE COUNT(DISTINCT user_id) AS dau GROUP BY session_date
|> ORDER BY session_date;
```

Flag accounts in Salesforce whose sessions dropped to zero:

```sql
SELECT a.id AS id, s.last_session
FROM salesforce.accounts AS a
JOIN bigquery.account_activity AS s ON a.id = s.account_id
|> WHERE s.last_session < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
|> EFFECT UPDATE salesforce.Account
     ID id SET (Activity_Status__c = 'dormant');
```

Keep a scores table current:

```sql
SELECT a.id AS account_id, a.description AS notes, s.sessions_30d
FROM salesforce.accounts AS a
JOIN bigquery.account_activity AS s ON a.id = s.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = notes, active_users = sessions_30d, trend = 'flat') AS risk
|> WHERE risk.outcome = 'ok'
|> SELECT account_id, risk.value.level AS level, risk.value.reason AS reason
|> EFFECT UPSERT bigquery.account_scores ID account_id SET (level = level, reason = reason);
```
