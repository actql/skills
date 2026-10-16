<!-- Generated from actql/actql@747e5c2771ca docs/connectors/hubspot.md; do not edit. The published page is https://actql.com/docs/actql/connectors/hubspot -->
# HubSpot

The HubSpot Connector reads CRM objects, their associations and engagements
from a HubSpot account, writes records back, links records to each other and
enrols them in workflows. Use it to score companies and deals with data from
elsewhere, keep CRM properties current, and hand records to HubSpot's own
automation.

## Sources

The standard CRM objects and custom objects are sources: `hubspot.companies`,
`hubspot.contacts`, `hubspot.deals`, `hubspot.tickets`, and custom objects by
their name. Columns are the object's properties, discovered from the account's
schema, so a property added in HubSpot becomes a column without any change to
the Connector. The key of every object is `id`.

- `hubspot.associations` — one row per association between two records:
  `from_object`, `from_id`, `to_object`, `to_id`, `type`. A deal's company or
  a ticket's contact is a row here, so a join between two HubSpot objects is
  an ordinary `JOIN` through it. Each object also carries its primary
  associations as id columns (`company_id` on a deal) for the common case.
- `hubspot.engagements` — notes, calls, emails, meetings and tasks:
  `id`, `type`, `timestamp`, `owner_id`, `body`, and the ids of the records
  they are associated with.

## Types

| HubSpot property type | ActQL | Notes |
| --- | --- | --- |
| `string` | `string` | |
| `number` | `decimal(38, 10)` | HubSpot numbers are arbitrary-precision decimals; currency properties keep the account's precision. |
| `bool` | `bool` | |
| `enumeration` (select, radio) | `string` | The internal value, not the label. A write of a value outside the options fails the item. |
| `enumeration` (checkbox, multi) | `array` of `string` | Split and joined on `;` by the Connector. |
| `date` | `date` | |
| `datetime` | `timestamp` | A UTC instant with millisecond precision. |
| `object_coordinates`, `phone_number` | `string` | |
| Association ids | `string` | Record ids are strings, as in HubSpot's API. |
| Calculation, rollup and score properties | their result type | Read only; a write to one fails `check`. |

Writes convert in the other direction with the same rules; a value that does
not fit the property fails `check` when it is known statically and the item
otherwise.

## Effects and operations

Record Effects write by key:

- **insert** — `EFFECT INSERT hubspot.companies (name, domain, …) VALUES (…)`.
- **update** — `EFFECT UPDATE hubspot.companies ID id SET (…)`.
- **upsert** — `EFFECT UPSERT hubspot.contacts ID email SET (…)`, where the
  key is a property HubSpot treats as unique (`email` on contacts, `domain`
  on companies, or a custom property marked unique); HubSpot matches on it as
  the `idProperty` and creates the record when none matches.
- **delete** — `EFFECT DELETE hubspot.companies ID id` (HubSpot archives the
  record; it stays recoverable in the recycle bin).

The key named by `ID` must identify exactly one record. `id` always does; a
unique property is unique by HubSpot's own enforcement, and the Connector
refuses at `check` a property that is not marked unique. An update whose
source rows carry two different values for the same key is refused at
`check`.

Operations:

- **associate** — `EFFECT COMMAND hubspot.associate TARGET deal_id ID key INPUT (to_object = 'companies', to_id = company_id, type = 'deal_to_company')`
  links two records with a labelled association.
- **enroll** — `EFFECT COMMAND hubspot.enroll TARGET contact_id ID key INPUT (workflow = @workflow_id)`
  enrols a contact in a workflow.

## Setup

```json
"hubspot": {
  "connector": "hubspot",
  "credentials": {"access_token": {"env": "HUBSPOT_ACCESS_TOKEN"}}
}
```

Use a private app token. The app needs the `crm.objects.<object>.read` scope
for each object a Program reads and `crm.objects.<object>.write` for each
object it writes (for example `crm.objects.companies.read` and
`crm.objects.companies.write`), `crm.schemas.<object>.read` to discover
properties, and `automation` for workflow enrolment. Associations use the
object scopes of both sides.

