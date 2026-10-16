<!-- Generated from actql/actql@747e5c2771ca docs/connectors/README.md; do not edit. The published page is https://actql.com/docs/actql/connectors -->
# Connectors

A Connector connects ActQL to one external system. In a Program you only see
names such as `salesforce.accounts`; authentication, paging, rate limits and
the shape of each API stay inside the Connector. This page lists the
Connectors that ship with ActQL, shows how a Connector is configured, and
explains what every Connector page has in common.

Every Connector reads **and** writes, and all seventeen use the same model:
typed sources that `check` validates, Effects and operations that are
previewed and approved, and outcomes that are recorded and reconciled the
same way whether the target is a warehouse table, a CRM record, a Slack
channel or a bucket.

## The Connectors

| Group | Connector | Reads | Record Effects | Tables and content | Operations |
| --- | --- | --- | --- | --- | --- |
| Databases & warehouses | [Snowflake](snowflake.md) | tables, views, staged files | insert, update, upsert, delete | create table, store to a stage | call, execute task |
| Databases & warehouses | [BigQuery](bigquery.md) | tables, views | insert, update, upsert, delete | create table, load from GCS | call, run a query job |
| Databases & warehouses | [DuckDB](duckdb.md) | tables, views | insert, update, upsert, delete | create table, copy to a file | — |
| SaaS | [Salesforce](salesforce.md) | objects, files | insert, update, upsert, delete | store a file | convert lead, send email |
| SaaS | [HubSpot](hubspot.md) | objects, associations, engagements | insert, update, upsert, delete | — | associate, enroll in a workflow |
| SaaS | [Notion](notion.md) | databases, pages, page content | insert, update, upsert, archive | store a file block | append blocks |
| SaaS | [kintone](kintone.md) | apps, subtables, attachments | insert, update, upsert, delete | store an attachment | update status |
| SaaS | [Slack](slack.md) | channels, messages, users, files | update, delete messages | share a file | post, reply, react, archive channel |
| SaaS | [GitHub](github.md) | issues, pull requests, comments, repository files | insert, update, delete | commit a file | merge, close, request review, add labels |
| SaaS | [Tableau](tableau.md) | workbooks, data sources, views, view data, flows | update, delete | publish a data source | refresh, run flow |
| Google | [Google Sheets](sheets.md) | declared ranges | insert, update, upsert, delete rows by a declared key | replace a range, new sheet | clear range |
| Google | [Google Drive](drive.md) | files, folders, contents, comments | update, delete (trash) | upload | copy, share, purge |
| Google | [Gmail](gmail.md) | messages, threads, labels, drafts, attachments | update labels, trash, create drafts | attach to a draft | send, reply, forward, purge |
| Google | [Google Calendar](calendar.md) | calendars, events, free/busy | insert, update, upsert, delete | — | respond, move |
| Storage & files | [Google Cloud Storage](gcs.md) | objects, contents | update metadata, delete | upload | copy, compose |
| Storage & files | [Amazon S3](s3.md) | objects, contents | update metadata, delete | upload | copy, restore |
| Storage & files | [Local files](local-files.md) | declared tables, files, contents | delete | create table, store, write a file | move |

## Three things with similar names

- A **Connector** is the implementation: the code that knows how to talk to
  Salesforce or Snowflake.
- A **connection** is one configured instance of it: a name, an endpoint or
  account, and credentials. `salesforce_prod` and `salesforce_sandbox` are two
  connections of one Connector.
- A **resource** is something a connection exposes — an object, a table, a
  channel — and its **SourceView** is the typed, versioned contract for reading
  it: columns, types, key, paging.

## How a Connector appears in a Program

Every resource is a table-shaped source under the connection's name:

```sql
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> WHERE u.trend = 'down'
```

Columns and their types come from the Connector, so `check` validates a
Program against them before anything is read.

Writes are Effects. Record Effects name the connection, the resource and the
key:

```sql
|> EFFECT UPDATE salesforce.Account
     ID id SET (Churn_Risk__c = risk.value.level)
```

Operations — sending, posting, refreshing, starting a job — are Effects too,
declared with `EFFECT COMMAND` and the operation's name:

```sql
FROM notifications
|> EFFECT COMMAND slack.post
     TARGET channel
     ID notification_id
     INPUT (text = message);
```

`slack.post` resolves to one versioned Command contract the Connector
publishes: its input fields and types, the resource it acts on, the permission
it needs, what its Preview shows and how its outcome is confirmed. Gmail's
`send`, Tableau's `refresh`, Slack's `post` and a Drive upload all go through
this one model, so every Effect — record write or operation — is previewed,
decided and recorded the same way. See [Effects and approvals](../guides/effects-and-approvals.md).

## Files and content

Four Connectors deal in files — Google Drive, Google Cloud Storage, Amazon S3
and Local files — and Snowflake, Salesforce, Notion, kintone, Slack, GitHub
and Gmail expose file content as well. They all follow one set of rules:

