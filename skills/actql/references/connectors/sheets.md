<!-- Generated from actql/actql@747e5c2771ca docs/connectors/sheets.md; do not edit. The published page is https://actql.com/docs/actql/connectors/sheets -->
# Google Sheets

The Google Sheets Connector reads a declared range of a spreadsheet as a typed
table, appends, updates, upserts and deletes rows by a key column you declare,
replaces a range with a result, creates sheets and clears ranges. Spreadsheets
are where a lot of business data actually lives — lists people maintain by
hand, exports, lookup tables — and a Program can read them like any other
source and write results back where people will see them.

## Sources

Each sheet you declare in the connection is a source: `sheets.accounts`,
`sheets.pricing`. A source is one rectangle of one sheet — a tab and a range —
with a header row, typed columns and a **declared key column**. Row numbers
are not identifiers: they change when someone sorts, inserts or deletes rows,
so the Connector never uses them as a key. A sheet without a key column is
readable and appendable, and cannot be the target of an update, upsert or
delete.

Blank rows inside the range are skipped; a cell error (`#REF!`, `#N/A`, …)
in the range fails the read rather than becoming NULL. Formulas are read by
their computed value.

- `sheets.<sheet>` — the declared range, one row per spreadsheet row, with
  the declared columns and types. Key: the declared key column.
- `sheets.sheets` — the tabs of the spreadsheet: `id`, `title`, `index`,
  `row_count`, `column_count`. Key `id`.

## Types

| Sheets | ActQL | Notes |
| --- | --- | --- |
| text (declared `string`) | `string` | Leading `'` and formatting are not part of the value. |
| number (declared `number`) | `decimal` | Exact as entered; a formatted percentage is its underlying fraction. |
| number (declared `integer`) | `int64` | A cell with a fraction fails `check`'s type test for that read. |
| boolean | `bool` | |
| date / datetime (declared `date`, `datetime`) | `date`, `datetime` | Serial values converted; the spreadsheet's time zone applies to `datetime`. |
| formula | its computed value's type | Never the formula text. |
| error cell | — | Fails the read. |

Writes convert in the other direction with the same rules: numbers and dates
are written as values, text is written as text — never as a formula, even
when it begins with `=`.

## Effects and operations

Record Effects write by the declared key:

- **insert** — `EFFECT INSERT sheets.<sheet> (col, …)` appends rows after the
  last row of the declared range at the time of sending.
- **update** — `EFFECT UPDATE sheets.<sheet> ID key SET (…)` sets cells of
  the row whose key column holds `key`.
- **upsert** — `EFFECT UPSERT sheets.<sheet> ID key SET (…)` updates that
  row, or appends it when no row has the key.
- **delete** — `EFFECT DELETE sheets.<sheet> ID key` removes the row.

The Connector locates the row by key at apply time, not by the row number it
had when the Preview was built; a key that matches several rows makes the
item `failed`, never a change to the first match.

Tables and content:

- **replace** — `EFFECT STORE sheets.<sheet>` replaces the declared range
  (below the header) with the current rows.
- **new sheet** — `EFFECT STORE sheets.sheets SET (title = …)` creates a tab
  with the current rows and a header row from their column names.

Operations:

- **clear_range** — `EFFECT COMMAND sheets.clear_range TARGET range ID key`
  clears the cells of a range such as `'Review log'!A2:F`; values are
  removed, formatting stays.

## Setup

```json
"sheets": {
  "connector": "sheets",
  "spreadsheet_id": "1AbC…",
  "sheets": {
    "accounts": {"tab": "Accounts", "range": "A1:G", "key": "id", "columns": {
      "id": "string", "name": "string", "owner": "string", "notes": "string",
      "plan": "string", "seats": "number", "active": "boolean"
    }},
    "review_log": {"tab": "Review log", "range": "A1:D", "key": "account", "columns": {
      "account": "string", "level": "string", "reason": "string", "reviewed_at": "datetime"
    }}
  },
  "credentials": {"service_account": {"env": "GOOGLE_SERVICE_ACCOUNT_JSON"}}
}
```

Share the spreadsheet with the service account: viewer to read, editor to
write. The account needs the `spreadsheets.readonly` scope for reading and
`spreadsheets` for writing; `drive.file` is needed as well to read the
spreadsheet's revision history for reconciliation. A sheet a Program writes
to should be a tab people do not edit by hand while a Run is waiting for
approval. On ActQL Cloud, hosted OAuth signs the account in without a service
account; the same scopes are requested.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; the Connector requests only the declared columns of the declared range. |
| `WHERE` | Never; Sheets has no filter API, so every predicate runs on the Host. |
| `ORDER BY`, `LIMIT` | Never; both run on the Host. |
| `AGGREGATE`, `JOIN` | Never; both run on the Host. |

`explain` shows the read with Site `connector:sheets` and Engine `Sheets
API`, and every later step on the Host.

## Preview and reconciliation

**Preview.** Updates, upserts of an existing row and deletes are `full_diff`:
the Connector reads the row by key, records its current values and the
spreadsheet's revision id, and the Preview shows current and new values. At
apply time it reads the row by key again; a row whose values changed, that
moved to another row number, or that no longer exists makes the item
`failed` with `conflict`, and the Run produces a new Preview if asked to
continue. Appends, upserts that append, range replacements and new sheets are
`targeted`: the Preview lists every row that would be written and where. A
sheet has no "current value" for a row that does not exist yet.

**Reconciliation.** Every batch the Connector writes carries the request's
marker as developer metadata on the written rows (Sheets keeps developer
metadata with the row when rows are sorted or moved). A lost reply is
reconciled by searching the spreadsheet's developer metadata for **that
marker**; rows with the expected values but no marker are not evidence, and
the spreadsheet's revision history is read to confirm that the write landed
within the request's window. A clear writes the marker as developer metadata on the
cleared range in the same batch and is reconciled by it; without it the
item stays `unknown`. When none of this settles the outcome, the item stays `unknown` and
the batch is never resent.

## Limits and cost

- A source range is bounded: the Connector reads at most the Program's row
  limit, and a range larger than that fails rather than being cut short.
- The Sheets API limits requests per minute per project and per user; the
  Connector paces within them, and writes go in batches of rows so a large
  Effect is a few requests, not one per row.
- Concurrent edits by people are the main source of `conflict` outcomes; a
  Run that waits for approval while people edit the same rows should expect
  them.
- A spreadsheet holds at most 10 million cells; a range replacement that
  would exceed it fails before anything is written.

## Example

Accounts on a paid plan with no owner:

```sql
FROM sheets.accounts
|> WHERE plan != 'free' AND owner IS NULL AND active
|> SELECT id, name, plan, seats
|> ORDER BY seats DESC;
```

Keep a review log current, one row per account:

```sql
SELECT a.name AS account, risk.value.level AS level, risk.value.reason AS reason
FROM sheets.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.notes, active_users = u.active_users, trend = u.trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> EXTEND CURRENT_DATETIME() AS reviewed_at
|> EFFECT UPSERT sheets.review_log ID account SET (level = level, reason = reason, reviewed_at = reviewed_at);
```

Fill in the owner of every account from the CRM:

```sql
FROM sheets.accounts AS s
|> WHERE s.owner IS NULL
|> JOIN salesforce.accounts AS a ON s.id = a.id
|> EFFECT UPDATE sheets.accounts ID s.id SET (owner = a.owner_email);
```
