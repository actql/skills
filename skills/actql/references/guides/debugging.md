<!-- Generated from actql/actql@84d4ef5bff33 docs/guides/debugging.md; do not edit. The published page is https://actql.com/docs/actql/guides/debugging -->
# Debugging and troubleshooting

This page is for the moment something does not work: a Program is refused at
check time, a Run fails or stops, or a result is not what you expected. It
goes through the places to look, in the order you will meet them.

## The order of things

Problems surface at four points, and each has its own tool:

| Where | Tool | Reads data? |
| --- | --- | --- |
| The Program itself | `actql check` | no |
| The plan and limits | `actql explain` | no |
| The Run | `actql status`, `actql run --json` | yes |
| The environment | `actql doctor`, `actql catalog show` | no |

Start at the top. Most failures are caught by `check` without touching any
system, and under `--profile mock` you can take a Program all the way to a
Checkpoint without credentials.

## Check failures

`check` reports every problem it can find, with a named reason and a
location:

```text
$ actql check churn-risk.aql
Check  failed
  expression_type_mismatch   line 7
    risk.value.level = 1   level is STRING, got INT64
  parameter_undeclared       line 3
    @since is used but not declared
```

The reason names are stable and listed in the
[check reason catalog](../reference/check-reasons.md). The ones you will see
most:

| Reason | Typical cause | Fix |
| --- | --- | --- |
| `query_syntax_invalid`, `query_lexical_invalid` | A typo, an unsupported clause, a missing `|>` | Compare with [Writing Programs](../authoring.md) |
| `source_selector_unregistered` | `salesforce.accounts` is not a source of any configured connection | Check `actql catalog list`; fix the connection name or the resource |
| `expression_type_mismatch` | Comparing or combining values of different types | Cast explicitly, or fix the literal |
| `parameter_undeclared`, `parameter_value_required` | `@name` is used but not declared, or declared but not supplied | Declare it, and pass `--params` |
| `query_alias_absent` | A column is referenced through an alias that does not exist | Check `AS` names, including the `INFER … AS` name |
| `graph_operation_invalid` | A graph operation got an argument of the wrong kind | See the graph section of [Writing Programs](../authoring.md) |
| `implementation_limit` | The Program is valid but uses something this Host cannot run yet | See [Implementation status](../reference/status.md) |

`check --json` returns the same report as data, which is what an agent should
read before trying again. A warning does not stop `check` from returning 0;
an error does.

Not every reason means the Program is wrong. Three things are reported
separately: the Program is **invalid** (`query_syntax_invalid`,
`expression_type_mismatch` — fix the text); the check is **incomplete** —
a value is missing (`parameter_value_required`), the checker ran out of
budget (`analysis_budget_exhausted`), or something could not be resolved
within your permissions (`unresolved_protected`) — supply the value or ask,
the Program may be fine; or this Host **cannot run** a valid Program
(`implementation_limit`). Read the verdict, the completeness and the
environment support as three facts, not one severity.

## Plan problems

If `check` passes but `explain` refuses, the Program is valid and the Host
cannot bound it: a source without a row limit, a model step whose item count
cannot be established, or a Capability the Program relies on that the
connection does not declare. The message names the missing bound or
capability. Add a `LIMIT`, a `MAX ITEMS` guard, or a filter the source can
evaluate, and read [Plans and pushdown](plans-and-pushdown.md) for how
placement is decided.

## Run failures

A Run that ends `failed` tells you where:

```text
$ actql status run_…
Run run_…
  Status   failed
  Failed   read snowflake.usage_30d
           ACTQL_E_SOURCE_READ_FAILED  Snowflake: SQL compilation error: Object 'USAGE_30D' does not exist
  Effects  none sent
```

Read it by state:

| Status | Likely cause | What to do |
| --- | --- | --- |
| `failed` during a read | Credentials, a missing object, a limit exceeded | Fix the connection or the Program; run again |
| `failed` during `INFER` | `ON FAILURE FAIL` and a failed row, or the item limit exceeded before any call | Check `outcome` values with a mock run, or lower the input |
| `waiting_checkpoint` | A decision is pending | `approve` or `reject` |
| `needs_reconciliation` | A write's outcome is unknown | `reconcile`; see [Run lifecycle](run-lifecycle.md) |
| `cancelled` | Someone cancelled it, or rejected its Checkpoint before anything was sent | Nothing was written; adjust and run again |

Runs are never silently cut short: a limit that was hit is named in the
failure, and a partial result is never presented as complete. Every error has
a stable `ACTQL_E_*` code; `status --json` carries it with the full Run state.

Running the same Program again creates a new Run. The old one stays in the
Store with its evidence for the retention period, so you can compare.

## Unexpected results

- **Fewer rows than expected after `INFER`.** Rows whose outcome is not `ok`
  have `value = NULL` and fall out of a `WHERE risk.value.level = 'high'`.
  Look at the outcomes first: `|> AGGREGATE COUNT(*) GROUP BY risk.outcome`.
- **A filter seems ignored.** It is applied; check whether it runs in the
  source (`explain`) and whether the source's semantics differ, for example
  case-sensitive string comparison.
- **The model's answer looks wrong.** The type is guaranteed, the judgement is
  not. The mock profile cannot tell you whether a prompt is good — it returns
  fixed answers — so use it to check what happens around the model: the
  input columns, the types, the failed-row handling, the Effect. To compare
  two versions of a task's instructions, run both against the real provider
  on the same evaluation rows.
- **An Effect's result does not match the Preview.** Tell four things apart:
  the approved Preview (what ActQL set out to change), the send record (what
  was sent and when), the Connector's outcome receipt (`applied`, `accepted`,
  `failed`, `unknown`) and the external system's current value. The Preview
  fixes the approved change; it does not guarantee the external system
  succeeded, and it says nothing about what a third party changed afterwards.
  An `unknown` outcome goes to reconciliation.

## The environment

`actql doctor` checks the installation: the Host, the Store directory and its
keys, the configuration files it found, and whether each configured
connection and provider can be reached. `actql catalog show <connection>`
prints what a connection exposes; if a resource or column is missing there,
the Program cannot see it either, whatever the external system holds.

## Getting help

When asking for help, include the output of `actql check --json --redact`,
`actql explain --json --redact` and `actql status <run> --json --redact`.
`--redact` replaces system names, resource names, parameter values and
Preview values with stable placeholders and keeps the structure, codes and
locations, so the report stays diagnosable without disclosing your systems
or data. Without `--redact` these outputs name your connections and resources
and, for `status`, carry the Preview's values; treat them as you would treat
the data itself.

## Next

- [Check reason catalog](../reference/check-reasons.md): every reason `check` can report.
- [Run lifecycle and recovery](run-lifecycle.md): states and reconciliation.
- [CLI reference](../cli.md): `--json` output of each command.
