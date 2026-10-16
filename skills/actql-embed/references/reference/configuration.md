<!-- Generated from actql/actql@747e5c2771ca docs/reference/configuration.md; do not edit. The published page is https://actql.com/docs/actql/reference/configuration -->
# Configuration

Every file and environment variable a Host reads, with its fields. This is
the reference; [Local and remote Hosts](../guides/hosts.md) explains how to
put them together. Configuration selects what a Host may do and record; it
never enters a Program's meaning.

## `actql.config.json`

The project file. The CLI searches from the current directory upward for
`actql.config.json` and resolves every path in it relative to the file. The
SDKs accept the same fields as `connect()` options. `--config <file>` on the
CLI selects a different file explicitly, and command flags override its
values. It supplies connections, model tasks, the Store and fixtures; it
cannot grant permission or name signers — those live in the
[Host configuration](#host-configuration) below, which a cloned repository
cannot change.

```json
{
  "version": "actql-config/0.1",
  "connectors": "./connectors.json",
  "model_tasks": "./model-tasks.json",
  "lock": "./actql.lock.json",
  "state_dir": "./.actql",
  "profile": "mock",
  "mock": {
    "data": "./mock/data.json",
    "answers": {"model-task:churn-risk.v1": "./mock/churn-risk.v1.answers.yaml"}
  }
}
```

| Field | Type | Meaning | Default |
| --- | --- | --- | --- |
| `version` | string | Always `actql-config/0.1`. | required |
| `connectors` | path | The [connectors file](#connectors-file). | none; Programs that read or write need it |
| `model_tasks` | path | The [model tasks file](#model-tasks-file), the registry of tasks and providers. | none; `INFER` needs it |
| `lock` | path | The [lock file](#lock-file) that pins Connector and model task contracts. | none |
| `state_dir` | path | The Store: Runs, observations, Results, Checkpoints, keys. Keep it out of version control. | `./.actql` |
| `profile` | string | A named profile such as `mock`, applied unless `--profile` says otherwise. | none |
| `mock` | object | Fixtures for the mock profile: `data`, the records each mock Connector serves (with each source's `key`), and `answers`, one answer file per model task. Nothing is discovered by file name. | none; the mock profile then has no records and no answers |

## Host configuration

`~/.config/actql/host.json`, created by `actql init`, or the file named with
`--host-config`. It holds what grants and verifies authority: the account
configuration, the Host's decisions for delegated operations, and the signers
it accepts. A project file cannot add to it.

```json
{
  "version": "actql-host/0.1",
  "account_config": "./accounts.json",
  "run_policy": {
    "principal": "agent:churn-risk",
    "namespace": "acme",
    "policy_contract_cid": "sha256:…",
    "decision": "review",
    "expires_at": "2027-01-01T00:00:00.000Z"
  },
  "effect_policy": {
    "decision": "review",
    "policy_contract_cid": "sha256:…"
  },
  "signers": {
    "ops-approver": {
      "principal": "ops",
      "key_id": "ops-2026",
      "private_key": "./keys/ops.pem",
      "public_key": "./keys/ops.pub.pem",
      "checkpoint_kinds": ["effect_set"]
    }
  }
}
```

| Field | Type | Meaning | Default |
| --- | --- | --- | --- |
| `version` | string | Always `actql-host/0.1`. | required |
| `account_config` | path | The [account configuration](#account-configuration) that routes each protected operation to allow, deny or delegate. | none: the Host's standard policy applies — pure computation, reads from configured connections and `INFER` through registered tasks run; every Effect is delegated to `effect_policy` |
| `run_policy` | object | The Host's decision for a delegated run-scope decision (see below). | none |
| `effect_policy` | object | The Host's decision for a delegated Effect Set decision. | `{"decision": "review"}` |
| `signers` | object | Named signers the Host accepts for approvals, keyed by signer id. | none: approvals are signed with the local key `actql init` generated in the Store, which identifies the machine's user |

### `run_policy` and `effect_policy`

When the account configuration answers `delegate`, the Host consults these
policies. Each is its decision for that kind of boundary.

| Field | Type | Meaning |
| --- | --- | --- |
| `decision` | `allow` \| `review` \| `deny` | `allow` permits immediately; `review` stops at a Checkpoint and waits for a signer; `deny` rejects. These decisions apply only when the account configuration answers `delegate`; an explicit account `deny` is never overridden. |
| `policy_contract_cid` | string | Identity of the policy contract the decision is recorded under. |
| `principal` | string | (`run_policy`) The principal the Run executes as. |
| `namespace` | string | (`run_policy`) The namespace the Run belongs to. |
| `expires_at` | timestamp | (`run_policy`) When this policy stops applying. |

A decision hook in your own code (the decider in [Effects and approvals](../guides/effects-and-approvals.md))
takes the place of `review` when the Host is embedded in an application.

### `signers`

| Field | Type | Meaning |
| --- | --- | --- |
| `principal` | string | Who the signer acts as. |
| `key_id` | string | Identifier recorded with every approval. |
| `private_key`, `public_key` | path | PEM files. The Host accepts only configured signers; an approval never supplies its own key. |
| `checkpoint_kinds` | array | Which Checkpoint kinds this signer may resolve, e.g. `effect_set`. |

## Connectors file

A JSON document listing the connections a Host offers, keyed by the name
Programs use (`salesforce` in `salesforce.accounts`). Each entry names the
Connector, the account or endpoint, and where its credentials come from.
Credentials are referenced, never written into the file.

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
      "account": "acme-prod",
      "database": "ANALYTICS",
      "user": "ACTQL",
      "credentials": {"private_key": {"path": "./keys/snowflake.p8"}}
    }
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `connector` | string | Which Connector handles this connection (see [Connectors](https://actql.com/docs/actql/connectors)). |
| connection fields | varies | Endpoint, account, database, project — as each Connector page documents. |
| `credentials` | object | One entry per secret the Connector needs, each referencing an environment variable (`{"env": "NAME"}`) or a file (`{"path": "./file"}`); secrets are never written inline. Each Connector page lists its fields. |

The `--profile mock` option replaces every connection with a mock Connector
serving the records in `mock.data`, and the model with the answers in
`mock.answers`, without editing this file.

## Model tasks file

A JSON document that lists the model tasks `INFER` may name, each pointing at
its definition file, plus the model providers.

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

| Field | Type | Meaning |
| --- | --- | --- |
| `tasks` | object | Model task id → path of its definition file. |
| `providers` | object | Named providers; `type` selects the API, `api_key_env` names the variable holding the key. A model task may pick its provider in its `model` section. |
| `default_provider` | string | The provider used by tasks that do not name one. |

The definition file format (`task`, `input`, `instructions`, `output`,
`model`, `limits`) is described in [Models and INFER](https://actql.com/docs/actql/guides/models).

## Account configuration

An `actql-execution-account-config/0.1` document decides, for every protected
operation, whether it is allowed, denied or delegated to the Host's decision.
It is the only place authority is granted; a Program cannot change it.

```json
{
  "version": "actql-execution-account-config/0.1",
  "account_id": "acme-prod",
  "entries": [
    {
      "entry_id": "reads",
      "outcome": "allow",
      "principal": {"any_of": ["agent:churn-risk"]},
      "connection": {"all": true},
      "resource": {"all": true},
      "operation": {"any_of": ["read"]},
      "exclusions": []
    },
    {
      "entry_id": "salesforce-writes",
      "outcome": "delegate",
      "principal": {"any_of": ["agent:churn-risk"]},
      "connection": {"any_of": ["salesforce"]},
      "resource": {"all": true},
      "operation": {"any_of": ["effect"]},
      "exclusions": []
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `account_id` | string | The execution account this configuration describes. |
| `entries[].entry_id` | string | Unique; entries are kept in ascending order. |
| `entries[].outcome` | `allow` \| `deny` \| `delegate` | What happens when the entry matches. |
| `entries[].principal`, `connection`, `resource`, `operation` | selector | `{"all": true}` (current and future members) or `{"any_of": [ids]}` (exact identifiers). |
| `entries[].exclusions` | array | Tuples (one selector per dimension) removed from this entry's set. |

Operations are `read` (any read, including catalog and metadata), `infer`
(a model call), `write` (data leaving for another system or store) and
`effect` (an Effect commit). Identifiers match by exact equality — no
prefixes, patterns or case folding.

Two entries with different outcomes must not overlap; the Host refuses a
configuration where they do, regardless of order. Once a configuration
exists, an operation that no entry matches is denied, and reported as "no
match" rather than as an explicit deny. An invalid file is refused, never
read as allow. No file at all means the Host's standard policy
([Local and remote Hosts](../guides/hosts.md#policy-who-may-do-what)), which
needs no configuration to read, infer and hold Effects for approval.

## Lock file

`actql lock` writes `actql.lock.json`: the exact Connector contracts, catalog
snapshots and model task definitions the Host resolved, each with its
identity. `actql verify lock` checks that they still match. A Run records the
lock it ran under, so a changed Connector contract is detected rather than
silently used.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `ACTQL_CONFIG` | Path of the configuration file, instead of searching upward. |
| `ACTQL_STATE_DIR` | Overrides `state_dir`. |
| `ACTQL_PROFILE` | Default profile, e.g. `mock`. |
| Credential variables | Whatever names the connectors and model tasks files reference under `credentials.env`. |
| `ACTQL_LOG` | Log level for the Host (`error`, `warn`, `info`, `debug`). |

Environment variables select configuration; they are never read by a Program.
