<!-- Generated from actql/actql@747e5c2771ca docs/guides/node.md; do not edit. The published page is https://actql.com/docs/actql/guides/node -->
# TypeScript and Node

`@actql/node` runs ActQL inside your application: no server, no daemon, the
engine is a library. The same client connects to a remote Host or ActQL Cloud
by changing the connection options. This guide shows the API you will use
day to day; everything shown is typed, and the types are the documentation of
the finer details.

```sh
npm install @actql/node
```

## A short query

`open()` gives you the shortest path: a local engine with its state in a
directory, and `sql()` / `aql()` for one-off queries.

```ts
import {open} from '@actql/node';

const db = await open({stateDir: '.actql'});
try {
  const rows = await db.sql('SELECT id, name FROM crm.accounts WHERE owner = @owner', {owner: 'kim'}).all();
  console.log(rows);
} finally {
  await db.close();
}
```

The second argument is always the parameters map. `aql()` takes Pipe syntax
(`FROM … |> …`); `sql()` takes an ordinary `SELECT`. Both return a promise of a
Result: `all()` reads every row, `rows()` streams them:

```ts
for await (const row of (await db.aql('FROM crm.accounts |> LIMIT 1000')).rows()) {
  console.log(row.id);
}
```

Short queries read; they never write. A Program with an Effect goes through
`startSource` below.

## Connecting

`connect()` is the full client. Locally it is the same engine as `open()`,
with the installation spelled out:

```ts
import {connect} from '@actql/node';

const client = await connect({
  mode: 'local',
  installation: {directory: '.actql'},
  profile: 'mock',                 // omit to use the configured connections
});
```

For a remote Host:

```ts
const client = await connect({
  mode: 'remote',
  endpoint: process.env.ACTQL_ENDPOINT,   // actql://host.acme.internal
  token: process.env.ACTQL_TOKEN,
});
```

`token` can be a string or a function that returns one, so a short-lived
credential can be refreshed. An `actql://` connection string selects a remote
Host as well. Whatever the mode, the rest of the API is the same.

Always close the client, in `finally` or with `await using`. Closing releases
the connection; it never cancels a Run, answers a Checkpoint or deletes a
Result.

## Running a Program

```ts
import {readFile} from 'node:fs/promises';

const source = await readFile('churn-risk.aql', 'utf8');
const execution = await client.startSource(source, {
  format: 'aql',
  parameters: {owner: 'kim'},
  stopBefore: 'commit',            // optional: stop before the first write
});
const state = await execution.wait();
console.log(state.status);         // 'succeeded' | 'waiting_checkpoint' | 'failed' | …
```

`startSource` checks the Program and starts a durable Run. `wait()` resolves
at the next **stable state** — waiting for a decision, waiting for
reconciliation, or final — with the Run state: its `status`, its `checkpoint`
while it is waiting, the outcome of each Effect item once they exist, and a
`revision`. If the Run is already stable, `wait()` resolves at once with that
state; `wait({since: state.revision})` waits for the state after it.
`succeeded` means every computation and Effect has an outcome; an
asynchronous Effect may be `accepted` with the external system still
finishing. `execution.ref` is the Run's reference; save it if another process
will need the Run.

Read a named Result after the Run has succeeded:

```ts
const rows = await execution.result('updates').all();
```

`result(name)` reads the Result the Program published with `|> RESULT name`;
a Program that only reads publishes `main`. Reads are bounded: pass
`{maxRows}` or stream with `rows()` for large Results.

### Typed rows

Rows are typed inside ActQL; to carry that into TypeScript, pass a schema that
follows the Standard Schema interface (zod, valibot, ArkType, …) to `all()` or
`rows()`. Each row is validated against it and the result is typed by it:

```ts
import {z} from 'zod';

const Update = z.object({
  id: z.string(),
  risk: z.object({value: z.object({level: z.enum(['low', 'medium', 'high']), reason: z.string()})}),
});
const rows = await execution.result('updates').all(Update);   // Array<z.infer<typeof Update>>
```

A row that does not match fails the read with the schema's issues; nothing is
coerced. The same argument works on `db.sql(…).all(schema)`.

## Checkpoints

When policy defers a write (or you passed `stopBefore: 'commit'`), `wait()`
resolves with `status: 'waiting_checkpoint'` and the Checkpoint:

```ts
const state = await execution.wait();
if (state.status === 'waiting_checkpoint') {
  const ckpt = state.checkpoint;
  console.log(ckpt.id, ckpt.effect.target, ckpt.items.length);
  for (const change of ckpt.preview.changes) {
    console.log(change.id, change.field, change.before, '→', change.after);
  }
}
```

The preview is the exact set of changes the approval would cover. Decide from
code, or hand it to a person and let this process end — the Run waits in the
Store:

