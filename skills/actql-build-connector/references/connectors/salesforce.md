<!-- Generated from actql/actql@747e5c2771ca docs/connectors/salesforce.md; do not edit. The published page is https://actql.com/docs/actql/connectors/salesforce -->
# Salesforce

The Salesforce Connector reads standard and custom objects and files from a
Salesforce org, writes records back, stores files, and runs org operations
such as converting a lead. It is the Connector in the churn-risk example:
accounts are read, joined with warehouse data, judged by a model and updated
with the result.

## Sources

Every object the connected user can see is a source, named by its API name in
lowercase: `salesforce.accounts`, `salesforce.contacts`,
`salesforce.opportunities`, `salesforce.cases`, and custom objects such as
`salesforce.subscriptions__c`. Columns are the object's fields, discovered
from the org's metadata, so a field added in Salesforce becomes a column
without any change to the Connector. The key of every object is `Id`.

Files are sources too: `salesforce.files` lists ContentVersion records with
`resource`, `version` (the ContentVersion id, which changes with every new
version), `title`, `file_extension`, `size` and `linked_to` (the records the
file is attached to), and `salesforce.contents` joined on `resource` and
`version` reads a file as a `content_ref`.

Field-level security applies: a field the integration user cannot see is not
a column, and a Program that names it fails `check`.

## Types

| Salesforce | ActQL | Notes |
| --- | --- | --- |
| `Id`, Lookup, Master-Detail | `string` | 18-character ids. |
| Text, TextArea, Long Text, Rich Text, URL, Email, Phone | `string` | Rich text keeps its HTML. |
| Number(p, s), Currency, Percent | `decimal(p, s)` | Precision and scale are those declared on the field. |
| Checkbox | `bool` | |
| Date | `date` | |
| DateTime | `timestamp` | A UTC instant; Salesforce stores no zone. |
| Time | `time` | |
| Picklist | `string` | The API name of the value. A write of a value not in the picklist fails the item unless the field is unrestricted. |
| Multi-select Picklist | `array` of `string` | Split and joined on `;` by the Connector. |
| Auto Number, Formula, Roll-Up Summary | their result type | Read only; a write to one fails `check`. |
| Geolocation | `object` with `latitude`, `longitude` | |
| Address (compound) | `object` | Read as one object; written through its component fields. |
| Base64 (ContentVersion data) | `content_ref` | Through `salesforce.contents` only. |

Writes convert in the other direction with the same rules; a value that does
not fit the field fails `check` when it is known statically and the item
otherwise.

## Effects and operations

Record Effects write by key, naming the object by its API name
(`salesforce.Account`):

- **insert** — `EFFECT INSERT salesforce.Account (Name, Industry, …) VALUES (…)`.
- **update** — `EFFECT UPDATE salesforce.Account ID id SET (…)`.
- **upsert** — `EFFECT UPSERT salesforce.Account ID External_Id__c SET (…)`,
  where the key is a field marked External ID; Salesforce matches on it and
  creates the record when none matches.
- **delete** — `EFFECT DELETE salesforce.Account ID id`.

The key named by `ID` must identify exactly one record. `Id` always does; an
External ID field is unique by declaration, and the Connector refuses at
`check` a field that is not marked External ID. An update whose source rows
carry two different values for the same key is refused at `check`.

Files:

- **store** — `EFFECT STORE salesforce.files SET (title = …, content = content, linked_to = account_id)`
  creates a ContentVersion from the row's `content` (from `SERIALIZE` or a
  `contents` source) and links it to the named record.

Operations:

- **convert_lead** — `EFFECT COMMAND salesforce.convert_lead TARGET lead_id ID lead_id INPUT (account_id = …, opportunity_name = …, converted_status = 'Qualified')`
  converts a lead into an account, contact and optional opportunity.
- **send_email** — `EFFECT COMMAND salesforce.send_email ID key INPUT (template = 'Renewal_Reminder', to = contact_id, what = opportunity_id)`
  sends an email through a Salesforce email template to a contact or lead.

## Setup

```json
"salesforce": {
  "connector": "salesforce",
  "instance_url": "https://acme.my.salesforce.com",
  "api_version": "v62.0",
  "credentials": {"access_token": {"env": "SALESFORCE_ACCESS_TOKEN"}}
}
```

The access token belongs to an integration user; a connected app with the
JWT bearer flow (`credentials.jwt_private_key` and `credentials.client_id`)
can be used instead so the Host refreshes the token itself. That user needs
read access to every object and field a Program reads, create, edit or delete
access to the objects a Program writes, and the "Convert Leads" and "Send
Email" permissions for the operations. ActQL asks for nothing beyond what the
Programs you run need, and policy on the Host can restrict further per object
and operation.

