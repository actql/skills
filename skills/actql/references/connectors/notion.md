<!-- Generated from actql/actql@747e5c2771ca docs/connectors/notion.md; do not edit. The published page is https://actql.com/docs/actql/connectors/notion -->
# Notion

The Notion Connector reads databases, pages and page content from a workspace,
and writes pages, properties and blocks back. A Program uses it to keep a
database in step with other systems — a task per high-risk account, a status
that follows a CRM record — and to read the text people wrote in Notion.

## Sources

- `notion.<database>` — each database shared with the integration is a
  source, named by the alias you give it in the connection (`notion.tasks`).
  Columns are the database's properties plus `id` (the page id), `url`,
  `created_time`, `created_by`, `last_edited_time` and `last_edited_by`. The
  key is `id`; a database can also declare one of its properties as a
  unique key for `UPSERT` (see [Effects](#effects-and-operations)).
- `notion.pages` — every page the integration can see, inside or outside a
  database: `id`, `title`, `parent` (a database or page id), `url`,
  `archived`, created and edited times, plus `resource` (the page id) and
  `version` (its `last_edited_time`) for joining `notion.contents`. Key
  `id`. Database sources carry the same `resource` and `version`.
- `notion.users` — workspace members and bots: `id`, `name`, `type`, `email`
  (people, when the integration may read it). Key `id`.
- `notion.contents` — the content of a page as a `content_ref`: `resource`,
  `version` (the page's `last_edited_time`), `media_type` (`text/markdown`)
  and `content`. Join it on `resource` and `version` from `notion.pages` or a
  database source; the Connector fetches only the pages the join names, and
  renders blocks to Markdown.
- `notion.files` — files and images attached to pages and file properties:
  `resource`, `version`, `page_id`, `name`, `media_type`, `size`; their bytes
  come through `notion.contents` the same way.

## Types

| Notion property | ActQL | Notes |
| --- | --- | --- |
| title, rich text | `string` | Rich text is flattened to plain text on read and written as plain rich text. Formatting is not preserved. |
| number | `decimal` | Notion stores numbers as double precision; the Connector reads them as decimals with the property's declared format. |
| select, status | `string` | The option's name. Writing an unknown option fails `check` when the options are known, otherwise the item. |
| multi-select | `array<string>` | |
| date | `date` or `timestamp` with optional `end` | A date range is read as `start`/`end` columns; a date without time is a `date`. Notion keeps the time zone the user chose; the Connector reads it as an offset. |
| checkbox | `bool` | |
| people, created_by, last_edited_by | `array<string>` / `string` | User ids. Names come from `notion.users`. |
| relation | `array<string>` | Related page ids; join on them against the related database. |
| rollup, formula | the computed type | Read only. |
| url, email, phone_number | `string` | |
| files | `array<content_ref>` | Each file is readable through `notion.contents`. |
| unique_id | `string` | Prefix and number as one string. Read only. |
| created_time, last_edited_time | `timestamp` | |

## Effects and operations

Record Effects write pages of a database by key:

- **insert** — `EFFECT INSERT notion.tasks (title, status, notes) VALUES (…)`
  creates a page with those properties.
- **update** — `EFFECT UPDATE notion.tasks ID id SET (status = 'Done')`.
- **upsert** — `EFFECT UPSERT notion.tasks ID external_id SET (…)`, keyed
  by a property the connection declares unique for that database (a text,
  number or unique_id property). The Connector verifies uniqueness when it
  builds the Preview; a key that matches several pages makes the item
  `failed`.
- **delete** — `EFFECT DELETE notion.tasks ID id` archives the page. Notion
  has no permanent delete through the API; an archived page can be restored
  in Notion, and `notion.pages` shows it with `archived = TRUE`.

The key named by `ID` must identify exactly one page: `id` always does; a
declared unique property does once verified.

Content:

- **store** — `EFFECT STORE notion.blocks SET (page = id, content = content)`
  appends a file or image block to a page from the row's `content` (a
  `content_ref` from `SERIALIZE` or a `contents` source).

Operations:

- **append_blocks** — `EFFECT COMMAND notion.append_blocks TARGET page_id ID key INPUT (markdown = text)`
  appends blocks rendered from Markdown to the end of a page.

## Setup

```json
"notion": {
  "connector": "notion",
  "databases": {
    "tasks": {"id": "a1b2c3d4-…", "unique": "external_id"},
    "accounts": "e5f6a7b8-…"
  },
  "credentials": {"integration_token": {"env": "NOTION_TOKEN"}}
}
```

Create an internal integration in Notion and share each database and page
tree with it; an integration sees only what has been shared. The `databases`
map gives each database id a name to use in Programs and, optionally, the
property that is unique for `UPSERT`. Reading needs the integration's read
content capability; writing needs insert and update content; `notion.users`
needs read user information. On ActQL Cloud a public Notion integration is
offered through hosted OAuth where approved; the same internal integration
token works there too.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; a database query returns whole pages, so projection reduces what the engine keeps, not what Notion sends. |
| `WHERE` | The predicate is on one database's properties with operators Notion's filter supports exactly: equality and inequality on select, status, checkbox, number and date; range comparisons on number and date; `IS NULL` / `IS NOT NULL` (empty / not empty); `LIKE 'x%'`, `'%x'` and `'%x%'` on text (starts with, ends with, contains — case-insensitive in Notion, so a case-sensitive predicate stays on the Host). |
| `ORDER BY` | On properties Notion can sort, when the Program does not depend on binary collation. |
| `LIMIT` | Always, through page size and cursor. |
| `GROUP BY`, `JOIN` | Never; they run on the Host. |

## Preview and reconciliation

**Preview.** Updates, upserts and archives are `full_diff`: the Connector
reads each target page, records its properties and `last_edited_time`, and
the Preview shows current and new values per property. At apply time the
page is read again; if `last_edited_time` moved, the item is not written —
it ends `failed` with `conflict`, and the Run produces a new Preview if
asked to continue. Inserts, `STORE` and `append_blocks` are `targeted`: the
Preview shows the database or page and the exact properties, file or blocks
that would be written.

**Reconciliation.** Every write carries a request marker. For a database that
declares a marker property in its connection entry (`"marker": "actql_request"`),
the marker is written into that property and a lost reply is reconciled by
querying the database for it. Without a declared marker property the
Connector has nothing it can recognise, so the item stays `unknown` and
nothing is resent. `append_blocks`
and `STORE` leave a marker in the appended block's content and reconcile by
reading the page's children. An operation ends `accepted` when Notion
returned the created block ids, `applied` once the page read-back shows
them.

## Limits and cost

- Notion allows about three requests per second per integration; the
  Connector paces within that and queues writes.
- Reads are paged 100 pages at a time. A database of thousands of rows is
  read in many requests, within the Program's row limit; the read stops with
  an error rather than a partial result when the limit is reached.
- Page content is fetched one page per request (100 blocks a time); nested
  blocks need one request per level. The Program's byte limit applies to the
  rendered Markdown.
- Database schema changes (a renamed property) make `check` fail by name
  until the Program or the alias is updated.
- Notion's API has no fee; its rate limit is the cost.

## Example

Overdue tasks by owner:

```sql
FROM notion.tasks
|> WHERE status != 'Done' AND due < CURRENT_DATE()
|> AGGREGATE COUNT(*) AS overdue GROUP BY owner
|> ORDER BY overdue DESC;
```

Keep one task per high-risk account, creating or updating it by the
account's id:

```sql
SELECT a.id AS external_id, a.name, risk.value.reason AS reason
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.description, active_users = u.active_users, trend = u.trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> EFFECT UPSERT notion.tasks ID external_id
     SET (title = CONCAT('Call ', name), status = 'To do', notes = reason);
```

Summarise a meeting page and append the summary to it:

```sql
FROM notion.pages AS p
|> WHERE p.parent = @meeting_notes_db AND p.created_time >= CURRENT_DATE()
|> JOIN notion.contents AS c ON p.resource = c.resource AND p.version = c.version
|> INFER `model-task:summarise-doc.v1` INPUT (name = p.title, document = c.content) AS s
|> WHERE s.outcome = 'ok'
|> EFFECT COMMAND notion.append_blocks TARGET p.id ID p.id
     INPUT (markdown = CONCAT('## Summary\n', s.value.summary));
```
