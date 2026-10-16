<!-- Generated from actql/actql@d904416674e4 docs/reference/status.md; do not edit. The published page is https://actql.com/docs/actql/reference/status -->
# Implementation status

This is the one page that describes what is implemented today. Every other
page describes ActQL 0.1 as designed: the guarantees in the specification and
the product surface the rest of the documentation shows. Use this page to
check whether a feature runs in your environment before you depend on it.
The ceilings every Program runs under are on [Runtime limits](https://actql.com/docs/actql/reference/limits).

## Status by environment

| Mark | Status | Meaning |
| --- | --- | --- |
| ✔ | **Implemented** | Runs in that environment; covered by the repository's checks. |
| ◐ | **Experimental** | Runs, but the surface or its limits may still change before 0.1. |
| ○ | **Planned** | Defined in the specification and shown in the documentation; not yet executable in that environment. |
| — | Not applicable | The feature has no meaning in that environment or for that Connector. |

| Feature | CLI | Node | Python | Remote Host | ActQL Cloud |
| --- | --- | --- | --- | --- | --- |
| SQL and Pipe queries over local values | ✔ | ✔ | ○ | ✔ | ○ |
| `check`, `explain`, `run`, `approve`, `status` (convenience commands) | ○ | — | — | — | — |
| `explain --verbose`, `explain --run`, `actql-explanation/0.1` JSON | ○ | ○ | ○ | ○ | ○ |
| `connect` / `startSource` / `wait` / `result` / `attach` | — | ✔ | ○ | ✔ | ○ |
| Mock profile (`--profile mock`) | ○ | ○ | ○ | ○ | ○ |
| Pushdown to a Connector | ◐ | ◐ | ○ | ◐ | ○ |
| Cross-source joins in DuckDB | ◐ | ◐ | ○ | ◐ | ○ |
| `INFER` with a model task | ◐ | ◐ | ○ | ◐ | ○ |
| `EFFECT … UPDATE TARGET … MAPPING …` (long form) | ◐ | ◐ | ○ | ◐ | ○ |
| `EFFECT … COMMAND` postlude (long form) | ◐ | ◐ | ○ | ◐ | ○ |
| `CREATE [OR REPLACE] TABLE` | ◐ | ◐ | ○ | ◐ | ○ |
| `EFFECT UPDATE / UPSERT / DELETE … ID …` (short forms) | ○ | ○ | ○ | ○ | ○ |
| `EFFECT INSERT`, `EFFECT STORE`, `EFFECT COMMAND … ID …` (short forms) | ○ | ○ | ○ | ○ | ○ |
| `LIST_FILES`, `contents` sources (`content_ref`), `SERIALIZE`, `STORE` of content | ○ | ○ | ○ | ○ | ○ |
| SQL `INSERT` / `UPDATE` / `DELETE` statement Effects | ○ | ○ | ○ | ○ | ○ |
| Checkpoints and approval | ◐ | ◐ | ○ | ◐ | ○ |
| `--stop-before commit` / `stopBefore` | ○ | ○ | ○ | ○ | ○ |
| Reconciliation of unknown outcomes | ◐ | ◐ | ○ | ◐ | ○ |
| Named Results and delivery | ✔ | ✔ | ○ | ✔ | ○ |
| `NEAREST` shorthand and vector functions | ○ | ○ | ○ | ○ | ○ |
| Graph construction, `MATCH` and graph operations | ◐ | ◐ | ○ | ◐ | ○ |
| Event operations | ◐ | ◐ | ○ | ◐ | ○ |
| Local Host (embedded) | ✔ | ✔ | ○ | — | — |
| Remote Host over HTTPS | — | ✔ | ✔ | ✔ | ○ |

"Node" is the `@actql/node` package; "Python" is the `actql` package. The
CLI column covers the native `actql` command.

## Connectors

Every Connector page describes the full v0.1 surface: reads, record
Effects, tables and content, operations, Preview and reconciliation. The
columns say what runs today.

| Connector | Read | Record Effects | Tables and content | Operations | Preview and reconciliation |
| --- | --- | --- | --- | --- | --- |
| DuckDB | ✔ | ◐ insert, update | ○ | — | ○ |
| Local files | ✔ | ○ | ◐ store rows, long form | ○ | ○ |
| Google Cloud Storage | ◐ | ○ | ◐ upload, long form | ○ | ○ |
| Salesforce | ◐ | ◐ single-record update | ○ | ○ | ○ |
| Google Sheets | ◐ | ◐ append | ○ | ○ | ○ |
| GitHub | ◐ | ◐ create | ○ | ○ | ○ |
| Snowflake | ○ | ○ | ○ | ○ | ○ |
| BigQuery | ○ | ○ | ○ | ○ | ○ |
| HubSpot | ○ | ○ | — | ○ | ○ |
| Slack | ○ | ○ | ○ | ○ | ○ |
| Notion | ○ | ○ | ○ | ○ | ○ |
| kintone | ○ | ○ | ○ | ○ | ○ |
| Tableau | ○ | ○ | ○ | ○ | ○ |
| Google Drive | ○ | ○ | ○ | ○ | ○ |
| Gmail | ○ | ○ | ○ | ○ | ○ |
| Google Calendar | ○ | ○ | — | ○ | ○ |
| Amazon S3 | ○ | ○ | ○ | ○ | ○ |

"Preview and reconciliation" means the apply-time condition check
(`full_diff` with a conflict outcome) and the evidence-based lookup of a lost
reply that each Connector page describes.
