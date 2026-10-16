<!-- Generated from actql/actql@d904416674e4 docs/connectors/gcs.md; do not edit. The published page is https://actql.com/docs/actql/connectors/gcs -->
# Google Cloud Storage

The Google Cloud Storage Connector lists objects in a bucket, reads their
contents, writes and replaces objects, changes their metadata, deletes them,
and copies and composes them. It is how a Program picks up files other
systems drop in a bucket, and how it leaves exports behind.

## Sources

- `gcs.objects` — objects in the bucket: `resource`, `version` (the
  generation), `name`, `size`, `content_type`, `generation`,
  `metageneration`, `storage_class`, `updated`, `md5`, `crc32c`, `metadata`
  (custom metadata as a JSON object). The key is `name`. Filter by prefix to
  list one "folder". `LIST_FILES(gcs, glob => r'inbound/*.csv')` is the same
  listing by path, with `resource`, `version` and `path`.
- `gcs.contents` — the content of objects: `resource`, `version`, `name`,
  `media_type` and `content`, a `content_ref`. Join it on `resource` and
  `version` from the listing; the Connector reads only the generations the
  join names. The rows of a CSV, Parquet or JSON-lines object are available
  as a typed table through the [Local files](https://actql.com/docs/actql/connectors/local-files) Connector's
  table sources when you point one at a `gs://` path.

`version` is the object's generation, so a Program reads exactly the bytes it
listed even if the object was overwritten in between.

## Types

| GCS field | ActQL | Notes |
| --- | --- | --- |
| `name`, `content_type`, `storage_class`, `md5`, `crc32c` | `string` | Checksums are base64 as GCS returns them. |
| `size` | `int64` | Bytes. |
| `generation`, `metageneration` | `int64` | `version` is the generation as a string. |
| `updated` | `timestamp` | UTC. |
| `metadata` | `json` | Custom `x-goog-meta-*` entries as an object of strings. |
| `content` | `content_ref` | With `media_type` from `content_type`. |

## Effects and operations

Record Effects write by `name`:

- **update** — `EFFECT UPDATE gcs.objects ID name SET (content_type = …, storage_class = …, metadata = …)`
  rewrites the object's metadata or storage class without changing its
  content. A storage class change is a rewrite in place that produces a new
  generation.
- **delete** — `EFFECT DELETE gcs.objects ID name` deletes the object
  (the generation it was previewed at).

Content:

- **upload** — `EFFECT STORE gcs.objects SET (name = …, content = content [, content_type = …, overwrite = TRUE])`
  creates an object from the row's `content` (a `content_ref` from
  `SERIALIZE` or from a `contents` source). Without `overwrite` the write
  requires that no object of that name exists; with it, the write replaces
  the generation seen in the Preview.

Operations:

- **copy** — `EFFECT COMMAND gcs.copy TARGET name ID key INPUT (destination = 'other-bucket/path/file.csv')`
  copies an object, within the bucket or to another bucket the account can
  write.
- **compose** — `EFFECT COMMAND gcs.compose TARGET destination ID key INPUT (sources = ['part-1.csv', 'part-2.csv'])`
  concatenates up to 32 objects into one.

## Setup

```json
"gcs": {
  "connector": "gcs",
  "bucket": "acme-exports",
  "prefix": "actql/",
  "credentials": {"service_account": {"env": "GOOGLE_SERVICE_ACCOUNT_JSON"}}
}
```

The service account needs `storage.objects.list` and `storage.objects.get`
to read, `storage.objects.create` to upload, `storage.objects.update` to
change metadata, and `storage.objects.delete` to delete or replace;
`roles/storage.objectViewer` and `roles/storage.objectAdmin` cover these.
`prefix` limits the connection to part of the bucket: a Program cannot name an
object outside it. Workload identity or an attached service account can be
used instead of a key file by omitting `credentials`. On ActQL Cloud the key
is stored in the Cloud's secret store; the connection fields are the same.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; only the requested fields are asked for. |
| `WHERE` on `gcs.objects` | The predicate is a prefix on `name` (`LIKE 'inbound/%'`) — GCS lists by prefix. Other metadata predicates run on the Host over the listing. |
| `ORDER BY name`, `LIMIT` | Listing order is by name; the limit becomes the page size. |
| Content reads | Per object, by generation, after the listing has selected it. |
| Aggregation, `JOIN` | Never; they run on the Host. |

## Preview and reconciliation

**Preview.** Metadata updates and deletes are `full_diff`: the Connector
reads the object's metadata, records its generation and metageneration, and
the Preview shows current and new values; the request is sent with
`ifGenerationMatch` and `ifMetagenerationMatch`, so an object changed in
between makes the item `failed` with `conflict`. Uploads are `targeted`: the
Preview shows the object name, media type, byte count and content identity
(`crc32c`) that would be written, and the generation it would replace or the
requirement that none exists. Copies and composes preview the sources, the
destination and whether it would be replaced.

**Reconciliation.** The Connector binds each item to the object it writes
and the checksum of the approved content. Every upload, compose and
metadata update carries the request's marker in the object's custom metadata
(`x-goog-meta-actql-request`). A lost reply is reconciled by reading the
destination's metadata for **that marker**; a matching `crc32c` or matching
fields without it are not evidence. A delete leaves no marker, so a lost
reply to a delete stays `unknown`. A
resumable upload keeps its session URI, so an interrupted upload is queried
before anything else. Evidence that does not match the approved identity is
not evidence; the item stays `unknown` and nothing is resent. Operations end
`applied` when GCS confirms them; a cross-bucket copy of a large object runs as
a rewrite and is `accepted` until its last chunk is confirmed.

## Limits and cost

- Listing is paged 1,000 objects at a time, within the Program's row limit.
- Contents are bounded by the Program's byte limit; a large object is refused
  rather than partially read. Integrity is checked against the object's
  checksum on every read.
- Uploads above 8 MiB use resumable sessions; a single object may be up to
  5 TiB. `compose` takes at most 32 source objects per call.
- GCS charges per operation class (list and get are class B, create and
  rewrite class A), for storage, and for egress out of the region; the
  Connector's requests are ordinary billed operations.

## Example

Yesterday's uploads:

```sql
FROM gcs.objects
|> WHERE name LIKE 'inbound/%' AND updated >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
|> SELECT name, size, updated
|> ORDER BY updated DESC;
```

Export high-risk accounts as a JSON-lines object:

```sql
SELECT a.id, a.name, risk.value.level AS level, risk.value.reason AS reason
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (a.description AS notes, u.active_users, u.trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> SERIALIZE FORMAT JSONL ORDER BY id OPTIONS (name = 'high-risk.jsonl')
|> EFFECT STORE gcs.objects SET (name = 'exports/' || name, content = content, overwrite = TRUE);
```

Read the invoices that arrived as PDFs and let a model extract their fields:

```sql
FROM LIST_FILES(gcs, glob => r'invoices/*.pdf') AS f
|> JOIN gcs.contents AS c ON f.resource = c.resource AND f.version = c.version
|> INFER `model-task:invoice-fields.v1` INPUT (document = c.content) AS inv
|> WHERE inv.outcome = 'ok'
|> SELECT f.path, inv.value.supplier, inv.value.total, inv.value.due_date;
```

Move processed inbound files to cold storage:

```sql
FROM gcs.objects
|> WHERE name LIKE 'inbound/processed/%' AND storage_class = 'STANDARD'
|> EFFECT UPDATE gcs.objects ID name SET (storage_class = 'COLDLINE');
```