On ActQL Cloud, Salesforce is connected through the Cloud's hosted OAuth
application; until that application is approved for your org, the same
token or JWT configuration works there as on a Local Host.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; only the referenced fields are selected (SOQL `SELECT`). |
| `WHERE` | The predicate uses fields of one object and operators SOQL evaluates like ActQL: `=`, `!=`, `<`, `>`, `IN`, `LIKE` (case-insensitive in SOQL, so a case-sensitive `LIKE` stays on the Host), `IS NULL`, date literals. A predicate that mixes objects or sources stays in the engine or is split, with the residual evaluated by the Host. |
| `ORDER BY`, `LIMIT` | When the sort is on fields SOQL can order (not Long Text or Multi-select) and the limit is a constant or parameter. |
| Aggregation | `COUNT`, `COUNT(DISTINCT)`, `SUM`, `AVG`, `MIN`, `MAX` with `GROUP BY` on groupable fields, within SOQL's 2,000-row aggregate limit; otherwise the aggregation runs on the Host over the fetched rows. |
| `JOIN` | Never inside Salesforce; relationship fields are read as id columns and joins run in the engine. |

`explain` shows a pushed-down step with Site `connector:salesforce` and
Interface `Salesforce API`.

## Preview and reconciliation

**Preview.** Updates, upserts and deletes are previewed as `full_diff`: the
Connector reads the target records by key, records the current field values
and each record's `SystemModstamp`, and the Preview shows current and new
values per field. At apply time the write carries an `If-Unmodified-Since`
condition on that `SystemModstamp`; a record changed between Preview and
apply is not updated — the item ends `failed` with `conflict`, and the Run
produces a new Preview if asked to continue. Inserts and file stores are
previewed as `targeted`: the records or files that would be created, with
every field value. A lead conversion previews the lead, the account and
contact it would create or merge into, and the status; an email previews the
template, recipient and related record.

**Reconciliation.** Every write is sent through the Composite or Bulk API 2.0
under a job or request id the Connector generates and records against the
Effect items before sending, and each record in the request carries a marker
in a dedicated field the connection names (`ActQL_Request__c`, when the org
has it) or in the Bulk job's external reference. A lost reply is reconciled
by fetching that job or composite request by its id and reading its
per-record results; a record carrying the expected values, or one whose
`LastModifiedDate` falls after the send, is not evidence on its own. A lead
conversion is reconciled through the lead's `IsConverted`,
`ConvertedAccountId` and the request marker; an email through the
`EmailMessage` record Salesforce creates for the send. When none of this
settles the outcome, the item stays `unknown` and nothing is resent.
Operations end `accepted` when Salesforce queued the email or started the
conversion, `applied` when the resulting records exist, and `unknown` when
neither can be established.

## Limits and cost

- Reads are paged by the API (2,000 records per SOQL page); the Connector
  follows pages up to the Program's row limit and stops with an error rather
  than returning a partial result.
- Salesforce's daily API request limit is shared by everything that uses the
  org. A Program that would exceed it fails before it starts sending; it does
  not consume the remaining quota blindly. Bulk API 2.0 jobs count separately
  and are used for Effects above the Composite API's 200-record batch.
- File contents are bounded by the Program's byte limit; a ContentVersion
  larger than that is refused rather than read partially. Uploads above the
  REST limit (2 GB) are refused at `check`.
- Email sends count against the org's daily single-email limit; a Program
  that would exceed it fails before sending.

## Example

Read the accounts whose usage is falling:

```sql
SELECT a.id, a.name, a.description
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> WHERE u.trend = 'down'
|> ORDER BY a.name;
```

Judge each account's churn risk and write it back:

```sql
SELECT a.id AS id, a.description AS notes,
       u.active_users, u.trend
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> RESULT updates
|> EFFECT UPDATE salesforce.Account
     ID id SET (
       Churn_Risk__c = risk.value.level,
       Risk_Reason__c = risk.value.reason
     );
```

The update stops at a Checkpoint when policy says so; the preview lists each
account with the current and new values of `Churn_Risk__c` and
`Risk_Reason__c`.

Convert the leads a model rates as qualified:

```sql
FROM salesforce.leads AS l
|> WHERE l.status = 'Working' AND l.is_converted = FALSE
|> INFER `model-task:lead-qualification.v1`
     INPUT (company = l.company, notes = l.description) AS q
|> WHERE q.outcome = 'ok' AND q.value.qualified
|> EFFECT COMMAND salesforce.convert_lead TARGET l.id ID l.id
     INPUT (converted_status = 'Qualified', opportunity_name = l.company || ' - new business');
```
