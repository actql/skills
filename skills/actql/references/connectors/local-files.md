<!-- Generated from actql/actql@84d4ef5bff33 docs/connectors/local-files.md; do not edit. The published page is https://actql.com/docs/actql/connectors/local-files -->
# Local files

The Local files Connector reads CSV, Parquet, JSON-lines and Iceberg tables
from the file system, lists and reads files as content, writes tables and
files back, creates new tables, deletes and moves files. It is the Connector
for data that is already on the machine — exports, fixtures, the output of
other tools — and for Programs you develop before pointing them at a
warehouse. Everything it does runs on the Host itself: its Site is always
`host:local`.

## Sources

Each table you declare in the connection is a source: `local.orders`,
`local.customers`. A table is a file (or a directory of files with the same
schema) and a format:

- **CSV** — the header row gives column names; types are declared in the
  connection or inferred from a sample and then fixed.
- **Parquet** — columns and types come from the file.
- **JSON lines** — one object per line; columns and types are declared.
- **Iceberg** — a table in an Iceberg catalog directory; columns and types
  come from the table's metadata, and reads are pinned to a snapshot.

A table's key is the one declared in the connection (`"key": ["id"]`); a
table without a declared key has none, and Effects that need one are refused
at `check`.

Files are sources too, independent of any table declaration:

- `local.files` — files under the root: `resource`, `version` (a hash of
  size and modification time, or the file's content hash when the connection
  sets `"version": "content"`), `path`, `size` and `modified_time`.
  `LIST_FILES(local, glob => r'inbound/*.pdf')` is the same listing by path;
  the bare connection is valid because it is the connection's only listing
  source.
- `local.contents` — the content of files: `resource`, `version`, `path`,
  `media_type` (from the extension, overridable in the connection) and
  `content`, a `content_ref`. Join it on `resource` and `version` from
  `LIST_FILES`.

A path can also point into a bucket (`gs://…`, `s3://…`) when the
corresponding storage Connector is configured; the file is read through it.

## Types

| Format | ActQL | Notes |
| --- | --- | --- |
| CSV | declared types, or inferred from a sample and then fixed | `string`, `int64`, `float64`, `decimal(p, s)`, `bool`, `date`, `timestamp`; an unparseable cell fails the read, never becomes `NULL`. |
| Parquet logical types | `int32`/`int64` → `int64`; `float`/`double` → `float64`; `decimal` → `decimal(p, s)`; `string`/`enum` → `string`; `date` → `date`; `timestamp` with zone → `timestamp`, without zone → `datetime`; `list` → `array<…>`; `struct`/`map` → `json` | Nanosecond timestamps keep their precision. |
| JSON lines | declared types | A declared `json` column keeps nested values as typed JSON. |
| Iceberg | the table's types, by the same mapping as Parquet | `uuid` → `string`, `fixed`/`binary` → `bytes`. |
| File metadata | `path` → `string`, `size` → `int64`, `modified_time` → `timestamp`, `content` → `content_ref` | |

## Effects and operations

Tables:

- **store rows** — `EFFECT STORE local.<table>` writes the Program's rows to
  a declared table: a CSV, Parquet or JSON-lines table is replaced by the
  rows; an Iceberg table gets them appended as one snapshot. The table's path
  and format come from the connection, not from the Program.
- **create table** — `|> CREATE [OR REPLACE] TABLE local.<name>` writes the
  rows as a new table under the root, in the connection's default format
  (`"default_format": "parquet"`), and declares it so later Programs can read
  it. `CREATE` fails if the table exists; `CREATE OR REPLACE` replaces it.
- **delete rows** — `EFFECT DELETE local.<table> ID key` removes rows by the
  table's declared key; CSV, Parquet and JSON Lines tables are rewritten
  without them, an Iceberg table gets one delete snapshot.

Files:

- **write file** — `EFFECT STORE local.files SET (path = …, content = content [, overwrite = TRUE])`
  writes the row's `content` (from `SERIALIZE` or a `contents` source) to a
  path under the root.
