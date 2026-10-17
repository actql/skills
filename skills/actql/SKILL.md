---
name: actql
description: "Set up ActQL and write, check, explain and run ActQL Programs: GoogleSQL with Pipe syntax that reads SaaS APIs, warehouses and databases as one database, calls an LLM with INFER and writes back with an approved EFFECT. Use when the user mentions ActQL, .aql files, actql commands, joining Salesforce/Snowflake/HubSpot/Sheets-style systems with SQL, or asks to start ActQL setup, install actql, or run a Program with a Checkpoint."
license: Apache-2.0
metadata:
  actql-docs-repo: actql/actql
  actql-docs-ref: d904416674e43269d3b7ecf753051a72f27d0651
  actql-version: "0.1"
  actql-skills-version: "actql-skills/0.1"
---

# ActQL: set up, write, check, run, approve

ActQL lets a Program read SaaS APIs, warehouses, files and databases as if
they were one database, decide with an LLM (`INFER`) and write back through
an Effect that is previewed before it is applied. A Program is GoogleSQL with
Pipe syntax. This skill covers the whole loop from an empty machine to an
approved write. Read a reference file only at the step that names it.

## Step 0. Look before asking

Run `scripts/detect-environment.sh` from the project directory. It prints a
JSON object with the `actql` CLI version (or `null`), Node and Python
versions, whether `package.json`, `pyproject.toml` and `actql.config.json`
exist, and whether `@actql/node` or `actql` is already a dependency. Do not
ask the user anything the output already answers.
Dependency fields describe the manifest declarations, not a completed
installation. `null` means the manifest could not be parsed with an available
language tool; inspect it before deciding a dependency is missing.

- `actql.config.json` exists and `actql` is installed: skip to Step 3.
- `actql` is installed but there is no project: skip to Step 2.

## Step 1. Choose the packages (two questions)

Ask only what the environment did not settle:

1. **Where will Programs run?**
   - *On this machine or inside the user's own application*: the standard
     packages. They contain the engine and DuckDB, so medium-to-large joins
     run on the machine without anything extra.
   - *Only call a remote ActQL Host or ActQL Cloud*: the lightweight SDK. It
     has no engine; the user needs the Host's `actql://` connection string
     and a token from whoever runs that Host.
2. **How will ActQL be driven?** CLI, TypeScript, Python, or several.

Then install:

| Programs run | Driven from | Command |
| --- | --- | --- |
| this machine / own app | CLI | `npm install -g actql` |
| this machine / own app | TypeScript | `npm install @actql/node` |
| this machine / own app | Python | `uv add actql` (or `pip install actql`) |
| remote Host / Cloud only | TypeScript | `npm install @actql/sdk` |
| remote Host / Cloud only | Python | `uv add actql-sdk` (or `pip install actql-sdk`) |
| remote Host / Cloud only | CLI | `npm install -g actql` (the CLI also connects to a remote Host) |

Rules that apply to every combination:

- Install the CLI as well whenever an agent will write Programs, even for an
  app built on the SDK: `check`, `explain` and `run` are how a Program is
  verified before the app runs it.
- Node.js 22 or later; Python 3.11 or later. If the machine is older, stop
  and say so; do not try to work around it.
- Hybrid modes (a local Host with Cloud assistance, or a Cloud-owned Run
  using local Runners) exist but are not part of first setup. If the user
  asks, read `references/guides/hosts.md`.
- If `npm install` or `pip install` answers that the package does not exist,
  the package has not been published yet. Say exactly that and point to
  `references/reference/status.md`. Never guess another package name or
  install something that merely sounds similar.

Verify: `actql version`, then `actql sql "SELECT 1 AS id"`. Both must
succeed before anything else. Details per surface are in
`references/getting-started/install.md`.

## Step 2. Create the project

For a first run, use the template so the user sees a Checkpoint within a
minute:

```sh
actql init --template churn-risk-mock churn-risk && cd churn-risk
actql run churn-risk.aql --stop-before commit
```

Show the user the Checkpoint output (the two Salesforce accounts it would
update) and explain that nothing was written. `references/getting-started/quickstart.md`
walks through every file the template created and the approve/status loop.

For the user's own work, `actql init` creates `actql.config.json`,
`connectors.json`, `model-tasks.json` and the `.actql` state directory.
Add connections to `connectors.json` (`{"env": "…"}` or `{"path": "…"}` for
credentials, never literal secrets) and model tasks to `model-tasks.json`;
the fields are in `references/reference/configuration.md`. Keep `.actql`
out of version control.

## Step 3. Write the Program

