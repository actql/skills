<!-- Generated from actql/actql@84d4ef5bff33 docs/cli.md; do not edit. The published page is https://actql.com/docs/actql/guides/cli -->
# CLI reference

`actql` drives Programs from the command line: check them, see their plan, run
them, approve what they want to write, and follow the Run until it ends. This
page lists every command. For a guided first run, start with the
[Quickstart](getting-started/quickstart.md).

```sh
npm install -g actql
actql version
```

## The golden path

```sh
actql check churn-risk.aql        # static validation, reads nothing
actql explain churn-risk.aql      # the plan, reads nothing
actql run churn-risk.aql          # reads, computes, writes (or stops at a Checkpoint)
actql status run_…                # where the Run is
```

When policy defers a write, `run` prints the Run and Checkpoint references
and exits with the Run in `waiting_checkpoint`. Decide with `approve` or
`reject`, then follow it with `status`:

```sh
actql approve ckpt_…
actql status run_… --watch
```

`run` never prompts. It is safe to call from automation: it returns as soon as
the Run reaches a stable state — waiting for a decision, waiting for
reconciliation, or finished — and `--json` gives you that state as data.

Two flags look alike and mean different things: `--json` prints the
**command's result** (a Run state, a check report, a plan) as JSON; `--format`
chooses the encoding of **Result rows** (`table`, `json`, `jsonl`, `csv`) on
`sql`, `aql` and `result`.

## Starting a project

```text
actql init [--template churn-risk-mock] [<directory>]
```

`init` creates a project: `actql.config.json`, the connectors and model task
files, a `.actql` Store with its local signing key, and — with a template —
a complete Program with mock fixtures that runs without credentials. The
[Quickstart](getting-started/quickstart.md) starts from
`actql init --template churn-risk-mock`.

## Quick queries

```text
actql sql <query> [--params <file>] [--format <table|json|jsonl|csv>] [--output <file>]
actql aql <query> [--params <file>] [--format <table|json|jsonl|csv>] [--output <file>]
```

```text
$ actql sql "SELECT id, name FROM crm.accounts WHERE owner = 'kim' LIMIT 3"
id    name
----  -----------
001…  Acme
002…  Globex
003…  Initech
```

**`sql`** takes an ordinary `SELECT`; **`aql`** takes Pipe syntax
(`FROM … |> …`). Both read through the configured Connectors and print the rows
(`table` by default). They are the command-line form of the libraries' `sql()`
and `aql()`: read-only, no Effects, no Checkpoints. A query with an Effect is
refused; put it in a Program file and use `run`.

## Configuration

The CLI looks for `actql.config.json` in the current directory and its
parents. Paths in it are relative to the file:

```json
{
  "version": "actql-config/0.1",
  "connectors": "./connectors.json",
  "model_tasks": "./model-tasks.json",
  "lock": "./actql.lock.json",
  "state_dir": "./.actql",
  "profile": "mock"
}
```

| Field | Meaning |
| --- | --- |
| `connectors` | Connections to external systems and their credentials references ([Connectors](connectors/README.md)) |
| `model_tasks` | Path of the model task registry, `model-tasks.json` ([Models and INFER](guides/models.md)) |
| `lock` | Lock file pinning the Connector and model task versions a Program was checked against |
| `state_dir` | The Store: Runs, observations, Checkpoints, Results. Keep it out of version control |
| `profile` | `mock` replaces every Connector and model with stand-ins that answer from the `mock` fixture files |
| `mock` | The fixture files: records per Connector and answers per model task |