| Step | Role |
| --- | --- |
| `LIST_FILES(connection.listing, …)` (the bare connection when it has one listing source) | Metadata only: `resource`, `version`, `path`, size, type. Nothing is downloaded. |
| `JOIN connection.contents ON resource AND version` | Reads the content of exactly those versions, as a `content_ref` with a `media_type`. |
| `content_ref` | A typed reference to captured bytes. It can be handed to `INFER`, stored elsewhere, or read as a typed table through a Connector that declares the format. |
| `SERIALIZE` | Turns rows into one file's content. It uploads nothing. |
| `EFFECT STORE` | Writes content to an object, file or stage, or rows into a declared table. |
| `CREATE [OR REPLACE] TABLE` | Writes rows as a new table in a Connector that has a catalog. |

Listing and reading are separate steps on purpose: a Program names the exact
versions it reads, the byte limit applies to a known set of files, and a file
replaced during the Run is a different version, never silently the same
document. [Working with files](../authoring.md#working-with-files) shows the
Program side.

## Connections and credentials

Connections live in the file `actql.config.json` points to as `connectors`
(by default `connectors.json`). One entry per connection:

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
      "account": "acme-eu",
      "warehouse": "ANALYTICS",
      "database": "PRODUCT",
      "schema": "USAGE",
      "credentials": {"private_key": {"env": "SNOWFLAKE_PRIVATE_KEY"}}
    }
  }
}
```

Secrets are never written into the file. A credential field names an
environment variable (`{"env": "…"}`) or a file (`{"path": "…"}`); the
Host keeps the value and lends it to the Connector only for an operation
policy has allowed. A Program cannot name a URL, a credential or a connection
that is not configured. The Host turns this file into the Connector manifests
it uses internally; you never write those by hand.

Two connections can use the same Connector under different names — a
`salesforce_prod` and a `salesforce_sandbox`, for example — and a Program
refers to whichever it needs.

**Local and Cloud.** On a Local Host you supply your own credentials. ActQL
Cloud adds hosted OAuth for the Connectors whose providers require an
approved application; where that approval is pending, the Cloud still accepts
the same credential-based configuration as a Local Host. Each Connector page
says what the account needs. Which Connectors run today is on
[Implementation status](../reference/status.md).

## What `catalog show` tells you

`actql catalog show salesforce` prints everything a Program can rely on for a
connection, from the Catalog the Host has stored (`catalog refresh` asks the
system again):

```text
Connection  salesforce  (Salesforce, catalog revision 2026-10-14T09:12Z)

Sources
  accounts      key id        id string, name string, description string, industry string, …
  contacts      key id        id string, account_id string, email string, …

Effects
  Account       insert, update, upsert (External_Id__c), delete   preview full_diff
  Contact       insert, update, upsert, delete                    preview full_diff
  ContentVersion store                                            preview targeted

Operations
  convert_lead  TARGET Lead  INPUT (account_id string?, opportunity_name string?)
  send_email    INPUT (template string, to string)

Capabilities
  projection, filter (=, !=, <, >, IN, LIKE, IS NULL), order, limit

Permissions
  read:  accounts.read, contacts.read
  write: Account.update, Account.create, …
```

An agent writes Programs against this, not against guesses.

## The mock profile

`--profile mock` (CLI) or `profile: 'mock'` (SDK) replaces every connection
with a mock that serves the records in `mock.data` and
applies writes to those records, so a Program can create a record and read it
back without credentials. The [quickstart](../getting-started/quickstart.md)
runs the churn-risk Program this way.

The switch to real connections is a change of configuration, not of the
Program: as long as the source names, columns, keys, Mappings and operations
mean the same in the mock and the real system, the Program runs unchanged.
Where the real system differs — a renamed field, a missing object — `check`
reports the difference; nothing runs under a quietly different interpretation.

## Capabilities and pushdown

Each Connector declares what its system can compute itself — which columns
can be selected at the source, which filters it can apply, whether it can
aggregate, sort or join — and under which conditions the result keeps ActQL's
meaning exactly (NULL handling, collation, numeric precision). The planner
runs work inside the source only under those conditions and runs the rest in
the engine; `explain` shows where each step went. A Capability is never a
permission: at every protected boundary — a read, data leaving for a model, an
Effect — the Host checks that the operation is allowed. See
[Plans and pushdown](../guides/plans-and-pushdown.md).

## What every Connector page covers

| Section | What it tells you |
| --- | --- |
| **Sources** | The resources, their columns, their key and how far a read may reach. |
| **Types** | The system's types and the ActQL types they become; where precision is kept and where a type is unsupported. |
| **Effects and operations** | Every Effect and operation, with its target, inputs and outcomes. |
| **Setup** | The connection entry, the credentials and permissions a Local Host needs, and what the Cloud offers. |
| **Capabilities and pushdown** | Which operations run inside the system, and the conditions under which they keep ActQL's meaning. |
| **Preview and reconciliation** | How the Preview is built (`full_diff` or `targeted`) and verified at apply time, and what evidence settles a lost reply. |
| **Limits and cost** | Paging, rate limits, read ceilings, and what the external system charges. |
| **Example** | One read-only Program and one Program with an Effect or operation. |

Need a system that is not listed? [Building a Connector](https://actql.com/docs/actql/connectors/authoring)
explains what a Connector declares and how to write one.
