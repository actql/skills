<!-- Generated from actql/actql@747e5c2771ca docs/reference/syntax.md; do not edit. The published page is https://actql.com/docs/actql/reference/syntax -->
# Syntax reference

A Program is GoogleSQL with Pipe syntax. This page is the one place that
lists every form of that text: how a Program is put together, the Pipe
operators (GoogleSQL's own and the ones ActQL adds), the named calls for
vectors, graphs and events, `INFER`, `NEAREST`, `SERIALIZE` and the Effects.
Ordinary SQL (`SELECT`, joins, the scalar functions) is on
[SQL compatibility](sql-compatibility.md) and
[Types and functions](types-and-functions.md). Which forms run today in each
environment is on [Implementation status](status.md).

Each entry gives the **form** (`[ ]` optional, `…` repetition, keywords in
upper case), its **parts**, its **meaning**, its **defaults**, one minimal
**example** that passes `check`, the **errors** `check` reports, and the
**spec** section that defines it. The examples assume the connections of the
[Quickstart](../getting-started/quickstart.md) project and name their
parameters explicitly; each one is checked against a fixture as part of the
build.

## 1. Program shape

### A Program text

**Form**

```text
[WITH name AS (…), …] SELECT … [|> step …] [|> EFFECT …]
[WITH name AS (…), …] FROM source [JOIN …] |> step … [|> EFFECT …]
CREATE [OR REPLACE] TABLE conn.table AS (query)
```

**Parts**

| Part | Accepts |
| --- | --- |
| `WITH` | Named intermediate values (below). |
| `SELECT …` | An ordinary GoogleSQL query; Pipe steps may follow it. |
| `FROM source [JOIN …]` | A Pipe query. The first `FROM` carries its joins; everything after it is a `\|>` step. |
| `EFFECT …` | At most one data-changing Effect, always the last step; Command postludes may follow the `;` ([Effects](#9-effects)). |

**Meaning**
One text is one query, optionally ending in one data-changing Effect, and
optionally followed by Command postludes on its named Results (see
[Effects](#9-effects)). A trailing `;` is allowed; `;` separates the query
from its postludes and does not chain statements or make the text a script.
The [Program model](https://actql.com/docs/actql/spec/language) a text lowers to carries several
Stages, written as JSON or YAML, when a workflow needs ordered steps. A `FROM`-headed query has no bare
`WHERE`, `ORDER BY` or `LIMIT`: after the first `|>` every operation is a
step. A Pipe is logical composition only; it does not create a stage, a
Checkpoint or an execution boundary.

**Example**

```sql
FROM support.cases AS c
|> WHERE c.status = 'open'
|> AGGREGATE COUNT(*) AS open_cases GROUP BY c.account_id
|> ORDER BY open_cases DESC
|> LIMIT 10;
```

**Errors** `query_syntax_invalid` (second statement, Effect not last,
bare clause after `FROM`).

**Spec** [SQL and explicit Pipe boundaries](https://actql.com/docs/actql/spec/query-text#sql-and-explicit-pipe-boundaries)

### `WITH`

**Form**

```text
WITH name AS ( query | GRAPH (…) | time_series(…) | calendar_series(…) | mean_graphs(…) ), …
```

**Parts**

| Part | Accepts |
| --- | --- |
| `name` | An identifier; later steps refer to it as a source or as a `with:` argument. |
| body | A SQL or Pipe query, a `GRAPH` constructor, or a generator call. Bodies may nest their own `WITH`. |

**Meaning**
A binding names a value — rows, a Graph, Vectors or Events — so later steps
can refer to it. Naming neither reads nor publishes: the declaration itself
performs no read, and its name never appears in the Results. At run time the
Host may share one observation between references or optimise the
computation, as long as the meaning is kept. Bodies are
pure: `INFER`, `RESULT` and `EFFECT` are not accepted inside them.

**Example**

```sql
WITH open_cases AS (FROM support.cases |> WHERE status = 'open')
SELECT account_id, COUNT(*) AS n FROM open_cases GROUP BY account_id;
```

**Errors** `query_syntax_invalid` (`INFER`, `RESULT` or `EFFECT` in a body),
`query_invalid` (name defined twice, unresolved name).

**Spec** [WITH producers and pure Graph construction](https://actql.com/docs/actql/spec/query-text#with-producers-and-pure-graph-construction)

### Naming: WITH, AS and RESULT

| Form | Does | Reads | Publishes |
| --- | --- | --- | --- |
| `WITH name AS (…)` | Names a value for later reference. | no | no |
| `\|> AS name` | Re-aliases the current rows so the following steps qualify columns as `name.col`. | no | no |
| `\|> RESULT name` | Publishes the current rows as the named Result `name` and continues. | no | yes |

A Program that only reads publishes its final rows as the Result `main`
when it declares no `RESULT`; a Program that ends in an Effect publishes no
Result unless it declares one. `RESULT` is accepted at statement level only, not inside `WITH`, derived
tables or set operands. A Result is fixed when it is declared: a later
`SELECT` or `LIMIT` does not change it.

**Spec** [Named intermediate Results](https://actql.com/docs/actql/spec/query-text#named-intermediate-results)

### Parameters

**Form** `@name`

**Meaning**
A parameter is declared by the Program with a type and supplied at run time
(`--params`, `parameters`). It is a value: it is never interpolated into the
text, never selects an operation and never names a resource. It is accepted
wherever an expression is, as `LIMIT`/`OFFSET`, and as an author guard.

**Example**

```sql
SELECT id, name FROM crm.accounts WHERE owner = @owner;
```

**Errors** `parameter_undeclared`, `parameter_unused`,
`supplied_value_type_mismatch`.

**Spec** [Parameters](https://actql.com/docs/actql/spec/language#parameters)

### `UNNEST`

**Form**

```text
FROM UNNEST(array_expr) [AS] element [WITH OFFSET [AS] position]
… JOIN UNNEST(array_expr) [AS] element [ON cond]
… CROSS JOIN UNNEST(array_expr) [AS] element
```

**Meaning**
Expands an array into one row per element. `element` names the whole element
value; an object element also exposes its fields as `element.field`. The
array may be a parameter (`UNNEST(@items)`), an `ARRAY[…]` constructor or a
column of the current row (correlated expansion). `NULL` and empty arrays
produce no rows.

**Example**

```sql
SELECT element.id, position
FROM UNNEST(@items) AS element WITH OFFSET AS position;
```

**Errors** `query_expression_invalid` (not an array), `query_invalid`
(duplicate alias).

**Spec** [Declared UNNEST value tables](https://actql.com/docs/actql/spec/query-text#declared-unnest-value-tables)

### Source-free `SELECT`

**Form** `SELECT expr [AS name], …` (no `FROM`)

**Meaning**
One logical row built from expressions and parameters. A `WHERE` that is
false yields no rows. It may feed a set operation, a `WITH` body or a `JOIN`
like any other query.

**Example**

```sql
SELECT @account_id AS id, 'high' AS level;
```

**Spec** [Source-free SELECT](https://actql.com/docs/actql/spec/query-text#source-free-select)

### `ARRAY` constructors

**Form**

```text
[expr, …]              -- bare, type inferred from the elements
ARRAY[expr, …]         -- the same, spelled out
ARRAY<T>[]             -- an empty array needs its element type
```

`T` is one of `BOOL`, `BOOLEAN`, `STRING`, `FLOAT64`, `DOUBLE`, `TIMESTAMP`,
`JSON`.

**Meaning**
A finite array. Elements must share one type; an empty array needs the
explicit `ARRAY<T>` annotation (`ARRAY<STRING>[]`). Arrays are accepted in `IN UNNEST`, as
`UNNEST` sources and as values.

**Example**

```sql
SELECT id FROM crm.accounts WHERE tier IN UNNEST(['gold', 'platinum']);
```

**Errors** `expression_type_mismatch` (mixed element types, missing annotation
on `[]`).

**Spec** [ARRAY constructors](https://actql.com/docs/actql/spec/query-text#array-constructors)

### `LIST_FILES`

**Form** `FROM LIST_FILES(connection.listing | connection [, paths => [string, …] | glob => string]) [AS alias]`

**Parts**

| Part | Accepts |
| --- | --- |
| `connection.listing` | A file-listing source of a connection (`gcs.objects`, `s3.objects`, `drive.files`, `local.files`). |
| `connection` | Shorthand for that source, accepted only when the connection publishes exactly one file-listing source; otherwise name it. |
| `paths => […]` | An explicit list of paths. |
| `glob => '…'` | One glob pattern. |

**Meaning**
A source whose rows are the files the listing exposes: `resource`,
`version`, `path`, `media_type`, `size` and the Connector's other metadata.
`paths` and `glob` are exclusive. Neither selector means the whole listing;
the Connector must allow an unconditional listing and keep it within the
Program's row limit, and a listing cut short by a limit is reported as
incomplete, never as the whole set — `LIMIT` on a listing is a request for
fewer files, not permission to treat them as all of them. Listing reads no
content. A file's content is a separate source, `connection.contents`
(`resource`, `version`, `content` as a `content_ref`, with the media type of
the captured bytes), joined on `resource` and `version`, so the Program names
the exact version it reads.

**Example**

```sql
FROM LIST_FILES(gcs.objects, glob => r'reports/*.csv') AS f
|> JOIN gcs.contents AS c ON f.resource = c.resource AND f.version = c.version
|> SELECT f.path, f.media_type, c.content;
```

**Errors** `query_syntax_invalid` (both selectors), `source_selector_unregistered`
(no such listing; a bare connection with several listing sources).

**Spec** [File listing Sources](https://actql.com/docs/actql/spec/query-text#file-listing-sources)

## 2. Pipe operators

Pipe syntax is GoogleSQL's: every step after the first `FROM` (or after a
full `SELECT`) starts with `|>` and consumes the rows of the step before it.
The first table lists GoogleSQL's pipe operators as ActQL accepts them, with
GoogleSQL's meaning; the second lists the operators ActQL adds.

**GoogleSQL operators**

| Operator | Does |
| --- | --- |
| `\|> WHERE cond` | Keeps the rows for which `cond` is `TRUE`. |
| `\|> SELECT [DISTINCT] expr [AS name], …` | Replaces the columns; ends the input range scope. `*`, `* EXCEPT (…)`, `* REPLACE (…)`, `alias.*`. |
| `\|> EXTEND expr AS name, …` | Adds columns, keeping the existing ones. |
| `\|> SET name = expr, …` | Replaces the value of existing columns. |
| `\|> DROP name, …` | Removes columns. |
| `\|> RENAME name AS new, …` | Renames columns. |
| `\|> AS alias` | Re-aliases the current rows as `alias`. |
| `\|> AGGREGATE agg [AS name], … [GROUP [AND ORDER] BY key [AS name] [ASC\|DESC], …]` | Groups and aggregates. Without `GROUP BY`, one row. |
| `\|> DISTINCT` | Removes duplicate rows. |
| `\|> [INNER\|LEFT\|RIGHT\|FULL] JOIN source ON cond \| USING (col, …) [MAX_OUTPUT_ROWS n]` | Joins another Relation on equality keys. `MAX_OUTPUT_ROWS` is ActQL's guard ([§4](#4-guards-and-assertions)). |
| `\|> CROSS JOIN source [MAX_OUTPUT_ROWS n]`, `\|> CROSS JOIN UNNEST(…) AS e` | Cross join; array expansion. |
| `\|> ORDER BY expr [ASC\|DESC] [NULLS FIRST\|LAST], …` | Orders the rows. |
| `\|> LIMIT n [OFFSET m]` | Keeps the first rows; `n`, `m` are integer literals or parameters. |
| `\|> PIVOT(agg(expr) FOR col IN ('a', 'b', …))` | Rotates string buckets into columns. One aggregate; literal buckets. |
| `\|> UNPIVOT [INCLUDE\|EXCLUDE NULLS] ((col, …) FOR name IN (…))` | Rotates columns into rows. |
| `\|> UNION ALL \| UNION DISTINCT \| INTERSECT DISTINCT \| EXCEPT DISTINCT [BY NAME [ON (…)] \| [STRICT] CORRESPONDING] (query)` | Set operations; positional unless `BY NAME`/`CORRESPONDING`. |

GoogleSQL operators not in this table (`CALL`, `WINDOW` as a standalone
step, `TABLESAMPLE`) are not accepted in 0.1; `check` refuses them with a
named reason. The `WINDOW` clause inside `SELECT` and `EXTEND` is accepted.

**Operators ActQL adds**

| Operator | Does |
| --- | --- |
| `\|> ASSERT UNIQUE BY (col, …)` | Fails the Run unless the key is unique ([§4](#4-guards-and-assertions)). |
| `\|> RESULT name` | Publishes the rows as a named Result and continues ([§1](#naming-with-as-and-result)). |
| `\|> INFER …` | Asks a model per row ([§5](#infer)). |
| `\|> NEAREST …` | Nearest vectors per row ([§5](#nearest)). |
| `\|> SERIALIZE FORMAT …` | Turns the rows into content ([§8](#serialize)). |
| `\|> name(key: value, …)` | A named call on vectors, graphs or events ([§3](#3-arguments-of-named-calls)). |
| `\|> MATCH pattern` | A graph pattern on a Graph input ([§6](#match)). |
| `\|> EFFECT …` | The write; always last ([§9](#9-effects)). |
| `\|> CREATE [OR REPLACE] TABLE conn.table` | Whole-table write; always last ([§9](#create-table)). |

Clause arguments stay inside their operator: `AGGREGATE`'s `GROUP BY`,
`JOIN`'s `ON`, `INFER`'s `INPUT`, `LIMIT`'s `OFFSET` and `SERIALIZE`'s
`OPTIONS` never take their own `|>`.

**Spec** [SQL and explicit Pipe boundaries](https://actql.com/docs/actql/spec/query-text#sql-and-explicit-pipe-boundaries),
[Scope and lowering](https://actql.com/docs/actql/spec/query-text#scope-and-lowering)

### `SET`, `EXTEND` and `AS`

| Step | Columns | Scope |
| --- | --- | --- |
| `\|> SET total = amount * 1.1` | Overwrites `total`, which must already exist; its type may change. Other columns are untouched. | The range alias stays valid. |
| `\|> EXTEND amount * 1.1 AS total` | Adds `total`; a name that already exists is an error. | The range alias stays valid. |
| `\|> AS t` | Changes no column. | From here on, columns are qualified as `t.col`; the earlier alias is gone. |

`SET` binds the replacement to a new value slot: an `INFER` key completed
from the old value is not retargeted. `SELECT` is the step that both chooses
columns and ends the range scope.

**Spec** [Scope and lowering](https://actql.com/docs/actql/spec/query-text#scope-and-lowering)

## 3. Arguments of named calls

A named call is `|> name(key: value, …)`. Keys are closed per operation and
case-insensitive; backticks quote a reserved key. The **role** of each value
is fixed by the operation's signature, not by how the value is spelled:

| Role | Example | Means |
| --- | --- | --- |
| ProducerRef | `with: spans`, `start: {from: seeds, …}` | A `WITH` name. Bare or backticked; a string can never name a producer. |
| FieldRef | `id: seeds.element`, `field: delta`, `by: [cohort, region]` | A column of the declared operand (the current rows, or the `with:` producer). |
| OutputName | `into: month`, `output: previous`, `bindings: {source: src}` | A new column name; existing columns are not looked up. |
| Expression | `where: e.kind = 1`, `expr: COALESCE(r.amount, 0)` | An ordinary query expression, only where the signature says so. |
| Enum / literal | `direction: 'out'`, `kind: 'weak'`, `start: 'A'`, `k: 3` | Data: an exact string, a number, `TRUE`, `FALSE`, `NULL`. |
| Record / list | `pattern: [{as: first, where: …}]`, `support: {nodes: 0.5}` | Closed structure; each leaf keeps the role its position gives it. |
| Parameter | `max_output_rows: @cap` | A whole parameter in a position that admits one. |

So `interval_join(with: spans, …)` joins the `WITH` producer `spans`, while
`with: 'spans'` is a string and is refused. A numeric literal may carry one
leading `+` or `-`; a sign on a parameter or a calculation is not accepted.
Unknown keys, duplicate keys and a value in the wrong role are refused before
anything runs.

**Spec** [Named logical SGA calls](https://actql.com/docs/actql/spec/query-text#named-logical-sga-calls)

## 4. Guards and assertions

Both forms are ActQL's own. GoogleSQL has no guard on a join, and
`ASSERT UNIQUE BY` is ActQL's spelling of its `assert_rows` operation, not
the `|> ASSERT condition` operator some GoogleSQL implementations offer; that
operator is not part of the accepted set.

### `MAX_OUTPUT_ROWS`

**Form** `… JOIN source ON cond MAX_OUTPUT_ROWS n`

**Meaning**
An author guard on one join: if the join would produce more than `n` rows,
the Run fails with the limit named. It never truncates. `n` is a positive
integer literal or a parameter. Each `JOIN` carries its own guard, including
joins inside `WITH`.

**Example**

```sql
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id MAX_OUTPUT_ROWS 100000
|> SELECT a.id, u.active_users;
```

**Errors** `operation_parameter_invalid` (zero, negative, above the admitted
ceiling).

**Spec** [Composition assertions](https://actql.com/docs/actql/spec/query-text#composition-assertions-capture-predicates-and-terminal-updates)

### `ASSERT UNIQUE BY`

**Form** `|> ASSERT UNIQUE BY (col, …)`

**Meaning**
Proves that the listed columns are present, non-null and unique across the
current rows, then passes every row through unchanged and in order. A
duplicate fails the Run; nothing is deduplicated. The proof is what a later
`INFER` or `EFFECT … ID` can rely on when the key is not already proved by
the source.

**Example**

```sql
FROM sheets.leads
|> ASSERT UNIQUE BY (email)
|> SELECT email, company;
```

**Errors** `query_invalid` (empty key list, unresolved column); at run time,
the assertion failure with the first duplicate key.

**Spec** [Composition assertions](https://actql.com/docs/actql/spec/query-text#composition-assertions-capture-predicates-and-terminal-updates),
[`assert_rows`](https://actql.com/docs/actql/spec/language#assert-rows)

## 5. Models and vectors

`INFER` sends each row to a model task. The vector forms work on vectors that
already exist: `score_vectors` scores a Vectors set against one query vector,
and `NEAREST` returns the top K candidates for each row's query. Producing an
embedding from text is a separate model task; neither form does it implicitly.

### `INFER`

**Form**

```text
|> INFER `model-task:<name>.v<n>`
     [ITEM KEY (col, …)]
     INPUT (col | expr AS field | field = expr, …)
     [KEEP (col [AS name] | * | alias.*, …)]
     AS name
     [MAX ITEMS n]
     [ON FAILURE FAIL]
```

**Parts**

| Part | Accepts |
| --- | --- |
| `` `model-task:…` `` | The name of a registered model task ([Models and INFER](../guides/models.md)). |
| `ITEM KEY (…)` | The columns that identify a row. |
| `INPUT (…)` | Exactly the task's input fields: `col` sends the column of that name; `expr AS field` and `field = expr` are the same mapping written two ways, and a field named twice is refused. A `content_ref` column is accepted for a field the task declares with a matching media type. Nothing else is sent. |
| `KEEP (…)` | Which input columns stay in the row. |
| `AS name` | The name of the answer. |
| `MAX ITEMS n` | An author guard on the number of distinct keys sent. |
| `ON FAILURE FAIL` | Publication rule: when any row is still unsuccessful after the bounded retries, the step's result is not published as a success. |

**Meaning**
Sends each row's `INPUT` to the task's model and adds one object column
`name` with `name.outcome` (`ok` or `failed:<reason>`), `name.value` (the
task's typed output on `ok`, otherwise `NULL`) and `name.input_key`. Rows
the model could not answer come back with the others; filter on
`name.outcome` before reading `name.value`. The input columns stay in the row
and remain usable for joins and filters.

**Defaults**

| Omitted | Means |
| --- | --- |
| `ITEM KEY` | The row's key is the single provable non-null candidate key of the rows so far: `FROM` on a keyed source, or a join that provably keeps that key unique. After other joins or an aggregation there is usually none — name it, and prove it with `ASSERT UNIQUE BY` when `check` cannot. |
| `KEEP` | `KEEP (*)`: every visible input column stays, in order, followed by `name`. |
| `MAX ITEMS` | The task's and the Host's ceilings apply. |
| `ON FAILURE` | Every row is returned; failures are per row. With `FAIL`, no partial result reaches later steps or Effects; the calls already made stay recorded as evidence, with their cost. |

**Example**

```sql
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.description, active_users = u.active_users, trend = u.trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high';
```

**Errors** `query_invalid` (unknown task, missing or extra input field,
no provable key, duplicate `KEEP` name, name collides with `AS`),
`expression_type_mismatch` (input type), `operation_parameter_invalid`
(`MAX ITEMS`).

**Spec** [INFER KEEP source projection](https://actql.com/docs/actql/spec/query-text#infer-keep-source-projection),
[`infer`](https://actql.com/docs/actql/spec/language#infer)

### `NEAREST`

**Form**

```text
|> NEAREST candidates [AS c]
     [USING expr | QUERY KEY (col, …) VECTOR expr]
     [CANDIDATE KEY (col, …) VECTOR expr]
     [METRIC cosine | dot | l2]
     K n
     [KEEP (col [AS name] | * | alias.*, …)]
     AS hit
```

**Parts**

| Part | Accepts |
| --- | --- |
| `candidates` | A source or `WITH` name holding the candidate rows or Vectors. |
| `AS c` | An alias for the candidate side; default is the last name component. |
| `USING expr` | The query vector, an expression over the current row. |
| `QUERY KEY (…) VECTOR expr` | Explicit key and vector of the query side (instead of `USING`). |
| `CANDIDATE KEY (…) VECTOR expr` | Explicit key and vector of the candidate side. |
| `METRIC` | `cosine`, `dot` or `l2`. |
| `K n` | Matches per query row; a positive integer literal. |
| `KEEP (…)` | Which columns stay; resolves against both sides. |
| `AS hit` | The name of the match object. |

**Meaning**
For each current row, finds the `K` candidates with the best score under the
metric and emits one row per match. The search is exact under the metric;
ActQL never substitutes an approximate index. `hit` holds `hit.score`,
`hit.rank`, `hit.query_key`, `hit.candidate_key` and, when the candidate has
a `body` column, `hit.body`; other candidate columns are reached through
`KEEP (c.col)`. A row with no match produces no rows. `l2` scores are negative
distances, so "best" is always the largest score.

**Defaults**

| Omitted | Means |
| --- | --- |
| key / vector pairs | Each side's sole vector column and sole provable string key are used; ambiguity is an error. |
| `METRIC` | `cosine`. |
| `KEEP` | The query-side columns, in order, followed by `hit`. This is not `KEEP (*)`: `KEEP (*)` expands the query columns and then the candidate columns, and refuses duplicate names. |

**Example**

```sql
SELECT c.id, c.description AS question, c.embedding AS query_vec
FROM salesforce.cases AS c
WHERE c.priority = 'urgent'
|> NEAREST kb.articles USING query_vec K 3 AS hit
|> AGGREGATE ARRAY_AGG(hit.body ORDER BY hit.rank) AS refs GROUP BY id, question;
```

**Errors** `query_syntax_invalid` (`KEY` without `VECTOR`, `USING` together
with `QUERY`), `query_invalid` (no or ambiguous vector column or key,
duplicate `KEEP` name), `operation_parameter_invalid` (`K`).

**Spec** [NEAREST KEEP source projection](https://actql.com/docs/actql/spec/query-text#nearest-keep-source-projection),
[`nearest`](https://actql.com/docs/actql/spec/language#nearest)

### Vector calls

| Call | Input → output | Arguments |
| --- | --- | --- |
| `to_vectors(id: col, vector: col)` | rows → Vectors | `id` FieldRef (the member key), `vector` FieldRef. |
| `vectors()` | Vectors → rows | none; the bridge back to rows (`id`, `vector`). |
| `normalize_vectors()` | Vectors → Vectors | none; unit-length vectors. |
| `score_vectors(query: value, metric: 'cosine' \| 'dot' \| 'l2')` | Vectors → Vectors | `query` a non-null numeric array of the set's dimension (a value or parameter); adds `score` to each member. Bring the scores to rows with `vectors()`. |
| `pool_vectors(by: [col, …], method: 'sum' \| 'mean' \| 'max' [, vector: col] [, output_id: name])` | Vectors → Vectors | `by` FieldRefs; `output_id` an OutputName, only with one grouping field. |

**Example**

```sql
WITH v AS (FROM kb.articles |> to_vectors(id: id, vector: embedding) |> normalize_vectors())
FROM v
|> score_vectors(query: @query_vec, metric: 'cosine')
|> vectors()
|> ORDER BY score DESC |> LIMIT 5;
```

**Errors** `query_invalid` (wrong carrier: a Relation step such as `ORDER BY`
on Vectors without `vectors()`), `operation_parameter_invalid` (`query` of
another dimension or with NULLs).

**Spec** [Vector-set-preserving operations and bridges](https://actql.com/docs/actql/spec/language#vector-bridges),
[`pool_vectors`](https://actql.com/docs/actql/spec/language#pool-vectors)

### Vector functions

| Function | Result |
| --- | --- |
| `vector_score(a, b, 'cosine' \| 'dot' \| 'l2')` | Row-local score. `'l2'` returns the **negative** distance, so larger is closer under every metric. The third argument must be a string literal. |
| `vector_concat(a, b, …)` | Concatenation of two or more vectors; the dimensions may differ, and the result's dimension is their sum. |
| `VECTOR_COSINE_SIMILARITY(a, b)` | Same as `vector_score(a, b, 'cosine')`. |
| `VECTOR_INNER_PRODUCT(a, b)` | Same as `vector_score(a, b, 'dot')`. |
| `VECTOR_L2_DISTANCE(a, b)` | The **positive** distance: `-vector_score(a, b, 'l2')`. |
| `VECTOR_CONCAT(a, b, …)` | Same as `vector_concat`. |

`vector_score` and its aliases require two vectors of the same dimension;
`NULL` propagates through every function.

**Spec** [Row-local vector expressions](https://actql.com/docs/actql/spec/language#vector-expressions),
[Decoding and expression rules](https://actql.com/docs/actql/spec/query-text#decoding-and-expression-rules)

## 6. Graphs

### `GRAPH` constructor

**Form**

```text
WITH g AS (GRAPH (
  NODE TABLES (rows [AS N] KEY (col, …) [LABEL Name | DEFAULT LABEL] [PROPERTIES (col [AS name], …) | PROPERTIES ARE ALL COLUMNS [EXCEPT (…)] | NO PROPERTIES], …)
  [EDGE TABLES (rows [AS E] KEY (col, …)
                SOURCE KEY (col, …) REFERENCES N [(col, …)]
                DESTINATION KEY (col, …) REFERENCES N [(col, …)]
                [LABEL Name] [PROPERTIES (…)], …)]
))
```

**Meaning**
Builds a Graph value from Relations: each node table contributes nodes keyed
by `KEY`, each edge table contributes edges whose endpoints `REFERENCES` a
node definition. Labels and properties belong to the definition. The Graph
exists only inside the Program; no catalog object is created. This is the
GoogleSQL/SQL-PGQ table mapping, not ISO GQL `CREATE GRAPH`.

**Example**

```sql
WITH accounts AS (FROM crm.accounts |> SELECT id, name),
     refs AS (FROM crm.referrals |> SELECT id, from_id, to_id),
     g AS (GRAPH (
       NODE TABLES (accounts AS Account KEY (id) LABEL Account PROPERTIES (name))
       EDGE TABLES (refs AS Referred KEY (id)
                    SOURCE KEY (from_id) REFERENCES Account
                    DESTINATION KEY (to_id) REFERENCES Account
                    LABEL Referred NO PROPERTIES)
     ))
FROM g |> MATCH (a:Account)-[:Referred]->(b:Account) |> SELECT a.name, b.name AS referred;
```

**Errors** `graph_operation_invalid` (unknown definition in `REFERENCES`,
duplicate label, key type mismatch).

**Spec** [WITH producers and pure Graph construction](https://actql.com/docs/actql/spec/query-text#with-producers-and-pure-graph-construction),
[`graph`](https://actql.com/docs/actql/spec/language#graph-construction)

### `MATCH`

**Form**

```text
FROM [GRAPH] g
|> MATCH [p =] [WALK | TRAIL | ACYCLIC] node (edge node)…

node  ::= ( [var] [:Label] [{prop: expr, …} | WHERE cond] )
edge  ::= -[ [var] [:Label] [{…} | WHERE cond] ]->  |  <-[ … ]-  |  -[ … ]-  |  ->  |  <-  |  -
          [ {n} | {m,n} ]
```

**Parts**

| Part | Accepts |
| --- | --- |
| `GRAPH g` | A Graph value; the `GRAPH` marker is optional and adds a type expectation. |
| `p =` | A path variable. |
| `WALK`, `TRAIL`, `ACYCLIC` | Path mode: revisits allowed; no edge reused; no node revisited. |
| `var` | A variable for the node or edge, usable in later steps. |
| `:Label` | Membership in that label of the definition (not a property comparison). |
| `{prop: expr}` / `WHERE cond` | A constraint on that element. |
| `->`, `<-`, `-` | Outgoing, incoming, either direction. The bracketed forms add a variable, a label or a constraint. |
| `{n}`, `{m,n}` | A finite number of hops. |

**Meaning**
Yields one row per match with the pattern's variables bound. One `MATCH` per
Graph source; a second pattern needs its own source and an ordinary join.
`SELECT` after `MATCH` ends the pattern scope and exports only its columns.
This is the GoogleSQL element-pattern profile; it is not full GQL.

**Defaults** Path mode `WALK`.

**Example**

```sql
FROM g
|> MATCH ACYCLIC (a:Account WHERE a.tier = 'gold')-[:Referred]->{1,3}(b:Account)
|> SELECT a.name AS source, b.name AS reached;
```

**Errors** `query_syntax_invalid` (unbounded quantifier, second `MATCH`),
`graph_operation_invalid` (unknown label, property not on every candidate),
`query_invalid` (row alias on a Graph).

**Spec** [Graph pattern source](https://actql.com/docs/actql/spec/query-text#graph-pattern-source),
[Graph operations](https://actql.com/docs/actql/spec/language#graph-operations)

### Graph calls

All take a Graph as the current input unless noted. Enum arguments are
strings; `direction` is `'out'`, `'in'` or `'both'`.

| Call | Arguments | Output |
| --- | --- | --- |
| `reach(start: 'id' \| {from: p, id: col}, direction, max_depth [, edge_types: [...]] [, max_output_rows])` | `start` is one ID literal (`'acc_1'`) for a single start, or a selector `{from: p, id: col}` that starts from every row of a `WITH` Relation; that is how one query's result becomes the next step's starting set. | rows `start_id`, `node_id`, `depth` |
| `traverse(start, direction, min_hops, max_hops, emit: 'nodes' \| 'paths' [, path_mode: 'walk' \| 'trail' \| 'acyclic'] [, edge_types] [, max_output_rows])` | As `reach`. | `nodes`: `start_id`, `node_id`, `depth`; `paths`: `start_id`, `end_id`, `hop_count`, `node_ids`, `edge_ids` |
| `shortest_path(source: 'id' \| {from, id}, target: 'id' \| {from, id}, direction, max_hops [, weight: col] [, max_output_rows])` | | rows `source_id`, `target_id`, `total_cost`, `hop_count`, `node_ids`, `edge_ids` |
| `components(kind: 'weak' \| 'strong' [, max_output_rows])` | | rows `node_id`, `component_id`, `component_size` |
| `degree(direction)` | | rows `node_id`, `degree` |
| `graph_bounds(max_nodes, max_edges, max_degree)` | Any subset; numbers or parameters. | rows `kind`, `node_id`, `actual`, `max` — one per violation |
| `match_nodes(ids: ['…', …] \| where: cond [, label: '…' \| definition: '…'], fields: [col, …])` | | rows: the listed fields |
| `match_edges([where: cond] [, label \| definition], fields: [col, …])` | | rows: the listed fields |
| `normalize_graph()` | | Graph |
| `subgraph(nodes: ['…', …] \| {from: p, id: col} \| where: cond [, edges: cond])` | `nodes` takes the same selector as `reach`'s `start`; `edges` keeps only the edges for which the condition is true. | Graph |
| `graft_graph(with: p)` | `p` a Graph producer. | Graph |
| `union_graphs(with: [p, …])` | | Graph |
| `subtract_graphs(with: p)` | | Graph |
| `graphs_equal(with: p)` | | one row `equal` |
| `graph_diff(with: p)` | | delta rows |
| `apply_graph_delta(with: changes, field: delta)` | `changes` a delta producer; `field` its delta column. | Graph |
| `mean_graphs(with: [p, …], weights: [n, …], support: {nodes: x, edges: x}, properties: {nodes: {…}, edges: {…}})` | A generator: used as a `WITH` body, not on a current input. | Graph |
| `node_rows([definition: 'N' \| label: 'L'])`, `edge_rows(…)` | At most one selector. | rows: the element keys, labels and properties |

**Examples**

```sql
WITH seeds AS (FROM crm.accounts |> WHERE tier = 'gold' |> SELECT id)
FROM g
|> reach(start: {from: seeds, id: id}, direction: 'out', max_depth: 2)
|> SELECT start_id, node_id, depth;
```

```sql
FROM g
|> shortest_path(source: 'acc_1', target: 'acc_9', direction: 'out', max_hops: 5)
|> SELECT total_cost, hop_count, node_ids;
```

```sql
WITH stats AS (FROM g |> degree(direction: 'out'))
FROM stats |> WHERE degree > 10 |> SELECT node_id, degree |> RESULT hubs;
```

**Errors** `graph_operation_invalid` (missing required key, wrong carrier,
a string where a producer or column is expected), `operation_parameter_invalid`.

**Spec** [Named logical SGA calls](https://actql.com/docs/actql/spec/query-text#named-logical-sga-calls),
[Graph operations](https://actql.com/docs/actql/spec/language#graph-operations)

## 7. Events and time

### Event calls

`to_events` turns rows into an Events carrier; `events()` turns it back. The
calls in between keep the carrier they are given. A clock argument (`time`,
`left_time`, `right_time`, `start`, `end`) is a `timestamp` column or an
integer column of milliseconds since the epoch; the column itself is kept as
it is. Write `occurred_at`, not a hand-made `occurred_ms`.

| Call | Input → output | Arguments |
| --- | --- | --- |
| `to_events(id: col, time: col)` | rows → Events | FieldRefs for the identity and the clock (`timestamp` or milliseconds). |
| `events()` | Events → rows | none. |
| `session(by: [col, …], gap: '…')` | Events → Events | `gap` a duration string (`'30m'`). |
| `window_events(kind: 'fixed' \| 'sliding', size [, step] [, offset])` | Events → Events | Sizes in ms or duration strings; `sliding` needs `step`. |
| `dedupe_events(by: [col, …], order_by: [{field: col, dir: 'asc' \| 'desc' [, nulls: 'first' \| 'last']}, …])` | Events → Events | Keeps the first event per key in that order. Empty `by` means global; `order_by` is always written. `{col: 'asc'}` is shorthand for the same order key, with the common NULL ordering. |
| `watermark_events(watermark_ms: n \| @param, policy: 'mark' \| 'drop')` | Events → Events | A numeric literal or a whole parameter, fixed for the Run: a resumed or retried Run marks the same events late. |
| `sequence([by: [col, …],] id: col, time: col, pattern: [{as: name, where: cond}, …], within: n [, overlap: 'allow' \| 'disallow'] [, contiguity: 'adjacent' \| 'subsequence'] [, max_matches_per_key] [, max_output_rows])` | rows or Events → rows | One row per match; columns `<name>_id` per pattern step. Defaults: `by: []` (one partition), `overlap: 'disallow'`, `contiguity: 'adjacent'` (consecutive elements of the ordered partition; `'subsequence'` lets a match skip elements). `within` is always written. |
| `row_window(time: col, kind: 'fixed' \| 'sliding', size [, step] [, offset])` | rows → rows | Adds `window_start`, `window_end`. |
| `window_group(by: [col, …], aggregates: {name: {fn: '…' [, expr] [, filter] [, distinct]}, …})` | rows → rows | After `row_window`; `expr` and `filter` are expressions. |
| `lag(partition_by: [col, …], order_by: [{col: 'asc'}], field: col, output: name [, offset: n])` | rows → rows | Relational navigation. |
| `watermark_rows(time: col, late_policy: 'mark' \| 'drop', watermark_ms: n \| max_skew: n)` | rows → rows | Exactly one of the two thresholds. |
| `asof_join(with: p, kind, by: [col, …], left_time: col, right_time: col, direction, tolerance, select: {name: left.col \| right.col, …} [, left_id] [, right_tie_break])` | rows or Events ⨝ rows → rows | `with` a `WITH` producer. |
| `interval_join(with: p, kind: 'inner' \| 'left', mode: 'point_in_interval' \| …, on: [col, …], left: {time: col}, right: {start: col, end: col} [, select: {…}] [, max_output_rows])` | rows ⨝ rows → rows | |
| `merge_rankings(with: p \| [p, …], by: [col, …], candidate: col, k: n, score_policy: {rrf: {rank_constant, weights, rank_window}} \| {max: …} \| {weighted_sum: …} [, score] [, rank] [, score_contract] [, tie_break])` | rows → rows | Rank fusion of the current rows with the peers; adds `score`, `rank`. |

### Generators

| Call | Arguments | Output |
| --- | --- | --- |
| `time_series(start: ts, end: ts, step: n)` | Literal timestamps or whole parameters; a positive step. | rows `time` |
| `calendar_series(start: ts, end: ts, unit: 'day' \| 'week' \| 'month' \| …, timezone: '…' [, week_start: '…'])` | `week_start` required for `week`, forbidden otherwise. | rows `start`, `end` |

A generator reads no input, so it is a `WITH` body (or the head of a Pipe),
never a `|>` step.

### `calendar_bucket`

**Form** `|> calendar_bucket(time: col, into: name, unit: '…', timezone: '…' [, week_start: '…'])`

**Meaning** Adds the column `name` holding the calendar bucket that contains
`time` in the named time zone.

**Examples**

```sql
WITH records AS (FROM app.events |> SELECT id, account_id, occurred_at, kind)
FROM records AS e
|> sequence(by: [e.account_id], id: e.id, time: e.occurred_at,
     pattern: [{as: first, where: e.kind = 1}, {as: second, where: e.kind = 2}],
     within: 20, max_output_rows: 100)
|> SELECT first_id, second_id;
```

```sql
WITH ticks AS (FROM market.ticks |> SELECT id, at),
     spans AS (FROM market.spans |> SELECT id, begin, finish)
FROM ticks AS t
|> interval_join(with: spans, kind: 'left', mode: 'point_in_interval',
     on: [], left: {time: t.at}, right: {start: spans.begin, end: spans.finish},
     select: {id: left.id, value: right.id}, max_output_rows: 1000)
|> SELECT id, value;
```

```sql
WITH days AS (calendar_series(start: '2026-01-01T00:00:00.000Z',
                              end: '2026-03-01T00:00:00.000Z',
                              unit: 'day', timezone: 'Asia/Tokyo'))
FROM days AS d
|> calendar_bucket(time: d.start, into: month, unit: 'month', timezone: 'Asia/Tokyo')
|> AGGREGATE COUNT(*) AS days GROUP BY month;
```

**Errors** `query_invalid` (wrong carrier, missing required key),
`operation_parameter_invalid` (negative size, `week_start` with a non-week
unit, a parameter where a literal is required).

**Spec** [Event operations](https://actql.com/docs/actql/spec/language#event-operations),
[Relational temporal operations](https://actql.com/docs/actql/spec/language#relational-temporal),
[`sequence`](https://actql.com/docs/actql/spec/language#sequence), [as-of join](https://actql.com/docs/actql/spec/language#asof-join),
[interval join](https://actql.com/docs/actql/spec/language#interval-join), [`merge_rankings`](https://actql.com/docs/actql/spec/language#merge-rankings),
[Calendar profile](https://actql.com/docs/actql/spec/language#calendar),
[Named finite event sequences](https://actql.com/docs/actql/spec/query-text#named-finite-event-sequences)

## 8. Serialization and other ActQL functions

### `SERIALIZE`

**Form**

```text
|> SERIALIZE FORMAT CSV | JSONL
     ORDER BY col [ASC | DESC], … | PRESERVE ORDER
     OPTIONS (name = '…', header = TRUE | FALSE, null_marker = '' | r'\N',
              field_delimiter = '…', encoding = '…', line_ending = 'LF' | 'CRLF',
              max_rows = n, max_bytes = n)
```

**Parts**

| Part | Accepts |
| --- | --- |
| `FORMAT` | `CSV` or `JSONL`. |
| order | An explicit `ORDER BY`, or `PRESERVE ORDER` when the input order is already proved. |
| `OPTIONS` | Static literals; `max_rows` and `max_bytes` also accept parameters. `CSV` requires `header` and `null_marker`. |

**Meaning**
Encodes the current rows as one piece of content. The output is a single row
with exactly `name`, `content` (a `content_ref`), `media_type`, `size_bytes`
and `row_count`; the input columns do not survive. This is the explicit
boundary at which content is created. It uploads nothing: an
`EFFECT STORE` after it is what writes the content anywhere.

**Example**

```sql
FROM support.cases
|> WHERE status = 'open'
|> SELECT id, subject, opened_at
|> SERIALIZE FORMAT CSV ORDER BY opened_at
     OPTIONS (name = 'open-cases.csv', header = TRUE, null_marker = '')
|> EFFECT STORE s3.objects SET (key = 'exports/' || name, content = content);
```

**Errors** `query_syntax_invalid` (missing order clause or `OPTIONS`),
`operation_parameter_invalid` (unknown or duplicate option, non-literal
value, missing `header`/`null_marker` for CSV).

**Spec** [Content serialization](https://actql.com/docs/actql/spec/query-text#content-serialization),
[`serialize`](https://actql.com/docs/actql/spec/language#serialize)

### Functions that differ from GoogleSQL or are ActQL-only

| Function | Result |
| --- | --- |
| `CONCAT(a, b, …)`, `a \|\| b` | String concatenation; `NULL` propagates (GoogleSQL rule). |
| `ACTQL.CONCAT(a, b, …)` | Concatenation that skips `NULL` arguments. |
| `SAFE_DIVIDE`, `SAFE_ADD`, `SAFE_SUBTRACT`, `SAFE_MULTIPLY`, `SAFE_NEGATE` | `NULL` instead of a failure on division by zero or overflow. |
| `to_number`, `to_boolean`, `to_timestamp`, `to_string`, `to_decimal` | Conversions that fail on bad input; the same as `CAST`. |
| `try_number`, `try_timestamp`, `try_decimal` | The same conversions returning `NULL` on bad input. |
| `quantize(d, scale)` | The only rounding of a decimal. |
| `decimal_divide(a, b, scale)` | Exact decimal division at a scale. |
| `utf8_truncate(s, bytes)` | Cuts a string at a byte budget without splitting a character. |
| `nfkc(s)`, `case_fold(s)` | Unicode normalisation and case folding; values are otherwise kept as written. |
| `regex_match`, `regex_extract`, `regex_replace` | The ActQL regular-expression profile ([Text, time and regular expressions](https://actql.com/docs/actql/spec/language#text-time)). |
| `vector_score`, `vector_concat` | See [Vector functions](#vector-functions). |

The complete function list with types and `NULL` rules is on
[Types and functions](types-and-functions.md).

**Spec** [Decoding and expression rules](https://actql.com/docs/actql/spec/query-text#decoding-and-expression-rules),
[Common expression contract](https://actql.com/docs/actql/spec/language#common-expression-contract)

## 9. Effects

An Effect is the only way a Program changes an external system. A text has
room for Effects in two places: the Pipe ends in **at most one** data-changing
Effect (`UPDATE`, `INSERT`, `UPSERT`, `DELETE`, `STORE`, `CREATE TABLE`), and
after the terminating `;` any number of **Command postludes** may follow, each
reading one of the query's named Results (the long form at the end of this
section). A second data-changing Effect in the Pipe, or an Effect inside
`WITH`, is refused. The Effects declared in one text belong to one Stage and
form one Effect Set: they are checked together and approved at one
Checkpoint. Work that must happen in order — write, then notify about what
was written — is expressed as Stages in the [Program model](https://actql.com/docs/actql/spec/language),
not by chaining statements. Values in an Effect are pure expressions
over the current row — columns, literals, functions of them. They are
evaluated before anything is sent, and the evaluated values are what the
Preview fixes and the approval covers. Every Effect goes through policy and,
when policy asks for it, a Checkpoint before anything is sent; the approval
covers the whole Effect Set, which for one Effect is that Effect
([Effects and approvals](../guides/effects-and-approvals.md)).

**Targets and Mappings.** `conn.resource` names a connection and one of the
resources its Connector publishes (`actql catalog show conn`). The Host
resolves the write Mapping — which fields may be set, their types, the key —
from the Connector's published write schema for that resource; an author
never names a Mapping. A resource that publishes more than one Mapping or
Command contract is addressed with the long form shown at the end of this
section.

### `EFFECT UPDATE`

**Form** `|> EFFECT UPDATE conn.resource ID key SET (field = value, …)`

**Parts**

| Part | Accepts |
| --- | --- |
| `conn.resource` | The target resource. |
| `ID key` | The column of the current rows holding the record's identifier. |
| `SET (…)` | One or more target fields; each value is a column or a literal. |

**Meaning**
Updates one record per row, by key. The Preview lists every record and the
field changes; after the write, each item is `applied`, `failed` or `unknown` —
or `accepted` on a Connector that confirms the write later
and is reconciled by key.

**Example**

```sql
FROM salesforce.accounts AS a
|> WHERE a.id = @account_id
|> EFFECT UPDATE salesforce.Account ID id SET (Churn_Risk__c = 'high');
```

**Errors** `query_invalid` (unknown resource, field not in the write schema,
duplicate field, key column missing), `expression_type_mismatch`.

### `EFFECT INSERT`

**Form** `|> EFFECT INSERT conn.resource (col, …) [VALUES (value, …)]`

**Meaning**
Creates one record per row. Without `VALUES`, the listed columns of each row
are written to the fields of the same names; with `VALUES`, each listed
column receives the corresponding expression.

**Example**

```sql
FROM webshop.signups
|> WHERE created_at > @since
|> EFFECT INSERT hubspot.contacts (email, company) VALUES (email, company_name);
```

### `EFFECT UPSERT`

**Form** `|> EFFECT UPSERT conn.resource ID key SET (field = value, …)`

**Meaning**
Updates the record with that key, or creates it when none exists. Same
Preview and outcomes as `UPDATE`; an `applied` item additionally records
which it was, `action: created` or `action: updated`.

### `EFFECT DELETE`

**Form** `|> EFFECT DELETE conn.resource ID key`

**Meaning**
Deletes one record per row, by key. The Preview lists the records.

### `EFFECT STORE`

**Form** `|> EFFECT STORE conn.resource [SET (field = value, …)]`

**Meaning**
Stores content or rows. Pointed at an object or file resource (`s3.objects`,
`gcs.objects`, `drive.files`), it writes the `content` of each row — a
`content_ref` produced by `SERIALIZE` or read from a `contents` source — as
one object. The `SET` fields are the inputs the destination takes, each an
expression over the row: where the object goes (`key`, `name`, `folder`, …),
the `content` itself, and whether an existing object may be replaced
(`overwrite`). They are the data of the Effect, not settings of it. Rows
without a `content` are refused: a Relation becomes
content only through `SERIALIZE`. Pointed at a table resource a Connector
declares (`local.<table>`, `tableau.datasources`), it stores the rows
themselves, in the shape the resource declares. The Preview fixes the
destination, the exact content (by its content identity) or the row count,
and the overwrite condition. Each Connector page lists the fields its
resources take.

**Example**

```sql
FROM support.cases
|> WHERE status = 'open'
|> SELECT id, subject, opened_at
|> SERIALIZE FORMAT CSV ORDER BY opened_at
     OPTIONS (name = 'open-cases.csv', header = TRUE, null_marker = '')
|> EFFECT STORE s3.objects SET (key = 'exports/' || name, content = content);
```

**Errors** `query_invalid` (no `content` column for an object resource,
unknown field), `expression_type_mismatch` (`content` is not a `content_ref`).

### `EFFECT COMMAND`

**Form** `|> EFFECT COMMAND conn.operation [TARGET expr] ID key [INPUT (field = value, …)]`

**Parts**

| Part | Accepts |
| --- | --- |
| `conn.operation` | An operation the Connector declares (`gmail.send`, `tableau.refresh`); it resolves to one versioned Command contract. |
| `TARGET expr` | The resource the operation acts on, per row, when the contract needs one (a workbook, a thread, a folder). Omitted when the contract fixes it, such as the connection's mailbox. |
| `ID key` | The row's key: the identity of each operation in the Preview, the status and recovery. Not the recipient or the target. |
| `INPUT (…)` | The contract's input fields, as expressions over the row. |

**Meaning**
Runs a named operation once per row: send a message, refresh an extract,
start a job. The contract fixes the input types, the target kind, the
permission, what the Preview shows and how an outcome is confirmed; `check`
verifies all of it. The outcome per item is `accepted` (the system took the
request), `applied` (it confirmed the result), `failed` or `unknown`; an unknown
outcome is confirmed through the Connector's own evidence, never resent.
Resources that publish more than one Command contract are addressed with
the long form at the end of this section.

**Example**

```sql
FROM support.replies AS r
|> WHERE r.status = 'ready'
|> EFFECT COMMAND gmail.send
     ID r.id
     INPUT (to = r.recipient, subject = r.subject, body = r.body);
```

**Errors** `query_invalid` (unknown operation, missing or extra input field,
`TARGET` required or not accepted), `expression_type_mismatch` (input or
target type).

### `CREATE TABLE`

**Form**

```text
CREATE [OR REPLACE] TABLE conn.table AS (query)
… |> [EFFECT [name]] CREATE [OR REPLACE] TABLE conn.table
```

**Meaning**
Writes the rows as a whole table: `CREATE` requires that the table does not
exist; `CREATE OR REPLACE` replaces the whole table with the same schema. A
create conflict stays a conflict under `OR REPLACE`. It is a store Effect
and is previewed and approved like one.

**Example**

```sql
FROM snowflake.usage_30d
|> WHERE active_users > 0
|> CREATE OR REPLACE TABLE duckdb.active_usage;
```

**Spec** [Table create and whole-table replace](https://actql.com/docs/actql/spec/query-text#table-create-and-whole-table-replace)

### SQL statement forms

**Form**

```text
UPDATE conn.resource SET field = value, … WHERE cond;
INSERT INTO conn.resource (col, …) VALUES (value, …) | SELECT …;
DELETE FROM conn.resource WHERE cond;
```

**Meaning**
The same Effects as `EFFECT UPDATE`, `EFFECT INSERT` and `EFFECT DELETE`.
A `WHERE` that is an equality on the key column writes by key. Any other
`WHERE` selects the targets at Preview time: the Host reads the matching
records and fixes their identities and versions, the Preview lists exactly
those, and the approval covers them and nothing else — the `WHERE` is not
evaluated again at apply time, so a record that matches by then is not added.
At apply time each target's condition (its version or current values) is
checked; a changed record ends `failed` with `conflict`. A Connector that
cannot fix the target set and its conditions this way refuses the form at
`check`. Writing by key is the simplest to reconcile; a write selected by
`WHERE` is reconciled when the Connector has an operation id, an idempotency
key or an audit record for it.

**Example**

```sql
UPDATE salesforce.Account
SET Churn_Risk__c = 'high'
WHERE Id = @account_id;
```

### The long forms

When a resource publishes more than one Mapping or Command contract, name the
one you mean:

```sql
|> EFFECT mark UPDATE
     TARGET 'connector://salesforce/Account'
     MAPPING `mapping:salesforce.account-risk.v1`
     ID id SET (Churn_Risk__c = risk.value.level);
```

```sql
FROM support.escalations |> SELECT channel, message |> RESULT escalations;
EFFECT notify COMMAND
  FROM RESULT escalations AS e
  TARGET e.channel
  CONTRACT `command:slack.post.v1`
  INPUT (text = e.message);
```

`TARGET` is the resource URI, `MAPPING` or `CONTRACT` the published contract,
and the optional Effect name (`mark`, `notify`) is how the Run's status and
ledger refer to it. The `COMMAND` long form follows a `;`-terminated query
and refers to one of its `RESULT`s. A short form is the long form with the
Effect name, the Mapping and the Result left to the Host.

**Errors** `query_invalid` (unknown Mapping or contract, Result not retained,
a second data-changing Effect in the Pipe).

**Spec** [Terminal updates](https://actql.com/docs/actql/spec/query-text#composition-assertions-capture-predicates-and-terminal-updates),
[COMMAND postludes](https://actql.com/docs/actql/spec/query-text#command-postludes),
[Effect declarations](https://actql.com/docs/actql/spec/language#effects)

## 10. Planned syntax

**`RESULT(name)`** — a reference to a Result already published earlier in
the same Program, usable as a source (`FROM RESULT(updates)`), so that one
Program can publish rows and then continue from exactly what it published.
Planned after 0.1.

**`BRANCH`** — a body that groups steps which publish their own Results and
run under one Program, so that one text can fan out into several Results
without repeating the shared prefix. Planned after 0.1.

## 11. Program operations without query syntax

The JSON/YAML [Program document](https://actql.com/docs/actql/spec/language#document-structure) has
operations that SQL and Pipe do not spell directly. They are listed here so
that nobody looks for a keyword that does not exist; they are not written as
`|> name(…)`.

| Operation | Does | Equivalent in SQL / Pipe, and when |
| --- | --- | --- |
| `top_k`, `top_k_by` | The best `k` rows by a score, per group, with a stated tie rule. | `ORDER BY … LIMIT n` for one group when the order is total; per group, `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)` with `QUALIFY`. Ties are resolved by the operation's rule, which the SQL form must spell out. |
| `json_pick` | Extract a typed value from `json` by a declared path. | Typed access `obj.field` on objects; no `json` path syntax yet. |
| `nest` | Group child rows under a parent as an array of objects. | `AGGREGATE ARRAY_AGG(…) GROUP BY …`. |
| `dedupe_rows` | Keep one row per key, chosen by a stated order. | `ROW_NUMBER() OVER (PARTITION BY key ORDER BY …) = 1` with `QUALIFY`, for an explicit order. Not `DISTINCT`, which compares whole rows and keeps every distinct one. `ASSERT UNIQUE BY` when the key should already be unique. |
| `search_candidates` | Ask an external search service for ranked candidates (an acquisition, unlike `NEAREST`). | none. |
| `text_rank` | Lexical ranking of rows against a query string. | none. |
| Effect kinds `create`, `update`, `upsert`, `delete`, `command`, `store` | The closed set the Effect forms lower to. | `EFFECT INSERT`, `UPDATE`, `UPSERT`, `DELETE`, `COMMAND`, `STORE` / `CREATE TABLE`. |

**Spec** [`top_k`](https://actql.com/docs/actql/spec/language#top-k), [`nest`](https://actql.com/docs/actql/spec/language#nest),
[Reshaping and nested data](https://actql.com/docs/actql/spec/language#reshaping),
[`search_candidates`](https://actql.com/docs/actql/spec/language#candidate-search),
[`text_rank`](https://actql.com/docs/actql/spec/language#text-rank),
[Effect declarations](https://actql.com/docs/actql/spec/language#effects)