A Program is one query: GoogleSQL, then `|>` steps, ending in at most one
data-changing Effect. Start from `references/authoring.md` (how to write
Programs) and keep `references/reference/syntax.md` open for exact forms.

```sql
SELECT a.id AS id, a.description AS notes, u.active_users, u.trend
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> RESULT updates
|> EFFECT UPDATE salesforce.Account
     ID id SET (Churn_Risk__c = risk.value.level, Risk_Reason__c = risk.value.reason);
```

Before writing against a connection, read that Connector's page in
`references/connectors/<name>.md` (snowflake, bigquery, duckdb, salesforce,
hubspot, notion, kintone, slack, github, tableau, sheets, drive, gmail,
calendar, gcs, s3, local-files). It lists the sources and their keys, the
Effects and operations, and what pushes down. `actql catalog show <conn>`
prints what the configured connection actually exposes; prefer it over
memory.

What to read when:

- Model calls (`INFER`, model tasks, answers file, `ON FAILURE FAIL`):
  `references/guides/models.md`.
- SQL you are unsure ActQL accepts: `references/reference/sql-compatibility.md`.
- Types, NULL rules, functions: `references/reference/types-and-functions.md`.
- Files and content (`LIST_FILES`, `contents`, `SERIALIZE`, `STORE`):
  the "Working with files" section of `references/authoring.md`.

## Step 4. Check, then explain

```sh
actql check program.aql --json
```

Read `verdict` and `runnable`. `verdict: invalid` lists reasons; look each
`code` up in `references/reference/check-reasons.md` and fix the Program.
`runnable: no` means the Program is valid but this Host cannot run it yet
(a Parameter unbound, a model task not registered, a Capability missing);
fix the binding or configuration, not the Program. Do not run until both
are satisfied.

```sh
actql explain program.aql
```

Each numbered block is one operation with its Site (where it runs) and
Engine. `deferred` means the Host decides during the Run; that is normal for
a join whose input sizes are unknown. `Checkpoint: conditional` on the Effect
means policy decides at run time whether a person is asked. Read
`references/guides/plans-and-pushdown.md` to interpret pushdown and
residuals.

## Step 5. Run, stop before the write, hand over the decision

```sh
actql run program.aql --stop-before commit
actql status <run-id> --json
```

The Run stops at a Checkpoint with a Preview: the exact records and values
that would be written. Show the Preview to the user. **The agent does not
approve.** Approval belongs to the Host's policy or to a person:

```sh
actql approve <checkpoint-id>      # the user runs this, or a decider in code
actql status <run-id> --watch
```

After approval, every Effect item ends `applied`, `accepted` (the system
took it and confirms later), `failed` or `unknown`. An `unknown` item is
reconciled through the Connector's own evidence and is never resent. Read
`references/guides/effects-and-approvals.md` for what the Preview holds and
`references/guides/run-lifecycle.md` for the states.

Read the result:

```sh
actql result <run-id> --result updates --format jsonl
```

## Step 6. When something fails

Read `references/guides/debugging.md` first: it separates *invalid*
(the Program), *incomplete* (bindings or configuration) and *cannot run on
this Host* (see `references/reference/status.md`). When reporting a problem
to the user or a maintainer, include the output of `actql check --json
--redact`, `actql explain --json --redact` and `actql status <run> --json
--redact`.

## Gotchas

- The documentation describes ActQL 0.1 as designed; `references/reference/status.md`
  is the one page that says what runs today. Before relying on a form
  (short Effect forms, `STORE`, `COMMAND`, event or graph calls), check its
  row there and tell the user when something is still planned.
- One data-changing Effect per Program text, always the last step of the
  Pipe. A notification after a write is a Command postlude after the `;`,
  not a second Effect. Ordered work is separate Stages, not several
  statements.
- `--json` prints the command's result (a Run state, a check report, a
  plan); `--format` chooses how Result rows are encoded. They are not the
  same flag.
- `INFER` needs one row per item key. After a join or an aggregation, prove
  the key with `|> ASSERT UNIQUE BY (…)` when `check` cannot.
- Pipe syntax is GoogleSQL's own; what ActQL adds is `INFER`, `NEAREST`,
  `SERIALIZE`, `RESULT`, `ASSERT UNIQUE BY`, the named calls and `EFFECT`.
  `CALL`, a standalone `WINDOW` step and `TABLESAMPLE` are refused.
- Credentials never go into a Program or into `connectors.json` literally;
  they are environment variables or files the Host reads.
- `.actql` is the Run state. Deleting it loses the ability to resume or
  reconcile; keep it out of version control and back it up like a database.
