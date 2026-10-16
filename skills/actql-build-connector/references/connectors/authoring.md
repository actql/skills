<!-- Generated from actql/actql@747e5c2771ca docs/connectors/authoring.md; do not edit. The published page is https://actql.com/docs/actql/connectors/authoring -->
# Building a Connector

A Connector is the only part of ActQL that talks to an external system. This
page is for someone who wants to connect a system that is not in the list —
a person, or a coding agent working from the [ActQL skills](https://actql.com/docs/actql/getting-started/install).
It explains what a Connector declares, how the engine uses each declaration,
and the steps to build and test one. The in-repository mechanics live in
[Contributing: Connector authoring](../contributing/connector-authoring.md).

## What a Connector declares

A Connector is a set of declarations plus the code that performs I/O. The
engine never sees the system's API; it sees the declarations.

| Declaration | What it says | What the engine does with it |
| --- | --- | --- |
| **SourceViews** | The resources a Program can read, each with typed columns, a version and a key | `check` validates names and types; `explain` plans the read; reads are captured as observations |
| **Capabilities** | What the system can compute itself — column selection, filters (which operators), sorting, aggregation, search — and roughly what it costs | The planner pushes down only what is declared; everything else runs in the engine |
| **Effects** | The record writes a Program can perform — insert, update, upsert, delete — as a Mapping per resource: the key, the writable fields and their types, the permission each needs, and the preview strength | Policy decides per operation; the Host previews, approves and sends through the Connector |
| **Commands** | The operations a Program can run with `EFFECT COMMAND` — post, send, refresh, start a job — each as a versioned contract: input fields and types, the target resource kind, the permission, what the Preview shows and how the outcome is confirmed | `check` resolves `conn.operation` to exactly one contract and refuses ambiguity; the Host previews and approves it like any Effect |
| **Store** | Where content (`content_ref`) or rows can be written — an object store, a stage, a declared table — with the destination fields it takes and its overwrite rule | `EFFECT STORE` and `CREATE TABLE` are previewed with destination, content identity or row count, and the overwrite condition |
| **Reconciliation** | How an operation with a lost reply can be looked up afterwards | An `unknown` outcome is resolved through this procedure, never by resending |
| **Connection** | The configuration fields and credentials a connection needs | The Host resolves secrets and lends them to the Connector per admitted operation |

A Connector declares what it *can* do. Whether a Program *may* do it is
decided by the Host's policy every time.

## Sources

A SourceView maps a resource of the system to a table: a name, typed
columns, nullability, a key where the system has one, and the way the
resource is paged. A key is a claim the system backs: declare it only where
the system guarantees uniqueness, and say in the Mapping when the Connector
has to verify it itself (warehouses that do not enforce primary keys). File
content is a separate SourceView — a listing with `resource` and `version`,
and a `contents` view joined on them that yields a `content_ref` — never a
column of the listing. The Connector reads pages on request and returns rows;
the engine captures them as an observation of the Run and never asks for
them again during that Run. Reads are bounded: the Program's row and byte
limits apply to each read, and a read that would exceed them stops with an
error.

Declare types honestly. A column the API returns as a formatted string is a
string; a number is a number only if the API guarantees it. Dates and
date-times keep the precision the system has.

## Capabilities

Each Capability names an operation the system can run on a SourceView
itself — select these columns, filter on this column with these operators,
sort by this column, aggregate — and a cost class. The planner uses them to
decide placement and `explain` shows the result. A Capability must preserve
meaning exactly: if the system's filter semantics differ from SQL's (case
folding, NULL handling), the Connector does not declare the filter.

## Effects

An Effect declaration names the resource, the operation and its fields, the
permission the account needs, and the preview strength:

- `full_diff` — the Connector reads the current values of the targets, so
  the preview shows before and after, **and** it can condition the write on
  what it read: a revision, an etag, a generation, a row hash. A target that
  changed in between makes the item `failed` with `conflict`; it is never
  overwritten on a stale Preview.
- `targeted` — the targets are known and the new values are shown, but there
  is no current value to show: creations, posts, sends, uploads.

There is no third strength. An Effect whose exact targets cannot be resolved
before sending cannot be declared.

A Connector that cannot verify a key's uniqueness from the system's
constraints verifies it when it builds the Preview, and an item whose key
matches several targets is `failed`, not applied as a single-target change.

The Connector implements three things for each Effect and Command: prepare
the request from the approved items, send it exactly once per approved item,
and classify the response into `applied` (the system confirmed the result),
`accepted` (the system took the request and will finish it later) or
`failed`. It does not retry, does not reorder items and does not decide
completion; the Host owns the ledger. Logical items and physical requests
are different things — a hundred items may go as one `MERGE` or one batch
call — but every item keeps its own identity, Preview entry and outcome.

## Reconciliation

Every Effect and Command needs a way to find out what happened when the
reply was lost. Good reconciliation uses the system's own record, correlated
with the request: a job or statement id the Connector recorded before
sending, an idempotency key, a request marker it put in the request's
metadata, an audit or history entry that names this integration and the
request window. Reading the target back and finding the expected value, or
a modification time after the send, is not evidence — someone else may have
written it — so a Connector that has nothing better leaves the outcome
`unknown`, and the Host keeps it visible. Bind the request to its identity
*before* sending, so the lookup is possible even when the process dies
mid-request.

## Steps

1. **Describe the system.** List the resources a Program should read, their
   columns, types and keys, the files it exposes, and the writes and
   operations it should perform. Decide the connection fields and which
   credentials a Local Host needs; note which Connectors need an approved
   OAuth application for the Cloud.
2. **Declare the SourceViews and Capabilities.** Start with column selection
   and the filters the API supports natively; add more only when the
   semantics match SQL exactly.
3. **Declare the Effects, Commands and Store** with their keys, inputs,
   preview strength and permission, and the type mapping in both directions.
4. **Implement the I/O**: paged reads and content reads; prepare, send and
   classify for each Effect and Command; the reconciliation lookup.
5. **Write fixtures.** A Connector is tested against recorded responses of
   the real API: a successful read, a paged read, each Effect's success and
   failure, a lost reply and its reconciliation. The fixtures run without
   credentials and are what the mock profile serves.
6. **Register the Connector** so a connection can select it, and run the
   common Connector checks: zero sends before approval, one send per approved
   item, no resend after restart, `unknown` on a lost reply.

## What a Connector must not do

- Choose URLs, methods or headers from Program input. The transport binding
  is declared, and a Program cannot reach past it.
- Turn an API error into empty rows or NULLs.
- Mark its own operation complete, or retry a write on its own.
- Hold credentials. The Host resolves them and lends them per operation.

## Next

- [Connectors](README.md): the Connectors that ship with ActQL and how they are configured.
- [Contributing: Connector authoring](../contributing/connector-authoring.md): where the code goes, the author interface and the fixture harness.
- [Specification: protocols](https://actql.com/docs/actql/spec/protocols/contracts): the Catalog, SourceView, Mapping and Command contracts a Connector implements.
