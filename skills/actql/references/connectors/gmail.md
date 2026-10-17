<!-- Generated from actql/actql@84d4ef5bff33 docs/connectors/gmail.md; do not edit. The published page is https://actql.com/docs/actql/connectors/gmail -->
# Gmail

The Gmail Connector reads messages, threads, labels, drafts and attachments
from a mailbox, relabels and trashes messages, creates drafts and attaches
content to them, and sends, replies and forwards. A Program can read what
customers wrote, let a model classify or draft a reply, and send it — after a
person has seen exactly which messages would go out.

## Sources

- `gmail.messages` — messages in the mailbox: `id`, `thread_id`, `from`,
  `to`, `cc`, `subject`, `date`, `snippet`, `body_text` (the plain-text body),
  `labels` (an array), `has_attachments`, `history_id`. Key `id`. Filter by
  date, label, sender or subject; the Connector does not read an entire
  mailbox.
- `gmail.threads` — threads: `id`, `subject`, `message_count`,
  `last_message_date`, `labels`. Key `id`.
- `gmail.labels` — the mailbox's labels: `id`, `name`, `type`. Key `id`.
- `gmail.drafts` — drafts: `id`, `message_id`, `to`, `subject`, `body_text`,
  `updated`. Key `id`.
- `gmail.attachments` — one row per attachment: `resource`, `version`,
  `message_id`, `attachment_id`, `filename`, `media_type`, `size`. Key
  (`message_id`, `attachment_id`). This is the listing; it downloads nothing.
- `gmail.contents` — the content of attachments: `resource`, `version`,
  `media_type` and `content`, a `content_ref`. Join it on `resource` and
  `version` from `gmail.attachments`; the Connector downloads only the
  attachments the join names.

## Types

| Gmail | ActQL | Notes |
| --- | --- | --- |
| `id`, `threadId`, `historyId`, `attachmentId` | `string` | Stable identifiers. |
| RFC 2822 `Date` header, `internalDate` | `timestamp` | Parsed to UTC; a malformed header falls back to `internalDate`. |
| `From`, `To`, `Cc` | `string`, `array<string>` | Addresses as written in the header; `to` and `cc` are arrays. |
| `labelIds` | `array<string>` | Label ids, not names; join `gmail.labels` for names. |
| Body | `string` (`body_text`) | The plain-text part; HTML-only mail is converted to text. |
| Attachment bytes | `content_ref` with `media_type` | Through `gmail.contents`. |
| `sizeEstimate`, attachment `size` | `int64` | |

Writes convert in the other direction with the same rules.

## Effects and operations

Record Effects write by key:

- **update** — `EFFECT UPDATE gmail.messages ID id SET (labels = …)` adds and
  removes labels; `labels` is the complete set after the change.
- **delete** — `EFFECT DELETE gmail.messages ID id` moves the message to the
  trash, where the mailbox's trash policy applies; `gmail.purge` below deletes
  it permanently.
- **insert** — `EFFECT INSERT gmail.drafts (to, subject, body) VALUES (…)`
  creates a draft without sending it.

`id` is Gmail's message id and identifies exactly one message in the
mailbox.

Tables and content:

- **attach** — `EFFECT STORE gmail.attachments SET (draft = draft_id, filename = …, content = content)`
  attaches the row's `content` (from `SERIALIZE` or a `contents` source) to a
  draft.

Operations — sending is an operation, not a record write:

- **send** — `EFFECT COMMAND gmail.send ID key INPUT (to = …, subject = …, body = …)`.
- **reply** — `EFFECT COMMAND gmail.reply ID key INPUT (in_reply_to = message_id, body = …)`
  replies within the thread, keeping its subject and recipients.
- **forward** — `EFFECT COMMAND gmail.forward ID key INPUT (message = message_id, to = …[, body = …])`.
- **purge** — `EFFECT COMMAND gmail.purge TARGET message_id ID key` deletes a
  message permanently, bypassing the trash. It needs the full `mail.google.com`
  scope and is `applied` once Gmail confirms the deletion.

Send, reply and forward act on the connection's mailbox, so they take no `TARGET`; purge names the message as its `TARGET`. `ID` is
the row's key and identifies each send in the Preview and the status; it is
not the recipient. A send that Gmail took ends `accepted`: Gmail accepted the
message for delivery, which does not mean it was delivered or read. Nothing is
sent until the Effect is applied.

