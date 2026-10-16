<!-- Generated from actql/actql@d904416674e4 docs/connectors/drive.md; do not edit. The published page is https://actql.com/docs/actql/connectors/drive -->
# Google Drive

The Google Drive Connector lists files and folders in a Drive, reads their
content and comments, uploads and replaces files, renames and moves them,
trashes them, and copies and shares them. A Program uses it to find
documents, hand their content to a model, and leave reports and exports where
people will look for them.

## Sources

- `drive.files` — files and folders the account can see: `resource`,
  `version` (the file's head revision id), `id`, `name`, `mime_type`,
  `parents` (folder ids), `size`, `owner`, `created_time`, `modified_time`,
  `web_view_link`, `trashed`, `shared`. The key is `id`. Filter by folder,
  name, MIME type or time; the Connector never lists a whole Drive.
  `LIST_FILES(drive, glob => r'Reports/*.pdf')` is the same listing by path,
  with `resource`, `version` and `path`.
- `drive.contents` — the content of a file: `resource`, `version`, `id`,
  `name`, `media_type` and `content`, a `content_ref`. Join it on `resource`
  and `version` from `drive.files` or `LIST_FILES`; the Connector downloads
  only the revisions the join names. Google Docs are exported as
  `text/plain`, Google Sheets as `text/csv`, Google Slides as
  `application/pdf`; other files are read as they are, with their own media
  type.
- `drive.comments` — comments on files: `id`, `file_id`, `author`,
  `content`, `created_time`, `resolved`, `anchor`. The key is `id`. Filter by
  `file_id`.

Because the join names a revision, a file replaced while the Run is in
progress is a different version and is never read in place of the one that
was listed.

## Types

| Drive field | ActQL | Notes |
| --- | --- | --- |
| `id`, `name`, `mime_type`, `owner`, `web_view_link` | `string` | |
| `parents` | `array<string>` | Folder ids; a file in a shared drive has one parent. |
| `size` | `int64` | Bytes. `NULL` for Google Docs, Sheets and Slides, which have no fixed size. |
| `created_time`, `modified_time` | `timestamp` | UTC, millisecond precision. |
| `version` | `string` | The head revision id; a new revision is a new `version`. |
| `trashed`, `shared`, `resolved` | `bool` | |
| `content` | `content_ref` | With `media_type`; Google formats carry the export type (`text/plain`, `text/csv`, `application/pdf`). |

## Effects and operations

Record Effects write by `id`:

- **update** — `EFFECT UPDATE drive.files ID id SET (name = …, parents = …, description = …)`
  renames, moves or describes a file. `parents` replaces the folder set.
- **delete** — `EFFECT DELETE drive.files ID id` moves the file to the trash,
  where it can be restored in Drive. To delete permanently, run
  `EFFECT COMMAND drive.purge TARGET id ID key` on a trashed file.

Content:

- **upload** — `EFFECT STORE drive.files SET (folder = …, name = …, content = content [, overwrite = TRUE])`
  creates a file in a folder from the row's `content` (a `content_ref` from
  `SERIALIZE` or from a `contents` source). With `overwrite = TRUE` an
  existing file of that name in the folder is replaced as a new revision;
  without it, an existing file makes the item `failed`.

Operations:

- **copy** — `EFFECT COMMAND drive.copy TARGET id ID key INPUT (folder = …, name = …)`
  copies a file into a folder.
- **share** — `EFFECT COMMAND drive.share TARGET id ID key INPUT (email = …, role = 'reader' | 'commenter' | 'writer', notify = FALSE)`
  grants a permission on a file.
- **purge** — `EFFECT COMMAND drive.purge TARGET id ID key` deletes a
  trashed file permanently.

`TARGET` is the file the operation acts on and `ID` the row's key, which
identifies each operation in the Preview and the status.

## Setup

```json
"drive": {
  "connector": "drive",
  "credentials": {"service_account": {"env": "GOOGLE_SERVICE_ACCOUNT_JSON"}}
}
```

