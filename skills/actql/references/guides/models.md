<!-- Generated from actql/actql@d904416674e4 docs/guides/models.md; do not edit. The published page is https://actql.com/docs/actql/guides/models -->
# Models and INFER

This page is for authors who want an LLM to judge, classify, extract or draft
something for each row. It shows how to define a model task, register it with
a provider, call it with `INFER`, and work with the typed answers — including
what happens when the model fails, is retried, or is never called.

## The division of labour

A model task says *what to ask the model and what comes back*. The SQL says
*which rows to apply it to and what to do with the answers*. Keeping the two
apart means prompts are versioned and reviewed like code, the Program stays
readable, and ActQL can type-check the rest of the SQL before a single model
call is made.

## Defining a model task

A model task is a versioned file:

```yaml
# model-tasks/churn-risk.v1.yaml
task: model-task:churn-risk.v1
model: { provider: openai, name: "<model id>" }   # optional
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
limits:
  max_items: 5000
  max_output_tokens: 200
```

| Field | Meaning |
| --- | --- |
| `task` | The identifier a Program uses. Bump the version when the instructions or the types change; a Run records which version it used. |
| `model` | Optional. Which provider and model answer the task; without it the registry's `default_provider` is used. Providers are configured in the registry below, never in the task. The mock profile ignores it. |
| `input` | The columns the task accepts, with types. `INFER … INPUT (…)` must supply exactly these. |
| `instructions` | The prompt. It sees only the `input` fields of one row at a time. |
| `output` | The typed answer. `enum` makes a value closed; every field is required unless marked `nullable: true`. |
| `limits` | Ceilings for this task: items per call site, output tokens, and so on. The Host and the Program may lower them, never raise them. |

A model task has no tools, no retrieval and no streaming: one row in, one
typed object out. That is what makes an answer recordable and replayable.

## Registering tasks and providers

`model-tasks.json`, named by `model_tasks` in `actql.config.json`, lists the
task files and the providers they may use:

```json
{
  "version": "actql-model-tasks/0.1",
  "tasks": {
    "model-task:churn-risk.v1": "./model-tasks/churn-risk.v1.yaml",
    "model-task:draft-reply.v1": "./model-tasks/draft-reply.v1.yaml"
  },
  "providers": {
    "openai": { "type": "openai", "api_key_env": "OPENAI_API_KEY" },
    "anthropic": { "type": "anthropic", "api_key_env": "ANTHROPIC_API_KEY" }
  },
  "default_provider": "openai"
}
```

API keys are referenced by environment variable; the Host reads them when it
calls the provider. `actql model-task list` and `actql model-task show
model-task:churn-risk.v1` print what is registered and what a task expects.

Calling a model is a protected boundary like a read, decided on the
provider's connection and the task. A Local Host's standard policy lets a
registered task run; an account configuration can restrict it. Only the
columns named in `INPUT` ever leave the Host.

### The mock model

Under `--profile mock` no provider is called. Each task answers from the file
the configuration names for it under `mock.answers`; the churn-risk example
ships with one:

```yaml
# mock/churn-risk.v1.answers.yaml
task: model-task:churn-risk.v1
answers:
  default: { level: low, reason: "stable usage" }
  by_key:
    "001Acme":   { level: high, reason: "falling usage and a competitor evaluation" }
    "001Globex": { level: high, reason: "support tickets about pricing" }
```

This is how the Quickstart runs without keys, and how you test a Program's
logic — filters, joins, failure handling, Effects — independently of prompt
quality. The answers are looked up by the row's key, but the mock does not
establish that key: its uniqueness is proved from the sources' declared keys,
exactly as with a real provider.

## Calling it from a Program

```sql
SELECT a.id AS id, a.description AS notes, u.active_users, u.trend
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
```

- `INPUT (…)` maps columns of the incoming rows to the task's input fields,
  by name. Nothing else is sent to the model.
- `AS risk` names the answer. `risk.outcome` and `risk.value` are ordinary
  columns from here on.
- Each row needs a key that identifies it. When exactly one candidate key can
  be proved (`id` here), it is used; otherwise name it with `ITEM KEY (col, …)`.

The result keeps the key columns and adds two:

| Column | Value |
| --- | --- |
| `outcome` | `ok`, or `failed:<reason>` |
| `value` | On `ok`, an object of the task's output type; on failure, `NULL` |

Filtering on `risk.outcome = 'ok'` is what lets you use `risk.value.level`
as a non-null string afterwards.

## When the model fails

A row's outcome is `failed:` followed by one of:

| Reason | Meaning | Retried? |
| --- | --- | --- |
| `rate_limit` | The provider throttled the call | yes, within limits |
| `timeout` | No answer in time | yes, within limits |
| `provider_error` | The provider returned an error | yes, within limits |
| `refusal` | The model declined to answer | no |
| `schema_invalid` | The answer did not match the output type | no |
| `safety_rejected` | A safety filter blocked the request or the answer | no |
| `truncated` | The answer was cut off by the token limit | no |

Only the transient reasons are retried, a bounded number of times, with the
same request each time. An answer that does not fit the output type is never
coerced into a partly typed value: it is `schema_invalid`, and the row's
`value` is `NULL`.

By default every row comes back, failed ones included, so the Program decides
what to do with them — keep only `ok`, route failures to a review table, or
count them. Whether a failure fails the whole step is the Program's choice,
not the task's: the task defines instructions, types, model and retries, and
the `INFER` step says how to treat a failed row. To refuse a partial result,
add `ON FAILURE FAIL`: when any row is still unsuccessful after the bounded
retries, the step's result is not published as a success, no later step or
Effect sees it, and the calls already made stay recorded as evidence with
their cost:

```sql
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
     ON FAILURE FAIL
```

## Limits and cost

Before the first call, ActQL counts the distinct keys it would send. If that
exceeds the task's `max_items`, the Host's ceiling or a guard in the Program,
no model is called at all and the step fails with the limit named. From the
item count, the task's token limits and the retry contract it also fixes the
maximum number of calls, bytes and tokens for the step, so the work of a Run
is finite before it starts; `actql explain` prints these bounds. A finite
amount of work is not the same as a price: what it costs depends on the
provider's terms for input and output tokens, attached content and retries,
so a budget in money is established from the task's and the Host's contracts,
not read off the row count.

## Answers are observations

A model's answer is recorded in the Run as an observation from outside,
together with the evidence of each attempt. If the Run is resumed or
recovered, the adopted answer is reused — the model is not asked again, and
the Program sees the same values. Change the task's version to get fresh
answers under a new definition.

ActQL guarantees the type of the answer and how it is handled, not that the
judgement is right. Where a wrong answer would be costly, put an Effect behind
a Checkpoint so a person sees the values before they are written.

## Next

- [Writing Programs](../authoring.md): the full `INFER` syntax, `NEAREST` for retrieval before inference.
- [Local and remote Hosts](hosts.md): routing `infer` in the account configuration.
- [Runtime limits](https://actql.com/docs/actql/reference/limits): default ceilings per environment.
