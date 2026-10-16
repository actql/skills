<!-- Generated from actql/actql@747e5c2771ca docs/contributing/README.md; do not edit. The published page is https://actql.com/docs/actql/contributing -->
# Development

How to set up a checkout of ActQL, build it, run the tests that matter for a
change, and the rules a change follows. This page is for people changing the
engine, the Hosts, the Connectors or the specification. Writing Programs
needs none of this; see [Install](https://actql.com/docs/actql/getting-started/install).

## How contributions work during v0.1

ActQL is open source, and during v0.1 the maintainers are concentrating on
stabilising the Core. Issues are open: bug reports, places where the
specification was hard to read, and facts about a Connector's system are the
most useful contributions right now. Pull requests to this repository are not
accepted during v0.1. After v0.1 the maintainers may take in a small number
of changes, but the Core (language meaning, contracts, the Hosts) stays
maintainer-driven by design. The ecosystem
around it (Connectors, SDKs, templates, tools) is where contributions are
welcome broadly. The rest of this page is the working reference for the
maintainers, and for agents making changes in this repository.

## Repository layout

| Path | What it holds |
| --- | --- |
| `docs/` | This documentation: `concepts/`, `getting-started/`, `guides/`, `connectors/`, `reference/`, `spec/` (normative), `contributing/` and `design/` (design notes). |
| `spec/` | Machine contracts, grammar (`spec/grammar/actql-query-0.1.ebnf`), fixtures and the requirement registries the specification pins. |
| `src/` | The Core and the common Host libraries, in MoonBit. Connectors live under `src/connectors/<name>/`. |
| `adapters/` | Environment-specific code: the Node Host, the Workers Host, the DuckDB adapter and each Connector's I/O (`adapters/connectors/<name>/`). |
| `packages/` | The published packages: the `actql` CLI, `@actql/node`, `@actql/sdk`, the Python package. |
| `examples/` | Example Programs. |
| `scripts/` | Repository tooling: checks, generators, test wrappers. |
| `release/` | The release process. |

Common execution code never depends on a package under `src/connectors/`;
a Connector depends on the common libraries, not the other way round. The
repository gates enforce that boundary.

## Prerequisites

- Node.js 22 or newer and npm (used for the tooling, the Node packages and
  the document checks).
- Python 3.11 or newer, a C compiler and `make`.
- Git, curl and tar.
- The pinned MoonBit toolchain, installed by the repository (below). Apple
  Silicon macOS and x86-64 Linux are the supported development platforms.

```sh
npm ci
```

### MoonBit

ActQL's Core is written in MoonBit. Install the exact toolchain the
repository pins; do not use a global installation:

```sh
node scripts/setup-moonbit.mjs
export MOON_HOME="$PWD/.toolchains/moonbit-$(node -p "require('./toolchain.json').version")"
export PATH="$MOON_HOME/bin:$PATH"
moon version --all
```

Setup verifies the archive checksums, installs only under the ignored
`.toolchains/` directory and never touches your shell configuration. Put the
same two variables in your editor's environment. To update the toolchain,
change `toolchain.json` and rerun setup; never run `moon upgrade` inside the
installation.

The root `moon.mod` defines the single `actql/actql` module. JavaScript is
the default build target for day-to-day work; the common Core also builds
for Wasm and native, and CI verifies all three.

## Building and testing

The default verification for a change is the affected MoonBit packages on
the JavaScript backend plus the Node tests for any SDK, adapter or script you
touched. These are different layers: MoonBit tests compiled to JavaScript do
not replace the public Node API tests, and vice versa.

`node scripts/local-checks.mjs changed` lists the tests the tooling believes
your change affects. It is path-based advice, not a dependency closure — look
at the callers of what you changed and add their tests.

Run a selected test through the bounded wrapper, which fails if nothing
actually ran:

```sh
node scripts/local-checks.mjs test node -- --test-name-pattern 'selected name' scripts/example.test.mjs
node scripts/local-checks.mjs test moon -- --target js src/query_integration --filter '*selected name*'
```

Keep the incremental `_build/` directory between runs, and do not run two
verification gates against the same checkout at once. Native-only and FFI
changes need an explicitly selected native diagnostic; the broad Core,
all-target, proof and performance suites are run deliberately, not by
default.

When you report a change, state which checks you ran and their counts, and
which coverage you did not run. A pull request's checks establish only what
they executed.

### Packages

The packed client packages (`actql`, `@actql/node`, `@actql/sdk`) are built
from the checkout with the scripts under `scripts/`; see
[Building from source](https://github.com/actql/actql/blob/747e5c2771ca7c0eb2c2f74238bc62a8abaa5509/docs/development.md) for the exact commands and the
artifact rules. Installing a release is documented in
[Install](https://actql.com/docs/actql/getting-started/install).

## Changing the specification

The documents under `docs/spec/` are normative. Each requirement carries an
identifier (`requirement-block`), and the machine contracts under `spec/`
are pinned by content identity.

- Keep or explicitly assign requirement identifiers when you edit normative
  text.
- Run `npm run check:metadata` to see which obligations and document imports
  your edit changed, then `npm run update:metadata` to apply the reviewed
  update. A changed obligation starts without execution evidence.
- Run `npm run check:spec` before committing.
- Never retain an old content identity for a changed contract body, and
  never compute an expected fixture from the implementation's own output.

Contract version strings (`actql/0.1` and the `/0.1` contract identifiers)
are independent of package versions and are not raised as part of an
ordinary change.

## Issues and house rules

- Open an issue for a bug, a passage of the specification that was hard to
  read, or a fact about a Connector's system. For anything that would change
  language meaning, a wire format or a contract, the issue is where the
  compatibility impact is agreed before code is written;
  [Proposing extensions](https://actql.com/docs/actql/contributing/extensions) describes how new operations are
  evaluated.
- Everything in the repository is written in English: code comments,
  documentation, commit messages, issues and pull requests.
- Commit messages and pull request titles use Conventional Commits:
  `<type>[optional scope][!]: <description>`.
- A pull request follows the template: what changed and why, scope and
  compatibility, what was verified (with the source revision), and what was
  not run. During v0.1 only the maintainers open them.

Connector work inside the repository has its own page:
[Connector authoring](connector-authoring.md). Implementers of the Core
should read [Implementing ActQL](https://actql.com/docs/actql/contributing/implementing).
