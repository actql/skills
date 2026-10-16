<!-- Generated from actql/actql@747e5c2771ca docs/guides/run-lifecycle.md; do not edit. The published page is https://actql.com/docs/actql/guides/run-lifecycle -->
# Run lifecycle and recovery

This page is for anyone operating Runs: it shows the states a Run moves
through, how to read `status`, what happens when a Run is interrupted, how an
unknown write outcome is resolved, how to cancel, and how to collect Results.
The guarantees behind each step are in
[Execution model and guarantees](https://actql.com/docs/actql/concepts/execution-model).

## States

A Run is always in exactly one state:

```text
preparing → running → succeeded
                   ↘ waiting_checkpoint → resuming → running
                   ↘ needs_reconciliation → running | succeeded | failed
                   ↘ failed
                   ↘ cancelled
```

| State | What it means | What to do |
| --- | --- | --- |
| `preparing` | Checking, planning and admission are in progress | wait |
| `running` | Reading, computing, inferring or applying | wait |
| `waiting_checkpoint` | A decision has to wait | `approve` or `reject` the Checkpoint |
| `resuming` | An approval was recorded; the same Run continues | wait |
| `needs_reconciliation` | The outcome of an Effect (or of the execution itself) is unknown | `reconcile` |
| `succeeded` | Every computation and Effect the Program requires has an outcome; for an asynchronous Effect that outcome may be `accepted`, with the external system still finishing | collect Results |
| `failed` | Finished unsuccessfully; nothing is unknown | read the reason |
| `cancelled` | Stopped on request or by a rejected Checkpoint; nothing is unknown | — |

`succeeded`, `failed` and `cancelled` are final. A Run never reaches them while
any outcome is still unknown.

Policy can also hold a request before a Run exists: the CLI reports it as
`held`, the SDKs raise `RequestHeld`. It is resolved with the same `approve`
or `reject`, and the Run starts when it is approved.

## Reading status

`actql status <run>` prints the current state and, depending on it, the
Checkpoint, the Effects and their items, or the failure:

```text
$ actql status run_…
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

```text
$ actql status run_…
Run run_…
  Status   succeeded
  Effect   update  (Salesforce Account)   2 items
    Acme Corp     applied
    Globex Inc    applied
  Results  updates  2 rows
```

```text
$ actql status run_…
Run run_…
  Status   needs_reconciliation
  Effect   update  (Salesforce Account)   2 items
    Acme Corp     applied
    Globex Inc    unknown   reply lost after send; reconciling with Salesforce
```

`status` reads the current state once and sends nothing to any external
system. `status --watch` prints each change and returns at the next state
that needs you — `waiting_checkpoint`, `needs_reconciliation` or a final
state; `--watch --until final` keeps following through approvals, and
`--timeout 10m` bounds either. `--json` returns the Run state as data — use
it in automation rather than parsing the text. Note that the exit code of
`run` and `status` is `0` whenever the command itself worked, even if the Run
is `waiting_checkpoint` or `failed`; the state is in the output.

From code, `execution.status()` reads the state without waiting, and
`execution.wait()` returns at the next stable state — a waiting state or a
final one. If the Run is already in a stable state, `wait()` returns it at
once; to wait for the state after that one, pass the revision you have seen:
`wait({since: state.revision})`.

## Interruption and resume

A Run can stop at any point: the process is killed, the machine restarts, the
network drops, or a decision takes a day. Everything the Run has already seen
is in the Store — captured reads, model answers, Previews, Effect outcomes —
so it continues from where it was instead of starting over:

- Reads are not repeated; the captured observations are reused.
- Model answers are not requested again; the adopted answer is reused.
- An Effect recorded as `applied` is never sent again.

To continue after a restart, open the same Store and attach to the Run:

```sh
actql status run_…           # the Host resumes it if it was interrupted
```

Recovery belongs to the Host: opening the Store lets it continue work it had
in flight. `status` and `explain --run` only read; neither of them
starts or resends an external operation.

```ts
const client = await connect({mode: 'local', installation: {directory: '.actql'}});
const execution = await client.attach(ref);      // ref saved from execution.ref
const state = await execution.wait();
```

A Run that was `waiting_checkpoint` stays there across restarts; approving it
later continues it. If the Store, the permissions or the retention a Run
depends on are gone, the Run does not quietly start again — it reports what
is missing.

## Unknown outcomes and reconciliation

A write can end without a clear answer: the request was sent and the reply
was lost. ActQL records that item as `unknown`, moves the Run to
`needs_reconciliation`, and does not send the write again — a second send
could apply it twice.

`reconcile` asks the Connector to find out what happened, using the identity
of the original operation:

```text
$ actql reconcile run_…
Effect  update  (Salesforce Account)
  Globex Inc    applied   confirmed: Salesforce returned the operation for request marker actql-7f3…
Run run_…  succeeded
```

If the Connector can establish the outcome, the item becomes `applied` or
`failed` and the Run moves on. If it cannot — the system offers no way to look
the operation up, or the evidence is inconclusive — the item stays `unknown`,
the attempt is recorded, and the Run keeps waiting. Running `reconcile` again
later is safe. Only evidence the Connector recognises counts: the operation
found under the request's marker, a provider operation id, an audit entry
that correlates with the original request. A matching value in the external
system, or a record modified after the send, is not proof — something else
may have changed it.

The same state covers a lost execution: if the Host cannot tell whether a
unit of work finished, it reconciles that before continuing.

## Cancelling

```text
$ actql cancel run_…
Run run_…  cancelling
```

Cancellation stops new work from starting and asks running work to stop. The
Run becomes `cancelled` only once stopping is confirmed and nothing is
unknown; an in-flight write that ends `unknown` has to be reconciled first.
Cancelling is not a rollback: reads that were sent and Effects that were
applied stay as they are.

## Results

A Program's named Results are published when it finishes. `run` reports the
Run state; it does not print rows. Read them with `result`:

```sh
actql result run_… --result updates --format jsonl       # rows on stdout
actql result run_… --deliver updates=csv:updates.csv      # to a file
```

`--deliver` can be repeated for several Results and remembers each delivery
it completed: the same Result to the same destination is not written twice,
and a failed delivery is retried with the same command. A new destination is
a new delivery. From code, `execution.result('updates').all()` returns the
rows.

Results, like everything else in a Run, are kept for the Host's retention
period. Export what you need to keep.

## Next

- [Effects and approvals](effects-and-approvals.md): the Checkpoint and how it is resolved.
- [Debugging and troubleshooting](debugging.md): reading failures.
- [CLI reference](../cli.md): every flag of `status`, `reconcile`, `cancel` and `result`.
