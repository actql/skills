<!-- Generated from actql/actql@747e5c2771ca docs/guides/plans-and-pushdown.md; do not edit. The published page is https://actql.com/docs/actql/guides/plans-and-pushdown -->
# Plans and pushdown

This page is for authors who want to know where a Program's work will run and
how much it will cost before running it. It explains what `explain` prints,
how ActQL decides which parts go to a source system, and how estimates,
limits and actual figures differ.

## What a plan is

ActQL reads a Program the way a database reads SQL: you say what you want,
and the engine decides how to get it. The **Plan** fixes the operations, their
types, the boundaries where external systems are touched, and the limits. It
does not fix where every operation physically runs — the Host chooses that
from the Capabilities of its Connectors and compute engines, within the
meaning the Plan has fixed.

Placement has two parts, reported separately:

- **Site** — where the work runs: a Connector's own system
  (`connector:snowflake`), your machine (`host:local`), or a remote or Cloud
  worker.
- **Engine** — what computes it there: the source's own query engine, ActQL's
  built-in engine, or DuckDB.

Some choices cannot be made before any data is read. The engine for a join
depends on how many rows arrive, so the Host picks it during the Run, once the
inputs report their sizes. It can change the plan only for work that has not
started, and never the Program's meaning, limits or what needs approval.

## Reading `explain`

`explain` prints the plan without reading business data, calling a model or
creating a Run:

```text
$ actql explain churn-risk.aql

ActQL EXPLAIN · static
Check: valid       Run: not started
Provider I/O: none

[1] READ  salesforce.accounts
    Site: connector:salesforce
    Interface: Salesforce API
    Projection: id, description
    Pushdown: selected

[2] READ  snowflake.usage_30d
    Site: connector:snowflake
    Engine: Snowflake SQL
    Projection: account_id, active_users, trend
    Pushdown: selected

[3] JOIN  [1] + [2]
    Condition: a.id = u.account_id
    Site: host:local (fixed)
    Engine: deferred
      Candidates: ActQL RelA, DuckDB
    Input rows: unknown
    Output limit: 50,000 (Host policy)

[4] INFER  churn-risk.v1
    Input: [3]
    Site: model provider
    Calls: one per row of [3]; count unknown

[5] WHERE  risk.outcome = 'ok'
           AND risk.value.level = 'high'
    Depends on: [4]
    Site: host:local
    Engine: deferred
    Pushdown: not eligible
      Reason: depends on INFER output

[6] EFFECT UPDATE  salesforce.Account
    Site: connector:salesforce
    Preview: unavailable before execution
    Policy: evaluated at runtime
    Checkpoint: conditional

Estimates: unavailable (no statistics)
Details: actql explain churn-risk.aql --verbose
```

Each numbered block is one operation. **Site** is where it runs and
**Engine** what computes it there (for a SaaS API, the **Interface**). A
placement that is not yet chosen is marked:

| Placement | Meaning |
| --- | --- |
| `fixed` | Decided by the plan |
| `deferred` | Decided during the Run, from information not available yet |
| `proposed` | The current preference, checked again during the Run |
| `candidate` | One of the options for a deferred or proposed choice (`--verbose`) |
| `excluded` | Not possible here, with the reason (`--verbose`) |
| `realized` | What a Run actually used (`explain --run`) |

Authorization is reported separately, on the Effect: `Policy` says when the
decision is made and `Checkpoint` whether the Run will stop — `none`,
`conditional` (policy decides at run time) or `required`.

