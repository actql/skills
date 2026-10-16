<!-- Generated from actql/actql@747e5c2771ca docs/connectors/slack.md; do not edit. The published page is https://actql.com/docs/actql/connectors/slack -->
# Slack

The Slack Connector reads channels, messages, users and files from a
workspace, posts and edits messages, shares files and archives channels. It
is how a Program tells people about what it found or did — a summary of
high-risk accounts in a channel, a thread reply with a model's answer — and
how it reads what people said.

## Sources

- `slack.channels` — the channels the app can see: `id`, `name`, `topic`,
  `purpose`, `member_count`, `is_private`, `is_archived`, `created`. Key `id`.
- `slack.messages` — messages: `id` (the Connector's `channel:ts` identity,
  the key), `channel`, `ts` (the message's identity within its channel),
  `user`, `text`, `thread_ts`, `reply_count`, `reactions` (an array of name
  and count), `edited`, `files` (an array of file ids), plus `posted_at` as a
  timestamp. Key `id`. Filter by channel and time
  range; reading a whole workspace's history is not a Program-sized read.
- `slack.users` — members: `id`, `name`, `real_name`, `display_name`,
  `email` (when the scope allows), `tz`, `is_bot`, `deleted`. Key `id`.
- `slack.files` — files shared in the workspace: `resource`, `version` (the
  file id), `name`, `media_type`, `size`, `user`, `channels` (an array),
  `created`. Filter by channel or user.
- `slack.contents` — a file's bytes as a `content_ref`: `resource`, `version`,
  `media_type`, `content`. Join it on `resource` and `version` from
  `slack.files`; the Connector downloads only the files the join names.

## Types

| Slack value | ActQL | Notes |
| --- | --- | --- |
| `ts` (message timestamp) | `string` | The identity Slack uses; kept exactly as a string. `posted_at` is the same instant as a `timestamp`. |
| ids (`C…`, `U…`, `F…`) | `string` | |
| `text` | `string` | Slack's mrkdwn, as sent; user and channel mentions stay in `<@U…>` form. |
| `reactions` | `array<object>` | `name`, `count`, `users`. |
| `files` | `array<string>` | File ids; join against `slack.files`. |
| `created`, `edited.ts` | `timestamp` | |
| booleans (`is_private`, `is_bot`, …) | `bool` | |
| `member_count`, `reply_count` | `int64` | |

## Effects and operations

Messages are records once they exist, so editing and deleting them are
record Effects keyed by `channel` and `ts`:

- **update** — `EFFECT UPDATE slack.messages ID id SET (text = …)`
  edits a message the app posted (`chat.update`).
- **delete** — `EFFECT DELETE slack.messages ID id` deletes it
  (`chat.delete`).

The key must identify exactly one message; `channel` + `ts` always does.
Slack lets an app edit or delete only its own messages unless the token
carries admin scopes.

Content:

- **store** — `EFFECT STORE slack.files SET (channel = …, name = …, content = content [, thread_ts = …])`
  uploads the row's `content` (a `content_ref` from `SERIALIZE` or a
  `contents` source) and shares it in the channel.

Operations — posting is an operation, not a record write, because it creates
a message and notifies people:

- **post** — `EFFECT COMMAND slack.post TARGET channel ID key INPUT (text = …)`.
- **reply** — `EFFECT COMMAND slack.reply TARGET channel ID key INPUT (thread_ts = …, text = …)`
  posts into a thread.
- **react** — `EFFECT COMMAND slack.react TARGET channel ID key INPUT (ts = …, name = 'white_check_mark')`.
- **archive_channel** — `EFFECT COMMAND slack.archive_channel TARGET channel ID key`.

`TARGET` is the channel the operation acts on and `ID` the row's key, which
identifies each operation in the Preview and the status; it is never the
message text or the channel. Text is sent as plain mrkdwn; Programs do not
build Block Kit payloads.

## Setup

```json
"slack": {
  "connector": "slack",
  "credentials": {"bot_token": {"env": "SLACK_BOT_TOKEN"}}
}
```

Install a Slack app in the workspace and use its bot token. Reading needs
`channels:read`, `channels:history` (plus `groups:*` for private channels,
`im:*` and `mpim:*` for direct messages) and `users:read` (`users:read.email`
for addresses); `files:read` for files. Posting, editing and deleting need
`chat:write`; sharing files needs `files:write`; reacting needs
`reactions:write`; archiving needs `channels:manage` (or `groups:write`). The
app must be a member of a channel to read or post there. On ActQL Cloud the
Slack app is installed through hosted OAuth; a Local Host uses the bot token
directly.

