<!-- Generated from actql/actql@d904416674e4 docs/authoring.md; do not edit. The published page is https://actql.com/docs/actql/guides/authoring -->
# Writing Programs

This guide is for anyone — a person or a coding agent — who writes ActQL
Programs. It covers the language from a plain query to a Program that reads
files, asks an LLM, writes back and runs a Connector's operation, and ends
with the habits that keep Programs checkable and safe. Read
[Concepts](https://actql.com/docs/actql/concepts/overview) first if the words Program, Run, Effect and
Checkpoint are new to you.

## A Program is SQL

A Program is written in GoogleSQL, with ActQL's own operations added for the
parts SQL has no clause for: asking a model, searching vectors, reading files,
writing back. If you know SQL, you already know most of ActQL:

```sql
SELECT c.account_id, COUNT(*) AS open_cases
FROM support.cases AS c
WHERE c.status = 'open'
GROUP BY c.account_id
ORDER BY open_cases DESC
LIMIT 10;
```

Tables are named `<connector>.<resource>`: `support.cases` is the `cases`
resource of the connection called `support`. What a connection exposes is
decided by its Connector and listed by `actql catalog show support`.

Parameters are written `@name` and supplied when the Program runs
(`--params` on the CLI, `parameters` in the libraries):

```sql
SELECT id, name FROM crm.accounts WHERE owner = @owner;
```

Not every GoogleSQL feature is accepted; [SQL compatibility](reference/sql-compatibility.md)
lists exactly what is, and `check` refuses the rest by name.

## Pipe syntax

GoogleSQL's Pipe syntax writes the same query as a sequence of steps. Start with `FROM`
(or a full `SELECT`) and introduce each later step with `|>`. Each step takes
the rows from the step before it:

```sql
FROM support.cases AS c
|> WHERE c.status = 'open'
|> AGGREGATE COUNT(*) AS open_cases GROUP BY c.account_id
|> ORDER BY open_cases DESC
|> LIMIT 10
```

`WHERE`, `SELECT`, `EXTEND`, `AGGREGATE`, `JOIN`, `ORDER BY` and `LIMIT`
below are GoogleSQL's own pipe operators; `RESULT`, `INFER`, `NEAREST`,
`SERIALIZE`, `ASSERT UNIQUE BY` and `EFFECT` are what ActQL adds, written in
the same top-to-bottom order you would explain them. You can switch to pipes
after any ordinary `SELECT`.

The steps:

| Step | Does |
| --- | --- |
| `\|> WHERE cond` | Keeps the rows for which `cond` is true |
| `\|> SELECT expr AS name, …` | Replaces the columns with the listed expressions |
| `\|> EXTEND expr AS name, …` | Adds columns, keeping the existing ones |
| `\|> AGGREGATE agg AS name, … GROUP BY cols` | Groups and aggregates (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `ARRAY_AGG`, …) |
| `\|> JOIN <table> AS t ON …` | Joins another table (`LEFT JOIN`, `INNER JOIN`, …) |
| `\|> ORDER BY cols` | Orders the rows |
| `\|> LIMIT n [OFFSET m]` | Keeps the first rows |
| `\|> RESULT name` | Publishes the rows so far as a named Result and continues |
| `\|> INFER …` | Asks a model about each row |
| `\|> NEAREST …` | Finds the nearest vectors for each row |
| `\|> SERIALIZE …` | Turns the rows into one file's content |
| `\|> ASSERT UNIQUE BY (cols)` | Fails the Run if the columns are not unique |
| `\|> EFFECT …` | Declares a write or an operation; always the last step |

`PIVOT` and the GoogleSQL window functions (`OVER`, `QUALIFY`) are available
too; see [SQL compatibility](reference/sql-compatibility.md) for the full
list.

A `FROM` can carry its joins without a pipe: `FROM a JOIN b ON … |> WHERE …`.
After the first `|>`, every further join is its own `|> JOIN` step.

## Naming intermediate rows

`WITH name AS (…)` names a query so later steps can refer to it. Naming reads
nothing and publishes nothing; it only gives the rows a name:

```sql
WITH open_cases AS (
  FROM support.cases |> WHERE status = 'open'
)
SELECT account_id, COUNT(*) AS n
FROM open_cases
GROUP BY account_id;
```

`|> RESULT name` is different: it publishes the rows as a named Result that
the caller can read after the Run (`actql result run_… --result name`,
`execution.result('name')`). A Program that only reads publishes its final
rows as the Result `main` when it declares no `RESULT`. A Program that ends
in an Effect publishes nothing unless it declares a `RESULT`; add one when
the caller should see what was written.

## Working with files

Files are read in two steps, and the steps are deliberately separate:
listing tells you what exists, and reading content is an explicit read of a
specific version. `LIST_FILES` returns one row per file with `resource`,
`version` and `path` — metadata only, nothing downloaded. The content is a
second source, `<connector>.contents`, joined on `resource` and `version`.
`LIST_FILES` names the listing source (`gcs.objects`, `drive.files`,
`local.files`); the bare connection is accepted when it has only one:

```sql
FROM LIST_FILES(gcs.objects, glob => r'invoices/*.pdf') AS f
|> JOIN gcs.contents AS c ON f.resource = c.resource AND f.version = c.version
|> SELECT f.path, f.media_type, c.content AS document
|> RESULT invoices;
```

- The join names the version, so a file replaced while the Run is in
  progress does not slip in as a different document under the same path.
- `content` is a `content_ref`: a typed reference to captured bytes with a
  media type, not a string. Reading it is bounded by the Program's byte
  limit, and a file that cannot be read whole is refused, never truncated.
- A `content_ref` can be an `INFER` input when the model task declares a
  content field of that media type ([Models and INFER](guides/models.md)).

This is how unstructured data enters a Program: the documents, PDFs,
spreadsheets and images sitting in Google Drive, S3 or GCS become rows with a
typed content reference. Hand them to `INFER` and the model's answer comes
back as typed columns — the supplier and total of each invoice, a one-line
summary of each contract, the category of each attachment — which you can
join with CRM or warehouse data and write back like any other result:

```sql
FROM LIST_FILES(gcs.objects, glob => r'invoices/*.pdf') AS f
|> JOIN gcs.contents AS c ON f.resource = c.resource AND f.version = c.version
|> INFER `model-task:invoice-fields.v1` INPUT (document = c.content) AS inv
|> WHERE inv.outcome = 'ok'
|> SELECT f.path, inv.value.supplier, inv.value.total, inv.value.due_date;
```

Files that *are* tables — CSV, Parquet, JSON lines, Iceberg — are read as
ordinary tables through a Connector that declares them, such as
[Local files](connectors/local-files.md): `FROM local.orders` gives typed
rows, not bytes.

`SERIALIZE` goes the other way: it turns the current rows into one file's
content.

```sql
FROM crm.accounts
|> SELECT id, name
|> SERIALIZE FORMAT CSV ORDER BY id
     OPTIONS (name = 'accounts.csv', header = TRUE, null_marker = '')
|> RESULT export;
```

The result is a single row with `name`, `content`, `media_type`,
`size_bytes` and `row_count`. `SERIALIZE` creates content; it uploads
nothing. Storing it somewhere is an Effect ([Writing back](#writing-back)),
and a persistent table is created with `CREATE TABLE` or
`CREATE OR REPLACE TABLE`.

## Asking a model

`INFER` gives each row to an LLM and adds a typed answer. The model, its
instructions and the types of its input and output are defined once, in a
versioned model task ([Models and INFER](guides/models.md)); the Program
refers to it by name:

```sql
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.description, active_users = u.active_users, trend = u.trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
```

- `INPUT (…)` maps the task's input fields to columns or expressions. These
  values, and nothing else, leave the Run. A column whose name already
  matches the field can be listed bare: `INPUT (notes, active_users, trend)`.
- `AS risk` names the answer. `risk.outcome` is `ok` or a failure such as
  `failed:timeout`; `risk.value` holds the typed output (`risk.value.level`,
  `risk.value.reason`) and is NULL on failure.
- The input columns stay in the row, so you can keep filtering and joining on
  them. Add `KEEP (cols)` to keep only some of them.
- Each row needs a key, so the model is asked once per item and the answers
  can be matched back. Leave `ITEM KEY` out only when the rows have exactly
  one provable unique key — `FROM` on a keyed table, or a join that keeps
  that key unique, as above. After other joins or an aggregation, name the
  key with `ITEM KEY (col)` and, if `check` cannot prove it unique, add
  `ASSERT UNIQUE BY (col)` before the `INFER`.

Always check `outcome`. Rows the model could not answer come back with the
others, so the Program decides what happens to them: filter on
`outcome = 'ok'` where only answers are useful, and keep a `RESULT` of the
failed rows where someone should see or retry them. To refuse a partial
result instead, add `ON FAILURE FAIL`: if any row is still unsuccessful after
the bounded retries, the step's result is not published, nothing reaches the
Effect, and the calls already made stay recorded.

## Searching vectors and graphs

`NEAREST` finds, for each row, the `K` closest rows of another table by
vector similarity:

```sql
SELECT c.id, c.description AS question, c.embedding AS query_vec
FROM salesforce.cases AS c
WHERE c.priority = 'urgent'
|> NEAREST kb.articles USING (query_vec) K 3 AS hit
|> AGGREGATE ARRAY_AGG(hit.body ORDER BY hit.rank) AS refs
     GROUP BY id, question
|> INFER `model-task:draft-reply.v1`
     INPUT (question, refs) AS draft
```

`hit` carries `hit.score`, `hit.rank` and, when the candidate table has a
`body` column, `hit.body`; the query columns stay in the row, and other
candidate columns are kept with `KEEP (articles.col, …)`. The search is exact
under the metric (`cosine` by default). Together with `INFER` this is
retrieval-augmented generation in one Program.

Graphs, vectors and event sequences each have their own typed carrier: a
graph is built from tables with `GRAPH (…)` and queried with `MATCH` patterns
in the style of GQL; event sequences have named operations (sessions,
windows, temporal correlation). What comes out of `MATCH`, `NEAREST` and the
event operations is rows again, so it joins and filters like any other
table. The [Syntax reference](reference/syntax.md#6-graphs) gives every
operation with its arguments.

## Writing back

An Effect is the only way a Program changes an external system. It is
declared after the row steps, is always last, and goes through policy and —
when policy asks for it — approval before anything is sent.

The `EFFECT` form names the target, the key column and the fields to set:

```sql
|> EFFECT UPDATE salesforce.Account
     ID id SET (
       Churn_Risk__c = risk.value.level,
       Risk_Reason__c = risk.value.reason
     );
```

The familiar SQL forms are the same Effect:

```sql
UPDATE salesforce.Account
SET Churn_Risk__c = 'high'
WHERE Id = @account_id;
```

Besides `UPDATE`, records can be written with `INSERT`, `UPSERT` and
`DELETE`, and content or rows are stored with `STORE`:

```sql
FROM support.cases
|> WHERE status = 'open'
|> SELECT id, subject, opened_at
|> SERIALIZE FORMAT CSV ORDER BY opened_at
     OPTIONS (name = 'open-cases.csv', header = TRUE, null_marker = '')
|> EFFECT STORE s3.objects SET (key = 'exports/' || name, content = content);
```

`STORE` takes the `content` of the current row — from `SERIALIZE`, or from a
`contents` source when a Program moves a file from one place to another —
and writes it as an object or file; pointed at a table resource, it stores
the rows themselves. The preview fixes the destination, the exact content and
whether an existing object may be replaced. Each Connector page lists what
it stores and the fields it takes.

Values in an Effect are expressions over the current row. They are evaluated
before anything is sent, and the evaluated values are what the preview shows
and the approval covers. The Pipe ends in one data-changing Effect, so a
Program that reads, judges and writes one thing is the unit you review and
resume. To notify about the same rows as well, publish them with `RESULT` and
add Command postludes after the `;` — one per notification; they and the
Effect form one Effect Set, approved at one Checkpoint
([Syntax reference](reference/syntax.md#9-effects)). Steps that must run in
order are Stages in the [Program model](https://actql.com/docs/actql/spec/language).

## Running an operation

Not every change is a record write. Sending mail, posting a message,
refreshing a Tableau extract or starting a job are **operations** a Connector
declares, and a Program runs them with `EFFECT COMMAND`:

```sql
FROM support.replies AS r
|> WHERE r.status = 'ready'
|> EFFECT COMMAND gmail.send
     ID r.id
     INPUT (to = r.recipient, subject = r.subject, body = r.body);
```

`gmail.send` is not a free-form HTTP call. It resolves to one versioned
Command contract the Connector publishes and the Host has authorized, and
that contract fixes the input fields and their types, the resource the
operation acts on, the permission it needs, what the preview shows and how
an outcome is confirmed. `check` verifies all of it before the Run.

- `ID` is the row's key. It identifies each operation in the preview, the
  status and recovery; it is not the recipient or the mailbox.
- `TARGET expr` names the resource an operation acts on when the Connector
  needs one per row (a workbook, a thread, a folder). `gmail.send` acts on
  the connection's mailbox, so it has none.
- The preview lists what each operation would do — here every recipient,
  subject and body — before anything is sent.
- An operation's outcome is `accepted` when the system took the request,
  `applied` when it confirmed the result, `unknown` when the reply was lost.
  Mail that is accepted has not necessarily been delivered. An unknown
  outcome is confirmed through the Connector, never resent on a guess.

`SERIALIZE` followed by `STORE`, or a read followed by `COMMAND`, is how a
Program composes: content is created in one explicit step and handed to the
Effect that stores or sends it.

## Limits and guards

Every Program runs under limits on rows, bytes, model calls and Effects. Most
come from the Host and the Connectors. You can add your own, called guards:
`MAX_OUTPUT_ROWS n` on a `JOIN` caps its output, and `MAX ITEMS n` on an
`INFER` caps the items sent. A guard is not a `LIMIT`: `LIMIT 10` asks for
ten rows and gets them; a guard is a ceiling the work must stay under, and
going over it stops the Run with an error. Nothing is silently truncated,
and no partial result is returned as if it were complete.

## What is refused

ActQL has no user-defined functions, loops, inline code or raw HTTP calls.
Unsupported SQL is refused at `check` time with a named reason
([check reasons](reference/check-reasons.md)), never approximated. If you need
something the language does not express, the answer is a Connector operation
or a model task, not a workaround in the query.

## Habits that pay off

These apply to people and to agents alike.

1. **`check` before `run`.** It reads no business data, calls no provider,
   and finds type and name errors with a line number.
2. **`explain` before the first real run.** It shows what will be read, what
   is pushed down, which choices are left to the Run, and where approval may
   be required.
3. **Keep `INPUT` minimal.** Only those columns reach the model; smaller
   inputs are cheaper, faster and easier to review.
4. **Check `outcome`** before reading a model's `value`, and decide what
   happens to the rows that failed.
5. **One data-changing Effect per Program, at the end.** A Program that reads,
   judges and writes one thing is easy to review and to resume; notifications
   about it are Command postludes on its Result, not a second write.
6. **Make the target identifiable.** Choose writes and operations whose
   target — a key, a resource, a version, a Command contract — the preview
   can show and recovery can check against the system.
7. **Put policy in the Host, not the Program.** A Program cannot grant itself
   permission; do not try to encode approval rules in SQL.

## Machine input

A Program can also be submitted as a JSON or YAML document — the canonical
model the SQL lowers to. Agents and tools that generate Programs may find it
convenient; people rarely need it. The [Program model](https://actql.com/docs/actql/spec/language)
defines it, and `actql check --json` reports on either form.

## Next

- [Syntax reference](reference/syntax.md): every ActQL form with its parts,
  defaults and errors.
- [CLI reference](cli.md): `check`, `explain`, `run`, `approve`, `status`.
- [Models and INFER](guides/models.md): model task files and providers.
- [Effects and approvals](guides/effects-and-approvals.md): previews,
  Checkpoints and who decides.
- [Connectors](connectors/README.md): what each system exposes, stores and
  can be asked to do.
- [SQL compatibility](reference/sql-compatibility.md): exactly which SQL is
  accepted.