```ts
if (ckpt.items.length <= 100) {
  await client.approve(ckpt.id);
  const final = await execution.wait({since: state.revision});
} else {
  await notifyReviewer({runRef: execution.ref, checkpoint: ckpt.id});
  // Nothing to wait for here. The reviewer approves from the CLI or another
  // process; a later process attaches to execution.ref and reads the outcome.
}
```

`approve(id)` and `reject(id)` sign the decision with the signer the client is
configured with and bind it to that preview. Approving continues the same Run;
rejecting ends it as `cancelled` with nothing sent. The decision can come from
any process that shares the Store or the Host — a CLI `actql approve`, a web
app, a Slack bot — the Run does not care which.

### Deciding from code

Instead of waiting for the Checkpoint and approving it afterwards, the client
can be the decider: `connect()` takes a `decide` function that the Host calls
with the Preview before it stops. It answers `'permit'`, `'reject'` or
`'defer'`; only `'defer'` creates a Checkpoint.

```ts
const client = await connect({
  mode: 'local', installation: {directory: '.actql'},
  decide: async (decision) => {
    if (decision.kind !== 'effect_set') return 'permit';          // reads, model calls, the Run itself
    return decision.preview.items.length <= 100 ? 'permit' : 'defer';
  },
});
```

`decision.kind` says what is being decided: `'run'` (admission of the Run),
`'read'`, `'infer'`, `'egress'` or `'effect_set'`. Only an `effect_set`
decision carries a `preview`: `preview.items` are the records that would
change, `preview.fields` the fields written, and `preview.target` the
resource. The function only decides; it cannot change the Preview, and if it
throws, nothing is dispatched.

For review workflows that need to list and read Checkpoints across many Runs,
`client.checkpoints()`, `client.reviewCheckpoint(ckpt)` and
`client.resolveCheckpoints(items, {signer})` expose the same operations with
explicit signing and paging.

## Attaching to a Run

A Run outlives the process that started it. From any process, with the same
Store or Host:

```ts
const execution = await client.attach(savedRef);        // execution.ref from earlier
const state = await execution.status();                 // no waiting
```

`status()` returns the current state without waiting; `wait()` follows it.
After a crash, the Run is wherever it was: a waiting Checkpoint is still
waiting, finished work is not repeated, and a write whose outcome was lost is
reported as `needs_reconciliation`:

```ts
if (state.status === 'needs_reconciliation') {
  const after = await execution.reconcile();   // checks with the system; never resends
  console.log(after.status, after.effects);
}
```

`execution.cancel()` asks a Run to stop; the state becomes `cancelled` once
stopping is confirmed.

Starting the same Program with the same `requestId` returns the existing Run
instead of running it again — use it to make a retrying caller safe. The
match is on the whole request: the same Program, parameters, inputs and
authorization scope. The same `requestId` with different content is a
`RequestConflict`, never a silent reuse:

```ts
const execution = await client.startSource(source, {format: 'aql', requestId: 'nightly-2026-10-15'});
```

## Checking without running

`check()` runs the same static validation as `actql check`, with a structured
report of reasons and their locations:

```ts
const outcome = await client.check(source, {kind: 'text', format: 'aql', scope: 'template_only'});
if (outcome.report.verdict !== 'valid') {
  for (const reason of outcome.report.reasons) console.log(reason.code, reason.location);
}
```

`plan()` returns the plan `actql explain` prints, as data.

Reading a file's content, creating one with `SERIALIZE` and collecting a
Result are three different things; [Working with files](https://actql.com/docs/actql/guides/authoring#working-with-files)
keeps them apart.

## Errors

Every failure is a `ClientError` with a stable `code`. The ones worth handling:

| Code | When |
| --- | --- |
| `CheckFailed` | The Program is invalid; the report is attached |
| `RequestHeld` | Policy deferred the Run before it started (a pre-Run Checkpoint); resolve it like any other Checkpoint, then `attach` to the Run |
| `RequestConflict` | The `requestId` was used before with a different Program, parameters, inputs or scope |
| `SubmissionUnknown` | The reply to a start was lost. Do not start again with a new request ID; look the request up |
| `ResolutionUnknown` | The reply to an approval was lost; resend the same items — the Host recognises the repeat and does not apply it twice |
| `ClientClosed` | The client was closed |

The rule behind them: a lost reply never means nothing happened. Look the
request or Run up by its identity; never retry a write by resubmitting it.

## Next

- [Quickstart](https://actql.com/docs/actql/getting-started/quickstart): the churn-risk Program end
  to end.
- [Local and remote Hosts](hosts.md): connections, credentials and policy.
- [Run lifecycle and recovery](run-lifecycle.md): every state and what to do
  in it.
- [Python](python.md): the same API from Python.