- **delete file** — `EFFECT DELETE local.files ID path` removes a file.

Operations:

- **move** — `EFFECT COMMAND local.move TARGET path ID key INPUT (destination = …)`
  renames or moves a file under the root; the destination must not exist
  unless `overwrite = TRUE` is also given.

Paths are resolved under `root`; a Program cannot name a path outside it, and
neither can an Effect.

## Setup

```json
"local": {
  "connector": "local",
  "root": "./data",
  "default_format": "parquet",
  "tables": {
    "orders": {"path": "orders.parquet", "key": ["id"]},
    "customers": {"path": "customers.csv", "key": ["id"], "columns": {
      "id": "string", "name": "string", "segment": "string", "signed_up": "date"
    }},
    "events": {"path": "warehouse/events", "format": "iceberg"},
    "customer_segments": {"path": "out/customer_segments.parquet", "key": ["id"]}
  }
}
```

No credentials are needed. `root` is relative to the configuration file. The
Host process needs read access under the root for sources and write access
for Effects; nothing else is required. On ActQL Cloud a `local` connection
refers to the Cloud worker's own storage and is scoped the same way.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Parquet and Iceberg read only the columns a Program uses; CSV and JSON lines are parsed whole and projected in the engine. |
| `WHERE` | Parquet row groups and Iceberg files whose statistics rule the predicate out are skipped; the predicate itself is evaluated in the engine, so there is no residual. |
| `ORDER BY`, `LIMIT` | In the engine; a `LIMIT` on a CSV read stops parsing once the rows are found. |
| Aggregation, `JOIN` | In the engine, or in DuckDB when the package bundles it — the Site is the same `host:local` either way. |

## Preview and reconciliation

**Preview.** Table stores and file writes are `targeted`: the Preview shows
the table (or path), its format, the row count or the content identity and
byte count, and whether an existing file would be replaced. Deletes and moves
are `full_diff`: the current file's size, modification time and checksum are
read and shown, and the operation is conditioned on them, so a file changed
in between makes the item `failed` with `conflict`. An Iceberg append names
the snapshot it would follow and fails if another writer committed first.

**Reconciliation.** Writes go to a temporary file and are renamed into place,
so a crash never leaves a half-written file; an Iceberg append commits one
snapshot. There is no lost reply with local files, but a crash between the
rename and its record is possible. Before the rename the Connector journals the
item (id, destination, content identity) under the root; reconciliation
reads that journal and, for Iceberg, the snapshot summary carrying the
Effect's id. A file whose checksum happens to match, or the absence of a
file, is not evidence on its own. A file at the destination with another checksum is not evidence;
the item stays `unknown` and nothing is rewritten.

## Limits and cost

- Files are read at the start of a Run and pinned: a file changed during the
  Run is not re-read, and an Iceberg read stays on its snapshot.
- Reads are bounded by the Program's row and byte limits; a file larger than
  the byte limit is refused rather than truncated.
- Two Hosts must not write under the same root at the same time; the
  Connector takes an advisory lock per table while it writes.
- There is no external charge; the limits are the machine's disk and memory,
  and the Host's capacity policy.

## Example

Order totals per customer segment:

```sql
FROM local.orders AS o
JOIN local.customers AS c ON o.customer_id = c.id
|> WHERE o.status = 'open'
|> AGGREGATE COUNT(*) AS orders, SUM(o.amount) AS total GROUP BY c.segment
|> ORDER BY total DESC;
```

Classify customers from their notes and write the result as a Parquet table:

```sql
FROM local.customers
|> INFER `model-task:segment.v1` INPUT (name, notes) AS seg
|> WHERE seg.outcome = 'ok'
|> SELECT id, seg.value.segment AS segment
|> EFFECT STORE local.customer_segments;
```

Archive the inbound files that a Run has processed:

```sql
FROM LIST_FILES(local, glob => r'inbound/*.csv') AS f
|> WHERE f.modified_time < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
|> EFFECT COMMAND local.move TARGET path ID path INPUT (destination = 'archive/' || path);
```
