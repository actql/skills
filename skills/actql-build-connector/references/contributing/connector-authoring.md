<!-- Generated from actql/actql@d904416674e4 docs/contributing/connector-authoring.md; do not edit. The published page is https://actql.com/docs/actql/contributing/connector-authoring -->
# Connector authoring in the repository

How a Connector is added to the ActQL repository: where its code lives, what
it declares, what the common Host owns on its behalf, and what its tests
must show. This page is for contributors; during v0.1 the repository takes
Connector changes from the maintainers only (see
[Development](README.md#how-contributions-work-during-v01)). What a Connector is and how one is
designed is in [Building a Connector](../connectors/authoring.md); this page
is the in-repository mechanics.

The common semantics stay in the MoonBit Core and the common Host owners. A
Connector contributes a checked installation manifest and a physical driver;
the Core decides when its work is complete.

## Layout

A Connector owns its planning, execution, transport glue and foreign
interfaces under its own roots. Common scheduling, assembly and
cross-Connector verification stay outside every Connector tree.

```text
src/connectors/<name>/
  acquisition/        source acquisition
  adapter/            query and physical-value compilation
  compute/            fixed-input compute support (when the system can compute)
  driver/             common Host lifecycle integration
  host/               acquisition Host bridge
  host_native/        native Host bridge
  host_node/          Node Host bridge
  adapters/native/    Connector-specific native FFI (when needed)
  conformance/        test-only real-engine fixtures
  host-bundle.json    installation manifest (sources, Effects, exports)
  compute-bundle.json compute contribution manifest (when applicable)

adapters/connectors/<name>/node/
  Node I/O: HTTP, SDK sessions, native integration
```

Three constraints are enforced by repository gates:

1. Common execution packages have no direct or transitive dependency on a
   package under `src/connectors/`.
2. Product packages do not import conformance packages.
3. A Local-only bundle contains no DuckDB package, Node adapter, native FFI
   or linked library marker.

A new Connector extends these Connector-owned roots; it does not add a
product-specific top-level platform package. `src/platform_native/` is
reserved for product-neutral operating-system capabilities such as
filesystems, HTTP and SQLite.

## Declarations

1. Declare the Source and Effect roles in `src/connectors/<name>/host-bundle.json`:
   the profile versions, registration and revision, the adapter module, and
   the exact check, identity, publish and load exports. A read-only
   Connector declares no Effect.
2. Declare a pure codec package as `providerBundle` only when one is needed,
   and owned static files as `assets`. No implicit package resolution,
   external aliases or undeclared filesystem dependencies.
3. If the system can compute (filter, aggregate, …), declare the compute
   contribution in `compute-bundle.json`: its configuration type, pure
   construction function, registration accessor, contribution factory and
   diagnostic error types.
4. Regenerate the assemblies and check them:

   ```sh
   node scripts/connector-node-bundles.mjs --write
   node scripts/connector-compute-bundles.mjs --write
   moon check --target all --deny-warn
   ```

   The installation table and the standard package inventory come from the
   manifests. `src/connectors_builtin` is generated; do not edit it by hand.

5. Restore the typed Catalog and SourceViews through the common row-source
   Host (`client_row_source_host`), using its Mapping factory and
   check-environment permission checks. The driver never constructs evidence
   or accepts operations the Connector did not declare.

A row-addressable Mapping keeps a required non-nullable scalar identity. A
collection-only Mapping has no primary identity and a typed collection
identity, and permits create only. Unsupported operations are refused at
registration and check, never carried into a physical send.

## What the common owner does, and what the driver supplies

Reads: `createInstalledRowSource` owns checked acquisition, page charging,
capture, input binding and source evidence. The driver supplies a
`physicalTarget` and finite `readPages`, using the per-page authorization
and the scoped credential it is handed. It keeps no second ledger and issues
no success of its own. It observes bytes before projection and never
replaces an API error with empty input or `NULL`.

Writes: `createInstalledRowEffect` owns the checked Preview, Set approval,
the durable claim, the saved response, the receipt, publication and
recovery. For each write kind the driver supplies a pure `prepareRequest`
and `requestFacts`, a `writeOperation`, exactly one physical `send`, a
response `project` and a bounded `footprint`. The common owner compares the
exact values and selectors with the Program and the Preview before dispatch.

Target-addressed writes also supply the target observation and version
hooks. Custom recovery supplies `recoveryEntry`, `recoverRequests` and
`requestCid` together; registration rejects an incomplete set. Recovery must
reconstruct and compare the exact approved requests — retained data is not
authorization. Create-only drivers may use the default reconstruction.

Classify a refusal only from semantic facts observed before the send; a
refusal marker is not a catch-all for exceptions, rate limits, missing
responses or physical stops. A system with no authoritative lookup or
idempotency must leave a possibly-sent write `unknown`. Never synthesize
success from reading back an equal value.

Close and cleanup failures stay on the same retry handle; completion is
marked only after close succeeds. A retry releases resources — it never
repeats a read, a computation, a Preview, an approval or a send.

## Tests a Connector must pass

Reuse the common registration, value comparison, prepare-refusal, response
recovery and cleanup fixtures from the installed-Effect test suite under
`adapters/host-node/`, with independent data for your system, and add only
the system-specific boundary cases:

- supported registration and preparation; refusal of undeclared operations
  and incomplete hook sets;
- exact typed values, selectors, targets and request identity, including
  Unicode;
- zero sends before approval, one send per granted claim;
- saved-success and unknown reconstruction without a resend;
- refusal on current authority or target changes before the send;
- a failed cleanup keeps the record of the attempt, and a retry does not recompute;
- finite codec and transport limits, with exact and one-short cases;
- an external installation using only the public package exports.

A local responder stands in for the real service in tests; tests against the
real service are separate, and fixture results do not stand in for them.
Declare the query and write profile the Connector actually supports rather
than every language shape.