`Pushdown: selected` means the plan puts the operation into the request sent
to the source; `eligible` means the source could do it but the plan has not
chosen to; `not eligible` comes with the reason. In this Program the `WHERE`
reads the model's answer, so it can only run after `INFER`, and its engine,
like the join's, is chosen during the Run. `host:local` is fixed here because
the project runs on a Local Host; on a remote Host or ActQL Cloud the Site can
be deferred too. With [Catalog statistics](#estimates-limits-and-actual-figures)
the plan shows estimates and a `proposed` engine instead.

`explain` uses the same parameters, connections and Host configuration as
`run`. `--json` returns the same explanation as data (`actql-explanation/0.1`).

## How pushdown is decided

A Connector declares its **Capabilities**: which reads and writes it offers,
and what the system can compute itself — filtering, projecting columns,
aggregating, sorting, limiting. The planner hands an operation to the source
only when three things hold:

1. The Connector declares the capability.
2. The result is exactly what the Program's meaning requires: the same rows,
   the same order where order matters, the same failure behaviour, the same
   permission boundary and no wider scope of observed data.
3. The operation can be evaluated at the source with its dependencies and
   its meaning intact — the order it was written in does not decide this.

So a `WHERE` written after a `JOIN` may still run inside the source if it
only touches that source's columns, and an aggregation runs in a warehouse
whenever the warehouse can do it; a condition that reads a model's answer
cannot move before the `INFER` it depends on. What cannot be pushed down
runs in local compute. Pushdown never changes a result; it changes where the
work happens and how much data moves.

`explain --verbose` shows the decision for each condition. With two filters
added before the model step:

```sql
SELECT a.id AS id, a.description AS notes, u.active_users, u.trend
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
WHERE a.status = 'Active' AND u.active_users < 20
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
```

```text
$ actql explain churn-risk.aql --verbose
…
Pushdown
  [1] a.status = 'Active'
      Eligible: Salesforce
      Decision: selected
  [2] u.active_users < 20
      Eligible: Snowflake
      Decision: selected
  [5] risk.outcome = 'ok' AND risk.value.level = 'high'
      Eligible: after [4] only
      Decision: host
      Reason: depends on INFER output
```

Each condition goes to the source whose columns it reads. The conditions on
`risk` stay on the Host. *Eligible* and *decision* are separate: a condition
can be eligible and still kept on the Host. When a source cannot evaluate a
condition exactly, the plan also lists a `Residual` that the Host evaluates
again.

`actql catalog show snowflake` lists a connection's Capabilities.

## Where a join runs

Work that spans sources runs on a Site that can see both inputs, usually your
machine, where the Host has two engines: its built-in engine and DuckDB,
which the standard `@actql/node`, `actql` and CLI packages bundle (the
lightweight SDK has no engine). The Host compares the candidates that keep
the meaning, the permissions and the resource limits, weighing the kind of
operation, the engines' Capabilities, and the cost of starting, transferring,
holding and computing; the input sizes it learns during the Run are one input
to that, not the rule. Until the information it needs exists, `explain` shows
the choice as `deferred`. `explain --verbose` shows the options:

```text
[3] JOIN  [1] + [2]
    Kind: inner
    Condition: a.id = u.account_id
    Site: host:local (fixed)
    Engine: deferred
      ActQL RelA            candidate
      DuckDB                candidate
    Excluded
      connector:snowflake   moving [1] into Snowflake is not permitted on this Host
    Input rows: unknown (no catalog statistics)
    Output limit: 50,000 (Host policy)
    Transfers: [1] Salesforce → host:local, [2] Snowflake → host:local
    Selection: when [1] and [2] report their row counts
```

Joining inside Snowflake is excluded here because this Host does not permit
moving the Salesforce rows into Snowflake; a source becomes a candidate when
both inputs can be made available on it, the transfer is permitted and the
source declares the Capability. A Program that needs more than a local
machine runs on a remote Host or ActQL Cloud unchanged; the Site then names
that worker.

## Estimates, limits and actual figures

Every plan has a ceiling for each quantity that matters: rows read per
source, bytes, distinct items sent to a model, model calls and tokens, Effect
items. They come from three places — the Connector and model task contracts,
the Host's policy, and guards in the Program:

```sql
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> WHERE a.industry = 'SaaS'
|> LIMIT 5000
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.description, active_users = u.active_users, trend = u.trend) AS risk
     MAX ITEMS 5000
```

`LIMIT 5000` asks for at most 5,000 rows and gets them; `MAX ITEMS 5000` is a
guard — if more items would be sent, nothing is sent and the step fails.

`explain` keeps three figures apart: an **estimate** (from Catalog statistics,
with its source and date, or `unknown`), a **limit** that is always enforced,
and the **actual** figure, which exists only after a Run. An unknown amount is
never treated as zero.

A plan whose limits cannot be established is refused rather than run
unbounded. At run time, exceeding a limit stops the work with an error; no
partial result is ever returned as if it were complete. If the model step
would exceed its item limit, no model call is made at all.

## After the Run

`explain --run` shows what a Run actually did, from its recorded evidence. It
reads nothing again and resends nothing:

```text
$ actql explain --run run_01J…

ActQL EXPLAIN · run
Run: run_01J…      Status: succeeded
Source: recorded Run evidence; nothing is re-read or re-sent

[1] READ  salesforce.accounts
    Site: connector:salesforce
    Interface: Salesforce API
    Rows received: 2

[2] READ  snowflake.usage_30d
    Site: connector:snowflake
    Engine: Snowflake SQL
    Rows received: 2

[3] JOIN  [1] + [2]
    Site: host:local
    Engine: ActQL RelA (realized)
      Chosen at run time: both inputs were small
    Rows: 2 + 2 → 2

[4] INFER  churn-risk.v1
    Calls: 2    Outcomes: 2 ok

[5] WHERE  risk.outcome = 'ok' AND risk.value.level = 'high'
    Site: host:local
    Engine: ActQL RelA (realized)
    Rows: 2 → 2

[6] EFFECT UPDATE  salesforce.Account
    Checkpoint: ckpt_… approved
    Items: 2    Applied: 2

Not measured: transfer bytes for [1]
```

Figures that were not measured are listed as such. An engine chosen during
the Run says why, and a choice the Host revised while the Run was in progress
— because an input turned out larger than estimated, or a Site became
unavailable — is listed with its reason and the time, so the static plan and
the realized execution can be read side by side. A revision changes only work
that has not started; the Program's meaning, limits and approvals do not move.

## When the plan is not what you expected

- **A filter did not move to the source.** The Connector lacks the capability
  for that predicate (for example a function it cannot evaluate), or the
  predicate depends on another source. Rewrite it in terms the source
  supports, or accept that it runs locally.
- **The join engine is `deferred`.** No statistics are available before the
  Run. The engine is chosen once the inputs report their sizes; the choice
  has no effect on the result.
- **The Effect is not behind a Checkpoint.** Policy routed it to `allow`.
  Add `--stop-before commit` to inspect the Preview anyway.
- **Limits are unknown.** `explain` marks estimates it cannot back with
  evidence as unknown instead of guessing. Catalog statistics from a
  connection make them known.

## Next

- [Connectors](../connectors/README.md): the Capabilities each Connector declares.
- [Runtime limits](https://actql.com/docs/actql/reference/limits): default ceilings.
- [Execution model and guarantees](https://actql.com/docs/actql/concepts/execution-model#placement-and-pushdown): what placement preserves.
