<!-- Generated from actql/actql@747e5c2771ca docs/connectors/calendar.md; do not edit. The published page is https://actql.com/docs/actql/connectors/calendar -->
# Google Calendar

The Google Calendar Connector reads calendars, events and free/busy
information, and creates, updates, upserts and deletes events, answers
invitations and moves events between calendars. A Program can look at what is
scheduled, decide with a model what needs a follow-up, and put it on the
calendar.

## Sources

- `calendar.calendars` — the calendars the account can see: `id`, `summary`,
  `time_zone`, `access_role`. Key `id`.
- `calendar.events` — events: `id`, `ical_uid`, `calendar_id`, `summary`,
  `description`, `start`, `end`, `all_day`, `location`, `status`, `organizer`,
  `attendees` (an array of objects with `email`, `response_status`,
  `optional`), `recurring_event_id`, `created`, `updated`, `etag`. Key
  (`calendar_id`, `id`); `ical_uid` is unique across calendars. Filter by
  calendar and time range; recurring events are expanded into instances.
- `calendar.free_busy` — busy intervals for a calendar in a time range:
  `calendar_id`, `start`, `end`. Filter by calendar and time range; the
  source has no key.

## Types

| Calendar | ActQL | Notes |
| --- | --- | --- |
| `id`, `iCalUID`, `recurringEventId` | `string` | Stable identifiers. |
| `start`/`end` `dateTime` | `timestamp` | With its offset; `all_day = false`. |
| `start`/`end` `date` | `date` | All-day events; `all_day = true`. The two forms never mix in one column: `start` is a `timestamp` column and all-day starts are read as midnight in the calendar's time zone, with `all_day` telling them apart. |
| `attendees[]` | `array<struct<email string, response_status string, optional bool>>` | `response_status` is `needsAction`, `declined`, `tentative` or `accepted`. |
| `status` | `string` | `confirmed`, `tentative`, `cancelled`. |
| `etag` | `string` | Also the apply-time condition for updates and deletes. |
| `created`, `updated` | `timestamp` | UTC. |

Writes convert in the other direction with the same rules; an all-day event
is written by setting `all_day = TRUE` and `date`-typed `start` and `end`.

## Effects and operations

Record Effects write by key:

- **insert** — `EFFECT INSERT calendar.events (calendar_id, summary, start, end, …) VALUES (…)`.
- **update** — `EFFECT UPDATE calendar.events ID id SET (…)`.
- **upsert** — `EFFECT UPSERT calendar.events ID ical_uid SET (calendar_id = …, summary = …, start = …, end = …, …)`
  creates the event or updates the one with that `iCalUID` — the way to keep
  a calendar in step with a source system without duplicating events.
- **delete** — `EFFECT DELETE calendar.events ID id`.

`id` identifies exactly one event within its calendar; `ical_uid` identifies
it across calendars. `ID id` is enough because the row's `calendar_id` column
names the calendar; a row without it is refused at `check`. Setting `send_updates = 'all'` on an insert, update or
delete sends invitations or cancellations to attendees; the default makes
the change silently.

Operations:

- **respond** — `EFFECT COMMAND calendar.respond TARGET event_id ID key INPUT (response = 'accepted' | 'declined' | 'tentative')`
  records the connected account's response to an invitation.
- **move** — `EFFECT COMMAND calendar.move TARGET event_id ID key INPUT (destination = calendar_id)`
  moves the event to another calendar.

Both end `applied` once Calendar confirms the change; the invitation emails
that `send_updates` triggers are Calendar's own work and are not tracked.

## Setup

```json
"calendar": {
  "connector": "calendar",
  "credentials": {
    "service_account": {"env": "GOOGLE_SERVICE_ACCOUNT_JSON"},
    "delegate": "ops@acme.com"
  }
}
```

Share each calendar with the service account (see events to read, make
changes to write), or use domain-wide delegation with the `calendar.readonly`
or `calendar.events` scope and set `delegate`. Responding to an invitation
acts as the delegated account. On ActQL Cloud, hosted OAuth signs the account
in without a service account; the same scopes are requested.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; `attendees` is requested only when a column needs it. |
| `WHERE` | The predicate is on `calendar_id`, a `start`/`end` time range, `updated` or a free-text match on `summary`/`description` — what the events API's `timeMin`, `timeMax`, `updatedMin` and `q` express exactly. Predicates on `attendees`, `status` and `location` run on the Host; a mixed predicate is split with the residual evaluated by the Host. |
| `ORDER BY`, `LIMIT` | `ORDER BY start` (ascending) with `LIMIT`; other orders run on the Host. |
| `AGGREGATE`, `JOIN` | Never; both run on the Host. |

`explain` shows the read with Site `connector:calendar` and Engine `Calendar
API`.

## Preview and reconciliation

**Preview.** Updates, upserts of an existing event, deletes, responses and
moves are `full_diff`: the Connector reads the event, records its current
fields and `etag`, and the Preview shows current and new values. The request
carries that `etag` (`If-Match`); an event changed in between makes the item
`failed` with `conflict`, and the Run produces a new Preview if asked to
continue. Inserts and upserts that create are `targeted`: the Preview shows
the full event that would be created and the calendar it goes to.

**Reconciliation.** Before sending, the Connector writes the request's marker
into the event's private extended properties. A lost reply after a create is
reconciled by listing events in the request's time window for **that
marker**; an event with the same summary and time but no marker is not
evidence. Updates, responses and moves write the request's marker into the same
extended property in the same request, so they are reconciled by reading the
event back and finding that marker with the approved values; an `etag` that
moved, or the values alone, is not evidence. A delete is confirmed by the
event's `status = 'cancelled'` together with the marker. When none of this settles the outcome, the item stays `unknown` and
nothing is re-sent.

## Limits and cost

- Events in a time range are read 250 at a time; recurring events are
  expanded into instances, so a long range over a recurring series is many
  rows and counts against the Program's row limit.
- The API applies per-user and per-project quota units; the Connector paces
  within them and stops with an error, never a partial result, when the
  Program's row limit is reached.
- `send_updates = 'all'` sends an email per attendee per change; a Program
  that updates many events with it is bounded by the Effect's item limit, and
  the Preview says invitations would be sent.
- Free/busy queries cover at most the API's time-range limit per request;
  longer ranges are split.

## Example

Next week's customer meetings:

```sql
FROM calendar.events
|> WHERE calendar_id = 'sales@acme.com'
     AND start >= CURRENT_TIMESTAMP()
     AND start < TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
     AND status != 'cancelled'
|> SELECT start, summary, ARRAY_LENGTH(attendees) AS people
|> ORDER BY start;
```

Schedule a check-in for every high-risk account, once:

```sql
SELECT a.id, a.name, a.owner_email, risk.value.reason AS reason
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.description, active_users = u.active_users, trend = u.trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> EXTEND CONCAT('churn-checkin-', id, '@acme.com') AS ical_uid
|> EFFECT UPSERT calendar.events ID ical_uid
     SET (calendar_id = owner_email, summary = CONCAT('Check-in: ', name), description = reason,
          start = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 2 DAY),
          end = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 2 DAY) + INTERVAL 30 MINUTE);
```

Running it again updates the same events instead of creating new ones.

Decline every meeting that overlaps a planned absence:

```sql
FROM calendar.events
|> WHERE calendar_id = 'kim@acme.com'
     AND start >= @away_from AND start < @away_until
     AND status != 'cancelled'
|> EFFECT COMMAND calendar.respond TARGET id ID id INPUT (response = 'declined');
```
