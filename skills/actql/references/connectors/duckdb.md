<!-- Generated from actql/actql@747e5c2771ca docs/connectors/duckdb.md; do not edit. The published page is https://actql.com/docs/actql/connectors/duckdb -->
# DuckDB

The DuckDB Connector reads and writes tables in a DuckDB database file and
copies content to files next to it. As a Connector it is the quickest way to
run Programs over local data: point a connection at a file and query it. The
same DuckDB, bundled in the standard `@actql/node`, `actql` and CLI packages,
is also an engine the Host can use for work no single source can do — a join across
Salesforce and Snowflake, say — and `explain` shows it in the Engine column,
separately from the Site it runs on.

## Sources

Every table and view in the database file is a source: `duckdb.orders`,
`duckdb.customers`. Columns and types come from the file's catalog. A table's
key is the `PRIMARY KEY` or `UNIQUE` constraint it declares; DuckDB enforces
those constraints, so a declared key is a fact the Connector relies on. A
table without a constraint can still be written when the connection declares
the key columns for it, and the Connector verifies uniqueness before a write.

Parquet and CSV files that DuckDB can read are exposed through the
[Local files](local-files.md) Connector instead; this Connector is for the
tables inside the database file.

## Types

| DuckDB | ActQL | Notes |
| --- | --- | --- |
| `TINYINT`, `SMALLINT`, `INTEGER`, `BIGINT` | `int64` | |
| `HUGEINT`, `UHUGEINT`, `UBIGINT` | `decimal(39, 0)` | Values outside `int64` are kept as decimals. |
| `DECIMAL(p, s)` | `decimal(p, s)` | Precision and scale are kept. |
| `FLOAT`, `DOUBLE` | `float64` | Only finite values; `NaN` and infinities fail the read. |
| `BOOLEAN` | `bool` | |
| `VARCHAR` | `string` | |
| `BLOB` | `bytes` | |
| `DATE` | `date` | |
| `TIME` | `time` | Microsecond precision is kept. |
| `TIMESTAMP` | `datetime` | No zone; never reinterpreted. |
| `TIMESTAMP WITH TIME ZONE` | `timestamp` | A UTC instant. |
| `INTERVAL` | `string` | Read only. |
| `STRUCT` | `object` | |
| `LIST`, `ARRAY` | `array` | |
| `MAP` | `json` | |
| `JSON` | `json` | |
| `UUID` | `string` | |
| `ENUM` | `string` | Writes of a value outside the enum fail the item. |

Writes convert in the other direction with the same rules; a value that does
not fit the target column fails `check` when it is known statically and the
item otherwise, never silently truncates.

## Effects and operations

Record Effects write by key:

- **insert** — `EFFECT INSERT duckdb.customer_sentiment (col, …)`.
- **update** — `EFFECT UPDATE duckdb.customer_sentiment ID customer_id SET (…)`.
- **upsert** — `EFFECT UPSERT duckdb.customer_sentiment ID customer_id SET (…)`,
  applied as `INSERT … ON CONFLICT DO UPDATE`.
- **delete** — `EFFECT DELETE duckdb.customer_sentiment ID customer_id`.

The key named by `ID` must identify exactly one row. A declared `PRIMARY KEY`
or `UNIQUE` constraint guarantees that; for a key the connection declares
without a constraint, the Connector verifies it when it builds the Preview,
and a key that matches several rows makes that item `failed`. An update whose
source rows carry two different values for the same key is refused at
`check`.

Tables and content:

- **create table** — `|> CREATE [OR REPLACE] TABLE duckdb.active_usage`
  writes the rows as a whole table in the database file.
- **store** — `EFFECT STORE duckdb.files SET (path = 'exports/' || name, content = content)`
  copies the row's `content` (from `SERIALIZE` or a `contents` source) to a
  file under the connection's `root`, through DuckDB's `COPY`. The path is
  resolved under `root`; a Program cannot name a path outside it.

DuckDB has no operations: everything it does is a read, a write or a table.

## Setup

```json
"duckdb": {
  "connector": "duckdb",
  "path": "./data/sales.duckdb",
  "root": "./data",
  "read_only": false
}
```

