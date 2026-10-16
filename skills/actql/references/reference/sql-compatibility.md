<!-- Generated from actql/actql@d904416674e4 docs/reference/sql-compatibility.md; do not edit. The published page is https://actql.com/docs/actql/reference/sql-compatibility -->
# SQL compatibility

ActQL's query text is GoogleSQL with Pipe syntax, extended for models, Effects
and the non-table carriers. This page lists what the SQL surface accepts, what
each form means, and what is refused. It is for people who already know SQL
and want to know how far it carries over. The exact grammar is in the
[query text specification](https://actql.com/docs/actql/spec/query-text); how to write Programs is
in [Writing Programs](../authoring.md).

The rule throughout: where a spelling exists in GoogleSQL, ActQL uses it with
the GoogleSQL meaning. ActQL does not claim full GoogleSQL conformance; it
claims that the parts it accepts mean what they mean there. A form that is not
accepted is refused at check time with a named reason, never approximated.

## Statements

| Form | Meaning |
| --- | --- |
| `SELECT … FROM … [WHERE] [GROUP BY] [HAVING] [QUALIFY] [WINDOW] [ORDER BY] [LIMIT [OFFSET]]` | Ordinary query. Clauses keep their SQL meaning and need no Pipe. |
| `SELECT …` without `FROM` | One logical row; expressions and parameters only. |
| `WITH name AS (…), …` | Named intermediate value of any kind (rows, graph, vectors, events). Names nothing else; see [Writing Programs](../authoring.md). |
| `FROM source [JOIN …] \|> step \|> …` | Pipe query. The initial `FROM` may carry its JOINs; every later operation starts with `\|>`. |
| `query ;` followed by `EFFECT … COMMAND …` | The long form of a Command Effect, on a retained Result ([Syntax reference](syntax.md#the-long-forms)). |
| `CREATE TABLE target AS SELECT …`, `CREATE OR REPLACE TABLE target AS (…)` | Whole-table write to a Connector target that publishes a create or replace binding. |
| `UPDATE target SET … WHERE …` | SQL form of an update Effect (same Effect as `\|> EFFECT UPDATE`). |
| `INSERT INTO target …` | SQL form of an insert Effect. |
| `DELETE FROM target WHERE …` | SQL form of a delete Effect. |

One query per Program text, apart from the Command postludes after the `;`. Interpolation
and multiple unrelated statements are refused.

## Pipe operators

Every operator after the first `FROM` is introduced by `|>` and consumes the
previous output. The full form of each ActQL operator, with its parts,
defaults and errors, is on the [Syntax reference](syntax.md).

| Operator | Meaning |
| --- | --- |
| `\|> WHERE condition` | Filter rows. |
| `\|> SELECT expr AS name, …` | Project; ends the input range scope. Supports `*`, `* EXCEPT (…)`, `* REPLACE (…)`, `alias.*` and `object.*`. |
| `\|> EXTEND expr AS name, …` | Add computed columns, keeping the input columns. |
| `\|> SET name = expr, …` | Replace a column's value. |
| `\|> RENAME name AS new, …` | Rename columns. |
| `\|> DROP name, …` | Remove columns. |
| `\|> AS alias` | Rebind the current visible columns under a range alias. |
| `\|> AGGREGATE agg(…) AS name, … GROUP BY key, …` | Group and aggregate. |
| `\|> JOIN other ON … / USING (…)` | Join the current rows with another Relation. |
| `\|> ORDER BY expr [ASC\|DESC] [NULLS FIRST\|LAST], …` | Sort. |
| `\|> LIMIT n [OFFSET m]` | Take rows; `n` and `m` are integer literals or `@parameters`. |
| `\|> DISTINCT` | Remove duplicate rows. |
| `\|> UNION ALL / UNION DISTINCT / INTERSECT DISTINCT / EXCEPT DISTINCT other`, optionally `BY NAME [ON (…)]` or `CORRESPONDING` | Set operations. |
| `\|> PIVOT(agg(expr) FOR axis IN ('a', 'b', …))`, `\|> UNPIVOT …` | Reshape. |
| `\|> ASSERT UNIQUE BY (col, …)` | Prove a key is unique for what follows; fails the Run otherwise. |
| `\|> RESULT name` | Publish the current rows as a named Result and continue. |
| `\|> INFER \`model-task:…\` [ITEM KEY (col, …)] INPUT (col, …) [KEEP (…)] AS name [MAX ITEMS n] [ON FAILURE FAIL]` | Ask a model per row; see [Syntax reference](syntax.md#infer) and [Models and INFER](../guides/models.md). |
| `\|> NEAREST candidates [USING vector] [METRIC m] K n [KEEP (…)] AS name` | Nearest-neighbour search; see [Syntax reference](syntax.md#nearest). |
| `\|> CROSS JOIN source [MAX_OUTPUT_ROWS n]`, `\|> CROSS JOIN UNNEST(…) AS e` | Cross join; array expansion. |
| `\|> name(key: value, …)` | Named call on vectors, graphs or events ([Syntax reference](syntax.md#3-arguments-of-named-calls)). |
| `\|> MATCH pattern`, `\|> node_rows()`, `\|> edge_rows()`, named graph calls | Graph pattern query and graph operations on a Graph input ([Syntax reference](syntax.md#6-graphs)). |
| `\|> SERIALIZE FORMAT … ORDER BY … \| PRESERVE ORDER OPTIONS (…)` | Turn rows into content (a `content_ref`); an `EFFECT STORE` or `EFFECT COMMAND` after it sends the content. `EFFECT STORE` on an object resource requires a `content` column; a Relation becomes content only through `SERIALIZE`. |
| `\|> EFFECT UPDATE target ID key SET (field = value, …)` | Terminal update Effect (the short form). |
| `\|> EFFECT UPSERT target ID key SET (field = value, …)` | Terminal create-or-update Effect. |
| `\|> EFFECT DELETE target ID key` | Terminal delete Effect. |
| `\|> EFFECT INSERT target (col, …) [VALUES (expr, …)]` | Terminal insert Effect; without `VALUES`, the listed columns of each row are written. |
| `\|> EFFECT STORE target SET (field = value, …)` | Terminal write of each row's content as a file or object, or of the rows into a declared table; the fields name the destination and pass the content. |
| `\|> EFFECT COMMAND connection.operation [TARGET expr] ID key [INPUT (field = value, …)]` | Terminal named operation, once per row; `TARGET` when the contract needs one. |
| `\|> CREATE [OR REPLACE] TABLE target` | Terminal whole-table write. |
| `INSERT INTO target (col, …) VALUES (…)`, `UPDATE target SET … WHERE key = …`, `DELETE FROM target WHERE key = …` | The SQL statement forms of the same Effects. |

A Pipe is a logical composition, not an execution boundary: it does not fix
the physical order, create a stage or a Checkpoint, or authorise anything.
At most one data-changing Effect per Program text, always the last step of
the Pipe; Command postludes may follow the terminating `;`. The forms and
their long forms are on the [Syntax reference](syntax.md#9-effects).

## Joins

| Join | Supported | Notes |
| --- | --- | --- |
| `[INNER] JOIN … ON / USING` | yes | Equality keys; conjunctions of keys; grouping parentheses are transparent. |
| `LEFT [OUTER] JOIN` | yes | Unmatched right columns become nullable. |
| `RIGHT [OUTER] JOIN` | yes | Unmatched left columns become nullable. |
| `CROSS JOIN` | yes | |
| `FULL [OUTER] JOIN` | partial | Requires proven key identity on both sides; chains of FULL JOINs are refused. |
| `… MAX_OUTPUT_ROWS n` | yes | An author guard on the join's output; exceeding it fails the Run. |

Join keys are columns or value-table receivers compared for equality; arithmetic,
casts and whole-row keys are refused. `USING` exposes one key column, in the
authored order, ahead of the remaining left then right columns.

## Set operations

`UNION ALL`, `UNION DISTINCT`, `INTERSECT DISTINCT` and `EXCEPT DISTINCT` are
supported in SQL chains and as Pipe operators. Column matching is positional by
default; `BY NAME`, `BY NAME ON (col, …)`, `CORRESPONDING` and
`STRICT CORRESPONDING` select name-based matching with the GoogleSQL meanings.
`INNER … BY NAME` keeps only the common columns. `FULL`/`LEFT` name
propagation is not supported.

## Expressions

| Area | Supported |
| --- | --- |
| Literals | strings (single, double, triple-quoted, raw `r'…'`, adjacent chunks concatenate), integers (decimal, hex), finite doubles, `TRUE`/`FALSE`, `NULL`, arrays `[…]`, `ARRAY[…]` and `ARRAY<T>[]` (the empty array needs its element type) |
| Parameters | `@name`, declared by the Program; never interpolated |
| Comparison and logic | `=`, `<>`, `!=`, `<`, `<=`, `>`, `>=`, `AND`, `OR`, `NOT`, `IS [NOT] NULL`, `IN (…)`, `IN UNNEST(array)`, `BETWEEN` |
| Conditionals | `CASE WHEN … THEN … ELSE … END`, `IF`, `IFNULL`, `COALESCE`, `NULLIF` |
| Casts | `CAST(x AS STRING \| NUMBER \| FLOAT64 \| DOUBLE \| BOOLEAN \| TIMESTAMP \| DECIMAL(P,S))`; same-type casts are identity |
| Strings | `CONCAT`, `\|\|`, `LENGTH`, `LOWER`, `UPPER`, `TRIM`, `LTRIM`, `RTRIM`, `LEFT`, `RIGHT`, `LPAD`, `RPAD`, `SUBSTRING`, `REPLACE`, `SPLIT`, `STARTS_WITH`, `ENDS_WITH`, `INSTR`, `STRPOS`, `BYTE_LENGTH`, `UNICODE`, `TRANSLATE`, `CONTAINS` |
| Numbers | `+ - * /`, `ABS`, `SIGN`, `ROUND`, `TRUNC`, `FLOOR`, `SQRT`, `CBRT`, `POW`, `EXP`, `LN`, `LOG`, `LOG10`, trigonometric functions, `GREATEST`, `LEAST`, `SAFE_DIVIDE` and the other `SAFE_*` forms |
| Aggregates | `COUNT(*)`, `COUNT(x)`, `COUNTIF`, `SUM`, `AVG`, `MIN`, `MAX`, `ARRAY_AGG(x ORDER BY …)`, `STRING_AGG(x, 'sep')`, filtered aggregates (`… WHERE …` inside the call) |
| Window functions | `OVER (PARTITION BY … ORDER BY … [ROWS …])` with the supported analytic functions, `QUALIFY`, named `WINDOW` specifications |
| Vectors | `VECTOR_COSINE_SIMILARITY`, `VECTOR_INNER_PRODUCT`, `VECTOR_L2_DISTANCE`, `VECTOR_CONCAT` |

The full function list, with types and NULL rules, is in
[Types and functions](types-and-functions.md).

## NULL rules

- `NULL` is SQL `NULL`: unknown. Comparisons with `NULL` yield `NULL`, and a
  `WHERE` keeps only rows whose condition is `TRUE`.
- Scalar functions propagate `NULL` unless their entry in
  [Types and functions](types-and-functions.md) says otherwise.
- `CONCAT` and `||` propagate `NULL`. `ACTQL.CONCAT` is the explicit
  null-skipping variant.
- `SUM`, `AVG`, `MIN` and `MAX` ignore `NULL`; `COUNT(x)` counts non-null
  values; `COUNT(*)` counts rows.
- Outer joins extend unmatched columns with `NULL` and mark them nullable in
  the checked schema.
- A column that an external system may omit is distinct from a `NULL` value;
  the checker refuses to read a column that is not guaranteed present.

## Not accepted

These are refused at check time with a named reason. They are either outside
the selected GoogleSQL profile, or deliberately absent from ActQL.

| Form | Why |
| --- | --- |
| User-defined functions, `CREATE FUNCTION`, lambdas, inline JavaScript or Python | ActQL has no escape hatches; see [Language design](https://actql.com/docs/actql/concepts/language-design#no-escape-hatches). |
| Procedural SQL (`BEGIN`, `LOOP`, `IF … THEN`, variables, cursors) | A Program is finite and declarative. |
| `SELECT … INTO`, `MERGE`, DDL other than `CREATE [OR REPLACE] TABLE … AS` | Changes to external systems are Effects with their declared forms (`UPSERT` replaces `MERGE`). |
| `BYTES` literals and functions, collations, `SAFE_CAST`, `::` casts, `DATE` as a cast target | Not in the selected profile. |
| Computed `LIMIT`/`OFFSET`, `LIMIT 0` | Only integer literals or parameters. |
| Non-equality join keys, joins on computed keys | Keys are columns compared for equality. |
| Chains of `FULL JOIN`, `FULL`/`LEFT` `BY NAME` set operations | Not supported. |
| Multiple aggregates, non-string axes or computed buckets in `PIVOT` | Only the single-aggregate, string-axis form. |
| Unknown function names or operations | Never resolved by fuzzy matching or synonyms. |
| `\|> CALL`, `\|> WINDOW` as a standalone step, `\|> TABLESAMPLE`, `\|> ASSERT condition` | GoogleSQL pipe operators outside the accepted set; the `WINDOW` clause inside `SELECT`/`EXTEND` and `\|> ASSERT UNIQUE BY` are accepted. |
| String interpolation, several statements in one text | One query per Program text, with at most one data-changing Effect and Command postludes after the `;`. |

What is defined here and what each environment executes today are different
questions; see [Implementation status](status.md).
