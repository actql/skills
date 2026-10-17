---
name: actql-embed
description: "Embed the ActQL engine in a TypeScript/Node or Python application, or call a remote ActQL Host or ActQL Cloud from code: connect, start a Program, wait for its state, decide Checkpoints in your own code, read Results. Use when the user is building an app, service or job that runs ActQL Programs with @actql/node, @actql/sdk, the actql Python package or actql-sdk, rather than driving ActQL from the CLI."
license: Apache-2.0
metadata:
  actql-docs-repo: actql/actql
  actql-docs-ref: 84d4ef5bff33130b1daec30d56527c4d5c1ef636
  actql-version: "0.1"
  actql-skills-version: "actql-skills/0.1"
---

# Embed ActQL in an application

Use this skill when the Program is already written (or the `actql` skill is
writing it) and the question is how an application runs it: as a library in
TypeScript or Python, or against a remote Host or ActQL Cloud. The
Program does not change between these; only the connection does.

## 1. Pick the package and the mode

| The app | Package | Mode |
| --- | --- | --- |
| runs Programs itself (engine in-process, DuckDB included) | `@actql/node` / `actql` (Python) | `mode: 'local'` |
| only talks to a Host someone else runs, or ActQL Cloud | `@actql/sdk` / `actql-sdk` (Python) | `mode: 'remote'` |

The standard packages also contain the remote client, so an app that starts
local can switch to remote by changing connection options, not code. The
lightweight SDK cannot run locally; if the user picks it and later wants
`mode: 'local'`, they need the standard package. Install the CLI alongside
either (`npm install -g actql`) so Programs can be checked and explained
before the app runs them.

Read `references/guides/node.md` or `references/guides/python.md` for the
exact API of the chosen language before writing code. Do not invent method
names; the two SDKs mirror each other (`connect` / `startSource` / `wait` /
`result` in TypeScript, `connect` / `start_source` / `wait` / `result` in
Python).

## 2. The loop in code

1. `connect(...)`: `mode`, where the state lives (`installation.directory`
   in TypeScript, `installation=` in Python; default `.actql`), and for a
   first run `profile: 'mock'`. For remote: `endpoint` (an `actql://`
   connection string or the Host's `https://` URL) and `token`.
2. Start the Program from its source text (`startSource` /
   `start_source`, `format: 'aql'`). Pass `stopBefore: 'commit'` while
   developing so no Effect is applied.
3. `wait()` returns at the next stable state: `succeeded`, `failed`,
   `waiting_checkpoint`, or a reconciliation wait. The state carries
   `status`, `checkpoint`, `effects` and a `revision`; to wait for the state
   after the one you have, pass `since: state.revision`.
4. On `waiting_checkpoint`, either show `state.checkpoint` (the Preview) to a
   person, or decide in code: a `decide` hook receives the Preview and
   returns approve / reject. The hook decides only *whether* the write
   proceeds; it cannot change what is written. A Run started from code can
   also be approved from the CLI with its Checkpoint ID
   (`actql approve <checkpoint-id>`).
5. Read Results by name: `execution.result('updates').all()` (bounded) or
   `rows()` (streaming). Pass a schema to validate rows: a Standard Schema
   validator (zod, valibot, ArkType) in TypeScript, a pydantic model in
   Python. A row that does not match raises; nothing is coerced.
6. Close the client. Runs are durable: after a crash, `attach(ref)` finds
   the same Run and `wait()` continues from its real state; completed work
   is never repeated.

The read-only shortcut `open({stateDir})` / `actql.open(state_dir=...)`
returns a handle for `SELECT` queries only; anything with an Effect goes
through `connect`.

## 3. Where policy and credentials live

Never in the Program and never in application code. The Host configuration
(`~/.config/actql/host.json`, or the file named with `--host-config`)
holds `account_config`, `run_policy`, `effect_policy` and `signers`; the
project file `actql.config.json` names the connectors, model tasks, state
directory and mock fixtures. Without an `account_config`, the standard
Local policy applies: reads and `INFER` run, every Effect goes to
`effect_policy`, whose default `review` stops at a Checkpoint. An explicit
account `deny` is never overridden by anything. Read
`references/guides/hosts.md` (policy, remote Hosts, Cloud) and
`references/reference/configuration.md` (every field).

Suggested progression: `profile: 'mock'` in development and CI (no
credentials, fixtures from `actql.config.json`), real connections with
`review` for the first production runs, and `allow` or a `decide` hook by
rule only for Programs that have proven stable.

## 4. Gotchas

- `.actql` (the state directory) is the application's durable state: back
  it up like a database and keep it out of version control. Deleting it
  loses resumability and reconciliation of unknown writes.
- Two apps must not share one state directory for the same Program unless
  they mean to share Runs.
- `succeeded` can still contain `accepted` Effect items (the system took the
  write and confirms later). Read `effects` before telling the user the
  write is done.
- An `unknown` Effect outcome is settled through the Connector's own
  evidence; the app must never resend the write itself.
- `wait()` on an already stable Run returns immediately; use `since` to
  wait for change.
- The lightweight SDK makes no network call on import and never downloads
  an engine; `mode: 'local'` with it is a configuration error, not a
  missing download.
- `references/reference/status.md` says which SDK features run today per
  environment (Node, Python, remote Host, Cloud). Python Local and Cloud are
  behind Node at the time of writing; check before promising.