No credentials are needed. The path is resolved relative to the configuration
file, and it must be a file the Host can open with its pinned DuckDB version;
an incompatible file is refused rather than converted. Set `read_only: true`
for a connection that only reads, so no Effect can target it. `root` is the
directory `STORE` may write files under.

On ActQL Cloud a DuckDB connection points at a database file the Cloud holds
for you; the Program is the same.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; only the referenced columns are read. |
| `WHERE` | The predicate uses columns of this source; DuckDB's SQL semantics match ActQL's for comparisons, `IN`, `LIKE`, `IS NULL` and date arithmetic. Case-insensitive collations are not used for a case-sensitive predicate. |
| `GROUP BY` with any aggregate | Always; DuckDB's exact decimal arithmetic matches ActQL's, and `float64` aggregates are declared as such. |
| `ORDER BY`, `LIMIT` | Always, with binary string order. |
| Window functions | Always, for the specifications ActQL accepts. |
| `JOIN` | When both inputs are tables of the same database file. A join with another source runs in the engine — and when the bundled DuckDB is the engine, that is DuckDB too, with Site `host:local` and Engine `DuckDB`. |

`explain` shows a pushed-down step with Site `connector:duckdb` and Engine
`DuckDB`; the two lines differ in the Site, not the Engine.

## Preview and reconciliation

**Preview.** Updates, upserts and deletes are previewed as `full_diff`: the
Connector reads the target rows by key inside a transaction, records the
current values, and the Preview shows current and new values per row. At
apply time the write runs in a transaction that re-reads the rows and compares
them with the previewed values; a row changed in between is not updated — the
item ends `failed` with `conflict`, and the Run produces a new Preview if
asked to continue. Inserts, table creations and file copies are previewed as
`targeted`: what would be written and where, with the row count or the
content identity and byte size, and for `CREATE OR REPLACE` the row count
being replaced.

**Reconciliation.** Writes run in one transaction per Effect batch, and the
Connector records the Effect item ids in a ledger table inside the same
database file (`actql_effects`) within that transaction, so the write and
its record commit together or not at all. A crash before commit leaves
nothing applied and nothing recorded; a crash after commit but before the Host
heard the reply is reconciled by reading the ledger table for the item ids —
the target table holding the expected values is not what settles it. A file
copy is recorded in the same `actql_effects` ledger before the `COPY` and
reconciled from it; the file's checksum alone is not evidence. There is no network reply to lose, so outcomes are `applied` or
`failed`; `unknown` arises only from a crash and is settled from the ledger.

## Limits and cost

- The database file is opened by the Host process. Two Hosts must not write
  the same file at the same time; the Connector takes DuckDB's file lock and
  a second writer fails to open the connection rather than corrupting it.
- Large results stay inside DuckDB until the Program needs them in the
  engine; the Program's row and byte limits apply to what crosses that
  boundary.
- Reads and writes cost nothing beyond local CPU, memory and disk; the Host's
  memory ceiling bounds how much DuckDB may hold.

## Example

Top customers by open order value:

```sql
FROM duckdb.orders
|> WHERE status = 'open'
|> AGGREGATE COUNT(*) AS order_count, SUM(amount) AS total
     GROUP BY customer_id
|> ORDER BY total DESC
|> LIMIT 20;
```

Keep a local table of model judgements current:

```sql
SELECT c.id AS customer_id, c.notes
FROM duckdb.customers AS c
|> INFER `model-task:sentiment.v1` INPUT (notes) AS s
|> WHERE s.outcome = 'ok'
|> SELECT customer_id, s.value.label AS sentiment
|> EFFECT UPSERT duckdb.customer_sentiment ID customer_id SET (sentiment = sentiment);
```

Export the result as a CSV file next to the database:

```sql
FROM duckdb.customer_sentiment
|> SERIALIZE FORMAT CSV ORDER BY customer_id
     OPTIONS (name = 'sentiment.csv', header = TRUE, null_marker = '')
|> EFFECT STORE duckdb.files SET (path = 'exports/' || name, content = content);
```
