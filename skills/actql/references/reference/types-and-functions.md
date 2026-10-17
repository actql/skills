<!-- Generated from actql/actql@84d4ef5bff33 docs/reference/types-and-functions.md; do not edit. The published page is https://actql.com/docs/actql/reference/types-and-functions -->
# Types and functions

The value types a Program works with, how parameters are declared, and the
functions and operations available by family. Names are the canonical ones
from the [language specification](https://actql.com/docs/actql/spec/language); SQL spellings are
listed where they differ. The precise value laws, NULL rules and failure rules
live in the specification; this page is the lookup table.

## Scalar types

| Type | SQL spellings | Holds |
| --- | --- | --- |
| `string` | `STRING` | Unicode text, kept as written (no normalisation). |
| `number` | `NUMBER`, `FLOAT64`, `DOUBLE` | Finite IEEE-754 double. |
| `decimal(P,S)` | `DECIMAL(P,S)` | Exact base-10 value with precision and scale. Use it for money. |
| `boolean` | `BOOLEAN` | `TRUE` or `FALSE`. |
| `timestamp` | `TIMESTAMP` | An instant, canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ`. |
| `date` | `DATE` | A calendar date, `YYYY-MM-DD`; distinct from a timestamp. |
| `json` | | Untyped JSON; no static field information. |
| `object` | | A closed record with declared, typed fields. |
| `array` | `ARRAY<T>` | A list of values of one declared element type. |
| `vector` | | A fixed-dimension vector of 32-bit floats. |
| `resource_ref` | | An opaque reference to a resource in an external system. |
| `content_ref` | | An opaque reference to content (an Artifact) with an optional media type. |

Every column and field has a type and a nullability. `NULL` is allowed only
where the schema says `nullable`. A column that an external system may omit
is a separate notion from a nullable column; see
[SQL compatibility](sql-compatibility.md#null-rules).

## Parameters

A Program declares its parameters with a type, a nullability and an optional
default; the values are supplied when it runs (`--params` on the CLI, the
`parameters` option in the SDKs). In query text a parameter is `@name`.

| Rule | Meaning |
| --- | --- |
| Declared types | Any scalar type above, `object` and `array` of them; not `vector`. |
| Defaults | Apply once, only when the value is missing; an explicit `NULL` is not "missing". |
| Where allowed | Anywhere an expression is; also as `LIMIT`/`OFFSET` and as author guards. |
| Never | Interpolated into text, used to choose an operation, or used to name a resource. |

## Conversions

| Function | SQL | Result |
| --- | --- | --- |
| `to_string(x)` | `CAST(x AS STRING)` | Canonical spelling of a string, number, decimal, boolean, timestamp or date. |
| `to_number(x)` | `CAST(x AS NUMBER)` | From string or number; fails on text that is not a number. |
| `to_boolean(x)` | `CAST(x AS BOOLEAN)` | From string or boolean. |
| `to_timestamp(x)` | `CAST(x AS TIMESTAMP)` | From string or timestamp. |
| `to_decimal(x)` | `CAST(x AS DECIMAL(P,S))` | Exact; fails rather than rounds. |
| `try_number`, `try_timestamp`, `try_decimal` | | Same conversions, returning `NULL` instead of failing on bad input. |
| `quantize(d, scale)` | | Round a decimal to a scale (the only rounding of decimals). |

## Strings

| Function | Result |
| --- | --- |
| `len(s)` / `LENGTH` | Number of Unicode scalars. |
| `byte_length(s)` / `BYTE_LENGTH`, `OCTET_LENGTH` | UTF-8 byte count. |
| `lower`, `upper` | Case mapping with pinned Unicode tables. |
| `trim`, `ltrim`, `rtrim` `(s[, chars])` | Remove whitespace or the given characters. |
| `left`, `right` `(s, n)` | First or last `n` scalars. |
| `lpad`, `rpad` `(s, n[, pattern])` | Pad or truncate to `n` scalars. |
| `substring(s, pos[, len])` | 1-based scalar positions. |
| `concat(…)` / `CONCAT`, `\|\|` | Concatenate; `NULL` if any operand is `NULL` (`ACTQL.CONCAT` skips nulls). |
| `replace(s, from, to)` | Replace every occurrence. |
| `split(s[, delimiter])` | Array of parts; delimiter defaults to `,`. |
| `split_part(s, delimiter, i)` | One part, 1-based; negative counts from the end. |
| `contains`, `starts_with`, `ends_with` | Exact matching. |
| `instr(s, sub[, pos[, occurrence]])`, `strpos(s, sub)` | Positions, 1-based; 0 when absent. |
| `translate(s, from, to)` | Map or delete characters. |
| `unicode(s)` / `UNICODE` | Code point of the first scalar. |
| `utf8_truncate(s, max_bytes)` | Longest prefix within a byte budget, never splitting a scalar. |
| `nfkc(s)`, `case_fold(s)` | Unicode normalisation and folding (text-time profile). |
| `regex_match`, `regex_extract`, `regex_replace` | Pinned regex grammar (text-time profile). |
| `template` | Authoring macro over `to_string` and strict concatenation. |

## Numbers

| Function | Result |
| --- | --- |
| `+ - * /` | Double arithmetic; division by zero fails. |
| `abs`, `sign`, `floor`, `round(x[, n])`, `trunc(x[, n])` | As in GoogleSQL; `round` rounds halves away from zero. |
| `sqrt`, `cbrt`, `pow`, `exp`, `ln`, `log(x, base)`, `log10` | Domain errors fail (negative square root, non-positive logarithm). |
| `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh` | Trigonometry. |
| `greatest(…)`, `least(…)` | Over one or more numbers; `NULL` if any is `NULL`. |
| `safe_add`, `safe_subtract`, `safe_multiply`, `safe_divide`, `safe_negate` | Return `NULL` instead of failing on overflow or division by zero. |
| `negate` | Unary minus for numbers and decimals. |

Decimals use `add`, `subtract`, `multiply`, comparison, `sum`, `min`, `max`,
`decimal_divide(d, divisor)` and `quantize`. Decimal `avg` is refused; use
`sum`, `count` and `decimal_divide` explicitly.

## Dates and times

| Function | Result |
| --- | --- |
| `date_trunc(t, unit)` | Truncate to `ms`, `s`, `m`, `h` or `d` (fixed UTC units). |
| `date_add(t, n, unit)` | Add a fixed number of units. Dates accept only whole days. |
| `date_diff(a, b, unit)` | Difference in whole units, truncated toward zero. |
| `parse_timestamp(format, s)`, `format_timestamp(format, t)` | Pinned timestamp grammar (text-time profile). |
| `calendar_bucket`, `calendar_series` | Calendar-aware buckets (months, weeks, time zones) — the calendar profile. |

Fixed units never do calendar arithmetic: a day is exactly 86,400,000 ms.
Use the calendar profile for months and time zones.

## Conditionals and comparison

| Function | Result |
| --- | --- |
| `if(cond, a, b)` / `IF` | Only the selected branch is evaluated. |
| `case` / `CASE WHEN … END` | First true branch; `NULL` when none and no `ELSE`. |
| `coalesce(…)` / `COALESCE`, `IFNULL` | First non-null argument. |
| `nullif(a, b)` / `NULLIF` | `NULL` when equal. |
| `in`, `not_in` / `IN (…)`, `IN UNNEST(…)` | Membership with GoogleSQL's NULL rules: a `NULL` element makes a non-match `NULL` (`1 IN (NULL)` is `NULL`), while a `NULL` or empty array under `UNNEST` is the empty set (`1 IN UNNEST(CAST(NULL AS ARRAY<INT64>))` is `FALSE`). |

## Objects, arrays and JSON

| Form | Result |
| --- | --- |
| `{field: expr, …}`, `[expr, …]` | Construct a closed object or array. |
| `obj.field`, `obj.*` | Typed access; a nullable receiver yields `NULL`. |
| `UNNEST(array)` | Expand an array into rows (declared value tables). |
| `ARRAY_AGG`, `STRING_AGG` | Aggregate into an array or a delimited string. |

## Aggregates and windows

`count`, `count_if`, `sum`, `avg`, `min`, `max`, `array_agg`, `string_agg`,
with optional filtering and ordering, plus the window (analytic) forms over
`PARTITION BY` / `ORDER BY` / frames. Floating-point sums replay the captured
values on recovery; use `decimal` where the result must be exact.

## Vector operations

The forms and arguments of every call below are on the
[Syntax reference](syntax.md#5-models-and-vectors).

| Operation | Result |
| --- | --- |
| `vector_score(a, b, 'cosine' \| 'dot' \| 'l2')` | Row-local similarity (`l2` is a negative distance). SQL: `VECTOR_COSINE_SIMILARITY`, `VECTOR_INNER_PRODUCT`, `VECTOR_L2_DISTANCE`. |
| `vector_concat(a, b, …)` / `VECTOR_CONCAT` | Concatenate vectors. |
| `nearest` / `\|> NEAREST` | K nearest candidates per query row, by metric. |
| `normalize_vectors`, `score_vectors`, `pool_vectors` | Operations on a Vectors carrier. |
| `merge_rankings` | Rank fusion of ranked lists (`rrf`, `max` or `weighted_sum` score policy). |
| `to_vectors`, `vectors` | Bridges between rows and Vectors. |

## Graph operations

The forms and arguments of every call below are on the
[Syntax reference](syntax.md#6-graphs).

| Operation | Result |
| --- | --- |
| `GRAPH (NODE TABLES (…) [EDGE TABLES (…)])` | Build a Graph from Relations. |
| `MATCH pattern` | Pattern match in the GoogleSQL element-pattern profile; `match_nodes`, `match_edges` select elements by ID, label or predicate. |
| `reach`, `traverse`, `shortest_path`, `components`, `degree`, `graph_bounds` | Reachability, walks, paths, connected components, degree metrics, bounds. |
| `subgraph`, `graft_graph`, `union_graphs`, `subtract_graphs`, `normalize_graph` | Structural operations on whole graphs. |
| `graphs_equal`, `graph_diff`, `apply_graph_delta`, `mean_graphs` | Compare, diff, apply a delta, average. |
| `node_rows`, `edge_rows`, `graph` | Bridges between Relations and Graphs. |

## Event operations

The forms and arguments of every call below are on the
[Syntax reference](syntax.md#7-events-and-time).

| Operation | Result |
| --- | --- |
| `to_events`, `events` | Bridges between rows and an Events carrier. |
| `window_events`, `row_window` | Fixed and sliding windows (on events or rows). |
| `session` | Session assignment by gap. |
| `watermark_events`, `watermark_rows` | Watermark labelling. |
| `dedupe_events` | Deduplicate events by key. |
| `sequence` | Match ordered event patterns. |
| `asof_join`, `interval_join` | Time-based joins. |
| `time_series`, `calendar_series`, `calendar_bucket` | Generate series; calendar buckets. |
| `lag`, `window_group` | Relational navigation and windowed grouping. |

## Other operations

| Operation | Result |
| --- | --- |
| `infer` / `\|> INFER` | Ask a model per row; see [Models and INFER](../guides/models.md). |
| `serialize` / `\|> SERIALIZE` | Rows to content (a `content_ref`). |
| `assert_rows` / `\|> ASSERT UNIQUE BY` | Prove uniqueness or fail. |
| `values` | A literal finite Relation. |

### Program-only operations

`top_k`, `top_k_by`, `json_pick`, `nest`, `dedupe_rows`, `search_candidates`
and `text_rank` exist in the JSON/YAML Program document but have no SQL or
Pipe spelling. The [Syntax reference](syntax.md#11-program-operations-without-query-syntax)
lists them with the SQL that gives the same result where there is one.

Which of these each environment executes today is listed in
[Implementation status](status.md).