Share the folders a Program reads with the service account (viewer) and the
folders it writes to (editor); sharing a file with others requires the
account to own it or hold `writer` with sharing allowed. The account needs
the `https://www.googleapis.com/auth/drive` scope, or `drive.readonly` for a
connection that only reads. Shared drives work when the account is a member.
An OAuth refresh token for a single user can be supplied instead of a service
account. On ActQL Cloud, hosted Google OAuth signs the user in and stores the
grant; the same connection fields apply otherwise.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; the Connector requests only the fields a Program uses. |
| `WHERE` on `drive.files` | The predicate uses `name` (equality, `LIKE 'prefix%'`, contains), `mime_type`, `parents` (`IN UNNEST`), `modified_time`/`created_time` comparisons, `trashed`, `shared` or `owner` — Drive's query language evaluates these with the same meaning. Case-insensitive name matching is Drive's behaviour, so a case-sensitive name predicate is re-checked by the Host. |
| `WHERE` on `drive.comments` | `file_id` and `resolved`. |
| `ORDER BY`, `LIMIT` | `name`, `modified_time`, `created_time`, `size`; the limit becomes the page size. |
| Content reads | Per file, after the listing has selected it; never a bulk export. |
| Aggregation, `JOIN` | Never; they run on the Host. |

## Preview and reconciliation

**Preview.** Updates and deletes are `full_diff`: the Connector reads the
file's current metadata (name, parents, description, trashed state) and
revision id, the Preview shows current and new values, and the request is
conditioned on that revision. A file changed in between makes the item
`failed` with `conflict`, never a silent overwrite. Uploads are `targeted`:
the Preview shows the folder, the file name, the media type, the size and the
content identity of what would be written, and whether an existing file would
be replaced (and which revision). Copies and shares preview the source file,
the destination or grantee, and the role.

**Reconciliation.** Every upload and copy carries a request marker in the
file's `appProperties`. Uploads use resumable sessions whose upload URI the
Connector keeps until the reply arrives. A lost reply is reconciled by
querying the session's status, then by listing the folder for a file whose
`appProperties` carry the marker and whose `md5Checksum` matches the approved
content identity; an update, delete or share is reconciled through the Drive
Activity log: an action by this connection's account in the request window
that produced the approved change settles the outcome, while the file merely
holding the approved values or a newer revision does not. A file with the right name but
no marker is not evidence. Without evidence the item stays `unknown` and
nothing is resent. Operations end `applied` once Drive confirms them; a copy
of a large file is `accepted` while Drive finishes it.

## Limits and cost

- Listing is paged 100 files at a time, within the Program's row limit.
- Content reads are bounded by the Program's byte limit; a large export is
  refused rather than truncated. Google Docs export as plain text without
  formatting, images or comments; Sheets export as CSV of the first sheet
  unless the Program names a sheet range through the Sheets Connector.
- Drive's per-user and per-project query quotas apply; the Connector paces
  within them and fails a Program that would exceed its daily quota before
  sending.
- Uploads larger than 5 MB use resumable sessions; the Drive storage quota of
  the owning account applies. Drive itself charges nothing per request.

## Example

Documents in a folder modified this week:

```sql
FROM drive.files
|> WHERE 'FOLDER_ID' IN UNNEST(parents)
     AND modified_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
     AND NOT trashed
|> SELECT name, modified_time, web_view_link
|> ORDER BY modified_time DESC;
```

Summarise each document with a model and upload the summaries as one file:

```sql
FROM drive.files AS f
|> WHERE 'FOLDER_ID' IN UNNEST(f.parents) AND f.mime_type = 'application/vnd.google-apps.document'
|> JOIN drive.contents AS c ON f.resource = c.resource AND f.version = c.version
|> INFER `model-task:summarise-doc.v1` INPUT (name = f.name, document = c.content) AS s
|> WHERE s.outcome = 'ok'
|> SELECT f.name, s.value.summary AS summary
|> SERIALIZE FORMAT CSV ORDER BY name OPTIONS (name = 'summaries.csv', header = TRUE, null_marker = '')
|> EFFECT STORE drive.files SET (folder = 'FOLDER_ID', name = name, content = content, overwrite = TRUE);
```

Move last quarter's reports into an archive folder:

```sql
FROM drive.files
|> WHERE 'REPORTS_FOLDER' IN UNNEST(parents) AND modified_time < '2026-07-01'
|> EFFECT UPDATE drive.files ID id SET (parents = ['ARCHIVE_FOLDER']);
```