Who may do what, and who may approve — `account_config`, `effect_policy`,
`signers` — is Host configuration, read from `~/.config/actql/host.json` or
the file named with `--host-config`, never from a project file
([Local and remote Hosts](guides/hosts.md#a-local-host-in-a-project)).
Every command accepts `--config <file>` to use another project file. Command
flags override the file. The full schema is in the
[configuration reference](reference/configuration.md).

## Core commands

```text
actql check <program> [--params <file>] [--bindings <file>] [--json] [--redact]
actql explain [<program>] [--params <file>] [--input <name=file>] [--stop-before <boundary>] [--verbose] [--json] [--redact]
actql explain --run <run> [--verbose] [--json] [--redact]
actql run <program> [--params <file>] [--input <name=file>] [--stop-before <boundary>]
                    [--deliver <result=format:file>] [--output <file>] [--receipt <file>] [--json]
```

**`check`** validates the Program against the definitions the Host publishes:
names, types, model tasks, Effect targets and the permissions it would need.
It reads no business data and calls no provider. It exits 0 for a valid
Program and 1 for an invalid one, printing each reason with its code and line
([check reasons](reference/check-reasons.md)). Valid does not mean runnable
here and now: the report also says whether the Program is `runnable` and, if
not, why — a parameter not yet bound, a Capability this Host lacks, a model
task not registered. Read that field, not the exit code, to decide whether to
`run`.

**`explain`** prints the plan: each operation with the Site and Engine it
will use, what is pushed down to a source, where a model is called and where
the Run may stop for approval. Choices that depend on data, such as the engine
for a join, are shown as decided at run time. It creates no Run, reads no
business data and calls no model. It takes the same inputs as `run`.
`--verbose` adds the decision for each condition and the options for each
deferred choice. `explain --run <run>` shows what a finished or waiting Run
actually used, from its record. See [Plans and pushdown](guides/plans-and-pushdown.md).

**`run`** checks the Program, then executes it as a durable Run. Options:

| Option | Meaning |
| --- | --- |
| `--params <file>` | JSON values for `@name` parameters |
| `--input <name=file>` | A local file bound as a table input |
| `--stop-before commit` | Stop at a Checkpoint before the first Effect is applied, even if policy would allow it. Use it to see what would be written. `commit` is the boundary name; it is the only one in 0.1 |
| `--deliver <result=format:file>` | Write a named Result to a file as `json`, `jsonl` or `csv` (repeatable) |
| `--output <file>` | Write the sole Result to a file |
| `--receipt <file>` | Save the Run receipt (reference and outcome) for later verification |
| `--json` | Print the Run state as data instead of the human summary |

`run` publishes Results and reports the Run state; it does not stream rows.
Read them with `result` or deliver them to files.

All three commands accept `--connectors`, `--model-tasks` and `--lock` to
override the configured files, and `--bindings <file>` for pre-bound inputs.

## Operations on a Run

```text
actql status <run> [--watch [--until <state>]] [--timeout <duration>] [--json] [--redact]
actql approve <checkpoint> [--signer <id>] [--wait] [--json]
actql reject <checkpoint> [--signer <id>] [--json]
actql cancel <run> [--json]
actql reconcile <run> [--effect <name>] [--json]
actql result <run> [--result <name>] [--format <json|jsonl|csv>] [--output <file>]
                   [--deliver <result=format:file>] [--receipt <file>] [--json]
```

**`status`** reads the Run's state once — its Checkpoint if it is waiting,
the outcome of each Effect item once they exist — and sends nothing to any
external system. `--watch` prints each change and returns at the next state
that needs you: `waiting_checkpoint`, `needs_reconciliation` or a final state.
`--watch --until final` keeps following through approvals; `--timeout` bounds
either. A request that policy held before the Run started shows as `held`
with its Checkpoint, and `approve` resolves it the same way.

**`approve`** and **`reject`** answer a Checkpoint — one inside a Run, or
one that held a request before the Run started. The answer is bound to the
exact preview the Checkpoint holds. When `signers` are configured, it is
signed with `--signer` (or the default signer); a Local Host with no signers
signs with the local key `actql init` created, which identifies the machine's
user, not a verified person. Approving continues the
same Run without redoing finished work; `--wait` follows it. Rejecting ends
the Run as `cancelled` with nothing sent (or `needs_reconciliation` if an
earlier write's outcome is still unknown).

**`cancel`** asks the Run to stop. It becomes `cancelled` once stopping is
confirmed and no outcome is unknown; writes already applied stay applied.

**`reconcile`** asks the Host to resolve an unknown Effect outcome by checking
with the external system, through the Connector and contract recorded in the
Run — there is no flag to point it at another connection. It never resends
the write. If the outcome is still unknown, the Run stays in
`needs_reconciliation` and the attempt is recorded.

**`result`** reads a named Result of a finished Run — to stdout with
`--format`, or to files with `--output` / `--deliver`. `--receipt` saves a
delivery receipt for `verify output`.

```text
$ actql result run_… --result updates --format jsonl
{"id":"001Acme","notes":"Evaluating a competitor; usage down since June.","active_users":4,"trend":"down","risk":{"outcome":"ok","value":{"level":"high","reason":"falling usage and a competitor evaluation"}}}
```

## Individual operations

For an Effect whose outcome needs attention on its own:

```text
actql operation status <operation> [--json]
actql operation reconcile <receipt> [--effect <name>] [--output <file>]
actql operation cancel <operation> [--json]
```

## Discovery

What the configured Connectors and model tasks expose:

```text
actql catalog list [--json]
actql catalog show [<connector-id>] [--json]
actql catalog refresh <connector-id> [--json]
actql model-task list [--json]
actql model-task show <model-task-id> [--json]
actql discovery describe [--json]
actql discovery list --snapshot <cid> [--kind <kind>] [--selector <selector>] [--cursor <cursor>] [--page-size <count>] [--json]
actql discovery read --snapshot <cid> --kind <kind> --selector <selector> --content-cid <cid> [--json]
```

`catalog show salesforce` prints everything a Program can rely on for a
connection: its sources with columns, types and keys, the Effects per
resource with their preview strength, the operations with their inputs, the
Capabilities, and the permissions each read and write needs
([Connectors](connectors/README.md#what-catalog-show-tells-you)). It reads
the Catalog the Host has stored; `catalog refresh <connector-id>` asks the
external system for its current metadata.

The language itself:

```text
actql op list [--family <family>] [--output <carrier>] [--json]
actql op show <operation> [--json]
actql op search <words...> [--json]
actql expr list [--category <category>] [--json]
actql expr show <expression> [--json]
actql expr search <words...> [--json]
actql grammar [--json]
actql schema
```

`op` covers the pipe operations, `expr` the functions, `grammar` the accepted
syntax and `schema` the JSON schema of the Program model. Agents use these
instead of guessing.

## Integrity

```text
actql lock [--output <file>]
actql verify lock <lock> [--json]
actql verify output <receipt> <output> [--json]
actql doctor [--connect] [--json]
actql version
```

**`lock`** writes `actql.lock.json`, pinning the versions of every Connector
and model task the project uses; `verify lock` confirms the installed ones
still match. **`verify output`** checks a delivered Result file against its
receipt. **`doctor`** reports the installation, the configuration it found
and what is wrong with either, without contacting anything; `doctor --connect`
also tries each configured connection and provider.

## Profiles

`--profile mock` (or `"profile": "mock"` in the configuration) runs the
Program against mock Connectors and a mock model. The records and model
answers come from the files named under `mock` in the configuration. Every
mock Connector records writes without sending them anywhere, so a Program
can be developed, tested in CI and demonstrated with no credentials. The Checkpoint, approval and status flow is the same as with
real systems.

## Output and exit codes

Commands print a human summary by default and stable JSON with `--json`.
Progress goes to stderr, results to stdout or the files you name. `--redact`
replaces system names, resource names, parameter values and Preview values
with stable placeholders and keeps structure, codes and locations; use it
when sharing output.

| Exit code | Meaning |
| --- | --- |
| `0` | The command completed. The Run may still be `waiting_checkpoint`, `needs_reconciliation` or `failed` — read the state, do not rely on the exit code for the Run's outcome |
| `1` | The command itself failed (`check` found the Program invalid; `run` could not start; a transport failure) |
| `2` | The command line is invalid |

Errors carry a stable `ACTQL_E_*` code in both the human output and the JSON.
Unknown commands, unknown options and extra arguments are errors; options may
come before or after the Program path.

## Next

- [Writing Programs](authoring.md): the language.
- [Effects and approvals](guides/effects-and-approvals.md): what a Checkpoint
  holds and who answers it.
- [Run lifecycle and recovery](guides/run-lifecycle.md): states, interruption,
  unknown outcomes.
- [Configuration reference](reference/configuration.md): every file the CLI
  reads.
