<!-- Generated from actql/actql@747e5c2771ca docs/guides/hosts.md; do not edit. The published page is https://actql.com/docs/actql/guides/hosts -->
# Local and remote Hosts

This page is for whoever runs ActQL: it explains what the Host owns, how to
configure a Local Host in a project, where its Store lives, how connections and
credentials are declared, and how policy decides which reads, model calls and
Effects may proceed. It ends with remote Hosts and ActQL Cloud. For the ideas
behind the Host, read [Architecture](https://actql.com/docs/actql/concepts/architecture).

## What the Host owns

A Program never contains credentials, policy or limits for the environment it
runs in. Those belong to the Host:

- **Connections and credentials** — which external systems are reachable, and
  how to authenticate to them.
- **Policy** — for each read, model call and Effect, whether it is allowed,
  denied or handed to a decision.
- **Model tasks** — the registered definitions a Program's `INFER` refers to.
- **The Store** — the durable record of every Run: observations, model
  answers, Previews, Checkpoints, Results and the Effect ledger.
- **Limits** — the resource ceilings the Host adds on top of the Program's own.

The same Program runs under any Host that has what it needs. Moving from your
machine to a server changes the configuration, not the Program.

## A Local Host in a project

The CLI and the embedded Node and Python Hosts read `actql.config.json`,
searched from the current directory upward. Paths are relative to the file.

```json
{
  "version": "actql-config/0.1",
  "connectors": "./connectors.json",
  "model_tasks": "./model-tasks.json",
  "state_dir": "./.actql"
}
```

| Field | Meaning |
| --- | --- |
| `connectors` | The connections file: which Connectors are installed and how they authenticate. |
| `model_tasks` | The model task registry: task definitions and model providers. See [Models and INFER](models.md). |
| `state_dir` | Where the Store lives. Default `./.actql`. |
| `lock` | The lock file that pins the resolved Connector and model task contracts. |
| `mock` | Fixture files for the mock profile. |

Command flags such as `--config`, `--connectors` and `--model-tasks` override
the discovered file for one command. The full field list is in
[Configuration](../reference/configuration.md).

Finding a file and trusting it are different things. The project file is
discovered, so anything you clone may carry one; it supplies connections,
model tasks, the Store location and fixtures — nothing that grants
permission. Who may do what, and who may approve, is **Host configuration**:
`~/.config/actql/host.json`, created by `actql init`, or a file named with
`--host-config`:

```json
{
  "version": "actql-host/0.1",
  "account_config": "./accounts.json",
  "effect_policy": { "decision": "review" },
  "signers": { … }
}
```

| Field | Meaning |
| --- | --- |
| `account_config` | The execution-account configuration: who may do what, per connection, resource and operation. Optional; see [Policy](#policy-who-may-do-what). |
| `run_policy`, `effect_policy` | What happens when policy delegates a decision: `allow`, `review` (wait at a Checkpoint) or `deny`. |
| `signers` | Identities that may approve Checkpoints from the CLI. |

A project file cannot widen permissions or add signers, so cloning a
repository never changes what may be written or who may approve it.

## The Store

The Store is the directory named by `state_dir`. It holds what a Run needs to
continue and what you need to see what happened: captured observations, the
model answers that were adopted, Previews, Checkpoints, Results and the
outcome of every Effect that was sent. It is encrypted at rest with keys the
Host manages.

- Keep it out of version control (add `.actql/` to `.gitignore`).
- Keep it while you still need its Runs and Results: `status`, `result` and
  `attach` read from it, and a Run resumes from it after a restart.
- Retention is a Host setting. Runs and their evidence are kept for the
  configured period; nothing is kept forever by default.

Two processes that point at the same `state_dir` share the same Host state.
The Store coordinates them with leases and fencing: one process drives a Run
at a time, and a stale process cannot overwrite a newer state. Opening the
directory again later lets you look up and attach to the Runs it holds.

## Connections and credentials

`connectors.json` names each connection and says how it authenticates. A
Program refers to a connection by its name, as the first part of a source such
as `salesforce.accounts`.

```json
{
  "version": "actql-connectors/0.1",
  "connections": {
    "salesforce": {
      "connector": "salesforce",
      "instance_url": "https://acme.my.salesforce.com",
      "credentials": {"access_token": {"env": "SALESFORCE_ACCESS_TOKEN"}}
    },
    "snowflake": {
      "connector": "snowflake",
      "account": "acme-prod", "warehouse": "ANALYTICS", "database": "PRODUCT",
      "user": "ACTQL",
      "credentials": {"private_key": {"path": "./keys/snowflake.p8"}}
    }
  }
}
```

Secrets are referenced, never written into the file: each credential names
an environment variable (`{"env": …}`) or a file (`{"path": …}`). The Host reads them when it opens the connection and
lends them to the Connector only for an operation that policy has admitted.
Each Connector page under [Connectors](../connectors/README.md) lists the
fields it needs.

`actql catalog show salesforce` prints what a connection exposes — its sources
and their columns, and the operations and capabilities the Connector declares —
so you can see what a Program may refer to before writing it.

## Policy: who may do what

Every protected boundary — reading a source, calling a model, sending data
out, applying an Effect — is decided by policy before it happens. The decision
has two layers.

### 1. The execution-account configuration

You do not need one to start. Without an `account_config`, a Local Host
applies its standard policy:

| Operation | Standard policy |
| --- | --- |
| Pure computation (`SELECT 1`, local values) | runs |
| A read from a connection you configured | runs |
| `INFER` through a model task you registered | runs |
| Any Effect — `UPDATE`, `INSERT`, `STORE`, `COMMAND` | delegated to `effect_policy`; its default, `review`, previews it and waits for approval |
| An operation an entry denies | refused |

Write an account configuration when you want to restrict — a team policy, a
read-only connection, a task only one principal may call — or to let a
specific Effect through without approval. Refusing an operation nobody
granted and the experience before any configuration exists are different
things: the first is a rule you write, the second is the Host's standard
policy.

`accounts.json` routes each combination of **principal × connection ×
resource × operation** to one of three outcomes:

| Outcome | Meaning |
| --- | --- |
| `allow` | Proceed. No Checkpoint, no decision callback. |
| `deny` | Do not dispatch. Nothing can override it. |
| `delegate` | Hand the decision to the Host's decider (next section). |

Operations are `read`, `infer`, `write` and `effect`. A read is an operation
on the source's connection; a model call is an operation on the model
provider's connection (`openai` below), not on the connection the rows came
from. Selectors are either `{"all": true}` (current and future members) or
`{"any_of": [...]}` (an exact list). Once a configuration exists, a tuple no
entry matches is denied, and two entries that overlap with different outcomes
are a configuration error — there is no priority order to reason about.

```json
{
  "version": "actql-execution-account-config/0.1",
  "account_id": "acme-local",
  "entries": [
    { "entry_id": "reads", "outcome": "allow",
      "principal": { "all": true }, "connection": { "any_of": ["salesforce", "snowflake"] },
      "resource": { "all": true }, "operation": { "any_of": ["read"] } },
    { "entry_id": "model-calls", "outcome": "allow",
      "principal": { "all": true }, "connection": { "any_of": ["openai"] },
      "resource": { "any_of": ["model-task:churn-risk.v1"] }, "operation": { "any_of": ["infer"] } },
    { "entry_id": "salesforce-writes", "outcome": "delegate",
      "principal": { "all": true }, "connection": { "any_of": ["salesforce"] },
      "resource": { "all": true }, "operation": { "any_of": ["effect"] } }
  ]
}
```

With this file, reads on both connections and calls to the churn-risk task
through `openai` go straight through, every Effect on Salesforce is handed to
the decider, and everything else — a read from a third connection, another
task, a Snowflake Effect — is denied.

### 2. The decider

A delegated decision goes to whatever the operator set up: a rule, an approval
application, a person, or a combination. In a Local Host the simplest decider
is the configuration itself:

```json
"effect_policy": { "decision": "review" }
```

`allow` permits immediately, `review` waits at a Checkpoint until someone
approves or rejects it, and `deny` rejects immediately. `run_policy` does the
same for decisions about the Run as a whole. These apply only to delegated
decisions: they never override an account `deny`.

A decider can also be your own code. An embedded Host calls the `decide`
option of `connect()` with the exact decision subject — for an Effect, the
Preview of what would change — and it answers permit, reject or defer. The
classic routing is by size:

```ts
const client = await connect({
  mode: 'local', installation: {directory: '.actql'},
  decide: async (decision) => {
    if (decision.kind !== 'effect_set') return 'permit';          // reads and model calls go through
    if (decision.preview.items.length <= 100) return 'permit';    // small updates: a rule approves
    return 'defer';                                               // larger ones wait for a person
  },
});
```

Whatever the decider is, it can only decide. It cannot change what is written,
and an unanswered or failing decider means nothing is dispatched. See
[Effects and approvals](effects-and-approvals.md) for the Checkpoint that a
deferred decision creates.

### Signers

Approving a Checkpoint from the CLI records who approved it. `signers` names
the identities the Local Host accepts and which Checkpoint kinds each may
resolve:

```json
"signers": {
  "ops-approver": {
    "principal": "ops", "key_id": "ops-2026",
    "private_key": "./keys/ops.pem", "public_key": "./keys/ops.pub.pem",
    "checkpoint_kinds": ["effect_set"]
  }
}
```

`actql approve ckpt_… --signer ops-approver` then produces an authenticated
Resolution bound to that exact Checkpoint.

A Local Host without configured signers uses the local signing key that
`actql init` generates in the Store, so approvals are still signed and bound
to their Checkpoint; the key identifies the machine's user, not a verified
person. For production, configure signers whose decisions the Host can
verify.

## The mock profile

`--profile mock` (CLI) or `profile: 'mock'` (SDK) runs a Program against mock
Connectors and a mock model: reads return the records in the configuration's
`mock.data` file, the model returns the answers in `mock.answers`, and Effects
are applied to the mock records only, after the same Checkpoint as a real run.
Policy is the same standard policy as for real connections.
Everything else — checking, planning, policy, the Store, Checkpoints,
resumption — is the real Host. It needs no credentials, which makes it the
right place to try a Program, write tests and reproduce a failure.

## Remote Hosts

A remote Host serves Programs over HTTPS. Your application uses the same SDK
with a connection string instead of a directory:

```ts
const client = await connect({mode: 'remote', endpoint: 'actql://host.acme.internal', token: process.env.ACTQL_TOKEN});
```

`endpoint` is an `actql://` connection string or the Host's `https://` URL.
Connections, credentials, policy and the Store then live on the server; the
caller holds only a token. Checkpoints created there are approved through the
same SDK calls. The Program is the same file in both cases.

ActQL Cloud is a managed remote Host: nothing of your own to operate, and room
for work that does not fit a local machine. It runs the same Core, so a Program
that runs locally runs there unchanged.

## Next

- [Effects and approvals](effects-and-approvals.md): what a Checkpoint shows and how it is resolved.
- [Models and INFER](models.md): registering model tasks and providers.
- [Configuration](../reference/configuration.md): every field of the configuration files.