On ActQL Cloud, HubSpot is connected through the Cloud's hosted OAuth
application; a private app token works there too.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; only the referenced properties are requested. |
| `WHERE` | The predicate uses properties of one object and operators the search API evaluates like ActQL: `=`, `!=`, `<`, `>`, `IN`, `IS NULL`, and `LIKE` with a trailing `%` (prefix match). Full-text `CONTAINS_TOKEN` is not used for a `LIKE`. A predicate that mixes objects or sources stays in the engine or is split, with the residual evaluated by the Host. |
| `ORDER BY`, `LIMIT` | When the sort is on one property and the limit is within the search API's 10,000-result window; beyond it the Connector reads through the list endpoint and sorts on the Host. |
| Aggregation | Never inside HubSpot; aggregates run on the Host over the fetched rows. |
| `JOIN` | Never inside HubSpot; joins run in the engine, through association id columns or `hubspot.associations`. |

`explain` shows a pushed-down step with Site `connector:hubspot` and
Interface `HubSpot API`.

## Preview and reconciliation

**Preview.** Updates, upserts and deletes are previewed as `full_diff`: the
Connector reads the target records by key, records the current property
values and each record's `hs_lastmodifieddate`, and the Preview shows current
and new values per property. HubSpot has no conditional write, so at apply
time the Connector re-reads each target in the same batch call and sends the
update only when the properties it previewed are unchanged; a record changed
in between is not updated — the item ends `failed` with `conflict`, and the
Run produces a new Preview if asked to continue. Inserts are previewed as
`targeted`, with every property value. An association previews both records
and the type; an enrolment previews the contact and the workflow.

**Reconciliation.** Every write goes through the batch endpoints under a
request id the Connector generates and records against the Effect items, and
each written record carries the request id in a property the connection names
(`actql_request_id`, created once on the object). A lost reply is reconciled
by reading the property history of the target records: HubSpot records each
change with its source (this integration's app id) and timestamp, so the
Connector looks for the change from this app in the request window that set
the request-id property — a matching value or a newer `hs_lastmodifieddate`
alone is not evidence. A creation is reconciled by searching for the
request-id property; an association through the property history entry this app wrote in the
same request (HubSpot stores no request id on the association itself, so an
association without such an entry stays `unknown`); an
enrolment by reading the workflow's enrolment history for the contact. When
none of this settles the outcome, the item stays `unknown` and nothing is
resent. Operations end `accepted` when HubSpot took the request, `applied`
when the association or enrolment is visible, and `unknown` when neither can
be established.

## Limits and cost

- HubSpot limits requests per 10 seconds and per day per account. The
  Connector paces reads and writes within those limits and fails a Program
  that would exceed the daily limit before sending.
- Reads are paged 100 records at a time (200 with the list endpoint); the
  search API returns at most 10,000 results per query. The Connector follows
  pages up to the Program's row limit and stops with an error rather than
  returning a partial result.
- Search results are eventually consistent: a record changed seconds ago may
  not match a filter yet. Reads by id are always current, and Previews are
  built from reads by id.
- Batch writes carry up to 100 records per call; larger Effects are sent in
  several calls, each with its own request id.

## Example

Deals that have been open for more than 90 days:

```sql
FROM hubspot.deals
|> WHERE stage NOT IN ('closedwon', 'closedlost')
     AND createdate < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
|> SELECT id, dealname, amount, createdate
|> ORDER BY amount DESC;
```

Score companies and write the score back:

```sql
SELECT c.id AS id, c.description AS notes, u.active_users, u.trend
FROM hubspot.companies AS c
JOIN snowflake.usage_30d AS u ON c.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes, active_users, trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> EFFECT UPDATE hubspot.companies
     ID id SET (churn_risk = risk.value.level, risk_reason = risk.value.reason);
```

Enrol the contacts of those companies in a retention workflow:

```sql
FROM hubspot.companies AS c
|> WHERE c.churn_risk = 'high'
|> JOIN hubspot.associations AS a
     ON a.from_object = 'companies' AND a.from_id = c.id AND a.to_object = 'contacts'
|> SELECT a.to_id AS contact_id
|> EFFECT COMMAND hubspot.enroll TARGET contact_id ID contact_id
     INPUT (workflow = @retention_workflow);
```
