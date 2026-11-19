# Inbox Realtime Diagnostics

> Entry point: [CLAUDE.md](../../CLAUDE.md) · API: [../architecture/api.md](../architecture/api.md) · CRM/Inbox: [../business/crm.md](../business/crm.md)

`/admin/inbox/realtime-diagnostics` is the Administrator/platform-admin tool for testing whether
omnichannel Inbox updates are reaching the browser quickly.

The page is intentionally split into two test modes:

| Button | What it tests | Writes DB rows? | Sends to external platforms? | Expected result |
| --- | --- | --- | --- | --- |
| `Emit` | Realtime signal only (`bmsInboxChanged`) | No | No | Realtime Probe shows an event + latency, but Inbox has no new message |
| `Create Msg` | End-to-end Inbox path | Yes, diagnostic conversation/message only | No | Inbox list updates and the created conversation can be opened |

The matrix separates latest activity into real platform health and diagnostic writes:

- `IN real` / `OUT real` come from `bmsChannelHealth` and should only move when a real webhook or
  real outbound platform call is recorded.
- `IN diag` comes from diagnostic messages created by `Create Msg`; it is safe to use for repeated
  Inbox realtime testing without changing real channel health.

## Emit

`Emit` calls `bmsEmitInboxDiagnosticEvent(channel, probeId)`. The server publishes a tenant-scoped
`bmsInboxChanged` event with a `diag:{channel}:{probeId}` conversation ID. That ID deliberately
does not point at a real `bms_conversations` row.

Use it to verify:

- GraphQL mutation works for the current admin tenant.
- Redis PubSub accepts the publish.
- The WebSocket gateway delivers the subscription event back to the browser.
- The UI can measure browser-visible latency.

Because no DB row is written, a successful `Emit` should not create anything in `/admin/inbox`.

## Create Msg

`Create Msg` calls `bmsCreateInboxDiagnosticMessage(channel)`. It creates or updates one diagnostic
conversation for the current admin/channel, inserts one inbound diagnostic message, then publishes
the normal `bmsInboxChanged` event.

The diagnostic customer ref is:

```text
diagnostic:{channel}:{adminId}
```

The message sender is `diagnostic`, and `bms_messages.meta.diagnostic = true`. The message is
tenant-scoped and auditable, but it never calls the AI pipeline and never sends anything to
LINE/Meta/TikTok/Shopee/Lazada.

Use it when the question is: "Will a real DB write appear in Inbox immediately?"

## When the list appears but the conversation does not

The list and detail are separate GraphQL reads. Open a conversation and check the
detail request, including its nested `messages`, `notes`, `helpers`, and
`systemEvents` fields; a successful list request does not prove that detail works.
An audit event uses `bms_audit_log.target` (`text`) while the conversation ID is a
`uuid`, so the detail query must compare the target with the ID converted to text.
The page shows a loading state, then an error with Retry if the detail request
fails. It asks the server to clear unread only after the latest message has
loaded, passing that message ID; the write leaves unread intact if a newer
inbound message committed meanwhile. The selected `?c=` link survives a browser
refresh.

If `Create Msg` appears but real customer messages do not, check the signed
webhook route and `IN real` separately. `IN diag` does not prove that a provider
delivered a webhook. Use a disposable environment for write tests; do not send
test messages to real customers.

## Security and performance

- The route has a server-side layout gate via `requireTenantAdministratorPage()`.
- Both diagnostic mutations reject non-admin scopes; `Create Msg` is in `bmsInbox.ts`, while
  `Emit` is in `bmsChannels.ts`.
- The subscription payload contains only `conversationId`, `kind`, and `occurredAt`; message bodies
  stay behind normal RBAC-protected Inbox queries.
- The diagnostics page subscribes only while the page is open. It does not add work to ordinary
  Inbox users.