## Setup

```json
"gmail": {
  "connector": "gmail",
  "mailbox": "support@acme.com",
  "credentials": {
    "service_account": {"env": "GOOGLE_SERVICE_ACCOUNT_JSON"},
    "delegate": "support@acme.com"
  }
}
```

For a Google Workspace mailbox, grant the service account domain-wide
delegation for the `gmail.readonly` scope (reading), `gmail.modify`
(labels, trash, drafts) and `gmail.send` (sending), and set `delegate` to the
mailbox. For a single account, an OAuth refresh token with the same scopes can
be supplied instead. On ActQL Cloud, hosted OAuth signs the mailbox in
without a service account; the same scopes are requested.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Always; the Connector requests only the message parts the Program's columns need (metadata only when no body column is used). |
| `WHERE` | The predicate uses `from`, `to`, `subject`, `labels`, `date` or `has_attachments` with `=`, `IN`, `<`, `>`, `LIKE 'word%'` — what Gmail's search syntax expresses exactly. Body-text predicates and anything else run on the Host, and a mixed predicate is split with the residual evaluated by the Host. |
| `ORDER BY`, `LIMIT` | `ORDER BY date DESC` only, which is Gmail's own order; other orders run on the Host. |
| `AGGREGATE`, `JOIN` | Never; both run on the Host. |

`explain` shows the read with Site `connector:gmail` and Engine `Gmail
search`.

## Preview and reconciliation

**Preview.** Label changes and trashing are `full_diff`: the Connector reads
the message, records its current labels and `history_id`, and the Preview
shows current and new label sets. The request carries that `history_id`; a
message whose labels changed in between makes the item `failed` with
`conflict`. Draft creation and attachments are `targeted` (the draft's
recipients, subject, body and the attachment's name, media type and size).
Sends, replies and forwards are `targeted`: the Preview lists every message
that would go out — recipients, subject and body — and nothing is sent until
it is approved.

**Reconciliation.** Sending is not idempotent. Before sending, the Connector
puts the request's marker in an `X-ActQL-Request` header of the message; a
lost reply is reconciled by searching the Sent label for **that header**. A
sent message with the same recipients and text but no marker is not evidence.
Label changes and trashing leave no marker Gmail stores, so a lost reply to
one of them stays `unknown`; a moved `history_id` or the new label set alone
is not evidence. Draft creation
is reconciled by listing drafts for the marker in the draft's headers. When
none of this settles the outcome, the item stays `unknown` and nothing is
re-sent.

## Limits and cost

- Gmail limits sends per day per account (lower for new accounts). A Program
  that would exceed it fails before sending anything.
- The API applies per-user quota units per second; the Connector paces within
  them, and a read that would exceed the Program's row limit stops with an
  error rather than a partial result.
- Attachments count against the Program's byte limit; an attachment larger
  than what remains is refused, not truncated. Messages themselves are capped
  by Gmail at 25 MB including attachments.
- Bodies are read as plain text; HTML-only mail is converted, which drops
  formatting and inline images.

## Example

Unanswered support mail from the last day:

```sql
FROM gmail.threads
|> WHERE 'INBOX' IN UNNEST(labels) AND message_count = 1
     AND last_message_date >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
|> SELECT id, subject, last_message_date
|> ORDER BY last_message_date;
```

Draft a reply to each with a model and send it:

```sql
FROM gmail.messages
|> WHERE 'INBOX' IN UNNEST(labels) AND 'UNANSWERED' IN UNNEST(labels)
|> INFER `model-task:support-reply.v1` INPUT (subject, body_text) AS d
|> WHERE d.outcome = 'ok' AND d.value.confidence = 'high'
|> EFFECT COMMAND gmail.reply ID id INPUT (in_reply_to = id, body = d.value.text);
```

Policy for a mailbox typically delegates every send to a person, so the Run
stops at a Checkpoint with the exact replies.

Pass the PDF invoices customers mailed in to a model:

```sql
FROM gmail.attachments AS a
|> WHERE a.media_type = 'application/pdf'
|> JOIN gmail.contents AS c ON a.resource = c.resource AND a.version = c.version
|> INFER `model-task:invoice-fields.v1` INPUT (document = c.content) AS inv
|> WHERE inv.outcome = 'ok'
|> SELECT a.message_id, a.filename, inv.value.supplier, inv.value.total;
```
