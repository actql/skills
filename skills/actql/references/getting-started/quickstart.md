<!-- Generated from actql/actql@84d4ef5bff33 docs/getting-started/quickstart.md; do not edit. The published page is https://actql.com/docs/actql/getting-started/quickstart -->
# Quickstart

In ten minutes you will run a Program that reads accounts from Salesforce and
usage data from Snowflake, asks an LLM which accounts are at risk of churning,
stops for approval, and writes the answer back to Salesforce — all against
mock systems, so nothing real is touched and no credentials are needed. You
will do it from the CLI first, then from TypeScript and Python.

Install the CLI first ([Install](install.md)):

```sh
npm install -g actql
```

## 1. The project

Let the CLI create the project:

```sh
actql init --template churn-risk-mock churn-risk
cd churn-risk
```

`init` writes seven files and a `.actql` directory for the Host's state.
Everything the Run uses is in these files, so the same result comes out on
any machine — and you can create them by hand just as well. In order:

`actql.config.json` tells the CLI where state and definitions live. The mock
profile replaces every Connector and the LLM with stand-ins that answer from
the fixture files named under `mock`. There is no policy in the project:
`init` also creates the Host configuration (`~/.config/actql/host.json`) if
you have none, and without an `account_config` a Local Host's standard
policy runs reads and `INFER` on the connections and tasks you configured and
sends every Effect to `effect_policy`, whose default, `review`, holds it for
approval:

```json
{
  "version": "actql-config/0.1",
  "connectors": "./connectors.json",
  "model_tasks": "./model-tasks.json",
  "state_dir": "./.actql",
  "profile": "mock",
  "mock": {
    "data": "./mock/data.json",
    "answers": {"model-task:churn-risk.v1": "./mock/churn-risk.v1.answers.yaml"}
  }
}
```

`connectors.json` names the two connections, `salesforce` and `snowflake`,
and the Connector each one uses. Under the mock profile their credentials are
never read, so the entries carry none yet; the Connector pages show what to
add when you point them at real systems.

`model-tasks.json` lists the model tasks the project uses and the model
providers they may call. The mock profile answers for the provider, so no API
key is needed yet:

```json
{
  "version": "actql-model-tasks/0.1",
  "tasks": {
    "model-task:churn-risk.v1": "./model-tasks/churn-risk.v1.yaml"
  },
  "providers": {
    "openai": {"type": "openai", "api_key_env": "OPENAI_API_KEY"}
  },
  "default_provider": "openai"
}
```

`model-tasks/churn-risk.v1.yaml` defines what to ask the LLM and what type
comes back:

```yaml
task: model-task:churn-risk.v1
input:
  notes: string
  active_users: int64
  trend: string
instructions: |
  From the account notes, the number of active users and the usage trend,
  rate the churn risk as low, medium or high and explain why in one line.
  Do not assume facts that are not in the input.
output:
  level: {type: string, enum: [low, medium, high]}
  reason: string
```

`mock/data.json` holds the records the mock Connectors serve: two Salesforce
accounts with their current field values, and their Snowflake usage. `key`
declares each source's key, as a real Connector's Catalog does:

```json
{
  "salesforce": {
    "Account": {
      "key": ["id"],
      "rows": [
        {"id": "001Acme", "name": "Acme Corp", "description": "Evaluating a competitor; usage down since June.",
         "Churn_Risk__c": "low", "Risk_Reason__c": null},
        {"id": "001Globex", "name": "Globex Inc", "description": "Several support tickets about the new pricing.",
         "Churn_Risk__c": "medium", "Risk_Reason__c": null}
      ]
    }
  },
  "snowflake": {
    "usage_30d": {
      "key": ["account_id"],
      "rows": [
        {"account_id": "001Acme", "active_users": 4, "trend": "down"},
        {"account_id": "001Globex", "active_users": 12, "trend": "flat"}
      ]
    }
  }
}
```

`salesforce.accounts` reads these Account records and
`EFFECT UPDATE salesforce.Account` writes to them, as with a real org.

`mock/churn-risk.v1.answers.yaml` is what the mock LLM answers, by item key.
Both accounts are rated high:

```yaml
task: model-task:churn-risk.v1
answers:
  default: { level: low, reason: "stable usage" }
  by_key:
    "001Acme":   { level: high, reason: "falling usage and a competitor evaluation" }
    "001Globex": { level: high, reason: "support tickets about pricing" }
```

`churn-risk.aql` is the Program:

```sql
SELECT a.id AS id, a.description AS notes,
       u.active_users, u.trend
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> RESULT updates
|> EFFECT UPDATE salesforce.Account
     ID id SET (
       Churn_Risk__c = risk.value.level,
       Risk_Reason__c = risk.value.reason
     );
```

Read it top to bottom: join accounts with usage, ask the model about each
account, keep the high-risk ones, publish them as the Result `updates`, write
the risk back. `INFER` needs one row
per account. `id` is the key of `salesforce.accounts` and `account_id` the key
of `snowflake.usage_30d`, so each `id` appears once after the join; `check`
proves this from the declared keys, and refuses the Program if it could not.

## 2. Check it

`check` validates names, types and the definitions the Program relies on, and
says whether the Program is runnable on this Host: a parameter not bound or a
model task not registered makes it valid but not runnable. It reads no data:

```text
$ actql check churn-risk.aql
Check  ok
  Runnable  yes
  Sources
    salesforce.accounts   id, description                  read
    snowflake.usage_30d   account_id, active_users, trend  read
  Model task
    model-task:churn-risk.v1   input (notes, active_users, trend) → level, reason
  Keys
    id unique after JOIN   salesforce.accounts.id = snowflake.usage_30d.account_id
  Effect
    update salesforce.Account   Churn_Risk__c, Risk_Reason__c   write
  Permissions
    salesforce: accounts.read, Account.update
    snowflake:  usage_30d.read
  No data read.
```

Try breaking it — change `risk.value.level = 'high'` to `= 1` — and run
`check` again. It refuses with a named reason and the line:

```text
$ actql check churn-risk.aql
Check  failed
  expression_type_mismatch   line 7
    risk.value.level = 1   level is STRING, got INT64
```

## 3. See the plan

`explain` shows where each part would run, still without reading anything:

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

Reading it top to bottom:

- Each source is asked only for the columns the Program uses.
- The join runs on your machine (`host:local` is fixed because this project
  runs on a Local Host). Which engine computes it is decided during the Run,
  once the number of rows is known, so it shows as `deferred`.
- The `WHERE` reads the model's answer, so it cannot be sent to Salesforce or
  Snowflake. It runs after `INFER`.
- The update may stop for approval: policy decides when the Run gets there,
  so the Checkpoint is `conditional`.

[Plans and pushdown](../guides/plans-and-pushdown.md) explains each field,
`--verbose` and the figures after a Run.

## 4. Run it

`run` reads the data, asks the model and stops before writing. `--stop-before
commit` forces the stop even when policy would let the write through, so you
can see what a Checkpoint looks like:

```text
$ actql run churn-risk.aql --stop-before commit
Run run_…
  Status      waiting_checkpoint
  Checkpoint  ckpt_…
  Effect      update  (Salesforce Account)
  Items       2
  Changes
    Acme Corp     Churn_Risk__c   low     → high
                  Risk_Reason__c  (empty) → falling usage and a competitor evaluation
    Globex Inc    Churn_Risk__c   medium  → high
                  Risk_Reason__c  (empty) → support tickets about pricing
```

The Run is durable. You can close the terminal, restart the machine, and come
back: `actql status run_…` shows the same Checkpoint. Nothing has been written
yet, and the changes listed are exactly what will be written: both fields of
the two accounts in `mock/data.json`, both rated high by the mock answers.

## 5. Approve and finish

```text
$ actql approve ckpt_…
Checkpoint ckpt_…  approved
Run run_…  resuming

$ actql status run_…
Run run_…
  Status   succeeded
  Effect   update  (Salesforce Account)   2 items
    Acme Corp     applied
    Globex Inc    applied
  Results  updates  2 rows

$ actql result run_… --result updates --format jsonl
{"id":"001Acme","notes":"Evaluating a competitor; usage down since June.","active_users":4,"trend":"down","risk":{"outcome":"ok","value":{"level":"high","reason":"falling usage and a competitor evaluation"}}}
{"id":"001Globex","notes":"Several support tickets about the new pricing.","active_users":12,"trend":"flat","risk":{"outcome":"ok","value":{"level":"high","reason":"support tickets about pricing"}}}
```

Approving continues the same Run: the data already read and the model's
answers are reused, not fetched again. `status` shows the outcome of each
write, and `result` reads the `updates` Result the Program published — the
rows the write was made from. To refuse instead, use `actql reject ckpt_…`; the Run ends `cancelled`
with nothing written.

## 6. The same from your application

The CLI is one way to drive a Run. Your application can do the same with
`@actql/node` or the `actql` Python package, with no server to run.

TypeScript:

```ts
import {readFile} from 'node:fs/promises';
import {connect} from '@actql/node';

const client = await connect({mode: 'local', installation: {directory: '.actql'}, profile: 'mock'});
try {
  const source = await readFile('churn-risk.aql', 'utf8');
  const execution = await client.startSource(source, {format: 'aql', stopBefore: 'commit'});
  const state = await execution.wait();
  console.log(state.status); // 'waiting_checkpoint'
  await client.approve(state.checkpoint.id);
  console.log((await execution.wait()).status); // 'succeeded'
} finally {
  await client.close();
}
```

Python:

```python
import actql

with actql.connect(mode="local", installation=".actql", profile="mock") as client:
    source = open("churn-risk.aql").read()
    execution = client.start_source(source, format="aql", stop_before="commit")
    state = execution.wait()
    print(state.status)  # "waiting_checkpoint"
    client.approve(state.checkpoint.id)
    print(execution.wait().status)  # "succeeded"
```

Each of these starts a new Run, with its own Checkpoint. The CLI, TypeScript
and Python share one Run model and, pointed at the same `.actql` directory,
the same Runs: a Run started from code can be inspected and approved from the
CLI by its Run ID, and the other way round.

## Next

- Point the Program at real systems: [Local and remote Hosts](../guides/hosts.md)
  explains connections, credentials and policy, and the
  [Connectors](../connectors/README.md) pages explain what each system exposes.
- Decide who approves what: [Effects and approvals](../guides/effects-and-approvals.md).
- Write your own Programs: [Writing Programs](../authoring.md).
- Hand ActQL to a coding agent: `npx skills add actql/skills`, then ask it to
  "Start ActQL setup".