## Capabilities and pushdown

| Operation | Pushed down when |
| --- | --- |
| Projection | Reduces what the engine keeps; Slack returns whole objects. |
| `WHERE` | `channel = …` and a time range on `ts` / `posted_at` for messages (`conversations.history` `oldest`/`latest`); `id = …` for channels and users; `channel` or `user` for files. Text predicates run on the Host — Slack's search API is not used, because its ranking and tokenisation do not match SQL semantics. |
| `ORDER BY` | `ts` descending or ascending on messages; everything else on the Host. |
| `LIMIT` | Always, through page size and cursor. |
| `GROUP BY`, `JOIN` | Never; they run on the Host. |

## Preview and reconciliation

**Preview.** Updates and deletes are `full_diff`: the Connector reads the
message by `channel` and `ts`, records its current text and `edited`
timestamp, and the Preview shows current and new text. At apply time it reads
the message again; if the text or the `edited` timestamp changed, the item
ends `failed` with `conflict` and nothing is sent. Posts, replies, reactions,
archives and uploads are `targeted`: the Preview shows the channel, the
exact text (or file name and size, or reaction) and, for a reply, the thread
it joins.

**Reconciliation.** Posting is not idempotent on Slack's side, so every post
and reply carries the request's marker in the message `metadata`
(`event_type: actql_effect`, with the Effect item id). A lost reply is
reconciled by reading the channel's recent history for a message with that
marker; a message with the same text but no marker is not evidence. Edits
carry the marker in the updated message's `metadata` as well, so an edit is
reconciled by reading the message and finding the marker next to the approved
text; the text alone, or an `edited` timestamp in the window, is not. Deletes,
reactions and archives leave no marker Slack returns, so a lost reply to one
of them stays `unknown`; the message's absence, a reaction on it or the
channel's archived flag is not evidence. File uploads reconcile through `files.list` for the
request's file name and marker in the file's `title`. Without evidence the
item stays `unknown` and nothing is sent again. An operation ends `accepted`
when Slack returned `ok: true`, `applied` once the read-back confirms it.

## Limits and cost

- Slack rate-limits methods per workspace in tiers (`conversations.history`
  is roughly one request per second; `chat.postMessage` about one message per
  second per channel). The Connector paces within the limit; a Program that
  reads a long time range takes correspondingly long and is bounded by its
  row limit.
- History is paged 200 messages a time (1,000 maximum per request); a read
  that would exceed the Program's row limit stops with an error rather than a
  partial result.
- Files are limited by the workspace plan's storage; downloads are bounded by
  the Program's byte limit.
- Slack's API has no usage fee; the rate limits and the plan's retention are
  the constraints.

## Example

Count messages per channel this week:

```sql
FROM slack.messages
|> WHERE posted_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
|> AGGREGATE COUNT(*) AS messages GROUP BY channel
|> ORDER BY messages DESC;
```

Post one summary message about high-risk accounts:

```sql
SELECT a.name, risk.value.reason AS reason
FROM salesforce.accounts AS a
JOIN snowflake.usage_30d AS u ON a.id = u.account_id
|> INFER `model-task:churn-risk.v1`
     INPUT (notes = a.description, active_users = u.active_users, trend = u.trend) AS risk
|> WHERE risk.outcome = 'ok' AND risk.value.level = 'high'
|> AGGREGATE STRING_AGG(CONCAT('• ', name, ': ', reason), '\n') AS body
|> EXTEND CURRENT_DATE() AS day
|> EFFECT COMMAND slack.post TARGET 'C0123456789' ID day
     INPUT (text = CONCAT('High churn risk today:\n', body));
```

Answer unanswered questions in a support channel with a model's reply, in
the thread:

```sql
FROM slack.messages AS m
|> WHERE m.channel = 'C0SUPPORT' AND m.thread_ts IS NULL AND m.reply_count = 0
     AND m.posted_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
|> INFER `model-task:support-reply.v1` INPUT (question = m.text) AS d
|> WHERE d.outcome = 'ok' AND d.value.confidence = 'high'
|> EFFECT COMMAND slack.reply TARGET m.channel ID m.id
     INPUT (thread_ts = m.ts, text = d.value.text);
```
