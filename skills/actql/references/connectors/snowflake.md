<!-- Generated from actql/actql@84d4ef5bff33 docs/connectors/snowflake.md; do not edit. The published page is https://actql.com/docs/actql/connectors/snowflake -->
# Snowflake

The Snowflake Connector reads tables, views and staged files from a Snowflake
database, writes rows and tables back, loads content into stages, and runs
procedures and tasks. It is the warehouse in the churn-risk example: product
usage lives there, and the Connector lets Snowflake do the heavy part of the
work — filtering and aggregating — before the rows reach the engine.

## Sources

Every table and view in the configured database and schema is a source:
`snowflake.usage_30d`, `snowflake.events`, `snowflake.accounts_dim`. Columns
and types come from Snowflake's information schema. A table's key is the
`PRIMARY KEY` or `UNIQUE` constraint it declares; Snowflake does not enforce
those constraints on standard tables, so the Connector treats them as a claim
to verify, not a fact (see [Effects](#effects-and-operations)).

Files on an internal or external stage are sources too:
`LIST_FILES(snowflake, glob => r'@exports/*.csv')` lists them with `resource`,
`version` (the file's MD5) and `path`, and `snowflake.contents` joined on
`resource` and `version` reads a file as a `content_ref`.

To read another schema, configure a second connection — `snowflake_raw`,
say — rather than qualifying names inside the Program.

## Types

| Snowflake | ActQL | Notes |
| --- | --- | --- |
| `NUMBER(p, s)` | `decimal(p, s)` | Precision and scale are kept. A `NUMBER(38,0)` is not an `int64`; it is read as a decimal unless its declared precision fits. |
| `FLOAT` | `float64` | Only finite values; `NaN` and infinities fail the read with a named reason. |
| `VARCHAR`, `STRING`, `TEXT` | `string` | |
| `BOOLEAN` | `bool` | |
| `DATE` | `date` | |
| `TIME` | `time` | Nanosecond precision is kept. |
| `TIMESTAMP_NTZ` | `datetime` | No time zone; never reinterpreted through the session zone. |
| `TIMESTAMP_LTZ` | `timestamp` | Stored as UTC; the session time zone affects Snowflake's display, not the value ActQL reads. |
| `TIMESTAMP_TZ` | `timestamp` with offset | The offset is kept; Snowflake does not store the zone name, and neither does ActQL. |
| `VARIANT`, `OBJECT`, `ARRAY` | `json` | Typed JSON; `NULL` and JSON `null` are distinct, as in Snowflake. |
| `BINARY` | `bytes` | |
| `GEOGRAPHY`, `GEOMETRY` | `string` (GeoJSON) | Read only. |

Writes convert in the other direction with the same rules; a value that does
not fit the target column (precision, length, type) fails `check` when it is
known statically and the item otherwise, never silently truncates.

## Effects and operations

Record Effects write by key:

- **insert** — `EFFECT INSERT snowflake.account_scores (col, …)`.
- **update** — `EFFECT UPDATE snowflake.account_scores ID account_id SET (…)`.
- **upsert** — `EFFECT UPSERT snowflake.account_scores ID account_id SET (…)`,
  applied as `MERGE`.
- **delete** — `EFFECT DELETE snowflake.account_scores ID account_id`.

The key named by `ID` must identify exactly one row. The Connector's Mapping
for the table declares which columns form the key; because Snowflake does not
enforce uniqueness, the Connector verifies it when it builds the Preview, and
a key that matches several rows makes that item `failed` — it is never
applied as a single-row change. An update whose source rows carry two
different values for the same key is refused at `check`.

Tables and content:

- **create table** — `|> CREATE [OR REPLACE] TABLE snowflake.active_usage`
  writes the rows as a whole table.
- **store** — `EFFECT STORE snowflake.stages SET (stage = '@exports', path = …, content = content)`
  puts the row's `content` (from `SERIALIZE` or a `contents` source) onto a
  stage.

Operations:

- **call** — `EFFECT COMMAND snowflake.call ID key INPUT (procedure = 'ANALYTICS.REBUILD', args = [...])`
  calls a stored procedure.
- **execute_task** — `EFFECT COMMAND snowflake.execute_task TARGET task_name ID key`
  runs a task once.

Logical items and physical statements are different things. The Connector may
apply a hundred `UPSERT` items as one `MERGE`, but every item keeps its own
identity, Preview entry and outcome.

## Setup

```json
"snowflake": {
  "connector": "snowflake",
  "account": "acme-eu",
  "warehouse": "ANALYTICS",
  "database": "PRODUCT",
  "schema": "USAGE",
  "role": "ACTQL_READER",
  "user": "ACTQL",
  "credentials": {"private_key": {"env": "SNOWFLAKE_PRIVATE_KEY"}}
}
```

Key-pair authentication is the default; a password can be supplied the same
way. The role needs `USAGE` on the warehouse, database and schema and `SELECT`
on the tables a Program reads. For writes, either give the same role `INSERT`,
`UPDATE`, `DELETE`, `CREATE TABLE` and stage privileges, or configure a second
connection with a writing role (`snowflake_write`, role `ACTQL_WRITER`) and
point Effects at it — the policy then distinguishes the two.

On ActQL Cloud the same connection fields apply; the private key is stored in
the Cloud's secret store instead of an environment variable.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; only the referenced columns are selected, with their declared types. |
| `WHERE` | The predicate uses columns of this source and operators whose Snowflake semantics equal ActQL's (comparisons, `IN`, `LIKE`, `IS NULL`, date arithmetic). Snowflake's case-insensitive collations and `ILIKE` are not used for a case-sensitive predicate. A predicate that mixes sources stays in the engine or is split, with the residual evaluated by the Host. |
| `GROUP BY` with `COUNT`, `MIN`, `MAX` | Always. |
| `SUM`, `AVG` | When the column is `NUMBER` (exact decimal) or the Program declares `float64` arithmetic; `AVG` over `NUMBER` keeps Snowflake's result scale, which `check` reports. |
| `ORDER BY`, `LIMIT` | When the sort columns' collation matches ActQL's (binary) and the limit is a constant or parameter. |
| `JOIN` | When both inputs are sources of the same connection, or when the Host permits moving the other input into Snowflake (a temporary table) — the Site then reads `connector:snowflake`. Otherwise the join runs on the Host. |

`explain` shows each pushed-down step with Site `connector:snowflake` and
Engine `Snowflake SQL`; what Snowflake cannot do with ActQL's meaning intact
runs on the Host, and a Cloud or remote Host may choose DuckDB for it.

## Preview and reconciliation

**Preview.** Updates, upserts and deletes are previewed as `full_diff`: the
Connector reads the target rows by key, records the current values, and the
Preview shows current and new values per row. Snowflake runs at `READ
COMMITTED`, so reading first is not enough on its own; the Connector also
records each row's `METADATA$ROW_ID` and a hash of its current values, and the
`MERGE` or `UPDATE` it sends is conditioned on them. A row changed between
Preview and apply is not updated: the item ends `failed` with
`conflict`, and the Run produces a new Preview if asked to continue. Inserts
and table creations are previewed as `targeted` (what would be written and
where); `CREATE OR REPLACE` previews the row count being replaced.

**Reconciliation.** Before sending, the Connector binds the Effect item to
the statement it will run: the SQL API `requestId` it generates, and once
known, the `statementHandle` and query id. A lost reply is reconciled by
looking that statement up through the SQL API and `QUERY_HISTORY` **by its
id** — a successful statement in the history that does not carry the
Effect's `requestId` is not evidence. When a batch runs in an explicit
transaction, statement success and commit success are checked separately; a
committed `MERGE` reports which items it affected. An asynchronous statement
is tracked by its handle until it reaches a final state. If none of this
settles the outcome, the item stays `unknown` and nothing is resent.

## Limits and cost

- A pushed-down query runs on the configured warehouse and is billed like any
  other query there; `explain` names the warehouse. The Program's row and
  byte limits bound what one read may return.
- Results are fetched in chunks of the SQL API's partition size; the Connector
  stops with an error, not a partial result, when a limit is reached.
- `QUERY_HISTORY` in the information schema covers seven days and account
  usage views lag by up to 45 minutes; reconciliation uses the statement
  handle first and falls back to history within those windows.
- Case: Snowflake upper-cases unquoted identifiers. Write resource and column
  names in a Program as they appear in Snowflake; the Connector quotes them
  for you.

## Example

Accounts whose usage fell in the last 30 days, by segment:

```sql
FROM snowflake.usage_30d
|> WHERE trend = 'down'
|> AGGREGATE COUNT(*) AS accounts, AVG(active_users) AS avg_users
     GROUP BY segment
|> ORDER BY accounts DESC;
```

Keep a scores table current with a model's judgement:

```sql
SELECT a.id AS account_id, a.description AS notes, u.active_users, u.trend
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
|> WHERE risk.outcome = 'ok'
|> SELECT account_id, risk.value.level AS level, risk.value.reason AS reason
|> EFFECT UPSERT snowflake.account_scores ID account_id SET (level = level, reason = reason);
```

Rebuild a reporting table from the warehouse itself:

```sql
FROM snowflake.events
|> WHERE occurred_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
|> AGGREGATE COUNT(*) AS events GROUP BY account_id
|> CREATE OR REPLACE TABLE snowflake.events_30d;
```
